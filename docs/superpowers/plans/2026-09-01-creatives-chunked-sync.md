# Chunked Creatives Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the `Creatives` Sheet tab (ad-level Meta performance, feeding the PROVEN KPI card) fresh via 6 independent, cron-triggered sync jobs, each covering a 5-day slice of the rolling 30-day window — small enough that most calls to Windsor's unreliable ad-level API succeed within Vercel Hobby's 10-second function cap, with a failed chunk simply retrying the next day instead of blanking its data.

**Architecture:** A new `api/sync-creatives.js`, triggered by 6 staggered Vercel Cron entries (`?chunk=0` through `?chunk=5`), each fetching one 5-day date range from Windsor's `facebook` connector, collapsing it to one row per ad (`lib/transform/aggregate-creatives-chunk.js`), and writing only into that chunk's own fixed 400-row band of the Creatives tab via a new band-scoped Sheets writer (`overwriteSheetBand` in `lib/google-sheets-writer.js`). The dashboard's existing `buildCreativesData` already re-aggregates every row by ad name across the whole tab, so six chunks' worth of one-row-per-ad data combine into the correct full-window totals with no changes to the read path.

**Tech Stack:** Plain Node.js (no framework, no new dependencies), Node's built-in `node:test` + `node:assert`, native `fetch` — matches the rest of this repo exactly.

**Spec:** `docs/superpowers/specs/2026-09-01-creatives-chunked-sync-design.md`

## Global Constraints

- No external npm dependencies — native `fetch` only, matching the existing codebase.
- Every new module follows the existing `module.exports = { ... }` CommonJS pattern.
- Tests use `node:test`/`node:assert` with `global.fetch` mocked via `mock.fn`, restored in a `finally` block — matching every existing test file's style in this repo.
- Windsor facebook account ID is fixed: `732629205086` (TrueStart Coffee) — never omit `account_id`.
- 6 chunks, `CHUNK_DAYS = 5` each, `BAND_SIZE = 400` rows reserved per chunk in the Creatives tab.
- `dateTo = daysAgo(1 + chunk*5)`, `dateFrom = daysAgo(5 + chunk*5)` for chunk `0..5` (yesterday-anchored, never today — today is a partial day).
- `bandStartRow(chunk) = 2 + chunk * BAND_SIZE` (row 1 is the header, untouched by any sync).
- On a Windsor fetch failure, no Sheets write is attempted at all — the band keeps its last-good data.
- 0 rows from a chunk is a legitimate result (clears its band), distinct from a fetch failure (which writes nothing).

---

## Task 1: Per-chunk ad aggregation

**Files:**
- Create: `lib/transform/aggregate-creatives-chunk.js`
- Test: `test/transform/aggregate-creatives-chunk.test.js`

**Interfaces:**
- Produces: `aggregateCreativesChunk(windsorRows: Array<Object>, { dateFrom: string, dateTo: string }): Array<Object>` — one object per unique `ad_name`, shaped exactly like a single Windsor row (`date_start`, `date_stop`, `ad_name`, `spend`, `impressions`, `actions_omni_purchase`, `adset_name`, `purchase_roas_omni_purchase`, `link_clicks`, `campaign`, `action_values_omni_purchase`), so it plugs directly into the existing `mapCreativesRows` (`lib/transform/windsor-to-sheet-rows.js`) unchanged. Used by Task 3 (`api/sync-creatives.js`).

- [ ] **Step 1: Write the failing tests**

