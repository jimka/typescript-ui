// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import type { MenuItemCSSVarPrefix } from "~/component/container/MenuItem.js";

/**
 * Abstract base class for a row inside a [`Menu`](/api/overlay/classes/Menu) panel.
 *
 * @remarks
 * `Menu` drives every row through this fixed set of methods rather than
 * assuming a [`MenuItem`](/api/component/container/classes/MenuItem). `MenuItem`
 * and [`MenuSeparator`](/api/component/container/classes/MenuSeparator) are its
 * two built-in subclasses; a consumer wanting a menu row that hosts an
 * arbitrary component (a real checkbox, a text field, …) supplies a
 * `row: () => MenuRow` factory on a `MenuItemConfig` and extends this class.
 * Every method has a working default, so a subclass overrides only what it
 * needs — mirroring
 * [`ListItemRenderer`](/api/component/list/classes/ListItemRenderer)'s
 * "defaults in the base" shape for the same kind of pluggable-content problem.
 *
 * Not wrapped with `callable()` — abstract classes are never instantiated.
 *
 * @category Components
 */
export abstract class MenuRow<TOptions extends ComponentOptions = ComponentOptions>
    extends Component<TOptions>
{

    /** Standard row height in pixels, shared by every built-in row type. */
    static readonly HEIGHT: number = 24;

    // Which CSS-variable family this row's highlight reads. Framework-managed
    // (the owning Menu picks it from its mode), so it is deliberately NOT an
    // options-bag field — ARCHITECTURE.md reserves the bag for consumer
    // configuration. No cascade-dispatched setter writes it, so a plain
    // initializer is correct here; `declare` is not needed.
    private _cssVarPrefix: MenuItemCSSVarPrefix = "menu-bar";

    // Injected by the owning Menu so a row can dismiss a panel it has no
    // reference to. Null for a row constructed outside a Menu.
    private _closeMenu: (() => void) | null = null;

    /**
     * Constructs a MenuRow, seeding the standard row height as the initial
     * preferred size. A subclass whose content needs a different size
     * overrides it after calling `super()`.
     *
     * @param options - Optional construction options, forwarded to `Component`.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        super(options, subclassDefaults);

        this.setPreferredSize({ width: 0, height: MenuRow.HEIGHT });
    }

    /**
     * Whether this row is a non-interactive separator. `Menu` never
     * navigates to, activates, or measures shared columns for a separator row.
     *
     * @returns `false` by default.
     */
    isSeparator(): boolean {
        return false;
    }

    /**
     * Whether this row is interactive. `Menu.activateFocused()` refuses to
     * activate a disabled row even when it is otherwise navigable.
     *
     * @returns `true` by default.
     */
    isEnabled(): boolean {
        return true;
    }

    /**
     * Whether `Menu`'s roving arrow-key highlight may land on this row.
     * `false` by default, so a row hosting a real focusable control — which
     * owns its own DOM focus and keys — is skipped by `focusNext` /
     * `focusPrev` exactly like a separator. Override to `true` for a row
     * that behaves like a menu item: it then receives the highlight, and
     * Enter activates it via {@link activate}.
     *
     * @returns `false` by default.
     */
    isNavigable(): boolean {
        return false;
    }

    /**
     * Applies or removes the keyboard/hover focus highlight background,
     * reading the CSS-variable family selected by {@link setCssVarPrefix}.
     *
     * @param focused - `true` to highlight, `false` to clear.
     * @returns This row, for method chaining.
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
     * Activates this row as if the user clicked or pressed Enter on it.
     * Called by `Menu.activateFocused()` for a navigable, enabled row. A
     * no-op by default; a subclass with an activation behaviour overrides it.
     */
    activate(): void {
        // No-op by default.
    }

    /**
     * Whether this row reserves the menu's shared leading checkmark column.
     *
     * @returns `false` by default.
     */
    hasCheck(): boolean {
        return false;
    }

    /**
     * Whether this row reserves the menu's shared leading icon column.
     *
     * @returns `false` by default.
     */
    hasIcon(): boolean {
        return false;
    }

    /**
     * Whether this row opens a child submenu. Only `MenuItem` ever reports
     * `true` — a custom row has no hook to open a submenu panel.
     *
     * @returns `false` by default.
     */
    hasSubmenu(): boolean {
        return false;
    }

    /**
     * This row's measured title width, feeding the menu's shared title column.
     *
     * @returns `0` by default — a row contributing no title-column metrics.
     */
    titleTextWidth(): number {
        return 0;
    }

    /**
     * This row's measured shortcut width, feeding the menu's shared
     * shortcut / chevron zone.
     *
     * @returns `0` by default.
     */
    shortcutTextWidth(): number {
        return 0;
    }

    /**
     * This row's own content width, measured to the right of wherever
     * `Menu` positions the row's content — exclude any left-inset
     * assumption of your own; `Menu` adds the shared `iconStart` uniformly
     * across every row when reserving panel width, since a row cannot know
     * here whether a sibling row widens it via `hasCheck()` / `hasIcon()`.
     * Read by `Menu.layOutColumns` **before** {@link setColumns} is called,
     * so an override must not depend on the injected `iconStart` value
     * itself. Floors the panel's natural width, so a row contributing no
     * title/shortcut metrics still gets enough room to render.
     *
     * @returns `0` by default.
     */
    getContentWidth(): number {
        return 0;
    }

    /**
     * Applies the menu-computed shared column geometry. A no-op by
     * default — a custom row opts out of the shared grid and renders across
     * the row's full width. A row that wants to line up with the
     * `MenuItem`s around it overrides this and stores the `iconStart` it is
     * handed.
     *
     * @param _checkZone - Width reserved for the leading checkmark column, in
     *   pixels; `0` when no item in the menu declares `checked`.
     * @param _iconStart - The title's left offset in pixels; already includes `checkZone`.
     * @param _titleColumn - The shared title-column width across the menu's items.
     */
    setColumns(_checkZone: number, _iconStart: number, _titleColumn: number): void {
        // No-op by default.
    }

    /**
     * Selects which CSS-variable family {@link setFocused} reads its hover
     * highlight colours from. Called by the owning `Menu` immediately after
     * building this row from a `row` factory — not for consumer use.
     *
     * @param prefix - `"menu-bar"` or `"context-menu"`, matching the owning menu's mode.
     * @returns This row, for method chaining.
     */
    setCssVarPrefix(prefix: MenuItemCSSVarPrefix): this {
        this._cssVarPrefix = prefix;

        return this;
    }

    /**
     * Injects the callback that dismisses the owning menu. Called by the
     * owning `Menu` immediately after building this row from a `row`
     * factory — not for consumer use. A factory row has no reference to its
     * menu, so this is the only way a subclass can close the panel it is
     * hosted in, via its inherited protected close helper.
     *
     * @param close - Callback that dismisses the owning menu.
     */
    setMenuCloseHandler(close: () => void): void {
        this._closeMenu = close;
    }

    /**
     * Returns the CSS-variable family currently selected via
     * {@link setCssVarPrefix}.
     *
     * @returns The active CSS-variable prefix.
     */
    protected getCssVarPrefix(): MenuItemCSSVarPrefix {
        return this._cssVarPrefix;
    }

    /**
     * Dismisses the owning menu, if one was injected via
     * {@link setMenuCloseHandler}. A no-op for a row constructed outside a
     * `Menu` (e.g. in isolation in a test).
     *
     * This is the extension point a consumer-written `MenuRow` subclass calls
     * to dismiss the panel hosting it — e.g. an "Apply and close" row. No
     * shipped subclass calls it, because none needs to; a factory-built row
     * has no other way to reach its menu.
     */
    protected closeMenu(): void {
        this._closeMenu?.();
    }
}
