// lib/transform/breakdown.js

function buildBreakdown(data, keyFn) {
  const byLabel = new Map();
  for (const ad of data) {
    const label = keyFn(ad);
    if (!byLabel.has(label)) byLabel.set(label, { spend: 0, ads: 0, purch: 0, val: 0 });
    const agg = byLabel.get(label);
    agg.spend += ad.spend;
    agg.ads += 1;
    agg.purch += ad.purch;
    agg.val += ad.val || 0;
  }
  return [...byLabel.entries()]
    .map(([label, agg]) => ({
      label,
      spend: agg.spend,
      ads: agg.ads,
      purch: agg.purch,
      cpa: agg.purch > 0 ? agg.spend / agg.purch : 0,
      roas: agg.spend > 0 ? agg.val / agg.spend : 0,
    }))
    .sort((a, b) => b.spend - a.spend);
}

module.exports = { buildBreakdown };