```js
// test/transform/aggregate-creatives-chunk.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { aggregateCreativesChunk } = require('../../lib/transform/aggregate-creatives-chunk');

test('sums spend, impressions, purchases, link clicks, and conversion value per ad across multiple rows', () => {
  const rows = aggregateCreativesChunk(
    [
      { ad_name: 'Ad 1', spend: 10, impressions: 100, actions_omni_purchase: 2, link_clicks: 5, action_values_omni_purchase: 40, campaign: 'Camp A', adset_name: 'Adset A' },
      { ad_name: 'Ad 1', spend: 20, impressions: 200, actions_omni_purchase: 3, link_clicks: 7, action_values_omni_purchase: 60, campaign: 'Camp A', adset_name: 'Adset A' },
    ],
    { dateFrom: '2026-08-01', dateTo: '2026-08-05' }
  );
  assert.deepStrictEqual(rows, [{
    date_start: '2026-08-01', date_stop: '2026-08-05', ad_name: 'Ad 1',
    spend: 30, impressions: 300, actions_omni_purchase: 5, adset_name: 'Adset A',
    purchase_roas_omni_purchase: 100 / 30, link_clicks: 12, campaign: 'Camp A',
    action_values_omni_purchase: 100,
  }]);
});

test('picks the campaign/adset from the highest-spend row as representative, not the first or last', () => {
  const rows = aggregateCreativesChunk(
    [
      { ad_name: 'Ad 1', spend: 5, campaign: 'Low Spend Camp', adset_name: 'Low Adset' },
      { ad_name: 'Ad 1', spend: 50, campaign: 'High Spend Camp', adset_name: 'High Adset' },
      { ad_name: 'Ad 1', spend: 15, campaign: 'Mid Spend Camp', adset_name: 'Mid Adset' },
    ],
    { dateFrom: '2026-08-01', dateTo: '2026-08-05' }
  );
  assert.strictEqual(rows[0].campaign, 'High Spend Camp');
  assert.strictEqual(rows[0].adset_name, 'High Adset');
});

test('recomputes ROAS from summed spend and conversion value, not by averaging each row\'s own ROAS', () => {
  const rows = aggregateCreativesChunk(
    [
      { ad_name: 'Ad 1', spend: 10, action_values_omni_purchase: 100, purchase_roas_omni_purchase: 10 },
      { ad_name: 'Ad 1', spend: 90, action_values_omni_purchase: 90, purchase_roas_omni_purchase: 1 },
    ],
    { dateFrom: '2026-08-01', dateTo: '2026-08-05' }
  );
  // Naive average of (10, 1) would be 5.5 — wrong. Correct: (100+90) / (10+90) = 1.9.
  assert.strictEqual(rows[0].purchase_roas_omni_purchase, 1.9);
});

test('ROAS is 0, not Infinity/NaN, when summed spend is 0', () => {
  const rows = aggregateCreativesChunk(
    [{ ad_name: 'Ad 1', spend: 0, action_values_omni_purchase: 0 }],
    { dateFrom: '2026-08-01', dateTo: '2026-08-05' }
  );
  assert.strictEqual(rows[0].purchase_roas_omni_purchase, 0);
});

test('defaults missing numeric fields to 0 (Windsor omits a field entirely when its value is zero)', () => {
  const rows = aggregateCreativesChunk(
    [{ ad_name: 'Ad 1', spend: 5, campaign: 'Camp A', adset_name: 'Adset A' }], // no impressions/purchases/link_clicks/action_values
    { dateFrom: '2026-08-01', dateTo: '2026-08-05' }
  );
  assert.deepStrictEqual(rows[0], {
    date_start: '2026-08-01', date_stop: '2026-08-05', ad_name: 'Ad 1',
    spend: 5, impressions: 0, actions_omni_purchase: 0, adset_name: 'Adset A',
    purchase_roas_omni_purchase: 0, link_clicks: 0, campaign: 'Camp A',
    action_values_omni_purchase: 0,
  });
});

test('keeps two different ads as two separate output rows', () => {
  const rows = aggregateCreativesChunk(
    [
      { ad_name: 'Ad 1', spend: 10, campaign: 'Camp A', adset_name: 'Adset A' },
      { ad_name: 'Ad 2', spend: 20, campaign: 'Camp B', adset_name: 'Adset B' },
    ],
    { dateFrom: '2026-08-01', dateTo: '2026-08-05' }
  );
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows.map((r) => r.ad_name).sort(), ['Ad 1', 'Ad 2']);
});

test('skips a row with a blank/missing ad_name instead of creating a blank-keyed entry', () => {
  const rows = aggregateCreativesChunk(
    [
      { ad_name: '', spend: 10, campaign: 'Camp A' },
      { ad_name: 'Ad 1', spend: 20, campaign: 'Camp A' },
    ],
    { dateFrom: '2026-08-01', dateTo: '2026-08-05' }
  );
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].ad_name, 'Ad 1');
});

test('returns an empty array when given no rows', () => {
  assert.deepStrictEqual(aggregateCreativesChunk([], { dateFrom: '2026-08-01', dateTo: '2026-08-05' }), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/transform/aggregate-creatives-chunk.test.js`
