// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { FlowLayout, FlowLayoutOptions } from "~/layout/FlowLayout.js";
import { FillType } from "~/layout/FillType.js";
import { Size, UNBOUNDED, isUnbounded } from "~/primitive/Size.js";
import { Component } from "~/core/Component.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link VFlow}.
 *
 * @remarks Inherits every flow field from {@link FlowLayoutOptions}; `VFlow`
 * adds none of its own. `spacing` is the vertical gap between items in a column;
 * `lineSpacing` is the horizontal gap between wrapped columns.
 *
 * @category Layouts
 */
export interface VFlowOptions extends FlowLayoutOptions {}

/**
 * One wrapped column of a {@link VFlow}: its ordered cells (each with its own
 * cell width and the height it was placed at), the column's total content
 * height, the column width (widest cell), and the column's left in the
 * container's coordinate space.
 */
interface VFlowColumn {
    cells: Array<{ component: Component; width: number; height: number }>;
    contentHeight: number;
    columnWidth: number;
    x: number;
}

/**
 * A layout manager that packs children in vertical columns, wrapping to a new
 * column when the next child would exceed the container's inner height. The
 * vertical transpose of {@link HFlow}: where `HFlow` packs rows left-to-right
 * and wraps downward, `VFlow` packs columns top-to-bottom and wraps rightward.
 * Like `HFlow` it never shrinks or stretches children — each keeps its preferred
 * size. A scroll-enabled host (`Panel.setAutoScroll`) gains a horizontal
 * scrollbar once the columns exceed its inner width.
 *
 * @remarks Shares its flow configuration (item/line spacing, cell uniformity,
 * line alignment) with `HFlow` through the {@link FlowLayout} base. Here
 * `spacing` is the vertical gap between items in a column and `lineSpacing` the
 * horizontal gap between columns. The `align` option packs each column's content
 * block at the north edge (`"start"`, the default), centred, or the south edge.
 * A wrapped column exposes no shared text baseline, so the cross axis (width)
 * uses a plain widest-cell measure rather than a baseline roll-up.
 *
 * @category Layouts
 */
class VFlow extends FlowLayout {

    /**
     * Returns the preferred size: the single-column shape of the children — the
     * sum of their preferred heights plus item spacing, and the widest child's
     * width. In a `uniform` height mode the height is instead `count * rowHeight`;
     * in a `uniform` width mode the width is the widest cell.
     *
     * @returns The preferred `{width, height}`, or `null` if no container is attached.
     *
     * @remarks This is an approximation. The real width depends on how many
     * columns the children wrap into, which is only known once the parent
     * assigns a height — unavailable when the hint is queried. A scroll-enabled
     * host scrolls horizontally when the real wrapped width exceeds this
     * single-column estimate.
     */
    getPreferredSize(): Size | null {
        const container = this.getContainer();
        if (!container) {
            return null;
        }

        const perimiterSize = container.getPerimiterSize();
        const components = container.getLaidOutComponents();
        const uniformWidth  = this.isUniformWidth();
        const uniformHeight = this.isUniformHeight();
        const extents = (uniformWidth || uniformHeight) ? this.computeUniformExtents(components) : { width: 0, height: 0 };

        let height = perimiterSize.top + perimiterSize.bottom;
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

        let width = uniformWidth ? extents.width : maxWidth;

        width += perimiterSize.left + perimiterSize.right;

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

        const perimiterSize = container.getPerimiterSize();
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

        const width  = perimiterSize.left + perimiterSize.right + maxWidth;
        const height = perimiterSize.top + perimiterSize.bottom + maxChildMinHeight;

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
     */
    getMaxSize(): Size | null {
        const container = this.getContainer();
        if (!container) {
            return null;
        }

        const perimiterSize = container.getPerimiterSize();
        const components = container.getLaidOutComponents();
        const uniformHeight = this.isUniformHeight();
        const extents = uniformHeight ? this.computeUniformExtents(components) : { width: 0, height: 0 };

        let height = perimiterSize.top + perimiterSize.bottom;
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
        width += perimiterSize.left + perimiterSize.right;

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

        this.placeColumns(columns, insets.getTop(), innerSize.height, spacing);

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
     * @returns The ordered columns ready for {@link VFlow.placeColumns}.
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
            current.cells.push({ component: component, width: cellWidth, height: placedHeight });
            current.columnWidth = Math.max(current.columnWidth, cellWidth);
        }

        return columns;
    }

    /**
     * Phase 2 of {@link VFlow.doLayout}: places each column's content block at
     * the leading offset the `align` mode dictates, then lays out the cells
     * top-to-bottom at the recorded sizes. Each child keeps its preferred size
     * (`FillType.NONE`); its own {@link AnchorType} positions it within its cell.
     *
     * @param columns - The columns produced by {@link VFlow.groupIntoColumns}.
     * @param topInset - The container's top content inset (the column's leading edge).
     * @param innerHeight - The container's inner height (for the alignment residual).
     * @param spacing - Inter-item vertical spacing in pixels.
     */
    private placeColumns(columns: VFlowColumn[], topInset: number, innerHeight: number, spacing: number): void {
        for (const column of columns) {
            let y = topInset + this.alignLead(column.contentHeight, innerHeight);

            for (const cell of column.cells) {
                this.placeComponent(cell.component, column.x, y, cell.width, cell.height, FillType.NONE);

                y += cell.height + spacing;
            }
        }
    }
}

const VFlowCallable = callable(VFlow);
type VFlowCallable = VFlow;
export {
    VFlow         as _VFlow,
    VFlowCallable as VFlow
};
