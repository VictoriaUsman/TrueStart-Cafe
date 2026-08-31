// test/transform/google-campaigns.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { getGoogleCampaignType, buildGoogleCampaignRows } = require('../../lib/transform/google-campaigns');

test('getGoogleCampaignType classifies by name substring', () => {
  assert.strictEqual(getGoogleCampaignType('L - PMax - D2C Coffee'), 'PMax');
  assert.strictEqual(getGoogleCampaignType('L - Search - Brand'), 'Search · brand');
  assert.strictEqual(getGoogleCampaignType('L - Search - Non Brand'), 'Search · non-brand');
  assert.strictEqual(getGoogleCampaignType('L - Standard Shopping - Brand'), 'Shopping');
  assert.strictEqual(getGoogleCampaignType('L - Display - Prospecting'), 'Display');
  assert.strictEqual(getGoogleCampaignType('Some Other Campaign'), 'Other');
});

test('buildGoogleCampaignRows aggregates cost/impr/clicks/conv within the window, computing CPA/ROAS/CTR', () => {
  const rows = [
    { Campaign: 'L - Search - Brand', Day: '2026-07-20', Cost: '100', 'Impr.': '1000', Clicks: '50', Conversions: '10', 'Conv. value': '400' },
    { Campaign: 'L - Search - Brand', Day: '2026-07-21', Cost: '50', 'Impr.': '500', Clicks: '25', Conversions: '5', 'Conv. value': '200' },
    { Campaign: 'L - Search - Brand', Day: '2026-01-01', Cost: '999', 'Impr.': '1', Clicks: '1', Conversions: '1', 'Conv. value': '1' }, // outside window
  ];
  const { rows: out, total } = buildGoogleCampaignRows(rows, { start: '2026-07-20', end: '2026-08-18' });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].cost, 150);
  assert.strictEqual(out[0].conv, 15);
  assert.strictEqual(out[0].cpa, 10);
  assert.strictEqual(out[0].roas, 4);
  assert.strictEqual(out[0].ctr, 75 / 1500);
  assert.strictEqual(total.cost, 150);
});

test('buildGoogleCampaignRows skips a row with a blank/unparseable date instead of throwing', () => {
  const rows = [
    { Campaign: 'L - Search - Brand', Day: '2026-07-20', Cost: '100', 'Impr.': '1000', Clicks: '50', Conversions: '10', 'Conv. value': '400' },
    { Campaign: 'L - Search - Brand', Day: '', Cost: '999', 'Impr.': '1', Clicks: '1', Conversions: '1', 'Conv. value': '1' },
  ];
  const { rows: out } = buildGoogleCampaignRows(rows, { start: '2026-07-20', end: '2026-08-18' });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].cost, 100);
});

test('buildGoogleCampaignRows gives 0 (not NaN/Infinity) CPA/ROAS/CTR when conversions/cost/impr are 0', () => {
  const rows = [{ Campaign: 'X', Day: '2026-07-20', Cost: '0', 'Impr.': '0', Clicks: '0', Conversions: '0', 'Conv. value': '0' }];
  const { rows: out } = buildGoogleCampaignRows(rows, { start: '2026-07-20', end: '2026-08-18' });
  assert.strictEqual(out[0].cpa, 0);
  assert.strictEqual(out[0].roas, 0);
  assert.strictEqual(out[0].ctr, 0);
});

test('buildGoogleCampaignRows parses comma-formatted large numbers correctly (Google Sheets CSV export renders e.g. Impr. as "13,905")', () => {
  const rows = [{ Campaign: 'X', Day: '2026-07-20', Cost: '1,234.56', 'Impr.': '13,905', Clicks: '1,000', Conversions: '10', 'Conv. value': '5,000' }];
  const { rows: out } = buildGoogleCampaignRows(rows, { start: '2026-07-20', end: '2026-08-18' });
  assert.strictEqual(out[0].cost, 1234.56);
  assert.strictEqual(out[0].impr, 13905);
  assert.strictEqual(out[0].clicks, 1000);
  assert.strictEqual(out[0].convValue, 5000);
});
