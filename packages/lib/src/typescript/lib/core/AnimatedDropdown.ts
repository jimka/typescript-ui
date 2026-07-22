// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Animation } from "~/core/Animation.js";
import { Position } from "~/primitive/Position.js";
import { LayerManager, DismissableLayer, LayerDismissMode } from "~/core/LayerManager.js";
import { positionAnchored } from "~/core/OverlayPosition.js";
import { callable } from "~/core/Callable.js";
import { DOM, type Rect, type Handle } from "~/core/DOM.js";

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

/** Handle for the fade paths that finish before there is anything to cancel. */
const NOOP_HANDLE: Animation.CancelHandle = { cancel: (): void => {} };

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
 * These are a pure fallback: a caller value wins, otherwise the getters
 * (`isVisible`, `isAnimated`, `getDurationMs`, `getTranslatePx`) resolve the
 * default — `visible: false` is folded by `Component.isVisible`, the rest are
 * dispatched from `applyOptions` as `options.X ?? this.getX()`.
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

    // Host-supplied close thunk invoked from `requestClose` instead of the
    // bare `hideAnimated`, so the host (a picker field, a ComboBox) can run
    // its own teardown (caret rotation, aria-expanded, commit) when the
    // manager dismisses the layer on an outside click. Null until a host
    // opts into the `"click-outside"` dismiss path.
    private _closeHandler: (() => void) | null = null;

    // Anchor element (the trigger) excluded from the manager's outside-click
    // test so the click that toggles the dropdown does not immediately
    // re-close it. Null for dropdowns whose host owns the toggle gating.
    private _anchorElement: Handle | null = null;

    // In-flight entrance / exit fades, cancelled on teardown so their fallback
    // timers cannot fire against this dropdown's released element handle.
    private _showAnimation: Animation.CancelHandle | null = null;
    private _hideAnimation: Animation.CancelHandle | null = null;

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

        // These carry a class default and seed construction-time state, so
        // always dispatch the caller value or the class default.
        this.setAnimated(options.animated ?? this.isAnimated());
        this.setDurationMs(options.durationMs ?? this.getDurationMs());
        this.setTranslatePx(options.translatePx ?? this.getTranslatePx());

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
        return this._options.animated ?? this._defaultOptions.animated!;
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
        return this._options.durationMs ?? this._defaultOptions.durationMs!;
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
        return this._options.translatePx ?? this._defaultOptions.translatePx!;
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

        const el = this.getElement(true)!;

        LayerManager.mount(el);

        this.setVisible(true);

        if (!this.isAnimated()) {
            this.onShowComplete();
            return this;
        }

        this.setWillChange("opacity, transform");

        this._showAnimation?.cancel();
        this._showAnimation = Animation.play(el, {
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

        this._hideAnimation?.cancel();
        this._hideAnimation = Animation.play(el, {
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
     * Mirrors a manager-allocated z-index onto the element when the dropdown —
     * or the window / surface it was opened inside — is raised via
     * {@link LayerManager.bringToFront}. Without this, the dropdown reads its
     * z once in {@link showAnimated} and never updates; raising its host window
     * (a `mousedown` brings the window to front) would then re-stamp the host
     * above the dropdown's stale z, hiding the open panel — and its fade-out —
     * behind the window.
     *
     * @param zIndex - The fresh z-index assigned by the manager.
     */
    onZIndexChanged(zIndex: number): void {
        this.setZIndex(zIndex);
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
     * width/height. Picks the better of "below" or "above" the anchor
     * vertically (more available space wins when neither side fully fits).
     * Horizontally the panel left-aligns to the anchor, flipping to
     * right-align with the anchor's right edge when the left alignment
     * would overflow the viewport, and clamping only when neither alignment
     * fits.
     *
     * Callers set `setWidth`/`setHeight` first, then invoke this helper.
     *
     * @param rect - The anchor element's bounding rect (typically from
     *   `DOM.source.getElementRect(anchorEl)`).
     */
    placeAnchored(rect: Rect): this {
        const size = { width: this.getWidth(), height: this.getHeight() };
        const vp   = DOM.source.getViewportSize();

        // Vertical growth: prefer below, flip above when below overflows and
        // above has room. Horizontally: align to the anchor's left, flip to
        // its right when that overflows, clamp only as a last resort. The
        // flip/align/clamp geometry lives in the shared pure primitive.
        const { x, y } = positionAnchored(rect, size, vp, { axis: "vertical" });

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

    /**
     * Cancels any in-flight entrance / exit fade, then defers to the base
     * class. Cancelling first keeps the fade's fallback timer from firing after
     * `super.destructor()` has released this dropdown's element handle.
     */
    protected destructor(): void {
        this._showAnimation?.cancel();
        this._showAnimation = null;
        this._hideAnimation?.cancel();
        this._hideAnimation = null;

        super.destructor();
    }

    // ----- DismissableLayer -----

    /**
     * Returns the dropdown's root element for the central layer tree.
     *
     * @returns The dropdown's element, or null when not yet rendered.
     */
    getLayerElement(): Handle | null {
        return this.getElement() ?? null;
    }

    /**
     * Returns the dismiss mode the document-level handlers consult. The
     * dropdown is `"click-outside"`: the manager closes it when a
     * `pointerdown` lands outside both the dropdown's layer subtree and its
     * anchor. A click inside a descendant layer counts as inside, so a nested
     * dropdown keeps its opener open.
     *
     * @returns The layer dismiss mode.
     */
    getDismissMode(): LayerDismissMode {
        return "click-outside";
    }

    /**
     * Advisory close request from the manager. Runs the host-supplied close
     * thunk when one is set (so the host can rotate a caret, clear
     * aria-expanded, or commit), otherwise the standard exit fade + detach.
     */
    requestClose(): void {
        if (this._closeHandler) {
            this._closeHandler();

            return;
        }

        this.hideAnimated();
    }

    /**
     * Returns the anchor element excluded from the manager's outside-click
     * test, or null when the host gates the toggle itself.
     *
     * @returns The anchor element, or null.
     */
    getAnchorElement(): Handle | null {
        return this._anchorElement;
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
     * Installs the close thunk the manager calls from {@link requestClose}
     * when this dropdown is dismissed by an outside click. The host passes its
     * own close routine so the dropdown's teardown and the host's UI state
     * (caret, aria-expanded, commit) stay in lockstep.
     *
     * @param handler - The host's close routine, or null to fall back to
     *   {@link hideAnimated}.
     * @returns This dropdown, for method chaining.
     */
    setCloseHandler(handler: (() => void) | null): this {
        this._closeHandler = handler;

        return this;
    }

    /**
     * Records the anchor (trigger) element excluded from the manager's
     * outside-click test, so the gesture that opened the dropdown does not
     * immediately re-close it.
     *
     * @param el - The anchor element, or null to clear it.
     * @returns This dropdown, for method chaining.
     */
    setAnchorElement(el: Handle | null): this {
        this._anchorElement = el;

        return this;
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
 * @returns A handle the caller stores and cancels on its own teardown.
 */
export function fadeShow(component: Component, options?: FadeOptions): Animation.CancelHandle {
    const durationMs  = options?.durationMs  ?? DEFAULT_DURATION_MS;
    const translatePx = options?.translatePx ?? DEFAULT_TRANSLATE_PX;
    const animated    = options?.animated    ?? true;

    _dismissingByComponent.set(component, false);

    const el = component.getElement();

    if (!el) {
        options?.onComplete?.();
        return NOOP_HANDLE;
    }

    if (!animated) {
        options?.onComplete?.();
        return NOOP_HANDLE;
    }

    component.setWillChange("opacity, transform");

    return Animation.play(el, {
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
 * @returns A handle the caller stores and cancels on its own teardown.
 */
export function fadeHideAndDetach(component: Component, options?: FadeOptions): Animation.CancelHandle {
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
        return NOOP_HANDLE;
    }

    _dismissingByComponent.set(component, true);
    component.setWillChange("opacity, transform");

    return Animation.play(el, {
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
