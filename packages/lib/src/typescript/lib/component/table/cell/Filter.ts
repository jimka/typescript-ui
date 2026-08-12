// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell, CellEvent } from "~/component/table/cell/Cell.js";
import { FilterCellRenderer } from "~/component/table/cell/renderer/Filter.js";
import { FilterClauseBadge } from "~/component/table/cell/FilterClauseBadge.js";
import {
    columnFilterOperatorLabel,
    columnFilterOperatorGlyph,
    columnFilterTakesOperand,
} from "~/component/table/ColumnFilter.js";
import type { ColumnFilterOperator, ColumnFilterClause, ColumnFilterState } from "~/component/table/ColumnFilter.js";
import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { callable } from "~/core/Callable.js";
import { Glyph } from "~/component/display/Glyph.js";
import { Popover } from "~/overlay/Popover.js";
import { Button } from "~/component/button/Button.js";
import { MenuButton } from "~/component/button/MenuButton.js";
import { TabCloseButton } from "~/component/button/TabCloseButton.js";
import { TextField } from "~/component/input/TextField.js";
import { VBox } from "~/layout/VBox.js";
import { HBox } from "~/layout/HBox.js";
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
import { plus }                 from "~/glyphs/solid/plus.js";

Glyph.register(
    magnifying_glass, align_left, align_right, equals, not_equal,
    greater_than, greater_than_equal, less_than, less_than_equal,
    ban, circle_check, plus,
);

/**
 * String-literal union of the events emitted by {@link FilterCell}. Extends
 * the inherited `CellEvent` union with the filter-specific event.
 *
 * @category Components
 */
export type FilterCellEvent = CellEvent | "filterchange";

/**
 * A header-band cell hosting one column's filter input and operator picker,
 * plus (once a second condition is added) a corner badge and a popover
 * listing every AND-combined condition.
 *
 * Stateless across a column-window recycle: {@link TableHeader} owns the
 * per-column {@link ColumnFilterState} map and re-applies it via
 * {@link FilterCell.setFilterState} on every reconcile, mirroring how
 * {@link HeaderCell} re-applies sort state to a recycled cell.
 *
 * @category Components
 */
class FilterCell extends Cell<string | null> {

    private _fieldName: string;
    private _operators: ColumnFilterOperator[] = [];
    // The full clause list; always at least one entry. `_clauses[0]` is the
    // single source of truth for the always-visible inline input + operator
    // button — every path that changes clause 0 writes into `_clauses[0]`
    // first, then calls `fireFilterChange`. `_clauses[1..]` exist only
    // inside the lazily-created `_clausesPopover`.
    private _clauses: ColumnFilterClause[] = [{ operator: 'contains', text: '' }];
    // `declare`d (no initializer) so the constructor-body assignment below
    // is the only construction, mirroring HeaderCell's `_priorityBadge`
    // field — see that class's destructor comment for why.
    declare private _badge: FilterClauseBadge;
    // Lazily created on first "Add condition…", mirroring MenuButton's own
    // lazy `_menu`.
    private _clausesPopover: Popover | null = null;
    // Cached for the popover's title; setColumnLabel already receives it.
    private _columnLabel: string = '';

