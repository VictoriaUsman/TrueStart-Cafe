// test/render/subscription.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderSubscriptionTab } = require('../../lib/render/subscription');

test('renders AOV and new-customer-share KPI cards', () => {
  const html = renderSubscriptionTab({ aov: 19.37, newCustomers: 5088, returningCustomers: 3046 });
  assert.match(html, /£19\.37/);
  assert.match(html, />62\.6%</); // 5088 / 8134
  assert.match(html, /5,088 new of 8,134/);
});

test('labels the new-customer-share caption and new-vs-returning table with the real 90d window, not the stale 60d one', () => {
  const html = renderSubscriptionTab({ aov: 19.37, newCustomers: 5088, returningCustomers: 3046 });
  assert.match(html, /\(last 90d\)/);
  assert.doesNotMatch(html, /60d/);
});

test('renders the new-vs-returning table with counts and shares', () => {
  const html = renderSubscriptionTab({ aov: 19.37, newCustomers: 5088, returningCustomers: 3046 });
  assert.match(html, /New customer/);
  assert.match(html, />5,088</);
  assert.match(html, />62\.6%</);
  assert.match(html, /Returning customer/);
  assert.match(html, />3,046</);
});

test('renders a placeholder note instead of a fabricated Cumulative LTV table', () => {
  const html = renderSubscriptionTab({ aov: 19.37, newCustomers: 5088, returningCustomers: 3046 });
  assert.match(html, /Cumulative LTV/);
  assert.match(html, /not yet available/i);
});

test('renders the existing subscriber-metrics placeholder note', () => {
  const html = renderSubscriptionTab({ aov: 19.37, newCustomers: 5088, returningCustomers: 3046 });
  assert.match(html, /Recharge/);
});
