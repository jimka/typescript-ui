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
class Legend extends Text<LegendOptions> {

    constructor(options?: LegendOptions) {
        // `position` and `tag` are structural — the legend only renders inside
        // its fieldset's border when positioned statically, and the element
        // type is by definition `<legend>`. Both go after the consumer spread
        // so they can't be overridden.
        super(undefined, {
            ...(options ?? {}),
            tag:      "legend",
            position: Position.STATIC,
        });
    }
}

const LegendCallable = callable(Legend);
type LegendCallable = Legend;
export {
    Legend         as _Legend,
    LegendCallable as Legend
};
