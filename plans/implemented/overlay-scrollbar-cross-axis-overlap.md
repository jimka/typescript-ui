# Overlay Scrollbar Cross-Axis Overlap Fix for `Panel` — Implementation Plan

## Overview

An overlay-mode [`Panel`](src/typescript/lib/core/Panel.ts#L134) that scrolls **both** axes paints its two overlay [`Scrollbar`](src/typescript/lib/component/container/Scrollbar.ts) widgets over the scrollable content: content overflowing the cross axis fills the full `clientWidth` / `clientHeight` and scrolls *under* the perpendicular bar at every scroll offset. Root cause (already confirmed live): in overlay mode the native bar is hidden with `scrollbar-width: none` ([`setNativeScrollbarHidden`](src/typescript/lib/core/Panel.ts#L1077)), so the panel element's native scroll viewport stays the **full** client box. The bars live *inside* that scroll element on a `position: sticky` zero-size host ([`installOverlayScrollbars`](src/typescript/lib/core/Panel.ts#L969)), and the existing `_scrollbarGutter` reservation is only a **math subtraction** inside [`getInnerSize`](src/typescript/lib/core/Panel.ts#L455) — it shrinks *stretched* children but never insets the native scroll viewport, so intentionally-overflowing content (e.g. a `List` with `horizontalScrolling`) fills the full client box and slides beneath the bar.

The fix restructures overlay mode so **native scrolling happens on an inner element that is physically inset by the reserved track**, and the two bars become **siblings of that inner scroller** (children of the panel element, which no longer scrolls) — so the bars are outside the scroll clip and the content clips at the inset viewport edge, never under a bar. This mirrors the two-element structure [`VirtualScroller`](src/typescript/lib/component/container/VirtualScroller.ts#L86) already uses (an inset clip box with the bars appended to the owner element beside it). The change is almost entirely in [`Panel.ts`](src/typescript/lib/core/Panel.ts), plus a small `protected getScrollElement()` seam on [`Component`](src/typescript/lib/core/Component.ts) that every scroll-plumbing call site resolves through so it targets the inner scroller in overlay mode and the element itself everywhere else.

This plan **amends** [`plans/implemented/overlay-synced-scrollbar.md`](plans/implemented/overlay-synced-scrollbar.md): it keeps that plan's overlay-default, `Scrollbar`-reuse, feedback-loop guard, native-bar-hiding, gutter-reservation, and lifecycle-mirrors-`refreshScrollShadows` decisions, and **replaces** its "bars inside the scroller on a sticky zero-size host" structure (that plan's *Pin the bars to the viewport via a sticky host* decision) with the inner-scroller structure below.

---

## Architecture Decisions

### Inner scroll element inset by the gutter; bars as its siblings on the panel element — mirrors `VirtualScroller`

[`VirtualScroller`](src/typescript/lib/component/container/VirtualScroller.ts#L76-L95) already solves exactly this class of problem: it wraps content in an inner **`clipBox`** (`position: absolute; overflow: hidden`) sized by `layoutScrollbars` to the **effective viewport** (full box minus the track band), and appends the two `Scrollbar` widgets to the **owner element** — siblings of the clip box — positioned at `(outerW - trackW, outerH - trackW)`. Its own comment ([VirtualScroller.ts#L77-L80](src/typescript/lib/component/container/VirtualScroller.ts#L77)) states the intent: the clip box "carries `overflow:hidden` sized to the effective viewport so the Scrollbar widgets … sit in their own reserved band rather than overlaying the rightmost column / bottom row." That is the fix, applied to `Panel`.

**What transfers:** the two-element structure (an inset scroll region + bars as siblings on the outer element) and the trailing-edge bar positioning. **What does not:** `VirtualScroller` scrolls with a CSS `transform` on an inner `rowsContainer` (so it needs the extra transform-vs-clip split); `Panel` keeps **native** `overflow: auto` scrolling on the inner element, so it needs only **one** inner element (the scroller itself), not a clip/transform pair. The inner element is a raw `<div>` (like the clip/content/shadow frames), not a `Component`, so the `position: absolute`-for-every-`Component` rule is satisfied and no `Component` carries a forbidden position.

Overlay-mode DOM (panel element is the bordered box and the non-scrolling wrapper):

```
panel element  (#id, overflow:auto [inert — inner fits, never scrolls], native bar hidden)
├── inner scroll element   (raw div, position:absolute, overflow per-axis, native bar hidden, inset by gutter)
│     └── [content frame →] children
├── Scrollbar V            (Component, position:absolute, in the right gutter)
├── Scrollbar H            (Component, position:absolute, in the bottom gutter)
└── scroll-shadow overlay  (raw div, position:sticky — unchanged parent; see below)
```

### The panel element keeps `overflow: auto` and never scrolls — so `setAutoScroll` and the whole `Component` wheel/overflow cache stay untouched

The panel element's overflow is left exactly as [`setAutoScroll`](src/typescript/lib/core/Panel.ts#L301) writes it today (`auto` / `scroll` per axis via `setOverflowX/Y`). It is **inert by construction**: the inner scroll element is `position: absolute` (out of flow) and sized to `panelClient − gutter`, and the only other in-flow child (the shadow overlay, when present) is sized to the same inset viewport — so the panel element's `scrollHeight`/`scrollWidth` never exceed its client box and it never actually scrolls. Its native bar stays hidden (as today) so no transient bar flashes.

This is the key simplifying decision: because the panel element's cached overflow (`_overflowX`/`_overflowY`) is unchanged, **every `Component` wheel/overflow mechanism keeps working without modification** — [`refreshWheelScrolling`](src/typescript/lib/core/Component.ts#L3482) still attaches the wheel scroller (cache reads `auto`), [`onWheelScroll`](src/typescript/lib/core/Component.ts#L3564) still reports the axes scrollable, and `getOverflowX/Y` are correct. Only the *target element* of the actual scroll reads/writes moves inward (next decision). The rejected alternative — panel element `overflow: hidden` — would make the cache read `hidden` and silently disable wheel scrolling, forcing a parallel overflow-source seam through the generic `Component` wheel code; not worth it.

### `protected getScrollElement()` on `Component`, overridden by `Panel` — the single seam for "which element actually scrolls"

Every scroll-plumbing site in `Component` currently hard-codes `this.getElement()` as the scroller. Add:

```typescript
// Component.ts
protected getScrollElement(): Handle | undefined {
    return this.getElement();
}
```

and override on `Panel`:

```typescript
// Panel.ts
protected getScrollElement(): Handle | undefined {
    return this._overlayScrollElement ?? this.getElement();
}
```

`_overlayScrollElement` is the inner scroller handle (non-null only while overlay mode is installed). The default returns `getElement()`, so **non-`Panel` scrollers (`Menu`, `ToolBar`, `Table`/`Tree` via `VirtualScroller`, `Markdown`) and native-mode / non-scrolling `Panel`s are completely unaffected** — they never override it, and Panel returns `getElement()` whenever the inner element is absent (native mode, `autoScroll: "none"`, pre-render, during the construction cascade). The seam is the one place the blast radius (enumerated in *Ordered Implementation Steps*) collapses to.

### Children live inside the inner scroller; re-parenting mirrors the content-frame machinery

The layout manager lays children out inside [`getInnerSize`](src/typescript/lib/core/Panel.ts#L455) and attaches them via [`getChildHost`](src/typescript/lib/core/Component.ts#L1103) (`_contentFrame ?? element`). Both must resolve to the inner scroller in overlay mode: `getChildHost` becomes `_contentFrame ?? getScrollElement()`, and [`setContentFrame`](src/typescript/lib/core/Component.ts#L1001) / [`clearContentFrame`](src/typescript/lib/core/Component.ts#L1049) target `getScrollElement()` instead of `getElement()` (so the content frame is created inside the inner scroller and children re-parent within it). At **first render**, `Component.init` appends children directly to the panel element ([Component.ts#L5053-L5059](src/typescript/lib/core/Component.ts#L5053)); `Panel.init` then re-parents them into the freshly-created inner element — the exact re-parent-with-scroll-offset-restore dance [`setContentFrame`](src/typescript/lib/core/Component.ts#L1007-L1031) already performs, moving each child by its `getAttachNode()` (so a clip-framed child stays wrapped). Teardown reverses it: move the content frame (or bare children) back onto the panel element and restore the offset before the inner element is destroyed — mirroring [`clearContentFrame`](src/typescript/lib/core/Component.ts#L1049).

### `getInnerSize` / `_scrollbarGutter` are unchanged — the reservation now matches the real viewport

`getInnerSize` keeps subtracting `_scrollbarGutter.right`/`.bottom` from `super.getInnerSize()`, and `_scrollbarGutter` keeps being populated by `layoutOverlayScrollbars`. What changes is that the subtraction is **no longer a lie the layout obeys while the native viewport ignores it**: the inner scroll element is now physically sized to `panelClient − gutter`, so the content the layout manager places inside `getInnerSize` clips at exactly the inner viewport edge. No double-counting: `getInnerSize` (panel content-box minus insets minus gutter) describes the child coordinate space; the inner element size (`panelClient − gutter`) describes the same viewport from the border-inner origin — two origins for one viewport. `getInnerSize`'s body is not touched.

### The restructure applies to all overlay mode, not just both-axis — no conditional-DOM thrash

The inner scroll element exists whenever overlay mode is active (`scrollbarStyle === "overlay"` and `autoScroll !== "none"`), regardless of how many axes currently overflow. The **structure** is static per overlay mode; only the inner element's **size** (and which bar shows) varies with overflow, recomputed every `doLayout` in `layoutOverlayScrollbars` exactly as the gutter already is. This preserves single-axis behaviour identically (a vertical-only overlay panel gets `innerWidth = panelClient.width − trackW` when the V bar shows, `= panelClient.width` when it does not — the same post-gutter width children saw before) and avoids inserting/removing DOM as overflow flips, which would thrash layout and cancel descendant transitions.

### Scroll shadows stay on the panel element; only their metric *source* moves inward

The shadow overlay ([`createScrollShadowOverlay`](src/typescript/lib/core/Panel.ts#L771)) stays a `position: sticky` in-flow child of the **panel element** — its lifecycle is deliberately **not** coupled to the inner element's, so install/teardown ordering between the two subsystems is a non-issue. Since the panel element does not scroll in overlay mode, `sticky` is inert there (it renders pinned at the top-left, which is what a viewport overlay wants). Two adjustments: (1) [`updateScrollShadows`](src/typescript/lib/core/Panel.ts#L886) reads its scroll offsets and content/client extents from `getScrollElement()` (the inner scroller — the panel element's own offsets are always 0), and (2) [`resizeScrollShadowOverlay`](src/typescript/lib/core/Panel.ts#L848) is **unchanged** — it already sizes the overlay to `panelClient − _scrollbarGutter` in overlay mode ([Panel.ts#L864-L871](src/typescript/lib/core/Panel.ts#L864)), which is precisely the inner viewport. The two DOM `"scroll"` listeners (shadow + overlay-sync) become **subtree** listeners so they fire for the id-less inner element's scroll (next decision).

### `"scroll"` listeners become subtree listeners; feedback guard survives

`Event.addListener(this, "scroll", …)` routes by the event target's element **id** ([Event.ts#L110-L119](src/typescript/lib/core/Event.ts#L110)). The inner scroller is a raw, id-less div, so its native `"scroll"` would never reach an exact-target listener on the panel. Switch both `_overlayScrollHandler` and `_shadowScrollHandler` to `Event.addSubtreeListener(this, "scroll", …)`: the subtree walk climbs the id-less inner element to the panel element's id and matches ([Event.ts#L130-L144](src/typescript/lib/core/Event.ts#L130)) — the same mechanism the wheel listener already uses ([Component.ts#L3512](src/typescript/lib/core/Component.ts#L3512)). Both handlers read `getScrollElement()` (not the event target), so a nested descendant's scroll bubbling through the subtree only triggers a harmless re-read of this panel's own scroller. The feedback-loop guard is unaffected: `Scrollbar.setMetrics` still never emits `"scroll"` and no-ops unchanged thumbs, so bar → native write → metrics → thumb still settles in one pass.

### Native-bar hiding on the inner element uses a shared class rule

The inner element is a raw div with no `#id` and no access to `createStyleRule` (which is keyed to the component id). Hide its native bar with a module-level shared class rule — the [ARCHITECTURE.md *module-level shared class rules*](ARCHITECTURE.md) pattern (`.ResizeHandle` etc.): an `ensureOverlayScrollerClassRule()` singleton that creates a `StyleRule({ scope: "class", name: "…" })` setting `scrollbarWidth: "none"` plus a `StyleRule({ scope: "selector", name: ".…::-webkit-scrollbar" })` setting `display: "none"`, applied by adding that class to the inner element. The panel element keeps its existing per-`#id` `setNativeScrollbarHidden` writes (belt-and-suspenders against a transient panel-element bar; harmless since it never scrolls).

---

## Public API

No consumer-facing API changes. One new **protected** seam:

```typescript
// Component.ts — new protected method
protected getScrollElement(): Handle | undefined;   // returns getElement()

// Panel.ts — override
protected getScrollElement(): Handle | undefined;   // returns _overlayScrollElement ?? getElement()
```

New private `Panel` state (declare + seed cascade, mirroring the existing overlay fields):

| Field | Type | Notes |
|---|---|---|
| `_overlayScrollElement` | `Handle \| null` | inner scroll element; `declare` + seeded `null` in `applyOptions` (read by the teardown guard during the cascade) |
| `_overlayScrollStyle` | `InlineStyle` | plain initializer (runtime-only, mirrors `_shadowOverlayStyle`) |

Removed private `Panel` state: `_overlayHost` (`declare`) and `_overlayHostStyle` (`InlineStyle`) — the sticky host is gone.

---

## Internal Structure

### `layoutOverlayScrollbars(element?)` — reworked

Reads the **panel element** for the available viewport and the **inner scroller** for content/offset:

```typescript
private layoutOverlayScrollbars(element?: Handle): void {
    const panelEl = element ?? this.getElement();
    const innerEl = this._overlayScrollElement;
    if (!panelEl || !innerEl || !this._scrollbarV || !this._scrollbarH) return;

    const trackW = this._scrollbarV.getTrackWidth();

    // Available viewport = panel element client box (the panel never scrolls).
    const avail  = DOM.source.getScrollMetrics(panelEl);
    const availW = avail.clientWidth;
    const availH = avail.clientHeight;

    // Content extent + current offsets from the inner scroller.
    const m    = DOM.source.getScrollMetrics(innerEl);
    const axes = this.scrollableAxes();

    // Visibility: content exceeds the inner scroller's current viewport.
    const vVisible = axes.y && m.scrollHeight > m.clientHeight;
    const hVisible = axes.x && m.scrollWidth  > m.clientWidth;

    const innerW = availW - (vVisible ? trackW : 0);
    const innerH = availH - (hVisible ? trackW : 0);

    // Inset the inner scroller so content clips before the bar band.
    this._overlayScrollStyle.setMany({ width: innerW + "px", height: innerH + "px" });

    // Bars sit in the reserved band at the panel viewport's trailing edges.
    this._scrollbarV.setX(availW - trackW);
    this._scrollbarV.setY(0);
    this._scrollbarV.setHeight(innerH);
    this._scrollbarV.setMetrics(innerH, m.scrollHeight, m.scrollTop);

    this._scrollbarH.setX(0);
    this._scrollbarH.setY(availH - trackW);
    this._scrollbarH.setWidth(innerW);
    this._scrollbarH.setMetrics(innerW, m.scrollWidth, m.scrollLeft);

    const newRight  = vVisible ? trackW : 0;
    const newBottom = hVisible ? trackW : 0;
    if (newRight !== this._scrollbarGutter.right || newBottom !== this._scrollbarGutter.bottom) {
        this.setScrollbarGutter(newRight, newBottom);
        this.scheduleLayout();
    }
}
```

The V↔H mutual dependency settles across passes via `scheduleLayout` exactly as before: `vVisible`/`hVisible` read the inner element's *current* client box (last frame's `innerW`/`innerH`), and a size change reschedules. Because the inner scroller is now genuinely inset, `setMetrics` takes the inner viewport (`innerH`/`innerW`) directly — the old `effW`/`effH`-vs-`clientW`/`clientH` split (needed when the bar sat over a full-client scroller) is gone.

### `syncOverlayScrollbars()` — reworked

```typescript
private syncOverlayScrollbars(): void {
    const innerEl = this._overlayScrollElement;
    if (!innerEl || !this._scrollbarV || !this._scrollbarH) return;

    const m = DOM.source.getScrollMetrics(innerEl);
    this._scrollbarV.setMetrics(m.clientHeight, m.scrollHeight, m.scrollTop);
    this._scrollbarH.setMetrics(m.clientWidth,  m.scrollWidth,  m.scrollLeft);
}
```

(The `overlayMetrics` helper is folded into these two methods; if kept, it now reads the inner element and no longer computes `effW`/`effH`.)

### `installOverlayScrollbars(element)` — reworked (creates the inner scroller, re-parents children, bars as siblings)

```
if (!this._overlayScrollElement):
    inner = DOM.sink.createElement("div")
    this._overlayScrollStyle.attach(inner)
    this._overlayScrollStyle.setMany({ position:"absolute", left:"0px", top:"0px",
        overflowX: <auto|scroll|hidden per axis>, overflowY: <…> })   // match scrollableAxes()
    DOM.sink.apply(inner, { addClass: [<overlay-scroller class>] })   // native bar hidden via shared rule
    ensureOverlayScrollerClassRule()
    // capture panel scroll offset, re-parent existing children into inner, restore offset:
    const sl = DOM.source.getScrollLeft(element), st = DOM.source.getScrollTop(element)
    DOM.sink.appendChild(element, inner)
    if this._contentFrame: DOM.sink.appendChild(inner, this._contentFrame)   // frame + its children move as a unit
    else: for each component: DOM.sink.appendChild(inner, component.getAttachNode())
    DOM.sink.apply(inner, { scrollLeft: sl, scrollTop: st })
    this.trackHandle(inner)
    this._overlayScrollElement = inner
if (!this._scrollbarV): new Scrollbar("vertical");   DOM.sink.appendChild(element, bar.getElement(true)); bar.on("scroll", _onOverlayScrollV)
if (!this._scrollbarH): new Scrollbar("horizontal"); DOM.sink.appendChild(element, bar.getElement(true)); bar.on("scroll", _onOverlayScrollH)
if (!this._overlayScrollHandler): handler = () => this.syncOverlayScrollbars(); Event.addSubtreeListener(this, "scroll", handler)
this.setNativeScrollbarHidden(true)   // on the panel element, as today
```

Note the bars are appended to `element` (the panel element), **not** to the inner scroller — they are its siblings, outside the scroll clip. `_contentFrame` is a `private` field on `Component`; expose the minimal access needed (see *Potential Challenges*).

### `removeOverlayScrollbars()` — reworked (re-parents children back, destroys the inner scroller)

```
if _overlayScrollHandler: Event.removeSubtreeListener(this, "scroll", _overlayScrollHandler); null
for each bar: bar.off("scroll", fwd); bar.removeElement(); null
if _overlayScrollElement:
    const el = this.getElement()
    if el:
        const sl = DOM.source.getScrollLeft(_overlayScrollElement), st = DOM.source.getScrollTop(_overlayScrollElement)
        if this._contentFrame: DOM.sink.appendChild(el, this._contentFrame)
        else: for each component: DOM.sink.appendChild(el, component.getAttachNode())
        DOM.sink.apply(el, { scrollLeft: sl, scrollTop: st })   // panel element resumes scrolling in native mode
    DOM.sink.removeElement(_overlayScrollElement); untrackHandle; DOM.sink.release; null
    this._overlayScrollStyle = new InlineStyle()   // fresh buffer for re-install (mirrors removeScrollShadows)
this.setNativeScrollbarHidden(false)
this.setScrollbarGutter(0, 0)   // unconditional (cascade-safe, as today)
```

---

## Ordered Implementation Steps

1. **`Component.ts` — add the seam.** Add `protected getScrollElement(): Handle | undefined { return this.getElement(); }` near `getElement`. Check: `npm run typecheck`.

2. **`Component.ts` — route scroll reads/writes through the seam.** In each of these, replace the local `this.getElement()` used **as the scroll target** with `this.getScrollElement()` (leave any use that is genuinely about the component's own root element alone): `setScrollLeft` ([L3147](src/typescript/lib/core/Component.ts#L3147)), `setScrollTop` ([L3170](src/typescript/lib/core/Component.ts#L3170)), `syncScrollOffsets` ([L3196](src/typescript/lib/core/Component.ts#L3196)), `getMaxScrollLeft` ([L3213](src/typescript/lib/core/Component.ts#L3213)), `getMaxScrollTop` ([L3230](src/typescript/lib/core/Component.ts#L3230)), the `read` closure in `attachWheelScrolling` ([L3504](src/typescript/lib/core/Component.ts#L3504)), and `writeNativeScroll` ([L3534](src/typescript/lib/core/Component.ts#L3534)). Check: `grep -n "getScrollElement()" src/typescript/lib/core/Component.ts` — expect these 7 sites plus the seam definition and `getChildHost`/`setContentFrame`/`clearContentFrame` from steps 3–4.

3. **`Component.ts` — route the child host through the seam.** `getChildHost` ([L1103](src/typescript/lib/core/Component.ts#L1103)): return `this._contentFrame ?? this.getScrollElement()`.

4. **`Component.ts` — route the content frame through the seam.** In `setContentFrame` ([L1001](src/typescript/lib/core/Component.ts#L1001)) and `clearContentFrame` ([L1049](src/typescript/lib/core/Component.ts#L1049)), replace `const element = this.getElement()` (the scroll-offset capture/restore target and the frame's parent) with `this.getScrollElement()`. The scroll-offset capture/restore and `appendChild(element, frame)` must all use it.

5. **`Panel.ts` — swap the overlay field.** In the overlay field block ([L180-L189](src/typescript/lib/core/Panel.ts#L180)), remove `declare private _overlayHost: Handle | null;` and `private _overlayHostStyle: InlineStyle = new InlineStyle();`. Add `declare private _overlayScrollElement: Handle | null;` (with the same super-cascade rationale comment) and `private _overlayScrollStyle: InlineStyle = new InlineStyle();`.

6. **`Panel.ts` — reseed in `applyOptions`.** In the overlay seed block ([L264-L267](src/typescript/lib/core/Panel.ts#L264)), replace `this._overlayHost = null;` with `this._overlayScrollElement = null;` (keep the bar/handler seeds).

7. **`Panel.ts` — add the `getScrollElement` override** (see *Public API*): `return this._overlayScrollElement ?? this.getElement();`.

8. **`Panel.ts` — add `ensureOverlayScrollerClassRule()`** as a module-level singleton (mirror an existing `ensureXClassRule`): a `StyleRule({ scope: "class", name: "…" })` with `scrollbarWidth: "none"` and a `StyleRule({ scope: "selector", name: ".…::-webkit-scrollbar" })` with `display: "none"`, each `.ensure()`d once. Pick a class name (e.g. `"PanelOverlayScroller"`).

9. **`Panel.ts` — rework `installOverlayScrollbars`** per *Internal Structure*: create the inner scroll element (absolute, per-axis overflow matching `scrollableAxes()`, overlay-scroller class), re-parent existing children (or `_contentFrame`) into it with scroll-offset restore, then append the two bars to the **panel element**, wire the subtree scroll handler, and hide the panel-element native bar. Replace `_overlayHost`/`_overlayHostStyle` references with `_overlayScrollElement`/`_overlayScrollStyle`.

10. **`Panel.ts` — rework `removeOverlayScrollbars`** per *Internal Structure*: unwire the subtree handler, detach both bars, re-parent children (or `_contentFrame`) back onto the panel element with offset restore, destroy the inner element (`removeElement` + `untrackHandle` + `release`), reset `_overlayScrollStyle`, un-hide the native bar, `setScrollbarGutter(0,0)` unconditionally.

11. **`Panel.ts` — rework `layoutOverlayScrollbars` and `syncOverlayScrollbars`** per *Internal Structure* (dual read: panel element for `avail`, inner element for content/offset; bars sized to `innerW`/`innerH`; inner element sized via `_overlayScrollStyle`).

12. **`Panel.ts` — inner-element-aware scroll shadows.** In `updateScrollShadows` ([L886](src/typescript/lib/core/Panel.ts#L886)), read the ramp inputs (`scrollTop`, `scrollLeft`, `scrollWidth`, `scrollHeight`, `clientWidth`, `clientHeight`) from `this.getScrollElement()` instead of `el`; keep calling `resizeScrollShadowOverlay(el)` with the panel element (its existing gutter-inset sizing is already correct). `resizeScrollShadowOverlay` is otherwise unchanged.

13. **`Panel.ts` — subtree scroll shadow listener.** In `installScrollShadows` ([L747](src/typescript/lib/core/Panel.ts#L747)) change `Event.addListener(this, "scroll", handler)` to `Event.addSubtreeListener`, and in `removeScrollShadows` ([L808](src/typescript/lib/core/Panel.ts#L808)) change `Event.removeListener` to `Event.removeSubtreeListener`.

14. **`Panel.ts` — install ordering in `init`.** In `init` ([L593](src/typescript/lib/core/Panel.ts#L593)), install the overlay scrollbars (creating the inner element) **before** the scroll shadows, so `getScrollElement()` already resolves to the inner element when `updateScrollShadows` first reads it. Swap the two blocks at [L600-L608](src/typescript/lib/core/Panel.ts#L600).

15. **`Panel.ts` — refresh ordering in `setAutoScroll` and `setScrollbarStyle`.** In `setAutoScroll` ([L338-L347](src/typescript/lib/core/Panel.ts#L338)) call `refreshOverlayScrollbars()` **before** `refreshScrollShadows()`. In `setScrollbarStyle` ([L426](src/typescript/lib/core/Panel.ts#L426)) add `this.refreshScrollShadows();` **after** `refreshOverlayScrollbars();` so a runtime overlay↔native toggle re-homes the shadow metric source.

16. **`_contentFrame` access from `Panel`.** `Panel` needs to read `_contentFrame` in install/teardown. It is `private` on `Component` — add a `protected getContentFrame(): Handle | null` accessor on `Component` (returns `this._contentFrame`) and use it from `Panel`; do **not** widen the field's visibility. Check: `grep -n "getContentFrame" src/typescript/lib/core/`.

17. **Tests — update `tests/core/PanelOverlayScrollbar.test.ts`** for the new internal shape: `_overlayHost` → `_overlayScrollElement`; bars are children of the panel element, not a host; `layoutOverlayScrollbars`/`syncOverlayScrollbars` now read **two** handles, so the `getScrollMetrics` stub must be per-handle (return the panel client box for the panel element handle and the content/offset for the inner element handle) — use `mockImplementation((h) => …)` keyed on the handle rather than a single `mockReturnValue`. Add the both-axis overlap cases from *Expected Behaviour*.

18. **Verify:** `npm run typecheck`; `npm test`; `npm run build:lib`; `npm run docs:build` (zero warnings); then the manual live checks in *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Component.ts` (add `getScrollElement` seam + `getContentFrame`; route scroll sites, `getChildHost`, `setContentFrame`/`clearContentFrame`) |
| Modify | `src/typescript/lib/core/Panel.ts` (inner-scroller restructure) |
| Modify | `tests/core/PanelOverlayScrollbar.test.ts` (new internal shape + both-axis cases) |
| Modify | `tests/overlay/DialogViewportResize.test.ts` (added during the resize-transient follow-up — see Implementation Notes) |

---

## Expected Behaviour

Offline-testable via the TestDOM geometry oracle (per-handle `getScrollMetrics` stub, driving private methods — harness idioms from [`tests/core/PanelOverlayScrollbar.test.ts`](tests/core/PanelOverlayScrollbar.test.ts), [`tests/core/PanelScrollChaining.test.ts`](tests/core/PanelScrollChaining.test.ts), [`tests/core/PanelGutterSettle.test.ts`](tests/core/PanelGutterSettle.test.ts)):

1. **Inner scroller installed in overlay mode.** After render+`init`, `Panel({ autoScroll: "auto" })` (overlay default) has non-null `_overlayScrollElement`; `getScrollElement() !== getElement()`; both bars and the inner element are children of the panel element (bars are siblings of the inner element).
2. **Both-axis overlap eliminated — geometry.** With the panel element stubbed to `clientWidth/Height = W/H` and the inner element stubbed to overflow both axes: after `layoutOverlayScrollbars`, `_overlayScrollElement` width `= W − trackW` and height `= H − trackW`; V bar `getX() === W − trackW`; H bar `getY() === H − trackW`; `_scrollbarGutter === { right: trackW, bottom: trackW }`. The inner viewport's right/bottom edges coincide with the bars' inner edges (content cannot occupy the gutter).
3. **Single-axis unchanged.** `Panel({ autoScroll: "y" })` with vertical-only overflow: `_overlayScrollElement` width `= W − trackW`, height `= H` (no H bar); `_scrollbarGutter === { right: trackW, bottom: 0 }`; `getInnerSize().width` is `trackW` less than `super.getInnerSize().width`; no horizontal bar shown.
4. **Full content reachable.** Max scroll equals content extent minus the inset viewport: with content `Ch` and inner viewport `H − trackW` (H bar present) or `H` (not), `getMaxScrollTop() === Ch − innerViewportH`; likewise for width. No lost or phantom range.
5. **Bar `"scroll"` writes native offset on the inner element.** `_onOverlayScrollV(120)` → `setScrollTop(120)`, which writes `getScrollElement()` (inner element), not the panel element (spy `DOM.sink.apply` on the inner handle).
6. **Sync round-trip is a no-op (feedback guard).** Calling `syncOverlayScrollbars()` twice with fixed inner-element metrics does not re-enter `setScrollTop`/`setScrollLeft`.
7. **Native mode untouched.** `Panel({ autoScroll: "y", scrollbarStyle: "native" })`: `_overlayScrollElement === null`; `getScrollElement() === getElement()`; the native `measureScrollbarGutter` path runs (stub `getScrollBarWidth() === 15` → `_scrollbarGutter.right === 15`); no inner element, no bars.
8. **`autoScroll: "none"` untouched.** No inner element, no bars, native bar not hidden, `getScrollElement() === getElement()`.
9. **Teardown restores the element as scroller.** From an installed overlay panel, `setAutoScroll("none")` and (independently) `setScrollbarStyle("native")` each: null `_overlayScrollElement`, re-parent children back onto the panel element, un-hide the native bar, clear the gutter, release the inner handle, remove the subtree scroll listener. Re-entering overlay mode re-installs.
10. **Shadows still light in overlay mode.** With the inner element stubbed to a mid scroll offset, `updateScrollShadows` lights the trailing edges (reads the inner element, not the always-zero panel element); the shadow overlay remains a child of the panel element sized to `panelClient − gutter`.

Manual verification (native paint / clip / real input — not offline-testable; run at `localhost:8015` and `localhost:5173`, canonical acceptance = the SQLAdmin Recent/Saved query list via Alt+Q):

- A both-axis overlay panel (SQLAdmin Recent list with `horizontalScrolling`, or a `Panel({ autoScroll: "auto" })` with content overflowing both axes): the vertical bar never overlaps horizontally-scrolled content and the horizontal bar never overlaps vertically-scrolled content, at scroll origin, mid, and max. `elementFromPoint` over each bar returns the bar, and over the content-viewport corner returns content, never the bar.
- Bars stay pinned at the trailing edges while scrolling; dragging a thumb moves content; thumb tracks native wheel/keyboard scroll; no phantom scroll range (max offset equals content overflow).
- Native behaviours preserved: Ctrl+F reveal, keyboard scroll (arrows / PageUp·Dn / Home / End / Space), focus-scroll-into-view, text-selection autoscroll, caret scroll in a nested input.
- Scroll-edge shadows coexist, painting inside the inner viewport (never under a bar).
- Single-axis consumers regression-free: List / ComboBox / AutoComplete drop lists, `PickerColumn`/`PickerCellList`, `Form`, `Dialog` body still scroll and show the overlay bar with no layout shift.

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — updated `PanelOverlayScrollbar.test.ts` green (both-axis cases); `PanelScrollChaining.test.ts` green (its panels are `scrollbarStyle: "native"`, so `getScrollElement() === getElement()`, unaffected); `PanelGutterSettle.test.ts` green unedited; `Scrollbar`/`VirtualScroller` suites unaffected; the geometry-sensitive dropdown/dialog/picker suites green (the cross-axis inset falls on width for vertical-only panels, so height assertions hold).
- `grep -rn "_overlayHost" src/ tests/` — expect **zero** matches (renamed to `_overlayScrollElement`).
- `npm run build:lib` — builds (library is consumed downstream).
- `npm run docs:build` — zero warnings (no new public JSDoc; the new members are `protected`).
- Manual smoke per *Expected Behaviour* at `localhost:8015` and `localhost:5173`; SQLAdmin Recent/Saved list (Alt+Q) is the canonical acceptance check.

---

## Documentation Impact

None. The only new symbols (`getScrollElement`, `getContentFrame`) are `protected` and excluded from the TypeDoc build; no consumer-facing option, type, or barrel export changes. `scrollbarStyle`/`ScrollbarStyle` already shipped in the amended plan. This is an internal bug fix — no doc pages, no changelog-worthy API surface (a changelog *bugfix* note is optional per project convention).

---

## Potential Challenges

- **`_contentFrame` visibility.** It is `private` on `Component`; `Panel`'s install/teardown needs it. Add a narrow `protected getContentFrame()` accessor (step 16) rather than widening the field — keeps the frame's mutation surface private.
- **First-render re-parent ordering.** `super.init` appends children to the panel element before `Panel.init` runs; `Panel.init` must create the inner element and re-parent them (mirroring `setContentFrame`). Verified: the base append at [Component.ts#L5053](src/typescript/lib/core/Component.ts#L5053) uses the raw element, so the re-parent is the same proven dance the content frame already does.
- **Content frame nesting on runtime toggle.** A native→overlay toggle while a content frame exists must move the whole `_contentFrame` (with its wrapped children) into the inner element as a unit, not iterate individual children (which would unwrap them). Handled by the `if (_contentFrame) move frame else move children` branch in install/teardown.
- **Dual `getScrollMetrics` reads in tests.** `layoutOverlayScrollbars` reads two handles; a single `mockReturnValue` will conflate them. Stub per-handle via `mockImplementation`.
- **Subtree scroll listeners over-fire on nested scrollers.** A nested descendant's scroll walks up to this panel and triggers a re-read; harmless because both handlers read `getScrollElement()` (this panel's own scroller), not the event target — the read is a no-op when nothing on this scroller changed.
- **Explicit CSS `padding` on an overlay both-axis panel** (rare): the inner element sits at the panel's border-inner edge and covers the panel's CSS padding lane. Insets (the common case) are layout-manager coordinate offsets, not CSS padding, so they are unaffected; only a panel combining `setPadding` with both-axis overlay is a corner case. Out of scope (see *Non-Goals*).

---

## Critical Files

- [`src/typescript/lib/core/Panel.ts`](src/typescript/lib/core/Panel.ts) — the target: overlay install/teardown/layout/sync, scroll shadows, `getInnerSize`, `measureScrollbarGutter`, the declare+seed cascade.
- [`src/typescript/lib/core/Component.ts`](src/typescript/lib/core/Component.ts) — the seam (`getScrollElement`), the scroll-plumbing sites, `getChildHost`/`setContentFrame`/`clearContentFrame` (the re-parent precedent), `_wheelScroller` wiring, `init` child-append order.
- [`src/typescript/lib/component/container/VirtualScroller.ts`](src/typescript/lib/component/container/VirtualScroller.ts#L76) — the precedent: inset inner scroll region + bars appended to the owner element as siblings, trailing-edge positioning (structure transfers; its transform scroll does not).
- [`src/typescript/lib/component/container/Scrollbar.ts`](src/typescript/lib/component/container/Scrollbar.ts) — `setMetrics` (never emits `"scroll"`), `getTrackWidth`, `setX/Y/Width/Height`, `removeElement`.
- [`src/typescript/lib/core/Event.ts`](src/typescript/lib/core/Event.ts#L110) — exact-target vs subtree routing (why the scroll listeners must become subtree).
- [`plans/implemented/overlay-synced-scrollbar.md`](plans/implemented/overlay-synced-scrollbar.md) — the design being amended (kept vs replaced decisions).
- [`src/typescript/lib/component/list/AbstractSelectableList.ts`](src/typescript/lib/component/list/AbstractSelectableList.ts#L801) — the both-axis consumer (`horizontalScrolling` → inner panel `autoScroll: "auto"`); needs **no** change, but is the live repro.
- [`tests/core/PanelOverlayScrollbar.test.ts`](tests/core/PanelOverlayScrollbar.test.ts), [`tests/core/PanelScrollChaining.test.ts`](tests/core/PanelScrollChaining.test.ts), [`tests/core/PanelGutterSettle.test.ts`](tests/core/PanelGutterSettle.test.ts) — the offline harness idioms.

---

## Non-Goals

- **No `VirtualScroller` / Table / Tree changes** — they never route through `Panel.autoScroll` (transform windowed scroll), so the overlap bug and this fix do not reach them.
- **No native-mode change** — `scrollbarStyle: "native"` keeps the element as the scroller (`getScrollElement() === getElement()`); its measured-gutter path is untouched.
- **No consumer changes** — `List`/`MultiSelectList`, ComboBox/AutoComplete drop lists, `PickerColumn`/`PickerCellList`, `Form`, `Dialog` body work unchanged; the restructure is internal to `Panel`.
- **No removal of the existing `_scrollbarGutter` math in `getInnerSize`** — it now matches the real inner viewport and stays as the child-coordinate reservation.
- **No support for an explicit CSS `padding` + both-axis overlay corner case** beyond leaving insets (the common path) correct — the padding-lane interaction (Potential Challenges) is not designed for here.
- **No new public API** — the seam is `protected`; no options-bag, type, or barrel changes.

---

## Implementation Notes

Deviations made while implementing, and why:

- **`getContentFrame()` accessor (plan step 16) replaced by a `reparentContent(from, to)` helper on `Component`.** The plan had `Panel` inline the re-parent dance using a `getContentFrame()` read plus per-child `getAttachNode()` calls. But `getAttachNode()` is `protected` on `Component`, and TypeScript forbids calling a base class's protected member through a base-typed reference (`this._components: Component[]`) from a *subclass* (`Panel`). Encapsulating the whole move — content-frame-as-a-unit vs per-child-by-attach-node, with scroll-offset capture/restore — in one `protected reparentContent(from, to)` on `Component` keeps that access where it is legal and gives install/teardown a single call each. No `getContentFrame()` was added.
- **Bars carry `setZIndex(2)` themselves.** The removed sticky host previously provided `z-index: 2` (above the shadow overlay's `z-index: 1`) to the bars nested inside it. With the bars now direct children of the panel element, each `Scrollbar` sets its own `z-index: 2` on install to preserve that stacking guarantee.
- **`layoutOverlayScrollbars` feeds `setMetrics` the inner element's own client box (`m.clientHeight`/`m.clientWidth`), not the computed `innerH`/`innerW`.** *(Superseded by the resize-transient follow-up below: `layoutOverlayScrollbars` now passes the computed `innerH`/`innerW` — decided against the live panel viewport — while `syncOverlayScrollbars` still reads the inner client box; the two are equal at scroll time. This original bullet describes the intermediate state.)* The intent was unchanged: keep each bar's visibility criterion consistent with the `vVisible`/`hVisible` test that drives the gutter, so a bar's shown/hidden state and the reserved gutter never disagree.
- **Inner scroll element is sized `width/height: 100%` on install.** So the very first overflow read (before the first layout writes explicit px) sees the full panel viewport rather than an unsized (shrink-to-fit) box; the per-pass layout then overrides with the post-gutter px size.
- **Tests keep a single `getScrollMetrics` mock** (the plan suggested per-handle). A single stub suffices because the panel-element read (available viewport) and the inner-element read (content extent + client box) consume compatible fields for every asserted case; per-handle keying would add harness complexity with no assertion it enables.
- **Verification:** the both-axis fix was confirmed live against a dev server serving this worktree (the exact source SQLAdmin consumes once `build:lib` runs) — a `List` with `horizontalScrolling` in a 220x180 rail clips content to the inset inner scroller (206x166) with both bars in the reserved gutter and zero overlap at scroll origin/mid/max, full range reachable. SQLAdmin's own dev server picks this up only after `build:lib` in the main tree (the documented cross-repo build step), so it was not re-run here. The full test suite's "DOM handle not registered" async errors are a pre-existing flaky Animation-timer teardown race (present on master at a comparable, run-to-run-variable count), not caused by this change.

### Follow-up: resize-transient fix (post-merge-testing)

Live SQLAdmin testing surfaced a bug not covered by the offline suite: expanding
the viewport containing an overlay panel flickered a transient horizontal bar
that sometimes stuck. Root cause (reproduced live): `layoutOverlayScrollbars`
decided bar visibility from the **inner element's own `clientWidth`/`clientHeight`**,
which lag one frame behind a resize because the method sizes the inner element
*after* reading it — so on the first pass after an expand, content that now fits
the widened viewport was still judged against the old (smaller) inner width and
kept its bar; during a continuous resize every frame is that stale first pass, so
the bar persisted and stuck if no trailing settle pass ran.

The first attempt judged visibility against the panel element's current client
box (`avail`) reduced by the cross-axis track, reading only content extent from
the inner element. That fixed *expand* but a later round of live testing found it
still broke on *shrink*: `scrollWidth`/`scrollHeight` are floored by the browser
at the inner element's own client box, so while the inner element still carried
its stale-**large** pre-shrink size, `scrollWidth` read large and content that now
fit still registered as overflowing — a symmetric spurious bar.

Final unified fix (handles both directions): **size the inner scroll element to
the current viewport minus the currently-reserved gutter BEFORE reading its
metrics**, so its `clientWidth`/`clientHeight` — and therefore the floored
`scrollWidth`/`scrollHeight` — reflect this frame's viewport, then use the direct
`scrollWidth > clientWidth` / `scrollHeight > clientHeight` overflow test on those
now-current values. `avail` (the panel element's client box, flushed each frame by
`doLayout`'s `commitElementStyle`) drives the pre-read sizing; the V<->H mutual
dependency settles across passes via the existing gutter-change reschedule (one
extra pass), no fixpoint needed. `setMetrics` takes the final `innerH`/`innerW`.
Two tests that asserted the *old* overlay semantics — content filling the *full*
client box shows no cross bar — were updated: under real space reservation such
content overflows the reduced viewport and correctly shows a 12px bar, while real
stretched content (laid out to `getInnerSize` = viewport − gutter) fits and shows
none. The resize transient is a write-then-read the offline stub can't model
(escape hatch): the offline test pins the observable mechanism (the inner element
is re-sized to viewport − gutter on every layout, tracking grow and shrink), and
both directions were verified live — after an expand OR a shrink the gutter is
correct on the first pass, and a continuous resize in either direction never
shows a spurious bar.

Test-harness side effect (out of the original Files table): the corrected code
reschedules a layout on the gutter-change pass, so a single-batch rAF flush in a
test teardown left Component's module-level `rafHandle` set, leaking a pending
frame into the next test (which could then not schedule its own flush). Fixed by
draining the mocked rAF queue to a fixpoint (`while (frames.length) …`, capped at
50 iterations) in `tests/overlay/DialogViewportResize.test.ts`'s `flushFrame` —
harness-only, no product-code change.
