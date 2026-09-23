# TrueStart Live Paid Media Dashboard

Live Vercel-hosted version of the TrueStart paid media dashboard. See
`docs/superpowers/specs/2026-08-31-live-dashboard-design.md` for the
full design.

## Setup

1. Publish each of the 7 Sheet tabs to web as CSV (Google Sheet -> File
   -> Share -> Publish to web -> select tab -> CSV), and copy each
   resulting URL into the matching `SHEET_CSV_URL_*` variable below.
   Once `sync-shopify.js` has run at least once and created the
   `ShopifyNewCustomersMonthly` tab (header row: `Month, New customers,
   Returning customers`), publish that tab too and set
   `SHEET_CSV_URL_SHOPIFY_NEW_CUSTOMERS_MONTHLY` — this powers the
   Monthly CAC trend chart; until it's set, that chart shows a "data
   unavailable" note.
2. Create a Shopify custom app (Settings -> Apps -> Develop apps) with
   `read_inventory` + `read_products` scopes and generate an Admin API
   access token.
3. Copy `.env.example` to `.env` and fill in both sets of values for
   local development.
4. In Vercel, add the same variables as project Environment Variables,
   then connect this repo for auto-deploy on push.

## Development

- `npm test` — run all unit tests.
- `vercel dev` — run the dashboard locally (requires `.env` filled in).

## BOF purchase metrics

`K-TS_UK_BOF_Sales Retargeting` is the confirmed Taster campaign. Its ads use
Recovery above £18 CPR, Kill above £24 CPR (or spend ≥ £100 with zero purchases),
and are never Cold eligible, regardless of the product in the ad name.

The daily BOF snapshot and custom date ranges both request Meta's ad-set
attribution settings (`use_unified_attribution_setting=true`). Purchases and
purchase value come from `actions_omni_purchase` and
`action_values_omni_purchase`; CPR is total spend / total purchases and ROAS is
total purchase value / total spend. Ratios are calculated after summing each ad's
rows, never averaged across dates. See the
[Windsor connector reference](https://windsor.ai/data-field/facebook/).

Snapshots made before this attribution setting was explicit are shown as
unavailable until the next successful `/api/sync-proven` refresh. The scheduled
refresh runs daily at 06:50 UTC.

For a read-only reconciliation against Meta's reported purchase CPR and ROAS:

```powershell
node --env-file=.env --env-file=.env.local scripts/verify-bof.js
# Or pass an explicit completed date range:
node --env-file=.env --env-file=.env.local scripts/verify-bof.js 2026-09-16 2026-09-22
```

The script prints counts and mismatches, exits unsuccessfully on discrepancies,
and does not change campaigns or the stored snapshot. On 2026-09-23, the
2026-09-16 through 2026-09-22 window returned 57 BOF rows; all 23 rows with
purchases matched both reported ratios within 0.0001 (Meta's rounding precision).
Ads Manager comparisons must use the same dates and each ad set's attribution
setting; an overridden comparison window can still show different totals.
