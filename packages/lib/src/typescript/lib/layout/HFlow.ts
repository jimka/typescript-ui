// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { FlowLayout, FlowLayoutOptions } from "~/layout/FlowLayout.js";
import type { ResolvedPlacement } from "~/layout/LayoutManager.js";
import { FillType } from "~/layout/FillType.js";
import { Size, UNBOUNDED, isUnbounded } from "~/primitive/Size.js";
import { Component } from "~/core/Component.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link HFlow}.
 *
 * @remarks Inherits every flow field (`spacing`, `lineSpacing`, `uniform`,
 * `align`, `itemAlign`, `justify`) from {@link FlowLayoutOptions}; `HFlow` adds
 * none of its own.
 *
 * @category Layouts
 */
export interface HFlowOptions extends FlowLayoutOptions {}

/**
 * One wrapped row of an {@link HFlow}: its ordered cells (each with the width it
 * was placed at, its own cell height, and its baseline for `"baseline"`
 * item-alignment), the row's total content width, the row height, and the row's
 * top in the container's coordinate space. The row height is its tallest cell,
 * except under `"baseline"` item-alignment where it is `rowAscent + rowDescent`,
 * which can exceed the tallest cell.
 */
interface HFlowRow {
    cells: Array<{ component: Component; width: number; height: number; baseline: number | null }>;
    contentWidth: number;
    rowHeight: number;
    y: number;
}

/**
 * A layout manager that packs children in horizontal rows, wrapping to a new
 * line when the next child would exceed the container's inner width. Unlike
 * {@link HBox} it never shrinks a child, and stretches one only on the cross
 * axis and only when that child asks for it with a cross-axis `fill`; each
 * child otherwise keeps its preferred size and lines stack downward. A
 * scroll-enabled host (`Panel.setAutoScroll`) gains a vertical scrollbar once
 * the stacked lines exceed its inner height.
 *
 * @remarks Shares its flow configuration (item/line spacing, cell uniformity,
 * line alignment) with {@link VFlow} through the {@link FlowLayout} base. The
 * `uniform` option grows every cell to the widest and/or tallest item so wrapped
 * items line up into a grid; each item is positioned within its cell by its own
 * {@link AnchorType} constraint (default centre). The `align` option packs each
 * row's content block at the west edge (`"start"`, the default), centred, or the
 * east edge; `justify` instead spreads the row's items across the inner width
 * (`"between"`/`"around"`), and `itemAlign` positions each item within the row
 * height (including `"baseline"`, which aligns text baselines across the row) —
 * the scroll extent comes entirely from the children's committed positions read
 * by `reserveContentFrame`.
 *
 * @category Layouts
 */
class HFlow extends FlowLayout {

    /**
     * Returns the preferred size. The width is the single-line shape of the
     * children — the sum of their preferred widths plus item spacing, or
     * `count * columnWidth` in a `uniform` width mode. The height is the cross
     * extent the children wrapped into at the last layout: the summed row
     * heights plus the gaps between them.
     *
     * @returns The preferred `{width, height}`, or `null` if no container is attached.
     *
     * @remarks The two axes answer different questions. The width is an
     * aspiration — "give me this much and I will not wrap at all" — so it stays
     * the unwrapped sum however the children are actually laid out. The height
     * is a consequence of the width the flow was really given, so it reports the
     * measurement rather than an estimate. Before the first layout at a usable
     * width there is nothing measured yet, and the height falls back to the
     * height of one row; a parent that honours preferred sizes corrects that on
     * the pass after the first.
     */
    getPreferredSize(): Size | null {
        const container = this.getContainer();
        if (!container) {
            return null;
        }

        const perimeterSize = container.getPerimeterSize();
        const components = container.getLaidOutComponents();
        const uniformWidth  = this.isUniformWidth();
        const uniformHeight = this.isUniformHeight();
        const extents = (uniformWidth || uniformHeight) ? this.computeUniformExtents(components) : { width: 0, height: 0 };

        // The measured extent covers every wrapped row; the single-line estimate
        // is only reachable before the first layout at a real width. Gathering
        // its inputs costs a getBaseline() per child, so skip them once either a
        // measurement or the uniform cell height has already answered the height.
        const measured = this.getWrappedLineExtent();
        const needsEstimate = measured === null && !uniformHeight;

        let width = perimeterSize.left + perimeterSize.right;
        const heights: number[] = [];
        const baselines: Array<number | null> = [];

        for (const component of components) {
            const size = component.getPreferredSize();

            if (size) {
                if (!uniformWidth) {
                    width += size.width;
                }

                if (needsEstimate) {
                    heights.push(size.height);
                    baselines.push(component.getBaseline());
                }
            }
        }

        if (uniformWidth) {
            width += components.length * extents.width;
        }

        width += this._spacing * Math.max(0, components.length - 1);

        let height = measured !== null
            ? measured
            : (uniformHeight ? extents.height : this.lineExtent(heights, baselines));

        height += perimeterSize.top + perimeterSize.bottom;

        return {
            width: width,
            height: height
        };
    }

