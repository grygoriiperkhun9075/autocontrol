/**
 * АвтоКонтроль Server
 * Express сервер з мульти-тенант авторизацією та Telegram Bot інтеграцією
 */

require('dotenv').config({ path: __dirname + '/.env' });

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Auth = require('./auth');
const { getStorage } = require('./storage');
const BotManager = require('./botManager');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Ініціалізація
Auth.init();

// Авто-створення компанії якщо BOT_TOKEN є, але компаній немає
if (process.env.BOT_TOKEN) {
    const companies = Auth.getAllCompanies();
    if (companies.length === 0) {
        // Створюємо дефолтну компанію автоматично
        const defaultPassword = process.env.ADMIN_PASSWORD || 'test1234';
        const result = Auth.register({
            companyName: process.env.COMPANY_NAME || 'AutoControl',
            login: process.env.ADMIN_LOGIN || 'admin',
            password: defaultPassword,
            botToken: process.env.BOT_TOKEN
        });
        if (result.success) {
            console.log(`🏢 Авто-створено компанію "${result.company.name}" з BOT_TOKEN`);

            // Авто-міграція старих даних
            const oldDataFile = path.join(__dirname, 'data.json');
            if (fs.existsSync(oldDataFile)) {
                try {
                    const oldData = JSON.parse(fs.readFileSync(oldDataFile, 'utf-8'));
                    const storage = getStorage(result.company.id);
                    storage.importData(oldData);
                    fs.renameSync(oldDataFile, oldDataFile + '.migrated');
                    console.log('📦 Старі дані мігровано автоматично');
                } catch (e) {
                    console.error('⚠️ Помилка міграції:', e.message);
                }
            }
        }
    } else {
        // Якщо компанія є, але без токена — прив'язати
        const companyWithoutBot = companies.find(c => !c.botToken);
        if (companyWithoutBot) {
            Auth.updateBotToken(companyWithoutBot.id, process.env.BOT_TOKEN);
            console.log(`🔑 BOT_TOKEN прив'язано до "${companyWithoutBot.name}"`);
        }
    }
}

// ========== AUTH ROUTES (без авторизації) ==========

// Сторінка логіну
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'login.html'));
});

// Сторінка реєстрації
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'register.html'));
});

// CSS / JS для сторінок логіну (без авторизації)
app.get('/css/:file', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'css', req.params.file));
});

// API: Логін
app.post('/api/auth/login', (req, res) => {
    const { login, password } = req.body;

    if (!login || !password) {
        return res.status(400).json({ success: false, error: 'Вкажіть логін і пароль' });
    }

    const result = Auth.login(login, password);

    if (!result.success) {
        return res.status(401).json(result);
    }

    // Встановлюємо cookie
    res.setHeader('Set-Cookie',
        `autocontrol_session=${result.token}; Path=/; HttpOnly; Max-Age=${7 * 24 * 60 * 60}; SameSite=Lax`
    );

    res.json({ success: true, company: result.company });
});

// API: Реєстрація
app.post('/api/auth/register', (req, res) => {
    const { companyName, login, password } = req.body;
    let { botToken } = req.body;

    if (!companyName || !login || !password) {
        return res.status(400).json({ success: false, error: 'Заповніть всі обов\'язкові поля' });
    }

    if (password.length < 4) {
        return res.status(400).json({ success: false, error: 'Пароль має бути мінімум 4 символи' });
    }

    // Авто-присвоєння BOT_TOKEN з env якщо не вказано
    if (!botToken && process.env.BOT_TOKEN) {
        botToken = process.env.BOT_TOKEN;
        console.log('🔑 Авто-присвоєно BOT_TOKEN з env');
    }

    const result = Auth.register({ companyName, login, password, botToken });

    if (!result.success) {
        return res.status(400).json(result);
    }

    // Запускаємо бота для нової компанії
    if (botToken) {
        BotManager.startBot(result.company.id, botToken);
    }

    // Авто-міграція старих даних
    const oldDataFile = path.join(__dirname, 'data.json');
    if (fs.existsSync(oldDataFile)) {
        try {
            const oldData = JSON.parse(fs.readFileSync(oldDataFile, 'utf-8'));
            const storage = getStorage(result.company.id);
            storage.importData(oldData);
            fs.renameSync(oldDataFile, oldDataFile + '.migrated');
            console.log('📦 Старі дані мігровано до нової компанії');
        } catch (e) {
            console.error('⚠️ Помилка міграції:', e.message);
        }
    }

    // Автоматичний логін після реєстрації
    const loginResult = Auth.login(login, password);

    res.setHeader('Set-Cookie',
        `autocontrol_session=${loginResult.token}; Path=/; HttpOnly; Max-Age=${7 * 24 * 60 * 60}; SameSite=Lax`
    );

    res.json({ success: true, company: result.company });
});

