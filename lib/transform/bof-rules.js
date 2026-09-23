const { parseCreativeName } = require('./creative-parse');

// Campaign-name prefix → ruleset. Live Meta campaign names carry suffixes
// ("K-TS_UK_BOF_Sales Retargeting"), so matching is by normalised prefix, not
// exact equality. No key here may be a prefix of another.
//
// OUTSTANDING (spec §8 item 1): the Taster campaign's exact name is unconfirmed.
// Until it is, Taster ads match nothing and fall to FALLBACK_RULESET, which
// scores them on PDP's bars (£30 kill, no recovery) instead of their own
// (£24 kill, £18 recovery) — and wrongly admits them to cold eligibility.
const CAMPAIGN_RULESETS = {
  'K-TS_UK_BOF_StarterMugs_ABO': 'STARTER',
  'K-BOF_PDP-CBO': 'PDP',
  'K-BOF_Cold-ABO': 'COLD',
  'K-TS_UK_BOF_Taster': 'TASTER', // PLACEHOLDER — confirm the real name
};

const FALLBACK_RULESET = 'PDP';

const RULESETS = {
  STARTER: { killCpr: 30, recoveryCpr: 22.50, coldEligible: true },
  PDP:     { killCpr: 30, recoveryCpr: null,  coldEligible: true },
  TASTER:  { killCpr: 24, recoveryCpr: 18,    coldEligible: false },
};

const ZERO_PURCHASE_KILL_SPEND = 100;
const COLD_KILL = { spend: 150, roas: 2, cpr: 22.50 };
const COLD_ELIGIBLE = { spend: 150, purchases: 15, cpr: 12, roas: 2.5 };

const ACTIONS = {
  UNAVAILABLE: 'Check performance data',
  KILL: 'Pause ad',
  RECOVERY: 'Review and reduce budget',
  COLD_ELIGIBLE: 'Eligible to duplicate into K-BOF_Cold-ABO',
  KEEP_RUNNING: 'Keep running',
};

// Longest matching prefix wins, so the result cannot depend on key order.
// An empty campaign name matches nothing (no configured key is an empty
// string) and falls through to the fallback.
function rulesetFor(campaign) {
  const name = String(campaign || '').trim().toLowerCase();
  let match = null;
  let matchedLength = -1;
  for (const [key, ruleset] of Object.entries(CAMPAIGN_RULESETS)) {
    const prefix = key.trim().toLowerCase();
    if (name.startsWith(prefix) && prefix.length > matchedLength) {
      match = ruleset;
      matchedLength = prefix.length;
    }
  }
  return match === null ? FALLBACK_RULESET : match;
}

function evaluateAd({ campaign, spend, purchases, revenue }) {
  const ruleset = rulesetFor(campaign);
  const valid = (v) => Number.isFinite(v) && v >= 0;

  if (!valid(spend) || !valid(purchases) || !valid(revenue)) {
    return {
      ruleset, cpr: null, roas: null, status: 'UNAVAILABLE',
      reason: 'Missing or invalid performance metrics', action: ACTIONS.UNAVAILABLE,
    };
  }

  const cpr = purchases > 0 ? spend / purchases : null;
  const roas = spend > 0 ? revenue / spend : null;
  const out = (status, reason) => ({ ruleset, cpr, roas, status, reason, action: ACTIONS[status] });

  // Applies to every ruleset, and fires before any CPR comparison — with zero
  // purchases CPR is null, so it could never produce this kill on its own.
  if (spend >= ZERO_PURCHASE_KILL_SPEND && purchases === 0) {
    return out('KILL', `Spend ≥ £${ZERO_PURCHASE_KILL_SPEND} with zero purchases`);
  }

  if (ruleset === 'COLD') {
    if (spend >= COLD_KILL.spend && roas !== null && roas < COLD_KILL.roas) {
      return out('KILL', `Spend ≥ £${COLD_KILL.spend} with purchase ROAS below ${COLD_KILL.roas}x`);
    }
    if (spend >= COLD_KILL.spend && cpr !== null && cpr > COLD_KILL.cpr) {
      return out('KILL', `Spend ≥ £${COLD_KILL.spend} with cost per result above £${COLD_KILL.cpr.toFixed(2)}`);
    }
    return out('KEEP_RUNNING', 'No kill rule met');
  }

  const rules = RULESETS[ruleset];

  if (cpr !== null && cpr > rules.killCpr) {
    return out('KILL', `Cost per result above £${rules.killCpr.toFixed(2)}`);
  }

  if (rules.recoveryCpr !== null && cpr !== null && cpr > rules.recoveryCpr) {
    return out('RECOVERY', `Cost per result above £${rules.recoveryCpr.toFixed(2)}`);
  }

  if (!rules.coldEligible) {
    return out('KEEP_RUNNING', 'No kill or recovery rule met');
  }

  if (
    spend >= COLD_ELIGIBLE.spend && purchases >= COLD_ELIGIBLE.purchases &&
    cpr !== null && cpr <= COLD_ELIGIBLE.cpr &&
    roas !== null && roas >= COLD_ELIGIBLE.roas
  ) {
    return out('COLD_ELIGIBLE', 'Clears all four cold-eligibility thresholds');
  }

  const missed = [];
  if (spend < COLD_ELIGIBLE.spend) missed.push(`spend below £${COLD_ELIGIBLE.spend}`);
  if (purchases < COLD_ELIGIBLE.purchases) missed.push(`fewer than ${COLD_ELIGIBLE.purchases} purchases`);
  if (cpr !== null && cpr > COLD_ELIGIBLE.cpr) missed.push(`cost per result above £${COLD_ELIGIBLE.cpr.toFixed(2)}`);
  if (roas !== null && roas < COLD_ELIGIBLE.roas) missed.push(`purchase ROAS below ${COLD_ELIGIBLE.roas}x`);
  return out('KEEP_RUNNING', `Not cold eligible: ${missed.join(' · ')}`);
}

