// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";
import { Event } from "../Event.js";
import { Position } from "../Position.js";
import { Util } from "../Util.js";
import { callable } from "../Callable.js";

const TRACK_WIDTH    = 12;
const THUMB_INSET    = 2;
const THUMB_MIN_SIZE = 30;

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
 * A custom virtual scrollbar overlay.
 *
 * Designed for components that own their own scroll state (e.g. transform-based
 * virtual lists) and don't expose native browser scrolling. The owner pushes
 * viewport/content metrics in via {@link Scrollbar.setMetrics} and subscribes
 * to scroll position changes via {@link Scrollbar.addScrollListener}.
 *
 * The thumb is dragged with the mouse; clicking the track above/beside the
 * thumb pages by one viewport. The scrollbar hides itself when content fits in
 * the viewport.
 *
 * Available in vertical (default) and horizontal orientations; the owner is
 * responsible for sizing the primary axis (height for vertical, width for
 * horizontal) and positioning the bar on the cross axis.
 *
 * @category Components
 */
class Scrollbar extends Component {

    private orientation     : ScrollbarOrientation     = "vertical";
    private thumb           : Component;
    private viewportSize    : number                   = 0;
    private contentSize     : number                   = 0;
    private scrollPosition  : number                   = 0;
    private thumbSize       : number                   = 0;
    private thumbPos        : number                   = 0;
    private dragStartClient : number                   = 0;
    private dragStartScroll : number                   = 0;
    private scrollListeners : ScrollbarListener[]      = [];

    /**
     * Constructs a Scrollbar.
     *
     * @param orientation - `"vertical"` (default) or `"horizontal"`.
     */
    constructor(orientation: ScrollbarOrientation = "vertical") {
        super();

        this.orientation = orientation;

        this.setPosition(Position.ABSOLUTE);
        this.setBackgroundColor("var(--ts-ui-scrollbar-track, rgba(0, 0, 0, 0.04))");
        this.setUserSelect("none");

        if (this.isVertical()) {
            this.setWidth(TRACK_WIDTH);
        } else {
            this.setHeight(TRACK_WIDTH);
        }

        this.thumb = new Component();
        this.thumb.setPosition(Position.ABSOLUTE);
        this.thumb.setBackgroundColor("var(--ts-ui-scrollbar-thumb, rgba(0, 0, 0, 0.35))");
        this.thumb.setCursor("default");

        if (this.isVertical()) {
            this.thumb.setX(THUMB_INSET);
            this.thumb.setY(0);
            this.thumb.setWidth(TRACK_WIDTH - 2 * THUMB_INSET);
        } else {
            this.thumb.setX(0);
            this.thumb.setY(THUMB_INSET);
            this.thumb.setHeight(TRACK_WIDTH - 2 * THUMB_INSET);
        }

        super.addComponent(this.thumb);

        Event.addListener(this.thumb, "mousedown",  this.onDragStart);
        Event.addListener(this.thumb, "touchstart", this.onDragStart);
        Event.addListener(this.thumb, "mouseover",  this.onThumbMouseOver);
        Event.addListener(this.thumb, "mouseout",   this.onThumbMouseOut);
        Event.addListener(this, "mousedown",  this.onTrackClick);
        Event.addListener(this, "touchstart", this.onTrackClick);
    }

    /**
     * Darkens the thumb fill when the cursor moves over it.
     */
    private onThumbMouseOver = (): void => {
        this.thumb.setBackgroundColor("var(--ts-ui-scrollbar-thumb-hover, rgba(0, 0, 0, 0.55))");
    };

