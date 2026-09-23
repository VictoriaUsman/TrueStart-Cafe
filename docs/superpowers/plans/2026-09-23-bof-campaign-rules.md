# BOF Campaign Rules + Tab Date Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Proven/Demote evaluator with per-campaign BOF rulesets driven by cost per result and Purchase ROAS, and add a Last 7 Days / custom range filter scoped to the BOF tab.

**Architecture:** A pure `evaluateAd` function maps a Meta campaign name to one of four rulesets and returns exactly one of five statuses. Revenue joins spend and purchases in the daily `Proven7Day` Sheet snapshot; ROAS and cost per result are derived at render time. The default 7-day view renders server-side from that snapshot as it does today; custom ranges hit a new `/api/bof-range` endpoint that fetches Windsor live and renders through the same table function.

**Tech Stack:** Node 18+, CommonJS, `node:test` + `node:assert/strict`, Vercel serverless functions, Google Sheets v4 REST, Windsor.ai connectors. No build step, no dependencies.

**Spec:** `docs/superpowers/specs/2026-09-23-bof-campaign-rules-design.md`

## Global Constraints

- **Node built-ins only.** This project has zero runtime dependencies and no build step. Do not add any.
- **CommonJS.** `require` / `module.exports`. `package.json` sets `"type": "commonjs"`.
- **All money thresholds are strictly greater-than unless the spec writes `≥`.** Boundary values are tested at, just under, and just over. Getting `>` vs `>=` wrong is the single most likely defect in this work.
- **Cost per result (CPR) is `spend / purchases` when `purchases > 0`, else `null`.** Never `0`, never `Infinity`. The zero-purchase kill is an explicit `spend >= 100` rule, not a CPR comparison.
- **Purchase ROAS is `revenue / spend` when `spend > 0`, else `null`.** Never `0` as a stand-in for unknown.
- **Every value interpolated into HTML goes through `escapeHtml`** from `lib/render/table.js`.
- **A failed or invalid fetch must never overwrite the last good snapshot.** Existing behaviour; preserve it.
- **Run the full suite before every commit:** `node --test --test-isolation=none "test/**/*.test.js"`
- **Status identifiers are exactly:** `KILL`, `RECOVERY`, `COLD_ELIGIBLE`, `KEEP_RUNNING`, `UNAVAILABLE`. Ruleset identifiers are exactly: `STARTER`, `PDP`, `TASTER`, `COLD`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/transform/bof-rules.js` | Campaign→ruleset map, `evaluateAd`, `buildSnapshot`, `sevenDayWindow` | renamed from `transform/proven.js`, rewritten |
| `lib/render/bof-rules.js` | `renderBofTable` (pure) and `bofView` (freshness gate) | renamed from `render/proven.js`, rewritten |
| `lib/bof-snapshot.js` | Sheet read/write of the snapshot | renamed from `proven-snapshot.js`, revenue column added |
| `api/sync-proven.js` | Daily cron: Windsor → snapshot → Sheet | revenue field added; **filename kept** (wired into `vercel.json` crons) |
| `api/bof-range.js` | On-demand custom-range endpoint | **new** |
| `api/dashboard.js` | Page assembly | KPI card + import updates |
| `lib/template.html` | Client markup and script | date filter controls |
| `lib/transform/status.js` | Creative bucketing | dead Proven exports removed |
| `lib/transform/creatives.js` | Legacy 30-day pipeline | `in_proven` field removed |

**Parallel-change strategy:** Task 2 adds `evaluateAd` *alongside* the existing `evaluateProven`. The render keeps calling the old function until Task 5 switches it over and deletes the old one. This keeps the full suite green at every commit.

---

### Task 1: Rename the Proven modules

Mechanical rename, zero behaviour change. The concept "Proven" is being deleted, so three modules are about to be misnamed. Doing this first means every later diff is pure signal.

**Files:**
- Rename: `lib/transform/proven.js` → `lib/transform/bof-rules.js`
- Rename: `lib/render/proven.js` → `lib/render/bof-rules.js`
- Rename: `lib/proven-snapshot.js` → `lib/bof-snapshot.js`
- Rename: `test/transform/proven.test.js` → `test/transform/bof-rules.test.js`
- Modify: `api/sync-proven.js`, `api/dashboard.js`

**Interfaces:**
- Consumes: nothing
- Produces: the three renamed module paths. Every later task imports from these.

**Not renamed, deliberately:** `api/sync-proven.js` (its path is wired into `vercel.json`'s cron schedule) and the Sheet tab `Proven7Day` (renaming orphans live data). Both are documented in spec §5.

- [ ] **Step 1: Rename the three lib modules and the test with git mv**

```bash
git mv lib/transform/proven.js lib/transform/bof-rules.js
git mv lib/render/proven.js lib/render/bof-rules.js
git mv lib/proven-snapshot.js lib/bof-snapshot.js
git mv test/transform/proven.test.js test/transform/bof-rules.test.js
```

- [ ] **Step 2: Update the import in `lib/render/bof-rules.js`**

Change line 2 from:

```js
const { evaluateProven, sevenDayWindow } = require('../transform/proven');
```

to:

```js
const { evaluateProven, sevenDayWindow } = require('../transform/bof-rules');
```

- [ ] **Step 3: Update the imports in `api/sync-proven.js`**

Change lines 2-3 from:

```js
const { sevenDayWindow, buildProvenSnapshot } = require('../lib/transform/proven');
const { writeProvenSnapshot } = require('../lib/proven-snapshot');
```

to:

```js
const { sevenDayWindow, buildProvenSnapshot } = require('../lib/transform/bof-rules');
const { writeProvenSnapshot } = require('../lib/bof-snapshot');
```

- [ ] **Step 4: Update the imports in `api/dashboard.js`**

Change lines 3-4 from:

```js
const { readProvenSnapshot } = require('../lib/proven-snapshot');
const { provenView } = require('../lib/render/proven');
```

to:

```js
const { readProvenSnapshot } = require('../lib/bof-snapshot');
const { provenView } = require('../lib/render/bof-rules');
```

- [ ] **Step 5: Update the imports in `test/transform/bof-rules.test.js`**

Change lines 3-4 from:

```js
const { sevenDayWindow, evaluateProven, buildProvenSnapshot, productForAd } = require('../../lib/transform/proven');
const { provenView } = require('../../lib/render/proven');
```

to:

```js
const { sevenDayWindow, evaluateProven, buildProvenSnapshot, productForAd } = require('../../lib/transform/bof-rules');
const { provenView } = require('../../lib/render/bof-rules');
```

- [ ] **Step 6: Confirm no stale references remain**

Run: `grep -rn "transform/proven\|render/proven\|proven-snapshot" lib api test`
Expected: no output. If anything matches, fix it before continuing.

- [ ] **Step 7: Run the full suite**

Run: `node --test --test-isolation=none "test/**/*.test.js"`
Expected: PASS, with exactly the same test count as before the rename. A rename that changes behaviour is a bug.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: rename Proven modules to bof-rules ahead of the campaign-keyed rewrite"
```

---

### Task 2: Campaign-keyed rulesets and `evaluateAd`

The core of the work. A pure function — no I/O, no rendering — so it is tested exhaustively at every boundary.

**Files:**
- Modify: `lib/transform/bof-rules.js`
- Test: `test/transform/bof-rules.test.js`

**Interfaces:**
- Consumes: `lib/transform/stage.js`'s `getFunnelStage(campaignName)` → `'TOF' | 'MOF' | 'BOF' | 'Other'`
- Produces:
  - `CAMPAIGN_RULESETS` — object, campaign-name prefix → ruleset key
  - `FALLBACK_RULESET` — string, `'PDP'`
  - `rulesetFor(campaign)` → ruleset key string
  - `evaluateAd({ campaign, spend, purchases, revenue })` → `{ ruleset, cpr, roas, status, reason, action }`

`evaluateProven` stays in place and untouched this task. Task 5 removes it.

**Why prefix matching:** live campaign names carry suffixes (`K-TS_UK_BOF_Sales Retargeting`, `K-TS_UK_TOF_Awareness CBO`), so exact-match lookup would drop every ad to the fallback. Matching is trimmed, lowercased, `startsWith`, longest key wins. No configured key is a prefix of another.

- [ ] **Step 1: Write the failing tests**

Append to `test/transform/bof-rules.test.js`:

