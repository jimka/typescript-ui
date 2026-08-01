// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Text } from "~/component/input/Text.js";
import { Glyph } from "~/component/display/Glyph.js";
import { callable } from "~/core/Callable.js";

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
 * resolves to `--ts-ui-context-menu-item-*` tokens. The [`Menu`](/api/overlay/classes/Menu) class chooses
 * the prefix based on its mode.
 */
export type MenuItemCSSVarPrefix = "menu-bar" | "context-menu";

/**
 * Describes a leaf action item, submenu trigger, or separator row inside a [`Menu`](/api/overlay/classes/Menu).
 *
 * @remarks When `separator` is true all other fields are ignored; the item renders as
 * a thin horizontal rule. When `submenu` is set the item opens a child [`Menu`](/api/overlay/classes/Menu)
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
    /**
     * Icon displayed on the left (e.g. a Unicode character).
     *
     * @remarks Prefer `glyph` for crisp SVG output from the framework's glyph
     * registry; `icon` remains supported for callers that want to embed a raw
     * character.
     */
    icon?: string;
    /**
     * Registry glyph name displayed on the left of the item row. Takes
     * precedence over `icon` when both are provided.
     */
    glyph?: string;
    /**
     * Optional colour for the leading `glyph`, overriding the item's default
     * foreground (e.g. a severity tint). Any CSS colour string. Ignored when the
     * row has no `glyph`.
     */
    glyphColor?: string;
    /** When present this item opens a submenu rather than calling `action`. */
    submenu?: MenuConfig;
    /** When `true` the item renders as a separator; all other fields are ignored. */
    separator?: true;
}

/**
 * Describes one top-level entry in a [`MenuBar`](/api/component/menubar/classes/MenuBar).
 *
 * @category Components
 */
export interface MenuConfig {
    /** Label shown in the bar button (e.g. `"File"`). */
    label: string;
    /**
     * The items in the dropdown panel: either a fixed array, or a provider called
     * to produce them when the panel is built. A submenu panel is (re)built each
     * time it opens, so a provider on a submenu's `items` is re-invoked on every
     * open — letting the submenu reflect current state (e.g. an export chooser
     * whose labels track the active tab) without the parent menu rebuilding.
     */
    items: MenuItemConfig[] | (() => MenuItemConfig[]);
    /**
     * Optional registry glyph name displayed to the left of the bar button's
     * label (e.g. `"file"`, `"eye"`, `"info-circle"`). Omit for a text-only
     * menu button.
     */
    glyph?: string;
}

