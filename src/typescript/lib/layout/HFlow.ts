// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { FlowLayout, FlowLayoutOptions } from "~/layout/FlowLayout.js";
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
 * item-alignment), the row's total content width, the row height (tallest cell),
 * and the row's top in the container's coordinate space.
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
 * {@link HBox} it never shrinks or stretches children: each keeps its preferred
 * size and lines stack downward. A scroll-enabled host (`Panel.setAutoScroll`)
 * gains a vertical scrollbar once the stacked lines exceed its inner height.
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
     * Returns the preferred size: the single-line shape of the children — the
     * sum of their preferred widths plus item spacing, and the baseline-aware
     * row height of the tallest child. In a `uniform` width mode the width is
     * instead `count * columnWidth`; in a `uniform` height mode the height is
     * the tallest cell.
     *
     * @returns The preferred `{width, height}`, or `null` if no container is attached.
     *
     * @remarks This is an approximation. The real height depends on how many
     * lines the children wrap into, which is only known once the parent assigns
     * a width — unavailable when the hint is queried. The parent absorbs the
     * difference: a scroll-enabled host scrolls vertically when the real wrapped
     * height exceeds this single-line estimate.
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

        let width = perimiterSize.left + perimiterSize.right;
        const heights: number[] = [];
        const baselines: Array<number | null> = [];

        for (const component of components) {
            const size = component.getPreferredSize();

            if (size) {
                if (!uniformWidth) {
                    width += size.width;
                }

                heights.push(size.height);
                baselines.push(component.getBaseline());
            }
        }

        if (uniformWidth) {
            width += components.length * extents.width;
        }

        width += this._spacing * Math.max(0, components.length - 1);

        let height = uniformHeight ? extents.height : this.computeRowHeight(heights, baselines);

        height += perimiterSize.top + perimiterSize.bottom;

        return {
            width: width,
            height: height
        };
    }

    /**
     * Returns the minimum size: the widest child's min width (the floor below
     * which not even one child per line fits) and the baseline-aware row height
     * of the children's min heights.
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

        const width = perimiterSize.left + perimiterSize.right + maxChildMinWidth;

        let height = this.computeRowHeight(heights, baselines);

        height += perimiterSize.top + perimiterSize.bottom;

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
     */
    getMaxSize(): Size | null {
        const container = this.getContainer();
        if (!container) {
            return null;
        }

        const perimiterSize = container.getPerimiterSize();
        const components = container.getLaidOutComponents();
        const uniformWidth = this.isUniformWidth();
        const extents = uniformWidth ? this.computeUniformExtents(components) : { width: 0, height: 0 };

        let width = perimiterSize.left + perimiterSize.right;
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
        height += perimiterSize.top + perimiterSize.bottom;

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

        this.placeRows(rows, insets.getLeft(), innerSize.width, spacing);

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
     * @returns The ordered rows ready for {@link HFlow.placeRows}.
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
            current.rowHeight = Math.max(current.rowHeight, cellHeight);
        }

        return rows;
    }

    /**
     * Phase 2 of {@link HFlow.doLayout}: distributes each row's cells along the
     * main axis per the `justify` mode (or packs them at the `align` offset when
     * `justify` is `"start"`), and positions each cell within the row height per
     * the `itemAlign` mode. Each child keeps its preferred size (`FillType.NONE`);
     * its own {@link AnchorType} positions it within its cell.
     *
     * @param rows - The rows produced by {@link HFlow.groupIntoRows}.
     * @param leftInset - The container's left content inset (the row's leading edge).
     * @param innerWidth - The container's inner width (for the alignment residual).
     * @param spacing - Inter-item horizontal spacing in pixels.
     */
    private placeRows(rows: HFlowRow[], leftInset: number, innerWidth: number, spacing: number): void {
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
                const y = row.y + this.crossOffset(cell.height, row.rowHeight, cell.baseline, rowAscent, rowDescent);

                this.placeComponent(cell.component, x, y, cell.width, cell.height, FillType.NONE);

                x += cell.width + gap;
            }
        }
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
}

const HFlowCallable = callable(HFlow);
type HFlowCallable = HFlow;
export {
    HFlow         as _HFlow,
    HFlowCallable as HFlow
};
