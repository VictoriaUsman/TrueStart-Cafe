// lib/transform/creatives-window.js
//
// The Creatives sheet does not hold daily rows. api/sync-creatives.js writes one
// row per ad per five-day calendar block, so the finest slice this source can
// answer honestly is a whole block.
//
// Two things we deliberately do NOT do, because both produce a plausible number
// that is wrong:
//   - include a block that merely overlaps the range (counts spend from days
//     outside the selection)
//   - prorate a block by the fraction of days selected (invents a daily
//     distribution the source never recorded)
//
// So a block is included only when it lies entirely inside the requested range,
// and the caller is told which days that leaves uncovered.

// Sheet headers for the block boundary columns. The tab is written from
// mapCreativesRows' date_start/date_stop, but the header row is maintained by
// hand, so accept the spellings it might reasonably carry rather than assuming.
const START_KEYS = ['Reporting starts', 'date_start', 'Date start', 'Start', 'Reporting start'];
const STOP_KEYS = ['Reporting ends', 'date_stop', 'Date stop', 'End', 'Reporting end'];

function firstPresent(row, keys, toIsoDate) {
  for (const key of keys) {
    if (row[key] === undefined || row[key] === null || row[key] === '') continue;
    const iso = toIsoDate(String(row[key]).trim());
    if (iso) return iso;
  }
  return null;
}

function blockBounds(row, toIsoDate) {
  const start = firstPresent(row, START_KEYS, toIsoDate);
  const stop = firstPresent(row, STOP_KEYS, toIsoDate);
  if (!start || !stop) return null;
  return start <= stop ? { start, stop } : { start: stop, stop: start };
}

// Returns the rows safe to aggregate for this range, plus what that cost.
//   dated        false when the sheet carries no usable block columns at all —
//                the caller must then treat the tab as unfilterable rather than
//                silently reporting every block ever synced
//   coveredStart the first day actually represented (null when nothing is)
//   coveredEnd   the last day actually represented
//   excluded     how many blocks were dropped for straddling an edge
function filterCreativeBlocks(rows, { start, end, toIsoDate }) {
  let sawAnyBounds = false;
  const kept = [];
  let coveredStart = null;
  let coveredEnd = null;
  let excluded = 0;

  for (const row of rows) {
    const bounds = blockBounds(row, toIsoDate);
    if (!bounds) continue;
    sawAnyBounds = true;
    if (bounds.start >= start && bounds.stop <= end) {
      kept.push(row);
      if (coveredStart === null || bounds.start < coveredStart) coveredStart = bounds.start;
      if (coveredEnd === null || bounds.stop > coveredEnd) coveredEnd = bounds.stop;
    } else if (bounds.stop >= start && bounds.start <= end) {
      excluded += 1;
    }
  }

  if (!sawAnyBounds) {
    return { dated: false, rows: [], coveredStart: null, coveredEnd: null, excluded: 0, exact: false };
  }

  return {
    dated: true,
    rows: kept,
    coveredStart,
    coveredEnd,
    excluded,
    exact: coveredStart === start && coveredEnd === end,
  };
}

module.exports = { filterCreativeBlocks };
