// test/sync-windsor.test.js
const { test, mock } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { syncWindsor, dateRange } = require('../api/sync-windsor');

// getAccessToken (lib/google-sheets-auth.js) signs a real JWT with crypto.createSign().sign()
// before ever making an HTTP call, so the key must be a structurally valid PEM even though the
// mocked oauth2 endpoint below never actually verifies the signature. Same throwaway-keypair
// pattern as test/google-sheets-auth.test.js.
const { privateKey: FAKE_PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const ENV = {
  WINDSOR_API_KEY: 'wkey',
  GOOGLE_SHEET_ID: 'SHEET_ID',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'sheet-writer@example.iam.gserviceaccount.com',
  GOOGLE_SERVICE_ACCOUNT_KEY: FAKE_PRIVATE_KEY,
};

test('dateRange returns an inclusive N-day window ending at the reference date', () => {
  const { dateFrom, dateTo } = dateRange(90, new Date('2026-08-31T12:00:00Z'));
  assert.strictEqual(dateTo, '2026-08-31');
  assert.strictEqual(dateFrom, '2026-06-03'); // 89 days before 2026-08-31
});

function mockAll({ tokenOk = true, windsorOk = true, sheetsOk = true } = {}) {
  return mock.fn(async (url, opts) => {
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return tokenOk
        ? { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) }
        : { ok: true, status: 200, json: async () => ({ error: 'invalid_grant' }) };
    }
    if (String(url).includes('connectors.windsor.ai')) {
      if (!windsorOk) return { ok: false, status: 500, json: async () => ({}) };
      const isGoogle = String(url).includes('/google_ads');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: isGoogle
            ? [{ campaign: 'L - Search - Brand', date: '2026-08-24', currency: 'GBP', cost: 10, impressions: 100, clicks: 5, conversions: 1, conversion_value: 40 }]
            : [{ date_start: '2026-06-03', date_stop: '2026-08-31', ad_name: 'Ad 1', spend: 5, impressions: 50, campaign: 'Campaign', adset_name: 'Adset' }],
        }),
      };
    }
    if (String(url).includes('sheets.googleapis.com')) {
      return sheetsOk ? { ok: true, status: 200, json: async () => ({}) } : { ok: false, status: 403, json: async () => ({}) };
    }
    throw new Error(`Unexpected fetch call: ${url}`);
  });
}

test('syncWindsor writes all three tabs and reports rows written when everything succeeds', async () => {
  const originalFetch = global.fetch;
  global.fetch = mockAll();
  try {
    const result = await syncWindsor(ENV);
    assert.strictEqual(result.Creatives.ok, true);
    assert.strictEqual(result.Creatives.rows, 1);
    assert.strictEqual(result.GoogleDaily.ok, true);
    assert.strictEqual(result.GoogleDaily.rows, 1);
    assert.strictEqual(result.MetaDaily.ok, true);
    assert.strictEqual(result.MetaDaily.rows, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('syncWindsor reports one tab as failed without affecting the other two', async () => {
  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = mock.fn(async (url, opts) => {
    call += 1;
    if (String(url).includes('oauth2.googleapis.com/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) };
    if (String(url).includes('/facebook?') && String(url).includes('ad_name')) {
      // Creatives is the only job whose fields list includes ad_name, so this targets only
      // its facebook request and fails it; MetaDaily's facebook request (no ad_name field) still succeeds.
      return { ok: false, status: 500, json: async () => ({}) };
    }
    if (String(url).includes('connectors.windsor.ai')) {
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  try {
    const result = await syncWindsor(ENV);
    assert.strictEqual(result.Creatives.ok, false);
    assert.match(result.Creatives.error, /Windsor API error \(500\)/);
    assert.strictEqual(result.GoogleDaily.ok, true);
    assert.strictEqual(result.MetaDaily.ok, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('handler rejects requests without the correct CRON_SECRET bearer token', async () => {
  const { default: handler } = require('../api/sync-windsor');
  const originalSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'right-secret';
  const req = { headers: { authorization: 'Bearer wrong-secret' } };
  let statusCode, sentBody;
  const res = { status(code) { statusCode = code; return this; }, send(body) { sentBody = body; return this; }, json(body) { sentBody = body; return this; } };
  try {
    await handler(req, res);
    assert.strictEqual(statusCode, 401);
  } finally {
    process.env.CRON_SECRET = originalSecret;
  }
});
