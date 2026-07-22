// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { Animation } from "~/core/Animation.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Position } from "~/primitive/Position.js";
import { Placement } from "~/primitive/Placement.js";
import { isUnbounded } from "~/primitive/Size.js";
import { HBox } from "~/layout/HBox.js";
import { VBox } from "~/layout/VBox.js";
import { RailHandle } from "~/overlay/RailHandle.js";
import { CollapseButton, CollapseDirection } from "~/component/container/CollapseButton.js";
import { callable } from "~/core/Callable.js";
import type { Drawer, DrawerEdge } from "~/overlay/Drawer.js";
import type { AbstractWindow } from "~/overlay/AbstractWindow.js";
import type { ClickListener } from "~/component/button/Button.js";

/**
 * Viewport edge a {@link Rail} anchors to. Structurally identical to
 * [`DrawerEdge`](/api/overlay/type-aliases/DrawerEdge) — the framework's compass
 * primitive [`Placement`](/api/primitive/enumerations/Placement) minus `CENTER`,
 * which is meaningless for an edge-anchored strip.
 *
 * @category Core
 */
export type RailEdge = Exclude<Placement, Placement.CENTER>;

/**
 * Text orientation for handle labels on the vertical sides (WEST/EAST). Ignored
 * for NORTH/SOUTH, where handle text is always horizontal. Mirrors the
 * [`Tab`](/api/layout/classes/Tab) layout's orientation vocabulary.
 *
 * - `"horizontal"` — handles stack vertically but text stays upright.
 * - `"vertical-cw"` — text rotated 90° clockwise, reading top-to-bottom
 *   (`writing-mode: sideways-rl`).
 * - `"vertical-ccw"` — text rotated the other way, reading bottom-to-top
 *   (`writing-mode: sideways-lr`).
 *
 * @remarks Implemented with CSS `writing-mode` rather than `transform: rotate`
 * so the browser reports the rotated box through `getBoundingClientRect`,
 * keeping the handle's preferred-size measurement correct.
 *
 * @category Core
 */
export type RailOrientation = "horizontal" | "vertical-cw" | "vertical-ccw";

/**
 * Events emitted by a {@link Rail}. `"register"` fires when a drawer or window
 * is added to the rail; `"unregister"` when it is removed.
 *
 * @category Core
 */
export type RailEvent = "register" | "unregister";

/**
 * Per-drawer registration options for {@link Rail.registerDrawer}.
 *
 * @category Core
 */
export interface RailDrawerRegistration {
    /** Handle glyph (forwarded to the handle's leading icon). */
    glyph?: string;

    /** Handle label text. */
    text?: string;

    /**
     * When true (default), the rail sets the drawer's edge to its own edge so
     * the drawer slides out from the rail. Pass false to leave the drawer's
     * edge untouched.
     *
     * @defaultValue true
     */
    alignEdge?: boolean;
}

/**
 * Construction-time options for {@link Rail}.
 *
 * @category Core
 */
export interface RailOptions extends ComponentOptions {
    /**
     * Viewport edge the rail anchors to.
     *
     * @defaultValue Placement.WEST
     */
    edge?: RailEdge;

    /**
     * Explicit rail thickness in pixels — width for WEST/EAST edges, height for
     * NORTH/SOUTH edges (the main axis always spans the full viewport). Omit to
     * size the rail to its handles: the cross-axis fits the widest (or, on a
     * horizontal rail, tallest) handle, re-derived as handles are added/removed
     * and when the orientation changes.
     *
     * @defaultValue content-derived
     */
    thickness?: number;

    /**
     * Handle-label text orientation on the vertical (WEST/EAST) sides. Ignored
     * for NORTH/SOUTH.
     *
     * @defaultValue "horizontal"
     */
    orientation?: RailOrientation;

    /**
     * Whether the rail starts collapsed — minimized to a thin gutter strip along
     * the edge (handles hidden) that a click on its chevron expands.
     *
     * @defaultValue false
     */
    collapsed?: boolean;

    /** Construction-time event listeners dispatched to {@link Rail.on}. */
    listeners?: {
        register?:   (target: Drawer | AbstractWindow) => void;
        unregister?: (target: Drawer | AbstractWindow) => void;
    };
}

/**
 * Fallback rail thickness (px) along the cross axis, used only when no explicit
 * `thickness` is set and the content cannot be measured yet (e.g. an empty rail
 * with no handles). Once handles exist the rail sizes to them. A component-level
 * constant rather than a theme token because it is a layout-affecting
 * measurement, not a colour — matching how `Drawer` keeps its
 * `DEFAULT_DRAWER_SIZE_PX` out of `Theme.ts`. 48 px is the conventional icon-rail
 * width (a comfortable square touch target for a single glyph handle).
 */
const DEFAULT_RAIL_THICKNESS_PX: number = 48;

/**
 * Fixed z-index for the rail, a plain module constant just below the window
 * band (`Z_BAND_WINDOW = 9000` in `LayerManager`) — mirroring how the layer
 * manager's bands are plain constants because z-index is unthemed. The rail is
 * a persistent strip that windows, popovers, and dialogs still stack above, and
 * it is deliberately not a `DismissableLayer`, so it carries this stamp itself
 * rather than drawing a band from the layer manager.
 */
