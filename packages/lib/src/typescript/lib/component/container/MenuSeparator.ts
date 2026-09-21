// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { BorderOptions } from "~/primitive/Border.js";
import { ComponentOptions } from "~/core/Component.js";
import type { MenuItemCSSVarPrefix } from "~/component/container/MenuItem.js";
import { MenuRow } from "~/component/container/MenuRow.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link MenuSeparator}.
 *
 * @category Components
 */
export interface MenuSeparatorOptions extends ComponentOptions {
}

/**
 * User-overridable default fill; a caller-supplied `backgroundColor` wins.
 */
const _defaultMenuSeparatorOptions: Partial<MenuSeparatorOptions> = {
    backgroundColor: "transparent",
};

/**
 * The rule each `cssVarPrefix` family paints, one frozen module-level spec per
 * prefix. Module-level rather than built per instance so each object's identity
 * stays stable, which is what the shared class-defaults cache compares.
 */
const SEPARATOR_BORDERS: Readonly<Record<MenuItemCSSVarPrefix, BorderOptions>> = Object.freeze({
    "menu-bar":     { borderTop: "1px solid var(--ts-ui-menu-bar-separator-color, rgb(220, 220, 220))" },
    "context-menu": { borderTop: "1px solid var(--ts-ui-context-menu-separator-color, rgb(220, 220, 220))" },
});

/**
 * A horizontal separator rule used inside a [`Menu`](/api/overlay/classes/Menu) panel to visually group menu items.
 *
 * Renders as a thin border line. Width is set externally by `Menu.doLayout()`.
 * The rule is a real border rather than a raw CSS rule write, so it is
 * measurable — a caller reading the separator's border size sees the pixel it
 * takes out of the content box.
 *
 * @category Components
 */
class MenuSeparator extends MenuRow<MenuSeparatorOptions> {

    /** Fixed pixel height of every separator. */
    static readonly HEIGHT: number = 9;

    /**
     * Constructs a MenuSeparator with a thin horizontal rule appearance.
     *
     * @param cssVarPrefix - Selects which CSS-variable family supplies the border colour. Defaults to `'menu-bar'`.
     * @param options - Optional construction options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(
        cssVarPrefix:      MenuItemCSSVarPrefix = "menu-bar",
        options?:          MenuSeparatorOptions,
        subclassDefaults?: Partial<MenuSeparatorOptions>,
    ) {
        super(options, {
            ..._defaultMenuSeparatorOptions,
            border: SEPARATOR_BORDERS[cssVarPrefix],
            ...(subclassDefaults ?? {}),
        });

        this.setHeight(MenuSeparator.HEIGHT);
        this.setPreferredSize({ width: 0, height: MenuSeparator.HEIGHT });
        this.setElementCSSRule("margin", "4px 0");
        this.getAria().setRole("separator");
    }

    /**
     * Returns `true` — a `MenuSeparator` is always a separator row.
     *
     * @returns `true`.
     */
    isSeparator(): boolean {
        return true;
    }
}

const MenuSeparatorCallable = callable(MenuSeparator);
type MenuSeparatorCallable = MenuSeparator;
export {
    MenuSeparator         as _MenuSeparator,
    MenuSeparatorCallable as MenuSeparator
};
