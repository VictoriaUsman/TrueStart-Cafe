// lib/render/subscription.js
const { renderKpiRow } = require('./kpis');
const { renderTable } = require('./table');
const { formatPercent, formatNumber } = require('./format');
const { renderLtvTable } = require('./ltv');
const { renderAovChart } = require('./aov-chart');

function renderSubscriptionTab({ aov, newCustomers, returningCustomers, ltvRows, aovCurrent, aovPrevious, aovLabels }) {
  const total = newCustomers + returningCustomers;
  const newShare = total > 0 ? newCustomers / total : 0;

  const kpiRow = renderKpiRow([
    { icon: 'AVG ORDER VALUE · last 30d', big: `£${aov.toFixed(2)}`, cap: 'net sales ÷ orders' },
    {
      icon: 'NEW CUSTOMER SHARE',
      big: formatPercent(newShare),
      cap: `${formatNumber(newCustomers)} new of ${formatNumber(total)} (last 90d)`,
    },
  ]);

  const newVsReturningTable = renderTable({
    columns: [
      { key: 'customer', label: 'Customer' },
      { key: 'count', label: 'Count', numeric: true },
      { key: 'share', label: 'Share', numeric: true },
    ],
    rows: [
      { customer: 'New customer', count: formatNumber(newCustomers), share: formatPercent(newShare) },
      { customer: 'Returning customer', count: formatNumber(returningCustomers), share: formatPercent(1 - newShare) },
    ],
  });

  const ltvSection = renderLtvTable(ltvRows);
  const aovChartSection = renderAovChart({ current: aovCurrent, previous: aovPrevious, labels: aovLabels });

  const subscriberNote =
    '<div class="note">Subscriber-level metrics (active subscribers, taster→subscribe rate, subscription LTV) ' +
    'come from Recharge — being wired in now and will populate here next.</div>';

  return (
    `${kpiRow}` +
    `<h3 style="margin-top:16px">AOV trend <span style="color:#9aa0aa;font-weight:400;font-size:12px">— last 30 days, dashed line is the previous 30 days</span></h3>${aovChartSection}` +
    `<div class="two">` +
    `<div><h3>New vs returning (last 90d)</h3><div class="card">${newVsReturningTable}</div></div>` +
    `<div><h3>Cumulative LTV (blended)</h3>${ltvSection}</div>` +
    `</div>${subscriberNote}`
  );
}

module.exports = { renderSubscriptionTab };
