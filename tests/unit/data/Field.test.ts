import { describe, it, expect } from 'vitest';
import { Field } from '~/data/Field';

describe('Field', () => {
    it('stores the logical name', () => {
        expect(new Field({ name: 'age' }).getName()).toBe('age');
    });
    it("defaults the type to 'auto'", () => {
        expect(new Field({ name: 'age' }).getType()).toBe('auto');
    });
    it('keeps an explicit type', () => {
        expect(new Field({ name: 'age', type: 'number' }).getType()).toBe('number');
    });
    it('defaults the mapping to the field name', () => {
        expect(new Field({ name: 'age' }).getMapping()).toBe('age');
    });
    it('keeps an explicit mapping', () => {
        expect(new Field({ name: 'age', mapping: 'years' }).getMapping()).toBe('years');
    });
    it('falls back to the name for the description', () => {
        expect(new Field({ name: 'age' }).getDescription()).toBe('age');
    });

    describe('convertValue', () => {
        it('coerces numeric strings to numbers', () => {
            expect(new Field({ name: 'n', type: 'number' }).convertValue('10')).toBe(10);
        });
        it("maps '' / null / undefined to undefined for number fields", () => {
            const f = new Field({ name: 'n', type: 'number' });
            expect(f.convertValue('')).toBeUndefined();
            expect(f.convertValue(null)).toBeNull();
            expect(f.convertValue(undefined)).toBeUndefined();
        });
        it('coerces truthy / falsy spellings to booleans', () => {
            const f = new Field({ name: 'b', type: 'boolean' });
            expect(f.convertValue('true')).toBe(true);
            expect(f.convertValue('1')).toBe(true);
            expect(f.convertValue('yes')).toBe(true);
            expect(f.convertValue('false')).toBe(false);
            expect(f.convertValue('0')).toBe(false);
            expect(f.convertValue('')).toBe(false);
        });
        it('parses date strings into Date objects', () => {
            const value = new Field({ name: 'd', type: 'date' }).convertValue('2020-01-01');
            expect(value).toBeInstanceOf(Date);
            expect((value as Date).getTime()).toBe(new Date('2020-01-01').getTime());
        });
        it('passes an existing Date through unchanged', () => {
            const date = new Date('2020-01-01');
            expect(new Field({ name: 'd', type: 'date' }).convertValue(date)).toBe(date);
        });
        it('maps an invalid date to undefined', () => {
            expect(new Field({ name: 'd', type: 'date' }).convertValue('not-a-date')).toBeUndefined();
        });
        it('coerces values to strings for string fields', () => {
            expect(new Field({ name: 's', type: 'string' }).convertValue(42)).toBe('42');
        });
        it('passes auto / glyph values through unchanged', () => {
            expect(new Field({ name: 'a', type: 'auto' }).convertValue({ x: 1 })).toEqual({ x: 1 });
            expect(new Field({ name: 'g', type: 'glyph' }).convertValue('star')).toBe('star');
        });
        it('runs a custom convert hook in preference to the type switch', () => {
            const f = new Field({ name: 'n', type: 'number', convert: (raw) => Number(raw) * 2 });
            expect(f.convertValue('5')).toBe(10);
        });
        it('passes the source record to a custom convert hook', () => {
            const f = new Field({ name: 'full', convert: (_raw, src) => `${src?.first} ${src?.last}` });
            expect(f.convertValue(undefined, { first: 'Ada', last: 'Lovelace' })).toBe('Ada Lovelace');
        });
    });

    describe('getValidators', () => {
        it('returns an empty array when no validators are configured', () => {
            expect(new Field({ name: 'n' }).getValidators()).toEqual([]);
        });
        it('returns the configured validation rules', () => {
            const rules = [{ type: 'required' as const }];
            expect(new Field({ name: 'n', validators: rules }).getValidators()).toEqual(rules);
        });
    });
});
