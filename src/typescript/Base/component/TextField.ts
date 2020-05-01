import { Text } from "./Text.js";
import { Event } from "../Event.js";
import { Insets } from "../Insets.js";

export class TextField extends Text {

    constructor() {
        super("input");

        this.setCursor("text");
        this.setPreferredSize(200, 20);
        this.setPadding(new Insets(3, 3, 3, 3));
        this.setMaxSize(Number.MAX_SAFE_INTEGER, 20);

        Event.addListener(this, "input", this.onInput);
    }

    destructor() {
        //Util.removeListener("input", this.onInput);
    }

    getElement(createIfMissing: boolean = false) {
        return <HTMLInputElement>super.getElement(createIfMissing);
    }

    onInput() {
        let element = this.getElement();
        this.setText(element.value);
    }

    setText(text: String) {
        super.setText(text);

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.value = text.valueOf();
    }

    addActionListener(listener: Function) {
        Event.addListener(this, "input", listener);
    }

    render() {
        let element = <HTMLInputElement>super.render();

        element.setAttribute("type", "text");
        element.textContent = null;
        element.value = this.getText().valueOf();

        return element;
    }
}