// lib/dates.js

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toIsoDate(input) {
  if (typeof input !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  let m = input.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function formatShortLabel(isoDate) {
  const [, m, d] = isoDate.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function formatMonthLabel(yyyyMm) {
  const m = Number(yyyyMm.slice(5, 7));
  return FULL_MONTHS[m - 1];
}

function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

function dateRange(days, referenceDate = new Date()) {
  const end = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { dateFrom: isoDay(start), dateTo: isoDay(end) };
}

module.exports = { toIsoDate, formatShortLabel, formatMonthLabel, isoDay, dateRange };
