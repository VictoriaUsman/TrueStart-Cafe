// lib/transform/daily-roas.js
const { toIsoDate, formatShortLabel } = require('../dates');
const { parseNumber } = require('../numbers');

const DAY_MS = 86400000;

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

function eachDay(startIso, endIso) {
  const out = [];
  for (let t = Date.parse(`${startIso}T00:00:00Z`); t <= Date.parse(`${endIso}T00:00:00Z`); t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// start/end are optional; omitting them spans every day present in the sources.
function buildDailyRoasSeries({ shopifyDailyRows, metaDailyRows, googleDailyRows, start = null, end = null }) {
  const salesByDate = sumByDate(shopifyDailyRows, 'Day', 'Total sales');
  const metaByDate = sumByDate(metaDailyRows, 'Day', 'Amount spent (GBP)');
  const googleByDate = sumByDate(googleDailyRows, 'Day', 'Cost');

  const present = [...new Set([...salesByDate.keys(), ...metaByDate.keys(), ...googleByDate.keys()])].sort();

  // A complete calendar axis, not just the days that happen to have rows.
  // Skipping an empty day would join the line straight across it, hiding the
  // gap rather than showing it.
  let axis;
  if (start !== null && end !== null) {
    axis = eachDay(start, end);
  } else if (present.length > 0) {
    axis = eachDay(present[0], present[present.length - 1]);
  } else {
    axis = [];
  }

  const RS = [];
  const LB = [];
  for (const date of axis) {
    LB.push(formatShortLabel(date));

    // Every source must have a row for this exact day. A row carrying 0 is a
    // sync confirming no activity and is honoured as a real zero; no row at all
    // is silence, and silence is not zero. Inferring zero from a source's
    // surrounding dates was wrong precisely where it mattered — a failed sync
    // leaves a hole in the middle of an otherwise healthy span, and filling it
    // produced a spike (missing spend) or a crash to 0x (missing sales).
    if (!salesByDate.has(date) || !metaByDate.has(date) || !googleByDate.has(date)) {
      RS.push(null);
      continue;
    }

    const paidSpend = metaByDate.get(date) + googleByDate.get(date);
    RS.push(paidSpend > 0 ? Math.round((salesByDate.get(date) / paidSpend) * 100) / 100 : null);
  }
  return { RS, LB };
}

module.exports = { buildDailyRoasSeries };
