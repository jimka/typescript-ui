//
// dateMath.ts is a pure Date-math module with no DOM dependency, so these
// tests call tokenizeDateMath / applyDateMath / resolveDateMath directly —
// no field construction, no DOM harness. Case numbers below match this
// plan's `## Expected Behaviour` numbering: plans/in-progress/date-time-picker-relative-shorthand.md.
import { describe, it, expect } from 'vitest';
import { tokenizeDateMath, applyDateMath, resolveDateMath, DateMathUnit } from '~/component/input/dateMath';

const ALL: readonly DateMathUnit[] = ["y", "mo", "w", "d", "h", "mi", "s"];

describe('tokenizeDateMath', () => {
    it('1. "+9y" tokenizes to a single positive year token', () => {
        expect(tokenizeDateMath("+9y", ALL)).toEqual([{ amount: 9, unit: "y" }]);
    });

    it('2. a missing sign defaults to +, matching the explicit-+ form', () => {
        expect(tokenizeDateMath("9y", ALL)).toEqual(tokenizeDateMath("+9y", ALL));
    });

    it('3. "-9y" tokenizes to a single negative year token', () => {
        expect(tokenizeDateMath("-9y", ALL)).toEqual([{ amount: -9, unit: "y" }]);
    });

    it('4. a leading sign does not distribute across later tokens', () => {
        expect(tokenizeDateMath("-2w3d", ALL)).toEqual([
            { amount: -2, unit: "w" },
            { amount: 3, unit: "d" },
        ]);
    });

    it('5. whitespace between tokens is accepted', () => {
        expect(tokenizeDateMath("1y 6mo", ALL)).toEqual([
            { amount: 1, unit: "y" },
            { amount: 6, unit: "mo" },
        ]);
    });

    it('6. units match case-insensitively', () => {
        expect(tokenizeDateMath("+30MI", ALL)).toEqual([{ amount: 30, unit: "mi" }]);
    });

    it.each([
        "", "+", "1", "y", "1m", "1.5d", "9yy", "+9y x", "2026-12-31", "09:30", "garbage",
    ])('7. rejects non-shorthand input %j', (raw) => {
        expect(tokenizeDateMath(raw, ALL)).toBe(null);
    });

    it('8. a unit outside the supplied allowed list is rejected', () => {
        expect(tokenizeDateMath("+1h", ["y", "mo", "w", "d"])).toBe(null);
    });

    it('9. one disallowed unit rejects the whole expression, not just that token', () => {
        expect(tokenizeDateMath("1y2h", ["y", "mo", "w", "d"])).toBe(null);
    });
});

describe('applyDateMath', () => {
    it('10. a month offset applies the native rollover as-is', () => {
        const result = applyDateMath(new Date(2026, 0, 31), [{ amount: 1, unit: "mo" }]);

        expect(result.getFullYear()).toBe(2026);
        expect(result.getMonth()).toBe(2); // March (0-based) — Feb 31 overflows.
        expect(result.getDate()).toBe(3);
    });

    it('11. does not mutate its base argument', () => {
        const base = new Date(2026, 0, 31);
        const baseTime = base.getTime();

        applyDateMath(base, [{ amount: 1, unit: "mo" }]);

        expect(base.getTime()).toBe(baseTime);
    });

    it('12. folds tokens left-to-right, net -11 days', () => {
        const result = applyDateMath(new Date(2026, 0, 31), [
            { amount: -2, unit: "w" },
            { amount: 3, unit: "d" },
        ]);

        expect(result.getFullYear()).toBe(2026);
        expect(result.getMonth()).toBe(0); // January.
        expect(result.getDate()).toBe(20);
    });
});

describe('resolveDateMath', () => {
    it('13. returns null when the offset pushes the Date out of range', () => {
        expect(resolveDateMath("999999999y", ALL, new Date(2026, 0, 31))).toBe(null);
    });

    it('14. returns null for non-shorthand text and the resolved Date otherwise', () => {
        const base = new Date(2026, 0, 31);

        expect(resolveDateMath("garbage", ALL, base)).toBe(null);

        const result = resolveDateMath("+1d", ALL, base);
        expect(result).not.toBe(null);
        expect(result!.getFullYear()).toBe(2026);
        expect(result!.getMonth()).toBe(1); // February.
        expect(result!.getDate()).toBe(1);
    });
});
