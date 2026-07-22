// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { LayerManager, DismissableLayer, LayerDismissMode } from "~/core/LayerManager.js";
import { trapWheel, untrapWheel } from "~/core/WheelTrap.js";
import { Util } from "~/core/Util.js";
import { fadeShow, fadeHideAndDetach } from "~/core/AnimatedDropdown.js";
import { Container, ContainerOptions } from "~/core/Container.js";
import type { Edge } from "~/primitive/Edge.js";
import { Position } from "~/primitive/Position.js";
import { Insets } from "~/primitive/Insets.js";
import { VBox } from "~/layout/VBox.js";
import { HBox } from "~/layout/HBox.js";
import { Text } from "~/component/input/Text.js";
import { Button } from "~/component/button/Button.js";
import { callable } from "~/core/Callable.js";
import { DOM, type Rect, type Handle } from "~/core/DOM.js";

/** Fallback arrow side length used until the theme token is read. */
const DEFAULT_ARROW_SIZE_PX: number = 14;

/**
 * Half of the visual extent of the rotated arrow along either axis. The
 * arrow is a square of side `DEFAULT_ARROW_SIZE_PX` rotated 45°, so its
 * bounding rectangle is `DEFAULT_ARROW_SIZE_PX * sqrt(2)` on each side and
 * each corner sits half that far from the centre.
 */
const ARROW_VISUAL_HALF: number = (DEFAULT_ARROW_SIZE_PX / 2) * Math.SQRT2;

/** Pixel gap between the arrow tip and the anchor element. */
const ARROW_ANCHOR_GAP_PX: number = 2;

/**
 * Pixel gap between the popover edge and the anchor element. Sized so the
 * arrow tip lands {@link ARROW_ANCHOR_GAP_PX} away from the anchor.
 */
const POPOVER_ANCHOR_GAP: number = Math.ceil(ARROW_VISUAL_HALF) + ARROW_ANCHOR_GAP_PX;

/** Pixel inset preserved between the arrow and the popover corner. */
const ARROW_EDGE_INSET_PX: number = 6;

/** Pixel inset preserved between the arrow / popover and any viewport edge. */
const VIEWPORT_EDGE_INSET_PX: number = 5;

/** Fade duration matched to the rest of the floating-overlay family. */
const POPOVER_FADE_DURATION_MS: number = 120;

/**
 * Placement of a {@link Popover} relative to its anchor element. `"auto"`
 * picks the side with the most viewport space at `show()` time.
 *
 * @category Core
 */
export type PopoverPlacement = Edge | "auto";

/**
 * Strategy used to dismiss a {@link Popover}:
 *
 * - `"click-outside"`: closes on a `pointerdown` outside both the popover and
 *   its anchor element (the anchor is excluded so the trigger click can
 *   re-open without immediate re-close).
 * - `"blur"`: closes when focus or a pointer leaves the popover subtree —
 *   including a portaled descendant layer such as a dropdown opened inside
 *   the popover, which now keeps the popover open.
 * - `"manual"`: caller drives `hide()` explicitly.
 *
 * @remarks Dismissal is executed by {@link LayerManager}: the popover reports
 * this mode from its {@link DismissableLayer.getDismissMode} and the manager's
 * document-level handlers decide when to call `requestClose`. This is the
 * public option name; it maps 1:1 onto {@link LayerDismissMode}.
 *
 * @category Core
 */
export type PopoverDismissMode = "click-outside" | "blur" | "manual";

/**
 * Construction-time options for {@link Popover}.
 *
 * @category Core
 */
