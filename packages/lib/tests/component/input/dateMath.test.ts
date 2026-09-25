//
// dateMath.ts is a pure Date-math module with no DOM dependency, so these
// tests call tokenizeDateMath / applyDateMath / resolveDateMath directly —
// no field construction, no DOM harness. Case numbers below match this
// plan's `## Expected Behaviour` numbering: plans/in-progress/date-time-picker-relative-shorthand.md.
import { describe, it, expect } from 'vitest';
import { tokenizeDateMath, applyDateMath, resolveDateMath, parseIsoDate, parseClockTime, parseIsoDateTime, formatIsoDate, DateMathUnit } from '~/component/input/dateMath';

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

// parseIsoDate / parseClockTime are the strict absolute-form parsers the three
// picker fields share. Their rows are keyed by input rather than numbered, so
// the names below quote the input instead of continuing the sequence above.
describe('parseIsoDate', () => {
    it('accepts a complete zero-padded date, at local midnight', () => {
        const d = parseIsoDate("2026-09-16");

        expect(d).not.toBe(null);
        expect(d!.getFullYear()).toBe(2026);
        expect(d!.getMonth()).toBe(8); // 0-based: September.
        expect(d!.getDate()).toBe(16);
        expect(d!.getHours()).toBe(0);
        expect(d!.getMinutes()).toBe(0);
        expect(d!.getSeconds()).toBe(0);
    });

    it('accepts a real leap day', () => {
        const d = parseIsoDate("2024-02-29");

        expect(d!.getFullYear()).toBe(2024);
        expect(d!.getMonth()).toBe(1); // February.
        expect(d!.getDate()).toBe(29);
    });

    it('accepts the zero-padded low end of the four-digit year range', () => {
        const d = parseIsoDate("0001-01-01");

        expect(d!.getFullYear()).toBe(1);
        expect(d!.getMonth()).toBe(0);
        expect(d!.getDate()).toBe(1);
    });

    it('rejects a bare year — a prefix on the way to a full date', () => {
        expect(parseIsoDate("2026")).toBe(null);
    });

    it('rejects a year-month prefix', () => {
        expect(parseIsoDate("2026-09")).toBe(null);
    });

    it('rejects an unpadded month and day', () => {
        expect(parseIsoDate("2026-9-1")).toBe(null);
    });

    it('rejects a day that does not exist in that month rather than rolling it forward', () => {
        // `new Date("2025-02-30T00:00:00")` is 2 March — a date the text never
        // named, which is the same defect as accepting a bare year.
        expect(parseIsoDate("2025-02-30")).toBe(null);
    });

    it('rejects a leap day in a non-leap year', () => {
        expect(parseIsoDate("2026-02-29")).toBe(null);
    });

    it('rejects an out-of-range month and day', () => {
        expect(parseIsoDate("2025-13-45")).toBe(null);
    });

    it('rejects gross garbage and the empty string', () => {
        expect(parseIsoDate("garbage")).toBe(null);
        expect(parseIsoDate("")).toBe(null);
    });

    it('rejects a complete date with trailing whitespace', () => {
        expect(parseIsoDate("2026-09-16 ")).toBe(null);
    });
});

describe('parseClockTime', () => {
    it('accepts H:MM, defaulting the seconds to zero', () => {
        expect(parseClockTime("09:30")).toEqual({ hours: 9, minutes: 30, seconds: 0 });
    });

    it('accepts unpadded hours and minutes', () => {
        expect(parseClockTime("9:5")).toEqual({ hours: 9, minutes: 5, seconds: 0 });
    });

    it('accepts H:MM:SS', () => {
        expect(parseClockTime("09:30:45")).toEqual({ hours: 9, minutes: 30, seconds: 45 });
    });

    it('accepts an unpadded seconds part', () => {
        expect(parseClockTime("09:30:5")).toEqual({ hours: 9, minutes: 30, seconds: 5 });
    });

    it('rejects an hour with no minutes', () => {
        expect(parseClockTime("09")).toBe(null);
    });

    it('rejects an hour outside 0-23', () => {
        expect(parseClockTime("24:00")).toBe(null);
    });

    it('rejects minutes outside 0-59', () => {
        expect(parseClockTime("09:60")).toBe(null);
    });

    it('rejects seconds outside 0-59', () => {
        expect(parseClockTime("09:30:61")).toBe(null);
    });

    it('rejects the empty string', () => {
        expect(parseClockTime("")).toBe(null);
    });

    it('rejects internal whitespace between the hour and the minute', () => {
        expect(parseClockTime("09:3 0")).toBe(null);
    });

    it.each([
        "9:30:00:99", "1e1:30", "0x9:30", "9.5:30", "09:30:", ":30",
        " 9:30", "9:30 ", "+9:30", "-0:30", "009:30", "09:30:05.5",
    ])('rejects %j', (raw) => {
        expect(parseClockTime(raw)).toBe(null);
    });

    it('accepts H:M:S with every part at its minimum', () => {
        expect(parseClockTime("0:0:0")).toEqual({ hours: 0, minutes: 0, seconds: 0 });
    });

    it('accepts H:MM:SS with every part at its maximum', () => {
        expect(parseClockTime("23:59:59")).toEqual({ hours: 23, minutes: 59, seconds: 59 });
    });
});

