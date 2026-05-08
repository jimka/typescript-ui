// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../Component.js";

/**
 * A horizontal separator rule used inside a `MenuPanel` to visually group menu items.
 *
 * Renders as a thin border line. Width is set externally by `MenuPanel.doLayout()`.
 *
 * @category Components
 */
export class MenuSeparator extends Component {

    /** Fixed pixel height of every separator. */
    static readonly HEIGHT: number = 9;

    /**
     * Constructs a MenuSeparator with a thin horizontal rule appearance.
     */
    constructor() {
        super();

        this.setHeight(MenuSeparator.HEIGHT);
        this.setPreferredSize(0, MenuSeparator.HEIGHT);
        this.setBackgroundColor("transparent");
        this.setElementCSSRule(
            "borderTop",
            "1px solid var(--ts-ui-menu-bar-separator-color, rgb(220, 220, 220))"
        );
        this.setElementCSSRule("margin", "4px 0");
        this.getAria().setRole("separator");
    }
}
