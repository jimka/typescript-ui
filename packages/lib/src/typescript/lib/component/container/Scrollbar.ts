// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Animation } from "~/core/Animation.js";
import { Component, ComponentOptions } from "~/core/Component.js";
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";
import { Event } from "~/core/Event.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { beginPointerDrag, endPointerDrag } from "~/core/PointerDrag.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { AutoRepeat } from "~/core/AutoRepeat.js";
import { Glyph, GlyphOptions } from "~/component/display/Glyph.js";
import type { HorizontalSide } from "~/primitive/Edge.js";
import { callable } from "~/core/Callable.js";
import type { AxisOrientation } from "~/primitive/Axis.js";

/**
 * String-literal union of the events emitted by {@link Scrollbar}.
 *
 * @category Components
 */
export type ScrollbarEvent = "scroll";

/**
 * String-literal union of the events emitted by the file-local
 * `ScrollArrowButton`.
 */
type ScrollArrowEvent = "tick";

// Fixed cross-axis (track) width of the custom Scrollbar, in pixels —
// independent of the OS/browser's native scrollbar width, which
// `DOM.source.getScrollBarWidth()` measures separately for genuinely
// native scroll paths. Exported so a caller that needs to reserve space
// for a Scrollbar it doesn't hold an instance of yet (e.g. Table's
// column-width and header-button layout math) can read the value
// directly — the same shape `CollapseSupport.ts` uses for
// `COLLAPSE_STRIP_SIZE`.
//
// Deliberately not one of `Theme["scale"]`'s `glyph*` icon-size steps
// (plans/implemented/glyph-icon-size-scale.md), even though it numerically
// equals `glyphSm` in every shipped theme today. This value sizes the
// scrollbar's own physical track/thumb/arrow-button geometry — an
// ergonomic touch-target width, not a decorative icon size — and also sets
// Table's column-width reservation (Table.ts:getAvailableColumnWidth) and
// the header menu-button band width (layout/Table.ts). The arrow glyph
// (ScrollArrowGlyph, below) and the table header's menu-button glyph
// already size their ink directly off this constant, so both would follow
// automatically if it ever became theme-relative — but that is a distinct
// decision from the icon scale, investigated and rejected in
// plans/glyph-icon-host-box-migration.md.
export const TRACK_WIDTH = 12;
const THUMB_INSET    = 2;
const THUMB_MIN_SIZE = 30;

// Font size for the Unicode triangle character rendered in each arrow button.
// The arrow box is TRACK_WIDTH (12) px square; the ambient 14 px theme font
// produces a 16 px line-box that overflows the 12 px element and is clipped
// at the bottom by `overflow: hidden`, leaving the visible triangle slid up
// against the top edge. 10 px shrinks the line-box (= font-size × line-height
// 1) below the element height so the character fits with even padding above
// and below — matches the value [`AccordionIndicator`](./AccordionIndicator.ts)
// uses for its `▶` chevron.
const ARROW_GLYPH_FONT_SIZE = 10;

// Initial hold-repeat delay and acceleration parameters for ScrollArrowButton.
// Mirrors SpinButton's scheduler so a long press on either widget produces the
// same accelerating tick cadence — 400 ms first interval, multiplied by 0.75
// each tick, floored at 40 ms.
const ARROW_REPEAT_INITIAL_MS = 400;
const ARROW_REPEAT_DECAY      = 0.75;
const ARROW_REPEAT_FLOOR_MS   = 40;

// Default per-click scroll step in pixels for arrow buttons. Roughly two rows
// at default font size in the Table; chosen as a fixed pixel value rather than
// a derived fraction of viewport so the step size stays predictable as content
// grows. Owners can override via `setArrowStep(px)`.
const DEFAULT_ARROW_STEP_PX = 40;

// Crossfade duration for the arrow's enabled↔disabled colour swap. Matches the
// 120 ms ease-out cadence Checkbox / Toggle / RadioButton use for their state
// crossfades so the scrollbar's arrows read as the same UI vocabulary; short
// enough to feel instant while softening the hard colour flip at each edge.
const ARROW_FADE_DURATION_MS = 120;

/**
 * Callback type fired by {@link Scrollbar} when the user drags the thumb or
 * clicks the track. Receives the new scroll position in pixels.
 *
 * @category Components
 */
export type ScrollbarListener = (position: number) => void;

/**
 * Construction-time options for {@link Scrollbar}.
 *
 * @category Components
 */
export interface ScrollbarOptions extends ComponentOptions {

    /**
     * When `true`, the scrollbar renders classic OS-style arrow buttons at
     * each end of the track (up/down for vertical, left/right for horizontal).
     * The buttons step the scroll position by {@link ScrollbarOptions.arrowStep}
     * pixels per click and accelerate while held. The matching arrow shows a
     * dimmed disabled-state colour when scroll is already at that edge.
     * Defaults to `true`; set `false` to suppress the arrows for a minimalist
     * look.
     */
    arrowsEnabled?: boolean;

    /**
     * Per-click scroll step in pixels for the arrow buttons. Ignored when
     * `arrowsEnabled` is `false`. Defaults to `40`.
     */
    arrowStep?: number;

    /**
     * Multi-event listener bag dispatched to {@link Scrollbar.on} at
     * construction time.
     */
    listeners?: {
        scroll?: ScrollbarListener;
    };
}

/**
 * Direction for a `ScrollArrowButton`. `"up"` / `"down"` go on the ends
 * of a vertical scrollbar; `"left"` / `"right"` on a horizontal one.
 */
type ArrowDirection = HorizontalSide | "up" | "down";

