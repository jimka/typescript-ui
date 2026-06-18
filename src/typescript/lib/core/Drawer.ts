// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import { Animation } from "~/core/Animation.js";
import { Event } from "~/core/Event.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { LayerManager, DismissableLayer, LayerDismissMode } from "~/core/LayerManager.js";
import { Position } from "~/primitive/Position.js";
import { Placement } from "~/primitive/Placement.js";
import { DialogBackdrop } from "~/component/container/DialogBackdrop.js";
import { callable } from "~/core/Callable.js";

/**
 * Viewport edge a {@link Drawer} anchors to and slides in from. Reuses the
 * framework's compass primitive
 * [`Placement`](/api/primitive/enumerations/Placement) minus `CENTER`, which is
 * meaningless for an edge-anchored panel — excluding it makes the illegal state
 * unrepresentable at compile time.
 *
 * @category Core
 */
export type DrawerEdge = Exclude<Placement, Placement.CENTER>;

/**
 * Events emitted by a {@link Drawer}. `"open"` and `"close"` fire after the
 * corresponding transition is committed; `"beforeclose"` fires before a close
 * begins and can be vetoed via its {@link DrawerCloseController}.
 *
 * @category Core
 */
export type DrawerEvent = "open" | "close" | "beforeclose";

/**
 * Controller handed to a `"beforeclose"` listener. Calling `preventDefault()`
 * aborts the in-progress close — letting a host veto dismissal (e.g. an
 * unsaved-changes guard).
 *
 * @category Core
 */
export interface DrawerCloseController {
    /** Aborts the close that is about to run. */
    preventDefault(): void;
}

/**
 * Construction-time options for {@link Drawer}.
 *
 * @category Core
 */
export interface DrawerOptions extends ComponentOptions {
    /**
     * Viewport edge the drawer rests against and slides in from.
     *
     * @defaultValue Placement.WEST
     */
    edge?: DrawerEdge;

    /**
     * When true, render a blocking scrim behind the panel and close on
     * scrim-click or Escape. When false, the surrounding UI stays interactive
     * and the drawer closes only via its public API.
     *
     * @defaultValue false
     */
    modal?: boolean;

    /**
     * Drawer extent along its slide axis, in pixels: width for left/right
     * edges, height for top/bottom edges.
     *
     * @defaultValue 320
     */
    size?: number;

    /**
     * Slide (and scrim-fade) duration in milliseconds.
     *
     * @defaultValue 220
     */
    durationMs?: number;

    /** Construction-time event listeners dispatched to {@link Drawer.on}. */
    listeners?: {
        open?:        () => void;
        close?:       () => void;
        beforeclose?: (controller: DrawerCloseController) => void;
    };
}

/**
 * Default drawer extent (px) along the slide axis. A component-level constant
 * rather than a theme token because it is a layout-affecting measurement, not a
 * colour — matching how `Dialog` keeps its `MIN_*` sizes and `Notification` its
 * `WIDTH` / `HEIGHT` out of `Theme.ts`. 320 is the conventional side-panel
 * width (navigation rails, filter panels) and stays comfortably under a narrow
 * viewport so the scrim/content behind it remains visible.
 */
const DEFAULT_DRAWER_SIZE_PX: number = 320;

/**
 * Default slide / fade duration (ms). Tuned slightly longer than the dialog's
 * 150 ms because a drawer travels a full panel-width rather than a small
 * scale/opacity delta, so the same wall-clock feel needs more time.
 */
const DEFAULT_DRAWER_DURATION_MS: number = 220;

/**
 * Subclass defaults layered into `Component._defaultOptions`. The four
 * behavioural fields seed the options bag so {@link Drawer.getEdge} and friends
 * return a defined value before the caller (or a setter) writes one. `overflow`
 * is `auto` so a drawer scrolls content that exceeds its extent; the panel
 * surface tokens (`background`, `shadow`) are edge-agnostic and applied here,
 * while the directional divider border is applied per-edge in {@link Drawer.open}.
 */
