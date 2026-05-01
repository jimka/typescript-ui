// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "../../../../Component.js";
import { Fit } from "../../../../layout/Fit.js";
import { Insets } from "../../../../Insets.js";
import { ThemeManager } from "../../../../Theme.js";

/**
 * Abstract base class for cell renderers.
 *
 * Subclasses display a typed value inside a table cell using a Fit layout with theme-driven padding.
 */
export abstract class CellRenderer<T> extends Component {

    constructor() {
        super();

        this.setLayoutManager(new Fit());
        this.applyThemePadding();
        ThemeManager.onThemeChange(() => this.applyThemePadding());
    }

    private applyThemePadding(): void {
        const p = ThemeManager.getTheme().table.cell.padding;
        this.setInsets(new Insets(0, p, 0, p));
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