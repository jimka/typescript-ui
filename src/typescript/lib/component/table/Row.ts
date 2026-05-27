// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { AbstractModel } from "~/data/AbstractModel.js";
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
                let cell;

                switch (field.getType()) {
                    case "string":
                        cell = new StringCell();
                        break;
                    case "number":
                        cell = new NumberCell();
                        break;
                    case "boolean":
                        cell = new BooleanCell();
                        break;
                    case "date":
                        cell = new DateCell();
                        break;
                    case "time":
                        cell = new TimeCell(columnConfigs.get(field.getName())?.showSeconds ?? false);
                        break;
                    case "datetime":
                        cell = new DateTimeCell(columnConfigs.get(field.getName())?.showSeconds ?? false);
                        break;
                    case "glyph":
                        cell = new GlyphCell();
                        break;
                    default:
                        cell = new DefaultCell();
                        break;
                }

                cell.setValue(value);
                cell.setOnCommit((newValue) => {
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
     * Applies a background color based on the record's new/dirty/clean state.
     *
     * @remarks New records get a green tint, dirty records an orange tint, and clean records no tint.
     */
    updateVisualState(): void {
        const el = this.getElement() as HTMLElement;
        if (!el) {
            return;
        }

        if (this._data?.isNew()) {
            el.style.setProperty('background-color', 'var(--ts-ui-table-row-new, rgba(70, 200, 70, 0.15))');
        } else if (this._data?.isDirty()) {
            el.style.setProperty('background-color', 'var(--ts-ui-table-row-dirty, rgba(255, 165, 0, 0.15))');
        } else {
            el.style.removeProperty('background-color');
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
