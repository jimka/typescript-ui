// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Positions a content block along an axis — the "align" concept. Shared by the
 * single-line box layouts, the wrapping flow layouts, and the {@link Tab} strip.
 *
 * - `"start"` — the block hugs the leading edge; the slack sits at the trailing
 *   edge. This is the do-nothing identity.
 * - `"center"` — the block is centred; equal slack on both ends.
 * - `"end"` — the block hugs the trailing edge; the slack sits at the leading
 *   edge.
 *
 * @remarks `"start"` is the shared identity value with {@link AxisSpread}, so the
 * union `AxisPosition | AxisSpread` collapses to the five-value
 * {@link BoxJustify} set.
 *
 * @category Layouts
 */
export type AxisPosition = "start" | "center" | "end";

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
 * {@link BoxJustify} set.
 *
 * @category Layouts
 */
export type AxisSpread = "start" | "between" | "around";
