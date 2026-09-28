---
depends-on: [unchanged-commit-opt-ins, qa-surfaces-for-stalled-candidates]
touches-shared:
  - packages/lib/src/typescript/lib/core/Panel.ts
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/docs/concepts/layout-system.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
---

# Panel Scroll Read Economy — Implementation Plan

## Overview

A scrolling [`Panel`](packages/lib/src/typescript/lib/core/Panel.ts#L192) reads the DOM more often than its own state changes, in two places. On every layout pass it re-measures its scroll metrics — [`remeasureScrollMetrics`](packages/lib/src/typescript/lib/core/Panel.ts#L1150) — even when the pass moved nothing and nothing beneath the panel changed. On every scroll event it reads the same element's metrics twice, because the panel registers two `scroll` listeners that each read for themselves, and it re-reads its own client box to re-assert a size the layout pass had already written. On every wheel event, [`Component.onWheelScroll`](packages/lib/src/typescript/lib/core/Component.ts#L5539) and the clamp it drives read the same metrics up to four times.

This plan removes those repeats. The settled pass earns its skip from the layout system's own "nothing changed here" state, so **every** panel gets it — including a subclass, which is what an application pane almost always is. The scroll path keeps one listener that reads once and hands the result to both consumers, and the wheel path reads once for both axes. Nothing about what the panel paints, or how often, changes.

Both halves are the render review's candidate G16, measured on 2026-09-25 and 2026-09-26. Both remove real DOM reads and neither moves the clock, which is what the review's standing rule ships: a work reduction with a flat clock is worth shipping unless it costs considerable code complexity.[^claims] The work is in [`core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts) and [`core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts); no exported signature changes.

---

## Architecture Decisions

### Both halves ship as one plan

The settled-pass skip and the scroll-read economy are planned and implemented together, as separate commits in one branch.[^one-plan]

### The settled pass is gated on the layout system's own state, not on a value signature

`Panel.doLayout` withholds `remeasureScrollMetrics` when two things hold: this pass committed the same width and height as the previous one, and nothing marked the panel's layout since its last completed pass. The second half is the existing predicate `Component.canSkipUnchangedCommit` already asks, minus the per-class opt-in, factored out as a protected `isLayoutSettled()`.[^dirty-not-signature]

The precedent is that gate itself — [`Component.canSkipUnchangedCommit`](packages/lib/src/typescript/lib/core/Component.ts#L4507), which wave 2 built and [`unchanged-commit-opt-ins`](plans/implemented/unchanged-commit-opt-ins.md) extended. This plan reuses its terms rather than deriving a second, weaker answer to the same question.

### A subclassed panel needs no audit to earn this skip

The whole-pass skip stays what it is: a per-class opt-in, granted by overriding [`Panel.canSkipUnchangedLayout`](packages/lib/src/typescript/lib/core/Panel.ts#L610) after auditing that class's own layout writers, which today only a plain `Panel` does. The scroll remeasure is a narrower unit of work and is granted by state instead of by class, so a `Panel` subclass — a library one or a consumer's — gets it with no audit and no override.[^no-audit]

### One scroll listener reads the metrics once and hands them to both consumers

A scrolling panel today registers two subtree `scroll` listeners: one calling `syncOverlayScrollbars`, wired by [`installOverlayScrollbars`](packages/lib/src/typescript/lib/core/Panel.ts#L1628), and one calling `updateScrollShadows`, wired by [`installScrollShadows`](packages/lib/src/typescript/lib/core/Panel.ts#L1349). Both fire for the same event and each reads the same element's metrics. They become one listener that reads once and passes the metrics into both methods.[^read-once]

### The shadow overlay's size is asserted when it is installed, not on every scroll

[`resizeScrollShadowOverlay`](packages/lib/src/typescript/lib/core/Panel.ts#L1460) reads the panel's own client box, which a scroll cannot change. Its single call site moves out of `updateScrollShadows` and into `installScrollShadows`, so the overlay is sized when it is installed or refreshed and then on every layout pass, and never from the scroll path.[^resize-at-install]

### A wheel event reads the scroll metrics once for both axes

`onWheelScroll` reads the metrics once through a new private `readMaxScroll()` and derives both maxima from that read. It then lends the pair to the clamp that `SmoothScroller.scrollBy` performs inside the same call, through a field cleared in a `finally` before the handler returns.[^wheel-pair]

### The read economy leaves the paint cost untouched

The consuming application's finding about this cue is a **paint** cost: WebKitGTK software-rasterises a blurred inset `box-shadow` every frame, for any populated scroller. This plan changes **reads**. The shadow overlay, its four edge strips and their `box-shadow` layers all stay exactly as they are, and no strip repaints less often than it does today. The paint side was addressed by [`scroll-shadow-edge-strips`](plans/implemented/scroll-shadow-edge-strips.md), which cut the blurred area from four viewport-sized boxes to four 12-pixel bands; anything further is a separate change measured with a different instrument.[^paint-untouched]

---

## Public API

No exported symbol changes shape. `Component.getMaxScrollLeft()` and `getMaxScrollTop()` keep their signatures and their answers.

One new protected member, so a subclass in the library can ask the same question the commit gate asks:

```typescript
/** Whether nothing has marked this component's layout since its last completed pass. */
protected isLayoutSettled(): boolean;
```

`canSkipUnchangedCommit()` keeps its signature, its `@internal` tag and its answer; its body now reads `isLayoutSettled()`.

Private members added, changed or removed:

```typescript
// core/Component.ts
private readMaxScroll(): { x: number; y: number };        // new
private _wheelMaxScroll: { x: number; y: number } | null; // new, plain `= null` initialiser

// core/Panel.ts
declare private _scrollHandler: (() => void) | null;      // new — replaces the two below
declare private _shadowScrollHandler:  (() => void) | null;   // REMOVED
declare private _overlayScrollHandler: (() => void) | null;   // REMOVED

private ensureScrollListener(): void;                     // new
private releaseScrollListener(): void;                    // new
private handleScroll(): void;                             // new
private canSkipSettledRemeasure(sizeChanged: boolean, settledAtEntry: boolean): boolean;   // new

private syncOverlayScrollbars(metrics: ScrollMetrics): void;                  // was ()
private updateScrollShadows(element?: Handle, metrics?: ScrollMetrics): void; // was (element?)
```

`_wheelMaxScroll` takes a plain `= null` initialiser, **not** `declare`: no setter `applyOptions` dispatches ever writes it, so the super-cascade trap in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) does not apply — it mirrors `_wheelScroller` ([`Component.ts:666`](packages/lib/src/typescript/lib/core/Component.ts#L666)). `_scrollHandler` **is** `declare`d and seeded in `Panel.applyOptions`, because the teardown paths that read it can run from a setter during the `super()` cascade — exactly why the two fields it replaces are `declare`d today ([`Panel.ts:209`](packages/lib/src/typescript/lib/core/Panel.ts#L209), [`:246`](packages/lib/src/typescript/lib/core/Panel.ts#L246)).

---

## Internal Structure

### The factored predicate

```typescript
// core/Component.ts — the body moves out of canSkipUnchangedCommit unchanged.
protected isLayoutSettled(): boolean {
    return !this.isLayoutDirty()
        && this._firstLayoutCallbacks === null
        && this._layoutMetricsGeneration === Util.textMetricsGeneration();
}

public canSkipUnchangedCommit(): boolean {
    return this.canSkipUnchangedLayout()
        && this.isLayoutSettled()
        && !!this.getElement();
}
```

### `Panel.doLayout`'s new shape

The sample must be taken **before** `super.doLayout()`, which clears the dirty flag and records the current text-metrics generation ([`Component.ts:7977`](packages/lib/src/typescript/lib/core/Component.ts#L7977)). The second read of `isLayoutDirty()` catches anything that marked the panel from inside its own pass.

```typescript
doLayout(): this {
    const settledAtEntry = this.isLayoutSettled();

    super.doLayout();
    this.commitElementStyle();

    const width  = this.getWidth();
    const height = this.getHeight();
    const sizeChanged = width !== this._lastPanelWidth || height !== this._lastPanelHeight;

    if (sizeChanged) {
        this._lastPanelWidth  = width;
        this._lastPanelHeight = height;
    }

    if (!this.canSkipSettledRemeasure(sizeChanged, settledAtEntry)) {
        if (!this.deferScrollMetricsWhileResizing(sizeChanged)) {
            this.remeasureScrollMetrics();
        } else if (this._scrollbarStyle === "overlay" && this._overlayScrollElement) {
            /* the existing inner-scroller size write, unchanged */
        }
    }

    this.scheduleGutterSettleOnShrink();

    return this;
}

private canSkipSettledRemeasure(sizeChanged: boolean, settledAtEntry: boolean): boolean {
    return !sizeChanged && settledAtEntry && !this.isLayoutDirty();
}
```

The gate sits **outside** `remeasureScrollMetrics` and outside the resize-settle relay — the two-frame relay that performs a re-measure withheld while the panel's size was still changing every pass. [`flushScrollMetricsSettle`](packages/lib/src/typescript/lib/core/Panel.ts#L873) keeps calling `remeasureScrollMetrics` unconditionally: by the time a burst settles the panel is settled and its size has not moved since the last pass, so a gate inside the method would swallow the catch-up the relay exists to perform.

Which passes engage it:

| Pass | `sizeChanged` | Marked since last pass | Remeasure |
|---|---|---|---|
| First pass after mount | yes (`_lastPanelWidth` is `-1`) | yes (never laid out) | runs |
| A parent re-commits the same rectangle, nothing else changed | no | no | **withheld** |
| A child's `setPreferredSize` relayed upward, then a pass | no | yes (the relay calls `scheduleLayout` on every ancestor) | runs |
| `setInsets` / `setBorder` / `setAutoScroll`, then a pass | no | yes (each calls `invalidateLayout`) | runs |
| A theme switch or font swap, then a pass | no | yes (the text-metrics generation moved) | runs |
| The settle relay's catch-up after a resize burst | — | — | runs (not gated) |

### The merged scroll listener

```typescript
private ensureScrollListener(): void {
    if (this._scrollHandler) {
        return;
    }

    const handler = (): void => {
        this.handleScroll();
    };

    this._scrollHandler = handler;
    Event.addSubtreeListener(this, "scroll", handler);
}

private releaseScrollListener(): void {
    // The other consumer may still need it: the shadow overlay and the inner
    // scroller are installed and torn down independently.
    if (!this._scrollHandler || this._shadowOverlay || this._overlayScrollElement) {
        return;
    }

    Event.removeSubtreeListener(this, "scroll", this._scrollHandler);
    this._scrollHandler = null;
}

private handleScroll(): void {
    const el = this.getScrollElement();

    if (!el) {
        return;
    }

    const metrics = DOM.source.getScrollMetrics(el);

    this.syncOverlayScrollbars(metrics);
    this.updateScrollShadows(undefined, metrics);
}
```

`getScrollElement()` resolves to the inner scroller in overlay mode and to the panel element otherwise ([`Panel.ts:632`](packages/lib/src/typescript/lib/core/Panel.ts#L632)) — the same handle each of the two methods reads today, so one read serves both in either mode.

### Reads per event, from the call sites cited above

| Occasion | Configuration | Today | After |
|---|---|---|---|
| Live layout pass | overlay + shadows | 2 | 2 |
| Live layout pass | native + shadows | 2 | 2 |
| Settled layout pass | any scrolling mode | 2 | **0** |
| Scroll event | overlay + shadows | 3 | **1** |
| Scroll event | native + shadows | 2 | **1** |
| Scroll event | overlay, shadows off | 1 | 1 |
| Wheel event, claimed | both axes scrollable | 4 | **1** |
| Wheel event, claimed | one axis scrollable | 3 | **1** |

The wheel row counts `onWheelScroll`'s own maxima plus the two clamps `SmoothScroller.scrollBy` performs synchronously inside it ([`SmoothScroller.ts:152-153`](packages/lib/src/typescript/lib/core/SmoothScroller.ts#L152)). A one-axis panel reads three times rather than four because `canX`/`canY` short-circuit on the overflow style before asking for a maximum.

### The wheel path

```typescript
private readMaxScroll(): { x: number; y: number } {
    const element = this.getScrollElement();

    if (!element) {
        return { x: 0, y: 0 };
    }

    const metrics = DOM.source.getScrollMetrics(element);

    return {
        x: metrics.scrollWidth  - metrics.clientWidth,
        y: metrics.scrollHeight - metrics.clientHeight,
    };
}

getMaxScrollLeft(): number {
    return this.readMaxScroll().x;
}

getMaxScrollTop(): number {
    return this.readMaxScroll().y;
}
```

`attachWheelScrolling`'s clamp seam prefers the lent pair when one is set:

```typescript
clamp: (axis, value) => {
    const max = this._wheelMaxScroll ?? this.readMaxScroll();

    return Util.clamp(value, 0, axis === "x" ? max.x : max.y);
},
```

and `onWheelScroll` lends it for the duration of its own call only:

```typescript
const max  = this.readMaxScroll();
const canX = this.isOverflowScrollable(this.getOverflowX()) && max.x > 0;
const canY = this.isOverflowScrollable(this.getOverflowY()) && max.y > 0;

/* … the existing delta, shift-redirect, zero-delta and consumeWheel logic … */

this._wheelMaxScroll = max;

try {
    this._wheelScroller?.scrollBy(dx, dy);
} finally {
    this._wheelMaxScroll = null;
}

return { prevent: true };
```

---

## Ordered Implementation Steps

Each step that changes behaviour writes its cases from `## Expected Behaviour` first, watches them fail, then makes the change. A step that touches source ends with `npm run typecheck`; a step that touches a test file ends with `npm -w packages/lib run typecheck:test`.

1. **`packages/lib/src/typescript/lib/core/Component.ts` — factor the settled half out of the commit gate.** Add `protected isLayoutSettled()` immediately above [`canSkipUnchangedCommit`](packages/lib/src/typescript/lib/core/Component.ts#L4507) with the three terms shown in *Internal Structure*, and have `canSkipUnchangedCommit` call it. Move the `@remarks` paragraphs about a pass owed beneath, a queued `onFirstLayout` drain and a theme switch onto the new method, leaving `canSkipUnchangedCommit`'s own doc saying it adds the class opt-in and the element check. Pure refactor — no behaviour changes. Check: `npm -w packages/lib run test`, with `tests/core/UnchangedCommitSkip.test.ts`, `UnchangedCommitMetricsGate.test.ts`, `UnchangedCommitOptIns.test.ts` and `UnchangedCommitFormOptIns.test.ts` passing untouched.

2. **`packages/lib/tests/core/PanelScrollReadEconomy.test.ts` — create the file with the settled-pass cases A–G.** Mirror the harness of [`PanelResizeMetricsCoalescing.test.ts:20-150`](packages/lib/tests/core/PanelResizeMetricsCoalescing.test.ts#L20) verbatim for the `CONFIG`, `stubMetrics`, frame-capture and `internals` idioms; that file's comment header explains why the assertions are call-count **deltas** rather than absolute counts. Cases A–G fail.

3. **`packages/lib/src/typescript/lib/core/Panel.ts` — withhold the remeasure on a settled pass.** Add `canSkipSettledRemeasure` next to [`deferScrollMetricsWhileResizing`](packages/lib/src/typescript/lib/core/Panel.ts#L808) and rework [`doLayout`](packages/lib/src/typescript/lib/core/Panel.ts#L717) into the shape in *Internal Structure*. Do not touch `remeasureScrollMetrics` or `flushScrollMetricsSettle`. Extend `doLayout`'s doc comment with one paragraph: a pass that commits the same box with nothing marked since the last pass withholds the remeasure, and the writers that mark it are the ones `canSkipUnchangedLayout`'s own comment already enumerates. Cases A–G pass.

4. **`packages/lib/src/typescript/lib/core/Panel.ts` — merge the two scroll listeners.** Add cases H–J to `PanelScrollReadEconomy.test.ts` as a second `describe` first; they fail. Then replace the `_shadowScrollHandler` and `_overlayScrollHandler` field declarations ([`:209`](packages/lib/src/typescript/lib/core/Panel.ts#L209), [`:246`](packages/lib/src/typescript/lib/core/Panel.ts#L246)) with one `declare private _scrollHandler: (() => void) | null;`, and their two `applyOptions` seeds ([`:355`](packages/lib/src/typescript/lib/core/Panel.ts#L355), [`:370`](packages/lib/src/typescript/lib/core/Panel.ts#L370)) with one `this._scrollHandler = null;`. Add `ensureScrollListener`, `releaseScrollListener` and `handleScroll`. In [`installScrollShadows`](packages/lib/src/typescript/lib/core/Panel.ts#L1344) and [`installOverlayScrollbars`](packages/lib/src/typescript/lib/core/Panel.ts#L1563) replace each handler block with `this.ensureScrollListener();`. In [`removeScrollShadows`](packages/lib/src/typescript/lib/core/Panel.ts#L1412) and [`removeOverlayScrollbars`](packages/lib/src/typescript/lib/core/Panel.ts#L1659) delete the handler-removal block and call `this.releaseScrollListener()` **after** the method has nulled its own state (`_shadowOverlay` and `_overlayScrollElement` respectively), so the guard reads the truth. Check: `grep -rn '_shadowScrollHandler\|_overlayScrollHandler' packages/lib/src packages/lib/tests` — expect matches only in `tests/core/PanelOverlayScrollbar.test.ts`, which step 6 fixes. Cases H–J pass.

5. **`packages/lib/src/typescript/lib/core/Panel.ts` — move the overlay resize to install time and thread the read.** Add cases K–L to the same `describe` first; they fail. Then append `this.resizeScrollShadowOverlay(element);` to `installScrollShadows` after the overlay exists, and delete the call from [`updateScrollShadows`](packages/lib/src/typescript/lib/core/Panel.ts#L1499). Give `updateScrollShadows` the optional `metrics` parameter and `syncOverlayScrollbars` the required one, per *Public API*; `syncOverlayScrollbars` keeps its `_overlayScrollElement` and two-bar guards and stops reading. Update both doc comments: `resizeScrollShadowOverlay` is now asserted at install and by every layout pass, and the per-scroll path recomputes edges only. Cases K–L pass.

6. **`packages/lib/tests/core/PanelOverlayScrollbar.test.ts` — follow the renames.** Steps 4 and 5 leave this one file failing; this step is what makes it green again. In the `OverlayInternals` type ([`:78-91`](packages/lib/tests/core/PanelOverlayScrollbar.test.ts#L78)) rename `_overlayScrollHandler` to `_scrollHandler` and change `syncOverlayScrollbars(): void` to `syncOverlayScrollbars(metrics: ScrollMetrics): void`; update the assertion at [`:148`](packages/lib/tests/core/PanelOverlayScrollbar.test.ts#L148) and the two calls at [`:453-454`](packages/lib/tests/core/PanelOverlayScrollbar.test.ts#L453), which now pass the stubbed metrics object. Nothing else in the file changes.

7. **`packages/lib/src/typescript/lib/core/Component.ts` — one metrics read per wheel event.** Add cases M–P to `PanelScrollReadEconomy.test.ts` as a third `describe` first; they fail. Then add `private readMaxScroll()` above [`getMaxScrollLeft`](packages/lib/src/typescript/lib/core/Component.ts#L5137), have both getters delegate to it, add the `_wheelMaxScroll` field beside `_wheelScroller` ([`:666`](packages/lib/src/typescript/lib/core/Component.ts#L666)), and change the clamp closure ([`:5468`](packages/lib/src/typescript/lib/core/Component.ts#L5468)) and [`onWheelScroll`](packages/lib/src/typescript/lib/core/Component.ts#L5539) as shown in *Internal Structure*. Leave the `read`/`write` halves of the seam alone. Cases M–P pass.

8. **`packages/lib/docs/concepts/layout-system.md` — document the narrower skip.** In *The write is diffed* ([`:29-33`](packages/lib/docs/concepts/layout-system.md#L29)), after the sentence listing the classes that opt in, add one sentence: a scrolling `Panel` — every one, subclasses included — additionally withholds its post-layout scroll-metrics re-measure on a pass that commits the same rectangle with nothing marked since its last pass, so the announcement caveat in the paragraph below covers a stale scrollbar gutter or edge shadow too.

9. **`packages/lib/docs/reference/changelog/next.md` and `migration/next.md` — record the behaviour change.** Add a bullet under *Breaking changes → Core* in the changelog, next to the existing `Panel` unchanged-commit entry ([`:11`](packages/lib/docs/reference/changelog/next.md#L11)), and a section in the migration page modelled on *A `Panel` re-committed at its own rectangle is not re-laid-out* ([`:315`](packages/lib/docs/reference/migration/next.md#L315)): what changed (a settled pass no longer re-measures), who needs to act (code that changes content inside a scrolling panel without calling `setPreferredSize`, `notifyIntrinsicSizeChanged` or `scheduleLayout`, and relied on an unrelated later pass to re-measure the gutter), and the same before/after snippet shape.

10. **Full verification.** `npm run typecheck`, `npm -w packages/lib run test`, `npm run lint`. Then the manual and in-engine checks in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) |
| Modify | [`packages/lib/src/typescript/lib/core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts) |
| Create | [`packages/lib/tests/core/PanelScrollReadEconomy.test.ts`](packages/lib/tests/core/PanelScrollReadEconomy.test.ts) |
| Modify | [`packages/lib/tests/core/PanelOverlayScrollbar.test.ts`](packages/lib/tests/core/PanelOverlayScrollbar.test.ts) |
| Modify | [`packages/lib/docs/concepts/layout-system.md`](packages/lib/docs/concepts/layout-system.md) |
| Modify | [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) |
| Modify | [`packages/lib/docs/reference/migration/next.md`](packages/lib/docs/reference/migration/next.md) |

---

## Expected Behaviour

Every case below is unit-testable offline against the modelled DOM, with `getScrollMetrics` stubbed and counted as `PanelResizeMetricsCoalescing.test.ts` already does. Cases A–G go in one `describe` for the settled pass, H–L in one for the scroll path, M–P in one for the wheel path. Anything on screen — the shadows fading, the thumb tracking, the gutter appearing — is manual, and listed in `## Verification`.

**The settled pass.** Mount a scrolling panel, run a pass, then drain the queued frames so the resize-settle relay is no longer armed.

| | Case | Expectation |
|---|---|---|
| A | A second pass with no size change and nothing marked | zero `getScrollMetrics` calls |
| B | A pass after `setWidth` / `setHeight` | the live-pass count (2 in the default overlay configuration) |
| C | A pass after `invalidateLayout()` | the live-pass count |
| D | A pass after a child's `setPreferredSize` relayed upward | the live-pass count |
| E | A pass after `ThemeManager.setTheme(ThemeManager.getTheme())` | the live-pass count |
| F | A resize burst driven to settle | the catch-up still remeasures; `PanelResizeMetricsCoalescing.test.ts` passes unchanged |
| G | A settled pass on an `autoScroll: "none"` panel | zero calls, as before, and no settle frame armed |

**The scroll path.** Drive the scroll by invoking the merged handler through the `internals()` cast, as `PanelScrollChaining.test.ts:75` invokes `updateScrollShadows`.

| | Case | Expectation |
|---|---|---|
| H | `autoScroll: "y"` with the default overlay style and shadows on | `_scrollHandler` is non-null, and a cast reads `_shadowScrollHandler` and `_overlayScrollHandler` as `undefined` |
| I | `setScrollShadows(false)` on that panel | `_scrollHandler` stays non-null (the bars still need it) |
| J | `setAutoScroll("none")` after that | `_scrollHandler` is null and the subtree listener is removed |
| K | One scroll on a shadowed panel, run once per scrollbar style | exactly one `getScrollMetrics` call; in overlay mode both bars receive `setMetrics` from that read's values; the four cached `_shadowEdges` are the values that read implies |
| L | First render of a shadowed panel | the overlay's `width` / `height` are written during `init`, as they are today |

**The wheel path.** Reuse `PanelScrollChaining.test.ts`'s `wheel()` and `wheelEvent()` helpers.

| | Case | Expectation |
|---|---|---|
| M | A claimed wheel on an `autoScroll: "auto"` panel overflowing both axes | exactly one `getScrollMetrics` call, and the same `{ prevent: true }` disposition as today |
| N | A wheel on a scroll-styled panel whose content fits | unclaimed, exactly as `PanelScrollChaining.test.ts` already pins |
| O | After any `onWheelScroll` return, claimed or not | `_wheelMaxScroll` is null |
| P | `getMaxScrollLeft()` and `getMaxScrollTop()` called directly | one `getScrollMetrics` call each, same values as today |

---

## Verification

1. `npm run typecheck` — clean.
2. `npm -w packages/lib run test` — the whole suite. The files most exposed to these changes are `tests/core/PanelScrollReadEconomy.test.ts` (new), `PanelResizeMetricsCoalescing.test.ts` and its `Realtime` sibling, `PanelOverlayScrollbar.test.ts`, `PanelScrollShadowStrips.test.ts`, `PanelScrollChaining.test.ts`, `PanelGutterSettle.test.ts`, `PanelHiddenRemeasure.test.ts`, `PanelFlushInsets.test.ts`, `ScrollStrip.test.ts` and the four `UnchangedCommit*` files. A failure in any of them is a real signal, not a fixture to update: the likely cause is a test that drives a settled `doLayout()` and expects a re-measure without marking the panel, which is exactly the behaviour this plan changes — fix it by marking the panel in the test, and say so in the test's comment.
3. `npm run lint` — clean.
4. `npm run docs:api` — no **new** warnings. `master` already emits 14, so the bar is "no more than before", not zero.
5. **Manual, by eye** — `npm run dev`, the library demo app. On the **Markdown** tab: scroll the document and confirm the edge shadows fade in and out as before, the overlay thumb tracks the content, and no shadow band is mis-sized or left lit at an extreme. Resize the window until a scrollbar appears and disappears and confirm the gutter still reserves and releases. On the **Grid** tab, repeat the scroll check on a plain `Panel`. Then drag a `Split` gutter on a scrolling pane (the **Complex UI** tab) and confirm the pane's shadows and thumb settle correctly when the drag stops — that is the resize-settle relay's own path, which this plan must leave intact.
6. **In engine, by the user** — no agent runs a window. Two cells, both already defined in the record: cell `spp` for the settled pass ([`qa-surfaces-for-stalled-candidates.md:476-494`](plans/implemented/qa-surfaces-for-stalled-candidates.md#L476)) and the `cdw` / `sdw` / `ssw` wheel cells for the scroll reads ([`w3-0-bounding-sweep.md:908-910`](plans/implemented/w3-0-bounding-sweep.md#L908)). The acceptance reading, per the record's own figures — where a cell's *bracket* is the spread of its own three plain arms:
   - On `spp`'s `passes` phase, the **plain** arm's `seam.source.getScrollMetrics` per unit falls from 48.00 to about the 0.32 the `g16.panel-settled` arm reached, with geometry `=` on every run and `work.pane.remeasure@ScrollPane` dropping with it.
   - On the wheel cells, the **plain** arm's per-unit reads fall by at least the 50% the `g16.scroll-reads` arm reached, with geometry `=`.
   - No phase is slower than the plain arm by more than the cell's own bracket. The clock is expected to be flat; that is the verdict the record already recorded, not a failure.
   - Both G16 ablations then have nothing left to remove and will read as unengaged. That is the intended end state, not a defect.

---

## Documentation Impact

No exported symbol is added, removed or renamed, so no TypeDoc page, catalog entry or sidebar entry changes, and [`packages/lib/llms.txt`](packages/lib/llms.txt) gains no capability. What changes is documented behaviour, in three places, all listed in `## Ordered Implementation Steps`: the *The write is diffed* section of [`docs/concepts/layout-system.md`](packages/lib/docs/concepts/layout-system.md), which is where the unchanged-commit skip and its announcement caveat are described for consumers; a *Breaking changes → Core* bullet in [`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md); and a section in [`docs/reference/migration/next.md`](packages/lib/docs/reference/migration/next.md) modelled on the existing `Panel` note. The new `isLayoutSettled` is protected, so it is excluded from the API docs and must not be `{@link}`ed from any public JSDoc, per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md).

---

## Potential Challenges

- **A test that drove a settled `doLayout()` to force a re-measure.** Verification step 2 says how to tell such a failure from a regression and how to fix it.
- **Three library classes call a child panel's `doLayout()` directly** — `ScrollStrip` on its clip ([`ScrollStrip.ts:523`](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L523)), `AbstractChart` on its legend ([`AbstractChart.ts:723`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts#L723)) and `DiagramView` on its spinner ([`DiagramView.ts:815`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L815)). Such a call no longer forces a re-measure when the child is settled at an unchanged box; each of the three resizes the child first, so none relies on it, and `ScrollStrip`'s own max-scroll read goes to the live DOM rather than through the re-measure.
- **Listener release order.** `releaseScrollListener` must run after the calling teardown has nulled its own field, or a panel that drops one consumer keeps a listener with nothing left to serve. Cases I and J pin both directions.
- **The sibling plan [`unreached-ablation-surfaces`](plans/unreached-ablation-surfaces.md) builds a `scroll-panes` cell for `g16.scroll-reads`.** It touches `packages/qa` only, so there is no file conflict, but once this plan ships that cell measures an arm with nothing left to remove. If its part-one reading is wanted, it runs first.[^sibling-cell]
- **The overlay scroll bars and the shadow overlay are the two consumers of one listener**, and each can be installed while the other is absent. The combinations are pinned by H (both), I (bars only), J (neither) and case K's native-with-shadows run (shadows only).

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts) — `doLayout` ([`:717`](packages/lib/src/typescript/lib/core/Panel.ts#L717)), the settle relay ([`:808-889`](packages/lib/src/typescript/lib/core/Panel.ts#L808)), `canSkipUnchangedLayout`'s writer audit ([`:566-612`](packages/lib/src/typescript/lib/core/Panel.ts#L566)), `remeasureScrollMetrics` ([`:1150`](packages/lib/src/typescript/lib/core/Panel.ts#L1150)), the shadow and overlay install/teardown pairs ([`:1344`](packages/lib/src/typescript/lib/core/Panel.ts#L1344), [`:1412`](packages/lib/src/typescript/lib/core/Panel.ts#L1412), [`:1563`](packages/lib/src/typescript/lib/core/Panel.ts#L1563), [`:1659`](packages/lib/src/typescript/lib/core/Panel.ts#L1659)) and `syncOverlayScrollbars` ([`:1767`](packages/lib/src/typescript/lib/core/Panel.ts#L1767)).
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — the commit gate ([`:4479-4537`](packages/lib/src/typescript/lib/core/Component.ts#L4479)), the max-scroll getters ([`:5137`](packages/lib/src/typescript/lib/core/Component.ts#L5137)), the wheel attach and handler ([`:5460`](packages/lib/src/typescript/lib/core/Component.ts#L5460), [`:5539`](packages/lib/src/typescript/lib/core/Component.ts#L5539)), the preferred-size relay in `wireChild` ([`:7357`](packages/lib/src/typescript/lib/core/Component.ts#L7357)) and `doLayout`'s dirty-flag clear ([`:7951-7981`](packages/lib/src/typescript/lib/core/Component.ts#L7951)).
- [`plans/implemented/unchanged-commit-opt-ins.md`](plans/implemented/unchanged-commit-opt-ins.md) — the precedent: the per-class opt-in, the writer audit it demands, and the list of placement inputs that mark a pass owed.
- [`plans/implemented/w3-0-bounding-sweep.md:415-425`](plans/implemented/w3-0-bounding-sweep.md#L415) — what each G16 ablation patches, which is what the shipped change has to correspond to.
- [`plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md:51`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#L51), [`:316-318`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#L316) and [`00-post-campaign-agenda.md`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md)'s *First measurements of G16, G25 and G27*, *Judged again* and *Corrections* sections — the measurements and the rule this plan ships under.
- [`packages/lib/tests/core/PanelResizeMetricsCoalescing.test.ts`](packages/lib/tests/core/PanelResizeMetricsCoalescing.test.ts) — the read-count-delta harness the new test file copies.
- [`plans/implemented/scroll-shadow-edge-strips.md`](plans/implemented/scroll-shadow-edge-strips.md) — what the paint side already does, so this plan does not disturb it.

---

## Non-Goals

- **Opting any `Panel` subclass into the whole-pass unchanged-commit skip.** That is G09's staged opt-in work and needs a per-class writer audit; this plan narrows the scroll re-measure only, and leaves `canSkipUnchangedLayout` answering exactly what it answers today.
- **Widening the exported `SmoothScrollTarget` seam so one clamp call serves both axes.** The lent pair already removes the duplicate wherever it occurs on this path: `onWheelScroll` is the only caller of the native target's `scrollBy` ([`Component.ts:5567`](packages/lib/src/typescript/lib/core/Component.ts#L5567)). Changing the seam would therefore buy nothing here and would break every consumer implementing the interface.
- **`VirtualScroller`'s own shadow overlay and scroll path.** It is the second owner of the shadow recipe and has its own read profile; G16 is about `Panel`.
- **Retiring or rewriting the `g16.panel-settled` and `g16.scroll-reads` ablations, or editing `packages/qa`.** They become unengaged once this ships, which is the acceptance signal; what to do with an ablation whose candidate landed is the QA record's own question.
- **Anything about the paint cost of the scroll cue.** See the last Architecture Decision.
- **Re-measuring content the framework was never told about.** A child that changes its own intrinsic size without calling `setPreferredSize`, `notifyIntrinsicSizeChanged` or `scheduleLayout` is not covered, exactly as it is not covered by the existing opt-ins; the migration note says so.

---

## Notes

[^claims]: The measurements, and the rule. The settled pass: on the `scroll-panes` cell's settled `passes` phase `seam.source.getScrollMetrics` fell from 48.00 to 0.32 per unit, −99.3%, geometry identical, with the ms delta (−0.60) inside a 1.40 bracket — flat (*First measurements of G16, G25 and G27*, 2026-09-25). The scroll reads: on three W3.0 wheel cells the counter fell 4.00 → 2.00 per unit, −50%, with ms deltas of −4.80, −3.41 and −3.29 all inside brackets of 10–12 ms — flat (`96-w3-0-bounding-sweep.md:51`, `:316`, `:318`, corrected 2026-09-26). The user's standing rule, set 2026-09-26 after five candidates were re-judged: render time is the primary priority and reduced work is secondary, but a work reduction with a flat clock is still worth shipping unless it costs considerable code complexity. So this plan argues on work and complexity and claims no render-time improvement. The record's own verdict on this candidate — "**G16 ships under the rule.** Its work reduction is real DOM reads removed, the clock is flat, and the cost is extending an opt-in whose pattern already ships from stage 1" — is what it implements.

[^one-plan]: Why one plan. The two halves edit the same 60 lines of neighbourhood in `core/Panel.ts`: the settled gate sits in `doLayout`, and the scroll-read work sits in the handler wiring and the three methods `doLayout`'s own re-measure shares (`resolveShadowOverlaySize`, `applyShadowOverlaySize`, `resolveShadowEdges`). Two branches would conflict on the file and each would have to re-establish the same reading of the resize-settle relay to be reviewed at all. They also share one acceptance measurement (both arms run in the cell `spp` ladder) and one documentation change. Splitting buys nothing but a second copy of the framing, and the commit structure keeps them separable anyway: steps 1–3 are one commit, steps 4–7 another.

[^dirty-not-signature]: Why not the ablation's signature. `g16.panel-settled` gates on `[getWidth(), getHeight(), getComponents().length, _lastContentExtent.width, _lastContentExtent.height]` (`qa-surfaces-for-stalled-candidates.md` step 1). That is sound as an instrument and unsound as a fix: `_lastContentExtent` is only updated while a scroll affordance is already showing ([`Panel.ts:935`](packages/lib/src/typescript/lib/core/Panel.ts#L935)), so a panel whose content has just grown past its viewport for the first time has an unchanged signature and would never discover the overflow it exists to reserve a gutter for. The layout system's own state has no such hole: a descendant's preferred-size change relays upward through the callback `wireChild` installs, which calls `scheduleLayout()` on every ancestor ([`Component.ts:7357`](packages/lib/src/typescript/lib/core/Component.ts#L7357)), and `scheduleLayout` marks the layout dirty ([`:8127`](packages/lib/src/typescript/lib/core/Component.ts#L8127)); every placement input the library owns either lays the panel out or calls `invalidateLayout` (the table in [`unchanged-commit-opt-ins`](plans/implemented/unchanged-commit-opt-ins.md)'s *Every placement input that announces nothing marks the pass owed*); and a theme switch or font swap moves the text-metrics generation, which the third term compares. The first ablation signature was even more expensive than the one measured — it called `getPreferredSize()` and `JSON.stringify` per pass, which is why the W3.0 `fnq` cell read `regress` at +0.33 ms on a 0.02 bracket before the signature was rewritten. The shipped gate reads three already-cached values and calls nothing.

[^no-audit]: Why not extend the class opt-in instead. The population that still pays this cost is subclassed scroll panes — "in practice ... most application panes" (*First measurements of G16, G25 and G27*). The library has eleven `Panel` subclasses and only two of them scroll (`MarkdownContentPane` and `PickerCellList`), so opting library classes in would leave the measured cost almost entirely in place, and it can never reach a consumer's own subclass, which is where the cost actually is. The QA panel makes the same point in its own comment: its panes are a subclass because "a subclass opts out by construction", and that is "the realistic shape". Granting the narrow skip by state rather than by class is what reaches them. The wide skip stays per-class because it withholds a whole subtree's placement, which needs the audit; withholding a re-measure whose inputs provably have not moved does not.

[^read-once]: The precedent for reading once and threading the result. `remeasureScrollMetrics` already has this shape: it reads the panel's box once into `avail` and hands the already-read metrics to `resolveNativeGutter`, `resolveShadowOverlaySize` and `resolveShadowEdges`, which are pure calculations over it ([`Panel.ts:1150-1208`](packages/lib/src/typescript/lib/core/Panel.ts#L1150)). The scroll path is the same problem one layer out, and gets the same answer. Merging the listeners is also a net simplification: two `declare`d handler fields, two seeds, two install blocks and two removal blocks become one of each. The alternative — keeping two listeners and adding a per-task memo over `getScrollMetrics`, as the ablation did — would add a cache with a lifetime the library has no primitive for, to serve two call sites that run in the same call stack.

[^resize-at-install]: Why moving the resize is safe. `resizeScrollShadowOverlay` has exactly one caller, `updateScrollShadows` ([`Panel.ts:1499`](packages/lib/src/typescript/lib/core/Panel.ts#L1499)), and `updateScrollShadows` has three: `init`, `refreshScrollShadows` and the scroll handler. The first two immediately follow `installScrollShadows`, so moving the call there keeps the install-time sizing the overlay needs before its first paint. On the scroll path the call was re-asserting a size that cannot have changed: the overlay's size is a function of the panel's client box and the cached gutter, and a scroll changes neither. Every path that does change them ends in a layout pass, which applies the size directly from its own fresh read ([`Panel.ts:1199-1202`](packages/lib/src/typescript/lib/core/Panel.ts#L1199)) — a gutter change schedules one ([`:1074`](packages/lib/src/typescript/lib/core/Panel.ts#L1074)), a border or padding write marks one owed, and a box write comes from layout by definition. The load-bearing use of the overlay's size — it is the panel's only in-flow child, so a stale height floors the element's `scrollHeight` — lives in the native branch of `remeasureScrollMetrics`, which sizes the overlay before it reads and is untouched here.

[^wheel-pair]: The lent maxima, and its lifetime. `onWheelScroll` reads both maxima to decide which axes can move, then calls `scrollBy`, which clamps both axes against the same two numbers inside the same synchronous call — four reads of one element's metrics for one gesture. The field is set immediately before that call and cleared in a `finally`, so it is never observable outside one handler invocation and cannot serve a later task a stale number; `Component.doLayout` uses a `finally` for the same reason, because a callee may throw. This is a tighter version of the ablation's own device: `g16.scroll-reads` memoised `getMaxScrollLeft`/`getMaxScrollTop` per task, which covered the same two pairs, and per-task is exactly the lifetime this avoids needing.

[^paint-untouched]: Read cost and paint cost. The consuming application traced a real per-frame cost to this framework's scroll cue: WebKitGTK software-rasterises a blurred inset `box-shadow` every frame for any populated scroller. Nothing in this plan removes an overlay, a strip, a shadow layer or a repaint; the writes it stops issuing were writing values already in place, and the reads it stops issuing never painted anything. So a flat clock here is not evidence about the paint, and a falling read counter is not a claim about it either — the same distinction the sibling QA plan draws for its own cell. The paint side's shipped answer is [`scroll-shadow-edge-strips`](plans/implemented/scroll-shadow-edge-strips.md), which left the overlay in place as an inert host and moved each edge's single shadow layer onto its own 12-pixel strip, cutting the blurred area per frame from four viewport-sized boxes to four bands. Anything beyond that needs an engine recording rather than a counter, per the campaign's own rule that a Chromium measurement can miss a paint-bound cost entirely.

[^sibling-cell]: The ordering question, and why it is small. [`unreached-ablation-surfaces`](plans/unreached-ablation-surfaces.md) builds a `call` target on `scroll-panes` so `g16.scroll-reads` can engage there; it edits `packages/qa` only. `g16.scroll-reads` is already measured on three W3.0 wheel cells, and the agenda's own reading is that a `scroll-panes` ladder for it "would be a second surface for a candidate already measured on three cells — useful, not owed" (*Corrections*, 2026-09-26). So this plan does not wait for it; it only notes that the cell measures nothing once the library stops issuing the reads.

---

## Implementation Notes

Implemented 2026-09-27 on `feature/panel-scroll-read-economy`, off
`feature/table-column-resize-outline-mode` (`750e11ef`) as phase 6 of a
nine-phase batch. Two code commits, matching `[^one-plan]`'s own split: steps
1–3, then steps 4–7 with step 6's test follow-up folded in. No exported signature
changed; `npm run typecheck`, `npm run lint` and the whole library suite are
clean, and `npm run docs:api` still emits exactly the 14 pre-existing warnings.

### Prescribed verifications that could not have caught a regression

Every assertion the plan prescribes was mutation-tested — the implementation was
broken in the specific way the assertion names, and the test had to go red.
Seven prescriptions did not, and are recorded here with what replaced them.

1. **Case F's shape as written cannot exercise the relay at all.** The plan
   describes F as "a resize burst driven to settle | the catch-up still
   remeasures", and cases A–E all start from a pre-settled panel (mount, one
   pass, drain). Started from there, the burst's first step is a size change that
   re-arms the relay and remeasures *live*, and its second step is an ordinary
   settled pass at an unchanged box — so nothing is owed and the catch-up
   correctly reads nothing. F only reaches the relay when the burst begins with
   the relay already armed by the mount pass, i.e. **without** the drain the
   other cases need. F is written that way, with the reason in a comment.

2. **Every "the live-pass count" comparison was satisfiable by zero.** B, C, E, F
   and the two child cases compare a later pass's read count against a `live`
   count calibrated from a live pass in the same test. An implementation that
   stopped remeasuring altogether collapses `live` to 0 and satisfies every
   `toBe(live)`. Proved: a gate evaluated *inside* `remeasureScrollMetrics` at
   call time — the exact mistake the plan's *Internal Structure* warns against —
   left F green while breaking A. Each of those cases now also asserts
   `live > 0`, and with that the same mutation turns seven cases red.

3. **Case G asserted the settle handle after a drain, which clears it.** The plan
   says G pins "zero calls, as before, and no settle frame armed". Asserting the
   handle after the settled pass says nothing: whatever the panel's *first* pass
   armed has already been drained by then. Removing
   `deferScrollMetricsWhileResizing`'s own `_autoScroll === "none"` early return
   left G green. G now asserts the handle immediately after the first pass,
   before the drain, and goes red for that mutation.

4. **No prescribed case reaches the gate's second `isLayoutDirty()` read.** A–G
   all mark the panel (or not) *before* the pass starts, which only the entry
   sample sees. Deleting `canSkipSettledRemeasure`'s `&& !this.isLayoutDirty()`
   term left all seven green. Added a case whose child republishes its preferred
   size from inside its own `doLayout` — the shape a `Text` descendant takes when
   it re-measures at a new width, and the only way a panel enters a pass settled
   and leaves it marked. This is the term the plan's *Internal Structure*
   introduces as "the second read of `isLayoutDirty()` catches anything that
   marked the panel from inside its own pass"; without this case it was dead
   code by test.

5. **The four listener install/teardown combinations are not pinned by H, I, J
   and K as *Potential Challenges* claims.** Three of the four were vacuous:
   - **I cannot see whether the bars wire a listener of their own.** It turns the
     shadows off *after* mount, by when the shadow install has already wired one.
     Removing `ensureScrollListener()` from `installOverlayScrollbars` left every
     case green. Added **I2**, a panel built with `scrollShadows: false`.
   - **J cannot isolate either teardown.** `setAutoScroll("none")` runs
     `removeOverlayScrollbars` and then `removeScrollShadows` back to back, so a
     release placed *before* either one nulled its own field is silently rescued
     by the other's release — and a release guard that has lost one of its two
     terms is masked the same way. Three separate mutations (drop the
     `_shadowOverlay` term; release before nulling in either teardown) all left J
     green. Added **J2/J3/J4**, each driving one teardown through the
     `internals()` cast, because no public setter isolates one.
   - **K's native-with-shadows run pins reads, not listener state**, so it says
     nothing about the shadows-only teardown that *Potential Challenges* assigns
     to it. J4 is what covers that combination.

6. **Case K was satisfiable without the scroll doing anything.** `init` already
   computes the four `_shadowEdges` from the same stubbed read, so asserting them
   after a mount-then-scroll would pass whatever the scroll did. K now scrolls
   *from* a rest position whose four edges all differ from the scrolled ones, and
   uses a scroll offset where all four land on distinct, non-saturated ramp
   values (20/70/50/30), so a transposed axis cannot coincide with the right
   answer.

7. **Case O is satisfied by a plain assignment after the call**, not only by the
   `finally` the plan specifies. O now also drives a `scrollBy` that throws,
   which is the only shape that distinguishes them — and the reason the plan gives
   for the `finally` in the first place.

8. **The merged listener's own wire-once guard was untested — found by the
   audit, not by this sweep.** `## Expected Behaviour` prescribes driving the
   scroll "by invoking the merged handler through the `internals()` cast", which
   by construction cannot observe how many listeners are wired, and cases H–J
   only read private fields. So deleting `ensureScrollListener`'s
   `if (this._scrollHandler) { return; }` left the whole library suite green while
   a shadowed overlay-mode panel registered the listener **twice** — once per
   installer — reading the metrics twice per scroll, exactly the cost this change
   removes, and leaking the first handler, which `_scrollHandler` no longer holds
   for `releaseScrollListener` to remove. Deleting the `Event.addSubtreeListener`
   call outright was also silent. The guard is newly load-bearing: before this
   change each consumer had its own guard field that the other could not defeat,
   and now one shared guard mediates two independent callers. Added a
   registration-count case, following `WindowHeader.test.ts:122`'s "does not stack
   a duplicate subtree listener" convention — the count, not an observable effect,
   because `ensureScrollListener` builds a fresh arrow per call, which `Event`'s
   own identity dedupe cannot collapse. It goes red for both mutations, and for a
   same-value `setScrollbarStyle` / `setScrollShadows` refresh that re-enters both
   installers.

Case **P** already held before the change (one read each was already the
behaviour), so it is a regression guard rather than a test of new behaviour. It
does go red for a transposed `readMaxScroll`, so it is not vacuous.

### Other deviations and findings

- **The three direct child-`doLayout()` call sites in *Potential Challenges* are
  moot, not merely safe.** `ScrollStrip`'s clip (`setOverflow("hidden")`, never
  `setAutoScroll`), `AbstractChart`'s legend and `DiagramView`'s spinner set no
  `autoScroll` at all, so `remeasureScrollMetrics` already returns at its first
  line for each of the three and the new gate cannot change anything there. The
  plan's reasoning ("each of the three resizes the child first") is also not true
  of `ScrollStrip.layoutItems`, which calls `this._clip.doLayout()` with no prior
  resize — it just does not matter.

- **`[^resize-at-install]`'s justification is inaccurate mid-burst, and the
  comment restating it was corrected.** The footnote says "Every path that does
  change them ends in a layout pass, which applies the size directly from its own
  fresh read". That does not hold on a pass the resize-settle relay is
  withholding: `doLayout`'s withheld branch writes the inner scroller's size only,
  and `resolveShadowOverlaySize` / `applyShadowOverlaySize` never run. Before this
  change the scroll path papered over it by re-asserting the overlay's size on
  every scroll; now it does not, so scrolling a pane while dragging a `Split`
  gutter over it leaves the overlay and its four strips at the pre-burst box until
  the relay's catch-up. Self-correcting, `pointerEvents: none`, and no worse than
  the "single-frame staleness the gutter reservation itself tolerates" that the
  adjacent comment already accepts — so the change stands, but
  `resizeScrollShadowOverlay`'s doc comment now says so instead of repeating the
  footnote's unqualified claim. It is also the one behaviour the un-run manual
  step 5 would exercise, which is why that step is called out below.

- **The init path's native-mode read order changed, which the read-count claim
  above does not convey.** `installScrollShadows` now sizes the overlay *before*
  `init`'s `updateScrollShadows(resolved)` reads, where the old order read first
  and resized after. In native mode that read is of the panel element, whose
  `scrollHeight` the in-flow overlay floors, so the first pass's four edge
  strengths now derive from a post-resize read. This brings the init path into line
  with `remeasureScrollMetrics`'s own "size the overlay before you read" invariant
  and is a correctness improvement, but it is a behaviour change on that path, not
  only a reshuffle of two reads, and the modelled DOM cannot observe it — its
  `getScrollMetrics` is stubbed, so a write cannot change a later read.

- **The wheel path no longer routes through the two public max-scroll getters.**
  `onWheelScroll` and the clamp closure called `getMaxScrollLeft()` /
  `getMaxScrollTop()` before and call the private `readMaxScroll()` now. No library
  class overrides either getter — the only other callers are
  `ScrollStrip.mainScrollMax` and `Menu.ts:421` — so nothing in-library changes,
  and the plan's `## Public API` claim that both getters "keep their signatures and
  their answers" holds for every caller. What it does not cover is a *consumer*
  subclass overriding one to alter clamping: the wheel path would silently stop
  consulting it. The plan prescribes this shape and its `## Documentation Impact`
  fixes the doc scope at three files, so nothing was added to the changelog for it;
  if that override seam counts as part of the contract, one migration sentence is
  owed and is the user's call rather than this run's.

- **Nesting the withheld branch inside the new gate moved two side effects behind
  it, and no test pins that they are unreachable.** A skipped pass no longer calls
  `deferScrollMetricsWhileResizing`, so it neither sets `_scrollMetricsOwed` nor
  takes the overlay-mode inner-scroller size write in the `else if`. Both are safe
  by construction rather than by test: the gate only skips when `!sizeChanged`,
  while arming the relay, setting `_scrollMetricsOwed` and reaching that `else if`
  all require either `sizeChanged` or a pass the gate does not skip. Case F and
  `PanelResizeMetricsCoalescing.test.ts` cover the relay end to end, so this is a
  gap in the record rather than in coverage — recorded here so it is not mistaken
  for one that was checked by assertion.

- **`_scrollHandler` is seeded beside the settle-relay block, not beside either
  consumer's own state.** The plan says to seed it in `applyOptions`; the two
  fields it replaces were seeded immediately before the setter that reads each,
  which cannot work for a field *both* later setters' teardowns read. It is
  seeded after the settle-relay block instead, which is before `setAutoScroll` —
  the first cascade-dispatched setter whose teardowns reach
  `releaseScrollListener`.

- **Step 5's `resizeScrollShadowOverlay` call landed in step 4's commit.** Steps
  4–7 are one commit by the plan's own `[^one-plan]`, so there was nothing to
  separate. The install path's read count is unchanged by the move: `init` and
  `refreshScrollShadows` each paid two reads before (one in
  `updateScrollShadows`, one in the `resizeScrollShadowOverlay` it called) and
  pay two now (one in `installScrollShadows`, one in `updateScrollShadows`).

- **Step 4's prescribed grep cannot come out as the plan predicts.** It expects
  `_shadowScrollHandler|_overlayScrollHandler` to match "only in
  `tests/core/PanelOverlayScrollbar.test.ts`"; it also matches the new test file,
  which deliberately reads both removed fields as `undefined` for case H.

- **Step 1's refactor was mutation-tested too**, against the four `UnchangedCommit*`
  files the plan names: dropping each of `isLayoutSettled`'s three terms turns 31,
  1 and 4 of their assertions red respectively. The move is a pure refactor and
  all four files pass untouched.

- **The QA package's suite cannot run in a fresh worktree at all** until
  `npm run build:lib` has run: `packages/qa` imports `@jimka/typescript-ui/*`
  subpath exports, which resolve into `packages/lib/dist`, so 7 of its 20 test
  files fail at import resolution before that. That part is environment, not this
  branch.

- **Once it can run, this change turns five of its 453 tests red, and the plan's
  *Non-Goals* forbid the fix.** Verified both ways with the same worktree: against
  the start point's `packages/lib` the suite is 453/453, against this branch's it
  is 448 passed / 5 failed. **Four** are one mechanism — a QA ablation or witness
  that counted work the library no longer does — and the fifth is a different
  thing, which an earlier draft of this note got wrong:
  - `tests/ablations.test.ts` A11 `g16.panel-settled`, three cases. The arm patches
    the panel's own re-measure and counts what it withheld; the library now
    withholds it first, so `skipped.g16.panel-settled.remeasure` is absent rather
    than ≥ 1 (or `SMOKE_SCALE`).
  - `tests/mount.test.ts` P16 `scroll-panes`, one case. Its `pane.remeasure@ScrollPane`
    witness expects `SMOKE_SCALE` calls of `remeasureScrollMetrics` on a settled
    pass; a settled pass now makes none.
  - `tests/ablations.test.ts` A12 `g16.scroll-reads`, one case — **not** an absent
    counter but a `TypeError: Cannot read properties of undefined (reading
    'clientHeight')` thrown from `Panel.syncOverlayScrollbars`. The test invokes
    that private method through the harness's untyped reflection with no argument
    (`tests/ablations.test.ts:714-715`), and it now takes a required
    `ScrollMetrics`. Nothing in the library can reach it argument-less —
    TypeScript covers every in-library caller, and `handleScroll` is the only one
    — so this is a QA call site to update, not a library defect. It also narrows
    the choice below: "keep the arm as an inverted regression detector" is not
    available for A12 on its own, because the test throws before it could read a
    counter; that call site has to pass metrics either way.

  The first four are the end state `## Verification` step 6 predicts — "Both G16 ablations
  then have nothing left to remove and will read as unengaged. That is the
  intended end state, not a defect" — but the plan states it as an in-engine
  reading only and does not say that five `packages/qa` unit tests encode the
  same expectation and therefore fail. *Non-Goals* rules the fix out explicitly
  ("Retiring or rewriting the `g16.panel-settled` and `g16.scroll-reads`
  ablations, or editing `packages/qa` … what to do with an ablation whose
  candidate landed is the QA record's own question"), so nothing under
  `packages/qa` is touched here and the five failures are left standing for that
  decision. The two options are to retire both arms with their witnesses and
  self-tests, or to keep them as inverted regression detectors — an arm that
  engages again would mean the library had stopped withholding. Whichever is
  chosen is one small `packages/qa` change and belongs with the record, not here.
  Two `packages/qa` comments go stale with it, under the same bar:
  `src/panels/scroll-panes.ts:62` and `README.md:350` both say
  `resizeScrollShadowOverlay` and `updateScrollShadows` "are reachable from a
  scroll event alone and no layout pass calls either", and `resizeScrollShadowOverlay`
  is now reachable only from install and refresh.

### Not done, and left for the user

- **`## Verification` step 5 (manual, by eye) was not performed.** It needs a
  window, which this run is forbidden from opening. The steps to run are the
  plan's own: on the **Markdown** tab, scroll and confirm the edge shadows still
  fade in and out, the overlay thumb tracks the content, and no band is mis-sized
  or left lit at an extreme; resize the window until a scrollbar appears and
  disappears and confirm the gutter still reserves and releases; repeat the
  scroll check on a plain `Panel` on the **Grid** tab; then drag a `Split` gutter
  on a scrolling pane on the **Complex UI** tab and confirm the pane's shadows
  and thumb settle correctly when the drag stops. The last of those is the
  resize-settle relay's own path, and the one this change most needs a human eye
  on: case F covers it offline, but only against the modelled DOM.

- **`## Verification` step 6 (in engine) was not run and nothing was
  re-measured.** The record's figures stand as taken on 2026-09-25 and
  2026-09-26. Note what they are and are not: `spp`'s −99.3% on
  `seam.source.getScrollMetrics` was measured on a cell whose panes are
  `Panel` **subclasses**, which is why the arm read at all — so it bounds the
  cost this change removes, while the three W3.0 wheel cells' −50% bounds the
  scroll-read half. Both clocks were flat, and this change claims no render-time
  improvement. Both G16 ablations should now read as unengaged.

- **The read-count table in *Internal Structure* was not re-derived by
  measurement**, only by construction: the offline harness's own counts are what
  the new test file asserts (2 per live pass, 0 per settled pass, 1 per scroll, 1
  per wheel event), and they agree with the table.
