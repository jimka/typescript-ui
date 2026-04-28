// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Table } from "./Base/component/table/Table.js";
import { Window } from "./Base/Window.js";
import { Image } from "./Base/component/Image.js";
import { Model } from "./Base/data/Model.js";
import { MemoryStore } from "./Base/data/MemoryStore.js";
import { Component } from "./Base/Component.js";
import { Button } from "./Base/component/Button.js";
import { VBox } from "./Base/layout/VBox.js";
import { FieldSet } from "./Base/component/FieldSet.js";
import { ThemeManager, DefaultTheme, DarkTheme } from "./Base/Theme.js";

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
            let table = new Table(tableStore);

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

            win2.addComponent(table);

            win2.show();
        });
        this.addComponent(buttonWindowTable);

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
    }
}
