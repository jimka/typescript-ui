// @vitest-environment jsdom
//
// DateTimeField format/parse coverage. parseRaw is the protected unit under
// test; cast to reach it. The parser is a bare `new Date(raw)`, which is far
// more lenient than its siblings — the no-time-rejection divergence is pinned
// with `it.fails` below. All assertions use local accessors so the suite is
// timezone-stable.
import { describe, it, expect } from 'vitest';
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
