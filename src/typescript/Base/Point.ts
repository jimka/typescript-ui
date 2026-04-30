// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { BaseObject } from "./BaseObject.js";

/**
 * Represents a two-dimensional point with x and y coordinates.
 */
export class Point extends BaseObject {
    private x: number;
    private y: number;

    /**
     * @param x - The x coordinate.
     * @param y - The y coordinate.
     */
    constructor(x: number, y: number) {
        super();

        this.x = x || 0;
        this.y = y || 0;

    }

    /**
     * Returns the x coordinate.
     *
     * @returns The x coordinate value, defaulting to `0` if unset.
     */
    getX() {
        return this.x || 0;
    }

    /**
     * Returns the y coordinate.
     *
     * @returns The y coordinate value, defaulting to `0` if unset.
     */
    getY() {
        return this.y || 0;
    }

    /**
     * Returns the point as a space-separated `"x y"` string.
     *
     * @returns A string of the form `"<x> <y>"`.
     */
    render() {
        return this.getX() + " " + this.getY();
    }
}
