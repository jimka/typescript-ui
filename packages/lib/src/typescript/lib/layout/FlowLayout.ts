// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { FillType } from "~/layout/FillType.js";
import { Size } from "~/primitive/Size.js";
import { Component } from "~/core/Component.js";
import type { AxisPosition, AxisSpread } from "~/primitive/Axis.js";

/**
 * Which axes of a {@link FlowLayout}'s cells are made uniform so wrapped items
 * line up into a grid.
 *
 * - `"none"` (the default) — each item keeps its own preferred size and lines
 *   pack independently, so columns do not align across lines.
 * - `"width"` — every cell takes the widest item's width, so columns align
 *   horizontally; each line still uses its own (tallest-item) height.
 * - `"height"` — every cell takes the tallest item's height, so lines align
 *   vertically; widths still vary per item.
 * - `"both"` — every cell is identical (widest × tallest), a full grid.
 *
 * @category Layouts
 */
export type FlowUniformity = "none" | "width" | "height" | "both";

/**
 * Cross-axis alignment of an item within its wrapped line's cross extent — the
 * row height for {@link HFlow}, the column width for {@link VFlow}.
 *
 * - `"start"` (the default) — leading cross-edge (HFlow top, VFlow left). This
 *   is the original placement.
 * - `"center"` — centred in the line's cross extent.
 * - `"end"` — trailing cross-edge (HFlow bottom, VFlow right).
 * - `"baseline"` — {@link HFlow} only: items are aligned on their shared text
 *   baseline across the row; null-baseline (graphical) items centre in the text
 *   line. {@link VFlow} has no shared text baseline, so it degrades to
 *   `"start"`.
 *
 * @remarks This positions the *cell* within the line; a child's
 * {@link AnchorType} still positions the child within its (possibly uniform)
 * cell — both apply. Alignment only moves a cell; a child with a cross-axis
 * `fill` constraint instead takes the whole line extent and ignores this.
 *
 * @category Layouts
 */
export type FlowItemAlign = "start" | "center" | "end" | "baseline";

/**
 * Construction-time options shared by {@link HFlow} and {@link VFlow}.
 *
 * @category Layouts
 */
export interface FlowLayoutOptions extends LayoutManagerOptions {
    spacing?:     number;
    lineSpacing?: number;
    uniform?:     FlowUniformity;
    align?:       AxisPosition;
    itemAlign?:   FlowItemAlign;
    justify?:     AxisSpread;
}

/**
 * Abstract base for the wrapping flow layouts {@link HFlow} and {@link VFlow}.
 * Holds the axis-agnostic configuration plumbing — item spacing, line spacing,
 * cell uniformity, and line alignment — and the shared cell-measurement
 * helpers, and dispatches a {@link FlowLayoutOptions} bag.
 *
 * @remarks This deliberately does not extend {@link BoxLayout}. That base models
 * a non-wrapping single-axis box — `mode`, `stretching`, `weight`, proportional
 * shrink, and a min-total overflow inflation — none of which a wrapping flow
 * uses. The geometric algorithms (`getPreferredSize`, `getMinSize`,
 * `getMaxSize`, `doLayout`) are mirror-image per axis and stay concrete on each
 * subclass.
 *
 * @category Layouts
 */
export abstract class FlowLayout extends LayoutManager {

    // `protected`, not `private`: the subclasses' geometric methods
    // (getPreferredSize/getMinSize/getMaxSize/doLayout) read these fields
    // directly, so they must be visible to HFlow/VFlow.
    protected _spacing: number = 5;
    protected _lineSpacing: number = 5;
    protected _uniform: FlowUniformity = "none";
    protected _align: AxisPosition = "start";
    protected _itemAlign: FlowItemAlign = "start";
    protected _justify: AxisSpread = "start";

