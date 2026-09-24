// Regression cover for six defects a code review found after the global date
// filter shipped. The original 351 tests all passed while every one of these was
// live, so each test here pins the specific behaviour that was wrong.
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

// Sixteen consecutive days so a 4-day window has a genuine 4-day predecessor,
// and so a 90-day selection has more than 30 points to plot.
function days(from, to, fmt) {
  const out = [];
  for (let d = new Date(from); d <= new Date(to); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(fmt(d.toISOString().slice(0, 10)));
  }
  return out.join('');
}

const SHOPIFY =
  'Day,Orders,Gross sales,Discounts,Sales reversals,Net sales,Shipping charges,Duties,Additional fees,Taxes,Total sales\n' +
  days('2026-09-01', '2026-09-16', (d) => `${d},10,1000,0,0,1000,0,0,0,0,1000\n`);
const META =
  'Campaign name,Day,Impressions,Amount spent (GBP),Link clicks,Purchases,Purchases conversion value,Purchase ROAS,Reporting starts,Reporting ends\n' +
  days('2026-09-01', '2026-09-16', (d) => `K-BOF_PDP-CBO,${d},1000,100,50,5,400,4,${d},${d}\n`);
const GOOGLE =
  'Campaign,Day,Currency code,Cost,Impr.,Clicks,Conversions,Conv. value\n' +
  days('2026-09-01', '2026-09-16', (d) => `L - Search - Brand,${d},GBP,10,100,5,1,40\n`);

const CREATIVES =
  'Reporting starts,Reporting ends,Ad name,Amount spent (GBP),Impressions,Purchases,Campaign name,Purchases conversion value\n' +
  '2026-09-01,2026-09-05,BOF_Early_Ad,100,1000,10,K-BOF_PDP-CBO,400\n' +
  '2026-09-06,2026-09-10,BOF_Mid_Ad,200,1000,10,K-BOF_PDP-CBO,400\n';

const BASE_CSV = {
  [ENV.SHEET_CSV_URL_CREATIVES]: CREATIVES,
  [ENV.SHEET_CSV_URL_GOOGLE_DAILY]: GOOGLE,
  [ENV.SHEET_CSV_URL_META_DAILY]: META,
  [ENV.SHEET_CSV_URL_SHOPIFY_DAILY]: SHOPIFY,
  // 100 new customers, not thousands: with a large denominator every candidate CAC
  // rounds to £0 and the comparison below could not fail even when the window was wrong.
  [ENV.SHEET_CSV_URL_NEW_RETURNING]: 'New or returning customer,Customers\nNew,100\nReturning,50\n',
  [ENV.SHEET_CSV_URL_COHORT]:
    'Month,Months since first purchase,Customers,Customer retention rate,Customers in cohort\n' +
    '2026-03-05,0,100,1,100\n2026-09-05,0,200,1,200\n',
  [ENV.SHEET_CSV_URL_SHOPIFY_NEW_CUSTOMERS_MONTHLY]: 'Month,New customers,Returning customers\n2026-09-01,200,80\n',
};

