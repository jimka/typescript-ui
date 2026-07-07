# SVG-Based Charting — Implementation Plan

## Overview

Add a native charting family to the component library: a shared SVG-first
foundation (scales, axis drawing, plot-rect layout, legend, theming tokens) plus
two concrete chart types — `LineChart` and `BarChart` — built on it. Charts are
`Component`s that render their plot as SVG marks through the existing DOM seam, so
they flow through the offline-testable sink/source split, size-negotiate, and
theme via CSS custom properties like every other component.

The computational layer only — scales, nice-number ticks, tick formatting, and
line/area path-`d` generation — delegates to thin, pure **D3 submodules**
(`d3-scale`, `d3-shape`, `d3-array`). These emit numbers and SVG path strings and
never touch the DOM, so the sink seam, offline tests, and geometry oracle are
untouched. All rendering, interaction, layout, legend, tooltip, selection, and
theming stay native.

The family lives in a new `src/typescript/lib/component/chart/` directory
(new `@jimka/typescript-ui/component/chart` subpath). It reuses three proven
mechanisms already in the codebase: SVG element construction through the sink
(the `Glyph` path — [DOM.ts:517](src/typescript/lib/core/DOM.ts#L517),
[Glyph.ts:634](src/typescript/lib/component/display/Glyph.ts#L634)), the
`doLayout()`-override placement pattern
([ComboBox.ts:746](src/typescript/lib/component/input/ComboBox.ts#L746)), and the
store-binding pattern (`_boundStore` / `_onStoreRefresh`,
[ComboBox.ts:1097](src/typescript/lib/component/input/ComboBox.ts#L1097)).

Charts bind to an `AbstractStore` or accept plain in-memory series arrays.
Interaction (hover tooltips, legend show/hide toggle, point selection) is wired
through the framework `Event` system on the chart's own element.

---

## Architecture Decisions

### SVG-first — no DOM-seam extension needed

The single most important feasibility question resolves cleanly: **the sink
already creates namespaced SVG elements and sets SVG attributes.**
`DOMSink.createElementNS(ns, tag)` is declared at
[DOM.ts:517](src/typescript/lib/core/DOM.ts#L517) and implemented at
[DOM.ts:1235](src/typescript/lib/core/DOM.ts#L1235); the `ElementPatch` batch
([DOM.ts:99](src/typescript/lib/core/DOM.ts#L99)) carries `setAttr`, `style`
(including `--custom` properties and `null` removals), `addClass`, and `text`.
`Glyph`/`Glyphs` already build live `<svg>`/`<symbol>`/`<use>`/`<path>` trees
this way ([Glyphs.ts:115–170](src/typescript/lib/component/display/Glyphs.ts#L115),
[Glyph.ts:634–651](src/typescript/lib/component/display/Glyph.ts#L634)), including
`DOM.sink.apply(el, { setAttr: { d, viewBox, ... } })`,
`appendChild`, `removeChild`, `release`, and `DOM.source.querySelector`.

Presentation attributes that carry data geometry (`d`, `points`, `x1`/`y1`,
`cx`/`cy`, `x`/`y`/`width`/`height`, `transform`) go through `setAttr`; colours
and stroke widths go through `style` as `var(--ts-ui-chart-*)` bindings so theme
toggling re-cascades automatically with no listener. No new sink method, no new
`no-raw-dom` baseline entry. This is what makes native SVG charting the right
call over wrapping Chart.js/D3.

### The chart is one Component owning one `<svg>` drawing surface

Each chart's root element is a normal `<div>` (so every `Component` setter —
background, border, size, `position: absolute` — applies). Inside it the chart
mounts a **single raw `<svg>` plot surface as a tracked child** via
`DOM.sink.createElementNS` + `this.trackHandle(svg)`
([Component.ts:643](src/typescript/lib/core/Component.ts#L643), mirroring
`Glyph.createRootElement`). Axes, gridlines, and series marks are SVG
`<g>`/`<path>`/`<rect>`/`<line>`/`<text>` children **drawn into that svg**, not
framework `Component`s.

This is deliberate and respects *Positioning is always absolute*
([ARCHITECTURE.md](ARCHITECTURE.md)): SVG sub-elements are positioned by SVG
user-space coordinates, which the framework's `position:absolute` /
`setX`/`setY` layout system cannot and must not drive. Keeping the plot internals
as raw SVG marks (the documented "trivial non-interactive helpers can stay as raw
children" carve-out) keeps them out of the layout system entirely. Interactive
chrome that *is* HTML — the legend — stays a real child `Component`.

### Plot-rect via `doLayout()` override, not a new LayoutManager

Per *Compose before specializing* and the *Positioning* manager-hierarchy rule,
no new `LayoutManager` is written. `AbstractChart` extends `Panel`, keeps the
`Absolute` layout manager, and **overrides `doLayout()`** exactly like
`ComboBox` ([ComboBox.ts:746](src/typescript/lib/component/input/ComboBox.ts#L746)):
call `super.doLayout()`, read `getInnerSize()` (cached — no DOM read), compute the
plot rect by subtracting axis/legend margins, redraw the SVG, then position the
legend child with `setX`/`setY`/`setWidth`/`setHeight`. The axis-label margins are
derived by measuring tick-label strings through `DOM.source.measureText` (the
off-screen probe `Text` already uses — [Text.ts:385](src/typescript/lib/component/input/Text.ts#L385)),
which is attach-independent and carries no stale-DOM hazard.

Because the redraw reads only the **cached** `_width`/`_height`/`getInnerSize()`
(set by `setSize` at [Component.ts:2733](src/typescript/lib/core/Component.ts#L2733)
*before* it calls `scheduleLayout`), the chart never reads live geometry inside
`doLayout`, so the `commitElementStyle()`-before-read hazard from project memory
does not arise. Redraw-on-data-change is driven the same way: `setSeries` /
`_onStoreRefresh` mutate the series model then `scheduleLayout()`, and the next
`doLayout` repaints.

### Pure D3 submodules for the computational layer

The scale/tick/path math is **not** hand-rolled — it delegates to three pure D3
submodules, imported granularly so the bundler tree-shakes to only the functions
used:

- **`d3-scale`** — `scaleLinear`, `scaleBand`, `scaleTime`. `.nice()` rounds the
  domain to nice numbers; `.ticks()` / `.tickFormat()` select and format axis
  ticks; the scale itself is the domain→pixel projector.
- **`d3-shape`** — `line()` (+ `curveMonotoneX` from the curve set) and `area()`
  generate the LineChart path-`d` strings; feed the returned string straight into
  `apply({ setAttr: { d } })`. Bar rects stay hand-computed from the band scale
  (d3-shape adds nothing to axis-aligned rectangles).
- **`d3-array`** — `extent` / `max` / `ticks` compute domains from the data.

**Why:** these submodules are pure functions that output numbers and SVG path
strings — they own no DOM, run no selection, and mutate nothing. So the DOM.sink
seam, the offline test harness, and the geometry oracle are all preserved exactly
as in the from-scratch design: native code still owns every `createElementNS` /
`apply` / `appendChild`. Delegating recovers the "polish" that hand-rolled math
gets wrong — nice-number tick selection, robust tick formatting, and monotone
curve interpolation — without an opaque canvas/DOM-owning chart box.

**Granular imports only.** We depend on the individual packages
(`import { scaleLinear } from "d3-scale"`), never the `d3` meta-package (which
re-exports the DOM-owning `d3-selection` / `d3-axis` / `d3-transition` and would
defeat tree-shaking). This keeps the bundled footprint to the handful of pure
functions actually called.

A thin adapter is kept only where the chart needs a stable seam over the scale:
`Scale.ts` exposes a small `ChartScale` interface plus factory functions that
construct and configure the d3 scale from the domain/range computed at layout —
an adapter around a d3 scale, not a reimplementation. A time axis uses `scaleTime`
(its `d3-time` / `d3-time-format` transitive deps ship with `d3-scale`), so the
`TimeScale`-avoidance note from the prior design is moot; `xScaleType: "time"`
simply selects `scaleTime`.

### Store binding mirrors ComboBox; in-memory arrays are the fallback

`AbstractChart` carries `private _boundStore: AbstractStore | null` and a stable
arrow field `_onStoreRefresh`, subscribing to `['load','add','remove','datachange']`
and unsubscribing the previous store first — the exact shape at
[ComboBox.ts:1107–1122](src/typescript/lib/component/input/ComboBox.ts#L1107).
`StoreEvent` is the real union
([AbstractStore.ts:30](src/typescript/lib/data/AbstractStore.ts#L30)); records are
read via `store.getRecords()`
([AbstractStore.ts:622](src/typescript/lib/data/AbstractStore.ts#L622)). On refresh
the chart rebuilds its series model from the store's records using configured
field accessors, then `scheduleLayout()`. Construction accepts *either*
`store` + field mappings *or* a plain `series` array; the two are mutually
exclusive construction paths.

### Interaction through `Event` on the chart's own element

Hit-testing uses `Event.addSubtreeListener(this, "mousemove", …)` and
`"click"` ([Event.ts:316](src/typescript/lib/core/Event.ts#L316)) registered on the
chart itself — subtree dispatch fires for any descendant target, which is exactly
the SVG mark under the pointer. Each drawn mark carries `data-series` and
`data-index` attributes (written via `setAttr`); the handler reads them off the
event target through the source seam to identify the hovered/clicked datum. This
sidesteps the two project-memory traps: subtree dispatch is *meant* to fire on the
ancestor chart (we listen on self, not children), and exact-target `addListener`
would be defeated by any wrapping clip/content frame — subtree listening is
immune. Handlers are named methods (`handlePointerMove`, `handlePointerClick`) per
the *Listeners must reference a named function* rule.

- **Hover tooltip:** reuse the overlay singleton `Tooltip.show(text, x, y)` /
  `Tooltip.hide()` ([Tooltip.ts:169](src/typescript/lib/overlay/Tooltip.ts#L169)) —
  no new tooltip class. The viewport `x`/`y` come from the hovered mark's rect
  (`DOM.source` geometry read; manual-verify).
- **Legend toggle:** `ChartLegend` emits a custom `"toggle"` event (series index);
  the chart hides/shows that series in its model and repaints.
- **Selection:** click sets a `_selectedPoint` on the chart and repaints with a
  selection ring; the chart emits its own `"selection"` custom event.

### Theming — a new `chart` token block with a categorical palette

Colours come exclusively from CSS custom properties. A new `chart` block is added
to the `Theme` interface ([Theme.ts:76](src/typescript/lib/core/Theme.ts#L76)),
emitted by `themeToVars` ([Theme.ts:883](src/typescript/lib/core/Theme.ts#L883)) as
`--ts-ui-chart-*`, and given values in the three built-in themes
(`ModernTheme`/`ClassicTheme` light, `DarkTheme` dark). Structural (scheme-
invariant) tokens — line/axis stroke widths, point radius — go in `BaseTheme`
([BaseTheme.ts:16](src/typescript/lib/core/themes/BaseTheme.ts#L16)).

The categorical **series palette** is an ordered array; `themeToVars` emits it as
`--ts-ui-chart-series-1 … --ts-ui-chart-series-8` via a small spread helper (same
shape as `tabButtonSideVars` at [Theme.ts:830](src/typescript/lib/core/Theme.ts#L830)).
The dataviz skill's `references/palette.md` is not present on this machine, so the
plan specifies an accessible, colour-blind-safe categorical set (Okabe–Ito, tuned
per scheme for adequate contrast on each background):

| # | Light (on light bg) | Dark (on dark bg) |
|---|---|---|
| 1 | `#0072B2` blue      | `#56B4E9` sky      |
| 2 | `#E69F00` orange    | `#E69F00` orange   |
| 3 | `#009E73` green     | `#00C08B` green    |
| 4 | `#D55E00` vermilion | `#FF7F4D` vermilion|
| 5 | `#CC79A7` purple    | `#E48FC1` purple   |
| 6 | `#56B4E9` sky       | `#0091D5` blue     |
| 7 | `#8C6D1F` gold      | `#F0E442` yellow   |
| 8 | `#555555` grey      | `#AAAAAA` grey     |

Plus `--ts-ui-chart-axis`, `--ts-ui-chart-grid`, `--ts-ui-chart-label`,
`--ts-ui-chart-tooltip-*` (or reuse `--ts-ui-tooltip-*`), and
`--ts-ui-chart-selection` (reuse the accent — `--ts-ui-indicator-focus`). Series
marks bind `stroke`/`fill: var(--ts-ui-chart-series-N)` so a theme switch
recolours with zero JS. `AbstractChart` subscribes to `ThemeManager.onThemeChange`
(like `Text`, [Text.ts:145](src/typescript/lib/component/input/Text.ts#L145)) only
to re-measure axis-label margins when the font changes, and `dispose()`s the
subscription.

### Callable options-bag construction

Every class is wrapped with `callable()` and exported under the public name (the
`TextCallable` tail, [Text.ts:1278](src/typescript/lib/component/input/Text.ts#L1278)),
so `LineChart({ series, … })` and `new LineChart({ … })` are interchangeable.
Consumer-configurable properties follow the *typed setter + `_options` cache +
`XOptions` field* triad from ARCHITECTURE.md.

---

## Dependencies

Three new runtime dependencies plus their type packages. Latest released versions
verified against the npm registry at write time; all are pure-ESM
(`"type": "module"` with an `exports` map), which resolves cleanly under the repo's
`"moduleResolution": "bundler"` + `"module": "ESNext"`
([tsconfig.json:3–5](tsconfig.json#L3)) and Vite — **no tsconfig or vite config
change is required.**

| Package | Version | Where |
|---|---|---|
| `d3-scale` | `^4.0.2` | `dependencies` |
| `d3-shape` | `^3.2.0` | `dependencies` |
| `d3-array` | `^3.2.4` | `dependencies` |
| `@types/d3-scale` | `^4.0.9` | `devDependencies` |
| `@types/d3-shape` | `^3.1.8` | `devDependencies` |
| `@types/d3-array` | `^3.2.2` | `devDependencies` |

Notes:
- `d3-scale`'s `scaleTime` pulls `d3-time` / `d3-time-format` / `d3-interpolate` /
  `d3-format` transitively — no separate direct dependency needed for time axes.
- The library build (`vite.lib.config.ts`) declares **no** `rollupOptions.external`,
  so — consistent with how `@fontsource-variable/manrope` is handled today — d3 is
  bundled into the `component/chart.es.js` entry and tree-shaken to the imported
  functions, not left as a consumer peer dependency. The granular-import rule keeps
  that bundled slice to the pure-math functions only.
- Only the three granular packages are added. The `d3` meta-package and the
  DOM-owning `d3-selection` / `d3-axis` / `d3-transition` are deliberately **not**
  dependencies (see Non-Goals).

---

## Public API

New subpath `@jimka/typescript-ui/component/chart`.

### Shared data types (`chart/types.ts`)

```typescript
export interface ChartPoint { x: number; y: number; }

export interface ChartSeries {
    name:    string;
    data:    ChartPoint[];
    color?:  string;   // overrides the palette slot; else --ts-ui-chart-series-N
}

// Field-accessor config for store-bound charts (mirrors ComboBox displayField).
export interface ChartStoreBinding {
    store:       AbstractStore;
    xField:      string;
    yField:      string;
    seriesField?: string;   // splits records into series; absent => single series
}
```

### `AbstractChart` (`chart/AbstractChart.ts`)

```typescript
export interface AbstractChartOptions extends PanelOptions {
    series?:      ChartSeries[];        // in-memory path
    store?:       AbstractStore;        // store path (with the field options below)
    xField?:      string;
    yField?:      string;
    seriesField?: string;
    showLegend?:  boolean;              // default true
    legendPosition?: "top" | "right" | "bottom";   // default "right"
    xAxisLabel?:  string;
    yAxisLabel?:  string;
    listeners?:   ChartListeners;       // "selection" toggle bag
}

// abstract base; not exported callable itself (subclasses are)
declare abstract class AbstractChart<O extends AbstractChartOptions = AbstractChartOptions>
    extends Panel<O> {

    // --- state (declare per super()-cascade rule) ---
    declare protected _series: ChartSeriesModel[];   // resolved series + hidden flag
    private _boundStore: AbstractStore | null;
    private readonly _onStoreRefresh: () => void;
    declare protected _selectedPoint: { series: number; index: number } | null;

    // --- data ---
    setSeries(series: ChartSeries[]): this;
    getSeries(): ChartSeries[];
    setStore(store: AbstractStore, xField: string, yField: string, seriesField?: string): this;
    getStore(): AbstractStore | null;

    // --- chrome ---
    setShowLegend(value: boolean): this;
    isShowLegend(): boolean;
    setLegendPosition(pos: "top" | "right" | "bottom"): this;

    // --- events (custom, ListenerBag) ---
    on(event: "selection", fn: (p: ChartSelectionEvent) => void): this;
    off(event: "selection", fn: (p: ChartSelectionEvent) => void): this;

    // --- lifecycle hooks the subtype fills in ---
    protected abstract buildScales(plot: Rect): { x: ChartScale; y: ChartScale };
    protected abstract drawSeries(plot: Rect, x: ChartScale, y: ChartScale): void;

    // --- overrides ---
    protected createRootElement(): Handle;   // div root + tracked <svg>
    doLayout(): this;                         // super, compute plot rect, redraw, place legend
    getPreferredSize(): Size | null;          // default ~400x300 unless set
    dispose(): void;                          // unbind store + theme listener
}
```

Backing-field / option / setter routing for `/implement`:

| Property | Option field | Backing | Setter |
|---|---|---|---|
| series | `series` | `_series` (resolved model) | `setSeries` |
| bound store | `store`+`xField`/`yField`/`seriesField` | `_boundStore` | `setStore` |
| legend visibility | `showLegend` | `_options.showLegend` | `setShowLegend` |
| legend position | `legendPosition` | `_options.legendPosition` | `setLegendPosition` |
| selection | — (runtime) | `_selectedPoint` | internal `selectPoint` |

### `LineChart` (`chart/LineChart.ts`)

```typescript
export interface LineChartOptions extends AbstractChartOptions {
    showPoints?: boolean;   // default true — draw <circle> markers
    curved?:     boolean;   // default false — straight <polyline> vs smoothed <path>
    xScaleType?: "linear" | "time";   // default "linear"
}
class LineChart extends AbstractChart<LineChartOptions> {
    protected buildScales(plot: Rect): { x: ChartScale; y: ChartScale };   // linear/time x, linear y
    protected drawSeries(plot: Rect, x: ChartScale, y: ChartScale): void;  // d3-shape line()/area() -> setAttr d
    setShowPoints(value: boolean): this;
}
// export const LineChart = callable(_LineChart)
```

### `BarChart` (`chart/BarChart.ts`)

```typescript
export interface BarChartOptions extends AbstractChartOptions {
    grouped?: boolean;   // default true when >1 series (grouped); false => stacked
}
class BarChart extends AbstractChart<BarChartOptions> {
    protected buildScales(plot: Rect): { x: ChartScale; y: ChartScale };   // band x, linear y
    protected drawSeries(plot: Rect, x: ChartScale, y: ChartScale): void;  // hand-computed <rect> per datum from band scale
}
// export const BarChart = callable(_BarChart)
```

### `ChartLegend` (`chart/ChartLegend.ts`) — a Component

```typescript
export interface ChartLegendOptions extends PanelOptions {
    entries?: { name: string; color: string; hidden?: boolean }[];
    listeners?: { toggle?: (seriesIndex: number) => void };
}
class ChartLegend extends Panel<ChartLegendOptions> {
    setEntries(entries: { name: string; color: string; hidden?: boolean }[]): this;
    on(event: "toggle", fn: (seriesIndex: number) => void): this;   // + off, emit
    // rows composed as HBox(swatch Component + Text); click -> emit("toggle", i)
}
// export const ChartLegend = callable(_ChartLegend)
```

### Scales (`chart/Scale.ts`) — thin adapters over d3-scale, not Components

Factory functions build and configure a d3 scale from the domain (computed with
`d3-array`) and the pixel range (computed at layout). They return the live d3
scale plus the tick/format helpers the axis needs — an adapter seam, not a
reimplementation. No class hierarchy; the d3 scale *is* the projector.

```typescript
import { scaleLinear, scaleBand, scaleTime } from "d3-scale";
import { extent, max } from "d3-array";
import type { ScaleLinear, ScaleBand, ScaleTime } from "d3-scale";

// Continuous value axis (line-chart x/y, bar-chart y). `.nice()` applied.
export function linearScale(domain: [number, number], range: [number, number]):
    ScaleLinear<number, number>;

// Time axis (line-chart x when xScaleType === "time").
export function timeScale(domain: [Date, Date], range: [number, number]):
    ScaleTime<number, number>;

// Discrete categories (bar-chart x). `paddingInner`/`paddingOuter` set from opts.
export function bandScale(categories: string[], range: [number, number], padding?: number):
    ScaleBand<string>;

// Union the chart passes around; every member exposes d3's `(v) => px`, plus
// `.ticks()`/`.tickFormat()` on the continuous ones and `.bandwidth()` on band.
export type ChartScale =
    ScaleLinear<number, number> | ScaleTime<number, number> | ScaleBand<string>;
```

Domain computation uses `extent(points, p => p.x)` and `max(points, p => p.y)`
from `d3-array`; nice ticks come from the scale's own `.ticks(count)` /
`.tickFormat(count)`.

### Axis drawing (`chart/ChartAxis.ts`) — pure helper, not a Component

Rendering is fully native — `drawAxis` walks `scale.ticks()` and emits tick lines,
tick labels (`<text>`), the axis line, and optional gridlines through `DOM.sink`.
`d3-axis` is **not** used (it owns a d3-selection and would mutate the DOM).

```typescript
export type AxisOrientation = "bottom" | "left";
// Draws the axis marks into a provided <g> handle via DOM.sink; returns the
// measured margin (px) the plot-rect computation must reserve for this axis.
export function drawAxis(
    group: Handle, orientation: AxisOrientation,
    scale: ScaleLinear<number, number> | ScaleTime<number, number> | ScaleBand<string>,
    plot: Rect,
    opts: { label?: string; tickCount: number; format: (v: any) => string; grid: boolean }
): number;
export function measureAxisMargin(
    orientation: AxisOrientation,
    scale: ScaleLinear<number, number> | ScaleTime<number, number> | ScaleBand<string>,
    format: (v: any) => string
): number;   // measures scale.ticks() labels via DOM.source.measureText
```

### Theme additions (`chart` block in `Theme.ts`)

```typescript
chart: {
    series: string[];        // categorical palette (>= 8 entries)
    axis:   string;          // axis line + tick colour
    grid:   string;          // gridline colour
    label:  string;          // axis/tick label text colour
    selection: string;       // selection-ring colour
};
// BaseTheme (structural): chart.lineWidth, chart.axisWidth, chart.pointRadius
```

---

## Internal Structure

### Plot-rect computation (inside `doLayout`)

```
super.doLayout();
const inner = this.getInnerSize(); if (!inner) return this;
const legendBox = this._showLegend ? this.reserveLegend(inner) : ZERO;   // edge dock
const plotOuter = inner minus legendBox on legendPosition edge;
const leftMargin   = measureAxisMargin("left",   yScale, yFormat);   // y tick label widths
const bottomMargin = measureAxisMargin("bottom", xScale, xFormat) + labelBand;
const plot: Rect = { x: leftMargin, y: topPad,
                     width:  plotOuter.width  - leftMargin - rightPad,
                     height: plotOuter.height - bottomMargin - topPad };
```
Scales are then built against `plot` (d3 scale factories from `Scale.ts`, ranges
from the plot rect), the SVG `viewBox`/size set from `inner`, and the group tree
repainted (`drawAxis` × 2, `drawSeries`, selection ring). The legend child is
positioned in its reserved edge box via `setX/Y/Width/Height`.

### Redraw pipeline

One private `repaint()` called at the end of `doLayout`. It clears the mark groups
(`removeChild` + `release` each old child, mirroring
[Glyphs.ts:189](src/typescript/lib/component/display/Glyphs.ts#L189)) and rebuilds
from the series model. For a `LineChart`, the path-`d` string comes from
`d3-shape`:

```typescript
import { line, area, curveMonotoneX, curveLinear } from "d3-shape";

const path = line<ChartPoint>()
    .x(p => xScale(p.x))
    .y(p => yScale(p.y))
    .curve(this._curved ? curveMonotoneX : curveLinear)(series.points);   // string | null
DOM.sink.apply(pathHandle, { setAttr: { d: path ?? "" } });
```

Bar rects are hand-computed from the band scale (`x = bandScale(cat)`,
`width = bandScale.bandwidth()`, `y`/`height` from the linear y-scale) — d3-shape
is not used for axis-aligned rectangles. Marks are appended with
`data-series`/`data-index` for hit-testing and
`style: { stroke/fill: var(--ts-ui-chart-series-N) }` for theming. Hidden series
(legend-toggled) and the `_selectedPoint` ring are honoured here.

### Series model resolution

`_series: ChartSeriesModel[]` where `ChartSeriesModel = { name, points, color, hidden }`.
Rebuilt by `setSeries` (copy the array) or `_onStoreRefresh` (group
`store.getRecords()` by `seriesField`, map `xField`/`yField` to `ChartPoint`s).
Preserves the `hidden` flag across a store refresh by series name.

---

## Ordered Implementation Steps

Foundation before concrete charts; test-first where the harness can exercise it.

1. **Install dependencies** — `npm i d3-scale d3-shape d3-array` and
   `npm i -D @types/d3-scale @types/d3-shape @types/d3-array` (versions in the
   *Dependencies* table). → verify: `npx tsc --noEmit` resolves
   `import { scaleLinear } from "d3-scale"` and `import { line } from "d3-shape"`
   under `moduleResolution: bundler` (no config change expected).
2. **Subpath wiring** — add `component/chart` to `tsconfig.json` paths
   (`tsconfig.lib.json` inherits via `extends`, so no change there),
   `vite.config.ts` alias, `vite.lib.config.ts` `lib.entry`, `package.json`
   `exports`, and `typedoc.json` `entryPoints`; create empty
   `src/typescript/lib/component/chart/index.ts`.
   → verify: `npx tsc --noEmit` resolves a throwaway
   `import {} from "@jimka/typescript-ui/component/chart"`.
3. **`chart/types.ts`** — `ChartPoint`, `ChartSeries`, `ChartStoreBinding`,
   event payload types.
4. **`chart/Scale.ts`** — thin adapters over `d3-scale` (`linearScale`,
   `timeScale`, `bandScale` factories + the `ChartScale` union) plus the
   `d3-array` domain helpers. → verify: unit tests (domain/range mapping via the
   d3 scale, `.nice()` rounding, `.ticks()` count, `bandwidth()`).
5. **`chart/ChartAxis.ts`** — `measureAxisMargin` + `drawAxis` walking
   `scale.ticks()` and writing SVG via the sink (native; no `d3-axis`).
   → verify: unit test the margin arithmetic and the mark set recorded by a
   test sink (tick count, label strings, `data`/`points` attrs); geometry pixels
   are manual-verify.
6. **Theme tokens** — add the `chart` block to `Theme`, the `--ts-ui-chart-*`
   emission (+ series-palette spread helper) in `themeToVars`, structural tokens in
   `BaseTheme`, and palette values in `ModernTheme`/`ClassicTheme`/`DarkTheme`.
   → verify: theme regression test (every `Theme` key covered) and
   `default-options-fallback` registry stay green;
   `grep -rn 'ts-ui-chart-' src/` shows emission + consumption.
7. **`chart/ChartLegend.ts`** — composed rows, `"toggle"` custom event via
   `ListenerBag`, `applyListeners` in its own constructor. → verify: unit test
   `setEntries` builds the right row count; toggle emit is manual-verify (click).
8. **`chart/AbstractChart.ts`** — root `<svg>` child, store binding, series-model
   resolution, `doLayout` override + `repaint`, interaction (`addSubtreeListener`,
   `Tooltip.show/hide`, selection), theme-change re-measure, `dispose`.
   → verify: unit tests for series-model resolution (in-memory + store-grouped),
   store subscribe/unsubscribe symmetry, plot-rect math; hover/selection/tooltip
   are manual-verify.
9. **`chart/LineChart.ts`** — `scaleLinear`/`scaleTime` x, `scaleLinear` y, path
   from `d3-shape` `line()`/`area()` (+ optional `curveMonotoneX`), point markers.
   → verify: unit test that N points produce a path/polyline with N vertices and
   correct `data-index` set; pixel path is manual-verify.
10. **`chart/BarChart.ts`** — `scaleBand` x, `scaleLinear` y, hand-computed grouped
    `<rect>`s from the band scale. → verify: unit test rect count = points ×
    series; geometry manual-verify.
11. **Barrel** — export all callable classes + option/type interfaces from
    `chart/index.ts` (the `display/index.ts` shape).
12. **Demo panel** — `src/typescript/ChartDemoPanel.ts` + register in
    `src/typescript/main.ts` (`addLazyTab(() => new ChartDemoPanel(), "Charts")`,
    [main.ts:39](src/typescript/main.ts#L39)) showing a store-bound LineChart and an
    in-memory BarChart with legend/hover/selection.
    → verify: `npm run dev` (http://localhost:8015), open Charts tab.
13. **Docs** — see *Documentation Impact*.

Checkpoint after each of 4/5/8: `npx tsc --noEmit` and the relevant unit suite.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/chart/index.ts` |
| Create | `src/typescript/lib/component/chart/types.ts` |
| Create | `src/typescript/lib/component/chart/Scale.ts` |
| Create | `src/typescript/lib/component/chart/ChartAxis.ts` |
| Create | `src/typescript/lib/component/chart/ChartLegend.ts` |
| Create | `src/typescript/lib/component/chart/AbstractChart.ts` |
| Create | `src/typescript/lib/component/chart/LineChart.ts` |
| Create | `src/typescript/lib/component/chart/BarChart.ts` |
| Create | `src/typescript/ChartDemoPanel.ts` |
| Create | `tests/component/chart/Scale.test.ts` (+ axis / series-model / legend suites) |
| Create | `docs/components/LineChart.md`, `docs/components/BarChart.md`, `docs/components/ChartLegend.md` |
| Modify | `src/typescript/lib/core/Theme.ts` (interface + `themeToVars`) |
| Modify | `src/typescript/lib/core/themes/BaseTheme.ts` (structural chart tokens) |
| Modify | `src/typescript/lib/core/themes/ModernTheme.ts`, `ClassicTheme.ts`, `DarkTheme.ts` (palette) |
| Modify | `package.json` — add `d3-scale`/`d3-shape`/`d3-array` deps + `@types/*` devDeps, and the `component/chart` `exports` entry |
| Modify | `tsconfig.json`, `vite.config.ts`, `vite.lib.config.ts`, `typedoc.json` (subpath + doc entry point) |
| Modify | `src/typescript/main.ts` (register demo tab) |
| Modify | `docs/components/index.md`, `docs/.vitepress/config.mts` sidebar |
| Modify | `tests/component/default-options-fallback.test.ts` (rows for any defaulted chart field) |

---

## Expected Behaviour

**Unit-testable (offline sink/source + pure math):**
- `linearScale`: the returned d3 scale maps `domainMin→rangeMin` and
  `domainMax→rangeMax` with linear interpolation between; `.nice()` rounds the
  domain to round bounds; `.ticks(n)` yields nice values inside the domain. (These
  assert the adapter wires the domain/range correctly — d3's own maths is trusted.)
- `bandScale`: N categories over a range yield equal bands; `bandwidth()` and band
  left edges account for padding; edge categories sit inside the range.
- `timeScale`: a `[Date, Date]` domain maps endpoints to the range; `.ticks()`
  returns Date instances (confirms `scaleTime` + its transitive `d3-time` resolve).
- `measureAxisMargin` grows with longer label strings.
- Series-model resolution: in-memory `series` copied verbatim; a store with a
  `seriesField` groups records into one model per distinct value, mapping
  `xField`/`yField`; empty store → zero series (no throw). A store refresh that
  changes records rebuilds the model and preserves each series' `hidden` flag by
  name.
- `setStore` unsubscribes the previous store from all four events before binding the
  next (no duplicate-listener accumulation).
- `drawSeries` records the expected mark set in a test sink: LineChart → one
  polyline/path per visible series with a vertex per point and ascending
  `data-index`; BarChart → one `<rect>` per (visible series × point). Hidden series
  emit no marks.
- `ChartLegend.setEntries` builds one row per entry with the swatch colour bound.
- `dispose()` removes the store subscriptions and the theme listener.

**Manual-verify (geometry / events / visual — the harness can't exercise):**
- Plot renders inside its margins; axes, gridlines, and labels are legible and not
  clipped; resizing the tab re-lays-out the plot fluidly.
- Hover over a mark shows the tooltip at the point; leaving hides it.
- Clicking a legend entry hides/greys that series and repaints; clicking again
  restores it.
- Clicking a point selects it (selection ring) and fires `"selection"`.
- Light/dark theme toggle recolours series, axes, grid, and labels with no reload.
- Empty-series and single-point series render without error.

---

## Verification

- `npx tsc --noEmit` (and `npm run typecheck`) clean.
- `npm test` — the new chart suites plus the theme regression and
  default-options-fallback suites green.
- `grep -rn 'ts-ui-chart-' src/` — tokens both emitted (`Theme.ts`) and consumed
  (chart marks); no orphan.
- `grep -rn "createElementNS\|no-raw-dom" src/typescript/lib/component/chart/` — all
  SVG creation goes through `DOM.sink`; ESLint `local/no-raw-dom` baseline unchanged.
- `grep -rn "from \"d3" src/typescript/lib/component/chart/` — imports are only from
  `d3-scale` / `d3-shape` / `d3-array`; no import from `d3`, `d3-selection`,
  `d3-axis`, or `d3-transition` (DOM-owning). Confirm `d3` is absent from
  `package.json` dependencies.
- `npm run build` and `npm run build:lib` succeed (new `component/chart` entry emits
  `dist/lib/component/chart.es.js` with the d3 pure functions bundled + tree-shaken).
- `npm run dev` → http://localhost:8015 → **Charts** tab: exercise every
  manual-verify behaviour above (scope DevTools queries to `.ChartDemoPanel` per the
  same-class-coexistence memo).
- `npm run docs:build` finishes with zero warnings.

---

## Documentation Impact

- New API docs generate from the callable exports once `chart/index.ts` is a
  `typedoc.json` entry point (mirror the `component/display` entry). Add
  `LineChart`, `BarChart`, `ChartLegend` to `docs/components/index.md` catalog and
  the VitePress sidebar (`docs/.vitepress/config.*`).
- Author `docs/components/LineChart.md` / `BarChart.md` / `ChartLegend.md` per the
  `document` skill (options table, store-binding + in-memory examples, theming note
  pointing at the `--ts-ui-chart-*` tokens).
- Extend `docs/concepts/theming.md` with the chart palette tokens and
  `docs/concepts/data-binding.md` with the store-bound-chart example.
- Public JSDoc may only `{@link}` exported symbols (project rule) — reference scale/
  axis internals in prose, not links.

---

## Potential Challenges

- **Axis-label margin feedback loop.** Margins depend on label widths, which depend
  on the scale, which depends on the plot rect, which depends on the margin. Break
  it by measuring labels from the *domain* (independent of pixel range) before
  computing the rect — `measureAxisMargin` takes the scale's domain ticks, not the
  laid-out positions.
- **Mark churn on every repaint.** Clearing and rebuilding all marks each `doLayout`
  is simple but allocates; at hundreds of points it is fine (the stated density).
  Keep repaint allocation-lean; a diffing pool is a Non-Goal.
- **Handle leaks.** Every `createElementNS` mark must be `release`d when cleared, or
  the retained-handle registry pins it (the `Glyphs` `_removeSymbolFromSprite`
  lesson). Centralise create/clear in `repaint`.
- **Tooltip point geometry** is the one live-DOM read; it needs the mark already
  rendered (it is, post-`doLayout`) and is offline-untestable — verify live.
- **`super()`-cascade fields.** `_series`, `_selectedPoint` are touched by
  cascade-dispatched setters, so declare them `declare` (project CODE_CONVENTIONS),
  and wire the `listeners` bag from the constructor body, not `applyOptions`.
- **Panel min/clamp semantics.** As a `Panel`, the chart clamps only to its explicit
  min/max and fits the allocated space (`clampsToContentSize()===false`); set a
  sensible default `preferredSize` (~400×300) and a small min so it can shrink.
- **d3 ESM under `moduleResolution: bundler`.** `d3-scale`/`-shape`/`-array` v4/v3
  are ESM-only (`"type": "module"` + `exports` map); this resolves cleanly under the
  repo's bundler resolution and Vite, but confirm with a `tsc --noEmit` on a probe
  import at step 1 before building on it. d3-shape's `line()`/`area()` emit path
  strings with **no DOM**, so offline path generation works in the test harness.
- **Accidental `d3` meta-import.** Pulling `import ... from "d3"` (or a DOM-owning
  submodule) would balloon the bundle and drag a `d3-selection` into the sink-free
  layer. Guard with the grep in *Verification*; import only the three granular
  packages.

---

## Critical Files

- [DOM.ts:99,440,517,1235](src/typescript/lib/core/DOM.ts) — `ElementPatch`, sink
  interface, `createElementNS`, production impl.
- [Glyph.ts:634](src/typescript/lib/component/display/Glyph.ts#L634),
  [Glyphs.ts:110–198](src/typescript/lib/component/display/Glyphs.ts#L110) — the
  proven raw-SVG-through-sink pattern (create / apply / append / query / release /
  trackHandle).
- [Component.ts:643,1181,2733,4614,4653](src/typescript/lib/core/Component.ts) —
  `trackHandle`, `commitElementStyle`, `setSize`, `doLayout`, `onFirstLayout`.
- [ComboBox.ts:746,1097](src/typescript/lib/component/input/ComboBox.ts) — `doLayout`
  child-placement override and the store-binding shape.
- [Text.ts:145,385,1269,1278](src/typescript/lib/component/input/Text.ts) — theme
  subscription, `measureText`, render-via-sink, `callable()` tail.
- [Theme.ts:76,830,883](src/typescript/lib/core/Theme.ts),
  [BaseTheme.ts](src/typescript/lib/core/themes/BaseTheme.ts) — token interface,
  spread-helper pattern, emission.
- [AbstractStore.ts:30,622](src/typescript/lib/data/AbstractStore.ts) — `StoreEvent`
  union, `getRecords`.
- [Event.ts:316](src/typescript/lib/core/Event.ts#L316),
  [Tooltip.ts:169](src/typescript/lib/overlay/Tooltip.ts#L169) — subtree listening,
  tooltip reuse.
- [vite.lib.config.ts:24](vite.lib.config.ts#L24), `package.json` exports,
  `tsconfig.json` paths — the five subpath wiring points.

---

## Non-Goals

- **Canvas / WebGL render backend** — the deferred escape hatch for high-density
  series. SVG-only in this plan; a `canvas-component.md`/`webgl-component.md` plan
  already exists for that surface.
- **DOM-owning D3 modules** — `d3-selection`, `d3-axis`, `d3-transition` (and the
  `d3` meta-package) are deliberately **not** dependencies. They mutate the DOM
  directly, bypassing the `DOM.sink` seam and breaking offline-testability. Only the
  pure-math submodules (`d3-scale`, `d3-shape`, `d3-array`) are used; all rendering,
  axis drawing, and interaction stay native.
- **High-density / streaming data** — no virtualization, no incremental append, no
  mark-diffing pool. Modest data (hundreds of points) only.
- **Extra chart types** — pie/scatter/area/stacked-mixed, dual axes, log/ordinal
  scales, brushing/zoom/pan. LineChart + BarChart prove the architecture; more types
  are additive later.
- **Animated transitions** between data states.
- **Rich multi-series tooltips** — a single hovered mark shows text via the shared
  `Tooltip`; a bespoke crosshair/multi-row tooltip panel is out of scope.
