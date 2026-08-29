// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractChart, AbstractChartOptions } from "~/component/chart/AbstractChart.js";
import { bandScale, linearScale, isBandScale, pointsYBounds } from "~/component/chart/Scale.js";
import type { ChartScale } from "~/component/chart/Scale.js";
import type { ScaleBand } from "d3-scale";
import { callable } from "~/core/Callable.js";
import type { ChartSeriesModel, PlotRect } from "~/component/chart/types.js";

/**
 * Construction-time options for {@link BarChart}.
 *
 * @category Components
 */
export interface BarChartOptions extends AbstractChartOptions {
    /**
     * Whether multiple series are drawn as side-by-side grouped bars (`true`)
     * or stacked (`false`). Defaults to grouped when more than one series is
     * present.
     */
    grouped?: boolean;
}

/** One resolved bar rectangle, tagged with the datum it represents. */
interface BarRect {
    seriesIndex: number;
    pointIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * A bar chart: a discrete band x axis and a linear y axis. Multiple series are
 * drawn grouped (side by side) or stacked. Bar rectangles are hand-computed from
 * the band scale — `d3-shape` adds nothing to axis-aligned rectangles.
 *
 * @category Components
 */
class BarChart extends AbstractChart<BarChartOptions> {

    /**
     * Builds the bar chart, then dispatches its own options from the constructor
     * body.
     *
     * @param options - Optional construction-time options.
     */
    constructor(options?: BarChartOptions) {
        super(options);

        if (options?.grouped !== undefined) {
            this.setGrouped(options.grouped);
        }
    }

    /**
     * Sets whether multiple series are grouped (vs stacked) and repaints.
     *
     * @param value - `true` for grouped bars, `false` for stacked.
     *
     * @returns This chart, for method chaining.
     */
    setGrouped(value: boolean): this {
        this._options.grouped = value;

        this.scheduleLayout();

        return this;
    }

    /**
     * Returns whether multiple series are grouped (defaults to grouped when more
     * than one series is present).
     *
     * @returns `true` when bars are grouped.
     */
    isGrouped(): boolean {
        return this._options.grouped ?? this._series.length > 1;
    }

    /**
     * Returns the distinct x categories across the visible series, in ascending
     * numeric order, as strings.
     *
     * @returns The ordered category labels.
     */
    private categories(): string[] {
        const values = new Set<number>();

        for (const model of this._series) {
            if (!model.hidden) {
                for (const point of model.points) {
                    values.add(point.x);
                }
            }
        }

        return Array.from(values).sort((a, b) => a - b).map(String);
    }

    /**
     * Builds a band x scale over the categories and a linear y scale from zero
     * to the data max.
     *
     * @param plot - The plot rectangle.
     *
     * @returns The x and y scales.
     */
    protected buildScales(plot: PlotRect): { x: ChartScale; y: ChartScale } {
        const x = bandScale(this.categories(), [plot.x, plot.x + plot.width]);
        const y = linearScale(pointsYBounds(this.visiblePoints()), [plot.y + plot.height, plot.y]);

        return { x, y };
    }

    /**
     * Draws one `<rect>` per (visible series × point), grouped or stacked, each
     * tagged with `data-series` / `data-index` and coloured from the palette.
     *
     * @param plot - The plot rectangle (unused; the scales carry the geometry).
     * @param xScale - The band x scale.
     * @param yScale - The linear y scale.
     */
    protected drawSeries(_plot: PlotRect, xScale: ChartScale, yScale: ChartScale): void {
        for (const bar of this.computeBars(xScale, yScale)) {
            const color = this.seriesColor(bar.seriesIndex, this._series[bar.seriesIndex]);

            this.seriesMark("rect", {
                setAttr: { x: String(bar.x), y: String(bar.y), width: String(bar.width), height: String(bar.height), "data-series": String(bar.seriesIndex), "data-index": String(bar.pointIndex) },
                style:   { fill: color },
            });
        }
    }

    /**
     * Computes the bar rectangles for the visible series against the scales,
     * subdividing each category band across grouped series or stacking them.
     *
     * @param xScale - The band x scale.
     * @param yScale - The linear y scale.
     *
     * @returns The bar rectangles.
     */
    private computeBars(xScale: ChartScale, yScale: ChartScale): BarRect[] {
        if (!isBandScale(xScale)) {
            return [];
        }

        const project = yScale as unknown as (v: number) => number;
        const baseline = project(0);
        const grouped = this.isGrouped();
        const visible = this._series
            .map((model, index) => ({ model, index }))
            .filter((entry) => !entry.model.hidden);
        const groupWidth = xScale.bandwidth();
        const barWidth = grouped ? groupWidth / Math.max(1, visible.length) : groupWidth;
        const stackTops = new Map<string, number>();
        const bars: BarRect[] = [];

        visible.forEach((entry, position) => {
            this.appendSeriesBars(bars, entry.model, entry.index, position, xScale, project, baseline, grouped, barWidth, stackTops);
        });

        return bars;
    }

    /**
     * Appends the bar rectangles for one series to `bars`.
     *
     * @param bars - The accumulating bar list.
     * @param model - The series model.
     * @param seriesIndex - The series' index in the full model.
     * @param position - The series' position among the visible series (grouped offset).
     * @param xScale - The band x scale.
     * @param project - The y value→pixel projector.
     * @param baseline - The pixel y of the zero baseline.
     * @param grouped - Whether bars are grouped (vs stacked).
     * @param barWidth - The per-bar width in px.
     * @param stackTops - Running stacked tops per category (mutated for stacking).
     */
    private appendSeriesBars(
        bars: BarRect[],
        model: ChartSeriesModel,
        seriesIndex: number,
        position: number,
        xScale: ScaleBand<string>,
        project: (v: number) => number,
        baseline: number,
        grouped: boolean,
        barWidth: number,
        stackTops: Map<string, number>
    ): void {
        model.points.forEach((point, pointIndex) => {
            const category = String(point.x);
            const bandStart = xScale(category) ?? 0;

            if (grouped) {
                const top = project(point.y);

                bars.push({ seriesIndex, pointIndex, x: bandStart + position * barWidth, y: Math.min(top, baseline), width: barWidth, height: Math.abs(baseline - top), });
            } else {
                const prev = stackTops.get(category) ?? 0;
                const cumulative = prev + point.y;
                const top = project(cumulative);
                const bottom = project(prev);

                bars.push({ seriesIndex, pointIndex, x: bandStart, y: Math.min(top, bottom), width: barWidth, height: Math.abs(bottom - top), });
                stackTops.set(category, cumulative);
            }
        });
    }

    /**
     * Returns the top-centre pixel of a datum's bar for the selection ring.
     *
     * @param plot - The plot rectangle (unused).
     * @param xScale - The band x scale.
     * @param yScale - The linear y scale.
     * @param series - The datum's series index.
     * @param index - The datum's index within its series.
     *
     * @returns The bar top-centre pixel, or `null` when not found.
     */
    protected pointPixel(_plot: PlotRect, xScale: ChartScale, yScale: ChartScale, series: number, index: number): { x: number; y: number } | null {
        const bar = this.computeBars(xScale, yScale).find((b) => b.seriesIndex === series && b.pointIndex === index);

        if (!bar) {
            return null;
        }

        return { x: bar.x + bar.width / 2, y: bar.y };
    }
}

const BarChartCallable = callable(BarChart);
type BarChartCallable = BarChart;
export {
    BarChart         as _BarChart,
    BarChartCallable as BarChart
};
