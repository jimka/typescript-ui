# Custom Scrollbar Fixes — Implementation Plan

## Overview

Two related defects in the custom-scrollbar stack shared by the Tree and Table — the `Scrollbar` widget and the `VirtualScroller` helper it lives inside. Both are surgical.

1. **Arrow buttons are inert.** Each `ScrollArrowButton` in [`Scrollbar.ts`](src/typescript/lib/component/container/Scrollbar.ts#L112) wires `mousedown` / `mouseover` / `mouseout` via `Event.addListener(this, …)`. The framework's window-level dispatcher routes `addListener` callbacks to the listener keyed by the **exact** target element's id ([`Event.ts:110`](src/typescript/lib/core/Event.ts#L110)) — only `addSubtreeListener` climbs ancestors ([`Event.ts:125`](src/typescript/lib/core/Event.ts#L125)). The arrow's clickable face is a `Glyph` child sized to fill the whole 12×12 button ([`Scrollbar.ts:143`](src/typescript/lib/component/container/Scrollbar.ts#L143)) and `Glyph` sets no `pointer-events`, so the real event target is the glyph element (whose id carries no listener). The arrow's `_onMouseDown` (tick + accelerating hold-repeat) and `_onMouseOver` / `_onMouseOut` (hover shading) never fire.

2. **Tree forces a spurious horizontal scrollbar.** In [`Tree._renderWindow`](src/typescript/lib/component/tree/Tree.ts#L1004) rows are sized to `rowWidth = Math.max(this.getWidth(), maxContentWidth)` — the **full** owner width — and that same value is handed to `scroller.layoutScrollbars(rowWidth, …)`. When content overflows vertically, `VirtualScroller` shows the vertical bar (`TRACK_WIDTH = 12`) and shrinks the effective viewport width to `effW = outerW - 12` ([`VirtualScroller.ts:254`](src/typescript/lib/component/container/VirtualScroller.ts#L254)). Because `contentWidth` (full width) `> effW` (full − 12), `computeScrollbarVisibility` turns the horizontal bar **on** for the last 12px — a spurious bar for content that would otherwise fit, with rows visually running under the vertical scrollbar band.

The Table Body path uses the same `VirtualScroller` and an analogous `Math.max(this._lastBodyWidth, totalColumnWidth)` row-width pattern, but already reserves the vertical-scrollbar band upstream — see [Non-Goals](#non-goals). This plan is Tree-only for issue 2.

---

## Architecture Decisions

### Issue 1 — fix by making the glyph non-interactive, not by switching listener modes

Add `this._glyph.setPointerEvents("none")` in the `ScrollArrowButton` constructor so pointer events fall through the glyph to the arrow element, where the `addListener` bucket lives. One line restores `mousedown` ticks **and** the `mouseover` / `mouseout` hover shading together. `Component.setPointerEvents` already exists ([`Component.ts:3623`](src/typescript/lib/core/Component.ts#L3623)); no new API.

**Rejected:** switching the arrow's listeners to `Event.addSubtreeListener`. It would work (the subtree walk climbs from the glyph to the arrow), but it is more churn, changes the arrow's event semantics, and would also catch events fired on any future child of the arrow — a wider contract than the fix needs. `pointer-events: none` keeps the arrow the single event target and matches the one-DOM-element-per-class intent (the glyph is a passive visual, not an interactive sub-element). Consistent with `ARCHITECTURE.md` "Minimize direct DOM access" — the change routes through an existing typed setter.

### Issue 2 — size Tree rows against the effective viewport, exposed by a new `VirtualScroller` accessor

`computeScrollbarVisibility` is private and is the single source of truth for the two-axis mutual-dependency resolution. Rather than duplicate that arithmetic in the Tree, add a **public** `VirtualScroller.getViewportWidth(): number` that returns `computeScrollbarVisibility(this._contentWidth, this._contentHeight).effW` for the current/last-known content metrics. The Tree then bases its fill width on it: `rowWidth = Math.max(scroller.getViewportWidth(), maxContentWidth)`.

Ordering is already correct: `_renderWindow` calls `scroller.clampToContent(this._lastRowWidth, totalHeight)` at the top ([`Tree.ts:1016`](src/typescript/lib/component/tree/Tree.ts#L1016)), which writes `_contentWidth` / `_contentHeight` into the scroller before the query. Using last frame's row width for the visibility calc mirrors the existing loose-clamp approach and converges across frames (on the first frame `_lastRowWidth = 0`, so `effW` depends only on the vertical-overflow test, which is correct). This keeps the mutual-dependency logic owned by the scroller and the Tree a pure consumer.

---

## Public API

```typescript
// VirtualScroller.ts — new public accessor
/**
 * Effective viewport width for the last-known content metrics — the owner
 * width minus the vertical scrollbar's track reservation when that bar is
 * visible. Owners size their fill-width rows against this so content does not
 * run under the vertical bar (which would otherwise force a spurious
 * horizontal bar for the reserved band).
 */
getViewportWidth(): number;
```

Returns `this.computeScrollbarVisibility(this._contentWidth, this._contentHeight).effW`. No new state; it is a read over existing `_contentWidth` / `_contentHeight`. The existing private `effectiveViewportW()` stays as-is (it returns the same value; leave it to avoid churn — `getViewportWidth` is the public face used by owners, `effectiveViewportW` the internal clamp helper).

---

## Ordered Implementation Steps

1. **Test-first — Issue 1 (white-box glyph state).** In `tests/component/container/Scrollbar.test.ts`, add a test that constructs `new Scrollbar('vertical', { arrowsEnabled: true })`, reaches the start/end arrow via `getComponents()` (order: `[thumb, arrowStart, arrowEnd]`), reads each arrow's glyph child via `arrow.getComponents()[0]`, and asserts `glyph.getPointerEvents() === "none"`. Red before the fix.

2. **Test-first — Issue 1 (handler-chain delivery).** Add a test that fires a `mousedown` routed to an **arrow element handle** (build via `makeEvent(arrowHandle, "mousedown", { button: 0 })` and `DOM.sink.dispatchEvent(arrowHandle, evt)` — see `tests/dom/TestDOM.ts`), after `setMetrics` puts the arrow off its edge, and asserts a `"scroll"` emission with a stepped position; then assert an at-edge (disabled) arrow fires nothing. This is a regression guard on the `_onMouseDown → emit("tick") → onArrowTick → emit("scroll")` chain. (Note: it does not exercise pointer-events retargeting — the offline harness has no hit-testing — so it passes with or without the fix; the retargeting itself is manual-verify, step 8.)

3. **Fix — Issue 1.** In `ScrollArrowButton`'s constructor ([`Scrollbar.ts:142`](src/typescript/lib/component/container/Scrollbar.ts#L142)), after `this._glyph.setFontSize(ARROW_GLYPH_FONT_SIZE)` and before `super.addComponent(this._glyph)`, add `this._glyph.setPointerEvents("none")` with a one-line comment explaining the fall-through. Run step 1's test → green.

4. **Test-first — Issue 2 (VirtualScroller).** In `tests/component/container/VirtualScroller.test.ts`, add a test: owner `200 × 400`, `scroller.layoutScrollbars(100, 1000)` (taller-not-wider). Assert `scroller.getViewportWidth() === 200 - TRACK_WIDTH` (vertical bar visible shrinks width) and that `scroller.setScrollX(99999)` leaves `getScrollX() === 0` (no horizontal range → no horizontal bar). Add the reciprocal: content that fits vertically (`layoutScrollbars(100, 300)`) yields `getViewportWidth() === 200` (full owner width, no reservation). Red until `getViewportWidth` exists.

5. **Fix — Issue 2 (accessor).** Add `getViewportWidth()` to `VirtualScroller` (public, per Public API), placed next to `effectiveViewportW`. Run step 4's test → green.

6. **Test-first — Issue 2 (Tree).** In `tests/component/tree/Tree.test.ts`, add a white-box test: mount a Tree (`tree.getElement(true)`), size it (e.g. `setWidth(200)`, `setHeight(120)`), set enough short-label nodes to overflow vertically but not horizontally, drive a render (`setNodes(...)` triggers `_renderWindow` once the element exists; or cast to call `_renderWindow` directly), then assert a visible pool row's `getWidth() === 200 - TRACK_WIDTH` (rows sized to `effW`, not full width) and that the scroller's `getScrollX()` stays `0`. Red before the Tree change.

7. **Fix — Issue 2 (Tree).** In [`Tree._renderWindow`](src/typescript/lib/component/tree/Tree.ts#L1027) replace `const treeWidth = this.getWidth() || 0;` / `const rowWidth = Math.max(treeWidth, maxContentWidth);` with `const rowWidth = Math.max(scroller.getViewportWidth(), maxContentWidth);`. Remove the now-unused `treeWidth` local. Run step 6's test → green.

8. **Manual verification (browser).** `npm run dev`, open a Tree and a Table demo, shrink each window until a vertical scrollbar appears. Confirm: (a) arrow buttons step the scroll on click, accelerate while held, and shade on hover; the at-edge arrow is dimmed and inert; (b) the Tree no longer shows a spurious horizontal scrollbar and rows clip flush at the vertical-bar band; the selection highlight spans the full visible row width with no vertical-bar flicker; (c) the Table is unchanged (regression check for the Non-Goal).

9. **Regression checkpoint.** `grep -n 'this.getWidth()' src/typescript/lib/component/tree/Tree.ts` — confirm the row-width site no longer uses raw owner width. `npx tsc -p tsconfig.lib.json --noEmit` and `npx vitest run` both clean.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/container/Scrollbar.ts` (glyph `setPointerEvents("none")` in `ScrollArrowButton` ctor) |
| Modify | `src/typescript/lib/component/container/VirtualScroller.ts` (add public `getViewportWidth()`) |
| Modify | `src/typescript/lib/component/tree/Tree.ts` (`_renderWindow` uses `scroller.getViewportWidth()`) |
| Modify | `tests/component/container/Scrollbar.test.ts` (glyph pointer-events + arrow-delivery tests) |
| Modify | `tests/component/container/VirtualScroller.test.ts` (`getViewportWidth` + no-spurious-bar tests) |
| Modify | `tests/component/tree/Tree.test.ts` (row-width-to-effW test) |

---

## Expected Behaviour

**Issue 1 — arrow buttons (mixed unit + manual):**
- Each arrow's glyph child reports `pointer-events: none`. *(unit-testable — white-box getter)*
- A `mousedown` reaching an enabled arrow emits a `"scroll"` with the stepped, clamped position; the accelerating hold-repeat schedules further ticks. *(unit-testable for the first tick via a targeted-arrow dispatch; hold-repeat timing is manual)*
- A `mousedown` on a disabled (at-edge) arrow emits nothing (`_onMouseDown` early-returns on `_disabled`). *(unit-testable)*
- In a real browser, clicking anywhere on the 12×12 arrow (i.e. on the glyph) steps the scroll, and hovering shades the arrow background. *(manual — offline harness has no pointer-events hit-testing/retargeting)*

**Issue 2 — Tree fill width (mixed unit + manual):**
- `VirtualScroller.getViewportWidth()` returns `outerW − TRACK_WIDTH` when the vertical bar is visible (content taller than viewport) and the full `outerW` when it is not. *(unit-testable)*
- With content taller-but-not-wider than the viewport, the horizontal bar stays hidden: `getScrollX()` has no range (stays `0`), and Tree pool rows are sized to `effW = outerW − TRACK_WIDTH`, not full `outerW`. *(unit-testable)*
- When content is genuinely wider than `effW`, the horizontal bar still appears and `rowWidth` follows `maxContentWidth`. *(unit-testable)*
- In the running app, the spurious horizontal bar is gone, rows clip flush at the vertical-bar band, the selection highlight spans the full visible width, and there is no vertical-bar flicker across frames. *(manual)*

---

## Verification

- **Unit:** `npx vitest run tests/component/container/Scrollbar.test.ts tests/component/container/VirtualScroller.test.ts tests/component/tree/Tree.test.ts` — new tests green, existing green.
- **Full suite:** `npx vitest run` — no regressions (the Tree row-width change shrinks rendered rows by `TRACK_WIDTH` only when a vertical bar is present; confirm no width-golden test depends on the old full-width value).
- **Typecheck:** `npx tsc -p tsconfig.lib.json --noEmit` clean.
- **Grep invariant:** the `_renderWindow` row-width site no longer reads `this.getWidth()`.
- **Manual smoke (`npm run dev`):** per step 8 — Tree and Table windows shrunk to surface a vertical scrollbar; arrows react to click/hold/hover, at-edge arrow inert; Tree shows no spurious horizontal bar; Table behaviour unchanged.

---

## Potential Challenges

- **Offline harness cannot prove the retargeting.** `pointer-events: none` is a browser hit-testing behaviour; the test source has no hit-testing, so the fix's *effect* (clicks on the glyph reaching the arrow) is manual-only. The unit tests pin the glyph's `pointer-events` state and the handler chain instead — mitigation: keep step 1's white-box assertion so a future regression that drops the setter is caught.
- **First-frame `_lastRowWidth = 0`.** `getViewportWidth()` on the first render sees `_contentWidth = 0`; because the value only matters when content overflows vertically, `effW` still resolves to `outerW − TRACK_WIDTH` in that case and converges — mitigation: the reciprocal "content fits vertically" test pins the non-overflow branch.
- **Existing Tree width goldens.** A test asserting a pool row's width equal to the full owner width would now see `owner − 12` when a vertical bar is present — mitigation: run the full suite (step 9) and update any such assertion to the effective width, since the new value is the correct contract.

---

## Critical Files

- [`src/typescript/lib/core/Event.ts`](src/typescript/lib/core/Event.ts#L104) — window-level dispatcher; `addListener` exact-target routing (104-119) vs. `addSubtreeListener` ancestor walk (125-144). Confirms why the glyph swallows arrow events.
- [`src/typescript/lib/core/Component.ts`](src/typescript/lib/core/Component.ts#L3623) — `setPointerEvents` / `getPointerEvents` (the typed setter the fix routes through).
- [`src/typescript/lib/component/display/Glyph.ts`](src/typescript/lib/component/display/Glyph.ts) — the arrow's child; sets no `pointer-events` of its own, inherits `Component.setPointerEvents`.
- [`src/typescript/lib/component/container/VirtualScroller.ts`](src/typescript/lib/component/container/VirtualScroller.ts#L254) — `computeScrollbarVisibility` (two-pass mutual dependency), `layoutScrollbars`, `clampToContent`.
- [`src/typescript/lib/layout/Table.ts`](src/typescript/lib/layout/Table.ts#L103) — shows the Table already reserves the vertical bar (`availableWidth = containerSize.width − getScrollBarWidth()`); grounds the Non-Goal.
- `tests/dom/TestDOM.ts` — `installTestDOM`, `makeEvent`, `dispatchEvent`, `getId`/`intern` — the harness surface the new tests use.

---

## Non-Goals

- **Table Body fix.** The Table already reserves the vertical-scrollbar band **upstream** of the Body: [`layout/Table.ts:103`](src/typescript/lib/layout/Table.ts#L103) computes `availableWidth = containerSize.width − DOM.source.getScrollBarWidth()` and derives all `columnWidths` from it, then calls `body.renderWindow(availableWidth, columnWidths)`, so `Body._lastBodyWidth` (and hence `totalContentWidth`) already excludes a scrollbar's width. On desktop (Windows/Linux, native scrollbar ≈ 15-17px ≥ `TRACK_WIDTH` 12), `contentWidth ≤ effW`, so `computeScrollbarVisibility` never forces the spurious horizontal bar — the symptom does not occur. Retrofitting the `getViewportWidth()` accessor into the Body would entangle with the column-width and header-alignment math that is derived from the *native* `getScrollBarWidth()` reservation, a larger change than these two bugs warrant.
  - *Caveat recorded, not fixed:* on overlay-scrollbar platforms where `getScrollBarWidth()` returns `0` (e.g. macOS), `availableWidth` would equal the full width and the Table could show the same spurious 12px bar. That is a separate platform-dependent concern tied to the native-vs-custom track-width mismatch (`getScrollBarWidth()` vs. `TRACK_WIDTH`), out of scope here.
- **Reconciling `getScrollBarWidth()` with `TRACK_WIDTH`.** The native probe width and the custom 12px track are left as-is; unifying them is a broader change touching Table column math and the header scrollbar-cover band.
- **Removing the private `effectiveViewportW()`.** It stays as the internal clamp helper; `getViewportWidth()` is the public owner-facing face returning the same value. Collapsing the two is avoidable churn.
