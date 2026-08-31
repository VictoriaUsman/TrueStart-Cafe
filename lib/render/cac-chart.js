// lib/render/cac-chart.js
const { formatMoneyK, formatNumber } = require('./format');
const { escapeHtml } = require('./table');

const W = 700, H = 250, PL = 55, PR = 20, BASE_Y = 205, TOP_Y = 20;
// Darkest-to-lightest green, most recent month drawn darkest — matches the original static chart.
const BAR_COLORS = ['#8fbfa3', '#3f9068', '#217346', '#155c37'];

function barColor(index, total) {
  // Walk BAR_COLORS from its end so the most recent (last) bar always lands on the darkest shade,
  // regardless of how many months are in the series.
  const fromEnd = total - 1 - index;
  return BAR_COLORS[Math.min(fromEnd, BAR_COLORS.length - 1)];
}

function renderCacChart(series) {
  if (!series || series.length === 0) {
    return '<div class="note" style="font-size:12.5px">Not enough complete months of data yet for a CAC trend — check back after another full month.</div>';
  }

  const maxCac = Math.max(...series.map((m) => m.cac));
  const axisMax = Math.max(10, Math.ceil(maxCac / 10) * 10);
  const chartHeight = BASE_Y - TOP_Y;

  let gridlines = '';
  for (let v = 0; v <= axisMax; v += axisMax / 4) {
    const y = (BASE_Y - (v / axisMax) * chartHeight).toFixed(1);
    gridlines += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="#eef0f3"></line>` +
      `<text x="${PL - 8}" y="${+y + 4}" text-anchor="end" font-size="11" fill="#9aa0aa">£${Math.round(v)}</text>`;
  }

  const slot = (W - PR - PL) / series.length;
  const barWidth = Math.min(120, slot * 0.6);
  const gap = slot - barWidth;

  let bars = '';
  series.forEach((m, i) => {
    const x = PL + slot * i + gap / 2;
    const barHeight = (m.cac / axisMax) * chartHeight;
    const y = BASE_Y - barHeight;
    const cx = x + barWidth / 2;
    const color = barColor(i, series.length);
    const labelText = m.partial ? `${m.label} (to date)` : m.label;
    const tooltipLabel = m.partial ? `${m.label} (month to date)` : m.label;
    const tooltip = `${escapeHtml(tooltipLabel)}: £${m.cac.toFixed(2)} CAC · ${formatMoneyK(m.spend)} spend · ${formatNumber(m.newCustomers)} new customers`;
    // A partial (current, still-in-progress) month is visually distinguished — dashed outline,
    // reduced fill — so it reads as "not a complete month" without hiding it from the chart.
    const barAttrs = m.partial ? `fill="${color}" fill-opacity="0.45" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 3"` : `fill="${color}"`;
    bars +=
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" ${barAttrs} rx="3"><title>${tooltip}</title></rect>` +
      `<text x="${cx.toFixed(1)}" y="${(y - 9).toFixed(1)}" text-anchor="middle" font-size="18" font-weight="800" fill="#14110e">£${m.cac.toFixed(2)}</text>` +
      `<text x="${cx.toFixed(1)}" y="${H - 22}" text-anchor="middle" font-size="13" font-weight="700" fill="#333">${escapeHtml(labelText)}</text>` +
      `<text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#8a9099">${formatMoneyK(m.spend)} spend</text>`;
  });

  return `<div class="card p"><svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${gridlines}${bars}</svg></div>`;
}

module.exports = { renderCacChart };
