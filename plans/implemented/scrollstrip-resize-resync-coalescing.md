# ScrollStrip Resize Resync Coalescing — Implementation Plan

## Overview

A WebKit profiling session of a live `Split` gutter drag in Loom (a desktop app built on this library) found that 43.4% of sampled CPU time during the drag — about 2.08s of 4.8s — goes into a single forced synchronous layout, repeated every animation frame of the drag. The call chain, confirmed against current source:

```
TabBar.placeStrip                 (component/container/TabBar.ts:2853)
  → TabBar.layoutChrome           (component/container/TabBar.ts:2874, private)
    → ScrollStrip.layoutContent   (component/container/ScrollStrip.ts:570)
      → ScrollStrip.layoutItems   (component/container/ScrollStrip.ts:485)
        → Component.syncScrollOffsets (core/Component.ts:4419), called on the strip's inner `_clip`
          → DOM.source.getScrollLeft  (core/DOM.ts:2391) — reads the live `element.scrollLeft`
```

`_clip` ([ScrollStrip.ts:179](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L179)) is the strip's inner overflow-clipped box that holds the tabs. Reading its native `scrollLeft` right after a layout that just moved things forces the browser to flush layout synchronously instead of deferring it to the next paint. `TabBar` is the tab strip above a `CodeEditor` in Loom's editor pane — the exact pane a `Split` gutter resizes — so during a drag, the pane's width changes every frame, `placeStrip` runs every frame, and this forced flush runs every frame with it.

A second, consecutive live read in the same call chain — [`ScrollStrip.layoutArrows`](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L612)'s call to `refreshArrows()` ([:724](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L724)), which reads `mainScrollMax()` ([:687](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L687)) via `Component.getMaxScrollLeft`'s `DOM.source.getScrollMetrics` — pays nothing extra today only because it runs immediately after `syncScrollOffsets`'s read has already forced the flush for the frame.[^second-read] Gating one without the other would not fix the drag at all when the strip's tabs overflow (paging arrows visible), which is the common case for a Loom user with several files open.

This plan coalesces both reads to at most one per animation frame while the strip's own main-axis extent is changing every pass — mirroring [`Split.scheduleDrag`/`flushDrag`](packages/lib/src/typescript/lib/layout/Split.ts#L1098) one layer up and `VirtualRowView`'s resize-settle mechanism one layer down[^virtualrowview-branch]. Coalescing the reads means the cached scroll offset can be briefly stale while a resize is in progress; this plan closes that gap by making `ScrollStrip.mainScroll()` always resync for itself before returning, so every other reader of the scroll position stays accurate regardless of the coalescing. All changes are confined to [`ScrollStrip.ts`](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts); `TabBar.ts` needs no changes.

---

## Architecture Decisions

### Coalesce the post-layout resync to a settle frame, mirroring the established drag-perf pattern

`ScrollStrip` gains a settle-frame mechanism, structurally identical to `Split.scheduleDrag`/`flushDrag` and to `VirtualRowView.deferRowLayoutWhileResizing`/`scheduleResizeSettle`/`flushResizeSettle`: arm a `DOM.sink.requestAnimationFrame` on the first extent change of a burst, leave it armed while further changes arrive, and perform the accurate catch-up on the first quiet frame.[^precedent-shape] `layoutItems()` detects the burst from the clip's own main-axis extent — no signal from `TabBar` or `Split` is needed or used.[^why-not-signal]

### Both live reads are withheld and caught up together, as one unit

`layoutItems()`'s `syncScrollOffsets()` call and `layoutArrows()`'s `refreshArrows()` call are gated by the same per-pass decision. Splitting them would save nothing: the second read only avoids forcing its own layout flush because the first one already forced it this frame, so leaving either one live during a burst defeats the coalescing.

### `ScrollStrip.mainScroll()` always resyncs before returning — the correctness backstop

`mainScroll()`'s own doc comment already calls it "the single source of truth for the scroll position." This plan makes that literally true: it resyncs the cache from the DOM on every call, not only when the last layout pass happened to. `revealItem` ([:784](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L784)), `scrollBy` ([:745](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L745)), and `TabBar.updateReorderSlot` ([:3164](packages/lib/src/typescript/lib/component/container/TabBar.ts#L3164)) all read the scroll position through `mainScroll()` already, so this one change closes every current caller — and any future one — against the staleness window the coalescing introduces, with no change to any of those three call sites.[^mainscroll-cost]

### The fix lives entirely on `ScrollStrip`; `Component.syncScrollOffsets()` and `TabBar` are untouched

