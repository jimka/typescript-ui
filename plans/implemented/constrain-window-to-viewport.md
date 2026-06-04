# Constrain Window To Viewport — Implementation Plan

## Overview

A [`Window`](../src/typescript/lib/core/Window.ts) can currently be dragged by its header until it lies entirely outside the browser viewport and dropped there, leaving it unreachable (no header to grab). This plan constrains header-drag movement so the window's title bar always stays partly inside the viewport — both *during* the drag (it visually stops at the edge) and on drop.

The drag path lives entirely in `Window.ts`: the session starts in [`onMouseDown`](../src/typescript/lib/core/Window.ts#L947), every pointer move accumulates a delta and paints a compositor translate in [`onDrag`](../src/typescript/lib/core/Window.ts#L1130), and the final position is committed to `left`/`top` in [`onMouseUp`](../src/typescript/lib/core/Window.ts#L1144). The clamp is a pure-internal geometry change confined to these methods — no new public API.

---

## Architecture Decisions

### Clamp the accumulated delta, not `left`/`top` — the single chokepoint is `onDrag`

During a drag the cached `left`/`top` deliberately stay frozen at the start position; the window is moved purely by `setTranslate(_dragDX, _dragDY)` ([`onDrag:1138`](../src/typescript/lib/core/Window.ts#L1138)). `onMouseUp` then commits `setX(_dragStartLeft + _dragDX)` / `setY(_dragStartTop + _dragDY)` ([1147-1148](../src/typescript/lib/core/Window.ts#L1147)). So the one value that determines the on-screen position throughout the whole gesture is the pair `(_dragDX, _dragDY)`. Clamping those two accumulators in `onDrag` — *before* the `setTranslate` call — makes the window visually stop at the edge during the drag, and because `onMouseUp` reads the same fields, the drop position is automatically clamped too with no second clamp site. This is the correct single chokepoint; clamping inside `setX`/`setY` instead is rejected because those setters are also used by resize, maximize, dock, and viewport-resize paths that legitimately place the window flush to `x=0`/edges, and a movement-only constraint must not bleed into them.

### Clamp policy — keep the header grabbable, derived from current geometry

Let `w = this.getWidth()`, `headerH = this._header.getHeight()` (the same accessor `computeDockRect`/`relayoutMinimizedStack` use, with the same `|| 26` fallback for the pre-measure case), `vw = window.innerWidth`, `vh = window.innerHeight`, and a constant `EDGE_MARGIN_PX = 24` (must-stay-visible slab of the window along each clamped edge — wide enough to grab, narrow enough not to feel restrictive).

The committed top-left `(x, y)` is bound to:

- `x ∈ [EDGE_MARGIN_PX - w, vw - EDGE_MARGIN_PX]` — left edge may travel off-screen-left until only `EDGE_MARGIN_PX` of the window's right side remains visible, and off-screen-right until only `EDGE_MARGIN_PX` of its left side remains. The header (full window width) therefore always exposes at least a 24 px grab strip horizontally.
- `y ∈ [0, vh - headerH]` — the header's top can't go above the viewport (you can't reach a title bar scrolled above `y=0`, and there is no page scroll on `document.documentElement` for a fixed/absolute overlay) and can't drop below the point where the entire header has left the bottom. The whole header band thus stays on-screen vertically, which is the band the user grabs.

Because `onDrag` only knows deltas, convert: target `x = _dragStartLeft + _dragDX`, clamp to the range above, then write back `_dragDX = clampedX - _dragStartLeft` (and symmetrically for Y). This keeps the accumulator authoritative so `onMouseUp` needs no change.

### No new public API — internal constant only

Per Simplicity-First, the margin is a module-level `const EDGE_MARGIN_PX = 24` alongside the existing `WINDOW_ANIM_DURATION_MS` / `SNAP_DOCK_GAP_PX` / `DEFAULT_MIN_DOCK_WIDTH_PX` constants ([Window.ts:17-19](../src/typescript/lib/core/Window.ts#L17)). No `WindowOptions` field, setter, or cached `_field` is added — the user asked only to prevent loss off-screen, not to make the margin configurable. (If a configurable margin is later wanted it would follow the typed-setter + `_field` + `WindowOptions` cascade convention, but that is out of scope here.)

### Helper method to hold the clamp math

Extract a private `clampDragDelta(): void` that mutates `_dragDX`/`_dragDY` in place, called as the first statement of `onDrag` after the delta accumulation. This keeps `onDrag` readable (accumulate → clamp → translate) and isolates the viewport/width reads. It is single-use but earns its place by separating the reusable geometry mechanic from the call site, which CODE_CONVENTIONS permits.

---

## Internal Structure

`onDrag` after the change (shape, not final text):

```typescript
onDrag(e: MouseEvent) {
    e.preventDefault();

    this._dragDX += e.movementX;
    this._dragDY += e.movementY;

    this.clampDragDelta();   // keeps the header inside the viewport

    this.setTranslate(this._dragDX, this._dragDY);
}
```

`clampDragDelta` (new private method):

```typescript
private clampDragDelta(): void {
    const w        = this.getWidth();
    const headerH  = this._header.getHeight() || 26;
    const vw       = window.innerWidth;
    const vh       = window.innerHeight;

    const minX = EDGE_MARGIN_PX - w;
    const maxX = vw - EDGE_MARGIN_PX;
    const minY = 0;
    const maxY = vh - headerH;

    const targetX = this._dragStartLeft + this._dragDX;
    const targetY = this._dragStartTop  + this._dragDY;

    const clampedX = Math.min(Math.max(targetX, minX), maxX);
    const clampedY = Math.min(Math.max(targetY, minY), maxY);

    this._dragDX = clampedX - this._dragStartLeft;
    this._dragDY = clampedY - this._dragStartTop;
}
```

`Math.min(Math.max(...))` (not a separate clamp util) matches the existing inline clamping idiom in `setWidth`/`setHeight` ([325-332](../src/typescript/lib/core/Window.ts#L325)). When the window is wider than `vw - 2·EDGE_MARGIN_PX` the range stays valid (`minX < maxX`); for the degenerate case where `w` is so large `minX > maxX` the `Math.max` then `Math.min` ordering pins `x` to `maxX` (left edge visible), which is the safe choice.

---

## Ordered Implementation Steps

1. **Add the margin constant.** In [Window.ts](../src/typescript/lib/core/Window.ts#L19), after `DEFAULT_MIN_DOCK_WIDTH_PX`, add `const EDGE_MARGIN_PX: number = 24;` with a one-line comment explaining it is the must-stay-visible slab of a window edge during drag.
2. **Add `clampDragDelta`.** Insert the private method (body above) directly before [`onDrag`](../src/typescript/lib/core/Window.ts#L1130) with a JSDoc block per CODE_CONVENTIONS.
3. **Call it from `onDrag`.** Insert `this.clampDragDelta();` between the `_dragDX`/`_dragDY` accumulation ([1133-1134](../src/typescript/lib/core/Window.ts#L1133)) and the `setTranslate` call ([1138](../src/typescript/lib/core/Window.ts#L1138)).
4. **Confirm `onMouseUp` needs no edit** — it reads the now-clamped `_dragDX`/`_dragDY`; verify by reading [1144-1154](../src/typescript/lib/core/Window.ts#L1144), expect no change required.
5. **Typecheck:** `npm run build` (or the project's tsc task) — expect 0 errors.

---

## Files to Create / Modify / Delete

| Action | File |
|--------|------|
| Modify | `src/typescript/lib/core/Window.ts` |

---

## Verification

- **Typecheck:** the project's TypeScript build passes with 0 errors.
- **Manual smoke (dev app, http://localhost:8015):** open a `Window`, drag the header hard toward each edge and each corner and release. Expected at every edge: at least ~24 px of the window stays inside, the header band stays fully visible at the top, and the window remains grabbable. Confirm the window visually *stops* at the edge mid-drag (does not overshoot then snap back on release).
- **Regression:** verify normal in-viewport dragging is unchanged (no jitter, follows the cursor 1:1 until a bound is hit); verify resize handles still push edges to `x=0`/flush positions (resize path untouched); verify maximize, minimize/dock, and double-click restore still place the window correctly (those paths call `setX`/`setY` directly and are not affected by the `onDrag` clamp).
- No `npm run docs:build` needed — no public API or JSDoc-exported surface changes.

---

## Critical Files

- [`src/typescript/lib/core/Window.ts`](../src/typescript/lib/core/Window.ts) — `onMouseDown` (drag start / `_dragStart*` snapshot, 947), `onDrag` (accumulate + translate, 1130), `onMouseUp` (commit, 1144); existing geometry accessors `getWidth`/`getX`/`getY`; the `window.innerWidth`/`innerHeight` and `this._header.getHeight() || 26` idioms in `computeDockRect` (1309) and `relayoutMinimizedStack` (1345).
- [`src/typescript/lib/component/container/WindowHeader.ts`](../src/typescript/lib/component/container/WindowHeader.ts) — confirms `getHeight()` (inherited from Component) is the header-height source; no change here.

---

## Follow-up extensions (post-plan)

After the original move-only clamp shipped, two interaction bugs surfaced and a follow-up request extended the scope; all three landed as separate commits on this branch:

- **Drag detach at the edge (fix).** The header drag accumulated `e.movementX` into `_dragDX`, and the new `clampDragDelta` writeback discarded the over-travel at an edge, so reversing direction left a permanent cursor↔window offset. Fixed by switching the drag to the absolute pointer-origin model the resize path already uses: `onMouseDown` captures `_dragOriginClientX/Y`, and `onDrag` recomputes the delta from `clientX/clientY − origin` each move instead of accumulating, so the clamp can't drift.
- **Resize off-screen (now handled).** `flushResize` caps each dragged edge with a viewport-derived `Math.min` before `setWidth`/`setHeight` apply their own min/max — east/south can't pass the far viewport edge, west/north can't pass zero. The cap is on the *size* so the existing WEST/NORTH position re-derivation stays consistent. This supersedes the original "Resize off-screen" Non-Goal below.

## Non-Goals

- **Re-clamping on browser-window resize.** A window already on-screen could be left off-screen if the viewport shrinks afterward. Handling this would require a global `resize` listener for `"normal"`-state windows (the existing `onViewportResize` only fires while maximized) plus a re-clamp pass — added complexity beyond "can't drag it off-screen," so it is out of scope.
- **Configurable margin.** The 24 px slab is a fixed internal constant; no `WindowOptions`/setter is added.
