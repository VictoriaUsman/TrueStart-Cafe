# TrueStart Live Paid Media Dashboard

Live Vercel-hosted version of the TrueStart paid media dashboard. See
`docs/superpowers/specs/2026-08-31-live-dashboard-design.md` for the
full design.

## Setup

1. Publish each of the 7 Sheet tabs to web as CSV (Google Sheet -> File
   -> Share -> Publish to web -> select tab -> CSV), and copy each
   resulting URL into the matching `SHEET_CSV_URL_*` variable below.
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
