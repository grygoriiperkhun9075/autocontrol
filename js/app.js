/**
 * App Module - Головний модуль додатку
 */

const App = {
    currentSection: 'dashboard',
    currentCar: null,
    currentPeriod: 'all',
    customDateFrom: null,
    customDateTo: null,

    /**
     * Ініціалізація додатку
     */
    async init() {
        // Синхронізація з сервером
        await this.syncFromServer();

        this.initNavigation();
        this.initModals();
        this.initForms();
        this.initCarSelector();
        this.initPeriodSelector();
        this.initMobileMenu();
        this.initSyncButton();
        this.initLogout();
        this.loadCompanyInfo();
        Export.init();

        // Початковий рендеринг
        this.render();

        // Автоматична синхронізація кожні 30 секунд
        setInterval(() => this.syncFromServer(), 30000);

        console.log('🚗 АвтоКонтроль запущено!');
    },

    /**
     * Синхронізація з сервером
     */
    async syncFromServer() {
        const synced = await Storage.syncFromServer();
        if (synced) {
            this.render();
        }
    },

    /**
     * Ініціалізація кнопки синхронізації
     */
    initSyncButton() {
        var syncBtn = document.getElementById('syncBtn');
        if (syncBtn) {
            syncBtn.addEventListener('click', async () => {
                syncBtn.disabled = true;
                syncBtn.innerHTML = '<span class="nav-icon">⏳</span><span class="nav-text">Синхронізація...</span>';

                await Storage.forceSync();
                this.render();

                syncBtn.disabled = false;
                syncBtn.innerHTML = '<span class="nav-icon">🔄</span><span class="nav-text">Синхронізувати</span>';
            });
        }
    },

    /**
     * Ініціалізація кнопки виходу
     */
    initLogout() {
        var logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                try {
                    await fetch('/api/auth/logout', { method: 'POST' });
                } catch (e) { /* ignore */ }
                window.location.href = '/login';
            });
        }
    },

    /**
     * Завантаження інформації про компанію
     */
    async loadCompanyInfo() {
        try {
            const response = await fetch('/api/me');
            if (response.ok) {
                const data = await response.json();
                var nameEl = document.getElementById('companyName');
                if (nameEl && data.companyName) {
                    nameEl.textContent = data.companyName;
                }
            }
        } catch (e) { /* ignore */ }
    },


    /**
     * Ініціалізація навігації
     */
    initNavigation() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const section = e.currentTarget.dataset.section;
                this.navigateTo(section);
            });
        });
    },

    /**
     * Навігація до секції
     */
    navigateTo(section) {
        // Оновлення активного пункту меню
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.section === section);
        });

        // Оновлення активної секції
        document.querySelectorAll('.content-section').forEach(sec => {
            sec.classList.toggle('active', sec.id === `section-${section}`);
        });

        // Оновлення заголовка
        const titles = {
            'dashboard': 'Головна',
            'maintenance': 'Технічне обслуговування',
            'documents': 'Документи',
            'cars': 'Автомобілі',
            'fuel': 'Заправки',
            'coupons': 'Талони',
            'drivers': 'Водії',
            'expenses': 'Витрати',
            'reminders': 'Нагадування',
            'statistics': 'Статистика'
        };
        document.getElementById('pageTitle').textContent = titles[section] || section;

        this.currentSection = section;

        // Закриття мобільного меню
        document.getElementById('sidebar').classList.remove('open');
        var overlay = document.querySelector('.sidebar-overlay');
        if (overlay) overlay.classList.remove('active');

        // Рендеринг секції
        this.renderSection(section);
    },

    /**
     * Рендеринг секції
     */
    renderSection(section) {
        const carId = this.currentCar;

        switch (section) {
            case 'dashboard':
                this.updateDashboard();
                break;
            case 'cars':
                Cars.renderList();
                break;
            case 'fuel':
                Fuel.renderTable(carId);
                Fuel.updateStats(carId);
                break;
            case 'coupons':
                Coupons.renderSection(this.currentPeriod);
                break;
            case 'drivers':
                Drivers.renderSection();
                break;
            case 'expenses':
                Expenses.renderTable(carId);
                Expenses.renderCategories(carId);
                break;
            case 'reminders':
                Reminders.renderGrid(carId);
                break;
            case 'maintenance':
                Maintenance.renderGrid(carId);
                break;
            case 'documents':
                Documents.renderGrid(carId);
                break;
            case 'statistics':
                Charts.updateStatistics(carId, this.getStatsPeriod());
                break;
        }
    },

    /**
     * Повний рендеринг
     */
    render() {
        Cars.updateSelectors();
        this.renderSection(this.currentSection);
    },

    /**
     * Оновлення Dashboard
     */
    updateDashboard() {
        const carId = this.currentCar;
        const period = this.currentPeriod;
        const cars = Cars.getAll();

        // Статистика
        document.getElementById('totalCars').textContent = cars.length;

        const avgConsumption = Fuel.getAverageConsumption(carId, period);
        document.getElementById('avgConsumption').textContent = avgConsumption || '0';

        let totalMileage = 0;
        if (carId) {
            totalMileage = Cars.getCurrentMileage(carId);
        } else {
            cars.forEach(car => {
                totalMileage += Cars.getCurrentMileage(car.id);
            });
        }
        document.getElementById('totalMileage').textContent = totalMileage.toLocaleString();

        const fuelCost = Fuel.getTotalFuelCost(carId, period);
        const expensesCost = Expenses.getTotalExpenses(carId, period);
        document.getElementById('totalExpenses').textContent = (fuelCost + expensesCost).toLocaleString();

        // Графіки
        Charts.updateDashboard(carId, period);

        // Нагадування
        Reminders.renderUpcomingPreview();

        // Dashboard статуси ТО та Документів
        const maintStatus = Maintenance.getDashboardStatus();
        const maintEl = document.getElementById('maintenanceStatus');
        const maintLbl = document.getElementById('maintenanceStatusLabel');
        if (maintEl) maintEl.textContent = maintStatus.emoji;
        if (maintLbl) maintLbl.textContent = maintStatus.label;
        const maintCard = document.getElementById('dashMaintenanceCard');
        if (maintCard) maintCard.className = `stat-card ${maintStatus.status === 'danger' ? 'stat-danger' : maintStatus.status === 'warning' ? 'stat-warning' : ''}`;

        const docStatus = Documents.getDashboardStatus();
        const docEl = document.getElementById('documentsStatus');
        const docLbl = document.getElementById('documentsStatusLabel');
        if (docEl) docEl.textContent = docStatus.emoji;
        if (docLbl) docLbl.textContent = docStatus.label;
        const docCard = document.getElementById('dashDocumentsCard');
        if (docCard) docCard.className = `stat-card ${docStatus.status === 'danger' ? 'stat-danger' : docStatus.status === 'warning' ? 'stat-warning' : ''}`;
    },

    /**
     * Ініціалізація селектора періоду
     */
    initPeriodSelector() {
        var periodSelect = document.getElementById('currentPeriodSelect');
        var dateRange = document.getElementById('dashboardDateRange');
        var dateFrom = document.getElementById('dashboardDateFrom');
        var dateTo = document.getElementById('dashboardDateTo');

        if (periodSelect) {
            periodSelect.addEventListener('change', (e) => {
                this.currentPeriod = e.target.value || 'all';
                if (this.currentPeriod === 'custom') {
                    dateRange.style.display = 'flex';
                    // Default: last month
                    if (!dateFrom.value) {
                        const now = new Date();
                        dateTo.value = now.toISOString().split('T')[0];
                        const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
                        dateFrom.value = monthAgo.toISOString().split('T')[0];
                    }
                    this.customDateFrom = dateFrom.value;
                    this.customDateTo = dateTo.value;
                } else {
                    dateRange.style.display = 'none';
                }
                this.renderSection(this.currentSection);
            });
        }

        if (dateFrom) {
            dateFrom.addEventListener('change', () => {
                this.customDateFrom = dateFrom.value;
                if (this.currentPeriod === 'custom') this.renderSection(this.currentSection);
            });
        }
        if (dateTo) {
            dateTo.addEventListener('change', () => {
                this.customDateTo = dateTo.value;
                if (this.currentPeriod === 'custom') this.renderSection(this.currentSection);
            });
        }
    },


    /**
     * Ініціалізація модальних вікон
     */
    initModals() {
        // Кнопки відкриття
        document.getElementById('addCarBtn').addEventListener('click', () => Cars.openAddModal());
        document.getElementById('addFuelBtn').addEventListener('click', () => {
            if (Cars.getAll().length === 0) {
                alert('Спочатку додайте автомобіль');
                return;
            }
            Fuel.openAddModal();
        });
        document.getElementById('addExpenseBtn').addEventListener('click', () => {
            if (Cars.getAll().length === 0) {
                alert('Спочатку додайте автомобіль');
                return;
            }
            Expenses.openAddModal();
        });
        document.getElementById('addCouponBtn').addEventListener('click', () => Coupons.openAddModal());
        document.getElementById('addDriverBtn').addEventListener('click', () => {
            document.getElementById('driverModal').classList.add('active');
        });
        document.getElementById('addReminderBtn').addEventListener('click', () => {
            if (Cars.getAll().length === 0) {
                alert('Спочатку додайте автомобіль');
                return;
            }
            Reminders.openAddModal();
        });
        document.getElementById('addMaintenanceBtn').addEventListener('click', () => {
            if (Cars.getAll().length === 0) {
                alert('Спочатку додайте автомобіль');
                return;
            }
            Maintenance.openAddModal();
        });
        document.getElementById('addDocumentBtn').addEventListener('click', () => Documents.openAddModal());
        document.getElementById('exportBtn').addEventListener('click', () => Export.openModal());

        // Закриття модальних вікон
        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modalId = e.currentTarget.dataset.close;
                document.getElementById(modalId).classList.remove('active');
            });
        });

        // Закриття при кліку на фон
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        });

        // Закриття по Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal.active').forEach(modal => {
                    modal.classList.remove('active');
                });
            }
        });
    },

    /**
     * Ініціалізація форм
     */
    initForms() {
        document.getElementById('carForm').addEventListener('submit', (e) => Cars.handleFormSubmit(e));
        document.getElementById('fuelForm').addEventListener('submit', (e) => Fuel.handleFormSubmit(e));
        document.getElementById('expenseForm').addEventListener('submit', (e) => Expenses.handleFormSubmit(e));
        document.getElementById('reminderForm').addEventListener('submit', (e) => Reminders.handleFormSubmit(e));
        document.getElementById('couponForm').addEventListener('submit', (e) => Coupons.handleFormSubmit(e));
        document.getElementById('maintenanceForm').addEventListener('submit', (e) => Maintenance.handleFormSubmit(e));
        document.getElementById('documentForm').addEventListener('submit', (e) => Documents.handleFormSubmit(e));
    },

    /**
     * Ініціалізація селектора авто
     */
    initCarSelector() {
        document.getElementById('currentCarSelect').addEventListener('change', (e) => {
            this.currentCar = e.target.value || null;
            this.renderSection(this.currentSection);
        });

        // Фільтри статистики
        var statsCarFilter = document.getElementById('statsCarFilter');
        if (statsCarFilter) {
            statsCarFilter.addEventListener('change', (e) => {
                this.currentCar = e.target.value || null;
                document.getElementById('currentCarSelect').value = this.currentCar || '';
                Charts.updateStatistics(this.currentCar, this.getStatsPeriod());
            });
        }

        var statsPeriodFilter = document.getElementById('statsPeriodFilter');
        var statsDateRange = document.getElementById('statsDateRange');
        var statsDateFrom = document.getElementById('statsDateFrom');
        var statsDateTo = document.getElementById('statsDateTo');

        if (statsPeriodFilter) {
            statsPeriodFilter.addEventListener('change', () => {
                if (statsPeriodFilter.value === 'custom') {
                    statsDateRange.style.display = 'flex';
                    if (!statsDateFrom.value) {
                        const now = new Date();
                        statsDateTo.value = now.toISOString().split('T')[0];
                        const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
                        statsDateFrom.value = monthAgo.toISOString().split('T')[0];
                    }
                } else {
                    statsDateRange.style.display = 'none';
                }
                Charts.updateStatistics(this.currentCar, this.getStatsPeriod());
            });
        }

        if (statsDateFrom) {
            statsDateFrom.addEventListener('change', () => {
                if (statsPeriodFilter && statsPeriodFilter.value === 'custom') {
                    Charts.updateStatistics(this.currentCar, this.getStatsPeriod());
                }
            });
        }
        if (statsDateTo) {
            statsDateTo.addEventListener('change', () => {
                if (statsPeriodFilter && statsPeriodFilter.value === 'custom') {
                    Charts.updateStatistics(this.currentCar, this.getStatsPeriod());
                }
            });
        }
    },

    /**
     * Отримання періоду для статистики
     */
    getStatsPeriod() {
        var filter = document.getElementById('statsPeriodFilter');
        var period = (filter && filter.value) || 'all';
        if (period === 'custom') {
            return {
                type: 'custom',
                from: document.getElementById('statsDateFrom')?.value || null,
                to: document.getElementById('statsDateTo')?.value || null
            };
        }
        return period;
    },

    /**
     * Ініціалізація мобільного меню
     */
    initMobileMenu() {
        const sidebar = document.getElementById('sidebar');
        const mobileMenuBtn = document.getElementById('mobileMenuBtn');

        // Створення overlay
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        document.body.appendChild(overlay);

        mobileMenuBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('active');
        });

        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        });
    }
};

// Запуск додатку
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
