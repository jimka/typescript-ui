// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { LayerManager, DismissableLayer, LayerDismissMode } from "~/core/LayerManager.js";
import { clampIntoViewport } from "~/core/OverlayPosition.js";
import { fadeShow, fadeHideAndDetach } from "~/core/AnimatedDropdown.js";
import { Insets } from "~/primitive/Insets.js";
import { VBox } from "~/layout/VBox.js";
import { MenuItem, MenuItemConfig } from "~/component/container/MenuItem.js";
import { MenuSeparator } from "~/component/container/MenuSeparator.js";
import { callable } from "~/core/Callable.js";

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
 * Event.addListener(myComponent, 'contextmenu', (e: MouseEvent) => {
 *     e.preventDefault();
 *     menu.show(e.clientX, e.clientY, [
 *         { text: 'Cut',   action: () => cut() },
 *         { separator: true },
 *         { text: 'Paste', action: () => paste() },
 *     ]);
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

    private readonly _persistent: boolean;
    // A persistent menu's items provider, kept so each open() re-resolves it —
    // null when the items were passed as a fixed array (built once, never rebuilt).
    private readonly _itemsProvider: (() => MenuItemConfig[]) | null;
    private readonly _onClose: (() => void) | null;
    private _menuItems: Array<MenuItem | MenuSeparator> = [];
    private _focusedIndex: number = -1;
    private _openSubmenuPanel: Menu | null = null;
    private _openSubmenuItem: MenuItem | null = null;
    private _excludedEl: Handle | null = null;
    // An explicit rebuild-mode width set via setMenuWidth; null means size to
    // content (the widest item, clamped to [MIN_MENU_WIDTH, MAX_MENU_WIDTH]).
    private _menuWidth: number | null = null;
    private _rebuildOnClose: (() => void) | null = null;
    private _currentOpener: Handle | null = null;

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
     * Every title shares one column sized to the widest title; the shortcut/chevron
     * right zone is the widest of the shortcut column and a submenu chevron, so
     * shortcuts left-justify in a column and chevrons right-justify at the edge.
     * The width is clamped to `[MIN_MENU_WIDTH, MAX_MENU_WIDTH]`; when the ceiling
     * bites, the title column shrinks and its titles ellipsize. Measured from the
     * items directly so a menu reused across shows re-measures its new content.
     *
     * @returns The clamped panel width in pixels.
     */
    private layOutColumns(): number {
        const items = this._menuItems.filter(
            (i): i is MenuItem => i instanceof MenuItem && !i.isSeparator()
        );

        const iconStart    = items.some(i => i.hasIcon()) ? MenuItem.ICON_ZONE : MenuItem.TEXT_INSET;
        const maxTitle     = items.reduce((m, i) => Math.max(m, i.titleTextWidth()), 0);
        const maxShortcut  = items.reduce((m, i) => Math.max(m, i.shortcutTextWidth()), 0);
        const hasChevron   = items.some(i => i.hasSubmenu());
        const rightZone    = Math.max(maxShortcut, hasChevron ? MenuItem.CHEVRON_ZONE : 0);
        const rightReserve = rightZone > 0 ? MenuItem.TEXT_GAP + rightZone : 0;

        const natural = iconStart + maxTitle + rightReserve + MenuItem.RIGHT_PAD;
        const width   = Math.min(MAX_MENU_WIDTH, Math.max(MIN_MENU_WIDTH, natural));

        // When the ceiling bites, the title column absorbs the shortfall (titles
        // ellipsize); otherwise it is the full widest-title width.
        const titleColumn = Math.min(maxTitle, width - iconStart - rightReserve - MenuItem.RIGHT_PAD);

        for (const item of items) {
            item.setColumns(iconStart, titleColumn);
        }

        return width;
    }

    /**
     * Shows the menu at the given viewport coordinates, replacing any previously
     * displayed items with the new list. **Rebuild-mode only.**
     *
     * The menu is clamped to the visible viewport so it never overflows any edge.
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

        this._rebuildOnClose = onClose ?? null;
        this._excludedEl = excludeEl ?? null;

        for (const item of this._menuItems) {
            if (item instanceof MenuItem) {
                item.dispose();
            }
        }

        this._menuItems = [];
        this.removeAllComponents();

        this.pauseLayout();

        for (const config of configs) {
            const item: MenuItem | MenuSeparator = config.separator === true
                ? new MenuSeparator("context-menu")
                : new MenuItem(
                    config,
                    () => {
                        config.action?.();
                        this.hide();
                    },
                    (hoveredItem) => { this.handleItemOpenSubmenu(hoveredItem); },
                    "context-menu"
                );

            this.addComponent(item);
            this._menuItems.push(item);
        }

        this.resumeLayout();

        const contentWidth = this.layOutColumns();

        this.setWidth(this._menuWidth ?? contentWidth);

        const width       = this.getWidth();
        const totalHeight = this.getPreferredSize()?.height ?? 0;

        const el = this.getElement(true)!;

        const vp = DOM.source.getViewportSize();

        // Clamp the cursor point so the whole menu stays a VIEWPORT_MARGIN inside
        // every edge; a fitting menu's bottom then lands at `vp.height -
        // VIEWPORT_MARGIN`, so `available` equals `totalHeight` exactly and no
        // spurious scrollbar appears. `show()` only ever grows the menu downward
        // from the clamped top (never flipped above the cursor), so the room
        // below it is the correct available height.
        const clamped   = clampIntoViewport(x, y, { width, height: totalHeight }, vp, VIEWPORT_MARGIN);
        const available = vp.height - clamped.y - VIEWPORT_MARGIN;

        this.setX(clamped.x);
        this.setY(clamped.y);
        this.applyViewportHeightClamp(available, totalHeight);

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
     * *different* opener while the menu is open switches it to that opener. Plain
     * {@link show} stays the right call for right-click context menus, which
     * should reposition — not close — on a repeat trigger.
     *
     * @param openerEl - The element that triggers the menu; excluded from the
     *   outside-click check and used as the toggle identity.
     * @param x - Horizontal viewport coordinate to anchor the menu at.
     * @param y - Vertical viewport coordinate to anchor the menu at.
     * @param configs - Ordered list of item descriptors to render.
     * @param onClose - Optional callback invoked once when the menu next closes.
     *
     * @returns This menu, for method chaining.
     */
    toggleFor(openerEl: Handle, x: number, y: number, configs: MenuItemConfig[], onClose?: () => void): this {
        this.assertRebuildMode("toggleFor");

        // Same opener fired again while its menu is open: close it. Its pointerdown
        // was excluded from the dismissal above, so this click is the toggle-shut.
        if (this._currentOpener === openerEl) {
            this.hide();

            return this;
        }

        // Closed, or open for a different opener: (re)show anchored for this one.
        this.show(x, y, configs, onClose, openerEl);
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

            let x = parentRect.right;

            if (x + width > vp.width) {
                x = parentRect.left - width;
            }

            // A submenu grows down from the anchor item's top, and flips up
            // against that same top edge when there is more room above.
            const y = this.placeVertically(anchorRect.top, anchorRect.top, totalHeight, vp.height);

            this.setAutoCommitStyle(false);
            this.setX(Math.max(0, x));
            this.setY(Math.max(0, y));
            this.setAutoCommitStyle(true);
        } else {
            const anchorRect = DOM.source.getElementRect(anchorEl);

            let x = anchorRect.left;

            if (x + width > vp.width) {
                x = vp.width - width;
            }

            // A top-level dropdown grows down from the anchor's bottom, and
            // flips up against the anchor's top when there is more room above.
            const y = this.placeVertically(anchorRect.bottom, anchorRect.top, totalHeight, vp.height);

            this.setAutoCommitStyle(false);
            this.setX(Math.max(0, x));
            this.setY(Math.max(0, y));
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

        this.fadeOutAndDetach();

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
        for (const item of this._menuItems) {
            if (item instanceof MenuItem) {
                item.setFocused(false);
            }
        }
    }

    /**
     * Plays the standard menu-panel entrance fade. Cancels any in-flight
     * fade-out so the deferred detach skips removing the still-visible panel.
     */
    private fadeIn(): void {
        fadeShow(this, { durationMs: MENU_ANIM_DURATION_MS });
    }

    /**
     * Plays the standard menu-panel exit fade, then hides and detaches the
     * panel from the DOM when the transition completes. A fresh `show()` /
     * `open()` during the fade cancels the deferred detach.
     */
    private fadeOutAndDetach(): void {
        fadeHideAndDetach(this, { durationMs: MENU_ANIM_DURATION_MS });
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

        while (next < this._menuItems.length && this.isItemSeparator(next)) {
            next++;
        }

        if (next >= this._menuItems.length) {
            next = 0;

            while (next < this._menuItems.length && this.isItemSeparator(next)) {
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

        while (prev >= 0 && this.isItemSeparator(prev)) {
            prev--;
        }

        if (prev < 0) {
            prev = this._menuItems.length - 1;

            while (prev >= 0 && this.isItemSeparator(prev)) {
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

        const item = this._menuItems[this._focusedIndex];

        if (item instanceof MenuItem && !item.isSeparator() && item.isEnabled()) {
            item.activate();
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
     * Disposes all [`MenuItem`](/api/component/container/classes/MenuItem) children, removing their Event listeners.
     * **Persistent-mode only.**
     */
    dispose(): void {
        this.assertPersistentMode("dispose");

        for (const item of this._menuItems) {
            if (item instanceof MenuItem) {
                item.dispose();
            }
        }
    }

    /**
     * Applies the persistent-mode chrome (MenuBar dropdown CSS variables, aria role).
     */
    private applyPersistentChrome(): void {
        this.setBackgroundColor("var(--ts-ui-menu-bar-panel-bg, rgb(255, 255, 255))");
        this.setInsets(new Insets(4, 0, 4, 0));
        this.setBorder({ border: "1px solid var(--ts-ui-menu-bar-panel-border, rgb(200, 200, 200))" });
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");
        this.setShadow("var(--ts-ui-menu-bar-panel-shadow, 2px 4px 8px rgba(0, 0, 0, 0.15))");
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
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");
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
        this.setMaxSize(Number.MAX_VALUE, Math.max(0, availableHeight));
        this.setHeight(contentHeight);
    }

    /**
     * Resolves the persistent-mode panel's top coordinate and applies the
     * matching height clamp. The menu grows downward from `growTop` unless the
     * content overflows the room below *and* the room above the anchor is
     * larger, in which case it flips to grow upward from `anchorTop`. The room
     * is measured against the side the menu actually grows toward — never
     * re-derived from a clamped top, which would let a flipped, viewport-pinned
     * menu grow back down across its anchor. For the flipped case the returned
     * top is derived from the clamped height so the menu's bottom still meets
     * the anchor.
     *
     * @param growTop - The viewport edge the menu grows downward from.
     * @param anchorTop - The anchor edge the menu flips up against.
     * @param totalHeight - The unclamped preferred height (px) of the menu's items.
     * @param viewportHeight - The current viewport height (px).
     * @returns The resolved top coordinate (px) for the panel.
     */
    private placeVertically(growTop: number, anchorTop: number, totalHeight: number, viewportHeight: number): number {
        const roomBelow = viewportHeight - growTop - VIEWPORT_MARGIN;
        const roomAbove = anchorTop - VIEWPORT_MARGIN;

        if (totalHeight <= roomBelow || roomBelow >= roomAbove) {
            this.applyViewportHeightClamp(roomBelow, totalHeight);

            return growTop;
        }

        this.applyViewportHeightClamp(roomAbove, totalHeight);

        return anchorTop - Math.min(totalHeight, roomAbove);
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

        for (const item of this._menuItems) {
            if (item instanceof MenuItem) {
                item.dispose();
            }
        }

        this._menuItems = [];
        this._focusedIndex = -1;
        this.removeAllComponents();

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
            const item = new MenuItem(
                config,
                () => { config.action?.(); this._onClose!(); },
                (hoveredItem) => { this.handleItemOpenSubmenu(hoveredItem); }
            );

            this.addComponent(item);
            this._menuItems.push(item);
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

            if (prev instanceof MenuItem) {
                prev.setFocused(false);
            }
        }

        this._focusedIndex = index;

        if (index >= 0 && index < this._menuItems.length) {
            const next = this._menuItems[index];

            if (next instanceof MenuItem) {
                next.setFocused(true);
            }
        }
    }

    /**
     * Returns `true` if the item at the given index should be skipped during focus traversal.
     *
     * @param index - Zero-based item index.
     * @returns Whether the item is a separator (or [`MenuSeparator`](/api/component/container/classes/MenuSeparator) instance).
     */
    private isItemSeparator(index: number): boolean {
        const item = this._menuItems[index];

        if (item instanceof MenuSeparator) {
            return true;
        }

        if (item instanceof MenuItem) {
            return item.isSeparator();
        }

        return false;
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
