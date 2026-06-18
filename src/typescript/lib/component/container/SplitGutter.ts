// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import { CollapseButton, CollapseDirection } from "~/component/container/CollapseButton.js";
import { Event } from "~/core/Event.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { Tooltip } from "~/core/Tooltip.js";
import { Util } from "~/core/Util.js";
import { callable } from "~/core/Callable.js";

/**
 * String-literal union of the events emitted by {@link SplitGutter}.
 *
 * @category Components
 */
export type SplitGutterEvent = "dragstart" | "drag" | "collapse";

/**
 * Maps each chevron direction to its opposite, used to flip the single
 * collapse chevron between its collapse heading (toward the pane/region's
 * outer edge) and its restore heading (back toward the centre) when the gutter
 * toggles between divider and strip state.
 */
const OPPOSITE_DIRECTION: Record<CollapseDirection, CollapseDirection> = {
    west:  "east",
    east:  "west",
    north: "south",
    south: "north",
};

/**
 * Construction-time options for {@link SplitGutter}.
 *
 * @category Components
 */
export interface SplitGutterOptions extends ComponentOptions {
    orientation?: string;
    /** Whether the gutter carries a collapse chevron. Defaults to `true`. */
    collapsible?: boolean;
    /**
     * Whether the gutter wires drag-to-resize listeners. `Split` leaves this
     * `true`; `Border` passes `false` for a fixed, non-draggable gutter.
     * Defaults to `true`. Read once at construction.
     */
    movable?: boolean;
    /**
     * Whether the gutter paints the opaque collapse-strip fill (collapsed
     * state) or its expanded background (divider state). Defaults to `false`.
     */
    opaque?: boolean;
    /**
     * The chevron's collapse heading — the way it points (and the way the
     * gutter travels) when collapsing. The restore heading is its opposite.
     * Defaults to `west` for a horizontal gutter, `north` for a vertical one.
     */
    collapseDirection?: CollapseDirection;
    /**
     * The background painted in the expanded (divider) state, restored when
     * {@link SplitGutter.setOpaque} is cleared. Defaults to the gutter token;
     * `Border` passes `"transparent"` for its minimal-until-collapsed look.
     */
    expandedBackground?: string;
    /**
     * Multi-event listener bag dispatched to {@link SplitGutter.on} at
     * construction time.
     */
    listeners?: {
        dragstart?: (position: number) => void;
        drag?:      (position: number) => void;
        collapse?:  () => void;
    };
}

/**
 * Class-level defaults. `orientation` rides the cascade so the `declare`-d
 * `_direction` backing field is seeded by `setDirection` during super(),
 * dodging the class-field super-cascade trap; `collapsible` and `movable`
 * likewise seed their backing fields through their setters.
 */
const _defaultSplitGutterOptions: Partial<SplitGutterOptions> = {
    orientation: "horizontal",
    collapsible: true,
    movable:     true,
};

/**
 * A gutter component shared by [`Split`](/api/layout/classes/Split) and the
 * [`Border`](/api/layout/classes/Border) layout that doubles as both a divider
 * and a collapsed strip.
 *
 * In the **divider** state it is the thin bar between two panes (draggable when
 * `movable`) or a transparent track at a region's inner edge, carrying a single
 * collapse chevron. In the **strip** state (`opaque`) it is the opaque
 * collapse-strip the pane/region tucks into, the same chevron now pointing the
 * restore way. The owning manager animates the gutter between the two by
 * writing its geometry; the gutter is the only thing that moves.
 *
 * When `movable`, it listens for mouse/touch drag events on the viewport and
 * notifies registered drag listeners with the absolute pointer coordinate
 * (`clientX`/`clientY`) in the gutter's drag axis on each move, disabling body
 * pointer events during a drag to prevent text selection.
 *
 * @category Components
 */
class SplitGutter extends Component<SplitGutterOptions> {

    declare private _direction: String;
    declare private _collapsible: boolean;
    declare private _movable: boolean;
    declare private _collapseButton: CollapseButton;
    private _opaque: boolean = false;
    private _collapseDirection: CollapseDirection = "west";
    private _expandedBackground: string = "var(--ts-ui-gutter-bg, #AAAAAA)";
    private _tooltipText: string = "";
    private _listeners: ListenerBag<SplitGutterEvent> = new ListenerBag<SplitGutterEvent>();

