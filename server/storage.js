/**
 * CompanyStorage — Per-company data storage
 * Кожна компанія має свій файл data/{companyId}.json
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

class CompanyStorage {
    constructor(companyId) {
        this.companyId = companyId;
        this.dataFile = path.join(DATA_DIR, `${companyId}.json`);
        this.data = {
            cars: [],
            fuel: [],
            expenses: [],
            reminders: [],
            coupons: [],
            authorizedDrivers: [] // [{chatId, name, addedAt}]
        };
        this.load();
    }

    /**
     * Завантаження даних з файлу
     */
    load() {
        try {
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
            if (fs.existsSync(this.dataFile)) {
                const content = fs.readFileSync(this.dataFile, 'utf-8');
                this.data = JSON.parse(content);
            } else {
                this.save();
            }
        } catch (error) {
            console.error(`❌ [${this.companyId}] Помилка завантаження:`, error);
        }
    }

    /**
     * Збереження даних
     */
    save() {
        try {
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
            fs.writeFileSync(this.dataFile, JSON.stringify(this.data, null, 2), 'utf-8');
        } catch (error) {
            console.error(`❌ [${this.companyId}] Помилка збереження:`, error);
        }
    }

    /**
     * Генерація ID
     */
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    /**
     * Видалення дублікатів авто з однаковими номерами
     * Об'єднує записи заправок з дублікатів у головне авто
     */
    deduplicateCars() {
        const seen = new Map(); // normalizedPlate -> car
        const duplicates = [];

        for (const car of this.data.cars) {
            const norm = CompanyStorage.normalizePlate(car.plate || '');
            if (!norm) continue;

            if (seen.has(norm)) {
                // Дублікат — переносимо заправки на головне авто
                const mainCar = seen.get(norm);
                const fuelForDup = this.data.fuel.filter(f => f.carId === car.id);
                fuelForDup.forEach(f => { f.carId = mainCar.id; });

                // Оновлюємо пробіг якщо в дублікаті більший
                if ((parseInt(car.mileage) || 0) > (parseInt(mainCar.mileage) || 0)) {
                    mainCar.mileage = parseInt(car.mileage) || 0;
                }

                // Нормалізуємо номер головного авто
                mainCar.plate = CompanyStorage.formatPlate(norm);

                duplicates.push(car.id);
                console.log(`🔄 Об'єднано дублікат "${car.plate}" → "${mainCar.plate}" (${fuelForDup.length} заправок)`);
            } else {
                seen.set(norm, car);
            }
        }

        if (duplicates.length > 0) {
            this.data.cars = this.data.cars.filter(c => !duplicates.includes(c.id));
            // Нормалізуємо номери всіх авто
            this.data.cars.forEach(car => {
                const norm = CompanyStorage.normalizePlate(car.plate || '');
                car.plate = CompanyStorage.formatPlate(norm);
            });
            this.save();
            console.log(`✅ Видалено ${duplicates.length} дублікатів авто`);
        }
    }

    // ========== CARS ==========

    /**
     * Нормалізація номера авто: кирилиця→латиниця, uppercase, без пробілів
     * "вс 9348 тм" → "BC9348TM"
     */
    static normalizePlate(plate) {
        // Таблиця кирилиця → латиниця (візуально однакові літери)
        const cyrToLat = {
            'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H',
            'І': 'I', 'К': 'K', 'М': 'M', 'О': 'O', 'Р': 'P',
            'Т': 'T', 'Х': 'X'
        };
        return plate
            .replace(/\s+/g, '')
            .toUpperCase()
            .split('')
            .map(ch => cyrToLat[ch] || ch)
            .join('');
    }

    /**
     * Форматування номера для відображення: "BC9348TM" → "BC 9348 TM"
     */
    static formatPlate(normalizedPlate) {
        return normalizedPlate.replace(/^([A-Z]{2})(\d{4})([A-Z]{2})$/, '$1 $2 $3') || normalizedPlate;
    }

    getCars() {
        return this.data.cars;
    }

    findCarByPlate(plate) {
        const normalizedPlate = CompanyStorage.normalizePlate(plate);
        return this.data.cars.find(car => {
            const carPlate = CompanyStorage.normalizePlate(car.plate || '');
            return carPlate === normalizedPlate;
        });
    }

    findCarById(id) {
        return this.data.cars.find(car => car.id === id);
    }

    // ========== AUTHORIZED DRIVERS ==========

    addDriver(chatId, name) {
        if (!this.data.authorizedDrivers) this.data.authorizedDrivers = [];
        const existing = this.data.authorizedDrivers.find(d => d.chatId === chatId);
        if (existing) return { success: false, reason: 'already_exists' };
        const driver = { chatId, name: name || 'Водій', addedAt: new Date().toISOString() };
        this.data.authorizedDrivers.push(driver);
        this.save();
        return { success: true, driver };
    }

    removeDriver(chatId) {
        if (!this.data.authorizedDrivers) return { success: false };
        const idx = this.data.authorizedDrivers.findIndex(d => d.chatId === chatId);
        if (idx === -1) return { success: false, reason: 'not_found' };
        const removed = this.data.authorizedDrivers.splice(idx, 1)[0];
        this.save();
        return { success: true, driver: removed };
    }

    getDrivers() {
        return this.data.authorizedDrivers || [];
    }

    isDriverAuthorized(chatId) {
        if (!this.data.authorizedDrivers || this.data.authorizedDrivers.length === 0) return true; // Якщо список порожній — дозволяємо всім
        return this.data.authorizedDrivers.some(d => d.chatId === chatId);
    }

    /**
     * Використання талонів по водіях
     * Повертає масив: { driverChatId, driverName, carId, carPlate, liters, count, lastDate }
     */
    getDriverCouponUsage() {
        const couponFuel = (this.data.fuel || []).filter(f => f.paymentMethod === 'coupon');
        const drivers = this.data.authorizedDrivers || [];
        const cars = this.data.cars || [];

        // Групуємо по водій + авто
        const usageMap = {};
        for (const f of couponFuel) {
            const key = `${f.driverChatId || 'unknown'}_${f.carId}`;
            if (!usageMap[key]) {
                const car = cars.find(c => c.id === f.carId);
                const driver = drivers.find(d => String(d.chatId) === String(f.driverChatId));
                usageMap[key] = {
                    driverChatId: f.driverChatId || null,
                    driverName: f.driverName || driver?.name || 'Невідомий',
                    carId: f.carId,
                    carPlate: car ? `${car.brand} ${car.model} (${car.plate || ''})` : f.carId,
                    liters: 0,
                    count: 0,
                    lastDate: null
                };
            }
            usageMap[key].liters += f.liters || 0;
            usageMap[key].count += 1;
            if (!usageMap[key].lastDate || f.date > usageMap[key].lastDate) {
                usageMap[key].lastDate = f.date;
            }
        }

        return Object.values(usageMap).sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));
    }

    addCar(carData) {
        // Нормалізація номера через єдину таблицю кирилиця→латиниця
        const normalized = CompanyStorage.normalizePlate(carData.plate || '');
        const plateFormatted = CompanyStorage.formatPlate(normalized);

        const car = {
            id: this.generateId(),
            brand: carData.brand || 'Невідомо',
            model: carData.model || '',
            year: carData.year || null,
            mileage: parseInt(carData.mileage) || 0,
            plate: plateFormatted,
            color: carData.color || '',
            createdAt: new Date().toISOString()
        };
        this.data.cars.push(car);
        this.save();
        return car;
    }

    // ========== FUEL ==========

    getFuel(carId = null) {
        if (carId) {
            return this.data.fuel.filter(f => f.carId === carId);
        }
        return this.data.fuel;
    }

    addFuel(fuelData) {
        const mileage = parseInt(fuelData.mileage) || 0;
        const liters = parseFloat(fuelData.liters) || 0;
        const pricePerLiter = parseFloat(fuelData.pricePerLiter) || 0;

        const fuel = {
            id: this.generateId(),
            carId: fuelData.carId,
            date: fuelData.date || new Date().toISOString().split('T')[0],
            liters: liters,
            pricePerLiter: pricePerLiter,
            mileage: mileage,
            station: fuelData.station || '',
            fullTank: fuelData.fullTank !== false,
            paymentMethod: fuelData.paymentMethod || 'coupon',
            consumption: this.calculateConsumption(fuelData.carId, mileage, liters),
            source: fuelData.source || 'telegram',
            createdAt: new Date().toISOString()
        };
        this.data.fuel.push(fuel);

        // Оновлюємо пробіг авто
        const car = this.findCarById(fuelData.carId);
        if (car && mileage > (parseInt(car.mileage) || 0)) {
            car.mileage = mileage;
        }

        this.save();
        return fuel;
    }

    calculateConsumption(carId, currentMileage, liters) {
        const previousRecords = this.data.fuel
            .filter(f => f.carId === carId && f.mileage < currentMileage && f.fullTank)
            .sort((a, b) => b.mileage - a.mileage);

        if (previousRecords.length === 0) return 0;

        const prev = previousRecords[0];
        const distance = currentMileage - prev.mileage;

        if (distance <= 0) return 0;

        return ((liters / distance) * 100).toFixed(2);
    }

    // ========== EXPENSES ==========

    addExpense(expenseData) {
        const expense = {
            id: this.generateId(),
            carId: expenseData.carId,
            date: expenseData.date || new Date().toISOString().split('T')[0],
            category: expenseData.category,
            amount: expenseData.amount,
            description: expenseData.description || '',
            source: expenseData.source || 'telegram',
            createdAt: new Date().toISOString()
        };
        this.data.expenses.push(expense);
        this.save();
        return expense;
    }

    // ========== COUPONS (ТАЛОНИ) ==========

    getCoupons() {
        return this.data.coupons || [];
    }

    addCoupon(couponData) {
        const coupon = {
            id: this.generateId(),
            date: couponData.date || new Date().toISOString().split('T')[0],
            liters: parseFloat(couponData.liters),
            pricePerLiter: parseFloat(couponData.pricePerLiter) || 0,
            supplier: couponData.supplier || '',
            note: couponData.note || '',
            source: couponData.source || 'telegram',
            createdAt: new Date().toISOString()
        };
        if (!this.data.coupons) this.data.coupons = [];
        this.data.coupons.push(coupon);
        this.save();
        return coupon;
    }

    deleteCoupon(id) {
        if (!this.data.coupons) return false;
        const before = this.data.coupons.length;
        this.data.coupons = this.data.coupons.filter(c => c.id !== id);
        if (this.data.coupons.length < before) {
            this.save();
            return true;
        }
        return false;
    }

    // ========== DATA ==========

    getAllData() {
        return this.data;
    }

    importData(newData) {
        if (newData.cars) this.data.cars = newData.cars;
        if (newData.fuel) this.data.fuel = newData.fuel;
        if (newData.expenses) this.data.expenses = newData.expenses;
        if (newData.reminders) this.data.reminders = newData.reminders;
        if (newData.coupons) this.data.coupons = newData.coupons;
        // Дедуплікація після імпорту всіх даних
        this.deduplicateCars();
        this.save();
    }
}

/**
 * Cache of storage instances
 */
const storageCache = new Map();

function getStorage(companyId) {
    if (!storageCache.has(companyId)) {
        storageCache.set(companyId, new CompanyStorage(companyId));
    }
    return storageCache.get(companyId);
}

module.exports = { CompanyStorage, getStorage };
