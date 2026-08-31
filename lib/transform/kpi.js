const { toIsoDate } = require('../dates');

function sumInWindow(rows, { dateKey, valueKey, start, end }) {
  let total = 0;
  for (const r of rows) {
    const date = toIsoDate(r[dateKey]);
    if (date >= start && date <= end) {
      total += parseFloat(r[valueKey]) || 0;
    }
  }
  return total;
}

function blendedMER({ shopifySales, metaSpend, googleSpend }) {
  const paidSpend = metaSpend + googleSpend;
  return paidSpend === 0 ? 0 : shopifySales / paidSpend;
}

function cac({ metaSpend, googleSpend, newCustomers }) {
  return newCustomers === 0 ? 0 : (metaSpend + googleSpend) / newCustomers;
}

module.exports = { sumInWindow, blendedMER, cac };
