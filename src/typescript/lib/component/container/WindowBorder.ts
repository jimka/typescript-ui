// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Util } from "~/core/Util.js";
import { Event } from "~/core/Event.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";

/**
 * String-literal union of the events emitted by {@link WindowBorder}.
 *
 * @category Components
 */
export type WindowBorderEvent = "drag";

/**
 * The eight edge / corner positions used by {@link WindowBorder} to identify
 * which border strip the user is dragging.
 *
 * @category Components
 */
export enum Direction {
    NORTH,
    SOUTH,
    WEST,
    EAST,
    NORTHWEST,
    SOUTHEAST,
    SOUTHWEST,
    NORTHEAST
}

/**
 * Construction-time options for {@link WindowBorder}.
 *
 * @category Components
 */
export interface WindowBorderOptions extends ComponentOptions {
    /**
     * Multi-event listener bag dispatched to {@link WindowBorder.on} at
     * construction time.
     */
    listeners?: {
        drag?: (border: WindowBorder, e: MouseEvent) => void;
    };
}

/**
 * CSS class added to the DOM element of the currently snap-targeted strip.
 * Kept package-private (`@internal`) — the owning [`Window`](/api/core/classes/Window)
 * toggles it through {@link WindowBorder.setSnapTarget}.
 *
 * @internal
 */
const SNAP_TARGET_CLASS = "snap-target";

/**
 * Class-level defaults forwarded to `super` so the cascade hits Component's
 * applyOptions with `{ tag: "div" }` already merged into `_defaultOptions`.
 */
const _defaultWindowBorderOptions: Partial<WindowBorderOptions> = {
    tag: "div",
};

/**
 * A resizable window border strip component.
 *
 * Each instance represents one edge or corner of a resizable window. It listens for
 * mouse/touch drag events and notifies registered listeners with the mouse event so
 * the parent window can compute and apply the new size.
 *
 * @category Components
 */
class WindowBorder extends Component<WindowBorderOptions> {

    private _direction: Direction = Direction.NORTH;
    private _listeners: ListenerBag<WindowBorderEvent> = new ListenerBag<WindowBorderEvent>();
    private _dragStartListener: Function;
    private _dragStopListener: Function;
    private _fireDragListener: Function;
    private _snapTarget: boolean = false;

    // Lazy `.snap-target` rule. The slot is a fast-path cache for the wrapper
    // returned by Component's `createStyleRule` builder, which dedupes by
    // selector suffix — see Button's `_pressedStyleRule` for the full
    // explanation.
    private declare _snapTargetStyleRule?: StyleRule;
    private get snapTargetStyleRule(): StyleRule {
        return this._snapTargetStyleRule ??= this.createStyleRule("." + SNAP_TARGET_CLASS);
    }

    constructor(direction: Direction, options?: WindowBorderOptions) {
        super(options, _defaultWindowBorderOptions);

        if (direction) {
            this._direction = direction;
        }

        this._dragStartListener = this.onDragStart.bind(this);
        this._dragStopListener = this.onDragStop.bind(this);
        this._fireDragListener = this._dispatchDrag.bind(this);

        Event.addListener(this, 'mousedown', this._dragStartListener);

        if (options?.listeners?.drag !== undefined) {
            this.on("drag", options.listeners.drag);
        }

        // Queue the snap-target highlight into the lazy state rule. Materialises
        // at render time through Component's batched style channel.
        this.snapTargetStyleRule.set("boxShadow", "var(--ts-ui-window-snap-glow, 0 0 0 2px rgba(30, 100, 200, 0.7))");
    }

    /**
     * Returns the resize direction of this border strip.
     *
     * @returns The Direction enum value for this border.
     */
    getDirection() {
        return this._direction;
    }

    /**
     * Sets the resize direction, defaulting to NORTH if not provided.
     *
     * @param direction - The Direction enum value. Defaults to NORTH if falsy.
     */
    setDirection(direction: Direction) : this {
        if (!direction) {
            direction = Direction.NORTH;
        }

        this._direction = direction;

        return this;
    }

