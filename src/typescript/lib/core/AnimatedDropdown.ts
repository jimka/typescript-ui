// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Animation } from "~/core/Animation.js";
import { Position } from "~/primitive/Position.js";
import { LayerManager, DismissableLayer, LayerDismissMode } from "~/core/LayerManager.js";
import { callable } from "~/core/Callable.js";

/** Default fade duration in milliseconds. Matches `MENU_ANIM_DURATION_MS` from `Menu`. */
const DEFAULT_DURATION_MS: number = 120;

/** Default entrance vertical-offset distance in pixels. */
const DEFAULT_TRANSLATE_PX: number = 4;

/**
 * Per-component `_dismissing` flag used by the free-function form
 * (`fadeShow` / `fadeHideAndDetach`). `WeakMap`-keyed so a `Component` that
 * never opts into the helper carries no extra state.
 */
const _dismissingByComponent: WeakMap<Component, boolean> = new WeakMap();

/**
 * Construction-time options for {@link AnimatedDropdown}.
 *
 * @category Core
 */
export interface AnimatedDropdownOptions extends ComponentOptions {
    /** When false, `showAnimated` / `hideAnimated` skip the transition. Default: true. */
    animated?:    boolean;
    /** Fade duration in milliseconds. Default: 120. */
    durationMs?:  number;
    /** Vertical translation distance in pixels for the entrance. Default: 4. */
    translatePx?: number;
}

/**
 * Options forwarded to the free-function forms `fadeShow` / `fadeHideAndDetach`.
 *
 * @category Core
 */
export interface FadeOptions {
    /** Fade duration in milliseconds. Default: 120. */
    durationMs?:  number;
    /** Vertical translation distance in pixels for the entrance. Default: 4. */
    translatePx?: number;
    /** When false, the helper bypasses the transition and applies the end state synchronously. Default: true. */
    animated?:    boolean;
    /** Called once the fade completes (or immediately when animation is disabled). */
    onComplete?:  () => void;
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each present setter once
 * with the final value, so any field the caller supplied wins.
 */
const _defaultAnimatedDropdownOptions: Partial<AnimatedDropdownOptions> = {
    visible:     false,
    animated:    true,
    durationMs:  DEFAULT_DURATION_MS,
    translatePx: DEFAULT_TRANSLATE_PX,
};

/**
 * Floating panel that fades in on `showAnimated` and fades out + detaches on
 * `hideAnimated`. Subclasses (e.g. picker dropdowns for `ComboBox`, `DateField`,
 * `TimeField`, `DateTimeField`) own the panel's interactive content; this base
 * class owns only the open/close lifecycle, the `opacity + translateY`
 * transition, the dismissing-flag re-entrancy guard, and the `will-change`
 * pre-promotion.
 *
 * Positioning math (anchor rect, viewport clamping, flip-above-anchor) lives
 * in the host component or in a subclass — `AnimatedDropdown` does not
 * presume anything about where it should appear.
 *
 * ## Pointer-down contract for hosts mounted under a re-used input element
 *
 * Hosts that compose this dropdown alongside a focusable element whose `blur`
 * commits state (e.g. [`CellEditorPool`](/api/component/table/classes/CellEditorPool)'s pooled editors) must call
 * `event.preventDefault()` on **`pointerdown`** inside the dropdown so the
 * host element keeps focus while the dropdown's selection callback runs. The
 * callback then explicitly drives commit. If the dropdown does not suppress
 * the blur, the editor's blur listener fires first, commits the stale value,
 * and the dropdown's later write goes to a no-longer-active editor.
 *
 * @category Core
 */
class AnimatedDropdown<TOptions extends AnimatedDropdownOptions = AnimatedDropdownOptions> extends Component<TOptions> implements DismissableLayer {

    // Set true while a fade-out is in flight; reset to false either when the
    // fade completes (so the deferred detach runs) or when a fresh `showAnimated`
    // re-displays the dropdown mid-fade (the deferred detach skips because the
    // dropdown is back on screen).
    private _dismissing:  boolean = false;
    private _open:        boolean = false;

