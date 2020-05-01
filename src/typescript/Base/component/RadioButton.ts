import { Component } from "../Component.js";
import { Event } from "../Event.js";

export class RadioButton extends Component {

    private selected: boolean;

    constructor() {
        super("input");

        this.selected = false;

        this.setPreferredSize(20, 20);
        this.setMaxSize(16, 16);
        this.setCursor("pointer");

        this.addActionListener(() => {
            this.selected = this.getElement().checked;
        });
    }

    getElement(createIfMissing: boolean = false) {
        return <HTMLInputElement>super.getElement(createIfMissing);
    }

    addActionListener(listener: Function) {
        Event.addListener(this, "change", listener);
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

        element.setAttribute("type", "radio");
        element.checked = this.isSelected();

        return element;
    }
}