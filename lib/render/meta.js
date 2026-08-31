// lib/render/meta.js
const { renderKpiRow } = require('./kpis');
const { formatMoneyK, formatNumber } = require('./format');

function renderMetaTab({ spend, purchases, convValue, roas }) {
  const kpiRow = renderKpiRow([
    { icon: 'ⓕ SPEND · last 30d', big: formatMoneyK(spend), cap: 'Meta spend' },
    { icon: 'PURCHASES', big: formatNumber(purchases), cap: 'Meta-attributed' },
    { icon: 'CONV VALUE', big: formatMoneyK(convValue), cap: 'Meta-attributed' },
    { icon: 'ROAS', big: roas.toFixed(2), cap: 'value ÷ spend (Meta)' },
  ]);

  const placeholder =
    '<div class="note">Per-campaign ad breakdown and cleanup recommendations (graduate/archive/duplicate ' +
    'detection) are coming soon — they need per-ad daily delivery data not yet available from the current ' +
    'data sources.</div>';

  return `${kpiRow}${placeholder}`;
}

module.exports = { renderMetaTab };
