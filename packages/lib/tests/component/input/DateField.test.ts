//
// DateField format/parse coverage. parseRaw is the protected unit under test;
// cast to reach it. setValue uses optional chaining on the inner input, so a
// bare (unmounted) field round-trips without a DOM event or TestDOM. All date
// assertions use local accessors (getFullYear/getMonth/getDate) — never UTC —
// so the suite is timezone-stable.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// Cases below pin the clock to 31 January 2026, 10:15:30.500 local — chosen
// because it exercises the month-end rollover. `toFake: ["Date"]` leaves
// every other timer real, since field construction subscribes to theme
// changes.
describe('DateField relative shorthand parseRaw', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 0, 31, 10, 15, 30, 500));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const parse = parser();

    it('15. "+0d" resolves to today at local midnight', () => {
        const d = parse('+0d');

        expect(d).not.toBe(null);
        expect(d!.getFullYear()).toBe(2026);
        expect(d!.getMonth()).toBe(0);
        expect(d!.getDate()).toBe(31);
        expect(d!.getHours()).toBe(0);
        expect(d!.getMinutes()).toBe(0);
        expect(d!.getSeconds()).toBe(0);
        expect(d!.getMilliseconds()).toBe(0);
    });

    it('16. a signed year offset resolves relative to today, with a missing sign meaning +', () => {
        const plus = parse('+9y');
        expect(plus!.getFullYear()).toBe(2035);
        expect(plus!.getMonth()).toBe(0);
        expect(plus!.getDate()).toBe(31);

        const unsigned = parse('9y');
        expect(unsigned!.getTime()).toBe(plus!.getTime());

        const minus = parse('-9y');
        expect(minus!.getFullYear()).toBe(2017);
        expect(minus!.getMonth()).toBe(0);
        expect(minus!.getDate()).toBe(31);
    });

    it('17. "-2w3d" resolves to 20 January 2026', () => {
        const d = parse('-2w3d');

        expect(d!.getFullYear()).toBe(2026);
        expect(d!.getMonth()).toBe(0);
        expect(d!.getDate()).toBe(20);
    });

    it('18. "+1h" is rejected by both the shorthand and strict branches', () => {
        expect(parse('+1h')).toBe(null);
    });

    it('19. an absolute string is still parsed by the untouched strict branch', () => {
        const d = parse('2026-12-31');

        expect(d!.getFullYear()).toBe(2026);
        expect(d!.getMonth()).toBe(11);
        expect(d!.getDate()).toBe(31);
    });
});

describe('DateField relative shorthand live typing', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 0, 31, 10, 15, 30, 500));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('27. onInput leaves the typed text untouched, resolves the value, and fires change', () => {
        const field = new DateField() as any;
        let changed: Date | null | undefined;
        field.on('change', (v: Date | null) => { changed = v; });

        field._input.setText('+9y');
        field.onInput();

        expect(field._input.getText()).toBe('+9y');
        expect(field.getValue()!.getFullYear()).toBe(2035);
        expect(field._invalid).toBe(false);
        expect(changed).not.toBeUndefined();
        expect(changed!.getFullYear()).toBe(2035);
    });

    it('28. a shorthand using a unit outside this field\'s list leaves the field invalid and fires no change', () => {
        const field = new DateField() as any;
        let changed = false;
        field.on('change', () => { changed = true; });

        field._input.setText('+1h');
        field.onInput();

        expect(field._invalid).toBe(true);
        expect(changed).toBe(false);
    });

    it('29. typing a shorthand resolving to a different instant is dirty; resolving to the same instant is clean', () => {
        const field = new DateField({ value: new Date(2026, 0, 31) }) as any;

        field._input.setText('+1d');
        field.onInput();
        expect(field.isDirty()).toBe(true);

        field._input.setText('+0d');
        field.onInput();
        expect(field.isDirty()).toBe(false);
    });
});

describe('DateField relative shorthand commit on blur and Enter', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 0, 31, 10, 15, 30, 500));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('30. onBlur rewrites a pending shorthand to its formatted absolute value', () => {
        const field = new DateField() as any;

        field._input.setText('+9y');
        field.onInput();
        field.onBlur();

        expect(field._input.getText()).toBe('2035-01-31');
        expect(field.getValue()!.getFullYear()).toBe(2035);
    });

    it('31. Enter commits a pending shorthand and prevents the default key action', () => {
        const field = new DateField() as any;

        field._input.setText('+9y');
        field.onInput();
        const result = field.onKeyDown({ key: 'Enter' });

        expect(field._input.getText()).toBe('2035-01-31');
        expect(result).toEqual({ prevent: true });
    });

    it('32. Enter leaves an already-absolute entry untouched and returns nothing', () => {
        const field = new DateField() as any;

        field._input.setText('2026-12-31');
        field.onInput();
        const result = field.onKeyDown({ key: 'Enter' });

        expect(field._input.getText()).toBe('2026-12-31');
        expect(result).toBeUndefined();
    });

    it('35. an out-of-range shorthand does not commit; existing invalid-blur behaviour clears it', () => {
        const field = new DateField() as any;

        field._input.setText('999999999y');
        field.onInput();
        expect(field._invalid).toBe(true);

        expect(field.commitShorthandIfPresent()).toBe(false);

        field.onBlur();
        expect(field._input.getText()).toBe('');
        expect(field.getValue()).toBe(null);
    });

    it('36. unparseable garbage is unaffected: existing behaviour clears text and value on blur', () => {
        const field = new DateField() as any;

        field._input.setText('garbage');
        field.onInput();
        field.onBlur();

        expect(field._input.getText()).toBe('');
        expect(field.getValue()).toBe(null);
    });
});
