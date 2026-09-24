const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveReportingRange,
  describeCoverage,
  latestCommonDay,
  ReportingRangeError,
} = require('../lib/reporting-range');
const { toIsoDate } = require('../lib/dates');

// 2026-09-23 in Europe/London, so yesterday — the newest complete day — is the 22nd.
const now = new Date('2026-09-23T08:00:00Z');
const opts = (over = {}) => ({ timeZone: 'Europe/London', now, ...over });

test('defaults to the last 30 complete days ending at the anchor', () => {
  const r = resolveReportingRange({}, opts());
  assert.equal(r.end, '2026-09-22');
  assert.equal(r.start, '2026-08-24');
  assert.equal(r.days, 30);
  assert.equal(r.isCustom, false);
  assert.equal(r.preset, 30);
});

test('the previous period is equal length and immediately precedes the selection', () => {
  const r = resolveReportingRange({}, opts());
  assert.equal(r.prevEnd, '2026-08-23');
  assert.equal(r.prevStart, '2026-07-25');
  // No gap and no overlap: prevEnd is the day before start.
  assert.equal(new Date(r.start) - new Date(r.prevEnd), 86400000);
  const length = (a, b) => (new Date(b) - new Date(a)) / 86400000;
  assert.equal(length(r.start, r.end), length(r.prevStart, r.prevEnd));
});

test('each preset resolves to its own window with a matching comparison period', () => {
  for (const [days, start, prevStart, prevEnd] of [
    [7, '2026-09-16', '2026-09-09', '2026-09-15'],
    [30, '2026-08-24', '2026-07-25', '2026-08-23'],
    [90, '2026-06-25', '2026-03-27', '2026-06-24'],
  ]) {
    const r = resolveReportingRange({ days: String(days) }, opts());
    assert.equal(r.days, days);
    assert.equal(r.start, start);
    assert.equal(r.end, '2026-09-22');
    assert.equal(r.prevStart, prevStart);
    assert.equal(r.prevEnd, prevEnd);
    assert.equal(r.isCustom, false);
  }
});

test('an unsupported preset is rejected rather than silently falling back', () => {
  assert.throws(() => resolveReportingRange({ days: '45' }, opts()), ReportingRangeError);
  assert.throws(() => resolveReportingRange({ days: 'abc' }, opts()), ReportingRangeError);
  assert.throws(() => resolveReportingRange({ days: '7.5' }, opts()), ReportingRangeError);
});

test('a custom range is honoured exactly and marked custom', () => {
  const r = resolveReportingRange({ from: '2026-09-01', to: '2026-09-10' }, opts());
  assert.equal(r.start, '2026-09-01');
  assert.equal(r.end, '2026-09-10');
  assert.equal(r.days, 10);
  assert.equal(r.isCustom, true);
  assert.equal(r.preset, null);
  assert.equal(r.prevEnd, '2026-08-31');
  assert.equal(r.prevStart, '2026-08-22');
});

test('a single-day range counts as one day, not zero', () => {
  const r = resolveReportingRange({ from: '2026-09-10', to: '2026-09-10' }, opts());
  assert.equal(r.days, 1);
  assert.equal(r.prevStart, '2026-09-09');
  assert.equal(r.prevEnd, '2026-09-09');
});

test('rolled-over and malformed dates are rejected, not silently shifted', () => {
  for (const [from, to] of [
    ['2026-13-01', '2026-09-10'],
    ['2026-02-30', '2026-09-10'],
    ['2026-04-31', '2026-09-10'],
    ['2026-9-1', '2026-09-10'],
    ['01/09/2026', '2026-09-10'],
    ['not-a-date', '2026-09-10'],
    ['2026-09-01', '2026-02-30'],
  ]) {
    assert.throws(() => resolveReportingRange({ from, to }, opts()), ReportingRangeError, `${from}..${to}`);
  }
});

test('2026 is not a leap year, so 29 February is rejected', () => {
  assert.throws(() => resolveReportingRange({ from: '2026-02-29', to: '2026-03-01' }, opts()), ReportingRangeError);
});

test('a real leap day is accepted', () => {
  const r = resolveReportingRange({ from: '2024-02-28', to: '2024-03-01' }, opts({ latestAvailable: '2024-03-01' }));
  assert.equal(r.days, 3);
  assert.equal(r.start, '2024-02-28');
});

test('a reversed range is rejected', () => {
  assert.throws(() => resolveReportingRange({ from: '2026-09-10', to: '2026-09-01' }, opts()), ReportingRangeError);
});

test('half a custom range is rejected rather than guessing the other half', () => {
  assert.throws(() => resolveReportingRange({ from: '2026-09-01' }, opts()), ReportingRangeError);
  assert.throws(() => resolveReportingRange({ to: '2026-09-10' }, opts()), ReportingRangeError);
});

