// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Panel, PanelOptions } from "~/core/Panel.js";
import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Button, ButtonOptions } from "~/component/button/Button.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";
import { Insets } from "~/primitive/Insets.js";
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

/** The rectangle `getContentBounds()` returns, passed from layoutContent to layoutArrows. */
type ContentBox = { x: number; y: number; width: number; height: number };

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

    /** Fallback per-click step (px) used when no step provider is set. Defaults to roughly one wide control. */
    arrowStep?: number;
}

const _defaultScrollStripOptions: Partial<ScrollStripOptions> = {
    backgroundColor: "transparent",
};

/**
 * Class-tier chrome shared by every lead/trail arrow button, following
 * `Scrollbar.ts`'s `ScrollArrowButton` shape: `backgroundImage`/`border`/
 * `shadow`/`borderRadius` are the four `ensureArrows` declarations confirmed
 * against `StyleBag`'s field list. `border`/`shadow` use the literal `"none"`
 * string — matching `clearBorder()`/`clearShadow()`'s own written value —
 * rather than `null`: `resolveDeclarations` truthy-gates both keys, so a
 * `null` value would resolve to "no declaration at this class tier" and let
 * `Button`'s own border/shadow default leak through, instead of overriding it
 * to none the way `clearBorder()`/`clearShadow()` do. `clearInsets()` and
 * `setZIndex(3)` stay per-instance — `zIndex` has no `StyleBag` field, and
 * `clearInsets`'s exact mapping onto `StyleBag.padding` was not verified for
 * this migration (see `## Non-Goals`).
 */
const _defaultScrollStripArrowButtonStyleDefaults: Partial<ButtonOptions> = {
    backgroundImage: "none",
    border:          "none",
    shadow:          "none",
    borderRadius:    "0",
};

/** Internal arrow-button subclass carrying the shared class-tier chrome above. */
class ScrollStripArrowButton extends Button {
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultScrollStripArrowButtonStyleDefaults;

    constructor(options?: ButtonOptions, subclassDefaults?: Partial<ButtonOptions>) {
        // Forwarded as `subclassDefaults` (not just `ownClassStyleDefaults`
        // above) so `_defaultOptions` — the fallback `getBorder()`/
        // `getBorderRadius()`/etc. read, and Button's own UA-defeating
        // per-instance write draws from — agrees with the class-tier chrome
        // instead of falling back to Button's own "2px ridge" default. The
        // caller's own `subclassDefaults` layers on top, mirroring
        // `Scrollbar.ts`'s `ScrollArrowButton` and `TabCloseButton`'s
        // identical forwarding shape — a no-op today (this class has no
        // subclass yet) but the dead end ARCHITECTURE.md's "Constructors
        // forward subclassDefaults" rule warns against otherwise.
        super(undefined, options, { ..._defaultScrollStripArrowButtonStyleDefaults, ...(subclassDefaults ?? {}) });

        // Not in StyleBag (checked core/ClassStyleRules.ts:44-93 — neither
        // field exists): clearInsets's exact resolved value against
        // StyleBag.padding's null-vs-value semantics was not verified for
        // this plan, and zIndex has no StyleBag field at all. Both stay
        // per-instance.
        this.clearInsets();
        this.setZIndex(3);
    }
}

