// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Scrollbar } from "~/component/container/Scrollbar.js";

/**
 * Callback fired by {@link VirtualScroller} whenever the scroll position
 * changes via user input (wheel, touch, momentum, scrollbar). The owner
 * should re-render its visible window in response.
 *
 * @category Components
 */
export type VirtualScrollerOnScroll = () => void;

/**
 * Shared scroll machinery for transform-based virtual lists (e.g. table body,
 * tree). Owns the rows-container element, two custom {@link Scrollbar} overlays
 * (vertical + horizontal), and the wheel/touch handlers with 2-axis fling
 * momentum.
 *
 * The owner component:
 * 1. Constructs a VirtualScroller from its `init()` with the owner element and
 *    a callback that re-renders the visible window.
 * 2. Appends pool rows into {@link getRowsContainer}.
 * 3. Reads {@link getScrollX} / {@link getScrollY} to determine the visible window.
 * 4. Calls {@link clampToContent} at the start of `renderWindow` (so scroll
 *    positions are sane before being used).
 * 5. Calls {@link layoutScrollbars} at the end of `renderWindow` with the
 *    current content sizes; the scroller applies the final clamp and positions
 *    the scrollbars.
 *
 * @category Components
 */
export class VirtualScroller {

    private _owner          : Component;
    private _onScroll       : VirtualScrollerOnScroll;
    private _clipBox        : HTMLElement;
    private _rowsContainer  : HTMLElement;
    private _scrollbarV     : Scrollbar;
    private _scrollbarH     : Scrollbar;
    private _scrollX        : number = 0;
    private _scrollY        : number = 0;
    private _contentWidth   : number = 0;
    private _contentHeight  : number = 0;

    /**
     * Constructs a VirtualScroller and attaches it to the owner element.
     *
     * @param owner - The component being scrolled (used for `getWidth`/`getHeight`).
     * @param element - The owner's root DOM element. Must already exist; call
     * this from the owner's `init()` after `super.init(element)`.
     * @param onScroll - Callback invoked when scroll position changes via
     * user input.
     */
    constructor(owner: Component, element: HTMLElement, onScroll: VirtualScrollerOnScroll) {
        this._owner    = owner;
        this._onScroll = onScroll;

        // Two-element wrapper: the outer `clipBox` carries `overflow:hidden`
        // sized to the effective viewport so the Scrollbar widgets — positioned
        // by `layoutScrollbars` at `(outerW - trackW, outerH - trackW)` — sit
        // in their own reserved band rather than overlaying the rightmost
        // column / bottom row. The inner `rowsContainer` carries the scroll
        // transform; the transform cannot sit on the same element as
        // `overflow:hidden` because CSS clipping happens in the element's own
        // LOCAL coordinate system before its transform applies — splitting
        // the two roles lets the transform shift the rows around inside a
        // stable clip.
        const clipBox = document.createElement("div");
        clipBox.style.position = "absolute";
        clipBox.style.top      = "0";
        clipBox.style.left     = "0";
        clipBox.style.width    = "100%";
        clipBox.style.height   = "100%";
        clipBox.style.overflow = "hidden";
        element.appendChild(clipBox);
        this._clipBox = clipBox;

        const container = document.createElement("div");
        container.style.position   = "absolute";
        container.style.top        = "0";
        container.style.left       = "0";
        container.style.width      = "100%";
        container.style.transform  = "translate3d(0, 0, 0)";
        container.style.willChange = "transform";
        clipBox.appendChild(container);
        this._rowsContainer = container;

        this._scrollbarV = new Scrollbar("vertical");
        element.appendChild(this._scrollbarV.getElement(true));
        this._scrollbarV.addScrollListener((p: number) => this.setScrollY(p));

        this._scrollbarH = new Scrollbar("horizontal");
        element.appendChild(this._scrollbarH.getElement(true));
        this._scrollbarH.addScrollListener((p: number) => this.setScrollX(p));

        this._owner.setTouchAction("none");

        // Subtree because wheel events fire on whichever descendant of the
        // owner the pointer is over (a row, a cell, …) — not the owner root.
        // passive: false so onWheel can preventDefault the native page scroll.
        Event.addSubtreeListener(
            this._owner,
            "wheel",
            (e: WheelEvent) => this.onWheel(e),
            { passive: false }
        );

        this.attachTouchHandlers();
    }

