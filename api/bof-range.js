const { fetchWindsorData } = require('../lib/windsor');
const { buildSnapshot } = require('../lib/transform/bof-rules');
const { renderBofTable } = require('../lib/render/bof-rules');

const ACCOUNT_ID = '732629205086';
const MAX_RANGE_DAYS = 180;
const DAY_MS = 86400000;

class RangeRequestError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// Rejects "2026-13-01" and "2026-02-30", which Date.parse would otherwise
// roll over into a valid but wrong date.
function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function todayIn(timeZone, now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type) => parts.find((p) => p.type === type).value;
  return new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
}

async function bofRange(env, query, now = new Date()) {
  if (!env.WINDSOR_API_KEY) throw new Error('Missing WINDSOR_API_KEY');
  const timeZone = env.META_ACCOUNT_TIMEZONE || 'Europe/London';

  const { from, to } = query || {};
  if (!from || !to) throw new RangeRequestError('Both from and to are required.');

  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) throw new RangeRequestError('Dates must be calendar dates in YYYY-MM-DD form.');
  if (start.getTime() > end.getTime()) throw new RangeRequestError('The start date from is after to.');

  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) throw new RangeRequestError(`Ranges are limited to ${MAX_RANGE_DAYS} days.`);

  if (end.getTime() >= todayIn(timeZone, now).getTime()) {
    throw new RangeRequestError('Only complete days can be shown, so the end date must be before today.');
  }

  const rows = await fetchWindsorData({
    apiKey: env.WINDSOR_API_KEY, connector: 'facebook', accountId: ACCOUNT_ID,
    dateFrom: from, dateTo: to,
    fields: ['ad_id', 'ad_name', 'campaign', 'spend', 'actions_omni_purchase', 'action_values_omni_purchase'],
  });

  const snapshot = buildSnapshot(rows, { dateFrom: from, dateTo: to, timeZone, now });
  const { html, counts } = renderBofTable({ ...snapshot, isDefaultWindow: false });
  return { ok: true, html, counts, dateFrom: from, dateTo: to };
}

module.exports = { bofRange, RangeRequestError };
module.exports.default = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    const result = await bofRange(process.env, {
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
    });
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(result);
  } catch (err) {
    const status = err.status === 400 ? 400 : 500;
    if (status === 500) console.error('[bof-range]', err.message);
    res.status(status).json({
      ok: false,
      error: status === 400 ? err.message : 'Could not load that date range. Please try again shortly.',
    });
  }
};
