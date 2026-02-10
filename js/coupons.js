/**
 * Coupons Module — Облік талонів на пальне
 */

const Coupons = {
    /**
     * Отримання всіх записів купівлі талонів
     */
    getAll() {
        return Storage.get(Storage.KEYS.COUPONS)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
    },

    /**
     * Додавання купівлі талонів
     */
    add(data) {
        const coupon = {
            date: data.date,
            liters: parseFloat(data.liters),
            pricePerLiter: parseFloat(data.pricePerLiter) || 0,
            supplier: data.supplier || '',
            note: data.note || ''
        };
        return Storage.add(Storage.KEYS.COUPONS, coupon);
    },

    /**
     * Видалення запису
     */
    delete(id) {
        return Storage.delete(Storage.KEYS.COUPONS, id);
    },

    /**
     * Загально куплено літрів по талонах
     */
    getTotalPurchased(period = 'all') {
        let records = this.getAll();
        records = Fuel.filterByPeriod(records, period);
        return records.reduce((sum, c) => sum + c.liters, 0);
    },

    /**
     * Загально витрачено на талони (грн)
     */
    getTotalCost(period = 'all') {
        let records = this.getAll();
        records = Fuel.filterByPeriod(records, period);
        return records.reduce((sum, c) => sum + (c.liters * (c.pricePerLiter || 0)), 0);
    },

    /**
     * Баланс: куплено - заправлено
     */
    getBalance(period = 'all') {
        const purchased = this.getTotalPurchased(period);
        const used = Fuel.getTotalLiters(null, period);
        return {
            purchased: purchased,
            used: used,
            balance: purchased - used,
            percent: purchased > 0 ? ((used / purchased) * 100).toFixed(1) : 0
        };
    },

    /**
     * Деталі використання по авто
     */
    getUsageByCarDetails(period = 'all') {
        const cars = Cars.getAll();
        return cars.map(car => {
            const litersUsed = Fuel.getTotalLiters(car.id, period);
            const fuelCost = Fuel.getTotalFuelCost(car.id, period);
            const fuelRecords = Fuel.getAll(car.id);
            const filtered = Fuel.filterByPeriod(fuelRecords, period);
            return {
                carId: car.id,
                name: Cars.getDisplayName(car.id),
                plate: car.plate,
                litersUsed: litersUsed,
                fuelCost: fuelCost,
                refuelCount: filtered.length
            };
        });
    },

    /**
     * Форматування дати
     */
    formatDate(dateString) {
        return new Date(dateString).toLocaleDateString('uk-UA');
    },

    /**
     * Рендеринг секції талонів
     */
    renderSection(period = 'all') {
        const balance = this.getBalance(period);
        const coupons = this.getAll();
        const carDetails = this.getUsageByCarDetails(period);

        // Stat cards
        const balanceClass = balance.balance >= 0 ? 'positive' : 'negative';
        const balanceSign = balance.balance >= 0 ? '+' : '';

        document.getElementById('couponsPurchased').textContent = balance.purchased.toFixed(1);
        document.getElementById('couponsUsed').textContent = balance.used.toFixed(1);

        const balanceEl = document.getElementById('couponsBalance');
        balanceEl.textContent = `${balanceSign}${balance.balance.toFixed(1)}`;
        balanceEl.className = `stat-value coupon-balance-${balanceClass}`;

        const statusEl = document.getElementById('couponsStatus');
        if (balance.balance > 0) {
            statusEl.textContent = `Залишок (${balance.percent}% використано)`;
            statusEl.className = 'stat-label coupon-status-ok';
        } else if (balance.balance < 0) {
            statusEl.textContent = `Перевитрата! (${balance.percent}% використано)`;
            statusEl.className = 'stat-label coupon-status-warning';
        } else {
            statusEl.textContent = 'Баланс в нулі';
            statusEl.className = 'stat-label';
        }

        // Таблиця купівель
        this.renderPurchaseTable(coupons);

        // Таблиця використання по авто
        this.renderUsageTable(carDetails, balance.purchased);
    },

    /**
     * Рендеринг таблиці купівель талонів
     */
    renderPurchaseTable(coupons) {
        const tbody = document.getElementById('couponsTableBody');
        if (coupons.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-message">Немає записів про купівлю талонів</td></tr>';
            return;
        }

        tbody.innerHTML = coupons.map(c => `
            <tr data-coupon-id="${c.id}">
                <td>${this.formatDate(c.date)}</td>
                <td><strong>${c.liters.toFixed(1)} л</strong></td>
                <td>${c.pricePerLiter ? c.pricePerLiter.toFixed(2) + ' грн' : '—'}</td>
                <td>${c.pricePerLiter ? (c.liters * c.pricePerLiter).toFixed(2) + ' грн' : '—'}</td>
                <td>${c.supplier || '—'}</td>
                <td>
                    <div class="table-actions">
                        <button class="table-action-btn delete delete-coupon" title="Видалити">🗑️</button>
                    </div>
                </td>
            </tr>
        `).join('');

        this.attachEventListeners();
    },

    /**
     * Рендеринг таблиці використання по авто
     */
    renderUsageTable(carDetails, totalPurchased) {
        const tbody = document.getElementById('usageTableBody');
        if (carDetails.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-message">Немає автомобілів</td></tr>';
            return;
        }

        const totalUsed = carDetails.reduce((sum, c) => sum + c.litersUsed, 0);

        tbody.innerHTML = carDetails.map(car => {
            const sharePercent = totalPurchased > 0 ? ((car.litersUsed / totalPurchased) * 100).toFixed(1) : 0;
            return `
                <tr>
                    <td>
                        <strong>${car.name}</strong>
                        <br><small>${car.plate}</small>
                    </td>
                    <td><strong>${car.litersUsed.toFixed(1)} л</strong></td>
                    <td>${car.refuelCount}</td>
                    <td>
                        <div class="usage-bar-container">
                            <div class="usage-bar" style="width: ${Math.min(sharePercent, 100)}%"></div>
                            <span class="usage-percent">${sharePercent}%</span>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // Підсумковий рядок
        const shareTotal = totalPurchased > 0 ? ((totalUsed / totalPurchased) * 100).toFixed(1) : 0;
        tbody.innerHTML += `
            <tr class="total-row">
                <td><strong>ВСЬОГО</strong></td>
                <td><strong>${totalUsed.toFixed(1)} л</strong></td>
                <td>${carDetails.reduce((sum, c) => sum + c.refuelCount, 0)}</td>
                <td><strong>${shareTotal}%</strong></td>
            </tr>
        `;
    },

    /**
     * Підключення обробників
     */
    attachEventListeners() {
        document.querySelectorAll('.delete-coupon').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const couponId = e.target.closest('tr').dataset.couponId;
                if (confirm('Видалити цей запис?')) {
                    this.delete(couponId);
                    this.renderSection(App.currentPeriod);
                }
            });
        });
    },

    /**
     * Відкриття модального вікна
     */
    openAddModal() {
        document.getElementById('couponForm').reset();
        document.getElementById('couponDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('couponModal').classList.add('active');
    },

    /**
     * Обробка форми
     */
    handleFormSubmit(e) {
        e.preventDefault();

        const data = {
            date: document.getElementById('couponDate').value,
            liters: document.getElementById('couponLiters').value,
            pricePerLiter: document.getElementById('couponPrice').value,
            supplier: document.getElementById('couponSupplier').value,
            note: document.getElementById('couponNote').value
        };

        this.add(data);
        document.getElementById('couponModal').classList.remove('active');
        this.renderSection(App.currentPeriod);
    }
};