    /**
     * Returns the minimum size: the widest child's min width (the floor below
     * which not even one child per line fits) and one row's height taken over
     * the children's min heights.
     *
     * @returns The minimum `{width, height}`, or `null` if no container is attached.
     *
     * @remarks The row height follows the current `itemAlign` — the tallest min
     * under every alignment that places a cell inside its row, and
     * `rowAscent + rowDescent` under `"baseline"`. It has to use the same rule
     * the preferred size does, or a `start`-aligned row of baseline-bearing
     * children reports a minimum above its own preferred height.
     */
    getMinSize(): Size | null {
        const container = this.getContainer();
        if (!container) {
            return null;
        }

        const perimeterSize = container.getPerimeterSize();
        const components = container.getLaidOutComponents();

        let maxChildMinWidth = 0;
        const heights: number[] = [];
        const baselines: Array<number | null> = [];

        for (const component of components) {
            const size = component.getMinSize();

            if (size) {
                maxChildMinWidth = Math.max(maxChildMinWidth, size.width);
                heights.push(size.height);
                baselines.push(component.getBaseline());
            }
        }

        const width = perimeterSize.left + perimeterSize.right + maxChildMinWidth;

        let height = this.lineExtent(heights, baselines);

        height += perimeterSize.top + perimeterSize.bottom;

        return {
            width: width,
            height: height
        };
    }

    /**
     * Returns the maximum size the flow can usefully occupy: with every child on
     * one line the width is the sum of the children's *maximum* widths (or
     * `count * columnWidth` in a `uniform` width mode) plus item spacing, and the
     * height is the *largest* child maximum — the tallest a single row can grow
     * to. A child whose maximum is `null` or at the unbounded sentinel makes that
     * axis unbounded.
     *
     * @returns The maximum `{width, height}`, or `null` if no container is attached.
     *
     * @remarks Once a layout has measured a wrapped height, that measurement
     * floors the height reported here. A single row's maximum can otherwise sit
     * below the wrapped height the preferred size reports, and a host that sizes
     * itself to its content would clamp the flow back to one row and clip the
     * rest.
     */
    getMaxSize(): Size | null {
        const container = this.getContainer();
        if (!container) {
            return null;
        }

        const perimeterSize = container.getPerimeterSize();
        const components = container.getLaidOutComponents();
        const uniformWidth = this.isUniformWidth();
        const extents = uniformWidth ? this.computeUniformExtents(components) : { width: 0, height: 0 };

        let width = perimeterSize.left + perimeterSize.right;
        let height = 0;
        let widthUnbounded = false;
        let heightUnbounded = false;

        for (const component of components) {
            const max = component.getMaxSize();

            if (!max) {
                if (!uniformWidth) {
                    widthUnbounded = true;
                }
                heightUnbounded = true;
                continue;
            }

            if (!uniformWidth) {
                if (isUnbounded(max.width)) {
                    widthUnbounded = true;
                } else {
                    width += max.width;
                }
            }

            if (isUnbounded(max.height)) {
                heightUnbounded = true;
            } else {
                height = Math.max(height, max.height);
            }
        }

        if (uniformWidth) {
            width += components.length * extents.width;
        }

        width += this._spacing * Math.max(0, components.length - 1);

        // The single-row maximum above can sit below the wrapped extent
        // getPreferredSize now reports. ARCHITECTURE binds min <= preferred <=
        // max, and a host that clamps to its content would otherwise clamp the
        // flow back to one row's height — re-clipping the very overflow the
        // measurement exists to expose. Floor the maximum at the measurement.
        const measured = this.getWrappedLineExtent();

        if (measured !== null && !heightUnbounded) {
            height = Math.max(height, measured);
        }

        height += perimeterSize.top + perimeterSize.bottom;

        return {
            width:  widthUnbounded  ? UNBOUNDED : width,
            height: heightUnbounded ? UNBOUNDED : height
        };
    }