Expected: FAIL with "Cannot find module '../../lib/transform/aggregate-creatives-chunk'"

- [ ] **Step 3: Write the implementation**

```js
// lib/transform/aggregate-creatives-chunk.js

function num(v) {
  return v === undefined || v === null ? 0 : Number(v) || 0;
}

function aggregateCreativesChunk(windsorRows, { dateFrom, dateTo }) {
  const byAdName = new Map();

  for (const row of windsorRows) {
    const adName = row.ad_name || '';
    if (!adName) continue;

    if (!byAdName.has(adName)) {
      byAdName.set(adName, {
        spend: 0, impressions: 0, purchases: 0, linkClicks: 0, actionValues: 0,
        topCampaign: '', topAdsetName: '', topSpend: -1,
      });
    }
    const agg = byAdName.get(adName);
    const spend = num(row.spend);
    agg.spend += spend;
    agg.impressions += num(row.impressions);
    agg.purchases += num(row.actions_omni_purchase);
    agg.linkClicks += num(row.link_clicks);
    agg.actionValues += num(row.action_values_omni_purchase);
    if (spend > agg.topSpend) {
      agg.topSpend = spend;
      agg.topCampaign = row.campaign || '';
      agg.topAdsetName = row.adset_name || '';
    }
  }

  return [...byAdName.entries()].map(([adName, agg]) => ({
    date_start: dateFrom,
    date_stop: dateTo,
    ad_name: adName,
    spend: agg.spend,
    impressions: agg.impressions,
    actions_omni_purchase: agg.purchases,
    adset_name: agg.topAdsetName,
    purchase_roas_omni_purchase: agg.spend > 0 ? agg.actionValues / agg.spend : 0,
    link_clicks: agg.linkClicks,
    campaign: agg.topCampaign,
    action_values_omni_purchase: agg.actionValues,
  }));
}

module.exports = { aggregateCreativesChunk };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/transform/aggregate-creatives-chunk.test.js`
Expected: PASS (8/8)

- [ ] **Step 5: Commit**

```bash
git add lib/transform/aggregate-creatives-chunk.js test/transform/aggregate-creatives-chunk.test.js
git commit -m "feat: add per-chunk ad aggregation for the chunked Creatives sync"
```

---

## Task 2: Band-scoped Sheets writer

**Files:**
- Modify: `lib/google-sheets-writer.js`
- Test: `test/google-sheets-writer.test.js` (extend)

**Interfaces:**
- Consumes: nothing new — same raw `fetch`-based Sheets API calls as the existing `overwriteSheetRange` in this file.
- Produces: `overwriteSheetBand({ accessToken, sheetId, tabName, startRow, bandSize, rows, columnCount }): Promise<void>` — writes `rows` starting at `startRow`, then clears any leftover rows in `[startRow + rows.length, startRow + bandSize)`. Throws if `rows.length > bandSize`. Accepts `rows: []` as a legitimate input (clears the whole band). Used by Task 3 (`api/sync-creatives.js`).

- [ ] **Step 1: Write the failing tests**

Append to `test/google-sheets-writer.test.js`:

```js
const { overwriteSheetRange, overwriteSheetBand } = require('../lib/google-sheets-writer');
```

