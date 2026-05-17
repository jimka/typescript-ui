// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Util } from "~/core/Util.js";
import { Event } from "~/core/Event.js";
import { callable } from "~/core/Callable.js";

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
}

/**
 * A resizable window border strip component.
 *
 * Each instance represents one edge or corner of a resizable window. It listens for
 * mouse/touch drag events and notifies registered listeners with the mouse event so
 * the parent window can compute and apply the new size.
 *
 * @category Components
 */
class WindowBorder extends Component {

    private _direction: Direction = Direction.NORTH;
    private _dragListeners: Function[] = [];
    private _dragStartListener: Function;
    private _dragStopListener: Function;
    private _fireDragListener: Function;

    constructor(direction: Direction, options?: WindowBorderOptions) {
        super({ tag: "div" });

        if (direction) {
            this._direction = direction;
        }

        this._dragStartListener = this.onDragStart.bind(this);
        this._dragStopListener = this.onDragStop.bind(this);
        this._fireDragListener = this.fireDragListeners.bind(this);

        Event.addListener(this, 'mousedown', this._dragStartListener);

        if (options) {
            this.applyOptions(options);
        }
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
     * Registers a listener to receive drag events with (border, mouseEvent) arguments.
     *
     * @param listener - The callback invoked with this WindowBorder and the MouseEvent on each drag.
     */
    addDragListener(listener: Function) : this {
        this._dragListeners.push(listener);

        return this;
    }

    /**
     * Removes a previously registered drag listener.
     *
     * @param listener - The callback to remove.
     */
    removeDragListener(listener: Function) : this {
        let idx = this._dragListeners.indexOf(listener);
        if (idx < 0) {
            return this;
        }

        this._dragListeners.push(listener);

        return this;
    }

    /**
     * Invokes all registered drag listeners with this border and the mouse event.
     *
     * @param e - The MouseEvent to pass to each listener.
     */
    fireDragListeners(e: MouseEvent) {
        let me = this;

        for (let idx in this._dragListeners) {
            let dragListener = this._dragListeners[idx];

            dragListener(me, e);
        }
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
            element.style.cursor = cursor;
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
