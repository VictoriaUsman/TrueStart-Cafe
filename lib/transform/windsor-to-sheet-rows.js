// lib/transform/windsor-to-sheet-rows.js

function num(row, field) {
  return row[field] === undefined || row[field] === null ? 0 : row[field];
}

function text(row, field) {
  return row[field] === undefined || row[field] === null ? '' : row[field];
}

function mapCreativesRows(windsorRows) {
  return windsorRows.map((row) => [
    text(row, 'date_start'),
    text(row, 'date_stop'),
    text(row, 'ad_name'),
    num(row, 'spend'),
    num(row, 'impressions'),
    num(row, 'actions_omni_purchase'),
    text(row, 'adset_name'),
    num(row, 'purchase_roas_omni_purchase'),
    num(row, 'link_clicks'),
    text(row, 'campaign'),
    num(row, 'action_values_omni_purchase'),
  ]);
}

function mapGoogleDailyRows(windsorRows) {
  return windsorRows.map((row) => [
    text(row, 'campaign'),
    text(row, 'date'),
    text(row, 'currency'),
    num(row, 'cost'),
    num(row, 'impressions'),
    num(row, 'clicks'),
    num(row, 'conversions'),
    num(row, 'conversion_value'),
  ]);
}

function mapMetaDailyRows(windsorRows) {
  return windsorRows.map((row) => [
    text(row, 'campaign'),
    text(row, 'date'),
    num(row, 'impressions'),
    num(row, 'spend'),
    num(row, 'link_clicks'),
    num(row, 'actions_omni_purchase'),
    num(row, 'action_values_omni_purchase'),
    num(row, 'purchase_roas_omni_purchase'),
    text(row, 'date'),
    text(row, 'date'),
  ]);
}

module.exports = { mapCreativesRows, mapGoogleDailyRows, mapMetaDailyRows };