const RAIL_Z_INDEX: number = 8900;

/**
 * Slide duration (ms) for the rail's mount / unmount animation. Matches
 * Drawer's slide feel — long enough to read as motion, short enough not to
 * delay the launcher. Honoured under `prefers-reduced-motion` by
 * {@link Animation.play}, which then snaps to the end state.
 */
const RAIL_ANIM_DURATION_MS: number = 200;

/**
 * Cross-axis thickness (px) of the collapsed rail — the thin strip the rail
 * minimizes into, skinned like a `Split` / `Border` collapsed gutter; a click on
 * the chevron expands the rail again.
 */
const RAIL_COLLAPSED_THICKNESS_PX: number = 10;

/**
 * Half the collapse chevron's grip width (`CollapseButton`'s 10px grip), used to
 * inset the chevron's centre from the rail's inner edge so the whole grip sits
 * just inside the strip. The chevron is centred on its anchor by the
 * `CollapseButton` transform, so anchoring its centre half a grip-width in from
 * the edge leaves it flush inside — never overhanging the `overflow: hidden`
 * rail (which would clip it and let clicks fall through to whatever is behind).
 */
const RAIL_CHEVRON_HALF_PX: number = 5;

/**
 * Maps a rail edge to the chevron's collapse heading — the direction the rail
 * travels (and the chevron points) when collapsing: toward the outer screen
 * edge it anchors to. The restore heading is the opposite, handled by the
 * chevron itself.
 *
 * @param edge - The rail's edge.
 *
 * @returns The collapse-heading {@link CollapseDirection}.
 */
function collapseHeadingFor(edge: RailEdge): CollapseDirection {
    switch (edge) {
        case Placement.EAST:  return "east";
        case Placement.NORTH: return "north";
        case Placement.SOUTH: return "south";
        case Placement.WEST:
        default:              return "west";
    }
}

/** The chevron's restore heading is the opposite of its collapse heading. */
const OPPOSITE_HEADING: Record<CollapseDirection, CollapseDirection> = {
    west:  "east",
    east:  "west",
    north: "south",
    south: "north",
};

/**
 * Subclass defaults layered into `Component._defaultOptions`. The two
 * behavioural fields seed the options bag so {@link Rail.getEdge} /
 * {@link Rail.getThickness} return a defined value before a setter writes one;
 * the surface tokens skin the strip.
 */
const _defaultRailOptions: Partial<RailOptions> = {
    edge:            Placement.WEST,
    orientation:     "horizontal",
    backgroundColor: "var(--ts-ui-rail-bg)",
    shadow:          "var(--ts-ui-rail-shadow)",
};

/** Per-drawer bookkeeping: the handle and the exact listener references to remove. */
interface DrawerRegistration {
    handle:   RailHandle;
    onOpen:   () => void;
    onClose:  () => void;
    onAction: ClickListener;
}

/** Per-window bookkeeping: the handle (null until minimized) and listener references. */
interface WindowRegistration {
    handle:     RailHandle | null;
    onMinimize: () => void;
    onRestore:  () => void;
    onClose:    () => void;
    onAction:   ClickListener;
}

/**
 * An edge-anchored launcher strip that floats over the app content along one
 * viewport edge, holding a column (WEST/EAST) or row (NORTH/SOUTH) of handle
 * buttons. Unlike a [`Drawer`](/api/overlay/classes/Drawer) it never slides
 * off-screen and is never auto-dismissed — it is the persistent counterpart to
 * the drawer.
 *
 * A rail hosts caller-created drawers (`registerDrawer`): each gets a handle
 * that toggles it, and the handle reflects the drawer's open/closed state by
 * subscribing through the drawer's public typed `on`. A window can also be told
 * to minimize *into* the rail (`AbstractWindow.setRail`): while minimized it is
 * represented by a rail handle that restores it on click.
 *
 * The rail mounts on `document.documentElement` as a `Position.FIXED` overlay
 * (the documented fixed carve-out) and carries a fixed z-index just below the
 * window band; it is deliberately *not* a layer-tree member.
 *
 * @example
 * ```typescript
 * import { Rail, Drawer } from '@jimka/typescript-ui/overlay';
 * import { Placement } from '@jimka/typescript-ui/primitive';
 *
 * const rail = Rail({ edge: Placement.WEST }).mount();
 * rail.registerDrawer(Drawer(), { glyph: 'filter', text: 'Filters' });
 * ```
 *
 * @category Core
 */
class Rail extends Component<RailOptions> {

    // In-flight animations, cancelled on teardown so their fallback timers
    // cannot fire against this rail's released element handle.
    private _collapseAnimation: Animation.CancelHandle | null = null;
    private _slideOutAnimation: Animation.CancelHandle | null = null;
    private _slideInAnimation:  Animation.CancelHandle | null = null;

    /** Typed-event fan-out for `"register"` / `"unregister"`. */
    private _listeners: ListenerBag<RailEvent> = new ListenerBag<RailEvent>();

    /** Registered drawers, keyed by drawer, holding the handle + listener refs. */
    private _drawers: Map<Drawer, DrawerRegistration> = new Map();

    /** Registered windows, keyed by window, holding the handle + listener refs. */
    private _windows: Map<AbstractWindow, WindowRegistration> = new Map();

