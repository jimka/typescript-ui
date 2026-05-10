// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "../Component.js";
import { Event } from "../Event.js";
import { TextField } from "./TextField.js";
import { SpinButton } from "./SpinButton.js";
import { HBox } from "../layout/HBox.js";
import { VBox } from "../layout/VBox.js";
import { Insets } from "../Insets.js";
import { Bindable } from "../Bindable.js";
import { BorderStyle } from "../BorderStyle.js";
import { Util } from "../Util.js";
import { ThemeManager } from "../Theme.js";

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
 * A numeric input field with flanking up/down spin buttons.
 *
 * Combines a borderless `TextField` and a vertical strip of two `SpinButton`s
 * into a single bordered control. Supports min/max clamping, step-snapping,
 * configurable display precision, click and click-and-hold increment/decrement,
 * keyboard arrow keys, blur-on-invalid revert, and the framework `Bindable<number>`
 * interface.
 *
 * @category Components
 */
export class NumberSpinner extends Component implements Bindable<number> {

    private input  : TextField;
    private upBtn  : SpinButton;
    private downBtn: SpinButton;
    private btnBox : Component;

    private value    : number = 0;
    private min      : number = -Infinity;
    private max      : number = Infinity;
    private step     : number = 1;
    private precision: number | null = null;
    private _enabled : boolean = true;

    private bindingListeners: Array<() => void>              = [];
    private changeListeners : Array<(value: number) => void> = [];

    /**
     * Constructs a new NumberSpinner with default value `0`, step `1`, and unbounded min/max.
     */
    constructor(options?: NumberSpinnerOptions) {
        super();

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
        this.setInsets(new Insets(0, 0, 0, 0));
        this.addComponent(this.input, { weight: 1 });
        this.addComponent(this.btnBox);

        this.upBtn.addTickListener(() => this.applyValue(this.value + this.step));
        this.downBtn.addTickListener(() => this.applyValue(this.value - this.step));

        Event.addListener(this.input, "blur", () => this.onBlur());
        Event.addListener(this.input, "keydown", (e: KeyboardEvent) => this.onKeyDown(e));

        this.setBorder({ style: BorderStyle.SOLID, width: 1, color: "var(--ts-ui-button-border, rgb(200, 200, 200))" });
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");
        this.setBackgroundColor("var(--ts-ui-input-bg, rgb(255, 255, 255))");

        this.updateHeight();
        ThemeManager.onThemeChange(() => this.updateHeight());

        this.getAria().setRole("spinbutton");
        this.getAria().setValueNow(0);

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link NumberSpinnerOptions} bag, dispatching range, step,
     * precision, value, and enabled state after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: NumberSpinnerOptions): void {
        super.applyOptions(options);

        if (options.min !== undefined) {
            this.setMin(options.min);
        }

        if (options.max !== undefined) {
            this.setMax(options.max);
        }

        if (options.step !== undefined) {
            this.setStep(options.step);
        }

        if (options.precision !== undefined) {
            this.setPrecision(options.precision);
        }

        if (options.value !== undefined) {
            this.setValue(options.value);
        }

        if (options.enabled !== undefined) {
            this.setEnabled(options.enabled);
        }
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
        return this.value;
    }

    /**
     * Programmatically sets the value without firing change or binding listeners.
     *
     * @param n - The new value. It is clamped to [min, max] and snapped to the configured step.
     *
     * @remarks Used by the {@link Bindable} interface; does not fire listeners so that
     * binding write-backs do not trigger feedback loops.
     */
    setValue(n: number): void {
        this._setValueSilent(n);
    }

    /**
     * Returns the lower bound for the value.
     *
     * @returns The minimum allowed value (defaults to `-Infinity`).
     */
    getMin(): number {
        return this.min;
    }

    /**
     * Sets the lower bound for the value and updates the `aria-valuemin` attribute.
     *
     * @param n - The new minimum value. Pass `-Infinity` to remove the lower bound.
     */
    setMin(n: number): void {
        this.min = n;

        this.getAria().setValueMin(isFinite(n) ? n : null);
    }

    /**
     * Returns the upper bound for the value.
     *
     * @returns The maximum allowed value (defaults to `Infinity`).
     */
    getMax(): number {
        return this.max;
    }

    /**
     * Sets the upper bound for the value and updates the `aria-valuemax` attribute.
     *
     * @param n - The new maximum value. Pass `Infinity` to remove the upper bound.
     */
    setMax(n: number): void {
        this.max = n;

        this.getAria().setValueMax(isFinite(n) ? n : null);
    }

    /**
     * Returns the increment/decrement step.
     *
     * @returns The current step (defaults to `1`).
     */
    getStep(): number {
        return this.step;
    }

    /**
     * Sets the increment/decrement step.
     *
     * @param n - The new step value.
     */
    setStep(n: number): void {
        this.step = n;
    }

    /**
     * Returns the explicit display precision in decimal places, or `null` if it is derived from the step.
     *
     * @returns The precision, or null if not explicitly set.
     */
    getPrecision(): number | null {
        return this.precision;
    }

    /**
     * Sets the display precision (number of decimal places to render). Pass `null` to derive from the step.
     *
     * @param decimals - The number of decimal places, or `null` to derive from `step`.
     */
    setPrecision(decimals: number | null): void {
        this.precision = decimals;

        this.input.setText(this.formatValue(this.value));
    }

    /**
     * Returns whether the spinner accepts user input.
     *
     * @returns `true` if enabled, `false` if disabled.
     */
    isEnabled(): boolean {
        return this._enabled;
    }

    /**
     * Enables or disables the spinner. When disabled the text input is read-only,
     * the spin buttons stop responding to pointer events, and the whole control is dimmed.
     *
     * @param enabled - `true` to enable, `false` to disable.
     */
    setEnabled(enabled: boolean): void {
        this._enabled = enabled;

        if (enabled) {
            this.input.setElementAttribute("disabled", null);
            this.upBtn.setPointerEvents("auto");
            this.downBtn.setPointerEvents("auto");
            this.setOpacity(null);
        } else {
            this.input.setElementAttribute("disabled", "true");
            this.upBtn.setPointerEvents("none");
            this.downBtn.setPointerEvents("none");
            this.setOpacity(0.5);
        }
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
        if (!this._enabled) {
            return;
        }

        const next = this.normalize(n);
        if (next === this.value) {
            this.input.setText(this.formatValue(next));

            return;
        }

        this.value = next;
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

        this.value = next;
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
        let v = Math.min(this.max, Math.max(this.min, n));
        v = Math.round(v / this.step) * this.step;
        v = parseFloat(v.toFixed(this.derivePrecision()));

        return v;
    }

    /**
     * Reads the input field, parses the text, and either commits via `applyValue` or reverts on parse failure.
     */
    private onBlur(): void {
        const parsed = parseFloat(this.input.getText().valueOf());
        if (isNaN(parsed)) {
            this.input.setText(this.formatValue(this.value));

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
            this.applyValue(this.value + this.step);

            return;
        }

        if (e.key === "ArrowDown") {
            e.preventDefault();
            this.applyValue(this.value - this.step);

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
        if (this.precision !== null) {
            return this.precision;
        }

        const stepStr = String(this.step);
        const dotIdx  = stepStr.indexOf(".");

        return dotIdx >= 0 ? stepStr.length - dotIdx - 1 : 0;
    }
}
