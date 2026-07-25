# Diagram Viewport Navigation — Implementation Plan

## Overview

This plan gives [`DiagramView`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) an infinite-canvas viewport: free (unbounded) pan, a fit / reset / zoom control cluster, an adaptive minimum zoom so a huge graph can actually fit, a grab cursor, and a new `"contextmenu"` node event. All of it is additive to the public options bag and keeps the existing `on` / `off` / `emit` and `callable()` shape.

The change rewrites the viewport-motion model. Today pan is native scroll on the `Panel` viewport ([`_handlePointerMove:797`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L797) writes `setScrollLeft` / `setScrollTop`), so the graph is clamped to its content extent — at scroll `0,0` you cannot drag it into empty space. The rewrite moves pan **and** zoom onto the content host's CSS transform (which already carries `scale(zoom)` — [`applyZoomToHost:443`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L443)), extending it to `translate(panX, panY) scale(zoom)` with unbounded `panX` / `panY`. Native scroll is dropped. Everything that read scroll offsets — wheel-zoom-about-pointer ([`_handleWheel:750`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L750)), `revealNode` ([`:550`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L550)), and `zoomToFit` ([`:491`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L491)) — moves to the pan/zoom transform model.

**This plan depends on branch `fix/diagram-pan-subtree-listeners` being merged first.**[^prereq] That branch switches the six pan/zoom DOM handlers in `init()` from exact-target `Event.addListener` to `Event.addSubtreeListener` and adds a `(event.buttons & 1) === 0` guard in `_handlePointerMove`. The plan below assumes those subtree listeners are in place and does **not** re-do that fix. Verify the current `init()` wiring before editing — the line numbers here are from `master` (pre-fix) and shift by a few lines once the fix lands.

---

## Architecture Decisions

### Transform-based pan, not overscroll padding

Pan and zoom both live on the content host's `transform`; `panX` / `panY` are unbounded numbers updated directly by the drag.[^transform] The alternative — padding the scroll content so native scroll can reach empty space — was rejected: it only pushes the clamp outward by a fixed margin, so it is not truly unbounded, and it keeps two coordinate systems (scroll + transform) that the wheel/reveal/fit math must reconcile.

### Drop native scroll — pure transform, no scrollbars

The constructor's `setAutoScroll("auto")` ([`:156`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L156)) is removed. The `Panel` falls back to its default `overflow: hidden` ([Component:421](packages/lib/src/typescript/lib/core/Component.ts#L421)), which is exactly the viewport clip we want — content panned outside the viewport is clipped, giving the infinite-canvas feel. Scrollbars are dropped, not kept as a position indicator.[^scrollbars]

### Free pan is the only pan mode

There is no option to switch back to clamped native-scroll pan. Unbounded pan strictly supersedes the old behaviour; a toggle would mean maintaining two pan implementations for no use case.[^panmode]

### Corner-pinned controls via the `Anchor` layout, not a `doLayout` override

`DiagramView`'s layout manager changes from the default `Absolute` to [`Anchor`](packages/lib/src/typescript/lib/layout/Anchor.ts). `Anchor` is the resize-reactive twin of `Absolute`: a child with **no** anchor constraints falls back to its own `getX` / `getY` at its preferred size (identical to `Absolute` — [Anchor:129](packages/lib/src/typescript/lib/layout/Anchor.ts#L129)), so the content host keeps behaving exactly as today, while the control cluster gets `{ right, bottom }` constraints and stays pinned to the bottom-right corner as the viewport resizes — no manual repositioning code.[^anchor]

### Controls are a built-in cluster, visible by default

The zoom / fit / reset controls are an optional built-in cluster (`controls?: boolean`, default `true`), built as a composed `Component` + `VBox` of `Button`s, mirroring `VideoPlayer`'s control bar ([VideoPlayer:598](packages/lib/src/typescript/lib/component/display/VideoPlayer.ts#L598)). Default-visible because unbounded pan makes it easy to lose the graph off-screen, so an on-screen fit / reset control is the recovery path.[^controls]

### No auto-fit on first layout

The initial render keeps the configured zoom (default `1`) at pan `0` — the current behaviour. A large graph shows its top-left corner until the user hits Fit; a consumer wanting auto-fit calls `zoomToFit()` from a `"layout"` listener.[^autofit]

### Adaptive minimum zoom

`clampZoom`'s floor becomes `min(configuredMinZoom, fitZoom)` where `fitZoom` is computed live from the graph bounds and viewport. Small graphs are unaffected (their `fitZoom ≥ configuredMin`, so the floor stays at `configuredMin`); a huge graph lowers the floor so `zoomToFit` can reach the tiny zoom that actually fits it.[^adaptivemin]

### `"contextmenu"` node event mirrors `Tree`

