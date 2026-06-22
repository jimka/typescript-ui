// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Event } from "~/core/Event.js";
import { Table } from "~/component/table/Table.js";
import { TreeBody } from "~/component/table/TreeBody.js";
import { TreeTableSpec } from "~/component/table/TreeTableSpec.js";
import { AbstractStore } from "~/data/AbstractStore.js";
import { ModelRecord } from "~/data/ModelRecord.js";
import { callable } from "~/core/Callable.js";

/** Default pixels of indentation per depth level when the spec omits `indentPx`. */
const DEFAULT_INDENT_PX = 16;

/**
 * Payload delivered to listeners registered through
 * {@link TreeTable.addRowReparentListener}. Fired after a successful
 * {@link TreeTable.reparentRow} call.
 *
 * @category Components
 */
export interface RowReparentDetail {
    /** The record whose `parentField` value changed. */
    record:    ModelRecord;
    /** The new parent record, or `null` when reparented to root. */
    newParent: ModelRecord | null;
    /** The previous parent record, or `null` when the row was previously at root. */
    oldParent: ModelRecord | null;
}

/**
 * A data-bound table whose rows form a parent/child hierarchy.
 *
 * Composes the standard [`Header`](/api/component/table/classes/Header),
 * a tree-aware [`TreeBody`](/api/component/table/classes/TreeBody), and an
 * optional [`FooterRow`](/api/component/table/classes/FooterRow). Reuses
 * every public surface from {@link Table} (CRUD, sync, column visibility
 * and resize, sort cycling, context menu, exporter) — the only
 * difference is the body: virtual-scroll over a depth-aware, expansion-
 * aware flat record list rather than over the store's view directly.
 *
 * Hierarchy is encoded on the store's existing model: each record names
 * the id of its parent (or `null` for roots) via the field named in
 * {@link TreeTableSpec.parentField}. No new store subtype or schema
 * extension is required.
 *
 * One designated column — {@link TreeTableSpec.treeColumn} — renders
 * with an indent + expand/collapse toggle to the left of the value.
 * The toggle is a [`Glyph`](/api/component/display/classes/Glyph)
 * (`caret-down` / `caret-right`); the rest of the cell content is
 * drawn by whichever typed renderer the column would normally use,
 * unchanged.
 *
 * The ARIA role is `treegrid` (not `grid`). Pool rows additionally
 * carry `aria-level`, `aria-expanded`, `aria-setsize`, and
 * `aria-posinset`.
 *
 * @example
 * ```typescript
 * const model = new Model([
 *     { name: 'id',       type: 'number' },
 *     { name: 'parentId', type: 'number' },
 *     { name: 'name',     type: 'string' },
 *     { name: 'size',     type: 'number' },
 * ]);
 *
 * const store = new MemoryStore(model, [
 *     { id: 1, parentId: null, name: 'Documents', size: 0   },
 *     { id: 2, parentId: 1,    name: 'report.pdf', size: 84 },
 *     { id: 3, parentId: null, name: 'Music',     size: 0   },
 * ]);
 *
 * const tree = new TreeTable(store, {
 *     idField:     'id',
 *     parentField: 'parentId',
 *     treeColumn:  'name',
 *     columns: [
 *         { field: 'name', minWidth: 200 },
 *         { field: 'size' },
 *     ],
 * });
 *
 * tree.expandToDepth(0);
 * ```
 *
 * @category Components
 */
class TreeTable extends Table {

    private _treeSpec: TreeTableSpec;
    private _treeBody: TreeBody;

    /**
     * Maps each consumer-supplied `rowreparent` listener to the
     * CustomEvent-unwrapping wrapper actually registered with
     * `Event.addListener`. The wrapper is the removable reference;
     * the original listener is the lookup key. Inline arrows can't be
     * removed by reference, so the wrapper is built once at add-time
     * and stored.
     */
    private _rowReparentWrappers = new Map<
        (detail: RowReparentDetail) => void,
        (e: CustomEvent<RowReparentDetail>) => void
    >();

