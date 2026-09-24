// End-to-end coverage for the global reporting range: that selecting a range
// actually moves every figure derived from a date-aware source, and that the
// sources which cannot honour it say so instead of showing a stale number.
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

// Three well-separated days. A range selecting one must not pick up the others,
// which is what makes "did the filter actually apply?" answerable from the page.
const SHOPIFY =
  'Day,Orders,Gross sales,Discounts,Sales reversals,Net sales,Shipping charges,Duties,Additional fees,Taxes,Total sales\n' +
  '2026-09-02,10,1000,0,0,1000,0,0,0,0,1000\n' +
  '2026-09-12,10,2000,0,0,2000,0,0,0,0,2000\n' +
  '2026-09-22,10,4000,0,0,4000,0,0,0,0,4000\n';

const META =
  'Campaign name,Day,Impressions,Amount spent (GBP),Link clicks,Purchases,Purchases conversion value,Purchase ROAS,Reporting starts,Reporting ends\n' +
  'K-BOF_PDP-CBO,2026-09-02,1000,100,50,5,400,4,2026-09-02,2026-09-02\n' +
  'K-BOF_PDP-CBO,2026-09-12,1000,200,50,5,400,4,2026-09-12,2026-09-12\n' +
  'K-BOF_PDP-CBO,2026-09-22,1000,400,50,5,400,4,2026-09-22,2026-09-22\n';

const GOOGLE =
  'Campaign,Day,Currency code,Cost,Impr.,Clicks,Conversions,Conv. value\n' +
  'L - Search - Brand,2026-09-02,GBP,10,100,5,1,40\n' +
  'L - Search - Brand,2026-09-12,GBP,20,100,5,1,40\n' +
  'L - Search - Brand,2026-09-22,GBP,40,100,5,1,40\n';

// Five-day blocks, matching how api/sync-creatives.js writes this tab.
const CREATIVES =
  'Reporting starts,Reporting ends,Ad name,Amount spent (GBP),Impressions,Purchases,Campaign name,Purchases conversion value\n' +
  '2026-09-01,2026-09-05,BOF_Early_Ad,100,1000,10,K-BOF_PDP-CBO,400\n' +
  '2026-09-16,2026-09-20,BOF_Late_Ad,300,1000,10,K-BOF_PDP-CBO,400\n';

const CSV_BY_URL = {
  [ENV.SHEET_CSV_URL_CREATIVES]: CREATIVES,
  [ENV.SHEET_CSV_URL_GOOGLE_DAILY]: GOOGLE,
  [ENV.SHEET_CSV_URL_META_DAILY]: META,
  [ENV.SHEET_CSV_URL_SHOPIFY_DAILY]: SHOPIFY,
  [ENV.SHEET_CSV_URL_NEW_RETURNING]: 'New or returning customer,Customers\nNew,5000\nReturning,3000\n',
  [ENV.SHEET_CSV_URL_COHORT]: 'Month,Months since first purchase,Customers,Customer retention rate,Customers in cohort\n2026-01-08,0,100,1,100\n',
  [ENV.SHEET_CSV_URL_SHOPIFY_NEW_CUSTOMERS_MONTHLY]: 'Month,New customers,Returning customers\n2026-09-01,200,80\n',
};

function mockFetchAllOk() {
  return mock.fn(async (url) => {
    if (CSV_BY_URL[url] !== undefined) return { ok: true, status: 200, text: async () => CSV_BY_URL[url] };
    return { ok: true, status: 200, json: async () => ({ data: { products: { edges: [] } } }) };
  });
}

async function render(query) {
  const originalFetch = global.fetch;
  global.fetch = mockFetchAllOk();
  try {
    return await buildDashboardHtml(ENV, query);
  } finally {
    global.fetch = originalFetch;
  }
}

test('a narrow range sums only the days inside it', async () => {
  // 2026-09-12 alone: Shopify £2,000, Meta £200, Google £20.
  const html = await render({ from: '2026-09-12', to: '2026-09-12' });
  assert.match(html, /£2\.0k|£2,000/);
  assert.doesNotMatch(html, /£7\.0k/); // the all-three-days total must not appear
});

test('widening the range changes the totals', async () => {
  const narrow = await render({ from: '2026-09-12', to: '2026-09-12' });
  const wide = await render({ from: '2026-09-02', to: '2026-09-22' });
  assert.notEqual(narrow, wide);
  // All three Shopify days total £7,000 for the wide window.
  assert.match(wide, /£7\.0k|£7,000/);
});

