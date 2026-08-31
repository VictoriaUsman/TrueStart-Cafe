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
};

const LITERAL_MARKERS = { DATA: 'DATA', RS: 'RS', LB: 'LB', STK_SNAP: 'STK_SNAP' };

function injectDashboard(sections, literals) {
  let html = fs.readFileSync(TEMPLATE_PATH, 'utf8');

  for (const [sectionKey, markerName] of Object.entries(HTML_MARKERS)) {
    const marker = `<!--INJECT:${markerName}-->`;
    if (!html.includes(marker)) {
      throw new Error(`Template marker ${marker} not found — has lib/template.html drifted?`);
    }
    html = html.replace(marker, () => sections[sectionKey]);
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

module.exports = { injectDashboard };
