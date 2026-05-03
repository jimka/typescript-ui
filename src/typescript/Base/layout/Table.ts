// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager } from "./LayoutManager.js";
import { Table as TableComponent } from "../component/table/Table.js";
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
 * a model swap) widths are initialized based on field type: compact types (`boolean`,
 * `number`, `date`) receive a fixed base width floored at the header text width; string
 * and auto columns share the remaining space equally. On container resize compact-type
 * columns keep their width unchanged; only flexible columns scale proportionally.
 */
export class Table extends LayoutManager {

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
     * type-aware sizing. On a container resize the existing widths are scaled proportionally.
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
        const columnCount = container.getHeader().getColumns().length;
        const availableWidth = containerSize.width - Util.getScrollBarWidth();

        let columnWidths = container.getColumnWidths();

        if (columnWidths.length !== columnCount) {
            const fields = container.getVisibleFields();

            const intrinsic: (number | null)[] = fields.map(f => {
                const headerMin = f.getDescription().length * CHAR_WIDTH + HEADER_PAD;

                switch (f.getType()) {
                    case 'boolean': return Math.max(BOOLEAN_WIDTH, headerMin);
                    case 'number':  return Math.max(NUMBER_WIDTH,  headerMin);
                    case 'date':    return Math.max(DATE_WIDTH,    headerMin);
                    default:        return null;
                }
            });

            const fixedTotal = intrinsic.reduce((s: number, w) => s + (w ?? 0), 0);
            const flexCount  = intrinsic.filter(w => w === null).length;
            const flexWidth  = flexCount > 0
                ? Math.max(30, (availableWidth - fixedTotal) / flexCount)
                : 0;

            columnWidths = intrinsic.map(w => w ?? flexWidth);
            container.setColumnWidths(columnWidths);
        } else {
            // Container resize: fixed-type columns keep their width; flexible columns scale proportionally.
            const fields = container.getVisibleFields();
            const isFixed = fields.map(f => {
                const t = f.getType();

                return t === 'boolean' || t === 'number' || t === 'date';
            });

            const fixedTotal    = columnWidths.reduce((s: number, w, i) => s + (isFixed[i] ? w : 0), 0);
            const prevFlexTotal = columnWidths.reduce((s: number, w, i) => s + (isFixed[i] ? 0 : w), 0);
            const newFlexTotal  = availableWidth - fixedTotal;

            if (prevFlexTotal > 0 && Math.abs(prevFlexTotal - newFlexTotal) > 0.5) {
                const ratio = newFlexTotal / prevFlexTotal;
                columnWidths = columnWidths.map((w, i) => isFixed[i] ? w : Math.max(30, w * ratio));

                container.setColumnWidths(columnWidths);
            }
        }

        const header = container.getHeader();
        const body = container.getBody();
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
            const columnHeight = 20;
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
}
