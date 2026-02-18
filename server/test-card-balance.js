/**
 * Тест балансу контракту карток
 * OKKO_LOGIN=... OKKO_PASSWORD=... node server/test-card-balance.js
 */
require('dotenv').config({ path: __dirname + '/.env' });
const OkkoScraper = require('./okko-scraper');

const login = process.env.OKKO_LOGIN;
const password = process.env.OKKO_PASSWORD;

if (!login || !password) {
    console.error('❌ OKKO_LOGIN та OKKO_PASSWORD');
    process.exit(1);
}

async function test() {
    const okko = new OkkoScraper(login, password);

    console.log('🔐 Авторизація...');
    await okko.authenticate();
    console.log('✅ Авторизовано\n');

    // 1. Перевірка балансу
    console.log('💳 Перевірка балансу контракту карток...');
    const balance = await okko.getContractBalance('0010043190');
    if (balance) {
        console.log(`✅ Баланс: ${balance.balance} грн (${balance.contractName})\n`);
    } else {
        console.log('❌ Не вдалось отримати баланс\n');
    }

    // 2. Тест checkCardContractBalance (з порогом 5000)
    console.log('📊 Перевірка з порогом 5000 грн...');
    const result = await okko.checkCardContractBalance(5000, 20000);
    if (result) {
        console.log(`Баланс: ${result.balance} грн`);
        console.log(`Потребує поповнення: ${result.needsTopUp}`);
        if (result.needsTopUp && result.pdfBuffer) {
            const fs = require('fs');
            const filename = `OKKO_topup_test.pdf`;
            fs.writeFileSync(filename, result.pdfBuffer);
            console.log(`✅ PDF збережено: ${filename} (${result.pdfBuffer.length} bytes)`);
        }
    }
}

test().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
