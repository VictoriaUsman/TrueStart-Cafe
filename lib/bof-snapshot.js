const { getAccessToken } = require('./google-sheets-auth');
const TAB = 'Proven7Day';

async function sheetClient(env) {
  for (const key of ['GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_KEY']) {
    if (!env[key]) throw new Error(`Missing ${key}`);
  }
  const token = await getAccessToken({ clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, privateKey: env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n') });
  return async (suffix, body) => {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}${suffix}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`Proven snapshot Sheets request failed (${res.status})`);
    return res.json();
  };
}

async function writeProvenSnapshot(env, snapshot) {
  const request = await sheetClient(env);
  const metadata = await request('?fields=sheets.properties');
  let sheet = metadata.sheets.find((s) => s.properties.title === TAB)?.properties;
  const requests = [];
  if (!sheet) {
    const sheetId = Math.max(0, ...metadata.sheets.map((s) => s.properties.sheetId)) + 1;
    sheet = { sheetId, title: TAB, gridProperties: { rowCount: Math.max(1000, snapshot.ads.length + 1), columnCount: 7 } };
    requests.push({ addSheet: { properties: sheet } });
  } else if (sheet.gridProperties.rowCount < snapshot.ads.length + 1) {
    requests.push({ updateSheetProperties: { properties: { sheetId: sheet.sheetId, gridProperties: { rowCount: snapshot.ads.length + 1 } }, fields: 'gridProperties.rowCount' } });
  }
  const { ads, ...info } = snapshot;
  const values = [[JSON.stringify(info)], ...ads.map((ad) => [ad.id, ad.name, ad.campaign, ad.product, ad.spend, ad.purchases, ad.revenue])];
  requests.push({ updateCells: {
    range: { sheetId: sheet.sheetId }, fields: 'userEnteredValue',
    rows: values.map((row) => ({ values: row.map((value) => ({ userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: value } })) })),
  } });
  await request(':batchUpdate', { requests });
}

async function readProvenSnapshot(env) {
  const request = await sheetClient(env);
  const { values } = await request(`/values/${TAB}!A:G?valueRenderOption=UNFORMATTED_VALUE`);
  if (!values?.[0]?.[0]) throw new Error('Proven snapshot not synced yet');
  const info = JSON.parse(values[0][0]);
  const ads = values.slice(1).map(([id, name, campaign, product, spend, purchases, revenue]) => ({ id, name, campaign, product, spend, purchases, revenue }));
  if (!ads.length || ads.some((ad) =>
    !ad.id || !ad.name ||
    !Number.isFinite(ad.spend) || ad.spend < 0 ||
    !Number.isFinite(ad.purchases) || ad.purchases < 0 ||
    !Number.isFinite(ad.revenue) || ad.revenue < 0
  )) throw new Error('Invalid Proven snapshot');
  return { ...info, ads };
}

module.exports = { writeProvenSnapshot, readProvenSnapshot };