```js
const { evaluateAd, rulesetFor } = require('../../lib/transform/bof-rules');

const ad = (over) => ({ campaign: 'K-TS_UK_BOF_StarterMugs_ABO', spend: 0, purchases: 0, revenue: 0, ...over });

test('campaign names are matched by prefix, so live suffixes still resolve', () => {
  assert.equal(rulesetFor('K-TS_UK_BOF_StarterMugs_ABO'), 'STARTER');
  assert.equal(rulesetFor('K-TS_UK_BOF_StarterMugs_ABO Retargeting'), 'STARTER');
  assert.equal(rulesetFor('  k-bof_cold-abo v2  '), 'COLD');
  assert.equal(rulesetFor('K-BOF_PDP-CBO'), 'PDP');
});

test('an unlisted BOF campaign falls back to the PDP ruleset', () => {
  assert.equal(rulesetFor('K-TS_UK_BOF_Something_New'), 'PDP');
  assert.equal(rulesetFor(''), 'PDP');
  assert.equal(rulesetFor(undefined), 'PDP');
});

test('Starter Mugs kill boundary is strictly above £30', () => {
  assert.equal(evaluateAd(ad({ spend: 300, purchases: 10 })).status, 'RECOVERY');
  assert.equal(evaluateAd(ad({ spend: 300.10, purchases: 10 })).status, 'KILL');
  assert.equal(evaluateAd(ad({ spend: 300.10, purchases: 10 })).action, 'Pause ad');
});

test('Starter Mugs recovery boundary is strictly above £22.50', () => {
  assert.equal(evaluateAd(ad({ spend: 225, purchases: 10 })).status, 'KEEP_RUNNING');
  assert.equal(evaluateAd(ad({ spend: 225.10, purchases: 10 })).status, 'RECOVERY');
});

test('Starter Mugs cold eligibility needs all four thresholds', () => {
  // spend 150, 15 purchases, CPR 10.00, ROAS exactly 2.5
  assert.equal(evaluateAd(ad({ spend: 150, purchases: 15, revenue: 375 })).status, 'COLD_ELIGIBLE');
  // ROAS 2.49 — just under
  assert.equal(evaluateAd(ad({ spend: 150, purchases: 15, revenue: 374 })).status, 'KEEP_RUNNING');
  // spend £149.99 — just under
  assert.equal(evaluateAd(ad({ spend: 149.99, purchases: 15, revenue: 375 })).status, 'KEEP_RUNNING');
  // 14 purchases — just under
  assert.equal(evaluateAd(ad({ spend: 150, purchases: 14, revenue: 375 })).status, 'KEEP_RUNNING');
  // CPR exactly £12.00 still qualifies
  assert.equal(evaluateAd(ad({ spend: 180, purchases: 15, revenue: 450 })).status, 'COLD_ELIGIBLE');
  // CPR £12.01 — just over; ROAS 2.55 still clears, so CPR is the only failure
  assert.equal(evaluateAd(ad({ spend: 180.15, purchases: 15, revenue: 460 })).status, 'KEEP_RUNNING');
});

test('PDP has no recovery band but the same kill and cold-eligible bars', () => {
  const pdp = (over) => ad({ campaign: 'K-BOF_PDP-CBO', ...over });
  assert.equal(evaluateAd(pdp({ spend: 250, purchases: 10 })).status, 'KEEP_RUNNING');
  assert.equal(evaluateAd(pdp({ spend: 300.10, purchases: 10 })).status, 'KILL');
  assert.equal(evaluateAd(pdp({ spend: 150, purchases: 15, revenue: 375 })).status, 'COLD_ELIGIBLE');
});

test('Taster kills above £24, recovers above £18, and is never cold eligible', () => {
  const taster = (over) => ad({ campaign: 'K-TS_UK_BOF_Taster_ABO', ...over });
  assert.equal(evaluateAd(taster({ spend: 240, purchases: 10 })).status, 'RECOVERY');
  assert.equal(evaluateAd(taster({ spend: 240.10, purchases: 10 })).status, 'KILL');
  assert.equal(evaluateAd(taster({ spend: 180, purchases: 10 })).status, 'KEEP_RUNNING');
  assert.equal(evaluateAd(taster({ spend: 180.10, purchases: 10 })).status, 'RECOVERY');
  // Would be cold eligible under Starter/PDP rules; Taster never is.
  assert.equal(evaluateAd(taster({ spend: 150, purchases: 15, revenue: 450 })).status, 'KEEP_RUNNING');
});

test('Cold kills on spend-gated ROAS and CPR, and never recovers or qualifies as cold eligible', () => {
  const cold = (over) => ad({ campaign: 'K-BOF_Cold-ABO', ...over });
  assert.equal(evaluateAd(cold({ spend: 150, purchases: 10, revenue: 298 })).status, 'KILL');   // ROAS 1.99
  assert.equal(evaluateAd(cold({ spend: 150, purchases: 10, revenue: 300 })).status, 'KEEP_RUNNING'); // ROAS exactly 2
  assert.equal(evaluateAd(cold({ spend: 149.99, purchases: 5, revenue: 150 })).status, 'KEEP_RUNNING'); // under the spend gate
  assert.equal(evaluateAd(cold({ spend: 225.10, purchases: 10, revenue: 600 })).status, 'KILL'); // CPR 22.51
  assert.equal(evaluateAd(cold({ spend: 225, purchases: 10, revenue: 450 })).status, 'KEEP_RUNNING'); // CPR exactly 22.50
  assert.equal(evaluateAd(cold({ spend: 500, purchases: 50, revenue: 5000 })).status, 'KEEP_RUNNING');
});

test('spend >= £100 with zero purchases kills in every ruleset, CPR stays null', () => {
  for (const campaign of ['K-TS_UK_BOF_StarterMugs_ABO', 'K-BOF_PDP-CBO', 'K-TS_UK_BOF_Taster_ABO', 'K-BOF_Cold-ABO']) {
    const r = evaluateAd(ad({ campaign, spend: 100, purchases: 0, revenue: 0 }));
    assert.equal(r.status, 'KILL');
    assert.equal(r.cpr, null);
    assert.equal(r.reason, 'Spend ≥ £100 with zero purchases');
  }
});

test('spend just under £100 with zero purchases keeps running', () => {
  const r = evaluateAd(ad({ spend: 99.99, purchases: 0, revenue: 0 }));
  assert.equal(r.status, 'KEEP_RUNNING');
  assert.equal(r.cpr, null);
});

test('invalid metrics are UNAVAILABLE and never coerced into another status', () => {
  for (const over of [
    { spend: NaN, purchases: 10, revenue: 100 },
    { spend: -5, purchases: 10, revenue: 100 },
    { spend: 100, purchases: NaN, revenue: 100 },
    { spend: 100, purchases: -1, revenue: 100 },
    { spend: 100, purchases: 10, revenue: NaN },
    { spend: 100, purchases: 10, revenue: -1 },
    { spend: undefined, purchases: undefined, revenue: undefined },
  ]) {
    const r = evaluateAd(ad(over));
    assert.equal(r.status, 'UNAVAILABLE');
    assert.equal(r.cpr, null);
    assert.equal(r.roas, null);
    assert.equal(r.action, 'Check performance data');
  }
});

test('every result carries a ruleset, a non-empty reason and an action', () => {
  const r = evaluateAd(ad({ spend: 150, purchases: 15, revenue: 375 }));
  assert.equal(r.ruleset, 'STARTER');
  assert.ok(r.reason.length > 0);
  assert.equal(r.action, 'Eligible to duplicate into K-BOF_Cold-ABO');
  assert.equal(r.cpr, 10);
  assert.equal(r.roas, 2.5);
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test test/transform/bof-rules.test.js`
Expected: FAIL — `evaluateAd is not a function`, `rulesetFor is not a function`.

- [ ] **Step 3: Implement the rulesets and `evaluateAd`**

In `lib/transform/bof-rules.js`, insert after the existing `require` line at the top:

