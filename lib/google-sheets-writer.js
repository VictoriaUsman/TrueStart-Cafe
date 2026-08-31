// lib/google-sheets-writer.js

function columnLetter(count) {
  let n = count;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

async function overwriteSheetRange({ accessToken, sheetId, tabName, rows, columnCount }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`Refusing to overwrite "${tabName}" with 0 rows`);
  }

  const lastColumn = columnLetter(columnCount || rows[0].length);

  // Write the new data first. Only a range exactly as tall as `rows` is touched, so the sheet
  // is never empty at any point in time even if the clear-leftovers step below fails.
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

  // Then clear whatever leftover rows sit below the freshly-written data (e.g. a previous,
  // longer run), limited to this tab's real column width.
  const clearRange = encodeURIComponent(`${tabName}!A${rows.length + 2}:${lastColumn}100000`);
  const clearRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${clearRange}:clear`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!clearRes.ok) {
    throw new Error(`Sheets clear failed (${clearRes.status}) for "${tabName}"`);
  }
}

module.exports = { overwriteSheetRange };