    /**
     * @param options - Optional construction-time options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults. Subclasses-of-subclasses forward their own defaults
     *   here so the deepest class's values win.
     */
    constructor(options?: AnimatedDropdownOptions, subclassDefaults?: Partial<AnimatedDropdownOptions>) {
        super(
            options as TOptions,
            { ..._defaultAnimatedDropdownOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>,
        );

        // Floating overlays anchor to the viewport, not to a layout-managed
        // ancestor — `Position.FIXED` is the documented exception to the
        // framework's "every component is absolute" rule. See
        // ARCHITECTURE.md §Positioning.
        this.setPosition(Position.FIXED);
    }

    /**
     * Applies an {@link AnimatedDropdownOptions} bag, dispatching dropdown-specific
     * fields after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as TOptions;

        if (opts.animated    !== undefined) this.setAnimated(opts.animated);
        if (opts.durationMs  !== undefined) this.setDurationMs(opts.durationMs);
        if (opts.translatePx !== undefined) this.setTranslatePx(opts.translatePx);

        return this;
    }

    /**
     * Enables or disables the fade transition. When false, `showAnimated` /
     * `hideAnimated` apply visibility synchronously.
     *
     * @param value - true to enable the fade; false for instant show/hide.
     */
    setAnimated(value: boolean): this {
        this._options.animated = value;

        return this;
    }

    /**
     * Returns whether the fade transition is enabled.
     *
     * @returns true when the fade transition runs on show/hide.
     */
    isAnimated(): boolean {
        return this._options.animated ?? true;
    }

    /**
     * Sets the fade duration in milliseconds.
     *
     * @param ms - Duration in milliseconds.
     */
    setDurationMs(ms: number): this {
        this._options.durationMs = ms;

        return this;
    }

    /**
     * Returns the configured fade duration in milliseconds.
     *
     * @returns The duration in milliseconds.
     */
    getDurationMs(): number {
        return this._options.durationMs ?? DEFAULT_DURATION_MS;
    }

    /**
     * Sets the entrance vertical-offset distance in pixels.
     *
     * @param px - Translation distance in pixels.
     */
    setTranslatePx(px: number): this {
        this._options.translatePx = px;

        return this;
    }

    /**
     * Returns the configured entrance vertical-offset distance.
     *
     * @returns The translation distance in pixels.
     */
    getTranslatePx(): number {
        return this._options.translatePx ?? DEFAULT_TRANSLATE_PX;
    }

    /**
     * Mounts the dropdown on `document.documentElement` (if not already mounted)
     * and plays the entrance fade. Cancels any in-flight fade-out so a fresh
     * show mid-dismiss keeps the panel on screen.
     */
    showAnimated(): this {
        // Register on the central layer tree. `LayerManager.register` is a
        // no-op when this layer is already registered (a `_dismissing`-
        // cancelled mid-fade re-show), so the tree never double-pushes.
        LayerManager.register(this);

        // Mirror the manager's band-based z-stamp onto the element so the
        // dropdown lands above its opener (which registered earlier).
        this.setZIndex(LayerManager.getZIndex(this));

        this._dismissing = false;
        this._open       = true;

        const el = this.getElement(true);

        if (!document.documentElement.contains(el)) {
            document.documentElement.appendChild(el);
        }

        this.setVisible(true);

        if (!this.isAnimated()) {
            this.onShowComplete();
            return this;
        }

        this.setWillChange("opacity, transform");

        Animation.play(el, {
            from:       { opacity: "0", transform: `translateY(-${this.getTranslatePx()}px)` },
            to:         { opacity: "1", transform: "translateY(0)" },
            durationMs: this.getDurationMs(),
            properties: ["opacity", "transform"],
            onComplete: () => {
                this.setWillChange(null);
                this.onShowComplete();
            },
        });

        return this;
    }

    /**
     * Plays the exit fade, then hides and detaches the dropdown when the
     * transition completes. A fresh `showAnimated` during the fade cancels the
     * deferred detach by flipping the `_dismissing` flag, so the panel stays
     * mounted.
     */
    hideAnimated(): this {
        this._open = false;

        const el = this.getElement();
        const finalize = (): void => {
            this.setVisible(false);
            this.removeElement();

            // Pop from the central layer tree. `onHideComplete` runs after
            // this so a subclass override sees the layer as already-closed.
            LayerManager.unregister(this);

            this.onHideComplete();
        };

        if (!el || !this.isAnimated()) {
            finalize();
            return this;
        }

        this._dismissing = true;
        this.setWillChange("opacity, transform");

        Animation.play(el, {
            to:         { opacity: "0", transform: `translateY(-${this.getTranslatePx()}px)` },
            durationMs: this.getDurationMs(),
            properties: ["opacity", "transform"],
            onComplete: () => {
                if (!this._dismissing) {
                    this.setWillChange(null);
                    return;
                }
                this._dismissing = false;
                this.setWillChange(null);
                finalize();
            },
        });

        return this;
    }

    /**
     * Returns whether the dropdown is currently open (showing or fading in).
     *
     * @returns true when the dropdown is open.
     */
    isOpen(): boolean {
        return this._open;
    }

    /**
     * Subclass hook: handle a keystroke arriving via the host input's `keydown`
     * listener while the dropdown is open. Subclasses with a navigation surface
     * (e.g. [`DatePickerDropdown`](/api/component/input/classes/DatePickerDropdown))
     * override to consume arrows / Page / Home / End / type-ahead. The base
     * implementation returns `false` so plain dropdowns without keyboard
     * semantics let the host input's contract run.
     *
     * @param _e - The keyboard event forwarded from the host input.
     * @returns True when the dropdown consumed the keystroke (caller should `preventDefault`).
     */
    handleKey(_e: KeyboardEvent): boolean {
        return false;
    }

    /**
     * Places the dropdown relative to an anchor rect at its current
     * width/height, with viewport clamping on both axes. Picks the better of
     * "below" or "above" the anchor vertically (more available space wins
     * when neither side fully fits), and clamps horizontally so the panel
     * never extends past either viewport edge.
     *
     * Callers set `setWidth`/`setHeight` first, then invoke this helper.
     *
     * @param rect - The anchor element's bounding rect (typically from
     *   `anchorEl.getBoundingClientRect()`).
     */
    placeAnchored(rect: DOMRect): this {
        const w = this.getWidth();
        const h = this.getHeight();

        const vpWidth  = window.innerWidth;
        const vpHeight = window.innerHeight;

        // Vertical: prefer below; flip above when below overflows AND above
        // has room; otherwise pick the side with more space and clamp.
        let y: number;
        const spaceBelow = vpHeight - rect.bottom;
        const spaceAbove = rect.top;

        if (h <= spaceBelow) {
            y = rect.bottom;
        } else if (h <= spaceAbove) {
            y = rect.top - h;
        } else if (spaceBelow >= spaceAbove) {
            y = Math.max(0, vpHeight - h);
        } else {
            y = 0;
        }

        // Horizontal: anchor at rect.left, clamp so the panel stays within
        // the viewport on both sides.
        const x = Math.max(0, Math.min(rect.left, vpWidth - w));

        this.setX(x);
        this.setY(y);

        return this;
    }

    /**
     * Hook invoked after the entrance fade completes (or immediately when
     * animation is disabled). Override to wire post-show state.
     */
    protected onShowComplete(): void {
        // default: no-op
    }

    /**
     * Hook invoked after the exit fade completes (or immediately when
     * animation is disabled). Override to wire post-hide cleanup.
     */
    protected onHideComplete(): void {
        // default: no-op
    }

    // ----- DismissableLayer -----

    /**
     * Returns the dropdown's root element for the central layer tree.
     *
     * @returns The dropdown's element, or null when not yet rendered.
     */
    getLayerElement(): HTMLElement | null {
        return this.getElement();
    }

    /**
     * Returns the dismiss mode the document-level handlers consult. The base
     * dropdown is `"manual"` — its host (picker field, ComboBox, …) drives
     * dismissal — until Phase 3 flips the migrated hosts to `"click-outside"`.
     *
     * @returns The layer dismiss mode.
     */
    getDismissMode(): LayerDismissMode {
        return "manual";
    }

    /**
     * Advisory close request from the manager. Runs the standard exit fade +
     * detach, which unregisters the layer on completion.
     */
    requestClose(): void {
        this.hideAnimated();
    }

    /**
     * Returns the dropdown's z-index band so an unrelated top-level dropdown
     * stacks in the dropdown family.
     *
     * @returns The dropdown band base.
     */
    getBand(): number {
        return LayerManager.Band.Dropdown;
    }

    /**
     * Returns true when `target` is a descendant of `layer`'s element or any
     * descendant layer's element. Thin static delegate to
     * [`LayerManager.containsAcrossLayers`](/api/core/namespaces/LayerManager/functions/containsAcrossLayers)
     * so existing host call sites keep working; new code should call the
     * manager directly.
     *
     * @param layer - The layer to test containment for.
     * @param target - The DOM node receiving the click.
     * @returns true when `target` is inside `layer` or any of its descendant layers.
     */
    static isTargetInsideLayer(layer: AnimatedDropdown, target: Node): boolean {
        return LayerManager.containsAcrossLayers(layer, target);
    }

    /**
     * Returns the topmost currently-open layer, or `null` when no layer is
     * open. Thin static delegate to
     * [`LayerManager.getTopLayer`](/api/core/namespaces/LayerManager/functions/getTopLayer).
     *
     * @returns The topmost open layer, or null when none is open.
     */
    static getTopLayer(): DismissableLayer | null {
        return LayerManager.getTopLayer();
    }
}

/**
 * Plays the standard dropdown-style entrance fade on the given component's
 * element. Mirror of {@link AnimatedDropdown.showAnimated} for components that
 * extend `Component` directly and cannot re-parent to `AnimatedDropdown`.
 *
 * Cancels any in-flight fade-out queued by {@link fadeHideAndDetach} so a
 * fresh show mid-dismiss keeps the panel on screen.
 *
 * @param component - The component to fade in.
 * @param options - Optional duration / translate / animated overrides.
 */
export function fadeShow(component: Component, options?: FadeOptions): void {
    const durationMs  = options?.durationMs  ?? DEFAULT_DURATION_MS;
    const translatePx = options?.translatePx ?? DEFAULT_TRANSLATE_PX;
    const animated    = options?.animated    ?? true;

    _dismissingByComponent.set(component, false);

    const el = component.getElement();

    if (!el) {
        options?.onComplete?.();
        return;
    }

    if (!animated) {
        options?.onComplete?.();
        return;
    }

    component.setWillChange("opacity, transform");

    Animation.play(el, {
        from:       { opacity: "0", transform: `translateY(-${translatePx}px)` },
        to:         { opacity: "1", transform: "translateY(0)" },
        durationMs: durationMs,
        properties: ["opacity", "transform"],
        onComplete: () => {
            component.setWillChange(null);
            options?.onComplete?.();
        },
    });
}

/**
 * Plays the standard dropdown-style exit fade on the given component's
 * element, then hides and detaches it from the DOM when the transition
 * completes.
 *
 * A fresh {@link fadeShow} during the fade cancels the deferred detach so the
 * panel stays mounted.
 *
 * @param component - The component to fade out and detach.
 * @param options - Optional duration / translate / animated overrides; `onComplete` fires after detach.
 */
export function fadeHideAndDetach(component: Component, options?: FadeOptions): void {
    const durationMs  = options?.durationMs  ?? DEFAULT_DURATION_MS;
    const translatePx = options?.translatePx ?? DEFAULT_TRANSLATE_PX;
    const animated    = options?.animated    ?? true;

    const el = component.getElement();
    const finalize = (): void => {
        component.setVisible(false);
        component.removeElement();
        options?.onComplete?.();
    };

    if (!el || !animated) {
        finalize();
        return;
    }

    _dismissingByComponent.set(component, true);
    component.setWillChange("opacity, transform");

    Animation.play(el, {
        to:         { opacity: "0", transform: `translateY(-${translatePx}px)` },
        durationMs: durationMs,
        properties: ["opacity", "transform"],
        onComplete: () => {
            if (!_dismissingByComponent.get(component)) {
                component.setWillChange(null);
                return;
            }
            _dismissingByComponent.set(component, false);
            component.setWillChange(null);
            finalize();
        },
    });
}

const AnimatedDropdownCallable = callable(AnimatedDropdown);
type AnimatedDropdownCallable<TOptions extends AnimatedDropdownOptions = AnimatedDropdownOptions> = AnimatedDropdown<TOptions>;
export {
    AnimatedDropdown         as _AnimatedDropdown,
    AnimatedDropdownCallable as AnimatedDropdown
};
