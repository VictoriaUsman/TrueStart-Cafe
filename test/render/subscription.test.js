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

test('renders the real Cumulative LTV table when cohort data is available', () => {
  const html = renderSubscriptionTab({
    aov: 19.37, newCustomers: 5088, returningCustomers: 3046,
    ltvRows: [{ cohortLabel: 'May 2026', size: 1000, months: [20, 24, null, null, null, null, null, null, null, null, null, null, null] }],
  });
  assert.match(html, /Cumulative LTV/);
  assert.match(html, /May 2026/);
  assert.match(html, />£20</);
  assert.doesNotMatch(html, /not yet available/i);
});

test('renders a graceful note instead of a Cumulative LTV table when there is no cohort data yet', () => {
  const html = renderSubscriptionTab({ aov: 19.37, newCustomers: 5088, returningCustomers: 3046, ltvRows: [] });
  assert.match(html, /Cumulative LTV/);
  assert.match(html, /not enough/i);
});

test('renders the existing subscriber-metrics placeholder note', () => {
  const html = renderSubscriptionTab({ aov: 19.37, newCustomers: 5088, returningCustomers: 3046 });
  assert.match(html, /Recharge/);
});
