// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import { AbstractModel } from "~/data/AbstractModel.js";
import { Field } from "~/data/Field.js";
import { ModelRecord } from "~/data/ModelRecord.js";
import { Cell } from "~/component/table/cell/Cell.js";
import { DefaultCell } from "~/component/table/cell/Default.js";
import { StringCell } from "~/component/table/cell/String.js";
import { BooleanCell } from "~/component/table/cell/Boolean.js";
import { NumberCell } from "~/component/table/cell/Number.js";
import { DateCell } from "~/component/table/cell/Date.js";
import { TimeCell } from "~/component/table/cell/Time.js";
import { DateTimeCell } from "~/component/table/cell/DateTime.js";
import { GlyphCell } from "~/component/table/cell/Glyph.js";
import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { TreeCellRenderer } from "~/component/table/cell/renderer/TreeCell.js";
import type { ColumnConfig } from "~/component/table/ColumnConfig.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { callable } from "~/core/Callable.js";

/**
 * A single data row in the table, rendered as a `<tr>` element.
 *
 * Creates one typed cell ({@link StringCell}, {@link NumberCell}, {@link BooleanCell},
 * or {@link DefaultCell}) per model field and binds each cell's commit callback to the
 * corresponding field on the bound {@link ModelRecord}.
 *
 * Re-exported as `TableRow` from the package barrel.
 *
 * @category Components
 */
class Row extends Component {

    private _model?: AbstractModel;
    private _data?: ModelRecord;
    private _onCellCommit?: (record: ModelRecord) => void;
    private _fieldNames: string[] = [];
    private _treeCell: Cell<any> | null = null;
    private _stripe: boolean = false;

    constructor(
        model?: AbstractModel,
        data?: ModelRecord,
        hiddenColumns: Set<string> = new Set(),
        columnConfigs: Map<string, ColumnConfig> = new Map(),
        onCellCommit?: (record: ModelRecord) => void,
        treeFieldName?: string,
    ) {
        super({ tag: "tr" });

        this.getAria().setRole("row");

        this._model = model;
        this._data = data;
        this._onCellCommit = onCellCommit;

        if (this._model) {
            let fields = this._model.getFields()
                                   .filter(f => !hiddenColumns.has(f.getName()))
                                   .sort((f1, f2) => f1.getOrder() - f2.getOrder());

            this._fieldNames = fields.map(f => f.getName());

            for (let idx in fields) {
                let field = fields[idx];
                let value = this._data ? this._data.get(field.getName()) : undefined;
                let cell  = Row.createCellForField(field, columnConfigs);

                cell.setValue(value);
                cell.on("commit", (newValue) => {
                    if (this._data) {
                        this._data.set(field.getName(), newValue);
                        this._onCellCommit?.(this._data);
                    }
                    this.updateVisualState();
                });

                // Tint the cell with the column's `groupColor` so a body
                // cell visually belongs to the same group as the parent
                // header above it. `Cell` base only re-applies the
                // border on theme change, so this background sticks.
                const groupColor = columnConfigs.get(field.getName())?.groupColor;
                if (groupColor) {
                    cell.setBackgroundColor(groupColor);
                }

                // Read-only wins over groupColor: this write lands
                // after the groupColor block so the read-only tint
                // overrides any group tint and the cell refuses inline
                // editing.
                const readOnly = columnConfigs.get(field.getName())?.readOnly;
                if (readOnly) {
                    cell.setReadOnly(true);
                }

                // For the tree column, wrap the typed renderer in a
                // `TreeCellRenderer` so the cell draws an indent + an
                // expand/collapse toggle to the left of the value. The
                // host `TreeBody` keeps a reference via `getTreeCell()`
                // and pushes per-row depth + expansion state through
                // `setTreeState` on each bind.
                if (treeFieldName !== undefined && field.getName() === treeFieldName) {
                    cell.wrapRenderer((delegate: CellRenderer<any>) => new TreeCellRenderer(delegate));
                    this._treeCell = cell;
                }

                this.addComponent(cell, {
                    data: field
                });
            }
        }
    }

    /**
     * Returns the cell on the row's tree column, or `null` when the row
     * was constructed without a `treeFieldName`. The host `TreeBody`
     * reads this to find each row's `TreeCellRenderer` for depth /
     * toggle updates and toggle-click routing.
     *
     * @returns The tree-column {@link Cell}, or `null`.
     */
    getTreeCell(): Cell<any> | null {
        return this._treeCell;
    }