    /**
     * Constructs a TreeTable bound to the given store.
     *
     * @param store - The data store carrying the records. Each record
     *   must have a value at `spec.idField`; root records have a
     *   `null` (or absent) value at `spec.parentField`.
     * @param spec - Tree presentation + hierarchy configuration.
     */
    constructor(store: AbstractStore, spec: TreeTableSpec) {
        const indentPx     = spec.indentPx ?? DEFAULT_INDENT_PX;
        const adjustedSpec = TreeTable.markTreeColumnUnhideable(spec);

        // Body factory is a closure capturing `spec` from the constructor
        // parameter, so super() can construct the TreeBody before any
        // TreeTable instance field has been initialised. A subclass-
        // overridable `createBody` method would hit the class-field
        // super-trap here (the field carrying the spec would still be
        // `undefined` when the override ran).
        super(store, adjustedSpec, (s) => new TreeBody(s, {
            idField:     spec.idField,
            parentField: spec.parentField,
            treeColumn:  spec.treeColumn,
            indentPx,
        }));

        this._treeSpec = spec;
        this._treeBody = this.getBody() as TreeBody;

        this.getAria().setRole("treegrid");

        // Inject the reparent callbacks so `TreeBody` can install
        // per-row drag sources / drop targets once each pool row is
        // bound. The validator path lets the per-row drop targets
        // surface the cycle / no-op rejection through the green/red
        // feedback tint without committing the move.
        this._treeBody.setReparentHandlers(
            (dragged, newParent) => this.canReparent(dragged, newParent),
            (dragged, newParent) => this.reparentRow(dragged, newParent),
        );
    }

    /**
     * Returns a clone of `spec` with `unhideable: true` set on the column
     * matching `spec.treeColumn`. Synthesises a new `ColumnConfig` entry
     * if the tree column is not listed in `spec.columns`, so that
     * `appendUnlisted: false` cannot drop the tree column.
     *
     * @param spec - The consumer-supplied tree-table spec.
     *
     * @returns A new spec object whose `columns` entry for the tree
     *   column carries `unhideable: true`.
     */
    private static markTreeColumnUnhideable(spec: TreeTableSpec): TreeTableSpec {
        const existing = spec.columns.find(c => c.field === spec.treeColumn);
        const updated  = existing
            ? spec.columns.map(c => c.field === spec.treeColumn ? { ...c, unhideable: true } : c)
            : [...spec.columns, { field: spec.treeColumn, unhideable: true }];

        return { ...spec, columns: updated };
    }

    /**
     * Returns the tree-aware body that owns the depth-flattened
     * record list and expand/collapse state. Narrower return type than
     * {@link Table.getBody}.
     *
     * @returns The {@link TreeBody}.
     */
    getBody(): TreeBody {
        return super.getBody() as TreeBody;
    }

    /**
     * Returns the tree-table spec passed at construction.
     *
     * @returns The {@link TreeTableSpec} used to configure this tree.
     */
    getTreeSpec(): TreeTableSpec {
        return this._treeSpec;
    }

    /**
     * Expands or collapses the given record. No-op for leaves and for
     * records not present in the current store view.
     *
     * @param record - The record to expand or collapse.
     * @param expanded - `true` to expand, `false` to collapse.
     *
     * @returns This table, for method chaining.
     */
    setExpanded(record: ModelRecord, expanded: boolean): this {
        this._treeBody.setExpanded(record, expanded);

        return this;
    }

    /**
     * Returns whether the given record is currently expanded.
     *
     * @param record - The record to query.
     *
     * @returns `true` when the record is a branch and currently
     *   expanded, `false` otherwise.
     */
    isExpanded(record: ModelRecord): boolean {
        return this._treeBody.isExpanded(record);
    }

    /**
     * Expands every record at depth `<= depth`. Roots are at depth 0.
     *
     * @param depth - Maximum depth to expand.
     *
     * @returns This table, for method chaining.
     */
    expandToDepth(depth: number): this {
        this._treeBody.expandToDepth(depth);

        return this;
    }

    /**
     * Collapses every record.
     *
     * @returns This table, for method chaining.
     */
    collapseAll(): this {
        this._treeBody.collapseAll();

        return this;
    }

    /**
     * Expands every record that has children.
     *
     * @returns This table, for method chaining.
     */
    expandAll(): this {
        this._treeBody.expandAll();

        return this;
    }

    /**
     * Adds a new record, optionally setting its parent-id field so the
     * new record slots under the given parent.
     *
     * @param defaults - Optional initial field values for the new record.
     * @param parent - Optional. When supplied, the new record's
     *   `spec.parentField` value is set to `parent.get(spec.idField)`
     *   before insertion.
     *
     * @returns The newly created {@link ModelRecord}.
     */
    addRow(defaults: Record<string, any> = {}, parent?: ModelRecord): ModelRecord {
        const payload = parent
            ? { ...defaults, [this._treeSpec.parentField]: parent.get(this._treeSpec.idField) }
            : defaults;

        return super.addRow(payload);
    }

