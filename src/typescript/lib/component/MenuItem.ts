// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/Component.js";
import { Event } from "~/Event.js";
import { Text } from "~/component/Text.js";
import { callable } from "~/Callable.js";

/**
 * Construction-time component-level options for {@link MenuItem}. Use this
 * for cosmetic/layout overrides on the item row; the menu data (text, action,
 * shortcut, submenu) still comes through {@link MenuItemConfig}.
 *
 * @category Components
 */
export interface MenuItemOptions extends ComponentOptions {
    text?:    string;
    enabled?: boolean;
    focused?: boolean;
}

/**
 * Selects which CSS-variable family a `MenuItem` reads its colours from.
 *
 * `'menu-bar'` resolves to `--ts-ui-menu-bar-item-*` tokens; `'context-menu'`
 * resolves to `--ts-ui-context-menu-item-*` tokens. The `Menu` class chooses
 * the prefix based on its mode.
 */
export type MenuItemCSSVarPrefix = "menu-bar" | "context-menu";

/**
 * Describes a leaf action item, submenu trigger, or separator row inside a `Menu`.
 *
 * @remarks When `separator` is true all other fields are ignored; the item renders as
 * a thin horizontal rule. When `submenu` is set the item opens a child `Menu`
 * instead of calling `action`.
 *
 * @category Components
 */
export interface MenuItemConfig {
    /** Display label shown in the menu row. */
    text?: string;
    /** Called when the item is activated (click or Enter). Ignored when `submenu` is set. */
    action?: () => void;
    /** Defaults to `true`. Disabled items are dimmed and non-interactive. */
    enabled?: boolean;
    /** Keyboard shortcut hint displayed on the right (e.g. `"Ctrl+S"`). */
    shortcut?: string;
    /** Icon or glyph displayed on the left (e.g. a Unicode character or FontAwesome code). */
    icon?: string;
    /** When present this item opens a submenu rather than calling `action`. */
    submenu?: MenuConfig;
    /** When `true` the item renders as a separator; all other fields are ignored. */
    separator?: true;
}

/**
 * Describes one top-level entry in a `MenuBar`.
 *
 * @category Components
 */
export interface MenuConfig {
    /** Label shown in the bar button (e.g. `"File"`). */
    label: string;
    /** Ordered list of items in the dropdown panel. */
    items: MenuItemConfig[];
}

/**
 * A single row inside a `Menu` panel.
 *
 * Renders a four-zone layout: icon | text | shortcut | chevron. When
 * `config.separator` is true the item renders instead as a thin horizontal
 * rule and ignores all other config fields.
 *
 * Mouse hover triggers the submenu open callback after a 150 ms delay.
 * Keyboard focus is applied programmatically via `setFocused`.
 *
 * @category Components
 */
class MenuItem extends Component {

    /** Fixed pixel height for every non-separator menu item. */
    static readonly HEIGHT: number = 24;

    private static readonly SEPARATOR_HEIGHT: number = 9;
    private static readonly ICON_ZONE: number = 24;
    private static readonly SHORTCUT_ZONE: number = 80;
    private static readonly CHEVRON_ZONE: number = 16;
    private static readonly RIGHT_PAD: number = 8;

    private readonly _config: MenuItemConfig;
    private readonly _onActivate: () => void;
    private readonly _onOpenSubmenu: (item: MenuItem) => void;
    private readonly _cssVarPrefix: MenuItemCSSVarPrefix;

    private _iconText: Text | null = null;
    private _titleText: Text | null = null;
    private _shortcutText: Text | null = null;
    private _chevronText: Text | null = null;

    private _submenuTimer: ReturnType<typeof setTimeout> | null = null;

    private readonly _onMouseOver: () => void;
    private readonly _onMouseOut: () => void;
    private readonly _onClick: () => void;

