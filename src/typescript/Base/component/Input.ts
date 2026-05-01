// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";

/**
 * Base class for input elements (`<input>` and `<textarea>`).
 *
 * Sets a white background by default and applies a sans-serif 12px font via the CSS rule.
 */
export class Input extends Component {

    constructor(tag: string = "input") {
        super(tag);

        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");
    }

    /**
     * Returns the DOM element cast to HTMLInputElement & HTMLTextAreaElement.
     *
     * @param createIfMissing - Optional. When true, renders the element if it does not yet exist.
     *
     * @returns The component's element typed as both HTMLInputElement and HTMLTextAreaElement.
     */
    getElement(createIfMissing: boolean = false) {
        return super.getElement(createIfMissing) as HTMLInputElement & HTMLTextAreaElement;
    }

    /**
     * Applies base styles and sets a default sans-serif 12px font on the CSS rule.
     *
     * @param element - The HTMLElement to apply styles to.
     */
    applyStyle(element: HTMLElement) {
        super.applyStyle(element);

        let rule = this.getCSSRule();
        rule.style.fontFamily = "var(--ts-ui-font-family, sans-serif)";
        rule.style.fontSize   = "var(--ts-ui-font-size, 12px)";
    }

    /**
     * Renders the input element cast to HTMLInputElement & HTMLTextAreaElement.
     *
     * @returns The created element typed as both HTMLInputElement and HTMLTextAreaElement.
     */
    protected render() {
        return super.render() as HTMLInputElement & HTMLTextAreaElement;
    }
}
