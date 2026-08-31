// test/render/overview.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderOverviewTab } = require('../../lib/render/overview');

const FUNNEL = [
  { stage: 'TOF', spend: 7495, share: 0.261, ads: 48, purch: 24, roas: 0.06 },
  { stage: 'MOF', spend: 3802, share: 0.133, ads: 91, purch: 6, roas: 0.05 },
  { stage: 'BOF', spend: 17379, share: 0.606, ads: 260, purch: 1975, roas: 2.74 },
];
const STATUS = [
  { status: 'PROVEN', count: 12, spend: 15105, share: 0.527 },
  { status: 'TESTING', count: 18, spend: 1907, share: 0.067 },
  { status: 'KILL', count: 0, spend: 0, share: 0 },
  { status: 'Feeder', count: 139, spend: 11297, share: 0.394 },
  { status: 'STARVED', count: 230, spend: 367, share: 0.013 },
];

test('renders a funnel bar segment per stage sized by share', () => {
  const html = renderOverviewTab({ funnel: FUNNEL, statusSpend: STATUS });
  assert.match(html, /<div style="width:26\.1%;background:#7cc4e8" title="TOF"><\/div>/);
  assert.match(html, /<div style="width:60\.6%;background:#1f5f8b" title="BOF"><\/div>/);
});

test('renders the funnel table with formatted spend/share/roas', () => {
  const html = renderOverviewTab({ funnel: FUNNEL, statusSpend: STATUS });
  assert.match(html, /£17,379/);
  assert.match(html, />60\.6%</);
  assert.match(html, />2\.74</);
});

test('renders a status legend entry per status with count and spend', () => {
  const html = renderOverviewTab({ funnel: FUNNEL, statusSpend: STATUS });
  assert.match(html, /PROVEN · 12 · £15,105/);
  assert.match(html, /KILL · 0 · £0/);
});