export interface PopoverOptions extends ContainerOptions {
    /** Resolved placement relative to the anchor. Default `"auto"`. */
    placement?: PopoverPlacement;
    /** Dismiss strategy. Default `"click-outside"`. */
    dismissOn?: PopoverDismissMode;
    /** When `false`, the arrow tail is not rendered. Default `true`. */
    showArrow?: boolean;
    /** Optional title row rendered above the body. */
    title?:     string;
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each present setter once
 * with the final value, so any field the caller supplied wins.
 */
const _defaultPopoverOptions: Partial<PopoverOptions> = {
    insets:    new Insets(5, 5, 5, 5),
    placement: "auto",
    dismissOn: "click-outside",
    showArrow: true,
};

/**
 * An anchored, non-modal floating bubble with a directional arrow tail. Use
 * `Popover` for click-triggered, interactive content (title, body, action
 * buttons, or any arbitrary subtree) — for ephemeral hover hints reach for
 * [`Tooltip`](/api/overlay/classes/Tooltip), and for modal containment reach
 * for [`Dialog`](/api/overlay/classes/Dialog).
 *
 * `Popover` extends {@link Container} so authors can compose freely via
 * `addComponent`; the `setTitle` / `setBody` / `addAction` conveniences are
 * sugar over the same container surface.
 *
 * Positioning is anchor-relative. `attachToComponent(Component)` records the
 * anchor. While the popover is open, `window` `resize` and each scrollable
 * ancestor's `scroll` event trigger a reposition so the bubble follows the
 * anchor.
 *
 * Fade-in / fade-out reuse the shared [`fadeShow`](/api/core/functions/fadeShow)
 * and [`fadeHideAndDetach`](/api/core/functions/fadeHideAndDetach) helpers,
 * inheriting the standard 120 ms `opacity + translateY` transition and the
 * re-entrancy guard against a fresh `show()` mid-fade.
 *
 * @example
 * ```typescript
 * const popover = new Popover({ placement: "auto" });
 * popover.setTitle("Confirm delete");
 * popover.setBody("This action cannot be undone.");
 * popover.addAction("Delete", () => doDelete());
 * popover.addAction("Cancel", () => popover.hide());
 *
 * Event.addListener(triggerButton, "click", () => {
 *     popover.attachToComponent(triggerButton);
 *     popover.show();
 * });
 * ```
 *
 * @category Core
 */
class Popover extends Container<PopoverOptions> implements DismissableLayer {

    // Option-backed fields use `declare` rather than initializers to dodge the
    // class-field super-cascade trap: an initializer runs *after* super()
    // returns, overwriting whatever the cascade-dispatched setter wrote
    // during the super-time `applyOptions` call. The applyOptions override
    // below always dispatches each setter with a fallback so the field is
    // seeded even when no caller option was supplied.
    declare private _placement:         PopoverPlacement;
    private _resolvedPlacement:         PopoverPlacement = "bottom";
    declare private _dismissOn:         PopoverDismissMode;
    declare private _showArrow:         boolean;
    declare private _title:             string | null;
    declare private _titleComponent:    Text | null;
    private _bodyComponent:             Component | null = null;
    private _actionsRow:        Component | null = null;
    private _anchorElement:     Handle | null = null;
    private _arrowComponent:    Component | null = null;
    private _isOpen:            boolean = false;
    private _scrollAncestors:   Handle[] = [];

    private readonly _onWindowResize:      () => void;
    private readonly _onScroll:            () => void;

    /**
     * Creates a popover with a 5px layout-side inset and the default chrome
     * wired to the theme tokens.
     *
     * @param options - Optional construction-time options.
     */
    constructor(options?: PopoverOptions) {
        super(options as PopoverOptions, _defaultPopoverOptions);

        const vbox = new VBox();

        vbox.setStretching(true);
        this.setLayoutManager(vbox);

        // Theme-driven chrome.
        this.setBackgroundColor("var(--ts-ui-popover-bg, rgb(255, 255, 255))");
        this.setForegroundColor("var(--ts-ui-popover-color, rgb(0, 0, 0))");
        this.setBorder({ border: "1px solid var(--ts-ui-popover-border, rgb(200, 200, 200))" });
        this.setBorderRadius("var(--ts-ui-popover-radius, 6px)");
        this.setShadow("var(--ts-ui-popover-shadow, 2px 4px 12px rgba(0, 0, 0, 0.18))");

        // Overlay placement: top-level, viewport-fixed. The z-index is
        // stamped from LayerManager's Popover band at show() time, so no
        // static value is set here.
        this.setPosition(Position.FIXED);
        this.setVisible(false);

        // `paint` containment would clip the arrow tail (which straddles the
        // popover edge), so use `layout` containment only. The framework
        // default `overflow: hidden` would also clip the arrow, so opt out.
        this.setContain("layout");
        this.setOverflow("visible");
        this.getAria().setRole("dialog");

        this._onWindowResize = () => this._reposition();
        this._onScroll       = () => this._reposition();

        // Seed the `declare`-d title fields after the cascade has had its
        // chance to write them via setTitle. Without a `title` option the
        // cascade dispatch above skips setTitle entirely, so the fields
        // would otherwise remain undefined (declare allocates no default).
        this._title          ??= null;
        this._titleComponent ??= null;
    }

