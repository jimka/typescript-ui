// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Field } from "~/data/Field.js";
import { ColumnConfig, ColumnSpec } from "~/component/table/ColumnConfig.js";

/**
 * Resolved presentation descriptor for a single table column.
 *
 * Created internally by `Column.resolve` — not constructed directly by
 * application code. Wraps a {@link Field} and carries optional width constraints
 * and an initial visibility flag derived from a {@link ColumnSpec}.
 *
 * Re-exported as `TableColumn` from the package barrel.
 *
 * @category Components
 */
export class Column {

    private _field       : Field;
    private _minWidth    : number | undefined;
    private _maxWidth    : number | undefined;
    private _width       : number | undefined;
    private _maxContentLength: number | undefined;
    private _hidden      : boolean;
    private _unhideable  : boolean;
    private _readOnly    : boolean;
    private _headerGlyph : string | null;
    private _headerText  : string | null;
    private _group       : string | null;
    private _groupColor  : string | null;
    private _required    : boolean;

    /**
     * Constructs a Column from a field and an optional presentation config.
     *
     * @param field  - The model field this column represents.
     * @param config - Optional config; all constraint properties default to absent / false.
     */
    constructor(field: Field, config?: ColumnConfig) {
        this._field       = field;
        this._minWidth    = config?.minWidth;
        this._maxWidth    = config?.maxWidth;
        this._width       = config?.width;
        this._maxContentLength = config?.maxContentLength;
        this._hidden      = config?.hidden ?? false;
        this._unhideable  = config?.unhideable ?? false;
        this._readOnly    = config?.readOnly ?? false;
        this._headerGlyph = config?.headerGlyph ?? null;
        this._headerText  = config?.headerText ?? null;
        this._group       = config?.group ?? null;
        this._groupColor  = config?.groupColor ?? null;
        this._required    = config?.required ?? false;
    }

    /**
     * Returns the model field this column represents.
     *
     * @returns The underlying {@link Field}.
     */
    getField(): Field {
        return this._field;
    }

    /**
     * Returns the minimum column width in pixels declared in the spec.
     *
     * @returns The minimum width, or `undefined` if unconstrained.
     */
    getMinWidth(): number | undefined {
        return this._minWidth;
    }

    /**
     * Returns the maximum column width in pixels declared in the spec.
     *
     * @returns The maximum width, or `undefined` if unconstrained.
     */
    getMaxWidth(): number | undefined {
        return this._maxWidth;
    }

    /**
     * Returns the explicit starting width in pixels declared in the spec.
     *
     * @returns The declared width, or `undefined` if unset.
     */
    getWidth(): number | undefined {
        return this._width;
    }

    /**
     * Returns the longest value this column can hold, in characters, as
     * declared in the spec.
     *
     * @returns The declared character budget, or `undefined` if unset.
     */
    getMaxContentLength(): number | undefined {
        return this._maxContentLength;
    }

    /**
     * Returns whether this column starts hidden according to the spec.
     *
     * @returns `true` if the spec declared `hidden: true` for this column.
     */
    isInitiallyHidden(): boolean {
        return this._hidden;
    }

    /**
     * Returns whether this column is marked unhideable in the spec.
     * Unhideable columns always render and cannot be toggled off via
     * the column context menu or {@link Table.setColumnVisible}.
     *
     * @returns `true` when the spec declared `unhideable: true`.
     */
    isUnhideable(): boolean {
        return this._unhideable;
    }

    /**
     * Returns whether this column is marked read-only in the spec.
     * Every cell in a read-only column refuses inline editing and
     * renders with a grey tint.
     *
     * @returns `true` when the spec declared `readOnly: true`.
     */
    isReadOnly(): boolean {
        return this._readOnly;
    }

    /**
     * Returns the registry glyph name shown to the left of this column's header text.
     *
     * @returns The glyph registry name, or `null` if no header glyph is set.
     */
    getHeaderGlyph(): string | null {
        return this._headerGlyph;
    }

    /**
     * Returns the configured header-label override for this column.
     *
     * @returns The override text, or `null` when unset (the header falls back to
     *   the field name).
     */
    getHeaderText(): string | null {
        return this._headerText;
    }

    /**
     * Sets the registry glyph name shown to the left of this column's header text.
     *
     * Pass `null` (or call {@link Column.clearHeaderGlyph}) to remove the glyph.
     *
     * @param name - A registered glyph name, or `null` to remove.
     * @returns This column, for method chaining.
     */
    setHeaderGlyph(name: string | null): this {
        this._headerGlyph = name;

        return this;
    }

    /**
     * Clears the header glyph for this column. Equivalent to `setHeaderGlyph(null)`.
     *
     * @returns This column, for method chaining.
     */
    clearHeaderGlyph(): this {
        return this.setHeaderGlyph(null);
    }

    /**
     * Returns the parent-header group name this column belongs to, fixed at
     * construction. Columns sharing a group name and appearing contiguously
     * render under a single spanning {@link ParentHeaderCell}.
     *
     * @returns The group name, or `null` when the column is ungrouped.
     */
    getGroup(): string | null {
        return this._group;
    }

    /**
     * Returns the optional background color advertised by this column's
     * `ColumnConfig.groupColor`. The first non-null value in a contiguous
     * group run wins; later mismatched values are ignored.
     *
     * @returns The CSS color string, or `null` when none was declared.
     */
    getGroupColor(): string | null {
        return this._groupColor;
    }

    /**
     * Returns whether this column is marked required in the spec. Drives
     * the header asterisk; the per-record `requiredPredicate` composes
     * with this flag for the empty-cell tint but does not affect this
     * accessor.
     *
     * @returns `true` when the spec declared `required: true`.
     */
    isRequired(): boolean {
        return this._required;
    }

    /**
     * Resolves a {@link ColumnSpec} against a set of model fields into an ordered
     * array of {@link Column} instances.
     *
     * When no spec is provided every field becomes a default Column, preserving
     * existing table behaviour exactly.
     *
     * When a spec is provided:
     * - Fields listed in `spec.columns` receive their declared constraints.
     * - Fields not listed are appended as default Columns when `appendUnlisted`
     *   is `true` (the default), or omitted entirely when it is `false`.
     *
     * The returned array is sorted by {@link Field.getOrder} so that the column
     * sequence matches the order used by the header and body renderers.
     *
     * @param fields - All fields returned by the model.
     * @param spec   - Optional column spec; omit to auto-generate from all fields.
     *
     * @returns Resolved Column instances in display order.
     */
    static resolve(fields: Field[], spec?: ColumnSpec): Column[] {
        const sorted = fields.slice().sort((a, b) => a.getOrder() - b.getOrder());

        if (!spec) {
            return sorted.map(f => new Column(f));
        }

        const configMap   = new Map(spec.columns.map(c => [c.field, c]));
        const listedNames = new Set(spec.columns.map(c => c.field));

        if (spec.appendUnlisted === false) {
            return sorted
                .filter(f => listedNames.has(f.getName()))
                .map(f => new Column(f, configMap.get(f.getName())));
        }

        // All fields in field order; apply config where one exists.
        // This keeps Column order in sync with the header, which also sorts by field.getOrder().
        return sorted.map(f => new Column(f, configMap.get(f.getName())));
    }
}
