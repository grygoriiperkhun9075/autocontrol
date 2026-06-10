/**
 * Storage Module - Робота з localStorage + синхронізація з сервером
 */

const Storage = {
    KEYS: {
        CARS: 'autocontrol_cars',
        FUEL: 'autocontrol_fuel',
        EXPENSES: 'autocontrol_expenses',
        REMINDERS: 'autocontrol_reminders',
        COUPONS: 'autocontrol_coupons',
        MAINTENANCE: 'autocontrol_maintenance',
        DOCUMENTS: 'autocontrol_documents'
    },

    // URL сервера (відносний шлях для роботи і локально, і на Railway)
    API_URL: '/api',

    // ========== CLOCK SYNCHRONIZATION & VERSIONING ==========
    getServerTimeOffset() {
        const saved = localStorage.getItem('autocontrol_server_time_offset');
        return saved ? parseInt(saved, 10) : 0;
    },

    updateServerTimeOffset(serverTimeStr) {
        if (!serverTimeStr) return;
        const serverTime = new Date(serverTimeStr).getTime();
        const clientTime = Date.now();
        const offset = serverTime - clientTime;
        localStorage.setItem('autocontrol_server_time_offset', offset);
        console.log(`⏱️ Зсув часу сервера: ${offset}мс`);
    },

    getNowISO() {
        const offset = this.getServerTimeOffset();
        return new Date(Date.now() + offset).toISOString();
    },

    incrementLocalVersion() {
        const version = parseInt(localStorage.getItem('autocontrol_local_version') || '0', 10);
        localStorage.setItem('autocontrol_local_version', version + 1);
    },

    getLocalVersion() {
        return parseInt(localStorage.getItem('autocontrol_local_version') || '0', 10);
    },

    getDeletedIds() {
        try {
            const data = localStorage.getItem('autocontrol_deleted_ids');
            return data ? JSON.parse(data) : [];
        } catch (e) {
            return [];
        }
    },

    addDeletedId(id) {
        const ids = this.getDeletedIds();
        if (!ids.includes(id)) {
            ids.push(id);
            localStorage.setItem('autocontrol_deleted_ids', JSON.stringify(ids));
        }
    },

    clearDeletedIds(idsToClear) {
        const ids = this.getDeletedIds();
        const filtered = ids.filter(id => !idsToClear.includes(id));
        localStorage.setItem('autocontrol_deleted_ids', JSON.stringify(filtered));
    },

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
        const now = this.getNowISO();
        item.createdAt = now;
        item.updatedAt = now;
        items.push(item);
        this.set(key, items);
        this.incrementLocalVersion();
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
            items[index] = { ...items[index], ...updates, updatedAt: this.getNowISO() };
            this.set(key, items);
            this.incrementLocalVersion();
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
        this.addDeletedId(id);
        this.incrementLocalVersion();
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
            coupons: this.get(this.KEYS.COUPONS),
            maintenance: this.get(this.KEYS.MAINTENANCE),
            documents: this.get(this.KEYS.DOCUMENTS),
            deletedIds: this.getDeletedIds(),
            lastSyncedAt: localStorage.getItem('autocontrol_last_synced_at') || '1970-01-01T00:00:00.000Z',
            exportedAt: this.getNowISO()
        };
    },

    importData(data) {
        const lastSyncedAtStr = localStorage.getItem('autocontrol_last_synced_at') || '1970-01-01T00:00:00.000Z';
        const lastSyncedAt = new Date(lastSyncedAtStr).getTime();

        const collections = ['cars', 'fuel', 'expenses', 'reminders', 'coupons', 'maintenance', 'documents'];

        collections.forEach(type => {
            const key = this.KEYS[type.toUpperCase()];
            if (!data[type]) return;

            const localItems = this.get(key);
            const serverItems = data[type];

            const mergedItems = [];
            const localItemMap = new Map(localItems.map(item => [item.id, item]));

            // 1. Обробляємо записи з сервера
            serverItems.forEach(serverItem => {
                const localItem = localItemMap.get(serverItem.id);
                if (localItem) {
                    const localTime = new Date(localItem.updatedAt || localItem.createdAt || 0).getTime();
                    const serverTime = new Date(serverItem.updatedAt || serverItem.createdAt || 0).getTime();

                    if (localTime >= serverTime) {
                        mergedItems.push(localItem);
                    } else {
                        mergedItems.push(serverItem);
                    }
                    localItemMap.delete(serverItem.id);
                } else {
                    // Запис є на сервері, але немає локально
                    mergedItems.push(serverItem);
                }
            });

            // 2. Обробляємо решту локальних записів (яких немає на сервері)
            localItemMap.forEach(localItem => {
                const localTime = new Date(localItem.updatedAt || localItem.createdAt || 0).getTime();
                // Якщо запис був створений/оновлений після останньої успішної синхронізації,
                // це новий локальний запис, який ще не відправлено. Зберігаємо його.
                if (localTime > lastSyncedAt) {
                    mergedItems.push(localItem);
                } else {
                    // Якщо запис уже був синхронізований раніше, але зараз його немає на сервері —
                    // це означає, що його видалили на сервері. Видаляємо локально.
                    console.log(`🗑️ Client sync: item ${type}:${localItem.id} was deleted on the server, removing locally`);
                }
            });

            this.set(key, mergedItems);
        });
    },

    /**
     * Очищення всіх даних
     */
    clearAll() {
        Object.values(this.KEYS).forEach(key => localStorage.removeItem(key));
    },

    // ========== СИНХРОНІЗАЦІЯ З СЕРВЕРОМ ==========
    isSyncingFromServer: false,
    isSyncingToServer: false,
    pendingSyncToServer: false,
    activeGetController: null,

    /**
     * Синхронізація даних з сервером
     */
    async syncFromServer() {
        if (this.isSyncingFromServer || this.isSyncingToServer) {
            console.log('⏳ Пропуск завантаження: виконується інша операція...');
            return false;
        }

        if (this.activeGetController) {
            this.activeGetController.abort();
        }
        this.activeGetController = new AbortController();
        const signal = this.activeGetController.signal;

        const startVersion = this.getLocalVersion();

        this.isSyncingFromServer = true;
        try {
            const response = await fetch(this.API_URL + '/sync', { signal });
            if (response.status === 401) {
                window.location.href = '/login';
                return false;
            }
            if (!response.ok) throw new Error('Server error');

            const result = await response.json();

            if (result.timestamp) {
                this.updateServerTimeOffset(result.timestamp);
            }

            const currentVersion = this.getLocalVersion();
            if (currentVersion !== startVersion) {
                console.log('📡 Скасовано заміну локальних даних (локальна версія змінилася під час запиту)');
                return false;
            }

            // Подвійна перевірка: якщо поки йшов GET, розпочався POST — скасовуємо заміну локальних даних!
            if (result.success && result.data && !this.isSyncingToServer) {
                this.importData(result.data);
                localStorage.setItem('autocontrol_last_synced_at', result.timestamp || this.getNowISO());
                console.log('✅ Дані синхронізовано з сервером');
                return true;
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('📡 Завантаження скасовано (дані локально оновлено)');
            } else {
                console.log('⚠️ Сервер недоступний, використовуємо локальні дані');
            }
            return false;
        } finally {
            this.isSyncingFromServer = false;
            this.activeGetController = null;
        }
    },

    /**
     * Відправка даних на сервер
     */
    async syncToServer() {
        if (this.activeGetController) {
            this.activeGetController.abort();
            this.activeGetController = null;
        }

        if (this.isSyncingToServer) {
            this.pendingSyncToServer = true;
            console.log('⏳ Синхронізація вже виконується, заплановано повтор...');
            return;
        }
        this.isSyncingToServer = true;

        const startVersion = this.getLocalVersion();
        const payload = this.getAllData();
        const sentDeletedIds = payload.deletedIds || [];

        try {
            const response = await fetch(this.API_URL + '/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (response.ok) {
                const result = await response.json();
                console.log('✅ Дані відправлено на сервер');

                if (sentDeletedIds.length > 0) {
                    this.clearDeletedIds(sentDeletedIds);
                }

                if (result.timestamp) {
                    this.updateServerTimeOffset(result.timestamp);
                }

                const currentVersion = this.getLocalVersion();
                if (currentVersion === startVersion) {
                    localStorage.setItem('autocontrol_last_synced_at', result.timestamp || this.getNowISO());
                }
            }
        } catch (error) {
            console.log('⚠️ Не вдалося відправити дані на сервер');
        } finally {
            this.isSyncingToServer = false;
            if (this.pendingSyncToServer) {
                this.pendingSyncToServer = false;
                // Запускаємо повторну синхронізацію для збереження останніх змін
                this.syncToServer();
            }
        }
    },

    /**
     * Злиття даних з сервера (сервер має пріоритет для нових записів)
     */
    mergeData(serverData) {
        // Об'єднуємо дані - додаємо нові з сервера, яких немає локально
        ['cars', 'fuel', 'expenses', 'reminders', 'coupons', 'maintenance', 'documents'].forEach(type => {
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
                if (result.timestamp) {
                    this.updateServerTimeOffset(result.timestamp);
                }
                localStorage.setItem('autocontrol_last_synced_at', result.timestamp || this.getNowISO());
                this.incrementLocalVersion();
                console.log('🔄 Повна синхронізація виконана');
                return true;
            }
        } catch (error) {
            console.error('❌ Помилка синхронізації:', error);
            return false;
        }
    }
};
