import { Component } from "../Component.js";
import { Event } from "../Event.js";
import { HBox } from "../layout/HBox.js";
import { Input } from "./Input.js";
import { Label } from "./Label.js";

export class RadioButton extends Component {

    private selected: boolean;
    private label: Label;
    private radio: Input;

    constructor(text? : string) {
        super();

        this.setLayoutManager(new HBox());

        this.radio = new Input();

        this.label = new Label(text);
        this.label.setForId(this.radio.getId());

        this.addComponent(this.radio);
        this.addComponent(this.label);

        this.selected = false;

        this.radio.setPreferredSize(20, 20);
        this.radio.setMaxSize(16, 16);
        this.radio.setCursor("pointer");

        this.addActionListener(() => {
            this.selected = this.radio.getElement().checked;
        });
    }

    getElement(createIfMissing: boolean = false) {
        return <HTMLInputElement>super.getElement(createIfMissing);
    }

    addActionListener(listener: Function) {
        Event.addListener(this.radio, "change", listener);
    }

    setSelected(value: boolean) {
        this.selected = !!value;

        let element = this.radio.getElement();
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
        let radioElement = this.radio.getElement();

        radioElement.setAttribute("type", "radio");
        radioElement.checked = this.isSelected();

        return element;
    }
}