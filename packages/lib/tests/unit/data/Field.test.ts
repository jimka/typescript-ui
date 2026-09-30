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
        it('reads a bare date as local midnight for a date field', () => {
            const value = new Field({ name: 'd', type: 'date' }).convertValue('2026-06-28');
            expect(value).toBeInstanceOf(Date);
            expect(value).toEqual(new Date(2026, 5, 28));
        });
        it('reads a bare date as local midnight for a datetime field', () => {
            expect(new Field({ name: 'd', type: 'datetime' }).convertValue('2026-06-28')).toEqual(new Date(2026, 5, 28));
        });
        it('reads a time of day onto 1 January 1970, local, to the millisecond', () => {
            const field = new Field({ name: 't', type: 'time' });
            expect(field.convertValue('09:30:15.250000')).toEqual(new Date(1970, 0, 1, 9, 30, 15, 250));
            expect(field.convertValue('09:30')).toEqual(new Date(1970, 0, 1, 9, 30));
        });
        it('still reads the table paste form of a time through the new Date fallback', () => {
            expect(new Field({ name: 't', type: 'time' }).convertValue('1/1/1970 02:30 PM')).toEqual(new Date(1970, 0, 1, 14, 30));
        });
        it('still reads a date string with an offset as that instant', () => {
            const value = new Field({ name: 'd', type: 'date' }).convertValue('2026-06-28T12:04:00Z');
            expect((value as Date).getTime()).toBe(Date.UTC(2026, 5, 28, 12, 4));
        });
        it('reads an offset-less date-time as local time, as before', () => {
            expect(new Field({ name: 'd', type: 'datetime' }).convertValue('2026-06-28T12:04:00')).toEqual(new Date(2026, 5, 28, 12, 4));
        });
        it('passes an existing Date through unchanged for every temporal type', () => {
            const date = new Date(2020, 0, 1);
            expect(new Field({ name: 'd', type: 'date' }).convertValue(date)).toBe(date);
            expect(new Field({ name: 'd', type: 'datetime' }).convertValue(date)).toBe(date);
            expect(new Field({ name: 'd', type: 'time' }).convertValue(date)).toBe(date);
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
