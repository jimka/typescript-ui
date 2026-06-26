// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Panel, PanelOptions } from "~/core/Panel.js";
import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Button } from "~/component/button/Button.js";
import { HBox } from "~/layout/HBox.js";
import { VBox } from "~/layout/VBox.js";
import { Glyph } from "~/component/display/Glyph.js";
import { angle_left } from "~/glyphs/solid/angle_left.js";
import { angle_right } from "~/glyphs/solid/angle_right.js";
import { angle_up } from "~/glyphs/solid/angle_up.js";
import { angle_down } from "~/glyphs/solid/angle_down.js";
import { callable } from "~/core/Callable.js";

// Seed the registry with the four chevrons the arrows draw, independent of which
// glyphs the consumer has imported (mirrors TabCloseButton's xmark seed).
Glyph.register(angle_left, angle_right, angle_up, angle_down);

/**
 * The per-end scroll-arrow gutter (px) reserved at each end of the strip when it
 * overflows. The arrows are square (gutter wide, strip-thickness tall), so this
 * is both the reserved main-axis space and the arrows' main-axis size. Matches
 * the tab-strip overflow chrome it was extracted from; an empirical fit for a
 * chevron glyph in a strip-height button.
 */
const SCROLL_ARROW_SIZE = 24;

/**
 * Fallback per-click scroll step (px) when no step provider is wired and no
 * `arrowStep` is configured — roughly one wide control, so a click pages a
 * sensible amount before any content-derived step is available.
 */
const SCROLL_ARROW_STEP = 80;

/**
 * The scroll axis of a {@link ScrollStrip}: `"horizontal"` lays the items in a
 * row (main axis X), `"vertical"` in a column (main axis Y).
 *
 * @category Components
 */
export type ScrollStripOrientation = "horizontal" | "vertical";

/**
 * Construction-time options for {@link ScrollStrip}.
 *
 * @category Components
 */
export interface ScrollStripOptions extends PanelOptions {
    /** Scroll axis — `"horizontal"` (HBox) or `"vertical"` (VBox). Default `"horizontal"`. */
    orientation?: ScrollStripOrientation;

    /** When true, shows paging arrows on overflow; false clips only. Default `true`. */
    scrollable?: boolean;

    /** CSS background applied to the arrow buttons. Default the framework button background. */
    arrowBackground?: string;

    /** Fallback per-click step (px) used when no step provider is set. Default {@link SCROLL_ARROW_STEP}. */
    arrowStep?: number;
}

/**
 * A clip frame that lays a row or column of items and scrolls them past its
 * edges when they overflow, showing lead/trail paging arrows in reserved gutters.
 *
 * `ScrollStrip` **is** its own clip frame: its element is `overflow:hidden` and
 * runs an `HBox` (horizontal) or `VBox` (vertical) over the items added via
 * {@link addItem}. When the items overflow along the main axis it reserves a
 * gutter at each end (see {@link arrowReserve}) and the owner places the strip's
 * frame to span the whole band; the two arrow buttons sit in those gutters,
 * paging one step per click and disabling at the scroll limits. The native
 * scroll offset on the main axis is the single source of truth — read via
 * {@link mainScroll}, written via {@link setMainScroll} — so any overlay
 * raw-appended into the clip element (via {@link getClipElement}) scrolls and
 * clips together with the items for free.
 *
 * The component is axis-generic and token-agnostic: it owns the scrolling and
 * arrow mechanic, while the owner keeps its own band geometry, theming (via
 * {@link setArrowBackground}), and per-item step ({@link setStepProvider}).
 *
 * @category Components
 */
class ScrollStrip extends Panel<ScrollStripOptions> {

    // The scroll axis. Written by `setOrientation` from `applyOptions` during the
    // super() cascade, so it must be `declare`d (a real initializer would revert
    // the cascade write). Seeded by the constructor body to "horizontal" before
    // any option dispatch when no orientation option is given.
    declare private _orientation: ScrollStripOrientation;

