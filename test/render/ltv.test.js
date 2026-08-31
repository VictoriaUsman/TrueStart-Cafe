// test/render/ltv.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderLtvTable } = require('../../lib/render/ltv');

const LTV_ROWS = [
  { cohortLabel: 'May 2026', size: 1000, months: [20, 24, 26, null, null, null, null, null, null, null, null, null, null] },
  { cohortLabel: 'Jun 2026', size: 800, months: [20, 23, null, null, null, null, null, null, null, null, null, null, null] },
];

test('renders a heatmap table with £ cells and cohort labels/sizes', () => {
  const html = renderLtvTable(LTV_ROWS);
  assert.match(html, /May 2026/);
  assert.match(html, />1,000</);
  assert.match(html, />£20</);
  assert.match(html, />£24</);
  assert.match(html, />£26</);
  assert.match(html, /Jun 2026/);
  assert.match(html, />£23</);
});

test('renders an empty cell (not £0.00 or £null) for a month the cohort has not reached yet', () => {
  const html = renderLtvTable(LTV_ROWS);
  assert.match(html, /<td class="n"><\/td>/);
});

test('carries a caption marking the table as an estimate, not a ledger-exact figure', () => {
  const html = renderLtvTable(LTV_ROWS);
  assert.match(html, /estimat/i);
});

test('renders a graceful note instead of an empty table when there is no cohort data yet', () => {
  const html = renderLtvTable([]);
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /not enough/i);
});
