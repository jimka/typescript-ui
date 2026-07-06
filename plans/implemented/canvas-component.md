# Canvas Component — Implementation Plan

## Overview

Add a `Canvas` leaf component — a raster drawing surface backed by a live `CanvasRenderingContext2D` — to the display family, alongside [`Image`](src/typescript/lib/component/display/Image.ts#L40). It mirrors `Image`'s exact shape: a `Component` subclass with `tag: "canvas"` in its class defaults, `clearInsets()` in the constructor, options-bag construction, and a `callable()` export.

The component owns two sizes that must stay in sync: the *CSS size* (inline `width`/`height` px the framework already commits through [`setWidth`](src/typescript/lib/core/Component.ts#L2776) / [`setHeight`](src/typescript/lib/core/Component.ts#L2864)) and the *backing store* (the `<canvas>` element's `width`/`height` **attributes**, which must equal CSS size × `devicePixelRatio`). Keeping them in lockstep — and re-emitting content after each backing-store wipe — is the whole substance of the component.

Because a `CanvasRenderingContext2D` has no offline model and cannot cross a worker boundary, `Canvas` is a **live-only component** (offline-untestable, the same category as focus/blur): its one seam addition returns `null` under the modelled sink, and the component then no-ops. This plan is the foundation for a sibling WebGL plan; the reusable seams (`DOM.sink.getContext`, `DOM.source.getDevicePixelRatio`, `syncBackingStore()`, the render-loop lifecycle) are called out explicitly so that plan can share them.

---

## Architecture Decisions

### Leaf `Component` with `tag: "canvas"`, mirroring `Image`

`Canvas extends Component<CanvasOptions>`, with `_defaultCanvasOptions = { tag: "canvas" }` forwarded to `super(options, _defaultCanvasOptions)` so the [`ComponentOptions.tag`](src/typescript/lib/core/Component.ts#L108) cascade creates the element via [`createRootElement`](src/typescript/lib/core/Component.ts#L4894) with no override needed. The constructor calls [`clearInsets()`](src/typescript/lib/core/Component.ts#L1541) exactly as `Image` does — a drawing surface has no chrome breathing room. Baseline stays inherited: a leaf's [`getBaseline()`](src/typescript/lib/core/Component.ts#L2634) returns `null` (no content baseline), which is correct for a graphical element, so no override. No `getPreferredSize` override either — unlike `Image`, a canvas has no intrinsic content size (see Non-Goals).

### One narrow sink method for the context — the honest seam escape

`getContext("2d")` is not in the `DOM.sink` / `DOM.source` vocabulary, and reaching around the seam to the raw element handle is disallowed by the `local/no-raw-dom` rule (any `HTMLElement`-typed receiver is a build error). Add **one** generic method to [`DOMSink`](src/typescript/lib/core/DOM.ts#L440):

```typescript
getContext(handle: Handle, contextId: string, options?: unknown): RenderingContext | null;
```

`contextId` is a plain string (`"2d"` here, `"webgl"` / `"webgl2"` for the sibling plan) and the return is the `lib.dom` `RenderingContext` union, so the WebGL component reuses the identical method and narrows the result itself. `ProductionDOMSink` resolves the handle and returns `(el as HTMLCanvasElement).getContext(contextId, options)`; `RecordingDOMSink` records the call and returns `null`.

This deliberately breaks the sink's "no return value drives control flow / forwardable as one `postMessage`" contract (documented on the interface) — a live context object cannot cross a worker boundary. That break **is** the design: it is the single, named place where `Canvas` leaves the seam, and it is why `Canvas` is live-only. Crucially, `CanvasRenderingContext2D` is **not** one of the DOM-lib types the `no-raw-dom` rule flags (it flags `Element` / `Node` / `HTMLElement` / `Window` / `MediaQueryList` / CSS-rule types only — see [scripts/eslint/no-raw-dom.js:32](scripts/eslint/no-raw-dom.js#L32)), so once the seam mints the context, holding it in a field and calling `ctx.setTransform` / `ctx.clearRect` / etc. is ordinary graphics code, not raw-DOM access. The seam boundary sits precisely at "obtain the context"; everything past it is application drawing.

### `devicePixelRatio` is a read — add it to `DOMSource`

`window.devicePixelRatio` is a flagged DOM global (`window` receiver), so it must funnel through the read seam. Add to [`DOMSource`](src/typescript/lib/core/DOM.ts#L701):

```typescript
getDevicePixelRatio(): number;
```

`ProductionDOMSource` returns `window.devicePixelRatio || 1`; `ModelledDOMSource` returns `1`. This keeps offline backing-store math deterministic (dpr 1) and is reused unchanged by the WebGL plan.

### Backing-store sync happens in `doLayout()`, not `setSize`

The crux hook. The framework never routes layout through `setSize`: a parent's layout manager commits child bounds via [`LayoutManager.commitBounds`](src/typescript/lib/layout/LayoutManager.ts#L453), which calls `setWidth(...)` **then** `setHeight(...)` (each early-returns when unchanged) and then `component.doLayout()`. So overriding `setSize` would miss every real resize. The correct single settled hook is **`doLayout()`** — it runs once after both axes are committed, on initial mount and every subsequent resize.

`Canvas` overrides [`doLayout()`](src/typescript/lib/core/Component.ts#L4614) to call `super.doLayout()` then `syncBackingStore()`. The sync reads the **cached** `getWidth()` / `getHeight()` (never DOM geometry — inside `doLayout` the new inline size is still buffered by `commitBounds`'s `setAutoCommitStyle(false)` and has not flushed; see the framework's "commitBounds runs doLayout with stale DOM" discipline) plus `DOM.source.getDevicePixelRatio()`, and short-circuits when width/height/dpr are unchanged since the last sync so idle layout passes never wipe the buffer.

`syncBackingStore()` is `protected` and self-contained precisely so the WebGL component can call it verbatim — the backing-store attribute math is identical for both context kinds.

### DPR-scale transform policy: callers draw in CSS px

After `syncBackingStore()` reassigns the backing-store attributes, it re-applies `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`. Reassigning `canvas.width`/`.height` resets all context state (transform included), so the transform must be re-set on every sync. With it in place, one context unit equals one CSS pixel: callers draw in logical coordinates and get a crisp result on HiDPI displays without any manual scaling. This policy is 2D-specific (WebGL sets its own `gl.viewport(0, 0, backingW, backingH)` instead) — it is the one seam that the WebGL plan overrides rather than shares.

### Draw API: an `onDraw` hook, a `redraw()` trigger, an optional animation loop, and `getContext()`

Consumers get a hook, not the raw canvas as their primary surface:

- **`onDraw` option / `setOnDraw` setter** — `(ctx, width, height) => void`, invoked on demand and after every resize. This is the *survive-resize* path: because the backing store is wiped whenever `width`/`height` is reassigned, content must be re-emitted, and `onDraw` is where the framework re-invokes it.
- **`redraw()`** — clears (in CSS px) and re-invokes `onDraw`. Public so a consumer can force a repaint after mutating its own model without a resize.
- **`startAnimation()` / `stopAnimation()` / `isAnimating()`** — an optional loop driven by [`DOM.sink.requestAnimationFrame`](src/typescript/lib/core/DOM.ts#L626), each frame calling `redraw()`, cancelled with [`cancelAnimationFrame`](src/typescript/lib/core/DOM.ts#L633). The loop is torn down in `destructor()`, mirroring [`StatusBar`](src/typescript/lib/component/container/StatusBar.ts#L310)'s timer-cleanup discipline (override `destructor`, clean up, call `super.destructor()`).
- **`getContext()`** — returns the `CanvasRenderingContext2D` (or `null` offline / pre-render) for imperative one-off drawing. Content drawn this way is the consumer's responsibility to re-emit on resize; anything that must survive a resize belongs in `onDraw`.

No speculative surface beyond this — no `toDataURL`, no per-frame delta, no layer stack (see Non-Goals).

### Redraw on resize

Reassigning the backing-store attributes clears it, so `syncBackingStore()` finishes by re-applying the transform and calling `redraw()`. A resize therefore always re-emits `onDraw` content on the freshly-sized surface.

### DPR-change re-sync without a resize

A window dragged to a different-DPI monitor can change `devicePixelRatio` with no resize/relayout, which `doLayout` would miss. `Canvas` arms a `DOM.source.matchMedia("(resolution: <dpr>dppx)")` watcher at render time (`matchMedia` is a flagged global, so it must go through the existing read seam). On change it re-syncs (reading the fresh dpr) and re-arms for the new ratio. A monotonic generation token makes only the newest arm act, so re-arming cannot fan out — see Potential Challenges for the seam-lacks-unsubscribe caveat.

---

## Public API

### New component: `src/typescript/lib/component/display/Canvas.ts`

```typescript
/** Draw callback: receives the 2D context and the logical (CSS-px) size. */
export type CanvasDrawCallback = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
) => void;

export interface CanvasOptions extends ComponentOptions {
    /** Draw hook, re-invoked on demand and after every resize / DPR change. */
    onDraw?: CanvasDrawCallback;
}

class Canvas extends Component<CanvasOptions> {
    constructor(options?: CanvasOptions);

    /** Returns the 2D context, or null offline / before first render. */
    getContext(): CanvasRenderingContext2D | null;

    /** Sets (or clears) the draw hook and triggers an immediate redraw. */
    setOnDraw(handler: CanvasDrawCallback | null): this;
    getOnDraw(): CanvasDrawCallback | null;

    /** Clears and re-invokes onDraw against the current context. */
    redraw(): this;

    /** Starts / stops a per-frame redraw loop. */
    startAnimation(): this;
    stopAnimation(): this;
    isAnimating(): boolean;

    /** Reusable seam: resizes the backing store to CSS×dpr, re-applies the
     *  dpr transform, and redraws. Called from doLayout on every size change. */
    protected syncBackingStore(): void;

    protected doLayout(): this;          // super.doLayout() + syncBackingStore()
    protected render(): Handle;          // super.render() + arm DPR watcher
    protected destructor(): void;        // stopAnimation() + super.destructor()
}
```

State (all runtime-only — none written during the `super()` cascade, so plain fields, not `declare`):

| Field | Type | Purpose |
|---|---|---|
| `_ctx` | `CanvasRenderingContext2D \| null` | Cached context; `null` offline / pre-render. |
| `_rafId` | `number \| null` | Active animation-frame handle; `null` when idle. |
| `_syncedWidth` / `_syncedHeight` / `_syncedDpr` | `number` | Last-synced values; guard against redundant backing-store wipes. |
| `_dprToken` | `number` | Generation counter guarding DPR-watch re-arms. |

`onDraw` is consumer-configurable, so it lives on the `_options` bag (cache = options bag per the typed-setter rule); `setOnDraw` writes `this._options.onDraw` and calls `redraw()`, `getOnDraw` reads `this._options.onDraw ?? null`, and `applyOptions` forwards `options.onDraw` when present.

### Seam additions: `src/typescript/lib/core/DOM.ts`

```typescript
interface DOMSink {
    // …existing…
    getContext(handle: Handle, contextId: string, options?: unknown): RenderingContext | null;
}

interface DOMSource {
    // …existing…
    getDevicePixelRatio(): number;
}
```

Implemented on `ProductionDOMSink` / `ProductionDOMSource` (live) and on `RecordingDOMSink` / `ModelledDOMSource` in [tests/dom/TestDOM.ts](tests/dom/TestDOM.ts) (`getContext` → record + `null`; `getDevicePixelRatio` → `1`).

---

## Internal Structure

`syncBackingStore()` — the shared seam (guarded, no DOM reads):

```typescript
protected syncBackingStore(): void {
    const ctx = this.getContext();          // null offline → whole sync no-ops
    if (!ctx) return;

    const width  = this.getWidth();          // cached CSS px
    const height = this.getHeight();
    const dpr    = DOM.source.getDevicePixelRatio();

    if (width === this._syncedWidth && height === this._syncedHeight && dpr === this._syncedDpr) {
        return;                              // nothing changed — don't wipe the buffer
    }

    const element = this.getElement()!;
    DOM.sink.apply(element, { setAttr: {
        width:  String(Math.round(width  * dpr)),
        height: String(Math.round(height * dpr)),
    }});                                     // reassigning attributes clears + resets the context

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);  // draw in CSS px

    this._syncedWidth  = width;
    this._syncedHeight = height;
    this._syncedDpr    = dpr;

    this.redraw();
}
```

`redraw()`:

```typescript
redraw(): this {
    const ctx = this.getContext();
    if (!ctx) return this;

    const width  = this.getWidth();
    const height = this.getHeight();

    ctx.clearRect(0, 0, width, height);      // CSS px; transform applies dpr
    this._options.onDraw?.(ctx, width, height);
    return this;
}
```

DPR watcher (armed from `render()`; generation-guarded re-arm):

```typescript
private watchDevicePixelRatio(): void {
    const dpr   = DOM.source.getDevicePixelRatio();
    const token = ++this._dprToken;

    DOM.source.matchMedia(`(resolution: ${dpr}dppx)`).addChangeListener(() => {
        if (token !== this._dprToken) return;   // superseded arm — inert
        if (!this.getElement())      return;     // torn down after destructor
        this.syncBackingStore();                 // reads fresh dpr, re-syncs + redraws
        this.watchDevicePixelRatio();            // re-arm for the new ratio
    });
}
```

---

## Ordered Implementation Steps

1. **Seam interface + production impls** — [core/DOM.ts](src/typescript/lib/core/DOM.ts): add `getContext` to `DOMSink` and `getDevicePixelRatio` to `DOMSource` (with JSDoc), then implement both on `ProductionDOMSink` / `ProductionDOMSource`. → verify: `npm run build:lib` typechecks; `grep -n "getContext\|getDevicePixelRatio" src/typescript/lib/core/DOM.ts` shows interface + production entries.
2. **Modelled/recording impls** — [tests/dom/TestDOM.ts](tests/dom/TestDOM.ts): implement `getContext` (record, return `null`) on `RecordingDOMSink` and `getDevicePixelRatio` (return `1`) on `ModelledDOMSource`, so the interfaces stay fully implemented. → verify: `npx tsc --noEmit` (test project) is clean.
3. **Component** — create [component/display/Canvas.ts](src/typescript/lib/component/display/Canvas.ts): `CanvasOptions` / `CanvasDrawCallback`, the class per Public API, `callable()` export (`_Canvas` / `Canvas`), matching `Image`'s export idiom. → verify: file compiles; `grep -n "callable(Canvas)" src/typescript/lib/component/display/Canvas.ts`.
4. **Barrel export** — [component/display/index.ts](src/typescript/lib/component/display/index.ts): add `export { Canvas }` and `export type { CanvasOptions, CanvasDrawCallback }`, alphabetically near `Header`. → verify: `grep -n "Canvas" src/typescript/lib/component/display/index.ts`.
5. **Lint baseline** — run the `no-raw-dom` rule; confirm `Canvas.ts` introduces **zero** new raw-DOM findings (it names only `CanvasRenderingContext2D`, which is unflagged) and DOM.ts additions are seam-exempt. → verify: `npm run lint` clean, no baseline edit needed.
6. **Default-options registry** — add a `Canvas` row to [tests/component/default-options-fallback.test.ts](tests/component/default-options-fallback.test.ts) if it defaults any folding-getter field. `onDraw` has no class default, so likely a no-op row-check; confirm and skip if not applicable. → verify: that test passes.
7. **Docs** — see Documentation Impact.
8. **Demo** — add a small `Canvas` example to an existing display demo (e.g. append to [src/typescript/MiscPanel.ts](src/typescript/MiscPanel.ts)) drawing a shape via `onDraw`, for the manual live smoke test. → verify: `npm run dev`, open the panel, see a crisp shape that stays crisp on window resize / zoom.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/display/Canvas.ts` |
| Modify | `src/typescript/lib/core/DOM.ts` (add 2 seam methods + 2 production impls) |
| Modify | `tests/dom/TestDOM.ts` (add 2 modelled/recording impls) |
| Modify | `src/typescript/lib/component/display/index.ts` (barrel export) |
| Modify | `tests/component/default-options-fallback.test.ts` (registry row, if applicable) |
| Modify | `src/typescript/MiscPanel.ts` (demo for live smoke test) |
| Create | `docs/components/Canvas.md` |
| Modify | `docs/components/index.md` (catalog row) |
| Modify | `docs/.vitepress/config.mts` (Display sidebar entry) |

---

## Expected Behaviour

Unit-testable against the modelled sink/source (offline):

- **U1 — construction & tag.** `new Canvas()` (and `Canvas({...})`) builds a component whose element tag is `canvas`; `getElement(true)` records a `createElement("canvas")` on the recording sink.
- **U2 — insets cleared.** Constructed insets are zero (mirrors `Image`).
- **U3 — offline no-op.** Under the modelled source, `getContext()` returns `null`, and `redraw()` / `syncBackingStore()` / `startAnimation()` run without throwing (all guard on the null context).
- **U4 — options plumbing.** `Canvas({ onDraw: fn }).getOnDraw() === fn`; `setOnDraw(fn2)` updates it; `setOnDraw(null)` clears it. (The *effect* of `onDraw` — actual drawing — is not observable offline; see M-series.)
- **U5 — animation flag.** `startAnimation()` sets `isAnimating()` true and records a `requestAnimationFrame`; a second `startAnimation()` does not stack a second frame; `stopAnimation()` records a `cancelAnimationFrame` and clears the flag.
- **U6 — teardown cancels the loop.** After `startAnimation()`, destroying the component records a `cancelAnimationFrame` (no stray frame survives).
- **U7 — seam signatures.** `RecordingDOMSink.getContext` returns `null` and records; `ModelledDOMSource.getDevicePixelRatio()` returns `1`.

Manual / live-only (offline harness cannot exercise a real context, `getContext`, `devicePixelRatio`, or rAF paint — the live-only category):

- **M1 — crisp render.** On a HiDPI display, `onDraw` output is sharp: the backing store is CSS×dpr and the context transform is `dpr`.
- **M2 — draw in CSS px.** `onDraw` drawing at logical coordinates fills the expected CSS region (no manual scaling needed).
- **M3 — resize re-emits.** Resizing the parent re-runs `onDraw` on the resized, re-cleared surface with no stale/clipped content.
- **M4 — DPR change re-syncs.** Dragging the window to a different-DPI monitor (or changing browser zoom) re-syncs the backing store and re-renders crisply, without a resize.
- **M5 — animation loop.** `startAnimation()` produces a continuous per-frame redraw; `stopAnimation()` halts it; navigating away / destroying the component leaves no runaway loop (verify in DevTools performance).
- **M6 — idle stability.** Layout passes that don't change size/dpr do not wipe or re-emit (the `syncBackingStore` guard) — a static drawing does not flicker under unrelated relayouts.

---

## Verification

- **Typecheck / build:** `npm run build:lib` and the test-project `tsc --noEmit` are clean with the two new seam methods implemented on all four sink/source classes.
- **Lint:** `npm run lint` clean; `Canvas.ts` adds no `no-raw-dom` findings and no baseline entry.
- **Unit tests:** cover U1–U7 above (offline, modelled sink/source), including the recording-sink `getContext`/rAF assertions and the destructor-cancels-loop path.
- **Default-options registry:** `tests/component/default-options-fallback.test.ts` passes.
- **Docs build:** `npm run docs:build` finishes with **zero** warnings (no `{@link}` to internal symbols).
- **Manual smoke (live-only):** `npm run dev` (app on http://localhost:8015), open the demo panel; verify M1–M6 — crisp shape, crisp after resize and after a zoom/DPI change, animation start/stop, no runaway rAF after teardown (DevTools). Scope DevTools queries to the panel's `.Canvas` to avoid measuring another instance.

---

## Documentation Impact

`Canvas` is exported from the `component/display` barrel, so it surfaces in the display API docs automatically once built. Author, mirroring [docs/components/Image.md](docs/components/Image.md):

- **New page** `docs/components/Canvas.md` — usage (`Canvas({ onDraw })`, `getContext`, `redraw`, `startAnimation`/`stopAnimation`), a "Common methods" table, and a "Notes" section stating: draw in CSS px (dpr transform is applied); anything that must survive a resize belongs in `onDraw`; the component is **live-only** (no offline/SSR drawing); it reports no intrinsic size — give it a `preferredSize` or a stretching parent. Cross-reference the API page as `[API: Canvas](/api/component/display/classes/Canvas)`.
- **Catalog** [docs/components/index.md](docs/components/index.md#L72) — add a `Canvas` row near the `Image` row (`| \`<canvas>\` raster surface |`).
- **Sidebar** [docs/.vitepress/config.mts](docs/.vitepress/config.mts#L108) — add `{ text: 'Canvas', link: '/components/Canvas' }` to the Display group.

---

## Potential Challenges

- **`getContext` breaks the sink's one-way contract.** A live context cannot forward across a worker — document it on the method and accept it as the live-only boundary; there is no worker-safe alternative for raster drawing.
- **`doLayout` runs against buffered (unflushed) inline size.** `syncBackingStore` must read cached `getWidth()`/`getHeight()`, never DOM geometry, or it will size the backing store from a stale rect. The plan reads only cached values.
- **Backing-store wipe on every attribute write.** Guard `syncBackingStore` on unchanged width/height/dpr so idle relayouts don't wipe/flicker; only real changes re-emit.
- **`matchMedia` has no seam-level unsubscribe.** Each DPR-change re-arm adds one native listener the seam can't remove; the generation token keeps only the newest arm active (older ones no-op) and the element-existence guard makes all arms inert after `destructor`. Accumulation is bounded by the number of DPR changes in a session (negligible). A future `matchMedia` unsubscribe in the seam would remove even that; note it but don't block on it.
- **Zero CSS size collapses the backing store.** With no `preferredSize` and a non-stretching parent, the canvas can size to 0×0 and draw nothing — the same footgun as a flex spacer. Documented; not worked around in code.
- **rAF callback style.** Follow the codebase precedent (e.g. `AbstractWindow`) of a small arrow scheduling a named redraw step; keep the loop cancellable purely by the stored `_rafId`.

---

## Critical Files

- [src/typescript/lib/component/display/Image.ts](src/typescript/lib/component/display/Image.ts) — the leaf shape to mirror exactly (defaults bag, `clearInsets`, `render` override, `callable` export idiom).
- [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts) — `createRootElement` (L4894), `render` (L4903), `doLayout` (L4614), `setWidth`/`setHeight` (L2776/L2864), `getWidth`/`getHeight`, `destructor` (L604), `clearInsets` (L1541), `getBaseline` (L2634), `ComponentOptions.tag` (L108).
- [src/typescript/lib/layout/LayoutManager.ts](src/typescript/lib/layout/LayoutManager.ts#L453) — `commitBounds`: proves layout drives `setWidth`+`setHeight`+`doLayout`, not `setSize`.
- [src/typescript/lib/core/DOM.ts](src/typescript/lib/core/DOM.ts) — `DOMSink` (L440) / `DOMSource` (L701) interfaces, `requestAnimationFrame`/`cancelAnimationFrame` (L626/L633), `matchMedia` (L878), `isModelled` (L813), production impls (L1151/L1374).
- [src/typescript/lib/component/container/StatusBar.ts](src/typescript/lib/component/container/StatusBar.ts#L310) — `destructor` override + `super.destructor()` cleanup discipline.
- [tests/dom/TestDOM.ts](tests/dom/TestDOM.ts) — `RecordingDOMSink` (L244) / `ModelledDOMSource` (L521): where the two new seam methods get modelled impls.
- [scripts/eslint/no-raw-dom.js](scripts/eslint/no-raw-dom.js#L32) — confirms `CanvasRenderingContext2D` is unflagged; the seam boundary sits at `getContext`.

---

## Non-Goals

- **WebGL is a separate plan.** This component is 2D only. The reusable seams (`DOM.sink.getContext` generic over `contextId`, `DOM.source.getDevicePixelRatio`, `syncBackingStore()`, the render-loop lifecycle) are shaped so the WebGL plan builds on them; the WebGL plan overrides only the DPR-transform policy (it sets `gl.viewport` instead) and the context narrowing.
- **No intrinsic-size reporting.** Unlike `Image`, a canvas has no natural size; `getPreferredSize` stays inherited and the consumer supplies `preferredSize` or a stretching parent. Inventing a default size is out of scope.
- **No offline drawing.** The modelled sink returns `null` from `getContext`; `Canvas` deliberately no-ops offline. Making raster output testable offline (a headless canvas model) is out of scope.
- **No extended raster API.** No `toDataURL` / image export, no layer/scene graph, no dirty-rect batching, no pointer-hit-testing helpers. Consumers reach the raw `getContext()` for anything beyond the `onDraw` hook.