    /**
     * Returns the rows-container element. Owners append pool rows here so
     * they participate in the transform-based scroll.
     *
     * @returns The rows-container DOM element.
     */
    getRowsContainer(): HTMLElement {
        return this._rowsContainer;
    }

    /**
     * Returns the current vertical scroll position in pixels.
     *
     * @returns The current `scrollY`.
     */
    getScrollY(): number {
        return this._scrollY;
    }

    /**
     * Returns the current horizontal scroll position in pixels.
     *
     * @returns The current `scrollX`.
     */
    getScrollX(): number {
        return this._scrollX;
    }

    /**
     * Sets the vertical scroll position. Clamped against the last-known
     * content height and the *effective* viewport height (full owner height
     * minus the horizontal scrollbar's reservation when that bar is visible),
     * so the maximum reachable scroll position matches what the vertical
     * scrollbar's thumb tops out at. Triggers the owner's `onScroll` callback
     * if the position changed.
     *
     * @param y - The new scroll position in pixels.
     */
    setScrollY(y: number): this {
        const maxScroll = Math.max(0, this._contentHeight - this.effectiveViewportH());
        const next      = Math.max(0, Math.min(maxScroll, y));

        if (next === this._scrollY) {
            return this;
        }

        this._scrollY = next;
        this.updateTransform();
        this._onScroll();

        return this;
    }

    /**
     * Sets the horizontal scroll position. Clamped against the last-known
     * content width and the *effective* viewport width (full owner width
     * minus the vertical scrollbar's reservation when that bar is visible),
     * so the maximum reachable scroll position matches what the horizontal
     * scrollbar's thumb tops out at. Triggers the owner's `onScroll` callback
     * if the position changed.
     *
     * @param x - The new scroll position in pixels.
     */
    setScrollX(x: number): this {
        const maxScroll = Math.max(0, this._contentWidth - this.effectiveViewportW());
        const next      = Math.max(0, Math.min(maxScroll, x));

        if (next === this._scrollX) {
            return this;
        }

        this._scrollX = next;
        this.updateTransform();
        this._onScroll();

        return this;
    }

    /**
     * Decides whether each scrollbar should be visible given the current
     * content size, accounting for the mutual dependency between the two
     * axes — if one bar is visible, its track-width reservation shrinks
     * the cross-axis viewport, which can in turn force the other bar to
     * become visible. Two iterations are sufficient: each pass can only
     * promote one flag from false to true.
     */
    private computeScrollbarVisibility(contentWidth: number, contentHeight: number): { vVisible: boolean, hVisible: boolean, effW: number, effH: number } {
        const outerH = this._owner.getHeight() || 0;
        const outerW = this._owner.getWidth()  || 0;
        const trackW = this._scrollbarV.getTrackWidth();

        let vVisible = false;
        let hVisible = false;
        for (let i = 0; i < 2; i++) {
            const effH: number = outerH - (hVisible ? trackW : 0);
            const effW: number = outerW - (vVisible ? trackW : 0);

            vVisible = contentHeight > effH;
            hVisible = contentWidth  > effW;
        }

        const effH = outerH - (hVisible ? trackW : 0);
        const effW = outerW - (vVisible ? trackW : 0);

        return { vVisible, hVisible, effW, effH };
    }

    /**
     * Effective vertical viewport — the owner height minus the horizontal
     * scrollbar's track-width reservation when that bar would be visible.
     * Single source of truth so the clamps in `setScrollY` agree with what
     * the vertical scrollbar's `setMetrics` is fed.
     */
    private effectiveViewportH(): number {
        return this.computeScrollbarVisibility(this._contentWidth, this._contentHeight).effH;
    }

    /**
     * Effective horizontal viewport — see {@link effectiveViewportH}.
     */
    private effectiveViewportW(): number {
        return this.computeScrollbarVisibility(this._contentWidth, this._contentHeight).effW;
    }

