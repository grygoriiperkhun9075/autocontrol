/**
 * АвтоКонтроль Server
 * Express сервер з Telegram Bot інтеграцією
 */

require('dotenv').config({ path: __dirname + '/.env' });

const express = require('express');
const cors = require('cors');
const path = require('path');
const Storage = require('./storage');
const AutoControlBot = require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// Ініціалізація storage
Storage.init();

// Ініціалізація Telegram бота
const bot = new AutoControlBot(process.env.BOT_TOKEN);

// ========== API Routes ==========

/**
 * GET /api/data - Отримання всіх даних
 */
app.get('/api/data', (req, res) => {
    res.json(Storage.getAllData());
});

/**
 * GET /api/cars - Отримання списку авто
 */
app.get('/api/cars', (req, res) => {
    res.json(Storage.getCars());
});

/**
 * POST /api/cars - Додавання авто
 */
app.post('/api/cars', (req, res) => {
    const car = Storage.addCar(req.body);
    res.json(car);
});

/**
 * GET /api/fuel - Отримання заправок
 */
app.get('/api/fuel', (req, res) => {
    const carId = req.query.carId || null;
    res.json(Storage.getFuel(carId));
});

/**
 * POST /api/fuel - Додавання заправки
 */
app.post('/api/fuel', (req, res) => {
    const fuel = Storage.addFuel({
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
        res.json(Storage.data.expenses.filter(e => e.carId === carId));
    } else {
        res.json(Storage.data.expenses);
    }
});

/**
 * POST /api/expenses - Додавання витрати
 */
app.post('/api/expenses', (req, res) => {
    const expense = Storage.addExpense({
        ...req.body,
        source: 'web'
    });
    res.json(expense);
});

/**
 * GET /api/sync - Синхронізація даних з frontend
 */
app.get('/api/sync', (req, res) => {
    res.json({
        success: true,
        data: Storage.getAllData(),
        timestamp: new Date().toISOString()
    });
});

/**
 * POST /api/sync - Імпорт даних з frontend
 */
app.post('/api/sync', (req, res) => {
    const { cars, fuel, expenses, reminders } = req.body;

    if (cars) Storage.data.cars = cars;
    if (fuel) Storage.data.fuel = fuel;
    if (expenses) Storage.data.expenses = expenses;
    if (reminders) Storage.data.reminders = reminders;

    Storage.save();

    res.json({
        success: true,
        message: 'Дані синхронізовано'
    });
});

// Головна сторінка
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════╗
║       🚗 АвтоКонтроль Server               ║
╠════════════════════════════════════════════╣
║  📡 Сервер запущено на порті ${PORT}           ║
║  🌐 http://localhost:${PORT}                   ║
║  ${process.env.BOT_TOKEN ? '🤖 Telegram бот активний' : '⚠️  BOT_TOKEN не вказано'}             ║
╚════════════════════════════════════════════╝
    `);
});
