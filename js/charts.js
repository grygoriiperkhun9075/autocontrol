/**
 * Charts Module - Графіки та візуалізація
 */

const Charts = {
    instances: {},

    /**
     * Налаштування за замовчуванням для Chart.js
     */
    defaults: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    color: '#a0a0b8',
                    font: {
                        family: 'Inter'
                    }
                }
            }
        },
        scales: {
            x: {
                grid: {
                    color: 'rgba(255, 255, 255, 0.05)'
                },
                ticks: {
                    color: '#6c6c8a'
                }
            },
            y: {
                grid: {
                    color: 'rgba(255, 255, 255, 0.05)'
                },
                ticks: {
                    color: '#6c6c8a'
                }
            }
        }
    },

    /**
     * Кольори для графіків
     */
    colors: {
        primary: '#6366f1',
        secondary: '#8b5cf6',
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
        info: '#3b82f6',
        gradient: (ctx) => {
            const gradient = ctx.createLinearGradient(0, 0, 0, 300);
            gradient.addColorStop(0, 'rgba(99, 102, 241, 0.5)');
            gradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');
            return gradient;
        }
    },

    categoryColors: {
        'repair': '#ef4444',
        'maintenance': '#f59e0b',
        'insurance': '#3b82f6',
        'tax': '#8b5cf6',
        'parking': '#10b981',
        'wash': '#06b6d4',
        'tires': '#f97316',
        'other': '#6c6c8a',
        'fuel': '#6366f1'
    },

    /**
     * Місяці українською
     */
    months: ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'],

    /**
     * Ініціалізація графіка витрати пального на Dashboard
     */
    initFuelChart(carId = null, period = 'all') {
        const ctx = document.getElementById('fuelChart');
        if (!ctx) return;

        if (this.instances.fuel) {
            this.instances.fuel.destroy();
        }

        const months = period === 'week' ? 1 : (period === 'month' ? 1 : (period === 'year' ? 12 : 6));
        const monthlyData = Fuel.getMonthlyData(carId, months);
        const labels = [];
        const data = [];

        Object.keys(monthlyData).reverse().forEach(key => {
            const [year, month] = key.split('-');
            labels.push(this.months[parseInt(month) - 1]);
            data.push(parseFloat(monthlyData[key].avgConsumption) || 0);
        });

        this.instances.fuel = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Л/100км',
                    data: data,
                    borderColor: this.colors.primary,
                    backgroundColor: this.colors.gradient(ctx.getContext('2d')),
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: this.colors.primary,
                    pointBorderColor: '#fff',
                    pointHoverRadius: 8
                }]
            },
            options: {
                ...this.defaults,
                plugins: {
                    ...this.defaults.plugins,
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.parsed.y} л/100км`
                        }
                    }
                }
            }
        });
    },

    /**
     * Ініціалізація графіка витрат по категоріях на Dashboard
     */
    initExpensesChart(carId = null, period = 'all') {
        const ctx = document.getElementById('expensesChart');
        if (!ctx) return;

        if (this.instances.expenses) {
            this.instances.expenses.destroy();
        }

        const expensesByCategory = Expenses.getByCategories(carId, period);
        const fuelCost = Fuel.getTotalFuelCost(carId, period);

        expensesByCategory['fuel'] = fuelCost;

        const labels = [];
        const data = [];
        const colors = [];

        Object.entries(expensesByCategory).forEach(([category, amount]) => {
            if (amount > 0) {
                labels.push(category === 'fuel' ? 'Пальне' : Expenses.getCategoryLabel(category));
                data.push(amount);
                colors.push(this.categoryColors[category] || this.categoryColors.other);
            }
        });

        if (data.length === 0) {
            labels.push('Немає даних');
            data.push(1);
            colors.push('#6c6c8a');
        }

        this.instances.expenses = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors,
                    borderWidth: 0,
                    hoverOffset: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: '#a0a0b8',
                            font: {
                                family: 'Inter'
                            },
                            padding: 15
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.label}: ${context.parsed.toLocaleString()} грн`
                        }
                    }
                }
            }
        });
    },

    /**
     * Ініціалізація графіка динаміки витрати пального (Statistics)
     */
    initConsumptionTrendChart(carId = null, period = 'all') {
        const ctx = document.getElementById('consumptionTrendChart');
        if (!ctx) return;

        if (this.instances.consumptionTrend) {
            this.instances.consumptionTrend.destroy();
        }

        const months = period === 'year' ? 12 : (period === 'month' ? 1 : 24);
        const monthlyData = Fuel.getMonthlyData(carId, months);

        const labels = [];
        const consumptionData = [];
        const costData = [];

        Object.keys(monthlyData).reverse().forEach(key => {
            const [year, month] = key.split('-');
            labels.push(`${this.months[parseInt(month) - 1]} ${year.slice(2)}`);
            consumptionData.push(parseFloat(monthlyData[key].avgConsumption) || 0);
            costData.push(monthlyData[key].cost);
        });

        this.instances.consumptionTrend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Витрата (л/100км)',
                    data: consumptionData,
                    borderColor: this.colors.primary,
                    backgroundColor: 'transparent',
                    tension: 0.4,
                    yAxisID: 'y'
                }, {
                    label: 'Вартість (грн)',
                    data: costData,
                    borderColor: this.colors.success,
                    backgroundColor: 'transparent',
                    tension: 0.4,
                    yAxisID: 'y1'
                }]
            },
            options: {
                ...this.defaults,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                scales: {
                    x: this.defaults.scales.x,
                    y: {
                        ...this.defaults.scales.y,
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Л/100км',
                            color: '#a0a0b8'
                        }
                    },
                    y1: {
                        ...this.defaults.scales.y,
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: {
                            display: true,
                            text: 'Грн',
                            color: '#a0a0b8'
                        },
                        grid: {
                            drawOnChartArea: false
                        }
                    }
                }
            }
        });
    },

    /**
     * Ініціалізація графіка порівняння витрат (Statistics)
     */
    initExpensesCompareChart(carId = null, period = 'all') {
        const ctx = document.getElementById('expensesCompareChart');
        if (!ctx) return;

        if (this.instances.expensesCompare) {
            this.instances.expensesCompare.destroy();
        }

        const expensesByCategory = Expenses.getByCategories(carId, period);
        const fuelCost = Fuel.getTotalFuelCost(carId, period);

        const allCategories = { 'fuel': fuelCost, ...expensesByCategory };

        const labels = [];
        const data = [];
        const colors = [];

        Object.entries(allCategories)
            .filter(([_, amount]) => amount > 0)
            .sort((a, b) => b[1] - a[1])
            .forEach(([category, amount]) => {
                labels.push(category === 'fuel' ? 'Пальне' : Expenses.getCategoryLabel(category));
                data.push(amount);
                colors.push(this.categoryColors[category] || this.categoryColors.other);
            });

        this.instances.expensesCompare = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Витрати (грн)',
                    data: data,
                    backgroundColor: colors,
                    borderRadius: 8,
                    borderSkipped: false
                }]
            },
            options: {
                ...this.defaults,
                indexAxis: 'y',
                plugins: {
                    ...this.defaults.plugins,
                    legend: {
                        display: false
                    }
                }
            }
        });
    },

    /**
     * Ініціалізація графіка витрат на пальне по місяцях (Statistics)
     */
    initFuelCostChart(carId = null, period = 'all') {
        const ctx = document.getElementById('fuelCostChart');
        if (!ctx) return;

        if (this.instances.fuelCost) {
            this.instances.fuelCost.destroy();
        }

        const months = period === 'year' ? 12 : (period === 'month' ? 1 : 12);
        const monthlyData = Fuel.getMonthlyData(carId, months);

        const labels = [];
        const costData = [];
        const litersData = [];

        Object.keys(monthlyData).reverse().forEach(key => {
            const [year, month] = key.split('-');
            labels.push(this.months[parseInt(month) - 1]);
            costData.push(monthlyData[key].cost);
            litersData.push(monthlyData[key].liters);
        });

        this.instances.fuelCost = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Вартість (грн)',
                    data: costData,
                    backgroundColor: this.colors.primary,
                    borderRadius: 8
                }]
            },
            options: {
                ...this.defaults,
                plugins: {
                    ...this.defaults.plugins,
                    tooltip: {
                        callbacks: {
                            afterLabel: (context) => {
                                const liters = litersData[context.dataIndex];
                                return `Літрів: ${liters.toFixed(1)}`;
                            }
                        }
                    }
                }
            }
        });
    },

    /**
     * Оновлення всіх графіків Dashboard
     */
    updateDashboard(carId = null, period = 'all') {
        this.initFuelChart(carId, period);
        this.initExpensesChart(carId, period);
    },

    /**
     * Оновлення графіків Statistics
     */
    updateStatistics(carId = null, period = 'all') {
        this.initConsumptionTrendChart(carId, period);
        this.initExpensesCompareChart(carId, period);
        this.initFuelCostChart(carId, period);
    },

    /**
     * Знищення всіх графіків
     */
    destroyAll() {
        Object.values(this.instances).forEach(chart => {
            if (chart) chart.destroy();
        });
        this.instances = {};
    }
};
