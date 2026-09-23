const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { syncProven } = require('../api/sync-proven');
const { METRIC_BASIS } = require('../lib/transform/bof-rules');

test('scheduled BOF sync persists purchase totals with the explicit attribution basis', async (t) => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  let written;
  t.mock.method(global, 'fetch', async (url, options) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'connectors.windsor.ai') {
      assert.equal(parsed.searchParams.get('use_unified_attribution_setting'), 'true');
      assert.equal(parsed.searchParams.get('date_from'), '2026-09-16');
      assert.equal(parsed.searchParams.get('date_to'), '2026-09-22');
      return { ok: true, json: async () => ({ data: [{
        account_id: '732629205086', ad_id: '1', ad_name: 'Starter',
        campaign: 'K-TS_UK_BOF_StarterMugs_ABO', spend: 150,
        actions_omni_purchase: 15, action_values_omni_purchase: 375,
      }] }) };
    }
    if (parsed.hostname === 'oauth2.googleapis.com') {
      return { ok: true, json: async () => ({ access_token: 'test-token' }) };
    }
    assert.equal(parsed.hostname, 'sheets.googleapis.com');
    if (parsed.pathname.endsWith(':batchUpdate')) {
      written = JSON.parse(options.body);
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({ sheets: [] }) };
  });
  const result = await syncProven({
    WINDSOR_API_KEY: 'test', GOOGLE_SHEET_ID: 'test',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.com', GOOGLE_SERVICE_ACCOUNT_KEY: privateKey,
  }, new Date('2026-09-23T08:00:00Z'));
  assert.equal(result.ads, 1);
  const rows = written.requests.find((r) => r.updateCells).updateCells.rows;
  const info = JSON.parse(rows[0].values[0].userEnteredValue.stringValue);
  assert.equal(info.metricBasis, METRIC_BASIS);
  assert.deepEqual(rows[1].values.slice(4).map((cell) => cell.userEnteredValue.numberValue), [150, 15, 375]);
});
