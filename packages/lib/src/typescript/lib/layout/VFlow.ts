// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { FlowLayout, FlowLayoutOptions } from "~/layout/FlowLayout.js";
import type { ResolvedPlacement } from "~/layout/LayoutManager.js";
import { FillType } from "~/layout/FillType.js";
import { Size, UNBOUNDED, isUnbounded } from "~/primitive/Size.js";
import { Component } from "~/core/Component.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link VFlow}.
 *
 * @remarks Inherits every flow field (`spacing`, `lineSpacing`, `uniform`,
 * `align`, `itemAlign`, `justify`) from {@link FlowLayoutOptions}; `VFlow` adds
 * none of its own. `spacing` is the vertical gap between items in a column;
 * `lineSpacing` is the horizontal gap between wrapped columns.
 *
 * @category Layouts
 */
export interface VFlowOptions extends FlowLayoutOptions {}

/**
 * One wrapped column of a {@link VFlow}: its ordered cells (each with its own
 * cell width and the height it was placed at; `baseline` is always `null` since
 * a column exposes no shared text baseline), the column's total content height,
 * the column width (widest cell), and the column's left in the container's
 * coordinate space.
 */
interface VFlowColumn {
    cells: Array<{ component: Component; width: number; height: number; baseline: number | null }>;
    contentHeight: number;
    columnWidth: number;
    x: number;
}

/**
 * A layout manager that packs children in vertical columns, wrapping to a new
 * column when the next child would exceed the container's inner height. The
 * vertical transpose of {@link HFlow}: where `HFlow` packs rows left-to-right
 * and wraps downward, `VFlow` packs columns top-to-bottom and wraps rightward.
 * Like `HFlow` it never shrinks a child, and stretches one only on the cross
 * axis and only when that child asks for it with a cross-axis `fill`; each
 * child otherwise keeps its preferred size. A scroll-enabled host
 * (`Panel.setAutoScroll`) gains a horizontal scrollbar once the columns
 * exceed its inner width.
 *
 * @remarks Shares its flow configuration (item/line spacing, cell uniformity,
 * line alignment) with `HFlow` through the {@link FlowLayout} base. Here
 * `spacing` is the vertical gap between items in a column and `lineSpacing` the
 * horizontal gap between columns. The `align` option packs each column's content
 * block at the north edge (`"start"`, the default), centred, or the south edge;
 * `justify` instead spreads the column's items across the inner height
 * (`"between"`/`"around"`), and `itemAlign` positions each item within the
 * column width. A wrapped column exposes no shared text baseline, so the cross
 * axis (width) uses a plain widest-cell measure and `itemAlign: "baseline"`
 * degrades to `"start"`.
 *
 * @category Layouts
 */
class VFlow extends FlowLayout {

    /**
     * Returns the preferred size. The height is the single-column shape of the
     * children — the sum of their preferred heights plus item spacing, or
     * `count * rowHeight` in a `uniform` height mode. The width is the cross
     * extent the children wrapped into at the last layout: the summed column
     * widths plus the gaps between them.
     *
     * @returns The preferred `{width, height}`, or `null` if no container is attached.
     *
     * @remarks The two axes answer different questions. The height is an
     * aspiration — "give me this much and I will not wrap at all" — so it stays
     * the unwrapped sum however the children are actually laid out. The width is
     * a consequence of the height the flow was really given, so it reports the
     * measurement rather than an estimate. Before the first layout at a usable
     * height there is nothing measured yet, and the width falls back to the
     * widest child; a parent that honours preferred sizes corrects that on the
     * pass after the first.
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

        let height = perimeterSize.top + perimeterSize.bottom;
        let maxWidth = 0;

        for (const component of components) {
            const size = component.getPreferredSize();

            if (size) {
                if (!uniformHeight) {
                    height += size.height;
                }

                maxWidth = Math.max(maxWidth, size.width);
            }
        }

        if (uniformHeight) {
            height += components.length * extents.height;
        }

        height += this._spacing * Math.max(0, components.length - 1);

        // The measured extent covers every wrapped column; the single-column
        // estimate below it is only reachable before the first layout at a real
        // height.
        const measured = this.getWrappedLineExtent();

        let width = measured !== null
            ? measured
            : (uniformWidth ? extents.width : maxWidth);

        width += perimeterSize.left + perimeterSize.right;

        return {
            width: width,
            height: height
        };
    }

    /**
     * Returns the minimum size: the tallest child's min height (the floor below
     * which not even one child per column fits) and the widest child's min
     * width.
     *
     * @returns The minimum `{width, height}`, or `null` if no container is attached.
     */
    getMinSize(): Size | null {
        const container = this.getContainer();
        if (!container) {
            return null;
        }

        const perimeterSize = container.getPerimeterSize();
        const components = container.getLaidOutComponents();

        let maxChildMinHeight = 0;
        let maxWidth = 0;

        for (const component of components) {
            const size = component.getMinSize();

            if (size) {
                maxChildMinHeight = Math.max(maxChildMinHeight, size.height);
                maxWidth = Math.max(maxWidth, size.width);
            }
        }

        const width  = perimeterSize.left + perimeterSize.right + maxWidth;
        const height = perimeterSize.top + perimeterSize.bottom + maxChildMinHeight;

        return {
            width: width,
            height: height
        };
    }

