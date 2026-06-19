// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { fadeShow, fadeHideAndDetach } from "~/core/AnimatedDropdown.js";
import { Insets } from "~/primitive/Insets.js";
import { VBox } from "~/layout/VBox.js";
import { MenuItem, MenuItemConfig } from "~/component/container/MenuItem.js";
import { MenuSeparator } from "~/component/container/MenuSeparator.js";
import { callable } from "~/core/Callable.js";

/** Pixel width used for every persistent-mode `Menu` panel. */
const PANEL_WIDTH = 220;

/** Default pixel width used for rebuild-mode (right-click) `Menu` panels. */
const DEFAULT_REBUILD_WIDTH = 180;

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
class Menu extends Component {

    private readonly _persistent: boolean;
    private readonly _onClose: (() => void) | null;
    private _menuItems: Array<MenuItem | MenuSeparator> = [];
    private _focusedIndex: number = -1;
    private _openSubmenuPanel: Menu | null = null;
    private _openSubmenuItem: MenuItem | null = null;
    private _excludedEl: HTMLElement | null = null;
    private _menuWidth: number = DEFAULT_REBUILD_WIDTH;
    private _rebuildOnClose: (() => void) | null = null;
    private _currentOpener: HTMLElement | null = null;
    private readonly _onViewportMouseDown: (e: MouseEvent) => void;
    private readonly _onWindowBlur: (e: FocusEvent) => void;

    /**
     * Constructs a rebuild-mode (right-click context) menu. Items are supplied per `show()` call.
     */
    constructor();
    /**
     * Constructs a persistent-mode ([`MenuBar`](/api/component/menubar/classes/MenuBar) dropdown) menu. Items are built immediately
     * and reused across `open()` / `close()` cycles.
     *
     * @param items - The menu item configurations.
     * @param onClose - Callback invoked when the panel should close (item activated or outside click).
     */
    constructor(items: MenuItemConfig[], onClose: () => void);
    constructor(items?: MenuItemConfig[], onClose?: () => void) {
        super();

        this._persistent = items !== undefined;
        this._onClose = onClose ?? null;

        const vbox = new VBox();

        vbox.setComponentSpacing(0);
        vbox.setStretching(true);

        this.setLayoutManager(vbox);

        if (this._persistent) {
            this.applyPersistentChrome();
            this.buildPersistentItems(items!);
        } else {
            this.applyRebuildChrome();
        }

        this._onViewportMouseDown = (e: MouseEvent) => {
            const target = e.target as Node;

            if (this._persistent) {
                if (!this.containsTarget(target) && !(this._excludedEl != null && DOM.source.contains(this._excludedEl, target))) {
                    this._onClose!();
                }
            } else {
                const menuEl = this.getElement();
                if (!(menuEl != null && DOM.source.contains(menuEl, target)) && !(this._excludedEl != null && DOM.source.contains(this._excludedEl, target))) {
                    this.hide();
                }
            }
        };

        // Closing the whole browser window's focus (clicking another app or
        // alt-tabbing) fires no in-page mousedown, so the mousedown dismissal
        // above never runs and the menu would stay open. A window blur closes
        // it. Viewport listeners are capture-phase, so element blurs from within
        // the menu surface here too; act only on a genuine window blur.
        this._onWindowBlur = (e: FocusEvent) => {
            if (!DOM.source.isWindow(e.target)) {
                return;
            }

            if (this._persistent) {
                this._onClose!();
            } else {
                this.hide();
            }
        };
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
     *   mousedown on it does not self-close the menu before the trigger's own
     *   click can toggle it shut — mirroring [`MenuBar`](/api/component/menubar/classes/MenuBar)'s
     *   dropdown-button exclusion.
     */
    show(x: number, y: number, configs: MenuItemConfig[], onClose?: () => void, excludeEl?: HTMLElement | null): this {
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
                    () => {},
                    "context-menu"
                );

            this.addComponent(item);
            this._menuItems.push(item);
        }

