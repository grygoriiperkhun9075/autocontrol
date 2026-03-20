/**
 * Inventory Module — Інвентаризація: звірка з ОККО
 */

const Inventory = {
    data: null,
    loading: false,

    /**
     * Рендеринг секції інвентаризації
     */
    renderSection() {
        const container = document.getElementById('inventoryContent');
        if (!container) return;

        // Якщо дані ще не завантажені — показуємо стартовий екран
        if (!this.data) {
            this._renderStartScreen(container);
            return;
        }

        this._renderFullReport(container);
    },

    /**
     * Стартовий екран з фільтрами
     */
    _renderStartScreen(container) {
        // Дати за замовчуванням
        const today = new Date().toISOString().split('T')[0];
        const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const dateFromEl = document.getElementById('invDateFrom');
        const dateToEl = document.getElementById('invDateTo');
        if (dateFromEl && !dateFromEl.value) dateFromEl.value = monthAgo;
        if (dateToEl && !dateToEl.value) dateToEl.value = today;

        container.innerHTML = `
            <div class="inventory-empty">
                <div class="inventory-empty-icon">📦</div>
                <p>Виберіть період та натисніть <strong>«Завантажити»</strong> для звірки даних з ОККО</p>
            </div>
        `;
    },

    /**
     * Завантаження даних з сервера
     */
    async loadData() {
        if (this.loading) return;
        this.loading = true;

        const loadBtn = document.getElementById('invLoadBtn');
        if (loadBtn) {
            loadBtn.disabled = true;
            loadBtn.innerHTML = '⏳ Завантаження...';
        }

        try {
            const dateFrom = document.getElementById('invDateFrom')?.value || '';
            const dateTo = document.getElementById('invDateTo')?.value || '';

            const response = await fetch(`/api/inventory?dateFrom=${dateFrom}&dateTo=${dateTo}`);
            const result = await response.json();

            if (result.success) {
                this.data = result;
                this.renderSection();
            } else {
                alert('❌ Помилка: ' + (result.error || 'Невідома помилка'));
            }
        } catch (error) {
            alert('❌ Помилка з\'єднання: ' + error.message);
        } finally {
            this.loading = false;
            if (loadBtn) {
                loadBtn.disabled = false;
                loadBtn.innerHTML = '🔄 Завантажити з ОККО';
            }
        }
    },

    /**
     * Повний звіт
     */
    _renderFullReport(container) {
        const d = this.data;

        container.innerHTML = `
            ${this._renderSummaryCards(d)}
            ${this._renderDiscrepancies(d)}
            ${this._renderComparisonTable(d)}
            ${this._renderOkkoTransactions(d)}
            ${this._renderAdjustBlock(d)}
        `;
    },

    /**
     * Картки підсумків
     */
    _renderSummaryCards(d) {
        const { internal, okko, summary } = d;

        const okkoBalanceStr = okko.balance
            ? `${okko.balance.balance.toLocaleString()} грн`
            : (okko.error ? '⚠️ Немає зв\'язку' : '—');

        const balanceLitersStr = summary.balanceLiters !== null
            ? `≈ ${summary.balanceLiters} л`
            : '—';

        const priceStr = summary.lastDieselPrice > 0
            ? `${summary.lastDieselPrice.toFixed(2)} грн/л`
            : '—';

        const balanceClass = internal.calculatedBalance < 0 ? 'stat-danger' : '';

        return `
            <div class="dashboard-grid inventory-summary-grid">
                <div class="stat-card">
                    <div class="stat-icon">🎫</div>
                    <div class="stat-info">
                        <span class="stat-value">${internal.totalPurchasedLiters.toFixed(1)}</span>
                        <span class="stat-label">Куплено за період (л)</span>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">⛽</div>
                    <div class="stat-info">
                        <span class="stat-value">${internal.totalUsedLiters.toFixed(1)}</span>
                        <span class="stat-label">Заправлено за період (л)</span>
                    </div>
                </div>
                <div class="stat-card ${balanceClass}">
                    <div class="stat-icon">📊</div>
                    <div class="stat-info">
                        <span class="stat-value">${internal.calculatedBalance.toFixed(1)}</span>
                        <span class="stat-label">Розрахунковий залишок (л)</span>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">💳</div>
                    <div class="stat-info">
                        <span class="stat-value">${okkoBalanceStr}</span>
                        <span class="stat-label">Баланс ОККО</span>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">⛽</div>
                    <div class="stat-info">
                        <span class="stat-value">${balanceLitersStr}</span>
                        <span class="stat-label">Залишок за балансом</span>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">💰</div>
                    <div class="stat-info">
                        <span class="stat-value">${priceStr}</span>
                        <span class="stat-label">Остання ціна ДП</span>
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Блок розбіжностей
     */
    _renderDiscrepancies(d) {
        const { summary, okko } = d;

        if (okko.error && okko.transactions.length === 0) {
            return `
                <div class="inventory-discrepancy-block warning">
                    <h3>⚠️ Дані ОККО недоступні</h3>
                    <p>${okko.error}</p>
                    <p>Показуємо тільки внутрішні дані.</p>
                </div>
            `;
        }

        if (summary.discrepancies.length === 0) {
            return `
                <div class="inventory-discrepancy-block success">
                    <h3>✅ Розбіжностей не знайдено</h3>
                    <p>Внутрішні дані збігаються з ОККО.</p>
                </div>
            `;
        }

        const rows = summary.discrepancies.map(disc => `
            <div class="discrepancy-item ${disc.severity}">
                <span class="discrepancy-icon">${disc.severity === 'high' ? '🔴' : '🟡'}</span>
                <span class="discrepancy-text">${disc.description}</span>
                <span class="discrepancy-diff">${disc.difference > 0 ? '+' : ''}${disc.difference.toFixed(2)}</span>
            </div>
        `).join('');

        return `
            <div class="inventory-discrepancy-block danger">
                <h3>⚠️ Знайдено розбіжності (${summary.discrepancies.length})</h3>
                ${rows}
            </div>
        `;
    },

    /**
     * Таблиця порівняння — Наші дані
     */
    _renderComparisonTable(d) {
        const { internal } = d;

        // Купівлі талонів
        const purchaseRows = internal.purchases.map(c => {
            const isAdjustment = c.source === 'adjustment';
            return `
            <tr class="${isAdjustment ? 'adjustment-row' : ''}">
                <td>${this._formatDate(c.date)}</td>
                <td>${isAdjustment ? '🔧 Коригування' : '🎫 Купівля талонів'}</td>
                <td class="text-right text-positive">+${parseFloat(c.liters).toFixed(1)} л</td>
                <td class="text-right">${c.pricePerLiter ? parseFloat(c.pricePerLiter).toFixed(2) : '—'}</td>
                <td class="text-right">${c.pricePerLiter ? (parseFloat(c.liters) * parseFloat(c.pricePerLiter)).toFixed(2) : '—'}</td>
                <td>${c.supplier || c.note || '—'}</td>
            </tr>`;
        }).join('');

        // Заправки
        const fuelRows = internal.refuels.map(f => `
            <tr>
                <td>${this._formatDate(f.date)}</td>
                <td>⛽ Заправка</td>
                <td class="text-right text-negative">−${parseFloat(f.liters).toFixed(1)} л</td>
                <td class="text-right">${f.pricePerLiter ? parseFloat(f.pricePerLiter).toFixed(2) : '—'}</td>
                <td class="text-right">${f.pricePerLiter ? (parseFloat(f.liters) * parseFloat(f.pricePerLiter)).toFixed(2) : '—'}</td>
                <td>${f.station || '—'}</td>
            </tr>
        `).join('');

        if (!purchaseRows && !fuelRows) {
            return `
                <div class="coupon-table-section">
                    <h3>📝 Наші дані за період</h3>
                    <p class="empty-message">Немає записів за обраний період</p>
                </div>
            `;
        }

        return `
            <div class="coupon-table-section">
                <h3>📝 Наші дані за період</h3>
                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Дата</th>
                                <th>Тип</th>
                                <th>Літри</th>
                                <th>Ціна/л</th>
                                <th>Сума</th>
                                <th>Джерело</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${purchaseRows}
                            ${fuelRows}
                        </tbody>
                        <tfoot>
                            <tr class="total-row">
                                <td colspan="2"><strong>Підсумок:</strong></td>
                                <td class="text-right"><strong>+${internal.totalPurchasedLiters.toFixed(1)} / −${internal.totalUsedLiters.toFixed(1)} л</strong></td>
                                <td></td>
                                <td class="text-right"><strong>${internal.totalPurchasedCost.toFixed(2)} грн</strong></td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        `;
    },

    /**
     * Таблиця транзакцій ОККО
     */
    _renderOkkoTransactions(d) {
        const { okko } = d;

        if (okko.error && okko.transactions.length === 0) {
            return '';
        }

        if (okko.transactions.length === 0) {
            return `
                <div class="coupon-table-section">
                    <h3>🏢 Дані ОККО за період</h3>
                    <p class="empty-message">Транзакції не знайдено</p>
                </div>
            `;
        }

        const rows = okko.transactions.map(t => `
            <tr>
                <td>${this._formatDate(t.date)}</td>
                <td>${t.type || '—'}</td>
                <td>${t.cardNumber || '—'}</td>
                <td>${t.driverName || '—'}</td>
                <td>${t.productName || '—'}</td>
                <td class="text-right">${t.volume ? t.volume.toFixed(1) + ' л' : '—'}</td>
                <td class="text-right">${t.discount ? t.discount.toFixed(2) : '—'}</td>
                <td class="text-right">${t.price ? t.price.toFixed(2) : '—'}</td>
                <td class="text-right">${t.sum ? t.sum.toFixed(2) + ' грн' : '—'}</td>
                <td>${t.station || '—'}</td>
            </tr>
        `).join('');

        return `
            <div class="coupon-table-section">
                <h3>🏢 Дані ОККО за період (${okko.transactions.length} транзакцій)</h3>
                <div class="table-container">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Дата</th>
                                <th>Операція</th>
                                <th>Картка</th>
                                <th>ПІБ</th>
                                <th>Тип пального</th>
                                <th>Літраж</th>
                                <th>Знижка</th>
                                <th>Ціна</th>
                                <th>Сума</th>
                                <th>АЗК</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                        <tfoot>
                            <tr class="total-row">
                                <td colspan="5"><strong>Підсумок ОККО:</strong></td>
                                <td class="text-right"><strong>${okko.totalVolume.toFixed(1)} л</strong></td>
                                <td></td>
                                <td></td>
                                <td class="text-right"><strong>${okko.totalSum.toFixed(2)} грн</strong></td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        `;
    },

    /**
     * Блок коригування залишку
     */
    _renderAdjustBlock(d) {
        const { internal, summary, okko } = d;

        // Різниця між розрахунковим і фактичним
        let suggestedAdjust = 0;
        let adjustHint = '';

        if (summary.balanceLiters !== null) {
            suggestedAdjust = Math.round((summary.balanceLiters - internal.calculatedBalance) * 100) / 100;
            if (Math.abs(suggestedAdjust) > 0.5) {
                adjustHint = `Рекомендоване коригування: <strong>${suggestedAdjust > 0 ? '+' : ''}${suggestedAdjust} л</strong> (щоб привести залишок до ${summary.balanceLiters} л за балансом)`;
            }
        }

        return `
            <div class="inventory-adjust-block">
                <h3>🔧 Коригування залишку</h3>
                <p class="adjust-description">
                    Розрахунковий залишок: <strong>${internal.calculatedBalance.toFixed(1)} л</strong>
                    ${summary.balanceLiters !== null ? ` | Залишок за балансом ОККО: <strong>${summary.balanceLiters} л</strong>` : ''}
                    ${summary.lastDieselPrice > 0 ? ` (${summary.lastDieselPrice.toFixed(2)} грн/л)` : ''}
                </p>
                ${adjustHint ? `<p class="adjust-hint">${adjustHint}</p>` : ''}
                <div class="adjust-form">
                    <div class="form-row">
                        <div class="form-group">
                            <label for="adjustLiters">Коригування (літрів)</label>
                            <input type="number" id="adjustLiters" step="0.1" placeholder="${suggestedAdjust || '0'}"
                                value="${suggestedAdjust !== 0 ? suggestedAdjust : ''}">
                            <small>Додатнє значення — додати, від'ємне — зменшити</small>
                        </div>
                        <div class="form-group">
                            <label for="adjustNote">Примітка</label>
                            <input type="text" id="adjustNote" placeholder="Причина коригування" value="Інвентаризація ${d.period.dateTo}">
                        </div>
                    </div>
                    <button class="btn btn-primary" id="adjustSubmitBtn" onclick="Inventory.submitAdjustment()">
                        ✅ Застосувати коригування
                    </button>
                </div>
            </div>
        `;
    },

    /**
     * Відправка коригування
     */
    async submitAdjustment() {
        const liters = parseFloat(document.getElementById('adjustLiters')?.value);
        const note = document.getElementById('adjustNote')?.value || '';

        if (isNaN(liters) || liters === 0) {
            alert('Вкажіть кількість літрів для коригування');
            return;
        }

        const btn = document.getElementById('adjustSubmitBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '⏳ Зберігаю...';
        }

        try {
            const response = await fetch('/api/inventory/adjust', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ liters, note })
            });

            const result = await response.json();

            if (result.success) {
                alert(`✅ Коригування збережено: ${liters > 0 ? '+' : ''}${liters} л`);
                // Перезавантажуємо дані
                this.data = null;
                await Storage.syncFromServer();
                await this.loadData();
            } else {
                alert('❌ Помилка: ' + (result.error || 'Невідома помилка'));
            }
        } catch (error) {
            alert('❌ Помилка: ' + error.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '✅ Застосувати коригування';
            }
        }
    },

    /**
     * Форматування дати
     */
    _formatDate(dateStr) {
        if (!dateStr) return '—';
        try {
            // Спробуємо розпарсити різні формати
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
        } catch {
            return dateStr;
        }
    }
};
