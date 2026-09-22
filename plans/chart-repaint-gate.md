---
depends-on: [text-measurement-without-reflow, w3-0-bounding-sweep]
touches-shared:
  - packages/lib/src/typescript/lib/component/chart/AbstractChart.ts
  - packages/lib/tests/component/chart/Chart.test.ts
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
  - packages/qa/src/harness/ablations.ts
  - packages/qa/tests/ablations.test.ts
  - packages/qa/src/panels/chart-line.ts
  - packages/qa/src/panels/chart-dashboard.ts
  - packages/qa/README.md
---

# Chart Repaint Gate — Implementation Plan

## Overview

`AbstractChart.doLayout()` ([`component/chart/AbstractChart.ts:574`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts#L574)) ends in an unconditional `repaint()` (`:715`), which removes and re-creates every **mark** — each SVG element the chart draws: axis lines, gridlines, ticks, tick labels, axis titles, series paths, point markers, bars and the selection ring. It does this on every layout pass, including a **settled pass**: one where neither the chart's size nor its data changed, such as a parent re-laying out a dashboard. A 3-series × 50-point line chart rebuilds 210 elements in 1,081 sink calls per pass; an empty chart still rebuilds 57 axis marks. The same pass also rewrites the SVG surface's `width`, `height` and `viewBox` attributes in `sizeSurface` (`:606`) whether or not they changed. W3.0's `chart.repaint-gate` ablation, which skipped a repaint whose size and state were unchanged, took a dashboard pass — four 3-series line charts of 50 points each — from 23.2 to 9.1 ms with 96% fewer sink calls, and never engaged on a data update ([`96-w3-0-bounding-sweep.md`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#f261--f262--abstractchart)).

This plan ships that gate in `AbstractChart`. A pass redraws the marks only when they are not **current**: the marks are current when they were drawn for the plot rectangle this pass computed and nothing has called the chart's `scheduleLayout()` since. `AbstractChart` overrides `scheduleLayout()` to mark the drawing stale, so every existing state change — which already ends in that call — still redraws. `sizeSurface` writes only when the inner size or perimeter origin changed. F26.2, the per-pass axis-margin measurement, is left to `text-measurement-without-reflow`, which this plan depends on: its memo already makes a repeated pass's measurement free.

Beyond the library file, the plan adds unit tests to `Chart.test.ts`, a changelog entry and migration note for subclass authors, and three QA changes: the two W3.0 chart ablations turn inert on a gated library, the chart panels gain geometry labels on marks, and the QA README records both.

---

## Architecture Decisions

### The gate follows `DiagramView`'s last-size guard and `Text`'s stale flag

The size half compares the plot rectangle against the one the current marks were drawn for, as [`DiagramView.anchorCentreAcrossResize`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1760) compares the viewport size its last pass recorded and returns early on a match (`:1778`). The state half is a flag set on every state change and cleared when the marks are drawn, as `Text` sets `_measurementDirty` in its setters and re-measures when it is set ([`Text.needsMeasure`](packages/lib/src/typescript/lib/component/input/Text.ts#L557)).[^precedent]

### The repaint key is the plot rectangle plus "no `scheduleLayout()` since the last repaint"

`repaint` runs when either half differs; otherwise the pass keeps every mark. Each input the marks depend on is covered by one of the two halves:

| Input | Where it enters the marks | Covered by |
|---|---|---|
| Size | inner size → legend band → axis margins → plot rectangle | the plot rectangle |
| Data identity and version | `_series`, rebuilt by `setSeries`, `setStore` and the bound store's `load` / `add` / `remove` / `datachange` | each rebuild calls `scheduleLayout()` |
| Series visibility | `model.hidden`, flipped by a legend click | `handleLegendToggle` calls `scheduleLayout()` |
| Axis and series configuration | `showLegend`, `legendPosition`, `xAxisLabel`, `yAxisLabel`; `LineChart`'s `showPoints`, `curved`, `xScaleType`; `BarChart`'s `grouped` | every setter calls `scheduleLayout()` |
| Scale domain | the visible points and the scale kind | the three rows above |
| Scale range | the plot rectangle, in both subclasses | the plot rectangle |
| Theme | colours and stroke widths are `var(--ts-ui-chart-*)` bindings that re-cascade by themselves; label widths feed the margins | the theme subscription (`:194`) calls `scheduleLayout()`; a new margin also moves the plot |
| Selection | `_selectedPoint` | `selectPoint` calls `scheduleLayout()` |
| Hover | nothing: hover shows or hides the tooltip and draws no mark | — |
| Locale and tick formatting | d3's `tickFormat` under d3's module-wide default locale; the library sets no locale or format option | follows the domain |

The rule decides these cases:

| Pass | Plot vs. the plot the marks were drawn for | `scheduleLayout()` since the last repaint | Marks |
|---|---|---|---|
| first pass after render | none drawn yet | — | drawn |
| settled pass (the QA `passes` driver, a parent re-commit) | equal | no | kept |
| `setSeries` with a new data set of the same extent (`chart-line`'s `update`) | equal | yes | redrawn |
| width 400 → 401 | different | no | redrawn |
| legend toggle | equal or different | yes | redrawn once; the next pass keeps them |
| theme switch | equal or different | yes | redrawn |
| insets grow by 5 on each side and the outer size by 10 on each axis | equal | no | kept; the surface's `left` / `top` are rewritten |
| a subclass mutates state it draws from and does not call `scheduleLayout()` | equal | no | kept — the documented contract is to call it |

The marks are a function of the plot rectangle and the chart's state, so these two halves suppress no legitimate repaint.[^signature-complete]

### `AbstractChart.scheduleLayout()` marks the drawing stale

`AbstractChart` overrides `scheduleLayout()`: it sets the **stale mark** — it clears `_paintedPlot`, the record of the plot rectangle the current marks were drawn for — then calls `super.scheduleLayout()`. No setter changes, and a subclass that already calls `scheduleLayout()` after its own state changes — as `LineChart` and `BarChart` do — keeps redrawing with no new API.[^schedule-override]

### The stale mark clears when the marks are drawn, not when the pass starts

`repaint` records the plot rectangle as its last statement, after every mark is drawn. A `scheduleLayout()` that arrives earlier in the same pass — the call the legend makes on the chart when `reserveLegend` rebuilds its rows — is absorbed by that pass's repaint, and a draw that throws is retried on the next pass.[^clear-at-paint]

### Only the repaint is gated; the plot and scales are still computed every pass

`doLayout` keeps calling `sizeSurface`, `reserveLegend`, `computePlot` and `buildScales` on every pass, and stores `_plot`, `_xScale` and `_yScale` as today. The gate wraps only the `repaint` call, as the ablation wrapped `repaint` alone.[^plot-every-pass]

### `sizeSurface` writes only when the inner size or the perimeter origin changed

`sizeSurface` remembers the inner size and origin it last wrote and returns early on a match, the same last-value guard as the repaint's size half. `doLayout` passes its own `origin` in instead of `sizeSurface` reading `getPerimeterSize()` a second time.[^surface]

| Inner size and origin vs. the last write | `sizeSurface` |
|---|---|
| both equal (settled pass, data update) | writes nothing |
| inner width 400 → 401 | one `apply`: `width`, `height`, `viewBox`, and the unchanged style keys |
| origin left 0 → 5, inner size equal | one `apply` |

### F26.2 is subsumed by `text-measurement-without-reflow`

This plan adds no margin memo and no measurement batching. `text-measurement-without-reflow` routes `measureAxisMargin`'s measurements through its memo and canvas, so a repeated pass measures nothing and a new label set measures without a document layout; `ChartAxis.ts` is that plan's file and this plan does not touch it. The in-engine A/B checks the subsumption on the drag cell W3.0 credited to F26.2.[^f26-2]

### Where the fix follows the ablation, and where it differs

| Aspect | W3.0 `chart.repaint-gate` | This plan |
|---|---|---|
| What is skipped | the call to `repaint` | same |
| State half | a revision counter bumped by an own `scheduleLayout` on `AbstractChart.prototype` | same trigger, as a real `scheduleLayout()` override; a cleared field instead of a counter |
| Size half | plot x, y, width, height, plus both scales' domain and range as strings | plot x, y, width, height[^key-fields] |
| When the key is recorded | before the original `repaint` runs | after the marks are drawn |
| Marks removed outside a repaint | not tracked | `clearMarks` clears the key, so disposal cannot leave a stale record |
| Memory | a `WeakMap` entry per chart | one field per chart |
| `sizeSurface` | not gated | gated |
| Margin measurement | the separate `chart.margin-memo` arm | none here; `text-measurement-without-reflow`'s memo |
| Subclass contract | none | documented: call `scheduleLayout()` after changing drawn state |

### The W3.0 chart ablations turn inert on a gated library

`chart.repaint-gate` and `chart.margin-memo` stay registered. Each checks `AbstractChart.prototype` before installing its revision stamp — the own `scheduleLayout` the W3.0 ablations put there:[^ablation-inert]

| `AbstractChart.prototype` has | Either chart ablation |
|---|---|
| no own `scheduleLayout` (a build before this plan) | installs the stamp and its wrapper, as in W3.0 |
| an own `scheduleLayout` that is the stamp (the other chart ablation ran first) | keeps the stamp and installs its wrapper, as in W3.0 |
| an own `scheduleLayout` that is not the stamp (this plan's override) | returns `no ungated repaint: AbstractChart gates its own` and patches nothing |

### Mark geometry labels give the in-engine geometry gate sight of the marks

The QA chart panels label only containers, which this change cannot move. `chart-line` gains `point: '.LineChart circle'` and `chart-dashboard` gains `point0: '.LineChart circle'` and `bar0: '.BarChart rect'`: the first point marker and the first bar, whose rectangles move with the data and the plot.[^mark-labels]

### The subclass contract change ships with a migration note

A subclass whose drawing reads state it changes without calling `scheduleLayout()` no longer sees that change drawn on the next unrelated pass. The changelog lists this under *Breaking changes*, with a migration note.[^breaking]

---

## Public API

No symbol is added or removed. `AbstractChart` overrides one inherited public method with the same signature; `LineChart` and `BarChart` inherit it:

```typescript
export abstract class AbstractChart<O extends AbstractChartOptions = AbstractChartOptions> extends Panel<O> {
    /** Queues a layout pass and marks the chart's marks stale, so that pass redraws them. */
    scheduleLayout(): this;   // overrides Component.scheduleLayout
}
```

The new state is private bookkeeping with no option and no accessor (ARCHITECTURE.md, rule 3: internal state stays off the options bag): `_paintedPlot` and `_surfaceBox`, below.

---

## Internal Structure

All in [`AbstractChart.ts`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts). Match the file's style: no `override` keyword, blank lines as `CODE_CONVENTIONS.md` requires.

**Fields.** After `_overlayGroup` (`:160`):

```typescript
// The inner size and perimeter origin `sizeSurface` last wrote to the SVG
// surface, so a pass that changes neither writes nothing. Null until the first
// write. Written only from `doLayout`, never during construction.
private _surfaceBox: { width: number; height: number; left: number; top: number } | null = null;
```

After `_marks` (`:165`):

```typescript
// The plot rectangle the current marks were drawn for. Undefined when no mark
// is current: before the first repaint, after `clearMarks`, and from any
// `scheduleLayout()` until the next repaint. `declare`d because
// `scheduleLayout()` can run inside the `super()` cascade, where a field
// initializer would run afterwards (CODE_CONVENTIONS.md).
declare private _paintedPlot: PlotRect | undefined;
```

**The override**, in the Layout section, directly above `doLayout` (`:566`):

```typescript
/**
 * Queues a layout pass and marks the chart's marks stale, so that pass
 * redraws them even when the plot rectangle has not moved. Every chart state
 * change reaches the drawing through this method — the data and option
 * setters, a bound store's events, a legend toggle, a point selection and a
 * theme change all call it — and a subclass calls it after changing anything
 * its drawing reads.
 *
 * @returns This chart, for method chaining.
 */
scheduleLayout(): this {
    this._paintedPlot = undefined;

    return super.scheduleLayout();
}
```

**`doLayout`** — two edits: pass `origin` to `sizeSurface`, and gate the repaint:

```typescript
this.sizeSurface(inner, origin);
// … reserveLegend, computePlot, buildScales and the three field writes, unchanged …

if (!this.marksCurrentFor(plot)) {
    this.repaint(plot, scales.x, scales.y);
}
```

**`marksCurrentFor`**, a new private method after `repaint`:

```typescript
/**
 * Whether the current marks were drawn for `plot` with no state change since.
 *
 * @param plot - The plot rectangle this pass computed.
 *
 * @returns `true` when the pass may keep every mark.
 */
private marksCurrentFor(plot: PlotRect): boolean {
    const painted = this._paintedPlot;

    return painted !== undefined
        && painted.x === plot.x
        && painted.y === plot.y
        && painted.width === plot.width
        && painted.height === plot.height;
}
```

**`sizeSurface`** — new signature `sizeSurface(inner: { width: number; height: number }, origin: { left: number; top: number }): void`. Delete its own `const origin = this.getPerimeterSize();`. Before the unchanged `DOM.sink.apply(...)`:

```typescript
const last = this._surfaceBox;

if (last && last.width === inner.width && last.height === inner.height && last.left === origin.left && last.top === origin.top) {
    return;
}

this._surfaceBox = { width: inner.width, height: inner.height, left: origin.left, top: origin.top };
```

**`repaint`** — append `this._paintedPlot = plot;` as its last statement, after `drawSelection`. **`clearMarks`** — append `this._paintedPlot = undefined;` after `this._marks.length = 0;`.

The resulting `_paintedPlot` sites are exactly five: the declaration, the override, `marksCurrentFor`, the end of `repaint`, and `clearMarks`.

---

## Ordered Implementation Steps

1. **Baseline.** From the worktree root, run `git rev-parse HEAD` and record it as **BASE_SHA** in this plan's *Implementation Notes*; the in-engine A/B builds its base arm from it. Confirm the dependency has landed: `test -f packages/lib/src/typescript/lib/core/TextMeasure.ts && grep -n "measureTextMetrics" packages/lib/src/typescript/lib/component/chart/ChartAxis.ts` must both succeed — stop and report if not. Run `npm run build:lib`, `npm test`, `npm -w packages/qa run test` and `npm run docs:api`; note every failing QA case and the docs warning list in *Implementation Notes*.
2. **`AbstractChart.ts` — fields.** Add `_surfaceBox` and `_paintedPlot` as in *Internal Structure*.
3. **`AbstractChart.ts` — the override.** Add `scheduleLayout()` above `doLayout`.
4. **`AbstractChart.ts` — `sizeSurface`.** Change its signature, drop its `getPerimeterSize()` call, add the guard. Update its JSDoc: add an `@param origin - The perimeter origin offset.` line and the sentence "Writes nothing when the inner size and origin equal the last write."
5. **`AbstractChart.ts` — `doLayout`, `repaint`, `clearMarks`, `marksCurrentFor`.** Make the edits of *Internal Structure*. Update the JSDoc: `doLayout` ends "…builds the final scales, and redraws the marks when they are not current for the new plot rectangle"; `repaint` gains "and records the plot rectangle the marks were drawn for"; `clearMarks` gains "and forgets the plot rectangle they were drawn for".
6. **`AbstractChart.ts` — class JSDoc** (`:101-121`). Add a paragraph before `@typeParam`: "A layout pass redraws the marks only when the plot rectangle has moved since they were drawn or {@link scheduleLayout} has been called since; a settled pass keeps every mark and writes nothing to the SVG surface. Every built-in state change calls `scheduleLayout()`. A subclass whose drawing reads state of its own — in `buildScales`, `drawSeries`, `pointPixel` or `seriesColor` — calls `scheduleLayout()` after changing it."
   Check: `npm run typecheck`; `grep -n "_paintedPlot" packages/lib/src/typescript/lib/component/chart/AbstractChart.ts` lists the five sites of *Internal Structure* and no other code line; `grep -n "getPerimeterSize()" packages/lib/src/typescript/lib/component/chart/AbstractChart.ts` → one match, in `doLayout`; `grep -n "this.repaint(" packages/lib/src/typescript/lib/component/chart/AbstractChart.ts` → one match, inside the `marksCurrentFor` condition.
7. **Library tests.** Add the `repaint gate` cases of *Expected Behaviour* to `packages/lib/tests/component/chart/Chart.test.ts`. The implement skill may write them before steps 2–6. Check: `npm test` green, the existing cases unchanged.
8. **QA ablations** (`packages/qa/src/harness/ablations.ts:2432-2590`):
   - Add `const CHART_GATED_NOTE = 'no ungated repaint: AbstractChart gates its own';` with a one-line comment.
   - Add `libraryGatesChartRepaint(chartProto: AnyObj): boolean`, returning `Object.hasOwn(chartProto, 'scheduleLayout') && !chartRevisionStamps.has(chartProto.scheduleLayout as object)`. Its JSDoc says why: the stamp would replace the library's own override and break its gate.
   - `chartPrototype(tools)` returns `AnyObj | string`: `'no AbstractChart'` where it returns `null` today, `CHART_GATED_NOTE` when `libraryGatesChartRepaint(proto)` — checked **before** `installChartRevision(proto)` — and the prototype otherwise. Update its `@returns`.
   - In `chartRepaintGate` and `chartMarginMemo`, replace `if (!proto) { return 'no AbstractChart'; }` with `if (typeof proto === 'string') { return proto; }`.
9. **QA ablation tests** (`packages/qa/tests/ablations.test.ts`, `A26` and `A27`, whatever they assert at BASE_SHA). Replace both bodies with the QA cases of *Expected Behaviour*. `A1`, `A2` and `A28` stay as they are.
10. **QA panels.**
    - `packages/qa/src/panels/chart-line.ts:51`: `geometry: { chart, point: '.LineChart circle' },` with a comment: the first series' first marker, a mark the container label cannot see; `update` moves it every unit. Update `build`'s `@returns` to name the `point` probe.
    - `packages/qa/src/panels/chart-dashboard.ts:74`: type the local as `Record<string, GeometryTarget>` (add `GeometryTarget` to the file's existing `import type { HarnessTools } from '../harness/types.js'`) and seed it `{ grid, bars, point0: '.LineChart circle', bar0: '.BarChart rect' }`, with a comment naming both as the first line chart's first marker and the first bar chart's first bar.
11. **QA README** (`packages/qa/README.md`). In *Panels*, the geometry column of `chart-line` (`:320`) becomes `` `chart`, `point` `` and of `chart-dashboard` (`:321`) `` `grid`, `chart0`–`chart3`, `bars`, `point0`, `bar0` ``. In the ablation table (`:484-485`), append to both rows: "Inert on a library whose `AbstractChart` gates its own repaint (from `chart-repaint-gate` on): it notes `no ungated repaint` and patches nothing, so it bounds only an earlier build."
    Check: `npm run build:lib && npm -w packages/qa run typecheck && npm -w packages/qa run test` — green, including `sweep.test.ts`'s `W4`.
12. **Docs.** Make the edits in *Documentation Impact*. Check: `npm run docs:api` shows step 1's warnings and no new one; `npm run lint` clean.
13. **Stop.** Do not run `packages/qa/runqa.sh`, any sweep, MiniBrowser or the Tauri host. The in-engine A/B in *Verification* is the orchestrator's.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/chart/AbstractChart.ts` |
| Modify | `packages/lib/tests/component/chart/Chart.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |
| Modify | `packages/qa/src/harness/ablations.ts` |
| Modify | `packages/qa/tests/ablations.test.ts` |
| Modify | `packages/qa/src/panels/chart-line.ts` |
| Modify | `packages/qa/src/panels/chart-dashboard.ts` |
| Modify | `packages/qa/README.md` |

---

## Expected Behaviour

### `Chart.test.ts`, new `describe('repaint gate')` — unit, node, `installTestDOM(CONFIG)`

Every case lays its chart out with the file's `layout(chart, sink)` helper (400 × 300), then drives further passes as `sink.writes.length = 0; chart.doLayout();`. New imports: `Insets` from `~/primitive/Insets`; `ThemeManager`, `ModernTheme` and `defineTheme` from `~/core/Theme`. Add three helpers: `ops(sink, op)` counts writes with that `op`; `svgOf(chart)` reads `(chart as unknown as { _svg: Handle })._svg`; `surfaceApplies(sink, chart)` returns the `apply` writes whose `args[0]` is `svgOf(chart)`. **M** is `_marks.length` right after `layout`.

Fixtures: **L1** is `new _LineChart({ series: [{ name: 'A', data: [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }] }], showLegend: false })`. **L2** is L1's shape with a second series `{ name: 'B', data: [{ x: 0, y: 2 }, { x: 1, y: 1 }, { x: 2, y: 3 }] }` and `showLegend: true`. **B2** is the file's two-series `_BarChart` fixture.

| # | Case | Expected |
|---|---|---|
| RG1 | L1 and B2, each laid out, then 10 more passes | every later pass: 0 `createElementNS`, `removeChild`, `release` and `appendChild`; 0 surface applies; `_marks.length` still M |
| RG2 | L1, then `setSeries([{ name: 'A', data: [{ x: 0, y: 3 }, { x: 1, y: 1 }, { x: 2, y: 2 }] }])` (same extents), then one pass | `_plot` deep-equals its value before the call; `removeChild` M, `release` M, `createElementNS` M; 0 surface applies |
| RG3 | each trigger below, then two passes | first pass: `createElementNS` > 0; second pass: 0 |
| RG3a | L1: `setSeries(chart.getSeries())` (identical data) | as RG3 |
| RG3b | `store = new MemoryStore(new Model([{ name: 'id', type: 'number' }, { name: 'x', type: 'number' }, { name: 'y', type: 'number' }]), [{ id: 1, x: 0, y: 1 }, { id: 2, x: 1, y: 2 }])`, `await store.load()`, then `new _LineChart({ store, xField: 'x', yField: 'y', showLegend: false })`, laid out; then `store.add({ id: 3, x: 2, y: 5 })` | as RG3 |
| RG3c | L2: `(chart as unknown as { handleLegendToggle(i: number): void }).handleLegendToggle(0)` | as RG3 — the legend's mid-pass `scheduleLayout()` call must not cost a second repaint |
| RG3d | L1: `selectPoint(0, 1)` (protected; reach it the same way) | as RG3; the first pass creates M + 1 marks (the ring) |
| RG3e | L1: `setXAxisLabel('Month')` | as RG3 |
| RG3f | L1: `setShowPoints(false)`, `setCurved(true)`, `setXScaleType('time')`, each in its own run | as RG3 |
| RG3g | B2: `setGrouped(false)` | as RG3 |
| RG4 | L1, then `ThemeManager.setTheme(defineTheme(ModernTheme, { scale: { base: 28 } }))`, then two passes | as RG3. Dispose the chart, then `ThemeManager.setTheme(ModernTheme)`, in a `finally`, as `GlyphIconScale.test.ts` does |
| RG5 | L1, then `setWidth(401)`, one pass | `createElementNS` M; exactly one surface apply, whose `setAttr.width` is `String(chart.getInnerSize()!.width)` |
| RG6 | L1 built with `insets: new Insets(0, 0, 0, 0)`; record `getInnerSize()` and `getPerimeterSize().left`; then `setInsets(new Insets(5, 5, 5, 5))`, `setWidth(410)`, `setHeight(310)`, one pass | `getInnerSize()` equals the recorded value; 0 `createElementNS`; exactly one surface apply, whose `style.left` is `` `${recordedLeft + 5}px` `` |
| RG7 | a test subclass `class TintChart extends _LineChart { tint = 'red'; protected seriesColor(): string { return this.tint; } }` with L1's options: after layout, `chart.tint = 'blue'` and one pass; then `chart.scheduleLayout()` and one pass | first pass: 0 `createElementNS`, and no `apply` patch has `style.stroke === 'blue'`; second pass: `createElementNS` M, and the path's patch has `style.stroke === 'blue'` |
| RG8 | L1 laid out, one more (kept) pass, then `chart.dispose()` | `_marks.length` 0; `release` ops during `dispose` ≥ M |

The existing *steady-state layout stability* case (`Chart.test.ts:384`) must pass unchanged: a settled pass calls `scheduleLayout` zero times, so the override never marks a settled chart stale.

### `packages/qa/tests/ablations.test.ts` — unit, jsdom

| # | Case | Expected |
|---|---|---|
| A26 | mount `chart-line` at `CHART_SCALE`; `apply('chart.repaint-gate')`; `installSeamCounters(DOM)`; `chart.doLayout()`; then one `seamCountedLayout(chart)`; then `update(0)` and another | the note matches `/^no ungated repaint/`; the kept pass's `seam.sink.createElementNS ?? 0` is 0; the pass after `update(0)` has `createElementNS` > 0; no `skipped.chart.repaint-gate.*` counter in either |
| A27 | the same with `apply('chart.margin-memo')`, recording `Object.getOwnPropertyDescriptor(<the AbstractChart prototype>, 'scheduleLayout')!.value` before the apply (reach the prototype through `Object.getPrototypeOf` from the chart until `Object.hasOwn(proto, 'scheduleLayout')`) | the note matches `/^no ungated repaint/`; the descriptor's value is unchanged after the apply; no `memo.chart.margin-memo.*` counter; the pass after `update(0)` has `createElementNS` > 0 |

### Manual — in-engine (the orchestrator)

Geometry `=` for every labelled rectangle, the new mark labels included, and the counts and savings of *Expected readings*, below. Nothing offline can show that a kept mark sits where a redrawn one would: the offline sink records writes, not pixels.

---

## Verification

1. `npm run typecheck`, `npm -w packages/lib run typecheck:test`, `npm test`, `npm run lint`.
2. `npm run build:lib`, then `npm -w packages/qa run typecheck` and `npm -w packages/qa run test`.
3. `npm run docs:api`: step 1's warnings and no new one.
4. The greps of step 6.

### In-engine A/B — the orchestrator runs this, never the implementer

Every run opens a full-screen window; run it only with the user's go-ahead. From the root of the checkout that holds the fix, so both arms load the same page, with the new mark labels:

```sh
git worktree add .worktrees/_crg-base <BASE_SHA> --detach
ln -sfn "$PWD/node_modules" .worktrees/_crg-base/node_modules
(cd .worktrees/_crg-base/packages/lib && npm run build:lib)
export QA_WT_LIB="$PWD/.worktrees/_crg-base/packages/lib"
npm run build:lib
```

Then this script, saved outside the repository and run from the repository root. The cells are the five W3.0 cells that bounded F26.1 and F26.2 (batch `b09`):

```bash
#!/bin/bash
# chart-repaint-gate in-engine A/B: the base build (wt) against the fix (main),
# one session. Each cell runs base-a, fix-1, base-b, fix-2, base-c: the base arm
# at both ends, each arm's runs symmetric about the cell's centre, so a linear
# drift cancels. Every run opens a full-screen window.
set -u
RUNQA=packages/qa/runqa.sh
SESSION=${CRG_SESSION:-s1}
FLAGS='work=1&seam=1&geom=1'

wtab() {
    local cell=$1 params=$2 step build arm rep

    for step in wt:base:a main:fix:1 wt:base:b main:fix:2 wt:base:c; do
        IFS=: read -r build arm rep <<< "$step"
        "$RUNQA" "crg$SESSION-$cell-$arm-$rep" "$build" "$params&$FLAGS" || exit 1
    done
}

wtab clq 'panel=chart-line&drive=passes'
wtab cdq 'panel=chart-dashboard&n=50&drive=passes'
wtab clu 'panel=chart-line&drive=update'
wtab cdu 'panel=chart-dashboard&n=50&drive=update'
wtab cdd 'panel=chart-dashboard&n=50&drive=drag'
```

25 runs, about 7 minutes. A stopped script is re-run for the failing cell under a new `CRG_SESSION`. Afterwards, `git worktree remove --force .worktrees/_crg-base`.

**Reading a cell.** `python3 packages/qa/bin/qa-table.py packages/qa/results crgs1-<cell>- --seam`. The first row, `base-a`, is the geometry reference. **bracket** is the largest minus the smallest `avg` of the three `base` rows; **Δms** is the mean of the two `fix` rows minus the mean of the three `base` rows; `win` is Δms < −bracket and `regress` is Δms > +bracket. `qa-ab.py` does not apply: it scores ablation arms.

**Expected readings.** The base column is orientation only — the nearest W3.0 arm, since the base arm carries `text-measurement-without-reflow`. The count columns are per unit and exact, because the fix removes a fixed set of calls from each chart pass and leaves the rest of the pass alone.[^readings]

| Cell | Phase | Base ms | Fix ms | `createElementNS` base → fix | `apply`, fix − base | Other |
|---|---|---|---|---|---|---|
| `clq` | passes | ≈ 2.6 | ≤ 2.4 | 210 → 0 | −211 | `removeChild`, `release`, `appendChild` 210 → 0 |
| `cdq` | passes | ≈ 11.2 | ≤ 9.1 | 840 → 0 | −844 | the same three 840 → 0 |
| `clu` | update | ≈ 65 | flat | equal (≈ 208.6) | ≈ −1.0 | every other sink counter equal |
| `cdu` | update | ≈ 66 | flat | equal (≈ 208.6) | ≈ −1.0 | every other sink counter equal |
| `cdd` | drag | ≈ 76 | flat | equal (≈ 1006) | equal | every sink counter equal within 1% |

**Pass criteria:**

1. **Geometry `=` on every row of every cell**, `point`, `point0` and `bar0` included. This is the gate; any `DIFF` fails the change, whatever the timing.
2. **Engaged:** `clq` and `cdq` fix rows read `createElementNS` 0 — at most 1.4 and 5.6, one repaint in the phase, if a late font settle reached the chart.
3. **No repaint suppressed:** `clu`, `cdu` and `cdd` fix rows read `createElementNS` equal to their base rows within 1%.
4. **The surface guard:** the `apply` differences of the table.
5. **Timing:** `cdq` reads `win`. `clq` reads `win` or `flat`; its gain is small against its bracket, and criterion 2 is its verdict. No cell reads `regress`.
6. **F26.2 subsumed:** `seam.source.measureText` reads ≈ 0 per unit on both arms of every cell. A base arm reading ≈ 12 per chart pass (64 per `cdd` unit) means BASE_SHA lacks `text-measurement-without-reflow`: the A/B is void; rebuild the base arm from a commit that has it.

Record the readings in `plans/research/render-review-2026-09-15/` and add them to the two chart rows' *Validated* cells in `packages/qa/README.md`.

---

## Documentation Impact

- **`AbstractChart.ts` JSDoc** — the class paragraph of step 6, the override's JSDoc, and the four method JSDoc edits of steps 4–5. Public JSDoc names `repaint`, `clearMarks` and the subclass hooks only in prose, never as `{@link}` (`CODE_CONVENTIONS.md`); `{@link scheduleLayout}` is public and fine.
- **`packages/lib/docs/reference/changelog/next.md`**, *Breaking changes → Components* (`:22`), a new last bullet: "**A chart redraws its marks only when its plot rectangle moves or its state changes.** A settled layout pass — a parent re-laying out a chart whose size and data are unchanged — used to remove and re-create every axis, gridline, label and series mark, and to rewrite the SVG surface's size attributes; it now keeps them and writes nothing to the SVG. A state change is announced by `scheduleLayout()`, which every built-in setter, store event, legend toggle, selection and theme change already calls. A custom `AbstractChart` subclass that changes something its drawing reads without calling `scheduleLayout()` no longer sees that change drawn on the next pass. See [Migration](/reference/migration/next) for the full note."
- **`packages/lib/docs/reference/migration/next.md`**, a new last section, `## A chart redraws only when its plot moves or \`scheduleLayout()\` runs`:
  - **What changed and why.** The first two sentences of the changelog entry, plus the cost: a settled 3-series × 50-point line chart rebuilt 210 elements per pass.
  - **Who needs to act.** Only a subclass of `AbstractChart`, `LineChart` or `BarChart` whose `buildScales`, `drawSeries`, `pointPixel` or `seriesColor` reads state the subclass changes itself. Such a change used to appear on whatever pass came next; it now appears only when the chart is next resized or `scheduleLayout()` runs. Call `this.scheduleLayout()` after the change, as `LineChart.setCurved` does. Calling `doLayout()` directly does not replace it.
  - A before/after block:

    ```typescript
    // Before — the colour change appeared on whatever pass came next
    class AlertChart extends LineChart {
        private _alert = false;

        setAlert(alert: boolean): this {
            this._alert = alert;

            return this;
        }

        protected seriesColor(index: number, model: ChartSeriesModel): string {
            return this._alert ? "red" : super.seriesColor(index, model);
        }
    }

    // After — announce the change, as the built-in setters do
    setAlert(alert: boolean): this {
        this._alert = alert;
        this.scheduleLayout();

        return this;
    }
    ```
- **`packages/qa/README.md`** — the rows of step 11. `llms.txt`, the chart component pages and `docs/concepts/*` need no change: no symbol, option or consumer-visible behaviour other than the subclass contract moves.

---

## Potential Challenges

- **`text-measurement-without-reflow` may have left `A27` failing.** After its memo, a data update with unchanged tick labels measures nothing, which the old `A27`'s last assertion forbids. Step 9 replaces `A27` whatever state it is in; record the inherited failure in step 1.
- **A W3.0 chart ablation applied on a gated library.** Without step 8, its stamp would silently replace the override. Steps 2–6 and step 8 ship on the same branch, and the new A26/A27 cases pin the pairing.
- **Another plan edits `AbstractChart.ts` first** (G20's registrant narrowing, a later G09 opt-in). The line numbers here then drift; every edit is also named by its symbol.
- **One repaint during a `passes` phase in the engine.** A font batch settling after mount calls the theme listeners, and so `scheduleLayout()`. Criterion 2 allows one repaint per phase.
- **Kept marks alias `_plot`.** `_paintedPlot` holds the same object `doLayout` stores in the protected `_plot`. Nothing mutates it: `computePlot` returns a fresh object each pass and every reader only reads.

---

## Critical Files

- [`component/chart/AbstractChart.ts`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts) — `doLayout` (`:574`), `sizeSurface` (`:606`), `reserveLegend` (`:625`), `computePlot` (`:689`), `repaint` (`:715`), `clearMarks` (`:836`), `destructor` (`:1081`), and the nine `scheduleLayout()` calls (`:194`, `:249`, `:323`, `:398`, `:422`, `:446`, `:470`, `:921`, `:1016`).
- [`component/diagram/DiagramView.ts:1739-1788`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1739) — the precedent: `doLayout` → `anchorCentreAcrossResize`, a last-size compare with an early return.
- [`component/container/ScrollStrip.ts:522`](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L522) — `layoutItems`' clamp signature, the same compare on two cached extents.
- [`component/input/Text.ts:151`, `:557`](packages/lib/src/typescript/lib/component/input/Text.ts#L557) — `_measurementDirty` and `needsMeasure`, the stale-flag precedent.
- [`core/Component.ts:7915`](packages/lib/src/typescript/lib/core/Component.ts#L7915) — `scheduleLayout`, the method overridden; `:7209` `wireChild`, whose relay calls the chart's `scheduleLayout()` mid-pass; `:7774`, where `doLayout` clears `_layoutDirty`.
- [`component/chart/LineChart.ts`](packages/lib/src/typescript/lib/component/chart/LineChart.ts) and [`BarChart.ts`](packages/lib/src/typescript/lib/component/chart/BarChart.ts) — `buildScales` (range from the plot alone) and the setters that call `scheduleLayout()`.
- [`component/chart/ChartLegend.ts:173`](packages/lib/src/typescript/lib/component/chart/ChartLegend.ts#L173) — `setEntries` and its `entriesEqual` guard.
- [`core/DOM.ts:381`, `:443`](packages/lib/src/typescript/lib/core/DOM.ts#L443) — the seam's style compare and its uncompared `setAttr` loop.
- [`tests/component/chart/Chart.test.ts`](packages/lib/tests/component/chart/Chart.test.ts) — the `layout` helper and the steady-state case; [`tests/dom/TestDOM.ts:450`](packages/lib/tests/dom/TestDOM.ts#L450), `RecordingDOMSink`.
- [`plans/text-measurement-without-reflow.md`](plans/text-measurement-without-reflow.md) — the dependency, and its *What the memo covers, for `chart-repaint-gate`* decision.
- [`packages/qa/src/harness/ablations.ts:2432-2590`](packages/qa/src/harness/ablations.ts#L2432) — the two chart ablations; [`packages/qa/tests/ablations.test.ts:995-1052`](packages/qa/tests/ablations.test.ts#L995) — A26 and A27; [`packages/qa/src/harness/probes.ts:69`](packages/qa/src/harness/probes.ts#L69) — how a selector label is sampled.

---

## Non-Goals

- **A chart-side margin memo or measurement batching (F26.2).** Subsumed by `text-measurement-without-reflow`; see *F26.2 is subsumed*. `ChartAxis.ts` is untouched.
- **Updating marks in place (F26.1's second lever).** A resize or data frame still rebuilds every mark. W3.0 did not bound it, and it rewrites the mark-census tests.
- **F26.5, the legend laid out twice per pass.** Unbounded by W3.0, and it changes who owns the legend's layout.
- **F26.6, a hidden chart repainting on a data or theme change.** Unbounded by W3.0; a hidden chart behaves as today.
- **F26.4, the hover path, and F26.10's unread hit-test attributes.** Separate findings; neither changes whether a pass repaints.
- **Same-value guards on the chart setters.** They have no runtime caller, and the guard pattern is G07's.
- **Opting `AbstractChart` into `canSkipUnchangedLayout`.** `unchanged-commit-opt-ins` defers every `Panel` subclass to its own audit; the gate stands without it.
- **A seam-wide same-value filter for attributes.** An attribute write can carry a side effect a same-value check would suppress, and the codebase guards attribute writes at their owner.[^surface]
- **Removing the W3.0 chart ablations.** `sweeps/w3-0.sh` names them; they turn inert instead.

---

## Notes

[^precedent]: `DiagramView` keeps the viewport size its last pass saw in `_lastViewportWidth` / `_lastViewportHeight` (`DiagramView.ts:435-436`) and does nothing when the new size equals it. `ScrollStrip.layoutItems` keeps the two extents its scroll clamp depends on (`_lastClipExtent`, `_lastItemsExtent`, `:191`, `:196`) and reads nothing when neither moved. Both compare values the pass already computed, with no DOM read. A size compare alone would suppress data repaints, so the state half follows `Text`: its setters set `_measurementDirty`, and its next size read re-measures when that flag is set. The W3.0 ablation used the same two halves — a size signature and a revision bumped by `scheduleLayout()`.

[^signature-complete]: `repaint` reads only its three arguments, `_series`, `_selectedPoint`, the two axis-title options and, through the subclass hooks, the subclass's own options. Both scales are rebuilt every pass from the plot rectangle and the visible points, and both subclasses derive each scale's pixel range from the plot alone (`LineChart.buildScales`, `BarChart.buildScales`). So the marks are a function of the plot rectangle and the chart's state. Every state write goes through a setter, a store event, the legend-toggle handler or `selectPoint`, and each ends in `scheduleLayout()`: the thirteen call sites W3.0's ablation stamped (`AbstractChart.ts:194`, `:249`, `:323`, `:398`, `:422`, `:446`, `:470`, `:921`, `:1016`; `LineChart.ts:142`, `:166`, `:190`; `BarChart.ts:70`). Hover writes no state: `handlePointerMove` and `handlePointerOut` only show or hide the tooltip. Tick labels are d3's `tickFormat` output under d3's default locale, which the library never sets (no `formatDefaultLocale` or `timeFormatDefaultLocale` call anywhere in `packages/lib/src`), so they follow the domain. The ablation's `update` check cells confirm it in the engine: it never engaged on a data update, and the element counts matched.

[^schedule-override]: Three alternatives were rejected. An explicit protected `invalidateMarks()` would need every built-in setter changed, and would leave `scheduleLayout()` — the call a subclass setter makes today — silently insufficient. Reading `isLayoutDirty()` before `super.doLayout()` would reuse a flag that `Component.doLayout` clears at the start of the pass (`Component.ts:7774`); the legend's rows, rebuilt later in that pass, call `scheduleLayout()` and set it again, which would cost a second repaint after every legend change, and `invalidateLayout()` and `markPassOwedAbove()` set it for layout bookkeeping unrelated to drawing. A full value signature of the data and every option would need a hook each subclass extends for its own options. The override does mark the drawing stale on a few calls that change no mark: being shown again (`Panel.onEffectiveVisibilityChange`), a child added or removed, `setSize`. Each is rare, and a settled pass makes none of them, which `Chart.test.ts`'s steady-state case pins.

[^clear-at-paint]: `reserveLegend` runs before `repaint` in the same pass. When the legend's entries change, `ChartLegend.setEntries` rebuilds its rows, and the rows' preferred-size relay (`Component.wireChild`, `Component.ts:7212`) calls the chart's `scheduleLayout()` in the middle of the pass. `reserveLegend` then reads the legend's new preferred size, so this pass's repaint already reflects the change. Recording the plot at the end of `repaint` absorbs that mid-pass call, and the follow-up pass the relay queued keeps the marks (case RG3c). Clearing at the start of the pass would leave the relay's mark standing and repaint twice. Recording after drawing also means a draw that throws — a subclass bug — is retried on the next pass, as today, instead of leaving half-drawn marks recorded as current.

[^plot-every-pass]: The plot rectangle depends on text metrics: the axis margins and the legend's width both come from measured text. Recomputing it every pass lets a metrics change the chart was never told about — an app calling `Util.invalidateTextMetricsCache()` after its own typography change, as `text-measurement-without-reflow` documents — still move the plot and so redraw. Skipping `computePlot` as well would need the chart to track the text-metrics generation. After that plan, the recompute makes no seam call, and W3.0 shows the remaining tick and format work costs nothing measurable: the `chart.margin-memo` arm, which skipped all of it, read the same as `g18.measure-memo`, which skipped only the measurement (2.60 against 2.65 ms on `clq`, 11.22 against 11.25 ms on `cdq`). The scales are rebuilt for the same reason, and because `LineChart.resolveHit` reads `_xScale` and `_yScale` on every pointer move.

[^surface]: `ProductionDOMSink.apply` skips an inline-style write whose value is already in place (`writeDeclaration`, `core/DOM.ts:381`), but calls `setAttribute` for every `setAttr` entry with no comparison (`applyPatchTo`, `:443`). So every pass wrote the SVG's `width`, `height` and `viewBox` again: three attribute writes per chart per pass, twelve on the dashboard's grid. A seam-wide same-value filter for attributes was not chosen. An attribute write can have a side effect a same-value check would suppress — a same-value `src` write reloads an `<iframe>` — and the codebase guards attribute writes at their owner instead (`Aria.setAttribute`, `core/Aria.ts:797`). Passing `origin` in removes one of the three `getPerimeterSize()` calls slice 26 counted per chart pass (F26.5).

[^f26-2]: `text-measurement-without-reflow` moves `measureAxisMargin`'s two measurement calls onto its measurement layer (its step 8) and draws the boundary itself: after it, a repeated `measureAxisMargin` makes no seam call, and the tick and format work above the measurement is left to this plan. Its memo keys on the text and font rather than on the domain, with the same effect: an unchanged domain yields the same tick strings, so every lookup hits. A new domain is measured on a canvas, with no document layout, which covers F26.2's batching half — batching mattered only because each probe forced a layout. W3.0 measured no gap between a chart-side memo and the general one (2.60 against 2.65 ms on `clq`, 11.22 against 11.25 ms on `cdq`). The one saving W3.0 credited to F26.2 alone is the dashboard drag frame (90.7 → 76.0 ms, `measureText` 64 → 0.43 per unit); criterion 6 checks its counter on both arms. A font the canvas cannot reproduce still probes once per new label, one call at a time; that fallback belongs to the measurement layer and applies equally to every `Text`.

[^key-fields]: The ablation's key also carried both scales' domain and range as strings. With the stale mark in the key, those fields decide nothing: the domain is a function of the visible points and the scale options, which are state, and the range is a function of the plot. Dropping them saves four array-to-string conversions per chart pass.

[^ablation-inert]: Both W3.0 chart ablations install a revision stamp as an own `scheduleLayout` on `AbstractChart.prototype`, delegating to `Panel`'s. On a library with this plan's override, the stamp would replace the override; the stale mark would then never be set, and the library's gate would keep outdated marks through data changes — the ablation would break the fix it bounded. Deleting the ablations would break `packages/qa/sweeps/w3-0.sh`, whose batch `b09` names them and whose sweep test `W4` requires every named ablation to be registered. An inert ablation with a `no …` note — the convention `A2` reads for an absent target — keeps the record runnable against an earlier build, where both still install.

[^mark-labels]: A geometry label is sampled with `document.querySelector` and `getBoundingClientRect` (`packages/qa/src/harness/probes.ts:69-79`), once per unit. A marker's rectangle depends on the data and the plot, so a repaint the fix wrongly skipped shows as a geometry `DIFF` against the base arm in that unit. `chart-line`'s `update` moves the first point between y 0 and y 1 every unit (`UPDATE_SHIFT`, `chart-line.ts:14`), so `point` moves every unit there. `point0` and `bar0` move with every `drag` frame. The dashboard's `update` changes one record per unit in a rotating chart, which a first-marker label rarely sees; there the mark census — `createElementNS` equal to the base arm — is the gate, as in W3.0's check cells. The selectors match the chart's own class name, which every rendered component carries, as `table-rows` already relies on (`'.TableBody .StringCell'`).

[^breaking]: Pre-1.0, a behaviour change ships with a changelog entry and a migration note. The affected code is narrow: a subclass that changes something its drawing reads and relies on an unrelated pass to draw it. No library subclass does — every `LineChart` and `BarChart` setter calls `scheduleLayout()` — and the repository has no consumer subclass.

[^readings]: On the base arm, an unchanged chart pass issues 1,081 sink calls: 210 each of `removeChild`, `release`, `createElementNS` and `appendChild`, and 241 `apply` — 210 for the marks, 1 for the surface, 30 for the rest of the pass (W3.0 `clq` plain). A kept pass on the fix makes only those 30, so each unchanged chart pass reads 1,051 fewer sink calls, 211 of them `apply`; the dashboard grid holds four charts. A data update keeps the redraw and drops only the surface write, about one `apply` per unit. Every drag frame resizes every chart, so nothing is kept there. The rest of each pass is unchanged, so these differences hold whatever else has merged into both arms. The millisecond targets are W3.0's gate arm, which still paid 12 probe measurements per chart pass on a clean document; the fix pays none, so it should land at or below them.
