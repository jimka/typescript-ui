// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { BaseObject } from "~/core/BaseObject.js";

/**
 * Represents the four directional inset (padding/margin) values for a rectangular area.
 * All values are expressed in pixels.
 *
 * @example
 * ```typescript
 * import { Insets } from '@jimka/typescript-ui';
 *
 * component.setInsets(new Insets(8, 12, 8, 12)); // top, right, bottom, left
 * ```
 *
 * @category Util
 */
export class Insets extends BaseObject {

    private top: number;
    private right: number;
    private bottom: number;
    private left: number;

    /**
     * @param top - Top inset in pixels.
     * @param right - Right inset in pixels.
     * @param bottom - Bottom inset in pixels.
     * @param left - Left inset in pixels.
     */
    constructor(top: number, right: number, bottom: number, left: number) {
        super();

        this.top = top || 0;
        this.right = right || 0;
        this.bottom = bottom || 0;
        this.left = left || 0;
    }

    /**
     * Returns the top inset in pixels.
     *
     * @returns The top inset value, defaulting to `0` if unset.
     */
    getTop() {
        return this.top || 0;
    }

    /**
     * Sets the top inset in pixels.
     *
     * @param value - The new top inset value in pixels.
     */
    setTop(value: number) : this {
        this.top = value;

        return this;
    }

    /**
     * Returns the right inset in pixels.
     *
     * @returns The right inset value, defaulting to `0` if unset.
     */
    getRight() {
        return this.right || 0;
    }

    /**
     * Sets the right inset in pixels.
     *
     * @param value - The new right inset value in pixels.
     */
    setRight(value: number) : this {
        this.right = value;

        return this;
    }

    /**
     * Returns the bottom inset in pixels.
     *
     * @returns The bottom inset value, defaulting to `0` if unset.
     */
    getBottom() {
        return this.bottom || 0;
    }

    /**
     * Sets the bottom inset in pixels.
     *
     * @param value - The new bottom inset value in pixels.
     */
    setBottom(value: number) : this {
        this.bottom = value;

        return this;
    }

    /**
     * Returns the left inset in pixels.
     *
     * @returns The left inset value, defaulting to `0` if unset.
     */
    getLeft() {
        return this.left || 0;
    }

    /**
     * Sets the left inset in pixels.
     *
     * @param value - The new left inset value in pixels.
     */
    setLeft(value: number) : this {
        this.left = value;

        return this;
    }

    /**
     * Sets all four inset values at once.
     *
     * @param top - Top inset in pixels.
     * @param right - Right inset in pixels.
     * @param bottom - Bottom inset in pixels.
     * @param left - Left inset in pixels.
     */
    set(top: number, right: number, bottom: number, left: number) : this {
        this.top = top;
        this.right = right;
        this.bottom = bottom;
        this.left = left;

        return this;
    }

    /**
     * Returns the insets as a CSS shorthand string (e.g. `"4px 4px 4px 4px"`).
     *
     * @returns A CSS margin/padding shorthand string with all four sides in top-right-bottom-left order.
     */
    render() {
        return this.getTop() + "px " + this.getRight() + "px " + this.getBottom() + "px " + this.getLeft() + "px";
    }
};
