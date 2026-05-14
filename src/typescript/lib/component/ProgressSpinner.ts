// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/Component.js";
import { CSS } from "~/CSS.js";
import { Position } from "~/Position.js";
import { BorderStyle } from "~/BorderStyle.js";
import { ThemeManager } from "~/Theme.js";
import { callable } from "~/Callable.js";

/**
 * Construction-time options for {@link ProgressSpinner}.
 *
 * @category Components
 */
export interface ProgressSpinnerOptions extends ComponentOptions {
    spinnerSize?: number;
}

CSS.ensureKeyframes(
    'ts-ui-progress-spinner-rotate',
    'from { transform: rotate(0deg); } to { transform: rotate(360deg); }'
);

const ARC_BORDER_WIDTH = 3;

/**
 * Reads the active theme's `--ts-ui-font-size` as a pixel value.
 *
 * @returns The current theme font size in pixels, or `14` as a fallback.
 */
function getThemeFontSize(): number {
    const raw    = getComputedStyle(document.documentElement)
                       .getPropertyValue("--ts-ui-font-size").trim();
    const parsed = parseFloat(raw);

    return isNaN(parsed) ? 14 : parsed;
}

/**
 * A circular loading indicator rendered as a rotating arc.
 *
 * Supports two usage modes:
 * - **Inline**: instantiate, size, and add to a parent like any other component.
 * - **Overlay**: call {@link showOverlay} to mount the spinner as an absolute
 *   overlay over a target component, complete with a semi-transparent backdrop.
 *   {@link hideOverlay} removes it.
 *
 * @category Components
 */
class ProgressSpinner extends Component {

    private arc: Component;
    private size: number;
    private trackThemeFontSize: boolean;
    private overlayTarget: Component | null = null;

    /**
     * Constructs a ProgressSpinner.
     *
     * @param size - Optional. Diameter in pixels of the arc when used inline.
     * Omit to track the active theme's `--ts-ui-font-size` so the spinner
     * matches surrounding text by default; updates automatically on theme change.
     */
    constructor(size?: number, options?: ProgressSpinnerOptions) {
        super();

        this.trackThemeFontSize = size === undefined;
        this.size               = this.trackThemeFontSize ? getThemeFontSize() : size!;

        // Use no insets so the arc fills the declared size — otherwise the
        // default 4-pixel inset shrinks a 24-pixel spinner's arc to 16 pixels
        // and leaves 8 pixels of empty space around it.
        this.setInsets(null);

        this.arc = new Component();
        this.arc.setPosition(Position.ABSOLUTE);
        this.arc.setBorderRadius("50%");
        this.arc.setBorder({
            style: BorderStyle.SOLID,
            width: ARC_BORDER_WIDTH,
            color: "var(--ts-ui-progress-spinner-color, rgb(30, 100, 200))",
            top  : { style: BorderStyle.SOLID, width: ARC_BORDER_WIDTH, color: "transparent" },
        });
        this.arc.setElementCSSRule("animation", "ts-ui-progress-spinner-rotate 0.8s linear infinite");

        super.addComponent(this.arc);

        this.setPreferredSize(this.size, this.size);

        if (this.trackThemeFontSize) {
            ThemeManager.onThemeChange(() => {
                if (!this.trackThemeFontSize) {
                    return;
                }

                const next = getThemeFontSize();
                if (next === this.size) {
                    return;
                }

                this.size = next;
                this.setPreferredSize(next, next);
                this.scheduleLayout();
            });
        }

        this.getAria().setRole("status");
        this.getAria().setLabel("Loading");

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link ProgressSpinnerOptions} bag, dispatching the explicit
     * spinner diameter after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: ProgressSpinnerOptions): this {
        super.applyOptions(options);

        if (options.spinnerSize !== undefined) {
            this.setSpinnerSize(options.spinnerSize);
        }

        return this;
    }

    /**
     * Returns the spinner arc diameter in pixels.
     *
     * @returns The diameter.
     */
    getSpinnerSize(): number {
        return this.size;
    }

    /**
     * Sets a new arc diameter and updates the component's preferred size.
     *
     * @param size - Diameter in pixels.
     *
     * @remarks Calling this disables the default theme-font-size tracking so
     * the spinner stays at the explicit size across subsequent theme changes.
     */
    setSpinnerSize(size: number): this {
        this.trackThemeFontSize = false;

        if (this.size === size) {
            return this;
        }

        this.size = size;
        this.setPreferredSize(size, size);
        this.scheduleLayout();

        return this;
    }

    /**
     * Mounts this ProgressSpinner as an absolute overlay covering the given component.
     *
     * The spinner element is appended directly to the target's DOM element (bypassing
     * the target's layout manager, mirroring how `Window` mounts itself onto
     * `document.documentElement`). Sized to the target's full bounds with a
     * semi-transparent backdrop and the spinning arc centred inside it. No-op if
     * already shown as an overlay.
     *
     * @param target - The component to overlay.
     */
    showOverlay(target: Component): void {
        if (this.overlayTarget) {
            return;
        }

        this.overlayTarget = target;

        this.setPosition(Position.ABSOLUTE);
        this.setBackgroundColor("var(--ts-ui-progress-spinner-backdrop, rgba(255, 255, 255, 0.6))");
        this.setZIndex(9999);

        const targetEl  = target.getElement(true);
        const spinnerEl = this.getElement(true);

        targetEl.appendChild(spinnerEl);

        this.setX(0);
        this.setY(0);
        this.setSize({ width: target.getWidth(), height: target.getHeight() });
        this.doLayout();
    }

    /**
     * Removes the overlay from its target and resets state. No-op if not currently shown
     * as an overlay.
     */
    hideOverlay(): void {
        if (!this.overlayTarget) {
            return;
        }

        this.overlayTarget = null;

        this.removeElement();

        this.setBackgroundColor(null);
        this.setZIndex(0);
    }

    /**
     * Returns whether the spinner is currently mounted as an overlay.
     *
     * @returns True if showOverlay has been called and hideOverlay has not.
     */
    isOverlay(): boolean {
        return this.overlayTarget !== null;
    }

    /**
     * Lays out the inner arc element at the centre of the component bounds.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        if (this.overlayTarget) {
            this.setSize({ width: this.overlayTarget.getWidth(), height: this.overlayTarget.getHeight() });
        }

        const inner = this.getInnerSize();
        if (!inner) {
            super.doLayout();

            return this;
        }

        const diameter = Math.min(this.size, inner.width, inner.height);
        const x        = Math.round((inner.width  - diameter) / 2);
        const y        = Math.round((inner.height - diameter) / 2);

        this.arc.setX(x);
        this.arc.setY(y);
        this.arc.setSize({ width: diameter, height: diameter });

        super.doLayout();

        return this;
    }
}

const ProgressSpinnerCallable = callable(ProgressSpinner);
type ProgressSpinnerCallable = ProgressSpinner;
export {
    ProgressSpinner         as _ProgressSpinner,
    ProgressSpinnerCallable as ProgressSpinner
};
