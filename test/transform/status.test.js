// test/transform/status.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { getCreativeStatus } = require('../../lib/transform/status');

test('TOF/MOF campaigns are always Feeder regardless of performance', () => {
  assert.strictEqual(
    getCreativeStatus({ campaignName: 'K-TS_UK_TOF_Awareness CBO', spend: 4036.54, purchases: 11 }),
    'Feeder'
  );
  assert.strictEqual(
    getCreativeStatus({ campaignName: 'K-TS_UK_MOF_Consideration', spend: 1207.8, purchases: 0 }),
    'Feeder'
  );
});

test('campaign naming does not establish seven-day qualification', () => {
  assert.strictEqual(
    getCreativeStatus({ campaignName: 'K-TS_UK_BOF-PROVEN', spend: 402.3, purchases: 19 }),
    'TESTING'
  );
});

test('near-zero spend in any other campaign is STARVED', () => {
  assert.strictEqual(
    getCreativeStatus({ campaignName: 'K-TS_UK_BOF_Sales Retargeting', spend: 0, purchases: 0 }),
    'STARVED'
  );
});

test('historical purchase totals do not establish seven-day qualification', () => {
  assert.strictEqual(
    getCreativeStatus({ campaignName: 'K-TS_UK_BOF_Sales Retargeting', spend: 402.3, purchases: 19 }),
    'TESTING'
  );
  assert.strictEqual(
    getCreativeStatus({ campaignName: 'K-TS_UK_BOF_Sales Retargeting', spend: 402.3, purchases: 20 }),
    'TESTING'
  );
});