        this.resumeLayout();

        this.setWidth(this._menuWidth);

        const totalHeight = this.getPreferredSize()?.height ?? 0;

        const el = this.getElement(true);

        const vp = DOM.source.getViewportSize();

        // Fold VIEWPORT_MARGIN into the position clamp so a fitting menu's bottom
        // lands at `vp.height - VIEWPORT_MARGIN`; then `available` equals
        // `totalHeight` exactly and no spurious scrollbar appears. `show()` only
        // ever grows the menu downward from `top` (never flipped above the
        // cursor), so the room below `top` is the correct available height.
        const left = Math.max(VIEWPORT_MARGIN, Math.min(x, vp.width - this._menuWidth - VIEWPORT_MARGIN));
        const top = Math.max(VIEWPORT_MARGIN, Math.min(y, vp.height - totalHeight - VIEWPORT_MARGIN));
        const available = vp.height - top - VIEWPORT_MARGIN;

        this.setX(left);
        this.setY(top);
        this.applyViewportHeightClamp(available, totalHeight);

        this.scheduleLayout();

        DOM.sink.appendChild(DOM.source.getDocumentElement(), el);

        this.setVisible(true);
        this.fadeIn(el);

        Event.addViewportListener(this, "mousedown", this._onViewportMouseDown);
        Event.addViewportListener(this, "blur", this._onWindowBlur);

