# Resize Min/Max-Size Over-Travel Dead Zone — Implementation Plan

## Overview

Dragging a window edge or a table column past its **minimum** (or **maximum**) size lets the pointer keep travelling while the component stays clamped. On reversal the component resizes again *immediately* — even though the pointer is far from the coordinate where the clamp was hit — because the resize math accumulates from the **previously-applied (clamped) size** plus a **per-tick mouse delta**, rather than deriving the size from the **absolute pointer offset against a fixed drag origin**. The over-travel is silently lost, so the cursor and the resized edge decouple.

The bug lives in how each draggable handler reports movement and how its consumer applies it:

- **Window resize**: [WindowBorder.ts:188](../src/typescript/lib/component/container/WindowBorder.ts#L188) (`_dispatchDrag`) forwards the raw `MouseEvent` (absolute `clientX/clientY` available), but its consumer [core/Window.ts](../src/typescript/lib/core/Window.ts) computes the new size from per-move increments and clamps — losing over-travel.
- **Split-panel resize**: [SplitGutter.ts:213](../src/typescript/lib/component/container/SplitGutter.ts#L213) (`onDrag`) reads `evnt.movementX`/`evnt.movementY` (a **per-tick delta**, native-clamped to 0 at screen edges) and dispatches that delta; [layout/Split.ts](../src/typescript/lib/layout/Split.ts) accumulates it onto the prior pane size — the canonical buggy shape.
- **Table column resize**: [ResizeHandle.dragMove](../src/typescript/lib/component/table/cell/ResizeHandle.ts#L191) emits a per-tick `delta`; [Header.wireCell](../src/typescript/lib/component/table/Header.ts#L530) forwards it as `columnresize(idx, delta)`; [component/table/Table.ts](../src/typescript/lib/component/table/Table.ts) accumulates the delta onto the prior column width and clamps — same buggy shape.

The fix: every resize path must derive `newSize = originSize + (currentPointer − dragStartPointer)` and clamp **only that absolute result** at the min/max boundary. Over-travel beyond a boundary is then naturally absorbed (the clamp just keeps returning the boundary value), and reversal does nothing until `currentPointer` crosses back over the boundary coordinate. The reference implementation already exists in the codebase: [DragManager.onSourceMouseDown](../src/typescript/lib/core/DragManager.ts#L250) records `startX/startY` at mousedown and [DragManager.onMouseMove](../src/typescript/lib/core/DragManager.ts#L415) works off `e.clientX − session.startX` — the correct origin-relative shape.

---

## Architecture Decisions

### Parallel fixes, not one shared fix — the clamp math is decentralised

There is no central "resize controller." Three independent consumers (`Window`, `Split`, `Table`) each own their own clamp math, fed by three independent handlers (`WindowBorder`, `SplitGutter`, `ResizeHandle`+`Header`). What they share is **only the origin-relative offset** (`current − originPointer`); the clamp+apply that consumes it genuinely diverges:

- **Window** ([flushResize](../src/typescript/lib/core/Window.ts#L991)) — a single edge, **2D**, an 8-case `Direction` switch, **position-coupled** (WEST/NORTH move `x`/`y` as they resize), with the clamp living *inside* `setWidth`/`setHeight` via `getMinSize()` (no call-site clamp).
- **Split** ([onDrag](../src/typescript/lib/layout/Split.ts#L92)) — an **adjacent pair**, zero-sum (lhs grows, rhs shrinks by the same amount), with no explicit call-site clamp today — it leans on `setWidth`'s floor.
- **Table** ([onColumnResize](../src/typescript/lib/component/table/Table.ts#L704)) — an adjacent pair with **two-sided min/max redistribution**: overflow past one column's `min` is pushed onto its neighbour (`w1 += w0 − min0`) and re-checked. This is the only site that cannot be expressed as a scalar `Math.max(min, Math.min(max, x))`.

A single shared *clamp* helper would fit Window awkwardly, Split partially, and Table not at all, so it is **not** worth a central abstraction. Each path therefore gets the offset fix applied locally against its own clamp. This matches the existing architecture and keeps changes surgical.

> **Optional consolidation (implementer's call).** The one piece that *is* identical across all three is the per-drag **origin bookkeeping** the steps below add to each consumer (`originPointer` + `originSize`, an `originCaptured` flag, capture-at-mousedown, reset-at-dragend). Being the exact bookkeeping each path historically got wrong, it is the real regression risk for any future resize surface. If regression-resistance is valued over a minimal diff, extract a ~10-line value holder — capture once, read the offset each move — and reuse it from all three; [DragManager](../src/typescript/lib/core/DragManager.ts#L250) already models this session concept and is the pattern to mirror. If the three sites are unlikely to grow, leaving the fields inline is acceptable — the compiler enforces the payload migration regardless. **This is the only consolidation on the table; the clamp stays decentralised either way.**

### Carry the absolute pointer coordinate, not a per-tick delta

The root cause is that two of the three handlers (`SplitGutter`, `ResizeHandle`/`Header`) emit a **per-tick delta** (`movementX` / `movementY` / forwarded `delta`). A per-tick delta is fundamentally lossy for clamping: once the consumer clamps, the deltas it discarded during over-travel can never be recovered, so the consumer cannot know when the pointer has returned to the boundary. The fix must change these handlers to emit the **absolute pointer coordinate** (`clientX`/`clientY`) for the move, and each consumer must capture the **origin pointer coordinate + origin size at drag start** and recompute `origin + (current − originPointer)` every move. `WindowBorder` already forwards the full `MouseEvent`, so its consumer change is purely in `Window`.

This is an event-payload change on `SplitGutter` (`drag`) and on the column-resize chain (`ResizeHandle` `dragmove` / `Header` `columnresize`). Per CODE_CONVENTIONS the `on`/`emit` overload signatures, the JSDoc `@param` lines, and the `*Options.listeners` types must all be updated in lockstep. **The implementer MUST confirm there are no other consumers of these events** (`grep` invariants in Verification) before changing the payload — the migration is breaking for any out-of-tree listener.

### Clamp the absolute result, not the increment

Each consumer must keep clamping at min/max (window min/max size, pane min size, column min/max width), but apply the clamp to `origin + offset` rather than to `previous + increment`. The clamp expression itself (`Math.max(min, Math.min(max, candidate))`) is unchanged; only its input changes from an accumulated running size to a freshly-recomputed origin-relative size. This is what makes over-travel idempotent: feeding an ever-more-negative offset into `Math.max(min, …)` just keeps returning `min`.

### Drag origin captured at drag start, held for the drag's lifetime

Each consumer needs two new pieces of per-drag state captured once at `dragstart` (mousedown): the **origin pointer coordinate** and the **origin size** (window width/height, pane size, or column width at the moment the drag began). These live as private fields on the consumer, set in the dragstart handler and read in the dragmove handler. They do **not** need to survive past `dragend`; no teardown beyond leaving the stale values (overwritten next dragstart) is required, matching how `DragManager`'s session fields work.

---

## Public API (TypeScript Signatures)

No new exported symbols. The change is to existing event payloads. Signatures that move from a delta to an absolute coordinate:

```typescript
// SplitGutter — drag now carries the absolute pointer coordinate in the drag axis.
export interface SplitGutterOptions extends ComponentOptions {
    orientation?: string;
    listeners?: {
        drag?: (position: number) => void;   // was: (movement: number) => void
    };
}
class SplitGutter extends Component<SplitGutterOptions> {
    on(event: "drag", listener: (position: number) => void): this;        // axis-absolute clientX/clientY
    protected emit(event: "drag", position: number): void;
}
```

```typescript
// ResizeHandle — dragmove now carries the absolute pointer X; a new dragstart payload carries the origin X.
export interface ResizeHandleOptions extends ComponentOptions {
    listeners?: {
        dragstart?: (event: MouseEvent) => void;   // unchanged — MouseEvent already carries clientX
        dragmove?:  (clientX: number)   => void;    // was: (delta: number) => void
        dragend?:   ()                  => void;
    };
}
class ResizeHandle extends Component<ResizeHandleOptions> {
    on(event: "dragmove", listener: (clientX: number) => void): this;     // was (delta: number)
    dragMove(clientX: number): void;                                       // was dragMove(delta: number)
}
```

```typescript
// Header — columnresize now carries the absolute pointer X (consumer subtracts its captured origin X).
class Header extends Component {
    on(event: "columnresize", listener: (colIndex: number, clientX: number) => void): this;  // was (…, delta: number)
    protected emit(event: "columnresize", colIndex: number, clientX: number): void;
}
```

`WindowBorder`'s `drag` event already forwards the `MouseEvent` (which carries `clientX/clientY`), so **its public signature is unchanged**; only `Window`'s consuming handler changes.

> **Implementer note:** the exact column-resize chain in `Header` involves `HeaderCell`'s `resizedrag` event ([Header.wireCell:532](../src/typescript/lib/component/table/Header.ts#L532) wires `cell.on("resizedrag", (delta) => …)`). Read `component/table/cell/Header.ts` (`HeaderCell`) and confirm whether `HeaderCell` re-emits the `ResizeHandle` delta verbatim or transforms it. The payload migration must be threaded through `HeaderCell.resizedrag` as well — its overload, JSDoc, and any `dragMove` call site that supplies `movementX` must switch to `clientX`. This file was not readable during planning (tool outage) and MUST be read first.

---

## Internal Structure

The **offset computation** is identical across all three consumers; the clamp+apply that follows is per-site (see Architecture Decisions). The common shape:

```typescript
// At dragstart (mousedown):
this._dragOriginPointer = startClientCoord;   // e.clientX or e.clientY in the drag axis
this._dragOriginSize    = currentSize;        // window width/height | pane size | column width

// At each dragmove (now receiving absolute pointer coord, not a delta):
const offset    = currentClientCoord - this._dragOriginPointer;
const candidate = this._dragOriginSize + offset;     // sign per edge (WEST/NORTH subtract)
const clamped   = Math.max(min, Math.min(max, candidate));
this.applySize(clamped);   // existing setter path (setWidth / setHeight / column width)
```

For window WEST/NORTH/NORTHWEST/SOUTHWEST edges the offset is **subtracted** (dragging the left edge right shrinks width while X increases), and the window's `x`/`y` position must move with the resized edge — preserve the existing position-adjustment logic in `Window`, just feed it the origin-relative clamped size. The implementer must read `core/Window.ts` to map each `Direction` to its sign and position coupling; do not assume.

---

## Ordered Implementation Steps

1. **Read the three consumer files first** — `core/Window.ts`, `layout/Split.ts`, `component/table/Table.ts` — plus `component/table/cell/Header.ts` (`HeaderCell`). These were not readable during planning. Confirm for each: where the drag listener is registered, what running-size field it accumulates onto, and the exact clamp expression / min-max source. (Verify: locate the `Math.max(min, …)` or equivalent clamp in each.)

2. **WindowBorder path (`core/Window.ts` only).** `WindowBorder._dispatchDrag` already forwards the `MouseEvent`; do not touch `WindowBorder.ts`. The current `Window` code is the accumulating shape: [onResize:933](../src/typescript/lib/core/Window.ts#L933) sums `e.movementX/Y` into `_pendingMouseDX/_pendingMouseDY`, and [flushResize:969](../src/typescript/lib/core/Window.ts#L969) applies them as `this.getX() + dx` / `this.getWidth() ± dx` per `Direction`. Replace the movement accumulation with an origin capture: on the drag's first `onResize` of a session (the border has no mousedown hook exposed to `Window`, so capture lazily, guarded by a per-drag flag reset when the border drag ends), store `_resizeOriginX/Y` from `e.clientX/Y` plus `_resizeOriginPosX/Y` and `_resizeOriginW/H` from current geometry. In `flushResize`, compute `offsetX = e.clientX − _resizeOriginX` (carry the latest clientX through `_pendingClientX/Y` instead of accumulating movement), then per `Direction` apply `origin ± offset` and let `setWidth`/`setHeight` (which already clamp to `getMinSize`) absorb the over-travel; WEST/NORTH additionally adjust `setX`/`setY` from the clamped size. → verify: dragging WEST past min then reversing does not resize until X passes the clamp coordinate; the existing min-clamp in `setWidth`/`setHeight` still fires.

3. **SplitGutter handler (`SplitGutter.ts`).** Change `onDrag` to read `evnt.clientX`/`evnt.clientY` (axis-absolute) instead of `evnt.movementX`/`evnt.movementY`, and dispatch that. Update `_dispatchDrag` param name, the `on`/`emit` `"drag"` overloads, the JSDoc `@param`, and `SplitGutterOptions.listeners.drag` from `movement` to `position`. → verify: `tsc` passes; payload type reads `position: number`.

4. **Split consumer (`layout/Split.ts`).** Capture pane origin size + origin pointer coordinate at gutter `mousedown`/dragstart; on each `drag(position)` compute `originSize + (position − originPointer)`, clamp at the pane min size, apply. Remove the old running-accumulation. → verify: drag a split pane to min, over-travel, reverse — pane stays at min until pointer returns to the boundary.

   > Note: `SplitGutter` fires `drag` only on `mousemove`, not on `mousedown`. The consumer must capture the origin in a `mousedown`/dragstart hook (the gutter's `onDragStart` runs on mousedown — see [SplitGutter.onDragStart:185](../src/typescript/lib/component/container/SplitGutter.ts#L185)). Decide whether to expose a `dragstart` event on `SplitGutter` (mirroring `ResizeHandle`) or capture origin lazily on the first `drag` of a session. Lazy-on-first-move is simpler and avoids a new event; prefer it unless `Split` already needs an explicit dragstart.

5. **ResizeHandle handler (`ResizeHandle.ts`).** Rename `dragMove(delta)` → `dragMove(clientX)`, update the `"dragmove"` `on`/`emit` overloads, the JSDoc, and `ResizeHandleOptions.listeners.dragmove` from `delta` to `clientX`. `dragstart` already carries the `MouseEvent` (origin `clientX` available). → verify: `tsc` passes.

6. **Header chain (`Header.ts` + `cell/Header.ts`).** Update `HeaderCell.resizedrag` payload and `Header.wireCell`'s `cell.on("resizedrag", …)` to forward `clientX`; change `Header`'s `"columnresize"` `on`/`emit` overloads + JSDoc from `delta` to `clientX`. Trace the host's viewport-mousemove handler (the one that currently extracts `movementX` and calls `handle.dragMove`) and switch it to pass `e.clientX`. → verify: `grep` shows no remaining `movementX` feeding the column-resize path.

7. **Table consumer (`component/table/Table.ts`).** On `columnresize` dragstart, capture origin column width + origin `clientX`; on each move compute `originWidth + (clientX − originX)`, clamp at the column min/max width, apply. Remove the old accumulate-and-clamp. → verify: drag a column to min width, over-travel left, reverse right — column stays at min until X returns to the boundary; repeat for max if columns have a max.

8. **Decide origin-capture timing consistently.** For each path, capture the origin pair (pointer coord + size) at the drag's mousedown, not on the first mousemove, when a mousedown hook is already available (WindowBorder/ResizeHandle both fire on mousedown). This avoids a one-frame skew between the first move's delta and the origin. Where only a move event is available (SplitGutter lazy approach), guard with a per-drag `originCaptured` flag reset at dragend. → verify: no first-move jump; the edge tracks the cursor 1:1 within bounds.

9. **Full typecheck + manual smoke** across all three surfaces (see Verification).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/container/SplitGutter.ts` — `onDrag` reads absolute `clientX/Y`; rename `movement`→`position` across `on`/`emit`/JSDoc/options |
| Modify | `src/typescript/lib/layout/Split.ts` — capture pane origin size + origin pointer; compute `origin + offset`, clamp |
| Modify | `src/typescript/lib/component/table/cell/ResizeHandle.ts` — `dragMove`/`dragmove` payload `delta`→`clientX` |
| Modify | `src/typescript/lib/component/table/cell/Header.ts` — `HeaderCell.resizedrag` payload + host move handler pass `clientX` (read first) |
| Modify | `src/typescript/lib/component/table/Header.ts` — `columnresize` payload `delta`→`clientX`; `wireCell` forward |
| Modify | `src/typescript/lib/component/table/Table.ts` — capture origin column width + origin X; compute `origin + offset`, clamp |
| Modify | `src/typescript/lib/core/Window.ts` — capture origin geometry + origin pointer; compute `origin + offset` per `Direction`, clamp, couple position |
| Unchanged | `src/typescript/lib/component/container/WindowBorder.ts` — already forwards the `MouseEvent` |
| Unchanged | `src/typescript/lib/core/DragManager.ts` — reference for the correct origin-relative shape |

---

## Verification

- **Typecheck:** `npm run build` / `tsc` — 0 errors. The payload-rename ripples through `on`/`emit` overloads, `*Options.listeners`, and every consumer; the compiler is the primary guard that none were missed.
- **No stale delta consumers:** `grep -rn 'movementX\|movementY' src/typescript/lib/component/container/SplitGutter.ts src/typescript/lib/component/table` — expect zero matches in the resize paths after the change.
- **No out-of-tree event payload consumers left on the old shape:** `grep -rn 'on("drag"\|columnresize\|dragmove\|resizedrag' src/` and confirm each call site reads the new absolute-coordinate payload (not `movement`/`delta`).
- **Manual smoke (app on http://localhost:8015):**
  - *Window:* drag the WEST edge right past min width, continue ~100 px further, then reverse left — the window must NOT widen until the cursor passes back over the coordinate where min was hit. Repeat for EAST/SOUTH/NORTH and for max size if maximised constraints apply. Confirm the dragged edge stays glued to the cursor within bounds (no offset drift).
  - *Split:* same over-travel-and-reverse test on a split-panel gutter against the pane min size.
  - *Table column:* same test on a column resize handle against the column min (and max if defined). The MiscPanel slow-table screen is a good stress surface.
- Chrome DevTools MCP (`mcp__chrome-devtools__drag`) can script the over-travel/reverse gesture for a repeatable check.

---

## Potential Challenges

- **Per-tick `movementX` is native-clamped at screen edges**, so the *current* behaviour additionally stalls when the cursor hits the monitor edge — switching to `clientX` (also clamped at the viewport edge) fixes the in-bounds disconnect but cannot resize beyond the viewport; acceptable and matches `DragManager`.
- **Breaking payload change**: any listener outside the three known consumers that reads the `drag`/`columnresize`/`dragmove` payload as a delta will silently misbehave (absolute coordinate where a delta was expected). The `grep` invariants above are the mitigation — run them before declaring done.
- **WEST/NORTH sign + position coupling** in `Window`: dragging the left/top edge must move the window origin as it resizes; feed the clamped origin-relative size into the *existing* position logic rather than rewriting it, to avoid regressing the maximize/snap behaviour added in `window-maximize-minimize-and-snap-resize`.
- **Origin-capture timing**: capturing the origin on the first mousemove instead of mousedown introduces a one-frame offset equal to the threshold travel. Capture at mousedown wherever a mousedown hook exists (step 8).
- **`HeaderCell` re-emission**: the column-resize delta is forwarded through `HeaderCell.resizedrag` before reaching `Header`; missing that hop leaves a delta-shaped payload mid-chain. Read `cell/Header.ts` first (it was unreadable during planning).

---

## Critical Files

- [src/typescript/lib/core/DragManager.ts:250](../src/typescript/lib/core/DragManager.ts#L250) — **reference implementation** of the correct origin-relative shape (`startX/startY` captured at mousedown, `e.clientX − session.startX` at move).
- [src/typescript/lib/component/container/WindowBorder.ts:188](../src/typescript/lib/component/container/WindowBorder.ts#L188) — `_dispatchDrag` forwards the full `MouseEvent`; consumer-side fix only.
- [src/typescript/lib/component/container/SplitGutter.ts:213](../src/typescript/lib/component/container/SplitGutter.ts#L213) — `onDrag` reading `movementX/Y` (buggy per-tick delta).
- [src/typescript/lib/component/table/cell/ResizeHandle.ts:191](../src/typescript/lib/component/table/cell/ResizeHandle.ts#L191) — `dragMove(delta)` (buggy per-tick delta).
- [src/typescript/lib/component/table/Header.ts:530](../src/typescript/lib/component/table/Header.ts#L530) — `wireCell` forwards `delta` as `columnresize`.
- `src/typescript/lib/core/Window.ts`, `src/typescript/lib/layout/Split.ts`, `src/typescript/lib/component/table/Table.ts`, `src/typescript/lib/component/table/cell/Header.ts` — **the four files holding the clamp math; read in full before editing** (not readable during planning due to a tool outage; their exact clamp expressions and min/max sources must be confirmed).
- `CODE_CONVENTIONS.md` — typed setters, `Event` class for listeners, lockstep `on`/`emit`/JSDoc/options updates on any event-payload change.

---

## Non-Goals

- No new central "ResizeController" abstraction — the **clamp math** stays decentralised across the three paths (Architecture Decisions). This does not preclude the optional shared origin-bookkeeping holder noted there, which carries no clamp logic.
- No change to the 4 px drag threshold, snap, or maximize/minimize behaviour.
- No touch-event-specific rework beyond mirroring the mouse change (the handlers already share a move handler for `touchmove`; `clientX/clientY` exist on touch points via the existing event normalisation — confirm at implementation, do not add new touch plumbing).
- No change to `WindowBorder` / `ResizeHandle` box geometry, cursors, or theming.
