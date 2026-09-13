---
depends-on: [window-snap-border-coalescing]
---

# AbstractWindow Throttle Consolidation — Implementation Plan

## Overview

`AbstractWindow` hand-rolls the same per-frame coalescing mechanic twice, independently. Border resize
([`onResize`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2024) /
[`flushResize`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2104)) buffers the latest
pointer position and applies it on a `requestAnimationFrame`, capped to a configurable rate
(`_resizeFps`, default 60, via public `getResizeFps`/`setResizeFps`). The Ctrl-snap border-highlight
preview ([`onSnapMouseMove`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3227) /
[`flushSnapMouseMove`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3262)) buffers the
latest pointer position the same way, uncapped, and adds a force-flush at
[`onSnapMouseDown`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3336) since that feature
commits its result at `mousedown` rather than waiting for `mouseup`. Both exist to avoid running an
expensive synchronous layout read (`doLayout()` for resize, `pickSnapBorder`'s up-to-eight
`getElementRect` calls for snap) once per raw `mousemove` instead of once per rendered frame.

This plan factors the shared mechanic — buffer the latest value, apply it at most once per animation
frame, optionally rate-capped, with an explicit force-flush and an explicit cancel — into one private
generic class, `PerFrameCoalescer<T>`, declared in the same file and instantiated twice: once for
resize (with the fps cap) and once for the snap preview (without one). No other file changes. No
geometry or interaction behaviour changes: `onResize`'s early-return guards, origin capture, and
geometry math stay exactly as they are today, and so does `pickSnapBorder` and the highlight logic —
only the buffering/scheduling code they sit inside moves into the shared class.

No public API changes — `getResizeFps`/`setResizeFps` keep their exact signatures and behaviour; every
other symbol touched is `private`.

This plan depends on `window-snap-border-coalescing` (the plan that added `onSnapMouseMove`/
`flushSnapMouseMove` in the first place). On `master` today that plan is not yet in
`plans/implemented/`, and `AbstractWindow.ts` there has no `flushSnapMouseMove` at all — only the
uncoalesced `onSnapMouseMove`. Start this plan from the branch where `window-snap-border-coalescing` is
implemented (at the time of writing, the tip of the stacked `feature/virtual-row-view-resize-relayout`
branch), not from bare `master`.

---

## Architecture Decisions

### One private generic class, instantiated twice — not a shared instance

`AbstractWindow` gains a private, non-exported top-level class `PerFrameCoalescer<T>` (declared
immediately before the `AbstractWindow` class itself) with `schedule(value)`, `forceFlush()`, and
`cancel()`. `AbstractWindow` holds two `readonly` instances: `_resizeCoalescer`, constructed with a
live fps thunk, and `_snapMoveCoalescer`, constructed with no fps thunk (uncapped). Each instance keeps
its own private pending value and its own `requestAnimationFrame` handle — nothing is shared between
the two mechanisms at runtime, only the code that implements "buffer one value, flush on a frame" is
shared.[^why-instances-not-fields]

