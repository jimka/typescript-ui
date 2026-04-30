// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../Component.js";
import { AbstractStore } from "../../data/AbstractStore.js";
import { Border } from "../../layout/Border.js";
import { HBox } from "../../layout/HBox.js";
import { Placement } from "../../Placement.js";
import { Button } from "../Button.js";
import { Table } from "./Table.js";

/**
 * A composite panel that combines a {@link Table} with an add/remove/sync toolbar.
 *
 * The toolbar is docked to the north region; the table fills the center region.
 */
export class TablePanel extends Component {

    private table: Table;
    private toolbar: Component;

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

        const syncBtn = new Button("Sync");
        syncBtn.addActionListener(() => this.table.sync());
        this.toolbar.addComponent(syncBtn);

        this.table = new Table(store);

        super.addComponent(this.toolbar, { placement: Placement.NORTH });
        super.addComponent(this.table,   { placement: Placement.CENTER });
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
}
