// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../Component.js";
import { LayoutConstraints } from "../../layout/LayoutConstraints.js";
import { Table as TableLayout } from "../../layout/Table.js";
import { Header } from "./Header.js";
import { Body } from "./Body.js";
import { FooterRow } from "./Footer.js";
import { AbstractStore } from "../../data/AbstractStore.js";
import { Field } from "../../data/Field.js";
import { ModelRecord } from "../../data/ModelRecord.js";
import { BorderStyle } from "../../BorderStyle.js";
import { Insets } from "../../Insets.js";
import { ContextMenu } from "../../ContextMenu.js";
import { Column } from "./Column.js";
import { ColumnSpec } from "./ColumnConfig.js";

/**
 * A data-bound table component rendered as an HTML `<table>` element.
 *
 * Composes a {@link Header}, a virtual-scrolling {@link Body}, and an optional
 * {@link FooterRow}. Exposes CRUD and sync operations that delegate to the underlying
 * {@link AbstractStore}.
 *
 * An optional {@link ColumnSpec} controls which columns appear, their display
 * constraints (`minWidth`, `maxWidth`), and initial visibility. When no spec is
 * supplied the table auto-generates one column per model field — identical to the
 * pre-spec behaviour.
 */
export class Table extends Component {

    private store: AbstractStore;
    private spec: ColumnSpec | undefined;
    private resolvedColumns: Column[] = [];
    private hiddenColumns: Set<string> = new Set();
    private columnContextMenu: ContextMenu = new ContextMenu();
    private headerVisible: boolean;
    private header: Header;
    private body: Body;
    private bodyVisible: boolean;
    private footer: FooterRow;
    private footerVisible: boolean;
    private columnWidths: number[] = [];
    private savedColumnWidths: Map<string, number> = new Map();

