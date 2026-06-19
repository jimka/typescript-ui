// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "~/component/table/cell/editor/CellEditor.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";

/**
 * Base class for cell editors backed by a native `<input>` element.
 *
 * Owns the typed setters for the three input attributes that every
 * bare-input editor needs to declare its identity — `type`, `inputmode`,
 * and `autocomplete`. Subclasses call these from their constructor instead
 * of routing through `Component.setElementAttribute` directly, which keeps
 * the rule that behaviour-affecting attributes never reach the string-keyed
 * attribute API at the call site.
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

    private _type:         string | null = null;
    private _inputMode:    string | null = null;
    private _autoComplete: string | null = null;

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
        this._type = value;
        this.setElementAttribute("type", value);

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
        this._inputMode = value;
        this.setElementAttribute("inputmode", value);

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
        this._autoComplete = value;
        this.setElementAttribute("autocomplete", value);

        return this;
    }

    protected init(element?: Handle): this {
        super.init(element);

        const el = element || this.getElement()!;

        if (this._type !== null) {
            DOM.sink.apply(el, { setAttr: { "type": this._type } });
        }

        if (this._inputMode !== null) {
            DOM.sink.apply(el, { setAttr: { "inputmode": this._inputMode } });
        }

        if (this._autoComplete !== null) {
            DOM.sink.apply(el, { setAttr: { "autocomplete": this._autoComplete } });
        }

        return this;
    }
}
