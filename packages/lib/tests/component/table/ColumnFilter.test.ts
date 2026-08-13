import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import {
    columnFilterOperators,
    columnFilterOperatorLabel,
    columnFilterOperatorGlyph,
    columnFilterTakesOperand,
    columnFilterTakesNumericOperand,
    columnFilterAcceptsNumericKey,
    buildColumnFilter,
    columnFilterStatesEqual,
} from '~/component/table/ColumnFilter';
import type { ColumnFilterTarget, ColumnFilterState } from '~/component/table/ColumnFilter';
import { CellTextResolver } from '~/component/table/cell/CellText';
import { matchesFilter } from '~/data/FilterDescriptor';
import type { FilterDescriptor } from '~/data/FilterDescriptor';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let display: CellTextResolver;

beforeEach(() => {
    installTestDOM(CONFIG);
    display = new CellTextResolver();
});

afterEach(() => {
    display.dispose();
    DOM.reset();
});

/** Builds a one-clause `ColumnFilterState`, matching the pre-multi-clause call shape. */
function oneClause(operator: ColumnFilterState['clauses'][number]['operator'], text: string): ColumnFilterState {
    return { clauses: [{ operator, text }] };
}

describe('columnFilterOperators', () => {
    it('defaults string/auto/glyph columns to contains, with no ordering operator', () => {
        expect(columnFilterOperators('string')[0]).toBe('contains');
        expect(columnFilterOperators('string')).not.toContain('gt');
    });

    it('defaults number/date/time/datetime columns to eq, with the ordering operators', () => {
        for (const type of ['number', 'date', 'time', 'datetime'] as const) {
            expect(columnFilterOperators(type)[0]).toBe('eq');
            expect(columnFilterOperators(type)).toEqual(
                expect.arrayContaining(['gt', 'gte', 'lt', 'lte']));
        }
    });

    it('boolean columns get eq/neq/isEmpty/isNotEmpty only, no ordering operator', () => {
        expect(columnFilterOperators('boolean')).toEqual(['eq', 'neq', 'isEmpty', 'isNotEmpty']);
    });

    it('1. date/time/datetime each offer the full ordered + substring + emptiness list, in order', () => {
        const expected = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith', 'endsWith', 'isEmpty', 'isNotEmpty'];

        expect(columnFilterOperators('date')).toEqual(expected);
        expect(columnFilterOperators('time')).toEqual(expected);
        expect(columnFilterOperators('datetime')).toEqual(expected);
    });

    it('2. the default operator for a temporal column is still eq', () => {
        expect(columnFilterOperators('date')[0]).toBe('eq');
    });

    it('3. number columns get no substring operator', () => {
        expect(columnFilterOperators('number'))
            .toEqual(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'isNotEmpty']);
    });

    it('4. string and boolean columns are unchanged', () => {
        expect(columnFilterOperators('string'))
            .toEqual(['contains', 'startsWith', 'endsWith', 'eq', 'neq', 'isEmpty', 'isNotEmpty']);
        expect(columnFilterOperators('boolean')).toEqual(['eq', 'neq', 'isEmpty', 'isNotEmpty']);
    });

    it('5. every operator offered for a date column has a non-empty label and glyph', () => {
        for (const op of columnFilterOperators('date')) {
            expect(columnFilterOperatorLabel(op)).not.toBe('');
            expect(columnFilterOperatorGlyph(op)).not.toBe('');
        }
    });
});

