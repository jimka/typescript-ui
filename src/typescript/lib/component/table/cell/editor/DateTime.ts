// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextInputCellEditor } from "~/component/table/cell/editor/TextInputCellEditor.js";
import { Event } from "~/core/Event.js";
import { LayerManager } from "~/core/LayerManager.js";
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
class DateTimeEditor extends TextInputCellEditor<Date | null> {

    private _showSeconds: boolean;
    private _value:       Date | null = null;
    private _dropdown:    DateTimePickerDropdown | null = null;
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

        Event.addListener(this, "focus", ()             => this.openDropdown());
        Event.addListener(this, "blur",  (e: FocusEvent) => this.onEditorBlur(e));
        Event.addListener(this, "input", ()             => this.onInput());

        this.setType("text");
        this.setInputMode("none");
        this.setAutoComplete("off");
    }

    /**
     * Keeps the edit alive while focus moves from the editor input into the
     * picker dropdown — including the embedded time field and its own popped
     * time-picker layer. Without this, focusing the embedded field would blur
     * the editor and the {@link CellEditorPool} would commit + tear down the
     * dropdown mid-interaction.
     *
     * @param relatedTarget - The node receiving focus, or null.
     * @returns True when focus landed inside the dropdown's layer tree.
     */
    retainsFocus(relatedTarget: Node | null): boolean {
        return this._dropdown !== null
            && this._dropdown.isOpen()
            && LayerManager.containsAcrossLayers(this._dropdown, relatedTarget);
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
     * Opens the picker dropdown anchored to the input element. The dropdown's
     * own `"click-outside"` mode (driven by
     * [`LayerManager`](/api/core/namespaces/LayerManager)) commits the edit
     * when a pointerdown lands outside the editing surface — including when
     * focus has moved into the embedded time field — via the close thunk
     * installed here.
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

        // The manager dismisses the dropdown on an outside click; route that
        // through the editor so it also commits. The editor input is excluded
        // as the anchor so opening the editor doesn't immediately dismiss.
        dropdown.setCloseHandler(() => this.onOutsideDismiss());
        dropdown.setAnchorElement(el);

        dropdown.showAt(el, this._value);
    }

    /**
     * Hides the picker dropdown if it is currently open.
     */
    private closeDropdown(): void {
        if (this._dropdown?.isOpen()) {
            this._dropdown.hideAnimated();
        }
    }

    /**
     * Closes the dropdown and commits the edit when the manager reports an
     * outside click. This is the path the editor's blur-commit can no longer
     * cover once focus sits in the embedded time field rather than the
     * editor's own input.
     */
    private onOutsideDismiss(): void {
        this.closeDropdown();
        this.requestCommit();
    }

    /**
     * Closes the dropdown when the editor input blurs — unless focus moved into
     * the picker surface (the embedded time field or its time-picker layer), in
     * which case the edit stays open. The {@link CellEditorPool}'s blur-commit
     * is suppressed for the same case via {@link retainsFocus}.
     *
     * @param e - The blur event.
     */
    private onEditorBlur(e: FocusEvent): void {
        if (this.retainsFocus(e.relatedTarget as Node | null)) {
            return;
        }

        this.closeDropdown();
    }

    /**
     * Updates the cached value from a typed text edit. The display format is
     * "YYYY-MM-DD HH:MM[:SS]" with a space separator; `Date.parse` only
     * accepts ISO-8601 reliably with a `T`, so we re-introduce it before
     * parsing.
     */
    private onInput(): void {
        this.syncTextFromDom();
        const raw = this.getText();

        if (!raw) {
            this._value = null;
            return;
        }

        const d = new Date(raw.replace(' ', 'T'));
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
            return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
        }
        return `${y}-${mo}-${d} ${h}:${mi}`;
    }
}

const DateTimeEditorCallable = callable(DateTimeEditor);
type DateTimeEditorCallable = DateTimeEditor;
export {
    DateTimeEditor         as _DateTimeEditor,
    DateTimeEditorCallable as DateTimeEditor
};
