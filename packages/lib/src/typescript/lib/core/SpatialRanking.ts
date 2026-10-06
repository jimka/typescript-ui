// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The pure ranking half of spatial navigation's control chord
// (`Ctrl+Alt`+arrow). Nothing here reads the DOM: rectangles go in, an ordered
// list of handles comes out. `core/SpatialNavigation.ts` decides which
// elements are candidates and what rectangle each is measured by; this module
// decides which of them an arrow accepts and in what order.
//
// Every number that shapes how a move feels is one of the five constants
// below, and they are defined nowhere else. To tune the control chord, change
// a constant here, rebuild, and retry.

import type { Handle, Rect } from "~/core/DOM.js";
import type { SpatialCandidate, SpatialDirection } from "~/core/SpatialNavigation.js";

/**
 * How far, in pixels, a candidate may overlap the origin's forward edge and
 * still count as ahead of it.
 *
 * Two siblings laid out edge to edge each round their shared edge on their
 * own, so a control that is plainly the next one along can report an edge a
 * fraction of a pixel behind the origin's (two tab buttons measured about
 * 0.000004px apart). One pixel absorbs that without admitting a control that
 * is really behind the origin: a genuine overlap in the library's layouts is
 * whole pixels deep. Raise it only if adjacent controls are being skipped.
 */
export const EDGE_TOLERANCE_PX: number = 1;

/**
 * The cost of one sideways pixel, in forward pixels, for a candidate that is
 * not in line with the origin.
 *
 * `2` is the value the previous ranking used and the up/down weight of the
 * W3C CSS Spatial Navigation draft; on the SQLAdmin sidebar layout it orders
 * every pair of controls the way a person would. This is the first constant
 * to adjust: raise it if moves feel too eager to go sideways, lower it if
 * they feel too reluctant.
 */
export const OFF_AXIS_WEIGHT: number = 2;

/**
 * The share of the origin's own width or height that is added to the
 * sideways distance of a candidate that is not in line with it.
 *
 * `0.5` measures the sideways distance from the origin's centre line instead
 * of from its nearest edge — the W3C draft's `orthogonalBias`. Almost
 * everything is in line with a wide control, so a candidate that still misses
 * it is well off to the side and should lose to one straight ahead: without
 * this term, `↓` from a 210px-wide accordion title lands on a small button
 * 5px below its right-hand corner instead of on the table directly below.
 * The term costs a small origin little. Raise it if a wide control still
 * prefers a control off its corner; `0` removes the effect.
 */
export const ORIGIN_EXTENT_BIAS: number = 0.5;

/**
 * The most sideways distance allowed per forward pixel for a candidate that
 * is not in line with the origin — the slope of the cone an arrow points
 * into.
 *
 * `1` is 45 degrees: a control counts as "to the right" only when it is at
 * least as far right as it is up or down, which is the one boundary where a
 * diagonal control belongs to exactly the two directions a person would
 * accept for it. A wider cone (slope 2, about 63 degrees) would let a `→`
 * press land on a control 300px right and 500px down, which reads as a jump
 * downward. Lower it to make arrows stricter about direction.
 */
export const CONE_SLOPE: number = 1;

/**
 * The least width and height, in pixels, a control must show to count as in
 * view. A control smaller than this on an axis needs its whole extent on that
 * axis instead.
 *
 * `4` stops a control with a one-pixel sliver showing under a clipping edge
 * from counting as visible, while still admitting a control a scrolling
 * panel's edge cuts in half (it is scrolled fully into view when focus lands
 * on it). Raise it if moves land on controls that are barely showing.
 */
export const MIN_VISIBLE_PX: number = 4;

/** One rectangular span along a single axis, as read off a {@link Rect}. */
export interface Span {
    start: number;
    end:   number;
}

/**
 * Projects two rectangles onto the axes of a move.
 *
 * @param origin - The rectangle the move starts from.
 * @param candidate - The rectangle being considered.
 * @param direction - The direction of the move.
 * @returns `primary`, the gap from `origin`'s edge on the arrow's side to
 *   `candidate`'s near edge (negative when `candidate` starts behind that
 *   edge), and each rectangle's span on the other axis.
 */
