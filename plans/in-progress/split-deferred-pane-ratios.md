---
depends-on: [dock-programmatic-split, dock-split-ratio-event]
touches-shared:
  - packages/lib/src/typescript/lib/layout/Split.ts
  - packages/lib/src/typescript/lib/layout/DockRegion.ts
  - packages/lib/src/typescript/lib/overlay/Dock.ts
  - packages/lib/docs/components/Dock.md
  - packages/lib/docs/reference/changelog/next.md
---

# Split Deferred Pane Ratios — Implementation Plan

## Overview

[`Split.applyPaneRatios`](../packages/lib/src/typescript/lib/layout/Split.ts#L1226) writes each pane's share as a stored px size against the container's live main-axis extent. A split that has no extent yet (never laid out) gets the shares against a *unit base* instead: stored sizes that sum to 1 px. The first layout then raises every stored size to the pane's minimum ([`recalculateSizes`](../packages/lib/src/typescript/lib/layout/Split.ts#L2695), `clampMain`) **before** it scales them up ([:2714](../packages/lib/src/typescript/lib/layout/Split.ts#L2714)). The requested ratios are lost: the result is proportional to the panes' minimums. This contradicts the method's own `@remarks` ([:1216–1220](../packages/lib/src/typescript/lib/layout/Split.ts#L1216)).

The visible victim is `restoreLayout` (and `Dock.setLayoutState`). [`populateContainer`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L605) calls `applyPaneRatios` on every freshly built nested split, which has no size. An offline probe against `8bdf42ac7` measured it:[^probe-restore]

| Restored nested split | Saved ratios | Ratios after restore + layout today |
|---|---|---|
| Dock, `V[T(b),T(c),T(d)]` (24 px tab strips) | `[0.6, 0.3, 0.1]` | `[⅓, ⅓, ⅓]` |
| vertical, minimum heights 24 / 24 | `[0.8, 0.2]` | `[0.5, 0.5]` |
| horizontal 500 px, minimum widths 50 / 100 / 150 | `[0.5, 0.25, 0.25]` | `[0.167, 0.333, 0.5]` |
| horizontal 500 px, minimum widths 0 / 300 / 0 | `[0.391, 0.522, 0.087]` | `[0.0013, 0.998, 0.0003]` (outer panes < 1 px) |

The root split restores correctly, because it is already laid out.

This plan makes `applyPaneRatios` on a split with no extent remember that its stored shares are in the unit base, and scale them to px at the start of the first layout that has an extent, before anything clamps them. It then (subject to the user's confirmation, see below) removes the `DockRegion` workarounds the previous plan added for the same bug, so `Dock.splitPanel`'s `ratio` applies to splits that are not laid out yet.

---

## Decision awaiting user confirmation — lift `splitPanel`'s `ratio` limitation

**Recommended: yes.** Part B (steps 6–9) implements it. Part A (steps 1–5) fixes `Split` and the restore, and ships on its own: with Part A alone, every existing test passes unchanged (2 102 / 2 102 in `tests/component/layout`, `tests/layout`, `tests/overlay` with a prototype).[^part-a-alone] If the user declines Part B, skip steps 6–9, the R-test changes, and the `Dock.ts` / `Dock.md` / `next.md` *Added*-entry edits; Part A's tests and docs stay as written.

The current contract (`DockSplitOptions.ratio`, [Dock.ts:264–282](../packages/lib/src/typescript/lib/overlay/Dock.ts#L264)): `ratio` applies only to a new wrapping split, or to a split laid out since it last changed; otherwise it is ignored and the split's pending shares are dropped.

The new contract, word for word as the JSDoc will say it:

> The new pane's share of the target group's slot, along the split, as a fraction between 0 and 1, exclusive; the target group keeps the rest and every other pane keeps its share. Omit it to size the new pane as an edge drop does: half of a new split, or an equal share taken from every pane when the pane joins a split that already runs that way.
>
> It applies whether or not the split has been laid out yet, so several `splitPanel` calls in one task each keep their `ratio`, and `getLayoutState()` reports it straight away. A pane that an earlier call in the same task added without a `ratio` has no share until the next layout, which gives it its drop share from every pane, this one included. If that pane is the target's group itself, there is no share to divide, and `ratio` is ignored.

What changes for the cases the previous plan pinned (prototype measurements):[^lift-evidence]

| Case | Today | With the lift |
|---|---|---|
| R7: wrap with `ratio: 0.3`, then a second split without `ratio` joins it, same task | `[⅓, ⅓, ⅓]` (wrap's ratio dropped) | `[0.467, 0.333, 0.2]` (wrap's 0.7 / 0.3 kept, new pane takes its drop third) |
| R7 with `ratio: 0.5` on the second call | `[⅓, ⅓, ⅓]` | `[0.35, 0.35, 0.3]` |
| R8: never-laid-out `H[T(a),T(b)]`, `ratio: 0.4` beside `a` | `[⅓, ⅓, ⅓]` | `[0.3, 0.2, 0.5]` |
| R10: laid-out 90 / 10, a split without `ratio`, then `ratio: 0.5` beside `a` | `[0.25, 0.45, 0.25, 0.05]` (ignored) | `[0.3375, 0.3375, 0.25, 0.075]` (`d` = `a`) |
| New R11: target group itself added without `ratio` in the same task | — | ignored: `[¼, ¼, ¼, ¼]`, same as without `ratio` |

No case warns. `ratio` is never worse than omitting it, which was the user's reason for the old contract.

---

## Architecture Decisions

### Unit-base shares stay in `_sizes`, flagged, and are scaled at the start of the first layout with an extent

`applyPaneRatios` keeps writing per-pane shares into `_sizes`. When it had to use the unit base it also sets a new private flag, `_unitBaseSizes`. `recalculateSizes`, after its prune passes and before `seedFromPreferred` and the clamp, scales every stored size by the available extent and clears the flag. While the flag is set and there is no positive extent, `recalculateSizes` returns early and leaves the shares alone.[^why-in-sizes]

This mirrors Split's own deferred restore: the `paneSizes` option is held in [`_pendingSizes`](../packages/lib/src/typescript/lib/layout/Split.ts#L220) and applied by [`applyPendingSizes`](../packages/lib/src/typescript/lib/layout/Split.ts#L2510) on the first layout that can resolve it; `Accordion.applySectionSizes` defers the same way ([Accordion.ts:1134](../packages/lib/src/typescript/lib/layout/Accordion.ts#L1134)). It diverges in one respect: the deferred value is keyed by pane in `_sizes`, not held as an index array.[^precedent]

### The result equals `applyPaneRatios` on an already-laid-out split

After the scale, `_lastAvailableMain` is set to the extent, exactly as `applyPaneRatios` sets it on a laid-out split. The rest of `recalculateSizes` then runs unchanged: new panes are seeded or get their equal share, every pane is clamped to `[min, max]`, and the refill restores `Σ == available`. So min/max clamping happens on real px, and a pane added or removed while the shares were pending is handled exactly as on a laid-out split.[^equivalence]

| Before the first layout | First layout at 500 px |
|---|---|
| `applyPaneRatios([0.7, 0.3])` | `[0.7, 0.3]` |
| `applyPaneRatios([0.7, 0.3])`, then a third pane (no preferred size) added | `[0.467, 0.2, 0.333]`: the new pane takes ⅓, proportionally from both |
| `applyPaneRatios([0.5, 0.3, 0.2])`, then pane 0 removed | `[0.6, 0.4]` |
| `applyPaneRatios([0.1, 0.9])`, pane 0 minimum 100 px | `[0.1818, 0.8182]`, the same value a laid-out split gives |

Nothing warns in any of these cases.

### The latest call wins over an undrained `paneSizes` option

`applyPaneRatios` sets `_pendingSizes = null`. A `paneSizes` array not yet applied would otherwise overwrite the ratios at the first layout, and would warn if a pane was added in between.[^latest-wins]

### No `Split` event fires

The scale writes `_sizes` directly and emits nothing. `"paneresize"` stays a gutter-drag-only event and `"panecollapse"` a collapse-only one, so `Dock`'s `"splitresize"` stays silent for restores and `splitPanel`, as [dock-split-ratio-event](implemented/dock-split-ratio-event.md) requires.

### `getPaneRatios` needs no change

It already normalises `_sizes`, so it reports the pending ratios before the first layout, and so do `serializeLayout` and `Dock.getLayoutState`. Its JSDoc and `getPaneSize`'s are corrected to say so.

### (Part B) `DockRegion` writes `ratio` through `Split`'s own seams and drops its workarounds

- The wrap branch builds a plain `new Split({ orientation: axis })` and calls `applyPaneRatios` after both panes are in, as the original plan intended. `wrapPaneSizes` is deleted.[^wrap-via-ratios]
- The insert branch calls `carveSlot` whenever `ratio` is set. `isLaidOut` and the `discardPendingPaneSizes` call are deleted, and so is the `@internal` [`Split.discardPendingPaneSizes`](../packages/lib/src/typescript/lib/layout/Split.ts#L1392), which then has no caller.
- `carveSlot` divides the target group's stored size with [`Split.setPaneSize`](../packages/lib/src/typescript/lib/layout/Split.ts#L873), whose JSDoc names this use ("a caller that has just inserted a pane (an edge-drop dock, say)"). Other panes are not touched. A split with no stored size on any pane counts every pane equally.[^carve]

| Split state when the stack is inserted | `carveSlot` does |
|---|---|
| No pane has a stored size (never laid out, nothing pending) | `applyPaneRatios` with every pane `1`, the unit `1 − ratio`, the stack `ratio` |
| The unit has a stored size (px, or a pending unit-base share) | `setPaneSize(stack, s·ratio)`, `setPaneSize(unit, s·(1 − ratio))`, where `s` is the unit's stored size |
| The unit has no stored size but another pane has | nothing; `ratio` is ignored |

---

## Public API

No signature changes. Behaviour changes:

```typescript
class Split {
    /** Now: on a split with no extent, the shares are applied against the first
     *  extent the split gets, before min/max clamping. Clears an undrained
     *  `paneSizes` option. */
    applyPaneRatios(ratios: number[]): this;
}

interface DockSplitOptions {   // Part B: JSDoc only (contract above)
    ratio?: number;
}
```

Removed (`@internal`, Part B): `Split.discardPendingPaneSizes(): this`.

---

## Internal Structure

New private field in `Split`, next to `_lastAvailableMain` ([Split.ts:247](../packages/lib/src/typescript/lib/layout/Split.ts#L247)). It is never written during a `super()` cascade (`Split`'s constructor calls `applyOptions` in its own body), so a plain initializer is correct:

```typescript
// True while `_sizes` holds shares `applyPaneRatios` wrote against a unit
// base, because the container had no main-axis extent yet. The first layout
// with an extent scales them to px before it clamps anything
// (`scaleUnitBaseSizes`); until then a layout leaves them alone.
private _unitBaseSizes: boolean = false;
```

`applyPaneRatios` tail (replaces [:1249–1255](../packages/lib/src/typescript/lib/layout/Split.ts#L1249), from the `forEach` on):

```typescript
components.forEach((component, idx) => {
    this._sizes.set(component, norm[idx] * base);
});

// The latest call wins: an undrained `paneSizes` array would otherwise
// overwrite these shares on the first layout.
this._pendingSizes = null;

if (available > 0) {
    this._lastAvailableMain = available;
    this._unitBaseSizes     = false;
} else {
    this._unitBaseSizes = true;
}

container.scheduleLayout();
```

In `recalculateSizes`, directly after `const horizontal = …` ([:2687](../packages/lib/src/typescript/lib/layout/Split.ts#L2687)) and before the "Seed first-layout panes" comment:

```typescript
// Shares written before the container had an extent are scaled to px
// first, so the clamp below works on real sizes. With no extent yet they
// are left for a later layout (a never-sized box reports no or a NaN size).
if (this._unitBaseSizes) {
    if (!(available > 0)) {
        return;
    }

    this.scaleUnitBaseSizes(components, available);
}
```

New private method, placed after `seedFromPreferred`:

```typescript
/**
 * Scales the shares `applyPaneRatios` stored against a unit base to px of
 * `available`, and records `available` as the extent they were last
 * normalised against — what `applyPaneRatios` does on a container that
 * already has an extent. A pane added since has no stored size and is left
 * for the new-pane share below; a pane removed since was pruned already, and
 * the refill reclaims its share.
 *
 * @param components - The container's current panes.
 * @param available - The main-axis extent the panes share, net of gaps.
 */
private scaleUnitBaseSizes(components: Array<Component>, available: number): void {
    // The unit base sums to 1, so multiplying by the extent converts a share to px.
    for (const component of components) {
        const stored = this._sizes.get(component);

        if (stored !== undefined) {
            this._sizes.set(component, stored * available);
        }
    }

    this._lastAvailableMain = available;
    this._unitBaseSizes     = false;
}
```

`applyPaneSizes` overwrites every pane, so it clears the flag: add `this._unitBaseSizes = false;` directly after its `this._lastAvailableMain = available > 0 ? available : 1;` ([:1374](../packages/lib/src/typescript/lib/layout/Split.ts#L1374)).

Part B, `DockRegion.carveSlot` body (replaces [:616–632](../packages/lib/src/typescript/lib/layout/DockRegion.ts#L616)):

```typescript
private carveSlot(lm: Split, container: Component, unit: Component, stack: Component, ratio: number): void {
    const panes = container.getComponents();

    // No pane has a share yet: the first layout would give every pane an
    // equal one, so carve from that.
    if (panes.every(pane => lm.getPaneSize(pane) === undefined)) {
        const shares = panes.map(() => 1);

        shares[panes.indexOf(stack)] = ratio;
        shares[panes.indexOf(unit)]  = 1 - ratio;

        lm.applyPaneRatios(shares);

        return;
    }

    const unitShare = lm.getPaneSize(unit);

    // The target's group joined in this task without a share: nothing to divide.
    if (unitShare === undefined) {
        return;
    }

    lm.setPaneSize(stack, unitShare * ratio);
    lm.setPaneSize(unit, unitShare * (1 - ratio));
}
```

Part B, wrap branch of `splitOnEdge`, directly after `split.moveComponent(unitPane, leading ? 1 : 0);` ([:545](../packages/lib/src/typescript/lib/layout/DockRegion.ts#L545)):

```typescript
if (options?.ratio !== undefined) {
    (split.getLayoutManager() as Split).applyPaneRatios(leading ? [options.ratio, 1 - options.ratio] : [1 - options.ratio, options.ratio]);
}
```

---

## Ordered Implementation Steps

Work in a worktree branched from `feature/dock-split-ratio-event` (`d73b928b3` or later). Tests first: steps 1 and 6 must show the new cases failing before the code steps.

**Part A — `Split` and the restore**

1. **Write the failing tests.** Add the Split cases S1–S10, the restore cases L1–L5 and the Dock restore case D1 from *Expected Behaviour*. Run `npx vitest run tests/component/layout/Split.test.ts tests/component/layout/LayoutSerialization.test.ts tests/overlay/Dock.lifecycle.test.ts` from `packages/lib`. Check: S1, S3, S4, S6, S9, S10, L1, L2, L3, L5 and D1 fail; S2, S5, S7, S8 and L4 pass already (they pin behaviour that must not change). If the failing set differs, stop and report.
2. **`Split.ts` — field.** Add `_unitBaseSizes` after `_lastAvailableMain` (:247).
3. **`Split.ts` — `applyPaneRatios`.** Replace its tail as in *Internal Structure*. Rewrite its `@remarks` to: "Stored sizes are px, so the ratios are seeded against the container's live net-of-gaps main-axis extent when it has one. A container with no extent yet gets them against a unit base, and the first layout that has an extent scales them to px before it clamps any pane to its minimum or maximum, so the split lays out as though the ratios had been written against that extent. Panes added or removed in between are handled as on a laid-out split. An undrained `paneSizes` option is dropped: the latest call wins."
4. **`Split.ts` — `recalculateSizes` and `applyPaneSizes`.** Add the guarded call after `const horizontal` (:2687), add `scaleUnitBaseSizes` after `seedFromPreferred`, and clear the flag in `applyPaneSizes` (:1374). Update two JSDocs: `getPaneSize` (:880–888) — "`undefined` when the pane has no stored size yet (the split has never been laid out and no ratios were written, or the pane was added since). Before the first layout, a size written by `applyPaneRatios` is a share relative to the other panes, not px."; `getPaneRatios` (:1100–1107) — add "Ratios written by {@link applyPaneRatios} before the first layout are reported as written."
5. **Check Part A.** Re-run step 1's command: all green. Run `npx vitest run tests/component/layout tests/layout tests/overlay`: all green.

**Part B — lift `splitPanel`'s limitation (only if the user confirms)**

6. **Rewrite the Dock tests first.** In `tests/overlay/Dock.splitPanel.test.ts` change R1, R2, R7, R8, R9, R10 and add R11, as in *Expected Behaviour*. In `tests/overlay/Dock.splitResize.test.ts` rewrite N4b. Run both files. Check: R1, R2 (pending `getPaneRatios` / `getLayoutState`), R7, R8, R9, R10 and N4b fail (the wrap's ratio still rides in as `paneSizes`, which `getPaneRatios` does not read); R11 passes already.
7. **`DockRegion.ts` — wrap branch.** Build the wrap split as `new Split({ orientation: axis })`; add the `applyPaneRatios` block after `split.moveComponent(unitPane, …)`; replace the comment above the `new Container` line with "Otherwise wrap the unit in a fresh same-axis Split (a perpendicular drop therefore nests by one level, as intended)." and put "A requested share is written once both panes are in; Split holds it until the new split first has a size." above the new block. Delete `wrapPaneSizes` (:558–577) and the now-unused `import type { LayoutSize }` (:13).
8. **`DockRegion.ts` — insert branch and `carveSlot`.** Replace the comment and `isLaidOut` / `discardPendingPaneSizes` block (:516–524) with `if (options?.ratio !== undefined) { this.carveSlot(containerLm, container, unit, stack, options.ratio); }`, keeping the blank-line convention. Delete `isLaidOut` with its JSDoc (:579–597). Replace `carveSlot`'s body as in *Internal Structure* and its JSDoc with: "Gives the freshly inserted `stack` `ratio` of `unit`'s share of `container`'s `Split`, leaving every other pane's stored share alone. Works whether or not the split has been laid out: before its first layout the shares are relative and Split scales them on that layout. A split with no stored share on any pane counts every pane as an equal share. When `unit` has no share but another pane has — `unit` joined in this task without one — `ratio` is ignored." In `splitOnEdge`'s `@param options` (:465–473) replace "and when the stack joins a same-axis `Split` that has not been laid out, which also drops the shares that split still holds pending, so its panes size as for a drop." with "and when the unit has no share yet in a same-axis `Split` where other panes have one (the unit joined it earlier in the same task without `ratio`)."
9. **`Split.ts` — delete `discardPendingPaneSizes`** (:1381–1396, JSDoc included). In `Dock.ts`, replace the `DockSplitOptions.ratio` JSDoc (:264–281) with the contract text from *Decision awaiting user confirmation*, using `{@link Dock.getLayoutState}` for `getLayoutState()`. Check: `git grep -n "discardPendingPaneSizes\|isLaidOut\|wrapPaneSizes" packages/lib/src` → no matches. Re-run step 6's files: all green.

**Docs and full checks**

10. **Docs.** Make the edits in *Documentation Impact* (Part A's, plus Part B's when confirmed).
11. **Full verification** as in *Verification*, then the manual browser check MV1 (and MV2 with Part B).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/DockRegion.ts` (Part B) |
| Modify | `packages/lib/src/typescript/lib/overlay/Dock.ts` (Part B, JSDoc only) |
| Modify | `packages/lib/tests/component/layout/Split.test.ts` |
| Modify | `packages/lib/tests/component/layout/LayoutSerialization.test.ts` |
| Modify | `packages/lib/tests/overlay/Dock.lifecycle.test.ts` |
| Modify | `packages/lib/tests/overlay/Dock.splitPanel.test.ts` (Part B) |
| Modify | `packages/lib/tests/overlay/Dock.splitResize.test.ts` (Part B) |
| Modify | `packages/lib/docs/layouts/Split.md` |
| Modify | `packages/lib/docs/components/Dock.md` (Part B) |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All cases are offline unit tests unless marked manual. Compare ratios with `toBeCloseTo(x, 3)` unless a case says otherwise; values below are rounded to 3–4 places.

### `Split` — new `describe('Split pane ratios before the first layout')` at the end of `tests/component/layout/Split.test.ts`

Build each host as `const split = new Split({ orientation }); const host = new Container({ layoutManager: split });`, add plain `new Component({})` panes (no `preferredSize`, so nothing is seeded from it), give minimums with `pane.setMinSize({ width, height: 0 })` (horizontal) or `{ width: 0, height }` (vertical), call `applyPaneRatios`, and only then `host.getElement(true); host.setWidth(w); host.setHeight(h); host.doLayout();`. Call `DOM.reset()` in `afterEach`.

| Case | Setup (host size) | Check |
|---|---|---|
| S1 | vertical, mins 24 / 24, `applyPaneRatios([0.8, 0.2])` (300 × 500) | `getPaneRatios()` `[0.8, 0.2]` after `doLayout()` (today `[0.5, 0.5]`) |
| S2 | same as S1, before the host is sized | `getPaneRatios()` `[0.8, 0.2]`; `applyPaneRatios([8, 2])` gives the same |
| S3 | horizontal, mins 0 / 300 / 0, `[0.2, 0.6, 0.2]` (500 × 300) | `[0.2, 0.6, 0.2]`; every pane's `getWidth()` ≥ 99 |
| S4 | equivalence: for each of `{mins [50,100,150], [0.6,0.3,0.1]}`, `{[0,300,0], [0.45,0.45,0.1]}`, `{[100,0], [0.1,0.9]}`, build host A sized and laid out first, then `applyPaneRatios`; host B as above. Lay both out three times (500 × 300) | after each `doLayout()`, B's `getPaneRatios()` equals A's to 6 places (first-pass values: `[0.5,0.25,0.25]`, `[0.3913,0.5217,0.087]`, `[0.1818,0.8182]`) |
| S5 | horizontal, no mins, `[0.7, 0.3]`, then a third pane added before sizing (500 × 300) | `[0.4667, 0.2, 0.3333]` |
| S6 | horizontal, mins 0 / 200, `[0.7, 0.3]`, then a third pane (no min) added before sizing (500 × 300) | B equals host A where the same three steps run on a laid-out host, to 6 places (today B differs) |
| S7 | horizontal, `[0.5, 0.3, 0.2]`, then pane 0 removed with `host.removeComponent` before sizing (500 × 300) | `[0.6, 0.4]` |
| S8 | `console.warn` spied | S5 and S7 warn nothing |
| S9 | horizontal, mins 0 / 0, `new Split({ paneSizes: [{unit:'ratio',value:0.5},{unit:'ratio',value:0.5}] })`, two panes, `applyPaneRatios([0.8, 0.2])`, then a third pane added, before sizing | after `doLayout()`: `getPaneRatios()` `[0.5333, 0.1333, 0.3333]` and `console.warn` not called (today the stale `paneSizes` is applied or discarded with a warning) |
| S10 | vertical, mins 24 / 24, `paneresize` and `panecollapse` spied, `[0.8, 0.2]`, host rendered but **not** sized, `doLayout()`; then sized 300 × 500, `doLayout()` twice | after the unsized pass `getPaneRatios()` still `[0.8, 0.2]`; after sizing `[0.8, 0.2]`; neither listener called |

### `restoreLayout` — new `describe('restoreLayout keeps the ratios of nested splits')` in `tests/component/layout/LayoutSerialization.test.ts`

Harness, as in the probe: a root `Container` with `new Split({ orientation: 'horizontal' })`, rendered and sized 1000 × 600; a nested `Container` with a `Split` holding leaves `n0…`, and a leaf `z` beside it. `root.doLayout()`, then `applyPaneRatios` on the nested split, `root.doLayout()`, `state = serializeLayout(root)`, `restoreLayout(root, state, factory)`, `root.doLayout()`. The nested split is `root.getComponents()[0]` after the restore. The nested split is 500 px along a horizontal axis.

| Case | Nested split | Ratios written | After restore + layout |
|---|---|---|---|
| L1 | vertical, mins 24 / 24 | `[0.8, 0.2]` | `[0.8, 0.2]` (today `[0.5, 0.5]`) |
| L2 | horizontal, mins 50 / 100 / 150 | `[0.5, 0.2, 0.3]` | `[0.5, 0.2, 0.3]` (today `[0.167, 0.333, 0.5]`) |
| L3 | horizontal, mins 0 / 300 / 0 | `[0.2, 0.6, 0.2]` | `[0.2, 0.6, 0.2]`; no pane narrower than 99 px (today two panes under 1 px) |
| L4 | as L1 | `[0.8, 0.2]` | `serializeLayout(root)` straight after `restoreLayout`, before any layout, records `[0.8, 0.2]` for the nested split |
| L5 | vertical, mins 24 / 24 / 24, pane 1 collapsed (`setPaneCollapsedImmediate(1, true)` before saving) | `[0.6, 0.3, 0.1]` | `[0.6, 0.3, 0.1]`, `isPaneCollapsed(1)` true |

### `Dock.setLayoutState` — new `describe('Dock setLayoutState keeps the ratios of nested splits')` at the end of `tests/overlay/Dock.lifecycle.test.ts`

| Case | Setup | Check |
|---|---|---|
| D1 | `installTestDOM(CONFIG); captureRaf();` `new Dock({ layout: { split: 'horizontal', children: [{ tabs: [a] }, { split: 'vertical', children: [{ tabs: [b] }, { tabs: [c] }, { tabs: [d] }] }] } })`, rendered, 800 × 600, `doLayout()`; root `applyPaneRatios([0.3, 0.7])`, nested `applyPaneRatios([0.6, 0.3, 0.1])`, `doLayout()`; `setLayoutState(getLayoutState())`; `doLayout()` | root `[0.3, 0.7]`; nested (`getRootRegion().getComponents()[1]`) `[0.6, 0.3, 0.1]` (today `[⅓, ⅓, ⅓]`) |

### Part B — `tests/overlay/Dock.splitPanel.test.ts` (5-place `expectRatios`, as the file uses)

| Case | Change |
|---|---|
| R1 | Straight after the call read `ratiosOf(root)` (not `getPaneSizes()`) → `[0.75, 0.25]`, and `(dock.getLayoutState().root as SplitNode).ratios` → `[0.75, 0.25]`; after `doLayout()` unchanged. Import `SplitNode` from `~/layout/LayoutSerialization`. Comment: "The new split holds the shares until its first layout, and reports them already." |
| R2 | Same, `[0.25, 0.75]`. |
| R7 | Rename "a second split joining a not-yet-laid-out wrap keeps the wrap's ratio, without a warning". `splitTwice(second: number \| undefined)` makes the first call with `ratio: 0.3` and the second with `ratio: second`. Shape `V[T(a,b),T(d),T(c)]`; `second` undefined → `[0.7·⅔, ⅓, 0.3·⅔]`; `second` 0.5 → `[0.35, 0.35, 0.3]`; `warn` not called. |
| R8 | Rename "a ratio joining a split that was never laid out carves the target's share". With `ratio: 0.4`: `ratiosOf(root)` before `doLayout()` → `[0.3, 0.2, 0.5]`, after → `[0.3, 0.2, 0.5]`; `warn` not called. Drop the comparison with the no-ratio dock. |
| R9 | Rename "a ratio joining a never-laid-out split keeps the carve when a pane has a large minimum width". With `ratio: 0.4`: every share × 800 > 100, and `withRatio[1] / withRatio[0]` ≈ `0.4 / 0.6` (`toBeCloseTo(2 / 3, 5)`). Drop the comparison with the no-ratio dock. |
| R10 | Rename "a ratio joining a split changed since its last layout divides the target's share; the earlier pane still takes its drop share". With `ratio: 0.5` → `[0.3375, 0.3375, 0.25, 0.075]`; without → `[0.25, 0.45, 0.25, 0.05]`. |
| R11 (new) | "a ratio is ignored when the target's group itself joined in this task without one". `regionsDock([['a'], ['b']]); flush();` then `splitPanel('a', spec('c'), 'right')` and `splitPanel('c', spec('d'), 'right', { ratio })`, `doLayout()`. Shape `H[T(a),T(c),T(d),T(b)]`; `ratio: 0.25` and `undefined` both → `[¼, ¼, ¼, ¼]`. |

`tests/overlay/Dock.splitResize.test.ts` N4b ([:381](../packages/lib/tests/overlay/Dock.splitResize.test.ts#L381)): rename "splitPanel whose ratio is still pending fires nothing at the new split's first layout". Replace the two `_pendingSizes` assertions with `expectRatios(ratiosOf(v), [0.75, 0.25])` after `runSweep()`, keeping the wiring check, `doLayout()`, `flush()`, `log` empty and the final ratios.

### Manual (real browser; the offline DOM neither paints nor runs real layout timing)

- **MV1 — restore.** Dev server on a free port from the worktree (`npx vite --port 8031` in `packages/lib`; do not stop any other server). Open the Misc panel → **Dockable layout (Dock)**. Click the *Editor* tab, then **Split down** twice, and drag the new vertical gutters to roughly 60 / 30 / 10. Note each tab group's height (DevTools, `getBoundingClientRect().height` on the three region elements). **Save layout**, drag the gutters elsewhere, **Restore layout**. Pass: each height within 2 px of the noted value. Today they come back equal.
- **MV2 — Part B.** In a fresh window: click *Editor*, then **Split down** (the demo passes `ratio: 0.3`). Pass: the new pane takes 30 % of the column (the browser regression the previous plan hit as 50 / 50) and the console shows no `Split:` warning. Click **Split down** again on the new pane, then **Save layout** and **Restore layout** at once: the heights come back within 2 px. (Two `splitPanel` calls in one task cannot be made from the toolbar; R7 covers that offline.)

---

## Verification

From `packages/lib` in the worktree:

- `npm run typecheck`, `npm run typecheck:test`, `npm run lint` — clean.
- `npx vitest run` — all files pass.
- `npm run docs:api` — zero warnings.
- `npm run docs:llms:check` passes; run `npm run docs:llms` and commit any regenerated `llms.txt`.
- `packages/docs` tests after `npm run build:lib` in the worktree and linking `packages/docs/node_modules/@jimka/typescript-ui` to it.
- Greps: `git grep -n "_unitBaseSizes" packages/lib/src` → the field, `applyPaneRatios`, `applyPaneSizes`, `recalculateSizes`, `scaleUnitBaseSizes`. Part B: `git grep -n "discardPendingPaneSizes\|isLaidOut\|wrapPaneSizes" packages/lib` → none; `git grep -n "laid out since it last changed" packages/lib` → none.
- Callers of changed methods (re-check): `applyPaneRatios` — `LayoutSerialization.populateContainer`, `DockRegion.carveSlot`, `DockRegion.splitOnEdge` (Part B), tests; `setPaneSize` — `applyPaneSizes`, `DockRegion.carveSlot` (Part B), tests. `Accordion` and `Border` use only `SplitGutter`, not `Split`.
- Manual MV1 (and MV2 with Part B).

---

## Documentation Impact

No export changes; `Split` and `Dock` stay on their current pages.

- **`docs/layouts/Split.md`** — after the `getPaneRatios` / `applyPaneRatios` blockquote ([:211](../packages/lib/docs/layouts/Split.md#L211)) add a paragraph: "`applyPaneRatios` works on a split that has not been laid out yet: it holds the ratios and applies them against the split's size on its first layout, before any pane is held to its minimum or maximum, so a restored split lays out as saved. Panes added or removed in between are handled as on a laid-out split, and a later `applyPaneRatios` replaces a `paneSizes` option that has not been applied yet."
- **`docs/components/Dock.md`** (Part B) — in the `splitPanel` bullet ([:191](../packages/lib/docs/components/Dock.md#L191)) replace the sentences from "It applies when the pane wraps…" through "…only after that split's first layout." with: "It applies whether or not the split has been laid out, so several `splitPanel` calls in one task each keep their `ratio`, and `getLayoutState()` reports it straight away. A pane another call in the same task added without a `ratio` takes its drop share from every pane at the next layout; if that pane is the target's group itself, `ratio` is ignored."
- **`DockSplitOptions.ratio` JSDoc** (Part B) — the contract text above.
- **`docs/reference/changelog/next.md`** — keep the page's released order (Breaking changes / Changed / Added / Fixed, then Components / Core / Data / Layouts / Overlay within each):
  - *Fixed → Layouts*, appended at the end: "**`restoreLayout` (and so `Dock.setLayoutState`) restores the saved ratios of nested splits.** `Split.applyPaneRatios` on a split that had not been laid out yet seeded the ratios against a unit base, and the split's first layout raised each pane to its minimum size before scaling them, so they came out in proportion to the minimums: a `Dock`'s stacked tab groups restored at equal heights, and a pane beside one with a large minimum could shrink to under a pixel. The ratios are now held until the split first has a size. A later `applyPaneRatios` also replaces a `paneSizes` option that has not been applied yet."
  - *Added → Overlay* (Part B), the existing `Dock.splitPanel` entry: replace "`ratio` sets the new pane's share of a new split, or of one laid out since it last changed." with "`ratio` sets the new pane's share of the target group's slot." The entry is unreleased, so no *Changed* entry is needed.
- No migration entry: no released contract changes.

---

## Potential Challenges

- **A layout pass with no extent now returns early from `recalculateSizes` while shares are pending.** New panes stay unsized until an extent arrives; `computeMainAxisSizes` already gives every pane 0 at zero extent, so nothing renders differently.
- **The refill can leave a pane below its minimum when the written ratios give it less, and repeated layouts creep toward the minimum** (S4's three passes differ). That is today's behaviour on a laid-out split and stays identical here; S4 pins the equivalence, not a fixed point.[^refill]
- **Part B's R1/R2 now read `getPaneRatios()` before layout.** If they read `getPaneSizes()` instead, they still pass for tab stacks (no `weight: 0` pane), but `getPaneRatios` is what `getLayoutState` uses.

---

## Critical Files

- [`layout/Split.ts`](../packages/lib/src/typescript/lib/layout/Split.ts) — `_pendingSizes` (:220) and `applyPendingSizes` (:2510), the precedent; `_lastAvailableMain` (:247); `setPaneSize` (:873); `getPaneSize` (:889); `getPaneRatios` (:1108); `applyPaneRatios` (:1226); `applyPaneSizes` (:1341); `discardPendingPaneSizes` (:1392); `doLayout`'s `recalculateSizes` / `applyPendingSizes` order (:2282–2283); `recalculateSizes` (:2633).
- [`layout/Accordion.ts`](../packages/lib/src/typescript/lib/layout/Accordion.ts#L1134) — `applySectionSizes`, the second deferral precedent.
- [`layout/LayoutSerialization.ts`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L589) — `populateContainer`.
- [`layout/DockRegion.ts`](../packages/lib/src/typescript/lib/layout/DockRegion.ts#L476) — `splitOnEdge`, `wrapPaneSizes`, `isLaidOut`, `carveSlot`.
- [`overlay/Dock.ts`](../packages/lib/src/typescript/lib/overlay/Dock.ts#L264) — `DockSplitOptions.ratio`.
- [`plans/implemented/dock-programmatic-split.md`](implemented/dock-programmatic-split.md) — *Implementation Notes*: why the workarounds exist (P1, R6–R10).
- `tests/overlay/Dock.splitPanel.test.ts` (R1–R10, :458–685), `tests/overlay/Dock.splitResize.test.ts` (N4b, :381), `tests/component/layout/Split.test.ts` (harness :26–51), `tests/component/layout/LayoutSerialization.test.ts` (harness :1–117).

---

## Non-Goals

- **`applyPaneSizes` on a populated split that has no size yet bends the same way** (probe: `[0.8, 0.2]` with 24 px minimums → `[0.5, 0.5]`). Its documented route for an unsized split is the `paneSizes` option, which is unaffected, and `LayoutSerialization` does not use it. A follow-up can defer it into `_pendingSizes`.
- **A pane added since the last layout reports `0` in `getPaneRatios()` / `getLayoutState()` until the next layout** (e.g. R7's intermediate state `[0.7, 0, 0.3]`). This is today's behaviour on laid-out splits too, not something pending ratios cause.
- **`getPaneSizes()` before the first layout reports a `weight: 0` pane's unit-base share as px.** Unchanged; `LayoutSerialization` uses `getPaneRatios`.
- **The refill's under-minimum result** (see *Potential Challenges*). It is a separate, existing defect of laid-out splits.
- **`Accordion` and `Border`.** Neither uses `Split` or `applyPaneRatios`; `Accordion.applySectionSizes` already defers to its first layout.

---

## Notes

[^probe-restore]: A throwaway vitest file in a worktree at `8bdf42ac7` built a laid-out root split (1000 × 600) holding a nested split and a leaf, wrote ratios on the nested split, laid out, serialized, restored, and laid out twice. The table's "saved" column is what `serializeLayout` recorded, which for the minimum-width rows already reflects the laid-out refill (see [^refill]). The Dock row used `new Dock({ layout })` at 800 × 600 and `setLayoutState(getLayoutState())`; the root split came back `[0.3, 0.7]` as saved. The mechanism: the unit base stores `[0.6, 0.3, 0.1]` px, `clampMain` raises each to the 24 px strip minimum, and the resize block then spreads the remaining extent by those now-equal sizes.

[^part-a-alone]: With only the `Split.ts` change applied (the prototype left out the `_pendingSizes = null` line, which no existing caller reaches: `carveSlot` only writes into laid-out splits, whose `paneSizes` has drained, and `populateContainer` builds its splits without one), `isLaidOut` still routes an insert into an unsized split to `discardPendingPaneSizes`, and the wrap still uses `paneSizes`, so Part B's tests keep their current meaning and pass. The prototype run covered 125 files in `tests/component/layout`, `tests/layout` and `tests/overlay`.

[^lift-evidence]: Measured with the Part A prototype plus the Part B `DockRegion` changes, offline, against `8bdf42ac7`. The same run failed exactly R7, R8, R9, R10 (asserting the old contract) and N4b (asserting `_pendingSizes`), and passed every other test in the three directories; no `console.warn` was raised by any lift case. Why recommend it: the workarounds exist only because of the bug Part A fixes. `isLaidOut` duplicates `applyPaneRatios`' own extent test, `discardPendingPaneSizes` is an `@internal` seam whose one job is to stop a stale `paneSizes` array from warning, and the wrap's `paneSizes` route is what makes that array stale in the first place. With Part A, the original design (`applyPaneRatios` on the wrap, a carve on the insert) works, and two calls in one task — *Split Editor Down* twice, a script laying out several panes — keep what the caller asked for. The remaining exception (R11) is one where no share exists to divide.

[^why-in-sizes]: The deferred value has to be a per-pane share, read by `getPaneRatios` (and so `getLayoutState`), `getPaneSize` (which `carveSlot` reads), and moved by `transferPaneSize` when `DockRegion` wraps a pane. `_sizes` already does all of that and is already keyed by pane, so a pane added or removed in between needs no matching rule. The bug is only the order in `recalculateSizes`: it clamps unit-base values as if they were px. Scaling first fixes the order without touching the clamp path a live min/max change relies on.

[^precedent]: `_pendingSizes` is an index-ordered array applied after `recalculateSizes`, and a pane-count mismatch discards it with a `console.warn` ([Split.ts:1358–1362](../packages/lib/src/typescript/lib/layout/Split.ts#L1358)). Copying that shape for ratios was rejected: an index array goes stale whenever a pane is inserted (every `DockRegion` insert does), and its answer — discard and warn — is exactly the stray warning this plan must avoid. It would also need `getPaneRatios`, `getPaneSize` and `transferPaneSize` to consult a second store. The plan keeps the precedent's essentials — hold the value, apply it on the first layout that can resolve it, emit no event — and keys it by pane.

[^equivalence]: On a laid-out split `applyPaneRatios` stores `ratio × E` and sets `_lastAvailableMain = E`; the next `recalculateSizes` skips both the resize block (`available === _lastAvailableMain`) and the first-layout slack block (`_lastAvailableMain !== 0`), then seeds new panes, clamps, assigns new-pane shares and refills. `scaleUnitBaseSizes` leaves `_sizes` and `_lastAvailableMain` in the same state, so the remaining steps are byte-for-byte the laid-out path. The prototype confirmed equal results to 4 places over three consecutive layouts for every minimum-width case tried, and identical heights for a restored split with a collapsed pane. Multiplying by `available` rather than renormalising over the surviving panes is what keeps a removed pane's case identical: the refill reclaims the freed share the same way it does on a laid-out split, `weight: 0` pins included.

[^latest-wins]: Before this plan the drain ran after the ratios and overwrote them, so an earlier option beat a later explicit call, and `getPaneSizes()` kept reporting the stale array. No library code combines the two today (Part B removes the only `paneSizes` writer in `DockRegion`), so the change only affects a consumer who does both before the first layout.

[^wrap-via-ratios]: The previous plan moved the wrap to `paneSizes` only because `applyPaneRatios` bent on the unsized wrap (its MV2: 50/50 and 0.966/0.034 in the browser). With Part A that reason is gone. Keeping `paneSizes` would leave the second-join case (R7) holding an index array that the insert makes stale, which brings back either the warning or the `discardPendingPaneSizes` seam.

[^carve]: Dividing the target's own stored size touches only the two panes involved, so it works in px and in the unit base alike, keeps `Σ` unchanged, and leaves an unsized pane from an earlier call to take its drop share at the next layout. Writing every pane through `applyPaneRatios` — what `carveSlot` did — needs a share for every pane, which is why the old code had to return early or flatten (the round-3 audit finding `[0.167, 0.167, 0.333, 0.333]`). The equal-share branch applies only when no pane has a stored size: a never-laid-out split with no ratios written, where Dock's tab stacks (no preferred size) are divided equally by the first layout anyway.

[^refill]: The refill scales every flexible pane by `available / Σ` after the clamp, including the pane just raised to its minimum, so a pane can end below its minimum and creep up over later layouts (`[0.5, 0.25, 0.25]` → `[0.476, 0.238, 0.286]` → `[0.47, 0.235, 0.296]` for minimums 50 / 100 / 150 in 500 px). This happens on a laid-out split with or without this plan.

## Implementation Notes

- **Scope.** The user confirmed Part B, so both parts are implemented. Part A
  and Part B ship as two code commits (the Split fix stands alone; the Dock
  lift builds on it), each with its own documentation commit.
- **Red phases matched the plan exactly.** Step 1 failed S1, S3, S4, S6, S9,
  S10, L1, L2, L3, L5 and D1, and passed S2, S5, S7, S8 and L4. Step 6 failed
  R1, R2, R7, R8, R9, R10 and N4b, and passed R11.
- **Cited line numbers had drifted** after the stacked Dock teardown and
  `serializeLayout` changes; every edit was located by content and the code
  matched the plan's description, so no deviation was needed.
- **R8 also checks `getLayoutState()` before layout,** beside `ratiosOf`, so
  the JSDoc's "reports it straight away" is covered for an insert as well as
  a wrap (R1/R2).
- **`next.md`.** The *Fixed → Layouts* section already existed (from the
  stacked branches); the new entry is appended at its end. The existing
  *Added → Overlay* `splitPanel` entry was edited in place. No headings were
  added.
- **Docs package not rebuilt/tested:** the docs edits change prose only, no
  links. `docs:api` reported zero warnings and `docs:llms:check` passed with
  no regeneration needed.
- **Manual checks (Chrome, own dev server on port 8032, stopped afterwards).**
  MV2: *Editor* → **Split down** gave the editor column 275 / 118 px (new pane
  30 %), with no console warning; a second **Split down** then **Save** +
  **Restore** at once kept 267 / 79 / 47 → 266 / 79 / 48 px. MV1 in a fresh
  window: *Editor* → **Split down** twice, **Save**, **Restore**: same heights
  within 1 px, no warnings. The gutter drag to 60 / 30 / 10 and the
  drag-elsewhere-before-restore steps were **not** done (no reliable gutter
  drag through the MCP); the split-produced 68 / 20 / 12 arrangement was used
  instead.
- **Unrelated observation, not investigated:** after any **Restore layout**
  in that demo (even with no splits at all) the *VBox* tab's panel parent
  reports a 678 px height instead of 393 px. It does not involve a nested
  split or `applyPaneRatios` on an unsized split, so it is outside this plan;
  whether it predates this branch was not checked.
- **Audit fixes, folded into their commits.** The public `ratio` contract
  (`DockSplitOptions.ratio`, the Dock page, both commit messages) now states
  `carveSlot`'s equal-share branch: in a split where no pane has a share yet
  (a `new Dock({ layout })` neither laid out nor restored, or a split an
  earlier call made without a `ratio` — probed: a wrap then a `0.25` join gave
  `[0.5, 0.375, 0.125]`), `ratio` carves the target's equal share; R12 pins
  the auditor's probe (`[⅓, ¼, 1/12, ⅓]` against `[¼, ¼, ¼, ¼]`).
  `setPaneSize` / `getPaneSize` JSDoc and the Split page's methods table now
  say the value is a share while `applyPaneRatios`' shares are pending, and
  `recalculateSizes`' JSDoc names the early return and the scale-before-clamp
  step. The Split page no longer claims a restored split always lays out as
  saved. S11 (max clamp, `weight: 0` pin, pin with a min, max beside a pin)
  and N4b's new `_unitBaseSizes` check were added after the fix, so they
  passed on first run here; S11 pins the fix itself, though: the round-2
  audit ran it on the base branch, where it fails (0.5 against 0.2857 in the
  max case).
