// lib/render/kpis.js
const { escapeHtml } = require('./table');

function renderKpiCard({ icon, big, cap, bigColor, chg }) {
  const bigAttr = bigColor ? ` style="color:${bigColor}"` : '';
  const bigHtml = `<div class="big"${bigAttr}>${escapeHtml(big)}</div>`;
  const chgHtml = chg
    ? `<div class="chg${chg.cls ? ` ${chg.cls}` : ''}"${chg.style ? ` style="${chg.style}"` : ''}>${escapeHtml(chg.text)}</div>`
    : '';
  return `<div class="kpi"><div class="ic">${escapeHtml(icon)}</div>${bigHtml}<div class="cap">${escapeHtml(cap)}</div>${chgHtml}</div>`;
}

function renderKpiRow(cards) {
  return `<div class="kpis">${cards.map(renderKpiCard).join('')}</div>`;
}

module.exports = { renderKpiRow };
