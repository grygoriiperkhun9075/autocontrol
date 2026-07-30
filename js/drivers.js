/**
 * Drivers Module — управління водіями та перегляд використання талонів
 */

const Drivers = {
    drivers: [],
    couponUsage: [],

    /**
     * Рендеринг секції водіїв
     */
    async renderSection() {
        await this.loadData();
        this.renderDriversTable();
        this.renderUsageTable();
        this.renderStats();
        this.updateBotLink();
    },

    /**
     * Завантаження даних з сервера
     */
    async loadData() {
        try {
            const [driversResp, usageResp] = await Promise.all([
                fetch('/api/drivers', { credentials: 'include' }),
                fetch('/api/drivers/coupon-usage', { credentials: 'include' })
            ]);
            this.drivers = await driversResp.json();
            this.couponUsage = await usageResp.json();
        } catch (e) {
            console.error('Drivers load error:', e);
        }
    },

    /**
     * Статистика водіїв
     */
    renderStats() {
        const totalDrivers = this.drivers.length;
        const totalUsageLiters = this.couponUsage.reduce((sum, u) => sum + (u.liters || 0), 0);
        const totalRefills = this.couponUsage.reduce((sum, u) => sum + (u.count || 0), 0);

        document.getElementById('driversCount').textContent = totalDrivers;
        document.getElementById('driversCouponLiters').textContent = Math.round(totalUsageLiters);
        document.getElementById('driversCouponRefills').textContent = totalRefills;
    },

    /**
     * Таблиця водіїв
     */
    renderDriversTable() {
        const tbody = document.getElementById('driversTableBody');
        if (!tbody) return;

        if (this.drivers.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="empty-message">Водіїв ще не додано. Додайте водіїв через бота або цю форму.</td></tr>`;
            return;
        }

        tbody.innerHTML = this.drivers.map(d => {
            const date = d.addedAt ? new Date(d.addedAt).toLocaleDateString('uk-UA') : '—';
            return `<tr>
                <td><strong>${this._escapeHtml(d.name || 'Водій')}</strong></td>
                <td><code>${d.chatId}</code></td>
                <td>${date}</td>
                <td>
                    <button class="btn btn-danger btn-sm" onclick="Drivers.removeDriver('${d.chatId}')">
                        🗑️ Видалити
                    </button>
                </td>
            </tr>`;
        }).join('');
    },

    /**
     * Таблиця використання талонів по водіях
     */
    renderUsageTable() {
        const tbody = document.getElementById('driversUsageBody');
        if (!tbody) return;

        if (this.couponUsage.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="empty-message">Немає даних. Дані з'являться коли водії почнуть заправлятися через талони в боті.</td></tr>`;
            return;
        }

        tbody.innerHTML = this.couponUsage.map(u => {
            const lastDate = u.lastDate ? new Date(u.lastDate).toLocaleDateString('uk-UA') : '—';
            return `<tr>
                <td><strong>${this._escapeHtml(u.driverName)}</strong></td>
                <td>${this._escapeHtml(u.carPlate)}</td>
                <td><strong>${Math.round(u.liters)} л</strong></td>
                <td>${u.count}</td>
                <td>${lastDate}</td>
            </tr>`;
        }).join('');
    },

    /**
     * Додати водія
     */
    async addDriver(e) {
        e.preventDefault();
        const chatId = document.getElementById('driverChatId').value.trim();
        const name = document.getElementById('driverName').value.trim();

        if (!chatId) return alert('Введіть Chat ID водія');

        try {
            const resp = await fetch('/api/drivers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ chatId: parseInt(chatId), name: name || 'Водій' })
            });
            const result = await resp.json();

            if (result.success) {
                document.getElementById('driverForm').reset();
                document.getElementById('driverModal').classList.remove('active');
                this.renderSection();
            } else if (result.reason === 'already_exists') {
                alert('Водій з таким Chat ID вже додано');
            }
        } catch (e) {
            console.error('Add driver error:', e);
            alert('Помилка додавання водія');
        }
    },

    /**
     * Видалити водія
     */
    async removeDriver(chatId) {
        if (!confirm('Видалити цього водія?')) return;

        try {
            await fetch(`/api/drivers/${chatId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            this.renderSection();
        } catch (e) {
            console.error('Remove driver error:', e);
        }
    },

    /**
     * Оновлення посилання на Telegram-бота з компанією в параметрах
     */
    async updateBotLink() {
        const linkEl = document.getElementById('telegramBotLink');
        if (!linkEl) return;
        try {
            const resp = await fetch('/api/bot-info');
            if (resp.ok) {
                const data = await resp.json();
                if (data.configured && data.botUsername) {
                    linkEl.href = `https://t.me/${data.botUsername}?start=${data.companyId}`;
                    linkEl.style.display = 'inline-flex';
                } else {
                    linkEl.style.display = 'none';
                }
            }
        } catch (e) {
            console.error('Error fetching bot info:', e);
            linkEl.style.display = 'none';
        }
    },

    /**
     * Escape HTML
     */
    _escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
};
