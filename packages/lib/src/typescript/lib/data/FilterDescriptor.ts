// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { TemporalFieldType } from "~/data/temporalText.js";
import { temporalDisplayText } from "~/data/temporalText.js";

/**
 * How a substring operator renders a `Date`-valued field before matching.
 * Absent means "match the raw value", which is the behaviour every descriptor
 * built before this member existed still gets.
 *
 * @category Data
 */
export interface TemporalDisplay {
    type:        TemporalFieldType;
    showSeconds: boolean;
}

/**
 * Serializable filter algebra for {@link AbstractStore}. Descriptors are plain objects so
 * they can cross the worker boundary via structured clone (unlike arbitrary filter
 * functions, which can't). The same evaluator runs on either side.
 *
 * `eq` / `neq` compare two `Date` operands by instant (`getTime()`) rather than by
 * reference, since two distinct `Date` instances for the same moment are never `===`.
 *
 * A `contains` / `startsWith` / `endsWith` descriptor over a `Date`-valued field renders
 * the field through its optional `temporal` hint before matching, so the operator agrees
 * with what the cell displays; when the hint is absent, or the field's value is not a
 * `Date`, the raw value is matched unchanged, exactly as every descriptor built before
 * this member existed.
 *
 * @category Data
 */
export type FilterDescriptor =
    | { type: 'eq';         field: string; value: any }
    | { type: 'neq';        field: string; value: any }
    | { type: 'contains';   field: string; value: string; caseSensitive?: boolean; temporal?: TemporalDisplay }
    | { type: 'startsWith'; field: string; value: string; caseSensitive?: boolean; temporal?: TemporalDisplay }
    | { type: 'endsWith';   field: string; value: string; caseSensitive?: boolean; temporal?: TemporalDisplay }
    | { type: 'gt';         field: string; value: number | string | Date }
    | { type: 'gte';        field: string; value: number | string | Date }
    | { type: 'lt';         field: string; value: number | string | Date }
    | { type: 'lte';        field: string; value: number | string | Date }
    | { type: 'in';         field: string; values: any[] }
    | { type: 'and';        filters: FilterDescriptor[] }
    | { type: 'or';         filters: FilterDescriptor[] }
    | { type: 'not';        filter:  FilterDescriptor };

/**
 * Looks up a field's value from either a plain data object or a ModelRecord-like
 * object that exposes a `get(field)` method. Lets the same matcher run on both
 * sides of the worker boundary.
 */
function readField(record: any, field: string): any {
    if (record && typeof record.get === 'function') {
        return record.get(field);
    }
    return record ? record[field] : undefined;
}

/** The three descriptor members a substring operator can appear as. */
type SubstringDescriptor = Extract<FilterDescriptor, { type: 'contains' | 'startsWith' | 'endsWith' }>;

/**
 * The haystack/needle pair a substring operator compares, or `null` when the
 * field is nullish and no match is possible. A `Date` field is rendered
 * through `descriptor.temporal` when that hint is present; every other value
 * keeps the plain `String(raw)` coercion.
 */
function substringOperands(record: any, descriptor: SubstringDescriptor): { haystack: string; needle: string } | null {
    const raw = readField(record, descriptor.field);

    if (raw == null) {
        return null;
    }

    const text = raw instanceof Date && descriptor.temporal
        ? temporalDisplayText(descriptor.temporal.type, descriptor.temporal.showSeconds, raw)
        : String(raw);

    return descriptor.caseSensitive
        ? { haystack: text,               needle: descriptor.value }
        : { haystack: text.toLowerCase(), needle: descriptor.value.toLowerCase() };
}

/**
 * Evaluates a FilterDescriptor against a record. Returns true if the record
 * matches the filter. Works with both plain data objects (worker side) and
 * ModelRecord instances (main thread side).
 */
export function matchesFilter(record: any, descriptor: FilterDescriptor): boolean {
    switch (descriptor.type) {
        case 'eq': {
            const raw = readField(record, descriptor.field);

            if (raw instanceof Date && descriptor.value instanceof Date) {
                return raw.getTime() === descriptor.value.getTime();
            }

            return raw === descriptor.value;
        }

        case 'neq': {
            const raw = readField(record, descriptor.field);

            if (raw instanceof Date && descriptor.value instanceof Date) {
                return raw.getTime() !== descriptor.value.getTime();
            }

            return raw !== descriptor.value;
        }

        case 'contains': {
            const operands = substringOperands(record, descriptor);

            return operands !== null && operands.haystack.indexOf(operands.needle) !== -1;
        }

        case 'startsWith': {
            const operands = substringOperands(record, descriptor);

            return operands !== null && operands.haystack.indexOf(operands.needle) === 0;
        }

        case 'endsWith': {
            const operands = substringOperands(record, descriptor);

            return operands !== null
                && operands.haystack.lastIndexOf(operands.needle) === operands.haystack.length - operands.needle.length;
        }

        case 'gt':
            return readField(record, descriptor.field) > descriptor.value;

        case 'gte':
            return readField(record, descriptor.field) >= descriptor.value;

        case 'lt':
            return readField(record, descriptor.field) < descriptor.value;

        case 'lte':
            return readField(record, descriptor.field) <= descriptor.value;

        case 'in':
            return descriptor.values.indexOf(readField(record, descriptor.field)) !== -1;

        case 'and':
            for (const f of descriptor.filters) {
                if (!matchesFilter(record, f)) return false;
            }
            return true;

        case 'or':
            for (const f of descriptor.filters) {
                if (matchesFilter(record, f)) return true;
            }
            return false;

        case 'not':
            return !matchesFilter(record, descriptor.filter);
    }
}
