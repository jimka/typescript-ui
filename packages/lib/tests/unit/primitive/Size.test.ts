import { describe, it, expect } from 'vitest';
import { UNBOUNDED, isUnbounded, saturate } from '~/primitive/Size';

describe('Size', () => {
    it('UNBOUNDED is the max-safe-integer sentinel', () => {
        expect(UNBOUNDED).toBe(Number.MAX_SAFE_INTEGER);
    });
    it('isUnbounded() recognises the sentinel itself', () => {
        expect(isUnbounded(UNBOUNDED)).toBe(true);
    });
    it('isUnbounded() is false for ordinary finite extents', () => {
        expect(isUnbounded(0)).toBe(false);
        expect(isUnbounded(100)).toBe(false);
    });
    it('isUnbounded() recognises the legacy MAX_VALUE sentinel', () => {
        expect(isUnbounded(Number.MAX_VALUE)).toBe(true);
    });
    it('isUnbounded() recognises Infinity', () => {
        expect(isUnbounded(Infinity)).toBe(true);
    });
    it('saturate() leaves an ordinary extent untouched', () => {
        expect(saturate(100)).toBe(100);
    });
    it('saturate() caps an over-the-sentinel value at UNBOUNDED', () => {
        expect(saturate(UNBOUNDED + 1000)).toBe(UNBOUNDED);
        expect(saturate(Number.MAX_VALUE)).toBe(UNBOUNDED);
    });
    it('saturate() applies no lower bound', () => {
        expect(saturate(-5)).toBe(-5);
    });
});
