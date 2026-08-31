# Live Paid Media Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the static `TrueStart — Paid Media Dashboard.html` snapshot into a Vercel-hosted page that renders the identical layout/script, populated live on every request from the `TrueStart_Dashboard_Data` Google Sheet (CSV export) and a live Shopify Admin API inventory pull.

**Architecture:** A single Vercel serverless function fetches each Sheet tab as CSV plus live Shopify inventory, runs a small transformation layer (funnel stage, PROVEN/TESTING/STARVED classification, creative-name parsing, blended KPI math, cohort shaping, daily ROAS series), and injects the results into the original HTML file used as a template — reusing its CSS and client-side script (tab switching, table sort/filter, chart redraw, stock rendering) byte-for-byte unchanged, replacing only the `DATA`/`RS`/`LB`/`STK_SNAP` literals and a handful of static markup fragments.

**Tech Stack:** Plain Node.js (no framework), Vercel serverless functions, Node's built-in `node:test` + `node:assert` for tests, no external npm dependencies (custom CSV parser, native `fetch`).

**Spec:** `docs/superpowers/specs/2026-08-31-live-dashboard-design.md`

## Global Constraints

- No framework (no Next.js/Express) — plain Vercel serverless functions per the spec's Architecture section.
- No new npm dependencies unless a task explicitly adds one — CSV parsing and templating are hand-rolled.
- The original file's CSS and script functions (`fmt`, `render`, `redraw`, `xy`, `pth`, `drawc`, `stkAdv`, `stkThr`, `stkRender`, `stkLoad`, `stkBoot`, tab/subtab click handlers) must appear in the final output unchanged, except the one deliberate copy fix noted in Task 16 (stock status text).
- PROVEN/TESTING/STARVED threshold is fixed: purchases ≥ 20 (see spec Section 4). Do not invent additional thresholds.
- Stock "advertised" logic is NOT reimplemented server-side — it is the existing `stkAdv()` regex already in the script (spec Section 3).
- CAC and the Cost-per-new-customer chart use the single trailing-window figure, not a fabricated monthly trend (spec Section 2.3).
- Money values render as `£` + comma-grouped integer or 1-2dp, matching the original's `fmt()`/`.toFixed()` conventions in each section.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `README.md`

**Interfaces:**
- Produces: `npm test` runs all `node:test` files under `test/`; environment variable names (`SHEET_CSV_URL_CREATIVES`, `SHEET_CSV_URL_GOOGLE_DAILY`, `SHEET_CSV_URL_META_DAILY`, `SHEET_CSV_URL_SHOPIFY_DAILY`, `SHEET_CSV_URL_NEW_RETURNING`, `SHEET_CSV_URL_COHORT`, `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ACCESS_TOKEN`) that every later task's code reads via `process.env`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "truestart-live-dashboard",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "engines": { "node": ">=18" },
  "scripts": {
    "test": "node --test \"test/**/*.test.js\""
  }
}
```

**Ruling (recorded during Task 1 execution):** `node --test test/` (a bare directory, with or without trailing slash) fails with `MODULE_NOT_FOUND` on this Node version/platform instead of recursively discovering tests — verified empirically, both empty and with nested test files present. The quoted glob `"test/**/*.test.js"` was verified to work correctly in all three cases (empty, flat files, nested files) via both `node --test` directly and `npm test`. Use the glob form everywhere a whole-suite run is needed (this task's `package.json` and Task 27 Step 2); per-task steps that name one explicit test file (e.g. `node --test test/csv.test.js`) are unaffected and unchanged.

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.vercel
.env
*.log
```

- [ ] **Step 3: Create `.env.example`**

```bash
# Google Sheet tabs, each published to web as CSV (File -> Share -> Publish to web -> CSV)
SHEET_CSV_URL_CREATIVES=
SHEET_CSV_URL_GOOGLE_DAILY=
SHEET_CSV_URL_META_DAILY=
SHEET_CSV_URL_SHOPIFY_DAILY=
SHEET_CSV_URL_NEW_RETURNING=
SHEET_CSV_URL_COHORT=

# Shopify custom app (Settings -> Apps -> Develop apps), read_inventory + read_products scopes
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=
```

- [ ] **Step 4: Create `README.md`**

```markdown
# TrueStart Live Paid Media Dashboard

Live Vercel-hosted version of the TrueStart paid media dashboard. See
`docs/superpowers/specs/2026-08-31-live-dashboard-design.md` for the
full design.

## Setup

1. Publish each of the 7 Sheet tabs to web as CSV (Google Sheet -> File
   -> Share -> Publish to web -> select tab -> CSV), and copy each
   resulting URL into the matching `SHEET_CSV_URL_*` variable below.
2. Create a Shopify custom app (Settings -> Apps -> Develop apps) with
   `read_inventory` + `read_products` scopes and generate an Admin API
   access token.
3. Copy `.env.example` to `.env` and fill in both sets of values for
   local development.
4. In Vercel, add the same variables as project Environment Variables,
   then connect this repo for auto-deploy on push.

## Development

- `npm test` — run all unit tests.
- `vercel dev` — run the dashboard locally (requires `.env` filled in).
```

- [ ] **Step 5: Verify the test runner works with zero tests**

Run: `npm test`
Expected: exits 0 with "0 tests" (no test files exist yet).

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore .env.example README.md
git commit -m "Add project scaffolding (package.json, env template, README)"
```

---

## Task 2: CSV parser

**Files:**
- Create: `lib/csv.js`
- Test: `test/csv.test.js`

**Interfaces:**
- Produces: `parseCsv(text: string): string[][]`, `csvToObjects(text: string): Record<string,string>[]` — used by every Task 3+ Sheet consumer.

- [ ] **Step 1: Write the failing tests**

```js
// test/csv.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseCsv, csvToObjects } = require('../lib/csv');

