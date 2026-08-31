// lib/shopify.js

const QUERY = `
  query LowStock($first: Int!) {
    products(first: $first, query: "status:active", sortKey: INVENTORY_TOTAL) {
      edges {
        node {
          title
          productType
          handle
          variants(first: 50) {
            edges { node { title sku inventoryQuantity } }
          }
        }
      }
    }
  }
`;

async function fetchLowStockSnapshot({ shopDomain, accessToken, first = 50 }) {
  const res = await fetch(`https://${shopDomain}/admin/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query: QUERY, variables: { first } }),
  });
  if (!res.ok) {
    throw new Error(`Shopify API error (${res.status})`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  const products = json.data.products.edges.map((e) => e.node);
  return { asOf: new Date().toISOString(), products };
}

module.exports = { fetchLowStockSnapshot };
