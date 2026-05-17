// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ButtonGroup, callable, Component, DarkTheme, DefaultTheme, Dialog, Event, Menu, Notification, Panel, ThemeManager, Tooltip, Window } from '@jimka/typescript-ui/core';
import { Insets } from '@jimka/typescript-ui/primitive';
import { HBox, VBox } from '@jimka/typescript-ui/layout';
import { MemoryStore, Model, ModelRecord, Proxy, ReadParams, Store } from '@jimka/typescript-ui/data';
import { AutoCompleteField, ComboBox, DateField, DateTimeField, NumberSpinner, RadioButton, Text, TextField, TimeField } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';
import { Glyph, IconLabel, IconText, Image, PaginationBar, ProgressBar, ProgressSpinner } from '@jimka/typescript-ui/component/display';
import { FieldSet } from '@jimka/typescript-ui/component/container';
import { ColumnSpec, Table, TablePanel } from '@jimka/typescript-ui/component/table';
import { IconLabelTreeNodeRenderer, Tree } from '@jimka/typescript-ui/component/tree';
import type { TreeNode } from '@jimka/typescript-ui/component/tree';
import { xmark } from '@jimka/typescript-ui/glyphs/solid/xmark';
import { arrow_right } from '@jimka/typescript-ui/glyphs/solid/arrow_right';
import { arrow_down } from '@jimka/typescript-ui/glyphs/solid/arrow_down';
import { folder } from '@jimka/typescript-ui/glyphs/solid/folder';
import { file } from '@jimka/typescript-ui/glyphs/solid/file';
import { file_code } from '@jimka/typescript-ui/glyphs/solid/file_code';
import { file_lines } from '@jimka/typescript-ui/glyphs/solid/file_lines';

Glyph.register(xmark, arrow_right, arrow_down, folder, file, file_code, file_lines);
/**
 * Demo-only proxy that slices an in-memory dataset by page/pageSize and
 * pretends to be a slow network request so the spinner overlay is visible.
 *
 * @remarks
 * Only `read()` is meaningfully implemented. CRUD methods are no-ops; the
 * demo never sync()s.
 */
class PaginatingDemoProxy extends Proxy {

    private readonly all: any[];
    private readonly latencyMs: number;
    private lastTotal: number | undefined = undefined;

    /**
     * @param all - The full in-memory dataset.
     * @param latencyMs - Artificial response delay in milliseconds.
     */
    constructor(all: any[], latencyMs: number = 800) {
        super();

        this.all = all;
        this.latencyMs = latencyMs;
    }

    /**
     * Returns a paginated slice of the in-memory dataset after a simulated delay.
     *
     * @param params - Pagination parameters from the store.
     * @returns The slice of records corresponding to the requested page.
     */
    read(params?: ReadParams): Promise<any[]> {
        const page     = params?.page ?? 1;
        const pageSize = params?.pageSize ?? this.all.length;
        const start    = (page - 1) * pageSize;
        const slice    = this.all.slice(start, start + pageSize);

        this.lastTotal = this.all.length;

        return new Promise(resolve => {
            setTimeout(() => resolve(slice), this.latencyMs);
        });
    }

    /**
     * Returns the total record count from the most recent paginated read.
     *
     * @returns The dataset's full length, or undefined before the first read.
     */
    getLastTotalCount(): number | undefined {
        return this.lastTotal;
    }

    create(_record: ModelRecord): Promise<Record<string, any>> {
        return Promise.resolve({});
    }

    update(_record: ModelRecord): Promise<Record<string, any>> {
        return Promise.resolve({});
    }

    destroy(_record: ModelRecord): Promise<void> {
        return Promise.resolve();
    }
}

class MiscPanel extends Panel {

