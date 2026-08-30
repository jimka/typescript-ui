// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Util } from "~/core/Util.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { SmoothScroller, consumeWheel } from "~/core/SmoothScroller.js";
import { Scrollbar } from "~/component/container/Scrollbar.js";
import { scrollShadowBoxShadow, scrollShadowEdgeValue, scrollShadowRamp, quantizeShadowEdge, ScrollShadowEdges } from "~/core/ScrollShadow.js";

// VirtualScroller is a plain helper, not a Component: it owns and lays out raw
// `clipBox` / `rowsContainer` `HTMLElement`s it creates directly, so the
// Component style setters don't apply and direct `.style` writes are correct.

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
    private _clipBox        : Handle;
    private _rowsContainer  : Handle;
    private _scrollbarV     : Scrollbar;
    private _scrollbarH     : Scrollbar;
    private _scrollX        : number = 0;
    private _scrollY        : number = 0;
    private _contentWidth   : number = 0;
    private _contentHeight  : number = 0;
    private _smooth         : SmoothScroller;
    private _shadowOverlay  : Handle;
    private _shadowEdges     : ScrollShadowEdges = { top: 0, bottom: 0, left: 0, right: 0 };

    /**
     * Constructs a VirtualScroller and attaches it to the owner element.
     *
     * @param owner - The component being scrolled (used for `getContentBounds`).
     * @param element - The owner's root DOM element. Must already exist; call
     * this from the owner's `init()` after `super.init(element)`.
     * @param onScroll - Callback invoked when scroll position changes via
     * user input.
     */
    constructor(owner: Component, element: Handle, onScroll: VirtualScrollerOnScroll) {
        this._owner    = owner;
        this._onScroll = onScroll;

        // Two-element wrapper: the outer `clipBox` carries `overflow:hidden`
        // sized to the effective viewport so the Scrollbar widgets — positioned
        // by `layoutScrollbars` at the far edge of the owner's content box —
        // sit in their own reserved band rather than overlaying the rightmost
        // column / bottom row. The inner `rowsContainer` carries the scroll
        // transform; the transform cannot sit on the same element as
        // `overflow:hidden` because CSS clipping happens in the element's own
        // LOCAL coordinate system before its transform applies — splitting
        // the two roles lets the transform shift the rows around inside a
        // stable clip.
        const clipBox = DOM.sink.createElement("div");
        DOM.sink.apply(clipBox, { style: { position: "absolute", top: "0", left: "0", width: "100%", height: "100%", overflow: "hidden" } });
        DOM.sink.appendChild(element, clipBox);
        this._clipBox = clipBox;

        const container = DOM.sink.createElement("div");
        DOM.sink.apply(container, { style: { position: "absolute", top: "0", left: "0", width: "100%", transform: "translate3d(0, 0, 0)", willChange: "transform" } });
        DOM.sink.appendChild(clipBox, container);
        this._rowsContainer = container;

        // Position-aware edge shadows, matching the native-scroll `Panel` cue.
        // The overlay is a sibling of `rowsContainer` inside the `clipBox`, so it
        // is clipped to the effective viewport and — being outside the scrolled
        // `rowsContainer` — is not shifted by the scroll transform; sizing it to
        // 100% tracks the clip box that `layoutScrollbars` resizes to the
        // effective viewport. It paints above the rows (appended last) and is
        // inert to the pointer. Each edge is a `box-shadow` layer gated by a
        // custom property; `updateShadows` flips the property per scroll/resize.
        const shadowOverlay = DOM.sink.createElement("div");
        DOM.sink.apply(shadowOverlay, { style: {
            position:      "absolute",
            top:           "0",
            left:          "0",
            width:         "100%",
            height:        "100%",
            pointerEvents: "none",
            boxShadow:     scrollShadowBoxShadow(),
        } });
        DOM.sink.appendChild(clipBox, shadowOverlay);
        this._shadowOverlay = shadowOverlay;

        // Drives wheel-initiated scrolling through an eased RAF loop. The seam
        // delegates to the existing setScrollX/Y (which clamp, write the
        // transform, and fire onScroll, so the virtual window re-renders every
        // frame) and clamps targets against the same effective-viewport bounds.
        this._smooth = new SmoothScroller({
            read:  (axis) => axis === "x" ? this._scrollX : this._scrollY,
            write: (axis, value) => axis === "x" ? this.setScrollX(value) : this.setScrollY(value),
            clamp: (axis, value) => this.clampAxis(axis, value),
        });

        this._scrollbarV = new Scrollbar("vertical");
        DOM.sink.appendChild(element, this._scrollbarV.getElement(true)!);
        this._scrollbarV.on("scroll", (p: number) => {
            this._smooth.reset();
            this.setScrollY(p);
        });

        this._scrollbarH = new Scrollbar("horizontal");
        DOM.sink.appendChild(element, this._scrollbarH.getElement(true)!);
        this._scrollbarH.on("scroll", (p: number) => {
            this._smooth.reset();
            this.setScrollX(p);
        });

        this._owner.setTouchAction("none");

        // Subtree because wheel events fire on whichever descendant of the
        // owner the pointer is over (a row, a cell, …) — not the owner root.
        // passive: false so onWheel can preventDefault the native page scroll.
        Event.addSubtreeListener(
            this._owner,
            "wheel",
            { passive: false, handler: (e: WheelEvent) => this.onWheel(e) },
        );

        this.attachTouchHandlers();
    }

    /**
     * Disposes the two `Scrollbar` overlays this scroller owns. They are
     * appended straight onto the owner's element rather than registered as its
     * children, so the owner's `destructor()` recursion cannot reach them and
     * their per-instance stylesheet rules would otherwise survive teardown.
     * Called from `VirtualRowView.destructor()`.
     */
    dispose(): void {
        this._scrollbarV.dispose();
        this._scrollbarH.dispose();
    }

    /**
     * Returns the two created container handles (clip box and rows container).
     * The owning component tracks these via `trackHandle` so they are released
     * with the owner — on its destructor or, for a discarded owner, on GC — and
     * not left pinned in the registry. The scroller is not a `Component`, so it
     * cannot track its own handles.
     *
     * @returns The scroller's owned element handles.
     */
    ownedHandles(): readonly Handle[] {
        return [this._clipBox, this._rowsContainer, this._shadowOverlay];
    }

    /**
     * Returns the rows-container element. Owners append pool rows here so
     * they participate in the transform-based scroll.
     *
     * @returns The rows-container DOM element.
     */
    getRowsContainer(): Handle {
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
     * content height and the *effective* viewport height (the owner's
     * content-box height minus the horizontal scrollbar's reservation when
     * that bar is visible),
     * so the maximum reachable scroll position matches what the vertical
     * scrollbar's thumb tops out at. Triggers the owner's `onScroll` callback
     * if the position changed.
     *
     * @param y - The new scroll position in pixels.
     */
    setScrollY(y: number): this {
        const maxScroll = Math.max(0, this._contentHeight - this.effectiveViewportH());
        const next      = Util.clamp(y, 0, maxScroll);

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
     * content width and the *effective* viewport width (the owner's
     * content-box width minus the vertical scrollbar's reservation when that
     * bar is visible),
     * so the maximum reachable scroll position matches what the horizontal
     * scrollbar's thumb tops out at. Triggers the owner's `onScroll` callback
     * if the position changed.
     *
     * @param x - The new scroll position in pixels.
     */
    setScrollX(x: number): this {
        const maxScroll = Math.max(0, this._contentWidth - this.effectiveViewportW());
        const next      = Util.clamp(x, 0, maxScroll);

        if (next === this._scrollX) {
            return this;
        }

        this._scrollX = next;
        this.updateTransform();
        this._onScroll();

        return this;
    }

    /**
     * Clamps a requested position for one axis to its `[0, max]` range, using
     * the same effective-viewport bounds as `setScrollX/Y` so the eased wheel
     * target converges exactly where the scrollbar thumb tops out.
     *
     * @param axis - The axis to clamp (`"x"` or `"y"`).
     * @param value - The requested position in pixels.
     *
     * @returns The clamped position in pixels.
     */
    private clampAxis(axis: "x" | "y", value: number): number {
        const max = axis === "x"
            ? Math.max(0, this._contentWidth  - this.effectiveViewportW())
            : Math.max(0, this._contentHeight - this.effectiveViewportH());

        return Util.clamp(value, 0, max);
    }

    /**
     * Aborts any in-flight eased wheel animation and re-seeds it from the live
     * position. Call before a programmatic scroll jump (e.g. `scrollToRecord`)
     * so a lingering ease can't snap the position back afterward.
     */
    resetWheelEase(): void {
        this._smooth.reset();
    }

    /**
     * Decides whether each scrollbar should be visible given the current
     * content size, accounting for the mutual dependency between the two
     * axes — if one bar is visible, its track-width reservation shrinks
     * the cross-axis viewport, which can in turn force the other bar to
     * become visible. Two iterations are sufficient: each pass can only
     * promote one flag from false to true.
     *
     * The effective viewport is measured in the owner's content box, not its
     * outer box, so a bordered or padded owner reports the space actually
     * visible to rows.
     */
    private computeScrollbarVisibility(contentWidth: number, contentHeight: number): { vVisible: boolean, hVisible: boolean, effW: number, effH: number } {
        const box = this._owner.getContentBounds()
                 ?? { x: 0, y: 0, width: this._owner.getWidth() || 0, height: this._owner.getHeight() || 0 };

        // `box.{width,height}` derive from the owner's committed `_width`/
        // `_height`, which are declared `NaN` and stay so until the owner is
        // first sized. The `?? …` fallback above covers the no-element case,
        // not that one — an element-bearing but unsized owner still yields a
        // non-null box whose extents are NaN — so `|| 0` stays, the same
        // coercion the outer-box reads it replaced already used.
        const outerH = box.height || 0;
        const outerW = box.width  || 0;
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
     * Effective vertical viewport — the owner's content-box height minus the
     * horizontal scrollbar's track-width reservation when that bar would be
     * visible.
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
     * Effective viewport width for the last-known content metrics — the owner's
     * content-box width minus the vertical scrollbar's track reservation when
     * that bar is visible. Owners that size fill-width rows (e.g. the
     * [`Tree`](/api/component/tree/classes/Tree)) base their row width on this so
     * content does not run under the vertical bar, which would otherwise force a
     * spurious horizontal bar for the reserved band. Reads the current
     * `_contentWidth` / `_contentHeight`; callers refresh those via
     * {@link clampToContent} at the top of their render pass before querying.
     * The public face of `effectiveViewportW` (same value; that stays the
     * internal clamp helper).
     *
     * @returns The effective viewport width in pixels.
     */
    getViewportWidth(): number {
        return this.effectiveViewportW();
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
     * Both bars and the clip box are placed in the owner's content box: a
     * child's containing block is already the owner's padding box, so
     * placing them against the outer box would run the far edge past where
     * `overflow: hidden` clips, by both border sides.
     *
     * @param contentWidth - The total scrollable content width in pixels.
     * @param contentHeight - The total scrollable content height in pixels.
     */
    layoutScrollbars(contentWidth: number, contentHeight: number): void {
        this._contentWidth  = contentWidth;
        this._contentHeight = contentHeight;

        const box    = this._owner.getContentBounds()
                     ?? { x: 0, y: 0, width: this._owner.getWidth() || 0, height: this._owner.getHeight() || 0 };

        const trackW = this._scrollbarV.getTrackWidth();

        const { effW, effH } = this.computeScrollbarVisibility(contentWidth, contentHeight);

        const maxY = Math.max(0, contentHeight - effH);
        const maxX = Math.max(0, contentWidth  - effW);
        if (this._scrollY > maxY || this._scrollX > maxX) {
            if (this._scrollY > maxY) this._scrollY = maxY;
            if (this._scrollX > maxX) this._scrollX = maxX;
            this.updateTransform();
        }

        this._scrollbarV.setX(box.x + Math.max(0, box.width - trackW));
        this._scrollbarV.setY(box.y);
        this._scrollbarV.setHeight(effH);
        this._scrollbarV.setMetrics(effH, contentHeight, this._scrollY);

        this._scrollbarH.setX(box.x);
        this._scrollbarH.setY(box.y + Math.max(0, box.height - trackW));
        this._scrollbarH.setWidth(effW);
        this._scrollbarH.setMetrics(effW, contentWidth, this._scrollX);

        // Resize the clip box to the effective viewport so cells translated
        // by the horizontal scroll can't bleed under the vertical scrollbar
        // (and rows beyond the bottom can't bleed under the horizontal
        // scrollbar). When neither bar is visible this collapses to the
        // full owner content box, matching the previous `width/height: 100%`
        // behaviour for a borderless, unpadded owner.
        DOM.sink.apply(this._clipBox, { style: { left: box.x + "px", top: box.y + "px", width: effW + "px", height: effH + "px" } });

        // Content size / viewport may have changed without the scroll position
        // moving (so `updateTransform` did not run above) — refresh the shadow
        // edges against the new extremes.
        this.updateShadows();
    }

    /**
     * Writes the current `scrollX` / `scrollY` into the rows-container
     * transform.
     */
    private updateTransform(): void {
        DOM.sink.apply(this._rowsContainer, { style: { transform: `translate3d(${-this._scrollX}px, ${-this._scrollY}px, 0)` } });
        this.updateShadows();
    }

    /**
     * Recomputes each scroll-shadow edge's strength from the current scroll
     * position, content size, and effective viewport, then lights only the
     * edges that have hidden content past them. Cheap on a no-op scroll: an
     * edge whose quantised strength is unchanged skips the DOM write (see
     * {@link setShadowEdge}). Called on every scroll ({@link updateTransform})
     * and whenever the content/viewport metrics change ({@link layoutScrollbars}).
     */
    private updateShadows(): void {
        const { effW, effH } = this.computeScrollbarVisibility(this._contentWidth, this._contentHeight);

        const maxX = Math.max(0, this._contentWidth  - effW);
        const maxY = Math.max(0, this._contentHeight - effH);

        this.setShadowEdge("top",    "--ts-ss-top",    scrollShadowRamp(this._scrollY));
        this.setShadowEdge("bottom", "--ts-ss-bottom", scrollShadowRamp(maxY - this._scrollY));
        this.setShadowEdge("left",   "--ts-ss-left",   scrollShadowRamp(this._scrollX));
        this.setShadowEdge("right",  "--ts-ss-right",  scrollShadowRamp(maxX - this._scrollX));
    }

    /**
     * Sets a single edge's shadow strength by scaling the theme shadow colour
     * toward transparent. Strength is quantised to a whole percent so an
     * in-ramp scroll only repaints when the visible strength actually changes;
     * at zero the property is unset so the `box-shadow` layer falls back to
     * `transparent`.
     *
     * @param edge - The edge whose cached strength this updates.
     * @param property - The overlay custom property backing that edge's shadow.
     * @param strength - The target strength in the range 0–1.
     */
    private setShadowEdge(edge: keyof ScrollShadowEdges, property: string, strength: number): void {
        const percent = quantizeShadowEdge(this._shadowEdges, edge, strength);

        if (percent === null) {
            return;
        }

        DOM.sink.apply(this._shadowOverlay, { style: { [property]: scrollShadowEdgeValue(percent) } });
    }

    /**
     * Eases wheel input into the scroll position through the {@link SmoothScroller}.
     * Shift+wheel without an explicit deltaX is treated as horizontal scroll.
     * Claims the event so an ancestor scroll container doesn't also scroll it.
     *
     * @param e - The wheel event.
     */
    private onWheel(e: WheelEvent): Event.ListenerResult {
        if (!consumeWheel(e)) {
            return;
        }

        if (e.shiftKey && e.deltaY !== 0 && e.deltaX === 0) {
            this._smooth.scrollBy(e.deltaY, 0);

            return { prevent: true };
        }

        this._smooth.scrollBy(e.deltaX, e.deltaY);

        return { prevent: true };
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
                DOM.sink.cancelAnimationFrame(momentumRaf);
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
            this._smooth.reset();
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

                momentumRaf = DOM.sink.requestAnimationFrame(step);
            };

            momentumRaf = DOM.sink.requestAnimationFrame(step);
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
