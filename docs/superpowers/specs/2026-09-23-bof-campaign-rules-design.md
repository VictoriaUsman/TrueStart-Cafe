# BOF Campaign Rules + Tab Date Filter — Design

**Date:** 2026-09-23
**Status:** Approved, ready for implementation planning
**Supersedes:** `2026-09-12-proven-kill-demote-design.md` (the Proven/Demote/Testing
evaluator it specifies is removed wholesale by this design)

## 1. Context

The BOF campaign structure changed. The old `K-TS_UK_BOF-PROVEN` campaign is off,
so the Proven/Demote model shipped in the previous increment no longer describes
anything real. Four BOF campaigns replace it, each with its own rules:

- `K-TS_UK_BOF_StarterMugs_ABO`
- `K-BOF_PDP-CBO`
- `K-BOF_Cold-ABO`
- the Taster BOF campaign (exact name outstanding — see §8)

Two things change structurally, not just numerically:

1. **Rules key off the campaign, not the product.** The current evaluator picks a
   CPA bar by parsing Taster/Starter/PDP out of the ad *name*. The new rules are
   defined per campaign. The snapshot already stores `campaign` per ad, unused —
   this design starts using it, and demotes `product` to a display-only column.
2. **Purchase ROAS becomes an input.** Two of the new rules test it. It is not
   fetched, stored, or rendered anywhere today.

Plus a date filter on this tab only: Last 7 Days as the default, with a custom
range option. Explicitly scoped to the Creative performance tab — not the KPI
cards or any other tab.

Requester's framing: regular reviews stay on the rolling last 7 days; the custom
range exists to make it easy to check other periods. That asymmetry drives the
date-filter architecture in §6.

Scope statement, carried forward unchanged from the previous design: this is
dashboard indicators and recommendations only. Budget changes and pausing ads
remain manual human actions.

## 2. Statuses

Five mutually exclusive statuses replace Proven/Demote/Testing, evaluated in this
precedence order — **Unavailable, Kill, Recovery, Cold Eligible, Keep Running**:

| Status | Meaning | Recommended action |
|---|---|---|
| `UNAVAILABLE` | spend/purchases/revenue not finite, or negative | "Check performance data" |
| `KILL` | campaign's kill rules met | "Pause ad" |
| `RECOVERY` | campaign's recovery band, kill not triggered | "Review and reduce budget" (assumed — see §8, item 4) |
| `COLD_ELIGIBLE` | clears the bar to duplicate into `K-BOF_Cold-ABO` | "Eligible to duplicate into K-BOF_Cold-ABO" |
| `KEEP_RUNNING` | none of the above | "Keep running" |

`RECOVERY` and `COLD_ELIGIBLE` cannot collide — nothing is simultaneously above
£18/£22.50 and at or below £12 — so the ordering between them is a formality, not
a tiebreak. `KILL` over `RECOVERY` is a real tiebreak and is load-bearing: every
kill CPR threshold is also above its campaign's recovery threshold.

Each result carries a human-readable `reason`, as the current evaluator does, so
every ad has one explainable status.

## 3. Rules per campaign

All thresholds are **strictly greater-than** unless written `≥`. Cost per result
(CPR) is `spend / purchases` when `purchases > 0`, else `null` — never coerced to
£0 or Infinity. The zero-purchase kill is the explicit `spend ≥ £100` rule, not a
CPR comparison. Purchase ROAS is `revenue / spend` when `spend > 0`, else `null`.

### Starter Mugs — `K-TS_UK_BOF_StarterMugs_ABO`

- **Kill:** CPR > £30, **or** spend ≥ £100 with 0 purchases
- **Recovery:** CPR > £22.50
- **Cold Eligible:** spend ≥ £150 **and** purchases ≥ 15 **and** CPR ≤ £12 **and** ROAS ≥ 2.5
- Otherwise: Keep Running

### PDP — `K-BOF_PDP-CBO`

- **Kill:** CPR > £30, **or** spend ≥ £100 with 0 purchases
- **Recovery:** none — PDP has no recovery band
- **Cold Eligible:** same four conditions as Starter Mugs
- Otherwise: Keep Running

### Taster — *name outstanding*

