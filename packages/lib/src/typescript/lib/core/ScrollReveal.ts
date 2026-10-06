// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * The scroll offset that brings a span of content into a scroll viewport by
 * the least movement. Shared by both scroll systems — `Panel` over native
 * `overflow` scrolling and `VirtualScroller` over transform-based virtual
 * lists — so "least scroll into view" means the same in a panel, a list, a
 * tree and a table.
 *
 * Every argument is a position along one axis of the scrolled content. The
 * viewport shows the content from `offset` to `offset + extent`.
 *
 * @param start - Where the span begins.
 * @param end - Where the span ends.
 * @param offset - The current scroll offset.
 * @param extent - The viewport's size along the axis.
 * @returns The offset to scroll to; `offset` itself when nothing should move.
 */
export function nearestRevealOffset(start: number, end: number, offset: number, extent: number): number {
    // A viewport with no extent shows nothing wherever it is scrolled to.
    // Written as a negated `>` so an unsized (NaN) extent takes this branch too.
    if (!(extent > 0)) {
        return offset;
    }

    const cutAtStart = start < offset;
    const cutAtEnd   = end > offset + extent;

    // Neither edge is cut: the span is in view. Both are cut: the span covers
    // the whole viewport, and no offset shows more of it.
    if (cutAtStart === cutAtEnd) {
        return offset;
    }

    const fits = end - start <= extent;

    // A span that fits moves until its cut edge is flush with the viewport.
    // One that does not fit moves until its other edge is flush, which fills
    // the viewport with it in the shortest move.
    if (cutAtStart === fits) {
        return start;
    }

    return end - extent;
}
