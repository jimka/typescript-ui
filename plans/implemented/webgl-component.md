---
depends-on: [canvas-component]
touches-shared: [src/typescript/lib/core/DOM.ts, tests/dom/TestDOM.ts]
---

# WebGL Component — Implementation Plan

## Overview

Add a `WebGLCanvas` leaf component — a `<canvas>` backed by a live `WebGL2RenderingContext` — to the display family, as a sibling of the 2D [`Canvas`](plans/canvas-component.md) planned in **`plans/canvas-component.md`**. It mirrors `Canvas`'s exact shape ([`Image`](src/typescript/lib/component/display/Image.ts#L40)-style leaf): a `Component` subclass with `tag: "canvas"` in its class defaults, `clearInsets()` in the constructor, options-bag construction, and a `callable()` export.

This plan **depends on `canvas-component`** and does not restate its shared decisions. It **reuses the two DOM seams that plan authors** — the generic [`DOM.sink.getContext`](plans/canvas-component.md) (called with `"webgl2"` instead of `"2d"`) and [`DOM.source.getDevicePixelRatio`](plans/canvas-component.md) — and adds **nothing** to `DOM.ts` itself. The component owns the canvas element, the GL context, the animation loop, and context-loss recovery; the consumer owns shaders, buffers, and draw calls via two hooks. Like `Canvas`, it is a **live-only** component: the modelled sink returns `null` from `getContext`, and the component then no-ops offline.

The substance unique to WebGL — beyond what `Canvas` already establishes — is four things: a `gl.viewport()` call on every backing-store resize (2D uses a context transform instead), a continuously-running render loop that is central rather than optional, `webglcontextlost` / `webglcontextrestored` recovery wired through the `Event` system, and a two-phase consumer contract (`onContextInit` to build GL resources, `onFrame` to draw them).

---

## Architecture Decisions

### Depends on `canvas-component`; reuses its seams, reimplements its own thin class

