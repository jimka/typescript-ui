// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { scaleLinear, scaleBand, scaleTime } from "d3-scale";
import { extent, max, min } from "d3-array";
import type { ScaleLinear, ScaleBand, ScaleTime } from "d3-scale";
import type { ChartPoint } from "~/component/chart/types.js";

/**
 * The union of scale kinds a chart passes around. Every member is d3's own
 * `(value) => pixel` projector: the continuous members ({@link ScaleLinear},
 * {@link ScaleTime}) additionally expose `.ticks()` / `.tickFormat()`, and the
 * discrete member ({@link ScaleBand}) exposes `.bandwidth()`. The scale itself
 * is the domain→pixel projector — `Scale.ts` is a thin adapter around it, not a
 * reimplementation.
 *
 * @category Components
 */
export type ChartScale =
    ScaleLinear<number, number> | ScaleTime<number, number> | ScaleBand<string>;

/**
 * Default padding ratio (band-scale inner padding) between adjacent bar bands.
 * `0.1` leaves a tenth of each step as the gap — dense enough to read the bars
 * as a group while keeping the inter-bar gutter visible.
 */
const DEFAULT_BAND_PADDING = 0.1;

/**
 * Builds a continuous linear value scale over `domain`, projecting onto the
 * pixel `range`, with `.nice()` applied so the domain rounds to human-friendly
 * bounds. Used for the line-chart x/y axes and the bar-chart y axis.
 *
 * @param domain - The `[min, max]` data-space domain.
 * @param range - The `[start, end]` pixel range (may be inverted, e.g. a y axis).
 *
 * @returns The configured d3 linear scale.
 */
export function linearScale(domain: [number, number], range: [number, number]): ScaleLinear<number, number> {
    return scaleLinear().domain(domain).range(range).nice();
}

/**
 * Builds a continuous time scale over a `[start, end]` date domain, projecting
 * onto the pixel `range`, with `.nice()` applied. Selected by a line chart when
 * `xScaleType === "time"`; its `d3-time` / `d3-time-format` transitive
 * dependencies ship with `d3-scale`.
 *
 * @param domain - The `[start, end]` date domain.
 * @param range - The `[start, end]` pixel range.
 *
 * @returns The configured d3 time scale.
 */
export function timeScale(domain: [Date, Date], range: [number, number]): ScaleTime<number, number> {
    return scaleTime().domain(domain).range(range).nice();
}

/**
 * Builds a discrete band scale over `categories`, projecting onto the pixel
 * `range` with symmetric inner/outer padding. Used for the bar-chart x axis;
 * each category gets an equal band of width `.bandwidth()`.
 *
 * @param categories - The ordered category labels.
 * @param range - The `[start, end]` pixel range.
 * @param padding - Inner padding ratio between bands (outer padding is half of
 *   it); defaults to {@link DEFAULT_BAND_PADDING}.
 *
 * @returns The configured d3 band scale.
 */
export function bandScale(categories: string[], range: [number, number], padding: number = DEFAULT_BAND_PADDING): ScaleBand<string> {
    return scaleBand<string>()
        .domain(categories)
        .range(range)
        .paddingInner(padding)
        .paddingOuter(padding / 2);
}

/**
 * Narrows a {@link ChartScale} to the discrete band member by feature-detecting
 * its `.bandwidth()` method (which the continuous scales lack).
 *
 * @param scale - The scale to test.
 *
 * @returns `true` when `scale` is a band scale.
 */
export function isBandScale(scale: ChartScale): scale is ScaleBand<string> {
    return typeof (scale as ScaleBand<string>).bandwidth === "function";
}

/**
 * Returns the axis tick values for a scale: the nice tick values inside the
 * domain for a continuous scale, or the category labels for a band scale.
 *
 * @param scale - The scale to enumerate.
 * @param count - Requested tick count hint (ignored by band scales).
 *
 * @returns The tick values (numbers, `Date`s, or category strings).
 */
export function scaleTicks(scale: ChartScale, count: number): Array<number | Date | string> {
    if (isBandScale(scale)) {
        return scale.domain();
    }

    return (scale as ScaleLinear<number, number> | ScaleTime<number, number>).ticks(count);
}

/**
 * Returns the pixel position of a tick value: the projected position for a
 * continuous scale, or the band centre for a band scale.
 *
 * @param scale - The scale to project through.
 * @param value - The tick value to position.
 *
 * @returns The pixel position along the scale's range.
 */
export function tickPosition(scale: ChartScale, value: number | Date | string): number {
    if (isBandScale(scale)) {
        return (scale(value as string) ?? 0) + scale.bandwidth() / 2;
    }

    return (scale as ScaleLinear<number, number> | ScaleTime<number, number>)(value as number & Date);
}

/**
 * Returns a string formatter for a scale's tick values — d3's own
 * domain-appropriate `.tickFormat()` for a continuous scale (which picks a
 * sensible number/time format for the tick density), or `String` for a band
 * scale's already-textual categories.
 *
 * @param scale - The scale to format ticks for.
 * @param count - Tick-count hint passed to d3's continuous `.tickFormat()`.
 *
 * @returns A `(value) => string` formatter.
 */
export function tickFormatter(scale: ChartScale, count: number): (value: number | Date | string) => string {
    if (isBandScale(scale)) {
        return (value) => String(value);
    }

    const format = (scale as ScaleLinear<number, number> | ScaleTime<number, number>).tickFormat(count);

    return (value) => format(value as number & Date);
}

/**
 * Computes the `[min, max]` x-extent across a flat list of points, falling back
 * to `[0, 1]` for an empty list so a scale never receives a `NaN`/`undefined`
 * domain.
 *
 * @param points - The points to span.
 *
 * @returns The `[min, max]` x-extent.
 */
export function pointsXExtent(points: ChartPoint[]): [number, number] {
    const span = extent(points, (p) => p.x);

    return [span[0] ?? 0, span[1] ?? 1];
}

/**
 * Computes the y-domain bounds across a flat list of points. When
 * `includeZero` is set (the default) the lower bound is clamped to at most `0`
 * so a value axis starts at the baseline; the upper bound is the data maximum.
 * Falls back to `[0, 1]` for an empty list.
 *
 * @param points - The points to span.
 * @param includeZero - Whether to force the baseline `0` into the domain.
 *
 * @returns The `[lower, upper]` y-domain.
 */
export function pointsYBounds(points: ChartPoint[], includeZero: boolean = true): [number, number] {
    if (points.length === 0) {
        return [0, 1];
    }

    const dataMin = min(points, (p) => p.y) ?? 0;
    const dataMax = max(points, (p) => p.y) ?? 1;
    const lower = includeZero ? Math.min(0, dataMin) : dataMin;
    // A flat series (all-equal y) would collapse the domain to a point and make
    // `.nice()` produce a zero-height range; nudge the upper bound up by 1 so the
    // axis always has extent.
    const upper = dataMax > lower ? dataMax : lower + 1;

    return [lower, upper];
}
