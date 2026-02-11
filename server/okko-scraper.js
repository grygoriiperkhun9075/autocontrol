/**
 * OKKO SSP Scraper — отримує реальні талони з ssp-online.okko.ua
 * Використовує proxy-service API з multipart/form-data авторизацією
 */

const https = require('https');

class OkkoScraper {
    constructor(login, password) {
        this.login = login;
        this.password = password;
        this.baseUrl = 'https://ssp-online-back.okko.ua';
        this.cookies = {};
        this.contractId = '0045004860';
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

            const cookieHeader = Object.entries(this.cookies)
                .map(([k, v]) => `${k}=${v}`)
                .join('; ');

            const reqOptions = {
                hostname: parsed.hostname,
                port: 443,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Origin': 'https://ssp-online.okko.ua',
                    'Referer': 'https://ssp-online.okko.ua/',
                    ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
                    ...options.headers
                }
            };

            const req = https.request(reqOptions, (res) => {
                // Зберігаємо cookies
                const setCookies = res.headers['set-cookie'];
                if (setCookies) {
                    setCookies.forEach(c => {
                        const [nameValue] = c.split(';');
                        const eqIdx = nameValue.indexOf('=');
                        if (eqIdx > 0) {
                            const name = nameValue.substring(0, eqIdx).trim();
                            const value = nameValue.substring(eqIdx + 1).trim();
                            if (name && value) this.cookies[name] = value;
                        }
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
                req.write(options.body);
            }
            req.end();
        });
    }

    /**
     * Створення multipart/form-data body
     */
    _buildFormData(fields) {
        const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
        let body = '';
        for (const [key, value] of Object.entries(fields)) {
            body += `--${boundary}\r\n`;
            body += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
            body += `${value}\r\n`;
        }
        body += `--${boundary}--\r\n`;
        return { body, contentType: `multipart/form-data; boundary=${boundary}` };
    }

    /**
     * Авторизація в OKKO SSP через proxy-service
     */
    async authenticate() {
        try {
            console.log('🔐 OKKO: Авторизація через proxy-service...');

            const { body, contentType } = this._buildFormData({
                login: this.login,
                password: this.password
            });

            const resp = await this._request(`${this.baseUrl}/proxy-service/login`, {
                method: 'POST',
                body: body,
                headers: {
                    'Content-Type': contentType,
                    'Content-Length': Buffer.byteLength(body)
                }
            });

            console.log(`🔐 OKKO: Відповідь login: ${resp.status}`);

            if (resp.status === 200 || resp.status === 201) {
                console.log('✅ OKKO: Авторизація успішна');
                console.log(`🍪 OKKO: Cookies: ${Object.keys(this.cookies).join(', ')}`);
                return true;
            }

            // Спробуємо x-www-form-urlencoded як альтернативу
            console.log('🔄 OKKO: Спроба x-www-form-urlencoded...');
            const urlEncodedBody = `login=${encodeURIComponent(this.login)}&password=${encodeURIComponent(this.password)}`;
            const resp2 = await this._request(`${this.baseUrl}/proxy-service/login`, {
                method: 'POST',
                body: urlEncodedBody,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(urlEncodedBody)
                }
            });

            console.log(`🔐 OKKO: Відповідь login v2: ${resp2.status}`);

            if (resp2.status === 200 || resp2.status === 201) {
                console.log('✅ OKKO: Авторизація успішна (urlencoded)');
                return true;
            }

            console.error('❌ OKKO: Помилка авторизації', resp.status, resp.body.substring(0, 300));
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
            const resp = await this._request(`${this.baseUrl}/proxy-service/contracts`);
            console.log(`📋 OKKO: Contracts status: ${resp.status}`);
            if (resp.status === 200) {
                const data = resp.json();
                console.log(`📋 OKKO: Contracts: ${JSON.stringify(data).substring(0, 500)}`);
                return data;
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
            console.log(`📦 OKKO: Повертаю з кешу ${this.cachedCoupons.length} талонів`);
            return this.cachedCoupons;
        }

        try {
            // Авторизуємось
            const authenticated = await this.authenticate();
            if (!authenticated) {
                console.error('❌ OKKO: Не вдалось авторизуватись');
                return this.cachedCoupons;
            }

            // Спочатку спробуємо отримати контракти
            const contracts = await this.getContracts();
            if (contracts && Array.isArray(contracts) && contracts.length > 0) {
                this.contractId = contracts[0].id || contracts[0].contractId || this.contractId;
                console.log(`📋 OKKO: Використовую контракт: ${this.contractId}`);
            }

            console.log(`📋 OKKO: Запит талонів (контракт: ${this.contractId})...`);

            // Запит талонів
            const resp = await this._request(
                `${this.baseUrl}/proxy-service/coupons?contract-id=${this.contractId}&index=0&size=100`
            );

            console.log(`📋 OKKO: Coupons status: ${resp.status}`);
            console.log(`📋 OKKO: Coupons response: ${resp.body.substring(0, 500)}`);

            if (resp.status === 200) {
                const data = resp.json();
                this.cachedCoupons = this._parseCoupons(data);
            } else {
                console.error(`❌ OKKO: Помилка отримання талонів: ${resp.status}`);

                // Спробуємо інші ендпоінти
                const alternatives = [
                    `/proxy-service/contracts/${this.contractId}/coupons?index=0&size=100`,
                    `/userdata-service/coupons?contract-id=${this.contractId}&index=0&size=100`,
                    `/proxy-service/coupons?contractId=${this.contractId}&index=0&size=100&status=ACTIVATED`,
                ];

                for (const alt of alternatives) {
                    console.log(`🔄 OKKO: Спроба ${alt}...`);
                    const altResp = await this._request(`${this.baseUrl}${alt}`);
                    console.log(`🔄 OKKO: ${alt} → ${altResp.status}: ${altResp.body.substring(0, 300)}`);

                    if (altResp.status === 200) {
                        const altData = altResp.json();
                        if (altData) {
                            this.cachedCoupons = this._parseCoupons(altData);
                            if (this.cachedCoupons.length > 0) {
                                console.log(`✅ OKKO: Знайдено ${this.cachedCoupons.length} талонів через ${alt}`);
                                break;
                            }
                        }
                    }
                }
            }

            this.lastFetchTime = Date.now();
            console.log(`✅ OKKO: Отримано ${this.cachedCoupons.length} активних талонів`);

            if (this.cachedCoupons.length > 0) {
                console.log(`📋 OKKO: Приклад талону: ${JSON.stringify(this.cachedCoupons[0])}`);
            }

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

        console.log(`🔍 OKKO: Тип даних: ${typeof data}, isArray: ${Array.isArray(data)}`);
        if (typeof data === 'object' && !Array.isArray(data)) {
            console.log(`🔍 OKKO: Ключі: ${Object.keys(data).join(', ')}`);
        }

        // Може бути масив або об'єкт з полем content/items/coupons/data
        let coupons = [];
        if (Array.isArray(data)) {
            coupons = data;
        } else if (data.content && Array.isArray(data.content)) {
            coupons = data.content;
        } else if (data.items && Array.isArray(data.items)) {
            coupons = data.items;
        } else if (data.coupons && Array.isArray(data.coupons)) {
            coupons = data.coupons;
        } else if (data.data && Array.isArray(data.data)) {
            coupons = data.data;
        } else if (data.result && Array.isArray(data.result)) {
            coupons = data.result;
        }

        console.log(`🔍 OKKO: Знайдено ${coupons.length} талонів у відповіді`);
        if (coupons.length > 0) {
            console.log(`🔍 OKKO: Структура першого талону: ${JSON.stringify(Object.keys(coupons[0]))}`);
            console.log(`🔍 OKKO: Перший талон (дані): ${JSON.stringify(coupons[0]).substring(0, 500)}`);
        }

        return coupons.map(c => ({
            number: c.number || c.couponNumber || c.coupon_number || '',
            nominal: this._parseNominal(c),
            fuelType: c.productName || c.product_name || c.fuelType || c.fuel_type || 'Дизельне паливо',
            productId: c.productId || c.product_id || '9018',
            validFrom: c.validFrom || c.activate_date || c.startDate || c.valid_from || '',
            validTo: c.validTo || c.expire_date || c.endDate || c.valid_to || c.expireDate || '',
            qr: c.qr || c.qrCode || c.qr_code || c.barcode || '',
            status: c.status || 'ACTIVATED'
        })).filter(c => c.number && c.nominal > 0);
    }

    /**
     * Парсинг номіналу — може бути в літрах або в мілілітрах (40000 → 40)
     */
    _parseNominal(coupon) {
        const nominal = coupon.nominal || coupon.liters || coupon.volume || coupon.amount || 0;
        // Якщо номінал > 1000 — це мілілітри, переводимо в літри
        if (nominal > 1000) return Math.round(nominal / 1000);
        return nominal;
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
