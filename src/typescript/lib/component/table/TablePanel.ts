// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { AbstractStore } from "~/data/AbstractStore.js";
import { Border } from "~/layout/Border.js";
import { HBox } from "~/layout/HBox.js";
import { Container } from "~/core/Container.js";
import { Placement } from "~/primitive/Placement.js";
import { Button } from "~/component/button/Button.js";
import { PaginationBar } from "~/component/display/PaginationBar.js";
import { ProgressSpinner } from "~/component/display/ProgressSpinner.js";
import { Table } from "~/component/table/Table.js";
import { ExportOptions } from "~/component/table/TableExporter.js";
import { Tooltip } from "~/core/Tooltip.js";
import { callable } from "~/core/Callable.js";
import { Glyph } from "~/component/display/Glyph.js";
import { plus }          from "~/glyphs/solid/plus.js";
import { minus }         from "~/glyphs/solid/minus.js";
import { arrows_rotate } from "~/glyphs/solid/arrows_rotate.js";
import { ban }           from "~/glyphs/solid/ban.js";

Glyph.register(plus, minus, arrows_rotate, ban);

/**
 * A composite panel that combines a {@link Table} with an add/remove/sync toolbar.
 *
 * The toolbar is docked to the north region; the table fills the center region.
 *
 * @category Components
 */
class TablePanel extends Container {

    private _table: Table;
    private _toolbar: Component;
    private _syncBtn: Button;
    private _rejectBtn: Button;
    private _spinner: ProgressSpinner | null = null;
    private _paginationBar: PaginationBar | undefined = undefined;

    constructor(store: AbstractStore) {
        super();

        this.setLayoutManager(new Border());

        this._toolbar = new Component();
        this._toolbar.setLayoutManager(new HBox());

        const addBtn = new Button({ glyph: "plus" });
        addBtn.setPreferredSize(28, 28);
        addBtn.on("action", () => this._table.addRow());
        Tooltip.attach(addBtn, "Add row");
        this._toolbar.addComponent(addBtn);

        const removeBtn = new Button({ glyph: "minus" });
        removeBtn.setPreferredSize(28, 28);
        removeBtn.on("action", () => this._table.removeSelectedRow());
        Tooltip.attach(removeBtn, "Remove selected row");
        this._toolbar.addComponent(removeBtn);

        this._syncBtn = new Button({ glyph: "arrows-rotate" });
        this._syncBtn.setPreferredSize(28, 28);
        this._syncBtn.on("action", () => this._table.sync());
        Tooltip.attach(this._syncBtn, "Sync pending changes");
        this._toolbar.addComponent(this._syncBtn);

        this._rejectBtn = new Button({ glyph: "ban" });
        this._rejectBtn.setPreferredSize(28, 28);
        this._rejectBtn.on("action", () => this._table.reject());
        Tooltip.attach(this._rejectBtn, "Reject pending changes");
        this._toolbar.addComponent(this._rejectBtn);

        this._table = new Table(store);

        super.addComponent(this._toolbar, { placement: Placement.NORTH });
        super.addComponent(this._table,   { placement: Placement.CENTER });

        store.on('loadingchanged', (payload: { loading: boolean }) => {
            if (!this._spinner) {
                this._spinner = new ProgressSpinner(24);
            }

            if (payload.loading) {
                this._spinner.showOverlay(this._table);
            } else {
                this._spinner.hideOverlay();
            }
        });

        const refreshSyncButtons = (): void => this.refreshSyncButtons();
        store.on('add', refreshSyncButtons);
        store.on('remove', refreshSyncButtons);
        store.on('datachanged', refreshSyncButtons);
        store.on('sync', refreshSyncButtons);
        store.on('load', refreshSyncButtons);

        this.refreshSyncButtons();
    }

    /**
     * Updates the Sync and Reject button-enabled state to reflect whether the
     * store has any unsynced changes. Both buttons disable when there is
     * nothing to sync or reject.
     */
    private refreshSyncButtons(): void {
        const hasChanges = this._table.getStore().hasPendingChanges();

        this._syncBtn.setEnabled(hasChanges);
        this._rejectBtn.setEnabled(hasChanges);
    }

    /**
     * Returns the Table component managed by this panel.
     *
     * @returns The managed {@link Table} instance.
     */
    getTable(): Table {
        return this._table;
    }

    /**
     * Returns the toolbar component containing the add/remove/sync buttons.
     *
     * @returns The toolbar {@link Component}.
     */
    getToolbar(): Component {
        return this._toolbar;
    }

    /**
     * Enables or disables the "Export as CSV" / "Export as JSON" entries in
     * the underlying table's column context menu.
     *
     * @param enabled - When true the export items are appended to the menu.
     */
    setExportMenuEnabled(enabled: boolean): this {
        this._table.setExportMenuEnabled(enabled);

        return this;
    }

    /**
     * Triggers a CSV download of the current store view.
     *
     * @param options - Optional export options (e.g. include hidden columns, custom filename).
     */
    exportCSV(options?: ExportOptions): void {
        this._table.exportCSV(options);
    }

    /**
     * Triggers a JSON download of the current store view.
     *
     * @param options - Optional export options (e.g. include hidden columns, custom filename).
     */
    exportJSON(options?: ExportOptions): void {
        this._table.exportJSON(options);
    }

    /**
     * Docks a {@link PaginationBar} to the south region of the panel.
     *
     * @param bar - The pagination bar to attach. Replaces any previously attached bar.
     *
     * @remarks
     * Any previously attached bar is removed and disposed before the new one
     * is installed, so its store listeners do not leak.
     */
    setPaginationBar(bar: PaginationBar): this {
        if (this._paginationBar) {
            this.removeComponent(this._paginationBar);
            this._paginationBar.dispose();
        }

        this._paginationBar = bar;
        super.addComponent(bar, { placement: Placement.SOUTH });

        return this;
    }

    /**
     * Returns the currently attached pagination bar, or undefined if none is set.
     *
     * @returns The pagination bar previously installed via {@link setPaginationBar}.
     */
    getPaginationBar(): PaginationBar | undefined {
        return this._paginationBar;
    }
}

const TablePanelCallable = callable(TablePanel);
type TablePanelCallable = TablePanel;
export {
    TablePanel         as _TablePanel,
    TablePanelCallable as TablePanel
};
