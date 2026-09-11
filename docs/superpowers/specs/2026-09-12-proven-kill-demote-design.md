# Proven · 7 Days — Kill/Demote Evaluator — Design

**Date:** 2026-09-12
**Status:** Approved, ready for implementation planning

## 1. Context

The dashboard currently groups ads by ad name, stores performance in five-day
blocks, and marks ads "Proven" based on campaign name or a lifetime 20-purchase
count — none of which can reliably support a rolling seven-day, ad-level
definition of Proven/Testing/Demote/Kill.

A prior, uncommitted increment already built the foundation for this: a
dedicated seven-day feed keyed by Meta ad ID (`api/sync-proven.js`,
`lib/transform/proven.js`, `lib/proven-snapshot.js`, `lib/render/proven.js`),
separate from the legacy 30-day, ad-name-keyed `Creatives` pipeline. That feed
already:

- Fetches Meta-attributed spend and purchases by ad ID via Windsor's
  `facebook` connector.
- Computes the last seven *completed* days in the account's reporting
  timezone (`META_ACCOUNT_TIMEZONE`, default `Europe/London`), DST-safe.
- Refreshes the full seven-day window daily (captures attribution updates),
  via the existing `sync-proven` cron.
- Stores one aggregate row per ad (`id, name, campaign, product, spend,
  purchases`) in a `Proven7Day` Sheet tab, plus window/timezone/refresh
  metadata.
- Treats a stale, wrong-window, or missing snapshot as "unavailable for
  evaluation" rather than guessing, and never lets an empty/invalid Windsor
  response overwrite the last good snapshot.
- Computes CPA unrounded and only when `purchases > 0` (`null`/"—"
  otherwise) — never treated as £0.

What it does *not* yet do: distinguish Demote or Kill from "not yet Proven,"
or give the dashboard filters/counts across all four qualification states.
This design closes that gap only — it does not touch the legacy `Creatives`
pipeline, `lib/transform/status.js`'s Feeder/Starved/Testing bucketing, or
add ad set / "In Proven campaign" / funnel stage to this feed (see §6, Out of
scope).

Scope statement (from the requester): this implements dashboard indicators
and recommendations only. Budget changes and pausing ads remain manual,
human actions — a separate Meta write-integration would be required to
automate them, and is explicitly out of scope here.

## 2. Shared rule evaluator

`lib/transform/proven.js`'s `evaluateProven({ spend, purchases, product })` is
replaced by a single function producing one of five mutually-exclusive
statuses, evaluated in this precedence order — **Kill, then Demote, then
Proven, then Testing** — so a higher-priority condition always wins:

| Status | Condition | Action shown | Testing daily cap |
|---|---|---|---|
| `UNAVAILABLE` | `spend`/`purchases` not finite or negative | "Check performance data" | — |
| `KILL` | spend ≥ £100 with zero purchases, **or** CPA > 2× the product bar | "Pause ad" | — |
| `DEMOTE` | CPA > 1.5× the bar (Kill not already triggered) | "Return to / keep in Testing — £20/day cap" | £20 |
| `PROVEN` | spend ≥ £150, purchases ≥ 15, and CPA ≤ bar | "Eligible for Proven budget" | — |
| `TESTING` | everything else | "Continue testing" | — |

Product bars: Taster ≤£12, Starter ≤£15, PDP/other ≤£20 (same bar drives the
1.5×/2× Demote/Kill multipliers). CPA is `spend / purchases` when
`purchases > 0`, else `null` — displayed as "—", never coerced to £0; the
explicit ≥£100-zero-purchase rule is what determines Kill in that case, not a
CPA-as-Infinity comparison.