```js
// Campaign-name prefix → ruleset. Live Meta campaign names carry suffixes
// ("K-TS_UK_BOF_Sales Retargeting"), so matching is by normalised prefix, not
// exact equality. No key here may be a prefix of another.
//
// OUTSTANDING (spec §8 item 1): the Taster campaign's exact name is unconfirmed.
// Until it is, Taster ads match nothing and fall to FALLBACK_RULESET, which
// scores them on PDP's bars (£30 kill, no recovery) instead of their own
// (£24 kill, £18 recovery) — and wrongly admits them to cold eligibility.
const CAMPAIGN_RULESETS = {
  'K-TS_UK_BOF_StarterMugs_ABO': 'STARTER',
  'K-BOF_PDP-CBO': 'PDP',
  'K-BOF_Cold-ABO': 'COLD',
  'K-TS_UK_BOF_Taster_ABO': 'TASTER', // PLACEHOLDER — confirm the real name
};

const FALLBACK_RULESET = 'PDP';

const RULESETS = {
  STARTER: { killCpr: 30, recoveryCpr: 22.50, coldEligible: true },
  PDP:     { killCpr: 30, recoveryCpr: null,  coldEligible: true },
  TASTER:  { killCpr: 24, recoveryCpr: 18,    coldEligible: false },
};

const ZERO_PURCHASE_KILL_SPEND = 100;
const COLD_KILL = { spend: 150, roas: 2, cpr: 22.50 };
const COLD_ELIGIBLE = { spend: 150, purchases: 15, cpr: 12, roas: 2.5 };

const ACTIONS = {
  UNAVAILABLE: 'Check performance data',
  KILL: 'Pause ad',
  RECOVERY: 'Review and reduce budget',
  COLD_ELIGIBLE: 'Eligible to duplicate into K-BOF_Cold-ABO',
  KEEP_RUNNING: 'Keep running',
};

// Longest matching prefix wins, so the result cannot depend on key order.
// An empty campaign name matches nothing (no configured key is an empty
// string) and falls through to the fallback.
function rulesetFor(campaign) {
  const name = String(campaign || '').trim().toLowerCase();
  let match = null;
  let matchedLength = -1;
  for (const [key, ruleset] of Object.entries(CAMPAIGN_RULESETS)) {
    const prefix = key.trim().toLowerCase();
    if (name.startsWith(prefix) && prefix.length > matchedLength) {
      match = ruleset;
      matchedLength = prefix.length;
    }
  }
  return match === null ? FALLBACK_RULESET : match;
}

function evaluateAd({ campaign, spend, purchases, revenue }) {
  const ruleset = rulesetFor(campaign);
  const valid = (v) => Number.isFinite(v) && v >= 0;

  if (!valid(spend) || !valid(purchases) || !valid(revenue)) {
    return {
      ruleset, cpr: null, roas: null, status: 'UNAVAILABLE',
      reason: 'Missing or invalid performance metrics', action: ACTIONS.UNAVAILABLE,
    };
  }

  const cpr = purchases > 0 ? spend / purchases : null;
  const roas = spend > 0 ? revenue / spend : null;
  const out = (status, reason) => ({ ruleset, cpr, roas, status, reason, action: ACTIONS[status] });

  // Applies to every ruleset, and fires before any CPR comparison — with zero
  // purchases CPR is null, so it could never produce this kill on its own.
  if (spend >= ZERO_PURCHASE_KILL_SPEND && purchases === 0) {
    return out('KILL', `Spend ≥ £${ZERO_PURCHASE_KILL_SPEND} with zero purchases`);
  }

  if (ruleset === 'COLD') {
    if (spend >= COLD_KILL.spend && roas !== null && roas < COLD_KILL.roas) {
      return out('KILL', `Spend ≥ £${COLD_KILL.spend} with purchase ROAS below ${COLD_KILL.roas}x`);
    }
    if (spend >= COLD_KILL.spend && cpr !== null && cpr > COLD_KILL.cpr) {
      return out('KILL', `Spend ≥ £${COLD_KILL.spend} with cost per result above £${COLD_KILL.cpr.toFixed(2)}`);
    }
    return out('KEEP_RUNNING', 'No kill rule met');
  }

  const rules = RULESETS[ruleset];

  if (cpr !== null && cpr > rules.killCpr) {
    return out('KILL', `Cost per result above £${rules.killCpr.toFixed(2)}`);
  }

  if (rules.recoveryCpr !== null && cpr !== null && cpr > rules.recoveryCpr) {
    return out('RECOVERY', `Cost per result above £${rules.recoveryCpr.toFixed(2)}`);
  }

  if (!rules.coldEligible) {
    return out('KEEP_RUNNING', 'No kill or recovery rule met');
  }

  if (
    spend >= COLD_ELIGIBLE.spend && purchases >= COLD_ELIGIBLE.purchases &&
    cpr !== null && cpr <= COLD_ELIGIBLE.cpr &&
    roas !== null && roas >= COLD_ELIGIBLE.roas
  ) {
    return out('COLD_ELIGIBLE', 'Clears all four cold-eligibility thresholds');
  }

  const missed = [];
  if (spend < COLD_ELIGIBLE.spend) missed.push(`spend below £${COLD_ELIGIBLE.spend}`);
  if (purchases < COLD_ELIGIBLE.purchases) missed.push(`fewer than ${COLD_ELIGIBLE.purchases} purchases`);
  if (cpr !== null && cpr > COLD_ELIGIBLE.cpr) missed.push(`cost per result above £${COLD_ELIGIBLE.cpr.toFixed(2)}`);
  if (roas !== null && roas < COLD_ELIGIBLE.roas) missed.push(`purchase ROAS below ${COLD_ELIGIBLE.roas}x`);
  return out('KEEP_RUNNING', `Not cold eligible: ${missed.join(' · ')}`);
}
```

Then extend the existing `module.exports` line at the bottom of the file to add the four new names alongside what is already exported:

```js
module.exports = {
  sevenDayWindow, evaluateProven, buildProvenSnapshot, productForAd,
  evaluateAd, rulesetFor, CAMPAIGN_RULESETS, FALLBACK_RULESET,
};
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `node --test test/transform/bof-rules.test.js`
Expected: PASS, including every pre-existing `evaluateProven` test, which this task did not touch.

- [ ] **Step 5: Run the full suite**

Run: `node --test --test-isolation=none "test/**/*.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/transform/bof-rules.js test/transform/bof-rules.test.js
git commit -m "feat: add campaign-keyed BOF rulesets and evaluateAd"
```

---

### Task 3: Carry Purchase revenue through the sync and snapshot builder

**Files:**
- Modify: `lib/transform/bof-rules.js` (`buildProvenSnapshot` → `buildSnapshot`)
- Modify: `api/sync-proven.js`
- Test: `test/transform/bof-rules.test.js`, `test/sync-windsor.test.js` (reference only — do not modify)

**Interfaces:**
- Consumes: `evaluateAd` from Task 2
- Produces: `buildSnapshot(rows, { dateFrom, dateTo, timeZone, now })` → `{ dateFrom, dateTo, timeZone, asOf, ads: [{ id, name, campaign, product, spend, purchases, revenue }] }`

`buildProvenSnapshot` is kept as an alias export this task so nothing breaks mid-flight; Task 5 removes it.

`revenue` comes from Windsor's `action_values_omni_purchase`. Like `actions_omni_purchase`, a null means zero, not invalid — an ad with spend and no sales legitimately reports null here.

- [ ] **Step 1: Write the failing tests**

Append to `test/transform/bof-rules.test.js`:

```js
const { buildSnapshot } = require('../../lib/transform/bof-rules');

test('revenue is summed per ad ID and a null revenue counts as zero', () => {
  const snapshot = buildSnapshot([
    { ad_id: '1', ad_name: 'Taster', campaign: 'K-BOF_Cold-ABO', spend: 50, actions_omni_purchase: 4, action_values_omni_purchase: 200 },
    { ad_id: '1', ad_name: 'Taster', campaign: 'K-BOF_Cold-ABO', spend: 50, actions_omni_purchase: 4, action_values_omni_purchase: 150 },
    { ad_id: '2', ad_name: 'Starter', campaign: 'K-BOF_Cold-ABO', spend: 30, actions_omni_purchase: 0, action_values_omni_purchase: null },
  ], options);
  assert.equal(snapshot.ads.length, 2);
  assert.equal(snapshot.ads[0].revenue, 350);
  assert.equal(snapshot.ads[1].revenue, 0);
});

test('a negative or non-numeric revenue is rejected rather than stored', () => {
  const row = { ad_id: '1', ad_name: 'Taster', campaign: 'K-BOF_Cold-ABO', spend: 50, actions_omni_purchase: 4 };
  assert.throws(() => buildSnapshot([{ ...row, action_values_omni_purchase: -1 }], options));
  assert.throws(() => buildSnapshot([{ ...row, action_values_omni_purchase: 'bad' }], options));
});

