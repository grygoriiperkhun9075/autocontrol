/**
 * Fuel Module - Управління заправками
 */

const Fuel = {
    /**
     * Отримання всіх заправок
     */
    getAll(carId = null) {
        let records = Storage.get(Storage.KEYS.FUEL);
        if (carId) {
            records = records.filter(r => r.carId === carId);
        }
        return records.sort((a, b) => new Date(b.date) - new Date(a.date));
    },

    /**
     * Отримання заправки за ID
     */
    getById(id) {
        return Storage.findById(Storage.KEYS.FUEL, id);
    },

    /**
     * Додавання заправки
     */
    add(fuelData) {
        const consumption = this.calculateConsumption(fuelData.carId, fuelData.mileage, fuelData.liters, fuelData.fullTank);

        const fuel = {
            carId: fuelData.carId,
            date: fuelData.date,
            liters: parseFloat(fuelData.liters),
            pricePerLiter: parseFloat(fuelData.pricePerLiter),
            mileage: parseInt(fuelData.mileage),
            station: fuelData.station || '',
            fullTank: fuelData.fullTank !== false,
            paymentMethod: fuelData.paymentMethod || 'coupon',
            consumption: consumption
        };

        const result = Storage.add(Storage.KEYS.FUEL, fuel);

        // Оновлюємо пробіг авто в localStorage (щоб бот бачив актуальний пробіг)
        const newMileage = parseInt(fuelData.mileage) || 0;
        if (newMileage > 0) {
            const cars = Storage.get(Storage.KEYS.CARS);
            const car = cars.find(c => c.id === fuelData.carId);
            if (car && newMileage > (parseInt(car.mileage) || 0)) {
                car.mileage = newMileage;
                Storage.set(Storage.KEYS.CARS, cars);
            }
        }

        return result;
    },

    /**
     * Оновлення заправки
     */
    update(id, fuelData) {
        const consumption = this.calculateConsumption(fuelData.carId, fuelData.mileage, fuelData.liters, fuelData.fullTank, id);

        return Storage.update(Storage.KEYS.FUEL, id, {
            carId: fuelData.carId,
            date: fuelData.date,
            liters: parseFloat(fuelData.liters),
            pricePerLiter: parseFloat(fuelData.pricePerLiter),
            mileage: parseInt(fuelData.mileage),
            station: fuelData.station || '',
            fullTank: fuelData.fullTank !== false,
            paymentMethod: fuelData.paymentMethod || 'coupon',
            consumption: consumption
        });
    },

    /**
     * Видалення заправки
     */
    delete(id) {
        return Storage.delete(Storage.KEYS.FUEL, id);
    },

    /**
     * Розрахунок витрати пального (л/100км)
     */
    calculateConsumption(carId, currentMileage, liters, fullTank, excludeId = null) {
        const records = this.getAll(carId).filter(r => {
            if (excludeId && r.id === excludeId) return false;
            return r.mileage > 0 && r.mileage < currentMileage;
        }).sort((a, b) => b.mileage - a.mileage);

        if (records.length === 0) return 0;

        const previousRecord = records[0];
        const distance = currentMileage - previousRecord.mileage;

        if (distance <= 0) return 0;

        return ((liters / distance) * 100).toFixed(2);
    },

    /**
     * Отримання останньої витрати
     */
    getLastConsumption(carId = null) {
        const records = this.getAll(carId).filter(r => r.consumption > 0);
        return records.length > 0 ? records[0].consumption : 0;
    },

    /**
     * Отримання середньої витрати
     */
    getAverageConsumption(carId = null, period = 'all') {
        let records = this.getAll(carId).filter(r => r.consumption > 0);
        records = this.filterByPeriod(records, period);
        if (records.length === 0) return 0;

        const sum = records.reduce((acc, r) => acc + parseFloat(r.consumption), 0);
        return (sum / records.length).toFixed(2);
    },

    /**
     * Отримання загальних витрат на пальне
     */
    getTotalFuelCost(carId = null, period = 'all') {
        let records = this.getAll(carId);
        records = this.filterByPeriod(records, period);

        return records.reduce((acc, r) => acc + (r.liters * r.pricePerLiter), 0);
    },

    /**
     * Отримання загального об'єму пального
     */
    getTotalLiters(carId = null, period = 'all') {
        let records = this.getAll(carId);
        records = this.filterByPeriod(records, period);

        return records.reduce((acc, r) => acc + r.liters, 0);
    },

    /**
     * Фільтрація за періодом
     */
    filterByPeriod(records, period) {
        const now = new Date();

        // Handle object format {type: 'custom', from: '...', to: '...'}
        if (period && typeof period === 'object' && period.type === 'custom') {
            const from = period.from ? new Date(period.from) : null;
            const to = period.to ? new Date(period.to + 'T23:59:59') : null;
            return records.filter(r => {
                const d = new Date(r.date);
                if (from && d < from) return false;
                if (to && d > to) return false;
                return true;
            });
        }

        switch (period) {
            case 'week':
                const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
                return records.filter(r => new Date(r.date) >= weekAgo);
            case 'month':
                const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
                return records.filter(r => new Date(r.date) >= monthAgo);
            case 'year':
                const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
                return records.filter(r => new Date(r.date) >= yearAgo);
            case 'custom': {
                const from = App.customDateFrom ? new Date(App.customDateFrom) : null;
                const to = App.customDateTo ? new Date(App.customDateTo + 'T23:59:59') : null;
                return records.filter(r => {
                    const d = new Date(r.date);
                    if (from && d < from) return false;
                    if (to && d > to) return false;
                    return true;
                });
            }
            default:
                return records;
        }
    },

    /**
     * Отримання даних для графіка по місяцях
     */
    getMonthlyData(carId = null, months = 12) {
        const records = this.getAll(carId);
        const data = {};

        for (let i = 0; i < months; i++) {
            const date = new Date();
            date.setMonth(date.getMonth() - i);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            data[key] = {
                consumption: [],
                cost: 0,
                liters: 0
            };
        }

        records.forEach(record => {
            const date = new Date(record.date);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

            if (data[key]) {
                if (record.consumption > 0) {
                    data[key].consumption.push(parseFloat(record.consumption));
                }
                data[key].cost += record.liters * record.pricePerLiter;
                data[key].liters += record.liters;
            }
        });

        // Обчислюємо середнє значення витрати
        Object.keys(data).forEach(key => {
            const consumptions = data[key].consumption;
            data[key].avgConsumption = consumptions.length > 0
                ? (consumptions.reduce((a, b) => a + b, 0) / consumptions.length).toFixed(2)
                : 0;
        });

        return data;
    },

    /**
     * Форматування дати
     */
    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('uk-UA');
    },

    /**
     * Рендеринг таблиці заправок
     */
    renderTable(carId = null) {
        const records = this.getAll(carId);
        const tbody = document.getElementById('fuelTableBody');

        if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="empty-message">Немає записів про заправки</td></tr>';
            return;
        }

        // Сортуємо від найновіших до найстаріших
        const sorted = [...records].sort((a, b) => new Date(b.date) - new Date(a.date));

        tbody.innerHTML = sorted.map(record => {
            const payLabel = record.paymentMethod === 'cash' ? '💵 Готівка' : '🎫 Талони';
            const driverLabel = record.driverName || '--';
            return `
            <tr data-fuel-id="${record.id}">
                <td>${this.formatDate(record.date)}</td>
                <td>${Cars.getDisplayName(record.carId)}</td>
                <td>${record.liters.toFixed(2)}</td>
                <td>${record.pricePerLiter.toFixed(2)}</td>
                <td>${(record.liters * record.pricePerLiter).toFixed(2)} грн</td>
                <td>${record.mileage.toLocaleString()}</td>
                <td>${record.consumption > 0 ? record.consumption : '--'}</td>
                <td>${payLabel}</td>
                <td>${driverLabel}</td>
                <td>
                    <div class="table-actions">
                        <button class="table-action-btn edit-fuel" title="Редагувати">✏️</button>
                        <button class="table-action-btn delete delete-fuel" title="Видалити">🗑️</button>
                    </div>
                </td>
            </tr>
        `}).join('');

        this.attachEventListeners();
    },

    /**
     * Оновлення статистики
     */
    updateStats(carId = null) {
        const lastConsumption = this.getLastConsumption(carId);
        const avgConsumption = this.getAverageConsumption(carId);

        document.getElementById('lastConsumption').textContent =
            lastConsumption > 0 ? `${lastConsumption} л/100км` : '-- л/100км';
        document.getElementById('avgFuelConsumption').textContent =
            avgConsumption > 0 ? `${avgConsumption} л/100км` : '-- л/100км';
    },

    /**
     * Підключення обробників подій
     */
    attachEventListeners() {
        document.querySelectorAll('.edit-fuel').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const fuelId = e.target.closest('tr').dataset.fuelId;
                this.openEditModal(fuelId);
            });
        });

        document.querySelectorAll('.delete-fuel').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const fuelId = e.target.closest('tr').dataset.fuelId;
                if (confirm('Видалити цей запис?')) {
                    this.delete(fuelId);
                    this.renderTable(App.currentCar);
                    this.updateStats(App.currentCar);
                    App.updateDashboard();
                }
            });
        });
    },

    /**
     * Відкриття модального вікна для редагування
     */
    openEditModal(fuelId) {
        const fuel = this.getById(fuelId);
        if (!fuel) return;

        document.getElementById('fuelModalTitle').textContent = 'Редагувати заправку';
        document.getElementById('fuelId').value = fuel.id;
        document.getElementById('fuelCarId').value = fuel.carId;
        document.getElementById('fuelDate').value = fuel.date;
        document.getElementById('fuelLiters').value = fuel.liters;
        document.getElementById('fuelPrice').value = fuel.pricePerLiter;
        document.getElementById('fuelMileage').value = fuel.mileage;
        document.getElementById('fuelStation').value = fuel.station || '';
        document.getElementById('fuelFullTank').checked = fuel.fullTank;
        document.getElementById('fuelPaymentMethod').value = fuel.paymentMethod || 'coupon';

        // Показуємо інформацію про водія, якщо вона є
        const driverGroup = document.getElementById('fuelDriverInfoGroup');
        if (fuel.driverName) {
            document.getElementById('fuelDriverInfo').value = fuel.driverName;
            driverGroup.style.display = '';
        } else {
            driverGroup.style.display = 'none';
        }

        document.getElementById('fuelModal').classList.add('active');
    },

    /**
     * Відкриття модального вікна для додавання
     */
    openAddModal() {
        document.getElementById('fuelModalTitle').textContent = 'Додати заправку';
        document.getElementById('fuelForm').reset();
        document.getElementById('fuelId').value = '';
        document.getElementById('fuelDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('fuelFullTank').checked = true;
        document.getElementById('fuelPaymentMethod').value = 'coupon';
        document.getElementById('fuelDriverInfoGroup').style.display = 'none';

        if (App.currentCar) {
            document.getElementById('fuelCarId').value = App.currentCar;
        }

        document.getElementById('fuelModal').classList.add('active');
    },

    /**
     * Обробка форми
     */
    handleFormSubmit(e) {
        e.preventDefault();

        const fuelId = document.getElementById('fuelId').value;
        const fuelData = {
            carId: document.getElementById('fuelCarId').value,
            date: document.getElementById('fuelDate').value,
            liters: document.getElementById('fuelLiters').value,
            pricePerLiter: document.getElementById('fuelPrice').value,
            mileage: document.getElementById('fuelMileage').value,
            station: document.getElementById('fuelStation').value,
            fullTank: document.getElementById('fuelFullTank').checked,
            paymentMethod: document.getElementById('fuelPaymentMethod').value
        };

        if (fuelId) {
            this.update(fuelId, fuelData);
        } else {
            this.add(fuelData);
        }

        document.getElementById('fuelModal').classList.remove('active');
        this.renderTable(App.currentCar);
        this.updateStats(App.currentCar);
        Cars.renderList();
        App.updateDashboard();
    }
};
