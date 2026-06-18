---
depends-on: [test-suite]
---

# DOMSink / DOMSource — Implementation Plan

## Overview

Route every DOM **write** through a `DOMSink` seam and every DOM **read** through a `DOMSource` seam, so the whole framework talks to the browser through two swappable interfaces. The production implementations are thin pass-throughs that behave bit-for-bit like today; the test implementations record writes and *model* reads (no browser) so unit tests can assert real pixel positions, baselines, and scroll offsets offline.

The write side is already ~80% centralised: every CSS/attribute write funnels through `Component.setElementStyle(s)` / `setElementCSSRule(s)` / `setElementAttribute` ([Component.ts:934–1068](../src/typescript/lib/core/Component.ts#L934)) into the deferred-write buffers in [StyleTarget.ts](../src/typescript/lib/core/StyleTarget.ts). The read side is already centralised too: all text metrics funnel through ~4 `Util` functions ([Util.ts:66–290](../src/typescript/lib/core/Util.ts#L66)), and component geometry is derivable from committed state via the validated geometry oracle plus one root DOM read.

This plan is **staged**: Stage 1 introduces the two seams with production implementations and migrates every read/structural-write site behind them, with zero behavioural or perf change. Stage 2 adds recording/modelled test implementations and the baked font-metrics table. Stage 2's test wiring depends on the harness introduced by [`plans/test-suite.md`](test-suite.md) (declared in `depends-on` above); this plan keeps its test implementations harness-agnostic and does not assume a specific runner. Stage 3 (a real worker transport) is a **non-goal** — but the seam boundary is shaped to not preclude it.

---

## Architecture Decisions

### The two seams are separate interfaces — `DOMSink` (writes) and `DOMSource` (reads)

Writes and reads have fundamentally different shapes: writes are fire-and-forget and already buffered/batched (`StyleTarget` queues then flushes); reads are synchronous request/response that must return a value *now*. Folding them into one object would force the read methods to fake a return when the sink is a no-op recorder. Keeping them separate lets the test sink be a pure recorder while the test source is an independent geometry model. It also matches the worker future: a worker transport posts writes one-way (sink) but must round-trip reads (source) — different mechanisms.

### `DOMSink` is an extension of the existing `StyleTarget` flush path, not a replacement

The sink does **not** re-implement buffering. `StyleTarget` keeps its `_dirty` bag, `queue`/`flush`, and `autoCommitStyle` gating exactly as-is. The sink is the **terminal write primitive** that `StyleTarget.write()` and the structural-mutation helpers call instead of touching `element.style` / `element.classList` / `appendChild` directly. So `setElementStyle` → `StyleTarget.set` → (eventually) `sink.setStyle(target, key, value)`. Production `sink.setStyle` does exactly what `StyleTarget.write` does today. This keeps the existing batching semantics untouched and makes the migration a redirection of the leaf writes, not a rewrite of the buffer.

The currently-scattered structural writes — `classList` (9 files), `createElement` (8 files) plus `createElementNS` SVG creation (2 files: `Glyph`, `Glyphs`), `appendChild`/`removeChild` (39 files) — get corralled into named sink methods (`createElement`, `createElementNS`, `appendChild`, `removeChild`, `addClass`/`removeClass`/`toggleClass`, `setAttribute`/`removeAttribute`, `setTextContent`). These are the methods ARCHITECTURE.md's "Minimize direct DOM access" rule ([ARCHITECTURE.md:103](../ARCHITECTURE.md#L103)) already wants behind an API; the sink is that API.

### `DOMSource` exposes *intent-level* reads, not `getBoundingClientRect`

Today call sites read `element.getBoundingClientRect()` and then do arithmetic (anchor positioning in [Popover.ts:611/792](../src/typescript/lib/core/Popover.ts#L611), [Menu.ts:339/341/358](../src/typescript/lib/core/Menu.ts#L339)). If `DOMSource` just exposed `getBoundingClientRect(element)` the modelled source would have to reverse-engineer which `Component` an element belongs to. Instead the source is keyed on the **`Component`**: `getViewportRect(component): Rect`. The production implementation calls `component.getElement()!.getBoundingClientRect()`; the modelled implementation runs the geometry oracle. Call sites that read a child element belonging to a component already have the owning component in scope, so those are a near-1:1 swap — **but the anchor-positioning reads are the common case and they read a *non-component* node**: `Popover`/`Menu` and the three dropdowns (`AbstractCalendarDropdown`, `TimePickerDropdown`, `AutoCompleteDropdown`) all rect-read a raw anchor element (`_anchorElement` / `anchorEl` / `parentEl`) that is not a `Component`. Those keep the lower-level `getElementRect(element)` escape hatch, which the modelled source can stub or — where the element *is* a component root — delegate to the oracle. So the swap is component-keyed where a component is in scope and element-keyed for the anchor reads; it is not uniformly 1:1.

### The geometry oracle is the modelled `DOMSource.getViewportRect`

Validated (residual exactly 0) recurrence walking `getParentComponent()` upward ([Component.ts:3912](../src/typescript/lib/core/Component.ts#L3912) `getParentComponent`, [Component.ts:2736/2769](../src/typescript/lib/core/Component.ts#L2736) `getX`/`getY`, [Component.ts:2321](../src/typescript/lib/core/Component.ts#L2321) `getBorderSize`, [Component.ts:2806/2815](../src/typescript/lib/core/Component.ts#L2806) `getScrollLeft`/`getScrollTop`, [Component.ts:2920/2929](../src/typescript/lib/core/Component.ts#L2920) `getTranslateX`/`getTranslateY`):

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

- **`VirtualScroller`** writes `_rowsContainer.style.transform = translate3d(-scrollX,-scrollY)` directly on a **raw element** ([VirtualScroller.ts:373](../src/typescript/lib/component/container/VirtualScroller.ts#L373)); `_rowsContainer` is not a `Component`. The offset is cached as `getScrollY`/`getScrollX` ([VirtualScroller.ts:152/161](../src/typescript/lib/component/container/VirtualScroller.ts#L152)). (Its constructor also writes raw `container.style.*` at [VirtualScroller.ts:89–94](../src/typescript/lib/component/container/VirtualScroller.ts#L89) — these are sanctioned one-shot setup writes on the deliberate non-component element and are excluded from the sink-discipline grep, documented alongside the `_rowsContainer` rationale.)
- **`TabBar`** slides via an internal `TabIndicator` sub-component ([TabBar.ts:209](../src/typescript/lib/component/container/TabBar.ts#L209)) whose `applyBarGeometry()` ([TabBar.ts:279](../src/typescript/lib/component/container/TabBar.ts#L279)) writes the slide as part of a **batched** `setElementStyles({top, bottom, left, right, width, height, transform: translateX/Y(_mainPos)})` ([TabBar.ts:291/302](../src/typescript/lib/component/container/TabBar.ts#L291)); `_mainPos` is cached ([TabBar.ts:210](../src/typescript/lib/component/container/TabBar.ts#L210)) but **not** via `setTranslate`, so `getTranslateX/Y()` stays a stale 0.

**Decision: migrate the `TabIndicator` slide onto `setTranslate`** so the generic oracle term picks it up — `TabIndicator` *is* a `Component`, so `this.setTranslate(...)` reflects the slide. This is **not a pure drop-in**: it splits `transform` out of the single batched `setElementStyles` geometry write into the separate cached translate channel, and it must coexist with `applyBarGeometry`'s existing `applyStyle`-replay role (the comment at [TabBar.ts:272](../src/typescript/lib/component/container/TabBar.ts#L272) notes `applyStyle` doesn't replay the slide transform). Treat it as a small, real refactor of `applyBarGeometry`, verified against the existing replay override, not a one-line substitution. **VirtualScroller stays raw but exposes its offset to the modelled source**: its `_rowsContainer` is a deliberate non-component (the comment at [VirtualScroller.ts:73](../src/typescript/lib/component/container/VirtualScroller.ts#L73) explains why the transform can't sit on a `Component`), so the modelled source treats the scroller's content offset as an extra scroll term, read from `getScrollX`/`getScrollY`. Because virtual rows are pooled/recycled (not laid out at absolute committed positions), offline geometry assertions on individual virtual rows are out of scope; the source models the *container* offset, which is what callers measure. Rationale for not forcing VirtualScroller onto `setTranslate`: it would put a layout-driving transform on a `Component`'s own box, which the existing two-element split deliberately avoids.

### Injection: global singleton with a swap function, not per-component injection

ARCHITECTURE.md's construction discipline (typed setters, cache-in-memory, construction stays JS-only) is about *DOM access timing*, not about *dependency wiring*. The framework already uses module-level singletons for exactly this kind of cross-cutting infrastructure: `ThemeManager` ([Theme.ts:1189](../src/typescript/lib/core/Theme.ts#L1189)) holds the active theme as a `static current` ([Theme.ts:1190](../src/typescript/lib/core/Theme.ts#L1190)), and `StyleTarget` keeps a module-level `_ruleCache` ([StyleTarget.ts:159](../src/typescript/lib/core/StyleTarget.ts#L159)). Per-component injection would mean threading a sink/source through every `Component` constructor and every `Util` free function — a massive, invasive change that fights the existing construction-options-bag idiom and gains nothing, since tests run one harness at a time. **A `DOM` module holds `DOM.sink` and `DOM.source`, defaulting to the production implementations, with `DOM.install({sink, source})` to swap them in test setup and `DOM.reset()` to restore.** This mirrors `ThemeManager.setTheme`. Production code never calls `install`; it just reads `DOM.sink` / `DOM.source`.

This is the one place the plan touches global state. It is justified: the alternative (constructor injection) is a far larger violation of "Surgical Changes" and the construction-options discipline, and the singleton is swap-scoped and reset-able, so tests stay isolated.

### Production stays a thin pass-through (and provably so)

`ProductionDOMSink` methods are one-liners: `setStyle(t,k,v)` is the current body of `StyleTarget.write`; `appendChild(p,c)` is `p.appendChild(c)`; `addClass(e,c)` is `e.classList.add(c)`. `ProductionDOMSource.getViewportRect(c)` is `c.getElement()!.getBoundingClientRect()` (returned as a plain `Rect`); `measureText` calls the existing `Util` canvas/DOM-probe code. No batching, no caching, no branching beyond what exists today. The perf checkpoint (MiscPanel slow table benchmark unmoved) guards against accidental indirection cost; because the methods are monomorphic singletons the JIT inlines them.

### Bucket 3 (theme vars / native constants) reads from the model, not the DOM

- `--ts-ui-*` reads currently go through `getComputedStyle(:root)` in several places: `Util` ([Util.ts:197/221/373](../src/typescript/lib/core/Util.ts#L197)), plus `ProgressSpinner` ([ProgressSpinner.ts:30](../src/typescript/lib/component/display/ProgressSpinner.ts#L30)), `Text` ([Text.ts:277/317](../src/typescript/lib/component/input/Text.ts#L277)), `AbstractWindow` ([AbstractWindow.ts:2044](../src/typescript/lib/core/AbstractWindow.ts#L2044)), and a var-resolve inside `Component.getBorderSize`'s fallback ([Component.ts:2385](../src/typescript/lib/core/Component.ts#L2385)). The modelled source resolves these from `ThemeManager.getTheme()` ([Theme.ts:1247](../src/typescript/lib/core/Theme.ts#L1247)) instead — the values are already in the `Theme` model (`theme.font.size`, `theme.font.family`, `theme.font.linePadding`). Note `theme.font.linePadding` is typed `string` ([Theme.ts:90](../src/typescript/lib/core/Theme.ts#L90)), so the modelled `getThemeVar`/`linePaddingPx` path must `parseFloat` it exactly as the production `linePaddingPx` ([Util.ts:192](../src/typescript/lib/core/Util.ts#L192)) does — return a px **number**, not the raw string. Production keeps reading computed style. This becomes a `DOMSource.getThemeVar(name)` method.
- `Util.calculateScrollBarWidth` ([Util.ts:473](../src/typescript/lib/core/Util.ts#L473)) writes raw `el.style.*` directly — legacy, predating the all-writes-through-setters rule. It is a **one-shot bootstrap measurement**, cached forever in `scrollBarWidth`. Decision: route it as `DOMSource.getScrollBarWidth(): number` — production runs the existing measurement once; modelled returns a baked constant (typical 15px, configurable). Its raw style writes are excluded from the sink-discipline grep as a sanctioned one-shot bootstrap (documented in the source impl).
- `Util.getViewportSize` ([Util.ts:454](../src/typescript/lib/core/Util.ts#L454)) reads `documentElement.clientWidth`/`window.innerWidth`. Becomes `DOMSource.getViewportSize(): Size`; modelled returns injected config (e.g. `{width:1280,height:800}`).

### Bucket 4 (genuinely browser-only) stays a fallback, not a seam method

`FieldSet.legendClearance` reads a native `<legend>` offsetHeight and already has `LEGEND_CLEARANCE_FALLBACK`. It is the single irreducibly-browser read. It is **not** worth a seam method: the modelled source can't compute it (the native legend box has no model), so it would just return the fallback anyway. Decision: leave it as-is, but have it consult `DOM.source.isModelled()` (a boolean flag) to short-circuit to the fallback offline rather than calling a DOM API that throws in Node. This is the lone documented hold-out.

### Font metrics: baked table, pinned to a test font with a tolerance

The four `Util` text functions (`measureTextSize`/`measureTextMetrics`/`measureTextWidth`/`measureTextBaseline`, [Util.ts:66/85/182/290](../src/typescript/lib/core/Util.ts#L66)) and their helpers (`measureFontMetrics`, `lineHeightPx`, `opticalCenterOffset`) are the **main fidelity risk** (range-rect ≠ baseline; Chrome ≠ Chromium glyph paint — see prior baseline-measurement-pitfalls notes). They funnel two strategies: canvas `measureText` and a DOM-probe via `getBoundingClientRect`. The seam swaps the leaf measurement: `DOMSource.measureText(text, options): TextMetrics` and `DOMSource.measureFontMetrics(): {ascent,descent,capTop}` (no args — mirrors the existing nullary `Util.measureFontMetrics` at [Util.ts:367](../src/typescript/lib/core/Util.ts#L367)). Production keeps the canvas/probe code. Modelled returns values from a **baked font-metrics table**: a JSON map keyed by `(family, size, weight, style)` → per-character advance widths + font ascent/descent/cap-top. Tests **pin one font** (a bundled web font, e.g. a fixed-version DejaVu Sans or the test environment's deterministic font) so the table matches what would render. The table is **produced once** by a generation script that runs the *production* source in a real browser (or headless Chromium) over the test font at the theme sizes and serialises the metrics; checked into the repo. Assertions use a **±1px tolerance** to absorb sub-pixel rounding. The existing `Util` cache + `invalidateTextMetricsCache` ([Util.ts:345](../src/typescript/lib/core/Util.ts#L345)) is preserved; the modelled source's results are equally cacheable.

### Worker-compatibility without building the worker

Two constraints make the seam worker-ready: (1) every `DOMSource` method takes **serialisable** inputs (a `Component` is identified by `getId()`; the modelled source already walks committed state that could be mirrored worker-side) and returns **plain data** (`Rect`, `Size`, `TextMetrics` — no live DOM nodes); (2) every `DOMSink` method is **one-way** (no return value used for control flow) so it can become a `postMessage`. The plan does **not** build the transport, but it forbids any seam method from returning a live `Element` or `CSSStyleRule` to a caller (the `getElement`-returning escape hatch stays *inside* the production source). This is the only worker-shaping constraint imposed now.

---

## Public API (TypeScript Signatures)

New file `core/DOM.ts` (exported from the core barrel). It imports `Component` from [`core/Component.ts`](../src/typescript/lib/core/Component.ts), `Size` from [`primitive/Size.ts`](../src/typescript/lib/primitive/Size.ts), and — **critically** — `TextMetrics`/`TextMeasureOptions` from [`core/Util.ts`](../src/typescript/lib/core/Util.ts) (exported at [Util.ts:32/10](../src/typescript/lib/core/Util.ts#L32)). The `Util` `TextMetrics` import is load-bearing: `TextMetrics` is also a built-in DOM-lib (canvas) type, so without the explicit `Util` import the bare name in the signatures below silently resolves to the global, not the framework's metrics shape.

```typescript
import type { Component } from './Component';
import type { Size } from '../primitive/Size';
import type { TextMetrics, TextMeasureOptions } from './Util'; // NOT the built-in DOM-lib TextMetrics

/** Plain serialisable rect — never a live DOMRect. */
export interface Rect { x: number; y: number; width: number; height: number; }

/** Terminal DOM-write primitive. Production passes through; tests record. */
export interface DOMSink {
    setStyle(style: CSSStyleDeclaration, key: string, value: string | null): void;
    createElement(tag: string): HTMLElement;
    createElementNS(ns: string, tag: string): Element;   // SVG sprite/glyph construction (Glyph, Glyphs)
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

Stage-2 test file `tests/dom/TestDOM.ts` (under the `tests/` tree from [`plans/test-suite.md`](test-suite.md); not exported from the lib barrel):

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

1. **Create `core/DOM.ts`** with the two interfaces, `Rect`, `ProductionDOMSink`, `ProductionDOMSource`, and the `DOM` namespace (defaulting to production). `ProductionDOMSource.measureText`/`measureFontMetrics` initially **delegate to the existing `Util` functions** (no logic moved yet) to keep the diff small. Note `Util.measureFontMetrics` ([Util.ts:367](../src/typescript/lib/core/Util.ts#L367)) is currently a module-private `function` (no `export`), so this step must add `export` to it (alongside the already-exported text funnels) for the production delegate to call it.
2. **Export from the core barrel** ([core/index.ts](../src/typescript/lib/core/index.ts)) — `DOMSink`, `DOMSource`, `Rect`, `ProductionDOMSink`, `ProductionDOMSource`, `DOM`.
3. **Route `StyleTarget.write` through the sink.** Replace the body of the private `write` ([StyleTarget.ts:97](../src/typescript/lib/core/StyleTarget.ts#L97)) with `DOM.sink.setStyle(style, key, value)`. `ProductionDOMSink.setStyle` contains the moved custom-property/camelCase logic verbatim. → verify: app renders identically; eslint `no-element-style` still passes.
4. **Corral structural writes into the sink.** `createElement` appears in 8 files, but **7 get corralled** to `DOM.sink.createElement`; the 8th, `core/Util.ts`, keeps its canvas/probe `createElement` inside the production measurement delegate (excluded from the verification grep — see step 6). Likewise migrate `createElementNS` (2 files — `Glyph` [Glyph.ts:640](../src/typescript/lib/component/display/Glyph.ts#L640), `Glyphs` [Glyphs.ts:112](../src/typescript/lib/component/display/Glyphs.ts#L112)) to `DOM.sink.createElementNS`; `appendChild`/`removeChild` (39 files, less `Util`'s probe/bootstrap calls, which stay in the delegate), `classList` (9 files), and remaining raw `setAttribute`/`removeAttribute`/`textContent` to `DOM.sink.*`. Concentrate the framework-internal ones first (`Component.createFrame` [Component.ts:733](../src/typescript/lib/core/Component.ts#L733), `removeElement` [Component.ts:617](../src/typescript/lib/core/Component.ts#L617), `StyleTarget._getMainSheet` [StyleTarget.ts:165](../src/typescript/lib/core/StyleTarget.ts#L165)). → verify: app renders; `npm run typecheck` clean; **both** structural-discipline greps in **Verification** — the `classList`/`createElement`/`appendChild`/`removeChild` grep **and** the `setAttribute`/`removeAttribute`/`textContent =`/`.remove()` grep — return zero (the second covers the attribute/text/remove methods the first doesn't).
5. **Migrate geometry reads to `DOM.source.getViewportRect`.** 13 files have real `getBoundingClientRect` *call sites*: `Popover`, `Menu`, `Slider`, `ComboBox`, `Scrollbar`, `TabBar`, `DockRegion`, `AbstractWindow`, the three dropdowns (`AutoCompleteDropdown`, `AbstractCalendarDropdown`, `TimePickerDropdown`), **`ToolBar`** [ToolBar.ts:684](../src/typescript/lib/component/menubar/ToolBar.ts#L684), **`SplitButton`** [SplitButton.ts:217](../src/typescript/lib/component/button/SplitButton.ts#L217). Classify each read by what element it targets. **`getViewportRect(component)` — own or child component root:** `Slider` ([Slider.ts:631](../src/typescript/lib/component/input/Slider.ts#L631)) and `SplitButton` ([SplitButton.ts:217](../src/typescript/lib/component/button/SplitButton.ts#L217)) read `this.getElement()` (own root → pass `this`); `ToolBar` ([ToolBar.ts:684](../src/typescript/lib/component/menubar/ToolBar.ts#L684)) reads `trigger.getElement()` and `DockRegion` ([DockRegion.ts:213](../src/typescript/lib/layout/DockRegion.ts#L213)) reads `this._region.getElement(true)` — both a *child* component's root, so pass that child component to `getViewportRect`. **`getElementRect(element)` — non-component nodes:** the anchor reads (`Popover`/`Menu`/the three dropdowns and `ComboBox` [ComboBox.ts:204](../src/typescript/lib/component/input/ComboBox.ts#L204), all `anchorEl`) and the raw internal/ancestor-element reads (`TabBar` clip/wrapper elements, `Scrollbar` [Scrollbar.ts:869](../src/typescript/lib/component/container/Scrollbar.ts#L869), `AbstractWindow`'s `parentElement` read [AbstractWindow.ts:1918](../src/typescript/lib/core/AbstractWindow.ts#L1918)). Keep `getBoundingClientRect` calls that live *inside* `ProductionDOMSource`/`Util` measurement. Note: `layout/Tab.ts:106`, `core/Rail.ts:43`, `core/AnimatedDropdown.ts:335`, and `core/Component.ts:3492` all match the grep but are **JSDoc comments, not call sites** — they are not migration targets. → verify: `grep -rn '\.getBoundingClientRect(' src/typescript/lib --include=*.ts | grep -v 'core/DOM.ts\|core/Util.ts\|core/AnimatedDropdown.ts'` returns zero. (The `\.…(` form skips the bare-token prose in Tab/Rail/Component; `AnimatedDropdown.ts:335` writes `anchorEl.getBoundingClientRect()` in prose so it needs the explicit `-v` exclusion.)
6. **Migrate Bucket-3 reads.** Route every `getComputedStyle(:root)` theme-var read through `DOM.source.getThemeVar`: `Util.linePaddingPx`/`rootFontSizePx`/`measureFontMetrics` ([Util.ts:197/221/373](../src/typescript/lib/core/Util.ts#L197)), `ProgressSpinner` ([ProgressSpinner.ts:30](../src/typescript/lib/component/display/ProgressSpinner.ts#L30)), `Text` ([Text.ts:277/317](../src/typescript/lib/component/input/Text.ts#L277)), and `AbstractWindow.getMinDockWidth` ([AbstractWindow.ts:2044](../src/typescript/lib/core/AbstractWindow.ts#L2044)). Also `getViewportSize` → `DOM.source.getViewportSize`; `getScrollBarWidth` → `DOM.source.getScrollBarWidth`. **Documented production-only holdouts that stay** (element-specific reads, no theme-model equivalent): `Component.getBorderSize`'s `getComputedStyle(element)` ([Component.ts:2335](../src/typescript/lib/core/Component.ts#L2335)) plus its `var()` fallback resolve ([Component.ts:2385](../src/typescript/lib/core/Component.ts#L2385)); `Popover.collectScrollAncestors`'s overflow read ([Popover.ts:913](../src/typescript/lib/core/Popover.ts#L913)); and `Util`'s own DOM-probe measurement reads (`resolveFontSizePx`'s probe `getComputedStyle` [Util.ts:169](../src/typescript/lib/core/Util.ts#L169) and the canvas/probe text-metrics code), which stay inside the production measurement delegate. → verify: `grep -rn 'getComputedStyle(' src/typescript/lib --include=*.ts | grep -v 'core/DOM.ts\|core/Util.ts' | grep -vE ':[0-9]+:[[:space:]]*(//|\*)'` returns only the documented element-read holdouts (`Component.getBorderSize`, `Popover.collectScrollAncestors`). The `getComputedStyle(` paren form skips inline prose, the trailing `grep -vE` drops `//`/` *` comment lines, and `core/Util.ts` is excluded as the production measurement delegate.
7. **Migrate the `TabIndicator` slide onto `setTranslate`.** In `TabIndicator.applyBarGeometry` ([TabBar.ts:279](../src/typescript/lib/component/container/TabBar.ts#L279)), lift the `transform: translateX/Y(_mainPos)` key out of the batched `setElementStyles` ([TabBar.ts:291/302](../src/typescript/lib/component/container/TabBar.ts#L291)) and write it via `this.setTranslate(...)` so `getTranslateX/Y` reflects the slide. Verify the change against the existing `applyStyle`-replay role ([TabBar.ts:272](../src/typescript/lib/component/container/TabBar.ts#L272)) — the geometry box keys stay in `setElementStyles`, only the translate moves to the cached channel. → verify: tab strip slides correctly (vertical + horizontal) in the TabDemoPanel screen; oracle picks up the offset.
8. **Bucket-4 short-circuit.** Have `FieldSet.legendClearance` consult `DOM.source.isModelled()` and return `LEGEND_CLEARANCE_FALLBACK` when true.
9. **Perf checkpoint.** Run the MiscPanel slow-table benchmark with F12 open; confirm unmoved vs. the pre-change baseline.

### Stage 2 — test implementations + baked metrics

> Stage 2 builds on the test harness delivered by [`plans/test-suite.md`](test-suite.md) (see `depends-on`). The implementations below are **runner-agnostic** — plain classes plus an `installTestDOM(config)` helper — so they slot into whatever harness that plan lands. Do not assume a specific runner or lifecycle hook here; setup calls `installTestDOM`, teardown calls `DOM.reset()`, wired however the harness expresses setup/teardown.

10. **Build the font-metrics generation script.** A node+headless-Chromium (or Vite dev page) script that drives `ProductionDOMSource` over the pinned test font at the theme sizes/weights and serialises a `FontMetricsTable` JSON. Check the JSON in next to the test DOM implementations.
11. **Implement `RecordingDOMSink`** — every method records `{op,args}`; `createElement` returns a minimal stub node sufficient for the framework's structural calls (the modelled source never reads layout off it). → verify: a smoke check installs it, constructs a `Panel` tree, asserts the recorded writes.
12. **Implement `ModelledDOMSource`** — `getViewportRect` runs the oracle; `measureText`/`measureFontMetrics` read the baked table; theme/viewport/scrollbar from config. → verify: an offline check lays out a known VBox/HBox tree and asserts `getViewportRect` matches the residual-0 oracle expectation; a baseline check asserts `measureTextBaseline()` within ±1px of the production-measured value captured in the table.
13. **Provide an `installTestDOM(config)` helper** (→ `DOM.install({sink: new RecordingDOMSink(), source: new ModelledDOMSource(config)})`, restored via `DOM.reset()`). Add one representative offline geometry check and one offline baseline check. → verify: the checks pass under the harness from `plans/test-suite.md`, with no live DOM and `DOM.reset()` restoring production between checks.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/core/DOM.ts` |
| Create | `tests/dom/TestDOM.ts` (RecordingDOMSink, ModelledDOMSource, FontMetricsTable, `installTestDOM`) |
| Create | `tests/dom/font-metrics.<font>.json` (baked, generated) |
| Create | `scripts/gen-font-metrics.mjs` (one-shot generator) |
| Create | `tests/dom/geometry.test.ts`, `tests/dom/baseline.test.ts` (representative offline checks) |
| Modify | `src/typescript/lib/core/StyleTarget.ts` (route `write` + `_getMainSheet` element creation through sink) |
| Modify | `src/typescript/lib/core/Component.ts` (structural writes via sink; geometry reads via source; `createFrame`/`removeElement`) |
| Modify | `src/typescript/lib/core/Util.ts` (text + viewport + scrollbar + theme-var reads via source; keep canvas/probe inside ProductionDOMSource delegate) |
| Modify | `src/typescript/lib/core/Theme.ts` (no new API; `getThemeVar` reads `ThemeManager.getTheme()`; structural `createElement`/`appendChild` at 1170/1172 → sink, counted in the `createElement`/`appendChild` rows below) |
| Modify | `src/typescript/lib/core/index.ts` (barrel exports) |
| Modify | `src/typescript/lib/component/container/TabBar.ts` (slide via `setTranslate`) |
| Modify | 13 read-site files (`Popover`, `Menu`, `Slider`, `ComboBox`, `Scrollbar`, `TabBar`, `DockRegion`, `AbstractWindow`, `AutoCompleteDropdown`, `AbstractCalendarDropdown`, `TimePickerDropdown`, `component/menubar/ToolBar`, `component/button/SplitButton`) — `getBoundingClientRect` → source (`layout/Tab`, `core/Rail`, `core/AnimatedDropdown`, `core/Component` only mention it in JSDoc — not migrated) |
| Modify | 39 files touching `appendChild`/`removeChild`, 8 `createElement` (+ 2 `createElementNS`: `Glyph`, `Glyphs`), 9 `classList` — structural writes → sink |
| Modify | `src/typescript/lib/component/container/FieldSet.ts` (legend `isModelled()` short-circuit) |

---

## Verification

- `npm run typecheck` — clean.
- `grep -rn '\.getBoundingClientRect(' src/typescript/lib --include=*.ts | grep -v 'core/DOM.ts\|core/Util.ts\|core/AnimatedDropdown.ts'` — zero. The `\.…(` form skips the bare-token prose in `layout/Tab.ts`/`core/Rail.ts`/`core/Component.ts`; `core/Util.ts` (measurement delegate) and `core/AnimatedDropdown.ts:335` (prose `.()`) are excluded explicitly.
- `grep -rn 'getComputedStyle(' src/typescript/lib --include=*.ts | grep -v 'core/DOM.ts\|core/Util.ts' | grep -vE ':[0-9]+:[[:space:]]*(//|\*)'` — only the documented element-read holdouts (`Component.getBorderSize` incl. its `var()` fallback at Component.ts:2335/2385, `Popover.collectScrollAncestors` at Popover.ts:913). The `(` form skips inline JSDoc prose; the trailing `grep -vE` drops `//` dead-code and ` *` JSDoc-continuation lines (e.g. Component.ts:2530/2542 commented-out `getComputedStyle`); `core/Util.ts` holds the production probe/measurement reads (`resolveFontSizePx`, canvas/probe metrics) and is excluded as the measurement delegate.
- `grep -rnE '\.classList|\.createElement|appendChild|removeChild' src/typescript/lib --include=*.ts | grep -v 'core/DOM.ts\|core/Util.ts\|DOM\.sink\.' | grep -vE ':[0-9]+:[[:space:]]*(//|\*)'` — zero. The sink's `createElement`/`appendChild`/`removeChild` method names deliberately mirror the DOM API (per the pass-through decision: `appendChild(p,c)` *is* `p.appendChild(c)`), so migrated call sites read `DOM.sink.appendChild`/`createElement`/… and would still match the substring patterns — the `DOM\.sink\.` exclusion drops them while still catching any *raw* `element.appendChild`/`createElement` left unmigrated. (`classList`→`addClass` and the source's `getBoundingClientRect`→`getViewportRect` rename, so their greps need no such exclusion; only the same-named sink methods do.) The only un-prefixed structural calls then live in `ProductionDOMSink` inside the excluded `core/DOM.ts`; `core/Util.ts` is excluded as the production measurement/`calculateScrollBarWidth`-bootstrap delegate; the trailing `grep -vE` drops JSDoc/comment lines (e.g. the `appendChild` prose at Component.ts:4500). (`\.createElement` also catches `createElementNS`, now a sink method.) The migrated `Theme.ts` structural writes (`createElement`/`appendChild` at 1170/1172) are covered by the `DOM\.sink\.` exclusion like every other call site.
- `grep -rnE '\.setAttribute\(|\.removeAttribute\(|\.textContent[[:space:]]*=|\.remove\(\)' src/typescript/lib --include=*.ts | grep -v 'core/DOM.ts\|core/Util.ts\|DOM\.sink\.' | grep -vE ':[0-9]+:[[:space:]]*(//|\*)'` — zero. Covers the rest of the sink's structural surface (`setAttribute`/`removeAttribute`/`setTextContent`/`removeElement`) that the `classList`/`createElement`/`appendChild`/`removeChild` grep above doesn't. `setAttribute`/`removeAttribute` keep their DOM-API names so migrated `DOM.sink.setAttribute(…)` call sites are dropped by the `DOM\.sink\.` exclusion (raw `el.setAttribute` still caught); `textContent =` writes migrate to the renamed `setTextContent` and `.remove()` to `removeElement`, so both literal forms vanish (the `\.textContent[[:space:]]*=` form targets only *writes*, leaving the rare `.textContent` *read* alone). `core/Util.ts` is excluded as the probe/measurement delegate (its canvas-probe elements set attributes/text directly).
- `npm run test:lint` — the existing `scripts/eslint/no-element-style.test.mjs` and `forward-super-options.test.mjs` ESLint-rule tests still pass.
- App renders identically on every demo screen; theme toggle works (Bucket-3 reads still resolve).
- TabDemoPanel: vertical + horizontal tab strip slides correctly after the `setTranslate` migration.
- MiscPanel slow table: benchmark unmoved with DevTools open (the perf-sensitive screen).
- `npm run docs:build` — 0 errors, 0 link warnings (typedoc TS-version notice excepted).
- Stage 2 (under the `plans/test-suite.md` harness): offline geometry check asserts oracle residual 0; offline baseline check within ±1px of baked production metric; `DOM.reset()` in teardown isolates checks.

---

## Documentation Impact

- `DOMSink`, `DOMSource`, `Rect`, `ProductionDOMSink`, `ProductionDOMSource`, `DOM` are new exported core symbols from `src/typescript/lib/core/index.ts`. The test implementations are **not** exported from the lib barrel (test-only).
- Add a curated page under `docs/concepts/` documenting the two seams, the swap point, and the modelled-source contract (oracle + baked metrics). Update `docs/concepts/index.md` catalog and the sidebar in `docs/.vitepress/config.mts`.
- ARCHITECTURE.md's "Minimize direct DOM access" ([ARCHITECTURE.md:103](../ARCHITECTURE.md#L103)) and "Three non-negotiable rules for every DOM write" ([ARCHITECTURE.md:126](../ARCHITECTURE.md#L126)) should gain a sentence: the terminal write primitive is now `DOM.sink`, and reads go through `DOM.source` — raw `getBoundingClientRect`/`getComputedStyle`/structural mutation outside the production impls is now a lint-checkable violation.
- JSDoc on `Util` measurement functions should note they delegate to `DOM.source`.

---

## Potential Challenges

- **Font fidelity** — the baked table only matches if the test font is pinned and the generation script runs in the same engine class that produced the validated metrics; mitigation: bundle a fixed-version font, regenerate via the checked-in script, assert with ±1px tolerance.
- **Stub node fidelity** — `RecordingDOMSink.createElement` must return a node real enough for `appendChild`/attribute calls not to throw, yet the modelled source must never read layout off it; mitigation: a minimal `{tagName, children, attributes}` stub and a documented invariant that geometry comes only from committed `Component` state.
- **Component.getBorderSize element read** — it reads *element-specific* computed border widths, not theme vars, so it can't be a pure theme-model read; mitigation: leave as a documented production-only read with the existing pre-attach spec-string fallback ([Component.ts:2321](../src/typescript/lib/core/Component.ts#L2321)) covering the offline case, or add `getBorderWidths(component)` to the source if offline border fidelity proves necessary.
- **VirtualScroller pooled rows** — individual virtual rows aren't at committed absolute positions; mitigation: model the container offset only and scope offline assertions to the container, not pooled rows.
- **Writing-mode rotated boxes** — vertical tabs report rotated dims via the real rect but the oracle uses pre-rotation `getWidth`/`getHeight`; mitigation: `transposeIfRotated` in the modelled source keyed on `getWritingMode()` ([Component.ts:3485](../src/typescript/lib/core/Component.ts#L3485)).
- **Sub-pixel/zoom drift** — production rects are fractional; mitigation: ±1px tolerance in all offline assertions.
- **Migration breadth** — 39 files touch `appendChild`; mitigation: stage the corral (framework-core files first, then components), typecheck after each batch.

---

## Critical Files

- [core/StyleTarget.ts](../src/typescript/lib/core/StyleTarget.ts) — the existing write buffer the sink terminates; `write` (97), `_getMainSheet` (165), `_ruleCache` singleton pattern (159).
- [core/Component.ts](../src/typescript/lib/core/Component.ts) — geometry getters the oracle consumes (`getX`/`getY` 2736/2769, `getBorderSize` 2321, `getScrollLeft`/`Top` 2806/2815, `getTranslateX`/`Y` 2920/2929, `getParentComponent` 3912, `getWritingMode` 3485); write seam (`setElementStyle(s)` 975/994, `setElementCSSRule(s)` 1068/1047, `setElementAttribute` 934); element creation (`createFrame` 733, `getElement` 601, `removeElement` 617).
- [core/Util.ts](../src/typescript/lib/core/Util.ts) — the four text funnels (`measureTextSize`/`measureTextMetrics`/`measureTextWidth`/`measureTextBaseline` 66/85/182/290) + `measureFontMetrics` (367), `lineHeightPx` (256), `opticalCenterOffset` (322), `getViewportSize` (454), `calculateScrollBarWidth` (473, legacy raw-style bootstrap).
- [core/Theme.ts](../src/typescript/lib/core/Theme.ts) — `ThemeManager.getTheme()` (1247) as the theme-var model source; `ThemeManager` singleton pattern (1189, `static current` 1190).
- [component/container/VirtualScroller.ts](../src/typescript/lib/component/container/VirtualScroller.ts) — raw transform-as-scroll (373) + cached offset (`getScrollY`/`X` 152/161); raw setup writes (89–94); deliberate non-component split comment (73).
- [component/container/TabBar.ts](../src/typescript/lib/component/container/TabBar.ts) — `TabIndicator` (209) strip slide (`_mainPos` 210, batched `applyBarGeometry` writes 279/291/302) to migrate onto `setTranslate`; `applyStyle`-replay comment (272).
- [ARCHITECTURE.md](../ARCHITECTURE.md) — DOM-access rules (103, 126, 184) the seam formalises.
- `plans/test-suite.md` — the Vitest/jsdom direction this plan's Stage-2 harness slots into.

---

## Non-Goals

- **Stage 3 — the worker transport.** No `postMessage` boundary, no worker-side state mirror, no logic moved off the main thread. The seam is *shaped* to allow it (serialisable inputs/outputs, one-way writes, no live-node returns) but the transport is explicitly out.
- **Migrating layout/component logic into a worker** — not in this plan.
- **Replacing `StyleTarget`'s batching** — the sink terminates the existing buffer; the `_dirty`/`queue`/`flush`/`autoCommitStyle` machinery is untouched.
- **Offline fidelity for pooled virtual rows** — only the VirtualScroller container offset is modelled.
- **A general `getBoundingClientRect(element)` model** — the modelled source is keyed on `Component`; arbitrary raw-element rects offline are out of scope beyond the component-root delegation in `getElementRect`.
- **Removing the `Component.getBorderSize` computed-style read or the `FieldSet` legend native read** — both remain documented production-only holdouts with existing fallbacks.
