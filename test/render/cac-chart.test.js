// test/render/cac-chart.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderCacChart } = require('../../lib/render/cac-chart');

const SERIES = [
  { month: '2026-05', label: 'May', cac: 40.83, spend: 57000, newCustomers: 1396 },
  { month: '2026-06', label: 'June', cac: 24.34, spend: 70000, newCustomers: 2876 },
  { month: '2026-07', label: 'July', cac: 22.18, spend: 44000, newCustomers: 1984 },
];

test('renders one bar per month with its CAC value and month label visible', () => {
  const html = renderCacChart(SERIES);
  assert.strictEqual((html.match(/<rect/g) || []).length, 3);
  assert.match(html, />£40\.83</);
  assert.match(html, />May</);
  assert.match(html, />£24\.34</);
  assert.match(html, />June</);
  assert.match(html, />£22\.18</);
  assert.match(html, />July</);
});

test('bar height scales with CAC value — a higher-CAC month gets a taller bar', () => {
  const html = renderCacChart(SERIES);
  const heights = [...html.matchAll(/<rect[^>]*height="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.strictEqual(heights.length, 3);
  // May (£40.83) is the highest CAC, so its bar should be the tallest.
  assert.ok(heights[0] > heights[1]);
  assert.ok(heights[1] > heights[2]);
});

test('each bar carries a hover tooltip with month, CAC, spend, and new-customer count', () => {
  const html = renderCacChart(SERIES);
  assert.match(html, /<title>May: £40\.83 CAC · £57\.0k spend · 1,396 new customers<\/title>/);
});

test('renders a graceful note instead of an empty chart when there are no complete months yet', () => {
  const html = renderCacChart([]);
  assert.doesNotMatch(html, /<svg/);
  assert.match(html, /not enough/i);
});
