// test/sync-creatives.test.js
const { test, mock } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { syncCreativesChunk, chunkDateRange, bandStartRow, CHUNK_COUNT } = require('../api/sync-creatives');

// getAccessToken signs a real JWT with crypto.createSign().sign() before making an HTTP call,
// so the key must be a structurally valid PEM even though the mocked oauth2 endpoint never
// actually verifies the signature — same pattern as test/sync-shopify.test.js.
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

test('chunkDateRange computes a 5-day, yesterday-anchored window per chunk index', () => {
  const ref = new Date('2026-09-01T12:00:00Z');
  assert.deepStrictEqual(chunkDateRange(0, ref), { dateFrom: '2026-08-27', dateTo: '2026-08-31' });
  assert.deepStrictEqual(chunkDateRange(1, ref), { dateFrom: '2026-08-22', dateTo: '2026-08-26' });
  assert.deepStrictEqual(chunkDateRange(5, ref), { dateFrom: '2026-08-02', dateTo: '2026-08-06' });
});

test('bandStartRow reserves a 400-row band per chunk, starting after the header row', () => {
  assert.strictEqual(bandStartRow(0), 2);
  assert.strictEqual(bandStartRow(1), 402);
  assert.strictEqual(bandStartRow(5), 2002);
});

function mockAll({ windsorOk = true, sheetsOk = true } = {}) {
  return mock.fn(async (url, opts) => {
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) };
    }
    if (String(url).includes('connectors.windsor.ai')) {
      if (!windsorOk) return { ok: false, status: 500, json: async () => ({}) };
      return {
        ok: true, status: 200,
        json: async () => ({ data: [{ ad_name: 'Ad 1', spend: 10, campaign: 'Camp A', adset_name: 'Adset A' }] }),
      };
    }
    if (String(url).includes('sheets.googleapis.com')) {
      return sheetsOk ? { ok: true, status: 200, json: async () => ({}) } : { ok: false, status: 403, json: async () => ({}) };
    }
    throw new Error(`Unexpected fetch call: ${url}`);
  });
}

test('syncCreativesChunk fetches, aggregates, and writes one chunk\'s band, reporting rows written', async () => {
  const originalFetch = global.fetch;
  global.fetch = mockAll();
  try {
    const result = await syncCreativesChunk(ENV, 2);
    assert.deepStrictEqual(result, { ok: true, rows: 1 });
  } finally {
    global.fetch = originalFetch;
  }
});

test('syncCreativesChunk never calls the Sheets API at all when the Windsor fetch fails', async () => {
  const originalFetch = global.fetch;
  const fetchMock = mockAll({ windsorOk: false });
  global.fetch = fetchMock;
  try {
    await assert.rejects(() => syncCreativesChunk(ENV, 0), /Windsor API error \(500\)/);
    const sheetsCalls = fetchMock.mock.calls.filter((c) => String(c.arguments[0]).includes('sheets.googleapis.com') || String(c.arguments[0]).includes('oauth2.googleapis.com'));
    assert.strictEqual(sheetsCalls.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('syncCreativesChunk propagates a descriptive error when the Sheets write fails', async () => {
  const originalFetch = global.fetch;
  global.fetch = mockAll({ sheetsOk: false });
  try {
    await assert.rejects(() => syncCreativesChunk(ENV, 0), /Sheets update failed \(403\)/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('syncCreativesChunk throws a descriptive error naming missing required env vars, before any network call', async () => {
  const originalFetch = global.fetch;
  const fetchMock = mock.fn(async () => { throw new Error('should not be called'); });
  global.fetch = fetchMock;
  try {
    await assert.rejects(
      () => syncCreativesChunk({ WINDSOR_API_KEY: 'k' }, 0),
      /Missing required environment variable\(s\): GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY/
    );
    assert.strictEqual(fetchMock.mock.calls.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('handler rejects requests without the correct CRON_SECRET bearer token', async () => {
  const { default: handler } = require('../api/sync-creatives');
  const originalSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'right-secret';
  const req = { headers: { authorization: 'Bearer wrong-secret' }, query: { chunk: '0' } };
  let statusCode;
  const res = { status(code) { statusCode = code; return this; }, send() { return this; }, json() { return this; } };
  try {
    await handler(req, res);
    assert.strictEqual(statusCode, 401);
  } finally {
    process.env.CRON_SECRET = originalSecret;
  }
});

test('handler rejects a missing or out-of-range chunk query param with 400, without touching the network', async () => {
  const { default: handler } = require('../api/sync-creatives');
  const originalSecret = process.env.CRON_SECRET;
  const originalFetch = global.fetch;
  process.env.CRON_SECRET = 'right-secret';
  const fetchMock = mock.fn(async () => { throw new Error('should not be called'); });
  global.fetch = fetchMock;
  try {
    for (const chunk of [undefined, '6', '-1', 'not-a-number']) {
      let statusCode, body;
      const req = { headers: { authorization: 'Bearer right-secret' }, query: chunk === undefined ? {} : { chunk } };
      const res = { status(code) { statusCode = code; return this; }, json(b) { body = b; return this; }, send() { return this; } };
      await handler(req, res);
      assert.strictEqual(statusCode, 400, `chunk=${chunk} should be rejected`);
      assert.match(body.error, new RegExp(`integer between 0 and ${CHUNK_COUNT - 1}`));
    }
    assert.strictEqual(fetchMock.mock.calls.length, 0);
  } finally {
    process.env.CRON_SECRET = originalSecret;
    global.fetch = originalFetch;
  }
});

test('handler responds 200 with the sync result for a valid chunk and correct secret', async () => {
  const { default: handler } = require('../api/sync-creatives');
  const originalSecret = process.env.CRON_SECRET;
  const originalFetch = global.fetch;
  process.env.CRON_SECRET = 'right-secret';
  Object.assign(process.env, ENV);
  global.fetch = mockAll();
  try {
    let statusCode, body;
    const req = { headers: { authorization: 'Bearer right-secret' }, query: { chunk: '3' } };
    const res = { status(code) { statusCode = code; return this; }, json(b) { body = b; return this; }, send() { return this; } };
    await handler(req, res);
    assert.strictEqual(statusCode, 200);
    assert.deepStrictEqual(body, { ok: true, rows: 1 });
  } finally {
    process.env.CRON_SECRET = originalSecret;
    global.fetch = originalFetch;
  }
});

test('handler responds 500 with ok:false when the chunk sync throws', async () => {
  const { default: handler } = require('../api/sync-creatives');
  const originalSecret = process.env.CRON_SECRET;
  const originalFetch = global.fetch;
  process.env.CRON_SECRET = 'right-secret';
  Object.assign(process.env, ENV);
  global.fetch = mockAll({ windsorOk: false });
  try {
    let statusCode, body;
    const req = { headers: { authorization: 'Bearer right-secret' }, query: { chunk: '0' } };
    const res = { status(code) { statusCode = code; return this; }, json(b) { body = b; return this; }, send() { return this; } };
    await handler(req, res);
    assert.strictEqual(statusCode, 500);
    assert.strictEqual(body.ok, false);
    assert.match(body.error, /Windsor API error \(500\)/);
  } finally {
    process.env.CRON_SECRET = originalSecret;
    global.fetch = originalFetch;
  }
});
