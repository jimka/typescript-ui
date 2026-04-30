// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager } from "./LayoutManager.js";
import { FillType } from "./FillType.js";

/**
 * A layout manager that tiles children in a uniform grid of equal-sized cells.
 * Row and column counts can be configured explicitly or left at `0` for auto-calculation.
 */
export class Grid extends LayoutManager {

    private rows: number = 0;
    private columns: number = 0;

    constructor() {
        super();
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
    setRows(rows: number) {
        this.rows = rows;
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
    setColumns(columns: number) {
        this.columns = columns;
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
     * Returns the preferred size: the maximum child preferred size multiplied by the computed row/column counts.
     *
     * @returns The preferred `{width, height}`, or `null` if no container is attached.
     */
    getPreferredSize() {
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

        if (colRowCount) {
            innerWidth = innerWidth * colRowCount.width;
            innerHeight = innerHeight * colRowCount.height;
        }

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Returns the minimum size: the maximum child minimum size multiplied by the computed row/column counts.
     *
     * @returns The minimum `{width, height}`, or `null` if no container is attached.
     */
    getMinSize() {
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

        if (colRowCount) {
            innerWidth = innerWidth * colRowCount.width;
            innerHeight = innerHeight * colRowCount.height;
        }

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Returns the maximum size: the minimum child maximum size multiplied by the computed row/column counts.
     *
     * @returns The maximum `{width, height}`, or `null` if no container is attached.
     */
    getMaxSize() {
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

        if (colRowCount) {
            innerWidth = innerWidth * colRowCount.width;
            innerHeight = innerHeight * colRowCount.height;
        }

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Tiles all children in a grid of equal-sized cells, left-to-right then top-to-bottom.
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

        let columnWidth = containerSize.width;
        let columnHeight = containerSize.height;

        let colRowCount = this.getColRowCount();

        if (colRowCount) {
            columnWidth /= colRowCount.width;
            columnHeight /= colRowCount.height;
        }

        let colCount = colRowCount ? colRowCount.width : 1;

        //let rowIdx = 0;
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

            if (colIdx >= colCount) {
                //rowIdx += 1;
                colIdx = 0;

                x = containerInsets.getLeft();
                y += columnHeight;
            } else {
                x += columnWidth;
            }
        }
    }
}
