// test/transform/daily-aov.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildDailyAovComparisonSeries } = require('../../lib/transform/daily-aov');

test('computes daily AOV (net sales ÷ orders) for the current window, with matching date labels', () => {
  const { current, labels } = buildDailyAovComparisonSeries({
    shopifyDailyRows: [
      { Day: '2026-08-01', 'Net sales': '1000', Orders: '50' },
      { Day: '2026-08-02', 'Net sales': '600', Orders: '30' },
    ],
    start: '2026-08-01', end: '2026-08-02', prevStart: '2026-07-30', prevEnd: '2026-07-31',
  });
  assert.deepStrictEqual(current, [20, 20]);
  assert.deepStrictEqual(labels, ['Aug 1', 'Aug 2']);
});

test('computes daily AOV for the previous window, aligned by day offset to the current window', () => {
  const { previous } = buildDailyAovComparisonSeries({
    shopifyDailyRows: [
      { Day: '2026-07-30', 'Net sales': '450', Orders: '30' },
      { Day: '2026-07-31', 'Net sales': '500', Orders: '25' },
    ],
    start: '2026-08-01', end: '2026-08-02', prevStart: '2026-07-30', prevEnd: '2026-07-31',
  });
  assert.deepStrictEqual(previous, [15, 20]);
});

test('a day with 0 orders gets AOV 0, not Infinity/NaN', () => {
  const { current } = buildDailyAovComparisonSeries({
    shopifyDailyRows: [{ Day: '2026-08-01', 'Net sales': '0', Orders: '0' }],
    start: '2026-08-01', end: '2026-08-01', prevStart: '2026-07-31', prevEnd: '2026-07-31',
  });
  assert.deepStrictEqual(current, [0]);
});

test('a day missing entirely from shopifyDailyRows gets AOV 0 for both series', () => {
  const { current, previous } = buildDailyAovComparisonSeries({
    shopifyDailyRows: [],
    start: '2026-08-01', end: '2026-08-01', prevStart: '2026-07-31', prevEnd: '2026-07-31',
  });
  assert.deepStrictEqual(current, [0]);
  assert.deepStrictEqual(previous, [0]);
});

test('parses comma-formatted large net-sales numbers correctly', () => {
  const { current } = buildDailyAovComparisonSeries({
    shopifyDailyRows: [{ Day: '2026-08-01', 'Net sales': '13,905', Orders: '515' }],
    start: '2026-08-01', end: '2026-08-01', prevStart: '2026-07-31', prevEnd: '2026-07-31',
  });
  assert.deepStrictEqual(current, [Math.round((13905 / 515) * 100) / 100]);
});

test('handles a DD-MM-YYYY-formatted Day column, matching the rest of the codebase\'s date handling', () => {
  const { current, labels } = buildDailyAovComparisonSeries({
    shopifyDailyRows: [{ Day: '01-08-2026', 'Net sales': '1000', Orders: '50' }],
    start: '2026-08-01', end: '2026-08-01', prevStart: '2026-07-31', prevEnd: '2026-07-31',
  });
  assert.deepStrictEqual(current, [20]);
  assert.deepStrictEqual(labels, ['Aug 1']);
});
