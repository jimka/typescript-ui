// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ColumnSpec } from "~/component/table/ColumnConfig.js";

/**
 * Presentation + hierarchy specification for a {@link TreeTable}.
 *
 * Extends {@link ColumnSpec} with three required fields that describe
 * the parent/child relationship encoded on the underlying model — the
 * id field, the parent-id field, and the name of the column whose
 * cell carries the indent and expand/collapse toggle.
 *
 * @example
 * ```typescript
 * new TreeTable(store, {
 *     idField:     'id',
 *     parentField: 'parentId',
 *     treeColumn:  'name',
 *     columns: [
 *         { field: 'name', minWidth: 200 },
 *         { field: 'size' },
 *     ],
 * });
 * ```
 *
 * @category Components
 */
export interface TreeTableSpec extends ColumnSpec {
    /** Field whose value is each record's id (the primary key, normally). */
    idField:     string;

    /** Field whose value is each record's parent id, or `null` for root records. */
    parentField: string;

    /**
     * Name of the column whose cell carries the indent + expand/collapse
     * toggle. Must match a `field` in `columns` (or any model field when
     * `appendUnlisted !== false`).
     */
    treeColumn:  string;

    /** Pixels of indentation added per depth level. Defaults to 16. */
    indentPx?:   number;
}
