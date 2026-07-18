# Overlay-Synced Native Scrollbar for `Panel` — Implementation Plan

## Overview

Make `scrollbarStyle: "overlay"` the **default** scroll-bar rendering for [`Panel`](src/typescript/lib/core/Panel.ts#L108), with `"native"` as the explicit opt-out. In overlay mode the panel keeps **native** scrolling (`overflow: auto`, so the element stays a real scroll container), **hides the native scrollbar visually** with CSS, and **overlays custom [`Scrollbar`](src/typescript/lib/component/container/Scrollbar.ts#L310) widgets** synced to the element's native `scrollTop` / `scrollLeft`. Because scrolling stays native, every native behaviour is preserved for free — Ctrl+F find reveal, keyboard scroll (arrows / PageUp·Dn / Home / End / Space), focus-scroll-into-view, text-selection autoscroll, assistive-tech scrolling, contenteditable/input caret scrolling. The overlay bars are purely visual plus a drag affordance. This is what makes overlay safe to default: functionality is identical to native scroll; only the bar's appearance changes.

Overlay is inert unless the panel actually scrolls (`autoScroll !== "none"`), so panels that don't scroll are untouched. Because the change is on `Panel` — and `setAutoScroll` is defined **only** on `Panel` ([Panel.ts#L236](src/typescript/lib/core/Panel.ts#L236)) — the blast radius is every `Panel` (and subclass) that opts into `autoScroll`, plus every call site that constructs a scrolling `Panel`; see *Overlay is the default* below for the enumerated consumers and the single forced-native opt-out. This is deliberately **not** the transform-based windowed approach used by [`VirtualScroller`](src/typescript/lib/component/container/VirtualScroller.ts#L47) — that stays reserved for virtualization (Table body / Tree, which do **not** route through `Panel.autoScroll` and are unaffected). VirtualScroller is the wiring precedent this mirrors (two `Scrollbar`s appended to the owner element, positioned at trailing edges, fed metrics), but driven from **native** scroll metrics instead of a transform.

All new work is in [`Panel.ts`](src/typescript/lib/core/Panel.ts); one new test file; a re-export line in the core barrel.

---

## Architecture Decisions

### Reuse `Scrollbar`, mirror `VirtualScroller`'s two-bar wiring

The overlay controls are two existing [`Scrollbar`](src/typescript/lib/component/container/Scrollbar.ts#L310) widgets (one `"vertical"`, one `"horizontal"`), constructed and driven exactly as [`VirtualScroller`](src/typescript/lib/component/container/VirtualScroller.ts#L127-L139) drives them: append the widget's element into the owner, position it at the trailing edge with `setX`/`setY`/`setWidth`/`setHeight`, push `setMetrics(viewportSize, contentSize, scrollPosition)`, and subscribe to its `"scroll"` event. The one difference is the data source: VirtualScroller feeds transform state; this plan feeds `DOM.source.getScrollMetrics(el)` — the same native read [`Panel.updateScrollShadows`](src/typescript/lib/core/Panel.ts#L769) already uses. `Scrollbar.setMetrics` auto-hides the bar when `contentSize <= viewportSize`, so a non-overflowing axis needs no special-casing.

### Pin the bars to the viewport via a zero-size `position: sticky` host (mirrors the scroll-shadow overlay)

The panel element itself is the native scroll container, so a child appended into it scrolls with the content. The framework's proven pattern for "an overlay pinned to the viewport of a native scroller" is the scroll-shadow overlay: a **raw** (non-`Component`) `div` with `position: sticky; top: 0; left: 0` that the compositor keeps pinned to the scroll-port as content scrolls ([`createScrollShadowOverlay`](src/typescript/lib/core/Panel.ts#L659)). `position: sticky` is forbidden on a `Component` (ARCHITECTURE.md *Positioning is always absolute*), which is exactly why the shadow overlay is a raw div — so the overlay-scrollbar host is a raw div too, and the two `Scrollbar` **Components** live *inside* it, keeping their required `position: absolute`.

Divergence from the shadow overlay, and its reason: the shadow overlay is sized to the full viewport (`clientWidth × clientHeight`) and is *in normal flow*, so its height floors the element's `scrollHeight` — it is deliberately "the panel's only in-flow child." A **second** full-height in-flow sticky block would stack and double `scrollHeight`, inventing a phantom viewport of scroll range. So the scrollbar host is instead **`width: 0; height: 0; overflow: visible`** (zero flow footprint, adds nothing to `scrollHeight`/`scrollWidth`), and the two absolutely-positioned `Scrollbar` children paint outside it via `overflow: visible`. To pin from scroll position 0, a `height: 0` sticky element must have its natural flow origin at the scroll-port origin, so it is inserted as the panel element's **first child** via `DOM.sink.insertBefore(element, host, DOM.source.getFirstChild(element))`. `z-index: 2` keeps the bars above the shadow overlay's `z-index: 1`.

### API shape mirrors the `autoScroll` / `scrollShadows` declare+seed cascade

Add `scrollbarStyle?: ScrollbarStyle` (`"native" | "overlay"`, **default `"overlay"`**) to `PanelOptions`, with `setScrollbarStyle(style)` / `getScrollbarStyle()`. The backing field and the runtime overlay handles are written by setters that `applyOptions` dispatches during the `super()` cascade, so they are declared bare with `declare` and **seeded in `applyOptions`** — the class-field super-cascade trap documented in CODE_CONVENTIONS.md and already applied to `_autoScroll`, `_scrollShadows`, `_scrollbarGutter`, `_shadowOverlay` in this same file ([Panel.ts#L110-L145](src/typescript/lib/core/Panel.ts#L110)). `setScrollbarStyle` is **always-dispatched** (`options.scrollbarStyle ?? "overlay"`) exactly like `setAutoScroll` ([Panel.ts#L198](src/typescript/lib/core/Panel.ts#L198)), so `getScrollbarStyle()` reads the `declare`d field directly and needs no default-fallback registry row (neither `getAutoScroll` nor `getScrollShadows` have one). A `Panel` subclass that must always be native (see *Overlay is the default*) opts out by calling `this.setScrollbarStyle("native")` in its **constructor body** after `super()` — the same constructor-body seeding idiom `ScrollStrip` already uses for its own fields ([ScrollStrip.ts#L140-L143](src/typescript/lib/component/container/ScrollStrip.ts#L140)); this runs after the cascade's overlay seed and, because the subclass never enables `autoScroll` on itself, tears down nothing.

### Overlay is the default: blast radius & forced-native opt-outs

Because `setAutoScroll` lives **only** on `Panel` ([Panel.ts#L236](src/typescript/lib/core/Panel.ts#L236)), the overlay default reaches exactly three sets: `Panel` subclasses that opt into `autoScroll`, call sites that construct a scrolling `Panel`, and nothing else. Components that scroll by other means are untouched — `ToolBar` (extends `Container`, drives its own `setOverflow`), `Menu` (extends `Component`, calls `setOverflowX/Y` directly — [Menu.ts#L819](src/typescript/lib/overlay/Menu.ts#L819)), `Markdown` (extends `Component`), and the `VirtualScroller`-backed **Table body** and **Tree** (transform scroll, never `Panel.autoScroll`) all keep exactly what they have.

Governing principle: native scroll is preserved, so **functionality is safe everywhere** — force `"native"` **only** where the overlay bar would visually or behaviourally conflict with an affordance the component already owns. Surveying every scrolling-`Panel` consumer:

- **`ScrollStrip`** ([ScrollStrip.ts](src/typescript/lib/component/container/ScrollStrip.ts)) — **forced native.** It owns bespoke lead/trail arrow paging and manages its own scroll surface (an inner `overflow: hidden` clip driven programmatically via `setScrollLeft/Top`), so a synced overlay bar would duplicate/conflict with the arrow affordance it is built around. It never calls `Panel.autoScroll` today (band hosts fixed arrows; clip is `overflow: hidden`), so the overlay is already inert for it — the pin is the **explicit encoding of its "I own my scroll affordance" invariant**, guarding against any future `autoScroll` use or subclass. Opt out via `this.setScrollbarStyle("native")` in the `ScrollStrip` constructor body.

Kept on the overlay default (native scroll preserved, no affordance conflict, no code change):

- **Dialog content region** — `new Panel({ autoScroll: "y" })` ([Dialog.ts#L595](src/typescript/lib/overlay/Dialog.ts#L595)); a slim overlay bar on the dialog body is fine.
- **`AbstractSelectableList` inner panel** — `new Panel({ autoScroll: "y" })` ([AbstractSelectableList.ts#L801](src/typescript/lib/component/list/AbstractSelectableList.ts#L801)); the List/ComboBox drop list.
- **`PickerColumn`'s `PickerCellList`** — `extends Panel`, `autoScroll: "y"` ([PickerColumn.ts#L87](src/typescript/lib/component/input/PickerColumn.ts#L87)).
- **`Form`** — `extends Panel`, inherits the default.
- **Chart / diagram Panel subclasses** (`AbstractChart`, `ChartLegend`, `DiagramView`/`DiagramNode`/`DiagramGroupNode`) — inherit the default but are inert unless they enable `autoScroll`.

No component in the codebase currently hides its own native scrollbar (`grep -rn "scrollbar-width\|::-webkit-scrollbar" src/` matches only the `DOM.ts` width probe and a `StyleTarget.ts` doc comment — no actual bar-hiding site), so there is nothing pre-existing to reconcile with. `ScrollStrip` is the sole forced-native opt-out.

### Install / teardown lifecycle mirrors `refreshScrollShadows`

Overlay mode is inert while `autoScroll === "none"` (nothing scrolls) or `scrollbarStyle === "native"`. A single `refreshOverlayScrollbars()` — modelled on [`refreshScrollShadows`](src/typescript/lib/core/Panel.ts#L611) — installs when both conditions are met and the element exists, and tears down otherwise. It is called from `setScrollbarStyle`, from `setAutoScroll` (right after its existing `refreshScrollShadows()` call), and the first install happens in [`init`](src/typescript/lib/core/Panel.ts#L493) once the element is rendered. Teardown happens in [`destructor`](src/typescript/lib/core/Panel.ts#L514) and on any transition out of overlay mode. The raw host handle is tracked with `trackHandle` and released on teardown, exactly like `_shadowOverlay`.

### Gutter: bypass native measurement, reserve the overlay track instead

In overlay mode the native bar is 0px wide, so [`measureScrollbarGutter`](src/typescript/lib/core/Panel.ts#L559) would either read the OS probe width (`getScrollBarWidth()`, e.g. 15 on Windows) for a bar that isn't there, or bail on a 0-width overlay platform — both wrong. So `measureScrollbarGutter` gains an early overlay branch that delegates to `layoutOverlayScrollbars()`, which reserves the **known** `Scrollbar.getTrackWidth()` (12px) into the existing `_scrollbarGutter` cache on an axis whose overlay bar is actually visible (content overflows that scrollable axis). [`getInnerSize`](src/typescript/lib/core/Panel.ts#L355) is **unchanged** — it already subtracts `_scrollbarGutter.right`/`.bottom`, so populating that cache from overlay logic reuses the whole post-gutter layout path. This sidesteps the native-scrollbar-width measurement dance and the macOS zero-width special-case entirely.

### Feedback-loop guard

The overlay bar's `"scroll"` event writes native scroll (`Panel.setScrollTop` / `setScrollLeft` on itself — [Component.ts#L3057/#L3080](src/typescript/lib/core/Component.ts#L3057)); the native write fires the DOM `"scroll"` event, which re-pushes `setMetrics`. This does **not** loop: `Scrollbar.setMetrics` only recomputes thumb size/position and **never emits `"scroll"`** ([Scrollbar.ts#L549-L597](src/typescript/lib/component/container/Scrollbar.ts#L549)), and it no-ops the thumb DOM writes when the computed `_thumbSize`/`_thumbPos` are unchanged ([Scrollbar.ts#L568/#L576](src/typescript/lib/component/container/Scrollbar.ts#L568)). So the round-trip settles in one pass: bar → native scroll → (clamped) metrics → thumb reposition → stop.

### Native-bar hiding via a per-component CSS rule

Hide the native bar with two writes, both through the framework's deferred style seams (CODE_CONVENTIONS.md — no raw `element.style`):
- `scrollbar-width: none` on the component's own `#id` rule via `setElementCSSRule("scrollbarWidth", …)` (Firefox / Chromium ≥ 121).
- `#id::-webkit-scrollbar { display: none }` via [`createStyleRule("::-webkit-scrollbar")`](src/typescript/lib/core/Component.ts#L741) (WebKit / older Blink), which allocates a deferred per-component state rule keyed by the pseudo-element suffix.

Both are wrapped in a private `setNativeScrollbarHidden(hidden)` — the typed setter these low-level seam calls must sit behind; its cache is the derived `_scrollbarStyle` (not a consumer field, so nothing new on the options bag). Decision over the task's "toggle a shared CSS class" phrasing: the per-`#id` rule is the closer precedent (this file already toggles per-component visual state through `setElementCSSRule` / `createStyleRule`) and needs no class-toggle plumbing, which `Component` does not expose.

### Coexistence with scroll shadows

Shadows keep working unchanged because scrolling is still native; both overlays live on the same element. Stacking is resolved by `z-index`: shadow overlay `z-index: 1` (unchanged), scrollbar host `z-index: 2` (bars paint above the faint edge fades). The shadow overlay's `scrollHeight`-flooring invariant is irrelevant in overlay mode (the gutter measurement is bypassed), and the zero-size scrollbar host adds no flow height, so the shadow overlay remains the sole in-flow child.

---

## Public API

```typescript
// Panel.ts — new exported type (mirrors AutoScrollMode)
export type ScrollbarStyle = "native" | "overlay";

// PanelOptions — new field
export interface PanelOptions extends ContainerOptions {
    // …existing…
    scrollbarStyle?: ScrollbarStyle;   // default "overlay"
}

// Panel — new methods
setScrollbarStyle(style: ScrollbarStyle): this;
getScrollbarStyle(): ScrollbarStyle;
```

- Backing field: `declare private _scrollbarStyle: ScrollbarStyle;` (seeded in `applyOptions`, always-dispatched through `setScrollbarStyle`).
- Options field ↔ setter ↔ getter routing: `PanelOptions.scrollbarStyle` → `setScrollbarStyle` (from `applyOptions`) → `_scrollbarStyle` → `getScrollbarStyle`.
- Re-export: add `ScrollbarStyle` to the `export type { … } from '~/core/Panel.js'` line in [`src/typescript/lib/core/index.ts`](src/typescript/lib/core/index.ts#L22).

---

## Internal Structure

New private state on `Panel` (grouped with the existing scroll-shadow fields; all cascade-touched ones are `declare` + seeded in `applyOptions`, the runtime-only style buffer is a plain initializer like `_shadowOverlayStyle`):

```typescript
declare private _scrollbarStyle:       ScrollbarStyle;
declare private _overlayHost:          Handle | null;            // raw sticky wrapper div
declare private _scrollbarV:           Scrollbar | null;
declare private _scrollbarH:           Scrollbar | null;
declare private _overlayScrollHandler: (() => void) | null;      // native "scroll" → sync
private         _overlayHostStyle:     InlineStyle = new InlineStyle();
```

Bound scroll-forwarders (named class fields, per ARCHITECTURE.md *Listeners must reference a named function*):

```typescript
private _onOverlayScrollV = (position: number): void => { this.setScrollTop(position); };
private _onOverlayScrollH = (position: number): void => { this.setScrollLeft(position); };
```

Shared metrics helper (single source of truth for effective viewport + visibility, single-pass — the mutual V↔H dependency settles across layout passes via `scheduleLayout`, exactly as the native `measureScrollbarGutter` does):

```typescript
// el pre-resolved by caller. trackW = this._scrollbarV.getTrackWidth().
private overlayMetrics(el: Handle): {
    scrollTop: number; scrollLeft: number;
    clientW: number; clientH: number;        // clientWidth / clientHeight (full inner box — native bar hidden)
    contentW: number; contentH: number;      // scrollWidth / scrollHeight
    vVisible: boolean; hVisible: boolean;
    effW: number; effH: number;              // clientW/H minus the cross-axis bar when visible
    trackW: number;
} {
    const m      = DOM.source.getScrollMetrics(el);
    const axes   = this.scrollableAxes();
    const trackW = this._scrollbarV!.getTrackWidth();

    const vVisible = axes.y && m.scrollHeight > m.clientHeight;
    const hVisible = axes.x && m.scrollWidth  > m.clientWidth;

    return {
        scrollTop: m.scrollTop, scrollLeft: m.scrollLeft,
        clientW:   m.clientWidth, clientH: m.clientHeight,
        contentW:  m.scrollWidth, contentH: m.scrollHeight,
        vVisible, hVisible, trackW,
        effW: m.clientWidth  - (vVisible ? trackW : 0),
        effH: m.clientHeight - (hVisible ? trackW : 0),
    };
}
```

`layoutOverlayScrollbars(element?)` (called from `measureScrollbarGutter`'s overlay branch and from `init`): resolve element; if no element or bars, return. Compute `overlayMetrics`. Position/size the bars at the trailing edges (the reserved band sits at `[clientW - trackW, clientW]`):
- vertical: `setX(clientW - trackW)`, `setY(0)`, `setHeight(effH)`, `setMetrics(effH, contentH, scrollTop)`.
- horizontal: `setY(clientH - trackW)`, `setX(0)`, `setWidth(effW)`, `setMetrics(effW, contentW, scrollLeft)`.

Then reserve the gutter and reflow if it changed (mirrors [`measureScrollbarGutter`](src/typescript/lib/core/Panel.ts#L594-L602)):
```typescript
const newRight  = vVisible ? trackW : 0;
const newBottom = hVisible ? trackW : 0;
if (newRight !== this._scrollbarGutter.right || newBottom !== this._scrollbarGutter.bottom) {
    this.setScrollbarGutter(newRight, newBottom);
    this.scheduleLayout();
}
```

`syncOverlayScrollbars()` (called from the native `"scroll"` handler): resolve element + bars; compute `overlayMetrics`; push `setMetrics` to both bars (thumb reposition only — no re-position/re-size, since geometry changes only on layout). No gutter work.

---

## Ordered Implementation Steps

1. **`Panel.ts` — import `Scrollbar`.** Add `import { Scrollbar } from "~/component/container/Scrollbar.js";`. Verify no import cycle: Scrollbar imports from `~/core/*` and `~/component/display/Glyph`, not from `Panel`, so `Panel → Scrollbar` is acyclic. Check: `npm run typecheck` after the file compiles.

2. **`Panel.ts` — export `ScrollbarStyle` type** next to `AutoScrollMode` (above `PanelOptions`), with a short doc comment.

3. **`Panel.ts` — add `scrollbarStyle?: ScrollbarStyle`** to `PanelOptions` with a doc comment: **default `"overlay"`** — a scrolling panel hides its native bar and paints synced overlay `Scrollbar`s; pass `"native"` to opt out and keep the OS bar. Inert while `autoScroll === "none"`.

4. **`Panel.ts` — declare the new private fields** (see *Internal Structure*) alongside the scroll-shadow field block, with the same super-cascade rationale comment. Add the two bound `_onOverlayScroll*` fields and the `_overlayHostStyle` initializer.

5. **`Panel.ts` — seed + dispatch in `applyOptions`.** After the existing `setScrollShadows` block, seed `this._overlayHost = null; this._scrollbarV = null; this._scrollbarH = null; this._overlayScrollHandler = null;`, then always-dispatch `this.setScrollbarStyle(options.scrollbarStyle ?? "overlay");`. Must come **after** `setAutoScroll` (install reads `_autoScroll`).

6. **`Panel.ts` — add `setScrollbarStyle` / `getScrollbarStyle`.** Setter: `this._scrollbarStyle = style; this.refreshOverlayScrollbars(); return this;`. Getter returns `this._scrollbarStyle`.

7. **`Panel.ts` — call `refreshOverlayScrollbars()` from `setAutoScroll`,** on the line after the existing `this.refreshScrollShadows();`.

8. **`Panel.ts` — install the overlay in `init`.** After the existing shadow install block, add: `if (resolved && this._scrollbarStyle === "overlay" && this._autoScroll !== "none") { this.installOverlayScrollbars(resolved); this.layoutOverlayScrollbars(resolved); }`.

9. **`Panel.ts` — tear down in `destructor`.** Add `this.removeOverlayScrollbars();` before `super.destructor();`.

10. **`Panel.ts` — overlay branch in `measureScrollbarGutter`.** At the very top, after the `if (this._autoScroll === "none") return;` guard, add: `if (this._scrollbarStyle === "overlay") { this.layoutOverlayScrollbars(); return; }`. Leaves the native path untouched.

11. **`Panel.ts` — implement the lifecycle methods:** `refreshOverlayScrollbars()`, `installOverlayScrollbars(element)`, `removeOverlayScrollbars()`, `setNativeScrollbarHidden(hidden)`. See *Implementation notes* below.

12. **`Panel.ts` — implement the geometry/sync methods:** `overlayMetrics(el)`, `layoutOverlayScrollbars(element?)`, `syncOverlayScrollbars()`.

13. **`src/typescript/lib/core/index.ts` — re-export `ScrollbarStyle`.** Add it to the `export type { AutoScrollMode, PanelOptions } from '~/core/Panel.js';` line.

14. **`ScrollStrip.ts` — forced-native opt-out.** In the `ScrollStrip` constructor body, after `super(options)` and the existing `??=` field seeds ([ScrollStrip.ts#L140-L143](src/typescript/lib/component/container/ScrollStrip.ts#L140)), add `this.setScrollbarStyle("native");` with a one-line comment: ScrollStrip owns its own arrow paging + programmatic clip scroll, so it never wants a synced overlay bar. Check: `grep -n 'setScrollbarStyle("native")' src/typescript/lib/component/container/ScrollStrip.ts` — expect one match.

15. **`tests/core/PanelScrollChaining.test.ts` — pin the native-scroll intent.** Every panel in this file is `new _Panel({ autoScroll: … })` and is **rendered** via `panel.getElement(true)` (lines 89, 102, 117-118) or drives `updateScrollShadows`; under the overlay default those renders would now install overlay bars. These tests document **native-scroll** semantics (wheel-chaining + shadow-edge lighting), so add `scrollbarStyle: 'native'` to each construction (lines 86, 99, 113, 114, 140, 152, 163) to keep them exercising the exact native environment they were written for. Their subjects (wheel claim, shadow edges) are unchanged; the new overlay-default behaviour is covered separately in step 17.

16. **`tests/core/PanelGutterSettle.test.ts` — leave as-is, confirm green.** These cases invoke `scheduleGutterSettleOnShrink` directly (no render, no `measureScrollbarGutter`), and the settle scheduler is mode-agnostic (it reads `showsScrollAffordance`, which `_scrollbarGutter` populates in *both* modes). They remain valid under the overlay default; do **not** edit them, but run them to confirm.

17. **Test file** `tests/core/PanelOverlayScrollbar.test.ts` — cover the unit-testable `## Expected Behaviour` cases, including the new overlay-**default** cases (a plain `new _Panel({ autoScroll: 'y' })` with **no** `scrollbarStyle` → overlay branch + 12px gutter) and the explicit-native case (`scrollbarStyle: 'native'` → the measured-gutter path, stubbing `getScrollBarWidth() === 15`). Mirror the `installTestDOM` + `vi.spyOn(DOM.source, 'getScrollMetrics')` harness from [`tests/core/PanelScrollChaining.test.ts`](tests/core/PanelScrollChaining.test.ts) and the private-method access idiom from [`tests/core/PanelGutterSettle.test.ts`](tests/core/PanelGutterSettle.test.ts).

18. **Run the full suite and pin geometry-sensitive stragglers.** After steps 1-17, run `npm test`. Three suites render/`doLayout` a scrolling `Panel` and assert scroll geometry that could shift by the 12-vs-15px gutter delta under the overlay default: `tests/component/input/TimePickerDropdown.test.ts` (`doLayout` on a `PickerCellList`), `tests/overlay/DialogCappedScroll.test.ts` (dialog content panel), `tests/component/input/PickerColumn.test.ts`. Overlay reserves the gutter on the **cross axis** (right gutter for `autoScroll: "y"`, which changes width not height), so height-based assertions should be unaffected — but if any goes red, pin that specific panel with `scrollbarStyle: 'native'` (preserving its original assertion) rather than editing the expected value. Name any pinned file in the commit.

19. **Verify:** `npm run typecheck`, `npm test`, `npm run build:lib`, `npm run docs:build` (zero warnings), then the manual live checks.

### Implementation notes for step 11

```
refreshOverlayScrollbars():
    if (this._scrollbarStyle !== "overlay" || this._autoScroll === "none") { this.removeOverlayScrollbars(); return; }
    const element = this.getElement(); if (!element) return;
    this.installOverlayScrollbars(element);
    this.layoutOverlayScrollbars(element);

installOverlayScrollbars(element):
    if (!this._overlayHost) {           // create the sticky zero-size host, prepend as first child
        const host = DOM.sink.createElement("div");
        this._overlayHostStyle.attach(host);
        this._overlayHostStyle.setMany({ position: "sticky", top: "0px", left: "0px",
                                         width: "0px", height: "0px", overflow: "visible", zIndex: "2" });
        DOM.sink.insertBefore(element, host, DOM.source.getFirstChild(element));
        this.trackHandle(host);
        this._overlayHost = host;
    }
    if (!this._scrollbarV) {
        this._scrollbarV = new Scrollbar("vertical");
        DOM.sink.appendChild(this._overlayHost, this._scrollbarV.getElement(true)!);
        this._scrollbarV.on("scroll", this._onOverlayScrollV);
    }
    if (!this._scrollbarH) {
        this._scrollbarH = new Scrollbar("horizontal");
        DOM.sink.appendChild(this._overlayHost, this._scrollbarH.getElement(true)!);
        this._scrollbarH.on("scroll", this._onOverlayScrollH);
    }
    if (!this._overlayScrollHandler) {
        const handler = (): void => { this.syncOverlayScrollbars(); };
        this._overlayScrollHandler = handler;
        Event.addListener(this, "scroll", handler);
    }
    this.setNativeScrollbarHidden(true);

removeOverlayScrollbars():
    if (this._overlayScrollHandler) { Event.removeListener(this, "scroll", this._overlayScrollHandler); this._overlayScrollHandler = null; }
    for (const [bar, fwd] of [[this._scrollbarV, this._onOverlayScrollV], [this._scrollbarH, this._onOverlayScrollH]]) {
        if (bar) { bar.off("scroll", fwd); bar.removeElement(); }   // detach the bar's DOM element (handle released on the bar's GC finalizer, per VirtualScroller)
    }
    this._scrollbarV = null; this._scrollbarH = null;
    if (this._overlayHost) {
        DOM.sink.removeElement(this._overlayHost); this.untrackHandle(this._overlayHost); DOM.sink.release(this._overlayHost);
        this._overlayHost = null; this._overlayHostStyle = new InlineStyle();   // fresh buffer for any re-install (mirrors removeScrollShadows)
    }
    this.setNativeScrollbarHidden(false);
    if (this._scrollbarGutter.right !== 0 || this._scrollbarGutter.bottom !== 0) { this.setScrollbarGutter(0, 0); }

setNativeScrollbarHidden(hidden):
    this.setElementCSSRule("scrollbarWidth", hidden ? "none" : null);
    this.createStyleRule("::-webkit-scrollbar").set("display", hidden ? "none" : null);
```

Guard `removeOverlayScrollbars` so it is safe during the construction cascade (all fields already seeded `null` in `applyOptions` before any dispatch, mirroring `removeScrollShadows`). `setNativeScrollbarHidden(false)` during the cascade is a harmless deferred style write on the not-yet-rendered rule.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Panel.ts` |
| Modify | `src/typescript/lib/core/index.ts` |
| Modify | `src/typescript/lib/component/container/ScrollStrip.ts` (forced-native opt-out) |
| Modify | `tests/core/PanelScrollChaining.test.ts` (pin `scrollbarStyle: 'native'` to preserve native intent) |
| Modify | *(conditional, only if red under the overlay default)* `tests/component/input/TimePickerDropdown.test.ts`, `tests/overlay/DialogCappedScroll.test.ts`, `tests/component/input/PickerColumn.test.ts` |
| Create | `tests/core/PanelOverlayScrollbar.test.ts` |

---

## Expected Behaviour

Offline-testable via the TestDOM geometry oracle (stub `DOM.source.getScrollMetrics` per `PanelScrollChaining.test.ts`; drive private methods per `PanelGutterSettle.test.ts`):

1. **Default is overlay.** `new Panel().getScrollbarStyle() === "overlay"`. `new Panel({ scrollbarStyle: "native" }).getScrollbarStyle() === "native"`.
2. **Inert while `autoScroll: "none"`.** A rendered `Panel()` (overlay default, autoScroll defaults `"none"`) has `_overlayHost === null`, `_scrollbarV === null`, and does not hide the native bar.
3. **Install on both conditions met.** After render+`init`, `Panel({ autoScroll: "y" })` (overlay by default) has non-null `_overlayHost`, `_scrollbarV`, `_scrollbarH`, and the wired `_overlayScrollHandler`; the `#id` rule carries `scrollbar-width: none`.
4. **Teardown on transition out.** From an installed overlay panel: `setAutoScroll("none")` tears down (host + bars null, native bar un-hidden, gutter cleared); independently `setScrollbarStyle("native")` tears down. Re-entering (`setScrollbarStyle("overlay")` while `autoScroll` scrollable) re-installs.
5. **Gutter reservation.** Stub `scrollHeight > clientHeight` on an `autoScroll: "y"` overlay panel → after `layoutOverlayScrollbars`, `_scrollbarGutter.right === 12` (`Scrollbar.getTrackWidth()`), so `getInnerSize().width` is 12 less than `super.getInnerSize().width`. Stub `scrollWidth > clientWidth` on an `x` panel → `_scrollbarGutter.bottom === 12`. No stubbed overflow → both 0.
6. **Effective viewport when both axes overflow** (`autoScroll: "both"` or `"auto"`, both dims stubbed to overflow): vertical bar `getX() === clientWidth - 12`, `getHeight() === clientHeight - 12`; horizontal bar `getY() === clientHeight - 12`, `getWidth() === clientWidth - 12`.
7. **Bar auto-hides when its axis fits.** Stub content ≤ viewport on one axis → that bar's `isDisplayed() === false` after `layoutOverlayScrollbars` (delegated to `Scrollbar.setMetrics`).
8. **Bar `"scroll"` writes native offset.** Invoking `_onOverlayScrollV(120)` calls `Panel.setScrollTop(120)` (spy `setScrollTop`); `_onOverlayScrollH(80)` calls `setScrollLeft(80)`.
9. **Sync is a no-op round-trip (feedback guard).** With fixed stubbed metrics, calling `syncOverlayScrollbars()` twice does not call `setScrollTop`/`setScrollLeft` (spy) — `setMetrics` never emits `"scroll"`, so no re-entrant native write.
10. **Explicit-native path untouched.** A `Panel({ autoScroll: "y", scrollbarStyle: "native" })` still runs the native `measureScrollbarGutter` branch (stub `getScrollBarWidth() === 15`, `scrollHeight > clientHeight` → `_scrollbarGutter.right === 15`, and no overlay host/bars installed), proving `"native"` fully opts out of the overlay branch.
11. **Overlay is the default with no option set.** A plain `Panel({ autoScroll: "auto" })` — **no** `scrollbarStyle` — reports `getScrollbarStyle() === "overlay"`; after render+`doLayout` with `scrollHeight > clientHeight` stubbed, it takes the overlay branch (`_scrollbarGutter.right === 12`, overlay host + bars installed), **not** the native 15px path. This is the default-flip regression guard.
12. **Forced-native components stay native.** `new ScrollStrip().getScrollbarStyle() === "native"` (constructor opt-out), even though `ScrollStrip` extends `Panel` whose default is `"overlay"`.

Manual verification (native paint / real input the offline harness can't exercise — run live in the app at `localhost:8015`, e.g. a `Panel({ autoScroll: "auto", scrollbarStyle: "overlay" })` with oversized content):

- Overlay bars render at the viewport trailing edges and **stay pinned there while scrolling** (sticky host); dragging a thumb moves the content; the thumb tracks native wheel/keyboard scroll.
- **No phantom scroll range** — the max scroll offset equals the content overflow, with no extra blank viewport (confirms the zero-size sticky host adds nothing to `scrollHeight`/`scrollWidth`, and pins from scroll 0 as the first child).
- Native behaviours still work: Ctrl+F match reveal, keyboard (arrows / PageUp·Dn / Home / End / Space), Tab focus-scroll-into-view, text-selection autoscroll, and (in a contenteditable/input child) caret scroll.
- Scroll-edge shadows coexist, painting **beneath** the bars.

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — the new `PanelOverlayScrollbar.test.ts` green; `PanelScrollChaining.test.ts` green with the native pins; `PanelGutterSettle.test.ts` green unedited; `Scrollbar` / `VirtualScroller` suites unaffected; the three geometry-sensitive suites in step 18 green (pinned only if red).
- `grep -rn "scrollbarStyle" src/typescript/lib/` — appears in `Panel.ts`, the `core/index.ts` re-export, and the single `ScrollStrip.ts` opt-out.
- `npm run build:lib` — builds (the library is consumed downstream; a new public option must ship in `dist`).
- `npm run docs:build` — finishes with **zero** warnings (new public JSDoc must not `{@link}` any private/internal symbol; describe internal mechanics in prose per CODE_CONVENTIONS.md).
- Manual smoke test per `## Expected Behaviour` at `localhost:8015`, **broadened to the new default's key consumers now that overlay ships by default**: open a **Dialog** (scrollable content), the **Markdown** window, and a **List / ComboBox drop list**, and confirm each still scrolls, shows the overlay bar, and that **Ctrl+F match reveal + keyboard scroll (PageUp·Dn / arrows / Home / End)** still work with overlay as the default. Confirm a **`ScrollStrip`** (e.g. an overflowing tab strip) still shows its arrow paging and **no** overlay bar.

---

## Documentation Impact

- `scrollbarStyle` / `ScrollbarStyle` are consumer-visible on `Panel`/`PanelOptions`, re-exported from `@jimka/typescript-ui/core`. Run the **document** skill after implementation.
- TypeDoc auto-generates the `Panel` / `PanelOptions` API pages from JSDoc; ensure the new members carry complete doc comments.
- Add a `docs/reference/changelog.md` entry mirroring the existing `Panel.setAutoScroll` entry ([changelog.md#L173](docs/reference/changelog.md#L173)): new `scrollbarStyle` option + `set/getScrollbarStyle`, the `"native" | "overlay"` union re-exported as `ScrollbarStyle`. **Flag it as a default/behaviour change** — every scrolling `Panel` now paints an overlay bar by default; `scrollbarStyle: "native"` restores the OS bar; native scrolling and all its behaviours are unchanged; `ScrollStrip` is pinned native.
- No renames/removals — no existing doc pages reference an old name.

---

## Potential Challenges

- **Sticky host must pin from scroll 0 and add no scroll range.** Guaranteed by `width/height: 0` (zero flow footprint) + first-child insertion (natural flow origin at scroll-port origin). This is the one browser-behaviour assumption; it is the primary manual-verify item (case: "no phantom scroll range").
- **Two `"scroll"` listeners on the panel element** (shadow + overlay) — both fire independently through the `Event` bag; correct, just be aware when reading the wiring.
- **Bar handle release on teardown.** `Scrollbar` bars are appended by element (not `addComponent`), so the container does not lay them out or destroy them. `removeOverlayScrollbars` detaches each bar's element with `removeElement()` and nulls the ref; the bar's own element handle is released when the discarded `Scrollbar` is GC'd (the `Component` finalizer — the same lifecycle `VirtualScroller` relies on for its bars). The raw host handle is released explicitly (`untrackHandle` + `DOM.sink.release`) exactly like `removeScrollShadows`. A runtime `overlay → native` toggle therefore leaks nothing.
- **`overlayMetrics` single-pass V↔H dependency.** Reserving a vertical gutter can shrink inner width enough to trigger a horizontal bar next pass; this settles over one extra `scheduleLayout`, identical to the native `measureScrollbarGutter` convergence — do not add a VirtualScroller-style 2-iteration loop (the native scroll metrics already reflect the previous frame's reserved gutter).

---

## Critical Files

- [`src/typescript/lib/core/Panel.ts`](src/typescript/lib/core/Panel.ts) — the target: `autoScroll`, `getInnerSize`, `measureScrollbarGutter`, `doLayout`, the scroll-shadow lifecycle (`refreshScrollShadows` / `installScrollShadows` / `removeScrollShadows` / `createScrollShadowOverlay`), and the `declare`+seed cascade pattern to mirror.
- [`src/typescript/lib/component/container/Scrollbar.ts`](src/typescript/lib/component/container/Scrollbar.ts) — the overlay widget: `setMetrics` (L549), `"scroll"` event (L504), `getTrackWidth` (L604); confirms `setMetrics` never emits.
- [`src/typescript/lib/component/container/VirtualScroller.ts`](src/typescript/lib/component/container/VirtualScroller.ts) — precedent for wiring two `Scrollbar`s, trailing-edge positioning, effective-viewport reasoning, and metrics push (L127-L139, L382-L420).
- [`src/typescript/lib/core/Component.ts`](src/typescript/lib/core/Component.ts) — `getScrollMetrics`-backed reads, `setScrollTop`/`setScrollLeft` (L3057/L3080), `createStyleRule` (L741), `setElementCSSRule`; native wheel (`_wheelScroller`) is untouched and keeps working under native scroll.
- [`src/typescript/lib/component/container/ScrollStrip.ts`](src/typescript/lib/component/container/ScrollStrip.ts) — local precedent for a `Panel` combining a native-scroll clip with custom scroll affordances (raw-appending affordance elements into the panel element).
- [`src/typescript/lib/core/ScrollShadow.ts`](src/typescript/lib/core/ScrollShadow.ts) + the shadow-overlay code in `Panel.ts` — the sticky viewport-pinning mechanism the scrollbar host mirrors.
- [`tests/core/PanelScrollChaining.test.ts`](tests/core/PanelScrollChaining.test.ts) and [`tests/core/PanelGutterSettle.test.ts`](tests/core/PanelGutterSettle.test.ts) — the offline harness (stub `getScrollMetrics`, drive private methods) the new test mirrors.

---

## Non-Goals

- Do **not** touch `VirtualScroller` or the virtual row views — windowed transform scrolling stays as-is for large Tree/Table (they never route through `Panel.autoScroll`, so the overlay default does not reach them).
- Do **not** implement custom keyboard / find / selection / assistive-tech / caret handling — native scroll provides all of it, which is the reason this native-overlay approach is safe to make the default rather than the transform approach.
- Do **not** remove native-bar mode; `"native"` stays available as the explicit opt-out (and is forced on `ScrollStrip`).
- Do **not** change how native inputs / contenteditable editors **scroll** — their scrolling stays native and fully functional. They are not `Panel`s, so the overlay default does not reach an input's own scroll; where an editor's scrollable content lives inside an `autoScroll` `Panel` (e.g. a form region, the Markdown window), that outer panel now shows an overlay bar by **default** — this is intended and safe (native scroll + caret reveal preserved), not a case to force back to `"native"`.
- Keep the change to `Panel` (and Panel subclasses): the default flips for every scrolling `Panel`, but this plan adds **no** global sweep of non-Panel components and **no** per-component theming / arrow-config surface beyond `Scrollbar`'s existing defaults. The only cross-file edits are the single `ScrollStrip` opt-out and the test pins.