    // Whether the strip shows paging arrows on overflow. Cascade-written by
    // `setScrollable`, hence `declare`.
    declare private _scrollable: boolean;

    // Background applied to the arrow buttons. Cascade-written by
    // `setArrowBackground`, hence `declare`; null until a consumer themes them.
    declare private _arrowBackground: string | null;

    // Fallback per-click step (px). Cascade-written by `setArrowStep`, hence
    // `declare`.
    declare private _arrowStep: number;

    // Per-click step provider — when set, wins over `_arrowStep` so the owner can
    // track a live (font-derived) one-item extent. Not a cascade-written option
    // (it is a function the owner supplies after construction), so a plain field.
    private _stepProvider: (() => number) | null = null;

    // The two paging arrows, built lazily the first time the strip overflows
    // while scrollable. Raw-appended to this element above the box children.
    private _leadArrow: Button | null = null;
    private _trailArrow: Button | null = null;

    /**
     * Builds an empty scroll strip with the default horizontal orientation,
     * `overflow:hidden` clip, transparent background, and cleared insets.
     *
     * @param options - Optional construction-time options.
     */
    constructor(options?: ScrollStripOptions) {
        super(options);

        // Seed the cascade-written fields to their defaults. The super() cascade
        // already dispatched any option that was passed; these `??=`-style seeds
        // only fill an absent option, so an explicit option is never overwritten.
        this._orientation ??= "horizontal";
        this._scrollable ??= true;
        this._arrowBackground ??= null;
        this._arrowStep ??= SCROLL_ARROW_STEP;

        // The clip frame: overflow:hidden so a scrolled-past item is clipped at
        // the edge, transparent so the owner's surface shows through, no insets,
        // and the box for the current axis.
        this.setOverflow("hidden");
        this.setBackgroundColor("transparent");
        this.clearInsets();
        this.installBox(this._orientation);
    }

    /**
     * Forwards the strip-only options through their typed setters. The base
     * `Panel`/`Component` options were already dispatched by `super()`.
     *
     * @param options - The construction options.
     *
     * @returns This strip, for method chaining.
     */
    protected applyOptions(options: ScrollStripOptions): this {
        super.applyOptions(options);

        if (options.orientation !== undefined) {
            this.setOrientation(options.orientation);
        }

        if (options.scrollable !== undefined) {
            this.setScrollable(options.scrollable);
        }

        if (options.arrowBackground !== undefined) {
            this.setArrowBackground(options.arrowBackground);
        }

        if (options.arrowStep !== undefined) {
            this.setArrowStep(options.arrowStep);
        }

        return this;
    }

    /**
     * Installs the box layout manager for the given orientation — `HBox` for
     * horizontal, `VBox` for vertical — matching the equal-mode, zero-spacing,
     * stretching configuration the strip's items expect.
     *
     * @param orientation - The orientation whose box to install.
     */
    private installBox(orientation: ScrollStripOrientation): void {
        const box = orientation === "vertical"
            ? new VBox({ mode: "equal", spacing: 0, stretching: true })
            : new HBox({ mode: "equal", spacing: 0, stretching: true });

        this.setLayoutManager(box);
    }

    /**
     * Returns whether the strip scrolls along the Y axis (vertical) rather than X.
     *
     * @returns `true` for a vertical strip.
     */
    private isVertical(): boolean {
        return this._orientation === "vertical";
    }

    /**
     * Sets the scroll axis, swapping the box layout manager to match. A no-op
     * when already that orientation, so the box instance survives.
     *
     * @param orientation - The new scroll axis.
     *
     * @returns This strip, for method chaining.
     */
    setOrientation(orientation: ScrollStripOrientation): this {
        if (this._orientation === orientation) {
            return this;
        }

        this._orientation = orientation;
        this.installBox(orientation);

        return this;
    }

    /**
     * Returns the strip's scroll axis.
     *
     * @returns `"horizontal"` or `"vertical"`.
     */
    getOrientation(): ScrollStripOrientation {
        return this._orientation;
    }

