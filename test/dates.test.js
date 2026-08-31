// test/dates.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { toIsoDate, formatShortLabel } = require('../lib/dates');

test('toIsoDate passes through an already-ISO date', () => {
  assert.strictEqual(toIsoDate('2026-02-15'), '2026-02-15');
});

test('toIsoDate converts DD-MM-YYYY to ISO', () => {
  assert.strictEqual(toIsoDate('15-02-2026'), '2026-02-15');
});

test('toIsoDate throws on an unrecognized format', () => {
  assert.throws(() => toIsoDate('Feb 15 2026'), /Unrecognized date format/);
});

test('formatShortLabel renders "Mon D" style labels', () => {
  assert.strictEqual(formatShortLabel('2026-02-15'), 'Feb 15');
  assert.strictEqual(formatShortLabel('2026-08-18'), 'Aug 18');
});
