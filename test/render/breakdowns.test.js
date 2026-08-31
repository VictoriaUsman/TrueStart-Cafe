// test/render/breakdowns.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderBreakdownCard, renderTwoColumn } = require('../../lib/render/breakdowns');

const ROWS = [{ label: 'Price', spend: 10491, ads: 21, purch: 1282, cpa: 8.18, roas: 3.01 }];

test('renders a titled card with a table using the given label header', () => {
  const html = renderBreakdownCard({ title: 'By angle', labelHeader: 'Angle', rows: ROWS });
  assert.match(html, /<h3>By angle<\/h3>/);
  assert.match(html, /<th>Angle<\/th>/);
  assert.match(html, /Price/);
  assert.match(html, /£10,491/);
});

test('cpaDecimals controls CPA precision (0 for angle/persona, 2 for pack/product)', () => {
  const zeroDp = renderBreakdownCard({ title: 'By angle', labelHeader: 'Angle', rows: ROWS, cpaDecimals: 0 });
  assert.match(zeroDp, />£8</);
  const twoDp = renderBreakdownCard({ title: 'By pack type', labelHeader: 'Pack', rows: ROWS, cpaDecimals: 2 });
  assert.match(twoDp, />£8\.18</);
});

test('boldRows renders every row with class "tot" (used for the pack-type table)', () => {
  const html = renderBreakdownCard({ title: 'By pack type', labelHeader: 'Pack', rows: ROWS, boldRows: true });
  assert.match(html, /<tr class="tot">/);
});

test('renderTwoColumn places two card htmls directly inside a .two container', () => {
  const html = renderTwoColumn('<div>LEFT</div>', '<div>RIGHT</div>');
  assert.strictEqual(html, '<div class="two"><div>LEFT</div><div>RIGHT</div></div>');
});
