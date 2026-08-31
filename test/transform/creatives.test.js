// test/transform/creatives.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildCreativesData } = require('../../lib/transform/creatives');

function row(overrides) {
  return {
    'Ad name': 'BOF_ST_19_Upgrader_Price_Starter_Bags V1',
    'Amount spent (GBP)': '100',
    'Impressions': '1000',
    'Purchases': '10',
    'Campaign name': 'K-TS_UK_BOF-PROVEN',
    'Purchases conversion value': '300',
    ...overrides,
  };
}

test('builds a single row per ad with computed cpa/roas/stage/status/persona fields', () => {
  const data = buildCreativesData([row({})]);
  assert.strictEqual(data.length, 1);
  assert.deepStrictEqual(data[0], {
    name: 'BOF_ST_19_Upgrader_Price_Starter_Bags V1',
    stage: 'BOF',
    spend: 100,
    impr: 1000,
    purch: 10,
    cpa: 10,
    roas: 3,
    product: 'Starter',
    status: 'PROVEN',
    camp: 'K-TS_UK_BOF-PROVEN',
    in_proven: true,
    persona: 'Upgrader',
    angle: 'Price',
    format: 'Bags',
    val: 300,
  });
});

test('sums duplicate ad-name rows across ad sets and keeps the highest-spend campaign', () => {
  const data = buildCreativesData([
    row({ 'Amount spent (GBP)': '600', 'Purchases': '60', 'Impressions': '6000', 'Purchases conversion value': '1800', 'Campaign name': 'K-TS_UK_BOF_Sales Retargeting' }),
    row({ 'Amount spent (GBP)': '200', 'Purchases': '20', 'Impressions': '2000', 'Purchases conversion value': '600', 'Campaign name': 'K-TS_UK_BOF-PROVEN' }),
  ]);
  assert.strictEqual(data.length, 1);
  assert.strictEqual(data[0].spend, 800);
  assert.strictEqual(data[0].purch, 80);
  assert.strictEqual(data[0].val, 2400);
  assert.strictEqual(data[0].camp, 'K-TS_UK_BOF_Sales Retargeting');
});

test('rows with no spend and no purchases get cpa 0 and roas 0, not NaN/Infinity', () => {
  const data = buildCreativesData([row({ 'Amount spent (GBP)': '0', 'Purchases': '0', 'Purchases conversion value': '0' })]);
  assert.strictEqual(data[0].cpa, 0);
  assert.strictEqual(data[0].roas, 0);
});

test('skips rows with no ad name', () => {
  const data = buildCreativesData([row({ 'Ad name': '' })]);
  assert.strictEqual(data.length, 0);
});