// Single source of truth for the account's default timezone — both render
// paths (the daily cron snapshot and the live custom-range endpoint) must
// agree on it, or their windows silently diverge.
function accountTimeZone(env) {
  return (env && env.META_ACCOUNT_TIMEZONE) || 'Europe/London';
}

function sevenDayWindow(now = new Date(), timeZone = 'Europe/London') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type) => parts.find((p) => p.type === type).value;
  const end = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { dateFrom: start.toISOString().slice(0, 10), dateTo: end.toISOString().slice(0, 10) };
}

// Display-only (spec §1): the table has no Product column of its own values to
// validate against, so an ad name that mentions both products is a cosmetic
// labelling problem, not a reason to fail the request — return 'Unknown'
// rather than throw.
function productForAd(name) {
  const parsed = parseCreativeName(name).product;
  if (parsed !== 'Other') return parsed;
  const matches = [...new Set((name.match(/\b(?:Taster|Starter)\b|(?:^|_)(?:Taster|Starter)(?=_|$)/gi) || []).map((v) => v.replace(/^_/, '').toLowerCase()))];
  if (matches.length > 1) return 'Unknown';
  return matches[0] === 'taster' ? 'Taster' : matches[0] === 'starter' ? 'Starter' : 'PDP / other';
}

function buildSnapshot(rows, { dateFrom, dateTo, timeZone, now = new Date() }) {
  if (!rows.length) throw new Error('Empty Meta response; previous snapshot retained');
  const ads = new Map();
  for (const row of rows) {
    if (!row.ad_id || !row.ad_name) throw new Error('Missing Meta ad ID or name');
    const spend = Number(row.spend);
    const purchases = row.actions_omni_purchase == null ? 0 : Number(row.actions_omni_purchase);
    // A null revenue is a legitimate zero — an ad can spend and sell nothing.
    // A non-numeric or negative value is not, and must not silently become 0.
    const revenue = row.action_values_omni_purchase == null ? 0 : Number(row.action_values_omni_purchase);
    if (
      !Number.isFinite(spend) || spend < 0 ||
      !Number.isFinite(purchases) || purchases < 0 ||
      !Number.isFinite(revenue) || revenue < 0
    ) throw new Error('Invalid Meta metrics');
    const id = String(row.ad_id);
    // Product is display-only (spec §1) — keep the first product seen for this
    // ad id rather than throwing when later rows disagree with it.
    const ad = ads.get(id) || {
      id, name: row.ad_name, campaign: row.campaign || '',
      product: productForAd(row.ad_name), spend: 0, purchases: 0, revenue: 0,
    };
    ad.spend += spend;
    ad.purchases += purchases;
    ad.revenue += revenue;
    ads.set(id, ad);
  }
  return { dateFrom, dateTo, timeZone, asOf: now.toISOString(), ads: [...ads.values()] };
}

module.exports = {
  sevenDayWindow, productForAd, buildSnapshot, accountTimeZone,
  evaluateAd, rulesetFor, CAMPAIGN_RULESETS, FALLBACK_RULESET,
};