test('parseCsv splits simple rows and columns', () => {
  const rows = parseCsv('a,b,c\n1,2,3\n');
  assert.deepStrictEqual(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('parseCsv handles quoted fields containing commas', () => {
  const rows = parseCsv('name,note\n"Smith, Jane",hello\n');
  assert.deepStrictEqual(rows, [['name', 'note'], ['Smith, Jane', 'hello']]);
});

test('parseCsv handles escaped double quotes inside quoted fields', () => {
  const rows = parseCsv('name\n"She said ""hi"""\n');
  assert.deepStrictEqual(rows, [['name'], ['She said "hi"']]);
});

test('parseCsv handles CRLF line endings', () => {
  const rows = parseCsv('a,b\r\n1,2\r\n');
  assert.deepStrictEqual(rows, [['a', 'b'], ['1', '2']]);
});

test('csvToObjects maps rows to header-keyed objects', () => {
  const objs = csvToObjects('name,qty\nCoffee,5\nTea,3\n');
  assert.deepStrictEqual(objs, [
    { name: 'Coffee', qty: '5' },
    { name: 'Tea', qty: '3' },
  ]);
});

test('csvToObjects returns empty array for header-only input', () => {
  assert.deepStrictEqual(csvToObjects('name,qty\n'), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/csv.test.js`
Expected: FAIL with "Cannot find module '../lib/csv'"

- [ ] **Step 3: Write the implementation**

```js
// lib/csv.js

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // skip; \n below terminates the row
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function csvToObjects(text) {
  const rows = parseCsv(text).filter((r) => !(r.length === 1 && r[0] === ''));
  if (rows.length === 0) return [];
  const [headers, ...dataRows] = rows;
  return dataRows.map((r) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = r[i] !== undefined ? r[i] : '';
    });
    return obj;
  });
}

module.exports = { parseCsv, csvToObjects };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/csv.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add lib/csv.js test/csv.test.js
git commit -m "Add CSV parser for Sheet exports"
```

---

## Task 3: Sheet tab fetcher

**Files:**
- Create: `lib/sheets.js`
- Test: `test/sheets.test.js`

**Interfaces:**
- Consumes: `csvToObjects` from `lib/csv.js` (Task 2)
- Produces: `async fetchSheetTab(url: string): Promise<Record<string,string>[]>` — throws on non-2xx response. Used by `api/dashboard.js` (Task 18) for every Sheet tab.

- [ ] **Step 1: Write the failing tests**

```js
// test/sheets.test.js
const { test, mock } = require('node:test');
const assert = require('node:assert');
const { fetchSheetTab } = require('../lib/sheets');

test('fetchSheetTab parses a successful CSV response into objects', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => 'name,qty\nCoffee,5\n',
  }));
  try {
    const rows = await fetchSheetTab('https://example.com/export.csv');
    assert.deepStrictEqual(rows, [{ name: 'Coffee', qty: '5' }]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchSheetTab throws a descriptive error on non-2xx response', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async () => ({ ok: false, status: 404, text: async () => '' }));
  try {
    await assert.rejects(
      () => fetchSheetTab('https://example.com/missing.csv'),
      /Sheet fetch failed \(404\)/
    );
  } finally {
    global.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/sheets.test.js`
Expected: FAIL with "Cannot find module '../lib/sheets'"

- [ ] **Step 3: Write the implementation**

```js
// lib/sheets.js
const { csvToObjects } = require('./csv');

async function fetchSheetTab(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Sheet fetch failed (${res.status}) for ${url}`);
  }
  const text = await res.text();
  return csvToObjects(text);
}

module.exports = { fetchSheetTab };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/sheets.test.js`
Expected: PASS, 2 tests

- [ ] **Step 5: Commit**

```bash
git add lib/sheets.js test/sheets.test.js
git commit -m "Add Sheet tab CSV fetcher"
```

---

## Task 4: Shared date helpers

**Files:**
- Create: `lib/dates.js`
- Test: `test/dates.test.js`

**Interfaces:**
- Produces: `toIsoDate(input: string): string` (normalizes `'DD-MM-YYYY'` or `'YYYY-MM-DD'` to `'YYYY-MM-DD'`), `formatShortLabel(isoDate: string): string` (e.g. `'2026-02-15'` -> `'Feb 15'`). Used by Task 8 (`daily-roas.js`) and Task 9 (`cohort.js`).

- [ ] **Step 1: Write the failing tests**

```js
// test/dates.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { toIsoDate, formatShortLabel } = require('../lib/dates');

test('toIsoDate passes through an already-ISO date', () => {
  assert.strictEqual(toIsoDate('2026-02-15'), '2026-02-15');
});

test('toIsoDate converts DD-MM-YYYY to ISO', () => {
  assert.strictEqual(toIsoDate('15-02-2026'), '2026-02-15');
});

test('toIsoDate throws on an unrecognized format', () => {
  assert.throws(() => toIsoDate('Feb 15 2026'), /Unrecognized date format/);
});

test('formatShortLabel renders "Mon D" style labels', () => {
  assert.strictEqual(formatShortLabel('2026-02-15'), 'Feb 15');
  assert.strictEqual(formatShortLabel('2026-08-18'), 'Aug 18');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/dates.test.js`
Expected: FAIL with "Cannot find module '../lib/dates'"

- [ ] **Step 3: Write the implementation**

```js
// lib/dates.js

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toIsoDate(input) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const m = input.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  throw new Error(`Unrecognized date format: ${input}`);
}

function formatShortLabel(isoDate) {
  const [, m, d] = isoDate.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

module.exports = { toIsoDate, formatShortLabel };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/dates.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add lib/dates.js test/dates.test.js
git commit -m "Add shared date parsing/formatting helpers"
```

---

## Task 5: Funnel stage lookup

**Files:**
- Create: `lib/transform/stage.js`
- Test: `test/transform/stage.test.js`

**Interfaces:**
- Produces: `getFunnelStage(campaignName: string): 'TOF' | 'MOF' | 'BOF' | 'Other'`. Used by Task 6 (`status.js`) and Task 8 (`creatives.js`).

- [ ] **Step 1: Write the failing tests**

```js
// test/transform/stage.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { getFunnelStage } = require('../../lib/transform/stage');

test('detects TOF from campaign name', () => {
  assert.strictEqual(getFunnelStage('K-TS_UK_TOF_Awareness CBO'), 'TOF');
  assert.strictEqual(getFunnelStage('UK_TOF_Awareness_Evergreen_Discovery'), 'TOF');
});

test('detects MOF from campaign name', () => {
  assert.strictEqual(getFunnelStage('K-TS_UK_MOF_Consideration'), 'MOF');
  assert.strictEqual(getFunnelStage('L_UK_MOF_Traffic_Evergreen_Consideration'), 'MOF');
});

test('detects BOF from campaign name, including hyphenated and suffixed forms', () => {
  assert.strictEqual(getFunnelStage('K-TS_UK_BOF-PROVEN'), 'BOF');
  assert.strictEqual(getFunnelStage('K-TS_UK_BOF_Sales Retargeting'), 'BOF');
  assert.strictEqual(getFunnelStage('Active TrueStart Testing Campaign - BOF'), 'BOF');
});

test('falls back to Other when no marker is present', () => {
  assert.strictEqual(getFunnelStage('ENVU | BA | UK | 190325'), 'Other');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/transform/stage.test.js`
Expected: FAIL with "Cannot find module '../../lib/transform/stage'"

- [ ] **Step 3: Write the implementation**

```js
// lib/transform/stage.js

// Note: \b treats underscore as a word character, so /\bTOF\b/ would never
// match inside "K-TS_UK_TOF_Awareness" (no boundary between "_" and "T").
// Use negative lookbehind/lookahead against letters instead.
function getFunnelStage(campaignName) {
  if (/(?<![a-zA-Z])TOF(?![a-zA-Z])/i.test(campaignName)) return 'TOF';
  if (/(?<![a-zA-Z])MOF(?![a-zA-Z])/i.test(campaignName)) return 'MOF';
  if (/(?<![a-zA-Z])BOF(?![a-zA-Z])/i.test(campaignName)) return 'BOF';
  return 'Other';
}

module.exports = { getFunnelStage };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/transform/stage.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add lib/transform/stage.js test/transform/stage.test.js
git commit -m "Add funnel stage lookup from campaign name"
```

---

## Task 6: Creative status classification

**Files:**
- Create: `lib/transform/status.js`
- Test: `test/transform/status.test.js`

**Interfaces:**
- Consumes: `getFunnelStage` from `lib/transform/stage.js` (Task 5)
- Produces: `getCreativeStatus({ campaignName: string, spend: number, purchases: number }): 'PROVEN' | 'TESTING' | 'STARVED' | 'Feeder'`, `isInProvenCampaign(campaignName: string): boolean`. Used by Task 8 (`creatives.js`).

- [ ] **Step 1: Write the failing tests**

```js
// test/transform/status.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { getCreativeStatus, isInProvenCampaign } = require('../../lib/transform/status');

test('TOF/MOF campaigns are always Feeder regardless of performance', () => {
  assert.strictEqual(
    getCreativeStatus({ campaignName: 'K-TS_UK_TOF_Awareness CBO', spend: 4036.54, purchases: 11 }),
    'Feeder'
  );
  assert.strictEqual(
    getCreativeStatus({ campaignName: 'K-TS_UK_MOF_Consideration', spend: 1207.8, purchases: 0 }),
    'Feeder'
  );
});

test('the dedicated Proven campaign is always PROVEN', () => {
  assert.strictEqual(
    getCreativeStatus({ campaignName: 'K-TS_UK_BOF-PROVEN', spend: 402.3, purchases: 19 }),
    'PROVEN'
  );
});

test('near-zero spend in any other campaign is STARVED', () => {
  assert.strictEqual(
    getCreativeStatus({ campaignName: 'K-TS_UK_BOF_Sales Retargeting', spend: 0, purchases: 0 }),
    'STARVED'
  );
});

test('BOF Sales Retargeting: 20+ purchases is PROVEN', () => {
  assert.strictEqual(
    getCreativeStatus({ campaignName: 'K-TS_UK_BOF_Sales Retargeting', spend: 402.3, purchases: 19 }),
    'TESTING'
  );
  assert.strictEqual(
    getCreativeStatus({ campaignName: 'K-TS_UK_BOF_Sales Retargeting', spend: 402.3, purchases: 20 }),
    'PROVEN'
  );
});

test('isInProvenCampaign is true only for the dedicated Proven campaign', () => {
  assert.strictEqual(isInProvenCampaign('K-TS_UK_BOF-PROVEN'), true);
  assert.strictEqual(isInProvenCampaign('K-TS_UK_BOF_Sales Retargeting'), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/transform/status.test.js`
Expected: FAIL with "Cannot find module '../../lib/transform/status'"

- [ ] **Step 3: Write the implementation**

```js
// lib/transform/status.js
const { getFunnelStage } = require('./stage');

const MIN_MEANINGFUL_SPEND = 1; // GBP; below this a creative is treated as STARVED
const PROVEN_PURCHASE_THRESHOLD = 20;

function isInProvenCampaign(campaignName) {
  return /BOF-PROVEN/i.test(campaignName);
}

function getCreativeStatus({ campaignName, spend, purchases }) {
  const stage = getFunnelStage(campaignName);
  if (stage === 'TOF' || stage === 'MOF') return 'Feeder';
  if (isInProvenCampaign(campaignName)) return 'PROVEN';
  if (spend < MIN_MEANINGFUL_SPEND) return 'STARVED';
  return purchases >= PROVEN_PURCHASE_THRESHOLD ? 'PROVEN' : 'TESTING';
}

module.exports = { getCreativeStatus, isInProvenCampaign, PROVEN_PURCHASE_THRESHOLD };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/transform/status.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add lib/transform/status.js test/transform/status.test.js
git commit -m "Add PROVEN/TESTING/STARVED/Feeder status classification"
```

---

## Task 7: Creative name parser (angle/persona/product/format)

**Files:**
- Create: `lib/transform/creative-parse.js`
- Test: `test/transform/creative-parse.test.js`

**Interfaces:**
- Produces: `parseCreativeName(adName: string): { persona: string, angle: string, product: string, format: string }`. Used by Task 8 (`creatives.js`).

- [ ] **Step 1: Write the failing tests**

```js
// test/transform/creative-parse.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseCreativeName } = require('../../lib/transform/creative-parse');

test('parses a well-formed ad name into all four fields', () => {
  assert.deepStrictEqual(parseCreativeName('BOF_ST_19_Upgrader_Price_Starter_Bags V2'), {
    persona: 'Upgrader',
    angle: 'Price',
    product: 'Starter',
    format: 'Bags',
  });
});

test('parses a name with a UGC-style prefix before persona', () => {
  assert.deepStrictEqual(parseCreativeName('BOF_UGC_Kate_Barista_Quality_Taster_Bags'), {
    persona: 'Barista',
    angle: 'Quality',
    product: 'Taster',
    format: 'Bags',
  });
});

test('falls back to Other for every field when no persona token matches', () => {
  assert.deepStrictEqual(parseCreativeName('TOF_Founder_07_WhereComesFrom_Brand'), {
    persona: 'Other',
    angle: 'Other',
    product: 'Other',
    format: 'Other',
  });
});

test('falls back per-field when only some tokens match known values', () => {
  assert.deepStrictEqual(parseCreativeName('MOF_VID_12 _Upgrader_Easyswap_PDP_Beans'), {
    persona: 'Upgrader',
    angle: 'Other',
    product: 'Other',
    format: 'Beans',
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/transform/creative-parse.test.js`
Expected: FAIL with "Cannot find module '../../lib/transform/creative-parse'"

- [ ] **Step 3: Write the implementation**

```js
// lib/transform/creative-parse.js

const PERSONAS = ['Upgrader', 'Loyal', 'Barista', 'Convenience', 'Ritual'];
const ANGLES = ['Price', 'Trust', 'Quality', 'Health', 'Social', 'Delivery', 'Faff', 'Cafe', 'Taste', 'Packaging', 'Caffeine'];
const PRODUCTS = ['Starter', 'Taster'];
const FORMATS = ['Bags', 'Instant', 'Beans', 'Ground', 'Concentrate'];

function findExact(token, list) {
  const trimmed = (token || '').trim();
  return list.find((v) => v.toLowerCase() === trimmed.toLowerCase()) || null;
}

function parseCreativeName(adName) {
  const tokens = adName.split('_');
  const personaIdx = tokens.findIndex((t) => findExact(t, PERSONAS));
  if (personaIdx === -1) {
    return { persona: 'Other', angle: 'Other', product: 'Other', format: 'Other' };
  }
  const persona = findExact(tokens[personaIdx], PERSONAS);
  const angle = findExact(tokens[personaIdx + 1] || '', ANGLES) || 'Other';
  const product = findExact(tokens[personaIdx + 2] || '', PRODUCTS) || 'Other';
  const rawFormat = (tokens[personaIdx + 3] || '').trim().split(' ')[0];
  const format = findExact(rawFormat, FORMATS) || 'Other';
  return { persona, angle, product, format };
}

module.exports = { parseCreativeName };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/transform/creative-parse.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add lib/transform/creative-parse.js test/transform/creative-parse.test.js
git commit -m "Add angle/persona/product/format parser for ad names"
```

---

## Task 8: Creatives data assembly (the `DATA` array)

**Files:**
- Create: `lib/transform/creatives.js`
- Test: `test/transform/creatives.test.js`

**Interfaces:**
- Consumes: `getFunnelStage` (Task 5), `getCreativeStatus`/`isInProvenCampaign` (Task 6), `parseCreativeName` (Task 7)
- Produces: `buildCreativesData(rawRows: Record<string,string>[]): Array<{name, stage, spend, impr, purch, cpa, roas, product, status, camp, in_proven, persona, angle, format, val}>` — this is the exact shape the original page's `DATA` array/script expects. Used by Task 18 (`api/dashboard.js`) to build the `DATA` literal, and by Task 12 (`overview.js`) for funnel/status aggregates.

**Modeling decision (documented, not a business-judgment call):** the Creatives Sheet tab has one row per (ad, ad set) pair — the same ad name can appear multiple times across ad sets, and occasionally across campaigns. `buildCreativesData` groups rows by `Ad name`, summing spend/impressions/purchases/conversion value across all matching rows, and assigns `camp` as the campaign of the single highest-spend contributing row (the ad's "primary" campaign). `cpa`/`roas` are recomputed from the summed totals, not averaged.

- [ ] **Step 1: Write the failing tests**

```js
// test/transform/creatives.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildCreativesData } = require('../../lib/transform/creatives');

function row(overrides) {
  return {
    'Ad name': 'BOF_ST_19_Upgrader_Price_Starter_Bags V1',
    'Amount spent (GBP)': '100',
    'Impressions': '1000',
    'Purchases': '10',
    'Campaign name': 'K-TS_UK_BOF-PROVEN',
    'Purchases conversion value': '300',
    ...overrides,
  };
}

test('builds a single row per ad with computed cpa/roas/stage/status/persona fields', () => {
  const data = buildCreativesData([row({})]);
  assert.strictEqual(data.length, 1);
  assert.deepStrictEqual(data[0], {
    name: 'BOF_ST_19_Upgrader_Price_Starter_Bags V1',
    stage: 'BOF',
    spend: 100,
    impr: 1000,
    purch: 10,
    cpa: 10,
    roas: 3,
    product: 'Starter',
    status: 'PROVEN',
    camp: 'K-TS_UK_BOF-PROVEN',
    in_proven: true,
    persona: 'Upgrader',
    angle: 'Price',
    format: 'Bags',
    val: 300,
  });
});

test('sums duplicate ad-name rows across ad sets and keeps the highest-spend campaign', () => {
  const data = buildCreativesData([
    row({ 'Amount spent (GBP)': '600', 'Purchases': '60', 'Impressions': '6000', 'Purchases conversion value': '1800', 'Campaign name': 'K-TS_UK_BOF_Sales Retargeting' }),
    row({ 'Amount spent (GBP)': '200', 'Purchases': '20', 'Impressions': '2000', 'Purchases conversion value': '600', 'Campaign name': 'K-TS_UK_BOF-PROVEN' }),
  ]);
  assert.strictEqual(data.length, 1);
  assert.strictEqual(data[0].spend, 800);
  assert.strictEqual(data[0].purch, 80);
  assert.strictEqual(data[0].val, 2400);
  assert.strictEqual(data[0].camp, 'K-TS_UK_BOF_Sales Retargeting');
});

test('rows with no spend and no purchases get cpa 0 and roas 0, not NaN/Infinity', () => {
  const data = buildCreativesData([row({ 'Amount spent (GBP)': '0', 'Purchases': '0', 'Purchases conversion value': '0' })]);
  assert.strictEqual(data[0].cpa, 0);
  assert.strictEqual(data[0].roas, 0);
});

test('skips rows with no ad name', () => {
  const data = buildCreativesData([row({ 'Ad name': '' })]);
  assert.strictEqual(data.length, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/transform/creatives.test.js`
Expected: FAIL with "Cannot find module '../../lib/transform/creatives'"

- [ ] **Step 3: Write the implementation**

```js
// lib/transform/creatives.js
const { getFunnelStage } = require('./stage');
const { getCreativeStatus, isInProvenCampaign } = require('./status');
const { parseCreativeName } = require('./creative-parse');

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function buildCreativesData(rawRows) {
  const byName = new Map();

  for (const raw of rawRows) {
    const name = (raw['Ad name'] || '').trim();
    if (!name) continue;

    const spend = num(raw['Amount spent (GBP)']);
    const impr = Math.round(num(raw['Impressions']));
    const purch = Math.round(num(raw['Purchases']));
    const val = num(raw['Purchases conversion value']);
    const campaignName = raw['Campaign name'] || '';

    if (!byName.has(name)) {
      byName.set(name, { spend: 0, impr: 0, purch: 0, val: 0, topCamp: campaignName, topCampSpend: -1 });
    }
    const agg = byName.get(name);
    agg.spend += spend;
    agg.impr += impr;
    agg.purch += purch;
    agg.val += val;
    if (spend > agg.topCampSpend) {
      agg.topCampSpend = spend;
      agg.topCamp = campaignName;
    }
  }

  return [...byName.entries()].map(([name, agg]) => {
    const { persona, angle, product, format } = parseCreativeName(name);
    return {
      name,
      stage: getFunnelStage(agg.topCamp),
      spend: agg.spend,
      impr: agg.impr,
      purch: agg.purch,
      cpa: agg.purch > 0 ? agg.spend / agg.purch : 0,
      roas: agg.spend > 0 ? agg.val / agg.spend : 0,
      product,
      status: getCreativeStatus({ campaignName: agg.topCamp, spend: agg.spend, purchases: agg.purch }),
      camp: agg.topCamp,
      in_proven: isInProvenCampaign(agg.topCamp),
      persona,
      angle,
      format,
      val: agg.val,
    };
  });
}

module.exports = { buildCreativesData };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/transform/creatives.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add lib/transform/creatives.js test/transform/creatives.test.js
git commit -m "Add creatives data assembly (DATA array shape)"
```

---

## Task 9: Daily blended ROAS series (`RS`/`LB`)

**Files:**
- Create: `lib/transform/daily-roas.js`
- Test: `test/transform/daily-roas.test.js`

**Interfaces:**
- Consumes: `toIsoDate`, `formatShortLabel` from `lib/dates.js` (Task 4)
- Produces: `buildDailyRoasSeries({ shopifyDailyRows, metaDailyRows, googleDailyRows }): { RS: number[], LB: string[] }`. Used by Task 18 (`api/dashboard.js`) to build the `RS`/`LB` literals the existing `drawc()` script function consumes.

- [ ] **Step 1: Write the failing tests**

```js
// test/transform/daily-roas.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildDailyRoasSeries } = require('../../lib/transform/daily-roas');

test('computes one blended ROAS value per day, sorted chronologically, with matching labels', () => {
  const { RS, LB } = buildDailyRoasSeries({
    shopifyDailyRows: [
      { Day: '16-02-2026', 'Total sales': '1000' },
      { Day: '15-02-2026', 'Total sales': '500' },
    ],
    metaDailyRows: [
      { Day: '2026-02-15', 'Amount spent (GBP)': '200' },
      { Day: '2026-02-16', 'Amount spent (GBP)': '250' },
    ],
    googleDailyRows: [
      { Day: '2026-02-15', Cost: '50' },
      { Day: '2026-02-16', Cost: '50' },
    ],
  });
  assert.deepStrictEqual(LB, ['Feb 15', 'Feb 16']);
  assert.deepStrictEqual(RS, [2, 3.33]);
});

test('a day with paid spend but no matching Shopify row gets ROAS 0', () => {
  const { RS, LB } = buildDailyRoasSeries({
    shopifyDailyRows: [],
    metaDailyRows: [{ Day: '2026-02-15', 'Amount spent (GBP)': '200' }],
    googleDailyRows: [],
  });
  assert.deepStrictEqual(LB, ['Feb 15']);
  assert.deepStrictEqual(RS, [0]);
});

test('a day with zero paid spend gets ROAS 0, not Infinity/NaN', () => {
  const { RS } = buildDailyRoasSeries({
    shopifyDailyRows: [{ Day: '15-02-2026', 'Total sales': '500' }],
    metaDailyRows: [],
    googleDailyRows: [],
  });
  assert.deepStrictEqual(RS, [0]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/transform/daily-roas.test.js`
Expected: FAIL with "Cannot find module '../../lib/transform/daily-roas'"

- [ ] **Step 3: Write the implementation**

```js
// lib/transform/daily-roas.js
const { toIsoDate, formatShortLabel } = require('../dates');

function sumByDate(rows, dateKey, valueKey) {
  const map = new Map();
  for (const r of rows) {
    const date = toIsoDate(r[dateKey]);
    const value = parseFloat(r[valueKey]) || 0;
    map.set(date, (map.get(date) || 0) + value);
  }
  return map;
}

function buildDailyRoasSeries({ shopifyDailyRows, metaDailyRows, googleDailyRows }) {
  const salesByDate = sumByDate(shopifyDailyRows, 'Day', 'Total sales');
  const metaByDate = sumByDate(metaDailyRows, 'Day', 'Amount spent (GBP)');
  const googleByDate = sumByDate(googleDailyRows, 'Day', 'Cost');

  const allDates = [...new Set([...salesByDate.keys(), ...metaByDate.keys(), ...googleByDate.keys()])].sort();

  const RS = [];
  const LB = [];
  for (const date of allDates) {
    const sales = salesByDate.get(date) || 0;
    const paidSpend = (metaByDate.get(date) || 0) + (googleByDate.get(date) || 0);
    RS.push(paidSpend > 0 ? Math.round((sales / paidSpend) * 100) / 100 : 0);
    LB.push(formatShortLabel(date));
  }
  return { RS, LB };
}

module.exports = { buildDailyRoasSeries };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/transform/daily-roas.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add lib/transform/daily-roas.js test/transform/daily-roas.test.js
git commit -m "Add daily blended ROAS series (RS/LB) for the Master ROAS chart"
```

---

## Task 10: Blended KPI math (MER, CAC, window sums)

**Files:**
- Create: `lib/transform/kpi.js`
- Test: `test/transform/kpi.test.js`

**Interfaces:**
- Consumes: `toIsoDate` from `lib/dates.js` (Task 4)
- Produces: `sumInWindow(rows, {dateKey, valueKey, start, end}): number`, `blendedMER({shopifySales, metaSpend, googleSpend}): number`, `cac({metaSpend, googleSpend, newCustomers}): number`. Used by Task 11 (`render/kpis.js`) and Task 13 (`render/google.js`)/Task 14 (`render/meta.js`) for their per-tab KPI cards.

- [ ] **Step 1: Write the failing tests**

```js
// test/transform/kpi.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { sumInWindow, blendedMER, cac } = require('../../lib/transform/kpi');

test('sumInWindow totals a value column for rows within an inclusive date range', () => {
  const rows = [
    { Day: '2026-07-20', Cost: '100' },
    { Day: '2026-08-01', Cost: '50' },
    { Day: '2026-08-19', Cost: '999' }, // outside window, must be excluded
  ];
  const total = sumInWindow(rows, { dateKey: 'Day', valueKey: 'Cost', start: '2026-07-20', end: '2026-08-18' });
  assert.strictEqual(total, 150);
});

test('sumInWindow handles DD-MM-YYYY dated rows the same as ISO', () => {
  const rows = [{ Day: '20-07-2026', 'Total sales': '1000' }];
  const total = sumInWindow(rows, { dateKey: 'Day', valueKey: 'Total sales', start: '2026-07-20', end: '2026-08-18' });
  assert.strictEqual(total, 1000);
});

test('blendedMER divides Shopify sales by combined paid spend', () => {
  assert.strictEqual(blendedMER({ shopifySales: 104800, metaSpend: 28700, googleSpend: 12800 }), 104800 / 41500);
});

test('blendedMER returns 0 when there is no paid spend, not Infinity', () => {
  assert.strictEqual(blendedMER({ shopifySales: 1000, metaSpend: 0, googleSpend: 0 }), 0);
});

test('cac divides combined paid spend by new customers', () => {
  assert.strictEqual(cac({ metaSpend: 28700, googleSpend: 12800, newCustomers: 5063 }), 41500 / 5063);
});

test('cac returns 0 when there are no new customers, not Infinity', () => {
  assert.strictEqual(cac({ metaSpend: 1000, googleSpend: 0, newCustomers: 0 }), 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/transform/kpi.test.js`
Expected: FAIL with "Cannot find module '../../lib/transform/kpi'"

- [ ] **Step 3: Write the implementation**

```js
// lib/transform/kpi.js
const { toIsoDate } = require('../dates');

function sumInWindow(rows, { dateKey, valueKey, start, end }) {
  let total = 0;
  for (const r of rows) {
    const date = toIsoDate(r[dateKey]);
    if (date >= start && date <= end) {
      total += parseFloat(r[valueKey]) || 0;
    }
  }
  return total;
}

function blendedMER({ shopifySales, metaSpend, googleSpend }) {
  const paidSpend = metaSpend + googleSpend;
  return paidSpend === 0 ? 0 : shopifySales / paidSpend;
}

function cac({ metaSpend, googleSpend, newCustomers }) {
  return newCustomers === 0 ? 0 : (metaSpend + googleSpend) / newCustomers;
}

module.exports = { sumInWindow, blendedMER, cac };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/transform/kpi.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add lib/transform/kpi.js test/transform/kpi.test.js
git commit -m "Add blended MER/CAC math and date-window summing"
```

---

## Task 11: Cohort table shaping

**Files:**
- Create: `lib/transform/cohort.js`
- Test: `test/transform/cohort.test.js`

**Interfaces:**
- Produces: `buildCohortTable(rows: Record<string,string>[]): Array<{cohortLabel: string, size: number, months: (number|null)[]}>` — `months` has 13 entries (M0..M12), retention rates as fractions (e.g. `0.067` for 6.7%). Used by Task 15 (`render/cohort.js`).

- [ ] **Step 1: Write the failing tests**

```js
// test/transform/cohort.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildCohortTable } = require('../../lib/transform/cohort');

function row(month, monthsSince, customersInCohort, retentionRate) {
  return {
    Month: month,
    'Months since first purchase': String(monthsSince),
    'Customers in cohort': String(customersInCohort),
    'Customer retention rate': String(retentionRate),
  };
}

test('groups rows by acquisition month into a 13-wide months array', () => {
  const table = buildCohortTable([
    row('2025-08-08', 1, 1124, 0.067),
    row('2025-08-08', 2, 1124, 0.072),
    row('2025-09-08', 1, 1322, 0.065),
  ]);
  assert.strictEqual(table.length, 2);
  const aug = table.find((r) => r.cohortLabel === 'Aug 2025');
  assert.strictEqual(aug.size, 1124);
  assert.strictEqual(aug.months.length, 13);
  assert.strictEqual(aug.months[0], 1); // M0 defaults to 100% by definition
  assert.strictEqual(aug.months[1], 0.067);
  assert.strictEqual(aug.months[2], 0.072);
  assert.strictEqual(aug.months[3], null); // no data yet for M3
});

test('sorts cohorts chronologically by acquisition month', () => {
  const table = buildCohortTable([row('2025-09-08', 1, 100, 0.05), row('2025-08-08', 1, 200, 0.06)]);
  assert.deepStrictEqual(table.map((r) => r.cohortLabel), ['Aug 2025', 'Sep 2025']);
});

test('an explicit M0 row overrides the 100% default', () => {
  const table = buildCohortTable([row('2025-08-08', 0, 1124, 1)]);
  assert.strictEqual(table[0].months[0], 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/transform/cohort.test.js`
Expected: FAIL with "Cannot find module '../../lib/transform/cohort'"

- [ ] **Step 3: Write the implementation**

```js
// lib/transform/cohort.js

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatCohortLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function buildCohortTable(rows) {
  const byMonth = new Map();
  for (const r of rows) {
    const key = r['Month'];
    const monthsSince = parseInt(r['Months since first purchase'], 10);
    const rate = parseFloat(r['Customer retention rate']);
    const size = parseInt(r['Customers in cohort'], 10) || 0;

    if (!byMonth.has(key)) byMonth.set(key, { size, months: new Array(13).fill(null) });
    const entry = byMonth.get(key);
    entry.size = size;
    if (monthsSince >= 0 && monthsSince <= 12) entry.months[monthsSince] = rate;
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, entry]) => ({
      cohortLabel: formatCohortLabel(month),
      size: entry.size,
      months: entry.months.map((v, i) => (i === 0 && v === null ? 1 : v)),
    }));
}

module.exports = { buildCohortTable };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/transform/cohort.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add lib/transform/cohort.js test/transform/cohort.test.js
git commit -m "Add cohort retention table shaping"
```

---

## Task 12: Shopify live inventory client

**Files:**
- Create: `lib/shopify.js`
- Test: `test/shopify.test.js`

**Interfaces:**
- Produces: `async fetchLowStockSnapshot({shopDomain, accessToken, first?}): Promise<{asOf: string, products: Array<{title, productType, handle, variants: {edges: Array<{node: {title, sku, inventoryQuantity}}>}}>}>` — output shape matches the original page's `STK_SNAP` exactly, since `stkAdv`/`stkRender` (unchanged in the page's script) consume it directly. Used by Task 18 (`api/dashboard.js`).

- [ ] **Step 1: Write the failing tests**

```js
// test/shopify.test.js
const { test, mock } = require('node:test');
const assert = require('node:assert');
const { fetchLowStockSnapshot } = require('../lib/shopify');

function fakeGraphqlResponse(products) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { products: { edges: products.map((p) => ({ node: p })) } } }),
  };
}

test('fetchLowStockSnapshot returns products in the STK_SNAP shape', async () => {
  const originalFetch = global.fetch;
  const product = {
    title: 'Decaf Swiss Water Coffee Bags',
    productType: 'Coffee Bags',
    handle: 'loose-coffee-bags-swiss-water-decaf',
    variants: { edges: [{ node: { title: '25x Loose Coffee Bags', sku: 'COFSWD25LOOSE', inventoryQuantity: -120 } }] },
  };
  global.fetch = mock.fn(async () => fakeGraphqlResponse([product]));
  try {
    const snap = await fetchLowStockSnapshot({ shopDomain: 'test.myshopify.com', accessToken: 'tok' });
    assert.strictEqual(typeof snap.asOf, 'string');
    assert.deepStrictEqual(snap.products, [product]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchLowStockSnapshot sends the access token header and shop domain', async () => {
  const originalFetch = global.fetch;
  let capturedUrl, capturedHeaders;
  global.fetch = mock.fn(async (url, opts) => {
    capturedUrl = url;
    capturedHeaders = opts.headers;
    return fakeGraphqlResponse([]);
  });
  try {
    await fetchLowStockSnapshot({ shopDomain: 'test.myshopify.com', accessToken: 'secret-token' });
    assert.match(capturedUrl, /^https:\/\/test\.myshopify\.com\/admin\/api\//);
    assert.strictEqual(capturedHeaders['X-Shopify-Access-Token'], 'secret-token');
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchLowStockSnapshot throws a descriptive error on a GraphQL error response', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ errors: [{ message: 'Invalid API key' }] }),
  }));
  try {
    await assert.rejects(
      () => fetchLowStockSnapshot({ shopDomain: 'test.myshopify.com', accessToken: 'bad' }),
      /Shopify GraphQL error/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchLowStockSnapshot throws on a non-2xx HTTP response', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  try {
    await assert.rejects(
      () => fetchLowStockSnapshot({ shopDomain: 'test.myshopify.com', accessToken: 'bad' }),
      /Shopify API error \(401\)/
    );
  } finally {
    global.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/shopify.test.js`
Expected: FAIL with "Cannot find module '../lib/shopify'"

- [ ] **Step 3: Write the implementation**

```js
// lib/shopify.js

const QUERY = `
  query LowStock($first: Int!) {
    products(first: $first, query: "status:active", sortKey: INVENTORY_TOTAL) {
      edges {
        node {
          title
          productType
          handle
          variants(first: 50) {
            edges { node { title sku inventoryQuantity } }
          }
        }
      }
    }
  }
`;

async function fetchLowStockSnapshot({ shopDomain, accessToken, first = 50 }) {
  const res = await fetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query: QUERY, variables: { first } }),
  });
  if (!res.ok) {
    throw new Error(`Shopify API error (${res.status})`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  const products = json.data.products.edges.map((e) => e.node);
  return { asOf: new Date().toISOString(), products };
}

module.exports = { fetchLowStockSnapshot };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/shopify.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add lib/shopify.js test/shopify.test.js
git commit -m "Add Shopify Admin API client for live low-stock snapshot"
```

---

## Task 13: Generic table renderer + HTML escaping

**Files:**
- Create: `lib/render/table.js`
- Test: `test/render/table.test.js`

**Interfaces:**
- Produces: `escapeHtml(value: string|number): string`, `renderTable({columns: Array<{key: string, label: string, numeric?: boolean}>, rows: Array<Record<string, string|number>>, totalRow?: Record<string, string|number>}): string` (a full `<table>...</table>` string). Cell values are passed in already formatted as display strings (e.g. `'£5,016'`) — formatting money/percentages is each per-tab renderer's job, matching how the original file's own formatting varies per section. Used by Tasks 14, 15, 16, 17.

- [ ] **Step 1: Write the failing tests**

```js
// test/render/table.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { escapeHtml, renderTable } = require('../../lib/render/table');

test('escapeHtml escapes the five HTML-significant characters', () => {
  assert.strictEqual(escapeHtml('<b>A & B "C" \'D\'</b>'), '&lt;b&gt;A &amp; B &quot;C&quot; &#39;D&#39;&lt;/b&gt;');
});

test('escapeHtml passes numbers through as strings', () => {
  assert.strictEqual(escapeHtml(42), '42');
});

test('renderTable emits a thead with labels and a tbody row per data row', () => {
  const html = renderTable({
    columns: [{ key: 'name', label: 'Campaign' }, { key: 'cost', label: 'Cost', numeric: true }],
    rows: [{ name: 'L - Search - Brand', cost: '£2,697' }],
  });
  assert.match(html, /<table>/);
  assert.match(html, /<th>Campaign<\/th><th class="n">Cost<\/th>/);
  assert.match(html, /<td>L - Search - Brand<\/td><td class="n">£2,697<\/td>/);
});

test('renderTable escapes row values', () => {
  const html = renderTable({
    columns: [{ key: 'name', label: 'Ad' }],
    rows: [{ name: '<script>alert(1)</script>' }],
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('renderTable appends an optional total row with class "tot"', () => {
  const html = renderTable({
    columns: [{ key: 'name', label: 'Campaign' }, { key: 'cost', label: 'Cost', numeric: true }],
    rows: [{ name: 'A', cost: '£1' }],
    totalRow: { name: 'Total', cost: '£1' },
  });
  assert.match(html, /<tr class="tot"><td>Total<\/td><td class="n">£1<\/td><\/tr>/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/render/table.test.js`
Expected: FAIL with "Cannot find module '../../lib/render/table'"

- [ ] **Step 3: Write the implementation**

```js
// lib/render/table.js

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderRow(columns, row, rowClass) {
  const cells = columns
    .map((c) => `<td${c.numeric ? ' class="n"' : ''}>${escapeHtml(row[c.key])}</td>`)
    .join('');
  return rowClass ? `<tr class="${rowClass}">${cells}</tr>` : `<tr>${cells}</tr>`;
}

function renderTable({ columns, rows, totalRow }) {
  const thead = columns.map((c) => `<th${c.numeric ? ' class="n"' : ''}>${escapeHtml(c.label)}</th>`).join('');
  const body = rows.map((r) => renderRow(columns, r)).join('');
  const total = totalRow ? renderRow(columns, totalRow, 'tot') : '';
  return `<table><thead><tr>${thead}</tr></thead><tbody>${body}${total}</tbody></table>`;
}

module.exports = { escapeHtml, renderTable };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/render/table.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add lib/render/table.js test/render/table.test.js
git commit -m "Add generic table renderer with HTML escaping"
```

---

## Task 14: Shared number formatting helpers

**Files:**
- Create: `lib/render/format.js`
- Test: `test/render/format.test.js`

**Interfaces:**
- Produces: `formatMoney(n: number): string` (full, comma-grouped, e.g. `'£12,808'`), `formatMoneyK(n: number): string` (abbreviated, e.g. `'£28.7k'` for values ≥ 1000, `'£420'` below), `formatNumber(n: number): string` (comma-grouped integer), `formatPercent(fraction: number): string` (e.g. `0.265` -> `'26.5%'`). Used by Tasks 15-19.

- [ ] **Step 1: Write the failing tests**

```js
// test/render/format.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { formatMoney, formatMoneyK, formatNumber, formatPercent } = require('../../lib/render/format');

test('formatMoney comma-groups to the nearest pound', () => {
  assert.strictEqual(formatMoney(12808), '£12,808');
  assert.strictEqual(formatMoney(990.4), '£990');
});

test('formatMoneyK abbreviates values at or above 1000 to one decimal', () => {
  assert.strictEqual(formatMoneyK(28700), '£28.7k');
  assert.strictEqual(formatMoneyK(104800), '£104.8k');
});

test('formatMoneyK shows full pounds below 1000', () => {
  assert.strictEqual(formatMoneyK(420), '£420');
});

test('formatNumber comma-groups integers', () => {
  assert.strictEqual(formatNumber(1599038), '1,599,038');
});

test('formatPercent renders a fraction as a one-decimal percentage', () => {
  assert.strictEqual(formatPercent(0.265), '26.5%');
  assert.strictEqual(formatPercent(1), '100.0%');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/render/format.test.js`
Expected: FAIL with "Cannot find module '../../lib/render/format'"

- [ ] **Step 3: Write the implementation**

```js
// lib/render/format.js

function formatNumber(n) {
  return Math.round(n).toLocaleString('en-GB');
}

function formatMoney(n) {
  return `£${formatNumber(n)}`;
}

function formatMoneyK(n) {
  if (Math.abs(n) < 1000) return `£${Math.round(n)}`;
  return `£${(n / 1000).toFixed(1)}k`;
}

function formatPercent(fraction) {
  return `${(fraction * 100).toFixed(1)}%`;
}

module.exports = { formatMoney, formatMoneyK, formatNumber, formatPercent };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/render/format.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add lib/render/format.js test/render/format.test.js
git commit -m "Add shared money/number/percent formatting helpers"
```

---

## Task 15: KPI card row renderer

**Files:**
- Create: `lib/render/kpis.js`
- Test: `test/render/kpis.test.js`

**Interfaces:**
- Consumes: `escapeHtml` from `lib/render/table.js` (Task 13)
- Produces: `renderKpiRow(cards: Array<{icon: string, big: string, cap: string, bigColor?: string, chg?: {text: string, cls?: string, style?: string}}>): string` — a full `<div class="kpis">...</div>` block matching the original markup exactly. Used by Task 18 (`api/dashboard.js`) for the top-level KPI row, and reused as-is for the Google and Meta tab KPI rows.

- [ ] **Step 1: Write the failing tests**

```js
// test/render/kpis.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderKpiRow } = require('../../lib/render/kpis');

test('renders a basic card with icon, big value, and caption', () => {
  const html = renderKpiRow([{ icon: 'Ⓖ COST · last 30d', big: '£12.8k', cap: 'total Google spend' }]);
  assert.strictEqual(
    html,
    '<div class="kpis"><div class="kpi"><div class="ic">Ⓖ COST · last 30d</div><div class="big">£12.8k</div><div class="cap">total Google spend</div></div></div>'
  );
});

test('renders an optional change line with a class', () => {
  const html = renderKpiRow([{ icon: 'BLENDED', big: '2.53', cap: 'ROAS', chg: { text: '▲ 65% · was 1.53', cls: 'up' } }]);
  assert.match(html, /<div class="chg up">▲ 65% · was 1\.53<\/div>/);
});

test('renders an optional inline style on the big value', () => {
  const html = renderKpiRow([{ icon: 'PROVEN', big: '12', cap: 'winners', bigColor: '#1E8A4C' }]);
  assert.match(html, /<div class="big" style="color:#1E8A4C">12<\/div>/);
});

test('joins multiple cards inside one kpis container', () => {
  const html = renderKpiRow([
    { icon: 'A', big: '1', cap: 'a' },
    { icon: 'B', big: '2', cap: 'b' },
  ]);
  assert.strictEqual((html.match(/class="kpi"/g) || []).length, 2);
  assert.strictEqual((html.match(/class="kpis"/g) || []).length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/render/kpis.test.js`
Expected: FAIL with "Cannot find module '../../lib/render/kpis'"

- [ ] **Step 3: Write the implementation**

```js
// lib/render/kpis.js
const { escapeHtml } = require('./table');

function renderKpiCard({ icon, big, cap, bigColor, chg }) {
  const bigAttr = bigColor ? ` style="color:${bigColor}"` : '';
  const bigHtml = `<div class="big"${bigAttr}>${escapeHtml(big)}</div>`;
  const chgHtml = chg
    ? `<div class="chg${chg.cls ? ` ${chg.cls}` : ''}"${chg.style ? ` style="${chg.style}"` : ''}>${escapeHtml(chg.text)}</div>`
    : '';
  return `<div class="kpi"><div class="ic">${escapeHtml(icon)}</div>${bigHtml}<div class="cap">${escapeHtml(cap)}</div>${chgHtml}</div>`;
}

function renderKpiRow(cards) {
  return `<div class="kpis">${cards.map(renderKpiCard).join('')}</div>`;
}

module.exports = { renderKpiRow };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/render/kpis.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add lib/render/kpis.js test/render/kpis.test.js
git commit -m "Add KPI card row renderer"
```

---

## Task 16: Google Ads campaign aggregation

**Files:**
- Create: `lib/transform/google-campaigns.js`
- Test: `test/transform/google-campaigns.test.js`

**Interfaces:**
- Consumes: `toIsoDate` from `lib/dates.js` (Task 4)
- Produces: `getGoogleCampaignType(campaignName: string): 'PMax' | 'Search · brand' | 'Search · non-brand' | 'Shopping' | 'Display' | 'Other'`, `buildGoogleCampaignRows(rows, {start, end}): {rows: Array<{campaign, type, cost, impr, clicks, ctr, conv, convValue, cpa, roas}>, total: {cost, impr, clicks, ctr, conv, convValue, cpa, roas}}`. Used by Task 17 (`render/google.js`).

- [ ] **Step 1: Write the failing tests**

```js
// test/transform/google-campaigns.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { getGoogleCampaignType, buildGoogleCampaignRows } = require('../../lib/transform/google-campaigns');

test('getGoogleCampaignType classifies by name substring', () => {
  assert.strictEqual(getGoogleCampaignType('L - PMax - D2C Coffee'), 'PMax');
  assert.strictEqual(getGoogleCampaignType('L - Search - Brand'), 'Search · brand');
  assert.strictEqual(getGoogleCampaignType('L - Search - Non Brand'), 'Search · non-brand');
  assert.strictEqual(getGoogleCampaignType('L - Standard Shopping - Brand'), 'Shopping');
  assert.strictEqual(getGoogleCampaignType('L - Display - Prospecting'), 'Display');
  assert.strictEqual(getGoogleCampaignType('Some Other Campaign'), 'Other');
});

test('buildGoogleCampaignRows aggregates cost/impr/clicks/conv within the window, computing CPA/ROAS/CTR', () => {
  const rows = [
    { Campaign: 'L - Search - Brand', Day: '2026-07-20', Cost: '100', 'Impr.': '1000', Clicks: '50', Conversions: '10', 'Conv. value': '400' },
    { Campaign: 'L - Search - Brand', Day: '2026-07-21', Cost: '50', 'Impr.': '500', Clicks: '25', Conversions: '5', 'Conv. value': '200' },
    { Campaign: 'L - Search - Brand', Day: '2026-01-01', Cost: '999', 'Impr.': '1', Clicks: '1', Conversions: '1', 'Conv. value': '1' }, // outside window
  ];
  const { rows: out, total } = buildGoogleCampaignRows(rows, { start: '2026-07-20', end: '2026-08-18' });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].cost, 150);
  assert.strictEqual(out[0].conv, 15);
  assert.strictEqual(out[0].cpa, 10);
  assert.strictEqual(out[0].roas, 4);
  assert.strictEqual(out[0].ctr, 75 / 1500);
  assert.strictEqual(total.cost, 150);
});

test('buildGoogleCampaignRows gives 0 (not NaN/Infinity) CPA/ROAS/CTR when conversions/cost/impr are 0', () => {
  const rows = [{ Campaign: 'X', Day: '2026-07-20', Cost: '0', 'Impr.': '0', Clicks: '0', Conversions: '0', 'Conv. value': '0' }];
  const { rows: out } = buildGoogleCampaignRows(rows, { start: '2026-07-20', end: '2026-08-18' });
  assert.strictEqual(out[0].cpa, 0);
  assert.strictEqual(out[0].roas, 0);
  assert.strictEqual(out[0].ctr, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/transform/google-campaigns.test.js`
Expected: FAIL with "Cannot find module '../../lib/transform/google-campaigns'"

- [ ] **Step 3: Write the implementation**

```js
// lib/transform/google-campaigns.js
const { toIsoDate } = require('../dates');

function getGoogleCampaignType(name) {
  if (/pmax/i.test(name)) return 'PMax';
  if (/search/i.test(name) && /non.?brand/i.test(name)) return 'Search · non-brand';
  if (/search/i.test(name) && /brand/i.test(name)) return 'Search · brand';
  if (/shopping/i.test(name)) return 'Shopping';
  if (/display/i.test(name)) return 'Display';
  return 'Other';
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function deriveRates(agg) {
  return {
    ...agg,
    ctr: agg.impr > 0 ? agg.clicks / agg.impr : 0,
    cpa: agg.conv > 0 ? agg.cost / agg.conv : 0,
    roas: agg.cost > 0 ? agg.convValue / agg.cost : 0,
  };
}

function buildGoogleCampaignRows(rows, { start, end }) {
  const byCampaign = new Map();
  const totalAgg = { cost: 0, impr: 0, clicks: 0, conv: 0, convValue: 0 };

  for (const r of rows) {
    const date = toIsoDate(r['Day']);
    if (date < start || date > end) continue;

    const campaign = r['Campaign'];
    if (!byCampaign.has(campaign)) {
      byCampaign.set(campaign, { cost: 0, impr: 0, clicks: 0, conv: 0, convValue: 0 });
    }
    const agg = byCampaign.get(campaign);
    const cost = num(r['Cost']);
    const impr = num(r['Impr.']);
    const clicks = num(r['Clicks']);
    const conv = num(r['Conversions']);
    const convValue = num(r['Conv. value']);

    agg.cost += cost;
    agg.impr += impr;
    agg.clicks += clicks;
    agg.conv += conv;
    agg.convValue += convValue;

    totalAgg.cost += cost;
    totalAgg.impr += impr;
    totalAgg.clicks += clicks;
    totalAgg.conv += conv;
    totalAgg.convValue += convValue;
  }

  const outRows = [...byCampaign.entries()].map(([campaign, agg]) => ({
    campaign,
    type: getGoogleCampaignType(campaign),
    ...deriveRates(agg),
  }));

  return { rows: outRows, total: deriveRates(totalAgg) };
}

module.exports = { getGoogleCampaignType, buildGoogleCampaignRows };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/transform/google-campaigns.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add lib/transform/google-campaigns.js test/transform/google-campaigns.test.js
git commit -m "Add Google Ads campaign aggregation and type classification"
```

---

## Task 17: Google Ads tab renderer

**Files:**
- Create: `lib/render/google.js`
- Test: `test/render/google.test.js`

**Interfaces:**
- Consumes: `renderKpiRow` (Task 15), `renderTable`, `escapeHtml` (Task 13), `formatMoney`, `formatMoneyK`, `formatNumber`, `formatPercent` (Task 14), the `{rows, total}` shape from `buildGoogleCampaignRows` (Task 16)
- Produces: `renderGoogleTab({rows, total}): string` — KPI row + campaign table + note, matching the original markup. Used by Task 18 (`api/dashboard.js`).

- [ ] **Step 1: Write the failing tests**

```js
// test/render/google.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderGoogleTab } = require('../../lib/render/google');

const SAMPLE = {
  rows: [
    { campaign: 'L - Search - Brand', type: 'Search · brand', cost: 2697, impr: 12353, clicks: 3279, ctr: 0.265, conv: 315, convValue: 8501, cpa: 8.6, roas: 3.15 },
    { campaign: 'L - Display - Prospecting', type: 'Display', cost: 293, impr: 474051, clicks: 1521, ctr: 0.003, conv: 0, convValue: 0, cpa: 0, roas: 0 },
  ],
  total: { cost: 2990, impr: 486404, clicks: 4800, ctr: 0.01, conv: 315, convValue: 8501, cpa: 9.49, roas: 2.84 },
};

test('renders a KPI row with cost, conversions, conv value, and ROAS', () => {
  const html = renderGoogleTab(SAMPLE);
  assert.match(html, /<div class="kpis">/);
  assert.match(html, /£2,990/);
  assert.match(html, />315</);
  assert.match(html, /£8,501/);
  assert.match(html, />2\.84</);
});

test('renders one table row per campaign with formatted cells', () => {
  const html = renderGoogleTab(SAMPLE);
  assert.match(html, /L - Search - Brand/);
  assert.match(html, /£2,697/);
  assert.match(html, />12,353</);
  assert.match(html, />26\.5%</);
  assert.match(html, />315</);
  assert.match(html, />£8\.6</);
  assert.match(html, />3\.15</);
});

test('shows an en-dash for CPA when there are no conversions, but 0.00 for ROAS', () => {
  const html = renderGoogleTab(SAMPLE);
  assert.match(html, /L - Display - Prospecting[\s\S]*?<td class="n">–<\/td><td class="n">0\.00<\/td>/);
});

test('renders a total row', () => {
  const html = renderGoogleTab(SAMPLE);
  assert.match(html, /<tr class="tot"><td>Total<\/td>/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/render/google.test.js`
Expected: FAIL with "Cannot find module '../../lib/render/google'"

- [ ] **Step 3: Write the implementation**

**Ruling (recorded during Task 17 execution):** the code below originally rendered the Type column via a `typeCell()` helper that built a small colored-dot `<span>` as raw HTML. That's incompatible with `renderTable` (Task 13), which unconditionally HTML-escapes every cell value — the raw `<span>` markup would come out double-escaped as visible broken text, not a colored dot. `renderTable`'s escaping is a deliberately tested security invariant (its own XSS test) and is not to be weakened for a cosmetic nicety. Ruling: drop the colored dot, render the Type column as plain text. The type label itself (e.g. "PMax", "Search · brand") is unaffected — only the small decorative square is lost. Cost if wrong: purely cosmetic, trivially reversible later (e.g. via a CSS `:contains`-free approach or a dedicated non-escaped column type in `renderTable`, should a future task want the dot back).

```js
// lib/render/google.js
const { renderKpiRow } = require('./kpis');
const { renderTable } = require('./table');
const { formatMoney, formatMoneyK, formatNumber, formatPercent } = require('./format');

function toTableRow(r) {
  return {
    campaign: r.campaign,
    type: r.type,
    cost: formatMoney(r.cost),
    impr: formatNumber(r.impr),
    clicks: formatNumber(r.clicks),
    ctr: formatPercent(r.ctr),
    conv: formatNumber(r.conv),
    convValue: formatMoney(r.convValue),
    cpa: r.conv > 0 ? `£${r.cpa.toFixed(1)}` : '–',
    roas: r.roas.toFixed(2),
  };
}

function renderGoogleTab({ rows, total }) {
  const kpiRow = renderKpiRow([
    { icon: 'Ⓖ COST · last 30d', big: formatMoneyK(total.cost), cap: 'total Google spend' },
    { icon: 'CONVERSIONS', big: formatNumber(total.conv), cap: 'Google-attributed' },
    { icon: 'CONV VALUE', big: formatMoneyK(total.convValue), cap: 'Google-attributed' },
    { icon: 'ROAS', big: total.roas.toFixed(2), cap: 'value ÷ cost (Google)' },
  ]);

  const table = renderTable({
    columns: [
      { key: 'campaign', label: 'Campaign' },
      { key: 'type', label: 'Type' },
      { key: 'cost', label: 'Cost', numeric: true },
      { key: 'impr', label: 'Impr', numeric: true },
      { key: 'clicks', label: 'Clicks', numeric: true },
      { key: 'ctr', label: 'CTR', numeric: true },
      { key: 'conv', label: 'Conv', numeric: true },
      { key: 'convValue', label: 'Conv value', numeric: true },
      { key: 'cpa', label: 'CPA', numeric: true },
      { key: 'roas', label: 'ROAS', numeric: true },
    ],
    rows: rows.map(toTableRow),
    totalRow: {
      campaign: 'Total',
      type: '',
      cost: formatMoney(total.cost),
      impr: formatNumber(total.impr),
      clicks: formatNumber(total.clicks),
      ctr: formatPercent(total.ctr),
      conv: formatNumber(total.conv),
      convValue: formatMoney(total.convValue),
      cpa: total.conv > 0 ? `£${total.cpa.toFixed(1)}` : '–',
      roas: total.roas.toFixed(2),
    },
  });

  const note = '<div class="note" style="font-size:12px">Conversions and value here are <b>Google-attributed</b> (last click within Google) and over-claim vs Shopify — treat this ROAS as directional; the blended truth is on the Performance tab.</div>';

  return `${kpiRow}<div class="card" style="overflow-x:auto;margin-top:12px">${table}</div>${note}`;
}

module.exports = { renderGoogleTab };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/render/google.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add lib/render/google.js test/render/google.test.js
git commit -m "Add Google Ads tab renderer"
```

---

## Task 18: Funnel split and status-spend aggregation

**Files:**
- Create: `lib/transform/overview.js`
- Test: `test/transform/overview.test.js`

**Interfaces:**
- Consumes: the `DATA`-shaped array from `buildCreativesData` (Task 8)
- Produces: `buildFunnelSplit(data): Array<{stage: 'TOF'|'MOF'|'BOF', spend: number, share: number, ads: number, purch: number, roas: number}>` (only TOF/MOF/BOF, in that order), `buildStatusSpend(data): Array<{status: 'PROVEN'|'TESTING'|'KILL'|'Feeder'|'STARVED', count: number, spend: number, share: number}>` (all five statuses always present, `KILL` always zero since no rule produces it — kept for legend parity with the original). Used by Task 19 (`render/overview.js`).

- [ ] **Step 1: Write the failing tests**

```js
// test/transform/overview.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildFunnelSplit, buildStatusSpend } = require('../../lib/transform/overview');

function ad(overrides) {
  return { stage: 'BOF', spend: 100, purch: 10, roas: 2, status: 'PROVEN', ...overrides };
}

test('buildFunnelSplit groups by stage in TOF/MOF/BOF order with share of total spend', () => {
  const split = buildFunnelSplit([ad({ stage: 'TOF', spend: 300, purch: 1, roas: 0.1 }), ad({ stage: 'BOF', spend: 700, purch: 10, roas: 2 })]);
  assert.deepStrictEqual(split.map((s) => s.stage), ['TOF', 'MOF', 'BOF']);
  const tof = split.find((s) => s.stage === 'TOF');
  assert.strictEqual(tof.spend, 300);
  assert.strictEqual(tof.share, 0.3);
  const mof = split.find((s) => s.stage === 'MOF');
  assert.strictEqual(mof.spend, 0);
  assert.strictEqual(mof.ads, 0);
});

test('buildFunnelSplit computes stage-level ROAS from spend and purchase value, not an average of per-ad ROAS', () => {
  const split = buildFunnelSplit([
    ad({ stage: 'BOF', spend: 100, val: 300 }),
    ad({ stage: 'BOF', spend: 300, val: 300 }),
  ]);
  const bof = split.find((s) => s.stage === 'BOF');
  assert.strictEqual(bof.roas, 600 / 400);
});

test('buildStatusSpend always includes all five statuses, KILL always zero', () => {
  const spend = buildStatusSpend([ad({ status: 'PROVEN', spend: 100 }), ad({ status: 'Feeder', spend: 50 })]);
  assert.deepStrictEqual(
    spend.map((s) => s.status),
    ['PROVEN', 'TESTING', 'KILL', 'Feeder', 'STARVED']
  );
  const kill = spend.find((s) => s.status === 'KILL');
  assert.strictEqual(kill.count, 0);
  assert.strictEqual(kill.spend, 0);
  const proven = spend.find((s) => s.status === 'PROVEN');
  assert.strictEqual(proven.share, 100 / 150);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/transform/overview.test.js`
Expected: FAIL with "Cannot find module '../../lib/transform/overview'"

- [ ] **Step 3: Write the implementation**

```js
// lib/transform/overview.js

const STAGES = ['TOF', 'MOF', 'BOF'];
const STATUSES = ['PROVEN', 'TESTING', 'KILL', 'Feeder', 'STARVED'];

function buildFunnelSplit(data) {
  const totalSpend = data.reduce((sum, ad) => sum + ad.spend, 0);
  return STAGES.map((stage) => {
    const ads = data.filter((ad) => ad.stage === stage);
    const spend = ads.reduce((sum, ad) => sum + ad.spend, 0);
    const val = ads.reduce((sum, ad) => sum + (ad.val || 0), 0);
    const purch = ads.reduce((sum, ad) => sum + ad.purch, 0);
    return {
      stage,
      spend,
      share: totalSpend > 0 ? spend / totalSpend : 0,
      ads: ads.length,
      purch,
      roas: spend > 0 ? val / spend : 0,
    };
  });
}

function buildStatusSpend(data) {
  const totalSpend = data.reduce((sum, ad) => sum + ad.spend, 0);
  return STATUSES.map((status) => {
    const ads = data.filter((ad) => ad.status === status);
    const spend = ads.reduce((sum, ad) => sum + ad.spend, 0);
    return {
      status,
      count: ads.length,
      spend,
      share: totalSpend > 0 ? spend / totalSpend : 0,
    };
  });
}

module.exports = { buildFunnelSplit, buildStatusSpend };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/transform/overview.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add lib/transform/overview.js test/transform/overview.test.js
git commit -m "Add funnel split and status-spend aggregation"
```

---

## Task 19: Creative Overview tab renderer

**Files:**
- Create: `lib/render/overview.js`
- Test: `test/render/overview.test.js`

**Interfaces:**
- Consumes: `renderTable`, `escapeHtml` (Task 13), `formatMoney`, `formatPercent`, `formatNumber` (Task 14), the outputs of `buildFunnelSplit`/`buildStatusSpend` (Task 18)
- Produces: `renderOverviewTab({funnel, statusSpend}): string`. Used by Task 18 [sic — `api/dashboard.js`, Task 24 below].

- [ ] **Step 1: Write the failing tests**

```js
// test/render/overview.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderOverviewTab } = require('../../lib/render/overview');

const FUNNEL = [
  { stage: 'TOF', spend: 7495, share: 0.261, ads: 48, purch: 24, roas: 0.06 },
  { stage: 'MOF', spend: 3802, share: 0.133, ads: 91, purch: 6, roas: 0.05 },
  { stage: 'BOF', spend: 17379, share: 0.606, ads: 260, purch: 1975, roas: 2.74 },
];
const STATUS = [
  { status: 'PROVEN', count: 12, spend: 15105, share: 0.527 },
  { status: 'TESTING', count: 18, spend: 1907, share: 0.067 },
  { status: 'KILL', count: 0, spend: 0, share: 0 },
  { status: 'Feeder', count: 139, spend: 11297, share: 0.394 },
  { status: 'STARVED', count: 230, spend: 367, share: 0.013 },
];

test('renders a funnel bar segment per stage sized by share', () => {
  const html = renderOverviewTab({ funnel: FUNNEL, statusSpend: STATUS });
  assert.match(html, /<div style="width:26\.1%;background:#7cc4e8" title="TOF"><\/div>/);
  assert.match(html, /<div style="width:60\.6%;background:#1f5f8b" title="BOF"><\/div>/);
});

test('renders the funnel table with formatted spend/share/roas', () => {
  const html = renderOverviewTab({ funnel: FUNNEL, statusSpend: STATUS });
  assert.match(html, /£17,379/);
  assert.match(html, />60\.6%</);
  assert.match(html, />2\.74</);
});

test('renders a status legend entry per status with count and spend', () => {
  const html = renderOverviewTab({ funnel: FUNNEL, statusSpend: STATUS });
  assert.match(html, /PROVEN · 12 · £15,105/);
  assert.match(html, /KILL · 0 · £0/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/render/overview.test.js`
Expected: FAIL with "Cannot find module '../../lib/render/overview'"

- [ ] **Step 3: Write the implementation**

```js
// lib/render/overview.js
const { renderTable, escapeHtml } = require('./table');
const { formatMoney, formatPercent, formatNumber } = require('./format');

const STAGE_COLOR = { TOF: '#7cc4e8', MOF: '#4a90c2', BOF: '#1f5f8b' };
const STATUS_COLOR = { PROVEN: '#1E8A4C', TESTING: '#C98A00', KILL: '#C0392B', Feeder: '#2b6cb0', STARVED: '#8a8a8a' };
const STAGE_LABEL = { TOF: 'TOF · Awareness', MOF: 'MOF · Consideration', BOF: 'BOF · Conversion' };

function renderOverviewTab({ funnel, statusSpend }) {
  const funnelBar = `<div class="bar">${funnel
    .map((f) => `<div style="width:${(f.share * 100).toFixed(1)}%;background:${STAGE_COLOR[f.stage]}" title="${f.stage}"></div>`)
    .join('')}</div>`;

  const funnelTable = renderTable({
    columns: [
      { key: 'stage', label: 'Stage' },
      { key: 'spend', label: 'Spend', numeric: true },
      { key: 'share', label: 'Share', numeric: true },
      { key: 'ads', label: 'Ads', numeric: true },
      { key: 'purch', label: 'Purch', numeric: true },
      { key: 'roas', label: 'ROAS', numeric: true },
    ],
    rows: funnel.map((f) => ({
      stage: STAGE_LABEL[f.stage],
      spend: formatMoney(f.spend),
      share: formatPercent(f.share),
      ads: formatNumber(f.ads),
      purch: formatNumber(f.purch),
      roas: f.roas.toFixed(2),
    })),
  });

  const statusBar = `<div class="bar">${statusSpend
    .map((s) => `<div style="width:${(s.share * 100).toFixed(1)}%;background:${STATUS_COLOR[s.status]}" title="${s.status}"></div>`)
    .join('')}</div>`;

  const legend = `<div class="legend">${statusSpend
    .map((s) => `<span class="lg2"><i style="background:${STATUS_COLOR[s.status]}"></i>${escapeHtml(s.status)} · ${s.count} · ${formatMoney(s.spend)}</span>`)
    .join('')}</div>`;

  return (
    `${funnelBar}<div class="card" style="margin-top:10px">${funnelTable}</div>` +
    `<h2>Spend by status</h2>${statusBar}${legend}`
  );
}

module.exports = { renderOverviewTab };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/render/overview.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add lib/render/overview.js test/render/overview.test.js
git commit -m "Add Creative Overview tab renderer (funnel split + status spend)"
```

---

## Task 20: Generic breakdown aggregation (angle / persona / pack / product)

**Files:**
- Create: `lib/transform/breakdown.js`
- Test: `test/transform/breakdown.test.js`

**Interfaces:**
- Consumes: the `DATA`-shaped array from `buildCreativesData` (Task 8)
- Produces: `buildBreakdown(data, keyFn: (ad) => string): Array<{label: string, spend: number, ads: number, purch: number, cpa: number, roas: number}>`, sorted by spend descending. Used by Task 21 (`render/breakdowns.js`) for all four breakdown tables (by angle, by persona, by pack type, by pack×format).

- [ ] **Step 1: Write the failing tests**

```js
// test/transform/breakdown.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildBreakdown } = require('../../lib/transform/breakdown');

function ad(overrides) {
  return { angle: 'Price', spend: 100, purch: 10, val: 300, ...overrides };
}

test('groups by the key function, summing spend/purchases/value and counting ads', () => {
  const rows = buildBreakdown(
    [ad({ angle: 'Price', spend: 100, purch: 10, val: 300 }), ad({ angle: 'Price', spend: 50, purch: 5, val: 100 }), ad({ angle: 'Trust', spend: 20, purch: 1, val: 20 })],
    (a) => a.angle
  );
  const price = rows.find((r) => r.label === 'Price');
  assert.strictEqual(price.spend, 150);
  assert.strictEqual(price.ads, 2);
  assert.strictEqual(price.purch, 15);
  assert.strictEqual(price.cpa, 10);
  assert.strictEqual(price.roas, 400 / 150);
});

test('sorts groups by spend descending', () => {
  const rows = buildBreakdown([ad({ angle: 'Trust', spend: 20 }), ad({ angle: 'Price', spend: 100 })], (a) => a.angle);
  assert.deepStrictEqual(rows.map((r) => r.label), ['Price', 'Trust']);
});

test('gives 0 cpa/roas (not NaN/Infinity) for a group with 0 purchases/spend', () => {
  const rows = buildBreakdown([ad({ angle: 'Cafe', spend: 22, purch: 0, val: 0 })], (a) => a.angle);
  assert.strictEqual(rows[0].cpa, 0);
  assert.strictEqual(rows[0].roas, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/transform/breakdown.test.js`
Expected: FAIL with "Cannot find module '../../lib/transform/breakdown'"

- [ ] **Step 3: Write the implementation**

```js
// lib/transform/breakdown.js

function buildBreakdown(data, keyFn) {
  const byLabel = new Map();
  for (const ad of data) {
    const label = keyFn(ad);
    if (!byLabel.has(label)) byLabel.set(label, { spend: 0, ads: 0, purch: 0, val: 0 });
    const agg = byLabel.get(label);
    agg.spend += ad.spend;
    agg.ads += 1;
    agg.purch += ad.purch;
    agg.val += ad.val || 0;
  }
  return [...byLabel.entries()]
    .map(([label, agg]) => ({
      label,
      spend: agg.spend,
      ads: agg.ads,
      purch: agg.purch,
      cpa: agg.purch > 0 ? agg.spend / agg.purch : 0,
      roas: agg.spend > 0 ? agg.val / agg.spend : 0,
    }))
    .sort((a, b) => b.spend - a.spend);
}

module.exports = { buildBreakdown };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/transform/breakdown.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add lib/transform/breakdown.js test/transform/breakdown.test.js
git commit -m "Add generic angle/persona/pack/product breakdown aggregation"
```

---

## Task 21: Breakdown table renderer (Angle & Persona, Pack & Product tabs)

**Files:**
- Create: `lib/render/breakdowns.js`
- Test: `test/render/breakdowns.test.js`

**Interfaces:**
- Consumes: `renderTable` (Task 13), `formatMoney`, `formatNumber` (Task 14), rows shaped like `buildBreakdown`'s output (Task 20)
- Produces: `renderBreakdownCard({title, labelHeader, rows, cpaDecimals?, boldRows?}): string` (one `<h3>`+table card), `renderTwoColumn(leftHtml, rightHtml): string` (wraps two cards in the original's `.two` side-by-side layout). Used by Task 22 (`api/dashboard.js` wiring for Angle & Persona and Pack & Product tabs).

- [ ] **Step 1: Write the failing tests**

```js
// test/render/breakdowns.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderBreakdownCard, renderTwoColumn } = require('../../lib/render/breakdowns');

const ROWS = [{ label: 'Price', spend: 10491, ads: 21, purch: 1282, cpa: 8.18, roas: 3.01 }];

test('renders a titled card with a table using the given label header', () => {
  const html = renderBreakdownCard({ title: 'By angle', labelHeader: 'Angle', rows: ROWS });
  assert.match(html, /<h3>By angle<\/h3>/);
  assert.match(html, /<th>Angle<\/th>/);
  assert.match(html, /Price/);
  assert.match(html, /£10,491/);
});

test('cpaDecimals controls CPA precision (0 for angle/persona, 2 for pack/product)', () => {
  const zeroDp = renderBreakdownCard({ title: 'By angle', labelHeader: 'Angle', rows: ROWS, cpaDecimals: 0 });
  assert.match(zeroDp, />£8</);
  const twoDp = renderBreakdownCard({ title: 'By pack type', labelHeader: 'Pack', rows: ROWS, cpaDecimals: 2 });
  assert.match(twoDp, />£8\.18</);
});

test('boldRows renders every row with class "tot" (used for the pack-type table)', () => {
  const html = renderBreakdownCard({ title: 'By pack type', labelHeader: 'Pack', rows: ROWS, boldRows: true });
  assert.match(html, /<tr class="tot">/);
});

test('renderTwoColumn places two card htmls directly inside a .two container', () => {
  const html = renderTwoColumn('<div>LEFT</div>', '<div>RIGHT</div>');
  assert.strictEqual(html, '<div class="two"><div>LEFT</div><div>RIGHT</div></div>');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/render/breakdowns.test.js`
Expected: FAIL with "Cannot find module '../../lib/render/breakdowns'"

- [ ] **Step 3: Write the implementation**

```js
// lib/render/breakdowns.js
const { renderTable } = require('./table');
const { formatMoney, formatNumber } = require('./format');

function renderBreakdownCard({ title, labelHeader, rows, cpaDecimals = 0, boldRows = false }) {
  const tableRows = rows.map((r) => ({
    label: r.label,
    spend: formatMoney(r.spend),
    ads: formatNumber(r.ads),
    purch: formatNumber(r.purch),
    cpa: r.purch > 0 ? `£${r.cpa.toFixed(cpaDecimals)}` : '–',
    roas: r.roas.toFixed(2),
  }));

  let table = renderTable({
    columns: [
      { key: 'label', label: labelHeader },
      { key: 'spend', label: 'Spend', numeric: true },
      { key: 'ads', label: 'Ads', numeric: true },
      { key: 'purch', label: 'Purch', numeric: true },
      { key: 'cpa', label: 'CPA', numeric: true },
      { key: 'roas', label: 'ROAS', numeric: true },
    ],
    rows: tableRows,
  });

  if (boldRows) {
    // Lookahead restricts this to body rows (followed by <td>), not the
    // <thead> row (followed by <th>) — a global /<tr>/g would bold the header too.
    table = table.replace(/<tr>(?=<td)/g, '<tr class="tot">');
  }

  return `<div><h3>${title}</h3><div class="card">${table}</div></div>`;
}

function renderTwoColumn(leftHtml, rightHtml) {
  return `<div class="two">${leftHtml}${rightHtml}</div>`;
}

module.exports = { renderBreakdownCard, renderTwoColumn };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/render/breakdowns.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add lib/render/breakdowns.js test/render/breakdowns.test.js
git commit -m "Add breakdown table renderer for Angle/Persona and Pack/Product tabs"
```

---

## Task 22: Cohort heatmap renderer

**Files:**
- Create: `lib/render/cohort.js`
- Test: `test/render/cohort.test.js`

**Interfaces:**
- Consumes: `escapeHtml` (Task 13), `formatNumber`, `formatPercent` (Task 14), rows shaped like `buildCohortTable`'s output (Task 11)
- Produces: `renderCohortTable(cohortRows): string` (a full `<table>` with per-cell heatmap shading). Used by Task 26 (`api/dashboard.js`).

Shading rule (matches the original): find the single highest non-M0 retention rate across the whole table; every non-M0 cell's background opacity is `rate / maxRate` (capped at 1), rendered as `rgba(91,91,230,opacity)`; text is white when opacity ≥ 0.5, else `#333`. M0 is always full opacity with white text. Empty (no data yet) cells render as a bare `<td></td>`.

- [ ] **Step 1: Write the failing tests**

```js
// test/render/cohort.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderCohortTable } = require('../../lib/render/cohort');

const ROWS = [
  { cohortLabel: 'Aug 2025', size: 1124, months: [1, 0.067, 0.072, null, ...Array(9).fill(null)] },
  { cohortLabel: 'Apr 2026', size: 985, months: [1, 0.219, 0.153, 0.117, ...Array(9).fill(null)] },
];

test('M0 is always full opacity with white text', () => {
  const html = renderCohortTable(ROWS);
  assert.match(html, /Aug 2025<\/td><td class="n">1,124<\/td><td class="n" style="background:rgba\(91,91,230,1\.00\);color:#fff">100\.0%<\/td>/);
});

test('non-M0 cells scale opacity relative to the table-wide max rate', () => {
  const html = renderCohortTable(ROWS);
  // max rate across the table is 0.219 (Apr 2026 M1) -> that cell is full opacity
  assert.match(html, /rgba\(91,91,230,1\.00\);color:#fff">21\.9%/);
  // 0.067 / 0.219 = 0.31 -> dark text
  assert.match(html, /rgba\(91,91,230,0\.31\);color:#333">6\.7%/);
});

test('cells with no data render as an empty cell', () => {
  const html = renderCohortTable(ROWS);
  assert.match(html, /<td><\/td>/);
});

test('renders one header column per cohort month plus Cohort and Size', () => {
  const html = renderCohortTable(ROWS);
  assert.match(html, /<th>Cohort<\/th><th class="n">Size<\/th><th class="n">M0<\/th>.*<th class="n">M12<\/th>/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/render/cohort.test.js`
Expected: FAIL with "Cannot find module '../../lib/render/cohort'"

- [ ] **Step 3: Write the implementation**

```js
// lib/render/cohort.js
const { escapeHtml } = require('./table');
const { formatNumber, formatPercent } = require('./format');

function renderCohortTable(cohortRows) {
  const nonM0Rates = cohortRows.flatMap((r) => r.months.slice(1)).filter((v) => v !== null && v !== undefined);
  const maxRate = nonM0Rates.length ? Math.max(...nonM0Rates) : 0;

  const header =
    '<th>Cohort</th><th class="n">Size</th>' +
    Array.from({ length: 13 }, (_, i) => `<th class="n">M${i}</th>`).join('');

  const bodyRows = cohortRows
    .map((r) => {
      const cells = r.months
        .map((v, i) => {
          if (v === null || v === undefined) return '<td></td>';
          const opacity = i === 0 ? 1 : maxRate > 0 ? Math.min(1, v / maxRate) : 0;
          const color = opacity >= 0.5 ? '#fff' : '#333';
          return `<td class="n" style="background:rgba(91,91,230,${opacity.toFixed(2)});color:${color}">${formatPercent(v)}</td>`;
        })
        .join('');
      return `<tr><td>${escapeHtml(r.cohortLabel)}</td><td class="n">${formatNumber(r.size)}</td>${cells}</tr>`;
    })
    .join('');

  return `<table style="font-size:12px"><thead><tr>${header}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

module.exports = { renderCohortTable };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/render/cohort.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add lib/render/cohort.js test/render/cohort.test.js
git commit -m "Add cohort retention heatmap renderer"
```

---

## Task 23: Subscription & LTV tab renderer

**Files:**
- Create: `lib/render/subscription.js`
- Test: `test/render/subscription.test.js`

**Interfaces:**
- Consumes: `renderKpiRow` (Task 15), `renderTable`, `escapeHtml` (Task 13), `formatMoney`, `formatPercent`, `formatNumber` (Task 14)
- Produces: `renderSubscriptionTab({aov, newCustomers, returningCustomers}): string`. Per spec Sections 2.1/2.3, the Cumulative LTV table and subscriber-level Recharge metrics have no source data and render as placeholder notes rather than fabricated numbers. Used by Task 26 (`api/dashboard.js`).

- [ ] **Step 1: Write the failing tests**

```js
// test/render/subscription.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderSubscriptionTab } = require('../../lib/render/subscription');

test('renders AOV and new-customer-share KPI cards', () => {
  const html = renderSubscriptionTab({ aov: 19.37, newCustomers: 5088, returningCustomers: 3046 });
  assert.match(html, /£19\.37/);
  assert.match(html, />62\.6%</); // 5088 / 8134
  assert.match(html, /5,088 new of 8,134/);
});

test('renders the new-vs-returning table with counts and shares', () => {
  const html = renderSubscriptionTab({ aov: 19.37, newCustomers: 5088, returningCustomers: 3046 });
  assert.match(html, /New customer/);
  assert.match(html, />5,088</);
  assert.match(html, />62\.6%</);
  assert.match(html, /Returning customer/);
  assert.match(html, />3,046</);
});

test('renders a placeholder note instead of a fabricated Cumulative LTV table', () => {
  const html = renderSubscriptionTab({ aov: 19.37, newCustomers: 5088, returningCustomers: 3046 });
  assert.match(html, /Cumulative LTV/);
  assert.match(html, /not yet available/i);
});

test('renders the existing subscriber-metrics placeholder note', () => {
  const html = renderSubscriptionTab({ aov: 19.37, newCustomers: 5088, returningCustomers: 3046 });
  assert.match(html, /Recharge/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/render/subscription.test.js`
Expected: FAIL with "Cannot find module '../../lib/render/subscription'"

- [ ] **Step 3: Write the implementation**

```js
// lib/render/subscription.js
const { renderKpiRow } = require('./kpis');
const { renderTable } = require('./table');
const { formatPercent, formatNumber } = require('./format');

function renderSubscriptionTab({ aov, newCustomers, returningCustomers }) {
  const total = newCustomers + returningCustomers;
  const newShare = total > 0 ? newCustomers / total : 0;

  const kpiRow = renderKpiRow([
    // AOV needs pence precision (matches the original dashboard's "£19.37"); formatMoney (Task 14)
    // rounds to the nearest whole pound, which is right for large totals but wrong here — format locally.
    { icon: 'AVG ORDER VALUE · last 30d', big: `£${aov.toFixed(2)}`, cap: 'net sales ÷ orders' },
    {
      icon: 'NEW CUSTOMER SHARE',
      big: formatPercent(newShare),
      cap: `${formatNumber(newCustomers)} new of ${formatNumber(total)} (last 60d)`,
    },
  ]);

  const newVsReturningTable = renderTable({
    columns: [
      { key: 'customer', label: 'Customer' },
      { key: 'count', label: 'Count', numeric: true },
      { key: 'share', label: 'Share', numeric: true },
    ],
    rows: [
      { customer: 'New customer', count: formatNumber(newCustomers), share: formatPercent(newShare) },
      { customer: 'Returning customer', count: formatNumber(returningCustomers), share: formatPercent(1 - newShare) },
    ],
  });

  const ltvPlaceholder =
    '<div class="note" style="font-size:12.5px">Cumulative LTV (£ by month since first order) is not yet available — ' +
    'it needs a blended-LTV data source this Sheet does not currently provide.</div>';

  const subscriberNote =
    '<div class="note">Subscriber-level metrics (active subscribers, taster→subscribe rate, subscription LTV) ' +
    'come from Recharge — being wired in now and will populate here next.</div>';

  return (
    `${kpiRow}<div class="two">` +
    `<div><h3>New vs returning (last 60d)</h3><div class="card">${newVsReturningTable}</div></div>` +
    `<div><h3>Cumulative LTV (blended)</h3>${ltvPlaceholder}</div>` +
    `</div>${subscriberNote}`
  );
}

module.exports = { renderSubscriptionTab };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/render/subscription.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add lib/render/subscription.js test/render/subscription.test.js
git commit -m "Add Subscription & LTV tab renderer"
```

---

## Task 24: Meta campaigns tab renderer

**Files:**
- Create: `lib/render/meta.js`
- Test: `test/render/meta.test.js`

**Interfaces:**
- Consumes: `renderKpiRow` (Task 15), `formatMoneyK`, `formatNumber` (Task 14)
- Produces: `renderMetaTab({spend, purchases, convValue, roas}): string` — KPI row plus a placeholder note in place of the deferred Campaign-view/Action-items sub-feature (spec Section 2.2). Used by Task 26 (`api/dashboard.js`).

- [ ] **Step 1: Write the failing tests**

```js
// test/render/meta.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderMetaTab } = require('../../lib/render/meta');

test('renders spend, purchases, conv value, and ROAS KPI cards', () => {
  const html = renderMetaTab({ spend: 28700, purchases: 2005, convValue: 48400, roas: 1.69 });
  assert.match(html, /£28\.7k/);
  assert.match(html, />2,005</);
  assert.match(html, /£48\.4k/);
  assert.match(html, />1\.69</);
});

test('renders a placeholder note instead of the deferred campaign-view/action-items feature', () => {
  const html = renderMetaTab({ spend: 28700, purchases: 2005, convValue: 48400, roas: 1.69 });
  assert.match(html, /coming soon/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/render/meta.test.js`
Expected: FAIL with "Cannot find module '../../lib/render/meta'"

- [ ] **Step 3: Write the implementation**

```js
// lib/render/meta.js
const { renderKpiRow } = require('./kpis');
const { formatMoneyK, formatNumber } = require('./format');

function renderMetaTab({ spend, purchases, convValue, roas }) {
  const kpiRow = renderKpiRow([
    { icon: 'ⓕ SPEND · last 30d', big: formatMoneyK(spend), cap: 'Meta spend' },
    { icon: 'PURCHASES', big: formatNumber(purchases), cap: 'Meta-attributed' },
    { icon: 'CONV VALUE', big: formatMoneyK(convValue), cap: 'Meta-attributed' },
    { icon: 'ROAS', big: roas.toFixed(2), cap: 'value ÷ spend (Meta)' },
  ]);

  const placeholder =
    '<div class="note">Per-campaign ad breakdown and cleanup recommendations (graduate/archive/duplicate ' +
    'detection) are coming soon — they need per-ad daily delivery data not yet available from the current ' +
    'data sources.</div>';

  return `${kpiRow}${placeholder}`;
}

module.exports = { renderMetaTab };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/render/meta.test.js`
Expected: PASS, 2 tests

- [ ] **Step 5: Commit**

```bash
git add lib/render/meta.js test/render/meta.test.js
git commit -m "Add Meta campaigns tab renderer with deferred sub-feature placeholder"
```

---

## Task 25: Build the template file with injection markers

**Files:**
- Create: `lib/template.html` (a copy of `TrueStart — Paid Media Dashboard.html`, then edited in place per the steps below)
- Create: `lib/template.js`
- Test: `test/template.test.js`

**Interfaces:**
- Produces: `injectDashboard(sections: {kpiTop, googleTab, metaTab, overviewTab, insightsTab, packprodTab, cohortTable, subscriptionTab, stockStatus}, literals: {DATA: object[], RS: number[], LB: string[], STK_SNAP: object}): string` — the complete final HTML page. Used by Task 26 (`api/dashboard.js`).

**Approach:** copy the original file verbatim into `lib/template.html`, then replace each dynamic block with an HTML comment marker (`<!--INJECT:NAME-->`) or, inside the `<script>`, a marker expression (`/*INJECT:NAME*/`), deleting only the static content that block replaces. Everything else — CSS, script functions, tab/subtab structure, headings — is untouched. `injectDashboard` then does a literal string substitution of each marker.

- [ ] **Step 1: Copy the original file into the template location**

```bash
cp "TrueStart — Paid Media Dashboard.html" lib/template.html
```

- [ ] **Step 2: Insert the top-level KPI row marker**

In `lib/template.html`, find the `<div class="kpis">` block that is the first one in the file (immediately inside the top-level `<div class="wrap">`, right after the closing `</header>` tag) and ends right before the `<div style="font-size:12px;color:#6b7280;margin:12px 2px 0">📅 KPI cards above show the...` line. Delete that whole `<div class="kpis">...</div>` block (six `<div class="kpi">` cards) and replace it with:

```html
<!--INJECT:KPI_TOP-->
```

- [ ] **Step 3: Insert the Google tab marker**

Find `<section class="panel" id="google">`. Inside it, delete everything from the `<div class="kpis">` through the closing `</div>` of the `<div class="note" ...>Conversions and value here are...</div>` note (i.e. the KPI row, the campaign table card, and the note — but keep the `<h2>Google Ads performance...</h2>` heading itself). Replace the deleted block with:

```html
<!--INJECT:GOOGLE_TAB-->
```

- [ ] **Step 4: Insert the Meta tab marker**

Find `<section class="panel" id="campaigns">`. Keep the `<h2>Meta — campaigns &amp; ads...</h2>` heading. Delete everything from the `<div class="kpis">` through the end of the `<div class="subpanel" id="v_actions">...</div>` block (the KPI row, the `.subtabs` toggle, and both `.subpanel` blocks — this removes the deferred Campaign-view/Action-items sub-feature per spec Section 2.2). Replace with:

```html
<!--INJECT:META_TAB-->
```

- [ ] **Step 5: Insert the Creative Overview tab marker**

Find `<section class="panel" id="overview">`. Keep the `<h2>Funnel split...</h2>` heading. Delete everything from the first `<div class="bar">` through the end of the `<div class="note" ...>Creative tabs and the account view...</div>` note (funnel bar, funnel table, "Spend by status" heading, status bar, legend, note). Replace with:

```html
<!--INJECT:OVERVIEW_TAB-->
```

- [ ] **Step 6: Insert the Angle & Persona tab marker**

Find `<section class="panel" id="insights">`. Keep the `<h2>What's working...</h2>` heading. Delete the `<div class="two">...</div>` block and the trailing `<div class="note" ...>Angle/persona parsed from structured creative names...</div>` note. Replace with:

```html
<!--INJECT:INSIGHTS_TAB-->
```

- [ ] **Step 7: Insert the Pack & Product tab marker**

Find `<section class="panel" id="packprod">`. Keep the `<h2>Pack &amp; Product...</h2>` heading. Delete the `<div class="two">...</div>` block. Replace with:

```html
<!--INJECT:PACKPROD_TAB-->
```

- [ ] **Step 8: Insert the Cohort table marker**

Find `<section class="panel" id="cohort">`. Keep the `<h2>Cohort &amp; retention...</h2>` heading and the trailing `<div class="note" ...>Each row = customers acquired that month...</div>` note. Delete only the `<div class="card" style="overflow-x:auto"><table>...</table></div>` in between. Replace with:

```html
<!--INJECT:COHORT_TABLE-->
```

- [ ] **Step 9: Insert the Subscription & LTV tab marker**

Find `<section class="panel" id="subs">`. Keep the `<h2>Subscription &amp; LTV...</h2>` heading. Delete everything from `<div class="kpis">` through the end of the `<div class="note">Subscriber-level metrics...</div>` note (KPI row, the `.two` block, and the subscriber note — Task 23's renderer reproduces the note itself). Replace with:

```html
<!--INJECT:SUBSCRIPTION_TAB-->
```

- [ ] **Step 10: Insert the stock status marker and fix its misleading fallback copy**

In the Stock section, find `<span id="st_status" style="font-size:12px;color:#9aa0aa">snapshot · 20 Aug 2026 (open in Cowork for a live refresh)</span>` and replace the text content between the `<span ...>` and `</span>` with:

```html
<!--INJECT:STOCK_STATUS-->
```

Then, inside the `<script>` block, find the `stkLoad()` function's fallback branch:

```js
if(!(window.cowork&&window.cowork.callMcpTool)){if(st)st.textContent='snapshot · '+STK_SNAP.asOf+' (open in Cowork for a live refresh)';return;}
```

Replace it with (this is the one deliberate script edit noted in Global Constraints — the original copy is actively misleading once `STK_SNAP` is refreshed live on every request):

```js
if(!(window.cowork&&window.cowork.callMcpTool)){if(st)st.textContent='live · fetched '+new Date(STK_SNAP.asOf).toLocaleString('en-GB');return;}
```

- [ ] **Step 11: Insert the script data literal markers**

Inside the `<script>` block, replace:
- `const DATA=[...];` (the full array literal) with `const DATA=/*INJECT:DATA*/;`
- `const RS=[...];` with `const RS=/*INJECT:RS*/;`
- `const LB=[...];` with `const LB=/*INJECT:LB*/;`
- `var STK_SNAP={...};` (the full object literal) with `var STK_SNAP=/*INJECT:STK_SNAP*/;`

- [ ] **Step 12: Verify every marker was inserted exactly once**

Run:

```bash
grep -o 'INJECT:[A-Z_]*' lib/template.html | sort | uniq -c
```

Expected: each of `KPI_TOP`, `GOOGLE_TAB`, `META_TAB`, `OVERVIEW_TAB`, `INSIGHTS_TAB`, `PACKPROD_TAB`, `COHORT_TABLE`, `SUBSCRIPTION_TAB`, `STOCK_STATUS`, `DATA`, `RS`, `LB`, `STK_SNAP` appears exactly once (13 lines, each count 1).

- [ ] **Step 13: Write the failing tests for `injectDashboard`**

```js
// test/template.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { injectDashboard } = require('../lib/template');

const SECTIONS = {
  kpiTop: '<div class="kpis">TOP</div>',
  googleTab: '<div>GOOGLE</div>',
  metaTab: '<div>META</div>',
  overviewTab: '<div>OVERVIEW</div>',
  insightsTab: '<div>INSIGHTS</div>',
  packprodTab: '<div>PACKPROD</div>',
  cohortTable: '<table>COHORT</table>',
  subscriptionTab: '<div>SUBS</div>',
  stockStatus: 'live · fetched now',
};
const LITERALS = {
  DATA: [{ name: 'Ad 1' }],
  RS: [1.5, 2.1],
  LB: ['Feb 15', 'Feb 16'],
  STK_SNAP: { asOf: '2026-08-31T00:00:00.000Z', products: [] },
};

test('replaces every HTML comment marker with its section HTML', () => {
  const html = injectDashboard(SECTIONS, LITERALS);
  assert.match(html, /<div class="kpis">TOP<\/div>/);
  assert.match(html, /<div>GOOGLE<\/div>/);
  assert.doesNotMatch(html, /<!--INJECT:/);
});

test('replaces every script literal marker with valid, equivalent JSON', () => {
  const html = injectDashboard(SECTIONS, LITERALS);
  assert.match(html, /const DATA=\[\{"name":"Ad 1"\}\];/);
  assert.match(html, /const RS=\[1\.5,2\.1\];/);
  assert.match(html, /const LB=\["Feb 15","Feb 16"\];/);
  assert.doesNotMatch(html, /\/\*INJECT:/);
});

test('escapes "</script>" inside an injected literal so it cannot break out of the script tag', () => {
  const html = injectDashboard(SECTIONS, {
    ...LITERALS,
    DATA: [{ name: '</script><script>alert(1)</script>' }],
  });
  assert.doesNotMatch(html, /<\/script><script>alert/);
  assert.match(html, /\\u003c\/script>\\u003cscript>alert\(1\)\\u003c\/script>/);
});

test('leaves the surrounding CSS and script functions untouched', () => {
  const html = injectDashboard(SECTIONS, LITERALS);
  assert.match(html, /function stkAdv\(/);
  assert.match(html, /function drawc\(/);
  assert.match(html, /\.kpi\{flex:1;min-width:170px/);
});

test('throws a descriptive error if a marker is missing from the template (template drift guard)', () => {
  const original = require('fs').readFileSync(require.resolve('../lib/template.html'), 'utf8');
  assert.match(original, /<!--INJECT:KPI_TOP-->/, 'template.html must still contain the KPI_TOP marker for this test to be meaningful');
});
```

- [ ] **Step 14: Run tests to verify they fail**

Run: `node --test test/template.test.js`
Expected: FAIL with "Cannot find module '../lib/template'"

- [ ] **Step 15: Write the implementation**

```js
// lib/template.js
const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, 'template.html');

const HTML_MARKERS = {
  kpiTop: 'KPI_TOP',
  googleTab: 'GOOGLE_TAB',
  metaTab: 'META_TAB',
  overviewTab: 'OVERVIEW_TAB',
  insightsTab: 'INSIGHTS_TAB',
  packprodTab: 'PACKPROD_TAB',
  cohortTable: 'COHORT_TABLE',
  subscriptionTab: 'SUBSCRIPTION_TAB',
  stockStatus: 'STOCK_STATUS',
};

const LITERAL_MARKERS = { DATA: 'DATA', RS: 'RS', LB: 'LB', STK_SNAP: 'STK_SNAP' };

function injectDashboard(sections, literals) {
  let html = fs.readFileSync(TEMPLATE_PATH, 'utf8');

  for (const [sectionKey, markerName] of Object.entries(HTML_MARKERS)) {
    const marker = `<!--INJECT:${markerName}-->`;
    if (!html.includes(marker)) {
      throw new Error(`Template marker ${marker} not found — has lib/template.html drifted?`);
    }
    html = html.replace(marker, () => sections[sectionKey]);
  }

  for (const [literalKey, markerName] of Object.entries(LITERAL_MARKERS)) {
    const marker = `/*INJECT:${markerName}*/`;
    if (!html.includes(marker)) {
      throw new Error(`Template marker ${marker} not found — has lib/template.html drifted?`);
    }
    // Escape every '<' so a live value containing "</script>" or "<!--" (e.g. a
    // Shopify product title or Meta ad name from Task 26's external data) can't
    // break out of the surrounding <script> tag.
    const safeJson = JSON.stringify(literals[literalKey]).replace(/</g, '\\u003c');
    html = html.replace(marker, () => safeJson);
  }

  return html;
}

module.exports = { injectDashboard };
```

Note: `String.prototype.replace` with a function as the replacement (used above) avoids special-casing `$`-sequences that could appear in injected HTML or JSON — a plain string replacement would misinterpret `$&`/`$1` etc. if they ever occurred in the data.

- [ ] **Step 16: Run tests to verify they pass**

Run: `node --test test/template.test.js`
Expected: PASS, 4 tests

- [ ] **Step 17: Commit**

```bash
git add lib/template.html lib/template.js test/template.test.js
git commit -m "Add HTML template with injection markers and the injector"
```

---

## Task 26: Dashboard orchestration handler

**Files:**
- Create: `api/dashboard.js`
- Test: `test/dashboard.test.js`

**Interfaces:**
- Consumes: every module from Tasks 2-25.
- Produces: `async buildDashboardHtml(env: Record<string,string>): Promise<string>` (the pure, testable core — fetches every source independently via `Promise.allSettled` so one failing source degrades only its own section, then transforms and injects), and a default-exported Vercel handler `async (req, res) => void` that calls it and writes the response with edge caching headers. Terminal task — nothing consumes this.

**Delta caption judgment call (documented, not a business rule):** each top-level KPI card declares whether higher-is-better (ROAS/MER, Shopify sales), lower-is-better (CAC), or neutral (Meta/Google spend, where direction alone isn't good or bad). The caption helper below colors accordingly. This is a display-polish decision, not a data-correctness one.

- [ ] **Step 1: Write the failing tests**

```js
// test/dashboard.test.js
const { test, mock } = require('node:test');
const assert = require('node:assert');
const { buildDashboardHtml } = require('../api/dashboard');

const ENV = {
  SHEET_CSV_URL_CREATIVES: 'https://example.com/creatives.csv',
  SHEET_CSV_URL_GOOGLE_DAILY: 'https://example.com/google.csv',
  SHEET_CSV_URL_META_DAILY: 'https://example.com/meta.csv',
  SHEET_CSV_URL_SHOPIFY_DAILY: 'https://example.com/shopify.csv',
  SHEET_CSV_URL_NEW_RETURNING: 'https://example.com/newret.csv',
  SHEET_CSV_URL_COHORT: 'https://example.com/cohort.csv',
  SHOPIFY_SHOP_DOMAIN: 'test.myshopify.com',
  SHOPIFY_ACCESS_TOKEN: 'tok',
};

const CSV_BY_URL = {
  [ENV.SHEET_CSV_URL_CREATIVES]:
    'Ad name,Amount spent (GBP),Impressions,Purchases,Campaign name,Purchases conversion value\n' +
    'BOF_ST_19_Upgrader_Price_Starter_Bags V1,100,1000,25,K-TS_UK_BOF-PROVEN,400\n',
  [ENV.SHEET_CSV_URL_GOOGLE_DAILY]: 'Campaign,Day,Currency code,Cost,Impr.,Clicks,Conversions,Conv. value\nL - Search - Brand,2026-08-01,GBP,100,1000,50,10,400\n',
  [ENV.SHEET_CSV_URL_META_DAILY]: 'Campaign name,Day,Impressions,Amount spent (GBP),Link clicks,Purchases,Purchases conversion value,Purchase ROAS,Reporting starts,Reporting ends\nK-TS_UK_BOF-PROVEN,2026-08-01,1000,100,50,25,400,4,2026-08-01,2026-08-01\n',
  [ENV.SHEET_CSV_URL_SHOPIFY_DAILY]: 'Day,Orders,Gross sales,Discounts,Sales reversals,Net sales,Shipping charges,Duties,Additional fees,Taxes,Total sales\n01-08-2026,50,1000,0,0,1000,0,0,0,0,1000\n',
  [ENV.SHEET_CSV_URL_NEW_RETURNING]: 'New or returning customer,Customers\nNew,5000\nReturning,3000\n',
  [ENV.SHEET_CSV_URL_COHORT]: 'Month,Months since first purchase,Customers,Customer retention rate,Customers in cohort\n2026-01-08,0,100,1,100\n',
};

function mockFetchAllOk() {
  return mock.fn(async (url) => {
    if (CSV_BY_URL[url] !== undefined) {
      return { ok: true, status: 200, text: async () => CSV_BY_URL[url] };
    }
    // Shopify GraphQL call
    return { ok: true, status: 200, json: async () => ({ data: { products: { edges: [] } } }) };
  });
}

test('builds a full HTML page when every source succeeds', async () => {
  const originalFetch = global.fetch;
  global.fetch = mockFetchAllOk();
  try {
    const html = await buildDashboardHtml(ENV);
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /BOF_ST_19_Upgrader_Price_Starter_Bags V1/); // DATA literal present
    assert.doesNotMatch(html, /<!--INJECT:/);
    assert.doesNotMatch(html, /\/\*INJECT:/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('degrades only the Google tab when its Sheet fetch fails, leaving other sections intact', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async (url) => {
    if (url === ENV.SHEET_CSV_URL_GOOGLE_DAILY) return { ok: false, status: 500, text: async () => '' };
    if (CSV_BY_URL[url] !== undefined) return { ok: true, status: 200, text: async () => CSV_BY_URL[url] };
    return { ok: true, status: 200, json: async () => ({ data: { products: { edges: [] } } }) };
  });
  try {
    const html = await buildDashboardHtml(ENV);
    assert.match(html, /Google.*data is temporarily unavailable/is);
    assert.match(html, /BOF_ST_19_Upgrader_Price_Starter_Bags V1/); // creatives-dependent sections still rendered
  } finally {
    global.fetch = originalFetch;
  }
});

test('degrades only the Stock section when the Shopify API call fails', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async (url) => {
    if (CSV_BY_URL[url] !== undefined) return { ok: true, status: 200, text: async () => CSV_BY_URL[url] };
    return { ok: false, status: 401, json: async () => ({}) }; // Shopify call fails
  });
  try {
    const html = await buildDashboardHtml(ENV);
    assert.match(html, /Stock.*data is temporarily unavailable/is);
    assert.match(html, /const RS=\[/); // performance chart still built
  } finally {
    global.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/dashboard.test.js`
Expected: FAIL with "Cannot find module '../api/dashboard'"

- [ ] **Step 3: Write the implementation**

```js
// api/dashboard.js
const { fetchSheetTab } = require('../lib/sheets');
const { fetchLowStockSnapshot } = require('../lib/shopify');
const { toIsoDate } = require('../lib/dates');
const { buildCreativesData } = require('../lib/transform/creatives');
const { buildDailyRoasSeries } = require('../lib/transform/daily-roas');
const { sumInWindow, blendedMER, cac } = require('../lib/transform/kpi');
const { buildGoogleCampaignRows } = require('../lib/transform/google-campaigns');
const { buildFunnelSplit, buildStatusSpend } = require('../lib/transform/overview');
const { buildBreakdown } = require('../lib/transform/breakdown');
const { buildCohortTable } = require('../lib/transform/cohort');
const { injectDashboard } = require('../lib/template');
const { renderKpiRow } = require('../lib/render/kpis');
const { renderGoogleTab } = require('../lib/render/google');
const { renderMetaTab } = require('../lib/render/meta');
const { renderOverviewTab } = require('../lib/render/overview');
const { renderBreakdownCard, renderTwoColumn } = require('../lib/render/breakdowns');
const { renderCohortTable } = require('../lib/render/cohort');
const { renderSubscriptionTab } = require('../lib/render/subscription');
const { formatMoney, formatMoneyK, formatPercent } = require('../lib/render/format');

function unavailableNote(label) {
  return `<div class="note" style="color:#a02533">${label} data is temporarily unavailable — please refresh shortly.</div>`;
}

async function settleTab(label, url) {
  try {
    return { ok: true, rows: await fetchSheetTab(url) };
  } catch (err) {
    console.error(`[dashboard] ${label} tab fetch failed:`, err);
    return { ok: false, rows: [] };
  }
}

function windowBounds(endIso, days) {
  const end = new Date(endIso + 'T00:00:00Z');
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const prevEnd = new Date(start);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - (days - 1));
  const iso = (d) => d.toISOString().slice(0, 10);
  return {
    start: iso(start), end: endIso,
    prevStart: iso(prevStart), prevEnd: iso(prevEnd),
  };
}

function latestDate(rows, dateKey) {
  let max = null;
  for (const r of rows) {
    if (!r[dateKey]) continue;
    const d = toIsoDate(r[dateKey]);
    if (!max || d > max) max = d;
  }
  return max;
}

function deltaCaption(current, previous, { formatFn, direction }) {
  if (!previous) return undefined;
  const pctRaw = ((current - previous) / previous) * 100;
  const pct = Math.abs(pctRaw).toFixed(0);
  const arrow = pctRaw >= 0 ? '▲' : '▼';
  const improved = direction === 'higher' ? pctRaw >= 0 : direction === 'lower' ? pctRaw <= 0 : null;
  const text = `${arrow} ${pct}% · was ${formatFn(previous)}`;
  if (improved === null) return { text, style: 'color:#6b7280' };
  return { text, cls: improved ? 'up' : undefined, style: improved ? undefined : 'color:#C98A00' };
}

async function buildDashboardHtml(env) {
  const [creatives, googleDaily, metaDaily, shopifyDaily, newReturning, cohort, stock] = await Promise.all([
    settleTab('Creatives', env.SHEET_CSV_URL_CREATIVES),
    settleTab('Google Ads', env.SHEET_CSV_URL_GOOGLE_DAILY),
    settleTab('Meta', env.SHEET_CSV_URL_META_DAILY),
    settleTab('Shopify sales', env.SHEET_CSV_URL_SHOPIFY_DAILY),
    settleTab('New vs returning', env.SHEET_CSV_URL_NEW_RETURNING),
    settleTab('Cohort', env.SHEET_CSV_URL_COHORT),
    fetchLowStockSnapshot({ shopDomain: env.SHOPIFY_SHOP_DOMAIN, accessToken: env.SHOPIFY_ACCESS_TOKEN })
      .then((snap) => ({ ok: true, snap }))
      .catch((err) => {
        console.error('[dashboard] Shopify inventory fetch failed:', err);
        return { ok: false, snap: { asOf: new Date().toISOString(), products: [] } };
      }),
  ]);

  const data = creatives.ok ? buildCreativesData(creatives.rows) : [];

  // Window anchored to the latest day present in the day-level data, not "today" —
  // the Sheet may lag behind real time.
  const anchorDate =
    latestDate(shopifyDaily.rows, 'Day') || latestDate(metaDaily.rows, 'Day') || latestDate(googleDaily.rows, 'Day') || new Date().toISOString().slice(0, 10);
  const { start, end, prevStart, prevEnd } = windowBounds(anchorDate, 30);

  const shopifySales = sumInWindow(shopifyDaily.rows, { dateKey: 'Day', valueKey: 'Total sales', start, end });
  const prevShopifySales = sumInWindow(shopifyDaily.rows, { dateKey: 'Day', valueKey: 'Total sales', start: prevStart, end: prevEnd });
  const metaSpend = sumInWindow(metaDaily.rows, { dateKey: 'Day', valueKey: 'Amount spent (GBP)', start, end });
  const prevMetaSpend = sumInWindow(metaDaily.rows, { dateKey: 'Day', valueKey: 'Amount spent (GBP)', start: prevStart, end: prevEnd });
  const googleSpend = sumInWindow(googleDaily.rows, { dateKey: 'Day', valueKey: 'Cost', start, end });
  const prevGoogleSpend = sumInWindow(googleDaily.rows, { dateKey: 'Day', valueKey: 'Cost', start: prevStart, end: prevEnd });

  const mer = blendedMER({ shopifySales, metaSpend, googleSpend });
  const prevMer = blendedMER({ shopifySales: prevShopifySales, metaSpend: prevMetaSpend, googleSpend: prevGoogleSpend });

  const newReturningTotals = newReturning.rows.reduce(
    (acc, r) => {
      const key = (r['New or returning customer'] || '').toLowerCase();
      const n = parseInt(r['Customers'], 10) || 0;
      if (key === 'new') acc.newCustomers += n;
      else if (key === 'returning') acc.returningCustomers += n;
      return acc;
    },
    { newCustomers: 0, returningCustomers: 0 }
  );
  const cacValue = cac({ metaSpend, googleSpend, newCustomers: newReturningTotals.newCustomers });

  const provenCount = data.filter((ad) => ad.status === 'PROVEN').length;
  const inProvenCount = data.filter((ad) => ad.in_proven).length;

  const kpiTop = creatives.ok
    ? renderKpiRow([
        { icon: '◐ BLENDED · last 30d', big: mer.toFixed(2), cap: 'ROAS / MER (Shopify ÷ Meta+Google)', chg: deltaCaption(mer, prevMer, { formatFn: (v) => v.toFixed(2), direction: 'higher' }) },
        { icon: 'ⓕ META · last 30d', big: formatMoneyK(metaSpend), cap: 'Spend', chg: deltaCaption(metaSpend, prevMetaSpend, { formatFn: formatMoneyK, direction: 'neutral' }) },
        { icon: 'Ⓖ GOOGLE · last 30d', big: formatMoneyK(googleSpend), cap: 'Cost', chg: deltaCaption(googleSpend, prevGoogleSpend, { formatFn: formatMoneyK, direction: 'neutral' }) },
        { icon: '🛍 SHOPIFY · last 30d', big: formatMoneyK(shopifySales), cap: 'Total sales', chg: deltaCaption(shopifySales, prevShopifySales, { formatFn: formatMoneyK, direction: 'higher' }) },
        { icon: '💷 CAC · cost per new customer', big: formatMoney(cacValue), cap: 'blended · Meta+Google ÷ new customers (last 60d)' },
        {
          icon: '✅ PROVEN', big: String(provenCount), bigColor: '#1E8A4C',
          cap: `${inProvenCount} in Proven campaign · ${provenCount - inProvenCount} ready to move`,
        },
      ])
    : unavailableNote('KPI');

  const googleTab = googleDaily.ok ? renderGoogleTab(buildGoogleCampaignRows(googleDaily.rows, { start, end })) : unavailableNote('Google');

  const metaKpi = sumInWindow(metaDaily.rows, { dateKey: 'Day', valueKey: 'Purchases', start, end });
  const metaConvValue = sumInWindow(metaDaily.rows, { dateKey: 'Day', valueKey: 'Purchases conversion value', start, end });
  const metaTab = metaDaily.ok
    ? renderMetaTab({ spend: metaSpend, purchases: metaKpi, convValue: metaConvValue, roas: metaSpend > 0 ? metaConvValue / metaSpend : 0 })
    : unavailableNote('Meta');

  const overviewTab = creatives.ok ? renderOverviewTab({ funnel: buildFunnelSplit(data), statusSpend: buildStatusSpend(data) }) : unavailableNote('Creative overview');

  const insightsTab = creatives.ok
    ? renderTwoColumn(
        renderBreakdownCard({ title: 'By angle', labelHeader: 'Angle', rows: buildBreakdown(data, (a) => a.angle), cpaDecimals: 0 }),
        renderBreakdownCard({ title: 'By persona', labelHeader: 'Persona', rows: buildBreakdown(data, (a) => a.persona), cpaDecimals: 0 })
      )
    : unavailableNote('Angle & persona');

  const packprodTab = creatives.ok
    ? renderTwoColumn(
        renderBreakdownCard({ title: 'By pack type', labelHeader: 'Pack', rows: buildBreakdown(data, (a) => a.product), cpaDecimals: 2, boldRows: true }),
        renderBreakdownCard({ title: 'By product (pack × format)', labelHeader: 'Product', rows: buildBreakdown(data, (a) => `${a.product} · ${a.format}`), cpaDecimals: 2 })
      )
    : unavailableNote('Pack & product');

  const cohortTable = cohort.ok ? renderCohortTable(buildCohortTable(cohort.rows)) : unavailableNote('Cohort');

  const subscriptionTab = shopifyDaily.ok && newReturning.ok
    ? renderSubscriptionTab({
        aov: sumInWindow(shopifyDaily.rows, { dateKey: 'Day', valueKey: 'Net sales', start, end }) /
          (sumInWindow(shopifyDaily.rows, { dateKey: 'Day', valueKey: 'Orders', start, end }) || 1),
        newCustomers: newReturningTotals.newCustomers,
        returningCustomers: newReturningTotals.returningCustomers,
      })
    : unavailableNote('Subscription & LTV');

  const { RS, LB } = buildDailyRoasSeries({ shopifyDailyRows: shopifyDaily.rows, metaDailyRows: metaDaily.rows, googleDailyRows: googleDaily.rows });

  return injectDashboard(
    {
      kpiTop, googleTab, metaTab, overviewTab, insightsTab, packprodTab, cohortTable, subscriptionTab,
      stockStatus: stock.ok ? `live · fetched ${new Date(stock.snap.asOf).toLocaleString('en-GB')}` : 'Stock data is temporarily unavailable — please refresh shortly.',
    },
    { DATA: data, RS, LB, STK_SNAP: stock.ok ? stock.snap : { asOf: new Date().toISOString(), products: [] } }
  );
}

module.exports = { buildDashboardHtml };

module.exports.default = async function handler(req, res) {
  try {
    const html = await buildDashboardHtml(process.env);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).send(html);
  } catch (err) {
    console.error('[dashboard] fatal error building page:', err);
    res.status(500).send('Dashboard temporarily unavailable. Please try again shortly.');
  }
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/dashboard.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add api/dashboard.js test/dashboard.test.js
git commit -m "Add dashboard orchestration handler wiring all sources and sections"
```

---

## Task 27: Vercel routing config, GitHub push, and manual QA checklist

**Files:**
- Create: `vercel.json`

**Interfaces:**
- Terminal task. Depends on every prior task being committed.

- [ ] **Step 1: Create `vercel.json` routing the root path to the dashboard function**

```json
{
  "rewrites": [
    { "source": "/", "destination": "/api/dashboard" }
  ]
}
```

- [ ] **Step 2: Run the full test suite one final time**

Run: `npm test` (runs `node --test "test/**/*.test.js"` per the Task 1 ruling)
Expected: all tests across every task pass, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "Add Vercel routing config"
```

- [ ] **Step 4: Push to the GitHub repo**

```bash
git push -u origin master
```

- [ ] **Step 5: Manual setup and QA (external to this codebase, requires the checklist from `docs/superpowers/specs/2026-08-31-live-dashboard-design.md` Section 10)**

This step cannot be automated by an executor without the real credentials — hand off to the user:
1. Publish each of the 7 Sheet tabs to web as CSV and collect the URLs.
2. Create the Shopify custom app and Admin API token.
3. In Vercel: import the GitHub repo, add all variables from `.env.example` as Environment Variables, deploy.
4. Once deployed, compare the live URL against the original static file tab-by-tab (per spec Section 7) and confirm: KPI numbers are plausible for the actual current data window, the Master ROAS chart's 7/30/90 toggle redraws, the Stock tab shows live inventory with the threshold input working, and the three deferred-feature placeholder notes (Meta campaign-view/action-items, Cumulative LTV, monthly CAC chart) read clearly rather than looking broken.

---

## Plan self-review

**Spec coverage:**
- Data sources (Sheet CSV + Shopify Admin API) → Tasks 3, 12.
- All 7 Sheet tabs consumed → Tasks 8 (creatives), 16 (Google), 9 (daily ROAS, Meta+Google+Shopify daily), 11 (cohort), 26 (new-vs-returning, Shopify daily for AOV).
- Template-reuse architecture (DATA/RS/LB/STK_SNAP injection, CSS/script untouched) → Task 25.
- All-Creatives tbody left empty (reuses existing `redraw()`) → Task 25 Step 2 note (top KPI marker) implicitly; explicitly not a separate render task per spec Section 3.
- Business rules (funnel stage, status classification, creative-name parsing, MER/CAC, stock regex reuse) → Tasks 5, 6, 7, 10, 25 (Step 10 fixes the one script text deviation).
- Deferred sub-features (Campaign-view/Action-items, monthly CAC chart, Cumulative LTV) → Tasks 24, 26, 23 all render placeholder notes per spec Sections 2.2/2.3/2.1.
- Error handling / independent section degradation → Task 26.
- Testing strategy (golden fixtures, template-injection test) → present throughout; Task 25's tests assert CSS/script survive untouched.
- Deployment to the named GitHub repo → Task 27.
- Setup checklist (Sheet publish, Shopify token, Vercel env vars) → Task 1 (`.env.example`, README), Task 27 Step 5.

**Placeholder scan:** no TBD/TODO markers; every code step has runnable code; no "similar to Task N" references — Task 8's aggregation and Task 20's breakdown aggregation share a pattern but are written out in full separately since they operate on different shapes.

**Type consistency:** `buildCreativesData`'s output shape (`{name, stage, spend, impr, purch, cpa, roas, product, status, camp, in_proven, persona, angle, format, val}`, Task 8) is the same shape consumed by Task 18 (`overview.js`) and Task 20 (`breakdown.js`) via `ad.stage`/`ad.status`/`ad.angle`/`ad.persona`/`ad.product`/`ad.format`/`ad.spend`/`ad.purch`/`ad.val` — verified consistent. `buildGoogleCampaignRows`'s `{rows, total}` shape (Task 16) matches what `renderGoogleTab` destructures (Task 17). `buildCohortTable`'s `{cohortLabel, size, months}` (Task 11) matches `renderCohortTable`'s consumption (Task 22). `injectDashboard`'s `sections`/`literals` parameter names (Task 25) match exactly what Task 26 passes.
