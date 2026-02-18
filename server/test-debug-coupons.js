require('dotenv').config({ path: __dirname + '/.env' });
const OkkoScraper = require('./okko-scraper');

const okko = new OkkoScraper(process.env.OKKO_LOGIN || '10968639', process.env.OKKO_PASSWORD || '2023Ovotrade!');

(async () => {
    console.log('=== Fetching CHST0 coupons (exactly as bot does) ===\n');

    // This is exactly what the bot calls
    const coupons = await okko.fetchActiveCoupons(true);
    console.log('\nResult:', coupons.length, 'coupons');
    if (coupons.length > 0) {
        coupons.forEach(c => {
            console.log(`  ${c.nominal}L | ${c.number} | ${c.status} | ${c.validFrom} -> ${c.validTo}`);
        });
    } else {
        console.log('\nNo coupons found. Checking raw API...');

        // Direct call with CHST0
        const resp = await okko._request(
            okko.baseUrl + '/proxy-service/cards?contract_id=' + okko.contractId + '&offset=0&size=100&card_status=CHST0'
        );
        console.log('Raw CHST0 status:', resp.status);
        console.log('Raw CHST0 body:', resp.body.substring(0, 500));
    }
})();