// parseIsoDateTime is the absolute form DateTimeField and the table's date-time
// cell editor share. Every row is DateTimeField.parseRaw's own absolute-form
// behaviour, asserted on the helper it now delegates to.
describe('parseIsoDateTime', () => {
    it('accepts a date and an H:MM time, at zero seconds', () => {
        expect(parseIsoDateTime("2025-06-15 14:30")).toEqual(new Date(2025, 5, 15, 14, 30, 0));
    });

    it('accepts a date and an H:MM:SS time, keeping the seconds', () => {
        expect(parseIsoDateTime("2025-06-15 14:30:05")).toEqual(new Date(2025, 5, 15, 14, 30, 5));
    });

    it('ignores surrounding whitespace and a run of separating whitespace', () => {
        expect(parseIsoDateTime("  2025-06-15   14:30  ")).toEqual(new Date(2025, 5, 15, 14, 30, 0));
    });

    it('accepts an unpadded hour and minute, exactly as parseClockTime does', () => {
        expect(parseIsoDateTime("2025-06-15 9:5")).toEqual(new Date(2025, 5, 15, 9, 5, 0));
    });

    it('rejects a date with no time', () => {
        expect(parseIsoDateTime("2025-06-15")).toBe(null);
    });

    it('rejects a T separator', () => {
        expect(parseIsoDateTime("2025-06-15T14:30")).toBe(null);
    });

    it('rejects a UTC-suffixed time', () => {
        expect(parseIsoDateTime("2025-06-15 14:30Z")).toBe(null);
    });

    it('rejects trailing text after the time', () => {
        expect(parseIsoDateTime("2025-06-15 14:30 extra")).toBe(null);
    });

    it('rejects an impossible day in the date part', () => {
        expect(parseIsoDateTime("2025-02-30 10:00")).toBe(null);
    });

    it('rejects an out-of-range hour in the time part', () => {
        expect(parseIsoDateTime("2025-06-15 25:00")).toBe(null);
    });

    it('rejects the empty string', () => {
        expect(parseIsoDateTime("")).toBe(null);
    });
});

// formatIsoDate is the inverse of parseIsoDate, so every row also parses its own
// output back. A year of 0–99 is built with setFullYear, because the Date
// constructor maps such a year to 1900–1999.
describe('formatIsoDate', () => {
    /** The local midnight of `day` `month` (0-based) `year`, for any year. */
    function localDate(year: number, month: number, day: number): Date {
        const d = new Date(2000, 0, 1);

        d.setFullYear(year, month, day);

        return d;
    }

    it('formats 16 Sep 2026 as "2026-09-16", which parses back to it', () => {
        const d = localDate(2026, 8, 16);

        expect(formatIsoDate(d)).toBe("2026-09-16");
        expect(parseIsoDate(formatIsoDate(d))).toEqual(d);
    });

    it('zero-pads the month and the day: 7 Jun 2025 is "2025-06-07"', () => {
        const d = localDate(2025, 5, 7);

        expect(formatIsoDate(d)).toBe("2025-06-07");
        expect(parseIsoDate(formatIsoDate(d))).toEqual(d);
    });

    it('zero-pads a three-digit year: 1 Jan 999 is "0999-01-01", which parses back to it', () => {
        const d = localDate(999, 0, 1);

        expect(formatIsoDate(d)).toBe("0999-01-01");
        expect(parseIsoDate(formatIsoDate(d))).toEqual(d);
    });

    it('zero-pads a two-digit year: 1 Jan, year 50 is "0050-01-01", which parses back to it', () => {
        const d = localDate(50, 0, 1);

        expect(formatIsoDate(d)).toBe("0050-01-01");
        expect(parseIsoDate(formatIsoDate(d))).toEqual(d);
    });

    it('zero-pads the year 0 to "0000-01-01", which parses back to it', () => {
        const d = localDate(0, 0, 1);

        expect(formatIsoDate(d)).toBe("0000-01-01");
        expect(parseIsoDate(formatIsoDate(d))).toEqual(d);
    });

    it('keeps a negative year\'s sign ahead of the padded digits: year -1 is "-0001-01-01"', () => {
        const d = localDate(-1, 0, 1);

        expect(formatIsoDate(d)).toBe("-0001-01-01");
        // Outside the four-digit year range parseIsoDate reads.
        expect(parseIsoDate(formatIsoDate(d))).toBe(null);
    });

    it('writes a five-digit year unpadded: 1 Jan 10026 is "10026-01-01"', () => {
        const d = localDate(10026, 0, 1);

        expect(formatIsoDate(d)).toBe("10026-01-01");
        // Outside the four-digit year range parseIsoDate reads.
        expect(parseIsoDate(formatIsoDate(d))).toBe(null);
    });
});
