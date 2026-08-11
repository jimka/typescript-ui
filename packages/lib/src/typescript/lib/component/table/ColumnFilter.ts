// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { FieldType } from "~/data/Field.js";
import type { FilterDescriptor } from "~/data/FilterDescriptor.js";
import { normalizeComboOptions } from "~/component/table/ColumnConfig.js";
import type { ComboOption } from "~/component/table/ColumnConfig.js";
import type { CellTextResolver } from "~/component/table/cell/CellText.js";

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

/**
 * What a column contributes to its own filter build — the field-type switch
 * {@link buildColumnFilter} parses `state.text` against, plus the two extra
 * signals a combo or temporal column resolves display text with.
 *
 * @category Components
 */
export interface ColumnFilterTarget {
    /** The field's declared type. */
    type:          FieldType;
    /** The column's declared combo options, when it renders as a combo cell. */
    values      ?: Array<ComboOption | string>;
    /** Whether a `time`/`datetime` column's renderer includes seconds. */
    showSeconds ?: boolean;
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
 * Parses `text` as a time of day — `HH:MM[:SS]` with an optional trailing
 * `AM`/`PM` — anchored to 1970-01-01 local, mirroring the normalisation
 * [`TimeEditor`](/api/component/table/classes/TimeEditor) commits and
 * documents.
 *
 * @param text - The raw text to parse.
 * @returns The anchored `Date`, or `null` when `text` does not match the
 *   `HH:MM[:SS] [AM|PM]` shape.
 */
function parseTimeOfDay(text: string): Date | null {
    const match = text.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);

    if (!match) {
        return null;
    }

    let   hours    = Number(match[1]);
    const minutes  = Number(match[2]);
    const seconds  = match[3] ? Number(match[3]) : 0;
    const meridiem = match[4]?.toLowerCase();

    if (minutes > 59 || seconds > 59) {
        return null;
    }

    if (meridiem) {
        if (hours < 1 || hours > 12) {
            return null;
        }

        hours = meridiem === 'am' ? (hours === 12 ? 0 : hours) : (hours === 12 ? 12 : hours + 12);
    } else if (hours > 23) {
        return null;
    }

    return new Date(1970, 0, 1, hours, minutes, seconds);
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

        case 'time': {
            const anchored = parseTimeOfDay(text);

            if (anchored) {
                return anchored;
            }

            const d = new Date(text);

            return Number.isNaN(d.getTime()) ? null : d;
        }