    /**
     * Applies a {@link PopoverOptions} bag, dispatching popover-specific
     * fields after the inherited Container cascade.
     *
     * @param options - The options bag carrying the values to apply.
     * @returns This popover, for method chaining.
     */
    protected applyOptions(options: PopoverOptions): this {
        super.applyOptions(options);

        // placement/dismissOn/showArrow carry a class default and seed
        // construction-time state, so always dispatch the caller value or the
        // class default; title has no default.
        this.setPlacement(options.placement ?? this.getPlacement());
        this.setDismissOn(options.dismissOn ?? this.getDismissOn());
        this.setShowArrow(options.showArrow ?? this.isShowArrow());
        if (options.title !== undefined) this.setTitle(options.title);

        return this;
    }

    /**
     * Sets the requested placement relative to the anchor.
     *
     * @param p - One of `"top"`, `"bottom"`, `"left"`, `"right"`, or `"auto"`.
     * @returns This popover, for method chaining.
     */
    setPlacement(p: PopoverPlacement): this {
        this._placement = p;

        return this;
    }

    /**
     * Returns the configured placement.
     *
     * @returns The placement set via {@link setPlacement}, or `"auto"` by default.
     */
    getPlacement(): PopoverPlacement {
        return this._placement ?? this._defaultOptions.placement!;
    }

    /**
     * Sets the dismiss strategy.
     *
     * @param mode - One of `"click-outside"`, `"blur"`, or `"manual"`.
     * @returns This popover, for method chaining.
     */
    setDismissOn(mode: PopoverDismissMode): this {
        this._dismissOn = mode;

        return this;
    }

    /**
     * Returns the active dismiss strategy.
     *
     * @returns The dismiss strategy set via {@link setDismissOn}.
     */
    getDismissOn(): PopoverDismissMode {
        return this._dismissOn ?? this._defaultOptions.dismissOn!;
    }

    /**
     * Enables or disables the arrow tail.
     *
     * @param value - `true` to render the arrow, `false` to hide it.
     * @returns This popover, for method chaining.
     */
    setShowArrow(value: boolean): this {
        this._showArrow = value;

        if (this._arrowComponent) {
            this._arrowComponent.setVisible(value);
        }

        return this;
    }

    /**
     * Returns whether the arrow tail is currently enabled.
     *
     * @returns `true` if the arrow is rendered.
     */
    isShowArrow(): boolean {
        return this._showArrow ?? this._defaultOptions.showArrow!;
    }

    /**
     * Sets the title row text. Lazily creates the underlying
     * [`Text`](/api/component/input/classes/Text) child on first call. Passing
     * `null` clears the title.
     *
     * @param text - The title string, or `null` to clear.
     * @returns This popover, for method chaining.
     */
    setTitle(text: string | null): this {
        if (text === null) {
            return this.clearTitle();
        }

        this._title = text;

        if (!this._titleComponent) {
            this._titleComponent = new Text(text);
            this._titleComponent.setFontWeight("bold");

            this.insertComponent(this._titleComponent, 0);
        } else {
            this._titleComponent.setText(text);
        }

        return this;
    }

