// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../../../Component.js";
import { Fit } from "../../../../layout/Fit.js";
import { Insets } from "../../../../Insets.js";
import { ThemeManager } from "../../../../Theme.js";

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
}