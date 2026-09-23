const { fetchBofData } = require('../lib/bof-data');
const { sevenDayWindow, buildSnapshot, accountTimeZone } = require('../lib/transform/bof-rules');
const { writeProvenSnapshot } = require('../lib/bof-snapshot');

async function syncProven(env, now = new Date()) {
  if (!env.WINDSOR_API_KEY) throw new Error('Missing WINDSOR_API_KEY');
  const timeZone = accountTimeZone(env);
  const window = sevenDayWindow(now, timeZone);
  const rows = await fetchBofData(env, window);
  const snapshot = buildSnapshot(rows, { ...window, timeZone, now });
  await writeProvenSnapshot(env, snapshot);
  return { ok: true, ads: snapshot.ads.length, ...window };
}

module.exports = { syncProven };
module.exports.default = async (req, res) => {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).send('Unauthorized');
    return;
  }
  try { res.status(200).json(await syncProven(process.env)); }
  catch (err) { console.error('[sync-proven]', err.message); res.status(500).json({ ok: false, error: err.message }); }
};
