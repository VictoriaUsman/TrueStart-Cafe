// lib/render/breakdowns.js
const { renderTable } = require('./table');
const { formatMoney, formatNumber } = require('./format');

function renderBreakdownCard({ title, labelHeader, rows, cpaDecimals = 0, boldRows = false }) {
  const tableRows = rows.map((r) => ({
    label: r.label,
    spend: formatMoney(r.spend),
    ads: formatNumber(r.ads),
    purch: formatNumber(r.purch),
    cpa: r.purch > 0 ? `£${r.cpa.toFixed(cpaDecimals)}` : '–',
    roas: r.roas.toFixed(2),
  }));

  let table = renderTable({
    columns: [
      { key: 'label', label: labelHeader },
      { key: 'spend', label: 'Spend', numeric: true },
      { key: 'ads', label: 'Ads', numeric: true },
      { key: 'purch', label: 'Purch', numeric: true },
      { key: 'cpa', label: 'CPA', numeric: true },
      { key: 'roas', label: 'ROAS', numeric: true },
    ],
    rows: tableRows,
  });

  if (boldRows) {
    // Only bold body rows (which start with <td>): the lookahead keeps the
    // <thead> row's plain <tr> untouched, matching the original dashboard's
    // markup where only data rows carry class="tot".
    table = table.replace(/<tr>(?=<td)/g, '<tr class="tot">');
  }

  return `<div><h3>${title}</h3><div class="card">${table}</div></div>`;
}

function renderTwoColumn(leftHtml, rightHtml) {
  return `<div class="two">${leftHtml}${rightHtml}</div>`;
}

module.exports = { renderBreakdownCard, renderTwoColumn };
