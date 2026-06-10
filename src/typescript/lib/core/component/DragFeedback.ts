// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Position } from "~/primitive/Position.js";
import { callable } from "~/core/Callable.js";

/**
 * Z-order shared with [`ReorderIndicator`](/api/core/classes/ReorderIndicator).
 * Sits one notch below the ghost (10200) so the per-target tint never
 * occludes the follow-the-cursor preview.
 */
const Z_INDEX = 10199;

/**
 * A validity tint overlay drawn on top of the row currently being hovered
 * during an active drag. The colour swaps between the `valid` and
 * `invalid` theme tokens via {@link setValid}; the geometry is mirrored
 * onto a drop target via {@link attachTo}.
 *
 * Owned by [`DragManager`](/api/core/variables/DragManager) — application
 * code does not instantiate this directly.
 *
 * @category Core
 */
class DragFeedback extends Component {

    private _valid: boolean = true;

    /**
     * Constructs a drag-feedback overlay. The overlay is not attached
     * until {@link attachTo} is called.
     */
    constructor() {
        super();

        this.setPosition(Position.ABSOLUTE);
        this.setZIndex(Z_INDEX);
        this.setPointerEvents("none");

        this.applyTintForValidity();
    }

    /**
     * Returns whether the overlay is currently showing the "valid drop"
     * tint.
     *
     * @returns `true` for the valid tint, `false` for the invalid tint.
     */
    isValid(): boolean {
        return this._valid;
    }

    /**
     * Switches the overlay between the `valid` and `invalid` theme
     * tokens. Idempotent — repeated calls with the same value are a
     * no-op.
     *
     * @param valid - `true` to show the valid tint, `false` for invalid.
     */
    setValid(valid: boolean): void {
        if (this._valid === valid) {
            return;
        }

        this._valid = valid;

        this.applyTintForValidity();
    }

    /**
     * Sizes this overlay to cover the drop target and appends it to the DOM.
     *
     * With no `host`, the tint is a child of the target, covering its body. When
     * a `host` is given, the tint instead lives in that (non-scrolling) layer,
     * sized to the target's box within it — so a target that scrolls its own
     * content (a Tab strip's clip frame) gets a tint over the *viewport* that
     * stays put instead of riding the scroll.
     *
     * @param target - The drop target whose box the tint should cover.
     * @param host - Optional non-scrolling layer to host the tint (see
     *   {@link DropTargetOptions.feedbackHost}). Defaults to the target.
     */
    attachTo(target: Component, host?: Component): void {
        const myEl = this.getElement(true);

        if (host && host !== target) {
            // Overlay the target's box from within the host layer.
            this.setX(target.getX());
            this.setY(target.getY());
            this.setWidth(target.getWidth());
            this.setHeight(target.getHeight());

            const hostEl = host.getElement(true);
            if (myEl.parentElement !== hostEl) {
                hostEl.appendChild(myEl);
            }

            return;
        }

        // Cover the target's own body as a child of it.
        this.setX(0);
        this.setY(0);
        this.setWidth(target.getWidth());
        this.setHeight(target.getHeight());

        const targetEl = target.getElement(true);
        if (myEl.parentElement !== targetEl) {
            targetEl.appendChild(myEl);
        }
    }

    /**
     * Removes the overlay element from the DOM.
     */
    detach(): void {
        this.removeElement();
    }

    /**
     * Writes the background and border CSS variables that correspond to
     * the cached validity state. Called from the constructor and from
     * {@link setValid} on transitions.
     */
    private applyTintForValidity(): void {
        const suffix = this._valid ? "valid" : "invalid";

        this.setBackgroundColor(`var(--ts-ui-drag-feedback-${suffix}-bg)`);
        this.setBorder({ border: `2px solid var(--ts-ui-drag-feedback-${suffix}-border)` });
    }
}

const DragFeedbackCallable = callable(DragFeedback);
type DragFeedbackCallable = DragFeedback;
export {
    DragFeedback         as _DragFeedback,
    DragFeedbackCallable as DragFeedback,
};