    /**
     * Sets whether the strip shows paging arrows on overflow. When false,
     * {@link arrowReserve} is always 0 and the strip clips without arrows.
     *
     * @param value - True to enable paging arrows on overflow.
     *
     * @returns This strip, for method chaining.
     */
    setScrollable(value: boolean): this {
        this._scrollable = value;

        return this;
    }

    /**
     * Returns whether the strip shows paging arrows on overflow.
     *
     * @returns `true` when scrollable.
     */
    isScrollable(): boolean {
        return this._scrollable;
    }

    /**
     * Sets the CSS background applied to the arrow buttons, recolouring any that
     * are already built (so a consumer's focus-state swap repaints them).
     *
     * @param color - A CSS colour string.
     *
     * @returns This strip, for method chaining.
     */
    setArrowBackground(color: string): this {
        this._arrowBackground = color;

        this._leadArrow?.setBackgroundColor(color);
        this._trailArrow?.setBackgroundColor(color);

        return this;
    }

    /**
     * Sets the fallback per-click step (px) used when no step provider is wired.
     *
     * @param px - The per-click step in pixels.
     *
     * @returns This strip, for method chaining.
     */
    setArrowStep(px: number): this {
        this._arrowStep = px;

        return this;
    }

    /**
     * Sets a per-click step provider, consulted at click time so the step can
     * track a live (e.g. font-derived) item extent. Wins over {@link setArrowStep}
     * when set; pass `null` to fall back to the configured step.
     *
     * @param provider - A function returning the per-click step in px, or null.
     *
     * @returns This strip, for method chaining.
     */
    setStepProvider(provider: (() => number) | null): this {
        this._stepProvider = provider;

        return this;
    }

    /**
     * Resolves the per-click scroll step in px: the step provider's value when one
     * is wired, else the configured {@link setArrowStep} fallback.
     *
     * @returns The per-click step in pixels.
     */
    resolveStep(): number {
        return this._stepProvider ? this._stepProvider() : this._arrowStep;
    }

    /**
     * Adds an item as a box child — part of the scrolling row/column.
     *
     * @param item - The item to append.
     *
     * @returns This strip, for method chaining.
     */
    addItem(item: Component): this {
        this.addComponent(item);

        return this;
    }

    /**
     * Removes a previously-added item from the scrolling box.
     *
     * @param item - The item to remove.
     *
     * @returns This strip, for method chaining.
     */
    removeItem(item: Component): this {
        this.removeComponent(item);

        return this;
    }

    /**
     * Moves an item to a new index within the scrolling box.
     *
     * @param item - The item to move.
     * @param toIndex - The destination index.
     *
     * @returns This strip, for method chaining.
     */
    moveItem(item: Component, toIndex: number): this {
        this.moveComponent(item, toIndex);

        return this;
    }

    /**
     * Returns the clip element so an owner can raw-append overlays that must
     * scroll and clip with the items (e.g. a selection indicator). The element is
     * this strip's own element.
     *
     * @param forceCreate - When true, realises the element if it does not exist yet.
     *
     * @returns The clip element handle, or null when not yet realised.
     */
    getClipElement(forceCreate?: boolean): Handle | null {
        return this.getElement(forceCreate) ?? null;
    }

    /**
     * Returns the per-end scroll-arrow gutter (px) reserved when the strip is
     * scrollable and the items overflow the region along the main axis.
     *
     * A `+1` slop absorbs a flush fit so a strip that exactly fills its region
     * does not flicker the arrows: `content == region + 1` reserves nothing,
     * `content == region + 2` reserves a gutter.
     *
     * @param contentExtent - The predicted main-axis extent of the items (px).
     * @param regionExtent - The main-axis space available for the items (px).
     *
     * @returns 0, or the per-end gutter in px.
     */
    arrowReserve(contentExtent: number, regionExtent: number): number {
        if (!this._scrollable) {
            return 0;
        }

        return contentExtent > regionExtent + 1 ? SCROLL_ARROW_SIZE : 0;
    }

