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
  SHEET_CSV_URL_SHOPIFY_NEW_CUSTOMERS_MONTHLY: 'https://example.com/cac-monthly.csv',
  SHOPIFY_SHOP_DOMAIN: 'test.myshopify.com',
  SHOPIFY_ACCESS_TOKEN: 'tok',
};

const CSV_BY_URL = {
  [ENV.SHEET_CSV_URL_CREATIVES]:
    'Ad name,Amount spent (GBP),Impressions,Purchases,Campaign name,Purchases conversion value\n' +
    'BOF_ST_19_Upgrader_Price_Starter_Bags V1,100,1000,25,K-TS_UK_BOF-PROVEN,400\n',
  [ENV.SHEET_CSV_URL_GOOGLE_DAILY]: 'Campaign,Day,Currency code,Cost,Impr.,Clicks,Conversions,Conv. value\nL - Search - Brand,2026-08-01,GBP,100,1000,50,10,400\nL - Search - Brand,2026-06-15,GBP,1000,500,25,5,200\n',
  [ENV.SHEET_CSV_URL_META_DAILY]: 'Campaign name,Day,Impressions,Amount spent (GBP),Link clicks,Purchases,Purchases conversion value,Purchase ROAS,Reporting starts,Reporting ends\nK-TS_UK_BOF-PROVEN,2026-08-01,1000,100,50,25,400,4,2026-08-01,2026-08-01\nK-TS_UK_BOF-PROVEN,2026-06-15,500,3000,25,12,200,4,2026-06-15,2026-06-15\n',
  [ENV.SHEET_CSV_URL_SHOPIFY_DAILY]: 'Day,Orders,Gross sales,Discounts,Sales reversals,Net sales,Shipping charges,Duties,Additional fees,Taxes,Total sales\n01-08-2026,50,1000,0,0,1000,0,0,0,0,1000\n',
  [ENV.SHEET_CSV_URL_NEW_RETURNING]: 'New or returning customer,Customers\nNew,5000\nReturning,3000\n',
  [ENV.SHEET_CSV_URL_COHORT]: 'Month,Months since first purchase,Customers,Customer retention rate,Customers in cohort\n2026-01-08,0,100,1,100\n',
  [ENV.SHEET_CSV_URL_SHOPIFY_NEW_CUSTOMERS_MONTHLY]: 'Month,New customers,Returning customers\n2026-06-01,200,80\n2026-08-01,50,20\n',
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
    // Real monthly CAC chart: June is a complete month with matching spend+new-customer data,
    // so it renders as a bar (£4000 spend ÷ 200 new customers = £20.00 CAC). August is the
    // current in-progress month (matches the anchor date) and renders too, but flagged partial
    // (£200 spend ÷ 50 new customers = £4.00 CAC).
    assert.match(html, /£20\.00/);
    assert.match(html, />June</);
    assert.match(html, /£4\.00/);
    assert.match(html, />August \(to date\)</);
    assert.doesNotMatch(html, /Monthly CAC trend is not yet available/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('the CAC KPI card sums spend over the same 90-day window as the new-vs-returning source, not the 30-day KPI window', async () => {
  const originalFetch = global.fetch;
  global.fetch = mockFetchAllOk();
  try {
    const html = await buildDashboardHtml(ENV);
    // Meta+Google spend across BOTH the Aug 1 row (inside the 30d window) and the Jun 15 row
    // (outside 30d, inside 90d) = (100+3000) + (100+1000) = 4200; 4200 / 5000 new customers = £0.84 -> £1.
    // The old 30d-only calc would give (100+100)/5000 = £0.04 -> £0.
    // The £1 is what pins the behaviour: £4000 of 90-day spend ÷ 5000 new customers.
    // Summing only the 30-day KPI window would give a different figure.
    assert.match(html, /💷 CAC · cost per new customer<\/div><div class="big">£1<\/div><div class="cap">blended · fixed 90-day window — not the selected range/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('renders a real Cumulative LTV table (estimated from Cohort retention rate × AOV), not the old static placeholder', async () => {
  const originalFetch = global.fetch;
  global.fetch = mockFetchAllOk();
  try {
    const html = await buildDashboardHtml(ENV);
    // Jan 2026 cohort, M0 retention 100% (default) × £20 AOV (£1000 net sales / 50 orders) = £20.
    assert.match(html, /Jan 2026/);
    assert.match(html, />£20</);
    assert.doesNotMatch(html, /Cumulative LTV.{0,20}is not yet available/s);
  } finally {
    global.fetch = originalFetch;
  }
});

test('degrades only the Cumulative LTV table (graceful "not enough data" note) when the Cohort tab fails, leaving the rest of the Subscription tab intact', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async (url) => {
    if (url === ENV.SHEET_CSV_URL_COHORT) return { ok: false, status: 500, text: async () => '' };
    if (CSV_BY_URL[url] !== undefined) return { ok: true, status: 200, text: async () => CSV_BY_URL[url] };
    return { ok: true, status: 200, json: async () => ({ data: { products: { edges: [] } } }) };
  });
  try {
    const html = await buildDashboardHtml(ENV);
    assert.match(html, /Cumulative LTV/);
    assert.match(html, /not enough/i);
    assert.match(html, /£19\.\d\d|£20\.\d\d|AVG ORDER VALUE/); // rest of the Subscription tab still renders
  } finally {
    global.fetch = originalFetch;
  }
});

test('renders the AOV trend chart (current vs previous 30-day window) in the Subscription tab', async () => {
  const originalFetch = global.fetch;
  global.fetch = mockFetchAllOk();
  try {
    const html = await buildDashboardHtml(ENV);
    assert.match(html, /AOV trend/);
    // The fixture's only Shopify daily row is Aug 1, 2026: £1000 net sales / 50 orders = £20.
    assert.match(html, /<title>Aug 1: £20\.00<\/title>/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('degrades the Monthly CAC trend chart when its Sheet tab fails, leaving other sections intact', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async (url) => {
    if (url === ENV.SHEET_CSV_URL_SHOPIFY_NEW_CUSTOMERS_MONTHLY) return { ok: false, status: 500, text: async () => '' };
    if (CSV_BY_URL[url] !== undefined) return { ok: true, status: 200, text: async () => CSV_BY_URL[url] };
    return { ok: true, status: 200, json: async () => ({ data: { products: { edges: [] } } }) };
  });
  try {
    const html = await buildDashboardHtml(ENV);
    assert.match(html, /Monthly CAC trend data is temporarily unavailable/is);
    assert.match(html, /BOF_ST_19_Upgrader_Price_Starter_Bags V1/); // other sections still rendered
  } finally {
    global.fetch = originalFetch;
  }
});

test('shows a partial "(to date)" bar rather than excluding it, when only the current month has data', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async (url) => {
    if (url === ENV.SHEET_CSV_URL_SHOPIFY_NEW_CUSTOMERS_MONTHLY) {
      return { ok: true, status: 200, text: async () => 'Month,New customers,Returning customers\n2026-08-01,50,20\n' };
    }
    if (CSV_BY_URL[url] !== undefined) return { ok: true, status: 200, text: async () => CSV_BY_URL[url] };
    return { ok: true, status: 200, json: async () => ({ data: { products: { edges: [] } } }) };
  });
  try {
    const html = await buildDashboardHtml(ENV);
    assert.doesNotMatch(html, /not enough/i);
    assert.match(html, />August \(to date\)</);
  } finally {
    global.fetch = originalFetch;
  }
});

test('shows a graceful "not enough data" note instead of a chart when there is no usable month at all', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async (url) => {
    // 0 new customers is the only row — skipped by buildMonthlyCacSeries, leaving nothing to chart.
    if (url === ENV.SHEET_CSV_URL_SHOPIFY_NEW_CUSTOMERS_MONTHLY) {
      return { ok: true, status: 200, text: async () => 'Month,New customers,Returning customers\n2026-08-01,0,20\n' };
    }
    if (CSV_BY_URL[url] !== undefined) return { ok: true, status: 200, text: async () => CSV_BY_URL[url] };
    return { ok: true, status: 200, json: async () => ({ data: { products: { edges: [] } } }) };
  });
  try {
    const html = await buildDashboardHtml(ENV);
    assert.match(html, /not enough/i);
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

test('a single day-level source failure (Google) blanks the MER/spend/sales KPI cards instead of computing a silently-wrong number with a misleading up-arrow', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async (url) => {
    if (url === ENV.SHEET_CSV_URL_GOOGLE_DAILY) return { ok: false, status: 500, text: async () => '' };
    if (CSV_BY_URL[url] !== undefined) return { ok: true, status: 200, text: async () => CSV_BY_URL[url] };
    return { ok: true, status: 200, json: async () => ({ data: { products: { edges: [] } } }) };
  });
  try {
    const html = await buildDashboardHtml(ENV);
    // MER/spend/sales cards fall back to '—' rather than computing MER against a 0 Google cost
    // (which would otherwise inflate MER and could show a misleading green up-arrow).
    assert.match(html, /ROAS \/ MER — data unavailable/);
    assert.match(html, /Spend — data unavailable/);
    assert.doesNotMatch(html, /class="chg up"/);
    // The KILL card is independent of the day-level sources but depends on the BOF snapshot.
    // Since ENV has no GOOGLE_SHEET_ID, the snapshot read fails and it shows unavailable.
    assert.match(html, /🛑 KILL · last 7 days/);
    assert.match(html, /7-day evaluation unavailable/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('the KPI row still renders (with per-card fallbacks) when creatives fails but day-level sources succeed', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async (url) => {
    if (url === ENV.SHEET_CSV_URL_CREATIVES) return { ok: false, status: 500, text: async () => '' };
    if (CSV_BY_URL[url] !== undefined) return { ok: true, status: 200, text: async () => CSV_BY_URL[url] };
    return { ok: true, status: 200, json: async () => ({ data: { products: { edges: [] } } }) };
  });
  try {
    const html = await buildDashboardHtml(ENV);
    // Real numbers for the day-level cards, since Shopify/Meta/Google all succeeded.
    assert.match(html, /class="kpis">/);
    assert.doesNotMatch(html, /ROAS \/ MER — data unavailable/);
    // KILL card falls back since creatives failed.
    assert.match(html, /7-day evaluation unavailable/);
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

test('the KPI window note shows the real current 30-day windows, not a hardcoded date range', async () => {
  const originalFetch = global.fetch;
  global.fetch = mockFetchAllOk();
  try {
    const html = await buildDashboardHtml(ENV);
    assert.doesNotMatch(html, /Jul 20 – Aug 18/); // the old hardcoded snapshot dates
    assert.match(html, /Showing <b>last 30 days \([A-Za-z]{3} \d{1,2} – [A-Za-z]{3} \d{1,2}\)<\/b>/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('the top KPI row shows a kill count, not a Proven count', async () => {
  const originalFetch = global.fetch;
  global.fetch = mockFetchAllOk();
  try {
    const html = await buildDashboardHtml(ENV);
    // The emoji anchors this: the injected DATA literal legitimately contains the
    // string "K-TS_UK_BOF-PROVEN" as a historical campaign name, so a bare
    // /PROVEN/ would match that and never fail.
    assert.doesNotMatch(html, /✅ PROVEN/);
    assert.match(html, /KILL · last 7 days/);
    assert.match(html, /7-day evaluation unavailable/);
  } finally {
    global.fetch = originalFetch;
  }
});
