// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager } from "./LayoutManager.js";
import { Table as TableComponent } from "../component/table/Table.js";
import { Column } from "../component/table/Column.js";
import { Component } from "../Component.js";
import { Util } from "../Util.js";

const BOOLEAN_WIDTH = 60;
const NUMBER_WIDTH  = 90;
const DATE_WIDTH    = 110;
const CHAR_WIDTH    = 8;
const HEADER_PAD    = 16;

/**
 * A layout manager dedicated to the `Table` component.
 * Positions the header, body, and footer sections within the container and
 * triggers virtual-scroll rendering on the body after each layout pass.
 *
 * Per-column widths are stored on the `Table` component. On first render (or after
 * a model swap) widths are initialized based on field type and any `minWidth` /
 * `maxWidth` declared in the column spec: compact types (`boolean`, `number`, `date`)
 * receive a fixed base width floored at the header text width; string and auto columns
 * share the remaining space equally, clamped to their constraints. On container resize
 * compact-type columns keep their width unchanged; only flexible columns scale
 * proportionally, again clamped to their per-column constraints.
 */
export class Table extends LayoutManager {

    /**
     * Constructs a Table layout manager.
     */
    constructor() {
        super();
    }

    /**
     * Attaches to a container, throwing if it is not a `Table` component.
     *
     * @param container - The container component to attach to.
     *
     * @remarks This layout manager is only valid for containers whose class name is `"Table"`.
     */
    attach(container: Component) {
        if (container.getClassName() != "Table") {
            throw new Error("Container must be a Table.");
        }

        super.attach(container);
    }

    /**
     * Positions the header, body, and footer sections and triggers body virtual scroll rendering.
     *
     * @remarks Per-column widths are read from the Table component. If the stored widths do not
     * match the current column count (first render or model swap) they are re-initialized using
     * type-aware sizing clamped to each column's `minWidth` / `maxWidth`. On a container resize
     * the existing widths are scaled proportionally, again clamped to per-column constraints.
     */
    doLayout() {
        const container = <TableComponent>this.getContainer();

        if (!container) {
            return;
        }

        const containerSize = container.getInnerSize();

        if (!containerSize) {
            return;
        }

        const containerInsets = container.getInsets();
        const columns         = container.getColumns();
        const columnCount     = container.getHeader().getColumns().length;
        const availableWidth  = containerSize.width - Util.getScrollBarWidth();

        let columnWidths = container.getColumnWidths();

        if (columnWidths.length !== columnCount) {
            columnWidths = this.initializeWidths(columns, availableWidth);
            container.setColumnWidths(columnWidths);
        } else {
            columnWidths = this.rescaleWidths(columns, columnWidths, availableWidth);
            container.setColumnWidths(columnWidths);
        }

        const header = container.getHeader();
        const body   = container.getBody();
        const footer = container.getFooter();

        if (container.isHeaderVisible() && header) {
            const columnHeight = 20;

            header.setAutoCommitStyle(false);
            header.setX(containerInsets.getLeft());
            header.setY(containerInsets.getTop());
            header.setWidth(containerSize.width);
            header.setHeight(columnHeight);
            header.setAutoCommitStyle(true);

            const headerColumns = header.getColumns();
            let x = 0;

            headerColumns.forEach((col, i) => {
                col.setAutoCommitStyle(false);
                col.setX(x);
                col.setY(0);
                col.setWidth(columnWidths[i]);
                col.setHeight(columnHeight);
                col.setAutoCommitStyle(true);
                col.doLayout();

                x += columnWidths[i];
            });
        }

        if (container.isFooterVisible() && footer) {
            const columnHeight  = 20;
            const footerColumns = footer.getColumns();

            footer.setAutoCommitStyle(false);
            footer.setX(containerInsets.getLeft());
            footer.setY(containerInsets.getTop() + containerSize.height - columnHeight);
            footer.setWidth(containerSize.width);
            footer.setHeight(columnHeight);
            footer.setAutoCommitStyle(true);

            let x = 0;

            footerColumns.forEach((col, i) => {
                col.setAutoCommitStyle(false);
                col.setX(x);
                col.setY(0);
                col.setWidth(columnWidths[i]);
                col.setHeight(columnHeight);
                col.setAutoCommitStyle(true);
                col.doLayout();

                x += columnWidths[i];
            });
        }

        if (container.isBodyVisible() && body) {
            const headerHeight = container.isHeaderVisible() && header ? header.getHeight() : 0;
            const footerHeight = container.isFooterVisible() && footer ? footer.getHeight() : 0;

            body.setAutoCommitStyle(false);
            body.setX(containerInsets.getLeft());
            body.setY(containerInsets.getTop() + headerHeight);
            body.setWidth(containerSize.width);
            body.setHeight(containerSize.height - headerHeight - footerHeight);
            body.setAutoCommitStyle(true);

            body.renderWindow(availableWidth, columnWidths);
        }
    }

