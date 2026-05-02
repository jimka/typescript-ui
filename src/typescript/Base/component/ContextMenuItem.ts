// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";
import { CSS } from "../CSS.js";
import { Event } from "../Event.js";
import { Label } from "./Label.js";

/**
 * Configuration for a single context menu item.
 *
 * @remarks When `separator` is true the other fields are ignored; set only
 * `separator: true` to insert a horizontal rule between groups of items.
 */
export interface ContextMenuItemConfig {
    /** Display text shown in the menu row. */
    text?: string;
    /** Called when the user clicks an enabled item. */
    action?: () => void;
    /** Defaults to true. Disabled items are dimmed and non-clickable. */
    enabled?: boolean;
    /** When true the item renders as a `ContextMenuSeparator` instead. */
    separator?: boolean;
}

/**
 * A single row inside a `ContextMenu`.
 *
 * Displays a text label, highlights on hover, and calls the configured action
 * followed by hiding the parent menu when clicked.
 */
export class ContextMenuItem extends Component {

    /** Fixed pixel height of every menu item row. */
    static readonly HEIGHT: number = 24;

    private label: Label;
    private hoverCSSRule: CSSStyleRule;
    private clickListener: () => void;

    /**
     * @param config - Text, action, and enabled state for this item.
     * @param onHideMenu - Called after the action so the parent menu closes.
     */
    constructor(config: ContextMenuItemConfig, onHideMenu: () => void) {
        super();

        this.hoverCSSRule = CSS.createComponentRule(this.getId() + ":hover") as CSSStyleRule;

        const enabled = config.enabled !== false;

        if (enabled) {
            this.hoverCSSRule.style.setProperty(
                "background-color",
                "var(--ts-ui-context-menu-item-hover-bg, rgba(30, 100, 200, 0.12))"
            );
            this.setCursor("pointer");
        } else {
            this.hoverCSSRule.style.setProperty("background-color", "transparent");
            this.setForegroundColor(
                "var(--ts-ui-context-menu-item-disabled-color, rgb(170, 170, 170))"
            );
            this.setCursor("default");
        }

        this.setHeight(ContextMenuItem.HEIGHT);
        this.setPreferredSize(0, ContextMenuItem.HEIGHT);
        this.setBackgroundColor("transparent");

        this.label = new Label(config.text ?? "");
        this.label.setPointerEvents("none");
        this.label.setElementCSSRule("lineHeight", ContextMenuItem.HEIGHT + "px");
        this.label.setElementCSSRule("whiteSpace", "nowrap");
        this.label.setElementCSSRule("overflow", "hidden");
        this.label.setElementCSSRule("textOverflow", "ellipsis");
        this.addComponent(this.label);

        this.clickListener = () => {
            if (enabled) {
                config.action?.();
            }

            onHideMenu();
        };

        Event.addListener(this, "click", this.clickListener);
    }

    /**
     * Removes the click listener from the global event map.
     *
     * @remarks Must be called before the item is discarded to prevent a memory
     * leak in the Event system's listener map.
     */
    dispose(): void {
        Event.removeListener(this, "click", this.clickListener);
    }

    /**
     * Positions the label to fill the item with 8 px of horizontal padding.
     */
    doLayout(): void {
        super.doLayout();

        this.label.setX(8);
        this.label.setY(0);
        this.label.setWidth(Math.max(0, this.getWidth() - 16));
        this.label.setHeight(ContextMenuItem.HEIGHT);
    }
}
