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
        // `tag` is structural — the element type is by definition `<legend>`.
        super(undefined, {
            ...(options ?? {}),
            tag: "legend",
        });

        // `<legend>` only renders inside its fieldset's notch when positioned
        // statically — the framework's "every component is absolute" rule
        // would float the legend out of the border. Documented HTML-semantics
        // exception alongside `FIXED` floating overlays. See
        // ARCHITECTURE.md §Positioning.
        this.setPosition(Position.STATIC);
    }
}

const LegendCallable = callable(Legend);
type LegendCallable = Legend;
export {
    Legend         as _Legend,
    LegendCallable as Legend
};
