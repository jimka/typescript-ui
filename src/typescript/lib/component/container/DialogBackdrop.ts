// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Position } from "~/primitive/Position.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link DialogBackdrop}.
 *
 * @category Components
 */
export interface DialogBackdropOptions extends ComponentOptions {
}

/**
 * Empty subclass-default const so the super call follows the framework's
 * `(options, defaults)` shape uniformly.
 */
const _defaultDialogBackdropOptions: Partial<DialogBackdropOptions> = {};

/**
 * A full-viewport fixed overlay that visually blocks content behind a modal dialog.
 *
 * Appended to `document.documentElement` as a sibling of the dialog panel at a lower
 * z-index, mirroring the pattern used by [`Notification`](/api/core/classes/Notification) and [`Menu`](/api/core/classes/Menu).
 */
class DialogBackdrop extends Component<DialogBackdropOptions> {

    /**
     * Creates the backdrop and applies viewport-filling fixed positioning.
     */
    constructor(options?: DialogBackdropOptions) {
        super(options, _defaultDialogBackdropOptions);

        this.setPosition(Position.FIXED);
        this.setX(0);
        this.setY(0);
        this.setWidth(window.innerWidth);
        this.setHeight(window.innerHeight);
        this.setZIndex(10100);
        this.setBackgroundColor("var(--ts-ui-dialog-backdrop-bg)");
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
