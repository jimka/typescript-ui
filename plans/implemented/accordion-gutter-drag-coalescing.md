# Accordion Gutter Drag Coalescing — Implementation Plan

## Overview

`Accordion`'s resizable-section gutters have the same unthrottled-dispatch bug `Split`'s gutters had before [`Split.scheduleDrag`/`flushDrag`](packages/lib/src/typescript/lib/layout/Split.ts#L1098) fixed it, and it is worse here. [`getOrCreateResizeGutter`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1725) wires a gutter's `drag` event straight to `onGutterDrag` with no buffering: `gutter.on("drag", (position) => this.onGutterDrag(index, position))` ([Accordion.ts:1737](packages/lib/src/typescript/lib/layout/Accordion.ts#L1737)). The gutter is the same [`SplitGutter`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts) class `Split` uses: its `onDrag` is the raw viewport `mousemove`/`touchmove` handler ([SplitGutter.ts:637](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L637)), and it calls `_dispatchDrag` → `emit("drag", position)` ([:578](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L578)) synchronously on **every** native event. `SplitGutter` itself does no throttling — that is exactly why `Split` needed its own wrapper, and `Accordion` never added the equivalent one.

`onGutterDrag` ([Accordion.ts:1829](packages/lib/src/typescript/lib/layout/Accordion.ts#L1829)) distributes the frame's pointer travel through a nearest-first chain (`chainRoom`/`distributeDragChain`, [core/DragChain.ts:39](packages/lib/src/typescript/lib/core/DragChain.ts#L39) and [:68](packages/lib/src/typescript/lib/core/DragChain.ts#L68)) across every open section, then calls `layoutSections` ([:1616](packages/lib/src/typescript/lib/layout/Accordion.ts#L1616)) synchronously. Inside `layoutSections`, any section whose height changed this pass gets `component.doLayout()` ([:1691](packages/lib/src/typescript/lib/layout/Accordion.ts#L1691), guarded at [:1677](packages/lib/src/typescript/lib/layout/Accordion.ts#L1677)). Because the chain fans out from the dragged gutter in both directions, one raw pointer event can force `doLayout()` on more than two sections — `Split`'s equivalent bug was always exactly two panes. Any open section can host something as heavy as a `Table`, `TreeTable`, or nested `Tree`, so each of those calls is not a fixed, cheap cost.

This plan gives `Accordion` its own `scheduleGutterDrag`/`flushGutterDrag`, mirroring `Split.scheduleDrag`/`flushDrag` almost exactly: buffer the latest `{gutterIndex, position}`, apply at most one per animation frame, flush synchronously at drag end, and cancel — without applying — a frame still pending at teardown. `layoutSections`'s already-narrow drag path (the earlier [`accordion-resizable-drag-perf-and-snap.md`](plans/implemented/accordion-resizable-drag-perf-and-snap.md) plan's fix, which made the drag write only the sections whose height changed instead of running a full container layout) is unchanged — only how often it runs changes. No public API changes: every new field and method is private.

---

## Architecture Decisions

### Buffer the latest `drag` event and flush at most once per frame, mirroring `Split.scheduleDrag`/`flushDrag`

`Accordion` gains a `scheduleGutterDrag(gutterIndex, position)` that overwrites a single pending buffer and arms one `DOM.sink.requestAnimationFrame`, and a `flushGutterDrag()` that applies the buffered call (if any) by invoking `onGutterDrag` directly — the exact shape of `Split.scheduleDrag` ([Split.ts:1098](packages/lib/src/typescript/lib/layout/Split.ts#L1098)) / `flushDrag` ([:1111](packages/lib/src/typescript/lib/layout/Split.ts#L1111)).[^path-independence]

### One shared buffer, not one per gutter

The buffer holds a single `{gutterIndex, position}`, not an array keyed by gutter. `Accordion` already commits to "only one gutter can be mid-drag at a time": `_dragUpper`, `_dragLower`, `_dragLastPointer`, `_dragOpenIndices`, and `_dragGutterUpperPos` ([Accordion.ts:199-203](packages/lib/src/typescript/lib/layout/Accordion.ts#L199)) are single fields, not per-gutter maps or arrays — a real pointer drives one `mousedown` at a time, so a second gutter's `dragstart` cannot arrive while the first is still live. The new buffer follows the same shape for the same reason.

### Not routed through `Component.scheduleLayout()`

`Table`'s column-resize drag (`onColumnResize`, [Table.ts:2166](packages/lib/src/typescript/lib/component/table/Table.ts#L2166)) and `Slider`'s pointer drag (`applyValue`, [Slider.ts:697](packages/lib/src/typescript/lib/component/input/Slider.ts#L697)) both call `this.scheduleLayout()` on every raw event instead of hand-rolling a buffer, but neither is the pattern to copy here: both keep their own state update (the new column widths, the new value) live on every raw event and defer only the DOM-facing `doLayout()` call, and in both cases that deferred `doLayout()` is already the narrow, correct piece of work — repositioning columns, moving one thumb. Deferring to `container.scheduleLayout()` for an `Accordion`-managed container would instead flush to `Accordion.doLayout()`, which unconditionally reflows **every** displayed section (`reflowAll: true`, [Accordion.ts:1591](packages/lib/src/typescript/lib/layout/Accordion.ts#L1591)) and recomputes `computeFill`/`computeResizableHeights` from scratch — exactly the cost `accordion-resizable-drag-perf-and-snap.md` already removed from the drag path by giving it the narrow `layoutSections(..., reflowAll: false)` call ([Accordion.ts:1616](packages/lib/src/typescript/lib/layout/Accordion.ts#L1616), [:1677](packages/lib/src/typescript/lib/layout/Accordion.ts#L1677)). `Component.scheduleLayout()` has no way to name a different method to call on flush, so it cannot reach `layoutSections` directly — only a bespoke buffer that calls `onGutterDrag` itself preserves that narrowness.[^why-not-split]

### `onGutterDragEnd` flushes; `detach()` cancels without flushing

`onGutterDragEnd` — the real end-of-drag path, wired to the gutter's own `dragend` event — cancels any pending animation frame and flushes it before clearing the drag state, so the committed sizes and the `sectionresize` event always reflect the pointer's actual last position. `detach()` — reached both by a live manager swap and, mid-drag, by `Component.destructor` tearing the whole accordion down — instead cancels a pending frame and discards it **without** applying it, before it goes on to call the same `onGutterDragEnd` (whose own flush is then a no-op, because the buffer is already empty).[^detach-safety] `Accordion` extends `LayoutManager` and, like `Split`, has no `destructor()` of its own — `detach()` is its sole teardown hook. It already cancels other in-flight async state there (the `_shrinkAnimations`/`_wrapperAnimations` height-transition maps, [Accordion.ts:1130-1138](packages/lib/src/typescript/lib/layout/Accordion.ts#L1130)), so adding one more cancel for the drag animation frame follows that method's own established job, not a new kind of cleanup.

---

## Internal Structure

### New private fields

Placed after `_dragGutterUpperPos` ([Accordion.ts:203](packages/lib/src/typescript/lib/layout/Accordion.ts#L203)), extending the existing "drag state captured on gutter dragstart" comment block:

```typescript
// The most recent not-yet-applied gutter `drag` event, and the animation
// frame scheduled to apply it via `flushGutterDrag` — see
// `scheduleGutterDrag`. `null`/`null` while no gutter is mid-drag or every
// buffered event has already been flushed. One shared buffer is enough:
// only one gutter can be mid-drag at a time, which is also why
// `_dragUpper`/`_dragLower` above are single fields rather than per-gutter.
private _pendingGutterDrag: { gutterIndex: number; position: number } | null = null;
private _dragRafHandle: number | null = null;
```

### `scheduleGutterDrag` / `flushGutterDrag`

Inserted immediately after `onGutterDrag`'s closing brace ([Accordion.ts:1924](packages/lib/src/typescript/lib/layout/Accordion.ts#L1924)), before the JSDoc for `onGutterDragEnd` — the same relative position `Split.scheduleDrag`/`flushDrag` occupy between `onDrag` and `onDragEnd`:

```typescript
/**
 * Buffers a resizable gutter's `drag` event and applies at most one per
 * animation frame, via {@link flushGutterDrag}. Mirrors
 * {@link Split.scheduleDrag}: a native `mousemove` fires far more often than
 * the screen repaints, and `onGutterDrag`'s chained redistribution can force
 * `doLayout()` on more than two sections at once — any of which may host
 * something like a mounted `Table` or `Tree` — so dispatching it unthrottled
 * can run that whole chain once per raw pointer-move rather than once per
 * rendered frame. Only the most recent event before a frame lands is kept —
 * an intermediate position between two `mousemove` events was never going to
 * be visible anyway, and {@link chainRoom}/{@link distributeDragChain}'s
 * nearest-first distribution is a pure function of the sections' current
 * live heights, not of how many intermediate calls got there, so skipping
 * intermediate positions changes nothing about where the sections end up.
 *
 * @param gutterIndex - The dragged gutter's position in `_gutterPairs`, forwarded to `onGutterDrag`.
 * @param position - The absolute pointer coordinate (`clientY`) for this move.
 */
private scheduleGutterDrag(gutterIndex: number, position: number): void {
    this._pendingGutterDrag = { gutterIndex, position };

    if (this._dragRafHandle === null) {
        this._dragRafHandle = DOM.sink.requestAnimationFrame(() => this.flushGutterDrag());
    }
}

/**
 * Applies the most recently buffered {@link scheduleGutterDrag} call, if one
 * is pending — a no-op otherwise, which makes it safe to call unconditionally
 * from both the scheduled animation frame and {@link onGutterDragEnd}.
 */
private flushGutterDrag(): void {
    this._dragRafHandle = null;

    const pending = this._pendingGutterDrag;

    if (pending === null) {
        return;
    }

    this._pendingGutterDrag = null;

    this.onGutterDrag(pending.gutterIndex, pending.position);
}
```

### Gutter wiring change

In `getOrCreateResizeGutter` ([Accordion.ts:1737](packages/lib/src/typescript/lib/layout/Accordion.ts#L1737)), change:

```typescript
gutter.on("drag", (position: number) => this.onGutterDrag(index, position));
```

to:

```typescript
gutter.on("drag", (position: number) => this.scheduleGutterDrag(index, position));
```

### `onGutterDragEnd`

Replace the body of `onGutterDragEnd` ([Accordion.ts:1938](packages/lib/src/typescript/lib/layout/Accordion.ts#L1938)) and update its doc comment:

```typescript
/**
 * Ends a resizable-gutter drag: cancels and synchronously flushes any
 * animation frame {@link scheduleGutterDrag} still has pending, so the
 * committed sizes always reflect the pointer's actual last position rather
 * than whichever buffered position a frame boundary happened to catch — and
 * so this resolves at all offline, where the `requestAnimationFrame` this
 * scheduled never fires (see DOMSink) — then clears the captured drag pair.
 * Transitions stay off (their default outside a toggle), so there is nothing
 * to restore. Fires `sectionresize` with the post-drag sizes when a drag was
 * actually live — including on the `detach()` mid-drag path, which calls this
 * after already cancelling and discarding any buffered frame itself (see
 * `detach()`), so the flush here is a safe no-op in that case. Also callable
 * directly (with no argument) so `detach()` and tests can simulate a drag end.
 *
 * @returns `true`, consuming the release that ends the gutter drag.
 */
private onGutterDragEnd(): Event.ListenerResult {
    if (this._dragRafHandle !== null) {
        DOM.sink.cancelAnimationFrame(this._dragRafHandle);
        this._dragRafHandle = null;
    }

    this.flushGutterDrag();

    const wasDragging = this._dragUpper !== null;

    this._dragUpper = null;
    this._dragLower = null;

    if (wasDragging) {
        this.emit("sectionresize", this.getSectionSizes());
    }

    return true;
}
```

### `detach()`

Insert a new block directly before the existing `if (this._dragUpper) { this.onGutterDragEnd(); }` check ([Accordion.ts:1155-1157](packages/lib/src/typescript/lib/layout/Accordion.ts#L1155)), leaving that existing check and its comment untouched:

```typescript
// A still-buffered drag frame (see scheduleGutterDrag) left alone would
// fire after this detach and call onGutterDrag against sections that may
// already be destroyed — Component.destructor empties the container's
// component list before calling layoutManager.detach(), so
// container.getComponents() can already be [] by the time this runs.
// Cancel it without applying it; onGutterDragEnd's own flush below becomes
// a safe no-op now that the buffer is cleared.
if (this._dragRafHandle !== null) {
    DOM.sink.cancelAnimationFrame(this._dragRafHandle);
    this._dragRafHandle = null;
}
this._pendingGutterDrag = null;
```

---

## Ordered Implementation Steps

1. **Add the two private fields** to `packages/lib/src/typescript/lib/layout/Accordion.ts`, after `_dragGutterUpperPos` ([:203](packages/lib/src/typescript/lib/layout/Accordion.ts#L203)). Declaration in *Internal Structure*.

2. **Add `scheduleGutterDrag` and `flushGutterDrag`**, inserted directly after `onGutterDrag` ([:1924](packages/lib/src/typescript/lib/layout/Accordion.ts#L1924)) and before `onGutterDragEnd`'s JSDoc. Bodies in *Internal Structure*. `DOM` is already imported ([:16](packages/lib/src/typescript/lib/layout/Accordion.ts#L16)) — no new import.

3. **Change the gutter's `drag` wiring** in `getOrCreateResizeGutter` ([:1737](packages/lib/src/typescript/lib/layout/Accordion.ts#L1737)) from calling `onGutterDrag` directly to calling `scheduleGutterDrag`, as shown in *Internal Structure*.

4. **Replace `onGutterDragEnd`'s body and doc comment** ([:1926-1949](packages/lib/src/typescript/lib/layout/Accordion.ts#L1926)) with the version in *Internal Structure*. Signature and return type (`Event.ListenerResult`, returning `true`) are unchanged.

5. **Insert the cancel-without-flush block in `detach()`**, directly before the existing `if (this._dragUpper) { this.onGutterDragEnd(); }` check ([:1155](packages/lib/src/typescript/lib/layout/Accordion.ts#L1155)). Body in *Internal Structure*. Leave the existing check and its comment as they are.

   Checkpoint: `grep -rn 'scheduleGutterDrag\|flushGutterDrag\|_pendingGutterDrag\|_dragRafHandle' packages/lib/src/typescript/lib/` — every name appears only in `Accordion.ts`.

6. **Add three tests to** `packages/lib/tests/component/layout/Accordion.resizable.test.ts`, covering the cases in *Expected Behaviour*:
   - Two new tests in a new `describe('Accordion resizable — gutter drag coalescing', ...)` block, inserted after the `'Accordion resizable — lightweight drag path'` block closes ([:1078](packages/lib/tests/component/layout/Accordion.resizable.test.ts#L1078)) and before `'Accordion resizable — teardown'` opens ([:1080](packages/lib/tests/component/layout/Accordion.resizable.test.ts#L1080)). Drive these through the gutter's own DOM handlers (`(acc as any)._resizeGutters[0].onDragStart(...)` / `.onDrag(...)` / `.onDragStop()`), mirroring `Split.test.ts`'s `'coalesces a burst of gutter drag events...'` and `'paneresize still fires exactly once...'` tests — not the direct `onGutterDragStart`/`onGutterDrag` calls the rest of this file uses, since those bypass `scheduleGutterDrag` entirely.
   - One new test in the existing `'Accordion resizable — teardown'` block ([:1080](packages/lib/tests/component/layout/Accordion.resizable.test.ts#L1080)), added after the existing `'detaching mid-drag ends the in-flight drag...'` test. Needs a local override of `DOM.sink.requestAnimationFrame`/`cancelAnimationFrame` that actually removes a cancelled callback — the default offline sink permanently drops every `requestAnimationFrame` callback without storing it (`packages/lib/tests/dom/TestDOM.ts:748-756`), so it cannot distinguish "cancelled" from "never going to run anyway". At the top of the test: keep an incrementing handle counter and a `Map<number, FrameRequestCallback>`; override `(DOM.sink as any).requestAnimationFrame` to store the callback under the next handle and return it, and `(DOM.sink as any).cancelAnimationFrame` to delete that handle from the map. After `acc.detach()`, assert the map is empty, then invoke any callbacks still in it (there should be none) and assert the `onGutterDrag` spy was never called. Restore the original `DOM.sink.requestAnimationFrame`/`cancelAnimationFrame` at the end of the test. This mirrors the harness shape `packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts:31-61` uses for a coalesced-frame test, with a real (not no-op) cancel.

7. **Typecheck, lint, test.** `npm run typecheck`, `npm run lint`, then the commands in *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/Accordion.ts` |
| Modify | `packages/lib/tests/component/layout/Accordion.resizable.test.ts` |

---

## Expected Behaviour

The existing `Accordion.resizable.test.ts` drives every drag test by calling the private `onGutterDragStart`/`onGutterDrag`/`onGutterDragEnd` methods directly, bypassing the gutter's own dispatch entirely, so none of it exercises `scheduleGutterDrag`. Every case below is new coverage; none of it changes what `onGutterDrag`/`layoutSections` compute, only how often they run.

### Unit-testable (offline, `installTestDOM`)

1. **A burst of raw gutter `drag` events is coalesced to the latest position, applied once.** Build a two-open-section resizable accordion, spy on `(acc as any).onGutterDrag`, then drive `(acc as any)._resizeGutters[0].onDragStart({ clientY: 0 })` followed by three `.onDrag({ clientY: ... })` calls at increasing positions with no `.onDragStop()` in between. `onGutterDrag` must not have been called yet — the default offline sink permanently drops every `requestAnimationFrame` callback (`packages/lib/tests/dom/TestDOM.ts:748-756`), so nothing is applied until something forces a flush — and no section height has changed. Calling `.onDragStop()` then flushes synchronously: `onGutterDrag` is called exactly once, with the *last* of the three positions, and the upper section's height has grown.

2. **`sectionresize` still fires exactly once at drag end for a coalesced burst.** Same drive sequence as case 1, with a `sectionresize` listener registered instead of the `onGutterDrag` spy: the listener fires exactly once, called with `acc.getSectionSizes()`.

3. **A still-buffered drag frame does not fire after `detach()`.** With the local frame-capture-and-real-cancel override from step 6 installed: start a drag, drive one `.onDrag(...)` (buffering a frame, not yet applied), then call `acc.detach()`. The captured frame must have been removed by the cancel (no pending callback left to drain), and draining any frames that remain must call `onGutterDrag` zero times and throw nothing.

4. **The existing `'detaching mid-drag ends the in-flight drag'` test** ([Accordion.resizable.test.ts:1088](packages/lib/tests/component/layout/Accordion.resizable.test.ts#L1088)) **passes unchanged** — it never drives a `drag` event through the gutter, so it never populates the new buffer, and the new cancel block in `detach()` is a no-op for it.

5. **Every existing resizable-mode test passes unchanged** — none of them go through `scheduleGutterDrag`, since they all call `onGutterDrag` directly.

### Manual-verify (pointer drag and paint are not exercisable offline)

- **Dragging a resizable gutter over a section that hosts something heavy (a `Table`, `TreeTable`, or nested `Tree`) is materially smoother**, with no per-`mousemove` stutter during a fast drag.
- **On release, the boundary lands exactly under the cursor** — no lag or overshoot between the last visible position and the committed one.
- **A one-off, slow drag is visually indistinguishable from today** — coalescing only removes redundant work between two rendered frames; it does not change where the boundary ends up.

---

## Verification

- **Typecheck:** `npm run typecheck` (clean).
- **Lint:** `npm run lint` (clean).
- **Unit tests:** `npx vitest run tests/component/layout/Accordion.resizable.test.ts tests/component/layout/Accordion.manager.test.ts` from `packages/lib` — all green, including the three new cases.
- **Grep invariants:** see the checkpoint in step 5.
- **Build:** `npm run build:lib` succeeds.
- **Manual live:** the docs app's Accordion demo (`npm run docs:dev`) with **Resizable** enabled and a heavy component (e.g. a `Table` or `Tree` demo) placed in one section, or the sibling Loom app's own resizable panels — exercising the manual-verify observations above, ideally with a WebKit/Chrome performance recording of a fast gutter drag.

---

## Potential Challenges

- **Two different call paths reach the same `onGutterDragEnd`, with different safety requirements.** The live `dragend` path must flush; the `detach()` teardown path must not. Mitigated by having `detach()` neutralize the buffer *before* calling `onGutterDragEnd`, so the shared method's own flush is a safe no-op there — pinned by Expected Behaviour case 3.
- **The offline sink drops `requestAnimationFrame` unconditionally**, so it cannot distinguish "the frame was correctly cancelled" from "it was going to be dropped anyway." Mitigated by installing a local override with real cancel semantics for the one test that needs to tell the difference (step 6), scoped to that test so the rest of the file's default behaviour is undisturbed.
- **Coalescing must not change where a drag ends up, only how often it recomputes.** Mitigated by `chainRoom`/`distributeDragChain` being a pure function of live values with no path dependence (see `DragChain.ts`'s own doc comment), confirmed against source rather than assumed — see [^path-independence].

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/Accordion.ts`](packages/lib/src/typescript/lib/layout/Accordion.ts) — the only source file changed. Read `getOrCreateResizeGutter` ([:1725](packages/lib/src/typescript/lib/layout/Accordion.ts#L1725)), `onGutterDragStart`/`onGutterDrag`/`onGutterDragEnd` ([:1777](packages/lib/src/typescript/lib/layout/Accordion.ts#L1777)–[:1949](packages/lib/src/typescript/lib/layout/Accordion.ts#L1949)), `layoutSections` ([:1616](packages/lib/src/typescript/lib/layout/Accordion.ts#L1616)), and `detach` ([:1125](packages/lib/src/typescript/lib/layout/Accordion.ts#L1125)).
- [`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts) — `scheduleDrag` ([:1098](packages/lib/src/typescript/lib/layout/Split.ts#L1098)), `flushDrag` ([:1111](packages/lib/src/typescript/lib/layout/Split.ts#L1111)), `onDragEnd` ([:1135](packages/lib/src/typescript/lib/layout/Split.ts#L1135)), and `detach`'s cancel-without-flush block ([:1410-1417](packages/lib/src/typescript/lib/layout/Split.ts#L1410)) — the precedent this plan mirrors throughout.
- [`packages/lib/src/typescript/lib/component/container/SplitGutter.ts`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts) — `onDrag`/`_dispatchDrag` ([:637](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L637), [:578](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L578)): confirms the raw, unthrottled dispatch both `Split` and `Accordion` gutters share.
- [`packages/lib/src/typescript/lib/core/DragChain.ts`](packages/lib/src/typescript/lib/core/DragChain.ts) — `chainRoom` ([:39](packages/lib/src/typescript/lib/core/DragChain.ts#L39)), `distributeDragChain` ([:68](packages/lib/src/typescript/lib/core/DragChain.ts#L68)): read to confirm the nearest-first distribution has no path dependence, which is what makes skipping intermediate positions safe.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `destructor` ([:1016](packages/lib/src/typescript/lib/core/Component.ts#L1016)), specifically the child-destruction loop ([:1071-1074](packages/lib/src/typescript/lib/core/Component.ts#L1071)) running *before* `layoutManager.detach()` ([:1111-1115](packages/lib/src/typescript/lib/core/Component.ts#L1111)): the evidence for why `detach()` must not flush.
- [`packages/lib/tests/component/layout/Split.test.ts`](packages/lib/tests/component/layout/Split.test.ts) — the `'coalesces a burst of gutter drag events...'` and `'paneresize still fires exactly once...'` tests (around [:1291](packages/lib/tests/component/layout/Split.test.ts#L1291)): the shape the new Accordion tests copy.
- [`packages/lib/tests/component/layout/Accordion.resizable.test.ts`](packages/lib/tests/component/layout/Accordion.resizable.test.ts) — the existing harness (`hostAccordion`/`content`/`constraints`) and the `'Accordion resizable — teardown'` block ([:1080](packages/lib/tests/component/layout/Accordion.resizable.test.ts#L1080)) the new tests extend.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — `requestAnimationFrame`/`cancelAnimationFrame` ([:748-756](packages/lib/tests/dom/TestDOM.ts#L748)): confirms the default offline sink drops every frame unconditionally, which is why the teardown test needs its own override.
- [`packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts`](packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts) — `beforeEach`/`afterEach`/`runFrames` ([:31-61](packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts#L31)): the animation-frame capture harness shape the new teardown test's local override copies (with a real, not no-op, `cancelAnimationFrame`).
- [`plans/implemented/accordion-resizable-drag-perf-and-snap.md`](plans/implemented/accordion-resizable-drag-perf-and-snap.md) — the earlier plan that narrowed the drag path to `layoutSections(reflowAll: false)`. Read it to see what is already solved (the drag no longer touches unrelated sections or runs a full container layout) versus what this plan adds (how often the already-narrow path runs).
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the typed-setter and DOM-seam rules the new code must honour (already-imported `DOM`, no raw DOM access added).

---

## Non-Goals

- **Settle-frame / burst-detection machinery.** This is the `Split.ts`-shaped bug — raw per-event dispatch with zero throttling — not the `ScrollStrip`/`VirtualRowView` class of bug (a live-resize resync that must catch up one frame after a burst settles). A plain buffer-and-flush-once-per-frame is sufficient; there is no settle-frame race to guard against here.
- **Narrowing `onGutterDrag`/`layoutSections` further.** `accordion-resizable-drag-perf-and-snap.md` already made the drag path write only the sections whose height changed. This plan changes only how often that path runs.
- **Any change to `Split.ts` or `SplitGutter.ts`.** Both are already fixed (`Split`) or shared and correct as-is (`SplitGutter` — its raw, unthrottled dispatch is exactly what every consumer, `Split` included, is expected to wrap).
- **Coalescing `Accordion`'s toggle-driven `layoutSections` calls.** Open/close toggles run through `primeWrapper`'s animated path, not `onGutterDrag`, and are unaffected by this plan.

---

## Notes

[^path-independence]: `DragChain.ts`'s own doc comment for `distributeDragChain` states the distribution "is purely a function of the live values — the drag keeps no memory of where each entry started." `chainRoom` likewise only reads each position's current value against its `[min, max]`. Given the same set of open sections and the same current heights, applying one combined delta produces the same result as applying two smaller deltas that sum to it — so buffering three raw `mousemove` events into one flushed call with the *last* position is equivalent to applying all three, matching `Split.scheduleDrag`'s own reasoning ("an intermediate position between two `mousemove` events was never going to be visible anyway"). This also means the per-call `_dragLastPointer` bookkeeping ([Accordion.ts:1845](packages/lib/src/typescript/lib/layout/Accordion.ts#L1845), [:1891](packages/lib/src/typescript/lib/layout/Accordion.ts#L1891)) needs no change: it already advances only by the travel actually applied, and coalescing simply means fewer, larger advances instead of many small ones.

[^why-not-split]: An alternative structure was considered: split `onGutterDrag` the way `Table.onColumnResize`/`Slider.applyValue` are structured — keep the chain-math and `_resizeSizes`/`_dragLastPointer` updates running synchronously on every raw event, and defer only the `layoutSections` call (and the sections' `component.doLayout()`) to a coalesced pass. This would be behaviourally equivalent to the buffer-the-whole-call approach this plan takes, because nothing reads `_resizeSizes` or `_dragLastPointer` between raw events faster than once a frame — but it requires restructuring `onGutterDrag` into two phases for no behavioural gain, where `Split.scheduleDrag`'s shape (buffer the whole call) needs no restructuring at all. Rejected in favour of the simpler, already-named precedent.

[^detach-safety]: `Component.destructor` ([Component.ts:1016](packages/lib/src/typescript/lib/core/Component.ts#L1016)) destroys every child in `_components` and empties the array ([:1071-1074](packages/lib/src/typescript/lib/core/Component.ts#L1071)) *before* calling `layoutManager.detach()` ([:1111-1115](packages/lib/src/typescript/lib/core/Component.ts#L1111)). So a dispose-triggered `Accordion.detach()` can run with `container.getComponents()` already `[]`. `onGutterDrag` reads `container.getComponents()` and indexes into it by the open-section indices captured at drag start ([Accordion.ts:1837-1850](packages/lib/src/typescript/lib/layout/Accordion.ts#L1837)); against an emptied list this reads `undefined` and throws on the following `.getHeight()` call. `Split.detach()` ([Split.ts:1401](packages/lib/src/typescript/lib/layout/Split.ts#L1401)) takes the identical precaution for the identical reason, per its own comment: "left alone, it would fire after this detach and call `onDrag` against panes `gutter.dispose()` below is about to tear down." `Accordion`'s `detach()` additionally still calls `onGutterDragEnd()` itself when a drag was live at teardown (existing behaviour, unrelated to this plan, which fires `sectionresize` on a forced mid-drag teardown) — clearing the buffer first makes that call's own flush a no-op instead of requiring a second, parallel safety check.
