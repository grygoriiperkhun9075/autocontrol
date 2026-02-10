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
            coupons: []
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

    // ========== CARS ==========

    getCars() {
        return this.data.cars;
    }

    findCarByPlate(plate) {
        const normalizedPlate = plate.replace(/\s+/g, '').toUpperCase();
        return this.data.cars.find(car => {
            const carPlate = (car.plate || '').replace(/\s+/g, '').toUpperCase();
            return carPlate === normalizedPlate;
        });
    }

    findCarById(id) {
        return this.data.cars.find(car => car.id === id);
    }

    addCar(carData) {
        const car = {
            id: this.generateId(),
            brand: carData.brand || 'Невідомо',
            model: carData.model || '',
            year: carData.year || null,
            mileage: carData.mileage || 0,
            plate: carData.plate || '',
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
        const fuel = {
            id: this.generateId(),
            carId: fuelData.carId,
            date: fuelData.date || new Date().toISOString().split('T')[0],
            liters: fuelData.liters,
            pricePerLiter: fuelData.pricePerLiter,
            mileage: fuelData.mileage,
            station: fuelData.station || '',
            fullTank: fuelData.fullTank !== false,
            consumption: this.calculateConsumption(fuelData.carId, fuelData.mileage, fuelData.liters),
            source: fuelData.source || 'telegram',
            createdAt: new Date().toISOString()
        };
        this.data.fuel.push(fuel);

        // Оновлюємо пробіг авто
        const car = this.findCarById(fuelData.carId);
        if (car && fuelData.mileage > (car.mileage || 0)) {
            car.mileage = fuelData.mileage;
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
