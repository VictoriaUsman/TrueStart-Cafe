const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sevenDayWindow, buildSnapshot, productForAd } = require('../../lib/transform/bof-rules');
const { bofView } = require('../../lib/render/bof-rules');

test('window uses account-local yesterday including month and DST boundaries', () => {
  assert.deepEqual(sevenDayWindow(new Date('2026-09-10T23:30:00Z')), { dateFrom: '2026-09-04', dateTo: '2026-09-10' });
  assert.deepEqual(sevenDayWindow(new Date('2026-03-30T06:00:00Z')), { dateFrom: '2026-03-23', dateTo: '2026-03-29' });
});

test('product does not require a recognized persona', () => {
  assert.equal(productForAd('New_Concept_Taster_Bags'), 'Taster');
  assert.equal(productForAd('Starter offer'), 'Starter');
  assert.equal(productForAd('PDP_Beans'), 'PDP / other');
});

test('an ad name mentioning both products is Unknown, not a thrown error', () => {
  assert.equal(productForAd('Taster_vs_Starter_Comparison'), 'Unknown');
});

const now = new Date('2026-09-11T08:00:00Z');
const options = { ...sevenDayWindow(now), timeZone: 'Europe/London', now };

test('same names remain separate by ad ID; same ID totals are summed', () => {
  const row = { ad_name: 'Taster', spend: 90, actions_omni_purchase: 8 };
  const snapshot = buildSnapshot([{ ...row, ad_id: '1' }, { ...row, ad_id: '2' }, { ...row, ad_id: '1' }], options);
  assert.equal(snapshot.ads.length, 2);
  assert.equal(snapshot.ads[0].spend, 180);
});

