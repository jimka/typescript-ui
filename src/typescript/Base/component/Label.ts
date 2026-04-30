// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Text } from "./Text.js";

/**
 * A label component backed by a `<label>` element.
 *
 * Supports the HTML `for` attribute to associate the label with a form control by ID.
 */
export class Label extends Text {

    forId: string;

    constructor(text? : string, forId : string = "") {
        super("label", text);

        this.forId = forId;
    }

    /**
     * Returns the ID of the form element this label is associated with.
     *
     * @returns The value of the HTML `for` attribute.
     */
    public getForId() : string {
        return this.forId;
    }

    /**
     * Sets the for/htmlFor association and updates the DOM element.
     *
     * @param id - The ID of the form control this label should be associated with.
     */
    public setForId(id : string) {
        this.forId = id;

        let element = this.getElement() as HTMLLabelElement;
        if (!element) {
            return;
        }

        element.htmlFor = id;
    }

    /**
     * Renders the label element and sets its htmlFor attribute.
     *
     * @returns The created HTMLLabelElement with htmlFor initialised.
     */
    protected render() {
        let element = <HTMLLabelElement>super.render();

        element.htmlFor = this.forId;

        return element;
    }
}