    constructor(direction: String, options?: SplitGutterOptions) {
        super(options, _defaultSplitGutterOptions);

        // Pre-migration the trailing applyOptions(options) ran *after* the
        // body's positional assignment, so a caller-supplied `orientation`
        // option won. Apply the positional only when the caller did not
        // supply orientation, preserving the option-wins-over-positional
        // contract.
        if (direction && options?.orientation === undefined) {
            this._direction = direction;
        }

        // The expanded fill is the gutter token by default; Border passes a
        // transparent value so its divider state shows only the chevron.
        this._expandedBackground = options?.expandedBackground ?? "var(--ts-ui-gutter-bg, #AAAAAA)";
        this.setBackgroundColor(this._expandedBackground);

        // The chevron's collapse heading points the way the gutter travels on
        // collapse — toward the pane/region's outer edge. Defaults from the
        // axis (Split's leading pane is west/north); Border overrides per
        // placement. The restore heading is its opposite, applied by setOpaque.
        this._collapseDirection = options?.collapseDirection ?? (this._direction === "horizontal" ? "west" : "north");

        this._collapseButton = new CollapseButton({
            direction: this._collapseDirection,
            listeners: { collapse: () => this.emit("collapse") },
        });

        this._collapseButton.setVisible(this._collapsible);

        if (options?.opaque) {
            this.setOpaque(true);
        }

        // A fixed gutter (Border) never resizes, so its body should not swallow
        // pointer events — the transparent track must let clicks reach the
        // region behind it, and the opaque strip has nothing behind to click.
        // The chevron child keeps its own `pointer-events: auto`, so it stays
        // clickable regardless.
        if (!this._movable) {
            this.setPointerEvents("none");
        }

        // Drag wiring lives here, gated on `movable`, NOT in `applyOptions`:
        // Component's constructor runs applyOptions from inside super(), and
        // the listener machinery (`_listeners`) is only live after super().
        // Border's fixed gutters pass `movable: false` and skip the wiring.
        if (this._movable) {
            Event.addListener(this, 'mousedown', this.onDragStart);
        }

        this.applyListeners(options?.listeners);

        // Seed the expanded-state hover hint (setOpaque already refreshes it
        // when an opaque gutter is constructed).
        this.updateTooltip();
    }

    /**
     * Appends the collapse button's element to the gutter element once the DOM
     * node exists.
     *
     * @param element - Optional element passed from the framework init chain.
     */
    protected init(element?: HTMLElement): this {
        super.init(element);

        const el = element || this.getElement();

        if (!el) {
            return this;
        }

        DOM.sink.appendChild(el, this._collapseButton.getElement(true)!);

        return this;
    }

    /**
     * Returns whether the gutter carries a collapse chevron.
     *
     * @returns True when the collapse button is shown.
     */
    isCollapsible(): boolean {
        return this._collapsible;
    }

    /**
     * Shows or hides the gutter's collapse chevron.
     *
     * @param value - True to show the collapse button, false to hide it.
     * @returns This gutter, for method chaining.
     */
    setCollapsible(value: boolean): this {
        this._collapsible = value;

        this._collapseButton?.setVisible(value);

        return this;
    }

    /**
     * Applies a {@link SplitGutterOptions} bag, dispatching the gutter
     * orientation after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: SplitGutterOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as SplitGutterOptions;

        if (opts.orientation !== undefined) {
            this.setDirection(opts.orientation);
        }

        if (opts.collapsible !== undefined) {
            this.setCollapsible(opts.collapsible);
        }

        if (opts.movable !== undefined) {
            this.setMovable(opts.movable);
        }

        return this;
    }

    /**
     * Returns whether the gutter wires drag-to-resize.
     *
     * @returns True when the gutter is draggable.
     */
    isMovable(): boolean {
        return this._movable;
    }

    /**
     * Records whether the gutter is draggable. The actual `mousedown` drag
     * wiring is established once in the constructor from this flag (a fixed
     * Border gutter never wires it); this setter seeds the cached value during
     * the options cascade.
     *
     * @param value - True for a draggable gutter, false for a fixed one.
     * @returns This gutter, for method chaining.
     */
    setMovable(value: boolean): this {
        this._movable = value;

        return this;
    }

    /**
     * Returns whether the gutter is painting the opaque collapse-strip fill.
     *
     * @returns True in the collapsed strip state.
     */
    isOpaque(): boolean {
        return this._opaque;
    }

