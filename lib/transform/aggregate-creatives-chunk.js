// lib/transform/aggregate-creatives-chunk.js

function num(v) {
  return v === undefined || v === null ? 0 : Number(v) || 0;
}

function aggregateCreativesChunk(windsorRows, { dateFrom, dateTo }) {
  const byAdName = new Map();

  for (const row of windsorRows) {
    const adName = row.ad_name || '';
    if (!adName) continue;

    if (!byAdName.has(adName)) {
      byAdName.set(adName, {
        spend: 0, impressions: 0, purchases: 0, linkClicks: 0, actionValues: 0,
        topCampaign: '', topAdsetName: '', topSpend: -1,
      });
    }
    const agg = byAdName.get(adName);
    const spend = num(row.spend);
    agg.spend += spend;
    agg.impressions += num(row.impressions);
    agg.purchases += num(row.actions_omni_purchase);
    agg.linkClicks += num(row.link_clicks);
    agg.actionValues += num(row.action_values_omni_purchase);
    if (spend > agg.topSpend) {
      agg.topSpend = spend;
      agg.topCampaign = row.campaign || '';
      agg.topAdsetName = row.adset_name || '';
    }
  }

  return [...byAdName.entries()].map(([adName, agg]) => ({
    date_start: dateFrom,
    date_stop: dateTo,
    ad_name: adName,
    spend: agg.spend,
    impressions: agg.impressions,
    actions_omni_purchase: agg.purchases,
    adset_name: agg.topAdsetName,
    purchase_roas_omni_purchase: agg.spend > 0 ? agg.actionValues / agg.spend : 0,
    link_clicks: agg.linkClicks,
    campaign: agg.topCampaign,
    action_values_omni_purchase: agg.actionValues,
  }));
}

module.exports = { aggregateCreativesChunk };