// API: Логаут
app.post('/api/auth/logout', (req, res) => {
    const cookies = Auth.parseCookies(req.headers.cookie);
    const token = cookies['autocontrol_session'];

    if (token) {
        Auth.logout(token);
    }

    res.setHeader('Set-Cookie',
        'autocontrol_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax'
    );

    res.json({ success: true });
});

// ========== ЗАХИЩЕНІ МАРШРУТИ ==========

// Middleware авторизації для всіх інших маршрутів
app.use(Auth.requireAuth);

// Middleware: додати storage до запиту
app.use((req, res, next) => {
    req.storage = getStorage(req.companyId);
    next();
});

// Статичні файли (після авторизації!)
app.use(express.static(path.join(__dirname, '..')));

// ========== MIGRATION (одноразова міграція старих даних) ==========

app.post('/api/migrate', (req, res) => {
    const oldDataFile = path.join(__dirname, 'data.json');

    if (!fs.existsSync(oldDataFile)) {
        return res.json({ success: false, error: 'Старий файл data.json не знайдено' });
    }

    try {
        const oldData = JSON.parse(fs.readFileSync(oldDataFile, 'utf-8'));
        req.storage.importData(oldData);

        // Перейменовуємо old file щоб не мігрувати повторно
        fs.renameSync(oldDataFile, oldDataFile + '.migrated');

        res.json({
            success: true,
            message: 'Дані мігровано!',
            stats: {
                cars: (oldData.cars || []).length,
                fuel: (oldData.fuel || []).length,
                expenses: (oldData.expenses || []).length,
                coupons: (oldData.coupons || []).length
            }
        });
    } catch (error) {
        res.json({ success: false, error: 'Помилка міграції: ' + error.message });
    }
});

// ========== API Routes ==========

/**
 * GET /api/data - Отримання всіх даних
 */
app.get('/api/data', (req, res) => {
    res.json(req.storage.getAllData());
});

/**
 * GET /api/me - Інформація про поточну компанію
 */
app.get('/api/me', (req, res) => {
    res.json({
        companyId: req.companyId,
        companyName: req.companyName
    });
});

/**
 * GET /api/cars - Отримання списку авто
 */
app.get('/api/cars', (req, res) => {
    res.json(req.storage.getCars());
});

/**
 * POST /api/cars - Додавання авто
 */
app.post('/api/cars', (req, res) => {
    const car = req.storage.addCar(req.body);
    res.json(car);
});

/**
 * GET /api/fuel - Отримання заправок
 */
app.get('/api/fuel', (req, res) => {
    const carId = req.query.carId || null;
    res.json(req.storage.getFuel(carId));
});

/**
 * POST /api/fuel - Додавання заправки
 */
app.post('/api/fuel', (req, res) => {
    const fuel = req.storage.addFuel({
        ...req.body,
        source: 'web'
    });
    res.json(fuel);
});

/**
 * GET /api/expenses - Отримання витрат
 */
app.get('/api/expenses', (req, res) => {
    const carId = req.query.carId || null;
    if (carId) {
        res.json(req.storage.data.expenses.filter(e => e.carId === carId));
    } else {
        res.json(req.storage.data.expenses);
    }
});

/**
 * POST /api/expenses - Додавання витрати
 */
app.post('/api/expenses', (req, res) => {
    const expense = req.storage.addExpense({
        ...req.body,
        source: 'web'
    });
    res.json(expense);
});

// ========== DRIVERS (ВОДІЇ) ==========

app.get('/api/drivers', (req, res) => {
    res.json(req.storage.getDrivers());
});

app.post('/api/drivers', (req, res) => {
    const { chatId, name } = req.body;
    if (!chatId) return res.status(400).json({ error: 'chatId обов\'язковий' });
    const result = req.storage.addDriver(parseInt(chatId) || chatId, name || 'Водій');
    res.json(result);
});

