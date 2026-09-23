const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { readProvenSnapshot } = require('../lib/bof-snapshot');

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

async function withFakeFetch(sheetBody, fn) {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 'tok' }) };
    }
    return { ok: true, json: async () => sheetBody };
  };
  try {
    return await fn(calls);
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
