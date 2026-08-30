// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractInput, AbstractInputOptions } from "~/component/input/AbstractInput.js";
import { Component, ComponentOptions } from "~/core/Component.js";
import { Util } from "~/core/Util.js";
import { UNBOUNDED } from "~/primitive/Size.js";
import { DOM } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { callable } from "~/core/Callable.js";
import type { AxisOrientation } from "~/primitive/Axis.js";

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
    orientation?: AxisOrientation;
    showTicks?:   boolean;
    /**
     * Construction-time listener bag — the declarative form of `on()`. Adds the
     * slider's `action` shorthand to the inherited `change` / `binding`.
     */
    listeners?: {
        action?:  () => void;
        change?:  (value: number) => void;
        binding?: () => void;
    };
}

const TRACK_THICKNESS = 4;
const THUMB_SIZE      = 16;
const DEFAULT_MIN     = 0;
const DEFAULT_MAX     = 100;
const DEFAULT_STEP    = 1;

const _defaultSliderOptions: Partial<SliderOptions> = {
    outline: "none",
    cursor:  "pointer",
};

const _defaultSliderTrackOptions: Partial<ComponentOptions> = {
    backgroundColor: "var(--ts-ui-slider-track-bg, rgb(220, 220, 220))",
    borderRadius:    "999px",
};

/**
 * The track behind a {@link Slider}'s thumb — the resting groove. File-local
 * — not exported from the input barrel because it is a Slider implementation
 * detail. Its backgroundColor/borderRadius are class defaults so every
 * instance shares one `.SliderTrack` CSS rule instead of repeating them.
 */
class SliderTrack extends Component {
    constructor() {
        super(undefined, _defaultSliderTrackOptions);
    }
}

const _defaultSliderActiveTrackOptions: Partial<ComponentOptions> = {
    backgroundColor: "var(--ts-ui-slider-track-active-bg, rgb(30, 100, 200))",
    borderRadius:    "999px",
};

/**
 * The filled portion of a {@link Slider}'s track, from the low end to the
 * thumb. File-local — not exported from the input barrel because it is a
 * Slider implementation detail. Its backgroundColor/borderRadius are class
 * defaults so every instance shares one `.SliderActiveTrack` CSS rule
 * instead of repeating them.
 */
class SliderActiveTrack extends Component {
    constructor() {
        super(undefined, _defaultSliderActiveTrackOptions);
    }
}

const _defaultSliderThumbOptions: Partial<ComponentOptions> = {
    backgroundColor: "var(--ts-ui-slider-thumb-bg, rgb(255, 255, 255))",
    borderRadius:    "50%",
    border:          "1px solid var(--ts-ui-form-border, rgb(160, 160, 160))",
    shadow:          "0 1px 2px rgba(0, 0, 0, 0.25)",
    maxSize:         { width: THUMB_SIZE, height: THUMB_SIZE },
};

/**
 * The draggable handle on a {@link Slider}'s track. File-local — not
 * exported from the input barrel because it is a Slider implementation
 * detail. Its backgroundColor/borderRadius/border/shadow/maxSize are class
 * defaults so every instance shares one `.SliderThumb` CSS rule instead of
 * repeating them.
 */
