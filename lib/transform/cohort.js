const { toIsoDate } = require('../dates');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatCohortLabel(isoMonthStr) {
  const [y, m] = isoMonthStr.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function buildCohortTable(rows) {
  const byMonth = new Map();
  for (const r of rows) {
    // Route through the shared date layer, like every other date-handling module in this
    // codebase, so a DD-MM-YYYY-formatted Month (e.g. from the Shopify daily-sales tab
    // convention) doesn't silently mislabel the cohort or invert sort order.
    const key = toIsoDate(r['Month']);
    if (!key) continue;
    const monthsSince = parseInt(r['Months since first purchase'], 10);
    const rate = parseFloat(r['Customer retention rate']);
    const size = parseInt(r['Customers in cohort'], 10) || 0;

    if (!byMonth.has(key)) byMonth.set(key, { size, months: new Array(13).fill(null) });
    const entry = byMonth.get(key);
    entry.size = size;
    if (monthsSince >= 0 && monthsSince <= 12) entry.months[monthsSince] = rate;
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b)) // safe: keys are now normalized ISO strings
    .map(([month, entry]) => ({
      cohortLabel: formatCohortLabel(month),
      size: entry.size,
      months: entry.months.map((v, i) => (i === 0 && v === null ? 1 : v)),
    }));
}

module.exports = { buildCohortTable };
