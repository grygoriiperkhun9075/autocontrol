/**
 * Expenses Module - Управління витратами
 */

const Expenses = {
    CATEGORIES: {
        'repair': { icon: '🔧', label: 'Ремонт' },
        'maintenance': { icon: '🛠️', label: 'ТО' },
        'insurance': { icon: '📋', label: 'Страховка' },
        'tax': { icon: '📄', label: 'Податок' },
        'parking': { icon: '🅿️', label: 'Паркування' },
        'wash': { icon: '🧽', label: 'Мийка' },
        'tires': { icon: '🛞', label: 'Шини' },
        'other': { icon: '📦', label: 'Інше' }
    },

    /**
     * Отримання всіх витрат
     */
    getAll(carId = null) {
        let records = Storage.get(Storage.KEYS.EXPENSES);
        if (carId) {
            records = records.filter(r => r.carId === carId);
        }
        return records.sort((a, b) => new Date(b.date) - new Date(a.date));
    },

    /**
     * Отримання витрати за ID
     */
    getById(id) {
        return Storage.findById(Storage.KEYS.EXPENSES, id);
    },

    /**
     * Додавання витрати
     */
    add(expenseData) {
        const expense = {
            carId: expenseData.carId,
            date: expenseData.date,
            category: expenseData.category,
            amount: parseFloat(expenseData.amount),
            description: expenseData.description || ''
        };
        return Storage.add(Storage.KEYS.EXPENSES, expense);
    },

    /**
     * Оновлення витрати
     */
    update(id, expenseData) {
        return Storage.update(Storage.KEYS.EXPENSES, id, {
            carId: expenseData.carId,
            date: expenseData.date,
            category: expenseData.category,
            amount: parseFloat(expenseData.amount),
            description: expenseData.description || ''
        });
    },

    /**
     * Видалення витрати
     */
    delete(id) {
        return Storage.delete(Storage.KEYS.EXPENSES, id);
    },

    /**
     * Отримання загальних витрат
     */
    getTotalExpenses(carId = null, period = 'all') {
        let records = this.getAll(carId);
        records = this.filterByPeriod(records, period);
        return records.reduce((acc, r) => acc + r.amount, 0);
    },

    /**
     * Отримання витрат по категоріях
     */
    getByCategories(carId = null, period = 'all') {
        let records = this.getAll(carId);
        records = this.filterByPeriod(records, period);

        const categories = {};

        records.forEach(record => {
            if (!categories[record.category]) {
                categories[record.category] = 0;
            }
            categories[record.category] += record.amount;
        });

        return categories;
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
     * Отримання іконки категорії
     */
    getCategoryIcon(category) {
        return (this.CATEGORIES[category] && this.CATEGORIES[category].icon) || '📦';
    },

    /**
     * Отримання назви категорії
     */
    getCategoryLabel(category) {
        return (this.CATEGORIES[category] && this.CATEGORIES[category].label) || 'Інше';
    },

    /**
     * Форматування дати
     */
    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('uk-UA');
    },

    /**
     * Рендеринг категорій
     */
    renderCategories(carId = null) {
        const categories = this.getByCategories(carId);
        const container = document.getElementById('expenseCategories');

        if (Object.keys(categories).length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = Object.entries(categories).map(([cat, amount]) => `
            <div class="expense-cat-card">
                <span class="expense-cat-icon">${this.getCategoryIcon(cat)}</span>
                <div class="expense-cat-info">
                    <span class="expense-cat-value">${amount.toLocaleString()} грн</span>
                    <span class="expense-cat-label">${this.getCategoryLabel(cat)}</span>
                </div>
            </div>
        `).join('');
    },

    /**
     * Рендеринг таблиці витрат
     */
    renderTable(carId = null) {
        const records = this.getAll(carId);
        const tbody = document.getElementById('expensesTableBody');

        if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-message">Немає записів про витрати</td></tr>';
            return;
        }

        tbody.innerHTML = records.map(record => `
            <tr data-expense-id="${record.id}">
                <td>${this.formatDate(record.date)}</td>
                <td>${Cars.getDisplayName(record.carId)}</td>
                <td>${this.getCategoryIcon(record.category)} ${this.getCategoryLabel(record.category)}</td>
                <td>${record.description || '--'}</td>
                <td>${record.amount.toLocaleString()} грн</td>
                <td>
                    <div class="table-actions">
                        <button class="table-action-btn edit-expense" title="Редагувати">✏️</button>
                        <button class="table-action-btn delete delete-expense" title="Видалити">🗑️</button>
                    </div>
                </td>
            </tr>
        `).join('');

        this.attachEventListeners();
    },

    /**
     * Підключення обробників подій
     */
    attachEventListeners() {
        document.querySelectorAll('.edit-expense').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const expenseId = e.target.closest('tr').dataset.expenseId;
                this.openEditModal(expenseId);
            });
        });

        document.querySelectorAll('.delete-expense').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const expenseId = e.target.closest('tr').dataset.expenseId;
                if (confirm('Видалити цей запис?')) {
                    this.delete(expenseId);
                    this.renderTable(App.currentCar);
                    this.renderCategories(App.currentCar);
                    Cars.renderList();
                    App.updateDashboard();
                }
            });
        });
    },

    /**
     * Відкриття модального вікна для редагування
     */
    openEditModal(expenseId) {
        const expense = this.getById(expenseId);
        if (!expense) return;

        document.getElementById('expenseModalTitle').textContent = 'Редагувати витрату';
        document.getElementById('expenseId').value = expense.id;
        document.getElementById('expenseCarId').value = expense.carId;
        document.getElementById('expenseDate').value = expense.date;
        document.getElementById('expenseCategory').value = expense.category;
        document.getElementById('expenseAmount').value = expense.amount;
        document.getElementById('expenseDescription').value = expense.description || '';

        document.getElementById('expenseModal').classList.add('active');
    },

    /**
     * Відкриття модального вікна для додавання
     */
    openAddModal() {
        document.getElementById('expenseModalTitle').textContent = 'Додати витрату';
        document.getElementById('expenseForm').reset();
        document.getElementById('expenseId').value = '';
        document.getElementById('expenseDate').value = new Date().toISOString().split('T')[0];

        if (App.currentCar) {
            document.getElementById('expenseCarId').value = App.currentCar;
        }

        document.getElementById('expenseModal').classList.add('active');
    },

    /**
     * Обробка форми
     */
    handleFormSubmit(e) {
        e.preventDefault();

        const expenseId = document.getElementById('expenseId').value;
        const expenseData = {
            carId: document.getElementById('expenseCarId').value,
            date: document.getElementById('expenseDate').value,
            category: document.getElementById('expenseCategory').value,
            amount: document.getElementById('expenseAmount').value,
            description: document.getElementById('expenseDescription').value
        };

        if (expenseId) {
            this.update(expenseId, expenseData);
        } else {
            this.add(expenseData);
        }

        document.getElementById('expenseModal').classList.remove('active');
        this.renderTable(App.currentCar);
        this.renderCategories(App.currentCar);
        Cars.renderList();
        App.updateDashboard();
    }
};