    /**
     * Clamps the current `scrollX` / `scrollY` against the new content size
     * and the *effective* viewport on each axis (which subtracts the
     * cross-axis scrollbar's track-width when that bar is visible). Call at
     * the start of `renderWindow` so scrollX/Y are within range before being
     * used for window calculations — important when content has shrunk since
     * the last frame. Uses the same effective-viewport reasoning as
     * `setScrollX/Y` so the clamps agree and scrollX/Y aren't pulled back to
     * a smaller bound than the scrollbar's own `setMetrics` expects (which
     * would leave the thumb stopping short of the end-arrow). Does not fire
     * `onScroll`.
     *
     * @param contentWidth - The total scrollable content width in pixels.
     * @param contentHeight - The total scrollable content height in pixels.
     */
    clampToContent(contentWidth: number, contentHeight: number): void {
        this._contentWidth  = contentWidth;
        this._contentHeight = contentHeight;

        const maxY = Math.max(0, contentHeight - this.effectiveViewportH());
        const maxX = Math.max(0, contentWidth  - this.effectiveViewportW());

        let changed = false;
        if (this._scrollY > maxY) {
            this._scrollY = maxY;
            changed = true;
        }
        if (this._scrollX > maxX) {
            this._scrollX = maxX;
            changed = true;
        }
        if (changed) {
            this.updateTransform();
        }
    }

    /**
     * Tight clamp using effective viewports (each axis subtracts the
     * cross-axis scrollbar's track width when it is visible), then positions
     * the scrollbars and pushes metrics. Call at end of `renderWindow`.
     *
     * @param contentWidth - The total scrollable content width in pixels.
     * @param contentHeight - The total scrollable content height in pixels.
     */
    layoutScrollbars(contentWidth: number, contentHeight: number): void {
        this._contentWidth  = contentWidth;
        this._contentHeight = contentHeight;

        const trackW = this._scrollbarV.getTrackWidth();
        const outerW = this._owner.getWidth();
        const outerH = this._owner.getHeight();

        const { effW, effH } = this.computeScrollbarVisibility(contentWidth, contentHeight);

        const maxY = Math.max(0, contentHeight - effH);
        const maxX = Math.max(0, contentWidth  - effW);
        if (this._scrollY > maxY || this._scrollX > maxX) {
            if (this._scrollY > maxY) this._scrollY = maxY;
            if (this._scrollX > maxX) this._scrollX = maxX;
            this.updateTransform();
        }

        this._scrollbarV.setX(Math.max(0, outerW - trackW));
        this._scrollbarV.setHeight(effH);
        this._scrollbarV.setMetrics(effH, contentHeight, this._scrollY);

        this._scrollbarH.setY(Math.max(0, outerH - trackW));
        this._scrollbarH.setWidth(effW);
        this._scrollbarH.setMetrics(effW, contentWidth, this._scrollX);

        // Resize the clip box to the effective viewport so cells translated
        // by the horizontal scroll can't bleed under the vertical scrollbar
        // (and rows beyond the bottom can't bleed under the horizontal
        // scrollbar). When neither bar is visible this collapses to the
        // full owner size, matching the previous `width/height: 100%`
        // behaviour.
        this._clipBox.style.width  = effW + "px";
        this._clipBox.style.height = effH + "px";
    }

    /**
     * Writes the current `scrollX` / `scrollY` into the rows-container
     * transform.
     */
    private updateTransform(): void {
        this._rowsContainer.style.transform = `translate3d(${-this._scrollX}px, ${-this._scrollY}px, 0)`;
    }

    /**
     * Routes wheel events to setScrollX/Y. Shift+wheel without explicit
     * deltaX is treated as horizontal scroll.
     *
     * @param e - The wheel event.
     */
    private onWheel(e: WheelEvent): void {
        e.preventDefault();

        if (e.shiftKey && e.deltaY !== 0 && e.deltaX === 0) {
            this.setScrollX(this._scrollX + e.deltaY);
            return;
        }
        if (e.deltaX !== 0) {
            this.setScrollX(this._scrollX + e.deltaX);
        }
        if (e.deltaY !== 0) {
            this.setScrollY(this._scrollY + e.deltaY);
        }
    }

