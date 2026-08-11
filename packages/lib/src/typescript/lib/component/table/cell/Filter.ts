// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell, CellEvent } from "~/component/table/cell/Cell.js";
import { FilterCellRenderer } from "~/component/table/cell/renderer/Filter.js";
import {
    columnFilterOperatorLabel,
    columnFilterOperatorGlyph,
    columnFilterTakesOperand,
} from "~/component/table/ColumnFilter.js";
import type { ColumnFilterOperator, ColumnFilterState } from "~/component/table/ColumnFilter.js";
import { callable } from "~/core/Callable.js";
import { Glyph } from "~/component/display/Glyph.js";
import { magnifying_glass }     from "~/glyphs/solid/magnifying_glass.js";
import { align_left }           from "~/glyphs/solid/align_left.js";
import { align_right }          from "~/glyphs/solid/align_right.js";
import { equals }               from "~/glyphs/solid/equals.js";
import { not_equal }            from "~/glyphs/solid/not_equal.js";
import { greater_than }         from "~/glyphs/solid/greater_than.js";
import { greater_than_equal }   from "~/glyphs/solid/greater_than_equal.js";
import { less_than }            from "~/glyphs/solid/less_than.js";
import { less_than_equal }      from "~/glyphs/solid/less_than_equal.js";
import { ban }                  from "~/glyphs/solid/ban.js";
import { circle_check }         from "~/glyphs/solid/circle_check.js";

Glyph.register(
    magnifying_glass, align_left, align_right, equals, not_equal,
    greater_than, greater_than_equal, less_than, less_than_equal,
    ban, circle_check,
);

/**
 * String-literal union of the events emitted by {@link FilterCell}. Extends
 * the inherited `CellEvent` union with the filter-specific event.
 *
 * @category Components
 */
export type FilterCellEvent = CellEvent | "filterchange";

/**
 * A header-band cell hosting one column's filter input and operator picker.
 *
 * Stateless across a column-window recycle: {@link TableHeader} owns the
 * per-column `{ operator, text }` map and re-applies it via
 * {@link FilterCell.setFilterState} on every reconcile, mirroring how
 * {@link HeaderCell} re-applies sort state to a recycled cell.
 *
 * @category Components
 */
class FilterCell extends Cell<string | null> {

    private _fieldName: string;
    private _operators: ColumnFilterOperator[] = [];
    // The currently selected operator; meaningful only while `_operators` is
    // non-empty. Falls back to 'contains' when read with no operators set,
    // which never happens through the public surface — the text input and
    // operator button are hidden in that state.
    private _operator: ColumnFilterOperator = 'contains';

    /**
     * @param fieldName - The model field this cell's filter targets.
     * @param operators - The operators to offer; an empty array renders the
     *   cell blank (see {@link setOperators}).
     */
    constructor(fieldName: string, operators: ColumnFilterOperator[]) {
        super("th", new FilterCellRenderer());

        this._fieldName = fieldName;

        this.getAria().setRole("columnheader");
        // The header band's gradient shows through unaltered, matching
        // ParentHeaderCell's own transparent-background write.
        this.setBackgroundColor("transparent");

        const renderer = this.filterRenderer();

        renderer.getInput().on("change", () => this.fireFilterChange(false));
        renderer.getInput().on("keydown", (e: KeyboardEvent) => this.onInputKeyDown(e));

        // Provider form, so the checkmark tracks the current operator on every open.
        // `checked` renders the checkmark in its own leading column (left of the
        // glyph), so a checked and an unchecked row's glyph and label still align.
        renderer.getOperatorButton().setMenuItems(() => this._operators.map(op => ({
            text:    columnFilterOperatorLabel(op),
            glyph:   columnFilterOperatorGlyph(op),
            checked: op === this._operator,
            action:  () => this.selectOperator(op),
        })));

        this.setOperators(operators);
    }

    /** Returns this cell's renderer, narrowed to its concrete type. */
    private filterRenderer(): FilterCellRenderer {
        return this.getRenderer() as FilterCellRenderer;
    }

    /**
     * Writes the operator button's glyph face and its title — the title stays
     * off the visible face (`FilterCellRenderer` sets `showText: false`) but
     * still drives the button's hover tooltip and accessible name, so
     * hovering the button reports which mode the filter is currently in.
     *
     * @param op - The operator to represent.
     */
    private applyOperatorFace(op: ColumnFilterOperator): void {
        const button = this.filterRenderer().getOperatorButton();

        button.setGlyph(columnFilterOperatorGlyph(op));
        button.setText(columnFilterOperatorLabel(op));
    }

    /**
     * Re-targets this cell at another column's model field. Used by the
     * header's filter-row reconciler when recycling a cell whose column
     * left the window for one entering it.
     *
     * @param name - The new field name this cell reports on `"filterchange"`.
     * @returns This cell, for method chaining.
     */
    setFieldName(name: string): this {
        this._fieldName = name;

        return this;
    }

    /**
     * Returns the model field name this cell currently reports on
     * `"filterchange"`.
     *
     * @returns The current field name.
     */
    getFieldName(): string {
        return this._fieldName;
    }

