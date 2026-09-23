// Read-only reconciliation against Meta purchase CPR/ROAS reported by Windsor.
// node --env-file=.env --env-file=.env.local scripts/verify-bof.js [from to]
const assert = require('node:assert/strict');
const { fetchBofData } = require('../lib/bof-data');
const { accountTimeZone, sevenDayWindow, buildSnapshot, evaluateAd } = require('../lib/transform/bof-rules');
const { getFunnelStage } = require('../lib/transform/stage');

async function main() {
  const timeZone = accountTimeZone(process.env);
  const [from, to] = process.argv.slice(2);
  assert.equal(Boolean(from), Boolean(to), 'Provide both from and to, or neither');
  const window = from ? { dateFrom: from, dateTo: to } : sevenDayWindow(new Date(), timeZone);
  const rows = await fetchBofData(process.env, window, [
    'cost_per_action_type_omni_purchase', 'purchase_roas_omni_purchase',
  ]);
  const bof = rows.filter((row) => getFunnelStage(row.campaign) === 'BOF');
  assert.ok(bof.length, 'No BOF rows returned; cannot verify metrics');
  const mismatches = [];
  let cprChecked = 0;
  let roasChecked = 0;
  for (const row of bof) {
    const ad = buildSnapshot([row], { ...window, timeZone }).ads[0];
    const result = evaluateAd(ad);
    const check = (metric, actual, expected) => {
      // Meta reports these ratios rounded to four decimal places.
      if (!Number.isFinite(actual) || expected == null || !Number.isFinite(Number(expected)) ||
          Math.abs(actual - Number(expected)) > 0.0001) {
        mismatches.push({ id: ad.id, campaign: ad.campaign, metric, calculated: actual, reported: expected ?? null });
      }
    };
    if (ad.purchases > 0) {
      check('CPR', result.cpr, row.cost_per_action_type_omni_purchase);
      cprChecked++;
    } else if (row.cost_per_action_type_omni_purchase != null && Number(row.cost_per_action_type_omni_purchase) !== 0) {
      mismatches.push({ id: ad.id, metric: 'CPR', reason: 'Reported CPR without purchases' });
    }
    if (ad.spend > 0 && (ad.revenue > 0 || row.purchase_roas_omni_purchase != null)) {
      check('ROAS', result.roas, row.purchase_roas_omni_purchase);
      roasChecked++;
    }
  }
  assert.ok(cprChecked > 0 && roasChecked > 0, 'No non-zero purchase metrics to reconcile');
  console.log(JSON.stringify({
    ...window, timeZone, attribution: 'ad-set', rows: bof.length, cprChecked, roasChecked,
    campaigns: [...new Set(bof.map((row) => row.campaign))], mismatches,
  }, null, 2));
  if (mismatches.length) process.exitCode = 1;
}

main().catch(() => {
  // Never print API URLs or credentials if a request fails.
  console.error('BOF verification failed. Check credentials, dates, and connector availability.');
  process.exitCode = 1;
});
