// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Shared arithmetic for a dragged boundary that redistributes space across a
 * run of bounded siblings fanning outward from it, nearest-first.
 * {@link Accordion} (resizable gutters, growing/shrinking sections along the
 * open set) and {@link Table} (column-resize handles, growing/shrinking
 * columns fanning out from the dragged edge) both drive a drag through the
 * same two functions — the geometry differs (height vs. width, sections vs.
 * columns) but the chain rule does not, so it lives here as the single source
 * of truth. Neither owner's state lives here; each caller supplies its own
 * live values, bounds, and grouping.
 *
 * @category Core
 */

/**
 * Sub-pixel threshold below which a drag's remaining amount to distribute is
 * treated as fully placed, ending the chain loop. Guards against a residual
 * float epsilon (e.g. `1e-13` left by repeated subtraction) spinning the loop
 * over already-satisfied entries; well under one device pixel, so it never
 * drops a visible amount of travel.
 */
export const DRAG_DISTRIBUTION_EPSILON = 1e-6;

/**
 * Total room the group has left to move in one direction: toward `maxs` when
 * `sign` is `+1`, toward `mins` when `sign` is `-1`. Each entry's room is
 * floored at 0, so an entry momentarily outside its bounds can't contribute
 * negative room and under-report what the chain can actually absorb.
 *
 * @param group - Positions to sum room over.
 * @param current - Each position's current value.
 * @param sign - `+1` to measure room to grow, `-1` to measure room to shrink.
 * @param mins - Each position's minimum value.
 * @param maxs - Each position's maximum value.
 * @returns The summed room, never negative.
 */
export function chainRoom(group: number[], current: number[], sign: number, mins: number[], maxs: number[]): number {
    let total = 0;

    for (const pos of group) {
        total += sign > 0 ? Math.max(0, maxs[pos] - current[pos]) : Math.max(0, current[pos] - mins[pos]);
    }

    return total;
}

/**
 * Distributes `delta` across `group` (nearest-first), growing (`sign +1`) or
 * shrinking (`sign -1`) each entry within its `[min, max]`. The nearest entry
 * to the dragged boundary absorbs the travel first, spilling to the next only
 * once it hits its bound. This is purely a function of the live values — the
 * drag keeps no memory of where each entry started, so reversing the pointer
 * simply moves the boundary the other way and the closest entry grows/shrinks
 * first in that new direction too (never a "rewind" that returns a far entry
 * toward its start value before the near one has finished moving).
 *
 * @param group - Positions to distribute across, nearest-to-boundary first.
 * @param current - Each position's current value.
 * @param delta - Total amount to distribute across the group.
 * @param sign - `+1` to grow the entries, `-1` to shrink them.
 * @param mins - Each position's minimum value.
 * @param maxs - Each position's maximum value.
 * @param out - Result values (seeded to `current` by the caller), indexed by
 *   position; mutated in place.
 */
export function distributeDragChain(group: number[], current: number[], delta: number, sign: number, mins: number[], maxs: number[], out: number[]): void {
    const room = (pos: number): number =>
        sign > 0 ? Math.max(0, maxs[pos] - current[pos]) : Math.max(0, current[pos] - mins[pos]);

    let remaining = delta;

    for (const pos of group) {
        if (remaining <= DRAG_DISTRIBUTION_EPSILON) {
            return;
        }

        const take = Math.min(remaining, room(pos));
        out[pos] += sign * take;
        remaining -= take;
    }
}
