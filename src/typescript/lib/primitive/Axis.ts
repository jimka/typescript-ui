// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Orientation of an axis — whether it runs left-to-right or top-to-bottom.
 * Shared by every component that lays out or measures along a single axis
 * (splits, sliders, scrollbars, tool bars and their separators).
 *
 * - `"horizontal"` — the axis runs along the x-direction.
 * - `"vertical"` — the axis runs along the y-direction.
 *
 * @category Util
 */
export type AxisOrientation = "horizontal" | "vertical";

/**
 * Positions a content block along an axis — the "align" concept. Shared by the
 * single-line box layouts, the wrapping flow layouts, and the
 * [`Tab`](/api/layout/classes/Tab) strip.
 *
 * - `"start"` — the block hugs the leading edge; the slack sits at the trailing
 *   edge. This is the do-nothing identity.
 * - `"center"` — the block is centred; equal slack on both ends.
 * - `"end"` — the block hugs the trailing edge; the slack sits at the leading
 *   edge.
 *
 * @remarks `"start"` is the shared identity value with {@link AxisSpread}, so the
 * union `AxisPosition | AxisSpread` collapses to the five-value
 * [`BoxJustify`](/api/layout/type-aliases/BoxJustify) set.
 *
 * @category Util
 */
export type AxisPosition = "start" | "center" | "end";

/**
 * One of the two ends of an axis — an {@link AxisPosition} that isn't the
 * centre. Names the leading or trailing edge along the axis, used where a single
 * element snaps to one end (the [`Tab`](/api/layout/classes/Tab) strip's
 * alignment, a tool bar's overflow trigger, an accordion header's chevron).
 *
 * - `"start"` — the leading edge.
 * - `"end"` — the trailing edge.
 *
 * @category Util
 */
export type AxisEnd = Exclude<AxisPosition, "center">;

/**
 * Distributes leftover slack into the inter-item gaps along an axis — the
 * "justify"/distribute concept. Shared by the single-line box layouts and the
 * wrapping flow layouts.
 *
 * - `"start"` — no spread; items keep their fixed spacing and the slack stays at
 *   the trailing edge. This is the do-nothing identity.
 * - `"between"` — the first and last items sit flush to the edges and the slack
 *   is split evenly into the gaps between them (CSS `space-between`).
 * - `"around"` — an equal gap surrounds every item, so the end half-gaps are
 *   half the interior gaps (CSS `space-around`).
 *
 * @remarks `"start"` is the shared identity value with {@link AxisPosition}, so
 * the union `AxisPosition | AxisSpread` collapses to the five-value
 * [`BoxJustify`](/api/layout/type-aliases/BoxJustify) set.
 *
 * @category Util
 */
export type AxisSpread = "start" | "between" | "around";