A new `"contextmenu"` event with signature `(node: DiagramNodeData, event: MouseEvent)` is added to the `on` / `off` / `emit` surface and the `listeners` bag, wired via `Event.addSubtreeListener(this, "contextmenu", handler)`. The handler resolves the node under the target; on a hit it calls `event.preventDefault()` and emits, on empty canvas it emits nothing — a direct mirror of `Tree._handleContextMenu` ([Tree:894](packages/lib/src/typescript/lib/component/tree/Tree.ts#L894)).[^contextmenu]

---

## Public API

New / changed members on `DiagramView` (all others unchanged):

```typescript
export type DiagramViewEvent =
    "selection" | "activate" | "layout" | "contextmenu";   // + "contextmenu"

export interface DiagramViewOptions extends PanelOptions {
    // ... existing fields unchanged ...
    /** Show the built-in zoom / fit / reset control cluster (default true). */
    controls?: boolean;
    listeners?: {
        selection?:   (nodes: DiagramNodeData[]) => void;
        activate?:    (node: DiagramNodeData) => void;
        layout?:      () => void;
        contextmenu?: (node: DiagramNodeData, event: MouseEvent) => void;  // new
    };
}

class DiagramView extends Panel<DiagramViewOptions> {
    // Viewport motion (all clamp/center about the viewport, all chainable):
    zoomIn(): this;         // step zoom up about the viewport centre
    zoomOut(): this;        // step zoom down about the viewport centre
    zoomToFit(): this;      // rewritten: fit zoom (adaptive min) + centre the graph
    resetView(): this;      // reset to default zoom + centre the graph

    // Control cluster visibility (mirrors VideoPlayer.setControlsVisible):
    setControlsVisible(value: boolean): this;
    isControlsVisible(): boolean;

    // contextmenu event overloads (added to existing on/off/emit):
    on(event: "contextmenu", listener: (node: DiagramNodeData, event: MouseEvent) => void): this;
}
```

`setZoom` / `getZoom` / `revealNode` / `selectNode` / `getSelection` keep their existing signatures; only their bodies change where noted.

State fields:

| Field | Kind | Notes |
|---|---|---|
| `_panX`, `_panY` | `private number = 0` | Current pan offset in viewport pixels. Runtime state — **not** on the options bag. Plain initializer is safe (never written during the `super()` cascade). |
| `_panOriginX`, `_panOriginY` | `private number = 0` | Pan values captured at drag start (replaces `_panScrollLeft` / `_panScrollTop`). |
| `_panStartX`, `_panStartY` | `private number = 0` | Pointer client coords at drag start (kept from today). |
| `_controls` | `declare`-free `private Component` with `!` | Built in the constructor body after `super()`, like `_contentHost` / `_edgeLayer`. |
| `_zoomInBtn` … | `private Button` with `!` | The four cluster buttons. |

---

## Internal Structure

**Transform helper** (replaces `applyZoomToHost`):

```typescript
private applyTransformToHost(): void {
    const zoom = this.getZoom();
    this._contentHost.setTransform(`translate(${this._panX}px, ${this._panY}px) scale(${zoom})`);
}
```

The host box is no longer resized per-zoom (the old `boxScale` trick drove native scroll extent, which no longer exists). `applyLayout` sets the host box once to the **unscaled** graph bounds:

```typescript
this._contentHost.setPreferredSize({ width: result.width, height: result.height });
this.applyTransformToHost();
```

**Coordinate model.** With `transform-origin: 0 0` (already set — [`:168`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L168)) and `translate(panX,panY) scale(zoom)`, a graph point `(gx, gy)` maps to a viewport point `(panX + gx·zoom, panY + gy·zoom)`. Inverting: `gx = (vx − panX) / zoom`. Every rewrite below is an application of these two formulas.

| Operation | Keep-fixed point | New pan |
|---|---|---|
| Wheel zoom | graph point under the pointer | `panX = pointerX − gx·newZoom` |
| Button zoom in/out | graph point at viewport centre | `panX = cx − gx·newZoom` |
| `revealNode(id)` | node centre → viewport centre | `panX = vw/2 − centreX·zoom` |
| `zoomToFit` / `resetView` | graph centre → viewport centre | `panX = (vw − graphW·zoom) / 2` |

where `pointerX` / `cx` / `vw` are viewport-relative, `gx = (fixedVx − panX) / oldZoom`, and `centreX = node.getX() + node.getWidth()/2`.

**Adaptive min zoom:**

```typescript
private effectiveMinZoom(): number {
    const configuredMin = this._options.minZoom ?? this._defaultOptions.minZoom ?? DEFAULT_MIN_ZOOM;
    const vw = this.getWidth();
    const vh = this.getHeight();

    if (this._graphWidth <= 0 || this._graphHeight <= 0 || vw <= 0 || vh <= 0) {
        return configuredMin;                    // no layout / unsized: keep the static floor
    }

    const fitZoom = Math.min(vw / this._graphWidth, vh / this._graphHeight);
    return Math.min(configuredMin, fitZoom);
}
```

`clampZoom` calls `effectiveMinZoom()` for its lower bound; the upper bound stays the configured `maxZoom`.

**Grab cursor.** `this.setCursor("grab")` in the constructor. `_handlePointerDown` (when it actually starts a pan) sets `"grabbing"`; `_handlePointerUp` and the button-released branch of `_handlePointerMove` restore `"grab"`. Node components keep their own `cursor: pointer` ([DiagramNode:70](packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts#L70)), which wins over the root's grab wherever a node sits under the pointer.

**Control-cluster hit guard.** The cluster is a child of the `Panel`, so its `pointerdown` / `click` reach the view's subtree listeners. Without a guard, pressing a zoom button would start a pan and clicking one would clear the node selection. A helper excludes cluster targets:

```typescript
private isControlsTarget(target: EventTarget | null): boolean {
    if (target === null || this._controls === undefined) {
        return false;
    }

    const el = this._controls.getElement();
    const handle = DOM.source.intern(target);
    return el !== null && (el === handle || DOM.source.contains(el, handle));
}
```

`_handlePointerDown` and `_handleClick` bail early when `isControlsTarget(event.target)` is true.

---

## Ordered Implementation Steps

1. **Rebase / branch off the prerequisite.** Confirm `fix/diagram-pan-subtree-listeners` is merged into the base branch (`git log --oneline | grep -i "subtree"` or inspect `init()` — the six handlers must already be `addSubtreeListener`). If not merged, stop: this plan cannot land first. Re-read `DiagramView.ts` for current line numbers.

2. **`DiagramView.ts` — imports & constants.** Add `import { Anchor } from "~/layout/Anchor.js";`, `import { VBox } from "~/layout/VBox.js";`, `import { Button } from "~/component/button/Button.js";`. Add constants near the existing zoom constants: `const ZOOM_BUTTON_STEP = 1.5;` (per-button multiplicative step) and `const CONTROLS_MARGIN = 12;` (px inset from the corner — document as structural breathing room per ARCHITECTURE "No cosmetic insets").

3. **`DiagramView.ts` — event union.** Change `DiagramViewEvent` to `"selection" | "activate" | "layout" | "contextmenu"`.

4. **`DiagramView.ts` — options.** Add `controls?: boolean;` to `DiagramViewOptions` and `contextmenu?: (node: DiagramNodeData, event: MouseEvent) => void;` to `listeners`.

5. **`DiagramView.ts` — state fields.** Replace the pan block ([`:146`–`:150`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L146)): keep `_panning`, `_panStartX`, `_panStartY`; rename `_panScrollLeft`/`_panScrollTop` → `_panOriginX`/`_panOriginY`; add `_panX = 0`, `_panY = 0`. Add `_controls!: Component` and the four `Button` fields (`_zoomInBtn!`, `_zoomOutBtn!`, `_fitBtn!`, `_resetBtn!`), plus the four named handler fields (see step 12).

6. **`DiagramView.ts` — constructor.** Remove `setAutoScroll("auto")`. Add `this.setLayoutManager(new Anchor());` and `this.setCursor("grab");`. Add the content host with no anchor constraints (unchanged `addComponent(this._contentHost)`). After building the edge layer, build the control cluster (step 12) and add it with `this.addComponent(this._controls, { right: CONTROLS_MARGIN, bottom: CONTROLS_MARGIN });`. After `applyListeners`, dispatch `this.setControlsVisible(this._options.controls ?? this._defaultOptions.controls ?? true);` (mirrors how `zoom` is dispatched in the constructor body, not in `applyOptions`). Add `controls: true` to the defaults bag passed to `super(options, { ... })`.

7. **`DiagramView.ts` — `applyOptions`.** Add `if (options.controls !== undefined) this._options.controls = options.controls;` (cache only — the cluster does not exist yet during the `super()` cascade).

8. **`DiagramView.ts` — transform helper.** Rename `applyZoomToHost` → `applyTransformToHost` with the body in _Internal Structure_. Update its callers: `setZoom` and `applyLayout`.

9. **`DiagramView.ts` — `applyLayout`.** Replace the `applyZoomToHost()` call with the two lines that set the host box to the unscaled `result.width`/`result.height` and then call `applyTransformToHost()`.

10. **`DiagramView.ts` — clamp / min zoom.** Add `effectiveMinZoom()` (see _Internal Structure_) and change `clampZoom` to use it for the lower bound.

11. **`DiagramView.ts` — viewport motion methods.** Rewrite `zoomToFit` (fit zoom + centre), `revealNode` (transform-based centre, drop the `Math.max(0, …)` scroll clamps and `setScrollLeft`/`setScrollTop`), and add `zoomIn`, `zoomOut`, `resetView`, and a private `zoomAboutViewportPoint(factor, vx, vy)` helper shared by wheel and buttons. Rewrite `_handleWheel` to compute `gx`/`gy` from `panX`/`panY` instead of scroll offsets and set `panX`/`panY` before `setZoom`.

12. **`DiagramView.ts` — control cluster.** Add `buildControls()` (a `Component` with a `VBox` layout holding four `makeControlButton(glyph, label)` buttons — glyphs `"plus"`, `"minus"`, `"expand"`, `"crosshairs"`), `makeControlButton` (`new Button({ glyph, showText: false, ... })` mirroring [VideoPlayer:642](packages/lib/src/typescript/lib/component/display/VideoPlayer.ts#L642)), and `wireControlListeners()` wiring each button's `on("action", this._onZoomIn)` etc. to named handler fields (`_onZoomIn = () => this.zoomIn()`, …). Add `setControlsVisible` / `isControlsVisible` mirroring [VideoPlayer:433](packages/lib/src/typescript/lib/component/display/VideoPlayer.ts#L433).

13. **`DiagramView.ts` — pan handlers.** In `_handlePointerDown`: bail if `isControlsTarget(event.target)`; else capture `_panOriginX = this._panX`, `_panOriginY = this._panY`, set `_panning`, record pointer start, and `this.setCursor("grabbing")`. In `_handlePointerMove`: keep the `(event.buttons & 1) === 0` guard (from the prerequisite) but on that branch also restore the grab cursor; on a live drag set `this._panX = this._panOriginX + (event.clientX - this._panStartX)` (same for Y) and `applyTransformToHost()`. In `_handlePointerUp`: clear `_panning` and `this.setCursor("grab")`.

14. **`DiagramView.ts` — click / contextmenu.** In `_handleClick`: bail if `isControlsTarget(event.target)`. Add `_handleContextMenu(event)` (resolve `nodeIdAt`; on a hit `event.preventDefault()` + `emit("contextmenu", data, event)`; else nothing) and add the `on`/`off`/`emit` overloads for `"contextmenu"`. Wire `Event.addSubtreeListener(this, "contextmenu", this._handleContextMenu);` in `init()`.

15. **`DiagramView.ts` — `isControlsTarget` helper.** Add it (see _Internal Structure_).

16. **Add the exports check.** `grep -n 'applyZoomToHost\|_panScroll' packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` — expect zero matches (all renamed).

17. **Tests.** Update `DiagramView.test.ts` (see _Verification_): fix the zoom test's transform / box assertions, add tests for the new methods and the contextmenu event.

18. **Docs.** Update `docs/components/DiagramView.md` (Interaction, Common methods, events) and run `npm run docs:api` (regenerates `docs/api/component/diagram/**`).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` |
| Modify | `packages/lib/tests/component/diagram/DiagramView.test.ts` |
| Modify | `packages/lib/docs/components/DiagramView.md` |
| Regenerate | `packages/lib/docs/api/component/diagram/**` (via `npm run docs:api`) |

---

## Expected Behaviour

Viewport is `1280 × 800` (the test `CONFIG`); graph fixture is `160 × 230` unless stated. "transform" means `_contentHost.getTransform()`.

**Unit-testable** (drive via the stub engine; set the view size with `view.setSize({ width, height })` where the math needs a viewport):

1. **Transform format.** After a layout at zoom 1, transform is `translate(0px, 0px) scale(1)`.
2. **Zoom clamps + transform.** `setZoom(10)` on an *unsized* view → `getZoom()` `4`, transform `translate(0px, 0px) scale(4)`. `setZoom(0)` → `0.25`, transform `translate(0px, 0px) scale(0.25)`. (Host box stays `160 × 230` regardless of zoom — no longer scaled.)
3. **Host box is unscaled.** `_contentHost.getPreferredSize()` is `{ 160, 230 }` at every zoom.
4. **Adaptive min — small graph unchanged.** Sized `1280×800`, graph `160×230`: `setZoom(0)` still floors at `0.25` (fitZoom ≈ 3.48 ≥ 0.25).
5. **Adaptive min — huge graph.** Sized `1280×800`, graph `43900×1000`: `zoomToFit()` yields `getZoom()` ≈ `0.0292` (= `1280/43900`), **not** clamped to `0.25`.
6. **zoomToFit centres.** Sized `1280×800`, graph `160×230`: after `zoomToFit()`, zoom = `min(1280/160, 800/230)` clamped to `maxZoom` 4; pan = `((1280 − 160·z)/2, (800 − 230·z)/2)`, reflected in the `translate(...)` of the transform.
7. **resetView.** After panning/zooming, `resetView()` → `getZoom()` = default `1`; pan centres the graph: transform `translate(560px, 285px) scale(1)` (`(1280−160)/2`, `(800−230)/2`).
8. **zoomIn / zoomOut.** `zoomIn()` multiplies zoom by `1.5` (clamped) keeping the viewport-centre graph point fixed; `zoomOut()` divides by `1.5`. Assert `getZoom()` and that the centre graph point maps back to `(640, 400)` after.
9. **revealNode centres via transform.** `revealNode("a")` sets pan so node a's centre maps to the viewport centre; assert the resulting `translate(...)`. No `setScrollLeft`/`setScrollTop` write occurs (grep the recording sink for scroll writes → none).
10. **contextmenu on a node.** A synthetic `contextmenu` event whose target is node a's element fires the `"contextmenu"` listener with `(dataForA, event)` and calls `preventDefault()`.
11. **contextmenu on empty canvas.** Same event with the view root as target fires **no** listener and does not `preventDefault`.
12. **Controls hit guard — no selection change.** A `click` whose target is inside `_controls` leaves `getSelection()` unchanged (does not clear a prior selection).
13. **Controls hit guard — no pan.** A `pointerdown` whose target is inside `_controls` leaves `_panning` false.
14. **controls option default.** `new StubDiagramView().isControlsVisible()` is `true`; `new StubDiagramView({ controls: false }).isControlsVisible()` is `false`.
15. **Option / listener routing (extend U9).** `contextmenu` in the `listeners` bag is wired; `controls: false` routes to `setControlsVisible`.

**Manual-verify** (drag, cursor, and visual — the offline harness cannot exercise pointer-drag sequences or rendered cursors):

16. **Free pan.** With the graph at its initial position, drag on empty canvas — the whole graph follows the pointer into empty space in any direction, without clamping.
17. **Grab cursor.** Empty canvas shows `grab`; while dragging, `grabbing`; over a node, `pointer` (unchanged).
18. **Wheel zoom about pointer.** Wheel over a point keeps the graph point under the cursor fixed.
19. **Control cluster.** Bottom-right cluster shows +, −, fit, reset; each works; the cluster stays pinned on window resize and does not scroll/pan with the canvas.
20. **Recover a lost graph.** Pan the graph fully off-screen, then Fit (or Reset) brings it back centred.

---

## Verification

- **Typecheck / build:** `npm run build:lib` (from `packages/lib`) — clean.
- **Rename invariants:** `grep -rn 'applyZoomToHost\|_panScrollLeft\|_panScrollTop\|setAutoScroll' packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` — expect zero matches.
- **Unit tests:** `npm test -- DiagramView` covering behaviours 1–15. Update the existing **zoom test** ([DiagramView.test.ts:343](packages/lib/tests/component/diagram/DiagramView.test.ts#L343)): its transform expectations become `translate(0px, 0px) scale(4)` / `scale(0.25)`, and its two zoom-scaled host-box assertions ([:358](packages/lib/tests/component/diagram/DiagramView.test.ts#L358), [:366](packages/lib/tests/component/diagram/DiagramView.test.ts#L366)) are replaced by "host box stays `160 × 230`". The U2 test ([:96](packages/lib/tests/component/diagram/DiagramView.test.ts#L96)) still passes (zoom 1 ⇒ unscaled box). The stale-guard test ([:401](packages/lib/tests/component/diagram/DiagramView.test.ts#L401)) still passes (asserts unscaled box).
- **Docs API:** `npm run docs:api` — finishes with **zero** warnings (per CODE_CONVENTIONS: public JSDoc must not `{@link}` internal symbols; describe `applyTransformToHost` / `effectiveMinZoom` in prose, don't link them).
- **Manual smoke:** exercise behaviours 16–20 in the docs demo or a host app that mounts a `DiagramView` with a large graph.

---

## Documentation Impact

- **Barrel:** no export changes — `DiagramView`, `DiagramViewOptions`, `DiagramViewEvent` already flow through [`component/diagram/index.ts`](packages/lib/src/typescript/lib/component/diagram/index.ts); the new members ride the existing exports.
- **Hand-written page [`docs/components/DiagramView.md`](packages/lib/docs/components/DiagramView.md):** update the **Interaction** section (pan is now free/unbounded via drag; no scrollbars; describe the control cluster), add `zoomIn` / `zoomOut` / `resetView` / `setControlsVisible` and note `revealNode` to the **Common methods** table, and document the new `"contextmenu"` event alongside `selection` / `activate` / `layout`.
- **Generated API (`docs/api/component/diagram/**`):** regenerated by `npm run docs:api` — do not hand-edit.
- **JSDoc:** give every new public method a doc comment; keep `{@link}` targets to public symbols only.

---

## Potential Challenges

- **Control buttons stealing pan/selection.** Buttons are `Panel` subtree descendants, so their `pointerdown`/`click` reach the view's handlers — mitigated by the `isControlsTarget` guard in `_handlePointerDown` and `_handleClick` (behaviours 12–13).
- **`effectiveMinZoom` before sizing.** `getWidth()`/`getHeight()` are `0` on an unmounted/unsized view; the guard returns the static `configuredMin`, so construction-time `setZoom` and the existing clamp tests are unaffected.
- **Transform string exactness.** Tests assert the literal `translate(Xpx, Ypx) scale(Z)` string — keep the format (px units, single spaces) stable; round or format pan consistently if a test needs an exact integer.
- **`declare` trap.** `_panX`/`_panY` are runtime state never written during the `super()` cascade, so a plain `= 0` initializer is correct (do **not** route them through the options bag). `_controls`/buttons are built in the constructor body after `super()`, so `!` definite-assignment matches `_contentHost`/`_edgeLayer`.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/diagram/DiagramView.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) — the component being changed.
- [`packages/lib/src/typescript/lib/layout/Anchor.ts`](packages/lib/src/typescript/lib/layout/Anchor.ts) — the corner-pin layout; note the no-constraint fallback matches `Absolute`.
- [`packages/lib/src/typescript/lib/component/display/VideoPlayer.ts`](packages/lib/src/typescript/lib/component/display/VideoPlayer.ts) — precedent for building a control cluster (`buildControlBar` / `makeControlButton` / `wireControlListeners` / `setControlsVisible`).
- [`packages/lib/src/typescript/lib/component/tree/Tree.ts`](packages/lib/src/typescript/lib/component/tree/Tree.ts) — precedent for the `"contextmenu"` event (union, overloads, `_handleContextMenu`, subtree wiring).
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `setTransform` / `setCursor` / `setSize` / `getWidth` / `doLayout`.
- [`packages/lib/tests/component/diagram/DiagramView.test.ts`](packages/lib/tests/component/diagram/DiagramView.test.ts) — the `StubEngine` / `StubDiagramView` harness the new tests extend.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) (Event handling, Positioning is always absolute, Compose before specializing) and [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md) (the `declare`/super-cascade rule).

---

## Non-Goals

- **Keeping native scroll / scrollbars.** Dropped deliberately (see decisions); no scroll-position indicator.
- **A clamped-pan compatibility mode.** Free pan is the only mode.
- **Auto-fit on first layout.** Not done; consumers opt in via a `"layout"` listener.
- **Minimap / overview panel.** Out of scope.
- **Panning restricted to empty canvas (not over nodes).** Unchanged from today: a drag starting on a node still pans; only the control cluster is excluded. *(Reversed after implementation at the user's request — see the Implementation Notes.)*
- **App-side context-menu UI.** This plan only emits the `"contextmenu"` event; consuming it (a `Menu`) is a separate app-side plan.
- **Touch / pinch gestures.** Pointer-drag and wheel only, as today.

---

## Implementation Notes

The plan classified behaviours 16 ("Free pan") and 17 ("Grab cursor") as
manual-verify, reasoning that "the offline harness cannot exercise
pointer-drag sequences or rendered cursors". That premise turned out to be
false: `_handlePointerDown` / `_handlePointerMove` / `_handlePointerUp` and
`setCursor`/`getCursor` are all cached, DOM-read-free state, and the plan's
own U4 selection tests already drive `_handleClick` offline the same way. The
only real gap was that the test harness's `makeEvent` helper
(`tests/dom/TestDOM.ts`) had no `buttons` field, needed for the
`(event.buttons & 1) === 0` end-the-pan guard. That field was added, and
behaviours 16/17 are now covered by automated tests
(`DiagramView.test.ts`, "free pan drag + grab/grabbing cursor") instead of a
manual-verify note — a drag sequence asserting the unbounded/negative pan
transform and the grab→grabbing→grab cursor cycle.

A follow-up audit pass found the same premise was also false for the
remaining "manual-only" behaviours: 18 (wheel-zoom about the pointer) is
testable because `DOM.source.getViewportRect` walks the (empty, for a
standalone view) parent chain purely from cached geometry, with no real DOM
read; 19 (the rendered, corner-pinned control cluster) is testable the same
way `Anchor.test.ts` and `VideoPlayer.test.ts` already test their respective
precedents — `doLayout()` commits real child rects offline, and the button
wiring is asserted by invoking the registered handler fields directly; and 20
(recovering a graph panned off-screen) is a drag sequence followed by
`resetView()`, both already independently testable. All three now have
automated tests (`DiagramView.test.ts`: "wheel-zoom about the pointer",
"control cluster", and the "recovers a graph panned far off-screen" case
under "resetView"); `makeEvent` gained `deltaY` for the wheel test. Behaviour
19's *visual* rendering (does it actually look right on-screen) and the
overall drag/wheel *feel* remain unautomatable and were not separately
re-verified beyond what the offline assertions above cover.

One test-infrastructure finding along the way: `Button.click()` cannot be
used reliably except as a file's first-and-only such test, because `Event`'s
window-level base listener is a module-level singleton never re-armed across
`DOM.reset()` (see `tests/component/MenuButton.test.ts`'s file-level
comment). A third audit pass pointed out that driving the control-cluster
wiring test through the handler fields directly (as the first two rounds
left it) never actually exercised `Button.on("action", ...)` — deleting
`wireControlListeners()` from the constructor still left the suite green.
The wiring is now covered by a real `Button.click()` dispatch, placed as the
file's first describe block (before any other test in this file constructs a
button and registers "click", which would otherwise have already claimed the
module-level base listener) — matching the exact constraint
`MenuButton.test.ts` documents. Every other test still drives the handler
fields directly, which remains correct for asserting each method's own math.

Similarly, a construction-time `controls: false` never actually hiding the
cluster was untested: `isControlsVisible()` reads the cached `_options`
value, which stays correct even if the constructor's own
`setControlsVisible(...)` dispatch were deleted. A direct
`_controls.isVisible()` assertion on a `{ controls: false }`-constructed view
closes that gap.

Separately, `zoomIn()` / `zoomOut()` / `resetView()` / `revealNode()` (and the
`centreGraph()` / `zoomAboutViewportPoint()` helpers backing the first three)
turned out to write a `NaN` pan when called on a view that has completed
layout but has never been sized, or — for `revealNode` — whose target node
has no committed real size either (`getWidth()`/`getHeight()` are `NaN`, not
`0`, before the first `setSize` — the same fact `effectiveMinZoom` already
guards against); each was given its own no-op guard and test. A third round
found the same root cause also reaches `zoomToFit()` (`getWidth()/graphWidth`
is `NaN`, so `zoomX`/`zoomY` are `NaN`) via a different symptom: it is the
*zoom* that goes `NaN`, not the pan, and the plan's own sanctioned auto-fit
recipe (`view.on("layout", () => view.zoomToFit())`) can fire before the view
is ever sized. The prior rounds' claim that "a `NaN` zoom recovers on its own
via `setZoom`" was false — `clampZoom` propagates `NaN` through
`Math.max`/`Math.min` just like the pan math does. Rather than adding a fifth
per-method guard, `setZoom()` itself now rejects a non-finite zoom request
outright, which is the one gate every zoom-changing entry point already
funnels through; `zoomToFit`'s existing `centreGraph()` call is separately
guarded already, so no pan is written either.

A fourth audit pass found three more issues. First, the `"contextmenu"` DOM
wiring (`Event.addSubtreeListener(this, "contextmenu", this._handleContextMenu)`
in `init()`) was never exercised end-to-end — every contextmenu test called
`_handleContextMenu` directly, so deleting the registration line left the
suite green. Fixed with a real `Event.fireEvent`-dispatched contextmenu,
folded into the same file-first test that already drives the control
cluster's real `Button.click()` dispatch — `init()` registers all seven
subtree-listener types together, so both had to share that one
first-in-file test to reliably claim their event types' window-level base
listeners (mutation-verified: commenting out the registration now fails the
test). Second, two pre-existing test comments/titles (U2's title, U2b's
rationale) still described the old scaled-host-box / native-scroll model
this branch replaced; corrected to describe the current unscaled-box /
transform model without changing either test's assertions. Third, and most
serious: the `"wheel"` subtree listener was registered without
`{ passive: false }`, so — once `setAutoScroll("auto")` was removed — Chrome
installs it as passive (`"wheel"` is in `Event.ts`'s `PASSIVE_TYPES`) and
silently ignores `_handleWheel`'s `preventDefault()`, letting the page's
native scroll/zoom fire alongside the diagram's own wheel-zoom; worse, if
another component in the same app registers `"wheel"` non-passively (e.g.
`Component.attachWheelScrolling` / `WheelTrap`), `installBaseListener`'s
conflict check throws. Fixed by passing `{ passive: false }`, matching the
established precedent at both call sites just named. It was also verified
live: a real dev server (`npm run dev`) serving this worktree, driven via
Chrome DevTools, confirmed (a) a dispatched wheel event over the diagram
zooms with `defaultPrevented: true` and no console warning/error, and the
page's own `scrollY` stays `0`; (b) a real
`pointerdown`/`pointermove`/`pointerup` drag pans the diagram (unbounded)
and cycles the cursor `grab` → `grabbing` → `grab`; (c) a real `contextmenu`
dispatch over a node fires the demo's listener and shows "Right-clicked:
Process" in the status line, with `defaultPrevented: true`; (d) the toolbar
and the built-in bottom-right control cluster both render and drive the same
view, and `Reset` recentres it — covering behaviours 16-20's residual
visual/feel claims; no console errors were logged at any point.

A fifth (final) audit pass found the claim that `{ passive: false }` "is not
offline-observable" was itself false, and that the setting was still
mutation-survivable (deleting it left the whole suite green) despite the
live verification. `RecordingDOMSink.addListener` does drop the `options` it
is given, but `Event.installBaseListener`'s own conflict guard makes the
*effective* passive setting indirectly observable: once `"wheel"` is
installed as `passive: false` (which `DiagramView.init()` does the moment a
view's element is forced), a later `Event.addSubtreeListener(other, "wheel",
fn, { passive: true })` call throws, while a matching `{ passive: false }`
one does not. That probe now lives alongside the file-first click/contextmenu
dispatch test (mutation-verified). Live verification remains valuable for
what it independently confirms (the actual browser-observable effects —
`defaultPrevented`, no page scroll, no console warning) but was not, on its
own, a substitute for an automated regression guard here.

**Post-implementation change, at the user's direction: the initial view is
now centred.** This revises the `## Architecture Decisions` entry *"No
auto-fit on first layout"*, which specified the initial render keep the
configured zoom **at pan `0`** — showing a large graph's top-left corner.
On review of the shipped behaviour the user asked that the first render
instead show what the Reset control returns to, since the two disagreeing
was the one jarring thing left. Only the *pan* half of that decision is
revised: `applyLayout` now performs a one-time centring, and the **auto-fit
non-goal still stands** — the configured `zoom` is deliberately left alone
(unlike `resetView`, which also restores the default zoom), so
`new DiagramView({ zoom: 2 })` still opens at 2, and an over-large graph
still overflows rather than being fitted. The centring is one-time
(`_needsInitialCentre`), so a later `setData` never yanks a pan the user has
since dragged to, and it runs *before* the `"layout"` emit so the sanctioned
auto-fit recipe (`view.on("layout", () => view.zoomToFit())`) still runs
afterwards and wins.

The first cut of that centring shipped with a race the user then hit: the
graph still opened top-left much of the time. Its two inputs arrive
asynchronously and in **either** order — the graph bounds from ELK, the
viewport size from the host's layout pass — and the code assumed the size
was either already there or would arrive via a single `onFirstLayout`
firing. Worse, that callback cleared the pending flag *before* calling
`centreGraph`, which silently no-ops (returns without writing) while the
view has no committed size. So when the ELK result and that one firing both
landed before the host sized the view, the one-shot was consumed by an
attempt that did nothing and the centring was lost for good. It was
timing-dependent, hence intermittent: a cache-cleared reload happened to
order things favourably while a warm reload did not.

The fix drops the one-shot entirely and makes the centring
ordering-independent: `centreGraph` now **reports** whether it wrote a pan,
`tryInitialCentre` clears the pending flag only on a confirmed success, and
a `doLayout` override retries it on every layout pass until it succeeds.
Whichever input lands last, the next layout centres. The override writes
only the content host's transform — never a child's rect and never
`scheduleLayout` — so it cannot feed back into the layout it runs inside,
which is what made a `doLayout` override unsafe for the *control cluster*
(see the `Anchor` decision) but fine here. Five tests cover it
(sized-at-layout-time, configured-zoom preserved, the deferred/unsized path,
first-layout-only, and a regression test that reproduces the exact losing
order — a layout pass while still unsized must not consume the pending
centring). That regression test fails on the old code with
`translate(0px, 0px)`, i.e. the user-visible top-left symptom. Confirmed
live afterwards across repeated warm and cache-ignoring reloads: the initial
transform matches the transform after pressing Reset byte-for-byte
(`matrix(1, 0, 0, 1, 571.5, 552)`), with a pan/Reset round trip still
working and no console errors.

**Second post-implementation request: a resize keeps the viewport centre
fixed.** Previously the pan was left untouched across a viewport resize, so
the graph point under the centre drifted toward a corner as the window grew
or shrank. `doLayout` now also runs `anchorCentreAcrossResize`, which
measures the extent delta since the last layout and shifts the pan by half
of it on each axis — from `viewport = pan + graph·zoom`, holding the centre's
graph point fixed is exactly `pan += (newExtent − oldExtent) / 2`, in which
the zoom cancels, so it is correct at any zoom and never alters the zoom.
The first sizing only records the extent (the initial centring owns that
pass), and an unchanged size is a no-op, so this cannot perturb a settled
view. Four tests cover it (grow, shrink, an off-centre pan at a non-default
zoom, and the unchanged-size no-op). Verified live via CDP-driven window
resizes: shrinking 1697×1211 → 992×634 and growing 992×634 → 1492×934 (the
latter after zooming to 2.25× and dragging off-centre) both left the centre
graph point drifting `0.0000`px on each axis, with the zoom unchanged.

**Third post-implementation request: make the cursor honest, and stop drags
on nodes from panning.** Two defects, one theme — the cursor was promising
things the drag did not deliver.

First, the cursor changed away from `grab` well outside any visible node.
Cause: `ComponentDefaults` gives every `Component` `cursor: "default"`, which
it stamps onto its own CSS rule, and the content host is an *invisible*
`Container` spanning the whole graph bounds — so it painted an arrow across
the entire canvas, masking the viewport's `grab`. A live cursor probe over a
20px grid confirmed it: 277 sample points reading `default` from
`Container`. Fixed by constructing the host with `cursor: "inherit"`, so the
single cursor write on the view root governs the whole canvas.
`DiagramGroupNode` had the same latent problem for the opposite reason — it
set no cursor, so a *selectable container node* also read as `default`; it
now sets `pointer`, matching `DiagramNode`. Re-probing shows only the three
intended regions: `grab` on canvas (root **and** host), `pointer` on leaf and
container nodes, `pointer` on the control buttons.

Second, a drag starting on a node still panned. This **reverses the
`## Non-Goals` entry** *"Panning restricted to empty canvas (not over
nodes)"*, which had kept the pre-existing behaviour deliberately. The user's
rule — the cursor must say what a drag will do — makes the two inseparable:
having fixed the cursor to show `pointer` over nodes, panning from them
would be exactly the lie the first fix removed. `_handlePointerDown` now
bails on `nodeIdAt(event.target) !== null` alongside the existing
`isControlsTarget` guard. Container nodes are included, since they are
selectable nodes like any leaf — worth knowing, because it means the large
empty interior of a group box is not pannable; that is the consistent
reading of the rule, and easy to relax to leaves-only if it proves annoying.
Five tests cover it (host cursor-transparent, container-node cursor,
no-pan-on-leaf, no-pan-on-container, still-pans-from-canvas), and it was
verified live: dragging a leaf and dragging a group interior both leave the
transform untouched with the cursor never switching to `grabbing`, dragging
canvas still pans, and clicks still select both node kinds
("Selected: Start", "Selected: Pipeline") — so the pan guard does not
swallow selection.

---

## Notes

[^prereq]: The prerequisite (`fix/diagram-pan-subtree-listeners`, currently uncommitted in `.worktrees/fix-diagram-pan`) makes the wheel/pointer handlers actually fire: the content, the SVG edge layer, and the `Panel`'s overlay-scroll element are descendants of the view root, so an exact-target `Event.addListener` never sees their events. That branch switches all six handlers to `Event.addSubtreeListener` and adds a `(event.buttons & 1) === 0` end-the-pan guard in `_handlePointerMove`. This plan's `"contextmenu"` handler is likewise a subtree listener. If this plan is implemented on a base without the fix, pan/zoom/contextmenu will not fire — do not attempt to re-apply the fix here; land that branch first.

[^transform]: The content host already carries `transform: scale(zoom)` with `transform-origin: 0 0`, so extending it to `translate(panX, panY) scale(zoom)` reuses one existing surface (`Component.setTransform`) rather than adding a second coordinate system. Unbounded `panX`/`panY` are plain numbers; nothing clamps them, which is the whole point (infinite canvas). The transform order `translate … scale` with origin `0 0` gives the clean forward map `viewport = pan + graph·zoom`, whose inverse the wheel/reveal/fit math uses directly.

[^scrollbars]: Once pan is unbounded, a native scrollbar cannot represent the position: scroll offsets are clamped to `[0, contentExtent]` and cannot express a negative pan or a graph dragged past its own bounds. A scrollbar shown anyway would fight the transform (its thumb would sit pinned at an end while the graph moves). Keeping it as a passive indicator would require continuously resizing phantom scroll content to track the pan — more code than the feature is worth. `overflow: hidden` (the `Panel` default once `setAutoScroll` is removed) gives exactly the viewport clip the infinite canvas needs.

[^panmode]: Supporting both a clamped native-scroll pan and the transform pan would mean two `_handlePointerMove` bodies, two `revealNode`s, and two `zoomToFit`s kept in sync, guarded by a `panMode` option no caller has asked for. Per the repo's "no configurability that wasn't requested" rule, free pan simply replaces the old mechanism.

[^anchor]: `Anchor` re-resolves each child's rect against the container's inner size on every `doLayout` ([Anchor:140](packages/lib/src/typescript/lib/layout/Anchor.ts#L140)), so a `{ right, bottom }` child stays pinned to the corner through viewport resizes with no repositioning code. Its no-constraint branch returns `{ start: ownStart, extent: preferred }` ([Anchor:129](packages/lib/src/typescript/lib/layout/Anchor.ts#L129)) — byte-for-byte the `Absolute` behaviour the content host relies on today — and mixed Anchor/Absolute children are explicitly supported. The rejected alternative, overriding `DiagramView.doLayout()` to reposition the cluster after `super.doLayout()`, would re-implement corner arithmetic that `Anchor` already owns and risk a layout feedback loop (setting a child's `X`/`Y` from inside `doLayout`). A docked `Border` south region (the `VideoPlayer` arrangement) was also rejected: it steals canvas space instead of overlaying, and the requirement is an overlay that does not consume the viewport.

[^controls]: `VideoPlayer` establishes the pattern: build the control cluster as a composed `Component` with a box layout of `Button`s created by a small `makeControlButton` helper, wire each button's `"action"` to a named handler field, and expose `setControlsVisible`. Reusing it keeps the diagram consistent with the framework and satisfies "Compose before specializing" (the cluster is arrangement, not a new coordinator). Default-visible: unbounded pan can move the graph off-screen with no scrollbar to hint where it went, so the on-screen fit/reset control is the recovery affordance and should be present unless the consumer opts out with `controls: false`. It is additive UI over a read-only viewer, so it does not break any existing API.

[^autofit]: Auto-fitting on the first layout would change the initial render for every existing consumer (graphs currently appear at zoom 1, top-left). Keeping the configured zoom preserves that and stays backward-compatible; the fit control and `zoomToFit()` provide the same result on demand, and a consumer who wants auto-fit writes `view.on("layout", () => view.zoomToFit())` — one line, no new option.

[^adaptivemin]: `zoomToFit` needs `min(vw/graphW, vh/graphH)`; for a ~43,900px-wide graph in a 1280px viewport that is ≈ 0.029, far below the static `DEFAULT_MIN_ZOOM` of 0.25, so today's flat clamp makes the whole graph unfittable. Flooring at `min(configuredMin, fitZoom)` lowers the floor only when the graph genuinely needs it: for a small graph `fitZoom ≥ configuredMin`, so `min` returns `configuredMin` and nothing changes. Computing `fitZoom` live (rather than caching a `_fitZoom` field) keeps it correct across viewport resizes with no invalidation bookkeeping; the cost is two divisions per clamp, which is negligible.

[^contextmenu]: `Tree` already solves "right-click a row, emit a semantic event, let the app place a menu": `TreeEvent` includes `"contextmenu"`, the `on`/`emit` overloads carry `(node, event)`, and `_handleContextMenu` ([Tree:894](packages/lib/src/typescript/lib/component/tree/Tree.ts#L894)) resolves the row under the target, calls `e.preventDefault()`, and emits — right-clicking empty space is left to the browser. `DiagramView` mirrors this exactly with `nodeIdAt` in place of row matching. Per ARCHITECTURE, `contextmenu` is a real DOM event, so it is wired through `Event.addSubtreeListener`; the *semantic* re-emit to consumers goes through the `ListenerBag` `on`/`off`/`emit` surface the view already owns. (The handler calls `event.preventDefault()` directly, matching the `Tree` precedent, rather than returning a `{ prevent: true }` disposition — deliberately consistent with the sibling implementation.)
