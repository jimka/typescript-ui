// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "~/component/table/cell/editor/CellEditor.js";
import { TextField } from "~/component/input/TextField.js";
import { AnchorType } from "~/layout/AnchorType.js";
import { Event } from "~/core/Event.js";
import { callable } from "~/core/Callable.js";

/**
 * An in-place editor for numeric cell values.
 *
 * Wraps a right-aligned {@link TextField} and proxies blur and keydown events
 * up to the parent cell so the standard commit/cancel lifecycle works.
 * Caches the parsed numeric value on each input event so an empty or
 * unparseable field commits as `null` rather than silently coercing to
 * `0` or `NaN`.
 *
 * @category Components
 */
class NumberEditor extends CellEditor<Number | null> {

    private _textField: TextField     = new TextField();
    private _value:     Number | null = null;

    constructor() {
        super();

        Event.addListener(this._textField, "blur", (evnt: UIEvent) => {
            Event.fireEvent(this, "blur", evnt);
        });
        Event.addListener(this._textField, "keydown", (evnt: KeyboardEvent) => {
            Event.fireEvent(this, "keydown", { detail: {
                key     : evnt.key     , code   : evnt.code   , keyCode: evnt.keyCode,
                shiftKey: evnt.shiftKey, ctrlKey: evnt.ctrlKey,
                altKey  : evnt.altKey  , metaKey: evnt.metaKey
            } });
        });
        Event.addListener(this._textField, "input", () => this.onInput());

        this.setMaxSize(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
        this._textField.clearPadding();
        this.setBorderRadius("0");
        this._textField.setBorder({ border: "0px solid transparent" });
        this._textField.setShadow('inset 0 0 0 1px var(--ts-ui-table-cell-editor-border, rgba(30, 100, 200, 0.6))');
        this._textField.setOutline('none');
        this._textField.setTextAlign("right");
        this._textField.setText("");

        this.addComponent(this._textField, {
            anchor: AnchorType.NORTHEAST
        });
    }

    /**
     * Returns the cached numeric value, or `null` when the field is
     * empty or contains unparseable text. Reads the private cache
     * rather than re-parsing the text on demand so an empty field
     * commits as `null` instead of `0`, and unparseable text commits
     * as `null` instead of `NaN`.
     *
     * @returns The parsed numeric value, or `null`.
     */
    getValue(): Number | null {
        return this._value;
    }

    /**
     * Populates the text field with the number as a string and caches
     * the value. `null` and `undefined` populate an empty field so the
     * user sees a blank input on first edit instead of the literal
     * text `"undefined"` / `"null"`.
     *
     * @param value - The numeric value to set in the text field, or
     *   `null`/`undefined` to leave the field empty.
     */
    setValue(value: Number | null): this {
        this._value = value ?? null;
        this._textField.setText(this._value === null ? "" : String(this._value));

        return this;
    }

    /**
     * Focuses the text field and selects all its content.
     *
     * @param preventScroll - Forwarded to the field's focus so a native
     *   focus-scroll doesn't desync the table body's own scroll model.
     * @returns This component, for method chaining.
     */
    focus(preventScroll: boolean = false): this {
        this._textField.focus(preventScroll);
        this._textField.select();

        return this;
    }

    /**
     * Parses the live text field content into the cached value. An
     * empty string or unparseable text becomes `null`; otherwise the
     * cached value is the numeric `Number(raw)`.
     */
    private onInput(): void {
        const raw = this._textField.getText();

        if (!raw) {
            this._value = null;

            return;
        }

        const n = Number(raw);
        this._value = isNaN(n) ? null : n;
    }
}

const NumberEditorCallable = callable(NumberEditor);
type NumberEditorCallable = NumberEditor;
export {
    NumberEditor         as _NumberEditor,
    NumberEditorCallable as NumberEditor
};