test('the campaign name is carried onto every ad so rules can key off it', () => {
  const snapshot = buildSnapshot([
    { ad_id: '1', ad_name: 'Taster', campaign: 'K-BOF_Cold-ABO v2', spend: 50, actions_omni_purchase: 4, action_values_omni_purchase: 200 },
  ], options);
  assert.equal(snapshot.ads[0].campaign, 'K-BOF_Cold-ABO v2');
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test test/transform/bof-rules.test.js`
Expected: FAIL — `buildSnapshot is not a function`.

- [ ] **Step 3: Add revenue to the snapshot builder**

In `lib/transform/bof-rules.js`, rename `buildProvenSnapshot` to `buildSnapshot` and add revenue handling. The full replacement function:

```js
function buildSnapshot(rows, { dateFrom, dateTo, timeZone, now = new Date() }) {
  if (!rows.length) throw new Error('Empty Meta response; previous snapshot retained');
  const ads = new Map();
  for (const row of rows) {
    if (!row.ad_id || !row.ad_name) throw new Error('Missing Meta ad ID or name');
    const spend = Number(row.spend);
    const purchases = row.actions_omni_purchase == null ? 0 : Number(row.actions_omni_purchase);
    // A null revenue is a legitimate zero — an ad can spend and sell nothing.
    // A non-numeric or negative value is not, and must not silently become 0.
    const revenue = row.action_values_omni_purchase == null ? 0 : Number(row.action_values_omni_purchase);
    if (
      !Number.isFinite(spend) || spend < 0 ||
      !Number.isFinite(purchases) || purchases < 0 ||
      !Number.isFinite(revenue) || revenue < 0
    ) throw new Error('Invalid Meta metrics');
    const id = String(row.ad_id);
    const ad = ads.get(id) || {
      id, name: row.ad_name, campaign: row.campaign || '',
      product: productForAd(row.ad_name), spend: 0, purchases: 0, revenue: 0,
    };
    if (ad.product !== productForAd(row.ad_name)) throw new Error('Conflicting products for Meta ad ID');
    ad.spend += spend;
    ad.purchases += purchases;
    ad.revenue += revenue;
    ads.set(id, ad);
  }
  return { dateFrom, dateTo, timeZone, asOf: now.toISOString(), ads: [...ads.values()] };
}
```

Update the exports line, keeping the old name as an alias so Task 4's code and the pre-existing tests keep working:

```js
module.exports = {
  sevenDayWindow, evaluateProven, productForAd,
  buildSnapshot, buildProvenSnapshot: buildSnapshot,
  evaluateAd, rulesetFor, CAMPAIGN_RULESETS, FALLBACK_RULESET,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/transform/bof-rules.test.js`
Expected: PASS. The pre-existing `buildProvenSnapshot` tests pass through the alias.

- [ ] **Step 5: Request the revenue field from Windsor**

In `api/sync-proven.js`, change the `fields` array from:

```js
    fields: ['ad_id', 'ad_name', 'campaign', 'spend', 'actions_omni_purchase'],
```

to:

```js
    fields: ['ad_id', 'ad_name', 'campaign', 'spend', 'actions_omni_purchase', 'action_values_omni_purchase'],
```

and change the import on line 2 to use the new builder name:

```js
const { sevenDayWindow, buildSnapshot } = require('../lib/transform/bof-rules');
```

then update its call site in `syncProven`:

```js
  const snapshot = buildSnapshot(rows, { ...window, timeZone, now });
```

- [ ] **Step 6: Run the full suite**

Run: `node --test --test-isolation=none "test/**/*.test.js"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/transform/bof-rules.js api/sync-proven.js test/transform/bof-rules.test.js
git commit -m "feat: carry Meta purchase revenue through the BOF snapshot builder"
```

---

### Task 4: Store revenue in the Sheet snapshot

**Files:**
- Modify: `lib/bof-snapshot.js`
- Test: `test/google-sheets-writer.test.js` (reference only — read it for the mocking pattern used in this repo)

**Interfaces:**
- Consumes: the `revenue` field on each ad from Task 3
- Produces: a 7-column `Proven7Day` tab — `id, name, campaign, product, spend, purchases, revenue`

**Deploy note for whoever ships this:** the live Sheet has six columns. Between deploying and the next 06:50 cron, reads return no revenue, the snapshot is rejected as invalid, and the tab renders its "unavailable" message. That is the designed behaviour, not a fault — but trigger `/api/sync-proven` manually after deploy so the gap is seconds rather than hours.

- [ ] **Step 1: Write the failing test**

Create `test/bof-snapshot.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { readProvenSnapshot } = require('../lib/bof-snapshot');

// lib/google-sheets-auth.js signs a real JWT with crypto.createSign before it
// fetches a token, so a dummy string key would throw on signing. Generate a
// throwaway key pair once and let the real signing path run; only the network
// call is faked. Same global.fetch swap + try/finally pattern as
// test/google-sheets-writer.test.js.
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const env = {
  GOOGLE_SHEET_ID: 'sheet123',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@example.com',
  GOOGLE_SERVICE_ACCOUNT_KEY: privateKey,
};

const INFO = JSON.stringify({
  dateFrom: '2026-09-15', dateTo: '2026-09-21',
  timeZone: 'Europe/London', asOf: '2026-09-22T06:50:00.000Z',
});

async function withFakeFetch(sheetBody, fn) {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 'tok' }) };
    }
    return { ok: true, json: async () => sheetBody };
  };
  try {
    return await fn(calls);
  } finally {
    global.fetch = real;
  }
}

test('a snapshot without the revenue column is rejected rather than read as zero revenue', async () => {
  await withFakeFetch(
    { values: [[INFO], ['1', 'Taster', 'K-BOF_Cold-ABO', 'Taster', 150, 15]] },
    async () => { await assert.rejects(() => readProvenSnapshot(env), /Invalid/); }
  );
});

test('the read range covers column G so revenue is fetched', async () => {
  await withFakeFetch(
    { values: [[INFO], ['1', 'Taster', 'K-BOF_Cold-ABO', 'Taster', 150, 15, 375]] },
    async (calls) => {
      const snapshot = await readProvenSnapshot(env);
      assert.equal(snapshot.ads[0].revenue, 375);
      assert.ok(calls.some((u) => u.includes('!A:G')), `expected an A:G range, got: ${calls.join(', ')}`);
    }
  );
});

