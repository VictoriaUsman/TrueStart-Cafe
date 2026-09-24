const { test } = require('node:test');
const assert = require('node:assert/strict');
const { filterCreativeBlocks } = require('../../lib/transform/creatives-window');
const { toIsoDate } = require('../../lib/dates');

const block = (start, stop, name = 'Ad') => ({
  'Reporting starts': start,
  'Reporting ends': stop,
  'Ad name': name,
  'Amount spent (GBP)': 100,
});

test('keeps only blocks lying entirely inside the range', () => {
  const rows = [
    block('2026-09-01', '2026-09-05', 'inside-a'),
    block('2026-09-06', '2026-09-10', 'inside-b'),
    block('2026-08-27', '2026-08-31', 'before'),
    block('2026-09-11', '2026-09-15', 'after'),
  ];
  const r = filterCreativeBlocks(rows, { start: '2026-09-01', end: '2026-09-10', toIsoDate });
  assert.deepEqual(r.rows.map((x) => x['Ad name']), ['inside-a', 'inside-b']);
  assert.equal(r.exact, true);
  assert.equal(r.excluded, 0);
});

test('a block straddling the start edge is excluded, never prorated', () => {
  const rows = [block('2026-08-30', '2026-09-03', 'straddles-start'), block('2026-09-06', '2026-09-10', 'inside')];
  const r = filterCreativeBlocks(rows, { start: '2026-09-01', end: '2026-09-10', toIsoDate });
  assert.deepEqual(r.rows.map((x) => x['Ad name']), ['inside']);
  assert.equal(r.excluded, 1);
  // The straddling block's spend must not appear in any form.
  assert.equal(r.rows.reduce((sum, x) => sum + x['Amount spent (GBP)'], 0), 100);
});

test('a block straddling the end edge is excluded too', () => {
  const rows = [block('2026-09-01', '2026-09-05', 'inside'), block('2026-09-06', '2026-09-12', 'straddles-end')];
  const r = filterCreativeBlocks(rows, { start: '2026-09-01', end: '2026-09-10', toIsoDate });
  assert.deepEqual(r.rows.map((x) => x['Ad name']), ['inside']);
  assert.equal(r.excluded, 1);
});

test('reports the days actually covered when the range cuts through blocks', () => {
  const rows = [block('2026-08-30', '2026-09-03'), block('2026-09-04', '2026-09-08'), block('2026-09-09', '2026-09-13')];
  const r = filterCreativeBlocks(rows, { start: '2026-09-01', end: '2026-09-10', toIsoDate });
  assert.equal(r.coveredStart, '2026-09-04');
  assert.equal(r.coveredEnd, '2026-09-08');
  assert.equal(r.exact, false);
  assert.equal(r.excluded, 2);
});

test('a range aligned to block boundaries reports exact coverage', () => {
  const rows = [block('2026-09-01', '2026-09-05'), block('2026-09-06', '2026-09-10')];
  const r = filterCreativeBlocks(rows, { start: '2026-09-01', end: '2026-09-10', toIsoDate });
  assert.equal(r.exact, true);
  assert.equal(r.coveredStart, '2026-09-01');
  assert.equal(r.coveredEnd, '2026-09-10');
});

test('a block exactly equal to the range is kept', () => {
  const r = filterCreativeBlocks([block('2026-09-01', '2026-09-05')], { start: '2026-09-01', end: '2026-09-05', toIsoDate });
  assert.equal(r.rows.length, 1);
  assert.equal(r.exact, true);
});

test('blocks entirely outside the range are not counted as excluded overlaps', () => {
  const rows = [block('2026-01-01', '2026-01-05'), block('2026-12-01', '2026-12-05')];
  const r = filterCreativeBlocks(rows, { start: '2026-09-01', end: '2026-09-10', toIsoDate });
  assert.equal(r.rows.length, 0);
  assert.equal(r.excluded, 0);
  assert.equal(r.coveredStart, null);
});

test('a sheet with no usable block columns reports undated rather than returning everything', () => {
  const rows = [{ 'Ad name': 'A', 'Amount spent (GBP)': 100 }, { 'Ad name': 'B', 'Amount spent (GBP)': 50 }];
  const r = filterCreativeBlocks(rows, { start: '2026-09-01', end: '2026-09-10', toIsoDate });
  assert.equal(r.dated, false);
  assert.equal(r.rows.length, 0);
});

test('alternative header spellings are accepted', () => {
  const rows = [{ date_start: '2026-09-01', date_stop: '2026-09-05', 'Ad name': 'A' }];
  const r = filterCreativeBlocks(rows, { start: '2026-09-01', end: '2026-09-10', toIsoDate });
  assert.equal(r.dated, true);
  assert.equal(r.rows.length, 1);
});

test('day-first sheet dates are understood', () => {
  const rows = [{ 'Reporting starts': '01-09-2026', 'Reporting ends': '05-09-2026', 'Ad name': 'A' }];
  const r = filterCreativeBlocks(rows, { start: '2026-09-01', end: '2026-09-10', toIsoDate });
  assert.equal(r.rows.length, 1);
  assert.equal(r.coveredStart, '2026-09-01');
});

test('reversed block bounds are normalised rather than dropped', () => {
  const rows = [{ 'Reporting starts': '2026-09-05', 'Reporting ends': '2026-09-01', 'Ad name': 'A' }];
  const r = filterCreativeBlocks(rows, { start: '2026-09-01', end: '2026-09-10', toIsoDate });
  assert.equal(r.rows.length, 1);
  assert.equal(r.coveredStart, '2026-09-01');
  assert.equal(r.coveredEnd, '2026-09-05');
});
