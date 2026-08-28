//
// Offline coverage for the two pure functions behind DiagramView's low-zoom
// node simplification: `medianLeafHeight` (the rendered-size statistic the
// trigger reads) and `shouldSimplify` (the node-count-floor-plus-hysteresis
// gate deciding whether the view draws plain rects instead of node
// components). See plans/implemented/diagram-level-of-detail-rendering.md's
// Architecture Decisions for the "trigger is rendered node height plus a
// node-count floor" rationale, and DiagramResidency.test.ts for the sibling
// suite this mirrors.
//
import { describe, it, expect } from 'vitest';
import { medianLeafHeight, shouldSimplify } from '~/component/diagram/DiagramView';
import type { DiagramRect } from '~/component/diagram/DiagramResidency';

describe('medianLeafHeight', () => {
    function rectsOf(heights: number[]): Map<string, DiagramRect> {
        return new Map(heights.map((height, i) => [String(i), { x: 0, y: 0, width: 100, height }]));
    }

    it('is the middle value of an odd-sized set', () => {
        expect(medianLeafHeight(rectsOf([10, 20, 30]), new Set())).toBe(20);
    });

    it('is the upper of the two middle values for an even-sized set', () => {
        expect(medianLeafHeight(rectsOf([10, 20, 30, 40]), new Set())).toBe(30);
    });

    it('excludes container boxes from the statistic', () => {
        const rects = new Map([
            ['a', { x: 0, y: 0, width: 100, height: 10 }],
            ['b', { x: 0, y: 0, width: 100, height: 20 }],
            ['c', { x: 0, y: 0, width: 100, height: 900 }],
        ]);

        expect(medianLeafHeight(rects, new Set(['c']))).toBe(20);
    });

    it('is 0 for an empty rects map', () => {
        expect(medianLeafHeight(new Map(), new Set())).toBe(0);
    });

    it('is 0 when every box is a container', () => {
        const rects = new Map([
            ['a', { x: 0, y: 0, width: 100, height: 10 }],
            ['b', { x: 0, y: 0, width: 100, height: 20 }],
        ]);

        expect(medianLeafHeight(rects, new Set(['a', 'b']))).toBe(0);
    });
});

describe('shouldSimplify', () => {
    // The worked table from the plan's Architecture Decisions.
    it('a 332-node graph at zoom 1 (30px rendered) is not simplified', () => {
        expect(shouldSimplify(332, 30, 1, false)).toBe(false);
    });

    it('the same graph at fit zoom (7.1px rendered) is simplified', () => {
        expect(shouldSimplify(332, 30, 0.237, false)).toBe(true);
    });

    it('zoomed part-way back in (18px, inside the hysteresis band) stays simplified', () => {
        expect(shouldSimplify(332, 30, 0.6, true)).toBe(true);
    });

    it('zoomed further in still (21px, past the disengage height) is not simplified', () => {
        expect(shouldSimplify(332, 30, 0.7, true)).toBe(false);
    });

    it('a 12-node graph at min zoom (7.5px rendered) never simplifies — under the node-count floor', () => {
        expect(shouldSimplify(12, 30, 0.25, false)).toBe(false);
    });

    it('a 240-card graph at min zoom (50px rendered) never simplifies — the cards stay legible', () => {
        expect(shouldSimplify(240, 200, 0.25, false)).toBe(false);
    });

    it('a graph with no laid-out leaf boxes yet (medianHeight 0) never simplifies', () => {
        expect(shouldSimplify(332, 0, 1, false)).toBe(false);
    });

    it('exactly the node-count floor (200) with a 7px rendered height simplifies', () => {
        expect(shouldSimplify(200, 7, 1, false)).toBe(true);
    });

    it('one below the node-count floor (199) never simplifies, all else equal', () => {
        expect(shouldSimplify(199, 7, 1, false)).toBe(false);
    });

    it('exactly the engage height (16px) while not simplified does not engage — the comparison is strict', () => {
        expect(shouldSimplify(332, 16, 1, false)).toBe(false);
    });

    it('exactly the disengage height (20px) while simplified disengages', () => {
        expect(shouldSimplify(332, 20, 1, true)).toBe(false);
    });

    it('a negative medianHeight never simplifies', () => {
        expect(shouldSimplify(332, -10, 1, false)).toBe(false);
    });

    it('a NaN medianHeight never simplifies', () => {
        expect(shouldSimplify(332, NaN, 1, false)).toBe(false);
    });
});
