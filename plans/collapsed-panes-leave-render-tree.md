---
depends-on: [undisplay-inactive-tab-pages]
---

# Collapsed Panes and Regions Leave the Render Tree — Implementation Plan

## Overview

`Split` and `Border` collapse a pane or edge region by clipping it away with CSS `clip-path` while leaving its full-size box in the render tree — [`layout/Split.ts:1739`](packages/lib/src/typescript/lib/layout/Split.ts#L1739)'s `placeGutterAsStrip` keeps a collapsed pane at its full stored size and only clips it, and [`layout/Border.ts:496`](packages/lib/src/typescript/lib/layout/Border.ts#L496)'s comment says the same: "the region stays visible and laid out at full size." A subtree that stays in the render tree while visually hidden costs an engine style-recalc and layout pass on every frame an ancestor resizes, proven in WebKitGTK for the sibling problem `undisplay-inactive-tab-pages.md` fixes (ten hidden `Tab` pages: 170.3 ms/frame; `display: none` on them: 92.1 ms) but **not yet measured for the collapsed-pane case** — Verification below adds that measurement.

This plan takes a collapsed pane or region's *content* out of the render tree with `Component.setDisplayed(false)` once its collapse animation settles, and puts it back before the next expand animation starts. It does not touch the pane/region component itself — only its direct children — because `getLaidOutComponents()` ([`core/Component.ts:6899`](packages/lib/src/typescript/lib/core/Component.ts#L6899)) already treats an undisplayed *pane* as absent from the split/region entirely (no strip, no gutter), which is a different, pre-existing, consumer-facing feature this plan must not disturb. See `## Architecture Decisions` for why that rules out the sibling plan's page-level approach.

Both managers gain the same shape of change: a small "hide/show this pane's content" pair of private helpers, wired into the existing collapse toggle (`Split.setPaneCollapsed` / `Border.setRegionCollapsed`), the non-animated toggle (`Split.setPaneCollapsedImmediate`), and the construction-time pending-collapse path (`Split.applyPendingCollapsed`) — all three are real, currently-used call sites, confirmed in Loom's `EditorShell.ts` (construction-time `collapsedPanes`) and SQLAdmin's `QueryPanel.ts` / `DefinitionPanel.ts` (`setPaneCollapsedImmediate`, construction-time `collapsedPanes`).

---

## Architecture Decisions

### The undisplay targets a pane/region's children, not the pane/region itself

`Split.setPaneCollapsed` and `Border.setRegionCollapsed` never call `setDisplayed(false)` on the collapsed pane/region component. They call it on each of that component's own direct children instead, leaving the pane/region itself displayed, sized, and positioned exactly as today (full stored size, clip-path applied).[^why-not-pane-level]

### Split and Border now own the displayed state of a collapsed pane/region's direct children

The two managers write `setDisplayed(false)` / `setDisplayed(true)` on a collapsed pane/region's direct children and nothing else touches that state for those children while the pane/region is under this manager's control. This mirrors `undisplay-inactive-tab-pages.md`'s "Tab and Card own the displayed state" decision, one level down: a consumer that separately called `setDisplayed(false)` on one of those specific children has that decision overwritten the next time the pane/region cycles through collapse/expand.[^ownership-split]

### The undisplay lands in the collapse animation's completion callback; the redisplay lands synchronously before the expand animation starts

This follows the codebase's existing pattern for deferring a display change to an animation's end: [`overlay/AbstractWindow.ts:1277`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1277)'s rail-minimize path calls `this.setDisplayed(false)` only inside `animateRailCollapse`'s completion callback, and calls `this.setDisplayed(true)` synchronously at [`AbstractWindow.ts:1235`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1235), before the reverse animation (`animateRailExpand`) starts — the same "show before you reveal, hide after you finish hiding" shape `AnimatedDropdown.hideAnimated`'s `finalize` callback uses ([`core/AnimatedDropdown.ts:249`](packages/lib/src/typescript/lib/core/AnimatedDropdown.ts#L249)).

Concretely: `setPaneCollapsed(index, false)` / `setRegionCollapsed(placement, false)` redisplay the pane/region's children at the top of the method, before `runCollapse` is called — `runCollapse`'s own `container.doLayout()` call (inside [`layout/CollapseSupport.ts:475`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L475)) must see displayed children so it lays them out at their real expanded size, and every animation frame after that re-lays the pane/region out (`commitRect`'s `relayout: true` branch) — content that stayed undisplayed through the first frame would never appear. `setPaneCollapsed(index, true)` / `setRegionCollapsed(placement, true)` undisplay children only in `runCollapse`'s `onIdle` callback, after the animation's last frame has already committed the pane/region's final, fully-clipped geometry.[^collapse-sequencing]

### A settle reconciles every collapsible pane/region, not just the one that was toggled

`Split._collapseAnimation` and `Border._collapseAnimation` are single fields shared across every pane/region a manager owns — `runCollapse`'s `previous?.()` cancels whichever geometry animation is in flight, for *any* pane, the moment a different pane is toggled. `CollapseAnimationTeardown.test.ts:151` ("still clears the first pane's transition when a different pane is toggled") already exercises this: collapse pane 0, then collapse pane 2 before pane 0 settles. Pane 0's own `onIdle` never fires, so a per-pane closure that only undisplays *its own* pane would leave pane 0's children permanently displayed.

Both managers gain a `reconcileCollapsedContent` sweep that checks every collapsible pane/region against its own `_collapsed` flag and undisplays any that are collapsed but not yet undisplayed — called from every settle (so the pane whose animation actually completes catches its superseded siblings too) and from the end of every `doLayout` while idle (so a non-animated toggle, or a construction-time collapsed pane, is caught even with no animation to settle).[^reconcile-sweep]

### Border's settle reuses its existing `doLayout` call; Split's does not

`Border.setRegionCollapsed`'s `onIdle` already calls `container.doLayout()` when it settles (existing code, to restore the CENTER region's steady-state clip frame — see [`Border.ts:1130`](packages/lib/src/typescript/lib/layout/Border.ts#L1130)), so wiring the reconcile sweep into the tail of `Border.doLayout()` makes that existing call cover both cases with no second call site. `Split.setPaneCollapsed`'s `onIdle` has no such call today, and adding one purely for this would be an unrelated, unnecessary extra relayout — so `Split`'s `onIdle` calls `reconcileCollapsedContent` directly instead.

### A collapsed pane/region's own reported size stays exactly as it was before it collapsed

`Split.getPreferredSize()` / `getMinSize()` and `Border.getPreferredSize()` / `getMinSize()` / `computeTotalMinSize()` ask a collapsed pane/region for its own `getPreferredSize()` / `getMinSize()` — today, live, on the assumption its content is still there. Once that content is undisplayed, the same live call would report whatever a now-childless container reports (typically near-zero, absent an explicit `minSize`/`preferredSize` constraint), silently changing a value nothing about "leaving the render tree" should change. Each manager snapshots a pane/region's `getPreferredSize()` / `getMinSize()` the moment before undisplaying its children, and every size-reporting method that would otherwise read that pane/region live reads the snapshot instead while it stays undisplayed.[^size-snapshot]

### Accordion is out of scope

`layout/Accordion.ts:1670` (`header.setDisplayed(false); wrapper.setDisplayed(false);`) already removes a collapsed section from the render tree — it is the cited precedent `undisplay-inactive-tab-pages.md` and this plan both point to, not a second instance of the problem. Accordion has no gutter-strip / clip-path-reveal mechanic (a collapsed section is not reserved a strip the way a `Split` pane or `Border` region is), so it never entered the "full-size box, clipped away" state this plan fixes.

### `Component.captureSubtreeScroll` / `restoreSubtreeScroll` are reused unmodified

Both come from `undisplay-inactive-tab-pages.md`, `@internal public` on `Component`. `Split`/`Border` call `pane.captureSubtreeScroll()` on the pane/region itself (not per-child) right before undisplaying its children — the walk recurses through `getComponents()` regardless of displayed state, so it captures every scrollable descendant's offset in one call, the same way `Tab`/`Card` call it on a whole page. No widening is needed: the hooks already walk from any node, and a pane/region is just another node.

---

## Internal Structure

### `Split` — new fields (near the existing `_collapsed` / `_collapseAnimation` fields, [`Split.ts:127`](packages/lib/src/typescript/lib/layout/Split.ts#L127) / [`Split.ts:178`](packages/lib/src/typescript/lib/layout/Split.ts#L178))

```typescript
// Snapshot of a collapsed pane's own preferred/min size, taken the instant
// before its content is undisplayed. Substituted for a live query in every
// size-reporting method below so a now-childless pane's own getPreferredSize()/
// getMinSize() cannot silently change what the split reports while collapsed.
// Presence of an entry also doubles as "this pane's content is undisplayed".
private readonly _undisplayedPaneContent: Map<Component, { preferred: Size | null; min: Size | null }> = new Map();

// Panes whose content was just redisplayed and are awaiting a scroll restore
// once their post-expand geometry is final. Drained by reconcileCollapsedContent.
private readonly _pendingScrollRestore: Set<Component> = new Set();
```

### `Split` — the hide/show/reconcile helpers (new private methods, placed after `setPaneCollapsed`)

```typescript
/**
 * Snapshots a collapsed pane's own size and native scroll offsets, then
 * removes its content from the render tree. Idempotent — a pane whose
 * content is already undisplayed is left untouched.
 */
private undisplayPaneContent(pane: Component): void {
    if (this._undisplayedPaneContent.has(pane)) {
        return;
    }

    pane.captureSubtreeScroll();
    this._undisplayedPaneContent.set(pane, { preferred: pane.getPreferredSize(), min: pane.getMinSize() });

    for (const child of pane.getComponents()) {
        child.setDisplayed(false);
    }
}

/**
 * Restores a collapsed pane's content to the render tree. Scroll is not
 * reapplied here — it needs this pane's post-expand geometry, which only
 * exists once the pane's layout settles — so the pane is queued instead.
 * Idempotent — a pane whose content is already displayed is left untouched.
 */
private redisplayPaneContent(pane: Component): void {
    if (!this._undisplayedPaneContent.has(pane)) {
        return;
    }

    this._undisplayedPaneContent.delete(pane);

    for (const child of pane.getComponents()) {
        child.setDisplayed(true);
    }

    this._pendingScrollRestore.add(pane);
}

/**
 * Settles both halves of the collapsed-content bookkeeping. Restores scroll
 * for any pane whose expand reached its final geometry (skipping one that was
 * re-collapsed before that happened); undisplays the content of any pane that
 * is collapsed but not yet undisplayed, including a sibling whose own
 * collapse animation was superseded before it settled (see
 * CollapseAnimationTeardown.test.ts's "still clears the first pane's
 * transition when a different pane is toggled"). Cheap and side-effect-free
 * when there is nothing to reconcile.
 *
 * @param components - The container's current laid-out panes.
 */
private reconcileCollapsedContent(components: Array<Component>): void {
    for (const pane of this._pendingScrollRestore) {
        if (!(this._collapsed.get(pane) ?? false)) {
            pane.restoreSubtreeScroll();
        }
    }
    this._pendingScrollRestore.clear();

    for (const pane of components) {
        if (this._collapsed.get(pane) ?? false) {
            this.undisplayPaneContent(pane);
        }
    }
}
```

### `Border` — the mirrored fields and helpers, keyed by `Placement`

```typescript
// Mirrors Split's _undisplayedPaneContent, keyed by Placement to match
// _collapsed / _collapsible / _gutters.
private readonly _undisplayedRegionContent: Map<Placement, { preferred: Size | null; min: Size | null }> = new Map();
private readonly _pendingScrollRestore: Set<Placement> = new Set();
```

```typescript
private undisplayRegionContent(placement: Placement, component: Component): void {
    if (this._undisplayedRegionContent.has(placement)) {
        return;
    }

    component.captureSubtreeScroll();
    this._undisplayedRegionContent.set(placement, { preferred: component.getPreferredSize(), min: component.getMinSize() });

    for (const child of component.getComponents()) {
        child.setDisplayed(false);
    }
}

private redisplayRegionContent(placement: Placement, component: Component): void {
    if (!this._undisplayedRegionContent.has(placement)) {
        return;
    }

    this._undisplayedRegionContent.delete(placement);

    for (const child of component.getComponents()) {
        child.setDisplayed(true);
    }

    this._pendingScrollRestore.add(placement);
}

/** Mirrors Split.reconcileCollapsedContent over the four collapsible edges. */
private reconcileCollapsedRegions(): void {
    for (const placement of this._pendingScrollRestore) {
        if (!this.isRegionCollapsed(placement)) {
            this.getRegionComponent(placement)?.restoreSubtreeScroll();
        }
    }
    this._pendingScrollRestore.clear();

    for (const placement of [Placement.NORTH, Placement.SOUTH, Placement.WEST, Placement.EAST]) {
        const component = this.getRegionComponent(placement);

        if (component && this.isRegionCollapsed(placement)) {
            this.undisplayRegionContent(placement, component);
        }
    }
}

/** Substituted for a live `component.getPreferredSize()` wherever a region may be collapsed-and-undisplayed. */
private regionPreferredSize(placement: Placement, component: Component): Size | null {
    return this._undisplayedRegionContent.get(placement)?.preferred ?? component.getPreferredSize();
}

/** Substituted for a live `component.getMinSize()` wherever a region may be collapsed-and-undisplayed. */
private regionMinSize(placement: Placement, component: Component): Size | null {
    return this._undisplayedRegionContent.get(placement)?.min ?? component.getMinSize();
}
```

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/layout/Split.ts`** — add the two new fields from `## Internal Structure` near [`Split.ts:186`](packages/lib/src/typescript/lib/layout/Split.ts#L186) (just after `_pendingCollapseTransitions`), and the three new private methods (`undisplayPaneContent`, `redisplayPaneContent`, `reconcileCollapsedContent`) immediately after `setPaneCollapsed` (after line 452).
   *Check:* `npm run typecheck` passes with the new methods unused (verified once steps 2–6 wire them in).

2. **`Split.setPaneCollapsed`** ([`Split.ts:414`](packages/lib/src/typescript/lib/layout/Split.ts#L414)) — after the existing `if (current === collapsed) { return this; }` guard and before `this._collapsed.set(pane, collapsed);`, add:
   ```typescript
   if (!collapsed) {
       this.redisplayPaneContent(pane);
   }
   ```
   Replace the `onIdle` callback body (currently just `this._collapseAnimation = null;`) with:
   ```typescript
   this._collapseAnimation = null;
   this.reconcileCollapsedContent(components);
   ```

3. **`Split.setPaneCollapsedImmediate`** ([`Split.ts:955`](packages/lib/src/typescript/lib/layout/Split.ts#L955)) — after the existing `paneServingGutter` guard and before `this._collapsed.set(pane, collapsed);`, add:
   ```typescript
   if (collapsed) {
       this.undisplayPaneContent(pane);
   } else {
       this.redisplayPaneContent(pane);
   }
   ```

4. **`Split.applyPendingCollapsed`** ([`Split.ts:1833`](packages/lib/src/typescript/lib/layout/Split.ts#L1833)) — inside the loop, after `this._collapsed.set(pane, true);`, add `this.undisplayPaneContent(pane);`. This handles a pane collapsed from construction (`collapsedPanes` option) before it is ever displayed — confirmed live in Loom's `EditorShell.ts:208` and SQLAdmin's `DefinitionPanel.ts:89`.

5. **`Split.doLayout`** ([`Split.ts:1543`](packages/lib/src/typescript/lib/layout/Split.ts#L1543)) — after the existing trailing gutter-hide loop (ends at [`Split.ts:1721`](packages/lib/src/typescript/lib/layout/Split.ts#L1721)), add:
   ```typescript
   if (this._collapseAnimation === null) {
       this.reconcileCollapsedContent(components);
   }
   ```
   This is the non-animated catch-all: `setPaneCollapsedImmediate` already handles its own pane synchronously (step 3), but this also catches any pane whose collapsing animation's `onIdle` was itself superseded and never got a chance to run `reconcileCollapsedContent` — the next ordinary layout (any resize) sweeps it up. Guarded by `_collapseAnimation === null` so it never runs mid-animation, when children must stay displayed.

6. **`Split.getPreferredSize` / `getMinSize`** ([`Split.ts:729`](packages/lib/src/typescript/lib/layout/Split.ts#L729) / [`Split.ts:740`](packages/lib/src/typescript/lib/layout/Split.ts#L740)) — change the `computeContentSize` callback in each from a bare accessor to a snapshot-aware one:
   ```typescript
   getPreferredSize(): Size | null {
       return this.computeContentSize(component =>
           this._undisplayedPaneContent.get(component)?.preferred ?? component.getPreferredSize());
   }

   getMinSize(): Size | null {
       return this.computeContentSize(component =>
           this._undisplayedPaneContent.get(component)?.min ?? component.getMinSize());
   }
   ```
   `computeContentSize` itself (lines 770–800) is unchanged.

7. **`Split.computeTotalMinSize`** ([`Split.ts:1483`](packages/lib/src/typescript/lib/layout/Split.ts#L1483)) — the cross-axis read at [`Split.ts:1526`](packages/lib/src/typescript/lib/layout/Split.ts#L1526) (`const min = component.getMinSize();`) becomes:
   ```typescript
   const min = this._undisplayedPaneContent.get(component)?.min ?? component.getMinSize();
   ```
   The main-axis `stored`/`COLLAPSE_STRIP_SIZE` branch above it is unchanged — it already special-cases collapsed panes correctly.

8. **`Split.recalculateSizes`** ([`Split.ts:1923`](packages/lib/src/typescript/lib/layout/Split.ts#L1923)) — extend the existing stale-pane pruning loop (currently `this._sizes.delete(pane); this._collapsed.delete(pane);` at [`Split.ts:1940`](packages/lib/src/typescript/lib/layout/Split.ts#L1940)) to also `this._undisplayedPaneContent.delete(pane); this._pendingScrollRestore.delete(pane);`, so a pane removed from the container while collapsed-and-undisplayed does not leak, and so a *different* component later occupying the same slot never inherits its stale entry (it can't — the map is keyed by the removed Component reference — but the pruning keeps the map from growing unboundedly across repeated add/remove cycles).

9. **`Split.transferPaneSize`** ([`Split.ts:664`](packages/lib/src/typescript/lib/layout/Split.ts#L664)) — after the existing `_collapsed` transfer block (lines 674–679), add the matching transfer:
   ```typescript
   const undisplayed = this._undisplayedPaneContent.get(from);

   if (undisplayed !== undefined) {
       this._undisplayedPaneContent.set(to, undisplayed);
       this._undisplayedPaneContent.delete(from);
   }
   ```
   Without this, a pane swapped into the same slot mid-collapse (the scenario this method exists for) would report `isPaneCollapsed() === true` (transferred) while its own content stayed fully displayed (not transferred) — an inconsistent state no doLayout pass would ever correct, since `reconcileCollapsedContent` only *adds* missing undisplay, it never associates a stale entry with a new key.
   *Check:* `grep -n 'this\._collapsed\.' packages/lib/src/typescript/lib/layout/Split.ts` — every hit near a `_sizes`/`_weights` transfer or prune site has a matching `_undisplayedPaneContent` line adjacent (steps 8–9).

10. **`packages/lib/src/typescript/lib/layout/Border.ts`** — add the two new fields and four new private methods from `## Internal Structure` near [`Border.ts:99`](packages/lib/src/typescript/lib/layout/Border.ts#L99) (fields) and after `setRegionCollapsed` (methods, after line 327).

11. **`Border.setRegionCollapsed`** ([`Border.ts:263`](packages/lib/src/typescript/lib/layout/Border.ts#L263)) — after the existing `if (current === collapsed) { return this; }` guard and before `const container = this.getContainer();`, add:
    ```typescript
    if (!collapsed) {
        this.redisplayRegionContent(placement, component);
    }
    ```
    The `onIdle` callback already calls `container.doLayout()` when it settles ([`Border.ts:323`](packages/lib/src/typescript/lib/layout/Border.ts#L323)) — no new call is added there; step 14 makes that existing `doLayout()` call reconcile.

12. **`Border.getPreferredSize`** ([`Border.ts:557`](packages/lib/src/typescript/lib/layout/Border.ts#L557)) and **`Border.getMinSize`** ([`Border.ts:639`](packages/lib/src/typescript/lib/layout/Border.ts#L639)) — in both methods, replace each of the four `let size = <region>.getPreferredSize();` / `let size = <region>.getMinSize();` lines (north/south/west/east — center is never collapsible, leave it untouched) with the matching helper call, e.g. `let size = this.regionPreferredSize(Placement.NORTH, north);` / `let size = this.regionMinSize(Placement.NORTH, north);`. Eight call sites total (four regions × two methods).

13. **`Border.computeTotalMinSize`** ([`Border.ts:788`](packages/lib/src/typescript/lib/layout/Border.ts#L788)) — the five one-line reads at [`Border.ts:796`](packages/lib/src/typescript/lib/layout/Border.ts#L796)–800 each split into a `laidOut` resolve plus a snapshot-aware size read. For example, line 796 (`const westMin = this.laidOut(this._westComponent)?.getMinSize();`) becomes:
   ```typescript
   const west    = this.laidOut(this._westComponent);
   const westMin = west ? this.regionMinSize(Placement.WEST, west) : undefined;
   ```
   Mirror this for `northMin`/`southMin`/`eastMin` (using `regionMinSize(Placement.NORTH, north)` etc.); `centerMin` (line 797) is unchanged — CENTER is never collapsible, so it stays a plain `this.laidOut(this._centerComponent)?.getMinSize()`. Every later use of `westMin`/`northMin`/`southMin`/`eastMin` in this method (the `hContribs`/`vContribs` pushes and the `width = Math.max(...)` calls) is unchanged — only how each variable is computed changes.

14. **`Border.doLayout`** ([`Border.ts:874`](packages/lib/src/typescript/lib/layout/Border.ts#L874)) — at the very end of the method, after the existing CENTER block (ends at [`Border.ts:1137`](packages/lib/src/typescript/lib/layout/Border.ts#L1137)), add:
    ```typescript
    if (!this._collapsing) {
        this.reconcileCollapsedRegions();
    }
    ```

15. **`Border.setLayoutConstraints` / `delLayoutConstraints`** ([`Border.ts:137`](packages/lib/src/typescript/lib/layout/Border.ts#L137) / [`Border.ts:186`](packages/lib/src/typescript/lib/layout/Border.ts#L186)) — when a placement's component is being replaced or removed, also clear `this._undisplayedRegionContent.delete(placement); this._pendingScrollRestore.delete(placement);`, so a different component later placed in the same edge never inherits a stale snapshot keyed by that `Placement`. Add this at the point each method resolves which placement is changing (the existing `switch (constraints.placement)` in `setLayoutConstraints`, the existing `if (this._northComponent === component) { ... }` chain in `delLayoutConstraints`).
    *Check:* `npm run typecheck` passes.

16. **Tests** — three changes:
    - Create `packages/lib/tests/component/layout/Split.collapseUndisplay.test.ts`, covering cases 1–3, 5–11, and 18 (everything except the sibling-supersession case 4).
    - Create `packages/lib/tests/component/layout/Border.collapseUndisplay.test.ts`, covering cases 12, 14–17, and 19 (everything except the sibling-supersession case 13).
    - Modify `packages/lib/tests/component/layout/CollapseAnimationTeardown.test.ts`: extend the existing Split test `'still clears the first pane's transition when a different pane is toggled'` (line 151) with the case-4 assertions (pane 0's children undisplayed once pane 2's animation settles), and add a new test to the existing `describe('Border', ...)` block, mirroring that Split test's shape (collapse WEST, collapse EAST before WEST settles, advance past the fallback, assert WEST's children are undisplayed too) for case 13.

    Both new files follow `CollapseAnimationTeardown.test.ts`'s `installTestDOM(CONFIG)` / `vi.useFakeTimers()` / `vi.advanceTimersByTime(...)` setup for the animated cases (`transitionend` never fires offline, so completion is always reached through the fallback timer). For the reduced-motion case (18), mock `Animation.isReducedMotion` directly (`vi.spyOn(Animation, 'isReducedMotion').mockReturnValue(true)`) — the modelled `TestDOM.matchMedia` always reports `matches: false` ([`tests/dom/TestDOM.ts:1262`](packages/lib/tests/dom/TestDOM.ts#L1262)), so there is no config-level way to force it.

17. **Docs** — add the note described in `## Documentation Impact`.

18. Run the full verification list in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Border.ts` |
| Create | `packages/lib/tests/component/layout/Split.collapseUndisplay.test.ts` |
| Create | `packages/lib/tests/component/layout/Border.collapseUndisplay.test.ts` |
| Modify | `packages/lib/tests/component/layout/CollapseAnimationTeardown.test.ts` |
| Modify | `packages/lib/docs/concepts/performance.md` |

---

## Expected Behaviour

All cases are unit-testable against the modelled test DOM unless marked **manual**. "Content" below means a pane/region's direct children (`getComponents()`), not the pane/region itself.

### `Split`

1. After `setPaneCollapsed(0, true)` and letting its fallback timer settle (`vi.advanceTimersByTime(240)`), pane 0's direct children each report `isDisplayed() === false`; pane 0 itself still reports `isDisplayed() === true` and is still present in `container.getLaidOutComponents()`.
2. During the animation (before the fallback timer fires), pane 0's children still report `isDisplayed() === true` — the undisplay lands only after settle, not at the moment `setPaneCollapsed` is called.
3. `setPaneCollapsed(0, false)` on an already-settled-collapsed pane 0 makes its children report `isDisplayed() === true` **synchronously**, before any timer advances.
4. Collapsing pane 0 then collapsing pane 2 before pane 0 settles (mirroring `CollapseAnimationTeardown.test.ts`'s existing "still clears the first pane's transition" case), then letting pane 2's animation settle: pane 0's children are undisplayed too, once pane 2's `onIdle` runs its `reconcileCollapsedContent` sweep.
5. A pane holding a `Panel({ autoScroll: 'auto' })` scrolled to `scrollTop: 40`, collapsed and settled, then expanded and settled: `panel.getScrollTop() === 40` after the expand settles.
6. `setPaneCollapsedImmediate(0, true)` undisplays pane 0's children synchronously, with no animation and no timer advance needed.
7. A pane collapsed via the `collapsedPanes` construction option has its children undisplayed after the container's first `doLayout()`, with no `setPaneCollapsed` call ever made.
8. `getPreferredSize()` / `getMinSize()`, read while a pane is collapsed and its children undisplayed, report the same values they reported the instant before it collapsed (captured against a pane holding a component with a known non-trivial preferred/min size).
9. `revealDescendant(target)`, where `target` sits inside a collapsed pane's undisplayed content, expands that pane and leaves `target`'s ancestor chain fully displayed synchronously, before `revealDescendant` returns.
10. `transferPaneSize` moves a collapsed-and-undisplayed pane's snapshot to the replacement component: after the transfer, the replacement reports `isPaneCollapsed() === true` and, once collapsed content is queried, its own children (not the original's) are the ones affected.
11. **Manual** — collapsing and expanding a pane still shows the same clip-path reveal/retreat animation, the gutter still cross-fades into its opaque strip, and the chevron still points the right way.

### `Border`

12. After `setRegionCollapsed(Placement.WEST, true)` settles, the west region's direct children report `isDisplayed() === false`; the region component itself stays `isDisplayed() === true` and still receives its full-size `placeComponent` + `applyRegionClip` treatment on the next `doLayout`.
13. Collapsing WEST then EAST before WEST settles, then letting EAST's animation settle (mirroring the analogous `Split` case): WEST's children are undisplayed too, via the same `container.doLayout()` call EAST's `onIdle` already makes.
14. `setRegionCollapsed(Placement.NORTH, false)` on a settled-collapsed NORTH redisplays its children synchronously.
15. `getPreferredSize()` / `getMinSize()` / `computeTotalMinSize()` report the same values for a collapsed-and-undisplayed region as they did the instant before it collapsed, on both the main axis (already substituting `COLLAPSE_STRIP_SIZE` when collapsed) and the cross axis this plan newly guards.
16. Replacing WEST's component via `setLayoutConstraints` while WEST is collapsed-and-undisplayed leaves no stale entry for `Placement.WEST` — the new component starts fully displayed and not collapsed.
17. **Manual** — collapsing and expanding a region still shows the same clip-path reveal/retreat, the CENTER region still grows into the reclaimed space during the animation and returns to its clip-framed steady state after.

### Reduced motion

18. **`Split`** — with `Animation.isReducedMotion()` mocked `true`, `setPaneCollapsed(0, true)` undisplays pane 0's children synchronously, in the same call, with no timer advance.
19. **`Border`** — with `Animation.isReducedMotion()` mocked `true`, `setRegionCollapsed(Placement.WEST, true)` undisplays WEST's children synchronously, in the same call, with no timer advance.

---

## Verification

1. `npm run typecheck`
2. `npm run lint`
3. `npm run test`, with attention to:
   - `packages/lib/tests/component/layout/Split.collapseUndisplay.test.ts` (cases 1–3, 5–11, 18)
   - `packages/lib/tests/component/layout/Border.collapseUndisplay.test.ts` (cases 12, 14–17, 19)
   - `packages/lib/tests/component/layout/CollapseAnimationTeardown.test.ts` (extended per step 16, cases 4 and 13) and its pre-existing tests, which must keep passing
   - the existing `packages/lib/tests/component/layout/Split.test.ts` and `Border.test.ts` — untouched by this plan, but exercise `isPaneCollapsed`/`setPaneCollapsedImmediate`/`getMaxSize`/etc. call paths this change alters internally, so a regression here would surface first
4. `grep -n 'setDisplayed' packages/lib/src/typescript/lib/layout/Split.ts packages/lib/src/typescript/lib/layout/Border.ts` — every hit is inside `undisplayPaneContent`/`redisplayPaneContent` (Split) or `undisplayRegionContent`/`redisplayRegionContent` (Border); none targets the pane/region component itself.
5. `npm run build:lib`
6. **WebKitGTK collapse-drag harness.** This is the first measurement of the collapsed-pane case (the sibling plan's numbers are for `Tab`, not `Split`/`Border`). Add a collapse step to the harness at `/tmp/claude-1000/-home-jika-typescript-loom/830a3250-2ae3-4aa7-9de8-6a3af9d923eb/scratchpad/qa-harness.ts`: with the Loom sidebar (`Split` pane 0, ten file-tree entries or equivalent bulk content) collapsed via the explorer toggle, drive the same gutter-drag measurement the sibling plan's harness already runs, before and after this change, built via `npm run build:lib` in this worktree with Loom's `node_modules/@jimka/typescript-ui` symlink repointed at it. Record `drag.avgMs` collapsed-before vs collapsed-after; expect a drop toward the already-measured one-tab-equivalent baseline (no heavy hidden subtree in the render tree), not a specific number — this plan's target is "collapsed costs about what expanded-and-empty costs," to be pinned once the before number exists.
7. **Manual smoke tests** — the cases marked **manual** in `## Expected Behaviour`, plus: Loom's sidebar collapse/expand (Ctrl/Cmd+B or the rail toggle) with the file tree populated and scrolled; SQLAdmin's `QueryPanel` — collapse the results pane, run a query, expand it again, confirm the grid renders and any prior scroll position is preserved; SQLAdmin's `DefinitionPanel` — reload with a persisted collapsed pane and confirm it opens correctly on first expand.

---

## Documentation Impact

No public API changes — every new field and method is `private`. One prose addition:

- `packages/lib/docs/concepts/performance.md` — extend the `## Inactive tab and card pages leave the render tree` section the sibling plan adds (or add a sibling `## Collapsed panes and regions leave the render tree` section if that one hasn't landed the same way) stating that a collapsed `Split` pane / `Border` region removes its own content from the render tree the same way, while the pane/region's own box (and its collapse animation) stays exactly as before.

---

## Potential Challenges

- **A pane/region whose direct child is itself a self-virtualizing widget** (a `List`/`Tree`/`FileTree` used directly as a pane, with no wrapping `Container`) has its *own* internal children undisplayed/redisplayed by this change, which could race a widget that independently manages some of its own children's displayed state (row virtualization). Mitigation: this is the same accepted ownership trade the sibling plan already makes at the `Tab`/`Card` level, one layer down — flag it in the changelog; the common shape (Loom's `explorer`, SQLAdmin's dock panes) always wraps heavy content in a plain `Container`, so its direct children are inert.
- **`Border`'s shared `_collapseAnimation` across all four edges** means two edges collapsing in quick succession share one animation slot — already true today for CSS-transition cleanup (`CollapseAnimationTeardown.test.ts`); this plan's `reconcileCollapsedRegions` sweep is what keeps the undisplay side correct under the same sharing, per case 13.
- **`Component.setDisplayed`'s effective-visibility reconcile is rAF-coalesced** ([`Component.ts:261`](packages/lib/src/typescript/lib/core/Component.ts#L261)), so `Panel.onEffectiveVisibilityChange` / `CodeEditor.onEffectiveVisibilityChange` (from the sibling plan) fire one frame after a pane/region's content is undisplayed, not synchronously. This is pre-existing coalescing behaviour the sibling plan already accepts for `Tab`/`Card`; nothing here needs to force a synchronous flush.

---

## Critical Files

| File | Why the implementer must read it |
|---|---|
| `packages/lib/src/typescript/lib/layout/CollapseSupport.ts` (whole file, 485 lines) | `runCollapse`/`primeCollapse`/`animateLayout` — the shared animation driver both managers call; the exact point `onIdle` fires (`animateLayout`'s last frame, or synchronously under reduced motion) is what step 2/11's timing depends on. |
| `packages/lib/src/typescript/lib/layout/Split.ts` (lines 116–200, 333–530, 900–1000, 1360–1460, 1470–1810, 1920–1960) | Every method this plan touches, plus `getLaidOutComponents`-dependent neighbours (`paneServingGutter`, `computeMainAxisSizes`) that must keep seeing the pane, not its content. |
| `packages/lib/src/typescript/lib/layout/Border.ts` (whole file, 1250 lines) | Small enough to read entire; `laidOut()` (line 548) is the existing "undisplayed pane component = absent" rule this plan must not trigger at the pane/region level. |
| `packages/lib/src/typescript/lib/core/Component.ts` (lines 2280–2440, 6880–6902) | `setDisplayed`/`isDisplayed`, the effective-visibility reconcile, and `getLaidOutComponents`'s displayed-filter — the mechanism this plan deliberately does *not* invoke on the pane/region itself. |
| `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` (lines 1219–1300) | The precedent for deferring a display change to an animation's completion callback, and applying the reverse synchronously before the reveal animation starts. |
| `plans/undisplay-inactive-tab-pages.md` | `captureSubtreeScroll`/`restoreSubtreeScroll`'s exact contract and the effective-visibility hooks this plan reuses without modification. |
| `packages/lib/tests/component/layout/CollapseAnimationTeardown.test.ts` | The existing test shape for driving `runCollapse` through vitest fake timers, and the exact sibling-supersession scenario `reconcileCollapsedContent`/`reconcileCollapsedRegions` must handle. |

---

## Non-Goals

- **Accordion.** Already undisplays its collapsed sections' content; not a second instance of this problem.
- **Unmounting a collapsed pane/region's content**, as opposed to undisplaying it. Same reasoning as the sibling plan: unmounting drops focus, selection, and live third-party state, and this plan's mechanism already gets the full per-frame cost win.
- **Changing the collapse/expand animation itself** — clip-path keyframes, gutter cross-fade, chevron direction, strip sizing. All untouched; this plan only changes what happens to a pane/region's content once the animation is not running.
- **The WebKit stylesheet-rule restyle hazard** the sibling plan already ruled out as a cause. Untouched here.
- **A collapsed pane/region's own `getMaxSize()`.** Left reading live: an inflated max (a now-childless container commonly reports a larger or unbounded max than it did with content) never over-constrains a layout, unlike an under-reported min/preferred — see `## Architecture Decisions`.

---

## Notes

[^why-not-pane-level]: `getLaidOutComponents()` ([`Component.ts:6899`](packages/lib/src/typescript/lib/core/Component.ts#L6899)) filters to `isDisplayed()` children, and both managers already document the consequence for a non-displayed *pane/region component*: `Split.doLayout`'s own comment says "a non-displayed pane (and its gutter) drops out entirely, neighbours reflowing to fill" ([`Split.ts:1568`](packages/lib/src/typescript/lib/layout/Split.ts#L1568)), and `Border.laidOut`'s JSDoc says "a non-displayed region component is treated as an empty slot (`null`)... the same outcome as removing it from the region" ([`Border.ts:539`](packages/lib/src/typescript/lib/layout/Border.ts#L539)) — used throughout `getPreferredSize`/`getMinSize`/`getMaxSize`/`computeTotalMinSize`/`doLayout`. This is a real, pre-existing, consumer-facing feature (a consumer's own `setDisplayed(false)` on a pane already removes it from the split with no strip and no gutter), not an incidental implementation detail. Collapsing a pane must keep its strip, its gutter, and (for `Split`) its position in the index-addressed `components` array that `isPaneCollapsed(index)`/`setPaneCollapsed(index, ...)` key off of — `getLaidOutComponents()[index]` would silently resolve to the wrong pane the moment any earlier pane's component itself went `isDisplayed() === false`. Undisplaying only the content one level down never touches `isDisplayed()` on the pane/region component, so none of this is disturbed.

[^ownership-split]: Before this plan, nothing but a consumer ever calls `setDisplayed`/`setVisible` on a pane/region's *children* — `Split`/`Border` only ever touch the pane/region component's own geometry and clip-path. So, unlike `Tab`/`Card` (which already fully owned `visible` before the sibling plan and gained `displayed` too), this is the first time either manager reaches one level into a pane/region's own children. The trade is the same shape as the sibling plan accepts for `Tab`/`Card`'s pages, just one level deeper: a consumer that had independently undisplayed one of those specific children for its own reasons has that decision overwritten on the next collapse/expand cycle. This is narrow in practice — the common case wraps heavy pane/region content in a plain, inert `Container` (confirmed in Loom's `explorer` and SQLAdmin's dock panes) whose direct children are not independently managed by anything.

[^collapse-sequencing]: Traced through `CollapseSupport.runCollapse`: `container.doLayout()` (line 475) computes the pane/region's *end* geometry once, synchronously, before any animation frame runs — this is the layout pass that must see the pane/region's children already displayed on an expand, or they get no box and nothing to reveal for the whole animation. `animateLayout` then rolls every mover back to its *start* geometry synchronously (so the just-written end state never paints) and drives the interpolation via `requestAnimationFrame`, calling `commitRect(..., relayout: true)` — and so `component.doLayout()` — on the pane/region every frame; `onComplete` (the caller's `onIdle`) fires only once `progress >= 1`, i.e. after the pane/region's *final* geometry has already been committed. Undisplaying content there is therefore always safe: the pane/region's own box needs no further layout once collapsed. Under `Animation.isReducedMotion()`, `animateLayout` commits every mover straight to `end` and calls `onComplete` synchronously, inline — the same code path, just with `onIdle` (and therefore the undisplay) firing before `runCollapse` returns instead of ~200 ms later.

[^reconcile-sweep]: The sweep is deliberately unconditional on *which* pane's animation settled — `reconcileCollapsedContent`/`reconcileCollapsedRegions` re-check every collapsible pane/region's own `_collapsed` flag against whether its content is already undisplayed, rather than trusting the specific `pane`/`placement` closed over by the settling call. This is what makes it correct under `CollapseAnimationTeardown.test.ts`'s existing "toggle a different pane before the first settles" scenario: whichever animation actually reaches `onIdle` performs a full reconciliation, so a superseded sibling's un-fired `onIdle` is not a permanent leak — it is caught by the next settle (of any pane) or the next idle `doLayout` (any resize). The scroll-restore half of the sweep has the same shape for the opposite reason: a pane's own expand-completion callback might never fire (superseded before settling), but since its content was already redisplayed synchronously at call time (not deferred), the only thing genuinely missed is the scroll reapply — parked in `_pendingScrollRestore` and drained by whichever settle or idle `doLayout` runs next, skipped entirely if the pane was re-collapsed in the meantime (nothing to restore into a subtree about to be undisplayed again).

[^size-snapshot]: Checked against every live read in scope. `Split.computeContentSize` (used by `getPreferredSize`/`getMinSize`) and `Split.computeTotalMinSize`'s cross-axis term call `component.getPreferredSize()`/`getMinSize()` on every pane unconditionally — including a collapsed one — with no existing guard (contrast the *main*-axis term in `computeTotalMinSize`, which already substitutes `COLLAPSE_STRIP_SIZE`). `Border.getPreferredSize`/`getMinSize` similarly call `<region>.getPreferredSize()`/`getMinSize()` live for every region; the result's *value* is discarded in favour of `COLLAPSE_STRIP_SIZE` on the main axis when collapsed, but is used as-is on the cross axis (`innerWidth = Math.max(innerWidth, size.width)` for NORTH/SOUTH, `middleHeight = Math.max(middleHeight, size.height)` for WEST/EAST) regardless of collapse state. None of this depended on the pane/region's content being present *before* this plan — a `Panel`/`Container`'s own `getPreferredSize()`/`getMinSize()` is manager-derived from its children (`ARCHITECTURE.md`'s size-reporting rules), so removing those children changes the number these methods return, for the pane/region axes that were not already substituted. `getMaxSize()` is excluded deliberately (see `## Non-Goals`): raising a max never over-constrains a layout the way silently under-reporting a min/preferred does, so it carries no snapshot guard.
