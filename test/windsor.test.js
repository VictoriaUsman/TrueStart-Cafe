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
