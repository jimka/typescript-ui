// SpatialRanking is the pure half of the control chord (`Ctrl+Alt`+arrow): it
// reads no DOM, so every case here is `Rect` literals in and handles out, with
// no offline harness installed. The numbered cases E-1 to E-9 are the plan's
// `## Expected Behaviour` table for `rankLevel`; the expected values are
// derived from rules S1 (acceptance) and SC1 (the score), not from what the
// module happens to return.
import { describe, it, expect } from 'vitest';
import {
    CONE_SLOPE,
    EDGE_TOLERANCE_PX,
    MIN_VISIBLE_PX,
    OFF_AXIS_WEIGHT,
    ORIGIN_EXTENT_BIAS,
    isInLineWith,
    measureInDirection,
    rankLevel,
    scoreOf,
} from '~/core/SpatialRanking';
import type { SpatialCandidate, SpatialDirection } from '~/core/SpatialNavigation';
import type { Handle, Rect } from '~/core/DOM';

/** A Rect literal from its four edges — the shape every ranking function consumes. */
function rect(left: number, top: number, right: number, bottom: number): Rect {
    return { x: left, y: top, width: right - left, height: bottom - top, top, left, right, bottom };
}

/** A synthetic handle identifying a candidate — never resolved against real DOM. */
function handle(n: number): Handle {
    return n as Handle;
}

function candidate(n: number, r: Rect): SpatialCandidate {
    return { handle: handle(n), rect: r };
}

// The worked table of rule SC1. Origin O, arrow east: the side axis is
// vertical and O's extent on it is 20.
const O = rect(0, 0, 100, 20);
const A = candidate(1, rect(120, 0, 160, 20));   // in line, forward 20                       -> 20
const B = candidate(2, rect(105, 30, 140, 50));  // forward 5, side gap 10: outside the cone  -> rejected
const C = candidate(3, rect(150, 40, 190, 60));  // forward 50, side gap 20: in the cone      -> 50 + 2 x (20 + 10) = 110
const F = candidate(4, rect(700, 0, 760, 20));   // in line, forward 600                      -> 600
const N = candidate(5, rect(110, 24, 150, 44));  // forward 10, side gap 4: in the cone       -> 10 + 2 x (4 + 10) = 38

describe('SpatialRanking constants', () => {
    it('carries the documented tuning values', () => {
        expect(EDGE_TOLERANCE_PX).toBe(1);
        expect(OFF_AXIS_WEIGHT).toBe(2);
        expect(ORIGIN_EXTENT_BIAS).toBe(0.5);
        expect(CONE_SLOPE).toBe(1);
        expect(MIN_VISIBLE_PX).toBe(4);
    });
});

describe('measureInDirection', () => {
    it('reports forward gap, side gap, in-line and the origin\'s side extent for a candidate ahead', () => {
        expect(measureInDirection(O, C.rect, 'east'))
            .toEqual({ forwardGap: 50, sideGap: 20, inLine: false, originSideExtent: 20 });
        expect(measureInDirection(O, A.rect, 'east'))
            .toEqual({ forwardGap: 20, sideGap: 0, inLine: true, originSideExtent: 20 });
    });

    it('does not count touching edges on the side axis as in line', () => {
        // Directly below-right: its top edge is exactly O's bottom edge.
        const touching = rect(120, 20, 160, 40);
        const measure = measureInDirection(O, touching, 'east');

        expect(measure).toEqual({ forwardGap: 20, sideGap: 0, inLine: false, originSideExtent: 20 });
    });

    it('returns null for a candidate that is not ahead', () => {
        expect(measureInDirection(O, rect(-50, 0, -10, 20), 'east')).toBeNull();
    });

    it('counts a candidate overlapping the forward edge by exactly EDGE_TOLERANCE_PX as ahead, and one overlapping by more as not', () => {
        // O's forward edge for an east move is x = 100.
        expect(measureInDirection(O, rect(99, 0, 140, 20), 'east')?.forwardGap).toBe(0);
        expect(measureInDirection(O, rect(98.9, 0, 140, 20), 'east')).toBeNull();
    });
});

describe('scoreOf', () => {
    it('scores an in-line candidate by its forward gap alone', () => {
        expect(scoreOf({ forwardGap: 600, sideGap: 0, inLine: true, originSideExtent: 20 })).toBe(600);
    });

    it('charges an off-line candidate its side gap plus half the origin\'s side extent, at OFF_AXIS_WEIGHT', () => {
        expect(scoreOf({ forwardGap: 50, sideGap: 20, inLine: false, originSideExtent: 20 })).toBe(110);
        expect(scoreOf({ forwardGap: 10, sideGap: 4, inLine: false, originSideExtent: 20 })).toBe(38);
    });

    it('rounds to whole pixels so sub-pixel layout noise cannot reorder a tie', () => {
        expect(scoreOf({ forwardGap: 20.4, sideGap: 0, inLine: true, originSideExtent: 20 })).toBe(20);
        expect(scoreOf({ forwardGap: 19.6, sideGap: 0, inLine: true, originSideExtent: 20 })).toBe(20);
    });
});

describe('isInLineWith', () => {
    it('is true when the candidate overlaps the reference on the side axis, false when it only touches or misses', () => {
        const bar = rect(0, 0, 800, 24);

        expect(isInLineWith(bar, rect(0, 32, 250, 56), 'south')).toBe(true);
        expect(isInLineWith(bar, rect(800, 32, 900, 56), 'south')).toBe(false); // touches the right edge
        expect(isInLineWith(bar, rect(0, 32, 250, 56), 'east')).toBe(false);    // wholly below, for a sideways move
    });
});