    /** Whether the rail is currently mounted (attached to the document). */
    private _mounted: boolean = false;

    /** The collapse/restore chevron pinned to the rail's inner edge. */
    private _collapseButton: CollapseButton;

    /**
     * The content-fit thickness captured at collapse time. Hidden handles are
     * excluded from the preferred-size measurement, so the expand animation
     * tweens back to this remembered extent rather than a mis-measured one.
     */
    private _expandedThickness: number = DEFAULT_RAIL_THICKNESS_PX;

    /** Stable viewport-resize handler reference, for add/remove symmetry. */
    private _boundResizeHandler: () => void = (): void => this.applyRestingGeometry();

    /**
     * Constructs a rail but does not display it. Call `mount()` to show.
     *
     * @param options - Construction-time options.
     * @param subclassDefaults - Defaults layered under `options` by a subclass.
     */
    constructor(options?: RailOptions, subclassDefaults?: Partial<RailOptions>) {
        super(options, { ..._defaultRailOptions, ...(subclassDefaults ?? {}) });

        // Floating overlay anchored to the viewport — the documented FIXED
        // carve-out, applied after super() like Drawer and the other portaled
        // surfaces. The rail is not a DismissableLayer, so it stamps its own
        // fixed z-index rather than drawing one from the layer manager.
        this.setPosition(Position.FIXED);
        this.setZIndex(RAIL_Z_INDEX);

        // The collapse chevron sits at the rail's inner edge: double-clicking it
        // (matching the Split / Border gutter chevrons) collapses the rail to a
        // gutter, or restores it. Its heading points the way the rail travels on
        // collapse — toward the outer screen edge.
        this._collapseButton = new CollapseButton({
            direction: collapseHeadingFor(this.getEdge()),
            listeners: { collapse: (): void => { this.toggleCollapsed(); } },
        });

        // Listener dispatch lives in the constructor body, not applyOptions:
        // the ListenerBag field is undefined during the super() cascade.
        if (options?.listeners !== undefined) {
            this.applyListeners(options.listeners);
        }
    }

    /**
     * Applies a {@link RailOptions} bag, dispatching the rail-specific fields
     * after inherited Component fields. `listeners` is handled in the
     * constructor instead — it cannot run during the super() cascade.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This rail, for method chaining.
     */
    protected applyOptions(options: RailOptions): this {
        super.applyOptions(options);

        // edge and orientation carry a class default and seed construction-time
        // state, so always dispatch the caller value or the class default.
        this.setEdge(options.edge ?? this.getEdge());
        this.setOrientation(options.orientation ?? this.getOrientation());

        if (options.thickness !== undefined) {
            this.setThickness(options.thickness);
        }

        if (options.collapsed !== undefined) {
            // Cache only during the cascade — the visual transition needs the
            // element + chevron + handles, which mount() applies once they exist.
            this._options.collapsed = options.collapsed;
        }

        return this;
    }

    // ----- typed setters (cache only; geometry/layout applied in mount()) -----

    /**
     * Sets the viewport edge the rail anchors to. Cached only — the resting
     * geometry, divider border, and handle-axis layout manager are derived in
     * `mount()`, where the element provably exists.
     *
     * @param edge - The edge to anchor against.
     *
     * @returns This rail, for method chaining.
     */
    setEdge(edge: RailEdge): this {
        this._options.edge = edge;

        return this;
    }

    /**
     * Returns the edge the rail anchors to.
     *
     * @returns The current edge.
     */
    getEdge(): RailEdge {
        return this._options.edge ?? this._defaultOptions.edge!;
    }

    /**
     * Pins the rail's cross-axis thickness (width for WEST/EAST, height for
     * NORTH/SOUTH) to an explicit pixel value, overriding the content-fit
     * default. Re-applies the resting geometry when mounted.
     *
     * @param px - The thickness in pixels.
     *
     * @returns This rail, for method chaining.
     */
    setThickness(px: number): this {
        this._options.thickness = px;
        this.adaptThickness();

        return this;
    }

    /**
     * Returns the rail's effective cross-axis thickness in pixels — the explicit
     * `thickness` when one was set, otherwise the content-fit measurement.
     *
     * @returns The current thickness.
     */
    getThickness(): number {
        if (this.isCollapsed()) {
            return RAIL_COLLAPSED_THICKNESS_PX;
        }

        if (this._options.thickness !== undefined) {
            return this._options.thickness;
        }

        return this.measureContentThickness();
    }

    /**
     * Measures the cross-axis extent the rail's handles need — the widest handle
     * for a vertical (WEST/EAST) rail, the tallest for a horizontal one — from
     * the layout manager's preferred size. Falls back to
     * {@link DEFAULT_RAIL_THICKNESS_PX} before the rail has a layout manager or
     * any handles (when the preferred cross-axis is unbounded or zero).
     *
     * @returns The content-fit thickness in pixels.
     */
    private measureContentThickness(): number {
        const preferred = this.getPreferredSize();
        if (!preferred) {
            return DEFAULT_RAIL_THICKNESS_PX;
        }

        const cross = this.isVertical() ? preferred.width : preferred.height;
        if (cross <= 0 || isUnbounded(cross)) {
            return DEFAULT_RAIL_THICKNESS_PX;
        }

        return Math.ceil(cross);
    }