    /**
     * Computes initial column widths from field types and column constraints.
     *
     * Fixed-type columns (boolean, number, date) get a type-based base width floored
     * at their header text width and clamped to any declared min/max. Flexible columns
     * (string, auto) share the remaining space equally, each clamped to its own min/max.
     *
     * @param columns        - The visible resolved columns.
     * @param availableWidth - Total available pixel width for columns.
     * @returns The computed width for each column.
     */
    private initializeWidths(columns: Column[], availableWidth: number): number[] {
        const intrinsic: (number | null)[] = columns.map(col => {
            const f         = col.getField();
            const headerMin = f.getDescription().length * CHAR_WIDTH + HEADER_PAD;

            switch (f.getType()) {
                case 'boolean': return this.clamp(Math.max(BOOLEAN_WIDTH, headerMin), col);
                case 'number':  return this.clamp(Math.max(NUMBER_WIDTH,  headerMin), col);
                case 'date':    return this.clamp(Math.max(DATE_WIDTH,    headerMin), col);
                default:        return null;
            }
        });

        const fixedTotal = intrinsic.reduce((s: number, w) => s + (w ?? 0), 0);
        const flexCount  = intrinsic.filter(w => w === null).length;
        const rawFlex    = flexCount > 0
            ? (availableWidth - fixedTotal) / flexCount
            : 0;

        return intrinsic.map((w, i) => {
            if (w !== null) {
                return w;
            }

            const col = columns[i];
            const min = col.getMinWidth() ?? 30;
            const max = col.getMaxWidth() ?? Infinity;

            return Math.min(Math.max(rawFlex, min), max);
        });
    }

    /**
     * Rescales existing flexible column widths to fit the new available width,
     * keeping fixed-type columns at their current size and clamping all columns
     * to their per-column constraints.
     *
     * @param columns        - The visible resolved columns.
     * @param columnWidths   - The existing width array from the previous layout.
     * @param availableWidth - Total available pixel width for columns.
     * @returns The updated width array, or the original if no rescaling was needed.
     */
    private rescaleWidths(columns: Column[], columnWidths: number[], availableWidth: number): number[] {
        const isFixed = columns.map(col => {
            const t = col.getField().getType();

            return t === 'boolean' || t === 'number' || t === 'date';
        });

        const fixedTotal    = columnWidths.reduce((s: number, w, i) => s + (isFixed[i] ? w : 0), 0);
        const prevFlexTotal = columnWidths.reduce((s: number, w, i) => s + (isFixed[i] ? 0 : w), 0);
        const newFlexTotal  = availableWidth - fixedTotal;

        if (prevFlexTotal <= 0 || Math.abs(prevFlexTotal - newFlexTotal) <= 0.5) {
            return columnWidths;
        }

        const ratio = newFlexTotal / prevFlexTotal;

        return columnWidths.map((w, i) => {
            if (isFixed[i]) {
                return w;
            }

            return this.clamp(w * ratio, columns[i]);
        });
    }

    /**
     * Clamps a width value to the `[minWidth, maxWidth]` range declared on a column,
     * using 30 px as the default minimum and no upper bound when unconstrained.
     *
     * @param width  - The raw width to clamp.
     * @param column - The column whose constraints apply.
     * @returns The clamped width.
     */
    private clamp(width: number, column: Column): number {
        const min = column.getMinWidth() ?? 30;
        const max = column.getMaxWidth() ?? Infinity;

        return Math.min(Math.max(width, min), max);
    }
}