describe('rankLevel', () => {
    it('E-1: the search root accepts in-line and cone candidates and rejects one that is neither', () => {
        expect(rankLevel(O, [A, B, C], 'east', 'open', null)).toEqual([A.handle, C.handle]);
    });

    it('E-2: a group or scroll-viewport level accepts only in-line candidates', () => {
        expect(rankLevel(O, [A, B, C], 'east', 'line', null)).toEqual([A.handle]);
    });

    it('E-3: at the search root, near and slightly off line beats far and in line', () => {
        expect(rankLevel(O, [F, N], 'east', 'open', null)).toEqual([N.handle, F.handle]);
    });

    it('E-4: inside a row, the row wins — the off-line candidate is not accepted at all', () => {
        expect(rankLevel(O, [F, N], 'east', 'line', null)).toEqual([F.handle]);
    });

    it('E-5: a candidate outside the cone is accepted when it is in line with the origin\'s group, and rejected without one', () => {
        // A tool bar button at x 300-320; a form field 8px below, at x 0-250.
        const button = rect(300, 0, 320, 24);
        const field = candidate(1, rect(0, 32, 250, 56));
        const toolBar = rect(0, 0, 800, 24);

        expect(rankLevel(button, [field], 'south', 'open', toolBar)).toEqual([field.handle]);
        expect(rankLevel(button, [field], 'south', 'open', null)).toEqual([]);
    });

    it('E-5: the group-line candidate still pays the off-line cost — forward 8, side gap 50, half extent 10', () => {
        const measure = measureInDirection(rect(300, 0, 320, 24), rect(0, 32, 250, 56), 'south');

        expect(measure).not.toBeNull();
        expect(scoreOf(measure!)).toBe(128);
    });

    it('E-6: from Refresh, the three-dots button far below is rejected and the dock tab in the same row wins', () => {
        const refresh = rect(235, 59, 257, 81);
        const header = rect(41, 59, 279, 81);
        const columnOptions = candidate(1, rect(262, 614, 274, 634));
        const dockTab = candidate(2, rect(281, 57, 380, 81));

        expect(rankLevel(refresh, [columnOptions, dockTab], 'east', 'open', header)).toEqual([dockTab.handle]);
    });

    it('E-7: equal scores keep the supplied (document) order', () => {
        const origin = rect(0, 100, 300, 120);
        const q = candidate(1, rect(70, 60, 120, 98));
        const p = candidate(2, rect(10, 60, 60, 98));

        expect(rankLevel(origin, [q, p], 'north', 'open', null)).toEqual([q.handle, p.handle]);
        expect(rankLevel(origin, [p, q], 'north', 'open', null)).toEqual([p.handle, q.handle]);
    });

    it('E-8: a candidate straddling the origin\'s forward edge, or behind it, is not ahead; a sub-pixel overlap is, at forward gap 0', () => {
        const straddling = candidate(1, rect(90, 0, 140, 20));   // overlaps O's right edge by 10
        const behind = candidate(2, rect(-50, 0, -10, 20));
        const subPixel = candidate(3, rect(99.5, 0, 140, 20));   // overlaps by 0.5, inside EDGE_TOLERANCE_PX

        expect(rankLevel(O, [straddling, behind, subPixel], 'east', 'open', null)).toEqual([subPixel.handle]);
        expect(measureInDirection(O, subPixel.rect, 'east')?.forwardGap).toBe(0);
    });

    it('E-9: the off-line cost follows the origin\'s size — a wide origin goes straight down, a tiny one accepts the near diagonal', () => {
        const propertiesTitle = rect(47, 587, 257, 609);
        const columnOptions = rect(262, 614, 274, 634);
        const tableBody = rect(46, 635, 274, 824);
        const tree = rect(41, 81, 279, 585);

        // From the 210px-wide title: table body 26, three-dots 5 + 2 x (5 + 105) = 225.
        expect(rankLevel(propertiesTitle, [candidate(1, columnOptions), candidate(2, tableBody)], 'south', 'open', null))
            .toEqual([handle(2), handle(1)]);

        // From the 12px-wide three-dots button: title 5 + 2 x (5 + 6) = 27, tree 29.
        expect(rankLevel(columnOptions, [candidate(3, propertiesTitle), candidate(4, tree)], 'north', 'open', null))
            .toEqual([handle(3), handle(4)]);
    });

    it('returns [] for an empty candidate list', () => {
        expect(rankLevel(O, [], 'east', 'open', null)).toEqual([]);
    });

    it('mirrors E-1 through all four directions', () => {
        /** A rect given as forward and side ranges, turned to face `direction`. */
        function facing(direction: SpatialDirection, forward: [number, number], side: [number, number]): Rect {
            switch (direction) {
                case 'east':  return rect(forward[0], side[0], forward[1], side[1]);
                case 'west':  return rect(-forward[1], side[0], -forward[0], side[1]);
                case 'south': return rect(side[0], forward[0], side[1], forward[1]);
                case 'north': return rect(side[0], -forward[1], side[1], -forward[0]);
            }
        }

        for (const direction of ['north', 'south', 'east', 'west'] as SpatialDirection[]) {
            const origin = facing(direction, [0, 100], [0, 20]);
            const a = candidate(1, facing(direction, [120, 160], [0, 20]));
            const b = candidate(2, facing(direction, [105, 140], [30, 50]));
            const c = candidate(3, facing(direction, [150, 190], [40, 60]));

            expect(rankLevel(origin, [a, b, c], direction, 'open', null)).toEqual([a.handle, c.handle]);
            expect(rankLevel(origin, [a, b, c], direction, 'line', null)).toEqual([a.handle]);
        }
    });
});