    constructor() {
        super();

        this.setLayoutManager(new VBox());

        let buttonWindowImage = new Button("Show window with image!");
        buttonWindowImage.addActionListener(function () {
            let win = new Window("Hello World!");
            win.setX(100);
            win.setY(100);
            win.setWidth(400);
            win.setHeight(200);

            win.setContentFactory(() => new Image("https://arachnoid.com/JWX/graphics/grayscale_test_image_small.jpg?blah"));

            win.show();
        });
        this.addComponent(buttonWindowImage);

        let buttonWindowTable = new Button("Show window with table (slow)!");
        buttonWindowTable.addActionListener(function () {
            let win2 = new Window("blaah!");

            win2.setX(50);
            win2.setY(200);
            win2.setWidth(800);
            win2.setHeight(600);

            win2.setContentFactory(() => {
                let tableModel = new Model([
                    { name: "col1", type: "string",  description: "desc1", order: 4 },
                    { name: "col2", type: "boolean", description: "desc2", order: 3 },
                    { name: "col3", type: "number",  description: "desc3", order: 2 },
                    { name: "col4", type: "string",  description: "desc4", order: 1 },
                    { name: "col5", type: "string",  description: "desc5", order: 0 },
                ]);

                let tableStore = new MemoryStore(tableModel);
                let tablePanel = new TablePanel(tableStore);

                tablePanel.setExportMenuEnabled(true);

                const rows = [
                    // Declare rows with arrays. Array index is matched by the column order value;
                    // col5(0), col4(1), col3(2), col2(3), col1(4)
                    ["World", "Goodbye", 1        , false    , "Hello"],
                    ["World", "Goodbye", 8        , undefined, "Hello"],
                    ["World", undefined, undefined, false    , "Hello"],
                    ["World", "Goodbye", 3        , false    , "Hello"],
                    ["World", "Goodbye", 10       , undefined, "Hello"],
                    ["World", undefined, undefined, false    , "Hello"],
                    ["World", "Goodbye", 5        , false    , "Hello"],
                    ["World", "Goodbye", 12       , undefined, "Hello"],
                    ["World", undefined, undefined, false    , "Hello"],
                    ["World", "Goodbye", 7        , false    , "Hello"],
                    ["World", "Goodbye", 14       , undefined, "Hello"],

                    // Declare rows with dicts.
                    { col1: "Hello", col2: false                                , col5: "World" },
                    { col1: "Hello", col2: true,  col3: 2      , col4: "Goodbye", col5: "World" },
                    { col1: "Hello",              col3: 9      , col4: "Goodbye"                },
                    { col1: "Hello", col2: false                                , col5: "World" },
                    { col1: "Hello", col2: false, col3: 4      , col4: "Goodbye", col5: "World" },
                    { col1: "Hello",              col3: 11     , col4: "Goodbye"                },
                    { col1: "Hello", col2: false                                , col5: "World" },
                    { col1: "Hello", col2: false, col3: 6      , col4: "Goodbye", col5: "World" },
                    { col1: "Hello",              col3: 13     , col4: "Goodbye"                },
                    { col1: "Hello", col2: false                                , col5: "World" },
                ];

                tableStore.add([
                    ...rows, ...rows, ...rows, ...rows, ...rows, ...rows, ...rows, ...rows, ...rows, ...rows,
                    ...rows, ...rows, ...rows, ...rows, ...rows, ...rows, ...rows, ...rows, ...rows, ...rows
                ]);

                // TODO: Will this lead to a race condition if we don't 'await'?
                tableStore.sync();

                return tablePanel;
            });

            win2.show();
        });
        this.addComponent(buttonWindowTable);

        let buttonPaginatedTable = new Button("Show window with paginated table!")
            .addActionListener(function () {
                const pagModel = new Model([
                    { name: "id"    , type: "number" , description: "id"    , order: 0 },
                    { name: "name"  , type: "string" , description: "name"  , order: 1 },
                    { name: "score" , type: "number" , description: "score" , order: 2 },
                    { name: "active", type: "boolean", description: "active", order: 3 },
                ]);

                const all = Array.from({ length: 237 }, (_, i) => ({
                    id    : i + 1,
                    name  : "Person " + (i + 1),
                    score : Math.round(Math.random() * 1000) / 10,
                    active: i % 3 !== 0,
                }));

                const pagProxy = new PaginatingDemoProxy(all, 800);
                const pagStore = new Store(pagModel, pagProxy);

                pagStore.setPageSize(25);

                Window("Paginated table (server-side)", {
                    x: 150, y: 150,
                    width: 700, height: 500,
                    contentFactory: () => {
                        const pagPanel = new TablePanel(pagStore);

                        pagPanel.setPaginationBar(new PaginationBar(pagStore));
                        pagPanel.setExportMenuEnabled(true);

                        return pagPanel;
                    },
                    onReady: () => void pagStore.load()
                }).show();
        });
        this.addComponent(buttonPaginatedTable);

        let buttonWindowTableSpec = new Button("Show window with table (column spec)!");
        buttonWindowTableSpec.addActionListener(function () {
            let win3 = new Window("Table with column spec");

            win3.setX(100);
            win3.setY(250);
            win3.setWidth(800);
            win3.setHeight(400);

            win3.setContentFactory(() => {
                let specModel = new Model([
                    { name: "Name"      , type: "string"  , description: "col1", order: 0 },
                    { name: "Active"    , type: "boolean" , description: "col2", order: 1 },
                    { name: "Score"     , type: "number"  , description: "col3", order: 2 },
                    { name: "Joined"    , type: "date"    , description: "col5", order: 3 },
                    { name: "Meeting"   , type: "time"    , description: "col6", order: 4 },
                    { name: "LastSeen"  , type: "datetime", description: "col7", order: 5 },
                    { name: "Notes"     , type: "string"  , description: "col4", order: 6 },
                ]);

                let specStore = new MemoryStore(specModel);

                specStore.add([
                    { Name: "Alice", Active: true , Score: 95, Joined: new Date(2021,  2, 15), Meeting: new Date(1970, 0, 1,  9, 30, 20), LastSeen: new Date(2024,  0, 10, 14, 25), Notes: "Top performer"   },
                    { Name: "Bob"  , Active: false, Score: 72, Joined: new Date(2022,  7,  3), Meeting: new Date(1970, 0, 1, 14,  0, 30), LastSeen: new Date(2024,  3, 22,  8, 10), Notes: "Needs follow-up" },
                    { Name: "Carol", Active: true , Score: 88, Joined: new Date(2020, 11, 20), Meeting: null                        , LastSeen: new Date(2023, 11,  5, 17, 45)    , Notes: "On track"        },
                    { Name: "David", Active: true , Score: 61, Joined: null                  , Meeting: new Date(1970, 0, 1, 11, 15, 40), LastSeen: null                          , Notes: "Check in soon"   },
                    { Name: "Eve"  , Active: false, Score: 45, Joined: new Date(2023,  4,  9), Meeting: new Date(1970, 0, 1, 16, 45, 50), LastSeen: new Date(2024,  5,  1,  9,  0), Notes: "At risk"         },
                ]);

                // TODO: Will this lead to a race condition if we don't 'await'?
                specStore.sync();

                // Partial spec: Name gets a minWidth; Score gets a maxWidth.
                // Notes is hidden initially. col2 (Active) is not listed but is
                // auto-appended because appendUnlisted defaults to true.
                // Name carries a headerGlyph to demo the leading-glyph slot.
                const spec: ColumnSpec = {
                    columns: [
                        { field: 'Name'    , minWidth: 150, headerGlyph: 'xmark' },
                        { field: 'Active'  , maxWidth: 100                       },
                        { field: 'Joined'  , minWidth: 120                       },
                        { field: 'Meeting' , minWidth: 100, showSeconds: true    },
                        { field: 'LastSeen', minWidth: 160                       },
                        { field: 'Notes'   , hidden  : true                      },
                    ],
                };

                let specTable = new Table(specStore, spec);
                specTable.setExportMenuEnabled(true);

                return specTable;
            });

            win3.show();
        });
        this.addComponent(buttonWindowTableSpec);

        let isDark = false;
        let buttonTheme = new Button("Switch to dark theme");
        buttonTheme.addActionListener(function () {
            isDark = !isDark;
            ThemeManager.setTheme(isDark ? DarkTheme : DefaultTheme);
            buttonTheme.getText().setText(isDark ? "Switch to default theme" : "Switch to dark theme");
        });
        this.addComponent(buttonTheme);

        let fieldSet = new FieldSet("Hello World fieldset!");
        this.addComponent(fieldSet);

        const contextMenu = new Menu();

        const buttonContextMenu = new Button("Right-click me for context menu");
        Tooltip.attach(buttonContextMenu, "Right-click to open a context menu");
        Event.addListener(buttonContextMenu, "contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            Tooltip.hide();
            contextMenu.show(e.clientX, e.clientY, [
                { text: "Action 1", action: () => alert("Action 1 clicked!") },
                { text: "Action 2", action: () => alert("Action 2 clicked!") },
                { separator: true },
                { text: "Disabled action", enabled: false },
                { text: "Action 3", action: () => alert("Action 3 clicked!") },
            ]);
        });
        this.addComponent(buttonContextMenu);

