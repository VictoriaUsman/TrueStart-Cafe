const { escapeHtml } = require('./table');
const { evaluateAd, sevenDayWindow } = require('../transform/bof-rules');
const { getFunnelStage } = require('../transform/stage');

const STATUS_COLORS = {
  KILL: '#C0392B', RECOVERY: '#D97706', COLD_ELIGIBLE: '#1E8A4C',
  KEEP_RUNNING: '#6B7280', UNAVAILABLE: '#6B7280',
};
const STATUS_ORDER = { KILL: 0, RECOVERY: 1, COLD_ELIGIBLE: 2, KEEP_RUNNING: 3, UNAVAILABLE: 4 };
const STATUS_LABELS = {
  KILL: 'Kill', RECOVERY: 'Recovery', COLD_ELIGIBLE: 'Cold eligible',
  KEEP_RUNNING: 'Keep running', UNAVAILABLE: 'Unavailable',
};

const UNAVAILABLE_HTML = '<div class="note">Seven-day performance qualification unavailable until a successful refresh for the latest complete window.</div>';

function renderBofTable({ ads, dateFrom, dateTo, timeZone, asOf, isDefaultWindow = true }) {
  // These rules only describe BOF campaigns. Anything else is shown as a count
  // rather than given an invented status or silently dropped.
  const bof = ads.filter((ad) => getFunnelStage(ad.campaign) === 'BOF');
  const excludedCount = ads.length - bof.length;

  const evaluated = bof
    .map((ad) => ({ ...ad, ...evaluateAd(ad) }))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.spend - a.spend);

  const counts = Object.fromEntries(
    Object.keys(STATUS_ORDER).map((status) => [status, evaluated.filter((ad) => ad.status === status).length])
  );

  const money = (v) => `£${v.toFixed(2)}`;
  const dash = (v, fmt) => (v === null ? '—' : fmt(v));

  const calibration = isDefaultWindow
    ? ''
    : '<p class="note" style="color:#C98A00"><b>Heads up:</b> these thresholds were calibrated for a seven-day window. Over a longer range the spend and purchase gates are easier to clear, so read the statuses accordingly.</p>';

  const excluded = excludedCount > 0
    ? `<p class="note">${excludedCount} ads outside the BOF campaigns are not shown — these rules only cover BOF.</p>`
    : '';

  const options = ['ALL', 'KILL', 'RECOVERY', 'COLD_ELIGIBLE', 'KEEP_RUNNING']
    .map((v) => `<option value="${v}">${v === 'ALL' ? 'All' : STATUS_LABELS[v]}</option>`)
    .join('');

  const rows = evaluated.map((ad) => `<tr data-status="${ad.status}">` +
    `<td>${escapeHtml(ad.name)}<br><small>${escapeHtml(ad.id)}</small></td>` +
    `<td>${escapeHtml(ad.campaign)}</td>` +
    `<td>${escapeHtml(ad.product)}</td>` +
    `<td>${money(ad.spend)}</td>` +
    `<td>${ad.purchases}</td>` +
    `<td>${dash(ad.cpr, money)}</td>` +
    `<td>${dash(ad.roas, (v) => `${v.toFixed(2)}x`)}</td>` +
    `<td><span class="pill" style="background:${STATUS_COLORS[ad.status]}">${escapeHtml(STATUS_LABELS[ad.status])}</span></td>` +
    `<td>${escapeHtml(ad.action)} <small>(recommendation)</small></td>` +
    `<td>${escapeHtml(ad.reason)}</td></tr>`).join('');

  const html = `<p class="note">${escapeHtml(dateFrom)} to ${escapeHtml(dateTo)} · ${escapeHtml(timeZone)} · Meta-attributed, ad level<br>Updated ${escapeHtml(asOf)}.</p>
    ${calibration}${excluded}
    <p><b>${counts.KILL} Kill</b> &middot; <b>${counts.RECOVERY} Recovery</b> &middot; <b>${counts.COLD_ELIGIBLE} Cold eligible</b> &middot; <b>${counts.KEEP_RUNNING} Keep running</b></p>
    <label>Status <select id="performance-status">${options}</select></label>
    <div class="card" style="overflow-x:auto"><table id="proven-table"><thead><tr><th>Ad / Meta ID</th><th>Campaign</th><th>Product</th><th>Spend</th><th>Purchases</th><th>Cost per result</th><th>ROAS</th><th>Status</th><th>Recommended action</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table></div>`;

  return { html, counts, excludedCount };
}

function bofView(snapshot, now = new Date(), timeZone = 'Europe/London') {
  const expected = sevenDayWindow(now, timeZone);
  const fresh = snapshot && snapshot.timeZone === timeZone &&
    snapshot.dateFrom === expected.dateFrom && snapshot.dateTo === expected.dateTo &&
    Number.isFinite(Date.parse(snapshot.asOf)) && Date.parse(snapshot.asOf) <= now.getTime() &&
    now.getTime() - Date.parse(snapshot.asOf) < 36 * 3600000;
  if (!fresh) return { counts: null, html: UNAVAILABLE_HTML };
  return renderBofTable({ ...snapshot, isDefaultWindow: true });
}

module.exports = { bofView, renderBofTable, STATUS_LABELS };
