const { test } = require('node:test');
const assert = require('node:assert');
const { buildCohortTable } = require('../../lib/transform/cohort');

function row(month, monthsSince, customersInCohort, retentionRate) {
  return {
    Month: month,
    'Months since first purchase': String(monthsSince),
    'Customers in cohort': String(customersInCohort),
    'Customer retention rate': String(retentionRate),
  };
}

test('groups rows by acquisition month into a 13-wide months array', () => {
  const table = buildCohortTable([
    row('2025-08-08', 1, 1124, 0.067),
    row('2025-08-08', 2, 1124, 0.072),
    row('2025-09-08', 1, 1322, 0.065),
  ]);
  assert.strictEqual(table.length, 2);
  const aug = table.find((r) => r.cohortLabel === 'Aug 2025');
  assert.strictEqual(aug.size, 1124);
  assert.strictEqual(aug.months.length, 13);
  assert.strictEqual(aug.months[0], 1); // M0 defaults to 100% by definition
  assert.strictEqual(aug.months[1], 0.067);
  assert.strictEqual(aug.months[2], 0.072);
  assert.strictEqual(aug.months[3], null); // no data yet for M3
});

test('sorts cohorts chronologically by acquisition month', () => {
  const table = buildCohortTable([row('2025-09-08', 1, 100, 0.05), row('2025-08-08', 1, 200, 0.06)]);
  assert.deepStrictEqual(table.map((r) => r.cohortLabel), ['Aug 2025', 'Sep 2025']);
});

test('an explicit M0 row overrides the 100% default', () => {
  const table = buildCohortTable([row('2025-08-08', 0, 1124, 1)]);
  assert.strictEqual(table[0].months[0], 1);
});

test('routes a DD-MM-YYYY-formatted Month through the shared date layer for correct label and sort order', () => {
  // 08-09-2025 means 8 Sep 2025 in DD-MM-YYYY, not 8 Sept read as YYYY-MM-DD-style splitting.
  const table = buildCohortTable([row('08-09-2025', 1, 100, 0.05), row('08-08-2025', 1, 200, 0.06)]);
  assert.deepStrictEqual(table.map((r) => r.cohortLabel), ['Aug 2025', 'Sep 2025']);
});

test('skips a row with a blank/unparseable Month instead of mislabeling or throwing', () => {
  const table = buildCohortTable([row('not-a-month', 1, 100, 0.05), row('2025-08-08', 1, 200, 0.06)]);
  assert.strictEqual(table.length, 1);
  assert.strictEqual(table[0].cohortLabel, 'Aug 2025');
});

test('parses a comma-formatted cohort size correctly (Google Sheets CSV export renders e.g. "13,905")', () => {
  const table = buildCohortTable([row('2025-08-08', 1, '13,905', 0.067)]);
  assert.strictEqual(table[0].size, 13905);
});

test('un-swaps the Cohort sheet\'s DATE(year, 1, month) formula bug, where the real month is encoded in the day slot', () => {
  // Live "Cohort" tab export: every Month value is "YYYY-01-DD" with the real acquisition month
  // sitting in the day slot (01-12) and the month slot pinned to 1, e.g. "2025-01-08" means Aug
  // 2025, not 8 Jan 2025 — confirmed against that cohort's known customer count in production.
  const table = buildCohortTable([
    row('2025-01-08', 1, 1124, 0.067), // Aug 2025
    row('2025-01-12', 1, 661, 0.077), // Dec 2025
    row('2026-01-01', 1, 2399, 0.06), // Jan 2026
    row('2026-01-07', 1, 1991, 0.05), // Jul 2026
  ]);
  assert.deepStrictEqual(
    table.map((r) => r.cohortLabel),
    ['Aug 2025', 'Dec 2025', 'Jan 2026', 'Jul 2026']
  );
});

test('does not un-swap a normal fixed-pull-day January reading when only one cohort is present', () => {
  // A single row can't distinguish "real Jan, pull-day 8th" from the swapped-formula case, so it
  // must default to trusting the month field as-is (matches this sheet's normal-case convention).
  const table = buildCohortTable([row('2026-01-08', 0, 100, 1)]);
  assert.strictEqual(table[0].cohortLabel, 'Jan 2026');
});

test('does not un-swap when the day is pinned and the month varies (the sheet\'s normal convention)', () => {
  const table = buildCohortTable([row('2025-08-08', 1, 100, 0.05), row('2025-09-08', 1, 200, 0.06)]);
  assert.deepStrictEqual(table.map((r) => r.cohortLabel), ['Aug 2025', 'Sep 2025']);
});
