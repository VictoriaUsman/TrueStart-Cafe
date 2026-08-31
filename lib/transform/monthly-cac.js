// lib/transform/monthly-cac.js
const { toIsoDate, formatMonthLabel } = require('../dates');
const { parseNumber, parseInteger } = require('../numbers');

function sumSpendByMonth(rows, valueKey) {
  const map = new Map();
  for (const r of rows) {
    const date = toIsoDate(r.Day);
    if (!date) continue;
    const month = date.slice(0, 7);
    map.set(month, (map.get(month) || 0) + parseNumber(r[valueKey]));
  }
  return map;
}

function buildMonthlyCacSeries({ monthlyRows, metaDailyRows, googleDailyRows, excludeMonth }) {
  const metaByMonth = sumSpendByMonth(metaDailyRows, 'Amount spent (GBP)');
  const googleByMonth = sumSpendByMonth(googleDailyRows, 'Cost');

  const series = [];
  for (const row of monthlyRows) {
    const date = toIsoDate(row.Month);
    if (!date) continue;
    const month = date.slice(0, 7);
    if (month === excludeMonth) continue;

    const newCustomers = parseInteger(row['New customers']);
    if (newCustomers === 0) continue;

    const metaSpend = metaByMonth.get(month) || 0;
    const googleSpend = googleByMonth.get(month) || 0;
    const spend = metaSpend + googleSpend;

    series.push({
      month,
      label: formatMonthLabel(month),
      cac: Math.round((spend / newCustomers) * 100) / 100,
      spend,
      newCustomers,
    });
  }

  series.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  return series;
}

module.exports = { buildMonthlyCacSeries };
