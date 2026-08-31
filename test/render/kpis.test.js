// test/render/kpis.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderKpiRow } = require('../../lib/render/kpis');

test('renders a basic card with icon, big value, and caption', () => {
  const html = renderKpiRow([{ icon: 'Ⓖ COST · last 30d', big: '£12.8k', cap: 'total Google spend' }]);
  assert.strictEqual(
    html,
    '<div class="kpis"><div class="kpi"><div class="ic">Ⓖ COST · last 30d</div><div class="big">£12.8k</div><div class="cap">total Google spend</div></div></div>'
  );
});

test('renders an optional change line with a class', () => {
  const html = renderKpiRow([{ icon: 'BLENDED', big: '2.53', cap: 'ROAS', chg: { text: '▲ 65% · was 1.53', cls: 'up' } }]);
  assert.match(html, /<div class="chg up">▲ 65% · was 1\.53<\/div>/);
});

test('renders an optional inline style on the big value', () => {
  const html = renderKpiRow([{ icon: 'PROVEN', big: '12', cap: 'winners', bigColor: '#1E8A4C' }]);
  assert.match(html, /<div class="big" style="color:#1E8A4C">12<\/div>/);
});

test('joins multiple cards inside one kpis container', () => {
  const html = renderKpiRow([
    { icon: 'A', big: '1', cap: 'a' },
    { icon: 'B', big: '2', cap: 'b' },
  ]);
  assert.strictEqual((html.match(/class="kpi"/g) || []).length, 2);
  assert.strictEqual((html.match(/class="kpis"/g) || []).length, 1);
});
