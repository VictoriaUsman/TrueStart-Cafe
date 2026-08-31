// lib/transform/overview.js

const STAGES = ['TOF', 'MOF', 'BOF'];
const STATUSES = ['PROVEN', 'TESTING', 'KILL', 'Feeder', 'STARVED'];

function buildFunnelSplit(data) {
  const totalSpend = data.reduce((sum, ad) => sum + ad.spend, 0);
  return STAGES.map((stage) => {
    const ads = data.filter((ad) => ad.stage === stage);
    const spend = ads.reduce((sum, ad) => sum + ad.spend, 0);
    const val = ads.reduce((sum, ad) => sum + (ad.val || 0), 0);
    const purch = ads.reduce((sum, ad) => sum + ad.purch, 0);
    return {
      stage,
      spend,
      share: totalSpend > 0 ? spend / totalSpend : 0,
      ads: ads.length,
      purch,
      roas: spend > 0 ? val / spend : 0,
    };
  });
}

function buildStatusSpend(data) {
  const totalSpend = data.reduce((sum, ad) => sum + ad.spend, 0);
  return STATUSES.map((status) => {
    const ads = data.filter((ad) => ad.status === status);
    const spend = ads.reduce((sum, ad) => sum + ad.spend, 0);
    return {
      status,
      count: ads.length,
      spend,
      share: totalSpend > 0 ? spend / totalSpend : 0,
    };
  });
}

module.exports = { buildFunnelSplit, buildStatusSpend };