export function project(origin: Rect, candidate: Rect, direction: SpatialDirection):
    { primary: number; originSpan: Span; candidateSpan: Span } {
    switch (direction) {
        case "north":
            return {
                primary:       origin.top - candidate.bottom,
                originSpan:    { start: origin.left, end: origin.right },
                candidateSpan: { start: candidate.left, end: candidate.right },
            };
        case "south":
            return {
                primary:       candidate.top - origin.bottom,
                originSpan:    { start: origin.left, end: origin.right },
                candidateSpan: { start: candidate.left, end: candidate.right },
            };
        case "west":
            return {
                primary:       origin.left - candidate.right,
                originSpan:    { start: origin.top, end: origin.bottom },
                candidateSpan: { start: candidate.top, end: candidate.bottom },
            };
        case "east":
            return {
                primary:       candidate.left - origin.right,
                originSpan:    { start: origin.top, end: origin.bottom },
                candidateSpan: { start: candidate.top, end: candidate.bottom },
            };
    }
}

/**
 * How far two spans fail to overlap.
 *
 * @param a - One span.
 * @param b - The other span.
 * @returns The distance between them; `0` whenever they overlap or touch.
 */
export function gapBetween(a: Span, b: Span): number {
    return Math.max(0, Math.max(a.start, b.start) - Math.min(a.end, b.end));
}

/**
 * Whether two spans overlap by more than zero. {@link gapBetween} reports 0
 * both for a genuine overlap and for two spans that merely touch at a shared
 * edge (e.g. a fixed-height toolbar's top edge flush against the chrome row
 * above it) — that degenerate case must not count as "sharing the band", or
 * an adjacent, different-row element can out-rank the true same-row
 * neighbour.
 *
 * @param a - One span.
 * @param b - The other span.
 * @returns True when the two share a positive-width stretch.
 */
export function spansOverlap(a: Span, b: Span): boolean {
    return Math.max(a.start, b.start) < Math.min(a.end, b.end);
}

/**
 * Which candidates one search level accepts. `"line"` — a group or a scroll
 * viewport — accepts only candidates in line with the origin, so the level
 * can carry a move along its row or column but never pull it sideways.
 * `"open"` — the search root — also accepts a candidate in the cone, and one
 * in line with the origin's group.
 */
export type LevelAcceptance = "line" | "open";

/** One candidate measured against the origin for a direction. */
export interface DirectionalMeasure {
    /** Distance from the origin's forward edge to the candidate's near edge; `0` when they touch. */
    forwardGap:       number;
    /** How far the two rectangles fail to overlap on the other axis; `0` when they overlap at all. */
    sideGap:          number;
    /** Whether the two rectangles overlap on the other axis by more than zero. */
    inLine:           boolean;
    /** The origin's width (for a vertical move) or height (for a horizontal one). */
    originSideExtent: number;
}

/**
 * Measures `candidate` against `origin` for a move in `direction`.
 *
 * @param origin - The rectangle the move starts from.
 * @param candidate - The rectangle being considered.
 * @param direction - The direction of the move.
 * @returns The measure, or null when the candidate is not ahead of the
 *   origin — its near edge is more than {@link EDGE_TOLERANCE_PX} behind the
 *   origin's forward edge.
 */
export function measureInDirection(origin: Rect, candidate: Rect, direction: SpatialDirection): DirectionalMeasure | null {
    const { primary, originSpan, candidateSpan } = project(origin, candidate, direction);

    if (primary < -EDGE_TOLERANCE_PX) {
        return null;
    }

    return {
        forwardGap:       Math.max(0, primary),
        sideGap:          gapBetween(originSpan, candidateSpan),
        inLine:           spansOverlap(originSpan, candidateSpan),
        originSideExtent: originSpan.end - originSpan.start,
    };
}

