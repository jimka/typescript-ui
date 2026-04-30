// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";
import { Util } from "../Util.js";
import { Event } from "../Event.js";

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
 * A resizable window border strip component.
 *
 * Each instance represents one edge or corner of a resizable window. It listens for
 * mouse/touch drag events and notifies registered listeners with the mouse event so
 * the parent window can compute and apply the new size.
 */
export class WindowBorder extends Component {

    private direction: Direction;
    private dragListeners: Function[];
    private dragStartListener: Function;
    private dragStopListener: Function;
    private fireDragListener: Function;

    constructor(direction: Direction) {
        super("div");

        this.direction = direction || Direction.NORTH;
        this.dragListeners = [];

        this.dragStartListener = this.onDragStart.bind(this);
        this.dragStopListener = this.onDragStop.bind(this);
        this.fireDragListener = this.fireDragListeners.bind(this);

        Event.addListener(this, 'mousedown', this.dragStartListener);
    }

    /**
     * Returns the resize direction of this border strip.
     *
     * @returns The Direction enum value for this border.
     */
    getDirection() {
        return this.direction;
    }

    /**
     * Sets the resize direction, defaulting to NORTH if not provided.
     *
     * @param direction - The Direction enum value. Defaults to NORTH if falsy.
     */
    setDirection(direction: Direction) {
        if (!direction) {
            direction = Direction.NORTH;
        }

        this.direction = direction;
    }

    /**
     * Registers a listener to receive drag events with (border, mouseEvent) arguments.
     *
     * @param listener - The callback invoked with this WindowBorder and the MouseEvent on each drag.
     */
    addDragListener(listener: Function) {
        this.dragListeners.push(listener);
    }

    /**
     * Removes a previously registered drag listener.
     *
     * @param listener - The callback to remove.
     */
    removeDragListener(listener: Function) {
        let idx = this.dragListeners.indexOf(listener);
        if (idx < 0) {
            return;
        }

        this.dragListeners.push(listener);
    }

    /**
     * Invokes all registered drag listeners with this border and the mouse event.
     *
     * @param e - The MouseEvent to pass to each listener.
     */
    fireDragListeners(e: MouseEvent) {
        let me = this;

        for (let idx in this.dragListeners) {
            let dragListener = this.dragListeners[idx];

            dragListener(me, e);
        }
    }

    /**
     * Attaches viewport mouse/touch move and stop listeners and disables body pointer events.
     */
    onDragStart() {
        Event.addViewportListener(this, 'mouseup', this.dragStopListener);
        Event.addViewportListener(this, 'touchend', this.dragStopListener);
        Event.addViewportListener(this, 'touchcancel', this.dragStopListener);
        Event.addViewportListener(this, 'mousemove', this.fireDragListener);
        Event.addViewportListener(this, 'touchmove', this.fireDragListener);

        Util.select("body").style.pointerEvents = "none";
    }

    /**
     * Removes viewport listeners and restores body pointer events when drag ends.
     */
    onDragStop() {
        Event.removeViewportListener(this, 'mouseup', this.dragStopListener);
        Event.removeViewportListener(this, 'touchend', this.dragStopListener);
        Event.removeViewportListener(this, 'touchcancel', this.dragStopListener);
        Event.removeViewportListener(this, 'mousemove', this.fireDragListener);
        Event.removeViewportListener(this, 'touchmove', this.fireDragListener);

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
        switch (this.direction) {
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