app.delete('/api/drivers/:chatId', (req, res) => {
    const result = req.storage.removeDriver(parseInt(req.params.chatId) || req.params.chatId);
    res.json(result);
});

app.get('/api/drivers/coupon-usage', (req, res) => {
    res.json(req.storage.getDriverCouponUsage());
});

// ========== COUPONS (ТАЛОНИ) ==========

app.get('/api/coupons', (req, res) => {
    res.json(req.storage.getCoupons());
});

app.post('/api/coupons', (req, res) => {
    const coupon = req.storage.addCoupon({
        ...req.body,
        source: req.body.source || 'web'
    });
    res.json(coupon);
});

app.delete('/api/coupons/:id', (req, res) => {
    const deleted = req.storage.deleteCoupon(req.params.id);
    res.json({ success: deleted });
});

// ========== CAR UPDATE ==========

app.put('/api/cars/:id', (req, res) => {
    const car = req.storage.updateCar(req.params.id, req.body);
    if (!car) return res.status(404).json({ error: 'Авто не знайдено' });
    res.json(car);
});

// ========== MAINTENANCE (ТО) ==========

app.get('/api/maintenance', (req, res) => {
    const carId = req.query.carId || null;
    res.json(req.storage.getMaintenance(carId));
});

app.post('/api/maintenance', (req, res) => {
    const record = req.storage.addMaintenance(req.body);
    res.json(record);
});

app.delete('/api/maintenance/:id', (req, res) => {
    const deleted = req.storage.deleteMaintenance(req.params.id);
    res.json({ success: deleted });
});

// ========== DOCUMENTS (ДОКУМЕНТИ) ==========

app.get('/api/documents', (req, res) => {
    const carId = req.query.carId || null;
    res.json(req.storage.getDocuments(carId));
});

app.post('/api/documents', (req, res) => {
    const doc = req.storage.addDocument(req.body);
    res.json(doc);
});

app.put('/api/documents/:id', (req, res) => {
    const doc = req.storage.updateDocument(req.params.id, req.body);
    if (!doc) return res.status(404).json({ error: 'Документ не знайдено' });
    res.json(doc);
});

app.delete('/api/documents/:id', (req, res) => {
    const deleted = req.storage.deleteDocument(req.params.id);
    res.json({ success: deleted });
});

app.get('/api/sync', (req, res) => {
    res.json({
        success: true,
        data: req.storage.getAllData(),
        timestamp: new Date().toISOString()
    });
});

app.post('/api/sync', (req, res) => {
    req.storage.importData(req.body);

    res.json({
        success: true,
        message: 'Дані синхронізовано'
    });
});

// Головна сторінка
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ========== SETTINGS ==========

app.post('/api/settings/bot-token', (req, res) => {
    const { botToken } = req.body;
    if (!botToken) {
        return res.status(400).json({ error: 'Токен не вказано' });
    }

    // Зупинити старого бота
    BotManager.stopBot(req.companyId);

    // Оновити токен
    Auth.updateBotToken(req.companyId, botToken);

    // Запустити нового бота
    BotManager.startBot(req.companyId, botToken);

    res.json({ success: true, message: 'Бот запущено!' });
});

// Запуск ботів для всіх компаній
BotManager.initAll();

// Запуск сервера
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════╗
║       🚗 АвтоКонтроль Server               ║
╠════════════════════════════════════════════╣
║  📡 Сервер запущено на порті ${PORT}           ║
║  🌐 http://localhost:${PORT}                   ║
║  🔐 Мульти-тенант авторизація активна      ║
╚════════════════════════════════════════════╝
    `);
});

// ========== Graceful Shutdown ==========
// Зупиняємо всі боти перед завершенням процесу
// (важливо для Railway — при новому деплої старий процес отримує SIGTERM)
function gracefulShutdown(signal) {
    console.log(`\n🛑 Отримано ${signal}. Зупиняємо ботів...`);
    const Auth = require('./auth');
    const companies = Auth.getAllCompanies();
    for (const company of companies) {
        BotManager.stopBot(company.id);
    }
    console.log('✅ Всі боти зупинені. Завершення процесу.');
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
