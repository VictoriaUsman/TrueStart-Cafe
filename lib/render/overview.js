// lib/render/overview.js
const { renderTable, escapeHtml } = require('./table');
const { formatMoney, formatPercent, formatNumber } = require('./format');

const STAGE_COLOR = { TOF: '#7cc4e8', MOF: '#4a90c2', BOF: '#1f5f8b' };
const STATUS_COLOR = { PROVEN: '#1E8A4C', TESTING: '#C98A00', KILL: '#C0392B', Feeder: '#2b6cb0', STARVED: '#8a8a8a' };
const STAGE_LABEL = { TOF: 'TOF · Awareness', MOF: 'MOF · Consideration', BOF: 'BOF · Conversion' };

function renderOverviewTab({ funnel, statusSpend }) {
  const funnelBar = `<div class="bar">${funnel
    .map((f) => `<div style="width:${(f.share * 100).toFixed(1)}%;background:${STAGE_COLOR[f.stage]}" title="${f.stage}"></div>`)
    .join('')}</div>`;

  const funnelTable = renderTable({
    columns: [
      { key: 'stage', label: 'Stage' },
      { key: 'spend', label: 'Spend', numeric: true },
      { key: 'share', label: 'Share', numeric: true },
      { key: 'ads', label: 'Ads', numeric: true },
      { key: 'purch', label: 'Purch', numeric: true },
      { key: 'roas', label: 'ROAS', numeric: true },
    ],
    rows: funnel.map((f) => ({
      stage: STAGE_LABEL[f.stage],
      spend: formatMoney(f.spend),
      share: formatPercent(f.share),
      ads: formatNumber(f.ads),
      purch: formatNumber(f.purch),
      roas: f.roas.toFixed(2),
    })),
  });

  const statusBar = `<div class="bar">${statusSpend
    .map((s) => `<div style="width:${(s.share * 100).toFixed(1)}%;background:${STATUS_COLOR[s.status]}" title="${s.status}"></div>`)
    .join('')}</div>`;

  const legend = `<div class="legend">${statusSpend
    .map((s) => `<span class="lg2"><i style="background:${STATUS_COLOR[s.status]}"></i>${escapeHtml(s.status)} · ${s.count} · ${formatMoney(s.spend)}</span>`)
    .join('')}</div>`;

  return (
    `${funnelBar}<div class="card" style="margin-top:10px">${funnelTable}</div>` +
    `<h2>Spend by status</h2>${statusBar}${legend}`
  );
}

module.exports = { renderOverviewTab };
