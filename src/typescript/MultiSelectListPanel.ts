// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "./Base/Component.js";
import { VBox } from "./Base/layout/VBox.js";
import { HBox } from "./Base/layout/HBox.js";
import { Label } from "./Base/component/Label.js";
import { Button } from "./Base/component/Button.js";
import { MultiSelectList } from "./Base/component/MultiSelectList.js";
import { Binding } from "./Base/Binding.js";
import { Model } from "./Base/data/Model.js";
import { MemoryStore } from "./Base/data/MemoryStore.js";
import { Insets } from "./Base/Insets.js";

/**
 * Demonstrates `MultiSelectList` with static items, store binding,
 * and integration with the `Binding` system.
 */
export class MultiSelectListPanel extends Component {

    /**
     * Builds the demo panel with three sections:
     * static items, store-backed items, and a bound multi-select.
     */
    constructor() {
        super();

        this.setLayoutManager(new VBox());
        this.setInsets(new Insets(8, 8, 8, 8));

        // ── Section 1: Static items ──────────────────────────────────────────

        const staticList = new MultiSelectList();
        staticList.setItems(["Apple", "Banana", "Cherry", "Date", "Elderberry"]);

        const selectionLabel = new Label("Selected: (none)");

        staticList.addActionListener(() => {
            const vals = staticList.getValues();
            selectionLabel.setText(`Selected: ${vals.length === 0 ? "(none)" : vals.join(", ")}`);
        });

        const selectAllBtn  = new Button("Select All");
        const clearBtn      = new Button("Clear");

        selectAllBtn.addActionListener(() => {
            staticList.setValues(["0", "1", "2", "3", "4"]);
            selectionLabel.setText(`Selected: ${staticList.getValues().join(", ")}`);
        });

        clearBtn.addActionListener(() => {
            staticList.setValues([]);
            selectionLabel.setText("Selected: (none)");
        });

        const staticBtnRow = new Component();
        staticBtnRow.setLayoutManager(new HBox());
        staticBtnRow.addComponent(selectAllBtn);
        staticBtnRow.addComponent(clearBtn);

        this.addComponent(new Label("Static items — select multiple with Ctrl/Shift:"));
        this.addComponent(staticList);
        this.addComponent(selectionLabel);
        this.addComponent(staticBtnRow);

        // ── Section 2: Store-backed ──────────────────────────────────────────

        const skillModel = new Model([
            { name: 'id',    type: 'string' },
            { name: 'label', type: 'string' },
        ]);

        const skillStore = new MemoryStore(skillModel, [
            { id: 'ts',   label: 'TypeScript' },
            { id: 'rust', label: 'Rust'       },
            { id: 'go',   label: 'Go'         },
            { id: 'py',   label: 'Python'     },
            { id: 'cpp',  label: 'C++'        },
        ]);

        const storeList = new MultiSelectList();
        storeList.setStore(skillStore, 'label', 'id');

        const storeLabel = new Label("Selected records: (none)");

        storeList.addActionListener(() => {
            const recs = storeList.getSelectedRecords();
            const names = recs.map(r => String(r.get('label'))).join(", ");
            storeLabel.setText(`Selected records: ${names || "(none)"}`);
        });

        this.addComponent(new Label("Store-backed items:"));
        this.addComponent(storeList);
        this.addComponent(storeLabel);

        // ── Section 3: Binding integration ──────────────────────────────────

        const tagModel = new Model([
            { name: 'id',   type: 'number' },
            { name: 'tags', type: 'string' },
        ]);

        const tagStore = new MemoryStore(tagModel, [
            { id: 1, tags: 'urgent,review' },
            { id: 2, tags: 'docs'          },
        ]);

        const tagList = new MultiSelectList();
        tagList.setItems(["urgent", "review", "docs", "blocked", "wip"]);

        const bindingStatusLabel = new Label("Binding status: clean");

        const binding = new Binding()
            .bind('tags', tagList, {
                get:    () => tagList.getValues(),
                set:    (v: unknown) => tagList.setValues(v ? String(v).split(",").filter(Boolean) : []),
                listen: (fn) => tagList.addActionListener(fn),
            });

        binding.addChangeListener(() => {
            bindingStatusLabel.setText("Binding status: modified");
        });

        binding.addCommitListener(() => {
            bindingStatusLabel.setText("Binding status: clean");
        });

        binding.addRejectListener(() => {
            bindingStatusLabel.setText("Binding status: clean");
        });

        const commitBtn = new Button("Commit");
        const rejectBtn = new Button("Reject");

        commitBtn.addActionListener(() => binding.commit());
        rejectBtn.addActionListener(() => binding.reject());

        const bindingBtnRow = new Component();
        bindingBtnRow.setLayoutManager(new HBox());
        bindingBtnRow.addComponent(commitBtn);
        bindingBtnRow.addComponent(rejectBtn);

        this.addComponent(new Label("Binding integration (tags field):"));
        this.addComponent(tagList);
        this.addComponent(bindingStatusLabel);
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
