const { escapeHtml } = require('./table');
const { evaluateProven, sevenDayWindow } = require('../transform/bof-rules');

const STATUS_COLORS = { KILL: '#C0392B', DEMOTE: '#D97706', PROVEN: '#1E8A4C', TESTING: '#6B7280', UNAVAILABLE: '#6B7280' };
const STATUS_ORDER = { KILL: 0, DEMOTE: 1, PROVEN: 2, TESTING: 3, UNAVAILABLE: 4 };

function provenView(snapshot, now = new Date(), timeZone = 'Europe/London') {
  const expected = sevenDayWindow(now, timeZone);
  const fresh = snapshot && snapshot.timeZone === timeZone && snapshot.dateFrom === expected.dateFrom && snapshot.dateTo === expected.dateTo &&
    Number.isFinite(Date.parse(snapshot.asOf)) && Date.parse(snapshot.asOf) <= now.getTime() && now.getTime() - Date.parse(snapshot.asOf) < 36 * 3600000;
  if (!fresh) {
    return { count: null, counts: null, html: '<div class="note">Seven-day performance qualification unavailable until a successful refresh for the latest complete window.</div>' };
  }

  const ads = snapshot.ads
    .map((ad) => ({ ...ad, ...evaluateProven(ad) }))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.spend - a.spend);

  const counts = Object.fromEntries(
    Object.keys(STATUS_ORDER).map((status) => [status, ads.filter((ad) => ad.status === status).length])
  );

  const money = (v) => `£${v.toFixed(2)}`;
  const html = `<p class="note">${escapeHtml(snapshot.dateFrom)} to ${escapeHtml(snapshot.dateTo)} · Last 7 completed days · ${escapeHtml(snapshot.timeZone)} · Meta-attributed, ad level<br>Updated ${escapeHtml(snapshot.asOf)}. Bars: Taster £12, Starter £15, PDP / other £20 · Demote above 1.5&times; bar · Kill above 2&times; bar or spend &ge; £100 with 0 purchases.</p>
    <p><b>${counts.PROVEN} Proven</b> &middot; <b>${counts.DEMOTE} Demote</b> &middot; <b>${counts.KILL} Kill</b> &middot; <b>${counts.TESTING} Testing</b></p>
    <label>Status <select id="performance-status"><option value="ALL">All</option><option value="PROVEN">Proven</option><option value="DEMOTE">Demote</option><option value="KILL">Kill</option><option value="TESTING">Testing</option></select></label>
    <div class="card" style="overflow-x:auto"><table id="proven-table"><thead><tr><th>Ad / Meta ID</th><th>Product</th><th>7d spend</th><th>7d purchases</th><th>7d CPA</th><th>CPA bar</th><th>Status</th><th>Recommended action</th><th>Reason</th></tr></thead><tbody>${ads.map((ad) => `<tr data-status="${ad.status}"><td>${escapeHtml(ad.name)}<br><small>${escapeHtml(ad.id)}</small></td><td>${escapeHtml(ad.product)}</td><td>${money(ad.spend)}</td><td>${ad.purchases}</td><td>${ad.cpa === null ? '—' : money(ad.cpa)}</td><td>${money(ad.bar)}</td><td><span class="pill" style="background:${STATUS_COLORS[ad.status]}">${escapeHtml(ad.status)}</span></td><td>${escapeHtml(ad.action)} <small>(recommendation)</small></td><td>${escapeHtml(ad.reason)}</td></tr>`).join('')}</tbody></table></div>`;
  return { count: counts.PROVEN, counts, html };
}

module.exports = { provenView };
