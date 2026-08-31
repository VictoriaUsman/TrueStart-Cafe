# Chunked Creatives Sync — Design

**Date:** 2026-09-01
**Status:** Approved, ready for implementation planning

## 1. Problem

The `Creatives` Sheet tab (ad-level Meta performance, feeding the PROVEN/ready-to-move KPI card and the All Creatives table) is not synced by anything in this codebase — `sync-windsor.js` deliberately excludes it, because Windsor's `facebook` connector at ad-level granularity is far too slow and unreliable for a single Vercel Hobby function call (hard, non-configurable 10-second cap). In practice, whatever external process used to refresh it has stopped: every row currently carries the same `Reporting starts/ends` window, `2026-07-15`–`2026-08-13`, ~19 days stale as of today. The PROVEN KPI card's numbers are computed correctly from that data, but the data itself is no longer current.

**Investigated and confirmed (2026-09-01):** direct timed calls against Windsor's `facebook` connector at ad-level granularity show the problem is worse than "slow" — it's unreliable regardless of date-range width:

| Range | Sample timings |
|---|---|
| 1 day | 8.9s |
| 7-9 days | 1.6s, 1.6s, 1.6s, 1.6s, 20.3s, 22.0s, 25.5s, **FAILED after 10.6s** (×2) |
| 30 days | 31.4s |
| 90 days | 2.4s |

Non-monotonic and inconsistent — the same date range succeeded in ~1.6s in one call and failed outright in another. No chunk width tested was reliably safe under a 10-second budget.

## 2. Decision

Per discussion, chunk the sync into 6 independent, cron-triggered pieces rather than upgrading the Vercel plan or leaving Creatives on manual/external refresh. Each chunk is small enough that most calls succeed well under budget; a chunk that fails on a given day simply leaves its slice of ads showing their last successful sync until the next day's retry — never blanked, never wiped.

## 3. Chunking scheme

6 chunks, each covering a non-overlapping 5-day slice of the rolling 30-day window, indexed 0 (most recent) through 5 (oldest):

| Chunk | Covers (days ago) |
|---|---|
| 0 | 1–5 |
| 1 | 6–10 |
| 2 | 11–15 |
| 3 | 16–20 |
| 4 | 21–25 |
| 5 | 26–30 |

`dateFrom = daysAgo(chunk*5 + 5)`, `dateTo = daysAgo(chunk*5 + 1)` (yesterday, not today — same reasoning as every other sync job: today is a partial day).

Each chunk is a separate Vercel Cron entry hitting the same handler with a `chunk` query param, staggered 5 minutes apart so all 6 don't hit Windsor in the same instant:

```json
{ "path": "/api/sync-creatives?chunk=0", "schedule": "20 6 * * *" },
{ "path": "/api/sync-creatives?chunk=1", "schedule": "25 6 * * *" },
{ "path": "/api/sync-creatives?chunk=2", "schedule": "30 6 * * *" },
{ "path": "/api/sync-creatives?chunk=3", "schedule": "35 6 * * *" },
{ "path": "/api/sync-creatives?chunk=4", "schedule": "40 6 * * *" },
{ "path": "/api/sync-creatives?chunk=5", "schedule": "45 6 * * *" }
```

8 total cron jobs project-wide (existing 2 + these 6) — well under Vercel's 100/project cap (raised from 2 to 100 on all plans, including Hobby, as of 2026-01-20). Each individual cron still fires at most once/day (Hobby constraint), which is why a failed chunk's natural retry is "tomorrow," not "in five minutes."

## 4. Why aggregation, not raw rows

Raw per-ad-per-day rows from Windsor run ~100-140/day; a full 30-day window at that granularity would need 3,000+ rows, but the Creatives tab is currently provisioned for only 1,000. Rather than resize it to fit raw data, each chunk **pre-aggregates its own slice into one row per ad** (summed spend/impressions/purchases/conversion value over that chunk's 5 days), because `buildCreativesData` (`lib/transform/creatives.js`) already re-aggregates every row it sees by `Ad name` across the *whole* tab regardless of which chunk wrote it or how many rows exist per ad. Six chunks' worth of one-row-per-ad data, all keyed by the same ad names, sum together into the correct full-window total with zero changes needed to the existing read/aggregation path.

This also means "top campaign" (used for status classification) composes correctly without change: each chunk picks its own highest-spend campaign per ad; `buildCreativesData` then picks the highest-spend campaign *among those chunk-level picks* — which is mathematically the same as scanning every raw row, since the max of per-partition maxes equals the global max over non-overlapping partitions.

## 5. Components

- **`lib/transform/aggregate-creatives-chunk.js`** (new) — `aggregateCreativesChunk(windsorRows, { dateFrom, dateTo })`: groups Windsor's raw ad-level rows by `ad_name`, sums `spend`, `impressions`, `actions_omni_purchase` (purchases), `link_clicks`, `action_values_omni_purchase`; picks the `campaign`/`adset_name` from whichever raw row had the highest `spend` as representative (mirrors `buildCreativesData`'s existing `topCamp` logic); recomputes `purchase_roas_omni_purchase` as `sum(action_values) / sum(spend)` (0 if spend is 0) rather than averaging each row's own ROAS. Sets `date_start`/`date_stop` on every output row to the chunk's own `dateFrom`/`dateTo`. Output shape matches `mapCreativesRows`' existing column order exactly, so `lib/transform/windsor-to-sheet-rows.js`'s `mapCreativesRows` is reused unchanged downstream.

