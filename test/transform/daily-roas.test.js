// test/transform/daily-roas.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildDailyRoasSeries } = require('../../lib/transform/daily-roas');

test('computes one blended ROAS value per day, sorted chronologically, with matching labels', () => {
  const { RS, LB } = buildDailyRoasSeries({
    shopifyDailyRows: [
      { Day: '16-02-2026', 'Total sales': '1000' },
      { Day: '15-02-2026', 'Total sales': '500' },
    ],
    metaDailyRows: [
      { Day: '2026-02-15', 'Amount spent (GBP)': '200' },
      { Day: '2026-02-16', 'Amount spent (GBP)': '250' },
    ],
    googleDailyRows: [
      { Day: '2026-02-15', Cost: '50' },
      { Day: '2026-02-16', Cost: '50' },
    ],
  });
  assert.deepStrictEqual(LB, ['Feb 15', 'Feb 16']);
  assert.deepStrictEqual(RS, [2, 3.33]);
});

test('a day with paid spend but no matching Shopify row gets ROAS 0', () => {
  const { RS, LB } = buildDailyRoasSeries({
    shopifyDailyRows: [],
    metaDailyRows: [{ Day: '2026-02-15', 'Amount spent (GBP)': '200' }],
    googleDailyRows: [],
  });
  assert.deepStrictEqual(LB, ['Feb 15']);
  assert.deepStrictEqual(RS, [0]);
});

test('a row with a blank/unparseable date is skipped instead of throwing', () => {
  const { RS, LB } = buildDailyRoasSeries({
    shopifyDailyRows: [
      { Day: '2026-02-15', 'Total sales': '500' },
      { Day: '', 'Total sales': '999' },
    ],
    metaDailyRows: [{ Day: 'not a date', 'Amount spent (GBP)': '999' }],
    googleDailyRows: [],
  });
  assert.deepStrictEqual(LB, ['Feb 15']);
  assert.deepStrictEqual(RS, [0]);
});

test('a day with zero paid spend gets ROAS 0, not Infinity/NaN', () => {
  const { RS } = buildDailyRoasSeries({
    shopifyDailyRows: [{ Day: '15-02-2026', 'Total sales': '500' }],
    metaDailyRows: [],
    googleDailyRows: [],
  });
  assert.deepStrictEqual(RS, [0]);
});
