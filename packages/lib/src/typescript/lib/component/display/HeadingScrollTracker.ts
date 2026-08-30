// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { findActiveHeading } from "~/component/display/Markdown.js";
import type { MarkdownHeading } from "~/component/display/Markdown.js";

/**
 * Structural interface a scroll-owning host exposes so a {@link
 * HeadingScrollTracker} can read and write its scroll offset without
 * depending on `Component`.
 */
export interface HeadingScrollHost {
    getScrollTop(): number;
    setScrollTop(value: number): unknown;
}

/**
 * Tracks which heading is active as a pane scrolls, and scrolls the pane to
 * a chosen heading — the geometry technique shared by `MarkdownViewer` and
 * `DocsContent`, both of which pin the resolved heading to their own
 * `"activeheadingchange"` event.
 *
 * @category Components
 */
export class HeadingScrollTracker {

    private readonly _host: HeadingScrollHost;
    private readonly _onActiveHeadingChange: (headingId: string | null) => void;
    private _headings: MarkdownHeading[] = [];
    private _lastActiveHeadingId: string | null = null;

    /**
     * The scrollTop {@link scrollToHeading} last landed the host on, or
     * `null` once a later native scroll has moved past it. Lets {@link
     * trackScroll} recognise "nothing has organically scrolled since that
     * click" and skip re-deriving the active heading from geometry — see
     * both methods' own doc comments for why that re-derivation alone
     * cannot be trusted here.
     */
    private _pendingClickScrollTop: number | null = null;

    constructor(host: HeadingScrollHost, onActiveHeadingChange: (headingId: string | null) => void) {
        this._host = host;
        this._onActiveHeadingChange = onActiveHeadingChange;
    }

    /**
     * Replaces the tracked headings. Leaves the last-active id and the
     * click pin untouched — neither resets on a page change today, and this
     * class is behaviour-preserving relative to the two copies it replaces.
     *
     * @param headings - The document's headings, in document order.
     */
    setHeadings(headings: MarkdownHeading[]): void {
        this._headings = headings;
    }

    /**
     * The currently tracked headings, in document order.
     *
     * @returns The headings passed to the most recent {@link setHeadings} call.
     */
    getHeadings(): MarkdownHeading[] {
        return this._headings;
    }

    /**
     * Computes the active heading from the current native scroll position and
     * emits the change callback only when it differs from the previous tick.
     * A no-op while the pane is still sitting exactly where {@link
     * scrollToHeading} last left it (see `_pendingClickScrollTop`'s own doc
     * comment) — geometry alone can't be trusted to reproduce that click's
     * own target there, so this defers to whatever it already set.
     *
     * @param scrollElement - The pane's scroll-owning element.
     */
    trackScroll(scrollElement: Handle): void {
        if (this._pendingClickScrollTop !== null) {
            // Reads the live DOM value, not the cached getScrollTop(): an
            // organic scroll (wheel, scrollbar drag) updates the pane's real
            // scrollTop without ever going through setScrollTop, so the cache
            // would otherwise still read the click's own landing spot forever.
            if (DOM.source.getScrollTop(scrollElement) === this._pendingClickScrollTop) {
                return;
            }

            this._pendingClickScrollTop = null;
        }

        const id = findActiveHeading(scrollElement, this._headings);

        this.setActiveHeading(id);
    }

    /**
     * Scrolls the host so `id`'s heading sits at the pane's own top edge.
     * Marks `id` active immediately rather than waiting for the resulting
     * native scroll event to drive that through `findActiveHeading`: a
     * heading close to the document's end can share its clamped landing
     * scrollTop with a neighbouring heading, and geometry alone then can't
     * tell which of them this click actually targeted (`findActiveHeading`'s
     * own doc comment).
     *
     * @param scrollElement - The pane's scroll-owning element.
     * @param id - The heading id to scroll to.
     */
    scrollToHeading(scrollElement: Handle, id: string): void {
        const heading = DOM.source.getElementById(id);

        if (!heading || !DOM.source.contains(scrollElement, heading)) {
            return;
        }

        const headingTop = DOM.source.getElementRect(heading).top;
        const paneTop     = DOM.source.getElementRect(scrollElement).top;

        this._host.setScrollTop(this._host.getScrollTop() + (headingTop - paneTop));
        this._pendingClickScrollTop = this._host.getScrollTop();

        this.setActiveHeading(id);
    }

    /** Fires the change callback only when the resolved id actually differs. */
    private setActiveHeading(id: string | null): void {
        if (id === this._lastActiveHeadingId) {
            return;
        }

        this._lastActiveHeadingId = id;
        this._onActiveHeadingChange(id);
    }
}
