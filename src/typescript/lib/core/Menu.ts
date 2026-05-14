// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Util } from "~/core/Util.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { Insets } from "~/primitive/Insets.js";
import { VBox } from "~/layout/VBox.js";
import { MenuItem, MenuItemConfig } from "~/component/container/MenuItem.js";
import { MenuSeparator } from "~/component/container/MenuSeparator.js";
import { callable } from "~/core/Callable.js";

/** Pixel width used for every persistent-mode `Menu` panel. */
const PANEL_WIDTH = 220;

/** Default pixel width used for rebuild-mode (right-click) `Menu` panels. */
const DEFAULT_REBUILD_WIDTH = 180;

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
    private readonly _onViewportMouseDown: (e: MouseEvent) => void;

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
                if (!this.containsTarget(target) && !this._excludedEl?.contains(target)) {
                    this._onClose!();
                }
            } else {
                if (!this.getElement()?.contains(target)) {
                    this.hide();
                }
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
     */
    show(x: number, y: number, configs: MenuItemConfig[]): this {
        this.assertRebuildMode("show");

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

        this.setHeight(totalHeight);

        const el = this.getElement(true);

        this.scheduleLayout();

        const vp = Util.getViewportSize();

        this.setX(Math.max(0, Math.min(x, vp.width - this._menuWidth)));
        this.setY(Math.max(0, Math.min(y, vp.height - totalHeight)));

        document.documentElement.appendChild(el);

        this.setVisible(true);

        Event.addViewportListener(this, "mousedown", this._onViewportMouseDown);

        return this;
    }

    /**
     * Hides the menu and detaches it from the DOM. **Rebuild-mode only.**
     *
     * The instance remains alive and can be shown again by calling `show()`.
     */
    hide(): this {
        this.assertRebuildMode("hide");

        this.setVisible(false);
        this.removeElement();

        Event.removeViewportListener(this, "mousedown", this._onViewportMouseDown);

        return this;
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

        this.setHeight(totalHeight);

        const el = this.getElement(true);
        document.documentElement.appendChild(el);

        const vp = Util.getViewportSize();

        if (parentPanel) {
            const parentEl = parentPanel.getElement();
            const parentRect = parentEl
                ? parentEl.getBoundingClientRect()
                : { left: 0, right: 0, top: 0, bottom: 0 };
            const anchorRect = anchorEl.getBoundingClientRect();

            let x = parentRect.right;
            let y = anchorRect.top;

            if (x + PANEL_WIDTH > vp.width) {
                x = parentRect.left - PANEL_WIDTH;
            }

            if (y + totalHeight > vp.height) {
                y = vp.height - totalHeight;
            }

            this.setAutoCommitStyle(false);
            this.setX(Math.max(0, x));
            this.setY(Math.max(0, y));
            this.setAutoCommitStyle(true);
        } else {
            const anchorRect = anchorEl.getBoundingClientRect();

            let x = anchorRect.left;
            let y = anchorRect.bottom;

            if (x + PANEL_WIDTH > vp.width) {
                x = vp.width - PANEL_WIDTH;
            }

            if (y + totalHeight > vp.height) {
                y = anchorRect.top - totalHeight;
            }

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

        Event.addViewportListener(this, "mousedown", this._onViewportMouseDown);

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
        this.setVisible(false);
        this.removeElement();

        Event.removeViewportListener(this, "mousedown", this._onViewportMouseDown);

        return this;
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
        this.setBorder({
            style: BorderStyle.SOLID,
            width: 1,
            color: "var(--ts-ui-menu-bar-panel-border, rgb(200, 200, 200))",
        });
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");
        this.setShadow("var(--ts-ui-menu-bar-panel-shadow, 2px 4px 8px rgba(0, 0, 0, 0.15))");
        this.getAria().setRole("menu");
        this.setElementCSSRule("contain", "layout");
    }

    /**
     * Applies the rebuild-mode chrome (right-click context-menu CSS variables).
     */
    private applyRebuildChrome(): void {
        this.setVisible(false);
        this.setZIndex(10000);
        this.setBackgroundColor("var(--ts-ui-context-menu-bg, rgb(255, 255, 255))");
        this.setInsets(new Insets(4, 0, 4, 0));
        this.setBorder({
            style: BorderStyle.SOLID,
            width: 1,
            color: "var(--ts-ui-context-menu-border, rgb(200, 200, 200))",
        });
        this.setBorderRadius("var(--ts-ui-border-radius, 4px)");
        this.setShadow("var(--ts-ui-context-menu-shadow, 2px 4px 8px rgba(0, 0, 0, 0.15))");
        this.setElementCSSRule("contain", "layout");
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
        if (this.getElement()?.contains(target)) {
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
