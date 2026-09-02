//
// DateField format/parse coverage. parseRaw is the protected unit under test;
// cast to reach it. setValue uses optional chaining on the inner input, so a
// bare (unmounted) field round-trips without a DOM event or TestDOM. All date
// assertions use local accessors (getFullYear/getMonth/getDate) — never UTC —
// so the suite is timezone-stable.
import { describe, it, expect } from 'vitest';
import { DateField } from '~/component/input/DateField';

/** Returns DateField.parseRaw cast to reach the protected method. */
function parser(): (raw: string) => Date | null {
    const field = new DateField();

    return (raw: string): Date | null => (field as any).parseRaw(raw);
}

/** Returns DateField.formatValue cast to reach the protected method. */
function formatter(): (date: Date) => string {
    const field = new DateField();

    return (date: Date): string => (field as any).formatValue(date);
}

describe('DateField formatValue', () => {
    it('formats a Date as a zero-padded YYYY-MM-DD string', () => {
        const format = formatter();

        // Month is 0-based: month index 5 → June → "06"; day 7 → "07".
        expect(format(new Date(2025, 5, 7))).toBe('2025-06-07');
    });
});

describe('DateField parseRaw', () => {
    const parse = parser();

    it('round-trips a valid YYYY-MM-DD into local Y/M/D components', () => {
        const d = parse('2025-06-15');

        expect(d).not.toBe(null);
        expect(d!.getFullYear()).toBe(2025);
        expect(d!.getMonth()).toBe(5); // 0-based: June.
        expect(d!.getDate()).toBe(15);
    });

    it('returns null for gross garbage', () => {
        expect(parse('garbage')).toBe(null);
    });

    it('returns null for an out-of-range month/day string', () => {
        // Month 13 invalidates the whole string → unparseable.
        expect(parse('2025-13-45')).toBe(null);
    });

    // DOCUMENTED ROLLOVER (not a pinned bug): native Date rolls an impossible
    // calendar day forward — `new Date("2025-02-30T00:00:00")` becomes March 1
    // rather than rejecting. This is JS-engine behaviour, not an obvious
    // contract violation, so it is asserted as documented (plain `it`), not
    // `it.fails`. The gross-garbage case above still pins the "unparseable →
    // null" contract.
    it('rolls an impossible day (2025-02-30) forward to a non-null Date', () => {
        const d = parse('2025-02-30');

        // Non-null is the contract point: the lenient parser does NOT reject the
        // impossible day. The exact rolled day (March 1 vs 2) depends on the host
        // timezone offset applied to the appended T00:00:00, so only the month
        // (rolled past February into March) is asserted for TZ-stability.
        expect(d).not.toBe(null);
        expect(d!.getMonth()).toBe(2); // March (0-based).
    });
});

describe('DateField value round-trip', () => {
    it('is null on a fresh field and round-trips a set Date', () => {
        const field = new DateField();
        expect(field.getValue()).toBe(null);

        const date = new Date(2025, 5, 15);
        field.setValue(date);

        const out = field.getValue();
        expect(out).not.toBe(null);
        expect(out!.getFullYear()).toBe(2025);
        expect(out!.getMonth()).toBe(5);
        expect(out!.getDate()).toBe(15);
    });
});

describe('DateField dirty state', () => {
    it('a freshly constructed field with an initial value is not dirty', () => {
        const field = new DateField({ value: new Date(2025, 5, 15) });

        expect(field.isDirty()).toBe(false);
    });

    it('typing a different date through the commit seam makes it dirty, and typing back to a fresh Date with the same Y/M/D clears it', () => {
        const field = new DateField({ value: new Date(2025, 5, 15) }) as any;

        field._input.setText('2025-06-20');
        field.onInput();
        expect(field.isDirty()).toBe(true);

        // A freshly parsed Date with the same year/month/day as the original —
        // not the same object — proves the Date-equality override runs rather
        // than reference equality.
        field._input.setText('2025-06-15');
        field.onInput();
        expect(field.isDirty()).toBe(false);
    });
});