const _defaultDrawerOptions: Partial<DrawerOptions> = {
    edge:            Placement.WEST,
    modal:           false,
    size:            DEFAULT_DRAWER_SIZE_PX,
    durationMs:      DEFAULT_DRAWER_DURATION_MS,
    overflow:        "auto",
    backgroundColor: "var(--ts-ui-drawer-bg)",
    shadow:          "var(--ts-ui-drawer-shadow)",
};

/**
 * An edge-anchored panel that rests off-screen against a viewport edge and
 * slides into view when opened, overlaying the rest of the UI.
 *
 * The drawer is a bare content host: callers add their own children via the
 * inherited `addComponent` and supply any header / dismiss chrome themselves.
 * It mounts on `document.documentElement` and registers with
 * [`LayerManager`](/api/core/classes/LayerManager) as a
 * [`DismissableLayer`](/api/core/interfaces/DismissableLayer), so Escape,
 * outside-click capture, and z-stacking behave like every other portaled
 * surface. A modal drawer additionally draws a
 * [`DialogBackdrop`](/api/component/container/classes/DialogBackdrop) scrim and
 * closes on scrim-click or Escape; a non-modal drawer leaves the surrounding UI
 * interactive and closes only through its public API.
 *
 * @example
 * ```typescript
 * import { Drawer } from '@jimka/typescript-ui/core';
 * import { Placement } from '@jimka/typescript-ui/primitive';
 * import { VBox } from '@jimka/typescript-ui/layout';
 *
 * const drawer = Drawer({ edge: Placement.EAST, modal: true, layoutManager: VBox() });
 * drawer.addComponent(myFilterForm);
 * drawer.open();
 * ```
 *
 * @category Core
 */
class Drawer extends Component<DrawerOptions> implements DismissableLayer {

    /** Whether the drawer is currently open (or mid-entrance). */
    private _open: boolean = false;

    /**
     * Whether an exit slide is in flight. Guards `close()` against re-entry
     * while the panel is sliding out — `_open` only flips to false in the exit
     * transition's completion callback, so without this flag a second `close()`
     * (via `toggle()`, a repeated dismiss click, or Esc) would re-emit `"close"`
     * and queue a redundant exit animation.
     */
    private _closing: boolean = false;

    /** The modal scrim, created lazily on each modal open and torn down on close. */
    private _backdrop: DialogBackdrop | null = null;

    /** Typed-event fan-out for `"open"` / `"close"` / `"beforeclose"`. */
    private _listeners: ListenerBag<DrawerEvent> = new ListenerBag<DrawerEvent>();

    /** Stable viewport-resize handler reference, for add/remove symmetry. */
    private _boundResizeHandler: () => void = (): void => this.onViewportResize();

    /** Stable scrim-click handler reference; closes the drawer. */
    private _boundBackdropClose: () => void = (): void => {
        this.close();
    };

    /**
     * Constructs a drawer but does not display it. Call `open()` to show.
     *
     * @param options - Construction-time options.
     * @param subclassDefaults - Defaults layered under `options` by a subclass.
     */
    constructor(options?: DrawerOptions, subclassDefaults?: Partial<DrawerOptions>) {
        super(options, { ..._defaultDrawerOptions, ...(subclassDefaults ?? {}) });

        // Floating overlay anchored to the viewport — the documented FIXED
        // carve-out, applied after super() like every other portaled surface.
        this.setPosition(Position.FIXED);

        // Listener dispatch lives in the constructor body, not applyOptions:
        // the ListenerBag field is undefined during the super() cascade.
        this.applyListeners(options?.listeners);
    }

    /**
     * Applies a {@link DrawerOptions} bag, dispatching the drawer-specific
     * fields after inherited Component fields. `listeners` is handled in the
     * constructor instead — it cannot run during the super() cascade.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This drawer, for method chaining.
     */
    protected applyOptions(options: DrawerOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as DrawerOptions;

        if (opts.edge !== undefined) {
            this.setEdge(opts.edge);
        }

        if (opts.modal !== undefined) {
            this.setModal(opts.modal);
        }

        if (opts.size !== undefined) {
            this.setDrawerSize(opts.size);
        }

        if (opts.durationMs !== undefined) {
            this.setDurationMs(opts.durationMs);
        }

        return this;
    }