    /**
     * Restores the thumb's resting fill when the cursor leaves it.
     */
    private onThumbMouseOut = (): void => {
        this.thumb.setBackgroundColor("var(--ts-ui-scrollbar-thumb, rgba(0, 0, 0, 0.35))");
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
     * Registers a callback fired when the user changes the scroll position by
     * dragging the thumb or clicking the track.
     *
     * @param listener - The callback to invoke with the new scroll position.
     */
    addScrollListener(listener: ScrollbarListener): this {
        this.scrollListeners.push(listener);

        return this;
    }

    /**
     * Removes a previously registered scroll listener.
     *
     * @param listener - The exact callback reference to remove.
     */
    removeScrollListener(listener: ScrollbarListener): this {
        const idx = this.scrollListeners.indexOf(listener);
        if (idx >= 0) {
            this.scrollListeners.splice(idx, 1);
        }

        return this;
    }

    /**
     * Pushes viewport/content metrics and the current scroll position into the
     * scrollbar. Recomputes the thumb size and position and hides the scrollbar
     * if the content fits in the viewport.
     *
     * @param viewportSize - The visible window size in pixels along the scroll axis.
     * @param contentSize - The total scrollable content size in pixels along the scroll axis.
     * @param scrollPosition - The current scroll offset in pixels.
     */
    setMetrics(viewportSize: number, contentSize: number, scrollPosition: number): this {
        this.viewportSize   = viewportSize;
        this.contentSize    = contentSize;
        this.scrollPosition = scrollPosition;

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
        if (this.thumbSize !== newThumbSize) {
            this.thumbSize = newThumbSize;
            this.setThumbSize(newThumbSize);
        }

        const maxScroll = Math.max(0, contentSize - viewportSize);
        const maxThumb  = Math.max(0, trackLength - newThumbSize);
        const newThumbPos = maxScroll > 0 ? Math.round((scrollPosition / maxScroll) * maxThumb) : 0;
        if (this.thumbPos !== newThumbPos) {
            this.thumbPos = newThumbPos;
            this.setThumbPos(newThumbPos);
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
        return this.orientation;
    }

    /**
     * Returns true if this is a vertical scrollbar.
     *
     * @returns True for vertical, false for horizontal.
     */
    private isVertical(): boolean {
        return this.orientation === "vertical";
    }

    /**
     * Returns the length of the track along the scroll axis: height for
     * vertical, width for horizontal.
     */
    private getTrackLength(): number {
        return this.isVertical() ? this.getHeight() : this.getWidth();
    }

    /**
     * Sets the thumb's size along the scroll axis.
     *
     * @param size - The new thumb size in pixels.
     */
    private setThumbSize(size: number): void {
        if (this.isVertical()) {
            this.thumb.setHeight(size);
        } else {
            this.thumb.setWidth(size);
        }
    }

    /**
     * Sets the thumb's position along the scroll axis.
     *
     * @param pos - The new thumb position in pixels.
     */
    private setThumbPos(pos: number): void {
        if (this.isVertical()) {
            this.thumb.setY(pos);
        } else {
            this.thumb.setX(pos);
        }
    }

    /**
     * Fires all registered scroll listeners with the new position.
     *
     * @param position - The new scroll position in pixels.
     */
    private fireScrollListeners(position: number): void {
        for (const listener of this.scrollListeners) {
            listener(position);
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
    private onDragStart = (e: MouseEvent | TouchEvent): void => {
        e.preventDefault();

        this.dragStartClient = this.extractClientPrimary(e);
        this.dragStartScroll = this.scrollPosition;

        Event.addViewportListener(this, "mousemove",   this.onDragMove);
        Event.addViewportListener(this, "mouseup",     this.onDragEnd);
        Event.addViewportListener(this, "touchmove",   this.onDragMove);
        Event.addViewportListener(this, "touchend",    this.onDragEnd);
        Event.addViewportListener(this, "touchcancel", this.onDragEnd);

        Util.select("body").style.pointerEvents = "none";
    };

    /**
     * Translates the client-axis delta into a scroll-position delta proportional
     * to the content/track ratio, clamps it, and fires scroll listeners.
     *
     * @param e - The viewport mousemove or touchmove event during a drag.
     */
    private onDragMove = (e: MouseEvent | TouchEvent): void => {
        const trackLength = this.getTrackLength();
        const maxScroll   = Math.max(0, this.contentSize - this.viewportSize);
        const maxThumb    = Math.max(0, trackLength - this.thumbSize);

        if (maxThumb <= 0) {
            return;
        }

        const delta       = this.extractClientPrimary(e) - this.dragStartClient;
        const scrollDelta = (delta / maxThumb) * maxScroll;
        const newPosition = Math.max(0, Math.min(maxScroll, this.dragStartScroll + scrollDelta));

        this.fireScrollListeners(newPosition);
    };

    /**
     * Removes viewport listeners and restores body pointer events.
     */
    private onDragEnd = (): void => {
        Event.removeViewportListener(this, "mousemove",   this.onDragMove);
        Event.removeViewportListener(this, "mouseup",     this.onDragEnd);
        Event.removeViewportListener(this, "touchmove",   this.onDragMove);
        Event.removeViewportListener(this, "touchend",    this.onDragEnd);
        Event.removeViewportListener(this, "touchcancel", this.onDragEnd);

        Util.select("body").style.pointerEvents = "";
    };

    /**
     * Pages the scroll position by one viewport size when the user clicks or
     * taps the track outside the thumb. Events on the thumb itself are caught
     * by a separate listener and don't reach here.
     *
     * @param e - The mousedown or touchstart event on the track.
     */
    private onTrackClick = (e: MouseEvent | TouchEvent): void => {
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

        const thumbCenter = this.thumbPos + this.thumbSize / 2;
        const direction   = click < thumbCenter ? -1 : 1;
        const maxScroll   = Math.max(0, this.contentSize - this.viewportSize);
        const newPosition = Math.max(0, Math.min(maxScroll, this.scrollPosition + direction * this.viewportSize));

        this.fireScrollListeners(newPosition);
    };
}

const ScrollbarCallable = callable(Scrollbar);
type ScrollbarCallable = Scrollbar;
export {
    Scrollbar         as _Scrollbar,
    ScrollbarCallable as Scrollbar
};
