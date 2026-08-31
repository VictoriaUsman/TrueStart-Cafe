// test/render/cohort.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderCohortTable } = require('../../lib/render/cohort');

const ROWS = [
  { cohortLabel: 'Aug 2025', size: 1124, months: [1, 0.067, 0.072, null, ...Array(9).fill(null)] },
  { cohortLabel: 'Apr 2026', size: 985, months: [1, 0.219, 0.153, 0.117, ...Array(9).fill(null)] },
];

test('M0 is always full opacity with white text', () => {
  const html = renderCohortTable(ROWS);
  assert.match(html, /Aug 2025<\/td><td class="n">1,124<\/td><td class="n" style="background:rgba\(91,91,230,1\.00\);color:#fff">100\.0%<\/td>/);
});

test('non-M0 cells scale opacity relative to the table-wide max rate', () => {
  const html = renderCohortTable(ROWS);
  // max rate across the table is 0.219 (Apr 2026 M1) -> that cell is full opacity
  assert.match(html, /rgba\(91,91,230,1\.00\);color:#fff">21\.9%/);
  // 0.067 / 0.219 = 0.31 -> dark text
  assert.match(html, /rgba\(91,91,230,0\.31\);color:#333">6\.7%/);
});

test('cells with no data render as an empty cell', () => {
  const html = renderCohortTable(ROWS);
  assert.match(html, /<td><\/td>/);
});

test('renders one header column per cohort month plus Cohort and Size', () => {
  const html = renderCohortTable(ROWS);
  assert.match(html, /<th>Cohort<\/th><th class="n">Size<\/th><th class="n">M0<\/th>.*<th class="n">M12<\/th>/);
});
