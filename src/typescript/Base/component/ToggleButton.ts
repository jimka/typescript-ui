// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CSS } from "../CSS.js";
import { Event } from "../Event.js";
import { Button } from "./Button.js";

export class ToggleButton extends Button {

    private selected: boolean = false;
    private selectedCSSRule: CSSStyleRule;

    constructor(text: string) {
        super(text);

        this.selectedCSSRule = CSS.createComponentRule(this.getId() + ".selected") as CSSStyleRule;
        this.selectedCSSRule.style.boxShadow = "2px 2px 1px inset grey";
        this.selectedCSSRule.style.backgroundImage = "linear-gradient(rgb(200, 200, 200), rgb(200, 200, 200))";

        Event.addListener(this, "click", () => this.onAction());
    }

    addActionListener(listener: Function) {
        Event.addListener(this, "change", listener);
    }

    isSelected() {
        return this.selected;
    }

    setSelected(value: boolean) {
        this.selected = value;

        let element = this.getElement();
        if (element) {
            element.classList.toggle("selected", value);
        }
    }

    private onAction() {
        this.setSelected(!this.selected);

        Event.fireEvent(this, "change");
    }

    render() {
        let element = super.render();
        element.classList.toggle("selected", this.selected);
        return element;
    }
}