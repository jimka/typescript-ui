# Window Snap-Border Coalescing — Implementation Plan

## Overview

`AbstractWindow`'s Ctrl-snap resize affordance widens the eight thin resize-border
strips into an easier-to-grab zone while a modifier key is held.[^feature-naming]
Holding the modifier (`ctrl` by default) arms detection
([`onSnapKeyDown`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3144))
and attaches a viewport-wide `mousemove` listener
([`attachSnapMouseListeners`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3095)),
independently of whether any drag is in progress. From then on, every raw
`mousemove` anywhere in the viewport runs
[`onSnapMouseMove`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3215),
which calls
[`pickSnapBorder`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3242):
up to eight `DOM.source.getElementRect` reads, one per candidate border strip,
each forcing the browser to flush layout synchronously. A native `mousemove`
fires far more often than the screen repaints, so this runs many times more
often than the highlight it produces can ever be seen.

This plan coalesces `onSnapMouseMove`'s work to at most one application per
animation frame while the modifier is held and the mouse is moving, mirroring
[`Split.scheduleDrag`/`flushDrag`](packages/lib/src/typescript/lib/layout/Split.ts#L1098)
— the fix already applied to the analogous pane-gutter-drag bug one layer up.
The border a `mousedown` actually grabs
([`onSnapMouseDown`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3284))
always reflects the freshest cursor position, never a stale coalesced frame.
All changes are confined to
[`AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts);
no other file changes.

No public API changes — every method and field touched is `private`.

---

## Architecture Decisions

### The mousemove is buffered and applied at most once per frame, mirroring `Split.scheduleDrag`/`flushDrag`

`AbstractWindow` gains two private fields — `_pendingSnapMove` and
`_snapMoveRafHandle` — and two private methods, `scheduleSnapMouseMove` and
`flushSnapMouseMove`, copying the shape of
[`Split.scheduleDrag`/`flushDrag`](packages/lib/src/typescript/lib/layout/Split.ts#L1098):
buffer the latest `clientX`/`clientY`, arm at most one
`DOM.sink.requestAnimationFrame`, leave it armed while further moves arrive,
and apply the latest buffered position on that frame.[^split-precedent]
`onSnapMouseMove` itself shrinks to a guard plus one call to
`scheduleSnapMouseMove`; `pickSnapBorder` is unchanged and gains no new caller
— it is still called from exactly one place, just one step removed.

### No burst/settle two-phase state

Unlike `VirtualRowView`'s and `ScrollStrip`'s resize-settle mechanisms, this
fix needs no burst detection and no separate "is a resize in flight" signal.
Those mechanisms exist because a *held-down* resize keeps changing a real
geometry value every frame, and something must decide when that geometry has
stopped moving so a final accurate pass can run. Here the only "geometry"
that changes is the mouse position itself, and every dropped intermediate
position was never visible anyway — coalescing to one application per frame
is already the accurate result, not an approximation that needs a later
catch-up pass.

### `onSnapMouseDown` force-flushes before reading the highlighted border

[`onSnapMouseDown`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3284)
cancels any pending animation frame and calls `flushSnapMouseMove()`
unconditionally before reading `_snapTargetBorder`, mirroring
[`Split.onDragEnd`](packages/lib/src/typescript/lib/layout/Split.ts#L1135)'s
forced flush at the point its own drag commits. This guarantees the border a
`mousedown` grabs is always the one nearest the most recent mousemove, never
a frame-old coalesced highlight — see *What "commit" means for this feature*
below for why this specific read is the one that must stay exact.

### What "commit" means for this feature

Holding the modifier only previews: it highlights the nearest border within
threshold and changes nothing about the window. The affordance commits at
`mousedown` — `onSnapMouseDown` forwards the press into the highlighted
border's own `onDragStart`, starting an ordinary resize drag identical to one
started by grabbing the real (unwidened) strip directly. Releasing the
modifier (`onSnapKeyUp` / a viewport `blur`) never applies anything; it only
clears the preview via `clearSnapState`. So the only read that must be exact
is the one `onSnapMouseDown` makes at the moment of the press — the decision
above. The preview shown while the key is merely held can lag by up to one
frame with no correctness consequence, only a cosmetic one bounded by a
single frame.

### The new buffer stays separate from `onResize`/`flushResize`'s existing coalescing

`onResize`/`flushResize` ([:2019](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2019),
[:2099](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2099)) already
buffer a border-drag's pointer position and apply it through an fps-capped
`requestAnimationFrame`. This plan does not extend that mechanism to also
carry the snap-preview position.[^why-not-share] The two can run within the
same real animation frame with no coordination needed — the browser invokes
every callback scheduled for that frame in one batch — so nothing is lost by
keeping them apart.

### Cancellation lives in `detachSnapMouseListeners`

The pending animation frame is cancelled inside
[`detachSnapMouseListeners`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3108)
itself, not at each call site. Both teardown paths already call it:
`clearSnapState` ([:3132](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3132),
reached from modifier release, viewport `blur`, `setSnapResizeEnabled(false)`,
and `applyResizeBorderVisibility` disabling the borders) and `onExitAction`
([:951](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L951), window
close) each call `detachSnapMouseListeners` directly. Putting the cancel there
covers every path in one place instead of four, and matches
`detachSnapMouseListeners`'s own job: it is already "the place that stops the
mousemove listener whose buffered event this is."

---

## Internal Structure

### New private fields

Placed immediately after `_snapTargetBorder`
([AbstractWindow.ts:324](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L324)):

```typescript
// The most recent not-yet-applied onSnapMouseMove position, and the
// animation frame scheduled to apply it — see scheduleSnapMouseMove.
// null/null while no move is buffered or the modifier isn't held.
private _pendingSnapMove: { clientX: number; clientY: number } | null = null;
private _snapMoveRafHandle: number | null = null;
```

### `onSnapMouseMove` — guard, then buffer

Replaces the current body ([:3215-3232](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3215)):

```typescript
/**
 * Buffers the cursor position while snap is armed; the actual border pick
 * and highlight update happen at most once per animation frame, via
 * {@link scheduleSnapMouseMove}.
 *
 * @param e - The mousemove event.
 */
private onSnapMouseMove(e: MouseEvent): void {
    if (!this._snapEnabled) {
        return;
    }

    this.scheduleSnapMouseMove(e.clientX, e.clientY);
}
```

### `scheduleSnapMouseMove` / `flushSnapMouseMove`

Placed directly after `onSnapMouseMove`, before `pickSnapBorder`:

```typescript
/**
 * Buffers a viewport `mousemove` position and applies it at most once per
 * animation frame, via {@link flushSnapMouseMove}. A native `mousemove`
 * fires far more often than the screen repaints, and `pickSnapBorder` is not
 * cheap: it reads up to eight border strips' live layout rects
 * (`DOM.source.getElementRect`), each forcing the browser to flush layout.
 * Only the most recent position before a frame lands is kept — an
 * intermediate position between two `mousemove` events was never going to be
 * visible anyway. Mirrors `Split.scheduleDrag`/`flushDrag`.
 *
 * @param clientX - Cursor x in viewport pixels.
 * @param clientY - Cursor y in viewport pixels.
 */
private scheduleSnapMouseMove(clientX: number, clientY: number): void {
    this._pendingSnapMove = { clientX, clientY };

    if (this._snapMoveRafHandle === null) {
        this._snapMoveRafHandle = DOM.sink.requestAnimationFrame(() => this.flushSnapMouseMove());
    }
}

/**
 * Applies the most recently buffered {@link scheduleSnapMouseMove} position,
 * if one is pending — a no-op otherwise, which makes it safe to call
 * unconditionally from both the scheduled animation frame and
 * {@link onSnapMouseDown}.
 */
private flushSnapMouseMove(): void {
    this._snapMoveRafHandle = null;

    const pending = this._pendingSnapMove;
    if (pending === null) {
        return;
    }

    this._pendingSnapMove = null;

    const winner = this.pickSnapBorder(pending.clientX, pending.clientY);
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

This is the exact pick-and-highlight logic `onSnapMouseMove` used to run
inline ([:3220-3231](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3220)),
moved verbatim into `flushSnapMouseMove`.

### `onSnapMouseDown` — force-flush before reading the target

Insert two statements at the top of the existing body
([:3284](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3284)),
before the `const target = this._snapTargetBorder;` line:

```typescript
private onSnapMouseDown(e: MouseEvent): Event.ListenerResult {
    if (this._snapMoveRafHandle !== null) {
        DOM.sink.cancelAnimationFrame(this._snapMoveRafHandle);
        this._snapMoveRafHandle = null;
    }
    this.flushSnapMouseMove();

    const target = this._snapTargetBorder;
    // ...unchanged from here down.
```

### `detachSnapMouseListeners` — cancel a still-buffered frame

Extends the existing body
([:3108-3116](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3108)):

```typescript
private detachSnapMouseListeners(): void {
    if (!this._snapMoveAttached) {
        return;
    }

    Event.removeViewportListener(this, "mousemove", this._boundOnSnapMouseMove);
    Event.removeViewportListener(this, "mousedown", this._boundOnSnapMouseDown);
    this._snapMoveAttached = false;

    if (this._snapMoveRafHandle !== null) {
        DOM.sink.cancelAnimationFrame(this._snapMoveRafHandle);
        this._snapMoveRafHandle = null;
    }
    this._pendingSnapMove = null;
}
```

### The rule, worked through

| Sequence | Frame already armed? | `pickSnapBorder` runs? |
|---|---|---|
| First mousemove after the modifier goes down | no → armed now | not yet — waits for the frame |
| A second mousemove before that frame runs | yes | no — overwrites the buffered position |
| The animation frame fires | — | yes — picks from the last buffered position |
| `mousedown` before any frame has run | — | yes — the force-flush picks from the last buffered position, then the border is grabbed |
| Modifier released / viewport `blur` before any frame has run | — | no — `detachSnapMouseListeners` cancels the pending frame; nothing is applied |

---

## Ordered Implementation Steps

1. **Add the two private fields** to `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`, immediately after `_snapTargetBorder` at [:324](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L324). Declarations in *Internal Structure*.

2. **Add `scheduleSnapMouseMove` and `flushSnapMouseMove`**, placed directly after `onSnapMouseMove` and before `pickSnapBorder` ([:3242](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3242)) — ahead of step 3, so the method `onSnapMouseMove` is about to call already exists. Bodies in *Internal Structure*. `DOM` is already imported in this file ([:5](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L5)) — no new import. `flushSnapMouseMove` calls only `pickSnapBorder` and `WindowBorder.setSnapTarget`, both already used by the code step 3 replaces.

3. **Replace `onSnapMouseMove`'s body** ([:3215-3232](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3215)) with the version in *Internal Structure*. Keep its doc comment's summary line accurate to the new behaviour (buffers rather than picks directly).

4. **Insert the force-flush at the top of `onSnapMouseDown`** ([:3284](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3284)), before its existing `const target = this._snapTargetBorder;` line. Everything from that line down is unchanged. Snippet in *Internal Structure*.

5. **Extend `detachSnapMouseListeners`** ([:3108-3116](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3108)) with the cancel-and-clear block from *Internal Structure*, appended after `this._snapMoveAttached = false;`.

   Checkpoint: `grep -n 'pickSnapBorder' packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — exactly two matches: the method definition and the single call inside `flushSnapMouseMove`.

   Checkpoint: `grep -rn '_pendingSnapMove\|_snapMoveRafHandle\|scheduleSnapMouseMove\|flushSnapMouseMove' packages/lib/src/typescript/lib/` — every match is inside `AbstractWindow.ts`.

6. **Write the new test file** `packages/lib/tests/overlay/AbstractWindow.snapMouseMoveCoalescing.test.ts`, covering every case in *Expected Behaviour*. Install the offline animation-frame capture-and-drain harness the same way `ResizeLayoutEconomy.test.ts` (lines 34-51, on the unmerged `feature/virtual-row-view-resize-relayout` branch — see [^no-tests] for why to copy the shape rather than the file) does: hold callbacks in a `Map` keyed by an incrementing handle so `cancelAnimationFrame` actually drops one, since the teardown cases here need a cancelled frame to really stop running — the read-only stub `ScrollRebindLayoutEconomy.test.ts` uses is not enough. Drive `onSnapKeyDown`/`onSnapMouseMove`/`onSnapMouseDown`/`onSnapKeyUp` directly via a white-box cast, the same pattern `AbstractWindow.resizable.test.ts`'s `endResize` helper uses for `onResizeEnd` ([AbstractWindow.resizable.test.ts:29-32](packages/lib/tests/overlay/AbstractWindow.resizable.test.ts#L29)) — construct fake `MouseEvent`/`KeyboardEvent` objects with the needed fields (`clientX`, `clientY`, `ctrlKey`, …) rather than dispatching through `Event`.

7. **Typecheck, lint, test.** `npm run typecheck`, `npm run lint`, then the commands in *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Create | `packages/lib/tests/overlay/AbstractWindow.snapMouseMoveCoalescing.test.ts` |

---

## Expected Behaviour

No test file exercises the snap-resize affordance today.[^no-tests] Every case
below is new coverage.

### Unit-testable (offline, `installTestDOM` + captured animation frames)

Construct a resizable `Window`, call `show()` so it renders and
`attachSnapKeyboardListeners` runs, then drive the private snap methods
directly via a white-box cast. Spy on `pickSnapBorder` (or on
`DOM.source.getElementRect`) to count forced-layout reads, and on
`WindowBorder.prototype.setSnapTarget` to observe highlight changes.

1. **A single buffered mousemove, once drained, picks and highlights exactly once.** After `onSnapKeyDown` arms detection, one `onSnapMouseMove` call followed by draining the captured frame calls `pickSnapBorder` exactly once and highlights the correct border for that position.

2. **A second mousemove before the frame drains overwrites the buffer, not the highlight.** Two `onSnapMouseMove` calls at different positions, with no frame drained in between, produce zero calls to `pickSnapBorder` so far. Draining the frame then calls `pickSnapBorder` exactly once, reflecting the *second* position.

3. **`onSnapMouseDown` never waits for a frame.** After a buffered, undrained `onSnapMouseMove` near border A, calling `onSnapMouseDown` immediately (no frame drained) still highlights and forwards into border A's `onDragStart` — the force-flush inside `onSnapMouseDown` supplies the pick `pickSnapBorder` would otherwise have waited a frame to perform.

4. **A stale highlight is corrected at the moment of `mousedown`, not shown as it was.** Prime the highlight on border A via a drained frame, then buffer (without draining) a further `onSnapMouseMove` near border B, then call `onSnapMouseDown`: the forwarded drag targets border B, not the still-displayed A — pinning that the commit read is always the freshest buffered position, never the last-painted one.

5. **`onSnapMouseDown` with nothing ever buffered is a no-op-safe early return.** Arm detection and call `onSnapMouseDown` with no prior `onSnapMouseMove` at all: `_snapTargetBorder` stays `null`, no `onDragStart` call happens, nothing throws.

6. **Releasing the modifier cancels a still-buffered frame.** Buffer an `onSnapMouseMove` (undrained), then call `onSnapKeyUp` with the modifier no longer held: draining the captured frames afterward calls `pickSnapBorder` zero times and no highlight change occurs.

7. **A viewport `blur` cancels a still-buffered frame the same way as case 6**, via the same `clearSnapState` path.

8. **Disabling snap-resize (`setSnapResizeEnabled(false)`) mid-hover cancels a still-buffered frame**, same assertion shape as case 6.

9. **Window close cancels a still-buffered frame.** Buffer an `onSnapMouseMove` (undrained), call `onExitAction()`, then drain the captured frames: no callback runs, nothing throws, and no call reaches the (about-to-be-disposed) border components.

10. **The existing `onResize`/`flushResize` resize-drag path is unaffected.** `AbstractWindow.resizable.test.ts` and `AbstractWindow.largeResizeFade.test.ts` pass unchanged — this plan makes no change to `onResize`, `flushResize`, or `_animationFrameId`.

### Manual-verify (pointer movement and paint are not exercisable offline)

- **Holding the modifier and waving the mouse around the viewport, away from any window, is materially smoother**, with no forced `recalculate-styles`/`forced-layout` pair appearing on every raw `mousemove` in a WebKit/Chrome performance trace — at most one per animation frame.
- **The highlighted border still tracks the cursor closely enough to feel live** while the modifier is held and the mouse moves.
- **Pressing the mouse near (not on) a highlighted border still grabs exactly that border** and starts a normal resize drag, indistinguishable from today's behaviour.
- **Holding the modifier mid-resize-drag** (already dragging a border, then pressing the modifier) does not visibly jank the ongoing drag — the two mechanisms run independently within the same frame.

---

## Verification

- **Typecheck:** `npm run typecheck` (clean).
- **Lint:** `npm run lint` (clean).
- **Unit tests:** `npx vitest run tests/overlay/AbstractWindow.snapMouseMoveCoalescing.test.ts tests/overlay/AbstractWindow.resizable.test.ts tests/overlay/AbstractWindow.largeResizeFade.test.ts tests/overlay/AbstractWindow.locked.test.ts` from `packages/lib` — all green.
- **Grep invariants:** see the checkpoints in step 5.
- **Build:** `npm run build:lib` succeeds.
- **Manual live:** the docs app's Window demo (`npm run docs:dev`), or the sibling Loom app's own windows, exercising the manual-verify observations above with a WebKit/Chrome performance recording of holding the modifier and moving the mouse.

---

## Potential Challenges

- **A pending frame firing after teardown.** Mitigated by cancelling inside `detachSnapMouseListeners`, the single choke point both `clearSnapState` and `onExitAction` already call — pinned by Expected Behaviour cases 6-9.
- **A stale highlight being trusted at commit time.** Mitigated by `onSnapMouseDown`'s unconditional force-flush before reading `_snapTargetBorder` — pinned by Expected Behaviour cases 3-4.
- **The offline test sink drops `requestAnimationFrame`.** The new test file must capture frames explicitly, with `cancelAnimationFrame` actually removing a callback (not the read-only stub some other suites use) so the teardown cases can be pinned.
- **Two independent animation-frame schedules active in the same frame** (this plan's snap-move flush and the existing fps-capped `flushResize`) could look like a conflict at a glance. They touch disjoint fields and neither reads the other's state, so no coordination is needed — see *The new buffer stays separate from `onResize`/`flushResize`'s existing coalescing*.

---

## Critical Files

- [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) — the only source file changed. Read `onSnapKeyDown`/`onSnapKeyUp` ([:3144-3182](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3144)), `attachSnapMouseListeners`/`detachSnapMouseListeners` ([:3095-3116](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3095)), `clearSnapState` ([:3132](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3132)), `onSnapMouseMove`/`pickSnapBorder`/`onSnapMouseDown` ([:3215-3307](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3215)), `onResize`/`flushResize` ([:2019](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2019), [:2099](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2099)) for the sibling coalescing mechanism this plan deliberately does not share, and `onExitAction` ([:951](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L951)) for the window-close teardown path.
- [`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts) — `scheduleDrag` ([:1098](packages/lib/src/typescript/lib/layout/Split.ts#L1098)), `flushDrag` ([:1111](packages/lib/src/typescript/lib/layout/Split.ts#L1111)), and `onDragEnd`'s forced flush ([:1135](packages/lib/src/typescript/lib/layout/Split.ts#L1135)): the precedent this plan's buffering shape and commit-time force-flush both mirror.
- [`packages/lib/src/typescript/lib/component/container/WindowBorder.ts`](packages/lib/src/typescript/lib/component/container/WindowBorder.ts) — `setSnapTarget` ([:238](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L238)), `onDragStart`/`onDragStop` ([:263-286](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L263)): what `flushSnapMouseMove` and `onSnapMouseDown` drive, unmodified by this plan.
- [`packages/lib/tests/overlay/AbstractWindow.resizable.test.ts`](packages/lib/tests/overlay/AbstractWindow.resizable.test.ts) — the white-box direct-call pattern (`endResize`, [:29-32](packages/lib/tests/overlay/AbstractWindow.resizable.test.ts#L29)) the new test file's driver helpers copy.
- `plans/scrollstrip-resize-resync-coalescing.md` and `plans/virtual-row-view-resize-relayout.md` — read for tone, structure, and self-consistency bar; their settle-frame *mechanism* does not apply here (see *No burst/settle two-phase state*).
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the `DOM.sink`/`DOM.source` seam and typed-setter rules the new code must honour (already-imported `DOM`, no raw DOM access added, no new listener-registration site).

---

## Non-Goals

- **Coalescing or fps-capping `onResize`/`flushResize` itself.** Already coalesced by an earlier fix; untouched here.
- **Changing `onDrag`** (the window-move header drag). It already writes only a compositor `transform` via `setTranslate` on every raw mousemove, with no layout read or write — not the bug class this plan addresses.
- **An fps cap on `flushSnapMouseMove`.** `flushResize`'s fps cap exists to bound how often a heavy geometry commit repaints; a highlight toggle plus up to eight rect reads, already reduced to once per frame, needs no further throttling.
- **Any change to the snap threshold, modifier key, or visual highlight styling.** Configuration and presentation are unrelated to the dispatch-rate bug this plan fixes.

---

## Notes

[^feature-naming]: The window options interface documents it directly: `setSnapResizeEnabled`'s doc comment calls it "the Ctrl-snap resize affordance" ([AbstractWindow.ts:1831](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1831)). It is not an OS-style "hold a key, preview screen-edge snap zones, release to snap the window into one" feature — nothing here moves or resizes the window while the key is merely held. It only widens the effective grab area of the eight existing resize-border strips for the duration of the hold.

[^split-precedent]: `Split.scheduleDrag`/`flushDrag` buffer a gutter's `drag` events and apply at most one per animation frame, with a synchronous flush at the point the drag commits and a cancel in `detach()` for a drag torn down mid-flight. This plan copies the same three things: arm the frame once and leave it armed while further events arrive (rather than cancel-and-re-arm per event), hold the handle in a nullable field that doubles as the in-flight test, and cancel that handle in the relevant teardown hook (`detachSnapMouseListeners` here, `detach()` there).

[^why-not-share]: Sharing `_animationFrameId`/`flushResize` was considered and rejected on two counts, checked against the actual call graph rather than assumed. First, the snap-preview listener commonly runs with *no* resize session active at all — a user can hold the modifier and move the mouse with no `mousedown` anywhere, which is in fact the common case (a plain hover preview) — so `_animationFrameId` sits at `null` most of the time snap detection is doing work, meaning the fields being asked to double up are usually not even in use for their existing purpose. Second, `flushResize`'s fps cap (`_resizeFps`, `getResizeFps`/`setResizeFps`) is a deliberate quality knob for the cost of an actual geometry commit and relayout; folding a highlight-only update into that cap would either needlessly throttle the preview below one-per-frame or require carrying two independent "should I run yet" decisions through what was meant to be a single fps gate. Keeping the buffers separate costs one extra nullable field and one extra `requestAnimationFrame` registration, which the browser batches with any other callback already scheduled for the same frame at no extra layout cost.

[^no-tests]: Confirmed against `packages/lib/tests/overlay/` — no file matching `*snap*` or `*Snap*`, and a codegraph blast-radius check found no covering tests for `pickSnapBorder`, `onSnapMouseMove`, or `attachSnapKeyboardListeners`. The animation-frame capture harness this plan's test file copies (`Map`-keyed handles so `cancelAnimationFrame` really drops a callback) currently exists only on the unmerged `feature/virtual-row-view-resize-relayout` branch's `ResizeLayoutEconomy.test.ts`; on `master` that plan is still `plans/virtual-row-view-resize-relayout.md`, not yet moved to `plans/implemented/`. An implementer working from `master` should copy the harness *shape* described in this plan's step 6 rather than expect that file to be present.
