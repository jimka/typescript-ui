import { describe, it, expect } from 'vitest';
import {
    columnFilterOperators,
    columnFilterTakesOperand,
    buildColumnFilter,
} from '~/component/table/ColumnFilter';

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
        expect(buildColumnFilter('name', 'string', { operator: 'contains', text: 'ali' }))
            .toEqual({ type: 'contains', field: 'name', value: 'ali' });
    });

    it('string endsWith with text builds an endsWith descriptor', () => {
        expect(buildColumnFilter('name', 'string', { operator: 'endsWith', text: 'son' }))
            .toEqual({ type: 'endsWith', field: 'name', value: 'son' });
    });

    it('string contains with blank text builds nothing', () => {
        expect(buildColumnFilter('name', 'string', { operator: 'contains', text: '' })).toBeNull();
    });

    it('isEmpty ignores the text and builds an "in" descriptor over null/undefined/empty-string', () => {
        expect(buildColumnFilter('name', 'string', { operator: 'isEmpty', text: '' }))
            .toEqual({ type: 'in', field: 'name', values: [null, undefined, ''] });
        // Same descriptor whatever the (ignored) text holds.
        expect(buildColumnFilter('name', 'string', { operator: 'isEmpty', text: 'anything' }))
            .toEqual({ type: 'in', field: 'name', values: [null, undefined, ''] });
    });

    it('isNotEmpty ignores the text and wraps the isEmpty descriptor in "not"', () => {
        expect(buildColumnFilter('name', 'string', { operator: 'isNotEmpty', text: '' })).toEqual({
            type: 'not',
            filter: { type: 'in', field: 'name', values: [null, undefined, ''] },
        });
    });

    it('number gt with a parseable number builds a gt descriptor', () => {
        expect(buildColumnFilter('age', 'number', { operator: 'gt', text: '30' }))
            .toEqual({ type: 'gt', field: 'age', value: 30 });
    });

    it('number gt with unparseable text builds nothing', () => {
        expect(buildColumnFilter('age', 'number', { operator: 'gt', text: 'abc' })).toBeNull();
    });

    it('boolean eq with a recognised token builds an eq descriptor with the coerced boolean', () => {
        expect(buildColumnFilter('active', 'boolean', { operator: 'eq', text: 'yes' }))
            .toEqual({ type: 'eq', field: 'active', value: true });
    });

    it('boolean eq with an unrecognised token builds nothing', () => {
        expect(buildColumnFilter('active', 'boolean', { operator: 'eq', text: 'maybe' })).toBeNull();
    });

    it('date gte with a parseable date builds a gte descriptor with a Date value', () => {
        const result = buildColumnFilter('due', 'date', { operator: 'gte', text: '2024-01-15' });

        expect(result).toEqual({ type: 'gte', field: 'due', value: new Date('2024-01-15') });
    });

    it('date gte with an unparseable date builds nothing', () => {
        expect(buildColumnFilter('due', 'date', { operator: 'gte', text: 'not-a-date' })).toBeNull();
    });
});
