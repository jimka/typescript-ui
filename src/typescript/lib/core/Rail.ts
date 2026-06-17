// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Animation } from "~/core/Animation.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { Position } from "~/primitive/Position.js";
import { Placement } from "~/primitive/Placement.js";
import { Util } from "~/core/Util.js";
import { HBox } from "~/layout/HBox.js";
import { VBox } from "~/layout/VBox.js";
import { RailHandle } from "~/core/RailHandle.js";
import { callable } from "~/core/Callable.js";
import type { Drawer, DrawerEdge } from "~/core/Drawer.js";
import type { AbstractWindow } from "~/core/AbstractWindow.js";
import type { ClickListener } from "~/component/button/Button.js";

/**
 * Viewport edge a {@link Rail} anchors to. Structurally identical to
 * [`DrawerEdge`](/api/core/type-aliases/DrawerEdge) — the framework's compass
 * primitive [`Placement`](/api/primitive/enumerations/Placement) minus `CENTER`,
 * which is meaningless for an edge-anchored strip.
 *
 * @category Core
 */
export type RailEdge = Exclude<Placement, Placement.CENTER>;

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
     * Rail thickness in pixels — width for WEST/EAST edges, height for
     * NORTH/SOUTH edges. The cross-axis always spans the full viewport.
     *
     * @defaultValue 48
     */
    thickness?: number;

    /** Construction-time event listeners dispatched to {@link Rail.on}. */
    listeners?: {
        register?:   (target: Drawer | AbstractWindow) => void;
        unregister?: (target: Drawer | AbstractWindow) => void;
    };
}

/**
 * Default rail thickness (px) along the cross axis. A component-level constant
 * rather than a theme token because it is a layout-affecting measurement, not a
 * colour — matching how `Drawer` keeps its `DEFAULT_DRAWER_SIZE_PX` out of
 * `Theme.ts`. 48 px is the conventional icon-rail width (a comfortable square
 * touch target for a single glyph handle).
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
 * Subclass defaults layered into `Component._defaultOptions`. The two
 * behavioural fields seed the options bag so {@link Rail.getEdge} /
 * {@link Rail.getThickness} return a defined value before a setter writes one;
 * the surface tokens skin the strip.
 */
const _defaultRailOptions: Partial<RailOptions> = {
    edge:            Placement.WEST,
    thickness:       DEFAULT_RAIL_THICKNESS_PX,
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
 * buttons. Unlike a [`Drawer`](/api/core/classes/Drawer) it never slides
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
 * import { Rail, Drawer } from '@jimka/typescript-ui/core';
 * import { Placement } from '@jimka/typescript-ui/primitive';
 *
 * const rail = Rail({ edge: Placement.WEST }).mount();
 * rail.registerDrawer(Drawer(), { glyph: 'filter', text: 'Filters' });
 * ```
 *
 * @category Core
 */
class Rail extends Component<RailOptions> {

    /** Typed-event fan-out for `"register"` / `"unregister"`. */
    private _listeners: ListenerBag<RailEvent> = new ListenerBag<RailEvent>();

    /** Registered drawers, keyed by drawer, holding the handle + listener refs. */
    private _drawers: Map<Drawer, DrawerRegistration> = new Map();

    /** Registered windows, keyed by window, holding the handle + listener refs. */
    private _windows: Map<AbstractWindow, WindowRegistration> = new Map();

    /** Whether the rail is currently mounted (attached to the document). */
    private _mounted: boolean = false;

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

        // Listener dispatch lives in the constructor body, not applyOptions:
        // the ListenerBag field is undefined during the super() cascade.
        if (options?.listeners !== undefined) {
            this.applyListeners(options.listeners);
        }
    }

    /**
     * Wires the construction-time listener bag onto the typed `on` surface.
     *
     * @param listeners - The `options.listeners` bag.
     */
    private applyListeners(listeners: NonNullable<RailOptions["listeners"]>): void {
        if (listeners.register !== undefined) {
            this.on("register", listeners.register);
        }

        if (listeners.unregister !== undefined) {
            this.on("unregister", listeners.unregister);
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

        const opts = { ...this._defaultOptions, ...options } as RailOptions;

        if (opts.edge !== undefined) {
            this.setEdge(opts.edge);
        }

        if (opts.thickness !== undefined) {
            this.setThickness(opts.thickness);
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
        return this._options.edge ?? Placement.WEST;
    }

    /**
     * Sets the rail's thickness along its cross axis (width for WEST/EAST,
     * height for NORTH/SOUTH). Takes effect on the next `mount()` /
     * viewport-resize re-layout.
     *
     * @param px - The thickness in pixels.
     *
     * @returns This rail, for method chaining.
     */
    setThickness(px: number): this {
        this._options.thickness = px;

        return this;
    }

    /**
     * Returns the rail's thickness in pixels.
     *
     * @returns The current thickness.
     */
    getThickness(): number {
        return this._options.thickness ?? DEFAULT_RAIL_THICKNESS_PX;
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

        document.documentElement.appendChild(this.getElement(true));
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

        Animation.play(element, {
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

        Animation.play(element, {
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

        this.addComponent(handle);
        this._drawers.set(drawer, { handle, onOpen, onClose, onAction });

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
        this.addComponent(handle);

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
    }

    // ----- internal: geometry -----

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
        const vp        = Util.getViewportSize();
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
     * Applies the 1px divider border on the rail's inner edge — the side that
     * faces the rest of the UI — leaving the other three sides borderless.
     */
    private applyEdgeBorder(): void {
        const divider = "1px solid var(--ts-ui-rail-border)";

        switch (this.getEdge()) {
            case Placement.EAST:
                this.setBorder({ border: "none", borderLeft: divider });

                break;

            case Placement.NORTH:
                this.setBorder({ border: "none", borderBottom: divider });

                break;

            case Placement.SOUTH:
                this.setBorder({ border: "none", borderTop: divider });

                break;

            case Placement.WEST:
            default:
                this.setBorder({ border: "none", borderRight: divider });

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
}

const RailCallable = callable(Rail);
type RailCallable = Rail;
export {
    Rail         as _Rail,
    RailCallable as Rail,
};
