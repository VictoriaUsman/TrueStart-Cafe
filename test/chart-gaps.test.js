// Third review round: charts were plotting missing history as zero, and the Kill
// KPI kept a "last 7 days" heading after a custom-range update.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDailyRoasSeries } = require('../lib/transform/daily-roas');
const { buildDailyAovComparisonSeries } = require('../lib/transform/daily-aov');
const { renderAovChart } = require('../lib/render/aov-chart');
const { renderKpiRow } = require('../lib/render/kpis');

const readTemplate = () => require('fs').readFileSync(require.resolve('../lib/template.html'), 'utf8');

// --- ROAS series ----------------------------------------------------------

test('a day with spend but no synced sales is a gap, not a zero ROAS', () => {
  // Google reports on both days so only Shopify's second day is missing, which
  // isolates the sales gap from the all-sources-missing case below.
  const { RS } = buildDailyRoasSeries({
    shopifyDailyRows: [{ Day: '2026-09-01', 'Total sales': '400' }],
    metaDailyRows: [{ Day: '2026-09-01', 'Amount spent (GBP)': '100' }, { Day: '2026-09-02', 'Amount spent (GBP)': '100' }],
    googleDailyRows: [{ Day: '2026-09-01', Cost: '0' }, { Day: '2026-09-02', Cost: '0' }],
  });
  assert.deepEqual(RS, [4, null]);
  assert.ok(!RS.includes(0), 'a missing sales day must not plot as 0');
});

test('a day with sales but no spend is a gap, not a zero ROAS', () => {
  const { RS } = buildDailyRoasSeries({
    shopifyDailyRows: [{ Day: '2026-09-01', 'Total sales': '400' }],
    metaDailyRows: [], googleDailyRows: [],
  });
  assert.deepEqual(RS, [null]);
});

test('ROAS values are never Infinity or NaN', () => {
  const { RS } = buildDailyRoasSeries({
    shopifyDailyRows: [{ Day: '2026-09-01', 'Total sales': '400' }],
    metaDailyRows: [{ Day: '2026-09-02', 'Amount spent (GBP)': '0' }],
    googleDailyRows: [],
  });
  assert.ok(RS.every((v) => v === null || Number.isFinite(v)));
});

// --- AOV series -----------------------------------------------------------

test('days absent from the source are gaps in both AOV series', () => {
  const { current, previous } = buildDailyAovComparisonSeries({
    shopifyDailyRows: [{ Day: '2026-09-02', 'Net sales': '200', Orders: '10' }],
    start: '2026-09-01', end: '2026-09-02', prevStart: '2026-08-30', prevEnd: '2026-08-31',
  });
  assert.deepEqual(current, [null, 20]);
  assert.deepEqual(previous, [null, null], 'an unsynced comparison period must not plot as £0');
});

// --- Chart rendering ------------------------------------------------------

test('the AOV line breaks at a gap instead of dropping to the axis', () => {
  const gapped = renderAovChart({ current: [20, null, 25], previous: [20, 20, 20], labels: ['a', 'b', 'c'] });
  const solid = renderAovChart({ current: [20, 22, 25], previous: [20, 20, 20], labels: ['a', 'b', 'c'] });
  const movesIn = (svg) => (svg.match(/d="([^"]*)"[^>]*stroke="#5b5be6"/)[1].match(/M/g) || []).length;
  // A continuous series is one subpath; a gapped one must be lifted into two.
  assert.equal(movesIn(solid), 1);
  assert.equal(movesIn(gapped), 2, 'a gap must start a new subpath rather than draw through the axis');
});

test('a gap contributes no hover point, so nothing reports £0.00 for a missing day', () => {
  const html = renderAovChart({ current: [20, null, 25], previous: [null, null, null], labels: ['a', 'b', 'c'] });
  assert.doesNotMatch(html, /£0\.00/);
  assert.equal((html.match(/<title>/g) || []).length, 2, 'only the two known days get a tooltip');
});

test('an all-gap comparison period draws no dashed line and says why', () => {
  const html = renderAovChart({ current: [20, 25], previous: [null, null], labels: ['a', 'b'] });
  assert.doesNotMatch(html, /stroke-dasharray/);
  assert.match(html, /comparison line is broken where the previous period has no synced data/);
});

test('an entirely unknown series renders a message rather than a flat zero line', () => {
  const html = renderAovChart({ current: [null, null], previous: [null, null], labels: ['a', 'b'] });
  assert.match(html, /No daily sales data in this range/);
});

