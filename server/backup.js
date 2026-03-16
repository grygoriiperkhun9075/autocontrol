/**
 * BackupManager — Git-based автоматичний бекап даних
 * Комітить та пушить server/data/ в GitHub за розкладом
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');

class BackupManager {
    static lastBackup = null;
    static lastError = null;
    static debounceTimer = null;
    static schedulerInterval = null;
    static isEnabled = false;

    /**
     * Ініціалізація — перевіряє чи є GITHUB_TOKEN і налаштовує git
     */
    static init() {
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
            console.log('⚠️ GITHUB_TOKEN не встановлено — автобекап вимкнено');
            console.log('   Додайте GITHUB_TOKEN в Railway Environment Variables');
            return false;
        }

        try {
            // Конфігуруємо git для використання токена
            const remoteUrl = this._getRemoteUrl();
            if (!remoteUrl) {
                console.log('⚠️ Git remote не знайдено — автобекап вимкнено');
                return false;
            }

            // Встановлюємо remote з токеном для авторизації
            const authenticatedUrl = remoteUrl.replace(
                'https://github.com/',
                `https://${token}@github.com/`
            );

            try {
                execSync(`git remote set-url origin ${authenticatedUrl}`, {
                    cwd: ROOT_DIR,
                    stdio: 'pipe'
                });
            } catch (e) {
                // Ігноруємо помилку якщо remote вже правильний
            }

            // Налаштовуємо git user для комітів
            try {
                execSync('git config user.email "autocontrol-backup@bot.local"', { cwd: ROOT_DIR, stdio: 'pipe' });
                execSync('git config user.name "AutoControl Backup"', { cwd: ROOT_DIR, stdio: 'pipe' });
            } catch (e) {
                // Ігноруємо
            }

            this.isEnabled = true;
            console.log('✅ Автобекап увімкнено (Git → GitHub)');
            return true;
        } catch (error) {
            console.error('❌ Помилка ініціалізації бекапу:', error.message);
            return false;
        }
    }

    /**
     * Отримання URL git remote
     */
    static _getRemoteUrl() {
        try {
            const url = execSync('git remote get-url origin', {
                cwd: ROOT_DIR,
                stdio: 'pipe'
            }).toString().trim();
            // Видаляємо існуючий токен з URL якщо він є
            return url.replace(/https:\/\/[^@]+@github\.com\//, 'https://github.com/');
        } catch (e) {
            return null;
        }
    }

    /**
     * Відновлення даних при старті (git pull)
     */
    static restore() {
        if (!process.env.GITHUB_TOKEN) {
            console.log('📦 Бекап: GITHUB_TOKEN не встановлено, пропускаємо restore');
            return false;
        }

        try {
            // Спочатку init щоб налаштувати remote
            this.init();

            console.log('📦 Відновлення даних з Git...');

            // Стягуємо зміни з remote
            execSync('git fetch origin main', {
                cwd: ROOT_DIR,
                stdio: 'pipe',
                timeout: 30000
            });

            // Перевіряємо чи є зміни в server/data/
            try {
                const diff = execSync('git diff origin/main -- server/data/', {
                    cwd: ROOT_DIR,
                    stdio: 'pipe'
                }).toString();

                if (diff) {
                    // Є зміни — відновлюємо файли даних з remote
                    execSync('git checkout origin/main -- server/data/', {
                        cwd: ROOT_DIR,
                        stdio: 'pipe'
                    });
                    console.log('✅ Дані відновлено з Git бекапу');
                    return true;
                } else {
                    console.log('📦 Дані актуальні, відновлення не потрібне');
                    return false;
                }
            } catch (e) {
                // Якщо файлів немає в remote — нічого відновлювати
                console.log('📦 Бекап в remote не знайдено');
                return false;
            }
        } catch (error) {
            console.error('⚠️ Помилка відновлення з Git:', error.message);
            this.lastError = { time: new Date().toISOString(), error: error.message, action: 'restore' };
            return false;
        }
    }

    /**
     * Створення бекапу (git add + commit + push)
     */
    static backup(reason = 'auto') {
        if (!this.isEnabled) {
            return { success: false, error: 'Автобекап вимкнено (GITHUB_TOKEN не встановлено)' };
        }

        try {
            // Перевіряємо чи є data файли
            if (!fs.existsSync(DATA_DIR)) {
                return { success: false, error: 'Папка data/ не існує' };
            }

            const dataFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
            if (dataFiles.length === 0) {
                return { success: false, error: 'Немає JSON файлів для бекапу' };
            }

            // Додаємо файли
            execSync('git add server/data/*.json', {
                cwd: ROOT_DIR,
                stdio: 'pipe'
            });

            // Перевіряємо чи є зміни
            try {
                execSync('git diff --cached --quiet -- server/data/', {
                    cwd: ROOT_DIR,
                    stdio: 'pipe'
                });
                // Якщо команда повернула 0 — змін немає
                console.log('📦 Бекап: змін немає, пропускаємо');
                return { success: true, skipped: true, message: 'Немає змін для бекапу' };
            } catch (e) {
                // exit code 1 = є зміни — продовжуємо
            }

            // Комітимо
            const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
            const commitMsg = `📦 Бекап даних [${reason}] — ${timestamp}`;

            execSync(`git commit -m "${commitMsg}" -- server/data/`, {
                cwd: ROOT_DIR,
                stdio: 'pipe'
            });

            // Пушимо
            execSync('git push origin main', {
                cwd: ROOT_DIR,
                stdio: 'pipe',
                timeout: 30000
            });

            this.lastBackup = {
                time: new Date().toISOString(),
                reason,
                files: dataFiles.length
            };
            this.lastError = null;

            console.log(`✅ Бекап виконано [${reason}]: ${dataFiles.length} файлів`);
            return { success: true, ...this.lastBackup };

        } catch (error) {
            console.error('❌ Помилка бекапу:', error.message);
            this.lastError = {
                time: new Date().toISOString(),
                error: error.message,
                action: 'backup'
            };
            return { success: false, error: error.message };
        }
    }

    /**
     * Запуск планувальника (кожні 6 годин)
     */
    static startScheduler() {
        if (!this.isEnabled) return;

        const SIX_HOURS = 6 * 60 * 60 * 1000;

        // Перший бекап через 1 хвилину після старту
        setTimeout(() => {
            this.backup('startup');
        }, 60 * 1000);

        // Далі кожні 6 годин
        this.schedulerInterval = setInterval(() => {
            this.backup('scheduled');
        }, SIX_HOURS);

        console.log('⏰ Планувальник бекапу запущено (кожні 6 годин)');
    }

    /**
     * Debounced бекап — викликається після зміни даних
     * Чекає 5 хвилин після останньої зміни перед бекапом
     */
    static scheduleDebounced() {
        if (!this.isEnabled) return;

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.backup('data-change');
            this.debounceTimer = null;
        }, 5 * 60 * 1000); // 5 хвилин
    }

    /**
     * Статус бекапу
     */
    static getStatus() {
        return {
            enabled: this.isEnabled,
            lastBackup: this.lastBackup,
            lastError: this.lastError,
            pendingDebounce: !!this.debounceTimer
        };
    }

    /**
     * Зупинка планувальника
     */
    static stop() {
        if (this.schedulerInterval) {
            clearInterval(this.schedulerInterval);
            this.schedulerInterval = null;
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }
}

module.exports = BackupManager;
