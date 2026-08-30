---
touches-shared: [packages/lib/docs/reference/changelog/next.md, packages/lib/docs/reference/migration/next.md]
---

# Visualization Subsystem Fixes (Round 2) — Implementation Plan

## Overview

A fresh-context audit reviewed every visualization and media component added since 2026-07-05 — the ELK diagram viewer, the two canvas surfaces, the video player, and the SVG chart family — and found twelve defects. Two are live bugs: [`DiagramView`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L680) leaks a global theme listener for every node component it builds and then discards, and [`DiagramNodeLayer`](packages/lib/src/typescript/lib/component/diagram/DiagramNodeLayer.ts#L96) is never given a box, so the level-of-detail rendering it exists to draw is clipped away. The rest are duplication, a dead exported type, a non-functional option, missing capability-index entries, a docs-build warning, and six constructors that skip `subclassDefaults`.

The work is confined to `packages/lib/src/typescript/lib/component/{diagram,chart,display}/`, their tests, the `llms.txt` generator manifest, and three docs pages. No core or layout file changes.

The plan runs in five phases: correctness fixes first, then the canvas-family consolidation (the one genuine design decision), then deduplication and dead-code removal, then a mechanical `subclassDefaults` sweep, then docs and build hygiene.

---

## Architecture Decisions

### `Canvas` and `WebGLCanvas` get a shared `AbstractCanvasSurface` base

The animation loop, the frame clock, the backing-store sync, the visibility reconciliation, and the device-pixel-ratio watch move onto a new abstract `AbstractCanvasSurface`, which both classes extend. Each subclass keeps its own context field, its own draw hooks, and three short seam methods; `WebGLCanvas` additionally keeps its context-loss recovery.[^canvas-base] The name is the one the original plan reserved for exactly this refactor.[^base-name] The precedent is [`AbstractChart`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts#L121), which hoists the same class of shared mechanics for two siblings (`LineChart` / `BarChart`) and is exported from its barrel without a curated docs page.

### One process-wide device-pixel-ratio watch, not one per canvas

The per-instance `matchMedia` re-arm is replaced by a single module-level watch in `AbstractCanvasSurface.ts`, plus a `Set<WeakRef<AbstractCanvasSurface>>` of live surfaces. This mirrors [`Glyph.ts`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L107)'s `prefers-reduced-motion` handling exactly: a module-level named handler, weakly-held instances, dead refs pruned on each fire.[^dpr-registry] The `_dprToken` generation counter disappears along with the per-instance watch.

### The node layer is sized the way the edge layer is, not the way a chart surface is

`DiagramView.applyLayout` gives `_nodeLayer` the same `setX(0)` / `setY(0)` / `setPreferredSize(graph bounds)` treatment it already gives `_edgeLayer` three lines above ([DiagramView.ts:895](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L895)). No SVG `width` / `height` / `viewBox` attributes are written.[^layer-sizing] Separately, both layers get `setOverflow("visible")` in their constructors, matching the content host they live in ([DiagramView.ts:483](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L483)).

### `elkWorkerUrl` and `workerUrl` are removed, not wired up

`ElkLayoutEngineOptions.workerUrl` and `DiagramViewOptions.elkWorkerUrl` are deleted along with the `_workerUrl` field and its branch in `createElk`. Both options are documented in their own JSDoc as doing nothing, and the flag the branch sets (`_workerBacked`) buys a pointless main-thread rebuild-and-retry on the first unrelated layout failure.[^worker-url] `elkWorkerFactory` is the supported route and already covers the same use in one line.

### `ChartStoreBinding` is deleted

The type is exported into the public API and referenced nowhere. `AbstractChartOptions`'s flat `store` / `xField` / `yField` / `seriesField` fields are the intended surface — the original plan specified both and only the flat fields were ever wired.[^chart-binding]

### `formatMediaTime` stays module-internal

`formatMediaTime`'s `@category Components` tag becomes `@internal`, and the `component/display` barrel is not touched. The helper is exported from its module so the unit test can import it, not to publish it.[^format-media-time]

### The six `subclassDefaults` constructors are fixed by hand

`local/require-subclass-defaults` cannot see any of the six shapes — it fires only when the second `super()` argument names a `_default<Name>Options` constant, and these constructors pass one argument, an inline literal, or nothing.[^lint-blind-spot] The fix is manual and the rule stays green either way.

---

## Public API

### New — `component/display/AbstractCanvasSurface.ts`

```typescript
export interface AbstractCanvasSurfaceOptions extends ComponentOptions {
    animateWhenHidden?: boolean;
    maxFps?: number;
}

export abstract class AbstractCanvasSurface<
    O extends AbstractCanvasSurfaceOptions = AbstractCanvasSurfaceOptions,
> extends Component<O> {

    constructor(options?: O, subclassDefaults?: Partial<O>);

    startAnimation(): this;
    stopAnimation(): this;
    isAnimating(): boolean;
    setAnimateWhenHidden(value: boolean): this;
    getAnimateWhenHidden(): boolean;
    setMaxFps(fps: number): this;
    getMaxFps(): number;

    /** @internal — called by this module's device-pixel-ratio watcher. */
    _syncForDevicePixelRatioChange(): void;

    protected abstract hasRenderingContext(): boolean;
    protected abstract onBackingStoreResized(backingWidth: number, backingHeight: number, dpr: number): void;
    protected abstract drawFrame(): void;

    protected syncBackingStore(): void;
    protected applyOptions(options: O): this;
    protected onEffectiveVisibilityChange(effective: boolean): void;
    protected render(): Handle;
    doLayout(): this;
    protected destructor(): void;
}
```

Abstract, so it is **not** wrapped with `callable()` — mirroring `AbstractChart`. It is re-exported from `component/display/index.ts` (class and options type) so subclass API pages can link to it.

### Changed signatures

```typescript
export interface CanvasOptions      extends AbstractCanvasSurfaceOptions { onDraw?: CanvasDrawCallback; }
export interface WebGLCanvasOptions extends AbstractCanvasSurfaceOptions {
    onContextInit?: WebGLContextInitCallback;
    onFrame?:       WebGLFrameCallback;
}

class Canvas      extends AbstractCanvasSurface<CanvasOptions>      { /* … */ }
class WebGLCanvas extends AbstractCanvasSurface<WebGLCanvasOptions> { /* … */ }

// DiagramView — new second parameter
constructor(options?: DiagramViewOptions, subclassDefaults?: Partial<DiagramViewOptions>);
// The same parameter pair is added to DiagramEdgeLayer, DiagramNodeLayer,
// LineChart, BarChart, and VideoPlayer. Their `super()` calls differ — see the
// table in step 21.
```

`animateWhenHidden` and `maxFps` keep their names, defaults, and semantics; they are declared one level up. This is not a breaking change for consumers.

### Removed

```typescript
// component/chart/types.ts + component/chart/index.ts
export interface ChartStoreBinding { /* … */ }

// component/diagram/ElkLayoutEngine.ts — the field only; the interface stays
interface ElkLayoutEngineOptions { workerUrl?: string; }

// component/diagram/DiagramView.ts — the field only; the interface stays
interface DiagramViewOptions { elkWorkerUrl?: string; }
```

---

## Internal Structure

### Where each `Canvas` / `WebGLCanvas` member lands

| Member | Base | `Canvas` | `WebGLCanvas` |
|---|---|---|---|
| `animateWhenHidden`, `maxFps` options + `_defaultAbstractCanvasSurfaceOptions` (`tag: "canvas"`, `maxFps: 30`) | ✓ | — | — |
| `NOT_YET_SYNCED`, `_syncedWidth`, `_syncedHeight`, `_syncedDpr` (`protected`) | ✓ | — | — |
| `_rafId`, `_animationStartMs`, `_lastDrawMs`, `_elapsedMs` (`protected`), `_animationRequested`, `_surfaceRef` | ✓ | — | — |
| `startAnimation`, `stopAnimation`, `isAnimating`, `setAnimateWhenHidden`, `getAnimateWhenHidden`, `setMaxFps`, `getMaxFps` | ✓ | — | — |
| `shouldAnimate`, `reconcileAnimation`, `animationStep`, `onEffectiveVisibilityChange`, `doLayout`, `destructor` | ✓ | — | — |
| `render()` — registers in the ratio registry and arms the watch | ✓ | — | overridden, calls `super.render()` |
| `syncBackingStore` (template method), `_syncForDevicePixelRatioChange` | ✓ | — | — |
| `_dprToken`, `watchDevicePixelRatio`, `onDevicePixelRatioChange` | *deleted* | *deleted* | *deleted* |
| `hasRenderingContext`, `onBackingStoreResized`, `drawFrame` | abstract | short body each | short body each |
| Context field + `getContext` | — | `_ctx`, `"2d"` | `_gl`, `"webgl2"` |
| Draw hooks + setters/getters | — | `onDraw`, `redraw()` | `onContextInit`, `onFrame`, `renderFrame()` |
| Context-loss state and wiring | — | — | ✓ |

`Canvas`'s `render()` override and both `_defaultXOptions` constants disappear: nothing is left in them.

The three seams, in full:

```typescript
// Canvas
protected hasRenderingContext(): boolean { return this.getContext() !== null; }
protected onBackingStoreResized(_backingWidth: number, _backingHeight: number, dpr: number): void {
    // Reassigning the backing-store attributes reset the context, so re-apply
    // the dpr scale — one context unit is then one CSS pixel.
    this.getContext()!.setTransform(dpr, 0, 0, dpr, 0, 0);
}
protected drawFrame(): void { this.redraw(); }

// WebGLCanvas
protected hasRenderingContext(): boolean { return this.getContext() !== null; }
protected onBackingStoreResized(backingWidth: number, backingHeight: number, _dpr: number): void {
    // Device pixels, not CSS px — the drawing buffer is CSS × dpr.
    this.getContext()!.viewport(0, 0, backingWidth, backingHeight);
}
protected drawFrame(): void { this.renderFrame(); }
```

### `syncBackingStore` on the base

The order is the one both copies already use — guard on the context, read cached CSS sizes, short-circuit on an unchanged triple, resize, hook, record, draw:

```typescript
protected syncBackingStore(): void {
    if (!this.hasRenderingContext()) {
        return;
    }

    const width  = this.getWidth();
    const height = this.getHeight();
    const dpr    = DOM.source.getDevicePixelRatio();

    if (width === this._syncedWidth && height === this._syncedHeight && dpr === this._syncedDpr) {
        return;
    }

    const backingWidth  = Math.round(width  * dpr);
    const backingHeight = Math.round(height * dpr);

    DOM.sink.apply(this.getElement()!, { setAttr: {
        width:  String(backingWidth),
        height: String(backingHeight),
    }});

    this.onBackingStoreResized(backingWidth, backingHeight, dpr);

    this._syncedWidth  = width;
    this._syncedHeight = height;
    this._syncedDpr    = dpr;

    this.drawFrame();
}
```

### The module-level device-pixel-ratio watch

```typescript
/** Live canvas surfaces, weakly held so an unrooted one stays collectable. */
const _surfaces: Set<WeakRef<AbstractCanvasSurface>> = new Set();

/** The ratio the current watch is armed for; 0 before the first arm. */
let _watchedDpr = 0;

/**
 * Re-syncs every live surface at the new ratio and re-arms for it. Dead
 * `WeakRef`s are pruned.
 */
function _onDevicePixelRatioChange(): void {
    for (const ref of Array.from(_surfaces)) {
        const surface = ref.deref();

        if (!surface) {
            _surfaces.delete(ref);
            continue;
        }

        surface._syncForDevicePixelRatioChange();
    }

    _armDevicePixelRatioWatch();
}

/**
 * Arms a one-shot `matchMedia` watch for the current ratio, unless one is
 * already armed for it. The seam's `matchMedia` degrades to an inert result
 * off-browser, so no environment guard is needed.
 */
function _armDevicePixelRatioWatch(): void {
    const dpr = DOM.source.getDevicePixelRatio();

    if (dpr === _watchedDpr) {
        return;
    }

    _watchedDpr = dpr;
    DOM.source.matchMedia(`(resolution: ${dpr}dppx)`).addChangeListener(_onDevicePixelRatioChange);
}
```

Registration happens in the base's `render()` override, not its constructor — the same moment the old per-instance `watchDevicePixelRatio()` fired, so construction stays free of any `DOM.source` read:

```typescript
protected render(): Handle {
    const element = super.render();

    // Guarded so a re-render (an element released and rebuilt) does not
    // register a second `WeakRef` for the same surface.
    if (this._surfaceRef === null) {
        this._surfaceRef = new WeakRef(this);
        _surfaces.add(this._surfaceRef);
    }

    _armDevicePixelRatioWatch();

    return element;
}
```

The base `destructor` deletes `this._surfaceRef` from `_surfaces` and nulls the field, before `stopAnimation()` and `super.destructor()`. `_surfaceRef` is a plain `private _surfaceRef: WeakRef<AbstractCanvasSurface> | null = null` — nothing dispatched from `applyOptions` writes it, so it needs no `declare`.

---

## Ordered Implementation Steps

### Phase 1 — Correctness fixes

1. **`DiagramView.discardIncomingNodes` disposes before clearing** ([DiagramView.ts:680](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L680)). Add a `for (const component of this._incomingComponents.values()) { component.dispose(); }` loop ahead of the four `.clear()` calls, and update the method's one-line doc comment: the components were never mounted, so there is nothing to detach, but each holds a theme subscription released only by `dispose()`. → verify: `npm run test` still green.

2. **`DiagramView.destructor` reuses that method** ([DiagramView.ts:534](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L534)). Add `this.discardIncomingNodes();` immediately after the existing non-resident `_nodeComponents` loop and before `this._engine.dispose()`. Do not write a second loop.

3. **New test file** `packages/lib/tests/component/diagram/DiagramView.incomingNodeDisposal.test.ts`, modelled on [`tests/core/TextDispose.test.ts`](packages/lib/tests/core/TextDispose.test.ts) — its own file because `ThemeManager._themeListenerCount()` is process-global state that any undisposed component elsewhere in the suite pollutes. Reuse `DiagramView.test.ts`'s `StubEngine` (`defer` and `reject` modes) and `StubDiagramView`. Cover E1–E3 from `## Expected Behaviour`. → verify: the three cases fail before steps 1–2 and pass after.

4. **Size the node layer** ([DiagramView.ts:897](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L897)). In `applyLayout`, directly after the existing `_edgeLayer` block, add the mirrored three lines for `_nodeLayer`: `setX(0)`, `setY(0)`, `setPreferredSize({ width: result.width, height: result.height })`. → verify: `grep -n "_nodeLayer.setPreferredSize" packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` — one match.

5. **`overflow: visible` on both SVG layers.** Add `this.setOverflow("visible");` to the constructors of [`DiagramNodeLayer`](packages/lib/src/typescript/lib/component/diagram/DiagramNodeLayer.ts#L76) and [`DiagramEdgeLayer`](packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts#L423), beside the existing `setPointerEvents` / `setCursor` calls, with a one-line comment naming the reason (a marker or halo'd label reaching past the graph bounds must not clip at the layer edge).

6. **Test the node-layer box.** Add a case to `packages/lib/tests/component/diagram/DiagramView.test.ts` beside the existing `view._contentHost.getPreferredSize()` assertion at line 261, asserting `view._nodeLayer.getPreferredSize()` equals the same graph bounds. → verify: fails before step 4.

### Phase 2 — Canvas family

7. **Create `packages/lib/src/typescript/lib/component/display/AbstractCanvasSurface.ts`** per `## Public API` and `## Internal Structure`. Move — do not retype — the thirteen byte-identical method bodies out of `Canvas.ts`. Carry each member's existing doc comment across, rewording only where it names one sibling ("the canvas" rather than "the 2D canvas"). Fix the false claim while moving it: `syncBackingStore`'s comment currently opens "Reusable seam shared with the WebGL sibling" — on the base that is now true, so keep the sentence and drop nothing else.

8. **Rewrite `Canvas.ts`** to extend the base: delete the moved members, `_defaultCanvasOptions`, `NOT_YET_SYNCED`, its `render()` override (the base supplies one), `_dprToken`, `watchDevicePixelRatio`, and `onDevicePixelRatioChange`; keep `_ctx`, `getContext`, `setOnDraw` / `getOnDraw`, `redraw`, `clearInsets()`; add the three seams. The constructor becomes `constructor(options?: CanvasOptions, subclassDefaults?: Partial<CanvasOptions>) { super(options, subclassDefaults); this.clearInsets(); }` — the bare-forward shape [`MenuRow`](packages/lib/src/typescript/lib/component/container/MenuRow.ts#L54) uses when a class has no defaults of its own. `applyOptions` keeps only its `onDraw` branch.

9. **Rewrite `WebGLCanvas.ts`** the same way. It additionally keeps `_contextLost`, `_onContextLost`, `_contextInitialised`, `renderFrame`, and its `render()` override — the override now leads with `super.render()` (which registers the surface in the ratio registry) and drops the `watchDevicePixelRatio()` call, keeping only the context-loss wiring and `onFirstLayout(() => this.startAnimation())`.

10. **Name the `webglcontextrestored` listener** ([WebGLCanvas.ts:451](packages/lib/src/typescript/lib/component/display/WebGLCanvas.ts#L451)). Replace the inline arrow with a `private readonly _onContextRestored: () => void = () => { … }` bound field, declared beside the existing `_onContextLost` field, and pass `this._onContextRestored` at the registration site. → verify: `grep -n "Event.addListener(this" packages/lib/src/typescript/lib/component/display/WebGLCanvas.ts` — both registrations name a field.

11. **Barrel** — add to `component/display/index.ts`, next to the `Canvas` rows:

    ```typescript
    export { AbstractCanvasSurface } from '~/component/display/AbstractCanvasSurface.js';
    export type { AbstractCanvasSurfaceOptions } from '~/component/display/AbstractCanvasSurface.js';
    ```

12. **Test the watch collapse.** Add one case to `packages/lib/tests/component/display/Canvas.test.ts`: with `vi.spyOn(DOM.source, 'matchMedia')` installed, construct three `Canvas` instances and one `WebGLCanvas` and call `getElement(true)` on each, then assert the spy recorded **at most one** call. The render is what makes the case meaningful: both the old and the new code arm from `render()`, so construction alone records nothing either way. Phrase the assertion as an upper bound, not an equality, since the module arms at most once per process and an earlier test may already have done so. → verify: records four calls before step 7, at most one after.

13. **Change no other case in either canvas test file.** `WebGLCanvas.test.ts` gets no edit at all, and `Canvas.test.ts` gets only step 12's addition. Both suites drive the animation layer through the concrete classes, so passing them unmodified is the regression proof for the extraction. → verify: `npm run test` green; `git diff --stat` shows one added case and nothing else in those two files.

### Phase 3 — Deduplication and dead code

14. **Hoist `visiblePoints`.** Delete the identical `private visiblePoints()` from [`LineChart.ts:207`](packages/lib/src/typescript/lib/component/chart/LineChart.ts#L207) and [`BarChart.ts:107`](packages/lib/src/typescript/lib/component/chart/BarChart.ts#L107); add one `protected visiblePoints(): ChartPoint[]` to `AbstractChart` near `_series`, carrying the merged doc comment ("Flattens the points of every visible series, for domain computation"). `AbstractChart` already imports `ChartPoint`. `BarChart` uses `ChartPoint` nowhere else, so drop it from that file's type import; `LineChart` uses it in five other places and keeps it. → verify: `grep -rn "visiblePoints" packages/lib/src` — three matches, one declaration and two call sites.

15. **Delete `ChartStoreBinding`** from [`chart/types.ts:44`](packages/lib/src/typescript/lib/component/chart/types.ts#L44) and its entry in `chart/index.ts`. Drop the now-unused `AbstractStore` type import from `types.ts` if it has no other use. → verify: `grep -rn "ChartStoreBinding" packages/` — zero matches outside `plans/implemented/`.

16. **Dedup `createElk`** ([ElkLayoutEngine.ts:590](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L590)). Invert the method so the default path delegates:

    ```typescript
    private async createElk(): Promise<ElkInstance> {
        if (!this._workerFactory) {
            return this.createMainThreadElk();
        }

        // `elkjs` is an optional peer dep, typed by the local ambient shim in
        // `elkjs.d.ts` and resolved by the consumer's bundler at runtime.
        const { default: ELK } = await import("elkjs/lib/elk.bundled.js");

        this._workerBacked = true;
        this._ownsWorker   = true;

        return new ELK({ workerFactory: this._workerFactory });
    }
    ```

    The flags must still be written *before* `new ELK(...)`, so a synchronous construction throw is caught by `layout`'s retry.

17. **Remove `workerUrl`** from `ElkLayoutEngine.ts`: the `ElkLayoutEngineOptions.workerUrl` field and its JSDoc, the `_workerUrl` field, its constructor assignment, and the branch step 16 already removed. Update the class-level JSDoc (lines 364–380) and `workerFactory`'s "Takes precedence over `workerUrl`" sentence so neither mentions a URL mode.

18. **Remove `elkWorkerUrl`** from `DiagramView.ts`: the `DiagramViewOptions.elkWorkerUrl` field and JSDoc, the `applyOptions` cache line ([:581](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L581)), and the `workerUrl:` argument in `createEngine` ([:526](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L526)). Leave `component/diagram/elkjs.d.ts` alone — its `workerUrl` field types elkjs's own constructor, not this library's API. → verify: `grep -rn "workerUrl" packages/lib/src packages/lib/tests` — one match, `elkjs.d.ts:14`.

19. **Prune the worker-URL tests.** Delete four cases from `packages/lib/tests/component/diagram/ElkLayoutEngine.test.ts` (`with workerUrl provided…` :492, `falls back … when a workerUrl-backed layout fails` :525, `prefers workerFactory over workerUrl…` :536, `E4: does not terminate a workerUrl-only instance` :646) and two from `DiagramView.createEngine.test.ts` (`forwards elkWorkerUrl…` :48, `R2: disposing a workerUrl-mode view…` :87). Retitle `with no factory and no url, builds a plain ELK()` (:474) to drop "and no url". Also update the file-header comment on `DiagramView.createEngine.test.ts:9`, which names `elkWorkerUrl`. No coverage is lost.[^test-coverage]

20. **Extract `graphPointFor`** in `DiagramView.ts`. Add:

    ```typescript
    /**
     * The graph-space point under a pointer event, inverting the
     * `translate(panX,panY) scale(zoom)` transform `applyTransformToHost`
     * writes.
     *
     * @param event - The raw mouse event.
     * @returns The point in unscaled graph coordinates.
     */
    private graphPointFor(event: MouseEvent): { x: number; y: number } {
        const rect = DOM.source.getViewportRect(this);
        const zoom = this.getZoom();

        return {
            x: (event.clientX - rect.left - this._panX) / zoom,
            y: (event.clientY - rect.top  - this._panY) / zoom,
        };
    }
    ```

    Route `nodeIdAtEvent` ([:1937](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1937)) and `_handleEdgeMouseMove` ([:2001](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L2001)) through it. Leave `viewportGraphRect` and `_handleWheel` alone.[^third-site] → verify: `grep -n "this._panX) / zoom" packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` — one match.

### Phase 4 — `subclassDefaults` sweep

21. Give each of the six constructors the parameter and forward it, per the shape in the table below. Add the two-line `@param subclassDefaults` JSDoc every compliant sibling carries (see [`DiagramNode.ts:112`](packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts#L112)). `VideoPlayer` keeps its `// eslint-disable-next-line local/forward-super-options` comment: it still does not forward `options` to `super`. → verify: `npm run typecheck` and `npm run lint` clean; `npm run test:lint` green.

| File | Now | After |
|---|---|---|
| `diagram/DiagramView.ts:461` | `super(options, { zoom: …, controls: true, … })` | same literal, with `...(subclassDefaults ?? {}),` appended as its last entry |
| `diagram/DiagramEdgeLayer.ts:423` | `super(options)` | `super(options, subclassDefaults)` |
| `diagram/DiagramNodeLayer.ts:76` | `super(options)` | `super(options, subclassDefaults)` |
| `chart/LineChart.ts:100` | `super(options)` | `super(options, subclassDefaults)` |
| `chart/BarChart.ts:49` | `super(options)` | `super(options, subclassDefaults)` |
| `display/VideoPlayer.ts:193` | `super()` | `super(undefined, subclassDefaults)` |

`DiagramEdgeLayer` and `DiagramNodeLayer` take `ComponentOptions`, so their new parameter is `subclassDefaults?: Partial<ComponentOptions>`.

22. **No new row in `tests/component/default-options-fallback.test.ts`.** `AbstractCanvasSurface` is abstract and cannot be constructed; the existing `DefaultedCanvas` / `DefaultedWebGLCanvas` rows already resolve `maxFps` and `animateWhenHidden` through it after Phase 2 and must keep passing unchanged.

### Phase 5 — Docs and build hygiene

23. **Fix the docs-build warning** ([DiagramEdgeLayer.ts:474](packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts#L474)). In `setEdges`'s JSDoc, replace `{@link Component.onFirstLayout} exists for exactly this "content built before the host attaches it" case.` with prose that names no symbol — e.g. `The layer therefore defers the draw to its first connected layout, which is what this "content built before the host attaches it" case needs.` → verify: `npm run docs:api` reports **0 errors and 0 warnings**.

24. **`formatMediaTime`** ([VideoPlayer.ts:55](packages/lib/src/typescript/lib/component/display/VideoPlayer.ts#L55)) — replace the `@category Components` tag with `@internal`, matching [`DIMMED_NODE_OPACITY`](packages/lib/src/typescript/lib/component/diagram/DiagramNodeLayer.ts#L47). Do not touch `component/display/index.ts`.

25. **Extend the capability manifest** `packages/lib/scripts/llms/manifest.data.mjs`. Append three rows to the existing `"Display"` group, directly after the `Canvas` row (:99):

    ```javascript
    { task: "Custom GPU drawing surface (WebGL2)", symbol: "WebGLCanvas" },
    { task: "Bare native video surface", symbol: "Video" },
    { task: "Video player with a themable control bar", symbol: "VideoPlayer" },
    ```

    Add one new group directly after `"Data / Tables / Trees"`:

    ```javascript
    { name: "Charts / Diagrams", entries: [
        { task: "Line chart over a linear or time x axis", symbol: "LineChart" },
        { task: "Grouped or stacked bar chart over a category axis", symbol: "BarChart" },
        { task: "Clickable series legend for a chart", symbol: "ChartLegend" },
        { task: "Auto-laid-out graph / diagram viewer with pan and zoom", symbol: "DiagramView" },
    ] },
    ```

    All seven symbols are unambiguous across the barrels and each has a `docs/components/<Name>.md` page, so no `subpath` or `doc` override is needed. → verify: `npm run docs:api && npm run docs:llms` emits no "No doc page found" warning, and `grep -c "WebGLCanvas\|VideoPlayer\|LineChart\|BarChart\|ChartLegend\|DiagramView" packages/lib/llms.txt` is non-zero for each.

26. **Docs pages** — see `## Documentation Impact`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/display/AbstractCanvasSurface.ts` |
| Create | `packages/lib/tests/component/diagram/DiagramView.incomingNodeDisposal.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramNodeLayer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramEdgeLayer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Canvas.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/WebGLCanvas.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/VideoPlayer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/index.ts` |
| Modify | `packages/lib/src/typescript/lib/component/chart/AbstractChart.ts` |
| Modify | `packages/lib/src/typescript/lib/component/chart/LineChart.ts` |
| Modify | `packages/lib/src/typescript/lib/component/chart/BarChart.ts` |
| Modify | `packages/lib/src/typescript/lib/component/chart/types.ts` |
| Modify | `packages/lib/src/typescript/lib/component/chart/index.ts` |
| Modify | `packages/lib/scripts/llms/manifest.data.mjs` |
| Modify | `packages/lib/tests/component/diagram/DiagramView.test.ts` |
| Modify | `packages/lib/tests/component/diagram/ElkLayoutEngine.test.ts` |
| Modify | `packages/lib/tests/component/diagram/DiagramView.createEngine.test.ts` |
| Modify | `packages/lib/tests/component/display/Canvas.test.ts` |
| Modify | `packages/lib/docs/components/DiagramView.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |

---

## Expected Behaviour

Every case below is unit-testable offline except M1–M3, which need a live browser.

**Theme-listener disposal** (new test file; read the count with `ThemeManager._themeListenerCount()`, always as a delta against a snapshot taken before the view is constructed):

- **E1 — superseded build.** Construct a `StubDiagramView` in `defer` mode, snapshot the count, call `setData` with a 20-node graph, then call `setData` again before resolving the first layout. The count after the second `setData` equals the count after the first — the superseded build released everything it registered.
- **E2 — failed layout.** With a `reject`-mode engine, snapshot, `setData` a 20-node graph, flush. The count returns to the snapshot.
- **E3 — disposal mid-flight.** With a `defer`-mode engine, snapshot, `setData` a 20-node graph, then `dispose()` without resolving. The count returns to the snapshot.

The pre-fix numbers the audit measured on this path: 9 listeners for a fresh view, 29 after one `setData(20 nodes)`, 49 after a second `setData` before the first layout landed, and 42 still held after `dispose()`.

**Node-layer sizing:**

- **E4.** After a layout resolving to a 160×230 graph, `view._nodeLayer.getPreferredSize()` is `{ width: 160, height: 230 }` — the same box `view._contentHost` and `view._edgeLayer` already get. Before the fix it is `null`.
- **E5.** A second layout with different bounds updates that box.

**Canvas family:**

- **E6.** Constructing and rendering three `Canvas` instances and one `WebGLCanvas` calls `DOM.source.matchMedia` at most once in total. Before the fix the same sequence calls it four times.
- **E7.** Every existing case in `Canvas.test.ts` and `WebGLCanvas.test.ts` passes unmodified — construction and tag, cleared insets, offline no-op, hook plumbing, loop start/stop/idempotence, teardown cancellation, pause-when-hidden (P1, P3–P8), frame timing and the fps cap, and the class-level-default resolution rows.
- **E8.** `new Canvas() instanceof AbstractCanvasSurface` and `new WebGLCanvas() instanceof AbstractCanvasSurface` are both true.

**Chart and engine:**

- **E9.** `LineChart` and `BarChart` produce the same scales and marks as before for a series set with one hidden entry — the hoisted `visiblePoints` still excludes hidden series.
- **E10.** `new ElkLayoutEngine()` with no options builds a plain main-thread ELK and resolves.
- **E11.** `new ElkLayoutEngine({ workerFactory })` builds `new ELK({ workerFactory })`; a factory that throws, or a first layout that rejects, falls back to the main thread and retries once.
- **E12.** A main-thread failure propagates without a retry.

**Coordinate helper:**

- **E13.** With `zoom: 2` and a pan of `(-40, -60)`, a `mousemove` at client `(140, 160)` over a view whose viewport rect starts at `(0, 0)` resolves to graph point `(90, 110)`. Both `nodeIdAtEvent` (while simplified) and the edge-hover path must agree on that point.

**Manual verification** (`npm run dev`, app at `http://localhost:8015`):

- **M1.** `DiagramPanel` — load a large graph, click **Fit**. Every simplified node box is drawn, including ones near the graph's right and bottom edges. Before the fix the far side of the graph is blank.
- **M2.** `MiscPanel` — the 2D and WebGL canvas demos still animate, stay crisp after a resize, and stop when their panel is hidden.
- **M3.** Drag the browser window to a monitor with a different DPI: both canvas demos re-sync their backing stores and stay crisp. This path cannot be exercised offline — the modelled `matchMedia` never fires.

---

## Verification

```
npm run typecheck
npm run test
npm run lint            # clean; no baseline edits
npm run test:lint       # eslint rule self-tests
npm run docs:api        # MUST report 0 errors and 0 warnings
npm run docs:llms
```

Grep invariants, all expected to return nothing:

```
grep -rn "workerUrl" packages/lib/src packages/lib/tests --exclude=elkjs.d.ts
grep -rn "ChartStoreBinding" packages/
grep -rn "watchDevicePixelRatio\|_dprToken" packages/lib/src
```

And these, expected to return exactly one match each:

```
grep -rn "private visiblePoints\|protected visiblePoints" packages/lib/src
grep -n "this._panX) / zoom" packages/lib/src/typescript/lib/component/diagram/DiagramView.ts
grep -n "_nodeLayer.setPreferredSize" packages/lib/src/typescript/lib/component/diagram/DiagramView.ts
```

Then confirm all seven new symbols appear in `packages/lib/llms.txt`, and run M1–M3 from `## Expected Behaviour` against `npm run dev`.

---

## Documentation Impact

- **`packages/lib/docs/components/DiagramView.md`** — remove the `elkWorkerUrl` bullet at line 158 and the trailing "see … for why `elkWorkerUrl` alone does not" clause at line 166. The "Running ELK layout in a Web Worker" section keeps its `elkWorkerFactory` example unchanged.
- **`packages/lib/docs/reference/changelog/next.md`** — one entry: `AbstractCanvasSurface` is now the shared base for `Canvas` and `WebGLCanvas`; the diagram viewer no longer leaks theme listeners for discarded graphs; simplified nodes are no longer clipped at low zoom.
- **`packages/lib/docs/reference/migration/next.md`** — three removals: `ChartStoreBinding`, `DiagramViewOptions.elkWorkerUrl`, `ElkLayoutEngineOptions.workerUrl`. For the last two, name `elkWorkerFactory: () => new Worker(url)` as the replacement.
- **No new curated page and no catalog row for `AbstractCanvasSurface`.** `AbstractChart` sets the precedent: barrel-exported so its generated API page exists and subclass pages can link to it, with no page under `docs/components/`, no row in `docs/components/index.md`, and no sidebar entry.
- **No docs change for `formatMediaTime`** — it was never in the public API and is not being added to it.
- `docs/api/` is generated and gitignored; `npm run docs:api` regenerates it.

---

## Potential Challenges

- **The extraction is a move, not a rewrite.** Retyping the thirteen shared methods invites a silent behaviour change. Move the bodies verbatim and let the pre-existing cases in `Canvas.test.ts` and `WebGLCanvas.test.ts` (E7), which are not edited, be the proof.
- **`_elapsedMs` and the three `_synced*` fields must be `protected`, not `private`.** `Canvas.redraw` reads `_elapsedMs`; `WebGLCanvas.renderFrame` reads it too. A `private` declaration on the base compiles until the subclass touches it.
- **The theme-listener test is sensitive to suite-wide pollution.** `ThemeManager._themeListenerCount()` is process state; any other test leaving a live theme-subscribing component undisposed shifts it. Keep the test in its own file and always assert deltas, never absolute counts — the reason `TextDispose.test.ts` is a separate file.
- **The DPR watch arms once per process, so a spy-count assertion is order-dependent unless phrased as an upper bound.** Assert "at most one call" (E6), not "exactly one".
- **`AbstractCanvasSurface` must not be wrapped with `callable()`.** A class with abstract members cannot be constructed, so the usual `_X` / `X` alias pair does not apply — export it as a plain `export abstract class`, exactly as `AbstractChart` does.
- **Adding `subclassDefaults` to `VideoPlayer` changes what reaches `_defaultOptions`.** Its `super()` currently receives nothing at all; after the change a subclass bag flows into the base cascade, where `Component.applyOptions` dispatches the chrome group (`border` / `borderRadius` / `shadow` / `backgroundImage`) even from defaults. `VideoPlayer` has no subclass today, so the bag is `undefined` and nothing changes — but do not also start forwarding `options`, which is what the eslint-disable comment guards.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/chart/AbstractChart.ts`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts) — the abstract-base precedent (class header at :121, constructor at :173, `sizeSurface` at :597). Read before writing `AbstractCanvasSurface`.
- [`packages/lib/src/typescript/lib/component/display/Glyph.ts`](packages/lib/src/typescript/lib/component/display/Glyph.ts) — the `WeakRef` registry plus module-level named `matchMedia` handler (:42–:121, `_syncReducedMotion` at :616).
- [`packages/lib/src/typescript/lib/component/diagram/DiagramView.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) — `applyLayout`'s edge-layer block (:895–:898) is the shape the node-layer fix mirrors.
- [`packages/lib/tests/core/TextDispose.test.ts`](packages/lib/tests/core/TextDispose.test.ts) — the theme-listener-count test pattern and its isolation rationale.
- [`packages/lib/tests/component/diagram/DiagramView.test.ts`](packages/lib/tests/component/diagram/DiagramView.test.ts) — `StubEngine` / `StubDiagramView` (:24–:71) and the `getPreferredSize` assertion style (:261).
- [`packages/lib/src/typescript/lib/component/container/MenuRow.ts`](packages/lib/src/typescript/lib/component/container/MenuRow.ts#L54) — the bare `super(options, subclassDefaults)` shape for a class with no defaults of its own.
- [`packages/lib/scripts/llms/manifest.data.mjs`](packages/lib/scripts/llms/manifest.data.mjs) — entry shape and the drift guard described in its header.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Listeners must reference a named function*, *Constructors forward `subclassDefaults`*, *Components are exported through `callable()`*.
- [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md) — *Don't `{@link}` internal symbols from public JSDoc*.

---

## Non-Goals

- **Collapsing `_workerBacked` into `_ownsWorker`.** Removing `workerUrl` makes the two flags coincide, but merging them reshapes `layout`'s retry branch and the dozen tests around it for no behaviour change.
- **Making `elkWorkerUrl` work.** Constructing a `Worker` inside the library was ruled out when `elkWorkerFactory` was designed, and a consumer reaches the same result in one line.
- **Publishing `formatMediaTime`.** Widening the public API is not a fix for a mis-tagged internal helper.
- **Touching `viewportGraphRect` or `_handleWheel`.** Neither computes the same value as `graphPointFor`.
- **A curated docs page for `AbstractCanvasSurface`.** Consumers use `Canvas` and `WebGLCanvas`; the base exists so the two share mechanics.
- **The other findings in the same audit** — the table scroll hot path, `CodeEditor.syncAutoHeight`, `Header`'s duplicated reconcilers, `RadioMenuRow` / `CheckboxMenuRow`, the broken doc links, and the rest belong to their own plans.

---

## Notes

[^canvas-base]: The original decision against a shared base ([plans/implemented/webgl-component.md:24-30](plans/implemented/webgl-component.md)) rested on three claims, and all three have since failed. First, "the shared surface is ~6 lines of backing-store math, and everything downstream diverges" — the shared surface is now thirteen byte-identical method bodies and nine identical fields (`setMaxFps` is a fourteenth, differing only by the word "above" in a comment), against three short, genuinely divergent seam bodies. Second, "hoisting would force editing the already-planned `Canvas` class, coupling this plan back into its dependency" — a sequencing constraint of a plan that has long since shipped; both classes are already being edited here. Third, "with only two classes the rule-of-three isn't met" — `AbstractChart` sets the in-repo bar at two siblings, in the same development window, and the practical cost the rule-of-three stands in for has already been paid: five commits have edited both files and both their test files in lockstep (`54a395a9`, `1c416b56`, `a1bc8eb5` on 2026-07-18; `653e34e4`, `1e11d70d` on 2026-07-30), four of them titled "…Canvas and WebGLCanvas…". That plan's own Non-Goals call the base "a possible future refactor", so this is executing a deferral rather than reversing a decision. The alternative — keeping the copy and only fixing `Canvas.syncBackingStore`'s false "reusable seam shared with the WebGL sibling" comment — was rejected: it leaves the lockstep-edit cost in place and forces the device-pixel-ratio fix in the next decision to be written and maintained twice.

[^base-name]: `webgl-component.md` names the hypothetical base `AbstractCanvasSurface` twice, in its Architecture Decisions and its Non-Goals. Reusing that name keeps the historical link legible. `AbstractCanvas` was rejected because `Canvas` is a concrete sibling and the pair would read as a base and its default implementation.

[^dpr-registry]: The current per-instance watch is a real leak, not the "inert listener" its own comment claims: `addChangeListener(() => this.onDevicePixelRatioChange(token))` pins `this` inside a live `MediaQueryList`'s listener list, and `MediaQueryResult` ([core/DOM.ts:1496](packages/lib/src/typescript/lib/core/DOM.ts#L1496)) offers no unsubscribe at all, so the whole component and its subtree survive teardown. Two fixes were considered. Widening the seam with a disposer would edit `core/DOM.ts`, a shared file two other in-flight round-2 branches are likely to touch, for a leak that has a local fix. The module-level registry needs no seam change, holds only weak references, and collapses N per-instance watches into one — which is correct anyway, since `getDevicePixelRatio` reads `window.devicePixelRatio` and every surface in the process sees the same value. One inert listener per ratio change survives for the process, exactly as in `Glyph`.

[^layer-sizing]: `AbstractChart.sizeSurface` writes `width` / `height` / `viewBox` attributes because its `<svg>` is a raw sink-created child of a `Panel`, outside the layout system — nothing else would ever size it. `DiagramEdgeLayer` and `DiagramNodeLayer` are framework `Component`s whose boxes the layout system commits, and the edge layer already works with no `viewBox` at all: both layers sit at the content host's origin, so SVG user space maps 1:1 onto CSS pixels. Following the chart's shape here would add attributes the sibling proves unnecessary. Today the node layer has no preferred size and no layout manager, so `Absolute.doLayout` derives `NaN` for both axes, the browser drops the resulting `NaNpx` inline style, and the `<svg>` falls back to a replaced element's default box — which the framework tier's `overflow: hidden` then clips.

[^worker-url]: `workerUrl` is documented in its own JSDoc as never producing a worker with the `elk.bundled.js` module this engine imports, and `docs/components/DiagramView.md` says the same. It is not merely inert: `createElk`'s URL branch sets `_workerBacked = true`, which makes the *next* layout failure — whichever one it is, however unrelated — tear down and rebuild the engine and retry once before propagating. CLAUDE.md's "no configurability that wasn't requested" settles the direction. The alternative, having the library call `new Worker(url)` itself, was rejected: `elk-layout-web-worker.md` deliberately kept every `Worker` construction on the consumer side, and `elkWorkerFactory: () => new Worker(url)` already expresses the same intent.

[^chart-binding]: `plans/implemented/svg-charting.md` specified `ChartStoreBinding` in `chart/types.ts` (:269) *and* the flat `store` / `xField` / `yField` / `seriesField` fields on `AbstractChartOptions` (:277-282), and its own option-to-setter table (:335) routes the flat fields through `setStore`. So the flat path is the intended one and the interface was redundant from the start, not drift away from a better design. It has no reference in any source file, test, or docs page.

[^format-media-time]: `plans/implemented/video-player.md`'s barrel step (:194) lists exactly `Video`, `VideoOptions`, `VideoPlayer`, `VideoPlayerOptions`, `PlaybackEngine`, and `ProgressiveEngine` — `formatMediaTime` is absent, and its own JSDoc gives the reason for the module export as "Pure and module-level so it is trivially unit-testable". Adding it to the barrel was the other option, and `Markdown.ts`'s `extractMarkdownHeadings` / `findActiveHeading` show the codebase does publish helper functions this way. It was rejected because publishing an API nobody asked for is the larger change, and `@internal` makes the JSDoc honest at zero cost.

[^lint-blind-spot]: The rule's own header comment states the narrowing: it fires only when the second `super()` argument is a `_default<Name>Options` constant, or an object literal spreading one. `DiagramEdgeLayer`, `DiagramNodeLayer`, `LineChart`, and `BarChart` pass one argument; `VideoPlayer` passes none; `DiagramView` passes an inline literal with no such constant. All six are silent to the rule and all six are dead ends under ARCHITECTURE.md's "forward it even when no subclass exists yet".

[^third-site]: The audit counted three copies of the inversion, naming `viewportGraphRect` as the third. It is a different computation: it maps the viewport *box* into graph space from the pan offset and zoom alone, takes no event, never calls `getViewportRect`, and returns a rect. `_handleWheel` ([DiagramView.ts:2103](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L2103)) shares only the `getViewportRect` plus `clientX - rect.left` half and stops there, because `zoomAboutViewportPoint` wants a viewport-space point, not a graph-space one. Exactly two sites are verbatim copies, and those two are what `graphPointFor` replaces.

[^test-coverage]: Each deleted case has a surviving twin. `with no factory and no url…` (:474) already covers the plain main-thread build. `falls back … when the worker constructs but the first layout rejects` (:514) covers the same fallback path the `workerUrl` variant exercised. `E3: does not terminate a main-thread instance` (:637) covers the `terminateOwnedWorker` guard that `E4` covered from the URL side, and `R1` covers main-thread disposal for `R2`. The precedence case has nothing left to test once one of the two options is gone.

---

## Implementation Notes

- **Step 10 (`WebGLCanvas`'s `webglcontextrestored` listener) was already satisfied.** The codebase at this branch's start point already declared `_onContextRestored` as a named field and registered it by reference — presumably a side effect of one of the ten already-implemented plans this branch is stacked on. No change was needed; `AbstractCanvasSurface.ts`'s extraction carried the existing named field forward unchanged.

- **`VideoPlayer`'s `local/forward-super-options` eslint-disable comment was removed, not kept.** The plan's step 21 expected it to survive since `options` still isn't forwarded to `super()`. But the rule (`scripts/eslint/forward-super-options.js`) fires only on a bare, zero-argument `super()` call — once the constructor forwards `subclassDefaults` via `super(undefined, subclassDefaults)`, the call has two arguments and the rule has nothing to flag, which `npm run lint` confirmed as an "unused eslint-disable directive" warning. Removed the comment to keep `lint` clean; recorded here since the plan said the opposite.

- **`generate.mjs`'s `TOKEN_BUDGET` needed raising, an edit outside the plan's Files table.** The site-variant `llms.txt` was already at ~6438/6440 tokens before this plan's seven new catalog rows — essentially zero headroom. Adding the rows pushed it to ~6931. Followed that constant's own well-established in-file precedent (five prior "raised again from N" comments, one per catalog addition that crossed the prior ceiling) and raised it to 6940, with a matching comment. `generate.mjs` is not in the plan's "Files to Create/Modify/Delete" table, but the file's own header explains this is the sanctioned way to accommodate catalog growth, and the repo's own history (`85abc40b`) shows the same budget-bump riding along with a manifest addition in one commit.

- **The `ChartStoreBinding` grep invariant conflicts with the plan's own Documentation Impact instruction, and the documentation instruction was followed.** Step 15's local verification anticipated this ("zero matches outside `plans/implemented/`"), but the plan's consolidated `## Verification` section repeats the same grep with no such exception, and `docs/reference/migration/next.md` is required (by the same plan, `## Documentation Impact`) to name `ChartStoreBinding` as one of three removals. A migration note that cannot name what it says was removed is not a fix, so the migration doc's two mentions stand; the consolidated grep invariant is stale relative to the later-drafted Documentation Impact section.

- **`DiagramView.test.ts`'s D4 needed updating as a direct consequence of the step 1/2 fix, not a plan instruction.** D4 previously asserted that `_incomingComponents` stayed untouched after `dispose()` until a stale rejection landed, as proof the layout-generation guard (not `dispose()`) was what discarded it. Once `dispose()` itself calls `discardIncomingNodes()` (the theme-listener-leak fix), that map is empty immediately after `dispose()` returns, so the original assertion no longer holds and no longer proves anything about the guard either way. Rewrote it to spy on `discardIncomingNodes` and assert it is called exactly once — once by the destructor, and not again when the stale rejection's generation check fails — preserving the test's original intent (the guard, not the map's contents, is what's being pinned).

- **Manual verification (M1, M2) was carried out against the running dev app**, per the plan's own Expected Behaviour. M1: a synthetic 300-node graph (over `LOD_MIN_NODES` = 200) constructed directly against the live `DiagramView` module and fit to a 900×600 host confirmed `_nodeLayer`'s committed box equals the graph bounds exactly (previously `null`/`NaN`-collapsed) and that all 300 simplified rects draw, including all four graph corners — screenshotted. M2: the `MiscPanel` `Canvas` demo's pulse was confirmed animating via pixel sampling, confirmed frozen while its tab was hidden, and confirmed resuming on return to the tab. M2's `WebGLCanvas` half could not be visually verified: this headless Chrome build reports no WebGL2 support at all (`canvas.getContext('webgl2')` is `null` even for a bare test canvas), so the demo's `hasRenderingContext()` legitimately returns `false` and every draw path no-ops — an environment limitation, not a code path this plan could exercise; no console errors were raised from that null-context path either. M3 (dragging between differently-scaled monitors) remains impossible to exercise in any offline/headless environment, exactly as the plan states.
