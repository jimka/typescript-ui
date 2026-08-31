// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Cell } from "~/component/table/cell/Cell.js";
import type { CellEditor } from "~/component/table/cell/editor/CellEditor.js";
import type { ComboEditor } from "~/component/table/cell/editor/Combo.js";
import { BooleanEditor } from "~/component/table/cell/editor/Boolean.js";
import { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import { StringRenderer } from "~/component/table/cell/renderer/String.js";
import { ComboRenderer } from "~/component/table/cell/renderer/Combo.js";
import { buildCellRenderer } from "~/component/table/cell/CellText.js";
import type { CellType, ColumnConfig, ComboOption } from "~/component/table/ColumnConfig.js";
import type { ModelRecord } from "~/data/ModelRecord.js";
import type { FieldType } from "~/data/Field.js";
import { callable } from "~/core/Callable.js";

/**
 * A table cell whose active renderer and editor vary per bound record,
 * driven by {@link ColumnConfig.cellType}.
 *
 * One `DynamicCell` instance lives for the life of its pool slot — every
 * built-in variant it can show (`string`, `number`, `date`, `time`,
 * `datetime`, `glyph`, `combo`, `boolean`) is built lazily and cached, then
 * swapped into view on {@link DynamicCell.bindRecord} by making it the
 * cell's active renderer. This keeps the slot's committed geometry,
 * editor-pool wiring, commit wiring, read-only state, and focus behaviour
 * valid across rebinds that change the resolved variant, unlike replacing
 * the cell instance itself.
 *
 * A `'boolean'` row reuses the checkbox-as-renderer pattern from
 * {@link BooleanCell}: a {@link BooleanEditor} is placed in the renderer
 * slot and commits immediately on toggle, with no separate edit cycle. A
 * `'combo'` row shares one pooled `combo:<field>` editor across every combo
 * row in the column; {@link ColumnConfig.cellValues} supplies that row's
 * option set, injected into the pooled editor just before it opens.
 *
 * @category Components
 */
class DynamicCell extends Cell<any> {

    private _field:          string;
    private _columnType:     FieldType;
    private _showSeconds:    boolean;
    private _cellType:       ((record: ModelRecord) => CellType | null) | undefined;
    private _cellValues:     ((record: ModelRecord) => Array<ComboOption | string> | undefined) | undefined;
    private _renderers:      Map<CellType, CellRenderer<any>> = new Map();
    private _activeType:     CellType = 'string';
    private _currentOptions: Array<ComboOption | string> = [];
    private _checkbox:       BooleanEditor | null = null;
    // Set by `ensureRenderer` / `ensureCheckbox` immediately before the call
    // to `setActiveRenderer` that consumes it, to say whether the returned
    // variant was just constructed (true) or already cached (false).
    private _justCreated:    boolean = false;

    /**
     * @param field - The model field name this column presents.
     * @param columnType - The column's declared field type; the fallback
     *   variant when {@link ColumnConfig.cellType} returns `null` for a record.
     * @param config - The column's config, supplying `cellType`, `cellValues`,
     *   and `showSeconds`.
     */
    constructor(field: string, columnType: FieldType, config: ColumnConfig) {
        const placeholder = new StringRenderer();

        super("td", placeholder);

        this._field       = field;
        this._columnType  = columnType;
        this._showSeconds = config.showSeconds ?? false;
        this._cellType    = config.cellType;
        this._cellValues  = config.cellValues;

        this._renderers.set('string', placeholder);
    }

    /**
     * Resolves the active variant for `record`, swaps to the matching
     * cached renderer (constructing it on first use), and pushes the
     * record's value into it.
     *
     * @param record - The record now bound to this cell's pool slot.
     */
    bindRecord(record: ModelRecord): void {
        const resolved = this._cellType?.(record) ?? this._columnType;

        this._activeType = resolved;

        if (resolved === 'boolean') {
            const checkbox = this.ensureCheckbox();

            this.setActiveRenderer(checkbox as unknown as CellRenderer<any>, this._justCreated);
            checkbox.setValue(record.get(this._field));

            return;
        }

        if (resolved === 'combo') {
            this._currentOptions = this._cellValues?.(record) ?? [];

            const renderer = this.ensureRenderer('combo') as ComboRenderer;
            renderer.setOptions(this._currentOptions);
            this.setActiveRenderer(renderer, this._justCreated);
            renderer.setValue(record.get(this._field));

            return;
        }

        const renderer = this.ensureRenderer(resolved);

        this.setActiveRenderer(renderer, this._justCreated);
        renderer.setValue(record.get(this._field));
    }

    /**
     * Returns the pool key for the active variant's shared editor.
     *
     * @returns A key registered on the {@link CellEditorPool}, or `null` for
     *   variants with no pooled editor (`boolean`, `glyph`).
     */
    getEditorKey(): string | null {
        switch (this._activeType) {
            case 'number':
                return 'number';
            case 'date':
                return 'date';
            case 'time':
                return this._showSeconds ? 'time:seconds' : 'time';
            case 'datetime':
                return this._showSeconds ? 'datetime:seconds' : 'datetime';
            case 'combo':
                return `combo:${this._field}`;
            case 'boolean':
            case 'glyph':
                return null;
            default:
                return 'string'; // 'string' | 'auto'
        }
    }

    /**
     * Toggles the checkbox directly when the active variant is `boolean`
     * (mirroring {@link BooleanCell.startEdit}, which has no separate edit
     * cycle); otherwise defers to the base pooled-editor flow.
     */
    startEdit(): void {
        if (this._activeType === 'boolean') {
            if (this.isReadOnly()) {
                return;
            }

            this._checkbox?.toggle();

            return;
        }

        super.startEdit();
    }

    /**
     * @returns `true` when the active variant is `boolean` — `startEdit()`
     *   toggles the checkbox immediately rather than opening a distinct edit
     *   session (mirroring {@link BooleanCell.hasImmediateEditCommit}); `false`
     *   for every other variant, which do open one.
     */
    hasImmediateEditCommit(): boolean {
        return this._activeType === 'boolean';
    }

    /**
     * Marks the cell read-only and, when the active variant is `boolean`,
     * also disables the checkbox so it rejects toggles.
     *
     * @param value - `true` to mark read-only, `false` to restore.
     * @returns This cell, for method chaining.
     */
    setReadOnly(value: boolean): this {
        super.setReadOnly(value);

        if (this._activeType === 'boolean') {
            this._checkbox?.setReadOnly(value);
        }

        return this;
    }

    /**
     * Pushes the current record's combo options into the pooled editor
     * before it receives a value, so a shared `combo:<field>` editor
     * reflects this row's option set rather than whichever row last opened it.
     *
     * @param editor - The editor about to be shown.
     */
    protected prepareEditor(editor: CellEditor<any>): void {
        if (this._activeType === 'combo') {
            (editor as ComboEditor).setOptions(this._currentOptions);
        }
    }

    /**
     * Returns the cached renderer for `type`, lazily constructing it on
     * first use and recording whether it was just constructed via
     * `_justCreated`.
     *
     * @param type - The built-in variant to fetch a renderer for.
     * @returns The cached (or freshly built) renderer for `type`.
     */
    private ensureRenderer(type: CellType): CellRenderer<any> {
        const cached = this._renderers.get(type);

        if (cached) {
            this._justCreated = false;

            return cached;
        }

        const renderer = DynamicCell.buildRenderer(type, this._showSeconds);

        this._renderers.set(type, renderer);
        this._justCreated = true;

        return renderer;
    }

    /**
     * Constructs the renderer for a built-in variant. `glyph` and any
     * unrecognised variant fall back to a {@link StringRenderer}.
     *
     * @param type - The variant to construct a renderer for.
     * @param showSeconds - Forwarded to `time`/`datetime` renderers.
     * @returns A freshly constructed renderer for `type`.
     */
    private static buildRenderer(type: CellType, showSeconds: boolean): CellRenderer<any> {
        // Left-aligned: unlike a homogeneous number column, a DynamicCell
        // number row sits in a column that also shows left-aligned
        // string/date/combo rows, and a lone right-aligned row read as
        // jarring there.
        return buildCellRenderer(type, showSeconds, "left");
    }

    /**
     * Returns the cached checkbox editor, lazily constructing it on first
     * use and wiring its `change` event to commit immediately (mirroring
     * {@link BooleanCell}'s immediate-commit contract). Records whether it
     * was just constructed via `_justCreated`.
     *
     * @returns The cached (or freshly built) checkbox editor.
     */
    private ensureCheckbox(): BooleanEditor {
        if (this._checkbox) {
            this._justCreated = false;

            return this._checkbox;
        }

        const checkbox = new BooleanEditor();

        checkbox.on("change", (value) => this.emitCommit(value));

        this._checkbox = checkbox;
        this._justCreated = true;

        return checkbox;
    }

    /**
     * Fires the cell's `"commit"` event with `value`. Extracted so the
     * checkbox's `change` listener has a stable bound method to call.
     *
     * @param value - The value to commit.
     */
    private emitCommit(value: any): void {
        this.emit("commit", value);
    }
}

const DynamicCellCallable = callable(DynamicCell);
type DynamicCellCallable = DynamicCell;
export {
    DynamicCell         as _DynamicCell,
    DynamicCellCallable as DynamicCell
};
