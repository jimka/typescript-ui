# Panel Scroll-Metrics Resize Coalescing — Implementation Plan

## Overview

A follow-up code scan (part of the same `Split`-gutter-drag performance investigation that produced [`plans/implemented/scrollstrip-resize-resync-coalescing.md`](../plans/implemented/scrollstrip-resize-resync-coalescing.md) and [`plans/implemented/virtual-row-view-resize-relayout.md`](../plans/implemented/virtual-row-view-resize-relayout.md)) found the identical anti-pattern one level up the class hierarchy, in [`Panel.doLayout()`](packages/lib/src/typescript/lib/core/Panel.ts#L583) itself. `Panel` is the base class nearly every scrollable component extends, so this bug's blast radius is much larger than `ScrollStrip`'s narrow, single-purpose case.

`Panel.doLayout()` calls three private helpers on every layout pass, unconditionally:

```
doLayout()                                              (Panel.ts:583)
  → resizeScrollShadowOverlay()                         (Panel.ts:965) — reads DOM.source.getScrollMetrics(panelEl)
  → measureScrollbarGutter()                            (Panel.ts:778)
      → overlay style: layoutOverlayScrollbars()        (Panel.ts:1273) — reads getScrollMetrics(panelEl), WRITES the
                                                            inner scroller's width/height, then reads getScrollMetrics(innerEl)
      → native style:  reads getScrollMetrics(panelEl)  (Panel.ts:813, skipped when autoScroll === "both")
  → updateScrollShadows()                               (Panel.ts:1003) — reads getScrollMetrics(scroll element),
                                                            then calls resizeScrollShadowOverlay() again (Panel.ts:1016)
```

Each `getScrollMetrics` call forces a synchronous browser layout flush when a pending write is dirty — exactly the anti-pattern `ScrollStrip` and `VirtualRowView` were already fixed for. During a live external resize (a `Split` gutter drag, a `Dock` pane resize, a live window resize) that changes a scrollable panel's size, `doLayout()` runs every animation frame and forces this flush every frame with it. Because `resizeScrollShadowOverlay`'s own write lands *between* `layoutOverlayScrollbars`'s two reads,[^combined-gate] a single live pass under the default configuration (`scrollbarStyle: "overlay"`, `scrollShadows: true`) forces **five** separate synchronous flushes — worse than either precedent's single flush per pass.

This plan applies the same two-hop settle-frame coalescing `ScrollStrip` and `VirtualRowView` already use, adapted to `Panel`'s own structure: withhold all three helpers while this panel's own committed size is changing every pass, and catch them up once the resize burst goes quiet. All changes are confined to [`Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts); no subclass needs any change.[^subclass-check] No public API changes — every new field and method is `private`.

---

## Architecture Decisions

### Coalesce all three helpers to a two-hop settle frame, mirroring the two merged precedents exactly

`Panel` gains a settle-frame mechanism structurally identical to `ScrollStrip`'s (final, corrected) `deferScrollResyncWhileResizing`/`scheduleResizeSettle`/`armResizeSettleCheck`/`flushResizeSettle` and to `VirtualRowView`'s equivalent: a settle **relay** spanning two animation frames, not one. A single-`requestAnimationFrame` version was tried and shipped in both precedents first and never actually withheld anything during a real drag — it lost a registration-order race against the very drag pass it existed to gate — before being replaced with the two-hop relay implemented here from the start.[^two-hop-precedent] `doLayout()` detects the burst from this panel's own committed width/height — no signal from `Split` or any other resizer is needed or used.

### All three helpers are withheld and caught up together, as one unit

`resizeScrollShadowOverlay()`, `measureScrollbarGutter()`, and `updateScrollShadows()` are gated by one shared per-pass decision. Unlike `ScrollStrip`'s two reads (which travel together because the first one already forces the flush the second rides for free), these three do not all read the same element — but withholding only part of the chain would leave the panel's visual state internally inconsistent (e.g. a freshly-measured scrollbar gutter sized against a stale shadow overlay), and gating them separately would save nothing anyway, since a write inside `layoutOverlayScrollbars` already forces a second flush within the group regardless of which read is "first".[^combined-gate]

### Burst detection keys off this panel's own committed width OR height, not a single main axis

`ScrollStrip` narrows to one axis (`isVertical()`) because a tab strip has a fixed, well-defined main axis. `Panel` has no such axis: `autoScroll` can independently gate horizontal and vertical scrolling, and `measureScrollbarGutter`'s native-mode read (and `layoutOverlayScrollbars`'s reads) always read both axes' metrics in one call regardless of which axis is actually scrollable. A pass is a burst step when either `this.getWidth()` or `this.getHeight()` changed since the last pass.[^both-axes]

| `autoScroll` mode | Axis a live resize burst is detected on |
|---|---|
| `"x"` | width **or** height — a height-only change still forces the same read |
| `"y"` | width **or** height — a width-only change still forces the same read |
| `"auto"` / `"both"` | width **or** height |
| `"none"` | never — the mechanism is skipped entirely (see below) |

### The whole mechanism is skipped when `autoScroll === "none"` — the class default

`_defaultPanelOptions.autoScroll` is `"none"`, so most `Panel` instances across the library never scroll at all. In that mode, `measureScrollbarGutter()` returns immediately (`Panel.ts:779-781`) and `resizeScrollShadowOverlay()`/`updateScrollShadows()` both no-op via their `!this._shadowOverlay` guard, because the shadow overlay is only ever installed when `scrollShadows && autoScroll !== "none"` (`Panel.ts:711,716`). None of the three helpers performs a live DOM read in this mode today, so there is nothing to coalesce — `deferScrollMetricsWhileResizing` returns `false` immediately for a `"none"` panel without touching any settle state, so the common non-scrolling case pays no added cost: no extra field writes beyond two cheap `getWidth()`/`getHeight()` comparisons, and no `requestAnimationFrame` is ever armed for it.[^none-shortcut]

### No correctness backstop equivalent to `ScrollStrip.mainScroll()` is needed

`ScrollStrip.mainScroll()` always resyncs before returning because `revealItem`/`scrollBy`/`TabBar.updateReorderSlot` are discrete, one-shot callers that need the scroll position accurate at an arbitrary moment, independent of the next layout pass. `Panel`'s derived state (`_scrollbarGutter`, the shadow edges, the overlay scrollbar geometry) has no such caller: every consumer of `getInnerSize()` (the one public accessor the gutter feeds) is itself a layout manager's `doLayout()`, invoked from the same synchronous layout recursion that already tolerates a stale gutter for one frame today — `measureScrollbarGutter`'s own doc comment calls this the "one-frame reflow", corrected by `scheduleGutterSettleOnShrink`'s follow-up pass. Withholding for a whole burst instead of one frame widens an already-accepted staleness window rather than introducing a new one.[^no-backstop]

### New settle-relay members use `Panel`-specific names, not `ScrollStrip`'s

`ScrollStrip extends Panel` and, on the sibling `feature/scrollstrip-resize-resync-coalescing` branch, already declares its own `_resizeSettleHandle` field and `scheduleResizeSettle`/`armResizeSettleCheck`/`flushResizeSettle` methods as its own `private` members. TypeScript's `private` is a compile-time check only — at runtime a subclass method of the same name shadows the base class's method on the shared prototype, and a subclass field of the same name is simply overwritten last. If `Panel` reused those exact names, `Panel.doLayout()`'s calls into its own settle relay would silently resolve to `ScrollStrip`'s *unrelated* relay on every `ScrollStrip` instance (and vice versa) the moment both fixes coexist in the same tree — which the existing `.worktrees/perf-fixes-combined-test` integration worktree suggests is the intended near-term outcome. This plan's new members are named with a `ScrollMetrics`/`Panel` vocabulary instead (`_scrollMetricsSettleHandle`, `scheduleScrollMetricsSettle`, `armScrollMetricsSettleCheck`, `flushScrollMetricsSettle`, `_panelSizeMoved`, `_scrollMetricsOwed`, `_lastPanelWidth`, `_lastPanelHeight`) — verified free of collisions against `master` and both required sibling branches.[^name-collision] In practice the two mechanisms never both engage for one instance anyway: `ScrollStrip` never calls the inherited `setAutoScroll` with anything but the class default, so `this._autoScroll` stays `"none"` on every `ScrollStrip` instance and this plan's mechanism is inert there regardless of naming — the rename is defense in depth, not a fix for an active bug today.

### Test call-count assertions use a delta, not an absolute count

`ScrollStrip`'s test file originally asserted an absolute `getScrollMetrics`/`refreshArrows` call count per pass, then had to correct those numbers post-hoc once an indirect call path (`refreshArrows → mainScroll`) was found to double one of them. `Panel`'s three helpers produce a *different* absolute `getScrollMetrics` count depending on `scrollbarStyle` × `scrollShadows` × `autoScroll` (see the table in *Internal Structure*), so an absolute-count assertion would need one entry per configuration and would be exactly as fragile. This plan's tests instead assert the **call-count delta**: zero additional `getScrollMetrics` calls during a withheld pass, at least one during a live pass or a settle catch-up. That claim holds regardless of configuration and needs no per-config arithmetic.

---

## Internal Structure

### `getScrollMetrics` calls per live (non-withheld) pass, by configuration

For reference only — the tests assert the delta described above, not these absolute numbers, but the implementer should recognise them while writing the harness.

| `scrollbarStyle` | `scrollShadows` | `autoScroll` | Calls |
|---|---|---|---|
| `overlay` (default) | `true` (default) | not `"none"` | 5 — `resizeScrollShadowOverlay` (1) + `layoutOverlayScrollbars` (2) + `updateScrollShadows` (1) + its internal `resizeScrollShadowOverlay` (1) |
| `overlay` | `false` | not `"none"` | 2 — `layoutOverlayScrollbars` only |
| `native` | `true` | not `"both"`, not `"none"` | 4 |
| `native` | `true` | `"both"` | 3 — `measureScrollbarGutter`'s `"both"` branch reserves both bars without reading metrics |
| `native` | `false` | not `"both"`, not `"none"` | 1 |
| `native` | `false` | `"both"` | 0 |
| any | any | `"none"` | 0 — the mechanism never arms |

### New private fields

Placed after the existing `_onOverlayScrollH` field ([Panel.ts:233](packages/lib/src/typescript/lib/core/Panel.ts#L233)), before the constructor:

```typescript
// This panel's own committed width/height as of the last layout pass — the
// baseline a live external resize (e.g. a Split gutter drag resizing this
// panel) is detected against. -1 until the first pass, so the very first
// doLayout() call always measures the scroll metrics live.
private _lastPanelWidth:  number = -1;
private _lastPanelHeight: number = -1;

// Whether a pass withheld the post-layout scroll-metrics remeasure
// (resizeScrollShadowOverlay + measureScrollbarGutter + updateScrollShadows)
// that is still owed once the current resize burst settles.
private _scrollMetricsOwed: boolean = false;

// Whether a further width/height change landed after the settle frame was
// armed.
private _panelSizeMoved: boolean = false;

// The animation frame armed to end a resize burst, or null when none is in
// flight.
private _scrollMetricsSettleHandle: number | null = null;
```

### `doLayout()` — detect the burst, defer or remeasure

```typescript
/**
 * Lays out children, then measures the post-layout scrollbar visibility
 * and, when it has changed since the last pass, caches the new gutter
 * and schedules a follow-up layout so children land inside the new
 * post-gutter content area. The follow-up is the "one-frame reflow"
 * documented on {@link AutoScrollMode}.
 *
 * While this panel's own committed width or height is still changing every
 * pass — a live external resize, e.g. a `Split` gutter drag resizing this
 * panel — the scroll-metrics remeasure ({@link resizeScrollShadowOverlay},
 * {@link measureScrollbarGutter}, {@link updateScrollShadows}) is withheld
 * until a couple of quiet frames confirm the resize has stopped moving; see
 * {@link deferScrollMetricsWhileResizing}. Children are unaffected: they are
 * already laid out against this frame's real size by `super.doLayout()`
 * above, before that decision runs.
 *
 * @returns This panel, for method chaining.
 */
doLayout(): this {
    super.doLayout();
    this.commitElementStyle();

    const width  = this.getWidth();
    const height = this.getHeight();
    const sizeChanged = width !== this._lastPanelWidth || height !== this._lastPanelHeight;

    if (sizeChanged) {
        this._lastPanelWidth  = width;
        this._lastPanelHeight = height;
    }

    if (!this.deferScrollMetricsWhileResizing(sizeChanged)) {
        this.resizeScrollShadowOverlay();
        this.measureScrollbarGutter();
        this.updateScrollShadows();
    }

    this.scheduleGutterSettleOnShrink();

    return this;
}
```

`scheduleGutterSettleOnShrink()` stays unconditional: it reads only cached fields (`_scrollbarGutter`, `_shadowEdges`, `getComponents().length`, `getPreferredSize()`), never `getScrollMetrics`, so it is not part of the anti-pattern and needs no gating. If it schedules an extra pass mid-burst (content shrank while dragging), that pass goes through the same `sizeChanged` check above like any other and is withheld like any other — no special interaction.

### `deferScrollMetricsWhileResizing` / `scheduleScrollMetricsSettle` / `armScrollMetricsSettleCheck` / `flushScrollMetricsSettle`

Placed directly after `doLayout()`'s closing brace ([Panel.ts:611](packages/lib/src/typescript/lib/core/Panel.ts#L611)), before `scheduleGutterSettleOnShrink`'s doc comment ([:613](packages/lib/src/typescript/lib/core/Panel.ts#L613)):

```typescript
/**
 * Decides whether this layout pass may withhold the post-layout scroll-metrics
 * remeasure — {@link resizeScrollShadowOverlay}, {@link measureScrollbarGutter}
 * and {@link updateScrollShadows} — because a resize burst is in flight, and
 * arms (or extends) the settle pass that catches it up once the burst goes
 * quiet. Mirrors `Split.scheduleDrag`/`flushDrag` and `ScrollStrip`'s own
 * settle relay, which solve the same class of problem for a pane resize and a
 * tab strip's scroll resync respectively.
 *
 * @param sizeChanged - Whether this pass committed a different width or height
 *   than the previous pass did.
 *
 * @returns `true` when the caller must withhold this pass's remeasure.
 *
 * @remarks A panel with `autoScroll === "none"` never reaches a state where
 * withholding matters — none of the three helpers perform a live DOM read in
 * that mode — so this returns `false` immediately for one, without touching
 * any settle state. Otherwise, whether a settle frame is already armed — not
 * `sizeChanged` — decides withholding: a pass with no settle frame armed
 * always remeasures live, while any pass that finds one already armed
 * withholds regardless of whether *this specific* pass's size moved. The
 * first size change of a burst is still always applied in full, because the
 * check that matters — "is a settle frame already armed" — is false until
 * this call arms one.
 */
private deferScrollMetricsWhileResizing(sizeChanged: boolean): boolean {
    if (this._autoScroll === "none") {
        return false;
    }

    if (this._scrollMetricsSettleHandle === null) {
        if (sizeChanged) {
            this.scheduleScrollMetricsSettle();
        }

        return false;
    }

    if (sizeChanged) {
        this._panelSizeMoved = true;
    }

    this._scrollMetricsOwed = true;

    return true;
}

/**
 * Arms the two-frame relay that ends a resize burst: {@link
 * armScrollMetricsSettleCheck} on the next frame, {@link
 * flushScrollMetricsSettle} on the one after. Armed once and left alone while
 * further size changes arrive, matching `Split.scheduleDrag`.
 *
 * @remarks A single `requestAnimationFrame` here is not enough. The owner
 * driving this panel's resize (e.g. `Split.flushDrag`, itself already
 * coalesced to one call per frame) also runs its own per-frame layout pass
 * from a `requestAnimationFrame` callback, registered by whichever
 * `mousemove` arrives after the previous frame finishes — chronologically
 * *after* this method's own callback for the same upcoming frame, which is
 * registered synchronously, still inside the *current* frame's pass. Per
 * frame, callbacks run in registration order, so a single relay hop would
 * always fire and resolve *before* that frame's real layout pass runs,
 * making `_scrollMetricsSettleHandle` read as `null` again just before the
 * pass that needed to see it armed. Two hops fixes this: the first
 * (`armScrollMetricsSettleCheck`) only relays the handle to a second frame,
 * costing nothing but keeping `_scrollMetricsSettleHandle` continuously
 * non-null across the boundary; the second (`flushScrollMetricsSettle`) then
 * checks `_panelSizeMoved`, set by any pass over the *prior* frame — an
 * entirely separate, already-completed `requestAnimationFrame` batch — so it
 * is never racing anything by the time this one reads it.
 */
private scheduleScrollMetricsSettle(): void {
    this._scrollMetricsSettleHandle = DOM.sink.requestAnimationFrame(() => this.armScrollMetricsSettleCheck());
}

/**
 * The settle relay's first hop: merely re-arms for one more frame, keeping
 * {@link _scrollMetricsSettleHandle} continuously non-null across the frame
 * boundary so this frame's still-pending real layout pass (see {@link
 * scheduleScrollMetricsSettle}'s remarks) reads it as armed and withholds.
 */
private armScrollMetricsSettleCheck(): void {
    this._scrollMetricsSettleHandle = DOM.sink.requestAnimationFrame(() => this.flushScrollMetricsSettle());
}

/**
 * The settle relay's second hop: ends a resize burst, or extends it by
 * another two-frame relay when this panel's size moved again during the
 * frame between the two hops. On the first quiet cycle it performs the
 * withheld remeasure — {@link resizeScrollShadowOverlay}, {@link
 * measureScrollbarGutter}, then {@link updateScrollShadows} — in the same
 * order `doLayout` itself uses.
 */
private flushScrollMetricsSettle(): void {
    this._scrollMetricsSettleHandle = null;

    if (this._panelSizeMoved) {
        this._panelSizeMoved = false;
        this.scheduleScrollMetricsSettle();

        return;
    }

    if (!this._scrollMetricsOwed) {
        return;
    }

    this._scrollMetricsOwed = false;
    this.resizeScrollShadowOverlay();
    this.measureScrollbarGutter();
    this.updateScrollShadows();
}
```

### Teardown

`destructor()` ([Panel.ts:730](packages/lib/src/typescript/lib/core/Panel.ts#L730)) cancels a still-armed settle frame first, before the existing teardown:

```typescript
protected destructor(): void {
    if (this._scrollMetricsSettleHandle !== null) {
        DOM.sink.cancelAnimationFrame(this._scrollMetricsSettleHandle);
        this._scrollMetricsSettleHandle = null;
    }

    FocusReveal.unregister(this);

    this.removeScrollShadows();
    this.removeOverlayScrollbars();

    super.destructor();
}
```

### The rule, worked through

| Pass | Width or height vs. previous pass | Settle already armed? | Remeasure this pass? |
|---|---|---|---|
| First layout ever (baseline is `-1`) | changed | no → armed now | yes, live |
| Sidebar toggle / window resize (single step) | changed | no → armed now | yes, live |
| Gutter-drag frame 1 | changed | no → armed now | yes, live |
| Gutter-drag frame 2..N | changed | yes | no — withheld |
| Same-size pass mid-burst | unchanged | yes | no — nothing new to withhold |
| Settle relay, first quiet cycle | — | — | yes — catch-up, only if one was owed |
| Any pass on an `autoScroll: "none"` panel | — | — | the three helpers still run, but each is already a no-op |

---

## Ordered Implementation Steps

1. **Add the five private fields** to `packages/lib/src/typescript/lib/core/Panel.ts`, after `_onOverlayScrollH` ([:233](packages/lib/src/typescript/lib/core/Panel.ts#L233)), before the constructor ([:235](packages/lib/src/typescript/lib/core/Panel.ts#L235)). Declarations in *Internal Structure*.

2. **Replace `doLayout()`'s body and doc comment** ([:574-611](packages/lib/src/typescript/lib/core/Panel.ts#L574)) with the version in *Internal Structure*. No signature change. `DOM` is already imported ([:9](packages/lib/src/typescript/lib/core/Panel.ts#L9)) — no new import.

3. **Add `deferScrollMetricsWhileResizing`, `scheduleScrollMetricsSettle`, `armScrollMetricsSettleCheck`, `flushScrollMetricsSettle`**, inserted directly after `doLayout()`'s closing brace and before `scheduleGutterSettleOnShrink`'s doc comment ([:613](packages/lib/src/typescript/lib/core/Panel.ts#L613)), in that order. Bodies in *Internal Structure*. Each calls only methods that already exist (`resizeScrollShadowOverlay`, `measureScrollbarGutter`, `updateScrollShadows`).

4. **Cancel the settle frame in `destructor()`** ([:730-737](packages/lib/src/typescript/lib/core/Panel.ts#L730)), as the first statement, before `FocusReveal.unregister(this)`. Body in *Internal Structure*. Extend the doc comment with one sentence: a still-armed settle frame is cancelled here so it never fires against a disposed panel.

   Checkpoint: `grep -n 'deferScrollMetricsWhileResizing\|_scrollMetricsSettleHandle\|_scrollMetricsOwed\|_panelSizeMoved\|_lastPanelWidth\|_lastPanelHeight\|scheduleScrollMetricsSettle\|armScrollMetricsSettleCheck\|flushScrollMetricsSettle' packages/lib/src/typescript/lib/core/Panel.ts` — every name appears only in this file; `grep -rln 'scheduleScrollMetricsSettle\|armScrollMetricsSettleCheck\|flushScrollMetricsSettle\|_scrollMetricsSettleHandle' packages/lib/src/typescript/lib/` — matches only `Panel.ts`. Also run `grep -n '_resizeSettleHandle\|scheduleResizeSettle\b\|armResizeSettleCheck\|flushResizeSettle' packages/lib/src/typescript/lib/core/Panel.ts` — expect **zero** matches, confirming no accidental reuse of `ScrollStrip`'s names.

5. **Write the new test file** `packages/lib/tests/core/PanelResizeMetricsCoalescing.test.ts`, covering every case in *Expected Behaviour*. Follow `PanelOverlayScrollbar.test.ts`'s harness: `installTestDOM(CONFIG)`, a `stubMetrics()` helper via `vi.spyOn(DOM.source, 'getScrollMetrics')`, and the narrow-cast `internals()` idiom for reaching private fields without `any`. Install the frame-capture harness from [`ScrollStrip.resizeResyncCoalescing.test.ts`'s `beforeEach`](.worktrees/scrollstrip-resize-resync-coalescing/packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts) (keyed `Map<number, FrameRequestCallback>`, so `cancelAnimationFrame` genuinely drops a callback — needed for the teardown case) rather than `ScrollRebindLayoutEconomy.test.ts`'s array version, which cannot support the teardown case. Build panels with `new _Panel({ autoScroll: ... })` and force render via `panel.getElement(true)`, mirroring `PanelOverlayScrollbar.test.ts`. Drive width/height changes via `panel.setWidth(...)`/`setHeight(...)` followed by `panel.doLayout()`.

6. **Write the realtime test file** `packages/lib/tests/core/PanelResizeMetricsCoalescingRealtime.test.ts`, mirroring `ScrollStrip.resizeResyncCoalescingRealtime.test.ts` and `ResizeLayoutEconomyRealtime.test.ts`: simulate one real `doLayout()` pass per animation frame (a `setWidth`+`doLayout()` call, immediately followed by draining whichever settle-relay callback is currently queued — never several passes back-to-back with no intervening frame), asserting that from the second drag frame onward `getScrollMetrics` gains no new calls during the drag, and that draining a couple of quiet frames after the drag stops performs exactly one catch-up (a `getScrollMetrics` call-count delta greater than zero, per the *Architecture Decisions* delta-assertion rule).

7. **Typecheck, lint, test.** `npm run typecheck`, `npm run lint`, then the commands in *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Panel.ts` |
| Create | `packages/lib/tests/core/PanelResizeMetricsCoalescing.test.ts` |
| Create | `packages/lib/tests/core/PanelResizeMetricsCoalescingRealtime.test.ts` |

---

## Expected Behaviour

No existing `Panel` test drives two width/height changes in a burst or counts `getScrollMetrics` calls across passes, so every case below is new coverage.

### Unit-testable (offline, `installTestDOM` + captured animation frames)

Build with `new _Panel({ autoScroll: 'auto' })` (or the named mode a case calls out), render via `getElement(true)`, and spy on `DOM.source.getScrollMetrics` to count calls. Unless stated otherwise, cases use the default `scrollbarStyle: 'overlay'` / `scrollShadows: true`.

1. **A one-off size change remeasures live.** Mount at size S1, record the `getScrollMetrics` call count, then run one `doLayout()` pass: the count increases by some fixed `N > 0` (the *Internal Structure* table names `N` for this configuration, but the test should read `N` from the spy rather than hardcode it, so it stays correct if the table's arithmetic ever needs revisiting) — call this pass's delta `oneLivePass`. No frames are left needing a drain for this pass's own remeasure.
2. **A second size change in the same burst withholds the remeasure.** Immediately `setWidth`/`setHeight` to S2 and call `doLayout()` again, without draining frames: the call count does not increase (delta `0`), but `panel.getWidth()`/`getHeight()` already report S2.
3. **A same-size pass inside a burst still withholds.** A further `doLayout()` call at S2 (no change): the call count still does not increase (delta `0`).
4. **The settle relay performs exactly one catch-up.** Draining the captured frames after case 2 to quiescence increases the call count by exactly `oneLivePass` (case 1's own captured delta, not a second hardcoded number), reflecting S2.
5. **A change landing while a settle frame is already armed extends the burst.** After case 2 (settle armed), `setWidth`/`setHeight` to S3, then drain frames one queued batch at a time: the first drained batch performs no catch-up (it only re-arms — assert via `_scrollMetricsSettleHandle`/`_panelSizeMoved`, not the call count, since a single batch's effect can't be told apart from "caught up early" by call count alone); a second drained batch with no further size change performs the catch-up, reflecting S3.
6. **`autoScroll: "none"` panels never arm a settle frame.** A `new _Panel()` (class default) driven through the same S1→S2→S3 sequence as case 5 never calls `DOM.sink.requestAnimationFrame` (assert the mock spy was never invoked) — confirms the short-circuit.
7. **Either axis alone triggers withholding.** On an `autoScroll: 'both'` panel: a burst that changes only width (height held constant) withholds exactly like case 2; a separate burst that changes only height (width held constant) withholds exactly the same way.
8. **Teardown mid-burst cancels the settle frame.** Dispose the panel while a settle frame is armed (case 2's state), then drain the captured frames: no settle callback runs (no call into the disposed panel, no thrown error).
9. **Existing regression suites are unaffected.** `PanelGutterSettle.test.ts`, `PanelOverlayScrollbar.test.ts`, `PanelScrollChaining.test.ts`, `Panel.styleRuleDisposal.test.ts`, and `PanelFlushInsets.test.ts` all pass unchanged — none of them drives a resize burst, so none observes any withholding.

### Manual-verify (pointer drag and paint are not exercisable offline)

- **Dragging a `Split` gutter over a scrollable, overflowing `Panel` (`autoScroll` other than `"none"`) is materially smoother**, with no forced `recalculate-styles`/`forced-layout` group appearing every frame in a WebKit/Chrome performance trace of the drag.
- **On release, the scrollbar gutter reservation, the overlay scrollbar geometry, and the scroll-shadow edges are all correct** for the settled size — no stuck gutter, no mispositioned overlay bar, no wrong shadow strength.
- **A one-off resize** (sidebar toggle, window resize, a `Dock` pane drop) still lands correctly on its own frame with no visible lag.
- No docs-app page currently combines an `autoScroll` `Panel` inside a draggable `Split` (checked `packages/docs/src/demos/split-panes.ts` — both its panes are plain `Header`s with no overflow). Mirroring both precedents' own experience, a temporary, uncommitted scratch demo may be needed to exercise this manually; delete it before finishing.

---

## Verification

- **Typecheck:** `npm run typecheck` (clean).
- **Lint:** `npm run lint` (clean).
- **Unit tests:** from `packages/lib`: `npx vitest run tests/core/PanelResizeMetricsCoalescing.test.ts tests/core/PanelResizeMetricsCoalescingRealtime.test.ts tests/core/PanelGutterSettle.test.ts tests/core/PanelOverlayScrollbar.test.ts tests/core/PanelScrollChaining.test.ts tests/core/Panel.styleRuleDisposal.test.ts tests/core/PanelFlushInsets.test.ts` — all green. Given `Panel`'s blast radius, additionally run the direct-subclass suites: `npx vitest run tests/component/container/ScrollStrip.test.ts tests/component/chart/ tests/component/diagram/ tests/component/display/MarkdownViewer.test.ts tests/component/input/PickerColumn.test.ts` (adjust paths to whatever exists under each directory) — all green, confirming no subclass regresses from the `doLayout()` change.
- **Grep invariants:** see the checkpoint in step 4.
- **Build:** `npm run build:lib` succeeds.
- **Manual live:** per the manual-verify bullets above, using `npm run docs:dev` (with a temporary scratch demo if needed) or the sibling Loom app's own scrollable, `Split`-hosted panels (e.g. a markdown preview, a picker dropdown list), with a WebKit/Chrome performance recording of a gutter drag.

---

## Potential Challenges

- **The very first `doLayout()` call on any scrolling panel arms one settle frame.** `_lastPanelWidth`/`_lastPanelHeight` start at `-1`, so the first pass always counts as a change. It remeasures live and finds nothing owed at settle — one harmless extra pair of animation frames per mounted scrolling panel, the same cost both precedents' equivalent mechanisms accept at startup.
- **Gating only part of the three-helper chain would save nothing.** All three must defer together — mitigated by the single `deferScrollMetricsWhileResizing` decision gating all three calls, pinned by Expected Behaviour cases 2-4.
- **A stale `_scrollbarGutter` feeding directly into `getInnerSize()`, read by the child layout manager every pass.** This is the one place this plan's staleness reaches something "live" every frame, unlike `ScrollStrip`'s cache. Mitigated by it being the same one-frame staleness `Panel` already tolerates today (`scheduleGutterSettleOnShrink`'s existing follow-up mechanism), merely extended to a burst — see *Architecture Decisions*.
- **`autoScroll: "none"` panels must add zero measurable cost.** Mitigated by the early return in `deferScrollMetricsWhileResizing`, pinned by Expected Behaviour case 6.
- **The offline test sink drops `requestAnimationFrame`.** The new test files must capture frames explicitly, as both precedents' test files do.
- **A future rename of `ScrollStrip`'s own settle-relay members could re-introduce the collision this plan avoids.** No mechanical guard prevents it; the grep checkpoint in step 4 only catches it at this plan's own implementation time, not in perpetuity.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts) — the only source file changed. Read `doLayout` ([:583](packages/lib/src/typescript/lib/core/Panel.ts#L583)), `scheduleGutterSettleOnShrink` ([:642](packages/lib/src/typescript/lib/core/Panel.ts#L642)), `measureScrollbarGutter` ([:778](packages/lib/src/typescript/lib/core/Panel.ts#L778)), `resizeScrollShadowOverlay` ([:965](packages/lib/src/typescript/lib/core/Panel.ts#L965)), `updateScrollShadows` ([:1003](packages/lib/src/typescript/lib/core/Panel.ts#L1003)), `layoutOverlayScrollbars` ([:1273](packages/lib/src/typescript/lib/core/Panel.ts#L1273)), and `destructor` ([:730](packages/lib/src/typescript/lib/core/Panel.ts#L730)).
- `.worktrees/scrollstrip-resize-resync-coalescing/plans/implemented/scrollstrip-resize-resync-coalescing.md` and its `packages/lib/src/typescript/lib/component/container/ScrollStrip.ts` — the direct precedent this plan's two-hop relay shape, naming pattern, and Implementation Notes-documented single-hop failure mode are copied from. Also the source of the naming-collision risk this plan works around.[^name-collision]
- `.worktrees/virtual-row-view-resize-relayout/plans/implemented/virtual-row-view-resize-relayout.md` and its `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` — the second precedent, confirming the two-hop shape and its own independent discovery of the identical single-hop race.
- [`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts) — `scheduleDrag`/`flushDrag` ([:1098](packages/lib/src/typescript/lib/layout/Split.ts#L1098)): the origin precedent both prior plans and this one mirror.
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) — `getScrollMetrics` ([:2401](packages/lib/src/typescript/lib/core/DOM.ts#L2401)), `getScrollBarWidth` ([:2344](packages/lib/src/typescript/lib/core/DOM.ts#L2344)): read for context; not modified.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `getWidth`/`getHeight`/`getSize` ([:4032](packages/lib/src/typescript/lib/core/Component.ts#L4032), [:4136](packages/lib/src/typescript/lib/core/Component.ts#L4136), [:3335](packages/lib/src/typescript/lib/core/Component.ts#L3335)): confirmed cached, not live reads. `commitElementStyle` ([:1820](packages/lib/src/typescript/lib/core/Component.ts#L1820)): flushes queued inline styles, unrelated to `getScrollMetrics`.
- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts`](packages/lib/src/typescript/lib/layout/LayoutManager.ts) — `commitBounds` ([:547](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L547)): confirms `setWidth`/`setHeight` are committed before `doLayout()` runs, so reading `this.getWidth()`/`getHeight()` at the top of `Panel.doLayout()` always sees this frame's real size regardless of subclass override timing.
- [`packages/lib/tests/core/PanelOverlayScrollbar.test.ts`](packages/lib/tests/core/PanelOverlayScrollbar.test.ts) — the `stubMetrics`/`internals()` harness idiom the new test file follows.
- [`packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts`](packages/lib/tests/component/table/ScrollRebindLayoutEconomy.test.ts) and `ScrollStrip.resizeResyncCoalescing.test.ts` (in the `scrollstrip-resize-resync-coalescing` worktree) — the frame-capture harnesses; use the latter's `Map`-keyed handle version.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the `DOM.sink`/`DOM.source` seam and typed-setter rules the new code must honour (already-imported `DOM`, no raw DOM access added).

---

## Non-Goals

- **Reordering `layoutOverlayScrollbars`'s reads-before-writes to eliminate the extra forced flush within one live pass.** A real, separate optimisation opportunity found during investigation, but it targets the within-pass call shape, not the cross-pass repetition during a resize burst this plan fixes — a different, riskier change to a method three call sites already depend on.
- **Narrowing burst detection to a single axis based on `autoScroll` mode** — rejected in *Architecture Decisions*; both axes always feed the same `getScrollMetrics` read regardless of which axis is actually scrollable.
- **A correctness backstop equivalent to `ScrollStrip.mainScroll()`** — rejected in *Architecture Decisions*; every consumer of the derived state already tolerates the same one-pass staleness this plan merely extends to a burst.
- **`ScrollStrip.ts` and `VirtualRowView.ts`** — untouched by this plan; their own fixes are separate, already-implemented but still-unmerged branches (`feature/scrollstrip-resize-resync-coalescing`, `feature/virtual-row-view-resize-relayout`).
- **`Accordion`'s own per-frame gutter drag** (a separate sibling fix, `.worktrees/accordion-gutter-drag-coalescing`) — out of scope and not read for this plan.
- **Changing `scheduleGutterSettleOnShrink`** — it performs no live DOM read and needs no gating.

---

## Notes

[^two-hop-precedent]: `ScrollStrip.scheduleResizeSettle`/`VirtualRowView.scheduleResizeSettle` were both first implemented with a single `DOM.sink.requestAnimationFrame` hop, and both were found — via an executed probe plus a traced call chain, in the ScrollStrip case's Implementation Notes, and confirmed independently in `VirtualRowView`'s — to never actually withhold anything during a real `Split` gutter drag: `Split.flushDrag` is itself coalesced to one `requestAnimationFrame`-scheduled layout pass per frame, registered by a `mousemove` that arrives *after* the previous frame completes — chronologically after the settle callback for the same upcoming frame, which is registered synchronously one frame earlier, still inside the current frame's pass. Callbacks run in registration order, so the single-hop settle callback always resolved and cleared its handle moments before that frame's real pass checked it, meaning the withhold branch was dead code in production despite every offline test passing (those tests drive several passes with no intervening real animation frame, a shape a real drag never produces). Both precedents replaced the single hop with the two-hop relay this plan uses from the start: an intermediate frame (`armResizeSettleCheck`/`armScrollMetricsSettleCheck`) whose only job is to re-arm once more, crossing into a completely separate, later `requestAnimationFrame` batch that isn't racing anything, with the real settle-or-extend check on the *second* hop. Verified live: `ScrollStrip`'s fix showed 3 live passes out of 50 real drag frames (down from the single-hop's 50/50); `VirtualRowView`'s showed 2 out of 40 (down from 40/40).

[^combined-gate]: Confirmed against current source, not assumed. `resizeScrollShadowOverlay()` reads `getScrollMetrics(el)` for `clientWidth`/`clientHeight` only, then writes `_shadowOverlayStyle` (`Panel.ts:965-990`). `layoutOverlayScrollbars()` (`measureScrollbarGutter`'s overlay branch, `Panel.ts:1273-1351`) reads `getScrollMetrics(panelEl)` (`:1286`), then **writes** `_overlayScrollStyle.setMany({width, height})` (`:1303-1306`) — an immediate DOM write, since `StyleTarget.set`/`setMany` (`core/StyleTarget.ts:35-50`) write straight through once the target is attached, which `_overlayScrollStyle` is by the time `doLayout` runs (attached in `installOverlayScrollbars`, `Panel.ts:1112`) — before reading `getScrollMetrics(innerEl)` (`:1309`). That write forces the second read to pay for its own fresh synchronous flush, separate from the first. `updateScrollShadows()` (`Panel.ts:1003-1037`) reads `getScrollMetrics(getScrollElement() ?? el)` (`:1013-1014`) and then calls `resizeScrollShadowOverlay(el)` again internally (`:1016`), which performs its own third-or-later `getScrollMetrics(el)` read. Under the default configuration (`scrollbarStyle: "overlay"`, `scrollShadows: true`) a single live `doLayout()` pass therefore forces five separate synchronous layout flushes, not the clean "one flush forces, the rest ride free" shape `ScrollStrip`'s two back-to-back reads have.

[^both-axes]: `measureScrollbarGutter`'s native-mode branch (`Panel.ts:805-817`) reads both `scrollHeight`/`clientHeight` and `scrollWidth`/`clientWidth` from one `getScrollMetrics` call regardless of `scrollableAxes()`, which only gates which axis's *result* counts (`vReserved`/`hReserved`); the read itself always happens. `layoutOverlayScrollbars` similarly reads both panel and inner element metrics in full regardless of axis. Narrowing burst detection to one axis (as `ScrollStrip` does via `isVertical()`) would therefore miss half the cases where the same expensive read would otherwise repeat every frame — e.g. an `autoScroll: "x"` panel whose height changes every frame (fixed width, live vertical resize) would still force the read on every pass if only width were watched.

[^none-shortcut]: Verified via `grep -rn 'resizeScrollShadowOverlay\|measureScrollbarGutter\|updateScrollShadows' packages/lib/src/typescript/` (see the Overview's call-chain citation) — no subclass overrides any of the three, so the base `Panel.ts` guards are the only ones that matter. `measureScrollbarGutter`'s own first statement returns for `autoScroll === "none"` (`:779-781`); `init()` only installs `_shadowOverlay` when `resolved && this._scrollShadows && this._autoScroll !== "none"` (`:716`), so `resizeScrollShadowOverlay`/`updateScrollShadows`'s own `!this._shadowOverlay` guards (`:967`, `:1005`) make them no-ops whenever `autoScroll === "none"`, with or without this plan's change.

[^no-backstop]: Every call site of `.getInnerSize()` outside `core/Panel.ts`/`core/Component.ts`/`core/Container.ts` was checked (`grep -rn '\.getInnerSize(' packages/lib/src/typescript/`): every layout manager's own `doLayout()` (`VBox`, `HBox`, `Split`, `Card`, `Tab`, `Grid`, `Anchor`, `Border`, `Accordion`, `HFlow`, `VFlow`, `Fit`, the base `LayoutManager`, `layout/Table.ts`) and every component's own `doLayout()` override (`AbstractChart`, `component/table/Table.ts`, `CodeEditor`, `AbstractWindow`) — all of these run as part of the same synchronous layout recursion `Panel.doLayout()` itself belongs to, so they already read whatever gutter the *last* completed pass left, exactly as they do today. The one exception is `FloatingPanel.placeNextTo` (`component/container/FloatingPanel.ts:199`), a discrete positioning call (not part of `doLayout()`) that reads its host panel's `getInnerSize()`. If called while that host is mid-burst, it would position against the frozen gutter — a narrow, bounded edge case (a floating panel being positioned while its host is simultaneously being drag-resized), self-correcting the moment the host's own next full pass runs, and not meaningfully different in kind from `ScrollStrip`'s own accepted "two gestures cannot occur simultaneously from one pointer" reasoning for its `mainScroll()` callers. Not worth a dedicated backstop.

[^name-collision]: Confirmed via `grep -rn '_resizeSettleHandle\|scheduleResizeSettle\|armResizeSettleCheck\|flushResizeSettle' packages/lib/src/typescript/ .worktrees/scrollstrip-resize-resync-coalescing/packages/lib/src/typescript/ .worktrees/virtual-row-view-resize-relayout/packages/lib/src/typescript/`: zero matches on `master`, matches only in `ScrollStrip.ts` (the `scrollstrip-resize-resync-coalescing` worktree) and `VirtualRowView.ts` (the `virtual-row-view-resize-relayout` worktree, which does not extend `Panel` and so cannot collide). This plan's chosen replacement names (`_scrollMetricsSettleHandle`, `scheduleScrollMetricsSettle`, `armScrollMetricsSettleCheck`, `flushScrollMetricsSettle`, plus `_panelSizeMoved`, `_scrollMetricsOwed`, `_lastPanelWidth`, `_lastPanelHeight`) were separately grepped against all three locations and are unused anywhere in any of them.

[^subclass-check]: All ten direct `extends Panel` subclasses were checked (`grep -rln 'extends Panel\b' packages/lib/src/typescript/lib/`): `AbstractChart`, `ChartLegend`, `FloatingPanel`, `ScrollStrip`, `DiagramGroupNode`, `DiagramNode`, `DiagramView`, `MarkdownViewer`, `PickerColumn`, `Form`. Of these, only `AbstractChart`, `DiagramView`, and `MarkdownViewer` override `doLayout()`, and each calls `super.doLayout()` as its first statement. None of the ten (nor their own further subclasses — `BarChart`, `LineChart`, `CodeEditorSearchPanel`, `MarkdownMinimap`) declares its own `resizeScrollShadowOverlay`, `measureScrollbarGutter`, or `updateScrollShadows` — confirmed by grepping those three names across the whole `packages/lib/src/typescript/` tree, which found only `Panel.ts`'s own definitions and calls. `LayoutManager.commitBounds` (`layout/LayoutManager.ts:547`) sets a child's width/height before calling its `doLayout()`, so `this.getWidth()`/`getHeight()` are always current by the time any `Panel.doLayout()` runs, regardless of when in a subclass's own override body `super.doLayout()` is called.
