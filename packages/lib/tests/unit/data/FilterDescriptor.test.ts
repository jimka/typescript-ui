import { describe, it, expect } from 'vitest';
import { matchesFilter } from '~/data/FilterDescriptor';
import type { FilterDescriptor } from '~/data/FilterDescriptor';
import { temporalDisplayText } from '~/data/temporalText';
import type { TemporalFieldType } from '~/data/temporalText';

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
    it('eq compares two Date operands by instant, not by reference', () => {
        expect(matchesFilter({ due: new Date('2024-01-15T00:00:00Z') },
            { type: 'eq', field: 'due', value: new Date('2024-01-15T00:00:00Z') })).toBe(true);
        expect(matchesFilter({ due: new Date('2024-01-16T00:00:00Z') },
            { type: 'eq', field: 'due', value: new Date('2024-01-15T00:00:00Z') })).toBe(false);
    });
    it('neq is the exact inverse of eq for Date operands', () => {
        expect(matchesFilter({ due: new Date('2024-01-15T00:00:00Z') },
            { type: 'neq', field: 'due', value: new Date('2024-01-15T00:00:00Z') })).toBe(false);
        expect(matchesFilter({ due: new Date('2024-01-16T00:00:00Z') },
            { type: 'neq', field: 'due', value: new Date('2024-01-15T00:00:00Z') })).toBe(true);
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

    // --- endsWith ---
    it('endsWith anchors the (case-insensitive) match at the end', () => {
        expect(matchesFilter({ name: 'Bob' }, { type: 'endsWith', field: 'name', value: 'ob' })).toBe(true);
        expect(matchesFilter({ name: 'BOB' }, { type: 'endsWith', field: 'name', value: 'ob' })).toBe(true);
        expect(matchesFilter({ name: 'Bobby' }, { type: 'endsWith', field: 'name', value: 'ob' })).toBe(false);
    });
    it('endsWith honours caseSensitive: true', () => {
        expect(matchesFilter({ name: 'Bob' }, { type: 'endsWith', field: 'name', value: 'ob', caseSensitive: true })).toBe(true);
        expect(matchesFilter({ name: 'BOB' }, { type: 'endsWith', field: 'name', value: 'ob', caseSensitive: true })).toBe(false);
    });
    it('endsWith returns false (never throws) on a nullish field', () => {
        expect(matchesFilter({ name: null }, { type: 'endsWith', field: 'name', value: 'a' })).toBe(false);
        expect(matchesFilter({}, { type: 'endsWith', field: 'name', value: 'a' })).toBe(false);
    });

    // --- substring operators over a Date field, via the `temporal` display hint ---
    describe('substring operators with a temporal display hint', () => {
        const D     = new Date(2021, 4, 17, 14, 30, 20);
        const shown = (type: TemporalFieldType, showSeconds: boolean) => temporalDisplayText(type, showSeconds, D);

        it('16. contains matches the displayed date text under the date hint', () => {
            expect(matchesFilter({ due: D }, {
                type: 'contains', field: 'due', value: shown('date', false),
                temporal: { type: 'date', showSeconds: false },
            })).toBe(true);
        });

        it('17. regression: contains "GMT" does not match under the date hint, even though String(D) contains GMT', () => {
            expect(matchesFilter({ due: D }, {
                type: 'contains', field: 'due', value: 'GMT',
                temporal: { type: 'date', showSeconds: false },
            })).toBe(false);
        });

        it('18. contains "GMT" matches with no temporal member — the pre-existing raw-value behaviour is untouched', () => {
            expect(matchesFilter({ due: D }, { type: 'contains', field: 'due', value: 'GMT' })).toBe(true);
        });

        it('19. startsWith matches the displayed prefix under the date hint, not the native-form prefix', () => {
            const displayed = shown('date', false);

            expect(matchesFilter({ due: D }, {
                type: 'startsWith', field: 'due', value: displayed.slice(0, 3),
                temporal: { type: 'date', showSeconds: false },
            })).toBe(true);
            expect(matchesFilter({ due: D }, {
                type: 'startsWith', field: 'due', value: String(D).slice(0, 3),
                temporal: { type: 'date', showSeconds: false },
            })).toBe(false);
        });

        it('20. endsWith matches the displayed suffix under the date hint, not the native-form suffix', () => {
            const displayed = shown('date', false);

            expect(matchesFilter({ due: D }, {
                type: 'endsWith', field: 'due', value: displayed.slice(-3),
                temporal: { type: 'date', showSeconds: false },
            })).toBe(true);
            expect(matchesFilter({ due: D }, {
                type: 'endsWith', field: 'due', value: String(D).slice(-3),
                temporal: { type: 'date', showSeconds: false },
            })).toBe(false);
        });

        it('21. showSeconds is honoured: a longer needle matches only the showSeconds:true rendering', () => {
            const withSeconds = shown('datetime', true);

            expect(matchesFilter({ due: D }, {
                type: 'contains', field: 'due', value: withSeconds,
                temporal: { type: 'datetime', showSeconds: true },
            })).toBe(true);
            expect(matchesFilter({ due: D }, {
                type: 'contains', field: 'due', value: withSeconds,
                temporal: { type: 'datetime', showSeconds: false },
            })).toBe(false);
        });

        it('22. type is honoured: a datetime-shaped needle does not match under the date hint', () => {
            expect(matchesFilter({ due: D }, {
                type: 'contains', field: 'due', value: shown('datetime', false),
                temporal: { type: 'date', showSeconds: false },
            })).toBe(false);
        });

        it('23. contains matches the displayed time text under the time hint', () => {
            expect(matchesFilter({ due: D }, {
                type: 'contains', field: 'due', value: shown('time', false),
                temporal: { type: 'time', showSeconds: false },
            })).toBe(true);
        });

        it('24. the hint is inert for a non-Date value — the raw string is matched, not reformatted', () => {
            expect(matchesFilter({ due: '2021-05-17' }, {
                type: 'contains', field: 'due', value: '2021',
                temporal: { type: 'date', showSeconds: false },
            })).toBe(true);
            expect(matchesFilter({ due: '2021-05-17' }, {
                type: 'contains', field: 'due', value: 'GMT',
                temporal: { type: 'date', showSeconds: false },
            })).toBe(false);
        });

        it('25. a nullish field returns false for all three operators, never throwing, even with a hint present', () => {
            const temporal = { type: 'date' as const, showSeconds: false };

            expect(matchesFilter({ due: null }, { type: 'contains', field: 'due', value: 'x', temporal })).toBe(false);
            expect(matchesFilter({}, { type: 'contains', field: 'due', value: 'x', temporal })).toBe(false);
            expect(matchesFilter({ due: null }, { type: 'startsWith', field: 'due', value: 'x', temporal })).toBe(false);
            expect(matchesFilter({}, { type: 'startsWith', field: 'due', value: 'x', temporal })).toBe(false);
            expect(matchesFilter({ due: null }, { type: 'endsWith', field: 'due', value: 'x', temporal })).toBe(false);
            expect(matchesFilter({}, { type: 'endsWith', field: 'due', value: 'x', temporal })).toBe(false);
        });

        it('26. an invalid Date still matches "Invalid" under the date hint, mirroring what the cell shows', () => {
            expect(matchesFilter({ due: new Date(NaN) }, {
                type: 'contains', field: 'due', value: 'Invalid',
                temporal: { type: 'date', showSeconds: false },
            })).toBe(true);
        });
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

    // --- half-open date/time range, pinned for ColumnFilter's `eq`/`neq` builder ---
    it('41. an and(gte lo, lt hi) range over Date values includes lo, excludes hi, and includes a midpoint instant', () => {
        const lo    = new Date(2021, 4, 17, 9, 30, 0);
        const hi    = new Date(2021, 4, 17, 9, 31, 0);
        const range: FilterDescriptor = {
            type:    'and',
            filters: [{ type: 'gte', field: 'meet', value: lo }, { type: 'lt', field: 'meet', value: hi }],
        };

        expect(matchesFilter({ meet: lo }, range)).toBe(true);
        expect(matchesFilter({ meet: hi }, range)).toBe(false);
        expect(matchesFilter({ meet: new Date(2021, 4, 17, 9, 30, 30) }, range)).toBe(true);
    });

    it('42. not(in field []) matches every record — the neq-with-no-matches case', () => {
        const noMatches: FilterDescriptor = { type: 'not', filter: { type: 'in', field: 'role', values: [] } };

        expect(matchesFilter({ role: 'dev' }, noMatches)).toBe(true);
        expect(matchesFilter({ role: 'anything' }, noMatches)).toBe(true);
        expect(matchesFilter({}, noMatches)).toBe(true);
    });
});
