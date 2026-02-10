/**
 * Storage Module - Робота з localStorage + синхронізація з сервером
 */

const Storage = {
    KEYS: {
        CARS: 'autocontrol_cars',
        FUEL: 'autocontrol_fuel',
        EXPENSES: 'autocontrol_expenses',
        REMINDERS: 'autocontrol_reminders'
    },

    // URL сервера (відносний шлях для роботи і локально, і на Railway)
    API_URL: '/api',

    /**
     * Генерація унікального ID
     */
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    },

    /**
     * Отримання даних з localStorage
     */
    get(key) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : [];
        } catch (error) {
            console.error('Error reading from localStorage:', error);
            return [];
        }
    },

    /**
     * Збереження даних в localStorage
     */
    set(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
            return true;
        } catch (error) {
            console.error('Error writing to localStorage:', error);
            return false;
        }
    },

    /**
     * Додавання елемента
     */
    add(key, item) {
        const items = this.get(key);
        item.id = this.generateId();
        item.createdAt = new Date().toISOString();
        items.push(item);
        this.set(key, items);
        this.syncToServer(); // Синхронізація з сервером
        return item;
    },

    /**
     * Оновлення елемента
     */
    update(key, id, updates) {
        const items = this.get(key);
        const index = items.findIndex(item => item.id === id);
        if (index !== -1) {
            items[index] = { ...items[index], ...updates, updatedAt: new Date().toISOString() };
            this.set(key, items);
            this.syncToServer(); // Синхронізація з сервером
            return items[index];
        }
        return null;
    },

    /**
     * Видалення елемента
     */
    delete(key, id) {
        const items = this.get(key);
        const filtered = items.filter(item => item.id !== id);
        this.set(key, filtered);
        this.syncToServer(); // Синхронізація з сервером
        return filtered.length < items.length;
    },

    /**
     * Пошук елемента за ID
     */
    findById(key, id) {
        const items = this.get(key);
        return items.find(item => item.id === id) || null;
    },

    /**
     * Фільтрація елементів
     */
    filter(key, predicate) {
        const items = this.get(key);
        return items.filter(predicate);
    },

    /**
     * Отримання всіх даних для експорту
     */
    getAllData() {
        return {
            cars: this.get(this.KEYS.CARS),
            fuel: this.get(this.KEYS.FUEL),
            expenses: this.get(this.KEYS.EXPENSES),
            reminders: this.get(this.KEYS.REMINDERS),
            exportedAt: new Date().toISOString()
        };
    },

    /**
     * Імпорт даних
     */
    importData(data) {
        if (data.cars) this.set(this.KEYS.CARS, data.cars);
        if (data.fuel) this.set(this.KEYS.FUEL, data.fuel);
        if (data.expenses) this.set(this.KEYS.EXPENSES, data.expenses);
        if (data.reminders) this.set(this.KEYS.REMINDERS, data.reminders);
    },

    /**
     * Очищення всіх даних
     */
    clearAll() {
        Object.values(this.KEYS).forEach(key => localStorage.removeItem(key));
    },

    // ========== СИНХРОНІЗАЦІЯ З СЕРВЕРОМ ==========

    /**
     * Синхронізація даних з сервером
     */
    async syncFromServer() {
        try {
            const response = await fetch(this.API_URL + '/sync');
            if (!response.ok) throw new Error('Server error');

            const result = await response.json();
            if (result.success && result.data) {
                // Серверні дані мають пріоритет — замінюємо локальні
                this.importData(result.data);
                console.log('✅ Дані синхронізовано з сервером');
                return true;
            }
        } catch (error) {
            console.log('⚠️ Сервер недоступний, використовуємо локальні дані');
            return false;
        }
    },

    /**
     * Відправка даних на сервер
     */
    async syncToServer() {
        try {
            const response = await fetch(this.API_URL + '/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.getAllData())
            });
            if (response.ok) {
                console.log('✅ Дані відправлено на сервер');
            }
        } catch (error) {
            console.log('⚠️ Не вдалося відправити дані на сервер');
        }
    },

    /**
     * Злиття даних з сервера (сервер має пріоритет для нових записів)
     */
    mergeData(serverData) {
        // Об'єднуємо дані - додаємо нові з сервера, яких немає локально
        ['cars', 'fuel', 'expenses', 'reminders'].forEach(type => {
            const key = this.KEYS[type.toUpperCase()];
            const localData = this.get(key);
            const serverItems = serverData[type] || [];

            // Знаходимо нові записи з сервера
            const localIds = new Set(localData.map(item => item.id));
            const newItems = serverItems.filter(item => !localIds.has(item.id));

            if (newItems.length > 0) {
                const merged = [...localData, ...newItems];
                this.set(key, merged);
                console.log(`📥 Додано ${newItems.length} нових записів (${type})`);
            }
        });
    },

    /**
     * Примусова синхронізація (замінює локальні дані серверними)
     */
    async forceSync() {
        try {
            const response = await fetch(this.API_URL + '/sync');
            if (!response.ok) throw new Error('Server error');

            const result = await response.json();
            if (result.success && result.data) {
                this.importData(result.data);
                console.log('🔄 Повна синхронізація виконана');
                return true;
            }
        } catch (error) {
            console.error('❌ Помилка синхронізації:', error);
            return false;
        }
    }
};
