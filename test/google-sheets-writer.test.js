// test/google-sheets-writer.test.js
const { test, mock } = require('node:test');
const assert = require('node:assert');
const { overwriteSheetRange, overwriteSheetBand } = require('../lib/google-sheets-writer');

test('overwriteSheetRange writes the new rows starting at row 2, then clears any leftover rows below', async () => {
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

    // Write happens first, so the tab is never empty even if the clear step below fails.
    assert.strictEqual(calls[0].method, 'PUT');
    assert.match(calls[0].url, /\/values\/GoogleDaily!A2\?valueInputOption=RAW$/);
    assert.strictEqual(calls[0].headers.Authorization, 'Bearer tok123');
    assert.deepStrictEqual(JSON.parse(calls[0].body), { values: [['L - Search - Brand', '2026-08-01', 'GBP', 100]] });

    // Then leftover rows below the write are cleared, limited to the row's own column width (4 -> D).
    assert.strictEqual(calls[1].method, 'POST');
    assert.match(calls[1].url, /\/values\/GoogleDaily!A3%3AD100000:clear$/);
    assert.strictEqual(calls[1].headers.Authorization, 'Bearer tok123');
  } finally {
    global.fetch = originalFetch;
  }
});

test('overwriteSheetRange clears only through the caller-provided column count, not a hardcoded Z', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = mock.fn(async (url, opts) => {
    calls.push({ url, method: opts.method });
    return { ok: true, status: 200, json: async () => ({}) };
  });
  try {
    await overwriteSheetRange({
      accessToken: 'tok123',
      sheetId: 'SHEET_ID',
      tabName: 'Creatives',
      rows: [['a', 'b']],
      columnCount: 11, // Creatives' real width, wider than this test's 2-column row
    });

    assert.match(calls[1].url, /\/values\/Creatives!A3%3AK100000:clear$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('overwriteSheetRange throws before any fetch call when rows is an empty array', async () => {
  const originalFetch = global.fetch;
  const fetchMock = mock.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  global.fetch = fetchMock;
  try {
    await assert.rejects(
      () => overwriteSheetRange({ accessToken: 't', sheetId: 'S', tabName: 'Creatives', rows: [] }),
      /Refusing to overwrite "Creatives" with 0 rows/
    );
    assert.strictEqual(fetchMock.mock.calls.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('overwriteSheetRange throws a descriptive error if the update call fails, and never attempts to clear', async () => {
  const originalFetch = global.fetch;
  const fetchMock = mock.fn(async () => ({ ok: false, status: 400, json: async () => ({}) }));
  global.fetch = fetchMock;
  try {
    await assert.rejects(
      () => overwriteSheetRange({ accessToken: 't', sheetId: 'S', tabName: 'MetaDaily', rows: [[1]] }),
      /Sheets update failed \(400\) for "MetaDaily"/
    );
    assert.strictEqual(fetchMock.mock.calls.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('overwriteSheetRange throws a descriptive error if the clear call fails, after the update already succeeded', async () => {
  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = mock.fn(async () => {
    call += 1;
    if (call === 1) return { ok: true, status: 200, json: async () => ({}) };
    return { ok: false, status: 403, json: async () => ({}) };
  });
  try {
    await assert.rejects(
      () => overwriteSheetRange({ accessToken: 't', sheetId: 'S', tabName: 'Creatives', rows: [[1]] }),
      /Sheets clear failed \(403\) for "Creatives"/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('overwriteSheetBand writes rows starting at the given startRow, then clears the rest of the band', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = mock.fn(async (url, opts) => {
    calls.push({ url, method: opts.method, body: opts.body, headers: opts.headers });
    return { ok: true, status: 200, json: async () => ({}) };
  });
  try {
    await overwriteSheetBand({
      accessToken: 'tok123', sheetId: 'SHEET_ID', tabName: 'Creatives',
      startRow: 402, bandSize: 400, rows: [['Ad 1', 10]], columnCount: 11,
    });

    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].method, 'PUT');
    assert.match(calls[0].url, /\/values\/Creatives!A402\?valueInputOption=RAW$/);
    assert.deepStrictEqual(JSON.parse(calls[0].body), { values: [['Ad 1', 10]] });

    // Band is rows 402..801 (bandSize 400). 1 row written, so rows 403..801 get cleared.
    assert.strictEqual(calls[1].method, 'POST');
    assert.match(calls[1].url, /\/values\/Creatives!A403%3AK801:clear$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('overwriteSheetBand accepts 0 rows and clears the entire band instead of writing', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = mock.fn(async (url, opts) => {
    calls.push({ url, method: opts.method });
    return { ok: true, status: 200, json: async () => ({}) };
  });
  try {
    await overwriteSheetBand({
      accessToken: 'tok123', sheetId: 'SHEET_ID', tabName: 'Creatives',
      startRow: 2, bandSize: 400, rows: [], columnCount: 11,
    });

    assert.strictEqual(calls.length, 1); // no PUT — only the clear
    assert.strictEqual(calls[0].method, 'POST');
    assert.match(calls[0].url, /\/values\/Creatives!A2%3AK401:clear$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('overwriteSheetBand skips the clear call entirely when rows exactly fill the band', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = mock.fn(async (url, opts) => {
    calls.push({ url, method: opts.method });
    return { ok: true, status: 200, json: async () => ({}) };
  });
  try {
    await overwriteSheetBand({
      accessToken: 'tok123', sheetId: 'SHEET_ID', tabName: 'Creatives',
      startRow: 2, bandSize: 2, rows: [['a'], ['b']], columnCount: 1,
    });

    assert.strictEqual(calls.length, 1); // only the PUT — nothing left to clear
    assert.strictEqual(calls[0].method, 'PUT');
  } finally {
    global.fetch = originalFetch;
  }
});

test('overwriteSheetBand throws before any fetch call when rows exceeds bandSize', async () => {
  const originalFetch = global.fetch;
  const fetchMock = mock.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  global.fetch = fetchMock;
  try {
    await assert.rejects(
      () => overwriteSheetBand({
        accessToken: 't', sheetId: 'S', tabName: 'Creatives',
        startRow: 2, bandSize: 1, rows: [['a'], ['b']], columnCount: 1,
      }),
      /Band overflow: 2 rows exceeds band size 1 for "Creatives" starting at row 2/
    );
    assert.strictEqual(fetchMock.mock.calls.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('overwriteSheetBand throws a descriptive error if the update call fails, and never attempts to clear', async () => {
  const originalFetch = global.fetch;
  const fetchMock = mock.fn(async () => ({ ok: false, status: 400, json: async () => ({}) }));
  global.fetch = fetchMock;
  try {
    await assert.rejects(
      () => overwriteSheetBand({
        accessToken: 't', sheetId: 'S', tabName: 'Creatives',
        startRow: 2, bandSize: 400, rows: [['a']], columnCount: 1,
      }),
      /Sheets update failed \(400\) for "Creatives" band at row 2/
    );
    assert.strictEqual(fetchMock.mock.calls.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('overwriteSheetBand throws a descriptive error if the clear call fails, after the update already succeeded', async () => {
  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = mock.fn(async () => {
    call += 1;
    if (call === 1) return { ok: true, status: 200, json: async () => ({}) };
    return { ok: false, status: 403, json: async () => ({}) };
  });
  try {
    await assert.rejects(
      () => overwriteSheetBand({
        accessToken: 't', sheetId: 'S', tabName: 'Creatives',
        startRow: 2, bandSize: 400, rows: [['a']], columnCount: 1,
      }),
      /Sheets clear failed \(403\) for "Creatives" band at row 2/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('overwriteSheetBand never issues a request touching rows outside its own band', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = mock.fn(async (url, opts) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({}) };
  });
  try {
    // Chunk 1's band: rows 402..801. Write 1 row; clear range must stay within 403..801.
    await overwriteSheetBand({
      accessToken: 't', sheetId: 'S', tabName: 'Creatives',
      startRow: 402, bandSize: 400, rows: [['a']], columnCount: 1,
    });
    const clearCall = calls.find((u) => u.includes(':clear'));
    assert.match(clearCall, /A403%3AA801:clear$/); // never reaches row 802 (chunk 2's band)
  } finally {
    global.fetch = originalFetch;
  }
});
