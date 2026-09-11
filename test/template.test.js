// test/template.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { injectDashboard, injectIntoHtml } = require('../lib/template');

const SECTIONS = {
  provenTab: '<div>PROVEN</div>',
  kpiTop: '<div class="kpis">TOP</div>',
  googleTab: '<div>GOOGLE</div>',
  metaTab: '<div>META</div>',
  overviewTab: '<div>OVERVIEW</div>',
  insightsTab: '<div>INSIGHTS</div>',
  packprodTab: '<div>PACKPROD</div>',
  cohortTable: '<table>COHORT</table>',
  subscriptionTab: '<div>SUBS</div>',
  stockStatus: 'live · fetched now',
  cacChart: '<div class="note">CAC_CHART_PLACEHOLDER</div>',
  windowNote: '📅 KPI cards above show the last 30 days (Aug 2 – Aug 31)...',
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
  assert.match(html, /<div class="note">CAC_CHART_PLACEHOLDER<\/div>/);
  assert.doesNotMatch(html, /<!--INJECT:/);
});

test('the static, fabricated CAC bar chart (May £40.83/June £24.34/July £22.18) no longer ships in the template', () => {
  const original = require('fs').readFileSync(require.resolve('../lib/template.html'), 'utf8');
  assert.doesNotMatch(original, /£40\.83/);
  assert.doesNotMatch(original, /down ~46% since May/);
  assert.match(original, /<!--INJECT:CAC_CHART-->/);
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
  // Exercise the actual throw path against a deliberately-broken in-memory template that is
  // missing the KPI_TOP marker, rather than only asserting the marker exists in the real file.
  const brokenTemplate = '<html><body>no markers here, KPI_TOP is missing on purpose</body></html>';
  assert.throws(() => injectIntoHtml(brokenTemplate, SECTIONS, LITERALS), /Template marker <!--INJECT:KPI_TOP--> not found — has lib\/template\.html drifted\?/);
});

test('throws a descriptive error if a literal marker is missing from the template', () => {
  // Every HTML_MARKERS section is present so the loop reaches the LITERAL_MARKERS pass,
  // but no /*INJECT:...*/ markers exist at all.
  const templateWithHtmlMarkersOnly =
    '<!--INJECT:KPI_TOP--><!--INJECT:GOOGLE_TAB--><!--INJECT:META_TAB--><!--INJECT:OVERVIEW_TAB-->' +
    '<!--INJECT:INSIGHTS_TAB--><!--INJECT:PACKPROD_TAB--><!--INJECT:COHORT_TABLE--><!--INJECT:SUBSCRIPTION_TAB-->' +
    '<!--INJECT:STOCK_STATUS--><!--INJECT:CAC_CHART--><!--INJECT:WINDOW_NOTE--><!--INJECT:PROVEN_TAB--><script>no literal markers here</script>';
  assert.throws(
    () => injectIntoHtml(templateWithHtmlMarkersOnly, SECTIONS, LITERALS),
    /Template marker \/\*INJECT:DATA\*\/ not found — has lib\/template\.html drifted\?/
  );
});

test('does not throw when every marker the real template.html declares is present', () => {
  // Sanity check tying injectIntoHtml back to the real file, so the drift guard above stays
  // meaningful: if lib/template.html ever drops a marker, this fails loudly.
  const html = injectDashboard(SECTIONS, LITERALS);
  assert.ok(html);
});

test('stkLoad/stkBoot guard against a falsy STK_SNAP.asOf (Shopify outage marker) instead of rendering a false all-clear', () => {
  const original = require('fs').readFileSync(require.resolve('../lib/template.html'), 'utf8');
  // stkLoad must not overwrite the server-rendered #st_status text when there is no real snapshot.
  assert.match(original, /if\(!\(STK_SNAP&&STK_SNAP\.asOf\)\) return;/);
  // stkBoot must not call stkRender (which would print "No advertised products are OOS or low
  // right now." for an empty array) on an outage — it should show an explicit unavailable state.
  assert.match(original, /Stock data is temporarily unavailable — please refresh shortly\.<\/div>/);
});

test('redraw() recomputes filter button labels/counts from the live DATA array instead of shipping frozen static counts', () => {
  const original = require('fs').readFileSync(require.resolve('../lib/template.html'), 'utf8');
  assert.match(original, /const count=st==='All'\?DATA\.length:DATA\.filter\(x=>x\.status===st\)\.length;/);
  assert.match(original, /b\.textContent=st\+' \('\+count\+'\)';/);
});

test('ships an empty static <tbody id="tb"> instead of ~117KB of stale rows (redraw() overwrites it at load anyway)', () => {
  const original = require('fs').readFileSync(require.resolve('../lib/template.html'), 'utf8');
  assert.match(original, /<tbody id="tb"><\/tbody>/);
});

test('escapes "</script>" inside an injected literal so it cannot break out of the script tag', () => {
  const html = injectDashboard(SECTIONS, {
    ...LITERALS,
    DATA: [{ name: '</script><script>alert(1)</script>' }],
  });
  assert.doesNotMatch(html, /<\/script><script>alert/);
  assert.match(html, /\\u003c\/script>\\u003cscript>alert\(1\)\\u003c\/script>/);
});