    /**
     * Packs the children left-to-right at their cell size, wrapping to a new
     * line when the next cell's right edge would exceed the inner width, then
     * places each row's content block per the `align` mode. In a `uniform` mode
     * every cell grows to the widest and/or tallest item so the wrapped items
     * line up into a grid. A scroll-enabled host then scrolls the overflow via
     * `reserveContentFrame`, which sizes the content frame to the children's
     * committed extent.
     */
    doLayout(): void {
        const container = this.getContainer();
        if (!container) {
            return;
        }

        const innerSize = container.getInnerSize();
        if (!innerSize) {
            return;
        }

        const components  = container.getLaidOutComponents();
        const insets      = container.getContentInsets();
        const spacing     = this.getComponentSpacing();
        const lineSpacing = this.getLineSpacing();

        const uniformWidth  = this.isUniformWidth();
        const uniformHeight = this.isUniformHeight();
        const extents = (uniformWidth || uniformHeight) ? this.computeUniformExtents(components) : { width: 0, height: 0 };

        const rows = this.groupIntoRows(components, innerSize.width, insets.getTop(), spacing, lineSpacing, uniformWidth, uniformHeight, extents);

        const placements = this.resolveRows(rows, insets.getLeft(), innerSize.width, spacing);

        this.commitPlacements(placements);

        // Only a wrap run against a real width says anything. Before the first
        // sizing pass getInnerSize() is NaN-wide, every `> NaN` comparison is
        // false, and the children collapse into one bogus row — the same reason
        // Table.doLayout guards its width arithmetic.
        if (Number.isFinite(innerSize.width)) {
            this.publishWrappedLineExtent(this.rowsCrossExtent(rows, lineSpacing));
        }

        this.reserveContentFrame();
    }

