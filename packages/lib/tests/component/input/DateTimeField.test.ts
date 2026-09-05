//
// DateTimeField format/parse coverage. parseRaw is the protected unit under
// test; cast to reach it. The parser is a bare `new Date(raw)`, which is far
// more lenient than its siblings — the no-time-rejection divergence is pinned
// with `it.fails` below. All assertions use local accessors so the suite is
// timezone-stable.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTimeField } from '~/component/input/DateTimeField';

/** Returns DateTimeField.parseRaw cast to reach the protected method. */
function parser(showSeconds?: boolean): (raw: string) => Date | null {
    const field = new DateTimeField(showSeconds ? { showSeconds: true } : undefined);

    return (raw: string): Date | null => (field as any).parseRaw(raw);
}

/** Returns DateTimeField.formatValue cast to reach the protected method. */
function formatter(showSeconds?: boolean): (date: Date) => string {
    const field = new DateTimeField(showSeconds ? { showSeconds: true } : undefined);

    return (date: Date): string => (field as any).formatValue(date);
}

describe('DateTimeField formatValue', () => {
    it('formats YYYY-MM-DD HH:MM by default', () => {
        const format = formatter();

        expect(format(new Date(2025, 5, 15, 14, 30))).toBe('2025-06-15 14:30');
    });

    it('formats YYYY-MM-DD HH:MM:SS when showSeconds is set', () => {
        const format = formatter(true);

        expect(format(new Date(2025, 5, 15, 14, 30, 9))).toBe('2025-06-15 14:30:09');
    });
});

describe('DateTimeField parseRaw', () => {
    const parse = parser();

    it('round-trips a YYYY-MM-DD HH:MM string into local components', () => {
        const d = parse('2025-06-15 14:30');

        expect(d).not.toBe(null);
        expect(d!.getFullYear()).toBe(2025);
        expect(d!.getMonth()).toBe(5); // 0-based: June.
        expect(d!.getDate()).toBe(15);
        expect(d!.getHours()).toBe(14);
        expect(d!.getMinutes()).toBe(30);
    });

    it('returns null for total garbage (the one case the lenient parser rejects)', () => {
        expect(parse('total garbage')).toBe(null);
    });

    // Resolved divergence: parseRaw now requires both a date and a time portion
    // (ISO-anchored), so a time-less string is rejected — the strict inverse of
    // formatValue, consistent with the DateField/TimeField siblings.
    it('rejects a date with no time portion', () => {
        expect(parse('2025-06-15')).toBe(null);
    });
});

describe('DateTimeField value round-trip', () => {
    it('is null on a fresh field and round-trips a set Date', () => {
        const field = new DateTimeField();
        expect(field.getValue()).toBe(null);

        const date = new Date(2025, 5, 15, 14, 30);
        field.setValue(date);

        const out = field.getValue();
        expect(out).not.toBe(null);
        expect(out!.getFullYear()).toBe(2025);
        expect(out!.getHours()).toBe(14);
        expect(out!.getMinutes()).toBe(30);
    });
});

// Clock pinned to 31 January 2026, 10:15:30.500 local — chosen because it
// exercises the month-end rollover. `toFake: ["Date"]` leaves every other
// timer real, since field construction subscribes to theme changes.
describe('DateTimeField relative shorthand parseRaw', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 0, 31, 10, 15, 30, 500));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const parse = parser();

    it('24. "1y 6mo" resolves relative to now, milliseconds zeroed', () => {
        const d = parse('1y 6mo');

        expect(d!.getFullYear()).toBe(2027);
        expect(d!.getMonth()).toBe(6); // July (0-based).
        expect(d!.getDate()).toBe(31);
        expect(d!.getHours()).toBe(10);
        expect(d!.getMinutes()).toBe(15);
        expect(d!.getSeconds()).toBe(30);
        expect(d!.getMilliseconds()).toBe(0);
    });

    // The plan's prose for this case (## Expected Behaviour, case 25) states
    // 08:15:30, but that requires the leading "-" to distribute onto the "2h"
    // token — exactly what the grammar's own "sign never distributes" rule
    // (see dateMath.test.ts cases 4 and 12, and the Architecture Decisions
    // "-2w3d" example) forbids. Each token keeps its own sign, defaulting to
    // "+": -1 day then +2 hours from a 10:15:30 base is 12:15:30, verified
    // independently against native Date arithmetic. See this plan's
    // Implementation Notes.
    it('25. "-1d2h" applies -1 day then +2 hours (unsigned token defaults to +)', () => {
        const d = parse('-1d2h');

        expect(d!.getFullYear()).toBe(2026);
        expect(d!.getMonth()).toBe(0);
        expect(d!.getDate()).toBe(30);
        expect(d!.getHours()).toBe(12);
        expect(d!.getMinutes()).toBe(15);
        expect(d!.getSeconds()).toBe(30);
    });

    it('26. an absolute string is still parsed by the untouched strict branch', () => {
        const d = parse('2026-06-15 14:30');

        expect(d!.getFullYear()).toBe(2026);
        expect(d!.getMonth()).toBe(5);
        expect(d!.getDate()).toBe(15);
        expect(d!.getHours()).toBe(14);
        expect(d!.getMinutes()).toBe(30);
    });
});

describe('DateTimeField relative shorthand commit on blur', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 0, 31, 10, 15, 30, 500));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('34. onBlur rewrites a pending shorthand to its formatted absolute value', () => {
        const field = new DateTimeField() as any;

        field._input.setText('1y 6mo');
        field.onInput();
        field.onBlur();

        expect(field._input.getText()).toBe('2027-07-31 10:15');
        expect(field.getValue()!.getFullYear()).toBe(2027);
    });
});