This mirrors the shape every other per-frame coalescing fix in this codebase already uses — a private
pending-value field plus a private rAF-handle field plus schedule/flush methods
(`Split.scheduleDrag`/`flushDrag`, `Accordion`'s gutter-drag coalescing, `Panel`'s scroll-metrics
resize coalescing, `DragManager`'s module-scoped pointer coalescing) — just deduplicated within this
one file instead of hand-rolled a second time in it.[^cross-file-precedent]

### The class stays private to this file, not extracted to a shared module

None of `Split`, `Accordion`, `Panel`, `ScrollStrip`, `VirtualRowView`, or `DragManager` shares this
mechanic through a common base or utility today — each hand-rolls its own copy. Extracting
`PerFrameCoalescer` into its own exported module would introduce a new cross-file pattern the codebase
has consistently not adopted, which is a bigger and separately-justified decision than the one this
plan is scoped to (see `## Non-Goals`). Keeping the class un-exported and file-local removes the
in-file duplication this plan targets without asking the rest of the codebase to change how it solves
the same problem.

### The fps cap is a constructor-supplied thunk, read fresh every frame

`_resizeCoalescer` is constructed with `() => this._resizeFps` rather than a fixed number, so a
`setResizeFps` call mid-drag changes the active cap on the very next frame — exactly like today, where
`flushResize` reads `this._resizeFps` directly on every invocation. `_snapMoveCoalescer` is constructed
with no second argument; `PerFrameCoalescer` treats a missing thunk as "no cap, apply on the next
frame," matching `flushSnapMouseMove`'s current uncapped behaviour exactly.

### `forceFlush()` bypasses the fps cap; only the snap coalescer calls it

`forceFlush()` cancels any armed frame and applies the buffered value immediately, ignoring the fps
gate. `onSnapMouseDown` calls it, matching today's cancel-then-`flushSnapMouseMove()` sequence exactly.
`onResizeEnd`, `onExitAction`, and `setWindowState` — the only teardown paths for the resize coalescer —
call `cancel()`, never `forceFlush()`, so this new method is never exercised by the resize instance.
Bypassing the cap on force-flush is correct in principle (a caller reaching for `forceFlush` needs the
freshest value *now*, which is exactly why `Split.onDragEnd` and `onSnapMouseDown` already do the
equivalent cancel-then-flush today), but it introduces no behaviour change for resize since nothing
calls it there.

### `cancel()` replaces four hand-written cancel blocks

Today, four call sites each inline their own "if a handle is set, cancel it, null it" block:
`onExitAction` and `setWindowState` for the resize handle, and `detachSnapMouseListeners` (reached from
`clearSnapState` and `onExitAction`) for the snap handle, plus `detachSnapMouseListeners`'s separate
`_pendingSnapMove = null`. All four become one call each to `.cancel()` on the relevant coalescer,
which cancels the frame and clears the pending value in one place instead of two.

---

## Public API

No signature changes. Listed for completeness — both already exist and are unchanged:

```typescript
getResizeFps(): number;
setResizeFps(fps: number): this;
```

---

## Internal Structure

### `PerFrameCoalescer<T>`

Declared at top level, immediately before `export abstract class AbstractWindow`
([:247](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L247)) — not exported.

```typescript
/**
 * Buffers the latest not-yet-applied value from a high-frequency event (e.g.
 * `mousemove`) and applies it at most once per animation frame, optionally
 * capped to a slower rate. Only the most recent value before a frame lands is
 * kept — an intermediate value between two events was never going to be
 * visible anyway. `T` must not itself use `null` as a meaningful value: `null`
 * is the buffer's own "nothing pending" sentinel.
 */
class PerFrameCoalescer<T> {
    private _pending: T | null = null;
    private _rafHandle: number | null = null;
    private _lastFlushTime: number = 0;
    private readonly _apply: (value: T) => void;
    private readonly _fps?: () => number;

    /**
     * @param apply - Called with the most recent buffered value when a frame
     *   (or a {@link forceFlush}) applies it.
     * @param fps - Optional live frames-per-second cap, read fresh on every
     *   frame so a setter can change it mid-flight. Omit for no cap.
     */
    constructor(apply: (value: T) => void, fps?: () => number) {
        this._apply = apply;
        this._fps = fps;
    }

    /**
     * Buffers `value`, overwriting any not-yet-applied value, and arms a
     * `requestAnimationFrame` if one isn't already pending.
     */
    schedule(value: T): void {
        this._pending = value;

        if (this._rafHandle === null) {
            this._rafHandle = DOM.sink.requestAnimationFrame((ts) => this.onFrame(ts));
        }
    }

    /**
     * The `requestAnimationFrame` callback. Re-arms itself without draining
     * the buffer when the fps cap says it's too soon; otherwise applies the
     * buffered value.
     */
    private onFrame(timestamp: number): void {
        const fps = this._fps?.();
        if (fps !== undefined && timestamp - this._lastFlushTime < 1000 / fps) {
            this._rafHandle = DOM.sink.requestAnimationFrame((ts) => this.onFrame(ts));
            return;
        }

        this._lastFlushTime = timestamp;
        this._rafHandle = null;
        this.drain();
    }

    /**
     * Cancels any pending frame and applies the buffered value immediately,
     * bypassing the fps cap — for a caller that must commit the freshest
     * value synchronously (e.g. at `mousedown`). A no-op if nothing is
     * buffered.
     */
    forceFlush(): void {
        if (this._rafHandle !== null) {
            DOM.sink.cancelAnimationFrame(this._rafHandle);
            this._rafHandle = null;
        }

        this.drain();
    }

    /**
     * Cancels any pending frame and discards the buffered value without
     * applying it — for teardown, where a buffered value must never commit.
     */
    cancel(): void {
        if (this._rafHandle !== null) {
            DOM.sink.cancelAnimationFrame(this._rafHandle);
            this._rafHandle = null;
        }

        this._pending = null;
    }

    private drain(): void {
        const value = this._pending;

        this._pending = null;

        if (value !== null) {
            this._apply(value);
        }
    }
}
```

### How the two instances differ

| | `_resizeCoalescer` (border resize) | `_snapMoveCoalescer` (Ctrl-snap preview) |
|---|---|---|
| Constructed with | `() => this._resizeFps` (default 60, live via `setResizeFps`) | no second argument (uncapped) |
| Payload type `T` | `{ clientX: number; clientY: number; border: WindowBorder }` | `{ clientX: number; clientY: number }` |
| `apply` callback | `applyResizeFrame` — geometry commit + `doLayout()` | `applySnapMoveFrame` — `pickSnapBorder` + highlight toggle |
| Calls `forceFlush()`? | never | `onSnapMouseDown` |
| Calls `cancel()`? | `onExitAction`, `setWindowState` | `detachSnapMouseListeners` (from `clearSnapState` and `onExitAction`) |

### New fields on `AbstractWindow`

Replace `_animationFrameId`, `_pendingClientX`, `_pendingClientY`, `_pendingBorder`
([:266-269](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L266)) with one field, in the
same position; keep `_resizeSessionActive` through `_resizeFps`
([:270-277](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L270)) unchanged; delete
`_lastFlushTime` ([:278](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L278)) — it is now
private inside the coalescer:

```typescript
private readonly _resizeCoalescer: PerFrameCoalescer<{ clientX: number; clientY: number; border: WindowBorder }> =
    new PerFrameCoalescer((value) => this.applyResizeFrame(value), () => this._resizeFps);
```

Replace `_pendingSnapMove`, `_snapMoveRafHandle`
([:328-329](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L328)) with:

```typescript
private readonly _snapMoveCoalescer: PerFrameCoalescer<{ clientX: number; clientY: number }> =
    new PerFrameCoalescer((value) => this.applySnapMoveFrame(value));
```

Both initializers reference `this` inside an arrow function, the same pattern this file already uses
for its `_boundOnDrag`/`_boundOnSnapMouseMove`/etc. fields
([:331-341](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L331)).

### `onResize` — schedule instead of hand-rolled buffer-and-arm

Replace the tail of the existing body
([:2049-2055](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2049)), everything from
`this._pendingClientX = e.clientX;` down:

```typescript
this._resizeCoalescer.schedule({ clientX: e.clientX, clientY: e.clientY, border });
```

Everything above that line in `onResize` (the `canResize()`/window-state guards, `e.preventDefault()`,
and the once-per-session origin capture) is unchanged.

### `flushResize` becomes `applyResizeFrame` — geometry only, no scheduling

Replace the whole method ([:2104-2192](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2104))
with a version that takes the buffered value as a parameter instead of reading `_pendingClientX`/
`_pendingClientY`/`_pendingBorder`, and drops the fps-gate/re-arm/drain logic (now inside
`PerFrameCoalescer.onFrame`/`drain`) and the `if (!border) return` guard (the coalescer only calls
`apply` when a value is actually pending, so `border` is always defined here):

```typescript
/**
 * Commits a throttled resize frame: derives the new geometry from the
 * captured origin and pointer offset, clamps it to the viewport edge, and
 * lays out. Called by {@link _resizeCoalescer} at most once per animation
 * frame, further capped by {@link _resizeFps}.
 *
 * @param value - The most recently buffered pointer position and border.
 */
private applyResizeFrame(value: { clientX: number; clientY: number; border: WindowBorder }): void {
    const { clientX, clientY, border } = value;

    // Offset of the pointer from where the drag began. The new size is
    // `origin ± offset` clamped by setWidth/setHeight; WEST/NORTH edges
    // additionally re-derive position from the *clamped* size so the
    // opposite (fixed) edge stays put and over-travel past the minimum is
    // absorbed instead of decoupling the dragged edge from the cursor.
    const offsetX = clientX - this._resizeOriginClientX;
    const offsetY = clientY - this._resizeOriginClientY;

    // ...unchanged from here down: originRight/originBottom, the viewport
    // size caps, setAutoCommitStyle(false), the Direction switch, doLayout(),
    // setAutoCommitStyle(true) — copy verbatim from the current method body.
}
```

The implementer copies the rest of the current `flushResize` body verbatim (lines
[2129-2192](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2129)) — it reads `offsetX`/
`offsetY`/`border` (already in scope from the destructure above) and nothing else that changes.

`getResizeFps`/`setResizeFps`
([:2080-2095](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2080)) are unchanged — they
still read and write `_resizeFps` directly, which `_resizeCoalescer`'s fps thunk reads live.

### `onExitAction` / `setWindowState` — cancel via the coalescer

Replace the cancel block in `onExitAction`
([:961-964](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L961)):

```typescript
this._resizeCoalescer.cancel();
```

Replace the identical cancel block in `setWindowState`
([:1137-1140](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1137)) the same way.

### `onSnapMouseMove` — schedule directly, no `scheduleSnapMouseMove` wrapper

Replace the body ([:3227-3233](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3227)):

```typescript
private onSnapMouseMove(e: MouseEvent): void {
    if (!this._snapEnabled) {
        return;
    }

    this._snapMoveCoalescer.schedule({ clientX: e.clientX, clientY: e.clientY });
}
```

`scheduleSnapMouseMove` ([:3248-3254](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3248))
is deleted entirely — it was a one-line buffer-and-arm wrapper, now `PerFrameCoalescer.schedule` itself.

### `flushSnapMouseMove` becomes `applySnapMoveFrame`

Replace the whole method
([:3262-3284](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3262)), dropping the
drain/null-check (now inside `PerFrameCoalescer.drain`):

```typescript
/**
 * Applies the most recently buffered snap-preview position: picks the
 * nearest border within threshold and updates the highlight if it changed.
 * Called by {@link _snapMoveCoalescer} at most once per animation frame, or
 * synchronously via {@link _snapMoveCoalescer}'s `forceFlush` at
 * {@link onSnapMouseDown}.
 *
 * @param value - The most recently buffered cursor position.
 */
private applySnapMoveFrame(value: { clientX: number; clientY: number }): void {
    const winner = this.pickSnapBorder(value.clientX, value.clientY);
    if (winner === this._snapTargetBorder) {
        return;
    }

    if (this._snapTargetBorder) {
        this._snapTargetBorder.setSnapTarget(false);
    }
    this._snapTargetBorder = winner;
    if (winner) {
        winner.setSnapTarget(true);
    }
}
```

### `onSnapMouseDown` — force-flush via the coalescer

Replace the cancel-then-flush block at the top of the existing body
([:3337-3341](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3337)):

```typescript
private onSnapMouseDown(e: MouseEvent): Event.ListenerResult {
    this._snapMoveCoalescer.forceFlush();

    const target = this._snapTargetBorder;
    // ...unchanged from here down.
```

### `detachSnapMouseListeners` — cancel via the coalescer

Replace the cancel-and-clear block
([:3122-3126](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3122)):

```typescript
private detachSnapMouseListeners(): void {
    if (!this._snapMoveAttached) {
        return;
    }

    Event.removeViewportListener(this, "mousemove", this._boundOnSnapMouseMove);
    Event.removeViewportListener(this, "mousedown", this._boundOnSnapMouseDown);
    this._snapMoveAttached = false;

    this._snapMoveCoalescer.cancel();
}
```

---

## Ordered Implementation Steps

All changes are in
[`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts).
Line numbers are from the current file; re-check them before editing since earlier steps shift later
ones.

1. **Add the `PerFrameCoalescer<T>` class**, placed immediately before `export abstract class
   AbstractWindow` ([:247](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L247)). Full body
   in *Internal Structure*. `DOM` is already imported in this file
   ([:5](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L5)) — no new import.

2. **Replace the resize fields** ([:266-269](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L266))
   with the `_resizeCoalescer` declaration from *Internal Structure*. Delete `_lastFlushTime`
   ([:278](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L278)). Leave
   `_resizeSessionActive` through `_resizeFps` untouched.

3. **Replace the snap fields** ([:328-329](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L328))
   with the `_snapMoveCoalescer` declaration from *Internal Structure*.

4. **Update `onResize`'s tail** ([:2049-2055](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2049))
   to the one-line `schedule` call in *Internal Structure*. Everything above it in the method is
   unchanged.

5. **Replace `flushResize` with `applyResizeFrame`**
   ([:2104-2192](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2104)): new signature and
   destructure from *Internal Structure*, then the unchanged geometry body from the current method's
   line 2129 (`const originRight = ...`) through line 2192 (`this.setAutoCommitStyle(true);`), reading
   `offsetX`/`offsetY`/`border` from the destructure instead of `_pendingClientX`/`_pendingClientY`/
   `_pendingBorder`. Leave `getResizeFps`/`setResizeFps`
   ([:2080-2095](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2080)) untouched.

6. **Replace the cancel block in `onExitAction`**
   ([:961-964](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L961)) with
   `this._resizeCoalescer.cancel();`.

7. **Replace the identical cancel block in `setWindowState`**
   ([:1137-1140](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1137)) with
   `this._resizeCoalescer.cancel();`.

8. **Replace `onSnapMouseMove`'s body**
   ([:3227-3233](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3227)) with the version in
   *Internal Structure* that schedules directly.

9. **Delete `scheduleSnapMouseMove`**
   ([:3248-3254](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3248)) — step 8 removes its
   only caller.

10. **Replace `flushSnapMouseMove` with `applySnapMoveFrame`**
    ([:3262-3284](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3262)) per *Internal
    Structure*. `pickSnapBorder` and `WindowBorder.setSnapTarget` calls are unchanged.

11. **Replace the cancel-then-flush block at the top of `onSnapMouseDown`**
    ([:3337-3341](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3337)) with
    `this._snapMoveCoalescer.forceFlush();`. Everything from `const target = this._snapTargetBorder;`
    down is unchanged.

12. **Replace the cancel-and-clear block in `detachSnapMouseListeners`**
    ([:3122-3126](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3122)) with
    `this._snapMoveCoalescer.cancel();`.

    Checkpoint: `grep -n '_animationFrameId\|_pendingClientX\|_pendingClientY\|_pendingBorder\|_lastFlushTime\|_pendingSnapMove\|_snapMoveRafHandle\|scheduleSnapMouseMove\|flushResize\|flushSnapMouseMove' packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — zero matches.

    Checkpoint: `grep -rn 'PerFrameCoalescer\|_resizeCoalescer\|_snapMoveCoalescer' packages/lib/src/typescript/lib/` — every match is inside `AbstractWindow.ts`.

13. **Add the new resize-fps-cap test file**
    `packages/lib/tests/overlay/AbstractWindow.resizeFpsCoalescing.test.ts`, covering every case in
    *Expected Behaviour*. Copy the frame-capture harness from
    `packages/lib/tests/overlay/AbstractWindow.snapMouseMoveCoalescing.test.ts` (lines 66-93) — the
    `Map`-keyed `requestAnimationFrame`/`cancelAnimationFrame` spies so a cancelled frame really never
    runs. Adapt its `flushFrame()` helper (lines 96-104) to take an optional `timestamp` parameter,
    defaulting to `performance.now()`, and pass it to each drained callback instead of always calling
    `performance.now()` — the copied version hardcodes the timestamp, which is fine for the snap suite
    (uncapped, timing-independent) but not here, where cases 2-4 need to drain at an exact millisecond
    offset from the previous applied frame to land on either side of the fps-cap boundary. Drive
    `onResize`/`onResizeEnd`/`setWindowState`/`onExitAction` directly via a white-box cast, the same
    pattern `AbstractWindow.resizable.test.ts` uses.

14. **Confirm the existing suites pass unmodified.** `AbstractWindow.snapMouseMoveCoalescing.test.ts`
    drives only `onSnapKeyDown`/`onSnapMouseMove`/`onSnapMouseDown`/`onSnapKeyUp`/`onExitAction` and
    reads `_snapTargetBorder`/`_borderComponents` — none of the renamed internals — so it needs no
    edits. `AbstractWindow.resizable.test.ts` and `AbstractWindow.largeResizeFade.test.ts` drive
    `onResize`/`onResizeEnd` and read only public geometry getters, not the renamed fields.

15. **Typecheck, lint, test.** `npm run typecheck`, `npm run lint`, then the commands in
    *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Create | `packages/lib/tests/overlay/AbstractWindow.resizeFpsCoalescing.test.ts` |

---

## Expected Behaviour

This is a refactor with one exception: the fps-cap mechanism has no dedicated regression test today, so
this plan adds one. Everything else must reproduce exactly what the code already does.

### Unit-testable (offline, `installTestDOM` + captured animation frames)

New coverage, in `AbstractWindow.resizeFpsCoalescing.test.ts`. Construct a resizable, shown `Window`,
drive `onResize`/`onResizeEnd` via a white-box cast, and control the timestamp passed to each drained
frame explicitly via the adapted `flushFrame(timestamp)` helper (see step 13) so cap-boundary cases can
land on either side of the gate deterministically.

| Case | Sequence | Expected |
|---|---|---|
| 1. First frame always applies | `onResize` once, drain at `t=1000` | Geometry commits (`setWidth`/`setHeight`/`doLayout` called) — `_lastFlushTime` starts at 0, so any real timestamp clears the default 60fps (16.7ms) gate. |
| 2. A too-soon frame re-arms without applying | `onResize` once, drain at `t=1000` (applies), `onResize` again, drain at `t=1010` | No geometry commit on the second drain (10ms < 16.7ms); exactly one more frame is armed (`frames.size === 1` after that drain). |
| 3. A late-enough frame applies | Same as case 2, but the second drain uses `t=1020` | Geometry commits on the second drain (20ms ≥ 16.7ms). |
| 4. `setResizeFps` changes the cap on the next frame | `setResizeFps(20)` (50ms period), `onResize`, drain at `t=1000` (applies), `onResize` again, drain at `t=1030` | No commit at `t=1030` (30ms < 50ms) — the new cap applies immediately, not just to sessions started after the call. |
| 5. Two moves before a frame drains apply only the second | `onResize(border, e1)`, `onResize(border, e2)` at a different position, no drain in between, then drain | Geometry reflects only `e2`'s position; only one frame was ever armed (`frames.size === 1` after both calls). |
| 6. `onExitAction` cancels a still-buffered frame | `onResize` (undrained), `onExitAction()`, then drain | No geometry commit, nothing throws, `frames.size === 0` before the drain. |
| 7. `setWindowState` cancels a still-buffered frame | `onResize` (undrained), `setWindowState('maximized')`, then drain | No geometry commit from the stale buffered frame, nothing throws. |
| 8. A non-resizable or non-normal-state window never schedules | `setResizable(false)` then `onResize`, or `setWindowState('maximized')` then `onResize` | No frame armed (`frames.size === 0`) — unchanged early-return guards. |

### Unit-testable (already covered, must keep passing unmodified)

9. **`AbstractWindow.snapMouseMoveCoalescing.test.ts`'s 9 cases** — buffering, force-flush at
   `onSnapMouseDown`, and cancellation on modifier-release/blur/disable/close — all pass with no edits
   to that file, since it drives only `onSnapMouseMove`/`onSnapMouseDown`/`onSnapKeyDown`/`onSnapKeyUp`/
   `onExitAction` and reads `_snapTargetBorder`, none of which change shape.
10. **`AbstractWindow.resizable.test.ts` and `AbstractWindow.largeResizeFade.test.ts`** pass unmodified
    — both drive `onResize`/`onResizeEnd` and read public geometry getters only.

### Manual-verify (pointer movement and paint are not exercisable offline)

- **Dragging a window border still resizes smoothly** at the default 60fps cap, indistinguishable from
  today.
- **Lowering `setResizeFps` (e.g. to 20) still visibly throttles a live border drag** the same amount it
  does today.
- **Holding the Ctrl-snap modifier and moving the mouse still highlights the nearest border with no
  added lag**, and pressing near a highlighted border still grabs it immediately.
- **Closing a window mid-resize-drag, or mid-snap-hover, does not throw** and leaves no dangling
  animation frame (checkable via a DevTools performance trace showing no post-close callback).

---

## Verification

- **Typecheck:** `npm run typecheck` (clean).
- **Lint:** `npm run lint` (clean).
- **Unit tests:** `npx vitest run tests/overlay/AbstractWindow.resizeFpsCoalescing.test.ts tests/overlay/AbstractWindow.snapMouseMoveCoalescing.test.ts tests/overlay/AbstractWindow.resizable.test.ts tests/overlay/AbstractWindow.largeResizeFade.test.ts tests/overlay/AbstractWindow.locked.test.ts` from `packages/lib` — all green.
- **Grep invariants:** see the checkpoints in step 12.
- **Build:** `npm run build:lib` succeeds.
- **Manual live:** the docs app's Window demo (`npm run docs:dev`), or the sibling Loom app's own
  windows — exercise the manual-verify observations above, ideally with a WebKit/Chrome performance
  recording of a border drag and a Ctrl-snap hover, comparing frame cadence to before the change.

---

## Potential Challenges

- **A subtly wrong fps-gate port.** The original `flushResize` re-arms on the *same* rAF callback shape
  (`(ts) => this.flushResize(ts)`); `PerFrameCoalescer.onFrame` must re-arm itself the same way (a new
  closure per re-arm is fine — `Split.scheduleDrag` and the current code already do this on every call).
  Mitigated by Expected Behaviour cases 2-4 pinning the exact re-arm-without-draining timing.
- **Losing the `T` non-null constraint silently.** Both concrete uses here (`{clientX, clientY, border}`
  and `{clientX, clientY}`) are plain objects, so the `null`-sentinel is safe; the class's doc comment
  flags the constraint for any future third use.
- **Forgetting to delete `scheduleSnapMouseMove`.** Its only caller is replaced in the same step (8) that
  deletes it (step 9) — do both together, not step 8 alone, or the file fails to compile on an unused
  private method only if `noUnusedLocals`-style lint is active; check `npm run lint` either way.

---

## Critical Files

- [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) —
  the only source file changed. Read `onResize`/`flushResize`
  ([:2024](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2024),
  [:2104](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2104)) and
  `onSnapMouseMove`/`scheduleSnapMouseMove`/`flushSnapMouseMove`/`onSnapMouseDown`
  ([:3227-3365](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3227)) in full before editing.
- [`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts) —
  `scheduleDrag`/`flushDrag` ([:1098](packages/lib/src/typescript/lib/layout/Split.ts#L1098)) and
  `onDragEnd`'s forced flush ([:1135](packages/lib/src/typescript/lib/layout/Split.ts#L1135)): the
  precedent both of `AbstractWindow`'s mechanisms already mirror, and what `PerFrameCoalescer`
  generalizes.
- [`plans/implemented/window-snap-border-coalescing.md`](plans/implemented/window-snap-border-coalescing.md) —
  the plan that introduced `onSnapMouseMove`/`flushSnapMouseMove`. Its "why not share" footnote
  explicitly rejected sharing `_animationFrameId`/`flushResize` between the two mechanisms — read it
  before assuming this plan repeats that mistake.[^why-instances-not-fields]
- [`packages/lib/tests/overlay/AbstractWindow.snapMouseMoveCoalescing.test.ts`](packages/lib/tests/overlay/AbstractWindow.snapMouseMoveCoalescing.test.ts) —
  the frame-capture-and-drain harness (lines 66-104) the new resize test file copies, and the suite that
  must keep passing unmodified.
- [`packages/lib/tests/overlay/AbstractWindow.resizable.test.ts`](packages/lib/tests/overlay/AbstractWindow.resizable.test.ts) —
  the white-box direct-call pattern for driving `onResize`/`onResizeEnd`.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the `DOM.sink`/`DOM.source` seam: `PerFrameCoalescer` calls only
  `DOM.sink.requestAnimationFrame`/`cancelAnimationFrame`, already used by both mechanisms today, so no
  new seam surface is introduced.

---

## Non-Goals

- **Coalescing or fps-capping any other class's per-frame mechanism** (`Split`, `Accordion`, `Panel`,
  `ScrollStrip`, `VirtualRowView`, `DragManager`). Each already solves this independently; unifying them
  behind a shared, exported utility is a separate, much larger decision this plan does not make (see
  *The class stays private to this file*).
- **Changing the fps cap's default, range, or semantics.** `setResizeFps`/`getResizeFps` behave exactly
  as before.
- **Adding an fps cap to the snap-preview mechanism**, or removing `forceFlush` capability from the
  resize mechanism. Both instances keep exactly their current capability set; `PerFrameCoalescer` merely
  exposes both `schedule`/`forceFlush`/`cancel` generically so each instance can use the subset it needs.
- **Any change to `onDrag`** (the window-move header drag, which writes only a compositor `transform`
  and was never part of either coalescing mechanism).

---

## Notes

[^why-instances-not-fields]: `plans/implemented/window-snap-border-coalescing.md`'s `[^why-not-share]`
    footnote rejected sharing `_animationFrameId`/`flushResize` directly between the two mechanisms, for
    two reasons: the snap preview commonly runs with no resize session active, so a shared field would
    usually sit unused for its "real" purpose; and folding a highlight-only update into `flushResize`'s
    fps cap would either wrongly throttle the preview or require two independent "should I run yet"
    decisions inside what was meant to be one gate. Both objections are about **one shared instance**
    serving two purposes at once. This plan does not do that: `_resizeCoalescer` and `_snapMoveCoalescer`
    are two independent instances, each with its own pending value and its own rAF handle, so neither
    mechanism is ever idle-but-holding-the-other's-state, and each configures its own fps thunk (or
    none) independently — there is no shared gate for the two decisions to collide inside. Only the
    class *implementation* is shared, which is exactly the level the earlier rejection did not address.

[^cross-file-precedent]: Confirmed by reading `Split.ts` (`scheduleDrag`/`flushDrag`,
    `_pendingDrag`/`_dragRafHandle`), `Accordion.ts` (`_dragRafHandle`, `flushGutterDrag`), `Panel.ts`
    and `VirtualRowView.ts` (`_resizeSettleHandle`, `armResizeSettleCheck`/`flushResizeSettle`), and
    `DragManager.ts` (module-scoped `pendingMove`/`moveRafHandle`, `scheduleMove`/`flushMove`) — every
    one hand-rolls its own private pending-value-plus-rAF-handle pair with no shared base class or
    utility. None has an fps cap; `AbstractWindow`'s resize mechanism is the only one that does.