class SliderThumb extends Component {
    constructor() {
        super(undefined, _defaultSliderThumbOptions);
    }
}

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
    private _track:           SliderTrack;
    private _activeTrack:     SliderActiveTrack;
    private _thumb:           SliderThumb;
    private _draggingPointer: number | null = null;

    /**
     * Constructs a Slider.
     *
     * @param options - Optional construction-time options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: SliderOptions, subclassDefaults?: Partial<SliderOptions>);
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        super(
            { ...(options ?? {}) } as TOptions,
            { ..._defaultSliderOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>,
        );

        this._track = new SliderTrack();
        // Pointer-events pass through to the slider root so `addListener`
        // matches by id on every press, and the root's cursor is what shows
        // on hover anywhere over the control.
        this._track.setPointerEvents("none");

        this._activeTrack = new SliderActiveTrack();
        this._activeTrack.setPointerEvents("none");

        this._thumb = new SliderThumb();
        this._thumb.setPreferredSize({ width: THUMB_SIZE, height: THUMB_SIZE });
        this._thumb.setPointerEvents("none");

        this._track.addComponent(this._activeTrack);
        super.addComponent(this._track);
        super.addComponent(this._thumb);

        this.getAria().setRole("slider");
        this.getAria().setTabIndex(0);
        this.getAria().setValueMin(DEFAULT_MIN);
        this.getAria().setValueMax(DEFAULT_MAX);
        this.getAria().setValueNow(DEFAULT_MIN);

        this.installInteraction();

        if (this._options.min !== undefined) {
            this.applyMin(this._options.min);
        }

        if (this._options.max !== undefined) {
            this.applyMax(this._options.max);
        }

        // The raw constructor argument, not `this._options`: `maxSize`'s
        // instance-layer write no longer mirrors into `_options` (see
        // core/Component.ts's layered style bag), so `_options.maxSize`
        // can no longer stand in for "did the caller pass one".
        this.applyOrientation(this.getOrientation(), options);

        if (this._options.value !== undefined) {
            const snapped = this.snap(this._options.value);
            this._options.value = snapped;
            this.applyValue(snapped);
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

        if (options.value       !== undefined) this._options.value       = options.value;
        if (options.min         !== undefined) this._options.min         = options.min;
        if (options.max         !== undefined) this._options.max         = options.max;
        if (options.step        !== undefined) this._options.step        = options.step;
        if (options.largeStep   !== undefined) this._options.largeStep   = options.largeStep;
        if (options.orientation !== undefined) this._options.orientation = options.orientation;
        if (options.showTicks   !== undefined) this._options.showTicks   = options.showTicks;
        if (options.enabled     !== undefined) this._options.enabled     = options.enabled;
        if (options.readOnly    !== undefined) this._options.readOnly    = options.readOnly;

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
    getOrientation(): AxisOrientation {
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
    setOrientation(orientation: AxisOrientation): this {
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
    on(event: "action",  listener: Event.Listener): this;
    on(event: "change",  listener: (value: number) => void): this;
    on(event: "binding", listener: () => void): this;
    on(event: "action" | "change" | "binding", listener: Function): this {
        if (event === "action") {
            Event.addListener(this, "input", listener as Event.Listener);

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
            Event.removeListener(this, "input", listener as Event.Listener);

            return this;
        }

        return super.off(event, listener);
    }

    /**
     * Returns a baseline near the bottom edge so the slider participates in
     * baseline alignment — sitting with its bottom roughly on the surrounding
     * text baseline — instead of being vertically centred in the row. The 2px
     * lift matches the other graphical controls so it doesn't sit below the
     * text descenders.
     *
     * @returns The preferred height minus 2, or `null` before a size is set.
     */
    getBaseline(): number | null {
        const size = this.getPreferredSize();

        return size ? size.height - 2 : null;
    }

    /**
     * Lays out the track, active fill, and thumb for the current size.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        // The content box, not the inner size: the inner size is the right
        // extent but carries no origin, so a padded slider would lay its track
        // out at the inner edge of its border and ignore the padding it just
        // subtracted. `_activeTrack` keeps its own zero origin — it is a child
        // of `_track`, so it is already inside the track's box.
        const box = this.getContentBounds();
        if (!box) {
            return this;
        }

        const horizontal = this.getOrientation() === "horizontal";

        // `Component.setWidth` / `setHeight` clamp to the component's own
        // maxSize, so `box` is already bounded by our `setMaxSize(_,
        // THUMB_SIZE)` (or `setMaxSize(THUMB_SIZE, _)` when vertical) — no
        // extra cross-axis clamp is needed here.
        const innerWidth  = box.width;
        const innerHeight = box.height;
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
            this._track.setX(box.x);
            this._track.setY(box.y + trackTop);
            this._track.setSize({ width: innerWidth, height: TRACK_THICKNESS });

            const activeWidth = Math.round(innerWidth * fraction);
            this._activeTrack.setX(0);
            this._activeTrack.setY(0);
            this._activeTrack.setSize({ width: activeWidth, height: TRACK_THICKNESS });

            const thumbX = Math.round((innerWidth - THUMB_SIZE) * fraction);
            const thumbY = Math.round((innerHeight - THUMB_SIZE) / 2);
            this._thumb.setSize({ width: THUMB_SIZE, height: THUMB_SIZE });
            this._thumb.setX(box.x + thumbX);
            this._thumb.setY(box.y + thumbY);
        } else {
            const trackLeft = Math.round((innerWidth - TRACK_THICKNESS) / 2);
            this._track.setX(box.x + trackLeft);
            this._track.setY(box.y);
            this._track.setSize({ width: TRACK_THICKNESS, height: innerHeight });

            // Vertical slider: zero is at the bottom by convention.
            const activeHeight = Math.round(innerHeight * fraction);
            this._activeTrack.setX(0);
            this._activeTrack.setY(innerHeight - activeHeight);
            this._activeTrack.setSize({ width: TRACK_THICKNESS, height: activeHeight });

            const thumbX = Math.round((innerWidth - THUMB_SIZE) / 2);
            const thumbY = Math.round((innerHeight - THUMB_SIZE) * (1 - fraction));
            this._thumb.setSize({ width: THUMB_SIZE, height: THUMB_SIZE });
            this._thumb.setX(box.x + thumbX);
            this._thumb.setY(box.y + thumbY);
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
        Event.addListener(this, "pointerdown", (e: PointerEvent): Event.ListenerResult => {
            if (!this.isEnabled() || this.isReadOnly()) {
                return;
            }

            this.focus();

            const element = this.getElement();
            if (element) {
                DOM.sink.setPointerCapture(element, e.pointerId);
                this._draggingPointer = e.pointerId;
            }

            this.setValue(this.valueAtPointer(e));

            return { prevent: true };
        });

        // pointermove defaults to a button-agnostic registration (see
        // Event.ts's PRIMARY_BUTTON_TYPES) since the spec reports its
        // button as always -1. The pointerId check below is the actual gate.
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
            if (element && DOM.source.hasPointerCapture(element, e.pointerId)) {
                DOM.sink.releasePointerCapture(element, e.pointerId);
            }

            this._draggingPointer = null;
        };

        Event.addListener(this, "pointerup",     release);
        // pointercancel and lostpointercapture both default to a
        // button-agnostic registration (see Event.ts's PRIMARY_BUTTON_TYPES),
        // so this cleanup still runs regardless of which button was held.
        Event.addListener(this, "pointercancel", release);
        // Browser releases pointer capture on alt-tab / focus loss. Clear our
        // mirror so the next pointerdown starts clean and there's no stuck-drag.
        Event.addListener(this, "lostpointercapture", release);

        Event.addListener(this, "keydown", (e: KeyboardEvent): Event.ListenerResult => {
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
                    this.setValue(this.getValue() + step);

                    return { prevent: true };
                case "ArrowLeft":
                case "ArrowDown":
                    this.setValue(this.getValue() - step);

                    return { prevent: true };
                case "PageUp":
                    this.setValue(this.getValue() + largeStep);

                    return { prevent: true };
                case "PageDown":
                    this.setValue(this.getValue() - largeStep);

                    return { prevent: true };
                case "Home":
                    this.setValue(min);

                    return { prevent: true };
                case "End":
                    this.setValue(max);

                    return { prevent: true };
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

        // Measured against the same content box `doLayout` draws the track in,
        // not the outer rect: with padding the two disagree by that padding on
        // every pointer sample, and the thumb would trail the cursor. The
        // viewport rect is the border box, so reaching the content origin from
        // it costs the border as well as `getContentBounds`' own offset, which
        // is measured from the padding box.
        const rect       = DOM.source.getViewportRect(this);
        const box        = this.getContentBounds() ?? { x: 0, y: 0, width: rect.width, height: rect.height };
        const border     = this.getBorderSize();
        const left       = rect.left + border.left + box.x;
        const top        = rect.top  + border.top  + box.y;
        const horizontal = this.getOrientation() === "horizontal";
        const fraction   = horizontal
            ? (box.width  > 0 ? (e.clientX - left) / box.width  : 0)
            : (box.height > 0 ? 1 - (e.clientY - top) / box.height : 0);

        const clamped = Util.clamp(fraction, 0, 1);
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

        const clamped = Util.clamp(value, min, max);

        if (step <= 0) {
            return clamped;
        }

        const snapped = min + Math.round((clamped - min) / step) * step;

        return Util.clamp(snapped, min, max);
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
     * landscape and portrait, and forces a layout. A caller-supplied
     * `preferredSize` / `maxSize` wins over the orientation-derived default.
     *
     * @param orientation - `"horizontal"` or `"vertical"`.
     * @param options - Passed only from the constructor, so a caller-supplied
     *   `preferredSize` / `maxSize` wins there; every runtime caller (the public
     *   {@link setOrientation}) omits it, so both are always recomputed from
     *   `orientation`.
     */
    private applyOrientation(orientation: AxisOrientation, options?: SliderOptions): void {
        this.getAria().setOrientation(orientation);

        const horizontal = orientation === "horizontal";

        if (options?.preferredSize !== undefined) {
            this.setPreferredSize(options.preferredSize);
        } else {
            this.setPreferredSize(horizontal
                ? { width: 200, height: THUMB_SIZE }
                : { width: THUMB_SIZE, height: 200 });
        }

        if (options?.maxSize !== undefined) {
            this.setMaxSize(options.maxSize);
        } else {
            this.setMaxSize(horizontal
                ? { width: UNBOUNDED, height: THUMB_SIZE }
                : { width: THUMB_SIZE, height: UNBOUNDED });
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
