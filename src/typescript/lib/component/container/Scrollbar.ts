// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { Glyph } from "~/component/display/Glyph.js";
import { Util } from "~/core/Util.js";
import { callable } from "~/core/Callable.js";

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

const TRACK_WIDTH    = 12;
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

/**
 * Scrollbar orientation. `"vertical"` lays the track along the Y axis (default);
 * `"horizontal"` lays it along the X axis.
 *
 * @category Components
 */
export type ScrollbarOrientation = "vertical" | "horizontal";

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
     * Defaults to `false` — the current minimalist look is preserved unless
     * an owner opts in.
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
type ArrowDirection = "up" | "down" | "left" | "right";

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

    private _glyph:         Glyph;
    private _disabled:      boolean                              = false;
    private _listeners:     ListenerBag<ScrollArrowEvent>        = new ListenerBag<ScrollArrowEvent>();
    private _repeatHandle:  ReturnType<typeof setTimeout> | null = null;
    private _repeatDelay:   number                               = ARROW_REPEAT_INITIAL_MS;

    /**
     * Constructs a square TRACK_WIDTH × TRACK_WIDTH arrow button pointing in
     * the given direction.
     *
     * @param direction - One of `"up"`, `"down"`, `"left"`, `"right"`.
     */
    constructor(direction: ArrowDirection) {
        super();

        this.setWidth(TRACK_WIDTH);
        this.setHeight(TRACK_WIDTH);
        this.setCursor("default");
        this.setBackgroundColor("var(--ts-ui-scrollbar-arrow-bg, transparent)");
        this.setForegroundColor("var(--ts-ui-scrollbar-arrow-color, rgba(0, 0, 0, 0.55))");

        // Fill the full TRACK_WIDTH × TRACK_WIDTH button so `text-align: center`
        // + `line-height: 1` (Glyph char-mode defaults) centre the character
        // within that box. The explicit `fontSize` shrinks the inherited
        // 14 px size so the Unicode triangle's line-box (which scales with
        // font-size) fits inside the 12 px element box and isn't clipped at
        // the bottom by `overflow: hidden` — mirrors the same fix
        // AccordionIndicator applies to its `▶` chevron.
        this._glyph = new Glyph("unicode-arrow-" + direction);
        this._glyph.setPreferredSize(TRACK_WIDTH, TRACK_WIDTH);
        this._glyph.setFontSize(ARROW_GLYPH_FONT_SIZE);

        super.addComponent(this._glyph);

        Event.addListener(this, "mousedown",  this._onMouseDown);
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
            this.cancelRepeat();
            this.setForegroundColor("var(--ts-ui-scrollbar-arrow-disabled-color, rgba(0, 0, 0, 0.18))");
        } else {
            this.setForegroundColor("var(--ts-ui-scrollbar-arrow-color, rgba(0, 0, 0, 0.55))");
        }
    }

    /**
     * Cancels any in-progress hold-repeat schedule and resets the tick delay
     * to its initial value.
     */
    private cancelRepeat(): void {
        if (this._repeatHandle !== null) {
            clearTimeout(this._repeatHandle);
            this._repeatHandle = null;
        }

        this._repeatDelay = ARROW_REPEAT_INITIAL_MS;
    }

    /**
     * Handles mousedown on the button. Stops propagation so the parent
     * Scrollbar's track-click handler does not also fire, then (if not
     * disabled) fires the first tick and schedules accelerating repeats.
     *
     * @param e - The mousedown event.
     */
    private _onMouseDown = (e: MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();

        if (this._disabled) {
            return;
        }

        this.emit("tick");
        this.scheduleNext();
    };

    /**
     * Cancels the hold-repeat schedule on mouseup or when the pointer leaves
     * the viewport.
     */
    private _onMouseUp = (): void => {
        if (this._repeatHandle === null) {
            return;
        }

        this.cancelRepeat();
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

    /**
     * Schedules the next hold-repeat tick using the current `_repeatDelay`,
     * then decays the delay (×0.75, floored at 40 ms) for the following tick.
     */
    private scheduleNext(): void {
        this._repeatHandle = setTimeout((): void => {
            this.emit("tick");
            this._repeatDelay = Math.max(ARROW_REPEAT_FLOOR_MS, this._repeatDelay * ARROW_REPEAT_DECAY);
            this.scheduleNext();
        }, this._repeatDelay);
    }

}