    /**
     * Returns the field names backing this row's cells, in the same
     * order as `getComponents()`. Hidden columns are excluded.
     *
     * @returns The field names, in cell order.
     *
     * @remarks Used by the host `Body` to align cell index → field name
     * → {@link ColumnConfig} lookup when resolving per-cell read-only
     * state on each rebind. Not for consumer use.
     */
    getFieldNames(): string[] {
        return this._fieldNames;
    }

    /**
     * Returns the ModelRecord currently bound to this row.
     *
     * @returns The bound {@link ModelRecord}, or undefined if none has been set.
     */
    getData() {
        return this._data;
    }

    /**
     * Rebinds all cells to a new record, updating their displayed values.
     *
     * @param record - The new record to bind to this row.
     */
    setData(record: ModelRecord) : this {
        this._data = record;

        const cells = this.getComponents() as Cell<any>[];
        const names = this._fieldNames;

        for (let i = 0; i < names.length; i++) {
            cells[i].setValue(record.get(names[i]));
        }

        this.updateVisualState();

        return this;
    }

    /**
     * Marks whether this row sits on a striped (odd) logical index, so the
     * resting background paints the zebra stripe.
     *
     * @param striped - True when this row's logical data index is odd.
     *
     * @remarks Set by the host Body on each rebind from `dataIndex % 2`; it only
     * updates the backing flag, so call `updateVisualState` afterwards to repaint.
     * Not for consumer use.
     */
    setStripe(striped: boolean): void {
        this._stripe = striped;
    }

    /**
     * Applies a background color based on the record's new/dirty/clean state.
     *
     * @remarks New records get a green tint, dirty records an orange tint, and clean records the zebra stripe (odd rows) or no tint (even rows).
     */
    updateVisualState(): void {
        const el = this.getElement() as HTMLElement;
        if (!el) {
            return;
        }

        // Per-record ephemeral tint on a pooled row re-bound to a new record on
        // every render. Going through a cached Component setter (setBackgroundColor)
        // would persist this into _options and replay it onto the next record bound
        // to this reused row, so write/remove the inline style directly instead.
        if (this._data?.isNew()) {
            DOM.sink.setStyle(el, 'background-color', 'var(--ts-ui-table-row-new, rgba(70, 200, 70, 0.15))');
        } else if (this._data?.isDirty()) {
            DOM.sink.setStyle(el, 'background-color', 'var(--ts-ui-table-row-dirty, rgba(255, 165, 0, 0.15))');
        } else if (this._stripe) {
            DOM.sink.setStyle(el, 'background-color', 'var(--ts-ui-table-row-stripe, rgba(0, 0, 0, 0.035))');
        } else {
            DOM.sink.setStyle(el, 'background-color', null);
        }
    }

    /**
     * Appends a cell component to this row.
     *
     * @param cell - The cell to append.
     * @param constraints - Optional. Layout constraints for the cell.
     */
    addColumn(cell: Cell<any>, constraints?: LayoutConstraints) : this {
        this.addComponent(cell, constraints);

        return this;
    }

    /**
     * Adds a cell as a child component of this row.
     *
     * @param cell - The cell component to add.
     * @param constraints - Optional. Layout constraints for the cell.
     *
     * @returns This component, for method chaining.
     */
    addComponent(cell: Cell<any>, constraints?: LayoutConstraints): this {
        super.addComponent(cell, constraints);

        return this;
    }

