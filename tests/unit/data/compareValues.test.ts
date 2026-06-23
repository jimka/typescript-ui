import { describe, it, expect } from 'vitest';
import { compareValues } from '~/data/compareValues';

describe('compareValues', () => {
    // --- null / undefined sort last (direction-independent) ---
    it('treats two nullish operands as equal', () => {
        expect(compareValues(null, null)).toBe(0);
        expect(compareValues(undefined, undefined)).toBe(0);
        expect(compareValues(null, undefined)).toBe(0);
    });
    it('sorts a single null after a non-null value', () => {
        expect(compareValues(null, 5)).toBeGreaterThan(0);
        expect(compareValues(5, null)).toBeLessThan(0);
    });
    it('places null last regardless of the field type', () => {
        // The null guards run before the type switch, so the sign is the same
        // for every type — this is what compareBySorter relies on to keep nulls
        // last under both asc and desc (it leaves a null result un-negated).
        expect(compareValues(null, 'a', 'string')).toBeGreaterThan(0);
        expect(compareValues(null, new Date(0), 'date')).toBeGreaterThan(0);
        expect(compareValues(new Date(0), null, 'date')).toBeLessThan(0);
    });

    // --- numeric / native ordering ---
    it('orders numbers natively with an explicit number type', () => {
        expect(compareValues(1, 2, 'number')).toBeLessThan(0);
        expect(compareValues(2, 1, 'number')).toBeGreaterThan(0);
        expect(compareValues(2, 2, 'number')).toBe(0);
    });
    it('orders two numbers natively when type is omitted', () => {
        // Native (not locale): 2 < 10 numerically, where a string compare would
        // wrongly order '10' before '2'.
        expect(compareValues(2, 10)).toBeLessThan(0);
    });

    // --- string / locale ordering ---
    it('orders strings by locale with an explicit string type', () => {
        expect(compareValues('a', 'b', 'string')).toBeLessThan(0);
        expect(compareValues('b', 'a', 'string')).toBeGreaterThan(0);
        expect(compareValues('a', 'a', 'string')).toBe(0);
    });
    it('locale-orders accented letters between their base letter and Z', () => {
        expect(compareValues('Ä', 'Z', 'string')).toBeLessThan(0);
        expect(compareValues('Ä', 'a', 'string')).toBeGreaterThan(0);
    });
    it('takes the locale path for two strings when type is omitted', () => {
        expect(compareValues('b', 'a')).toBeGreaterThan(0);
    });
    it('falls through to native compare for a mixed string/number pair without a type', () => {
        // Not both strings, so the locale branch is skipped; native < / > apply
        // without throwing.
        expect(() => compareValues('a', 1)).not.toThrow();
        expect(typeof compareValues('a', 1)).toBe('number');
    });

    // --- date / time ordering ---
    it('orders Date operands by timestamp for date/time/datetime types', () => {
        const earlier = new Date(1000);
        const later   = new Date(2000);
        expect(compareValues(earlier, later, 'date')).toBeLessThan(0);
        expect(compareValues(later, earlier, 'time')).toBeGreaterThan(0);
        expect(compareValues(new Date(1000), new Date(1000), 'datetime')).toBe(0);
    });
    it('falls through to native compare when a date type has non-Date operands', () => {
        expect(compareValues(1, 2, 'date')).toBeLessThan(0);
    });

    // --- boolean / non-string native path ---
    it('orders booleans natively, never via locale', () => {
        expect(compareValues(true, false, 'boolean')).toBeGreaterThan(0);
        expect(compareValues(false, true, 'boolean')).toBeLessThan(0);
        expect(compareValues(true, true, 'boolean')).toBe(0);
    });
});
