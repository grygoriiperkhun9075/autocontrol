/**
 * OKKO SSP Scraper — отримує реальні талони з ssp-online.okko.ua
 * API: proxy-service для login/cards, userdata-service для контрактів
 */

const https = require('https');

class OkkoScraper {
    constructor(login, password) {
        this.login = login;
        this.password = password;
        this.baseUrl = 'https://ssp-online-back.okko.ua';
        this.token = null;
        this.contractId = null; // Визначаємо динамічно
        this.cachedCoupons = [];
        this.lastFetchTime = 0;
        this.CACHE_TTL = 5 * 60 * 1000; // 5 хвилин
    }

    /**
     * HTTP-запит з Bearer token та обов'язковими хедерами
     */
    _request(url, options = {}) {
        return new Promise((resolve, reject) => {
            const parsed = new URL(url);

            const headers = {
                'Accept': 'application/json, text/plain, */*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Origin': 'https://ssp-online.okko.ua',
                'Referer': 'https://ssp-online.okko.ua/',
                'X-App-Version': '1770841844620',
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
                // Збираємо дані
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    const data = Buffer.concat(chunks).toString('utf8');
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
     * Авторизація — JSON POST, Bearer token
     */
    async authenticate() {
        try {
            console.log('🔐 OKKO: Авторизація...');

            const body = JSON.stringify({
                login: this.login,
                password: this.password
            });

            const resp = await this._request(`${this.baseUrl}/proxy-service/login`, {
                method: 'POST',
                body,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body).toString()
                }
            });

            console.log(`🔐 OKKO: Login status: ${resp.status}`);

            if (resp.status === 200 || resp.status === 201) {
                const data = resp.json();
                this.token = data?.token || data?.accessToken || data?.access_token || null;

                if (!this.token) {
                    // Токен може бути в headers
                    const authHeader = resp.headers['authorization'];
                    if (authHeader) {
                        this.token = authHeader.replace('Bearer ', '');
                    }
                }

                if (!this.token) {
                    // Може весь body — це токен (JWT string)
                    if (typeof resp.body === 'string' && resp.body.includes('.') && resp.body.length > 50) {
                        this.token = resp.body.trim().replace(/"/g, '');
                    }
                }

                if (this.token) {
                    console.log(`✅ OKKO: Токен отримано (${this.token.substring(0, 20)}...)`);
                } else {
                    console.log(`⚠️ OKKO: Login 200, але токен не знайдено`);
                    console.log(`⚠️ OKKO: Body: ${resp.body.substring(0, 300)}`);
                    console.log(`⚠️ OKKO: Headers: ${JSON.stringify(resp.headers).substring(0, 300)}`);
                }
                return true;
            }

            console.error(`❌ OKKO: Login failed ${resp.status}: ${resp.body.substring(0, 200)}`);
            return false;
        } catch (error) {
            console.error('❌ OKKO: Login error:', error.message);
            return false;
        }
    }

    /**
     * Знайти контракт з талонами через userdata-service
     */
    async findCouponContract() {
        try {
            console.log('📋 OKKO: Пошук контракту з талонами...');

            const resp = await this._request(`${this.baseUrl}/userdata-service/contracts/name`);
            console.log(`📋 OKKO: Contracts status: ${resp.status}`);

            if (resp.status === 200) {
                const contracts = resp.json();
                console.log(`📋 OKKO: Контракти: ${JSON.stringify(contracts)}`);

                if (Array.isArray(contracts)) {
                    // Шукаємо контракт з назвою "талони" або "купон"
                    const couponContract = contracts.find(c =>
                        (c.name || '').toLowerCase().includes('талон') ||
                        (c.name || '').toLowerCase().includes('купон') ||
                        (c.name || '').toLowerCase().includes('coupon')
                    );

                    if (couponContract) {
                        this.contractId = couponContract.contract_id || couponContract.contractId || couponContract.id;
                        console.log(`✅ OKKO: Контракт талонів: ${this.contractId} ("${couponContract.name}")`);
                        return this.contractId;
                    }

                    // Fallback — шукаємо конкретний ID
                    const fallback = contracts.find(c =>
                        (c.contract_id || c.contractId || c.id) === '0045004860'
                    );
                    if (fallback) {
                        this.contractId = '0045004860';
                        console.log(`✅ OKKO: Контракт (fallback): ${this.contractId}`);
                        return this.contractId;
                    }
                }
            }

            // Хардкодний fallback
            this.contractId = '0045004860';
            console.log(`⚠️ OKKO: Використовую хардкодний контракт: ${this.contractId}`);
            return this.contractId;
        } catch (error) {
            console.error('❌ OKKO: Contracts error:', error.message);
            this.contractId = '0045004860';
            return this.contractId;
        }
    }

    /**
     * Отримання активних талонів
     */
    async fetchActiveCoupons(forceRefresh = false) {
        if (!forceRefresh && Date.now() - this.lastFetchTime < this.CACHE_TTL && this.cachedCoupons.length > 0) {
            console.log(`📦 OKKO: Кеш — ${this.cachedCoupons.length} талонів`);
            return this.cachedCoupons;
        }

        try {
            // Авторизуємось
            const auth = await this.authenticate();
            if (!auth) return this.cachedCoupons;

            // Знаходимо контракт з талонами
            await this.findCouponContract();

            // Запитуємо талони: /proxy-service/cards?contract_id=...&card_status=CHST0
            console.log(`📋 OKKO: Запит cards (контракт: ${this.contractId})...`);

            const resp = await this._request(
                `${this.baseUrl}/proxy-service/cards?contract_id=${this.contractId}&offset=0&size=100&card_status=CHST0`
            );

            console.log(`📋 OKKO: Cards status: ${resp.status}`);

            if (resp.status === 200) {
                const data = resp.json();
                console.log(`📋 OKKO: Total: ${data?.total || 'N/A'}, keys: ${data ? Object.keys(data).join(',') : 'null'}`);

                this.cachedCoupons = this._parseCoupons(data);
            } else if (resp.status === 401) {
                console.log('🔄 OKKO: Re-auth...');
                this.token = null;
                await this.authenticate();
                const retry = await this._request(
                    `${this.baseUrl}/proxy-service/cards?contract_id=${this.contractId}&offset=0&size=100&card_status=CHST0`
                );
                if (retry.status === 200) {
                    this.cachedCoupons = this._parseCoupons(retry.json());
                }
            } else {
                console.error(`❌ OKKO: Cards error ${resp.status}: ${resp.body.substring(0, 200)}`);
            }

            this.lastFetchTime = Date.now();
            console.log(`📊 OKKO: Знайдено ${this.cachedCoupons.length} талонів`);

            if (this.cachedCoupons.length > 0) {
                console.log(`📋 OKKO: Приклад: ${JSON.stringify(this.cachedCoupons[0])}`);
            }

            return this.cachedCoupons;
        } catch (error) {
            console.error('❌ OKKO: Fetch error:', error.message);
            return this.cachedCoupons;
        }
    }

    /**
     * Парсинг талонів з API
     */
    _parseCoupons(data) {
        if (!data) return [];

        // Відповідь: { total: N, cards: [...] }
        let cards = [];
        if (data.cards && Array.isArray(data.cards)) {
            cards = data.cards;
        } else if (Array.isArray(data)) {
            cards = data;
        } else if (data.content && Array.isArray(data.content)) {
            cards = data.content;
        } else if (data.items && Array.isArray(data.items)) {
            cards = data.items;
        }

        console.log(`🔍 OKKO: Парсинг ${cards.length} карток`);
        if (cards.length > 0) {
            console.log(`🔍 OKKO: Ключі: ${Object.keys(cards[0]).join(', ')}`);
        }

        return cards.map(c => ({
            number: c.card_num || c.cardNum || c.number || c.couponNumber || '',
            nominal: this._parseNominal(c),
            fuelType: c.product_name || c.productName || 'Дизельне паливо',
            productId: c.product_id || c.productId || '',
            validFrom: c.activate_date || c.activateDate || c.validFrom || '',
            validTo: c.exp_date || c.expDate || c.validTo || c.expire_date || '',
            qr: c.qr_string || c.qr || c.qrCode || c.barcode || '',
            status: c.card_status || c.cardStatus || c.status || 'CHST0',
            assignToContract: c.assign_to_contract_in_svfe || false
        })).filter(c => c.number && c.nominal > 0);
    }

    /**
     * Номінал: 40000 → 40 літрів
     */
    _parseNominal(c) {
        const val = c.nominal || c.liters || c.volume || c.amount || c.balance || 0;
        return val > 1000 ? Math.round(val / 1000) : val;
    }

    /**
     * Знайти талон за номіналом
     */
    findCouponByNominal(liters) {
        return this.cachedCoupons.find(c => c.nominal === liters);
    }

    /**
     * Доступні номінали з кількістю
     */
    getAvailableNominals() {
        const nominals = {};
        for (const c of this.cachedCoupons) {
            nominals[c.nominal] = (nominals[c.nominal] || 0) + 1;
        }
        return nominals;
    }

    /**
     * Чи налаштований скрейпер
     */
    isConfigured() {
        return !!(this.login && this.password);
    }

    /**
     * HTTP-запит що повертає Buffer (для бінарних даних — PDF, зображення)
     */
    _requestBinary(url, options = {}) {
        return new Promise((resolve, reject) => {
            const parsed = new URL(url);

            const headers = {
                'Accept': 'application/pdf, application/octet-stream, */*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Origin': 'https://ssp-online.okko.ua',
                'Referer': 'https://ssp-online.okko.ua/',
                'X-App-Version': '1770841844620',
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
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        buffer: buffer,
                        contentType: res.headers['content-type'] || ''
                    });
                });
            });

            req.on('error', reject);
            req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });

            if (options.body) {
                const bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
                req.write(bodyStr);
            }
            req.end();
        });
    }

    /**
     * Отримати оригінальний PDF талону з OKKO SSP
     * Endpoint: POST /proxy-service/pdf/coupons
     * @param {Object} coupon - об'єкт талону з fetchActiveCoupons
     * @returns {Promise<Buffer|null>} PDF як Buffer або null
     */
    async fetchCouponPDF(coupon) {
        try {
            // Переконуємось, що авторизовані
            if (!this.token) {
                const auth = await this.authenticate();
                if (!auth) {
                    console.error('❌ OKKO PDF: Не вдалося авторизуватися');
                    return null;
                }
            }

            console.log(`📄 OKKO PDF: Запит оригінального PDF для талону ${coupon.number}...`);

            // Тіло запиту — інформація про талон для PDF генерації
            const body = JSON.stringify({
                cards: [{
                    card_num: coupon.number,
                    nominal: coupon.nominal > 100 ? coupon.nominal : coupon.nominal * 1000,
                    product_name: coupon.fuelType || 'Дизельне паливо',
                    product_id: coupon.productId || '',
                    exp_date: coupon.validTo || '',
                    contract_id: this.contractId || '',
                    qr_string: coupon.qr || ''
                }]
            });

            const resp = await this._requestBinary(
                `${this.baseUrl}/proxy-service/pdf/coupons`,
                {
                    method: 'POST',
                    body,
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body).toString()
                    }
                }
            );

            console.log(`📄 OKKO PDF: Status: ${resp.status}, Content-Type: ${resp.contentType}, Size: ${resp.buffer.length}`);

            if (resp.status === 200 && resp.buffer.length > 100) {
                // Перевіряємо чи це дійсно PDF
                const header = resp.buffer.toString('utf8', 0, 5);
                if (header === '%PDF-') {
                    console.log(`✅ OKKO PDF: Отримано оригінальний PDF (${resp.buffer.length} bytes)`);
                    return resp.buffer;
                }
                console.log(`⚠️ OKKO PDF: Відповідь не є PDF. Header: ${header}`);
                console.log(`⚠️ OKKO PDF: Body preview: ${resp.buffer.toString('utf8', 0, 200)}`);
            } else if (resp.status === 401) {
                // Re-auth і повторна спроба
                console.log('🔄 OKKO PDF: Re-auth...');
                this.token = null;
                await this.authenticate();
                const retry = await this._requestBinary(
                    `${this.baseUrl}/proxy-service/pdf/coupons`,
                    {
                        method: 'POST',
                        body,
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(body).toString()
                        }
                    }
                );
                if (retry.status === 200 && retry.buffer.length > 100) {
                    const header = retry.buffer.toString('utf8', 0, 5);
                    if (header === '%PDF-') {
                        console.log(`✅ OKKO PDF: Отримано PDF після re-auth (${retry.buffer.length} bytes)`);
                        return retry.buffer;
                    }
                }
            }

            console.error(`❌ OKKO PDF: Не вдалося отримати PDF. Status: ${resp.status}`);
            return null;
        } catch (error) {
            console.error('❌ OKKO PDF: Error:', error.message);
            return null;
        }
    }
}

module.exports = OkkoScraper;
