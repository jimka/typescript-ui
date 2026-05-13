// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, VBox, HBox, Text, TextField, Checkbox, ComboBox, Button, Binding, DateField, TimeField, Model, MemoryStore, Notification, Panel, callable } from "@jimka/typescript-ui";

class BindingPanel extends Panel {

    constructor() {
        super();

        this.setLayoutManager(new VBox());

        // ── Model and record ─────────────────────────────────────────────────

        const personModel = new Model([
            { name: 'id',           type: 'number'  },
            { name: 'name',         type: 'string'  },
            { name: 'active',       type: 'boolean' },
            { name: 'role',         type: 'string'  },
            { name: 'birthDate',    type: 'string'  },
            { name: 'reminderTime', type: 'string'  },
        ]);

        const personStore = new MemoryStore({
            model: personModel,
            data : [
                { id: 1, name: 'Alice', active: true,  role: 'admin',  birthDate: '1990-03-15', reminderTime: '09:00' },
                { id: 2, name: 'Bob',   active: false, role: 'editor', birthDate: '1985-11-22', reminderTime: '14:30' },
            ],
        });

        // ── Role options store ───────────────────────────────────────────────

        const roleModel = new Model([
            { name: 'value', type: 'string' },
            { name: 'label', type: 'string' },
        ]);

        const roleStore = new MemoryStore({
            model: roleModel,
            data : [
                { value: 'admin',  label: 'Admin'  },
                { value: 'editor', label: 'Editor' },
                { value: 'viewer', label: 'Viewer' },
            ],
        });

        // ── Components ───────────────────────────────────────────────────────

        const nameField     = new TextField();
        const activeCheck   = new Checkbox();
        const roleCombo     = new ComboBox({
            store       : roleStore,
            displayField: 'label',
            valueField  : 'value',
        });
        const birthDateField    = new DateField();
        const reminderTimeField = new TimeField();

        // ── Status label ─────────────────────────────────────────────────────

        const statusText = new Text("Status: clean");

        // ── Binding ──────────────────────────────────────────────────────────

        const binding = new Binding()
            .bind('name',   nameField)
            .bind('active', activeCheck)
            .bind('role',   roleCombo)
            .bind('birthDate', birthDateField, {
                get:    () => {
                    const d = birthDateField.getValue();
                    return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "";
                },
                set:    (v: unknown) => birthDateField.setValue(v ? new Date(String(v) + "T00:00:00") : null),
                listen: (fn) => birthDateField.addBindingListener(fn),
            })
            .bind('reminderTime', reminderTimeField, {
                get:    () => {
                    const d = reminderTimeField.getValue();
                    return d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "";
                },
                set:    (v: unknown) => {
                    if (!v) {
                        reminderTimeField.setValue(null);
                        return;
                    }
                    const [h, m] = String(v).split(":").map(Number);
                    const d = new Date();
                    d.setHours(h, m, 0, 0);
                    reminderTimeField.setValue(d);
                },
                listen: (fn) => reminderTimeField.addBindingListener(fn),
            })
            .addValidation('name', nameField, [
                { type: 'required',  message: 'Name is required.' },
                { type: 'minLength', min: 2,   message: 'Name must be at least 2 characters.' },
                { type: 'maxLength', max: 50,  message: 'Name must be at most 50 characters.' },
            ])
            .addValidation('birthDate', birthDateField, [
                { type: 'required', message: 'Birth date is required.' },
            ])
            .addValidation('reminderTime', reminderTimeField, [
                { type: 'required', message: 'Reminder time is required.' },
            ]);

        binding.setValidateOnChange(true);

        binding.addChangeListener((_field, _value) => {
            statusText.setText("Status: modified");
        });

        binding.addCommitListener(() => {
            statusText.setText("Status: clean");
        });

        binding.addRejectListener(() => {
            statusText.setText("Status: clean");
        });

        // ── Record selector ──────────────────────────────────────────────────

        const recordCombo = new ComboBox({
            store       : personStore,
            displayField: 'name',
            valueField  : 'id',
        });

        // ── Layout ───────────────────────────────────────────────────────────

        const selectorRow = new Component();
        selectorRow.setLayoutManager(new HBox());
        selectorRow.addComponent(new Text("Record:"));
        selectorRow.addComponent(recordCombo);
        this.addComponent(selectorRow);

        const nameRow = new Component();
        nameRow.setLayoutManager(new HBox());
        nameRow.addComponent(new Text("Name:"));
        nameRow.addComponent(nameField);
        this.addComponent(nameRow);

        const activeRow = new Component();
        activeRow.setLayoutManager(new HBox());
        activeRow.addComponent(new Text("Active:"));
        activeRow.addComponent(activeCheck);
        this.addComponent(activeRow);

        const roleRow = new Component();
        roleRow.setLayoutManager(new HBox());
        roleRow.addComponent(new Text("Role:"));
        roleRow.addComponent(roleCombo);
        this.addComponent(roleRow);

        const birthDateRow = new Component();
        birthDateRow.setLayoutManager(new HBox());
        birthDateRow.addComponent(new Text("Birth date:"));
        birthDateRow.addComponent(birthDateField);
        this.addComponent(birthDateRow);

        const reminderTimeRow = new Component();
        reminderTimeRow.setLayoutManager(new HBox());
        reminderTimeRow.addComponent(new Text("Reminder time:"));
        reminderTimeRow.addComponent(reminderTimeField);
        this.addComponent(reminderTimeRow);

        this.addComponent(statusText);

        const buttonRow = new Component();
        buttonRow.setLayoutManager(new HBox());

        const commitButton = new Button("Commit");
        const rejectButton = new Button("Reject");
        buttonRow.addComponent(commitButton);
        buttonRow.addComponent(rejectButton);
        this.addComponent(buttonRow);

        // ── Wire up interactions ─────────────────────────────────────────────

        commitButton.addActionListener(() => {
            if (binding.validate()) {
                binding.commit();
                Notification.show('Record saved.', 'success');
            } else {
                Notification.show('Please fix the highlighted fields before saving.', 'error');
            }
        });

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

const BindingPanelCallable = callable(BindingPanel);
type BindingPanelCallable = BindingPanel;
export {
    BindingPanel         as _BindingPanel,
    BindingPanelCallable as BindingPanel
};
