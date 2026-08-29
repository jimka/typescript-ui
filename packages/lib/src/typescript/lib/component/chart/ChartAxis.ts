// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import { scaleTicks, tickPosition } from "~/component/chart/Scale.js";
import type { ChartScale } from "~/component/chart/Scale.js";
import type { MarkFactory, PlotRect } from "~/component/chart/types.js";
import type { Edge } from "~/primitive/Edge.js";

/**
 * Which edge an axis is drawn on. `"bottom"` is the horizontal x axis under the
 * plot; `"left"` is the vertical y axis to its left.
 */
type ChartAxisEdge = Extract<Edge, "bottom" | "left">;

/**
 * Length in px of each tick mark drawn outward from the axis line. Fixed rather
 * than themed: the tick is a structural cue whose length carries no design
 * meaning, and a constant keeps the margin arithmetic (which reserves this plus
 * the label extent) simple.
 */
const TICK_LENGTH = 6;

/**
 * Gap in px between a tick mark and its label. Small, fixed breathing room so
 * the label does not touch the tick; mirrored into the reserved margin.
 */
const LABEL_GAP = 4;

/**
 * Default number of ticks requested from a continuous scale. A hint, not a
 * guarantee — d3 rounds it to the nearest nice-number tick count. Eight reads
 * as a legible density for the plan's stated modest data sizes.
 */
export const DEFAULT_TICK_COUNT = 8;

/**
 * Render options for one axis pass.
 *
 * @category Components
 */
export interface AxisRenderOptions {
    /** Requested tick count (continuous scales only). */
    tickCount: number;
    /** Tick-value formatter, typically from the scale's own `tickFormat`. */
    format: (value: number | Date | string) => string;
    /** Whether to draw gridlines spanning the plot at each tick. */
    grid: boolean;
}

/**
 * Measures the margin (px) a plot rectangle must reserve for an axis, from the
 * scale's tick labels — the max label width for a `"left"` axis, or the label
 * height for a `"bottom"` axis — plus the tick length and label gap. Measured
 * from the domain ticks (independent of the pixel range), so it can run *before*
 * the plot rectangle exists, breaking the margin↔layout feedback loop.
 *
 * @param orientation - The axis edge.
 * @param scale - The scale whose ticks are measured.
 * @param format - The tick-value formatter.
 * @param tickCount - Requested tick count hint.
 *
 * @returns The margin to reserve in px.
 */
export function measureAxisMargin(
    orientation: ChartAxisEdge,
    scale: ChartScale,
    format: (value: number | Date | string) => string,
    tickCount: number
): number {
    const ticks = scaleTicks(scale, tickCount);

    if (orientation === "left") {
        let widest = 0;

        for (const value of ticks) {
            widest = Math.max(widest, DOM.source.measureText(format(value)).width);
        }

        return TICK_LENGTH + LABEL_GAP + Math.ceil(widest);
    }

    // Bottom axis: horizontal labels, so the reserved extent is one line's
    // height (the widest label height, which is font-driven and constant).
    const labelHeight = DOM.source.measureText("0").height;

    return TICK_LENGTH + LABEL_GAP + Math.ceil(labelHeight);
}

/**
 * Draws an axis — its line, tick marks, tick labels, and optional gridlines —
 * into a mark group through the supplied {@link MarkFactory}, entirely natively
 * (no `d3-axis`, which would own a d3-selection and mutate the DOM). Colours and
 * stroke widths bind to `--ts-ui-chart-*` theme variables so a theme switch
 * re-cascades with no redraw.
 *
 * @param create - The mark factory bound to the axis group.
 * @param orientation - The axis edge.
 * @param scale - The scale to render.
 * @param plot - The plot rectangle in SVG user space.
 * @param opts - Tick count, formatter, and gridline flag.
 */
