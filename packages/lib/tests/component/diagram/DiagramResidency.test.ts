//
// Offline coverage for the four pure functions behind DiagramView and
// DiagramEdgeLayer's shared residency window: `inflateRect` (grows a
// rectangle by a fraction of its own extent), `residencyNeedsRefresh` (the
// hysteresis gate deciding when the residency rect must be recomputed),
// `computeResidentIds` (the intersection test the residency pass
// mounts/unmounts, or draws/releases, from), and `rectsIntersect` /
// `anyRectIntersects` (the shared box-overlap predicate `computeResidentIds`
// and `DiagramView`'s off-screen floor both build on). See
// plans/implemented/diagram-node-virtualization.md's Architecture Decisions
// for the viewport-sized, hysteresis-placed rationale these mirror from
// `computeColumnWindowSize` / `computeColumnWindow`.
//
import { describe, it, expect } from 'vitest';
import { inflateRect, residencyNeedsRefresh, computeResidentIds, rectsIntersect, anyRectIntersects } from '~/component/diagram/DiagramResidency';
import type { DiagramRect } from '~/component/diagram/DiagramResidency';

describe('inflateRect', () => {
    it('inflates by half the rect\'s own extent on each side', () => {
        expect(inflateRect({ x: 0, y: 0, width: 1000, height: 600 }, 0.5))
            .toEqual({ x: -500, y: -300, width: 2000, height: 1200 });
    });

    it('inflates by a quarter of the rect\'s own extent on each side', () => {
        expect(inflateRect({ x: 0, y: 0, width: 1000, height: 600 }, 0.25))
            .toEqual({ x: -250, y: -150, width: 1500, height: 900 });
    });

    it('returns the same rect for a zero fraction', () => {
        expect(inflateRect({ x: 100, y: 50, width: 200, height: 100 }, 0))
            .toEqual({ x: 100, y: 50, width: 200, height: 100 });
    });
});

describe('residencyNeedsRefresh', () => {
    const committed: DiagramRect = { x: 0, y: 0, width: 1000, height: 600 };
    const margin = 0.5;

    it('is true when nothing has been committed yet', () => {
        expect(residencyNeedsRefresh(null, { x: 0, y: 0, width: 1000, height: 600 }, margin)).toBe(true);
    });

    it('is false for the identical rectangle', () => {
        expect(residencyNeedsRefresh(committed, { x: 0, y: 0, width: 1000, height: 600 }, margin)).toBe(false);
    });

    it('is false when the right edge stays inside the trigger rect', () => {
        expect(residencyNeedsRefresh(committed, { x: 200, y: 0, width: 1000, height: 600 }, margin)).toBe(false);
    });

    it('is true once the right edge passes the trigger rect\'s edge', () => {
        expect(residencyNeedsRefresh(committed, { x: 300, y: 0, width: 1000, height: 600 }, margin)).toBe(true);
    });

    it('is true when the extents shrink (a zoom in)', () => {
        expect(residencyNeedsRefresh(committed, { x: 0, y: 0, width: 500, height: 300 }, margin)).toBe(true);
    });

    it('is true when the extents grow (a zoom out)', () => {
        expect(residencyNeedsRefresh(committed, { x: 0, y: 0, width: 2000, height: 1200 }, margin)).toBe(true);
    });

    it('is true once the left edge escapes, false while it stays inside', () => {
        expect(residencyNeedsRefresh(committed, { x: -300, y: 0, width: 1000, height: 600 }, margin)).toBe(true);
        expect(residencyNeedsRefresh(committed, { x: -200, y: 0, width: 1000, height: 600 }, margin)).toBe(false);
    });

    it('is true for a vertical-only escape', () => {
        expect(residencyNeedsRefresh(committed, { x: 0, y: 200, width: 1000, height: 600 }, margin)).toBe(true);
    });
});

describe('computeResidentIds', () => {
    const residency: DiagramRect = { x: -500, y: -300, width: 2000, height: 1200 };

    it('includes a box fully inside the viewport', () => {
        const rects = new Map([['a', { x: 100, y: 100, width: 80, height: 40 }]]);

        expect(computeResidentIds(['a'], rects, residency)).toEqual(new Set(['a']));
    });

    it('includes a box outside the viewport but inside the residency rect', () => {
        const rects = new Map([['a', { x: 1200, y: 0, width: 80, height: 40 }]]);

        expect(computeResidentIds(['a'], rects, residency)).toEqual(new Set(['a']));
    });

    it('excludes a box starting past the residency rect\'s right edge', () => {
        const rects = new Map([['a', { x: 1600, y: 0, width: 80, height: 40 }]]);

        expect(computeResidentIds(['a'], rects, residency)).toEqual(new Set());
    });

    it('includes a container box straddling the residency rect', () => {
        const rects = new Map([['a', { x: -600, y: -400, width: 2000, height: 1000 }]]);

        expect(computeResidentIds(['a'], rects, residency)).toEqual(new Set(['a']));
    });

    it('treats a box touching the residency rect edge-to-edge as resident (inclusive intersection)', () => {
        const rects = new Map([['a', { x: 1500, y: 0, width: 80, height: 40 }]]);

        expect(computeResidentIds(['a'], rects, residency)).toEqual(new Set(['a']));
    });

    it('always includes an id with no entry in rects', () => {
        const rects = new Map<string, DiagramRect>();

        expect(computeResidentIds(['a'], rects, residency)).toEqual(new Set(['a']));
    });

    it('returns an empty set for empty ids', () => {
        const rects = new Map([['a', { x: 100, y: 100, width: 80, height: 40 }]]);

        expect(computeResidentIds([], rects, residency)).toEqual(new Set());
    });

    it('treats a zero-area box inside the rect as resident', () => {
        const rects = new Map([['a', { x: 100, y: 100, width: 0, height: 0 }]]);

        expect(computeResidentIds(['a'], rects, residency)).toEqual(new Set(['a']));
    });
});

describe('rectsIntersect', () => {
    it('returns true for two overlapping boxes', () => {
        expect(rectsIntersect({ x: 0, y: 0, width: 100, height: 100 }, { x: 50, y: 50, width: 100, height: 100 })).toBe(true);
    });

    it('returns true for boxes touching edge-to-edge (inclusive intersection)', () => {
        expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(true);
    });

    it('returns false for boxes separated on x only', () => {
        expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 11, y: 0, width: 10, height: 10 })).toBe(false);
    });

    it('returns false for boxes separated on y only', () => {
        expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 11, width: 10, height: 10 })).toBe(false);
    });
});

describe('anyRectIntersects', () => {
    const area: DiagramRect = { x: 0, y: 0, width: 100, height: 100 };

    it('returns false for an empty iterable', () => {
        expect(anyRectIntersects([], area)).toBe(false);
    });

    it('returns true when one box out of several overlaps', () => {
        const rects: DiagramRect[] = [
            { x: 500, y: 500, width: 10, height: 10 },
            { x: 50, y: 50, width: 10, height: 10 },
        ];

        expect(anyRectIntersects(rects, area)).toBe(true);
    });

    it('returns false when no box overlaps', () => {
        const rects: DiagramRect[] = [
            { x: 500, y: 500, width: 10, height: 10 },
            { x: -500, y: -500, width: 10, height: 10 },
        ];

        expect(anyRectIntersects(rects, area)).toBe(false);
    });
});
