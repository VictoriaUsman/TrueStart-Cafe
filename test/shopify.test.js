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
