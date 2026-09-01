// lib/windsor.js

async function fetchWindsorData({ apiKey, connector, accountId, fields, dateFrom, dateTo }) {
  // The account_id query param isn't reliably honored server-side by every connector — verified
  // against the live API, the google_ads connector returns rows for every account connected to
  // the Windsor.ai workspace regardless of this filter, which mixed a second client's account
  // (NBS, 652-880-9542) in with our own. Always request account_id ourselves and filter to it
  // client-side, so no caller can leak another connected account's data even if a connector's
  // own filtering is broken or changes behaviour later.
  const requestFields = fields.includes('account_id') ? fields : [...fields, 'account_id'];
  const params = new URLSearchParams({
    api_key: apiKey,
    fields: requestFields.join(','),
    account_id: accountId,
    date_from: dateFrom,
    date_to: dateTo,
  });
  const res = await fetch(`https://connectors.windsor.ai/${connector}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Windsor API error (${res.status}) for connector "${connector}"`);
  }
  const json = await res.json();
  if (json.error) {
    throw new Error(`Windsor API error: ${json.error}`);
  }
  const rows = json.data || [];
  return rows.filter((row) => String(row.account_id) === String(accountId));
}

module.exports = { fetchWindsorData };
