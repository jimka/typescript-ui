# DOMSink / DOMSource — Implementation Plan

## Overview

Route every DOM **write** through a `DOMSink` seam and every DOM **read** through a `DOMSource` seam, so the whole framework talks to the browser through two swappable interfaces. The production implementations are thin pass-throughs that behave bit-for-bit like today; the test implementations record writes and *model* reads (no browser) so unit tests can assert real pixel positions, baselines, and scroll offsets offline.

The write side is already ~80% centralised: every CSS/attribute write funnels through `Component.setElementStyle(s)` / `setElementCSSRule(s)` / `setElementAttribute` ([Component.ts:906–1048](../src/typescript/lib/core/Component.ts#L906)) into the deferred-write buffers in [StyleTarget.ts](../src/typescript/lib/core/StyleTarget.ts). The read side is already centralised too: all text metrics funnel through ~4 `Util` functions ([Util.ts:66–155](../src/typescript/lib/core/Util.ts#L66)), and component geometry is derivable from committed state via the validated geometry oracle plus one root DOM read.

This plan is **staged**: Stage 1 introduces the two seams with production implementations and migrates every read/structural-write site behind them, with zero behavioural or perf change. Stage 2 adds recording/modelled test implementations and the baked font-metrics table. Stage 3 (a real worker transport) is a **non-goal** — but the seam boundary is shaped to not preclude it.

---

## Architecture Decisions

### The two seams are separate interfaces — `DOMSink` (writes) and `DOMSource` (reads)

Writes and reads have fundamentally different shapes: writes are fire-and-forget and already buffered/batched (`StyleTarget` queues then flushes); reads are synchronous request/response that must return a value *now*. Folding them into one object would force the read methods to fake a return when the sink is a no-op recorder. Keeping them separate lets the test sink be a pure recorder while the test source is an independent geometry model. It also matches the worker future: a worker transport posts writes one-way (sink) but must round-trip reads (source) — different mechanisms.

### `DOMSink` is an extension of the existing `StyleTarget` flush path, not a replacement

The sink does **not** re-implement buffering. `StyleTarget` keeps its `_dirty` bag, `queue`/`flush`, and `autoCommitStyle` gating exactly as-is. The sink is the **terminal write primitive** that `StyleTarget.write()` and the structural-mutation helpers call instead of touching `element.style` / `element.classList` / `appendChild` directly. So `setElementStyle` → `StyleTarget.set` → (eventually) `sink.setStyle(target, key, value)`. Production `sink.setStyle` does exactly what `StyleTarget.write` does today. This keeps the existing batching semantics untouched and makes the migration a redirection of the leaf writes, not a rewrite of the buffer.

The currently-scattered structural writes — `classList` (9 files), `createElement` (11 files), `appendChild`/`removeChild` (39 files) — get corralled into named sink methods (`createElement`, `appendChild`, `removeChild`, `addClass`/`removeClass`/`toggleClass`, `setAttribute`/`removeAttribute`, `setTextContent`). These are the methods ARCHITECTURE.md's "Minimize direct DOM access" rule ([ARCHITECTURE.md:93](../ARCHITECTURE.md)) already wants behind an API; the sink is that API.

### `DOMSource` exposes *intent-level* reads, not `getBoundingClientRect`

Today call sites read `element.getBoundingClientRect()` and then do arithmetic (anchor positioning in [Popover.ts:611](../src/typescript/lib/core/Popover.ts#L611), [Menu.ts:255](../src/typescript/lib/core/Menu.ts#L255), rotated-box handling in [Tab.ts:106](../src/typescript/lib/layout/Tab.ts#L106)). If `DOMSource` just exposed `getBoundingClientRect(element)` the modelled source would have to reverse-engineer which `Component` an element belongs to. Instead the source is keyed on the **`Component`**: `getViewportRect(component): Rect`. The production implementation calls `component.getElement()!.getBoundingClientRect()`; the modelled implementation runs the geometry oracle. Call sites that today read a child element's rect already have the owning component in scope, so this is a near-1:1 swap. The few raw-element rect reads on non-component nodes (`AbstractCalendarDropdown`, `TimePickerDropdown`, `AutoCompleteDropdown` anchor elements) keep a lower-level `getElementRect(element)` escape hatch that the modelled source can stub or, where the element *is* a component root, delegate to the oracle.

### The geometry oracle is the modelled `DOMSource.getViewportRect`

Validated (residual exactly 0) recurrence walking `getParentComponent()` upward ([Component.ts:3791](../src/typescript/lib/core/Component.ts#L3791) `getParentComponent`, [Component.ts:2708/2741](../src/typescript/lib/core/Component.ts#L2708) `getX`/`getY`, [Component.ts:2293](../src/typescript/lib/core/Component.ts#L2293) `getBorderSize`, [Component.ts:2778/2787](../src/typescript/lib/core/Component.ts#L2778) `getScrollLeft`/`getScrollTop`, [Component.ts:2886/2895](../src/typescript/lib/core/Component.ts#L2886) `getTranslateX`/`getTranslateY`):

```
let x = 0, y = 0;
for (let node = component; node; node = node.getParentComponent()) {
    const parent = node.getParentComponent();
    if (!parent) {
        const root = rootMountOffset; // injected config — the ONE sanctioned DOM read
        x += root.x; y += root.y;
        break;
    }
    x += parent.getBorderSize().left + node.getX() + node.getTranslateX() - parent.getScrollLeft();
    y += parent.getBorderSize().top  + node.getY() + node.getTranslateY() - parent.getScrollTop();
}
const { width, height } = transposeIfRotated(component); // pre-rotation getWidth/getHeight
return { x, y, width, height };
```

The single root DOM read (the Body mount offset) is injected as config into the modelled source's constructor — in tests it is `{x:0,y:0}` or a fixture value; in a worker it ships once as config. `getViewportRect` is the **only** geometry method the modelled source needs because the production side returns the real rect and the oracle reproduces it.

### Transform Bucket B (raw transform-as-scroll) must move onto the cached `setTranslate` channel

The oracle absorbs the cached `setTranslate` channel via the `+getTranslateX/Y()` term (Bucket A — table h-scroll, row placement, window drag — already validated). Two sites bypass the cache and are invisible to the generic walk:

- **`VirtualScroller`** writes `_rowsContainer.style.transform = translate3d(-scrollX,-scrollY)` directly on a **raw element** ([VirtualScroller.ts:328](../src/typescript/lib/component/container/VirtualScroller.ts#L328)); `_rowsContainer` is not a `Component`. The offset is cached as `getScrollX`/`getScrollY` ([VirtualScroller.ts:134/143](../src/typescript/lib/component/container/VirtualScroller.ts#L134)).
- **`TabBar`** slides its own element with `setElementStyles({transform: translateY(_mainPos)})` ([TabBar.ts:300–318](../src/typescript/lib/component/container/TabBar.ts#L300)); `_mainPos` is cached ([TabBar.ts:226](../src/typescript/lib/component/container/TabBar.ts#L226)) but **not** via `setTranslate`, so `getTranslateY()` stays a stale 0.

**Decision: migrate TabBar onto `setTranslate`** so the generic oracle term picks it up — it *is* a `Component`, so `this.setTranslate(0, _mainPos)` is a drop-in for the inline-style write and removes a Bucket-B special case at zero cost. **VirtualScroller stays raw but exposes its offset to the modelled source**: its `_rowsContainer` is a deliberate non-component (the comment at [VirtualScroller.ts:71](../src/typescript/lib/component/container/VirtualScroller.ts#L71) explains why the transform can't sit on a `Component`), so the modelled source treats the scroller's content offset as an extra scroll term, read from `getScrollX`/`getScrollY`. Because virtual rows are pooled/recycled (not laid out at absolute committed positions), offline geometry assertions on individual virtual rows are out of scope; the source models the *container* offset, which is what callers measure. Rationale for not forcing VirtualScroller onto `setTranslate`: it would put a layout-driving transform on a `Component`'s own box, which the existing two-element split deliberately avoids.

### Injection: global singleton with a swap function, not per-component injection

ARCHITECTURE.md's construction discipline (typed setters, cache-in-memory, construction stays JS-only) is about *DOM access timing*, not about *dependency wiring*. The framework already uses module-level singletons for exactly this kind of cross-cutting infrastructure: `ThemeManager` ([Theme.ts:992](../src/typescript/lib/core/Theme.ts#L992)) holds the active theme as a `static current`, and `StyleTarget` keeps a module-level `_ruleCache` ([StyleTarget.ts:159](../src/typescript/lib/core/StyleTarget.ts#L159)). Per-component injection would mean threading a sink/source through every `Component` constructor and every `Util` free function — a massive, invasive change that fights the existing construction-options-bag idiom and gains nothing, since tests run one harness at a time. **A `DOM` module holds `DOM.sink` and `DOM.source`, defaulting to the production implementations, with `DOM.install({sink, source})` to swap them in test setup and `DOM.reset()` to restore.** This mirrors `ThemeManager.setTheme`. Production code never calls `install`; it just reads `DOM.sink` / `DOM.source`.

This is the one place the plan touches global state. It is justified: the alternative (constructor injection) is a far larger violation of "Surgical Changes" and the construction-options discipline, and the singleton is swap-scoped and reset-able, so tests stay isolated.

### Production stays a thin pass-through (and provably so)

`ProductionDOMSink` methods are one-liners: `setStyle(t,k,v)` is the current body of `StyleTarget.write`; `appendChild(p,c)` is `p.appendChild(c)`; `addClass(e,c)` is `e.classList.add(c)`. `ProductionDOMSource.getViewportRect(c)` is `c.getElement()!.getBoundingClientRect()` (returned as a plain `Rect`); `measureText` calls the existing `Util` canvas/DOM-probe code. No batching, no caching, no branching beyond what exists today. The perf checkpoint (MiscPanel slow table benchmark unmoved) guards against accidental indirection cost; because the methods are monomorphic singletons the JIT inlines them.

### Bucket 3 (theme vars / native constants) reads from the model, not the DOM

- `--ts-ui-*` reads currently go through `getComputedStyle(:root)` inside `Util` ([Util.ts:169/193/345](../src/typescript/lib/core/Util.ts#L169)). The modelled source resolves these from `ThemeManager.getTheme()` ([Theme.ts:1048](../src/typescript/lib/core/Theme.ts#L1048)) instead — the values are already in the `Theme` model (`theme.font.size`, `theme.font.family`, `theme.font.linePadding`). Production keeps reading computed style. This becomes a `DOMSource.getThemeVar(name)` method.
- `Util.calculateScrollBarWidth` ([Util.ts:445](../src/typescript/lib/core/Util.ts#L445)) writes raw `el.style.*` directly — legacy, predating the all-writes-through-setters rule. It is a **one-shot bootstrap measurement**, cached forever in `scrollBarWidth`. Decision: route it as `DOMSource.getScrollBarWidth(): number` — production runs the existing measurement once; modelled returns a baked constant (typical 15px, configurable). Its raw style writes are excluded from the sink-discipline grep as a sanctioned one-shot bootstrap (documented in the source impl).
- `Util.getViewportSize` ([Util.ts:426](../src/typescript/lib/core/Util.ts#L426)) reads `documentElement.clientWidth`/`window.innerWidth`. Becomes `DOMSource.getViewportSize(): Size`; modelled returns injected config (e.g. `{width:1280,height:800}`).

### Bucket 4 (genuinely browser-only) stays a fallback, not a seam method

`FieldSet.legendClearance` reads a native `<legend>` offsetHeight and already has `LEGEND_CLEARANCE_FALLBACK`. It is the single irreducibly-browser read. It is **not** worth a seam method: the modelled source can't compute it (the native legend box has no model), so it would just return the fallback anyway. Decision: leave it as-is, but have it consult `DOM.source.isModelled()` (a boolean flag) to short-circuit to the fallback offline rather than calling a DOM API that throws in Node. This is the lone documented hold-out.

### Font metrics: baked table, pinned to a test font with a tolerance

The four `Util` text functions ([Util.ts:66/85/154/262](../src/typescript/lib/core/Util.ts#L66)) and their helpers (`measureFontMetrics`, `lineHeightPx`, `opticalCenterOffset`) are the **main fidelity risk** (range-rect ≠ baseline; Chrome ≠ Chromium glyph paint — see prior baseline-measurement-pitfalls notes). They funnel two strategies: canvas `measureText` and a DOM-probe via `getBoundingClientRect`. The seam swaps the leaf measurement: `DOMSource.measureText(text, options): TextMetrics` and `DOMSource.measureFontMetrics(opts): {ascent,descent,capTop}`. Production keeps the canvas/probe code. Modelled returns values from a **baked font-metrics table**: a JSON map keyed by `(family, size, weight, style)` → per-character advance widths + font ascent/descent/cap-top. Tests **pin one font** (a bundled web font, e.g. a fixed-version DejaVu Sans or the test environment's deterministic font) so the table matches what would render. The table is **produced once** by a generation script that runs the *production* source in a real browser (or headless Chromium) over the test font at the theme sizes and serialises the metrics; checked into the repo. Assertions use a **±1px tolerance** to absorb sub-pixel rounding. The existing `Util` cache + `invalidateTextMetricsCache` ([Util.ts:317](../src/typescript/lib/core/Util.ts#L317)) is preserved; the modelled source's results are equally cacheable.

### Worker-compatibility without building the worker

Two constraints make the seam worker-ready: (1) every `DOMSource` method takes **serialisable** inputs (a `Component` is identified by `getId()`; the modelled source already walks committed state that could be mirrored worker-side) and returns **plain data** (`Rect`, `Size`, `TextMetrics` — no live DOM nodes); (2) every `DOMSink` method is **one-way** (no return value used for control flow) so it can become a `postMessage`. The plan does **not** build the transport, but it forbids any seam method from returning a live `Element` or `CSSStyleRule` to a caller (the `getElement`-returning escape hatch stays *inside* the production source). This is the only worker-shaping constraint imposed now.

---

## Public API (TypeScript Signatures)

New file `core/DOM.ts` (exported from the core barrel):

```typescript
/** Plain serialisable rect — never a live DOMRect. */
export interface Rect { x: number; y: number; width: number; height: number; }

/** Terminal DOM-write primitive. Production passes through; tests record. */
export interface DOMSink {
    setStyle(style: CSSStyleDeclaration, key: string, value: string | null): void;
    createElement(tag: string): HTMLElement;
    appendChild(parent: Node, child: Node): void;
    removeChild(parent: Node, child: Node): void;
    removeElement(element: Element): void;
    addClass(element: Element, name: string): void;
    removeClass(element: Element, name: string): void;
    toggleClass(element: Element, name: string, on?: boolean): void;
    setAttribute(element: Element, key: string, value: string): void;
    removeAttribute(element: Element, key: string): void;
    setTextContent(node: Node, text: string): void;
}

/** Read seam. Geometry is keyed on Component; metrics on the four Util funnels. */
export interface DOMSource {
    getViewportRect(component: Component): Rect;
    getElementRect(element: Element): Rect;          // escape hatch for non-component nodes
    measureText(text: string, options?: TextMeasureOptions): TextMetrics;
    measureFontMetrics(): { ascent: number; descent: number; capTop: number };
    getThemeVar(name: string): string;
    getViewportSize(): Size;
    getScrollBarWidth(): number;
    isModelled(): boolean;                           // Bucket-4 short-circuit
}

export class ProductionDOMSink implements DOMSink { /* one-line pass-throughs */ }
export class ProductionDOMSource implements DOMSource { /* real DOM reads + existing Util code */ }

/** Global swap point — mirrors ThemeManager. */
export namespace DOM {
    export let sink: DOMSink;       // defaults to ProductionDOMSink
    export let source: DOMSource;   // defaults to ProductionDOMSource
    export function install(impls: { sink?: DOMSink; source?: DOMSource }): void;
    export function reset(): void;
}
```

Stage-2 test file `test/dom/TestDOM.ts` (not exported from the lib barrel):

```typescript
/** No-op recorder: every write is captured for assertions, nothing touches a DOM. */
export class RecordingDOMSink implements DOMSink {
    readonly writes: Array<{ op: string; args: unknown[] }>;
    /* every method pushes {op, args}; createElement returns a lightweight stub node */
}

/** Geometry from committed layout + baked font table. No browser. */
export class ModelledDOMSource implements DOMSource {
    constructor(config: {
        rootMountOffset: { x: number; y: number };
        viewport: Size;
        scrollBarWidth: number;
        fontMetrics: FontMetricsTable;   // baked, pinned to the test font
        theme?: Theme;                   // defaults to ThemeManager.getTheme()
    });
    getViewportRect(c: Component): Rect; // runs the geometry oracle
    isModelled(): boolean;               // true
}

export interface FontMetricsTable {
    fonts: Record<string /* `${family}|${size}|${weight}|${style}` */, {
        ascent: number; descent: number; capTop: number;
        advance: Record<string /* char */, number>;
    }>;
}
```

---

## Ordered Implementation Steps

### Stage 1 — seams + production impl + migration (no behaviour change)

1. **Create `core/DOM.ts`** with the two interfaces, `Rect`, `ProductionDOMSink`, `ProductionDOMSource`, and the `DOM` namespace (defaulting to production). `ProductionDOMSource.measureText`/`measureFontMetrics` initially **delegate to the existing `Util` functions** (no logic moved yet) to keep the diff small.
2. **Export from the core barrel** ([core/index.ts](../src/typescript/lib/core/index.ts)) — `DOMSink`, `DOMSource`, `Rect`, `ProductionDOMSink`, `ProductionDOMSource`, `DOM`.
3. **Route `StyleTarget.write` through the sink.** Replace the body of the private `write` ([StyleTarget.ts:97](../src/typescript/lib/core/StyleTarget.ts#L97)) with `DOM.sink.setStyle(style, key, value)`. `ProductionDOMSink.setStyle` contains the moved custom-property/camelCase logic verbatim. → verify: app renders identically; eslint `no-element-style` still passes.
4. **Corral structural writes into the sink.** Migrate `createElement` (11 files), `appendChild`/`removeChild` (39 files), `classList` (9 files), and remaining raw `setAttribute`/`removeAttribute`/`textContent` to `DOM.sink.*`. Concentrate the framework-internal ones first (`Component.createFrame` [Component.ts:706](../src/typescript/lib/core/Component.ts#L706), `removeElement` [Component.ts:601](../src/typescript/lib/core/Component.ts#L601), `StyleTarget._getMainSheet` [StyleTarget.ts:165](../src/typescript/lib/core/StyleTarget.ts#L165)). → verify: app renders; `npm run typecheck` clean.
5. **Migrate geometry reads to `DOM.source.getViewportRect`.** Swap the ~15 `getBoundingClientRect` files (`Popover`, `Menu`, `Tab`, `Slider`, `ComboBox`, `Scrollbar`, `TabBar`, `DockRegion`, `AbstractWindow`, the three dropdowns, `AnimatedDropdown`, `Component`) to call `DOM.source.getViewportRect(component)` where a component is in scope, else `getElementRect(element)`. Keep `getBoundingClientRect` calls that live *inside* `ProductionDOMSource`/`Util` measurement. → verify: `grep -rn 'getBoundingClientRect' src/ --include=*.ts | grep -v 'DOM.ts\|Util.ts'` returns zero.
6. **Migrate Bucket-3 reads.** `Util.linePaddingPx`/`rootFontSizePx`/`measureFontMetrics` `getComputedStyle(:root)` → `DOM.source.getThemeVar`; `getViewportSize` → `DOM.source.getViewportSize`; `getScrollBarWidth` → `DOM.source.getScrollBarWidth`; `Component.getBorderSize`'s `getComputedStyle(element)` stays (it reads element-specific border widths, not theme vars — flag it as a known production-only read or add a `getBorderWidths(component)` source method; recommend leaving it and documenting). → verify: `grep -rn 'getComputedStyle' src/ --include=*.ts | grep -v 'DOM.ts'` returns only the documented holdouts (`Component.getBorderSize`, anything inside `ProductionDOMSource`).
7. **Migrate TabBar onto `setTranslate`.** Replace the `transform: translateX/Y(_mainPos)` inline-style writes ([TabBar.ts:307/318](../src/typescript/lib/component/container/TabBar.ts#L307)) with `this.setTranslate(...)` so `getTranslateX/Y` reflects the slide. → verify: tab strip slides correctly in the TabDemoPanel screen; oracle picks up the offset.
8. **Bucket-4 short-circuit.** Have `FieldSet.legendClearance` consult `DOM.source.isModelled()` and return `LEGEND_CLEARANCE_FALLBACK` when true.
9. **Perf checkpoint.** Run the MiscPanel slow-table benchmark with F12 open; confirm unmoved vs. the pre-change baseline.

### Stage 2 — test implementations + baked metrics

10. **Build the font-metrics generation script.** A node+headless-Chromium (or Vite dev page) script that drives `ProductionDOMSource` over the pinned test font at the theme sizes/weights and serialises a `FontMetricsTable` JSON. Check the JSON into `test/dom/font-metrics.<font>.json`.
11. **Implement `RecordingDOMSink`** — every method records `{op,args}`; `createElement` returns a minimal stub node sufficient for the framework's structural calls (the modelled source never reads layout off it). → verify: a smoke test installs it, constructs a `Panel` tree, asserts the recorded writes.
12. **Implement `ModelledDOMSource`** — `getViewportRect` runs the oracle; `measureText`/`measureFontMetrics` read the baked table; theme/viewport/scrollbar from config. → verify: an offline test lays out a known VBox/HBox tree, asserts `getViewportRect` matches the residual-0 oracle expectation; a baseline test asserts `measureTextBaseline()` within ±1px of the production-measured value captured in the table.
13. **Wire a Vitest harness helper** (`installTestDOM(config)` → `DOM.install({sink: new RecordingDOMSink(), source: new ModelledDOMSource(config)})`; `afterEach(() => DOM.reset())`). Add one representative offline geometry test and one offline baseline test. → verify: tests pass in the Node/jsdom-free environment.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/core/DOM.ts` |
| Create | `test/dom/TestDOM.ts` (RecordingDOMSink, ModelledDOMSource, FontMetricsTable) |
| Create | `test/dom/font-metrics.<font>.json` (baked, generated) |
| Create | `scripts/gen-font-metrics.mjs` (one-shot generator) |
| Create | `test/dom/geometry.test.ts`, `test/dom/baseline.test.ts` (representative offline tests) |
| Modify | `src/typescript/lib/core/StyleTarget.ts` (route `write` + `_getMainSheet` element creation through sink) |
| Modify | `src/typescript/lib/core/Component.ts` (structural writes via sink; geometry reads via source; `createFrame`/`removeElement`) |
| Modify | `src/typescript/lib/core/Util.ts` (text + viewport + scrollbar + theme-var reads via source; keep canvas/probe inside ProductionDOMSource delegate) |
| Modify | `src/typescript/lib/core/Theme.ts` (no new API; `getThemeVar` reads `ThemeManager.getTheme()`) |
| Modify | `src/typescript/lib/core/index.ts` (barrel exports) |
| Modify | `src/typescript/lib/component/container/TabBar.ts` (slide via `setTranslate`) |
| Modify | ~15 read-site files (`Popover`, `Menu`, `layout/Tab`, `Slider`, `ComboBox`, `Scrollbar`, `DockRegion`, `AbstractWindow`, `AutoCompleteDropdown`, `AbstractCalendarDropdown`, `TimePickerDropdown`, `AnimatedDropdown`) — `getBoundingClientRect` → source |
| Modify | ~39 files touching `appendChild`/`removeChild`, ~11 `createElement`, ~9 `classList` — structural writes → sink |
| Modify | `src/typescript/lib/component/display/FieldSet*` (legend `isModelled()` short-circuit) |

---

## Verification

- `npm run typecheck` — clean.
- `grep -rn 'getBoundingClientRect' src/ --include=*.ts | grep -v 'core/DOM.ts'` — zero outside `ProductionDOMSource`.
- `grep -rn 'getComputedStyle' src/ --include=*.ts | grep -v 'core/DOM.ts'` — only the documented holdouts (`Component.getBorderSize`, ProductionDOMSource internals).
- `grep -rn '\.classList\|createElement\|appendChild\|removeChild' src/ --include=*.ts | grep -v 'core/DOM.ts'` — only inside `ProductionDOMSink` (and the sanctioned `calculateScrollBarWidth` bootstrap, documented).
- `npm run test:lint` — existing `no-element-style.test.mjs` and `forward-super-options.test.mjs` still pass.
- App renders identically on every demo screen; theme toggle works (Bucket-3 reads still resolve).
- TabDemoPanel: vertical + horizontal tab strip slides correctly after the `setTranslate` migration.
- MiscPanel slow table: benchmark unmoved with DevTools open (the perf-sensitive screen).
- `npm run docs:build` — 0 errors, 0 link warnings (typedoc TS-version notice excepted).
- Stage 2: offline geometry test asserts oracle residual 0; offline baseline test within ±1px of baked production metric; `DOM.reset()` in `afterEach` isolates tests.

---

## Documentation Impact

- `DOMSink`, `DOMSource`, `Rect`, `ProductionDOMSink`, `ProductionDOMSource`, `DOM` are new exported core symbols from `src/typescript/lib/core/index.ts`. The test implementations are **not** exported from the lib barrel (test-only).
- Add a curated page under `docs/core/` documenting the two seams, the swap point, and the modelled-source contract (oracle + baked metrics). Update `docs/core/index.md` catalog and the sidebar in `docs/.vitepress/config.mts`.
- ARCHITECTURE.md's "Minimize direct DOM access" ([ARCHITECTURE.md:93](../ARCHITECTURE.md)) and "Three non-negotiable rules for every DOM write" ([ARCHITECTURE.md:116](../ARCHITECTURE.md)) should gain a sentence: the terminal write primitive is now `DOM.sink`, and reads go through `DOM.source` — raw `getBoundingClientRect`/`getComputedStyle`/structural mutation outside the production impls is now a lint-checkable violation.
- JSDoc on `Util` measurement functions should note they delegate to `DOM.source`.

---

## Potential Challenges

- **Font fidelity** — the baked table only matches if the test font is pinned and the generation script runs in the same engine class that produced the validated metrics; mitigation: bundle a fixed-version font, regenerate via the checked-in script, assert with ±1px tolerance.
- **Stub node fidelity** — `RecordingDOMSink.createElement` must return a node real enough for `appendChild`/attribute calls not to throw, yet the modelled source must never read layout off it; mitigation: a minimal `{tagName, children, attributes}` stub and a documented invariant that geometry comes only from committed `Component` state.
- **Component.getBorderSize element read** — it reads *element-specific* computed border widths, not theme vars, so it can't be a pure theme-model read; mitigation: leave as a documented production-only read with the existing pre-attach spec-string fallback ([Component.ts:2320](../src/typescript/lib/core/Component.ts#L2320)) covering the offline case, or add `getBorderWidths(component)` to the source if offline border fidelity proves necessary.
- **VirtualScroller pooled rows** — individual virtual rows aren't at committed absolute positions; mitigation: model the container offset only and scope offline assertions to the container, not pooled rows.
- **Writing-mode rotated boxes** — vertical tabs report rotated dims via the real rect but the oracle uses pre-rotation `getWidth`/`getHeight`; mitigation: `transposeIfRotated` in the modelled source keyed on `getWritingMode()` ([Component.ts:3364](../src/typescript/lib/core/Component.ts#L3364)).
- **Sub-pixel/zoom drift** — production rects are fractional; mitigation: ±1px tolerance in all offline assertions.
- **Migration breadth** — 39 files touch `appendChild`; mitigation: stage the corral (framework-core files first, then components), typecheck after each batch.

---

## Critical Files

- [core/StyleTarget.ts](../src/typescript/lib/core/StyleTarget.ts) — the existing write buffer the sink terminates; `write` (97), `_getMainSheet` (165), `_ruleCache` singleton pattern (159).
- [core/Component.ts](../src/typescript/lib/core/Component.ts) — geometry getters the oracle consumes (`getX`/`getY` 2708/2741, `getBorderSize` 2293, `getScrollLeft`/`Top` 2778/2787, `getTranslateX`/`Y` 2886/2895, `getParentComponent` 3791, `getWritingMode` 3364); write seam (`setElementStyle(s)` 947/966, `setElementCSSRule(s)` 1019/1040, `setElementAttribute` 906); element creation (`createFrame` 706, `getElement` 573, `removeElement` 601).
- [core/Util.ts](../src/typescript/lib/core/Util.ts) — the four text funnels (66/85/154/262) + `measureFontMetrics` (339), `lineHeightPx` (228), `opticalCenterOffset` (294), `getViewportSize` (426), `calculateScrollBarWidth` (445, legacy raw-style bootstrap).
- [core/Theme.ts](../src/typescript/lib/core/Theme.ts) — `ThemeManager.getTheme()` (1048) as the theme-var model source; `ThemeManager` singleton pattern (992).
- [component/container/VirtualScroller.ts](../src/typescript/lib/component/container/VirtualScroller.ts) — raw transform-as-scroll (328) + cached offset (`getScrollX`/`Y` 134/143); deliberate non-component split comment (71).
- [component/container/TabBar.ts](../src/typescript/lib/component/container/TabBar.ts) — strip slide (`_mainPos` 226, `applyStyle` slide writes 300–318) to migrate onto `setTranslate`.
- [ARCHITECTURE.md](../ARCHITECTURE.md) — DOM-access rules (93, 116, 184) the seam formalises.
- `plans/test-suite.md` — the Vitest/jsdom direction this plan's Stage-2 harness slots into.

---

## Non-Goals

- **Stage 3 — the worker transport.** No `postMessage` boundary, no worker-side state mirror, no logic moved off the main thread. The seam is *shaped* to allow it (serialisable inputs/outputs, one-way writes, no live-node returns) but the transport is explicitly out.
- **Migrating layout/component logic into a worker** — not in this plan.
- **Replacing `StyleTarget`'s batching** — the sink terminates the existing buffer; the `_dirty`/`queue`/`flush`/`autoCommitStyle` machinery is untouched.
- **Offline fidelity for pooled virtual rows** — only the VirtualScroller container offset is modelled.
- **A general `getBoundingClientRect(element)` model** — the modelled source is keyed on `Component`; arbitrary raw-element rects offline are out of scope beyond the component-root delegation in `getElementRect`.
- **Removing the `Component.getBorderSize` computed-style read or the `FieldSet` legend native read** — both remain documented production-only holdouts with existing fallbacks.