    /**
     * Re-derives the content-fit thickness by re-applying the resting geometry.
     * No-op until mounted (mount applies the geometry itself); called whenever
     * the handle set or orientation changes so the rail tracks its content.
     */
    private adaptThickness(): void {
        if (this._mounted) {
            this.applyRestingGeometry();
        }
    }

    // ----- collapse / expand -----

    /**
     * Returns whether the rail is collapsed to its gutter strip.
     *
     * @returns True when collapsed.
     */
    isCollapsed(): boolean {
        return this._options.collapsed ?? false;
    }

    /**
     * Collapses the rail to a thin gutter strip (handles hidden) or restores it
     * to full size, animating the cross-axis between the two when mounted. No-op
     * if already in the requested state.
     *
     * @param value - True to collapse, false to expand.
     *
     * @returns This rail, for method chaining.
     */
    setCollapsed(value: boolean): this {
        if (value === this.isCollapsed()) {
            return this;
        }

        if (value) {
            // Capture the expanded extent first: hidden handles drop out of the
            // preferred-size measurement, so the expand tween reads this back
            // rather than re-measuring an empty rail.
            this._expandedThickness = this.getThickness();
        }

        this._options.collapsed = value;

        if (this._mounted) {
            this.animateCollapseTransition(value);
        }

        return this;
    }

    /**
     * Toggles the collapsed state.
     *
     * @returns This rail, for method chaining.
     */
    toggleCollapsed(): this {
        return this.setCollapsed(!this.isCollapsed());
    }

    /**
     * Flips the chevron heading, applies the collapsed/expanded skin, positions
     * the chevron, and (immediately, no animation) shows or hides the handles
     * for the current collapsed state. Used by `mount` to seed a rail
     * constructed `collapsed`.
     */
    private applyCollapseAppearance(): void {
        const collapsed = this.isCollapsed();
        const heading   = collapseHeadingFor(this.getEdge());

        this._collapseButton.setDirection(collapsed ? OPPOSITE_HEADING[heading] : heading);
        this.applyCollapseStyling(collapsed);
        this.positionChevron(collapsed);
        this.setAllHandlesDisplayed(!collapsed);
    }

    /**
     * Skins the strip for the collapsed or expanded state, mirroring how a
     * [`Split`](/api/layout/classes/Split) / [`Border`](/api/layout/classes/Border)
     * gutter paints its collapsed strip (`SplitGutter.setOpaque`): collapsed, the
     * rail reads as a themed button surface (the same fill, gradient, and border
     * the framework's buttons use) that invites a click to restore; expanded, it
     * returns to the rail background and its single inner-edge divider.
     *
     * @param collapsed - True for the collapsed strip skin, false for the
     *   expanded rail skin.
     */
    private applyCollapseStyling(collapsed: boolean): void {
        if (collapsed) {
            this.setBackgroundColor("var(--ts-ui-button-bg, #e8e8e8)");
            this.setBackgroundImage("var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))");
            this.setBorder("1px solid var(--ts-ui-button-border, #c8c8c8)");
        } else {
            this.clearBackgroundImage();
            this.setBackgroundColor("var(--ts-ui-rail-bg)");
            this.applyEdgeBorder();
        }
    }

    /**
     * Places and sizes the collapse chevron for the current state, writing
     * `left` / `top` / `width` onto the chevron's own `#id` style rule (shared by
     * selector with the rule {@link CollapseButton} uses for its rotation, so the
     * two coexist) and overriding the shared `.CollapseButton` class rule.
     *
     * - **Collapsed:** centred in the strip and sized to fill its full thickness,
     *   so the restore handle reads as the Split collapsed-gutter handle.
     * - **Expanded:** pinned just inside the rail's inner (content-facing) edge —
     *   the side opposite the viewport edge it anchors to (right for WEST, left
     *   for EAST, bottom for NORTH, top for SOUTH) — at the narrow grip width,
     *   its centre inset by {@link RAIL_CHEVRON_HALF_PX} so the whole grip sits
     *   flush inside the strip rather than overhanging it.
     *
     * In both states the chevron is raised above the handles (`z-index`) so a
     * click always lands on it, never on a handle laid out beneath it; and it is
     * kept fully inside the `overflow: hidden` rail so a click never falls through
     * to whatever sits behind an overhang. Percentages (not pixels) for the
     * placement so the chevron tracks the rail's size and position through the
     * collapse tween and viewport resizes. `width` maps to the across-gutter axis
     * for every edge because {@link CollapseButton}'s rotation orients its box.
     *
     * @param collapsed - True for the collapsed (centred, strip-filling) chevron,
     *   false for the expanded (inner-edge, grip) chevron.
     */
    private positionChevron(collapsed: boolean): void {
        let left: string;
        let top:  string;

        if (collapsed) {
            // Centred in the strip — the CollapseButton class-rule default.
            left = "50%";
            top  = "50%";
        } else {
            // Flush just inside the inner edge: anchor the chevron's centre half
            // a grip-width in from the edge (see RAIL_CHEVRON_HALF_PX).
            const inset = `calc(100% - ${RAIL_CHEVRON_HALF_PX}px)`;
            const near  = `${RAIL_CHEVRON_HALF_PX}px`;

            switch (this.getEdge()) {
                case Placement.EAST:
                    left = near;
                    top  = "50%";

                    break;

                case Placement.NORTH:
                    left = "50%";
                    top  = inset;

                    break;

                case Placement.SOUTH:
                    left = "50%";
                    top  = near;

                    break;

                case Placement.WEST:
                default:
                    left = inset;
                    top  = "50%";

                    break;
            }
        }

        // Fill the strip thickness when collapsed; clear to the CollapseButton
        // grip width (its class-rule default) when expanded.
        const width = collapsed ? RAIL_COLLAPSED_THICKNESS_PX + "px" : null;

        new StyleRule({
            scope:  "component",
            name:   this._collapseButton.getId(),
            styles: { left, top, width, zIndex: "1" },
        });
    }

