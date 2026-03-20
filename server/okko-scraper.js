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
        this.issuedCoupons = new Map(); // date_string -> Set of coupon numbers
        this.tokenTime = 0; // час отримання токену
        this.TOKEN_TTL = 55 * 60 * 1000; // кеш токену 55 хвилин
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
            // Використовуємо кешований токен якщо він є і не прострочений
            if (this.token && (Date.now() - this.tokenTime) < this.TOKEN_TTL) {
                console.log('🔐 OKKO: Токен з кешу (вік: ' + Math.round((Date.now() - this.tokenTime) / 1000) + 'с)');
                return true;
            }

            const body = JSON.stringify({
                login: this.login,
                password: this.password
            });

            // Спроба логіну з ретраями (OKKO може повертати 401 при повторних спробах)
            for (let attempt = 1; attempt <= 3; attempt++) {
                console.log(`🔐 OKKO: Авторизація... (спроба ${attempt}/3)`);

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
                        const authHeader = resp.headers['authorization'];
                        if (authHeader) {
                            this.token = authHeader.replace('Bearer ', '');
                        }
                    }

                    if (!this.token) {
                        if (typeof resp.body === 'string' && resp.body.includes('.') && resp.body.length > 50) {
                            this.token = resp.body.trim().replace(/"/g, '');
                        }
                    }

                    if (this.token) {
                        this.tokenTime = Date.now();
                        console.log(`✅ OKKO: Токен отримано (${this.token.substring(0, 20)}...)`);
                    } else {
                        console.log(`⚠️ OKKO: Login 200, але токен не знайдено`);
                        console.log(`⚠️ OKKO: Body: ${resp.body.substring(0, 300)}`);
                    }
                    return true;
                }

                // 401/403 — чекаємо і пробуємо знову
                if ((resp.status === 401 || resp.status === 403) && attempt < 3) {
                    const delay = attempt * 5000; // 5с, 10с
                    console.log(`⏳ OKKO: Login ${resp.status}, чекаю ${delay / 1000}с перед повтором...`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }

                console.error(`❌ OKKO: Login failed ${resp.status}: ${resp.body.substring(0, 200)}`);
            }

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
                this.token = null; this.tokenTime = 0;
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
     * Знайти талон за номіналом (пропускає вже видані сьогодні)
     */
    findCouponByNominal(liters) {
        const todayKey = new Date().toISOString().split('T')[0];
        const issuedToday = this.issuedCoupons.get(todayKey) || new Set();

        return this.cachedCoupons.find(c =>
            c.nominal === liters && !issuedToday.has(c.number)
        );
    }

    /**
     * Позначити талон як виданий (щоб не видати повторно сьогодні)
     */
    markAsIssued(couponNumber) {
        const todayKey = new Date().toISOString().split('T')[0];
        if (!this.issuedCoupons.has(todayKey)) {
            // Очистити старі дні
            this.issuedCoupons.clear();
            this.issuedCoupons.set(todayKey, new Set());
        }
        this.issuedCoupons.get(todayKey).add(couponNumber);
        console.log(`🔒 Талон ${couponNumber} позначено як виданий (${todayKey})`);
    }

    /**
     * Доступні номінали з кількістю (виключаючи вже видані сьогодні)
     */
    getAvailableNominals() {
        const todayKey = new Date().toISOString().split('T')[0];
        const issuedToday = this.issuedCoupons.get(todayKey) || new Set();
        const nominals = {};
        for (const c of this.cachedCoupons) {
            if (!issuedToday.has(c.number)) {
                nominals[c.nominal] = (nominals[c.nominal] || 0) + 1;
            }
        }
        return nominals;
    }

    /**
     * Номінали з низьким залишком (≤ threshold)
     */
    getLowStockNominals(threshold = 1) {
        const nominals = this.getAvailableNominals();
        const low = [];
        for (const [nominal, count] of Object.entries(nominals)) {
            if (count <= threshold) {
                low.push({ nominal: parseInt(nominal), count });
            }
        }
        return low;
    }

    /**
     * Попередній розрахунок замовлення талонів
     * @param {number} nominal - номінал в літрах (напр. 10, 20, 50)
     * @param {number} quantity - кількість талонів
     * @returns {Object|null} - розрахунок замовлення
     */
    async preorderCoupons(nominal, quantity) {
        try {
            if (!this.token) await this.authenticate();
            if (!this.contractId) await this.findCouponContract();

            console.log(`📋 OKKO Preorder: ${quantity}×${nominal}л...`);

            const body = JSON.stringify({
                amount: nominal * 1000, // API: мілілітри
                contract_id: this.contractId,
                duration: 'M3', // 3 місяці
                group_merch_id: 92,
                product_id: 9018 // Дизельне паливо
            });

            const resp = await this._request(
                `${this.baseUrl}/proxy-service/contract/preorder/coupon`,
                {
                    method: 'POST',
                    body,
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body).toString()
                    }
                }
            );

            console.log(`📋 OKKO Preorder: Status ${resp.status}`);

            if (resp.status === 200) {
                const data = resp.json();
                console.log(`✅ OKKO Preorder: ${JSON.stringify(data)}`);
                return data;
            }

            console.error(`❌ OKKO Preorder: ${resp.status} ${resp.body.substring(0, 500)}`);
            return null;
        } catch (error) {
            console.error('❌ OKKO Preorder error:', error.message);
            return null;
        }
    }

    /**
     * Створення замовлення на талони
     * Реальний ендпоінт: POST /proxy-service/contract/coupon
     * @param {number} nominal - номінал в літрах
     * @param {number} quantity - кількість
     * @returns {Object|null} - створене замовлення
     */
    async createCouponOrder(nominal, quantity) {
        try {
            if (!this.token) await this.authenticate();
            if (!this.contractId) await this.findCouponContract();

            console.log(`🛒 OKKO Order: Створення замовлення ${quantity}×${nominal}л...`);

            // Кожен item = 1 талон; кількість = кількість items
            const orderItems = [];
            for (let i = 0; i < quantity; i++) {
                orderItems.push({
                    amount: nominal * 1000,       // мілілітри
                    duration: 'M3',               // 3 місяці
                    group_merch_id: 92,
                    nominal: nominal * 1000,      // мілілітри
                    product_id: 9018              // Дизельне паливо
                });
            }

            const body = JSON.stringify({
                contract_id: this.contractId,
                order_items: orderItems
            });

            const makeRequest = async () => {
                return await this._request(
                    `${this.baseUrl}/proxy-service/contract/coupon`,
                    {
                        method: 'POST',
                        body,
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(body).toString()
                        }
                    }
                );
            };

            let resp = await makeRequest();
            console.log(`🛒 OKKO Order: Status ${resp.status}`);

            // Re-auth якщо 401
            if (resp.status === 401) {
                console.log('🔄 OKKO Order: Re-auth...');
                this.token = null; this.tokenTime = 0;
                await this.authenticate();
                resp = await makeRequest();
                console.log(`🛒 OKKO Order retry: Status ${resp.status}`);
            }

            if (resp.status === 200 || resp.status === 201) {
                const data = resp.json();
                console.log(`✅ OKKO Order: Замовлення створено! ${JSON.stringify(data).substring(0, 500)}`);
                return data;
            }

            console.error(`❌ OKKO Order: ${resp.status} ${resp.body.substring(0, 500)}`);
            return null;
        } catch (error) {
            console.error('❌ OKKO Order error:', error.message);
            return null;
        }
    }

    /**
     * Отримання PDF рахунку для замовлення
     * 1. GET /proxy-service/payment_requisites — отримуємо реквізити
     * 2. POST /userdata-service/pdf/invoice/coupons — генеруємо PDF
     * @param {Object} order - об'єкт замовлення з createCouponOrder
     * @param {number} nominal - номінал в літрах (для побудови orders масиву)
     * @param {number} quantity - кількість талонів
     * @returns {Buffer|null} - PDF рахунку
     */
    async getOrderInvoicePDF(order, nominal, quantity) {
        try {
            if (!this.token) await this.authenticate();

            const orderId = order.order_id || order.orderId || order.id;
            console.log(`📄 OKKO Invoice: Отримую рахунок для замовлення ${orderId}...`);

            // 1. Отримуємо реквізити оплати
            const reqResp = await this._request(
                `${this.baseUrl}/proxy-service/payment_requisites?contract_id=${this.contractId}&order_id=${orderId}`
            );

            console.log(`📄 OKKO Requisites: Status ${reqResp.status}`);

            if (reqResp.status !== 200) {
                console.error(`❌ OKKO Requisites: ${reqResp.status} ${reqResp.body.substring(0, 300)}`);
                return null;
            }

            const req = reqResp.json();
            console.log(`📄 OKKO Requisites: ${JSON.stringify(req).substring(0, 500)}`);

            // Ціна одного талону = загальна сума / кількість
            const totalAmount = req.amount || 0;
            const pricePerItem = quantity > 0 ? Math.round(totalAmount / quantity) : totalAmount;

            // Формат дати з timezone
            const formatDate = (dateStr) => {
                if (!dateStr) return new Date().toISOString();
                // Додаємо timezone якщо не вказано
                if (!dateStr.includes('+') && !dateStr.includes('Z')) {
                    return dateStr + '+02:00';
                }
                return dateStr;
            };

            // 2. Формуємо запит на PDF рахунку
            const pdfBody = JSON.stringify({
                client_name: req.client_company_name || req.client_name || '',
                company_edrpou: req.company_edrpou || '',
                company_name: req.company_name || '',
                contract_id: this.contractId,
                contract_name: req.contract_name || '24ТЛБЗ-19582/23',
                contract_sale_office: req.contract_sale_office || '3902',
                iban: req.iban || '',
                total_amount: totalAmount,
                expires_date: formatDate(req.expires),
                order_date: formatDate(req.date),
                order_id: String(orderId),
                orders: [{
                    amount: totalAmount,
                    fuel_name: 'Дизельне паливо',
                    price: pricePerItem,
                    volume: (nominal || 50) * 1000
                }]
            });

            console.log(`📄 OKKO Invoice PDF request: ${pdfBody.substring(0, 500)}`);

            const pdfResp = await this._requestBinary(
                `${this.baseUrl}/userdata-service/pdf/invoice/coupons`,
                {
                    method: 'POST',
                    body: pdfBody,
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(pdfBody).toString()
                    }
                }
            );

            console.log(`📄 OKKO Invoice PDF: Status ${pdfResp.status}, Size: ${pdfResp.buffer.length}`);

            if (pdfResp.status === 200 && pdfResp.buffer.length > 100) {
                const header = pdfResp.buffer.toString('utf8', 0, 5);
                if (header === '%PDF-') {
                    console.log(`✅ OKKO Invoice: PDF отримано (${pdfResp.buffer.length} bytes)`);
                    return pdfResp.buffer;
                }
                console.log(`⚠️ OKKO Invoice: Not PDF. Header: ${header}`);
                console.log(`⚠️ Body: ${pdfResp.buffer.toString('utf8', 0, 500)}`);
            }

            return null;
        } catch (error) {
            console.error('❌ OKKO Invoice error:', error.message);
            return null;
        }
    }

    /**
     * Автозамовлення талонів при низькому залишку
     * @param {number} threshold - мінімальна кількість (за замовч. 1)
     * @param {number} orderQuantity - скільки замовляти (за замовч. 10)
     * @returns {Object|null} - результат замовлення
     */
    async autoOrderIfLowStock(threshold = 1, orderQuantity = 10) {
        try {
            const lowStock = this.getLowStockNominals(threshold);
            if (lowStock.length === 0) {
                console.log('✅ OKKO: Всі номінали в достатній кількості');
                return null;
            }

            console.log(`⚠️ OKKO: Низький залишок: ${lowStock.map(i => `${i.nominal}л(${i.count})`).join(', ')}`);

            const results = [];
            for (const item of lowStock) {
                console.log(`🛒 OKKO: Замовляю ${orderQuantity}×${item.nominal}л...`);
                const order = await this.createCouponOrder(item.nominal, orderQuantity);
                if (order) {
                    results.push({ nominal: item.nominal, order });
                }
            }

            return results.length > 0 ? results : null;
        } catch (error) {
            console.error('❌ OKKO AutoOrder error:', error.message);
            return null;
        }
    }

    // ==================== МОНІТОРИНГ БАЛАНСУ КАРТКИ ====================

    /**
     * Отримання балансу для контракту карток
     * @param {string} cardContractId - ID контракту карток (за замовч. 0010043190)
     * @returns {Object|null} - {balance: number (UAH), contractName: string}
     */
    async getContractBalance(cardContractId = '0010043190') {
        try {
            if (!this.token) await this.authenticate();

            console.log(`💳 OKKO: Перевірка балансу контракту ${cardContractId}...`);

            const resp = await this._request(
                `${this.baseUrl}/proxy-service/contracts`
            );

            if (resp.status !== 200) {
                // Re-auth
                if (resp.status === 401) {
                    this.token = null; this.tokenTime = 0;
                    await this.authenticate();
                    const retry = await this._request(`${this.baseUrl}/proxy-service/contracts`);
                    if (retry.status !== 200) {
                        console.error(`❌ OKKO Balance retry: ${retry.status}`);
                        return null;
                    }
                    const contracts = retry.json();
                    const contract = Array.isArray(contracts) ? contracts.find(c => c.contract_id === cardContractId) : null;
                    if (contract) {
                        const balanceUAH = (contract.balance || 0) / 100;
                        console.log(`💳 OKKO Balance: ${balanceUAH} грн (${contract.contract_name || contract.name})`);
                        return { balance: balanceUAH, contractName: contract.contract_name || contract.name || '' };
                    }
                    return null;
                }
                console.error(`❌ OKKO Balance: ${resp.status} ${resp.body.substring(0, 300)}`);
                return null;
            }

            const contracts = resp.json();
            console.log(`💳 OKKO Contracts: ${JSON.stringify(contracts).substring(0, 500)}`);

            if (!Array.isArray(contracts)) {
                console.error('❌ OKKO Balance: Contracts not an array');
                return null;
            }

            const contract = contracts.find(c => c.contract_id === cardContractId);
            if (!contract) {
                console.error(`❌ OKKO Balance: Контракт ${cardContractId} не знайдено`);
                return null;
            }

            const balanceUAH = (contract.balance || 0) / 100;
            console.log(`💳 OKKO Balance: ${balanceUAH} грн (${contract.contract_name || contract.name})`);
            return { balance: balanceUAH, contractName: contract.contract_name || contract.name || '' };
        } catch (error) {
            console.error('❌ OKKO Balance error:', error.message);
            return null;
        }
    }

    /**
     * Генерація PDF рахунку на поповнення контракту карток
     * @param {string} cardContractId - ID контракту
     * @param {number} amountUAH - сума поповнення в грн
     * @returns {Buffer|null} - PDF рахунку
     */
    async generateContractTopUpInvoice(cardContractId = '0010043190', amountUAH = 20000) {
        try {
            if (!this.token) await this.authenticate();

            console.log(`📄 OKKO: Генерую рахунок на ${amountUAH} грн для контракту ${cardContractId}...`);

            // 1. Отримуємо реквізити
            const reqResp = await this._request(
                `${this.baseUrl}/proxy-service/payment_requisites?contract_id=${cardContractId}`
            );

            if (reqResp.status !== 200) {
                console.error(`❌ OKKO Requisites: ${reqResp.status}`);
                return null;
            }

            const req = reqResp.json();
            console.log(`📄 OKKO Requisites: ${JSON.stringify(req).substring(0, 500)}`);

            // 2. Формуємо PDF запит
            const pdfBody = JSON.stringify({
                client_name: req.client_company_name || req.client_name || '',
                company_edrpou: req.company_edrpou || '',
                company_name: req.company_name || '',
                contract_id: cardContractId,
                contract_name: req.contract_name || '24ПК-2658/25',
                contract_sale_office: req.contract_sale_office || '3902',
                iban: req.iban || '',
                total_amount: amountUAH * 100 // в копійках
            });

            console.log(`📄 OKKO TopUp PDF request: ${pdfBody.substring(0, 500)}`);

            const pdfResp = await this._requestBinary(
                `${this.baseUrl}/userdata-service/pdf/invoice/contract`,
                {
                    method: 'POST',
                    body: pdfBody,
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(pdfBody).toString()
                    }
                }
            );

            console.log(`📄 OKKO TopUp PDF: Status ${pdfResp.status}, Size: ${pdfResp.buffer.length}`);

            if (pdfResp.status === 200 && pdfResp.buffer.length > 100) {
                const header = pdfResp.buffer.toString('utf8', 0, 5);
                if (header === '%PDF-') {
                    console.log(`✅ OKKO TopUp: PDF рахунку отримано (${pdfResp.buffer.length} bytes)`);
                    return pdfResp.buffer;
                }
                console.log(`⚠️ OKKO TopUp: Not PDF. Header: ${header}`);
                console.log(`⚠️ Body: ${pdfResp.buffer.toString('utf8', 0, 500)}`);
            }

            return null;
        } catch (error) {
            console.error('❌ OKKO TopUp Invoice error:', error.message);
            return null;
        }
    }

    /**
     * Перевірка балансу контракту карток і автоматичне формування рахунку
     * @param {number} minBalanceUAH - мінімальний баланс (за замовч. 5000)
     * @param {number} topUpAmountUAH - сума поповнення (за замовч. 20000)
     * @returns {Object|null} - {balance, needsTopUp, pdfBuffer}
     */
    async checkCardContractBalance(minBalanceUAH = 5000, topUpAmountUAH = 20000) {
        try {
            const cardContractId = '0010043190';
            const balanceInfo = await this.getContractBalance(cardContractId);

            if (!balanceInfo) {
                console.log('⚠️ OKKO: Не вдалось перевірити баланс');
                return null;
            }

            console.log(`💳 OKKO: Баланс ${balanceInfo.balance} грн (мін: ${minBalanceUAH} грн)`);

            if (balanceInfo.balance >= minBalanceUAH) {
                console.log(`✅ OKKO: Баланс в нормі (${balanceInfo.balance} >= ${minBalanceUAH})`);
                return { balance: balanceInfo.balance, needsTopUp: false, contractName: balanceInfo.contractName };
            }

            console.log(`⚠️ OKKO: Баланс низький! ${balanceInfo.balance} < ${minBalanceUAH}. Формую рахунок...`);

            const pdfBuffer = await this.generateContractTopUpInvoice(cardContractId, topUpAmountUAH);

            return {
                balance: balanceInfo.balance,
                needsTopUp: true,
                contractName: balanceInfo.contractName,
                pdfBuffer,
                topUpAmount: topUpAmountUAH
            };
        } catch (error) {
            console.error('❌ OKKO Card balance check error:', error.message);
            return null;
        }
    }

    /**
     * Отримання історії транзакцій з OKKO
     * Ендпоінт: GET /proxy-service/reports/transactions-history
     * Поля з OKKO B2B: Дата, Операція, Номер картки, ПІБ, АЗК, Тип пального, Літраж, Знижка, Ціна, Сума
     * @param {string} dateFrom - дата початку (YYYY-MM-DD)
     * @param {string} dateTo - дата кінця (YYYY-MM-DD)
     * @returns {Array} масив транзакцій
     */
    async fetchTransactionHistory(dateFrom, dateTo) {
        try {
            if (!this.token) {
                const auth = await this.authenticate();
                if (!auth) {
                    console.error('❌ OKKO Transactions: Не вдалося авторизуватися');
                    return [];
                }
            }

            // Знаходимо контракт
            if (!this.contractId) {
                await this.findCouponContract();
            }

            console.log(`📋 OKKO Transactions: Завантаження за ${dateFrom} — ${dateTo}...`);

            const allTransactions = [];
            let offset = 0;
            const pageSize = 100;
            let hasMore = true;

            while (hasMore) {
                // Правильний ендпоінт: /proxy-service/transactions (НЕ reports/transactions-history)
                // Параметри з підкресленнями: date_from, date_to, offset, size, processed_in_bo
                const url = `${this.baseUrl}/proxy-service/transactions?date_from=${dateFrom}&date_to=${dateTo}&offset=${offset}&size=${pageSize}&processed_in_bo=0`;

                let resp = await this._request(url);

                // Re-auth якщо 401
                if (resp.status === 401) {
                    console.log('🔄 OKKO Transactions: Re-auth...');
                    this.token = null; this.tokenTime = 0;
                    await this.authenticate();
                    resp = await this._request(url);
                }

                if (resp.status !== 200) {
                    console.error(`❌ OKKO Transactions: ${resp.status} ${resp.body.substring(0, 500)}`);
                    break;
                }

                const data = resp.json();
                if (!data) {
                    console.error('❌ OKKO Transactions: Empty response body');
                    break;
                }

                // Логуємо структуру для діагностики (тільки перший раз)
                if (offset === 0) {
                    const keys = Object.keys(data);
                    console.log(`📋 OKKO Transactions: Response keys: [${keys.join(', ')}]`);
                    if (data.total !== undefined) console.log(`📋 OKKO Transactions: total=${data.total}`);
                    if (data.totalElements !== undefined) console.log(`📋 OKKO Transactions: totalElements=${data.totalElements}`);
                }

                // Парсимо відповідь — різні можливі формати
                let items = [];
                if (Array.isArray(data)) {
                    items = data;
                } else if (data.content && Array.isArray(data.content)) {
                    items = data.content;
                } else if (data.transactions && Array.isArray(data.transactions)) {
                    items = data.transactions;
                } else if (data.items && Array.isArray(data.items)) {
                    items = data.items;
                } else if (data.data && Array.isArray(data.data)) {
                    items = data.data;
                } else {
                    // Якщо структура невідома — логуємо і пробуємо знайти масив
                    for (const key of Object.keys(data)) {
                        if (Array.isArray(data[key]) && data[key].length > 0) {
                            items = data[key];
                            console.log(`📋 OKKO Transactions: Знайдено масив у ключі "${key}" (${items.length} елементів)`);
                            break;
                        }
                    }
                }

                // Логуємо ключі першого елементу для діагностики
                if (offset === 0 && items.length > 0) {
                    console.log(`📋 OKKO Transactions: Item keys: [${Object.keys(items[0]).join(', ')}]`);
                    console.log(`📋 OKKO Transactions: Приклад: ${JSON.stringify(items[0]).substring(0, 500)}`);
                }

                // Нормалізуємо кожну транзакцію
                // Поля з OKKO B2B скріншоту: Дата, Операція, Номер картки, ПІБ, АЗК, Тип пального, Літраж, Знижка, Ціна, Сума
                for (const t of items) {
                    allTransactions.push({
                        date: t.transaction_date || t.transactionDate || t.date || t.created_at || '',
                        type: t.transaction_type || t.transactionType || t.type || t.operation || t.operation_type || '',
                        cardNumber: t.card_num || t.cardNum || t.card_number || t.cardNumber || '',
                        driverName: t.person_name || t.personName || t.driver_name || t.driverName || t.name || t.holder_name || t.holderName || '',
                        productName: t.product_name || t.productName || t.fuel_type || t.fuelType || '',
                        volume: parseFloat(t.volume || t.liters || t.amount_volume || t.fuel_volume || t.quantity || 0),
                        discount: parseFloat(t.discount || t.price_discount || t.priceDiscount || 0),
                        price: parseFloat(t.price || t.unit_price || t.price_with_discount || t.priceWithDiscount || 0),
                        sum: parseFloat(t.sum || t.total || t.amount || t.total_sum || t.totalSum || 0),
                        station: t.station_name || t.stationName || t.station || t.azk || t.azk_name || t.azkName || '',
                        status: t.status || '',
                        contractId: t.contract_id || t.contractId || '',
                        rawData: t
                    });
                }

                console.log(`📋 OKKO Transactions: Стор. ${offset / pageSize + 1} — ${items.length} записів`);

                // Перевіряємо чи є ще сторінки
                // Відповідь — масив: якщо менше ніж pageSize — це остання сторінка
                if (items.length < pageSize || items.length === 0) {
                    hasMore = false;
                } else {
                    offset += pageSize;
                }
            }

            console.log(`✅ OKKO Transactions: Всього ${allTransactions.length} транзакцій`);
            return allTransactions;
        } catch (error) {
            console.error('❌ OKKO Transactions error:', error.message);
            return [];
        }
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
                this.token = null; this.tokenTime = 0;
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
