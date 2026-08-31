// lib/sheets.js
const { csvToObjects } = require('./csv');

async function fetchSheetTab(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Sheet fetch failed (${res.status}) for ${url}`);
  }
  const text = await res.text();
  return csvToObjects(text);
}

module.exports = { fetchSheetTab };