        const buttonTooltip = new Button("Hover over me for a tooltip");
        Tooltip.attach(buttonTooltip, "This tooltip appears after a short delay");
        this.addComponent(buttonTooltip);

        const buttonTree = new Button("Show tree component");
        buttonTree.addActionListener(() => {
            const win = new Window("Tree component");
            win.setX(200);
            win.setY(150);
            win.setWidth(300);
            win.setHeight(400);

            win.setContentFactory(() => {
                const treeData: TreeNode[] = [
                    {
                        label: "Animals", children: [
                            {
                                label: "Mammals", children: [
                                    { label: "Dog" },
                                    { label: "Cat" },
                                    { label: "Horse" },
                                ],
                            },
                            {
                                label: "Birds", children: [
                                    { label: "Eagle" },
                                    { label: "Parrot" },
                                ],
                            },
                            { label: "Fish" },
                        ],
                    },
                    {
                        label: "Plants", children: [
                            { label: "Trees" },
                            { label: "Flowers" },
                            { label: "Ferns" },
                        ],
                    },
                    { label: "Fungi" },
                ];

                const tree = new Tree();
                tree.setNodes(treeData);

                return tree;
            });

            win.show();
        });
        this.addComponent(buttonTree);

        const buttonTreeIcons = new Button("Show tree component (icon renderer)");
        buttonTreeIcons.addActionListener(() => {
            const win = new Window("Tree — IconLabel renderer");
            win.setX(220);
            win.setY(170);
            win.setWidth(320);
            win.setHeight(400);

            win.setContentFactory(() => {
                const treeData: TreeNode[] = [
                    {
                        label: "src", children: [
                            {
                                label: "lib", children: [
                                    { label: "Component.ts" },
                                    { label: "Event.ts" },
                                ],
                            },
                            { label: "main.ts" },
                        ],
                    },
                    {
                        label: "docs", children: [
                            { label: "guide.md" },
                            { label: "api.md" },
                        ],
                    },
                    { label: "package.json" },
                ];

                const tree = new Tree();
                tree.setRendererFactory(() => new IconLabelTreeNodeRenderer(
                    (node) => {
                        if (node.children && node.children.length > 0) {
                            return "folder";
                        }

                        const label = node.label ?? "";

                        if (label.endsWith(".ts") || label.endsWith(".json")) {
                            return "file-code";
                        }
                        if (label.endsWith(".md")) {
                            return "file-lines";
                        }

                        return "file";
                    },
                ));
                tree.setNodes(treeData);

                return tree;
            });

            win.show();
        });
        this.addComponent(buttonTreeIcons);