    /**
     * Installs the touch handlers: 1:1 finger drag scrolls both axes, and on
     * release a 2D fling momentum decays per frame until it falls below
     * threshold or hits a scroll boundary.
     */
    private attachTouchHandlers(): void {
        let touchActive       = false;
        let touchStartY       = 0;
        let touchStartX       = 0;
        let touchStartScrollY = 0;
        let touchStartScrollX = 0;
        let touchSamples      : Array<{ time: number, x: number, y: number }> = [];
        let momentumRaf       : number | null = null;

        const cancelMomentum = (): void => {
            if (momentumRaf !== null) {
                cancelAnimationFrame(momentumRaf);
                momentumRaf = null;
            }
        };

        // Subtree because touch events fire on descendants of the owner
        // (rows / cells) — not the owner root.
        Event.addSubtreeListener(this._owner, "touchstart", (e: TouchEvent) => {
            if (e.touches.length !== 1) {
                return;
            }
            cancelMomentum();
            touchActive       = true;
            touchStartY       = e.touches[0].clientY;
            touchStartX       = e.touches[0].clientX;
            touchStartScrollY = this._scrollY;
            touchStartScrollX = this._scrollX;
            touchSamples      = [{ time: performance.now(), x: touchStartX, y: touchStartY }];
        });

        Event.addSubtreeListener(this._owner, "touchmove", (e: TouchEvent) => {
            if (!touchActive || e.touches.length !== 1) {
                return;
            }
            const y   = e.touches[0].clientY;
            const x   = e.touches[0].clientX;
            const now = performance.now();

            touchSamples.push({ time: now, x: x, y: y });
            while (touchSamples.length > 1 && touchSamples[0].time < now - 150) {
                touchSamples.shift();
            }

            this.setScrollY(touchStartScrollY + (touchStartY - y));
            this.setScrollX(touchStartScrollX + (touchStartX - x));
        });

        const startMomentum = (): void => {
            if (touchSamples.length < 2) {
                return;
            }

            const last = touchSamples[touchSamples.length - 1];

            const PAUSE_THRESHOLD = 50;
            if (performance.now() - last.time > PAUSE_THRESHOLD) {
                return;
            }

            const VELOCITY_WINDOW = 80;
            const cutoff          = last.time - VELOCITY_WINDOW;
            let firstIdx          = touchSamples.length - 1;
            while (firstIdx > 0 && touchSamples[firstIdx - 1].time >= cutoff) {
                firstIdx--;
            }
            const first = touchSamples[firstIdx];
            const dt    = last.time - first.time;
            if (dt <= 0) {
                return;
            }

            let velocityY = (first.y - last.y) / dt;
            let velocityX = (first.x - last.x) / dt;

            const MIN_VELOCITY  = 0.1;
            const FRICTION      = 0.95;
            const STOP_VELOCITY = 0.02;

            const initialSpeed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
            if (initialSpeed < MIN_VELOCITY) {
                return;
            }

            let lastT = performance.now();
            const step = (): void => {
                const now   = performance.now();
                const frame = now - lastT;
                lastT       = now;

                const decay = Math.pow(FRICTION, frame / 16.667);
                velocityY *= decay;
                velocityX *= decay;

                const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
                if (speed < STOP_VELOCITY) {
                    momentumRaf = null;
                    return;
                }

                const beforeY = this._scrollY;
                const beforeX = this._scrollX;
                this.setScrollY(this._scrollY + velocityY * frame);
                this.setScrollX(this._scrollX + velocityX * frame);
                if (this._scrollY === beforeY) {
                    velocityY = 0;
                }
                if (this._scrollX === beforeX) {
                    velocityX = 0;
                }
                if (velocityY === 0 && velocityX === 0) {
                    momentumRaf = null;
                    return;
                }

                momentumRaf = requestAnimationFrame(step);
            };

            momentumRaf = requestAnimationFrame(step);
        };

        Event.addSubtreeListener(this._owner, "touchend", () => {
            if (!touchActive) {
                return;
            }
            touchActive = false;
            startMomentum();
        });

        Event.addSubtreeListener(this._owner, "touchcancel", () => {
            touchActive = false;
            cancelMomentum();
        });
    }
}
