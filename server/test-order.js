/**
 * Тестовий скрипт для замовлення талонів OKKO
 * Запуск: OKKO_LOGIN=... OKKO_PASSWORD=... node server/test-order.js
 */

require('dotenv').config({ path: __dirname + '/.env' });

const OkkoScraper = require('./okko-scraper');

const login = process.env.OKKO_LOGIN;
const password = process.env.OKKO_PASSWORD;

if (!login || !password) {
    console.error('❌ Вкажіть OKKO_LOGIN та OKKO_PASSWORD');
    process.exit(1);
}

async function test() {
    const okko = new OkkoScraper(login, password);
    const NOMINAL = 50;  // літрів
    const QUANTITY = 10;  // талонів

    console.log('🔐 Авторизація...');
    await okko.authenticate();
    console.log('✅ Авторизовано');

    console.log('📋 Пошук контракту...');
    await okko.findCouponContract();
    console.log(`✅ Контракт: ${okko.contractId}`);

    // Тестуємо отримання PDF для існуючого замовлення (order_id з останнього тесту)
    const testOrderId = process.argv[2]; // Можна передати ID як аргумент

    if (testOrderId) {
        console.log(`\n📄 Тест PDF для замовлення ${testOrderId}...`);
        const pdf = await okko.getOrderInvoicePDF({ order_id: testOrderId }, NOMINAL, QUANTITY);
        if (pdf) {
            const fs = require('fs');
            const filename = `OKKO_invoice_${testOrderId}.pdf`;
            fs.writeFileSync(filename, pdf);
            console.log(`✅ PDF збережено: ${filename} (${pdf.length} bytes)`);
        } else {
            console.log('⚠️ PDF не отримано');
        }
        return;
    }

    // Повний тест: створення замовлення + PDF
    console.log(`\n🛒 Створюю замовлення ${QUANTITY}×${NOMINAL}л...`);
    const order = await okko.createCouponOrder(NOMINAL, QUANTITY);

    if (order) {
        console.log('\n✅ Замовлення створено!');
        console.log(JSON.stringify(order, null, 2));

        console.log('\n📄 Отримую PDF рахунку...');
        const pdf = await okko.getOrderInvoicePDF(order, NOMINAL, QUANTITY);
        if (pdf) {
            const fs = require('fs');
            const filename = `OKKO_invoice_${NOMINAL}L_x${QUANTITY}_${Date.now()}.pdf`;
            fs.writeFileSync(filename, pdf);
            console.log(`✅ PDF збережено: ${filename} (${pdf.length} bytes)`);
        } else {
            console.log('⚠️ PDF не отримано');
        }
    } else {
        console.log('❌ Замовлення не створено');
    }
}

test().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
