// lib/windsor.js

async function fetchWindsorData({ apiKey, connector, accountId, fields, dateFrom, dateTo }) {
  const params = new URLSearchParams({
    api_key: apiKey,
    fields: fields.join(','),
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
  return json.data || [];
}

module.exports = { fetchWindsorData };
