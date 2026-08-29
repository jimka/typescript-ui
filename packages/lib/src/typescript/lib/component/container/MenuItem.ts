// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ComponentOptions } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Text } from "~/component/input/Text.js";
import { Glyph } from "~/component/display/Glyph.js";
import { BorderOptions } from "~/primitive/Border.js";
import { MenuRow } from "~/component/container/MenuRow.js";
import { callable } from "~/core/Callable.js";
import { ThemeManager } from "~/core/Theme.js";

/**
 * Square edge length used for a menu item's leading icon glyph — the theme's
 * `glyphLg` default icon step (16px at the shipped base). Read per call, not
 * frozen in a module constant, so a theme that raises `scale.base` moves the
 * icon with it.
 */
function menuIconPx(): number {
    return ThemeManager.getResolvedScale().glyphLg;
}

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
    /**
     * When `false`, activating this item runs `action` but leaves the menu
     * open — the menu still closes on an outside click, Escape, or window
     * blur. Defaults to `true` (close on activation, today's behaviour).
     * Ignored for a submenu-opening item (see `submenu`), which never calls
     * `action`.
     *
     * Pair with {@link MenuItemConfig.checked} for a multi-select menu: each
     * activation flips that item's own checkmark without dismissing the
     * panel, so the user can pick several items in one open.
     */
    closeOnActivate?: boolean;
    /** Defaults to `true`. Disabled items are dimmed and non-interactive. */
    enabled?: boolean;
    /** Keyboard shortcut hint displayed on the right (e.g. `"Ctrl+S"`). */
    shortcut?: string;
    /**
     * Marks this item as part of a checkable set (a toggle, or one option in
     * a mutually-exclusive group) and whether it is currently checked. A
     * checkmark renders in a dedicated leading zone, to the left of any
     * `icon`/`glyph`, so a checked and an unchecked row's icon and label
     * still start at the same x position — unlike hand-prefixing the
     * checkmark onto `text`, whose leading whitespace collapses inconsistently
     * under this component's `white-space: nowrap`.
     *
     * When at least one item in a menu sets `checked` (`true` or `false`),
     * every item in that menu reserves the check column, so the whole menu's
     * icon/title columns stay aligned even for items that omit `checked`.
     *
     * @remarks Omit entirely for a plain action item — this is opt-in per
     * menu, not a default a plain item pays for. Paired with
     * `closeOnActivate: false`, the checkmark also flips automatically on
     * each activation — see `closeOnActivate`.
     */
    checked?: boolean;
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
    /** When `true`, `Menu` renders a `MenuSeparator` for this entry and ignores every other field, `row` included. */
    separator?: true;
    /**
     * A zero-argument factory returning a [`MenuRow`](/api/component/container/classes/MenuRow)
     * to render in place of this config's own `MenuItem`. When set, `separator`
     * still wins if also set; otherwise every other field on this config is
     * ignored. The factory is called once per menu build, so it must never
     * return a shared instance — `Menu` disposes its whole item list on every
     * rebuild, which would leave a reused instance dead after the first show.
     */
    row?: () => MenuRow;
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
 * Renders a five-zone layout: check | icon | text | shortcut | chevron. The
 * check zone is reserved only when the menu has at least one checkable item
 * (see {@link MenuItemConfig.checked}).
 *
 * Mouse hover triggers the submenu open callback after a 150 ms delay.
 * Keyboard focus is applied programmatically via `setFocused`.
 *
 * @category Components
 */
class MenuItem extends MenuRow {

    /** Fixed pixel height for every non-separator menu item. */
    static readonly HEIGHT: number = MenuRow.HEIGHT;

    /** Title left inset when the menu reserves no icon column. */
    static readonly TEXT_INSET: number = 8;
    /** Title left offset when the menu reserves an icon column. */
    static readonly ICON_ZONE: number = 24;
    /** Width reserved for the leading checkmark column, when the menu has one. */
    static readonly CHECK_ZONE: number = 16;
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

    // The item's own live checkmark state, decoupled from `_config.checked`
    // (the caller-owned initial value) so `activateLeaf` can flip it without
    // mutating a config object the caller still holds a reference to.
    private _checked: boolean = false;

    private _checkText: Text | null = null;
    private _iconText: Text | null = null;
    private _iconGlyph: Glyph | null = null;
    private _titleText: Text | null = null;
    private _shortcutText: Text | null = null;
    private _chevronText: Text | null = null;

    // Column geometry applied by the parent Menu so every item lines up: the
    // check zone's width, the title's left offset (which already includes the
    // check zone, when reserved), and the shared title-column width the right
    // zone begins after. Null until the menu sets them (a standalone item
    // falls back to its own natural metrics).
    private _checkZone: number | null = null;
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
        this.setCssVarPrefix(cssVarPrefix);

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

