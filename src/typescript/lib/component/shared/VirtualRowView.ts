// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { VirtualScroller } from "~/component/container/VirtualScroller.js";

/** Number of off-screen rows to render above and below the visible viewport. */
const SCROLL_BUFFER = 2;

/**
 * Shared transform-windowed virtual-scroll base for the data views —
 * `table/Body` and `tree/Tree` are its only two subclasses. It owns the
 * recycled row pool (`_rowPool` and the parallel `_boundIndices` / `_rowGeom` /
 * `_rowDisplayed` bookkeeping arrays), the {@link VirtualScroller} wiring, and
 * the window / pool-growth / geometry reconciliation primitives each subclass's
 * render pass composes.
 *
 * Only two things genuinely diverge between the two consumers, so only those
 * are hooks:
 *
 * - **Row height** — `Body` derives it live from the theme line box; `Tree`
 *   uses a fixed constant. Read through {@link getRowHeight} on every call so a
 *   live theme change is honoured.
 * - **Row construction** — the pool-row scaffolding (fragment batching, `setY(0)`
 *   pin, `will-change` promotion, parallel-array bookkeeping) is identical; only
 *   the row object each subclass builds differs. {@link createPoolRow} returns a
 *   fully-constructed, un-appended row and the base owns the rest.
 *
 * The per-frame render pass itself ({@link renderWindow}) stays subclass-specific
 * because the content-width derivation genuinely diverges; the base exposes the
 * shared primitives it calls ({@link computeVisibleWindow},
 * {@link computePoolTarget}, {@link growRowPool}, {@link positionRow},
 * {@link hideExcessPoolRows}).
 *
 * @typeParam TRow - The concrete pooled row component type.
 * @typeParam TOptions - The subclass's options bag.
 *
 * @internal Not barrel-exported; the two subclasses are the only consumers.
 */
abstract class VirtualRowView<
    TRow extends Component,
    TOptions extends ComponentOptions = ComponentOptions,
