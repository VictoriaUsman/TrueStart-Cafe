// test/sync-shopify.test.js
const { test, mock } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { syncShopify } = require('../api/sync-shopify');

// getAccessToken (lib/google-sheets-auth.js) signs a real JWT with crypto.createSign().sign()
// before ever making an HTTP call, so the key must be a structurally valid PEM even though the
// mocked oauth2 endpoint below never actually verifies the signature.
const { privateKey: FAKE_PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const ENV = {
  SHOPIFY_SHOP_DOMAIN: 'test.myshopify.com',
  SHOPIFY_ACCESS_TOKEN: 'shpca_token',
  GOOGLE_SHEET_ID: 'SHEET_ID',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'sheet-writer@example.iam.gserviceaccount.com',
  GOOGLE_SERVICE_ACCOUNT_KEY: FAKE_PRIVATE_KEY,
};

function mockAll({ shopifyOk = true, sheetsOk = true } = {}) {
  return mock.fn(async (url, opts) => {
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) };
    }
    if (String(url).includes('myshopify.com')) {
      if (!shopifyOk) return { ok: false, status: 401, json: async () => ({}) };
      const q = JSON.parse(opts.body).variables.q;
      const rows = q.includes('TIMESERIES month')
        ? [{ month: '2026-06-01', new_customers: '412', returning_customers: '201' }]
        : q.includes('TIMESERIES day')
        ? [{ day: '2026-08-25', orders: '136', gross_sales: '2783.78', discounts: '-268.78', returns: '-39.72', net_sales: '2475.28', shipping_charges: '292.89', duties: '0', additional_fees: '0', taxes: '93.56', total_sales: '2861.73' }]
        : [{ new_customers: '6984', returning_customers: '3777' }];
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { shopifyqlQuery: { tableData: { rows }, parseErrors: [] } } }),
      };
    }
    if (String(url).includes('sheets.googleapis.com')) {
      return sheetsOk ? { ok: true, status: 200, json: async () => ({}) } : { ok: false, status: 403, json: async () => ({}) };
    }
    throw new Error(`Unexpected fetch call: ${url}`);
  });
}

test('syncShopify writes ShopifyTotals and reports rows written when everything succeeds', async () => {
  const originalFetch = global.fetch;
  global.fetch = mockAll();
  try {
    const result = await syncShopify(ENV);
    assert.strictEqual(result.ShopifyTotals.ok, true);
    assert.strictEqual(result.ShopifyTotals.rows, 1);
    assert.strictEqual(result.ShopifyNewVsReturning.ok, true);
    assert.strictEqual(result.ShopifyNewVsReturning.rows, 2);
    assert.strictEqual(result.ShopifyNewCustomersMonthly.ok, true);
    assert.strictEqual(result.ShopifyNewCustomersMonthly.rows, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('syncShopify reports failure without throwing when the Shopify fetch fails', async () => {
  const originalFetch = global.fetch;
  global.fetch = mockAll({ shopifyOk: false });
  try {
    const result = await syncShopify(ENV);
    assert.strictEqual(result.ShopifyTotals.ok, false);
    assert.match(result.ShopifyTotals.error, /Shopify API error \(401\)/);
    assert.strictEqual(result.ShopifyNewCustomersMonthly.ok, false);
    assert.match(result.ShopifyNewCustomersMonthly.error, /Shopify API error \(401\)/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('syncShopify reports failure without throwing when the Sheets write fails', async () => {
  const originalFetch = global.fetch;
  global.fetch = mockAll({ sheetsOk: false });
  try {
    const result = await syncShopify(ENV);
    assert.strictEqual(result.ShopifyTotals.ok, false);
    assert.match(result.ShopifyTotals.error, /Sheets (clear|update) failed \(403\)/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('syncShopify requests a date window ending yesterday, not today', async () => {
  const originalFetch = global.fetch;
  let capturedBody;
  global.fetch = mock.fn(async (url, opts) => {
    if (String(url).includes('oauth2.googleapis.com/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) };
    if (String(url).includes('myshopify.com')) {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ data: { shopifyqlQuery: { tableData: null, parseErrors: [] } } }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  try {
    await syncShopify(ENV);
    const expectedYesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    assert.match(capturedBody.variables.q, new RegExp(`UNTIL ${expectedYesterday}`));
    assert.doesNotMatch(capturedBody.variables.q, new RegExp(`UNTIL ${today}(?!\\d)`));
  } finally {
    global.fetch = originalFetch;
  }
});

test('syncShopify throws a descriptive error naming missing required env vars, before any network call', async () => {
  const originalFetch = global.fetch;
  const fetchMock = mock.fn(async () => { throw new Error('should not be called'); });
  global.fetch = fetchMock;
  try {
    await assert.rejects(
      () => syncShopify({ SHOPIFY_SHOP_DOMAIN: 'test.myshopify.com' }),
      /Missing required environment variable\(s\): SHOPIFY_ACCESS_TOKEN, GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY/
    );
    assert.strictEqual(fetchMock.mock.calls.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('handler rejects requests without the correct CRON_SECRET bearer token', async () => {
  const { default: handler } = require('../api/sync-shopify');
  const originalSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'right-secret';
  const req = { headers: { authorization: 'Bearer wrong-secret' } };
  let statusCode;
  const res = { status(code) { statusCode = code; return this; }, send() { return this; }, json() { return this; } };
  try {
    await handler(req, res);
    assert.strictEqual(statusCode, 401);
  } finally {
    process.env.CRON_SECRET = originalSecret;
  }
});
