// test/numbers.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseNumber, parseInteger } = require('../lib/numbers');

test('parseNumber parses a plain numeric string', () => {
  assert.strictEqual(parseNumber('66.34'), 66.34);
});

test('parseNumber strips thousands separators before parsing', () => {
  // Google Sheets' "Publish to web as CSV" export uses each cell's *displayed* format —
  // a column formatted with a thousands separator (a common Sheets default for numbers
  // >= 1000) exports as "13,905", which bare parseFloat would truncate at the comma.
  assert.strictEqual(parseNumber('13,905'), 13905);
  assert.strictEqual(parseNumber('1,234,567.89'), 1234567.89);
});

test('parseNumber accepts a real number, not just strings', () => {
  assert.strictEqual(parseNumber(42), 42);
});

test('parseNumber returns 0 for undefined, null, empty, or unparseable input', () => {
  assert.strictEqual(parseNumber(undefined), 0);
  assert.strictEqual(parseNumber(null), 0);
  assert.strictEqual(parseNumber(''), 0);
  assert.strictEqual(parseNumber('not a number'), 0);
});

test('parseInteger parses a plain integer string', () => {
  assert.strictEqual(parseInteger('42'), 42);
});

test('parseInteger strips thousands separators before parsing', () => {
  assert.strictEqual(parseInteger('13,905'), 13905);
});

test('parseInteger truncates a decimal string like parseInt does', () => {
  assert.strictEqual(parseInteger('42.9'), 42);
});

test('parseInteger returns 0 for undefined, null, empty, or unparseable input', () => {
  assert.strictEqual(parseInteger(undefined), 0);
  assert.strictEqual(parseInteger(null), 0);
  assert.strictEqual(parseInteger(''), 0);
  assert.strictEqual(parseInteger('not a number'), 0);
});