    /**
     * Returns the current title string, or `null` if no title is set.
     *
     * @returns The title set via {@link setTitle}, or `null`.
     */
    getTitle(): string | null {
        return this._title;
    }

    /**
     * Removes the title row.
     *
     * @returns This popover, for method chaining.
     */
    clearTitle(): this {
        if (this._titleComponent) {
            this.removeComponent(this._titleComponent);
            this._titleComponent = null;
        }

        this._title = null;

        return this;
    }

    /**
     * Sets the body content. A `string` is wrapped in a
     * [`Text`](/api/component/input/classes/Text) child; a `Component` is used
     * directly. Replaces any previous body.
     *
     * @param content - The body string or component.
     * @returns This popover, for method chaining.
     */
    setBody(content: Component | string): this {
        if (this._bodyComponent) {
            this.removeComponent(this._bodyComponent);
            this._bodyComponent = null;
        }

        const next: Component = typeof content === "string"
            ? new Text(content)
            : content;

        this._bodyComponent = next;

        // Insert after the title (if any) and before the actions row (if any).
        const titleOffset   = this._titleComponent ? 1 : 0;

        this.insertComponent(next, titleOffset);

        return this;
    }

    /**
     * Returns the current body component, or `null` when none has been set.
     *
     * @returns The body component, or `null`.
     */
    getBody(): Component | null {
        return this._bodyComponent;
    }

    /**
     * Appends an action button to the actions row. Lazily creates the row
     * (an [`HBox`](/api/layout/classes/HBox)-laid `Panel`) on first call.
     *
     * @param label - The button label.
     * @param onClick - Handler invoked when the button is activated.
     * @returns This popover, for method chaining.
     */
    addAction(label: string, onClick: () => void): this {
        if (!this._actionsRow) {
            this._actionsRow = new Component();
            this._actionsRow.setLayoutManager(new HBox());

            this.addComponent(this._actionsRow);
        }

        const button = new Button(label);

        button.on("action", onClick);

        this._actionsRow.addComponent(button);

        return this;
    }

    /**
     * Removes every action button previously registered via {@link addAction}.
     *
     * @returns This popover, for method chaining.
     */
    clearActions(): this {
        if (this._actionsRow) {
            this.removeComponent(this._actionsRow);
            this._actionsRow = null;
        }

        return this;
    }

    /**
     * Records the raw DOM element used as the positioning anchor.
     *
     * @param el - The anchor element.
     * @returns This popover, for method chaining.
     */
    private _attachToElement(el: Handle): this {
        this._anchorElement = el;

        return this;
    }

    /**
     * Records the anchor by resolving the given component's element. Must be
     * called before {@link Popover.show}.
     *
     * @param c - The component whose element should be used as the anchor.
     * @returns This popover, for method chaining.
     */
    attachToComponent(c: Component): this {
        return this._attachToElement(c.getElement(true)!);
    }

    /**
     * Mounts the popover on `document.documentElement` (if not already
     * mounted), resolves the final placement, positions the bubble + arrow,
     * fades it in, and wires the dismiss listeners.
     *
     * @returns This popover, for method chaining.
     */
    show(): this {
        if (!this._anchorElement) {
            console.warn("Popover.show(): no anchor attached; call attachToComponent first.");
            return this;
        }

        this._isOpen = true;

        // Join the central layer tree and mirror its band-based z-stamp so a
        // popover opened from inside a window or dropdown stacks correctly.
        LayerManager.register(this);
        this.setZIndex(LayerManager.getZIndex(this));

        const el = this.getElement(true)!;

        LayerManager.mount(el);

        // Trap wheels no inner scroller claimed so they cannot fall through to
        // scrollable content behind the popover.
        trapWheel(this);

        this.ensureArrow();
        this.setVisible(true);

        // First measurement pass: compute preferred size so we can resolve
        // placement against the real bubble dimensions.
        this.doLayout();
        this._reposition();

        fadeShow(this, { durationMs: POPOVER_FADE_DURATION_MS });

        this.attachRepositionListeners();

        return this;
    }