/**
 * A single row inside a [`Menu`](/api/overlay/classes/Menu) panel.
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
    /** Title left inset when the menu reserves no icon column. */
    static readonly TEXT_INSET: number = 8;
    /** Title left offset when the menu reserves an icon column. */
    static readonly ICON_ZONE: number = 24;
    /** Width reserved for a submenu chevron in the right zone. */
    static readonly CHEVRON_ZONE: number = 16;
    /** Padding after the right zone, at the panel's inner edge. */
    static readonly RIGHT_PAD: number = 8;
    /**
     * Gap between the title column and the shortcut/chevron right zone, so a
     * content-sized menu never butts the label against them.
     */
    static readonly TEXT_GAP: number = 10;

    private readonly _config: MenuItemConfig;
    private readonly _onActivate: () => void;
    private readonly _onOpenSubmenu: (item: MenuItem) => void;
    private readonly _cssVarPrefix: MenuItemCSSVarPrefix;

    private _iconText: Text | null = null;
    private _iconGlyph: Glyph | null = null;
    private _titleText: Text | null = null;
    private _shortcutText: Text | null = null;
    private _chevronText: Text | null = null;

    // Column geometry applied by the parent Menu so every item lines up: the
    // title's left offset and the shared title-column width the right zone begins
    // after. Null until the menu sets them (a standalone item falls back to its
    // own natural metrics).
    private _iconStart: number | null = null;
    private _titleColumn: number | null = null;

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
        // Child components are built first; options are applied via applyOptions at the constructor tail.
        // eslint-disable-next-line local/forward-super-options
        super();

        this._config = config;
        this._onActivate = onActivate;
        this._onOpenSubmenu = onOpenSubmenu;
        this._cssVarPrefix = cssVarPrefix;

        if (config.separator) {
            this.setHeight(MenuItem.SEPARATOR_HEIGHT);
            this.setPreferredSize({ width: 0, height: MenuItem.SEPARATOR_HEIGHT });
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
        this.setPreferredSize({ width: 0, height: MenuItem.HEIGHT });
        this.setBackgroundColor("transparent");
        this.setElementCSSRule("fontSize", "var(--ts-ui-button-font-size, var(--ts-ui-font-size))");
        this.setCursor(enabled ? "pointer" : "default");
        this.getAria().setRole("menuitem");

        if (!enabled) {
            this.setForegroundColor(
                `var(--ts-ui-${cssVarPrefix}-item-disabled-color, rgb(170, 170, 170))`
            );
            this.getAria().setDisabled(true);
        }

        if (config.glyph) {
            this._iconGlyph = new Glyph(config.glyph);
            this._iconGlyph.setPointerEvents("none");
            this._iconGlyph.setPreferredSize({ width: 16, height: 16 });

            if (config.glyphColor) {
                this._iconGlyph.setForegroundColor(config.glyphColor);
            }

            this.addComponent(this._iconGlyph);
        } else {
            this._iconText = new Text(config.icon ?? "");
            this._iconText.setPointerEvents("none");
            this._iconText.centerInHeight(MenuItem.HEIGHT);
            this._iconText.setVisible(!!config.icon);
            this.addComponent(this._iconText);
        }

        this._titleText = new Text(config.text ?? "");
        this._titleText.setPointerEvents("none");
        this._titleText.centerInHeight(MenuItem.HEIGHT);
        this._titleText.setWhiteSpace("nowrap");
        this._titleText.setOverflow("hidden");
        this._titleText.setTextOverflow("ellipsis");
        this.addComponent(this._titleText);

        if (config.shortcut) {
            this._shortcutText = new Text(config.shortcut);
            this._shortcutText.setPointerEvents("none");
            this._shortcutText.centerInHeight(MenuItem.HEIGHT);
            this._shortcutText.setTextAlign("left");
            this._shortcutText.setForegroundColor(
                `var(--ts-ui-${cssVarPrefix}-item-shortcut-color, rgb(140, 140, 140))`
            );
            this.addComponent(this._shortcutText);
        }

        if (this.hasSubmenu()) {
            this._chevronText = new Text("▶");
            this._chevronText.setPointerEvents("none");
            this._chevronText.centerInHeight(MenuItem.HEIGHT);
            this._chevronText.setTextAlign("center");
            this._chevronText.setForegroundColor(
                `var(--ts-ui-${cssVarPrefix}-item-shortcut-color, rgb(140, 140, 140))`
            );
            this.addComponent(this._chevronText);
            this.getAria().setHasPopup("menu");
            this.getAria().setExpanded(false);
        }

        this._onMouseOver = () => {
            this.setFocused(true);

            // A disabled item never opens its own submenu; it still signals the
            // parent (the else branch) so hovering it closes any sibling submenu.
            if (enabled && this.hasSubmenu()) {
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

    /** True when the item reserves an icon column (has a glyph or icon slot). */
    hasIcon(): boolean {
        return !!this._config.icon || !!this._config.glyph;
    }

    /** The item's measured title width, feeding the menu's shared title column. */
    titleTextWidth(): number {
        return Math.ceil(this._titleText?.getPreferredSize()?.width ?? 0);
    }

    /** The item's measured shortcut width, or 0 when it has no shortcut. */
    shortcutTextWidth(): number {
        if (!this._config.shortcut || this._shortcutText === null) {
            return 0;
        }

        return Math.ceil(this._shortcutText.getPreferredSize()?.width ?? 0);
    }

    /**
     * Applies the menu-computed column geometry so every item lines up: the title
     * left offset (icon column, or the bare inset) and the shared title-column
     * width the shortcut/chevron right zone begins after.
     *
     * @param iconStart - The title's left offset in pixels.
     * @param titleColumn - The shared title-column width across the menu's items.
     */
    setColumns(iconStart: number, titleColumn: number): void {
        this._iconStart = iconStart;
        this._titleColumn = titleColumn;

        this.scheduleLayout();
    }

    /**
     * Returns the submenu config, or `null` if this item has no submenu.
     *
     * @returns The [`MenuConfig`](/api/component/container/interfaces/MenuConfig) for the child panel, or null.
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
     * Removes all Event listeners registered by this item, cancels any pending
     * submenu timer, then defers to the base class for the rest of teardown.
     */
    protected destructor(): void {
        if (this._submenuTimer !== null) {
            clearTimeout(this._submenuTimer);
            this._submenuTimer = null;
        }

        Event.removeListener(this, "mouseover", this._onMouseOver);
        Event.removeListener(this, "mouseout", this._onMouseOut);
        Event.removeListener(this, "click", this._onClick);

        super.destructor();
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
     * Positions the four label zones within the item's content box.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        if (this._config.separator) {
            return this;
        }

        const box = this.getContentBounds();

        if (!box) {
            return this;
        }

        // Heights come from the content box, not MenuItem.HEIGHT: the constant
        // is the item's outer height. With no border the two are the same
        // number. Note this does not by itself make a bordered item fit — the
        // texts' construction-time centerInHeight(MenuItem.HEIGHT) pins their
        // minimum height to the outer height, so the clamp holds them at 24
        // regardless; correcting that needs a border-change hook and is out of
        // scope here.
        const H = box.height;
        const totalWidth = box.width;
        const hasShortcut = !!this._config.shortcut && this._shortcutText !== null;
        const hasSub = this.hasSubmenu();

        // The menu aligns every item into shared columns; a standalone item falls
        // back to its own icon offset and natural title width.
        const iconStart   = this._iconStart ?? (this.hasIcon() ? MenuItem.ICON_ZONE : MenuItem.TEXT_INSET);
        const titleColumn = this._titleColumn ?? this.titleTextWidth();

        if (this._iconGlyph) {
            const size  = this._iconGlyph.getPreferredSize() ?? { width: 16, height: 16 };
            const iconY = Math.max(0, Math.floor((H - size.height) / 2));

            this._iconGlyph.setX(box.x + 4);
            this._iconGlyph.setY(box.y + iconY);
            this._iconGlyph.setWidth(size.width);
            this._iconGlyph.setHeight(size.height);
        } else if (this._iconText) {
            this._iconText.setX(box.x + 4);
            this._iconText.setY(box.y);
            this._iconText.setWidth(20);
            this._iconText.setHeight(H);
        }

        // Title fills the shared title column, left-aligned from the icon offset.
        if (this._titleText) {
            this._titleText.setX(box.x + iconStart);
            this._titleText.setY(box.y);
            this._titleText.setWidth(titleColumn);
            this._titleText.setHeight(H);
        }

        // Chevron: right-justified at the panel's inner edge.
        if (hasSub && this._chevronText) {
            this._chevronText.setX(box.x + totalWidth - MenuItem.RIGHT_PAD - MenuItem.CHEVRON_ZONE);
            this._chevronText.setY(box.y);
            this._chevronText.setWidth(MenuItem.CHEVRON_ZONE);
            this._chevronText.setHeight(H);
        }

        // Shortcut: left-justified in the right zone, one gap past the title column.
        if (hasShortcut && this._shortcutText) {
            this._shortcutText.setX(box.x + iconStart + titleColumn + MenuItem.TEXT_GAP);
            this._shortcutText.setY(box.y);
            this._shortcutText.setWidth(this.shortcutTextWidth());
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
