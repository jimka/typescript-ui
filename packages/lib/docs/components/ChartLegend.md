# ChartLegend

[`ChartLegend`](/api/component/chart/classes/ChartLegend) is the clickable legend the chart family renders beside the plot: one row per series (a colour swatch plus the series name). A click on a row emits `"toggle"(seriesIndex)` so the owning chart can hide or show that series and repaint.

It is composed from existing components — an `HBox`/`VBox` [`Panel`](/api/core/classes/Panel) of per-entry rows, each an `HBox` of a swatch and a [`Text`](/api/component/input/classes/Text) — rather than a specialised component. [`LineChart`](/components/LineChart) and [`BarChart`](/components/BarChart) create and drive one internally, so you rarely construct it directly; it is public for custom chart chrome.

## Usage

```typescript
import { ChartLegend } from '@jimka/typescript-ui/component/chart';

const legend = ChartLegend({
    orientation: 'vertical',
    entries: [
        { name: 'North', color: 'var(--ts-ui-chart-series-1)' },
        { name: 'South', color: 'var(--ts-ui-chart-series-2)', hidden: true },
    ],
    listeners: { toggle: (i) => console.log('toggled series', i) },
});
```

## Construction

`ChartLegend(options?)` — `new ChartLegend({ … })` and the callable form are interchangeable.

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `entries` | `ChartLegendEntry[]` | `[]` | The rows to render (`name`, `color`, optional `hidden`). |
| `orientation` | `"vertical"` \| `"horizontal"` | `"vertical"` | Stack the entries (right dock) or lay them in a row (top/bottom dock). |
| `listeners.toggle` | `(seriesIndex: number) => void` | — | Fired when a row is clicked. |

A hidden entry renders dimmed. Colours are usually the palette bindings (`var(--ts-ui-chart-series-N)`) the owning chart resolves per series; see [Theming](/concepts/theming#chart-tokens).

## Common methods

| Method | Purpose |
| --- | --- |
| `setEntries(entries)` / `getEntries()` | Replace / read the rows. |
| `setOrientation(o)` / `getOrientation()` | Switch the arrangement direction. |
| `on("toggle", fn)` / `off("toggle", fn)` | Subscribe to row clicks. |

## See also

- [API: ChartLegend](/api/component/chart/classes/ChartLegend)
- [`LineChart`](/components/LineChart), [`BarChart`](/components/BarChart) — the charts that own a legend.
