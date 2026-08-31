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
    // The static, fabricated CAC monthly bar chart must be replaced with an honest placeholder note.
    assert.match(html, /Monthly CAC trend is not yet available/);
    assert.doesNotMatch(html, /£40\.83/);
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

test('a blank/malformed date row in one Sheet tab does not crash the whole page', async () => {
  const originalFetch = global.fetch;
  const shopifyWithBadRow =
    CSV_BY_URL[ENV.SHEET_CSV_URL_SHOPIFY_DAILY] + 'not-a-date,10,200,0,0,200,0,0,0,0,200\n'; // an unparseable date in an otherwise-valid row
  global.fetch = mock.fn(async (url) => {
    if (url === ENV.SHEET_CSV_URL_SHOPIFY_DAILY) return { ok: true, status: 200, text: async () => shopifyWithBadRow };
    if (CSV_BY_URL[url] !== undefined) return { ok: true, status: 200, text: async () => CSV_BY_URL[url] };
    return { ok: true, status: 200, json: async () => ({ data: { products: { edges: [] } } }) };
  });
  try {
    const html = await buildDashboardHtml(ENV);
    assert.match(html, /<!doctype html>/i);
    assert.doesNotMatch(html, /<!--INJECT:/);
    assert.doesNotMatch(html, /\/\*INJECT:/);
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
    // The injected STK_SNAP must carry a distinguishing "outage" marker (asOf: null) —
    // never asOf: <now> with an empty products array, which the client script would
    // otherwise render as a false "all clear".
    assert.match(html, /var STK_SNAP=\{"asOf":null,"products":\[\]\};/);
  } finally {
    global.fetch = originalFetch;
  }
});
