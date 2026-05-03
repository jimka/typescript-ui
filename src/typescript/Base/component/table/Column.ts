// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Field } from "../../data/Field.js";
import { ColumnConfig, ColumnSpec } from "./ColumnConfig.js";

/**
 * Resolved presentation descriptor for a single table column.
 *
 * Created internally by {@link Column.resolve} — not constructed directly by
 * application code. Wraps a {@link Field} and carries optional width constraints
 * and an initial visibility flag derived from a {@link ColumnSpec}.
 */
export class Column {

    private field    : Field;
    private minWidth : number | undefined;
    private maxWidth : number | undefined;
    private hidden   : boolean;

    /**
     * Constructs a Column from a field and an optional presentation config.
     *
     * @param field  - The model field this column represents.
     * @param config - Optional config; all constraint properties default to absent / false.
     */
    constructor(field: Field, config?: ColumnConfig) {
        this.field    = field;
        this.minWidth = config?.minWidth;
        this.maxWidth = config?.maxWidth;
        this.hidden   = config?.hidden ?? false;
    }

    /**
     * Returns the model field this column represents.
     *
     * @returns The underlying {@link Field}.
     */
    getField(): Field {
        return this.field;
    }

    /**
     * Returns the minimum column width in pixels declared in the spec.
     *
     * @returns The minimum width, or `undefined` if unconstrained.
     */
    getMinWidth(): number | undefined {
        return this.minWidth;
    }

    /**
     * Returns the maximum column width in pixels declared in the spec.
     *
     * @returns The maximum width, or `undefined` if unconstrained.
     */
    getMaxWidth(): number | undefined {
        return this.maxWidth;
    }

    /**
     * Returns whether this column starts hidden according to the spec.
     *
     * @returns `true` if the spec declared `hidden: true` for this column.
     */
    isInitiallyHidden(): boolean {
        return this.hidden;
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
