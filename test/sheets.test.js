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