        case 'date':
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
 * The half-open `[lo, hi)` span of instants a column of this shape renders
 * identically — a `date` cell hides the time of day, and a `time`/`datetime`
 * cell without `showSeconds` hides the seconds. Calendar arithmetic (never
 * `+ 86_400_000`), so the `date` case survives a DST boundary.
 *
 * @param type - The temporal field type.
 * @param showSeconds - Whether the matching renderer includes seconds.
 * @param operand - The parsed operand equality is being built around.
 * @returns The inclusive lower bound and exclusive upper bound of the span.
 */
function displayBucket(type: 'date' | 'time' | 'datetime', showSeconds: boolean, operand: Date): { lo: Date; hi: Date } {
    if (type === 'date') {
        const lo = new Date(operand.getFullYear(), operand.getMonth(), operand.getDate());
        const hi = new Date(operand.getFullYear(), operand.getMonth(), operand.getDate() + 1);

        return { lo, hi };
    }

    const lo = new Date(operand.getFullYear(), operand.getMonth(), operand.getDate(),
                        operand.getHours(), operand.getMinutes(), showSeconds ? operand.getSeconds() : 0);
    const hi = new Date(lo.getTime() + (showSeconds ? 1_000 : 60_000));

    return { lo, hi };
}

/**
 * Resolves a combo column's `contains` / `startsWith` / `endsWith` / `eq` /
 * `neq` filter: runs every declared option through `display`, keeps the
 * ones whose rendered label matches `text`, and emits the matching raw
 * values as an `in` set (`neq` wraps it in `not`). Substring operators are
 * case-insensitive; `eq` / `neq` are exact — the same case rule the data
 * layer's own `contains` / `eq` evaluation follows.
 *
 * @param field - The model field name this filter targets.
 * @param values - The column's declared combo options.
 * @param operator - The selected operator.
 * @param text - The raw typed text.
 * @param display - Resolver used to render each option's label.
 * @returns The built `in` / `not`-`in` descriptor. Zero matches still
 *   returns `in []` (matches no row), never `null`.
 */
function buildComboFilter(
    field:    string,
    values:   Array<ComboOption | string>,
    operator: 'contains' | 'startsWith' | 'endsWith' | 'eq' | 'neq',
    text:     string,
    display:  CellTextResolver,
): FilterDescriptor {
    const substring = operator === 'contains' || operator === 'startsWith' || operator === 'endsWith';
    const needle    = substring ? text.toLowerCase() : text;

    const matches = normalizeComboOptions(values).filter(option => {
        const label     = display.text('combo', false, values, option.value);
        const haystack  = substring ? label.toLowerCase() : label;

        switch (operator) {
            case 'contains':   return haystack.includes(needle);
            case 'startsWith': return haystack.startsWith(needle);
            case 'endsWith':   return haystack.endsWith(needle);
            case 'eq':
            case 'neq':        return haystack === needle;
        }
    }).map(option => option.value);

    const inDescriptor: FilterDescriptor = { type: 'in', field, values: matches };

    return operator === 'neq' ? { type: 'not', filter: inDescriptor } : inDescriptor;
}

/**
 * Builds the {@link FilterDescriptor} for one column's current filter state,
 * or `null` when the state produces no filter — blank text on an operator
 * that takes an operand, or text that fails to parse to `target.type` (so a
 * half-typed number never blanks the table).
 *
 * `isEmpty` / `isNotEmpty` ignore `state.text` entirely and reuse the
 * existing `in` / `not` descriptor algebra rather than becoming new
 * descriptor variants. A combo column (`target.values` non-empty) resolves
 * `contains` / `startsWith` / `endsWith` / `eq` / `neq` against its option
 * **labels** instead of the stored value, emitting the matching raw values as
 * an `in` set (`neq` wraps it in `not`). A `date` / `time` / `datetime`
 * column's `eq` / `neq` matches every instant that **displays** the same as
 * the typed text, not the exact instant — built as the half-open range of
 * instants that renders identically (`and(gte, lt)`, `neq` wraps it in
 * `not`). Every other operator keeps comparing a parsed operand against the
 * raw stored value.
 *
 * @param field - The model field name this filter targets.
 * @param target - The column's type plus its `values` / `showSeconds`.
 * @param state - The column's current operator + text.
 * @param display - Resolver used to render a combo option's label or a
 *   temporal value's displayed text.
 * @returns The built descriptor, or `null` when the state produces no filter.
 */
export function buildColumnFilter(
    field:   string,
    target:  ColumnFilterTarget,
    state:   ColumnFilterState,
    display: CellTextResolver,
): FilterDescriptor | null {
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

    if (target.values && target.values.length > 0
        && (operator === 'contains' || operator === 'startsWith' || operator === 'endsWith'
         || operator === 'eq' || operator === 'neq')) {
        return buildComboFilter(field, target.values, operator, text, display);
    }

    if ((target.type === 'date' || target.type === 'time' || target.type === 'datetime')
        && (operator === 'eq' || operator === 'neq')) {
        const operand = parseOperand(target.type, text);

        if (operand === null || !(operand instanceof Date)) {
            return null;
        }

        const { lo, hi } = displayBucket(target.type, target.showSeconds ?? false, operand);
        const andDescriptor: FilterDescriptor = {
            type:    'and',
            filters: [{ type: 'gte', field, value: lo }, { type: 'lt', field, value: hi }],
        };

        return operator === 'neq' ? { type: 'not', filter: andDescriptor } : andDescriptor;
    }

    if (operator === 'contains' || operator === 'startsWith' || operator === 'endsWith') {
        return { type: operator, field, value: text };
    }

    const value = parseOperand(target.type, text);

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
