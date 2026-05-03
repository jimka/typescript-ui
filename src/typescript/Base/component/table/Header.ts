// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../Component.js";
import { Row } from "./Row.js";
import { AbstractModel } from "../../data/AbstractModel.js";
import { AbstractStore } from "../../data/AbstractStore.js";
import { Field } from "../../data/Field.js";
import { HeaderCell } from "./cell/Header.js";
import { BorderStyle } from "../../BorderStyle.js";

/**
 * The header section of a table, rendered as a `<thead>` element.
 *
 * Builds one {@link HeaderCell} per visible field from the supplied model. Each cell is
 * wired with a sort-click callback (cycles asc → desc → clear), a resize-drag
 * callback (forwarded to the owner via {@link setOnColumnResize}), and a context-menu
 * callback (forwarded via {@link setOnColumnContextMenu}).
 */
export class Header extends Component {

    private model: AbstractModel;
    private store: AbstractStore;
    private hiddenColumns: Set<string> = new Set();
    private onResizeCallback: ((colIndex: number, delta: number) => void) | null = null;
    private onColumnContextMenuCallback: ((fieldName: string, x: number, y: number) => void) | null = null;

    constructor(model: AbstractModel, store: AbstractStore) {
        super("thead");

        this.setBorder({ bottom: { style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-table-header-border, black)" } });
        this.setBackgroundImage("var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))");

        this.model = model;
        this.store = store;

        const row = new Row();
        this.addRow(row);

        this.rebuildCells();
    }

    /**
     * Returns the model driving this header's columns.
     *
     * @returns The {@link AbstractModel} currently bound to this header.
     */
    getModel() {
        return this.model;
    }

    /**
     * Replaces the model, rebuilding header cells only when the visible field list changes.
     *
     * @param model - The new model to bind to the header.
     *
     * @remarks If the new model has the same visible fields in the same order as the current
     * model, the existing cells are left in place and sort indicators are re-synced.
     */
    setModel(model: AbstractModel): void {
        const toNames = (model: AbstractModel) =>
            model.getFields()
                 .slice()
                 .filter(f => !this.hiddenColumns.has(f.getName()))
                 .sort((a, b) => a.getOrder() - b.getOrder())
                 .map(f => f.getName());

        const oldNames = toNames(this.model);
        const newNames = toNames(model);

        const same = oldNames.length === newNames.length
                     && oldNames.every((n, i) => n === newNames[i]);

        if (!same) {
            this.model = model;
            this.rebuildCells();
        }

        this.syncSortIndicators();
    }

    /**
     * Updates the set of hidden column field names and rebuilds header cells immediately.
     *
     * @param hidden - The new set of field names to hide.
     */
    setHiddenColumns(hidden: Set<string>): void {
        this.hiddenColumns = new Set(hidden);

        this.rebuildCells();
    }

    /**
     * Registers the callback invoked when the user drags a column resize handle.
     *
     * @param fn - Receives the zero-based column index and the pixel delta.
     */
    setOnColumnResize(fn: (colIndex: number, delta: number) => void): void {
        this.onResizeCallback = fn;
    }

    /**
     * Registers the callback invoked when the user right-clicks a header cell.
     *
     * @param fn - Receives the field name, and viewport x/y coordinates.
     */
    setOnColumnContextMenu(fn: (fieldName: string, x: number, y: number) => void): void {
        this.onColumnContextMenuCallback = fn;
    }

    /**
     * Returns the header cell components in column order.
     *
     * @returns An array of cell components from the header's inner row.
     */
    getColumns() {
        return this.getComponents()[0].getComponents();
    }

    /**
     * Reorders header cells by field order using their layout constraints.
     */
    sortColumns() {
        const row = this.getComponents()[0];

        row.sortComponents((c1, c2) => {
            const lc1 = row.getLayoutConstraints(c1);
            const lc2 = row.getLayoutConstraints(c2);

            if (!lc1) {
                return -1;
            }

            if (!lc2) {
                return 1;
            }

            return (lc1.data as Field).getOrder() - (lc2.data as Field).getOrder();
        });
    }

    /**
     * Appends a row to the header.
     *
     * @param row - The row to append.
     */
    addRow(row: Row) {
        this.addComponent(row);
    }

    /**
     * Adds a row as a child component of the header.
     *
     * @param row - The row component to add.
     */
    addComponent(row: Row) {
        super.addComponent(row);
    }

    /**
     * Sets the header width and propagates it to the inner row.
     *
     * @param width - The width in pixels.
     */
    setWidth(width: number) {
        super.setWidth(width);

        this.getComponents()[0].setWidth(width);
    }

    /**
     * Sets the header height and propagates it to the inner row.
     *
     * @param height - The height in pixels.
     */
    setHeight(height: number) {
        super.setHeight(height);

        this.getComponents()[0].setHeight(height);
    }

    /**
     * Removes all existing header cells and recreates them from the visible fields of
     * the current model, then re-syncs sort indicators.
     */
    private rebuildCells(): void {
        const row = this.getComponents()[0] as Row;

        row.removeAllComponents();

        const fields = this.model.getFields()
                                 .slice()
                                 .filter(f => !this.hiddenColumns.has(f.getName()))
                                 .sort((a, b) => a.getOrder() - b.getOrder());

        for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            const cell = new HeaderCell(field.getDescription(), field.getName());

            row.addComponent(cell, { data: field });
            this.wireCell(cell, i);
        }

        this.syncSortIndicators();
    }

    private wireCell(cell: HeaderCell, idx: number): void {
        cell.setOnSortClick((fieldName) => this.handleSortClick(fieldName));
        cell.setOnResizeDrag((delta) => this.onResizeCallback?.(idx, delta));
        cell.setOnContextMenu((fieldName, x, y) => this.onColumnContextMenuCallback?.(fieldName, x, y));
    }

    private handleSortClick(fieldName: string): void {
        const sorter = this.store.getActiveSorter();
        const cells = this.getColumns() as HeaderCell[];

        let newDir: 'asc' | 'desc' | null;

        if (!sorter || sorter.property !== fieldName) {
            newDir = 'asc';
        } else if (sorter.direction === 'asc') {
            newDir = 'desc';
        } else {
            newDir = null;
        }

        cells.forEach(c => c.setSortState(null));

        if (newDir !== null) {
            const visibleFields = this.model.getFields()
                                            .slice()
                                            .filter(f => !this.hiddenColumns.has(f.getName()))
                                            .sort((a, b) => a.getOrder() - b.getOrder());

            const idx = visibleFields.findIndex(f => f.getName() === fieldName);

            if (idx !== -1) {
                cells[idx].setSortState(newDir);
            }

            this.store.sort(fieldName, newDir);
        } else {
            this.store.clearSort();
        }
    }

    private syncSortIndicators(): void {
        const sorter = this.store.getActiveSorter();

        if (!sorter) {
            return;
        }

        const visibleFields = this.model.getFields()
                                        .slice()
                                        .filter(f => !this.hiddenColumns.has(f.getName()))
                                        .sort((a, b) => a.getOrder() - b.getOrder());

        const idx = visibleFields.findIndex(f => f.getName() === sorter.property);

        if (idx === -1) {
            return;
        }

        const cells = this.getColumns() as HeaderCell[];

        cells[idx]?.setSortState(sorter.direction);
    }
}
