// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { VirtualScroller } from "~/component/container/VirtualScroller.js";
import { isFirstLayoutHeld } from "~/core/FirstLayoutGate.js";

/** Number of off-screen rows to render above and below the visible viewport. */
const SCROLL_BUFFER = 2;

/** Rotates `arr` left by `shift` in place: `arr[i]` becomes what was at `arr[(i + shift) % arr.length]`. */
function rotateLeft<T>(arr: T[], shift: number): void {
    arr.push(...arr.splice(0, shift));
}

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

    /** The data index pool slot 0 was aligned to on the last render, for {@link alignPoolWindow} to derive the scroll delta. `null` before the first render. */
    private _lastWindowStart: number | null = null;

    /** Whether the startup font gate skipped a render pass that still owes a run. */
    private _renderDeferred: boolean = false;
    /** Whether the render now in flight is the one a skipped pass left pending. */
    private _renderResumed : boolean = false;
    /** Scroll offsets the gate held back, applied once a render pass has run. */
    private _pendingScrollX: number | null = null;
    private _pendingScrollY: number | null = null;
    /** A row reveal the gate held back, recomputed once a render pass has run. */
    private _pendingScrollRow: number | null = null;

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
     * Destroys the pooled rows and the scroller's overlay scrollbars before the
     * inherited teardown runs.
     *
     * {@link growRowPool} appends each row's element straight to the rows
     * container and keeps the row only in `_rowPool`, so a pooled row is never
     * registered as a child component and the base destructor's recursion over
     * `_components` cannot reach it. Without this override neither the rows nor
     * their cells (which *are* registered on their row) release their
     * per-instance stylesheet rules, so the shared sheet grows by roughly the
     * view's whole cell count on every teardown. The scroller's two
     * `Scrollbar` overlays are raw-appended the same way, so they need the
     * same explicit disposal.
     */
    protected destructor(): void {
        for (const row of this._rowPool) {
            row.dispose();
        }

        this._scroller?.dispose();

        super.destructor();
    }

    /**
     * Sets the JS-controlled horizontal scroll position. Delegates to the
     * underlying {@link VirtualScroller}.
     *
     * @param x - The new scroll position in pixels.
     */
    setScrollX(x: number): this {
        // Ahead of the hold: a programmatic scroll cancels an in-flight wheel
        // ease whether or not the offset itself has to wait.
        this._scroller?.resetWheelEase();

        if (this.holdScrollWhileFirstLayoutHeld("x", x)) {
            return this;
        }

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
        // Ahead of the hold: a programmatic scroll cancels an in-flight wheel
        // ease whether or not the offset itself has to wait.
        this._scroller?.resetWheelEase();

        if (this.holdScrollWhileFirstLayoutHeld("y", y)) {
            return this;
        }

        this._scroller?.setScrollY(y);

        return this;
    }

    /**
     * Holds a scroll offset set while the startup font gate is holding this
     * view's render pass, for {@link applyPendingScroll} to apply once the pass
     * has run.
     *
     * @param axis - Which offset is being set.
     * @param offset - The requested offset in pixels.
     *
     * @returns `true` when the caller must return without scrolling.
     *
     * @remarks The scroller clamps every offset against a content extent that
     * only the render pass publishes, so an offset set while that pass is
     * deferred clamps to 0 and the request is lost — a row revealed during
     * startup would end up selected but off-screen. This guards the offsets
     * that are viewport-independent and so can be replayed verbatim: the
     * table's `scrollToRecord`, and a consumer restoring a saved offset.
     * `scrollRowIntoView` is held one level higher instead, by row index, since
     * its target depends on a height the gate is also holding. The table's
     * `scrollColumnIntoView` has that same width dependence but fires only from
     * a pooled cell's editor, which cannot exist while the pass is deferred.
     */
    private holdScrollWhileFirstLayoutHeld(axis: "x" | "y", offset: number): boolean {
        if (!isFirstLayoutHeld()) {
            // This offset is being applied for real, so it supersedes anything
            // held for the same axis — otherwise the held one would replay on
            // the next render and revert it. A held row reveal is a vertical
            // request too, so it goes with the Y offset.
            if (axis === "x") {
                this._pendingScrollX = null;
            } else {
                this._pendingScrollY   = null;
                this._pendingScrollRow = null;
            }

            return false;
        }

        if (axis === "x") {
            this._pendingScrollX = offset;
        } else {
            this._pendingScrollY   = offset;
            this._pendingScrollRow = null;
        }

        return true;
    }

    /**
     * Applies the scroll offsets {@link holdScrollWhileFirstLayoutHeld} held
     * back, now that a render pass has published the content extent they clamp
     * against. A no-op once they are applied.
     */
    private applyPendingScroll(): void {
        const x   = this._pendingScrollX;
        const y   = this._pendingScrollY;
        const row = this._pendingScrollRow;

        this._pendingScrollX   = null;
        this._pendingScrollY   = null;
        this._pendingScrollRow = null;

        if (x !== null) {
            this.setScrollX(x);
        }

        if (y !== null) {
            this.setScrollY(y);
        }

        // Applied after the offsets, which is what makes a reveal win over a
        // raw offset held before it. The reverse order is handled the other
        // way: a raw offset set later clears the reveal outright, so the two
        // vertical requests always resolve to whichever came last.
        if (row !== null) {
            this.scrollRowIntoView(row);
        }
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
        }

        DOM.sink.appendChild(rowsContainer, growFragment);
        DOM.sink.release(growFragment);
    }

    /**
     * Rotates the pool bookkeeping arrays so each slot keeps tracking the
     * same data index it held before the window moved, instead of being
     * rebound to whichever index now falls at that slot's window-relative
     * position.
     *
     * @param firstRow - The new window's first data index.
     *
     * @remarks Both subclasses key a pool slot by its offset within the
     * window (`firstRow + i`), so without this a one-row scroll shifts every
     * slot's data index by one and forces every pooled row — including the
     * off-screen `SCROLL_BUFFER` rows — through a full rebind and
     * reposition on every tick, instead of just the one row entering the
     * window. Call once per render, after {@link growRowPool} and before the
     * bind pass reads `_rowPool` / `_boundIndices` / `_rowGeom` /
     * `_rowDisplayed` by slot index.
     */
    protected alignPoolWindow(firstRow: number): void {
        const delta = this._lastWindowStart === null ? 0 : firstRow - this._lastWindowStart;

        this._lastWindowStart = firstRow;

        const n = this._rowPool.length;
        if (delta === 0 || n === 0) {
            return;
        }

        const shift = ((delta % n) + n) % n;

        rotateLeft(this._rowPool, shift);
        rotateLeft(this._boundIndices, shift);
        rotateLeft(this._rowGeom, shift);
        rotateLeft(this._rowDisplayed, shift);
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
     * sizes for every slot.
     */
    protected invalidateGeom(): void {
        for (let i = 0; i < this._rowGeom.length; i++) {
            this._rowGeom[i] = null;
        }
    }

    /**
     * Skips a render pass while the startup font gate is held, arranging for it
     * to run once the gate opens.
     *
     * @returns `true` when the caller must return without rendering.
     *
     * @remarks Both subclasses call {@link renderWindow} from many synchronous
     * entry points — `init`, a data change, a selection move — so a row's
     * geometry is routinely committed outside the coalesced layout queue, and
     * `init` in particular commits it the moment the element exists. Holding the
     * queue therefore does not hold these views; they have to check the gate
     * themselves. Deferring at this one choke point covers every entry point at
     * once, rather than guarding each caller.
     */
    protected deferRenderWhileFirstLayoutHeld(): boolean {
        if (!isFirstLayoutHeld()) {
            // This render is going ahead, which satisfies anything a held pass
            // left pending — clearing it keeps a later layout from replaying a
            // startup-era pass over the fresher state this one just committed.
            // Note that it also took over that pass's unfinished business, so
            // flag it for `finishResumedRender` to pick up once it has rendered.
            this._renderResumed  = this._renderDeferred;
            this._renderDeferred = false;

            return false;
        }

        this._renderDeferred = true;
        this.scheduleLayout();

        return true;
    }

    /**
     * Whether the last render pass on this view was skipped by the startup font
     * gate and is still waiting to run.
     *
     * @returns `true` while a pass is pending.
     */
    protected wasRenderDeferred(): boolean {
        return this._renderDeferred;
    }

    /**
     * Reports, once, that the render now finishing is the one a held pass left
     * pending — so the caller can redo the post-render work that pass skipped.
     *
     * @returns `true` exactly once per resumed pass, at the end of the render
     *   that resumed it.
     *
     * @remarks Called at the tail of {@link renderWindow} rather than from a
     * layout hook because a render resumes from whichever entry point reaches
     * it first, and for the table body that is the parent table layout calling
     * `renderWindow` directly rather than anything going through `doLayout`.
     */
    protected finishResumedRender(): boolean {
        // Read and clear before applying the scroll: applying it re-enters
        // `renderWindow` through the scroller's onScroll hook, and that nested
        // pass resets this flag. Reading it afterwards would lose the caller's
        // post-render work on exactly the passes that carry both.
        const resumed = this._renderResumed;

        this._renderResumed = false;

        // This pass has published the content extent, so any held offset can be
        // applied now — whether or not the pass is itself the deferred one.
        this.applyPendingScroll();

        return resumed;
    }

    /**
     * Runs the render pass the startup font gate deferred, if one is pending.
     * Each subclass calls this from its own `doLayout`, which is what picks the
     * pass back up once the gate opens.
     *
     * @returns `true` when a deferred pass ran, so the caller can skip a render
     *   of its own and refresh whatever it keeps in step with the rendered rows.
     *
     * @remarks A paused view keeps its pass pending rather than running it: a
     * parent's layout recursion reaches `Body.doLayout` regardless of the
     * child's pause state, so rendering here would defeat a `pauseLayout` the
     * caller asked for. (`Tree.doLayout` already returns early when paused, so
     * the guard only binds for the body.) `resumeLayout` runs a layout of its
     * own, which picks the pass up.
     */
    protected renderWindowIfDeferred(): boolean {
        if (!this._renderDeferred || this.isLayoutPaused()) {
            return false;
        }

        // The pending flag is left for `renderWindow`'s own gate check to
        // consume: that is what marks this render as the resumed one, which
        // `finishResumedRender` reads at the end of the pass.
        this.renderWindow();

        return true;
    }

    /**
     * Re-binds and re-renders every pooled row after a text-metrics reflow —
     * a theme change, or the web font swapping in over the fallback face.
     *
     * @remarks Pooled rows do not ride `ThemeManager`'s reflow for free. Both
     * subclasses render through renderers whose `Text` runs with
     * `setAutoMeasure(false)`, so a bound row only re-measures inside the
     * renderer's `update()` — which {@link renderWindow} skips for a slot that
     * is already bound to its data index. Without the `_boundIndices` reset a
     * visible row therefore keeps the width it measured against whichever font
     * was active when it was bound, clipping the wider glyphs of the real face
     * once it arrives. Subclasses that cache metrics-derived state of their own
     * (row height, content width) override this to refresh it, then chain up.
     */
    protected onThemeReflow(): void {
        this._boundIndices.fill(-1);
        this.invalidateGeom();
        this.renderWindow();
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

        // Hold the row, not a target. The target depends on this view's height,
        // and at startup that height arrives from the very layout the gate is
        // holding — so computing it now would either read an unset height and
        // reveal nothing, or read 0 and scroll the row just out of view.
        if (isFirstLayoutHeld()) {
            this._pendingScrollRow = index;

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
