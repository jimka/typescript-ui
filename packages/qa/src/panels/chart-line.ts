import { LineChart } from '@jimka/typescript-ui/component/chart';
import type { ChartSeries } from '@jimka/typescript-ui/component/chart';
import { lineSeriesPoints, Y_SPAN } from '../builders/data.js';
import type { HarnessTools } from '../harness/types.js';
import type { PanelBuild } from '../panels.js';

// The data rule in `lineSeriesPoints` fixes the chart's mark census, so it
// must not change without re-validating the panel.

/** F26.1's chart had 3 series. */
const SERIES_COUNT = 3;

/** How far `update`'s second data set shifts every y: one step, wrapped into [0, Y_SPAN), so every mark moves and the range stays the same. */
const UPDATE_SHIFT = 1;

export const description = 'Three-series LineChart with legend and point markers, n points per series. Reproduces slice 26 F26.1 (fixed: a chart rebuilt every SVG mark per layout pass, and now keeps them while its plot and state are unchanged): at n = 50, 1,081 sink calls and 210 elements rebuilt per unchanged pass before the fix, and no element rebuilt after.';

/** F26.1's scale: 50 points per series. */
export const defaultScale = 50;

/** The window-resize stand-in: the chart re-laid out at a new width every frame. */
export const defaultDrive = 'resize';

/**
 * Builds a 3-series `LineChart` of `n` points per series, x = 0…n-1.
 *
 * @param n - Points per series.
 * @returns The chart as root, target of `resize` and `passes`; `update`, which swaps between two data sets; the `chart` and `point` geometry probes; and an `afterMount` giving `hover` the chart's element.
 */
export function build(n: number): PanelBuild {
    const series: ChartSeries[] = Array.from({ length: SERIES_COUNT }, (_, s) => ({ name: `Series ${s + 1}`, data: lineSeriesPoints(s, n) }));

    const shifted: ChartSeries[] = series.map((s) => ({
        name: s.name,
        data: s.data.map((p) => ({ x: p.x, y: (p.y + UPDATE_SHIFT) % Y_SPAN })),
    }));

    // Legend and markers pinned on, axis titles left off: each changes the mark census.
    const chart = LineChart({ series, showLegend: true, showPoints: true });

    return {
        root: chart,
        targets: {
            resize: chart,
            passes: chart,
            update: (index: number): void => {
                chart.setSeries(index % 2 === 0 ? shifted : series);
            },
        },
        afterMount: (tools: HarnessTools): Record<string, unknown> => ({ hover: { element: tools.elementOf(chart), axis: 'x' } }),
        // `point` is the first series' first marker, a mark the container
        // label cannot see; `update` moves it every unit.
        geometry: { chart, point: '.LineChart circle' },
    };
}
