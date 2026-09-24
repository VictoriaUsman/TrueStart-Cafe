// lib/render/subscription.js
const { renderKpiRow } = require('./kpis');
const { renderTable } = require('./table');
const { formatPercent, formatNumber } = require('./format');
const { renderLtvTable } = require('./ltv');
const { renderAovChart } = require('./aov-chart');

// periodLabel/comparisonLabel come from the dashboard's resolved reporting range.
// They are parameters rather than literals so a displayed period can never drift
// from the window the figure was actually calculated over.
function renderSubscriptionTab({
  aov, newCustomers, returningCustomers, ltvRows, aovCurrent, aovPrevious, aovLabels,
  periodLabel = 'last 30d', comparisonLabel = 'the previous period', customerPeriodLabel = 'last 90d',
}) {
  const total = newCustomers + returningCustomers;
  const newShare = total > 0 ? newCustomers / total : 0;

  const kpiRow = renderKpiRow([
    { icon: `AVG ORDER VALUE · ${periodLabel}`, big: `£${aov.toFixed(2)}`, cap: 'net sales ÷ orders' },
    {
      icon: 'NEW CUSTOMER SHARE',
      big: formatPercent(newShare),
      cap: `${formatNumber(newCustomers)} new of ${formatNumber(total)} (${customerPeriodLabel})`,
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
    `<h3 style="margin-top:16px">AOV trend <span style="color:#9aa0aa;font-weight:400;font-size:12px">— ${periodLabel}; the dashed line is the preceding period (${comparisonLabel})</span></h3>${aovChartSection}` +
    `<div class="two">` +
    `<div><h3>New vs returning (${customerPeriodLabel})</h3><div class="card">${newVsReturningTable}</div></div>` +
    `<div><h3>Cumulative LTV (blended)</h3>${ltvSection}</div>` +
    `</div>${subscriberNote}`
  );
}

module.exports = { renderSubscriptionTab };