    /**
     * Phase 1 of {@link HFlow.doLayout}: walks the children left-to-right,
     * wrapping into rows, and records each row's cells, content width, height,
     * and top — without committing any bounds. A first cell wider than the inner
     * width is clamped to that width so its right edge stays inside a scrolling
     * host.
     *
     * @param components - The children to place, in order.
     * @param innerWidth - The container's inner width (the wrap threshold).
     * @param topInset - The container's top content inset (the first row's top).
     * @param spacing - Inter-item horizontal spacing in pixels.
     * @param lineSpacing - Inter-row vertical spacing in pixels.
     * @param uniformWidth - Whether cells take the uniform width.
     * @param uniformHeight - Whether cells take the uniform height.
     * @param extents - The uniform cell extents, when a uniform mode is active.
     * @returns The ordered rows ready for {@link HFlow.resolveRows}.
     */
    private groupIntoRows(components: Component[], innerWidth: number, topInset: number, spacing: number, lineSpacing: number, uniformWidth: boolean, uniformHeight: boolean, extents: Size): HFlowRow[] {
        const rows: HFlowRow[] = [];
        let y = topInset;
        let current: HFlowRow | null = null;

        for (const component of components) {
            const cell = this.clampedPreferredSize(component);
            const cellWidth  = uniformWidth  ? extents.width  : cell.width;
            const cellHeight = uniformHeight ? extents.height : cell.height;

            // Wrap before placing when the current row is non-empty and this
            // cell's right edge (including the joining spacing) would spill past
            // the inner width.
            if (current && current.contentWidth + spacing + cellWidth > innerWidth) {
                y += current.rowHeight + lineSpacing;
                current = null;
            }

            if (!current) {
                current = { cells: [], contentWidth: 0, rowHeight: 0, y: y };

                rows.push(current);
            }

            // A cell wider than the inner width occupies its own line clamped to
            // that width, so its right edge stays inside a scrolling host.
            const placedWidth = (current.cells.length === 0) ? Math.min(cellWidth, innerWidth) : cellWidth;

            current.contentWidth += (current.cells.length === 0) ? placedWidth : spacing + placedWidth;
            current.cells.push({ component: component, width: placedWidth, height: cellHeight, baseline: component.getBaseline() });
            current.rowHeight = this.rowExtent(current, cellHeight);
        }

        return rows;
    }

    /**
     * Phase 2 of {@link HFlow.doLayout}: distributes each row's cells along the
     * main axis per the `justify` mode (or packs them at the `align` offset when
     * `justify` is `"start"`), and resolves each cell's bounds within the row
     * height per the `itemAlign` mode. Each child keeps its preferred size
     * (`FillType.NONE`) unless its own constraints set a cross-axis `fill`,
     * which sizes it to the row's cross extent instead; its own
     * {@link AnchorType} positions it within its cell.
     *
     * @param rows - The rows produced by {@link HFlow.groupIntoRows}.
     * @param leftInset - The container's left content inset (the row's leading edge).
     * @param innerWidth - The container's inner width (for the alignment residual).
     * @param spacing - Inter-item horizontal spacing in pixels.
     * @returns The resolved placements, ready for {@link LayoutManager.commitPlacements}.
     */
    private resolveRows(rows: HFlowRow[], leftInset: number, innerWidth: number, spacing: number): ResolvedPlacement[] {
        const placements: ResolvedPlacement[] = [];

        for (const row of rows) {
            // Row text metrics for "baseline" itemAlign (cheap; only used then).
            const heights   = row.cells.map(cell => cell.height);
            const baselines = row.cells.map(cell => cell.baseline);

            const { rowAscent, rowDescent } = this.computeRowMetrics(heights, baselines);

            const { lead, gap } = this.justifyGaps(row.cells.length, this.cellsMainExtent(row), innerWidth, spacing);

            // A justify mode fills the inner extent and owns the residual, so the
            // align block move only applies when justify === "start".
            const blockLead = this._justify === "start"
                ? this.alignLead(row.contentWidth, innerWidth)
                : 0;

            let x = leftInset + blockLead + lead;

            for (const cell of row.cells) {
                const crossFilled = this.isCrossFilled(cell.component, true);
                const cellHeight  = crossFilled ? row.rowHeight : cell.height;
                const y           = row.y + (crossFilled ? 0 : this.crossOffset(cell.height, row.rowHeight, cell.baseline, rowAscent, rowDescent));

                // A raw fill naming this flow's main (horizontal) axis is a
                // mismatched orientation the flow does not implement — hand
                // resolveBounds the cell's own clamped preferred width instead
                // of the (possibly uniform-widened) packed width, so it can't
                // silently stretch into the uniform grid slot.
                const mainFilled = this.isMainFilled(cell.component, true);
                const cellWidth  = mainFilled ? this.clampedPreferredSize(cell.component).width : cell.width;

                placements.push({ component: cell.component, ...this.resolveBounds(cell.component, x, y, cellWidth, cellHeight, FillType.NONE) });

                x += cell.width + gap;
            }
        }

        return placements;
    }