    /**
     * Constructs a MenuItem from a config descriptor.
     *
     * @param config - The item descriptor including text, action, shortcut, icon, and submenu.
     * @param onActivate - Called when this item is activated (click or Enter on a leaf item).
     * @param onOpenSubmenu - Called when this item's submenu should open (or close others when no submenu).
     * @param cssVarPrefix - Selects which CSS-variable family supplies disabled, hover, and shortcut colours. Defaults to `'menu-bar'`.
     */
    constructor(
        config: MenuItemConfig,
        onActivate: () => void,
        onOpenSubmenu: (item: MenuItem) => void,
        cssVarPrefix: MenuItemCSSVarPrefix = "menu-bar",
        options?: MenuItemOptions
    ) {
        super();

        this._config = config;
        this._onActivate = onActivate;
        this._onOpenSubmenu = onOpenSubmenu;
        this._cssVarPrefix = cssVarPrefix;

        if (config.separator) {
            this.setHeight(MenuItem.SEPARATOR_HEIGHT);
            this.setPreferredSize(0, MenuItem.SEPARATOR_HEIGHT);
            this.setBackgroundColor("transparent");
            this.setElementCSSRule(
                "borderTop",
                `1px solid var(--ts-ui-${cssVarPrefix}-separator-color, rgb(220, 220, 220))`
            );
            this.setElementCSSRule("margin", "4px 0");
            this.getAria().setRole("separator");

            this._onMouseOver = () => {};
            this._onMouseOut = () => {};
            this._onClick = () => {};

            if (options) {
                this.applyOptions(options);
            }

            return;
        }

        const enabled = config.enabled !== false;

        this.setHeight(MenuItem.HEIGHT);
        this.setPreferredSize(0, MenuItem.HEIGHT);
        this.setBackgroundColor("transparent");
        this.setElementCSSRule("fontSize", "var(--ts-ui-button-font-size, 12px)");
        this.setCursor(enabled ? "pointer" : "default");
        this.getAria().setRole("menuitem");

        if (!enabled) {
            this.setForegroundColor(
                `var(--ts-ui-${cssVarPrefix}-item-disabled-color, rgb(170, 170, 170))`
            );
            this.getAria().setDisabled(true);
        }

        this._iconText = new Text(config.icon ?? "");
        this._iconText.setPointerEvents("none");
        this._iconText.setElementCSSRule("lineHeight", MenuItem.HEIGHT + "px");
        this._iconText.setVisible(!!config.icon);
        this.addComponent(this._iconText);

        this._titleText = new Text(config.text ?? "");
        this._titleText.setPointerEvents("none");
        this._titleText.setElementCSSRule("lineHeight", MenuItem.HEIGHT + "px");
        this._titleText.setElementCSSRule("whiteSpace", "nowrap");
        this._titleText.setElementCSSRule("overflow", "hidden");
        this._titleText.setElementCSSRule("textOverflow", "ellipsis");
        this.addComponent(this._titleText);

        if (config.shortcut) {
            this._shortcutText = new Text(config.shortcut);
            this._shortcutText.setPointerEvents("none");
            this._shortcutText.setElementCSSRule("lineHeight", MenuItem.HEIGHT + "px");
            this._shortcutText.setElementCSSRule("textAlign", "right");
            this._shortcutText.setForegroundColor(
                `var(--ts-ui-${cssVarPrefix}-item-shortcut-color, rgb(140, 140, 140))`
            );
            this.addComponent(this._shortcutText);
        }

        if (this.hasSubmenu()) {
            this._chevronText = new Text("▶");
            this._chevronText.setPointerEvents("none");
            this._chevronText.setElementCSSRule("lineHeight", MenuItem.HEIGHT + "px");
            this._chevronText.setElementCSSRule("textAlign", "center");
            this._chevronText.setForegroundColor(
                `var(--ts-ui-${cssVarPrefix}-item-shortcut-color, rgb(140, 140, 140))`
            );
            this.addComponent(this._chevronText);
            this.getAria().setHasPopup("menu");
            this.getAria().setExpanded(false);
        }

        this._onMouseOver = () => {
            this.setFocused(true);

            if (this.hasSubmenu()) {
                this._submenuTimer = setTimeout(() => {
                    this._submenuTimer = null;
                    this._onOpenSubmenu(this);
                }, 150);
            } else {
                this._onOpenSubmenu(this);
            }
        };

        this._onMouseOut = () => {
            this.setFocused(false);

            if (this._submenuTimer !== null) {
                clearTimeout(this._submenuTimer);
                this._submenuTimer = null;
            }
        };

        this._onClick = () => {
            if (enabled && !this.hasSubmenu()) {
                this._onActivate();
            }
        };

        Event.addListener(this, "mouseover", this._onMouseOver);
        Event.addListener(this, "mouseout", this._onMouseOut);
        Event.addListener(this, "click", this._onClick);

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link MenuItemOptions} bag, dispatching menu item label,
     * enabled state, and focus highlight after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: MenuItemOptions): this {
        super.applyOptions(options);

        if (options.text !== undefined && this._titleText) {
            this._titleText.setText(options.text);
        }

        if (options.enabled !== undefined) {
            this.getAria().setDisabled(!options.enabled);
            this.setCursor(options.enabled ? "pointer" : "default");
        }

        if (options.focused !== undefined) {
            this.setFocused(options.focused);
        }

        return this;
    }

    /**
     * Returns `true` if this item has a child submenu.
     *
     * @returns Whether a `submenu` config was provided.
     */
    hasSubmenu(): boolean {
        return !!this._config.submenu;
    }

    /**
     * Returns the submenu config, or `null` if this item has no submenu.
     *
     * @returns The `MenuConfig` for the child panel, or null.
     */
    getSubmenuConfig(): MenuConfig | null {
        return this._config.submenu ?? null;
    }

    /**
     * Applies or removes the keyboard-focus highlight background.
     *
     * @param focused - `true` to highlight, `false` to clear.
     */
    setFocused(focused: boolean): this {
        this.setBackgroundColor(
            focused
                ? `var(--ts-ui-${this._cssVarPrefix}-item-hover-bg, rgba(30, 100, 200, 0.12))`
                : "transparent"
        );

        return this;
    }

    /**
     * Returns `true` when this item was constructed with `separator: true`.
     *
     * @returns Whether this item is a non-interactive separator row.
     */
    isSeparator(): boolean {
        return !!this._config.separator;
    }

    /**
     * Returns `true` when the item is interactive (not disabled).
     *
     * @returns Whether `enabled` was not explicitly set to `false`.
     */
    isEnabled(): boolean {
        return this._config.enabled !== false;
    }

    /**
     * Activates this item as if the user clicked or pressed Enter.
     *
     * For submenu items, calls `onOpenSubmenu` immediately (skipping the hover delay).
     * For leaf items, calls `onActivate`. Does nothing for disabled or separator items.
     */
    activate(): void {
        if (this.isSeparator() || !this.isEnabled()) {
            return;
        }

        if (this.hasSubmenu()) {
            this._onOpenSubmenu(this);
        } else {
            this._onActivate();
        }
    }

    /**
     * Removes all Event listeners registered by this item and cancels any pending submenu timer.
     */
    dispose(): void {
        if (this._submenuTimer !== null) {
            clearTimeout(this._submenuTimer);
            this._submenuTimer = null;
        }

        Event.removeListener(this, "mouseover", this._onMouseOver);
        Event.removeListener(this, "mouseout", this._onMouseOut);
        Event.removeListener(this, "click", this._onClick);
    }

    /**
     * Returns the offset from the top of the menu item to the title text's baseline.
     *
     * @returns The baseline offset in pixels, or `null` when the title has no baseline
     * (e.g. for a separator row).
     */
    getBaseline(): number | null {
        if (this._titleText === null) {
            return null;
        }

        return this.wrapInnerBaseline(this._titleText.getBaseline());
    }

    /**
     * Positions the four label zones within the item's bounds.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        if (this._config.separator) {
            return this;
        }

        const H = MenuItem.HEIGHT;
        const totalWidth = this.getWidth();
        const hasIcon = !!this._config.icon;
        const hasShortcut = !!this._config.shortcut && this._shortcutText !== null;
        const hasSub = this.hasSubmenu();

        const textStart = hasIcon ? MenuItem.ICON_ZONE : 8;
        const chevronReserve = hasSub ? MenuItem.CHEVRON_ZONE : 0;
        const shortcutReserve = hasShortcut ? MenuItem.SHORTCUT_ZONE + 4 : 0;
        const textWidth = Math.max(
            0,
            totalWidth - textStart - MenuItem.RIGHT_PAD - chevronReserve - shortcutReserve
        );

        if (this._iconText) {
            this._iconText.setX(4);
            this._iconText.setY(0);
            this._iconText.setWidth(20);
            this._iconText.setHeight(H);
        }

        if (this._titleText) {
            this._titleText.setX(textStart);
            this._titleText.setY(0);
            this._titleText.setWidth(textWidth);
            this._titleText.setHeight(H);
        }

        if (hasSub && this._chevronText) {
            this._chevronText.setX(totalWidth - MenuItem.RIGHT_PAD - MenuItem.CHEVRON_ZONE);
            this._chevronText.setY(0);
            this._chevronText.setWidth(MenuItem.CHEVRON_ZONE);
            this._chevronText.setHeight(H);
        }

        if (hasShortcut && this._shortcutText) {
            const shortcutX =
                totalWidth
                - MenuItem.RIGHT_PAD
                - chevronReserve
                - (hasSub ? 4 : 0)
                - MenuItem.SHORTCUT_ZONE;

            this._shortcutText.setX(shortcutX);
            this._shortcutText.setY(0);
            this._shortcutText.setWidth(MenuItem.SHORTCUT_ZONE);
            this._shortcutText.setHeight(H);
        }

        return this;
    }
}

const MenuItemCallable = callable(MenuItem);
type MenuItemCallable = MenuItem;
export {
    MenuItem         as _MenuItem,
    MenuItemCallable as MenuItem
};
