// Regression cover for the second review round: a blended ratio built from
// sources with different coverage, a BOF tab that could strand an "unavailable"
// message, the wrong month flagged partial, and a frozen comparison label.
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
  SHEET_CSV_URL_SHOPIFY_NEW_CUSTOMERS_MONTHLY: 'https://example.com/cac-monthly.csv',
  SHOPIFY_SHOP_DOMAIN: 'test.myshopify.com',
  SHOPIFY_ACCESS_TOKEN: 'tok',
};

function days(from, to, fmt) {
  const out = [];
  for (const d = new Date(from); d <= new Date(to); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(fmt(d.toISOString().slice(0, 10)));
  }
  return out.join('');
}

const shopifyRows = (from, to) =>
  'Day,Orders,Gross sales,Discounts,Sales reversals,Net sales,Shipping charges,Duties,Additional fees,Taxes,Total sales\n' +
  days(from, to, (d) => `${d},10,1000,0,0,1000,0,0,0,0,1000\n`);
const metaRows = (from, to) =>
  'Campaign name,Day,Impressions,Amount spent (GBP),Link clicks,Purchases,Purchases conversion value,Purchase ROAS,Reporting starts,Reporting ends\n' +
  days(from, to, (d) => `K-BOF_PDP-CBO,${d},1000,100,50,5,400,4,${d},${d}\n`);
const googleRows = (from, to) =>
  'Campaign,Day,Currency code,Cost,Impr.,Clicks,Conversions,Conv. value\n' +
  days(from, to, (d) => `L - Search - Brand,${d},GBP,10,100,5,1,40\n`);

// Meta and Google span the whole window; Shopify starts late. Every source is
// individually fine, so only the cross-source ratio is compromised.
const SKEWED = {
  [ENV.SHEET_CSV_URL_CREATIVES]:
    'Reporting starts,Reporting ends,Ad name,Amount spent (GBP),Impressions,Purchases,Campaign name,Purchases conversion value\n' +
    '2026-09-01,2026-09-05,BOF_Ad,100,1000,10,K-BOF_PDP-CBO,400\n',
  [ENV.SHEET_CSV_URL_GOOGLE_DAILY]: googleRows('2026-09-01', '2026-09-16'),
  [ENV.SHEET_CSV_URL_META_DAILY]: metaRows('2026-09-01', '2026-09-16'),
  [ENV.SHEET_CSV_URL_SHOPIFY_DAILY]: shopifyRows('2026-09-09', '2026-09-16'),
  [ENV.SHEET_CSV_URL_NEW_RETURNING]: 'New or returning customer,Customers\nNew,100\nReturning,50\n',
  [ENV.SHEET_CSV_URL_COHORT]:
    'Month,Months since first purchase,Customers,Customer retention rate,Customers in cohort\n2026-09-05,0,200,1,200\n',
  [ENV.SHEET_CSV_URL_SHOPIFY_NEW_CUSTOMERS_MONTHLY]:
    'Month,New customers,Returning customers\n2026-08-01,100,40\n2026-09-01,200,80\n',
};

const ALIGNED = { ...SKEWED, [ENV.SHEET_CSV_URL_SHOPIFY_DAILY]: shopifyRows('2026-09-01', '2026-09-16') };

async function render(query, csv) {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async (url) => {
    if (csv[url] !== undefined) return { ok: true, status: 200, text: async () => csv[url] };
    return { ok: true, status: 200, json: async () => ({ data: { products: { edges: [] } } }) };
  });
  try {
    return await buildDashboardHtml(ENV, query);
  } finally {
    global.fetch = originalFetch;
  }
}

const merOf = (html) => html.match(/BLENDED[^<]*<\/div><div class="big"[^>]*>([^<]*)</)[1];

// --- 1. Blended ratio across mismatched coverage ---------------------------

