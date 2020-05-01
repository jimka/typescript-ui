import { Component } from "../Component.js";
import { Event } from "../Event.js";

export class Checkbox extends Component {

    private selected: boolean;

    constructor() {
        super("input");

        this.selected = false;

        this.setPreferredSize(16, 16);
        this.setMaxSize(16, 16);
        this.setCursor("pointer");

        this.addActionListener(this.onAction);
    }

    onAction() {
        let element = this.getElement();
        this.selected = element.checked;
    }

    getElement(createIfMissing: boolean = false) {
        return <HTMLInputElement>super.getElement(createIfMissing);
    }

    addActionListener(listener: Function) {
        Event.addListener(this, "click", listener);
    }

    setSelected(value: boolean) {
        this.selected = !!value;

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.checked = this.isSelected();
    }

    isSelected() {
        return this.selected;
    }

    render() {
        let element = <HTMLInputElement>super.render();

        element.setAttribute("type", "checkbox");
        element.checked = this.isSelected();

        return element;
    }
}