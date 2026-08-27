// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { ModelRecord } from "~/data/ModelRecord.js";
import type { CellRenderer } from "~/component/table/cell/renderer/CellRenderer.js";
import type { FieldType } from "~/data/Field.js";

/**
 * One selectable option for a constrained-choice (combo-box) column.
 *
 * A plain string in a {@link ColumnConfig.values} array is shorthand for
 * `{ value: s, label: s }`; an object form lets the value stored on the
 * record differ from the text shown to the user (e.g. value `"AU"`, label
 * `"Australia"`).
 *
 * @category Components
 */
export interface ComboOption {
    /** The value stored on the record and round-tripped by the cell. */
    value:  string;
    /** Display text shown in the cell and dropdown; defaults to `value`. */
    label?: string;
}

/**
 * Expands a {@link ColumnConfig.values} array — whose entries are either
 * plain strings or {@link ComboOption} objects — into fully-populated
 * `{ value, label }` pairs, defaulting an omitted `label` to the `value`.
 *
 * Shared by the combo cell's renderer (which builds a value-to-label map)
 * and its editor (which builds the dropdown's item list) so the two never
 * disagree about what label a value renders.
 *
 * @param options - The raw `values` entries from a column config.
 * @returns One `{ value, label }` pair per entry, in the same order.
 *
 * @internal
 */
export function normalizeComboOptions(options: Array<ComboOption | string>): Array<Required<ComboOption>> {
    return options.map(option =>
        typeof option === "string"
            ? { value: option, label: option }
            : { value: option.value, label: option.label ?? option.value },
    );
}

/**
 * The cell variant a per-cell resolver may select. Extends {@link FieldType}
 * with `'combo'` for a constrained-choice (combo-box) cell.
 *
 * @category Components
 */
