import { Component } from "../Component.js";
import { Option } from "./Option.js";
import { Event } from "../Event.js";
import { Type } from "../Type.js";

export class ComboBox extends Component {

    private items: Array<Option>;

    constructor() {
        super("select");

        this.setPreferredSize(200, 20);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, 20);
        this.items = [];
    }

    addActionListener(listener: Function) {
        Event.addListener(this, "change", listener);
    }

    getSelectedItem() {
        let element = this.getElement();
        return element[element.selectedIndex].textContent;
    }

    getElement(createIfMissing: boolean = false) {
        return <HTMLSelectElement>super.getElement(createIfMissing);
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

    getItems() {
        return this.items.slice();
    }

    setItems(items: String | Array<String>) {
        if (!Type.isArray(items)) {
            items = [<String>items];
        }

        for (let idx in items) {
            let value = items[idx];

            let item = new Option(idx, value);
            this.items.push(item);
        }

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.innerHTML = "";

        for (let idx in this.items) {
            let value = this.items[idx];

            element.appendChild(value.getElement());
        }
    }

    addItem(item: String) {
        let listItem = new Option((this.items.length + 1).toString(), item);
        this.items.push(listItem);

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.appendChild(listItem.getElement(true));
    }

    render() {
        let element = super.render();

        for (let idx in this.items) {
            let item = this.items[idx];

            element.appendChild(item.getElement(true));
        }

        return element;
    }
}