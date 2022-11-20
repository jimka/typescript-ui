import { Text } from "./Text.js";
import { Event } from "../Event.js";
import { Insets } from "../Insets.js";

export class TextArea extends Text {

    constructor(text: string = "") {
        super("textarea");

        this.setCursor("text");
        this.setPadding(new Insets(3, 3, 3, 3));
        this.setPreferredSize(200, 200);
        this.setBackgroundColor("rgb(255, 255, 255");
        if (text) {
            this.setText(text);
        }

        Event.addListener(this, "input", this.onInput);
    }

    destructor() {
        //Util.removeListener("input", this.onInput);
    }

    onInput() {
        let element = this.getElement();
        this.setText(element.value);
    }

    addActionListener(listener: Function) {
        Event.addListener(this, "input", listener);
    }

    render() {
        let element = super.render();

        element.style.resize = "none";

        return element;
    }
}