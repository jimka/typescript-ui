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

    getDirection() {
        return this.direction;
    }

    setDirection(direction: Direction) {
        if (!direction) {
            direction = Direction.NORTH;
        }

        this.direction = direction;
    }

    addDragListener(listener: Function) {
        this.dragListeners.push(listener);
    }

    removeDragListener(listener: Function) {
        let idx = this.dragListeners.indexOf(listener);
        if (idx < 0) {
            return;
        }

        this.dragListeners.push(listener);
    }

    fireDragListeners(e: MouseEvent) {
        let me = this;

        for (let idx in this.dragListeners) {
            let dragListener = this.dragListeners[idx];

            dragListener(me, e);
        }
    }

    onDragStart() {
        Event.addViewportListener(this, 'mouseup', this.dragStopListener);
        Event.addViewportListener(this, 'touchend', this.dragStopListener);
        Event.addViewportListener(this, 'touchcancel', this.dragStopListener);
        Event.addViewportListener(this, 'mousemove', this.fireDragListener);
        Event.addViewportListener(this, 'touchmove', this.fireDragListener);

        Util.select("body").style.pointerEvents = "none";
    }

    onDragStop() {
        Event.removeViewportListener(this, 'mouseup', this.dragStopListener);
        Event.removeViewportListener(this, 'touchend', this.dragStopListener);
        Event.removeViewportListener(this, 'touchcancel', this.dragStopListener);
        Event.removeViewportListener(this, 'mousemove', this.fireDragListener);
        Event.removeViewportListener(this, 'touchmove', this.fireDragListener);

        Util.select("body").style.pointerEvents = "";
    }

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