// lib/render/table.js

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderRow(columns, row, rowClass) {
  const cells = columns
    .map((c) => `<td${c.numeric ? ' class="n"' : ''}>${escapeHtml(row[c.key])}</td>`)
    .join('');
  return rowClass ? `<tr class="${rowClass}">${cells}</tr>` : `<tr>${cells}</tr>`;
}

function renderTable({ columns, rows, totalRow }) {
  const thead = columns.map((c) => `<th${c.numeric ? ' class="n"' : ''}>${escapeHtml(c.label)}</th>`).join('');
  const body = rows.map((r) => renderRow(columns, r)).join('');
  const total = totalRow ? renderRow(columns, totalRow, 'tot') : '';
  return `<table><thead><tr>${thead}</tr></thead><tbody>${body}${total}</tbody></table>`;
}

module.exports = { escapeHtml, renderTable };
