---
touches-shared:
  - packages/lib/src/typescript/lib/component/container/SplitGutter.ts
  - packages/lib/src/typescript/lib/layout/Accordion.ts
  - packages/lib/src/typescript/lib/core/Panel.ts
---

# Overlay Positioning and Window Chrome Cleanup — Implementation Plan

## Overview

A fresh-context review of the layout/overlay subsystem's growth since 2026-07-05 found five kinds of rot, all verified against current source: duplicated positioning logic in [`Menu.ts`](packages/lib/src/typescript/lib/overlay/Menu.ts), a duplicated drag-lifecycle sequence in [`WindowBorder.ts`](packages/lib/src/typescript/lib/component/container/WindowBorder.ts) and [`SplitGutter.ts`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts), a double-dispatch inefficiency in [`AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts)'s construction path, a handful of dead or unrouted getters/methods, and four stale doc comments. It also found one accepted-but-undocumented behaviour gap in [`DiagnosticsOverlay.ts`](packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts) and one already-deferred gap worth re-confirming rather than silently dropping.

This plan fixes the real duplication and the real inefficiency, removes the one genuinely dead method it found (the rest of the "dead code" candidates turn out to be a sanctioned pattern — see below), routes a handful of inline state checks through the methods that already exist for them, and cleans up the four doc comments as a final phase. It does **not** touch `Split` or `Accordion`'s own resize/clamp/collapse arithmetic — that belongs to the sibling `split-accordion-panel-scroll-convergence` plan (not yet drafted); see `## Non-Goals`.

---

## Architecture Decisions

### `Menu.open()`'s horizontal placement moves onto the shared flip primitives

