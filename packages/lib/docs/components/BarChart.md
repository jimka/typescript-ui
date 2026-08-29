# BarChart

[`BarChart`](/api/component/chart/classes/BarChart) plots one or more series as bars over a discrete category (band) x axis and a linear y axis. Multiple series are drawn side by side (grouped) or stacked.

Like every chart in the family it is a [`Panel`](/api/core/classes/Panel) hosting a single `<svg>` surface built through the framework DOM sink. The band/linear scales come from the pure `d3-scale` submodule; the bar rectangles are hand-computed from the band scale (d3-shape adds nothing to axis-aligned rectangles). All rendering, layout, interaction, and theming stay native.

<!-- demo: barchart-grouped -->
> **Live demo** — an in-memory, grouped `BarChart` over two product series,
> with a hover tooltip.
> [Open the BarChart page](https://jimka.github.io/typescript-ui/components/BarChart)
<!-- /demo -->

## Usage

```typescript
import { BarChart } from '@jimka/typescript-ui/component/chart';

panel.addComponent(BarChart({
    series: [
        { name: 'Widgets', data: [{ x: 1, y: 12 }, { x: 2, y: 19 }, { x: 3, y: 15 }] },
        { name: 'Gadgets', data: [{ x: 1, y: 9 },  { x: 2, y: 14 }, { x: 3, y: 20 }] },
    ],
    grouped: true,
}));
```

Each point's `x` is the category it belongs to; the distinct `x` values across the visible series become the axis categories (ascending). A `BarChart` binds to a [`Store`](/api/data/classes/Store) exactly like [`LineChart`](/components/LineChart) — see [Data binding](/concepts/data-binding#charts).

## Construction

`BarChart(options?)` — `new BarChart({ … })` and the callable form are interchangeable.

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `series` | `ChartSeries[]` | — | In-memory data (mutually exclusive with `store`). |
| `store` | `Store` | — | Store supplying the data (with the field options below). |
| `xField` / `yField` | `string` | `"x"` / `"y"` | Record fields read for each point. |
| `seriesField` | `string` | — | Record field whose distinct values split the records into series. |
| `grouped` | `boolean` | grouped when >1 series | Side-by-side grouped bars (`true`) vs stacked (`false`). |
| `showLegend` | `boolean` | `true` | Show the clickable legend. |
| `legendPosition` | `"top"` \| `"right"` \| `"bottom"` | `"right"` | Legend dock edge. |
| `xAxisLabel` / `yAxisLabel` | `string` | — | Optional axis titles. |
| `listeners.selection` | `(e: ChartSelectionEvent) => void` | — | Fired when a bar is clicked. |

Inherits the common [`PanelOptions`](/api/core/interfaces/PanelOptions) fields; the default preferred size is 400×300.

## Interaction

- **Hover** a bar to show a tooltip with its series and value.
- **Click** a legend entry to hide/show that series and repaint.
- **Click** a bar to select it (a selection ring is drawn at its top) and fire the `"selection"` event.

## Theming

Bars take their fill from the categorical palette (`--ts-ui-chart-series-1 … -8`) by series index unless a series sets an explicit `color`. Axes, gridlines, and labels bind the shared `--ts-ui-chart-*` variables, so a theme switch recolours with no reload. See [Theming](/concepts/theming#chart-tokens).

## Common methods

| Method | Purpose |
| --- | --- |
| `setSeries(series)` / `getSeries()` | Replace / read the in-memory series. |
| `setStore(store, xField, yField, seriesField?)` / `getStore()` | Bind / read the store. |
| `setGrouped(value)` / `isGrouped()` | Grouped vs stacked bars. |
| `setShowLegend(value)` / `isShowLegend()` | Toggle the legend. |
| `setLegendPosition(pos)` / `getLegendPosition()` | Move the legend. |
| `on("selection", fn)` / `off("selection", fn)` | Subscribe to bar selection. |
| `dispose()` | Unbind the store and remove the theme/interaction listeners. |

## See also

- [API: BarChart](/api/component/chart/classes/BarChart)
- [`LineChart`](/components/LineChart) — line/time series.
- [`ChartLegend`](/components/ChartLegend) — the shared legend component.