    /**
     * Animates the cross-axis between the full and collapsed extents. The chevron
     * heading, skin, and placement flip up front.
     *
     * The handles stay shown and laid out at the full extent across the whole
     * tween in both directions; because the rail clips its overflow, the moving
     * edge reveals them as the strip widens (expand) and clips them away as it
     * narrows (collapse), so they follow the animation symmetrically rather than
     * popping in or out. On collapse they are hidden only once the strip has
     * closed.
     *
     * @param collapsed - True when collapsing, false when expanding.
     */
    private animateCollapseTransition(collapsed: boolean): void {
        const heading = collapseHeadingFor(this.getEdge());

        this._collapseButton.setDirection(collapsed ? OPPOSITE_HEADING[heading] : heading);
        this.applyCollapseStyling(collapsed);
        this.positionChevron(collapsed);

        const element = this.getElement();

        // The visible extent the tween starts from — the live cross-axis size
        // (full when collapsing, the collapsed strip when expanding). Captured
        // before the expand path lays out the full geometry below.
        const fromThickness = this.isVertical() ? this.getWidth() : this.getHeight();
        const toThickness   = collapsed ? RAIL_COLLAPSED_THICKNESS_PX : this._expandedThickness;

        if (!collapsed) {
            // Reveal and lay the handles out at the full extent up front; the
            // tween's `from` immediately shrinks the visible strip back to the
            // collapsed width, so they wipe into view as it grows. (Collapse
            // keeps the already-laid-out handles in place so the narrowing strip
            // wipes them out; they are hidden in `finalize`.)
            this.setAllHandlesDisplayed(true);
            this.applyRestingGeometry();
            this.scheduleLayout();
        }

        const finalize = (): void => {
            // Now that the strip has closed, drop the handles out of the layout.
            if (collapsed) {
                this.setAllHandlesDisplayed(false);
            }

            this.applyRestingGeometry();

            if (!collapsed) {
                this.scheduleLayout();
            }
        };

        if (!element) {
            finalize();

            return;
        }

        const tween = this.collapseTween(fromThickness, toThickness);

        this._collapseAnimation?.cancel();
        this._collapseAnimation = Animation.play(element, {
            from:       tween.from,
            to:         tween.to,
            durationMs: RAIL_ANIM_DURATION_MS,
            properties: tween.properties,
            onComplete: finalize,
        });
    }

    /**
     * Builds the from/to inline styles for the collapse/expand tween: the
     * cross-axis dimension (and, for EAST/SOUTH rails whose anchored corner
     * moves, the matching `left`/`top`) between two explicit thicknesses.
     *
     * @param fromThickness - The cross-axis extent the tween starts from.
     * @param toThickness - The cross-axis extent the tween ends at.
     *
     * @returns The `from` / `to` style partials and the animated property names.
     */
    private collapseTween(fromThickness: number, toThickness: number): {
        from: Partial<CSSStyleDeclaration>;
        to: Partial<CSSStyleDeclaration>;
        properties: string[];
    } {
        const vp   = DOM.source.getViewportSize();
        const from: Partial<CSSStyleDeclaration> = {};
        const to:   Partial<CSSStyleDeclaration> = {};

        if (this.isVertical()) {
            from.width = fromThickness + "px";
            to.width   = toThickness + "px";

            if (this.getEdge() === Placement.EAST) {
                from.left = (vp.width - fromThickness) + "px";
                to.left   = (vp.width - toThickness) + "px";
            }
        } else {
            from.height = fromThickness + "px";
            to.height   = toThickness + "px";

            if (this.getEdge() === Placement.SOUTH) {
                from.top = (vp.height - fromThickness) + "px";
                to.top   = (vp.height - toThickness) + "px";
            }
        }

        return { from, to, properties: Object.keys(to) };
    }

    /**
     * Shows or hides every handle (drawer and window).
     *
     * @param displayed - True to show the handles, false to hide them.
     */
    private setAllHandlesDisplayed(displayed: boolean): void {
        for (const reg of this._drawers.values()) {
            reg.handle.setDisplayed(displayed);
        }

        for (const reg of this._windows.values()) {
            reg.handle?.setDisplayed(displayed);
        }
    }

