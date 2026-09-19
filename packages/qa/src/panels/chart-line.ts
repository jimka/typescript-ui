import { LineChart } from '@jimka/typescript-ui/component/chart';
import type { PanelBuild } from '../panels.js';

// The data rule below fixes the chart's mark census, so it must not change
// without re-validating the panel.

/** F26.1's chart had 3 series. */
const SERIES_COUNT = 3;

/** y ∈ [0, 99]; with a 99 present the y axis nices to [0, 100], giving 11 ticks. */
const Y_SPAN = 100;

/** Scatters consecutive points across [0, Y_SPAN): coprime with the span, so the values spread instead of repeating. */
const POINT_STRIDE = 37;

/** Shifts each series so the three lines differ. */
const SERIES_OFFSET = 23;

export const description = 'Three-series LineChart with legend and point markers, n points per series. Reproduces slice 26 F26.1 (a chart rebuilds every SVG mark per layout pass): at n = 50, 1,081 sink calls and 210 elements rebuilt per unchanged pass.';

/** F26.1's scale: 50 points per series. */
export const defaultScale = 50;

/** The window-resize stand-in: the chart re-laid out at a new width every frame. */
export const defaultDrive = 'resize';

/**
 * Builds a 3-series `LineChart` of `n` points per series, x = 0…n-1.
 *
 * @param n - Points per series.
 * @returns The chart as root, target of `resize` and `passes`, and the `chart` geometry probe.
 */
export function build(n: number): PanelBuild {
    const series = Array.from({ length: SERIES_COUNT }, (_, s) => ({
        name: `Series ${s + 1}`,
        data: Array.from({ length: n }, (_, i) => ({ x: i, y: (i * POINT_STRIDE + s * SERIES_OFFSET) % Y_SPAN })),
    }));

    // Legend and markers pinned on, axis titles left off: each changes the mark census.
    const chart = LineChart({ series, showLegend: true, showPoints: true });

    return { root: chart, targets: { resize: chart, passes: chart }, geometry: { chart } };
}