        return this;
    }

    /**
     * Opens or closes the menu for a given opener element. **Rebuild-mode only.**
     *
     * This is the toggle form of {@link show} for a left-click dropdown trigger
     * (e.g. a [`SplitButton`](/api/component/button/classes/SplitButton) chevron
     * or a [`ToolBar`](/api/component/menubar/classes/ToolBar) overflow button):
     * the opener is excluded from the outside-click dismissal (so its own
     * mousedown does not self-close the menu) and remembered, so a second press
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
    toggleFor(openerEl: HTMLElement, x: number, y: number, configs: MenuItemConfig[], onClose?: () => void): this {
        this.assertRebuildMode("toggleFor");

        // Same opener fired again while its menu is open: close it. Its mousedown
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

        Event.removeViewportListener(this, "mousedown", this._onViewportMouseDown);
        Event.removeViewportListener(this, "blur", this._onWindowBlur);

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
     * Returns the pixel width of the rebuild-mode menu panel.
     *
     * @returns The current panel width in pixels.
     */
    getMenuWidth(): number {
        return this._menuWidth;
    }

    /**
     * Sets the pixel width of the rebuild-mode menu panel. **Rebuild-mode only.**
     *
     * @param width - Width in pixels. Defaults to 180.
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
    open(anchorEl: HTMLElement, parentPanel?: Menu): this {
        this.assertPersistentMode("open");

        const totalHeight = this.getPreferredSize()?.height ?? (this._menuItems.length * MenuItem.HEIGHT + 8);

        const el = this.getElement(true);
        DOM.sink.appendChild(DOM.source.getDocumentElement(), el);

        const vp = DOM.source.getViewportSize();

        if (parentPanel) {
            const parentEl = parentPanel.getElement();
            const parentRect = parentEl
                ? DOM.source.getElementRect(parentEl)
                : { left: 0, right: 0, top: 0, bottom: 0 };
            const anchorRect = DOM.source.getElementRect(anchorEl);

            let x = parentRect.right;

            if (x + PANEL_WIDTH > vp.width) {
                x = parentRect.left - PANEL_WIDTH;
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

            if (x + PANEL_WIDTH > vp.width) {
                x = vp.width - PANEL_WIDTH;
            }

            // A top-level dropdown grows down from the anchor's bottom, and
            // flips up against the anchor's top when there is more room above.
            const y = this.placeVertically(anchorRect.bottom, anchorRect.top, totalHeight, vp.height);

            this.setAutoCommitStyle(false);
            this.setX(Math.max(0, x));
            this.setY(Math.max(0, y));
            this.setAutoCommitStyle(true);
        }

        const anchorId = anchorEl.id;

        if (anchorId) {
            this.getAria().setLabelledBy(anchorId);
        }

        this.setVisible(true);
        this.doLayout();
        this.fadeIn(this.getElement(true));

        Event.addViewportListener(this, "mousedown", this._onViewportMouseDown);
        Event.addViewportListener(this, "blur", this._onWindowBlur);

        return this;
    }

    /**
     * Closes this panel and any open child submenus. Detaches from the DOM.
     * **Persistent-mode only.**
     */
    close(): this {
        this.assertPersistentMode("close");

        if (this._openSubmenuPanel) {
            this._openSubmenuPanel.close();
            this._openSubmenuItem?.getAria().setExpanded(false);
            this._openSubmenuPanel = null;
            this._openSubmenuItem = null;
        }

        this.setFocusedIndex(-1);

        Event.removeViewportListener(this, "mousedown", this._onViewportMouseDown);
        Event.removeViewportListener(this, "blur", this._onWindowBlur);

        this.fadeOutAndDetach();

        return this;
    }

    /**
     * Plays the standard menu-panel entrance fade. Cancels any in-flight
     * fade-out so the deferred detach skips removing the still-visible panel.
     *
     * @param _el - The panel's root element (unused; retained for call-site clarity).
     */
    private fadeIn(_el: HTMLElement): void {
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
     * Used by [`MenuBar`](/api/component/menubar/classes/MenuBar) to prevent a mousedown on its own buttons from closing the panel
     * before the button's click handler has a chance to toggle the menu.
     *
     * @param el - The element to exclude, or `null` to clear.
     */
    setExcludedElement(el: HTMLElement | null): this {
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
    getExcludedElement(): HTMLElement | null {
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
        this.setZIndex(9999);
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
        this.setZIndex(10000);
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
     * Builds the item list for persistent mode and sets the panel width.
     *
     * @param items - The item configs from the constructor.
     */
    private buildPersistentItems(items: MenuItemConfig[]): void {
        this.pauseLayout();

        for (const config of items) {
            const item = new MenuItem(
                config,
                () => { this._onClose!(); },
                (hoveredItem) => { this.handleItemOpenSubmenu(hoveredItem); }
            );

            this.addComponent(item);
            this._menuItems.push(item);
        }

        this.resumeLayout();

        this.setWidth(PANEL_WIDTH);
    }

    /**
     * Returns `true` if the given DOM node is inside this panel or any open child submenu.
     *
     * @param target - The node to test for containment.
     * @returns Whether the target is within this panel's subtree.
     */
    private containsTarget(target: Node): boolean {
        const menuEl = this.getElement();
        if (menuEl != null && DOM.source.contains(menuEl, target)) {
            return true;
        }

        if (this._openSubmenuPanel?.containsTarget(target)) {
            return true;
        }

        return false;
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
     * Handles the open-submenu signal from a hovered or activated [`MenuItem`](/api/component/container/classes/MenuItem).
     *
     * Closes any existing child submenu when the item has no submenu; opens or
     * switches to the child panel when it does.
     *
     * @param item - The [`MenuItem`](/api/component/container/classes/MenuItem) that triggered the signal.
     */
    private handleItemOpenSubmenu(item: MenuItem): void {
        if (!item.hasSubmenu()) {
            if (this._openSubmenuPanel) {
                this._openSubmenuPanel.close();
                this._openSubmenuPanel = null;
                this._openSubmenuItem = null;
            }

            return;
        }

        if (this._openSubmenuItem === item) {
            return;
        }

        if (this._openSubmenuPanel) {
            this._openSubmenuPanel.close();
            this._openSubmenuItem?.getAria().setExpanded(false);
        }

        const submenuPanel = new Menu(
            item.getSubmenuConfig()!.items,
            () => { this._onClose!(); }
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