    /**
     * Returns the maximum size the flow can usefully occupy: with every child in
     * one column the height is the sum of the children's *maximum* heights (or
     * `count * rowHeight` in a `uniform` height mode) plus item spacing, and the
     * width is the *largest* child maximum — the widest a single column can grow
     * to. A child whose maximum is `null` or at the unbounded sentinel makes that
     * axis unbounded.
     *
     * @returns The maximum `{width, height}`, or `null` if no container is attached.
     *
     * @remarks Once a layout has measured a wrapped width, that measurement
     * floors the width reported here. A single column's maximum can otherwise
     * sit below the wrapped width the preferred size reports, and a host that
     * sizes itself to its content would clamp the flow back to one column and
     * clip the rest.
     */
    getMaxSize(): Size | null {
        const container = this.getContainer();
        if (!container) {
            return null;
        }

        const perimeterSize = container.getPerimeterSize();
        const components = container.getLaidOutComponents();
        const uniformHeight = this.isUniformHeight();
        const extents = uniformHeight ? this.computeUniformExtents(components) : { width: 0, height: 0 };

        let height = perimeterSize.top + perimeterSize.bottom;
        let width = 0;
        let widthUnbounded = false;
        let heightUnbounded = false;

        for (const component of components) {
            const max = component.getMaxSize();

            if (!max) {
                if (!uniformHeight) {
                    heightUnbounded = true;
                }
                widthUnbounded = true;
                continue;
            }

            if (!uniformHeight) {
                if (isUnbounded(max.height)) {
                    heightUnbounded = true;
                } else {
                    height += max.height;
                }
            }

            if (isUnbounded(max.width)) {
                widthUnbounded = true;
            } else {
                width = Math.max(width, max.width);
            }
        }

        if (uniformHeight) {
            height += components.length * extents.height;
        }

        height += this._spacing * Math.max(0, components.length - 1);

        // The single-column maximum above can sit below the wrapped extent
        // getPreferredSize now reports. ARCHITECTURE binds min <= preferred <=
        // max, and a host that clamps to its content would otherwise clamp the
        // flow back to one column's width — re-clipping the very overflow the
        // measurement exists to expose. Floor the maximum at the measurement.
        const measured = this.getWrappedLineExtent();

        if (measured !== null && !widthUnbounded) {
            width = Math.max(width, measured);
        }

        width += perimeterSize.left + perimeterSize.right;

        return {
            width:  widthUnbounded  ? UNBOUNDED : width,
            height: heightUnbounded ? UNBOUNDED : height
        };
    }

    /**
     * Packs the children top-to-bottom at their cell size, wrapping to a new
     * column when the next cell's bottom edge would exceed the inner height, then
     * places each column's content block per the `align` mode. In a `uniform`
     * mode every cell grows to the widest and/or tallest item so the wrapped
     * items line up into a grid. A scroll-enabled host then scrolls the overflow
     * via `reserveContentFrame`, which sizes the content frame to the children's
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

        const columns = this.groupIntoColumns(components, innerSize.height, insets.getLeft(), spacing, lineSpacing, uniformWidth, uniformHeight, extents);

        const placements = this.resolveColumns(columns, insets.getTop(), innerSize.height, spacing);

        this.commitPlacements(placements);

        // Only a wrap run against a real height says anything. Before the first
        // sizing pass getInnerSize() is NaN-tall, every `> NaN` comparison is
        // false, and the children collapse into one bogus column — the same
        // reason Table.doLayout guards its own arithmetic.
        if (Number.isFinite(innerSize.height)) {
            this.publishWrappedLineExtent(this.columnsCrossExtent(columns, lineSpacing));
        }

        this.reserveContentFrame();
    }

    /**
     * Phase 1 of {@link VFlow.doLayout}: walks the children top-to-bottom,
     * wrapping into columns, and records each column's cells, content height,
     * width, and left — without committing any bounds. A first cell taller than
     * the inner height is clamped to that height so its bottom edge stays inside
     * a scrolling host.
     *
     * @param components - The children to place, in order.
     * @param innerHeight - The container's inner height (the wrap threshold).
     * @param leftInset - The container's left content inset (the first column's left).
     * @param spacing - Inter-item vertical spacing in pixels.
     * @param lineSpacing - Inter-column horizontal spacing in pixels.
     * @param uniformWidth - Whether cells take the uniform width.
     * @param uniformHeight - Whether cells take the uniform height.
     * @param extents - The uniform cell extents, when a uniform mode is active.
     * @returns The ordered columns ready for {@link VFlow.resolveColumns}.
     */
    private groupIntoColumns(components: Component[], innerHeight: number, leftInset: number, spacing: number, lineSpacing: number, uniformWidth: boolean, uniformHeight: boolean, extents: Size): VFlowColumn[] {
        const columns: VFlowColumn[] = [];
        let x = leftInset;
        let current: VFlowColumn | null = null;

        for (const component of components) {
            const cell = this.clampedPreferredSize(component);
            const cellWidth  = uniformWidth  ? extents.width  : cell.width;
            const cellHeight = uniformHeight ? extents.height : cell.height;

            // Wrap before placing when the current column is non-empty and this
            // cell's bottom edge (including the joining spacing) would spill past
            // the inner height.
            if (current && current.contentHeight + spacing + cellHeight > innerHeight) {
                x += current.columnWidth + lineSpacing;
                current = null;
            }

            if (!current) {
                current = { cells: [], contentHeight: 0, columnWidth: 0, x: x };

                columns.push(current);
            }

            // A cell taller than the inner height occupies its own column clamped
            // to that height, so its bottom edge stays inside a scrolling host.
            const placedHeight = (current.cells.length === 0) ? Math.min(cellHeight, innerHeight) : cellHeight;

            current.contentHeight += (current.cells.length === 0) ? placedHeight : spacing + placedHeight;
            current.cells.push({ component: component, width: cellWidth, height: placedHeight, baseline: null });
            current.columnWidth = Math.max(current.columnWidth, cellWidth);
        }

        return columns;
    }

