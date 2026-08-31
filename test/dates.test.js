// test/dates.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { toIsoDate, formatShortLabel, formatMonthLabel, isoDay, dateRange } = require('../lib/dates');

test('toIsoDate passes through an already-ISO date', () => {
  assert.strictEqual(toIsoDate('2026-02-15'), '2026-02-15');
});

test('toIsoDate converts DD-MM-YYYY to ISO', () => {
  assert.strictEqual(toIsoDate('15-02-2026'), '2026-02-15');
});

test('toIsoDate converts DD/MM/YYYY (slash-separated) to ISO', () => {
  assert.strictEqual(toIsoDate('15/02/2026'), '2026-02-15');
});

test('toIsoDate returns null instead of throwing on an unrecognized format', () => {
  assert.strictEqual(toIsoDate('Feb 15 2026'), null);
});

test('toIsoDate returns null for blank/empty input', () => {
  assert.strictEqual(toIsoDate(''), null);
});

test('toIsoDate returns null for non-string input', () => {
  assert.strictEqual(toIsoDate(undefined), null);
  assert.strictEqual(toIsoDate(null), null);
});

test('formatShortLabel renders "Mon D" style labels', () => {
  assert.strictEqual(formatShortLabel('2026-02-15'), 'Feb 15');
  assert.strictEqual(formatShortLabel('2026-08-18'), 'Aug 18');
});

test('formatMonthLabel renders the full month name for a YYYY-MM(-DD) date', () => {
  assert.strictEqual(formatMonthLabel('2026-05-01'), 'May');
  assert.strictEqual(formatMonthLabel('2026-06'), 'June');
  assert.strictEqual(formatMonthLabel('2026-07-15'), 'July');
});

test('isoDay formats a Date object as YYYY-MM-DD in UTC', () => {
  assert.strictEqual(isoDay(new Date('2026-08-31T23:59:59Z')), '2026-08-31');
});

test('dateRange returns an inclusive N-day window ending at the reference date', () => {
  const { dateFrom, dateTo } = dateRange(90, new Date('2026-08-31T12:00:00Z'));
  assert.strictEqual(dateTo, '2026-08-31');
  assert.strictEqual(dateFrom, '2026-06-03'); // 89 days before 2026-08-31
});

test('dateRange defaults the reference date to now when omitted', () => {
  const { dateTo } = dateRange(1);
  assert.strictEqual(dateTo, new Date().toISOString().slice(0, 10));
});
