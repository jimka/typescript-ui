// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextInputCellEditor } from "~/component/table/cell/editor/TextInputCellEditor.js";
import { Event } from "~/core/Event.js";
import { DOM } from "~/core/DOM.js";
import { DatePickerDropdown } from "~/component/input/DatePickerDropdown.js";
import { callable } from "~/core/Callable.js";

/**
 * An in-place editor for date cell values.
 *
 * Renders a focusable `<input type="text" inputmode="none">` element and
 * pops a [`DatePickerDropdown`](/api/component/input/classes/DatePickerDropdown)
 * (the same class used by the form-field
 * [`DateField`](/api/component/input/classes/DateField)) on focus. The
 * dropdown's row `pointerdown` handler calls `preventDefault()` so the input
 * keeps focus while the user clicks a day — preserving the
 * [`CellEditorPool`](/api/component/table/classes/CellEditorPool)'s
 * blur-to-commit contract without modifying the pool.
 *
 * @category Components
 */
class DateEditor extends TextInputCellEditor<Date | null> {

    private _value:    Date | null = null;
    private _dropdown: DatePickerDropdown | null = null;
    private _animated: boolean = true;
    private _text:     string = "";

    constructor() {
        super();

        this.setMaxSize(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
        this.setBorderRadius('0');
        this.setBorder({ border: "0px solid transparent" });
        this.setShadow('inset 0 0 0 1px var(--ts-ui-table-cell-editor-border, rgba(30, 100, 200, 0.6))');
        this.setOutline('none');

        Event.addListener(this, "focus", () => this.openDropdown());
        Event.addListener(this, "blur",  () => this.closeDropdown());
        Event.addListener(this, "input", () => this.onInput());

        this.setType("text");
        this.setInputMode("none");
        this.setAutoComplete("off");
    }

    /**
     * Returns whether the input is empty (no typed text, no committed value).
     *
     * @returns true when both the rendered text and the cached value are empty.
     */
    isEmpty(): boolean {
        return !this.getText() && this._value === null;
    }

    /**
     * Returns the currently committed `Date`, or null when the field is empty
     * or contains an unparseable value.
     */
    getValue(): Date | null {
        return this._value;
    }

    /**
     * Sets the field value and renders the formatted string in the input.
     *
     * @param value - The Date to display, or null to clear the field.
     */
    setValue(value: Date | null): this {
        this._value = value;
        this.setText(value ? this.toInputString(value) : "");

        return this;
    }

    /**
     * Writes `text` into the underlying `<input>` element's value through a
     * typed setter so call sites never touch `element.value` directly.
     *
     * @param text - The string to render in the input.
     */
    private setText(text: string): this {
        this._text = text;

        const el = this.getElement();
        if (el) {
            DOM.sink.setValue(el, text);
        }

        return this;
    }

    /**
     * Returns the cached input text. Stays in sync via {@link syncTextFromDom}
     * which is called from the input listener before `onInput`.
     */
    private getText(): string {
        return this._text;
    }

    /**
     * Reads the live value from the `<input>` element into the text cache.
     * Confines the raw `element.value` read to a single typed helper so
     * `onInput` can work off {@link getText}.
     */
    private syncTextFromDom(): void {
        const el = this.getElement();
        this._text = el ? DOM.source.getValue(el) : "";
    }

    /**
     * Enables or disables the fade animation on the dropdown.
     *
     * @param value - true to fade, false for instant open/close.
     */
    setDropdownAnimated(value: boolean): this {
        this._animated = value;

        if (this._dropdown) {
            this._dropdown.setAnimated(value);
        }

        return this;
    }

    /**
     * Returns whether the dropdown fade is enabled.
     *
     * @returns true when the dropdown fades; false when it opens/closes instantly.
     */
    isDropdownAnimated(): boolean {
        return this._animated;
    }

    /**
     * Returns or lazily creates the picker dropdown.
     */
    private ensureDropdown(): DatePickerDropdown {
        if (!this._dropdown) {
            this._dropdown = new DatePickerDropdown(date => this.onDateSelected(date));
            this._dropdown.setAnimated(this._animated);
        }

        return this._dropdown;
    }

    /**
     * Opens the picker dropdown anchored to the input element.
     */
    private openDropdown(): void {
        const dropdown = this.ensureDropdown();
        if (dropdown.isOpen()) {
            return;
        }

        const el = this.getElement();
        if (!el) {
            return;
        }

        dropdown.showAt(el, this._value);
    }

    /**
     * Hides the picker dropdown if it is currently open. Called when the
     * editor's input element loses focus (the cell exits edit mode).
     */
    private closeDropdown(): void {
        if (this._dropdown?.isOpen()) {
            this._dropdown.hideAnimated();
        }
    }

    /**
     * Updates the cached value from a typed text edit.
     */
    private onInput(): void {
        this.syncTextFromDom();
        const raw = this.getText();

        if (!raw) {
            this._value = null;
            return;
        }

        const d = new Date(raw + 'T00:00:00');
        this._value = isNaN(d.getTime()) ? null : d;
    }

    /**
     * Called when the user picks a day in the dropdown. Sets the value,
     * hides the dropdown, and fires the editor's blur to drive
     * `CellEditorPool`'s commit path.
     */
    private onDateSelected(date: Date): void {
        this.setValue(date);
        this._dropdown?.hideAnimated();

        const el = this.getElement();

        if (el) {
            DOM.sink.blur(el);
        }
    }

    private toInputString(date: Date): string {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
}

const DateEditorCallable = callable(DateEditor);
type DateEditorCallable = DateEditor;
export {
    DateEditor         as _DateEditor,
    DateEditorCallable as DateEditor
};
