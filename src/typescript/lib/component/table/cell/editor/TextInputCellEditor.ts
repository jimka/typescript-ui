// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "~/component/table/cell/editor/CellEditor.js";

/**
 * Base class for cell editors backed by a native `<input>` element.
 *
 * Owns the typed setters for the three input attributes that every
 * bare-input editor needs to declare its identity — `type`, `inputmode`,
 * and `autocomplete`. Subclasses call these from their constructor instead
 * of routing through {@link Component.setAttribute} directly, which keeps
 * the rule that behaviour-affecting attributes never reach the string-keyed
 * setAttribute API at the call site.
 *
 * Cannot reuse `Input`'s typed setters because [`CellEditor`](/api/component/table/classes/CellEditor)
 * extends [`Component`](/api/core/classes/Component) (not `Input`):
 * `Input` carries form-submission `name` plumbing and a default font CSS
 * rule that cell editors do not need, and most non-text editors prefer a
 * `<div>` root.
 *
 * @category Components
 */
export abstract class TextInputCellEditor<T> extends CellEditor<T> {

    constructor() {
        super("input");
    }

    /**
     * Sets the HTML `type` attribute on the underlying input element. Called
     * once from a subclass constructor to declare the editor's input shape.
     *
     * @param value - The input type (e.g. `"text"`, `"number"`).
     *
     * @returns This component, for method chaining.
     */
    protected setType(value: string): this {
        this.setAttribute("type", value);

        return this;
    }

    /**
     * Sets the HTML `inputmode` attribute, which controls the on-screen
     * keyboard surface on mobile. Cell editors typically pass `"none"` so
     * the virtual keyboard does not pop while a picker dropdown is open.
     *
     * @param value - A valid `inputmode` value.
     *
     * @returns This component, for method chaining.
     */
    protected setInputMode(value: string): this {
        this.setAttribute("inputmode", value);

        return this;
    }

    /**
     * Sets the HTML `autocomplete` attribute, which controls browser
     * autofill. Cell editors typically pass `"off"` to keep autofill
     * suggestions from interfering with the picker dropdown.
     *
     * @param value - A valid `autocomplete` token.
     *
     * @returns This component, for method chaining.
     */
    protected setAutoComplete(value: string): this {
        this.setAttribute("autocomplete", value);

        return this;
    }
}
