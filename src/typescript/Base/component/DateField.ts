// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Input } from "./Input.js";
import { Util } from "../Util.js";
import { Event } from "../Event.js";
import { Insets } from "../Insets.js";
import { Bindable } from "../Bindable.js";
import { ThemeManager } from "../Theme.js";

/**
 * A date-picker input component backed by an `<input type="date">` element.
 *
 * Implements {@link Bindable} so it can participate in a {@link Binding} directly.
 * Returns `null` from `getValue` when the field is empty.
 *
 * @category Components
 */
export class DateField extends Input implements Bindable<Date | null> {

    private _value: Date | null = null;

    constructor() {
        super();

        this.setCursor("text");
        this.setPadding(new Insets(3, 3, 3, 3));
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
        this.setForegroundColor("var(--ts-ui-text-color, black)");

        this.updateHeight();
        ThemeManager.onThemeChange(() => this.updateHeight());

        Event.addListener(this, "input", this.onInput);
    }

    /**
     * Recalculates preferred and maximum height from the native input's measured size.
     *
     * Called at construction time and after each theme change so that font-size
     * adjustments propagate to the layout hint automatically.
     */
    private updateHeight(): void {
        const h = Util.measureInputHeight();

        this.setPreferredSize(140, h);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, h);
    }

    /**
     * Syncs the internal Date value from the DOM element on every input event.
     */
    private onInput(): void {
        const element = this.getElement();
        const raw = element.value;

        if (!raw) {
            this._value = null;
            return;
        }

        // "YYYY-MM-DD" — append local midnight to avoid UTC offset shifting the day.
        this._value = new Date(raw + "T00:00:00");
    }

    /**
     * Registers a listener for the 'input' event, fired whenever the date changes.
     *
     * @param listener - The callback to invoke on each input event.
     */
    addActionListener(listener: Function): void {
        Event.addListener(this, "input", listener);
    }

    /**
     * Sets the field value from a Date and updates the DOM element.
     *
     * @param value - The Date to display, or null to clear the field.
     */
    setValue(value: Date | null): void {
        this._value = value;

        const element = this.getElement();

        if (!element) {
            return;
        }

        element.value = value ? this.formatDate(value) : "";
    }

    /**
     * Returns the currently selected Date, or null if the field is empty.
     *
     * @returns The selected Date, or null.
     */
    getValue(): Date | null {
        return this._value;
    }

    /**
     * Registers a listener that fires on each user-driven date change.
     *
     * @param fn - The callback to invoke on change.
     */
    addBindingListener(fn: () => void): void {
        this.addActionListener(fn);
    }

    /**
     * Formats a Date as a YYYY-MM-DD string for use as an input value.
     *
     * @param date - The Date to format.
     * @returns A "YYYY-MM-DD" string.
     */
    private formatDate(date: Date): string {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");

        return `${y}-${m}-${d}`;
    }

    /**
     * Renders the input element with type="date" and restores any stored value.
     *
     * @returns The created input element.
     */
    protected render(): HTMLInputElement & HTMLTextAreaElement {
        const element = super.render();

        element.setAttribute("type", "date");
        element.value = this._value ? this.formatDate(this._value) : "";

        return element;
    }
}
