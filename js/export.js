/**
 * Export Module - Експорт даних
 */

const Export = {
    /**
     * Експорт в JSON
     */
    toJSON() {
        const data = Storage.getAllData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        this.download(blob, 'autocontrol_export.json');
    },

    /**
     * Експорт в CSV
     */
    toCSV() {
        const zip = {};

        // Експорт автомобілів
        zip['cars.csv'] = this.carsToCSV();

        // Експорт заправок
        zip['fuel.csv'] = this.fuelToCSV();

        // Експорт витрат
        zip['expenses.csv'] = this.expensesToCSV();

        // Експорт нагадувань
        zip['reminders.csv'] = this.remindersToCSV();

        // Створюємо один файл з усіма даними
        const allData = Object.entries(zip)
            .map(([name, content]) => `=== ${name} ===\n${content}`)
            .join('\n\n');

        const blob = new Blob(['\uFEFF' + allData], { type: 'text/csv;charset=utf-8' });
        this.download(blob, 'autocontrol_export.csv');
    },

    /**
     * Конвертація автомобілів в CSV
     */
    carsToCSV() {
        const cars = Cars.getAll();
        if (cars.length === 0) return 'Немає даних';

        const headers = ['ID', 'Марка', 'Модель', 'Рік', 'Пробіг', 'Номер', 'Колір'];
        const rows = cars.map(car => [
            car.id,
            car.brand,
            car.model,
            car.year || '',
            car.mileage || 0,
            car.plate || '',
            car.color || ''
        ]);

        return this.arrayToCSV([headers, ...rows]);
    },

    /**
     * Конвертація заправок в CSV
     */
    fuelToCSV() {
        const fuel = Fuel.getAll();
        if (fuel.length === 0) return 'Немає даних';

        const headers = ['ID', 'Авто', 'Дата', 'Літри', 'Ціна/л', 'Сума', 'Пробіг', 'Л/100км', 'АЗС'];
        const rows = fuel.map(f => [
            f.id,
            Cars.getDisplayName(f.carId),
            f.date,
            f.liters,
            f.pricePerLiter,
            (f.liters * f.pricePerLiter).toFixed(2),
            f.mileage,
            f.consumption || '',
            f.station || ''
        ]);

        return this.arrayToCSV([headers, ...rows]);
    },

    /**
     * Конвертація витрат в CSV
     */
    expensesToCSV() {
        const expenses = Expenses.getAll();
        if (expenses.length === 0) return 'Немає даних';

        const headers = ['ID', 'Авто', 'Дата', 'Категорія', 'Сума', 'Опис'];
        const rows = expenses.map(e => [
            e.id,
            Cars.getDisplayName(e.carId),
            e.date,
            Expenses.getCategoryLabel(e.category),
            e.amount,
            e.description || ''
        ]);

        return this.arrayToCSV([headers, ...rows]);
    },

    /**
     * Конвертація нагадувань в CSV
     */
    remindersToCSV() {
        const reminders = Reminders.getAll();
        if (reminders.length === 0) return 'Немає даних';

        const headers = ['ID', 'Авто', 'Тип', 'Дата', 'Пробіг', 'Примітка', 'Виконано'];
        const rows = reminders.map(r => [
            r.id,
            Cars.getDisplayName(r.carId),
            Reminders.getTypeLabel(r.type),
            r.date,
            r.mileage || '',
            r.note || '',
            r.completed ? 'Так' : 'Ні'
        ]);

        return this.arrayToCSV([headers, ...rows]);
    },

    /**
     * Конвертація масиву в CSV-рядок
     */
    arrayToCSV(data) {
        return data.map(row =>
            row.map(cell => {
                const str = String(cell);
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            }).join(',')
        ).join('\n');
    },

    /**
     * Завантаження файлу
     */
    download(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },

    /**
     * Відкриття модального вікна експорту
     */
    openModal() {
        document.getElementById('exportModal').classList.add('active');
    },

    /**
     * Ініціалізація обробників подій
     */
    init() {
        document.getElementById('exportJSON').addEventListener('click', () => {
            this.toJSON();
            document.getElementById('exportModal').classList.remove('active');
        });

        document.getElementById('exportCSV').addEventListener('click', () => {
            this.toCSV();
            document.getElementById('exportModal').classList.remove('active');
        });
    }
};