test('a negative revenue is rejected', async () => {
  await withFakeFetch(
    { values: [[INFO], ['1', 'Taster', 'K-BOF_Cold-ABO', 'Taster', 150, 15, -1]] },
    async () => { await assert.rejects(() => readProvenSnapshot(env), /Invalid/); }
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/bof-snapshot.test.js`
Expected: FAIL — the A:F read returns six columns, so `revenue` is `undefined` and the range assertion does not match.

- [ ] **Step 3: Widen the write side**

In `lib/bof-snapshot.js`, inside `writeProvenSnapshot`, change the new-sheet column count from 6 to 7:

```js
    sheet = { sheetId, title: TAB, gridProperties: { rowCount: Math.max(1000, snapshot.ads.length + 1), columnCount: 7 } };
```

and add revenue to the row mapping:

```js
  const values = [[JSON.stringify(info)], ...ads.map((ad) => [ad.id, ad.name, ad.campaign, ad.product, ad.spend, ad.purchases, ad.revenue])];
```

- [ ] **Step 4: Widen the read side and validate revenue**

In `readProvenSnapshot`, change the range and the row mapping:

```js
  const { values } = await request(`/values/${TAB}!A:G?valueRenderOption=UNFORMATTED_VALUE`);
  if (!values?.[0]?.[0]) throw new Error('Proven snapshot not synced yet');
  const info = JSON.parse(values[0][0]);
  const ads = values.slice(1).map(([id, name, campaign, product, spend, purchases, revenue]) => ({ id, name, campaign, product, spend, purchases, revenue }));
  if (!ads.length || ads.some((ad) =>
    !ad.id || !ad.name ||
    !Number.isFinite(ad.spend) || ad.spend < 0 ||
    !Number.isFinite(ad.purchases) || ad.purchases < 0 ||
    !Number.isFinite(ad.revenue) || ad.revenue < 0
  )) throw new Error('Invalid Proven snapshot');
  return { ...info, ads };
```

A pre-revenue row yields `revenue === undefined`, which fails `Number.isFinite` and throws — which is what makes the tab show "unavailable" rather than evaluating every ad at ROAS 0 and killing the lot.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/bof-snapshot.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `node --test --test-isolation=none "test/**/*.test.js"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/bof-snapshot.js test/bof-snapshot.test.js
git commit -m "feat: store Meta purchase revenue in the BOF snapshot tab"
```

---

### Task 5: Render the new statuses

Switches the render from `evaluateProven` to `evaluateAd`, adds the ROAS column, excludes non-BOF ads, and splits the table markup into its own function so Task 8's endpoint can reuse it.

**Files:**
- Modify: `lib/render/bof-rules.js`
- Modify: `lib/transform/bof-rules.js` (delete `evaluateProven` and the `buildProvenSnapshot` alias)
- Test: `test/render/bof-rules.test.js` (new), `test/transform/bof-rules.test.js` (delete the obsolete `evaluateProven` tests)

**Interfaces:**
- Consumes: `evaluateAd`, `buildSnapshot`, `sevenDayWindow` from Tasks 2-3; `getFunnelStage` from `lib/transform/stage.js`; `escapeHtml` from `lib/render/table.js`
- Produces:
  - `renderBofTable({ ads, dateFrom, dateTo, timeZone, asOf, isDefaultWindow })` → `{ html, counts, excludedCount }` — pure, no freshness logic
  - `bofView(snapshot, now, timeZone)` → `{ counts, html }` — freshness gate then `renderBofTable`

`bofView` no longer returns `count`; Task 6 updates its only consumer.

- [ ] **Step 1: Write the failing tests**

Create `test/render/bof-rules.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSnapshot, sevenDayWindow } = require('../../lib/transform/bof-rules');
const { bofView, renderBofTable } = require('../../lib/render/bof-rules');

const now = new Date('2026-09-22T08:00:00Z');
const options = { ...sevenDayWindow(now), timeZone: 'Europe/London', now };
const row = (over) => ({ ad_id: '1', ad_name: 'Ad', campaign: 'K-TS_UK_BOF_StarterMugs_ABO', spend: 10, actions_omni_purchase: 1, action_values_omni_purchase: 30, ...over });

test('non-BOF ads are excluded from the table and counted in the note', () => {
  const snapshot = buildSnapshot([
    row({ ad_id: '1', campaign: 'K-TS_UK_BOF_StarterMugs_ABO' }),
    row({ ad_id: '2', campaign: 'K-TS_UK_TOF_Awareness CBO' }),
    row({ ad_id: '3', campaign: 'K-TS_UK_MOF_Consideration' }),
  ], options);
  const view = bofView(snapshot, now);
  assert.equal([...view.html.matchAll(/data-status="/g)].length, 1);
  assert.match(view.html, /2 ads outside the BOF campaigns/);
});

test('rows sort Kill first, then Recovery, Cold eligible, Keep running', () => {
  const snapshot = buildSnapshot([
    row({ ad_id: '1', spend: 50, actions_omni_purchase: 5, action_values_omni_purchase: 150 }),   // CPR 10 -> Keep running
    row({ ad_id: '2', spend: 400, actions_omni_purchase: 10, action_values_omni_purchase: 500 }), // CPR 40 -> Kill
    row({ ad_id: '3', spend: 250, actions_omni_purchase: 10, action_values_omni_purchase: 600 }), // CPR 25 -> Recovery
    row({ ad_id: '4', spend: 150, actions_omni_purchase: 15, action_values_omni_purchase: 375 }), // -> Cold eligible
  ], options);
  const view = bofView(snapshot, now);
  const order = [...view.html.matchAll(/data-status="([A-Z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['KILL', 'RECOVERY', 'COLD_ELIGIBLE', 'KEEP_RUNNING']);
  assert.equal(view.counts.KILL, 1);
  assert.equal(view.counts.RECOVERY, 1);
  assert.equal(view.counts.COLD_ELIGIBLE, 1);
  assert.equal(view.counts.KEEP_RUNNING, 1);
});

test('the table shows ROAS and a dash for an undefined cost per result', () => {
  const snapshot = buildSnapshot([row({ spend: 50, actions_omni_purchase: 0, action_values_omni_purchase: 0 })], options);
  const { html } = bofView(snapshot, now);
  assert.match(html, /<th>7d ROAS<\/th>/);
  assert.match(html, /<td>—<\/td>/);
});

test('the status filter offers every status and each row carries data-status', () => {
  const snapshot = buildSnapshot([row()], options);
  const { html } = bofView(snapshot, now);
  assert.match(html, /id="performance-status"/);
  assert.match(html, /<option value="KILL">Kill<\/option>/);
  assert.match(html, /<option value="COLD_ELIGIBLE">Cold eligible<\/option>/);
  assert.match(html, /<option value="KEEP_RUNNING">Keep running<\/option>/);
});

test('a non-default window is captioned as outside the thresholds calibration', () => {
  const snapshot = buildSnapshot([row()], options);
  const def = renderBofTable({ ...snapshot, isDefaultWindow: true });
  const custom = renderBofTable({ ...snapshot, isDefaultWindow: false });
  assert.doesNotMatch(def.html, /calibrated for a seven-day window/);
  assert.match(custom.html, /calibrated for a seven-day window/);
});

test('ad names are escaped', () => {
  const snapshot = buildSnapshot([row({ ad_name: '<script>x</script>' })], options);
  assert.doesNotMatch(bofView(snapshot, now).html, /<script>/);
});

test('a stale or missing snapshot renders as unavailable, not as zero ads', () => {
  const fresh = buildSnapshot([row()], options);
  const stale = { ...fresh, asOf: new Date(now.getTime() - 40 * 3600000).toISOString() };
  assert.equal(bofView(stale, now).counts, null);
  assert.match(bofView(stale, now).html, /unavailable/);
  assert.equal(bofView(null, now).counts, null);
  assert.equal(bofView(fresh, new Date('2026-09-23T08:00:00Z')).counts, null);
});
```

- [ ] **Step 2: Delete the obsolete `evaluateProven` tests**

In `test/transform/bof-rules.test.js`, delete these tests, which assert behaviour this task removes:

- `Proven at exactly £150/15 purchases/CPA==bar, for every product`
- `spend just under £150 is Testing, not Proven`
- `fewer than 15 purchases is Testing, not Proven`
- `CPA exactly 1.5x the bar is Testing, not Demote (strictly greater-than required)`
- `CPA just above 1.5x the bar is Demote`
- `CPA exactly 2x the bar is Demote, not Kill (strictly greater-than required)`
- `CPA just above 2x the bar is Kill`
- `spend >= £100 with zero purchases is Kill for any product, CPA stays null`
- `spend just under £100 with zero purchases is Testing, not Kill`
- `Starter demote/kill boundaries (bar £15, 1.5x=£22.50, 2x=£30)`
- `PDP / other demote/kill boundaries (bar £20, 1.5x=£30, 2x=£40)`
- `invalid or missing metrics are UNAVAILABLE, never coerced into another status`
- `Kill always wins over Demote when both conditions would independently apply`
- `status counts cover every status and sort Kill first, then Demote, Proven, Testing`
- `rendered table includes the status filter select and a data-status attribute per row`
- `a stale or missing snapshot renders as unavailable, not as zero qualifying ads`

Task 2 and this task's new file already cover every one of these behaviours under the new rules.

**Keep** these, which still hold and are not about Proven:

- `window uses account-local yesterday including month and DST boundaries`
- `product does not require a recognized persona`
- `invalid responses cannot replace last good data; names are escaped` — but update its `provenView` reference to `bofView` and its import
- `same names remain separate by ad ID; same ID totals are summed` — rewrite its assertions, which reference Proven counts, to assert only the aggregation (`snapshot.ads.length === 2`, `snapshot.ads[0].spend === 180`)

Also delete the now-unused `provenView` import from that file.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/render/bof-rules.test.js`
Expected: FAIL — `bofView is not a function`.

- [ ] **Step 4: Rewrite the renderer**

Replace the entire contents of `lib/render/bof-rules.js` with:

```js
const { escapeHtml } = require('./table');
const { evaluateAd, sevenDayWindow } = require('../transform/bof-rules');
const { getFunnelStage } = require('../transform/stage');

const STATUS_COLORS = {
  KILL: '#C0392B', RECOVERY: '#D97706', COLD_ELIGIBLE: '#1E8A4C',
  KEEP_RUNNING: '#6B7280', UNAVAILABLE: '#6B7280',
};
const STATUS_ORDER = { KILL: 0, RECOVERY: 1, COLD_ELIGIBLE: 2, KEEP_RUNNING: 3, UNAVAILABLE: 4 };
const STATUS_LABELS = {
  KILL: 'Kill', RECOVERY: 'Recovery', COLD_ELIGIBLE: 'Cold eligible',
  KEEP_RUNNING: 'Keep running', UNAVAILABLE: 'Unavailable',
};

const UNAVAILABLE_HTML = '<div class="note">Seven-day performance qualification unavailable until a successful refresh for the latest complete window.</div>';

function renderBofTable({ ads, dateFrom, dateTo, timeZone, asOf, isDefaultWindow = true }) {
  // These rules only describe BOF campaigns. Anything else is shown as a count
  // rather than given an invented status or silently dropped.
  const bof = ads.filter((ad) => getFunnelStage(ad.campaign) === 'BOF');
  const excludedCount = ads.length - bof.length;

  const evaluated = bof
    .map((ad) => ({ ...ad, ...evaluateAd(ad) }))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.spend - a.spend);

  const counts = Object.fromEntries(
    Object.keys(STATUS_ORDER).map((status) => [status, evaluated.filter((ad) => ad.status === status).length])
  );

  const money = (v) => `£${v.toFixed(2)}`;
  const dash = (v, fmt) => (v === null ? '—' : fmt(v));

  const calibration = isDefaultWindow
    ? ''
    : '<p class="note" style="color:#C98A00"><b>Heads up:</b> these thresholds were calibrated for a seven-day window. Over a longer range the spend and purchase gates are easier to clear, so read the statuses accordingly.</p>';

  const excluded = excludedCount > 0
    ? `<p class="note">${excludedCount} ads outside the BOF campaigns are not shown — these rules only cover BOF.</p>`
    : '';

  const options = ['ALL', 'KILL', 'RECOVERY', 'COLD_ELIGIBLE', 'KEEP_RUNNING']
    .map((v) => `<option value="${v}">${v === 'ALL' ? 'All' : STATUS_LABELS[v]}</option>`)
    .join('');

  const rows = evaluated.map((ad) => `<tr data-status="${ad.status}">` +
    `<td>${escapeHtml(ad.name)}<br><small>${escapeHtml(ad.id)}</small></td>` +
    `<td>${escapeHtml(ad.campaign)}</td>` +
    `<td>${money(ad.spend)}</td>` +
    `<td>${ad.purchases}</td>` +
    `<td>${dash(ad.cpr, money)}</td>` +
    `<td>${dash(ad.roas, (v) => `${v.toFixed(2)}x`)}</td>` +
    `<td><span class="pill" style="background:${STATUS_COLORS[ad.status]}">${escapeHtml(STATUS_LABELS[ad.status])}</span></td>` +
    `<td>${escapeHtml(ad.action)} <small>(recommendation)</small></td>` +
    `<td>${escapeHtml(ad.reason)}</td></tr>`).join('');

  const html = `<p class="note">${escapeHtml(dateFrom)} to ${escapeHtml(dateTo)} · ${escapeHtml(timeZone)} · Meta-attributed, ad level<br>Updated ${escapeHtml(asOf)}.</p>
    ${calibration}${excluded}
    <p><b>${counts.KILL} Kill</b> &middot; <b>${counts.RECOVERY} Recovery</b> &middot; <b>${counts.COLD_ELIGIBLE} Cold eligible</b> &middot; <b>${counts.KEEP_RUNNING} Keep running</b></p>
    <label>Status <select id="performance-status">${options}</select></label>
    <div class="card" style="overflow-x:auto"><table id="proven-table"><thead><tr><th>Ad / Meta ID</th><th>Campaign</th><th>7d spend</th><th>7d purchases</th><th>7d cost per result</th><th>7d ROAS</th><th>Status</th><th>Recommended action</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table></div>`;

  return { html, counts, excludedCount };
}

function bofView(snapshot, now = new Date(), timeZone = 'Europe/London') {
  const expected = sevenDayWindow(now, timeZone);
  const fresh = snapshot && snapshot.timeZone === timeZone &&
    snapshot.dateFrom === expected.dateFrom && snapshot.dateTo === expected.dateTo &&
    Number.isFinite(Date.parse(snapshot.asOf)) && Date.parse(snapshot.asOf) <= now.getTime() &&
    now.getTime() - Date.parse(snapshot.asOf) < 36 * 3600000;
  if (!fresh) return { counts: null, html: UNAVAILABLE_HTML };
  return renderBofTable({ ...snapshot, isDefaultWindow: true });
}

module.exports = { bofView, renderBofTable, STATUS_LABELS };
```

The table keeps `id="proven-table"`, because `lib/template.html`'s existing filter script selects on it. Task 9 revisits that script; changing the id here would break the filter in the interim.

- [ ] **Step 5: Delete the superseded transform exports**

In `lib/transform/bof-rules.js`, delete the whole `evaluateProven` function and drop it and the `buildProvenSnapshot` alias from the exports:

```js
module.exports = {
  sevenDayWindow, productForAd, buildSnapshot,
  evaluateAd, rulesetFor, CAMPAIGN_RULESETS, FALLBACK_RULESET,
};
```

`productForAd` stays — `buildSnapshot` still calls it, and `product` remains a display-only field on each ad even though no rule reads it.

- [ ] **Step 6: Run both test files to verify they pass**

Run: `node --test test/render/bof-rules.test.js test/transform/bof-rules.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `node --test --test-isolation=none "test/**/*.test.js"`
Expected: FAIL in `test/dashboard.test.js` — `api/dashboard.js` still imports `provenView`. Task 6 fixes it. Do not commit yet.

- [ ] **Step 8: Repoint `api/dashboard.js` so the tree is green**

Change line 4 and line 99:

```js
const { bofView } = require('../lib/render/bof-rules');
```

```js
  const proven = bofView(provenSnapshot, new Date(), env.META_ACCOUNT_TIMEZONE || 'Europe/London');
```

Line 164's `proven.count !== null` becomes `proven.counts !== null`, and the card body is rewritten properly in Task 6 — for now, make it compile by using `proven.counts === null ? '—' : String(proven.counts.KILL)` in place of `String(proven.count)` and leaving the caption text alone.

- [ ] **Step 9: Run the full suite**

Run: `node --test --test-isolation=none "test/**/*.test.js"`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/render/bof-rules.js lib/transform/bof-rules.js api/dashboard.js test/render/bof-rules.test.js test/transform/bof-rules.test.js
git commit -m "feat: render BOF ads by campaign ruleset with ROAS and non-BOF exclusion"
```

---

### Task 6: Replace the Proven KPI card with a Kill count

**Files:**
- Modify: `api/dashboard.js:160-170`
- Test: `test/dashboard.test.js`

**Interfaces:**
- Consumes: `bofView` → `{ counts, html }` from Task 5
- Produces: no new interface

- [ ] **Step 1: Write the failing test**

`test/dashboard.test.js` already defines `ENV` and `mockFetchAllOk()` at the top of the file. Reuse both. `ENV` deliberately carries no `GOOGLE_SHEET_ID`, so `readProvenSnapshot` throws, `api/dashboard.js` catches it, and `bofView(null)` returns `counts: null` — which exercises the card's unavailable branch. That is the branch worth pinning, because it is the one a Sheets outage produces.

Add to `test/dashboard.test.js`:

```js
test('the top KPI row shows a kill count, not a Proven count', async () => {
  const originalFetch = global.fetch;
  global.fetch = mockFetchAllOk();
  try {
    const html = await buildDashboardHtml(ENV);
    // The emoji anchors this: the injected DATA literal legitimately contains the
    // string "K-TS_UK_BOF-PROVEN" as a historical campaign name, so a bare
    // /PROVEN/ would match that and never fail.
    assert.doesNotMatch(html, /✅ PROVEN/);
    assert.match(html, /KILL · last 7 days/);
    assert.match(html, /7-day evaluation unavailable/);
  } finally {
    global.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/dashboard.test.js`
Expected: FAIL — the page still contains `✅ PROVEN`.

- [ ] **Step 3: Rewrite the card**

Replace the final KPI entry in `api/dashboard.js` (the `proven.count !== null ? {...}` block) with:

```js
        proven.counts !== null
          ? {
              icon: '🛑 KILL · last 7 days', big: String(proven.counts.KILL), bigColor: '#C0392B',
              cap: 'BOF ads meeting their campaign kill rules',
            }
          : { icon: '🛑 KILL · last 7 days', big: '—', cap: '7-day evaluation unavailable' },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/dashboard.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `node --test --test-isolation=none "test/**/*.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/dashboard.js test/dashboard.test.js
git commit -m "feat: swap the Proven KPI card for a BOF kill count"
```

---

### Task 7: Delete the dead Proven concepts

**Files:**
- Modify: `lib/transform/status.js`
- Modify: `lib/transform/creatives.js:47`
- Test: `test/transform/creatives.test.js:32`, `test/transform/status.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: nothing — pure deletion

`isInProvenCampaign` matches `/BOF-PROVEN/i`, a campaign that is now off. `PROVEN_PURCHASE_THRESHOLD` has no reader at all. Confirmed not referenced in `lib/template.html`'s client script, so removing `in_proven` from the injected `DATA` array is safe.

- [ ] **Step 1: Confirm nothing outside these files reads the field**

Run: `grep -rn "in_proven\|isInProvenCampaign\|PROVEN_PURCHASE_THRESHOLD" lib api test`
Expected: matches only in `lib/transform/status.js`, `lib/transform/creatives.js`, `test/transform/creatives.test.js` and possibly `test/transform/status.test.js`. If anything else matches — particularly `lib/template.html` — stop and reassess before deleting.

- [ ] **Step 2: Update the tests first**

In `test/transform/creatives.test.js`, delete the `in_proven: true,` line from the expected object at line 32. In `test/transform/status.test.js`, delete any test exercising `isInProvenCampaign` or `PROVEN_PURCHASE_THRESHOLD`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/transform/creatives.test.js`
Expected: FAIL — the produced object still carries `in_proven`, so the deep-equal assertion does not match.

- [ ] **Step 4: Delete the field and the exports**

In `lib/transform/creatives.js`, remove the import of `isInProvenCampaign` from line 3:

```js
const { getCreativeStatus } = require('./status');
```

and delete line 47 (`in_proven: isInProvenCampaign(agg.topCamp),`).

In `lib/transform/status.js`, delete the `isInProvenCampaign` function and the `PROVEN_PURCHASE_THRESHOLD` constant, leaving:

```js
// lib/transform/status.js
const { getFunnelStage } = require('./stage');

const MIN_MEANINGFUL_SPEND = 1; // GBP; below this a creative is treated as STARVED

function getCreativeStatus({ campaignName, spend }) {
  const stage = getFunnelStage(campaignName);
  if (stage === 'TOF' || stage === 'MOF') return 'Feeder';
  if (spend < MIN_MEANINGFUL_SPEND) return 'STARVED';
  // Historical totals cannot establish current seven-day qualification.
  // The BOF rules evaluate that independently by Meta ad ID.
  return 'TESTING';
}

module.exports = { getCreativeStatus };
```

Note `getCreativeStatus` no longer needs its `purchases` argument — it never read it. Update the call site in `creatives.js` to match:

```js
      status: getCreativeStatus({ campaignName: agg.topCamp, spend: agg.spend }),
```

- [ ] **Step 5: Run the full suite**

Run: `node --test --test-isolation=none "test/**/*.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/transform/status.js lib/transform/creatives.js test/transform/creatives.test.js test/transform/status.test.js
git commit -m "refactor: remove the dead Proven campaign flag and purchase threshold"
```

**Increment 1 is complete at this commit.** The dashboard evaluates every BOF ad under its own campaign's rules. Increment 2 follows.

---

### Task 8: Custom-range endpoint

**Files:**
- Create: `api/bof-range.js`
- Create: `test/bof-range.test.js`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `fetchWindsorData` from `lib/windsor.js`; `buildSnapshot` from `lib/transform/bof-rules.js`; `renderBofTable` from `lib/render/bof-rules.js`
- Produces: `bofRange(env, query, now)` → `{ ok: true, html, counts, dateFrom, dateTo }` or throws a `RangeRequestError` carrying `status: 400`

The Windsor account id `'732629205086'` is hardcoded in `api/sync-proven.js`; use the same literal here rather than introducing a config indirection for two call sites.

- [ ] **Step 1: Write the failing tests**

Create `test/bof-range.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bofRange } = require('../api/bof-range');

const env = { WINDSOR_API_KEY: 'k', META_ACCOUNT_TIMEZONE: 'Europe/London' };
const now = new Date('2026-09-22T08:00:00Z');

const rejects = (query, pattern) =>
  assert.rejects(() => bofRange(env, query, now), pattern);

test('both dates are required and must be ISO calendar dates', async () => {
  await rejects({}, /from and to are required/);
  await rejects({ from: '2026-09-01' }, /from and to are required/);
  await rejects({ from: '01/09/2026', to: '2026-09-07' }, /YYYY-MM-DD/);
  await rejects({ from: '2026-13-01', to: '2026-09-07' }, /YYYY-MM-DD/);
});

test('from must not be after to', async () => {
  await rejects({ from: '2026-09-07', to: '2026-09-01' }, /from is after to/);
});

test('the range is capped at 180 days', async () => {
  await rejects({ from: '2026-01-01', to: '2026-09-21' }, /180 days/);
});

test('to must be before today in the account timezone', async () => {
  await rejects({ from: '2026-09-15', to: '2026-09-22' }, /complete days/);
  await rejects({ from: '2026-09-15', to: '2026-09-23' }, /complete days/);
});

test('a valid range renders a table through the shared renderer', async () => {
  const real = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ data: [{
      account_id: '732629205086', ad_id: '1', ad_name: 'Ad',
      campaign: 'K-TS_UK_BOF_StarterMugs_ABO', spend: 400,
      actions_omni_purchase: 10, action_values_omni_purchase: 500,
    }] }),
  });
  try {
    const result = await bofRange(env, { from: '2026-09-01', to: '2026-09-21' }, now);
    assert.equal(result.ok, true);
    assert.equal(result.counts.KILL, 1);
    assert.match(result.html, /calibrated for a seven-day window/);
    assert.equal(result.dateFrom, '2026-09-01');
  } finally {
    global.fetch = real;
  }
});

test('a missing API key is refused before any fetch is attempted', async () => {
  await assert.rejects(() => bofRange({}, { from: '2026-09-01', to: '2026-09-07' }, now));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/bof-range.test.js`
Expected: FAIL — `Cannot find module '../api/bof-range'`.

- [ ] **Step 3: Implement the endpoint**

Create `api/bof-range.js`:

```js
const { fetchWindsorData } = require('../lib/windsor');
const { buildSnapshot } = require('../lib/transform/bof-rules');
const { renderBofTable } = require('../lib/render/bof-rules');

const ACCOUNT_ID = '732629205086';
const MAX_RANGE_DAYS = 180;
const DAY_MS = 86400000;

class RangeRequestError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// Rejects "2026-13-01" and "2026-02-30", which Date.parse would otherwise
// roll over into a valid but wrong date.
function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function todayIn(timeZone, now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type) => parts.find((p) => p.type === type).value;
  return new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
}

async function bofRange(env, query, now = new Date()) {
  if (!env.WINDSOR_API_KEY) throw new Error('Missing WINDSOR_API_KEY');
  const timeZone = env.META_ACCOUNT_TIMEZONE || 'Europe/London';

  const { from, to } = query || {};
  if (!from || !to) throw new RangeRequestError('Both from and to are required.');

  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) throw new RangeRequestError('Dates must be calendar dates in YYYY-MM-DD form.');
  if (start.getTime() > end.getTime()) throw new RangeRequestError('The start date from is after to.');

  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) throw new RangeRequestError(`Ranges are limited to ${MAX_RANGE_DAYS} days.`);

  if (end.getTime() >= todayIn(timeZone, now).getTime()) {
    throw new RangeRequestError('Only complete days can be shown, so the end date must be before today.');
  }

  const rows = await fetchWindsorData({
    apiKey: env.WINDSOR_API_KEY, connector: 'facebook', accountId: ACCOUNT_ID,
    dateFrom: from, dateTo: to,
    fields: ['ad_id', 'ad_name', 'campaign', 'spend', 'actions_omni_purchase', 'action_values_omni_purchase'],
  });

  const snapshot = buildSnapshot(rows, { dateFrom: from, dateTo: to, timeZone, now });
  const { html, counts } = renderBofTable({ ...snapshot, isDefaultWindow: false });
  return { ok: true, html, counts, dateFrom: from, dateTo: to };
}

module.exports = { bofRange, RangeRequestError };
module.exports.default = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    const result = await bofRange(process.env, {
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
    });
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(result);
  } catch (err) {
    const status = err.status === 400 ? 400 : 500;
    if (status === 500) console.error('[bof-range]', err.message);
    res.status(status).json({
      ok: false,
      error: status === 400 ? err.message : 'Could not load that date range. Please try again shortly.',
    });
  }
};
```

The `s-maxage=300` header is the abuse mitigation from spec §7 — repeated requests for the same range are served by Vercel's edge cache rather than re-hitting Windsor. This replaces the spec's "short-lived in-memory cache" wording deliberately: on serverless, in-memory state does not survive cold starts and is not shared between concurrent instances, so it would cache almost nothing. The edge cache does the same job and actually holds.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/bof-range.test.js`
Expected: PASS.