(Replace the existing single-name import line at the top of the file with the line above, then add these tests at the end of the file:)

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/google-sheets-writer.test.js`
Expected: FAIL with "overwriteSheetBand is not a function" (or "is not exported")

- [ ] **Step 3: Write the implementation**

In `lib/google-sheets-writer.js`, add this function above `module.exports` and add `overwriteSheetBand` to the exports:

```js
async function overwriteSheetBand({ accessToken, sheetId, tabName, startRow, bandSize, rows, columnCount }) {
  if (!Array.isArray(rows)) {
    throw new Error(`overwriteSheetBand requires an array of rows for "${tabName}"`);
  }
  if (rows.length > bandSize) {
    throw new Error(`Band overflow: ${rows.length} rows exceeds band size ${bandSize} for "${tabName}" starting at row ${startRow}`);
  }

  const lastColumn = columnLetter(columnCount);

  if (rows.length > 0) {
    const updateRange = encodeURIComponent(`${tabName}!A${startRow}`);
    const updateRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${updateRange}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: rows }),
      }
    );
    if (!updateRes.ok) {
      throw new Error(`Sheets update failed (${updateRes.status}) for "${tabName}" band at row ${startRow}`);
    }
  }

  const clearStartRow = startRow + rows.length;
  const clearEndRow = startRow + bandSize - 1;
  if (clearStartRow <= clearEndRow) {
    const clearRange = encodeURIComponent(`${tabName}!A${clearStartRow}:${lastColumn}${clearEndRow}`);
    const clearRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${clearRange}:clear`,
      { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!clearRes.ok) {
      throw new Error(`Sheets clear failed (${clearRes.status}) for "${tabName}" band at row ${startRow}`);
    }
  }
}
```

Update the file's final line from:
```js
module.exports = { overwriteSheetRange };
```
to:
```js
module.exports = { overwriteSheetRange, overwriteSheetBand };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/google-sheets-writer.test.js`
Expected: PASS (all — 5 existing + 7 new)

- [ ] **Step 5: Commit**

```bash
git add lib/google-sheets-writer.js test/google-sheets-writer.test.js
git commit -m "feat: add band-scoped Sheets writer for the chunked Creatives sync"
```

---

## Task 3: Sync orchestrator and Vercel Cron handler

**Files:**
- Create: `api/sync-creatives.js`
- Test: `test/sync-creatives.test.js`

**Interfaces:**
- Consumes: `fetchWindsorData` (`lib/windsor.js`), `getAccessToken` (`lib/google-sheets-auth.js`), `overwriteSheetBand` (Task 2), `aggregateCreativesChunk` (Task 1), `mapCreativesRows` (`lib/transform/windsor-to-sheet-rows.js`), `isoDay` (`lib/dates.js`).
- Produces:
  - `chunkDateRange(chunk: number, referenceDate?: Date): { dateFrom: string, dateTo: string }`
  - `bandStartRow(chunk: number): number`
  - `async syncCreativesChunk(env, chunk: number): Promise<{ ok: boolean, rows?: number, error?: string }>` — pure, env passed explicitly (matches `syncWindsor`/`syncShopify`'s pattern).
  - `CHUNK_COUNT`, `CHUNK_DAYS`, `BAND_SIZE` constants.
  - `module.exports.default = async function handler(req, res)` — the Vercel entry point: checks `Authorization: Bearer ${process.env.CRON_SECRET}` (401 if missing/wrong), validates `req.query.chunk` is an integer in `[0, CHUNK_COUNT)` (400 if not), calls `syncCreativesChunk`, responds 200 on success or 500 on failure.

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/sync-creatives.test.js`
Expected: FAIL with "Cannot find module '../api/sync-creatives'"

- [ ] **Step 3: Write the implementation**

```js
// api/sync-creatives.js
const { fetchWindsorData } = require('../lib/windsor');
const { getAccessToken } = require('../lib/google-sheets-auth');
const { overwriteSheetBand } = require('../lib/google-sheets-writer');
const { aggregateCreativesChunk } = require('../lib/transform/aggregate-creatives-chunk');
const { mapCreativesRows } = require('../lib/transform/windsor-to-sheet-rows');
const { isoDay } = require('../lib/dates');

const FACEBOOK_ACCOUNT_ID = '732629205086';
const CHUNK_COUNT = 6;
const CHUNK_DAYS = 5;
const BAND_SIZE = 400;
const REQUIRED_ENV_VARS = ['WINDSOR_API_KEY', 'GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_KEY'];

function chunkDateRange(chunk, referenceDate = new Date()) {
  const end = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - 1 - chunk * CHUNK_DAYS); // yesterday, minus this chunk's offset
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (CHUNK_DAYS - 1));
  return { dateFrom: isoDay(start), dateTo: isoDay(end) };
}

function bandStartRow(chunk) {
  return 2 + chunk * BAND_SIZE;
}