    /**
     * Phase 2 of {@link VFlow.doLayout}: distributes each column's cells along
     * the main axis per the `justify` mode (or packs them at the `align` offset
     * when `justify` is `"start"`), and resolves each cell's bounds within the
     * column width per the `itemAlign` mode. The cross axis is width, which has
     * no text baseline, so `"baseline"` degrades to `"start"`. Each child keeps
     * its preferred size (`FillType.NONE`) unless its own constraints set a
     * cross-axis `fill`, which sizes it to the column's cross extent instead;
     * its own {@link AnchorType} positions it within its cell.
     *
     * @param columns - The columns produced by {@link VFlow.groupIntoColumns}.
     * @param topInset - The container's top content inset (the column's leading edge).
     * @param innerHeight - The container's inner height (for the alignment residual).
     * @param spacing - Inter-item vertical spacing in pixels.
     * @returns The resolved placements, ready for {@link LayoutManager.commitPlacements}.
     */
    private resolveColumns(columns: VFlowColumn[], topInset: number, innerHeight: number, spacing: number): ResolvedPlacement[] {
        const placements: ResolvedPlacement[] = [];

        for (const column of columns) {
            const { lead, gap } = this.justifyGaps(column.cells.length, this.cellsMainExtent(column), innerHeight, spacing);

            // A justify mode fills the inner extent and owns the residual, so the
            // align block move only applies when justify === "start".
            const blockLead = this._justify === "start"
                ? this.alignLead(column.contentHeight, innerHeight)
                : 0;

            let y = topInset + blockLead + lead;

            for (const cell of column.cells) {
                const crossFilled = this.isCrossFilled(cell.component, false);
                const cellWidth   = crossFilled ? column.columnWidth : cell.width;
                // rowAscent null → "baseline" degrades to "start"; cross axis is width.
                const x           = column.x + (crossFilled ? 0 : this.crossOffset(cell.width, column.columnWidth, null, null, 0));

                // A raw fill naming this flow's main (vertical) axis is a
                // mismatched orientation the flow does not implement — hand
                // resolveBounds the cell's own clamped preferred height instead
                // of the (possibly uniform-widened) packed height, so it can't
                // silently stretch into the uniform grid slot.
                const mainFilled = this.isMainFilled(cell.component, false);
                const cellHeight = mainFilled ? this.clampedPreferredSize(cell.component).height : cell.height;

                placements.push({ component: cell.component, ...this.resolveBounds(cell.component, x, y, cellWidth, cellHeight, FillType.NONE) });

                y += cell.height + gap;
            }
        }

        return placements;
    }

    /**
     * Sums a column's cell heights without the inter-item spacing — the content
     * main-extent {@link FlowLayout.justifyGaps} distributes the residual around.
     *
     * @param column - The column to measure.
     * @returns The total cell height in pixels.
     */
    private cellsMainExtent(column: VFlowColumn): number {
        return column.cells.reduce((sum, cell) => sum + cell.height, 0);
    }

    /**
     * Sums the columns' widths plus the gaps between them — the cross extent the
     * children actually occupy once wrapped.
     *
     * @param columns - The columns produced by {@link VFlow.groupIntoColumns}.
     * @param lineSpacing - The gap between wrapped columns in pixels.
     *
     * @returns The total column extent in pixels, excluding the container perimeter.
     */
    private columnsCrossExtent(columns: VFlowColumn[], lineSpacing: number): number {
        if (columns.length === 0) {
            return 0;
        }

        let extent = lineSpacing * (columns.length - 1);

        for (const column of columns) {
            extent += column.columnWidth;
        }

        return extent;
    }
}

const VFlowCallable = callable(VFlow);
type VFlowCallable = VFlow;
export {
    VFlow         as _VFlow,
    VFlowCallable as VFlow
};
