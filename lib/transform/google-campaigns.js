// lib/transform/google-campaigns.js
const { toIsoDate } = require('../dates');

function getGoogleCampaignType(name) {
  if (/pmax/i.test(name)) return 'PMax';
  if (/search/i.test(name) && /non.?brand/i.test(name)) return 'Search · non-brand';
  if (/search/i.test(name) && /brand/i.test(name)) return 'Search · brand';
  if (/shopping/i.test(name)) return 'Shopping';
  if (/display/i.test(name)) return 'Display';
  return 'Other';
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function deriveRates(agg) {
  return {
    ...agg,
    ctr: agg.impr > 0 ? agg.clicks / agg.impr : 0,
    cpa: agg.conv > 0 ? agg.cost / agg.conv : 0,
    roas: agg.cost > 0 ? agg.convValue / agg.cost : 0,
  };
}

function buildGoogleCampaignRows(rows, { start, end }) {
  const byCampaign = new Map();
  const totalAgg = { cost: 0, impr: 0, clicks: 0, conv: 0, convValue: 0 };

  for (const r of rows) {
    const date = toIsoDate(r['Day']);
    if (!date || date < start || date > end) continue;

    const campaign = r['Campaign'];
    if (!byCampaign.has(campaign)) {
      byCampaign.set(campaign, { cost: 0, impr: 0, clicks: 0, conv: 0, convValue: 0 });
    }
    const agg = byCampaign.get(campaign);
    const cost = num(r['Cost']);
    const impr = num(r['Impr.']);
    const clicks = num(r['Clicks']);
    const conv = num(r['Conversions']);
    const convValue = num(r['Conv. value']);

    agg.cost += cost;
    agg.impr += impr;
    agg.clicks += clicks;
    agg.conv += conv;
    agg.convValue += convValue;

    totalAgg.cost += cost;
    totalAgg.impr += impr;
    totalAgg.clicks += clicks;
    totalAgg.conv += conv;
    totalAgg.convValue += convValue;
  }

  const outRows = [...byCampaign.entries()].map(([campaign, agg]) => ({
    campaign,
    type: getGoogleCampaignType(campaign),
    ...deriveRates(agg),
  }));

  return { rows: outRows, total: deriveRates(totalAgg) };
}

module.exports = { getGoogleCampaignType, buildGoogleCampaignRows };
