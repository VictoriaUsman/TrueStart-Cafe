# Windsor.ai → Sheet Daily Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily Vercel Cron job that pulls Meta/Google ad data from Windsor.ai for TrueStart's connected accounts and overwrites a rolling 90-day window into the `Creatives`, `GoogleDaily`, and `MetaDaily` tabs of the `TrueStart_Dashboard_Data` Google Sheet, leaving the dashboard's own read path (CSV export) completely unchanged.

**Architecture:** Five small, independently-testable modules (`lib/windsor.js`, `lib/google-sheets-auth.js`, `lib/google-sheets-writer.js`, `lib/transform/windsor-to-sheet-rows.js`) composed by one orchestrator (`api/sync-windsor.js`) that Vercel Cron triggers once a day. Each of the three tabs is fetched, mapped, and written independently so one tab's failure doesn't block the others.

**Tech Stack:** Plain Node.js (no framework, no external npm dependencies — matches the rest of this repo), Node's built-in `node:test` + `node:assert`, native `fetch`, Node's built-in `crypto` for JWT signing.

**Spec:** `docs/superpowers/specs/2026-08-31-windsor-sync-design.md`

## Global Constraints

- No external npm dependencies — use native `fetch` and built-in `crypto` only, matching the existing codebase.
- Every new module follows the existing `module.exports = { ... }` CommonJS pattern (see `lib/shopify.js`, `lib/sheets.js`).
- Tests use `node:test`/`node:assert` with `global.fetch` mocked via `mock.fn`, restored in a `finally` block — matching `test/shopify.test.js`'s exact style.
- Windsor account IDs are fixed and must always be passed explicitly — **never** omit `account_id` on a `google_ads` request (the workspace has a second, unrelated account, `google_ads__NBS` / `652-880-9542`, that must never be queried):
  - Facebook (TrueStart Coffee): `732629205086`
  - Google Ads (TrueStart Coffee): `779-598-7920`
- Rolling window size is 90 days for all three tabs.
- Confirmed real Sheet tab headers (exact strings, exact order — do not deviate):
  - `Creatives`: `Reporting starts, Reporting ends, Ad name, Amount spent (GBP), Impressions, Purchases, Ad set name, Purchase ROAS (return on ad spend), Link clicks, Campaign name, Purchases conversion value`
  - `GoogleDaily`: `Campaign, Day, Currency code, Cost, Impr., Clicks, Conversions, Conv. value`
  - `MetaDaily`: `Campaign name, Day, Impressions, Amount spent (GBP), Link clicks, Purchases, Purchases conversion value, Purchase ROAS (return on ad spend), Reporting starts, Reporting ends`
