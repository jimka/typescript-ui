// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextInputCellEditor } from "~/component/table/cell/editor/TextInputCellEditor.js";
import { Event } from "~/core/Event.js";
import { TimePickerDropdown } from "~/component/input/TimePickerDropdown.js";
import { callable } from "~/core/Callable.js";

/**
 * An in-place editor for time cell values.
 *
 * Renders a focusable text input and pops a
 * [`TimePickerDropdown`](/api/component/input/classes/TimePickerDropdown)
 * (the same class used by [`TimeField`](/api/component/input/classes/TimeField))
 * on focus. The dropdown suppresses focus loss on `pointerdown` so the
 * [`CellEditorPool`](/api/component/table/classes/CellEditorPool)'s blur-to-commit
 * path is not invoked prematurely.
 *
 * The value is represented as a `Date` whose time portion is meaningful; the
 * date portion is normalised to 1970-01-01 local.
 *
 * @category Components
 */
class TimeEditor extends TextInputCellEditor<Date | null> {

    private _showSeconds: boolean;
    private _value:       Date | null = null;
    private _dropdown:    TimePickerDropdown | null = null;
    private _animated:    boolean = true;
    private _text:        string = "";

    constructor(showSeconds: boolean = false) {
        super();
        this._showSeconds = showSeconds;

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
    private ensureDropdown(): TimePickerDropdown {
        if (!this._dropdown) {
            this._dropdown = new TimePickerDropdown(
                (h: number, m: number, s: number) => this.onTimeSelected(h, m, s),
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

        const parts = raw.split(':').map(Number);
        if (parts.some(isNaN)) {
            this._value = null;
            return;
        }
        this._value = new Date(1970, 0, 1, parts[0], parts[1] ?? 0, parts[2] ?? 0);
    }

    /**
     * Called when the user picks a time in the dropdown. Updates the value
     * and re-renders the formatted text but does NOT hide the dropdown — the
     * user typically tweaks the minute after picking the hour. The
     * [`CellEditorPool`](/api/component/table/classes/CellEditorPool) commits when
     * focus eventually leaves the editor (e.g. Tab, Enter, click-outside).
     *
     * @param hours - The chosen hour (0-23).
     * @param minutes - The chosen minute (0-59).
     * @param seconds - The chosen second (0-59). Always 0 when `showSeconds` is false.
     */
    private onTimeSelected(hours: number, minutes: number, seconds: number): void {
        const d = new Date(1970, 0, 1, hours, minutes, seconds, 0);
        this.setValue(d);
    }

    private toInputString(date: Date): string {
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        if (this._showSeconds) {
            const s = String(date.getSeconds()).padStart(2, '0');
            return `${h}:${m}:${s}`;
        }
        return `${h}:${m}`;
    }
}

const TimeEditorCallable = callable(TimeEditor);
type TimeEditorCallable = TimeEditor;
export {
    TimeEditor         as _TimeEditor,
    TimeEditorCallable as TimeEditor
};
