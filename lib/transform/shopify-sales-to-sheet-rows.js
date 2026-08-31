// lib/transform/shopify-sales-to-sheet-rows.js
const { parseNumber, parseInteger } = require('../numbers');

function mapShopifySalesRows(rows) {
  return rows.map((row) => [
    row.day || '',
    parseInteger(row.orders),
    parseNumber(row.gross_sales),
    parseNumber(row.discounts),
    parseNumber(row.returns),
    parseNumber(row.net_sales),
    parseNumber(row.shipping_charges),
    parseNumber(row.duties),
    parseNumber(row.additional_fees),
    parseNumber(row.taxes),
    parseNumber(row.total_sales),
  ]);
}

function mapNewCustomersMonthlyRows(rows) {
  return rows.map((row) => [
    row.month || '',
    parseInteger(row.new_customers),
    parseInteger(row.returning_customers),
  ]);
}

module.exports = { mapShopifySalesRows, mapNewCustomersMonthlyRows };