        const buttonNotificationInfo = new Button("Notification — info");
        buttonNotificationInfo.addActionListener(() => {
            Notification.show("This is an informational message.", "info");
        });
        this.addComponent(buttonNotificationInfo);

        const buttonNotificationSuccess = new Button("Notification — success");
        buttonNotificationSuccess.addActionListener(() => {
            Notification.show("Record saved successfully.", "success");
        });
        this.addComponent(buttonNotificationSuccess);

        const buttonNotificationWarning = new Button("Notification — warning");
        buttonNotificationWarning.addActionListener(() => {
            Notification.show("Unsaved changes will be lost.", "warning");
        });
        this.addComponent(buttonNotificationWarning);

        const buttonNotificationError = new Button("Notification — error");
        buttonNotificationError.addActionListener(() => {
            Notification.show("Connection failed. Please try again.", "error");
        });
        this.addComponent(buttonNotificationError);

        const buttonNotificationStack = new Button("Notification — show all types");
        buttonNotificationStack.addActionListener(() => {
            Notification.show("This is an informational message.", "info");
            Notification.show("Record saved successfully.", "success");
            Notification.show("Unsaved changes will be lost.", "warning");
            Notification.show("Connection failed. Please try again.", "error");
        });
        this.addComponent(buttonNotificationStack);

        const fruits = [
            "Apple", "Apricot", "Avocado", "Banana", "Blackberry", "Blueberry",
            "Cherry", "Clementine", "Coconut", "Date", "Fig", "Grape", "Grapefruit",
            "Guava", "Kiwi", "Lemon", "Lime", "Lychee", "Mango", "Melon",
            "Nectarine", "Orange", "Papaya", "Peach", "Pear", "Pineapple",
            "Plum", "Pomegranate", "Raspberry", "Strawberry", "Tangerine", "Watermelon",
        ];

        const autoCompleteField = new AutoCompleteField({
            suggestions   : fruits,
            placeholder   : "Type a fruit…",
            maxSuggestions: 8,
        });

        const selectedText = new Text("Selected: (none)");

        autoCompleteField.addSelectListener(value => {
            selectedText.setText("Selected: " + value);
        });

