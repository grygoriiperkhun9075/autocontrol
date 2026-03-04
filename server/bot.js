/**
 * Telegram Bot — Бот для збору даних про заправки
 * Працює з instance-based CompanyStorage
 */

const TelegramBot = require('node-telegram-bot-api');
const MessageParser = require('./parser');
const CouponPDF = require('./coupon-pdf');

class AutoControlBot {
    constructor(token, storage, okkoScraper = null) {
        this.storage = storage;
        this.pendingFuel = new Map(); // chatId -> pending fuel data
        this.okko = okkoScraper;

        if (!token) {
            console.log('⚠️  BOT_TOKEN не вказано. Бот працює в демо-режимі.');
            this.bot = null;
            return;
        }

        this.bot = new TelegramBot(token, {
            polling: {
                interval: 300,
                autoStart: true,
                params: { timeout: 10 }
            }
        });

        // Обробка помилок polling (409 Conflict — два екземпляри бота)
        this.bot.on('polling_error', (error) => {
            if (error.code === 'ETELEGRAM' && error.message.includes('409')) {
                console.warn('⚠️ Bot polling 409 conflict — можливо працює інший екземпляр. Чекаю 5с...');
            } else {
                console.error('❌ Bot polling error:', error.message);
            }
        });

        this.setupHandlers();
        this.setupMenu();

        // Періодична перевірка балансу контракту карток (кожні 4 години)
        this._cardBalanceInterval = setInterval(() => {
            if (this.okko && this.okko.isConfigured()) {
                this.checkAndNotifyCardBalance();
            }
        }, 4 * 60 * 60 * 1000); // 4 години

        // Перша перевірка через 30 секунд після запуску
        setTimeout(() => {
            if (this.okko && this.okko.isConfigured()) {
                console.log('💳 Первинна перевірка балансу карток...');
                this.checkAndNotifyCardBalance();
            }
        }, 30000);

        console.log('🤖 Telegram бот запущено!');
    }

    /**
     * Меню команд (кнопка в лівому нижньому куті чату)
     */
    setupMenu() {
        if (!this.bot) return;
        this.bot.setMyCommands([
            { command: 'start', description: '🚀 Почати роботу' },
            { command: 'help', description: '❓ Допомога' },
            { command: 'coupon', description: '🎫 Отримати талон OKKO (PDF)' },
            { command: 'talons', description: '💰 Купити талони (літри + ціна)' },
            { command: 'stats', description: '📊 Статистика' },
        ]).catch(err => console.error('❌ Помилка встановлення меню:', err.message));
    }

