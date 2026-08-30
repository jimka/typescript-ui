// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle, Rect } from "~/core/DOM.js";
import { LayerManager, DismissableLayer, LayerDismissMode } from "~/core/LayerManager.js";
import { positionAdjacent, positionAnchoredFlexible, positionFlexibleAnchored } from "~/core/OverlayPosition.js";
import { fadeShow, fadeHideAndDetach } from "~/core/OverlayFade.js";
import type { Animation } from "~/core/Animation.js";
import { Insets } from "~/primitive/Insets.js";
import { VBox } from "~/layout/VBox.js";
import { MenuItem, MenuItemConfig } from "~/component/container/MenuItem.js";
import { MenuSeparator } from "~/component/container/MenuSeparator.js";
import { MenuRow } from "~/component/container/MenuRow.js";
import { callable } from "~/core/Callable.js";
import { Util } from "~/core/Util.js";
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";

/**
 * Pixel bounds a content-sized menu panel clamps to. Menus size to their widest
 * item (via the layout manager's preferred width); the floor keeps a short menu
 * from looking cramped, and the ceiling stops a very long label running off-screen
 * (the item's title ellipsizes past it).
 */
const MIN_MENU_WIDTH = 120;
const MAX_MENU_WIDTH = 360;

/** Duration (ms) of the fade-in / fade-out transitions on every menu panel. */
const MENU_ANIM_DURATION_MS = 120;

/** Pixels kept between a clamped menu and the viewport edge so the panel
 *  border and shadow are never flush against the screen. Mirrors the small
 *  inset used by other floating panels; purely cosmetic breathing room. */
const VIEWPORT_MARGIN = 4;

/**
 * A zero-size rect at a cursor point. A cursor is a degenerate anchor: with
 * `left === right` and `top === bottom`, the adjacency and alignment flips
 * collapse to the same operation — grow down-right from the point, or end at it.
 * That is native context-menu behaviour, so a pointer needs no separate path.
 */
function pointRect(x: number, y: number): Rect {
    return { x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0 };
}

// Resting-tier chrome shared by both modes — see `## Architecture Decisions`'
// StyleAudit residue entry: `borderRadius` is identical in `applyRebuildChrome`
// and `applyPersistentChrome`, so it hoists here instead of being written
// per-instance by both.
const _defaultMenuStyleDefaults: StyleBag = {
    borderRadius: "var(--ts-ui-border-radius, 4px)",
};

/** `.persistent`'s chrome declarations, read by `ownStyleStates`' entry below. */
const MENU_PERSISTENT_DECLARATIONS: StyleBag = {
    backgroundColor: "var(--ts-ui-menu-bar-panel-bg, rgb(255, 255, 255))",
    border:          { border: "1px solid var(--ts-ui-menu-bar-panel-border, rgb(200, 200, 200))" },
    shadow:          "var(--ts-ui-menu-bar-panel-shadow, 2px 4px 8px rgba(0, 0, 0, 0.15))",
};

/**
 * A floating menu panel that operates in one of two modes:
 *
 * - **Rebuild mode** (`new Menu()`): a right-click context menu. Items are passed per
 *   `show(x, y, items)` call and disposed on the next show or hide.
 * - **Persistent mode** (`new Menu(items, onClose)`): a [`MenuBar`](/api/component/menubar/classes/MenuBar) dropdown. Items are
 *   built once in the constructor and reused across `open()` / `close()` cycles.
 *
 * The two API surfaces are disjoint by mode:
 * `show()` / `hide()` / `setMenuWidth()` are valid only in rebuild mode;
 * `open()` / `close()` / focus and submenu methods are valid only in persistent mode.
 *
 * @example
 * ```typescript
 * // Rebuild mode — right-click context menu
 * const menu = new Menu();
 * Event.addListener(myComponent, 'contextmenu', (e: MouseEvent): Event.ListenerResult => {
 *     menu.show(e.clientX, e.clientY, [
 *         { text: 'Cut',   action: () => cut() },
 *         { separator: true },
 *         { text: 'Paste', action: () => paste() },
 *     ]);
 *
 *     return { prevent: true };
 * });
 *
 * // Persistent mode — MenuBar dropdown
 * const panel = new Menu(
 *     [{ text: 'Save', shortcut: 'Ctrl+S', action: () => save() }],
 *     () => bar.closeMenu()
 * );
 * panel.open(buttonElement);
 * ```
 *
 * @category Components
 */
class Menu extends Component implements DismissableLayer {

    protected static readonly ownClassStyleDefaults: StyleBag = _defaultMenuStyleDefaults;