describe('columnFilterTakesOperand', () => {
    it('is false only for isEmpty / isNotEmpty', () => {
        expect(columnFilterTakesOperand('isEmpty')).toBe(false);
        expect(columnFilterTakesOperand('isNotEmpty')).toBe(false);
    });

    it('is true for every other operator', () => {
        const others = ['contains', 'startsWith', 'endsWith', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const;

        for (const op of others) {
            expect(columnFilterTakesOperand(op)).toBe(true);
        }
    });
});

describe('columnFilterTakesNumericOperand', () => {
    it('1. a number column takes a numeric operand', () => {
        expect(columnFilterTakesNumericOperand({ type: 'number' })).toBe(true);
    });

    it('2. every non-number column type does not', () => {
        const types = ['string', 'auto', 'glyph', 'boolean', 'date', 'time', 'datetime'] as const;

        for (const type of types) {
            expect(columnFilterTakesNumericOperand({ type })).toBe(false);
        }
    });

    it('3. a combo column over a number field does not — the operand matches labels', () => {
        expect(columnFilterTakesNumericOperand({ type: 'number', values: ['Low', 'High'] })).toBe(false);
    });

    it('4. an empty values array is not a combo column', () => {
        expect(columnFilterTakesNumericOperand({ type: 'number', values: [] })).toBe(true);
    });

    it('5. a combo column over a string field does not', () => {
        expect(columnFilterTakesNumericOperand({ type: 'string', values: ['Low', 'High'] })).toBe(false);
    });
});

describe('columnFilterAcceptsNumericKey', () => {
    it('6. every digit 0-9 is allowed', () => {
        for (const digit of '0123456789') {
            expect(columnFilterAcceptsNumericKey(digit)).toBe(true);
        }
    });

    it('7. "-" and "." are allowed', () => {
        expect(columnFilterAcceptsNumericKey('-')).toBe(true);
        expect(columnFilterAcceptsNumericKey('.')).toBe(true);
    });

    it('8. a non-numeric single character is refused', () => {
        for (const key of ['a', 'A', 'e', '+', ',', '/', ' ']) {
            expect(columnFilterAcceptsNumericKey(key)).toBe(false);
        }
    });

    it('9. every editing/navigation key (a multi-character key name) is allowed', () => {
        const keys = [
            'Backspace', 'Delete', 'Tab', 'Enter', 'Escape',
            'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Shift', 'Control', 'F5',
        ];

        for (const key of keys) {
            expect(columnFilterAcceptsNumericKey(key)).toBe(true);
        }
    });

    it('10. IME composition keys ("Unidentified" / "Process") are allowed', () => {
        expect(columnFilterAcceptsNumericKey('Unidentified')).toBe(true);
        expect(columnFilterAcceptsNumericKey('Process')).toBe(true);
    });

    it('11. an empty key string is allowed — "not exactly one character" never refuses it', () => {
        expect(columnFilterAcceptsNumericKey('')).toBe(true);
    });
});

describe('buildColumnFilter', () => {
    it('string contains with text builds a contains descriptor', () => {
        expect(buildColumnFilter('name', { type: 'string' }, oneClause('contains', 'ali'), display))
            .toEqual({ type: 'contains', field: 'name', value: 'ali' });
    });

    it('string endsWith with text builds an endsWith descriptor', () => {
        expect(buildColumnFilter('name', { type: 'string' }, oneClause('endsWith', 'son'), display))
            .toEqual({ type: 'endsWith', field: 'name', value: 'son' });
    });

    it('string contains with blank text builds nothing', () => {
        expect(buildColumnFilter('name', { type: 'string' }, oneClause('contains', ''), display)).toBeNull();
    });

    it('isEmpty ignores the text and builds an "in" descriptor over null/undefined/empty-string', () => {
        expect(buildColumnFilter('name', { type: 'string' }, oneClause('isEmpty', ''), display))
            .toEqual({ type: 'in', field: 'name', values: [null, undefined, ''] });
        // Same descriptor whatever the (ignored) text holds.
        expect(buildColumnFilter('name', { type: 'string' }, oneClause('isEmpty', 'anything'), display))
            .toEqual({ type: 'in', field: 'name', values: [null, undefined, ''] });
    });

    it('isNotEmpty ignores the text and wraps the isEmpty descriptor in "not"', () => {
        expect(buildColumnFilter('name', { type: 'string' }, oneClause('isNotEmpty', ''), display)).toEqual({
            type: 'not',
            filter: { type: 'in', field: 'name', values: [null, undefined, ''] },
        });
    });

    it('number gt with a parseable number builds a gt descriptor', () => {
        expect(buildColumnFilter('age', { type: 'number' }, oneClause('gt', '30'), display))
            .toEqual({ type: 'gt', field: 'age', value: 30 });
    });

    it('number gt with unparseable text builds nothing', () => {
        expect(buildColumnFilter('age', { type: 'number' }, oneClause('gt', 'abc'), display)).toBeNull();
    });

    it('boolean eq with a recognised token builds an eq descriptor with the coerced boolean', () => {
        expect(buildColumnFilter('active', { type: 'boolean' }, oneClause('eq', 'yes'), display))
            .toEqual({ type: 'eq', field: 'active', value: true });
    });

    it('boolean eq with an unrecognised token builds nothing', () => {
        expect(buildColumnFilter('active', { type: 'boolean' }, oneClause('eq', 'maybe'), display)).toBeNull();
    });

    it('date gte with a parseable date builds a gte descriptor with a Date value', () => {
        const result = buildColumnFilter('due', { type: 'date' }, oneClause('gte', '2024-01-15'), display);

        expect(result).toEqual({ type: 'gte', field: 'due', value: new Date('2024-01-15') });
    });

    it('date gte with an unparseable date builds nothing', () => {
        expect(buildColumnFilter('due', { type: 'date' }, oneClause('gte', 'not-a-date'), display)).toBeNull();
    });

    // --- multi-clause composition (## Expected Behaviour, cases 1-7) ---
    describe('multi-clause composition', () => {
        it('1. one clause builds the bare leaf descriptor, unchanged', () => {
            expect(buildColumnFilter('age', { type: 'number' }, oneClause('gte', '18'), display))
                .toEqual({ type: 'gte', field: 'age', value: 18 });
        });

        it('2. two clauses build an "and" of both, in clause order', () => {
            const state: ColumnFilterState = {
                clauses: [{ operator: 'gte', text: '18' }, { operator: 'lte', text: '65' }],
            };

            expect(buildColumnFilter('age', { type: 'number' }, state, display)).toEqual({
                type:    'and',
                filters: [
                    { type: 'gte', field: 'age', value: 18 },
                    { type: 'lte', field: 'age', value: 65 },
                ],
            });
        });

        it('3. three clauses build an "and" of three, in clause order', () => {
            const state: ColumnFilterState = {
                clauses: [
                    { operator: 'gte', text: '18' },
                    { operator: 'lte', text: '65' },
                    { operator: 'neq', text: '30' },
                ],
            };

            expect(buildColumnFilter('age', { type: 'number' }, state, display)).toEqual({
                type:    'and',
                filters: [
                    { type: 'gte', field: 'age', value: 18 },
                    { type: 'lte', field: 'age', value: 65 },
                    { type: 'neq', field: 'age', value: 30 },
                ],
            });
        });

        it('4. a blank first clause is dropped; the sole survivor is unwrapped, not "and"-wrapped', () => {
            const state: ColumnFilterState = {
                clauses: [{ operator: 'gte', text: '' }, { operator: 'lte', text: '65' }],
            };

            expect(buildColumnFilter('age', { type: 'number' }, state, display))
                .toEqual({ type: 'lte', field: 'age', value: 65 });
        });

        it('5. every clause blank builds nothing', () => {
            const state: ColumnFilterState = {
                clauses: [{ operator: 'gte', text: '' }, { operator: 'lte', text: '' }],
            };

            expect(buildColumnFilter('age', { type: 'number' }, state, display)).toBeNull();
        });

        it('6. a combo column with two clauses builds an "and" of each clause\'s own combo resolution', () => {
            const role: ColumnFilterTarget = {
                type:   'string',
                values: [
                    { value: 'dev', label: 'Developer' },
                    { value: 'qa',  label: 'QA Engineer' },
                ],
            };
            const state: ColumnFilterState = {
                clauses: [{ operator: 'contains', text: 'eng' }, { operator: 'neq', text: 'Developer' }],
            };

            expect(buildColumnFilter('Role', role, state, display)).toEqual({
                type:    'and',
                filters: [
                    { type: 'in',  field: 'Role', values: ['qa'] },
                    { type: 'not', filter: { type: 'in', field: 'Role', values: ['dev'] } },
                ],
            });
        });

        it('7. a single temporal-equality clause still builds the direct and(gte, lt) bucket, not double-wrapped', () => {
            const target: ColumnFilterTarget = { type: 'time', showSeconds: true };

            expect(buildColumnFilter('meet', target, oneClause('eq', '09:30:20'), display)).toEqual({
                type:    'and',
                filters: [
                    { type: 'gte', field: 'meet', value: new Date(1970, 0, 1, 9, 30, 20) },
                    { type: 'lt',  field: 'meet', value: new Date(1970, 0, 1, 9, 30, 21) },
                ],
            });
        });
    });

    // --- combo columns (Architecture Decisions worked table) ---
    describe('combo columns', () => {
        const ROLE: ColumnFilterTarget = {
            type:   'string',
            values: [
                { value: 'dev', label: 'Developer' },
                { value: 'qa',  label: 'QA Engineer' },
                { value: 'pm',  label: 'Project Manager' },
            ],
        };

        it('19a. contains "eng" matches "QA Engineer" -> in [qa]', () => {
            expect(buildColumnFilter('Role', ROLE, oneClause('contains', 'eng'), display))
                .toEqual({ type: 'in', field: 'Role', values: ['qa'] });
        });

        it('19b. startsWith "pro" matches "Project Manager" -> in [pm]', () => {
            expect(buildColumnFilter('Role', ROLE, oneClause('startsWith', 'pro'), display))
                .toEqual({ type: 'in', field: 'Role', values: ['pm'] });
        });

        it('19c. eq "Developer" (exact, case-sensitive) -> in [dev]', () => {
            expect(buildColumnFilter('Role', ROLE, oneClause('eq', 'Developer'), display))
                .toEqual({ type: 'in', field: 'Role', values: ['dev'] });
        });

        it('19d. eq "developer" (wrong case) matches nothing -> in []', () => {
            expect(buildColumnFilter('Role', ROLE, oneClause('eq', 'developer'), display))
                .toEqual({ type: 'in', field: 'Role', values: [] });
        });

        it('19e. neq "Developer" -> not(in [dev])', () => {
            expect(buildColumnFilter('Role', ROLE, oneClause('neq', 'Developer'), display)).toEqual({
                type:   'not',
                filter: { type: 'in', field: 'Role', values: ['dev'] },
            });
        });

        it('19f. contains "zzz" matches nothing -> in []', () => {
            expect(buildColumnFilter('Role', ROLE, oneClause('contains', 'zzz'), display))
                .toEqual({ type: 'in', field: 'Role', values: [] });
        });

        it('20. isEmpty/isNotEmpty on a combo column still test the stored value\'s emptiness, not a label', () => {
            expect(buildColumnFilter('Role', ROLE, oneClause('isEmpty', ''), display))
                .toEqual({ type: 'in', field: 'Role', values: [null, undefined, ''] });
            expect(buildColumnFilter('Role', ROLE, oneClause('isNotEmpty', ''), display)).toEqual({
                type:   'not',
                filter: { type: 'in', field: 'Role', values: [null, undefined, ''] },
            });
        });

        it('21. gt on a combo column declared over a number field ignores the labels', () => {
            const NUMERIC_COMBO: ColumnFilterTarget = {
                type:   'number',
                values: [{ value: '1', label: 'One' }, { value: '2', label: 'Two' }],
            };

            expect(buildColumnFilter('rank', NUMERIC_COMBO, oneClause('gt', '1'), display))
                .toEqual({ type: 'gt', field: 'rank', value: 1 });
        });
    });

    // --- temporal equality (Architecture Decisions worked table) ---
    describe('temporal equality', () => {
        it('22a. time (showSeconds: true) eq "09:30:20" -> and(gte 09:30:20, lt 09:30:21)', () => {
            const target: ColumnFilterTarget = { type: 'time', showSeconds: true };

            expect(buildColumnFilter('meet', target, oneClause('eq', '09:30:20'), display)).toEqual({
                type:    'and',
                filters: [
                    { type: 'gte', field: 'meet', value: new Date(1970, 0, 1, 9, 30, 20) },
                    { type: 'lt',  field: 'meet', value: new Date(1970, 0, 1, 9, 30, 21) },
                ],
            });
        });

        it('22b. time (showSeconds: false) eq "09:30" -> and(gte 09:30:00, lt 09:31:00)', () => {
            const target: ColumnFilterTarget = { type: 'time', showSeconds: false };

            expect(buildColumnFilter('meet', target, oneClause('eq', '09:30'), display)).toEqual({
                type:    'and',
                filters: [
                    { type: 'gte', field: 'meet', value: new Date(1970, 0, 1, 9, 30, 0) },
                    { type: 'lt',  field: 'meet', value: new Date(1970, 0, 1, 9, 31, 0) },
                ],
            });
        });

        it('22c. date eq "2021-05-17" -> and(gte local midnight, lt following midnight)', () => {
            // Relational, not a hard-coded literal: `new Date(text)` parses an
            // ISO date-only string as UTC, so the *local calendar day* it
            // names depends on the runner's offset — exactly the day
            // `DateRenderer` would also read the same instant as.
            const target: ColumnFilterTarget = { type: 'date' };
            const operand     = new Date('2021-05-17');
            const expectedLo  = new Date(operand.getFullYear(), operand.getMonth(), operand.getDate());
            const expectedHi  = new Date(expectedLo.getFullYear(), expectedLo.getMonth(), expectedLo.getDate() + 1);

            expect(buildColumnFilter('due', target, oneClause('eq', '2021-05-17'), display)).toEqual({
                type:    'and',
                filters: [
                    { type: 'gte', field: 'due', value: expectedLo },
                    { type: 'lt',  field: 'due', value: expectedHi },
                ],
            });
        });

        it('22d. time gt "10:00" stays value-typed -> gt (not a range)', () => {
            const target: ColumnFilterTarget = { type: 'time' };

            expect(buildColumnFilter('meet', target, oneClause('gt', '10:00'), display))
                .toEqual({ type: 'gt', field: 'meet', value: new Date(1970, 0, 1, 10, 0, 0) });
        });

        it('22e. date gte with unparseable text builds nothing, unchanged', () => {
            const target: ColumnFilterTarget = { type: 'date' };

            expect(buildColumnFilter('due', target, oneClause('gte', 'not-a-date'), display)).toBeNull();
        });

        it('23. eq on a time column accepts "09:30 AM", "09:30", and "9:30 am" identically', () => {
            const target: ColumnFilterTarget = { type: 'time' };

            const a = buildColumnFilter('meet', target, oneClause('eq', '09:30 AM'), display);
            const b = buildColumnFilter('meet', target, oneClause('eq', '09:30'), display);
            const c = buildColumnFilter('meet', target, oneClause('eq', '9:30 am'), display);

            expect(a).toEqual(b);
            expect(b).toEqual(c);
        });

        it('24. eq on a time column with unparseable text ("half past nine") returns null', () => {
            const target: ColumnFilterTarget = { type: 'time' };

            expect(buildColumnFilter('meet', target, oneClause('eq', 'half past nine'), display)).toBeNull();
        });

        it('25. eq on a date column produces an interval one calendar day wide', () => {
            const target: ColumnFilterTarget = { type: 'date' };
            const result = buildColumnFilter('due', target, oneClause('eq', '2021-05-17'), display) as
                Extract<FilterDescriptor, { type: 'and' }>;

            const lo = (result.filters[0] as any).value as Date;
            const hi = (result.filters[1] as any).value as Date;
            // Calendar arithmetic, not +86_400_000: this still holds on a
            // 23- or 25-hour local day (a DST transition).
            const expectedHi = new Date(lo.getFullYear(), lo.getMonth(), lo.getDate() + 1);

            expect(lo.getHours()).toBe(0);
            expect(hi.getHours()).toBe(0);
            expect(hi.getTime()).toBe(expectedHi.getTime());
        });

        it('6. date contains "17" builds a temporal-hinted contains descriptor', () => {
            const target: ColumnFilterTarget = { type: 'date' };

            expect(buildColumnFilter('due', target, oneClause('contains', '17'), display)).toEqual({
                type: 'contains', field: 'due', value: '17',
                temporal: { type: 'date', showSeconds: false },
            });
        });

        it('7. date startsWith / endsWith build the same hinted shape with the matching type', () => {
            const target: ColumnFilterTarget = { type: 'date' };

            expect(buildColumnFilter('due', target, oneClause('startsWith', '17'), display)).toEqual({
                type: 'startsWith', field: 'due', value: '17',
                temporal: { type: 'date', showSeconds: false },
            });
            expect(buildColumnFilter('due', target, oneClause('endsWith', '17'), display)).toEqual({
                type: 'endsWith', field: 'due', value: '17',
                temporal: { type: 'date', showSeconds: false },
            });
        });

        it('8. datetime with showSeconds: true carries showSeconds through the hint', () => {
            const target: ColumnFilterTarget = { type: 'datetime', showSeconds: true };

            expect(buildColumnFilter('due', target, oneClause('contains', 'x'), display)).toEqual({
                type: 'contains', field: 'due', value: 'x',
                temporal: { type: 'datetime', showSeconds: true },
            });
        });

        it('9. time with showSeconds unset resolves the hint to showSeconds: false', () => {
            const target: ColumnFilterTarget = { type: 'time' };

            expect(buildColumnFilter('meet', target, oneClause('contains', 'x'), display)).toEqual({
                type: 'contains', field: 'meet', value: 'x',
                temporal: { type: 'time', showSeconds: false },
            });
        });

        it('10. a string column\'s contains descriptor carries no temporal key', () => {
            const result = buildColumnFilter('name', { type: 'string' }, oneClause('contains', 'ali'), display);

            expect(result).toEqual({ type: 'contains', field: 'name', value: 'ali' });
            expect('temporal' in (result as object)).toBe(false);
        });

        it('11. a combo column declared over a date field still takes the combo path, with no temporal key', () => {
            const target: ColumnFilterTarget = {
                type:   'date',
                values: [{ value: '2021-05-17', label: 'May 17' }],
            };
            const result = buildColumnFilter('due', target, oneClause('contains', 'x'), display);

            expect(result).toEqual({ type: 'in', field: 'due', values: [] });
            expect('temporal' in (result as object)).toBe(false);
        });

        it('12. date eq/neq still build the unchanged and(gte, lt) bucket, with no temporal key', () => {
            const target: ColumnFilterTarget = { type: 'date' };
            const eqResult = buildColumnFilter('due', target, oneClause('eq', '2021-05-17'), display);

            expect((eqResult as { type: string }).type).toBe('and');
            expect('temporal' in (eqResult as object)).toBe(false);

            const neqResult = buildColumnFilter('due', target, oneClause('neq', '2021-05-17'), display);

            expect(neqResult).toEqual({ type: 'not', filter: eqResult });
        });

        it('13. a temporal column with an eq clause plus a contains clause combines both, in clause order', () => {
            const target: ColumnFilterTarget = { type: 'date' };
            const state: ColumnFilterState = {
                clauses: [{ operator: 'eq', text: '2021-05-17' }, { operator: 'contains', text: '17' }],
            };
            const eqBucket = buildColumnFilter('due', target, oneClause('eq', '2021-05-17'), display);

            expect(buildColumnFilter('due', target, state, display)).toEqual({
                type:    'and',
                filters: [
                    eqBucket,
                    { type: 'contains', field: 'due', value: '17', temporal: { type: 'date', showSeconds: false } },
                ],
            });
        });

        it('14. a blank temporal contains clause builds nothing; the sole survivor unwraps without an "and" wrapper', () => {
            const target: ColumnFilterTarget = { type: 'date' };

            expect(buildColumnFilter('due', target, oneClause('contains', ''), display)).toBeNull();

            const state: ColumnFilterState = {
                clauses: [{ operator: 'eq', text: '' }, { operator: 'contains', text: '17' }],
            };

            expect(buildColumnFilter('due', target, state, display)).toEqual({
                type: 'contains', field: 'due', value: '17', temporal: { type: 'date', showSeconds: false },
            });
        });
    });

    // --- worker safety: every emittable shape survives structured clone ---
    describe('worker safety', () => {
        const ROLE: ColumnFilterTarget = {
            type:   'string',
            values: [{ value: 'dev', label: 'Developer' }],
        };

        function assertCloneSafe(descriptor: FilterDescriptor | null, record: Record<string, unknown>): void {
            expect(descriptor).not.toBeNull();

            const clone = structuredClone(descriptor);

            expect(matchesFilter(record, clone!)).toBe(matchesFilter(record, descriptor!));
        }

        it('26a. combo "in" descriptor', () => {
            const d = buildColumnFilter('Role', ROLE, oneClause('eq', 'Developer'), display);
            assertCloneSafe(d, { Role: 'dev' });
        });

        it('26b. combo "not"-"in" descriptor', () => {
            const d = buildColumnFilter('Role', ROLE, oneClause('neq', 'Developer'), display);
            assertCloneSafe(d, { Role: 'dev' });
        });

        it('26c. temporal "and(gte, lt)" descriptor', () => {
            const d = buildColumnFilter('meet', { type: 'time' }, oneClause('eq', '09:30'), display);
            assertCloneSafe(d, { meet: new Date(1970, 0, 1, 9, 30, 30) });
        });

        it('26d. temporal "not"-"and" descriptor', () => {
            const d = buildColumnFilter('meet', { type: 'time' }, oneClause('neq', '09:30'), display);
            assertCloneSafe(d, { meet: new Date(1970, 0, 1, 9, 30, 30) });
        });

        it('26e. "contains" descriptor', () => {
            const d = buildColumnFilter('name', { type: 'string' }, oneClause('contains', 'ali'), display);
            assertCloneSafe(d, { name: 'Alice' });
        });

        it('26f. "eq" descriptor', () => {
            const d = buildColumnFilter('active', { type: 'boolean' }, oneClause('eq', 'yes'), display);
            assertCloneSafe(d, { active: true });
        });

        it('26g. "gt" descriptor', () => {
            const d = buildColumnFilter('age', { type: 'number' }, oneClause('gt', '30'), display);
            assertCloneSafe(d, { age: 40 });
        });

        it('15. temporal "contains" descriptor with a display hint', () => {
            const d = buildColumnFilter('due', { type: 'date' }, oneClause('contains', '17'), display);
            assertCloneSafe(d, { due: new Date(2021, 4, 17, 14, 30, 20) });
        });
    });
});

describe('columnFilterStatesEqual', () => {
    it('8a. equal single-clause states are equal', () => {
        expect(columnFilterStatesEqual(oneClause('contains', 'a'), oneClause('contains', 'a'))).toBe(true);
    });

    it('8b. a clause-count mismatch is not equal', () => {
        const one: ColumnFilterState  = { clauses: [{ operator: 'contains', text: 'a' }] };
        const two: ColumnFilterState  = {
            clauses: [{ operator: 'contains', text: 'a' }, { operator: 'eq', text: 'b' }],
        };

        expect(columnFilterStatesEqual(one, two)).toBe(false);
    });

    it('8c. an operator mismatch at any index is not equal', () => {
        expect(columnFilterStatesEqual(oneClause('contains', 'a'), oneClause('startsWith', 'a'))).toBe(false);
    });

    it('8d. a text mismatch at any index is not equal', () => {
        expect(columnFilterStatesEqual(oneClause('contains', 'a'), oneClause('contains', 'b'))).toBe(false);
    });
});
