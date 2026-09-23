const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sevenDayWindow, evaluateProven, buildProvenSnapshot, productForAd } = require('../../lib/transform/bof-rules');
const { provenView } = require('../../lib/render/bof-rules');

test('Proven at exactly £150/15 purchases/CPA==bar, for every product', () => {
  for (const [product, bar] of [['Taster', 12], ['Starter', 15], ['PDP / other', 20]]) {
    const r = evaluateProven({ spend: 15 * bar, purchases: 15, product });
    assert.equal(r.status, 'PROVEN');
    assert.equal(r.proven, true);
    assert.equal(r.action, 'Eligible for Proven budget');
  }
});

test('spend just under £150 is Testing, not Proven', () => {
  const r = evaluateProven({ spend: 149.99, purchases: 15, product: 'Taster' });
  assert.equal(r.status, 'TESTING');
  assert.equal(r.proven, false);
});

test('fewer than 15 purchases is Testing, not Proven', () => {
  const r = evaluateProven({ spend: 150, purchases: 14, product: 'Taster' });
  assert.equal(r.status, 'TESTING');
});

test('CPA exactly 1.5x the bar is Testing, not Demote (strictly greater-than required)', () => {
  // Taster bar 12, 1.5x = 18 -> £180 / 10 purchases = 18 exactly
  const r = evaluateProven({ spend: 180, purchases: 10, product: 'Taster' });
  assert.equal(r.status, 'TESTING');
  assert.equal(r.cpa, 18);
});

test('CPA just above 1.5x the bar is Demote', () => {
  const r = evaluateProven({ spend: 180.01, purchases: 10, product: 'Taster' });
  assert.equal(r.status, 'DEMOTE');
  assert.equal(r.action, 'Return to / keep in Testing — £20/day cap');
  assert.equal(r.testingDailyCap, 20);
});

test('CPA exactly 2x the bar is Demote, not Kill (strictly greater-than required)', () => {
  // Taster bar 12, 2x = 24 -> £240 / 10 purchases = 24 exactly
  const r = evaluateProven({ spend: 240, purchases: 10, product: 'Taster' });
  assert.equal(r.status, 'DEMOTE');
});

test('CPA just above 2x the bar is Kill', () => {
  const r = evaluateProven({ spend: 240.01, purchases: 10, product: 'Taster' });
  assert.equal(r.status, 'KILL');
  assert.equal(r.action, 'Pause ad');
});

test('spend >= £100 with zero purchases is Kill for any product, CPA stays null', () => {
  for (const product of ['Taster', 'Starter', 'PDP / other']) {
    const r = evaluateProven({ spend: 100, purchases: 0, product });
    assert.equal(r.status, 'KILL');
    assert.equal(r.cpa, null);
  }
});

test('spend just under £100 with zero purchases is Testing, not Kill', () => {
  const r = evaluateProven({ spend: 99.99, purchases: 0, product: 'Taster' });
  assert.equal(r.status, 'TESTING');
  assert.equal(r.cpa, null);
});

test('Starter demote/kill boundaries (bar £15, 1.5x=£22.50, 2x=£30)', () => {
  assert.equal(evaluateProven({ spend: 225, purchases: 10, product: 'Starter' }).status, 'TESTING');
  assert.equal(evaluateProven({ spend: 225.01, purchases: 10, product: 'Starter' }).status, 'DEMOTE');
  assert.equal(evaluateProven({ spend: 300, purchases: 10, product: 'Starter' }).status, 'DEMOTE');
  assert.equal(evaluateProven({ spend: 300.01, purchases: 10, product: 'Starter' }).status, 'KILL');
});

test('PDP / other demote/kill boundaries (bar £20, 1.5x=£30, 2x=£40)', () => {
  assert.equal(evaluateProven({ spend: 300, purchases: 10, product: 'PDP / other' }).status, 'TESTING');
  assert.equal(evaluateProven({ spend: 300.01, purchases: 10, product: 'PDP / other' }).status, 'DEMOTE');
  assert.equal(evaluateProven({ spend: 400, purchases: 10, product: 'PDP / other' }).status, 'DEMOTE');
  assert.equal(evaluateProven({ spend: 400.01, purchases: 10, product: 'PDP / other' }).status, 'KILL');
});

test('invalid or missing metrics are UNAVAILABLE, never coerced into another status', () => {
  for (const metrics of [
    { spend: NaN, purchases: 10, product: 'Taster' },
    { spend: -5, purchases: 10, product: 'Taster' },
    { spend: 100, purchases: NaN, product: 'Taster' },
    { spend: 100, purchases: -1, product: 'Taster' },
    { spend: undefined, purchases: undefined, product: 'Taster' },
  ]) {
    const r = evaluateProven(metrics);
    assert.equal(r.status, 'UNAVAILABLE');
    assert.equal(r.cpa, null);
    assert.equal(r.proven, false);
    assert.equal(r.action, 'Check performance data');
    assert.equal(r.reason, 'Missing or invalid performance metrics');
  }
});

test('Kill always wins over Demote when both conditions would independently apply', () => {
  // Zero purchases + spend >= £100 also satisfies "CPA > 2x bar" is undefined (cpa is null),
  // so this exercises the explicit zero-purchase Kill rule taking precedence over Demote/Testing.
  const r = evaluateProven({ spend: 500, purchases: 0, product: 'Taster' });
  assert.equal(r.status, 'KILL');
});