[`Menu.open()`](packages/lib/src/typescript/lib/overlay/Menu.ts#L566) (persistent mode — a `MenuBar` dropdown or submenu) hand-rolls two horizontal placements that duplicate, badly, what [`core/OverlayPosition.ts`](packages/lib/src/typescript/lib/core/OverlayPosition.ts) already provides: the submenu branch (`open()` lines 596-600) reimplements `positionAdjacent`'s adjacency-flip shape without its "neither side fits" saturation fallback, and the top-level-dropdown branch (lines 613-617) reimplements `positionAligned`'s alignment shape but **clamps to the viewport edge** (`x = vp.width - width`) instead of **flipping to align with the anchor's right edge**. This is the exact defect [`overlay-edge-flip.md`](plans/implemented/overlay-edge-flip.md) fixed for rebuild-mode `show()`/`toggleFor()` and for `AnimatedDropdown.placeAnchored`; `open()`'s horizontal half was never in scope there — its Non-Goals list only `placeVertically`.[^open-scope]

Both branches move onto the real primitives, already imported or one import away: the submenu branch calls `positionAdjacent` directly (matching its already-correct vertical half, which calls `positionFlexibleAnchored` via `placeVertically`); the top-level branch calls `positionAnchoredFlexible` — the exact function `showAnchored` already uses for rebuild mode — replacing both the horizontal clamp and the separate `placeVertically` call with one, since `positionAnchoredFlexible`'s internal vertical computation is algebraically identical to what `placeVertically` computes today.[^identical-vertical] Flip wins over clamp, matching the rest of the file: no `MenuBar`-specific reason to keep the clamp turned up in this investigation — no test pins the clamped pixel value, and the resulting behaviour (a dropdown near the right viewport edge right-aligns to its trigger instead of being pushed off it) is the same fix `overlay-edge-flip.md` already shipped for every other anchored panel in the library.

### `WindowBorder` and `SplitGutter` share one viewport-drag lifecycle helper, added to `PointerDrag.ts`

[`WindowBorder.onDragStart`/`onDragStop`](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L263-L298) and [`SplitGutter.onDragStart`/`onDragStop`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L540-L581) each independently register the identical five viewport listeners in the identical order (`mouseup`/`touchend`/`touchcancel` → a stop listener, `mousemove`/`touchmove` → a move listener) bracketing a `beginPointerDrag`/`endPointerDrag` call. [`core/PointerDrag.ts`](packages/lib/src/typescript/lib/core/PointerDrag.ts) already names both classes in its own module doc comment as sharing this bookkeeping, and both already import `beginPointerDrag`/`endPointerDrag` from it — it is the natural, and only sensible, home for the listener half too, rather than a new module.[^precedent-search] Two new exports, `beginViewportDrag` / `endViewportDrag`, wrap the five-call sequence and the existing `beginPointerDrag`/`endPointerDrag` call into one call each; `WindowBorder` and `SplitGutter` each drop from twelve lines of listener wiring to two calls.

Each class's private `dragCursor()` stays where it is — the two share a JSDoc sentence ("shared by the hover state and the drag itself so the two can never disagree") but compute genuinely different values from genuinely different fields (`Direction` vs. an axis string), so there is nothing to extract there; only the surrounding lifecycle moves.

### `AbstractWindow`'s construction reconciles resize/lock chrome once, not twice

[`initChrome`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L407-L438) calls `this.setResizable(this.isResizable())` then `this.setLocked(this.isLocked())`. Both setters call the private [`applyResizeBorderVisibility`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1507-L1523) (which loops over all eight border strips) and the private [`applyMaximizeAvailability`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1549-L1552); `setResizable` additionally re-runs `reflectMinimizable`/`reflectMaximizable`, which `initChrome` already called directly two lines above (lines 423-424). Net result at construction: 16 `border.setVisible()` calls for 8 borders, and `reflectMinimizable`/`reflectMaximizable`/`applyMaximizeAvailability` each run twice.

The fix extracts the four-line body both setters already duplicate (`applyResizeBorderVisibility()` + the two reflect calls + `applyMaximizeAvailability()`) into one new private method, `applyResizeChrome()`, called by both `setResizable`/`setLocked` and, once, by `initChrome` — which no longer needs its own separate `reflectMinimizable`/`reflectMaximizable` lines, since `applyResizeChrome()` now covers them. This is a pure internal refactor: every public setter keeps its exact current behaviour post-construction; only the construction-time redundancy is removed. [`window-resizable-supersedes-maximize-minimize.md`](plans/implemented/window-resizable-supersedes-maximize-minimize.md) (~line 228) already flagged and *accepted* the reflect-half of this duplication as a harmless no-op second write — that acceptance was written before `setLocked` existed on this path (the plan's own diff touched only `isMinimizable`/`isMaximizable`/`setResizable`; `setLocked`'s call in `initChrome` was added later, by `window-context-menu`, without revisiting the count). This plan supersedes that acceptance now that the count is 16 calls, not a single redundant write.

### `isMaximized()` and `restore()` absorb their duplicated inline checks — verified against a smaller true count

[`AbstractWindow.isMaximized()`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1240-L1242) had exactly one unrouted, genuinely-equivalent inline duplicate: [`toggleMaximize`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1396-L1406) at line 1401. `toggleMaximize` now calls `this.isMaximized()`. The reviewer's original "~7"/"~9" estimate does not hold up against the source: `buildWindowMenuItems` (line 1697) caches `const state = this.getWindowState()` once and reads it for *both* the minimized and maximized branches — replacing only its maximized check would leave the function's minimized check inline and its cached-read pattern half-converted, so it is left alone (see `## Non-Goals`); the `_preMinimizeState` assignment (line 1151) compares the *outgoing* state during a transition, not "is the window maximized right now", so it is not an instance of this defect at all.

Two real instances turned up in the sibling files the finding named: [`Window.onHeaderDoubleClick`](packages/lib/src/typescript/lib/overlay/Window.ts#L305-L320) and [`TabWindow.onBarDoubleClick`](packages/lib/src/typescript/lib/overlay/TabWindow.ts#L169-L179) each hand-roll `if (this.getWindowState() === "minimized") { this.setWindowState(this._preMinimizeState); return; }` — the exact operation [`AbstractWindow.restore()`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1293-L1303) already performs, plus a `bringToFront()` and `focus(true)` neither call site gets today. Both call sites now read `if (this.isMinimized()) { this.restore(); return; }` — the `isMinimized()` guard stays (it decides whether to return early or fall through to the maximize-toggle logic that follows in each method; `restore()` itself returns `this` either way and so cannot signal that decision back), but the two lines inside it collapse to one call. This is a deliberate small behaviour addition, not a pure rename: a manual double-click restore now activates and focuses the window, matching what a click-to-restore from a [`Rail`](packages/lib/src/typescript/lib/overlay/Rail.ts#L992) handle already does. No test pins the absence of that call, and the two paths reaching different outcomes for the same "restore" action was itself a smaller instance of the duplication this plan is about.[^restore-risk]

### The dead-code candidates split: one real removal, three sanctioned getters

[`component-setter-api-audit.md`](plans/implemented/component-setter-api-audit.md) established the convention this codebase already follows: every DOM/state-mirroring setter gets a paired getter, kept even with zero non-test callers, for "getX honesty" and state/serialisation parity (its own words, `## Architecture Decisions → Why introduce a cache`). Checked against that convention:

- [`WindowBorder.isSnapTarget()`](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L225-L227) — zero callers anywhere, but its setter [`setSnapTarget`](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L238) is called three times from `AbstractWindow.ts`'s live snap-resize path. **Kept** — the sanctioned getter half of an actively-used setter.
- [`Accordion.getChevronGlyph()`](packages/lib/src/typescript/lib/layout/Accordion.ts#L490) and [`Accordion.getToolsVisibility()`](packages/lib/src/typescript/lib/layout/Accordion.ts#L689) — both documented, public getter/setter pairs (`docs/layouts/Accordion.md` rows for `chevronGlyph` and `toolsVisibility`). **Kept** — removing either is a public API break disguised as a dead-code cleanup.
- [`Accordion.attach()`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1100-L1104) — a pure `super.attach(container); return this;` pass-through with zero added behaviour. Every sibling layout manager's own `attach()` override does real work after `super.attach()` (`FlowLayout` resets `_wrappedLineExtent`; `Table` validates the container class; `Tab` raw-appends the strip element and wires its listeners) — `Accordion`'s is the only one that adds nothing, consistent with its own doc comment describing lazy header/panel creation in `doLayout`, not in `attach()`. **Removed** — genuinely vestigial, most likely orphaned by an earlier move to lazy construction.
- [`SplitGutterOptions.opaque`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L52) — checked against all 21 construction sites (3 in `src/`, 18 in `tests/`): exactly one (`Border.ts:382`) passes it, and only as `opaque: false` — already the default, and the constructor's own dispatch (`if (options?.opaque) { this.setOpaque(true); }`) never fires for `false` regardless. **Removed**, along with `Border.ts`'s now-redundant `opaque: false,` line. `setOpaque()`/`isOpaque()` themselves stay — they are real, actively-used runtime methods (`Split.ts` calls `setOpaque(true/false)` and reads `isOpaque()` live); only the construction-time option is dead.
- `SplitGutterOptions.listeners`'s `dragstart` / `drag` / `dragend` / `contextmenu` keys — checked against the same 21 sites plus a codebase-wide grep for each key literal: every consumer wires these four events via `.on("dragstart", …)` etc. *after* construction (see `Split.ts`'s own gutter-wiring loop); none passes them through the `listeners` option bag. Only `collapse` is used that way (`Border.ts`). **Removed** — the four keys, and nothing else in the `listeners` bag shape.

### `DiagnosticsOverlay`'s lost minimize/maximize is accepted, documented, not fixed

Commit `fb5a2333` ("Make the diagnostics overlay window non-resizable") passed `{ resizable: false }` when only `setResizable`-gated drag-resize existed; its message only discusses removing drag-resize. `isMinimizable()`/`isMaximizable()` gating on `isResizable()` was added later, by `window-resizable-supersedes-maximize-minimize.md`, as a deliberate architectural call: both minimize and maximize *are* resize operations (each changes the window's committed size — to header height, or to the viewport), so a window that cannot resize at all should not be able to resize itself via those buttons either. That coupling is correct for the library as a whole; decoupling it to accommodate one consumer would reintroduce, everywhere else, the exact inconsistency the superseding plan fixed.[^decouple-blast-radius]

So `DiagnosticsOverlay` keeps `resizable: false` and its now-implied loss of minimize/maximize. This is acceptable for this specific window: it is a small, fixed-metrics debug panel with `DiagnosticsOverlay.close()` / `.toggle()` already available (used to dismiss it entirely) and drag-to-reposition still working (only *resize* is gated, not *move*), so there is no real loss of capability — only of a button whose behaviour (collapse to header height) never fit a panel this small anyway. The fix here is documentation only: a source comment at the `resizable: false` call site explaining the now-coupled side effect, and one sentence in `docs/components/DiagnosticsOverlay.md` stating the window is fixed-size with no minimize/maximize.

### `setResizable(false)` on an already-maximized window stays deferred

[`window-resizable-supersedes-maximize-minimize.md`](plans/implemented/window-resizable-supersedes-maximize-minimize.md) (`## Potential Challenges`) already identified and explicitly accepted this gap: a window maximized *before* `setResizable(false)` runs stays maximized with no user-facing way out (button hidden, double-click gated, menu row omitted), and "the caller who created that situation owns the exit." This plan does not close it. The one existing library consumer of `resizable: false` (`DiagnosticsOverlay`) sets it at construction time, before the window can ever be maximized, so the gap is unreachable through any current call site — re-deferring costs nothing today. Recorded here, not silently dropped, per `## Non-Goals`.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/core/PointerDrag.ts — NEW exports

/**
 * Wires the standard viewport drag lifecycle: registers `moveListener` for
 * both `mousemove` and `touchmove`, `stopListener` for `mouseup`, `touchend`,
 * and `touchcancel` (all via `Event.addViewportListener`), then calls
 * `beginPointerDrag(cursor)`. Pair with `endViewportDrag` using the exact
 * same `component`/`moveListener`/`stopListener` references.
 */
export function beginViewportDrag(
    component:    Component,
    moveListener: Event.Listener,
    stopListener: Event.Listener,
    cursor:       string,
): void;

/**
 * Removes the five viewport listeners `beginViewportDrag` registered and
 * calls `endPointerDrag()`. `moveListener`/`stopListener` must be the same
 * function references passed to the matching `beginViewportDrag` call.
 */
export function endViewportDrag(
    component:    Component,
    moveListener: Event.Listener,
    stopListener: Event.Listener,
): void;
```

```typescript
// packages/lib/src/typescript/lib/component/container/SplitGutter.ts — REMOVED fields

export interface SplitGutterOptions extends ComponentOptions {
    // opaque?: boolean;                     — REMOVED (dead; setOpaque()/isOpaque() are unaffected)
    listeners?: {
        // dragstart?, drag?, dragend?, contextmenu? — REMOVED (dead; on()/off() are unaffected)
        collapse?: () => void;
    };
}
```

No other exported signature changes. `Menu.open()`, `AbstractWindow.isMaximized()` / `.restore()` / `.setResizable()` / `.setLocked()`, `Window.onHeaderDoubleClick` (private), and `TabWindow.onBarDoubleClick` (private) all keep their current signatures — only their bodies change.

---

## Internal Structure

### `Menu.open()` — submenu branch (adjacency)

Replace the hand-rolled flip (`open()` current lines 596-600) with:

```typescript
// A submenu sits beside its parent panel: right of the parent's right edge,
// flipping to the parent's left edge when the right side overflows the
// viewport. No gap — flush, as today.
const x = positionAdjacent(parentRect.left, parentRect.right, width, vp.width, 0);
```

### `Menu.open()` — top-level dropdown branch (adjacency + alignment, one call)

Replace both the hand-rolled clamp (current lines 613-617) *and* the separate `placeVertically` call with:

```typescript
// A top-level dropdown grows down from the anchor's bottom and flips up
// against the anchor's top when the room below is short; horizontally it
// aligns to the anchor's left edge, flipping to the anchor's right edge when
// that overflows — the same primitive rebuild-mode's showAnchored uses.
const placement = positionAnchoredFlexible(anchorRect, { width, height: totalHeight }, vp, VIEWPORT_MARGIN);

this.applyViewportHeightClamp(placement.available, totalHeight);
```

Then use `placement.x` / `placement.y` where the branch currently uses its local `x` / `y` (the `Math.max(0, …)` wrapping and the `setAutoCommitStyle(false)` / `setAutoCommitStyle(true)` bracket around the `setX`/`setY` calls stay exactly as they are). Add `positionAdjacent` to the existing `~/core/OverlayPosition.js` import (`positionAnchoredFlexible` is already imported).

### `PointerDrag.ts` — the two new exports

```typescript
import type { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";

export function beginViewportDrag(
    component: Component, moveListener: Event.Listener, stopListener: Event.Listener, cursor: string,
): void {
    Event.addViewportListener(component, 'mouseup', stopListener);
    Event.addViewportListener(component, 'touchend', stopListener);
    Event.addViewportListener(component, 'touchcancel', stopListener);
    Event.addViewportListener(component, 'mousemove', moveListener);
    Event.addViewportListener(component, 'touchmove', moveListener);

    beginPointerDrag(cursor);
}

export function endViewportDrag(
    component: Component, moveListener: Event.Listener, stopListener: Event.Listener,
): void {
    Event.removeViewportListener(component, 'mouseup', stopListener);
    Event.removeViewportListener(component, 'touchend', stopListener);
    Event.removeViewportListener(component, 'touchcancel', stopListener);
    Event.removeViewportListener(component, 'mousemove', moveListener);
    Event.removeViewportListener(component, 'touchmove', moveListener);

    endPointerDrag();
}
```

Place both after `endPointerDrag()`, at the end of the file. `Component` is a type-only import (no circular-import risk: neither `Event.ts` nor `Component.ts` imports `PointerDrag.ts` — verified).

### `WindowBorder.onDragStart` / `onDragStop` — call the shared helper

```typescript
onDragStart(e?: MouseEvent) {
    if (e && !Event.isPrimaryButton(e)) {
        return;
    }

    beginViewportDrag(this, this._fireDragListener, this._dragStopListener, this.dragCursor() ?? "default");
}

onDragStop(): Event.ListenerResult {
    endViewportDrag(this, this._fireDragListener, this._dragStopListener);

    this.setSnapTarget(false);

    return true;
}
```

Import `beginViewportDrag, endViewportDrag` from `~/core/PointerDrag.js` alongside the existing `beginPointerDrag, endPointerDrag` import (drop the two now-unused direct calls — `beginViewportDrag`/`endViewportDrag` call them internally).

### `SplitGutter.onDragStart` / `onDragStop` — same shape

```typescript
onDragStart(evnt: MouseEvent) {
    if (!this._movable || this._opaque || !Event.isPrimaryButton(evnt)) {
        return;
    }

    const position = this._direction === "horizontal" ? evnt.clientX : evnt.clientY;

    this.emit("dragstart", position);

    beginViewportDrag(this, this.onDrag, this.onDragStop, this.dragCursor());
}

onDragStop(): Event.ListenerResult {
    endViewportDrag(this, this.onDrag, this.onDragStop);

    this.emit("dragend");

    return true;
}
```

### `AbstractWindow` — `applyResizeChrome()`

Extract from `setResizable`/`setLocked`'s duplicated tail:

```typescript
/**
 * Reconciles every piece of chrome gated by resizable/locked in one pass:
 * the eight resize-border strips, the minimize/maximize affordances (which
 * `resizable` supersedes), and the maximize-availability gate (which both
 * `resizable` and `locked` feed). Called by `setResizable`, `setLocked`, and
 * once from `initChrome` — never duplicated across two construction-time
 * setter calls.
 */
private applyResizeChrome(): void {
    this.applyResizeBorderVisibility();
    this.reflectMinimizable(this.isMinimizable());
    this.reflectMaximizable(this.isMaximizable());
    this.applyMaximizeAvailability();
}
```

`setResizable`/`setLocked` each keep their own `this._options.resizable = value;` / `this._options.locked = value;` write, then call `this.applyResizeChrome();` in place of their current multi-line tail. `initChrome` drops its two direct `reflectMinimizable`/`reflectMaximizable` calls (lines 423-424) and its `setResizable(...)`/`setLocked(...)` calls (lines 425-426), replacing all four with one `this.applyResizeChrome();` — `_options.resizable`/`_options.locked` are already correctly seeded by `applyOptions` before `initChrome` runs, so no setter call is needed to store them, only to reconcile the chrome.

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/overlay/Menu.ts`** — add `positionAdjacent` to the `~/core/OverlayPosition.js` import. Replace the submenu branch's hand-rolled flip and the top-level branch's clamp + `placeVertically` call per `## Internal Structure`. Update the two inline comments above each branch to describe the flip (see `## Internal Structure` snippets). → `npm run typecheck`.
2. **`packages/lib/docs/components/Menu.md`** — add one sentence to the `## Notes` placement paragraph (near line 102) stating that `open()`'s horizontal alignment now flips the same way `toggleFor()`'s does, instead of clamping to the viewport edge (see `## Documentation Impact`).
3. **`packages/lib/tests/overlay/Menu.test.ts`** — add the new `describe('Menu open() — horizontal placement')` cases from `## Expected Behaviour` §1. → `npx vitest run packages/lib/tests/overlay/Menu.test.ts`.
4. **`packages/lib/src/typescript/lib/core/PointerDrag.ts`** — add `beginViewportDrag`/`endViewportDrag` per `## Internal Structure`, with the `Component`/`Event` imports. → `npm run typecheck`.
5. **`packages/lib/tests/core/PointerDrag.test.ts`** — add the new `describe` blocks from `## Expected Behaviour` §2, following the file's `installTestDOM`/`patchFor` idiom.
6. **`packages/lib/src/typescript/lib/component/container/WindowBorder.ts`** — replace `onDragStart`/`onDragStop` bodies per `## Internal Structure`; update the import line. → `npm run typecheck`; existing `WindowBorder.resizeCursor.test.ts` and `WindowBorder.classStateHoisting.test.ts` must still pass unchanged (black-box, no internal-listener inspection).
7. **`packages/lib/src/typescript/lib/component/container/SplitGutter.ts`** — replace `onDragStart`/`onDragStop` bodies per `## Internal Structure`; update the import line. → existing `SplitGutter.movable.test.ts` and `SplitGutter.tooltip.test.ts` must still pass unchanged.
8. **Checkpoint:** `grep -rn "beginPointerDrag\|endPointerDrag" packages/lib/src/typescript/lib/component/container/WindowBorder.ts packages/lib/src/typescript/lib/component/container/SplitGutter.ts` — expect **zero matches** (both now call `beginViewportDrag`/`endViewportDrag` exclusively).
9. **`packages/lib/src/typescript/lib/component/container/SplitGutter.ts`** — delete the `opaque?: boolean` field (and its JSDoc) from `SplitGutterOptions`; delete `dragstart?`/`drag?`/`dragend?`/`contextmenu?` from the `listeners` bag shape; delete the constructor's `if (options?.opaque) { this.setOpaque(true); }` block. Leave `_opaque`, `setOpaque()`, `isOpaque()` untouched.
10. **`packages/lib/src/typescript/lib/layout/Border.ts`** — delete the `opaque: false,` line from the `SplitGutter` construction call at line 382.
11. **Checkpoint:** `npm run typecheck` (the deleted options fields must not be referenced anywhere) and `grep -rn "opaque:" packages/lib/src` — expect the only remaining hit to be `SplitGutter.ts`'s own `_opaque` field/`isOpaque()`/`setOpaque()`, no construction-site `opaque:` key.
12. **`packages/lib/src/typescript/lib/layout/Accordion.ts`** — delete the `attach(container: Component): this { super.attach(container); return this; }` override (lines 1100-1104) and its JSDoc. Do **not** touch `getChevronGlyph`/`getToolsVisibility` — verified sanctioned, see `## Architecture Decisions`.
13. **`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`** — add the private `applyResizeChrome()` method per `## Internal Structure`, placed next to `applyResizeBorderVisibility`/`applyMaximizeAvailability`. Rewrite `setResizable`'s and `setLocked`'s bodies to call it. Rewrite `initChrome`'s construction block per `## Internal Structure`, updating its surrounding comment (lines 412-421) to describe the single reconciliation call instead of the four separate ones it replaces. → `npm run typecheck`.
14. **`packages/lib/tests/overlay/AbstractWindow.resizable.test.ts`** — add the construction-time call-count regression from `## Expected Behaviour` §3, using `vi.spyOn(WindowBorder.prototype, 'setVisible')`.
15. **`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`** — in `toggleMaximize` (line 1401), replace `this.getWindowState() === "maximized"` with `this.isMaximized()`.
16. **`packages/lib/src/typescript/lib/overlay/Window.ts`** — in `onHeaderDoubleClick`, replace the `if (this.getWindowState() === "minimized") { this.setWindowState(this._preMinimizeState); return; }` block with `if (this.isMinimized()) { this.restore(); return; }`.
17. **`packages/lib/src/typescript/lib/overlay/TabWindow.ts`** — in `onBarDoubleClick`, make the identical replacement.
18. **Checkpoint:** `grep -rn 'getWindowState() === "maximized"' packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — expect zero matches inside `toggleMaximize` (the `buildWindowMenuItems` cached-`state` comparison at line 1709 is expected and untouched — see `## Non-Goals`). `grep -rn '_preMinimizeState' packages/lib/src/typescript/lib/overlay/Window.ts packages/lib/src/typescript/lib/overlay/TabWindow.ts` — expect the only remaining reference in each file to be inside `AbstractWindow.restore()`'s own definition (i.e. neither file assigns `setWindowState(this._preMinimizeState)` directly any more).
19. **`packages/lib/tests/overlay/Window.headerMoveTrigger.test.ts`** — add the double-click-restore case from `## Expected Behaviour` §4, following the file's existing white-box `.onHeaderDoubleClick(...)` cast idiom (line 91).
20. **`packages/lib/tests/overlay/AbstractWindow.locked.test.ts`** — add the equivalent `onBarDoubleClick` case from `## Expected Behaviour` §4, following the file's existing white-box cast idiom (lines 186-211).
21. **`packages/lib/tests/overlay/AbstractWindow.maximizeRestoreViewportClamp.test.ts`** — add the `toggleMaximize`-now-routes-through-`isMaximized()` case from `## Expected Behaviour` §3 (behaviourally a no-op change; the test pins that it stays a no-op).
22. **`packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts`** — add a short comment above `super("Diagnostics", { resizable: false });` noting that `resizable: false` also suppresses minimize/maximize (per `AbstractWindow`'s `isMinimizable`/`isMaximizable` gate), and that this is accepted for a fixed-metrics panel (closeable via `close()`/`toggle()`, still movable). No logic change.
23. **`packages/lib/docs/components/DiagnosticsOverlay.md`** — add one sentence to `## Notes`: the window is fixed-size with no minimize/maximize affordance; drag the title bar to reposition it, or `close()`/`toggle()` to dismiss it.
24. **Doc-accuracy final phase.** `packages/lib/src/typescript/lib/core/Panel.ts` — fix `removeOverlayScrollbars`'s JSDoc (line 1136): replace "removes the sticky host" with an accurate description (it re-parents content off `_overlayScrollElement`, the inner scroll host, then removes that element — there is no "sticky host" anywhere in the file).
25. **`packages/lib/src/typescript/lib/core/OverlayPosition.ts`** — fix `positionAdjacent`'s "neither side fits" comment (lines 59-61): it currently says the fallback "mirrors `placeAnchored`'s `spaceBelow`/`spaceAbove` fallback" — `AnimatedDropdown.placeAnchored` no longer has any such local fallback (it now delegates entirely to `positionAnchored`, which calls this very function). Replace with a self-contained description, e.g. "the same saturate-to-more-room fallback every fixed-size adjacency placement needs."
26. **`packages/lib/src/typescript/lib/overlay/windowControls.ts`** — fix `createWindowLeadGlyphButton`'s JSDoc (~line 150): it claims the function is "shared by `TabWindow` and `WindowHeader`" — verified only `TabWindow.ts:112` calls it (`WindowHeader.ts` builds its own leading glyph via `WindowHeaderTitleGlyph` directly). Replace "shared by `TabWindow` and `WindowHeader`" with "used by `TabWindow`" (or similar); leave `createWindowControlButton`'s doc alone — that one genuinely is shared by both.
27. **`packages/lib/docs/components/Window.md`** — fix line 63: `setResizeFps(fps)` | Throttle resize-driven layout (default 30). → change `30` to `60`, matching `AbstractWindow.ts`'s actual field default and the setter's own JSDoc.
28. **Checkpoint:** `npm run typecheck && npm run lint && npm test` — all green. `npm run docs:api` — zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/Menu.ts` |
| Modify | `packages/lib/src/typescript/lib/core/PointerDrag.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/WindowBorder.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/SplitGutter.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Border.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Accordion.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Window.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/TabWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Panel.ts` |
| Modify | `packages/lib/src/typescript/lib/core/OverlayPosition.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/windowControls.ts` |
| Modify | `packages/lib/docs/components/DiagnosticsOverlay.md` |
| Modify | `packages/lib/docs/components/Window.md` |
| Modify | `packages/lib/docs/components/Menu.md` |
| Modify | `packages/lib/tests/overlay/Menu.test.ts` |
| Modify | `packages/lib/tests/core/PointerDrag.test.ts` |
| Modify | `packages/lib/tests/overlay/AbstractWindow.resizable.test.ts` |
| Modify | `packages/lib/tests/overlay/Window.headerMoveTrigger.test.ts` |
| Modify | `packages/lib/tests/overlay/AbstractWindow.locked.test.ts` |
| Modify | `packages/lib/tests/overlay/AbstractWindow.maximizeRestoreViewportClamp.test.ts` |

No files created or deleted.

---

## Expected Behaviour

### §1 `Menu.open()` horizontal placement — unit-testable (`installTestDOM`)

Build a positioned anchor component (e.g. a `Button`, per the pattern other dropdown tests in this repo use), call `setX`/`setY`/`setWidth`/`setHeight` on it, and pass `button.getElement(true)!` as `anchorEl`.

| Case | Anchor rect | Panel width | Expected `getX()` | Why |
|---|---|---|---|---|
| top-level, room to the right | `left: 100, right: 200` | `150` | `100` | left-aligns, unchanged from today |
| **top-level, flips (report-1 shape)** | `left: 1200, right: 1270` (1280px viewport) | `150` | `1120` (`1270 - 150`) | right edge flush with the anchor's right — **today this returns `1130` (`1280 - 150`), the clamp bug** |
| submenu, room to the right of parent | parent `left: 100, right: 200` | `150` | `200` | flush with parent's right edge, unchanged from today |
| **submenu, flips** | parent `left: 1150, right: 1250` (1280px viewport) | `150` | `1000` (`1150 - 150`) | flush with parent's left edge — unchanged in shape from today's manual flip, now via `positionAdjacent` |

Vertical placement is untouched in both branches — existing `open()` tests (LayerManager registration, submenu-under-parent structural checks) must pass unchanged.

### §2 `PointerDrag.beginViewportDrag` / `endViewportDrag` — unit-testable (`installTestDOM`)

- `beginViewportDrag(component, move, stop, cursor)` results in the document element carrying the `ts-ui-dragging` class and `cursor` inline style (same assertion shape as the existing `beginPointerDrag` tests).
- A synthetic `mousemove`/`touchmove` viewport event after `beginViewportDrag` invokes `move`; a synthetic `mouseup`/`touchend`/`touchcancel` invokes `stop`. (Use `Event`'s own test-dispatch helper, matching how `WindowBorder`/`SplitGutter`'s own drag tests exercise viewport listeners today, if such a helper exists in this file's neighbours — otherwise assert via `Event.addViewportListener`/`removeViewportListener` call counts.)
- `endViewportDrag(component, move, stop)` removes all five listeners (a move/stop event after `endViewportDrag` no longer invokes either) and clears the `ts-ui-dragging` class / cursor, mirroring the existing `endPointerDrag` tests.

### §3 `AbstractWindow` construction dispatch count and `isMaximized()` — unit-testable

- **Construction call count:** `vi.spyOn(WindowBorder.prototype, 'setVisible')`, construct `new Window("W")`, assert the spy was called exactly **8** times (one per border strip) — today it is called 16 times.
- `toggleMaximize()`'s behaviour is unchanged for every existing case (a pure internal reroute to `isMaximized()`, same boolean, same branches) — the existing test in `AbstractWindow.maximizeRestoreViewportClamp.test.ts` that calls `toggleMaximize()` twice must keep passing untouched; add one new assertion there that `win.isMaximized()` reports `true`/`false` in step with `getWindowState()` across the same toggle sequence.

### §4 Double-click restore routes through `restore()` — unit-testable

- `new Window("W")`, `.minimize()`, then the white-box `.onHeaderDoubleClick(dblclickEvent)`: `getWindowState()` becomes `"normal"` (or `"maximized"`, per whatever `_preMinimizeState` holds — mirror the existing minimize/restore test's setup), **and** the window becomes the active/focused layer (assert via the same activation check `AbstractWindow.activate.test.ts` already uses for `restore()` — e.g. `LayerManager`'s active-layer accessor, or the window's own `isActive()`/equivalent). Today only the state changes; activation does not fire from this entry point.
- Same case for `TabWindow`'s white-box `.onBarDoubleClick()`.
- Unchanged: a double-click on a **not-minimized** window still falls through to the existing `canMaximize()` / `toggleMaximize()` tail — no new gating.

All four sections are unit-testable offline; none needs a real browser.

---

## Verification

1. `npm run typecheck` — clean after every step, per the checkpoints above.
2. `npm run lint` — clean (`local/no-raw-dom` and friends have empty baselines; this plan adds no raw DOM access).
3. `npm test` — full suite green, including every new case in `## Expected Behaviour` and every "must pass unchanged" file named in `## Ordered Implementation Steps`.
4. `grep -rn "beginPointerDrag\|endPointerDrag" packages/lib/src/typescript/lib/component/container/WindowBorder.ts packages/lib/src/typescript/lib/component/container/SplitGutter.ts` — zero matches (step 8).
5. `grep -rn "opaque:" packages/lib/src` — only `SplitGutter.ts`'s own field/getter/setter remain (step 11).
6. `grep -rn 'getWindowState() === "maximized"' packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — the only remaining hit is inside `isMaximized()`'s own definition. `buildWindowMenuItems`'s `state === "maximized"` comparison (untouched, justified — see `## Non-Goals`) reads its own cached local variable, not `getWindowState()` directly, so it falls outside this grep's pattern entirely; it is not expected to appear.
7. `npm run docs:api` — zero warnings (the `createWindowLeadGlyphButton`/`removeOverlayScrollbars`/`positionAdjacent` JSDoc fixes are prose-only, on already-internal or already-clean symbols).
8. `npm run docs:build` — zero warnings, covering the `Window.md`/`Menu.md`/`DiagnosticsOverlay.md` edits.
9. **Manual smoke test** (`npm run dev`, `localhost:8015`): open the *Misc* panel's `MenuBar`, narrow the browser window until a dropdown's trigger sits near the right edge, open it — the panel should right-align to the trigger instead of being pushed off it. Open a submenu near the right edge — it should flip to the parent's left. Drag a `Window`'s border and a `Split` gutter — both should still show the resize cursor and resize live (regression check for the `PointerDrag` extraction). Double-click a minimized `Window`'s docked header — it should restore **and** become the active window (visibly gain focus styling if the demo shows it).

---

## Documentation Impact

- `SplitGutterOptions.opaque` and the four dead `listeners` keys are removed from a public, exported interface, but neither is documented as an option anywhere in `docs/` today. `docs/layouts/Border.md` uses the word "opaque" once, purely as prose describing the collapsed strip's visual appearance ("widens into an opaque strip"), not as API documentation of the `opaque` field — nothing there needs to change. `docs/layouts/Split.md` has no matches at all. No doc page needs editing for the removal itself.
- `Accordion.attach()`'s removal is a private-surface-shape simplification (the method is still callable, inherited from `LayoutManager`) — no doc impact.
- `Menu.open()`'s horizontal-placement behaviour change is public-behaviour-visible: add one sentence to `docs/components/Menu.md`'s `## Notes` placement paragraph (near line 102) stating that `open()`'s horizontal alignment now flips the same way `toggleFor()`'s does, rather than clamping to the viewport edge.
- `docs/components/DiagnosticsOverlay.md` gets the one-sentence `## Notes` addition from step 23.
- `docs/components/Window.md`'s `setResizeFps` row gets the one-word default fix from step 27.
- No `packages/lib/docs/reference/changelog/next.md` entry: every behaviour change here is a bug fix to an already-inconsistent or already-documented-as-flipping placement policy, not a new feature or a break to a documented contract (`resizable: false`'s effect on `DiagnosticsOverlay` was already the shipped, documented behaviour of the superseding plan — this plan only adds the missing explanation).

---

## Potential Challenges

- **`positionAnchoredFlexible` in the top-level `open()` branch silently changes the "neither alignment fits" pixel value** by `VIEWPORT_MARGIN` (4px) from today's un-margined `vp.width - width`. No test pins the old value (verified: no `MenuBar.test.ts` geometry assertions), but a consuming app's pixel-level screenshot test could notice. Mitigation: called out explicitly in `## Architecture Decisions` and the manual smoke test.
- **Reusing `moveListener`/`stopListener` by reference across `begin`/`endViewportDrag`.** If a call site passes a fresh closure to each call instead of the same bound method reference, `Event.removeViewportListener` silently no-ops (wrong reference) and leaks the listener. Both `WindowBorder` and `SplitGutter` already store these as bound instance fields/methods (`_fireDragListener`, `_dragStopListener`, `onDrag`, `onDragStop`), so this plan's two call sites are safe by construction; flagged for any future third caller.
- **`applyResizeChrome()` naming collides with nothing today** (verified by grep) but reads similarly to the existing `applyResizeBorderVisibility` — a reader must not conflate the two; the new method's JSDoc names both of its constituent calls explicitly to avoid this.
- **Manual verification for §4 (double-click restore activation)** needs a way to observe "this window is now the active layer" — if the demo shell has no visible active/inactive treatment for `Window` (only `TabWindow`'s active tab might), fall back to a unit assertion via `LayerManager`'s active-layer query instead of a visual check.

---

## Critical Files

- [`plans/implemented/overlay-edge-flip.md`](plans/implemented/overlay-edge-flip.md) — the precedent for §1: names the exact primitive pair (`positionAdjacent`/`positionAligned`/`positionAnchoredFlexible`) and the flip-not-clamp policy this plan extends to `open()`.
- [`plans/implemented/window-resizable-supersedes-maximize-minimize.md`](plans/implemented/window-resizable-supersedes-maximize-minimize.md) — the precedent and prior acceptance this plan's `applyResizeChrome()` decision and the `setResizable(false)`-on-maximized deferral both build on.
- [`plans/implemented/component-setter-api-audit.md`](plans/implemented/component-setter-api-audit.md) — the getter/setter symmetry convention that rules out removing `isSnapTarget`/`getChevronGlyph`/`getToolsVisibility`.
- [`packages/lib/src/typescript/lib/core/OverlayPosition.ts`](packages/lib/src/typescript/lib/core/OverlayPosition.ts) — `positionAdjacent` (46), `positionAligned` (92), `positionFlexibleAnchored` (174), `positionAnchoredFlexible` (223), `positionAnchored` (255).
- [`packages/lib/src/typescript/lib/overlay/Menu.ts`](packages/lib/src/typescript/lib/overlay/Menu.ts) — `showAnchored` (281-389, the pattern `open()`'s top-level branch now mirrors), `open` (566-648).
- [`packages/lib/src/typescript/lib/core/PointerDrag.ts`](packages/lib/src/typescript/lib/core/PointerDrag.ts) — the module doc comment already names both target classes.
- [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) — `initChrome` (407-438), `applyResizeBorderVisibility` (1507-1523), `applyMaximizeAvailability` (1549-1552), `setResizable`/`setLocked` (1593-1638), `isMaximized`/`isMinimized`/`restore` (1235-1303).

---

## Non-Goals

- **`Split`/`Accordion`'s own drag/clamp/collapse arithmetic** (`Split.ts`'s `onDragStart`/`onDrag`/`onDragEnd`, resize-ratio math, collapse thresholds). Out of scope — reserved for the sibling `split-accordion-panel-scroll-convergence` plan. This plan touches `SplitGutter.ts` only for its viewport-drag *listener bookkeeping* (shared with `WindowBorder`) and its dead `opaque`/`listeners` surface, neither of which is Split/Accordion-specific resize logic.
- **`buildWindowMenuItems`'s cached-`state` pattern.** It already avoids the redundant-`getWindowState()`-calls problem this plan is otherwise fixing, by reading the state once and reusing it for both the minimized and maximized checks in the same function. Converting only its maximized half to `this.isMaximized()` would mix styles in one function for no benefit; converting both would trade one cached read for two method calls that each re-read `getWindowState()`. Left as-is.
- **Decoupling `isMinimizable`/`isMaximizable` from `isResizable`.** Investigated and rejected — see `## Architecture Decisions → DiagnosticsOverlay's lost minimize/maximize`. The coupling is a deliberate, correct design for the whole library; only one consumer's UX is affected, and it is accepted there.
- **A user-facing exit path for `setResizable(false)` on an already-maximized window.** Re-deferred, not closed — see `## Architecture Decisions`. Unreachable through any current call site.
- **Renaming or restructuring `PointerDrag.ts`'s existing `beginPointerDrag`/`endPointerDrag`.** They stay exactly as they are; the two new exports call them internally.
- **Extending the new `PointerDrag` helper to `Scrollbar.ts` or `Header.ts`.** Both also call `beginPointerDrag`/`endPointerDrag` around viewport listeners, but neither matches the exact five-call, same-order shape `WindowBorder`/`SplitGutter` share — `Scrollbar.ts` registers the same five events in a different order, and `Header.ts` registers only two (no touch support). Folding either in would be a broader behavioural-shape change, not this plan's narrow, verified duplication.

---

## Notes

[^open-scope]: `overlay-edge-flip.md`'s `## Non-Goals` lists "Changing `Menu.placeVertically` or persistent-mode (`MenuBar`) placement... Its cross axis is owned by `MenuBar`, not `resolvePlacement`" — read narrowly, this exempted the *vertical* axis (`placeVertically`, which was already correct). It says nothing about `open()`'s horizontal axis, which lives inline in `open()` itself, not in `placeVertically` or `resolvePlacement`. The horizontal clamp-vs-flip inconsistency was simply never audited by that plan, not deliberately excluded.

[^identical-vertical]: `placeVertically(growTop, anchorTop, totalHeight, viewportHeight)` calls `positionFlexibleAnchored(anchorTop, growTop, totalHeight, viewportHeight, VIEWPORT_MARGIN)` and then `applyViewportHeightClamp(available, totalHeight)`, returning `start`. `positionAnchoredFlexible(anchorRect, size, viewport, margin)` calls `positionFlexibleAnchored(anchorRect.top, anchorRect.bottom, size.height, viewport.height, margin)` internally. For the top-level branch, `growTop = anchorRect.bottom` and `anchorTop = anchorRect.top`, so the two calls are `positionFlexibleAnchored(anchorRect.top, anchorRect.bottom, …)` in both cases — byte-for-byte the same arguments, same result.

[^precedent-search]: Searched for an existing shared drag-lifecycle helper before designing a new one (per `pattern-conformance.md`): no such helper exists anywhere in `core/`. `PointerDrag.ts` is the nearest thing — a module already dedicated to exactly this concern, already imported by both target classes, and its own doc comment already lists `WindowBorder`/`SplitGutter`/`Header`/`Scrollbar` as the class of consumer it serves. Adding to it, rather than creating `core/ViewportDrag.ts` or similar, avoids a second module for one concept.

[^restore-risk]: The added `bringToFront()`/`focus(true)` calls are the only behaviour change beyond deduplication in this plan that isn't a pure refactor. Considered and rejected: leaving the state-transition line inline and only extracting the `isMinimized()` check (i.e. `if (this.isMinimized()) { this.setWindowState(this._preMinimizeState); return; }`) — this would be a smaller diff, but it preserves the exact inconsistency being fixed (a `Rail`-restored window activates and focuses; a double-click-restored window does not, for no documented reason), and there is no test or doc asserting the double-click path should *not* activate. The full `restore()` call was chosen because a double-click is itself an explicit user activation gesture, so bringing the window to front and focusing it is the more correct behaviour, not merely a side effect of deduplication.

[^decouple-blast-radius]: Grepped every `isMinimizable()`/`isMaximizable()` call site in `AbstractWindow.ts`, `Window.ts`, and `TabWindow.ts`: all route through the two getters, which is exactly what makes the current coupling cheap to keep and expensive to unwind — decoupling would mean either a second pair of "raw" getters callers would have to choose between (reintroducing the two-policy inconsistency `window-resizable-supersedes-maximize-minimize.md` fixed) or an opt-out flag on `AbstractWindow` with no second consumer to justify its shape.
