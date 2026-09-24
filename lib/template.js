// lib/template.js
const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, 'template.html');

const HTML_MARKERS = {
  kpiTop: 'KPI_TOP',
  googleTab: 'GOOGLE_TAB',
  metaTab: 'META_TAB',
  overviewTab: 'OVERVIEW_TAB',
  insightsTab: 'INSIGHTS_TAB',
  packprodTab: 'PACKPROD_TAB',
  cohortTable: 'COHORT_TABLE',
  subscriptionTab: 'SUBSCRIPTION_TAB',
  stockStatus: 'STOCK_STATUS',
  cacChart: 'CAC_CHART',
  windowNote: 'WINDOW_NOTE',
  provenTab: 'PROVEN_TAB',
  rangeControls: 'RANGE_CONTROLS',
  creativeCaveat: 'CREATIVE_CAVEAT',
};

// Period labels appear in several headings at once, so unlike HTML_MARKERS these
// are replaced at every occurrence. Declaring them here — rather than leaving the
// dashboard to string-replace snapshot dates out of the rendered page — keeps the
// template the single place that decides where a date label may appear.
const TEXT_MARKERS = {
  periodLabel: 'PERIOD_LABEL',
  comparisonLabel: 'COMPARISON_LABEL',
  periodName: 'PERIOD_NAME',
  comparisonName: 'COMPARISON_NAME',
};

const LITERAL_MARKERS = { DATA: 'DATA', RS: 'RS', LB: 'LB', STK_SNAP: 'STK_SNAP', RANGE: 'RANGE', PRS: 'PRS' };

// Core injection logic, factored out of injectDashboard so the "missing marker throws"
// drift guard can be exercised directly against a deliberately-broken in-memory template,
// without needing to mutate (and restore) the real lib/template.html on disk.
function injectIntoHtml(html, sections, literals) {
  for (const [sectionKey, markerName] of Object.entries(HTML_MARKERS)) {
    const marker = `<!--INJECT:${markerName}-->`;
    if (!html.includes(marker)) {
      throw new Error(`Template marker ${marker} not found — has lib/template.html drifted?`);
    }
    html = html.replace(marker, () => sections[sectionKey]);
  }

  for (const [textKey, markerName] of Object.entries(TEXT_MARKERS)) {
    const marker = `<!--INJECT:${markerName}-->`;
    if (!html.includes(marker)) {
      throw new Error(`Template marker ${marker} not found — has lib/template.html drifted?`);
    }
    // Replace-all, not replace-first: a period label legitimately appears in
    // several headings, and a half-updated page showing two different date
    // ranges is worse than one that fails loudly.
    html = html.split(marker).join(sections[textKey]);
  }

  for (const [literalKey, markerName] of Object.entries(LITERAL_MARKERS)) {
    const marker = `/*INJECT:${markerName}*/`;
    if (!html.includes(marker)) {
      throw new Error(`Template marker ${marker} not found — has lib/template.html drifted?`);
    }
    // Escape every '<' so a live value containing "</script>" or "<!--" can't
    // break out of the surrounding <script> tag.
    const safeJson = JSON.stringify(literals[literalKey]).replace(/</g, '\\u003c');
    html = html.replace(marker, () => safeJson);
  }

  return html;
}

function injectDashboard(sections, literals) {
  const html = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  return injectIntoHtml(html, sections, literals);
}

module.exports = { injectDashboard, injectIntoHtml, HTML_MARKERS, TEXT_MARKERS };
