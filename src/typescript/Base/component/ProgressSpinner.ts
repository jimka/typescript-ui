// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";
import { CSS } from "../CSS.js";
import { Position } from "../Position.js";
import { BorderStyle } from "../BorderStyle.js";

CSS.ensureKeyframes(
    'ts-ui-progress-spinner-rotate',
    'from { transform: rotate(0deg); } to { transform: rotate(360deg); }'
);

const ARC_BORDER_WIDTH = 3;

/**
 * A circular loading indicator rendered as a rotating arc.
 *
 * Supports two usage modes:
 * - **Inline**: instantiate, size, and add to a parent like any other component.
 * - **Overlay**: call {@link showOverlay} to mount the spinner as an absolute
 *   overlay over a target component, complete with a semi-transparent backdrop.
 *   {@link hideOverlay} removes it.
 *
 * @category Components
 */
export class ProgressSpinner extends Component {

    private arc: Component;
    private size: number;
    private overlayTarget: Component | null = null;

    /**
     * Constructs a ProgressSpinner.
     *
     * @param size - Diameter in pixels of the arc when used inline. Defaults to 32.
     */
    constructor(size: number = 32) {
        super();

        this.size = size;

        this.arc = new Component();
        this.arc.setPosition(Position.ABSOLUTE);
        this.arc.setBorderRadius("50%");
        this.arc.setBorder({
            style: BorderStyle.SOLID,
            width: ARC_BORDER_WIDTH,
            color: "var(--ts-ui-progress-spinner-color, rgb(30, 100, 200))",
            top  : { style: BorderStyle.SOLID, width: ARC_BORDER_WIDTH, color: "transparent" },
        });
        this.arc.setElementCSSRule("animation", "ts-ui-progress-spinner-rotate 0.8s linear infinite");

        super.addComponent(this.arc);

        this.setPreferredSize(size, size);

        this.getAria().setRole("status");
        this.getAria().setLabel("Loading");
    }

    /**
     * Returns the spinner arc diameter in pixels.
     *
     * @returns The diameter.
     */
    getSpinnerSize(): number {
        return this.size;
    }

    /**
     * Sets a new arc diameter and updates the component's preferred size.
     *
     * @param size - Diameter in pixels.
     */
    setSpinnerSize(size: number): void {
        if (this.size === size) {
            return;
        }

        this.size = size;
        this.setPreferredSize(size, size);
        this.scheduleLayout();
    }

    /**
     * Mounts this ProgressSpinner as an absolute overlay covering the given component.
     *
     * The spinner element is appended directly to the target's DOM element (bypassing
     * the target's layout manager, mirroring how `Window` mounts itself onto
     * `document.documentElement`). Sized to the target's full bounds with a
     * semi-transparent backdrop and the spinning arc centred inside it. No-op if
     * already shown as an overlay.
     *
     * @param target - The component to overlay.
     */
    showOverlay(target: Component): void {
        if (this.overlayTarget) {
            return;
        }

        this.overlayTarget = target;

        this.setPosition(Position.ABSOLUTE);
        this.setBackgroundColor("var(--ts-ui-progress-spinner-backdrop, rgba(255, 255, 255, 0.6))");
        this.setZIndex(9999);

        const targetEl  = target.getElement(true);
        const spinnerEl = this.getElement(true);

        targetEl.appendChild(spinnerEl);

        this.setX(0);
        this.setY(0);
        this.setSize({ width: target.getWidth(), height: target.getHeight() });
        this.doLayout();
    }

    /**
     * Removes the overlay from its target and resets state. No-op if not currently shown
     * as an overlay.
     */
    hideOverlay(): void {
        if (!this.overlayTarget) {
            return;
        }

        this.overlayTarget = null;

        this.removeElement();

        this.setBackgroundColor(null);
        this.setZIndex(0);
    }

    /**
     * Returns whether the spinner is currently mounted as an overlay.
     *
     * @returns True if showOverlay has been called and hideOverlay has not.
     */
    isOverlay(): boolean {
        return this.overlayTarget !== null;
    }

    /**
     * Lays out the inner arc element at the centre of the component bounds.
     */
    doLayout(): void {
        if (this.overlayTarget) {
            this.setSize({ width: this.overlayTarget.getWidth(), height: this.overlayTarget.getHeight() });
        }

        const inner = this.getInnerSize();
        if (!inner) {
            super.doLayout();
            return;
        }

        const diameter = Math.min(this.size, inner.width, inner.height);
        const x        = Math.round((inner.width  - diameter) / 2);
        const y        = Math.round((inner.height - diameter) / 2);

        this.arc.setX(x);
        this.arc.setY(y);
        this.arc.setSize({ width: diameter, height: diameter });

        super.doLayout();
    }
}
