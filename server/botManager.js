/**
 * Bot Manager — Управління ботами для кожної компанії
 */

const AutoControlBot = require('./bot');
const Auth = require('./auth');
const { getStorage } = require('./storage');
const OkkoScraper = require('./okko-scraper');

class BotManager {
    static bots = new Map(); // companyId → AutoControlBot instance

    /**
     * Запуск ботів для всіх компаній при старті сервера
     */
    static initAll() {
        if (process.env.DISABLE_BOT === 'true') {
            console.log('🤖 Telegram боти вимкнено через DISABLE_BOT=true');
            return;
        }
        const companies = Auth.getAllCompanies();
        let started = 0;
        const usedTokens = new Set(); // Запобігаємо запуску кількох ботів з однаковим токеном

        for (const company of companies) {
            if (company.botToken) {
                if (usedTokens.has(company.botToken)) {
                    console.log(`⚠️ [${company.id}] Пропущено — токен вже використовується іншою компанією`);
                    continue;
                }
                usedTokens.add(company.botToken);
                this.startBot(company.id, company.botToken);
                started++;
            }
        }

        console.log(`🤖 Запущено ${started} ботів з ${companies.length} компаній`);
    }

    /**
     * Запуск бота для компанії
     */
    static startBot(companyId, botToken) {
        if (process.env.DISABLE_BOT === 'true') {
            return null;
        }
        // Зупиняємо старий бот якщо є
        this.stopBot(companyId);

        if (!botToken) {
            console.log(`⚠️  [${companyId}] Bot token не вказано`);
            return null;
        }

        try {
            const storage = getStorage(companyId);

            // Ініціалізуємо OKKO scraper (з fallback значеннями)
            let okkoScraper = null;
            const okkoLogin = process.env.OKKO_LOGIN || '10968639';
            const okkoPassword = process.env.OKKO_PASSWORD || '2023Ovotrade!';
            if (okkoLogin && okkoPassword) {
                okkoScraper = new OkkoScraper(okkoLogin, okkoPassword);
            }

            const bot = new AutoControlBot(botToken, storage, okkoScraper);
            this.bots.set(companyId, bot);
            console.log(`🤖 [${companyId}] Бот запущено`);
            return bot;
        } catch (error) {
            console.error(`❌ [${companyId}] Помилка запуску бота:`, error.message);
            return null;
        }
    }

    /**
     * Зупинка бота
     */
    static stopBot(companyId) {
        const bot = this.bots.get(companyId);
        if (bot && bot.bot) {
            try {
                bot.bot.stopPolling();
            } catch (e) {
                // ignore
            }
            this.bots.delete(companyId);
        }
    }

    /**
     * Отримання бота компанії
     */
    static getBot(companyId) {
        return this.bots.get(companyId);
    }
}

module.exports = BotManager;
