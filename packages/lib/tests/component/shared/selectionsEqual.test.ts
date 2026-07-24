// Pure unit tests for the shared selection-equality helper. No DOM: the
// function is dependency-free, comparing two Sets by membership only.
import { describe, it, expect } from 'vitest';
import { selectionsEqual } from '~/component/shared/selectionsEqual';

describe('selectionsEqual', () => {
    it('treats two empty sets as equal', () => {
        expect(selectionsEqual(new Set(), new Set())).toBe(true);
    });

    it('treats the same members in a different insertion order as equal', () => {
        const a = new Set([1, 2, 3]);
        const b = new Set([3, 1, 2]);

        expect(selectionsEqual(a, b)).toBe(true);
    });

    it('treats different sizes as not equal', () => {
        const a = new Set([1, 2]);
        const b = new Set([1, 2, 3]);

        expect(selectionsEqual(a, b)).toBe(false);
    });

    it('treats same-size disjoint members as not equal', () => {
        const a = new Set([1, 2]);
        const b = new Set([3, 4]);

        expect(selectionsEqual(a, b)).toBe(false);
    });

    it('treats same-size sets differing by one member as not equal', () => {
        const a = new Set([1, 2, 3]);
        const b = new Set([1, 2, 4]);

        expect(selectionsEqual(a, b)).toBe(false);
    });
});