- [ ] **Step 5: Give the function room to finish**

In `vercel.json`, add an entry to the `functions` object so a wide range does not hit the default timeout:

```json
    "api/bof-range.js": { "maxDuration": 60 },
```

Do **not** add a cron entry — this endpoint is request-driven.

- [ ] **Step 6: Run the full suite**

Run: `node --test --test-isolation=none "test/**/*.test.js"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add api/bof-range.js test/bof-range.test.js vercel.json
git commit -m "feat: add a validated custom-range endpoint for the BOF tab"
```

---

### Task 9: Date filter controls on the BOF tab

**Files:**
- Modify: `lib/template.html:122-127` (the `#proven` panel), `lib/template.html:142-143` (the filter script)
- Test: `test/template.test.js`

**Interfaces:**
- Consumes: `GET /api/bof-range?from=&to=` → `{ ok, html, counts }` or `{ ok: false, error }` from Task 8
- Produces: no module interface — browser-side only

The existing `.db` 7/30/90 buttons at line 73 drive a chart elsewhere on the page. Do not touch them.

- [ ] **Step 1: Write the failing test**

`test/template.test.js` reads the raw template with `require('fs').readFileSync(require.resolve('../lib/template.html'), 'utf8')` — use that same idiom, not a hand-built path. Append:

