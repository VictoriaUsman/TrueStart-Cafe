// test/transform/ltv.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildLtvTable } = require('../../lib/transform/ltv');

test('computes cumulative £ LTV per month as AOV times the running sum of retention rates', () => {
  const table = buildLtvTable(
    [{ cohortLabel: 'May 2026', size: 1000, months: [1, 0.2, 0.1, null, null, null, null, null, null, null, null, null, null] }],
    20 // AOV
  );
  // M0: 1 * 20 = 20. M1: (1 + 0.2) * 20 = 24. M2: (1 + 0.2 + 0.1) * 20 = 26.
  assert.deepStrictEqual(table, [
    { cohortLabel: 'May 2026', size: 1000, months: [20, 24, 26, null, null, null, null, null, null, null, null, null, null] },
  ]);
});

test('stops at the same point the cohort data runs out, leaving later months null', () => {
  const table = buildLtvTable(
    [{ cohortLabel: 'Jul 2026', size: 500, months: [1, 0.3, null, null, null, null, null, null, null, null, null, null, null] }],
    10
  );
  assert.deepStrictEqual(table[0].months.slice(2), new Array(11).fill(null));
});

test('preserves multiple cohorts in order with their labels and sizes untouched', () => {
  const table = buildLtvTable(
    [
      { cohortLabel: 'May 2026', size: 1000, months: [1, null, null, null, null, null, null, null, null, null, null, null, null] },
      { cohortLabel: 'Jun 2026', size: 800, months: [1, null, null, null, null, null, null, null, null, null, null, null, null] },
    ],
    15
  );
  assert.deepStrictEqual(table.map((r) => [r.cohortLabel, r.size]), [['May 2026', 1000], ['Jun 2026', 800]]);
});

test('rounds cumulative £ values to 2 decimal places', () => {
  const table = buildLtvTable(
    [{ cohortLabel: 'May 2026', size: 100, months: [1, 0.111, null, null, null, null, null, null, null, null, null, null, null] }],
    19.99
  );
  assert.strictEqual(table[0].months[0], 19.99);
  assert.strictEqual(table[0].months[1], Math.round((1.111 * 19.99) * 100) / 100);
});

test('returns an empty array when given an empty cohort table', () => {
  assert.deepStrictEqual(buildLtvTable([], 20), []);
});