    /**
     * Plays the exit fade, detaches the popover from the DOM, and removes
     * every dismiss / reposition listener.
     *
     * @returns This popover, for method chaining.
     */
    hide(): this {
        if (!this._isOpen) {
            return this;
        }

        this._isOpen = false;

        this.detachRepositionListeners();

        LayerManager.unregister(this);
        untrapWheel(this);

        fadeHideAndDetach(this, { durationMs: POPOVER_FADE_DURATION_MS });

        return this;
    }

    /**
     * Returns whether the popover is currently open (showing or fading in).
     *
     * @returns `true` when the popover is open.
     */
    isOpen(): boolean {
        return this._isOpen;
    }

    // ----- DismissableLayer -----

    /**
     * Returns the popover's root element for the central layer tree.
     *
     * @returns The popover's element, or null when not yet rendered.
     */
    getLayerElement(): Handle | null {
        return this.getElement() ?? null;
    }

    /**
     * Returns the dismiss mode the document-level handlers consult, mapping
     * the public {@link PopoverDismissMode} directly onto the manager's
     * vocabulary (the two share the `"click-outside"` / `"blur"` / `"manual"`
     * names). The manager now executes dismissal; the `"blur"` mode works for
     * a nested dropdown because the dropdown registers as the popover's child.
     *
     * @returns The layer dismiss mode.
     */
    getDismissMode(): LayerDismissMode {
        return this._dismissOn ?? this._defaultOptions.dismissOn!;
    }

    /**
     * Advisory close request from the manager — runs the standard
     * {@link Popover.hide} teardown, which unregisters the layer.
     */
    requestClose(): void {
        this.hide();
    }

    /**
     * Returns the anchor element excluded from outside-interaction tests so a
     * click on the trigger does not immediately re-close the popover.
     *
     * @returns The anchor element, or null when none is attached.
     */
    getAnchorElement(): Handle | null {
        return this._anchorElement;
    }

    /**
     * Returns the popover's z-index band so an unrelated top-level popover
     * stacks above windows but below dropdowns and dialogs.
     *
     * @returns The popover band base.
     */
    getBand(): number {
        return LayerManager.Band.Popover;
    }

    /**
     * Lays out children (delegating to the VBox) and positions the arrow
     * tail along the resolved edge.
     *
     * @returns This popover, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        if (this._arrowComponent && this._showArrow && this._anchorElement) {
            this.positionArrow();
        }

        return this;
    }

    /**
     * Releases per-instance resources. Closes the popover if it is still
     * open, then defers to the base class for the rest of teardown.
     */
    dispose(): void {
        if (this._isOpen) {
            this.hide();
        }

        this._anchorElement   = null;
        this._titleComponent  = null;
        this._bodyComponent   = null;
        this._actionsRow      = null;
        this._arrowComponent  = null;

        super.dispose();
    }