test('window uses account-local yesterday including month and DST boundaries', () => {
  assert.deepEqual(sevenDayWindow(new Date('2026-09-10T23:30:00Z')), { dateFrom: '2026-09-04', dateTo: '2026-09-10' });
  assert.deepEqual(sevenDayWindow(new Date('2026-03-30T06:00:00Z')), { dateFrom: '2026-03-23', dateTo: '2026-03-29' });
});

test('product does not require a recognized persona', () => {
  assert.equal(productForAd('New_Concept_Taster_Bags'), 'Taster');
  assert.equal(productForAd('Starter offer'), 'Starter');
  assert.equal(productForAd('PDP_Beans'), 'PDP / other');
});

const now = new Date('2026-09-11T08:00:00Z');
const options = { ...sevenDayWindow(now), timeZone: 'Europe/London', now };

test('same names remain separate by ad ID; same ID totals are summed', () => {
  const row = { ad_name: 'Taster', spend: 90, actions_omni_purchase: 8 };
  const snapshot = buildProvenSnapshot([{ ...row, ad_id: '1' }, { ...row, ad_id: '2' }, { ...row, ad_id: '1' }], options);
  assert.equal(snapshot.ads.length, 2);
  assert.equal(snapshot.ads[0].spend, 180);
  // ad '1': spend 180, purchases 16, cpa 11.25 <= £12 bar, spend>=150, purchases>=15 -> Proven.
  // ad '2': spend 90, purchases 8, cpa 11.25 but spend<150 -> Testing.
  assert.equal(provenView(snapshot, now).count, 1);
  assert.match(provenView(snapshot, now).html, /PROVEN/);
  assert.match(provenView(snapshot, now).html, /TESTING/);
  assert.equal(provenView(snapshot, new Date('2026-09-12T08:00:00Z')).count, null);
  assert.equal(provenView(null, now).count, null);
});

test('invalid responses cannot replace last good data; names are escaped', () => {
  assert.throws(() => buildProvenSnapshot([], options));
  assert.throws(() => buildProvenSnapshot([{ ad_name: 'Taster' }], options));
  assert.throws(() => buildProvenSnapshot([{ ad_id: '1', ad_name: 'Taster', spend: 'bad' }], options));
  const snapshot = buildProvenSnapshot([{ ad_id: '1', ad_name: '<script>Taster</script>', spend: 150, actions_omni_purchase: 15 }], options);
  assert.doesNotMatch(provenView(snapshot, now).html, /<script>/);
});

test('status counts cover every status and sort Kill first, then Demote, Proven, Testing', () => {
  const ads = [
    { ad_id: '1', ad_name: 'Taster A', spend: 500, actions_omni_purchase: 0 }, // Kill
    { ad_id: '2', ad_name: 'Taster B', spend: 200, actions_omni_purchase: 10 }, // Demote (cpa 20 > 18)
    { ad_id: '3', ad_name: 'Taster C', spend: 180, actions_omni_purchase: 15 }, // Proven
    { ad_id: '4', ad_name: 'Taster D', spend: 50, actions_omni_purchase: 5 }, // Testing
  ];
  const snapshot = buildProvenSnapshot(ads, options);
  const view = provenView(snapshot, now);
  assert.equal(view.counts.KILL, 1);
  assert.equal(view.counts.DEMOTE, 1);
  assert.equal(view.counts.PROVEN, 1);
  assert.equal(view.counts.TESTING, 1);
  assert.equal(view.count, view.counts.PROVEN);
  const statusesInOrder = [...view.html.matchAll(/data-status="([A-Z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(statusesInOrder, ['KILL', 'DEMOTE', 'PROVEN', 'TESTING']);
});

test('rendered table includes the status filter select and a data-status attribute per row', () => {
  const snapshot = buildProvenSnapshot([{ ad_id: '1', ad_name: 'Taster A', spend: 180, actions_omni_purchase: 15 }], options);
  const { html } = provenView(snapshot, now);
  assert.match(html, /id="performance-status"/);
  assert.match(html, /<option value="DEMOTE">Demote<\/option>/);
  assert.match(html, /data-status="PROVEN"/);
});

test('a stale or missing snapshot renders as unavailable, not as zero qualifying ads', () => {
  const stale = { ...buildProvenSnapshot([{ ad_id: '1', ad_name: 'Taster', spend: 180, actions_omni_purchase: 15 }], options), asOf: new Date(now.getTime() - 40 * 3600000).toISOString() };
  const view = provenView(stale, now);
  assert.equal(view.count, null);
  assert.equal(view.counts, null);
  assert.match(view.html, /unavailable/);
});

const { evaluateAd, rulesetFor } = require('../../lib/transform/bof-rules');

const ad = (over) => ({ campaign: 'K-TS_UK_BOF_StarterMugs_ABO', spend: 0, purchases: 0, revenue: 0, ...over });

test('campaign names are matched by prefix, so live suffixes still resolve', () => {
  assert.equal(rulesetFor('K-TS_UK_BOF_StarterMugs_ABO'), 'STARTER');
  assert.equal(rulesetFor('K-TS_UK_BOF_StarterMugs_ABO Retargeting'), 'STARTER');
  assert.equal(rulesetFor('  k-bof_cold-abo v2  '), 'COLD');
  assert.equal(rulesetFor('K-BOF_PDP-CBO'), 'PDP');
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
  const taster = (over) => ad({ campaign: 'K-TS_UK_BOF_Taster_ABO', ...over });
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
  for (const campaign of ['K-TS_UK_BOF_StarterMugs_ABO', 'K-BOF_PDP-CBO', 'K-TS_UK_BOF_Taster_ABO', 'K-BOF_Cold-ABO']) {
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

const { buildSnapshot } = require('../../lib/transform/bof-rules');

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
