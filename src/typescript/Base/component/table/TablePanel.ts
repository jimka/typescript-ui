// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../Component.js";
import { AbstractStore } from "../../data/AbstractStore.js";
import { Border } from "../../layout/Border.js";
import { HBox } from "../../layout/HBox.js";
import { Panel } from "../../Panel.js";
import { Placement } from "../../Placement.js";
import { Button } from "../Button.js";
import { PaginationBar } from "../PaginationBar.js";
import { ProgressSpinner } from "../ProgressSpinner.js";
import { Table } from "./Table.js";

/**
 * A composite panel that combines a {@link Table} with an add/remove/sync toolbar.
 *
 * The toolbar is docked to the north region; the table fills the center region.
 *
 * @category Components
 */
export class TablePanel extends Panel {

    private table: Table;
    private toolbar: Component;
    private syncBtn: Button;
    private rejectBtn: Button;
    private _spinner: ProgressSpinner | null = null;
    private paginationBar: PaginationBar | undefined = undefined;

    constructor(store: AbstractStore) {
        super();

        this.setLayoutManager(new Border());

        this.toolbar = new Component();
        this.toolbar.setLayoutManager(new HBox());

        const addBtn = new Button("+");
        addBtn.addActionListener(() => this.table.addRow());
        this.toolbar.addComponent(addBtn);

        const removeBtn = new Button("−");
        removeBtn.addActionListener(() => this.table.removeSelectedRow());
        this.toolbar.addComponent(removeBtn);

        this.syncBtn = new Button("Sync");
        this.syncBtn.addActionListener(() => this.table.sync());
        this.toolbar.addComponent(this.syncBtn);

        this.rejectBtn = new Button("Reject");
        this.rejectBtn.addActionListener(() => this.table.reject());
        this.toolbar.addComponent(this.rejectBtn);

        this.table = new Table(store);

        super.addComponent(this.toolbar, { placement: Placement.NORTH });
        super.addComponent(this.table,   { placement: Placement.CENTER });

        store.on('loadingchanged', (payload: { loading: boolean }) => {
            if (!this._spinner) {
                this._spinner = new ProgressSpinner(24);
            }

            if (payload.loading) {
                this._spinner.showOverlay(this.table);
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
        const hasChanges = this.table.getStore().hasPendingChanges();

        this.syncBtn.setEnabled(hasChanges);
        this.rejectBtn.setEnabled(hasChanges);
    }

    /**
     * Returns the Table component managed by this panel.
     *
     * @returns The managed {@link Table} instance.
     */
    getTable(): Table {
        return this.table;
    }

    /**
     * Returns the toolbar component containing the add/remove/sync buttons.
     *
     * @returns The toolbar {@link Component}.
     */
    getToolbar(): Component {
        return this.toolbar;
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
    setPaginationBar(bar: PaginationBar): void {
        if (this.paginationBar) {
            this.removeComponent(this.paginationBar);
            this.paginationBar.dispose();
        }

        this.paginationBar = bar;
        super.addComponent(bar, { placement: Placement.SOUTH });
    }

    /**
     * Returns the currently attached pagination bar, or undefined if none is set.
     *
     * @returns The pagination bar previously installed via {@link setPaginationBar}.
     */
    getPaginationBar(): PaginationBar | undefined {
        return this.paginationBar;
    }
}
