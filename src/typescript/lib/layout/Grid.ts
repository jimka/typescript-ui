// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { FillType } from "~/layout/FillType.js";
import { Size } from "~/Size.js";
import { Component } from "~/Component.js";
import { callable } from "~/Callable.js";

/**
 * Construction-time options for {@link Grid}.
 *
 * @category Layouts
 */
export interface GridOptions extends LayoutManagerOptions {
    rows?:       number;
    columns?:    number;
    spacing?:    number;
    stretching?: boolean;
}

/**
 * A layout manager that tiles children in a uniform grid of equal-sized cells.
 * Row and column counts can be configured explicitly or left at `0` for auto-calculation.
 *
 * @category Layouts
 */
class Grid extends LayoutManager {

    private rows: number = 0;
    private columns: number = 0;
    private spacing: number = 5;
    private stretching: boolean = true;

    constructor(options?: GridOptions) {
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link GridOptions} bag, dispatching grid dimensions, spacing,
     * and stretching after the inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: GridOptions): void {
        super.applyOptions(options);

        if (options.rows !== undefined) {
            this.setRows(options.rows);
        }

        if (options.columns !== undefined) {
            this.setColumns(options.columns);
        }

        if (options.spacing !== undefined) {
            this.setComponentSpacing(options.spacing);
        }

        if (options.stretching !== undefined) {
            this.setStretching(options.stretching);
        }
    }

    /**
     * Returns whether children stretch to fill their cells.
     *
     * @returns `true` if stretching is enabled (default).
     */
    isStretching(): boolean {
        return this.stretching;
    }

    /**
     * Sets whether children stretch to fill their cells. When `false`, each row
     * uses the natural heights of its children and components are
     * baseline-aligned within the row.
     *
     * @param stretching - Pass `false` to enable per-row baseline alignment instead of stretching.
     */
    setStretching(stretching: boolean): this {
        this.stretching = stretching;

        return this;
    }

    /**
     * Returns the configured number of rows, or `0` if the grid auto-calculates row count.
     *
     * @returns The row count.
     */
    getRows() {
        return this.rows;
    }

    /**
     * Sets the number of rows. Pass `0` to let the grid auto-calculate.
     *
     * @param rows - The desired row count, or `0` for automatic.
     */
    setRows(rows: number) : this {
        this.rows = rows;

        return this;
    }

    /**
     * Returns the gap, in pixels, between adjacent cells (horizontally and vertically).
     *
     * @returns The current spacing in pixels.
     */
    getComponentSpacing() {
        return this.spacing || 0;
    }

    /**
     * Sets the gap, in pixels, between adjacent cells. Applied both horizontally
     * (between columns) and vertically (between rows).
     *
     * @param spacing - Spacing in pixels. Falsy values are treated as `0`.
     */
    setComponentSpacing(spacing: number) : this {
        this.spacing = spacing || 0;

        return this;
    }

    /**
     * Returns the configured number of columns, or `0` if the grid auto-calculates column count.
     *
     * @returns The column count.
     */
    getColumns() {
        return this.columns;
    }

    /**
     * Sets the number of columns. Pass `0` to let the grid auto-calculate.
     *
     * @param columns - The desired column count, or `0` for automatic.
     */
    setColumns(columns: number) : this {
        this.columns = columns;

        return this;
    }

    /**
     * Returns the computed cell count for the current component list as `{width: rows, height: columns}`.
     *
     * @returns An object with `width` (row count) and `height` (column count), or `undefined` if no container is attached.
     *
     * @remarks The property names `width` and `height` are repurposed here to carry row/column counts
     * rather than pixel dimensions.
     */
    getColRowCount() {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let components = container.getComponents();
        let componentCount = components.length;

        let rows = 0;
        let columns = 0;

        if (!this.rows && !this.columns) {
            columns = Math.floor(Math.sqrt(componentCount));
            rows = Math.ceil(componentCount / columns);
        } else if (this.rows && this.columns) {
            rows = this.rows;
            columns = Math.floor(Math.sqrt(componentCount / rows));
        } else if (this.columns) {
            columns = this.columns;
            rows = Math.ceil(componentCount / columns);
        }

        return {
            width: rows,
            height: columns
        };
    }

    /**
     * Returns the preferred size: the maximum child preferred size multiplied by the computed row/column counts, plus inter-cell spacing.
     *
     * @returns The preferred `{width, height}`, or `null` if no container is attached.
     */
    getPreferredSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let components = container.getComponents();

        let innerWidth = 0;
        let innerHeight = 0;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getPreferredSize();

            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight = Math.max(innerHeight, size.height);
            }
        }

        let colRowCount = this.getColRowCount();
        let spacing = this.getComponentSpacing();

        if (colRowCount) {
            innerWidth = innerWidth * colRowCount.width + Math.max(0, colRowCount.width - 1) * spacing;
            innerHeight = innerHeight * colRowCount.height + Math.max(0, colRowCount.height - 1) * spacing;
        }

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Returns the minimum size: the maximum child minimum size multiplied by the computed row/column counts, plus inter-cell spacing.
     *
     * @returns The minimum `{width, height}`, or `null` if no container is attached.
     */
    getMinSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let components = container.getComponents();

        let innerWidth = 0;
        let innerHeight = 0;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMinSize();

            if (size) {
                innerWidth = Math.max(innerWidth, size.width);
                innerHeight = Math.max(innerHeight, size.height);
            }
        }

        let colRowCount = this.getColRowCount();
        let spacing = this.getComponentSpacing();

        if (colRowCount) {
            innerWidth = innerWidth * colRowCount.width + Math.max(0, colRowCount.width - 1) * spacing;
            innerHeight = innerHeight * colRowCount.height + Math.max(0, colRowCount.height - 1) * spacing;
        }

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Returns the maximum size: the minimum child maximum size multiplied by the computed row/column counts, plus inter-cell spacing.
     *
     * @returns The maximum `{width, height}`, or `null` if no container is attached.
     */
    getMaxSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let components = container.getComponents();

        let innerWidth = Number.MAX_SAFE_INTEGER;
        let innerHeight = Number.MAX_SAFE_INTEGER;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMaxSize();

            if (size) {
                innerWidth = Math.min(innerWidth, size.width);
                innerHeight = Math.min(innerHeight, size.height);
            }
        }

        let colRowCount = this.getColRowCount();
        let spacing = this.getComponentSpacing();

        if (colRowCount) {
            innerWidth = innerWidth * colRowCount.width + Math.max(0, colRowCount.width - 1) * spacing;
            innerHeight = innerHeight * colRowCount.height + Math.max(0, colRowCount.height - 1) * spacing;
        }

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Tiles all children in a grid of equal-sized cells, left-to-right then top-to-bottom.
     *
     * @remarks When stretching is enabled (default) cells are equal-sized and each
     * child fills its cell. When stretching is disabled, columns remain uniform-width
     * but each row uses the natural heights of its children and components are
     * baseline-aligned within their row, mirroring `HBox`'s baseline-aware placement.
     */
    doLayout() {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let components = container.getComponents();
        let containerInsets = container.getInsets();
        let containerSize = container.getInnerSize();
        if (!containerSize) {
            return;
        }

        let colRowCount = this.getColRowCount();
        let cols = colRowCount ? colRowCount.width  : 1;
        let rows = colRowCount ? colRowCount.height : 1;
        let spacing = this.getComponentSpacing();

        let totalHSpacing = Math.max(0, cols - 1) * spacing;
        let totalVSpacing = Math.max(0, rows - 1) * spacing;
        let columnWidth   = (containerSize.width  - totalHSpacing) / cols;
        let columnHeight  = (containerSize.height - totalVSpacing) / rows;

        if (this.stretching) {
            let colIdx = 0;
            let x = containerInsets.getLeft();
            let y = containerInsets.getTop();

            for (let idx in components) {
                let component = components[idx];

                this.placeComponent(
                    component,
                    x,
                    y,
                    columnWidth,
                    columnHeight,
                    FillType.BOTH
                );

                colIdx += 1;

                if (colIdx >= cols) {
                    colIdx = 0;

                    x = containerInsets.getLeft();
                    y += columnHeight + spacing;
                } else {
                    x += columnWidth + spacing;
                }
            }

            return;
        }

        let y = containerInsets.getTop();

        for (let row = 0; row < rows; row += 1) {
            const rowComponents: Component[] = [];
            const rowHeights: number[] = [];
            const rowBaselines: Array<number | null> = [];

            for (let col = 0; col < cols; col += 1) {
                const idx = row * cols + col;
                if (idx >= components.length) {
                    break;
                }

                const component = components[idx];
                const size = component.getPreferredSize();

                rowComponents.push(component);
                rowHeights.push(size ? size.height : 0);
                rowBaselines.push(component.getBaseline());
            }

            const { rowAscent, rowDescent } = this.computeRowMetrics(rowHeights, rowBaselines);

            let x = containerInsets.getLeft();

            for (let i = 0; i < rowComponents.length; i += 1) {
                const component = rowComponents[i];
                const height = rowHeights[i];

                let cellY: number;

                if (rowAscent !== null) {
                    const b = rowBaselines[i];

                    if (b !== null) {
                        cellY = y + (rowAscent - b);
                    } else {
                        cellY = y + this.nullChildY(height, rowAscent, rowDescent);
                    }
                } else {
                    cellY = y;
                }

                this.placeComponent(
                    component,
                    x,
                    cellY,
                    columnWidth,
                    height,
                    FillType.BOTH
                );

                x += columnWidth + spacing;
            }

            y += columnHeight + spacing;
        }
    }
}

const GridCallable = callable(Grid);
type GridCallable = Grid;
export {
    Grid         as _Grid,
    GridCallable as Grid
};
