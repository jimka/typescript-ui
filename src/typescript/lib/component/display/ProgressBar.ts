// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { callable } from "~/core/Callable.js";

StyleRule.ensureKeyframes(
    'ts-ui-progress-indeterminate',
    '0% { transform: translateX(-100%); } 100% { transform: translateX(400%); }'
);

/**
 * Construction-time options for {@link ProgressBar}.
 *
 * @category Components
 */
export interface ProgressBarOptions extends ComponentOptions {
    value?:         number;
    indeterminate?: boolean;
}

/**
 * A horizontal progress indicator with a determinate (0–100%) and an indeterminate
 * (continuously animated) mode.
 *
 * The component renders a track child filling its inner bounds and a fill child
 * inside the track whose width is driven by the current value. In indeterminate
 * mode the fill is sized to roughly a quarter of the track and slides across
 * via a CSS keyframe animation.
 *
 * @category Components
 */
class ProgressBar extends Component {

    private _track: Component;
    private _fill : Component;
    private _value: number;
    private _indeterminate: boolean;

    /**
     * Constructs a ProgressBar.
     *
     * @param value - Initial progress value in [0, 100]. Defaults to 0.
     * @param indeterminate - When true the bar animates continuously and value is ignored.
     */
    constructor(value: number = 0, indeterminate: boolean = false, options?: ProgressBarOptions) {
        super();

        this._value         = Math.max(0, Math.min(100, value));
        this._indeterminate = indeterminate;

        this.setBackgroundColor("var(--ts-ui-progress-track-bg, rgb(220, 220, 220))");
        this.setBorderRadius("var(--ts-ui-progress-track-radius, 4px)");

        this._track = new Component();
        this._track.setOverflow("hidden");
        this._track.setBorderRadius("var(--ts-ui-progress-track-radius, 4px)");

        this._fill = new Component();
        this._fill.setBackgroundColor("var(--ts-ui-progress-fill-bg, rgb(30, 100, 200))");

        this._track.addComponent(this._fill);
        super.addComponent(this._track);

        this.getAria().setRole("progressbar");
        this.getAria().setValueMin(0);
        this.getAria().setValueMax(100);
        this.getAria().setValueNow(this._value);

        if (this._indeterminate) {
            this.applyIndeterminate(true);
        }

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link ProgressBarOptions} bag, dispatching value and
     * indeterminate state after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: ProgressBarOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as ProgressBarOptions;

        if (opts.indeterminate !== undefined) {
            this.setIndeterminate(opts.indeterminate);
        }

        if (opts.value !== undefined) {
            this.setValue(opts.value);
        }

        return this;
    }

    /**
     * Returns a baseline near the bottom of the bar so that, when placed in an
     * [`HBox`](/api/layout/classes/HBox) next to text labels, the bar sits with its bottom roughly on the
     * surrounding text baseline (CSS replaced-element behaviour, with a 2 px
     * lift so it doesn't sit visually lower than the text descenders).
     *
     * @returns The current preferred height minus 2, or `null` before a size is set.
     */
    getBaseline(): number | null {
        const size = this.getPreferredSize();

        return size ? size.height - 2 : null;
    }

    /**
     * Returns the current progress value (0–100).
     *
     * @returns The current percentage, or 0 when indeterminate.
     */
    getValue(): number {
        return this._indeterminate ? 0 : this._value;
    }

    /**
     * Sets the progress value and updates the fill width. Clamps to [0, 100].
     * Has no visual effect while in indeterminate mode.
     *
     * @param value - Progress percentage in [0, 100].
     */
    setValue(value: number): this {
        const clamped = Math.max(0, Math.min(100, value));
        if (clamped === this._value) {
            return this;
        }

        this._value = clamped;
        this.getAria().setValueNow(clamped);

        if (!this._indeterminate) {
            this.scheduleLayout();
        }

        return this;
    }

    /**
     * Returns whether the bar is in indeterminate (animated) mode.
     *
     * @returns True if indeterminate mode is active.
     */
    isIndeterminate(): boolean {
        return this._indeterminate;
    }

    /**
     * Activates or deactivates indeterminate animation mode.
     *
     * @param value - True to activate indeterminate mode.
     */
    setIndeterminate(value: boolean): this {
        if (this._indeterminate === value) {
            return this;
        }

        this._indeterminate = value;
        this.applyIndeterminate(value);
        this.scheduleLayout();

        return this;
    }

    /**
     * Lays out the track and fill child components.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        const inner = this.getInnerSize();
        if (!inner) {
            super.doLayout();
            return this;
        }

        this._track.setX(0);
        this._track.setY(0);
        this._track.setSize({ width: inner.width, height: inner.height });

        if (this._indeterminate) {
            const segment = Math.max(20, Math.round(inner.width * 0.25));
            this._fill.setX(0);
            this._fill.setY(0);
            this._fill.setSize({ width: segment, height: inner.height });
        } else {
            const fillWidth = Math.round(inner.width * this._value / 100);
            this._fill.setX(0);
            this._fill.setY(0);
            this._fill.setSize({ width: fillWidth, height: inner.height });
        }

        super.doLayout();

        return this;
    }

    /**
     * Toggles the CSS animation property on the fill element to enter or leave
     * indeterminate mode and updates the fill colour accordingly.
     *
     * @param value - True to start the animation, false to stop it.
     */
    private applyIndeterminate(value: boolean): void {
        if (value) {
            this._fill.setBackgroundColor("var(--ts-ui-progress-indeterminate-bg, rgb(30, 100, 200))");
            this._fill.setAnimation("ts-ui-progress-indeterminate 1.4s ease-in-out infinite");
        } else {
            this._fill.setBackgroundColor("var(--ts-ui-progress-fill-bg, rgb(30, 100, 200))");
            this._fill.clearAnimation();
        }
    }
}

const ProgressBarCallable = callable(ProgressBar);
type ProgressBarCallable = ProgressBar;
export {
    ProgressBar         as _ProgressBar,
    ProgressBarCallable as ProgressBar
};
