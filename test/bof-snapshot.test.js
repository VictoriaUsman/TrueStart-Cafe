const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { readProvenSnapshot, writeProvenSnapshot } = require('../lib/bof-snapshot');

// lib/google-sheets-auth.js signs a real JWT with crypto.createSign before it
// fetches a token, so a dummy string key would throw on signing. Generate a
// throwaway key pair once and let the real signing path run; only the network
// call is faked. Same global.fetch swap + try/finally pattern as
// test/google-sheets-writer.test.js.
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const env = {
  GOOGLE_SHEET_ID: 'sheet123',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@example.com',
  GOOGLE_SERVICE_ACCOUNT_KEY: privateKey,
};

const INFO = JSON.stringify({
  dateFrom: '2026-09-15', dateTo: '2026-09-21',
  timeZone: 'Europe/London', asOf: '2026-09-22T06:50:00.000Z',
});

// sheetBody may be a plain response body (used for every non-oauth request, as
// before) or a function (url, body) => response body, letting a test give
// different bodies to the metadata GET and the :batchUpdate POST. `fn` is
// called with `calls` (every requested URL, as before) and `requests` (each
// request's URL plus its parsed JSON body, for asserting on what was sent).
async function withFakeFetch(sheetBody, fn) {
  const real = global.fetch;
  const calls = [];
  const requests = [];
  global.fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 'tok' }) };
    }
    const body = options && options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url: String(url), body });
    const response = typeof sheetBody === 'function' ? sheetBody(String(url), body) : sheetBody;
    return { ok: true, json: async () => response };
  };
  try {
    return await fn(calls, requests);
  } finally {
    global.fetch = real;
  }
}

test('a snapshot without the revenue column is rejected rather than read as zero revenue', async () => {
  await withFakeFetch(
    { values: [[INFO], ['1', 'Taster', 'K-BOF_Cold-ABO', 'Taster', 150, 15]] },
    async () => { await assert.rejects(() => readProvenSnapshot(env), /Invalid/); }
  );
});

test('the read range covers column G so revenue is fetched', async () => {
  await withFakeFetch(
    { values: [[INFO], ['1', 'Taster', 'K-BOF_Cold-ABO', 'Taster', 150, 15, 375]] },
    async (calls) => {
      const snapshot = await readProvenSnapshot(env);
      assert.equal(snapshot.ads[0].revenue, 375);
      assert.ok(calls.some((u) => u.includes('!A:G')), `expected an A:G range, got: ${calls.join(', ')}`);
    }
  );
});

test('a negative revenue is rejected', async () => {
  await withFakeFetch(
    { values: [[INFO], ['1', 'Taster', 'K-BOF_Cold-ABO', 'Taster', 150, 15, -1]] },
    async () => { await assert.rejects(() => readProvenSnapshot(env), /Invalid/); }
  );
});

test('an existing Proven7Day sheet narrower than 7 columns is widened before the write, without shrinking rowCount', async () => {
  const snapshot = {
    dateFrom: '2026-09-15', dateTo: '2026-09-21', timeZone: 'Europe/London', asOf: '2026-09-22T06:50:00.000Z',
    ads: [{ id: '1', name: 'Taster', campaign: 'K-BOF_Cold-ABO', product: 'Taster', spend: 150, purchases: 15, revenue: 375 }],
  };
  const metadata = {
    sheets: [{ properties: { sheetId: 5, title: 'Proven7Day', gridProperties: { rowCount: 1000, columnCount: 6 } } }],
  };
  await withFakeFetch(
    (url) => (url.includes(':batchUpdate') ? { spreadsheetId: 'sheet123' } : metadata),
    async (_calls, requests) => {
      await writeProvenSnapshot(env, snapshot);
      const batchCall = requests.find((r) => r.url.includes(':batchUpdate'));
      assert.ok(batchCall, 'expected a :batchUpdate request');
      const widen = batchCall.body.requests.find((r) => r.updateSheetProperties);
      assert.ok(widen, 'expected an updateSheetProperties request widening the grid');
      assert.equal(widen.updateSheetProperties.properties.sheetId, 5);
      assert.equal(widen.updateSheetProperties.properties.gridProperties.columnCount, 7);
      // rowCount (1000) is already big enough for one ad row — must not shrink.
      assert.equal(widen.updateSheetProperties.properties.gridProperties.rowCount, 1000);
      assert.equal(widen.updateSheetProperties.fields, 'gridProperties.rowCount,gridProperties.columnCount');
      // The widen must be requested before the updateCells write, since requests apply in order.
      const widenIndex = batchCall.body.requests.findIndex((r) => r.updateSheetProperties);
      const updateCellsIndex = batchCall.body.requests.findIndex((r) => r.updateCells);
      assert.ok(widenIndex < updateCellsIndex, 'expected the widen request before updateCells');
    }
  );
});
