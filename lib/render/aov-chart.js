// lib/render/aov-chart.js
const { escapeHtml } = require('./table');

const W = 700, H = 220, PL = 45, PR = 14, PT = 14, PB = 26;

function xy(i, n, v, axisMax) {
  const x = PL + (W - PL - PR) * (n <= 1 ? 0 : i / (n - 1));
  const y = PT + (H - PT - PB) * (1 - v / axisMax);
  return [x, y];
}

// A null is a day the source cannot answer for. The line breaks there rather than
// dropping to the axis, so a gap in history never reads as a collapse to £0.
function pathFor(values, n, axisMax) {
  let d = '';
  let drawing = false;
  values.forEach((v, i) => {
    if (v === null || v === undefined) { drawing = false; return; }
    const [x, y] = xy(i, n, v, axisMax);
    d += `${drawing ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
    drawing = true;
  });
  return d.trim();
}

function renderAovChart({ current, previous, labels }) {
  if (!current || current.length === 0) {
    return '<div class="note" style="font-size:12.5px">Not enough daily sales data yet for an AOV trend.</div>';
  }

  const n = current.length;
  const allValues = [...current, ...(previous || [])].filter((v) => v !== null && v !== undefined);
  if (allValues.length === 0) {
    return '<div class="note" style="font-size:12.5px">No daily sales data in this range for an AOV trend.</div>';
  }
  const axisMax = Math.max(10, Math.ceil(Math.max(...allValues) / 10) * 10);
  const chartHeight = H - PT - PB;

  let gridlines = '';
  for (let v = 0; v <= axisMax; v += axisMax / 4) {
    const y = (PT + chartHeight * (1 - v / axisMax)).toFixed(1);
    gridlines += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="#eef0f3"></line>` +
      `<text x="${PL - 8}" y="${+y + 4}" text-anchor="end" font-size="11" fill="#9aa0aa">£${Math.round(v)}</text>`;
  }

  const step = Math.ceil(n / 8);
  let xLabels = '';
  labels.forEach((label, i) => {
    if (i % step === 0 || i === n - 1) {
      const [x] = xy(i, n, 0, axisMax);
      xLabels += `<text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#9aa0aa">${escapeHtml(label)}</text>`;
    }
  });

  let points = '';
  current.forEach((v, i) => {
    if (v === null || v === undefined) return;
    const [x, y] = xy(i, n, v, axisMax);
    points += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="transparent"><title>${escapeHtml(labels[i])}: £${v.toFixed(2)}</title></circle>` +
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="#5b5be6" stroke="#fff" stroke-width="1" pointer-events="none"></circle>`;
  });

  const previousKnown = previous && previous.length === n && previous.some((v) => v !== null && v !== undefined);
  const previousPath = previousKnown
    ? `<path d="${pathFor(previous, n, axisMax)}" fill="none" stroke="#b9bde8" stroke-width="2.2" stroke-dasharray="5 4"></path>`
    : '';
  const previousNote = previous && previous.length === n && previous.some((v) => v === null || v === undefined)
    ? '<div class="note" style="font-size:11.5px">The comparison line is broken where the previous period has no synced data.</div>'
    : '';
  const currentPath = `<path d="${pathFor(current, n, axisMax)}" fill="none" stroke="#5b5be6" stroke-width="2.4" stroke-linejoin="round"></path>`;

  return (
    '<div class="card p">' +
    `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${gridlines}${previousPath}${currentPath}${points}${xLabels}</svg>` +
    previousNote +
    '</div>'
  );
}

module.exports = { renderAovChart };