    /**
     * @param fieldName - The model field this cell's filter targets.
     * @param operators - The operators to offer; an empty array renders the
     *   cell blank (see {@link setOperators}).
     */
    constructor(fieldName: string, operators: ColumnFilterOperator[]) {
        super("th", new FilterCellRenderer());

        this._fieldName = fieldName;
        this._badge = new FilterClauseBadge();

        this.getAria().setRole("columnheader");
        // The header band's gradient shows through unaltered, matching
        // ParentHeaderCell's own transparent-background write.
        this.setBackgroundColor("transparent");

        const renderer = this.filterRenderer();

        renderer.getInput().on("change", () => {
            this._clauses[0].text = renderer.getValue() ?? '';
            this.fireFilterChange(false);
        });
        renderer.getInput().on("keydown", (e: KeyboardEvent) => this.onInputKeyDown(e));

        // Provider form, so the checkmark tracks the current operator on every open.
        // `checked` renders the checkmark in its own leading column (left of the
        // glyph), so a checked and an unchecked row's glyph and label still align.
        // The trailing separator + "Add condition…" entry always appends one blank
        // clause and opens the clauses popover, whether the column currently has
        // 1 clause or 5 — one rule, not one that branches on the current count.
        renderer.getOperatorButton().setMenuItems(() => [
            ...this._operators.map(op => ({
                text:    columnFilterOperatorLabel(op),
                glyph:   columnFilterOperatorGlyph(op),
                checked: op === this._clauses[0].operator,
                action:  () => this.selectOperator(op),
            })),
            { separator: true as const },
            { text: 'Add condition…', glyph: 'plus', action: () => this.addConditionAndOpenPopover() },
        ]);

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
     * left the window for one entering it. Closes an open clauses popover
     * only when the incoming name is a true recycle onto a different
     * field — not on every resync pass, since the header re-applies
     * `setFieldName` unconditionally on every reconcile.
     *
     * @param name - The new field name this cell reports on `"filterchange"`.
     * @returns This cell, for method chaining.
     */
    setFieldName(name: string): this {
        if (name !== this._fieldName) {
            this._clausesPopover?.hide();
        }

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
     * Replaces the offered operators. Collapses to a single blank clause on
     * `operators[0]` — the header's reconciler always calls
     * {@link setFilterState} with the authoritative cached state (or the
     * blank default) immediately after this, in the same synchronous pass,
     * so whatever this leaves in the clause list is overwritten before the
     * next paint.
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
            // A cell recycled from a multi-condition column onto a
            // `filterable: false` one has no operators to fall back to, but
            // must still drop its stale clause list and hide the badge —
            // otherwise a badge showing a leftover count of 2+ would linger
            // over a cell whose input and operator button just went hidden,
            // with no controls left to explain it.
            this._clauses = [{ operator: 'contains', text: '' }];
            this._clausesPopover?.hide();
            this.syncBadge();

            return this;
        }

        this._clauses = [{ operator: operators[0], text: '' }];
        this.applyOperatorFace(operators[0]);
        renderer.getInput().setEnabled(columnFilterTakesOperand(operators[0]));
        this.syncBadge();

        return this;
    }

    /**
     * Sets the accessible name of the text input to `"Filter " + label` —
     * `label` is the column's header text. Also cached for the clauses
     * popover's title.
     *
     * @param label - The column's header label.
     * @returns This cell, for method chaining.
     */
    setColumnLabel(label: string): this {
        this._columnLabel = label;
        this.filterRenderer().getInput().getAria().setLabel("Filter " + label);

        return this;
    }

