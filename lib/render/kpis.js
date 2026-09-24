// lib/render/kpis.js
const { escapeHtml } = require('./table');

// bigId lets a card's value be updated in the browser after a later fetch, so a
// KPI and the table it summarises cannot end up describing different windows.
function renderKpiCard({ icon, big, cap, bigColor, chg, bigId, capId }) {
  const bigAttr = bigColor ? ` style="color:${bigColor}"` : '';
  const idAttr = bigId ? ` id="${escapeHtml(bigId)}"` : '';
  const capAttr = capId ? ` id="${escapeHtml(capId)}"` : '';
  const bigHtml = `<div class="big"${idAttr}${bigAttr}>${escapeHtml(big)}</div>`;
  const chgHtml = chg
    ? `<div class="chg${chg.cls ? ` ${chg.cls}` : ''}"${chg.style ? ` style="${chg.style}"` : ''}>${escapeHtml(chg.text)}</div>`
    : '';
  return `<div class="kpi"><div class="ic">${escapeHtml(icon)}</div>${bigHtml}<div class="cap"${capAttr}>${escapeHtml(cap)}</div>${chgHtml}</div>`;
}

function renderKpiRow(cards) {
  return `<div class="kpis">${cards.map(renderKpiCard).join('')}</div>`;
}

module.exports = { renderKpiRow };