    /**
     * Registers a listener for one of this border's events.
     *
     * @param event - `"drag"` fires on each mousemove/touchmove during a
     *   drag, receiving this border and the originating event.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This border, for method chaining.
     */
    on(event: "drag",             listener: (border: WindowBorder, e: MouseEvent) => void): this;
    on(event: WindowBorderEvent,  listener: Function): this {
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
     * @returns This border, for method chaining.
     */
    off(event: WindowBorderEvent, listener: Function): this {
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
    protected emit(event: "drag",            border: WindowBorder, e: MouseEvent): void;
    protected emit(event: WindowBorderEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * @deprecated Use `on("drag", fn)`.
     *
     * @param listener - The callback invoked with this WindowBorder and the MouseEvent on each drag.
     *
     * @returns This border, for method chaining.
     */
    addDragListener(listener: Function) : this {
        return this.on("drag", listener as (b: WindowBorder, e: MouseEvent) => void);
    }

    /**
     * @deprecated Use `off("drag", fn)`.
     *
     * @param listener - The callback to remove.
     *
     * @returns This border, for method chaining.
     */
    removeDragListener(listener: Function) : this {
        return this.off("drag", listener);
    }

    /**
     * Internal mousemove dispatch — fires the `drag` event with this border
     * and the originating mouse event.
     *
     * @param e - The MouseEvent observed by the viewport-mousemove listener.
     */
    private _dispatchDrag(e: MouseEvent): void {
        this.emit("drag", this, e);
    }

    /**
     * Returns whether this border strip is currently flagged as the snap target.
     *
     * @returns True when the snap-target CSS class is applied.
     */
    isSnapTarget(): boolean {
        return this._snapTarget;
    }

    /**
     * Toggles the snap-target CSS class on this strip's DOM element. Called by
     * the owning [`Window`](/api/core/classes/Window) while the snap modifier
     * is held and the cursor is within the configured threshold.
     *
     * @param value - True to highlight this strip as the snap target.
     *
     * @returns This component, for method chaining.
     */
    setSnapTarget(value: boolean): this {
        if (this._snapTarget === value) {
            return this;
        }

        this._snapTarget = value;

        const element = this.getElement();
        if (element) {
            element.classList.toggle(SNAP_TARGET_CLASS, value);
        }

        return this;
    }

    /**
     * Attaches viewport mouse/touch move and stop listeners and disables body pointer events.
     */
    onDragStart() {
        Event.addViewportListener(this, 'mouseup', this._dragStopListener);
        Event.addViewportListener(this, 'touchend', this._dragStopListener);
        Event.addViewportListener(this, 'touchcancel', this._dragStopListener);
        Event.addViewportListener(this, 'mousemove', this._fireDragListener);
        Event.addViewportListener(this, 'touchmove', this._fireDragListener);

        Util.select("body").style.pointerEvents = "none";
    }

    /**
     * Removes viewport listeners and restores body pointer events when drag ends.
     */
    onDragStop() {
        Event.removeViewportListener(this, 'mouseup', this._dragStopListener);
        Event.removeViewportListener(this, 'touchend', this._dragStopListener);
        Event.removeViewportListener(this, 'touchcancel', this._dragStopListener);
        Event.removeViewportListener(this, 'mousemove', this._fireDragListener);
        Event.removeViewportListener(this, 'touchmove', this._fireDragListener);

        Util.select("body").style.pointerEvents = "";

        // Drop the snap-target highlight (if any) once the drag commits, so a
        // subsequent Ctrl-release on the same hover doesn't leave the strip glowing.
        this.setSnapTarget(false);
    }

    /**
     * Renders the border element and sets the appropriate resize cursor based on direction.
     *
     * @returns The created element with the correct resize cursor applied.
     */
    render() {
        let element = super.render();

        let cursor;
        switch (this._direction) {
            case Direction.NORTH:
            case Direction.SOUTH:
                cursor = "ns-resize";
                break;
            case Direction.WEST:
            case Direction.EAST:
                cursor = "ew-resize";
                break;
            case Direction.NORTHWEST:
            case Direction.SOUTHEAST:
                cursor = "nwse-resize";
                break;
            case Direction.SOUTHWEST:
            case Direction.NORTHEAST:
                cursor = "nesw-resize";
                break;
        }

        if (cursor) {
            this.setCursor(cursor);
        }

        if (this._snapTarget) {
            element.classList.add(SNAP_TARGET_CLASS);
        }

        return element;
    }
}

const WindowBorderCallable = callable(WindowBorder);
type WindowBorderCallable = WindowBorder;
export {
    WindowBorder         as _WindowBorder,
    WindowBorderCallable as WindowBorder
};
