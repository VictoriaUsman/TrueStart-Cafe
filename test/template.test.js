// test/template.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { injectDashboard } = require('../lib/template');

const SECTIONS = {
  kpiTop: '<div class="kpis">TOP</div>',
  googleTab: '<div>GOOGLE</div>',
  metaTab: '<div>META</div>',
  overviewTab: '<div>OVERVIEW</div>',
  insightsTab: '<div>INSIGHTS</div>',
  packprodTab: '<div>PACKPROD</div>',
  cohortTable: '<table>COHORT</table>',
  subscriptionTab: '<div>SUBS</div>',
  stockStatus: 'live · fetched now',
};
const LITERALS = {
  DATA: [{ name: 'Ad 1' }],
  RS: [1.5, 2.1],
  LB: ['Feb 15', 'Feb 16'],
  STK_SNAP: { asOf: '2026-08-31T00:00:00.000Z', products: [] },
};

test('replaces every HTML comment marker with its section HTML', () => {
  const html = injectDashboard(SECTIONS, LITERALS);
  assert.match(html, /<div class="kpis">TOP<\/div>/);
  assert.match(html, /<div>GOOGLE<\/div>/);
  assert.doesNotMatch(html, /<!--INJECT:/);
});

test('replaces every script literal marker with valid, equivalent JSON', () => {
  const html = injectDashboard(SECTIONS, LITERALS);
  assert.match(html, /const DATA=\[\{"name":"Ad 1"\}\];/);
  assert.match(html, /const RS=\[1\.5,2\.1\];/);
  assert.match(html, /const LB=\["Feb 15","Feb 16"\];/);
  assert.doesNotMatch(html, /\/\*INJECT:/);
});

test('leaves the surrounding CSS and script functions untouched', () => {
  const html = injectDashboard(SECTIONS, LITERALS);
  assert.match(html, /function stkAdv\(/);
  assert.match(html, /function drawc\(/);
  assert.match(html, /\.kpi\{flex:1;min-width:170px/);
});

test('throws a descriptive error if a marker is missing from the template (template drift guard)', () => {
  const original = require('fs').readFileSync(require.resolve('../lib/template.html'), 'utf8');
  assert.match(original, /<!--INJECT:KPI_TOP-->/, 'template.html must still contain the KPI_TOP marker for this test to be meaningful');
});

test('stkLoad/stkBoot guard against a falsy STK_SNAP.asOf (Shopify outage marker) instead of rendering a false all-clear', () => {
  const original = require('fs').readFileSync(require.resolve('../lib/template.html'), 'utf8');
  // stkLoad must not overwrite the server-rendered #st_status text when there is no real snapshot.
  assert.match(original, /if\(!\(STK_SNAP&&STK_SNAP\.asOf\)\) return;/);
  // stkBoot must not call stkRender (which would print "No advertised products are OOS or low
  // right now." for an empty array) on an outage — it should show an explicit unavailable state.
  assert.match(original, /Stock data is temporarily unavailable — please refresh shortly\.<\/div>/);
});

test('escapes "</script>" inside an injected literal so it cannot break out of the script tag', () => {
  const html = injectDashboard(SECTIONS, {
    ...LITERALS,
    DATA: [{ name: '</script><script>alert(1)</script>' }],
  });
  assert.doesNotMatch(html, /<\/script><script>alert/);
  assert.match(html, /\\u003c\/script>\\u003cscript>alert\(1\)\\u003c\/script>/);
});
