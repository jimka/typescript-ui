// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Window } from "./Base/Window.js";
import { Image } from "./Base/component/Image.js";
import { Model } from "./Base/data/Model.js";
import { MemoryStore } from "./Base/data/MemoryStore.js";
import { Component } from "./Base/Component.js";
import { Button } from "./Base/component/Button.js";
import { Label } from "./Base/component/Label.js";
import { RadioButton } from "./Base/component/RadioButton.js";
import { ButtonGroup } from "./Base/ButtonGroup.js";
import { VBox } from "./Base/layout/VBox.js";
import { HBox } from "./Base/layout/HBox.js";
import { FieldSet } from "./Base/component/FieldSet.js";
import { ThemeManager, DefaultTheme, DarkTheme } from "./Base/Theme.js";
import { TablePanel, Table, ColumnSpec } from "./Base/index.js";
import { ContextMenu } from "./Base/ContextMenu.js";
import { Tooltip } from "./Base/Tooltip.js";
import { Event } from "./Base/Event.js";
import { Tree } from "./Base/component/tree/Tree.js";
import type { TreeNode } from "./Base/component/tree/TreeNode.js";
import { Notification } from "./Base/Notification.js";
import { AutoCompleteField } from "./Base/component/AutoCompleteField.js";

export class MiscPanel extends Component {

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

            let image = new Image("https://arachnoid.com/JWX/graphics/grayscale_test_image_small.jpg?blah");
            win.addComponent(image);

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

            let tableModel = new Model([
                { name: "col1", type: "string",  description: "desc1", order: 4 },
                { name: "col2", type: "boolean", description: "desc2", order: 3 },
                { name: "col3", type: "number",  description: "desc3", order: 2 },
                { name: "col4", type: "string",  description: "desc4", order: 1 },
                { name: "col5", type: "string",  description: "desc5", order: 0 },
            ]);

            let tableStore = new MemoryStore(tableModel);
            let tablePanel = new TablePanel(tableStore)

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
            tableStore.sync()

            win2.addComponent(tablePanel);

            win2.show();
        });
        this.addComponent(buttonWindowTable);

        let buttonWindowTableSpec = new Button("Show window with table (column spec)!");
        buttonWindowTableSpec.addActionListener(function () {
            let win3 = new Window("Table with column spec");

            win3.setX(100);
            win3.setY(250);
            win3.setWidth(600);
            win3.setHeight(400);

            let specModel = new Model([
                { name: "Name"   , type: "string" , description: "col1", order: 0 },
                { name: "Active" , type: "boolean", description: "col2", order: 1 },
                { name: "Score"  , type: "number" , description: "col3", order: 2 },
                { name: "Notes"  , type: "string" , description: "col4", order: 3 },
            ]);

            let specStore = new MemoryStore(specModel);

            specStore.add([
                { Name: "Alice", Active: true , Score: 95,  Notes: "Top performer"   },
                { Name: "Bob"  , Active: false, Score: 72,  Notes: "Needs follow-up" },
                { Name: "Carol", Active: true , Score: 88,  Notes: "On track"        },
                { Name: "David", Active: true , Score: 61,  Notes: "Check in soon"   },
                { Name: "Eve"  , Active: false, Score: 45,  Notes: "At risk"         },
            ]);

            // TODO: Will this lead to a race condition if we don't 'await'?
            specStore.sync();

            // Partial spec: Name gets a minWidth; Score gets a maxWidth.
            // Notes is hidden initially. col2 (Active) is not listed but is
            // auto-appended because appendUnlisted defaults to true.
            const spec: ColumnSpec = {
                columns: [
                    { field: 'Name'  , minWidth: 150  },
                    { field: 'Active', maxWidth: 100  },
                    { field: 'Notes' , hidden  : true },
                ],
            };

            let specTable = new Table(specStore, spec);

            win3.addComponent(specTable);
            win3.show();
        });
        this.addComponent(buttonWindowTableSpec);

        let isDark = false;
        let buttonTheme = new Button("Switch to dark theme");
        buttonTheme.addActionListener(function () {
            isDark = !isDark;
            ThemeManager.setTheme(isDark ? DarkTheme : DefaultTheme);
            buttonTheme.getLabel().setText(isDark ? "Switch to default theme" : "Switch to dark theme");
        });
        this.addComponent(buttonTheme);

        let fieldSet = new FieldSet("Hello World fieldset!");
        this.addComponent(fieldSet);

        const contextMenu = new ContextMenu();

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
            win.addComponent(tree);
            win.show();
        });
        this.addComponent(buttonTree);

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

        const selectedLabel = new Label("Selected: (none)");

        autoCompleteField.addSelectListener(value => {
            selectedLabel.setText("Selected: " + value);
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

        const modeRow = new Component();
        modeRow.setLayoutManager(new HBox());
        modeRow.addComponent(new Label("Match mode:"));
        modeRow.addComponent(radioContains);
        modeRow.addComponent(radioStartsWith);

        const autoCompleteRow = new Component();
        autoCompleteRow.setLayoutManager(new HBox());
        autoCompleteRow.addComponent(new Label("AutoComplete:"));
        autoCompleteRow.addComponent(autoCompleteField);
        this.addComponent(modeRow);
        this.addComponent(autoCompleteRow);
        this.addComponent(selectedLabel);
    }
}
