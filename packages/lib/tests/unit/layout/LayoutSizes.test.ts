import { describe, it, expect } from 'vitest';
import { toLayoutSizes, fromLayoutSizes, isRestorableSizes, normalizeRatios } from '~/layout/LayoutSizes';

describe('normalizeRatios', () => {
    it('normalises relative weights to ratios summing to 1.0', () => {
        expect(normalizeRatios([1, 3], 2)).toEqual([0.25, 0.75]);
    });

    it('normalises already-relative input identically', () => {
        expect(normalizeRatios([2, 6], 2)).toEqual([0.25, 0.75]);
    });

    it('falls back to an equal split when no value is positive, and sanitises bad input', () => {
        expect(normalizeRatios([0, 0], 2)).toEqual([0.5, 0.5]);
        expect(normalizeRatios([1, -5, NaN, Infinity], 4)).toEqual([1, 0, 0, 0]);
        expect(normalizeRatios([1], 3)).toEqual([1, 0, 0]);
        expect(normalizeRatios([1, 2], 0)).toEqual([]);
    });
});

describe('toLayoutSizes', () => {
    it('reports px entries verbatim and normalises ratios over the ratio subset only', () => {
        const sizes = toLayoutSizes(['px', 'ratio', 'ratio'], [400, 100, 300]);

        expect(sizes).toEqual([
            { unit: 'px', value: 400 },
            { unit: 'ratio', value: 0.25 },
            { unit: 'ratio', value: 0.75 },
        ]);
    });

    it('leaves an all-px array untouched, with nothing normalised', () => {
        const sizes = toLayoutSizes(['px', 'px'], [200, 300]);

        expect(sizes).toEqual([
            { unit: 'px', value: 200 },
            { unit: 'px', value: 300 },
        ]);
    });

    it('falls back to an equal split among the ratio entries when none is stored', () => {
        const sizes = toLayoutSizes(['px', 'ratio', 'ratio'], [400, 0, 0]);

        expect(sizes).toEqual([
            { unit: 'px', value: 400 },
            { unit: 'ratio', value: 0.5 },
            { unit: 'ratio', value: 0.5 },
        ]);
    });

    it('sanitises non-finite or negative stored values', () => {
        const sizes = toLayoutSizes(['px', 'ratio'], [NaN, -3]);

        expect(sizes).toEqual([
            { unit: 'px', value: 0 },
            { unit: 'ratio', value: 1 },
        ]);
    });
});

describe('fromLayoutSizes', () => {
    it('seeds the weighted set against budget minus the px total', () => {
        const stored = fromLayoutSizes(
            [{ unit: 'px', value: 400 }, { unit: 'ratio', value: 0.25 }, { unit: 'ratio', value: 0.75 }],
            1200
        );

        expect(stored).toEqual([400, 200, 600]);
    });

    it('round-trips toLayoutSizes', () => {
        const units  = ['px', 'ratio', 'ratio'] as const;
        const stored = [400, 200, 600];

        const roundTripped = fromLayoutSizes(toLayoutSizes([...units], stored), 1200);

        expect(roundTripped).toEqual(stored);
    });

    it('falls back to a unit base when the budget is 0 (detached)', () => {
        const stored = fromLayoutSizes(
            [{ unit: 'px', value: 400 }, { unit: 'ratio', value: 0.25 }, { unit: 'ratio', value: 0.75 }],
            0
        );

        expect(stored).toEqual([400, 0.25, 0.75]);
    });

    it('falls back to a unit base when the px entries alone overrun the budget', () => {
        const stored = fromLayoutSizes(
            [{ unit: 'px', value: 400 }, { unit: 'ratio', value: 1 }],
            300
        );

        expect(stored).toEqual([400, 1]);
    });
});

describe('isRestorableSizes', () => {
    it('accepts a matching array', () => {
        expect(isRestorableSizes([{ unit: 'px', value: 400 }, { unit: 'ratio', value: 1 }], ['px', 'ratio'])).toBe(true);
    });

    it('rejects a length mismatch', () => {
        expect(isRestorableSizes([{ unit: 'ratio', value: 1 }], ['px', 'ratio'])).toBe(false);
        expect(isRestorableSizes([{ unit: 'px', value: 1 }, { unit: 'ratio', value: 1 }], ['px'])).toBe(false);
    });

    it('rejects a unit mismatch', () => {
        expect(isRestorableSizes([{ unit: 'ratio', value: 0.5 }, { unit: 'ratio', value: 0.5 }], ['px', 'ratio'])).toBe(false);
    });

    it('rejects non-finite, negative, or all-zero values, and an empty array', () => {
        expect(isRestorableSizes([{ unit: 'px', value: NaN }, { unit: 'ratio', value: 1 }], ['px', 'ratio'])).toBe(false);
        expect(isRestorableSizes([{ unit: 'px', value: -1 }, { unit: 'ratio', value: 1 }], ['px', 'ratio'])).toBe(false);
        expect(isRestorableSizes([{ unit: 'px', value: 0 }, { unit: 'ratio', value: 0 }], ['px', 'ratio'])).toBe(false);
        expect(isRestorableSizes([], [])).toBe(false);
    });
});
