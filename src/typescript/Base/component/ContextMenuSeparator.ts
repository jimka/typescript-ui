// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../Component.js";

/**
 * A horizontal separator rule used inside a `ContextMenu` to visually group menu items.
 *
 * Renders as a thin border line. Width is set externally by `ContextMenu.doLayout()`.
 */
export class ContextMenuSeparator extends Component {

    /** Fixed pixel height of every separator. */
    static readonly HEIGHT: number = 9;

    constructor() {
        super();

        this.setHeight(ContextMenuSeparator.HEIGHT);
        this.setPreferredSize(0, ContextMenuSeparator.HEIGHT);
        this.setBackgroundColor("transparent");
        this.setElementCSSRule(
            "borderTop",
            "1px solid var(--ts-ui-context-menu-separator-color, rgb(220, 220, 220))"
        );
    }
}
