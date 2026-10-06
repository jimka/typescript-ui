// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Panel } from "~/core/Panel.js";
import { DOM } from "~/core/DOM.js";
import type { Handle, Rect } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { SpatialNavigation } from "~/core/SpatialNavigation.js";
import { MODIFIER_KEYS } from "~/core/Focusable.js";
import { LayerManager, DismissableLayer, LayerDismissMode } from "~/core/LayerManager.js";
import { positionAdjacent, positionAnchoredFlexible, positionFlexibleAnchored } from "~/core/OverlayPosition.js";
import { fadeShow, fadeHideAndDetach } from "~/core/OverlayFade.js";
import type { Animation } from "~/core/Animation.js";
import { Insets } from "~/primitive/Insets.js";
import { VBox } from "~/layout/VBox.js";
import { Fit } from "~/layout/Fit.js";
import { TRACK_WIDTH } from "~/component/container/Scrollbar.js";
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
 * `open()` / `close()` / `setExcludedElement()` are valid only in persistent mode.
 * The keyboard-highlight methods (`focusItem`, `focusNext`, `focusPrev`,
 * `activateFocused`, `getFocusedIndex`, `handleKey`) work in both.
 *
 * A menu is worked from the keyboard in one of two ways. A dropdown has a
 * host — the control that opened it — which keeps DOM focus and forwards its
 * keydowns to `handleKey`; the menu only moves its highlight. A context menu
 * has no host, so a `show()` that follows a key press (Shift+F10, the
 * ContextMenu key, `Enter` on a button whose action calls `show()`) takes DOM
 * focus on the menu panel instead: it highlights the first enabled row,
 * handles its own keys, and returns focus to the element that had it when
 * the menu closes. A `show()` that follows a pointer press takes no focus.
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

    // The input watch. A keyboard session starts when the user's last input
    // was a key press, so two viewport listeners record which came last: a
    // `keydown` or a `pointerdown`. A bare modifier and a key's auto-repeat
    // are not presses (see `_recordKeyInput`). `Event.addViewportListener`
    // binds a listener to a `Component` while these handlers are static —
    // one pair for the whole class — so a single stable sentinel owns them,
    // as `Tooltip`'s pointer watch does. Installed with the first `Menu` and
    // kept for the rest of the session.
    private static readonly inputWatchOwner: Component = new Component();
    private static inputWatching: boolean = false;
    private static lastInputWasKey: boolean = false;

    // Every menu with a live keyboard session: a rebuild-mode menu that took
    // DOM focus in `show()` and has not yet closed.
    private static readonly keyboardSessions: Set<Menu> = new Set();

    /**
     * Records a key press as the user's last input. Installed as the viewport
     * `keydown` watch. A bare modifier and an auto-repeat are left out: a
     * held Shift or Control keeps raising `keydown`s, and where the browser
     * raises `contextmenu` on the mouse button's release, one of those lands
     * between the `pointerdown` and the `show()` it leads to — a
     * Control-held right-click would then open as if from the keyboard.
     *
     * @param e - The keydown.
     */
    private static readonly _recordKeyInput = (e: KeyboardEvent): void => {
        const press = !e.repeat && !MODIFIER_KEYS.has(e.key);

        if (press) {
            Menu.lastInputWasKey = true;
        }
    };

    /** Records a pointer press as the user's last input. Installed as the viewport `pointerdown` watch. */
    private static readonly _recordPointerInput = (): void => {
        Menu.lastInputWasKey = false;
    };

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
    // The element that had DOM focus when this menu's keyboard session
    // started, and gets it back when the menu closes; null outside a session,
    // and for a session that started with nothing focused (see
    // takeKeyboardFocus for what "nothing" is in a browser).
    private _invoker: Handle | null = null;
    // A submenu panel's parent menu (set by handleItemOpenSubmenu right after
    // construction); null for a top-level menu.
    private _parentMenu: Menu | null = null;

    // Assigned in the constructor body, after super() returns. Menu overrides no
    // applyOptions, so no `declare` is needed (CODE_CONVENTIONS.md, super() cascade).
    private readonly _itemPanel: Panel;

    // The content-fit border-box width from layOutColumns(), before any scrollbar
    // widening. Cached because a reused menu must widen from its un-widened width,
    // not from whatever the previous open left committed.
    private _contentFitWidth: number = 0;

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

        this.setLayoutManager(new Fit());

        this._itemPanel = new Panel({
            layoutManager: new VBox({ spacing: 0, stretching: true }),
            autoScroll:    "y",
            scrollShadows: false,
            insets:        new Insets(4, 0, 4, 0),
        });

        this.addComponent(this._itemPanel);

        Menu._startInputWatch();

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
     * When the user's last press was a key and not a pointer button —
     * Shift+F10, the ContextMenu key, or `Enter` on a button whose action
     * calls this; a bare modifier and a key's auto-repeat do not count, and
     * nothing bounds how long ago the press was — the menu also
     * takes DOM focus: it highlights its first enabled row (the first row when
     * none is enabled), handles the arrow keys, `Home` / `End`, `Enter` /
     * `Space`, `ArrowRight` / `ArrowLeft` for submenus and `Tab` itself, and
     * returns focus to the element that had it when the menu closes. Focus is
     * returned before a closing row's `action` runs, and only while it is still
     * inside the menu. When the last press was a pointer button the menu takes
     * no focus and handles no key. A call made from a `keydown` handler, for
     * the key press being handled, is not guaranteed either outcome: the
     * press may not be on record yet when the handler runs.
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

        this.showAnchored(
            pointRect(Util.clamp(x, 0, vp.width), Util.clamp(y, 0, vp.height)),
            configs, onClose ?? null, excludeEl ?? null,
        );

        if (Menu.lastInputWasKey) {
            this.takeKeyboardFocus();
        }

        return this;
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
        this._focusedIndex = -1;
        // The row the panel named, if any, is about to be disposed.
        this.getAria().setActiveDescendant("");
        this._itemPanel.disposeAllComponents();

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
                        if (config.closeOnActivate !== false) {
                            this.rootMenu().returnFocusToInvoker();
                        }

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

            this._itemPanel.addComponent(row);
            this._menuItems.push(row);
        }

        this.resumeLayout();

        this._contentFitWidth = this.layOutColumns();

        const naturalWidth = this._menuWidth ?? this._contentFitWidth;

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

        this.applyScrollbarGutterWidth(totalHeight > available);

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
            this._itemPanel.setScrollTop(this._itemPanel.getMaxScrollTop());
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
     * A menu that took DOM focus when it opened returns it to the element that
     * had it, unless focus has since moved out of the menu.
     */
    hide(): this {
        this.assertRebuildMode("hide");

        this.returnFocusToInvoker();
        this.closeOpenSubmenu();
        this.setFocusedIndex(-1);

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
        // is a fresh panel per open, but a reused top-level dropdown is not). A
        // non-provider menu's items never change after construction, so
        // `_contentFitWidth` — set once by `buildPersistentItems` — never goes
        // stale and needs no re-measurement here.
        if (this._itemsProvider) {
            this.rebuildPersistentItems(this._itemsProvider());
        }

        // Clear the previous open's max-height (set by `applyViewportHeightClamp`)
        // before measuring, so a provider-sourced dropdown that grew reflects its
        // new content height rather than being capped at the old available room.
        this.setMaxSize({ width: Number.MAX_VALUE, height: Number.MAX_VALUE });

        const totalHeight = this.getPreferredSize()?.height ?? (this._menuItems.length * MenuItem.HEIGHT + 8);

        // Always measure from the un-widened content-fit width, never from
        // `getWidth()` — a reused menu's committed width may already include a
        // previous open's scrollbar-gutter widening, which must not compound.
        const width = this._contentFitWidth;

        const el = this.getElement(true)!;
        LayerManager.mount(el);

        const vp = DOM.source.getViewportSize();

        if (parentPanel) {
            const parentEl = parentPanel.getElement();
            const parentRect = parentEl
                ? DOM.source.getElementRect(parentEl)
                : { left: 0, right: 0, top: 0, bottom: 0 };
            const anchorRect = DOM.source.getElementRect(anchorEl);

            // A submenu grows down from the anchor item's top, and flips up
            // against that same top edge when there is more room above.
            const y = this.placeVertically(anchorRect.top, anchorRect.top, totalHeight, vp.height);

            // A submenu sits beside its parent panel: right of the parent's
            // right edge, flipping to the parent's left edge when the right
            // side overflows the viewport. No gap — flush, as today.
            const x = positionAdjacent(parentRect.left, parentRect.right, this.getWidth(), vp.width, 0);

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
            // rebuild-mode's showAnchored uses. First pass measures with natural
            // width to resolve available room, then widen if needed, then
            // measure horizontal placement.
            const available = positionAnchoredFlexible(anchorRect, { width, height: totalHeight }, vp, VIEWPORT_MARGIN).available;

            this.applyScrollbarGutterWidth(totalHeight > available);

            const placement = positionAnchoredFlexible(anchorRect, { width: this.getWidth(), height: totalHeight }, vp, VIEWPORT_MARGIN);

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

        // Ends a keyboard session that is still live, without moving focus: a
        // menu disposed while open has no say over where focus goes next.
        this.endKeyboardSession();

        super.destructor();
    }

    /**
     * Moves keyboard focus to the item at the given index. Pass `-1` to clear focus.
     *
     * @param index - Zero-based item index, or `-1` to clear.
     */
    focusItem(index: number): this {
        this.setFocusedIndex(index);

        return this;
    }

    /**
     * Moves focus to the next focusable item, wrapping around and skipping separators.
     */
    focusNext(): this {
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
     */
    focusPrev(): this {
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
     * is disabled or a separator.
     */
    activateFocused(): void {
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
     *
     * @returns The focused item index, or -1.
     */
    getFocusedIndex(): number {
        return this._focusedIndex;
    }

    /**
     * Handles one navigation or activation key forwarded by the menu's host.
     * Valid in both modes.
     *
     * This is the host-forwarded path: the host keeps DOM focus and forwards
     * its keydowns here, and the menu only moves its highlight — the same
     * model the library's dropdown hosts (`ComboBox`, the picker fields) use
     * for their own dropdown lists. A context menu that `show()` opened from
     * the keyboard has no host; it takes DOM focus and handles its own keys,
     * a wider set than the four handled here, so nothing needs forwarding to
     * it. `ArrowDown` / `ArrowUp` move the highlight to the
     * next / previous row, and `Enter` / `Space` activate the highlighted row.
     * `Enter` and `Space` are reported as handled even when no row is
     * highlighted, so the host does not run its own activation for them.
     * Every other key, `Escape` included, is left alone: `Escape` closes the
     * topmost layer through the layer manager, which closes this menu.
     *
     * @param e - The keydown the host received.
     *
     * @returns `true` when the key was one of the four the menu handles, so
     *   the host should consume it; `false` otherwise.
     */
    handleKey(e: KeyboardEvent): boolean {
        switch (e.key) {
            case "ArrowDown":
                this.focusNext();

                return true;

            case "ArrowUp":
                this.focusPrev();

                return true;

            case "Enter":
            case " ":
                this.activateFocused();

                return true;
        }

        return false;
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
    }

    /**
     * Applies the rebuild-mode chrome (right-click context-menu CSS variables, aria role).
     */
    private applyRebuildChrome(): void {
        this.setVisible(false);
        this.getAria().setRole("menu");
        this.setBackgroundColor("var(--ts-ui-context-menu-bg, rgb(255, 255, 255))");
        this.setBorder({ border: "1px solid var(--ts-ui-context-menu-border, rgb(200, 200, 200))" });
        this.setShadow("var(--ts-ui-context-menu-shadow, 2px 4px 8px rgba(0, 0, 0, 0.15))");
        this.setContain("layout");
    }

    /**
     * Commits the panel width for this open: the content-fit width (or the
     * explicit `setMenuWidth` override), plus the overlay scrollbar's track when
     * the item list will not fit the room at this anchor. The item panel reserves
     * that same track internally, so the extra width lands on the scrollbar band
     * and the rows keep the content width `layOutColumns` measured them against.
     *
     * @param overflows - Whether the content height exceeds the available room.
     */
    private applyScrollbarGutterWidth(overflows: boolean): void {
        const base = this._menuWidth ?? this._contentFitWidth;

        this.setWidth(base + (overflows ? TRACK_WIDTH : 0));
    }

    /**
     * Caps the menu's height to the vertical room available at its anchored
     * position, then applies the content height. Because `Menu` is a
     * `clampsToContentSize()` component, `setHeight` runs `contentHeight` through
     * `clampHeight`, which caps it at `availableHeight`; when the content fits no
     * clamp fires, and when it overflows the height is capped and the nested
     * scrolling panel's framework scrollbar engages, showing the scrollbar widget
     * and reserving its track width. Width is left unconstrained via the
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

        this.applyScrollbarGutterWidth(totalHeight > available);

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
        // The row the panel named, if any, is about to be disposed.
        this.getAria().setActiveDescendant("");
        this._itemPanel.disposeAllComponents();

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
                        if (config.closeOnActivate !== false) {
                            this.rootMenu().returnFocusToInvoker();
                        }

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

            this._itemPanel.addComponent(row);
            this._menuItems.push(row);
        }

        this.resumeLayout();

        this._contentFitWidth = this.layOutColumns();

        this.setWidth(this._contentFitWidth);
    }

    /**
     * Updates the focused-item highlight, clearing the previous item and setting the new one,
     * and names the highlighted row in the panel's `aria-activedescendant` (cleared when no
     * row takes the highlight).
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

        // "" clears the attribute: no row takes the highlight.
        let activeId = "";

        if (index >= 0 && index < this._menuItems.length) {
            const next = this._menuItems[index];

            if (next.isNavigable()) {
                next.setFocused(true);
                activeId = next.getActiveDescendantId();
            }
        }

        this.getAria().setActiveDescendant(activeId);
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
     * `handleItemOpenSubmenu` when a different item takes the child slot. A
     * submenu that holds DOM focus hands it to this panel first, whatever is
     * closing it, so focus never sits in a panel that has gone.
     */
    private closeOpenSubmenu(): void {
        if (this._openSubmenuPanel) {
            const heldFocus = LayerManager.containsAcrossLayers(this._openSubmenuPanel, DOM.source.getActiveElement());

            if (heldFocus) {
                this.focus(true);
            }

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

    // ----- Keyboard session -----

    /**
     * Installs the viewport listeners that record whether the user's last
     * input was a key press or a pointer press, unless they are already
     * installed. Called as each menu is constructed, and nothing removes them
     * afterwards: the answer has to be on record before the `show()` it
     * decides.
     */
    private static _startInputWatch(): void {
        if (Menu.inputWatching) {
            return;
        }

        Event.addViewportListener(Menu.inputWatchOwner, "keydown",     Menu._recordKeyInput);
        Event.addViewportListener(Menu.inputWatchOwner, "pointerdown", Menu._recordPointerInput);

        Menu.inputWatching = true;
    }

    /**
     * Removes the input watch and resets the recorded input to "pointer".
     * Nothing removes the watch during a session — see `_startInputWatch` —
     * so this exists for a test suite that replaces the DOM the registrations
     * were made against, which would otherwise leave them pointing at a
     * discarded window; for tests only. The next menu constructed starts the
     * watch again.
     *
     * @internal
     */
    static _stopInputWatch(): void {
        // Nothing to remove when the watch was never started, or was already
        // stopped: the removal reads the window, which a caller that has
        // already reset the DOM no longer has.
        if (Menu.inputWatching) {
            Event.removeViewportListener(Menu.inputWatchOwner, "keydown",     Menu._recordKeyInput);
            Event.removeViewportListener(Menu.inputWatchOwner, "pointerdown", Menu._recordPointerInput);

            Menu.inputWatching = false;
        }

        Menu.lastInputWasKey = false;
    }

    /**
     * Whether a live keyboard session's invoker is `container` or lies inside
     * it — that is, whether a menu opened from the keyboard is holding the
     * focus it took from an element in `container`. A table cell editor asks
     * this to keep its edit open while such a menu is up.
     *
     * @internal
     * @param container - The element to test, or `null`.
     * @returns `true` while such a session is live; `false` for `null`.
     */
    static hasKeyboardSessionFrom(container: Handle | null): boolean {
        if (container === null) {
            return false;
        }

        for (const menu of Menu.keyboardSessions) {
            const invoker = menu._invoker;
            // isRegistered first: every other read of a released handle throws.
            const inside  = invoker !== null && DOM.source.isRegistered(invoker) && DOM.source.contains(container, invoker);

            if (inside) {
                return true;
            }
        }

        return false;
    }

    /**
     * Starts this menu's keyboard session, unless one is already live, and
     * moves DOM focus to the panel. The session records the invoker — the
     * element that has focus now — and listens for the keys pressed on the
     * menu's panels and for the invoker taking focus back.
     */
    private takeKeyboardFocus(): void {
        const live = Menu.keyboardSessions.has(this);

        // The session is recorded before focus moves: the invoker's blur runs
        // inside focusPanel(), and CellEditor.retainsFocus reads the session there.
        if (!live) {
            const active = DOM.source.getActiveElement();
            const body   = DOM.source.getBody();

            // With nothing focused a browser reports `<body>`. It is no
            // invoker: every element of the page lies inside it, so any focus
            // move would read as the invoker taking focus back.
            this._invoker = active === body ? null : active;
            Menu.keyboardSessions.add(this);
            Event.addViewportListener(this, "keydown", this.onSessionKeyDown);
            Event.addViewportListener(this, "focusin", this.onSessionFocusIn);
        }

        this.focusPanel();
    }

    /**
     * Makes the panel focusable from script, focuses it, and highlights its
     * first enabled row, scrolling it into view. Used for the top-level menu
     * when a session starts and for a submenu panel when the keyboard moves
     * into it.
     */
    private focusPanel(): void {
        // -1: focusable from script, never a Tab stop.
        this.getAria().setTabIndex(-1);
        this.focus(true);
        this.highlightFirstEnabled();
        // A no-op unless the list opened scrolled away from its first rows.
        this.revealHighlightedRow();
    }

    /**
     * Highlights the first row that is navigable and enabled. When no row is
     * enabled, highlights the first navigable row instead, so a menu of
     * disabled rows still shows where the keyboard is; when no row is
     * navigable, clears the highlight.
     */
    private highlightFirstEnabled(): void {
        const enabled = this._menuItems.findIndex(row => row.isNavigable() && row.isEnabled());

        if (enabled >= 0) {
            this.setFocusedIndex(enabled);

            return;
        }

        this.setFocusedIndex(this._menuItems.findIndex(row => row.isNavigable()));
    }

    /**
     * Ends this menu's keyboard session and forgets its invoker. Moves no
     * focus. A no-op in effect when no session is live.
     *
     * @returns The invoker the session recorded, or `null`.
     */
    private endKeyboardSession(): Handle | null {
        const invoker = this._invoker;

        this._invoker = null;
        Menu.keyboardSessions.delete(this);
        Event.removeViewportListener(this, "keydown", this.onSessionKeyDown);
        Event.removeViewportListener(this, "focusin", this.onSessionFocusIn);

        return invoker;
    }

    /**
     * Ends this menu's keyboard session and returns DOM focus to its invoker.
     * Focus moves only when it is still inside this menu's chain — a row
     * action that opened a dialog, or an outside press about to focus what
     * was pressed, keeps the focus it has — and only to an invoker that has
     * not been disposed or removed from the page. A no-op when no session is
     * live, which is every menu opened with the pointer or driven by a host.
     */
    private returnFocusToInvoker(): void {
        const live = Menu.keyboardSessions.has(this);

        if (!live) {
            return;
        }

        // Read before the session ends and before any layer is unregistered.
        const heldFocus = LayerManager.containsAcrossLayers(this, DOM.source.getActiveElement());
        const invoker   = this.endKeyboardSession();
        // isRegistered first: isConnected throws on a released handle.
        const reachable = invoker !== null && DOM.source.isRegistered(invoker) && DOM.source.isConnected(invoker);

        if (heldFocus && reachable) {
            DOM.sink.focus(invoker, { preventScroll: true });
        }

        // After focus has moved: removing tabindex from the focused element would blur it.
        this.getAria().setTabIndex(null);
    }

    /**
     * The top-level menu of this menu's chain: this menu, or the root of the
     * parent it is a submenu of.
     *
     * @returns The top-level menu.
     */
    private rootMenu(): Menu {
        return this._parentMenu === null ? this : this._parentMenu.rootMenu();
    }

    /**
     * The panel of this menu's chain the keyboard is working: the deepest
     * open submenu that carries a highlight, or this menu.
     *
     * @returns The panel that holds the highlight.
     */
    private keyboardPanel(): Menu {
        const child = this._openSubmenuPanel;

        return child !== null && child._focusedIndex >= 0 ? child.keyboardPanel() : this;
    }

    /**
     * The panel of this menu's chain whose own element is `el`: this menu,
     * or one of its open submenus.
     *
     * @param el - The element to look for.
     * @returns The panel, or `null` when `el` is no panel of this chain.
     */
    private panelAt(el: Handle): Menu | null {
        const own = this.getElement() ?? null;

        if (own === el) {
            return this;
        }

        return this._openSubmenuPanel?.panelAt(el) ?? null;
    }

    /**
     * Viewport `keydown` handler, installed on the top-level menu while its
     * keyboard session is live. Hands a key pressed on one of the chain's
     * panels — the panel holding DOM focus — to that panel, and leaves alone
     * a key pressed anywhere else, such as on a focusable control inside a
     * custom row.
     *
     * @remarks A viewport listener, not one on the panel's own element. The
     * dispatcher runs element listeners and viewport listeners from two
     * separate window-level listeners whose order is not fixed, and a layer
     * beneath the menu decides whether a key is its own by asking whether it
     * is the topmost layer: a modal `Dialog` confirms on `Enter` that way.
     * Handled on the element, `Enter` could close the menu first and the
     * dialog would then take the same key for itself. Viewport listeners run
     * in the order their owning components first registered one for the
     * type, and a menu owns no other viewport `keydown` listener: this one is
     * registered when the session starts — after every layer that was
     * already open — so those layers always see the menu still open. A
     * second viewport `keydown` listener owned by a menu, registered earlier,
     * would move this one ahead of them and undo that.
     *
     * @param e - The keydown.
     *
     * @returns The panel's disposition for a key pressed on it, or nothing.
     */
    private onSessionKeyDown(e: KeyboardEvent): Event.ListenerResult {
        const target = e.target === null ? null : DOM.source.intern(e.target);
        const panel  = target === null ? null : this.panelAt(target);

        if (panel === null) {
            return;
        }

        return panel.onPanelKeyDown(e);
    }

    /**
     * Handles a keydown pressed on this panel while it holds DOM focus, which
     * only a keyboard session gives it. The arrow keys, `Home` and `End` move
     * the highlight; `Enter` and `Space` activate the highlighted row or
     * enter its submenu, once per press — their auto-repeat is consumed and
     * does nothing; `ArrowRight` enters a submenu and `ArrowLeft` leaves one;
     * `Tab` closes the whole chain and lets the key continue, so focus moves
     * on from the invoker. `Escape` is left to the layer manager, which
     * closes the topmost layer. Leaves alone any key `SpatialNavigation`
     * claims, and any key pressed with `Alt`, `Control` or `Meta`: those
     * chords belong to the browser or the application (`Alt+ArrowLeft` is
     * Back), not to the menu.
     *
     * @param e - The keydown on the panel.
     *
     * @returns A stop-and-prevent disposition for a key it consumed, or nothing.
     */
    private onPanelKeyDown(e: KeyboardEvent): Event.ListenerResult {
        const claimed = SpatialNavigation.claimsKey(e);
        const chord   = e.altKey || e.ctrlKey || e.metaKey;

        if (claimed || chord) {
            return;
        }

        switch (e.key) {
            case "ArrowDown":
            case "ArrowUp":
                this.handleKey(e);
                this.afterHighlightMove();

                return { stop: true, prevent: true };

            case "Home":
                this.setFocusedIndex(this._menuItems.findIndex(row => row.isNavigable()));
                this.afterHighlightMove();

                return { stop: true, prevent: true };

            case "End":
                // focusPrev from no highlight wraps to the last navigable row.
                this.focusItem(-1).focusPrev();
                this.afterHighlightMove();

                return { stop: true, prevent: true };

            case "ArrowRight":
                this.enterFocusedSubmenu();

                return { stop: true, prevent: true };

            case "ArrowLeft":
                this._parentMenu?.closeOpenSubmenu();

                return { stop: true, prevent: true };

            case "Enter":
            case " ":
                // A held key's auto-repeat is consumed and ignored. Enter on
                // a button whose action opens the menu is still down when the
                // panel takes focus, and its repeat would activate the first
                // row unasked.
                if (!e.repeat) {
                    this.activateOrEnterSubmenu();
                }

                return { stop: true, prevent: true };

            case "Tab":
                this.rootMenu().dismissAll();

                return;
        }

        return;
    }

    /**
     * Follows a keyboard move of the highlight: closes an open submenu, which
     * belonged to the row the highlight left, and scrolls the newly
     * highlighted row into view.
     */
    private afterHighlightMove(): void {
        this.closeOpenSubmenu();
        this.revealHighlightedRow();
    }

    /**
     * Scrolls the highlighted row into view. A no-op when no row is
     * highlighted, or the row is already visible.
     */
    private revealHighlightedRow(): void {
        const el = this._menuItems[this._focusedIndex]?.getElement();

        if (el) {
            this._itemPanel.revealDescendant(el);
        }
    }

    /**
     * Opens the highlighted row's submenu and moves the keyboard into it:
     * the submenu panel takes DOM focus and highlights its first enabled row.
     *
     * @returns `true` when a submenu was entered; `false` when the highlighted
     *   row has no submenu, is disabled, or no row is highlighted.
     */
    private enterFocusedSubmenu(): boolean {
        const row       = this._menuItems[this._focusedIndex];
        const enterable = row instanceof MenuItem && row.hasSubmenu() && row.isEnabled();

        if (!enterable) {
            return false;
        }

        this.handleItemOpenSubmenu(row);
        this._openSubmenuPanel?.focusPanel();

        return true;
    }

    /**
     * `Enter` / `Space` on the highlighted row: enters its submenu when it
     * has an enabled one, and activates the row otherwise.
     */
    private activateOrEnterSubmenu(): void {
        const entered = this.enterFocusedSubmenu();

        if (!entered) {
            this.activateFocused();
        }
    }

    /**
     * Viewport `focusin` handler, installed while a keyboard session is live.
     * When focus lands on the invoker, or inside it, while the menu is still
     * open, the panel holding the highlight takes it back. That keeps the
     * menu operable after a row that leaves the menu open runs a command that
     * refocuses the invoker — some do so asynchronously, after the row's
     * action has returned. Focus that moves anywhere else is left alone.
     */
    private onSessionFocusIn(): void {
        const active  = DOM.source.getActiveElement();
        const invoker = this._invoker;

        // isRegistered first: the invoker may have been disposed while the
        // menu was open, and every other read of a released handle throws.
        const backOnInvoker = active !== null && invoker !== null
            && DOM.source.isRegistered(invoker) && DOM.source.contains(invoker, active);

        if (backOnInvoker) {
            this.keyboardPanel().focus(true);
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
     * Mirrors every z-index the manager assigns this menu onto the element —
     * the one allocated at registration, each later one from a raise of the
     * menu or of the layer it was opened inside, and the one a compaction of
     * its band hands it — so an open menu never falls behind the surface it
     * belongs to.
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
        submenuPanel._parentMenu = this;

        this._openSubmenuPanel = submenuPanel;
        this._openSubmenuItem = item;
        item.getAria().setExpanded(true);

        // In a keyboard session every panel of the chain is focusable, however
        // it was opened: a press on a row of a submenu the pointer opened then
        // keeps focus inside the chain, where the session can find it, instead
        // of dropping it on the page.
        const sessionLive = Menu.keyboardSessions.has(this.rootMenu());

        if (sessionLive) {
            // -1: focusable from script and by a press, never a Tab stop.
            submenuPanel.getAria().setTabIndex(-1);
        }

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