```js
test('the BOF panel has a date range control wired to the range endpoint', () => {
  const original = require('fs').readFileSync(require.resolve('../lib/template.html'), 'utf8');
  assert.match(original, /id="bof-range-default"/);
  assert.match(original, /id="bof-range-custom"/);
  assert.match(original, /id="bof-range-from"/);
  assert.match(original, /id="bof-range-to"/);
  assert.match(original, /\/api\/bof-range\?from='\+encodeURIComponent/);
});

test('the injected BOF table lives in a container the range fetch can replace', () => {
  const original = require('fs').readFileSync(require.resolve('../lib/template.html'), 'utf8');
  assert.match(original, /id="bof-table-container"><!--INJECT:PROVEN_TAB--></);
});

test('a failed range fetch leaves the seven-day table in place', () => {
  const original = require('fs').readFileSync(require.resolve('../lib/template.html'), 'utf8');
  // The error branch must set status text only — it must never touch container.innerHTML.
  assert.match(original, /if\(!d\.ok\)\{status\.textContent=d\.error;return;\}/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/template.test.js`
Expected: FAIL — none of those ids exist.

- [ ] **Step 3: Wrap the injected table and add the controls**

In `lib/template.html` the `#proven` panel currently reads exactly this, at lines 122-125:

```html
 <section class="panel" id="proven">
  <h2>Creative performance · 7 days</h2>
  <!--INJECT:PROVEN_TAB-->
 </section>
```

