// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../Component.js";
import { Event } from "../../Event.js";
import { Util } from "../../Util.js";
import { Insets } from "../../Insets.js";
import { BorderStyle } from "../../BorderStyle.js";
import { VBox } from "../../layout/VBox.js";
import { MenuItem, MenuItemConfig } from "./MenuItem.js";

/** Pixel width used for every MenuPanel. */
const PANEL_WIDTH = 220;

/**
 * A floating vertical dropdown panel that contains `MenuItem` rows.
 *
 * Items are constructed once in the constructor and reused across open/close cycles —
 * no rebuild-on-open. `open()` appends the panel to `document.documentElement` and
 * positions it below an anchor element (or to the side of a parent panel for submenus).
 * `close()` detaches it from the DOM without destroying the items.
 *
 * @example
 * ```typescript
 * const panel = new MenuPanel(
 *     [{ text: 'Save', shortcut: 'Ctrl+S', action: () => save() }],
 *     () => bar.closeMenu()
 * );
 * panel.open(buttonElement);
 * ```
 */
export class MenuPanel extends Component {

    private readonly _menuItems: MenuItem[];
    private readonly _onClose: () => void;
    private _focusedIndex: number = -1;
    private _openSubmenuPanel: MenuPanel | null = null;
    private _openSubmenuItem: MenuItem | null = null;
    private _excludedEl: HTMLElement | null = null;
    private readonly _onViewportMouseDown: (e: MouseEvent) => void;

    /**
     * Constructs a MenuPanel and builds all item components immediately.
     *
     * @param items - The menu item configurations.
     * @param onClose - Callback invoked when the panel should close (item activated or outside click).
     */
    constructor(items: MenuItemConfig[], onClose: () => void) {
        super();

        this._onClose = onClose;
        this._menuItems = [];

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
        // Width fixed, height varies per item count — layout containment is safe.
        this.setElementCSSRule("contain", "layout");

        const vbox = new VBox();
        vbox.setComponentSpacing(0);
        vbox.setStretching(true);
        this.setLayoutManager(vbox);

        this.pauseLayout();

        for (const config of items) {
            const item = new MenuItem(
                config,
                () => { this._onClose(); },
                (hoveredItem) => { this.handleItemOpenSubmenu(hoveredItem); }
            );

            this.addComponent(item);
            this._menuItems.push(item);
        }

        this.resumeLayout();

        this.setWidth(PANEL_WIDTH);

        this._onViewportMouseDown = (e: MouseEvent) => {
            const target = e.target as Node;

            if (!this.containsTarget(target) && !this._excludedEl?.contains(target)) {
                this._onClose();
            }
        };
    }

    /**
     * Opens this panel positioned below the anchor element (top-level) or to the
     * right of the parent panel (submenu). Appends to `document.documentElement`.
     *
     * @param anchorEl - The `HTMLElement` of the triggering button or menu item.
     * @param parentPanel - When set, positions the panel as a submenu of this parent.
     */
    open(anchorEl: HTMLElement, parentPanel?: MenuPanel): void {
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
    }

    /**
     * Closes this panel and any open child submenus. Detaches from the DOM.
     */
    close(): void {
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
    }

    /**
     * Moves keyboard focus to the item at the given index. Pass `-1` to clear focus.
     *
     * @param index - Zero-based item index, or `-1` to clear.
     */
    focusItem(index: number): void {
        this.setFocusedIndex(index);
    }

    /**
     * Moves focus to the next focusable item, wrapping around and skipping separators.
     */
    focusNext(): void {
        let next = this._focusedIndex + 1;

        while (next < this._menuItems.length && this._menuItems[next].isSeparator()) {
            next++;
        }

        if (next >= this._menuItems.length) {
            next = 0;

            while (next < this._menuItems.length && this._menuItems[next].isSeparator()) {
                next++;
            }
        }

        this.setFocusedIndex(next);
    }

    /**
     * Moves focus to the previous focusable item, wrapping around and skipping separators.
     */
    focusPrev(): void {
        let prev = this._focusedIndex - 1;

        while (prev >= 0 && this._menuItems[prev].isSeparator()) {
            prev--;
        }

        if (prev < 0) {
            prev = this._menuItems.length - 1;

            while (prev >= 0 && this._menuItems[prev].isSeparator()) {
                prev--;
            }
        }

        this.setFocusedIndex(prev);
    }

    /**
     * Activates the currently focused item. No-op when no item is focused or the item
     * is disabled or a separator.
     */
    activateFocused(): void {
        if (this._focusedIndex < 0 || this._focusedIndex >= this._menuItems.length) {
            return;
        }

        const item = this._menuItems[this._focusedIndex];

        if (!item.isSeparator() && item.isEnabled()) {
            item.activate();
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
     * Sets an element whose subtree is excluded from the outside-click-to-close check.
     *
     * Used by `MenuBar` to prevent a mousedown on its own buttons from closing the panel
     * before the button's click handler has a chance to toggle the menu.
     *
     * @param el - The element to exclude, or `null` to clear.
     */
    setExcludedElement(el: HTMLElement | null): void {
        this._excludedEl = el;
    }

    /**
     * Disposes all `MenuItem` children, removing their Event listeners.
     */
    dispose(): void {
        for (const item of this._menuItems) {
            item.dispose();
        }
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
            this._menuItems[this._focusedIndex].setFocused(false);
        }

        this._focusedIndex = index;

        if (index >= 0 && index < this._menuItems.length) {
            this._menuItems[index].setFocused(true);
        }
    }

    /**
     * Handles the open-submenu signal from a hovered or activated `MenuItem`.
     *
     * Closes any existing child submenu when the item has no submenu; opens or
     * switches to the child panel when it does.
     *
     * @param item - The `MenuItem` that triggered the signal.
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

        const submenuPanel = new MenuPanel(
            item.getSubmenuConfig()!.items,
            () => { this._onClose(); }
        );

        this._openSubmenuPanel = submenuPanel;
        this._openSubmenuItem = item;
        item.getAria().setExpanded(true);

        submenuPanel.open(item.getElement(true)!, this);
    }
}