    /**
     * Sums a row's cell widths without the inter-item spacing — the content
     * main-extent {@link FlowLayout.justifyGaps} distributes the residual around.
     *
     * @param row - The row to measure.
     * @returns The total cell width in pixels.
     */
    private cellsMainExtent(row: HFlowRow): number {
        return row.cells.reduce((sum, cell) => sum + cell.width, 0);
    }

    /**
     * Sums the rows' heights plus the gaps between them — the cross extent the
     * children actually occupy once wrapped.
     *
     * @param rows - The rows produced by {@link HFlow.groupIntoRows}.
     * @param lineSpacing - The gap between wrapped rows in pixels.
     *
     * @returns The total row extent in pixels, excluding the container perimeter.
     */
    private rowsCrossExtent(rows: HFlowRow[], lineSpacing: number): number {
        if (rows.length === 0) {
            return 0;
        }

        let extent = lineSpacing * (rows.length - 1);

        for (const row of rows) {
            extent += row.rowHeight;
        }

        return extent;
    }

    /**
     * Returns how tall a row has to be to hold the cells placed in it so far,
     * having just taken one more.
     *
     * @param row - The row being filled, including the cell just pushed.
     * @param addedHeight - The height of the cell just pushed.
     *
     * @returns The row's cross extent in pixels.
     *
     * @remarks Under every alignment but `"baseline"` a cell is placed inside
     * the row, so the row is exactly its tallest cell — folded in one cell at a
     * time. That agrees with {@link HFlow.lineExtent} over the whole row because
     * a maximum is associative and both start from `0`. Baseline alignment
     * cannot be folded: it offsets each cell by `rowAscent - baseline`, which can
     * push a low-baseline child's descender below the bottom of a taller one, so
     * the row is `rowAscent + rowDescent` — a function of every cell at once,
     * recomputed over the row so far. Using one number for both the row's height
     * and its advance is what keeps wrapped baseline rows from overlapping.
     */
    private rowExtent(row: HFlowRow, addedHeight: number): number {
        if (this._itemAlign !== "baseline") {
            return Math.max(row.rowHeight, addedHeight);
        }

        return this.lineExtent(
            row.cells.map(cell => cell.height),
            row.cells.map(cell => cell.baseline),
        );
    }

    /**
     * Returns how tall one line of children has to be under the current
     * `itemAlign`.
     *
     * @param heights - The children's heights, in line order.
     * @param baselines - Each child's baseline, or null where it reports none.
     *
     * @returns The line's cross extent in pixels.
     *
     * @remarks The shared formula behind the minimum, the pre-layout estimate,
     * and the measured row extent — {@link HFlow.rowExtent} calls it directly
     * for a baseline row and folds the same maximum cell-by-cell otherwise.
     * Before it, the minimum was baseline-aware unconditionally while the
     * measurement was not, which inverted `min <= preferred` for a
     * `start`-aligned row whose children happened to report baselines.
     *
     * One caller opts out: under a `uniform` height mode the preferred size
     * takes the uniform cell height instead of asking here. (The row extent does
     * not opt out — its cells carry the uniform height, but a baseline row is
     * still measured by `rowAscent + rowDescent` over them, which can exceed
     * that height.) A pre-layout `min > preferred` inversion survives for a
     * baseline-aligned uniform row of children with pinned minimums, because the
     * minimum has no uniform cell to take. That inversion predates this method
     * and is not introduced by it; the first layout resolves it.
     */
    private lineExtent(heights: number[], baselines: Array<number | null>): number {
        if (this._itemAlign !== "baseline") {
            return heights.reduce((tallest, height) => Math.max(tallest, height), 0);
        }

        return this.computeRowHeight(heights, baselines);
    }
}

const HFlowCallable = callable(HFlow);
type HFlowCallable = HFlow;
export {
    HFlow         as _HFlow,
    HFlowCallable as HFlow
};
