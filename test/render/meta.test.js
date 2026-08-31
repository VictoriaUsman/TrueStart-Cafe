// test/render/meta.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderMetaTab } = require('../../lib/render/meta');

test('renders spend, purchases, conv value, and ROAS KPI cards', () => {
  const html = renderMetaTab({ spend: 28700, purchases: 2005, convValue: 48400, roas: 1.69 });
  assert.match(html, /£28\.7k/);
  assert.match(html, />2,005</);
  assert.match(html, /£48\.4k/);
  assert.match(html, />1\.69</);
});

test('renders a placeholder note instead of the deferred campaign-view/action-items feature', () => {
  const html = renderMetaTab({ spend: 28700, purchases: 2005, convValue: 48400, roas: 1.69 });
  assert.match(html, /coming soon/i);
});