`canvas-component` (this plan's hard dependency) authors both DOM seams and lands first. `WebGLCanvas` therefore adds **zero** methods to [`DOM.ts`](src/typescript/lib/core/DOM.ts): it calls the identical `DOM.sink.getContext(handle, "webgl2")` and `DOM.source.getDevicePixelRatio()`. The generic seam's return type is the `lib.dom` `RenderingContext` union — which includes `WebGL2RenderingContext` — so this component narrows the result to `WebGL2RenderingContext` itself, exactly as the canvas plan anticipated ("the WebGL component reuses the identical method and narrows the result itself").

**No shared base class.** `WebGLCanvas extends Component` directly and reimplements the backing-store / DPR-watch / rAF-loop machinery rather than inheriting it from `Canvas`. Rationale, weighed explicitly:

- The two components' backing-store *math* is identical (~6 lines: CSS×dpr → `width`/`height` attributes), but everything downstream of it **diverges**: 2D re-applies `ctx.setTransform(dpr,…)`, WebGL calls `gl.viewport(0,0,bw,bh)`; the context field type differs (`CanvasRenderingContext2D` vs `WebGL2RenderingContext`); the draw hook differs (`onDraw(ctx,w,h)` vs `onContextInit(gl)` + `onFrame(gl,w,h)`); and WebGL adds context-loss handling that 2D has none of.
- Hoisting the shared parts into an `AbstractCanvasSurface` base would force **editing the already-planned `Canvas` class** to extend it — coupling this plan back into its dependency, contrary to the surgical-changes convention and the fixed sibling plan. With only two classes and diverging draw semantics, the rule-of-three isn't met.
- The project's convention permits abstract intermediates (`AbstractWindow`, `AbstractCalendarDropdown` exist), so a future base is *possible* — but is a deferred refactor (see Non-Goals), not this plan's work.

Net: reuse the seams (shared), copy the small backing-store math and DPR-watch/rAF idioms from `Canvas` (independent reimplementation). This keeps each component a thin, self-contained leaf.

### WebGL2, not WebGL1

The context is acquired as `"webgl2"`. WebGL2 is baseline in every current evergreen browser and gives the consumer the modern GLSL ES 3.00 / VAO / instancing surface without a capability dance. A WebGL1 fallback (`getContext("webgl")` when `"webgl2"` returns `null`) is a **Non-Goal** — it would double the consumer contract's context-version branching for a shrinking set of targets. The seam is generic over `contextId`, so a consumer that truly needs WebGL1 can be served by a future option without reshaping the component.

### Context acquisition via the shared seam; null → live-only no-op

`getContext()` lazily narrows `DOM.sink.getContext(element, "webgl2")` to `WebGL2RenderingContext` and caches it in `_gl`. Under the modelled sink the seam returns `null`, so `_gl` stays `null` and every path (`syncBackingStore`, `renderFrame`, `startAnimation`) guards on it and no-ops — the same live-only stance `canvas-component` documents. A live GL context cannot cross a worker boundary; that break **is** the seam boundary, and `WebGL2RenderingContext` is **not** one of the DOM-lib types the `no-raw-dom` rule flags (it lists `Element` / `HTMLElement` / `Window` / `MediaQueryList` / CSS-rule types only — see [scripts/eslint/no-raw-dom.js:32](scripts/eslint/no-raw-dom.js#L32)), so once the seam mints `gl`, calling `gl.viewport` / `gl.clear` / `gl.drawArrays` is ordinary graphics code.

### Backing-store sync in `doLayout()`, plus a `gl.viewport()` call — the one seam WebGL overrides

Backing-store sizing reuses `canvas-component`'s decision verbatim: the sync hangs off `doLayout()` (not `setSize`), reads **cached** `getWidth()`/`getHeight()` (never DOM geometry — the inline size is still buffered by `commitBounds`), multiplies by `DOM.source.getDevicePixelRatio()`, and short-circuits on unchanged width/height/dpr so idle passes don't wipe the drawing buffer. See `plans/canvas-component.md` → *Backing-store sync happens in `doLayout()`* for the full rationale; it is not restated here.

The **only** WebGL-specific divergence is the post-resize call. `canvas-component` notes: "This policy is 2D-specific (WebGL sets its own `gl.viewport(0, 0, backingW, backingH)` instead) — it is the one seam that the WebGL plan overrides rather than shares." So `WebGLCanvas.syncBackingStore()`, after reassigning the `width`/`height` attributes, calls `gl.viewport(0, 0, backingW, backingH)` (in **device** pixels, not CSS px) rather than `ctx.setTransform`. Two further WebGL-specific facts shape this: (a) reassigning a WebGL canvas's `width`/`height` resizes the drawing buffer but does **not** destroy the context or its GL resources, so no resource rebuild is needed on resize — only a fresh `gl.viewport`; (b) the consumer's projection math typically wants the logical CSS-px size, so `syncBackingStore` finishes by calling `renderFrame()` (which passes CSS-px `width`/`height` to `onFrame`), re-emitting one frame on the resized buffer for the static (non-animating) case.

### Render loop is central; starts on first connected layout, stops in `destructor()`

Unlike 2D, a GL canvas is usually continuously animated, so the loop lifecycle is load-bearing. The loop is driven by [`DOM.sink.requestAnimationFrame`](src/typescript/lib/core/DOM.ts#L626) / [`cancelAnimationFrame`](src/typescript/lib/core/DOM.ts#L633), each frame calling `renderFrame()` and rescheduling; `_rafId` holds the active handle. `destructor()` calls `stopAnimation()` before `super.destructor()`, mirroring [`StatusBar`](src/typescript/lib/component/container/StatusBar.ts#L310)'s cleanup discipline — cancelling the frame so no leaked closure holding `this` survives teardown.

The loop **starts automatically** on the component's first connected, sized layout via [`onFirstLayout`](src/typescript/lib/core/Component.ts#L4653) — a per-instance "mounted + connected + sized" signal that fires right after the host (a dock tab, an accordion body) attaches and lays the component out. `render()` alone is too early (the element may be built while still detached). Consumers can also call `startAnimation()` / `stopAnimation()` explicitly for a static or on-demand GL surface.

### No clean per-component "hidden tab" pause signal — documented, with two honest mitigations

The task asks the loop to pause when the component is not displayed. Investigation of `Component` shows **no clean per-component signal for this**:

- [`isDisplayed()`](src/typescript/lib/core/Component.ts#L1505) reflects the component's **own** `displayed` option, **not** ancestor visibility — a canvas on a hidden tab still returns `isDisplayed() === true`.
- A hidden tab sets `display:none` on an ancestor; the parent layout manager filters [`getLaidOutComponents`](src/typescript/lib/core/Component.ts#L4457) to displayed children, so the hidden subtree simply **stops receiving `doLayout`**. But the leaf gets no "I became hidden" callback, and Tab keeps its panels **mounted** (they are not detached/destroyed on tab switch).

Given that, the design does **not** attempt an automatic in-app-hidden-tab pause (it would need an IntersectionObserver seam or an `offsetParent`/geometry read — a large, live-only addition unwarranted for v1). Instead:

- **Browser-tab-hidden pause is free**: the browser natively throttles `requestAnimationFrame` to ~0 Hz when the whole page is hidden (Page Visibility), so the loop self-pauses there with no code.
- **In-app hidden tab**: the loop keeps running while mounted; this is a documented limitation (Potential Challenges / Non-Goals). The consumer or a host container can call `stopAnimation()` / `startAnimation()` to pause explicitly. This is the "fall back to attach/detach" the task allows: start on first connected layout (attach), stop in `destructor()` (detach/teardown).

### Context loss / restore wired through the `Event` system

WebGL contexts can be lost (GPU reset, tab backgrounding, driver hiccup). Recovery is mandatory for a robust GL component. Both events are wired with [`Event.addListener(this, …)`](src/typescript/lib/core/Event.ts#L226) in `render()` (exact-target, keyed by the canvas component's own id):

- `webglcontextlost` — the handler calls `event.preventDefault()` (**required** — without it the browser will not fire `restored`) and sets `_contextLost = true`, so `renderFrame()` skips drawing while lost. `Event.addListener` installs a **capture-phase** window listener; the capture phase reaches the canvas for **any** event dispatched on it regardless of the event's `bubbles` flag, and these types are **not** in `PASSIVE_TYPES` ([Event.ts:42](src/typescript/lib/core/Event.ts#L42)) so `passive` defaults to `false` and `preventDefault()` is honoured.
- `webglcontextrestored` — the handler clears `_contextLost`, marks `_contextInitialised = false` (so the next frame re-runs `onContextInit` to rebuild GL resources), and re-runs `syncBackingStore()` to reset the viewport on the fresh drawing buffer.

### Consumer contract: `onContextInit(gl)` + `onFrame(gl, width, height)` — option callbacks

The consumer contract is two hooks, supplied as **option callbacks** with setters (mirroring `Canvas`'s `onDraw` idiom and the options-bag convention), not a subclass-override protocol:

- **`onContextInit(gl)`** — called once when the context is first acquired **and again after every `webglcontextrestored`**. This is where the consumer (re)builds shaders, programs, buffers, VAOs, and textures. It is the WebGL analogue of the "survive the wipe" concern `Canvas` handles in `onDraw`, but for GPU resources rather than pixels.
- **`onFrame(gl, width, height)`** — called every animation frame (and once after each resize) with the **logical (CSS-px)** size for projection math. The consumer issues draw calls; the component has already set the viewport in device pixels.

No speculative surface beyond this — no shader-compile helpers, no uniform/attribute wrappers, no scene graph, no `readPixels` export (see Non-Goals). A consumer that wants direct access uses `getContext()`.

### Baseline, insets, theming — inherited from Component, unchanged

Baseline stays `null` (a leaf's [`getBaseline()`](src/typescript/lib/core/Component.ts#L2634) — correct for a graphical element); `clearInsets()` in the constructor (a drawing surface has no chrome); no `getPreferredSize` override (a GL canvas has no intrinsic size — consumer supplies `preferredSize` or a stretching parent). All identical to `canvas-component`; see it for rationale.

---

## Public API

### New component: `src/typescript/lib/component/display/WebGLCanvas.ts`

```typescript
/** Called once on first context acquisition and after every context restore.
 *  Build (or rebuild) shaders, programs, buffers, and textures here. */
export type WebGLContextInitCallback = (gl: WebGL2RenderingContext) => void;

/** Per-frame draw callback. `width`/`height` are the logical CSS-px size;
 *  the drawing-buffer viewport is already set in device pixels. */
export type WebGLFrameCallback = (
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
) => void;

export interface WebGLCanvasOptions extends ComponentOptions {
    /** GL-resource (re)build hook; runs on init and after each context restore. */
    onContextInit?: WebGLContextInitCallback;
    /** Per-frame draw hook. */
    onFrame?: WebGLFrameCallback;
}

class WebGLCanvas extends Component<WebGLCanvasOptions> {
    constructor(options?: WebGLCanvasOptions);

    /** Returns the WebGL2 context, or null offline / before first render. */
    getContext(): WebGL2RenderingContext | null;

    setOnContextInit(handler: WebGLContextInitCallback | null): this;
    getOnContextInit(): WebGLContextInitCallback | null;
    setOnFrame(handler: WebGLFrameCallback | null): this;
    getOnFrame(): WebGLFrameCallback | null;

    /** Starts / stops the per-frame render loop. */
    startAnimation(): this;
    stopAnimation(): this;
    isAnimating(): boolean;

    /** Resizes the backing store to CSS×dpr, sets gl.viewport in device px,
     *  and re-emits one frame. Called from doLayout on every size change. */
    protected syncBackingStore(): void;

    protected doLayout(): this;   // super.doLayout() + syncBackingStore()
    protected render(): Handle;   // super.render() + wire loss/restore + arm DPR watch + onFirstLayout(startAnimation)
    protected destructor(): void; // stopAnimation() + super.destructor()
}
```

State (all runtime-only — none written during the `super()` cascade, so plain fields):

| Field | Type | Purpose |
|---|---|---|
| `_gl` | `WebGL2RenderingContext \| null` | Cached context; `null` offline / pre-render. |
| `_rafId` | `number \| null` | Active animation-frame handle; `null` when idle. |
| `_contextLost` | `boolean` | True between `webglcontextlost` and `restored`; frames skip. |
| `_contextInitialised` | `boolean` | False until `onContextInit` has run for the current context; reset on restore. |
| `_syncedWidth` / `_syncedHeight` / `_syncedDpr` | `number` | Last-synced values; guard redundant buffer resizes. |
| `_dprToken` | `number` | Generation counter guarding DPR-watch re-arms. |

`onContextInit` / `onFrame` are consumer-configurable, so they live on the `_options` bag (cache = options bag per the typed-setter rule); each setter writes `this._options.<key>` and `applyOptions` forwards them when present. `setOnContextInit` sets `_contextInitialised = false` so the new hook runs next frame; `setOnFrame` needs no re-init.

### Seam additions: **none**

`WebGLCanvas` adds nothing to [`DOM.ts`](src/typescript/lib/core/DOM.ts). It reuses `DOM.sink.getContext(handle, "webgl2")` and `DOM.source.getDevicePixelRatio()` authored by `canvas-component`. `touches-shared` lists `DOM.ts` and `tests/dom/TestDOM.ts` only because both plans reference the same seam surface — if `canvas-component` has already landed (the `depends-on` guarantees it), this plan makes no edit there.

---

## Internal Structure

`syncBackingStore()` — WebGL variant (guarded, no DOM reads; `gl.viewport` replaces the 2D transform):

```typescript
protected syncBackingStore(): void {
    const gl = this.getContext();            // null offline → whole sync no-ops
    if (!gl) return;

    const width  = this.getWidth();           // cached CSS px
    const height = this.getHeight();
    const dpr    = DOM.source.getDevicePixelRatio();

    if (width === this._syncedWidth && height === this._syncedHeight && dpr === this._syncedDpr) {
        return;                               // nothing changed — don't resize the buffer
    }

    const backingW = Math.round(width  * dpr);
    const backingH = Math.round(height * dpr);

    DOM.sink.apply(this.getElement()!, { setAttr: {
        width:  String(backingW),
        height: String(backingH),
    }});                                      // resizes the drawing buffer (GL resources survive)

    gl.viewport(0, 0, backingW, backingH);    // WebGL-specific — device px, not CSS px

    this._syncedWidth  = width;
    this._syncedHeight = height;
    this._syncedDpr    = dpr;

    this.renderFrame();                       // re-emit one frame on the resized buffer
}
```

`renderFrame()` — single frame; lazy one-time init, skip while lost:

```typescript
private renderFrame(): void {
    const gl = this.getContext();
    if (!gl || this._contextLost) return;

    if (!this._contextInitialised) {
        this._options.onContextInit?.(gl);    // build/rebuild GL resources
        this._contextInitialised = true;
    }

    this._options.onFrame?.(gl, this.getWidth(), this.getHeight());  // CSS px
}
```

Animation loop:

```typescript
startAnimation(): this {
    if (this._rafId !== null) return this;     // already running — don't stack
    const step = () => {
        this.renderFrame();
        this._rafId = DOM.sink.requestAnimationFrame(step);
    };
    this._rafId = DOM.sink.requestAnimationFrame(step);
    return this;
}

stopAnimation(): this {
    if (this._rafId !== null) {
        DOM.sink.cancelAnimationFrame(this._rafId);
        this._rafId = null;
    }
    return this;
}
```

Context loss / restore, wired in `render()`:

```typescript
protected render(): Handle {
    const element = super.render();

    Event.addListener(this, "webglcontextlost", (e: Event) => {
        e.preventDefault();                    // REQUIRED to enable restoration
        this._contextLost = true;
    });
    Event.addListener(this, "webglcontextrestored", () => {
        this._contextLost = false;
        this._contextInitialised = false;      // onContextInit reruns next frame
        this.syncBackingStore();               // reset viewport on the fresh buffer
    });

    this.watchDevicePixelRatio();              // mirrors canvas-component
    this.onFirstLayout(() => this.startAnimation());

    return element;
}
```

`watchDevicePixelRatio()` is copied from `canvas-component` (generation-token guarded, element-existence guarded, re-arms on each DPR change and calls `syncBackingStore()`); see that plan for the rationale and the `matchMedia`-lacks-unsubscribe caveat — not restated here.

---

## Ordered Implementation Steps

1. **Confirm the dependency landed** — the `getContext` / `getDevicePixelRatio` seams must exist (authored by `canvas-component`). → verify: `grep -n "getContext\|getDevicePixelRatio" src/typescript/lib/core/DOM.ts` shows the interface + production entries; `grep -n "getContext\|getDevicePixelRatio" tests/dom/TestDOM.ts` shows the modelled impls. If absent, `canvas-component` has not landed — stop (dependency violation).
2. **Component** — create [component/display/WebGLCanvas.ts](src/typescript/lib/component/display/WebGLCanvas.ts): `WebGLCanvasOptions`, the two callback types, the class per Public API, `callable()` export (`_WebGLCanvas` / `WebGLCanvas`) matching `Image` / `ProgressBar`. → verify: file compiles; `grep -n "callable(WebGLCanvas)" src/typescript/lib/component/display/WebGLCanvas.ts`.
3. **Barrel export** — [component/display/index.ts](src/typescript/lib/component/display/index.ts): `export { WebGLCanvas }` and `export type { WebGLCanvasOptions, WebGLContextInitCallback, WebGLFrameCallback }`, near the `Image`/`Canvas` rows. → verify: `grep -n "WebGLCanvas" src/typescript/lib/component/display/index.ts`.
4. **Lint baseline** — run the `no-raw-dom` rule; confirm `WebGLCanvas.ts` introduces **zero** new raw-DOM findings (it names only `WebGL2RenderingContext`, which is unflagged). → verify: `npm run lint` clean, no baseline edit.
5. **Default-options registry** — add a `WebGLCanvas` row to [tests/component/default-options-fallback.test.ts](tests/component/default-options-fallback.test.ts) only if it defaults a folding-getter field (it doesn't — `onContextInit`/`onFrame` have no class default), so confirm and skip if not applicable. → verify: that test passes.
6. **Unit tests** — cover U1–U7 (offline, modelled sink/source). → verify: the suite passes.
7. **Docs** — see Documentation Impact.
8. **Demo** — add a small `WebGLCanvas` example (a clear-colour or a triangle) to an existing display demo (e.g. [src/typescript/MiscPanel.ts](src/typescript/MiscPanel.ts)) for the manual live smoke test. → verify: `npm run dev`, open the panel, see the GL output, crisp on resize/zoom.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/display/WebGLCanvas.ts` |
| Modify | `src/typescript/lib/component/display/index.ts` (barrel export) |
| Modify | `tests/component/default-options-fallback.test.ts` (registry row, if applicable) |
| Create | `tests/component/display/WebGLCanvas.test.ts` (U1–U7) |
| Modify | `src/typescript/MiscPanel.ts` (demo for live smoke test) |
| Create | `docs/components/WebGLCanvas.md` |
| Modify | `docs/components/index.md` (catalog row) |
| Modify | `docs/.vitepress/config.mts` (Display sidebar entry) |

No edit to `src/typescript/lib/core/DOM.ts` or `tests/dom/TestDOM.ts` — the seams come from `canvas-component` (see `touches-shared` frontmatter).

---

## Expected Behaviour

Unit-testable against the modelled sink/source (offline):

- **U1 — construction & tag.** `new WebGLCanvas()` (and `WebGLCanvas({...})`) builds a component whose element tag is `canvas`; `getElement(true)` records a `createElement("canvas")` on the recording sink.
- **U2 — insets cleared.** Constructed insets are zero (mirrors `Image` / `Canvas`).
- **U3 — offline no-op.** Under the modelled source, `getContext()` returns `null`; `syncBackingStore()`, `startAnimation()`, and a frame all run without throwing (every path guards on the null context).
- **U4 — options plumbing.** `WebGLCanvas({ onFrame: fn }).getOnFrame() === fn`; `setOnFrame(fn2)` updates it, `setOnFrame(null)` clears it; same for `onContextInit`. (The *effect* — GL drawing — is not observable offline; see M-series.)
- **U5 — animation flag.** `startAnimation()` sets `isAnimating()` true and records a `requestAnimationFrame`; a second `startAnimation()` does not stack a second frame; `stopAnimation()` records a `cancelAnimationFrame` and clears the flag.
- **U6 — teardown cancels the loop.** After `startAnimation()`, destroying the component records a `cancelAnimationFrame` (no stray frame survives — the leaked-`this` guard).
- **U7 — context "2d" not used.** If a recording assertion is available: the recorded `getContext` call carries `contextId === "webgl2"` (guards against a copy-paste `"2d"`).

Manual / live-only (offline harness cannot exercise a real GL context, `getContext`, `devicePixelRatio`, rAF paint, or `webglcontextlost`/`restored` — the live-only category):

- **M1 — GL renders.** `onContextInit` builds a program/buffer, `onFrame` clears and draws; the expected output (clear colour or triangle) is visible.
- **M2 — crisp on HiDPI.** On a HiDPI display the backing store is CSS×dpr and `gl.viewport` covers the full device-pixel buffer — output is sharp, not blurred/upscaled.
- **M3 — resize re-viewports.** Resizing the parent resizes the drawing buffer, resets the viewport, and re-emits a frame with correct aspect (no stretched/clipped GL output); GL resources are **not** rebuilt on resize.
- **M4 — DPR change re-syncs.** Dragging to a different-DPI monitor (or changing browser zoom) re-sizes the buffer and re-viewports without a layout resize.
- **M5 — animation loop.** Auto-starts after mount; produces a continuous per-frame redraw; `stopAnimation()` halts it; destroying the component leaves no runaway rAF (verify in DevTools performance).
- **M6 — context loss/restore.** Forcing loss via `WEBGL_lose_context` (`ext.loseContext()`) stops drawing without a thrown error; `ext.restoreContext()` re-runs `onContextInit` (resources rebuilt) and resumes correct rendering.
- **M7 — idle stability.** Layout passes that don't change size/dpr do not resize the buffer or reset the viewport (the `syncBackingStore` guard).

---

## Verification

- **Typecheck / build:** `npm run build:lib` and the test-project `tsc --noEmit` clean; `getContext(...)` narrows to `WebGL2RenderingContext` without a cast error.
- **Lint:** `npm run lint` clean; `WebGLCanvas.ts` adds no `no-raw-dom` findings and no baseline entry.
- **Unit tests:** U1–U7 pass (offline, modelled sink/source), including the recording-sink `getContext("webgl2")` and destructor-cancels-loop assertions.
- **Default-options registry:** `tests/component/default-options-fallback.test.ts` passes.
- **Docs build:** `npm run docs:build` finishes with **zero** warnings.
- **Manual smoke (live-only):** `npm run dev` (app on http://localhost:8015), open the demo panel; verify M1–M7 — GL output, crisp after resize/zoom, animation start/stop, context loss/restore (via `WEBGL_lose_context`), no runaway rAF after teardown. Scope DevTools queries to the panel's `.WebGLCanvas` to avoid measuring another instance.

---

## Documentation Impact

`WebGLCanvas` is exported from the `component/display` barrel, so it surfaces in the display API docs automatically once built. Author, mirroring [docs/components/Image.md](docs/components/Image.md) and the sibling `Canvas` page:

- **New page** `docs/components/WebGLCanvas.md` — usage (`WebGLCanvas({ onContextInit, onFrame })`, `getContext`, `startAnimation`/`stopAnimation`), a "Common methods" table, and a "Notes" section stating: WebGL2 only; build GPU resources in `onContextInit` (it reruns after context loss); draw in `onFrame` (viewport already set); the component is **live-only** (no offline/SSR rendering); it reports no intrinsic size — give it a `preferredSize` or a stretching parent; a continuously-animating canvas on a hidden-but-mounted in-app tab keeps running — call `stopAnimation()` to pause. Cross-reference `[API: WebGLCanvas](/api/component/display/classes/WebGLCanvas)`.
- **Catalog** [docs/components/index.md](docs/components/index.md) — add a `WebGLCanvas` row near the `Canvas`/`Image` rows (`| \`<canvas>\` WebGL2 surface |`).
- **Sidebar** [docs/.vitepress/config.mts](docs/.vitepress/config.mts) — add `{ text: 'WebGLCanvas', link: '/components/WebGLCanvas' }` to the Display group.

---

## Potential Challenges

- **`webglcontextlost` must `preventDefault()`.** Without it the browser never fires `restored` and the canvas stays dead — the handler calls it first thing; the capture-phase, non-passive `Event.addListener` registration makes it effective.
- **No clean in-app hidden-tab pause.** `isDisplayed()` is self-only and Tab keeps panels mounted, so a hidden-tab canvas keeps animating; browser-tab-hidden self-throttles via native rAF, but in-app hidden tabs need an explicit `stopAnimation()`. Documented; not worked around in code.
- **`doLayout` runs against buffered (unflushed) inline size.** `syncBackingStore` reads cached `getWidth()`/`getHeight()`, never DOM geometry — same discipline as `canvas-component`.
- **Buffer resize resets the viewport, not the resources.** Reassigning `width`/`height` on a WebGL canvas keeps programs/buffers but zeroes the viewport transform — hence the mandatory `gl.viewport` after every resize; forgetting it renders to a stale-sized viewport.
- **`getContext` breaks the sink's one-way contract.** A live GL context can't forward across a worker — inherited from `canvas-component`'s live-only boundary; no worker-safe alternative for GL.
- **Zero CSS size collapses the buffer.** With no `preferredSize` and a non-stretching parent, the canvas sizes to 0×0 and `gl.viewport(0,0,0,0)` draws nothing — the flex-spacer footgun. Documented, not coded around.
- **`matchMedia` has no seam-level unsubscribe.** Inherited from `canvas-component`'s DPR watcher; the generation token + element-existence guard bound the accumulation. See that plan.

---

## Critical Files

- **`plans/canvas-component.md`** — the sibling plan this one depends on; authors the `getContext` / `getDevicePixelRatio` seams and the `syncBackingStore` / DPR-watch / rAF-loop idioms reused here. Read it first.
- [src/typescript/lib/component/display/Image.ts](src/typescript/lib/component/display/Image.ts) — the leaf shape (defaults bag, `clearInsets`, `render` override, `callable` export idiom).
- [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts) — `render` (L4903), `doLayout` (L4614), `onFirstLayout` (L4653), `getWidth`/`getHeight`, `destructor` (L604), `clearInsets` (L1541), `getBaseline` (L2634), `isDisplayed` (L1505), `getLaidOutComponents` (L4457).
- [src/typescript/lib/core/DOM.ts](src/typescript/lib/core/DOM.ts) — `DOMSink`/`DOMSource` seams, `requestAnimationFrame`/`cancelAnimationFrame` (L626/L633), `matchMedia`; the `getContext`/`getDevicePixelRatio` additions come from `canvas-component`.
- [src/typescript/lib/core/Event.ts](src/typescript/lib/core/Event.ts) — `addListener` (L226, capture-phase window listener), `PASSIVE_TYPES` (L42, confirms `webglcontext*` is non-passive so `preventDefault` works).
- [src/typescript/lib/component/container/StatusBar.ts](src/typescript/lib/component/container/StatusBar.ts#L310) — `destructor` override + `super.destructor()` cleanup discipline.
- [scripts/eslint/no-raw-dom.js](scripts/eslint/no-raw-dom.js#L32) — confirms `WebGL2RenderingContext` is unflagged; the seam boundary sits at `getContext`.

---

## Non-Goals

- **No WebGL1 fallback.** WebGL2 only; a `getContext("webgl")` fallback path is out of scope (shrinking target set, doubles the consumer contract). The generic seam leaves the door open for a future option.
- **No shared `AbstractCanvasSurface` base.** `WebGLCanvas` reimplements the small backing-store / DPR-watch / rAF machinery rather than sharing a base with `Canvas`, to avoid retro-editing the already-planned sibling. A base is a possible future refactor if a third canvas-family component appears (rule of three) — not this plan's work.
- **No GL helper API.** No shader-compile / program-link wrappers, no uniform/attribute/VAO helpers, no scene graph, no `readPixels`/`toDataURL` export. Consumers reach the raw `getContext()` for anything beyond `onContextInit` / `onFrame`.
- **No offline GL.** The modelled sink returns `null`; the component no-ops offline. A headless GL model is out of scope.
- **No automatic in-app hidden-tab pause.** No IntersectionObserver/geometry seam to detect ancestor `display:none`; the consumer calls `stopAnimation()`. Browser-tab-hidden self-throttles for free.
- **No intrinsic-size reporting.** Like `Canvas`, no `getPreferredSize` override; the consumer supplies `preferredSize` or a stretching parent.