- **`lib/google-sheets-writer.js`** — add `overwriteSheetBand({ accessToken, sheetId, tabName, startRow, bandSize, rows, columnCount })`: writes `rows` starting at `startRow`, then clears any leftover rows in `[startRow + rows.length, startRow + bandSize)` — never beyond `bandSize`, so it can never reach into a neighboring chunk's band. Throws if `rows.length > bandSize` (a chunk producing more unique ads than its reserved band can hold is a real problem, not something to silently overflow past). Unlike `overwriteSheetRange`, **0 rows is a legitimate input, not an error** — a chunk whose window genuinely had no ad spend clears its band to empty; this is distinct from a Windsor fetch failure, which never calls the writer at all (see §6). `overwriteSheetRange` itself (used by every other sync job) is untouched.

- **`api/sync-creatives.js`** (new) — `CHUNK_COUNT = 6`, `CHUNK_DAYS = 5`, `BAND_SIZE = 400` (rows reserved per chunk; current per-ad total is 233, so 400 leaves real headroom). `bandStartRow(chunk) = 2 + chunk * BAND_SIZE`. Exports `syncCreativesChunk(env, chunk): Promise<{ok, rows?, error?}>` (pure, same pattern as `syncWindsor`/`syncShopify`) and the default HTTP handler: validates `CRON_SECRET`, reads+validates `chunk` from the query string (integer, `0 <= chunk < CHUNK_COUNT`, else 400), calls `syncCreativesChunk`, responds 200/207/500 matching the existing convention. On a Windsor fetch failure, **no write is attempted at all** — the band is left exactly as it was.

- **One-time setup (not code):** bump the live `Creatives` tab's row capacity from 1,000 to 2,500 (`2 + 6*400 = 2402`, rounded up with margin) via the Sheets API, the same way `ShopifyNewCustomersMonthly` was created earlier this session. I'll do this once we start implementing.

## 6. Error handling

Each chunk is fully independent — one failing (Windsor error, parse error, Sheets write error) never touches the other 5 chunks' bands or blocks their writes. A failed chunk simply doesn't write; whatever was in its band from the last successful run stays there, read normally by `buildCreativesData` on the next dashboard request. No "data unavailable" state is needed for a single failed chunk — from the dashboard's perspective it's indistinguishable from "this chunk's ads didn't change," which is an acceptable, honest degradation (a few ads' numbers are a day or more stale, not the whole PROVEN card going blank).

## 7. Testing

TDD throughout, matching this repo's existing style (`node:test`, mocked `global.fetch`, no external dependencies):

- `aggregate-creatives-chunk.test.js` — sums correctly across multiple rows per ad, picks the highest-spend campaign/adset as representative, recomputes ROAS from summed values (not averaged), sets `date_start`/`date_stop` to the chunk's window, defaults missing numeric fields to 0 (matching `windsor-to-sheet-rows.js`'s existing convention).
- `google-sheets-writer.test.js` (extended) — `overwriteSheetBand` writes at the given `startRow`, clears only within `[startRow+rows.length, startRow+bandSize)`, throws when `rows.length > bandSize`, never issues a request touching rows outside its band, and accepts 0 rows (clearing the whole band) without throwing.
- `sync-creatives.test.js` — chunk→date-range math for all 6 chunk indices, rejects an out-of-range/non-numeric `chunk` param with 400, one chunk's Windsor failure doesn't affect another's success in the same test run, a failed chunk makes no Sheets write call at all (assert on the mock's call list), `CRON_SECRET` gating matches the existing handlers.

## 8. Deployment / setup checklist (external to this codebase)

1. Bump the `Creatives` tab's row capacity (1,000 → 2,500) via the Sheets API — done once, by me, when implementation starts.
2. Deploy — the 6 new cron entries in `vercel.json` register automatically.
3. First real run happens on the next `06:20`–`06:45` UTC window; verify via the sync endpoints' JSON responses and by checking the `Creatives` tab's `Reporting starts/ends` values are current the next morning.

## 9. Out of scope

- Retrying a failed chunk sooner than the next day — Hobby's once-per-day-per-cron limit makes same-day retry impractical without a second, differently-scheduled cron per chunk (12 total instead of 6); not worth the added complexity for a KPI card, per the earlier discussion of this feature's overall priority.
- Any change to `buildCreativesData`, `getCreativeStatus`, or the PROVEN KPI card's rendering — none are needed; this is purely a data-freshness fix underneath already-correct logic.
- Upgrading the Vercel plan — explicitly the alternative not taken; revisit if the chunked approach proves too unreliable in practice.
