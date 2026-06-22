// Pure predicate / assertion logic — no DOM, runs under the default node env.
import { describe, it, expect } from 'vitest';
import { Type } from '~/core/Type';

describe('Type.isBoolean', () => {
    it('is true for boolean primitives, false otherwise', () => {
        expect(Type.isBoolean(true as unknown as object)).toBe(true);
        expect(Type.isBoolean(false as unknown as object)).toBe(true);
        expect(Type.isBoolean(0 as unknown as object)).toBe(false);
        expect(Type.isBoolean('x' as unknown as object)).toBe(false);
    });
});

describe('Type.isString', () => {
    it('is true for strings, false for non-strings', () => {
        expect(Type.isString('x' as unknown as object)).toBe(true);
        expect(Type.isString(5 as unknown as object)).toBe(false);
    });

    it('accepts null/undefined when allowNull is set', () => {
        expect(Type.isString(null as unknown as object, true)).toBe(true);
        expect(Type.isString(undefined as unknown as object, true)).toBe(true);
        expect(Type.isString(null as unknown as object, false)).toBe(false);
    });
});

describe('Type.isNumber', () => {
    it('is true for any number, including NaN and Infinity (per the JSDoc)', () => {
        expect(Type.isNumber(5 as unknown as object)).toBe(true);
        expect(Type.isNumber(NaN as unknown as object)).toBe(true);
        expect(Type.isNumber(Infinity as unknown as object)).toBe(true);
    });

    it('is false for non-numbers', () => {
        expect(Type.isNumber('5' as unknown as object)).toBe(false);
    });
});

describe('Type.isInteger', () => {
    it('is true for whole numbers, false for floats and numeric strings', () => {
        expect(Type.isInteger(5 as unknown as object)).toBe(true);
        expect(Type.isInteger(5.5 as unknown as object)).toBe(false);
        expect(Type.isInteger('5' as unknown as object)).toBe(false);
    });

    it('passes a falsy value (0, null) when allowNull is set', () => {
        expect(Type.isInteger(0 as unknown as object, true)).toBe(true);
        expect(Type.isInteger(null as unknown as object, true)).toBe(true);
    });
});

describe('Type.isFloat', () => {
    it('is true for a non-integer number, false otherwise', () => {
        expect(Type.isFloat(5.5 as unknown as object)).toBe(true);
        expect(Type.isFloat(5 as unknown as object)).toBe(false);
        expect(Type.isFloat('5.5' as unknown as object)).toBe(false);
    });
});

describe('Type.isArray / isObject', () => {
    it('isArray is true only for arrays', () => {
        expect(Type.isArray([])).toBe(true);
        expect(Type.isArray({} as unknown as object)).toBeFalsy();
    });

    it('isObject excludes arrays and null, includes plain objects', () => {
        expect(Type.isObject({})).toBe(true);
        expect(Type.isObject([])).toBe(false);
        expect(Type.isObject(null as unknown as object)).toBeFalsy();
    });
});

describe('Type.isElement / isFunction', () => {
    it('isFunction is true for functions', () => {
        expect(Type.isFunction(() => {})).toBe(true);
        expect(Type.isFunction(5 as unknown as object)).toBeFalsy();
    });
});

describe('Type.requireNonNull', () => {
    it('does not throw for a non-null object', () => {
        expect(() => Type.requireNonNull({}, '')).not.toThrow();
    });

    it('throws with the default message for null/undefined', () => {
        expect(() => Type.requireNonNull(null as unknown as object, ''))
            .toThrow('Argument cannot be null.');
        expect(() => Type.requireNonNull(undefined as unknown as object, ''))
            .toThrow('Argument cannot be null.');
    });

    it('throws a supplied custom message', () => {
        expect(() => Type.requireNonNull(null as unknown as object, 'boom')).toThrow('boom');
    });

    // DISCREPANCY: JSDoc says "Throws if obj is null or undefined", but the
    // runtime guard is `if (obj) return` — so it ALSO throws on falsy 0, '',
    // and false. Asserting the documented contract (no throw on 0) fails
    // against the code. Pinned with it.fails so the divergence is visible
    // without masking it. Bug candidate: either the doc or the guard is wrong.
    it.fails('does NOT throw on falsy-but-non-null values (0) per its JSDoc', () => {
        expect(() => Type.requireNonNull(0 as unknown as object, '')).not.toThrow();
    });
});

describe('Type.requireBoolean', () => {
    it('does not throw for a boolean', () => {
        expect(() => Type.requireBoolean(true as unknown as object, '')).not.toThrow();
    });

    it('throws the default message for a non-boolean', () => {
        expect(() => Type.requireBoolean('x' as unknown as object, ''))
            .toThrow('Argument must be a boolean.');
    });
});

describe('Type.requireString', () => {
    // Signature: requireString(value, allowNull, msg).
    it('does not throw for a string', () => {
        expect(() => Type.requireString('x' as unknown as object, false, '')).not.toThrow();
    });

    it('throws the default message for a non-string when allowNull is false', () => {
        expect(() => Type.requireString(5 as unknown as object, false, ''))
            .toThrow('Argument must be a string.');
    });

    it('does not throw for null when allowNull is true', () => {
        expect(() => Type.requireString(null as unknown as object, true, '')).not.toThrow();
    });
});

describe('Type.requireInteger', () => {
    // Signature: requireInteger(value, allowNull, msg).
    it('does not throw for an integer', () => {
        expect(() => Type.requireInteger(5 as unknown as object, false, '')).not.toThrow();
    });

    it('throws the default message for a float', () => {
        expect(() => Type.requireInteger(5.5 as unknown as object, false, ''))
            .toThrow('Argument must be an integer.');
    });

    it('does not throw for a falsy value when allowNull is true', () => {
        expect(() => Type.requireInteger(0 as unknown as object, true, '')).not.toThrow();
    });
});

describe('Type.requireNumber / requireFunction / requireArray / requireObject', () => {
    it('requireNumber throws the default message for a non-number', () => {
        expect(() => Type.requireNumber('x' as unknown as object, ''))
            .toThrow('Argument must be a number.');
    });

    it('requireFunction throws the default message for a non-function', () => {
        expect(() => Type.requireFunction(5 as unknown as object, ''))
            .toThrow('Argument must be a function.');
    });

    it('requireArray throws the default message for a non-array', () => {
        expect(() => Type.requireArray({} as unknown as object, ''))
            .toThrow('Argument must be an array.');
    });

    it('requireObject throws the default message for an array (arrays excluded)', () => {
        expect(() => Type.requireObject([] as unknown as object, ''))
            .toThrow('Argument must be an object.');
    });
});
