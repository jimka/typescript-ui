// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Input } from "./Input.js";

/**
 * Base class for single-line and multi-line text input components.
 *
 * Tracks the current text value and text-align internally and exposes text selection support.
 */
export class TextInput extends Input {

    private text: String = "";
    private textAlign: string | null = null;

    constructor(tag: string = "input") {
        super(tag);
    }

    /**
     * Returns the current CSS text-align value.
     *
     * @returns The CSS text-align string, or null if not set.
     */
    getTextAlign() {
        return this.textAlign;
    }

    /**
     * Sets the CSS text-align and updates the component's CSS rule.
     *
     * @param align - A CSS text-align value (e.g. "left", "center", "right").
     */
    setTextAlign(align: string) {
        this.textAlign = align;

        this.setElementCSSRule("textAlign", align);
    }

    /**
     * Returns the current text value.
     *
     * @returns The current text string.
     */
    getText(): String {
        return this.text;
    }

    /**
     * Sets the text value and updates the DOM element's value property.
     *
     * @param text - The new text value.
     */
    setText(text: String) {
        this.text = text || "";

        let element = this.getElement();
        if (!element) {
            return;
        }

        element.value = this.text.valueOf();
    }

    /**
     * Selects a range of text in the input; defaults to selecting all if start/end are omitted.
     *
     * @param start - Optional. The start index of the selection. Defaults to 0.
     * @param end - Optional. The end index of the selection. Defaults to the text length + 1.
     */
    select(start?: number, end?: number) {
        let element = this.getElement();
        if (!element) {
            return;
        }

        if (!start || start < 0) {
            start = 0;
        }

        if (!end || end > this.text.length) {
            end = this.text.length + 1;
        }

        element.setSelectionRange(start, end);
    }

    /**
     * Applies base input styles and writes text-align to the CSS rule.
     *
     * @param element - The HTMLElement to apply styles to.
     */
    applyStyle(element: HTMLElement) {
        super.applyStyle(element);

        let rule = this.getCSSRule();
        rule.style.textAlign = this.textAlign ? this.textAlign : "";
    }

    /**
     * Renders the input element and sets its initial value.
     *
     * @returns The created input element with its value initialised.
     */
    protected render() {
        let element = super.render();

        element.value = this.text.valueOf();

        return element;
    }
}
