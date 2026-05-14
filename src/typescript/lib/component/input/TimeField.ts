// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Input, InputOptions } from "~/component/input/Input.js";
import { Util } from "~/core/Util.js";
import { Event } from "~/core/Event.js";
import { Insets } from "~/primitive/Insets.js";
import { Bindable } from "~/core/Bindable.js";
import { ThemeManager } from "~/core/Theme.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link TimeField}.
 *
 * @category Components
 */
export interface TimeFieldOptions extends InputOptions {
    value?:   Date | null;
    enabled?: boolean;
}

/**
 * A time-picker input component backed by an `<input type="time">` element.
 *
 * Implements {@link Bindable} so it can participate in a {@link Binding} directly.
 * The Date value uses the local date for its date portion; only hours and minutes
 * are meaningful. Returns `null` from `getValue` when the field is empty.
 *
 * @category Components
 */
class TimeField extends Input implements Bindable<Date | null> {

    private _value: Date | null = null;

    constructor(options?: TimeFieldOptions) {
        super();

        this.setCursor("text");
        this.setPadding(new Insets(3, 3, 3, 3));
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");
        this.setForegroundColor("var(--ts-ui-text-color, black)");

        this.updateHeight();
        ThemeManager.onThemeChange(() => this.updateHeight());

        Event.addListener(this, "input", this.onInput);

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link TimeFieldOptions} bag, dispatching the initial value and
     * enabled/disabled state after inherited Input/Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TimeFieldOptions): this {
        super.applyOptions(options);

        if (options.value !== undefined) {
            this.setValue(options.value);
        }

        if (options.enabled !== undefined) {
            this.setElementAttribute("disabled", options.enabled ? null : "");
        }

        return this;
    }

    /**
     * Recalculates preferred and maximum height from the native input's measured size.
     *
     * Called at construction time and after each theme change so that font-size
     * adjustments propagate to the layout hint automatically.
     */
    private updateHeight(): void {
        const h = Util.measureInputHeight();

        this.setPreferredSize(110, h);
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

        // "HH:MM" — build a local-time Date using today's date.
        const [hours, minutes] = raw.split(":").map(Number);
        const d = new Date();

        d.setHours(hours, minutes, 0, 0);

        this._value = d;
    }

    /**
     * Registers a listener for the 'input' event, fired whenever the time changes.
     *
     * @param listener - The callback to invoke on each input event.
     */
    addActionListener(listener: Function): this {
        Event.addListener(this, "input", listener);

        return this;
    }

    /**
     * Sets the field value from a Date and updates the DOM element.
     * Only the hours and minutes of the Date are used.
     *
     * @param value - The Date whose time to display, or null to clear the field.
     */
    setValue(value: Date | null): this {
        this._value = value;

        const element = this.getElement();

        if (!element) {
            return this;
        }

        element.value = value ? this.formatTime(value) : "";

        return this;
    }

    /**
     * Returns a Date representing the currently entered time, or null if empty.
     * The date portion reflects the moment of the most recent input event.
     *
     * @returns The selected time as a Date, or null.
     */
    getValue(): Date | null {
        return this._value;
    }

    /**
     * Registers a listener that fires on each user-driven time change.
     *
     * @param fn - The callback to invoke on change.
     */
    addBindingListener(fn: () => void): void {
        this.addActionListener(fn);
    }

    /**
     * Formats a Date as an "HH:MM" string for use as an input value.
     *
     * @param date - The Date to format.
     * @returns An "HH:MM" string.
     */
    private formatTime(date: Date): string {
        const h = String(date.getHours()).padStart(2, "0");
        const m = String(date.getMinutes()).padStart(2, "0");

        return `${h}:${m}`;
    }

    /**
     * Returns the offset from the top of the time field to its inner-text baseline.
     *
     * @returns The baseline offset in pixels.
     *
     * @remarks Same formula as `TextInput.getBaseline`: the native input's
     * intrinsic baseline plus the component's top border and CSS padding.
     */
    getBaseline(): number | null {
        return this.wrapInnerBaseline(Util.measureInputBaseline());
    }

    /**
     * Renders the input element with type="time" and restores any stored value.
     *
     * @returns The created input element.
     */
    protected render(): HTMLInputElement & HTMLTextAreaElement {
        const element = super.render();

        element.setAttribute("type", "time");
        element.value = this._value ? this.formatTime(this._value) : "";

        return element;
    }
}

const TimeFieldCallable = callable(TimeField);
type TimeFieldCallable = TimeField;
export {
    TimeField         as _TimeField,
    TimeFieldCallable as TimeField
};
