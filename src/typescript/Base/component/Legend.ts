// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Text, TextOptions } from "./Text.js"
import { Position } from "../Position.js";

/**
 * Construction-time options for {@link Legend}.
 *
 * @category Components
 */
export interface LegendOptions extends TextOptions {
}

/**
 * A legend component backed by a `<legend>` element.
 *
 * Uses static CSS positioning so the browser can render the title text inside a fieldset border.
 *
 * @category Components
 */
export class Legend extends Text {

    constructor(options?: LegendOptions) {
        super(undefined, { tag: "legend" });

        // Needs to be static for the browser to position the title text properly.
        this.setPosition(Position.STATIC);

        if (options) {
            this.applyOptions(options);
        }
    }
}