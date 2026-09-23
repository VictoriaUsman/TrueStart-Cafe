const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bofRange } = require('../api/bof-range');

const env = { WINDSOR_API_KEY: 'k', META_ACCOUNT_TIMEZONE: 'Europe/London' };
const now = new Date('2026-09-22T08:00:00Z');

const rejects = (query, pattern) =>
  assert.rejects(() => bofRange(env, query, now), pattern);

test('both dates are required and must be ISO calendar dates', async () => {
  await rejects({}, /from and to are required/);
  await rejects({ from: '2026-09-01' }, /from and to are required/);
  await rejects({ from: '01/09/2026', to: '2026-09-07' }, /YYYY-MM-DD/);
  await rejects({ from: '2026-13-01', to: '2026-09-07' }, /YYYY-MM-DD/);
});

test('from must not be after to', async () => {
  await rejects({ from: '2026-09-07', to: '2026-09-01' }, /from is after to/);
});

test('the range is capped at 180 days', async () => {
  await rejects({ from: '2026-01-01', to: '2026-09-21' }, /180 days/);
});

test('to must be before today in the account timezone', async () => {
  await rejects({ from: '2026-09-15', to: '2026-09-22' }, /complete days/);
  await rejects({ from: '2026-09-15', to: '2026-09-23' }, /complete days/);
});

test('a valid range renders a table through the shared renderer', async () => {
  const real = global.fetch;
  global.fetch = async (url) => {
    assert.equal(new URL(url).searchParams.get('use_unified_attribution_setting'), 'true');
    return ({
    ok: true,
    json: async () => ({ data: [{
      account_id: '732629205086', ad_id: '1', ad_name: 'Ad',
      campaign: 'K-TS_UK_BOF_StarterMugs_ABO', spend: 400,
      actions_omni_purchase: 10, action_values_omni_purchase: 500,
    }] }),
    });
  };
  try {
    const result = await bofRange(env, { from: '2026-09-01', to: '2026-09-21' }, now);
    assert.equal(result.ok, true);
    assert.equal(result.counts.KILL, 1);
    assert.match(result.html, /calibrated for a seven-day window/);
    assert.equal(result.dateFrom, '2026-09-01');
  } finally {
    global.fetch = real;
  }
});

test('a range with no delivered ads is a successful, zeroed result — not a rejection', async () => {
  const real = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ data: [] }) });
  try {
    const result = await bofRange(env, { from: '2026-01-01', to: '2026-01-07' }, now);
    assert.equal(result.ok, true);
    assert.deepEqual(result.counts, {
      KILL: 0, RECOVERY: 0, COLD_ELIGIBLE: 0, KEEP_RUNNING: 0, UNAVAILABLE: 0,
    });
    assert.match(result.html, /no meta ads were delivered/i);
    assert.equal(result.dateFrom, '2026-01-01');
    assert.equal(result.dateTo, '2026-01-07');
  } finally {
    global.fetch = real;
  }
});

test('a missing API key is refused before any fetch is attempted', async () => {
  await assert.rejects(() => bofRange({}, { from: '2026-09-01', to: '2026-09-07' }, now));
});
