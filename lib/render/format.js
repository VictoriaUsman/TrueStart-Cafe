// lib/render/format.js

function formatNumber(n) {
  return Math.round(n).toLocaleString('en-GB');
}

function formatMoney(n) {
  return `£${formatNumber(n)}`;
}

function formatMoneyK(n) {
  if (Math.abs(n) < 1000) return `£${Math.round(n)}`;
  return `£${(n / 1000).toFixed(1)}k`;
}

function formatPercent(fraction) {
  return `${(fraction * 100).toFixed(1)}%`;
}

module.exports = { formatMoney, formatMoneyK, formatNumber, formatPercent };
