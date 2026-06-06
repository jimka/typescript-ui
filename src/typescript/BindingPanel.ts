// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Binding, callable, Component, Notification, Panel } from '@jimka/typescript-ui/core';
import { HBox, VBox } from '@jimka/typescript-ui/layout';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { Checkbox, ComboBox, DateField, Text, TextField, TimeField } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';
import { FormFieldSet } from '@jimka/typescript-ui/component/container';
class BindingPanel extends Panel {

    constructor() {
        super({ autoScroll: "auto" });

        // The panel stacks a single fieldset; width-stretching lets the
        // fieldset fill the available width up to its 600px cap.
        this.setLayoutManager(new VBox({ stretching: true }));

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
                listen: (fn) => birthDateField.on("binding", fn),
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
                listen: (fn) => reminderTimeField.on("binding", fn),
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

        binding.on("change", (_field, _value) => {
            statusText.setText("Status: modified");
        });

        binding.on("commit", () => {
            statusText.setText("Status: clean");
        });

        binding.on("reject", () => {
            statusText.setText("Status: clean");
        });

        // ── Record selector ──────────────────────────────────────────────────

        const recordCombo = new ComboBox({
            store       : personStore,
            displayField: 'name',
            valueField  : 'id',
        });

        // ── Layout ───────────────────────────────────────────────────────────

        // Group the bound fields in a labelled fieldset, capped at 400px wide
        // so the form lines stay a comfortable reading length on wide screens.
        const FIELDSET_MAX_WIDTH = 400;

        const buttonRow = new Component();
        buttonRow.setLayoutManager(new HBox());

        const commitButton = new Button("Commit");
        const rejectButton = new Button("Reject");

        buttonRow.addComponent(commitButton);
        buttonRow.addComponent(rejectButton);

        // A single-column FormFieldSet formalises the labelled-form pattern: each
        // row is one title/field pair (titles hug their text, inputs take the
        // slack), and the status line and button bar each span the full width.
        const fieldSet = new FormFieldSet("Information", {
            rows: [
                [{ title: "Record",        component: recordCombo }],
                [{ title: "Name",          component: nameField }],
                [{ title: "Active",        component: activeCheck }],
                [{ title: "Role",          component: roleCombo }],
                [{ title: "Birth date",    component: birthDateField }],
                [{ title: "Reminder time", component: reminderTimeField }],
                { component: statusText, fullWidth: true },
                { component: buttonRow,  fullWidth: true },
            ],
        });
        fieldSet.setMaxSize(FIELDSET_MAX_WIDTH, Number.MAX_VALUE);

        this.addComponent(fieldSet);

        // A two-column FormFieldSet (unbound) demonstrating the multi-column
        // layout: pairs flow across two logical columns that line up row-by-row,
        // a short row leaves its trailing column empty, and a note spans the full
        // width. Capped wider than the single-column form to fit two columns.
        const WIDE_FIELDSET_MAX_WIDTH = 600;

        const addressForm = new FormFieldSet("Address (2-column demo)", {
            columns: 2,
            rows: [
                [{ title: "First",   component: new TextField()             }, { title: "Last",    component: new TextField() }],
                [{ title: "Street address 1",    component: new TextField() }, { title: "Postal",  component: new TextField() }],
                [{ title: "Street address 2", component: new TextField()    }, { title: "City",    component: new TextField() }],
                [{ title: "Country", component: new TextField()             }],
                { component: new Text("Rows line up across both columns; the short row leaves a gap."), fullWidth: true },
            ],
        });
        addressForm.setMaxSize(WIDE_FIELDSET_MAX_WIDTH, Number.MAX_VALUE);

        this.addComponent(addressForm);

        // ── Wire up interactions ─────────────────────────────────────────────

        commitButton.on("action", () => {
            if (binding.validate()) {
                binding.commit();
                Notification.show('Record saved.', 'success');
            } else {
                Notification.show('Please fix the highlighted fields before saving.', 'error');
            }
        });

        rejectButton.on("action", () => binding.reject());

        // Load stores then bind the first record
        roleStore.load().then(() => {
            personStore.load().then(() => {
                const records = personStore.getRecords();
                if (records.length > 0) binding.setRecord(records[0]);
            });
        });

        // Veto record switches while the current record has uncommitted edits.
        // Demonstrates on("beforerecord", fn): returning false cancels setRecord().
        binding.on("beforerecord", (next) => {
            const current = binding.getRecord();

            if (current && current !== next && current.isDirty()) {
                Notification.show('Commit or reject your changes before switching record.', 'error');

                return false;
            }

            return true;
        });

        recordCombo.on("action", () => {
            const id = Number(recordCombo.getValue());
            const record = personStore.find('id', id);

            if (!record) {
                return;
            }

            binding.setRecord(record);

            // If the veto fired, the binding is still on the previous record —
            // snap the combo back so its selection matches reality.
            const active = binding.getRecord();

            if (active && active !== record) {
                recordCombo.setValue(String(active.get('id')));
            }
        });
    }
}

const BindingPanelCallable = callable(BindingPanel);
type BindingPanelCallable = BindingPanel;
export {
    BindingPanel         as _BindingPanel,
    BindingPanelCallable as BindingPanel
};