test('the ROAS chart script skips nulls rather than plotting them', () => {
  const tpl = readTemplate();
  // pth() lifts the pen on a gap.
  assert.match(tpl, /if\(v===null\|\|v===undefined\)\{drawing=false;return;\}/);
  // The filled area implies continuity, so it is dropped when the series has gaps.
  assert.match(tpl, /if\(hasGap\)\{ad=''\;\}/);
  // No marker or tooltip for a day with no value.
  assert.match(tpl, /if\(v===null\|\|v===undefined\)return;const xy0/);
});

// --- Kill KPI heading -----------------------------------------------------

test('the Kill card heading is addressable', () => {
  const html = renderKpiRow([{ icon: '🛑 KILL · last 7 days', iconId: 'kpi-kill-icon', big: '3', cap: 'c' }]);
  assert.match(html, /<div class="ic" id="kpi-kill-icon">/);
});

test('the Kill heading is rewritten with the fetched window, not left on seven days', () => {
  const tpl = readTemplate();
  assert.match(tpl, /killIcon\.textContent=/);
  assert.match(tpl, /KILL \\u00b7 '\+d\.dateFrom\+' to '\+d\.dateTo/);
});

test('the rewritten heading uses the same glyph the server rendered', () => {
  const tpl = readTemplate();
  const escaped = tpl.match(/killIcon\.textContent='([^']*)'/)[1];
  // eslint-disable-next-line no-eval
  const rendered = eval(`'${escaped}'`);
  assert.ok(rendered.startsWith('🛑 KILL'), `expected the stop glyph, got ${JSON.stringify(rendered)}`);
});

// --- Fourth review round: spend coverage and a complete calendar axis ------

test('a source with no rows at all makes blended ROAS unavailable, not inflated', () => {
  // £1,000 sales against £100 Meta spend with Google missing reported 10x,
  // because an unsynced source was summed as £0 of spend.
  const { RS } = buildDailyRoasSeries({
    shopifyDailyRows: [{ Day: '2026-09-01', 'Total sales': '1000' }],
    metaDailyRows: [{ Day: '2026-09-01', 'Amount spent (GBP)': '100' }],
    googleDailyRows: [],
  });
  assert.deepEqual(RS, [null]);
  assert.ok(!RS.includes(10), 'missing Google spend must not inflate ROAS to 10x');
});

test('a confirmed zero-spend day is distinguished from an unsynced one', () => {
  // Google reports £0 on the 2nd, so that day is known and spend is Meta's alone.
  // The 3rd lies outside Google's reporting span, so it is unknown.
  const { RS } = buildDailyRoasSeries({
    shopifyDailyRows: [
      { Day: '2026-09-01', 'Total sales': '400' },
      { Day: '2026-09-02', 'Total sales': '400' },
      { Day: '2026-09-03', 'Total sales': '400' },
    ],
    metaDailyRows: [
      { Day: '2026-09-01', 'Amount spent (GBP)': '100' },
      { Day: '2026-09-02', 'Amount spent (GBP)': '100' },
      { Day: '2026-09-03', 'Amount spent (GBP)': '100' },
    ],
    googleDailyRows: [{ Day: '2026-09-01', Cost: '100' }, { Day: '2026-09-02', Cost: '0' }],
  });
  assert.deepEqual(RS, [2, 4, null]);
});

test('a day missing from every source still occupies the axis as a gap', () => {
  // Sep 1-3 with nothing on the 2nd used to yield two points joined across the
  // hole, hiding it. The axis must show three days, the middle one empty.
  const { RS, LB } = buildDailyRoasSeries({
    shopifyDailyRows: [{ Day: '2026-09-01', 'Total sales': '400' }, { Day: '2026-09-03', 'Total sales': '400' }],
    metaDailyRows: [{ Day: '2026-09-01', 'Amount spent (GBP)': '100' }, { Day: '2026-09-03', 'Amount spent (GBP)': '100' }],
    googleDailyRows: [{ Day: '2026-09-01', Cost: '0' }, { Day: '2026-09-03', Cost: '0' }],
    start: '2026-09-01', end: '2026-09-03',
  });
  assert.equal(RS.length, 3);
  assert.equal(LB.length, 3);
  assert.deepEqual(LB, ['Sep 1', 'Sep 2', 'Sep 3']);
  assert.equal(RS[1], null, 'the missing day must be a gap, not absent from the axis');
});

