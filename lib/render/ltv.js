// lib/render/ltv.js
const { escapeHtml } = require('./table');
const { formatMoney, formatNumber } = require('./format');

function renderLtvTable(ltvRows) {
  if (!ltvRows || ltvRows.length === 0) {
    return '<div class="note" style="font-size:12.5px">Not enough cohort data yet for a Cumulative LTV estimate — check back once cohorts have retention history.</div>';
  }

  const allValues = ltvRows.flatMap((r) => r.months).filter((v) => v !== null && v !== undefined);
  const maxValue = allValues.length ? Math.max(...allValues) : 0;

  const header =
    '<th>Cohort</th><th class="n">Size</th>' +
    Array.from({ length: 13 }, (_, i) => `<th class="n">M${i}</th>`).join('');

  const bodyRows = ltvRows
    .map((r) => {
      const cells = r.months
        .map((v) => {
          if (v === null || v === undefined) return '<td class="n"></td>';
          const opacity = maxValue > 0 ? Math.min(1, v / maxValue) : 0;
          const color = opacity >= 0.5 ? '#fff' : '#333';
          return `<td class="n" style="background:rgba(91,91,230,${opacity.toFixed(2)});color:${color}">${formatMoney(v)}</td>`;
        })
        .join('');
      return `<tr><td>${escapeHtml(r.cohortLabel)}</td><td class="n">${formatNumber(r.size)}</td>${cells}</tr>`;
    })
    .join('');

  return (
    '<div class="note" style="font-size:11.5px;margin-bottom:8px">Estimated — cumulative retention rate × average order value, not a ledger-exact figure.</div>' +
    `<table style="font-size:12px"><thead><tr>${header}</tr></thead><tbody>${bodyRows}</tbody></table>`
  );
}

module.exports = { renderLtvTable };