    /**
     * Writes the full clause list without emitting `"filterchange"`. Used by
     * the header to re-apply cached state to a recycled cell. Clones the
     * incoming clauses so a later popover mutation (`push`/`splice` on this
     * cell's own `_clauses`) never aliases — and silently corrupts — the
     * header's cached entry.
     *
     * @param state - The clause list to display.
     * @returns This cell, for method chaining.
     */
    setFilterState(state: ColumnFilterState): this {
        this._clauses = state.clauses.map(c => ({ ...c }));

        const renderer = this.filterRenderer();

        this.applyOperatorFace(this._clauses[0].operator);
        renderer.getInput().setEnabled(columnFilterTakesOperand(this._clauses[0].operator));
        renderer.setValue(this._clauses[0].text === "" ? null : this._clauses[0].text);
        this.syncBadge();

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
     * Returns the full clause list currently held, read from the internal
     * cache — `_clauses[0].text` is kept current on every change/Enter/
     * Escape rather than re-read from the DOM at return time.
     *
     * @returns The current filter state.
     */
    getFilterState(): ColumnFilterState {
        return { clauses: this._clauses.map(c => ({ ...c })) };
    }

    /**
     * Selects a new operator for clause 0 from the inline operator dropdown:
     * updates the button face, enables/disables the text input (clearing it
     * when the new operator ignores text), lays the cell out — mirroring
     * {@link HeaderCell.setHeaderGlyph}'s self-layout, since the geometry
     * cache does not know an operator change moved layout without moving
     * geometry — then emits `"filterchange"` immediately.
     *
     * @param op - The newly selected operator.
     */
    private selectOperator(op: ColumnFilterOperator): void {
        this._clauses[0].operator = op;

        const renderer  = this.filterRenderer();
        const takesText = columnFilterTakesOperand(op);

        this.applyOperatorFace(op);
        renderer.getInput().setEnabled(takesText);

        if (!takesText) {
            renderer.setValue(null);
            this._clauses[0].text = '';
        }

        this.doLayout();

        this.fireFilterChange(true);
    }

    /**
     * Handles a keydown on the text input: Enter applies the current text
     * immediately (the preceding `"change"` event already updated
     * `_clauses[0].text`); Escape clears the text and applies that
     * immediately too.
     *
     * @param e - The keydown event.
     */
    private onInputKeyDown(e: KeyboardEvent): void {
        if (e.key === "Enter") {
            this.fireFilterChange(true);
        } else if (e.key === "Escape") {
            this._clauses[0].text = '';
            this.filterRenderer().setValue(null);
            this.fireFilterChange(true);
        }
    }

    /**
     * Appends one blank clause (on `operators[0]`) and opens the clauses
     * popover. The single rule behind the operator menu's trailing
     * "Add condition…" entry, whether the column currently has 1 clause or 5.
     */
    private addConditionAndOpenPopover(): void {
        this._clauses.push({ operator: this._operators[0], text: '' });
        this.openClausesPopover();
        this.fireFilterChange(true);
    }

    /**
     * Lazily creates the clauses popover on first use, mirroring
     * {@link MenuButton}'s own lazy `_menu ??= new Menu()`.
     *
     * @returns The (possibly just-created) popover.
     */
    private ensureClausesPopover(): Popover {
        if (!this._clausesPopover) {
            this._clausesPopover = new Popover({ placement: 'auto', dismissOn: 'click-outside' });
            this._clausesPopover.addAction('Done', () => this._clausesPopover!.hide());
        }

        return this._clausesPopover;
    }

    /**
     * Opens the clauses popover anchored under the operator button, rebuilt
     * fresh from the current clause list — the same "rebuild fresh on every
     * open" rule {@link MenuButton}'s provider form already follows.
     */
    private openClausesPopover(): void {
        const popover = this.ensureClausesPopover();

        popover.setTitle(this._columnLabel + ' filter conditions');
        popover.setBody(this.buildClausesBody());
        popover.attachToComponent(this.filterRenderer().getOperatorButton());
        popover.show();

        this.syncBadge();
    }

    /**
     * Rebuilds the popover's body in place from the current clause list,
     * without re-showing or re-anchoring it. Called after any mutation made
     * from inside the popover itself (add / remove / operator pick).
     */
    private refreshClausesPopoverBody(): void {
        this._clausesPopover?.setBody(this.buildClausesBody());
    }

    /**
     * Builds the popover body: one {@link buildClauseRow} per current
     * clause, then a plain "Add condition" button that appends another
     * blank clause and re-renders the row list in place.
     *
     * @returns A freshly built, `VBox`-laid body component.
     */
    private buildClausesBody(): Component {
        const body = new Component({ layoutManager: new VBox({ spacing: 4 }) });

        this._clauses.forEach((_, index) => body.addComponent(this.buildClauseRow(index)));

        const addButton = new Button('Add condition', { glyph: 'plus' });

        addButton.on("action", () => this.onAddConditionButtonClick());
        body.addComponent(addButton);

        return body;
    }

    /**
     * Builds one popover row: an operator-picker `MenuButton` and a
     * `TextField`, both scoped to `_clauses[index]`, plus — for every row
     * but the first — a {@link TabCloseButton} that removes the clause. Row
     * 0 carries no remove control, for the same reason the inline single
     * clause has never been "removable," only clearable.
     *
     * @param index - The clause this row edits.
     * @returns The built row, an `HBox`-laid component.
     */
    private buildClauseRow(index: number): Component {
        const clause = this._clauses[index];

        const opButton = new MenuButton();

        opButton.setFlat(true);
        opButton.setCompact(true);
        opButton.setShowText(false);
        opButton.setGlyph(columnFilterOperatorGlyph(clause.operator));
        opButton.setText(columnFilterOperatorLabel(clause.operator));
        opButton.setMenuItems(() => this._operators.map(op => ({
            text:    columnFilterOperatorLabel(op),
            glyph:   columnFilterOperatorGlyph(op),
            checked: op === this._clauses[index].operator,
            action:  () => this.selectRowOperator(index, op),
        })));

        const field = new TextField();

        field.setValue(clause.text);
        field.setEnabled(columnFilterTakesOperand(clause.operator));
        field.on("change", () => this.onRowTextChange(index, field.getValue()));

        const row = new Component({ layoutManager: new HBox({ spacing: 4, itemAlign: "stretch" }) });

        row.addComponent(opButton);
        row.addComponent(field, { weight: 1 });

        if (index > 0) {
            const removeButton = new TabCloseButton();

            removeButton.on("action", () => this.removeClause(index));
            row.addComponent(removeButton);
        }

        return row;
    }

    /**
     * Applies an operator picked from a popover row's own operator button,
     * scoped to `_clauses[index]` — the same checkable-item mechanics as the
     * inline {@link selectOperator}. Row 0 additionally re-applies the
     * change to the always-visible inline controls, since the popover's row
     * 0 edits the same clause the inline row displays.
     *
     * @param index - The clause index the row represents.
     * @param op - The newly selected operator.
     */
    private selectRowOperator(index: number, op: ColumnFilterOperator): void {
        const clause    = this._clauses[index];
        const takesText = columnFilterTakesOperand(op);

        clause.operator = op;

        if (!takesText) {
            clause.text = '';
        }

        if (index === 0) {
            this.applyOperatorFace(op);
            this.filterRenderer().getInput().setEnabled(takesText);

            if (!takesText) {
                this.filterRenderer().setValue(null);
            }

            this.doLayout();
        }

        this.refreshClausesPopoverBody();
        this.fireFilterChange(true);
    }

    /**
     * Applies a popover row's text-field edit to `_clauses[index]`, debounced
     * exactly like the inline input. Row 0 additionally re-applies the
     * change to the always-visible inline input, for the same reason
     * {@link selectRowOperator} does.
     *
     * @param index - The clause index the row represents.
     * @param text - The row's current text-field value.
     */
    private onRowTextChange(index: number, text: string): void {
        this._clauses[index].text = text;

        if (index === 0) {
            this.filterRenderer().setValue(text === "" ? null : text);
        }

        this.fireFilterChange(false);
    }

    /**
     * Handles the popover's own "Add condition" button: appends a blank
     * clause, refreshes the badge and the row list, and applies immediately.
     */
    private onAddConditionButtonClick(): void {
        this._clauses.push({ operator: this._operators[0], text: '' });

        this.syncBadge();
        this.refreshClausesPopoverBody();
        this.fireFilterChange(true);
    }

    /**
     * Removes one clause (never index 0, which carries no remove control),
     * refreshes the badge and the row list, and applies immediately.
     *
     * @param index - The clause to remove.
     */
    private removeClause(index: number): void {
        this._clauses.splice(index, 1);

        this.syncBadge();
        this.refreshClausesPopoverBody();
        this.fireFilterChange(true);
    }

    /**
     * Shows the corner clause-count badge once there are 2 or more clauses,
     * hides it otherwise — mirroring {@link SortPriorityBadge}'s own
     * hidden-below-2 threshold. Called at the end of every mutation that can
     * change the clause count, or after {@link setFilterState} rehydrates
     * the clause list.
     */
    private syncBadge(): void {
        this._badge.setCount(this._clauses.length >= 2 ? this._clauses.length : null);
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
     * Mounts the side-loaded clause-count badge. Mirrors
     * {@link HeaderCell.init}'s own side-loaded overlays: a raw `appendChild`
     * (not `addComponent`) keeps this cell's `Card` layout from treating the
     * badge as a second "visible child" of the renderer.
     *
     * @param element - Optional element passed from the framework init chain.
     */
    protected init(element?: Handle): this {
        super.init(element);

        const el = element || this.getElement();
        if (!el) return this;

        DOM.sink.appendChild(el, this._badge.getElement(true)!);

        return this;
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

    /**
     * Destroys the side-loaded badge and disposes the lazily-created clauses
     * popover before the inherited teardown runs.
     */
    protected destructor(): void {
        // `_badge` is a `declare` field (see cell/Header.ts:586-595's own
        // comment on why), so it can read as `undefined` if teardown lands
        // before the constructor body ran.
        this._badge?.dispose();
        this._clausesPopover?.dispose();

        super.destructor();
    }
}

const FilterCellCallable = callable(FilterCell);
type FilterCellCallable = FilterCell;
export {
    FilterCell         as _FilterCell,
    FilterCellCallable as FilterCell
};
