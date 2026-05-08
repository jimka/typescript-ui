// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextInput } from "./TextInput.js";
import { Util } from "../Util.js";
import { Event } from "../Event.js";
import { Insets } from "../Insets.js";
import { Bindable } from "../Bindable.js";
import { ThemeManager } from "../Theme.js";

/**
 * A single-line text field component backed by an `<input type="text">` element.
 *
 * Keeps internal text state in sync with the DOM on every input event.
 *
 * @category Components
 */
export class TextField extends TextInput implements Bindable<string> {

    constructor() {
        super();

        this.setCursor("text");
        this.setPadding(new Insets(3, 3, 3, 3));
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
        this.setForegroundColor("var(--ts-ui-text-color, black)");

        this.updateHeight();
        ThemeManager.onThemeChange(() => this.updateHeight());

        Event.addListener(this, "input", this.onInput);
    }

    /**
     * Recalculates preferred and maximum height from the native input's measured size.
     *
     * Called at construction time and after each theme change so that font-size
     * adjustments propagate to the layout hint automatically.
     */
    private updateHeight(): void {
        const h = Util.measureInputHeight();

        this.setPreferredSize(200, h);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, h);
    }

    /**
     * Cleanup hook; currently a no-op placeholder.
     */
    destructor() {
        //Util.removeListener("input", this.onInput);
    }

    /**
     * Syncs the text content from the DOM element's value on every input event.
     */
    onInput() {
        let element = this.getElement();
        this.setText(element.value);
    }

    /**
     * Registers a listener for the 'input' event, fired on every keystroke.
     *
     * @param listener - The callback to invoke on each input event.
     */
    addActionListener(listener: Function) {
        Event.addListener(this, "input", listener);
    }

    setValue(value: string): void {
        this.setText(value);
    }

    getValue(): string {
        return String(this.getText());
    }

    addBindingListener(fn: () => void): void {
        this.addActionListener(fn);
    }

    /**
     * Renders the input element with type="text".
     *
     * @returns The created input element with its type attribute set to "text".
     */
    render() {
        let element = super.render();

        element.setAttribute("type", "text");

        return element;
    }
}
