import { Event } from "../Event.js";
import { Button } from "./Button.js";

// TODO: Need to make this component into a proper toggle button, it's currently a bit of a hack.

export class ToggleButton extends Button {

    private selected: boolean;

    constructor(text: String) {
        super(text);

        this.selected = false;

        Event.addListener(this, "click", this.onAction);
    }

    isSelected() {
        return this.selected;
    }

    setSelected(value: boolean) {
        this.selected = value;

        if (value) {
            this.setShadow("2px 2px 1px inset grey");
        } else {
            this.setShadow("none");
        }
    }

    onAction() {
        this.setSelected(!this.selected);
    }

    render() {
        let element = super.render();

        return element;
    }
}