    /**
     * Resolves a record by its `idField` value. Delegates to
     * [`TreeBody.getRecordById`](/api/component/table/classes/TreeBody#getrecordbyid).
     *
     * @param id - The id-field value to look up.
     *
     * @returns The matching record, or `undefined` when the id is not
     *   present in the current store view.
     */
    getRecordById(id: any): ModelRecord | undefined {
        return this._treeBody.getRecordById(id);
    }

    /**
     * Returns whether the given record currently has at least one
     * child — i.e. behaves as a directory in the rendered tree.
     *
     * @param record - The record to test.
     *
     * @returns `true` when the record has children; `false` for leaves.
     */
    isDirectoryRecord(record: ModelRecord): boolean {
        return this._treeBody.isDirectoryRecord(record);
    }

    /**
     * Reparents the given record under `newParent` (or root when
     * `newParent` is `null`). Rejects cycles and no-ops, fires a
     * `rowreparent` event on success.
     *
     * @param record - The record to move.
     * @param newParent - The new parent record, or `null` for root.
     *
     * @returns `true` when the reparent succeeded; `false` when it was
     *   rejected (cycle, no-op, or unknown record).
     */
    reparentRow(record: ModelRecord, newParent: ModelRecord | null): boolean {
        if (!this.canReparent(record, newParent)) {
            return false;
        }

        const parentField = this._treeSpec.parentField;
        const idField     = this._treeSpec.idField;

        const oldParentId = record.get(parentField);
        const oldParent   = oldParentId != null ? this._treeBody.getRecordById(oldParentId) ?? null : null;

        record.set(parentField, newParent !== null ? newParent.get(idField) : null);
        this.getStore().notifyRecordChanged(record);

        const detail: RowReparentDetail = {
            record,
            newParent,
            oldParent,
        };

        Event.fireEvent(this, "rowreparent", { detail });

        return true;
    }

    /**
     * Returns whether `record` may legally be reparented under
     * `newParent`. Used both by {@link reparentRow} for the commit-
     * time guard and by `TreeBody`'s per-row drop targets for the
     * visual feedback tint.
     *
     * @param record - The candidate record.
     * @param newParent - The candidate new parent, or `null` for root.
     *
     * @returns `true` when the move is a real change and would not
     *   create a cycle; `false` otherwise.
     */
    private canReparent(record: ModelRecord, newParent: ModelRecord | null): boolean {
        if (!this._treeBody.getRecordById(record.get(this._treeSpec.idField))) {
            return false;
        }

        // No-op: dropping a record back into the same parent (or onto
        // itself) is rejected so the visual feedback tint reads "no
        // valid move" rather than flashing green and silently doing
        // nothing.
        const currentParentId = record.get(this._treeSpec.parentField);
        const newParentId     = newParent !== null ? newParent.get(this._treeSpec.idField) : null;

        if (currentParentId === newParentId) {
            return false;
        }

        if (newParent !== null && this._treeBody.isAncestorOf(record, newParent)) {
            return false;
        }

        return true;
    }

    /**
     * Registers a listener fired after every successful
     * {@link reparentRow} call. Use to react to drag-and-drop row
     * moves originating from
     * [`DragManager`](/api/overlay/variables/DragManager).
     *
     * @param listener - Receives the {@link RowReparentDetail} payload.
     *
     * @returns This table, for method chaining.
     */
    addRowReparentListener(listener: (detail: RowReparentDetail) => void): this {
        if (this._rowReparentWrappers.has(listener)) {
            return this;
        }

        const wrapper = (e: CustomEvent<RowReparentDetail>): void => listener(e.detail);

        this._rowReparentWrappers.set(listener, wrapper);
        Event.addListener(this, "rowreparent", wrapper);

        return this;
    }

    /**
     * Removes a previously registered `rowreparent` listener.
     *
     * @param listener - The exact callback reference passed to
     *   {@link addRowReparentListener}.
     *
     * @returns This table, for method chaining.
     */
    removeRowReparentListener(listener: (detail: RowReparentDetail) => void): this {
        const wrapper = this._rowReparentWrappers.get(listener);

        if (!wrapper) {
            return this;
        }

        Event.removeListener(this, "rowreparent", wrapper);
        this._rowReparentWrappers.delete(listener);

        return this;
    }
}

const TreeTableCallable = callable(TreeTable);
type TreeTableCallable = TreeTable;
export {
    TreeTable         as _TreeTable,
    TreeTableCallable as TreeTable
};
