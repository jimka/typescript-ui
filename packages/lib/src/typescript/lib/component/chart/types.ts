// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { ElementPatch, Handle } from "~/core/DOM.js";

/**
 * A single datum in a chart series — one `(x, y)` pair in data space. `x` is a
 * plain number for a linear axis or a millisecond epoch for a time axis; `y` is
 * always a plain number.
 *
 * @category Components
 */
export interface ChartPoint {
    x: number;
    y: number;
}

/**
 * One named series of points fed to a chart through the in-memory construction
 * path (as opposed to the store-bound path).
 *
 * @category Components
 */
export interface ChartSeries {
    /** The series' display name, shown in the legend and tooltips. */
    name: string;
    /** The series' data points, in draw order. */
    data: ChartPoint[];
    /**
     * Optional explicit colour override. When absent the series takes its colour
     * from the theme's categorical palette slot (`--ts-ui-chart-series-N`) for
     * its index.
     */
    color?: string;
}

/**
 * Payload of the chart's custom `"selection"` event, fired when a datum is
 * clicked. Identifies the datum by its series index, its index within that
 * series, and carries the point and series name for convenience.
 *
 * @category Components
 */
export interface ChartSelectionEvent {
    /** Index of the selected point's series in the resolved series model. */
    series: number;
    /** Index of the selected point within its series. */
    index: number;
    /** The selected point in data space. */
    point: ChartPoint;
    /** The selected point's series name. */
    seriesName: string;
}

/**
 * A resolved plot rectangle in SVG user-space coordinates — the region the
 * series marks and gridlines are drawn into, inside the axis margins. A plain
 * `{ x, y, width, height }` box (distinct from the eight-field viewport
 * [`Rect`](/api/core/interfaces/Rect), which also carries derived edges).
 *
 * @category Components
 */
export interface PlotRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * The chart's internal, resolved view of one series: its points copied out of
 * the source (in-memory array or store records), its colour, and whether the
 * legend has toggled it hidden. Rebuilt on every `setSeries` / store refresh;
 * the `hidden` flag is carried across a refresh by series name.
 *
 * @category Components
 */
export interface ChartSeriesModel {
    /** The series' display name. */
    name: string;
    /** The series' points in data space. */
    points: ChartPoint[];
    /** Optional explicit colour override; else the palette slot for the index. */
    color?: string;
    /** Whether the legend has toggled this series hidden (no marks drawn). */
    hidden: boolean;
}

/**
 * Factory that creates one SVG mark element, applies a patch to it, appends it
 * to a fixed parent group, and tracks it for release on the next repaint. The
 * chart binds one factory per mark group and hands it to the axis renderer so
 * every created element flows through the chart's centralised clear/release
 * bookkeeping.
 *
 * @category Components
 */
export type MarkFactory = (tag: string, patch: ElementPatch) => Handle;