/**
 * A custom virtual scrollbar overlay.
 *
 * Designed for components that own their own scroll state (e.g. transform-based
 * virtual lists) and don't expose native browser scrolling. The owner pushes
 * viewport/content metrics in via {@link Scrollbar.setMetrics} and subscribes
 * to scroll position changes via {@link Scrollbar.addScrollListener}.
 *
 * The thumb is dragged with the mouse; clicking the track above/beside the
 * thumb pages by one viewport. The scrollbar hides itself when content fits in
 * the viewport. Optional classic OS-style arrow buttons at each end of the
 * track are available via {@link ScrollbarOptions.arrowsEnabled} — disabled by
 * default to preserve the minimalist look.
 *
 * Available in vertical (default) and horizontal orientations; the owner is
 * responsible for sizing the primary axis (height for vertical, width for
 * horizontal) and positioning the bar on the cross axis.
 *
 * @category Components
 */
class Scrollbar extends Component<ScrollbarOptions> {

    private _orientation     : ScrollbarOrientation     = "vertical";
    private _thumb           : Component;
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
    private _listeners       : ListenerBag<ScrollbarEvent> = new ListenerBag<ScrollbarEvent>();

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
     */
    constructor(orientation: ScrollbarOrientation = "vertical", options?: ScrollbarOptions) {
        super(options);

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

        this.setBackgroundColor("var(--ts-ui-scrollbar-track, rgba(0, 0, 0, 0.04))");
        this.setUserSelect("none");

        if (this.isVertical()) {
            this.setWidth(TRACK_WIDTH);
        } else {
            this.setHeight(TRACK_WIDTH);
        }

        this._thumb = new Component();
        this._thumb.setBackgroundColor("var(--ts-ui-scrollbar-thumb, rgba(0, 0, 0, 0.35))");
        this._thumb.setCursor("default");

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

        Event.addListener(this._thumb, "mousedown",  this._onDragStart);
        Event.addListener(this._thumb, "touchstart", this._onDragStart);
        Event.addListener(this._thumb, "mouseover",  this._onThumbMouseOver);
        Event.addListener(this._thumb, "mouseout",   this._onThumbMouseOut);
        Event.addListener(this, "mousedown",  this._onTrackClick);
        Event.addListener(this, "touchstart", this._onTrackClick);

        if (options?.listeners?.scroll !== undefined) {
            this.on("scroll", options.listeners.scroll);
        }
    }

    /**
     * Constructs and wires the two arrow buttons. Start arrow sits at the
     * primary-axis origin; end arrow's primary-axis position is set lazily in
     * `setMetrics` because the cross-axis extent changes with bar size.
     * Disabled-state for the start arrow is pre-set since `_scrollPosition`
     * defaults to 0 — without this the start arrow renders enabled for one
     * frame before `setMetrics` corrects it.
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
        // End arrow's primary-axis origin depends on the bar's outer size; we
        // position it inside `setMetrics`. Cross-axis stays at 0.
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
        this._thumb.setBackgroundColor("var(--ts-ui-scrollbar-thumb-hover, rgba(0, 0, 0, 0.55))");
    };

    /**
     * Restores the thumb's resting fill when the cursor leaves it.
     */
    private _onThumbMouseOut = (): void => {
        this._thumb.setBackgroundColor("var(--ts-ui-scrollbar-thumb, rgba(0, 0, 0, 0.35))");
    };

