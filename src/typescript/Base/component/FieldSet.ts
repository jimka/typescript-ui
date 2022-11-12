import { Component } from "../Component.js";
import { Legend } from "./Legend.js";
import { BorderStyle } from "../BorderStyle.js";
import { Insets } from "../Insets.js";

export class FieldSet extends Component {

    private legend: Legend = new Legend();

    constructor(title: string = "") {
        super("fieldset");

        this.legend.setText(title);
        this.setBorder(BorderStyle.GROOVE, 1, "BLACK");
        this.setPadding(new Insets(3, 3, 3, 3));
    }

    getTitle() {
        return this.legend.getText();
    }

    setTitle(title: string) {
        this.legend.setText(title);
    }

    render() {
        let element = super.render();

        element.appendChild(this.legend.getElement(true));

        return element;
    }
}