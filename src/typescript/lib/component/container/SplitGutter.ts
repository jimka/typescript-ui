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
export type SplitGutterEvent = "dragstart" | "drag";

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
        dragstart?: (position: number) => void;
        drag?:      (position: number) => void;
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
 * listeners with the absolute pointer coordinate (`clientX`/`clientY`) in the gutter's
 * drag axis on each move. Disables body pointer events during a drag to prevent text
 * selection.
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

        // Listener wiring runs here — NOT inside `applyOptions` — because
        // Component's constructor calls `applyOptions` from inside super(),
        // before the class-field `_listeners` initializer has run. Wiring
        // after super() guarantees `_listeners` exists.
        if (options?.listeners?.dragstart !== undefined) {
            this.on("dragstart", options.listeners.dragstart);
        }

        if (options?.listeners?.drag !== undefined) {
            this.on("drag", options.listeners.drag);
        }
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
     * @param event - `"dragstart"` fires on mousedown, receiving the absolute
     *   pointer coordinate (`clientX`/`clientY`) in the gutter's drag axis at
     *   the moment the drag begins; `"drag"` fires on each mousemove/touchmove
     *   during a drag, receiving the absolute pointer coordinate in that axis.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This gutter, for method chaining.
     */
    on(event: "dragstart",       listener: (position: number) => void): this;
    on(event: "drag",            listener: (position: number) => void): this;
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
    protected emit(event: SplitGutterEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Removes the mousedown listener.
     */
    destroy() {
        Event.removeListener(this, 'mousedown', this.onDragStart);
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
        const position = this._direction === "horizontal" ? evnt.clientX : evnt.clientY;

        this.emit("dragstart", position);

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
