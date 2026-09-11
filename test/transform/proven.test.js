const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sevenDayWindow, evaluateProven, buildProvenSnapshot, productForAd } = require('../../lib/transform/proven');
const { provenView } = require('../../lib/render/proven');

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
