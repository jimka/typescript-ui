// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { FieldType } from '~/data/Field.js';

/**
 * Native ordering of two non-null values via `<` / `>`, returning the
 * ascending-sense sign. Used for numeric (and any non-string, non-date) fields.
 *
 * @param av - The left operand.
 * @param bv - The right operand.
 *
 * @returns A negative, zero, or positive number in ascending sense.
 */
function nativeCompare(av: any, bv: any): number {
    return av < bv ? -1 : av > bv ? 1 : 0;
}

/**
 * Type-aware, locale-aware comparison of two raw field values, returning a
 * negative / zero / positive number in **ascending** sense. This is the single
 * comparator shared by the main thread ({@link AbstractStore}) and the
 * `StoreWorker`, so the two sort paths can never drift.
 *
 * @param av - The left value.
 * @param bv - The right value.
 * @param type - Optional. The field's {@link FieldType}, which selects the
 *   comparison strategy (string → locale, date/time → timestamp, else native).
 *   When omitted, two string operands still use the locale path.
 *
 * @returns The ascending-sense comparison result.
 *
 * @remarks
 * `null`/`undefined` sort **last**: both null compare equal (`0`), and a single
 * null returns the sign that places it after a non-null value. Callers must
 * leave a null-involving result un-negated (apply sort direction only to a
 * non-null comparison) so nulls stay last regardless of `'asc'`/`'desc'`.
 *
 * String fields (or two string operands when `type` is unknown) use
 * `localeCompare`, so `'Ä'` orders between `'a'` and `'Z'` rather than after
 * `'Z'` by code point. Date/time fields compare by `getTime()` when both
 * operands are `Date`, falling through to native comparison otherwise.
 *
 * @category Data
 */
export function compareValues(av: any, bv: any, type?: FieldType): number {
    if (av == null && bv == null) {
        return 0;
    }

    if (av == null) {
        return 1;
    }

    if (bv == null) {
        return -1;
    }

    if (type === 'string' || (type === undefined && typeof av === 'string' && typeof bv === 'string')) {
        return av.localeCompare(bv);
    }

    if (type === 'date' || type === 'datetime' || type === 'time') {
        if (av instanceof Date && bv instanceof Date) {
            return nativeCompare(av.getTime(), bv.getTime());
        }
    }

    return nativeCompare(av, bv);
}
