// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Rect } from "~/core/DOM.js";
import type { ScrollAxis } from "~/core/SmoothScroller.js";

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

/**
 * What a scroll viewport shows of a rectangle after scrolling it: `rect`
 * moved by (`dx`, `dy`), with each edge held inside `view`. A rectangle that
 * ends up wholly outside the viewport along an axis collapses to the
 * viewport's nearer edge on that axis.
 *
 * All four arguments and the result are in browser-viewport coordinates.
 *
 * @param rect - The rectangle before the scroll.
 * @param dx - How far the scroll moved the content to the right; negative for a move to the left.
 * @param dy - How far the scroll moved the content down; negative for a move up.
 * @param view - The scroll viewport.
 * @returns The part of the moved rectangle that shows through `view`.
 */
export function revealedRect(rect: Rect, dx: number, dy: number, view: Rect): Rect {
    const left   = Math.min(Math.max(rect.left   + dx, view.left), view.right);
    const right  = Math.min(Math.max(rect.right  + dx, view.left), view.right);
    const top    = Math.min(Math.max(rect.top    + dy, view.top),  view.bottom);
    const bottom = Math.min(Math.max(rect.bottom + dy, view.top),  view.bottom);

    return { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top };
}

/**
 * The rectangle a span of scrolled content shows through a scroll viewport:
 * the span along `axis`, the viewport's whole extent across it, cut to the
 * viewport. A list row is one — as high as the row and as wide as the list.
 *
 * All arguments and the result are in browser-viewport coordinates.
 *
 * @param view - The scroll viewport.
 * @param axis - The axis the span runs along.
 * @param from - Where the span begins.
 * @param to - Where the span ends.
 * @returns The part of the span that shows through `view`.
 */
export function spanRect(view: Rect, axis: ScrollAxis, from: number, to: number): Rect {
    const span: Rect = axis === "y"
        ? { ...view, y: from, top: from, bottom: to, height: to - from }
        : { ...view, x: from, left: from, right: to, width: to - from };

    return revealedRect(span, 0, 0, view);
}
