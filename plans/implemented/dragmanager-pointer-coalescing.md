# DragManager Pointer-Move Coalescing — Implementation Plan

## Overview

`DragManager`'s viewport `mousemove` handler runs unthrottled during every mouse-driven drag in the framework — tab reorder and tear-off, `Dock` region docking, `TreeTable` row drag-and-drop. [`onMouseMove`](packages/lib/src/typescript/lib/overlay/DragManager.ts#L513) is registered with [`Event.addViewportListener`](packages/lib/src/typescript/lib/overlay/DragManager.ts#L360), so the framework's window-level capture handler calls it synchronously on every native `mousemove`. Once a drag has committed, each call re-runs [`pickDropTarget`](packages/lib/src/typescript/lib/overlay/DragManager.ts#L412), which hit-tests via `DOM.source.elementsFromPoint` — a call that forces the browser to flush any pending layout before it can answer. The two shipped `onDragOver` consumers force a second layout flush of their own on top of that: [`TabBar.updateReorderSlot`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L3164) reads `DOM.source.getElementRect`, and [`DockRegion.computeZone`](packages/lib/src/typescript/lib/layout/DockRegion.ts#L238) reads `DOM.source.getViewportRect` — both backed by `getBoundingClientRect()`. A drag over a `Dock` layout therefore pays two forced layouts on every raw pointer-move, uncapped by the display's frame rate.

This mirrors a bug already fixed one layer up: `Split`'s pane-resize gutter used to dispatch a full relayout on every raw `mousemove` until [`Split.scheduleDrag`/`flushDrag`](packages/lib/src/typescript/lib/layout/Split.ts#L1098) buffered the latest event and applied at most one per animation frame. This plan gives `DragManager` the same buffering for its own expensive per-move work — hit-testing and everything `onDragOver`-shaped downstream of it — while leaving the drag ghost's own repositioning, which is cheap, on every raw event so the cursor-following ghost stays at native pointer rate. All changes are confined to [`DragManager.ts`](packages/lib/src/typescript/lib/overlay/DragManager.ts); `TabBar.ts`, `DockRegion.ts`, and `TreeTable`'s own drag wiring need no changes; they already re-derive their geometry from the `DragEventDetail` handed to them on each call; they inherit the coalescing for free. No public API changes.

---

## Architecture Decisions

### Buffer the latest pointer position and resolve the drop target at most once per animation frame

`DragManager` gains module-level `pendingMove`/`moveRafHandle` state and two functions, `scheduleMove`/`flushMove`, that buffer a `mousemove`'s `(clientX, clientY)` and apply it at most once per `requestAnimationFrame` — the same shape as `Split.scheduleDrag`/`flushDrag`: arm the frame once and leave it armed while further moves arrive, hold the handle in a nullable field that doubles as the "already scheduled" test, and cancel that handle wherever the session tears down.[^split-precedent] `onMouseMove` keeps its threshold/commit logic and its ghost reposition inline, unthrottled, and replaces the rest of its body — `pickDropTarget` plus the enter/leave/`onDragOver` dispatch — with a single `scheduleMove(e.clientX, e.clientY)` call.

### The ghost stays unthrottled; only the hit-test and what depends on it move behind the buffer

`DragManager` already separates a cheap concern from an expensive one: [`session.ghost`'s reposition](packages/lib/src/typescript/lib/overlay/DragManager.ts#L540-L549) is a direct `moveTo`/`setX`+`setY` write, and [`DragGhost.moveTo`](packages/lib/src/typescript/lib/overlay/DragGhost.ts#L90)'s own doc comment already says "`DragManager` calls this on every `mousemove` during an active drag." That stays true after this plan — only `pickDropTarget` and the target-dispatch logic that follows it move behind the buffer.[^ghost-cheap] The drag keeps tracking the cursor at native pointer rate; only the drop-target highlighting, reorder-slot indicator, and dock-zone overlay settle to once per rendered frame, which is the fastest a user can actually see them update anyway.

### `flushMove` re-derives the current target from the buffered position; it never replays skipped events

`flushMove` runs exactly the computation `onMouseMove` used to run inline — `pickDropTarget` at the buffered position, compared against `session.currentTarget` — once, against whichever position survived to the frame boundary. It does not walk through each raw position a burst skipped. This means a target the buffered position never lands on is never entered, so it can never need a leave either: entry and exit are always derived together from the one position `flushMove` actually sees, not diffed against a remembered stream of discrete enter/leave events. A pointer that crosses a second target and returns to the first within one un-drained burst therefore never touches the second target's `onDragOver`/`onDragLeave` at all — worked through below.

| Step | Pointer position(s) | Drained this step? | `currentTarget` after | Target 1 `onDragOver` calls (total) | Target 2 calls (total) |
|---|---|---|---|---|---|
| Burst: `(60,60)` → `(70,70)` → `(90,90)`, all inside Target 1 | no | *(unresolved — buffer holds `(90,90)`)* | 0 | 0 |
| Frame drains | yes | Target 1 | 1 | 0 |
| Move to `(650,650)`, inside Target 2 | no | Target 1 (buffer holds this) | 1 | 0 |
| Move to `(90,90)`, back inside Target 1 | no | Target 1 (buffer now holds this) | 1 | 0 |
| Frame drains | yes | Target 1 (same-target branch re-fires) | 2 | 0 |

Target 2's `onDragOver` and `onDragLeave` never fire — the buffer only ever holds the *latest* raw position, and by the time a frame lands, the pointer has already moved back off it. Nothing was ever shown on screen at Target 2 either: the browser paints only the DOM state as of the frame it renders, so a target visited and left between two animation frames was never visually entered regardless of throttling.

This is also why `TabBar`'s and `DockRegion`'s spring-loaded host-window raise — armed from `onDragOver`, cleared from `onDragLeave`, and gated on a 1000 ms dwell (`SPRING_RAISE_DELAY_MS`) — can't end up stuck armed for a target the drag has actually left. `scheduleSpringRaise`/`clearSpringRaise` only ever run as a matched pair inside one `onDragOver`/`onDragLeave` call on the *same* target ([TabBar.ts:3057-3080](packages/lib/src/typescript/lib/component/container/TabBar.ts#L3057), [DockRegion.ts:167-193](packages/lib/src/typescript/lib/layout/DockRegion.ts#L167)); a target that `flushMove` never enters can't have its `onDragOver` arm the timer in the first place, so there's nothing left to clear.

### `mouseup` flushes synchronously before deciding the drop; every other teardown path only cancels

`onMouseUp` cancels a still-scheduled frame and calls `flushMove()` synchronously before reading `session.currentTarget`, so the drop always resolves against the pointer's actual last buffered position rather than whichever position a frame boundary happened to catch — mirroring `Split.onDragEnd`'s own cancel-then-flush of its buffered drag position.[^mouseup-flush] `endSession` — the shared teardown `onMouseUp` and `DragManager.cancel()` both funnel through — only *cancels* the pending frame, with no flush: a session ending via `cancel()` (mirroring "a `mouseup` outside any drop target — no drop callback fires", per its own doc comment) commits to no further target dispatch, exactly as `Split.detach()` cancels its own buffered drag frame without running `onDrag` for it.

### Not the settle-after-a-burst mechanism `ScrollStrip`/`VirtualRowView` use

Those two mechanisms exist to bridge a *live external driver* (a `Split` gutter resizing a pane) whose eventual quiescence has to be detected from inside a component that has no signal telling it the drag ended — hence "arm a settle frame, keep extending it while the driver is still moving, catch up once it goes quiet." `DragManager` has no such gap: it *is* the whole driver of its own `mousemove` dispatch, so there is no external quiescence to detect and nothing left over to catch up once a frame lands — the browser's own paint boundary is the settle point. Plain latest-value buffering, `Split`'s original shape, is already the right amount of coalescing here.[^why-not-settle]

---

## Internal Structure

### New module-level state

Placed after `activeSession` ([DragManager.ts:196](packages/lib/src/typescript/lib/overlay/DragManager.ts#L196)):

```typescript
// The pointer position buffered by the most recent mousemove not yet applied
// by flushMove, or null while none is pending. Only the latest position is
// kept — see scheduleMove.
let pendingMove: { clientX: number; clientY: number } | null = null;

// The animation frame scheduled to apply pendingMove, or null when none is
// in flight. Doubles as the "already scheduled" test in scheduleMove.
let moveRafHandle: number | null = null;
```

### `scheduleMove` / `flushMove`

Placed after `enterNewTarget` ([DragManager.ts:481](packages/lib/src/typescript/lib/overlay/DragManager.ts#L481)), before `onSelectStart`:

```typescript
/**
 * Buffers a `mousemove`'s pointer position and resolves the drop target at
 * most once per animation frame, via {@link flushMove}. `pickDropTarget`
 * forces a synchronous layout (`elementsFromPoint`), and both `onDragOver`
 * consumers shipped today force another of their own
 * (`TabBar.updateReorderSlot`'s `getElementRect`, `DockRegion.computeZone`'s
 * `getViewportRect`) — paying that once per raw pointer-move rather than once
 * per rendered frame visibly stutters a drag over a `Dock` layout. Only the
 * most recent position before a frame lands is kept — an intermediate
 * position between two `mousemove` events was never going to be visible
 * anyway.
 *
 * @param clientX - Viewport-relative pointer X for this move.
 * @param clientY - Viewport-relative pointer Y for this move.
 */
function scheduleMove(clientX: number, clientY: number): void {
    pendingMove = { clientX, clientY };

    if (moveRafHandle === null) {
        moveRafHandle = DOM.sink.requestAnimationFrame(() => flushMove());
    }
}

/**
 * Applies the most recently buffered {@link scheduleMove} call, if one is
 * pending — a no-op otherwise, which makes it safe to call unconditionally
 * from both the scheduled animation frame and {@link onMouseUp}.
 *
 * Re-derives the current target from scratch — the same `pickDropTarget`
 * plus enter/leave/same-target logic `onMouseMove` ran inline before this
 * buffering existed — rather than replaying each raw position a burst
 * skipped. See the worked example in the plan's Architecture Decisions for
 * why that can never strand a skipped target's visual state.
 */
function flushMove(): void {
    moveRafHandle = null;

    const pending = pendingMove;

    if (pending === null || activeSession === null) {
        return;
    }

    pendingMove = null;

    const session = activeSession;
    const detail  = buildDetail(session, pending.clientX, pending.clientY);
    const target  = pickDropTarget(pending.clientX, pending.clientY);

    if (target === null) {
        leaveCurrentTarget(session, detail);

        return;
    }

    if (session.currentTarget !== target.component) {
        leaveCurrentTarget(session, detail);
        enterNewTarget(session, target, detail);

        return;
    }

    // Same target as last flush — re-check accepts so the feedback
    // tint stays accurate (the validity of a drop can change as the
    // cursor moves within the same target, e.g. crossing into a
    // descendant region the source isn't allowed to land on). Skip
    // onDragOver / reorder indicator entirely while the drop is
    // rejected.
    const accepted = target.options.accepts(detail);

    if (session.feedback && !target.options.suppressValidityTint) {
        session.feedback.setValid(accepted);
    }

    if (!accepted) {
        if (session.indicator) {
            session.indicator.detach();
        }

        return;
    }

    const hint = target.options.onDragOver?.(detail);

    if (typeof hint === "number" && session.indicator) {
        session.indicator.attachTo(target.component);
        session.indicator.setInsertionY(hint);
    } else if (session.indicator) {
        session.indicator.detach();
    }
}
```

### `onMouseMove` — trimmed to threshold/commit, ghost reposition, and a schedule call

Replaces the doc comment ([DragManager.ts:504-512](packages/lib/src/typescript/lib/overlay/DragManager.ts#L504)):

```typescript
/**
 * Drives the active session forward on every raw `mousemove`: commits past
 * the threshold and repositions the ghost, both inline and unthrottled since
 * neither is expensive. Buffers the pointer position for {@link flushMove}
 * to resolve the drop target from at most once per animation frame — see
 * {@link scheduleMove} for why that part alone needs coalescing.
 *
 * @returns `true` while a drag session is live, consuming the move so nothing else
 *   tracks the pointer; nothing when there is no session, so the move keeps propagating.
 */
```

Replaces the body from the `session.ghost` block onward ([DragManager.ts:551-596](packages/lib/src/typescript/lib/overlay/DragManager.ts#L551)):

```typescript
if (session.ghost) {
    const dragGhost = session.ghost as unknown as { moveTo?: (x: number, y: number) => void };

    if (typeof dragGhost.moveTo === "function") {
        dragGhost.moveTo(e.clientX + GHOST_OFFSET_X, e.clientY + GHOST_OFFSET_Y);
    } else {
        session.ghost.setX(e.clientX + GHOST_OFFSET_X);
        session.ghost.setY(e.clientY + GHOST_OFFSET_Y);
    }
}

scheduleMove(e.clientX, e.clientY);

return { stop: true, prevent: true };
```

The threshold/commit block above it ([:520-538](packages/lib/src/typescript/lib/overlay/DragManager.ts#L520)) is unchanged.

### `onMouseUp` — cancel and flush before deciding the drop

Insert immediately after the existing `if (activeSession === null) { return; }` guard ([DragManager.ts:606-608](packages/lib/src/typescript/lib/overlay/DragManager.ts#L606)):

```typescript
// Flush any move buffered by scheduleMove synchronously, so the drop
// decision below reflects the pointer's actual last position rather than
// whichever buffered position a frame boundary happened to catch — mirrors
// Split.onDragEnd's flush of its own buffered drag position.
if (moveRafHandle !== null) {
    DOM.sink.cancelAnimationFrame(moveRafHandle);
    moveRafHandle = null;
}
flushMove();
```

No other change to `onMouseUp`.

### `endSession` — cancel only, no flush

Insert immediately after the existing `if (activeSession === null) { return; }` guard ([DragManager.ts:646-648](packages/lib/src/typescript/lib/overlay/DragManager.ts#L646)):

```typescript
// A still-buffered move frame (see scheduleMove) must not fire after this
// teardown — left alone it would call flushMove against a session that's
// about to be cleared. Cancelled without a flush: unlike onMouseUp's
// cancel-then-flush, a session ending here commits to no further target
// dispatch (see the cancel()/mouseup distinction in Architecture Decisions).
if (moveRafHandle !== null) {
    DOM.sink.cancelAnimationFrame(moveRafHandle);
    moveRafHandle = null;
}
pendingMove = null;
```

By the time `onMouseUp` reaches `endSession`, `moveRafHandle` and `pendingMove` are already `null` (cleared by the flush above), so this block only does real work on the `DragManager.cancel()` path.

---

## Ordered Implementation Steps

1. **Add the two module-level fields** to `packages/lib/src/typescript/lib/overlay/DragManager.ts`, after `activeSession` ([:196](packages/lib/src/typescript/lib/overlay/DragManager.ts#L196)). Declarations in *Internal Structure*.

2. **Add `scheduleMove` and `flushMove`**, placed after `enterNewTarget` ([:481](packages/lib/src/typescript/lib/overlay/DragManager.ts#L481)), before `onSelectStart`'s doc comment ([:483](packages/lib/src/typescript/lib/overlay/DragManager.ts#L483)). Bodies in *Internal Structure*. `DOM` is already imported ([:8](packages/lib/src/typescript/lib/overlay/DragManager.ts#L8)) — no new import. Both call only functions that already exist (`buildDetail`, `pickDropTarget`, `leaveCurrentTarget`, `enterNewTarget`).

3. **Replace `onMouseMove`'s doc comment** ([:504-512](packages/lib/src/typescript/lib/overlay/DragManager.ts#L504)) **and its body from the `session.ghost` block onward** ([:540-596](packages/lib/src/typescript/lib/overlay/DragManager.ts#L540)) with the two versions in *Internal Structure*. Leave the threshold/commit block ([:520-538](packages/lib/src/typescript/lib/overlay/DragManager.ts#L520)) untouched.

4. **Insert the cancel-and-flush block into `onMouseUp`**, immediately after its `activeSession === null` guard ([:606-608](packages/lib/src/typescript/lib/overlay/DragManager.ts#L606)). Snippet in *Internal Structure*. No other line in `onMouseUp` changes.

5. **Insert the cancel-only block into `endSession`**, immediately after its `activeSession === null` guard ([:646-648](packages/lib/src/typescript/lib/overlay/DragManager.ts#L646)). Snippet in *Internal Structure*.

   Checkpoint: `grep -n 'scheduleMove\|flushMove\|pendingMove\|moveRafHandle' packages/lib/src/typescript/lib/overlay/DragManager.ts` — every name defined and used only in this file; `grep -rln 'scheduleMove\|flushMove' packages/lib/src/typescript/lib/` — matches only `DragManager.ts`.

6. **Soften the stale "untestable offline" claim in `DragManager.test.ts`'s header comment** ([:1-10](packages/lib/tests/overlay/DragManager.test.ts#L1)). The comment says drag-start, ghost follow, target enter/leave, and drop "cannot be reached" offline because `elementsFromPoint` "returns `[]` offline" and `dispatchEvent` records "without invoking any listener" — both no longer true of the current `TestDOM.ts` (`elementsFromPoint` does real rect-based hit-testing at [TestDOM.ts:1477](packages/lib/tests/dom/TestDOM.ts#L1477); `dispatchEvent` invokes window-registered listeners at [:725](packages/lib/tests/dom/TestDOM.ts#L725)), as `DragManager.repeatedDragDisposal.test.ts` and `DragManager.styleRuleDisposal.test.ts` already demonstrate by driving a full press/move/release gesture through a registered drop target. Replace the comment with a short note that the full gesture *is* reachable via `makeEvent` + `DOM.sink.dispatchEvent` (see those two files and the new `DragManager.pointerCoalescing.test.ts`), so a future reader doesn't take the old claim at face value. Do not change any test body in this file — this step is comment-only.

7. **Write the new test file** `packages/lib/tests/overlay/DragManager.pointerCoalescing.test.ts`, covering every case in *Expected Behaviour*. Reuse the `makeEvent` + `DOM.sink.dispatchEvent` gesture-driving pattern from `DragManager.repeatedDragDisposal.test.ts` (its `dragOnce`/`dragSource`/`dropTarget` helpers are a direct starting point) and the animation-frame capture-and-drain harness from [`ScrollRebindLayoutEconomy.test.ts:31-61`](packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts#L31) — but give `cancelAnimationFrame` a real effect (key captured callbacks by an incrementing handle in a `Map` and delete on cancel, as the `virtual-row-view-resize-relayout` plan's own test harness does[^virtualrowview-branch]), since the cancel-mid-burst case must prove the callback never runs, not merely that nothing calls it in the assertion window.

8. **Typecheck, lint, test.** `npm run typecheck`, `npm run lint`, then the commands in *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/DragManager.ts` |
| Modify | `packages/lib/tests/overlay/DragManager.test.ts` (header comment only) |
| Create | `packages/lib/tests/overlay/DragManager.pointerCoalescing.test.ts` |

---

## Expected Behaviour

`DragManager.test.ts`'s own scope note (corrected in step 6) previously discouraged testing this flow at all; `DragManager.repeatedDragDisposal.test.ts` and `DragManager.styleRuleDisposal.test.ts` already prove the full gesture is reachable, so every case below is genuinely new coverage, not a rewrite of untestable ground.

### Unit-testable (offline, `installTestDOM` + `makeEvent`/`dispatchEvent` + captured animation frames)

Register one or two drop targets with spied `accepts`/`onDragOver`/`onDragLeave`/`onDrop` (mirroring `dropTarget()` in `DragManager.repeatedDragDisposal.test.ts`), drive gestures with `makeEvent(element, type)` + `DOM.sink.dispatchEvent`, and drain captured frames with a `runFrames()` helper as in `ScrollRebindLayoutEconomy.test.ts`.

1. **A burst of raw `mousemove`s over one target schedules exactly one animation frame and calls no target callback until it drains.** Press at `(10, 10)`, then three raw moves to `(60, 60)`, `(70, 70)`, `(90, 90)` (all inside a target spanning `(50, 50)`–`(450, 450)`), none drained: exactly one frame is captured, and the target's `onDragOver` spy has 0 calls.

2. **Draining applies only the latest buffered position.** Draining the one captured frame from case 1 calls `onDragOver` exactly once, with `detail.clientX === 90` and `detail.clientY === 90` — the last of the three moves, not either of the earlier two.

3. **A pointer that visits a second target and returns within one un-drained burst never touches the second target's callbacks.** Continuing from case 2 (current target resolved to Target 1): one more move to `(650, 650)` (inside a disjoint Target 2 spanning `(600, 600)`–`(700, 700)`), then one more move back to `(90, 90)`, neither drained. Draining the resulting frame calls Target 1's `onDragOver` a second time (total 2) and Target 1's `onDragLeave` zero times; Target 2's `onDragOver` and `onDragLeave` are each called zero times, for the whole test. Matches the worked table in *Architecture Decisions*.

4. **`mouseup` flushes a still-buffered move before deciding the drop, using the buffered position rather than the release event's own coordinates.** Press at `(10, 10)`, one move to `(60, 60)` (inside Target 1, not drained — the frame is still pending), then release at `(900, 900)` (outside every target). Target 1's `onDrop` is still called exactly once: the drop resolves against the flushed `(60, 60)`, not the release's own out-of-target position. `DragManager.isDragging()` is `false` afterward.

5. **`cancel()` cancels a pending frame without flushing it.** Press at `(10, 10)`, one move to `(60, 60)` (not drained — one frame captured), then `DragManager.cancel()`. Target 1's `onDragOver`/`onDragLeave` are never called, `DragManager.isDragging()` is `false`, and draining any remaining captured frames afterward invokes nothing (the `Map`-based `cancelAnimationFrame` override must show the callback was actually removed, not merely unreached).

6. **The ghost is repositioned on every raw move, not coalesced.** Spy on `_DragGhost.prototype.moveTo` (imported from `~/overlay/DragGhost`). Press, then three raw moves without draining: the spy is called three times (once per raw move), while the target's `onDragOver` spy is still at 0 calls for the same burst — pinning that ghost tracking and target resolution are decoupled.

7. **Existing regression suites are unaffected.** `DragManager.repeatedDragDisposal.test.ts` and `DragManager.styleRuleDisposal.test.ts` pass unmodified: each drives exactly one commit-crossing `mousemove` per gesture and relies on the gesture's drag chrome (feedback tint, reorder indicator) being fully attached and disposed by the time `mouseup` returns. `onMouseUp`'s synchronous flush is what keeps that true — the buffered move is applied (attaching the chrome via `enterNewTarget`) before `endSession` disposes it, even though the default `TestDOM` `requestAnimationFrame` never fires on its own.

### Manual-verify (real pointer feel and forced-layout cost are not exercisable offline)

- **A WebKit/Chrome performance trace of dragging a tab across a `Dock` layout** shows `elementsFromPoint`/`getElementRect`/`getViewportRect`'s forced-layout pair capped at roughly once per animation frame, not once per raw `mousemove`.
- **The drag still feels responsive**: the ghost tracks the cursor with no perceptible lag, and the reorder bar / drop-zone highlight / dock-region overlay each update within a frame of the cursor crossing into a new target or zone.
- **A within-strip tab reorder, a cross-strip tab dock, and a `TreeTable` row drop** each still land on the slot/zone/row the cursor was actually over at release.

---

## Verification

- **Typecheck:** `npm run typecheck` (clean).
- **Lint:** `npm run lint` (clean).
- **Unit tests:** `npx vitest run tests/overlay/DragManager.pointerCoalescing.test.ts tests/overlay/DragManager.test.ts tests/overlay/DragManager.repeatedDragDisposal.test.ts tests/overlay/DragManager.styleRuleDisposal.test.ts tests/layout/DockRegion.styleRuleDisposal.test.ts tests/component/container/TabBar.test.ts` from `packages/lib` — all green.
- **Grep invariants:** see the checkpoint in step 5.
- **Build:** `npm run build:lib` succeeds.
- **Manual live:** the docs app's `Dock`/`Tab` demo (`npm run docs:dev`), or the sibling Loom app's editor tabs and dock layout, exercising the manual-verify observations above with a WebKit/Chrome performance recording of a tab drag.

---

## Potential Challenges

- **A frame scheduled just before teardown must not fire afterward.** Mitigated by cancelling in both `onMouseUp` (before its own flush) and `endSession` — pinned by Expected Behaviour cases 4 and 5.
- **`mouseup`'s drop decision must reflect the buffered position, not the release event's own coordinates.** Mitigated by flushing before reading `session.currentTarget` rather than hit-testing at the release point — pinned by case 4.
- **Coalescing must not strand a skipped target's visual state.** Mitigated by re-deriving the current target from the single buffered position on every flush instead of diffing a stream of enter/leave events — pinned by case 3 and its worked table.
- **The offline sink drops `requestAnimationFrame` by default.** The new test file must capture frames explicitly, and its `cancelAnimationFrame` override must actually drop a cancelled callback (a `Map`, not a no-op) for case 5 to mean anything.

---

## Critical Files

- [`packages/lib/src/typescript/lib/overlay/DragManager.ts`](packages/lib/src/typescript/lib/overlay/DragManager.ts) — the only source file changed. Read `onMouseMove` ([:513](packages/lib/src/typescript/lib/overlay/DragManager.ts#L513)), `pickDropTarget` ([:412](packages/lib/src/typescript/lib/overlay/DragManager.ts#L412)), `leaveCurrentTarget`/`enterNewTarget` ([:430](packages/lib/src/typescript/lib/overlay/DragManager.ts#L430), [:457](packages/lib/src/typescript/lib/overlay/DragManager.ts#L457)), `onMouseUp` ([:605](packages/lib/src/typescript/lib/overlay/DragManager.ts#L605)), and `endSession` ([:645](packages/lib/src/typescript/lib/overlay/DragManager.ts#L645)).
- [`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts) — `scheduleDrag`/`flushDrag` ([:1098](packages/lib/src/typescript/lib/layout/Split.ts#L1098), [:1111](packages/lib/src/typescript/lib/layout/Split.ts#L1111)), `onDragEnd`'s cancel-then-flush ([:1135](packages/lib/src/typescript/lib/layout/Split.ts#L1135)), and `detach`'s cancel-only ([:1401](packages/lib/src/typescript/lib/layout/Split.ts#L1401)): the precedent this plan mirrors throughout.
- [`packages/lib/src/typescript/lib/overlay/DragGhost.ts`](packages/lib/src/typescript/lib/overlay/DragGhost.ts) — `moveTo` ([:90](packages/lib/src/typescript/lib/overlay/DragGhost.ts#L90)): confirms the ghost reposition this plan leaves unthrottled is two direct `setX`/`setY` writes.
- [`packages/lib/src/typescript/lib/component/container/TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts) — `makeTabDropTarget` ([:3022](packages/lib/src/typescript/lib/component/container/TabBar.ts#L3022)) and `updateReorderSlot` ([:3164](packages/lib/src/typescript/lib/component/container/TabBar.ts#L3164)): read to confirm the blast radius; not modified.
- [`packages/lib/src/typescript/lib/layout/DockRegion.ts`](packages/lib/src/typescript/lib/layout/DockRegion.ts) — the drop-target registration ([:59](packages/lib/src/typescript/lib/layout/DockRegion.ts#L59)) and `computeZone` ([:238](packages/lib/src/typescript/lib/layout/DockRegion.ts#L238)): read to confirm the blast radius; not modified.
- [`packages/lib/tests/overlay/DragManager.repeatedDragDisposal.test.ts`](packages/lib/tests/overlay/DragManager.repeatedDragDisposal.test.ts) and [`DragManager.styleRuleDisposal.test.ts`](packages/lib/tests/overlay/DragManager.styleRuleDisposal.test.ts) — the `makeEvent`/`dispatchEvent` gesture-driving pattern the new test file copies, and the two regression suites Expected Behaviour case 7 pins.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — `elementsFromPoint` ([:1477](packages/lib/tests/dom/TestDOM.ts#L1477)), `dispatchEvent` ([:725](packages/lib/tests/dom/TestDOM.ts#L725)), `makeEvent` ([:1641](packages/lib/tests/dom/TestDOM.ts#L1641)), and the default drop-callback `requestAnimationFrame`/`cancelAnimationFrame` ([:748](packages/lib/tests/dom/TestDOM.ts#L748)) the new test file overrides.
- [`packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts`](packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts) — the animation-frame capture-and-drain harness shape the new test file copies.
- `plans/scrollstrip-resize-resync-coalescing.md` / `plans/virtual-row-view-resize-relayout.md` — read for tone and structure, and for the `Map`-based `cancelAnimationFrame` test-harness detail cited in step 7; their settle-after-a-burst *mechanism* does not apply here (see *Architecture Decisions*).
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the `Event`/DOM-seam rules (`Event.addViewportListener`'s unfiltered, window-level dispatch) and the drag-and-drop feedback-colour convention this plan's targets rely on; no rule here is touched, only cited for context.

---

## Non-Goals

- **The settle-after-a-burst mechanism `ScrollStrip`/`VirtualRowView` use.** Rejected in *Architecture Decisions*: there is no live external driver whose quiescence needs detecting here, so plain latest-value buffering is already sufficient.
- **Reducing `pickDropTarget`'s per-call cost** (e.g. a spatial index instead of `elementsFromPoint`). This plan changes how often it runs, not what it costs per call.
- **`cancel()`'s pre-existing gap**: `endSession` never calls `leaveCurrentTarget`, so cancelling a drag mid-hover today leaves a target's own `onDragLeave` uncalled (e.g. a `DockRegion`'s overlay or a `TabBar`'s drop tint stays attached until the next drag repaints over it). This is unrelated to pointer-move coalescing — it exists identically before this plan — and stays out of scope.
- **A drag source disposed mid-gesture.** `DragManager` has no existing hook that aborts a session when its source component is torn down; this plan's new buffered-move state tears down through the same `endSession` funnel as every other piece of session state, so it introduces no leak beyond what already exists today.
- **Any change to `TabBar.ts`, `DockRegion.ts`, or `TreeTable`'s drag wiring.** All three already recompute their geometry from the `DragEventDetail` passed to each call, so they inherit the coalescing with no wiring of their own.

---

## Notes

[^split-precedent]: `Split.scheduleDrag`/`flushDrag` buffer a gutter's `drag` events and apply at most one per animation frame, with a synchronous flush on drag-end and a cancel in `detach()` for a drag torn down mid-flight. This plan copies the same three things: arm the frame once and leave it armed while further events arrive (rather than cancel-and-re-arm per event), hold the handle in a nullable field that doubles as the "in flight" test, and cancel that handle at every teardown path.

[^ghost-cheap]: Checked rather than assumed. `Component.setX` ([Component.ts:4222](packages/lib/src/typescript/lib/core/Component.ts#L4222)) and `setY` ([:4258](packages/lib/src/typescript/lib/core/Component.ts#L4258)) each compare against the cached field, return early when unchanged, and otherwise queue an inline-style write (`writeHorizontalGeometry`/`writeVerticalGeometry`) deferred to render per `ARCHITECTURE.md`'s *Defer DOM work to render time* — no DOM read, no forced layout. `DragGhost.moveTo` is exactly those two calls. Contrast `pickDropTarget`'s `DOM.source.elementsFromPoint` and the two `onDragOver` consumers' `getElementRect`/`getViewportRect`, all three backed by `getBoundingClientRect()`/`elementsFromPoint()` — reads that force the browser to flush any pending layout synchronously before they can answer.

[^why-not-settle]: The alternative considered was reusing `ScrollStrip`/`VirtualRowView`'s arm-a-settle-frame-and-extend-it-while-a-driver-keeps-moving mechanism. It solves a different shape of problem: those components have no way to know when an *external* resize (a `Split` gutter drag happening in a different file entirely) will stop, so they infer a burst from their own inputs and add a settle pass once the burst goes quiet. `DragManager`'s `mousemove` dispatch has no external driver to wait out — `DragManager` itself receives every event directly — so there is no "still bursting vs. quiet" distinction to make; every event during a drag is equally "live," and the very next animation frame is always the correct, final point to resolve against. Introducing settle-frame bookkeeping here would add state (`_moved`/`_owed`-style flags, a second scheduling path) with nothing for it to actually resolve.

[^mouseup-flush]: `Split.onDragEnd` ([Split.ts:1135](packages/lib/src/typescript/lib/layout/Split.ts#L1135)) cancels its pending animation frame and calls `flushDrag()` before emitting `paneresize`, "so the committed sizes always reflect the pointer's actual last position rather than whichever buffered position a frame boundary happened to catch." `onMouseUp` needs the identical guarantee for the same reason: without the flush, a drop decided between a buffered `mousemove` and the next unflushed frame would act on a target one frame stale, which — unlike a merely-late highlight — is an outright wrong drop.

[^virtualrowview-branch]: At drafting time, the `virtual-row-view-resize-relayout` plan (`plans/virtual-row-view-resize-relayout.md`) is not yet implemented — it exists only as a pre-implementation plan, not yet moved to `plans/implemented/`. Its test-harness guidance (a `Map`-keyed `cancelAnimationFrame` override so a cancelled callback is provably dropped, not merely unreached) is cited by name and shape here because it is the clearest existing description of that harness detail; it carries no dependency on that plan's own subject matter.
