import { Border } from "./Base/layout/Border.js";
import { Component } from "./Base/Component.js";
import { List } from "./Base/component/List.js";
import { Label } from "./Base/component/Label.js";
import { TextArea } from "./Base/component/TextArea.js";
import { BulletedList } from "./Base/component/BulletedList.js";
import { ListItem } from "./Base/component/ListItem.js";
import { NumberedList } from "./Base/component/NumberedList.js";
import { Placement } from "./Base/Placement.js";

export class BorderPanel extends Component {

    constructor() {
        super();

        this.setLayoutManager(new Border());

        let label = new Label("Header!");
        label.setPreferredSize(20, 100);
        this.addComponent(label, { placement: Placement.NORTH });

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

        let southLabel = new Label("Footer!1!!!");
        southLabel.setPreferredSize(20, 50);
        this.addComponent(southLabel, { placement: Placement.SOUTH });

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