const _defaultScrollArrowButtonOptions: Partial<ComponentOptions> = {
    backgroundColor: "var(--ts-ui-scrollbar-arrow-bg, transparent)",
    foregroundColor: "var(--ts-ui-scrollbar-arrow-color, rgba(0, 0, 0, 0.55))",
};

/** `.disabled`'s color declaration, read by `ownStyleStates`' `.disabled` entry. */
const SCROLL_ARROW_DISABLED_DECLARATIONS: Readonly<Record<string, string>> = Object.freeze({
    color: "var(--ts-ui-scrollbar-arrow-disabled-color, rgba(0, 0, 0, 0.18))",
});

const _defaultScrollArrowGlyphOptions: Partial<GlyphOptions> = {
    minSize: { width: TRACK_WIDTH, height: TRACK_WIDTH },
    maxSize: { width: TRACK_WIDTH, height: TRACK_WIDTH },
};

/**
 * The Unicode-triangle glyph inside a {@link ScrollArrowButton}. `minSize`/
 * `maxSize` are a class default (TRACK_WIDTH square) via the constructor's
 * `subclassDefaults` bag, and `fontSize`/`lineHeight`/`textAlign` are a class
 * default too via `getClassStyleDefaults()` — so every arrow across every
 * Scrollbar shares one `.ScrollArrowGlyph` CSS rule instead of each repeating
 * all seven declarations. `ScrollArrowButton`'s own constructor still calls
 * `setPreferredSize`/`setFontSize` imperatively (a `Glyph`'s
 * construction-time size/font pins cannot themselves be deferred to a
 * defaults bag — see `Glyph.applyOptions` and its char-mode constructor
 * guard), but each call now resolves to the same value this class already
 * defaults, so `Component.applyStyle`'s render-time reconciliation turns it
 * into a removal instead of a redundant per-instance declaration.
 */
class ScrollArrowGlyph extends Glyph {
    /**
     * @param direction - One of `"up"`, `"down"`, `"left"`, `"right"`.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; forwarded so a subclass can seed a default without
     *   editing this constant.
     */
    constructor(direction: ArrowDirection, subclassDefaults?: Partial<GlyphOptions>) {
        super("unicode-arrow-" + direction, undefined, { ..._defaultScrollArrowGlyphOptions, ...(subclassDefaults ?? {}) });
    }

    protected getClassStyleDefaults(): StyleBag {
        return {
            ...super.getClassStyleDefaults(),
            font: { fontSize: ARROW_GLYPH_FONT_SIZE + "px", lineHeight: "1", textAlign: "center" },
        };
    }
}

/**
 * A press-and-hold arrow button rendered at one end of a {@link Scrollbar}'s
 * track when arrows are enabled. File-local — not exported from the container
 * barrel because it is a Scrollbar implementation detail.
 *
 * Mirrors the [`SpinButton`](/api/component/input/classes/SpinButton)
 * hold-repeat cadence: a click fires one tick, holding accelerates from a
 * 400 ms initial interval to a 40 ms floor, and release cancels the schedule.
 * When in the disabled state, mousedown is ignored and the glyph renders in
 * the dim colour token.
 */