/**
 * A button rail that lays a row or column of items and scrolls them past its
 * edges when they overflow, showing lead/trail paging arrows in reserved gutters.
 *
 * `ScrollStrip` is a non-scrolling *band* element that hosts two things: an inner
 * `overflow:hidden` clip (the scroll-port) running an `HBox` (horizontal) or
 * `VBox` (vertical) over the items added via {@link addItem}, and the two paging
 * arrows. Splitting the band from the clip is what keeps the arrows fixed in their
 * gutters: they are children of the non-scrolling band, so they never inherit the
 * clip's scroll translation, while the items scroll inside the clip between them.
 * When the items overflow along the main axis the strip reserves a gutter at each
 * end (see {@link arrowReserve}); the owner sizes the band, and the strip sizes its
 * clip to the band's content box minus the gutters and places the arrows
 * ({@link layoutContent}).
 * The clip's native main-axis offset is the single source of truth — read via
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

    // The inner clip: a Panel sized to the band minus the arrow gutters, with
    // overflow:hidden + native scroll. It — not this element — holds the box
    // children (the items) and any raw-appended overlays, so the items scroll and
    // clip inside it while the arrows (children of THIS non-scrolling band element)
    // hold their gutters. A nested Panel rather than this element because the clip
    // needs independent behaviour (its own scroll-port) from the band.
    private _clip: Panel = new Panel();

    // The two paging arrows, built lazily the first time the strip overflows while
    // scrollable. Raw-appended to THIS element (the non-scrolling band) so they sit
    // in the gutters and never inherit the inner clip's scroll translation.
    private _leadArrow: Button | null = null;
    private _trailArrow: Button | null = null;

    /**
     * Builds an empty scroll strip with the default horizontal orientation,
     * transparent background, and an inner overflow:hidden clip for the items.
     *
     * @param options - Optional construction-time options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: ScrollStripOptions, subclassDefaults?: Partial<ScrollStripOptions>) {
        super(options, { ..._defaultScrollStripOptions, ...(subclassDefaults ?? {}) });

        // Seed the cascade-written fields to their defaults. The super() cascade
        // already dispatched any option that was passed; these `??=`-style seeds
        // only fill an absent option, so an explicit option is never overwritten.
        this._orientation ??= "horizontal";
        this._scrollable ??= true;
        this._arrowBackground ??= null;
        this._arrowStep ??= SCROLL_ARROW_STEP;

        // ScrollStrip owns its own arrow paging + programmatic clip scroll, so
        // it never wants a synced overlay bar; force native to opt out of the
        // Panel default.
        this.setScrollbarStyle("native");

        // The band element itself does not scroll (it hosts the fixed arrows); the
        // inner clip carries the overflow:hidden scroll-port. Both are transparent
        // so the owner's surface shows through.
        this.clearInsets();

        this._clip.setOverflow("hidden");
        this._clip.setBackgroundColor("transparent");
        this._clip.clearInsets();
        this.installBox(this._orientation);
    }

    /**
     * Raw-appends the inner clip into the band element at first render — the band
     * exists by then, unlike during construction.
     *
     * @param element - Optional. The element to initialise; falls back to `getElement()`.
     *
     * @returns This strip, for method chaining.
     */
    protected init(element?: Handle): this {
        super.init(element);

        const host = element ?? this.getElement(true)!;
        DOM.sink.appendChild(host, this._clip.getElement(true)!);

        return this;
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
        // A cascade-dispatched `setOrientation` (from `applyOptions`, run inside
        // super()) can reach here before the `_clip` field initializer runs. Skip
        // it then — `_orientation` is already cached, and the constructor body
        // installs the box once `_clip` exists.
        if (!this._clip) {
            return;
        }

        const box = orientation === "vertical"
            ? new VBox({ mode: "equal", spacing: 0, stretching: true })
            : new HBox({ mode: "equal", spacing: 0, stretching: true });

        this._clip.setLayoutManager(box);
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
     * Adds an item as a box child of the inner clip — part of the scrolling
     * row/column.
     *
     * @param item - The item to append.
     *
     * @returns This strip, for method chaining.
     */
    addItem(item: Component): this {
        this._clip.addComponent(item);

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
        this._clip.removeComponent(item);

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
        this._clip.moveComponent(item, toIndex);

        return this;
    }

    /**
     * Returns the items currently in the scrolling box, in order.
     *
     * @returns The clip's box children.
     */
    getItems(): Array<Component> {
        return this._clip.getComponents();
    }

    /**
     * Returns the inner clip's box layout manager — an `HBox` (horizontal) or
     * `VBox` (vertical) per the current orientation.
     *
     * @returns The clip's layout manager.
     */
    getContentBox(): ReturnType<Panel["getLayoutManager"]> {
        return this._clip.getLayoutManager();
    }

    /**
     * Lays out the inner clip's box, sizing the items, then resyncs the strip's
     * cached scroll offset from the DOM (the browser may clamp the native offset on
     * its own when the content lays out smaller than the current offset). Call after
     * positioning the band (see {@link layoutContent}) and before reading the scroll.
     *
     * @returns This strip, for method chaining.
     */
    layoutItems(): this {
        this._clip.doLayout();
        this._clip.syncScrollOffsets();

        return this;
    }

    /**
     * Returns the inner clip element so an owner can raw-append overlays that must
     * scroll and clip with the items (e.g. a selection indicator).
     *
     * @param forceCreate - When true, realises the element if it does not exist yet.
     *
     * @returns The clip element handle, or null when not yet realised.
     */
    getClipElement(forceCreate?: boolean): Handle | null {
        return this._clip.getElement(forceCreate) ?? null;
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

        const lead = new ScrollStripArrowButton({ glyph: "angle-left" });
        const trail = new ScrollStripArrowButton({ glyph: "angle-right" });

        for (const button of [lead, trail]) {
            if (this._arrowBackground !== null) {
                button.setBackgroundColor(this._arrowBackground);
            }
        }

        lead.on("action", this.leadClicked);
        trail.on("action", this.trailClicked);

        // Raw-append to the band element (this) — NOT the inner clip — so the
        // arrows stay fixed in their gutters and never inherit the clip's scroll
        // translation.
        const element = this.getElement(true)!;
        DOM.sink.appendChild(element, lead.getElement(true)!);
        DOM.sink.appendChild(element, trail.getElement(true)!);

        this._leadArrow = lead;
        this._trailArrow = trail;
    }

    /**
     * Lays out the strip's content within its own (owner-positioned) band: sizes
     * the inner clip to the band minus a gutter at each end, places and enables the
     * arrows into those gutters, runs the clip's box, and resyncs the cached scroll
     * offset. The band is the strip's own content box; the gutters carry the fixed
     * arrows while the clip scrolls the items between them. An `endGap` trailing-
     * aligns the items by insetting the clip's leading edge.
     *
     * @param reserve - The per-end arrow gutter in px (0 = no arrows, clip spans the band).
     * @param endGap - The leading inset (px) that trailing-aligns the items (0 otherwise).
     *
     * @returns This strip, for method chaining.
     */
    layoutContent(reserve: number, endGap: number): this {
        const box = this.getContentBounds()
                 ?? { x: 0, y: 0, width: this.getWidth() || 0, height: this.getHeight() || 0 };

        const vertical = this.isVertical();
        const bandMain = vertical ? box.height : box.width;
        const thickness = vertical ? box.width : box.height;
        const clipMain = bandMain - 2 * reserve;

        // Size the inner clip to the region between the gutters and fold the
        // end-align gap into its leading inset, so the box trailing-aligns natively.
        if (vertical) {
            this._clip.setX(box.x);
            this._clip.setY(box.y + reserve);
            this._clip.setWidth(thickness);
            this._clip.setHeight(clipMain);
            this._clip.setInsets(new Insets(endGap, 0, 0, 0));
        } else {
            this._clip.setX(box.x + reserve);
            this._clip.setY(box.y);
            this._clip.setWidth(clipMain);
            this._clip.setHeight(thickness);
            this._clip.setInsets(new Insets(0, 0, 0, endGap));
        }

        this.layoutItems();
        this.layoutArrows(box, reserve);

        return this;
    }

    /**
     * Positions, sizes, and enables the two arrows in the gutters at each end of the
     * band, or hides them when the band carries no reserve. The lead gutter sits at
     * the box's main-axis origin, the trail gutter at `box origin + bandMain - reserve`,
     * both spanning the box's cross-axis thickness. Each arrow is disabled (not
     * hidden) at its scroll limit so the chrome never shifts as the items scroll
     * between them.
     *
     * @param box - The content box `layoutContent` resolved.
     * @param reserve - The per-end gutter (the arrows' main-axis size) in px; 0 hides them.
     */
    private layoutArrows(box: ContentBox, reserve: number): void {
        if (!this._scrollable || reserve <= 0) {
            this.hideArrows();

            return;
        }

        this.ensureArrows();

        const lead = this._leadArrow as Button;
        const trail = this._trailArrow as Button;
        const vertical = this.isVertical();
        const bandMain = vertical ? box.height : box.width;
        const thickness = vertical ? box.width : box.height;

        lead.setGlyph(vertical ? "angle-up" : "angle-left");
        trail.setGlyph(vertical ? "angle-down" : "angle-right");

        lead.setVisible(true);
        trail.setVisible(true);

        this.refreshArrows();

        const trailPos = (vertical ? box.y : box.x) + bandMain - reserve;

        for (const button of [lead, trail]) {
            if (vertical) {
                // Pin the main-axis (height) to the gutter; fill the thickness.
                button.setMinSize({ width: 0, height: reserve });
                button.setMaxSize({ width: Number.MAX_VALUE, height: reserve });
                button.setX(box.x);
                button.setWidth(thickness);
                button.setHeight(reserve);
            } else {
                button.setMinSize({ width: reserve, height: 0 });
                button.setMaxSize({ width: reserve, height: Number.MAX_VALUE });
                button.setY(box.y);
                button.setHeight(thickness);
                button.setWidth(reserve);
            }
        }

        if (vertical) {
            lead.setY(box.y);
            trail.setY(trailPos);
        } else {
            lead.setX(box.x);
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
        return this.isVertical() ? this._clip.getScrollTop() : this._clip.getScrollLeft();
    }

    /**
     * Returns the clip's maximum native scroll offset on the main axis, derived
     * live from the laid-out content.
     *
     * @returns The last-page scroll offset in px (0 when nothing overflows).
     */
    private mainScrollMax(): number {
        return this.isVertical() ? this._clip.getMaxScrollTop() : this._clip.getMaxScrollLeft();
    }

    /**
     * Writes the clip's native main-axis scroll offset; the browser clamps to the
     * scrollable range, and the cross axis is left untouched.
     *
     * @param value - The desired main-axis scroll offset in px.
     */
    setMainScroll(value: number): void {
        if (this.isVertical()) {
            this._clip.setScrollTop(value);
        } else {
            this._clip.setScrollLeft(value);
        }
    }

    /**
     * Resets the clip's native scroll to the origin on both axes — used when the
     * scroll axis itself changes (e.g. an owner side-switch) so the strip starts
     * the new axis unscrolled.
     *
     * @returns This strip, for method chaining.
     */
    resetScroll(): this {
        this._clip.setScrollLeft(0);
        this._clip.setScrollTop(0);

        return this;
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
        const clipElement = this._clip.getElement();

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
        // the screen-space correction; apply it to the native offset, then refresh
        // the arrows. Like scrollBy, a reveal that moves the scroll must re-derive
        // the arrows' enabled state — reveal-on-select can jump from the start to
        // the end (e.g. selecting the last tab while scrolled fully to the start),
        // which flips both arrows' limits.
        if (delta !== 0) {
            this.setMainScroll(this.mainScroll() + delta);
            this.refreshArrows();
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

    /**
     * Disposes the scrolling clip (and every item added via `addItem` it
     * holds) and the paging arrows, when built, then defers to the base
     * class for the rest of teardown.
     *
     * @remarks `_clip` / `_leadArrow` / `_trailArrow` are raw-appended to
     * this strip's own element rather than registered via `addComponent`
     * (see the constructor and `ensureArrows`), so the base class's
     * recursive teardown cannot reach them — or, through `_clip`, the items
     * it hosts.
     */
    protected destructor(): void {
        this._clip.dispose();
        this._leadArrow?.dispose();
        this._trailArrow?.dispose();

        super.destructor();
    }
}

const ScrollStripCallable = callable(ScrollStrip);
type ScrollStripCallable = ScrollStrip;
export {
    ScrollStrip         as _ScrollStrip,
    ScrollStripCallable as ScrollStrip,
};