    /**
     * Initializes the scrollbar element and sets `touch-action: none` so the
     * browser doesn't try to page-scroll when the user drags on the track.
     *
     * @param element - Optional. The HTMLElement to initialize with.
     */
    protected init(element?: HTMLElement): this {
        super.init(element);

        const el = element || this.getElement();
        if (el) {
            el.style.touchAction = "none";
        }

        return this;
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
     * scrollbar. Recomputes the thumb size and position and hides the scrollbar
     * if the content fits in the viewport. When arrows are enabled, repositions
     * the end arrow against the current outer size and refreshes the
     * disabled-at-edge state on both arrows.
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

        if (this._arrowsEnabled && this._arrowStart && this._arrowEnd) {
            // Position the end arrow against the current outer size — its
            // primary-axis origin sits at (outer - TRACK_WIDTH).
            const outer  = this.isVertical() ? this.getHeight() : this.getWidth();
            const endPos = Math.max(0, outer - TRACK_WIDTH);
            if (this.isVertical()) {
                this._arrowEnd.setY(endPos);
            } else {
                this._arrowEnd.setX(endPos);
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
    getOrientation(): ScrollbarOrientation {
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
     * Returns the length of the track along the scroll axis available for the
     * thumb to travel. Subtracts the two arrow regions when arrows are
     * enabled so the thumb travel range stays inside the track between them.
     */
    private getTrackLength(): number {
        const raw   = this.isVertical() ? this.getHeight() : this.getWidth();
        const inset = this._arrowsEnabled ? 2 * TRACK_WIDTH : 0;

        return Math.max(0, raw - inset);
    }

    /**
     * Returns the primary-axis offset where the track region (thumb travel
     * area) starts. `TRACK_WIDTH` when arrows are enabled (skipping the start
     * arrow), `0` otherwise.
     */
    private getTrackOrigin(): number {
        return this._arrowsEnabled ? TRACK_WIDTH : 0;
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
     */
    private setThumbPos(pos: number): void {
        const origin = this.getTrackOrigin();

        if (this.isVertical()) {
            this._thumb.setY(origin + pos);
        } else {
            this._thumb.setX(origin + pos);
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
     * leaves the thumb.
     *
     * @param e - The mousedown or touchstart event on the thumb.
     */
    private _onDragStart = (e: MouseEvent | TouchEvent): void => {
        e.preventDefault();

        this._dragStartClient = this.extractClientPrimary(e);
        this._dragStartScroll = this._scrollPosition;

        Event.addViewportListener(this, "mousemove",   this._onDragMove);
        Event.addViewportListener(this, "mouseup",     this._onDragEnd);
        Event.addViewportListener(this, "touchmove",   this._onDragMove);
        Event.addViewportListener(this, "touchend",    this._onDragEnd);
        Event.addViewportListener(this, "touchcancel", this._onDragEnd);

        Util.select("body").style.pointerEvents = "none";
    };

    /**
     * Translates the client-axis delta into a scroll-position delta proportional
     * to the content/track ratio, clamps it, and fires scroll listeners.
     *
     * @param e - The viewport mousemove or touchmove event during a drag.
     */
    private _onDragMove = (e: MouseEvent | TouchEvent): void => {
        const trackLength = this.getTrackLength();
        const maxScroll   = Math.max(0, this._contentSize - this._viewportSize);
        const maxThumb    = Math.max(0, trackLength - this._thumbSize);

        if (maxThumb <= 0) {
            return;
        }

        const delta       = this.extractClientPrimary(e) - this._dragStartClient;
        const scrollDelta = (delta / maxThumb) * maxScroll;
        const newPosition = Math.max(0, Math.min(maxScroll, this._dragStartScroll + scrollDelta));

        this.emit("scroll", newPosition);
    };

    /**
     * Removes viewport listeners and restores body pointer events.
     */
    private _onDragEnd = (): void => {
        Event.removeViewportListener(this, "mousemove",   this._onDragMove);
        Event.removeViewportListener(this, "mouseup",     this._onDragEnd);
        Event.removeViewportListener(this, "touchmove",   this._onDragMove);
        Event.removeViewportListener(this, "touchend",    this._onDragEnd);
        Event.removeViewportListener(this, "touchcancel", this._onDragEnd);

        Util.select("body").style.pointerEvents = "";
    };

    /**
     * Pages the scroll position by one viewport size when the user clicks or
     * taps the track outside the thumb. Events on the thumb itself are caught
     * by a separate listener and don't reach here. When arrows are enabled,
     * clicks that land inside an arrow region are ignored so the arrow
     * button's own handler is the sole authority on arrow-region clicks.
     *
     * @param e - The mousedown or touchstart event on the track.
     */
    private _onTrackClick = (e: MouseEvent | TouchEvent): void => {
        e.preventDefault();

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
            const rect = el.getBoundingClientRect();
            click = vertical ? t.clientY - rect.top : t.clientX - rect.left;
        } else {
            const mouse = e as MouseEvent;
            click = vertical ? mouse.offsetY : mouse.offsetX;
        }

        // When arrows are enabled, ignore clicks that landed inside either
        // arrow region — those are handled by the arrow's own mousedown
        // listener (which also stops propagation, but the touchstart path
        // does not, so we double-check here).
        const origin = this.getTrackOrigin();
        const outer  = vertical ? this.getHeight() : this.getWidth();
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
