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
- **Panning restricted to empty canvas (not over nodes).** Unchanged from today: a drag starting on a node still pans; only the control cluster is excluded.
- **App-side context-menu UI.** This plan only emits the `"contextmenu"` event; consuming it (a `Menu`) is a separate app-side plan.
- **Touch / pinch gestures.** Pointer-drag and wheel only, as today.

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