Replace those four lines with:

```html
 <section class="panel" id="proven">
  <h2>Creative performance · 7 days</h2>
  <div class="dates">
    <button class="db active" id="bof-range-default">Last 7 days</button>
    <button class="db" id="bof-range-custom">Custom range</button>
  </div>
  <div id="bof-range-fields" hidden style="margin:0 0 12px">
    <label>From <input type="date" id="bof-range-from"></label>
    <label>To <input type="date" id="bof-range-to"></label>
    <button class="fbtn" id="bof-range-apply">Apply</button>
    <span id="bof-range-status" class="note"></span>
  </div>
  <div id="bof-table-container"><!--INJECT:PROVEN_TAB--></div>
 </section>
```

The `<div id="bof-table-container">` must stay on one line with the marker and no whitespace between them, because `test/template.test.js`'s drift guard and the Step 1 test both match that exact shape.

- [ ] **Step 4: Wire the controls**

In `lib/template.html`'s script block, replace the existing two-line status-filter handler (lines 142-143) with:

```js
var bofDefaultHtml=document.getElementById('bof-table-container').innerHTML;
function bofBindStatusFilter(){
  var sel=document.getElementById('performance-status');
  if(!sel)return;
  sel.addEventListener('change',function(){
    document.querySelectorAll('#proven-table tbody tr').forEach(function(row){
      row.hidden=sel.value!=='ALL'&&row.dataset.status!==sel.value;
    });
  });
}
bofBindStatusFilter();
(function(){
  var def=document.getElementById('bof-range-default');
  var cust=document.getElementById('bof-range-custom');
  var fields=document.getElementById('bof-range-fields');
  var apply=document.getElementById('bof-range-apply');
  var status=document.getElementById('bof-range-status');
  var container=document.getElementById('bof-table-container');
  if(!def||!cust||!fields||!apply||!container)return;
  function mode(isCustom){
    cust.classList.toggle('active',isCustom);
    def.classList.toggle('active',!isCustom);
    fields.hidden=!isCustom;
  }
  def.onclick=function(){
    mode(false);
    status.textContent='';
    container.innerHTML=bofDefaultHtml;
    bofBindStatusFilter();
  };
  cust.onclick=function(){mode(true);};
  apply.onclick=function(){
    var from=document.getElementById('bof-range-from').value;
    var to=document.getElementById('bof-range-to').value;
    if(!from||!to){status.textContent='Pick both a start and an end date.';return;}
    status.textContent='Loading…';
    apply.disabled=true;
    fetch('/api/bof-range?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to))
      .then(function(r){return r.json();})
      .then(function(d){
        // A failed range must never blank the seven-day view the reviewer relies on.
        if(!d.ok){status.textContent=d.error;return;}
        container.innerHTML=d.html;
        bofBindStatusFilter();
        status.textContent='';
      })
      .catch(function(){status.textContent='Could not load that date range. Please try again shortly.';})
      .finally(function(){apply.disabled=false;});
  };
})();
```

The status filter is rebound after every swap because the `<select>` is inside the replaced markup and the old listener dies with it.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/template.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `node --test --test-isolation=none "test/**/*.test.js"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/template.html test/template.test.js
git commit -m "feat: add a Last 7 days / custom range filter to the BOF tab"
```

---

## Manual verification before rollout

The automated suite cannot check that the numbers match Meta. After deploying:

1. Trigger `/api/sync-proven` manually — the Sheet needs its revenue column written before the tab renders anything (see Task 4's deploy note).
2. Open the dashboard. Confirm the BOF tab lists ads with campaigns, cost per result, ROAS and a status, and that the Kill count card at the top matches the table's Kill count.
3. Pick two or three ads per campaign and compare spend, purchases, cost per result and ROAS against Ads Manager for the same dates and attribution settings. Discrepancies here are the attribution question in spec §8 item 6, not necessarily a code fault.
4. Switch to a custom range, apply a two-week window, and confirm the seven-day-calibration caption appears and the table reloads.
5. Apply an invalid range (end date today) and confirm the error text appears without blanking the table.
6. Confirm the Taster campaign's ads are currently scored under PDP's bars — expected until spec §8 item 1 is answered, and the reason they must not be acted on yet.

## Outstanding answers to fill in afterwards

From spec §8. Each is a one-line edit once answered:

| # | Question | Lands in |
|---|---|---|
| 1 | Exact Taster campaign name | `CAMPAIGN_RULESETS` in `lib/transform/bof-rules.js` |
| 2 | Whether the Cold/PDP names really lack the `K-TS_UK_` prefix | same object |
| 3 | Fallback ruleset for an unlisted BOF campaign | `FALLBACK_RULESET` |
| 4 | What Recovery instructs | `ACTIONS.RECOVERY` |
| 5 | Label for a healthy non-eligible ad | `STATUS_LABELS.KEEP_RUNNING` in `lib/render/bof-rules.js` |
| 6 | Which attribution window Ads Manager uses | no code — settings check |
