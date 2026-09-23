// lib/transform/creatives.js
const { getFunnelStage } = require('./stage');
const { getCreativeStatus } = require('./status');
const { parseCreativeName } = require('./creative-parse');
const { parseNumber: num } = require('../numbers');

function buildCreativesData(rawRows) {
  const byName = new Map();

  for (const raw of rawRows) {
    const name = (raw['Ad name'] || '').trim();
    if (!name) continue;

    const spend = num(raw['Amount spent (GBP)']);
    const impr = Math.round(num(raw['Impressions']));
    const purch = Math.round(num(raw['Purchases']));
    const val = num(raw['Purchases conversion value']);
    const campaignName = raw['Campaign name'] || '';

    if (!byName.has(name)) {
      byName.set(name, { spend: 0, impr: 0, purch: 0, val: 0, topCamp: campaignName, topCampSpend: -1 });
    }
    const agg = byName.get(name);
    agg.spend += spend;
    agg.impr += impr;
    agg.purch += purch;
    agg.val += val;
    if (spend > agg.topCampSpend) {
      agg.topCampSpend = spend;
      agg.topCamp = campaignName;
    }
  }

  return [...byName.entries()].map(([name, agg]) => {
    const { persona, angle, product, format } = parseCreativeName(name);
    return {
      name,
      stage: getFunnelStage(agg.topCamp),
      spend: agg.spend,
      impr: agg.impr,
      purch: agg.purch,
      cpa: agg.purch > 0 ? agg.spend / agg.purch : 0,
      roas: agg.spend > 0 ? agg.val / agg.spend : 0,
      product,
      status: getCreativeStatus({ campaignName: agg.topCamp, spend: agg.spend }),
      camp: agg.topCamp,
      persona,
      angle,
      format,
      val: agg.val,
    };
  });
}

module.exports = { buildCreativesData };