        const radioContains    = new RadioButton("Contains");
        const radioStartsWith  = new RadioButton("Starts with");
        radioContains.setSelected(true);

        const modeGroup = new ButtonGroup();
        modeGroup.addButton(radioContains);
        modeGroup.addButton(radioStartsWith);

        modeGroup.addSelectionListener((button) => {
            autoCompleteField.setMatchMode(button === radioContains ? 'contains' : 'startsWith');
        });

        const modeRow = new Component({ layoutManager: new HBox() })
            .addComponent(new Text("Match mode:"))
            .addComponent(radioContains)
            .addComponent(radioStartsWith);

        const autoCompleteRow = new Component();
        autoCompleteRow.setLayoutManager(new HBox());
        autoCompleteRow.addComponent(new Text("AutoComplete:"));
        autoCompleteRow.addComponent(autoCompleteField);
        this.addComponent(modeRow);
        this.addComponent(autoCompleteRow);
        this.addComponent(selectedText);

        const buttonDialogConfirm = new Button("Dialog — confirm/cancel");
        buttonDialogConfirm.addActionListener(async () => {
            const confirmed = await Dialog.confirm(
                'Confirm action',
                'Are you sure you want to proceed with this action?'
            );

            Notification.show(`Dialog closed with: ${confirmed ? 'confirm' : 'cancel'}`, confirmed ? 'success' : 'info');
        });
        this.addComponent(buttonDialogConfirm);

        const buttonDialogOk = new Button("Dialog — OK only");
        buttonDialogOk.addActionListener(async () => {
            await Dialog.show({
                title  : 'Information',
                message: 'This is a simple informational dialog with a single OK button.',
            });
        });
        this.addComponent(buttonDialogOk);

        const buttonDialogBackdrop = new Button("Dialog — close on backdrop click");
        buttonDialogBackdrop.addActionListener(async () => {
            const result = await Dialog.show({
                title          : 'Click outside to close',
                message        : 'You can dismiss this dialog by clicking the backdrop or pressing Escape.',
                closeOnBackdrop: true,
            });

            Notification.show(`Dialog closed with: ${result}`, 'info');
        });
        this.addComponent(buttonDialogBackdrop);

        const integerSpinner = new NumberSpinner({
            min  : 0,
            max  : 10,
            step : 1,
            value: 3,
        });

        const decimalSpinner = new NumberSpinner({
            min  : -1,
            max  : 1,
            step : 0.1,
            value: 0,
        });

        const unboundedSpinner = new NumberSpinner({
            step : 5,
            value: 100,
        });

        const spinnerText = new Text("Spinners — integer: 3, decimal: 0.0, unbounded: 100");
        const updateSpinnerText = (): void => {
            spinnerText.setText(
                "Spinners — integer: " + integerSpinner.getValue()
                + ", decimal: "  + decimalSpinner.getValue().toFixed(1)
                + ", unbounded: " + unboundedSpinner.getValue()
            );
        };

        integerSpinner.addChangeListener(updateSpinnerText);
        decimalSpinner.addChangeListener(updateSpinnerText);
        unboundedSpinner.addChangeListener(updateSpinnerText);

        const spinnerRow = new Component();
        spinnerRow.setLayoutManager(new HBox());
        spinnerRow.addComponent(new Text("0–10:"));
        spinnerRow.addComponent(integerSpinner);
        spinnerRow.addComponent(new Text("-1..1 step 0.1:"));
        spinnerRow.addComponent(decimalSpinner);
        spinnerRow.addComponent(new Text("step 5:"));
        spinnerRow.addComponent(unboundedSpinner);

        this.addComponent(spinnerRow);
        this.addComponent(spinnerText);

        const progressBar = new ProgressBar(0, false, {
            preferredSize: { width: 300, height: 12 },
            insets       : new Insets(0, 0, 0, 0),
        });

        const progressText = new Text("Progress: 0%");

        const progressBarRow = new Component();
        progressBarRow.setLayoutManager(new HBox());
        progressBarRow.addComponent(new Text("ProgressBar:"));
        progressBarRow.addComponent(progressBar);
        progressBarRow.addComponent(progressText);

        this.addComponent(progressBarRow);

        const buttonProgressStart = new Button("Animate progress bar");
        buttonProgressStart.addActionListener(() => {
            progressBar.setIndeterminate(false);
            let v = 0;
            progressBar.setValue(0);
            progressText.setText("Progress: 0%");

            const handle = setInterval(() => {
                v += 5;
                progressBar.setValue(v);
                progressText.setText("Progress: " + v + "%");

                if (v >= 100) {
                    clearInterval(handle);
                }
            }, 100);
        });
        this.addComponent(buttonProgressStart);