    /**
     * Toggles the gutter between its divider and collapsed-strip appearance.
     * `true` paints the opaque collapse-strip fill and flips the chevron to the
     * restore heading; `false` restores the expanded background and the
     * collapse heading.
     *
     * @param value - True for the collapsed strip state, false for the divider state.
     * @returns This gutter, for method chaining.
     */
    setOpaque(value: boolean): this {
        this._opaque = value;

        if (value) {
            // Collapsed: the strip reads as a themed button surface (the same
            // fill and border the framework's buttons use), inviting a click to
            // restore. `--ts-ui-button-bg` is a solid colour in some themes and
            // a gradient in others, so set both background properties to it —
            // the browser ignores whichever is type-invalid for the given theme.
            this.setBackgroundColor("var(--ts-ui-button-bg, #e8e8e8)");
            this.setBackgroundImage("var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))");
            this.setBorder("1px solid var(--ts-ui-button-border, #c8c8c8)");
            this._collapseButton?.setDirection(OPPOSITE_DIRECTION[this._collapseDirection]);
        } else {
            this.clearBackgroundImage();
            this.clearBorder();
            this.setBackgroundColor(this._expandedBackground);
            this._collapseButton?.setDirection(this._collapseDirection);
        }

        // Collapsed, the restore handle fills the strip's full width; expanded,
        // it shrinks back to the narrow grip.
        this._collapseButton?.setStripMode(value);

        // The collapsed strip cannot be dragged (see `onDragStart`), so it must
        // not advertise a resize cursor either.
        this.applyCursor();

        // The hover hint flips between "collapse" and "expand".
        this.updateTooltip();

        return this;
    }

    /**
     * Returns the chevron's collapse heading.
     *
     * @returns The direction the chevron points (and the gutter travels) on collapse.
     */
    getCollapseDirection(): CollapseDirection {
        return this._collapseDirection;
    }

    /**
     * Sets the chevron's collapse heading — the way it points in the divider
     * state and the way the gutter travels on collapse. The restore heading is
     * its opposite. Re-applies the chevron for the current opaque state.
     *
     * @param direction - The collapse heading.
     * @returns This gutter, for method chaining.
     */
    setCollapseDirection(direction: CollapseDirection): this {
        this._collapseDirection = direction;

        this._collapseButton?.setDirection(this._opaque ? OPPOSITE_DIRECTION[direction] : direction);
        this.updateTooltip();

        return this;
    }

    /**
     * Refreshes the hover tooltip on the gutter and its chevron to describe the
     * double-click action for the current state: which way the gutter will
     * collapse when expanded, or that it will expand back when collapsed. Both
     * the gutter body (hovered on a draggable `Split` divider) and the chevron
     * handle (the always-visible grip) carry it. No-op when the text is
     * unchanged so repeated layouts don't re-wire the hover listeners.
     */
    private updateTooltip(): void {
        const action    = this._opaque ? "expand" : "collapse";
        const direction = this._opaque ? OPPOSITE_DIRECTION[this._collapseDirection] : this._collapseDirection;
        const text      = `Double-click to ${action} ${direction}ward`;

        if (text === this._tooltipText) {
            return;
        }

        this._tooltipText = text;

        Tooltip.attach(this, text);

        if (this._collapseButton) {
            Tooltip.attach(this._collapseButton, text);
        }
    }

    /**
     * Returns the gutter's split direction: 'horizontal' or 'vertical'.
     *
     * @returns The current direction string.
     */
    getDirection() {
        return this._direction;
    }

    /**
     * Sets the split direction, defaulting to 'horizontal' if not provided.
     *
     * @param direction - Optional. "horizontal" or "vertical". Defaults to "horizontal".
     */
    setDirection(direction?: String) : this {
        if (!direction) {
            direction = "horizontal";
        }

        this._direction = direction;

        return this;
    }

