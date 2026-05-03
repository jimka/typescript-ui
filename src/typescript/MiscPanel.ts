// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Window } from "./Base/Window.js";
import { Image } from "./Base/component/Image.js";
import { Model } from "./Base/data/Model.js";
import { MemoryStore } from "./Base/data/MemoryStore.js";
import { Component } from "./Base/Component.js";
import { Button } from "./Base/component/Button.js";
import { VBox } from "./Base/layout/VBox.js";
import { FieldSet } from "./Base/component/FieldSet.js";
import { ThemeManager, DefaultTheme, DarkTheme } from "./Base/Theme.js";
import { TablePanel, Table, ColumnSpec } from "./Base/index.js";
import { ContextMenu } from "./Base/ContextMenu.js";
import { Tooltip } from "./Base/Tooltip.js";
import { Event } from "./Base/Event.js";

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
                { name: "col1", type: "string",  description: "Name",    order: 0 },
                { name: "col2", type: "boolean", description: "Active",  order: 1 },
                { name: "col3", type: "number",  description: "Score",   order: 2 },
                { name: "col4", type: "string",  description: "Notes",   order: 3 },
            ]);

            let specStore = new MemoryStore(specModel);

            specStore.add([
                { col1: "Alice",   col2: true,  col3: 95,  col4: "Top performer"  },
                { col1: "Bob",     col2: false, col3: 72,  col4: "Needs follow-up" },
                { col1: "Carol",   col2: true,  col3: 88,  col4: "On track"        },
                { col1: "David",   col2: true,  col3: 61,  col4: "Check in soon"   },
                { col1: "Eve",     col2: false, col3: 45,  col4: "At risk"         },
            ]);

            // TODO: Will this lead to a race condition if we don't 'await'?
            specStore.sync();

            // Partial spec: Name gets a minWidth; Score gets a maxWidth.
            // Notes is hidden initially. col2 (Active) is not listed but is
            // auto-appended because appendUnlisted defaults to true.
            const spec: ColumnSpec = {
                columns: [
                    { field: 'col1', minWidth: 150 },
                    { field: 'col3', maxWidth: 100 },
                    { field: 'col4', hidden: true  },
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
    }
}
