// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { callable } from "~/core/Callable.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";

/**
 * Construction-time options for {@link ProgressSpinner}.
 *
 * @category Components
 */
export interface ProgressSpinnerOptions extends ComponentOptions {
    spinnerSize?: number;
}

StyleRule.ensureKeyframes(
    'ts-ui-progress-spinner-rotate',
    'from { transform: rotate(0deg); } to { transform: rotate(360deg); }'
);

const ARC_BORDER_WIDTH = 3;

/** The arc's fixed ring geometry: a full circle with one transparent side,
 *  which the rotation keyframe sweeps around. Identical on every spinner. */
const _defaultProgressSpinnerArcOptions: Partial<ComponentOptions> = {
    borderRadius: "50%",
    border: {
        border:    `${ARC_BORDER_WIDTH}px solid var(--ts-ui-progress-spinner-color, rgb(30, 100, 200))`,
        borderTop: `${ARC_BORDER_WIDTH}px solid transparent`,
    },
};

/**
 * The rotating ring inside a {@link ProgressSpinner}. Its geometry never
 * varies by instance, so it lives on the shared `.ProgressSpinnerArc` class
 * rule; only the rotation animation stays a per-instance write, because
 * `Component.onEffectiveVisibilityChange` pauses it by reading
 * `getAnimation()`.
 */
class ProgressSpinnerArc extends Component {

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. The same constant the
    // constructor forwards as `subclassDefaults`, so both tiers agree.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultProgressSpinnerArcOptions;

    constructor(options?: ComponentOptions, subclassDefaults?: Partial<ComponentOptions>) {
        super(options, {
            ..._defaultProgressSpinnerArcOptions,
            ...(subclassDefaults ?? {})
        });

        this.setAnimation("ts-ui-progress-spinner-rotate 0.8s linear infinite");
    }
}

/**
 * Reads the active theme's `--ts-ui-font-size` as a pixel value.
 *
 * @returns The current theme font size in pixels, or `14` as a fallback.
 */
function readThemeFontSizePx(): number {
    const raw    = DOM.source.getThemeVar("--ts-ui-font-size");
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

    private _arc: ProgressSpinnerArc;
    private _size: number;
    private _trackThemeFontSize: boolean;
    private _themeFontSizeResolved: boolean = false;
    private _overlayTarget: Component | null = null;

    /**
     * Constructs a ProgressSpinner.
     *
     * @param size - Optional. Diameter in pixels of the arc when used inline.
     * Omit to track the active theme's `--ts-ui-font-size` so the spinner
     * matches surrounding text by default; updates automatically on theme change.
     */
    constructor(size?: number, options?: ProgressSpinnerOptions) {
        // Child components are built first; options are applied via applyOptions at the constructor tail.
        // eslint-disable-next-line local/forward-super-options
        super();

        this._trackThemeFontSize = size === undefined;
        // Theme font-size is resolved at first `doLayout` (post-attach) so
        // construction stays JS-only per ARCHITECTURE.md "Defer DOM work to
        // render time". Use the same `14` fallback that `readThemeFontSizePx`
        // returns when the variable is missing, so the preferred-size write a
        // few lines below has a sensible value before the theme read fires.
        this._size               = this._trackThemeFontSize ? 14 : size!;

        // Use no insets so the arc fills the declared size — otherwise the
        // default 4-pixel inset shrinks a 24-pixel spinner's arc to 16 pixels
        // and leaves 8 pixels of empty space around it.
        this.clearInsets();

        this._arc = new ProgressSpinnerArc();

        super.addComponent(this._arc);

        this.setPreferredSize({ width: this._size, height: this._size });

        if (this._trackThemeFontSize) {
            this.subscribeTheme(() => {
                if (!this._trackThemeFontSize) {
                    return;
                }

                const next = readThemeFontSizePx();
                if (next === this._size) {
                    return;
                }

                this._size = next;
                this.setPreferredSize({ width: next, height: next });
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
     *
     * @remarks Returns the most recently resolved diameter; when the spinner
     * tracks the theme font-size (default constructor with no `size` argument),
     * the resolved value is only available after the first layout pass — earlier
     * calls return the `14`-pixel fallback.
     */
    getSpinnerSize(): number {
        return this._size;
    }

    /**
     * Returns a baseline near the bottom edge so the spinner participates in
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
     * Sets a new arc diameter and updates the component's preferred size.
     *
     * @param size - Diameter in pixels.
     *
     * @remarks Calling this disables the default theme-font-size tracking so
     * the spinner stays at the explicit size across subsequent theme changes.
     */
    setSpinnerSize(size: number): this {
        this._trackThemeFontSize = false;

        if (this._size === size) {
            return this;
        }

        this._size = size;
        this.setPreferredSize({ width: size, height: size });
        this.scheduleLayout();

        return this;
    }

    /**
     * Mounts this ProgressSpinner as an absolute overlay covering the given component.
     *
     * The spinner element is appended directly to the target's DOM element (bypassing
     * the target's layout manager, mirroring how [`Window`](/api/overlay/classes/Window)
     * mounts itself onto `document.documentElement`). Sized to the target's full bounds with a
     * semi-transparent backdrop and the spinning arc centred inside it. No-op if
     * already shown as an overlay.
     *
     * @param target - The component to overlay.
     */
    showOverlay(target: Component): void {
        if (this._overlayTarget) {
            return;
        }

        this._overlayTarget = target;

        this.setBackgroundColor("var(--ts-ui-progress-spinner-backdrop, rgba(255, 255, 255, 0.6))");
        this.setZIndex(9999);

        const targetEl  = target.getElement(true)!;
        const spinnerEl = this.getElement(true)!;

        DOM.sink.appendChild(targetEl, spinnerEl);

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
        if (!this._overlayTarget) {
            return;
        }

        this._overlayTarget = null;

        this.removeElement();

        this.clearBackgroundColor();
        this.setZIndex(0);
    }

    /**
     * Returns whether the spinner is currently mounted as an overlay.
     *
     * @returns True if showOverlay has been called and hideOverlay has not.
     */
    isOverlay(): boolean {
        return this._overlayTarget !== null;
    }

    /**
     * Lays out the inner arc element at the centre of the component bounds.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        if (this._trackThemeFontSize && !this._themeFontSizeResolved) {
            this._themeFontSizeResolved = true;

            const next = readThemeFontSizePx();
            if (next !== this._size) {
                this._size = next;
                this.setPreferredSize({ width: next, height: next });
            }
        }

        if (this._overlayTarget) {
            this.setSize({ width: this._overlayTarget.getWidth(), height: this._overlayTarget.getHeight() });
        }

        // The content box, not the inner size: the inner size gives the right
        // extent to centre within but no origin, so a padded spinner would
        // centre the arc in the padding box and ignore the padding it just
        // subtracted.
        const box = this.getContentBounds();
        if (!box) {
            super.doLayout();

            return this;
        }

        const diameter = Math.min(this._size, box.width, box.height);
        const x        = box.x + Math.round((box.width  - diameter) / 2);
        const y        = box.y + Math.round((box.height - diameter) / 2);

        this._arc.setX(x);
        this._arc.setY(y);
        this._arc.setSize({ width: diameter, height: diameter });

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
