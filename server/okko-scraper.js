/**
 * OKKO SSP Scraper — отримує реальні талони з ssp-online.okko.ua
 * Логіниться через session, парсить список активних талонів,
 * та генерує PDF з QR-кодом для водія
 */

const https = require('https');
const http = require('http');

class OkkoScraper {
    constructor(login, password) {
        this.login = login;
        this.password = password;
        this.baseUrl = 'https://ssp-online.okko.ua';
        this.backendUrl = 'https://ssp-online-back.okko.ua';
        this.cookies = {};
        this.token = null;
        this.contractId = null;
        this.cachedCoupons = [];
        this.lastFetchTime = 0;
        this.CACHE_TTL = 5 * 60 * 1000; // 5 хвилин
    }

    /**
     * HTTP-запит з підтримкою cookies
     */
    _request(url, options = {}) {
        return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const isHttps = parsed.protocol === 'https:';
            const lib = isHttps ? https : http;

            const cookieHeader = Object.entries(this.cookies)
                .map(([k, v]) => `${k}=${v}`)
                .join('; ');

            const reqOptions = {
                hostname: parsed.hostname,
                port: parsed.port || (isHttps ? 443 : 80),
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
                    ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
                    ...options.headers
                }
            };

            const req = lib.request(reqOptions, (res) => {
                // Зберігаємо cookies
                const setCookies = res.headers['set-cookie'];
                if (setCookies) {
                    setCookies.forEach(c => {
                        const [nameValue] = c.split(';');
                        const [name, value] = nameValue.split('=');
                        if (name && value) this.cookies[name.trim()] = value.trim();
                    });
                }

                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: data,
                        json: () => {
                            try { return JSON.parse(data); }
                            catch { return null; }
                        }
                    });
                });
            });

            req.on('error', reject);
            req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });

            if (options.body) {
                req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
            }
            req.end();
        });
    }

    /**
     * Авторизація в OKKO SSP
     */
    async authenticate() {
        try {
            console.log('🔐 OKKO: Авторизація...');

            const resp = await this._request(`${this.baseUrl}/api/auth/login`, {
                method: 'POST',
                body: {
                    login: this.login,
                    password: this.password
                }
            });

            if (resp.status === 200 || resp.status === 201) {
                const data = resp.json();
                if (data && data.token) {
                    this.token = data.token;
                } else if (data && data.accessToken) {
                    this.token = data.accessToken;
                }
                console.log('✅ OKKO: Авторизація успішна');
                return true;
            }

            // Спробуємо інший ендпоінт
            const resp2 = await this._request(`${this.baseUrl}/api/login`, {
                method: 'POST',
                body: {
                    login: this.login,
                    password: this.password
                }
            });

            if (resp2.status === 200 || resp2.status === 201) {
                const data = resp2.json();
                if (data && data.token) {
                    this.token = data.token;
                }
                console.log('✅ OKKO: Авторизація успішна (v2)');
                return true;
            }

            console.error('❌ OKKO: Помилка авторизації', resp.status, resp.body.substring(0, 200));
            return false;
        } catch (error) {
            console.error('❌ OKKO: Помилка підключення:', error.message);
            return false;
        }
    }

    /**
     * Отримання списку контрактів
     */
    async getContracts() {
        try {
            const resp = await this._request(`${this.baseUrl}/api/contracts`);
            if (resp.status === 200) {
                return resp.json();
            }
            return null;
        } catch (error) {
            console.error('❌ OKKO: Помилка отримання контрактів:', error.message);
            return null;
        }
    }

    /**
     * Отримання активних талонів
     */
    async fetchActiveCoupons(forceRefresh = false) {
        // Перевіряємо кеш
        if (!forceRefresh && Date.now() - this.lastFetchTime < this.CACHE_TTL && this.cachedCoupons.length > 0) {
            return this.cachedCoupons;
        }

        try {
            // Авторизуємось, якщо немає токена
            if (!this.token) {
                const authenticated = await this.authenticate();
                if (!authenticated) return this.cachedCoupons;
            }

            // Знаходимо contract-id для талонів
            if (!this.contractId) {
                const contracts = await this.getContracts();
                if (contracts && Array.isArray(contracts)) {
                    const couponContract = contracts.find(c =>
                        c.name?.toLowerCase().includes('талон') ||
                        c.type?.toLowerCase().includes('coupon')
                    );
                    this.contractId = couponContract?.id || contracts[0]?.id || '0045004860';
                } else {
                    this.contractId = '0045004860'; // Fallback
                }
            }

            console.log(`📋 OKKO: Запит талонів (контракт: ${this.contractId})...`);

            const resp = await this._request(
                `${this.baseUrl}/api/coupons?contract-id=${this.contractId}&index=0&size=100&status=ACTIVATED`
            );

            if (resp.status === 401) {
                // Токен протух — перелогін
                this.token = null;
                const authenticated = await this.authenticate();
                if (!authenticated) return this.cachedCoupons;

                const retryResp = await this._request(
                    `${this.baseUrl}/api/coupons?contract-id=${this.contractId}&index=0&size=100&status=ACTIVATED`
                );
                if (retryResp.status === 200) {
                    const data = retryResp.json();
                    this.cachedCoupons = this._parseCoupons(data);
                }
            } else if (resp.status === 200) {
                const data = resp.json();
                this.cachedCoupons = this._parseCoupons(data);
            }

            this.lastFetchTime = Date.now();
            console.log(`✅ OKKO: Отримано ${this.cachedCoupons.length} активних талонів`);
            return this.cachedCoupons;

        } catch (error) {
            console.error('❌ OKKO: Помилка запиту талонів:', error.message);
            return this.cachedCoupons;
        }
    }

    /**
     * Парсинг відповіді з талонами
     */
    _parseCoupons(data) {
        if (!data) return [];

        // Може бути масив або об'єкт з полем content/items/coupons
        let coupons = [];
        if (Array.isArray(data)) {
            coupons = data;
        } else if (data.content) {
            coupons = data.content;
        } else if (data.items) {
            coupons = data.items;
        } else if (data.coupons) {
            coupons = data.coupons;
        }

        return coupons.map(c => ({
            number: c.number || c.couponNumber || '',
            nominal: c.nominal ? Math.round(c.nominal / 1000) : (c.liters || 0), // 40000 → 40
            fuelType: c.productName || c.product_name || c.fuelType || 'Дизельне паливо',
            productId: c.productId || c.product_id || '9018',
            validFrom: c.validFrom || c.activate_date || c.startDate || '',
            validTo: c.validTo || c.expire_date || c.endDate || '',
            qr: c.qr || c.qrCode || '',
            status: c.status || 'ACTIVATED'
        })).filter(c => c.number && c.nominal > 0);
    }

    /**
     * Завантаження PDF талону з OKKO
     */
    async downloadCouponPDF(couponNumbers) {
        try {
            if (!this.token) {
                const authenticated = await this.authenticate();
                if (!authenticated) return null;
            }

            // Формуємо payload для генерації PDF
            const coupons = this.cachedCoupons.filter(c =>
                couponNumbers.includes(c.number)
            );

            if (coupons.length === 0) return null;

            const payload = coupons.map(c => ({
                number: c.number,
                nominal: c.nominal * 1000,
                product_id: c.productId,
                expire_date: c.validTo,
                qr: c.qr
            }));

            const resp = await this._request(
                `${this.backendUrl}/userdata-service/pdf/coupons`,
                {
                    method: 'POST',
                    body: payload,
                    headers: {
                        'Accept': 'application/pdf'
                    }
                }
            );

            if (resp.status === 200) {
                return Buffer.from(resp.body, 'binary');
            }

            console.error('❌ OKKO: Помилка завантаження PDF:', resp.status);
            return null;

        } catch (error) {
            console.error('❌ OKKO: Помилка завантаження PDF:', error.message);
            return null;
        }
    }

    /**
     * Знайти талон за номіналом
     */
    findCouponByNominal(liters) {
        return this.cachedCoupons.find(c => c.nominal === liters);
    }

    /**
     * Отримати доступні номінали
     */
    getAvailableNominals() {
        const nominals = {};
        for (const c of this.cachedCoupons) {
            if (!nominals[c.nominal]) {
                nominals[c.nominal] = 0;
            }
            nominals[c.nominal]++;
        }
        return nominals; // { 20: 4, 40: 1, 50: 5 }
    }

    /**
     * Чи ініціалізований скрейпер
     */
    isConfigured() {
        return !!(this.login && this.password);
    }
}

module.exports = OkkoScraper;
