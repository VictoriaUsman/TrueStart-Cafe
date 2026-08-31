// api/dashboard.js
const { fetchSheetTab } = require('../lib/sheets');
const { fetchLowStockSnapshot } = require('../lib/shopify');
const { toIsoDate } = require('../lib/dates');
const { buildCreativesData } = require('../lib/transform/creatives');
const { buildDailyRoasSeries } = require('../lib/transform/daily-roas');
const { sumInWindow, blendedMER, cac } = require('../lib/transform/kpi');
const { buildGoogleCampaignRows } = require('../lib/transform/google-campaigns');
const { buildFunnelSplit, buildStatusSpend } = require('../lib/transform/overview');
const { buildBreakdown } = require('../lib/transform/breakdown');
const { buildCohortTable } = require('../lib/transform/cohort');
const { injectDashboard } = require('../lib/template');
const { renderKpiRow } = require('../lib/render/kpis');
const { renderGoogleTab } = require('../lib/render/google');
const { renderMetaTab } = require('../lib/render/meta');
const { renderOverviewTab } = require('../lib/render/overview');
const { renderBreakdownCard, renderTwoColumn } = require('../lib/render/breakdowns');
const { renderCohortTable } = require('../lib/render/cohort');
const { renderSubscriptionTab } = require('../lib/render/subscription');
const { formatMoney, formatMoneyK } = require('../lib/render/format');

function unavailableNote(label) {
  return `<div class="note" style="color:#a02533">${label} data is temporarily unavailable — please refresh shortly.</div>`;
}

async function settleTab(label, url) {
  try {
    return { ok: true, rows: await fetchSheetTab(url) };
  } catch (err) {
    console.error(`[dashboard] ${label} tab fetch failed:`, err);
    return { ok: false, rows: [] };
  }
}

function windowBounds(endIso, days) {
  const end = new Date(endIso + 'T00:00:00Z');
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const prevEnd = new Date(start);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - (days - 1));
  const iso = (d) => d.toISOString().slice(0, 10);
  return {
    start: iso(start), end: endIso,
    prevStart: iso(prevStart), prevEnd: iso(prevEnd),
  };
}

function latestDate(rows, dateKey) {
  let max = null;
  for (const r of rows) {
    if (!r[dateKey]) continue;
    const d = toIsoDate(r[dateKey]);
    if (!d) continue;
    if (!max || d > max) max = d;
  }
  return max;
}

function deltaCaption(current, previous, { formatFn, direction }) {
  if (!previous) return undefined;
  const pctRaw = ((current - previous) / previous) * 100;
  const pct = Math.abs(pctRaw).toFixed(0);
  const arrow = pctRaw >= 0 ? '▲' : '▼';
  const improved = direction === 'higher' ? pctRaw >= 0 : direction === 'lower' ? pctRaw <= 0 : null;
  const text = `${arrow} ${pct}% · was ${formatFn(previous)}`;
  if (improved === null) return { text, style: 'color:#6b7280' };
  return { text, cls: improved ? 'up' : undefined, style: improved ? undefined : 'color:#C98A00' };
}