> extends Component<TOptions> {

    protected _rowPool      : TRow[]                                              = [];
    protected _boundIndices : number[]                                           = [];
    protected _rowGeom      : Array<{ ty: number, w: number, h: number } | null> = [];
    protected _rowDisplayed : boolean[]                                          = [];
    protected _scroller     : VirtualScroller | null                             = null;

    /**
     * Returns the height in pixels of a single row. Read on every window /
     * geometry calculation, so a subclass that recomputes it (e.g. on a theme
     * change) reflects the new value immediately.
     */
    protected abstract getRowHeight(): number;

    /**
     * Constructs one pool row, fully wired but not yet appended to the
     * rows container — the base's {@link growRowPool} owns the append, the
     * `setY(0)` pin, the `will-change` promotion, and the parallel-array
     * bookkeeping.
     */
    protected abstract createPoolRow(): TRow;

    /**
     * Recomputes and reconciles the visible row window against the current
     * scroll position and dataset. Subclass-specific because the content-width
     * derivation diverges; both implementations compose the shared primitives
     * on this base.
     */
    protected abstract renderWindow(): void;

    /**
     * Constructs the {@link VirtualScroller} for this view and tracks its
     * container handles so they are released with the component. The scroller's
     * onScroll hook is routed through {@link onScrollerTick}.
     *
     * @param element - This view's initialised element handle.
     */
    protected initScroller(element: Handle): void {
        this._scroller = new VirtualScroller(this, element, () => this.onScrollerTick());

        // Track the scroller's created container handles so they are released
        // with this view (on destructor or GC); the scroller is not a Component.
        for (const handle of this._scroller.ownedHandles()) {
            this.trackHandle(handle);
        }
    }

    /**
     * Invoked on every scroller tick. Default behaviour re-renders the window;
     * `Body` overrides it to additionally emit its scroll events.
     */
    protected onScrollerTick(): void {
        this.renderWindow();
    }

    /**
     * Hook invoked once per pool slot added by {@link growRowPool}, after the
     * base parallel arrays have been extended. Default is a no-op; `Body`
     * overrides it to extend its own `_cellGeom` array in lockstep.
     */
    protected onPoolRowAdded(): void {
        // Default no-op; subclasses that own extra parallel arrays override.
    }

    /**
     * Sets the JS-controlled horizontal scroll position. Delegates to the
     * underlying {@link VirtualScroller}.
     *
     * @param x - The new scroll position in pixels.
     */
    setScrollX(x: number): this {
        this._scroller?.resetWheelEase();
        this._scroller?.setScrollX(x);

        return this;
    }

    /**
     * Sets the JS-controlled vertical scroll position. Delegates to the
     * underlying {@link VirtualScroller}.
     *
     * @param y - The new scroll position in pixels.
     */
    setScrollY(y: number): this {
        this._scroller?.resetWheelEase();
        this._scroller?.setScrollY(y);

        return this;
    }

    /**
     * Computes the `[firstRow, lastRow]` data-index window visible in the
     * current viewport, padded by `SCROLL_BUFFER` on each side and clamped to
     * the dataset bounds.
     *
     * @param scrollY - The current scroll offset in pixels.
     * @param visibleHeight - The viewport height in pixels.
     * @param totalRows - The total number of rows in the dataset.
     * @returns The `firstRow` / `lastRow` data indices and the number of rows in the window.
     */
    protected computeVisibleWindow(scrollY: number, visibleHeight: number, totalRows: number): { firstRow: number, lastRow: number, windowSize: number } {
        const rowHeight = this.getRowHeight();
        const firstRow  = Math.max(0, Math.floor(scrollY / rowHeight) - SCROLL_BUFFER);
        const lastRow   = Math.min(
            totalRows - 1,
            Math.ceil((scrollY + visibleHeight) / rowHeight) + SCROLL_BUFFER
        );
        const windowSize = lastRow - firstRow + 1 > 0 ? lastRow - firstRow + 1 : 0;

        return { firstRow, lastRow, windowSize };
    }

    /**
     * Computes the row-pool target size: the max possible window for the
     * current viewport, not just the current windowSize. windowSize shrinks
     * near the top/bottom edges of the dataset because firstRow clamps to 0
     * (and lastRow to totalRows-1); growing only to windowSize would force
     * regrowth mid-scroll once the user passes a viewport-edge boundary. Pre-
     * growing pays the per-row first-layout cost once.
     *
     * @param windowSize - The current visible-window size.
     * @param visibleHeight - The viewport height in pixels.
     * @param totalRows - The total number of rows in the dataset.
     * @returns The pool target size.
     */
    protected computePoolTarget(windowSize: number, visibleHeight: number, totalRows: number): number {
        return Math.min(
            totalRows,
            Math.max(
                windowSize,
                Math.ceil(visibleHeight / this.getRowHeight()) + 2 * SCROLL_BUFFER + 2
            )
        );
    }

    /**
     * Computes the number of whole rows a page-nav keystroke should move by:
     * one viewport height, floored to at least one row.
     *
     * @returns The page size in rows.
     */
    protected computePageSize(): number {
        const rowHeight = this.getRowHeight();

        return Math.max(1, Math.floor((this.getHeight() || rowHeight) / rowHeight));
    }

    /**
     * Grows the row pool up to `poolTarget`, batching new row elements through
     * a {@link DocumentFragment} so the live rows container sees a single
     * append instead of N. Each new slot pins its static top to 0, promotes it
     * to its own compositor layer, and extends the parallel bookkeeping arrays
     * in lockstep.
     *
     * @param poolTarget - The target pool size.
     */
    protected growRowPool(poolTarget: number): void {
        if (!this._scroller || this._rowPool.length >= poolTarget) {
            return;
        }

        const rowsContainer = this._scroller.getRowsContainer();
        const growFragment  = DOM.sink.createDocumentFragment();

        while (this._rowPool.length < poolTarget) {
            const row   = this.createPoolRow();
            const rowEl = row.getElement(true)!;

            DOM.sink.appendChild(growFragment, rowEl);

            // Pin row's static top to 0 once. Per-frame Y offset comes from
            // translateY, which is composite-only (avoids layout/paint per
            // scroll tick).
            row.setY(0);

            // Pre-promote pooled rows to their own compositor layer so the first
            // scroll-driven translate doesn't pay a layer-creation cost.
            row.setWillChange("transform");

            this._rowPool.push(row);
            this._boundIndices.push(-1);
            this._rowGeom.push(null);
            this._rowDisplayed.push(false);
            this.onPoolRowAdded();
        }

        DOM.sink.appendChild(rowsContainer, growFragment);
        DOM.sink.release(growFragment);
    }

    /**
     * Positions the pool slot at `slot` to `targetY` and sizes it to `rowWidth`,
     * writing the translate/size only when the cached geometry differs from the
     * target, and toggling the row displayed on the false→true edge.
     *
     * @param slot - The pool-slot index.
     * @param targetY - The row's translate-Y offset in pixels.
     * @param rowWidth - The row's width in pixels.
     * @returns `true` when the geometry changed (the subclass may need to re-lay
     *   out the row's children), `false` when it was already at the target.
     */
    protected positionRow(slot: number, targetY: number, rowWidth: number): boolean {
        const row       = this._rowPool[slot];
        const rowHeight = this.getRowHeight();
        const prev      = this._rowGeom[slot];
        const geomChanged = !prev || prev.ty !== targetY || prev.w !== rowWidth || prev.h !== rowHeight;

        if (geomChanged) {
            row.setAutoCommitStyle(false);
            row.setX(0);
            row.setTranslate(0, targetY);
            row.setWidth(rowWidth);
            row.setHeight(rowHeight);
            row.setAutoCommitStyle(true);
            this._rowGeom[slot] = { ty: targetY, w: rowWidth, h: rowHeight };
        }

        if (!this._rowDisplayed[slot]) {
            row.setDisplayed(true);
            this._rowDisplayed[slot] = true;
        }

        return geomChanged;
    }

    /**
     * Hides pool slots whose index falls outside the visible window and
     * clears their cached binding so the next bind triggers a full rebuild.
     *
     * @param windowSize - The number of pool slots currently in use.
     */
    protected hideExcessPoolRows(windowSize: number): void {
        for (let i = windowSize; i < this._rowPool.length; i++) {
            if (this._rowDisplayed[i]) {
                this._rowPool[i].setDisplayed(false);
                this._rowDisplayed[i] = false;
            }
            this._boundIndices[i] = -1;
            this._rowGeom[i] = null;
        }
    }

    /**
     * Clears the cached row geometry so the next render re-applies positions and
     * sizes for every slot. `Body` overrides this to additionally clear its
     * per-cell geometry cache.
     */
    protected invalidateGeom(): void {
        for (let i = 0; i < this._rowGeom.length; i++) {
            this._rowGeom[i] = null;
        }
    }

    /**
     * Scrolls the view so the row at `index` is fully visible, without moving
     * the viewport unless necessary. Delegates through {@link VirtualScroller}
     * so the header translate + scrollbar thumb stay in sync.
     *
     * @param index - The data index of the row to reveal. A negative index is a
     *   no-op (the row is not in the current view).
     */
    protected scrollRowIntoView(index: number): void {
        if (index < 0 || !this._scroller) {
            return;
        }

        const rowHeight      = this.getRowHeight();
        const top            = index * rowHeight;
        const bottom         = top + rowHeight;
        const scrollTop      = this._scroller.getScrollY();
        const viewportHeight = this.getHeight();
        const visibleBottom  = scrollTop + viewportHeight;

        let target = scrollTop;
        if (top < scrollTop) {
            target = top;
        } else if (bottom > visibleBottom) {
            target = bottom - viewportHeight;
        }
        if (target !== scrollTop) {
            this.setScrollY(target);
        }
    }
}

export { VirtualRowView };