    // ----- typed setters (cache only; geometry/CSS applied in open()) -----

    /**
     * Sets the viewport edge the drawer anchors to. Cached only — the resting
     * geometry and directional border are derived in `open()`, where the
     * element provably exists.
     *
     * @param edge - The edge to anchor against.
     *
     * @returns This drawer, for method chaining.
     */
    setEdge(edge: DrawerEdge): this {
        this._options.edge = edge;

        return this;
    }

    /**
     * Returns the edge the drawer anchors to.
     *
     * @returns The current edge.
     */
    getEdge(): DrawerEdge {
        return this._options.edge ?? Placement.WEST;
    }

    /**
     * Sets whether the drawer is modal. A modal drawer draws a blocking scrim
     * and closes on scrim-click / Escape; a non-modal one does neither.
     *
     * @param value - True for a modal drawer.
     *
     * @returns This drawer, for method chaining.
     *
     * @remarks Takes effect on the next `open()`; changing it while open does
     * not retroactively add or remove the scrim.
     */
    setModal(value: boolean): this {
        this._options.modal = value;

        return this;
    }

    /**
     * Returns whether the drawer is modal.
     *
     * @returns True when modal.
     */
    isModal(): boolean {
        return this._options.modal ?? false;
    }

    /**
     * Sets the drawer's extent along its slide axis (width for left/right,
     * height for top/bottom). Named `setDrawerSize` rather than overriding the
     * inherited `Component.setSize(size: Size)` — the two-axis geometry setter —
     * because a drawer's extent is a single number along one axis.
     *
     * @param value - The extent in pixels.
     *
     * @returns This drawer, for method chaining.
     */
    setDrawerSize(value: number): this {
        this._options.size = value;

        return this;
    }

    /**
     * Returns the drawer's extent along its slide axis, in pixels.
     *
     * @returns The current extent.
     */
    getDrawerSize(): number {
        return this._options.size ?? DEFAULT_DRAWER_SIZE_PX;
    }

    /**
     * Sets the slide / scrim-fade duration in milliseconds.
     *
     * @param ms - The duration in milliseconds.
     *
     * @returns This drawer, for method chaining.
     */
    setDurationMs(ms: number): this {
        this._options.durationMs = ms;

        return this;
    }

    /**
     * Returns the slide / scrim-fade duration in milliseconds.
     *
     * @returns The current duration.
     */
    getDurationMs(): number {
        return this._options.durationMs ?? DEFAULT_DRAWER_DURATION_MS;
    }

    // ----- open / close API -----

    /**
     * Slides the drawer into view from its anchored edge. Registers with the
     * layer tree, draws the scrim when modal, mounts on `documentElement`, and
     * animates in. No-op if already open.
     *
     * @returns This drawer, for method chaining.
     */
    open(): this {
        if (this._open) {
            return this;
        }

        LayerManager.register(this);

        const panelZ = LayerManager.getZIndex(this);
        this.setZIndex(panelZ);

        if (this.isModal()) {
            this.openBackdrop(panelZ - 1);
        }

        this.applyEdgeBorder();
        this.applyRestingGeometry();

        DOM.sink.appendChild(document.documentElement, this.getElement(true));
        this.scheduleLayout();

        this.animateIn();

        Event.addViewportListener(this, "resize", this._boundResizeHandler);

        this._open = true;
        this.emit("open");

        return this;
    }

    /**
     * Slides the drawer back off-screen and tears it down. Fires the cancelable
     * `"beforeclose"` event first; if a listener vetoes via `preventDefault()`
     * the close is aborted. No-op if already closed.
     *
     * @returns This drawer, for method chaining.
     */
    close(): this {
        if (!this._open || this._closing) {
            return this;
        }

        let prevented = false;
        const controller: DrawerCloseController = {
            preventDefault: (): void => {
                prevented = true;
            },
        };

        this.emit("beforeclose", controller);

        if (prevented) {
            return this;
        }

        this._closing = true;

        Event.removeViewportListener(this, "resize", this._boundResizeHandler);

        this.animateOutAndFinalize();

        return this;
    }

