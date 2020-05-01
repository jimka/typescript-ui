import { Component } from "../Component.js";
import { Event } from "../Event.js";
import { Insets } from "../Insets.js";
import { LayoutConstraints } from "../Layout/LayoutConstraints.js";
import { BulletedListItemStyle } from "./BulletedListItemStyle.js";
import { NumberedListItemStyle } from "./NumberedListItemStyle.js";
import { ListItem } from "./ListItem.js";

export abstract class AbstractListComponent<U extends BulletedListItemStyle | NumberedListItemStyle> extends Component {

    private style: U | undefined;

    constructor(tag: string, style: U) {
        super(tag);

        this.setStyle(style);
        this.setPreferredSize(200, 200);
        this.setPadding(new Insets(0, 0, 0, 25));
    }

    getStyle() {
        return this.style;
    }

    setStyle(style: U) {
        this.style = style;
        this.setElementCSSRule("list-style-type", style);
    }

    addActionListener(listener: Function) {
        Event.addListener(this, "change", listener);
    }

    getSelectedComponent() {
        let element = this.getElement();
        return element[element.selectedIndex].textContent;
    }

    getSelectedIndex() {
        let element = this.getElement();
        return element.selectedIndex;
    }

    setSelectedIndex(idx: number, fireEvent = true) {
        let element = this.getElement();
        if (!element) {
            return;
        }

        element.selectedIndex = idx;

        if (!!fireEvent) {
            Event.fireEvent(this, "change");
        }
    }

    getElement(createIfMissing: boolean = false) {
        return <HTMLSelectElement>super.getElement(createIfMissing);
    }

    addComponent(component: ListItem, constraints?: LayoutConstraints) {
        super.addComponent(component, constraints);
    }

    removeComponent(component: ListItem | Number) {
        return super.removeComponent(component);
    }
}