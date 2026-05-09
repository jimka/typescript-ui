// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";
import type { MenuItemCSSVarPrefix } from "./MenuItem.js";

/**
 * A horizontal separator rule used inside a `Menu` panel to visually group menu items.
 *
 * Renders as a thin border line. Width is set externally by `Menu.doLayout()`.
 *
 * @category Components
 */
export class MenuSeparator extends Component {

    /** Fixed pixel height of every separator. */
    static readonly HEIGHT: number = 9;

    /**
     * Constructs a MenuSeparator with a thin horizontal rule appearance.
     *
     * @param cssVarPrefix - Selects which CSS-variable family supplies the border colour. Defaults to `'menu-bar'`.
     */
    constructor(cssVarPrefix: MenuItemCSSVarPrefix = "menu-bar") {
        super();

        this.setHeight(MenuSeparator.HEIGHT);
        this.setPreferredSize(0, MenuSeparator.HEIGHT);
        this.setBackgroundColor("transparent");
        this.setElementCSSRule(
            "borderTop",
            `1px solid var(--ts-ui-${cssVarPrefix}-separator-color, rgb(220, 220, 220))`
        );
        this.setElementCSSRule("margin", "4px 0");
        this.getAria().setRole("separator");
    }
}
