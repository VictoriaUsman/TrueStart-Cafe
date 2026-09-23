const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSnapshot, sevenDayWindow } = require('../../lib/transform/bof-rules');
const { bofView, renderBofTable } = require('../../lib/render/bof-rules');

const now = new Date('2026-09-22T08:00:00Z');
const options = { ...sevenDayWindow(now), timeZone: 'Europe/London', now };
const row = (over) => ({ ad_id: '1', ad_name: 'Ad', campaign: 'K-TS_UK_BOF_StarterMugs_ABO', spend: 10, actions_omni_purchase: 1, action_values_omni_purchase: 30, ...over });

test('non-BOF ads are excluded from the table and counted in the note', () => {
  const snapshot = buildSnapshot([
    row({ ad_id: '1', campaign: 'K-TS_UK_BOF_StarterMugs_ABO' }),
    row({ ad_id: '2', campaign: 'K-TS_UK_TOF_Awareness CBO' }),
    row({ ad_id: '3', campaign: 'K-TS_UK_MOF_Consideration' }),
  ], options);
  const view = bofView(snapshot, now);
  assert.equal([...view.html.matchAll(/data-status="/g)].length, 1);
  assert.match(view.html, /2 ads outside the BOF campaigns/);
});

test('rows sort Kill first, then Recovery, Cold eligible, Keep running', () => {
  const snapshot = buildSnapshot([
    row({ ad_id: '1', spend: 50, actions_omni_purchase: 5, action_values_omni_purchase: 150 }),   // CPR 10 -> Keep running
    row({ ad_id: '2', spend: 400, actions_omni_purchase: 10, action_values_omni_purchase: 500 }), // CPR 40 -> Kill
    row({ ad_id: '3', spend: 250, actions_omni_purchase: 10, action_values_omni_purchase: 600 }), // CPR 25 -> Recovery
    row({ ad_id: '4', spend: 150, actions_omni_purchase: 15, action_values_omni_purchase: 375 }), // -> Cold eligible
  ], options);
  const view = bofView(snapshot, now);
  const order = [...view.html.matchAll(/data-status="([A-Z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['KILL', 'RECOVERY', 'COLD_ELIGIBLE', 'KEEP_RUNNING']);
  assert.equal(view.counts.KILL, 1);
  assert.equal(view.counts.RECOVERY, 1);
  assert.equal(view.counts.COLD_ELIGIBLE, 1);
  assert.equal(view.counts.KEEP_RUNNING, 1);
});

test('the table shows ROAS and a dash for an undefined cost per result', () => {
  const snapshot = buildSnapshot([row({ spend: 50, actions_omni_purchase: 0, action_values_omni_purchase: 0 })], options);
  const { html } = bofView(snapshot, now);
  assert.match(html, /<th>7d ROAS<\/th>/);
  assert.match(html, /<td>—<\/td>/);
});

test('the status filter offers every status and each row carries data-status', () => {
  const snapshot = buildSnapshot([row()], options);
  const { html } = bofView(snapshot, now);
  assert.match(html, /id="performance-status"/);
  assert.match(html, /<option value="KILL">Kill<\/option>/);
  assert.match(html, /<option value="COLD_ELIGIBLE">Cold eligible<\/option>/);
  assert.match(html, /<option value="KEEP_RUNNING">Keep running<\/option>/);
});

test('a non-default window is captioned as outside the thresholds calibration', () => {
  const snapshot = buildSnapshot([row()], options);
  const def = renderBofTable({ ...snapshot, isDefaultWindow: true });
  const custom = renderBofTable({ ...snapshot, isDefaultWindow: false });
  assert.doesNotMatch(def.html, /calibrated for a seven-day window/);
  assert.match(custom.html, /calibrated for a seven-day window/);
});

test('ad names are escaped', () => {
  const snapshot = buildSnapshot([row({ ad_name: '<script>x</script>' })], options);
  assert.doesNotMatch(bofView(snapshot, now).html, /<script>/);
});

test('a stale or missing snapshot renders as unavailable, not as zero ads', () => {
  const fresh = buildSnapshot([row()], options);
  const stale = { ...fresh, asOf: new Date(now.getTime() - 40 * 3600000).toISOString() };
  assert.equal(bofView(stale, now).counts, null);
  assert.match(bofView(stale, now).html, /unavailable/);
  assert.equal(bofView(null, now).counts, null);
  assert.equal(bofView(fresh, new Date('2026-09-23T08:00:00Z')).counts, null);
});
