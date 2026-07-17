# Split Weight-0 Pin Refill — Implementation Plan

## Overview

`Split.recalculateSizes` ([Split.ts:1224](src/typescript/lib/layout/Split.ts#L1224)) carries **two inconsistent notions of "pinned"**. The container-resize delta block ([:1296-1316](src/typescript/lib/layout/Split.ts#L1296)) asks `effectiveResizeWeight` ([:379](src/typescript/lib/layout/Split.ts#L379)), which honours both the imperative `setPaneResizeWeight(pane, 0)` and the declarative `addComponent(pane, { weight: 0 })`. The pin-aware refill immediately after ([:1412-1457](src/typescript/lib/layout/Split.ts#L1412)) instead asks `isPinnedMain` ([:411](src/typescript/lib/layout/Split.ts#L411)), which tests `min === max` and **ignores resize weight entirely** — so a weight-0 pane that is not also `min === max` is classified *flexible* and gets rescaled by `stored * refill`.

The failure needs two layouts to surface. Shrinking the container far enough to drive the absorber below its `min` makes the delta block write the absorber un-clamped (`Math.max(0, stored + delta * (w/wSum))` — no min clamp), so on that pass `Σstored == available` and `refill == 1.0`. On the **next** layout the `clampMain` loop at [:1277-1282](src/typescript/lib/layout/Split.ts#L1277) lifts the absorber back to its `min`, making `Σstored > available`; the delta block is skipped (`available` unchanged) and the refill reconciles — rescaling the weight-0 pane along with everything else. **The drift then repeats on every subsequent layout**, not once: a verified run of the repro below reports the pinned pane at `100 → 100 → 82 → 71.5 → …`, converging on `available − absorberMin`.

The fix classifies panes into **three** tiers in the refill — `min == max` (hard pin), explicit resize weight `0` (soft pin), flexible — and rescales the weakest tier that can absorb. All work is inside `recalculateSizes`'s refill block plus one new private predicate. No public API changes.

---

## Architecture Decisions

### The refill needs a separate predicate — `isPinnedMain` is NOT widened

**Rejected: widening `isPinnedMain` to `lo === hi || effectiveResizeWeight(pane, 1) === 0`.** It is superficially attractive (`isPinnedMain` has only the refill's two call sites, so one predicate would serve one consumer), but it **conflates two pins of different strength** and is verifiably wrong. Measured on a Split with one `min == max` pane (40px) beside a weight-0 pane: naive widening makes *both* count as pinned, so `flexibleTotal` falls to 0, control drops to the `else if (pinnedTotal > 0)` uniform-fill branch, and the uniform fill scales the **hard** pin off its only legal extent — **40 → 113.14 on the very first layout**, then 39.56. The tiered design below holds it at exactly 40.

The two notions are genuinely different concepts and both are load-bearing:

- **`min == max`** — the pane has exactly *one legal extent*. Non-negotiable; nothing may scale it while any other mass exists.
- **explicit resize weight `0`** — the caller pinned the pane's px. Held *while the container is large enough*: `setPaneResizeWeight`'s documented contract ([Split.ts:335-337](src/typescript/lib/layout/Split.ts#L335)) says *"When the container shrinks below a pinned pane's size the pane cannot keep its full extent — geometry must fill the container — so pure pinning holds only while the container is large enough."*

So `isPinnedMain` keeps its current meaning and JSDoc **unchanged**, and a new sibling predicate `isResizePinnedMain` answers the second question. The refill's cascade must be able to tell them apart to degrade the soft pin before the hard one; a single merged predicate cannot express that ordering.

### The soft pin resolves through `effectiveResizeWeight` with a positive fallback

`isResizePinnedMain` is `this.effectiveResizeWeight(pane, WEIGHT_UNSET_PROBE) === 0`, with `WEIGHT_UNSET_PROBE = 1`. This **reuses the existing precedence resolver** rather than re-reading `_weights` and the `weight` constraint by hand, so the imperative-over-declarative precedence ([:365-380](src/typescript/lib/layout/Split.ts#L365)) stays single-sourced and the refill can never disagree with the delta block again — which is the whole bug.

`effectiveResizeWeight`'s fallback is load-bearing and easy to get fatally wrong. Its JSDoc deliberately reads the **raw** constraint (`undefined`, not the box managers' `?? 0`) so an unset pane falls through to the fallback. Passing a **positive** probe means an unset pane resolves to `1` and stays flexible; only an **explicit** `0` (from `setPaneResizeWeight` or the `weight` constraint) reports pinned. Passing `0` here would turn every unset pane into a pinned pane and destroy the proportional-rescale default. The probe's value is irrelevant beyond being positive — it is a "not zero" sentinel, not a weight.

### Rescale the weakest tier that can absorb — a three-way cascade

The refill picks a scale per tier from one `budget`:

```
budget = max(0, available − pinnedTotal)          // room left after the hard pins

flexibleTotal > 0 && budget >= weightPinnedTotal  → flexible absorbs; both pins held
weightPinnedTotal > 0                             → flexible → 0; soft pins yield proportionally
pinnedTotal > 0                                   → every pane hard-pinned: uniform fill
```

The `>=` in the first branch (rather than `>`) is what collapses what would otherwise be four branches into three: with `weightPinnedTotal === 0` it reduces to today's `Math.max(0, available − pinnedTotal) / flexibleTotal` **byte-for-byte**, including the `budget === 0` case where the flexible panes squeeze to 0. At `budget === weightPinnedTotal` both branch 1 and branch 2 yield scale `1` for the soft pins, so the boundary is continuous either way.

Branch 2 is what honours the `setPaneResizeWeight` yield contract quoted above **and** subsumes the existing all-weights-0 case: with no hard pins and no flexible mass, `weightPinnedScale = available / weightPinnedTotal` is exactly the uniform proportional rescale [Split.test.ts:227](tests/component/layout/Split.test.ts#L227) asserts.

### The all-pinned degenerate branch is unchanged and no longer newly reachable

Branch 3 (`pinnedTotal > 0`, `pinnedScale = available / pinnedTotal`) is today's *"the only sane outcome when nothing can flex"* fill, arithmetically identical (`Math.max(0, available − 0) === available`). Critically, this change **narrows** what reaches it: it is now reachable only when *every* pane is `min == max` — precisely its documented meaning. An all-weight-0 Split lands in branch 2 instead, whose formula is the same uniform rescale, so that case is byte-for-byte unchanged too. The comment at [:1293-1295](src/typescript/lib/layout/Split.ts#L1293) claiming *"`weightSum === 0` (every pane pinned) … lets the `Σ == available` refill below fill uniformly"* becomes literally true rather than accidentally true.

### REJECTED: min-clamping the absorber inside the delta block

The un-clamped write at [:1312](src/typescript/lib/layout/Split.ts#L1312) is arguably the deeper cause of `Σ ≠ available` a layout later, but clamping it is **rejected: it changes no outcome and carries real risk.**

Traced on the repro with the refill fixed, the two are indistinguishable. *With* a delta-block clamp the shrink pass writes the absorber at its min (200), `Σ = 300 > available = 246`, and the refill immediately scales it back to 146. *Without* it the delta writes 146 directly, `Σ = 246`, and the refill is a no-op at scale 1. Both land on `sidebar 100 / centre 146`, and both are idempotent from the next layout on. The clamp only makes the delta block's intermediate write self-consistent one pass earlier.

That is zero benefit against non-trivial blast radius: the `clampMain` loop at the top of `recalculateSizes` exists specifically to absorb **live min/max changes** (a case where `available` is unchanged, so the delta block never runs), and the comment trail at [:1271-1274](src/typescript/lib/layout/Split.ts#L1271) and [:1400-1411](src/typescript/lib/layout/Split.ts#L1400) records that the top-of-function clamp *enforces* and the refill *reconciles*. The un-clamped delta write is deliberate under that division of labour. Touching it would reorder a subtle invariant for no observable gain. **Do not clamp inside the delta block.**

### Over-constrained containers stay the component's problem

When pins plus mins exceed `available`, `Σ` genuinely cannot equal `available` while every min is honoured — the container is over-constrained and something must give. The framework already answers this: the manager assigns the space and the pane's own `clampWidth`/`clampHeight` backstop caps the display, per [ARCHITECTURE.md](ARCHITECTURE.md) *Size constraints* rule 7 and the existing comment at [:1426-1428](src/typescript/lib/layout/Split.ts#L1426). This plan does not change that; it only stops the *pinned* pane from being the one that silently drifts.

---

## Internal Structure

### New module constant, beside `GUTTER_SIZE` ([Split.ts:19](src/typescript/lib/layout/Split.ts#L19))

```typescript
// Probe weight for the refill's resize-pin test. Any positive value works: it
// exists only so a pane with *no* weight set resolves through
// `effectiveResizeWeight`'s fallback to a non-zero weight and stays flexible,
// which leaves `=== 0` meaning an explicit pin (`setPaneResizeWeight(pane, 0)`
// or a `weight: 0` constraint). A `0` probe here would pin every unset pane.
const WEIGHT_UNSET_PROBE = 1;
```

### New predicate, immediately after `isPinnedMain` ([Split.ts:418](src/typescript/lib/layout/Split.ts#L418))

```typescript
/**
 * True when the pane's px size is pinned by an explicit container-resize weight
 * of `0` — the pin the delta-distribution block honours, so the refill must not
 * undo it by rescaling the pane. Distinct from {@link isPinnedMain}: that is a
 * single-point `[min, max]` range (one legal extent, never rescaled), this is a
 * caller preference that yields when the container is too small to hold it.
 *
 * Resolves through the same precedence as the resize block (imperative weight,
 * else `weight` constraint, else fallback), probing with a positive fallback so
 * an unset pane reports flexible and only an explicit `0` reports pinned.
 *
 * @param pane - The pane to test.
 * @returns True when the pane's effective resize weight is an explicit `0`.
 */
private isResizePinnedMain(pane: Component): boolean {
    return this.effectiveResizeWeight(pane, WEIGHT_UNSET_PROBE) === 0;
}
```

### Replacement refill block — replaces [Split.ts:1412-1457](src/typescript/lib/layout/Split.ts#L1412) entirely

The `// After the steps above every live pane has a stored size…` comment at [:1400-1411](src/typescript/lib/layout/Split.ts#L1400) is retained, with its `— but hold panes pinned to a single point…` tail rewritten to describe the three tiers (see step 4).

```typescript
let pinnedTotal       = 0;
let weightPinnedTotal = 0;
let flexibleTotal     = 0;

for (let idx = 0; idx < components.length; idx += 1) {
    let component = components[idx];
    let stored = this._sizes.get(component) ?? 0;

    // A pane that is both single-point and weight-0 counts as single-point:
    // the stronger pin wins, so the cascade below never yields its one extent.
    if (this.isPinnedMain(component, horizontal)) {
        pinnedTotal += stored;
    } else if (this.isResizePinnedMain(component)) {
        weightPinnedTotal += stored;
    } else {
        flexibleTotal += stored;
    }
}

if (available > 0) {
    // Room left after the single-point pins, which never yield.
    let budget = Math.max(0, available - pinnedTotal);

    // Per-tier refill scale; `1` holds the tier at its stored size.
    let pinnedScale       = 1;
    let weightPinnedScale = 1;
    let flexibleScale     = 1;

    if (flexibleTotal > 0 && budget >= weightPinnedTotal) {
        // The budget covers the weight-0 pins: hold every pin and let the
        // flexible panes take the remainder. With no weight-0 pane this is the
        // original `max(0, available − Σpinned) / flexibleTotal`, byte-for-byte.
        flexibleScale = (budget - weightPinnedTotal) / flexibleTotal;
    } else if (weightPinnedTotal > 0) {
        // Either nothing flexible is left, or the weight-0 pins alone overrun
        // the budget. The flexible panes squeeze to 0 and the weight-0 pins
        // yield proportionally — a weight-0 pin holds only while the container
        // is large enough (`setPaneResizeWeight`). When there are no
        // single-point pins and nothing flexible, this is the uniform rescale
        // the all-weights-0 config has always produced.
        flexibleScale     = 0;
        weightPinnedScale = budget / weightPinnedTotal;
    } else if (pinnedTotal > 0) {
        // Every pane is single-point pinned: uniform fill — the only sane
        // outcome when nothing can flex.
        pinnedScale = available / pinnedTotal;
    }

    for (let idx = 0; idx < components.length; idx += 1) {
        let component = components[idx];
        let stored = this._sizes.get(component);

        if (stored == undefined) {
            continue;
        }

        let scale = this.isPinnedMain(component, horizontal)
            ? pinnedScale
            : (this.isResizePinnedMain(component) ? weightPinnedScale : flexibleScale);

        if (scale !== 1) {
            this._sizes.set(component, stored * scale);
        }
    }
}
```

---

## Ordered Implementation Steps

Work test-first: step 1 lands the failing regression test, steps 2-4 make it pass.

1. **Add the failing regression test** to the `describe('Split resize weights', …)` block in [tests/component/layout/Split.test.ts](tests/component/layout/Split.test.ts), after the `shrinking past a pinned pane…` test at [:246](tests/component/layout/Split.test.ts#L246). Use the *"weight-0 pane with a saturating absorber"* case from `## Expected Behaviour` #1. → verify: `npx vitest run tests/component/layout/Split.test.ts` — the new test **fails** with the pinned pane at ~71.5 instead of 100. Do not proceed until it fails for that reason.

2. **Add `WEIGHT_UNSET_PROBE`** to [src/typescript/lib/layout/Split.ts](src/typescript/lib/layout/Split.ts) directly below the `GUTTER_SIZE` constant ([:19](src/typescript/lib/layout/Split.ts#L19)), with the comment from `## Internal Structure` verbatim.

3. **Add `isResizePinnedMain`** immediately after `isPinnedMain` ([:418](src/typescript/lib/layout/Split.ts#L418)), with the JSDoc from `## Internal Structure`. **Leave `isPinnedMain` and its JSDoc untouched** — its `min == max` meaning is unchanged. → verify: `grep -n 'isPinnedMain' src/typescript/lib/layout/Split.ts` still shows the same body at `return lo === hi;`.

4. **Replace the refill block** at [:1412-1457](src/typescript/lib/layout/Split.ts#L1412) with the `## Internal Structure` version. Update only the tail of the preceding comment ([:1407-1411](src/typescript/lib/layout/Split.ts#L1407)) — from `— but hold panes pinned to a single point…` onward — to read:

   > `— but hold the pinned panes and rescale only what can absorb. Panes fall in three tiers: single-point (min == max) pins never move; weight-0 pins hold their px while the container has room for them, and yield proportionally when it does not; everything else flexes. With no pinned pane of either kind this is the original uniform refill, byte-for-byte.`

   Leave every other comment in `recalculateSizes` — the removal-pruning notes ([:1237-1258](src/typescript/lib/layout/Split.ts#L1237)), the `available` derivation ([:1260-1265](src/typescript/lib/layout/Split.ts#L1260)), the seed/clamp note ([:1271-1274](src/typescript/lib/layout/Split.ts#L1271)), the delta block ([:1284-1295](src/typescript/lib/layout/Split.ts#L1284)), the first-layout slack block ([:1318-1329](src/typescript/lib/layout/Split.ts#L1318)), and the `_lastAvailableMain` note ([:1459-1462](src/typescript/lib/layout/Split.ts#L1459)) — **exactly as they are**. They encode prior bug fixes. Do not reorder any block.

   → verify: the step-1 test now passes.

5. **Add the remaining `## Expected Behaviour` tests** (#2-#7) to [tests/component/layout/Split.test.ts](tests/component/layout/Split.test.ts), each in the `describe` block matching its subject.

6. **Confirm no delta-block change crept in:** `git diff src/typescript/lib/layout/Split.ts` must show **zero** changes between lines 1284 and 1357 (the delta block and the first-layout slack block). The rejected clamp lives there.

7. **Full suite:** `npm test` — 208 files / 2459 tests, all green.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/Split.ts` |
| Modify | `tests/component/layout/Split.test.ts` |

---

## Expected Behaviour

All cases are **unit-testable** offline via `installTestDOM` — no manual verification is required. Follow the existing idiom: `installTestDOM(CONFIG)` first, `afterEach(() => DOM.reset())`, and assert against *deltas* in host width rather than absolute px (gutters/insets are constant across a resize). `emptyHost(w, h)` ([Split.test.ts:42](tests/component/layout/Split.test.ts#L42)) builds a pane-less host for bespoke constraints.

1. **A weight-0 pane holds its px when the absorber saturates its min (the regression).** Host 400×300; `sidebar` preferred 100 wide with `setMinSize(40, 0)`; `centre` preferred 280 wide with `setMinSize(200, 0)`; added with `{ weight: 0 }` / `{ weight: 1 }`. After `doLayout()` the sidebar is 100. Shrink the host to 250 and run `doLayout()` **three times** — the drift only appears from the second layout on, and compounds. The sidebar must read 100 on every pass. *(Pre-fix: 100 → 82 → 71.5.)*

2. **The pin is stable across a full shrink/regrow cycle.** Host 1000×300; `side` preferred 240 with `setMinSize(48, 0)` added `{ weight: 0, collapsible: false }` (the sqladmin sidebar pattern); `body` preferred 756 with `setMinSize(400, 0)` added `{ weight: 1 }`. Drive the host through widths `800, 600, 500, 420, 600, 1000`, three `doLayout()` calls each. `side` must read exactly 240 at every width — including 420, where `body` (176) is below its 400 min and clips per the size-constraints contract.

3. **Grow with a saturating absorber.** The mirror of #1, but the absorber saturates on grow via its **max**, not its min. Host 400×300; `side` preferred 100 added `{ weight: 0 }`; `grow` preferred 200 with `maxSize: { width: 300, height: BIG }` added `{ weight: 1 }`. Grow the host to 600 and run `doLayout()` three times: `side` must read exactly 100 on every pass, and `grow` must take the whole +200. Assert only on `side` and on the delta — `grow`'s *stored* px legitimately exceeds its 300 max (the top-of-function `clampMain` caps it and the refill re-expands it each pass, and its own `clampWidth` caps the committed display per the size-constraints contract), so its stored value is not a meaningful assertion target.

4. **The all-pinned degenerate case is unchanged.** [Split.test.ts:227](tests/component/layout/Split.test.ts#L227) (`all weights 0 degrades to proportional rescale`) must pass **unmodified** — ratios stay 1/3 : 2/3 across a +90 grow.

5. **The unset-weight proportional-rescale default is unchanged.** [Split.test.ts:211](tests/component/layout/Split.test.ts#L211) (`no weights set preserves the proportional rescale`) must pass **unmodified**. Add a case pinning the interaction explicitly: a Split with one unset-weight pane beside one explicit weight-0 pane — the unset pane must absorb the delta and stay flexible (it must **not** be misread as pinned by the probe fallback). [Split.test.ts:191](tests/component/layout/Split.test.ts#L191) already covers the delta-block half of this; the new case must survive a *second* `doLayout()`.

6. **A hard `min == max` pin outranks a soft weight-0 pin.** Host 400×300; `hard` with `minSize`/`maxSize` both 40 wide, added `{ weight: 0 }`; `soft` preferred 100, added `{ weight: 0 }` — so there is **no flexible mass**. After `doLayout()`, then a shrink to 300 and two more `doLayout()` calls, `hard` must read exactly 40 and `soft` must absorb the whole change. *(This is the case naive widening breaks: it yields 113.14 then 39.56.)*

7. **Collapse is undisturbed.** [Split.test.ts:553](tests/component/layout/Split.test.ts#L553) (`a live min = max collapse holds the pin while a flexible neighbour absorbs`), [:572](tests/component/layout/Split.test.ts#L572), [:594](tests/component/layout/Split.test.ts#L594), [:275](tests/component/layout/Split.test.ts#L275) (`a resize preserves collapse state and the expanded panes still fill`), and the whole `describe('Split collapse state', …)` ([:613](tests/component/layout/Split.test.ts#L613)) and `describe('Split non-collapsible pane…', …)` ([:638](tests/component/layout/Split.test.ts#L638)) blocks must pass **unmodified**. The `_collapsed`-flag path runs through `computeMainAxisSizes`'s `factor` ([:1201-1214](src/typescript/lib/layout/Split.ts#L1201)) and is not touched.

8. **`shrinking past a pinned pane` keeps its contract.** [Split.test.ts:246](tests/component/layout/Split.test.ts#L246) must pass **unmodified**: a weight-0 pane still gives up its px when the container shrinks far below it (branch 2), and `a1 + b1` still tracks the net extent change exactly.

---

## Verification

- `npx vitest run tests/component/layout/Split.test.ts` — the new regression cases pass; **no existing test is edited to accommodate the change.** Any pre-existing Split test that needs its assertions relaxed means the design was misapplied — stop and re-read `## Architecture Decisions`.
- `npx vitest run tests/component/layout/` — 18 files / 200 tests, including `LayoutSerialization.test.ts`, `Accordion.resizable.test.ts`, and the `Tab` suites.
- `npm test` — full suite, 208 files / 2459 tests. This design was validated against the full suite with zero failures.
- `npx tsc --noEmit` — no **new** errors. (`scripts/import-fontawesome.ts` already reports pre-existing `@types/node` errors on master; ignore those.)
- `npx eslint src/typescript/lib/layout/Split.ts` — clean.
- `grep -n 'isPinnedMain' src/typescript/lib/layout/Split.ts` — expect the definition plus exactly **two** call sites, both inside the new refill block.
- No docs build needed: `isResizePinnedMain` and `WEIGHT_UNSET_PROBE` are private/module-local, and no public JSDoc changes.

---

## Potential Challenges

- **Getting the probe fallback backwards.** `effectiveResizeWeight(pane, 0)` would pin every unset pane and silently convert the proportional-rescale default into a uniform-fill degenerate. Mitigation: the constant is named `WEIGHT_UNSET_PROBE` and commented at its definition; Expected Behaviour #5 fails loudly if it is wrong.
- **Tempting to "simplify" the two predicates into one.** The tiering is the fix; merging them re-breaks it. Mitigation: Expected Behaviour #6 is the guard test.
- **Tempting to also clamp the delta block** while in the function. Mitigation: step 6's `git diff` check, and the rejection is recorded in `## Architecture Decisions`.
- **The `>=` vs `>` in branch 1** is what preserves byte-for-byte parity when `weightPinnedTotal === 0` and `budget === 0`. Mitigation: Expected Behaviour #8 covers that boundary.

---

## Critical Files

- [`src/typescript/lib/layout/Split.ts`](src/typescript/lib/layout/Split.ts) — `GUTTER_SIZE` (:19), `_weights` (:51-58), `setPaneResizeWeight` + its pin contract (:326-351), `effectiveResizeWeight` and its fallback JSDoc (:365-381), `clampMain` (:392), `isPinnedMain` (:401-418), `computeMainAxisSizes` collapse factor (:1201-1214), `recalculateSizes` (:1224) — read **every** comment in it before editing.
- [`tests/component/layout/Split.test.ts`](tests/component/layout/Split.test.ts) — the harness idiom (`CONFIG`, `hostSplit`, `emptyHost`, `DOM.reset()`), and the resize-weight (:92-382), seeding/min-max (:384-611), and collapse (:613+) blocks the change must keep green.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Size constraints: who is responsible for what*, rules 1/6/7 and the manager-vs-component clamp split, which is why the over-constrained case is left to `clampWidth`.
- [`plans/layout-state-api.md`](plans/layout-state-api.md) — inserts `applyPendingRatios()` into `doLayout` **after** `recalculateSizes()` and rewrites `getPaneRatios`/`applyPaneRatios`. It does not touch the refill block; there is no collision. Do not implement any of it here.

---

## Non-Goals

- **Min-clamping the absorber inside the delta block.** Rejected with reasons in `## Architecture Decisions`; it changes no outcome.
- **Fixing the over-constrained case** (pins + mins exceed `available`). The pane's own `clampWidth`/`clampHeight` backstop owns the display, per the size-constraints contract.
- **Persisting weight-0 panes as px instead of ratios.** That is the downstream motivation for this fix, planned in [`plans/layout-state-api.md`](plans/layout-state-api.md) and `sqladmin`'s `plans/layout-persistence.md`. Nothing here.
- **Any public API change.** No new option, setter, or event; the surface stays the existing preferred/weight/min/max.
- **Refactoring neighbouring blocks** in `recalculateSizes` — the equal-division fallback (:1359-1398), the seeding pass, and the pruning loops stay untouched.
