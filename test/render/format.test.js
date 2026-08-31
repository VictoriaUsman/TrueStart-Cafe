// test/render/format.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { formatMoney, formatMoneyK, formatNumber, formatPercent } = require('../../lib/render/format');

test('formatMoney comma-groups to the nearest pound', () => {
  assert.strictEqual(formatMoney(12808), '£12,808');
  assert.strictEqual(formatMoney(990.4), '£990');
});

test('formatMoneyK abbreviates values at or above 1000 to one decimal', () => {
  assert.strictEqual(formatMoneyK(28700), '£28.7k');
  assert.strictEqual(formatMoneyK(104800), '£104.8k');
});

test('formatMoneyK shows full pounds below 1000', () => {
  assert.strictEqual(formatMoneyK(420), '£420');
});

test('formatNumber comma-groups integers', () => {
  assert.strictEqual(formatNumber(1599038), '1,599,038');
});

test('formatPercent renders a fraction as a one-decimal percentage', () => {
  assert.strictEqual(formatPercent(0.265), '26.5%');
  assert.strictEqual(formatPercent(1), '100.0%');
});
