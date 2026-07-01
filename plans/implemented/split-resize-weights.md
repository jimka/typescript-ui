# Split Resize Weights — Implementation Plan

## Overview

`Split` distributes the main-axis extent among its panes from a per-pane stored px size map (`_sizes`). When the container's main-axis extent changes (a viewport resize, a host re-layout), [`recalculateSizes`](src/typescript/lib/layout/Split.ts#L1041) rescales **every** stored pane size by the same factor `available / _lastAvailableMain` ([Split.ts:1079-1090](src/typescript/lib/layout/Split.ts#L1079)), so all panes grow/shrink proportionally and keep filling the container. `_lastAvailableMain` ([Split.ts:59-64](src/typescript/lib/layout/Split.ts#L59)) is the net-of-gutters extent the stored sizes were last normalised against.

This plan replaces that *proportional rescale* with a **weighted redistribution**: each pane carries a resize weight, and when the available extent changes by Δ, Δ is distributed across the panes in proportion to their weights — a pane with weight `0` keeps its px size (does not move on a viewport resize); positive-weight panes absorb the delta. The motivating use case is an app shell with a fixed west pane (weight 0) and an absorbing center pane (weight 1): resizing the window only grows/shrinks the center.

The change is confined to **container-resize redistribution** inside `recalculateSizes`. The **gutter-drag** path ([`onDragStart`](src/typescript/lib/layout/Split.ts#L523) / [`onDrag`](src/typescript/lib/layout/Split.ts#L556)) is independent — it mutates `_sizes` for the two adjacent panes directly and never consults `_lastAvailableMain` — and keeps its current behaviour untouched. The weight is a *resize-distribution policy* separate from the *current* sizes that `_sizes` / [`getPaneRatios`](src/typescript/lib/layout/Split.ts#L342) / [`applyPaneRatios`](src/typescript/lib/layout/Split.ts#L445) model.

---

## Architecture Decisions

### Default weight preserves today's proportional behaviour (option a)

A pane with **no explicitly-set weight defaults to its own current stored size** at redistribution time. When *no* pane has an explicit weight, every weight equals its current size, so the delta is split in proportion to current size — which is algebraically identical to today's uniform-factor rescale (`new = old + Δ · old/Σold = old · (Σold+Δ)/Σold = old · factor`). Existing `Split` consumers (`SplitPanel`, both Dock split-region builders, `LayoutSerialization` restore) get the same geometry on resize (algebraically identical; within float tolerance, the level `Split.test.ts` already asserts at via `toBeCloseTo`); only an explicit weight override (e.g. `0`) changes anything. This is the option the brief prefers ("preserve current behaviour unless a weight is explicitly set") and it keeps the existing [`Split.test.ts`](tests/component/layout/Split.test.ts) ratio assertions green without modification.

Rejected: defaulting all weights equal (delta split equally) — it silently changes every existing Split's resize behaviour, breaking Dock's tiled regions (which today rescale proportionally) and the `applyPaneRatios`-seeded restore path.

### Weight lives in a dedicated `Map<Component, number>`, parallel to `_sizes` / `_collapsed`

The backing store is `private _weights: Map<Component, number>`, mirroring the existing `_sizes` and `_collapsed` maps exactly: same key type (the pane `Component`), same lifecycle hooks. An *unset* entry means "default to current size" (the back-compat path above); an entry of `0` is a real, explicit "do not move". Because absence and `0` mean different things, the map stores only explicitly-set weights and `recalculateSizes` falls back to the pane's stored size for any pane absent from the map.

Rejected: reusing the existing `LayoutConstraints.weight` field ([LayoutConstraints.ts:56](src/typescript/lib/layout/LayoutConstraints.ts#L56)). That field is HBox/VBox's *extra-space distribution* weight and is read by those managers ([HBox.ts:435](src/typescript/lib/layout/HBox.ts#L435), [VBox.ts:387](src/typescript/lib/layout/VBox.ts#L387)); Split ignores it today. Adopting it would (1) conflate a constraint that already has a different cross-manager meaning, (2) make `weight` unset≡`0` (constraints default `?? 0`), which collides with the "unset = default to size" semantics above, and (3) bake the policy into the re-homeable constraint bag, where a Dock tear-off would carry an HBox-shaped weight into a Split. A dedicated map keyed on the pane, drained the same way `_sizes` is, is the consistent choice.

**Post-implementation amendment.** By explicit user decision, `LayoutConstraints.weight` *is* additionally read by Split as the declarative construction-time surface — `addComponent(pane, { weight: 0 })` pins a pane. The three objections were addressed rather than ignored: (2) Split reads the **raw** optional field (`undefined` when unset, since the class default is `undefined`; only HBox/VBox add `?? 0`), so an unset pane still falls through to its stored size — the "unset = default to size" semantics is preserved; (1)/(3) the cross-manager conflation is accepted as a known future-only risk (a blast-radius sweep found **no** existing Split pane carries a `weight` constraint), consistent with the precedent of other manager-specific constraint fields (`collapseDirection` → Split only, `collapsible` → Border only). The `_weights` map + `setPaneResizeWeight` remains as the runtime override, resolving ahead of the constraint: `_weights.get(c) ?? constraints?.weight ?? storedSize`.

### Lifecycle: drain dead panes, default new panes, transfer on slot swap

`recalculateSizes` already prunes `_sizes`/`_collapsed` for panes that left the container ([Split.ts:1058-1063](src/typescript/lib/layout/Split.ts#L1058)); `_weights` is pruned by a **separate** pass over `[...this._weights.keys()]` immediately after, because `setPaneResizeWeight` can register a weight for a pane that has no `_sizes` entry yet — such a pane is invisible to the `_sizes`-keyed loop and would otherwise leak on removal (`_collapsed` survives that loop only because it is never set for a sizeless pane). A pane added after construction has no `_weights` entry and therefore defaults to its current size (back-compat) until a caller sets one — no special-casing needed. [`transferPaneSize`](src/typescript/lib/layout/Split.ts#L313) (slot-swap for nested-Split wrapping / single-pane hoist) moves the `_weights` entry alongside `_sizes`/`_collapsed`, so a wrapped pane keeps its resize policy.

### Interaction with collapse

A collapsed pane is excluded from the displayed layout in `computeMainAxisSizes`/`doLayout`, but its `_sizes` entry is **frozen** for a later restore (see the `_collapsed` field doc at [Split.ts:44-47](src/typescript/lib/layout/Split.ts#L44) and the [computeMainAxisSizes](src/typescript/lib/layout/Split.ts#L981) block comment at [Split.ts:1007-1017](src/typescript/lib/layout/Split.ts#L1007)). The new redistribution lives in `recalculateSizes`, which runs on the *full* child list and is concerned only with keeping `Σ _sizes == available` across extent changes — it does not know about collapse (that substitution happens later in `computeMainAxisSizes`). Redistributing the delta across a collapsed pane's frozen size by weight is harmless: the frozen size is what it restores to, and `computeMainAxisSizes` re-derives the displayed sizes from `_sizes` against the live extent regardless. So a collapsed pane's weight does not fight the strip — its slot is reclaimed by `computeMainAxisSizes`'s `factor`, exactly as today. No collapse-specific branch is added.

### Interaction with `applyPaneRatios` / serialization

`applyPaneRatios` seeds `_sizes` and resets `_lastAvailableMain` to its base so the next layout does not double-rescale ([Split.ts:445-479](src/typescript/lib/layout/Split.ts#L445)). It does **not** touch `_weights` — ratios model *current sizes*, weights model *resize policy*, and the two are independent by design. `getPaneRatios` ([Split.ts:342](src/typescript/lib/layout/Split.ts#L342)) likewise reads only `_sizes`. Layout save/restore ([`SplitNode`](src/typescript/lib/layout/LayoutSerialization.ts#L70)) therefore round-trips unchanged. **Serializing weights is a Non-Goal** (see below): the only consumer of weights is the app shell, which sets them imperatively at build time, and `SplitNode` has no weight field today — adding one is out of scope.

---

## Public API

New accessor/setter pair on `Split`, mirroring [`setPaneSize`](src/typescript/lib/layout/Split.ts#L282) / [`getPaneSize`](src/typescript/lib/layout/Split.ts#L297):

```typescript
/** Sets a pane's container-resize weight. 0 pins the pane's px size on resize;
 *  a positive weight absorbs the delta in proportion to the other panes' weights.
 *  A pane with no weight set defaults to its current size (today's proportional rescale). */
setPaneResizeWeight(pane: Component, weight: number): this;

/** Returns a pane's explicitly-set resize weight, or undefined when unset
 *  (the pane defaults to its current size on resize). */
getPaneResizeWeight(pane: Component): number | undefined;
```

Backing field: `private _weights: Map<Component, number> = new Map<Component, number>();` (a plain `new`-initialised map like `_sizes` / `_collapsed` — not a cascade-dispatched options field, so no `declare` needed).

No `SplitOptions` field is added. A construction-time bag (like `collapsedPanes`, which takes *indices*) would need pane-index → weight resolution deferred to first layout, adding a `_pendingWeights` drain for a single known consumer that sets weights imperatively against pane references it already holds. Per *Simplicity First*, the setter is the whole surface; revisit an options field only if a real construction-time need appears.

---

## Internal Structure

The redistribution replaces the uniform-factor block at [Split.ts:1079-1090](src/typescript/lib/layout/Split.ts#L1079). Sketch (delta = `available - _lastAvailableMain`):

```typescript
if (this._lastAvailableMain > 0 && available > 0 && available !== this._lastAvailableMain && this._sizes.size > 0) {
    const delta = available - this._lastAvailableMain;

    // Effective weight per pane: explicit weight, else its current stored size
    // (so an all-unset Split splits the delta proportionally to size == today's rescale).
    let weightSum = 0;
    for (const component of components) {
        weightSum += this._weights.get(component) ?? (this._sizes.get(component) ?? 0);
    }

    if (weightSum > 0) {
        for (const component of components) {
            const stored = this._sizes.get(component);
            if (stored === undefined) continue;
            const weight = this._weights.get(component) ?? stored;
            this._sizes.set(component, Math.max(0, stored + delta * (weight / weightSum)));
        }
    }
}
```

The trailing `Σ == available` refill normaliser at [Split.ts:1142-1159](src/typescript/lib/layout/Split.ts#L1142) stays as-is — it corrects any residual drift (e.g. a pane clamped at `0` shrink) back to the exact available extent. **Note** that refill is a *uniform* re-scale, so after a weight-0 pane is pinned, a subsequent refill could nudge it; the refill only fires when `storedTotal !== available`, and the weighted block already lands the sum on `available` exactly when no pane clamps, so the common case is a no-op. The shrink-past-min / clamp-to-0 edge is called out under *Potential Challenges*.

`_lastAvailableMain` continues to be updated to `available` at the end of `recalculateSizes` ([Split.ts:1165-1167](src/typescript/lib/layout/Split.ts#L1165)) exactly as today — it is the delta baseline for the next resize.

---

## Ordered Implementation Steps

1. **Add the backing map.** In `Split` add `private _weights: Map<Component, number> = new Map<Component, number>();` next to `_collapsed` ([Split.ts:48](src/typescript/lib/layout/Split.ts#L48)).
2. **Add the accessor/setter** `setPaneResizeWeight` / `getPaneResizeWeight` next to `setPaneSize`/`getPaneSize` ([Split.ts:282-299](src/typescript/lib/layout/Split.ts#L282)), with JSDoc per *Public API*.
3. **Transfer on slot swap.** In [`transferPaneSize`](src/typescript/lib/layout/Split.ts#L313) move the `_weights` entry from `from` to `to` alongside the `_collapsed` move (mirror the existing `collapsed` block at [Split.ts:323-328](src/typescript/lib/layout/Split.ts#L323)).
4. **Prune dead panes.** `_weights` cannot ride the existing `_sizes` removal loop ([Split.ts:1058-1063](src/typescript/lib/layout/Split.ts#L1058)): that loop iterates `[...this._sizes.keys()]`, and `setPaneResizeWeight` writes `_weights` independently of `_sizes`, so a pane carrying a weight but no stored size is never visited and its entry would leak on removal (`_collapsed` is safe in that loop only because it is never set for a sizeless pane). Add a **separate** prune pass right after the `_sizes` loop, iterating `_weights`' own keys — `for (let pane of [...this._weights.keys()]) { if (components.indexOf(pane) < 0) this._weights.delete(pane); }`.
5. **Replace the rescale with weighted redistribution.** Swap the uniform-factor block ([Split.ts:1079-1090](src/typescript/lib/layout/Split.ts#L1079)) for the delta-by-weight block in *Internal Structure*. Leave the guard condition, the new-pane refill steps, the trailing `Σ == available` normaliser, and the `_lastAvailableMain` update unchanged.
6. **Verify gutter-drag untouched.** Read `onDrag`/`onDragStart` ([Split.ts:523-594](src/typescript/lib/layout/Split.ts#L523)) and confirm no reference to `_weights` or `_lastAvailableMain` was added — drag semantics must be identical.
7. **Tests.** Extend [`Split.test.ts`](tests/component/layout/Split.test.ts) per *Expected Behaviour* (resize the host container, assert pane px sizes / ratios).
8. **Regression checkpoint.** `grep -rn "constraints.weight\|\.weight" src/typescript/lib/layout/Split.ts` — expect zero matches (we did not touch the HBox/VBox constraint). Run the full `Split.test.ts` suite — the unmodified existing assertions must stay green.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/Split.ts` |
| Modify | `tests/component/layout/Split.test.ts` |

---

## Expected Behaviour

Split geometry is modelled offline — the existing test hosts a Split in a `Container`, sets width/height, and asserts `getPaneRatios`. The same harness (resize the host, then read `getPaneSize` per pane) exercises every weighted case below. **All of these are unit-testable** unless marked manual.

To read absolute px in a test, host a Split with N panes, lay it out at a known width, set explicit `_sizes` via `setPaneSize` (or seed via `applyPaneRatios`), set weights via `setPaneResizeWeight`, then change the host width and read `getPaneSize(pane)`. The weighted redistribution only runs inside `recalculateSizes`, which fires on a layout pass — so each resize step must force a synchronous `host.doLayout()` between setting the new width and asserting (mirror the sibling pattern at [Grid.test.ts:114](tests/component/layout/Grid.test.ts#L114)); without it the assertion reads stale sizes and silently no-ops. Net main extent = `width − insets − gutterTotal(N)` (one `GUTTER_SIZE`=4 px gutter between each pair).

- **Default (no weights set) preserves today's proportional rescale.** Two panes at 100/200 px; grow available by 90 → 130/260 (each scaled ×1.3). This must match the current uniform-factor result — pin it against a pre-change baseline computed from the existing algorithm, asserting with `toBeCloseTo` (the two formulas are algebraically equal but not bit-identical in floating point).
- **Weight 0 pins a pane on grow.** Panes A (weight 0) and B (weight 1) at 100/200; grow available by +90 → A stays 100, B → 290.
- **Weight 0 pins a pane on shrink.** Same setup; shrink available by −60 → A stays 100, B → 140.
- **Positive weights split the delta in proportion.**
  - weights 0:1 → only the second pane moves (covered above).
  - weights 1:1 → +80 delta splits equally (+40 / +40).
  - weights 1:3 → +80 delta splits a quarter / three-quarters (+20 / +60).
- **Mixed explicit + unset.** Pane A weight 0 (explicit), pane B unset → B defaults to its size and absorbs the whole delta (degenerates to the 0:size case).
- **All weights 0 degrades to proportional rescale.** Both panes weight 0 (nothing can absorb the delta); grow the container → `weightSum == 0`, the weighted block is skipped by its `if (weightSum > 0)` guard, and the trailing `Σ == available` refill uniformly rescales both panes. Assert the result is identical to the default (no-weights) proportional case — the pins cancel because the delta has nowhere to go. Two panes at 100/200, grow available by 90 → 130/260 (same as the default case).
- **Composition with a collapsed pane.** Three panes, middle collapsed; grow the container → the collapsed pane's frozen `_sizes` entry is redistributed by weight but the *displayed* layout still shows the strip + two expanded panes filling the extent (assert via `getPaneRatios` on the expanded panes and `isPaneCollapsed(middle) === true`). Manual-verify the visual strip geometry.
- **Shrink past a pinned pane's room (clamp).** Weight-0 pane at 300 px in a container shrunk so available < 300 → the pinned pane cannot exceed the extent; assert it clamps to ≥ 0 and the `Σ == available` refill restores the invariant (no negative size, no overflow stranding). Document the exact clamp outcome the implementation lands on.
- **Manual-verify:** the live viewport drag of the browser window and the visual result (west pane fixed, center absorbing) in the running app — geometry is modelled offline but the real resize event + paint are not.

---

## Verification

- **Typecheck:** `npm run build` (or the project's tsc step) — zero errors.
- **Unit tests:** `npx vitest run tests/component/layout/Split.test.ts` — the new weighted cases pass and the existing orientation / ratio / collapse assertions stay green.
- **Grep invariants:**
  - `grep -n "_weights" src/typescript/lib/layout/Split.ts` — appears in the field decl, the two accessors, `transferPaneSize`, the dedicated prune pass, and the redistribution block (no other sites).
  - `grep -n "_weights\|_lastAvailableMain" ` inside `onDrag`/`onDragStart` — expect zero (drag path unchanged).
- **Manual smoke:** run the app (`npm run dev`, http://localhost:8015), open the **Split** demo tab (`SplitPanel`, registered in [main.ts:44](src/typescript/main.ts#L44)). With default panes confirm resizing the window still rescales proportionally (no regression). Then, in a scratch panel or via DevTools, set one pane's weight to 0 and confirm a window resize leaves that pane's px fixed while the others absorb the delta.

---

## Documentation Impact

`setPaneResizeWeight` / `getPaneResizeWeight` are new public methods on the `Split` callable, exported through the `~/layout` barrel (same export as `Split` today). They carry JSDoc and surface on the generated `Split` API page automatically (TypeDoc picks up public methods). No new doc page, sidebar, or catalog entry is required; no renames or removals, so no cross-reference sweep. Run `npm run docs:build` after adding the JSDoc — it must finish with zero warnings (per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), JSDoc may only `{@link}` other public symbols — link `setPaneSize` if at all, never the private `_weights` / `recalculateSizes`).

---

## Potential Challenges

- **Weight-0 pane in a too-small container.** When the available extent shrinks below a pinned pane's px, the pane cannot keep its full size without overflowing. The weighted block + the trailing `Σ == available` refill resolve this (the refill rescales everything to fit), but the *pinned* pane will then move slightly — pure pinning is only achievable while the container is large enough. Mitigation: accept this as correct (geometry must fill the container); document it in the shrink-clamp test and the method JSDoc.
- **`weightSum === 0`.** If every pane has explicit weight 0 (all pinned) the delta has nowhere to go; guard with `if (weightSum > 0)` and fall through to the `Σ == available` refill, which fills the container uniformly — the only sane outcome when nothing wants the delta. Mitigation: the guard in *Internal Structure* already handles it.
- **Float drift across many resizes.** Repeated weighted deltas can accumulate sub-pixel error; the existing `Σ == available` refill renormalises each pass, bounding drift. Mitigation: none needed — the refill already exists and runs every layout.

---

## Critical Files

- [`src/typescript/lib/layout/Split.ts`](src/typescript/lib/layout/Split.ts) — the manager; all changes land here. Read `recalculateSizes`, `computeMainAxisSizes`, `onDrag`/`onDragStart`, `_sizes`/`_collapsed`/`_lastAvailableMain`, `setPaneSize`/`getPaneSize`, `transferPaneSize`, `getPaneRatios`/`applyPaneRatios`.
- [`tests/component/layout/Split.test.ts`](tests/component/layout/Split.test.ts) — the offline test pattern (`installTestDOM`, `hostSplit`, host width/height, assert ratios) to extend.
- [`src/typescript/lib/layout/LayoutSerialization.ts`](src/typescript/lib/layout/LayoutSerialization.ts) — `SplitNode` + `populateContainer` restore; confirms weights are not serialized and `applyPaneRatios` restore is unaffected.
- [`src/typescript/lib/overlay/Dock.ts`](src/typescript/lib/overlay/Dock.ts) (`new Split` at line 578) and [`src/typescript/lib/layout/DockRegion.ts`](src/typescript/lib/layout/DockRegion.ts) (`new Split` at line 445) — the consumers that rely on the default proportional rescale; the default-weight decision keeps them unchanged.
- [`src/typescript/lib/layout/LayoutConstraints.ts`](src/typescript/lib/layout/LayoutConstraints.ts) — the existing `weight` constraint we deliberately do **not** reuse.

---

## Non-Goals

- **Serializing resize weights** in `SplitNode` / `LayoutSerialization`. Weights are an imperative build-time policy for the app shell; no current consumer persists them. Adding a `weights` array to `SplitNode` is out of scope.
- **A `SplitOptions.resizeWeights` construction-time field.** Deferred — the imperative setter covers the known consumer; an index-keyed options bag (à la `collapsedPanes`) is unjustified for one caller that holds pane references.
- **Changing gutter-drag semantics.** The drag path keeps clamping the adjacent pair against their minimums and conserving their combined size; weights do not enter it.
- **The sqladmin app shell adoption** (switching its west/center from `Border` to a weighted `Split` with the west pane at weight 0, integrating with the activity bar's own collapse). That is downstream application work in a different repo; this library plan only provides the weighted-resize capability it consumes.
