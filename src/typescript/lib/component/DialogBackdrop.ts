// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "../Component.js";
import { Event } from "../Event.js";
import { Position } from "../Position.js";
import { callable } from "../Callable.js";

/**
 * Construction-time options for {@link DialogBackdrop}.
 *
 * @category Components
 */
export interface DialogBackdropOptions extends ComponentOptions {
}

/**
 * A full-viewport fixed overlay that visually blocks content behind a modal dialog.
 *
 * Appended to `document.documentElement` as a sibling of the dialog panel at a lower
 * z-index, mirroring the pattern used by `Notification` and `Menu`.
 */
class DialogBackdrop extends Component {

    /**
     * Creates the backdrop and applies viewport-filling fixed positioning.
     */
    constructor(options?: DialogBackdropOptions) {
        super();

        this.setPosition(Position.FIXED);
        this.setX(0);
        this.setY(0);
        this.setWidth(window.innerWidth);
        this.setHeight(window.innerHeight);
        this.setZIndex(10100);
        this.setBackgroundColor("var(--ts-ui-dialog-backdrop-bg)");

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Registers a click listener on this backdrop element.
     *
     * @param listener - Called when the user clicks the backdrop area.
     */
    addClickListener(listener: Function): this {
        Event.addListener(this, "click", listener);

        return this;
    }

    /**
     * Updates backdrop dimensions to match the current viewport size.
     */
    resize(): void {
        this.setWidth(window.innerWidth);
        this.setHeight(window.innerHeight);
    }

    /**
     * Removes the backdrop from the DOM and runs component cleanup.
     */
    destroy(): void {
        this.removeElement();
        this.destructor();
    }
}

const DialogBackdropCallable = callable(DialogBackdrop);
type DialogBackdropCallable = DialogBackdrop;
export {
    DialogBackdrop         as _DialogBackdrop,
    DialogBackdropCallable as DialogBackdrop
};