- Confirmed Windsor.ai field IDs (verified live against the `facebook`/`google_ads` connectors' `/fields` catalogs):
  - Facebook: `date`, `date_start`, `date_stop`, `campaign`, `ad_name`, `adset_name`, `spend`, `impressions`, `link_clicks`, `actions_omni_purchase` (purchase count), `action_values_omni_purchase` (purchase conversion value £), `purchase_roas_omni_purchase` (purchase ROAS)
  - Google Ads: `campaign`, `date`, `currency`, `cost`, `impressions`, `clicks`, `conversions`, `conversion_value`

---

## Task 1: Windsor.ai Connectors API client

**Files:**
- Create: `lib/windsor.js`
- Test: `test/windsor.test.js`

**Interfaces:**
- Produces: `async fetchWindsorData({ apiKey, connector, accountId, fields, dateFrom, dateTo }): Promise<Array<Object>>` — one object per Windsor row, keyed by the requested field IDs. Used by Task 5 (`api/sync-windsor.js`).

- [ ] **Step 1: Write the failing tests**

```js
// test/windsor.test.js
const { test, mock } = require('node:test');
const assert = require('node:assert');
const { fetchWindsorData } = require('../lib/windsor');

test('fetchWindsorData requests the right URL and returns the data array', async () => {
  const originalFetch = global.fetch;
  let capturedUrl;
  global.fetch = mock.fn(async (url) => {
    capturedUrl = url;
    return { ok: true, status: 200, json: async () => ({ data: [{ date: '2026-08-01', spend: 12.5 }] }) };
  });
  try {
    const rows = await fetchWindsorData({
      apiKey: 'key123',
      connector: 'facebook',
      accountId: '732629205086',
      fields: ['date', 'spend'],
      dateFrom: '2026-06-03',
      dateTo: '2026-08-31',
    });
    assert.deepStrictEqual(rows, [{ date: '2026-08-01', spend: 12.5 }]);
    assert.match(capturedUrl, /^https:\/\/connectors\.windsor\.ai\/facebook\?/);
    assert.match(capturedUrl, /api_key=key123/);
    assert.match(capturedUrl, /fields=date%2Cspend/);
    assert.match(capturedUrl, /account_id=732629205086/);
    assert.match(capturedUrl, /date_from=2026-06-03/);
    assert.match(capturedUrl, /date_to=2026-08-31/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchWindsorData throws a descriptive error on a non-2xx HTTP response', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  try {
    await assert.rejects(
      () => fetchWindsorData({ apiKey: 'bad', connector: 'facebook', accountId: '1', fields: ['date'], dateFrom: '2026-01-01', dateTo: '2026-01-02' }),
      /Windsor API error \(401\)/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchWindsorData throws when Windsor returns a body-level error (e.g. bad field name)', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async () => ({ ok: true, status: 200, json: async () => ({ error: 'Sorry, some of the fields you have selected are not valid.' }) }));
  try {
    await assert.rejects(
      () => fetchWindsorData({ apiKey: 'k', connector: 'facebook', accountId: '1', fields: ['not_a_field'], dateFrom: '2026-01-01', dateTo: '2026-01-02' }),
      /Windsor API error: Sorry, some of the fields/
    );
  } finally {
    global.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/windsor.test.js`
Expected: FAIL with "Cannot find module '../lib/windsor'"

- [ ] **Step 3: Write the implementation**

```js
// lib/windsor.js

async function fetchWindsorData({ apiKey, connector, accountId, fields, dateFrom, dateTo }) {
  const params = new URLSearchParams({
    api_key: apiKey,
    fields: fields.join(','),
    account_id: accountId,
    date_from: dateFrom,
    date_to: dateTo,
  });
  const res = await fetch(`https://connectors.windsor.ai/${connector}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Windsor API error (${res.status}) for connector "${connector}"`);
  }
  const json = await res.json();
  if (json.error) {
    throw new Error(`Windsor API error: ${json.error}`);
  }
  return json.data || [];
}

module.exports = { fetchWindsorData };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/windsor.test.js`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add lib/windsor.js test/windsor.test.js
git commit -m "feat: add Windsor.ai Connectors API client"
```

---

## Task 2: Google service-account JWT auth

**Files:**
- Create: `lib/google-sheets-auth.js`
- Test: `test/google-sheets-auth.test.js`

**Interfaces:**
- Produces: `async getAccessToken({ clientEmail, privateKey, scope? }): Promise<string>` — an OAuth2 bearer token for the Google Sheets API. Used by Task 5 (`api/sync-windsor.js`), which passes it to Task 3's writer.

- [ ] **Step 1: Write the failing tests**