        if (config.checked !== undefined) {
            this._checked = config.checked;
            this._checkText = new Text(config.checked ? "✓" : "");
            this._checkText.setPointerEvents("none");
            this._checkText.setTextAlign("center");
            this.addComponent(this._checkText);
        }

        if (config.glyph) {
            this._iconGlyph = new Glyph(config.glyph);
            this._iconGlyph.setPointerEvents("none");
            const iconPx = menuIconPx();
            this._iconGlyph.setPreferredSize({ width: iconPx, height: iconPx });

            if (config.glyphColor) {
                this._iconGlyph.setForegroundColor(config.glyphColor);
            }

            this.addComponent(this._iconGlyph);
        } else {
            this._iconText = new Text(config.icon ?? "");
            this._iconText.setPointerEvents("none");
            this._iconText.setVisible(!!config.icon);
            this.addComponent(this._iconText);
        }

        this._titleText = new Text(config.text ?? "");
        this._titleText.setPointerEvents("none");
        this._titleText.setWhiteSpace("nowrap");
        this._titleText.setOverflow("hidden");
        this._titleText.setTextOverflow("ellipsis");
        this.addComponent(this._titleText);

        if (config.shortcut) {
            this._shortcutText = new Text(config.shortcut);
            this._shortcutText.setPointerEvents("none");
            this._shortcutText.setTextAlign("left");
            this._shortcutText.setForegroundColor(
                `var(--ts-ui-${cssVarPrefix}-item-shortcut-color, rgb(140, 140, 140))`
            );
            this.addComponent(this._shortcutText);
        }