    /**
     * Sets the handle-label text orientation for the vertical (WEST/EAST) sides
     * and re-applies the writing mode to every existing handle. Ignored visually
     * on NORTH/SOUTH, where handle text is always horizontal.
     *
     * @param orientation - The {@link RailOrientation} to apply.
     *
     * @returns This rail, for method chaining.
     */
    setOrientation(orientation: RailOrientation): this {
        this._options.orientation = orientation;

        // `_drawers` / `_windows` are class-field Maps initialised only after
        // super() returns, but `applyOptions` dispatches this setter during the
        // super() cascade. Skip the re-apply then — no handles exist yet, and
        // each one picks up the orientation as it is created (see
        // registerDrawer / showWindowHandle).
        if (this._drawers !== undefined) {
            this.applyOrientation();
        }

        return this;
    }

    /**
     * Returns the current handle-label text orientation.
     *
     * @returns The current orientation.
     */
    getOrientation(): RailOrientation {
        return this._options.orientation ?? this._defaultOptions.orientation!;
    }

    // ----- mount / unmount -----

    /**
     * Mounts the rail on `document.documentElement`: installs the handle-axis
     * layout manager, applies the divider border and resting geometry, attaches
     * the element, and tracks viewport resizes. No-op if already mounted.
     *
     * @returns This rail, for method chaining.
     */
    mount(): this {
        if (this._mounted) {
            return this;
        }

        this.setLayoutManager(this.isVertical() ? new VBox() : new HBox());
        this.applyEdgeBorder();
        this.applyRestingGeometry();

        const element = this.getElement(true)!;
        DOM.sink.appendChild(DOM.source.getDocumentElement(), element);

        // The collapse chevron is a raw child (self-centred via its own class
        // rule), outside the handle layout, so it doesn't count toward the
        // content-fit thickness. Append once; a remount reuses the element.
        const chevron = this._collapseButton.getElement(true);
        if (chevron && DOM.source.getParentElement(chevron) !== element) {
            DOM.sink.appendChild(element, chevron);
        }

        // Seed the chevron heading, skin, placement, and handle visibility for
        // the initial (possibly collapsed) state.
        this.applyCollapseAppearance();

        this.scheduleLayout();

        Event.addViewportListener(this, "resize", this._boundResizeHandler);

        this._mounted = true;
        this.animateIn();

        return this;
    }

    /**
     * Unmounts the rail: stops tracking viewport resizes and detaches the
     * element. Registered drawers and windows keep their subscriptions, so a
     * later `mount()` restores a working strip.
     *
     * @returns This rail, for method chaining.
     */
    unmount(): this {
        if (!this._mounted) {
            return this;
        }

        Event.removeViewportListener(this, "resize", this._boundResizeHandler);

        this._mounted = false;

        // Slide the strip back off its edge, then detach. Under reduced motion
        // Animation.play runs the completion synchronously.
        const element = this.getElement();
        const detach = (): void => { this.removeElement(); };

        if (!element) {
            detach();

            return this;
        }

        this._slideOutAnimation?.cancel();
        this._slideOutAnimation = Animation.play(element, {
            to:         { transform: this.offscreenTransform() },
            durationMs: RAIL_ANIM_DURATION_MS,
            properties: ["transform"],
            onComplete: detach,
        });

        return this;
    }

    /**
     * Slides the strip in from off its anchored edge to its resting position.
     */
    private animateIn(): void {
        const element = this.getElement();

        if (!element) {
            return;
        }

        this._slideInAnimation?.cancel();
        this._slideInAnimation = Animation.play(element, {
            from:       { transform: this.offscreenTransform() },
            to:         { transform: "translate(0, 0)" },
            durationMs: RAIL_ANIM_DURATION_MS,
            properties: ["transform"],
        });
    }

    /**
     * Returns the off-screen `transform` for the current edge — the strip
     * translated one full thickness past the edge it anchors to, the start
     * (mount) and end (unmount) state of the slide.
     *
     * @returns A `translateX` / `translateY` CSS value.
     */
    private offscreenTransform(): string {
        switch (this.getEdge()) {
            case Placement.EAST:
                return "translateX(100%)";

            case Placement.NORTH:
                return "translateY(-100%)";

            case Placement.SOUTH:
                return "translateY(100%)";

            case Placement.WEST:
            default:
                return "translateX(-100%)";
        }
    }

    // ----- drawer composition -----

    /**
     * Registers a drawer: adds a handle that toggles it, mirrors the drawer's
     * open/closed state onto the handle via the drawer's public `on`, and (by
     * default) aligns the drawer's edge to the rail's. No-op if already
     * registered.
     *
     * @param drawer - The drawer to host. The caller retains ownership of its
     *   lifecycle.
     * @param reg - Per-registration options (handle glyph / text, edge
     *   alignment).
     *
     * @returns This rail, for method chaining.
     */
    registerDrawer(drawer: Drawer, reg: RailDrawerRegistration = {}): this {
        if (this._drawers.has(drawer)) {
            return this;
        }

        const handle = new RailHandle({ text: reg.text, glyph: reg.glyph, selected: drawer.isOpen() });

        const onOpen:   () => void   = (): void => { handle.setSelected(true); };
        const onClose:  () => void   = (): void => { handle.setSelected(false); };
        const onAction: ClickListener = (): void => { drawer.toggle(); };

        drawer.on("open", onOpen);
        drawer.on("close", onClose);
        handle.on("action", onAction);

        if (reg.alignEdge !== false) {
            drawer.setEdge(this.getEdge() as DrawerEdge);
        }

        this.applyHandleOrientation(handle);
        handle.setDisplayed(!this.isCollapsed());
        this.addComponent(handle);
        this._drawers.set(drawer, { handle, onOpen, onClose, onAction });

        this.adaptThickness();
        this.scheduleLayout();
        this.emit("register", drawer);

        return this;
    }