test('a row immediately outside the selection is excluded at both edges', async () => {
  // 03–21 Sep excludes the 2nd and the 22nd, leaving only the 12th.
  const html = await render({ from: '2026-09-03', to: '2026-09-21' });
  assert.match(html, /£2\.0k|£2,000/);
  assert.doesNotMatch(html, /£7\.0k/);
});

test('the selected dates appear in the headings, not a frozen snapshot range', async () => {
  const html = await render({ from: '2026-09-02', to: '2026-09-12' });
  assert.match(html, /Sep 2 – Sep 12/);
  assert.doesNotMatch(html, /Jul 20 – Aug 18/);
  assert.doesNotMatch(html, /Jun 20 – Jul 19/);
});

test('every preset resolves and labels itself', async () => {
  for (const days of [7, 30, 90]) {
    const html = await render({ days: String(days) });
    assert.match(html, new RegExp(`Showing <b>last ${days} days`), `preset ${days}`);
  }
});

test('the range controls render with the resolved dates prefilled and the active preset marked', async () => {
  const html = await render({ days: '7' });
  assert.match(html, /id="range-from"/);
  assert.match(html, /id="range-to"/);
  assert.match(html, /<a class="db active" href="\?days=7">Last 7 days<\/a>/);
  assert.match(html, /<a class="db" href="\?days=30">Last 30 days<\/a>/);
});

test('a custom range marks Apply active rather than any preset', async () => {
  const html = await render({ from: '2026-09-02', to: '2026-09-12' });
  assert.doesNotMatch(html, /<a class="db active"/);
  assert.match(html, /<button type="submit" class="db active">Apply<\/button>/);
  assert.match(html, /value="2026-09-02"/);
  assert.match(html, /value="2026-09-12"/);
});

test('an invalid range is refused rather than rendered against a guessed window', async () => {
  await assert.rejects(() => render({ from: '2026-09-22', to: '2026-09-02' }), /after/);
  await assert.rejects(() => render({ from: '2026-02-30', to: '2026-03-05' }), /calendar dates/);
  await assert.rejects(() => render({ days: '45' }), /days must be one of/);
});

test('creative blocks straddling the selection are excluded, and the shortfall is stated', async () => {
  // 03–18 Sep cuts the start of the first block and the end of the second,
  // so neither can be counted whole and neither may be prorated.
  const html = await render({ from: '2026-09-03', to: '2026-09-18' });
  assert.match(html, /Creative data is not filtered by the selected dates|five-day blocks/);
  assert.doesNotMatch(html, /BOF_Early_Ad/);
  assert.doesNotMatch(html, /BOF_Late_Ad/);
});

test('a block-aligned range includes exactly the blocks inside it', async () => {
  const html = await render({ from: '2026-09-01', to: '2026-09-20' });
  assert.match(html, /BOF_Early_Ad/);
  assert.match(html, /BOF_Late_Ad/);
});

test('a range covering one block excludes the other', async () => {
  const html = await render({ from: '2026-09-01', to: '2026-09-05' });
  assert.match(html, /BOF_Early_Ad/);
  assert.doesNotMatch(html, /BOF_Late_Ad/);
});

test('sources that cannot honour the range say so instead of showing a stale number', async () => {
  const html = await render({ from: '2026-09-02', to: '2026-09-12' });
  assert.match(html, /New vs returning customers is not filtered by the selected dates/);
  assert.match(html, /Cohort &amp; LTV is not filtered by the selected dates|Cohort & LTV is not filtered by the selected dates/);
  assert.match(html, /Monthly CAC trend is not filtered by the selected dates/);
  assert.match(html, /fixed 90-day window — not the selected range/);
});

test('partial source coverage is reported rather than summed as zeros', async () => {
  // The sources stop on 22 Sep; asking back to 1 Aug must say so.
  const html = await render({ from: '2026-08-01', to: '2026-09-22' });
  assert.match(html, /Partial coverage for this range/);
  assert.match(html, /history starts/);
});

test('stock is labelled as live and unaffected by the range', async () => {
  const html = await render({ from: '2026-09-02', to: '2026-09-12' });
  assert.match(html, /Live inventory — unaffected by date range/);
});

test('the open tab survives applying a range', async () => {
  const html = await render({ days: '7' });
  // The tab is carried in the URL hash and restored on load.
  assert.match(html, /tab=/);
  assert.match(html, /id="range-tab"/);
});