    /**
     * Resolves the requested placement against the viewport, anchor rect, and
     * own preferred size; updates the popover's `setX` / `setY` and the
     * resolved-placement field.
     */
    private _reposition(): void {
        if (!this._anchorElement) {
            return;
        }

        const anchorRect = DOM.source.getElementRect(this._anchorElement);

        // Anchor removed from the DOM or rendered with zero size — close.
        if (anchorRect.width === 0 && anchorRect.height === 0) {
            this.hide();
            return;
        }

        const preferred = this.getPreferredSize();
        const width     = preferred?.width  ?? this.getWidth();
        const height    = preferred?.height ?? this.getHeight();
        const vp        = DOM.source.getViewportSize();

        const resolved = this.resolvePlacement(anchorRect, width, height, vp);

        this._resolvedPlacement = resolved;

        let x: number = 0;
        let y: number = 0;

        if (resolved === "top") {
            x = anchorRect.left + (anchorRect.width  - width)  / 2;
            y = anchorRect.top  - height - POPOVER_ANCHOR_GAP;
        } else if (resolved === "bottom") {
            x = anchorRect.left + (anchorRect.width  - width)  / 2;
            y = anchorRect.bottom + POPOVER_ANCHOR_GAP;
        } else if (resolved === "left") {
            x = anchorRect.left - width - POPOVER_ANCHOR_GAP;
            y = anchorRect.top  + (anchorRect.height - height) / 2;
        } else { // "right"
            x = anchorRect.right + POPOVER_ANCHOR_GAP;
            y = anchorRect.top   + (anchorRect.height - height) / 2;
        }

        // Clamp into viewport so the bubble stays on-screen. The arrow's
        // independent positioning keeps it pointing at the anchor centre
        // even when the bubble is shifted laterally. On the tip-direction
        // side, leave room for the arrow's outward visual extent so the tip
        // also stays at least VIEWPORT_EDGE_INSET_PX inside the viewport.
        let minX = VIEWPORT_EDGE_INSET_PX;
        let maxX = vp.width - width - VIEWPORT_EDGE_INSET_PX;
        let minY = VIEWPORT_EDGE_INSET_PX;
        let maxY = vp.height - height - VIEWPORT_EDGE_INSET_PX;

        if (resolved === "right") {
            minX += ARROW_VISUAL_HALF;
        } else if (resolved === "left") {
            maxX -= ARROW_VISUAL_HALF;
        } else if (resolved === "bottom") {
            minY += ARROW_VISUAL_HALF;
        } else {
            maxY -= ARROW_VISUAL_HALF;
        }

        x = Util.clamp(x, minX, maxX);
        y = Util.clamp(y, minY, maxY);

        this.setX(x);
        this.setY(y);
        this.setWidth(width);
        this.setHeight(height);

        if (this._arrowComponent && this._showArrow) {
            this.positionArrow();
        }
    }

    /**
     * Picks the placement to use given the configured value and the available
     * viewport space. `"auto"` selects the side with the most room; an
     * explicit side is honoured unless it would overflow, in which case the
     * opposite side is used and a console warning is logged.
     *
     * @param anchor - The anchor's `DOMRect`.
     * @param width - The popover's preferred width in pixels.
     * @param height - The popover's preferred height in pixels.
     * @param vp - The viewport size returned by `DOM.source.getViewportSize`.
     * @returns The resolved placement.
     */
    private resolvePlacement(
        anchor: Rect,
        width: number,
        height: number,
        vp: { width: number; height: number },
    ): PopoverPlacement {
        const spaceTop    = anchor.top;
        const spaceBottom = vp.height - anchor.bottom;
        const spaceLeft   = anchor.left;
        const spaceRight  = vp.width  - anchor.right;

        if (this._placement === "auto") {
            const needsH = height + POPOVER_ANCHOR_GAP;
            const needsV = width  + POPOVER_ANCHOR_GAP;

            const candidates: Array<{ side: PopoverPlacement; space: number; need: number }> = [
                { side: "bottom", space: spaceBottom, need: needsH },
                { side: "top",    space: spaceTop,    need: needsH },
                { side: "right",  space: spaceRight,  need: needsV },
                { side: "left",   space: spaceLeft,   need: needsV },
            ];

            // Prefer a side that physically fits; otherwise pick the one
            // with the most absolute space.
            const fitting = candidates.filter(c => c.space >= c.need);
            const pool    = fitting.length > 0 ? fitting : candidates;

            pool.sort((a, b) => b.space - a.space);

            return pool[0].side;
        }

        // Explicit placement — honour unless the requested side cannot fit.
        const fits = (side: PopoverPlacement): boolean => {
            if (side === "top")    { return spaceTop    >= height + POPOVER_ANCHOR_GAP; }
            if (side === "bottom") { return spaceBottom >= height + POPOVER_ANCHOR_GAP; }
            if (side === "left")   { return spaceLeft   >= width  + POPOVER_ANCHOR_GAP; }

            return spaceRight >= width + POPOVER_ANCHOR_GAP;
        };

        if (fits(this._placement)) {
            return this._placement;
        }

        const opposite: Record<Exclude<PopoverPlacement, "auto">, Exclude<PopoverPlacement, "auto">> = {
            top:    "bottom",
            bottom: "top",
            left:   "right",
            right:  "left",
        };

        const flipped = opposite[this._placement as Exclude<PopoverPlacement, "auto">];

        console.warn(`Popover: explicit placement "${this._placement}" overflows the viewport; falling back to "${flipped}".`);

        return flipped;
    }

