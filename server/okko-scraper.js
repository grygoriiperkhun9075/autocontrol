/**
 * OKKO SSP Scraper — отримує реальні талони з ssp-online.okko.ua
 * Використовує proxy-service API з JSON авторизацією та Bearer token
 */

const https = require('https');

class OkkoScraper {
    constructor(login, password) {
        this.login = login;
        this.password = password;
        this.baseUrl = 'https://ssp-online-back.okko.ua';
        this.token = null;
        this.contractId = '0045004860';
        this.cachedCoupons = [];
        this.lastFetchTime = 0;
        this.CACHE_TTL = 5 * 60 * 1000; // 5 хвилин
    }

    /**
     * HTTP-запит з Bearer token
     */
    _request(url, options = {}) {
        return new Promise((resolve, reject) => {
            const parsed = new URL(url);

            const headers = {
                'Accept': 'application/json, text/plain, */*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Origin': 'https://ssp-online.okko.ua',
                'Referer': 'https://ssp-online.okko.ua/',
                'X-App-Version': Date.now().toString(),
                'X-Rt': Date.now().toString(),
                ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
                ...options.headers
            };

            const reqOptions = {
                hostname: parsed.hostname,
                port: 443,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers
            };

            const req = https.request(reqOptions, (res) => {
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
                const bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
                req.write(bodyStr);
            }
            req.end();
        });
    }

    /**
     * Авторизація в OKKO SSP — JSON POST, отримуємо Bearer token
     */
    async authenticate() {
        try {
            console.log('🔐 OKKO: Авторизація (JSON)...');

            const body = JSON.stringify({
                login: this.login,
                password: this.password
            });

            const resp = await this._request(`${this.baseUrl}/proxy-service/login`, {
                method: 'POST',
                body,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                }
            });

            console.log(`🔐 OKKO: Login status: ${resp.status}`);

            if (resp.status === 200 || resp.status === 201) {
                const data = resp.json();

                // Шукаємо токен у різних полях відповіді
                this.token = data?.token || data?.accessToken || data?.access_token || data?.jwt || null;

                if (this.token) {
                    console.log(`✅ OKKO: Авторизація успішна, token: ${this.token.substring(0, 30)}...`);
                } else {
                    console.log(`⚠️ OKKO: Login 200 але токен не знайдено. Відповідь: ${JSON.stringify(data).substring(0, 300)}`);
                    // Може токен в заголовках
                    const authHeader = resp.headers['authorization'];
                    if (authHeader) {
                        this.token = authHeader.replace('Bearer ', '');
                        console.log(`✅ OKKO: Токен з заголовка: ${this.token.substring(0, 30)}...`);
                    }
                }
                return true;
            }

            console.error(`❌ OKKO: Помилка авторизації ${resp.status}: ${resp.body.substring(0, 300)}`);
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
     * Отримання активних талонів (cards)
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

            // Спробуємо отримати контракти
            const contracts = await this.getContracts();
            if (contracts && Array.isArray(contracts) && contracts.length > 0) {
                const contract = contracts[0];
                this.contractId = contract.id || contract.contractId || contract.contract_id || this.contractId;
                console.log(`📋 OKKO: Контракт: ${this.contractId}`);
            }

            // Основний ендпоінт — /proxy-service/cards (як у браузері)
            const endpoints = [
                `/proxy-service/cards?contract_id=${this.contractId}&offset=0&size=100&card_status=CHST0`,
                `/proxy-service/coupons?contract-id=${this.contractId}&index=0&size=100`,
                `/proxy-service/coupons?contract_id=${this.contractId}&offset=0&size=100`,
                `/proxy-service/cards?contract-id=${this.contractId}&index=0&size=100&status=ACTIVATED`,
            ];

            for (const endpoint of endpoints) {
                console.log(`📋 OKKO: Спроба ${endpoint}...`);
                const resp = await this._request(`${this.baseUrl}${endpoint}`);
                console.log(`📋 OKKO: ${endpoint} → ${resp.status}`);

                if (resp.status === 200) {
                    const data = resp.json();
                    console.log(`📋 OKKO: Response: ${JSON.stringify(data).substring(0, 500)}`);

                    const parsed = this._parseCoupons(data);
                    if (parsed.length > 0) {
                        this.cachedCoupons = parsed;
                        console.log(`✅ OKKO: Знайдено ${this.cachedCoupons.length} талонів через ${endpoint}`);
                        break;
                    }
                } else if (resp.status === 401) {
                    // Токен протух
                    console.log('🔄 OKKO: Token expired, re-authenticating...');
                    this.token = null;
                    const reauth = await this.authenticate();
                    if (!reauth) break;
                    // Повторюємо запит
                    const retryResp = await this._request(`${this.baseUrl}${endpoint}`);
                    if (retryResp.status === 200) {
                        const data = retryResp.json();
                        const parsed = this._parseCoupons(data);
                        if (parsed.length > 0) {
                            this.cachedCoupons = parsed;
                            console.log(`✅ OKKO: Знайдено ${this.cachedCoupons.length} талонів через ${endpoint} (retry)`);
                            break;
                        }
                    }
                } else {
                    console.log(`⚠️ OKKO: ${endpoint} → ${resp.status}: ${resp.body.substring(0, 200)}`);
                }
            }

            this.lastFetchTime = Date.now();
            console.log(`📊 OKKO: Підсумок — ${this.cachedCoupons.length} активних талонів`);

            if (this.cachedCoupons.length > 0) {
                console.log(`📋 OKKO: Приклад: ${JSON.stringify(this.cachedCoupons[0])}`);
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

        // Може бути масив або об'єкт з різними полями
        let coupons = [];
        if (Array.isArray(data)) {
            coupons = data;
        } else if (data.content && Array.isArray(data.content)) {
            coupons = data.content;
        } else if (data.items && Array.isArray(data.items)) {
            coupons = data.items;
        } else if (data.coupons && Array.isArray(data.coupons)) {
            coupons = data.coupons;
        } else if (data.cards && Array.isArray(data.cards)) {
            coupons = data.cards;
        } else if (data.data && Array.isArray(data.data)) {
            coupons = data.data;
        } else if (data.result && Array.isArray(data.result)) {
            coupons = data.result;
        }

        console.log(`🔍 OKKO: Знайдено ${coupons.length} елементів у відповіді`);
        if (coupons.length > 0) {
            console.log(`🔍 OKKO: Ключі першого: ${JSON.stringify(Object.keys(coupons[0]))}`);
            console.log(`🔍 OKKO: Перший елемент: ${JSON.stringify(coupons[0]).substring(0, 500)}`);
        }

        return coupons.map(c => ({
            number: c.number || c.couponNumber || c.coupon_number || c.cardNumber || c.card_number || '',
            nominal: this._parseNominal(c),
            fuelType: c.productName || c.product_name || c.fuelType || c.fuel_type || 'Дизельне паливо',
            productId: c.productId || c.product_id || '9018',
            validFrom: c.validFrom || c.activate_date || c.startDate || c.valid_from || c.activateDate || '',
            validTo: c.validTo || c.expire_date || c.endDate || c.valid_to || c.expireDate || '',
            qr: c.qr || c.qrCode || c.qr_code || c.barcode || '',
            status: c.status || c.card_status || c.cardStatus || 'ACTIVATED'
        })).filter(c => c.number && c.nominal > 0);
    }

    /**
     * Парсинг номіналу
     */
    _parseNominal(coupon) {
        const nominal = coupon.nominal || coupon.liters || coupon.volume || coupon.amount || coupon.balance || 0;
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
        return nominals;
    }

    /**
     * Чи ініціалізований скрейпер
     */
    isConfigured() {
        return !!(this.login && this.password);
    }
}

module.exports = OkkoScraper;
