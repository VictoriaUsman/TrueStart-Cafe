# TrueStart Paid Media Dashboard — Live Version Design

**Date:** 2026-08-31
**Status:** Approved, ready for implementation planning

## 1. Problem

`TrueStart — Paid Media Dashboard.html` is a fully static snapshot: every KPI, table, and inline SVG chart is baked-in text/JSON, generated once by an offline process. There is no `fetch`, API call, or client-side data logic anywhere in the file. The goal is a live version, hosted on Vercel, that reproduces the exact same layout and styling but is populated from real data sources on every page load.

## 2. Data sources

| Source | Access | Feeds |
|---|---|---|
| Google Sheet `TrueStart_Dashboard_Data` (`1N3Z9AuDSQpByVa6JuEOsXZKJ-8zH3VvO8u7hR6qPGp0`) | Published-to-web CSV export, one URL per tab | Meta/Google ad performance, Shopify sales, new-vs-returning customers, cohort retention |
| Shopify Admin API | Direct live call, custom-app access token (`read_inventory`, `read_products`) | Stock alerts tab |

The Sheet itself is kept fresh by Windsor.ai (Meta/Google) and Shopify exports on their own schedule — this project only reads it, never writes to it.

### 2.1 Sheet tabs (confirmed from live inspection)

1. **Creatives** — `Reporting starts/ends, Ad name, Amount spent (GBP), Impressions, Purchases, Ad set name, Purchase ROAS, Link clicks, Campaign name, Purchases conversion value` — ad-level Meta export, ~30-day window
2. **Google Ads by day** — `Campaign, Day, Currency code, Cost, Impr., Clicks, Conversions, Conv. value` — long history
3. **Meta by day** — `Campaign name, Day, Impressions, Amount spent (GBP), Link clicks, Purchases, Purchases conversion value, Purchase ROAS, Reporting starts/ends` — long history
4. **Shopify daily sales** — `Day, Orders, Gross sales, Discounts, Sales reversals, Net sales, Shipping charges, Duties, Additional fees, Taxes, Total sales`
5. **New vs returning customers** — `New or returning customer, Customers`
6. **Cohort retention** — `Month, Months since first purchase, Customers, Customer retention rate, Customers in cohort`
7. **AOV daily comparison** — `Day, Gross sales, Discounts, Orders, Average order value` + previous-period columns

No subscription/Recharge data exists in the Sheet yet — the Subscription & LTV tab's subscriber-specific metrics (active subscribers, taster→subscribe rate) remain a "coming soon" placeholder note, same as the current static file.

## 3. Architecture

**Key discovery from reading the original file's embedded `<script>` in full:** most of the page is not actually static markup waiting to be reimplemented — a meaningful chunk of it is already live client-side JS, driven by a small number of injected data literals:

- `const DATA=[...]` — the 399-row creative array (drives the All Creatives table, sorting, and status-filter buttons via `render()`/`redraw()`)
- `const RS=[...]` / `const LB=[...]` — daily blended-ROAS values and matching date labels, going back to Feb 15 — drives the Master ROAS chart's 7/30/90 toggle and dashed previous-period line via `drawc(days)`
- `var STK_SNAP={...}` — a Shopify product/inventory snapshot in a specific shape (`{title, productType, handle, variants:{edges:[{node:{title, sku, inventoryQuantity}}]}}`) — drives the entire Stock alerts tab via `stkAdv()`/`stkRender()`/`stkBoot()`, including the "advertised" flag, OOS/LOW classification, and the adjustable threshold (already stored in `localStorage`)

None of that interactive logic needs to be rewritten. The architecture is therefore: **treat the original file as a template**, keep its CSS and script logic byte-for-byte identical, and replace only (a) the few markup fragments that are genuinely static per-request content (KPI cards, Google Ads table, Meta campaigns table, Creative Overview funnel/status bars, Angle & Persona / Pack & Product tables, Subscription & LTV tables, Cohort table) and (b) the `DATA`, `RS`, `LB`, and `STK_SNAP` literals, computed fresh server-side on every request.

Single Vercel serverless project, plain Node (no framework):

```
/api/dashboard.js      — request handler: fetch → transform → render → respond
/lib/sheets.js          — CSV fetch + parse per tab
/lib/shopify.js         — Shopify Admin API client; returns data already shaped like STK_SNAP.products
/lib/transform/
  stage.js              — TOF/MOF/BOF lookup from campaign name
  status.js             — PROVEN/TESTING/STARVED/Feeder classification
  creative-parse.js     — angle/persona/product/format parser from ad name
  kpi.js                — blended MER, CAC, and other cross-source math
  daily-roas.js         — full-history daily blended ROAS series + date labels (RS/LB)
  cohort.js             — cohort table shaping
/lib/render.js           — builds HTML fragments for the non-JS-driven sections, matching the current file's exact markup, driven by computed data
/lib/template.js         — loads the original file as a template and injects the render.js fragments + the DATA/RS/LB/STK_SNAP literals into their exact original spots; everything else (CSS, script functions) passes through unchanged
```

On each request: fetch all Sheet tabs (CSV) + live Shopify inventory in parallel → run transforms → inject into the template → return `text/html`. Response cached at the edge for ~60s (`stale-while-revalidate`) so concurrent visitors don't each trigger fresh upstream fetches.

