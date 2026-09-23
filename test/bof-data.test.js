const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchBofData } = require('../lib/bof-data');

test('BOF data uses ad-set attribution for purchases, revenue and optional reported ratios', async (t) => {
  t.mock.method(global, 'fetch', async (url) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get('use_unified_attribution_setting'), 'true');
    assert.equal(params.get('date_from'), '2026-09-15');
    assert.equal(params.get('date_to'), '2026-09-21');
    const fields = params.get('fields').split(',');
    for (const field of ['actions_omni_purchase', 'action_values_omni_purchase', 'cost_per_action_type_omni_purchase']) {
      assert.ok(fields.includes(field));
    }
    return { ok: true, json: async () => ({ data: [
      { account_id: '732629205086', ad_id: '1' },
      { account_id: 'other', ad_id: '2' },
    ] }) };
  });
  const rows = await fetchBofData({ WINDSOR_API_KEY: 'test' }, {
    dateFrom: '2026-09-15', dateTo: '2026-09-21',
  }, ['cost_per_action_type_omni_purchase']);
  assert.deepEqual(rows.map((r) => r.ad_id), ['1']);
});
