// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../Component.js";
import { AbstractStore } from "../../data/AbstractStore.js";
import { Border } from "../../layout/Border.js";
import { HBox } from "../../layout/HBox.js";
import { Placement } from "../../Placement.js";
import { Button } from "../Button.js";
import { Table } from "./Table.js";

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

    getTable(): Table {
        return this.table;
    }

    getToolbar(): Component {
        return this.toolbar;
    }
}
