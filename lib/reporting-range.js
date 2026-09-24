// lib/reporting-range.js
//
// One place that decides which dates every report on the dashboard covers.
// Parses the query string, validates it, anchors it to real available data,
// and derives the equal-length preceding period used for comparison captions.
//
// Two query shapes are supported, so preset links and hand-picked ranges are
// both shareable URLs:
//   ?days=7|30|90          a preset window ending at the anchor day
//   ?from=YYYY-MM-DD&to=   an explicit custom range
// Neither present means the default 30-day window.

const DAY_MS = 86400000;
const DEFAULT_DAYS = 30;
const PRESET_DAYS = [7, 30, 90];
// A year and a bit: wide enough for any real review, narrow enough that a
// hand-edited URL cannot ask the page to aggregate an unbounded history.
const MAX_RANGE_DAYS = 400;

class ReportingRangeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReportingRangeError';
    this.status = 400;
  }
}

// Rejects '2026-13-01' and '2026-02-30', which the Date constructor otherwise
// rolls over into a different, valid, wrong date.
function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(iso, delta) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return isoDay(date);
}

// Inclusive of both endpoints: a start equal to its end is one day, not zero.
function daysBetween(startIso, endIso) {
  return Math.round((Date.parse(`${endIso}T00:00:00Z`) - Date.parse(`${startIso}T00:00:00Z`)) / DAY_MS) + 1;
}

function todayIn(timeZone, now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// The newest day EVERY listed source has reached. The minimum, not the maximum,
// is the point: anchoring to a day only one source has data for would render
// the others' final days as a collapse to zero, which reads as a crash in
// performance rather than as a sync that has not caught up.
function latestCommonDay(latestPerSource) {
  const days = latestPerSource.filter(Boolean);
  if (!days.length) return null;
  return days.reduce((a, b) => (a < b ? a : b));
}

function resolveReportingRange(query = {}, options = {}) {
  const {
    timeZone = 'Europe/London',
    latestAvailable = null,
    now = new Date(),
    defaultDays = DEFAULT_DAYS,
  } = options;

  // Yesterday in the account's timezone is the newest day that can be complete.
  // A real data anchor takes precedence, but never one in the future.
  const yesterday = addDays(todayIn(timeZone, now), -1);
  const anchor = latestAvailable && latestAvailable < yesterday ? latestAvailable : yesterday;

  const from = query.from == null || query.from === '' ? null : String(query.from);
  const to = query.to == null || query.to === '' ? null : String(query.to);
  const rawDays = query.days == null || query.days === '' ? null : String(query.days);

  if ((from && !to) || (to && !from)) {
    throw new ReportingRangeError('A custom range needs both a from and a to date.');
  }

  if (from && to) {
    const startDate = parseIsoDate(from);
    const endDate = parseIsoDate(to);
    if (!startDate || !endDate) {
      throw new ReportingRangeError('Dates must be real calendar dates in YYYY-MM-DD form.');
    }
    if (startDate.getTime() > endDate.getTime()) {
      throw new ReportingRangeError('The from date is after the to date.');
    }
    const days = daysBetween(from, to);
    if (days > MAX_RANGE_DAYS) {
      throw new ReportingRangeError(`Ranges are limited to ${MAX_RANGE_DAYS} days.`);
    }
    // A range reaching into today or beyond would mix a partial day's metrics
    // with complete ones, which reads as a sudden drop on the last point.
    if (to > anchor) {
      throw new ReportingRangeError(`Only complete days can be reported. The most recent available day is ${anchor}.`);
    }
    return withPreviousPeriod({ start: from, end: to, days, isCustom: true, preset: null, anchor });
  }

  let days = defaultDays;
  if (rawDays !== null) {
    const parsed = Number(rawDays);
    if (!Number.isInteger(parsed) || !PRESET_DAYS.includes(parsed)) {
      throw new ReportingRangeError(`days must be one of ${PRESET_DAYS.join(', ')}.`);
    }
    days = parsed;
  }

  const end = anchor;
  const start = addDays(end, -(days - 1));
  return withPreviousPeriod({ start, end, days, isCustom: false, preset: days, anchor });
}

function withPreviousPeriod({ start, end, days, isCustom, preset, anchor }) {
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  return { start, end, prevStart, prevEnd, days, isCustom, preset, anchor };
}

// Whether a source can honestly answer for this window. Reporting zero for days
// a source has no rows for would present missing history as a performance
// collapse — the caller shows the shortfall instead of the number.
function describeCoverage(rows, { dateKey, start, end, toIsoDate }) {
  let first = null;
  let last = null;
  const seen = new Set();
  for (const row of rows) {
    const date = toIsoDate(row[dateKey]);
    if (!date) continue;
    if (first === null || date < first) first = date;
    if (last === null || date > last) last = date;
    if (date >= start && date <= end) seen.add(date);
  }
  if (first === null) {
    return {
      complete: false, empty: true, first: null, last: null,
      missingBefore: null, missingAfter: null, missingWithin: daysBetween(start, end),
    };
  }
  const missingBefore = first > start ? first : null;
  const missingAfter = last < end ? last : null;
  // Endpoints alone cannot tell you the range is covered: a source can start
  // before the window and end after it while missing days in the middle, which
  // an endpoint-only check reports as complete.
  const expected = daysBetween(start, end);
  const missingWithin = expected - seen.size;
  return {
    complete: missingBefore === null && missingAfter === null && missingWithin === 0,
    empty: false,
    first,
    last,
    missingBefore,
    missingAfter,
    missingWithin,
  };
}

module.exports = {
  resolveReportingRange,
  describeCoverage,
  latestCommonDay,
  parseIsoDate,
  addDays,
  daysBetween,
  todayIn,
  ReportingRangeError,
  PRESET_DAYS,
  DEFAULT_DAYS,
  MAX_RANGE_DAYS,
};
