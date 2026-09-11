const { fetchWindsorData } = require('../lib/windsor');
const { sevenDayWindow, buildProvenSnapshot } = require('../lib/transform/proven');
const { writeProvenSnapshot } = require('../lib/proven-snapshot');

async function syncProven(env, now = new Date()) {
  if (!env.WINDSOR_API_KEY) throw new Error('Missing WINDSOR_API_KEY');
  const timeZone = env.META_ACCOUNT_TIMEZONE || 'Europe/London';
  const window = sevenDayWindow(now, timeZone);
  const rows = await fetchWindsorData({ apiKey: env.WINDSOR_API_KEY, connector: 'facebook', accountId: '732629205086', ...window,
    fields: ['ad_id', 'ad_name', 'campaign', 'spend', 'actions_omni_purchase'],
  });
  const snapshot = buildProvenSnapshot(rows, { ...window, timeZone, now });
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