    /**
     * Lazily builds the two arrow buttons, styles them for the narrow gutter, wires
     * their paging actions, and raw-appends them above the box children.
     */
    private ensureArrows(): void {
        if (this._leadArrow && this._trailArrow) {
            return;
        }

        const lead = new Button({ glyph: "angle-left" });
        const trail = new Button({ glyph: "angle-right" });

        for (const button of [lead, trail]) {
            if (this._arrowBackground !== null) {
                button.setBackgroundColor(this._arrowBackground);
            }

            button.setBackgroundImage("none");
            button.clearBorder();
            button.clearShadow();
            button.setBorderRadius("0");
            // Drop the default button insets so the glyph fits the narrow gutter.
            button.clearInsets();
            // Above the box children so the arrows stay clickable at the strip
            // ends and cover any item that scrolls under them.
            button.setZIndex(3);
        }

        lead.on("action", this.leadClicked);
        trail.on("action", this.trailClicked);

        const element = this.getElement(true)!;
        DOM.sink.appendChild(element, lead.getElement(true)!);
        DOM.sink.appendChild(element, trail.getElement(true)!);

        this._leadArrow = lead;
        this._trailArrow = trail;
    }

    /**
     * Positions, sizes, and enables the two arrows within the gutters of the band
     * the owner passes, or hides them when the band carries no reserve. The band is
     * in this element's own (clip-local) coordinates: the lead gutter sits at
     * `mainOrigin`, the trail gutter at `mainOrigin + mainExtent - reserve`, both
     * spanning the cross-axis thickness. Each arrow is disabled (not hidden) at its
     * scroll limit so the chrome never shifts as the items scroll between them.
     *
     * @param mainOrigin - The band's leading edge on the main axis (clip-local px).
     * @param mainExtent - The band's main-axis extent (px).
     * @param crossOrigin - The band's leading edge on the cross axis (clip-local px).
     * @param thickness - The band's cross-axis thickness (px).
     * @param reserve - The per-end gutter (the arrows' main-axis size) in px; 0 hides them.
     */
    layoutArrows(mainOrigin: number, mainExtent: number, crossOrigin: number, thickness: number, reserve: number): void {
        if (!this._scrollable || reserve <= 0) {
            this.hideArrows();

            return;
        }

        this.ensureArrows();

        const lead = this._leadArrow as Button;
        const trail = this._trailArrow as Button;
        const vertical = this.isVertical();

        lead.setGlyph(vertical ? "angle-up" : "angle-left");
        trail.setGlyph(vertical ? "angle-down" : "angle-right");

        lead.setVisible(true);
        trail.setVisible(true);

        this.refreshArrows();

        const leadPos = mainOrigin;
        const trailPos = mainOrigin + mainExtent - reserve;

        for (const button of [lead, trail]) {
            if (vertical) {
                // Pin the main-axis (height) to the gutter; fill the thickness.
                button.setMinSize(0, reserve);
                button.setMaxSize(Number.MAX_VALUE, reserve);
                button.setX(crossOrigin);
                button.setWidth(thickness);
                button.setHeight(reserve);
            } else {
                button.setMinSize(reserve, 0);
                button.setMaxSize(reserve, Number.MAX_VALUE);
                button.setY(crossOrigin);
                button.setHeight(thickness);
                button.setWidth(reserve);
            }
        }

        if (vertical) {
            lead.setY(leadPos);
            trail.setY(trailPos);
        } else {
            lead.setX(leadPos);
            trail.setX(trailPos);
        }
    }

    /**
     * Hides both arrows if they have been built.
     */
    private hideArrows(): void {
        this._leadArrow?.setVisible(false);
        this._trailArrow?.setVisible(false);
    }

    /**
     * Reads the clip's native scroll offset on the main axis — the single source
     * of truth for the scroll position.
     *
     * @returns The current main-axis scroll offset in px.
     */
    mainScroll(): number {
        return this.isVertical() ? this.getScrollTop() : this.getScrollLeft();
    }