export type CellType = FieldType | 'combo';

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
    /**
     * Explicit starting width in pixels. Takes precedence over the type
     * policy and any sampled content, but is still clamped into the
     * column's `[minWidth, maxWidth]` envelope — an explicit `width`
     * narrower than the type's floor is raised to that floor.
     */
    width            ?: number;
    /**
     * Longest value this column can hold, in characters (e.g. a
     * `varchar(60)` column passes `60`). For a `string`/`auto` column
     * under {@link ColumnSpec.autoSizeColumns} this is used only when
     * sampling the store yields no candidates; for a `number` column it
     * outranks the sample, since a declared digit budget is a better
     * answer than what fifty rows happen to hold.
     */
    maxContentLength ?: number;
    /**
     * When `true`, this column's width is kept unchanged whenever the
     * table's container resizes, instead of scaling proportionally with
     * the other flexible columns the way a `string`/`auto` column does by
     * default. The column is still sized normally on first render, after a
     * model swap, and on every data-driven re-sample under
     * {@link ColumnSpec.autoSizeColumns} — from its own `width`, sampled
     * content, or a shared flex allotment — and a user drag still resizes
     * it; this flag affects container resizes only.
     *
     * If the table no longer fits once this column keeps its width, the
     * table scrolls horizontally instead of shrinking it — the same
     * fallback `boolean` / `number` / `date` columns already get.
     *
     * Defaults to `false`.
     */
    preserveWidth ?: boolean;
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
     * When `false`, this column gets no filter input in the header's filter
     * row. Resolution: `ColumnConfig.filterable` wins when set; otherwise
     * falls back to {@link ColumnSpec.filterable}; otherwise `true`.
     * The row itself only ever appears when {@link Table.setFilterRowVisible}
     * (or the header's context-menu **Filter** entry) is also on.
     */
    filterable ?: boolean;
    /**
     * Per-cell read-only predicate, evaluated per record on every
     * rebind. Returns `true` to mark this column's cell read-only for
     * the given record. Composes with {@link ColumnConfig.readOnly} and
     * {@link ColumnSpec.rowReadOnly} via OR — a cell is read-only when
     * ANY of the three signals says so.
     *
     * The predicate fires on every row rebind: when scrolling pulls
     * new records into the visible window, when the store emits
     * `'datachange'` (which
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
     * When present, this column renders as a constrained-choice (combo-box)
     * cell regardless of the field's declared type. The inline editor offers
     * exactly these options; the cell displays each option's label for the
     * stored value, falling back to the raw value when it is not in the set.
     *
     * Each entry is either a plain string (shorthand for value === label) or
     * a {@link ComboOption} `{ value, label }` pair. The value stored on the
     * record is always the option's `value` string. An empty or absent array
     * leaves the column on its field-type-driven cell.
     */
    values      ?: Array<ComboOption | string>;
    /**
     * Per-cell (per-record) variant resolver. Returns which built-in cell
     * type to render/edit for THIS row's cell, or `null` to fall back to
     * the column's field-type-driven cell. Its presence switches the
     * column onto a dynamic, per-record cell.
     *
     * The resolver fires on every row rebind — when scrolling pulls new
     * records into the visible window, when the store emits
     * `'datachange'`, or when columns are hidden / shown. It MUST be O(1)
     * and pure — read fields off `record`, return a variant, do not call
     * back into the store, do not allocate, do not perform DOM work.
     *
     * Heterogeneous columns (rows that commit different native types)
     * must declare the field `'auto'` so commits are not coerced to one
     * type.
     */
    cellType   ?: (record: ModelRecord) => CellType | null;
    /**
     * Per-cell combo options, consulted only when {@link ColumnConfig.cellType}
     * returns `'combo'` for the record. Each entry is a plain string or a
     * {@link ComboOption}. Absent/empty yields an empty dropdown.
     */
    cellValues ?: (record: ModelRecord) => Array<ComboOption | string> | undefined;
    /**
     * Custom cell-renderer factory for this column. When present it overrides
     * both the `values` (combo) routing and the field-type-driven cell: every
     * cell in the column is built display-only (no inline editor) around a
     * fresh {@link CellRenderer} from this factory, so the column shows
     * computed or styled content — a link, a badge, an icon beside text —
     * instead of an editable value.
     *
     * The factory runs once per rendered cell (one per row in the visible
     * window; cells are reused as the window scrolls). Each cell's value is
     * pushed to the renderer through `setValue` on every rebind, exactly like
     * the built-in typed renderers, so keep the renderer O(1) and pure. A
     * custom-rendered cell never enters edit mode; wire the {@link Table}
     * `"cellclick"` event for click behaviour.
     *
     * The library ships
     * [`LinkCellRenderer`](/api/component/table/classes/LinkCellRenderer) for the
     * common "clickable link cell" case — pass `renderer: () => new
     * LinkCellRenderer()` and handle `"cellclick"`.
     */
    renderer    ?: () => CellRenderer<any>;
    /**
     * Registry glyph name shown to the left of the header text.
     * Omit for no glyph; no left-side gap is reserved when absent.
     */
    headerGlyph ?: string;
    /**
     * Overrides the header label for this column. Defaults to the field name.
     * Set to `''` to render a blank header (used by the rotated view's filler
     * column).
     */
    headerText  ?: string;
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

    /**
     * When `true`, marks this column required: the header renders a
     * trailing asterisk, and every row's cell in this column outlines
     * with `--ts-ui-table-cell-required-outline` while its bound value
     * is empty (`null`, `undefined`, or `''`). Composes with
     * {@link ColumnConfig.requiredPredicate} via OR for the empty-cell
     * outline, but drives the header asterisk alone — the header cell
     * has no bound record to evaluate a per-record predicate against.
     *
     * Defaults to `false`.
     */
    required ?: boolean;
    /**
     * Per-record required predicate. Returns `true` to mark this
     * column's cell required for the given record. Composes with
     * {@link ColumnConfig.required} via OR for the empty-cell outline;
     * does NOT drive the header asterisk (the header has no bound
     * record).
     *
     * Unlike {@link ColumnConfig.cellReadOnly}, this predicate fires on
     * every visible-window render pass, not just on row rebind —
     * scrolling pulls new records in, the store emitting `'datachange'`
     * (which
     * [`notifyRecordChanged`](/api/data/classes/AbstractStore#notifyRecordChanged)
     * does) triggers one, columns hiding / showing triggers one, AND a
     * plain in-place cell edit re-runs it too, since the empty-cell
     * outline must track the live value. It MUST be O(1) and pure —
     * read fields off `record`, return a boolean, do not call back
     * into the store, do not allocate, do not perform DOM work.
     *
     * This is a visual affordance only: it does not block commits or
     * integrate with store-level validation.
     */
    requiredPredicate ?: (record: ModelRecord) => boolean;
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
     * `'datachange'` (which
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
    /**
     * When `true`, `string` and `auto` columns are sized from a bounded
     * sample of the values the column holds, instead of staying flex
     * columns that share the leftover space. `boolean`, `glyph`, `date`,
     * `time`, `datetime`, and `number` columns are always sized from
     * their type, whether or not this flag is set. Defaults to `false`.
     */
    autoSizeColumns ?: boolean;
    /**
     * Table-wide default for {@link ColumnConfig.filterable}. A column's own
     * `filterable` still wins when set. Defaults to `true`.
     */
    filterable ?: boolean;
}
