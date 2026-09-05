//
// TimeField format/parse coverage. parseRaw is the protected unit under test;
// cast to reach it. The strict validator rejects missing minutes and
// out-of-range units. showSeconds is read into a private field before the
// initial setValue, so it must be supplied as a construction option to affect
// formatting. All assertions use local accessors (getHours/getMinutes) so the
// suite is timezone-stable.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimeField } from '~/component/input/TimeField';

/** Returns TimeField.parseRaw cast to reach the protected method. */
function parser(showSeconds?: boolean): (raw: string) => Date | null {
    const field = new TimeField(showSeconds ? { showSeconds: true } : undefined);

    return (raw: string): Date | null => (field as any).parseRaw(raw);
}

/** Returns TimeField.formatValue cast to reach the protected method. */
function formatter(showSeconds?: boolean): (date: Date) => string {
    const field = new TimeField(showSeconds ? { showSeconds: true } : undefined);

    return (date: Date): string => (field as any).formatValue(date);
}

describe('TimeField formatValue', () => {
    it('formats HH:MM by default, zero-padded', () => {
        const format = formatter();

        expect(format(new Date(2025, 0, 1, 9, 5))).toBe('09:05');
    });

    it('formats HH:MM:SS when showSeconds is set', () => {
        const format = formatter(true);

        expect(format(new Date(2025, 0, 1, 9, 5, 7))).toBe('09:05:07');
    });
});

describe('TimeField parseRaw strictness', () => {
    const parse = parser();

    it('rejects an hours-only string (no minutes)', () => {
        expect(parse('09')).toBe(null);
    });

    it('rejects out-of-range minutes', () => {
        expect(parse('09:99')).toBe(null);
    });

    it('rejects out-of-range hours', () => {
        expect(parse('25:00')).toBe(null);
    });

    it('rejects out-of-range seconds', () => {
        expect(parse('09:30:61')).toBe(null);
    });

    it('accepts a non-padded HH:MM and reads back the minutes', () => {
        const d = parse('9:5');

        expect(d).not.toBe(null);
        expect(d!.getHours()).toBe(9);
        expect(d!.getMinutes()).toBe(5);
    });
});

describe('TimeField value round-trip', () => {
    it('round-trips the H/M of a set Date (date portion is today by contract)', () => {
        const field = new TimeField();

        const date = new Date(2025, 5, 15, 9, 30);
        field.setValue(date);

        const out = field.getValue();
        expect(out).not.toBe(null);
        expect(out!.getHours()).toBe(9);
        expect(out!.getMinutes()).toBe(30);
    });
});

// Clock pinned to 31 January 2026, 10:15:30.500 local. `toFake: ["Date"]`
// leaves every other timer real, since field construction subscribes to
// theme changes.
describe('TimeField relative shorthand parseRaw', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 0, 31, 10, 15, 30, 500));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const parse = parser();

    it('20. "+30mi" resolves relative to now, milliseconds zeroed', () => {
        const d = parse('+30mi');

        expect(d!.getFullYear()).toBe(2026);
        expect(d!.getMonth()).toBe(0);
        expect(d!.getDate()).toBe(31);
        expect(d!.getHours()).toBe(10);
        expect(d!.getMinutes()).toBe(45);
        expect(d!.getSeconds()).toBe(30);
        expect(d!.getMilliseconds()).toBe(0);
    });

    it('21. "+1h30mi" resolves relative to now', () => {
        const d = parse('+1h30mi');

        expect(d!.getHours()).toBe(11);
        expect(d!.getMinutes()).toBe(45);
        expect(d!.getSeconds()).toBe(30);
    });

    it('22. "+1d" is rejected by both the shorthand and strict branches', () => {
        expect(parse('+1d')).toBe(null);
    });

    it('23. an absolute string is still parsed by the untouched strict branch', () => {
        const d = parse('09:30');

        expect(d!.getHours()).toBe(9);
        expect(d!.getMinutes()).toBe(30);
        expect(d!.getSeconds()).toBe(0);
    });
});

describe('TimeField relative shorthand commit on blur', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(2026, 0, 31, 10, 15, 30, 500));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('33. onBlur rewrites a pending shorthand to its formatted absolute value', () => {
        const field = new TimeField() as any;

        field._input.setText('+30mi');
        field.onInput();
        field.onBlur();

        expect(field._input.getText()).toBe('10:45');
    });
});