    /**
     * Rebuilds this row's cell set in place to match `model`'s currently-
     * visible fields. Cells whose field is still visible are preserved
     * (along with their renderer, editor, theme listener, sort state,
     * group tint, etc.); cells whose field is now hidden are committed
     * (if editing) and removed; cells for newly-visible fields are
     * constructed via the same typed switch as the constructor.
     *
     * The child order is re-sorted to match the visible-field display
     * order. The tree column's cell, if any, is wrapped in a
     * {@link TreeCellRenderer} only on first creation — surviving tree
     * cells keep the renderer they already have.
     *
     * @param model - The model whose visible fields drive the cell list.
     * @param hiddenColumns - The set of field names to exclude.
     * @param columnConfigs - Per-field configs (carries `showSeconds`,
     *   `groupColor`, etc.).
     * @param treeFieldName - Optional. Field name of the column that
     *   carries the tree-cell renderer; matches the constructor's
     *   parameter of the same name.
     *
     * @returns This row, for method chaining.
     */
    syncCells(
        model: AbstractModel,
        hiddenColumns: Set<string>,
        columnConfigs: Map<string, ColumnConfig>,
        treeFieldName?: string,
    ): this {
        this._model = model;

        const targetFields = model.getFields()
                                  .filter(f => !hiddenColumns.has(f.getName()))
                                  .sort((f1, f2) => f1.getOrder() - f2.getOrder());

        const existing = this.getComponents().slice() as Cell<any>[];
        const byName   = new Map<string, Cell<any>>();

        for (const cell of existing) {
            const lc    = this.getLayoutConstraints(cell);
            const field = lc?.data as Field | undefined;

            if (field) {
                byName.set(field.getName(), cell);
            }
        }

        // Remove cells whose field is no longer visible. Commit any
        // in-flight edit before discarding so user keystrokes land on
        // the record (mirrors the blur-commits-edit contract).
        const targetNames = new Set(targetFields.map(f => f.getName()));

        for (const cell of existing) {
            const lc    = this.getLayoutConstraints(cell);
            const field = lc?.data as Field | undefined;

            if (!field || !targetNames.has(field.getName())) {
                if (cell.isEditing()) {
                    cell.commitEdit();
                }

                this.removeComponent(cell);
            }
        }

        // Walk target fields in display order. Build any missing cell;
        // re-apply the commit wire and group tint on every (new and
        // surviving) cell so a config swap that changed the tint also
        // takes effect.
        this._treeCell = null;

        for (const field of targetFields) {
            let cell        = byName.get(field.getName());
            const isNew     = !cell;
            const fieldName = field.getName();

            if (!cell) {
                cell = Row.createCellForField(field, columnConfigs);
            }

            cell.on("commit", (newValue) => {
                if (this._data) {
                    this._data.set(fieldName, newValue);
                    this._onCellCommit?.(this._data);
                }
                this.updateVisualState();
            });

            const groupColor = columnConfigs.get(fieldName)?.groupColor;

            if (groupColor) {
                cell.setBackgroundColor(groupColor);
            }

            // Wrap the tree-column cell only when it's newly created —
            // a surviving tree cell already has its `TreeCellRenderer`,
            // and re-wrapping would chain renderers and double-register
            // a theme listener per toggle.
            if (isNew && treeFieldName !== undefined && fieldName === treeFieldName) {
                cell.wrapRenderer((delegate: CellRenderer<any>) => new TreeCellRenderer(delegate));
            }

            if (treeFieldName !== undefined && fieldName === treeFieldName) {
                this._treeCell = cell;
            }

            if (isNew) {
                this.addComponent(cell, { data: field });
                cell.setValue(this._data ? this._data.get(fieldName) : undefined);
            }
        }

        // Re-order children to the new visible-field order. Mirrors
        // `Header.sortColumns` — same `Field` payload from the layout
        // constraints drives both.
        this.sortComponents((c1, c2) => {
            const f1 = (this.getLayoutConstraints(c1)?.data as Field).getOrder();
            const f2 = (this.getLayoutConstraints(c2)?.data as Field).getOrder();

            return f1 - f2;
        });

        this._fieldNames = targetFields.map(f => f.getName());

        return this;
    }

    /**
     * Builds the typed `Cell` for `field`, applying any field-specific
     * options from `columnConfigs` (e.g. `showSeconds` on time cells).
     *
     * @param field - The field whose typed cell to construct.
     * @param columnConfigs - Per-field configs keyed by field name.
     *
     * @returns A new typed cell matching `field.getType()`.
     */
    private static createCellForField(field: Field, columnConfigs: Map<string, ColumnConfig>): Cell<any> {
        switch (field.getType()) {
            case "string":
                return new StringCell();
            case "number":
                return new NumberCell();
            case "boolean":
                return new BooleanCell();
            case "date":
                return new DateCell();
            case "time":
                return new TimeCell(columnConfigs.get(field.getName())?.showSeconds ?? false);
            case "datetime":
                return new DateTimeCell(columnConfigs.get(field.getName())?.showSeconds ?? false);
            case "glyph":
                return new GlyphCell();
            default:
                return new DefaultCell();
        }
    }

    /**
     * No-op; cell layout is driven by the Body's renderWindow.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        return this;
    }
}

const RowCallable = callable(Row);
type RowCallable = Row;
export {
    Row         as _Row,
    RowCallable as Row
};
