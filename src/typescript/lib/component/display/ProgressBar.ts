// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { CSS } from "~/core/CSS.js";
import { Position } from "~/primitive/Position.js";
import { callable } from "~/core/Callable.js";

CSS.ensureKeyframes(
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

    private track: Component;
    private fill : Component;
    private value: number;
    private indeterminate: boolean;

    /**
     * Constructs a ProgressBar.
     *
     * @param value - Initial progress value in [0, 100]. Defaults to 0.
     * @param indeterminate - When true the bar animates continuously and value is ignored.
     */
    constructor(value: number = 0, indeterminate: boolean = false, options?: ProgressBarOptions) {
        super();

        this.value         = Math.max(0, Math.min(100, value));
        this.indeterminate = indeterminate;

        this.setBackgroundColor("var(--ts-ui-progress-track-bg, rgb(220, 220, 220))");
        this.setBorderRadius("var(--ts-ui-progress-track-radius, 4px)");

        this.track = new Component();
        this.track.setPosition(Position.ABSOLUTE);
        this.track.setOverflow("hidden");
        this.track.setBorderRadius("var(--ts-ui-progress-track-radius, 4px)");

        this.fill = new Component();
        this.fill.setPosition(Position.ABSOLUTE);
        this.fill.setBackgroundColor("var(--ts-ui-progress-fill-bg, rgb(30, 100, 200))");

        this.track.addComponent(this.fill);
        super.addComponent(this.track);

        this.getAria().setRole("progressbar");
        this.getAria().setValueMin(0);
        this.getAria().setValueMax(100);
        this.getAria().setValueNow(this.value);

        if (this.indeterminate) {
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

        if (options.indeterminate !== undefined) {
            this.setIndeterminate(options.indeterminate);
        }

        if (options.value !== undefined) {
            this.setValue(options.value);
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
        return this.indeterminate ? 0 : this.value;
    }

    /**
     * Sets the progress value and updates the fill width. Clamps to [0, 100].
     * Has no visual effect while in indeterminate mode.
     *
     * @param value - Progress percentage in [0, 100].
     */
    setValue(value: number): this {
        const clamped = Math.max(0, Math.min(100, value));
        if (clamped === this.value) {
            return this;
        }

        this.value = clamped;
        this.getAria().setValueNow(clamped);

        if (!this.indeterminate) {
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
        return this.indeterminate;
    }

    /**
     * Activates or deactivates indeterminate animation mode.
     *
     * @param value - True to activate indeterminate mode.
     */
    setIndeterminate(value: boolean): this {
        if (this.indeterminate === value) {
            return this;
        }

        this.indeterminate = value;
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

        this.track.setX(0);
        this.track.setY(0);
        this.track.setSize({ width: inner.width, height: inner.height });

        if (this.indeterminate) {
            const segment = Math.max(20, Math.round(inner.width * 0.25));
            this.fill.setX(0);
            this.fill.setY(0);
            this.fill.setSize({ width: segment, height: inner.height });
        } else {
            const fillWidth = Math.round(inner.width * this.value / 100);
            this.fill.setX(0);
            this.fill.setY(0);
            this.fill.setSize({ width: fillWidth, height: inner.height });
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
            this.fill.setBackgroundColor("var(--ts-ui-progress-indeterminate-bg, rgb(30, 100, 200))");
            this.fill.setElementCSSRule("animation", "ts-ui-progress-indeterminate 1.4s ease-in-out infinite");
        } else {
            this.fill.setBackgroundColor("var(--ts-ui-progress-fill-bg, rgb(30, 100, 200))");
            this.fill.setElementCSSRule("animation", null);
        }
    }
}

const ProgressBarCallable = callable(ProgressBar);
type ProgressBarCallable = ProgressBar;
export {
    ProgressBar         as _ProgressBar,
    ProgressBarCallable as ProgressBar
};
