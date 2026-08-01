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
import { computeColumnWindow } from '~/component/table/Body';

describe('computeColumnWindow', () => {
    it('renders the raw-visible run plus COLUMN_BUFFER on each side, clamped at the left edge', () => {
        const widths = Array(20).fill(100);

        const win = computeColumnWindow(widths, 0, 250);

        expect(win.firstCol).toBe(0);
        expect(win.lastCol).toBe(4);
    });

    it('pads both edges by COLUMN_BUFFER mid-scroll', () => {
        const widths = Array(20).fill(100);

        const win = computeColumnWindow(widths, 550, 250);

        expect(win.firstCol).toBe(3);
        expect(win.lastCol).toBe(10);
    });

    it('clamps lastCol to the final column index near the right edge', () => {
        const widths = Array(20).fill(100);

        const win = computeColumnWindow(widths, 1750, 250);

        expect(win.firstCol).toBe(15);
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
