// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "./Base/Component.js";
import { VBox } from "./Base/layout/VBox.js";
import { HBox } from "./Base/layout/HBox.js";
import { Text } from "./Base/component/Text.js";
import { Button } from "./Base/component/Button.js";
import { MultiSelectList } from "./Base/component/MultiSelectList.js";
import { Binding } from "./Base/Binding.js";
import { Model } from "./Base/data/Model.js";
import { MemoryStore } from "./Base/data/MemoryStore.js";
import { Panel } from "./Base/Panel.js";

/**
 * Demonstrates `MultiSelectList` with static items, store binding,
 * and integration with the `Binding` system.
 */
export class MultiSelectListPanel extends Panel {

    /**
     * Builds the demo panel with three sections:
     * static items, store-backed items, and a bound multi-select.
     */
    constructor() {
        super();

        this.setLayoutManager(new VBox());

        // ── Section 1: Static items ──────────────────────────────────────────

        const staticList = new MultiSelectList();
        staticList.setItems(["Apple", "Banana", "Cherry", "Date", "Elderberry"]);

        const selectionText = new Text("Selected: (none)");

        staticList.addActionListener(() => {
            const vals = staticList.getValues();
            selectionText.setText(`Selected: ${vals.length === 0 ? "(none)" : vals.join(", ")}`);
        });

        const selectAllBtn  = new Button("Select All");
        const clearBtn      = new Button("Clear");

        selectAllBtn.addActionListener(() => {
            staticList.setValues(["0", "1", "2", "3", "4"]);
            selectionText.setText(`Selected: ${staticList.getValues().join(", ")}`);
        });

        clearBtn.addActionListener(() => {
            staticList.setValues([]);
            selectionText.setText("Selected: (none)");
        });

        const staticBtnRow = new Component();
        staticBtnRow.setLayoutManager(new HBox());
        staticBtnRow.addComponent(selectAllBtn);
        staticBtnRow.addComponent(clearBtn);

        this.addComponent(new Text("Static items — select multiple with Ctrl/Shift:"));
        this.addComponent(staticList);
        this.addComponent(selectionText);
        this.addComponent(staticBtnRow);

        // ── Section 2: Store-backed ──────────────────────────────────────────

        const skillModel = new Model([
            { name: 'id',    type: 'string' },
            { name: 'label', type: 'string' },
        ]);

        const skillStore = new MemoryStore({
            model: skillModel,
            data : [
                { id: 'ts',   label: 'TypeScript' },
                { id: 'rust', label: 'Rust'       },
                { id: 'go',   label: 'Go'         },
                { id: 'py',   label: 'Python'     },
                { id: 'cpp',  label: 'C++'        },
            ],
        });

        const storeList = new MultiSelectList({
            store       : skillStore,
            displayField: 'label',
            valueField  : 'id',
        });

        const storeText = new Text("Selected records: (none)");

        storeList.addActionListener(() => {
            const recs = storeList.getSelectedRecords();
            const names = recs.map(r => String(r.get('label'))).join(", ");
            storeText.setText(`Selected records: ${names || "(none)"}`);
        });

        this.addComponent(new Text("Store-backed items:"));
        this.addComponent(storeList);
        this.addComponent(storeText);

        // ── Section 3: Binding integration ──────────────────────────────────

        const tagModel = new Model([
            { name: 'id',   type: 'number' },
            { name: 'tags', type: 'string' },
        ]);

        const tagStore = new MemoryStore({
            model: tagModel,
            data : [
                { id: 1, tags: 'urgent,review' },
                { id: 2, tags: 'docs'          },
            ],
        });

        const tagList = new MultiSelectList({
            items: ["urgent", "review", "docs", "blocked", "wip"],
        });

        const bindingStatusText = new Text("Binding status: clean");

        const binding = new Binding()
            .bind('tags', tagList, {
                get:    () => tagList.getValues(),
                set:    (v: unknown) => tagList.setValues(v ? String(v).split(",").filter(Boolean) : []),
                listen: (fn) => tagList.addActionListener(fn),
            });

        binding.addChangeListener(() => {
            bindingStatusText.setText("Binding status: modified");
        });

        binding.addCommitListener(() => {
            bindingStatusText.setText("Binding status: clean");
        });

        binding.addRejectListener(() => {
            bindingStatusText.setText("Binding status: clean");
        });

        const commitBtn = new Button("Commit");
        const rejectBtn = new Button("Reject");

        commitBtn.addActionListener(() => binding.commit());
        rejectBtn.addActionListener(() => binding.reject());

        const bindingBtnRow = new Component();
        bindingBtnRow.setLayoutManager(new HBox());
        bindingBtnRow.addComponent(commitBtn);
        bindingBtnRow.addComponent(rejectBtn);

        this.addComponent(new Text("Binding integration (tags field):"));
        this.addComponent(tagList);
        this.addComponent(bindingStatusText);
        this.addComponent(bindingBtnRow);

        // ── Load stores ──────────────────────────────────────────────────────

        skillStore.load();

        tagStore.load().then(() => {
            const records = tagStore.getRecords();
            if (records.length > 0) {
                binding.setRecord(records[0]);
            }
        });
    }
}
