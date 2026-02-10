/**
 * Reminders Module - Управління нагадуваннями
 */

const Reminders = {
    TYPES: {
        'maintenance': { icon: '🛠️', label: 'Технічне обслуговування' },
        'insurance': { icon: '📋', label: 'Страховка' },
        'inspection': { icon: '🔍', label: 'Техогляд' },
        'oil': { icon: '🛢️', label: 'Заміна масла' },
        'tires': { icon: '🛞', label: 'Заміна шин' },
        'other': { icon: '📦', label: 'Інше' }
    },

    /**
     * Отримання всіх нагадувань
     */
    getAll(carId = null) {
        let records = Storage.get(Storage.KEYS.REMINDERS);
        if (carId) {
            records = records.filter(r => r.carId === carId);
        }
        return records.sort((a, b) => new Date(a.date) - new Date(b.date));
    },

    /**
     * Отримання нагадування за ID
     */
    getById(id) {
        return Storage.findById(Storage.KEYS.REMINDERS, id);
    },

    /**
     * Додавання нагадування
     */
    add(reminderData) {
        const reminder = {
            carId: reminderData.carId,
            type: reminderData.type,
            date: reminderData.date,
            mileage: reminderData.mileage ? parseInt(reminderData.mileage) : null,
            note: reminderData.note || '',
            completed: false
        };
        return Storage.add(Storage.KEYS.REMINDERS, reminder);
    },

    /**
     * Оновлення нагадування
     */
    update(id, reminderData) {
        return Storage.update(Storage.KEYS.REMINDERS, id, {
            carId: reminderData.carId,
            type: reminderData.type,
            date: reminderData.date,
            mileage: reminderData.mileage ? parseInt(reminderData.mileage) : null,
            note: reminderData.note || ''
        });
    },

    /**
     * Видалення нагадування
     */
    delete(id) {
        return Storage.delete(Storage.KEYS.REMINDERS, id);
    },

    /**
     * Позначення як виконане
     */
    markCompleted(id) {
        return Storage.update(Storage.KEYS.REMINDERS, id, { completed: true });
    },

    /**
     * Отримання активних нагадувань
     */
    getActive(carId = null) {
        return this.getAll(carId).filter(r => !r.completed);
    },

    /**
     * Отримання прострочених нагадувань
     */
    getOverdue(carId = null) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return this.getActive(carId).filter(r => {
            const reminderDate = new Date(r.date);
            reminderDate.setHours(0, 0, 0, 0);
            return reminderDate < today;
        });
    },

    /**
     * Отримання найближчих нагадувань (7 днів)
     */
    getUpcoming(carId = null, days = 7) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const futureDate = new Date(today);
        futureDate.setDate(futureDate.getDate() + days);

        return this.getActive(carId).filter(r => {
            const reminderDate = new Date(r.date);
            reminderDate.setHours(0, 0, 0, 0);
            return reminderDate >= today && reminderDate <= futureDate;
        });
    },

    /**
     * Отримання статусу нагадування
     */
    getStatus(reminder) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const reminderDate = new Date(reminder.date);
        reminderDate.setHours(0, 0, 0, 0);

        const diffDays = Math.ceil((reminderDate - today) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) return 'overdue';
        if (diffDays <= 7) return 'soon';
        return 'normal';
    },

    /**
     * Отримання іконки типу
     */
    getTypeIcon(type) {
        return (this.TYPES[type] && this.TYPES[type].icon) || '📦';
    },

    /**
     * Отримання назви типу
     */
    getTypeLabel(type) {
        return (this.TYPES[type] && this.TYPES[type].label) || 'Інше';
    },

    /**
     * Форматування дати
     */
    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('uk-UA');
    },

    /**
     * Рендеринг найближчих нагадувань для Dashboard
     */
    renderUpcomingPreview() {
        const overdue = this.getOverdue();
        const upcoming = this.getUpcoming();
        const all = [...overdue, ...upcoming].slice(0, 5);

        const container = document.getElementById('upcomingReminders');

        if (all.length === 0) {
            container.innerHTML = '<p class="empty-message">Немає активних нагадувань</p>';
            return;
        }

        container.innerHTML = all.map(reminder => {
            const status = this.getStatus(reminder);
            return `
                <div class="reminder-item ${status}">
                    <div class="reminder-info">
                        <span class="reminder-type">${this.getTypeIcon(reminder.type)} ${this.getTypeLabel(reminder.type)}</span>
                        <span class="reminder-date">${this.formatDate(reminder.date)}</span>
                    </div>
                    <span class="reminder-car">${Cars.getDisplayName(reminder.carId)}</span>
                </div>
            `;
        }).join('');
    },

    /**
     * Рендеринг сітки нагадувань
     */
    renderGrid(carId = null) {
        const records = this.getActive(carId);
        const container = document.getElementById('remindersGrid');

        if (records.length === 0) {
            container.innerHTML = '<p class="empty-message">Немає активних нагадувань</p>';
            return;
        }

        container.innerHTML = records.map(reminder => {
            const status = this.getStatus(reminder);
            return `
                <div class="reminder-card status-${status}" data-reminder-id="${reminder.id}">
                    <div class="reminder-card-header">
                        <span class="reminder-card-type">${this.getTypeIcon(reminder.type)} ${this.getTypeLabel(reminder.type)}</span>
                        <div class="reminder-card-actions">
                            <button class="car-action-btn complete-reminder" title="Виконано">✅</button>
                            <button class="car-action-btn edit-reminder" title="Редагувати">✏️</button>
                            <button class="car-action-btn delete delete-reminder" title="Видалити">🗑️</button>
                        </div>
                    </div>
                    <div class="reminder-card-date">📅 ${this.formatDate(reminder.date)}</div>
                    ${reminder.mileage ? `<div class="reminder-card-date">📏 При ${reminder.mileage.toLocaleString()} км</div>` : ''}
                    <div class="reminder-card-car">🚗 ${Cars.getDisplayName(reminder.carId)}</div>
                    ${reminder.note ? `<div class="reminder-card-note">${reminder.note}</div>` : ''}
                </div>
            `;
        }).join('');

        this.attachEventListeners();
    },

    /**
     * Підключення обробників подій
     */
    attachEventListeners() {
        document.querySelectorAll('.complete-reminder').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const reminderId = e.target.closest('.reminder-card').dataset.reminderId;
                if (confirm('Позначити як виконане?')) {
                    this.markCompleted(reminderId);
                    this.renderGrid(App.currentCar);
                    this.renderUpcomingPreview();
                }
            });
        });

        document.querySelectorAll('.edit-reminder').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const reminderId = e.target.closest('.reminder-card').dataset.reminderId;
                this.openEditModal(reminderId);
            });
        });

        document.querySelectorAll('.delete-reminder').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const reminderId = e.target.closest('.reminder-card').dataset.reminderId;
                if (confirm('Видалити це нагадування?')) {
                    this.delete(reminderId);
                    this.renderGrid(App.currentCar);
                    this.renderUpcomingPreview();
                }
            });
        });
    },

    /**
     * Відкриття модального вікна для редагування
     */
    openEditModal(reminderId) {
        const reminder = this.getById(reminderId);
        if (!reminder) return;

        document.getElementById('reminderModalTitle').textContent = 'Редагувати нагадування';
        document.getElementById('reminderId').value = reminder.id;
        document.getElementById('reminderCarId').value = reminder.carId;
        document.getElementById('reminderType').value = reminder.type;
        document.getElementById('reminderDate').value = reminder.date;
        document.getElementById('reminderMileage').value = reminder.mileage || '';
        document.getElementById('reminderNote').value = reminder.note || '';

        document.getElementById('reminderModal').classList.add('active');
    },

    /**
     * Відкриття модального вікна для додавання
     */
    openAddModal() {
        document.getElementById('reminderModalTitle').textContent = 'Додати нагадування';
        document.getElementById('reminderForm').reset();
        document.getElementById('reminderId').value = '';
        document.getElementById('reminderDate').value = new Date().toISOString().split('T')[0];

        if (App.currentCar) {
            document.getElementById('reminderCarId').value = App.currentCar;
        }

        document.getElementById('reminderModal').classList.add('active');
    },

    /**
     * Обробка форми
     */
    handleFormSubmit(e) {
        e.preventDefault();

        const reminderId = document.getElementById('reminderId').value;
        const reminderData = {
            carId: document.getElementById('reminderCarId').value,
            type: document.getElementById('reminderType').value,
            date: document.getElementById('reminderDate').value,
            mileage: document.getElementById('reminderMileage').value,
            note: document.getElementById('reminderNote').value
        };

        if (reminderId) {
            this.update(reminderId, reminderData);
        } else {
            this.add(reminderData);
        }

        document.getElementById('reminderModal').classList.remove('active');
        this.renderGrid(App.currentCar);
        this.renderUpcomingPreview();
    }
};
