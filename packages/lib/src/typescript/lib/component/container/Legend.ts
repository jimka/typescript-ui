// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Text, TextOptions } from "~/component/input/Text.js"
import { Position } from "~/primitive/Position.js";
import { callable } from "~/core/Callable.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";

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

    /** Left inset (px) so the title clears the fieldset's left border corner. */
    private static readonly LEFT_MARGIN = 10;

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. Mirrors the constructor's
    // own `setPosition(Position.STATIC)` call below, so every Legend instance
    // dedupes its position declaration onto the shared `.Legend` class rule
    // instead of repeating it on its own `#id` rule. `marginLeft` overrides
    // the framework rule's zeroed `margin` shorthand so the title clears the
    // fieldset's left border corner instead of hugging it.
    protected static readonly ownClassStyleDefaults: StyleBag = {
        position:   Position.STATIC,
        marginLeft: `${Legend.LEFT_MARGIN}px`,
    };

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