test('MER is withheld when its sources do not cover the same days', async () => {
  // Shopify starts 09 Sep; Meta and Google start 01 Sep. Dividing 8 days of
  // sales by 16 days of spend is not a blended return, it is a meaningless ratio.
  const html = await render({ from: '2026-09-01', to: '2026-09-16' }, SKEWED);
  assert.strictEqual(merOf(html), '—');
  assert.match(html, /sources cover different parts of this range/);
});

test('MER still renders when every source covers the range', async () => {
  const html = await render({ from: '2026-09-01', to: '2026-09-16' }, ALIGNED);
  assert.match(merOf(html), /^\d+\.\d\d$/, 'a fully covered range must still produce a number');
  assert.doesNotMatch(html, /sources cover different parts of this range/);
});

test('a single-source total is kept but says which days it actually covers', async () => {
  const html = await render({ from: '2026-09-01', to: '2026-09-16' }, SKEWED);
  // Shopify's own total is true for the days it holds, so it is shown, labelled.
  assert.match(html, /Total sales — only 2026-09-09 to 2026-09-16 of the selected range/);
  // Meta covers the range fully and must not be labelled partial.
  assert.doesNotMatch(html, /Spend — only/);
});

// --- 2. BOF must not strand an unavailable message ------------------------

test('the BOF tab fetches when the snapshot dates match but the server rejected it', async () => {
  const tpl = require('fs').readFileSync(require.resolve('../lib/template.html'), 'utf8');
  // Skipping on matching dates alone left a rejected (stale or wrong-metric)
  // snapshot showing "unavailable" with nothing ever replacing it.
  assert.match(tpl, /if\(snapshotMatches&&RANGE\.snapshotRendered\)return;/);
  assert.doesNotMatch(tpl, /if\(snapshotMatches\)return;/);
});

test('the page tells the client whether the snapshot actually rendered', async () => {
  const html = await render({ days: '7' }, ALIGNED);
  assert.match(html, /"snapshotRendered":(true|false)/);
});

// --- 3. The partial month must follow the data, not the selection ---------

test('selecting an earlier month does not mark that month partial', async () => {
  // Data runs to 16 Sep, so September is the in-progress month. Selecting August
  // used to flag August "(to date)" and present incomplete September as complete.
  const html = await render({ from: '2026-08-01', to: '2026-08-31' }, ALIGNED);
  assert.doesNotMatch(html, />August \(to date\)</);
  assert.match(html, />September \(to date\)</);
});

test('the in-progress month is flagged regardless of the selected window', async () => {
  const html = await render({ from: '2026-09-01', to: '2026-09-16' }, ALIGNED);
  assert.match(html, />September \(to date\)</);
});

// --- 4. Comparison wording must follow the selection ----------------------

test('the header comparison label matches the selected length', async () => {
  for (const [days, label] of [[7, 'previous 7d'], [30, 'previous 30d'], [90, 'previous 90d']]) {
    const html = await render({ days: String(days) }, ALIGNED);
    assert.match(html, new RegExp(`deltas vs ${label} `), `preset ${days}`);
  }
});

test('a custom range gets its own comparison length, not a frozen 30d', async () => {
  const html = await render({ from: '2026-09-10', to: '2026-09-16' }, ALIGNED);
  assert.match(html, /deltas vs previous 7d /);
  assert.doesNotMatch(html, /deltas vs previous 30d/);
});

// --- Kill KPI now follows the filter --------------------------------------

test('the Kill card is addressable so a range fetch can update it', async () => {
  const html = await render({ days: '30' }, ALIGNED);
  assert.match(html, /id="kpi-kill"/);
  assert.match(html, /id="kpi-kill-cap"/);
  const tpl = require('fs').readFileSync(require.resolve('../lib/template.html'), 'utf8');
  // The range endpoint already returns counts; the tab now applies them.
  assert.match(tpl, /killBig\.textContent=String\(d\.counts\.KILL\)/);
});
