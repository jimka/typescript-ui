// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// `revealedRect` and `spanRect` are the two rectangle rules a reveal through
// nested scrollers runs on. Cases R1–R5 and Q1–Q4 of
// plans/implemented/nested-scroll-reveal.md.
//
// A scroller is handed the rectangle to show, scrolls, and hands on what it
// then shows of it: the rectangle moved by the distance the scroll covered,
// with each edge held inside the scroller's own viewport. `revealedRect` is
// that rule. `spanRect` builds the rectangle of a row or a column: the span
// along one axis, the viewport's whole extent across it, cut to the viewport.
//
// Every rectangle is in browser-viewport coordinates and written as left, top,
// right, bottom. Each expected value below is worked out from those two
// statements, not read back from the functions.
import { describe, it, expect } from 'vitest';
import type { Rect } from '~/core/DOM';
import { revealedRect, spanRect } from '~/core/ScrollReveal';

/**
 * A rectangle from its four edges.
 *
 * @param left - The left edge.
 * @param top - The top edge.
 * @param right - The right edge.
 * @param bottom - The bottom edge.
 * @returns The rectangle, with all eight fields.
 */
function rect(left: number, top: number, right: number, bottom: number): Rect {
    return { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top };
}

/**
 * A rectangle's four edges.
 *
 * @param r - The rectangle.
 * @returns `[left, top, right, bottom]`.
 */
function edges(r: Rect): number[] {
    return [r.left, r.top, r.right, r.bottom];
}

// A scroll viewport covering 100–400 across and 100–300 down.
const VIEW = rect(100, 100, 400, 300);

describe('revealedRect', () => {
    it('R1: a rectangle inside the viewport is handed on as it is', () => {
        expect(edges(revealedRect(rect(150, 150, 190, 180), 0, 0, VIEW))).toEqual([150, 150, 190, 180]);
    });

    it('R2: a rectangle the scroll moved into view is handed on where it now is', () => {
        const shown = revealedRect(rect(150, 400, 190, 430), 0, -130, VIEW);

        // 400 − 130 and 430 − 130: flush with the viewport's bottom edge.
        expect(edges(shown)).toEqual([150, 270, 190, 300]);
        expect([shown.x, shown.y, shown.width, shown.height]).toEqual([150, 270, 40, 30]);
    });

    it('R3: a rectangle taller than the viewport is cut to it', () => {
        expect(edges(revealedRect(rect(150, 100, 190, 500), 0, 0, VIEW))).toEqual([150, 100, 190, 300]);
    });

    it('R4: a rectangle right of the viewport becomes its right edge, with no width', () => {
        const shown = revealedRect(rect(450, 150, 490, 180), 0, 0, VIEW);

        expect(edges(shown)).toEqual([400, 150, 400, 180]);
        expect(shown.width).toBe(0);
    });

    it('R5: a rectangle left of the viewport becomes its left edge', () => {
        expect(edges(revealedRect(rect(20, 150, 60, 180), 0, 0, VIEW))).toEqual([100, 150, 100, 180]);
    });
});

describe('spanRect', () => {
    it('Q1: a row is as high as its span and as wide as the viewport', () => {
        const row = spanRect(VIEW, 'y', 150, 180);

        expect(edges(row)).toEqual([100, 150, 400, 180]);
        expect([row.width, row.height]).toEqual([300, 30]);
    });

    it('Q2: a column is as wide as its span and as high as the viewport', () => {
        expect(edges(spanRect(VIEW, 'x', 150, 180))).toEqual([150, 100, 180, 300]);
    });

    it('Q3: a span cut by the viewport\'s end is cut to it', () => {
        expect(edges(spanRect(VIEW, 'y', 280, 340))).toEqual([100, 280, 400, 300]);
    });

    it('Q4: a span before the viewport becomes its leading edge, with no extent', () => {
        expect(edges(spanRect(VIEW, 'y', 20, 60))).toEqual([100, 100, 400, 100]);
    });
});
