/**
 * Telegram Bot — Бот для збору даних про заправки
 * Працює з instance-based CompanyStorage
 */

const TelegramBot = require('node-telegram-bot-api');
const MessageParser = require('./parser');

class AutoControlBot {
    constructor(token, storage) {
        this.storage = storage;

        if (!token) {
            console.log('⚠️  BOT_TOKEN не вказано. Бот працює в демо-режимі.');
            this.bot = null;
            return;
        }

        this.bot = new TelegramBot(token, { polling: true });
        this.setupHandlers();
        console.log('🤖 Telegram бот запущено!');
    }

    /**
     * Налаштування обробників
     */
    setupHandlers() {
        if (!this.bot) return;

        // Команда /start
        this.bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            this.bot.sendMessage(chatId, `
🚗 *Вітаю в АвтоКонтроль!*

Я допоможу вам вести облік заправок та витрат на автомобілі.

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

        // Команда /talons - купівля талонів
        this.bot.onText(/\/talons\s+(.+)/, (msg, match) => {
            this.handleCouponCommand(msg, match[1]);
        });

        // Обробка текстових повідомлень
        this.bot.on('message', (msg) => {
            // Ігноруємо команди
            if (msg.text && msg.text.startsWith('/')) return;

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
    }

    /**
     * Обробка повідомлення про заправку
     */
    handleFuelMessage(msg) {
        if (!msg.text || !this.bot) return;

        const chatId = msg.chat.id;
        const parsed = MessageParser.parse(msg.text);

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

        // Шукаємо або створюємо авто
        let car = this.storage.findCarByPlate(parsed.plate);

        if (!car) {
            car = this.storage.addCar({
                brand: 'Авто',
                model: parsed.plate,
                plate: parsed.plate,
                mileage: parsed.mileage
            });
            this.bot.sendMessage(chatId, `🆕 Додано нове авто: \`${parsed.plate}\``, { parse_mode: 'Markdown' });
        }

        // Додаємо заправку
        const fuel = this.storage.addFuel({
            carId: car.id,
            liters: parsed.liters,
            pricePerLiter: parsed.pricePerLiter,
            mileage: parsed.mileage,
            station: parsed.station,
            fullTank: parsed.fullTank
        });

        // Підтвердження
        const confirmation = MessageParser.formatConfirmation({
            ...parsed,
            consumption: fuel.consumption
        });

        this.bot.sendMessage(chatId, confirmation + (fuel.consumption > 0 ? `\n📊 Витрата: ${fuel.consumption} л/100км` : ''),
            { parse_mode: 'Markdown' });
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

        const allCoupons = this.storage.getCoupons();
        const totalPurchased = allCoupons.reduce((sum, c) => sum + c.liters, 0);
        const allFuel = this.storage.getFuel();
        const totalUsed = allFuel.reduce((sum, f) => sum + f.liters, 0);
        const balance = totalPurchased - totalUsed;

        this.bot.sendMessage(chatId, `
✅ *Талони зареєстровано!*

🎫 Куплено: *${liters} л*${pricePerLiter > 0 ? `\n💵 Ціна: ${pricePerLiter.toFixed(2)} грн/л` : ''}${totalCost}

📊 *Баланс талонів:*
• Всього куплено: ${totalPurchased.toFixed(1)} л
• Використано: ${totalUsed.toFixed(1)} л
• Залишок: ${balance >= 0 ? '+' : ''}${balance.toFixed(1)} л
        `.trim(), { parse_mode: 'Markdown' });
    }
}

module.exports = AutoControlBot;
