// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Text, TextOptions } from "~/component/input/Text.js"
import { Position } from "~/primitive/Position.js";
import { callable } from "~/core/Callable.js";

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
class Legend extends Text {

    constructor(options?: LegendOptions) {
        super(undefined, { tag: "legend" });

        // Needs to be static for the browser to position the title text properly.
        this.setPosition(Position.STATIC);

        if (options) {
            this.applyOptions(options);
        }
    }
}

const LegendCallable = callable(Legend);
type LegendCallable = Legend;
export {
    Legend         as _Legend,
    LegendCallable as Legend
};