    /**
     * Returns the clip's maximum native scroll offset on the main axis, derived
     * live from the laid-out content.
     *
     * @returns The last-page scroll offset in px (0 when nothing overflows).
     */
    private mainScrollMax(): number {
        return this.isVertical() ? this.getMaxScrollTop() : this.getMaxScrollLeft();
    }

    /**
     * Writes the clip's native main-axis scroll offset; the browser clamps to the
     * scrollable range, and the cross axis is left untouched.
     *
     * @param value - The desired main-axis scroll offset in px.
     */
    setMainScroll(value: number): void {
        if (this.isVertical()) {
            this.setScrollTop(value);
        } else {
            this.setScrollLeft(value);
        }
    }

    /**
     * Re-derives the arrows' enabled state from the live native scroll position:
     * the lead arrow is dead at the start, the trail arrow at the last page (with a
     * 1px slop so a flush-to-end strip disables cleanly despite sub-pixel rounding).
     */
    refreshArrows(): void {
        const lead = this._leadArrow;
        const trail = this._trailArrow;

        if (!lead || !trail) {
            return;
        }

        const scroll = this.mainScroll();

        lead.setEnabled(scroll > 0);
        trail.setEnabled(scroll < this.mainScrollMax() - 1);
    }

    /**
     * Scrolls the strip by `delta` px along the main axis through native scroll,
     * then refreshes the arrows. No relayout: native scroll moves the items and any
     * clip-element overlays together for free.
     *
     * @param delta - Signed pixel amount (negative = toward the start).
     */
    private scrollBy(delta: number): void {
        this.setMainScroll(this.mainScroll() + delta);
        this.refreshArrows();
    }

    /**
     * Handles a lead-arrow click: pages one step toward the start, resolving the
     * step at click time so it tracks a live step provider.
     */
    private leadClicked = (): void => {
        this.scrollBy(-this.resolveStep());
    };

    /**
     * Handles a trail-arrow click: pages one step toward the end.
     */
    private trailClicked = (): void => {
        this.scrollBy(this.resolveStep());
    };

    /**
     * Nudges the native scroll the minimum amount needed to bring the given item
     * element fully into view, measured from the *laid-out* DOM rects. A
     * fully-visible item produces no scroll. The owner gates when to call this (the
     * one-shot reveal-on-select policy is the owner's concern).
     *
     * @param itemElement - The element of the item to reveal.
     */
    revealItem(itemElement: Handle): void {
        const clipElement = this.getElement();

        if (!clipElement) {
            return;
        }

        const vertical = this.isVertical();
        const clip = DOM.source.getElementRect(clipElement);
        const item = DOM.source.getElementRect(itemElement);

        const clipStart = vertical ? clip.top : clip.left;
        const clipEnd = vertical ? clip.bottom : clip.right;
        const itemStart = vertical ? item.top : item.left;
        const itemEnd = vertical ? item.bottom : item.right;

        let delta = 0;

        if (itemStart < clipStart) {
            delta = itemStart - clipStart;
        } else if (itemEnd > clipEnd) {
            delta = itemEnd - clipEnd;
        }

        // getBoundingClientRect already reflects the current scroll, so `delta` is
        // the screen-space correction; apply it to the native offset.
        if (delta !== 0) {
            this.setMainScroll(this.mainScroll() + delta);
        }
    }

    /**
     * Returns whether the given event target is one of the strip's arrow buttons —
     * for an owner's hit test that must distinguish chrome from blank area.
     *
     * @param target - The event target to test.
     *
     * @returns `true` when the target lies within either arrow.
     */
    containsArrow(target: EventTarget | null): boolean {
        if (!DOM.source.isNode(target)) {
            return false;
        }

        const handle = DOM.source.intern(target);

        for (const arrow of [this._leadArrow, this._trailArrow]) {
            const element = arrow?.getElement() ?? null;

            if (element && DOM.source.contains(element, handle)) {
                return true;
            }
        }

        return false;
    }
}

const ScrollStripCallable = callable(ScrollStrip);
type ScrollStripCallable = ScrollStrip;
export {
    ScrollStrip         as _ScrollStrip,
    ScrollStripCallable as ScrollStrip,
};
