// api/sync-creatives.js
const { fetchWindsorData } = require('../lib/windsor');
const { getAccessToken } = require('../lib/google-sheets-auth');
const { overwriteSheetBand } = require('../lib/google-sheets-writer');
const { aggregateCreativesChunk } = require('../lib/transform/aggregate-creatives-chunk');
const { mapCreativesRows } = require('../lib/transform/windsor-to-sheet-rows');
const { isoDay } = require('../lib/dates');

const FACEBOOK_ACCOUNT_ID = '732629205086';
const CHUNK_COUNT = 6;
const CHUNK_DAYS = 5;
const BAND_SIZE = 400;
const REQUIRED_ENV_VARS = ['WINDSOR_API_KEY', 'GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_KEY'];

function chunkDateRange(chunk, referenceDate = new Date()) {
  const end = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - 1 - chunk * CHUNK_DAYS); // yesterday, minus this chunk's offset
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (CHUNK_DAYS - 1));
  return { dateFrom: isoDay(start), dateTo: isoDay(end) };
}

function bandStartRow(chunk) {
  return 2 + chunk * BAND_SIZE;
}

async function syncCreativesChunk(env, chunk) {
  const missing = REQUIRED_ENV_VARS.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  const { dateFrom, dateTo } = chunkDateRange(chunk);

  // Windsor first, on its own — it's the failure-prone step (verified: ~50% of ad-level calls
  // fail or run long in testing). No point spending a token-fetch round trip if it's going to fail.
  const windsorRows = await fetchWindsorData({
    apiKey: env.WINDSOR_API_KEY, connector: 'facebook', accountId: FACEBOOK_ACCOUNT_ID, dateFrom, dateTo,
    fields: ['date_start', 'date_stop', 'ad_name', 'spend', 'impressions', 'actions_omni_purchase', 'adset_name', 'purchase_roas_omni_purchase', 'link_clicks', 'campaign', 'action_values_omni_purchase'],
  });

  const aggregated = aggregateCreativesChunk(windsorRows, { dateFrom, dateTo });
  const sheetRows = mapCreativesRows(aggregated);

  const accessToken = await getAccessToken({
    clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n'),
  });

  await overwriteSheetBand({
    accessToken, sheetId: env.GOOGLE_SHEET_ID, tabName: 'Creatives',
    startRow: bandStartRow(chunk), bandSize: BAND_SIZE, rows: sheetRows, columnCount: 11,
  });

  return { ok: true, rows: sheetRows.length };
}

module.exports = { syncCreativesChunk, chunkDateRange, bandStartRow, CHUNK_COUNT, CHUNK_DAYS, BAND_SIZE };

module.exports.default = async function handler(req, res) {
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!req.headers.authorization || req.headers.authorization !== expected) {
    res.status(401).send('Unauthorized');
    return;
  }

  const chunk = Number(req.query && req.query.chunk);
  if (!Number.isInteger(chunk) || chunk < 0 || chunk >= CHUNK_COUNT) {
    res.status(400).json({ error: `chunk must be an integer between 0 and ${CHUNK_COUNT - 1}` });
    return;
  }

  try {
    const result = await syncCreativesChunk(process.env, chunk);
    res.status(200).json(result);
  } catch (err) {
    console.error(`[sync-creatives] chunk ${chunk} failed:`, err);
    res.status(500).json({ ok: false, error: err.message });
  }
};
