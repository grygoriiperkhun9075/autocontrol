/**
 * Maintenance Module — Управління ТО
 */

const Maintenance = {
    TYPES: {
        'oil': { icon: '🛢️', label: 'Заміна масла' },
        'filter': { icon: '🔧', label: 'Заміна фільтрів' },
        'brakes': { icon: '🛞', label: 'Гальма' },
        'tires': { icon: '🛞', label: 'Шини' },
        'battery': { icon: '🔋', label: 'Акумулятор' },
        'inspection': { icon: '🔍', label: 'Повне ТО' },
        'other': { icon: '📦', label: 'Інше' }
    },

    getAll(carId = null) {
        let records = Storage.get(Storage.KEYS.MAINTENANCE);
        if (carId) {
            records = records.filter(r => r.carId === carId);
        }
        return records.sort((a, b) => new Date(b.date) - new Date(a.date));
    },

    add(data) {
        return Storage.add(Storage.KEYS.MAINTENANCE, {
            carId: data.carId,
            type: data.type || 'other',
            date: data.date,
            mileage: parseInt(data.mileage) || 0,
            cost: parseFloat(data.cost) || 0,
            description: data.description || ''
        });
    },

    delete(id) {
        return Storage.delete(Storage.KEYS.MAINTENANCE, id);
    },

    getTotalCost(carId = null) {
        return this.getAll(carId).reduce((sum, m) => sum + (m.cost || 0), 0);
    },

    getTypeIcon(type) {
        return (this.TYPES[type] && this.TYPES[type].icon) || '📦';
    },

    getTypeLabel(type) {
        return (this.TYPES[type] && this.TYPES[type].label) || 'Інше';
    },

    formatDate(dateString) {
        return new Date(dateString).toLocaleDateString('uk-UA');
    },

    /**
     * Рендеринг списку ТО
     */
    renderGrid(carId = null) {
        const records = this.getAll(carId);
        const container = document.getElementById('maintenanceGrid');
        if (!container) return;

        if (records.length === 0) {
            container.innerHTML = '<p class="empty-message">Немає записів ТО. Додайте перше обслуговування!</p>';
            return;
        }

        container.innerHTML = records.map(record => `
            <div class="maintenance-card" data-id="${record.id}">
                <div class="maintenance-card-header">
                    <span class="maintenance-card-type">${this.getTypeIcon(record.type)} ${this.getTypeLabel(record.type)}</span>
                    <button class="car-action-btn delete delete-maintenance" title="Видалити">🗑️</button>
                </div>
                <div class="maintenance-card-date">📅 ${this.formatDate(record.date)}</div>
                ${record.mileage ? `<div class="maintenance-card-date">📏 ${record.mileage.toLocaleString()} км</div>` : ''}
                <div class="maintenance-card-car">🚗 ${Cars.getDisplayName(record.carId)}</div>
                ${record.cost ? `<div class="maintenance-card-cost">💰 ${record.cost.toLocaleString()} грн</div>` : ''}
                ${record.description ? `<div class="maintenance-card-note">${record.description}</div>` : ''}
            </div>
        `).join('');

        this.attachEventListeners();
    },

    attachEventListeners() {
        document.querySelectorAll('.delete-maintenance').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.closest('.maintenance-card').dataset.id;
                if (confirm('Видалити цей запис ТО?')) {
                    this.delete(id);
                    this.renderGrid(App.currentCar);
                }
            });
        });
    },

    openAddModal() {
        const form = document.getElementById('maintenanceForm');
        if (form) form.reset();
        document.getElementById('maintDate').value = new Date().toISOString().split('T')[0];
        if (App.currentCar) {
            document.getElementById('maintCarId').value = App.currentCar;
        }
        document.getElementById('maintenanceModal').classList.add('active');
    },

    handleFormSubmit(e) {
        e.preventDefault();
        this.add({
            carId: document.getElementById('maintCarId').value,
            type: document.getElementById('maintType').value,
            date: document.getElementById('maintDate').value,
            mileage: document.getElementById('maintMileage').value,
            cost: document.getElementById('maintCost').value,
            description: document.getElementById('maintDescription').value
        });
        document.getElementById('maintenanceModal').classList.remove('active');
        this.renderGrid(App.currentCar);
    },

    /**
     * Статус ТО для Dashboard
     * Перевіряє: чи є прострочені нагадування типу maintenance/oil/tires
     */
    getDashboardStatus() {
        const maintenanceReminders = Reminders.getActive().filter(r =>
            ['maintenance', 'oil', 'tires', 'inspection'].includes(r.type)
        );
        const overdue = maintenanceReminders.filter(r => {
            const status = Reminders.getStatus(r);
            return status === 'overdue';
        });
        const soon = maintenanceReminders.filter(r => {
            const status = Reminders.getStatus(r);
            return status === 'soon';
        });

        if (overdue.length > 0) {
            return { emoji: '🔴', label: `${overdue.length} протерм. ТО`, status: 'danger' };
        }
        if (soon.length > 0) {
            return { emoji: '🟡', label: `${soon.length} ТО скоро`, status: 'warning' };
        }
        return { emoji: '✅', label: 'ТО в нормі', status: 'ok' };
    }
};