async function syncCreativesChunk(env, chunk) {
  const missing = REQUIRED_ENV_VARS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  const { dateFrom, dateTo } = chunkDateRange(chunk);

  // Windsor first, on its own — it's the failure-prone step (verified: ~50% of ad-level calls
  // fail or run long in testing). No point spending a token-fetch round trip if it's going to fail.
  const windsorRows = await fetchWindsorData({
    apiKey: env.WINDSOR_API_KEY, connector: 'facebook', accountId: FACEBOOK_ACCOUNT_ID, dateFrom, dateTo,
    fields: ['date_start', 'date_stop', 'ad_name', 'spend', 'impressions', 'actions_omni_purchase', 'adset_name', 'purchase_roas_omni_purchase', 'link_clicks', 'campaign', 'action_values_omni_purchase'],
  });

  const aggregated = aggregateCreativesChunk(windsorRows, { dateFrom, dateTo });
  const sheetRows = mapCreativesRows(aggregated);

  const accessToken = await getAccessToken({
    clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n'),
  });

  await overwriteSheetBand({
    accessToken, sheetId: env.GOOGLE_SHEET_ID, tabName: 'Creatives',
    startRow: bandStartRow(chunk), bandSize: BAND_SIZE, rows: sheetRows, columnCount: 11,
  });

  return { ok: true, rows: sheetRows.length };
}

module.exports = { syncCreativesChunk, chunkDateRange, bandStartRow, CHUNK_COUNT, CHUNK_DAYS, BAND_SIZE };

module.exports.default = async function handler(req, res) {
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!req.headers.authorization || req.headers.authorization !== expected) {
    res.status(401).send('Unauthorized');
    return;
  }

  const chunk = Number(req.query && req.query.chunk);
  if (!Number.isInteger(chunk) || chunk < 0 || chunk >= CHUNK_COUNT) {
    res.status(400).json({ error: `chunk must be an integer between 0 and ${CHUNK_COUNT - 1}` });
    return;
  }

  try {
    const result = await syncCreativesChunk(process.env, chunk);
    res.status(200).json(result);
  } catch (err) {
    console.error(`[sync-creatives] chunk ${chunk} failed:`, err);
    res.status(500).json({ ok: false, error: err.message });
  }
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/sync-creatives.test.js`
Expected: PASS (all)

- [ ] **Step 5: Run the full test suite to confirm nothing else broke**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add api/sync-creatives.js test/sync-creatives.test.js
git commit -m "feat: add chunked Creatives sync orchestrator and Cron handler"
```

---

## Task 4: Wire up the 6 Cron schedules

**Files:**
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `api/sync-creatives.js`'s default export (Task 3) as the Cron target for all 6 entries.
- Produces: nothing consumed by other tasks — this is the final wiring step. No new env vars needed (`WINDSOR_API_KEY`, `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY`, `CRON_SECRET` are already configured for the existing sync jobs and are reused as-is).

- [ ] **Step 1: Add the 6 Cron schedules and function timeout to `vercel.json`**

Replace the file's contents with:

```json
{
  "rewrites": [
    { "source": "/", "destination": "/api/dashboard" }
  ],
  "crons": [
    { "path": "/api/sync-windsor", "schedule": "0 6 * * *" },
    { "path": "/api/sync-shopify", "schedule": "10 6 * * *" },
    { "path": "/api/sync-creatives?chunk=0", "schedule": "20 6 * * *" },
    { "path": "/api/sync-creatives?chunk=1", "schedule": "25 6 * * *" },
    { "path": "/api/sync-creatives?chunk=2", "schedule": "30 6 * * *" },
    { "path": "/api/sync-creatives?chunk=3", "schedule": "35 6 * * *" },
    { "path": "/api/sync-creatives?chunk=4", "schedule": "40 6 * * *" },
    { "path": "/api/sync-creatives?chunk=5", "schedule": "45 6 * * *" }
  ],
  "functions": {
    "api/sync-windsor.js": { "maxDuration": 60 },
    "api/sync-shopify.js": { "maxDuration": 60 },
    "api/sync-creatives.js": { "maxDuration": 60 }
  }
}
```

- [ ] **Step 2: Update the now-stale comment in `api/sync-windsor.js`**

That file has a comment (around line 33-38) explaining why Creatives isn't synced there, ending with "Creatives stays on whatever process was updating it before this feature existed." That's no longer true. In `api/sync-windsor.js`, replace:

