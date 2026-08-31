// api/sync-shopify.js
const { fetchShopifySales, fetchNewVsReturning, fetchNewCustomersByMonth } = require('../lib/shopify-sales');
const { getAccessToken } = require('../lib/google-sheets-auth');
const { overwriteSheetRange } = require('../lib/google-sheets-writer');
const { mapShopifySalesRows, mapNewCustomersMonthlyRows } = require('../lib/transform/shopify-sales-to-sheet-rows');
const { dateRange } = require('../lib/dates');

const WINDOW_DAYS = 90;
const REQUIRED_ENV_VARS = ['SHOPIFY_SHOP_DOMAIN', 'SHOPIFY_ACCESS_TOKEN', 'GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_KEY'];

async function syncShopify(env) {
  const missing = REQUIRED_ENV_VARS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  // End the window at yesterday, not today — same reasoning as sync-windsor.js: today is a
  // partial day whose near-zero metrics would distort the most recent point on any daily chart.
  const yesterday = new Date(Date.now() - 86400000);
  const { dateFrom, dateTo } = dateRange(WINDOW_DAYS, yesterday);

  const tokenPromise = getAccessToken({
    clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n'),
  });
  const salesPromise = fetchShopifySales({
    shopDomain: env.SHOPIFY_SHOP_DOMAIN, accessToken: env.SHOPIFY_ACCESS_TOKEN, dateFrom, dateTo,
  });
  const newVsReturningPromise = fetchNewVsReturning({
    shopDomain: env.SHOPIFY_SHOP_DOMAIN, accessToken: env.SHOPIFY_ACCESS_TOKEN, dateFrom, dateTo,
  });
  const newCustomersMonthlyPromise = fetchNewCustomersByMonth({
    shopDomain: env.SHOPIFY_SHOP_DOMAIN, accessToken: env.SHOPIFY_ACCESS_TOKEN, dateFrom, dateTo,
  });

  const results = {};
  await Promise.all([
    (async () => {
      try {
        const [accessToken, salesRows] = await Promise.all([tokenPromise, salesPromise]);
        const sheetRows = mapShopifySalesRows(salesRows);
        await overwriteSheetRange({
          accessToken, sheetId: env.GOOGLE_SHEET_ID, tabName: 'ShopifyTotals',
          rows: sheetRows, columnCount: sheetRows[0]?.length,
        });
        results.ShopifyTotals = { ok: true, rows: sheetRows.length };
      } catch (err) {
        console.error('[sync-shopify] ShopifyTotals failed:', err);
        results.ShopifyTotals = { ok: false, error: err.message };
      }
    })(),
    (async () => {
      try {
        const [accessToken, counts] = await Promise.all([tokenPromise, newVsReturningPromise]);
        const sheetRows = [['New', counts.newCustomers], ['Returning', counts.returningCustomers]];
        await overwriteSheetRange({
          accessToken, sheetId: env.GOOGLE_SHEET_ID, tabName: 'ShopifyNewVsReturning',
          rows: sheetRows, columnCount: 2,
        });
        results.ShopifyNewVsReturning = { ok: true, rows: sheetRows.length };
      } catch (err) {
        console.error('[sync-shopify] ShopifyNewVsReturning failed:', err);
        results.ShopifyNewVsReturning = { ok: false, error: err.message };
      }
    })(),
    (async () => {
      try {
        const [accessToken, monthlyRows] = await Promise.all([tokenPromise, newCustomersMonthlyPromise]);
        const sheetRows = mapNewCustomersMonthlyRows(monthlyRows);
        await overwriteSheetRange({
          accessToken, sheetId: env.GOOGLE_SHEET_ID, tabName: 'ShopifyNewCustomersMonthly',
          rows: sheetRows, columnCount: 3,
        });
        results.ShopifyNewCustomersMonthly = { ok: true, rows: sheetRows.length };
      } catch (err) {
        console.error('[sync-shopify] ShopifyNewCustomersMonthly failed:', err);
        results.ShopifyNewCustomersMonthly = { ok: false, error: err.message };
      }
    })(),
  ]);
  return results;
}

module.exports = { syncShopify };

module.exports.default = async function handler(req, res) {
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!req.headers.authorization || req.headers.authorization !== expected) {
    res.status(401).send('Unauthorized');
    return;
  }
  try {
    const results = await syncShopify(process.env);
    const allOk = Object.values(results).every((r) => r.ok);
    res.status(allOk ? 200 : 207).json(results);
  } catch (err) {
    console.error('[sync-shopify] fatal error:', err);
    res.status(500).json({ error: err.message });
  }
};
