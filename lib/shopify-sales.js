// lib/shopify-sales.js
// Fetches daily Total Sales report data via ShopifyQL (Admin GraphQL's shopifyqlQuery field) —
// the same "sales" schema and column set as Shopify's native Total Sales report.

const GRAPHQL_QUERY = `
  query ShopifyQL($q: String!) {
    shopifyqlQuery(query: $q) {
      tableData { columns { name dataType } rows }
      parseErrors
    }
  }
`;

async function fetchShopifySales({ shopDomain, accessToken, dateFrom, dateTo }) {
  return shopifyQlQuery({
    shopDomain, accessToken,
    shopifyql: `FROM sales SHOW orders, gross_sales, discounts, returns, net_sales, shipping_charges, duties, additional_fees, taxes, total_sales TIMESERIES day SINCE ${dateFrom} UNTIL ${dateTo} ORDER BY day ASC`,
  });
}

async function shopifyQlQuery({ shopDomain, accessToken, shopifyql }) {
  const res = await fetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query: GRAPHQL_QUERY, variables: { q: shopifyql } }),
  });
  if (!res.ok) {
    throw new Error(`Shopify API error (${res.status})`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  const result = json.data.shopifyqlQuery;
  if (result.parseErrors && result.parseErrors.length > 0) {
    throw new Error(`ShopifyQL parse error: ${result.parseErrors.join(', ')}`);
  }
  return result.tableData ? result.tableData.rows : [];
}

async function fetchNewVsReturning({ shopDomain, accessToken, dateFrom, dateTo }) {
  const rows = await shopifyQlQuery({
    shopDomain, accessToken,
    shopifyql: `FROM sales SHOW new_customers, returning_customers SINCE ${dateFrom} UNTIL ${dateTo}`,
  });
  const row = rows[0] || {};
  return {
    newCustomers: parseInt(row.new_customers, 10) || 0,
    returningCustomers: parseInt(row.returning_customers, 10) || 0,
  };
}

module.exports = { fetchShopifySales, fetchNewVsReturning };