    /**
     * Constructs a Table bound to the given store, optionally constrained by a
     * column presentation spec.
     *
     * @param store - The data store to bind to this table.
     * @param spec  - Optional column spec; omit to auto-generate all columns.
     */
    constructor(store: AbstractStore, spec?: ColumnSpec) {
        super("table");

        this.setLayoutManager(new TableLayout());
        this.setBorder({ style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-border-color, black)" });
        this.setInsets(new Insets(0, 0, 0, 0));

        this.store = store;
        this.spec = spec;
        this.headerVisible = true;
        this.bodyVisible = true;
        this.footerVisible = false;

        this.resolvedColumns = Column.resolve(store.model.getFields(), spec);
        this.initHiddenFromSpec();

        this.header = new Header(store.model, store);
        this.header.setOnColumnResize((i, d) => this.onColumnResize(i, d));
        this.header.setOnColumnContextMenu((_, x, y) => this.showColumnMenu(x, y));
        this.addComponent(this.header);

        this.body = new Body(store);
        this.addComponent(this.body);

        this.footer = new FooterRow();
        this.addComponent(this.footer);

        const effectiveHidden = this.getEffectiveHiddenSet();

        if (effectiveHidden.size > 0) {
            this.header.setHiddenColumns(effectiveHidden);
            this.body.setHiddenColumns(effectiveHidden);
        }
    }

    /**
     * Returns the resolved, visible columns in display order.
     *
     * Excludes columns that are currently hidden (via runtime toggle or the spec's
     * `hidden` flag) and columns excluded by a strict spec (`appendUnlisted: false`).
     *
     * @returns Visible {@link Column} instances in field display order.
     */
    getColumns(): Column[] {
        const effective = this.getEffectiveHiddenSet();

        return this.resolvedColumns.filter(c => !effective.has(c.getField().getName()));
    }

    /**
     * Returns the data store this table is bound to.
     *
     * @returns The current {@link AbstractStore}.
     */
    getStore(): AbstractStore {
        return this.store;
    }

    /**
     * Returns the model associated with this table's store.
     *
     * @returns The model from the store.
     */
    getModel() {
        return this.store.model;
    }

    /**
     * Replaces the data store, re-resolves columns from the new model, and updates
     * the body and header to reflect the change.
     *
     * @param store - The new store to bind to the table.
     */
    setStore(store: AbstractStore): void {
        this.store = store;
        this.columnWidths = [];
        this.savedColumnWidths = new Map();
        this.resolvedColumns = Column.resolve(store.model.getFields(), this.spec);

        this.body.setStore(store);
        this.header.setModel(store.model);
        this.header.setHiddenColumns(this.getEffectiveHiddenSet());
    }

    /**
     * Returns the per-column width array maintained by the layout manager.
     *
     * @returns The current column widths in pixels.
     */
    getColumnWidths(): number[] {
        return this.columnWidths;
    }

    /**
     * Stores the per-column width array (called by the layout manager on each layout pass).
     *
     * @param widths - The new column widths in pixels.
     * @remarks Also mirrors each width into `savedColumnWidths` keyed by field name so
     * that show/hide toggles can restore per-column widths without a full re-initialisation.
     */
    setColumnWidths(widths: number[]): void {
        this.columnWidths = widths;

        const visibleColumns = this.getColumns();

        widths.forEach((w, i) => {
            const col = visibleColumns[i];

            if (col) {
                this.savedColumnWidths.set(col.getField().getName(), w);
            }
        });
    }

    /**
     * Shows or hides the column identified by the given field name.
     *
     * Only columns present in the resolved column list can be toggled; columns
     * excluded by a strict spec (`appendUnlisted: false`) are unaffected.
     *
     * Manually resized widths are preserved across visibility toggles. When showing
     * a column introduces extra width that would overflow the container, existing
     * columns are proportionally trimmed via `trimToTarget` to make room before
     * the layout manager runs.
     *
     * @param fieldName - The model field name of the column to toggle.
     * @param visible   - `true` to show the column, `false` to hide it.
     */
    setColumnVisible(fieldName: string, visible: boolean): void {
        if (visible) {
            this.hiddenColumns.delete(fieldName);
        } else {
            this.hiddenColumns.add(fieldName);
        }

        const newVisibleColumns = this.getColumns();
        const rawWidths = newVisibleColumns.map(col =>
            this.savedColumnWidths.get(col.getField().getName()) ?? this.defaultColumnWidth(col)
        );
        const savedTotal = this.columnWidths.reduce((s, w) => s + w, 0);
        const rawTotal   = rawWidths.reduce((s, w) => s + w, 0);

        this.columnWidths = (rawTotal > savedTotal + 0.5 && savedTotal > 0)
            ? this.trimToTarget(newVisibleColumns, rawWidths, savedTotal, fieldName)
            : rawWidths;

        const effectiveHidden = this.getEffectiveHiddenSet();

        this.header.setHiddenColumns(effectiveHidden);
        this.body.setHiddenColumns(effectiveHidden);
        this.doLayout();
    }

    /**
     * Returns the table header component.
     *
     * @returns The {@link Header} section of this table.
     */
    getHeader() {
        return this.header;
    }

    /**
     * Returns whether the header section is visible.
     *
     * @returns `true` if the header is visible.
     */
    isHeaderVisible() {
        return this.headerVisible;
    }

    /**
     * Returns the table body component.
     *
     * @returns The virtual-scrolling {@link Body} section of this table.
     */
    getBody() {
        return this.body;
    }

    /**
     * Returns whether the body section is visible.
     *
     * @returns `true` if the body is visible.
     */
    isBodyVisible() {
        return this.bodyVisible;
    }

    /**
     * Returns the table footer component.
     *
     * @returns The {@link FooterRow} section of this table.
     */
    getFooter() {
        return this.footer;
    }

    /**
     * Returns whether the footer section is visible.
     *
     * @returns `true` if the footer is visible.
     */
    isFooterVisible() {
        return this.footerVisible;
    }

    /**
     * Adds a new record to the store, scrolls to it, and selects it.
     *
     * @param defaults - Optional initial field values for the new record.
     * 
     * @returns The newly created {@link ModelRecord}.
     */
    addRow(defaults: Record<string, any> = {}): ModelRecord {
        const [record] = this.store.add(defaults);
        this.body.scrollToRecord(record);
        this.body.selectRecord(record);

        return record;
    }

    /**
     * Removes the currently selected record from the store.
     */
    removeSelectedRow(): void {
        const record = this.body.getSelectedRecord();

        if (!record) {
            return;
        }

        this.body.selectRecord(null);
        this.store.remove(record);
    }

    /**
     * Persists all pending store changes to the server via the configured proxy.
     *
     * @returns A Promise that resolves when the sync operation completes.
     */
    async sync(): Promise<void> {
        return this.store.sync();
    }

    /**
     * Returns the currently selected record, or null if none is selected.
     *
     * @returns The selected {@link ModelRecord}, or null.
     */
    getSelectedRecord(): ModelRecord | null {
        return this.body.getSelectedRecord();
    }

    /**
     * Returns all currently selected records.
     *
     * @returns An array of selected {@link ModelRecord} instances.
     */
    getSelectedRecords(): ModelRecord[] {
        return this.body.getSelectedRecords();
    }

    /**
     * Adds a header, body, or footer section component, updating the stored reference.
     *
     * @param row         - The section component to add.
     * @param constraints - Optional layout constraints for the section.
     */
    addComponent(row: Header | Body | FooterRow, constraints?: LayoutConstraints) {
        if (row instanceof Header) {
            this.header = row;
        } else if (row instanceof Body) {
            this.body = row;
        } else if (row instanceof FooterRow) {
            this.footer = row;
        }

        super.addComponent(row, constraints);
    }

    /**
     * Returns a type-based default width for a column that has no saved width yet.
     *
     * @param col - The column to compute a default width for.
     * @returns A positive pixel width appropriate for the column's field type.
     */
    private defaultColumnWidth(col: Column): number {
        const f = col.getField();
        const headerMin = f.getDescription().length * 8 + 16;

        switch (f.getType()) {
            case 'boolean': return Math.max(60,  headerMin);
            case 'number':  return Math.max(90,  headerMin);
            case 'date':    return Math.max(110, headerMin);
            default:        return Math.max(100, headerMin);
        }
    }

    /**
     * Proportionally reduces existing saved columns to bring the total down to `targetTotal`,
     * leaving `exemptField` and any unsaved columns at their assigned widths.
     *
     * Flex (string/auto) columns are reduced first so that `rescaleWidths` can restore them
     * automatically when the shown column is later hidden again. Fixed-type (boolean/number/date)
     * columns are only reduced if flex space is fully exhausted.
     *
     * @param columns     - The full new visible column list.
     * @param widths      - Raw width per column (saved or default).
     * @param targetTotal - The pixel budget the result must not exceed.
     * @param exemptField - Field name of the column being shown; never trimmed.
     * 
     * @returns Adjusted width array whose sum is at most `targetTotal`.
     */
    private trimToTarget(columns: Column[], widths: number[], targetTotal: number, exemptField: string): number[] {
        const result = [...widths];

        const isFixedType = (col: Column): boolean => {
            const t = col.getField().getType();

            return t === 'boolean' || t === 'number' || t === 'date';
        };

        const trim = (pool: { i: number; room: number }[], deficit: number): number => {
            const totalRoom = pool.reduce((s, c) => s + c.room, 0);

            if (totalRoom <= 0) {
                return deficit;
            }

            const toRemove = Math.min(deficit, totalRoom);

            for (const { i, room } of pool) {
                result[i] = Math.max(result[i] - (room / totalRoom) * toRemove, columns[i].getMinWidth() ?? 30);
            }

            return deficit - toRemove;
        };

        const pool = (fixedType: boolean) => columns
            .map((col, i) => ({
                i,
                room: (isFixedType(col) === fixedType
                    && col.getField().getName() !== exemptField
                    && this.savedColumnWidths.has(col.getField().getName()))
                    ? result[i] - (col.getMinWidth() ?? 30)
                    : 0
            }))
            .filter(c => c.room > 0.5);

        let deficit = result.reduce((s, w) => s + w, 0) - targetTotal;

        deficit = trim(pool(false), deficit);

        if (deficit > 0.5) {
            trim(pool(true), deficit);
        }

        return result;
    }

    /**
     * Populates `hiddenColumns` from columns declared `hidden: true` in the spec,
     * so they start hidden but remain user-toggleable via the context menu.
     */
    private initHiddenFromSpec(): void {
        for (const col of this.resolvedColumns) {
            if (col.isInitiallyHidden()) {
                this.hiddenColumns.add(col.getField().getName());
            }
        }
    }

    /**
     * Returns the union of runtime-hidden columns and columns excluded by the spec
     * (`appendUnlisted: false`). This is the set passed to the header and body renderers.
     *
     * @returns The effective set of field names that must not be rendered.
     */
    private getEffectiveHiddenSet(): Set<string> {
        const resolvedNames = new Set(this.resolvedColumns.map(c => c.getField().getName()));
        const result = new Set(this.hiddenColumns);

        for (const f of this.store.model.getFields()) {
            if (!resolvedNames.has(f.getName())) {
                result.add(f.getName());
            }
        }

        return result;
    }

    /**
     * Displays the column visibility context menu, listing only columns present in
     * the resolved column list (excluded columns do not appear).
     *
     * @param x - Viewport x coordinate for the menu.
     * @param y - Viewport y coordinate for the menu.
     */
    private showColumnMenu(x: number, y: number): void {
        const columns = this.resolvedColumns
            .slice()
            .sort((a, b) => a.getField().getOrder() - b.getField().getOrder());

        const items = columns.map(col => {
            const fieldName = col.getField().getName();
            const visible = !this.hiddenColumns.has(fieldName);

            return {
                text: (visible ? '✓ ' : '  ') + col.getField().getDescription(),
                action: () => this.setColumnVisible(fieldName, !visible)
            };
        });

        this.columnContextMenu.show(x, y, items);
    }

    /**
     * Handles a column resize drag, clamping the adjacent column pair to their
     * per-column `minWidth` and `maxWidth` constraints.
     *
     * @param colIndex - Zero-based index of the column whose right edge is being dragged.
     * @param delta    - Pixel delta: positive moves the edge right, negative moves it left.
     */
    private onColumnResize(colIndex: number, delta: number): void {
        const n = this.columnWidths.length;

        if (n === 0 || colIndex >= n - 1) {
            return;
        }

        const columns = this.getColumns();
        const min0 = columns[colIndex]?.getMinWidth()     ?? 30;
        const max0 = columns[colIndex]?.getMaxWidth()     ?? Infinity;
        const min1 = columns[colIndex + 1]?.getMinWidth() ?? 30;
        const max1 = columns[colIndex + 1]?.getMaxWidth() ?? Infinity;

        let w0 = this.columnWidths[colIndex]     + delta;
        let w1 = this.columnWidths[colIndex + 1] - delta;

        if (w0 < min0) {
            w1 += w0 - min0;
            w0 = min0;
        }

        if (w1 < min1) {
            w0 += w1 - min1;
            w1 = min1;
        }

        if (w0 < min0 || w1 < min1 || w0 > max0 || w1 > max1) {
            return;
        }

        this.columnWidths[colIndex]     = w0;
        this.columnWidths[colIndex + 1] = w1;

        this.doLayout();
    }
}
