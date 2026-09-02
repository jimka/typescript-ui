// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Binding, callable, Component, Panel } from '@jimka/typescript-ui/core';
import { HBox, VBox } from '@jimka/typescript-ui/layout';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { Text } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';
import { MultiSelectList } from '@jimka/typescript-ui/component/list';
/**
 * Demonstrates `MultiSelectList` with static items, store binding,
 * and integration with the `Binding` system.
 */
class MultiSelectListPanel extends Panel {

    /**
     * Builds the demo panel with three sections:
     * static items, store-backed items, and a bound multi-select.
     */
    constructor() {
        super({
            layoutManager: new VBox(),
            autoScroll: "auto"
        });

        // ── Section 1: Static items ──────────────────────────────────────────

        const staticItems = ["Apple", "Banana", "Cherry", "Date", "Elderberry"];

        const staticList = new MultiSelectList();
        staticList.setItems(staticItems);

        const selectionText = new Text("Selected: (none)");

        staticList.on("action", () => {
            const vals = staticList.getValue();
            selectionText.setText(`Selected: ${vals.length === 0 ? "(none)" : vals.join(", ")}`);
        });

        const selectAllBtn  = new Button("Select All");
        const clearBtn      = new Button("Clear");

        selectAllBtn.on("action", () => {
            // A plain-string item is keyed by its own value, so the selection
            // is written as the item strings — not as their indices.
            staticList.setValues(staticItems);
            selectionText.setText(`Selected: ${staticList.getValue().join(", ")}`);
        });

        clearBtn.on("action", () => {
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

        storeList.on("action", () => {
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
        const fieldDirtyText = new Text("Field dirty: no");

        tagList.onDirtyChange(() => {
            fieldDirtyText.setText(`Field dirty: ${tagList.isDirty() ? "yes" : "no"}`);
        });

        const binding = new Binding()
            .bind('tags', tagList, {
                get:    () => tagList.getValue(),
                set:    (v: unknown) => tagList.setValues(v ? String(v).split(",").filter(Boolean) : []),
                listen: (fn) => tagList.on("action", fn),
            });

        binding.on("change", () => {
            bindingStatusText.setText("Binding status: modified");
        });

        binding.on("commit", () => {
            bindingStatusText.setText("Binding status: clean");
        });

        binding.on("reject", () => {
            bindingStatusText.setText("Binding status: clean");
        });

        const commitBtn = new Button("Commit");
        const rejectBtn = new Button("Reject");

        commitBtn.on("action", () => { binding.commit(); });
        rejectBtn.on("action", () => { binding.reject(); });

        const bindingBtnRow = new Component();
        bindingBtnRow.setLayoutManager(new HBox());
        bindingBtnRow.addComponent(commitBtn);
        bindingBtnRow.addComponent(rejectBtn);

        this.addComponent(new Text("Binding integration (tags field):"));
        this.addComponent(tagList);
        this.addComponent(bindingStatusText);
        this.addComponent(fieldDirtyText);
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

const MultiSelectListPanelCallable = callable(MultiSelectListPanel);
type MultiSelectListPanelCallable = MultiSelectListPanel;
export {
    MultiSelectListPanel         as _MultiSelectListPanel,
    MultiSelectListPanelCallable as MultiSelectListPanel
};
