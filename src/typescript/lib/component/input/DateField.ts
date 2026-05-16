// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Input, InputOptions } from "~/component/input/Input.js";
import { Util } from "~/core/Util.js";
import { Event } from "~/core/Event.js";
import { Insets } from "~/primitive/Insets.js";
import { Bindable } from "~/core/Bindable.js";
import { ThemeManager } from "~/core/Theme.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link DateField}.
 *
 * @category Components
 */
export interface DateFieldOptions extends InputOptions {
    value?:   Date | null;
    enabled?: boolean;
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each setter once with
 * the final value, so any field the caller supplied wins. `preferredSize` /
 * `maxSize` are *not* listed because `updateHeight` derives them from the
 * live measured input height (and re-fires on theme changes).
 */
const _defaultDateFieldOptions: Partial<DateFieldOptions> = {
    cursor:          "text",
    padding:         new Insets(3, 3, 3, 3),
    backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
    foregroundColor: "var(--ts-ui-text-color, black)",
};

/**
 * A date-picker input component backed by an `<input type="date">` element.
 *
 * Implements {@link Bindable} so it can participate in a [`Binding`](/api/core/classes/Binding) directly.
 * Returns `null` from `getValue` when the field is empty.
 *
 * @category Components
 */
class DateField<TOptions extends DateFieldOptions = DateFieldOptions> extends Input<TOptions> implements Bindable<Date | null> {

    constructor(options?: TOptions) {
        super({ ..._defaultDateFieldOptions, ...(options ?? {}) } as TOptions);

        this.updateHeight();
        ThemeManager.onThemeChange(() => this.updateHeight());

        Event.addListener(this, "input", this.onInput);
    }

    /**
     * Applies a {@link DateFieldOptions} bag, dispatching the initial value and
     * enabled/disabled state after inherited Input/Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        if (options.value !== undefined) {
            this.setValue(options.value);
        }

        if (options.enabled !== undefined) {
            this.setDisabledAttribute(!options.enabled);
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
            this._options.value = null;
            return;
        }

        // "YYYY-MM-DD" — append local midnight to avoid UTC offset shifting the day.
        this._options.value = new Date(raw + "T00:00:00");
    }

    /**
     * Registers a listener for the 'input' event, fired whenever the date changes.
     *
     * @param listener - The callback to invoke on each input event.
     */
    addActionListener(listener: Function): this {
        Event.addListener(this, "input", listener);

        return this;
    }

    /**
     * Sets the field value from a Date and updates the DOM element.
     *
     * @param value - The Date to display, or null to clear the field.
     */
    setValue(value: Date | null): this {
        this._options.value = value;

        const element = this.getElement();

        if (!element) {
            return this;
        }

        element.value = value ? this.formatDate(value) : "";

        return this;
    }

    /**
     * Returns the currently selected Date, or null if the field is empty.
     *
     * @returns The selected Date, or null.
     */
    getValue(): Date | null {
        return this._options.value ?? null;
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
     * Returns the offset from the top of the date field to its inner-text baseline.
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
     * Renders the input element with type="date" and restores any stored value.
     *
     * @returns The created input element.
     */
    protected render(): HTMLInputElement & HTMLTextAreaElement {
        const element = super.render();

        element.setAttribute("type", "date");
        const value = this._options.value ?? null;
        element.value = value ? this.formatDate(value) : "";

        return element;
    }
}

const DateFieldCallable = callable(DateField);
type DateFieldCallable<TOptions extends DateFieldOptions = DateFieldOptions> = DateField<TOptions>;
export {
    DateField         as _DateField,
    DateFieldCallable as DateField
};