/**
 * Whether `candidate` overlaps `reference` on the side axis of `direction` —
 * the test for "in line with the origin's group".
 *
 * @param reference - The rectangle to be in line with.
 * @param candidate - The rectangle being considered.
 * @param direction - The direction of the move.
 * @returns True when the two overlap on the side axis by more than zero.
 */
export function isInLineWith(reference: Rect, candidate: Rect, direction: SpatialDirection): boolean {
    const { originSpan, candidateSpan } = project(reference, candidate, direction);

    return spansOverlap(originSpan, candidateSpan);
}

/**
 * The score of one measured candidate; lower is better. An in-line candidate
 * scores its forward gap alone. An off-line one also pays
 * {@link OFF_AXIS_WEIGHT} times its side gap plus {@link ORIGIN_EXTENT_BIAS}
 * of the origin's side extent, so the sideways distance is measured from the
 * origin's centre line and a wide origin treats an off-line candidate as
 * further off than a small origin does. Rounded to whole pixels so sub-pixel
 * layout noise cannot reorder two candidates a person sees as equally near.
 *
 * @param measure - The candidate's measure against the origin.
 * @returns The rounded score.
 */
export function scoreOf(measure: DirectionalMeasure): number {
    const offAxis = measure.inLine ? 0 : measure.sideGap + ORIGIN_EXTENT_BIAS * measure.originSideExtent;

    return Math.round(measure.forwardGap + OFF_AXIS_WEIGHT * offAxis);
}

/**
 * Whether one search level accepts a measured candidate. An in-line candidate
 * is always accepted. A `"line"` level accepts nothing else. An `"open"`
 * level also accepts a candidate inside the cone — no further sideways than
 * {@link CONE_SLOPE} times its forward gap — and one in line with
 * `groupRect`.
 *
 * @param measure - The candidate's measure against the origin.
 * @param rect - The candidate's rectangle.
 * @param direction - The direction of the move.
 * @param acceptance - Which candidates the level accepts.
 * @param groupRect - The rectangle of the origin's nearest group, or null.
 * @returns True when the level accepts the candidate.
 */
function isAccepted(
    measure:    DirectionalMeasure,
    rect:       Rect,
    direction:  SpatialDirection,
    acceptance: LevelAcceptance,
    groupRect:  Rect | null,
): boolean {
    if (measure.inLine) {
        return true;
    }

    if (acceptance === "line") {
        return false;
    }

    if (measure.sideGap <= CONE_SLOPE * measure.forwardGap) {
        return true;
    }

    return groupRect !== null && isInLineWith(groupRect, rect, direction);
}

/**
 * The candidates one search level accepts for a move in `direction`, best
 * first. A candidate that is not ahead of `origin` is dropped; the rest are
 * kept when the level accepts them and ordered by {@link scoreOf}. Equal
 * scores keep the order `candidates` supplied them in.
 *
 * @param origin - The rectangle the move starts from.
 * @param candidates - The candidates to rank, in document order.
 * @param direction - The direction of the move.
 * @param acceptance - Which candidates the level accepts.
 * @param groupRect - The rectangle of the origin's nearest group, or null.
 *   Only an `"open"` level reads it.
 * @returns The accepted candidates' handles, best first.
 */
export function rankLevel(
    origin:     Rect,
    candidates: readonly SpatialCandidate[],
    direction:  SpatialDirection,
    acceptance: LevelAcceptance,
    groupRect:  Rect | null,
): Handle[] {
    const scored: Array<{ handle: Handle; score: number }> = [];

    for (const { handle, rect } of candidates) {
        const measure = measureInDirection(origin, rect, direction);

        if (measure === null) {
            continue;
        }

        const accepted = isAccepted(measure, rect, direction, acceptance, groupRect);

        if (accepted) {
            scored.push({ handle, score: scoreOf(measure) });
        }
    }

    // Array.prototype.sort is stable, so equal scores keep the supplied (document) order.
    scored.sort((a, b) => a.score - b.score);

    return scored.map(entry => entry.handle);
}