```js
  // Note: the Creatives tab (ad-level Meta data) is deliberately NOT synced here. Windsor's
  // facebook connector at ad-level granularity takes 20s+ even for a single day's data (verified
  // directly against the live API), which can never fit inside Vercel Hobby's hard 10s function
  // timeout. GoogleDaily/MetaDaily are campaign+day-level aggregates and respond in ~2s for the
  // full 90-day window, so only those two are synced by this job. Creatives stays on whatever
  // process was updating it before this feature existed.
```

with:

```js
  // Note: the Creatives tab (ad-level Meta data) is deliberately NOT synced here. Windsor's
  // facebook connector at ad-level granularity is too slow/unreliable for a single Vercel Hobby
  // function call (verified directly against the live API: timings ranging 1.6s-31s and outright
  // failures, regardless of date-range width). GoogleDaily/MetaDaily are campaign+day-level
  // aggregates and respond in ~2s for the full 90-day window, so only those two are synced by this
  // job. Creatives has its own chunked sync instead — see api/sync-creatives.js.
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: All tests PASS (config + comment-only change)

- [ ] **Step 4: Commit**

```bash
git add vercel.json api/sync-windsor.js
git commit -m "chore: wire up 6 staggered Cron schedules for the chunked Creatives sync"
```

---

## Task 5: Bump the live Creatives tab's row capacity

**Files:** none in this repo — a one-time change against the live Google Sheet via the Sheets API, same mechanism used earlier this session to create the `ShopifyNewCustomersMonthly` tab.

**Interfaces:**
- Consumes: `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY` from `.env` (local, not committed).
- Produces: nothing consumed by other tasks — this just needs to happen before the first real Cron run writes past row 1,000.

- [ ] **Step 1: Confirm the Creatives tab's current row count**

Using the service-account credentials already in `.env`, call `spreadsheets.get` with `fields=sheets.properties` and find the sheet with `title: "Creatives"`. Confirm its `gridProperties.rowCount` is `1000` (it was, per this session's earlier investigation) and note its `sheetId` (was `0`).

- [ ] **Step 2: Bump it to 2,500 rows via `batchUpdate`**

Call `spreadsheets.batchUpdate` with a single `updateSheetProperties` request:

```json
{
  "requests": [{
    "updateSheetProperties": {
      "properties": { "sheetId": 0, "gridProperties": { "rowCount": 2500 } },
      "fields": "gridProperties.rowCount"
    }
  }]
}
```

(Use the real `sheetId` confirmed in Step 1 — it's expected to be `0` based on this session's earlier investigation, but re-confirm rather than assuming.)

- [ ] **Step 3: Verify**

Re-run the `spreadsheets.get` call from Step 1 and confirm `gridProperties.rowCount` is now `2500`.

---

## Task 6: Deploy and verify the first live run

**Files:** none — deployment and manual verification only.

- [ ] **Step 1: Push and deploy**

```bash
git push origin master
```

Then deploy via `vercel --prod` (or wait for the GitHub-integration auto-deploy, whichever this project is currently using — confirm which by checking whether the push alone produces a new deployment within a minute or two).

- [ ] **Step 2: Manually trigger one chunk to verify end-to-end before waiting for the schedule**

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" "https://truestart-cafe.vercel.app/api/sync-creatives?chunk=0"
```

Expected: `{"ok":true,"rows":<N>}` (some positive row count) or a clean `{"ok":false,"error":"..."}` if Windsor happened to fail that call (acceptable — it's the known-flaky path; try again).

- [ ] **Step 3: Confirm the write landed in the right band**

Check the `Creatives` tab directly (or via the Sheets API `values.get` on `Creatives!A2:K10`) and confirm rows 2 onward now hold chunk 0's data with `Reporting starts`/`Reporting ends` matching chunk 0's date range (yesterday minus 4 days, through yesterday).

- [ ] **Step 4: Confirm the dashboard still renders correctly**

Fetch the live dashboard HTML and confirm the PROVEN KPI card still renders a number (not "Creatives data unavailable") and the All Creatives table still populates — `buildCreativesData` should transparently combine chunk 0's fresh band with whatever's still in the other 5 (as-yet-unsynced-this-run) bands.

- [ ] **Step 5: Note the follow-up**

The remaining 5 chunks (and chunk 0 again, daily) will populate on their own schedule starting the next `06:20`–`06:45` UTC window. No further action needed unless a chunk's data still looks stale after 24-48 hours, which would indicate a persistent (not just intermittent) Windsor failure worth investigating separately.
