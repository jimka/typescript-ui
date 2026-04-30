// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";
import { Event } from "../Event.js";
import { Util } from "../Util.js";

/**
 * A draggable gutter component used to resize split panels.
 *
 * Listens for mouse/touch drag events on the viewport and notifies registered drag
 * listeners with the pixel delta on each move. Disables body pointer events during
 * a drag to prevent text selection.
 */
export class SplitGutter extends Component {

    private direction: String;
    private dragListeners: Array<Function>;

    constructor(direction: String) {
        super();

        this.setBackgroundColor("var(--ts-ui-gutter-bg, #AAAAAA)");
        this.direction = direction || "horizontal";
        this.dragListeners = [];

        Event.addListener(this, 'mousedown', this.onDragStart);
    }

    /**
     * Returns the gutter's split direction: 'horizontal' or 'vertical'.
     *
     * @returns The current direction string.
     */
    getDirection() {
        return this.direction;
    }

    /**
     * Sets the split direction, defaulting to 'horizontal' if not provided.
     *
     * @param direction - Optional. "horizontal" or "vertical". Defaults to "horizontal".
     */
    setDirection(direction?: String) {
        if (!direction) {
            direction = "horizontal";
        }

        this.direction = direction;
    }

    /**
     * Registers a listener to receive the pixel movement amount on each drag event.
     *
     * @param listener - The callback invoked with the pixel delta on each mousemove/touchmove.
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

        this.dragListeners.splice(idx, 1);
    }

    /**
     * Removes event listeners and clears the drag listener list.
     */
    destroy() {
        Event.removeListener(this, 'mousedown', this.onDragStart);
        this.dragListeners = [];
    }

    /**
     * Invokes all registered drag listeners with the pixel movement amount.
     *
     * @param movement - The pixel delta in the relevant axis for this drag event.
     */
    fireDragListeners(movement: number) {
        for (let idx in this.dragListeners) {
            let dragListener = this.dragListeners[idx];

            dragListener(movement);
        }
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
        if (this.direction === "horizontal") {
            movement = evnt.movementX;
        } else {
            movement = evnt.movementY;
        }

        this.fireDragListeners(movement);
    }

    /**
     * Renders the gutter element and sets the appropriate resize cursor.
     *
     * @returns The created element with the correct resize cursor applied.
     */
    render() {
        let element = super.render();

        element.style.cursor = this.direction == "horizontal" ? "ew-resize" : "ns-resize";

        return element;
    }
}