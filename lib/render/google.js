// lib/render/google.js
const { renderKpiRow } = require('./kpis');
const { renderTable } = require('./table');
const { formatMoney, formatMoneyK, formatNumber, formatPercent } = require('./format');

function toTableRow(r) {
  return {
    campaign: r.campaign,
    type: r.type,
    cost: formatMoney(r.cost),
    impr: formatNumber(r.impr),
    clicks: formatNumber(r.clicks),
    ctr: formatPercent(r.ctr),
    conv: formatNumber(r.conv),
    convValue: formatMoney(r.convValue),
    cpa: r.conv > 0 ? `£${r.cpa.toFixed(1)}` : '–',
    roas: r.roas.toFixed(2),
  };
}

function renderGoogleTab({ rows, total }) {
  const kpiRow = renderKpiRow([
    { icon: 'Ⓖ COST · last 30d', big: formatMoneyK(total.cost), cap: 'total Google spend' },
    { icon: 'CONVERSIONS', big: formatNumber(total.conv), cap: 'Google-attributed' },
    { icon: 'CONV VALUE', big: formatMoneyK(total.convValue), cap: 'Google-attributed' },
    { icon: 'ROAS', big: total.roas.toFixed(2), cap: 'value ÷ cost (Google)' },
  ]);

  const table = renderTable({
    columns: [
      { key: 'campaign', label: 'Campaign' },
      { key: 'type', label: 'Type' },
      { key: 'cost', label: 'Cost', numeric: true },
      { key: 'impr', label: 'Impr', numeric: true },
      { key: 'clicks', label: 'Clicks', numeric: true },
      { key: 'ctr', label: 'CTR', numeric: true },
      { key: 'conv', label: 'Conv', numeric: true },
      { key: 'convValue', label: 'Conv value', numeric: true },
      { key: 'cpa', label: 'CPA', numeric: true },
      { key: 'roas', label: 'ROAS', numeric: true },
    ],
    rows: rows.map(toTableRow),
    totalRow: {
      campaign: 'Total',
      type: '',
      cost: formatMoney(total.cost),
      impr: formatNumber(total.impr),
      clicks: formatNumber(total.clicks),
      ctr: formatPercent(total.ctr),
      conv: formatNumber(total.conv),
      convValue: formatMoney(total.convValue),
      cpa: total.conv > 0 ? `£${total.cpa.toFixed(1)}` : '–',
      roas: total.roas.toFixed(2),
    },
  });

  const note = '<div class="note" style="font-size:12px">Conversions and value here are <b>Google-attributed</b> (last click within Google) and over-claim vs Shopify — treat this ROAS as directional; the blended truth is on the Performance tab.</div>';

  return `${kpiRow}<div class="card" style="overflow-x:auto;margin-top:12px">${table}</div>${note}`;
}

module.exports = { renderGoogleTab };