    // The cross-axis extent the children last wrapped into, measured by doLayout
    // at the container's real inner extent. `null` until a layout has run at a
    // usable extent, which is what makes the single-line fallback in each
    // subclass's getPreferredSize reachable on the first pass.
    private _wrappedLineExtent: number | null = null;

    /**
     * Constructs the layout manager, applying any supplied options.
     *
     * @param options - Optional construction-time configuration.
     */
    constructor(options?: FlowLayoutOptions) {
        // LayoutManager's constructor takes no options; applied via applyOptions below.
        // eslint-disable-next-line local/forward-super-options
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link FlowLayoutOptions} bag after the inherited LayoutManager
     * defaults, dispatching the item and line spacings, the uniformity mode, and
     * the line alignment.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: FlowLayoutOptions): void {
        super.applyOptions(options);

        if (options.spacing !== undefined) {
            this.setComponentSpacing(options.spacing);
        }

        if (options.lineSpacing !== undefined) {
            this.setLineSpacing(options.lineSpacing);
        }

        if (options.uniform !== undefined) {
            this.setUniform(options.uniform);
        }

        if (options.align !== undefined) {
            this.setAlign(options.align);
        }

        if (options.itemAlign !== undefined) {
            this.setItemAlign(options.itemAlign);
        }

        if (options.justify !== undefined) {
            this.setJustify(options.justify);
        }
    }

    /**
     * Returns the pixel spacing between items along a line.
     *
     * @returns The current item spacing in pixels.
     */
    getComponentSpacing(): number {
        return this._spacing || 0;
    }

    /**
     * Sets the pixel spacing between items along a line.
     *
     * @param spacing - Spacing in pixels.
     *
     * @returns This layout manager, for method chaining.
     */
    setComponentSpacing(spacing: number): this {
        this._spacing = spacing || 0;

        return this;
    }

    /**
     * Returns the pixel spacing between wrapped lines.
     *
     * @returns The current line spacing in pixels.
     */
    getLineSpacing(): number {
        return this._lineSpacing || 0;
    }

    /**
     * Sets the pixel spacing between wrapped lines.
     *
     * @param lineSpacing - Spacing in pixels.
     *
     * @returns This layout manager, for method chaining.
     */
    setLineSpacing(lineSpacing: number): this {
        this._lineSpacing = lineSpacing || 0;

        return this;
    }

    /**
     * Returns the cross-axis extent the children wrapped into at the last
     * layout, or null if no layout has run at a usable extent yet.
     *
     * @returns The measured line extent in pixels, or null.
     *
     * @remarks The number covers the lines only — summed row heights (or column
     * widths) plus the gaps between them. It carries no insets, padding, or
     * border, so a caller adds the perimeter back itself.
     */
    protected getWrappedLineExtent(): number | null {
        return this._wrappedLineExtent;
    }

    /**
     * Records the cross-axis extent the children wrapped into, and tells the
     * container when that measurement has changed.
     *
     * @param extent - The measured line extent in pixels.
     *
     * @remarks The equality check is the loop guard. A settled layout publishes
     * the same extent on every pass and therefore notifies nothing; without the
     * check each pass would relay a size change that schedules the next one.
     *
     * A non-finite extent is dropped rather than stored, because it would defeat
     * that guard: `NaN !== NaN`, so every pass would look like a change and relay
     * one. One child with a `NaN` preferred height — a text whose font has not
     * resolved, say — is enough to poison the sum. Dropping it also keeps the
     * single-line fallback reachable, which is the right answer when nothing
     * usable was measured.
     */
    protected publishWrappedLineExtent(extent: number): void {
        if (!Number.isFinite(extent) || this._wrappedLineExtent === extent) {
            return;
        }

        this._wrappedLineExtent = extent;

        this.getContainer()?.notifyIntrinsicSizeChanged();
    }

    /**
     * Attaches to a container, dropping any measurement taken against a previous
     * one.
     *
     * @param container - The container component to attach to.
     *
     * @returns This layout manager, for method chaining.
     *
     * @remarks Clearing here rather than only in {@link FlowLayout.detach} is
     * what covers a manager moved between containers. `Component.setLayoutManager`
     * detaches the *container's* outgoing manager, never the *manager's* previous
     * container, so a reused manager arrives still holding the old measurement
     * and would report it for children it no longer has.
     */
    attach(container: Component): this {
        super.attach(container);

        this._wrappedLineExtent = null;

        return this;
    }

    /**
     * Returns which axes are made uniform so wrapped items align into a grid.
     *
     * @returns The current uniformity mode.
     */
    getUniform(): FlowUniformity {
        return this._uniform;
    }

    /**
     * Sets which axes are made uniform so wrapped items align into a grid.
     *
     * @param uniform - `"width"` aligns columns, `"height"` aligns rows,
     *   `"both"` produces a full grid, `"none"` packs each item at its own
     *   size. See {@link FlowUniformity}.
     *
     * @returns This layout manager, for method chaining.
     */
    setUniform(uniform: FlowUniformity): this {
        this._uniform = uniform;

        return this;
    }

    /**
     * Returns how each wrapped line's content block is packed along the main
     * axis within the container's inner main extent.
     *
     * @returns The current line alignment.
     */
    getAlign(): AxisPosition {
        return this._align;
    }

    /**
     * Sets how each wrapped line's content block is packed along the main axis.
     *
     * @param align - `"start"` packs at the leading edge (the default),
     *   `"center"` centres the block, `"end"` packs at the trailing edge. The
     *   leading/trailing edges are west/east for {@link HFlow} and north/south
     *   for {@link VFlow}. See {@link AxisPosition}.
     *
     * @returns This layout manager, for method chaining.
     */
    setAlign(align: AxisPosition): this {
        this._align = align;

        return this;
    }

    /**
     * Returns how each item is aligned within its wrapped line's cross extent.
     *
     * @returns The current cross-axis item alignment.
     */
    getItemAlign(): FlowItemAlign {
        return this._itemAlign;
    }

    /**
     * Sets how each item is aligned within its wrapped line's cross extent — the
     * row height for {@link HFlow}, the column width for {@link VFlow}.
     *
     * @param itemAlign - `"start"` aligns to the leading cross-edge (the
     *   default), `"center"` centres, `"end"` aligns to the trailing cross-edge,
     *   `"baseline"` aligns text baselines across an {@link HFlow} row.
     *   `"baseline"` degrades to `"start"` on {@link VFlow}, which has no shared
     *   text baseline. See {@link FlowItemAlign}.
     *
     * @returns This layout manager, for method chaining.
     */
    setItemAlign(itemAlign: FlowItemAlign): this {
        this._itemAlign = itemAlign;

        return this;
    }

    /**
     * Returns how each wrapped line's items are distributed along the main axis.
     *
     * @returns The current main-axis distribution.
     */
    getJustify(): AxisSpread {
        return this._justify;
    }

    /**
     * Sets how each wrapped line's items are distributed along the main axis by
     * growing the inter-item gaps.
     *
     * @param justify - `"start"` packs items with the fixed `spacing` (the
     *   default), `"between"` makes the first/last items flush to the edges with
     *   equal interior gaps, `"around"` puts an equal gap around every item. See
     *   {@link AxisSpread}.
     *
     * @returns This layout manager, for method chaining.
     *
     * @remarks When `justify` is `"between"` or `"around"` the line fills the
     * inner main extent, so it owns the residual and {@link AxisPosition} (the
     * `align` option) is ignored. A single-item or over-long line degrades to
     * `"start"`.
     */
    setJustify(justify: AxisSpread): this {
        this._justify = justify;

        return this;
    }

    /**
     * Whether cells are made uniform on the horizontal axis (columns align).
     *
     * @returns `true` for the `"width"` and `"both"` uniformity modes.
     */
    protected isUniformWidth(): boolean {
        return this._uniform === "width" || this._uniform === "both";
    }

    /**
     * Whether cells are made uniform on the vertical axis (rows align).
     *
     * @returns `true` for the `"height"` and `"both"` uniformity modes.
     */
    protected isUniformHeight(): boolean {
        return this._uniform === "height" || this._uniform === "both";
    }

    /**
     * Computes the uniform cell extent: the widest and tallest clamped preferred
     * size across the children, used to size cells in a `uniform` mode.
     *
     * @param components - The children sharing the flow.
     * @returns The `{width, height}` every uniform cell uses on its axis.
     */
    protected computeUniformExtents(components: Component[]): Size {
        let width = 0;
        let height = 0;

        for (const component of components) {
            const cell = this.clampedPreferredSize(component);

            width  = Math.max(width,  cell.width);
            height = Math.max(height, cell.height);
        }

        return {
            width: width,
            height: height
        };
    }

    /**
     * Resolves a child's placed size: its preferred size clamped to its own
     * min and max sizes — the minimum wins when the two conflict.
     *
     * @param component - The child to measure.
     * @returns The clamped `{width, height}`.
     */
    protected clampedPreferredSize(component: Component): Size {
        const pref = component.getPreferredSize();
        const min  = component.getMinSize();
        const max  = component.getMaxSize();

        let width  = pref ? pref.width : 0;
        let height = pref ? pref.height : 0;

        if (max) {
            width  = Math.min(width,  max.width);
            height = Math.min(height, max.height);
        }

        if (min) {
            width  = Math.max(width,  min.width);
            height = Math.max(height, min.height);
        }

        return {
            width: width,
            height: height
        };
    }

    /**
     * Computes the per-line leading offset that packs a content block of the
     * given main extent within the inner main extent per the alignment mode.
     *
     * @param contentMain - The line's content main-extent (sum of placed cell
     *   main-extents plus inter-item spacing).
     * @param innerMain - The container's inner extent along the main axis.
     * @returns The leading offset in pixels — `0` for `"start"`, half the
     *   residual for `"center"`, the full residual for `"end"`. An over-long
     *   line (content exceeding the inner extent) clamps to `0`.
     */
    protected alignLead(contentMain: number, innerMain: number): number {
        const residual = Math.max(0, innerMain - contentMain);

        if (this._align === "center") {
            return residual / 2;
        }

        if (this._align === "end") {
            return residual;
        }

        return 0;
    }

    /**
     * Computes the leading cross-axis offset that positions a cell within its
     * line's cross extent per the {@link FlowItemAlign} mode. The caller adds
     * this to the line's leading cross-edge (the row top for {@link HFlow}, the
     * column left for {@link VFlow}).
     *
     * @param cellExtent - The cell's own cross extent (its height for HFlow, its
     *   width for VFlow).
     * @param lineExtent - The line's cross extent (the row height for HFlow, the
     *   column width for VFlow); always at least `cellExtent`.
     * @param baseline - The cell's own baseline, or `null` for a graphical cell.
     *   Only consulted for `"baseline"`.
     * @param rowAscent - The line's text baseline from `computeRowMetrics`, or
     *   `null` when no cell reports one (always `null` for VFlow). Only consulted
     *   for `"baseline"`.
     * @param rowDescent - The line's text descent from `computeRowMetrics`. Only
     *   consulted for `"baseline"`.
     * @returns The leading offset in pixels — `0` for `"start"`, and never
     *   negative.
     *
     * @remarks The `"baseline"` arm mirrors HBox's per-child baseline placement:
     * a text-bearing cell aligns on `rowAscent - baseline`, a null-baseline cell
     * centres in the text line, and a baseline-less line (`rowAscent === null`,
     * the VFlow case) falls back to `"start"`.
     */
    protected crossOffset(cellExtent: number, lineExtent: number, baseline: number | null, rowAscent: number | null, rowDescent: number): number {
        switch (this._itemAlign) {
            case "center":
                return Math.max(0, (lineExtent - cellExtent) / 2);

            case "end":
                return Math.max(0, lineExtent - cellExtent);

            case "baseline":
                if (rowAscent === null) {
                    return 0;
                }

                return baseline !== null
                    ? rowAscent - baseline
                    : this.nullChildY(cellExtent, rowAscent, rowDescent);

            case "start":
            default:
                return 0;
        }
    }

    /**
     * Whether the child's stored `fill` constraint carries this flow's cross
     * axis, making it an align-self stretch against its wrapped line.
     *
     * @param component - The child whose constraints supply the fill intent.
     * @param horizontal - `true` for HFlow (cross axis is vertical), `false`
     *   for VFlow (cross axis is horizontal).
     * @returns `true` when the child stretches to its line's cross extent.
     */
    protected isCrossFilled(component: Component, horizontal: boolean): boolean {
        const fill = this.getLayoutConstraints(component)?.fill ?? null;

        return horizontal
            ? (fill === FillType.VERTICAL   || fill === FillType.BOTH)
            : (fill === FillType.HORIZONTAL || fill === FillType.BOTH);
    }

    /**
     * Whether the child's stored `fill` constraint carries this flow's *main*
     * axis — a mismatched-orientation intent the flow does not implement (it
     * owns main-axis sizing and wrapping; see {@link isCrossFilled} for the
     * axis the flow does honour). `resolveBounds` reads a child's raw `fill`
     * directly and would otherwise stretch such a child to whatever main-axis
     * cell extent a caller hands it — inert in the default (non-`uniform`)
     * case, where that extent already equals the child's own preferred main
     * extent, but not under a `uniform` mode that widens the cell past it.
     *
     * @param component - The child whose constraints supply the fill intent.
     * @param horizontal - `true` for HFlow (main axis is horizontal), `false`
     *   for VFlow (main axis is vertical).
     * @returns `true` when the child's `fill` names the flow's main axis.
     */
    protected isMainFilled(component: Component, horizontal: boolean): boolean {
        const fill = this.getLayoutConstraints(component)?.fill ?? null;

        return horizontal
            ? (fill === FillType.HORIZONTAL || fill === FillType.BOTH)
            : (fill === FillType.VERTICAL   || fill === FillType.BOTH);
    }

    /**
     * Computes the per-line main-axis spacing under the active
     * {@link AxisSpread} mode.
     *
     * @param itemCount - The number of cells in the line.
     * @param contentMain - The sum of the cells' main extents (no spacing).
     * @param innerMain - The container's inner extent along the main axis.
     * @param spacing - The fixed inter-item spacing in pixels.
     * @returns `{ lead, gap }` — `lead` is the offset before the first item and
     *   `gap` the spacing between successive items.
     *
     * @remarks Degrades to the fixed `spacing` (and `lead` `0`) for `"start"`,
     * single-item lines, and over-long lines, so the gaps are never negative. For
     * the distribution modes the line fills the inner extent, so the caller must
     * skip the `align` block move.
     */
    protected justifyGaps(itemCount: number, contentMain: number, innerMain: number, spacing: number): { lead: number; gap: number } {
        // Degrade to fixed spacing: start mode, fewer than two items, or content
        // already filling (or exceeding) the inner extent — no positive residual
        // to distribute.
        const fixedTotal = contentMain + spacing * Math.max(0, itemCount - 1);

        if (this._justify === "start" || itemCount < 2 || fixedTotal >= innerMain) {
            return { lead: 0, gap: spacing };
        }

        // The total gap budget to distribute, always positive here.
        const free = innerMain - contentMain;

        if (this._justify === "between") {
            return { lead: 0, gap: free / (itemCount - 1) };
        }

        // "around": one whole gap per item, split as half-gaps at the two ends.
        const unit = free / itemCount;

        return { lead: unit / 2, gap: unit };
    }
}
