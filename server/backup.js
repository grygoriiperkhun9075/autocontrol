/**
 * BackupManager — GitHub API бекап даних
 * Використовує GitHub REST API замість git CLI (Railway не має .git)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const REPO_OWNER = 'grygoriiperkhun9075';
const REPO_NAME = 'autocontrol';
const BACKUP_BRANCH = 'data-backup';
const SOURCE_BRANCH = 'main'; // для першого restore якщо data-backup ще не існує

class BackupManager {
    static lastBackup = null;
    static lastError = null;
    static debounceTimer = null;
    static schedulerInterval = null;
    static isEnabled = false;
    static token = null;
    static branchReady = false;

    /**
     * GitHub API запит
     */
    static _apiRequest(method, apiPath, body = null) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.github.com',
                path: apiPath,
                method,
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'AutoControl-Backup',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            };

            if (body) {
                options.headers['Content-Type'] = 'application/json';
            }

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = data ? JSON.parse(data) : {};
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(parsed);
                        } else {
                            reject(new Error(`GitHub API ${res.statusCode}: ${parsed.message || data}`));
                        }
                    } catch (e) {
                        reject(new Error(`Parse error: ${e.message}`));
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            if (body) {
                req.write(JSON.stringify(body));
            }
            req.end();
        });
    }

    /**
     * Ініціалізація
     */
    static init() {
        this.token = process.env.GITHUB_TOKEN;
        if (!this.token) {
            console.log('⚠️ GITHUB_TOKEN не встановлено — автобекап вимкнено');
            return false;
        }

        this.isEnabled = true;
        console.log('✅ Автобекап увімкнено (GitHub API, гілка: ' + BACKUP_BRANCH + ')');
        return true;
    }

    /**
     * Створення гілки data-backup якщо не існує
     */
    static async _ensureBranch() {
        if (this.branchReady) return;
        try {
            // Перевіряємо чи гілка існує
            await this._apiRequest('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/branches/${BACKUP_BRANCH}`);
            this.branchReady = true;
            console.log(`📌 Гілка ${BACKUP_BRANCH} знайдена`);
        } catch (e) {
            // Гілка не існує — створюємо з main
            try {
                const mainRef = await this._apiRequest('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${SOURCE_BRANCH}`);
                await this._apiRequest('POST', `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs`, {
                    ref: `refs/heads/${BACKUP_BRANCH}`,
                    sha: mainRef.object.sha
                });
                this.branchReady = true;
                console.log(`✅ Створено гілку ${BACKUP_BRANCH}`);
            } catch (createErr) {
                console.error(`❌ Не вдалося створити гілку ${BACKUP_BRANCH}:`, createErr.message);
            }
        }
    }

    /**
     * Отримання файлу з GitHub (для SHA)
     */
    static async _getFileSha(filePath) {
        try {
            const result = await this._apiRequest(
                'GET',
                `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}?ref=${BACKUP_BRANCH}`
            );
            return result.sha;
        } catch (e) {
            return null; // файл не існує
        }
    }

    /**
     * Завантаження файлу з GitHub
     */
    static async _downloadFile(filePath) {
        try {
            const result = await this._apiRequest(
                'GET',
                `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}?ref=${BRANCH}`
            );
            if (result.content) {
                return Buffer.from(result.content, 'base64').toString('utf-8');
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Завантаження файлу в GitHub
     */
    static async _uploadFile(filePath, content, message) {
        const sha = await this._getFileSha(filePath);
        const body = {
            message,
            content: Buffer.from(content, 'utf-8').toString('base64'),
            branch: BACKUP_BRANCH
        };
        if (sha) {
            body.sha = sha; // оновлення існуючого файлу
        }

        return this._apiRequest(
            'PUT',
            `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`,
            body
        );
    }

    /**
     * Відновлення даних при старті
     */
    static async restore() {
        if (!process.env.GITHUB_TOKEN) {
            console.log('📦 Бекап: GITHUB_TOKEN не встановлено, пропускаємо restore');
            return false;
        }

        this.init();
        await this._ensureBranch();

        try {
            console.log('📦 Відновлення даних з GitHub...');

            // Спочатку пробуємо data-backup, потім main
            let result = null;
            let branch = BACKUP_BRANCH;
            try {
                result = await this._apiRequest(
                    'GET',
                    `/repos/${REPO_OWNER}/${REPO_NAME}/contents/server/data?ref=${BACKUP_BRANCH}`
                );
            } catch (e) {
                console.log(`📦 Дані не знайдені на ${BACKUP_BRANCH}, пробуємо ${SOURCE_BRANCH}...`);
                branch = SOURCE_BRANCH;
                result = await this._apiRequest(
                    'GET',
                    `/repos/${REPO_OWNER}/${REPO_NAME}/contents/server/data?ref=${SOURCE_BRANCH}`
                );
            }

            if (!Array.isArray(result)) {
                console.log('📦 Папка server/data/ не знайдена в GitHub');
                return false;
            }

            // Створюємо локальну папку якщо не існує
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }

            let restoredCount = 0;
            for (const file of result) {
                if (!file.name.endsWith('.json')) continue;

                // Завантажуємо з тієї ж гілки
                let content = null;
                try {
                    const fileResult = await this._apiRequest(
                        'GET',
                        `/repos/${REPO_OWNER}/${REPO_NAME}/contents/server/data/${file.name}?ref=${branch}`
                    );
                    if (fileResult.content) {
                        content = Buffer.from(fileResult.content, 'base64').toString('utf-8');
                    }
                } catch (e) { /* skip */ }

                if (content) {
                    const localPath = path.join(DATA_DIR, file.name);
                    fs.writeFileSync(localPath, content, 'utf-8');
                    restoredCount++;
                }
            }

            if (restoredCount > 0) {
                console.log(`✅ Відновлено ${restoredCount} файлів з GitHub (${branch})`);
                return true;
            } else {
                console.log('📦 Немає файлів для відновлення');
                return false;
            }
        } catch (error) {
            console.error('⚠️ Помилка відновлення з GitHub:', error.message);
            this.lastError = { time: new Date().toISOString(), error: error.message, action: 'restore' };
            return false;
        }
    }

    /**
     * Створення бекапу
     */
    static async backup(reason = 'auto') {
        if (!this.isEnabled) {
            return { success: false, error: 'Автобекап вимкнено (GITHUB_TOKEN не встановлено)' };
        }

        try {
            await this._ensureBranch();
            if (!fs.existsSync(DATA_DIR)) {
                return { success: false, error: 'Папка data/ не існує' };
            }

            const dataFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
            if (dataFiles.length === 0) {
                return { success: false, error: 'Немає JSON файлів для бекапу' };
            }

            const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
            let uploadedCount = 0;
            let skippedCount = 0;

            for (const fileName of dataFiles) {
                const localPath = path.join(DATA_DIR, fileName);
                const localContent = fs.readFileSync(localPath, 'utf-8');
                const remotePath = `server/data/${fileName}`;

                // Перевіряємо чи вміст відрізняється
                const remoteContent = await this._downloadFile(remotePath);
                if (remoteContent === localContent) {
                    skippedCount++;
                    continue;
                }

                // Завантажуємо
                await this._uploadFile(
                    remotePath,
                    localContent,
                    `📦 Бекап [${reason}] ${fileName} — ${timestamp}`
                );
                uploadedCount++;
            }

            if (uploadedCount === 0) {
                console.log('📦 Бекап: змін немає, пропускаємо');
                return { success: true, skipped: true, message: 'Немає змін для бекапу' };
            }

            this.lastBackup = {
                time: new Date().toISOString(),
                reason,
                files: uploadedCount
            };
            this.lastError = null;

            console.log(`✅ Бекап виконано [${reason}]: ${uploadedCount} файлів оновлено, ${skippedCount} без змін`);
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
     * Debounced бекап
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
// force redeploy 1773651200
