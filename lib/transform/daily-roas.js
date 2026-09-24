// lib/transform/daily-roas.js
const { toIsoDate, formatShortLabel } = require('../dates');
const { parseNumber } = require('../numbers');

function sumByDate(rows, dateKey, valueKey) {
  const map = new Map();
  for (const r of rows) {
    const date = toIsoDate(r[dateKey]);
    if (!date) continue;
    const value = parseNumber(r[valueKey]);
    map.set(date, (map.get(date) || 0) + value);
  }
  return map;
}

// start/end are optional; omitting them plots every day present, which is what
// callers without a selected reporting range want.
function buildDailyRoasSeries({ shopifyDailyRows, metaDailyRows, googleDailyRows, start = null, end = null }) {
  const salesByDate = sumByDate(shopifyDailyRows, 'Day', 'Total sales');
  const metaByDate = sumByDate(metaDailyRows, 'Day', 'Amount spent (GBP)');
  const googleByDate = sumByDate(googleDailyRows, 'Day', 'Cost');

  const allDates = [...new Set([...salesByDate.keys(), ...metaByDate.keys(), ...googleByDate.keys()])]
    .filter((date) => (start === null || date >= start) && (end === null || date <= end))
    .sort();

  const RS = [];
  const LB = [];
  for (const date of allDates) {
    const paidSpend = (metaByDate.get(date) || 0) + (googleByDate.get(date) || 0);
    // null, not 0. A day whose sales were never synced, or that had no paid spend,
    // has no blended ROAS — plotting it as 0 draws a crash that never happened.
    const hasSales = salesByDate.has(date);
    RS.push(hasSales && paidSpend > 0 ? Math.round((salesByDate.get(date) / paidSpend) * 100) / 100 : null);
    LB.push(formatShortLabel(date));
  }
  return { RS, LB };
}

module.exports = { buildDailyRoasSeries };