    /**
     * Opens the drawer if closed, or closes it if open.
     *
     * @returns This drawer, for method chaining.
     */
    toggle(): this {
        return this._open ? this.close() : this.open();
    }

    /**
     * Returns whether the drawer is currently open.
     *
     * @returns True when open (or mid-entrance).
     */
    isOpen(): boolean {
        return this._open;
    }

    // ----- internal: geometry & animation -----

    /**
     * Computes the panel's on-screen resting rect from the current edge, size,
     * and viewport. WEST/EAST span the full viewport height at the chosen
     * width; NORTH/SOUTH span the full width at the chosen height.
     *
     * @returns The resting `{ x, y, width, height }` in pixels.
     */
    private restingRect(): { x: number; y: number; width: number; height: number } {
        const vp   = DOM.source.getViewportSize();
        const size = this.getDrawerSize();

        switch (this.getEdge()) {
            case Placement.EAST:
                return { x: vp.width - size, y: 0, width: size, height: vp.height };

            case Placement.NORTH:
                return { x: 0, y: 0, width: vp.width, height: size };

            case Placement.SOUTH:
                return { x: 0, y: vp.height - size, width: vp.width, height: size };

            case Placement.WEST:
            default:
                return { x: 0, y: 0, width: size, height: vp.height };
        }
    }

    /**
     * Applies the resting rect to the panel via the typed geometry setters.
     */
    private applyRestingGeometry(): void {
        const rect = this.restingRect();

        this.setX(rect.x);
        this.setY(rect.y);
        this.setWidth(rect.width);
        this.setHeight(rect.height);
    }

    /**
     * Returns the off-screen `transform` for the current edge — the slide's
     * start (entrance) and end (exit) state, translated one full extent past
     * the anchored edge.
     *
     * @returns A `translateX`/`translateY` CSS value.
     */
    private offscreenTransform(): string {
        const size = this.getDrawerSize();

        switch (this.getEdge()) {
            case Placement.EAST:
                return `translateX(${size}px)`;

            case Placement.NORTH:
                return `translateY(${-size}px)`;

            case Placement.SOUTH:
                return `translateY(${size}px)`;

            case Placement.WEST:
            default:
                return `translateX(${-size}px)`;
        }
    }

