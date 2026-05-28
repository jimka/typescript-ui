// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

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
}
