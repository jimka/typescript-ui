// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellEditor } from "~/component/table/cell/editor/CellEditor.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { Event } from "~/core/Event.js";
import { DateTimePickerDropdown } from "~/component/input/DateTimePickerDropdown.js";
import { callable } from "~/core/Callable.js";

/**
 * An in-place editor for date-time cell values.
 *
 * Renders a focusable text input and pops a
 * [`DateTimePickerDropdown`](/api/component/input/classes/DateTimePickerDropdown)
 * (the same class used by [`DateTimeField`](/api/component/input/classes/DateTimeField))
 * on focus. The dropdown suppresses focus loss via `pointerdown`
 * preventDefault so the
 * [`CellEditorPool`](/api/component/table/classes/CellEditorPool)'s blur-to-commit
 * path is not invoked prematurely.
 *
 * @category Components
 */
class DateTimeEditor extends CellEditor<Date | null> {

    private _showSeconds: boolean;
    private _value:       Date | null = null;
    private _dropdown:    DateTimePickerDropdown | null = null;
    private _animated:    boolean = true;
    private _text:        string = "";

    constructor(showSeconds: boolean = false) {
        super("input");
        this._showSeconds = showSeconds;

        this.setMaxSize(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
        this.setBorderRadius('0');
        this.setBorder({ style: BorderStyle.SOLID, width: 0, color: 'transparent' });
        this.setShadow('inset 0 0 0 1px var(--ts-ui-table-cell-editor-border, rgba(30, 100, 200, 0.6))');
        this.setOutline('none');

        Event.addListener(this, "focus", () => this.openDropdown());
        Event.addListener(this, "blur",  () => this.closeDropdown());
        Event.addListener(this, "input", () => this.onInput());
    }

    applyStyle(element: HTMLElement): this {
        super.applyStyle(element);
        element.setAttribute('type', 'text');
        element.setAttribute('inputmode', 'none');
        element.setAttribute('autocomplete', 'off');

        return this;
    }

    /**
     * Returns whether the input is empty.
     *
     * @returns true when both the rendered text and the cached value are empty.
     */
    isEmpty(): boolean {
        return !this.getText() && this._value === null;
    }

    /**
     * Returns the currently committed `Date`, or null.
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

        const el = this.getElement() as HTMLInputElement | null;
        if (el) {
            el.value = text;
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
        const el = this.getElement() as HTMLInputElement | null;
        this._text = el?.value ?? "";
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
    private ensureDropdown(): DateTimePickerDropdown {
        if (!this._dropdown) {
            this._dropdown = new DateTimePickerDropdown(
                date => this.onDateTimeSelected(date),
                { showSeconds: this._showSeconds },
            );
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

        const d = new Date(raw);
        this._value = isNaN(d.getTime()) ? null : d;
    }

    /**
     * Called when the user picks a date+time in the dropdown.
     *
     * @param date - The chosen Date.
     */
    private onDateTimeSelected(date: Date): void {
        this.setValue(date);
    }

    private toInputString(date: Date): string {
        const y  = date.getFullYear();
        const mo = String(date.getMonth() + 1).padStart(2, '0');
        const d  = String(date.getDate()).padStart(2, '0');
        const h  = String(date.getHours()).padStart(2, '0');
        const mi = String(date.getMinutes()).padStart(2, '0');
        if (this._showSeconds) {
            const s = String(date.getSeconds()).padStart(2, '0');
            return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
        }
        return `${y}-${mo}-${d}T${h}:${mi}`;
    }
}

const DateTimeEditorCallable = callable(DateTimeEditor);
type DateTimeEditorCallable = DateTimeEditor;
export {
    DateTimeEditor         as _DateTimeEditor,
    DateTimeEditorCallable as DateTimeEditor
};
