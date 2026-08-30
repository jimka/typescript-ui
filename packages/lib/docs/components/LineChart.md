# LineChart

[`LineChart`](/api/component/chart/classes/LineChart) plots one or more series as lines over a linear or time x axis and a linear y axis, with optional point markers.

Like every chart in the family it is a [`Panel`](/api/core/classes/Panel) whose root `<div>` hosts a single `<svg>` drawing surface built entirely through the framework DOM sink — axes, gridlines, and marks are SVG elements, never `innerHTML`. The computational layer (scales, nice-number ticks, tick formatting, and the path `d` string) delegates to the pure `d3-scale` / `d3-shape` / `d3-array` submodules; all rendering, layout, interaction, and theming stay native.

<!-- demo: linechart-store -->
> **Live demo** — a store-bound `LineChart` over two regional sales series,
> with legend entries that toggle each series.
> [Open the LineChart page](https://jimka.github.io/typescript-ui/components/LineChart)
<!-- /demo -->

## Usage

### In-memory series

```typescript
import { LineChart } from '@jimka/typescript-ui/component/chart';

panel.addComponent(LineChart({
    series: [
        { name: 'North', data: [{ x: 1, y: 30 }, { x: 2, y: 45 }, { x: 3, y: 38 }] },
        { name: 'South', data: [{ x: 1, y: 20 }, { x: 2, y: 28 }, { x: 3, y: 50 }] },
    ],
    curved: true,
}));
```

### Store-bound

Bind a [`Store`](/api/data/classes/Store) and name the record fields; a `seriesField` splits the records into one series per distinct value. The chart rebuilds itself on `load` / `add` / `remove` / `datachange`. See [Data binding](/concepts/data-binding#charts).

```typescript
LineChart({
    store,
    xField: 'month',
    yField: 'sales',
    seriesField: 'region',
});
```

## Construction

`LineChart(options?)` — `new LineChart({ … })` and the callable form are interchangeable.

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `series` | `ChartSeries[]` | — | In-memory data (mutually exclusive with `store`). |
| `store` | `Store` | — | Store supplying the data (with the field options below). |
| `xField` / `yField` | `string` | `"x"` / `"y"` | Record fields read for each point. |
| `seriesField` | `string` | — | Record field whose distinct values split the records into series. |
| `showPoints` | `boolean` | `true` | Draw a circle marker at each point. |
| `curved` | `boolean` | `false` | Smooth the line with a monotone curve vs straight segments. |
| `xScaleType` | `"linear"` \| `"time"` | `"linear"` | Continuous number axis, or a time axis (millisecond-epoch `x`). |
| `showLegend` | `boolean` | `true` | Show the clickable legend. |
| `legendPosition` | `"top"` \| `"right"` \| `"bottom"` | `"right"` | Legend dock edge. |
| `xAxisLabel` / `yAxisLabel` | `string` | — | Optional axis titles. |
| `listeners.selection` | `(e: ChartSelectionEvent) => void` | — | Fired when a point is clicked. |

Inherits the common [`PanelOptions`](/api/core/interfaces/PanelOptions) fields. The default preferred size is 400×300 with a small minimum, so the chart fits and fills whatever a layout manager assigns.

## Interaction

- **Hover** a point to show a tooltip with its series and value; hovering the line itself (no marker) shows a series-level tooltip. Moving off hides the tooltip.
- **Click** a legend entry to hide/show that series (the chart repaints); click again to restore it.
- **Click** a point to select it (a selection ring is drawn) and fire the `"selection"` event.

Point markers are the per-point hit targets, so with `showPoints: false` a series stays hoverable at the series level (via its line) but has no per-point selection. Leave `showPoints` on (the default) for point-level hover and selection.

## Theming

Series colours come from the theme's categorical palette (`--ts-ui-chart-series-1 … -8`), cycling by series index unless a series sets an explicit `color`. Axes, gridlines, labels, and the selection ring bind their own `--ts-ui-chart-*` variables, so a light/dark theme switch recolours the plot with no reload. See [Theming](/concepts/theming#chart-tokens).

## Common methods

| Method | Purpose |
| --- | --- |
| `setSeries(series)` / `getSeries()` | Replace / read the in-memory series. |
| `setStore(store, xField, yField, seriesField?)` / `getStore()` | Bind / read the store. |
| `setShowPoints(value)` / `isShowPoints()` | Toggle point markers. |
| `setCurved(value)` / `isCurved()` | Toggle line smoothing. |
| `setXScaleType(value)` / `getXScaleType()` | Switch the x-axis kind. |
| `setShowLegend(value)` / `isShowLegend()` | Toggle the legend. |
| `setLegendPosition(pos)` / `getLegendPosition()` | Move the legend. |
| `on("selection", fn)` / `off("selection", fn)` | Subscribe to point selection. |
| `dispose()` | Unbind the store and remove the theme/interaction listeners — call before discarding a dynamically-built chart. |

## See also

- [API: LineChart](/api/component/chart/classes/LineChart)
- [`BarChart`](/components/BarChart) — categorical bars.
- [`ChartLegend`](/components/ChartLegend) — the shared legend component.