    /**
     * Unregisters a drawer: removes its handle and detaches every subscription
     * (the exact listener references are removed so nothing leaks). Does not
     * close or destroy the drawer. No-op if not registered.
     *
     * @param drawer - The drawer to remove.
     *
     * @returns This rail, for method chaining.
     */
    unregisterDrawer(drawer: Drawer): this {
        const reg = this._drawers.get(drawer);
        if (!reg) {
            return this;
        }

        drawer.off("open", reg.onOpen);
        drawer.off("close", reg.onClose);
        reg.handle.off("action", reg.onAction);

        this.removeComponent(reg.handle);
        this._drawers.delete(drawer);

        this.adaptThickness();
        this.emit("unregister", drawer);

        return this;
    }

    // ----- window-minimize composition -----

    /**
     * Registers a window so it can minimize into the rail. Subscribes to the
     * window's minimize / restore / close events; while the window is minimized
     * it is represented by a rail handle that restores it on click. Called by
     * {@link AbstractWindow.setRail}. No-op if already registered.
     *
     * @param window - The window to host.
     *
     * @returns This rail, for method chaining.
     */
    registerWindow(window: AbstractWindow): this {
        if (this._windows.has(window)) {
            return this;
        }

        const onMinimize: () => void   = (): void => { this.showWindowHandle(window); };
        const onRestore:  () => void   = (): void => { this.removeWindowHandle(window); };
        const onClose:    () => void   = (): void => { this.unregisterWindow(window); };
        const onAction:   ClickListener = (): void => { window.restore(); };

        window.on("minimize", onMinimize);
        window.on("restore", onRestore);
        window.on("close", onClose);

        this._windows.set(window, { handle: null, onMinimize, onRestore, onClose, onAction });

        // A window registered while already minimized gets its handle now.
        if (window.isMinimized()) {
            this.showWindowHandle(window);
        }

        this.emit("register", window);

        return this;
    }

    /**
     * Unregisters a window: removes any handle and detaches every subscription.
     * Does not close the window. No-op if not registered.
     *
     * @param window - The window to remove.
     *
     * @returns This rail, for method chaining.
     */
    unregisterWindow(window: AbstractWindow): this {
        const reg = this._windows.get(window);
        if (!reg) {
            return this;
        }

        window.off("minimize", reg.onMinimize);
        window.off("restore", reg.onRestore);
        window.off("close", reg.onClose);

        this.removeWindowHandle(window);
        this._windows.delete(window);

        this.emit("unregister", window);

        return this;
    }

    /**
     * Creates and adds a handle representing a minimized window, bearing its
     * title and glyph, wired to restore it on click. No-op if a handle already
     * shows.
     *
     * @param window - The minimized window.
     */
    private showWindowHandle(window: AbstractWindow): void {
        const reg = this._windows.get(window);
        if (!reg || reg.handle !== null) {
            return;
        }

        const handle = new RailHandle({ text: window.getTitle(), glyph: window.getGlyph(), selected: true });
        handle.on("action", reg.onAction);

        reg.handle = handle;
        this.applyHandleOrientation(handle);
        handle.setDisplayed(!this.isCollapsed());
        this.addComponent(handle);

        this.adaptThickness();
        this.scheduleLayout();
    }

    /**
     * Removes the handle representing a window, if one shows. No-op otherwise.
     *
     * @param window - The window whose handle to remove.
     */
    private removeWindowHandle(window: AbstractWindow): void {
        const reg = this._windows.get(window);
        if (!reg || reg.handle === null) {
            return;
        }

        reg.handle.off("action", reg.onAction);
        this.removeComponent(reg.handle);
        reg.handle = null;

        this.adaptThickness();
    }

    // ----- internal: handle orientation -----

    /**
     * Re-applies the current orientation's writing mode to every handle (drawer
     * and window). Called when the orientation changes.
     */
    private applyOrientation(): void {
        for (const reg of this._drawers.values()) {
            this.applyHandleOrientation(reg.handle);
        }

        for (const reg of this._windows.values()) {
            if (reg.handle !== null) {
                this.applyHandleOrientation(reg.handle);
            }
        }

        this.adaptThickness();
        this.scheduleLayout();
    }

    /**
     * Applies the orientation's writing mode to a single handle: a rotated
     * `writing-mode` on the vertical (WEST/EAST) sides, cleared otherwise (and
     * always on NORTH/SOUTH, where handle text stays horizontal). Mirrors the
     * `Tab` layout's `sideways-rl` / `sideways-lr` mapping.
     *
     * @param handle - The handle to orient.
     */
    private applyHandleOrientation(handle: RailHandle): void {
        const orientation = this.getOrientation();

        // `sideways-rl` reads top-to-bottom (clockwise); `sideways-lr` reads
        // bottom-to-top (counter-clockwise). Only meaningful on a vertical rail.
        const writingMode = orientation === "vertical-cw"  ? "sideways-rl"
                          :  orientation === "vertical-ccw" ? "sideways-lr"
                          :  null;

        if (this.isVertical() && writingMode !== null) {
            handle.setWritingMode(writingMode);
        } else {
            handle.clearWritingMode();
        }
    }

