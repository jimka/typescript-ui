// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Presentation configuration for a single table column.
 *
 * References a model field by name and carries optional display constraints.
 * Fields not mentioned in a {@link ColumnSpec} are auto-generated with default
 * sizing unless `appendUnlisted` is set to `false`.
 */
export interface ColumnConfig {
    /** The model field name this column presents. */
    field     : string;
    /** Minimum width in pixels. The column cannot be dragged narrower than this value. */
    minWidth ?: number;
    /** Maximum width in pixels. The column cannot be dragged wider than this value. */
    maxWidth ?: number;
    /** When `true` the column starts hidden; the user can still reveal it via the context menu. */
    hidden   ?: boolean;
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
}