Each result carries a human-readable `reason` (e.g. "Seven-day CPA exceeds
£24.00", or, for Testing, every failed Proven criterion joined with " · ") so
every ad has one explainable status. The function keeps its existing
`evaluateProven` export name and its `proven` boolean field (`true` iff
status is `PROVEN`), so the current Proven-count KPI card keeps working
unchanged.

**Boundary behaviour, explicit:**
- CPA exactly at 1.5× the bar → does **not** trigger Demote (strictly
  greater-than).
- CPA exactly at 2× the bar → triggers Demote, not Kill (Kill is strictly
  greater-than 2×).
- Spend exactly £100 with zero purchases → Kill. £99.99 with zero purchases
  → falls through to Testing (or Demote/Kill only if CPA math applies, which
  it can't at zero purchases — so Testing).

**Action text is a pure function of status**, not of campaign placement —
resolving the earlier open question about "Return to Testing" vs. "Keep
Testing" copy: both read as a single combined string, "Return to / keep in
Testing — £20/day cap," since campaign placement ("In Proven campaign") is
out of scope for this pass (§6).

## 3. Data pipeline — unchanged behaviour, reaffirmed

`api/sync-proven.js` and `lib/proven-snapshot.js` keep their current
contract:

- Fetch Meta-attributed spend and purchases by ad ID.
- Refresh the entire seven-day window daily.
- Window = last seven completed days in the Meta account's reporting
  timezone.
- A failed fetch never overwrites the last good snapshot; a stale or
  mismatched-window snapshot renders as unavailable.
- Product mapping (`productForAd`, consolidated into `creative-parse.js`'s
  shared parser) is checked against real ad names so Taster/Starter ads
  aren't misclassified into the £20 "PDP / other" bar.
- Campaign name/placement never overrides a computed status — it plays no
  role in `evaluateProven` at all.

No new snapshot columns are added — status, reason, and action are all
derived at render time from the metrics already stored (`spend`,
`purchases`, `product`).

Reconciliation against Ads Manager (same dates, same attribution settings)
is a manual verification step the requester performs directly (§7); this
design surfaces ad ID, date range, timezone, and last-refresh time clearly
enough to make that check straightforward.

## 4. Rendering (`lib/render/proven.js`)

Replaces the binary "PROVEN / NOT YET PROVEN" table with the full
evaluation:

```js
const STATUS_COLORS = { KILL: '#C0392B', DEMOTE: '#D97706', PROVEN: '#1E8A4C', TESTING: '#6B7280', UNAVAILABLE: '#6B7280' };
const STATUS_ORDER = { KILL: 0, DEMOTE: 1, PROVEN: 2, TESTING: 3, UNAVAILABLE: 4 };
```

Ads are mapped through `evaluateProven` and sorted by status priority (Kill
first), then by spend descending within a status. A `counts` object is
computed per status (`{ KILL, DEMOTE, PROVEN, TESTING, UNAVAILABLE }`) and
returned alongside `html`; `count` (== `counts.PROVEN`) is kept for backward
compatibility with the existing KPI card.

Table columns: Ad/Meta ID, Product, 7d spend, 7d purchases, 7d CPA, CPA bar,
Status, Recommended action, Reason. Every value interpolated into HTML is
escaped (existing `escapeHtml`, unchanged). Recommended-action text is
visually/labelled as a *recommendation* (not an applied action), so it can't
be mistaken for something already done in Meta.

## 5. Dashboard controls (`lib/template.html`)

- Tab renamed from "Proven · 7 days" to **"Creative performance · 7 days."**
- The "Show Proven only" checkbox is replaced with a status `<select>`
  (All/Proven/Demote/Kill/Testing) filtering rows client-side by a
  `data-status` attribute on each `<tr>`, mirroring the existing filter
  pattern used elsewhere in this file.
- Counts for Proven, Demote, and Kill are shown above the table.

## 6. Out of scope for this pass

- Adding `adset_name` to the Windsor fetch, snapshot columns, or table.
- An "In Proven campaign" placement indicator/column, and any
  placement-conditioned action text.
- A separate funnel-stage field on this feed.
- Any change to the legacy 30-day `Creatives` pipeline, `creatives.js`, or
  `status.js`'s Feeder/Starved/Testing bucketing.
- Automating budget changes or pausing ads (would require a Meta write
  integration — explicitly not part of this design).

These were flagged during design as real gaps against the original request's
ad-set/in-Proven-campaign/funnel-stage asks, and are deliberately deferred to
a follow-up increment rather than folded in here.

## 7. Testing & validation

Extend `test/transform/proven.test.js` with boundary coverage (values in
GBP, purchases as counts):

| Product | Spend | Purchases | Expected |
|---|---|---|---|
| Taster | £180 | 15 | Proven |
| Starter | £225 | 15 | Proven |
| PDP / other | £300 | 15 | Proven |
| Taster | £149.99 | 15 | Testing (spend just under £150) |
| Taster | £180 | 10 | Testing (CPA exactly 1.5×) |
| Taster | £180.01 | 10 | Demote |
| Taster | £240 | 10 | Demote (CPA exactly 2×) |
| Taster | £240.01 | 10 | Kill |
| any | £100 | 0 | Kill |
| any | £99.99 | 0 | Testing |

Plus: the equivalent Starter/PDP demote and kill boundaries, invalid
(non-finite/negative) metrics → `UNAVAILABLE`, stale/missing snapshot →
render's existing "unavailable" fallback, status counts, `data-status`
filtering, and the existing "same name separate by ad ID, same ID summed"
coverage preserved unchanged.

Run: `node --test --test-isolation=none "test/**/*.test.js"`.

Manual verification before rollout:
1. Start the dashboard locally, trigger `/api/sync-proven`.
2. Compare a handful of representative ads against Ads Manager using the
   same date range and attribution settings; confirm dates, product bars,
   statuses, and recommendations agree.
3. After deploy: confirm the scheduled sync succeeds and the live dashboard
   renders the new tab name, status selector, and counts.

**Acceptance criterion:** every ad resolves to exactly one explainable
seven-day status; Kill always overrides Demote; the dashboard clearly
recommends the £20/day Testing cap whenever Demote applies.