- **Kill:** CPR > £24, **or** spend ≥ £100 with 0 purchases
- **Recovery:** CPR > £18
- **Cold Eligible:** never. Taster stays separate from the shared Cold campaign
  and its ads do not move into `K-BOF_Cold-ABO`.
- Otherwise: Keep Running

### Cold — `K-BOF_Cold-ABO`

- **Kill:** spend ≥ £100 with 0 purchases; **or** spend ≥ £150 with ROAS < 2;
  **or** spend ≥ £150 with CPR > £22.50
- **Recovery:** none
- **Cold Eligible:** not applicable — these ads are already in Cold
- Otherwise: Keep Running

The requester's earlier Scale (CPR ≤ £15 + ROAS ≥ 2.5) and Hold (CPR £15–£18 +
ROAS ≥ 2) bands for Cold are **deliberately not implemented**. His follow-up
replaced that section with kill-or-keep-running. This is recorded here because it
removes the dashboard's only signal for which Cold ads deserve *more* budget; it
is his call, and reversible.

### Campaigns not listed

- **Non-BOF ads** (TOF/MOF/Other, per `lib/transform/stage.js`'s `getFunnelStage`)
  are excluded from the table. These rules do not cover them, and inventing a
  status for them would be dishonest. A note above the table states how many ads
  were excluded, so nothing appears to have silently vanished.
- **A BOF campaign not in the map** falls back to the PDP ruleset (§8, item 3).

## 4. Metric definitions

| Field | Source | Notes |
|---|---|---|
| spend | Windsor `spend` | unchanged |
| purchases | Windsor `actions_omni_purchase` | unchanged |
| revenue | Windsor `action_values_omni_purchase` | **new** |
| CPR | derived: `spend / purchases` | `null` when purchases = 0 |
| ROAS | derived: `revenue / spend` | `null` when spend = 0 |

**Revenue is stored; ROAS is derived at render time.** This follows the existing
principle that the snapshot holds metrics and the evaluator derives everything
else, and it keeps ROAS consistent with the same spend figure CPR uses.

ROAS being `null` never reaches a rule: the only rules testing it require
spend ≥ £150, which implies spend > 0.

Cold's zero-purchase case is consistent across its two kill rules — 0 purchases
means revenue £0 means ROAS 0, which is < 2 — but the spend ≥ £100 rule fires
first and at a lower threshold, so it is what produces the kill and the reason
string.

**Attribution is an open reconciliation risk, not a code risk** (§8, item 6). If
the requester's Ads Manager view uses a different attribution window than
Windsor's omni-purchase figures, his "Cost per result" will not match the
dashboard's and will read as a bug. This is a settings question, answerable
without changing code.

## 5. Increment 1 — rules and ROAS

### Module renames

The concept "Proven" is deleted entirely, leaving three modules misnamed. Renamed
as part of this work (mechanical: `git mv` plus imports in three files):

- `lib/transform/proven.js` → `lib/transform/bof-rules.js`
- `lib/render/proven.js` → `lib/render/bof-rules.js`
- `lib/proven-snapshot.js` → `lib/bof-snapshot.js`

Two names are deliberately **not** changed, for the same reason in both cases —
the rename would cost a migration and buy nothing:

- The Google Sheet tab stays `Proven7Day`. Renaming it orphans the live data.
- The route `api/sync-proven.js` stays put. Its path is wired into `vercel.json`'s
  cron schedule, so renaming the file means editing the deployed cron config and
  briefly running two schedules or none.

Both are documented inconsistencies, each cheaper than its migration.

### Changes

- **`lib/transform/bof-rules.js`** — `evaluateProven` becomes `evaluateAd({
  campaign, spend, purchases, revenue })`, returning `{ status, reason, action,
  cpr, roas, ruleset }`. The campaign→ruleset map is a single exported constant at
  the top of the file so the outstanding names in §8 are a one-line edit.
  `buildProvenSnapshot` becomes `buildSnapshot` and additionally sums `revenue`.
  `sevenDayWindow` unchanged.
- **`api/sync-proven.js`** — add `action_values_omni_purchase` to the Windsor
  fields. No other change; the daily full-window refresh and the
  never-overwrite-good-data behaviour stay exactly as they are.
- **`lib/bof-snapshot.js`** — seventh column for revenue; read/write ranges widen
  `A:F` → `A:G`; `columnCount` 6 → 7. A snapshot missing the column reads as
  invalid and renders as unavailable rather than evaluating with revenue
  undefined.
- **`lib/render/bof-rules.js`** — new status colours and sort order; ROAS column
  added to the table; counts per status; the status `<select>` offers
  Kill / Recovery / Cold Eligible / Keep Running / All. Non-BOF ads filtered out
  with a count note. The table-rendering half is extracted into its own exported
  function so §6's endpoint renders through the same code path.
- **`api/dashboard.js`** — the top-row `✅ PROVEN` KPI card becomes a Kill count
  (red, `#C0392B`), captioned "Ads meeting kill rules · last 7 days".
- **`lib/transform/status.js`** — `isInProvenCampaign` and
  `PROVEN_PURCHASE_THRESHOLD` are dead once `creatives.js`'s `in_proven` field
  goes; both removed along with that field.

The legacy 30-day `Creatives` pipeline is otherwise untouched, as in the previous
design.

## 6. Increment 2 — date filter on this tab

**Hybrid, not per-day storage.** The default window is served from the existing
snapshot; only custom ranges hit Windsor live.

- **Last 7 Days (default)** — rendered server-side from the `Proven7Day`
  snapshot, exactly as today. Page load stays fast, and a Windsor outage still
  cannot blank the tab.
- **Custom range** — `GET /api/bof-range?from=YYYY-MM-DD&to=YYYY-MM-DD` fetches
  Windsor for that window, aggregates through `buildSnapshot`, evaluates, and
  returns `{ ok, html, counts, dateFrom, dateTo }`. The client swaps the table
  container's contents.

Rejected alternative: storing one row per ad per day and aggregating on demand.
It imposes a retention ceiling, a backfill problem, and row-volume growth, in
exchange for speed on a path the requester has said is occasional. Live fetch has
none of those and a worse latency profile only where latency does not matter.

### Endpoint validation

Rejected with a 400 and a message the tab displays:

- either parameter missing or not `YYYY-MM-DD`
- `from` after `to`
- range longer than **180 days**
- `to` not before today in the account timezone — partial days are never shown,
  matching the existing last-7-*completed*-days behaviour

### Window-dependent thresholds

**The rules are calibrated for seven days and the date filter breaks them.**
Spend ≥ £150, purchases ≥ 15, and spend ≥ £100 with 0 purchases all scale with
window length: over 90 days nearly every ad clears £150, so Kill and Cold
Eligible stop discriminating.

This design does **not** pro-rate the thresholds — that would be inventing rules
the requester did not write. Instead, whenever the active window is not the
7-day default, the tab renders a visible caption above the table stating that the
thresholds were set for a seven-day window and the statuses should be read
accordingly. Honest, and it cannot silently mislead someone checking last month.

### Client

In `lib/template.html`, inside the BOF tab only: a "Last 7 days" / "Custom range"
toggle, two date inputs and an Apply button. Loading and error states are
explicit — a failed fetch shows the error and leaves the 7-day view intact. The
existing `.db` 7/30/90 buttons belong to a chart elsewhere on the page and are
not touched.

## 7. Risks

- **Unauthenticated endpoint triggering a paid API.** `/api/bof-range` matches the
  dashboard's existing exposure — the dashboard itself is an unauthenticated
  Vercel rewrite — so this does not change the security posture, but it does add a
  cost lever anyone with the URL can pull. Mitigations in this design: the 180-day
  cap and a short-lived in-memory cache keyed by the range. If that is judged
  insufficient, a shared secret is a small follow-up.
- **Reconciliation against Ads Manager** depends on the attribution answer in §8.
- **Placeholder campaign name.** Until the Taster campaign name lands, Taster ads
  match no ruleset and fall to the PDP fallback — wrong thresholds (£30/none
  instead of £24/£18) and wrongly eligible for Cold. The placeholder constant is
  marked in-code, and this is called out at the top of the tab until it is filled.

## 8. Outstanding answers

Each lands in a named constant or string. None blocks starting the work.

| # | Question | Lands in |
|---|---|---|
| 1 | Exact Taster campaign name | `CAMPAIGN_RULESETS` key |
| 2 | Do `K-BOF_Cold-ABO` / `K-BOF_PDP-CBO` really lack the `K-TS_UK_` prefix? | `CAMPAIGN_RULESETS` keys |
| 3 | Fallback ruleset for an unlisted BOF campaign (assumed: PDP) | `FALLBACK_RULESET` |
| 4 | What Recovery instructs — budget cap, destination, or a flag | `RECOVERY` action string |
| 5 | Label for a healthy non-eligible ad (assumed: "Keep running") | `KEEP_RUNNING` label |
| 6 | Meta's own purchase ROAS, and which attribution window | none — settings check |

## 9. Testing

`node --test --test-isolation=none "test/**/*.test.js"`.

Boundary coverage per campaign, in GBP and purchase counts. Every threshold is
tested at the value, just under, and just over.

**Starter Mugs**

| Spend | Purchases | Revenue | CPR | Expected |
|---|---|---|---|---|
| 100 | 0 | 0 | — | Kill (zero-purchase) |
| 99.99 | 0 | 0 | — | Keep Running |
| 300.10 | 10 | — | 30.01 | Kill |
| 300 | 10 | — | 30.00 | Recovery (exactly at kill bar) |
| 225.10 | 10 | — | 22.51 | Recovery |
| 225 | 10 | — | 22.50 | Keep Running (exactly at recovery bar) |
| 150 | 15 | 375 | 10.00 | Cold Eligible (ROAS exactly 2.5) |
| 150 | 15 | 374 | 10.00 | Keep Running (ROAS 2.49) |
| 149.99 | 15 | 375 | 10.00 | Keep Running (spend just under) |
| 150 | 14 | 375 | 10.71 | Keep Running (purchases under 15) |
| 180.15 | 15 | 460 | 12.01 | Keep Running (CPR just over £12; ROAS 2.55 still clears) |
| 180 | 15 | 450 | 12.00 | Cold Eligible (CPR exactly £12) |

**PDP** — the Starter kill and Cold Eligible boundaries repeated, plus CPR £25
→ **Keep Running**, proving no recovery band exists.

**Taster** — CPR 24.01 → Kill; 24.00 → Recovery; 18.01 → Recovery; 18.00 → Keep
Running; and spend £150 / 15 purchases / CPR £10 / ROAS 3.0 → **Keep Running**,
proving Taster is never Cold Eligible.

**Cold**

| Spend | Purchases | Revenue | Expected |
|---|---|---|---|
| 100 | 0 | 0 | Kill (zero-purchase) |
| 150 | 10 | 298 | Kill (ROAS 1.99) |
| 150 | 10 | 300 | Keep Running (ROAS exactly 2.0) |
| 149.99 | 5 | 150 | Keep Running (ROAS 1.0 but spend under £150) |
| 225.10 | 10 | 600 | Kill (CPR 22.51) |
| 225 | 10 | 450 | Keep Running (CPR exactly 22.50, ROAS exactly 2.0) |

Plus: non-finite or negative metrics → Unavailable; a non-BOF campaign →
excluded from the table with the exclusion count correct; an unmapped BOF
campaign → PDP ruleset; existing "same name separate by ad ID, same ID summed"
coverage preserved; status counts; `data-status` filtering.

**Range endpoint:** missing parameter, malformed date, `from` after `to`, range
over 180 days, `to` on or after today → 400 with a displayable message; Windsor
failure → error response leaving the default view intact; happy path returns the
same markup the server-rendered path produces for an equivalent window.

**Manual verification before rollout:** trigger `/api/sync-proven`, then compare
a handful of ads per campaign against Ads Manager on the same dates and
attribution settings; confirm thresholds, statuses and recommendations agree.
Then exercise a custom range and confirm the seven-day-calibration caption
appears.

**Acceptance criterion:** every BOF ad resolves to exactly one explainable
status under its own campaign's rules; Kill always beats Recovery; non-BOF ads
are visibly excluded rather than silently dropped; and any window other than the
seven-day default is captioned as outside the thresholds' calibration.
