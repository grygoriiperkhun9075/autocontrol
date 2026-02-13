/**
 * Documents Module — Управління документами
 */

const Documents = {
    TYPES: {
        'insurance': { icon: '📋', label: 'Страховка (ОСАГО/КАСКО)', daysWarning: 30 },
        'inspection': { icon: '🔍', label: 'Техогляд', daysWarning: 14 },
        'license': { icon: '🪪', label: 'Посвідчення водія', daysWarning: 30 },
        'permit': { icon: '📄', label: 'Ліцензія перевізника', daysWarning: 60 },
        'registration': { icon: '🚗', label: 'Свідоцтво про реєстрацію', daysWarning: 30 },
        'other': { icon: '📦', label: 'Інше', daysWarning: 14 }
    },

    getAll(carId = null) {
        let records = Storage.get(Storage.KEYS.DOCUMENTS);
        if (carId) {
            records = records.filter(d => d.carId === carId);
        }
        return records.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
    },

    getById(id) {
        return Storage.findById(Storage.KEYS.DOCUMENTS, id);
    },

    add(data) {
        return Storage.add(Storage.KEYS.DOCUMENTS, {
            carId: data.carId || null,
            type: data.type || 'other',
            number: data.number || '',
            issueDate: data.issueDate || '',
            expiryDate: data.expiryDate || '',
            note: data.note || ''
        });
    },

    update(id, data) {
        return Storage.update(Storage.KEYS.DOCUMENTS, id, {
            carId: data.carId || null,
            type: data.type,
            number: data.number,
            issueDate: data.issueDate,
            expiryDate: data.expiryDate,
            note: data.note
        });
    },

    delete(id) {
        return Storage.delete(Storage.KEYS.DOCUMENTS, id);
    },

    getTypeIcon(type) {
        return (this.TYPES[type] && this.TYPES[type].icon) || '📦';
    },

    getTypeLabel(type) {
        return (this.TYPES[type] && this.TYPES[type].label) || 'Інше';
    },

    /**
     * Статус документа: overdue / soon / normal
     */
    getStatus(doc) {
        if (!doc.expiryDate) return 'normal';
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expiry = new Date(doc.expiryDate);
        expiry.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) return 'overdue';
        const warningDays = (this.TYPES[doc.type] && this.TYPES[doc.type].daysWarning) || 14;
        if (diffDays <= warningDays) return 'soon';
        return 'normal';
    },

    getStatusBadge(status) {
        switch (status) {
            case 'overdue': return '🔴';
            case 'soon': return '🟡';
            default: return '🟢';
        }
    },

    getDaysLeft(doc) {
        if (!doc.expiryDate) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expiry = new Date(doc.expiryDate);
        expiry.setHours(0, 0, 0, 0);
        return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
    },

    formatDate(dateString) {
        if (!dateString) return '—';
        return new Date(dateString).toLocaleDateString('uk-UA');
    },

    /**
     * Рендеринг сітки документів
     */
    renderGrid(carId = null) {
        const records = this.getAll(carId);
        const container = document.getElementById('documentsGrid');
        if (!container) return;

        if (records.length === 0) {
            container.innerHTML = '<p class="empty-message">Немає документів. Додайте страховку, техогляд тощо.</p>';
            return;
        }

        container.innerHTML = records.map(doc => {
            const status = this.getStatus(doc);
            const daysLeft = this.getDaysLeft(doc);
            let daysText = '';
            if (daysLeft !== null) {
                if (daysLeft < 0) daysText = `⚠️ Протерміновано ${Math.abs(daysLeft)} дн.`;
                else if (daysLeft === 0) daysText = '⚠️ Закінчується сьогодні!';
                else daysText = `${daysLeft} дн. залишилось`;
            }

            return `
                <div class="document-card status-${status}" data-doc-id="${doc.id}">
                    <div class="document-card-header">
                        <span class="document-card-type">${this.getStatusBadge(status)} ${this.getTypeIcon(doc.type)} ${this.getTypeLabel(doc.type)}</span>
                        <div class="document-card-actions">
                            <button class="car-action-btn edit-document" title="Редагувати">✏️</button>
                            <button class="car-action-btn delete delete-document" title="Видалити">🗑️</button>
                        </div>
                    </div>
                    ${doc.number ? `<div class="document-card-number">📝 ${doc.number}</div>` : ''}
                    <div class="document-card-expiry">📅 Діє до: ${this.formatDate(doc.expiryDate)}</div>
                    ${daysText ? `<div class="document-card-days ${status}">${daysText}</div>` : ''}
                    ${doc.carId ? `<div class="document-card-car">🚗 ${Cars.getDisplayName(doc.carId)}</div>` : '<div class="document-card-car">📌 Загальний</div>'}
                    ${doc.note ? `<div class="document-card-note">${doc.note}</div>` : ''}
                </div>
            `;
        }).join('');

        this.attachEventListeners();
    },

    attachEventListeners() {
        document.querySelectorAll('.edit-document').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.closest('.document-card').dataset.docId;
                this.openEditModal(id);
            });
        });

        document.querySelectorAll('.delete-document').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.closest('.document-card').dataset.docId;
                if (confirm('Видалити цей документ?')) {
                    this.delete(id);
                    this.renderGrid(App.currentCar);
                }
            });
        });
    },

    openAddModal() {
        document.getElementById('documentModalTitle').textContent = 'Додати документ';
        document.getElementById('documentForm').reset();
        document.getElementById('documentId').value = '';
        document.getElementById('documentModal').classList.add('active');
    },

    openEditModal(id) {
        const doc = this.getById(id);
        if (!doc) return;

        document.getElementById('documentModalTitle').textContent = 'Редагувати документ';
        document.getElementById('documentId').value = doc.id;
        document.getElementById('docCarId').value = doc.carId || '';
        document.getElementById('docType').value = doc.type;
        document.getElementById('docNumber').value = doc.number || '';
        document.getElementById('docIssueDate').value = doc.issueDate || '';
        document.getElementById('docExpiryDate').value = doc.expiryDate || '';
        document.getElementById('docNote').value = doc.note || '';

        document.getElementById('documentModal').classList.add('active');
    },

    handleFormSubmit(e) {
        e.preventDefault();
        const docId = document.getElementById('documentId').value;
        const data = {
            carId: document.getElementById('docCarId').value || null,
            type: document.getElementById('docType').value,
            number: document.getElementById('docNumber').value,
            issueDate: document.getElementById('docIssueDate').value,
            expiryDate: document.getElementById('docExpiryDate').value,
            note: document.getElementById('docNote').value
        };

        if (docId) {
            this.update(docId, data);
        } else {
            this.add(data);
        }

        document.getElementById('documentModal').classList.remove('active');
        this.renderGrid(App.currentCar);
    },

    /**
     * Статус документів для Dashboard
     */
    getDashboardStatus() {
        const docs = this.getAll();
        const overdue = docs.filter(d => this.getStatus(d) === 'overdue');
        const soon = docs.filter(d => this.getStatus(d) === 'soon');

        if (overdue.length > 0) {
            return { emoji: '🔴', label: `${overdue.length} протерм.`, status: 'danger' };
        }
        if (soon.length > 0) {
            return { emoji: '🟡', label: `${soon.length} скоро закінч.`, status: 'warning' };
        }
        if (docs.length === 0) {
            return { emoji: '➖', label: 'Немає документів', status: 'empty' };
        }
        return { emoji: '✅', label: 'Всі актуальні', status: 'ok' };
    }
};
