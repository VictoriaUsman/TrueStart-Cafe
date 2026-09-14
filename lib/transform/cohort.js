const { toIsoDate } = require('../dates');
const { parseNumber, parseInteger } = require('../numbers');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatCohortLabel(isoMonthStr, swapped) {
  const [y, m, d] = isoMonthStr.split('-').map(Number);
  const realMonth = swapped ? d : m;
  return `${MONTHS[realMonth - 1]} ${y}`;
}

function buildCohortTable(rows) {
  const byMonth = new Map();
  for (const r of rows) {
    // Route through the shared date layer, like every other date-handling module in this
    // codebase, so a DD-MM-YYYY-formatted Month (e.g. from the Shopify daily-sales tab
    // convention) doesn't silently mislabel the cohort or invert sort order.
    const key = toIsoDate(r['Month']);
    if (!key) continue;
    // Not routed through parseInteger: this is a small 0-12 index, never comma-formatted, and
    // must stay NaN (not silently become 0, which is itself a valid month index) when unparseable,
    // so the range check below correctly skips it instead of writing into month 0.
    const monthsSince = parseInt(r['Months since first purchase'], 10);
    const rate = parseNumber(r['Customer retention rate']);
    const size = parseInteger(r['Customers in cohort']);

    if (!byMonth.has(key)) byMonth.set(key, { size, months: new Array(13).fill(null) });
    const entry = byMonth.get(key);
    entry.size = size;
    if (monthsSince >= 0 && monthsSince <= 12) entry.months[monthsSince] = rate;
  }

  const keys = [...byMonth.keys()];
  // The "Cohort" sheet's Month column can come from an upstream formula whose DATE() args are
  // swapped (DATE(year, 1, month) instead of DATE(year, month, 1)): every row's month slot is
  // pinned to 1 while the real acquisition month sits in the day slot, e.g. "2025-01-08" means
  // Aug 2025, not 8 Jan 2025 (confirmed live against that cohort's known customer count). Detect
  // this at the table level — month pinned to 1 while day varies across more than one row —
  // rather than per-row, since a single row's date (e.g. a genuine 8 Jan reading, which is this
  // sheet's normal fixed-pull-day convention) looks identical to the swapped case in isolation.
  const months = keys.map((k) => k.slice(5, 7));
  const days = keys.map((k) => k.slice(8, 10));
  const swapped = new Set(months).size === 1 && months[0] === '01' && new Set(days).size > 1;

  return keys
    .sort((a, b) => a.localeCompare(b)) // safe: keys are normalized ISO strings
    .map((key) => {
      const entry = byMonth.get(key);
      return {
        cohortLabel: formatCohortLabel(key, swapped),
        size: entry.size,
        months: entry.months.map((v, i) => (i === 0 && v === null ? 1 : v)),
      };
    });
}

module.exports = { buildCohortTable };
