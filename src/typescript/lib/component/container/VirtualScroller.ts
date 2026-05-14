// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
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

    private owner          : Component;
    private onScroll       : VirtualScrollerOnScroll;
    private rowsContainer  : HTMLElement;
    private scrollbarV     : Scrollbar;
    private scrollbarH     : Scrollbar;
    private scrollX        : number = 0;
    private scrollY        : number = 0;
    private contentWidth   : number = 0;
    private contentHeight  : number = 0;

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
        this.owner    = owner;
        this.onScroll = onScroll;

        const container = document.createElement("div");
        container.style.position   = "absolute";
        container.style.top        = "0";
        container.style.left       = "0";
        container.style.width      = "100%";
        container.style.transform  = "translate3d(0, 0, 0)";
        container.style.willChange = "transform";
        element.appendChild(container);
        this.rowsContainer = container;

        this.scrollbarV = new Scrollbar("vertical");
        element.appendChild(this.scrollbarV.getElement(true));
        this.scrollbarV.addScrollListener((p: number) => this.setScrollY(p));

        this.scrollbarH = new Scrollbar("horizontal");
        element.appendChild(this.scrollbarH.getElement(true));
        this.scrollbarH.addScrollListener((p: number) => this.setScrollX(p));

        element.style.touchAction = "none";

        element.addEventListener("wheel", (e: WheelEvent) => this.onWheel(e), { passive: false });

        this.attachTouchHandlers(element);
    }

    /**
     * Returns the rows-container element. Owners append pool rows here so
     * they participate in the transform-based scroll.
     *
     * @returns The rows-container DOM element.
     */
    getRowsContainer(): HTMLElement {
        return this.rowsContainer;
    }

    /**
     * Returns the current vertical scroll position in pixels.
     *
     * @returns The current `scrollY`.
     */
    getScrollY(): number {
        return this.scrollY;
    }

    /**
     * Returns the current horizontal scroll position in pixels.
     *
     * @returns The current `scrollX`.
     */
    getScrollX(): number {
        return this.scrollX;
    }

    /**
     * Sets the vertical scroll position. Clamped against the last-known
     * content height and viewport height. Triggers the owner's `onScroll`
     * callback if the position changed.
     *
     * @param y - The new scroll position in pixels.
     */
    setScrollY(y: number): this {
        const viewportH = this.owner.getHeight() || 0;
        const maxScroll = Math.max(0, this.contentHeight - viewportH);
        const next      = Math.max(0, Math.min(maxScroll, y));

        if (next === this.scrollY) {
            return this;
        }

        this.scrollY = next;
        this.updateTransform();
        this.onScroll();

        return this;
    }

    /**
     * Sets the horizontal scroll position. Clamped against the last-known
     * content width and viewport width. Triggers the owner's `onScroll`
     * callback if the position changed.
     *
     * @param x - The new scroll position in pixels.
     */
    setScrollX(x: number): this {
        const viewportW = this.owner.getWidth() || 0;
        const maxScroll = Math.max(0, this.contentWidth - viewportW);
        const next      = Math.max(0, Math.min(maxScroll, x));

        if (next === this.scrollX) {
            return this;
        }

        this.scrollX = next;
        this.updateTransform();
        this.onScroll();

        return this;
    }

    /**
     * Loose clamp using full viewports (no cross-axis scrollbar reservation).
     * Call at the start of `renderWindow` so scrollX/Y are within range before
     * being used for window calculations — important when content has shrunk
     * since the last frame. Does not fire `onScroll`.
     *
     * @param contentWidth - The total scrollable content width in pixels.
     * @param contentHeight - The total scrollable content height in pixels.
     */
    clampToContent(contentWidth: number, contentHeight: number): void {
        this.contentWidth  = contentWidth;
        this.contentHeight = contentHeight;

        const outerW = this.owner.getWidth();
        const outerH = this.owner.getHeight();
        const maxY   = Math.max(0, contentHeight - outerH);
        const maxX   = Math.max(0, contentWidth  - outerW);

        let changed = false;
        if (this.scrollY > maxY) {
            this.scrollY = maxY;
            changed = true;
        }
        if (this.scrollX > maxX) {
            this.scrollX = maxX;
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
        this.contentWidth  = contentWidth;
        this.contentHeight = contentHeight;

        const trackW = this.scrollbarV.getTrackWidth();
        const outerW = this.owner.getWidth();
        const outerH = this.owner.getHeight();

        const vNeeded = contentHeight > outerH;
        const hNeeded = contentWidth  > outerW;

        const effH = outerH - (hNeeded ? trackW : 0);
        const effW = outerW - (vNeeded ? trackW : 0);

        const maxY = Math.max(0, contentHeight - effH);
        const maxX = Math.max(0, contentWidth  - effW);
        if (this.scrollY > maxY || this.scrollX > maxX) {
            if (this.scrollY > maxY) this.scrollY = maxY;
            if (this.scrollX > maxX) this.scrollX = maxX;
            this.updateTransform();
        }

        this.scrollbarV.setX(Math.max(0, outerW - trackW));
        this.scrollbarV.setHeight(effH);
        this.scrollbarV.setMetrics(effH, contentHeight, this.scrollY);

        this.scrollbarH.setY(Math.max(0, outerH - trackW));
        this.scrollbarH.setWidth(effW);
        this.scrollbarH.setMetrics(effW, contentWidth, this.scrollX);
    }

    /**
     * Writes the current `scrollX` / `scrollY` into the rows-container
     * transform.
     */
    private updateTransform(): void {
        this.rowsContainer.style.transform = `translate3d(${-this.scrollX}px, ${-this.scrollY}px, 0)`;
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
            this.setScrollX(this.scrollX + e.deltaY);
            return;
        }
        if (e.deltaX !== 0) {
            this.setScrollX(this.scrollX + e.deltaX);
        }
        if (e.deltaY !== 0) {
            this.setScrollY(this.scrollY + e.deltaY);
        }
    }

    /**
     * Installs the touch handlers: 1:1 finger drag scrolls both axes, and on
     * release a 2D fling momentum decays per frame until it falls below
     * threshold or hits a scroll boundary.
     *
     * @param element - The owner element on which to attach the touch handlers.
     */
    private attachTouchHandlers(element: HTMLElement): void {
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

        element.addEventListener("touchstart", (e: TouchEvent) => {
            if (e.touches.length !== 1) {
                return;
            }
            cancelMomentum();
            touchActive       = true;
            touchStartY       = e.touches[0].clientY;
            touchStartX       = e.touches[0].clientX;
            touchStartScrollY = this.scrollY;
            touchStartScrollX = this.scrollX;
            touchSamples      = [{ time: performance.now(), x: touchStartX, y: touchStartY }];
        }, { passive: true });

        element.addEventListener("touchmove", (e: TouchEvent) => {
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
        }, { passive: true });

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

                const beforeY = this.scrollY;
                const beforeX = this.scrollX;
                this.setScrollY(this.scrollY + velocityY * frame);
                this.setScrollX(this.scrollX + velocityX * frame);
                if (this.scrollY === beforeY) {
                    velocityY = 0;
                }
                if (this.scrollX === beforeX) {
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

        element.addEventListener("touchend", () => {
            if (!touchActive) {
                return;
            }
            touchActive = false;
            startMomentum();
        }, { passive: true });

        element.addEventListener("touchcancel", () => {
            touchActive = false;
            cancelMomentum();
        }, { passive: true });
    }
}
