// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
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
 * z-index, mirroring the pattern used by [`Notification`](/api/overlay/classes/Notification) and [`Menu`](/api/overlay/classes/Menu).
 */
class DialogBackdrop extends Component<DialogBackdropOptions> {

    /**
     * Creates the backdrop and applies viewport-filling fixed positioning.
     */
    constructor(options?: DialogBackdropOptions) {
        super(options, _defaultDialogBackdropOptions);

        const vp = DOM.source.getViewportSize();

        this.setPosition(Position.FIXED);
        this.setX(0);
        this.setY(0);
        this.setWidth(vp.width);
        this.setHeight(vp.height);
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
        const vp = DOM.source.getViewportSize();

        this.setWidth(vp.width);
        this.setHeight(vp.height);
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
