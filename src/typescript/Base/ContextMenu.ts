// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "./Component.js";
import { Event } from "./Event.js";
import { Util } from "./Util.js";
import { BorderStyle } from "./BorderStyle.js";
import { ContextMenuItem, ContextMenuItemConfig } from "./component/ContextMenuItem.js";
import { ContextMenuSeparator } from "./component/ContextMenuSeparator.js";
import { Insets } from "./Insets.js";
import { VBox } from "./layout/VBox.js";

/**
 * A floating right-click menu appended to `document.documentElement`.
 *
 * Call `show(x, y, items)` to display the menu at the given viewport coordinates.
 * The menu closes automatically when an item is clicked or when the user clicks
 * outside it. The same instance can be reused across multiple invocations.
 *
 * @example
 * ```typescript
 * const menu = new ContextMenu();
 * Event.addListener(myComponent, 'contextmenu', (e: MouseEvent) => {
 *     e.preventDefault();
 *     menu.show(e.clientX, e.clientY, [
 *         { text: 'Cut',   action: () => cut() },
 *         { text: 'Copy',  action: () => copy() },
 *         { separator: true },
 *         { text: 'Paste', action: () => paste() },
 *     ]);
 * });
 * ```
 */
export class ContextMenu extends Component {

    private menuWidth: number = 180;
    private items: Array<ContextMenuItem | ContextMenuSeparator> = [];

    /**
     * Stable reference stored in the constructor so `removeViewportListener`
     * can find and remove the exact same function object.
     */
    private readonly onViewportMouseDown: (e: MouseEvent) => void;

    constructor() {
        super();

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

        const vbox = new VBox();

        vbox.setComponentSpacing(0);
        vbox.setStretching(true);

        this.setLayoutManager(vbox);

        this.onViewportMouseDown = (e: MouseEvent) => {
            if (!this.getElement()?.contains(e.target as Node)) {
                this.hide();
            }
        };
    }

    /**
     * Shows the menu at the given viewport coordinates, replacing any previously
     * displayed items with the new list.
     *
     * The menu is clamped to the visible viewport so it never overflows any edge.
     *
     * @param x - Horizontal viewport coordinate (e.g. `MouseEvent.clientX`).
     * @param y - Vertical viewport coordinate (e.g. `MouseEvent.clientY`).
     * @param configs - Ordered list of item descriptors to render.
     */
    show(x: number, y: number, configs: ContextMenuItemConfig[]): void {
        for (const item of this.items) {
            if (item instanceof ContextMenuItem) {
                item.dispose();
            }
        }

        this.items = [];
        this.removeAllComponents();

        this.pauseLayout();

        for (const config of configs) {
            const item: ContextMenuItem | ContextMenuSeparator = config.separator === true
                ? new ContextMenuSeparator()
                : new ContextMenuItem(config, () => this.hide());

            this.addComponent(item);
            this.items.push(item);
        }

        this.resumeLayout();

        this.setWidth(this.menuWidth);

        const totalHeight = this.getPreferredSize()?.height ?? 0;

        this.setHeight(totalHeight);

        const el = this.getElement(true);

        this.doLayout();

        const vp = Util.getViewportSize();

        this.setX(Math.max(0, Math.min(x, vp.width - this.menuWidth)));
        this.setY(Math.max(0, Math.min(y, vp.height - totalHeight)));

        document.documentElement.appendChild(el);

        this.setVisible(true);

        Event.addViewportListener(this, "mousedown", this.onViewportMouseDown);
    }

    /**
     * Hides the menu and detaches it from the DOM.
     *
     * The instance remains alive and can be shown again by calling `show()`.
     */
    hide(): void {
        this.setVisible(false);
        this.removeElement();
        Event.removeViewportListener(this, "mousedown", this.onViewportMouseDown);
    }

    /**
     * Sets the pixel width of the menu panel.
     *
     * @param width - Width in pixels. Defaults to 180.
     */
    setMenuWidth(width: number): void {
        this.menuWidth = width;
    }
}