    /**
     * Replaces the offered operators. Falls back to `operators[0]` when the
     * currently-selected operator is not in the new list.
     *
     * An **empty array** marks the column non-filterable: the cell renders
     * blank (no input, no operator button) and emits nothing. A non-empty
     * array shows both controls again.
     *
     * @param operators - The operators to offer, in menu order.
     * @returns This cell, for method chaining.
     */
    setOperators(operators: ColumnFilterOperator[]): this {
        this._operators = operators;

        const renderer = this.filterRenderer();
        const blank     = operators.length === 0;

        renderer.getInput().setDisplayed(!blank);
        renderer.getOperatorButton().setDisplayed(!blank);

        if (blank) {
            return this;
        }

        if (!operators.includes(this._operator)) {
            this._operator = operators[0];
        }

        this.applyOperatorFace(this._operator);
        renderer.getInput().setEnabled(columnFilterTakesOperand(this._operator));

        return this;
    }

    /**
     * Sets the accessible name of the text input to `"Filter " + label` —
     * `label` is the column's header text.
     *
     * @param label - The column's header label.
     * @returns This cell, for method chaining.
     */
    setColumnLabel(label: string): this {
        this.filterRenderer().getInput().getAria().setLabel("Filter " + label);

        return this;
    }

    /**
     * Writes the operator + text without emitting `"filterchange"`. Used by
     * the header to re-apply cached state to a recycled cell.
     *
     * @param state - The operator + text to display.
     * @returns This cell, for method chaining.
     */
    setFilterState(state: ColumnFilterState): this {
        this._operator = state.operator;

        const renderer = this.filterRenderer();

        this.applyOperatorFace(state.operator);
        renderer.getInput().setEnabled(columnFilterTakesOperand(state.operator));
        renderer.setValue(state.text === "" ? null : state.text);

        // Mirrors selectOperator's self-layout: a cell recycled onto a new
        // column at unchanged geometry (same x/width/height) has its
        // doLayout skipped by the header's geometry-diff cache, and an
        // operator change moves this cell's own layout (enabled/disabled
        // input) without moving that geometry. See CellGeometry.ts's writer
        // list.
        this.doLayout();

        return this;
    }

    /**
     * Returns the operator + text currently displayed.
     *
     * @returns The current filter state.
     */
    getFilterState(): ColumnFilterState {
        return { operator: this._operator, text: this.filterRenderer().getValue() ?? "" };
    }

    /**
     * Selects a new operator: updates the button face, enables/disables the
     * text input (clearing it when the new operator ignores text), lays the
     * cell out — mirroring {@link HeaderCell.setHeaderGlyph}'s self-layout,
     * since the geometry cache does not know an operator change moved
     * layout without moving geometry — then emits `"filterchange"` immediately.
     *
     * @param op - The newly selected operator.
     */
    private selectOperator(op: ColumnFilterOperator): void {
        this._operator = op;

        const renderer  = this.filterRenderer();
        const takesText = columnFilterTakesOperand(op);

        this.applyOperatorFace(op);
        renderer.getInput().setEnabled(takesText);

        if (!takesText) {
            renderer.setValue(null);
        }

        this.doLayout();

        this.fireFilterChange(true);
    }

    /**
     * Handles a keydown on the text input: Enter applies the current text
     * immediately; Escape clears the text and applies that immediately too.
     *
     * @param e - The keydown event.
     */
    private onInputKeyDown(e: KeyboardEvent): void {
        if (e.key === "Enter") {
            this.fireFilterChange(true);
        } else if (e.key === "Escape") {
            this.filterRenderer().setValue(null);
            this.fireFilterChange(true);
        }
    }

    /**
     * Emits `"filterchange"` with this cell's current field name and state.
     *
     * @param immediate - `true` when the change should apply without the
     *   header's keystroke debounce (operator pick, Enter, Escape).
     */
    private fireFilterChange(immediate: boolean): void {
        this.emit("filterchange", this._fieldName, this.getFilterState(), immediate);
    }

    /**
     * Registers a listener for one of this cell's events.
     *
     * @param event - `"commit"` / `"editend"` inherit from {@link Cell} (unused
     *   on this non-editing cell, kept for inheritance compatibility);
     *   `"filterchange"` fires when the typed text or the selected operator
     *   changes, receiving the field name, the new state, and whether the
     *   change should apply immediately (bypassing the header's debounce).
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This cell, for method chaining.
     */
    on(event: "commit",        listener: (value: string | null) => void): this;
    on(event: "editend",       listener: () => void): this;
    on(event: "filterchange",  listener: (fieldName: string, state: ColumnFilterState, immediate: boolean) => void): this;
    on(event: FilterCellEvent, listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback reference
     * must match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This cell, for method chaining.
     */
    off(event: FilterCellEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event` with `payload`, in
     * registration order.
     *
     * @param event - The event to emit.
     * @param payload - Forwarded to each listener.
     */
    protected emit(event: "commit",         value: string | null): void;
    protected emit(event: "editend"): void;
    protected emit(event: "filterchange",   fieldName: string, state: ColumnFilterState, immediate: boolean): void;
    protected emit(event: FilterCellEvent,  ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }
}

const FilterCellCallable = callable(FilterCell);
type FilterCellCallable = FilterCell;
export {
    FilterCell         as _FilterCell,
    FilterCellCallable as FilterCell
};
