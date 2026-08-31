// test/transform/windsor-to-sheet-rows.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { mapCreativesRows, mapGoogleDailyRows, mapMetaDailyRows } = require('../../lib/transform/windsor-to-sheet-rows');

test('mapCreativesRows maps a full Windsor facebook row to the Creatives column order', () => {
  const rows = mapCreativesRows([{
    date_start: '2026-06-03', date_stop: '2026-08-31', ad_name: 'BOF_ST_01_Loyal_Price_Taster_Bags V1',
    spend: 100.5, impressions: 5000, actions_omni_purchase: 25, adset_name: 'Retargeting Adset',
    purchase_roas_omni_purchase: 4.2, link_clicks: 300, campaign: 'K-TS_UK_BOF_Sales Retargeting',
    action_values_omni_purchase: 420,
  }]);
  assert.deepStrictEqual(rows, [[
    '2026-06-03', '2026-08-31', 'BOF_ST_01_Loyal_Price_Taster_Bags V1', 100.5, 5000, 25,
    'Retargeting Adset', 4.2, 300, 'K-TS_UK_BOF_Sales Retargeting', 420,
  ]]);
});

test('mapCreativesRows defaults a missing purchases/conversion-value field to 0', () => {
  const rows = mapCreativesRows([{
    date_start: '2026-08-01', date_stop: '2026-08-01', ad_name: 'Ad with no purchases',
    spend: 5, impressions: 100, adset_name: 'Adset', link_clicks: 2, campaign: 'Campaign',
    // actions_omni_purchase, purchase_roas_omni_purchase, action_values_omni_purchase all omitted
  }]);
  assert.deepStrictEqual(rows, [[
    '2026-08-01', '2026-08-01', 'Ad with no purchases', 5, 100, 0, 'Adset', 0, 2, 'Campaign', 0,
  ]]);
});

test('mapGoogleDailyRows maps a full Windsor google_ads row to the GoogleDaily column order', () => {
  const rows = mapGoogleDailyRows([{
    campaign: 'L - Search - Brand', date: '2026-08-24', currency: 'GBP', cost: 66.23,
    impressions: 2000, clicks: 80, conversions: 5, conversion_value: 250,
  }]);
  assert.deepStrictEqual(rows, [['L - Search - Brand', '2026-08-24', 'GBP', 66.23, 2000, 80, 5, 250]]);
});

test('mapGoogleDailyRows defaults missing numeric fields to 0', () => {
  const rows = mapGoogleDailyRows([{ campaign: 'L - PMax', date: '2026-08-24', currency: 'GBP', cost: 10 }]);
  assert.deepStrictEqual(rows, [['L - PMax', '2026-08-24', 'GBP', 10, 0, 0, 0, 0]]);
});

test('mapGoogleDailyRows coerces string-typed numeric fields (and an empty string) to real numbers', () => {
  const rows = mapGoogleDailyRows([{
    campaign: 'L - PMax', date: '2026-08-24', currency: 'GBP', cost: '66.23',
    impressions: '2000', clicks: '', conversions: 5, conversion_value: 250,
  }]);
  assert.deepStrictEqual(rows, [['L - PMax', '2026-08-24', 'GBP', 66.23, 2000, 0, 5, 250]]);
});

test('mapMetaDailyRows maps a full Windsor facebook daily row to the MetaDaily column order, using date for both reporting start and end', () => {
  const rows = mapMetaDailyRows([{
    campaign: 'K-TS_UK_BOF-PROVEN', date: '2026-08-24', impressions: 1000, spend: 100,
    link_clicks: 50, actions_omni_purchase: 25, action_values_omni_purchase: 400,
    purchase_roas_omni_purchase: 4,
  }]);
  assert.deepStrictEqual(rows, [[
    'K-TS_UK_BOF-PROVEN', '2026-08-24', 1000, 100, 50, 25, 400, 4, '2026-08-24', '2026-08-24',
  ]]);
});

test('mapMetaDailyRows defaults missing numeric fields to 0', () => {
  const rows = mapMetaDailyRows([{ campaign: 'Feeder', date: '2026-08-24', impressions: 500, spend: 20, link_clicks: 3 }]);
  assert.deepStrictEqual(rows, [['Feeder', '2026-08-24', 500, 20, 3, 0, 0, 0, '2026-08-24', '2026-08-24']]);
});
