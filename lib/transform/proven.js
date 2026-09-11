const { parseCreativeName } = require('./creative-parse');

function sevenDayWindow(now = new Date(), timeZone = 'Europe/London') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type) => parts.find((p) => p.type === type).value;
  const end = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { dateFrom: start.toISOString().slice(0, 10), dateTo: end.toISOString().slice(0, 10) };
}

function productForAd(name) {
  const parsed = parseCreativeName(name).product;
  if (parsed !== 'Other') return parsed;
  const matches = [...new Set((name.match(/\b(?:Taster|Starter)\b|(?:^|_)(?:Taster|Starter)(?=_|$)/gi) || []).map((v) => v.replace(/^_/, '').toLowerCase()))];
  if (matches.length > 1) throw new Error('Ambiguous product in ad name');
  return matches[0] === 'taster' ? 'Taster' : matches[0] === 'starter' ? 'Starter' : 'PDP / other';
}

function evaluateProven({ spend, purchases, product }) {
  const bar = product === 'Taster' ? 12 : product === 'Starter' ? 15 : 20;

  if (
    !Number.isFinite(spend) || spend < 0 ||
    !Number.isFinite(purchases) || purchases < 0
  ) {
    return {
      bar,
      cpa: null,
      proven: false,
      status: 'UNAVAILABLE',
      action: 'Check performance data',
      testingDailyCap: null,
      reason: 'Missing or invalid performance metrics',
    };
  }

  const cpa = purchases > 0 ? spend / purchases : null;

  const result = (status, reason, action, testingDailyCap = null) => ({
    bar,
    cpa,
    proven: status === 'PROVEN',
    status,
    reason,
    action,
    testingDailyCap,
  });

  if (spend >= 100 && purchases === 0) {
    return result(
      'KILL',
      'Seven-day spend ≥ £100 with zero purchases',
      'Pause ad'
    );
  }

  if (cpa !== null && cpa > 2 * bar) {
    return result(
      'KILL',
      `Seven-day CPA exceeds £${(2 * bar).toFixed(2)}`,
      'Pause ad'
    );
  }

  if (cpa !== null && cpa > 1.5 * bar) {
    return result(
      'DEMOTE',
      `Seven-day CPA exceeds £${(1.5 * bar).toFixed(2)}`,
      'Return to / keep in Testing — £20/day cap',
      20
    );
  }

  if (spend >= 150 && purchases >= 15 && cpa <= bar) {
    return result(
      'PROVEN',
      'All three seven-day thresholds met',
      'Eligible for Proven budget'
    );
  }

  const reasons = [];
  if (spend < 150) reasons.push('Spend below £150');
  if (purchases < 15) reasons.push('Fewer than 15 purchases');
  if (cpa !== null && cpa > bar) {
    reasons.push(`CPA above £${bar.toFixed(2)}`);
  }

  return result(
    'TESTING',
    reasons.join(' · '),
    'Continue testing'
  );
}

function buildProvenSnapshot(rows, { dateFrom, dateTo, timeZone, now = new Date() }) {
  if (!rows.length) throw new Error('Empty Meta response; previous snapshot retained');
  const ads = new Map();
  for (const row of rows) {
    if (!row.ad_id || !row.ad_name) throw new Error('Missing Meta ad ID or name');
    const spend = Number(row.spend);
    const purchases = row.actions_omni_purchase == null ? 0 : Number(row.actions_omni_purchase);
    if (!Number.isFinite(spend) || spend < 0 || !Number.isFinite(purchases) || purchases < 0) throw new Error('Invalid Meta metrics');
    const id = String(row.ad_id);
    const ad = ads.get(id) || { id, name: row.ad_name, campaign: row.campaign || '', product: productForAd(row.ad_name), spend: 0, purchases: 0 };
    if (ad.product !== productForAd(row.ad_name)) throw new Error('Conflicting products for Meta ad ID');
    ad.spend += spend;
    ad.purchases += purchases;
    ads.set(id, ad);
  }
  return { dateFrom, dateTo, timeZone, asOf: now.toISOString(), ads: [...ads.values()] };
}

module.exports = { sevenDayWindow, evaluateProven, buildProvenSnapshot, productForAd };
