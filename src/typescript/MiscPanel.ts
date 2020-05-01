import { Table } from "./Base/component/table/Table.js";
import { Window } from "./Base/Window.js";
import { Image } from "./Base/component/Image.js";
import { Model } from "./Base/component/table/model/Model.js";
import { Field } from "./Base/component/table/model/Field.js";
import { Component } from "./Base/Component.js";
import { Button } from "./Base/component/Button.js";
import { VBox } from "./Base/layout/VBox.js";
import { FieldSet } from "./Base/component/FieldSet.js";

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
                new Field("col1", "string", "desc1", 4),
                new Field("col2", "boolean", "desc2", 3),
                new Field("col3", "number", "desc3", 2),
                new Field("col4", "string", "desc4", 1),
                new Field("col5", "string", "desc5", 0),
            ]);

            let table = new Table(tableModel);

            table.addRows([
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col3", 1],
                    ["col4", "Goodbye"],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col3", 8],
                    ["col4", "Goodbye"],
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", true],
                    ["col3", 2],
                    ["col4", "Goodbye"],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col3", 9],
                    ["col4", "Goodbye"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col3", 3],
                    ["col4", "Goodbye"],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col3", 10],
                    ["col4", "Goodbye"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col3", 4],
                    ["col4", "Goodbye"],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col3", 11],
                    ["col4", "Goodbye"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col3", 5],
                    ["col4", "Goodbye"],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col3", 12],
                    ["col4", "Goodbye"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col3", 6],
                    ["col4", "Goodbye"],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col3", 13],
                    ["col4", "Goodbye"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col3", 7],
                    ["col4", "Goodbye"],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col3", 14],
                    ["col4", "Goodbye"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col3", 1],
                    ["col4", "Goodbye"],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col3", 8],
                    ["col4", "Goodbye"],
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", true],
                    ["col3", 2],
                    ["col4", "Goodbye"],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col3", 9],
                    ["col4", "Goodbye"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col3", 3],
                    ["col4", "Goodbye"],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col3", 10],
                    ["col4", "Goodbye"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col3", 4],
                    ["col4", "Goodbye"],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col3", 11],
                    ["col4", "Goodbye"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col3", 5],
                    ["col4", "Goodbye"],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col3", 12],
                    ["col4", "Goodbye"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col3", 6],
                    ["col4", "Goodbye"],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col3", 13],
                    ["col4", "Goodbye"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col3", 7],
                    ["col4", "Goodbye"],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col3", 14],
                    ["col4", "Goodbye"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col3", 1],
                    ["col4", "Goodbye"],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col3", 8],
                    ["col4", "Goodbye"],
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", true],
                    ["col3", 2],
                    ["col4", "Goodbye"],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col3", 9],
                    ["col4", "Goodbye"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col3", 3],
                    ["col4", "Goodbye"],
                    ["col5", "World"]
                ]),
                new Map<String, any>([
                    ["col1", "Hello"],
                    ["col2", false],
                    ["col5", "World"]
                ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 10],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 4],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 11],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 5],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 12],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 6],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 13],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 7],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 14],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 1],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 8],
                //     ["col4", "Goodbye"],
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", true],
                //     ["col3", 2],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 9],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 3],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 10],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 4],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 11],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 5],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 12],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 6],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 13],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 7],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 14],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 1],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 8],
                //     ["col4", "Goodbye"],
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", true],
                //     ["col3", 2],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 9],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 3],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 10],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 4],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 11],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 5],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 12],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 6],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 13],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 7],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 14],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 1],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 8],
                //     ["col4", "Goodbye"],
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", true],
                //     ["col3", 2],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 9],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 3],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 10],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 4],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 11],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 5],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 12],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 6],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 13],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 7],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 14],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 1],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 8],
                //     ["col4", "Goodbye"],
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", true],
                //     ["col3", 2],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 9],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 3],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 10],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 4],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 11],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 5],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 12],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 6],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 13],
                //     ["col4", "Goodbye"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col3", 7],
                //     ["col4", "Goodbye"],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col2", false],
                //     ["col5", "World"]
                // ]),
                // new Map<String, any>([
                //     ["col1", "Hello"],
                //     ["col3", 14],
                //     ["col4", "Goodbye"]
                // ])
            ]);

            win2.addComponent(table);

            win2.show();
        });
        this.addComponent(buttonWindowTable);

        let fieldSet = new FieldSet("Hello World fieldset!");
        this.addComponent(fieldSet);
    }
}