test('the axis is filled even without an explicit range', () => {
  const { LB } = buildDailyRoasSeries({
    shopifyDailyRows: [{ Day: '2026-09-01', 'Total sales': '400' }, { Day: '2026-09-04', 'Total sales': '400' }],
    metaDailyRows: [{ Day: '2026-09-01', 'Amount spent (GBP)': '100' }, { Day: '2026-09-04', 'Amount spent (GBP)': '100' }],
    googleDailyRows: [{ Day: '2026-09-01', Cost: '0' }, { Day: '2026-09-04', Cost: '0' }],
  });
  assert.deepEqual(LB, ['Sep 1', 'Sep 2', 'Sep 3', 'Sep 4']);
});

// --- Fifth review round: a hole inside a source's span is still a hole -----

// Three days, all sources reporting, so each case below differs only by the one
// row it removes from the middle.
const threeDays = (over = {}) => ({
  shopifyDailyRows: [
    { Day: '2026-09-01', 'Total sales': '1000' },
    { Day: '2026-09-02', 'Total sales': '1000' },
    { Day: '2026-09-03', 'Total sales': '1000' },
  ],
  metaDailyRows: [
    { Day: '2026-09-01', 'Amount spent (GBP)': '100' },
    { Day: '2026-09-02', 'Amount spent (GBP)': '100' },
    { Day: '2026-09-03', 'Amount spent (GBP)': '100' },
  ],
  googleDailyRows: [
    { Day: '2026-09-01', Cost: '0' },
    { Day: '2026-09-02', Cost: '0' },
    { Day: '2026-09-03', Cost: '0' },
  ],
  start: '2026-09-01',
  end: '2026-09-03',
  ...over,
});

test('all three sources reporting gives a value on every day', () => {
  // The control: without it the three gap tests below could pass on a bug that
  // nulls everything.
  const { RS } = buildDailyRoasSeries(threeDays());
  assert.deepEqual(RS, [10, 10, 10]);
});

test('a Google row missing mid-span is a gap, not a spend-free spike', () => {
  const { RS } = buildDailyRoasSeries(threeDays({
    googleDailyRows: [{ Day: '2026-09-01', Cost: '0' }, { Day: '2026-09-03', Cost: '0' }],
  }));
  assert.deepEqual(RS, [10, null, 10]);
});

test('a Meta row missing mid-span is a gap, not a partial-spend inflation', () => {
  // Google must spend something here. With Google at £0 a missing Meta row makes
  // total spend zero, which nulls the day for an unrelated reason and would let
  // this test pass against the very behaviour it is meant to catch.
  const googleFifty = [
    { Day: '2026-09-01', Cost: '50' },
    { Day: '2026-09-02', Cost: '50' },
    { Day: '2026-09-03', Cost: '50' },
  ];
  const control = buildDailyRoasSeries(threeDays({ googleDailyRows: googleFifty })).RS;
  assert.deepEqual(control, [6.67, 6.67, 6.67], '£1000 over £150 of spend');

  const { RS } = buildDailyRoasSeries(threeDays({
    googleDailyRows: googleFifty,
    metaDailyRows: [
      { Day: '2026-09-01', 'Amount spent (GBP)': '100' },
      { Day: '2026-09-03', 'Amount spent (GBP)': '100' },
    ],
  }));
  assert.deepEqual(RS, [6.67, null, 6.67]);
  assert.ok(!RS.includes(20), 'dividing by Google spend alone would report 20x');
});

test('a Shopify row missing mid-span is a gap, not a crash to 0x', () => {
  const { RS } = buildDailyRoasSeries(threeDays({
    shopifyDailyRows: [
      { Day: '2026-09-01', 'Total sales': '1000' },
      { Day: '2026-09-03', 'Total sales': '1000' },
    ],
  }));
  assert.deepEqual(RS, [10, null, 10]);
  assert.ok(!RS.includes(0), 'a missing sales day must never render as 0x');
});

test('a row present with zero is honoured as a confirmed zero, unlike an absent row', () => {
  // The distinction the whole rule rests on: Google reporting £0 on the 2nd
  // still computes, because a synced zero is knowledge. Only silence is a gap.
  const withZero = buildDailyRoasSeries(threeDays()).RS;
  const withAbsence = buildDailyRoasSeries(threeDays({
    googleDailyRows: [{ Day: '2026-09-01', Cost: '0' }, { Day: '2026-09-03', Cost: '0' }],
  })).RS;
  assert.equal(withZero[1], 10);
  assert.equal(withAbsence[1], null);
});