        const buttonProgressIndeterminate = new Button("Toggle indeterminate progress bar");
        buttonProgressIndeterminate.addActionListener(() => {
            progressBar.setIndeterminate(!progressBar.isIndeterminate());
            progressText.setText(progressBar.isIndeterminate() ? "Progress: indeterminate" : "Progress: " + progressBar.getValue() + "%");
        });
        this.addComponent(buttonProgressIndeterminate);

        const inlineSpinner = new ProgressSpinner();
        const spinnerDemoRow = new Component();
        spinnerDemoRow.setLayoutManager(new HBox());
        spinnerDemoRow.addComponent(new Text("Inline ProgressSpinner:"));
        spinnerDemoRow.addComponent(inlineSpinner);
        this.addComponent(spinnerDemoRow);

        const glyphRow = new Component();
        glyphRow.setLayoutManager(new HBox());
        glyphRow.addComponent(new Text("Glyphs:"));
        glyphRow.addComponent(new Glyph("xmark"));
        glyphRow.addComponent(new Glyph("arrow-right"));
        glyphRow.addComponent(new Glyph("arrow-down"));
        this.addComponent(glyphRow);

        const animatedGlyphRow = new Component();
        animatedGlyphRow.setLayoutManager(new HBox());
        animatedGlyphRow.addComponent(new Text("Animated glyphs:"));
        animatedGlyphRow.addComponent(new Glyph("xmark",       { animation: "spin"  }));
        animatedGlyphRow.addComponent(new Glyph("arrow-right", { animation: "pulse" }));
        animatedGlyphRow.addComponent(new Glyph("arrow-down",  { animation: "beat"  }));
        this.addComponent(animatedGlyphRow);

        const buttonWithGlyph = new Button("Save", { glyph: "xmark" });
        this.addComponent(buttonWithGlyph);

        const iconTextRow = new Component();
        iconTextRow.setLayoutManager(new HBox());
        iconTextRow.addComponent(new Text("IconText:"));
        iconTextRow.addComponent(new IconText("xmark", "Close"));
        iconTextRow.addComponent(new IconText("arrow-right", "Next"));
        this.addComponent(iconTextRow);

        const iconLabelField = new TextField();
        const iconLabelRow = new Component();
        iconLabelRow.setLayoutManager(new HBox());
        iconLabelRow.addComponent(new IconLabel("xmark", "Email:", iconLabelField.getId()));
        iconLabelRow.addComponent(iconLabelField);
        this.addComponent(iconLabelRow);

        const buttonGlyphWindow = new Button("Show window with title glyph");
        buttonGlyphWindow.addActionListener(() => {
            const win = new Window("Settings", { glyph: "arrow-right" });
            win.setX(220);
            win.setY(180);
            win.setWidth(300);
            win.setHeight(180);
            win.show();
        });
        this.addComponent(buttonGlyphWindow);

        const buttonOverlaySpinner = new Button("Overlay spinner on this panel for 2 s");
        buttonOverlaySpinner.addActionListener(() => {
            const overlay = new ProgressSpinner(48);
            overlay.showOverlay(this);

            setTimeout(() => overlay.hideOverlay(), 2000);
        });
        this.addComponent(buttonOverlaySpinner);

        // ── AnimatedDropdown demo: ComboBox / DateField / TimeField / DateTimeField ──
        const animatedDropdownsLabel = new Text("Animated dropdowns:");
        this.addComponent(animatedDropdownsLabel);

        const fieldsRow = new Component();
        fieldsRow.setLayoutManager(new HBox());

        const animatedCombo = new ComboBox({
            items: ['Apple', 'Banana', 'Cherry', 'Date', 'Elderberry'],
        });
        fieldsRow.addComponent(animatedCombo);

        const animatedDate = new DateField();
        fieldsRow.addComponent(animatedDate);

        const animatedTime = new TimeField({ showSeconds: true });
        fieldsRow.addComponent(animatedTime);

        const animatedDateTime = new DateTimeField({ showSeconds: true });
        fieldsRow.addComponent(animatedDateTime);

        this.addComponent(fieldsRow);
    }
}

const MiscPanelCallable = callable(MiscPanel);
type MiscPanelCallable = MiscPanel;
export {
    MiscPanel         as _MiscPanel,
    MiscPanelCallable as MiscPanel
};
