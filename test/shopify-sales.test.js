// test/shopify-sales.test.js
const { test, mock } = require('node:test');
const assert = require('node:assert');
const { fetchShopifySales, fetchNewVsReturning, fetchNewCustomersByMonth } = require('../lib/shopify-sales');

function fakeShopifyQlResponse(rows, parseErrors = []) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: { shopifyqlQuery: { tableData: rows ? { rows } : null, parseErrors } },
    }),
  };
}

test('fetchShopifySales sends the ShopifyQL query as a GraphQL variable and returns the rows', async () => {
  const originalFetch = global.fetch;
  let capturedUrl, capturedBody;
  global.fetch = mock.fn(async (url, opts) => {
    capturedUrl = url;
    capturedBody = JSON.parse(opts.body);
    return fakeShopifyQlResponse([{ day: '2026-08-25', orders: '136', gross_sales: '2783.78' }]);
  });
  try {
    const rows = await fetchShopifySales({
      shopDomain: 'test.myshopify.com', accessToken: 'tok', dateFrom: '2026-06-03', dateTo: '2026-08-30',
    });
    assert.deepStrictEqual(rows, [{ day: '2026-08-25', orders: '136', gross_sales: '2783.78' }]);
    assert.match(capturedUrl, /^https:\/\/test\.myshopify\.com\/admin\/api\//);
    assert.match(capturedBody.variables.q, /FROM sales/);
    assert.match(capturedBody.variables.q, /SINCE 2026-06-03 UNTIL 2026-08-30/);
    assert.match(capturedBody.variables.q, /TIMESERIES day/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchShopifySales returns an empty array when tableData is null (no rows in range)', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async () => fakeShopifyQlResponse(null));
  try {
    const rows = await fetchShopifySales({ shopDomain: 'test.myshopify.com', accessToken: 'tok', dateFrom: '2026-06-03', dateTo: '2026-08-30' });
    assert.deepStrictEqual(rows, []);
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchShopifySales throws a descriptive error on a non-2xx HTTP response', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  try {
    await assert.rejects(
      () => fetchShopifySales({ shopDomain: 'test.myshopify.com', accessToken: 'bad', dateFrom: '2026-06-03', dateTo: '2026-08-30' }),
      /Shopify API error \(401\)/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchShopifySales throws a descriptive error on a GraphQL-level error response', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async () => ({ ok: true, status: 200, json: async () => ({ errors: [{ message: 'Access denied' }] }) }));
  try {
    await assert.rejects(
      () => fetchShopifySales({ shopDomain: 'test.myshopify.com', accessToken: 'bad', dateFrom: '2026-06-03', dateTo: '2026-08-30' }),
      /Shopify GraphQL error/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchNewVsReturning sends the right ShopifyQL query and returns new/returning counts', async () => {
  const originalFetch = global.fetch;
  let capturedBody;
  global.fetch = mock.fn(async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true, status: 200,
      json: async () => ({ data: { shopifyqlQuery: { tableData: { rows: [{ new_customers: '6984', returning_customers: '3777' }] }, parseErrors: [] } } }),
    };
  });
  try {
    const result = await fetchNewVsReturning({ shopDomain: 'test.myshopify.com', accessToken: 'tok', dateFrom: '2026-06-03', dateTo: '2026-08-30' });
    assert.deepStrictEqual(result, { newCustomers: 6984, returningCustomers: 3777 });
    assert.match(capturedBody.variables.q, /SHOW new_customers, returning_customers/);
    assert.match(capturedBody.variables.q, /SINCE 2026-06-03 UNTIL 2026-08-30/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchNewVsReturning returns zeros when there is no data in range', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { shopifyqlQuery: { tableData: null, parseErrors: [] } } }) }));
  try {
    const result = await fetchNewVsReturning({ shopDomain: 'test.myshopify.com', accessToken: 'tok', dateFrom: '2026-06-03', dateTo: '2026-08-30' });
    assert.deepStrictEqual(result, { newCustomers: 0, returningCustomers: 0 });
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchNewCustomersByMonth sends a TIMESERIES month query and returns the rows as-is', async () => {
  const originalFetch = global.fetch;
  let capturedBody;
  global.fetch = mock.fn(async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return fakeShopifyQlResponse([
      { month: '2026-06-01', new_customers: '412', returning_customers: '201' },
      { month: '2026-07-01', new_customers: '389', returning_customers: '255' },
    ]);
  });
  try {
    const rows = await fetchNewCustomersByMonth({
      shopDomain: 'test.myshopify.com', accessToken: 'tok', dateFrom: '2026-06-03', dateTo: '2026-08-30',
    });
    assert.deepStrictEqual(rows, [
      { month: '2026-06-01', new_customers: '412', returning_customers: '201' },
      { month: '2026-07-01', new_customers: '389', returning_customers: '255' },
    ]);
    assert.match(capturedBody.variables.q, /FROM sales/);
    assert.match(capturedBody.variables.q, /SHOW new_customers, returning_customers/);
    assert.match(capturedBody.variables.q, /TIMESERIES month/);
    assert.match(capturedBody.variables.q, /SINCE 2026-06-03 UNTIL 2026-08-30/);
    assert.match(capturedBody.variables.q, /ORDER BY month ASC/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchNewCustomersByMonth returns an empty array when there is no data in range', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async () => fakeShopifyQlResponse(null));
  try {
    const rows = await fetchNewCustomersByMonth({ shopDomain: 'test.myshopify.com', accessToken: 'tok', dateFrom: '2026-06-03', dateTo: '2026-08-30' });
    assert.deepStrictEqual(rows, []);
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchShopifySales throws a descriptive error when ShopifyQL itself reports a parse error', async () => {
  const originalFetch = global.fetch;
  global.fetch = mock.fn(async () => fakeShopifyQlResponse(null, ["Column Not Found: Column 'bogus_field' not found"]));
  try {
    await assert.rejects(
      () => fetchShopifySales({ shopDomain: 'test.myshopify.com', accessToken: 'tok', dateFrom: '2026-06-03', dateTo: '2026-08-30' }),
      /ShopifyQL parse error: Column Not Found/
    );
  } finally {
    global.fetch = originalFetch;
  }
});
