// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * The two horizontal (left/right) physical box edges. Physical, not logical:
 * these do not flip under right-to-left layout.
 *
 * @category Util
 */
export type HorizontalSide = "left" | "right";

/**
 * The two vertical (top/bottom) physical box edges.
 *
 * @category Util
 */
export type VerticalSide = "top" | "bottom";

/**
 * Any of the four physical box edges.
 *
 * @category Util
 */
export type Edge = HorizontalSide | VerticalSide;
