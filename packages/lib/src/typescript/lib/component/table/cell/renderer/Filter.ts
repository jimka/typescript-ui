// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { HBox } from "~/layout/HBox.js";
import { TextField } from "~/component/input/TextField.js";
import { MenuButton } from "~/component/button/MenuButton.js";
import { callable } from "~/core/Callable.js";

/**
 * The filter row's operator-picker button. A column carrying 2+ clauses
 * substitutes the clauses popover for the default operator menu on click —
 * see {@link FilterCellRenderer.setMenuOpenPredicate}, which forwards to
 * {@link setMenuOpenPredicate} here. Not exported: `FilterCell` reaches this
 * behaviour only through `FilterCellRenderer`'s forwarding method, so the
 * predicate mechanism stays this file's own implementation detail rather
 * than a new public surface on {@link MenuButton}.
 */
class FilterOperatorButton extends MenuButton {

    private _menuOpenPredicate: (() => boolean) | null = null;

    /**
     * Sets the predicate consulted by {@link shouldToggleMenu}, re-evaluated
     * on every click. `null` (the default) always allows the menu to open.
     *
     * @param predicate - Returns `true` to allow the default operator menu to
     *   open for the next click, `false` to veto it.
     */
    setMenuOpenPredicate(predicate: (() => boolean) | null): this {
        this._menuOpenPredicate = predicate;

        return this;
    }

    protected shouldToggleMenu(): boolean {
        return this._menuOpenPredicate ? this._menuOpenPredicate() : true;
    }
}

/**
 * Hosts a filter column's two interactive controls — a text input and an
 * operator-picker button — side by side in an `HBox`.
 *
 * `itemAlign: "stretch"` sizes both children to the row's height. The
 * operator button carries no explicit `preferredSize` — pinning one would
 * disable Button's own content-derived sizing (see `Button.getPreferredSize`),
 * which is what keeps the button no wider than its glyph needs. `flat` +
 * `compact` additionally give it the tightest glyph-only inset perimeter.
 * `showText: false` keeps the button glyph-only on its face while its title —
 * set by {@link FilterCell} to the current operator's label — still drives
 * the hover tooltip and accessible name (`Button.setText`'s documented
 * `showText:false` behaviour).
 *
 * @category Components
 */
class FilterCellRenderer extends CellRenderer<string | null> {

    private _input:          TextField            = new TextField();
    private _operatorButton: FilterOperatorButton = new FilterOperatorButton();

    constructor() {
        super();

        this.setLayoutManager(new HBox({ spacing: 2, itemAlign: "stretch", mode: "preferred" }));

        this._input.setBorder({ border: "0px solid transparent" });

        this._operatorButton.setFlat(true);
        this._operatorButton.setCompact(true);
        this._operatorButton.setShowText(false);
        // The description line composes into the button's hover tooltip
        // (Button._rebuildTooltip) without ever rendering on the glyph-only
        // face — FilterCell writes it once a column carries 2+ clauses, so
        // hovering the button states which conditions are active.
        this._operatorButton.setShowDescription(false);

        this.addComponent(this._input, { weight: 1 });
        this.addComponent(this._operatorButton);
    }

    /**
     * Returns the text input hosting the filter's typed value.
     *
     * @returns The {@link TextField} child.
     */
    getInput(): TextField {
        return this._input;
    }

    /**
     * Returns the operator-picker button.
     *
     * @returns The {@link MenuButton} child.
     */
    getOperatorButton(): MenuButton {
        return this._operatorButton;
    }

    /**
     * @internal Framework wiring between `FilterCell` and its operator
     * button; application code does not call this. Sets the predicate
     * consulted before the button's click opens its default dropdown —
     * `false` vetoes that default open, leaving the button's `"action"`
     * event as the only signal for that click, which `FilterCell` uses to
     * open the clauses popover instead once a column carries 2+ clauses.
     * Forwards to the operator button's own concrete type, which is not
     * otherwise exposed by `getOperatorButton`'s `MenuButton`-typed return.
     *
     * @param predicate - Returns `true` to allow the default menu to open for
     *   the next click, `false` to veto it. `null` always allows it.
     */
    setMenuOpenPredicate(predicate: (() => boolean) | null): this {
        this._operatorButton.setMenuOpenPredicate(predicate);

        return this;
    }

    /**
     * Returns the text input's current value, or `null` when empty.
     *
     * @returns The current text, or `null`.
     */
    getValue(): string | null {
        const value = this._input.getValue();

        return value === "" ? null : value;
    }

    /**
     * Writes the text input's value. `null` renders as an empty input.
     *
     * @param value - The value to display, or `null` to clear the input.
     */
    setValue(value: string | null): void {
        this._input.setValue(value ?? "");
    }
}

const FilterCellRendererCallable = callable(FilterCellRenderer);
type FilterCellRendererCallable = FilterCellRenderer;
export {
    FilterCellRenderer         as _FilterCellRenderer,
    FilterCellRendererCallable as FilterCellRenderer
};
