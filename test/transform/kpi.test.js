const { test } = require('node:test');
const assert = require('node:assert');
const { sumInWindow, blendedMER, cac } = require('../../lib/transform/kpi');

test('sumInWindow totals a value column for rows within an inclusive date range', () => {
  const rows = [
    { Day: '2026-07-20', Cost: '100' },
    { Day: '2026-08-01', Cost: '50' },
    { Day: '2026-08-19', Cost: '999' }, // outside window, must be excluded
  ];
  const total = sumInWindow(rows, { dateKey: 'Day', valueKey: 'Cost', start: '2026-07-20', end: '2026-08-18' });
  assert.strictEqual(total, 150);
});

test('sumInWindow handles DD-MM-YYYY dated rows the same as ISO', () => {
  const rows = [{ Day: '20-07-2026', 'Total sales': '1000' }];
  const total = sumInWindow(rows, { dateKey: 'Day', valueKey: 'Total sales', start: '2026-07-20', end: '2026-08-18' });
  assert.strictEqual(total, 1000);
});

test('sumInWindow skips rows with a blank/unparseable date instead of throwing', () => {
  const rows = [
    { Day: '2026-07-20', Cost: '100' },
    { Day: '', Cost: '999' },
    { Day: 'not a date', Cost: '999' },
  ];
  const total = sumInWindow(rows, { dateKey: 'Day', valueKey: 'Cost', start: '2026-07-20', end: '2026-08-18' });
  assert.strictEqual(total, 100);
});

test('blendedMER divides Shopify sales by combined paid spend', () => {
  assert.strictEqual(blendedMER({ shopifySales: 104800, metaSpend: 28700, googleSpend: 12800 }), 104800 / 41500);
});

test('blendedMER returns 0 when there is no paid spend, not Infinity', () => {
  assert.strictEqual(blendedMER({ shopifySales: 1000, metaSpend: 0, googleSpend: 0 }), 0);
});

test('cac divides combined paid spend by new customers', () => {
  assert.strictEqual(cac({ metaSpend: 28700, googleSpend: 12800, newCustomers: 5063 }), 41500 / 5063);
});

test('cac returns 0 when there are no new customers, not Infinity', () => {
  assert.strictEqual(cac({ metaSpend: 1000, googleSpend: 0, newCustomers: 0 }), 0);
});