```js
// test/google-sheets-auth.test.js
const { test, mock } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { getAccessToken } = require('../lib/google-sheets-auth');

// Generate a throwaway RSA keypair once for these tests — no real credentials involved.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function b64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

test('getAccessToken builds a valid signed JWT and returns the access token from the response', async () => {
  const originalFetch = global.fetch;
  let capturedBody;
  global.fetch = mock.fn(async (url, opts) => {
    capturedBody = opts.body;
    return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.fake-token' }) };
  });
  try {
    const token = await getAccessToken({ clientEmail: 'sheet-writer@example.iam.gserviceaccount.com', privateKey });
    assert.strictEqual(token, 'ya29.fake-token');

    const params = new URLSearchParams(capturedBody);
    assert.strictEqual(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    const jwt = params.get('assertion');
    const [headerB64, claimB64, sigB64] = jwt.split('.');
    const claim = JSON.parse(b64urlDecode(claimB64));
    assert.strictEqual(claim.iss, 'sheet-writer@example.iam.gserviceaccount.com');
    assert.strictEqual(claim.scope, 'https://www.googleapis.com/auth/spreadsheets');
    assert.strictEqual(claim.aud, 'https://oauth2.googleapis.com/token');

    // Signature must actually verify against the matching public key.
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${claimB64}`);
    const sig = Buffer.from(sigB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    assert.strictEqual(verifier.verify(publicKey, sig), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('getAccessToken throws a descriptive error when Google rejects the assertion', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async () => ({ ok: true, status: 200, json: async () => ({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }) }));
  try {
    await assert.rejects(
      () => getAccessToken({ clientEmail: 'x@example.com', privateKey }),
      /Google auth failed: invalid_grant/
    );
  } finally {
    global.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/google-sheets-auth.test.js`
Expected: FAIL with "Cannot find module '../lib/google-sheets-auth'"

- [ ] **Step 3: Write the implementation**

```js
// lib/google-sheets-auth.js
const crypto = require('crypto');

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken({ clientEmail, privateKey, scope = 'https://www.googleapis.com/auth/spreadsheets' }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = signer
    .sign(privateKey)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });
  const json = await res.json();
  if (!json.access_token) {
    throw new Error(`Google auth failed: ${json.error || 'unknown error'} ${json.error_description || ''}`.trim());
  }
  return json.access_token;
}

module.exports = { getAccessToken };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/google-sheets-auth.test.js`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add lib/google-sheets-auth.js test/google-sheets-auth.test.js
git commit -m "feat: add Google service-account JWT auth for Sheets API"
```

---

## Task 3: Google Sheets range writer

**Files:**
- Create: `lib/google-sheets-writer.js`
- Test: `test/google-sheets-writer.test.js`

**Interfaces:**
- Consumes: an access token string, as produced by Task 2's `getAccessToken`.
- Produces: `async overwriteSheetRange({ accessToken, sheetId, tabName, rows }): Promise<void>` — clears the tab's existing data (everything from row 2 down) and writes `rows` (a 2D array of values) starting at row 2, leaving row 1 (headers) untouched. Used by Task 5 (`api/sync-windsor.js`).

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/google-sheets-writer.test.js`
Expected: FAIL with "Cannot find module '../lib/google-sheets-writer'"

- [ ] **Step 3: Write the implementation**

```js
// lib/google-sheets-writer.js

async function overwriteSheetRange({ accessToken, sheetId, tabName, rows }) {
  const clearRange = encodeURIComponent(`${tabName}!A2:Z100000`);
  const clearRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${clearRange}:clear`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!clearRes.ok) {
    throw new Error(`Sheets clear failed (${clearRes.status}) for "${tabName}"`);
  }

  const updateRange = encodeURIComponent(`${tabName}!A2`);
  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${updateRange}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    }
  );
  if (!updateRes.ok) {
    throw new Error(`Sheets update failed (${updateRes.status}) for "${tabName}"`);
  }
}

module.exports = { overwriteSheetRange };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/google-sheets-writer.test.js`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add lib/google-sheets-writer.js test/google-sheets-writer.test.js
git commit -m "feat: add Google Sheets range overwrite writer"
```

---

## Task 4: Windsor row → Sheet row mapping

**Files:**
- Create: `lib/transform/windsor-to-sheet-rows.js`
- Test: `test/transform/windsor-to-sheet-rows.test.js`

**Interfaces:**
- Produces:
  - `mapCreativesRows(windsorRows: Array<Object>): Array<Array<string|number>>` — columns in exact order: `date_start, date_stop, ad_name, spend, impressions, actions_omni_purchase, adset_name, purchase_roas_omni_purchase, link_clicks, campaign, action_values_omni_purchase`.
  - `mapGoogleDailyRows(windsorRows: Array<Object>): Array<Array<string|number>>` — columns: `campaign, date, currency, cost, impressions, clicks, conversions, conversion_value`.
  - `mapMetaDailyRows(windsorRows: Array<Object>): Array<Array<string|number>>` — columns: `campaign, date, impressions, spend, link_clicks, actions_omni_purchase, action_values_omni_purchase, purchase_roas_omni_purchase, date (as Reporting starts), date (as Reporting ends)`.
  - All three default any missing numeric field to `0` (Windsor omits a field from a row entirely when its value is zero, e.g. no purchases that day) and any missing text field to `''`.
  - Used by Task 5 (`api/sync-windsor.js`).

- [ ] **Step 1: Write the failing tests**

```js
// test/transform/windsor-to-sheet-rows.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { mapCreativesRows, mapGoogleDailyRows, mapMetaDailyRows } = require('../../lib/transform/windsor-to-sheet-rows');

test('mapCreativesRows maps a full Windsor facebook row to the Creatives column order', () => {
  const rows = mapCreativesRows([{
    date_start: '2026-06-03', date_stop: '2026-08-31', ad_name: 'BOF_ST_01_Loyal_Price_Taster_Bags V1',
    spend: 100.5, impressions: 5000, actions_omni_purchase: 25, adset_name: 'Retargeting Adset',
    purchase_roas_omni_purchase: 4.2, link_clicks: 300, campaign: 'K-TS_UK_BOF_Sales Retargeting',
    action_values_omni_purchase: 420,
  }]);
  assert.deepStrictEqual(rows, [[
    '2026-06-03', '2026-08-31', 'BOF_ST_01_Loyal_Price_Taster_Bags V1', 100.5, 5000, 25,
    'Retargeting Adset', 4.2, 300, 'K-TS_UK_BOF_Sales Retargeting', 420,
  ]]);
});

test('mapCreativesRows defaults a missing purchases/conversion-value field to 0', () => {
  const rows = mapCreativesRows([{
    date_start: '2026-08-01', date_stop: '2026-08-01', ad_name: 'Ad with no purchases',
    spend: 5, impressions: 100, adset_name: 'Adset', link_clicks: 2, campaign: 'Campaign',
    // actions_omni_purchase, purchase_roas_omni_purchase, action_values_omni_purchase all omitted
  }]);
  assert.deepStrictEqual(rows, [[
    '2026-08-01', '2026-08-01', 'Ad with no purchases', 5, 100, 0, 'Adset', 0, 2, 'Campaign', 0,
  ]]);
});

test('mapGoogleDailyRows maps a full Windsor google_ads row to the GoogleDaily column order', () => {
  const rows = mapGoogleDailyRows([{
    campaign: 'L - Search - Brand', date: '2026-08-24', currency: 'GBP', cost: 66.23,
    impressions: 2000, clicks: 80, conversions: 5, conversion_value: 250,
  }]);
  assert.deepStrictEqual(rows, [['L - Search - Brand', '2026-08-24', 'GBP', 66.23, 2000, 80, 5, 250]]);
});

test('mapGoogleDailyRows defaults missing numeric fields to 0', () => {
  const rows = mapGoogleDailyRows([{ campaign: 'L - PMax', date: '2026-08-24', currency: 'GBP', cost: 10 }]);
  assert.deepStrictEqual(rows, [['L - PMax', '2026-08-24', 'GBP', 10, 0, 0, 0, 0]]);
});

test('mapMetaDailyRows maps a full Windsor facebook daily row to the MetaDaily column order, using date for both reporting start and end', () => {
  const rows = mapMetaDailyRows([{
    campaign: 'K-TS_UK_BOF-PROVEN', date: '2026-08-24', impressions: 1000, spend: 100,
    link_clicks: 50, actions_omni_purchase: 25, action_values_omni_purchase: 400,
    purchase_roas_omni_purchase: 4,
  }]);
  assert.deepStrictEqual(rows, [[
    'K-TS_UK_BOF-PROVEN', '2026-08-24', 1000, 100, 50, 25, 400, 4, '2026-08-24', '2026-08-24',
  ]]);
});

test('mapMetaDailyRows defaults missing numeric fields to 0', () => {
  const rows = mapMetaDailyRows([{ campaign: 'Feeder', date: '2026-08-24', impressions: 500, spend: 20, link_clicks: 3 }]);
  assert.deepStrictEqual(rows, [['Feeder', '2026-08-24', 500, 20, 3, 0, 0, 0, '2026-08-24', '2026-08-24']]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/transform/windsor-to-sheet-rows.test.js`
Expected: FAIL with "Cannot find module '../../lib/transform/windsor-to-sheet-rows'"

- [ ] **Step 3: Write the implementation**

```js
// lib/transform/windsor-to-sheet-rows.js

function num(row, field) {
  return row[field] === undefined || row[field] === null ? 0 : row[field];
}

function text(row, field) {
  return row[field] === undefined || row[field] === null ? '' : row[field];
}

function mapCreativesRows(windsorRows) {
  return windsorRows.map((row) => [
    text(row, 'date_start'),
    text(row, 'date_stop'),
    text(row, 'ad_name'),
    num(row, 'spend'),
    num(row, 'impressions'),
    num(row, 'actions_omni_purchase'),
    text(row, 'adset_name'),
    num(row, 'purchase_roas_omni_purchase'),
    num(row, 'link_clicks'),
    text(row, 'campaign'),
    num(row, 'action_values_omni_purchase'),
  ]);
}

function mapGoogleDailyRows(windsorRows) {
  return windsorRows.map((row) => [
    text(row, 'campaign'),
    text(row, 'date'),
    text(row, 'currency'),
    num(row, 'cost'),
    num(row, 'impressions'),
    num(row, 'clicks'),
    num(row, 'conversions'),
    num(row, 'conversion_value'),
  ]);
}

function mapMetaDailyRows(windsorRows) {
  return windsorRows.map((row) => [
    text(row, 'campaign'),
    text(row, 'date'),
    num(row, 'impressions'),
    num(row, 'spend'),
    num(row, 'link_clicks'),
    num(row, 'actions_omni_purchase'),
    num(row, 'action_values_omni_purchase'),
    num(row, 'purchase_roas_omni_purchase'),
    text(row, 'date'),
    text(row, 'date'),
  ]);
}

module.exports = { mapCreativesRows, mapGoogleDailyRows, mapMetaDailyRows };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/transform/windsor-to-sheet-rows.test.js`
Expected: PASS (6/6)

- [ ] **Step 5: Commit**

```bash
git add lib/transform/windsor-to-sheet-rows.js test/transform/windsor-to-sheet-rows.test.js
git commit -m "feat: add Windsor row to Sheet row mapping"
```

---

## Task 5: Sync orchestrator and Vercel Cron handler

**Files:**
- Create: `api/sync-windsor.js`
- Test: `test/sync-windsor.test.js`

**Interfaces:**
- Consumes: `fetchWindsorData` (Task 1), `getAccessToken` (Task 2), `overwriteSheetRange` (Task 3), `mapCreativesRows`/`mapGoogleDailyRows`/`mapMetaDailyRows` (Task 4).
- Produces:
  - `dateRange(days, referenceDate = new Date()): { dateFrom: string, dateTo: string }` — both `YYYY-MM-DD`, inclusive `days`-day window ending at `referenceDate`.
  - `async syncWindsor(env): Promise<{ Creatives: {ok, rows?, error?}, GoogleDaily: {...}, MetaDaily: {...} }>` — the pure orchestration function (env passed explicitly, not read from `process.env`, matching `buildDashboardHtml`'s pattern in `api/dashboard.js`). Each tab's fetch+map+write is independent; one tab's failure doesn't stop the others.
  - `module.exports.default = async function handler(req, res)` — the Vercel entry point: checks `Authorization: Bearer ${process.env.CRON_SECRET}`, calls `syncWindsor(process.env)`, and responds with a JSON summary (200 if every tab succeeded, 207 if any failed, 401 if the auth header didn't match).

- [ ] **Step 1: Write the failing tests**

```js
// test/sync-windsor.test.js
const { test, mock } = require('node:test');
const assert = require('node:assert');
const { syncWindsor, dateRange } = require('../api/sync-windsor');

const ENV = {
  WINDSOR_API_KEY: 'wkey',
  GOOGLE_SHEET_ID: 'SHEET_ID',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'sheet-writer@example.iam.gserviceaccount.com',
  GOOGLE_SERVICE_ACCOUNT_KEY: 'not-a-real-key',
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/sync-windsor.test.js`
Expected: FAIL with "Cannot find module '../api/sync-windsor'"

- [ ] **Step 3: Write the implementation**

```js
// api/sync-windsor.js
const { fetchWindsorData } = require('../lib/windsor');
const { getAccessToken } = require('../lib/google-sheets-auth');
const { overwriteSheetRange } = require('../lib/google-sheets-writer');
const { mapCreativesRows, mapGoogleDailyRows, mapMetaDailyRows } = require('../lib/transform/windsor-to-sheet-rows');

const FACEBOOK_ACCOUNT_ID = '732629205086';
const GOOGLE_ADS_ACCOUNT_ID = '779-598-7920';
const WINDOW_DAYS = 90;

function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

function dateRange(days, referenceDate = new Date()) {
  const end = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { dateFrom: toIsoDate(start), dateTo: toIsoDate(end) };
}

async function syncWindsor(env) {
  const { dateFrom, dateTo } = dateRange(WINDOW_DAYS);
  const accessToken = await getAccessToken({
    clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n'),
  });

  const jobs = [
    {
      tab: 'Creatives',
      fetch: () => fetchWindsorData({
        apiKey: env.WINDSOR_API_KEY, connector: 'facebook', accountId: FACEBOOK_ACCOUNT_ID, dateFrom, dateTo,
        fields: ['date_start', 'date_stop', 'ad_name', 'spend', 'impressions', 'actions_omni_purchase', 'adset_name', 'purchase_roas_omni_purchase', 'link_clicks', 'campaign', 'action_values_omni_purchase'],
      }),
      map: mapCreativesRows,
    },
    {
      tab: 'GoogleDaily',
      fetch: () => fetchWindsorData({
        apiKey: env.WINDSOR_API_KEY, connector: 'google_ads', accountId: GOOGLE_ADS_ACCOUNT_ID, dateFrom, dateTo,
        fields: ['campaign', 'date', 'currency', 'cost', 'impressions', 'clicks', 'conversions', 'conversion_value'],
      }),
      map: mapGoogleDailyRows,
    },
    {
      tab: 'MetaDaily',
      fetch: () => fetchWindsorData({
        apiKey: env.WINDSOR_API_KEY, connector: 'facebook', accountId: FACEBOOK_ACCOUNT_ID, dateFrom, dateTo,
        fields: ['campaign', 'date', 'impressions', 'spend', 'link_clicks', 'actions_omni_purchase', 'action_values_omni_purchase', 'purchase_roas_omni_purchase'],
      }),
      map: mapMetaDailyRows,
    },
  ];

  const results = {};
  for (const job of jobs) {
    try {
      const windsorRows = await job.fetch();
      const sheetRows = job.map(windsorRows);
      await overwriteSheetRange({ accessToken, sheetId: env.GOOGLE_SHEET_ID, tabName: job.tab, rows: sheetRows });
      results[job.tab] = { ok: true, rows: sheetRows.length };
    } catch (err) {
      console.error(`[sync-windsor] ${job.tab} failed:`, err);
      results[job.tab] = { ok: false, error: err.message };
    }
  }
  return results;
}

module.exports = { syncWindsor, dateRange };

module.exports.default = async function handler(req, res) {
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!req.headers.authorization || req.headers.authorization !== expected) {
    res.status(401).send('Unauthorized');
    return;
  }
  try {
    const results = await syncWindsor(process.env);
    const allOk = Object.values(results).every((r) => r.ok);
    res.status(allOk ? 200 : 207).json(results);
  } catch (err) {
    console.error('[sync-windsor] fatal error:', err);
    res.status(500).json({ error: err.message });
  }
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/sync-windsor.test.js`
Expected: PASS (4/4)

- [ ] **Step 5: Run the full test suite to confirm nothing else broke**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add api/sync-windsor.js test/sync-windsor.test.js
git commit -m "feat: add Windsor sync orchestrator and Cron handler"
```

---

## Task 6: Wire up Cron schedule and document required env vars

**Files:**
- Modify: `vercel.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `api/sync-windsor.js`'s default export (Task 5) as the Cron target.
- Produces: nothing consumed by other tasks — this is the final wiring step.

- [ ] **Step 1: Add the Cron schedule to `vercel.json`**

```json
{
  "rewrites": [
    { "source": "/", "destination": "/api/dashboard" }
  ],
  "crons": [
    { "path": "/api/sync-windsor", "schedule": "0 6 * * *" }
  ]
}
```

- [ ] **Step 2: Document the new env vars in `.env.example`**

Append to `.env.example`:

```
# Windsor.ai (Meta/Google ad data) - https://windsor.ai/api-documentation/
WINDSOR_API_KEY=

# Google Sheets write access (service account), for the daily Windsor.ai -> Sheet sync job
GOOGLE_SHEET_ID=1N3Z9AuDSQpByVa6JuEOsXZKJ-8zH3VvO8u7hR6qPGp0
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_KEY=

# Shared secret Vercel Cron sends as a Bearer token - protects /api/sync-windsor from public triggering
CRON_SECRET=
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: All tests PASS (unchanged by this task — it touches no code, only config/docs)

- [ ] **Step 4: Commit**

```bash
git add vercel.json .env.example
git commit -m "chore: wire up Windsor sync Cron schedule and document its env vars"
```

- [ ] **Step 5: Manual verification checklist (not code — do this after deploying)**

1. Generate a random string for `CRON_SECRET` (e.g. `openssl rand -hex 32`).
2. Add `WINDSOR_API_KEY`, `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY`, `CRON_SECRET` to Vercel (Production + Preview), same as the Shopify vars.
3. Deploy (`vercel --prod`).
4. Manually trigger once: `curl -H "Authorization: Bearer <CRON_SECRET>" https://truestart-cafe.vercel.app/api/sync-windsor` and confirm the JSON response shows `ok: true` for all three tabs.
5. Open the `TrueStart_Dashboard_Data` Sheet and confirm `Creatives`, `GoogleDaily`, `MetaDaily` now contain fresh Windsor-sourced rows (90-day window, header row intact).
6. Reload the live dashboard and confirm the Google/Meta tabs still render correctly (unchanged, since they still just read the same CSV export URLs).
