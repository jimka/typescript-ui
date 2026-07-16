// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button, ButtonOptions } from "~/component/button/Button.js";
import { DOM } from "~/core/DOM.js";
import { Menu } from "~/overlay/Menu.js";
import { MenuItemConfig } from "~/component/container/MenuItem.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link MenuButton}.
 *
 * @category Components
 */
export interface MenuButtonOptions extends ButtonOptions {
    /** Items for the dropdown, or a provider re-invoked on every open. */
    menuItems?:            MenuItemConfig[] | (() => MenuItemConfig[]);
    /** Open the menu scrolled to the bottom of its item list. Default `false`. */
    scrollToBottomOnShow?: boolean;
}

/**
 * A push button whose click toggles a rebuild-mode dropdown [`Menu`](/api/overlay/classes/Menu)
 * anchored under its bottom-left corner. The menu opens below the button, and
 * flips above it when the room below is short — see
 * [`Menu.toggleFor`](/api/overlay/classes/Menu#togglefor). A provider resolving
 * to an empty item list opens nothing (the click is a no-op beyond the
 * `"action"` event still firing).
 *
 * The dropdown panel is created lazily on first open and reused across opens;
 * `menuItems` accepts either a fixed array or a provider function, and the
 * provider is re-invoked on every open so its output (e.g. relative
 * timestamps, current record counts) is always current.
 *
 * @example
 * ```typescript
 * import { MenuButton } from '@jimka/typescript-ui/component/button';
 *
 * const exportBtn = MenuButton({
 *     glyph:     'file-export',
 *     menuItems: [
 *         { text: 'Export as CSV',  action: () => exportCsv()  },
 *         { text: 'Export as JSON', action: () => exportJson() },
 *     ],
 * });
 * toolbar.addComponent(exportBtn);
 * ```
 *
 * @category Components
 */
class MenuButton<TOptions extends MenuButtonOptions = MenuButtonOptions> extends Button<TOptions> {

    // Lazily created on first open and reused across opens; a rebuild-mode Menu
    // rebuilds its items on every toggle, so a provider's output is always current.
    private _menu: Menu | null = null;

    private readonly _boundToggleMenu: () => void = () => { this.toggleMenu(); };

    /**
     * Constructs a MenuButton with an optional title and options bag (both
     * optional — an empty MenuButton renders as a chrome-shaped placeholder).
     *
     * @example
     * ```typescript
     * new MenuButton('Export', { menuItems: [ … ] });
     * MenuButton({ glyph: 'file-export', menuItems: [ … ] });
     * ```
     */
    constructor(text?: string, options?: TOptions, subclassDefaults?: Partial<TOptions>);
    constructor(options: TOptions);
    constructor(
        textOrOptions?:    string | TOptions,
        options?:          TOptions,
        subclassDefaults?: Partial<TOptions>,
    ) {
        // Normalise the overload: a non-string first argument is the options bag.
        // Copied from Button.ts:437-443 in shape. Legal before super() because it
        // touches no `this` (TS >= 4.6); the field initializers still run after
        // super() returns.
        let text: string | undefined;

        if (typeof textOrOptions === "string") {
            text = textOrOptions;
        } else if (textOrOptions !== undefined) {
            options = textOrOptions;
        }

        super(text, options, subclassDefaults);

        this.on("action", this._boundToggleMenu);

        // Button wires the listener bag only when it is the directly-constructed
        // class; mirror its instance-identity guard so a MenuButton subclass wires
        // its own bag once, from its own constructor.
        if (Object.getPrototypeOf(this) === MenuButton.prototype) {
            this.applyListeners(options?.listeners);
        }
    }

    /**
     * Replaces the configured dropdown items — a fixed array, or a provider
     * re-invoked on every open.
     *
     * @param items - The new item configurations or provider.
     *
     * @returns This button, for method chaining.
     */
    setMenuItems(items: MenuItemConfig[] | (() => MenuItemConfig[])): this {
        this._options.menuItems = items;

        return this;
    }

    /**
     * Returns the configured dropdown items or provider — the caller value,
     * else the class default, else `null` when neither is set.
     *
     * @returns The configured items/provider, or `null`.
     */
    getMenuItems(): MenuItemConfig[] | (() => MenuItemConfig[]) | null {
        return this._options.menuItems ?? this._defaultOptions.menuItems ?? null;
    }

    /**
     * Returns whether the menu opens scrolled to the bottom of its item list —
     * the caller value, else the class default, else `false`.
     *
     * @returns Whether the menu opens scrolled to the bottom.
     */
    isScrollToBottomOnShow(): boolean {
        return this._options.scrollToBottomOnShow ?? this._defaultOptions.scrollToBottomOnShow ?? false;
    }

    /**
     * Applies a {@link MenuButtonOptions} bag, dispatching `menuItems` after
     * the inherited Button fields cascade.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This button, for method chaining.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        if (options.menuItems !== undefined) {
            this.setMenuItems(options.menuItems);
        }

        // No setter: a construction-time-only option read once when the lazy
        // Menu is created, so a pure bag write is all that is needed.
        if (options.scrollToBottomOnShow !== undefined) {
            this._options.scrollToBottomOnShow = options.scrollToBottomOnShow;
        }

        return this;
    }

    /**
     * Toggles the menu anchored under the button's bottom-left corner, flipping
     * above the button when the room below is short. No-op when the button is not
     * yet attached (no anchor rect to read), or when the items resolve to an empty
     * list — `Menu.toggleFor` owns that suppression, so no check is needed here.
     */
    private toggleMenu(): void {
        const el = this.getElement();

        if (!el) {
            return;
        }

        this._menu ??= new Menu().setScrollToBottomOnShow(this.isScrollToBottomOnShow());

        // Items are resolved eagerly as an argument, so a provider re-runs on
        // every toggle — including a toggle that only closes the menu, whose
        // result Menu.toggleFor discards. Keeping toggleFor the single source of
        // truth for open-vs-close is worth that spare provider call; the
        // alternative (asking the menu whether it is open before resolving)
        // reintroduces the open-state desync toggleFor exists to avoid.
        this._menu.toggleFor(el, DOM.source.getViewportRect(this), this.resolveMenuItems());
    }

    /** Resolves the configured items — invoking the provider form on every open. */
    private resolveMenuItems(): MenuItemConfig[] {
        const items = this.getMenuItems();

        if (typeof items === "function") {
            return items();
        }

        return items ?? [];
    }
}

const MenuButtonCallable = callable(MenuButton);
type  MenuButtonCallable<TOptions extends MenuButtonOptions = MenuButtonOptions> = MenuButton<TOptions>;
export {
    MenuButton         as _MenuButton,
    MenuButtonCallable as MenuButton,
};
