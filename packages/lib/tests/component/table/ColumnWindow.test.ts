//
// Offline coverage for `computeColumnWindow` — the pure `[firstCol, lastCol]`
// derivation from a horizontal scroll offset, per-column widths, and the
// viewport width. Mirrors `computeVisibleWindow`'s row-window math one axis
// over; see plans/implemented/table-column-virtualization.md's Architecture
// Decisions for the inclusive-bounds rationale (a zero-width column must
// still render, which is the state every offline test and every pre-layout
// render sits in).
//
import { describe, it, expect } from 'vitest';
import { computeColumnWindow, computeColumnWindowSize } from '~/component/table/Body';

describe('computeColumnWindowSize', () => {
    it('sizes an 8-slot window for 20 columns of 100px in a 250px viewport', () => {
        const lefts = Array.from({ length: 20 }, (_, i) => i * 100);

        expect(computeColumnWindowSize(lefts, 250)).toBe(8);
    });

    it('sizes a 16-slot window for 20 columns of 100px in a 1000px viewport', () => {
        const lefts = Array.from({ length: 20 }, (_, i) => i * 100);

        expect(computeColumnWindowSize(lefts, 1000)).toBe(16);
    });

    it('caps at the column count when the derived size would exceed it', () => {
        const lefts = [0, 50, 350, 400, 700, 750];

        expect(computeColumnWindowSize(lefts, 400)).toBe(6);
    });

    it('returns the whole table when every left edge coincides (unknown widths, e.g. pre-layout)', () => {
        expect(computeColumnWindowSize([0, 0, 0], 0)).toBe(3);
    });

    it('returns 0 for zero columns', () => {
        expect(computeColumnWindowSize([], 250)).toBe(0);
    });
});

describe('computeColumnWindow — edge stability', () => {
    const lefts20At100 = Array.from({ length: 20 }, (_, i) => i * 100);

    it.each([
        [0, 0, 7],
        [550, 3, 10],
        [650, 4, 11],
        [1750, 12, 19],
    ])('scrollX %i returns [%i, %i], an 8-wide window', (scrollX, expectedFirst, expectedLast) => {
        const widths = Array(20).fill(100);

        const win = computeColumnWindow(widths, scrollX, 250);

        expect(win.firstCol).toBe(expectedFirst);
        expect(win.lastCol).toBe(expectedLast);
        expect(win.lastCol - win.firstCol + 1).toBe(8);
    });

    it('contains every raw-visible column at every one of those offsets', () => {
        const widths = Array(20).fill(100);

        for (const scrollX of [0, 550, 650, 1750]) {
            const win = computeColumnWindow(widths, scrollX, 250);
            const viewportRight = scrollX + 250;

            for (let i = 0; i < lefts20At100.length; i++) {
                const rawVisible = lefts20At100[i] + widths[i] >= scrollX && lefts20At100[i] <= viewportRight;

                if (rawVisible) {
                    expect(i).toBeGreaterThanOrEqual(win.firstCol);
                    expect(i).toBeLessThanOrEqual(win.lastCol);
                }
            }
        }
    });

    it('never clamps below 0 or above n-1, at the left edge and far past the content', () => {
        const widths = Array(20).fill(100);

        for (const scrollX of [0, 1_000_000]) {
            const win = computeColumnWindow(widths, scrollX, 250);

            expect(win.firstCol).toBeGreaterThanOrEqual(0);
            expect(win.lastCol).toBeLessThanOrEqual(19);
        }
    });

    it('renders every column, at every offset, when the column count is at or below the computed window size', () => {
        const widths = Array(3).fill(100);

        for (const scrollX of [0, 150, 300]) {
            const win = computeColumnWindow(widths, scrollX, 250);

            expect(win.firstCol).toBe(0);
            expect(win.lastCol).toBe(2);
        }
    });
});

describe('computeColumnWindow', () => {
    it('renders a fixed-width window at the left edge, not just the raw-visible run', () => {
        const widths = Array(20).fill(100);

        const win = computeColumnWindow(widths, 0, 250);

        expect(win.firstCol).toBe(0);
        expect(win.lastCol).toBe(7);
    });

    it('pads both edges by COLUMN_BUFFER mid-scroll', () => {
        const widths = Array(20).fill(100);

        const win = computeColumnWindow(widths, 550, 250);

        expect(win.firstCol).toBe(3);
        expect(win.lastCol).toBe(10);
    });

    it('slides the fixed-width window left instead of shrinking it, near the right edge', () => {
        const widths = Array(20).fill(100);

        const win = computeColumnWindow(widths, 1750, 250);

        expect(win.firstCol).toBe(12);
        expect(win.lastCol).toBe(19);
    });

    it('renders every column when every width is zero (unknown widths, e.g. pre-layout)', () => {
        const win = computeColumnWindow([0, 0, 0], 0, 0);

        expect(win.firstCol).toBe(0);
        expect(win.lastCol).toBe(2);
    });

    it('reports lastCol -1 and empty arrays for zero columns', () => {
        const win = computeColumnWindow([], 0, 250);

        expect(win.firstCol).toBe(0);
        expect(win.lastCol).toBe(-1);
        expect(win.widths).toEqual([]);
        expect(win.lefts).toEqual([]);
    });

    it('lefts is the running sum of widths', () => {
        const win = computeColumnWindow([100, 50, 200], 0, 1000);

        expect(win.lefts).toEqual([0, 100, 150]);
        expect(win.widths).toEqual([100, 50, 200]);
    });
});
