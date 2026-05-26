// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import type { MenuItemCSSVarPrefix } from "~/component/container/MenuItem.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link MenuSeparator}.
 *
 * @category Components
 */
export interface MenuSeparatorOptions extends ComponentOptions {
}

/**
 * Empty subclass-default const so the super call follows the framework's
 * `(options, defaults)` shape uniformly. MenuSeparator owns no class-level
 * option overrides today; the const exists so a future field has a place to
 * land without reshuffling the super call.
 */
const _defaultMenuSeparatorOptions: Partial<MenuSeparatorOptions> = {};

/**
 * A horizontal separator rule used inside a [`Menu`](/api/core/classes/Menu) panel to visually group menu items.
 *
 * Renders as a thin border line. Width is set externally by `Menu.doLayout()`.
 *
 * @category Components
 */
class MenuSeparator extends Component<MenuSeparatorOptions> {

    /** Fixed pixel height of every separator. */
    static readonly HEIGHT: number = 9;

    /**
     * Constructs a MenuSeparator with a thin horizontal rule appearance.
     *
     * @param cssVarPrefix - Selects which CSS-variable family supplies the border colour. Defaults to `'menu-bar'`.
     */
    constructor(cssVarPrefix: MenuItemCSSVarPrefix = "menu-bar", options?: MenuSeparatorOptions) {
        super(options, _defaultMenuSeparatorOptions);

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

const MenuSeparatorCallable = callable(MenuSeparator);
type MenuSeparatorCallable = MenuSeparator;
export {
    MenuSeparator         as _MenuSeparator,
    MenuSeparatorCallable as MenuSeparator
};
