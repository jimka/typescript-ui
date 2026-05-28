// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Table } from "~/component/table/Table.js";
import { TreeBody } from "~/component/table/TreeBody.js";
import { TreeTableSpec } from "~/component/table/TreeTableSpec.js";
import { AbstractStore } from "~/data/AbstractStore.js";
import { ModelRecord } from "~/data/ModelRecord.js";
import { callable } from "~/core/Callable.js";

/** Default pixels of indentation per depth level when the spec omits `indentPx`. */
const DEFAULT_INDENT_PX = 16;

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

}

const TreeTableCallable = callable(TreeTable);
type TreeTableCallable = TreeTable;
export {
    TreeTable         as _TreeTable,
    TreeTableCallable as TreeTable
};
