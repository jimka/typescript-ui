// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { TextField } from "~/component/input/TextField.js";
import { SpinButton } from "~/component/input/SpinButton.js";
import { HBox } from "~/layout/HBox.js";
import { VBox } from "~/layout/VBox.js";
import { Insets } from "~/primitive/Insets.js";
import { Bindable } from "~/core/Bindable.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { Util } from "~/core/Util.js";
import { ThemeManager } from "~/core/Theme.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link NumberSpinner}.
 *
 * @category Components
 */
export interface NumberSpinnerOptions extends ComponentOptions {
    value?:     number;
    min?:       number;
    max?:       number;
    step?:      number;
    precision?: number | null;
    enabled?:   boolean;
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each setter once with
 * the final value, so any field the caller supplied wins. `preferredSize` /
 * `maxSize` are *not* listed because `updateHeight` derives them from the
 * live measured input height (and re-fires on theme changes). `min`/`max`/
 * `step`/`precision`/`value`/`enabled` are late-built state — they touch
 * the inner `input`/`upBtn`/`downBtn` which don't exist yet — so they are
 * written pure by `applyOptions` and dispatched from the constructor body
 * once the children are built.
 */
const _defaultNumberSpinnerOptions: Partial<NumberSpinnerOptions> = {
    insets:          new Insets(0, 0, 0, 0),
    border:          { style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-button-border, rgb(200, 200, 200))" },
    borderRadius:    "var(--ts-ui-border-radius, 4px)",
    backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
};

/**
 * A numeric input field with flanking up/down spin buttons.
 *
 * Combines a borderless [`TextField`](/api/component/input/classes/TextField) and a vertical strip of two [`SpinButton`](/api/component/input/classes/SpinButton)s
 * into a single bordered control. Supports min/max clamping, step-snapping,
 * configurable display precision, click and click-and-hold increment/decrement,
 * keyboard arrow keys, blur-on-invalid revert, and the framework `Bindable<number>`
 * interface.
 *
 * @category Components
 */
class NumberSpinner extends Component<NumberSpinnerOptions> implements Bindable<number> {

    private input!  : TextField;
    private upBtn!  : SpinButton;
    private downBtn!: SpinButton;
    private btnBox! : Component;

    private bindingListeners: Array<() => void>              = [];
    private changeListeners : Array<(value: number) => void> = [];

