// Pure computational layer: the thin adapters over d3-scale. These assert the
// adapter wires the domain/range correctly and that the granular d3 submodules
// resolve and behave — d3's own interpolation maths is trusted.
import { describe, it, expect } from 'vitest';
import {
    linearScale,
    timeScale,
    bandScale,
    isBandScale,
    scaleTicks,
    tickPosition,
    tickFormatter,
    pointsXExtent,
    pointsYBounds,
} from '~/component/chart/Scale';

describe('linearScale', () => {
    it('maps domain endpoints to range endpoints with linear interpolation between', () => {
        // An already-nice domain so `.nice()` leaves the endpoints put.
        const scale = linearScale([0, 100], [0, 200]);

        expect(scale(0)).toBe(0);
        expect(scale(100)).toBe(200);
        expect(scale(50)).toBe(100);
    });

    it('supports an inverted range (a y axis: domain-max at the top)', () => {
        const scale = linearScale([0, 10], [300, 0]);

        expect(scale(0)).toBe(300);
        expect(scale(10)).toBe(0);
    });

    it('rounds a ragged domain to nice bounds via .nice()', () => {
        const scale = linearScale([0.3, 97.4], [0, 100]);
        const [lo, hi] = scale.domain();

        expect(lo).toBeLessThanOrEqual(0.3);
        expect(hi).toBeGreaterThanOrEqual(97.4);
        // Nice bounds are round multiples, not the ragged inputs.
        expect(lo).toBe(0);
        expect(hi).toBe(100);
    });

    it('yields nice tick values inside the domain', () => {
        const scale = linearScale([0, 100], [0, 100]);
        const ticks = scaleTicks(scale, 5) as number[];

        expect(ticks.length).toBeGreaterThan(0);
        for (const t of ticks) {
            expect(t).toBeGreaterThanOrEqual(0);
            expect(t).toBeLessThanOrEqual(100);
        }
    });
});

describe('bandScale', () => {
    it('divides N categories into equal bands within the range', () => {
        const scale = bandScale(['a', 'b', 'c', 'd'], [0, 400]);

        expect(scale.domain()).toEqual(['a', 'b', 'c', 'd']);
        // Equal bandwidth; edges sit inside the range.
        expect(scale.bandwidth()).toBeGreaterThan(0);
        expect(scale('a')!).toBeGreaterThanOrEqual(0);
        expect(scale('d')! + scale.bandwidth()).toBeLessThanOrEqual(400);
    });

    it('positions ticks at band centres', () => {
        const scale = bandScale(['a', 'b'], [0, 200]);
        const centreA = tickPosition(scale, 'a');
        const centreB = tickPosition(scale, 'b');

        expect(centreA).toBeCloseTo((scale('a')! + scale.bandwidth() / 2), 5);
        expect(centreB).toBeGreaterThan(centreA);
    });

    it('is recognised by isBandScale; a linear scale is not', () => {
        expect(isBandScale(bandScale(['x'], [0, 10]))).toBe(true);
        expect(isBandScale(linearScale([0, 1], [0, 10]))).toBe(false);
    });
});

describe('timeScale', () => {
    it('maps a [Date, Date] domain endpoints to the range', () => {
        const start = new Date(2020, 0, 1);
        const end = new Date(2020, 0, 31);
        const scale = timeScale([start, end], [0, 300]);

        // `.nice()` may widen to month bounds; the mapping is still monotone and
        // the requested endpoints land within the range.
        expect(scale(start)).toBeGreaterThanOrEqual(0);
        expect(scale(end)).toBeLessThanOrEqual(300);
        expect(scale(end)).toBeGreaterThan(scale(start));
    });

    it('produces Date tick values (confirms scaleTime + d3-time resolve)', () => {
        const scale = timeScale([new Date(2020, 0, 1), new Date(2020, 0, 31)], [0, 300]);
        const ticks = scaleTicks(scale, 4);

        expect(ticks.length).toBeGreaterThan(0);
        expect(ticks[0]).toBeInstanceOf(Date);
    });
});

describe('tick formatting', () => {
    it('formats continuous ticks with d3 tickFormat and band ticks with String', () => {
        const linear = linearScale([0, 1000], [0, 100]);
        const linearFmt = tickFormatter(linear, 5);

        expect(typeof linearFmt(500)).toBe('string');

        const band = bandScale(['north', 'south'], [0, 100]);
        const bandFmt = tickFormatter(band, 5);

        expect(bandFmt('north')).toBe('north');
    });
});

describe('domain helpers', () => {
    it('pointsXExtent spans the min and max x, falling back to [0,1] when empty', () => {
        expect(pointsXExtent([{ x: 3, y: 0 }, { x: 7, y: 0 }, { x: 1, y: 0 }])).toEqual([1, 7]);
        expect(pointsXExtent([])).toEqual([0, 1]);
    });

    it('pointsYBounds forces zero into the domain by default and takes the data max', () => {
        expect(pointsYBounds([{ x: 0, y: 5 }, { x: 1, y: 20 }])).toEqual([0, 20]);
        // Negative data keeps its own lower bound.
        expect(pointsYBounds([{ x: 0, y: -4 }, { x: 1, y: 8 }])).toEqual([-4, 8]);
        // Empty falls back.
        expect(pointsYBounds([])).toEqual([0, 1]);
    });

    it('pointsYBounds keeps a flat series from collapsing to zero height', () => {
        const [lo, hi] = pointsYBounds([{ x: 0, y: 5 }, { x: 1, y: 5 }]);

        expect(hi).toBeGreaterThan(lo);
    });
});
