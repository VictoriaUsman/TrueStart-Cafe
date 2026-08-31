// test/render/aov-chart.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderAovChart } = require('../../lib/render/aov-chart');

test('renders an svg with one solid current-period path and one dashed previous-period path', () => {
  const html = renderAovChart({
    current: [20, 22, 18],
    previous: [15, 17, 16],
    labels: ['Aug 1', 'Aug 2', 'Aug 3'],
  });
  assert.match(html, /<svg/);
  assert.strictEqual((html.match(/<path/g) || []).length, 2);
  assert.match(html, /stroke-dasharray/); // the previous-period line is dashed
});

test('renders day labels along the x-axis', () => {
  const html = renderAovChart({ current: [20, 22], previous: [15, 17], labels: ['Aug 1', 'Aug 2'] });
  assert.match(html, />Aug 1</);
  assert.match(html, />Aug 2</);
});

test('each current-period point carries a hover tooltip with its date and £ AOV', () => {
  const html = renderAovChart({ current: [20.5], previous: [15], labels: ['Aug 1'] });
  assert.match(html, /<title>Aug 1: £20\.50<\/title>/);
});

test('renders a graceful note instead of an empty chart when there is no data', () => {
  const html = renderAovChart({ current: [], previous: [], labels: [] });
  assert.doesNotMatch(html, /<svg/);
  assert.match(html, /not enough/i);
});
