// test/google-sheets-writer.test.js
const { test, mock } = require('node:test');
const assert = require('node:assert');
const { overwriteSheetRange } = require('../lib/google-sheets-writer');

test('overwriteSheetRange clears the old range then writes the new rows starting at row 2', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = mock.fn(async (url, opts) => {
    calls.push({ url, method: opts.method, body: opts.body, headers: opts.headers });
    return { ok: true, status: 200, json: async () => ({}) };
  });
  try {
    await overwriteSheetRange({
      accessToken: 'tok123',
      sheetId: 'SHEET_ID',
      tabName: 'GoogleDaily',
      rows: [['L - Search - Brand', '2026-08-01', 'GBP', 100]],
    });

    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].method, 'POST');
    assert.match(calls[0].url, /\/values\/GoogleDaily!A2%3AZ100000:clear$/);
    assert.strictEqual(calls[0].headers.Authorization, 'Bearer tok123');

    assert.strictEqual(calls[1].method, 'PUT');
    assert.match(calls[1].url, /\/values\/GoogleDaily!A2\?valueInputOption=RAW$/);
    assert.deepStrictEqual(JSON.parse(calls[1].body), { values: [['L - Search - Brand', '2026-08-01', 'GBP', 100]] });
  } finally {
    global.fetch = originalFetch;
  }
});

test('overwriteSheetRange throws a descriptive error if the clear call fails', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
  try {
    await assert.rejects(
      () => overwriteSheetRange({ accessToken: 't', sheetId: 'S', tabName: 'Creatives', rows: [] }),
      /Sheets clear failed \(403\) for "Creatives"/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('overwriteSheetRange throws a descriptive error if the update call fails', async () => {
  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = mock.fn(async () => {
    call += 1;
    if (call === 1) return { ok: true, status: 200, json: async () => ({}) };
    return { ok: false, status: 400, json: async () => ({}) };
  });
  try {
    await assert.rejects(
      () => overwriteSheetRange({ accessToken: 't', sheetId: 'S', tabName: 'MetaDaily', rows: [[1]] }),
      /Sheets update failed \(400\) for "MetaDaily"/
    );
  } finally {
    global.fetch = originalFetch;
  }
});