    /**
     * Registers a listener for one of this gutter's events.
     *
     * @param event - `"dragstart"` fires on mousedown, receiving the absolute
     *   pointer coordinate (`clientX`/`clientY`) in the gutter's drag axis at
     *   the moment the drag begins; `"drag"` fires on each mousemove/touchmove
     *   during a drag, receiving the absolute pointer coordinate in that axis;
     *   `"collapse"` fires when the gutter's chevron is double-clicked.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This gutter, for method chaining.
     */
    on(event: "dragstart",       listener: (position: number) => void): this;
    on(event: "drag",            listener: (position: number) => void): this;
    on(event: "collapse",        listener: () => void): this;
    on(event: SplitGutterEvent,  listener: Function): this {
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
     * @returns This gutter, for method chaining.
     */
    off(event: SplitGutterEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event` with `payload`, in
     * registration order.
     *
     * @param event - The event to emit.
     * @param payload - Forwarded to each listener.
     */
    protected emit(event: "dragstart",       position: number): void;
    protected emit(event: "drag",            position: number): void;
    protected emit(event: "collapse"): void;
    protected emit(event: SplitGutterEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Removes the mousedown listener and tears down the collapse button.
     */
    destroy() {
        Event.removeListener(this, 'mousedown', this.onDragStart);

        this._collapseButton?.destroy();
    }

    /**
     * Internal mousemove/touchmove dispatch — fires the `drag` event with the
     * absolute pointer coordinate in the gutter's drag axis.
     *
     * @param position - The absolute pointer coordinate (`clientX`/`clientY`)
     *   in the relevant axis for this drag event.
     */
    private _dispatchDrag(position: number): void {
        this.emit("drag", position);
    }

    /**
     * Attaches viewport mouse/touch move and stop listeners, disables body
     * pointer events, and fires the `dragstart` event with the absolute pointer
     * coordinate so the consumer can capture its drag origin.
     *
     * @param evnt - The mousedown event; its `clientX`/`clientY` seeds the
     *   drag origin in the gutter's axis.
     */
    onDragStart(evnt: MouseEvent) {
        // A gutter in its collapsed strip state is not a resize handle — the
        // pane behind it is hidden, so a drag would corrupt its stored size.
        if (this._opaque) {
            return;
        }

        const position = this._direction === "horizontal" ? evnt.clientX : evnt.clientY;

        this.emit("dragstart", position);

        Event.addViewportListener(this, 'mouseup', this.onDragStop);
        Event.addViewportListener(this, 'touchend', this.onDragStop);
        Event.addViewportListener(this, 'touchcancel', this.onDragStop);
        Event.addViewportListener(this, 'mousemove', this.onDrag);
        Event.addViewportListener(this, 'touchmove', this.onDrag);

        // Suppresses pointer events on document.body (not a Component) for the
        // duration of the drag so the cursor can't snag on other elements.
        // eslint-disable-next-line local/no-element-style -- raw document.body, no Component setter applies
        Util.select("body").style.pointerEvents = "none";
    }

    /**
     * Removes viewport listeners and restores body pointer events when drag ends.
     */
    onDragStop() {
        Event.removeViewportListener(this, 'mouseup', this.onDragStop);
        Event.removeViewportListener(this, 'touchend', this.onDragStop);
        Event.removeViewportListener(this, 'touchcancel', this.onDragStop);
        Event.removeViewportListener(this, 'mousemove', this.onDrag);
        Event.removeViewportListener(this, 'touchmove', this.onDrag);

        // Restores pointer events on document.body (not a Component) once the drag ends.
        // eslint-disable-next-line local/no-element-style -- raw document.body, no Component setter applies
        Util.select("body").style.pointerEvents = "";
    }

    /**
     * Extracts the absolute pointer coordinate from the mouse event and fires
     * all drag listeners.
     *
     * @param evnt - The MouseEvent from which clientX or clientY is read.
     */
    onDrag(evnt: MouseEvent) {
        let position;
        if (this._direction === "horizontal") {
            position = evnt.clientX;
        } else {
            position = evnt.clientY;
        }

        this._dispatchDrag(position);
    }

    /**
     * Applies the hover cursor for the gutter's current state. Only a movable
     * gutter in its divider state shows the axis resize cursor; a fixed Border
     * gutter, or a gutter in its collapsed strip state (which cannot be
     * dragged), shows the default cursor so it doesn't invite a resize.
     */
    private applyCursor(): void {
        if (this._movable && !this._opaque) {
            this.setCursor(this._direction == "horizontal" ? "ew-resize" : "ns-resize");
        } else {
            this.setCursor("default");
        }
    }

    /**
     * Renders the gutter element and sets the appropriate resize cursor.
     *
     * @returns The created element with the correct resize cursor applied.
     */
    render() {
        let element = super.render();

        this.applyCursor();

        return element;
    }
}

const SplitGutterCallable = callable(SplitGutter);
type SplitGutterCallable = SplitGutter;
export {
    SplitGutter         as _SplitGutter,
    SplitGutterCallable as SplitGutter
};
