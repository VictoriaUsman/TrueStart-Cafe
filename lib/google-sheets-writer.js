// lib/google-sheets-writer.js

async function overwriteSheetRange({ accessToken, sheetId, tabName, rows }) {
  const clearRange = encodeURIComponent(`${tabName}!A2:Z100000`);
  const clearRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${clearRange}:clear`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!clearRes.ok) {
    throw new Error(`Sheets clear failed (${clearRes.status}) for "${tabName}"`);
  }

  const updateRange = encodeURIComponent(`${tabName}!A2`);
  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${updateRange}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    }
  );
  if (!updateRes.ok) {
    throw new Error(`Sheets update failed (${updateRes.status}) for "${tabName}"`);
  }
}

module.exports = { overwriteSheetRange };
