// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { FillType } from "~/layout/FillType.js";
import { Size } from "~/primitive/Size.js";
import { Component } from "~/core/Component.js";
import { callable } from "~/core/Callable.js";

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

    private _rows: number = 0;
    private _columns: number = 0;
    private _spacing: number = 5;
    private _stretching: boolean = true;

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
        return this._stretching;
    }

    /**
     * Sets whether children stretch to fill their cells. When `false`, each row
     * uses the natural heights of its children and components are
     * baseline-aligned within the row.
     *
     * @param stretching - Pass `false` to enable per-row baseline alignment instead of stretching.
     */
    setStretching(stretching: boolean): this {
        this._stretching = stretching;

        return this;
    }

    /**
     * Returns the configured number of rows, or `0` if the grid auto-calculates row count.
     *
     * @returns The row count.
     */
    getRows() {
        return this._rows;
    }

    /**
     * Sets the number of rows. Pass `0` to let the grid auto-calculate.
     *
     * @param rows - The desired row count, or `0` for automatic.
     */
    setRows(rows: number) : this {
        this._rows = rows;

        return this;
    }

    /**
     * Returns the gap, in pixels, between adjacent cells (horizontally and vertically).
     *
     * @returns The current spacing in pixels.
     */
    getComponentSpacing() {
        return this._spacing || 0;
    }

    /**
     * Sets the gap, in pixels, between adjacent cells. Applied both horizontally
     * (between columns) and vertically (between rows).
     *
     * @param spacing - Spacing in pixels. Falsy values are treated as `0`.
     */
    setComponentSpacing(spacing: number) : this {
        this._spacing = spacing || 0;

        return this;
    }

    /**
     * Returns the configured number of columns, or `0` if the grid auto-calculates column count.
     *
     * @returns The column count.
     */
    getColumns() {
        return this._columns;
    }

    /**
     * Sets the number of columns. Pass `0` to let the grid auto-calculate.
     *
     * @param columns - The desired column count, or `0` for automatic.
     */
    setColumns(columns: number) : this {
        this._columns = columns;

        return this;
    }

    /**
     * Returns the computed cell count for the current component list as `{width: rows, height: columns}`.
     *
     * @returns An object with `width` (row count) and `height` (column count), or `undefined` if no container is attached.
     *
     * @remarks The property names `width` and `height` are repurposed here to
     * carry column and row counts rather than pixel dimensions —
     * `result.width` is the column count, `result.height` is the row count.
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

        if (!this._rows && !this._columns) {
            columns = Math.floor(Math.sqrt(componentCount));
            rows = Math.ceil(componentCount / columns);
        } else if (this._rows && this._columns) {
            rows = this._rows;
            columns = this._columns;
        } else if (this._columns) {
            columns = this._columns;
            rows = Math.ceil(componentCount / columns);
        } else {
            rows = this._rows;
            columns = Math.ceil(componentCount / rows);
        }

        return {
            width: columns,
            height: rows
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
     * Computes the children's combined minSize along this manager's geometry:
     * width is `cols * maxChildMinWidth + (cols-1) * spacing`; height is
     * `rows * maxChildMinHeight + (rows-1) * spacing`. Used by `doLayout` to
     * inflate the working size when the host has opted into `setOverflowing`.
     *
     * @returns The total min-size; `{ width: 0, height: 0 }` when the
     *   container is absent or has no children.
     */
    protected computeTotalMinSize(): Size {
        const container = this.getContainer();
        if (!container) {
            return { width: 0, height: 0 };
        }

        const components = container.getComponents();
        if (components.length === 0) {
            return { width: 0, height: 0 };
        }

        const colRowCount = this.getColRowCount();
        const cols = colRowCount ? colRowCount.width  : 1;
        const rows = colRowCount ? colRowCount.height : 1;
        const spacing = this.getComponentSpacing();

        let maxCellWidth = 0;
        let maxCellHeight = 0;

        for (const component of components) {
            const min = component.getMinSize();
            if (min) {
                maxCellWidth  = Math.max(maxCellWidth,  min.width);
                maxCellHeight = Math.max(maxCellHeight, min.height);
            }
        }

        return {
            width:  cols * maxCellWidth  + Math.max(0, cols - 1) * spacing,
            height: rows * maxCellHeight + Math.max(0, rows - 1) * spacing,
        };
    }

    /**
     * Tiles all children in a grid of equal-sized cells, left-to-right then top-to-bottom.
     *
     * @remarks When stretching is enabled (default) cells are equal-sized and each
     * child fills its cell. When stretching is disabled, columns remain uniform-width
     * but each row uses the natural heights of its children and components are
     * baseline-aligned within their row, mirroring [`HBox`](/api/layout/classes/HBox)'s baseline-aware placement.
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

        // Universal scroll: see HBox.doLayout for the rationale. Inflates the
        // working size to the children's combined minSize on the axes the
        // host has marked as overflowing.
        if (this.isOverflowingX() || this.isOverflowingY()) {
            const totalMin = this.computeTotalMinSize();
            const w = this.isOverflowingX() ? Math.max(containerSize.width,  totalMin.width)  : containerSize.width;
            const h = this.isOverflowingY() ? Math.max(containerSize.height, totalMin.height) : containerSize.height;

            containerSize = { width: w, height: h };
        }

        let totalHSpacing = Math.max(0, cols - 1) * spacing;
        let totalVSpacing = Math.max(0, rows - 1) * spacing;
        let columnWidth   = (containerSize.width  - totalHSpacing) / cols;
        let columnHeight  = (containerSize.height - totalVSpacing) / rows;

        if (this._stretching) {
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
