// Pure unit tests for the shared modifier-key selection reducer. No DOM: the
// function is dependency-free, mutating a Set in place and returning the new
// anchor. Exercised over both identity shapes the framework uses — integer
// indices (List) and object references resolved through an ordered array
// (Body records).
import { describe, it, expect } from 'vitest';
import { reduceModifierSelection } from '~/component/shared/reduceModifierSelection';

// Index-native accessors, allocation-free (the List mapping).
const idIndexOf = (i: number): number => i;
const idAt = (i: number): number => i;

function idxReduce(
    selection: Set<number>,
    anchor: number | null,
    target: number,
    ev: { ctrl: boolean; shift: boolean },
): number | null {
    return reduceModifierSelection(selection, anchor, target, idIndexOf, idAt, ev);
}

describe('reduceModifierSelection — plain', () => {
    it('replaces the selection with the target and anchors on it', () => {
        const sel = new Set<number>([1, 2, 3]);

        const anchor = idxReduce(sel, 1, 5, { ctrl: false, shift: false });

        expect([...sel]).toEqual([5]);
        expect(anchor).toBe(5);
    });
});

describe('reduceModifierSelection — ctrl', () => {
    it('adds an unselected target and anchors on it', () => {
        const sel = new Set<number>([1]);

        const anchor = idxReduce(sel, 1, 3, { ctrl: true, shift: false });

        expect([...sel].sort()).toEqual([1, 3]);
        expect(anchor).toBe(3);
    });

    it('removes a selected target and anchors on it', () => {
        const sel = new Set<number>([1, 3]);

        const anchor = idxReduce(sel, 1, 3, { ctrl: true, shift: false });

        expect([...sel]).toEqual([1]);
        expect(anchor).toBe(3);
    });
});

describe('reduceModifierSelection — shift with anchor', () => {
    it('clears then selects the inclusive range when ctrl is absent, anchor unchanged', () => {
        const sel = new Set<number>([9]);

        const anchor = idxReduce(sel, 2, 5, { ctrl: false, shift: true });

        expect([...sel].sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
        expect(anchor).toBe(2);
    });

    it('unions the range onto the prior selection when ctrl is present', () => {
        const sel = new Set<number>([9]);

        const anchor = idxReduce(sel, 2, 4, { ctrl: true, shift: true });

        expect([...sel].sort((a, b) => a - b)).toEqual([2, 3, 4, 9]);
        expect(anchor).toBe(2);
    });

    it('handles a reversed anchor/target order', () => {
        const sel = new Set<number>();

        const anchor = idxReduce(sel, 6, 3, { ctrl: false, shift: true });

        expect([...sel].sort((a, b) => a - b)).toEqual([3, 4, 5, 6]);
        expect(anchor).toBe(6);
    });
});

describe('reduceModifierSelection — shift with no anchor', () => {
    it('falls back to a plain single-target selection', () => {
        const sel = new Set<number>([1, 2]);

        const anchor = idxReduce(sel, null, 4, { ctrl: false, shift: true });

        expect([...sel]).toEqual([4]);
        expect(anchor).toBe(4);
    });

    it('falls back to a ctrl toggle when ctrl is also held', () => {
        const sel = new Set<number>([4]);

        const anchor = idxReduce(sel, null, 4, { ctrl: true, shift: true });

        expect([...sel]).toEqual([]);
        expect(anchor).toBe(4);
    });
});

describe('reduceModifierSelection — object identity over an ordered array', () => {
    it('resolves the range through indexOf / at against a records array', () => {
        const records = ['a', 'b', 'c', 'd', 'e'];
        const sel = new Set<string>();
        const indexOf = (r: string): number => records.indexOf(r);
        const at = (i: number): string => records[i];

        const anchor = reduceModifierSelection(sel, 'b', 'd', indexOf, at, { ctrl: false, shift: true });

        expect([...sel]).toEqual(['b', 'c', 'd']);
        expect(anchor).toBe('b');
    });

    it('toggles an object target under ctrl', () => {
        const records = ['a', 'b', 'c'];
        const sel = new Set<string>(['a']);
        const indexOf = (r: string): number => records.indexOf(r);
        const at = (i: number): string => records[i];

        reduceModifierSelection(sel, 'a', 'a', indexOf, at, { ctrl: true, shift: false });

        expect([...sel]).toEqual([]);
    });
});
