// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { VirtualScroller } from "~/component/container/VirtualScroller.js";
import { Animation } from "~/core/Animation.js";
import { COLLAPSE_DURATION, COLLAPSE_EASE } from "~/layout/CollapseSupport.js";

/** Number of off-screen rows to render above and below the visible viewport. */
const SCROLL_BUFFER = 2;

/**
 * Where a toggled row's children sit in the row list a motion renders: the
 * child block starts one row after the toggled row and runs for its length.
 */
export interface RowMotionBlock {
    /** Index of the first child row: one past the toggled row. */
    blockStart:  number;
    /** Number of rows under the toggled row, every depth included. */
    blockLength: number;
}

/**
 * One expand or collapse motion, from scheduling until it settles or is
 * stopped. Held by {@link VirtualRowView._rowMotion}.
 */
interface RowMotion extends RowMotionBlock {
    /** The toggled node or record; a second toggle of the same key reverses from `reveal`. */
    key:     object;
    /** 0 = children hidden under the toggled row, 1 = fully shown. */
    reveal:  number;
    /** False until the first frame applies the motion; render passes ignore an unstarted one. */
    started: boolean;
    /**
     * Whether the committed row list holds the block (an expand, or a
     * collapse reversed into one) or has already dropped it (a collapse).
     */
    expanding: boolean;
    /** Cancels the driving {@link Animation.tween}. */
    handle:  Animation.CancelHandle;
}

/** Rotates `arr` left by `shift` in place: `arr[i]` becomes what was at `arr[(i + shift) % arr.length]`. */
function rotateLeft<T>(arr: T[], shift: number): void {
    arr.push(...arr.splice(0, shift));
}

/**
 * Reorders `arr` in place so `arr[i]` becomes what was at `arr[order[i]]`.
 * `order` must be a permutation of `arr`'s own indices.
 */