async function buildDashboardHtml(env) {
  const [creatives, googleDaily, metaDaily, shopifyDaily, newReturning, cohort, stock] = await Promise.all([
    settleTab('Creatives', env.SHEET_CSV_URL_CREATIVES),
    settleTab('Google Ads', env.SHEET_CSV_URL_GOOGLE_DAILY),
    settleTab('Meta', env.SHEET_CSV_URL_META_DAILY),
    settleTab('Shopify sales', env.SHEET_CSV_URL_SHOPIFY_DAILY),
    settleTab('New vs returning', env.SHEET_CSV_URL_NEW_RETURNING),
    settleTab('Cohort', env.SHEET_CSV_URL_COHORT),
    fetchLowStockSnapshot({ shopDomain: env.SHOPIFY_SHOP_DOMAIN, accessToken: env.SHOPIFY_ACCESS_TOKEN })
      .then((snap) => ({ ok: true, snap }))
      .catch((err) => {
        console.error('[dashboard] Shopify inventory fetch failed:', err);
        // asOf: null is a marker never produced by a real successful fetch — the client
        // script uses it to distinguish "outage" from "all clear" instead of rendering
        // an empty products array as a false all-clear.
        return { ok: false, snap: { asOf: null, products: [] } };
      }),
  ]);

  const data = creatives.ok ? buildCreativesData(creatives.rows) : [];

  // Window anchored to the latest day present in the day-level data, not "today" —
  // the Sheet may lag behind real time.
  const anchorDate =
    latestDate(shopifyDaily.rows, 'Day') || latestDate(metaDaily.rows, 'Day') || latestDate(googleDaily.rows, 'Day') || new Date().toISOString().slice(0, 10);
  const { start, end, prevStart, prevEnd } = windowBounds(anchorDate, 30);

  const shopifySales = sumInWindow(shopifyDaily.rows, { dateKey: 'Day', valueKey: 'Total sales', start, end });
  const prevShopifySales = sumInWindow(shopifyDaily.rows, { dateKey: 'Day', valueKey: 'Total sales', start: prevStart, end: prevEnd });
  const metaSpend = sumInWindow(metaDaily.rows, { dateKey: 'Day', valueKey: 'Amount spent (GBP)', start, end });
  const prevMetaSpend = sumInWindow(metaDaily.rows, { dateKey: 'Day', valueKey: 'Amount spent (GBP)', start: prevStart, end: prevEnd });
  const googleSpend = sumInWindow(googleDaily.rows, { dateKey: 'Day', valueKey: 'Cost', start, end });
  const prevGoogleSpend = sumInWindow(googleDaily.rows, { dateKey: 'Day', valueKey: 'Cost', start: prevStart, end: prevEnd });

  const mer = blendedMER({ shopifySales, metaSpend, googleSpend });
  const prevMer = blendedMER({ shopifySales: prevShopifySales, metaSpend: prevMetaSpend, googleSpend: prevGoogleSpend });

  const newReturningTotals = newReturning.rows.reduce(
    (acc, r) => {
      const key = (r['New or returning customer'] || '').toLowerCase();
      const n = parseInt(r['Customers'], 10) || 0;
      if (key === 'new') acc.newCustomers += n;
      else if (key === 'returning') acc.returningCustomers += n;
      return acc;
    },
    { newCustomers: 0, returningCustomers: 0 }
  );
  const cacValue = cac({ metaSpend, googleSpend, newCustomers: newReturningTotals.newCustomers });

  const provenCount = data.filter((ad) => ad.status === 'PROVEN').length;
  const inProvenCount = data.filter((ad) => ad.in_proven).length;

  const kpiTop = creatives.ok
    ? renderKpiRow([
        { icon: '◐ BLENDED · last 30d', big: mer.toFixed(2), cap: 'ROAS / MER (Shopify ÷ Meta+Google)', chg: deltaCaption(mer, prevMer, { formatFn: (v) => v.toFixed(2), direction: 'higher' }) },
        { icon: 'ⓕ META · last 30d', big: formatMoneyK(metaSpend), cap: 'Spend', chg: deltaCaption(metaSpend, prevMetaSpend, { formatFn: formatMoneyK, direction: 'neutral' }) },
        { icon: 'Ⓖ GOOGLE · last 30d', big: formatMoneyK(googleSpend), cap: 'Cost', chg: deltaCaption(googleSpend, prevGoogleSpend, { formatFn: formatMoneyK, direction: 'neutral' }) },
        { icon: '🛍 SHOPIFY · last 30d', big: formatMoneyK(shopifySales), cap: 'Total sales', chg: deltaCaption(shopifySales, prevShopifySales, { formatFn: formatMoneyK, direction: 'higher' }) },
        { icon: '💷 CAC · cost per new customer', big: formatMoney(cacValue), cap: 'blended · Meta+Google ÷ new customers (last 60d)' },
        {
          icon: '✅ PROVEN', big: String(provenCount), bigColor: '#1E8A4C',
          cap: `${inProvenCount} in Proven campaign · ${provenCount - inProvenCount} ready to move`,
        },
      ])
    : unavailableNote('KPI');

  const googleTab = googleDaily.ok ? renderGoogleTab(buildGoogleCampaignRows(googleDaily.rows, { start, end })) : unavailableNote('Google');

  const metaKpi = sumInWindow(metaDaily.rows, { dateKey: 'Day', valueKey: 'Purchases', start, end });
  const metaConvValue = sumInWindow(metaDaily.rows, { dateKey: 'Day', valueKey: 'Purchases conversion value', start, end });
  const metaTab = metaDaily.ok
    ? renderMetaTab({ spend: metaSpend, purchases: metaKpi, convValue: metaConvValue, roas: metaSpend > 0 ? metaConvValue / metaSpend : 0 })
    : unavailableNote('Meta');

  const overviewTab = creatives.ok ? renderOverviewTab({ funnel: buildFunnelSplit(data), statusSpend: buildStatusSpend(data) }) : unavailableNote('Creative overview');

  const insightsTab = creatives.ok
    ? renderTwoColumn(
        renderBreakdownCard({ title: 'By angle', labelHeader: 'Angle', rows: buildBreakdown(data, (a) => a.angle), cpaDecimals: 0 }),
        renderBreakdownCard({ title: 'By persona', labelHeader: 'Persona', rows: buildBreakdown(data, (a) => a.persona), cpaDecimals: 0 })
      )
    : unavailableNote('Angle & persona');

  const packprodTab = creatives.ok
    ? renderTwoColumn(
        renderBreakdownCard({ title: 'By pack type', labelHeader: 'Pack', rows: buildBreakdown(data, (a) => a.product), cpaDecimals: 2, boldRows: true }),
        renderBreakdownCard({ title: 'By product (pack × format)', labelHeader: 'Product', rows: buildBreakdown(data, (a) => `${a.product} · ${a.format}`), cpaDecimals: 2 })
      )
    : unavailableNote('Pack & product');

  const cohortTable = cohort.ok ? renderCohortTable(buildCohortTable(cohort.rows)) : unavailableNote('Cohort');

  const subscriptionTab = shopifyDaily.ok && newReturning.ok
    ? renderSubscriptionTab({
        aov: sumInWindow(shopifyDaily.rows, { dateKey: 'Day', valueKey: 'Net sales', start, end }) /
          (sumInWindow(shopifyDaily.rows, { dateKey: 'Day', valueKey: 'Orders', start, end }) || 1),
        newCustomers: newReturningTotals.newCustomers,
        returningCustomers: newReturningTotals.returningCustomers,
      })
    : unavailableNote('Subscription & LTV');

  const { RS, LB } = buildDailyRoasSeries({ shopifyDailyRows: shopifyDaily.rows, metaDailyRows: metaDaily.rows, googleDailyRows: googleDaily.rows });

  const cacChart =
    '<div class="note" style="font-size:12.5px">Monthly CAC trend is not yet available — it needs a month-by-month ' +
    'new-customer breakdown this Sheet does not currently provide.</div>';

  return injectDashboard(
    {
      kpiTop, googleTab, metaTab, overviewTab, insightsTab, packprodTab, cohortTable, subscriptionTab, cacChart,
      // Plain text (not unavailableNote's <div>) because this is injected inside an inline <span> in
      // the template; phrasing still matches "{label} data is temporarily unavailable" for consistency
      // with the other sections' degraded-state copy.
      stockStatus: stock.ok ? `live · fetched ${new Date(stock.snap.asOf).toLocaleString('en-GB')}` : 'Stock data is temporarily unavailable — please refresh shortly.',
    },
    { DATA: data, RS, LB, STK_SNAP: stock.snap }
  );
}

module.exports = { buildDashboardHtml };

module.exports.default = async function handler(req, res) {
  try {
    const html = await buildDashboardHtml(process.env);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).send(html);
  } catch (err) {
    console.error('[dashboard] fatal error building page:', err);
    res.status(500).send('Dashboard temporarily unavailable. Please try again shortly.');
  }
};