`Component.syncScrollOffsets()` has exactly two callers in the whole codebase: `ScrollStrip.layoutItems()` and `DocsContent.onScrollToFragment()` ([DocsContent.ts:495](packages/docs/src/shell/DocsContent.ts#L495)). The docs caller resyncs once, after a one-shot fragment-scroll layout flush — it has no per-frame-resize concern, so gating `Component.syncScrollOffsets()` itself would change behaviour there for no benefit. `ScrollStrip` owns `_clip` and both hot call sites (`layoutItems`, `layoutArrows`), so it is the narrowest correct owner. `ScrollStrip` has one other real consumer besides `TabBar` — `ContentBoxPanel.ts`'s demo panel ([:156](packages/lib/src/typescript/ContentBoxPanel.ts#L156)) — which benefits from the same mechanism automatically, with no wiring of its own, exactly as `TabBar` does.

### Rejected: deriving the clamped scroll offset from already-computed layout geometry

`TabBar.applyTabWidths` ([:2323](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2323)) only sets each tab's min/max width *constraints*; the box layout (`HBox`/`VBox`, run by `_clip.doLayout()`) resolves the actual pixel positions. Reproducing the browser's own `scrollWidth`/clamped-`scrollLeft` arithmetic in JS from that resolved geometry would mean re-implementing the box layout's rounding and allocation rules a second time, in a second place, and trusting it to match the browser's own box-model math (borders, insets, sub-pixel rounding, writing-mode/rotation for vertical tab strips) exactly. A silent mismatch would corrupt the scroll cache indefinitely, since nothing would ever re-read the DOM to notice — a worse failure mode than the one-frame staleness a deferred *read* can produce. Deferring the live read (this plan) has a bounded, self-correcting failure mode instead.

---

## Internal Structure

### New private fields

Placed after the `_trailArrow` field ([ScrollStrip.ts:185](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L185)):

```typescript
// The clip's own main-axis extent as of the last resync — the baseline a live
// external resize (e.g. a Split gutter drag resizing the strip's owner) is
// detected against. -1 until the first pass, so the very first layoutItems()
// call always resyncs live.
private _lastClipExtent: number = -1;

// Whether a pass withheld the post-layout scroll resync that is still owed
// once the current burst settles.
private _scrollResyncOwed: boolean = false;

// Whether a further main-axis extent change landed after the settle frame
// was armed.
private _clipExtentMoved: boolean = false;

// The animation frame armed to end a resize burst, or null when none is in
// flight.
private _resizeSettleHandle: number | null = null;

// Set by layoutItems on every pass; layoutArrows reads it so the native
// scroll resync and the arrow-enablement read defer and catch up together.
private _deferScrollResyncThisPass: boolean = false;
```

### `layoutItems()` — detect the burst, defer or resync

```typescript
/**
 * Lays out the inner clip's box, sizing the items, then resyncs the strip's
 * cached scroll offset from the DOM (the browser may clamp the native offset
 * on its own when the content lays out smaller than the current offset). Call
 * after positioning the band (see {@link layoutContent}) and before reading
 * the scroll.
 *
 * While the clip's own main-axis extent is still changing every pass — a live
 * external resize, e.g. a `Split` gutter drag resizing the strip's owner —
 * the resync (and {@link layoutArrows}'s matching arrow-enablement read) is
 * withheld until one frame after the extent stops moving; see
 * {@link deferScrollResyncWhileResizing}. {@link mainScroll} always resyncs
 * for itself regardless, so a reveal or a within-strip reorder drag is never
 * affected by a withheld pass.
 *
 * @returns This strip, for method chaining.
 */
layoutItems(): this {
    this._clip.doLayout();

    const mainExtent = this.isVertical() ? this._clip.getHeight() : this._clip.getWidth();
    const extentChanged = mainExtent !== this._lastClipExtent;

    if (extentChanged) {
        this._lastClipExtent = mainExtent;
    }

    this._deferScrollResyncThisPass = this.deferScrollResyncWhileResizing(extentChanged);

    if (!this._deferScrollResyncThisPass) {
        this._clip.syncScrollOffsets();
    }

    return this;
}
```

### `deferScrollResyncWhileResizing` / `scheduleResizeSettle` / `flushResizeSettle`

Placed directly after `layoutItems()`:

```typescript
/**
 * Decides whether this layout pass may withhold the post-layout scroll
 * resync — {@link layoutItems}'s native-offset resync and
 * {@link layoutArrows}'s arrow-enablement read — because the clip's main-axis
 * extent is still moving, and arms the settle pass that catches it up once it
 * stops. Mirrors `Split.scheduleDrag`/`flushDrag`, which solves the same
 * class of problem one layer up (a live pane resize).
 *
 * @param extentChanged - Whether this pass sizes the clip to a different
 *   main-axis extent than the previous pass did.
 *
 * @returns `true` when the caller must withhold this pass's resync.
 *
 * @remarks The first extent change of a burst is always applied in full, so a
 * one-off resize (a sidebar toggle, a window resize, opening or closing a
 * tab) lands accurate on its own frame. Only a change that arrives while a
 * settle frame is already armed is withheld; {@link flushResizeSettle}
 * performs the eventual catch-up once the burst goes quiet.
 */
private deferScrollResyncWhileResizing(extentChanged: boolean): boolean {
    if (!extentChanged) {
        return false;
    }

    if (this._resizeSettleHandle === null) {
        this.scheduleResizeSettle();

        return false;
    }

    this._clipExtentMoved = true;
    this._scrollResyncOwed = true;

    return true;
}

/**
 * Arms the animation frame that ends a resize burst. Armed once and left
 * alone while further extent changes arrive, matching `Split.scheduleDrag`.
 */
private scheduleResizeSettle(): void {
    this._resizeSettleHandle = DOM.sink.requestAnimationFrame(() => this.flushResizeSettle());
}

/**
 * Ends a resize burst, or extends it by one frame when the clip's extent
 * moved again since this frame was armed. On the first quiet frame it
 * performs the withheld resync: the native scroll-offset resync and the
 * arrow-enablement read.
 */
private flushResizeSettle(): void {
    this._resizeSettleHandle = null;

    if (this._clipExtentMoved) {
        this._clipExtentMoved = false;
        this.scheduleResizeSettle();

        return;
    }

    if (!this._scrollResyncOwed) {
        return;
    }

    this._scrollResyncOwed = false;
    this._clip.syncScrollOffsets();
    this.refreshArrows();
}
```

### `layoutArrows()` — gate the matching arrow-enablement read

Inside the existing `private layoutArrows(box, reserve)` ([:612](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L612)), replace the unconditional `this.refreshArrows();` call ([:633](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L633)) with:

```typescript
// Withheld together with layoutItems's resync while a live resize is in
// flight (see deferScrollResyncWhileResizing) — both reads force the same
// synchronous layout, so gating only one would not save anything.
// flushResizeSettle catches this up once the burst goes quiet.
if (!this._deferScrollResyncThisPass) {
    this.refreshArrows();
}
```

### `mainScroll()` — always resync first

```typescript
/**
 * Reads the clip's native scroll offset on the main axis — the single source
 * of truth for the scroll position. Resyncs the cache from the DOM first, so
 * the value is always current even when the last layout pass withheld its own
 * resync (see {@link deferScrollResyncWhileResizing}), independent of when
 * that pass ran.
 *
 * @returns The current main-axis scroll offset in px.
 */
mainScroll(): number {
    this._clip.syncScrollOffsets();

    return this.isVertical() ? this._clip.getScrollTop() : this._clip.getScrollLeft();
}
```

### Teardown

`destructor()` ([:857](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L857)) cancels a still-armed settle frame before disposing `_clip`, the same care `Split`'s drag buffering and `VirtualRowView`'s settle frame each take:

```typescript
protected destructor(): void {
    if (this._resizeSettleHandle !== null) {
        DOM.sink.cancelAnimationFrame(this._resizeSettleHandle);
        this._resizeSettleHandle = null;
    }

    this._clip.dispose();
    this._leadArrow?.dispose();
    this._trailArrow?.dispose();

    super.destructor();
}
```

### The rule, worked through

| Pass | Extent vs. previous pass | Settle already armed? | Resync this pass? |
|---|---|---|---|
| First layout ever (baseline is `-1`) | changed | no → armed now | yes, live |
| Sidebar toggle / window resize (single step) | changed | no → armed now | yes, live |
| Gutter-drag frame 1 | changed | no → armed now | yes, live |
| Gutter-drag frame 2..N | changed | yes | no — withheld |
| Same-extent pass mid-burst | unchanged | yes | no — nothing new to withhold |
| Settle frame, first quiet frame | — | — | yes — catch-up, only if one was owed |
| Tab opened/closed at a fixed width | unchanged | no | yes, live — unaffected |
| `mainScroll()` called directly (reveal, reorder-drag) | — | irrelevant | always yes, immediately |

The first extent change of *any* burst always resyncs live — a one-off resize costs nothing extra and owes nothing afterward. Only the second and later changes of a burst are withheld, exactly as `VirtualRowView`'s row-relayout coalescing works one layer down.

---

## Ordered Implementation Steps

1. **Add the five private fields** to `packages/lib/src/typescript/lib/component/container/ScrollStrip.ts`, after `_trailArrow` ([:185](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L185)). Declarations in *Internal Structure*.

2. **Add `scheduleResizeSettle` and `flushResizeSettle`**, placed directly after `layoutItems()` ([:490](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L490), i.e. inserted as new methods — `layoutItems()` itself is edited in step 4). Bodies in *Internal Structure*. `DOM` is already imported in this file ([:5](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L5)) — no new import. Both call only methods that already exist (`syncScrollOffsets`, `refreshArrows`).

3. **Add `deferScrollResyncWhileResizing`** directly before `scheduleResizeSettle`, so the private decision method reads ahead of the two settle helpers it drives. Body in *Internal Structure*.

4. **Replace `layoutItems()`'s body and doc comment** ([:477-490](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L477)) with the version in *Internal Structure* — it now calls `deferScrollResyncWhileResizing`, added in step 3. No signature change.

5. **Replace `mainScroll()`'s body** ([:677-679](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L677)) with the version in *Internal Structure* (adds the `this._clip.syncScrollOffsets();` line and the doc-comment update). No signature change.

6. **Gate `layoutArrows()`'s `refreshArrows()` call** ([:633](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L633)) as shown in *Internal Structure*. Leave every other statement in `layoutArrows()` — `ensureArrows()`, the glyph/visibility writes, the arrow position/size writes below — unconditional; only the `refreshArrows()` call is gated.

7. **Cancel the settle frame in `destructor()`** ([:857-863](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L857)), as the first statement, before `this._clip.dispose()`. Body in *Internal Structure*. Extend the method's doc comment (currently undocumented beyond its summary line) with one sentence noting the cancel.

   Checkpoint: `grep -n 'deferScrollResyncWhileResizing\|_resizeSettleHandle\|_scrollResyncOwed\|_clipExtentMoved\|_lastClipExtent\|_deferScrollResyncThisPass' packages/lib/src/typescript/lib/component/container/ScrollStrip.ts` — every name appears only in this file; `grep -rln 'deferScrollResyncWhileResizing\|_resizeSettleHandle' packages/lib/src/typescript/lib/` — matches only `ScrollStrip.ts`.

8. **Write the new test file** `packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts`, covering every case in *Expected Behaviour*. Install the offline `requestAnimationFrame`/`cancelAnimationFrame` capture-and-drain harness from [`ScrollRebindLayoutEconomy.test.ts:31-61`](packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts#L31) (override `DOM.sink.requestAnimationFrame` to push callbacks into an array, `cancelAnimationFrame` to no-op unless the teardown test needs it to actually drop a callback — in which case key callbacks by an incrementing handle in a `Map`, as the `VirtualRowView` precedent's test file does). Build the strip the way the docs demo and `ContentBoxPanel.ts`'s `BorderedStripHost` do: switch `getContentBox()` to `preferred` mode with `setOverflowing(true, false)` and add enough `Button` items with long labels that the strip overflows at the test widths.

9. **Typecheck, lint, test.** `npm run typecheck`, `npm run lint`, then the commands in *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/container/ScrollStrip.ts` |
| Create | `packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts` |

---

## Expected Behaviour

The existing `ScrollStrip.test.ts` never drives two extent changes in one burst and never counts `syncScrollOffsets`/`refreshArrows` calls, so every case below is new coverage.

### Unit-testable (offline, `installTestDOM` + captured animation frames)

Spy on `(strip as any)._clip.syncScrollOffsets` and on `strip.refreshArrows` (the existing `ScrollStrip.test.ts` already does the latter, e.g. [:197](packages/lib/tests/component/container/ScrollStrip.test.ts#L197)) to count calls.

1. **A one-off extent change resyncs live.** Mount an overflowing strip at width W1 and run one `layoutContent` pass: `syncScrollOffsets` and `refreshArrows` are each called exactly once, with no frames captured that still need draining for this pass's own resync.

2. **A second extent change in the same burst withholds the resync.** Immediately call `layoutContent` again at a different width W2, without draining frames: neither spy is called again (still 1 each), but `_clip`'s own geometry (`_clip.getWidth()`/`getHeight()`) already reflects W2.

3. **A same-extent pass inside a burst still withholds.** A further `layoutContent` call at the same W2 (no change): still no additional call to either spy.

4. **The settle frame performs exactly one catch-up.** Draining the captured frames after case 2 calls `syncScrollOffsets` and `refreshArrows` exactly one more time each (2 total), reflecting W2.

5. **A change landing while a settle frame is already armed extends the burst.** After case 2 (settle armed), one more `layoutContent` at width W3, then draining the captured frames: the first drained frame performs no catch-up (it only re-arms), a second drain with no further width change performs the catch-up, reflecting W3.

6. **`mainScroll()` resyncs immediately, independent of a pending burst.** From the withheld state in case 2 (settle still armed, catch-up not yet run), call `strip.mainScroll()` directly: `syncScrollOffsets` is called immediately (an extra call beyond the coalesced count), and the returned value reflects the DOM at that moment. Pins that `revealItem`, `scrollBy`, and `TabBar.updateReorderSlot` are never stale mid-burst.

7. **Vertical orientation tracks height, not width.** On a `{ orientation: 'vertical' }` strip: a `layoutContent` pass that changes only the clip's width (height unchanged) does not count as an extent change (no settle armed, live resync as usual since nothing "changed"); a pass that changes the height does.

8. **Teardown mid-burst cancels the settle frame.** Dispose the strip while a settle frame is armed (case 2's state), then drain the captured frames: no settle callback runs (no call into `_clip` post-dispose, no thrown error).

9. **Existing regression suites are unaffected.** `ScrollStrip.test.ts`'s `revealItem arrow refresh` ([:171](packages/lib/tests/component/container/ScrollStrip.test.ts#L171)) and `FocusRevealer` ([:207](packages/lib/tests/component/container/ScrollStrip.test.ts#L207)) tests, and `TabBar.test.ts` in full, pass unchanged — `revealItem`, `scrollBy`, and `TabBar.ts` are not modified, and `mainScroll()`'s added resync doesn't change its return value in a single, non-bursty pass.

### Manual-verify (pointer drag and paint are not exercisable offline)

- **Dragging a `Split` gutter over a `TabBar` with enough open tabs to overflow (paging arrows visible) is materially smoother**, with no forced `recalculate-styles`/`forced-layout` pair appearing every frame in a WebKit/Chrome performance trace of the drag.
- **On release, the tab strip's scroll offset and arrow enabled/disabled state are correct** for the settled width — no stuck-disabled arrow, no tab left mis-scrolled.
- **Selecting a tab, or toggling compact/side, during or immediately after a drag still reveals the correct tab into view** — exercises `mainScroll()`'s defensive resync against the narrow window between a drag's last deferred frame and its settle frame.
- **A one-off resize** (sidebar toggle, window resize, opening/closing a tab) still lands correctly on its own frame with no visible lag.

---

## Verification

- **Typecheck:** `npm run typecheck` (clean).
- **Lint:** `npm run lint` (clean).
- **Unit tests:** `npx vitest run tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts tests/component/container/ScrollStrip.test.ts tests/component/container/ScrollStrip.classStyleHoisting.test.ts tests/component/container/TabBar.test.ts` from `packages/lib` — all green.
- **Grep invariants:** see the checkpoint in step 7.
- **Build:** `npm run build:lib` succeeds.
- **Manual live:** the docs app's `Tab`/`TabBar` demo inside a `Split` (`npm run docs:dev`), or the sibling Loom app's open-file tab strip, exercising the manual-verify observations above with a WebKit/Chrome performance recording of a gutter drag.

---

## Potential Challenges

- **The very first `layoutItems()` call on any strip arms one settle frame.** `_lastClipExtent` starts at `-1`, so the first pass always counts as a change. It resyncs live and finds nothing owed at settle — one harmless extra animation frame per mounted strip, the same cost `VirtualRowView`'s equivalent mechanism accepts at startup. Expected Behaviour case 1 must account for this (drain or ignore the harmless first settle frame when asserting call counts).
- **Gating only one of the two live reads would save nothing.** Both `layoutItems`'s resync and `layoutArrows`'s arrow refresh must defer together — mitigated by sharing one `_deferScrollResyncThisPass` decision per pass, pinned by Expected Behaviour cases 2-4.
- **A correctness-sensitive read landing in the narrow window between a burst's last deferred frame and its settle frame.** Mitigated by `mainScroll()` always resyncing for itself, independent of the burst state — pinned by Expected Behaviour case 6.
- **Vertical tab strips must key off height, not width.** Mitigated by `isVertical()`-gated extent selection in `layoutItems()`, pinned by Expected Behaviour case 7.
- **The offline test sink drops `requestAnimationFrame`.** The new test file must capture frames explicitly, as `ScrollRebindLayoutEconomy.test.ts` and the `VirtualRowView` precedent's test file both do.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/container/ScrollStrip.ts`](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts) — the only source file changed. Read `layoutItems` ([:485](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L485)), `layoutContent` ([:570](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L570)), `layoutArrows` ([:612](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L612)), `mainScroll`/`mainScrollMax`/`refreshArrows` ([:677-736](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L677)), `revealItem` ([:784](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L784)), and `destructor` ([:857](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L857)).
- [`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts) — `scheduleDrag` ([:1098](packages/lib/src/typescript/lib/layout/Split.ts#L1098)), `flushDrag` ([:1111](packages/lib/src/typescript/lib/layout/Split.ts#L1111)): the precedent this plan's settle-frame shape mirrors.
- `plans/virtual-row-view-resize-relayout.md` (on `master`) / `plans/implemented/virtual-row-view-resize-relayout.md` (on the unmerged `feature/virtual-row-view-resize-relayout` branch) — the direct, one-layer-down precedent for coalescing a per-frame cost during a live external resize into a defer-then-settle pass. Read it for the tone and structure this plan mirrors.[^virtualrowview-branch]
- `plans/implemented/accordion-resizable-drag-perf-and-snap.md` — the earlier drag-performance plan both this plan and the `VirtualRowView` one cite as the origin of "narrow the drag path to only what changed."
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `syncScrollOffsets` ([:4419](packages/lib/src/typescript/lib/core/Component.ts#L4419)), `getScrollElement` ([:1305](packages/lib/src/typescript/lib/core/Component.ts#L1305)), `getScrollLeft`/`getScrollTop` cached getters ([:4323](packages/lib/src/typescript/lib/core/Component.ts#L4323)): read for context; not modified.
- [`packages/lib/src/typescript/lib/component/container/TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts) — `layoutChrome` ([:2874](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2874)), `revealSelectedIfRequested` ([:2801](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2801)), `updateReorderSlot` ([:3164](packages/lib/src/typescript/lib/component/container/TabBar.ts#L3164)): read to confirm the blast radius; not modified.
- [`packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts`](packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts) — the animation-frame capture-and-drain harness the new test file copies.
- [`packages/lib/tests/component/container/ScrollStrip.test.ts`](packages/lib/tests/component/container/ScrollStrip.test.ts) — the existing regression suite, including the `revealItem`/`FocusRevealer` tests this plan must not break.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the `DOM.sink`/`DOM.source` seam and typed-setter rules the new code must honour (already-imported `DOM`, no raw DOM access added).

---

## Non-Goals

- **Deriving the clamped scroll offset from layout geometry instead of a live DOM read** — rejected in *Architecture Decisions* as a second, fragile implementation of the box layout's own rounding.
- **Changing `Component.syncScrollOffsets()` itself, or its other caller `DocsContent.onScrollToFragment`** — that call site has no per-frame-resize concern and is out of scope.
- **Any change to `TabBar.ts`** — `mainScroll()`'s fix covers `revealSelectedIfRequested`'s `revealItem` call and `updateReorderSlot` with no wiring on `TabBar`'s side.
- **Other live-read call sites in the codebase** (`Markdown.ts`, `Panel.ts`, `CodeEditor.ts`, `AbstractSelectableList.ts`'s own `getScrollMetrics` reads) — unrelated components, not on this drag's call path.
- **Suppressing the harmless redundant resync that can occur within one non-deferred pass** (once from `layoutItems`, again if something calls `mainScroll()` in the same pass) — a second consecutive read after layout is already flushed costs nothing; not worth the added bookkeeping to avoid.

---

## Implementation Notes

- **`deferScrollResyncWhileResizing`'s literal Internal Structure pseudocode has an ordering bug that fails Expected Behaviour case 3; the check order was corrected.** The plan's snippet returns early on `!extentChanged` *before* checking whether a settle frame is already armed:
  ```typescript
  if (!extentChanged) {
      return false;
  }
  if (this._resizeSettleHandle === null) {
      this.scheduleResizeSettle();
      return false;
  }
  this._clipExtentMoved = true;
  this._scrollResyncOwed = true;
  return true;
  ```
  Traced against case 3 ("a same-extent pass inside a burst still withholds"): pass 1 arms a settle frame at W1; pass 2 (W2) withholds and sets `_lastClipExtent = W2`; pass 3 repeats W2, so `extentChanged` is `false` and the snippet's first branch returns `false` *unconditionally* — meaning `layoutItems` resyncs live and `layoutArrows` calls `refreshArrows()`, even though a settle frame is still armed and a resync is still owed from pass 2. That directly contradicts the table's own "Same-extent pass mid-burst … Resync this pass? no" row and the prose immediately below `_lastClipExtent`'s field comment ("baseline … detected against", implying detection should key off burst state, not the raw current-vs-previous delta alone). The implemented version checks `this._resizeSettleHandle === null` first — a pass with no settle armed always resyncs live (arming a new settle only when `extentChanged`, exactly reproducing the "first change of a burst always live" row), while any pass that finds one already armed withholds *unconditionally*, only using `extentChanged` to decide whether to additionally mark `_clipExtentMoved` for that already-withheld pass:
  ```typescript
  private deferScrollResyncWhileResizing(extentChanged: boolean): boolean {
      if (this._resizeSettleHandle === null) {
          if (extentChanged) {
              this.scheduleResizeSettle();
          }
          return false;
      }
      if (extentChanged) {
          this._clipExtentMoved = true;
      }
      this._scrollResyncOwed = true;
      return true;
  }
  ```
  Traced against all nine Expected Behaviour cases (including the "Tab opened/closed at a fixed width" and "Gutter-drag frame 1" table rows), this version reproduces every one exactly; the literal snippet only reproduces cases 1, 2, 4, 5, 6, 7, 8 and fails case 3. `_lastClipExtent`'s own update site (in `layoutItems`, unconditionally on `extentChanged`) is unchanged from the plan — only `deferScrollResyncWhileResizing`'s internal check order moved.
- **`ScrollStrip.resizeResyncCoalescing.test.ts`'s call-count assertions are `2` (sync) / `1` (refresh) per live pass or settle catch-up, not the `1` / `1` the Expected Behaviour prose states for case 1 (and implies throughout).** `layoutArrows`'s gated `refreshArrows()` call — unmodified by this plan — itself calls `mainScroll()`, which this plan's own `mainScroll()` fix makes always call `_clip.syncScrollOffsets()` before returning. So every non-withheld pass (and every settle-frame catch-up, which also calls `refreshArrows()`) drives *two* `syncScrollOffsets()` calls: one direct (`layoutItems`'s own resync, or `flushResizeSettle`'s), one indirect via `refreshArrows → mainScroll`. This is exactly the redundancy the plan's own Non-Goals bullet ("Suppressing the harmless redundant resync that can occur within one non-deferred pass … once from `layoutItems`, again if something calls `mainScroll()` in the same pass") calls out as intentional and not worth avoiding — the Expected Behaviour section's specific numbers just didn't carry that interaction through. The test file's `SYNC_PER_LIVE_PASS` / `REFRESH_PER_LIVE_PASS` constants document this and scale every case's assertion from it; the *shape* of every case (withheld passes add nothing, one settle catch-up adds exactly one live-pass-worth, `mainScroll()` alone adds exactly one `sync` call and no `refresh` call) matches the Expected Behaviour section exactly — only the absolute numbers differ from its literal "exactly once" wording.
- **The test widths this file drives the strip to would otherwise clamp `_clip`'s resolved width to 0.** The plan's Expected Behaviour names only symbolic `W1`/`W2`/`W3`, with no numeric values — the first test draft chose 100/60/40, under which `arrowReserve` reserves a full `SCROLL_ARROW_SIZE` (24px) per end, so `clipMain = main - 2 * reserve` goes negative at the smallest step (40 - 48 = -8) and `setWidth` clamps it to 0, indistinguishable from a genuinely-zero case. The test file uses 140/100/70 instead, each comfortably positive after the same reserve, so each burst step's clip width is distinct and assertable exactly.
- **Test-file frame-count assertions check the strip's own `_resizeSettleHandle` field (and, for the mount/teardown cases, `frames.has(handle)`) rather than the shared mock queue's raw `frames.size`.** `_clip` is a `Panel`, and `Panel.doLayout()`'s own `scheduleGutterSettleOnShrink` mechanism (unrelated to this plan) can queue its own `DOM.sink.requestAnimationFrame` callback into the same offline sink the test mocks, so asserting on the queue's total size is not reliable — asserting on the specific field/handle this plan added is.
- **The plan's literal single-`requestAnimationFrame` settle (also `VirtualRowView`'s identical precedent) never actually withholds during a real `Split` gutter drag — found by the audit's first round, via an executed probe plus a traced call chain, not by any test in this file.** `Split.flushDrag` (`layout/Split.ts:1076-1077`) already coalesces a drag to exactly one synchronous `lhs.doLayout()`/`rhs.doLayout()` pass per animation frame, cascading synchronously through `Tab.doLayout` → `TabBar.placeStrip`/`layoutChrome` (`TabBar.ts:2853-2874`) → `ScrollStrip.layoutContent`. So during a drag there is exactly one real `layoutItems()` pass per frame, and that pass is itself scheduled via a `requestAnimationFrame` registered by whichever `mousemove` arrives after the previous frame's flush — chronologically *after* this plan's own settle callback for the same upcoming frame, which is registered synchronously inside the *current* frame's pass, one frame earlier. `requestAnimationFrame` callbacks fire in registration order within a frame, so the settle callback always resolves and nulls `_resizeSettleHandle` moments *before* that same frame's real pass checks it — the settle races, and always loses to, the very pass it exists to detect. The audit's probe drove 20 one-real-pass-per-frame frames (both possible orderings of "settle vs. pass" within a frame) and observed a live resync on every single frame, with zero passes ever withheld — the coalescing this plan exists to add never engages, while adding one extra `syncScrollOffsets()` call (via `refreshArrows → mainScroll`, see the note above) and one extra `requestAnimationFrame` per frame on top of the pre-existing per-frame cost. This is not visible from the plan's own worked table (`## Internal Structure`, "The rule, worked through") or from any of its nine Expected Behaviour cases, because every one of them drives two or three `layoutContent` calls back-to-back with no intervening frame drain — a shape a `Split`-driven drag never produces (see the note above about `_resizeSettleHandle`/`frames.size`, which already had to reason about the shared frame queue for a different reason). **Fix:** `scheduleResizeSettle` now arms a *two-hop* relay — `armResizeSettleCheck` on the next frame (which does nothing but re-arm for one more frame, keeping `_resizeSettleHandle` continuously non-null across the boundary), then `flushResizeSettle` on the frame after that. The first hop's only job is to survive the same race that defeated the single-hop version; by the time the second hop's `_clipExtentMoved` check runs, the frame in between it and the first hop is an entirely separate, already-completed `requestAnimationFrame` batch, so nothing races it. Traced through the same nine Expected Behaviour cases, the two-hop relay reproduces every one, but `ScrollStrip.resizeResyncCoalescing.test.ts`'s case 5 ("extends the burst") did need rewriting, not just more drained frames: its two hardcoded `runQueuedFramesOnce()` calls with per-round assertions assumed the single-hop relay's round count, and the black-box call-count check it relied on can no longer distinguish "extended correctly" from "caught up early on stale data" either way — see that test's own updated comment for why (the clip's raw width/height are never gated by the withholding, only the scroll-offset read is, so by the time any settle hop runs the clip already reports the *latest* geometry regardless of whether extension worked). The rewritten case instead reads the private `_clipExtentMoved`/`_resizeSettleHandle` fields directly at the specific point the interrupt must land (right after the relay's second hop consumes the first change, before its next re-arm would otherwise be checked again) — pinned to the current two-hop shape, so a future re-shape of the relay would need to update it, same as the round-count version would have. `drainFrames()`'s other callers (cases 4 and the two new realtime-file cases) already looped to quiescence rather than hardcoding a round count, so those needed no changes beyond the new coverage described below. This roughly doubles settle latency after a drag stops — 3-4 frames instead of 2 (traced: the worst case is a last real pass landing right after a `flushResizeSettle` re-arm, needing a full second relay pair — hop, hop-with-moved-check, hop, hop-with-catch-up — to settle), still well under 100ms at 60Hz and imperceptible for a UI settle; the plan's own manual-verify criteria do not depend on the exact frame count. `VirtualRowView.deferRowLayoutWhileResizing`/`scheduleResizeSettle`/`flushResizeSettle` (`feature/virtual-row-view-resize-relayout`, not touched by this run) appears, from the plan's own quoted description, to share the identical single-hop shape and so likely has the same defect; that branch is out of scope here, but the user should know before merging it.
- **Added `ScrollStrip.resizeResyncCoalescingRealtime.test.ts`, simulating an actual multi-frame drag (one real layout pass per animation frame, interleaved with draining whatever settle-relay callback is currently queued, mirroring the registration-order argument above) rather than several passes with no intervening frame.** This is the coverage that would have caught the single-hop defect: it asserts that from the second drag frame onward, neither `syncScrollOffsets` nor `refreshArrows` is called *during* the drag, and that draining a couple of quiet frames after the drag stops performs exactly one catch-up. Kept as a separate file rather than folded into `ScrollStrip.resizeResyncCoalescing.test.ts` because it exercises a materially different simulation model (frame-interleaved vs. back-to-back passes) and reads more clearly on its own.
- **Manual-verify performed in round 2, against a real browser, after round 1 found it missing.** No existing docs demo combines `Split` with an overflowing `Tab`/`TabBar` (the plan's Verification section assumed one), so a temporary, uncommitted demo (`packages/docs/src/demos/scratch-split-tabbar-drag.ts` plus a matching `<!-- demo: ... -->` marker temporarily added to `ScrollStrip.md`) built a `Split` with a `Tab({ scrollable: true })` pane holding 15 long-named tabs against a 260px preferred width, guaranteeing overflow (`arrowReserve`'s per-end gutters were visibly present at both ends of the strip once measured). Both were deleted/reverted before this note was written — neither is part of the diff. Against `npm run docs:dev`, chrome-devtools MCP's `performance_start_trace` recorded a real drag: a `mousedown` on the `.SplitGutter` element followed by 50 `mousemove` dispatches moving it 260px, each separated by a real `requestAnimationFrame` await (so each was its own animation frame, not several coalesced into one), then `mouseup`, then `performance_stop_trace`.
  Filtering the raw trace's `Layout` events (Chrome's forced-synchronous-layout marker) by stack trace found exactly 6 attributable to this plan's code — in 3 matched pairs, each pair one `getScrollLeft ← syncScrollOffsets ← layoutItems ← layoutContent ← layoutChrome ← placeStrip ← doLayout ← onDrag ← flushDrag` and one `… ← mainScroll ← refreshArrows ← layoutArrows ← …` (the two-calls-per-live-pass shape from the note above) — against 50 real per-frame drag passes. That is a live resync on only 3 of 50 frames, not the ~50 the pre-fix (and the round-1-found-broken single-hop) code would have produced; the fix demonstrably engages in a real browser, not only offline.
  One honest caveat: this automated session's `requestAnimationFrame` timing was irregular (`FireAnimationFrame` gaps up to ~75 seconds were observed mid-drag, against ~16ms at 60Hz), almost certainly because the CDP-driven, non-foregrounded tab was heavily throttled — so the settle relay had ample idle time to fully resolve between several of the 50 dispatched moves, each such gap starting a fresh "first change of a burst" (hence 3 live passes rather than the 1 a smooth, unthrottled 60Hz drag would produce). The 50-to-3 reduction is still strong, real evidence the mechanism coalesces correctly; a trace from an actual foregrounded interactive session (Loom, or `docs:dev` driven by a human) would be expected to show close to 1 live pass for the whole drag, and is worth doing before or shortly after merging for a cleaner number. The strip's scroll offset and arrow-enabled state were not separately re-verified visually in this pass (the trace only confirms the layout-cost claim); `ScrollStrip.test.ts`'s existing `revealItem`/`FocusRevealer` regressions and this plan's own `mainScroll()` fix are what stand behind that half of the plan's manual-verify bullets.

---

## Notes

[^second-read]: Confirmed against the WebKit Timeline recording that drove this investigation: the `recalculate-styles` (~11ms) + `forced-layout` (~13ms) pair appears once per drag frame, immediately after the drag's width-changing writes — not twice, even though the frame contains two separate live-read call sites (`syncScrollOffsets`'s `getScrollLeft`/`getScrollTop`, and `refreshArrows`'s `getMaxScrollLeft`/`getMaxScrollTop` via `getScrollMetrics`). The first read forces the flush; nothing writes to the DOM between the two reads, so the second is served from the now-clean layout for free. This is why gating only `syncScrollOffsets()` would not fix a drag over an overflowing (arrow-showing) tab strip: `refreshArrows()`'s read would simply become the new first read of the frame and force the same flush in `syncScrollOffsets()`'s place.

[^virtualrowview-branch]: At drafting time, `VirtualRowView`'s resize-settle mechanism (`deferRowLayoutWhileResizing`/`scheduleResizeSettle`/`flushResizeSettle`, `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`) exists on the `feature/virtual-row-view-resize-relayout` branch, which has not yet merged to `master` — `master` only carries the pre-implementation plan at `plans/virtual-row-view-resize-relayout.md`, not yet moved to `plans/implemented/`. An implementer working from `master` will not see that file's source; use the symbol names and the plan's own description of the mechanism (reproduced in this plan's *Architecture Decisions* and *Internal Structure*) rather than the branch's line numbers. `Split.scheduleDrag`/`flushDrag` (`packages/lib/src/typescript/lib/layout/Split.ts`), the mechanism both plans mirror, *is* on `master`.

[^precedent-shape]: Three things are copied from `Split.scheduleDrag`/`flushDrag`, matching what the `VirtualRowView` plan already copied one layer down: arm the frame once and leave it armed while further changes arrive (rather than cancel-and-re-arm per change), hold the handle in a nullable field that doubles as the in-flight test, and cancel that handle in the teardown hook (`destructor`, `ScrollStrip`'s equivalent of `Split.detach`).

[^why-not-signal]: A cross-component "a resize is in flight" signal that `Split` broadcasts and `ScrollStrip` subscribes to was not considered further — `VirtualRowView`'s own plan already rejected this shape for the identical reason one layer down (no ancestor-walk or global subscription needed, no extra teardown surface per emitter, and it covers every driver of a `ScrollStrip`'s extent — a `Split` gutter, an `Accordion` section drag, a docked window resize, a live browser resize — with no emitter-side change at all). Inferring the burst from the clip's own extent, as this plan does, has the same properties.

[^mainscroll-cost]: This does not reintroduce the per-frame cost the coalescing removes. `mainScroll()` has exactly four call sites in the codebase: `refreshArrows()` (gated by this plan during a burst — its only per-frame caller), `scrollBy()` (a one-shot arrow-click handler), `revealItem()` (a one-shot reveal, which already forces a layout flush via two `DOM.source.getElementRect` calls in the same method regardless of this change), and `TabBar.updateReorderSlot()` (driven by a within-strip tab-reorder drag, a separate gesture from a `Split` gutter drag — the two cannot occur simultaneously from one pointer — and which already forces a flush via its own `DOM.source.getElementRect` call). Adding one more forced read to any of the three one-shot call sites is free by the same "layout already clean" reasoning as [^second-read].