**Stock "advertised" rule (reusing the original's existing, already-proven logic instead of a new ad-name cross-reference):**
- Excluded outright if `productType + title + handle` matches `/gift|equipment|merch|machine|chocolate|umbrella|boonie|aeropress|cafetiere|filter/i`
- Otherwise "advertised" if `productType` matches `/starter pack|coffee bags|instant coffee|ground coffee|coffee beans/i`, or `title`/`handle` matches `/taster|starter/i`
- This logic (`stkAdv`, `stkRender`, `stkBoot`, threshold input) stays in the page's script unchanged — the only server-side job is producing a fresh `STK_SNAP`-shaped object from Shopify's Admin API (lowest-stock ~50 active products, matching the original's `status:active, sort_key:INVENTORY_TOTAL, first:50` query).

## 4. Business logic rules (confirmed)

- **Funnel stage (TOF/MOF/BOF):** determined entirely by campaign name substring (`K-TS_UK_TOF_...`, `_MOF_...`, `_BOF_...`).
- **Status classification**, evaluated per ad in the last-30d window:
  - Campaign is a TOF or MOF campaign → `Feeder`, regardless of performance.
  - Campaign is `K-TS_UK_BOF-PROVEN` → `PROVEN`.
  - Spend ≈ £0 / 0 purchases → `STARVED`.
  - Otherwise (BOF `Sales Retargeting`) → `PROVEN` if purchases ≥ 20, else `TESTING`.
  - `in_proven` flag (separate from `status`): true only for ads physically placed in the `K-TS_UK_BOF-PROVEN` campaign. Dashboard caption "N in Proven campaign · M ready to move" = count of `in_proven=true` vs. `status=PROVEN & in_proven=false`.
- **Angle / Persona / Product / Format:** parsed from `Ad name` using the naming convention `..._<Persona>_<Angle>_<Product>_<Format>[ V#]` (e.g. `BOF_ST_19_Upgrader_Price_Starter_Bags V2`). Any name that doesn't match falls back to `"Other"` for each field.
- **Blended ROAS / MER** = Total Shopify sales ÷ (Meta spend + Google cost), for a given window.
- **CAC** = (Meta spend + Google spend) ÷ new customers (from New-vs-returning tab), per month.
- **Stock "advertised" flag and low-stock threshold:** see Section 3 — reuses the original page's existing regex rule and `localStorage`-backed threshold input unchanged; not re-derived server-side.
- **Daily blended ROAS series (`RS`/`LB`):** one value per calendar day covered by the Sheet's Shopify-daily-sales and Meta/Google-by-day tabs (from Feb 15 onward) = that day's Shopify total sales ÷ that day's (Meta spend + Google cost); `LB` is the matching `"Mon D"`-formatted date label for each day, in the same order.

## 5. Rendering

The existing HTML's CSS block and script functions are reused verbatim (see Section 3). Only two things change per request:
1. The markup fragments for the non-JS-driven sections (KPI cards, Google Ads table, Meta campaign tables, funnel bars, angle/persona/pack/product tables, subscription/LTV tables, cohort heatmap) — each generated by a JS function that emits the same markup shape as the current static file, parameterized by computed data (not simple placeholder substitution, since row counts vary per section).
2. The `DATA`, `RS`, `LB`, and `STK_SNAP` JS literals inside the `<script>` block, replaced with freshly computed values in the same shapes the existing script already expects.

## 6. Error handling

Each section degrades independently:
- Sheet tab fetch fails (network error, unpublished, moved) → that section renders a visible "data unavailable" note; rest of the page renders normally.
- Shopify inventory fetch fails (bad/expired token, API error) → Stock tab shows an "unavailable" state instead of crashing the whole page.
- All fetch/parse errors are logged server-side (visible in Vercel function logs).

## 7. Testing

- Unit tests (Node's built-in test runner) for each `/lib/transform` module, using the 399-row creative dataset already extracted from the current static file as a golden fixture, plus known-good totals (e.g. current Google Ads table totals, Shopify sales figures) as expected-output checks.
- A template-injection test asserting the final HTML still contains the original's CSS block and script functions (`stkAdv`, `stkRender`, `drawc`, `render`, `redraw`, etc.) unchanged, with only `DATA`/`RS`/`LB`/`STK_SNAP` literals replaced.
- Manual side-by-side comparison against the current static file immediately after first deploy, tab by tab.

## 8. Access & security

Public, unlisted Vercel URL. No authentication layer. Relies on the URL not being shared/indexed — acceptable per stated risk tolerance for this data.

## 9. Deployment

- Repo: `https://github.com/VictoriaUsman/TrueStart-Cafe.git` (currently empty)
- This folder becomes that repo's contents; Vercel connects via its GitHub integration for auto-deploy on push to the default branch.

## 10. Setup checklist (external to this codebase)

1. Publish each of the 7 Sheet tabs to web as CSV (File → Share → Publish to web), and collect the resulting export URLs.
2. Create a Shopify custom app (Settings → Apps → Develop apps) with `read_inventory` + `read_products` scopes; generate an Admin API access token.
3. Store both as Vercel environment variables (Sheet CSV URLs, Shopify store domain + token).
4. Connect the GitHub repo to a new Vercel project.

## 11. Explicitly out of scope for this iteration

- Subscriber-level Recharge metrics (active subscribers, taster→subscribe rate, subscription LTV) — stays a placeholder note.
- Any authentication/access control beyond an unlisted URL.
- Writing back to the Sheet or Shopify — this is read-only in both directions.