    /**
     * Lazily creates the arrow tail component on first show.
     *
     * @remarks The arrow's element is inserted as the *first* DOM child of
     * the popover (not via `addComponent`) so the VBox layout manager does
     * not size it AND so it paints beneath subsequent sibling content. The
     * outward half of the diamond is still visible because it lies outside
     * the popover's bounds; the inward half is overlaid by the bubble's
     * children, preventing the arrow from obscuring the title/body text.
     */
    private ensureArrow(): void {
        if (this._arrowComponent) {
            return;
        }

        const arrow = new Component();
        const size  = DEFAULT_ARROW_SIZE_PX;

        arrow.setBackgroundColor("var(--ts-ui-popover-bg, rgb(255, 255, 255))");
        arrow.setWidth(size);
        arrow.setHeight(size);
        arrow.setTransform("rotate(45deg)");
        arrow.setPointerEvents("none");
        arrow.setVisible(this._showArrow);

        this._arrowComponent = arrow;

        const popoverEl = this.getElement(true)!;
        DOM.sink.insertBefore(popoverEl, arrow.getElement(true)!, DOM.source.getFirstChild(popoverEl));
    }

    /**
     * Positions the arrow tail along the resolved popover edge so it points
     * at the anchor centre, clamped to keep it within the popover's lateral
     * extent. Also re-applies the directional inset box-shadow that draws the
     * two outward-facing edges of the rotated diamond so the popover outline
     * appears continuous through the arrow.
     */
    private positionArrow(): void {
        if (!this._anchorElement || !this._arrowComponent) {
            return;
        }

        const anchorRect = DOM.source.getElementRect(this._anchorElement);
        const size       = DEFAULT_ARROW_SIZE_PX;
        const half       = size / 2;
        const popoverX   = this.getX();
        const popoverY   = this.getY();
        const popoverW   = this.getWidth();
        const popoverH   = this.getHeight();

        // High-first clamp (not Util.clamp): when the popover is larger than the
        // viewport, maxLocal < minLocal, and the arrow must pin to the leading
        // inset (minLocal), which the low-first Util.clamp would not do.
        const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

        // Inset box-shadow draws a 1px line on the two outward-facing edges
        // of the rotated diamond. The mapping below is given in
        // pre-rotation coordinates (the element's own CSS axes); after the
        // 45° clockwise rotation, original TOP/RIGHT/BOTTOM/LEFT edges map to
        // the rotated NE/SE/SW/NW edges.
        const borderColor = "var(--ts-ui-popover-border, rgb(200, 200, 200))";
        let arrowShadow: string;

        if (this._resolvedPlacement === "bottom") {
            arrowShadow = `inset 1px 0 0 ${borderColor}, inset 0 1px 0 ${borderColor}`;
        } else if (this._resolvedPlacement === "top") {
            arrowShadow = `inset -1px 0 0 ${borderColor}, inset 0 -1px 0 ${borderColor}`;
        } else if (this._resolvedPlacement === "right") {
            arrowShadow = `inset 1px 0 0 ${borderColor}, inset 0 -1px 0 ${borderColor}`;
        } else {
            arrowShadow = `inset 0 1px 0 ${borderColor}, inset -1px 0 0 ${borderColor}`;
        }

        this._arrowComponent.setShadow(arrowShadow);

        const vp     = DOM.source.getViewportSize();
        const border = this.getBorderSize();

        // `position: absolute` measures from the popover's padding box (i.e.
        // inside the border). Subtracting the border width centres the
        // rotated diamond on the popover's *outer* edge, keeping the tip-to-
        // anchor gap predictable regardless of border thickness.
        if (this._resolvedPlacement === "top" || this._resolvedPlacement === "bottom") {
            const anchorCentreX = anchorRect.left + anchorRect.width / 2;
            const minLocalX     = Math.max(
                ARROW_EDGE_INSET_PX,
                VIEWPORT_EDGE_INSET_PX - popoverX + ARROW_VISUAL_HALF - half,
            );
            const maxLocalX     = Math.min(
                popoverW - size - ARROW_EDGE_INSET_PX,
                vp.width - VIEWPORT_EDGE_INSET_PX - popoverX - half - ARROW_VISUAL_HALF,
            );
            const localX        = clamp(anchorCentreX - popoverX - half - border.left, minLocalX, maxLocalX);

            this._arrowComponent.setX(localX);

            // Pull the arrow half its own size outside the body so the
            // rotated diamond reads as a triangle straddling the edge.
            if (this._resolvedPlacement === "bottom") {
                this._arrowComponent.setY(-half - border.top);
            } else {
                this._arrowComponent.setY(popoverH - half - border.top);
            }
        } else {
            const anchorCentreY = anchorRect.top + anchorRect.height / 2;
            const minLocalY     = Math.max(
                ARROW_EDGE_INSET_PX,
                VIEWPORT_EDGE_INSET_PX - popoverY + ARROW_VISUAL_HALF - half,
            );
            const maxLocalY     = Math.min(
                popoverH - size - ARROW_EDGE_INSET_PX,
                vp.height - VIEWPORT_EDGE_INSET_PX - popoverY - half - ARROW_VISUAL_HALF,
            );
            const localY        = clamp(anchorCentreY - popoverY - half - border.top, minLocalY, maxLocalY);

            this._arrowComponent.setY(localY);

            if (this._resolvedPlacement === "right") {
                this._arrowComponent.setX(-half - border.left);
            } else {
                this._arrowComponent.setX(popoverW - half - border.left);
            }
        }
    }

