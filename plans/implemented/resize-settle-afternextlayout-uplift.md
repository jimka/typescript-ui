---
depends-on: [virtual-row-view-resize-relayout, scrollstrip-resize-resync-coalescing, panel-scroll-metrics-resize-coalescing]
touches-shared: [packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts, packages/lib/src/typescript/lib/component/container/ScrollStrip.ts, packages/lib/src/typescript/lib/core/Panel.ts]
---

# Resize-Settle `afterNextLayout` Uplift — Implementation Plan

## Overview

Three already-implemented perf fixes — [`VirtualRowView`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L605)'s row-child relayout coalescing, [`ScrollStrip`](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L562)'s scroll-resync coalescing, and [`Panel`](packages/lib/src/typescript/lib/core/Panel.ts#L734)'s scroll-metrics coalescing — each hand-roll an identical "two-hop settle relay": `scheduleXSettle` arms one `requestAnimationFrame` whose only job is to arm a second one (`armXSettleCheck`), and only that second hop (`flushXSettle`) checks whether geometry actually stopped moving. All three sites' own doc comments trace the same root cause: the real driver of a live resize (concretely `Split.flushDrag`, [Split.ts:1111](packages/lib/src/typescript/lib/layout/Split.ts#L1111)) runs its own `doLayout()` cascade from its own independently-scheduled `requestAnimationFrame`, registered by a `mousemove` that always lands *after* the settle check's own registration in the same frame — so a single-hop settle always fires one frame before the pass it means to observe.

`Component.afterNextLayout` ([Component.ts:7259](packages/lib/src/typescript/lib/core/Component.ts#L7259)) looks like the primitive built for exactly this ordering problem, and predates all three fixes. This plan verifies that claim against the actual mechanism (not just its doc comment), designs the narrower uplift that actually holds, and — while touching this code anyway — fixes a second, unrelated defect in `Panel`'s three scroll-metrics helpers: they still interleave live `DOM.source.getScrollMetrics` reads with immediate style writes, which `Panel`'s own plan explicitly deferred.

Both changes are internal refactors. No public API changes: every touched member is `private` or `protected`, and no `PanelOptions`/consumer-facing behaviour changes.

---

## Architecture Decisions

### `afterNextLayout` does not remove the need for two frames of delay — verified, not assumed

`Component.afterNextLayout`'s ordering guarantee ("runs after every dirty component in `Component`'s own coalesced flush has laid out") is scoped to `Component`'s own `scheduleLayout`-driven queue. `Split.onDrag` ([Split.ts:1076](packages/lib/src/typescript/lib/layout/Split.ts#L1076)) calls `lhs.doLayout()` / `rhs.doLayout()` directly — never `scheduleLayout()` — from `Split`'s own private `_dragRafHandle`, a completely separate `requestAnimationFrame` registration. `afterNextLayout`'s guarantee says nothing about ordering relative to that separate registration, so registering a single `afterNextLayout` call in place of today's single-hop bug reproduces the identical bug: it still races `Split.flushDrag`'s per-frame pass and always loses.[^single-hop-proof] The two-frame delay stays required at all three sites.

### The decoy hop still exists, but no longer needs its own method

`afterNextLayout`'s own doc comment states a callback that itself calls `afterNextLayout` "queues the new work for the following frame, not re-entrantly within this drain" — confirmed against its implementation and `AfterNextLayout.test.ts`'s "defers a callback registered from within a callback to the following frame" case ([AfterNextLayout.test.ts:100](packages/lib/tests/core/AfterNextLayout.test.ts#L100)). That lets the decoy hop become an anonymous callback nested inside the schedule method, instead of the separately-named `armXSettleCheck`/`armResizeSettleCheck`/`armScrollMetricsSettleCheck` method each site currently declares. Each site collapses from three private settle methods to two: `scheduleXSettle` (now arming a nested pair of `afterNextLayout` calls) and `flushXSettle` (unchanged internally).[^empirical-verification]

### The settle handle becomes a cancellable object, mirroring `Dialog`'s existing usage

`Dialog.ts` already stores an `afterNextLayout` result exactly this way: `private _resizeToContentLayout: { cancel(): void } | null = null;`, cancelled in its own teardown via `this._resizeToContentLayout?.cancel(); this._resizeToContentLayout = null;` ([Dialog.ts:661](packages/lib/src/typescript/lib/overlay/Dialog.ts#L661), [:1304](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1304)). All three sites' settle-handle field changes from `number | null` to `{ cancel(): void } | null`, and each site's `destructor()` cancellation changes from `DOM.sink.cancelAnimationFrame(handle)` to `handle?.cancel()`, following this exact precedent instead of inventing a new shape.

### A cancelled handle leaves the underlying frame queued, but inert — three existing tests assert the opposite and must change

`Component.afterNextLayout`'s `cancel()` sets an internal flag; it does not call `DOM.sink.cancelAnimationFrame`, so `Component`'s own shared flush still runs on schedule — it just skips the cancelled callback. Three existing tests assert the old, stronger claim ("the frame is actually gone from the mock queue"), which no longer holds once the handle is `Component.afterNextLayout`'s object instead of a raw frame number: [`ResizeLayoutEconomy.test.ts:397`](packages/lib/tests/component/tree/ResizeLayoutEconomy.test.ts#L397), [`ScrollStrip.resizeResyncCoalescing.test.ts:324`](packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts#L324), [`PanelResizeMetricsCoalescing.test.ts:424`](packages/lib/tests/core/PanelResizeMetricsCoalescing.test.ts#L424) each read `expect(frames.has(handle)).toBe(false); // cancelled, not merely left to no-op`. These three lines (and the `frames.has(handle)` check a few lines above each) must be replaced — see *Ordered Implementation Steps*.

### A secondary fix, in the same region: `Panel`'s three scroll-metrics helpers get a read-phase-then-write-phase split

`Panel`'s own plan named this exact gap and deferred it: "Reordering `layoutOverlayScrollbars`'s reads-before-writes... a different, riskier change." Doing it now, while the settle mechanism is already being rewritten, is cheaper than a separate pass over the same code later. The approach mirrors [`hbox-vbox-layout-calc-commit-split.md`](plans/implemented/hbox-vbox-layout-calc-commit-split.md)'s pilot — collect a resolved record from reads, then commit every write in a trailing pass — adapted to `Panel`'s shape (one remeasure call, not a per-child loop), not its API (`Panel` is not a `LayoutManager`, so there is no `resolveBounds`/`commitBounds` to route through).

Two genuine write-then-read dependencies survive the split, both already load-bearing in the current code and left exactly as interleaved as they are today:

1. **Overlay mode's inner scroller.** Its own `scrollWidth`/`scrollHeight` are floored at its `clientWidth`/`clientHeight` (documented at [Panel.ts:1510](packages/lib/src/typescript/lib/core/Panel.ts#L1510)), so it must be resized to this frame's viewport *before* its metrics are read — otherwise a shrinking panel reads the stale, larger box and reports a false overflow.
2. **Native mode's shadow overlay.** It is the panel element's only in-flow child, so a stale overlay height floors the *panel's own* `scrollHeight` (documented at [Panel.ts:634](packages/lib/src/typescript/lib/core/Panel.ts#L634)) — the overlay must be resized against the panel's current (stable) client box before the panel's own scroll extent is read for native-mode gutter detection or the shadow-edge calc.

Every other read in the current five-flush sequence is *incidental* redundancy — the same element's same properties, re-read moments later with nothing having written to it in between — and collapses cleanly.[^redundant-read-trace] The result: a single new orchestrating method, `remeasureScrollMetrics()`, used only by the per-frame `doLayout()` / `flushScrollMetricsSettle()` path, built from small resolve/commit helper pairs that the *existing* standalone callers (`init`, `refreshScrollShadows`, `refreshOverlayScrollbars`, the native `"scroll"` handler) also route through — so no logic is duplicated between the hot path and the one-shot callers.

### `measureScrollbarGutter` is deleted, not kept alongside the new method

`measureScrollbarGutter()` has exactly two callers today — `doLayout()`'s live branch and `flushScrollMetricsSettle()`'s catch-up branch — both of which this plan replaces with a call to `remeasureScrollMetrics()`. Once both callers are gone, `measureScrollbarGutter()` is dead code, so it is deleted rather than left unreachable.[^delete-not-orphan] `resizeScrollShadowOverlay()`, `updateScrollShadows()`, and `layoutOverlayScrollbars()` keep their existing names and stay reachable — each has other, non-hot-path callers (`init`, `refreshScrollShadows`, `refreshOverlayScrollbars`, the native `"scroll"` handler) that this plan does not touch.

### `DragManager.flushMove` is out of scope

`DragManager.ts`'s `flushMove` has a similar read/write interleaving issue, but it is a separate call path with its own callers and constraints; fixing it is deferred to a future plan.

---

## Internal Structure

### Shape shared by all three settle sites

Each site keeps its existing `_xSettleHandle` field name, `deferXWhileResizing` decision method, and `flushXSettle` catch-up method. Only the field's type, the schedule method's body, and the destructor's cancellation line change. Worked example using `VirtualRowView`'s names — apply the same transformation to `ScrollStrip` and `Panel` under their own names:

```typescript
// Field — was `number | null`:
private _resizeSettleHandle: { cancel(): void } | null = null;

// Schedule — was two methods (scheduleResizeSettle + armResizeSettleCheck):
/**
 * Arms the two-frame relay that ends a resize burst. The first
 * `afterNextLayout` callback is a decoy: its only job is to register the
 * second one on the *following* frame (see `Component.afterNextLayout`'s own
 * doc comment on a callback that re-arms itself), which is what survives the
 * registration-order race against the external driver's own per-frame pass
 * (e.g. `Split.flushDrag`) — see this plan's Architecture Decisions.
 */
private scheduleResizeSettle(): void {
    this._resizeSettleHandle = Component.afterNextLayout(() => {
        this._resizeSettleHandle = Component.afterNextLayout(() => this.flushResizeSettle());
    });
}

// flushResizeSettle: UNCHANGED body. Only the field's type changed, and
// `this._resizeSettleHandle = null;` at its top still type-checks.

// Destructor cancellation — was:
//   if (this._resizeSettleHandle !== null) {
//       DOM.sink.cancelAnimationFrame(this._resizeSettleHandle);
//       this._resizeSettleHandle = null;
//   }
// becomes:
this._resizeSettleHandle?.cancel();
this._resizeSettleHandle = null;
```

`armResizeSettleCheck` (and `ScrollStrip`'s `armResizeSettleCheck`, and `Panel`'s `armScrollMetricsSettleCheck`) is deleted — its entire body is now the anonymous callback nested inside `scheduleResizeSettle`.

`Panel`'s `_scrollMetricsSettleHandle` field stays `declare`d (per `CODE_CONVENTIONS.md`'s `super()`-cascade rule, already applied to this field) — only its type changes, from `declare private _scrollMetricsSettleHandle: number | null;` to `declare private _scrollMetricsSettleHandle: { cancel(): void } | null;`.

`VirtualRowView.ts` and `ScrollStrip.ts` already `import { Component } ...`. `Panel.ts` does not — add `import { Component } from "~/core/Component.js";` to its import block.

### Panel's read-phase-then-write-phase remeasure

New module-level type, declared near the top of `Panel.ts` (mirroring where `ResolvedPlacement` sits in `LayoutManager.ts` — top-level, immediately usable by the class, not exported since nothing outside `Panel.ts` needs it):

```typescript
/** Resolved from `measureOverlayLayout`'s one necessary write-then-read (see
 *  its own doc comment); `commitOverlayLayout` applies every write from it. */
interface OverlayLayoutResolution {
    innerW: number;
    innerH: number;
    /** The inner scroller's post-resize metrics — reused for the shadow-edge
     *  calc too, so nothing re-reads it. */
    m: ScrollMetrics;
    needsReinset: boolean;
    newRight: number;
    newBottom: number;
}
```

Add `ScrollMetrics` to the existing type-only import: `import type { Handle, ScrollMetrics } from "~/core/DOM.js";`.

Eight small methods, each doing exactly one job (resolve = pure calc from given data, no DOM read or write; commit/apply = writes only):

```typescript
/**
 * Resizes the inner scroller to `avail` (the panel's own client box) minus
 * the currently-cached gutter, then reads the scroller's own post-resize
 * metrics. This read must follow that write: the scroller's `scrollWidth`/
 * `scrollHeight` are floored at its own `clientWidth`/`clientHeight`, so
 * reading them against the *previous* pass's box would report stale overflow
 * on a shrink. Returns null when the overlay scrollbars aren't installed yet.
 */
private measureOverlayLayout(avail: ScrollMetrics): OverlayLayoutResolution | null {
    const innerEl = this._overlayScrollElement;
    if (!innerEl || !this._scrollbarV || !this._scrollbarH) {
        return null;
    }

    const trackW    = this._scrollbarV.getTrackWidth();
    const availW    = avail.clientWidth;
    const availH    = avail.clientHeight;
    const curRight  = this._scrollbarGutter.right;
    const curBottom = this._scrollbarGutter.bottom;

    this._overlayScrollStyle.setMany({
        width:  (availW - curRight)  + "px",
        height: (availH - curBottom) + "px",
    });

    const m    = DOM.source.getScrollMetrics(innerEl);
    const axes = this.scrollableAxes();

    const vVisible = axes.y && m.scrollHeight > m.clientHeight;
    const hVisible = axes.x && m.scrollWidth  > m.clientWidth;

    const innerW = availW - (vVisible ? trackW : 0);
    const innerH = availH - (hVisible ? trackW : 0);

    return {
        innerW, innerH, m,
        needsReinset: innerW !== availW - curRight || innerH !== availH - curBottom,
        newRight:  vVisible ? trackW : 0,
        newBottom: hVisible ? trackW : 0,
    };
}

/** Applies every write `measureOverlayLayout` resolved. Pure writes — no read. */
private commitOverlayLayout(resolution: OverlayLayoutResolution): void {
    const { innerW, innerH, m, needsReinset, newRight, newBottom } = resolution;

    if (needsReinset) {
        this._overlayScrollStyle.setMany({ width: innerW + "px", height: innerH + "px" });
    }

    this._scrollbarV?.setX(innerW);
    this._scrollbarV?.setY(0);
    this._scrollbarV?.setHeight(innerH);
    this._scrollbarV?.setMetrics(innerH, m.scrollHeight, m.scrollTop);

    this._scrollbarH?.setX(0);
    this._scrollbarH?.setY(innerH);
    this._scrollbarH?.setWidth(innerW);
    this._scrollbarH?.setMetrics(innerW, m.scrollWidth, m.scrollLeft);

    this.commitScrollbarGutterIfChanged(newRight, newBottom);
}

/** Pure calc: the native-mode gutter for the given (already-read) panel metrics. */
private resolveNativeGutter(metrics: ScrollMetrics): { right: number; bottom: number } {
    const trackW = DOM.source.getScrollBarWidth();
    if (trackW === 0) {
        return { right: this._scrollbarGutter.right, bottom: this._scrollbarGutter.bottom };
    }
    if (this._autoScroll === "both") {
        return { right: trackW, bottom: trackW };
    }
    const axes = this.scrollableAxes();
    return {
        right:  axes.y && metrics.scrollHeight > metrics.clientHeight ? trackW : 0,
        bottom: axes.x && metrics.scrollWidth  > metrics.clientWidth  ? trackW : 0,
    };
}

/** Shared write, used by both the overlay and native gutter paths. */
private commitScrollbarGutterIfChanged(right: number, bottom: number): void {
    if (right === this._scrollbarGutter.right && bottom === this._scrollbarGutter.bottom) {
        return;
    }
    this.setScrollbarGutter(right, bottom);
    this.scheduleLayout();
}

/** Pure calc: the shadow overlay's target size for the given panel client box. */
private resolveShadowOverlaySize(clientWidth: number, clientHeight: number): { width: number; height: number } | null {
    if (!this._shadowOverlay) {
        return null;
    }
    const rightInset  = this._scrollbarStyle === "overlay" ? this._scrollbarGutter.right  : 0;
    const bottomInset = this._scrollbarStyle === "overlay" ? this._scrollbarGutter.bottom : 0;
    return { width: clientWidth - rightInset, height: clientHeight - bottomInset };
}

private applyShadowOverlaySize(size: { width: number; height: number }): void {
    this._shadowOverlayStyle.setMany({ width: size.width + "px", height: size.height + "px" });
}

/** Pure calc: the four edge strengths for the given (already-read) scroll metrics. */
private resolveShadowEdges(metrics: ScrollMetrics): { top: number; bottom: number; left: number; right: number } | null {
    if (!this._shadowOverlay) {
        return null;
    }
    const maxTop  = metrics.scrollHeight - metrics.clientHeight;
    const maxLeft = metrics.scrollWidth  - metrics.clientWidth;
    const axes    = this.scrollableAxes();
    return {
        top:    axes.y ? scrollShadowRamp(metrics.scrollTop)             : 0,
        bottom: axes.y ? scrollShadowRamp(maxTop  - metrics.scrollTop)   : 0,
        left:   axes.x ? scrollShadowRamp(metrics.scrollLeft)            : 0,
        right:  axes.x ? scrollShadowRamp(maxLeft - metrics.scrollLeft)  : 0,
    };
}

private applyShadowEdges(edges: { top: number; bottom: number; left: number; right: number }): void {
    this.setShadowEdge("top",    "--ts-ss-top",    edges.top);
    this.setShadowEdge("bottom", "--ts-ss-bottom", edges.bottom);
    this.setShadowEdge("left",   "--ts-ss-left",   edges.left);
    this.setShadowEdge("right",  "--ts-ss-right",  edges.right);
}
```

The three **existing** methods become thin wrappers over these, preserving their current external behaviour and their own standalone callers exactly:

```typescript
private resizeScrollShadowOverlay(element?: Handle): void {
    const el = element ?? this.getElement();
    if (!el) return;
    const { clientWidth, clientHeight } = DOM.source.getScrollMetrics(el);
    const size = this.resolveShadowOverlaySize(clientWidth, clientHeight);
    if (size) this.applyShadowOverlaySize(size);
}

private layoutOverlayScrollbars(element?: Handle): void {
    const panelEl = element ?? this.getElement();
    if (!panelEl) return;
    const avail = DOM.source.getScrollMetrics(panelEl);
    const resolution = this.measureOverlayLayout(avail);
    if (resolution) this.commitOverlayLayout(resolution);
}

private updateScrollShadows(element?: Handle): void {
    const el = element ?? this.getElement();
    if (!el || !this._shadowOverlay) return;
    const metrics = DOM.source.getScrollMetrics(this.getScrollElement() ?? el);
    this.resizeScrollShadowOverlay(el);
    const edges = this.resolveShadowEdges(metrics);
    if (edges) this.applyShadowEdges(edges);
}
```

`measureScrollbarGutter()` is **deleted** (see *Architecture Decisions*).

### `remeasureScrollMetrics` — the new hot-path orchestrator

Replaces the `resizeScrollShadowOverlay(); measureScrollbarGutter(); updateScrollShadows();` triplet at both call sites (`doLayout`'s live branch, `flushScrollMetricsSettle`'s catch-up branch):

```typescript
/**
 * The post-layout scroll-metrics remeasure, restructured into a read phase
 * and a write phase: this panel's own box is read once, every derived value
 * is resolved from it, and every write is applied in a trailing pass. Two
 * exceptions keep their own interleaved read-after-write, because the read
 * genuinely depends on the write's effect: overlay mode's inner scroller
 * (inside {@link measureOverlayLayout}) and native mode's shadow overlay,
 * handled inline below — see this plan's Architecture Decisions for why
 * each one is unavoidable.
 */
private remeasureScrollMetrics(): void {
    if (this._autoScroll === "none") {
        return;
    }

    const el = this.getElement();
    if (!el) {
        return;
    }

    const avail = DOM.source.getScrollMetrics(el);
    let shadowMetrics: ScrollMetrics = avail;

    if (this._scrollbarStyle === "overlay") {
        const resolution = this.measureOverlayLayout(avail);
        if (resolution) {
            this.commitOverlayLayout(resolution);
            shadowMetrics = resolution.m;
        }
    } else {
        // The shadow overlay is this panel's own in-flow child, so a stale
        // height floors this panel's own scrollHeight/scrollWidth (see
        // Architecture Decisions). Size it against the current, stable
        // client box first, and only re-read when that write actually
        // happened (no overlay installed means nothing to floor).
        const preSize = this.resolveShadowOverlaySize(avail.clientWidth, avail.clientHeight);
        if (preSize) {
            this.applyShadowOverlaySize(preSize);
            shadowMetrics = DOM.source.getScrollMetrics(el);
        }

        const gutter = this.resolveNativeGutter(shadowMetrics);
        this.commitScrollbarGutterIfChanged(gutter.right, gutter.bottom);
    }

    // The gutter may have just changed; size the overlay against the FINAL
    // value. `avail.clientWidth/clientHeight` are still current — nothing
    // above wrote to this panel's own box.
    const finalSize = this.resolveShadowOverlaySize(avail.clientWidth, avail.clientHeight);
    if (finalSize) {
        this.applyShadowOverlaySize(finalSize);
    }

    const edges = this.resolveShadowEdges(shadowMetrics);
    if (edges) {
        this.applyShadowEdges(edges);
    }
}
```

`doLayout()`'s live branch (currently `resizeScrollShadowOverlay(); measureScrollbarGutter(); updateScrollShadows();`) becomes `this.remeasureScrollMetrics();`. `flushScrollMetricsSettle()`'s catch-up branch (the same three calls) becomes the same single call. `doLayout()`'s own doc comment, which currently names the three old methods in prose, is updated to name `remeasureScrollMetrics` instead (prose only — none of these are public symbols, so no `{@link}` either way, matching the existing convention this file already follows for exactly this reason).

### Read count, before and after

| `scrollbarStyle` | `scrollShadows` | `autoScroll` | Reads before | Reads after |
|---|---|---|---|---|
| overlay (default) | `true` | not `"none"` | 5 | 2 |
| overlay | `false` | not `"none"` | 2 | 2 |
| native | `true` | not `"both"`, not `"none"` | 4 | 2 |
| native | `true` | `"both"` | 3 | 2 |
| native | `false` | not `"both"`, not `"none"` | 1 | 1 |
| native | `false` | `"both"` | 0 | 1[^both-no-shadow-tradeoff] |
| any | any | `"none"` | 0 | 0 |

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`** — change `_resizeSettleHandle`'s type at [:79](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L79) from `number | null` to `{ cancel(): void } | null`. Replace `scheduleResizeSettle` ([:660-662](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L660)) and delete `armResizeSettleCheck` ([:670-672](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L670)) per *Internal Structure*'s worked example. Update `destructor`'s cancellation ([:158-161](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L158)) to `this._resizeSettleHandle?.cancel(); this._resizeSettleHandle = null;`. Leave `deferRowLayoutWhileResizing` and `flushResizeSettle` untouched. `Component` is already imported.

2. **`packages/lib/src/typescript/lib/component/container/ScrollStrip.ts`** — same transformation: `_resizeSettleHandle`'s type at [:203](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L203), `scheduleResizeSettle`/delete `armResizeSettleCheck` at [:605-617](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L605), destructor cancellation at [:1023-1026](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L1023). Leave `deferScrollResyncWhileResizing`, `flushResizeSettle`, `layoutItems`, `layoutArrows`, and `mainScroll` untouched. `Component` is already imported.

3. **`packages/lib/src/typescript/lib/core/Panel.ts`** — add `import { Component } from "~/core/Component.js";` to the import block (after the `Container` import). Add `ScrollMetrics` to the existing `import type { Handle } from "~/core/DOM.js";` line, making it `import type { Handle, ScrollMetrics } from "~/core/DOM.js";`. Change `_scrollMetricsSettleHandle`'s type at [:259](packages/lib/src/typescript/lib/core/Panel.ts#L259) from `number | null` to `{ cancel(): void } | null` (keep `declare`). Replace `scheduleScrollMetricsSettle`/delete `armScrollMetricsSettleCheck` at [:780-792](packages/lib/src/typescript/lib/core/Panel.ts#L780) per *Internal Structure*. Update `destructor`'s cancellation at [:943-946](packages/lib/src/typescript/lib/core/Panel.ts#L943) to `this._scrollMetricsSettleHandle?.cancel(); this._scrollMetricsSettleHandle = null;`. Leave `deferScrollMetricsWhileResizing` and `flushScrollMetricsSettle` entirely untouched for now — its three-call catch-up is rewired in step 7, once `remeasureScrollMetrics` exists.

4. **`Panel.ts`** — add the `OverlayLayoutResolution` interface near the top of the file (immediately above the class, mirroring where `PanelOptions` sits). Body in *Internal Structure*.

5. **`Panel.ts`** — add the eight new private methods (`measureOverlayLayout`, `commitOverlayLayout`, `resolveNativeGutter`, `commitScrollbarGutterIfChanged`, `resolveShadowOverlaySize`, `applyShadowOverlaySize`, `resolveShadowEdges`, `applyShadowEdges`) directly after `showsScrollAffordance()` ([:890-897](packages/lib/src/typescript/lib/core/Panel.ts#L890)), in the order listed. Bodies in *Internal Structure*.

6. **`Panel.ts`** — add `remeasureScrollMetrics()` directly after the eight methods from step 5. Body in *Internal Structure*.

7. **`Panel.ts`** — wire the new method in at both call sites, now that it exists: replace `doLayout()`'s live-branch triplet ([:658-665](packages/lib/src/typescript/lib/core/Panel.ts#L658): `this.resizeScrollShadowOverlay(); this.measureScrollbarGutter(); this.updateScrollShadows();`) with `this.remeasureScrollMetrics();`, and replace `flushScrollMetricsSettle`'s three-call catch-up ([:817-819](packages/lib/src/typescript/lib/core/Panel.ts#L817)) the same way. Update `doLayout()`'s doc comment (currently naming the three old methods in prose at [:622-624](packages/lib/src/typescript/lib/core/Panel.ts#L622)) to name `remeasureScrollMetrics` instead — prose, no `{@link}` (none of these are public symbols; see `CODE_CONVENTIONS.md`'s `{@link}` rule, which this file already follows for the same reason). After this step, `measureScrollbarGutter` has no remaining callers.

8. **`Panel.ts`** — replace `resizeScrollShadowOverlay` ([:1182-1207](packages/lib/src/typescript/lib/core/Panel.ts#L1182)), `updateScrollShadows` ([:1220-1254](packages/lib/src/typescript/lib/core/Panel.ts#L1220)), and `layoutOverlayScrollbars` ([:1490-1568](packages/lib/src/typescript/lib/core/Panel.ts#L1490)) with the thin-wrapper versions in *Internal Structure*. Delete `measureScrollbarGutter` ([:995-1045](packages/lib/src/typescript/lib/core/Panel.ts#L995)) entirely — safe now that step 7 removed its only two callers.

9. **Checkpoint** — `grep -n 'measureScrollbarGutter' packages/lib/src/typescript/lib/core/Panel.ts` — expect zero matches. `grep -rn 'DOM.sink.requestAnimationFrame\|DOM.sink.cancelAnimationFrame' packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts packages/lib/src/typescript/lib/component/container/ScrollStrip.ts packages/lib/src/typescript/lib/core/Panel.ts` — expect zero matches in all three files (every remaining call site now goes through `Component.afterNextLayout`). `npm run typecheck` — clean.

10. **Fix the three tests that assert the old, stronger cancellation contract** (see Architecture Decisions):
    - [`packages/lib/tests/component/tree/ResizeLayoutEconomy.test.ts`](packages/lib/tests/component/tree/ResizeLayoutEconomy.test.ts), the "disposing the tree mid-burst cancels the settle frame" case (around [:374-402](packages/lib/tests/component/tree/ResizeLayoutEconomy.test.ts#L374)): delete `expect(frames.size).toBe(0);` at [:397](packages/lib/tests/component/tree/ResizeLayoutEconomy.test.ts#L397) and its preceding comment. The case's remaining assertions (`runFrames()` doesn't throw, `renderWindowSpy` not called, `totalCalls(layoutSpies)` is `0`) already prove the cancelled callback never ran — that is now the whole check.
    - [`packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts`](packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts), the "cancels an armed settle frame on teardown" case (around [:309-326](packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts#L309)): `handle` is no longer a raw frame-queue key, so `frames.has(handle)` (both the before-dispose check at [:320](packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts#L320) and the after-dispose check at [:324](packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts#L324)) no longer means anything. Replace both with: before dispose, `expect((strip as any)._resizeSettleHandle).not.toBeNull();`; after dispose, `expect((strip as any)._resizeSettleHandle).toBeNull();` (already true today — the destructor still nulls the field) plus `expect(syncSpy).not.toHaveBeenCalled(); expect(refreshSpy).not.toHaveBeenCalled();` after `drainFrames()`, to positively confirm the cancelled callback's effects never ran (this file already has `syncSpy`/`refreshSpy` spies from earlier in the file).
    - [`packages/lib/tests/core/PanelResizeMetricsCoalescing.test.ts`](packages/lib/tests/core/PanelResizeMetricsCoalescing.test.ts), the "cancels an armed settle frame on teardown" case (around [:408-426](packages/lib/tests/core/PanelResizeMetricsCoalescing.test.ts#L408)): same fix — replace the `frames.has(handle as number)` before/after checks with `expect(internals(panel)._scrollMetricsSettleHandle).not.toBeNull();` before dispose and `.toBeNull()` after, and add `const before = spy.mock.calls.length; ... drainFrames(); expect(spy.mock.calls.length).toBe(before);` (using the file's existing `stubMetrics()` spy) to confirm no `getScrollMetrics` call happened from the cancelled callback.

11. **Update the handle-type casts in the six affected test files** so they match the new field type: `ResizeLayoutEconomy.test.ts`, `ResizeLayoutEconomyRealtime.test.ts`, `ScrollStrip.resizeResyncCoalescing.test.ts`, `ScrollStrip.resizeResyncCoalescingRealtime.test.ts`, `PanelResizeMetricsCoalescing.test.ts`, `PanelResizeMetricsCoalescingRealtime.test.ts` each cast the settle-handle field as `number | null` somewhere (e.g. `PanelResizeMetricsCoalescingRealtime.test.ts:90`'s `type ScrollMetricsInternals = { _scrollMetricsSettleHandle: number | null };`). Change every such annotation to `{ cancel(): void } | null`. Checkpoint: `grep -rn 'SettleHandle: number | null' packages/lib/tests/` — expect zero matches.

12. **Write a new realtime test per site**, mirroring `ResizeLayoutEconomyRealtime.test.ts`'s existing template exactly (same frame-capture harness, same `advanceDragFrame`-style helper that drains queued frames *before* running the frame's real `doLayout()` pass) but driving the settle through `Component.afterNextLayout` instead of a raw mocked `requestAnimationFrame` queue. Since `Component.afterNextLayout` schedules through `DOM.sink.requestAnimationFrame` internally, the *same* mock harness captures it — no new mocking is needed, only new assertions confirming the two-hop-via-`afterNextLayout` shape still withholds through a multi-frame burst and catches up exactly once. Add these as new `it` cases inside each site's *existing* realtime file (`ResizeLayoutEconomyRealtime.test.ts`, `ScrollStrip.resizeResyncCoalescingRealtime.test.ts`, `PanelResizeMetricsCoalescingRealtime.test.ts`) rather than new files — the existing cases in each already exercise this exact scenario end-to-end and should keep passing unmodified; add one case per file that additionally drives a *longer* burst (15-20 frames, not the existing files' shorter ones) to match the empirical verification this plan itself ran (see Notes) and guard against a regression to the single-hop bug specifically.

13. **Typecheck, lint, test.** `npm run typecheck`, `npm run lint`, then the commands in *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/ScrollStrip.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Panel.ts` |
| Modify | `packages/lib/tests/component/tree/ResizeLayoutEconomy.test.ts` |
| Modify | `packages/lib/tests/component/tree/ResizeLayoutEconomyRealtime.test.ts` |
| Modify | `packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts` |
| Modify | `packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescingRealtime.test.ts` |
| Modify | `packages/lib/tests/core/PanelResizeMetricsCoalescing.test.ts` |
| Modify | `packages/lib/tests/core/PanelResizeMetricsCoalescingRealtime.test.ts` |

---

## Expected Behaviour

### Settle mechanism (all three sites) — unit-testable, offline

1. **Every existing case in `ResizeLayoutEconomy(Realtime).test.ts`, `ScrollStrip.resizeResyncCoalescing(Realtime).test.ts`, and `PanelResizeMetricsCoalescing(Realtime).test.ts` still passes**, except the two teardown assertions named in step 10 and the type-cast updates in step 11. The withhold/catch-up/extend-the-burst semantics are unchanged — only the mechanism producing the two-frame delay changed.
2. **A cancelled settle handle's callback never runs**, whether or not the underlying `Component`-shared flush still fires: after `destructor()` runs mid-burst, draining every remaining frame calls none of the withheld work (no `renderWindow`/`layoutChildren`, no `syncScrollOffsets`/`refreshArrows`, no `getScrollMetrics`) and throws nothing.
3. **A burst that keeps moving for many frames (15-20+) is withheld throughout**, not just for the first few frames — the new longer-burst case from step 12. This is the case that would have caught the original single-hop bug and would catch a regression to it.
4. **The settle mechanism still resolves during the startup font-loading hold.** `Component.afterNextLayout`'s callback is deferred, not dropped, while `isFirstLayoutHeld()` — a behaviour the old raw-`requestAnimationFrame` version did not have. This is a manual-verify item (the offline harness's `installTestDOM` does not model the startup gate); no regression risk since it is strictly more correct than before.

### Panel's remeasure restructuring — unit-testable, offline

5. **Every existing case in `PanelResizeMetricsCoalescing(Realtime).test.ts` still passes with no changes beyond steps 10-11** — the restructuring changes *how many times* `getScrollMetrics` is called, never the resulting gutter, overlay size, or shadow-edge values.
6. **New case: the default configuration (`scrollbarStyle: "overlay"`, `scrollShadows: true`) calls `getScrollMetrics` exactly 2 times per live pass**, down from 5 (see the *Internal Structure* table). Spy on `DOM.source.getScrollMetrics` and assert the call-count delta for one live `doLayout()` pass.
7. **New case: `scrollbarStyle: "native"`, `scrollShadows: true`, `autoScroll: "auto"` calls `getScrollMetrics` exactly 2 times per live pass**, down from 4.
8. **New case: shrinking a native-mode, shadow-enabled panel still correctly clears an over-reserved gutter** — the specific bug the write-before-read ordering in `remeasureScrollMetrics`'s native branch exists to avoid. Grow a panel's content past its viewport (gutter reserved), then shrink the content back within it in one pass: the gutter clears to `0` on that same pass, not one pass later. (This is the regression `doLayout`'s original doc comment names — pin it explicitly, since the restructuring is exactly the code most likely to reintroduce it if the ordering slips.)
9. **`autoScroll: "none"` panels still make zero `getScrollMetrics` calls** and never call `Component.afterNextLayout` — unchanged short-circuit, same as the existing suite's case 6.

### Manual-verify

- Dragging a `Split` gutter over a `Tree`, an overflowing `TabBar`, and a scrollable `Panel` remains at least as smooth as it is today (this plan changes *how* the coalescing is expressed, not its frequency) — spot-check with a WebKit/Chrome performance trace of a gutter drag, comparing forced-`Layout` event counts against the pre-uplift baselines each original plan's Implementation Notes recorded (VirtualRowView: 2/40 live passes; ScrollStrip: 3/50; Panel: 3/50 forced-layout-pair reduction).
- On release, every settled value (row layout, scroll offset/arrow state, scrollbar gutter/overlay geometry/shadow edges) is correct for the final size — no stuck stale frame.

---

## Verification

- **Typecheck:** `npm run typecheck` (clean).
- **Lint:** `npm run lint` (clean).
- **Unit tests:** from `packages/lib`:
  ```
  npx vitest run tests/component/tree/ResizeLayoutEconomy.test.ts tests/component/tree/ResizeLayoutEconomyRealtime.test.ts \
    tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts tests/component/container/ScrollStrip.resizeResyncCoalescingRealtime.test.ts \
    tests/component/container/ScrollStrip.test.ts tests/component/container/TabBar.test.ts \
    tests/core/PanelResizeMetricsCoalescing.test.ts tests/core/PanelResizeMetricsCoalescingRealtime.test.ts \
    tests/core/PanelGutterSettle.test.ts tests/core/PanelOverlayScrollbar.test.ts tests/core/PanelScrollChaining.test.ts \
    tests/core/AfterNextLayout.test.ts tests/overlay/Dialog.test.ts tests/component/code-editor.test.ts
  ```
  all green.
- **Full suite:** `npm run test` from `packages/lib` — `Panel` is the base class of nearly every scrollable component, so the full suite is the honest regression gate (matching `Panel`'s own original plan's verification step).
- **Grep invariants:** the checkpoints in step 9 and step 11.
- **Build:** `npm run build:lib` succeeds.
- **Manual live:** per the manual-verify bullets in *Expected Behaviour*, using `npm run docs:dev` or the sibling Loom app.

---

## Potential Challenges

- **A subclass of `Panel` overriding one of the four touched methods.** Confirmed via `grep -rln 'resizeScrollShadowOverlay\|updateScrollShadows\|layoutOverlayScrollbars\|measureScrollbarGutter' packages/lib/src/typescript/lib/` at drafting time: only `Panel.ts` defines or calls these — no subclass overrides any of them. Re-run this grep after step 8 to confirm it still holds.
- **Losing the native-mode write-before-read ordering by accident during the split.** This is exactly what Expected Behaviour case 8 exists to catch — do not skip it.
- **A test asserting the old `number`-typed handle shape.** Step 11's grep checkpoint exists specifically to catch every remaining occurrence.
- **The `"both"` + `scrollShadows: false` combination now costs one `getScrollMetrics` call it didn't before** (see the *Internal Structure* table's footnote). This is a deliberate, documented trade-off, not an oversight — do not add a special case for it.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `afterNextLayout` ([:7259](packages/lib/src/typescript/lib/core/Component.ts#L7259)) and `flushPendingLayouts`/`ensureFlushScheduled` ([:174-252](packages/lib/src/typescript/lib/core/Component.ts#L174)): read both before touching any settle site — the whole design rests on exactly how these interact with `pendingLayouts`/`afterLayoutCallbacks`.
- [`packages/lib/tests/core/AfterNextLayout.test.ts`](packages/lib/tests/core/AfterNextLayout.test.ts) — the re-arm-defers-to-the-following-frame contract this plan's `scheduleXSettle` depends on ([:100-113](packages/lib/tests/core/AfterNextLayout.test.ts#L100)).
- [`packages/lib/src/typescript/lib/overlay/Dialog.ts`](packages/lib/src/typescript/lib/overlay/Dialog.ts) — the existing `{ cancel(): void } | null` handle-field precedent ([:661-662](packages/lib/src/typescript/lib/overlay/Dialog.ts#L661), [:1304-1307](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1304)).
- [`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts) — `onDrag`/`scheduleDrag`/`flushDrag` ([:1030-1123](packages/lib/src/typescript/lib/layout/Split.ts#L1030)): confirms the real driver calls `doLayout()` directly, never `scheduleLayout()`, which is why the two-frame delay survives this uplift.
- `plans/implemented/virtual-row-view-resize-relayout.md`, `plans/implemented/scrollstrip-resize-resync-coalescing.md`, `plans/implemented/panel-scroll-metrics-resize-coalescing.md` — each contains, in its own `## Implementation Notes`, the original single-hop-bug discovery this plan's Architecture Decisions rely on; read all three before starting.
- [`packages/lib/tests/component/tree/ResizeLayoutEconomyRealtime.test.ts`](packages/lib/tests/component/tree/ResizeLayoutEconomyRealtime.test.ts) — the per-frame-simulation template step 12's new cases must follow.
- [`plans/implemented/hbox-vbox-layout-calc-commit-split.md`](plans/implemented/hbox-vbox-layout-calc-commit-split.md) — the calc/commit-split precedent `Panel`'s restructuring mirrors in shape.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the `DOM.sink`/`DOM.source` seam (no raw DOM access added or removed by this plan) and the `super()`-cascade `declare` rule `Panel`'s settle field must keep following.

---

## Non-Goals

- **`DragManager.flushMove`'s own read/write interleaving** — a separate call path with its own callers; a candidate for a future plan, not this one.
- **`Split.flushDrag` itself** — not touched. It is the external driver every settle site defends against, not part of the settle mechanism.
- **Reducing the two-frame settle latency.** Verified unavoidable given the actual driver (`Split.flushDrag`'s independent `requestAnimationFrame`); `afterNextLayout` changes *how* the delay is expressed, not its length.
- **Any change to `Accordion`'s own gutter-drag coalescing** or any other per-frame coalescing site not named above — out of scope.

---

## Implementation Notes

- **The plan's mechanism transformation (steps 1-9) matched the codebase exactly as specified**, with no drift beyond ordinary line-number shift: `Component.afterNextLayout`'s contract, `Dialog.ts`'s `{ cancel(): void } | null` handle precedent, and the `Split.flushDrag` registration-order race were all re-verified against current source before editing.

- **BLOCKING (found via the test suite, not anticipated by the plan): moving all three settle relays onto `Component`'s shared `afterNextLayout`/`scheduleLayout` flush queue introduced a cross-test state leak the plan's own test-file changes (steps 10-12) did not account for.** Pre-uplift, each site's settle relay used its own independent, raw `DOM.sink.requestAnimationFrame` handle, decoupled from `Component`'s module-level `pendingLayouts`/`afterLayoutCallbacks`/`rafHandle`. Post-uplift, every arm routes through that shared state, so a test that leaves a relay mid-flight when it ends — never draining its own locally-mocked `requestAnimationFrame` to quiescence — leaves `rafHandle` non-null for the rest of that test *file*: the next test's own `scheduleXSettle()` call finds `ensureFlushScheduled()`'s `rafHandle === null` guard already false and silently skips registering a fresh frame, so its own relay never resolves. Fixed by draining to quiescence in `afterEach`, not just within individual test bodies, in `ResizeLayoutEconomy(Realtime).test.ts`, `ScrollStrip.resizeResyncCoalescing(Realtime).test.ts`, and `PanelResizeMetricsCoalescing(Realtime).test.ts`.

- **BLOCKING: the same leak also broke two test files outside the plan's own "Files to Modify" list, found only by running the full `npm run test` suite (7259 tests) rather than the plan's named Verification subset.** `PanelOverlayScrollbar.test.ts` and `FirstLayoutGate.test.ts` both construct autoScroll-enabled `Panel`/`Tree`/`Table` instances that arm a settle relay as a side effect, and neither file's shared teardown drained `Component`'s flush queue to quiescence (one didn't capture `requestAnimationFrame` at the file level at all; the other called its own single-pass `flushFrame()` once in `afterEach` — one hop short of the two a relay needs, since a callback registered from within a callback defers to the *following* frame). Fixed the same way: `PanelOverlayScrollbar.test.ts` gained a file-level capturing `requestAnimationFrame` spy plus a to-quiescence drain in `afterEach` (individual tests that need to drive frames explicitly already install their own local override, which simply shadows the file-level one for their duration); `FirstLayoutGate.test.ts`'s existing `afterEach` comment already named this exact hazard by name ("a test that left the gate armed would otherwise ... leave the module-level rafHandle set"), but its pre-existing single `flushFrame()` predated this plan and was one hop short — changed to loop to quiescence.

- **BLOCKING: `PanelOverlayScrollbar.test.ts`'s "re-sizes the inner scroller to the CURRENT panel viewport" case needed a real fix, not just a drain.** It drives a resize purely by changing what `getScrollMetrics` is mocked to return, never calling `panel.setWidth()`/`setHeight()` — harmless pre-uplift, since the settle relay's own raw timer never touched the panel's actual committed size. Post-uplift, `this.getWidth()` stays permanently `NaN` (never seeded), and `deferScrollMetricsWhileResizing`'s `width !== this._lastPanelWidth` check reads `NaN !== NaN` — always `true` in JS — as "size changed" on every pass, forever; combined with the newly-shared coalesced flush (a live pass's own `commitScrollbarGutterIfChanged` → `scheduleLayout()` call can now land in the same flush as the just-armed decoy hop), the relay perpetually re-extended instead of settling, and a withheld pass wrote the inner scroller from the panel's own (`NaN`) size instead of the mocked viewport, producing `"NaNpx"`. Fixed by driving real, changing widths through `panel.setWidth()` alongside each mocked-metrics change, matching how every other test in the suite exercises a resize. Confirmed correct via a scratch mutation (swapping `remeasureScrollMetrics`'s native-branch `resolveNativeGutter(shadowMetrics)` for `resolveNativeGutter(avail)`) against the fixed test: it failed exactly as expected, then was reverted.

- **A related, narrower timing effect was traced but left as documented, non-blocking behaviour, matching this plan's own "Non-Goals: Reducing the two-frame settle latency" boundary.** Because `scheduleLayout()`-driven flushes and the settle relay's own `afterNextLayout` hops now share one coalesced clock, a first-of-burst live pass whose own remeasure changes the scrollbar gutter can have its `scheduleLayout()` call land in the same animation frame as the just-armed decoy hop; `flushPendingLayouts()` processes dirty components before after-layout callbacks, so this produces one extra, synchronous `doLayout()` pass ahead of the decoy hop's own resolution. With real (non-`NaN`) committed sizes this extra pass correctly reads as "size unchanged" and is withheld like any other mid-relay pass — one redundant but idempotent, eventually-consistent remeasure, never a stuck state or an incorrect final value. Not fixed further: decoupling it would mean changing `scheduleLayout()`'s own flush timing relative to the settle relay's, which is exactly the latency change the plan's Non-Goals rules out.

- **New Panel test coverage beyond the Ordered Implementation Steps' explicit list, required by Expected Behaviour items 6-8 (the read-count reduction and the native-gutter-clearing regression), which those steps did not separately enumerate as test-writing work.** Added three cases to `PanelResizeMetricsCoalescing.test.ts`: exact `getScrollMetrics` call counts (2, down from 5/4) for the default overlay and native+shadows configurations, and a regression test for the native-mode write-before-read ordering — confirmed via the same kind of scratch mutation noted above (swapping `shadowMetrics` for `avail` at the one call site) that the new test fails exactly as intended.

- **A handful of stale prose comments referencing the deleted `measureScrollbarGutter`/`armXSettleCheck` were updated for accuracy**, in `Panel.ts` itself, the unrelated `component/display/Markdown.ts` (a comment analogising to `Panel.doLayout`'s pre-remeasure flush), and the affected test files' own header comments — none change behaviour; all were left pointing at now-nonexistent method names by the rename/deletion steps.

- **Manual-verify performed against a real browser** (a first audit round flagged this as a silent skip — the three items below are the fix, not new work found independently). No existing docs demo combines `Split` with an overflowing `autoScroll` `Panel`, so a temporary, uncommitted demo (`packages/docs/src/demos/scratch-split-panel-drag.ts`, plus a matching `<!-- demo: ... -->` marker temporarily added to `Split.md`) built a `Split` whose left pane is a `Panel({ autoScroll: 'y' })` holding 60 rows, capped to `{ width: 300, height: 220 }` preferred / `{ width: 100000, height: 220 }` max (unbounded width so the gutter drag can resize it freely; the height cap is what forces the vertical overflow this demo needs). Both were deleted before this note was written — neither is part of the diff.

  Served via `npm run docs:dev` and driven with `chrome-devtools` MCP: a script dispatched a real `pointerdown`/`mousedown` on the gutter, then 40 `pointermove`/`mousemove` pairs each followed by `await new Promise(r => requestAnimationFrame(r))` — one real per-frame move, mirroring `Split.flushDrag`'s own pacing — before `pointerup`/`mouseup`. A CDP performance trace recorded across the whole drag was parsed for `Layout` trace events whose `beginData.stackTrace` names `remeasureScrollMetrics`/`measureOverlayLayout`/`getScrollMetrics`-adjacent frames — i.e., a layout this plan's own mechanism forced, not an unrelated one elsewhere on the docs page. Result: **3 mechanism-forced `Layout` events across the 40 driven frames** (the rest of the 44 total `Layout` events in the trace carry no such stack and are unrelated page activity) — directionally consistent with the three predecessor plans' own recorded live numbers (VirtualRowView 2/40, ScrollStrip 3/50, Panel 3/50) and confirming the settle relay withholds through a real multi-frame burst and catches up a small, bounded number of times, not once per frame. This addresses the Manual-verify section's forced-layout-count spot check.

  A screenshot taken after the drag (gutter dragged 160px left, then settled) showed the left pane correctly narrowed with its row content readable and no stuck/stale geometry — the gutter, pane border, and content all agreed on the final position. This addresses "every settled value ... is correct for the final size — no stuck stale frame."

  Expected Behaviour #4 ("the settle mechanism still resolves during the startup font-loading hold") was not independently reproduced live — forcing the exact startup race window (before local dev fonts, which activate near-instantly, close the hold) is impractical to hit deterministically without adding temporary instrumentation to `Theme.ts`/`FirstLayoutGate.ts`. Verified instead by inspection and precedent: `flushPendingLayouts`'s `isFirstLayoutHeld()` gate (`Component.ts`) defers *every* queued `afterLayoutCallbacks` entry uniformly, with no per-caller special-casing — `Dialog.ts` already relies on exactly this deferral for its own `afterNextLayout` usage today, in production, without incident. The three settle relays gain the same property automatically by routing through the same primitive; there is no new code path specific to them that the gate could fail to cover. Confirmed `holdFirstLayout()` is wired into real startup, not just tests (`grep -rn 'holdFirstLayout()' src/typescript/lib/` outside test files hits only `Theme.ts:1375`). This is a reasoned, code-level verification, not a live reproduction — disclosed as such rather than silently skipped.

- **Full suite verified clean end to end**, run twice for stability given the cross-test-ordering issues found above: `npm run typecheck`, `npm run lint`, `npm run build:lib`, `npm run docs:api` (14 pre-existing warnings, none touching this plan's files), and `npm run test` (453 files / 7259 tests, 5 pre-existing `todo`).

- **Added a changelog entry** (`docs/reference/changelog/next.md`, Fixed/Components) for the `getScrollMetrics` read-count reduction — a genuine, additional, user-observable performance improvement beyond what the three predecessor plans (`virtual-row-view-resize-relayout`, `scrollstrip-resize-resync-coalescing`, `panel-scroll-metrics-resize-coalescing`) already documented for the settle-relay mechanism itself, which this plan's `afterNextLayout` uplift leaves behaviourally unchanged from a consumer's perspective.

---

## Notes

[^single-hop-proof]: Verified empirically, not just by reading the doc comment, per this plan's own instruction to check before designing around it. A scratch test (not part of this plan's diff) built a `Container` subclass whose `doLayout()` arms a *single* `Component.afterNextLayout` call on first entry, then drove it through the exact same "drain whatever's queued, then run this frame's real `setWidth`+`doLayout()`" harness `ResizeLayoutEconomyRealtime.test.ts` uses to simulate a `Split`-driven drag (`realDragFrame`/`advanceDragFrame` calling `doLayout()` directly, never `scheduleLayout()`, mirroring `Split.onDrag`'s own calls). Across a 5-frame continuous-width-change burst, every check concluded `concludedMoved: false` — the single-hop `afterNextLayout` version never once detected that the width was still moving, reproducing the original bug exactly. A second scratch test built the same host but with the two-hop *shape* (a decoy `afterNextLayout` callback nested inside the schedule method, exactly as this plan specifies) against the identical harness: it correctly withheld through the entire burst and caught up exactly once at the final width, including across a 19-frame extended burst. A third scratch test confirmed `cancel()` on the returned handle withdraws a still-armed hop cleanly (no `flushXSettle` call after cancellation).

[^empirical-verification]: The same three scratch tests referenced in [^single-hop-proof] are the direct evidence for this decision; they were run and their output inspected during planning, then discarded (per this skill's rule against modifying source). Whoever implements this plan should not need to re-derive this from scratch — the two-hop-via-nested-`afterNextLayout` shape in *Internal Structure* is the exact shape verified.

[^redundant-read-trace]: Traced call-by-call against the current source. In overlay mode, `resizeScrollShadowOverlay`'s own panel-element read (`R_A`) is identical to `layoutOverlayScrollbars`'s `avail` read (`R_B1`) — nothing writes to the panel's own box between them — and `updateScrollShadows`'s read of `getScrollElement()` (`R_D`) is identical to `layoutOverlayScrollbars`'s already-fresh inner-scroller read (`R_B2`, called `m` above) whenever the conditional re-inset doesn't fire; when it *does* fire, the existing code already tolerates using the pre-re-inset `m` for the scrollbar's own thumb metrics (`commitOverlayLayout`'s `setMetrics` calls, unchanged by this plan), so reusing the same `m` for the shadow-edge calc introduces no new staleness beyond what the current code already accepts. `resizeScrollShadowOverlay`'s *second* call from inside `updateScrollShadows` (`R_E`) reads the same panel element as `R_A` a third time, with nothing written to the panel's own box in between either — eliminated the same way.

[^delete-not-orphan]: `grep -n 'measureScrollbarGutter' packages/lib/src/typescript/lib/core/Panel.ts` at drafting time shows exactly two call sites (`doLayout`, `flushScrollMetricsSettle`) and the one definition; no test file or other source file references it (`grep -rln 'measureScrollbarGutter' packages/lib/` matches only `Panel.ts` and its own plan). Once both call sites route through `remeasureScrollMetrics` instead, the method has no callers left, so it is deleted rather than kept as unreachable private code (which `npm run lint`'s unused-member check would flag anyway).

[^both-no-shadow-tradeoff]: In this one configuration (`scrollbarStyle: "native"`, `scrollShadows: false`, `autoScroll: "both"`), the current code reads nothing at all — `"both"` mode reserves both gutters unconditionally with no measurement, and no shadow overlay exists to size or ramp. `remeasureScrollMetrics` still reads `avail` unconditionally at its top (needed by every *other* branch), costing this one narrow, already-degraded-affordance combination (both scroll shadows *and* per-axis overflow detection deliberately disabled) a single extra forced read it didn't pay before. Adding a dedicated early-exit for this one combination was considered and rejected: it would need its own branch duplicating the `"none"`-style guard for a configuration with no other special-casing anywhere else in `Panel.ts`, for a cost of one `getScrollMetrics` call in a mode nothing else in this codebase treats as a hot path.