    /**
     * Constructs a new NumberSpinner with default value `0`, step `1`, and unbounded min/max.
     */
    constructor(options?: NumberSpinnerOptions) {
        // Merge defaults → consumer options. The cascade in `super` dispatches
        // every cascade-safe setter (inherited Component fields, plus the
        // visual defaults above) once with the final value. The late-built
        // fields (`min`/`max`/`step`/`precision`/`value`/`enabled`) are
        // pure-written into `_options` by `applyOptions` because they touch
        // children that don't exist yet — we dispatch them once the row is
        // built below.
        super({ ..._defaultNumberSpinnerOptions, ...(options ?? {}) });

        this.input = new TextField();
        this.input.setTextAlign("right");
        this.input.setBorder({ style: BorderStyle.NONE });
        this.input.setBorderRadius("0");
        this.input.setText(this.formatValue(0));

        this.upBtn   = new SpinButton("▲");
        this.downBtn = new SpinButton("▼");
        this.upBtn.setBorder({ top: { style: BorderStyle.SOLID, width: 1, color: "transparent" } });
        this.upBtn.setBorderRadius("0");
        this.downBtn.setBorder({ top: { style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-spinner-divider, rgb(180, 180, 180))" } });
        this.downBtn.setBorderRadius("0");

        this.btnBox = new Component();

        const vbox = new VBox();
        vbox.setComponentSpacing(0);
        this.btnBox.setLayoutManager(vbox);
        this.btnBox.setInsets(new Insets(0, 0, 0, 0));
        this.btnBox.addComponent(this.upBtn);
        this.btnBox.addComponent(this.downBtn);

        const hbox = new HBox();
        hbox.setComponentSpacing(0);
        hbox.setStretching(true);
        this.setLayoutManager(hbox);
        this.addComponent(this.input, { weight: 1 });
        this.addComponent(this.btnBox);

        this.upBtn.addTickListener(() => this.applyValue(this.getValue() + this.getStep()));
        this.downBtn.addTickListener(() => this.applyValue(this.getValue() - this.getStep()));

        Event.addListener(this.input, "blur", () => this.onBlur());
        Event.addListener(this.input, "keydown", (e: KeyboardEvent) => this.onKeyDown(e));

        this.updateHeight();
        ThemeManager.onThemeChange(() => this.updateHeight());

        this.getAria().setRole("spinbutton");
        this.getAria().setValueNow(0);

        // Late-built state: `applyOptions` wrote these pure into `_options`
        // because the inner `input`/`upBtn`/`downBtn` didn't exist yet.
        // Dispatch now via the real setters so aria/text/disabled propagate.
        if (this._options.min       !== undefined) this.setMin(this._options.min);
        if (this._options.max       !== undefined) this.setMax(this._options.max);
        if (this._options.step      !== undefined) this.setStep(this._options.step);
        if (this._options.precision !== undefined) this.setPrecision(this._options.precision);
        if (this._options.value     !== undefined) this.setValue(this._options.value);
        if (this._options.enabled   !== undefined) this.setEnabled(this._options.enabled);
    }

    /**
     * Applies a {@link NumberSpinnerOptions} bag. Inherited Component fields
     * cascade through `super.applyOptions`; the late-built fields
     * (`min`/`max`/`step`/`precision`/`value`/`enabled`, all of which touch
     * inner `input`/`upBtn`/`downBtn`) are written pure to `_options` here
     * and dispatched from the constructor body once children exist.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: NumberSpinnerOptions): this {
        super.applyOptions(options);

        if (options.min       !== undefined) this._options.min       = options.min;
        if (options.max       !== undefined) this._options.max       = options.max;
        if (options.step      !== undefined) this._options.step      = options.step;
        if (options.precision !== undefined) this._options.precision = options.precision;
        if (options.value     !== undefined) this._options.value     = options.value;
        if (options.enabled   !== undefined) this._options.enabled   = options.enabled;

        return this;
    }

    /**
     * Returns the offset from the top of the spinner to the inner input's text baseline.
     *
     * @returns The baseline offset in pixels, or `null` when the input has no baseline.
     */
    getBaseline(): number | null {
        return this.wrapInnerBaseline(this.input.getBaseline());
    }

    /**
     * Recalculates preferred and maximum height from the native input's measured size.
     */
    private updateHeight(): void {
        const h = Util.measureInputHeight();

        this.setPreferredSize(120, h);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, h);
    }

    /**
     * Returns the current numeric value.
     *
     * @returns The most recently committed value.
     */
    getValue(): number {
        return this._options.value ?? 0;
    }

    /**
     * Programmatically sets the value without firing change or binding listeners.
     *
     * @param n - The new value. It is clamped to [min, max] and snapped to the configured step.
     *
     * @remarks Used by the {@link Bindable} interface; does not fire listeners so that
     * binding write-backs do not trigger feedback loops.
     */
    setValue(n: number): this {
        this._setValueSilent(n);

        return this;
    }

    /**
     * Returns the lower bound for the value.
     *
     * @returns The minimum allowed value (defaults to `-Infinity`).
     */
    getMin(): number {
        return this._options.min ?? -Infinity;
    }

    /**
     * Sets the lower bound for the value and updates the `aria-valuemin` attribute.
     *
     * @param n - The new minimum value. Pass `-Infinity` to remove the lower bound.
     */
    setMin(n: number): this {
        this._options.min = n;

        this.getAria().setValueMin(isFinite(n) ? n : null);

        return this;
    }

    /**
     * Returns the upper bound for the value.
     *
     * @returns The maximum allowed value (defaults to `Infinity`).
     */
    getMax(): number {
        return this._options.max ?? Infinity;
    }

    /**
     * Sets the upper bound for the value and updates the `aria-valuemax` attribute.
     *
     * @param n - The new maximum value. Pass `Infinity` to remove the upper bound.
     */
    setMax(n: number): this {
        this._options.max = n;

        this.getAria().setValueMax(isFinite(n) ? n : null);

        return this;
    }

    /**
     * Returns the increment/decrement step.
     *
     * @returns The current step (defaults to `1`).
     */
    getStep(): number {
        return this._options.step ?? 1;
    }

    /**
     * Sets the increment/decrement step.
     *
     * @param n - The new step value.
     */
    setStep(n: number): this {
        this._options.step = n;

        return this;
    }

    /**
     * Returns the explicit display precision in decimal places, or `null` if it is derived from the step.
     *
     * @returns The precision, or null if not explicitly set.
     */
    getPrecision(): number | null {
        return this._options.precision ?? null;
    }

    /**
     * Sets the display precision (number of decimal places to render). Pass `null` to derive from the step.
     *
     * @param decimals - The number of decimal places, or `null` to derive from `step`.
     */
    setPrecision(decimals: number | null): this {
        this._options.precision = decimals;

        this.input.setText(this.formatValue(this.getValue()));

        return this;
    }

    /**
     * Returns whether the spinner accepts user input.
     *
     * @returns `true` if enabled, `false` if disabled.
     */
    isEnabled(): boolean {
        return this._options.enabled ?? true;
    }

    /**
     * Enables or disables the spinner. When disabled the text input is read-only,
     * the spin buttons stop responding to pointer events, and the whole control is dimmed.
     *
     * @param enabled - `true` to enable, `false` to disable.
     */
    setEnabled(enabled: boolean): this {
        this._options.enabled = enabled;

        if (enabled) {
            this.input.setDisabledAttribute(false);
            this.upBtn.setPointerEvents("auto");
            this.downBtn.setPointerEvents("auto");
            this.clearOpacity();
        } else {
            this.input.setDisabledAttribute(true);
            this.upBtn.setPointerEvents("none");
            this.downBtn.setPointerEvents("none");
            this.setOpacity(0.5);
        }

        return this;
    }

    /**
     * Registers a listener invoked whenever the user changes the value (click, hold-repeat, arrow key, or blur).
     *
     * @param listener - Callback invoked with the new numeric value.
     */
    addChangeListener(listener: (value: number) => void): void {
        this.changeListeners.push(listener);
    }

    /**
     * Subscribes a callback invoked on every user-driven value change. Used by the {@link Bindable} interface.
     *
     * @param fn - The callback to invoke on each user-driven change.
     */
    addBindingListener(fn: () => void): void {
        this.bindingListeners.push(fn);
    }

    /**
     * Applies a user-driven value: clamps, snaps to step, formats, updates the DOM, and fires listeners.
     *
     * @param n - The proposed new value (raw, before clamping and snapping).
     */
    private applyValue(n: number): void {
        if (!this.isEnabled()) {
            return;
        }

        const next = this.normalize(n);
        if (next === this.getValue()) {
            this.input.setText(this.formatValue(next));

            return;
        }

        this._options.value = next;
        this.input.setText(this.formatValue(next));
        this.getAria().setValueNow(next);

        for (const fn of this.changeListeners) {
            fn(next);
        }

        for (const fn of this.bindingListeners) {
            fn();
        }
    }

    /**
     * Programmatic value update path. Clamps, snaps, formats, and updates the DOM without firing listeners.
     *
     * @param n - The new value.
     */
    private _setValueSilent(n: number): void {
        const next = this.normalize(n);

        this._options.value = next;
        this.input.setText(this.formatValue(next));
        this.getAria().setValueNow(next);
    }

    /**
     * Clamps `n` to `[min, max]`, snaps to the nearest step multiple, then re-quantises to the display precision.
     *
     * @param n - The raw input value.
     *
     * @returns The normalised value ready to be stored.
     */
    private normalize(n: number): number {
        let v = Math.min(this.getMax(), Math.max(this.getMin(), n));
        v = Math.round(v / this.getStep()) * this.getStep();
        v = parseFloat(v.toFixed(this.derivePrecision()));

        return v;
    }

    /**
     * Reads the input field, parses the text, and either commits via `applyValue` or reverts on parse failure.
     */
    private onBlur(): void {
        const parsed = parseFloat(this.input.getText().valueOf());
        if (isNaN(parsed)) {
            this.input.setText(this.formatValue(this.getValue()));

            return;
        }

        this.applyValue(parsed);
    }

    /**
     * Handles ArrowUp/ArrowDown to step the value, and Enter to commit the current text.
     *
     * @param e - The keyboard event.
     */
    private onKeyDown(e: KeyboardEvent): void {
        if (e.key === "ArrowUp") {
            e.preventDefault();
            this.applyValue(this.getValue() + this.getStep());

            return;
        }

        if (e.key === "ArrowDown") {
            e.preventDefault();
            this.applyValue(this.getValue() - this.getStep());

            return;
        }

        if (e.key === "Enter") {
            this.onBlur();
        }
    }

    /**
     * Formats a numeric value to the configured display precision.
     *
     * @param n - The value to format.
     *
     * @returns The formatted string with the appropriate decimal places.
     */
    private formatValue(n: number): string {
        return n.toFixed(this.derivePrecision());
    }

    /**
     * Returns the explicit precision if one is set, otherwise infers it from the configured step.
     *
     * @returns The number of decimal places to render.
     */
    private derivePrecision(): number {
        const precision = this._options.precision ?? null;
        if (precision !== null) {
            return precision;
        }

        const stepStr = String(this.getStep());
        const dotIdx  = stepStr.indexOf(".");

        return dotIdx >= 0 ? stepStr.length - dotIdx - 1 : 0;
    }
}

const NumberSpinnerCallable = callable(NumberSpinner);
type NumberSpinnerCallable = NumberSpinner;
export {
    NumberSpinner         as _NumberSpinner,
    NumberSpinnerCallable as NumberSpinner
};
