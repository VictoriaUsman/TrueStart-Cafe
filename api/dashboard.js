// api/dashboard.js
const { fetchSheetTab } = require('../lib/sheets');
const { readProvenSnapshot } = require('../lib/bof-snapshot');
const { bofView } = require('../lib/render/bof-rules');
const { accountTimeZone } = require('../lib/transform/bof-rules');
const { fetchLowStockSnapshot } = require('../lib/shopify');
const { toIsoDate, formatShortLabel } = require('../lib/dates');
const { buildCreativesData } = require('../lib/transform/creatives');
const { buildDailyRoasSeries } = require('../lib/transform/daily-roas');
const { sumInWindow, blendedMER, cac } = require('../lib/transform/kpi');
const { buildGoogleCampaignRows } = require('../lib/transform/google-campaigns');
const { buildFunnelSplit, buildStatusSpend } = require('../lib/transform/overview');
const { buildBreakdown } = require('../lib/transform/breakdown');
const { buildCohortTable } = require('../lib/transform/cohort');
const { buildLtvTable } = require('../lib/transform/ltv');
const { buildDailyAovComparisonSeries } = require('../lib/transform/daily-aov');
const { buildMonthlyCacSeries } = require('../lib/transform/monthly-cac');
const { filterCreativeBlocks } = require('../lib/transform/creatives-window');
const {
  resolveReportingRange, describeCoverage, latestCommonDay, ReportingRangeError,
} = require('../lib/reporting-range');
const { injectDashboard } = require('../lib/template');
const { renderKpiRow } = require('../lib/render/kpis');
const { renderGoogleTab } = require('../lib/render/google');
const { renderMetaTab } = require('../lib/render/meta');
const { renderOverviewTab } = require('../lib/render/overview');
const { renderBreakdownCard, renderTwoColumn } = require('../lib/render/breakdowns');
const { renderCohortTable } = require('../lib/render/cohort');
const { renderSubscriptionTab } = require('../lib/render/subscription');
const { renderCacChart } = require('../lib/render/cac-chart');
const { formatMoney, formatMoneyK } = require('../lib/render/format');

function unavailableNote(label) {
  return `<div class="note" style="color:#a02533">${label} data is temporarily unavailable — please refresh shortly.</div>`;
}

