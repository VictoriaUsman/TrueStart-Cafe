// lib/render/cohort.js
const { escapeHtml } = require('./table');
const { formatNumber, formatPercent } = require('./format');

function renderCohortTable(cohortRows) {
  const nonM0Rates = cohortRows.flatMap((r) => r.months.slice(1)).filter((v) => v !== null && v !== undefined);
  const maxRate = nonM0Rates.length ? Math.max(...nonM0Rates) : 0;

  const header =
    '<th>Cohort</th><th class="n">Size</th>' +
    Array.from({ length: 13 }, (_, i) => `<th class="n">M${i}</th>`).join('');

  const bodyRows = cohortRows
    .map((r) => {
      const cells = r.months
        .map((v, i) => {
          if (v === null || v === undefined) return '<td></td>';
          const opacity = i === 0 ? 1 : maxRate > 0 ? Math.min(1, v / maxRate) : 0;
          const color = opacity >= 0.5 ? '#fff' : '#333';
          return `<td class="n" style="background:rgba(91,91,230,${opacity.toFixed(2)});color:${color}">${formatPercent(v)}</td>`;
        })
        .join('');
      return `<tr><td>${escapeHtml(r.cohortLabel)}</td><td class="n">${formatNumber(r.size)}</td>${cells}</tr>`;
    })
    .join('');

  return `<table style="font-size:12px"><thead><tr>${header}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

module.exports = { renderCohortTable };
