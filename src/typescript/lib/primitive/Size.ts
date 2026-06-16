// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Represents a two-dimensional size with width and height in pixels.
 *
 * @category Util
 */
export interface Size {
    width: number,
    height: number
}

/**
 * The sentinel extent meaning "no upper bound" on a size axis.
 *
 * @category Util
 */
export const UNBOUNDED: number = Number.MAX_SAFE_INTEGER;

/**
 * True when an extent is at or above the unbounded sentinel (recognises the
 * legacy `Number.MAX_VALUE` too).
 *
 * @param n - The extent to test.
 * @returns `true` when `n` is at or above {@link UNBOUNDED}.
 *
 * @category Util
 */
export function isUnbounded(n: number): boolean {
    return n >= Number.MAX_SAFE_INTEGER;
}

/**
 * Caps an extent at the unbounded sentinel so an unbounded sum cannot overflow
 * it.
 *
 * @param n - The extent to cap.
 * @returns `n`, capped at {@link UNBOUNDED}.
 *
 * @category Util
 */
export function saturate(n: number): number {
    return Math.min(n, UNBOUNDED);
}