async function render(query, csv = BASE_CSV) {
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

const literal = (html, name) => JSON.parse(html.match(new RegExp(`const ${name}=(\\[[^;]*\\]);`))[1]);

// --- 1. Performance chart -------------------------------------------------

test('the chart plots every day of the selection, not just the last 30', async () => {
  const html = await render({ from: '2026-09-01', to: '2026-09-16' });
  const RS = literal(html, 'RS');
  assert.strictEqual(RS.length, 16, 'all 16 selected days must be plotted');
});

test('the chart is drawn without a hardcoded day count', async () => {
  const tpl = require('fs').readFileSync(require.resolve('../lib/template.html'), 'utf8');
  assert.doesNotMatch(tpl, /drawc\(30\)/, 'drawc must not be pinned to 30 points');
  assert.match(tpl, /drawc\(\)/);
});

test("the chart's comparison line comes from the preceding period, not from inside the selection", async () => {
  // 09–16 Sep selected; the comparison must be 01–08 Sep, which is real data here.
  const html = await render({ from: '2026-09-09', to: '2026-09-16' });
  const RS = literal(html, 'RS');
  const PRS = literal(html, 'PRS');
  assert.strictEqual(RS.length, 8);
  assert.strictEqual(PRS.length, 8, 'the preceding period must supply its own series');
  const tpl = require('fs').readFileSync(require.resolve('../lib/template.html'), 'utf8');
  // The old bug sliced the comparison out of RS itself.
  assert.doesNotMatch(tpl, /var p=RS\.slice/);
  assert.match(tpl, /var p=PRS/);
});

// --- 2. CAC period mixing -------------------------------------------------

test('CAC does not change when a historical range is selected, because its denominator cannot', async () => {
  // The customer count is an undated "as of now" 90-day total, so pairing it with
  // a historical spend window would invent a ratio that never existed.
  const recent = await render({ from: '2026-09-10', to: '2026-09-16' });
  const historical = await render({ from: '2026-09-01', to: '2026-09-04' });
  const cacOf = (html) => html.match(/💷 CAC · cost per new customer<\/div><div class="big">([^<]*)</)[1];
  assert.strictEqual(cacOf(recent), cacOf(historical));
});

test('the CAC card states that its window is fixed rather than selected', async () => {
  const html = await render({ from: '2026-09-01', to: '2026-09-04' });
  assert.match(html, /blended · fixed 90-day window — not the selected range/);
});

// --- 3. Cohort filtering --------------------------------------------------

test('only cohorts acquired in months overlapping the range are shown', async () => {
  const html = await render({ from: '2026-09-01', to: '2026-09-16' });
  assert.match(html, /Sep 2026/);
  assert.doesNotMatch(html, /Mar 2026/, 'a March cohort must not appear in a September window');
});

test('the caption reports how many cohorts were hidden rather than overstating coverage', async () => {
  const html = await render({ from: '2026-09-01', to: '2026-09-16' });
  assert.match(html, /1 cohort\(s\) acquired in months overlapping/);
  assert.match(html, /\(1 outside it hidden\)/);
});

test('a range with no overlapping cohort says so instead of rendering an empty table', async () => {
  const html = await render({ from: '2026-09-01', to: '2026-09-04' }, {
    ...BASE_CSV,
    [ENV.SHEET_CSV_URL_COHORT]:
      'Month,Months since first purchase,Customers,Customer retention rate,Customers in cohort\n2025-03-05,0,100,1,100\n',
  });
  assert.match(html, /No customer cohort was acquired in a month overlapping/);
});

// --- 4. BOF table vs Kill KPI --------------------------------------------

test('the Kill card names the window it actually counted when that is not the selection', async () => {
  const html = await render({ from: '2026-09-01', to: '2026-09-16' });
  // With no snapshot available in this fixture the card degrades; either way it
  // must never imply it counted the selected range.
  assert.doesNotMatch(html, /🛑 KILL · last 7 days<\/div><div class="big">\d+<\/div><div class="cap">BOF ads meeting their campaign kill rules<\/div>/);
});

test('the BOF tab compares real snapshot dates rather than assuming a 7-day preset matches', async () => {
  const tpl = require('fs').readFileSync(require.resolve('../lib/template.html'), 'utf8');
  assert.doesNotMatch(tpl, /RANGE\.days===7/, 'a 7-day preset does not imply the snapshot covers those days');
  assert.match(tpl, /RANGE\.snapshotStart===RANGE\.start&&RANGE\.snapshotEnd===RANGE\.end/);
});

// --- 5. Incomplete history must not look like a performance change --------

test('a period the source does not fully cover shows no comparison arrow', async () => {
  // Data starts 2026-09-01; selecting 05–16 Sep gives a preceding period
  // (24 Aug – 04 Sep) the sources only partly cover.
  const html = await render({ from: '2026-09-05', to: '2026-09-16' });
  assert.match(html, /no comparison — incomplete history/);
});

test('a fully covered period still gets its arrow', async () => {
  // 09–16 Sep against 01–08 Sep: both fully present.
  const html = await render({ from: '2026-09-09', to: '2026-09-16' });
  assert.match(html, /▲|▼/);
});

test('partial coverage is announced as well as gated', async () => {
  const html = await render({ from: '2026-08-01', to: '2026-09-16' });
  assert.match(html, /Partial coverage for this range/);
  assert.match(html, /no comparison — incomplete history/);
});

// --- 6. All Creatives caveat ---------------------------------------------

test('the All Creatives heading carries the same block caveat as the other creative tabs', async () => {
  // 03–16 Sep cuts the first block's start, so coverage is partial.
  const html = await render({ from: '2026-09-03', to: '2026-09-16' });
  const heading = html.indexOf('All creatives');
  assert.ok(heading > -1);
  const afterHeading = html.slice(heading, heading + 1200);
  assert.match(afterHeading, /five-day blocks/, 'the caveat must appear with the All creatives heading');
});

test('the caveat marker is injected, not left in the template', async () => {
  const html = await render({ from: '2026-09-01', to: '2026-09-10' });
  assert.doesNotMatch(html, /<!--INJECT:CREATIVE_CAVEAT-->/);
});

test('a block-aligned range shows no caveat, so the warning is not just boilerplate', async () => {
  // 01–10 Sep exactly spans both five-day blocks: nothing is excluded, so there is
  // nothing to warn about. Without this, the caveat test above would pass even if
  // the banner were hardcoded onto every render.
  const html = await render({ from: '2026-09-01', to: '2026-09-10' });
  const heading = html.indexOf('All creatives');
  const afterHeading = html.slice(heading, heading + 1200);
  assert.doesNotMatch(afterHeading, /five-day blocks/);
  assert.match(html, /BOF_Early_Ad/);
  assert.match(html, /BOF_Mid_Ad/);
});
