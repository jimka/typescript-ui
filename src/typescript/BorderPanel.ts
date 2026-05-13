// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Border } from "./lib/layout/Border.js";
import { Component } from "./lib/Component.js";
import { List } from "./lib/component/List.js";
import { Text } from "./lib/component/Text.js";
import { TextArea } from "./lib/component/TextArea.js";
import { BulletedList } from "./lib/component/BulletedList.js";
import { ListItem } from "./lib/component/ListItem.js";
import { NumberedList } from "./lib/component/NumberedList.js";
import { Placement } from "./lib/Placement.js";
import { Panel } from "./lib/Panel.js";
import { callable } from "./lib/Callable.js";

class BorderPanel extends Panel {

    constructor() {
        super();

        this.setLayoutManager(new Border());

        let headerText = new Text("Header!");
        headerText.setPreferredSize(20, 100);
        this.addComponent(headerText, { placement: Placement.NORTH });

        let list = new List();
        this.addComponent(list, { placement: Placement.WEST });

        list.addItem("One");
        list.addItem("Two");
        list.addItem("Three");
        list.addItem("Four");
        list.addItem("Five");
        list.addItem("Six");
        list.addItem("Seven");
        list.addItem("Eight");
        list.addItem("Nine");
        list.addItem("Ten");
        list.addItem("Eleven");
        list.addItem("Twelve");
        list.addItem("Thirteen");

        let centerTextArea = new TextArea("Center textarea!");
        this.addComponent(centerTextArea, { placement: Placement.CENTER });

        let footerText = new Text("Footer!1!!!");
        footerText.setPreferredSize(20, 50);
        this.addComponent(footerText, { placement: Placement.SOUTH });

        let eastComponent = new Component();
        eastComponent.setLayoutManager(new Border());

        let bulletedList = new BulletedList();
        bulletedList.addComponent(new ListItem("a", "A"));
        bulletedList.addComponent(new ListItem("b", "B"));
        bulletedList.addComponent(new ListItem("c", "C"));
        bulletedList.addComponent(new ListItem("d", "D"));
        bulletedList.addComponent(new ListItem("e", "E"));

        eastComponent.addComponent(bulletedList, { placement: Placement.NORTH });

        let numberedList = new NumberedList();
        numberedList.addComponent(new ListItem("1", "One"));
        numberedList.addComponent(new ListItem("2", "Two"));
        numberedList.addComponent(new ListItem("3", "Three"));
        numberedList.addComponent(new ListItem("4", "Four"));
        numberedList.addComponent(new ListItem("5", "Five"));

        eastComponent.addComponent(numberedList, { placement: Placement.SOUTH });

        this.addComponent(eastComponent, { placement: Placement.EAST });
    }
}

const BorderPanelCallable = callable(BorderPanel);
type BorderPanelCallable = BorderPanel;
export {
    BorderPanel         as _BorderPanel,
    BorderPanelCallable as BorderPanel
};
