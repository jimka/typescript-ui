import { describe, it, expect } from 'vitest';
import { matchesFilter } from '~/data/FilterDescriptor';

// A minimal ModelRecord-like stub: the contract is that any object exposing a
// `get(field)` method works, so no real ModelRecord import is needed.
const asGetter = (data: Record<string, any>) => ({ get: (f: string) => data[f] });

describe('matchesFilter', () => {
    // --- dual record access (plain object vs. get-bearing object) ---
    it('reads a field from a plain data object', () => {
        expect(matchesFilter({ name: 'Bob' }, { type: 'eq', field: 'name', value: 'Bob' })).toBe(true);
    });
    it('reads a field from a get(field)-bearing object', () => {
        expect(matchesFilter(asGetter({ name: 'Bob' }), { type: 'eq', field: 'name', value: 'Bob' })).toBe(true);
    });

    // --- eq / neq (strict, no coercion) ---
    it('eq matches by strict equality, with no type coercion', () => {
        expect(matchesFilter({ id: 1 }, { type: 'eq', field: 'id', value: 1 })).toBe(true);
        expect(matchesFilter({ id: 1 }, { type: 'eq', field: 'id', value: '1' })).toBe(false);
    });
    it('neq is the strict inverse of eq', () => {
        expect(matchesFilter({ id: 1 }, { type: 'neq', field: 'id', value: 2 })).toBe(true);
        expect(matchesFilter({ id: 1 }, { type: 'neq', field: 'id', value: 1 })).toBe(false);
        expect(matchesFilter({ id: 1 }, { type: 'neq', field: 'id', value: '1' })).toBe(true);
    });

    // --- contains ---
    it('contains is a case-insensitive substring match by default', () => {
        expect(matchesFilter({ name: 'Bob' }, { type: 'contains', field: 'name', value: 'OB' })).toBe(true);
        expect(matchesFilter({ name: 'Bob' }, { type: 'contains', field: 'name', value: 'xy' })).toBe(false);
    });
    it('contains honours caseSensitive: true', () => {
        expect(matchesFilter({ name: 'Bob' }, { type: 'contains', field: 'name', value: 'OB', caseSensitive: true })).toBe(false);
        expect(matchesFilter({ name: 'Bob' }, { type: 'contains', field: 'name', value: 'ob', caseSensitive: true })).toBe(true);
    });
    it('contains returns false (never throws) on a nullish field', () => {
        expect(matchesFilter({ name: null }, { type: 'contains', field: 'name', value: 'a' })).toBe(false);
        expect(matchesFilter({}, { type: 'contains', field: 'name', value: 'a' })).toBe(false);
    });
    it('contains String()-coerces a non-string raw value', () => {
        expect(matchesFilter({ n: 123 }, { type: 'contains', field: 'n', value: '2' })).toBe(true);
    });

    // --- startsWith ---
    it('startsWith anchors the (case-insensitive) match at index 0', () => {
        expect(matchesFilter({ name: 'Bob' }, { type: 'startsWith', field: 'name', value: 'Bo' })).toBe(true);
        expect(matchesFilter({ name: 'Bob' }, { type: 'startsWith', field: 'name', value: 'ob' })).toBe(false);
    });
    it('startsWith returns false on a nullish field', () => {
        expect(matchesFilter({}, { type: 'startsWith', field: 'name', value: 'B' })).toBe(false);
    });

    // --- relational gt / gte / lt / lte ---
    it('gt / gte respect the boundary at equality', () => {
        expect(matchesFilter({ v: 6 }, { type: 'gt', field: 'v', value: 5 })).toBe(true);
        expect(matchesFilter({ v: 5 }, { type: 'gt', field: 'v', value: 5 })).toBe(false);
        expect(matchesFilter({ v: 5 }, { type: 'gte', field: 'v', value: 5 })).toBe(true);
    });
    it('lt / lte respect the boundary at equality', () => {
        expect(matchesFilter({ v: 4 }, { type: 'lt', field: 'v', value: 5 })).toBe(true);
        expect(matchesFilter({ v: 5 }, { type: 'lt', field: 'v', value: 5 })).toBe(false);
        expect(matchesFilter({ v: 5 }, { type: 'lte', field: 'v', value: 5 })).toBe(true);
    });
    it('relational ops compare strings lexically and Dates by valueOf', () => {
        expect(matchesFilter({ v: 'b' }, { type: 'gt', field: 'v', value: 'a' })).toBe(true);
        expect(matchesFilter({ v: new Date(2000) }, { type: 'gt', field: 'v', value: new Date(1000) })).toBe(true);
    });
    // DIVERGENCE (surface-it, low concern): an undefined field value makes every
    // relational op false, because `undefined > x`, `undefined < x`, etc. are all
    // false in JS. Read as a contract this is reasonable — a missing field should
    // not satisfy a relational predicate — so it is pinned as the EXPECTED
    // behaviour, not a failure. Flagged only because it is asymmetric: a record
    // missing the field is excluded by BOTH `gt` and `lt` of the same value,
    // which can surprise a caller expecting a partition. No code change implied.
    it('treats a missing field as failing every relational op (no partition)', () => {
        expect(matchesFilter({}, { type: 'gt', field: 'v', value: 5 })).toBe(false);
        expect(matchesFilter({}, { type: 'lt', field: 'v', value: 5 })).toBe(false);
        expect(matchesFilter({}, { type: 'gte', field: 'v', value: 5 })).toBe(false);
        expect(matchesFilter({}, { type: 'lte', field: 'v', value: 5 })).toBe(false);
    });

    // --- in (strict membership) ---
    it('in matches by strict equality over the values array', () => {
        expect(matchesFilter({ id: 1 }, { type: 'in', field: 'id', values: [1, 2] })).toBe(true);
        expect(matchesFilter({ id: 3 }, { type: 'in', field: 'id', values: [1, 2] })).toBe(false);
        expect(matchesFilter({ id: '1' }, { type: 'in', field: 'id', values: [1, 2] })).toBe(false);
    });

    // --- and / or / not (with vacuous-truth edges and recursion) ---
    it('and requires every sub-filter to match', () => {
        const rec = { a: 1, b: 2 };
        expect(matchesFilter(rec, { type: 'and', filters: [
            { type: 'eq', field: 'a', value: 1 },
            { type: 'eq', field: 'b', value: 2 },
        ] })).toBe(true);
        expect(matchesFilter(rec, { type: 'and', filters: [
            { type: 'eq', field: 'a', value: 1 },
            { type: 'eq', field: 'b', value: 99 },
        ] })).toBe(false);
    });
    it('and over an empty filter list is vacuously true', () => {
        expect(matchesFilter({}, { type: 'and', filters: [] })).toBe(true);
    });
    it('or requires at least one sub-filter to match', () => {
        const rec = { a: 1 };
        expect(matchesFilter(rec, { type: 'or', filters: [
            { type: 'eq', field: 'a', value: 99 },
            { type: 'eq', field: 'a', value: 1 },
        ] })).toBe(true);
        expect(matchesFilter(rec, { type: 'or', filters: [
            { type: 'eq', field: 'a', value: 98 },
            { type: 'eq', field: 'a', value: 99 },
        ] })).toBe(false);
    });
    it('or over an empty filter list is vacuously false', () => {
        expect(matchesFilter({}, { type: 'or', filters: [] })).toBe(false);
    });
    it('not is the boolean inverse of its child', () => {
        expect(matchesFilter({ a: 1 }, { type: 'not', filter: { type: 'eq', field: 'a', value: 2 } })).toBe(true);
        expect(matchesFilter({ a: 1 }, { type: 'not', filter: { type: 'eq', field: 'a', value: 1 } })).toBe(false);
    });
    it('recurses through nested combinators', () => {
        expect(matchesFilter({ a: 1, b: 2 }, { type: 'and', filters: [
            { type: 'eq', field: 'a', value: 1 },
            { type: 'not', filter: { type: 'eq', field: 'b', value: 99 } },
        ] })).toBe(true);
    });
});
