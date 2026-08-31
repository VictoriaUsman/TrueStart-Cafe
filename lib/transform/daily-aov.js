// lib/transform/daily-aov.js
const { toIsoDate, formatShortLabel, isoDay } = require('../dates');
const { parseNumber } = require('../numbers');

function aovByDate(rows) {
  const map = new Map();
  for (const r of rows) {
    const date = toIsoDate(r.Day);
    if (!date) continue;
    const netSales = parseNumber(r['Net sales']);
    const orders = parseNumber(r.Orders);
    map.set(date, orders > 0 ? Math.round((netSales / orders) * 100) / 100 : 0);
  }
  return map;
}

function seriesForWindow(aovMap, startIso, endIso) {
  const values = [];
  const cursor = new Date(startIso + 'T00:00:00Z');
  const end = new Date(endIso + 'T00:00:00Z');
  while (cursor <= end) {
    const date = isoDay(cursor);
    values.push(aovMap.get(date) || 0);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return values;
}

function buildDailyAovComparisonSeries({ shopifyDailyRows, start, end, prevStart, prevEnd }) {
  const aovMap = aovByDate(shopifyDailyRows);

  const current = seriesForWindow(aovMap, start, end);
  const previous = seriesForWindow(aovMap, prevStart, prevEnd);

  const labels = [];
  const cursor = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T00:00:00Z');
  while (cursor <= endDate) {
    labels.push(formatShortLabel(isoDay(cursor)));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return { current, previous, labels };
}

module.exports = { buildDailyAovComparisonSeries };