class ScrollArrowButton extends Component {

    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".disabled",
            extract: (): StyleBag => ({ foregroundColor: SCROLL_ARROW_DISABLED_DECLARATIONS.color }),
        },
    ];

    private _glyph:         Glyph;
    private _disabled:      boolean                              = false;
    private _listeners:     ListenerBag<ScrollArrowEvent>        = this.registerListenerBag(new ListenerBag<ScrollArrowEvent>());
    private _repeat:        AutoRepeat;

    // `restingGuardSuffix`/`restingIsolationKeys` (core/Component.ts) are
    // now derived from `ownStyleStates` above, so `color` — the CSS key
    // `.disabled` declares — is isolated automatically. The old fixed
    // isolation-key set couldn't protect it (it was hand-picked to
    // `{backgroundColor, backgroundImage, boxShadow}` only), which is
    // exactly the gap this plan's derived isolation set closes; moot in
    // practice either way, since nothing calls
    // `this.setForegroundColor(...)` on this component's own resting tier.

    /**
     * Constructs a square TRACK_WIDTH × TRACK_WIDTH arrow button pointing in
     * the given direction.
     *
     * @param direction - One of `"up"`, `"down"`, `"left"`, `"right"`.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; forwarded so a subclass can seed a default without
     *   editing this constant.
     */
    constructor(direction: ArrowDirection, subclassDefaults?: Partial<ComponentOptions>) {
        super(undefined, { ..._defaultScrollArrowButtonOptions, ...(subclassDefaults ?? {}) });

        this.setWidth(TRACK_WIDTH);
        this.setHeight(TRACK_WIDTH);
        this.setCursor("default");

        // Fade the enabled↔disabled colour swap in setDisabledState instead of a hard
        // switch. Declared at construction (mirrors Checkbox's crossfade) so the initial
        // colour — the start arrow's dim state set by Scrollbar.buildArrows before first
        // paint — appears instantly, and only later at-edge toggles fade. Honours
        // prefers-reduced-motion.
        if (!Animation.isReducedMotion()) {
            this.setTransition("color " + ARROW_FADE_DURATION_MS + "ms ease-out");
        }

        // Fill the full TRACK_WIDTH × TRACK_WIDTH button so `text-align: center`
        // + `line-height: 1` (Glyph char-mode defaults) centre the character
        // within that box. The explicit `fontSize` shrinks the inherited
        // 14 px size so the Unicode triangle's line-box (which scales with
        // font-size) fits inside the 12 px element box and isn't clipped at
        // the bottom by `overflow: hidden` — mirrors the same fix
        // AccordionIndicator applies to its `▶` chevron.
        this._glyph = new ScrollArrowGlyph(direction);
        this._glyph.setPreferredSize({ width: TRACK_WIDTH, height: TRACK_WIDTH });
        this._glyph.setFontSize(ARROW_GLYPH_FONT_SIZE);
        // The glyph fills the whole button, so without this a click's target is
        // the glyph element. The Event system routes `addListener` callbacks only
        // to the exact target id (no bubbling), so the arrow's own
        // mousedown/mouseover/mouseout handlers below would never fire. Making
        // the glyph non-interactive lets pointer events fall through to the arrow.
        this._glyph.setPointerEvents("none");

        super.addComponent(this._glyph);

        this._repeat = new AutoRepeat({
            initialDelay: ARROW_REPEAT_INITIAL_MS,
            decay:        ARROW_REPEAT_DECAY,
            floor:        ARROW_REPEAT_FLOOR_MS,
            onTick:       () => this.emit("tick"),
        });

        Event.addListener(this, "mousedown", { stop: true, prevent: true, handler: this._onMouseDown });
        Event.addListener(this, "mouseover",  this._onMouseOver);
        Event.addListener(this, "mouseout",   this._onMouseOut);
        Event.addViewportListener(this, "mouseup",    this._onMouseUp);
        Event.addViewportListener(this, "mouseleave", this._onMouseUp);
    }

    /**
     * Registers a listener for one of this arrow button's events.
     *
     * @param event - `"tick"` fires on each logical tick (initial mousedown
     *   plus every subsequent hold-repeat tick).
     * @param listener - The callback invoked when the event fires.
     *
     * @returns This arrow button, for method chaining.
     */
    on(event: "tick",            listener: () => void): this;
    on(event: ScrollArrowEvent,  listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback reference
     * must match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This arrow button, for method chaining.
     */
    off(event: ScrollArrowEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event` with no arguments.
     *
     * @param event - The event to emit.
     */
    protected emit(event: "tick"): void;
    protected emit(event: ScrollArrowEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Returns whether this arrow is currently in the at-edge disabled state.
     *
     * @returns `true` when disabled, `false` otherwise.
     */
    isDisabledState(): boolean {
        return this._disabled;
    }

    /**
     * Toggles the disabled visual state and behaviour. Disabled arrows render
     * the glyph in the dim colour token and ignore mousedown events; any
     * in-flight hold-repeat schedule is cancelled.
     *
     * @param disabled - `true` to disable, `false` to enable.
     */
    setDisabledState(disabled: boolean): void {
        if (this._disabled === disabled) {
            return;
        }

        this._disabled = disabled;

        if (disabled) {
            this._repeat.stop();
        }

        // Unconditional, not gated on `this.getElement()`: `setStyleState`
        // updates `_activeStates` regardless of whether an element exists
        // yet (only its own DOM write is internally element-gated) — a
        // pre-render `setDisabledState` call (this method is invoked from
        // the constructor) must still record the state.
        this.setStyleState(".disabled", disabled);
    }

    /** Re-applies the cached disabled state at render, for a state set before mount. */
    protected render(): Handle {
        const element = super.render();
        DOM.sink.apply(element, { toggleClass: { disabled: this._disabled } });
        return element;
    }

    /**
     * Handles mousedown on the button. Stops propagation so the parent
     * Scrollbar's track-click handler does not also fire, then (if not
     * disabled) fires the first tick and schedules accelerating repeats.
     *
     * @param e - The mousedown event. Only ever a primary-button press — the
     * default `button: "primary"` registration filters the rest.
     *
     * @remarks Consumes the press and suppresses the browser's default text
     * selection via the registration's `stop`/`prevent` floor.
     */
    private _onMouseDown = (_e: MouseEvent): void => {
        if (!this._disabled) {
            this._repeat.start();
        }
    };

    /**
     * Cancels the hold-repeat schedule on mouseup or when the pointer leaves
     * the viewport.
     */
    private _onMouseUp = (): void => {
        if (!this._repeat.isRunning()) {
            return;
        }

        this._repeat.stop();
    };

    /**
     * Darkens the button background on hover, mirroring the thumb-hover idiom.
     */
    private _onMouseOver = (): void => {
        if (this._disabled) {
            return;
        }

        this.setBackgroundColor("var(--ts-ui-scrollbar-arrow-hover-bg, rgba(0, 0, 0, 0.06))");
    };

    /**
     * Restores the resting background when the pointer leaves the button.
     */
    private _onMouseOut = (): void => {
        this.setBackgroundColor("var(--ts-ui-scrollbar-arrow-bg, transparent)");
    };

}

const _defaultScrollbarOptions: Partial<ScrollbarOptions> = {
    backgroundColor: "var(--ts-ui-scrollbar-track, rgba(0, 0, 0, 0.04))",
    touchAction:     "none",
};

const _defaultScrollbarThumbOptions: Partial<ComponentOptions> = {
    cursor:          "grab",
    backgroundColor: "var(--ts-ui-scrollbar-thumb, rgba(0, 0, 0, 0.35))",
};

/** `.hover`'s backgroundColor declaration, read by `ownStyleStates`' `.hover` entry. */
const SCROLLBAR_THUMB_HOVER_DECLARATIONS: Readonly<Record<string, string>> = Object.freeze({
    backgroundColor: "var(--ts-ui-scrollbar-thumb-hover, rgba(0, 0, 0, 0.55))",
});

/**
 * The draggable thumb inside a {@link Scrollbar}'s track. File-local — not
 * exported from the container barrel because it is a Scrollbar implementation
 * detail, mirroring {@link ScrollArrowButton}.
 */
class ScrollbarThumb extends Component {
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".hover",
            extract: (): StyleBag => ({ backgroundColor: SCROLLBAR_THUMB_HOVER_DECLARATIONS.backgroundColor }),
        },
    ];

    private _hovered: boolean = false;

    constructor() {
        super(undefined, _defaultScrollbarThumbOptions);
    }

    /** Applies the hover/drag highlight. Called by `Scrollbar.updateThumbFill`. */
    applyHoverState(hovered: boolean): void {
        this._hovered = hovered;

        // Unconditional, not gated on `this.getElement()` — see
        // `ScrollArrowButton.setDisabledState`'s comment for why.
        this.setStyleState(".hover", hovered);
    }

    protected render(): Handle {
        const element = super.render();
        DOM.sink.apply(element, { toggleClass: { hover: this._hovered } });
        return element;
    }
}

/**
 * The DOM class every {@link Scrollbar} root element carries. `Component.init`
 * stamps `this.constructor.name` on every component's element unconditionally
 * (alongside the shared `ts-ui-component` class), and this is the literal that
 * produces for a `Scrollbar` instance.
 */
const SCROLLBAR_ROOT_CLASS = "Scrollbar";

/**
 * Returns whether `e`'s target lies inside a {@link Scrollbar}'s own DOM
 * subtree (track, thumb, or arrow buttons). Scrollbars are raw-appended by
 * `Panel.installOverlayScrollbars` outside the Component tree (never through
 * `addComponent`), so a caller can't recognise one by walking
 * `getParentComponent()` — this walks the live DOM instead.
 *
 * This exists for callers that install a blanket `pointerdown` guard over a
 * whole subtree (e.g. a dropdown panel's focus-loss protection, which calls
 * `preventDefault()` so clicking inside the panel doesn't blur the host
 * input before a click is delivered). Calling `preventDefault()` on a
 * `pointerdown` whose target is inside a Scrollbar is exactly what breaks
 * it: per the Pointer Events spec, that suppresses the browser's synthesized
 * `mousedown` compatibility event for a real mouse pointer, and the thumb
 * drag / track-page handlers (`_onDragStart` / `_onTrackClick`) are wired to
 * `mousedown` — so the scrollbar goes dead to mouse input. A blanket guard
 * must check this and skip `preventDefault()` when it's true; doing so can't
 * reintroduce the focus-loss bug the guard exists for, since a Scrollbar
 * never holds DOM focus.
 *
 * @param e - The DOM event to test.
 * @returns True when the event originated inside a Scrollbar's element.
 */
export function isScrollbarTarget(e: Event): boolean {
    if (!DOM.source.isNode(e.target)) {
        return false;
    }

    for (let handle: Handle | null = DOM.source.intern(e.target); handle; handle = DOM.source.getParentElement(handle)) {
        if (DOM.source.matches(handle, "." + SCROLLBAR_ROOT_CLASS)) {
            return true;
        }
    }

    return false;
}

/**
 * A custom virtual scrollbar overlay.
 *
 * Designed for components that own their own scroll state (e.g. transform-based
 * virtual lists) and don't expose native browser scrolling. The owner pushes
 * viewport/content metrics in via {@link Scrollbar.setMetrics} and subscribes
 * to scroll position changes via {@link Scrollbar.on}.
 *
 * The thumb is dragged with the mouse; clicking the track above/beside the
 * thumb pages by one viewport. The scrollbar hides itself when content fits in
 * the viewport. Classic OS-style arrow buttons at each end of the track are
 * controlled by {@link ScrollbarOptions.arrowsEnabled} — enabled by default;
 * set it `false` for a minimalist look.
 *
 * Available in vertical (default) and horizontal orientations; the owner is
 * responsible for sizing the primary axis (height for vertical, width for
 * horizontal) and positioning the bar on the cross axis.
 *
 * @category Components
 */
class Scrollbar extends Component<ScrollbarOptions> {

    private _orientation     : AxisOrientation     = "vertical";
    private _thumb           : ScrollbarThumb;
    private _viewportSize    : number                   = 0;
    private _contentSize     : number                   = 0;
    private _scrollPosition  : number                   = 0;
    // Sentinel `-1` rather than `0` so the first `setMetrics` call always
    // writes the thumb's size/position through to the DOM, even when the
    // computed values happen to be `0` (e.g. scroll position at top with
    // arrows enabled, where the constructor-time `setY(0)` would otherwise
    // never get corrected to the arrow-region origin offset).
    private _thumbSize       : number                   = -1;
    private _thumbPos        : number                   = -1;
    private _dragStartClient : number                   = 0;
    private _dragStartScroll : number                   = 0;
    // Track hover and drag independently so the thumb-hover fill (driven by
    // updateThumbFill) can stay applied for the whole drag even once the
    // pointer strays outside the thumb's bounds and fires a native mouseout.
    private _thumbHovered    : boolean                  = false;
    private _thumbDragging   : boolean                  = false;
    private _listeners       : ListenerBag<ScrollbarEvent> = this.registerListenerBag(new ListenerBag<ScrollbarEvent>());

    private _arrowsEnabled   : boolean                  = true;
    private _arrowStep       : number                   = DEFAULT_ARROW_STEP_PX;
    private _arrowStart      : ScrollArrowButton | null = null;
    private _arrowEnd        : ScrollArrowButton | null = null;

    /**
     * Constructs a Scrollbar.
     *
     * @param orientation - `"vertical"` (default) or `"horizontal"`.
     * @param options - Optional configuration bag. ComponentOptions fields are
     *   forwarded to `super` so the standard cascade applies; the
     *   arrow-specific fields are read here ahead of any DOM construction.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(orientation: AxisOrientation = "vertical", options?: ScrollbarOptions, subclassDefaults?: Partial<ScrollbarOptions>) {
        super(options, { ..._defaultScrollbarOptions, ...(subclassDefaults ?? {}) });

        this._orientation = orientation;

        // Pull arrow configuration out of options ahead of any DOM work so the
        // thumb / arrow construction below sees the final flags. ComponentOptions
        // fields (visible, backgroundColor, etc.) are already applied by super.
        if (options?.arrowStep !== undefined) {
            this._arrowStep = options.arrowStep;
        }
        if (options?.arrowsEnabled !== undefined) {
            this._arrowsEnabled = options.arrowsEnabled;
        }

        this.setUserSelect("none");

        // Purely decorative: the real scroll semantics live on the native scroll
        // region this widget mirrors (overlay Panel, VirtualScroller), so hide the
        // track / thumb / arrow subtree from assistive tech rather than have it
        // announce a stack of non-interactive divs. Matches Spacer / Glyph.
        this.getAria().setHidden(true);

        if (this.isVertical()) {
            this.setWidth(TRACK_WIDTH);
        } else {
            this.setHeight(TRACK_WIDTH);
        }

        this._thumb = new ScrollbarThumb();

        // Pre-promote to its own compositor layer: setThumbPos moves the
        // thumb via translate on every scroll tick, so the layer should
        // already exist before the first drag/scroll pays to create it.
        this._thumb.setWillChange("transform");

        if (this.isVertical()) {
            this._thumb.setX(THUMB_INSET);
            this._thumb.setY(0);
            this._thumb.setWidth(TRACK_WIDTH - 2 * THUMB_INSET);
        } else {
            this._thumb.setX(0);
            this._thumb.setY(THUMB_INSET);
            this._thumb.setHeight(TRACK_WIDTH - 2 * THUMB_INSET);
        }

        super.addComponent(this._thumb);

        if (this._arrowsEnabled) {
            this.buildArrows();
        }

        Event.addListener(this._thumb, "mousedown",  { prevent: true, handler: this._onDragStart });
        // touchstart defaults to a passive native listener (see Event.ts's
        // PASSIVE_TYPES), which silently no-ops preventDefault() — override
        // explicitly so the `prevent: true` floor above actually applies.
        // NOTE: Event installs exactly one window-level native listener per
        // event type, shared by every registration of that type — so this
        // isn't scoped to just this Scrollbar. Constructing ANY Scrollbar
        // locks "touchstart" as passive: false for the WHOLE PAGE for the
        // lifetime of the app (see docs/reference/migration/next.md).
        Event.addListener(this._thumb, "touchstart", { passive: false, prevent: true, handler: this._onDragStart });
        Event.addListener(this._thumb, "mouseover",  this._onThumbMouseOver);
        Event.addListener(this._thumb, "mouseout",   this._onThumbMouseOut);
        Event.addListener(this, "mousedown",  { prevent: true, handler: this._onTrackClick });
        // touchstart defaults to a passive native listener (see Event.ts's
        // PASSIVE_TYPES), which silently no-ops preventDefault() — override
        // explicitly so the `prevent: true` floor above actually applies.
        // Same page-wide-lock caveat as the thumb's registration above.
        Event.addListener(this, "touchstart", { passive: false, prevent: true, handler: this._onTrackClick });

        this.applyListeners(options?.listeners);
    }

    /**
     * Constructs and wires the two arrow buttons. Both are seeded at `(0, 0)`;
     * their real position and cross-axis extent are set in `setMetrics`, which
     * is the first point the bar's content box is known. Disabled-state for the
     * start arrow is pre-set since `_scrollPosition` defaults to 0 — without
     * this the start arrow renders enabled for one frame before `setMetrics`
     * corrects it.
     */
    private buildArrows(): void {
        const startDirection: ArrowDirection = this.isVertical() ? "up"   : "left";
        const endDirection:   ArrowDirection = this.isVertical() ? "down" : "right";

        this._arrowStart = new ScrollArrowButton(startDirection);
        this._arrowStart.setX(0);
        this._arrowStart.setY(0);
        this._arrowStart.on("tick", this._onArrowStartTick);
        this._arrowStart.setDisabledState(true);
        super.addComponent(this._arrowStart);

        this._arrowEnd = new ScrollArrowButton(endDirection);
        // Both axes depend on the bar's content box, which is not resolved yet;
        // `setMetrics` writes the origin and the cross-axis extent.
        this._arrowEnd.setX(0);
        this._arrowEnd.setY(0);
        this._arrowEnd.on("tick", this._onArrowEndTick);
        super.addComponent(this._arrowEnd);
    }

    /**
     * Bound forwarder for the start arrow's `"tick"` event. Kept as a class
     * field so {@link off}-style detachment would have a stable reference.
     */
    private _onArrowStartTick = (): void => this.onArrowTick(-1);

    /**
     * Bound forwarder for the end arrow's `"tick"` event.
     */
    private _onArrowEndTick = (): void => this.onArrowTick(+1);

    /**
     * Computes the next scroll position one `_arrowStep` away from the current
     * one, clamps it to the valid range, and fires scroll listeners if it
     * changed. The owner's listener call back into `setMetrics` next frame,
     * which refreshes `atStart` / `atEnd` and updates the arrow disabled state.
     *
     * @param direction - `-1` for the start arrow, `+1` for the end arrow.
     */
    private onArrowTick(direction: -1 | 1): void {
        const maxScroll   = Math.max(0, this._contentSize - this._viewportSize);
        const newPosition = Math.max(0, Math.min(maxScroll, this._scrollPosition + direction * this._arrowStep));

        if (newPosition !== this._scrollPosition) {
            this.emit("scroll", newPosition);
        }
    }

    /**
     * Tears down both arrow buttons. Called when arrows are toggled off at
     * runtime; safe when no arrows are currently mounted.
     */
    private disposeArrows(): void {
        if (this._arrowStart) {
            super.removeComponent(this._arrowStart);
            this._arrowStart = null;
        }
        if (this._arrowEnd) {
            super.removeComponent(this._arrowEnd);
            this._arrowEnd = null;
        }
    }

    /**
     * Darkens the thumb fill when the cursor moves over it.
     */
    private _onThumbMouseOver = (): void => {
        this._thumbHovered = true;
        this.updateThumbFill();
    };

    /**
     * Restores the thumb's resting fill when the cursor leaves it, unless a
     * drag is still in progress.
     */
    private _onThumbMouseOut = (): void => {
        this._thumbHovered = false;
        this.updateThumbFill();
    };

    /**
     * Applies the thumb-hover fill whenever the pointer is over the thumb or a
     * drag is in progress, and the resting fill otherwise — so the highlight
     * persists for the whole drag even once the pointer strays outside the
     * thumb's bounds (which fires a native mouseout mid-drag).
     */
    private updateThumbFill(): void {
        this._thumb.applyHoverState(this._thumbHovered || this._thumbDragging);
    }

    /**
     * Registers a listener for one of this scrollbar's events.
     *
     * @param event - `"scroll"` fires when the user changes the scroll
     *   position by dragging the thumb, clicking the track, or pressing an
     *   arrow button, receiving the new scroll position in pixels.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This scrollbar, for method chaining.
     */
    on(event: "scroll",        listener: ScrollbarListener): this;
    on(event: ScrollbarEvent,  listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback reference
     * must match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This scrollbar, for method chaining.
     */
    off(event: ScrollbarEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event` with `payload`, in
     * registration order.
     *
     * @param event - The event to emit.
     * @param payload - Forwarded to each listener.
     */
    protected emit(event: "scroll",       position: number): void;
    protected emit(event: ScrollbarEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Pushes viewport/content metrics and the current scroll position into the
     * scrollbar. Recomputes the thumb's size, position, and cross-axis extent
     * against the content box, and hides the scrollbar if the content fits in
     * the viewport. When arrows are enabled, repositions both arrows against
     * the content box and refreshes the disabled-at-edge state on both.
     *
     * @param viewportSize - The visible window size in pixels along the scroll axis.
     * @param contentSize - The total scrollable content size in pixels along the scroll axis.
     * @param scrollPosition - The current scroll offset in pixels.
     */
    setMetrics(viewportSize: number, contentSize: number, scrollPosition: number): this {
        this._viewportSize   = viewportSize;
        this._contentSize    = contentSize;
        this._scrollPosition = scrollPosition;

        const overflow = contentSize > viewportSize;
        this.setDisplayed(overflow);

        if (!overflow) {
            return this;
        }

        const trackLength = this.getTrackLength();
        if (trackLength <= 0) {
            return this;
        }

        const ratio        = viewportSize / contentSize;
        const newThumbSize = Math.max(THUMB_MIN_SIZE, Math.floor(trackLength * ratio));
        if (this._thumbSize !== newThumbSize) {
            this._thumbSize = newThumbSize;
            this.setThumbSize(newThumbSize);
        }

        const maxScroll = Math.max(0, contentSize - viewportSize);
        const maxThumb  = Math.max(0, trackLength - newThumbSize);
        const newThumbPos = maxScroll > 0 ? Math.round((scrollPosition / maxScroll) * maxThumb) : 0;
        if (this._thumbPos !== newThumbPos) {
            this._thumbPos = newThumbPos;
            this.setThumbPos(newThumbPos);
        }

        const axis = this.axisBox();

        // The thumb's cross-axis extent narrows with a bordered/padded content
        // box; re-derived every call, mirroring the end arrow's write below.
        if (this.isVertical()) {
            this._thumb.setX(axis.crossOrigin + THUMB_INSET);
            this._thumb.setWidth(axis.crossExtent - 2 * THUMB_INSET);
        } else {
            this._thumb.setY(axis.crossOrigin + THUMB_INSET);
            this._thumb.setHeight(axis.crossExtent - 2 * THUMB_INSET);
        }

        if (this._arrowsEnabled && this._arrowStart && this._arrowEnd) {
            // Position both arrows against the content box — the start arrow
            // at its origin, the end arrow at (origin + extent - TRACK_WIDTH).
            const endPos = axis.origin + axis.extent - TRACK_WIDTH;

            // The cross-axis extent too, not just the origin: the arrows are
            // built as a rigid TRACK_WIDTH square, so a bordered bar would keep
            // them at their full width inside a narrower box and overrun the
            // side the border is on. The main axis stays TRACK_WIDTH — that is
            // the gutter the track math reserves at each end.
            if (this.isVertical()) {
                this._arrowStart.setX(axis.crossOrigin);
                this._arrowStart.setY(axis.origin);
                this._arrowStart.setWidth(axis.crossExtent);
                this._arrowEnd.setX(axis.crossOrigin);
                this._arrowEnd.setY(endPos);
                this._arrowEnd.setWidth(axis.crossExtent);
            } else {
                this._arrowStart.setY(axis.crossOrigin);
                this._arrowStart.setX(axis.origin);
                this._arrowStart.setHeight(axis.crossExtent);
                this._arrowEnd.setY(axis.crossOrigin);
                this._arrowEnd.setX(endPos);
                this._arrowEnd.setHeight(axis.crossExtent);
            }

            this._arrowStart.setDisabledState(scrollPosition <= 0);
            this._arrowEnd.setDisabledState(scrollPosition >= maxScroll);
        }

        return this;
    }

    /**
     * Returns the static track width in pixels (the cross-axis dimension).
     *
     * @returns The fixed track width.
     */
    getTrackWidth(): number {
        return TRACK_WIDTH;
    }

    /**
     * Returns the scrollbar's orientation.
     *
     * @returns `"vertical"` or `"horizontal"`.
     */
    getOrientation(): AxisOrientation {
        return this._orientation;
    }

    /**
     * Returns whether the arrow buttons at each end of the track are enabled.
     *
     * @returns `true` when arrows are rendered, `false` otherwise.
     */
    isArrowsEnabled(): boolean {
        return this._arrowsEnabled;
    }

    /**
     * Enables or disables the end-cap arrow buttons. Intended for
     * construction-time use via {@link ScrollbarOptions.arrowsEnabled};
     * runtime toggles are supported but tear down or build the arrow
     * components on the fly and re-run `setMetrics` against the cached
     * viewport / content / scroll-position triple so the thumb size / position
     * recompute against the new track length.
     *
     * @param enabled - `true` to render arrows, `false` to remove them.
     * @returns This scrollbar, for method chaining.
     */
    setArrowsEnabled(enabled: boolean): this {
        if (this._arrowsEnabled === enabled) {
            return this;
        }

        this._arrowsEnabled = enabled;

        if (enabled) {
            this.buildArrows();
        } else {
            this.disposeArrows();
        }

        this.setMetrics(this._viewportSize, this._contentSize, this._scrollPosition);

        return this;
    }

    /**
     * Returns the per-click scroll step in pixels used by the arrow buttons.
     *
     * @returns The cached arrow step.
     */
    getArrowStep(): number {
        return this._arrowStep;
    }

    /**
     * Sets the per-click scroll step in pixels used by the arrow buttons.
     * No-op when arrows are not enabled, except that the new value is cached
     * and applies on a subsequent {@link Scrollbar.setArrowsEnabled}`(true)`.
     *
     * @param px - The new step size in pixels.
     * @returns This scrollbar, for method chaining.
     */
    setArrowStep(px: number): this {
        this._arrowStep = px;

        return this;
    }

    /**
     * Returns true if this is a vertical scrollbar.
     *
     * @returns True for vertical, false for horizontal.
     */
    private isVertical(): boolean {
        return this._orientation === "vertical";
    }

    /**
     * The content box projected onto the scroll axis: `origin` and `extent` run
     * along it, `crossOrigin` and `crossExtent` across it. Falls back to the
     * outer box while the element does not exist yet.
     */
    private axisBox(): { origin: number; extent: number; crossOrigin: number; crossExtent: number } {
        const box = this.getContentBounds()
                 ?? { x: 0, y: 0, width: this.getWidth() || 0, height: this.getHeight() || 0 };

        return this.isVertical()
            ? { origin: box.y, extent: box.height, crossOrigin: box.x, crossExtent: box.width }
            : { origin: box.x, extent: box.width,  crossOrigin: box.y, crossExtent: box.height };
    }

    /**
     * Returns the length of the track along the scroll axis available for the
     * thumb to travel, measured in the content box. Subtracts the two arrow
     * regions when arrows are enabled so the thumb travel range stays inside
     * the track between them.
     */
    private getTrackLength(): number {
        const inset = this._arrowsEnabled ? 2 * TRACK_WIDTH : 0;

        return Math.max(0, this.axisBox().extent - inset);
    }

    /**
     * Returns the primary-axis offset, in the content box, where the track
     * region (thumb travel area) starts. The content-box origin, plus
     * `TRACK_WIDTH` when arrows are enabled (skipping the start arrow).
     */
    private getTrackOrigin(): number {
        const axis = this.axisBox();

        return axis.origin + (this._arrowsEnabled ? TRACK_WIDTH : 0);
    }

    /**
     * Sets the thumb's size along the scroll axis.
     *
     * @param size - The new thumb size in pixels.
     */
    private setThumbSize(size: number): void {
        if (this.isVertical()) {
            this._thumb.setHeight(size);
        } else {
            this._thumb.setWidth(size);
        }
    }

    /**
     * Sets the thumb's position along the scroll axis, offset by the track
     * origin so the thumb sits inside the track region between the arrows
     * when those are enabled.
     *
     * @param pos - The new thumb position in pixels, relative to the track region.
     *
     * @remarks Written through `setTranslate`, not `setX`/`setY`: this runs on
     * every scroll tick, and a `top`/`left` write forces layout + paint where a
     * transform is composite-only. The thumb's static X/Y (set at construction
     * and, for the cross axis, in `setMetrics`) stays put; the full along-axis
     * offset lives entirely in the translate, mirroring the row pool's
     * `setY(0)` + per-frame `setTranslate` split in `VirtualRowView`.
     */
    private setThumbPos(pos: number): void {
        const origin = this.getTrackOrigin();

        if (this.isVertical()) {
            this._thumb.setTranslate(0, origin + pos);
        } else {
            this._thumb.setTranslate(origin + pos, 0);
        }
    }


    /**
     * Reads the client coordinate along the scroll axis from a mouse or touch
     * event, preferring the active touch on touchstart/touchmove and the
     * changed touch on touchend.
     *
     * @param e - A mouse or touch event.
     * @returns The primary-axis coordinate in viewport space.
     */
    private extractClientPrimary(e: MouseEvent | TouchEvent): number {
        const vertical   = this.isVertical();
        const touchEvent = e as TouchEvent;

        if (touchEvent.touches !== undefined) {
            const t = touchEvent.touches.length > 0
                ? touchEvent.touches[0]
                : touchEvent.changedTouches[0];
            if (!t) {
                return 0;
            }
            return vertical ? t.clientY : t.clientX;
        }

        const mouse = e as MouseEvent;
        return vertical ? mouse.clientY : mouse.clientX;
    }

    /**
     * Captures the initial client coordinate and scroll position, then attaches
     * viewport listeners so the drag continues even when the pointer or finger
     * leaves the thumb. Holds the hover fill and pins a grabbing cursor for the
     * whole drag.
     *
     * @param e - The mousedown or touchstart event on the thumb. Only ever a
     * primary-button press — the default `button: "primary"` registration
     * filters the rest. `preventDefault` is applied by the registration's
     * `prevent: true` floor.
     */
    private _onDragStart = (e: MouseEvent | TouchEvent): void => {
        this._dragStartClient = this.extractClientPrimary(e);
        this._dragStartScroll = this._scrollPosition;
        this._thumbDragging = true;
        this.updateThumbFill();

        Event.addViewportListener(this, "mousemove",   this._onDragMove);
        Event.addViewportListener(this, "mouseup",     this._onDragEnd);
        Event.addViewportListener(this, "touchmove",   this._onDragMove);
        Event.addViewportListener(this, "touchend",    this._onDragEnd);
        Event.addViewportListener(this, "touchcancel", this._onDragEnd);

        // Suppresses pointer events on document.body for the duration of the
        // drag so the cursor can't snag on other elements, and pins a grabbing
        // cursor on the document element — required because suppressing body
        // pointer events also takes the thumb out of hit-testing, so its own
        // "grab" cursor can no longer win a hit test (see PointerDrag.ts).
        beginPointerDrag("grabbing");
    };

    /**
     * Translates the client-axis delta into a scroll-position delta proportional
     * to the content/track ratio, clamps it, and fires scroll listeners.
     *
     * @param e - The viewport mousemove or touchmove event during a drag.
     * @returns `true` while a thumb drag is in progress, consuming the move so nothing else tracks the pointer.
     */
    private _onDragMove = (e: MouseEvent | TouchEvent): Event.ListenerResult => {
        const trackLength = this.getTrackLength();
        const maxScroll   = Math.max(0, this._contentSize - this._viewportSize);
        const maxThumb    = Math.max(0, trackLength - this._thumbSize);

        if (maxThumb <= 0) {
            return true;
        }

        const delta       = this.extractClientPrimary(e) - this._dragStartClient;
        const scrollDelta = (delta / maxThumb) * maxScroll;
        const newPosition = Math.max(0, Math.min(maxScroll, this._dragStartScroll + scrollDelta));

        this.emit("scroll", newPosition);

        return true;
    };

    /**
     * Removes viewport listeners, restores body pointer events and the
     * document cursor, and drops the hover fill unless the pointer is still
     * over the thumb.
     *
     * @param _e - The mouseup/touchend/touchcancel event ending the drag.
     * @returns `true`, consuming the release that ends the thumb drag.
     */
    private _onDragEnd = (_e: Event): Event.ListenerResult => {
        Event.removeViewportListener(this, "mousemove",   this._onDragMove);
        Event.removeViewportListener(this, "mouseup",     this._onDragEnd);
        Event.removeViewportListener(this, "touchmove",   this._onDragMove);
        Event.removeViewportListener(this, "touchend",    this._onDragEnd);
        Event.removeViewportListener(this, "touchcancel", this._onDragEnd);

        this._thumbDragging = false;
        this.updateThumbFill();

        endPointerDrag();

        return true;
    };

    /**
     * Pages the scroll position by one viewport size when the user clicks or
     * taps the track outside the thumb. Events on the thumb itself are caught
     * by a separate listener and don't reach here. When arrows are enabled,
     * clicks that land inside an arrow region are ignored so the arrow
     * button's own handler is the sole authority on arrow-region clicks.
     *
     * @param e - The mousedown or touchstart event on the track. Only ever a
     * primary-button press — the default `button: "primary"` registration
     * filters the rest. `preventDefault` is applied by the registration's
     * `prevent: true` floor.
     */
    private _onTrackClick = (e: MouseEvent | TouchEvent): void => {
        const vertical = this.isVertical();
        let click: number;

        const touchEvent = e as TouchEvent;
        if (touchEvent.touches !== undefined) {
            const t = touchEvent.touches.length > 0
                ? touchEvent.touches[0]
                : touchEvent.changedTouches[0];
            const el = this.getElement();
            if (!t || !el) {
                return;
            }
            // getViewportRect's top-left is the border box, while the mouse
            // branch's offsetX/offsetY below is padding-box-relative; subtract
            // the leading border side so both branches agree before being
            // compared against the content-box-relative axisBox() values.
            const rect   = DOM.source.getViewportRect(this);
            const border = this.getBorderSize();
            click = vertical
                ? t.clientY - rect.top - border.top
                : t.clientX - rect.left - border.left;
        } else {
            const mouse = e as MouseEvent;
            click = vertical ? mouse.offsetY : mouse.offsetX;
        }

        // When arrows are enabled, ignore clicks that landed inside either
        // arrow region — those are handled by the arrow's own mousedown
        // listener (which also stops propagation, but the touchstart path
        // does not, so we double-check here).
        const axis   = this.axisBox();
        const origin = this.getTrackOrigin();
        const outer  = axis.origin + axis.extent;
        if (this._arrowsEnabled && (click < origin || click >= outer - TRACK_WIDTH)) {
            return;
        }

        // Subtract origin so the thumb-position comparison stays in the
        // track-relative coordinate space (matches `_thumbPos`).
        const trackClick  = click - origin;
        const thumbCenter = this._thumbPos + this._thumbSize / 2;
        const direction   = trackClick < thumbCenter ? -1 : 1;
        const maxScroll   = Math.max(0, this._contentSize - this._viewportSize);
        const newPosition = Math.max(0, Math.min(maxScroll, this._scrollPosition + direction * this._viewportSize));

        this.emit("scroll", newPosition);
    };
}

const ScrollbarCallable = callable(Scrollbar);
type ScrollbarCallable = Scrollbar;
export {
    Scrollbar         as _Scrollbar,
    ScrollbarCallable as Scrollbar
};
