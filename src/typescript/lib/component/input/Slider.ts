// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractInput, AbstractInputOptions } from "~/component/input/AbstractInput.js";
import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link Slider}.
 *
 * @category Components
 */
export interface SliderOptions extends AbstractInputOptions {
    value?:       number;
    min?:         number;
    max?:         number;
    step?:        number;
    largeStep?:   number;
    orientation?: "horizontal" | "vertical";
    showTicks?:   boolean;

    /** @deprecated use {@link SliderOptions.min} */
    minValue?:    number;
    /** @deprecated use {@link SliderOptions.max} */
    maxValue?:    number;
}

const TRACK_THICKNESS = 4;
const THUMB_SIZE      = 16;
const DEFAULT_MIN     = 0;
const DEFAULT_MAX     = 100;
const DEFAULT_STEP    = 1;

/**
 * A custom-drawn range slider rendered as a focusable `<div>` with
 * `role="slider"`.
 *
 * The track + thumb are real Components; drag is implemented via
 * `pointerdown` + `setPointerCapture` so the cursor can leave the track
 * during a drag without losing the stream. Keyboard navigation follows the
 * WAI-ARIA Authoring Practices slider model (Arrow / PageUp / PageDown /
 * Home / End).
 *
 * @category Components
 */
class Slider<TOptions extends SliderOptions = SliderOptions>
    extends AbstractInput<number, TOptions>
{
    private _track:           Component;
    private _activeTrack:     Component;
    private _thumb:           Component;
    private _draggingPointer: number | null = null;

    /**
     * Constructs a Slider.
     *
     * @param options - Optional construction-time options.
     */
    constructor(options?: TOptions) {
        super({ ...(options ?? {}) } as TOptions);

        this._track = new Component();
        this._track.setBackgroundColor("var(--ts-ui-slider-track-bg, rgb(220, 220, 220))");
        this._track.setBorderRadius("999px");
        // Pointer-events pass through to the slider root so `addListener`
        // matches by id on every press, and the root's cursor is what shows
        // on hover anywhere over the control.
        this._track.setPointerEvents("none");

        this._activeTrack = new Component();
        this._activeTrack.setBackgroundColor("var(--ts-ui-slider-track-active-bg, rgb(30, 100, 200))");
        this._activeTrack.setBorderRadius("999px");
        this._activeTrack.setPointerEvents("none");

        this._thumb = new Component();
        this._thumb.setBackgroundColor("var(--ts-ui-slider-thumb-bg, rgb(255, 255, 255))");
        this._thumb.setBorderRadius("50%");
        this._thumb.setBorder("1px solid var(--ts-ui-form-border, rgb(160, 160, 160))");
        this._thumb.setShadow("0 1px 2px rgba(0, 0, 0, 0.25)");
        this._thumb.setPreferredSize(THUMB_SIZE, THUMB_SIZE);
        this._thumb.setMaxSize(THUMB_SIZE, THUMB_SIZE);
        this._thumb.setPointerEvents("none");

        this._track.addComponent(this._activeTrack);
        super.addComponent(this._track);
        super.addComponent(this._thumb);

        this.setPreferredSize(200, THUMB_SIZE);
        this.setMaxSize(Number.MAX_SAFE_INTEGER, THUMB_SIZE);
        this.setOutline("none");
        this.setCursor("pointer");

        this.getAria().setRole("slider");
        this.getAria().setTabIndex(0);
        this.getAria().setOrientation("horizontal");
        this.getAria().setValueMin(DEFAULT_MIN);
        this.getAria().setValueMax(DEFAULT_MAX);
        this.getAria().setValueNow(DEFAULT_MIN);

        this.installInteraction();

        if (this._options.minValue !== undefined && this._options.min === undefined) {
            this._options.min = this._options.minValue;
        }

        if (this._options.maxValue !== undefined && this._options.max === undefined) {
            this._options.max = this._options.maxValue;
        }

        if (this._options.min !== undefined) {
            this.applyMin(this._options.min);
        }

        if (this._options.max !== undefined) {
            this.applyMax(this._options.max);
        }

        if (this._options.orientation !== undefined) {
            this.applyOrientation(this._options.orientation);
        }

        if (this._options.value !== undefined) {
            this.applyValue(this._options.value);
        } else {
            this.applyValue(this.getMin());
        }

        if (this._options.enabled !== undefined) {
            this.applyEnabled(this._options.enabled);
        }

        if (this._options.readOnly !== undefined) {
            this.applyReadOnly(this._options.readOnly);
        }
    }

    /**
     * Applies a {@link SliderOptions} bag. Inherited Component fields cascade
     * through `super.applyOptions`; slider-specific fields are stored pure on
     * `_options` so the constructor body can dispatch them after children
     * are built.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as TOptions;

        if (opts.value       !== undefined) this._options.value       = opts.value;
        if (opts.min         !== undefined) this._options.min         = opts.min;
        if (opts.max         !== undefined) this._options.max         = opts.max;
        if (opts.minValue    !== undefined) this._options.minValue    = opts.minValue;
        if (opts.maxValue    !== undefined) this._options.maxValue    = opts.maxValue;
        if (opts.step        !== undefined) this._options.step        = opts.step;
        if (opts.largeStep   !== undefined) this._options.largeStep   = opts.largeStep;
        if (opts.orientation !== undefined) this._options.orientation = opts.orientation;
        if (opts.showTicks   !== undefined) this._options.showTicks   = opts.showTicks;
        if (opts.enabled     !== undefined) this._options.enabled     = opts.enabled;
        if (opts.readOnly    !== undefined) this._options.readOnly    = opts.readOnly;

        return this;
    }

    /**
     * Returns the current slider value.
     *
     * @returns The current numeric value.
     */
    getValue(): number {
        return this._options.value ?? this.getMin();
    }

    /**
     * Sets the slider value, clamped to `[min, max]` and snapped to `step`.
     * Notifies change and binding listeners only on a real transition.
     *
     * @param value - The desired value.
     *
     * @returns This component, for method chaining.
     */
    setValue(value: number): this {
        const next = this.snap(value);
        if (next === this.getValue()) {
            return this;
        }

        this._options.value = next;
        this.applyValue(next);
        this.notifyChange(next);

        // Existing consumers wire to "input" via `on("action", fn)`. Fire so
        // demos that read `slider.getValue()` from an `input` callback keep
        // working.
        Event.fireEvent(this, "input");

        return this;
    }

    /**
     * Returns the minimum value.
     *
     * @returns The current minimum.
     */
    getMin(): number {
        return this._options.min ?? DEFAULT_MIN;
    }

    /**
     * Sets the minimum value. The current value is reclamped if it falls
     * below the new minimum.
     *
     * @param value - The new minimum.
     *
     * @returns This component, for method chaining.
     */
    setMin(value: number): this {
        this._options.min = value;
        this.applyMin(value);
        this.applyValue(this.snap(this.getValue()));

        return this;
    }

    /**
     * Returns the maximum value.
     *
     * @returns The current maximum.
     */
    getMax(): number {
        return this._options.max ?? DEFAULT_MAX;
    }

    /**
     * Sets the maximum value. The current value is reclamped if it exceeds
     * the new maximum.
     *
     * @param value - The new maximum.
     *
     * @returns This component, for method chaining.
     */
    setMax(value: number): this {
        this._options.max = value;
        this.applyMax(value);
        this.applyValue(this.snap(this.getValue()));

        return this;
    }

    /**
     * Deprecated alias for {@link setMin}. Kept so existing demos compile;
     * remove in a follow-up cleanup once all consumers are migrated.
     *
     * @param value - The new minimum.
     *
     * @returns This component, for method chaining.
     *
     * @deprecated Use {@link setMin}.
     */
    setMinValue(value: number): this {
        return this.setMin(value);
    }

    /**
     * Deprecated alias for {@link getMin}.
     *
     * @returns The current minimum.
     *
     * @deprecated Use {@link getMin}.
     */
    getMinValue(): number {
        return this.getMin();
    }

    /**
     * Deprecated alias for {@link setMax}.
     *
     * @param value - The new maximum.
     *
     * @returns This component, for method chaining.
     *
     * @deprecated Use {@link setMax}.
     */
    setMaxValue(value: number): this {
        return this.setMax(value);
    }

    /**
     * Deprecated alias for {@link getMax}.
     *
     * @returns The current maximum.
     *
     * @deprecated Use {@link getMax}.
     */
    getMaxValue(): number {
        return this.getMax();
    }

    /**
     * Returns the step increment.
     *
     * @returns The current step.
     */
    getStep(): number {
        return this._options.step ?? DEFAULT_STEP;
    }

    /**
     * Sets the step increment used by keyboard navigation and value snapping.
     *
     * @param value - The new step.
     *
     * @returns This component, for method chaining.
     */
    setStep(value: number): this {
        this._options.step = value;

        return this;
    }

    /**
     * Returns the large-step increment used by PageUp / PageDown. Defaults to
     * `10 * step` when not explicitly set.
     *
     * @returns The current large-step.
     */
    getLargeStep(): number {
        return this._options.largeStep ?? this.getStep() * 10;
    }

    /**
     * Sets the PageUp / PageDown increment.
     *
     * @param value - The new large-step.
     *
     * @returns This component, for method chaining.
     */
    setLargeStep(value: number): this {
        this._options.largeStep = value;

        return this;
    }

    /**
     * Returns the current orientation.
     *
     * @returns `"horizontal"` or `"vertical"`.
     */
    getOrientation(): "horizontal" | "vertical" {
        return this._options.orientation ?? "horizontal";
    }

    /**
     * Sets the slider orientation. Updates the ARIA attribute, the keyboard
     * model, and the track + thumb layout.
     *
     * @param orientation - `"horizontal"` or `"vertical"`.
     *
     * @returns This component, for method chaining.
     */
    setOrientation(orientation: "horizontal" | "vertical"): this {
        this._options.orientation = orientation;
        this.applyOrientation(orientation);
        this.applyValue(this.getValue());

        return this;
    }

    /**
     * Returns whether tick marks are visible. (Not yet rendered visually —
     * the field is reserved for a follow-up.)
     *
     * @returns `true` when ticks should be shown.
     */
    isShowTicks(): boolean {
        return this._options.showTicks ?? false;
    }

    /**
     * Toggles tick mark visibility. Reserved option; no visual side effect
     * yet.
     *
     * @param value - `true` to show ticks.
     *
     * @returns This component, for method chaining.
     */
    setShowTicks(value: boolean): this {
        this._options.showTicks = value;

        return this;
    }

    /**
     * Registers a listener for one of this slider's events. `"action"` is a
     * typed semantic shorthand over {@link Event.addListener} for the
     * value-change event (the native `input`, fired on each drag step);
     * `"change"` and `"binding"` are the inherited {@link AbstractInput}
     * listener-bag events.
     *
     * @param event - The event name.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This component, for method chaining.
     */
    on(event: "action",  listener: Function): this;
    on(event: "change",  listener: (value: number) => void): this;
    on(event: "binding", listener: () => void): this;
    on(event: "action" | "change" | "binding", listener: Function): this {
        if (event === "action") {
            Event.addListener(this, "input", listener);

            return this;
        }

        return super.on(event as "change", listener as (value: number) => void);
    }

    /**
     * Removes a previously registered listener. The exact callback
     * reference must match the one passed to {@link on}.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This component, for method chaining.
     */
    off(event: "action" | "change" | "binding", listener: Function): this {
        if (event === "action") {
            Event.removeListener(this, "input", listener);

            return this;
        }

        return super.off(event, listener);
    }

    /**
     * Returns `null` so HBox falls back to bottom-edge alignment — the bare
     * slider has no inline text baseline.
     *
     * @returns `null`.
     */
    getBaseline(): number | null {
        return null;
    }

    /**
     * Lays out the track, active fill, and thumb for the current size.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        const inner = this.getInnerSize();
        if (!inner) {
            return this;
        }

        const horizontal = this.getOrientation() === "horizontal";

        // `Component.setWidth` / `setHeight` clamp to the component's own
        // maxSize, so `inner` is already bounded by our `setMaxSize(_,
        // THUMB_SIZE)` (or `setMaxSize(THUMB_SIZE, _)` when vertical) — no
        // extra cross-axis clamp is needed here.
        const innerWidth  = inner.width;
        const innerHeight = inner.height;
        const min        = this.getMin();
        const max        = this.getMax();
        const range      = max - min;
        const fraction   = range > 0 ? (this.getValue() - min) / range : 0;

        // doLayout only setX/setY/setSize on the children; their preferredSize
        // is a hint for parent layouts and never reaches their own DOM. Size
        // the thumb explicitly so it renders at THUMB_SIZE rather than
        // collapsing to its 2 × 2 border box.
        if (horizontal) {
            const trackTop = Math.round((innerHeight - TRACK_THICKNESS) / 2);
            this._track.setX(0);
            this._track.setY(trackTop);
            this._track.setSize({ width: innerWidth, height: TRACK_THICKNESS });

            const activeWidth = Math.round(innerWidth * fraction);
            this._activeTrack.setX(0);
            this._activeTrack.setY(0);
            this._activeTrack.setSize({ width: activeWidth, height: TRACK_THICKNESS });

            const thumbX = Math.round((innerWidth - THUMB_SIZE) * fraction);
            const thumbY = Math.round((innerHeight - THUMB_SIZE) / 2);
            this._thumb.setSize({ width: THUMB_SIZE, height: THUMB_SIZE });
            this._thumb.setX(thumbX);
            this._thumb.setY(thumbY);
        } else {
            const trackLeft = Math.round((innerWidth - TRACK_THICKNESS) / 2);
            this._track.setX(trackLeft);
            this._track.setY(0);
            this._track.setSize({ width: TRACK_THICKNESS, height: innerHeight });

            // Vertical slider: zero is at the bottom by convention.
            const activeHeight = Math.round(innerHeight * fraction);
            this._activeTrack.setX(0);
            this._activeTrack.setY(innerHeight - activeHeight);
            this._activeTrack.setSize({ width: TRACK_THICKNESS, height: activeHeight });

            const thumbX = Math.round((innerWidth - THUMB_SIZE) / 2);
            const thumbY = Math.round((innerHeight - THUMB_SIZE) * (1 - fraction));
            this._thumb.setSize({ width: THUMB_SIZE, height: THUMB_SIZE });
            this._thumb.setX(thumbX);
            this._thumb.setY(thumbY);
        }

        return this;
    }

    /**
     * Wires pointer drag (with setPointerCapture) and keyboard navigation.
     */
    private installInteraction(): void {
        // `pointer-events: none` on the inner visual children forwards pointer
        // hits to the root, so the exact-target `addListener` matches the
        // slider's id. `setPointerCapture` below then routes the move / up /
        // cancel stream to the same root element.
        Event.addListener(this, "pointerdown", (e: PointerEvent) => {
            if (!this.isEnabled() || this.isReadOnly()) {
                return;
            }

            e.preventDefault();
            this.focus();

            const element = this.getElement();
            if (element) {
                element.setPointerCapture(e.pointerId);
                this._draggingPointer = e.pointerId;
            }

            this.setValue(this.valueAtPointer(e));
        });

        Event.addListener(this, "pointermove", (e: PointerEvent) => {
            if (this._draggingPointer !== e.pointerId) {
                return;
            }

            this.setValue(this.valueAtPointer(e));
        });

        const release = (e: PointerEvent): void => {
            if (this._draggingPointer !== e.pointerId) {
                return;
            }

            const element = this.getElement();
            if (element && element.hasPointerCapture(e.pointerId)) {
                element.releasePointerCapture(e.pointerId);
            }

            this._draggingPointer = null;
        };

        Event.addListener(this, "pointerup",          release);
        Event.addListener(this, "pointercancel",      release);
        // Browser releases pointer capture on alt-tab / focus loss. Clear our
        // mirror so the next pointerdown starts clean and there's no stuck-drag.
        Event.addListener(this, "lostpointercapture", release);

        Event.addListener(this, "keydown", (e: KeyboardEvent) => {
            if (!this.isEnabled() || this.isReadOnly()) {
                return;
            }

            const step      = this.getStep();
            const largeStep = this.getLargeStep();
            const min       = this.getMin();
            const max       = this.getMax();

            switch (e.key) {
                case "ArrowRight":
                case "ArrowUp":
                    e.preventDefault();
                    this.setValue(this.getValue() + step);
                    break;
                case "ArrowLeft":
                case "ArrowDown":
                    e.preventDefault();
                    this.setValue(this.getValue() - step);
                    break;
                case "PageUp":
                    e.preventDefault();
                    this.setValue(this.getValue() + largeStep);
                    break;
                case "PageDown":
                    e.preventDefault();
                    this.setValue(this.getValue() - largeStep);
                    break;
                case "Home":
                    e.preventDefault();
                    this.setValue(min);
                    break;
                case "End":
                    e.preventDefault();
                    this.setValue(max);
                    break;
            }
        });
    }

    /**
     * Converts a pointer position into the corresponding slider value.
     */
    private valueAtPointer(e: PointerEvent): number {
        const element = this.getElement();
        if (!element) {
            return this.getValue();
        }

        const rect       = element.getBoundingClientRect();
        const horizontal = this.getOrientation() === "horizontal";
        const fraction   = horizontal
            ? (rect.width  > 0 ? (e.clientX - rect.left) / rect.width  : 0)
            : (rect.height > 0 ? 1 - (e.clientY - rect.top) / rect.height : 0);

        const clamped = Math.max(0, Math.min(1, fraction));
        const min     = this.getMin();
        const max     = this.getMax();

        return min + (max - min) * clamped;
    }

    /**
     * Clamps `value` to `[min, max]` and snaps to the nearest step boundary.
     */
    private snap(value: number): number {
        const min  = this.getMin();
        const max  = this.getMax();
        const step = this.getStep();

        const clamped = Math.max(min, Math.min(max, value));

        if (step <= 0) {
            return clamped;
        }

        const snapped = min + Math.round((clamped - min) / step) * step;

        return Math.max(min, Math.min(max, snapped));
    }

    /**
     * Updates the value-related ARIA state and re-runs layout to move the
     * thumb.
     */
    private applyValue(value: number): void {
        this._options.value = value;
        this.getAria().setValueNow(value);
        this.scheduleLayout();
    }

    /**
     * Pushes the new minimum into the ARIA cache.
     */
    private applyMin(value: number): void {
        this.getAria().setValueMin(value);
    }

    /**
     * Pushes the new maximum into the ARIA cache.
     */
    private applyMax(value: number): void {
        this.getAria().setValueMax(value);
    }

    /**
     * Reflects the orientation in ARIA, swaps the preferred size between
     * landscape and portrait, and forces a layout.
     */
    private applyOrientation(orientation: "horizontal" | "vertical"): void {
        this.getAria().setOrientation(orientation);

        if (orientation === "horizontal") {
            this.setPreferredSize(200, THUMB_SIZE);
            this.setMaxSize(Number.MAX_SAFE_INTEGER, THUMB_SIZE);
        } else {
            this.setPreferredSize(THUMB_SIZE, 200);
            this.setMaxSize(THUMB_SIZE, Number.MAX_SAFE_INTEGER);
        }

        this.scheduleLayout();
    }

    /**
     * Reflects the enabled flag in the ARIA tree and tabindex.
     */
    protected applyEnabled(value: boolean): void {
        this.getAria().setDisabled(!value);
        this.getAria().setTabIndex(value ? 0 : -1);
        this.setCursor(value ? "pointer" : "default");
    }

    /**
     * Reflects the read-only flag in the ARIA tree.
     */
    protected applyReadOnly(value: boolean): void {
        this.getAria().setReadOnly(value);
    }
}

const SliderCallable = callable(Slider);
type SliderCallable<TOptions extends SliderOptions = SliderOptions> = Slider<TOptions>;
export {
    Slider         as _Slider,
    SliderCallable as Slider
};
