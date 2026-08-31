// api/sync-windsor.js
const { fetchWindsorData } = require('../lib/windsor');
const { getAccessToken } = require('../lib/google-sheets-auth');
const { overwriteSheetRange } = require('../lib/google-sheets-writer');
const { mapGoogleDailyRows, mapMetaDailyRows } = require('../lib/transform/windsor-to-sheet-rows');
const { dateRange } = require('../lib/dates');

const FACEBOOK_ACCOUNT_ID = '732629205086';
const GOOGLE_ADS_ACCOUNT_ID = '779-598-7920';
const WINDOW_DAYS = 90;
const REQUIRED_ENV_VARS = ['WINDSOR_API_KEY', 'GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_KEY'];

async function syncWindsor(env) {
  const missing = REQUIRED_ENV_VARS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  // End the window at yesterday, not today — today is a partial day whose near-zero metrics
  // would otherwise distort the most recent point on any daily chart built from this data.
  const yesterday = new Date(Date.now() - 86400000);
  const { dateFrom, dateTo } = dateRange(WINDOW_DAYS, yesterday);

  // Kick off the token exchange and all three Windsor fetches in the same tick, rather than
  // waiting for the token before starting any Windsor call. This keeps the token exchange's
  // latency off the critical path, which matters on a Hobby-plan Vercel function (hard 10s cap,
  // not configurable via maxDuration) — this endpoint's total work would otherwise risk timing out.
  const tokenPromise = getAccessToken({
    clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n'),
  });

  // Note: the Creatives tab (ad-level Meta data) is deliberately NOT synced here. Windsor's
  // facebook connector at ad-level granularity is too slow/unreliable for a single Vercel Hobby
  // function call (verified directly against the live API: timings ranging 1.6s-31s and outright
  // failures, regardless of date-range width). GoogleDaily/MetaDaily are campaign+day-level
  // aggregates and respond in ~2s for the full 90-day window, so only those two are synced by this
  // job. Creatives has its own chunked sync instead — see api/sync-creatives.js.
  const jobs = [
    {
      tab: 'GoogleDaily',
      fetchPromise: fetchWindsorData({
        apiKey: env.WINDSOR_API_KEY, connector: 'google_ads', accountId: GOOGLE_ADS_ACCOUNT_ID, dateFrom, dateTo,
        fields: ['campaign', 'date', 'currency', 'cost', 'impressions', 'clicks', 'conversions', 'conversion_value'],
      }),
      map: mapGoogleDailyRows,
    },
    {
      tab: 'MetaDaily',
      fetchPromise: fetchWindsorData({
        apiKey: env.WINDSOR_API_KEY, connector: 'facebook', accountId: FACEBOOK_ACCOUNT_ID, dateFrom, dateTo,
        fields: ['campaign', 'date', 'impressions', 'spend', 'link_clicks', 'actions_omni_purchase', 'action_values_omni_purchase', 'purchase_roas_omni_purchase'],
      }),
      map: mapMetaDailyRows,
    },
  ];

  const results = {};
  await Promise.all(jobs.map(async (job) => {
    try {
      const [accessToken, windsorRows] = await Promise.all([tokenPromise, job.fetchPromise]);
      const sheetRows = job.map(windsorRows);
      await overwriteSheetRange({
        accessToken,
        sheetId: env.GOOGLE_SHEET_ID,
        tabName: job.tab,
        rows: sheetRows,
        columnCount: sheetRows[0]?.length,
      });
      results[job.tab] = { ok: true, rows: sheetRows.length };
    } catch (err) {
      console.error(`[sync-windsor] ${job.tab} failed:`, err);
      results[job.tab] = { ok: false, error: err.message };
    }
  }));
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
