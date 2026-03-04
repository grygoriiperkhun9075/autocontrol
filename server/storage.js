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
            maintenance: [],    // [{id, carId, type, date, mileage, cost, description, createdAt}]
            documents: [],      // [{id, carId, type, number, issueDate, expiryDate, note, createdAt}]
            authorizedDrivers: [], // [{chatId, name, addedAt}]
            settings: {}          // {fuelCardPriority: bool, ...}
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
            fuelNorm: parseFloat(carData.fuelNorm) || 0, // л/100км норма
            createdAt: new Date().toISOString()
        };
        this.data.cars.push(car);
        this.save();
        return car;
    }

    updateCar(id, carData) {
        const car = this.findCarById(id);
        if (!car) return null;

        if (carData.brand !== undefined) car.brand = carData.brand;
        if (carData.model !== undefined) car.model = carData.model;
        if (carData.year !== undefined) car.year = carData.year;
        if (carData.mileage !== undefined) car.mileage = parseInt(carData.mileage) || 0;
        if (carData.plate !== undefined) {
            const norm = CompanyStorage.normalizePlate(carData.plate);
            car.plate = CompanyStorage.formatPlate(norm);
        }
        if (carData.color !== undefined) car.color = carData.color;
        if (carData.fuelNorm !== undefined) car.fuelNorm = parseFloat(carData.fuelNorm) || 0;

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
            driverChatId: fuelData.driverChatId || null,
            driverName: fuelData.driverName || null,
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
            .filter(f => f.carId === carId && f.mileage > 0 && f.mileage < currentMileage)
            .sort((a, b) => b.mileage - a.mileage);

        if (previousRecords.length === 0) return 0;

        const prev = previousRecords[0];
        const distance = currentMileage - prev.mileage;

        if (distance <= 0) return 0;

        return ((liters / distance) * 100).toFixed(2);
    }

    recalculateAllConsumption() {
        let updated = 0;
        // Group fuel by carId
        const byCarId = {};
        this.data.fuel.forEach(f => {
            if (!byCarId[f.carId]) byCarId[f.carId] = [];
            byCarId[f.carId].push(f);
        });

        Object.keys(byCarId).forEach(carId => {
            const records = byCarId[carId].sort((a, b) => a.mileage - b.mileage);
            for (let i = 0; i < records.length; i++) {
                const r = records[i];
                if (!r.mileage || r.mileage <= 0) {
                    r.consumption = 0;
                    continue;
                }
                if (i === 0) {
                    r.consumption = 0;
                    continue;
                }
                const prev = records[i - 1];
                if (!prev.mileage || prev.mileage <= 0) {
                    r.consumption = 0;
                    continue;
                }
                const distance = r.mileage - prev.mileage;
                if (distance <= 0) {
                    r.consumption = 0;
                    continue;
                }
                r.consumption = ((r.liters / distance) * 100).toFixed(2);
                updated++;
            }
        });

        this.save();
        return updated;
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

    // ========== MAINTENANCE (Історія ТО) ==========

    getMaintenance(carId = null) {
        if (!this.data.maintenance) this.data.maintenance = [];
        if (carId) {
            return this.data.maintenance.filter(m => m.carId === carId);
        }
        return this.data.maintenance;
    }

    addMaintenance(data) {
        if (!this.data.maintenance) this.data.maintenance = [];
        const record = {
            id: this.generateId(),
            carId: data.carId,
            type: data.type || 'maintenance', // oil, tires, brakes, filter, battery, other
            date: data.date || new Date().toISOString().split('T')[0],
            mileage: parseInt(data.mileage) || 0,
            cost: parseFloat(data.cost) || 0,
            description: data.description || '',
            createdAt: new Date().toISOString()
        };
        this.data.maintenance.push(record);
        this.save();
        return record;
    }

    deleteMaintenance(id) {
        if (!this.data.maintenance) return false;
        const before = this.data.maintenance.length;
        this.data.maintenance = this.data.maintenance.filter(m => m.id !== id);
        if (this.data.maintenance.length < before) {
            this.save();
            return true;
        }
        return false;
    }

    // ========== DOCUMENTS (Документи) ==========

    getDocuments(carId = null) {
        if (!this.data.documents) this.data.documents = [];
        if (carId) {
            return this.data.documents.filter(d => d.carId === carId);
        }
        return this.data.documents;
    }

    addDocument(data) {
        if (!this.data.documents) this.data.documents = [];
        const doc = {
            id: this.generateId(),
            carId: data.carId || null,
            type: data.type || 'insurance', // insurance, inspection, license, permit, other
            number: data.number || '',
            issueDate: data.issueDate || '',
            expiryDate: data.expiryDate || '',
            note: data.note || '',
            createdAt: new Date().toISOString()
        };
        this.data.documents.push(doc);
        this.save();
        return doc;
    }

    updateDocument(id, data) {
        if (!this.data.documents) return null;
        const doc = this.data.documents.find(d => d.id === id);
        if (!doc) return null;

        if (data.carId !== undefined) doc.carId = data.carId;
        if (data.type !== undefined) doc.type = data.type;
        if (data.number !== undefined) doc.number = data.number;
        if (data.issueDate !== undefined) doc.issueDate = data.issueDate;
        if (data.expiryDate !== undefined) doc.expiryDate = data.expiryDate;
        if (data.note !== undefined) doc.note = data.note;

        this.save();
        return doc;
    }

    deleteDocument(id) {
        if (!this.data.documents) return false;
        const before = this.data.documents.length;
        this.data.documents = this.data.documents.filter(d => d.id !== id);
        if (this.data.documents.length < before) {
            this.save();
            return true;
        }
        return false;
    }

    // ========== SETTINGS ==========

    getSettings() {
        return this.data.settings || {};
    }

    updateSettings(newSettings) {
        if (!this.data.settings) this.data.settings = {};
        Object.assign(this.data.settings, newSettings);
        this.save();
        return this.data.settings;
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
        if (newData.maintenance) this.data.maintenance = newData.maintenance;
        if (newData.documents) this.data.documents = newData.documents;
        if (newData.settings) this.data.settings = newData.settings;
        // Дедуплікація після імпорту всіх даних
        this.deduplicateCars();
        // Оновлюємо пробіг авто з записів заправок (веб не оновлює car.mileage)
        this._syncCarMileageFromFuel();
        this.save();
    }

    /**
     * Оновлює car.mileage з найсвіжішого запису заправки
     * Вирішує проблему: веб-клієнт не оновлює car.mileage при додаванні заправки
     */
    _syncCarMileageFromFuel() {
        for (const car of this.data.cars) {
            const carFuel = this.data.fuel.filter(f => f.carId === car.id);
            if (carFuel.length === 0) continue;

            const maxMileage = Math.max(...carFuel.map(f => parseInt(f.mileage) || 0));
            const currentMileage = parseInt(car.mileage) || 0;

            if (maxMileage > currentMileage) {
                car.mileage = maxMileage;
            }
        }
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