test('a range reaching today or later is rejected so partial days never mix in', () => {
  assert.throws(() => resolveReportingRange({ from: '2026-09-01', to: '2026-09-23' }, opts()), ReportingRangeError);
  assert.throws(() => resolveReportingRange({ from: '2026-09-01', to: '2026-12-01' }, opts()), ReportingRangeError);
  // The 22nd is complete and therefore fine.
  assert.equal(resolveReportingRange({ from: '2026-09-01', to: '2026-09-22' }, opts()).end, '2026-09-22');
});

test('an over-long range is rejected', () => {
  assert.throws(() => resolveReportingRange({ from: '2024-01-01', to: '2026-09-22' }, opts()), ReportingRangeError);
});

test('every rejection carries a 400 so the endpoint can answer correctly', () => {
  try {
    resolveReportingRange({ from: '2026-09-10', to: '2026-09-01' }, opts());
    assert.fail('expected a throw');
  } catch (err) {
    assert.equal(err.status, 400);
    assert.match(err.message, /after/);
  }
});

test('the anchor follows the data when the data lags behind real time', () => {
  const r = resolveReportingRange({ days: '7' }, opts({ latestAvailable: '2026-09-18' }));
  assert.equal(r.end, '2026-09-18');
  assert.equal(r.start, '2026-09-12');
});

test('a data anchor ahead of yesterday never wins — partial days stay out', () => {
  const r = resolveReportingRange({ days: '7' }, opts({ latestAvailable: '2026-09-23' }));
  assert.equal(r.end, '2026-09-22');
});

test('the timezone decides which day is yesterday at a UTC boundary', () => {
  // 13:00 UTC on the 22nd is 14:00 the same day in London (BST) but 01:00 on the 23rd in
  // Auckland (NZST, DST not yet started) — so London's yesterday is the 21st and Auckland's
  // is the 22nd. The same instant, a different reporting day.
  const boundary = new Date('2026-09-22T13:00:00Z');
  const london = resolveReportingRange({ days: '7' }, { timeZone: 'Europe/London', now: boundary });
  const auckland = resolveReportingRange({ days: '7' }, { timeZone: 'Pacific/Auckland', now: boundary });
  assert.equal(london.end, '2026-09-21');
  assert.equal(auckland.end, '2026-09-22');
});

test('a range spanning a DST change still counts calendar days', () => {
  // Europe/London leaves BST on 2026-10-25; the window is still 10 calendar days.
  const r = resolveReportingRange(
    { from: '2026-10-20', to: '2026-10-29' },
    opts({ now: new Date('2026-11-01T08:00:00Z') })
  );
  assert.equal(r.days, 10);
  assert.equal(r.prevStart, '2026-10-10');
  assert.equal(r.prevEnd, '2026-10-19');
});

test('latestCommonDay takes the oldest source, so no source is shown collapsing to zero', () => {
  assert.equal(latestCommonDay(['2026-09-22', '2026-09-20', '2026-09-21']), '2026-09-20');
  assert.equal(latestCommonDay(['2026-09-22', null, '2026-09-21']), '2026-09-21');
  assert.equal(latestCommonDay([null, null]), null);
  assert.equal(latestCommonDay([]), null);
});

test('coverage reports a source that starts after the window begins', () => {
  const rows = [{ Day: '2026-09-05' }, { Day: '2026-09-10' }];
  const c = describeCoverage(rows, { dateKey: 'Day', start: '2026-09-01', end: '2026-09-10', toIsoDate });
  assert.equal(c.complete, false);
  assert.equal(c.missingBefore, '2026-09-05');
  assert.equal(c.missingAfter, null);
});

test('coverage reports a source that stops before the window ends', () => {
  const rows = [{ Day: '2026-09-01' }, { Day: '2026-09-06' }];
  const c = describeCoverage(rows, { dateKey: 'Day', start: '2026-09-01', end: '2026-09-10', toIsoDate });
  assert.equal(c.complete, false);
  assert.equal(c.missingAfter, '2026-09-06');
});

test('coverage passes when the source spans the whole window', () => {
  const rows = [{ Day: '2026-08-30' }, { Day: '2026-09-11' }];
  const c = describeCoverage(rows, { dateKey: 'Day', start: '2026-09-01', end: '2026-09-10', toIsoDate });
  assert.equal(c.complete, true);
  assert.equal(c.empty, false);
});

test('an empty source is flagged as empty rather than as covering nothing badly', () => {
  const c = describeCoverage([], { dateKey: 'Day', start: '2026-09-01', end: '2026-09-10', toIsoDate });
  assert.equal(c.empty, true);
  assert.equal(c.complete, false);
});
