// Renders the real Cohort table against the LIVE Google Sheet feed, using the actual app code
// (no Vercel/server needed) — just to eyeball the fix. Run: node preview-cohort.js
const fs = require('fs');
const path = require('path');

const APP_DIR = 'C:/Users/THISPC/Documents/Kalilos/TrueStart Cafe';
const { buildCohortTable } = require(path.join(APP_DIR, 'lib/transform/cohort'));
const { renderCohortTable } = require(path.join(APP_DIR, 'lib/render/cohort'));
const { csvToObjects } = require(path.join(APP_DIR, 'lib/csv'));

function readEnvVar(name) {
  const envText = fs.readFileSync(path.join(APP_DIR, '.env'), 'utf8');
  const m = envText.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return m && m[1].trim();
}

async function main() {
  const url = readEnvVar('SHEET_CSV_URL_COHORT');
  if (!url) throw new Error('SHEET_CSV_URL_COHORT not set in .env');

  const res = await fetch(url);
  const csvText = await res.text();
  const rows = csvToObjects(csvText);

  const table = buildCohortTable(rows);
  console.log(table.map((r) => `${r.cohortLabel}: ${r.size}`).join('\n'));

  const html = `<!doctype html><meta charset="utf-8"><title>Cohort preview</title>${renderCohortTable(table)}`;
  const outPath = path.join(__dirname, 'cohort-preview.html');
  fs.writeFileSync(outPath, html);
  console.log('\nWrote ' + outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
