import { Component } from "../Component.js";
import { Event } from "../Event.js";
import { Util } from "../Util.js";

export class SplitGutter extends Component {

    private direction: String;
    private dragListeners: Array<Function>;

    constructor(direction: String) {
        super("div");

        this.setBackgroundColor("#AAAAAA");
        this.direction = direction || "horizontal";
        this.dragListeners = [];

        Event.addListener(this, 'mousedown', this.onDragStart);
    }

    getDirection() {
        return this.direction;
    }

    setDirection(direction?: String) {
        if (!direction) {
            direction = "horizontal";
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

    fireDragListeners(movement: number) {
        for (let idx in this.dragListeners) {
            let dragListener = this.dragListeners[idx];

            dragListener(movement);
        }
    }

    onDragStart() {
        Event.addViewportListener(this, 'mouseup', this.onDragStop);
        Event.addViewportListener(this, 'touchend', this.onDragStop);
        Event.addViewportListener(this, 'touchcancel', this.onDragStop);
        Event.addViewportListener(this, 'mousemove', this.onDrag);
        Event.addViewportListener(this, 'touchmove', this.onDrag);

        Util.select("body").style.pointerEvents = "none";
    }

    onDragStop() {
        Event.removeViewportListener(this, 'mouseup', this.onDragStop);
        Event.removeViewportListener(this, 'touchend', this.onDragStop);
        Event.removeViewportListener(this, 'touchcancel', this.onDragStop);
        Event.removeViewportListener(this, 'mousemove', this.onDrag);
        Event.removeViewportListener(this, 'touchmove', this.onDrag);

        Util.select("body").style.pointerEvents = "";
    }

    onDrag(evnt: MouseEvent) {
        let movement;
        if (this.direction === "horizontal") {
            movement = evnt.movementX;
        } else {
            movement = evnt.movementY;
        }

        this.fireDragListeners(movement);
    }

    render() {
        let element = super.render();

        element.style.cursor = this.direction == "horizontal" ? "ew-resize" : "ns-resize";

        return element;
    }
}