export function drawAxis(
    create: MarkFactory,
    orientation: ChartAxisEdge,
    scale: ChartScale,
    plot: PlotRect,
    opts: AxisRenderOptions
): void {
    const axisStroke = { stroke: "var(--ts-ui-chart-axis)", "stroke-width": "var(--ts-ui-chart-axis-width)" };
    const gridStroke = { stroke: "var(--ts-ui-chart-grid)", "stroke-width": "var(--ts-ui-chart-axis-width)" };
    const labelFill = { fill: "var(--ts-ui-chart-label)" };

    const bottomEdge = plot.y + plot.height;
    const rightEdge = plot.x + plot.width;

    if (orientation === "left") {
        create("line", { setAttr: { x1: String(plot.x), y1: String(plot.y), x2: String(plot.x), y2: String(bottomEdge) }, style: axisStroke });
    } else {
        create("line", { setAttr: { x1: String(plot.x), y1: String(bottomEdge), x2: String(rightEdge), y2: String(bottomEdge) }, style: axisStroke });
    }

    for (const value of scaleTicks(scale, opts.tickCount)) {
        const pos = tickPosition(scale, value);
        const label = opts.format(value);

        if (orientation === "left") {
            drawLeftTick(create, plot, rightEdge, pos, label, opts.grid, gridStroke, axisStroke, labelFill);
        } else {
            drawBottomTick(create, plot, bottomEdge, pos, label, opts.grid, gridStroke, axisStroke, labelFill);
        }
    }
}

/**
 * Draws one left-axis tick: its optional gridline across the plot, the tick
 * mark, and the right-aligned, vertically-centred label.
 *
 * @param create - The mark factory bound to the axis group.
 * @param plot - The plot rectangle.
 * @param rightEdge - The plot's right edge x coordinate.
 * @param pos - The tick's y position in SVG user space.
 * @param label - The formatted tick label.
 * @param grid - Whether to draw the gridline.
 * @param gridStroke - Gridline stroke style.
 * @param axisStroke - Tick-mark stroke style.
 * @param labelFill - Label fill style.
 */
function drawLeftTick(
    create: MarkFactory,
    plot: PlotRect,
    rightEdge: number,
    pos: number,
    label: string,
    grid: boolean,
    gridStroke: Record<string, string>,
    axisStroke: Record<string, string>,
    labelFill: Record<string, string>
): void {
    if (grid) {
        create("line", { setAttr: { x1: String(plot.x), y1: String(pos), x2: String(rightEdge), y2: String(pos) }, style: gridStroke });
    }

    create("line", { setAttr: { x1: String(plot.x - TICK_LENGTH), y1: String(pos), x2: String(plot.x), y2: String(pos) }, style: axisStroke });

    create("text", {
        setAttr: { x: String(plot.x - TICK_LENGTH - LABEL_GAP), y: String(pos), "text-anchor": "end", "dominant-baseline": "middle" },
        style: labelFill,
        text: label,
    });
}

/**
 * Draws one bottom-axis tick: its optional gridline up the plot, the tick mark,
 * and the centred label hanging below it.
 *
 * @param create - The mark factory bound to the axis group.
 * @param plot - The plot rectangle.
 * @param bottomEdge - The plot's bottom edge y coordinate.
 * @param pos - The tick's x position in SVG user space.
 * @param label - The formatted tick label.
 * @param grid - Whether to draw the gridline.
 * @param gridStroke - Gridline stroke style.
 * @param axisStroke - Tick-mark stroke style.
 * @param labelFill - Label fill style.
 */
function drawBottomTick(
    create: MarkFactory,
    plot: PlotRect,
    bottomEdge: number,
    pos: number,
    label: string,
    grid: boolean,
    gridStroke: Record<string, string>,
    axisStroke: Record<string, string>,
    labelFill: Record<string, string>
): void {
    if (grid) {
        create("line", { setAttr: { x1: String(pos), y1: String(plot.y), x2: String(pos), y2: String(bottomEdge) }, style: gridStroke });
    }

    create("line", { setAttr: { x1: String(pos), y1: String(bottomEdge), x2: String(pos), y2: String(bottomEdge + TICK_LENGTH) }, style: axisStroke });

    create("text", {
        setAttr: { x: String(pos), y: String(bottomEdge + TICK_LENGTH + LABEL_GAP), "text-anchor": "middle", "dominant-baseline": "hanging" },
        style: labelFill,
        text: label,
    });
}
