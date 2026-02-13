/**
 * Cars Module - Управління автомобілями
 */

const Cars = {
    /**
     * Отримання всіх автомобілів
     */
    getAll() {
        return Storage.get(Storage.KEYS.CARS);
    },

    /**
     * Отримання авто за ID
     */
    getById(id) {
        return Storage.findById(Storage.KEYS.CARS, id);
    },

    /**
     * Додавання нового авто
     */
    add(carData) {
        const car = {
            brand: carData.brand,
            model: carData.model,
            year: carData.year || null,
            mileage: parseInt(carData.mileage) || 0,
            plate: carData.plate || '',
            color: carData.color || '',
            fuelNorm: parseFloat(carData.fuelNorm) || 0
        };
        return Storage.add(Storage.KEYS.CARS, car);
    },

    /**
     * Оновлення авто
     */
    update(id, carData) {
        return Storage.update(Storage.KEYS.CARS, id, {
            brand: carData.brand,
            model: carData.model,
            year: carData.year || null,
            mileage: parseInt(carData.mileage) || 0,
            plate: carData.plate || '',
            color: carData.color || '',
            fuelNorm: parseFloat(carData.fuelNorm) || 0
        });
    },

    /**
     * Видалення авто
     */
    delete(id) {
        // Також видаляємо пов'язані дані
        const fuel = Storage.get(Storage.KEYS.FUEL).filter(f => f.carId !== id);
        Storage.set(Storage.KEYS.FUEL, fuel);

        const expenses = Storage.get(Storage.KEYS.EXPENSES).filter(e => e.carId !== id);
        Storage.set(Storage.KEYS.EXPENSES, expenses);

        const reminders = Storage.get(Storage.KEYS.REMINDERS).filter(r => r.carId !== id);
        Storage.set(Storage.KEYS.REMINDERS, reminders);

        return Storage.delete(Storage.KEYS.CARS, id);
    },

    /**
     * Отримання поточного пробігу авто
     */
    getCurrentMileage(carId) {
        const car = this.getById(carId);
        if (!car) return 0;

        const fuelRecords = Storage.filter(Storage.KEYS.FUEL, f => f.carId === carId);
        if (fuelRecords.length === 0) return parseInt(car.mileage) || 0;

        const lastRecord = fuelRecords.sort((a, b) =>
            new Date(b.date) - new Date(a.date)
        )[0];

        return Math.max(parseInt(car.mileage) || 0, parseInt(lastRecord.mileage) || 0);
    },

    /**
     * Отримання середньої витрати пального для авто
     */
    getAverageConsumption(carId) {
        const fuelRecords = Storage.filter(Storage.KEYS.FUEL, f => f.carId === carId);
        const recordsWithConsumption = fuelRecords.filter(f => f.consumption > 0);

        if (recordsWithConsumption.length === 0) return 0;

        const sum = recordsWithConsumption.reduce((acc, f) => acc + f.consumption, 0);
        return (sum / recordsWithConsumption.length).toFixed(2);
    },

    /**
     * Отримання загальних витрат на авто
     */
    getTotalExpenses(carId) {
        const fuelRecords = Storage.filter(Storage.KEYS.FUEL, f => f.carId === carId);
        const expenses = Storage.filter(Storage.KEYS.EXPENSES, e => e.carId === carId);

        const fuelTotal = fuelRecords.reduce((acc, f) => acc + (f.liters * f.pricePerLiter), 0);
        const expensesTotal = expenses.reduce((acc, e) => acc + e.amount, 0);

        return fuelTotal + expensesTotal;
    },

    /**
     * Форматування назви авто
     */
    getDisplayName(carId) {
        const car = this.getById(carId);
        if (!car) return 'Невідоме авто';
        return `${car.brand} ${car.model}${car.year ? ` (${car.year})` : ''}`;
    },

    /**
     * Рендеринг картки авто
     */
    renderCard(car) {
        const mileage = this.getCurrentMileage(car.id);
        const consumption = this.getAverageConsumption(car.id);
        const expenses = this.getTotalExpenses(car.id);
        const fuelNorm = car.fuelNorm || 0;

        let normIndicator = '';
        if (fuelNorm > 0 && consumption > 0) {
            const diff = ((consumption - fuelNorm) / fuelNorm * 100).toFixed(0);
            if (diff > 15) {
                normIndicator = `<span class="norm-badge danger">🔴 +${diff}%</span>`;
            } else if (diff > 0) {
                normIndicator = `<span class="norm-badge warning">🟡 +${diff}%</span>`;
            } else {
                normIndicator = `<span class="norm-badge ok">🟢 ${diff}%</span>`;
            }
        }

        return `
            <div class="car-card" data-car-id="${car.id}">
                <div class="car-header">
                    <div>
                        <h3 class="car-title">${car.brand} ${car.model}</h3>
                        <span class="car-year">${car.year || ''}</span>
                    </div>
                    <div class="car-actions">
                        <button class="car-action-btn edit-car" title="Редагувати">✏️</button>
                        <button class="car-action-btn delete delete-car" title="Видалити">🗑️</button>
                    </div>
                </div>
                <div class="car-details">
                    ${car.plate ? `<div class="car-detail">🔢 ${car.plate}</div>` : ''}
                    ${car.color ? `<div class="car-detail">🎨 ${car.color}</div>` : ''}
                    ${fuelNorm > 0 ? `<div class="car-detail">⛽ Норма: ${fuelNorm} л/100км ${normIndicator}</div>` : ''}
                </div>
                <div class="car-stats">
                    <div class="car-stat">
                        <span class="car-stat-value">${mileage.toLocaleString()}</span>
                        <span class="car-stat-label">Пробіг (км)</span>
                    </div>
                    <div class="car-stat">
                        <span class="car-stat-value">${consumption || '--'}</span>
                        <span class="car-stat-label">Л/100км</span>
                    </div>
                    <div class="car-stat">
                        <span class="car-stat-value">${expenses.toLocaleString()}</span>
                        <span class="car-stat-label">Витрати (грн)</span>
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Рендеринг списку авто
     */
    renderList() {
        const cars = this.getAll();
        const container = document.getElementById('carsGrid');

        if (cars.length === 0) {
            container.innerHTML = '<p class="empty-message">Додайте свій перший автомобіль</p>';
            return;
        }

        container.innerHTML = cars.map(car => this.renderCard(car)).join('');
        this.attachEventListeners();
    },

    /**
     * Оновлення селекторів авто
     */
    updateSelectors() {
        const cars = this.getAll();
        const selectors = [
            'currentCarSelect',
            'fuelCarId',
            'expenseCarId',
            'reminderCarId',
            'maintCarId',
            'docCarId',
            'statsCarFilter'
        ];

        selectors.forEach(selectorId => {
            const select = document.getElementById(selectorId);
            if (!select) return;

            const currentValue = select.value;
            const firstOption = select.options[0];

            select.innerHTML = '';
            select.appendChild(firstOption);

            cars.forEach(car => {
                const option = document.createElement('option');
                option.value = car.id;
                option.textContent = this.getDisplayName(car.id);
                select.appendChild(option);
            });

            select.value = currentValue;
        });
    },

    /**
     * Підключення обробників подій
     */
    attachEventListeners() {
        // Редагування авто
        document.querySelectorAll('.edit-car').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const carId = e.target.closest('.car-card').dataset.carId;
                this.openEditModal(carId);
            });
        });

        // Видалення авто
        document.querySelectorAll('.delete-car').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const carId = e.target.closest('.car-card').dataset.carId;
                if (confirm('Ви впевнені, що хочете видалити це авто? Усі пов\'язані дані також будуть видалені.')) {
                    this.delete(carId);
                    this.renderList();
                    this.updateSelectors();
                    App.updateDashboard();
                }
            });
        });
    },

    /**
     * Відкриття модального вікна для редагування
     */
    openEditModal(carId) {
        const car = this.getById(carId);
        if (!car) return;

        document.getElementById('carModalTitle').textContent = 'Редагувати автомобіль';
        document.getElementById('carId').value = car.id;
        document.getElementById('carBrand').value = car.brand;
        document.getElementById('carModel').value = car.model;
        document.getElementById('carYear').value = car.year || '';
        document.getElementById('carMileage').value = car.mileage || '';
        document.getElementById('carPlate').value = car.plate || '';
        document.getElementById('carColor').value = car.color || '';
        document.getElementById('carFuelNorm').value = car.fuelNorm || '';

        document.getElementById('carModal').classList.add('active');
    },

    /**
     * Відкриття модального вікна для додавання
     */
    openAddModal() {
        document.getElementById('carModalTitle').textContent = 'Додати автомобіль';
        document.getElementById('carForm').reset();
        document.getElementById('carId').value = '';
        document.getElementById('carModal').classList.add('active');
    },

    /**
     * Обробка форми
     */
    handleFormSubmit(e) {
        e.preventDefault();

        const carId = document.getElementById('carId').value;
        const carData = {
            brand: document.getElementById('carBrand').value,
            model: document.getElementById('carModel').value,
            year: document.getElementById('carYear').value,
            mileage: document.getElementById('carMileage').value,
            plate: document.getElementById('carPlate').value,
            color: document.getElementById('carColor').value,
            fuelNorm: document.getElementById('carFuelNorm').value
        };

        if (carId) {
            this.update(carId, carData);
        } else {
            this.add(carData);
        }

        document.getElementById('carModal').classList.remove('active');
        this.renderList();
        this.updateSelectors();
        App.updateDashboard();
    }
};
