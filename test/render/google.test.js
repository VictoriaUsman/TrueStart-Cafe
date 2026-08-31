// test/render/google.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderGoogleTab } = require('../../lib/render/google');

const SAMPLE = {
  rows: [
    { campaign: 'L - Search - Brand', type: 'Search · brand', cost: 2697, impr: 12353, clicks: 3279, ctr: 0.265, conv: 315, convValue: 8501, cpa: 8.6, roas: 3.15 },
    { campaign: 'L - Display - Prospecting', type: 'Display', cost: 293, impr: 474051, clicks: 1521, ctr: 0.003, conv: 0, convValue: 0, cpa: 0, roas: 0 },
  ],
  total: { cost: 2990, impr: 486404, clicks: 4800, ctr: 0.01, conv: 315, convValue: 8501, cpa: 9.49, roas: 2.84 },
};

test('renders a KPI row with cost, conversions, conv value, and ROAS', () => {
  const html = renderGoogleTab(SAMPLE);
  assert.match(html, /<div class="kpis">/);
  assert.match(html, /£2,990/);
  assert.match(html, />315</);
  assert.match(html, /£8,501/);
  assert.match(html, />2\.84</);
});

test('renders one table row per campaign with formatted cells', () => {
  const html = renderGoogleTab(SAMPLE);
  assert.match(html, /L - Search - Brand/);
  assert.match(html, /£2,697/);
  assert.match(html, />12,353</);
  assert.match(html, />26\.5%</);
  assert.match(html, />315</);
  assert.match(html, />£8\.6</);
  assert.match(html, />3\.15</);
});

test('shows an en-dash for CPA when there are no conversions, but 0.00 for ROAS', () => {
  const html = renderGoogleTab(SAMPLE);
  assert.match(html, /L - Display - Prospecting[\s\S]*?<td class="n">–<\/td><td class="n">0\.00<\/td>/);
});

test('renders a total row', () => {
  const html = renderGoogleTab(SAMPLE);
  assert.match(html, /<tr class="tot"><td>Total<\/td>/);
});
