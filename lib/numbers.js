// lib/numbers.js
// Shared numeric parsing for Sheet-sourced values. Google Sheets' "Publish to web as CSV" export
// uses each cell's *displayed* format, not its raw stored value — a column formatted with a
// thousands separator (a common Sheets default for numbers >= 1000) exports as "13,905", which
// bare parseFloat/parseInt would truncate at the comma (parseFloat("13,905") === 13). Every
// numeric field read from a Sheet-sourced row should go through one of these instead.

function stripThousands(v) {
  return String(v).replace(/,/g, '');
}

function parseNumber(v) {
  if (v === undefined || v === null) return 0;
  const n = parseFloat(stripThousands(v));
  return Number.isFinite(n) ? n : 0;
}

function parseInteger(v) {
  if (v === undefined || v === null) return 0;
  const n = parseInt(stripThousands(v), 10);
  return Number.isFinite(n) ? n : 0;
}

module.exports = { parseNumber, parseInteger };
