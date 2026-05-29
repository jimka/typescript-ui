// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { Util } from "~/core/Util.js";
import { callable } from "~/core/Callable.js";

/**
 * String-literal union of the events emitted by {@link SplitGutter}.
 *
 * @category Components
 */
export type SplitGutterEvent = "drag";

/**
 * Construction-time options for {@link SplitGutter}.
 *
 * @category Components
 */
export interface SplitGutterOptions extends ComponentOptions {
    orientation?: string;
    /**
     * Multi-event listener bag dispatched to {@link SplitGutter.on} at
     * construction time.
     */
    listeners?: {
        drag?: (movement: number) => void;
    };
}

/**
 * Class-level defaults. `orientation` rides the cascade so the `declare`-d
 * `_direction` backing field is seeded by `setDirection` during super(),
 * dodging the class-field super-cascade trap.
 */
const _defaultSplitGutterOptions: Partial<SplitGutterOptions> = {
    orientation: "horizontal",
};

/**
 * A draggable gutter component used to resize split panels.
 *
 * Listens for mouse/touch drag events on the viewport and notifies registered drag
 * listeners with the pixel delta on each move. Disables body pointer events during
 * a drag to prevent text selection.
 *
 * @category Components
 */
class SplitGutter extends Component<SplitGutterOptions> {

    declare private _direction: String;
    private _listeners: ListenerBag<SplitGutterEvent> = new ListenerBag<SplitGutterEvent>();

    constructor(direction: String, options?: SplitGutterOptions) {
        super(options, _defaultSplitGutterOptions);

        this.setBackgroundColor("var(--ts-ui-gutter-bg, #AAAAAA)");

        // Pre-migration the trailing applyOptions(options) ran *after* the
        // body's positional assignment, so a caller-supplied `orientation`
        // option won. Apply the positional only when the caller did not
        // supply orientation, preserving the option-wins-over-positional
        // contract.
        if (direction && options?.orientation === undefined) {
            this._direction = direction;
        }

        Event.addListener(this, 'mousedown', this.onDragStart);
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

        if (opts.listeners?.drag !== undefined) {
            this.on("drag", opts.listeners.drag);
        }

        return this;
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
     * @param event - `"drag"` fires on each mousemove/touchmove during a
     *   drag, receiving the pixel delta in the gutter's drag axis.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This gutter, for method chaining.
     */
    on(event: "drag",            listener: (movement: number) => void): this;
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
    protected emit(event: "drag",            movement: number): void;
    protected emit(event: SplitGutterEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * @deprecated Use `on("drag", fn)`.
     *
     * @param listener - The callback invoked with the pixel delta on each mousemove/touchmove.
     *
     * @returns This gutter, for method chaining.
     */
    addDragListener(listener: Function) : this {
        return this.on("drag", listener as (movement: number) => void);
    }

    /**
     * @deprecated Use `off("drag", fn)`.
     *
     * @param listener - The callback to remove.
     *
     * @returns This gutter, for method chaining.
     */
    removeDragListener(listener: Function) : this {
        return this.off("drag", listener);
    }

    /**
     * Removes the mousedown listener.
     */
    destroy() {
        Event.removeListener(this, 'mousedown', this.onDragStart);
    }

    /**
     * Internal mousemove/touchmove dispatch — fires the `drag` event with
     * the pixel movement amount.
     *
     * @param movement - The pixel delta in the relevant axis for this drag event.
     */
    private _dispatchDrag(movement: number): void {
        this.emit("drag", movement);
    }

    /**
     * Attaches viewport mouse/touch move and stop listeners and disables body pointer events.
     */
    onDragStart() {
        Event.addViewportListener(this, 'mouseup', this.onDragStop);
        Event.addViewportListener(this, 'touchend', this.onDragStop);
        Event.addViewportListener(this, 'touchcancel', this.onDragStop);
        Event.addViewportListener(this, 'mousemove', this.onDrag);
        Event.addViewportListener(this, 'touchmove', this.onDrag);

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

        Util.select("body").style.pointerEvents = "";
    }

    /**
     * Extracts the movement amount from the mouse event and fires all drag listeners.
     *
     * @param evnt - The MouseEvent from which movementX or movementY is read.
     */
    onDrag(evnt: MouseEvent) {
        let movement;
        if (this._direction === "horizontal") {
            movement = evnt.movementX;
        } else {
            movement = evnt.movementY;
        }

        this._dispatchDrag(movement);
    }

    /**
     * Renders the gutter element and sets the appropriate resize cursor.
     *
     * @returns The created element with the correct resize cursor applied.
     */
    render() {
        let element = super.render();

        this.setCursor(this._direction == "horizontal" ? "ew-resize" : "ns-resize");

        return element;
    }
}

const SplitGutterCallable = callable(SplitGutter);
type SplitGutterCallable = SplitGutter;
export {
    SplitGutter         as _SplitGutter,
    SplitGutterCallable as SplitGutter
};
