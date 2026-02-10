/**
 * Storage - Зберігання даних в JSON файлі
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

class Storage {
    static data = {
        cars: [],
        fuel: [],
        expenses: [],
        reminders: [],
        coupons: []
    };

    /**
     * Ініціалізація - завантаження даних з файлу
     */
    static init() {
        try {
            if (fs.existsSync(DATA_FILE)) {
                const content = fs.readFileSync(DATA_FILE, 'utf-8');
                this.data = JSON.parse(content);
                console.log('📁 Дані завантажено з файлу');
            } else {
                this.save();
                console.log('📁 Створено новий файл даних');
            }
        } catch (error) {
            console.error('❌ Помилка завантаження даних:', error);
        }
    }

    /**
     * Збереження даних у файл
     */
    static save() {
        try {
            fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
        } catch (error) {
            console.error('❌ Помилка збереження даних:', error);
        }
    }

    /**
     * Генерація ID
     */
    static generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    // ========== CARS ==========

    /**
     * Отримання всіх авто
     */
    static getCars() {
        return this.data.cars;
    }

    /**
     * Пошук авто за номером
     */
    static findCarByPlate(plate) {
        const normalizedPlate = plate.replace(/\s+/g, '').toUpperCase();
        return this.data.cars.find(car => {
            const carPlate = (car.plate || '').replace(/\s+/g, '').toUpperCase();
            return carPlate === normalizedPlate;
        });
    }

    /**
     * Пошук авто за ID
     */
    static findCarById(id) {
        return this.data.cars.find(car => car.id === id);
    }

    /**
     * Додавання авто
     */
    static addCar(carData) {
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

    /**
     * Отримання всіх заправок
     */
    static getFuel(carId = null) {
        if (carId) {
            return this.data.fuel.filter(f => f.carId === carId);
        }
        return this.data.fuel;
    }

    /**
     * Додавання заправки
     */
    static addFuel(fuelData) {
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

    /**
     * Розрахунок витрати пального
     */
    static calculateConsumption(carId, currentMileage, liters) {
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

    /**
     * Додавання витрати
     */
    static addExpense(expenseData) {
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

    /**
     * Отримання всіх талонів
     */
    static getCoupons() {
        return this.data.coupons || [];
    }

    /**
     * Додавання купівлі талонів
     */
    static addCoupon(couponData) {
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

    /**
     * Видалення талону
     */
    static deleteCoupon(id) {
        if (!this.data.coupons) return false;
        const before = this.data.coupons.length;
        this.data.coupons = this.data.coupons.filter(c => c.id !== id);
        if (this.data.coupons.length < before) {
            this.save();
            return true;
        }
        return false;
    }

    /**
     * Отримання всіх даних
     */
    static getAllData() {
        return this.data;
    }
}

module.exports = Storage;
