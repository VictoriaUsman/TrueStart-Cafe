// test/transform/monthly-cac.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildMonthlyCacSeries } = require('../../lib/transform/monthly-cac');

test('computes blended CAC per calendar month from monthly new-customer counts and daily spend', () => {
  const series = buildMonthlyCacSeries({
    monthlyRows: [
      { Month: '2026-05-01', 'New customers': '100', 'Returning customers': '50' },
      { Month: '2026-06-01', 'New customers': '200', 'Returning customers': '80' },
    ],
    metaDailyRows: [
      { Day: '2026-05-10', 'Amount spent (GBP)': '3000' },
      { Day: '2026-06-10', 'Amount spent (GBP)': '4000' },
    ],
    googleDailyRows: [
      { Day: '2026-05-20', Cost: '1000' },
      { Day: '2026-06-20', Cost: '2000' },
    ],
    currentMonth: '2026-07',
  });
  assert.deepStrictEqual(series, [
    { month: '2026-05', label: 'May', cac: 40, spend: 4000, newCustomers: 100, partial: false },
    { month: '2026-06', label: 'June', cac: 30, spend: 6000, newCustomers: 200, partial: false },
  ]);
});

test('sorts the series chronologically regardless of input row order', () => {
  const series = buildMonthlyCacSeries({
    monthlyRows: [
      { Month: '2026-06-01', 'New customers': '10' },
      { Month: '2026-05-01', 'New customers': '10' },
    ],
    metaDailyRows: [],
    googleDailyRows: [],
    currentMonth: '2026-07',
  });
  assert.deepStrictEqual(series.map((m) => m.month), ['2026-05', '2026-06']);
});

test('marks the given currentMonth as partial instead of excluding it', () => {
  const series = buildMonthlyCacSeries({
    monthlyRows: [
      { Month: '2026-05-01', 'New customers': '10' },
      { Month: '2026-06-01', 'New customers': '10' },
    ],
    metaDailyRows: [],
    googleDailyRows: [],
    currentMonth: '2026-06',
  });
  assert.deepStrictEqual(series.map((m) => m.month), ['2026-05', '2026-06']);
  assert.strictEqual(series.find((m) => m.month === '2026-05').partial, false);
  assert.strictEqual(series.find((m) => m.month === '2026-06').partial, true);
});

test('skips a month with 0 new customers instead of showing an undefined/zero CAC bar', () => {
  const series = buildMonthlyCacSeries({
    monthlyRows: [
      { Month: '2026-05-01', 'New customers': '0' },
      { Month: '2026-06-01', 'New customers': '10' },
    ],
    metaDailyRows: [],
    googleDailyRows: [],
    currentMonth: '2026-07',
  });
  assert.deepStrictEqual(series.map((m) => m.month), ['2026-06']);
});

test('a row with a blank/unparseable month is skipped instead of throwing', () => {
  const series = buildMonthlyCacSeries({
    monthlyRows: [
      { Month: '', 'New customers': '10' },
      { Month: '2026-06-01', 'New customers': '10' },
    ],
    metaDailyRows: [],
    googleDailyRows: [],
    currentMonth: '2026-07',
  });
  assert.deepStrictEqual(series.map((m) => m.month), ['2026-06']);
});

test('parses comma-formatted large spend/customer numbers correctly', () => {
  const series = buildMonthlyCacSeries({
    monthlyRows: [{ Month: '2026-05-01', 'New customers': '1,000' }],
    metaDailyRows: [{ Day: '2026-05-10', 'Amount spent (GBP)': '30,000' }],
    googleDailyRows: [{ Day: '2026-05-20', Cost: '10,000' }],
    currentMonth: '2026-07',
  });
  assert.deepStrictEqual(series, [
    { month: '2026-05', label: 'May', cac: 40, spend: 40000, newCustomers: 1000, partial: false },
  ]);
});
