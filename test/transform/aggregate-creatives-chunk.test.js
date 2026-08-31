// test/transform/aggregate-creatives-chunk.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { aggregateCreativesChunk } = require('../../lib/transform/aggregate-creatives-chunk');

test('sums spend, impressions, purchases, link clicks, and conversion value per ad across multiple rows', () => {
  const rows = aggregateCreativesChunk(
    [
      { ad_name: 'Ad 1', spend: 10, impressions: 100, actions_omni_purchase: 2, link_clicks: 5, action_values_omni_purchase: 40, campaign: 'Camp A', adset_name: 'Adset A' },
      { ad_name: 'Ad 1', spend: 20, impressions: 200, actions_omni_purchase: 3, link_clicks: 7, action_values_omni_purchase: 60, campaign: 'Camp A', adset_name: 'Adset A' },
    ],
    { dateFrom: '2026-08-01', dateTo: '2026-08-05' }
  );
  assert.deepStrictEqual(rows, [{
    date_start: '2026-08-01', date_stop: '2026-08-05', ad_name: 'Ad 1',
    spend: 30, impressions: 300, actions_omni_purchase: 5, adset_name: 'Adset A',
    purchase_roas_omni_purchase: 100 / 30, link_clicks: 12, campaign: 'Camp A',
    action_values_omni_purchase: 100,
  }]);
});

test('picks the campaign/adset from the highest-spend row as representative, not the first or last', () => {
  const rows = aggregateCreativesChunk(
    [
      { ad_name: 'Ad 1', spend: 5, campaign: 'Low Spend Camp', adset_name: 'Low Adset' },
      { ad_name: 'Ad 1', spend: 50, campaign: 'High Spend Camp', adset_name: 'High Adset' },
      { ad_name: 'Ad 1', spend: 15, campaign: 'Mid Spend Camp', adset_name: 'Mid Adset' },
    ],
    { dateFrom: '2026-08-01', dateTo: '2026-08-05' }
  );
  assert.strictEqual(rows[0].campaign, 'High Spend Camp');
  assert.strictEqual(rows[0].adset_name, 'High Adset');
});

test('recomputes ROAS from summed spend and conversion value, not by averaging each row\'s own ROAS', () => {
  const rows = aggregateCreativesChunk(
    [
      { ad_name: 'Ad 1', spend: 10, action_values_omni_purchase: 100, purchase_roas_omni_purchase: 10 },
      { ad_name: 'Ad 1', spend: 90, action_values_omni_purchase: 90, purchase_roas_omni_purchase: 1 },
    ],
    { dateFrom: '2026-08-01', dateTo: '2026-08-05' }
  );
  // Naive average of (10, 1) would be 5.5 — wrong. Correct: (100+90) / (10+90) = 1.9.
  assert.strictEqual(rows[0].purchase_roas_omni_purchase, 1.9);
});

test('ROAS is 0, not Infinity/NaN, when summed spend is 0', () => {
  const rows = aggregateCreativesChunk(
    [{ ad_name: 'Ad 1', spend: 0, action_values_omni_purchase: 0 }],
    { dateFrom: '2026-08-01', dateTo: '2026-08-05' }
  );
  assert.strictEqual(rows[0].purchase_roas_omni_purchase, 0);
});

test('defaults missing numeric fields to 0 (Windsor omits a field entirely when its value is zero)', () => {
  const rows = aggregateCreativesChunk(
    [{ ad_name: 'Ad 1', spend: 5, campaign: 'Camp A', adset_name: 'Adset A' }], // no impressions/purchases/link_clicks/action_values
    { dateFrom: '2026-08-01', dateTo: '2026-08-05' }
  );
  assert.deepStrictEqual(rows[0], {
    date_start: '2026-08-01', date_stop: '2026-08-05', ad_name: 'Ad 1',
    spend: 5, impressions: 0, actions_omni_purchase: 0, adset_name: 'Adset A',
    purchase_roas_omni_purchase: 0, link_clicks: 0, campaign: 'Camp A',
    action_values_omni_purchase: 0,
  });
});

test('keeps two different ads as two separate output rows', () => {
  const rows = aggregateCreativesChunk(
    [
      { ad_name: 'Ad 1', spend: 10, campaign: 'Camp A', adset_name: 'Adset A' },
      { ad_name: 'Ad 2', spend: 20, campaign: 'Camp B', adset_name: 'Adset B' },
    ],
    { dateFrom: '2026-08-01', dateTo: '2026-08-05' }
  );
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows.map((r) => r.ad_name).sort(), ['Ad 1', 'Ad 2']);
});

test('skips a row with a blank/missing ad_name instead of creating a blank-keyed entry', () => {
  const rows = aggregateCreativesChunk(
    [
      { ad_name: '', spend: 10, campaign: 'Camp A' },
      { ad_name: 'Ad 1', spend: 20, campaign: 'Camp A' },
    ],
    { dateFrom: '2026-08-01', dateTo: '2026-08-05' }
  );
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].ad_name, 'Ad 1');
});

test('returns an empty array when given no rows', () => {
  assert.deepStrictEqual(aggregateCreativesChunk([], { dateFrom: '2026-08-01', dateTo: '2026-08-05' }), []);
});
