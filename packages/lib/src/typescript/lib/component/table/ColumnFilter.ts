// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { FieldType } from "~/data/Field.js";
import type { FilterDescriptor } from "~/data/FilterDescriptor.js";

/**
 * The comparison a column's filter cell can offer. Which subset applies to a
 * given column is decided by {@link columnFilterOperators}, keyed on the
 * column's {@link FieldType}.
 *
 * @category Components
 */
export type ColumnFilterOperator =
    | 'contains' | 'startsWith' | 'endsWith'
    | 'eq' | 'neq'
    | 'gt' | 'gte' | 'lt' | 'lte'
    | 'isEmpty' | 'isNotEmpty';

/**
 * The operator plus raw text a filter cell currently holds, before it is
 * turned into a {@link FilterDescriptor} by {@link buildColumnFilter}.
 *
 * @category Components
 */
export interface ColumnFilterState {
    /** The comparison currently selected for this column. */
    operator: ColumnFilterOperator;
    /** The raw text typed into the filter input; ignored by `isEmpty` / `isNotEmpty`. */
    text:     string;
}

/** Operators offered for a `string` / `auto` / `glyph` column, in menu order. */
const STRING_OPERATORS: ColumnFilterOperator[] =
    ['contains', 'startsWith', 'endsWith', 'eq', 'neq', 'isEmpty', 'isNotEmpty'];

/** Operators offered for a `number` / `date` / `time` / `datetime` column, in menu order. */
const ORDERED_OPERATORS: ColumnFilterOperator[] =
    ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'isNotEmpty'];

/** Operators offered for a `boolean` column, in menu order. */
const BOOLEAN_OPERATORS: ColumnFilterOperator[] = ['eq', 'neq', 'isEmpty', 'isNotEmpty'];

/** Menu label shown for each operator. */
const OPERATOR_LABELS: Record<ColumnFilterOperator, string> = {
    contains:    'Contains',
    startsWith:  'Starts with',
    endsWith:    'Ends with',
    eq:          'Equals',
    neq:         'Not equals',
    gt:          'Greater than',
    gte:         'At least',
    lt:          'Less than',
    lte:         'At most',
    isEmpty:     'Is empty',
    isNotEmpty:  'Is not empty',
};

/**
 * Registry glyph name shown on the operator button's face — see
 * `packages/lib/src/typescript/lib/glyphs/solid/` for each icon's source.
 */
const OPERATOR_GLYPHS: Record<ColumnFilterOperator, string> = {
    contains:   'magnifying-glass',
    startsWith: 'align-left',
    endsWith:   'align-right',
    eq:         'equals',
    neq:        'not-equal',
    gt:         'greater-than',
    gte:        'greater-than-equal',
    lt:         'less-than',
    lte:        'less-than-equal',
    isEmpty:    'ban',
    isNotEmpty: 'circle-check',
};

/**
 * Returns the operators offered for a field type, in menu order. The first
 * entry is that type's default operator.
 *
 * @param type - The column's field type.
 * @returns The operators to offer, in display order.
 */
export function columnFilterOperators(type: FieldType): ColumnFilterOperator[] {
    switch (type) {
        case 'string':
        case 'auto':
        case 'glyph':
            return STRING_OPERATORS;

        case 'boolean':
            return BOOLEAN_OPERATORS;

        case 'number':
        case 'date':
        case 'time':
        case 'datetime':
            return ORDERED_OPERATORS;
    }
}

/**
 * Returns the menu label for an operator, e.g. `'Starts with'`.
 *
 * @param operator - The operator to label.
 * @returns The display label.
 */
export function columnFilterOperatorLabel(operator: ColumnFilterOperator): string {
    return OPERATOR_LABELS[operator];
}

/**
 * Returns the registry glyph name shown on the operator button's face, e.g.
 * `'align-left'` for `startsWith`.
 *
 * @param operator - The operator to represent.
 * @returns The button-face glyph name.
 */
export function columnFilterOperatorGlyph(operator: ColumnFilterOperator): string {
    return OPERATOR_GLYPHS[operator];
}

/**
 * Returns whether an operator reads the text input. `false` for `isEmpty` /
 * `isNotEmpty`, which apply unconditionally and ignore any typed text.
 *
 * @param operator - The operator to check.
 * @returns `true` for every operator except `isEmpty` / `isNotEmpty`.
 */
export function columnFilterTakesOperand(operator: ColumnFilterOperator): boolean {
    return operator !== 'isEmpty' && operator !== 'isNotEmpty';
}

/**
 * Parses `text` into the operand type `type` expects for a relational or
 * equality comparison.
 *
 * @param type - The column's field type.
 * @param text - The raw text typed into the filter input.
 * @returns The parsed operand, or `null` when `text` does not parse to `type`.
 */
function parseOperand(type: FieldType, text: string): string | number | boolean | Date | null {
    switch (type) {
        case 'number': {
            const n = Number(text);

            return Number.isNaN(n) ? null : n;
        }

        case 'boolean': {
            const lower = text.toLowerCase();

            if (['true', '1', 'yes'].includes(lower))  return true;
            if (['false', '0', 'no'].includes(lower))  return false;

            return null;
        }

        case 'date':
        case 'time':
        case 'datetime': {
            const d = new Date(text);

            return Number.isNaN(d.getTime()) ? null : d;
        }

        case 'string':
        case 'auto':
        case 'glyph':
        default:
            return text;
    }
}

/**
 * Builds the {@link FilterDescriptor} for one column's current filter state,
 * or `null` when the state produces no filter — blank text on an operator
 * that takes an operand, or text that fails to parse to `type` (so a
 * half-typed number never blanks the table).
 *
 * `isEmpty` / `isNotEmpty` ignore `state.text` entirely and reuse the
 * existing `in` / `not` descriptor algebra rather than becoming new
 * descriptor variants.
 *
 * @param field - The model field name this filter targets.
 * @param type - The field's declared type, used to parse `state.text`.
 * @param state - The column's current operator + text.
 * @returns The built descriptor, or `null` when the state produces no filter.
 */
export function buildColumnFilter(field: string, type: FieldType, state: ColumnFilterState): FilterDescriptor | null {
    const { operator, text } = state;

    if (operator === 'isEmpty') {
        return { type: 'in', field, values: [null, undefined, ''] };
    }

    if (operator === 'isNotEmpty') {
        return { type: 'not', filter: { type: 'in', field, values: [null, undefined, ''] } };
    }

    if (text === '') {
        return null;
    }

    if (operator === 'contains' || operator === 'startsWith' || operator === 'endsWith') {
        return { type: operator, field, value: text };
    }

    const value = parseOperand(type, text);

    if (value === null) {
        return null;
    }

    // gt/gte/lt/lte never see a boolean operand in practice — no field type
    // offers both an ordering operator and 'boolean' parsing — but the
    // parsed union includes it, so a targeted cast closes the gap `switch`
    // narrowing can't for a shared local.
    const ordered = value as number | string | Date;

    switch (operator) {
        case 'eq':  return { type: 'eq',  field, value };
        case 'neq': return { type: 'neq', field, value };
        case 'gt':  return { type: 'gt',  field, value: ordered };
        case 'gte': return { type: 'gte', field, value: ordered };
        case 'lt':  return { type: 'lt',  field, value: ordered };
        case 'lte': return { type: 'lte', field, value: ordered };
    }
}
