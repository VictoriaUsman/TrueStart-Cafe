// lib/transform/daily-roas.js
const { toIsoDate, formatShortLabel } = require('../dates');

function sumByDate(rows, dateKey, valueKey) {
  const map = new Map();
  for (const r of rows) {
    const date = toIsoDate(r[dateKey]);
    if (!date) continue;
    const value = parseFloat(r[valueKey]) || 0;
    map.set(date, (map.get(date) || 0) + value);
  }
  return map;
}

function buildDailyRoasSeries({ shopifyDailyRows, metaDailyRows, googleDailyRows }) {
  const salesByDate = sumByDate(shopifyDailyRows, 'Day', 'Total sales');
  const metaByDate = sumByDate(metaDailyRows, 'Day', 'Amount spent (GBP)');
  const googleByDate = sumByDate(googleDailyRows, 'Day', 'Cost');

  const allDates = [...new Set([...salesByDate.keys(), ...metaByDate.keys(), ...googleByDate.keys()])].sort();

  const RS = [];
  const LB = [];
  for (const date of allDates) {
    const sales = salesByDate.get(date) || 0;
    const paidSpend = (metaByDate.get(date) || 0) + (googleByDate.get(date) || 0);
    RS.push(paidSpend > 0 ? Math.round((sales / paidSpend) * 100) / 100 : 0);
    LB.push(formatShortLabel(date));
  }
  return { RS, LB };
}

module.exports = { buildDailyRoasSeries };