// A source that cannot honestly answer for the selected range says so here. The
// alternative — rendering the number it *can* produce — is worse than showing
// nothing, because an unchanged or zeroed figure under a changed date heading
// reads as a real result.
function limitationNote(label, reason) {
  return `<div class="note" style="color:#C98A00"><b>${label} is not filtered by the selected dates.</b> ${reason}</div>`;
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

async function buildDashboardHtml(env, query = {}) {
  const [creatives, googleDaily, metaDaily, shopifyDaily, newReturning, cohort, cacMonthly, stock, provenSnapshot] = await Promise.all([
    settleTab('Creatives', env.SHEET_CSV_URL_CREATIVES),
    settleTab('Google Ads', env.SHEET_CSV_URL_GOOGLE_DAILY),
    settleTab('Meta', env.SHEET_CSV_URL_META_DAILY),
    settleTab('Shopify sales', env.SHEET_CSV_URL_SHOPIFY_DAILY),
    settleTab('New vs returning', env.SHEET_CSV_URL_NEW_RETURNING),
    settleTab('Cohort', env.SHEET_CSV_URL_COHORT),
    settleTab('Monthly CAC trend', env.SHEET_CSV_URL_SHOPIFY_NEW_CUSTOMERS_MONTHLY),
    fetchLowStockSnapshot({ shopDomain: env.SHOPIFY_SHOP_DOMAIN, accessToken: env.SHOPIFY_ACCESS_TOKEN })
      .then((snap) => ({ ok: true, snap }))
      .catch((err) => {
        console.error('[dashboard] Shopify inventory fetch failed:', err);
        // asOf: null is a marker never produced by a real successful fetch — the client
        // script uses it to distinguish "outage" from "all clear" instead of rendering
        // an empty products array as a false all-clear.
        return { ok: false, snap: { asOf: null, products: [] } };
      }),
    readProvenSnapshot(env).catch((err) => { console.error('[dashboard] Proven snapshot:', err.message); return null; }),
  ]);

  const timeZone = accountTimeZone(env);
  const proven = bofView(provenSnapshot, new Date(), timeZone);

  // Anchored to the newest day EVERY day-level source has reached, not the newest
  // any one of them has. Anchoring to a leader would render the laggards' final
  // days as zeros, which reads as a collapse in performance rather than a sync
  // that has not caught up.
  const anchorDate = latestCommonDay([
    latestDate(shopifyDaily.rows, 'Day'),
    latestDate(metaDaily.rows, 'Day'),
    latestDate(googleDaily.rows, 'Day'),
  ]);

  const range = resolveReportingRange(query, { timeZone, latestAvailable: anchorDate });
  const { start, end, prevStart, prevEnd, days, isCustom, preset } = range;

  const periodLabel = `${formatShortLabel(start)} – ${formatShortLabel(end)}`;
  const comparisonLabel = `${formatShortLabel(prevStart)} – ${formatShortLabel(prevEnd)}`;
  const periodName = isCustom ? `${days} days` : `last ${days} days`;
  const cardPeriod = isCustom ? periodLabel : `last ${days}d`;

  const windowNote = `📅 Showing <b>${periodName} (${periodLabel})</b> vs the preceding ${days} days (${comparisonLabel}). Every date-based report below uses this range; sources that cannot honour it say so in place of a number.`;

  // Each source is checked on its own. A range extending past what a source has
  // synced must not be summed as if the missing days were zeros.
  const coverage = (rows) => describeCoverage(rows, { dateKey: 'Day', start, end, toIsoDate });
  const shopifyCoverage = coverage(shopifyDaily.rows);
  const metaCoverage = coverage(metaDaily.rows);
  const googleCoverage = coverage(googleDaily.rows);

  // The comparison period needs its own check. A delta against a period the
  // source never covered is not a performance change, it is missing history
  // wearing an arrow.
  const prevCoverage = (rows) => describeCoverage(rows, { dateKey: 'Day', start: prevStart, end: prevEnd, toIsoDate });
  const shopifyPrevCoverage = prevCoverage(shopifyDaily.rows);
  const metaPrevCoverage = prevCoverage(metaDaily.rows);
  const googlePrevCoverage = prevCoverage(googleDaily.rows);
  const comparable = (cur, prev) => cur.complete && prev.complete;
  const shopifyComparable = comparable(shopifyCoverage, shopifyPrevCoverage);
  const metaComparable = comparable(metaCoverage, metaPrevCoverage);
  const googleComparable = comparable(googleCoverage, googlePrevCoverage);
  const merComparable = shopifyComparable && metaComparable && googleComparable;

  const shortfall = (label, c) => {
    if (c.empty) return `${label} has no dated rows at all.`;
    if (c.missingBefore && c.missingAfter) return `${label} only covers ${c.first} to ${c.last}.`;
    if (c.missingBefore) return `${label} history starts ${c.first}, after the selected start.`;
    if (c.missingAfter) return `${label} is only synced to ${c.last}.`;
    return null;
  };
  const coverageWarnings = [
    shortfall('Shopify sales', shopifyCoverage),
    shortfall('Meta', metaCoverage),
    shortfall('Google Ads', googleCoverage),
  ].filter(Boolean);
  const coverageNote = coverageWarnings.length
    ? `<div class="note" style="color:#C98A00"><b>Partial coverage for this range.</b> ${coverageWarnings.join(' ')} Totals below cover only the days each source actually holds.</div>`
    : '';

  // Creative rows are five-day blocks, so only whole blocks inside the range are
  // aggregated — never a partial block, and never prorated (see creatives-window.js).
  const creativeWindow = creatives.ok
    ? filterCreativeBlocks(creatives.rows, { start, end, toIsoDate })
    : { dated: false, rows: [], coveredStart: null, coveredEnd: null, excluded: 0, exact: false };
  const data = !creatives.ok ? [] : creativeWindow.dated ? buildCreativesData(creativeWindow.rows) : buildCreativesData(creatives.rows);

  // When the sheet carries no usable block columns the data is still shown, but
  // labelled as unfiltered. Blanking four tabs on a header-spelling mismatch would
  // be worse: a dashboard that goes dark gets worked around, whereas a number
  // carrying an explicit "not filtered" banner gets read correctly.
  const creativesUsable = creatives.ok && (!creativeWindow.dated || creativeWindow.rows.length > 0);
  const creativeNote = !creatives.ok
    ? null
    : !creativeWindow.dated
      ? 'The Creatives sheet has no reporting-date columns, so these figures cover all synced history, NOT the selected dates.'
      : creativeWindow.rows.length === 0
        ? `No complete five-day creative block falls inside ${periodLabel}. Creative data is stored in five-day blocks, so a range shorter than one block cannot be reported.`
        : !creativeWindow.exact
          ? `Creative data is stored in five-day blocks. This covers ${formatShortLabel(creativeWindow.coveredStart)} – ${formatShortLabel(creativeWindow.coveredEnd)}; ${creativeWindow.excluded} block(s) crossing the edge of the selection were excluded rather than counted whole or prorated.`
          : null;
  const creativeCaveat = creativeNote ? limitationNote('Creative data', creativeNote) : '';

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
  // The new-vs-returning source is an undated trailing-90-day total that always
  // means "as of the latest sync". So CAC's spend window is anchored to the data
  // anchor, NOT to the selected range: selecting a historical range would
  // otherwise divide that period's spend by today's customer count.
  const cacWindow = windowBounds(range.anchor, 90);
  const cacMetaSpend = sumInWindow(metaDaily.rows, { dateKey: 'Day', valueKey: 'Amount spent (GBP)', start: cacWindow.start, end: cacWindow.end });
  const cacGoogleSpend = sumInWindow(googleDaily.rows, { dateKey: 'Day', valueKey: 'Cost', start: cacWindow.start, end: cacWindow.end });
  const cacValue = cac({ metaSpend: cacMetaSpend, googleSpend: cacGoogleSpend, newCustomers: newReturningTotals.newCustomers });


  // MER/spend/sales cards need Shopify+Meta+Google day-level data all to be present —
  // computing them against a partially-0 source (e.g. Shopify down, Meta/Google fine)
  // would silently produce a wrong number decorated with a misleading delta arrow.
  const dayLevelOk = shopifyDaily.ok && metaDaily.ok && googleDaily.ok;
  // CAC additionally needs the new-vs-returning source for its denominator.
  const cacOk = metaDaily.ok && googleDaily.ok && newReturning.ok;
  const kpiRowNeeded = dayLevelOk || cacOk || creatives.ok;
  const P = cardPeriod;
  // Shown instead of an arrow when a period is only partly covered.
  const incomparableCaption = { text: 'no comparison — incomplete history', style: 'color:#9aa0aa' };

  const kpiTop = kpiRowNeeded
    ? renderKpiRow([
        dayLevelOk
          ? { icon: `◐ BLENDED · ${P}`, big: mer.toFixed(2), cap: 'ROAS / MER (Shopify ÷ Meta+Google)', chg: merComparable ? deltaCaption(mer, prevMer, { formatFn: (v) => v.toFixed(2), direction: 'higher' }) : incomparableCaption }
          : { icon: `◐ BLENDED · ${P}`, big: '—', cap: 'ROAS / MER — data unavailable' },
        dayLevelOk
          ? { icon: `ⓕ META · ${P}`, big: formatMoneyK(metaSpend), cap: 'Spend', chg: metaComparable ? deltaCaption(metaSpend, prevMetaSpend, { formatFn: formatMoneyK, direction: 'neutral' }) : incomparableCaption }
          : { icon: `ⓕ META · ${P}`, big: '—', cap: 'Spend — data unavailable' },
        dayLevelOk
          ? { icon: `Ⓖ GOOGLE · ${P}`, big: formatMoneyK(googleSpend), cap: 'Cost', chg: googleComparable ? deltaCaption(googleSpend, prevGoogleSpend, { formatFn: formatMoneyK, direction: 'neutral' }) : incomparableCaption }
          : { icon: `Ⓖ GOOGLE · ${P}`, big: '—', cap: 'Cost — data unavailable' },
        dayLevelOk
          ? { icon: `🛍 SHOPIFY · ${P}`, big: formatMoneyK(shopifySales), cap: 'Total sales', chg: shopifyComparable ? deltaCaption(shopifySales, prevShopifySales, { formatFn: formatMoneyK, direction: 'higher' }) : incomparableCaption }
          : { icon: `🛍 SHOPIFY · ${P}`, big: '—', cap: 'Total sales — data unavailable' },
        cacOk
          ? { icon: '💷 CAC · cost per new customer', big: formatMoney(cacValue), cap: 'blended · fixed 90-day window — not the selected range' }
          : { icon: '💷 CAC · cost per new customer', big: '—', cap: 'blended · Meta+Google ÷ new customers — data unavailable' },
        proven.counts !== null
          ? {
              icon: '🛑 KILL · last 7 days', big: String(proven.counts.KILL), bigColor: '#C0392B',
              cap: provenSnapshot && (provenSnapshot.dateFrom !== start || provenSnapshot.dateTo !== end)
                ? `BOF kill rules · ${formatShortLabel(provenSnapshot.dateFrom)} – ${formatShortLabel(provenSnapshot.dateTo)}, not the selected range`
                : 'BOF ads meeting their campaign kill rules',
            }
          : { icon: '🛑 KILL · last 7 days', big: '—', cap: '7-day evaluation unavailable' },
      ])
    : unavailableNote('KPI');

  const googleTab = googleDaily.ok ? renderGoogleTab(buildGoogleCampaignRows(googleDaily.rows, { start, end })) : unavailableNote('Google');

  const metaKpi = sumInWindow(metaDaily.rows, { dateKey: 'Day', valueKey: 'Purchases', start, end });
  const metaConvValue = sumInWindow(metaDaily.rows, { dateKey: 'Day', valueKey: 'Purchases conversion value', start, end });
  const metaTab = metaDaily.ok
    ? renderMetaTab({ spend: metaSpend, purchases: metaKpi, convValue: metaConvValue, roas: metaSpend > 0 ? metaConvValue / metaSpend : 0 })
    : unavailableNote('Meta');

  const overviewTab = !creatives.ok
    ? unavailableNote('Creative overview')
    : creativesUsable
      ? creativeCaveat + renderOverviewTab({ funnel: buildFunnelSplit(data), statusSpend: buildStatusSpend(data) })
      : creativeCaveat;

  const insightsTab = !creatives.ok
    ? unavailableNote('Angle & persona')
    : !creativesUsable
    ? creativeCaveat
    : creativeCaveat + renderTwoColumn(
        renderBreakdownCard({ title: 'By angle', labelHeader: 'Angle', rows: buildBreakdown(data, (a) => a.angle), cpaDecimals: 0 }),
        renderBreakdownCard({ title: 'By persona', labelHeader: 'Persona', rows: buildBreakdown(data, (a) => a.persona), cpaDecimals: 0 })
      );

  const packprodTab = !creatives.ok
    ? unavailableNote('Pack & product')
    : !creativesUsable
    ? creativeCaveat
    : creativeCaveat + renderTwoColumn(
        renderBreakdownCard({ title: 'By pack type', labelHeader: 'Pack', rows: buildBreakdown(data, (a) => a.product), cpaDecimals: 2, boldRows: true }),
        renderBreakdownCard({ title: 'By product (pack × format)', labelHeader: 'Product', rows: buildBreakdown(data, (a) => `${a.product} · ${a.format}`), cpaDecimals: 2 })
      );

  // Computed once and reused by both the Cohort tab and the Subscription tab's Cumulative LTV
  // estimate (retention rate × AOV), so the two sections can never disagree on cohort shape.
  const allCohorts = cohort.ok ? buildCohortTable(cohort.rows) : [];
  // Acquisition months that overlap the selection, which is what the caption claims.
  const startMonth = start.slice(0, 7);
  const endMonth = end.slice(0, 7);
  const cohortTableData = allCohorts.filter((c) => c.monthKey >= startMonth && c.monthKey <= endMonth);
  const cohortsExcluded = allCohorts.length - cohortTableData.length;
  const cohortNote = limitationNote(
    'Cohort & LTV',
    `Cohorts are monthly acquisition groups, so they cannot be cut to exact days. Showing the ${cohortTableData.length} cohort(s) acquired in months overlapping ${periodLabel}` +
    `${cohortsExcluded > 0 ? ` (${cohortsExcluded} outside it hidden)` : ''}. Each row follows its cohort for its full lifetime to date, not only the selected days.`
  );
  // An empty result after filtering is a real answer, not a failure — say so rather
  // than rendering a bare header row that reads as a broken table.
  const cohortTable = !cohort.ok
    ? unavailableNote('Cohort')
    : cohortTableData.length === 0
      ? cohortNote + `<div class="note">No customer cohort was acquired in a month overlapping ${periodLabel}. Widen the range to see cohort retention and LTV.</div>`
      : cohortNote + renderCohortTable(cohortTableData);

  const aov = sumInWindow(shopifyDaily.rows, { dateKey: 'Day', valueKey: 'Net sales', start, end }) /
    (sumInWindow(shopifyDaily.rows, { dateKey: 'Day', valueKey: 'Orders', start, end }) || 1);

  const { current: aovCurrent, previous: aovPrevious, labels: aovLabels } = buildDailyAovComparisonSeries({
    shopifyDailyRows: shopifyDaily.rows, start, end, prevStart, prevEnd,
  });

  const subscriptionTab = shopifyDaily.ok && newReturning.ok
    ? limitationNote(
        'New vs returning customers',
        'The source sheet holds undated 90-day totals, so these counts cannot be cut to the selected dates. Average order value and the chart above do follow the selection.'
      ) + renderSubscriptionTab({
        aov,
        newCustomers: newReturningTotals.newCustomers,
        returningCustomers: newReturningTotals.returningCustomers,
        ltvRows: cohort.ok ? buildLtvTable(cohortTableData, aov) : [],
        aovCurrent, aovPrevious, aovLabels,
        periodLabel, comparisonLabel, customerPeriodLabel: 'last 90d',
      })
    : unavailableNote('Subscription & LTV');

  const { RS, LB } = buildDailyRoasSeries({ shopifyDailyRows: shopifyDaily.rows, metaDailyRows: metaDaily.rows, googleDailyRows: googleDaily.rows, start, end });
  const { RS: PRS } = buildDailyRoasSeries({
    shopifyDailyRows: shopifyDaily.rows, metaDailyRows: metaDaily.rows, googleDailyRows: googleDaily.rows,
    start: prevStart, end: prevEnd,
  });

  // The month containing the anchor date is still in progress (synced daily, not a full calendar
  // month yet) — included but flagged so renderCacChart can mark its bar as partial/to-date.
  const anchorMonth = end.slice(0, 7);
  const cacTrendNote = limitationNote(
    'Monthly CAC trend',
    'New-customer counts are stored per calendar month, so this trend cannot be cut to a partial month. It always shows whole months.'
  );
  const cacChart = metaDaily.ok && googleDaily.ok && cacMonthly.ok
    ? cacTrendNote + renderCacChart(buildMonthlyCacSeries({
        monthlyRows: cacMonthly.rows, metaDailyRows: metaDaily.rows, googleDailyRows: googleDaily.rows, currentMonth: anchorMonth,
      }))
    : unavailableNote('Monthly CAC trend');

  // Presets are plain links and the custom picker is a GET form, so every range is
  // a shareable URL that survives a reload.
  const presetLink = (label, d) => {
    const active = !isCustom && preset === d ? ' active' : '';
    return `<a class="db${active}" href="?days=${d}">${label}</a>`;
  };
  const rangeControls = `<div class="rangebar">
    ${presetLink('Last 7 days', 7)}${presetLink('Last 30 days', 30)}${presetLink('Last 90 days', 90)}
    <form id="range-form" method="get" action="/">
      <input type="hidden" id="range-tab" name="" value="">
      <label for="range-from">From</label>
      <input type="date" id="range-from" name="from" value="${escapeAttr(start)}" max="${escapeAttr(range.anchor)}" required>
      <label for="range-to">To</label>
      <input type="date" id="range-to" name="to" value="${escapeAttr(end)}" max="${escapeAttr(range.anchor)}" required>
      <button type="submit" class="db${isCustom ? ' active' : ''}">Apply</button>
    </form>
  </div>`;

  const html = injectDashboard(
    {
      kpiTop, googleTab, metaTab, overviewTab, insightsTab, packprodTab, cohortTable, subscriptionTab, cacChart, provenTab: proven.html,
      rangeControls, periodLabel, comparisonLabel, periodName, creativeCaveat,
      windowNote: coverageNote + windowNote,
      // Plain text (not unavailableNote's <div>) because this is injected inside an inline <span> in
      // the template; phrasing still matches "{label} data is temporarily unavailable" for consistency
      // with the other sections' degraded-state copy.
      stockStatus: stock.ok ? `live · fetched ${new Date(stock.snap.asOf).toLocaleString('en-GB')}` : 'Stock data is temporarily unavailable — please refresh shortly.',
    },
    {
      DATA: data, RS, LB, PRS, STK_SNAP: stock.snap,
      RANGE: {
        start, end, days, isCustom,
        snapshotStart: provenSnapshot ? provenSnapshot.dateFrom : null,
        snapshotEnd: provenSnapshot ? provenSnapshot.dateTo : null,
      },
    }
  );

  return html;
}

module.exports = { buildDashboardHtml };

module.exports.default = async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const query = {
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    days: url.searchParams.get('days'),
  };
  try {
    // Shape-check the range before fetching anything. Without this a malformed
    // URL costs eight Sheet fetches and a Shopify call before being refused.
    // buildDashboardHtml re-resolves against the real data anchor afterwards.
    resolveReportingRange(query, { timeZone: accountTimeZone(process.env) });
    const html = await buildDashboardHtml(process.env, {
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      days: url.searchParams.get('days'),
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // The page now varies by query string, so the shared cache must key on it.
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).send(html);
  } catch (err) {
    if (err instanceof ReportingRangeError || err.status === 400) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.status(400).send(
        `<!doctype html><meta charset="utf-8"><title>Invalid date range</title>` +
        `<div style="font:15px/1.5 system-ui,sans-serif;max-width:40em;margin:3em auto;padding:0 1em">` +
        `<h1 style="font-size:19px">That date range can't be shown</h1>` +
        `<p>${escapeAttr(err.message)}</p><p><a href="/">Back to the last 30 days</a></p></div>`
      );
      return;
    }
    console.error('[dashboard] fatal error building page:', err);
    res.status(500).send('Dashboard temporarily unavailable. Please try again shortly.');
  }
};
