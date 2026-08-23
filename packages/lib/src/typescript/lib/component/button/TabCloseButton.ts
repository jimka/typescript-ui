// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button, ButtonOptions } from "~/component/button/Button.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";
import { Glyph } from "~/component/display/Glyph.js";
import { xmark } from "~/glyphs/solid/xmark.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";

Glyph.register(xmark);

/**
 * Construction-time options for {@link TabCloseButton}.
 *
 * @category Components
 */
export interface TabCloseButtonOptions extends ButtonOptions {
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * Layered on top of [`Button`](/api/component/button/classes/Button)'s own
 * defaults, then overlaid with consumer options before the seed `glyph`
 * pins the close icon.
 */
const _defaultTabCloseButtonOptions: Partial<TabCloseButtonOptions> = {
    preferredSize:   { width: 16, height: 16 },
    insets:          new Insets(0, 0, 0, 0),
    foregroundColor: "var(--ts-ui-close-button-fg, #555)",
};

/**
 * A compact close button displaying the `xmark` glyph, sized to sit flush inside a tab header.
 *
 * @category Components
 */
class TabCloseButton extends Button<TabCloseButtonOptions> {

    // Opts the resting tier into the hierarchy-aware class cascade — see
    // plans/implemented/class-hierarchy-cascade.md. The same constant this
    // class's constructor forwards as part of `subclassDefaults`, exposed at
    // the class level so `.TabCloseButton`'s rule carries only its own
    // deviation from `.Button`'s. The constructor's extra `glyph: "xmark"`
    // key is not hoistable and is correctly absent here.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultTabCloseButtonOptions;

    /**
     * Creates a TabCloseButton seeded with the `xmark` glyph and sized for use in a tab toolbar.
     */
    constructor(options?: TabCloseButtonOptions, subclassDefaults?: Partial<TabCloseButtonOptions>) {
        // The seed `glyph` is in the defaults bag — a caller-supplied
        // `options.glyph` still wins because Button resolves the effective
        // glyph as `options.glyph ?? _defaultOptions.glyph` at construction.
        super(undefined, options, {
            ..._defaultTabCloseButtonOptions,
            glyph: "xmark",
            ...(subclassDefaults ?? {}),
        });
    }
}

const TabCloseButtonCallable = callable(TabCloseButton);
type TabCloseButtonCallable = TabCloseButton;
export {
    TabCloseButton         as _TabCloseButton,
    TabCloseButtonCallable as TabCloseButton
};