    // ----- internal: geometry -----

    /**
     * Opts the rail out of content-derived size clamping. Like
     * [`Container`](/api/core/classes/Container) / [`Panel`](/api/core/classes/Panel),
     * the rail sizes itself explicitly — its main axis spans the viewport and
     * its cross axis is the thickness it computes — so {@link Component.setWidth} /
     * {@link Component.setHeight} must not be clamped back to the layout
     * manager's content size. Without this, collapsing (which hides every
     * handle) would empty the handle layout, drive its content max toward zero,
     * and clamp the rail's viewport-spanning main axis to nothing — the strip
     * would vanish instead of resting at {@link RAIL_COLLAPSED_THICKNESS_PX}.
     *
     * @returns Always `false`.
     */
    protected clampsToContentSize(): boolean {
        return false;
    }

    /**
     * Returns whether the rail lays its handles out vertically — true for the
     * WEST and EAST edges (a column at a fixed width).
     *
     * @returns True for a vertical (WEST/EAST) rail.
     */
    private isVertical(): boolean {
        const edge = this.getEdge();

        return edge === Placement.WEST || edge === Placement.EAST;
    }

    /**
     * Computes the rail's on-screen rect from the current edge, thickness, and
     * viewport. WEST/EAST span the full viewport height at the chosen width;
     * NORTH/SOUTH span the full width at the chosen height.
     *
     * @returns The resting `{ x, y, width, height }` in pixels.
     */
    private restingRect(): { x: number; y: number; width: number; height: number } {
        const vp        = DOM.source.getViewportSize();
        const thickness = this.getThickness();

        switch (this.getEdge()) {
            case Placement.EAST:
                return { x: vp.width - thickness, y: 0, width: thickness, height: vp.height };

            case Placement.NORTH:
                return { x: 0, y: 0, width: vp.width, height: thickness };

            case Placement.SOUTH:
                return { x: 0, y: vp.height - thickness, width: vp.width, height: thickness };

            case Placement.WEST:
            default:
                return { x: 0, y: 0, width: thickness, height: vp.height };
        }
    }

    /**
     * Applies the resting rect to the rail via the typed geometry setters.
     */
    private applyRestingGeometry(): void {
        const rect = this.restingRect();

        this.setX(rect.x);
        this.setY(rect.y);
        this.setWidth(rect.width);
        this.setHeight(rect.height);
    }

    /**
     * Applies the expanded-state border: a 1px divider (`--ts-ui-rail-border`) on
     * the rail's inner edge — the side facing the rest of the UI — with the other
     * three sides a 1px *transparent* border rather than no border.
     *
     * Reserving the same 1px box on every side that the collapsed strip's button
     * border occupies keeps the rail's border-box geometry identical across the
     * collapse/expand transition, so the handles and chevron don't jump by a
     * pixel when the visible border appears or disappears.
     */
    private applyEdgeBorder(): void {
        const transparent = "1px solid transparent";
        const divider     = "1px solid var(--ts-ui-rail-border)";

        switch (this.getEdge()) {
            case Placement.EAST:
                this.setBorder({ border: transparent, borderLeft: divider });

                break;

            case Placement.NORTH:
                this.setBorder({ border: transparent, borderBottom: divider });

                break;

            case Placement.SOUTH:
                this.setBorder({ border: transparent, borderTop: divider });

                break;

            case Placement.WEST:
            default:
                this.setBorder({ border: transparent, borderRight: divider });

                break;
        }
    }

    // ----- typed events -----

    /**
     * Registers a listener for one of the rail's events.
     *
     * @param event - `"register"` fires when a drawer/window is added,
     *   `"unregister"` when one is removed.
     * @param listener - The callback, receiving the affected drawer or window.
     *
     * @returns This rail, for method chaining.
     */
    on(event: RailEvent, listener: (target: Drawer | AbstractWindow) => void): this {
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
     * @returns This rail, for method chaining.
     */
    off(event: RailEvent, listener: (target: Drawer | AbstractWindow) => void): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event`, in registration order.
     *
     * @param event - The event to emit.
     * @param target - The affected drawer or window, forwarded to each listener.
     */
    protected emit(event: RailEvent, target: Drawer | AbstractWindow): void {
        this._listeners.fire(event, target);
    }

    /**
     * Cancels any in-flight collapse / slide animation, then defers to the base
     * class. Cancelling first keeps their fallback timers from firing after
     * `super.destructor()` has released this rail's element handle.
     */
    protected destructor(): void {
        this._collapseAnimation?.cancel();
        this._collapseAnimation = null;
        this._slideOutAnimation?.cancel();
        this._slideOutAnimation = null;
        this._slideInAnimation?.cancel();
        this._slideInAnimation = null;

        super.destructor();
    }
}

const RailCallable = callable(Rail);
type RailCallable = Rail;
export {
    Rail         as _Rail,
    RailCallable as Rail,
};
