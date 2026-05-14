// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button, ButtonOptions } from "~/component/button/Button.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link TabCloseButton}.
 *
 * @category Components
 */
export interface TabCloseButtonOptions extends ButtonOptions {
}

/**
 * A compact close button displaying the `times` glyph, sized to sit flush inside a tab header.
 *
 * @category Components
 */
class TabCloseButton extends Button {

    /**
     * Creates a TabCloseButton seeded with the `times` glyph and sized for use in a tab toolbar.
     */
    constructor(options?: TabCloseButtonOptions) {
        super();

        this.setGlyph("times");

        this.setPreferredSize(16, 16);
        this.setInsets(new Insets(0, 0, 0, 0));
        this.setForegroundColor("var(--ts-ui-close-button-fg, #555)");

        if (options) {
            this.applyOptions(options);
        }
    }
}

const TabCloseButtonCallable = callable(TabCloseButton);
type TabCloseButtonCallable = TabCloseButton;
export {
    TabCloseButton         as _TabCloseButton,
    TabCloseButtonCallable as TabCloseButton
};