    /**
     * Applies the 1px divider border on the panel's inner edge — the side that
     * faces the rest of the UI — leaving the other three sides borderless.
     */
    private applyEdgeBorder(): void {
        const divider = "1px solid var(--ts-ui-drawer-border)";

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

    /**
     * Slides the panel in from its off-screen transform to its resting
     * position. Honours `prefers-reduced-motion` via {@link Animation.play}.
     */
    private animateIn(): void {
        const element = this.getElement();

        if (!element) {
            return;
        }

        Animation.play(element, {
            from:       { transform: this.offscreenTransform() },
            to:         { transform: "translate(0, 0)" },
            durationMs: this.getDurationMs(),
            properties: ["transform"],
        });
    }

    /**
     * Slides the panel back off-screen, then finalizes teardown (detach the
     * element, destroy the scrim, leave the layer tree, emit `"close"`) in the
     * transition's completion callback. Fades the scrim out concurrently. Under
     * reduced motion {@link Animation.play} runs the completion synchronously.
     */
    private animateOutAndFinalize(): void {
        const element = this.getElement();

        const finalize = (): void => {
            this.removeElement();
            this.teardownBackdrop();
            LayerManager.unregister(this);

            this._open    = false;
            this._closing = false;
            this.emit("close");
        };

        if (!element) {
            finalize();

            return;
        }

        Animation.play(element, {
            to:         { transform: this.offscreenTransform() },
            durationMs: this.getDurationMs(),
            properties: ["transform"],
            onComplete: finalize,
        });

        this.fadeBackdropOut();
    }

    /**
     * Creates the modal scrim, stamps it one z-index below the panel, wires
     * scrim-click-to-close, mounts it, and fades it in.
     *
     * @param zIndex - The z-index for the scrim (panel z minus one).
     */
    private openBackdrop(zIndex: number): void {
        this._backdrop = new DialogBackdrop();
        this._backdrop.setZIndex(zIndex);
        this._backdrop.addClickListener(this._boundBackdropClose);

        const backdropEl = this._backdrop.getElement(true);
        DOM.sink.appendChild(document.documentElement, backdropEl);

        Animation.play(backdropEl, {
            from:       { opacity: "0" },
            to:         { opacity: "1" },
            durationMs: this.getDurationMs(),
            properties: ["opacity"],
        });
    }

    /**
     * Fades the modal scrim out, if one is present. The element is destroyed by
     * {@link teardownBackdrop} once the panel's exit completes.
     */
    private fadeBackdropOut(): void {
        const backdropEl = this._backdrop?.getElement();

        if (!backdropEl) {
            return;
        }

        Animation.play(backdropEl, {
            to:         { opacity: "0" },
            durationMs: this.getDurationMs(),
            properties: ["opacity"],
        });
    }

    /**
     * Removes the modal scrim from the DOM and drops the reference, if one is
     * present.
     */
    private teardownBackdrop(): void {
        if (this._backdrop !== null) {
            this._backdrop.destroy();
            this._backdrop = null;
        }
    }

    /**
     * Re-derives the panel rect and resizes the scrim when the viewport
     * changes, keeping a full-height/width drawer flush with the new edges.
     */
    private onViewportResize(): void {
        if (this._backdrop !== null) {
            this._backdrop.resize();
        }

        this.applyRestingGeometry();
    }

    // ----- typed events -----

    /**
     * Registers a listener for one of the drawer's events.
     *
     * @param event - `"open"` / `"close"` fire after the matching transition;
     *   `"beforeclose"` fires before a close and can veto it via its controller.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This drawer, for method chaining.
     */
    on(event: "open" | "close", listener: () => void): this;
    on(event: "beforeclose",    listener: (controller: DrawerCloseController) => void): this;
    on(event: DrawerEvent,      listener: Function): this {
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
     * @returns This drawer, for method chaining.
     */
    off(event: DrawerEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event`, in registration order.
     *
     * @param event - The event to emit.
     * @param payload - Forwarded to each listener.
     */
    protected emit(event: "open" | "close"): void;
    protected emit(event: "beforeclose", controller: DrawerCloseController): void;
    protected emit(event: DrawerEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    // ----- DismissableLayer -----

    /**
     * Returns the drawer panel's root element for the layer tree.
     *
     * @returns The drawer's element, or null when not yet rendered.
     */
    getLayerElement(): HTMLElement | null {
        return this.getElement();
    }

    /**
     * Returns the dismiss mode the document-level handlers consult: `"modal"`
     * for a modal drawer (captures outside interaction, Escape closes it) and
     * `"manual"` for a non-modal one (never auto-dismissed — closing is the
     * caller's job).
     *
     * @returns The layer dismiss mode.
     */
    getDismissMode(): LayerDismissMode {
        return this.isModal() ? "modal" : "manual";
    }

    /**
     * Advisory close request from the layer manager (Escape on a modal
     * drawer). Routes to the public `close()`.
     */
    requestClose(): void {
        this.close();
    }

    /**
     * Drawers are independent top-level peers, not layers opened from another,
     * so each registers as a tree root.
     *
     * @returns Always `true`.
     */
    isLayerRoot(): boolean {
        return true;
    }

    /**
     * Mirrors a manager-reallocated z-index onto the panel (and the scrim, one
     * below) when the drawer is re-stamped.
     *
     * @param zIndex - The fresh z-index assigned by the manager.
     */
    onZIndexChanged(zIndex: number): void {
        this.setZIndex(zIndex);

        if (this._backdrop !== null) {
            this._backdrop.setZIndex(zIndex - 1);
        }
    }
}

const DrawerCallable = callable(Drawer);
type DrawerCallable = Drawer;
export {
    Drawer         as _Drawer,
    DrawerCallable as Drawer,
};
