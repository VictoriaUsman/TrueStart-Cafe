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

// The span a source actually reports over. Inside it, a day with no row is a
// genuine zero — Windsor and Shopify both omit rows for days with no activity.
// Outside it, the same absence means the day was never synced, which is not a
// zero and must not be treated as one.
function spanOf(map) {
  if (map.size === 0) return null;
  const dates = [...map.keys()].sort();
  return { first: dates[0], last: dates[dates.length - 1] };
}

function covers(span, date) {
  return span !== null && date >= span.first && date <= span.last;
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

  const salesSpan = spanOf(salesByDate);
  const metaSpan = spanOf(metaByDate);
  const googleSpan = spanOf(googleByDate);

  const RS = [];
  const LB = [];
  for (const date of axis) {
    LB.push(formatShortLabel(date));

    // Blended ROAS needs all three sources to have reported for this day. If any
    // of them simply has not synced it, the sum is not a smaller spend figure —
    // it is an unknown one, and dividing by it invents a return.
    if (!covers(salesSpan, date) || !covers(metaSpan, date) || !covers(googleSpan, date)) {
      RS.push(null);
      continue;
    }

    const paidSpend = (metaByDate.get(date) || 0) + (googleByDate.get(date) || 0);
    const sales = salesByDate.get(date) || 0;
    RS.push(paidSpend > 0 ? Math.round((sales / paidSpend) * 100) / 100 : null);
  }
  return { RS, LB };
}

module.exports = { buildDailyRoasSeries };