    /**
     * Registers `window` resize and `scroll` listeners on every scrollable
     * ancestor of the anchor so the popover follows the anchor while open.
     */
    private attachRepositionListeners(): void {
        Event.addViewportListener(this, "resize", this._onWindowResize);

        if (this._anchorElement) {
            this._scrollAncestors = this.collectScrollAncestors(this._anchorElement);

            for (const ancestor of this._scrollAncestors) {
                DOM.sink.addListener(ancestor, "scroll", this._onScroll, { passive: true });
            }
        }
    }

    /**
     * Detaches every reposition listener registered by {@link attachRepositionListeners}.
     */
    private detachRepositionListeners(): void {
        Event.removeViewportListener(this, "resize", this._onWindowResize);

        for (const ancestor of this._scrollAncestors) {
            DOM.sink.removeListener(ancestor, "scroll", this._onScroll);
        }

        this._scrollAncestors = [];
    }

    /**
     * Walks the anchor's ancestor chain up to `document.documentElement` and
     * collects every element whose computed `overflow` makes it scrollable.
     *
     * @param node - The starting element.
     * @returns The list of scrollable ancestors plus `document.documentElement`.
     */
    private collectScrollAncestors(node: Handle): Handle[] {
        const out: Handle[] = [];
        let cursor: Handle | null = DOM.source.getParentElement(node);

        while (cursor && cursor !== DOM.source.getDocumentElement()) {
            const style = DOM.source.getComputedOverflow(cursor);
            const overflow = style.overflow + style.overflowX + style.overflowY;

            if (/(auto|scroll|overlay)/.test(overflow)) {
                out.push(cursor);
            }

            cursor = DOM.source.getParentElement(cursor);
        }

        out.push(DOM.source.getDocumentElement());

        return out;
    }
}

const PopoverCallable = callable(Popover);
type PopoverCallable = Popover;
export {
    Popover         as _Popover,
    PopoverCallable as Popover
};
