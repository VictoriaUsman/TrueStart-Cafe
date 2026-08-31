// lib/transform/ltv.js
// Estimates cumulative £ LTV per cohort/month-since-first-purchase cell from the existing Cohort
// retention-rate table and a single blended AOV — no real per-period £ data source exists (see
// docs/superpowers/specs/2026-08-31-live-dashboard-design.md §2.1). Formula: cumulative £ at
// month N = AOV × the running sum of retention rates through month N (retention_rate[0] is always
// 100%, a customer's first order by definition) — i.e. expected cumulative orders × AOV. This is a
// simplified estimate (flat AOV over time, no discounting), not a ledger-exact figure.

function buildLtvTable(cohortTable, aov) {
  return cohortTable.map((cohort) => {
    let cumulativeRate = 0;
    const months = cohort.months.map((rate) => {
      if (rate === null || rate === undefined) return null;
      cumulativeRate += rate;
      return Math.round(cumulativeRate * aov * 100) / 100;
    });
    return { cohortLabel: cohort.cohortLabel, size: cohort.size, months };
  });
}

module.exports = { buildLtvTable };
