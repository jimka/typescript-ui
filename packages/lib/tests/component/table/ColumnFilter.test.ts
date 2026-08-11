import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import {
    columnFilterOperators,
    columnFilterTakesOperand,
    buildColumnFilter,
} from '~/component/table/ColumnFilter';
import type { ColumnFilterTarget } from '~/component/table/ColumnFilter';
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

describe('buildColumnFilter', () => {
    it('string contains with text builds a contains descriptor', () => {
        expect(buildColumnFilter('name', { type: 'string' }, { operator: 'contains', text: 'ali' }, display))
            .toEqual({ type: 'contains', field: 'name', value: 'ali' });
    });

    it('string endsWith with text builds an endsWith descriptor', () => {
        expect(buildColumnFilter('name', { type: 'string' }, { operator: 'endsWith', text: 'son' }, display))
            .toEqual({ type: 'endsWith', field: 'name', value: 'son' });
    });

    it('string contains with blank text builds nothing', () => {
        expect(buildColumnFilter('name', { type: 'string' }, { operator: 'contains', text: '' }, display)).toBeNull();
    });

    it('isEmpty ignores the text and builds an "in" descriptor over null/undefined/empty-string', () => {
        expect(buildColumnFilter('name', { type: 'string' }, { operator: 'isEmpty', text: '' }, display))
            .toEqual({ type: 'in', field: 'name', values: [null, undefined, ''] });
        // Same descriptor whatever the (ignored) text holds.
        expect(buildColumnFilter('name', { type: 'string' }, { operator: 'isEmpty', text: 'anything' }, display))
            .toEqual({ type: 'in', field: 'name', values: [null, undefined, ''] });
    });

    it('isNotEmpty ignores the text and wraps the isEmpty descriptor in "not"', () => {
        expect(buildColumnFilter('name', { type: 'string' }, { operator: 'isNotEmpty', text: '' }, display)).toEqual({
            type: 'not',
            filter: { type: 'in', field: 'name', values: [null, undefined, ''] },
        });
    });

    it('number gt with a parseable number builds a gt descriptor', () => {
        expect(buildColumnFilter('age', { type: 'number' }, { operator: 'gt', text: '30' }, display))
            .toEqual({ type: 'gt', field: 'age', value: 30 });
    });

    it('number gt with unparseable text builds nothing', () => {
        expect(buildColumnFilter('age', { type: 'number' }, { operator: 'gt', text: 'abc' }, display)).toBeNull();
    });

    it('boolean eq with a recognised token builds an eq descriptor with the coerced boolean', () => {
        expect(buildColumnFilter('active', { type: 'boolean' }, { operator: 'eq', text: 'yes' }, display))
            .toEqual({ type: 'eq', field: 'active', value: true });
    });

    it('boolean eq with an unrecognised token builds nothing', () => {
        expect(buildColumnFilter('active', { type: 'boolean' }, { operator: 'eq', text: 'maybe' }, display)).toBeNull();
    });

    it('date gte with a parseable date builds a gte descriptor with a Date value', () => {
        const result = buildColumnFilter('due', { type: 'date' }, { operator: 'gte', text: '2024-01-15' }, display);

        expect(result).toEqual({ type: 'gte', field: 'due', value: new Date('2024-01-15') });
    });

    it('date gte with an unparseable date builds nothing', () => {
        expect(buildColumnFilter('due', { type: 'date' }, { operator: 'gte', text: 'not-a-date' }, display)).toBeNull();
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
            expect(buildColumnFilter('Role', ROLE, { operator: 'contains', text: 'eng' }, display))
                .toEqual({ type: 'in', field: 'Role', values: ['qa'] });
        });

        it('19b. startsWith "pro" matches "Project Manager" -> in [pm]', () => {
            expect(buildColumnFilter('Role', ROLE, { operator: 'startsWith', text: 'pro' }, display))
                .toEqual({ type: 'in', field: 'Role', values: ['pm'] });
        });

        it('19c. eq "Developer" (exact, case-sensitive) -> in [dev]', () => {
            expect(buildColumnFilter('Role', ROLE, { operator: 'eq', text: 'Developer' }, display))
                .toEqual({ type: 'in', field: 'Role', values: ['dev'] });
        });

        it('19d. eq "developer" (wrong case) matches nothing -> in []', () => {
            expect(buildColumnFilter('Role', ROLE, { operator: 'eq', text: 'developer' }, display))
                .toEqual({ type: 'in', field: 'Role', values: [] });
        });

        it('19e. neq "Developer" -> not(in [dev])', () => {
            expect(buildColumnFilter('Role', ROLE, { operator: 'neq', text: 'Developer' }, display)).toEqual({
                type:   'not',
                filter: { type: 'in', field: 'Role', values: ['dev'] },
            });
        });

        it('19f. contains "zzz" matches nothing -> in []', () => {
            expect(buildColumnFilter('Role', ROLE, { operator: 'contains', text: 'zzz' }, display))
                .toEqual({ type: 'in', field: 'Role', values: [] });
        });

        it('20. isEmpty/isNotEmpty on a combo column still test the stored value\'s emptiness, not a label', () => {
            expect(buildColumnFilter('Role', ROLE, { operator: 'isEmpty', text: '' }, display))
                .toEqual({ type: 'in', field: 'Role', values: [null, undefined, ''] });
            expect(buildColumnFilter('Role', ROLE, { operator: 'isNotEmpty', text: '' }, display)).toEqual({
                type:   'not',
                filter: { type: 'in', field: 'Role', values: [null, undefined, ''] },
            });
        });

        it('21. gt on a combo column declared over a number field ignores the labels', () => {
            const NUMERIC_COMBO: ColumnFilterTarget = {
                type:   'number',
                values: [{ value: '1', label: 'One' }, { value: '2', label: 'Two' }],
            };

            expect(buildColumnFilter('rank', NUMERIC_COMBO, { operator: 'gt', text: '1' }, display))
                .toEqual({ type: 'gt', field: 'rank', value: 1 });
        });
    });

    // --- temporal equality (Architecture Decisions worked table) ---
    describe('temporal equality', () => {
        it('22a. time (showSeconds: true) eq "09:30:20" -> and(gte 09:30:20, lt 09:30:21)', () => {
            const target: ColumnFilterTarget = { type: 'time', showSeconds: true };

            expect(buildColumnFilter('meet', target, { operator: 'eq', text: '09:30:20' }, display)).toEqual({
                type:    'and',
                filters: [
                    { type: 'gte', field: 'meet', value: new Date(1970, 0, 1, 9, 30, 20) },
                    { type: 'lt',  field: 'meet', value: new Date(1970, 0, 1, 9, 30, 21) },
                ],
            });
        });

        it('22b. time (showSeconds: false) eq "09:30" -> and(gte 09:30:00, lt 09:31:00)', () => {
            const target: ColumnFilterTarget = { type: 'time', showSeconds: false };

            expect(buildColumnFilter('meet', target, { operator: 'eq', text: '09:30' }, display)).toEqual({
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

            expect(buildColumnFilter('due', target, { operator: 'eq', text: '2021-05-17' }, display)).toEqual({
                type:    'and',
                filters: [
                    { type: 'gte', field: 'due', value: expectedLo },
                    { type: 'lt',  field: 'due', value: expectedHi },
                ],
            });
        });

        it('22d. time gt "10:00" stays value-typed -> gt (not a range)', () => {
            const target: ColumnFilterTarget = { type: 'time' };

            expect(buildColumnFilter('meet', target, { operator: 'gt', text: '10:00' }, display))
                .toEqual({ type: 'gt', field: 'meet', value: new Date(1970, 0, 1, 10, 0, 0) });
        });

        it('22e. date gte with unparseable text builds nothing, unchanged', () => {
            const target: ColumnFilterTarget = { type: 'date' };

            expect(buildColumnFilter('due', target, { operator: 'gte', text: 'not-a-date' }, display)).toBeNull();
        });

        it('23. eq on a time column accepts "09:30 AM", "09:30", and "9:30 am" identically', () => {
            const target: ColumnFilterTarget = { type: 'time' };

            const a = buildColumnFilter('meet', target, { operator: 'eq', text: '09:30 AM' }, display);
            const b = buildColumnFilter('meet', target, { operator: 'eq', text: '09:30' }, display);
            const c = buildColumnFilter('meet', target, { operator: 'eq', text: '9:30 am' }, display);

            expect(a).toEqual(b);
            expect(b).toEqual(c);
        });

        it('24. eq on a time column with unparseable text ("half past nine") returns null', () => {
            const target: ColumnFilterTarget = { type: 'time' };

            expect(buildColumnFilter('meet', target, { operator: 'eq', text: 'half past nine' }, display)).toBeNull();
        });

        it('25. eq on a date column produces an interval one calendar day wide', () => {
            const target: ColumnFilterTarget = { type: 'date' };
            const result = buildColumnFilter('due', target, { operator: 'eq', text: '2021-05-17' }, display) as
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
            const d = buildColumnFilter('Role', ROLE, { operator: 'eq', text: 'Developer' }, display);
            assertCloneSafe(d, { Role: 'dev' });
        });

        it('26b. combo "not"-"in" descriptor', () => {
            const d = buildColumnFilter('Role', ROLE, { operator: 'neq', text: 'Developer' }, display);
            assertCloneSafe(d, { Role: 'dev' });
        });

        it('26c. temporal "and(gte, lt)" descriptor', () => {
            const d = buildColumnFilter('meet', { type: 'time' }, { operator: 'eq', text: '09:30' }, display);
            assertCloneSafe(d, { meet: new Date(1970, 0, 1, 9, 30, 30) });
        });

        it('26d. temporal "not"-"and" descriptor', () => {
            const d = buildColumnFilter('meet', { type: 'time' }, { operator: 'neq', text: '09:30' }, display);
            assertCloneSafe(d, { meet: new Date(1970, 0, 1, 9, 30, 30) });
        });

        it('26e. "contains" descriptor', () => {
            const d = buildColumnFilter('name', { type: 'string' }, { operator: 'contains', text: 'ali' }, display);
            assertCloneSafe(d, { name: 'Alice' });
        });

        it('26f. "eq" descriptor', () => {
            const d = buildColumnFilter('active', { type: 'boolean' }, { operator: 'eq', text: 'yes' }, display);
            assertCloneSafe(d, { active: true });
        });

        it('26g. "gt" descriptor', () => {
            const d = buildColumnFilter('age', { type: 'number' }, { operator: 'gt', text: '30' }, display);
            assertCloneSafe(d, { age: 40 });
        });
    });
});