test('invalid responses cannot replace last good data; names are escaped', () => {
  assert.throws(() => buildSnapshot([], options));
  assert.throws(() => buildSnapshot([{ ad_name: 'Taster' }], options));
  assert.throws(() => buildSnapshot([{ ad_id: '1', ad_name: 'Taster', spend: 'bad' }], options));
  const snapshot = buildSnapshot([{ ad_id: '1', ad_name: '<script>Taster</script>', campaign: 'K-TS_UK_BOF_StarterMugs_ABO', spend: 150, actions_omni_purchase: 15 }], options);
  const html = bofView(snapshot, now).html;
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

const { evaluateAd, rulesetFor } = require('../../lib/transform/bof-rules');

const ad = (over) => ({ campaign: 'K-TS_UK_BOF_StarterMugs_ABO', spend: 0, purchases: 0, revenue: 0, ...over });

test('campaign names are matched by prefix, so live suffixes still resolve', () => {
  assert.equal(rulesetFor('K-TS_UK_BOF_StarterMugs_ABO'), 'STARTER');
  assert.equal(rulesetFor('K-TS_UK_BOF_StarterMugs_ABO Retargeting'), 'STARTER');
  assert.equal(rulesetFor('  k-bof_cold-abo v2  '), 'COLD');
  assert.equal(rulesetFor('K-BOF_PDP-CBO'), 'PDP');
});

test('the confirmed Sales Retargeting campaign uses Taster rules, including normalized names and suffixes', () => {
  assert.equal(rulesetFor('K-TS_UK_BOF_Sales Retargeting'), 'TASTER');
  assert.equal(rulesetFor('  k-ts_uk_bof_sales retargeting  '), 'TASTER');
  assert.equal(rulesetFor('K-TS_UK_BOF_Sales Retargeting v2'), 'TASTER');
});

test('an unlisted BOF campaign falls back to the PDP ruleset', () => {
  assert.equal(rulesetFor('K-TS_UK_BOF_Something_New'), 'PDP');
  assert.equal(rulesetFor(''), 'PDP');
  assert.equal(rulesetFor(undefined), 'PDP');
});

test('Starter Mugs kill boundary is strictly above £30', () => {
  assert.equal(evaluateAd(ad({ spend: 300, purchases: 10 })).status, 'RECOVERY');
  assert.equal(evaluateAd(ad({ spend: 300.10, purchases: 10 })).status, 'KILL');
  assert.equal(evaluateAd(ad({ spend: 300.10, purchases: 10 })).action, 'Pause ad');
});

test('Starter Mugs recovery boundary is strictly above £22.50', () => {
  assert.equal(evaluateAd(ad({ spend: 225, purchases: 10 })).status, 'KEEP_RUNNING');
  assert.equal(evaluateAd(ad({ spend: 225.10, purchases: 10 })).status, 'RECOVERY');
});

test('Starter Mugs cold eligibility needs all four thresholds', () => {
  // spend 150, 15 purchases, CPR 10.00, ROAS exactly 2.5
  assert.equal(evaluateAd(ad({ spend: 150, purchases: 15, revenue: 375 })).status, 'COLD_ELIGIBLE');
  // ROAS 2.49 — just under
  assert.equal(evaluateAd(ad({ spend: 150, purchases: 15, revenue: 374 })).status, 'KEEP_RUNNING');
  // spend £149.99 — just under
  assert.equal(evaluateAd(ad({ spend: 149.99, purchases: 15, revenue: 375 })).status, 'KEEP_RUNNING');
  // 14 purchases — just under
  assert.equal(evaluateAd(ad({ spend: 150, purchases: 14, revenue: 375 })).status, 'KEEP_RUNNING');
  // CPR exactly £12.00 still qualifies
  assert.equal(evaluateAd(ad({ spend: 180, purchases: 15, revenue: 450 })).status, 'COLD_ELIGIBLE');
  // CPR £12.01 — just over; ROAS 2.55 still clears, so CPR is the only failure
  assert.equal(evaluateAd(ad({ spend: 180.15, purchases: 15, revenue: 460 })).status, 'KEEP_RUNNING');
});

test('PDP has no recovery band but the same kill and cold-eligible bars', () => {
  const pdp = (over) => ad({ campaign: 'K-BOF_PDP-CBO', ...over });
  assert.equal(evaluateAd(pdp({ spend: 250, purchases: 10 })).status, 'KEEP_RUNNING');
  assert.equal(evaluateAd(pdp({ spend: 300.10, purchases: 10 })).status, 'KILL');
  assert.equal(evaluateAd(pdp({ spend: 150, purchases: 15, revenue: 375 })).status, 'COLD_ELIGIBLE');
});

test('Taster kills above £24, recovers above £18, and is never cold eligible', () => {
  const taster = (over) => ad({ campaign: 'K-TS_UK_BOF_Sales Retargeting', ...over });
  assert.equal(evaluateAd(taster({ spend: 240, purchases: 10 })).status, 'RECOVERY');
  assert.equal(evaluateAd(taster({ spend: 240.10, purchases: 10 })).status, 'KILL');
  assert.equal(evaluateAd(taster({ spend: 180, purchases: 10 })).status, 'KEEP_RUNNING');
  assert.equal(evaluateAd(taster({ spend: 180.10, purchases: 10 })).status, 'RECOVERY');
  // Would be cold eligible under Starter/PDP rules; Taster never is.
  assert.equal(evaluateAd(taster({ spend: 150, purchases: 15, revenue: 450 })).status, 'KEEP_RUNNING');
});

test('Cold kills on spend-gated ROAS and CPR, and never recovers or qualifies as cold eligible', () => {
  const cold = (over) => ad({ campaign: 'K-BOF_Cold-ABO', ...over });
  assert.equal(evaluateAd(cold({ spend: 150, purchases: 10, revenue: 298 })).status, 'KILL');   // ROAS 1.99
  assert.equal(evaluateAd(cold({ spend: 150, purchases: 10, revenue: 300 })).status, 'KEEP_RUNNING'); // ROAS exactly 2
  assert.equal(evaluateAd(cold({ spend: 149.99, purchases: 5, revenue: 150 })).status, 'KEEP_RUNNING'); // under the spend gate
  assert.equal(evaluateAd(cold({ spend: 225.10, purchases: 10, revenue: 600 })).status, 'KILL'); // CPR 22.51
  assert.equal(evaluateAd(cold({ spend: 225, purchases: 10, revenue: 450 })).status, 'KEEP_RUNNING'); // CPR exactly 22.50
  assert.equal(evaluateAd(cold({ spend: 500, purchases: 50, revenue: 5000 })).status, 'KEEP_RUNNING');
});

test('spend >= £100 with zero purchases kills in every ruleset, CPR stays null', () => {
  for (const campaign of ['K-TS_UK_BOF_StarterMugs_ABO', 'K-BOF_PDP-CBO', 'K-TS_UK_BOF_Sales Retargeting', 'K-BOF_Cold-ABO']) {
    const r = evaluateAd(ad({ campaign, spend: 100, purchases: 0, revenue: 0 }));
    assert.equal(r.status, 'KILL');
    assert.equal(r.cpr, null);
    assert.equal(r.reason, 'Spend ≥ £100 with zero purchases');
  }
});

test('spend just under £100 with zero purchases keeps running', () => {
  const r = evaluateAd(ad({ spend: 99.99, purchases: 0, revenue: 0 }));
  assert.equal(r.status, 'KEEP_RUNNING');
  assert.equal(r.cpr, null);
});

test('invalid metrics are UNAVAILABLE and never coerced into another status', () => {
  for (const over of [
    { spend: NaN, purchases: 10, revenue: 100 },
    { spend: -5, purchases: 10, revenue: 100 },
    { spend: 100, purchases: NaN, revenue: 100 },
    { spend: 100, purchases: -1, revenue: 100 },
    { spend: 100, purchases: 10, revenue: NaN },
    { spend: 100, purchases: 10, revenue: -1 },
    { spend: undefined, purchases: undefined, revenue: undefined },
  ]) {
    const r = evaluateAd(ad(over));
    assert.equal(r.status, 'UNAVAILABLE');
    assert.equal(r.cpr, null);
    assert.equal(r.roas, null);
    assert.equal(r.action, 'Check performance data');
  }
});

test('every result carries a ruleset, a non-empty reason and an action', () => {
  const r = evaluateAd(ad({ spend: 150, purchases: 15, revenue: 375 }));
  assert.equal(r.ruleset, 'STARTER');
  assert.ok(r.reason.length > 0);
  assert.equal(r.action, 'Eligible to duplicate into K-BOF_Cold-ABO');
  assert.equal(r.cpr, 10);
  assert.equal(r.roas, 2.5);
});

test('revenue is summed per ad ID and a null revenue counts as zero', () => {
  const snapshot = buildSnapshot([
    { ad_id: '1', ad_name: 'Taster', campaign: 'K-BOF_Cold-ABO', spend: 50, actions_omni_purchase: 4, action_values_omni_purchase: 200 },
    { ad_id: '1', ad_name: 'Taster', campaign: 'K-BOF_Cold-ABO', spend: 50, actions_omni_purchase: 4, action_values_omni_purchase: 150 },
    { ad_id: '2', ad_name: 'Starter', campaign: 'K-BOF_Cold-ABO', spend: 30, actions_omni_purchase: 0, action_values_omni_purchase: null },
  ], options);
  assert.equal(snapshot.ads.length, 2);
  assert.equal(snapshot.ads[0].revenue, 350);
  assert.equal(snapshot.ads[1].revenue, 0);
});

test('rows for one ad id disagreeing on product no longer throw; the first product seen is kept', () => {
  const snapshot = buildSnapshot([
    { ad_id: '1', ad_name: 'X_Ritual_Price_Taster_Bags', campaign: 'K-BOF_Cold-ABO', spend: 50, actions_omni_purchase: 4, action_values_omni_purchase: 200 },
    { ad_id: '1', ad_name: 'X_Ritual_Price_Starter_Bags', campaign: 'K-BOF_Cold-ABO', spend: 50, actions_omni_purchase: 4, action_values_omni_purchase: 200 },
  ], options);
  assert.equal(snapshot.ads.length, 1);
  assert.equal(snapshot.ads[0].product, 'Taster');
  assert.equal(snapshot.ads[0].spend, 100);
});

test('a negative or non-numeric revenue is rejected rather than stored', () => {
  const row = { ad_id: '1', ad_name: 'Taster', campaign: 'K-BOF_Cold-ABO', spend: 50, actions_omni_purchase: 4 };
  assert.throws(() => buildSnapshot([{ ...row, action_values_omni_purchase: -1 }], options));
  assert.throws(() => buildSnapshot([{ ...row, action_values_omni_purchase: 'bad' }], options));
});

test('the campaign name is carried onto every ad so rules can key off it', () => {
  const snapshot = buildSnapshot([
    { ad_id: '1', ad_name: 'Taster', campaign: 'K-BOF_Cold-ABO v2', spend: 50, actions_omni_purchase: 4, action_values_omni_purchase: 200 },
  ], options);
  assert.equal(snapshot.ads[0].campaign, 'K-BOF_Cold-ABO v2');
});
