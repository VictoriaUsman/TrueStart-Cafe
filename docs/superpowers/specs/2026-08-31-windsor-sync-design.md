# Windsor.ai → Sheet Daily Sync — Design

**Date:** 2026-08-31
**Status:** Approved, ready for implementation planning

## 1. Problem

Per the original live-dashboard design (`2026-08-31-live-dashboard-design.md`), the `Creatives`, `GoogleDaily`, and `MetaDaily` tabs of `TrueStart_Dashboard_Data` were assumed to be kept fresh by an existing Windsor.ai subscription "on its own schedule," external to this codebase. In practice, that external process is owned by a teammate and isn't something this project can rely on or observe. This design replaces that assumption with an owned, scheduled sync: a job in this codebase that pulls Meta/Google ad data directly from the Windsor.ai API and writes it into those same Sheet tabs.

**This supersedes one line of the original spec's Section 11** ("Writing back to the Sheet or Shopify — this is read-only in both directions"): the Sheet write path described here is a deliberate, narrow exception, scoped only to the three ad-data tabs below. Everything else (Shopify, the other five Sheet tabs, the dashboard's own read path) remains read-only, unchanged.

## 2. Data source

**Windsor.ai Connectors API** (`https://connectors.windsor.ai/{connector}`), authenticated with `WINDSOR_API_KEY`.

Confirmed connected accounts for TrueStart (via `https://onboard.windsor.ai/api/common/ds-accounts?datasource=all`):

| Connector | Account name | Account ID |
|---|---|---|
| `facebook` | facebook__TrueStart Coffee | `facebook__732629205086` |
| `google_ads` | google_ads__TrueStart Coffee | `google_ads__779-598-7920` |

A third connected account, `google_ads__NBS` (`652-880-9542`), belongs to a different client on the same Windsor.ai workspace and must never be queried or written anywhere in this flow.

## 3. Target: Google Sheet write access

Google Sheets API (`sheets.googleapis.com`), authenticated via a dedicated service account (Google Cloud project `truestart-dashboard`), granted **Editor** access on the `TrueStart_Dashboard_Data` Sheet directly (no special IAM role needed — access comes from the share, not a project role).

Env vars: `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY` (PEM key with literal `\n` escapes, matching how it's stored in the downloaded JSON key).

Confirmed real tab names (via `spreadsheets.get`), which differ slightly from the original spec's guesses:

`Creatives`, `GoogleDaily`, `MetaDaily`, `MetaCampaign`, `ShopifyTotals`, `ShopifyNewVsReturning`, `ShopifyCohort`, `ShopifyAOV`, `Recharge`.

This sync only ever writes to `Creatives`, `GoogleDaily`, `MetaDaily`. The rest are untouched.

## 4. Architecture

A single new Vercel Cron job, running once daily:

```
/api/sync-windsor.js       — cron entry point: verifies Vercel's CRON_SECRET, orchestrates the sync, returns a status summary
/lib/windsor.js             — fetches facebook/google_ads data from Windsor, scoped to the two TrueStart account IDs above, for a rolling 90-day window (date_from/date_to)
/lib/google-sheets-writer.js — service-account JWT auth (RS256, signed with GOOGLE_SERVICE_ACCOUNT_KEY) + a values.update wrapper that overwrites a tab's data range
/lib/transform/windsor-to-sheet-rows.js — maps each connector's raw fields onto the exact existing column headers of Creatives / GoogleDaily / MetaDaily (field names confirmed against Windsor's field list during implementation)
```

`vercel.json` gains a `crons` entry (once daily — Vercel Hobby tier supports 1x/day per cron job, which is all this needs).

### Data flow

1. Vercel Cron triggers `GET /api/sync-windsor` daily.
2. Handler checks the request's `Authorization: Bearer $CRON_SECRET` header (Vercel sets this automatically for its own cron invocations) — rejects anything else.
3. For each of the three tabs, independently: fetch the relevant connector's last-90-days data → map to that tab's row shape → overwrite the tab's data range (header row untouched) via Sheets API.
4. Downstream, the existing dashboard (`lib/sheets.js`, `render/google.js`, `render/meta.js`, etc.) is completely unchanged — it keeps reading the same published-to-web CSV export URLs, now backed by Windsor-sourced data instead of the teammate's external process.

### Rolling window, not append-only

Each run **overwrites** the full 90-day window in each tab (not an incremental append). This was a deliberate simplicity choice: no de-duplication or "have I already written today's row" logic is needed, a bad Windsor value on one day self-heals on the next run, and the trade-off (Sheet history capped at 90 days for these three tabs) is acceptable — none of the dashboard's current calculations need lookback beyond 90 days for ad data.

## 5. Error handling

Each tab's fetch+map+write is wrapped independently (one `try/catch` per tab):
- A failure fetching from Windsor (auth error, rate limit, network) or writing to Sheets for one tab does not block the other two.
- On failure, that tab's existing Sheet data is left untouched (stale, not corrupted) — there is no partial overwrite.
- All failures are logged server-side (Vercel function logs) and surfaced in the endpoint's JSON response (per-tab `ok`/`error` status), so a failed run is visible without needing to inspect the Sheet by hand.

## 6. Testing

- Unit tests (Node's built-in test runner, matching the existing project convention in `test/`) for the Windsor-row → sheet-row mapping functions in `lib/transform/windsor-to-sheet-rows.js` — pure functions, fixture-driven.
- `fetch` mocked for both the Windsor Connectors API and the Google Sheets API (JWT token exchange + `values.update`), following the same mocking style as `test/shopify.test.js`. No test hits live credentials.
- No end-to-end test against the real Sheet/Windsor account — verified manually post-deploy by checking the Sheet's contents after a manual trigger of the cron endpoint.

## 7. Access & security

- The service account's private key and the Windsor API key are Vercel environment variables only — never committed (`.gitignore` already covers `.env*` and the downloaded service-account JSON filename pattern).
- The service account has Editor access scoped to exactly one Sheet (granted via direct share, not a broader Drive/Workspace role).
- The cron endpoint is protected by Vercel's `CRON_SECRET` mechanism so it can't be triggered by an arbitrary request to its public URL.

## 8. Setup checklist (external to this codebase — already completed during design)

1. ✅ Obtain `WINDSOR_API_KEY` from the teammate's Windsor.ai account (Account Management → API Access).
2. ✅ Create Google Cloud project `truestart-dashboard`, enable the Sheets API, create service account `sheet-writer@truestart-dashboard.iam.gserviceaccount.com`, download its JSON key.
3. ✅ Share `TrueStart_Dashboard_Data` with that service account email as Editor.
4. ✅ Confirm read/write access end-to-end with a one-off verification script.
5. ⬜ Add `WINDSOR_API_KEY`, `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY`, and a generated `CRON_SECRET` as Vercel environment variables (Production + Preview), same as the Shopify vars.

## 9. Explicitly out of scope for this iteration

- Any change to how the dashboard itself reads data — it stays 100% CSV-based, unaware Windsor exists.
- Writing to any tab other than `Creatives`, `GoogleDaily`, `MetaDaily`.
- Historical backfill beyond 90 days, or preserving history longer than the rolling window.
- Alerting/notification on sync failure beyond the endpoint's own JSON response and Vercel's function logs.
- Removing or replacing the teammate's original Windsor.ai → Sheet process, if one still runs independently — this design doesn't assume it's disabled, only that this job's own writes are authoritative for the three tabs above at the time it runs.
