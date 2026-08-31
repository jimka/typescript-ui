// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "~/component/table/cell/editor/CellEditor.js";
import { TextField } from "~/component/input/TextField.js";
import { Event } from "~/core/Event.js";
import { callable } from "~/core/Callable.js";

/**
 * An in-place editor for string cell values.
 *
 * Wraps a {@link TextField} and proxies blur and keydown events up to the parent
 * cell so the standard commit/cancel lifecycle works. Caches the typed
 * text on each input event; an empty field commits as `null`, mirroring
 * the cell-stack convention that "no value" is `null` and not `""`.
 *
 * @category Components
 */
class StringEditor extends CellEditor<String | null> {

    private _textField: TextField     = new TextField();
    private _value:     String | null = null;

    constructor() {
        super();

        // Internal cell-editor wiring: listens on a privately-owned child;
        // see the cell-editor carve-out in ARCHITECTURE.md.
        Event.addListener(this._textField, "blur", (evnt: UIEvent) => {
            Event.fireEvent(this, "blur", evnt);
        });
        Event.addListener(this._textField, "keydown", (evnt: KeyboardEvent) => {
            Event.fireEvent(this, "keydown", { detail: {
                key     : evnt.key     , code   : evnt.code   , keyCode: evnt.keyCode,
                shiftKey: evnt.shiftKey, ctrlKey: evnt.ctrlKey,
                altKey  : evnt.altKey  , metaKey: evnt.metaKey
            } });

            // Tab and PageUp/PageDown must not run their native default:
            // the parent cell's own navigate handler already moves editing
            // to the neighboring cell or page (driven by the re-fired
            // "keydown" above), so this listener — the real keydown target
            // — is the one place that can actually suppress the browser's
            // default behaviour for these keys.
            if (evnt.keyCode === 9 || evnt.keyCode === 33 || evnt.keyCode === 34) {
                return { prevent: true };
            }

            return;
        });
        Event.addListener(this._textField, "input", () => this.onInput());

        this._textField.setMaxSize({ width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER });
        this._textField.clearPadding();
        this._textField.setBorderRadius('0');
        this._textField.setBorder({ border: "0px solid transparent" });
        this._textField.setShadow('inset 0 0 0 1px var(--ts-ui-table-cell-editor-border, rgba(30, 100, 200, 0.6))');
        this._textField.setOutline('none');
        this._textField.setText("");
        this.addComponent(this._textField);
    }

    /**
     * Returns the cached string value, or `null` when the field is
     * empty. The distinction between a typed `""` and `null` is
     * intentionally dropped — empty input is empty input.
     *
     * @returns The current string value, or `null`.
     */
    getValue(): String | null {
        return this._value;
    }

    /**
     * Populates the text field and caches the value. `null` and
     * `undefined` populate an empty field.
     *
     * @param value - The string value to set in the text field, or
     *   `null`/`undefined` to leave the field empty.
     */
    setValue(value: String | null): this {
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
     * Reads the live text field content into the cached value. An
     * empty string becomes `null`.
     */
    private onInput(): void {
        const raw = this._textField.getText();
        this._value = raw ? raw : null;
    }
}

const StringEditorCallable = callable(StringEditor);
type StringEditorCallable = StringEditor;
export {
    StringEditor         as _StringEditor,
    StringEditorCallable as StringEditor
};
