// test/transform/breakdown.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildBreakdown } = require('../../lib/transform/breakdown');

function ad(overrides) {
  return { angle: 'Price', spend: 100, purch: 10, val: 300, ...overrides };
}

test('groups by the key function, summing spend/purchases/value and counting ads', () => {
  const rows = buildBreakdown(
    [ad({ angle: 'Price', spend: 100, purch: 10, val: 300 }), ad({ angle: 'Price', spend: 50, purch: 5, val: 100 }), ad({ angle: 'Trust', spend: 20, purch: 1, val: 20 })],
    (a) => a.angle
  );
  const price = rows.find((r) => r.label === 'Price');
  assert.strictEqual(price.spend, 150);
  assert.strictEqual(price.ads, 2);
  assert.strictEqual(price.purch, 15);
  assert.strictEqual(price.cpa, 10);
  assert.strictEqual(price.roas, 400 / 150);
});

test('sorts groups by spend descending', () => {
  const rows = buildBreakdown([ad({ angle: 'Trust', spend: 20 }), ad({ angle: 'Price', spend: 100 })], (a) => a.angle);
  assert.deepStrictEqual(rows.map((r) => r.label), ['Price', 'Trust']);
});

test('gives 0 cpa/roas (not NaN/Infinity) for a group with 0 purchases/spend', () => {
  const rows = buildBreakdown([ad({ angle: 'Cafe', spend: 22, purch: 0, val: 0 })], (a) => a.angle);
  assert.strictEqual(rows[0].cpa, 0);
  assert.strictEqual(rows[0].roas, 0);
});
