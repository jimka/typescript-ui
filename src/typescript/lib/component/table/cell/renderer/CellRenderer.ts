// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Fit } from "~/layout/Fit.js";
import { Insets } from "~/primitive/Insets.js";
import { Text } from "~/component/input/Text.js";
import { ThemeManager } from "~/core/Theme.js";

/**
 * Abstract base class for cell renderers.
 *
 * Subclasses display a typed value inside a table cell using a Fit layout with theme-driven padding.
 *
 * @category Components
 */
export abstract class CellRenderer<T> extends Component {

    constructor() {
        super();

        this.setLayoutManager(new Fit());

        // Inlined (rather than a private method) so CellRenderer and CellEditor stay
        // structurally compatible — BooleanCell relies on a CellEditor doubling as the
        // renderer, which fails if both classes declare a private member of the same name.
        const applyPadding = () => {
            const p = ThemeManager.getTheme().table.cell.padding;
            this.setInsets(new Insets(0, p, 0, p));
        };

        applyPadding();

        ThemeManager.onThemeChange(applyPadding);
    }

    /**
     * Returns the currently displayed value.
     *
     * @returns The rendered value of type T.
     */
    abstract getValue(): T;

    /**
     * Updates the displayed value.
     *
     * @param t - The value to render.
     */
    abstract setValue(t: T): void;

    /**
     * Runs the Fit layout, then synchronises the Text child's `line-height`
     * to its own element height. A single-line `<span>` whose `line-height`
     * matches its block height renders the text glyphs vertically centered;
     * without this, the line-box sits at the top of the cell and leaves the
     * empty space below.
     *
     * Cell renderer Texts have `setAutoMeasure(false)`, so `setLineHeight`
     * skips its DOM measurement and only writes the CSS rule.
     */
    doLayout(): this {
        super.doLayout();

        const children = this.getComponents();
        if (children.length !== 1) {
            return this;
        }

        const child = children[0];
        if (!(child instanceof Text)) {
            return this;
        }

        const h = child.getHeight();
        if (h > 0) {
            child.setLineHeight(h);
        }

        return this;
    }
}