    // `.persistent`'s backgroundColor/border/shadow override the rebuild-mode
    // (resting) values `applyRebuildChrome` still writes per-instance — set
    // once at construction via `setStyleState(".persistent", true)` and never
    // retoggled, since a Menu's mode is fixed for its lifetime.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".persistent",
            extract: (): StyleBag => MENU_PERSISTENT_DECLARATIONS,
        },
    ];

    private readonly _persistent: boolean;
    // A persistent menu's items provider, kept so each open() re-resolves it —
    // null when the items were passed as a fixed array (built once, never rebuilt).
    private readonly _itemsProvider: (() => MenuItemConfig[]) | null;
    private readonly _onClose: (() => void) | null;
    // In both modes every entry is registered via `addComponent` (see
    // `showAnchored` / `buildPersistentItems`), so the `destructor()` override
    // below has no item disposal to do — the base class's recursive teardown
    // already disposes each item; the override exists only to cancel the
    // in-flight fades. (A prior override manually
    // re-disposed them here, guarded to persistent mode only via
    // `assertPersistentMode`. That guard was never reachable through ancestor
    // teardown — no `Menu` anywhere in the library is itself registered via
    // `addComponent` (`Table._columnContextMenu` / `TabBar._contextMenu` are
    // plain fields, never added as children), so an ancestor's `destructor()`
    // recursion can never reach a `Menu` at all. The loop was removed simply
    // because it was redundant, not because the guard made it unsafe.)
    private _menuItems: MenuRow[] = [];

    // In-flight fades, cancelled on teardown so their fallback timers cannot
    // fire against this menu's released element handle.
    private _fadeShowAnimation: Animation.CancelHandle | null = null;
    private _fadeHideAnimation: Animation.CancelHandle | null = null;
    private _focusedIndex: number = -1;
    private _openSubmenuPanel: Menu | null = null;
    private _openSubmenuItem: MenuItem | null = null;
    private _excludedEl: Handle | null = null;
    // An explicit rebuild-mode width set via setMenuWidth; null means size to
    // content (the widest item, clamped to [MIN_MENU_WIDTH, MAX_MENU_WIDTH]).
    private _menuWidth: number | null = null;
    private _rebuildOnClose: (() => void) | null = null;
    private _currentOpener: Handle | null = null;
    // Rebuild-mode: when true, each show() scrolls the menu to the bottom after
    // layout so the latest (bottom-most) items are visible on open.
    private _scrollToBottomOnShow: boolean = false;
    // True for a submenu panel (set by handleItemOpenSubmenu right after
    // construction): a submenu is single-use, a fresh instance built on every
    // open, so once closed it is never reused — unlike a persistent top-level
    // dropdown, its close() should dispose it once its fade completes rather
    // than just fading-and-detaching it for reuse.
    private _disposeOnClose: boolean = false;

    /**
     * Constructs a Menu. With no arguments, a rebuild-mode (right-click context)
     * menu whose items are supplied per `show()` call. With `items` (and `onClose`),
     * a persistent-mode ([`MenuBar`](/api/component/menubar/classes/MenuBar) dropdown)
     * menu whose items are built immediately and reused across `open()` / `close()`
     * cycles.
     *
     * A single optional-parameter signature, deliberately not an overload pair: the
     * `callable()` export's construct/call type is derived via TS `ConstructorParameters`,
     * which captures only the *last* overload — an overload pair would drop the
     * no-arg form and make `Menu()` a type error for consumers.
     *
     * @param items - The menu item configurations, or a provider called once now
     *   to produce them. A submenu is rebuilt on each open, so a provider passed
     *   for a submenu's items is re-invoked every time that submenu opens. Omit for
     *   a rebuild-mode context menu.
     * @param onClose - Callback invoked when the panel should close (item activated or outside click).
     */
    constructor(items?: MenuItemConfig[] | (() => MenuItemConfig[]), onClose?: () => void) {
        super();

        this._persistent = items !== undefined;
        this._itemsProvider = typeof items === "function" ? items : null;
        this._onClose = onClose ?? null;

        const vbox = new VBox();

        vbox.setComponentSpacing(0);
        vbox.setStretching(true);

        this.setLayoutManager(vbox);

        if (this._persistent) {
            this.applyPersistentChrome();
            // Fixed array: build once now. A provider defers to open(), which
            // re-resolves it on every open (so the sole resolution is per-open).
            if (this._itemsProvider === null) {
                this.buildPersistentItems(items as MenuItemConfig[]);
            }
        } else {
            this.applyRebuildChrome();
        }
    }

    /**
     * Lays the menu's items into aligned columns and returns the panel width.
     * A leading check column is reserved when any item declares `checked`, so
     * a checked and an unchecked row's icon and title still start at the same
     * x position. Every title shares one column sized to the widest title;
     * the shortcut/chevron right zone is the widest of the shortcut column
     * and a submenu chevron, so shortcuts left-justify in a column and
     * chevrons right-justify at the edge. The width is clamped to
     * `[MIN_MENU_WIDTH, MAX_MENU_WIDTH]`; when the ceiling bites, the title
     * column shrinks and its titles ellipsize. Measured from the items
     * directly so a menu reused across shows re-measures its new content. A
     * custom row (built from a `MenuItemConfig.row` factory) contributes no
     * title/shortcut metrics by default, so the panel's natural width is
     * floored with the widest row's own `getContentWidth()` report.
     *
     * The clamp and every row's column geometry are computed against the
     * panel's CONTENT box (matching `RIGHT_PAD`'s own "at the panel's inner
     * edge" contract); the panel's own left/right border is added only to the
     * returned value, so a caller applying it via `setWidth` (a border-box
     * write) hands rows exactly the content width this method measured them
     * against — short-changing it here previously starved every row's
     * content box by the panel's border thickness, invisible on a
     * `MenuItem`'s ellipsized title but a visible hard clip on an unellipsized
     * custom row's content (e.g. `CheckboxMenuRow`'s label).
     *
     * @returns The clamped panel width in pixels, border included.
     */
    private layOutColumns(): number {
        const rows = this._menuItems.filter(row => !row.isSeparator());

        const checkZone    = rows.some(r => r.hasCheck()) ? MenuItem.CHECK_ZONE : 0;
        const iconStart    = checkZone + (rows.some(r => r.hasIcon()) ? MenuItem.ICON_ZONE : MenuItem.TEXT_INSET);
        const maxTitle     = rows.reduce((m, r) => Math.max(m, r.titleTextWidth()), 0);
        const maxShortcut  = rows.reduce((m, r) => Math.max(m, r.shortcutTextWidth()), 0);
        const hasChevron   = rows.some(r => r.hasSubmenu());
        const rightZone    = Math.max(maxShortcut, hasChevron ? MenuItem.CHEVRON_ZONE : 0);
        const rightReserve = rightZone > 0 ? MenuItem.TEXT_GAP + rightZone : 0;
        // A custom row contributes no title/shortcut metrics, so the panel
        // would be too narrow for it; floor the natural width with the widest
        // row's own report instead. `getContentWidth()` excludes any left
        // inset of its own — a row cannot know at this point whether a
        // sibling row widens the shared `iconStart` via `hasCheck()` /
        // `hasIcon()` — so `iconStart` (just computed above) is added here,
        // uniformly, on Menu's side.
        const maxContent   = iconStart + rows.reduce((m, r) => Math.max(m, r.getContentWidth()), 0);

        const natural = Math.max(iconStart + maxTitle + rightReserve + MenuItem.RIGHT_PAD, maxContent);
        const width   = Math.min(MAX_MENU_WIDTH, Math.max(MIN_MENU_WIDTH, natural));

        // When the ceiling bites, the title column absorbs the shortfall (titles
        // ellipsize); otherwise it is the full widest-title width.
        const titleColumn = Math.min(maxTitle, width - iconStart - rightReserve - MenuItem.RIGHT_PAD);

        for (const row of rows) {
            row.setColumns(checkZone, iconStart, titleColumn);
        }

        const border = this.getBorderSize();

        return width + border.left + border.right;
    }

    /**
     * Shows the menu at the given viewport coordinates, replacing any previously
     * displayed items with the new list. **Rebuild-mode only.**
     *
     * The menu grows down-right from the cursor; when there is no room it flips
     * so its bottom / right edge ends at the cursor, never covering it. A menu
     * taller than the room on the side it lands on is capped there and scrolls.
     *
     * @param x - Horizontal viewport coordinate (e.g. `MouseEvent.clientX`).
     * @param y - Vertical viewport coordinate (e.g. `MouseEvent.clientY`).
     * @param configs - Ordered list of item descriptors to render.
     * @param onClose - Optional callback invoked once when the menu next closes
     *   (item activated or dismissed by an outside click), letting the opener
     *   revert an open-state affordance such as a rotated dropdown chevron.
     * @param excludeEl - Optional element whose subtree is exempt from the
     *   outside-click-to-close check. Pass the trigger that opened the menu (e.g.
     *   a [`SplitButton`](/api/component/button/classes/SplitButton) chevron) so a
     *   pointerdown on it does not self-close the menu before the trigger's own
     *   click can toggle it shut — mirroring [`MenuBar`](/api/component/menubar/classes/MenuBar)'s
     *   dropdown-button exclusion.
     */
    show(x: number, y: number, configs: MenuItemConfig[], onClose?: () => void, excludeEl?: Handle | null): this {
        this.assertRebuildMode("show");

        // The placement primitives only guarantee an on-screen result for an anchor
        // inside the viewport. A cursor from a real event always is; show() is public,
        // so pin it here rather than in showAnchored, which also takes real trigger
        // rects that may legitimately extend past a viewport edge.
        const vp = DOM.source.getViewportSize();

        return this.showAnchored(
            pointRect(Util.clamp(x, 0, vp.width), Util.clamp(y, 0, vp.height)),
            configs, onClose ?? null, excludeEl ?? null,
        );
    }

    /**
     * Rebuild-mode geometry-and-content core shared by {@link show} (pointer-anchored)
     * and {@link toggleFor} (rect-anchored). Both grow down-right from `anchorRect`
     * and flip per axis when the room runs short. Tears down and rebuilds the item
     * list, then resolves `anchorRect` to a placement and applies the resulting
     * position and height clamp.
     *
     * @param anchorRect - The cursor point (as a zero-size rect) or trigger rect to
     *   place the panel against.
     * @param configs - Ordered list of item descriptors to render.
     * @param onClose - Callback invoked once when the menu next closes, or `null`.
     * @param excludeEl - Element whose subtree is exempt from the outside-click
     *   check, or `null`.
     */
    private showAnchored(anchorRect: Rect, configs: MenuItemConfig[], onClose: (() => void) | null, excludeEl: Handle | null): this {
        this._rebuildOnClose = onClose;
        this._excludedEl = excludeEl;

        this._menuItems = [];
        this.disposeAllComponents();

        this.pauseLayout();

        for (const config of configs) {
            let row: MenuRow;

            if (config.separator === true) {
                row = new MenuSeparator("context-menu");
            } else if (config.row) {
                row = config.row();
                row.setCssVarPrefix("context-menu");
                row.setMenuCloseHandler(() => { this.dismissAll(); });
            } else {
                row = new MenuItem(
                    config,
                    () => {
                        config.action?.();

                        if (config.closeOnActivate === false) {
                            this.closeOpenSubmenu();
                        } else {
                            this.hide();
                        }
                    },
                    (hoveredItem) => { this.handleItemOpenSubmenu(hoveredItem); },
                    "context-menu"
                );
            }

            this.addComponent(row);
            this._menuItems.push(row);
        }

        this.resumeLayout();

        const contentWidth = this.layOutColumns();
        const naturalWidth = this._menuWidth ?? contentWidth;

        this.setWidth(naturalWidth);

        // A reused menu still carries the previous show's max-height — set by
        // `applyViewportHeightClamp` to that show's available room. Because
        // `getPreferredSize` clamps to the component's own max, leaving it in
        // place would cap the new content at the old height, so a menu that
        // grew past its previous size would neither expand nor reserve a
        // scrollbar gutter on reopen. Clear it before measuring.
        this.setMaxSize({ width: Number.MAX_VALUE, height: Number.MAX_VALUE });

        const totalHeight = this.getPreferredSize()?.height ?? 0;

        const el = this.getElement(true)!;

        const vp = DOM.source.getViewportSize();

        // First pass at the natural width resolves the vertical room. Width does not
        // affect the vertical placement, so `available` stays correct after the
        // scrollbar-gutter widening below; only `x` needs the second pass.
        const available = positionAnchoredFlexible(anchorRect, { width: naturalWidth, height: totalHeight }, vp, VIEWPORT_MARGIN).available;

        // When the content is taller than the room on the side the menu lands on,
        // `applyViewportHeightClamp` caps the height and the `overflow-y: auto`
        // scrollbar engages. Reserve its width as a right inset — and widen the
        // content-sized panel to match — so items lay out beside the native
        // scrollbar instead of beneath it. `Component.getInnerSize` subtracts the
        // inset, so the VBox stretches items to `naturalWidth`, unchanged from the
        // no-scroll case.
        const gutter = totalHeight > available ? DOM.source.getScrollBarWidth() : 0;

        this.setInsets(new Insets(4, gutter, 4, 0));
        this.setWidth(naturalWidth + gutter);

        const placement = positionAnchoredFlexible(anchorRect, { width: this.getWidth(), height: totalHeight }, vp, VIEWPORT_MARGIN);

        this.setX(placement.x);
        this.setY(placement.y);
        this.applyViewportHeightClamp(placement.available, totalHeight);

        this.scheduleLayout();

        LayerManager.mount(el);

        this.setVisible(true);
        this.fadeIn();

        // Join the central layer tree: the manager owns the outside-pointerdown /
        // window-blur / Escape dismissal and stamps the z-index. Registering while
        // whatever opened the menu is topmost links it under that layer, so a
        // context menu raised over a modal dialog inherits the dialog band and
        // paints in front of it.
        LayerManager.register(this);
        this.setZIndex(LayerManager.getZIndex(this));

        // Optionally reveal the bottom of the list on open (e.g. a history menu
        // whose latest entries sit at the bottom). Flush the scheduled layout
        // first so the item heights are committed and `getMaxScrollTop` is
        // accurate; when nothing overflows the offset is 0 and this is a no-op.
        if (this._scrollToBottomOnShow) {
            this.flushLayout();
            this.setScrollTop(this.getMaxScrollTop());
        }

        return this;
    }

    /**
     * Opens or closes the menu for a given opener element. **Rebuild-mode only.**
     *
     * This is the toggle form of {@link show} for a left-click dropdown trigger
     * (e.g. a [`SplitButton`](/api/component/button/classes/SplitButton) chevron
     * or a [`ToolBar`](/api/component/menubar/classes/ToolBar) overflow button):
     * the opener is excluded from the outside-click dismissal (so its own
     * pointerdown does not self-close the menu) and remembered, so a second press
     * of the *same* opener closes the menu instead of reopening it. Pressing a
     * *different* opener while the menu is open switches it to that opener. The
     * menu opens below `anchorRect` and flips above it when the room below is
     * short, right-aligning to it when the left alignment overflows. Plain
     * {@link show} stays the right call for right-click context menus, which
     * should reposition — not close — on a repeat trigger; the remaining
     * distinction from `toggleFor` is the toggle identity, the opener exclusion,
     * and the empty-list suppression below.
     *
     * An empty `configs` opens nothing: the menu is not shown, `onClose` fires once
     * so the opener can revert an open-state affordance, and no opener state is
     * recorded. A repeat press of the *same* opener still closes an open menu — the
     * toggle-shut branch runs before the empty check.
     *
     * @param openerEl - The element that triggers the menu; excluded from the
     *   outside-click check and used as the toggle identity.
     * @param anchorRect - The trigger's viewport rect (e.g.
     *   `DOM.source.getViewportRect(button)`); the menu opens below it and flips
     *   above it when the room below is short.
     * @param configs - Ordered list of item descriptors to render. An empty list
     *   opens nothing (see above).
     * @param onClose - Optional callback invoked once when the menu next closes,
     *   or when an empty `configs` suppresses the open.
     *
     * @returns This menu, for method chaining.
     */
    toggleFor(openerEl: Handle, anchorRect: Rect, configs: MenuItemConfig[], onClose?: () => void): this {
        this.assertRebuildMode("toggleFor");

        // Same opener fired again while its menu is open: close it. Its pointerdown
        // was excluded from the dismissal above, so this click is the toggle-shut.
        // MUST stay ahead of the empty check below — a provider that has since gone
        // empty must still be able to close the panel it opened.
        if (this._currentOpener === openerEl) {
            this.hide();

            return this;
        }

        // Nothing to show: an empty panel is never useful, so open nothing. `onClose`
        // still fires so the opener reverts an optimistic open-state affordance (e.g.
        // SplitButton's spun-up chevron), and `_currentOpener` stays untouched, so the
        // next press of this opener is a fresh open rather than a stale toggle-shut.
        if (configs.length === 0) {
            onClose?.();

            return this;
        }

        // Closed, or open for a different opener: (re)show anchored for this one.
        this.showAnchored(anchorRect, configs, onClose ?? null, openerEl);
        this._currentOpener = openerEl;

        return this;
    }

    /**
     * Hides the menu and detaches it from the DOM. **Rebuild-mode only.**
     *
     * The instance remains alive and can be shown again by calling `show()`.
     */
    hide(): this {
        this.assertRebuildMode("hide");

        this.closeOpenSubmenu();

        LayerManager.unregister(this);

        this.fadeOutAndDetach();

        // Forget the toggle opener so the next `toggleFor` for it opens rather
        // than seeing a stale match and closing an already-closed menu.
        this._currentOpener = null;

        // Fire the per-show close callback exactly once, clearing it first so a
        // later bare `hide()` (or re-show) can't re-invoke a stale opener's hook.
        const onClose = this._rebuildOnClose;
        this._rebuildOnClose = null;
        onClose?.();

        return this;
    }

    /**
     * Returns the current pixel width of the rebuild-mode menu panel (the
     * content-fit width, or an explicit override set via {@link setMenuWidth}).
     *
     * @returns The current panel width in pixels.
     */
    getMenuWidth(): number {
        return this.getWidth();
    }

    /**
     * Pins the rebuild-mode menu panel to an explicit width, overriding the
     * default content-fit sizing. **Rebuild-mode only.**
     *
     * @param width - Width in pixels.
     */
    setMenuWidth(width: number): this {
        this.assertRebuildMode("setMenuWidth");

        this._menuWidth = width;

        return this;
    }

    /**
     * Updates the `enabled` state of the row at `index`, in place — without
     * closing, rebuilding, or re-animating the panel. **Rebuild-mode only.**
     *
     * Lets a caller that deliberately keeps the panel open after an action
     * (e.g. a `CheckboxMenuRow`'s own toggle, which never closes the menu —
     * see `MenuItemConfig.closeOnActivate`) push a live availability change
     * into a *different*, sibling row, rather than leaving it stale until the
     * panel is next closed and reopened. No-op when `index` is out of range,
     * or names a separator or a custom `row()` factory row — a `MenuRow`
     * built from a factory owns its own enabled state (see
     * `MenuRow.isEnabled`) and has no shared update surface to push into.
     *
     * @param index - Zero-based index into the `configs` array passed to the
     *   `show()` / `toggleFor()` call that built the currently-displayed rows.
     * @param enabled - The row's new enabled state.
     *
     * @returns This menu, for method chaining.
     */
    setItemEnabled(index: number, enabled: boolean): this {
        this.assertRebuildMode("setItemEnabled");

        const row = this._menuItems[index];

        if (row instanceof MenuItem) {
            row.setEnabled(enabled);
        }

        return this;
    }

    /**
     * Controls whether the menu scrolls to the bottom of its item list each time
     * it is shown. **Rebuild-mode only.**
     *
     * Use this for a menu whose latest entries sit at the bottom (e.g. a
     * chronological notification history), so the most recent items are visible
     * on open rather than the user having to scroll down. A no-op when the list
     * fits without scrolling.
     *
     * @param value - `true` to scroll to the bottom on every show.
     *
     * @returns This menu, for method chaining.
     */
    setScrollToBottomOnShow(value: boolean): this {
        this.assertRebuildMode("setScrollToBottomOnShow");

        this._scrollToBottomOnShow = value;

        return this;
    }

    /**
     * Opens this panel positioned below the anchor element (top-level) or to the
     * right of the parent panel (submenu). Appends to `document.documentElement`.
     * **Persistent-mode only.**
     *
     * @param anchorEl - The `HTMLElement` of the triggering button or menu item.
     * @param parentPanel - When set, positions the panel as a submenu of this parent.
     */
    open(anchorEl: Handle, parentPanel?: Menu): this {
        this.assertPersistentMode("open");

        // A provider-sourced menu re-resolves its items on every open, so labels
        // and enabled state reflect current state each time it is shown (a submenu
        // is a fresh panel per open, but a reused top-level dropdown is not).
        if (this._itemsProvider) {
            this.rebuildPersistentItems(this._itemsProvider());
        }

        // Clear the previous open's max-height (set by `applyViewportHeightClamp`)
        // before measuring, so a provider-sourced dropdown that grew reflects its
        // new content height rather than being capped at the old available room.
        this.setMaxSize({ width: Number.MAX_VALUE, height: Number.MAX_VALUE });

        const totalHeight = this.getPreferredSize()?.height ?? (this._menuItems.length * MenuItem.HEIGHT + 8);
        const width       = this.getWidth();

        const el = this.getElement(true)!;
        LayerManager.mount(el);

        const vp = DOM.source.getViewportSize();

        if (parentPanel) {
            const parentEl = parentPanel.getElement();
            const parentRect = parentEl
                ? DOM.source.getElementRect(parentEl)
                : { left: 0, right: 0, top: 0, bottom: 0 };
            const anchorRect = DOM.source.getElementRect(anchorEl);

            // A submenu sits beside its parent panel: right of the parent's
            // right edge, flipping to the parent's left edge when the right
            // side overflows the viewport. No gap — flush, as today.
            const x = positionAdjacent(parentRect.left, parentRect.right, width, vp.width, 0);

            // A submenu grows down from the anchor item's top, and flips up
            // against that same top edge when there is more room above.
            const y = this.placeVertically(anchorRect.top, anchorRect.top, totalHeight, vp.height);

            this.setAutoCommitStyle(false);
            this.setX(Math.max(0, x));
            this.setY(Math.max(0, y));
            this.setAutoCommitStyle(true);
        } else {
            const anchorRect = DOM.source.getElementRect(anchorEl);

            // A top-level dropdown grows down from the anchor's bottom and flips
            // up against the anchor's top when the room below is short;
            // horizontally it aligns to the anchor's left edge, flipping to the
            // anchor's right edge when that overflows — the same primitive
            // rebuild-mode's showAnchored uses.
            const placement = positionAnchoredFlexible(anchorRect, { width, height: totalHeight }, vp, VIEWPORT_MARGIN);

            this.applyViewportHeightClamp(placement.available, totalHeight);

            this.setAutoCommitStyle(false);
            this.setX(Math.max(0, placement.x));
            this.setY(Math.max(0, placement.y));
            this.setAutoCommitStyle(true);
        }

        const anchorId = DOM.source.getId(anchorEl);

        if (anchorId) {
            this.getAria().setLabelledBy(anchorId);
        }

        this.setVisible(true);
        this.doLayout();
        this.fadeIn();

        // Join the central layer tree so the manager owns dismissal and the
        // z-stamp. A submenu opened via `open(item, this)` registers while its
        // parent menu is topmost, so it links under the parent — a pointerdown
        // inside the submenu counts as inside the parent (cross-portal
        // containment) and keeps the whole chain open.
        LayerManager.register(this);
        this.setZIndex(LayerManager.getZIndex(this));

        return this;
    }

    /**
     * Closes this panel and any open child submenus. Detaches from the DOM.
     * **Persistent-mode only.**
     */
    close(): this {
        this.assertPersistentMode("close");

        this.closeOpenSubmenu();

        this.setFocusedIndex(-1);
        this.clearItemHighlights();

        LayerManager.unregister(this);

        this.fadeOutAndDetach(this._disposeOnClose ? () => this.dispose() : undefined);

        return this;
    }

    /**
     * Clears the hover highlight from every item. A click that activates an item
     * dismisses the menu, detaching the panel from the DOM under the pointer; the
     * browser fires no `mouseout` for an element removed under a stationary
     * pointer, so the hovered item's `setFocused(true)` is never undone by
     * `_onMouseOut`. `setFocusedIndex(-1)` only resets the keyboard-tracked item,
     * not one highlighted purely by hover. Persistent-mode menus reuse these item
     * elements across open/close, so without this sweep the stale highlight
     * reappears the next time the menu opens.
     */
    private clearItemHighlights(): void {
        for (const row of this._menuItems) {
            if (row.isNavigable()) {
                row.setFocused(false);
            }
        }
    }

    /**
     * Plays the standard menu-panel entrance fade. Cancels any in-flight
     * fade-out so the deferred detach skips removing the still-visible panel.
     */
    private fadeIn(): void {
        this._fadeShowAnimation?.cancel();
        this._fadeShowAnimation = fadeShow(this, { durationMs: MENU_ANIM_DURATION_MS });
    }

    /**
     * Plays the standard menu-panel exit fade, then hides and detaches the
     * panel from the DOM when the transition completes. A fresh `show()` /
     * `open()` during the fade cancels the deferred detach.
     *
     * @param onComplete - Optional callback run once the fade-and-detach
     *   finishes (see {@link _disposeOnClose}), after the panel is hidden and
     *   detached.
     */
    private fadeOutAndDetach(onComplete?: () => void): void {
        this._fadeHideAnimation?.cancel();
        this._fadeHideAnimation = fadeHideAndDetach(this, { durationMs: MENU_ANIM_DURATION_MS, onComplete });
    }

    /**
     * Cancels any in-flight fade, then defers to the base class. Cancelling
     * first keeps a fade's fallback timer from firing after `super.destructor()`
     * has released this menu's element handle.
     */
    protected destructor(): void {
        this._fadeShowAnimation?.cancel();
        this._fadeShowAnimation = null;
        this._fadeHideAnimation?.cancel();
        this._fadeHideAnimation = null;

        // A still-open submenu is a raw field, not a registered child (see the
        // class comment above _menuItems: no Menu anywhere in the library is
        // registered via addComponent), so the child recursion in
        // super.destructor() below can never reach it.
        this._openSubmenuPanel?.dispose();
        this._openSubmenuPanel = null;

        // Cancelling the fades above suppresses whatever fade-completion callback
        // would otherwise have unregistered this menu from the layer tree
        // (mirrors AnimatedDropdown.destructor()). Idempotent, so an
        // already-closed menu costs nothing.
        LayerManager.unregister(this);

        super.destructor();
    }

    /**
     * Moves keyboard focus to the item at the given index. Pass `-1` to clear focus.
     * **Persistent-mode only.**
     *
     * @param index - Zero-based item index, or `-1` to clear.
     */
    focusItem(index: number): this {
        this.assertPersistentMode("focusItem");

        this.setFocusedIndex(index);

        return this;
    }

    /**
     * Moves focus to the next focusable item, wrapping around and skipping separators.
     * **Persistent-mode only.**
     */
    focusNext(): this {
        this.assertPersistentMode("focusNext");

        let next = this._focusedIndex + 1;

        while (next < this._menuItems.length && this.isItemSkipped(next)) {
            next++;
        }

        if (next >= this._menuItems.length) {
            next = 0;

            while (next < this._menuItems.length && this.isItemSkipped(next)) {
                next++;
            }
        }

        this.setFocusedIndex(next);

        return this;
    }

    /**
     * Moves focus to the previous focusable item, wrapping around and skipping separators.
     * **Persistent-mode only.**
     */
    focusPrev(): this {
        this.assertPersistentMode("focusPrev");

        let prev = this._focusedIndex - 1;

        while (prev >= 0 && this.isItemSkipped(prev)) {
            prev--;
        }

        if (prev < 0) {
            prev = this._menuItems.length - 1;

            while (prev >= 0 && this.isItemSkipped(prev)) {
                prev--;
            }
        }

        this.setFocusedIndex(prev);

        return this;
    }

    /**
     * Activates the currently focused item. No-op when no item is focused or the item
     * is disabled or a separator. **Persistent-mode only.**
     */
    activateFocused(): void {
        this.assertPersistentMode("activateFocused");

        if (this._focusedIndex < 0 || this._focusedIndex >= this._menuItems.length) {
            return;
        }

        const row = this._menuItems[this._focusedIndex];

        if (row.isNavigable() && row.isEnabled()) {
            row.activate();
        }
    }

    /**
     * Returns the index of the currently focused item, or `-1` if no item is focused.
     * **Persistent-mode only.**
     *
     * @returns The focused item index, or -1.
     */
    getFocusedIndex(): number {
        this.assertPersistentMode("getFocusedIndex");

        return this._focusedIndex;
    }

    /**
     * Sets an element whose subtree is excluded from the outside-click-to-close check.
     * **Persistent-mode only.**
     *
     * Used by [`MenuBar`](/api/component/menubar/classes/MenuBar) to prevent a pointerdown on its own buttons from closing the panel
     * before the button's click handler has a chance to toggle the menu.
     *
     * @param el - The element to exclude, or `null` to clear.
     */
    setExcludedElement(el: Handle | null): this {
        this.assertPersistentMode("setExcludedElement");

        this._excludedEl = el;

        return this;
    }

    /**
     * Returns the element whose subtree is currently excluded from the
     * outside-click-to-close check, or `null` if none is set.
     *
     * @returns The excluded element, or null.
     */
    getExcludedElement(): Handle | null {
        return this._excludedEl;
    }

    /**
     * Applies the persistent-mode chrome (MenuBar dropdown CSS variables, aria role).
     */
    private applyPersistentChrome(): void {
        this.setInsets(new Insets(4, 0, 4, 0));

        // The border is painted entirely by the shared `.persistent` rule
        // above, but `getBorderSize()`'s layout math reads the component's
        // own cached border spec, which a shared class rule can't update —
        // sync it without writing CSS (a real `setBorder` write here would
        // defeat the hoisting by duplicating the value onto every instance's
        // own rule). See `Button._applyFlatChrome` for the same pattern.
        this.cacheBorderSpec(MENU_PERSISTENT_DECLARATIONS.border!);
        this.setStyleState(".persistent", true);
        this.getAria().setRole("menu");
        this.setContain("layout");

        this.enableVerticalScroll();
    }

    /**
     * Applies the rebuild-mode chrome (right-click context-menu CSS variables).
     */
    private applyRebuildChrome(): void {
        this.setVisible(false);
        this.setBackgroundColor("var(--ts-ui-context-menu-bg, rgb(255, 255, 255))");
        this.setInsets(new Insets(4, 0, 4, 0));
        this.setBorder({ border: "1px solid var(--ts-ui-context-menu-border, rgb(200, 200, 200))" });
        this.setShadow("var(--ts-ui-context-menu-shadow, 2px 4px 8px rgba(0, 0, 0, 0.15))");
        this.setContain("layout");

        this.enableVerticalScroll();
    }

    /**
     * Wires the native vertical-scroll primitives so an over-tall menu scrolls
     * its items instead of overflowing the clamped panel height. This is the
     * `"y"` case of [`Panel.setAutoScroll`](/api/core/classes/Panel#setautoscroll)
     * replicated directly: `overflow-x: hidden` (so a `visible` x-axis does not
     * compute to `auto` and sprout a spurious horizontal scrollbar), `overflow-y:
     * auto`, and the layout manager's vertical overflow flag so the `VBox` lays
     * items out past the clamped inner height rather than compressing them.
     */
    private enableVerticalScroll(): void {
        this.setOverflowX("hidden");
        this.setOverflowY("auto");

        (this.getLayoutManager() as VBox).setOverflowing(false, true);
    }

    /**
     * Caps the menu's height to the vertical room available at its anchored
     * position, then applies the content height. Because `Menu` is a
     * `clampsToContentSize()` component, `setHeight` runs `contentHeight` through
     * `clampHeight`, which caps it at `availableHeight`; when the content fits no
     * clamp fires, and when it overflows the height is capped and the
     * `overflow-y: auto` scrollbar engages. Width is left unconstrained via the
     * `Number.MAX_VALUE` "no constraint" sentinel — horizontal scroll is a
     * non-goal.
     *
     * @param availableHeight - Vertical room (px) the menu may occupy at its anchor.
     * @param contentHeight - The unclamped preferred height (px) of the menu's items.
     */
    private applyViewportHeightClamp(availableHeight: number, contentHeight: number): void {
        this.setMaxSize({ width: Number.MAX_VALUE, height: Math.max(0, availableHeight) });
        this.setHeight(contentHeight);
    }

    /**
     * Resolves the persistent-mode panel's top coordinate and applies the
     * matching height clamp. The menu grows downward from `growTop` unless the
     * content overflows the room below *and* the room above the anchor is
     * larger, in which case it flips to grow upward from `anchorTop`. Delegates
     * the room/flip arithmetic to {@link positionFlexibleAnchored}, which measures
     * the room against the side the menu actually grows toward — never re-derived
     * from a clamped top, which would let a flipped, viewport-pinned menu grow
     * back down across its anchor.
     *
     * @param growTop - The viewport edge the menu grows downward from.
     * @param anchorTop - The anchor edge the menu flips up against.
     * @param totalHeight - The unclamped preferred height (px) of the menu's items.
     * @param viewportHeight - The current viewport height (px).
     * @returns The resolved top coordinate (px) for the panel.
     */
    private placeVertically(growTop: number, anchorTop: number, totalHeight: number, viewportHeight: number): number {
        const { start, available } = positionFlexibleAnchored(anchorTop, growTop, totalHeight, viewportHeight, VIEWPORT_MARGIN);

        this.applyViewportHeightClamp(available, totalHeight);

        return start;
    }

    /**
     * Tear down the current persistent items and rebuild them from `configs`.
     * Used by `open()` to re-resolve a provider-sourced dropdown each time it
     * shows, so its labels / enabled state track current state. Mirrors the
     * rebuild-mode `show()` teardown, then defers to {@link buildPersistentItems}.
     *
     * @param configs - The freshly-resolved item configurations.
     */
    private rebuildPersistentItems(configs: MenuItemConfig[]): void {
        this.closeOpenSubmenu();

        this._menuItems = [];
        this._focusedIndex = -1;
        this.disposeAllComponents();

        this.buildPersistentItems(configs);
    }

    /**
     * Builds the item list for persistent mode and sets the panel width.
     *
     * @param items - The item configs from the constructor.
     */
    private buildPersistentItems(items: MenuItemConfig[]): void {
        this.pauseLayout();

        for (const config of items) {
            let row: MenuRow;

            // Both build loops now differ only in their CSS-variable prefix
            // and their activate callback — see `showAnchored`'s loop and the
            // config-entry table in the plan's Architecture Decisions.
            if (config.separator === true) {
                row = new MenuSeparator("menu-bar");
            } else if (config.row) {
                row = config.row();
                // The default, made explicit so both build loops read alike.
                row.setCssVarPrefix("menu-bar");
                row.setMenuCloseHandler(() => { this.dismissAll(); });
            } else {
                row = new MenuItem(
                    config,
                    () => {
                        config.action?.();

                        if (config.closeOnActivate === false) {
                            this.closeOpenSubmenu();
                        } else {
                            this._onClose!();
                        }
                    },
                    (hoveredItem) => { this.handleItemOpenSubmenu(hoveredItem); }
                );
            }

            this.addComponent(row);
            this._menuItems.push(row);
        }

        this.resumeLayout();

        this.setWidth(this.layOutColumns());
    }

    /**
     * Updates the focused-item highlight, clearing the previous item and setting the new one.
     *
     * @param index - The new focused index, or -1 to clear.
     */
    private setFocusedIndex(index: number): void {
        if (this._focusedIndex >= 0 && this._focusedIndex < this._menuItems.length) {
            const prev = this._menuItems[this._focusedIndex];

            if (prev.isNavigable()) {
                prev.setFocused(false);
            }
        }

        this._focusedIndex = index;

        if (index >= 0 && index < this._menuItems.length) {
            const next = this._menuItems[index];

            if (next.isNavigable()) {
                next.setFocused(true);
            }
        }
    }

    /**
     * Returns `true` when the row at the given index must be skipped by the
     * arrow-key highlight — a separator, or a custom row that owns its own
     * focus (see [`MenuRow`](/api/component/container/classes/MenuRow)'s
     * navigable flag).
     *
     * @param index - Zero-based row index.
     * @returns Whether focus traversal skips this row.
     */
    private isItemSkipped(index: number): boolean {
        return !this._menuItems[index].isNavigable();
    }

    /**
     * Closes and forgets this menu's open child submenu, if any. Shared by the
     * teardown paths (`hide` / `close`) and by the submenu switch in
     * `handleItemOpenSubmenu` when a different item takes the child slot.
     */
    private closeOpenSubmenu(): void {
        if (this._openSubmenuPanel) {
            this._openSubmenuPanel.close();
            this._openSubmenuItem?.getAria().setExpanded(false);
            this._openSubmenuPanel = null;
            this._openSubmenuItem = null;
        }
    }

    /**
     * Closes the whole menu chain through the current mode's close path: the
     * persistent-mode `onClose` callback (a menubar dropdown), or `hide()` for a
     * rebuild-mode context menu — which also tears down any open child submenu.
     * Used by an activated submenu leaf and the outside-click / window-blur
     * dismissals, so a submenu selection closes the parent context menu too.
     */
    private dismissAll(): void {
        if (this._persistent) {
            this._onClose!();
        } else {
            this.hide();
        }
    }

    // ----- DismissableLayer -----

    /**
     * Returns the menu panel's root element for the central layer tree.
     *
     * @returns The menu's element, or null when not yet rendered.
     */
    getLayerElement(): Handle | null {
        return this.getElement() ?? null;
    }

    /**
     * Returns the dismiss mode the document-level handlers consult. A menu is
     * `"click-outside"`: dismissed by a `pointerdown` outside its layer subtree
     * (and its excluded trigger) and by a window blur, but never by a focus
     * move — exactly the pointerdown + window-blur behaviour the menu owned
     * before it joined the layer tree.
     *
     * @returns The layer dismiss mode.
     */
    getDismissMode(): LayerDismissMode {
        return "click-outside";
    }

    /**
     * Advisory close request from the manager (an outside `pointerdown`, a
     * window blur, or Escape). Routes through the mode-aware close chain: a
     * persistent (MenuBar) menu fires its `onClose`, a rebuild (context) menu
     * calls `hide()`; either way any open submenu is torn down.
     */
    requestClose(): void {
        this.dismissAll();
    }

    /**
     * Returns the trigger element excluded from the manager's outside-pointerdown
     * test — the context-menu opener passed to {@link show} / {@link toggleFor},
     * or the [`MenuBar`](/api/component/menubar/classes/MenuBar) button set via
     * {@link setExcludedElement} — so the gesture that opened the menu does not
     * immediately re-close it.
     *
     * @returns The excluded element, or null.
     */
    getAnchorElement(): Handle | null {
        return this._excludedEl;
    }

    /**
     * Returns the dropdown z-index band so an unrelated top-level menu stacks in
     * the dropdown family. A submenu — or a menu opened while another layer is
     * topmost — inherits its opener's band instead, so it rises above the
     * surface it was opened from.
     *
     * @returns The dropdown band base.
     */
    getBand(): number {
        return LayerManager.Band.Dropdown;
    }

    /**
     * Mirrors a manager-allocated z-index onto the element when the layer this
     * menu was opened inside is raised via the manager's bring-to-front path,
     * so an open menu never falls behind the surface it belongs to.
     *
     * @param zIndex - The fresh z-index assigned by the manager.
     */
    onZIndexChanged(zIndex: number): void {
        this.setZIndex(zIndex);
    }

    /**
     * Handles the open-submenu signal from a hovered or activated [`MenuItem`](/api/component/container/classes/MenuItem).
     *
     * Closes any existing child submenu when the item has no submenu (or is
     * disabled); opens or switches to the child panel when it does.
     *
     * @param item - The [`MenuItem`](/api/component/container/classes/MenuItem) that triggered the signal.
     */
    private handleItemOpenSubmenu(item: MenuItem): void {
        // A disabled item opens no submenu (even though it has one); like a plain
        // item, hovering it just closes any sibling submenu that is open.
        if (!item.hasSubmenu() || !item.isEnabled()) {
            this.closeOpenSubmenu();

            return;
        }

        if (this._openSubmenuItem === item) {
            return;
        }

        this.closeOpenSubmenu();

        const submenuPanel = new Menu(
            item.getSubmenuConfig()!.items,
            () => { this.dismissAll(); }
        );

        // A submenu is single-use — see _disposeOnClose — so its own close()
        // (via closeOpenSubmenu, below) disposes it once its fade completes
        // instead of fading-and-detaching it for reuse like a persistent
        // top-level dropdown.
        submenuPanel._disposeOnClose = true;

        this._openSubmenuPanel = submenuPanel;
        this._openSubmenuItem = item;
        item.getAria().setExpanded(true);

        submenuPanel.setExcludedElement(this.getElement(true)!);
        submenuPanel.open(item.getElement(true)!, this);
    }

    /**
     * Throws if the method called is not valid in the current mode (rebuild-only check).
     *
     * @param method - Name of the method that was invoked, used in the error message.
     */
    private assertRebuildMode(method: string): void {
        if (this._persistent) {
            throw new Error(`Menu.${method}() is only valid in rebuild mode (constructed without arguments).`);
        }
    }

    /**
     * Throws if the method called is not valid in the current mode (persistent-only check).
     *
     * @param method - Name of the method that was invoked, used in the error message.
     */
    private assertPersistentMode(method: string): void {
        if (!this._persistent) {
            throw new Error(`Menu.${method}() is only valid in persistent mode (constructed with items and onClose).`);
        }
    }
}

const MenuCallable = callable(Menu);
type MenuCallable = Menu;
export {
    Menu         as _Menu,
    MenuCallable as Menu
};
