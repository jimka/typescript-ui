// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../Component.js";
import { Event } from "../../Event.js";
import { Label } from "../Label.js";

/**
 * Describes a leaf action item, submenu trigger, or separator row inside a `MenuPanel`.
 *
 * @remarks When `separator` is true all other fields are ignored; the item renders as
 * a thin horizontal rule. When `submenu` is set the item opens a child `MenuPanel`
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
 * A single row inside a `MenuPanel`.
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
export class MenuItem extends Component {

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

    private _iconLabel: Label | null = null;
    private _textLabel: Label | null = null;
    private _shortcutLabel: Label | null = null;
    private _chevronLabel: Label | null = null;

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
     */
    constructor(
        config: MenuItemConfig,
        onActivate: () => void,
        onOpenSubmenu: (item: MenuItem) => void
    ) {
        super();

        this._config = config;
        this._onActivate = onActivate;
        this._onOpenSubmenu = onOpenSubmenu;

        if (config.separator) {
            this.setHeight(MenuItem.SEPARATOR_HEIGHT);
            this.setPreferredSize(0, MenuItem.SEPARATOR_HEIGHT);
            this.setBackgroundColor("transparent");
            this.setElementCSSRule(
                "borderTop",
                "1px solid var(--ts-ui-menu-bar-separator-color, rgb(220, 220, 220))"
            );
            this.setElementCSSRule("margin", "4px 0");
            this.getAria().setRole("separator");

            this._onMouseOver = () => {};
            this._onMouseOut = () => {};
            this._onClick = () => {};

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
                "var(--ts-ui-menu-bar-item-disabled-color, rgb(170, 170, 170))"
            );
            this.getAria().setDisabled(true);
        }

        this._iconLabel = new Label(config.icon ?? "");
        this._iconLabel.setPointerEvents("none");
        this._iconLabel.setElementCSSRule("lineHeight", MenuItem.HEIGHT + "px");
        this._iconLabel.setVisible(!!config.icon);
        this.addComponent(this._iconLabel);

        this._textLabel = new Label(config.text ?? "");
        this._textLabel.setPointerEvents("none");
        this._textLabel.setElementCSSRule("lineHeight", MenuItem.HEIGHT + "px");
        this._textLabel.setElementCSSRule("whiteSpace", "nowrap");
        this._textLabel.setElementCSSRule("overflow", "hidden");
        this._textLabel.setElementCSSRule("textOverflow", "ellipsis");
        this.addComponent(this._textLabel);

        if (config.shortcut) {
            this._shortcutLabel = new Label(config.shortcut);
            this._shortcutLabel.setPointerEvents("none");
            this._shortcutLabel.setElementCSSRule("lineHeight", MenuItem.HEIGHT + "px");
            this._shortcutLabel.setElementCSSRule("textAlign", "right");
            this._shortcutLabel.setForegroundColor(
                "var(--ts-ui-menu-bar-item-shortcut-color, rgb(140, 140, 140))"
            );
            this.addComponent(this._shortcutLabel);
        }

        if (this.hasSubmenu()) {
            this._chevronLabel = new Label("▶");
            this._chevronLabel.setPointerEvents("none");
            this._chevronLabel.setElementCSSRule("lineHeight", MenuItem.HEIGHT + "px");
            this._chevronLabel.setElementCSSRule("textAlign", "center");
            this._chevronLabel.setForegroundColor(
                "var(--ts-ui-menu-bar-item-shortcut-color, rgb(140, 140, 140))"
            );
            this.addComponent(this._chevronLabel);
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
    setFocused(focused: boolean): void {
        this.setBackgroundColor(
            focused
                ? "var(--ts-ui-menu-bar-item-hover-bg, rgba(30, 100, 200, 0.12))"
                : "transparent"
        );
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
     * Positions the four label zones within the item's bounds.
     */
    doLayout(): void {
        super.doLayout();

        if (this._config.separator) {
            return;
        }

        const H = MenuItem.HEIGHT;
        const totalWidth = this.getWidth();
        const hasIcon = !!this._config.icon;
        const hasShortcut = !!this._config.shortcut && this._shortcutLabel !== null;
        const hasSub = this.hasSubmenu();

        const textStart = hasIcon ? MenuItem.ICON_ZONE : 8;
        const chevronReserve = hasSub ? MenuItem.CHEVRON_ZONE : 0;
        const shortcutReserve = hasShortcut ? MenuItem.SHORTCUT_ZONE + 4 : 0;
        const textWidth = Math.max(
            0,
            totalWidth - textStart - MenuItem.RIGHT_PAD - chevronReserve - shortcutReserve
        );

        if (this._iconLabel) {
            this._iconLabel.setX(4);
            this._iconLabel.setY(0);
            this._iconLabel.setWidth(20);
            this._iconLabel.setHeight(H);
        }

        if (this._textLabel) {
            this._textLabel.setX(textStart);
            this._textLabel.setY(0);
            this._textLabel.setWidth(textWidth);
            this._textLabel.setHeight(H);
        }

        if (hasSub && this._chevronLabel) {
            this._chevronLabel.setX(totalWidth - MenuItem.RIGHT_PAD - MenuItem.CHEVRON_ZONE);
            this._chevronLabel.setY(0);
            this._chevronLabel.setWidth(MenuItem.CHEVRON_ZONE);
            this._chevronLabel.setHeight(H);
        }

        if (hasShortcut && this._shortcutLabel) {
            const shortcutX =
                totalWidth
                - MenuItem.RIGHT_PAD
                - chevronReserve
                - (hasSub ? 4 : 0)
                - MenuItem.SHORTCUT_ZONE;

            this._shortcutLabel.setX(shortcutX);
            this._shortcutLabel.setY(0);
            this._shortcutLabel.setWidth(MenuItem.SHORTCUT_ZONE);
            this._shortcutLabel.setHeight(H);
        }
    }
}