        if (this.hasSubmenu()) {
            this._chevronText = new Text("▶");
            this._chevronText.setPointerEvents("none");
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

            // Reads the live `isEnabled()` (not the `enabled` captured above) so
            // a later `setEnabled()` call takes effect on the next hover — see
            // `setEnabled`'s own doc. A disabled item never opens its own
            // submenu; it still signals the parent (the else branch) so
            // hovering it closes any sibling submenu.
            if (this.isEnabled() && this.hasSubmenu()) {
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
            // Reads the live `isEnabled()`, not the `enabled` captured above —
            // see `setEnabled`'s own doc.
            if (this.isEnabled() && !this.hasSubmenu()) {
                this.activateLeaf();
            }
        };

        Event.addListener(this, "mouseover", this._onMouseOver);
        Event.addListener(this, "mouseout", this._onMouseOut);
        Event.addListener(this, "click", this._onClick);

        if (options) {
            this.applyOptions(options);
        }

        this.updateLabelHeights();
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

    /** True when the item declares `checked` (participates in a checkable set). */
    hasCheck(): boolean {
        return this._config.checked !== undefined;
    }

    /**
     * Returns the item's current checkmark state. Meaningless when
     * `hasCheck()` is `false` — there is no checkmark to report.
     *
     * @returns Whether the checkmark is currently shown.
     */
    isChecked(): boolean {
        return this._checked;
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
     * Applies the menu-computed column geometry so every item lines up: the
     * check column's width, the title's left offset (icon column plus the
     * check column, or the bare inset), and the shared title-column width the
     * shortcut/chevron right zone begins after.
     *
     * @param checkZone - Width reserved for the leading checkmark column, in
     *   pixels; `0` when no item in the menu declares `checked`.
     * @param iconStart - The title's left offset in pixels; already includes `checkZone`.
     * @param titleColumn - The shared title-column width across the menu's items.
     */
    setColumns(checkZone: number, iconStart: number, titleColumn: number): void {
        this._checkZone  = checkZone;
        this._iconStart  = iconStart;
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
     * Every item is navigable; `activate` is what refuses to run for a
     * disabled one.
     *
     * @returns `true`.
     */
    isNavigable(): boolean {
        return true;
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
     * Updates the item's enabled state after construction — dims (or
     * restores) the title colour, sets the aria-disabled flag and pointer
     * cursor, and updates the flag {@link isEnabled} reads, which the
     * `_onMouseOver` / `_onClick` handlers installed at construction consult
     * live rather than a frozen construction-time value. Lets `Menu.setItemEnabled`
     * push a live availability change into an already-open panel — e.g. a
     * sibling row's own toggle that should immediately grey out this item —
     * without closing or rebuilding the panel.
     *
     * @param value - True to enable the item.
     *
     * @returns This item, for method chaining.
     */
    setEnabled(value: boolean): this {
        this._config.enabled = value;

        this.setCursor(value ? "pointer" : "default");
        this.getAria().setDisabled(!value);

        if (value) {
            this.clearForegroundColor();
        } else {
            this.setForegroundColor(
                `var(--ts-ui-${this.getCssVarPrefix()}-item-disabled-color, rgb(170, 170, 170))`
            );
        }

        return this;
    }

    /**
     * Shared leaf-activation path for a pointer click and {@link activate}.
     * A checkable item that keeps the menu open (`closeOnActivate: false`)
     * flips its own checkmark first; a checkable item that closes the menu
     * (the default) is left alone here, since the menu tears the item down
     * immediately after and there is nothing left to keep in sync.
     */
    private activateLeaf(): void {
        if (this.hasCheck() && this._config.closeOnActivate === false) {
            this._checked = !this._checked;
            this._checkText?.setText(this._checked ? "✓" : "");
        }

        this._onActivate();
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
            this.activateLeaf();
        }
    }

    /**
     * Cancels any pending submenu timer, then defers to the base class for
     * the rest of teardown.
     */
    protected destructor(): void {
        if (this._submenuTimer !== null) {
            clearTimeout(this._submenuTimer);
            this._submenuTimer = null;
        }

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
     * Re-pins the five labels' line boxes to the item's CONTENT height —
     * `MenuItem.HEIGHT` less this item's own vertical chrome. `centerInHeight`
     * pins a label's minimum height as well as its line box, so a label pinned to
     * the outer height cannot shrink into a bordered item's content box and is
     * clipped. Called from the constructor tail and whenever the border changes.
     */
    private updateLabelHeights(): void {
        const perimeter = this.getPerimeterSize();
        // Floor of 1: chrome at or past the row height leaves nothing to centre
        // in, and a zero or negative line-height is not a value CSS should see.
        // The label clips in that case either way — the floor only keeps the
        // written value sane.
        const height = Math.max(1, MenuItem.HEIGHT - perimeter.top - perimeter.bottom);

        // Optional chaining, not null checks: several of these are conditionally
        // built (the check/icon/shortcut/chevron labels depend on config), and a
        // border arriving through the options bag could in principle reach here
        // before the field initializers have run.
        this._checkText?.centerInHeight(height);
        this._iconText?.centerInHeight(height);
        this._titleText?.centerInHeight(height);
        this._shortcutText?.centerInHeight(height);
        this._chevronText?.centerInHeight(height);
    }

    /**
     * Applies a border, then re-pins the four labels' line boxes to the item's
     * new content height so a bordered item's labels shrink to fit instead of
     * overrunning the smaller content box.
     *
     * @param options - Border configuration, or a CSS `border` shorthand string.
     * @returns This component, for method chaining.
     */
    setBorder(options: BorderOptions | string): this {
        super.setBorder(options);
        this.updateLabelHeights();

        return this;
    }

    /**
     * Clears the border, then re-pins the four labels' line boxes back to the
     * item's now-larger content height.
     *
     * @returns This component, for method chaining.
     */
    clearBorder(): this {
        super.clearBorder();
        this.updateLabelHeights();

        return this;
    }

    /**
     * Positions the five label zones within the item's content box.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        const box = this.getContentBounds();

        if (!box) {
            return this;
        }

        // Heights come from the content box, not MenuItem.HEIGHT: the constant
        // is the item's outer height. With no border the two are the same
        // number. The texts' line boxes are pinned to match by
        // updateLabelHeights, so they fit this box rather than overrunning it.
        const H = box.height;
        const totalWidth = box.width;
        const hasShortcut = !!this._config.shortcut && this._shortcutText !== null;
        const hasSub = this.hasSubmenu();

        // The menu aligns every item into shared columns; a standalone item falls
        // back to its own check/icon offsets and natural title width.
        const checkZone   = this._checkZone ?? (this.hasCheck() ? MenuItem.CHECK_ZONE : 0);
        const iconStart   = this._iconStart ?? (checkZone + (this.hasIcon() ? MenuItem.ICON_ZONE : MenuItem.TEXT_INSET));
        const titleColumn = this._titleColumn ?? this.titleTextWidth();

        if (this._checkText) {
            this._checkText.setX(box.x + 4);
            this._checkText.setY(box.y);
            this._checkText.setWidth(Math.max(0, checkZone - 4));
            this._checkText.setHeight(H);
        }

        if (this._iconGlyph) {
            const fallbackPx = menuIconPx();
            const size       = this._iconGlyph.getPreferredSize() ?? { width: fallbackPx, height: fallbackPx };
            const iconY      = Math.max(0, Math.floor((H - size.height) / 2));

            this._iconGlyph.setX(box.x + checkZone + 4);
            this._iconGlyph.setY(box.y + iconY);
            this._iconGlyph.setWidth(size.width);
            this._iconGlyph.setHeight(size.height);
        } else if (this._iconText) {
            this._iconText.setX(box.x + checkZone + 4);
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
