/**
 * Auth Module — Реєстрація, логін, сесії
 * Без зовнішніх залежностей (crypto вбудований)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const COMPANIES_FILE = path.join(__dirname, 'data', 'companies.json');

class Auth {
    static sessions = new Map(); // token → { companyId, createdAt }
    static companies = [];

    /**
     * Ініціалізація — завантаження компаній
     */
    static init() {
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        try {
            if (fs.existsSync(COMPANIES_FILE)) {
                const content = fs.readFileSync(COMPANIES_FILE, 'utf-8');
                this.companies = JSON.parse(content);
                console.log(`🔐 Завантажено ${this.companies.length} компаній`);
            } else {
                this.companies = [];
                this.saveCompanies();
                console.log('🔐 Створено файл компаній');
            }
        } catch (error) {
            console.error('❌ Помилка завантаження компаній:', error);
            this.companies = [];
        }
    }

    /**
     * Збереження компаній
     */
    static saveCompanies() {
        try {
            fs.writeFileSync(COMPANIES_FILE, JSON.stringify(this.companies, null, 2), 'utf-8');
        } catch (error) {
            console.error('❌ Помилка збереження компаній:', error);
        }
    }

    /**
     * Хешування пароля
     */
    static hashPassword(password) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.scryptSync(password, salt, 64).toString('hex');
        return `${salt}:${hash}`;
    }

    /**
     * Перевірка пароля
     */
    static verifyPassword(password, stored) {
        const [salt, hash] = stored.split(':');
        const verify = crypto.scryptSync(password, salt, 64).toString('hex');
        return hash === verify;
    }

    /**
     * Реєстрація компанії
     */
    static register({ companyName, login, password, botToken }) {
        // Перевірка чи логін вже існує
        if (this.companies.find(c => c.login === login)) {
            return { success: false, error: 'Цей логін вже зайнятий' };
        }

        const company = {
            id: crypto.randomUUID(),
            name: companyName,
            login: login,
            passwordHash: this.hashPassword(password),
            botToken: botToken || '',
            createdAt: new Date().toISOString()
        };

        this.companies.push(company);
        this.saveCompanies();

        return { success: true, company: { id: company.id, name: company.name } };
    }

    /**
     * Логін
     */
    static login(login, password) {
        const company = this.companies.find(c => c.login === login);
        if (!company) {
            return { success: false, error: 'Невірний логін або пароль' };
        }

        if (!this.verifyPassword(password, company.passwordHash)) {
            return { success: false, error: 'Невірний логін або пароль' };
        }

        // Створюємо сесію
        const token = crypto.randomUUID();
        this.sessions.set(token, {
            companyId: company.id,
            companyName: company.name,
            createdAt: Date.now()
        });

        return {
            success: true,
            token,
            company: { id: company.id, name: company.name }
        };
    }

    /**
     * Логаут
     */
    static logout(token) {
        return this.sessions.delete(token);
    }

    /**
     * Отримання сесії за токеном
     */
    static getSession(token) {
        const session = this.sessions.get(token);
        if (!session) return null;

        // Перевірка терміну (7 днів)
        const maxAge = 7 * 24 * 60 * 60 * 1000;
        if (Date.now() - session.createdAt > maxAge) {
            this.sessions.delete(token);
            return null;
        }

        return session;
    }

    /**
     * Отримання компанії за ID
     */
    static getCompany(companyId) {
        return this.companies.find(c => c.id === companyId);
    }

    /**
     * Отримання всіх компаній (для botManager)
     */
    static getAllCompanies() {
        return this.companies;
    }

    /**
     * Оновлення бот-токена компанії
     */
    static updateBotToken(companyId, botToken) {
        const company = this.companies.find(c => c.id === companyId);
        if (!company) return false;
        company.botToken = botToken;
        this.saveCompanies();
        return true;
    }

    /**
     * Парсинг cookie з заголовка
     */
    static parseCookies(cookieHeader) {
        const cookies = {};
        if (!cookieHeader) return cookies;

        cookieHeader.split(';').forEach(cookie => {
            const [name, ...rest] = cookie.trim().split('=');
            cookies[name] = rest.join('=');
        });

        return cookies;
    }

    /**
     * Auth middleware
     */
    static requireAuth(req, res, next) {
        const cookies = Auth.parseCookies(req.headers.cookie);
        const token = cookies['autocontrol_session'];

        if (!token) {
            // API запити → 401, інші → redirect
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            return res.redirect('/login');
        }

        const session = Auth.getSession(token);
        if (!session) {
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ error: 'Session expired' });
            }
            return res.redirect('/login');
        }

        req.companyId = session.companyId;
        req.companyName = session.companyName;
        next();
    }
}

module.exports = Auth;
