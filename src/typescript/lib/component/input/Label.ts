// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Text, TextOptions } from "~/component/input/Text.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link Label}.
 *
 * @category Components
 */
export interface LabelOptions extends TextOptions {
}

/**
 * A label component backed by a `<label>` element.
 *
 * Always associated with a form control via the HTML `for` attribute.
 * For standalone text without a form-control association, use {@link Text} instead.
 *
 * @example
 * ```typescript
 * import { Label, TextField } from '@jimka/typescript-ui/component/input';
*
 * const field = new TextField();
 * const label = new Label('Name:', field.getId());
 * panel.addComponent(label);
 * panel.addComponent(field);
 * ```
 *
 * @category Components
 */
class Label extends Text {

    forId: string;

    constructor(text: string, forId: string, options?: LabelOptions) {
        if (!forId) {
            throw new Error("Label requires a non-empty forId. Use Text for standalone text.");
        }

        super(text, { tag: "label" });

        this.forId = forId;

        if (options) {
            this.applyOptions(options);
        }
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
     * @param id - The ID of the form control this label should be associated with. Must be non-empty.
     *
     * @returns This component, for method chaining.
     */
    public setForId(id : string): this {
        if (!id) {
            throw new Error("Label forId must be non-empty.");
        }

        this.forId = id;

        let element = this.getElement() as HTMLLabelElement;
        if (!element) {
            return this;
        }

        element.htmlFor = id;

        return this;
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

const LabelCallable = callable(Label);
type LabelCallable = Label;
export {
    Label         as _Label,
    LabelCallable as Label
};
