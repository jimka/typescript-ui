---
depends-on: [unchanged-commit-opt-ins]
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/layout/LayoutManager.ts
  - packages/lib/docs/concepts/layout-system.md
  - packages/lib/docs/reference/changelog/next.md
---

# Layout Size-Read Economy — Implementation Plan

## Overview

This plan ships wave 3's candidates G05 `resolve-bounds-lazy-size-reads` and G11 `box-layout-per-pass-gather` as one change to the layout-manager path. W3.0, the bounding sweep wave 3 is planned from, bounded both with runtime ablations ([`96-w3-0-bounding-sweep.md`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#L205)): `g05.lazy-reads` cut size-hint memo misses 5–9% and form passes 0.29–0.45 ms, and `g11.gather-residue` removed 96–100% of its gather residue. Three trims ship:

1. [`LayoutManager.resolveBounds`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L406) reads a child's size hints only when the fill uses them. A child that fills both axes is placed without any read.
2. [`LayoutManager.reserveContentFrame`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L316) returns before walking the children on a host that scrolls on neither axis.
3. [`Component.getLaidOutComponents`](packages/lib/src/typescript/lib/core/Component.ts#L7570) re-serves the array it last built while the displayed children are unchanged, instead of filtering a new one on every call.

Trim 1 removes a read that the unchanged-commit skip depends on for correctness. Once [`unchanged-commit-opt-ins`](plans/unchanged-commit-opt-ins.md) opts in a plain `Panel`, the parent's preferred-size read in `resolveBounds` is often the only read that re-measures that panel's text after a theme switch or web-font load. Without it, the panel skips its pass and its text keeps its old size. So the plan also adds one condition to the skip gate [`Component.canSkipUnchangedCommit`](packages/lib/src/typescript/lib/core/Component.ts#L4397): a component last laid out against other text metrics may not skip.

This plan lands after the opt-ins, and its savings are measured against that tree. There, they are work only: size-hint misses fall 0–19% per cell, size-hint calls 0–32%, and the laid-out lists built per unit fall by 99%. Frame time is expected flat. Line numbers are as of `11ad15eb`, before the opt-ins land and shift `core/Component.ts`; symbol names are authoritative.

---

## Architecture Decisions

### Three trims and one gate condition, all in the managers' shared path

The change stays in the shared path every manager already goes through: `LayoutManager`'s two helpers and `Component`'s laid-out list. No manager changes its own code. This mirrors [`size-hint-per-pass-memo`](plans/implemented/size-hint-per-pass-memo.md), which cached inside the getters so that no caller changed shape.[^absorbed]

### A child that fills both axes is placed without reading its size hints

In `resolveBounds`, the preferred, minimum and maximum size reads move inside the branch that uses them, the one for a fill other than `BOTH`. `getSize()` is read only when `getPreferredSize()` returns `null`. The `BOTH` branch already discarded all four values, so every result is unchanged.[^g05-reads]

| Child's constraint `fill` | `fill` argument | Hints read | Result: preferred 40×20 in cell (10, 20, 100, 50), anchor unset |
|---|---|---|---|
| unset | `BOTH` | none | `{ x: 10, y: 20, width: 100, height: 50 }` |
| `BOTH` | `NONE` | none | `{ x: 10, y: 20, width: 100, height: 50 }` |
| `NONE` | `BOTH` | preferred, max, min | `{ x: 40, y: 35, width: 40, height: 20 }` |
| unset | `HORIZONTAL` | preferred, max, min | `{ x: 10, y: 35, width: 100, height: 20 }` |
| unset | `VERTICAL` | preferred, max, min | `{ x: 40, y: 20, width: 40, height: 50 }` |

The child's own constraint wins over the argument, as today.

### The skip gate refuses a skip across a text-metrics change

`canSkipUnchangedCommit()` also requires that the component was last laid out at the current `Util.textMetricsGeneration()`. `Component.doLayout()` records that number in a new field, `_layoutMetricsGeneration`, where it already clears `_layoutDirty`. The generation moves only in [`ThemeManager.reflowText`](packages/lib/src/typescript/lib/core/Theme.ts#L1495), on every theme switch and every settled font batch. So the first pass after such a change lays out every opted-in component once, and nothing changes on any other pass.

This follows [`Text.needsMeasure`](packages/lib/src/typescript/lib/component/input/Text.ts#L557), which compares its stored generation with the live one instead of holding a theme subscription. It also follows `Table`'s [`Header`](packages/lib/src/typescript/lib/component/table/Header.ts#L372), whose theme subscription already marks every cell owed, so that `Cell`, a class that already opts in, never skips across a theme change.[^pull]

The cost is on theme switches. A switch that moves no text size now lays out the opted-in classes, which the opt-ins alone let skip. Offline, a `shell-deep` switch at n=4 goes from 224 layouts to 296, which is the count before the opt-ins.[^theme-cost]

### `getLaidOutComponents` re-serves its last array while it still matches

`Component` keeps the array `getLaidOutComponents()` last returned, in `_laidOutComponents`. On each call it walks the children once. It re-serves the kept array when that array still lists exactly the displayed children, in the same order. Otherwise it filters a new array, keeps it, and returns it. A kept array is never edited, only replaced, so an array a caller already holds keeps its contents. `removeComponent`, `removeAllComponents` and the destructor drop the kept array, so it never keeps a removed child alive.[^laid-out-compare]

| Between two calls | Second call returns | Same array object? |
|---|---|---|
| nothing | `[a, b, c]` | yes |
| `b.setDisplayed(false)` | `[a, c]` | no; the first array still holds `[a, b, c]` |
| `sortComponents` reverses the children | `[c, b, a]` | no |
| a caller pushed `x` into the first array | `[a, b, c]` | no; the walk sees the mismatch and rebuilds |

The returned array can now reach several callers, so none may modify it. The method's documentation says so in the words the size-hint getters use. The return type stays `Component[]`, as the size-hint getters kept `Size`.[^shared-type]

### `reserveContentFrame` returns before the child walk on a host that scrolls on neither axis

When neither `isOverflowingX()` nor `isOverflowingY()` is set, `reserveContentFrame` calls `container.clearContentFrame()` and returns. Today it walks every child, reading their geometry, and then reaches the same `clearContentFrame()` in its `else` branch. A scroll-enabled host takes the unchanged path.

### `Grid`'s track-less measure skip is not shipped

The ablation also returned zeros from `Grid.measureContent` for a grid with no tracks and no baseline alignment. In the measured cells only `chart-dashboard` reaches that case, and it saves no memo miss there: 8 memo hits per pass, which wave 2 measured as free. It is left out.[^grid]

### What the fix keeps from the ablations, and where it differs

| Part | Ablation | Shipped fix | Why it differs |
|---|---|---|---|
| Both-axes fill | [`g05LazyReads`](packages/qa/src/harness/ablations.ts#L813) returns the cell before calling `resolveBounds` | the same result, from inside `resolveBounds`; `getSize()` is also lazy | none |
| Text-metrics gate | — | new | the ablation ran on a tree with no skipping `Panel`, so no text depended on the read it removed |
| Laid-out list | [`g11GatherResidue`](packages/qa/src/harness/ablations.ts#L981) returns the live child list when every child is displayed | returns its own last array, checked on every call, dropped on removal | the live list changes under a holder[^live-list] |
| Content frame | early return on a host that scrolls on neither axis | the same | none |
| `Grid` measure | zeros for a track-less grid | not shipped | saves no miss |
| Engagement | `skipped.` and `memo.` counters | no counters | the fix is read by counters that fall[^counters] |

The fix holds one array and one number per component. It needs no invalidation hook, because the laid-out array is checked by comparison and the gate by the generation number.

### This plan lands after `unchanged-commit-opt-ins`

The opt-ins are the larger change (2–6 ms per settled pass) and are gated independently. This plan's gate condition then covers a theme-change gap the opt-ins leave, and its expected readings are measured against their tree. `depends-on` records the order, and `touches-shared` names the two source files both plans edit.[^order]

---

## Public API

No signature changes. Three documented behaviours change:

```ts
class Component {
    /** Unchanged signature. May return the same array as an earlier call; callers must not modify it. */
    getLaidOutComponents(): Component[];

    /** @internal Unchanged signature. Also false when the component was last laid out at another text-metrics generation. */
    public canSkipUnchangedCommit(): boolean;
}

abstract class LayoutManager {
    /** Unchanged signature. Reads no size hint for a child that fills both axes. */
    protected resolveBounds(component: Component, x: number, y: number, maxWidth: number, maxHeight: number,
                            fill?: FillType | null, anchor?: AnchorType | null): { x: number; y: number; width: number; height: number };
}
```

New private state on `Component`, both framework bookkeeping, so neither goes on `ComponentOptions`:

| Field | Written by | Read by |
|---|---|---|
| `_laidOutComponents: Component[] \| null` | `getLaidOutComponents` (set); `removeComponent`, `removeAllComponents`, destructor (reset to `null`) | `getLaidOutComponents` |
| `declare private _layoutMetricsGeneration: number \| undefined` | `doLayout`, beside `_layoutDirty = false` | `canSkipUnchangedCommit` |

One new private method, `Component.laidOutStillMatches(cached: Component[]): boolean`.

---

## Internal Structure

**`resolveBounds`** ([`layout/LayoutManager.ts:406`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L406)). Only the head changes. The four reads leave the top of the method, and the `fill` and `anchor` resolution lines stay as they are:

```ts
const layoutConstraints = this.getLayoutConstraints(component);
let width: number;
let height: number;

fill = /* unchanged */;
anchor = /* unchanged, with its `??` comment */;

if (fill == FillType.BOTH) {
    width = maxWidth;
    height = maxHeight;
} else {
    // Read only here: a child that fills both axes takes the cell as given.
    const preferredSize = component.getPreferredSize();
    const size = preferredSize ? null : component.getSize();
    const maxSize = component.getMaxSize();
    const minSize = component.getMinSize();

    // ... the existing HORIZONTAL / width and VERTICAL / height code, unchanged ...
}

// ... the existing anchor displacement, unchanged ...
```

**`reserveContentFrame`** ([`:316`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L316)):

```ts
const container = this.getContainer();
if (!container) {
    return this;
}

// Only a host that scrolls on some axis keeps a frame. Every other host
// clears one, so walking its children would be wasted.
if (!this.isOverflowingX() && !this.isOverflowingY()) {
    container.clearContentFrame();

    return this;
}

// ... inner / components / empty check, and the far-edge walk, unchanged ...

// The existing persistent-frame comment stays, minus its last sentence about
// non-scroll hosts, which the early return above now carries.
container.setContentFrame(farRight + insets.getRight(), farBottom + insets.getBottom());

return this;
```

**`getLaidOutComponents`** ([`core/Component.ts:7570`](packages/lib/src/typescript/lib/core/Component.ts#L7570)), and the helper directly after it:

```ts
getLaidOutComponents(): Component[] {
    const cached = this._laidOutComponents;

    if (cached !== null && this.laidOutStillMatches(cached)) {
        return cached;
    }

    const laidOut = this._components.filter(component => component.isDisplayed());

    this._laidOutComponents = laidOut;

    return laidOut;
}

private laidOutStillMatches(cached: Component[]): boolean {
    let index = 0;

    for (const component of this._components) {
        if (!component.isDisplayed()) {
            continue;
        }

        if (cached[index] !== component) {
            return false;
        }

        index += 1;
    }

    return index === cached.length;
}
```

The field goes directly after `private _components: Array<Component>;` ([`:543`](packages/lib/src/typescript/lib/core/Component.ts#L543)):

```ts
// The array `getLaidOutComponents` last returned: re-served while it still
// lists exactly the displayed children in order, replaced (never edited)
// when it does not, and dropped when a child leaves so it keeps none alive.
private _laidOutComponents: Component[] | null = null;
```

**The gate.** The field goes directly after `declare private _layoutDirty` ([`:600`](packages/lib/src/typescript/lib/core/Component.ts#L600)), with a comment in the same shape as `_layoutDirty`'s:

```ts
/**
 * The `Util.textMetricsGeneration()` the last layout pass with an element ran
 * against. Declared bare, like `_layoutDirty`; `undefined` until that pass.
 */
declare private _layoutMetricsGeneration: number | undefined;
```

In `doLayout` ([`:7773`](packages/lib/src/typescript/lib/core/Component.ts#L7773)):

```ts
if (this.getElement()) {
    this._layoutDirty = false;
    // A theme or font change moves measured text without moving any
    // rectangle; the skip gate compares against this.
    this._layoutMetricsGeneration = Util.textMetricsGeneration();
}
```

In `canSkipUnchangedCommit` ([`:4397`](packages/lib/src/typescript/lib/core/Component.ts#L4397)):

```ts
return this.canSkipUnchangedLayout()
    && !this.isLayoutDirty()
    && this._firstLayoutCallbacks === null
    && this._layoutMetricsGeneration === Util.textMetricsGeneration()
    && !!this.getElement();
```

---

## Ordered Implementation Steps

Work test-first. The gate lands before `resolveBounds` changes, so no intermediate state leaves text under a skipping component at its old size after a font swap.

1. **Write the tests** for E1–E6 in *Expected Behaviour*, in the files named there. E7 is existing suites. Check: run them.
   - Failing before the change: every E1 row (the read counts), E3's "yes" row, its `null` row and its leaf case, E4's first row, and E5's second row.
   - Passing before and after: E2, the rest of E3, E4's second row, E5's other rows, E6 and E7.

2. **`core/Component.ts` — the gate.**
   - Add `_layoutMetricsGeneration` after `_layoutDirty` ([`:600`](packages/lib/src/typescript/lib/core/Component.ts#L600)).
   - In `doLayout` ([`:7773`](packages/lib/src/typescript/lib/core/Component.ts#L7773)), record it beside `this._layoutDirty = false;`. Add one sentence to `doLayout`'s `@remarks`: the same point records the text-metrics generation the pass ran against, which the skip gate compares.
   - Add the condition to `canSkipUnchangedCommit` ([`:4397`](packages/lib/src/typescript/lib/core/Component.ts#L4397)). Extend its `@remarks`: a theme switch or font load moves measured text without moving any rectangle, so a component last laid out against other metrics is laid out again.
   - `Util` is already imported (line 13).
   - Check: E5 passes; `npx vitest run tests/core/UnchangedCommitSkip.test.ts tests/core/UnchangedCommitOptIns.test.ts` is green.

3. **`layout/LayoutManager.ts` — `resolveBounds`**, as in *Internal Structure*. Add one sentence to its JSDoc: "A child that fills both axes is sized to the cell without any of its size hints being read." Check: E1, E2 and E6 pass.

4. **`layout/LayoutManager.ts` — `reserveContentFrame`**, as in *Internal Structure*. Add one sentence to its JSDoc: "A host that scrolls on neither axis clears any frame and returns without reading its children." Check: E4 passes.

5. **`core/Component.ts` — the laid-out list.**
   - Add the field after `_components` ([`:543`](packages/lib/src/typescript/lib/core/Component.ts#L543)).
   - Replace `getLaidOutComponents` ([`:7570`](packages/lib/src/typescript/lib/core/Component.ts#L7570)) and add `laidOutStillMatches` after it, with a doc comment.
   - Extend `getLaidOutComponents`' JSDoc with an `@remarks`: "The array is re-served, unchanged, for as long as the same children are displayed in the same order, so one array can reach several callers and none of them may modify it. Copy it before sorting or splicing."
   - Add `this._laidOutComponents = null;` in three places:
     - `removeComponent` ([`:7472`](packages/lib/src/typescript/lib/core/Component.ts#L7472)), directly after the `splice`;
     - `removeAllComponents` ([`:7504`](packages/lib/src/typescript/lib/core/Component.ts#L7504)), directly after `this._components = [];`;
     - the destructor ([`:1207`](packages/lib/src/typescript/lib/core/Component.ts#L1207)), directly after `this._components = [];`.
   - Check: E3 passes. `grep -n '_laidOutComponents' packages/lib/src/typescript/lib/core/Component.ts` shows 6 lines: the field, the read and the assignment in `getLaidOutComponents`, and the three resets. None of them indexes into the array, sets its `length` or calls a method on it.

6. **Documentation**, per *Documentation Impact*.

7. **Run *Verification*'s offline checks**, including the mutation checks. Stop there: the in-engine A/B belongs to the orchestrator.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/LayoutManager.ts` |
| Modify | `packages/lib/tests/component/layout/LayoutManager.resolveBounds.test.ts` |
| Create | `packages/lib/tests/component/layout/LayoutManager.reserveContentFrame.test.ts` |
| Create | `packages/lib/tests/core/Component.laidOutComponents.test.ts` |
| Create | `packages/lib/tests/core/UnchangedCommitMetricsGate.test.ts` |
| Modify | `packages/lib/docs/concepts/layout-system.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

E1–E7 are unit tests under the modelled DOM (`installTestDOM` with the test font). "Settled" means laid out and flushed twice. `resolveBounds` and `reserveContentFrame` are protected, so tests reach them through `(x as any)`. E8 is in-engine only.

**E1. `resolveBounds` reads only what it uses** (`LayoutManager.resolveBounds.test.ts`, a new `describe`). The host is `new Container({ layoutManager: fit })` with `fit = Fit()`, rendered, 200×100, insets cleared. The child is `new Component({ preferredSize: { width: 40, height: 20 } })`, added with the constraint from the table (`host.addComponent(child, { fill })`, or none). Spy on the child's `getPreferredSize`, `getMinSize`, `getMaxSize` and `getSize`, then call `(fit as any).resolveBounds(child, 10, 20, 100, 50, argument)`.

| Constraint `fill` | Argument | Result | preferred / min / max / size calls |
|---|---|---|---|
| none | `FillType.BOTH` | `{ x: 10, y: 20, width: 100, height: 50 }` | 0 / 0 / 0 / 0 |
| `FillType.BOTH` | `FillType.NONE` | `{ x: 10, y: 20, width: 100, height: 50 }` | 0 / 0 / 0 / 0 |
| `FillType.NONE` | `FillType.BOTH` | `{ x: 40, y: 35, width: 40, height: 20 }` | 1 / 1 / 1 / 0 |
| none | `FillType.HORIZONTAL` | `{ x: 10, y: 35, width: 100, height: 20 }` | 1 / 1 / 1 / 0 |
| none | `FillType.VERTICAL` | `{ x: 40, y: 20, width: 40, height: 50 }` | 1 / 1 / 1 / 0 |

Today every row reads each of the four once.

**E2. A child with no preferred size still uses its current size.** A bare `new Component()` (whose `getPreferredSize()` is `null`) in the same host, with `setWidth(30)` and `setHeight(12)`. `resolveBounds(bare, 10, 20, 100, 50, FillType.NONE)` returns `{ x: 45, y: 39, width: 30, height: 12 }`, and `getSize` is called once.

**E3. The laid-out list** (`Component.laidOutComponents.test.ts`). The host is a rendered `Container` holding leaves `a`, `b`, `c` (plain `Component`s). Each row follows the previous one.

| Step | `getLaidOutComponents()` | Same object as the previous call? |
|---|---|---|
| first call | `[a, b, c]` | — |
| call again | `[a, b, c]` | yes |
| `b.setDisplayed(false)` | `[a, c]` | no; the array from the first call still holds `[a, b, c]` |
| `b.setDisplayed(true)` | `[a, b, c]` | no |
| `sortComponents` with a comparator that reverses the order | `[c, b, a]` | no |
| `addComponent(d)` | `[c, b, a, d]` | no |
| `removeComponent(a)`; `(host as any)._laidOutComponents` read straight after | `null` | — |
| call | `[c, b, d]` | — |
| push a new `Component` into the returned array, then call | `[c, b, d]` | no |
| `removeAllComponents()`, then call | `[]` | no |

A leaf with no children returns `[]` twice, and both calls return the same object.

**E4. `reserveContentFrame`** (`LayoutManager.reserveContentFrame.test.ts`). The host is a rendered `Container` with `lm = VBox({ spacing: 0 })`, 400×300, insets cleared. It holds two leaves, each with `preferredSize` 100×20, and is laid out once: the leaves sit at (0, 0) and (0, 20).

| Host state | Spies installed, then `(lm as any).reserveContentFrame()` | Expected |
|---|---|---|
| scrolls on neither axis | `host.getLaidOutComponents`, `a.getTranslateX`, `host.clearContentFrame`, `host.setContentFrame` | `getLaidOutComponents` 0 and `getTranslateX` 0 calls; `clearContentFrame` 1 call; `setContentFrame` 0 calls |
| after `lm.setOverflowing(false, true)` | `host.getLaidOutComponents`, `host.setContentFrame` | `getLaidOutComponents` 1 call; `setContentFrame` called once with `(100, 40)` |

Today the first row reads `getLaidOutComponents` and `getTranslateX` once each.

**E5. The gate's state** (`UnchangedCommitMetricsGate.test.ts`). Every case in this file installs the modelled DOM from `makeConfig()`, which clones the font table, and captures `requestAnimationFrame` with `install()` / `flushFrame()`.
- The scene is a `Fit` host (800×600, insets cleared), then `box = new SkippableContainer({ layoutManager: VBox({ spacing: 0 }) })`, then `new Text({ text: "World" })`.
- `SkippableContainer` is a local `Container` subclass whose `canSkipUnchangedLayout()` returns `true`, as in `UnchangedCommitSkip.test.ts`. The scene is settled.

| Step | `box.canSkipUnchangedCommit()` |
|---|---|
| settled | `true` |
| `ThemeManager.setTheme(ThemeManager.getTheme())` | `false` |
| `host.doLayout()`, then flush | `true` |
| settled, no theme change: `host.doLayout()` twice | `true`, and neither pass calls `box.doLayout` |

**E6. A font swap reaches text under a skipping container** (same file). The scene is E5's. Settle it and read the text's width, 70 in the test font. Then double every advance (`widenFont`), call `ThemeManager.setTheme(ThemeManager.getTheme())`, `host.doLayout()`, and flush. The text's width is 140, twice the settled width. A second case runs the same steps with a plain `Panel({ layoutManager: VBox({ spacing: 0 }) })` in place of `box`, and also reads 140. The plain `Panel` skips through the opt-ins' override.

Without step 2, both cases read 70 once step 3 has landed: this is the case the gate exists for. Before step 3, they read 140 with or without the gate.

**E7. The geometry gates hold** (existing suites, no baseline edited):
- In `tests/core/UnchangedCommitSkip.test.ts`, cases 12 and 13 keep every sweep digest: deep, shallow and shell, width and height. Case 13's skip count is the value the opt-ins set.
- In `tests/core/Component.sizeHintMemo.test.ts`, case 9 keeps the deep and shallow sweep digests, and every call count stays at or below its ceiling.
- The opt-ins' E12 (a font swap through the skip) stays green.

**E8. In-engine (manual, the orchestrator's).** The A/B in *Verification*. Geometry is `=` in every run, and the counters move as its table lists.

---

## Verification

From `packages/lib` (implementer):

- `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, `npm run test:lint` — clean.
- `npm test` — green. **The suite is not the gate.** This plan, applied at runtime over `11ad15eb`, left all 8,035 tests green except one `llms-generate` doc-path case. That case fails identically without the plan under the probe runner's root.
- `npm run build:lib`, then `(cd ../qa && npm test)`. The QA panels still mount under jsdom, and no window opens.
- `npm run docs:api`: the 14 warnings already on `master` and no new one. `npm run docs:llms:check`: clean.
- Mutation checks, one at a time, each reverted:

  | Mutation | Fails |
  |---|---|
  | move the four reads back above the `BOTH` branch | E1's `BOTH` rows |
  | drop the gate condition | E5's second row, and both E6 cases (70) |
  | return a fresh `filter` on every call | E3's "yes" row and its leaf case |
  | refill the kept array in place instead of replacing it | E3's third row (the first array changes) |
  | drop the `removeComponent` reset | E3's `null` row |
  | drop `reserveContentFrame`'s early return | E4's first row |

**In-engine A/B — the acceptance gate. The orchestrator runs it, never the implementer.** Every run opens a full-screen MiniBrowser window.

**Arms.** `wt` is the library at the commit the implementation branch forked from, which already carries the opt-ins; the implementation notes record the SHA. `main` is the implementation branch with its `packages/lib` built. Build the base with the README recipe ([`packages/qa/README.md:86`](packages/qa/README.md#L86)), from the repository root of the checkout that holds the fix:

```sh
git worktree add .worktrees/_lsre-base <base-sha> --detach
ln -sfn "$PWD/node_modules" .worktrees/_lsre-base/node_modules
(cd .worktrees/_lsre-base/packages/lib && npm run build:lib)
(cd packages/lib && npm run build:lib)
export QA_WT_LIB="$PWD/.worktrees/_lsre-base/packages/lib"
```

**The runs.** This script follows [`packages/qa/sweeps/w3-0.sh`](packages/qa/sweeps/w3-0.sh) and the opt-ins' A/B. Save it outside the repository and run it from the repository root: first `bash lsre-ab.sh --dry-run`, then `bash lsre-ab.sh`.
- Each cell runs `wt-a, main-1, wt-b, main-2, wt-c`, so the base brackets the fix at both ends.
- There are 8 cells and 40 runs, about 15–20 minutes.
- The scored cells are the W3.0 cells that bounded G05 and G11 (`b04`, `b09`, `b11`). The gate-only cells are W3.0's `b07` theme switches, where the new gate condition engages.

```bash
#!/bin/bash
# Layout size-read economy, in-engine A/B: bash lsre-ab.sh [--dry-run] [<cell> ...]
#
# Every run opens a full-screen window and holds it until the run ends. The
# orchestrator runs this with the user's go-ahead; an implementer never does.
# Run from the repository root of the checkout holding the fix, with its
# packages/lib built (the main arm) and QA_WT_LIB set to a built packages/lib
# at the plan's base commit (the wt arm). --dry-run opens nothing.
set -u
RUNQA=packages/qa/runqa.sh
SESSION=${LSRE_SESSION:-s1}
FLAGS='work=1&seam=1&geom=1'

# Scored: the W3.0 cells that bounded G05 and G11. Gate-only: the theme
# switches, where the skip gate's text-metrics condition engages.
CELLS="sdr ssr fnq ffq ffh cdq sd4m ss4m"

# Prints a cell's query parameters, exactly as W3.0's matrix ran them.
params() {
    case "$1" in
        sdr)  echo 'panel=shell-deep&drive=resize' ;;
        ssr)  echo 'panel=shell-shallow&drive=resize' ;;
        fnq)  echo 'panel=form-nested&passes=form&drive=passes' ;;
        ffq)  echo 'panel=form-flat&passes=form&drive=passes' ;;
        ffh)  echo 'panel=form-flat&passes=header&drive=passes' ;;
        cdq)  echo 'panel=chart-dashboard&n=50&drive=passes' ;;
        sd4m) echo 'panel=shell-deep&n=4&drive=theme:10' ;;
        ss4m) echo 'panel=shell-shallow&n=4&drive=theme:10' ;;
        *)    return 1 ;;
    esac
}

MODE=run
if [ "${1:-}" = --dry-run ]; then
    MODE=dry
    shift
fi

selected=${*:-$CELLS}

for c in $selected; do
    params "$c" > /dev/null || { echo "unknown cell $c (cells: $CELLS)" >&2; exit 2; }
done

if [ "$MODE" = run ]; then
    [ -f packages/lib/dist/lib/core.es.js ] || { echo "build packages/lib first" >&2; exit 2; }
    [ -f "${QA_WT_LIB:-/nonexistent}/dist/lib/core.es.js" ] || { echo "set QA_WT_LIB to a built packages/lib at the base commit" >&2; exit 2; }
fi

# One run: printed under --dry-run, otherwise run, stopping at the first failure.
run() {
    if [ "$MODE" = dry ]; then
        printf 'runqa %s %s %s\n' "$1" "$2" "$3"
    else
        "$RUNQA" "$1" "$2" "$3" || exit 1
    fi
}

for c in $selected; do
    p="$(params "$c")&$FLAGS"
    run "lr$SESSION-$c-wt-a"   wt   "$p"
    run "lr$SESSION-$c-main-1" main "$p"
    run "lr$SESSION-$c-wt-b"   wt   "$p"
    run "lr$SESSION-$c-main-2" main "$p"
    run "lr$SESSION-$c-wt-c"   wt   "$p"
done
```

**Reading.** For each cell:
- `python3 packages/qa/bin/qa-table.py packages/qa/results lrs1-<cell>- --work` gives the `geom` column, which compares each run with `wt-a`, and the per-run averages.
- The script below sums the counters this plan is scored on. Save it beside `lsre-ab.sh` and run `python3 lsre-read.py packages/qa/results lrs1-<cell>-`. It was checked against W3.0's `b04` files, where it reproduces the record's 1,677.0 misses per `sdr` unit.

```python
#!/usr/bin/env python3
# lsre-read.py <results-dir> <run-prefix>: per run and phase, the average frame and the counters this plan is scored on.
import glob
import json
import re
import sys

results, prefix = sys.argv[1], sys.argv[2]


def total(work, name):
    return sum(v for k, v in work.items() if k.startswith(name + '@'))


def epoch(path):
    return int(re.search(r'-(\d+)\.json$', path).group(1))


for path in sorted(glob.glob(f'{results}/{prefix}*.json'), key=epoch):
    report = json.load(open(path))

    for phase in report['phases']:
        work = phase['work'] or {}
        hints = total(work, 'getPreferredSize') + total(work, 'getMinSize') + total(work, 'getMaxSize')

        print(f"{report['name']:26} {phase['driver']:7} avg={phase['timing']['avgMs']:8.2f}"
              f" miss={total(work, 'sizeHintMiss'):8.1f} hints={hints:8.1f}"
              f" laidOut={total(work, 'getLaidOutComponents'):7.1f} doLayout={total(work, 'doLayout'):7.1f}")
```

Apply W3.0's rule by hand ([`w3-0-bounding-sweep.md`](plans/implemented/w3-0-bounding-sweep.md#L114), *The decision rule*):
- **bracket** is the largest `wt` average minus the smallest.
- **Δms** is the mean of the two `main` averages minus the mean of the three `wt` averages.
- **Δ%** is `main` against `wt` for each counter. Counts are deterministic per build.[^counters]

**Expected readings, scored cells.** The values are per unit, from the offline measurement against the opt-ins' tree (*Addendum: Offline Measurement*). Offline counts match the engine's within 0.4% on the forms, exactly on the chart dashboard, and about 5% below it on the shells, so judge each counter by its Δ%.

| Cell | `sizeHintMiss@*` `wt` → `main` | Δ | size-hint calls | Δ | `getLaidOutComponents@*` | Δ | Δms |
|---|---|---|---|---|---|---|---|
| `sdr` | 682 → 613 | −10.1% | 1,801 → 1,502 | −16.6% | 463 → 398 | −14.0% | flat |
| `ssr` | 495 → 473 | −4.4% | 1,376 → 1,184 | −14.0% | 331 → 297 | −10.3% | flat |
| `fnq` | 538.7 → 514.5 | −4.5% | 1,528 → 1,040 | −32.0% | 203 → 172 | −15.4% | flat, possibly a small win |
| `ffq` | 430 → 430 | 0.0% | 1,334 → 1,328 | −0.4% | 111 → 111 | 0.0% | flat |
| `ffh` | 78 → 63 | −19.2% | 160 → 112 | −30.0% | 18 → 18 | 0.0% | flat |
| `cdq` | 236 → 232 | −1.7% | 440 → 356 | −19.1% | 102 → 94 | −7.8% | flat |

The laid-out arrays built per unit fall from the `getLaidOutComponents@*` count to under 5 in every cell. The harness cannot see this.[^counters]

**Expected readings, gate-only cells**, offline, per theme switch:

| Cell | `doLayout@*` `wt` → `main` | `sizeHintMiss@*` `wt` → `main` |
|---|---|---|
| `sd4m` | 224 → 296 (+32%) | 1,752 → 1,960 (+12%) |
| `ss4m` | 131 → 197 (+50%) | 1,244 → 1,482 (+19%) |

The `main` layout counts equal the tree's before the opt-ins. The gate gives back what the opt-ins saved on a theme switch, and no more.[^theme-cost]

**Pass criteria:**

1. `geom` is `=` for every run of all 8 cells, and `wt-b` and `wt-c` also read `=`. A cell whose `wt` runs disagree is unstable and is re-run.
2. In every scored cell, each counter's Δ% lands within 2 points of the table, 3 for `getLaidOutComponents@*`.
3. No scored cell's `ms` is `regress`. The expected reading is `flat` everywhere; a `win` is a bonus.[^flat]
4. In both gate-only cells, `main`'s `doLayout@*` per unit is above `wt`'s. Their Δms may rise by the saving the opt-ins' own A/B recorded on the same cell, plus this A/B's bracket, and no more.

A geometry `DIFF` anywhere stops the plan until its cause is found. A gate-only cell beyond criterion 4 also stops it, and is reported with its size. Record the readings in the implemented plan's *Implementation Notes*.

---

## Documentation Impact

- **[`docs/concepts/layout-system.md`](packages/lib/docs/concepts/layout-system.md#L29), *The write is diffed*.** Append to the end of the paragraph, after the opt-ins' own edits:

  > A theme switch or a web-font load also defeats the skip, for one pass. It moves measured text sizes without moving any rectangle, so a component last laid out against other text metrics is laid out again even when its rectangle holds still.

- **[`docs/concepts/layout-system.md:131`](packages/lib/docs/concepts/layout-system.md#L131)**, the custom `doLayout` paragraph. Append:

  > The array may be shared: it is re-served, unchanged, for as long as the same children are displayed in the same order, so copy it before sorting or splicing.

- **[`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md#L51), *Changed → Core*.** Two bullets:
  - **`getLaidOutComponents()` re-serves the array it last returned while the displayed children are unchanged.** Two calls with no child added, removed, reordered, shown or hidden in between return the same array. So the list a layout pass reads several times is built once. The contents are what they always were, and an array a caller already holds is never edited afterwards. A caller that sorts or splices the result must copy it first, `[...container.getLaidOutComponents()]`.
  - **A theme switch or web-font load lays out every component that opted into skipping an unchanged commit, on the first pass after it.** The skip now also requires that the component was last laid out against the current text metrics. This used to hold only by accident: a parent's layout read a child's preferred size even when the child filled its cell. `LayoutManager.resolveBounds` no longer does that. A child placed to fill both axes is sized to the cell without any of its size hints being read.
- **JSDoc that renders:** `getLaidOutComponents`' new `@remarks`. The other edited comments are on `protected`, `private` or `@internal` members, which the API docs exclude. None of them `{@link}` an excluded symbol from public JSDoc.
- **No export, barrel, `llms.txt`, sidebar or migration change.** No signature moves. The one rule a consumer must follow is not to modify the returned array, and the changelog and the method's docs both state it.

---

## Potential Challenges

- **Returning the live child list instead of a kept array.** It looks equivalent and is shorter. It is wrong: `Border` and `Split` store the result and read it after the children have changed.[^live-list]
- **Editing the kept array in place.** A holder's snapshot would change under it. The kept array is only ever replaced (E3's third row).
- **The gate before `resolveBounds`.** Steps 2 and 3 run in that order, so no commit leaves text under a skipping component at its old size after a font swap.
- **Theme state leaking between tests.** In E6, clone the font table per test. In `afterEach`, set `ThemeManager.setTheme(ModernTheme)`, flush, dispose the roots, and only then restore the mocks and call `DOM.reset()`. A frame requested after the `requestAnimationFrame` spy is restored leaves the module's pending-frame handle set, and every later flush in the file then silently does nothing ([`UnchangedCommitSkip.test.ts:545`](packages/lib/tests/core/UnchangedCommitSkip.test.ts#L545)).
- **Line numbers after the opt-ins.** They edit `setDisplayed`, padding, border and `removeAllComponents` in `core/Component.ts`, so every later line shifts. Place each edit by the symbol and the anchor statement named in the steps.
- **`docs:api` warnings.** The bar is the 14 already on `master` and no new one, never zero.

---

## Critical Files

- [`layout/LayoutManager.ts:316-358`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L316) `reserveContentFrame`; [`:406-529`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L406) `resolveBounds`; [`:588`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L588) `commitBounds`, which asks the gate.
- [`core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts): `getLaidOutComponents` (:7570), `canSkipUnchangedCommit` (:4397), `doLayout` (:7748), `removeComponent` / `removeAllComponents` (:7472, :7498), the destructor's child teardown (:1204), and the size-hint getters (:3683), whose "none of them may modify it" wording `getLaidOutComponents` reuses.
- [`component/input/Text.ts:557`](packages/lib/src/typescript/lib/component/input/Text.ts#L557) `needsMeasure`: the precedent for comparing a stored `Util.textMetricsGeneration()`.
- [`component/table/Header.ts:372`](packages/lib/src/typescript/lib/component/table/Header.ts#L372) and [`component/table/cell/Cell.ts:229`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L229): a theme change already defeats the cell skip.
- [`layout/Border.ts:470`](packages/lib/src/typescript/lib/layout/Border.ts#L470), [`layout/Split.ts:559`](packages/lib/src/typescript/lib/layout/Split.ts#L559): callers that store the laid-out array.
- [`plans/unchanged-commit-opt-ins.md`](plans/unchanged-commit-opt-ins.md): the opt-ins, their E12, and their A/B, whose shape this one copies.
- [`plans/implemented/size-hint-per-pass-memo.md`](plans/implemented/size-hint-per-pass-memo.md): the memo contract, meaning a layout pass, the generation counter, and application code running mid-pass.
- [`packages/qa/src/harness/ablations.ts:813-846, 981-1047`](packages/qa/src/harness/ablations.ts#L813): the two ablations.
- Tests: [`UnchangedCommitSkip.test.ts`](packages/lib/tests/core/UnchangedCommitSkip.test.ts) (the `SkippableContainer`, `install` / `flushFrame` at :552-572, cases 12 and 13), [`TreeFontReflow.test.ts:37-54`](packages/lib/tests/component/tree/TreeFontReflow.test.ts#L37) (`makeConfig` / `widenFont`), [`LayoutManager.resolveBounds.test.ts`](packages/lib/tests/component/layout/LayoutManager.resolveBounds.test.ts) (`hostFit`).

---

## Non-Goals

- **`Grid`'s track-less `measureContent` skip.** It saves no miss in any measured cell.[^grid]
- **The per-phase gather**, which would read each child's hints once and pass them to `resolveBounds`. W3.0 counted what it could still remove: 2,340.7 memo hits per `sdr` unit, of the kind wave 2 measured as free.
- **G11's generation-bump scoping** (narrowing `doLayout`'s `invalidateSizeHints()`). It is a different design with its own correctness gates, as the W3.0 status pass says.
- **A `readonly Component[]` return type** for `getLaidOutComponents`.[^shared-type]
- **A QA counter for the laid-out arrays built.** Identity reuse is pinned by E3 instead.[^counters]
- **Keeping theme switches as cheap as the opt-ins made them.** Correctness across a theme change comes first.[^theme-cost]
- **`Component.getWidth()` / `getHeight()` building a `Size` through `getSize()` on every call.** `commitBounds` and `reserveContentFrame`'s walk read them per child. That is a separate item, noted here only.

---

## Addendum: Offline Measurement

**Method.** A throwaway vitest probe mounted the QA app's own panel modules in the library's modelled DOM. It used the sweep's viewport (5120×2075) under a `Fit` host and ran 40 units of each W3.0 driver:
- `resize`: ±3 px width steps on the panel's `resize` target, then `doLayout`;
- `passes`: `doLayout` on the panel's `passes` target;
- theme: 10 switches alternating `DarkTheme` and `ModernTheme`, each followed by the host's scheduled pass, which is `Body`'s own theme reflow.

Per unit, it counted `beginSizeHintRecord` calls (the misses), size-hint calls, `getLaidOutComponents` calls, and arrays built. It also digested every rectangle on every unit.

"Base" is the library at `11ad15eb`, without the opt-ins. The arms were applied at runtime:
- the opt-ins, as the four overrides `unchanged-commit-opt-ins` specifies;
- this plan, as the gate, the lazy reads, the frame early return and the kept array.

Offline counts match W3.0's in-engine plain arms exactly on `ffq`, `ffh` and `cdq`. They run 0.4% high on `fnq`, and 4.5% and 5.3% low on `sdr` and `ssr`. Geometry was `=` against the base tree in every arm of every cell.

| Cell | Tree | Misses | Size-hint calls | `getLaidOutComponents` calls | Arrays built |
|---|---|---|---|---|---|
| `sdr` | base / base + plan | 1,601 / 1,503 | 3,931 / 3,313 | 662 / 575 | 662 / 5 |
| | opt-ins / opt-ins + plan | 682 / 613 | 1,801 / 1,502 | 463 / 398 | 463 / 3 |
| `ssr` | base / base + plan | 1,410 / 1,363 | 3,502 / 2,995 | 530 / 474 | 530 / 4 |
| | opt-ins / opt-ins + plan | 495 / 473 | 1,376 / 1,184 | 331 / 297 | 331 / 2 |
| `fnq` | base / base + plan | 2,922.7 / 2,660.5 | 8,619 / 7,136 | 1,456 / 1,283 | 1,456 / 11 |
| | opt-ins / opt-ins + plan | 538.7 / 514.5 | 1,528 / 1,040 | 203 / 172 | 203 / 4 |
| `ffq` | base / base + plan | 2,778 / 2,524 | 7,158 / 6,160 | 1,275 / 1,123 | 1,275 / 9 |
| | opt-ins / opt-ins + plan | 430 / 430 | 1,334 / 1,328 | 111 / 111 | 111 / 2 |
| `ffh` | base / base + plan | 78 / 63 | 160 / 112 | 18 / 18 | 18 / 0 |
| | opt-ins / opt-ins + plan | 78 / 63 | 160 / 112 | 18 / 18 | 18 / 0 |
| `cdq` | base / base + plan | 380 / 376 | 1,112 / 884 | 198 / 166 | 198 / 1 |
| | opt-ins / opt-ins + plan | 236 / 232 | 440 / 356 | 102 / 94 | 102 / 1 |

`reserveContentFrame` is called 45 times per `sdr` unit on the base tree, and on all but one of those calls the host scrolls on neither axis, so the walk is skipped. With the opt-ins it is called 35 times and no host scrolls. The gate condition alone changes no count in any of these cells.

**Font swap.** The probe doubled every glyph advance and then switched to the same theme, as `TreeFontReflow.test.ts` does, and compared every rectangle with the base tree after the same swap. "Same" means identical to the base tree; "stale" means the text kept its old size.

| Scene | Opt-ins | Lazy reads alone | Opt-ins + lazy reads | Opt-ins + lazy reads + gate |
|---|---|---|---|---|
| `Fit` → `Panel(VBox)` → two `Text`s | same | same | **stale** | same |
| `Fit` → `Panel(Fit)` → `Panel(VBox)` → `LabeledGrid` + `Text` | same | same | **stale** | same |
| `shell-deep`, `shell-shallow`, `form-flat` | same | same | same | same |

In the first two scenes and the three panels, the base tree's result also equals a scene built fresh under the wider font.

**Theme switches** (n=4, per switch). Geometry was `=` in every arm.

| Panel | Base | Opt-ins | Opt-ins + gate | Opt-ins + plan |
|---|---|---|---|---|
| `shell-deep` | 2,134 misses, 296 layouts | 1,752, 224 | 2,134, 296 | 1,960, 296 |
| `shell-shallow` | 1,617, 197 | 1,244, 131 | 1,617, 197 | 1,482, 197 |

**The whole suite** ran with this plan applied at runtime through a setup file: 8,035 tests passed. The one failure, an `llms-generate` doc-path case, fails identically unpatched under the probe runner's root. With the opt-ins added too, only case 13's skip count moves, which is the opt-ins' own step 8.

**Observed for the opt-ins, not this plan.** In `form-nested`, the opt-ins alone move the inspector table's first header column from 146.96 to 149.58 px wide after the second settling pass. Their closures applied without the opt-ins have the same effect; a first pass shows no difference. Both arms of this plan's A/B carry it equally. The opt-ins' own A/B gates it through the panel's `inspector` label.

---

## Notes

[^absorbed]: Wave 2's size-hint record ([`size-hint-per-pass-memo`](plans/implemented/size-hint-per-pass-memo.md)) already turned most of these reads into memo hits. What is left is misses: a read that is the first of its pass, or the first after the generation moved. `doLayout` bumps the generation in its `finally`, so a manager's calc phase and its commits sit in different generations. It is also left with work the memo does not touch, namely a new filtered array on every `getLaidOutComponents` call and a discarded child walk in `reserveContentFrame`. `Border`'s region record (`41deeeb2`) already covers the border manager. The three trims attack exactly this remainder, in the shared helpers every manager calls, so no manager's own code changes.

[^g05-reads]: For a general component, `commitBounds` still reads the child's minimum and maximum right afterwards: `setWidth` and `setHeight` clamp through the merged hints. Those reads now miss where `resolveBounds`' reads used to, so the misses move rather than disappear there, and a `Text` still re-measures there. The saving is real for a child whose clamp reads no hint, a `Container` or `Panel` (`clampsToContentSize()` is `false`), and for every preferred-size read, which the clamp never makes. That is why the offline miss counts fall less than the call counts. `getSize()` builds a new object on every call and is used only without a preferred size, so it moves inside that case too. The order of the remaining reads (preferred, maximum, minimum) is unchanged.

[^pull]: The unchanged-commit skip withholds an opted-in component's pass when its rectangle holds still. A theme switch or font load changes every measured text size and moves no rectangle, so the skipped subtree's `Text`s re-measure only if something asks their size. Today that something is often the parent's `resolveBounds`: `Body`'s `Fit` places the root with `BOTH` and reads the root's preferred size, which recurses to every `Text`, and a moved one relays up and marks the root owed. The opt-ins' footnote on theme relies on exactly this ("The parent's size query reaches each `Text`"). With the lazy reads, nothing asks: in the probe, a font swap left a `Text` under a skipping plain `Panel` at its old width (E6, 70 instead of 140), and so did a local opted-in container. The gap is not new, only newly common. A custom manager that commits through `commitBounds` directly, as `resolveBounds`' own documentation invites, already reaches it today. Three other designs were considered. (1) Keeping the preferred-size read for a `BOTH` fill removes 0–18 of the misses per unit left after the opt-ins, against 0–69 for the full change (`sdr` 682 → 664, `ffq` and `fnq` unchanged), so it gives up the plan. (2) Asking the size from inside the gate when the generation moved would keep theme switches cheap, but it puts a side effect in a predicate the batched flush calls in its ancestor walk, and it still depends on how far a preferred-size recursion reaches. (3) A theme subscription per opted-in class, as `Table`'s `Header` has for its cells, is the per-instance subscription `Text` moved away from. The generation comparison is lazy, holds nothing, and covers every opted-in class, including the ones opted in before (`Cell`, `MenuBar`, `ToolBar`), from the one definition of the gate.

[^theme-cost]: With the gate, a theme switch lays out every opted-in component once. Offline at n=4: `shell-deep` goes from 224 layouts per switch under the opt-ins to 296, and `shell-shallow` from 131 to 197. Those are exactly the counts before the opt-ins. The lazy reads keep the misses below that level (1,960 against 2,134 on `shell-deep`). The layout is a small part of a theme frame: W3.0 measured `sd4m` at 197.8 ms and `ss4m` at 150.4 ms per switch, dominated by restyle. The cells stay gate-only, and criterion 4 bounds any rise by what the opt-ins saved there. A table's cells were already laid out on every theme change through their hosts' marks, so the gate changes nothing for them.

[^laid-out-compare]: The size-hint record is the precedent for re-serving a cached answer on the same hot path. It is keyed rather than compared because its inputs funnel through a handful of writers. The laid-out list's inputs do not: the child list changes in `insertComponent`, `removeComponent`, `removeAllComponents`, `sortComponents` and the destructor, and a child's displayed state in `setDisplayed` and the class defaults. A version key would need a hook in each of those, and a child-to-parent notice for every displayed flip, and a missed hook would serve a wrong list: the failure mode wave 2 warned about, where a wrong memo key passed all 7,519 tests. The comparison needs no hook and cannot go stale. It is not keyed on the layout pass either, so the application code the memo contract allows mid-pass (the `onFirstLayout` drain, a `sizechange` listener) cannot leave it stale. It costs the one `isDisplayed()` per child that `filter` already paid, and it builds no array. The ablation's `every(isDisplayed)` scan had the same cost profile and measured the saving.

[^live-list]: `Split.snapshotAndUndisplay` ([`layout/Split.ts:559`](packages/lib/src/typescript/lib/layout/Split.ts#L559)) and `Border` ([`layout/Border.ts:470`](packages/lib/src/typescript/lib/layout/Border.ts#L470)) store the laid-out array in their collapsed-content records, and later re-display exactly those children. With the live child list, a child added or removed while the pane is collapsed would silently change that record. A loop that runs child layouts over the list would also see a child that a mid-pass `sizechange` or `onFirstLayout` listener added or removed. The memo contract counts on application code running at those two points. Returning the live list would also hand every caller the array `getComponents()` exposes. The kept array has none of these problems, because it is only ever replaced.

[^shared-type]: The size-hint getters return a shared `Size` typed as a plain `Size`, with the no-modify rule in their documentation. `getLaidOutComponents` follows the same precedent. A `readonly Component[]` return type would make a modifying caller a compile error. It would also widen the parameter types of every internal helper that receives the list (`Grid`'s measure and occupancy helpers, the box managers' gather helpers, `Split`'s gutter lookups and the `Border` and `Split` records), which is a wider edit than the problem. No library caller modifies the result: none sorts, splices or pushes into it.

[^grid]: `Grid.measureContent` reads each child's preferred and minimum size to size `"content"` tracks. With no tracks every track is a weight and the result is discarded. Only `chart-dashboard`'s 4-chart grid reaches that case in the measured cells, once per pass: 8 hint reads, all hits (`cdq`'s misses are 380 with or without the skip). W3.0's `cdq` time was flat (+0.07 ms). `LabeledGrid`, which the forms use, declares tracks and never qualified.

[^counters]: The harness counts calls, not allocations. The kept array removes the array built per call, not the call, so `getLaidOutComponents@*` falls only where `reserveContentFrame` no longer calls it, or where the lazy reads skip a size recursion that would have called it. E3 pins the identity reuse offline, and the probe counted the arrays: under 5 built per unit, where `wt` builds 18–463. `sizeHintMiss@*` is the harness's per-miss counter (`beginSizeHintRecord`), which W3.0 scored G05 on. `qa-ab.py` cannot score a library build arm, as the opt-ins' footnote explains, so the reading is by hand.

[^order]: Reversed, this plan's readings would be the addendum's base rows. Misses would fall 1–19% (`fnq` −9.0%, `ffq` −9.1%, `sdr` −6.1%, `ffh` −19.2%), close to the ablation's 3–19%, and arrays built would still fall by 99%. The gate condition would still be required: the moment the opt-ins landed, a skipping `Panel`'s text would keep its old size after a font swap. The opt-ins' A/B would then read smaller savings on the cells both plans touch. Landing the opt-ins first keeps each A/B attributing its own change: the opt-ins' theme-switch saving, then this gate giving it back.

[^flat]: W3.0's frame-time wins for these candidates came on the form passes: G05 −0.45 and −0.29 ms, and G11 −0.36 ms, out of 7.09 and 5.35 ms passes. The opt-ins take those passes to about 0.7 and 0.6 ms by skipping nearly everything the two trims touched: they leave about a sixth of the passes cells' work, and this plan removes a few percent of that. That is roughly 0.02–0.05 ms, the size of the passes cells' brackets (0.02 ms on `fnq`, 0.27 ms on `ffq` in W3.0), so `fnq` may just read a win. The resize cells were already `flat` for both ablations against brackets of 0.73–0.90 ms, before the opt-ins removed half their work.
