// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { ModelRecord } from "~/data/ModelRecord.js";

/**
 * Presentation configuration for a single table column.
 *
 * References a model field by name and carries optional display constraints.
 * Fields not mentioned in a {@link ColumnSpec} are auto-generated with default
 * sizing unless `appendUnlisted` is set to `false`.
 *
 * @category Components
 */
export interface ColumnConfig {
    /** The model field name this column presents. */
    field     : string;
    /** Minimum width in pixels. The column cannot be dragged narrower than this value. */
    minWidth ?: number;
    /** Maximum width in pixels. The column cannot be dragged wider than this value. */
    maxWidth ?: number;
    /** When `true` the column starts hidden; the user can still reveal it via the context menu. */
    hidden      ?: boolean;
    /**
     * When `true` the user cannot hide this column via the context menu;
     * the entry renders disabled with the visible checkmark, and
     * `Table.setColumnVisible(field, false)` is a no-op. Takes precedence
     * over `hidden: true` — an unhideable column never starts hidden.
     *
     * Defaults to `false`. The flag does not auto-include the column when
     * `appendUnlisted: false` excludes unlisted fields; list the column
     * explicitly in `spec.columns` to mark it unhideable.
     */
    unhideable  ?: boolean;

    /**
     * When `true`, every cell in this column is read-only — the value
     * is displayed but the user cannot edit it. Read-only cells refuse
     * inline editing (double-click is a no-op), render with a subtle
     * grey tint sourced from `--ts-ui-table-cell-readonly-bg`, and
     * present a default cursor on hover instead of the edit affordance.
     *
     * Selection, keyboard navigation, sorting, resizing, drag-reorder,
     * and CSV / JSON export are unaffected — read-only means "value is
     * fixed," not "row is inert." In a {@link TreeTable}, toggling
     * expand / collapse on the tree column still works when that column
     * is read-only (expansion is not editing).
     *
     * Defaults to `false`.
     */
    readOnly    ?: boolean;
    /**
     * Per-cell read-only predicate, evaluated per record on every
     * rebind. Returns `true` to mark this column's cell read-only for
     * the given record. Composes with {@link ColumnConfig.readOnly} and
     * {@link ColumnSpec.rowReadOnly} via OR — a cell is read-only when
     * ANY of the three signals says so.
     *
     * The predicate fires on every row rebind: when scrolling pulls
     * new records into the visible window, when the store emits
     * `'datachanged'` (which
     * [`notifyRecordChanged`](/api/data/classes/AbstractStore#notifyRecordChanged)
     * does), or when columns are hidden / shown. It MUST be O(1) and
     * pure — read fields off `record`, return a boolean, do not call
     * back into the store, do not allocate, do not perform DOM work.
     * Memoise inside the predicate if your computation is non-trivial;
     * the table does not cache results.
     *
     * Mutating a store-owned record auto-refreshes the table; call
     * `store.notifyRecordChanged(record)` only for an unowned record or
     * to force a refresh — the predicate fires again on the next paint.
     */
    cellReadOnly ?: (record: ModelRecord) => boolean;
    /**
     * For `time` and `datetime` columns: when `true` the editor and renderer include seconds.
     * Defaults to `false` (hours and minutes only).
     */
    showSeconds ?: boolean;
    /**
     * Registry glyph name shown to the left of the header text.
     * Omit for no glyph; no left-side gap is reserved when absent.
     */
    headerGlyph ?: string;
    /**
     * Name of the parent-header group this column belongs to. Adjacent columns
     * sharing the same group name render under a single spanning parent header
     * cell. Non-adjacent same-named columns render as two separate parent cells.
     * Omit to leave the column ungrouped; the parent row then renders an empty
     * spanning cell above it.
     */
    group       ?: string;
    /**
     * Optional background color (CSS color string) for the parent header cell.
     * All columns in a contiguous group should agree on this value; the first
     * encountered value in the run wins.
     */
    groupColor  ?: string;
}

/**
 * Presentation specification passed to a {@link Table} to control which columns
 * are shown and how they behave.
 *
 * When omitted entirely the table auto-generates one column per model field
 * using default sizing — identical to the pre-spec behaviour.
 *
 * @example
 * ```typescript
 * new Table(store, {
 *     columns: [
 *         { field: 'name', minWidth: 120 },
 *         { field: 'id',   maxWidth: 80  },
 *     ],
 * })
 * ```
 *
 * @category Components
 */
export interface ColumnSpec {
    /** Per-column presentation overrides, in preferred display order. */
    columns        : ColumnConfig[];
    /**
     * When `true` (the default) model fields not mentioned in `columns` are
     * appended automatically after the listed columns with default sizing.
     * When `false` only the explicitly listed fields appear in the table.
     */
    appendUnlisted ?: boolean;
    /**
     * Per-row read-only predicate. Receives each visible record on every
     * rebind and returns `true` to mark every cell in that row read-only
     * for the next render pass.
     *
     * Composes with {@link ColumnConfig.readOnly} (column-level static
     * flag) and {@link ColumnConfig.cellReadOnly} (per-cell predicate):
     * a cell is read-only when ANY of the three signals says so.
     *
     * The predicate fires on every row rebind — when scrolling pulls
     * new records into the visible window, when the store emits
     * `'datachanged'` (which
     * [`notifyRecordChanged`](/api/data/classes/AbstractStore#notifyRecordChanged)
     * does), or when columns are hidden / shown. It MUST be O(1) and
     * pure: read fields off `record`, return a boolean, do not call
     * back into the store, do not allocate, do not touch the DOM.
     * Memoise inside your predicate if the computation is non-trivial;
     * the framework does not cache results.
     *
     * Mutating a store-owned record auto-refreshes the table; call
     * `store.notifyRecordChanged(record)` only for an unowned record or
     * to force a refresh — the predicate fires again on the next paint.
     */
    rowReadOnly    ?: (record: ModelRecord) => boolean;
}
