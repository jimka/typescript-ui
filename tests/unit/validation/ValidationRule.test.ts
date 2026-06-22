// Pure-logic suite for the validation rule engine. The runtime contract lives
// in `applyRule` (Validator.ts); ValidationRule.ts / ValidationResult.ts are
// type-only (a discriminated union + a result interface) with no runtime
// surface, so the result-shape contract is folded in here rather than given a
// standalone file.
import { describe, it, expect } from 'vitest';
import { applyRule } from '~/validation/Validator';
import type { ValidationRule } from '~/validation/ValidationRule';

describe('applyRule — result shape contract', () => {
    it('returns { valid: true, message: "" } on success', () => {
        const result = applyRule({ type: 'required' }, 'present');

        expect(result).toEqual({ valid: true, message: '' });
    });

    it('returns { valid: false, message: <non-empty> } on failure', () => {
        const result = applyRule({ type: 'required' }, null);

        expect(result.valid).toBe(false);
        expect(result.message.length).toBeGreaterThan(0);
    });
});

describe('applyRule — required', () => {
    it('fails on null, undefined, and whitespace-only string', () => {
        expect(applyRule({ type: 'required' }, null).valid).toBe(false);
        expect(applyRule({ type: 'required' }, undefined).valid).toBe(false);
        expect(applyRule({ type: 'required' }, '   ').valid).toBe(false);
    });

    it('passes on a non-empty string, on 0, and on false', () => {
        // Emptiness predicate is only null/undefined/blank-string — a numeric 0
        // and boolean false are NOT empty.
        expect(applyRule({ type: 'required' }, 'x').valid).toBe(true);
        expect(applyRule({ type: 'required' }, 0).valid).toBe(true);
        expect(applyRule({ type: 'required' }, false).valid).toBe(true);
    });

    it('uses the default message and lets a custom message override it', () => {
        expect(applyRule({ type: 'required' }, null).message).toBe('This field is required.');
        expect(applyRule({ type: 'required', message: 'Need it' }, null).message).toBe('Need it');
    });
});

describe('applyRule — minLength / maxLength', () => {
    it('treats length === min as passing and length < min as failing (inclusive)', () => {
        expect(applyRule({ type: 'minLength', min: 3 }, 'ab').valid).toBe(false);
        expect(applyRule({ type: 'minLength', min: 3 }, 'abc').valid).toBe(true);
    });

    it('treats length === max as passing and length > max as failing (inclusive)', () => {
        expect(applyRule({ type: 'maxLength', max: 3 }, 'abc').valid).toBe(true);
        expect(applyRule({ type: 'maxLength', max: 3 }, 'abcd').valid).toBe(false);
    });

    it('coerces non-string values via String(value ?? "")', () => {
        // The number 5 -> "5" (length 1) fails minLength 2.
        expect(applyRule({ type: 'minLength', min: 2 }, 5).valid).toBe(false);
        // null -> "" (length 0) fails minLength 1.
        expect(applyRule({ type: 'minLength', min: 1 }, null).valid).toBe(false);
    });

    it('uses default messages and lets a custom message override them', () => {
        expect(applyRule({ type: 'minLength', min: 3 }, 'ab').message)
            .toBe('Minimum length is 3 characters.');
        expect(applyRule({ type: 'maxLength', max: 2 }, 'abc').message)
            .toBe('Maximum length is 2 characters.');
        expect(applyRule({ type: 'minLength', min: 3, message: 'too short' }, 'ab').message)
            .toBe('too short');
    });
});

describe('applyRule — min / max', () => {
    it('coerces via Number(value) and treats boundary equality as passing', () => {
        expect(applyRule({ type: 'min', min: 5 }, 5).valid).toBe(true);
        expect(applyRule({ type: 'min', min: 5 }, 4).valid).toBe(false);
        expect(applyRule({ type: 'max', max: 5 }, 5).valid).toBe(true);
        expect(applyRule({ type: 'max', max: 5 }, 6).valid).toBe(false);
    });

    it('fails both min and max when the value coerces to NaN', () => {
        expect(applyRule({ type: 'min', min: 0 }, 'abc').valid).toBe(false);
        expect(applyRule({ type: 'max', max: 100 }, 'abc').valid).toBe(false);
    });

    it('uses default messages and lets a custom message override them', () => {
        expect(applyRule({ type: 'min', min: 5 }, 4).message).toBe('Value must be at least 5.');
        expect(applyRule({ type: 'max', max: 5 }, 6).message).toBe('Value must be at most 5.');
        expect(applyRule({ type: 'min', min: 5, message: 'low' }, 4).message).toBe('low');
    });
});

describe('applyRule — regex', () => {
    it('tests String(value ?? "") against the pattern', () => {
        expect(applyRule({ type: 'regex', pattern: /^\d+$/ }, '123').valid).toBe(true);
        expect(applyRule({ type: 'regex', pattern: /^\d+$/ }, 'abc').valid).toBe(false);
    });

    it('coerces null to "" before testing', () => {
        // "" does not match /^\d+$/, so a null value fails.
        expect(applyRule({ type: 'regex', pattern: /^\d+$/ }, null).valid).toBe(false);
        // "" matches /^$/, so a null value passes an empty-string pattern.
        expect(applyRule({ type: 'regex', pattern: /^$/ }, null).valid).toBe(true);
    });

    it('uses the default message and lets a custom message override it', () => {
        expect(applyRule({ type: 'regex', pattern: /^\d+$/ }, 'x').message)
            .toBe('Value does not match the required format.');
        expect(applyRule({ type: 'regex', pattern: /^\d+$/, message: 'bad' }, 'x').message)
            .toBe('bad');
    });
});

describe('applyRule — custom', () => {
    it('drives validity from the predicate result, both branches', () => {
        expect(applyRule({ type: 'custom', predicate: () => true }, 'x').valid).toBe(true);
        expect(applyRule({ type: 'custom', predicate: () => false }, 'x').valid).toBe(false);
    });

    it('passes the raw value (including non-string) to the predicate', () => {
        const seen: unknown[] = [];

        const rule: ValidationRule = {
            type:      'custom',
            predicate: (v) => { seen.push(v); return true; },
        };

        applyRule(rule, 42);
        applyRule(rule, { a: 1 });

        expect(seen).toEqual([42, { a: 1 }]);
    });

    it('uses the default message and lets a custom message override it', () => {
        expect(applyRule({ type: 'custom', predicate: () => false }, 'x').message)
            .toBe('Invalid value.');
        expect(applyRule({ type: 'custom', predicate: () => false, message: 'nope' }, 'x').message)
            .toBe('nope');
    });
});
