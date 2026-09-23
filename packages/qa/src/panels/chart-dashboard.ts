import { Panel } from '@jimka/typescript-ui/core';
import { BarChart, LineChart } from '@jimka/typescript-ui/component/chart';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { Grid, Split, VBox } from '@jimka/typescript-ui/layout';
import { barSeries, lineSeriesPoints, Y_SPAN } from '../builders/data.js';
import { childGutter, elementFor } from '../builders/dom.js';
import { awaitStoreView } from '../builders/store.js';
import type { GeometryTarget, HarnessTools } from '../harness/types.js';
import type { PanelBuild } from '../panels.js';

/** The panel's id, for errors. */
const PANEL = 'chart-dashboard';

/** Line charts in the grid, two rows of two. */
const GRID_ROWS = 2;
const GRID_COLUMNS = 2;
const LINE_CHARTS = GRID_ROWS * GRID_COLUMNS;

/** Series per line chart: F26.1's three. */
const SERIES_COUNT = 3;

/** Bar charts stacked beside the grid. */
const BAR_CHARTS = 2;

/** The stride `update` walks a store's records by, so consecutive updates move points spread across the chart rather than neighbours. */
const UPDATE_RECORD_STRIDE = 7;

/** How far `update` moves a point's y, wrapped into [0, Y_SPAN): a visible move that keeps the axis range. */
const UPDATE_Y_SHIFT = 13;

export const description = 'Dashboard: a Split of a 2×2 grid of store-backed LineCharts (3 series of n points each, legend and markers on) beside two grouped BarCharts. Reproduces slice 26 F26.1 (fixed: a chart rebuilt every SVG mark per layout pass, and now keeps them while its plot and state are unchanged) and F26.2 (fixed by text-measurement-without-reflow: axis margins were re-measured with 12 text measurements per pass): at n = 50, per unchanged pass of the grid, 840 createElementNS (4 × 210) and 48 measureText (4 × 12) before the two fixes, and none of either after. The deep counterpart of chart-line.';

/** 200 points per series: a dashboard's worth of data. */
export const defaultScale = 200;

/** The window-resize stand-in: every chart re-laid out at a new width every frame. */
export const defaultDrive = 'resize';

/**
 * A store-backed line chart of three series of `n` points.
 *
 * @param n - Points per series.
 * @returns The chart and its store.
 */
function lineChart(n: number): { chart: LineChart; store: MemoryStore } {
    const store = new MemoryStore(new Model([{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 'series', type: 'string' }]));

    store.loadData(Array.from({ length: SERIES_COUNT }, (_, s) => lineSeriesPoints(s, n).map((p) => ({ ...p, series: `Series ${s + 1}` }))).flat());

    const chart = LineChart({ store, xField: 'x', yField: 'y', seriesField: 'series', showLegend: true, showPoints: true });

    return { chart, store };
}

/**
 * Builds the dashboard.
 *
 * @param n - Points per line series.
 * @returns The split as root, target of `resize`; the grid, target of `passes`; `update`, which moves one point of one line chart; and `afterMount`, which waits for every chart's store view and gives `drag` the split's gutter and `hover` the first line chart.
 */
export function build(n: number): PanelBuild {
    const lines = Array.from({ length: LINE_CHARTS }, () => lineChart(n));
    const grid = Panel({ layoutManager: Grid({ rows: GRID_ROWS, columns: GRID_COLUMNS }), components: lines.map((line) => line.chart) });
    const bars = Panel({ layoutManager: VBox({ stretching: true }), components: Array.from({ length: BAR_CHARTS }, (_, k) => BarChart({ series: barSeries(k), grouped: true })) });

    const root = Panel({
        layoutManager: Split({ orientation: 'horizontal' }),
        components: [
            { component: grid, constraints: { weight: 1 } },
            { component: bars, constraints: { weight: 1 } },
        ],
    });

    // `point0` is the first line chart's first marker and `bar0` the first bar
    // chart's first bar: marks the container labels cannot see.
    const geometry: Record<string, GeometryTarget> = { grid, bars, point0: '.LineChart circle', bar0: '.BarChart rect' };

    lines.forEach((line, k) => {
        geometry[`chart${k}`] = line.chart;
    });

    return {
        root,
        targets: {
            passes: grid,
            resize: root,
            update: function movePoint(index: number): void {
                const { store } = lines[index % LINE_CHARTS];
                const record = store.getAt((index * UPDATE_RECORD_STRIDE) % store.getCount())!;

                record.set('y', ((record.get('y') as number) + UPDATE_Y_SHIFT) % Y_SPAN);
            },
        },
        afterMount: async (tools: HarnessTools): Promise<Record<string, unknown>> => {
            // Three series of n points each: from n = 334 up, every chart's
            // store builds its view on a worker, and a chart drawn from an
            // empty view is not the chart `update` and `hover` measure.
            await Promise.all(lines.map(({ store }) => awaitStoreView(tools, store, PANEL)));

            return {
                drag: { element: childGutter(tools, root, PANEL), axis: 'x' },
                hover: { element: elementFor(tools, lines[0].chart, PANEL), axis: 'x' },
            };
        },
        geometry,
        describe: () => ({ lineCharts: LINE_CHARTS, barCharts: BAR_CHARTS, pointsPerSeries: n }),
    };
}
