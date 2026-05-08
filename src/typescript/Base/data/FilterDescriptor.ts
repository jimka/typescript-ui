// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Serializable filter algebra for AbstractStore. Descriptors are plain objects so
 * they can cross the worker boundary via structured clone (unlike arbitrary filter
 * functions, which can't). The same evaluator runs on either side.
 */
export type FilterDescriptor =
    | { type: 'eq';         field: string; value: any }
    | { type: 'neq';        field: string; value: any }
    | { type: 'contains';   field: string; value: string; caseSensitive?: boolean }
    | { type: 'startsWith'; field: string; value: string; caseSensitive?: boolean }
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

/**
 * Evaluates a FilterDescriptor against a record. Returns true if the record
 * matches the filter. Works with both plain data objects (worker side) and
 * ModelRecord instances (main thread side).
 */
export function matchesFilter(record: any, descriptor: FilterDescriptor): boolean {
    switch (descriptor.type) {
        case 'eq':
            return readField(record, descriptor.field) === descriptor.value;

        case 'neq':
            return readField(record, descriptor.field) !== descriptor.value;

        case 'contains': {
            const raw = readField(record, descriptor.field);
            if (raw == null) return false;
            const haystack = descriptor.caseSensitive ? String(raw) : String(raw).toLowerCase();
            const needle   = descriptor.caseSensitive ? descriptor.value : descriptor.value.toLowerCase();
            return haystack.indexOf(needle) !== -1;
        }

        case 'startsWith': {
            const raw = readField(record, descriptor.field);
            if (raw == null) return false;
            const haystack = descriptor.caseSensitive ? String(raw) : String(raw).toLowerCase();
            const needle   = descriptor.caseSensitive ? descriptor.value : descriptor.value.toLowerCase();
            return haystack.indexOf(needle) === 0;
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
