const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatCohortLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function buildCohortTable(rows) {
  const byMonth = new Map();
  for (const r of rows) {
    const key = r['Month'];
    const monthsSince = parseInt(r['Months since first purchase'], 10);
    const rate = parseFloat(r['Customer retention rate']);
    const size = parseInt(r['Customers in cohort'], 10) || 0;

    if (!byMonth.has(key)) byMonth.set(key, { size, months: new Array(13).fill(null) });
    const entry = byMonth.get(key);
    entry.size = size;
    if (monthsSince >= 0 && monthsSince <= 12) entry.months[monthsSince] = rate;
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, entry]) => ({
      cohortLabel: formatCohortLabel(month),
      size: entry.size,
      months: entry.months.map((v, i) => (i === 0 && v === null ? 1 : v)),
    }));
}

module.exports = { buildCohortTable };
