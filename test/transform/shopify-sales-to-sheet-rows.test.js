// test/transform/shopify-sales-to-sheet-rows.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { mapShopifySalesRows } = require('../../lib/transform/shopify-sales-to-sheet-rows');

test('maps a full ShopifyQL sales row to the ShopifyTotals column order', () => {
  const rows = mapShopifySalesRows([{
    day: '2026-08-25', orders: '136', gross_sales: '2783.78', discounts: '-268.78',
    returns: '-39.72', net_sales: '2475.28', shipping_charges: '292.89', duties: '0',
    additional_fees: '0', taxes: '93.56', total_sales: '2861.73',
  }]);
  assert.deepStrictEqual(rows, [[
    '2026-08-25', 136, 2783.78, -268.78, -39.72, 2475.28, 292.89, 0, 0, 93.56, 2861.73,
  ]]);
});

test('coerces string-typed numeric fields (all ShopifyQL values arrive as strings)', () => {
  const rows = mapShopifySalesRows([{
    day: '2026-08-29', orders: '114', gross_sales: '2256.65', discounts: '-168.65',
    returns: '0', net_sales: '2088', shipping_charges: '251.52', duties: '0',
    additional_fees: '0', taxes: '113.05', total_sales: '2452.57',
  }]);
  assert.strictEqual(typeof rows[0][1], 'number');
  assert.strictEqual(typeof rows[0][2], 'number');
});

test('defaults missing numeric fields to 0 and missing day to empty string', () => {
  const rows = mapShopifySalesRows([{ orders: '5', gross_sales: '100' }]);
  assert.deepStrictEqual(rows[0], ['', 5, 100, 0, 0, 0, 0, 0, 0, 0, 0]);
});
