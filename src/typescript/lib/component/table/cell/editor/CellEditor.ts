// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Fit } from "~/layout/Fit.js";
import { Insets } from "~/primitive/Insets.js";
import { ThemeManager } from "~/core/Theme.js";

/**
 * Abstract base class for cell editors.
 *
 * Subclasses allow in-place editing of a typed value inside a table cell using a
 * Fit layout with theme-driven padding.
 *
 * @category Components
 */
export abstract class CellEditor<T> extends Component {

    constructor(tag: string = "div") {
        super({ tag });

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
     * Returns the current editor value.
     *
     * @returns The edited value of type T.
     */
    abstract getValue(): T;

    /**
     * Sets the editor to an initial value before editing begins.
     *
     * @param t - The value to populate the editor with.
     */
    abstract setValue(t: T): void;

    /**
     * Mirrors {@link CellRenderer.getContentX} so a `CellEditor` and a
     * `CellRenderer` stay structurally compatible — {@link BooleanCell}
     * uses a [`BooleanEditor`](/api/component/table/classes/BooleanEditor)
     * as both renderer and editor, and TS would reject that pass if
     * either base class declared a member the other didn't. Default
     * returns `0`; editors do not currently report indent offsets of
     * their own.
     *
     * @returns Always `0`.
     */
    getContentX(): number {
        return 0;
    }
}