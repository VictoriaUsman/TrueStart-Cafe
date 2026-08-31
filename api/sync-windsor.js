// api/sync-windsor.js
const { fetchWindsorData } = require('../lib/windsor');
const { getAccessToken } = require('../lib/google-sheets-auth');
const { overwriteSheetRange } = require('../lib/google-sheets-writer');
const { mapCreativesRows, mapGoogleDailyRows, mapMetaDailyRows } = require('../lib/transform/windsor-to-sheet-rows');

const FACEBOOK_ACCOUNT_ID = '732629205086';
const GOOGLE_ADS_ACCOUNT_ID = '779-598-7920';
const WINDOW_DAYS = 90;

function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

function dateRange(days, referenceDate = new Date()) {
  const end = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { dateFrom: toIsoDate(start), dateTo: toIsoDate(end) };
}

async function syncWindsor(env) {
  const { dateFrom, dateTo } = dateRange(WINDOW_DAYS);
  const accessToken = await getAccessToken({
    clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n'),
  });

  const jobs = [
    {
      tab: 'Creatives',
      fetch: () => fetchWindsorData({
        apiKey: env.WINDSOR_API_KEY, connector: 'facebook', accountId: FACEBOOK_ACCOUNT_ID, dateFrom, dateTo,
        fields: ['date_start', 'date_stop', 'ad_name', 'spend', 'impressions', 'actions_omni_purchase', 'adset_name', 'purchase_roas_omni_purchase', 'link_clicks', 'campaign', 'action_values_omni_purchase'],
      }),
      map: mapCreativesRows,
    },
    {
      tab: 'GoogleDaily',
      fetch: () => fetchWindsorData({
        apiKey: env.WINDSOR_API_KEY, connector: 'google_ads', accountId: GOOGLE_ADS_ACCOUNT_ID, dateFrom, dateTo,
        fields: ['campaign', 'date', 'currency', 'cost', 'impressions', 'clicks', 'conversions', 'conversion_value'],
      }),
      map: mapGoogleDailyRows,
    },
    {
      tab: 'MetaDaily',
      fetch: () => fetchWindsorData({
        apiKey: env.WINDSOR_API_KEY, connector: 'facebook', accountId: FACEBOOK_ACCOUNT_ID, dateFrom, dateTo,
        fields: ['campaign', 'date', 'impressions', 'spend', 'link_clicks', 'actions_omni_purchase', 'action_values_omni_purchase', 'purchase_roas_omni_purchase'],
      }),
      map: mapMetaDailyRows,
    },
  ];

  const results = {};
  for (const job of jobs) {
    try {
      const windsorRows = await job.fetch();
      const sheetRows = job.map(windsorRows);
      await overwriteSheetRange({ accessToken, sheetId: env.GOOGLE_SHEET_ID, tabName: job.tab, rows: sheetRows });
      results[job.tab] = { ok: true, rows: sheetRows.length };
    } catch (err) {
      console.error(`[sync-windsor] ${job.tab} failed:`, err);
      results[job.tab] = { ok: false, error: err.message };
    }
  }
  return results;
}

module.exports = { syncWindsor, dateRange };

module.exports.default = async function handler(req, res) {
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!req.headers.authorization || req.headers.authorization !== expected) {
    res.status(401).send('Unauthorized');
    return;
  }
  try {
    const results = await syncWindsor(process.env);
    const allOk = Object.values(results).every((r) => r.ok);
    res.status(allOk ? 200 : 207).json(results);
  } catch (err) {
    console.error('[sync-windsor] fatal error:', err);
    res.status(500).json({ error: err.message });
  }
};
