// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "./Base/Component.js";
import { VBox } from "./Base/layout/VBox.js";
import { HBox } from "./Base/layout/HBox.js";
import { Label } from "./Base/component/Label.js";
import { TextField } from "./Base/component/TextField.js";
import { Checkbox } from "./Base/component/Checkbox.js";
import { ComboBox } from "./Base/component/ComboBox.js";
import { Button } from "./Base/component/Button.js";
import { Binding } from "./Base/Binding.js";
import { Model } from "./Base/data/Model.js";
import { MemoryStore } from "./Base/data/MemoryStore.js";

export class BindingPanel extends Component {

    constructor() {
        super();

        this.setLayoutManager(new VBox());

        // ── Model and record ─────────────────────────────────────────────────

        const personModel = new Model([
            { name: 'id',     type: 'number'  },
            { name: 'name',   type: 'string'  },
            { name: 'active', type: 'boolean' },
            { name: 'role',   type: 'string'  },
        ]);

        const personStore = new MemoryStore(personModel, [
            { id: 1, name: 'Alice', active: true,  role: 'admin'  },
            { id: 2, name: 'Bob',   active: false, role: 'editor' },
        ]);

        // ── Role options store ───────────────────────────────────────────────

        const roleModel = new Model([
            { name: 'value', type: 'string' },
            { name: 'label', type: 'string' },
        ]);

        const roleStore = new MemoryStore(roleModel, [
            { value: 'admin',  label: 'Admin'  },
            { value: 'editor', label: 'Editor' },
            { value: 'viewer', label: 'Viewer' },
        ]);

        // ── Components ───────────────────────────────────────────────────────

        const nameField   = new TextField();
        const activeCheck = new Checkbox();
        const roleCombo   = new ComboBox();

        roleCombo.setStore(roleStore, 'label', 'value');

        // ── Status label ─────────────────────────────────────────────────────

        const statusLabel = new Label("Status: clean");

        // ── Binding ──────────────────────────────────────────────────────────

        const binding = new Binding()
            .bind('name',   nameField)
            .bind('active', activeCheck)
            .bind('role',   roleCombo);

        binding.addChangeListener((_field, _value) => {
            statusLabel.setText("Status: modified");
        });

        binding.addCommitListener(() => {
            statusLabel.setText("Status: clean");
        });

        binding.addRejectListener(() => {
            statusLabel.setText("Status: clean");
        });

        // ── Record selector ──────────────────────────────────────────────────

        const recordCombo = new ComboBox();
        recordCombo.setStore(personStore, 'name', 'id');

        // ── Layout ───────────────────────────────────────────────────────────

        const selectorRow = new Component();
        selectorRow.setLayoutManager(new HBox());
        selectorRow.addComponent(new Label("Record:"));
        selectorRow.addComponent(recordCombo);
        this.addComponent(selectorRow);

        const nameRow = new Component();
        nameRow.setLayoutManager(new HBox());
        nameRow.addComponent(new Label("Name:"));
        nameRow.addComponent(nameField);
        this.addComponent(nameRow);

        const activeRow = new Component();
        activeRow.setLayoutManager(new HBox());
        activeRow.addComponent(new Label("Active:"));
        activeRow.addComponent(activeCheck);
        this.addComponent(activeRow);

        const roleRow = new Component();
        roleRow.setLayoutManager(new HBox());
        roleRow.addComponent(new Label("Role:"));
        roleRow.addComponent(roleCombo);
        this.addComponent(roleRow);

        this.addComponent(statusLabel);

        const buttonRow = new Component();
        buttonRow.setLayoutManager(new HBox());

        const commitButton = new Button("Commit");
        const rejectButton = new Button("Reject");
        buttonRow.addComponent(commitButton);
        buttonRow.addComponent(rejectButton);
        this.addComponent(buttonRow);

        // ── Wire up interactions ─────────────────────────────────────────────

        commitButton.addActionListener(() => binding.commit());
        rejectButton.addActionListener(() => binding.reject());

        // Load stores then bind the first record
        roleStore.load().then(() => {
            personStore.load().then(() => {
                const records = personStore.getRecords();
                if (records.length > 0) binding.setRecord(records[0]);
            });
        });

        recordCombo.addActionListener(() => {
            const selected = recordCombo.getElement();
            const id = Number(selected.value);
            const record = personStore.find('id', id);
            if (record) binding.setRecord(record);
        });
    }
}
