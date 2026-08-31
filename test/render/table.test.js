// test/render/table.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { escapeHtml, renderTable } = require('../../lib/render/table');

test('escapeHtml escapes the five HTML-significant characters', () => {
  assert.strictEqual(escapeHtml('<b>A & B "C" \'D\'</b>'), '&lt;b&gt;A &amp; B &quot;C&quot; &#39;D&#39;&lt;/b&gt;');
});

test('escapeHtml passes numbers through as strings', () => {
  assert.strictEqual(escapeHtml(42), '42');
});

test('renderTable emits a thead with labels and a tbody row per data row', () => {
  const html = renderTable({
    columns: [{ key: 'name', label: 'Campaign' }, { key: 'cost', label: 'Cost', numeric: true }],
    rows: [{ name: 'L - Search - Brand', cost: '£2,697' }],
  });
  assert.match(html, /<table>/);
  assert.match(html, /<th>Campaign<\/th><th class="n">Cost<\/th>/);
  assert.match(html, /<td>L - Search - Brand<\/td><td class="n">£2,697<\/td>/);
});

test('renderTable escapes row values', () => {
  const html = renderTable({
    columns: [{ key: 'name', label: 'Ad' }],
    rows: [{ name: '<script>alert(1)</script>' }],
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('renderTable appends an optional total row with class "tot"', () => {
  const html = renderTable({
    columns: [{ key: 'name', label: 'Campaign' }, { key: 'cost', label: 'Cost', numeric: true }],
    rows: [{ name: 'A', cost: '£1' }],
    totalRow: { name: 'Total', cost: '£1' },
  });
  assert.match(html, /<tr class="tot"><td>Total<\/td><td class="n">£1<\/td><\/tr>/);
});