function reorder<T>(arr: T[], order: number[]): void {
    const source = arr.slice();

    for (let i = 0; i < order.length; i++) {
        arr[i] = source[order[i]];
    }
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
 * {@link hideExcessPoolRows}, {@link reconcilePoolByKey} — currently called only
 * by `Tree`), plus the expand/collapse row-motion primitives
 * ({@link commitWithRowMotion}, {@link rowMotionY}, {@link rowMotionContentHeight},
 * {@link rowMotionOverhang}, {@link applyRowMotionStyle}, {@link rowMotionBlock},
 * {@link stopRowMotion}, {@link settleRowMotion},
 * {@link settleRowMotionIfEntering}, {@link isRowMotionRunning},
 * {@link rowMotionCommittedIndex}, {@link isRowMotionLeavingSlot},
 * {@link scrollToCommittedY}, {@link noteRowMotionPass}) each subclass's
 * toggle and render paths compose.
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

    /** Whether a pass withheld a width-driven child relayout that is still owed. */
    private _rowLayoutOwed: boolean = false;
    /** Whether a further width change landed after the settle frame was armed. */
    private _rowWidthMoved: boolean = false;
    /** The `afterNextLayout` relay armed to end a resize burst, or `null` when none is in flight. */
    private _resizeSettleHandle: { cancel(): void } | null = null;

    /** The running (or pending) expand/collapse row motion, or `null` when idle. */
    private _rowMotion: RowMotion | null = null;
    /** Whether the last render pass rendered a running row motion, for {@link noteRowMotionPass}. */
    private _lastPassInMotion: boolean = false;

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
     * same explicit disposal. A still-armed resize-settle frame is cancelled
     * here too, first, so it cannot fire and re-render against the pool this
     * method is about to dispose.
     */
    protected destructor(): void {
        // A still-armed settle frame would otherwise fire after the pool below
        // is disposed, re-laying out rows that no longer exist.
        this._resizeSettleHandle?.cancel();
        this._resizeSettleHandle = null;

        // Likewise, a running row motion would otherwise keep ticking against
        // a disposed pool.
        this._rowMotion?.handle.cancel();
        this._rowMotion = null;

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
     * Re-matches the pool to the window by key identity instead of by
     * position, and permutes the four parallel bookkeeping arrays into the
     * resulting order.
     *
     * @param firstRow - The new window's first data index.
     * @param windowSize - The number of rows in the window.
     * @param keyAtRow - Returns the identity key for the row at a given data index.
     * @param keyInSlot - Returns the identity key currently held by a pool slot,
     *   or `null` when the slot holds nothing comparable.
     *
     * @remarks
     * This is the structural-change counterpart to {@link alignPoolWindow}'s
     * scroll rotation: where a pure scroll shifts every slot's data index by
     * the same delta, a structural change (rows inserted or removed at an
     * arbitrary point) can shift different window positions by different
     * amounts, so slot assignment has to be re-derived from identity rather
     * than from a uniform shift. A slot whose `_boundIndices` entry is `-1`
     * is deliberately excluded from matching — that sentinel marks a slot a
     * caller has already decided must be rebound regardless of content, and
     * handing it back its old node without a rebind would defeat that. This
     * method only decides which slot each window position lands in; whether
     * the slot ends up rebound is still entirely up to the caller's own bind
     * pass, exactly as it is after {@link alignPoolWindow}.
     */
    protected reconcilePoolByKey(
        firstRow: number,
        windowSize: number,
        keyAtRow: (dataIndex: number) => object,
        keyInSlot: (slot: number) => object | null,
    ): void {
        const n = this._rowPool.length;

        // Recorded even when nothing else happens, so the next pure-scroll
        // `alignPoolWindow` derives its rotation from this pass's window.
        this._lastWindowStart = firstRow;

        if (n === 0 || windowSize === 0) {
            return;
        }

        const heldBy = new Map<object, number>();

        for (let slot = 0; slot < n; slot++) {
            if (this._boundIndices[slot] < 0) {
                continue;
            }

            const key = keyInSlot(slot);

            if (key !== null && !heldBy.has(key)) {
                heldBy.set(key, slot);
            }
        }

        const order = new Array<number>(n).fill(-1);
        const taken = new Array<boolean>(n).fill(false);
        let   matches = 0;

        for (let i = 0; i < windowSize; i++) {
            const slot = heldBy.get(keyAtRow(firstRow + i));

            if (slot !== undefined && !taken[slot]) {
                order[i]    = slot;
                taken[slot] = true;
                matches++;
            }
        }

        if (matches === 0) {
            return;
        }

        // Every unmatched window position, and every slot past the window, takes
        // the next unclaimed slot. Which one it gets does not matter: an
        // unmatched position is rebound either way.
        let next = 0;

        for (let i = 0; i < n; i++) {
            if (order[i] !== -1) {
                continue;
            }

            while (taken[next]) {
                next++;
            }

            order[i]    = next;
            taken[next] = true;
        }

        reorder(this._rowPool, order);
        reorder(this._boundIndices, order);
        reorder(this._rowGeom, order);
        reorder(this._rowDisplayed, order);
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
                const row = this._rowPool[i];

                row.setDisplayed(false);
                this._rowDisplayed[i] = false;

                // A row hidden mid-motion (or as a collapse settles) would
                // otherwise keep the motion's opacity and pointer-events.
                if (row.getOpacity() !== null) {
                    row.clearOpacity();
                }

                if (row.getPointerEvents() !== null) {
                    row.clearPointerEvents();
                }

                this.setLeavingRowHidden(row, false);
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
     * Whether a row motion has started applying itself to the render pass.
     * `false` both when idle and when a motion is scheduled but has not yet
     * reached its first frame (see {@link stepRowMotion}).
     */
    protected isRowMotionRunning(): boolean {
        return this._rowMotion !== null && this._rowMotion.started;
    }

    /**
     * Records whether the render pass calling it rendered a running row
     * motion, and reports whether that pass must re-point
     * `aria-activedescendant`: on every motion frame, and on the first pass
     * after the motion ends. A motion's commit, its first frame (which binds
     * the pool from the motion row list) and its end (which binds it back
     * from the committed one) can each move the focused row to another pool
     * slot, or into a hidden leaving block, so those passes re-point the
     * pointer. Passes outside a motion leave it to their callers. Each
     * subclass's render pass calls this once, at its end, and supplies only
     * the pointer update itself.
     *
     * @returns Whether the calling pass must re-point `aria-activedescendant`.
     */
    protected noteRowMotionPass(): boolean {
        const inMotion = this.isRowMotionRunning();
        const refresh  = inMotion || this._lastPassInMotion;

        this._lastPassInMotion = inMotion;

        return refresh;
    }

    /**
     * The running motion's hidden height in pixels — the height its child
     * block has not yet revealed (or has already re-hidden, for a collapse) —
     * or `0` when no motion is running.
     */
    private rowMotionHiddenHeight(): number {
        const motion = this._rowMotion;

        if (motion === null || !motion.started) {
            return 0;
        }

        return (1 - motion.reveal) * motion.blockLength * this.getRowHeight();
    }

    /**
     * The Y offset a row at `dataIndex` should be positioned at, given any
     * running row motion. Rows before the motion's child block are
     * unaffected; rows at or after it are pulled up by the block's current
     * hidden height.
     *
     * @param dataIndex - The row's index into the row list the current render
     *   pass is reading.
     */
    protected rowMotionY(dataIndex: number): number {
        const y      = dataIndex * this.getRowHeight();
        const motion = this._rowMotion;

        if (motion === null || !motion.started || dataIndex < motion.blockStart) {
            return y;
        }

        return y - this.rowMotionHiddenHeight();
    }

    /**
     * Maps an index into the row list the current render pass reads to the
     * same row's index in the committed row list. The two differ only while
     * a collapse motion runs: its row list still holds the leaving block,
     * which the committed list has already dropped, so every row after the
     * block sits `blockLength` further down. A leaving row has no committed
     * index and keeps its index in the motion row list — its pre-collapse
     * one.
     *
     * @param dataIndex - The row's index into the row list the current render
     *   pass is reading.
     * @returns The row's committed index, or `dataIndex` for a leaving row.
     */
    protected rowMotionCommittedIndex(dataIndex: number): number {
        const motion = this._rowMotion;

        if (motion === null || !motion.started || motion.expanding) {
            return dataIndex;
        }

        return dataIndex < motion.blockStart + motion.blockLength ? dataIndex : dataIndex - motion.blockLength;
    }

    /**
     * The total content height for `totalRows` rows, given any running row
     * motion — `totalRows` rows' worth of height, less the motion's current
     * hidden height.
     *
     * @param totalRows - The number of rows in the row list the current
     *   render pass is reading.
     */
    protected rowMotionContentHeight(totalRows: number): number {
        return totalRows * this.getRowHeight() - this.rowMotionHiddenHeight();
    }

    /**
     * Extra pixels the visible window must cover beyond the viewport height,
     * for rows pulled up by a running motion's hidden height.
     */
    protected rowMotionOverhang(): number {
        return this.rowMotionHiddenHeight();
    }

    /**
     * Whether `dataIndex` falls inside a started motion's child block.
     *
     * @param dataIndex - The row's index into the row list the current render
     *   pass is reading.
     */
    private isInRowMotionBlock(dataIndex: number): boolean {
        const motion = this._rowMotion;

        return motion !== null && motion.started
            && dataIndex >= motion.blockStart && dataIndex < motion.blockStart + motion.blockLength;
    }

    /**
     * Whether the row bound to pool slot `slot` is a *leaving* row: one inside
     * a running collapse motion's child block, which the committed row list
     * has already dropped. Such a row is hidden from assistive technology
     * while it plays (see {@link applyRowMotionStyle}), so nothing may point
     * `aria-activedescendant` at it.
     *
     * @param slot - The pool-slot index.
     */
    protected isRowMotionLeavingSlot(slot: number): boolean {
        const dataIndex = this._boundIndices[slot];

        return dataIndex >= 0 && this.isInRowMotionBlock(dataIndex) && !this._rowMotion!.expanding;
    }

    /**
     * Applies a running motion's visual state to one pool slot: fading and
     * disabling pointer events on a row inside the motion's child block by
     * how much of it has emerged, and clearing both on every other row. A
     * leaving row (inside a collapse's block) is also hidden from assistive
     * technology: the committed row list no longer holds it, and its
     * `aria-rowindex` (or `aria-posinset` / `aria-setsize`) would duplicate
     * the committed rows' values. Every other row has that cleared, so a slot
     * the pass rebinds, or a pass after the motion settles or stops, reveals
     * it again.
     *
     * @param slot - The pool-slot index.
     * @param dataIndex - The row's index into the row list the current render
     *   pass is reading.
     */
    protected applyRowMotionStyle(slot: number, dataIndex: number): void {
        const row = this._rowPool[slot];

        if (this.isInRowMotionBlock(dataIndex)) {
            const motion    = this._rowMotion!;
            const rowHeight = this.getRowHeight();
            const emerged   = (this.rowMotionY(dataIndex) + rowHeight - motion.blockStart * rowHeight) / rowHeight;

            row.setOpacity(Math.min(1, Math.max(0, emerged)));

            if (row.getPointerEvents() !== "none") {
                row.setPointerEvents("none");
            }

            this.setLeavingRowHidden(row, !motion.expanding);

            return;
        }

        if (row.getOpacity() !== null) {
            row.clearOpacity();
        }

        row.clearPointerEvents();
        this.setLeavingRowHidden(row, false);
    }

    /**
     * Hides a leaving row from assistive technology, or reveals a row that a
     * previous motion pass hid. Revealing removes the attribute rather than
     * writing `aria-hidden="false"`, and only on a row actually hidden, so a
     * revealed row ends up identical to one no motion ever touched.
     *
     * @param row - The pool row.
     * @param hidden - `true` to set `aria-hidden="true"`, `false` to remove it.
     */
    private setLeavingRowHidden(row: TRow, hidden: boolean): void {
        const aria = row.getAria();

        if (hidden) {
            aria.setHidden(true);
        } else if (aria.getHidden() === true) {
            aria.setHidden(null);
        }
    }

    /**
     * Locates the child block under the row at `parentIndex` in `rows`: every
     * following row whose depth is greater, up to (not including) the first
     * row back at `parentIndex`'s own depth or shallower.
     *
     * @param rows - The row list to search, each entry carrying at least its `depth`.
     * @param parentIndex - The toggled row's index in `rows`, or `-1` when it
     *   is not present (the toggled node/record was removed from the render).
     * @returns The block's bounds, or `null` when `parentIndex` is negative.
     */
    protected rowMotionBlock(rows: ReadonlyArray<{ depth: number }>, parentIndex: number): RowMotionBlock | null {
        if (parentIndex < 0) {
            return null;
        }

        const depth = rows[parentIndex].depth;
        let   end   = parentIndex + 1;

        while (end < rows.length && rows[end].depth > depth) {
            end++;
        }

        return { blockStart: parentIndex + 1, blockLength: end - parentIndex - 1 };
    }

    /**
     * Runs `commit` — the state change plus its synchronous final-state
     * render — then schedules a row motion for the child block it returns,
     * when the rules in {@link mayAnimateRowMotion} allow one.
     *
     * @param key - Identity of the toggled node/record; a second toggle of
     *   the same key while a motion for it is in flight retargets it instead
     *   of starting a fresh one from the far end.
     * @param expanding - Whether this toggle is an expand (`reveal` runs 0→1)
     *   or a collapse (`reveal` runs 1→0).
     * @param commit - Performs the state change and its final-state render,
     *   then returns the toggled row's child block (via {@link rowMotionBlock}),
     *   or `null` when there is nothing to animate (e.g. the toggled row left
     *   the render entirely).
     * @returns `true` when a motion was scheduled.
     */
    protected commitWithRowMotion(key: object, expanding: boolean, commit: () => RowMotionBlock | null): boolean {
        const motion        = this._rowMotion;
        const retarget      = motion !== null && motion.key === key ? motion.reveal : null;
        const scrollYBefore = this._scroller?.getScrollY() ?? 0;
        const block         = commit();

        if (block === null || !this.mayAnimateRowMotion(block, scrollYBefore)) {
            return false;
        }

        const from = retarget ?? (expanding ? 0 : 1);
        const to   = expanding ? 1 : 0;

        if (from === to) {
            return false;
        }

        this.scheduleRowMotion(key, block, from, to);

        return true;
    }

    /**
     * Whether a toggle's child block may animate: motion is not disabled by
     * `prefers-reduced-motion`, the view is rendered, the block fits within
     * one viewport's worth of rows, and the commit's own render left the
     * scroll offset unchanged (a scroll clamp mid-commit would make the first
     * frame jump).
     *
     * @param block - The child block the toggle would animate.
     * @param scrollYBefore - The vertical scroll offset captured before the commit ran.
     */
    private mayAnimateRowMotion(block: RowMotionBlock, scrollYBefore: number): boolean {
        if (Animation.isReducedMotion() || this._scroller === null) {
            return false;
        }

        const viewportRows = Math.ceil((this.getHeight() || 0) / this.getRowHeight());

        return block.blockLength > 0
            && block.blockLength <= viewportRows
            && this._scroller.getScrollY() === scrollYBefore;
    }

    /**
     * Starts (or retargets) the driving {@link Animation.tween} for a row
     * motion.
     *
     * @param key - Identity of the toggled node/record.
     * @param block - The child block to animate.
     * @param from - The starting reveal value (0..1).
     * @param to - The ending reveal value (0..1).
     */
    private scheduleRowMotion(key: object, block: RowMotionBlock, from: number, to: number): void {
        const motion: RowMotion = {
            key, ...block, reveal: from, started: false, expanding: to === 1, handle: { cancel: (): void => {} },
        };

        this._rowMotion = motion;

        motion.handle = Animation.tween({
            from:       { reveal: from },
            to:         { reveal: to },
            durationMs: COLLAPSE_DURATION * Math.abs(to - from),
            // Clamped below 0: a frame's timestamp can predate the tween's
            // start. In production that happens whenever the toggle ran from an
            // input handler: `Animation.tween` reads `performance.now()` there,
            // but the next frame's rAF timestamp is the frame's start time,
            // which can fall before that read in the same frame. A test that
            // drives frames with `now = 0` hits the same case. Either way the
            // negative progress must read as "not started", not extrapolate
            // the curve backwards.
            easing:     (t: number): number => COLLAPSE_EASE(Math.max(0, t)),
            onStep:     (values) => this.stepRowMotion(motion, values.reveal),
            onComplete: () => this.finishRowMotion(motion),
        });
    }

    /**
     * The driving tween's per-frame callback: updates the motion's reveal,
     * flips {@link RowMotion.started} to `true` and notifies
     * {@link onRowMotionRowsChanged} on the very first frame, then re-renders.
     * A no-op when `motion` is no longer the current motion (stopped or
     * superseded since the tween was scheduled).
     *
     * @param motion - The motion this tween is driving.
     * @param reveal - This frame's interpolated reveal value.
     */
    private stepRowMotion(motion: RowMotion, reveal: number): void {
        if (this._rowMotion !== motion) {
            return;
        }

        motion.reveal = reveal;

        if (!motion.started) {
            motion.started = true;
            this.onRowMotionRowsChanged();
        }

        this.renderWindow();
    }

    /**
     * The driving tween's completion callback: clears the motion, notifies
     * {@link onRowMotionRowsChanged} and re-renders at the settled state. A
     * no-op when `motion` is no longer the current motion.
     *
     * @param motion - The motion that just completed.
     */
    private finishRowMotion(motion: RowMotion): void {
        if (this._rowMotion !== motion) {
            return;
        }

        this._rowMotion = null;
        this.onRowMotionRowsChanged();
        this.renderWindow();
    }

    /**
     * Abandons a pending or running motion without rendering; the caller is
     * expected to render the new state itself right after. `Animation.tween`'s
     * `cancel()` suppresses its `onComplete`, so this method — not the
     * tween's completion callback — is what {@link onRowMotionRowsChanged}
     * fires from on this path.
     */
    protected stopRowMotion(): void {
        const motion = this._rowMotion;

        if (motion === null) {
            return;
        }

        this._rowMotion = null;
        motion.handle.cancel();
        this.onRowMotionRowsChanged();
    }

    /**
     * Abandons a pending or running motion, as {@link stopRowMotion} does, and
     * hands the scroller the committed row list's content height, so a scroll
     * the caller makes before its render clamps against the committed extent.
     * Without it the scroller would still hold the motion's height from the
     * last frame: smaller than the committed one mid-expand, clamping a
     * scroll short, and larger mid-collapse, letting a scroll overshoot that
     * the next render then pulls back. Like {@link stopRowMotion}, it leaves
     * the render to the caller.
     */
    protected settleRowMotion(): void {
        const motion   = this._rowMotion;
        const scroller = this._scroller;

        if (motion !== null && motion.started && scroller !== null) {
            // The last frame gave the scroller the rendered row list's
            // height less the hidden height. The committed list holds the
            // block on an expand, and has already dropped it on a collapse.
            const droppedHeight = motion.expanding ? 0 : motion.blockLength * this.getRowHeight();

            scroller.setContentHeight(scroller.getContentHeight() + this.rowMotionHiddenHeight() - droppedHeight);
        }

        this.stopRowMotion();
    }

    /**
     * Settles a pending or running expand motion (see {@link settleRowMotion})
     * when `index` names one of its entering rows, so a keyboard move onto a
     * row still fading in renders it final at once, instead of putting the
     * selection tint and focus ring on a nearly transparent row. A move to
     * any other row leaves the motion alone; {@link scrollToCommittedY}
     * still settles it if the move scrolls. A collapse has no entering rows:
     * its leaving rows are not in the committed list a move can target.
     * Leaves the render to the caller.
     *
     * @param index - The move's target row, as an index into the committed
     *   row list.
     */
    protected settleRowMotionIfEntering(index: number): void {
        const motion = this._rowMotion;

        if (motion !== null && motion.expanding
            && index >= motion.blockStart && index < motion.blockStart + motion.blockLength) {
            this.settleRowMotion();
        }
    }

    /**
     * Called whenever the row list a motion renders switches: on a motion's
     * first frame (to the motion's own row list) and on its end, settled or
     * stopped (back to the committed one). A subclass whose render pass reads
     * through a cached row/record list overrides this to invalidate that
     * cache; the base implementation does nothing.
     */
    protected onRowMotionRowsChanged(): void {}

    /**
     * Decides whether this render pass may withhold the width-driven relayout of
     * every visible row's children because the view's width is still moving, and
     * arms (or extends) the settle relay that catches them up once it stops.
     * Mirrors `Split.scheduleDrag` and its per-frame drag session
     * (`core/ResizeDrag.ts`), which solve the same class of
     * problem one layer up (a live pane resize).
     *
     * @param widthChanged - Whether this pass sizes rows to a different width than
     *   the previous pass did.
     *
     * @returns `true` when the caller must skip each row's child layout this pass.
     *
     * @remarks Whether a settle frame is already armed — not `widthChanged` — is
     * what decides withholding: a pass with no settle frame armed always applies
     * its own child relayout in full (arming a settle only when the width
     * actually moved, so a one-off resize lands accurate on its own frame),
     * while any pass that finds one already armed withholds regardless of
     * whether *this specific* pass's width moved, so an incidental same-width
     * pass mid-burst can't slip a live relayout in ahead of the settle.
     * {@link flushResizeSettle} performs the eventual catch-up once the burst
     * goes quiet.
     */
    protected deferRowLayoutWhileResizing(widthChanged: boolean): boolean {
        if (this._resizeSettleHandle === null) {
            if (widthChanged) {
                this.scheduleResizeSettle();
            }

            return false;
        }

        if (widthChanged) {
            this._rowWidthMoved = true;
        }

        this._rowLayoutOwed = true;

        return true;
    }

    /**
     * Arms the two-frame relay that ends a resize burst: a decoy
     * `Component.afterNextLayout` callback that does nothing but register a
     * second one on the *following* frame, which is what {@link
     * flushResizeSettle} runs from. Armed once and left alone while further
     * width changes arrive, matching `Split.scheduleDrag`.
     *
     * @remarks A single `afterNextLayout` call here is not enough. The owner
     * driving this view's resize (`Split`'s per-frame drag flush, itself already coalesced
     * to one call per frame) calls `doLayout()` directly from its own
     * independently-scheduled `requestAnimationFrame`, registered by whichever
     * `mousemove` arrives after the previous frame finishes — chronologically
     * *after* this method's own registration for the same upcoming frame, made
     * synchronously inside the *current* frame's pass. `afterNextLayout`'s
     * ordering guarantee is scoped to `Component`'s own coalesced flush and
     * says nothing about `Split`'s separate registration, so a single relay
     * hop still always fires and resolves *before* that frame's real layout
     * pass runs, making `_resizeSettleHandle` read as `null` again just before
     * the pass that needed to see it armed — the settle races, and always
     * wins, the very pass it exists to detect. Two hops fixes this: the decoy,
     * nested here, only relays the handle to a second frame, costing nothing
     * but keeping `_resizeSettleHandle` continuously non-null across the
     * boundary — a callback registered from inside an `afterNextLayout`
     * callback defers to the *following* frame rather than running
     * re-entrantly within the same drain (`Component.afterNextLayout`'s own
     * doc comment; confirmed by `AfterNextLayout.test.ts`). {@link
     * flushResizeSettle} then checks `_rowWidthMoved`, which — set by any pass
     * over the *prior* frame, an entirely separate earlier frame batch — is
     * never racing anything by the time this one reads it.
     *
     * Unlike `Split.onDragEnd`, there is no synchronous flush for this frame:
     * nothing signals this view that a drag has ended (see the plan's "No
     * cross-component signal" decision), so there is no well-defined moment to
     * flush at other than the frame itself. A real browser always eventually
     * delivers the flush, so a live resize always resolves; the offline test
     * sink deliberately drops `requestAnimationFrame` instead of delaying it,
     * so a test driving more than one width change in a burst must install its
     * own capturing `requestAnimationFrame` / `cancelAnimationFrame`, as
     * `ResizeLayoutEconomy.test.ts` does — the same requirement
     * `ScrollRebindLayoutEconomy.test.ts` already carries for its own
     * frame-gated behaviour.
     */
    private scheduleResizeSettle(): void {
        this._resizeSettleHandle = Component.afterNextLayout(() => {
            this._resizeSettleHandle = Component.afterNextLayout(() => this.flushResizeSettle());
        });
    }

    /**
     * The settle relay's second hop: ends a resize burst, or extends it by
     * another two-frame relay when the width moved again during the frame
     * between the two hops. On the first quiet cycle it re-lays out every
     * visible row's children at the settled width.
     */
    private flushResizeSettle(): void {
        this._resizeSettleHandle = null;

        if (this._rowWidthMoved) {
            this._rowWidthMoved = false;
            this.scheduleResizeSettle();

            return;
        }

        if (!this._rowLayoutOwed) {
            return;
        }

        this._rowLayoutOwed = false;
        this.invalidateGeom();
        this.renderWindow();
    }

    /**
     * Re-binds and re-renders every pooled row after a text-metrics reflow —
     * a theme change, or the web font swapping in over the fallback face.
     *
     * @remarks Pooled rows do not ride `ThemeManager`'s reflow for free. Both
     * subclasses render through renderers whose `Text` runs with
     * `setAutoMeasure(false)`, so a bound row only re-measures inside the
     * renderer's `update()` — which {@link renderWindow} skips for a slot
     * whose binding hasn't changed (an index match in `Body`; a content match
     * per `TreeRow.isBoundTo` in `Tree`). Without the `_boundIndices` reset a
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
            this.scrollToCommittedY(target);
        }
    }

    /**
     * Sets the vertical scroll offset to `target`, a position computed from
     * committed row positions (`index * rowHeight`). A running row motion
     * renders rows away from those positions, so when the move will change
     * the offset this settles the motion first (see {@link settleRowMotion}),
     * and the row the caller is scrolling to renders where the scroll put it,
     * in one step. When the offset already equals `target` a running motion
     * keeps playing, so a toggle whose own row is in view still animates.
     *
     * @param target - The new vertical scroll offset in pixels.
     */
    protected scrollToCommittedY(target: number): void {
        const scrollY = this._scroller?.getScrollY();
        const moves   = scrollY !== undefined && target !== scrollY;
        const running = moves && this.isRowMotionRunning();

        if (moves) {
            this.settleRowMotion();
        }

        this.setScrollY(target);

        // A target the scroller clamps back to the current offset fires no
        // scroll tick, and `stopRowMotion` leaves the render to its caller,
        // so render the settled state here.
        if (running && this._scroller!.getScrollY() === scrollY) {
            this.renderWindow();
        }
    }
}

export { VirtualRowView };
