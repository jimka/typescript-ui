// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { VirtualScroller } from "~/component/container/VirtualScroller.js";

/** Number of off-screen rows to render above and below the visible viewport. */
const SCROLL_BUFFER = 2;

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
 * by `Tree`).
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
     * Decides whether this render pass may withhold the width-driven relayout of
     * every visible row's children because the view's width is still moving, and
     * arms (or extends) the settle relay that catches them up once it stops.
     * Mirrors `Split.scheduleDrag`/`flushDrag`, which solves the same class of
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
     * driving this view's resize (`Split.flushDrag`, itself already coalesced
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
            this.setScrollY(target);
        }
    }
}

export { VirtualRowView };
