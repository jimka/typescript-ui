import { describe, it, expect } from 'vitest';
import { applyRule } from '~/validation/Validator';

describe('applyRule', () => {
    describe('required', () => {
        it('fails on null', () => {
            const r = applyRule({ type: 'required' }, null);
            expect(r.valid).toBe(false);
        });
        it('fails on empty string', () => {
            expect(applyRule({ type: 'required' }, '   ').valid).toBe(false);
        });
        it('passes on a non-empty value', () => {
            expect(applyRule({ type: 'required' }, 'hello').valid).toBe(true);
        });
    });

    describe('minLength', () => {
        it('fails when string is too short', () => {
            expect(applyRule({ type: 'minLength', min: 5 }, 'ab').valid).toBe(false);
        });
        it('passes when string meets minimum', () => {
            expect(applyRule({ type: 'minLength', min: 3 }, 'abc').valid).toBe(true);
        });
    });
});
