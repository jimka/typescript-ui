// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "~/component/table/cell/editor/CellEditor.js";
import { TextField } from "~/component/input/TextField.js";
import { TextInput } from "~/component/input/TextInput.js";
import { AnchorType } from "~/layout/AnchorType.js";
import { Event } from "~/core/Event.js";
import { callable } from "~/core/Callable.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";

const NUMBER_EDITOR_TEXT_ALIGN = "right";

/**
 * The inner text field of a {@link NumberEditor} — right-aligned by
 * convention, so the alignment is a class default shared by every editor in
 * the app rather than an imperative per-instance write. The `font` bag spreads
 * `TextInput`'s own and overrides only `textAlign`; the hierarchy walk is a
 * shallow merge, so declaring `textAlign` alone would replace the inherited
 * font bag wholesale.
 */
class NumberEditorField extends TextField {
    protected static readonly ownClassStyleDefaults: StyleBag = {
        font: { ...TextInput.ownClassStyleDefaults.font, textAlign: NUMBER_EDITOR_TEXT_ALIGN },
    };
}

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

    private _textField: TextField     = new NumberEditorField();
    private _value:     Number | null = null;

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

        this.setMaxSize({ width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER });
        // The inner field's max is unpinned too, matching StringEditor: the
        // field has to fill the cell, and a TextField otherwise pins its max to
        // its own one-line box.
        this._textField.setMaxSize({ width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER });
        this._textField.clearPadding();
        this.setBorderRadius("0");
        this._textField.setBorder({ border: "0px solid transparent" });
        this._textField.setShadow('inset 0 0 0 1px var(--ts-ui-table-cell-editor-border, rgba(30, 100, 200, 0.6))');
        this._textField.setOutline('none');
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
