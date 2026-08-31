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
// The Creatives tab's row capacity was bumped from 1,000 to 2,500 rows (via the Sheets API,
// 2026-09-01) specifically to fit CHUNK_COUNT*BAND_SIZE bands: 2 + 6*400 = 2,402 rows needed,
// with headroom to 2,500. If either constant changes, the live tab's row capacity must be
// re-verified/re-bumped to at least `2 + CHUNK_COUNT * BAND_SIZE`, or the highest-index chunks
// will fail their Sheets write silently (values.update does not auto-expand the grid).
const BAND_SIZE = 400;
const REQUIRED_ENV_VARS = ['WINDSOR_API_KEY', 'GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_KEY'];
const MS_PER_DAY = 86400000;

function chunkDateRange(chunk, referenceDate = new Date()) {
  const yesterday = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayEpochDay = Math.floor(yesterday.getTime() / MS_PER_DAY);

  // The block containing yesterday only advances once every CHUNK_DAYS days — a chunk that's
  // 1-4 days late (retrying after a prior failure) still targets the exact same block it would
  // have on time, eliminating drift between chunks that succeed on different days.
  const currentBlock = Math.floor(yesterdayEpochDay / CHUNK_DAYS);
  const blockIndex = currentBlock - chunk;

  const blockStartEpochDay = blockIndex * CHUNK_DAYS;
  const blockEndEpochDay = blockStartEpochDay + CHUNK_DAYS - 1;

  const epochDayToIso = (epochDay) => isoDay(new Date(epochDay * MS_PER_DAY));

  return { dateFrom: epochDayToIso(blockStartEpochDay), dateTo: epochDayToIso(blockEndEpochDay) };
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

  // A live ad account having genuinely zero ads across a 5-day window is implausible; a 200 with
  // an empty body from this connector (documented unreliable) is far more likely a soft failure.
  // Treat it like the hard-failure path — write nothing at all, so the band keeps its last-good
  // data rather than being cleared on the strength of a probably-bogus empty response.
  if (sheetRows.length === 0) {
    console.warn(`[sync-creatives] chunk ${chunk} got 0 ads from Windsor for ${dateFrom}..${dateTo} — treating as a likely soft failure, band left untouched`);
    return { ok: true, rows: 0, skipped: 'empty-response' };
  }

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
  // Fail closed: without this, an unset CRON_SECRET makes `expected` the literal string
  // "Bearer undefined", which any caller could send.
  if (!process.env.CRON_SECRET) {
    res.status(500).send('CRON_SECRET not configured');
    return;
  }
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!req.headers.authorization || req.headers.authorization !== expected) {
    res.status(401).send('Unauthorized');
    return;
  }

  // Digits only — `Number('')` is 0, so an empty/whitespace param would otherwise silently
  // run chunk 0 instead of being rejected.
  const rawChunk = req.query && req.query.chunk;
  const chunk = typeof rawChunk === 'string' && /^\d+$/.test(rawChunk) ? Number(rawChunk) : NaN;
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