    /**
     * Налаштування обробників
     */
    setupHandlers() {
        if (!this.bot) return;

        // Команда /start
        this.bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            console.log(`👤 /start від ${msg.from?.first_name || 'Unknown'} (Chat ID: ${chatId})`);
            this.bot.sendMessage(chatId, `
🚗 *Вітаю в АвтоКонтроль!*

Я допоможу вам вести облік заправок та витрат на автомобілі.

🆔 Ваш Chat ID: \`${chatId}\`

📝 *Як надсилати дані про заправку:*
\`\`\`
AA 1234 BB
пробіг: 55500
45л по 52.50
\`\`\`

🎫 *Купівля талонів:*
\`/talons 200 52.50\` - 200л по 52.50 грн
\`/talons 100\` - 100л (без ціни)

📋 *Команди:*
/help - Допомога
/cars - Список авто
/stats - Статистика
/talons - Купівля талонів
/coupon - Отримати PDF-талон зі штрих-кодом
            `.trim(), { parse_mode: 'Markdown' });
        });

        // Команда /help
        this.bot.onText(/\/help/, (msg) => {
            const chatId = msg.chat.id;
            this.bot.sendMessage(chatId, `
📋 *Допомога*

*Формат заправки:*
• Номер авто: \`AA 1234 BB\` або \`АА1234ВВ\`
• Пробіг: \`55500\` або \`пробіг: 55500\`
• Заправка: \`45л\` або \`45 літрів\`
• Ціна: \`52.50\` або \`по 52.50 грн\`

*Купівля талонів:*
\`/talons 200 52.50\` - 200л по 52.50 грн/л
\`/talons 100\` - 100л (без ціни)

*Команди:*
/start - Початок роботи
/cars - Мої автомобілі
/stats - Статистика витрат
/talons - Купівля талонів на пальне
            `.trim(), { parse_mode: 'Markdown' });
        });

        // Команда /cars
        this.bot.onText(/\/cars/, (msg) => {
            const chatId = msg.chat.id;
            const cars = this.storage.getCars();

            if (cars.length === 0) {
                this.bot.sendMessage(chatId, '🚗 У вас ще немає автомобілів. Надішліть першу заправку!');
                return;
            }

            const carsList = cars.map(car => {
                const fuelRecords = this.storage.getFuel(car.id);
                const totalFuel = fuelRecords.reduce((sum, f) => sum + (f.liters * f.pricePerLiter), 0);
                return `🚗 *${car.brand} ${car.model}*
   📍 ${car.plate}
   📏 ${car.mileage?.toLocaleString() || 0} км
   ⛽ ${fuelRecords.length} заправок (${totalFuel.toFixed(0)} грн)`;
            }).join('\n\n');

            this.bot.sendMessage(chatId, `*Ваші автомобілі:*\n\n${carsList}`, { parse_mode: 'Markdown' });
        });

        // Команда /stats
        this.bot.onText(/\/stats/, (msg) => {
            const chatId = msg.chat.id;
            const data = this.storage.getAllData();

            const totalFuelCost = data.fuel.reduce((sum, f) => sum + (f.liters * f.pricePerLiter), 0);
            const totalLiters = data.fuel.reduce((sum, f) => sum + f.liters, 0);
            const avgConsumption = data.fuel.filter(f => f.consumption > 0);
            const avg = avgConsumption.length > 0
                ? (avgConsumption.reduce((sum, f) => sum + parseFloat(f.consumption), 0) / avgConsumption.length).toFixed(2)
                : 0;

            this.bot.sendMessage(chatId, `
📊 *Загальна статистика*

🚗 Автомобілів: ${data.cars.length}
⛽ Заправок: ${data.fuel.length}
🛢️ Загалом пального: ${totalLiters.toFixed(1)} л
💰 Витрачено на пальне: ${totalFuelCost.toFixed(0)} грн
📈 Середня витрата: ${avg} л/100км
            `.trim(), { parse_mode: 'Markdown' });
        });

        // Команда /talons - купівля талонів (з аргументами)
        this.bot.onText(/\/talons\s+(.+)/, (msg, match) => {
            this.handleCouponCommand(msg, match[1]);
        });

        // Команда /talons без аргументів — показати інструкцію
        this.bot.onText(/\/talons$/, (msg) => {
            const chatId = msg.chat.id;

            const allCoupons = this.storage.getCoupons();
            const totalPurchased = allCoupons.reduce((sum, c) => sum + (parseFloat(c.liters) || 0), 0);
            const allFuel = this.storage.getFuel();
            const totalUsed = allFuel.reduce((sum, f) => sum + (parseFloat(f.liters) || 0), 0);
            const balance = totalPurchased - totalUsed;

            let reply = `🎫 *Талони на пальне*\n\n`;

            if (allCoupons.length > 0) {
                reply += `📊 *Баланс:*\n`;
                reply += `• Куплено: ${totalPurchased.toFixed(1)} л\n`;
                reply += `• Використано: ${totalUsed.toFixed(1)} л\n`;
                reply += `• Залишок: ${balance >= 0 ? '+' : ''}${balance.toFixed(1)} л\n\n`;
            }

            reply += `📝 *Як додати талони:*\n`;
            reply += `\`/talons 200 52.50\` — 200л по 52.50 грн\n`;
            reply += `\`/talons 100\` — 100л (без ціни)`;

            this.bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
        });

        // Команда /coupon - отримати PDF-талон (тільки авторизовані)
        this.bot.onText(/\/coupon$/, (msg) => {
            if (!this.checkDriverAccess(msg)) return;
            this.handleCouponPDFRequest(msg);
        });

        this.bot.onText(/\/coupon\s+(\d+)/, (msg, match) => {
            if (!this.checkDriverAccess(msg)) return;
            const liters = parseInt(match[1]);
            this.generateAndSendCouponPDF(msg.chat.id, liters);
        });

        // Обробка текстових повідомлень
        this.bot.on('message', (msg) => {
            // Ігноруємо команди
            if (msg.text && msg.text.startsWith('/')) return;

            // Перевірка на талони (природна мова)
            if (msg.text && this.tryParseCoupon(msg)) return;

            this.handleFuelMessage(msg);
        });

        // Обробка фото (для майбутнього OCR)
        this.bot.on('photo', (msg) => {
            const chatId = msg.chat.id;
            this.bot.sendMessage(chatId, '📷 Фото отримано! Розпізнавання чеків поки що в розробці. Будь ласка, введіть дані вручну.');

            // Якщо є caption, спробуємо спарсити
            if (msg.caption) {
                this.handleFuelMessage({ ...msg, text: msg.caption });
            }
        });

        // Обробка натискань на кнопки (спосіб оплати / талони)
        this.bot.on('callback_query', (query) => {
            if (query.data.startsWith('coupon_')) {
                // Перевіряємо авторизацію при натисканні кнопки
                if (!this.storage.isDriverAuthorized(query.message.chat.id)) {
                    this.bot.answerCallbackQuery(query.id, { text: '🚫 У вас немає доступу до талонів', show_alert: true });
                    return;
                }
                const liters = parseInt(query.data.replace('coupon_', ''));
                this.bot.answerCallbackQuery(query.id);
                this.generateAndSendCouponPDF(query.message.chat.id, liters, query.message.message_id);
            } else {
                this.handlePaymentCallback(query);
            }
        });
    }

    /**
     * Обробка повідомлення про заправку
     */
    handleFuelMessage(msg) {
        if (!msg.text || !this.bot) return;

        const chatId = msg.chat.id;
        // Перевірка на примусове підтвердження ("ок")
        const forceOverride = /\bок\b/i.test(msg.text);
        const parsed = MessageParser.parse(msg.text.replace(/\bок\b/gi, '').trim());

        if (!parsed.parsed) {
            this.bot.sendMessage(chatId, `
🤔 Не вдалося розпізнати дані.

Надішліть дані у форматі:
\`AA 1234 BB 55500 45л 52.50\`
            `.trim(), { parse_mode: 'Markdown' });
            return;
        }

        // Валідація
        const validation = MessageParser.validateFuelData(parsed);

        if (!validation.valid) {
            this.bot.sendMessage(chatId, MessageParser.formatError(validation.errors), { parse_mode: 'Markdown' });
            return;
        }

        // Шукаємо авто (тільки існуючі, нові створюються через веб)
        let car = this.storage.findCarByPlate(parsed.plate);

        if (!car) {
            const allCars = this.storage.getCars();
            let availableList = '';
            if (allCars.length > 0) {
                availableList = '\n\n📋 *Доступні авто:*\n' + allCars.map(c => `• \`${c.plate}\` — ${c.brand} ${c.model}`).join('\n');
            }
            this.bot.sendMessage(chatId, `❌ *Авто \`${parsed.plate}\` не знайдено!*\n\nПеревірте правильність номера.${availableList}`, { parse_mode: 'Markdown' });
            return;
        }

        // ========== ВАЛІДАЦІЯ ПРОБІГУ ==========
        const lastMileage = parseInt(car.mileage) || 0;
        const newMileage = parseInt(parsed.mileage) || 0;

        if (newMileage > 0 && lastMileage > 0) {
            // ❌ Пробіг менший за попередній — завжди блокуємо
            if (newMileage < lastMileage) {
                this.bot.sendMessage(chatId, `❌ *Пробіг ${newMileage.toLocaleString()} км менший за попередній ${lastMileage.toLocaleString()} км!*\n\nПеревірте правильність введеного пробігу.\n📏 Останній відомий пробіг: *${lastMileage.toLocaleString()} км*`, { parse_mode: 'Markdown' });
                return;
            }

            // ⚠️ Перевірка витрати — можна обійти через "ок"
            if (!forceOverride) {
                const distance = newMileage - lastMileage;
                const liters = parseFloat(parsed.liters) || 0;

                if (liters > 0 && distance > 0) {
                    const impliedConsumption = (liters / distance) * 100;

                    if (impliedConsumption < 3) {
                        this.bot.sendMessage(chatId, `⚠️ *Можлива помилка в пробігу!*\n\n📏 Попередній: ${lastMileage.toLocaleString()} км\n📏 Введений: ${newMileage.toLocaleString()} км\n📐 Різниця: *${distance.toLocaleString()} км*\n⛽ Пальне: ${liters} л\n📊 Витрата: *${impliedConsumption.toFixed(1)} л/100км* — занадто мало!\n\nЯкщо все вірно, надішліть ще раз з додаванням слова *ок*`, { parse_mode: 'Markdown' });
                        return;
                    }

                    if (impliedConsumption > 30) {
                        this.bot.sendMessage(chatId, `⚠️ *Можлива помилка в пробігу!*\n\n📏 Попередній: ${lastMileage.toLocaleString()} км\n📏 Введений: ${newMileage.toLocaleString()} км\n📐 Різниця: *${distance.toLocaleString()} км*\n⛽ Пальне: ${liters} л\n📊 Витрата: *${impliedConsumption.toFixed(1)} л/100км* — занадто багато!\n\nЯкщо все вірно, надішліть ще раз з додаванням слова *ок*`, { parse_mode: 'Markdown' });
                        return;
                    }
                }
            }
        }

        // Зберігаємо дані як pending і запитуємо спосіб оплати
        this.pendingFuel.set(chatId, {
            carId: car.id,
            liters: parsed.liters,
            pricePerLiter: parsed.pricePerLiter,
            mileage: parsed.mileage,
            station: parsed.station,
            fullTank: parsed.fullTank,
            parsed: parsed,
            driverChatId: chatId,
            driverName: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'Водій'
        });

        const summary = `🚗 *${car.plate}*\n📏 Пробіг: ${parsed.mileage?.toLocaleString() || '—'} км\n⛽ ${parsed.liters} л по ${parsed.pricePerLiter} грн\n💰 Сума: ${(parsed.liters * parsed.pricePerLiter).toFixed(2)} грн`;

        this.bot.sendMessage(chatId, `${summary}\n\n💳 *Оберіть спосіб оплати:*`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🎫 Талони', callback_data: 'pay_coupon' },
                        { text: '💵 Готівка', callback_data: 'pay_cash' }
                    ]
                ]
            }
        });
    }

    /**
     * Обробка натискання кнопки оплати
     */
    handlePaymentCallback(query) {
        if (!this.bot) return;
        const chatId = query.message.chat.id;
        const data = query.data;

        // Відповідаємо на callback щоб прибрати "годинник"
        this.bot.answerCallbackQuery(query.id);

        const pending = this.pendingFuel.get(chatId);
        if (!pending) {
            this.bot.editMessageText('⏰ Час вибору вичерпано. Надішліть дані заправки ще раз.', {
                chat_id: chatId,
                message_id: query.message.message_id
            });
            return;
        }

        // Визначаємо спосіб оплати
        const paymentMethod = data === 'pay_cash' ? 'cash' : 'coupon';
        this.pendingFuel.delete(chatId);

        // Зберігаємо заправку
        const fuel = this.storage.addFuel({
            carId: pending.carId,
            liters: pending.liters,
            pricePerLiter: pending.pricePerLiter,
            mileage: pending.mileage,
            station: pending.station,
            fullTank: pending.fullTank,
            paymentMethod: paymentMethod,
            driverChatId: pending.driverChatId,
            driverName: pending.driverName
        });

        const payLabel = paymentMethod === 'cash' ? '💵 Готівка' : '🎫 Талони';
        let confirmText = `✅ *Заправку записано!*\n\n`;
        confirmText += `🚗 ${pending.parsed.plate}\n`;
        confirmText += `📏 Пробіг: ${pending.parsed.mileage?.toLocaleString() || '—'} км\n`;
        confirmText += `⛽ ${pending.liters} л по ${pending.pricePerLiter} грн\n`;
        confirmText += `💰 Сума: ${(pending.liters * pending.pricePerLiter).toFixed(2)} грн\n`;
        confirmText += `💳 Оплата: *${payLabel}*`;

        if (fuel.consumption > 0) {
            confirmText += `\n📊 Витрата: ${fuel.consumption} л/100км`;
        }

        // Показуємо баланс талонів якщо оплата талонами (і не ввімкнено пріоритет карт)
        const settings = this.storage.getSettings ? this.storage.getSettings() : {};
        if (paymentMethod === 'coupon' && !settings.fuelCardPriority) {
            const balance = this.getCouponBalance();
            confirmText += `\n\n🎫 Залишок талонів: *${balance.toFixed(1)} л*`;
        }

        this.bot.editMessageText(confirmText, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown'
        });
    }

    /**
     * Розрахунок балансу талонів (куплено - використано талонами)
     */
    getCouponBalance() {
        // Якщо пріоритет паливних карт — не контролюємо баланс талонів
        const settings = this.storage.getSettings ? this.storage.getSettings() : {};
        if (settings.fuelCardPriority) return Infinity;

        const allCoupons = this.storage.getCoupons();
        const totalPurchased = allCoupons.reduce((sum, c) => sum + (parseFloat(c.liters) || 0), 0);
        const allFuel = this.storage.getFuel();
        // Враховуємо тільки заправки оплачені талонами (не готівкою)
        const totalUsed = allFuel
            .filter(f => f.paymentMethod !== 'cash')
            .reduce((sum, f) => sum + (parseFloat(f.liters) || 0), 0);
        return totalPurchased - totalUsed;
    }

    // ========== АВТОРИЗАЦІЯ ВОДІЇВ ==========

    /**
     * Перевірка чи є адміністратором
     */
    isAdmin(chatId) {
        const adminId = process.env.ADMIN_CHAT_ID;
        if (adminId) return chatId.toString() === adminId.toString();
        // Якщо ADMIN_CHAT_ID не задано — перший водій в списку є адміном
        const drivers = this.storage.getDrivers();
        if (drivers.length > 0) return drivers[0].chatId === chatId;
        return true; // Якщо список порожній — всі адміни
    }

    /**
     * Перевірка доступу водія до талонів
     */
    checkDriverAccess(msg) {
        const chatId = msg.chat.id;
        if (this.storage.isDriverAuthorized(chatId)) return true;

        const driverName = msg.from?.first_name || 'Водій';
        this.bot.sendMessage(chatId,
            `🚫 *${driverName}, у вас немає доступу до талонів*\n\n` +
            `Ваш ID: \`${chatId}\`\n\n` +
            `Зверніться до адміністратора для авторизації.`,
            { parse_mode: 'Markdown' }
        );
        return false;
    }

    /**
     * Обробка запиту на PDF-талон — показує доступні талони з OKKO
     */
    async handleCouponPDFRequest(msg) {
        if (!this.bot) return;
        const chatId = msg.chat.id;

        // Якщо є OKKO scraper — показуємо реальні талони
        if (this.okko && this.okko.isConfigured()) {
            this.bot.sendMessage(chatId, '⏳ Отримую талони з OKKO...');

            try {
                const coupons = await this.okko.fetchActiveCoupons();

                if (!coupons || coupons.length === 0) {
                    this.bot.sendMessage(chatId, '❌ *Немає активних талонів в OKKO*\n\nПеревірте особистий кабінет ssp-online.okko.ua', { parse_mode: 'Markdown' });
                    return;
                }

                // Групуємо по номіналу
                const nominals = this.okko.getAvailableNominals();
                const keyboard = [];
                let row = [];

                for (const [nom, count] of Object.entries(nominals).sort((a, b) => a[0] - b[0])) {
                    row.push({ text: `⛽ ${nom} л (${count} шт)`, callback_data: `coupon_${nom}` });
                    if (row.length === 2) {
                        keyboard.push(row);
                        row = [];
                    }
                }
                if (row.length > 0) keyboard.push(row);

                let text = `🎫 *Талони OKKO*\n\nДоступні талони:\n`;
                for (const [nom, count] of Object.entries(nominals).sort((a, b) => a[0] - b[0])) {
                    text += `• ${nom} л — *${count} шт*\n`;
                }
                text += `\nОберіть номінал:`;

                this.bot.sendMessage(chatId, text, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: keyboard }
                });
            } catch (error) {
                console.error('❌ OKKO fetch error:', error);
                this.bot.sendMessage(chatId, '❌ Помилка підключення до OKKO. Спробуйте пізніше.');
            }
            return;
        }

        // Fallback — якщо OKKO не налаштоване
        this.bot.sendMessage(chatId, '❌ *OKKO не налаштовано*\n\nДодайте змінні `OKKO_LOGIN` та `OKKO_PASSWORD` в налаштуваннях.', { parse_mode: 'Markdown' });
    }

    /**
     * Відправка оригінального PDF-талону з OKKO SSP
     * Спочатку намагається отримати оригінальний PDF з OKKO API
     * Якщо не вдається — генерує локально
     */
    async generateAndSendCouponPDF(chatId, liters, messageId = null) {
        if (!this.bot) return;

        // Оновлюємо повідомлення
        if (messageId) {
            this.bot.editMessageText(`⏳ *Готую талон на ${liters} л...*`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown'
            }).catch(() => { });
        }

        try {
            if (this.okko && this.okko.isConfigured()) {
                await this.okko.fetchActiveCoupons();

                const coupon = this.okko.findCouponByNominal(liters);
                if (!coupon) {
                    this.bot.sendMessage(chatId, `❌ *Немає талону на ${liters} л!*\n\nДоступні номінали: ${Object.keys(this.okko.getAvailableNominals()).join(', ')} л`, { parse_mode: 'Markdown' });
                    return;
                }

                const formattedNum = CouponPDF._formatNumber ?
                    CouponPDF._formatNumber(coupon.number) : coupon.number;

                // === СПРОБА 1: Оригінальний PDF з OKKO SSP ===
                let pdfBuffer = null;
                try {
                    pdfBuffer = await this.okko.fetchCouponPDF(coupon);
                    if (pdfBuffer) {
                        console.log(`✅ Відправляю оригінальний OKKO PDF (${pdfBuffer.length} bytes)`);
                    }
                } catch (err) {
                    console.error('⚠️ Не вдалося отримати оригінальний PDF:', err.message);
                }

                // === СПРОБА 2: Генеруємо локально (fallback) ===
                if (!pdfBuffer) {
                    console.log('📄 Fallback: генерую PDF локально...');
                    pdfBuffer = await CouponPDF.generate({
                        liters: coupon.nominal,
                        couponNumber: coupon.number,
                        qrData: coupon.qr || coupon.number,
                        validUntil: coupon.validTo,
                        fuelType: coupon.fuelType || 'Дизельне паливо'
                    });
                }

                // Відправляємо PDF
                await this.bot.sendDocument(chatId, pdfBuffer, {
                    caption: `🎫 *Талон OKKO на ${coupon.nominal} л*\n⛽ ${coupon.fuelType || 'Дизельне паливо'}\n📅 Дійсний до: ${coupon.validTo}\n🔢 ${formattedNum}\n\n_Покажіть штрих-код касиру на АЗС OKKO_`,
                    parse_mode: 'Markdown'
                }, {
                    filename: `OKKO_${coupon.nominal}L_${coupon.number.slice(-4)}.pdf`,
                    contentType: 'application/pdf'
                });

                // Позначаємо талон як виданий (щоб не видати повторно сьогодні)
                this.okko.markAsIssued(coupon.number);

                // Перевіряємо залишок талонів і повідомляємо адміна
                this.checkAndNotifyLowStock();
                // Перевіряємо баланс контракту карток
                this.checkAndNotifyCardBalance();

                if (messageId) {
                    this.bot.editMessageText(`✅ *Талон на ${coupon.nominal} л відправлено!*`, {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown'
                    }).catch(() => { });
                }
            } else {
                this.bot.sendMessage(chatId, '❌ OKKO не налаштовано.');
            }
        } catch (error) {
            console.error('❌ Помилка генерації талону:', error);
            this.bot.sendMessage(chatId, '❌ Помилка генерації талону. Спробуйте ще раз.');
        }
    }

    /**
     * Перевірка залишку талонів і повідомлення адміну
     */
    async checkAndNotifyLowStock() {
        if (!this.bot || !this.okko) return;

        // Якщо пріоритет паливних карт — не контролюємо залишок талонів
        const settings = this.storage.getSettings ? this.storage.getSettings() : {};
        if (settings.fuelCardPriority) return;

        const adminId = process.env.ADMIN_CHAT_ID || '1324474106';
        if (!adminId) return;

        try {
            const lowStock = this.okko.getLowStockNominals(1);
            if (lowStock.length === 0) return;

            // Дебаунс: не більше 1 замовлення на номінал на день
            const todayKey = new Date().toISOString().split('T')[0];
            if (!this._lowStockNotified) this._lowStockNotified = new Map();

            const newLow = lowStock.filter(item => {
                const key = `${todayKey}_${item.nominal}`;
                if (this._lowStockNotified.has(key)) return false;
                this._lowStockNotified.set(key, true);
                return true;
            });

            if (newLow.length === 0) return;

            // Очищаємо старі записи
            for (const [key] of this._lowStockNotified) {
                if (!key.startsWith(todayKey)) this._lowStockNotified.delete(key);
            }

            // Спробуємо автозамовлення
            for (const item of newLow) {
                const orderQty = 10;
                let text = `⚠️ *Низький залишок талонів ${item.nominal}л!*\n`;
                text += `Залишилось: ${item.count} шт\n\n`;

                try {
                    // Створюємо замовлення
                    text += `🛒 _Створюю замовлення на ${orderQty}×${item.nominal}л..._\n`;
                    await this.bot.sendMessage(adminId, text, { parse_mode: 'Markdown' });

                    const order = await this.okko.createCouponOrder(item.nominal, orderQty);

                    if (order) {
                        const orderId = order.order_id || order.orderId || order.id || 'N/A';
                        let successText = `✅ *Замовлення створено!*\n`;
                        successText += `🛒 ${orderQty}×${item.nominal}л\n`;
                        successText += `📋 ID: ${orderId}\n\n`;

                        // Спробуємо отримати PDF рахунку
                        try {
                            const invoicePDF = await this.okko.getOrderInvoicePDF(order, item.nominal, orderQty);
                            if (invoicePDF) {
                                await this.bot.sendDocument(adminId, invoicePDF, {
                                    caption: `📄 *Рахунок на оплату*\n${orderQty}×${item.nominal}л талонів OKKO\n\n_Оплатіть цей рахунок для отримання талонів_`,
                                    parse_mode: 'Markdown'
                                }, {
                                    filename: `OKKO_invoice_${item.nominal}L_x${orderQty}.pdf`,
                                    contentType: 'application/pdf'
                                });
                                console.log(`✅ Рахунок відправлено адміну`);
                            } else {
                                successText += `⚠️ Не вдалося отримати PDF рахунку\n`;
                                successText += `🔗 [Перевірте рахунки на OKKO SSP](https://ssp-online.okko.ua)\n`;
                                this.bot.sendMessage(adminId, successText, {
                                    parse_mode: 'Markdown',
                                    disable_web_page_preview: true
                                });
                            }
                        } catch (pdfError) {
                            successText += `⚠️ Помилка отримання рахунку: ${pdfError.message}\n`;
                            successText += `🔗 [Перевірте рахунки](https://ssp-online.okko.ua)\n`;
                            this.bot.sendMessage(adminId, successText, {
                                parse_mode: 'Markdown',
                                disable_web_page_preview: true
                            });
                        }
                    } else {
                        // Автозамовлення не вдалось — ручне повідомлення
                        let failText = `❌ *Автозамовлення не вдалось*\n`;
                        failText += `Талон: ${item.nominal}л, залишок: ${item.count} шт\n\n`;
                        failText += `🔗 [Замовити вручну на OKKO SSP](https://ssp-online.okko.ua)\n`;
                        failText += `💡 _SSP → Замовлення → Нове замовлення → Додати талон_`;
                        this.bot.sendMessage(adminId, failText, {
                            parse_mode: 'Markdown',
                            disable_web_page_preview: true
                        });
                    }
                } catch (orderError) {
                    console.error(`❌ Auto-order error for ${item.nominal}л:`, orderError.message);
                    let errText = `❌ *Помилка автозамовлення ${item.nominal}л*\n`;
                    errText += `${orderError.message}\n\n`;
                    errText += `🔗 [Замовити вручну](https://ssp-online.okko.ua)`;
                    this.bot.sendMessage(adminId, errText, {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true
                    });
                }
            }

            console.log(`📢 Обробка низького залишку завершена`);
        } catch (error) {
            console.error('❌ Low stock check error:', error.message);
        }
    }

    /**
     * Перевірка балансу контракту карток (24ПК-2658/25)
     * Якщо баланс < 5000 грн — формує рахунок на 20000 грн
     */
    async checkAndNotifyCardBalance() {
        if (!this.bot || !this.okko) return;

        const adminId = process.env.ADMIN_CHAT_ID || '1324474106';
        if (!adminId) return;

        try {
            // Дебаунс: не більше 1 перевірки на день
            const todayKey = new Date().toISOString().split('T')[0];
            if (!this._cardBalanceNotified) this._cardBalanceNotified = '';
            if (this._cardBalanceNotified === todayKey) return;

            const result = await this.okko.checkCardContractBalance(5000, 20000);
            if (!result) return;

            if (!result.needsTopUp) {
                console.log(`💳 Баланс карток в нормі: ${result.balance} грн`);
                return;
            }

            // Позначаємо що сьогодні вже повідомили
            this._cardBalanceNotified = todayKey;

            let text = `⚠️ *Низький баланс контракту карток!*\n\n`;
            text += `💳 Контракт: *${result.contractName || '24ПК-2658/25'}*\n`;
            text += `💰 Баланс: *${result.balance.toFixed(2)} грн*\n`;
            text += `📉 Мінімум: 5 000 грн\n\n`;

            if (result.pdfBuffer) {
                text += `✅ Рахунок на *20 000 грн* сформовано!`;

                await this.bot.sendMessage(adminId, text, { parse_mode: 'Markdown' });

                await this.bot.sendDocument(adminId, result.pdfBuffer, {
                    caption: `📄 *Рахунок на поповнення*\nКонтракт: ${result.contractName || '24ПК-2658/25'}\nСума: 20 000 грн\n\n_Оплатіть для поповнення балансу карток_`,
                    parse_mode: 'Markdown'
                }, {
                    filename: `OKKO_topup_20000_${todayKey}.pdf`,
                    contentType: 'application/pdf'
                });

                console.log(`📢 Рахунок на поповнення карток відправлено адміну`);
            } else {
                text += `❌ Не вдалось сформувати рахунок автоматично\n`;
                text += `🔗 [Сформувати вручну на OKKO SSP](https://ssp-online.okko.ua)`;

                await this.bot.sendMessage(adminId, text, {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                });
            }
        } catch (error) {
            console.error('❌ Card balance check error:', error.message);
        }
    }

    /**
     * Обробка команди /talons (купівля талонів)
     */
    handleCouponCommand(msg, args) {
        if (!this.bot) return;
        const chatId = msg.chat.id;

        const parts = args.trim().split(/\s+/);
        const liters = parseFloat(parts[0]);
        const pricePerLiter = parts.length > 1 ? parseFloat(parts[1]) : 0;

        if (isNaN(liters) || liters <= 0) {
            this.bot.sendMessage(chatId, `
❌ *Невірний формат*

Використовуйте:
\`/talons 200 52.50\` - 200л по 52.50 грн
\`/talons 100\` - 100л (без ціни)
            `.trim(), { parse_mode: 'Markdown' });
            return;
        }

        this.storage.addCoupon({
            liters: liters,
            pricePerLiter: pricePerLiter,
            source: 'telegram'
        });

        const totalCost = pricePerLiter > 0 ? `\n💰 Сума: ${(liters * pricePerLiter).toFixed(2)} грн` : '';
        const balance = this.getCouponBalance();

        this.bot.sendMessage(chatId, `
✅ *Талони зареєстровано!*

🎫 Куплено: *${liters} л*${pricePerLiter > 0 ? `\n💵 Ціна: ${pricePerLiter.toFixed(2)} грн/л` : ''}${totalCost}

📊 *Баланс талонів:* *${balance >= 0 ? '+' : ''}${balance.toFixed(1)} л*
        `.trim(), { parse_mode: 'Markdown' });
    }

    /**
     * Спроба розпізнати повідомлення як талони (природна мова)
     * Підтримує: "талони 200 52.50", "купівля талонів 200л по 52.50",
     * "талон 100", "Талони: 200 літрів по 52.50 грн" тощо
     */
    tryParseCoupon(msg) {
        if (!this.bot) return false;
        const text = msg.text.toLowerCase().trim();

        // Перевіряємо чи є ключові слова талонів
        const couponKeywords = /(?:талон[иі]?|купівля\s+талон[іи]в|куплен[оі]\s+талон[иі])/i;
        if (!couponKeywords.test(text)) return false;

        // Витягуємо числа з тексту
        // Шукаємо літри і ціну в різних форматах
        const numbers = [];
        const numberRegex = /(\d+(?:[.,]\d+)?)/g;
        let match;
        while ((match = numberRegex.exec(text)) !== null) {
            numbers.push(parseFloat(match[1].replace(',', '.')));
        }

        if (numbers.length === 0) {
            // Ключове слово є, але чисел немає — показуємо інструкцію
            const chatId = msg.chat.id;
            this.bot.sendMessage(chatId, `
🎫 *Щоб додати талони, вкажіть кількість літрів:*

Приклади:
• \`талони 200 52.50\` — 200л по 52.50 грн
• \`талони 100\` — 100л
• \`/talons 200 52.50\`
            `.trim(), { parse_mode: 'Markdown' });
            return true;
        }

        const liters = numbers[0];
        const pricePerLiter = numbers.length > 1 ? numbers[1] : 0;

        if (liters <= 0) return false;

        // Використовуємо handleCouponCommand
        this.handleCouponCommand(msg, `${liters} ${pricePerLiter}`);
        return true;
    }
}

module.exports = AutoControlBot;
