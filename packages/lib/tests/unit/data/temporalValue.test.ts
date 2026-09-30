// Every expected Date is built with the local constructor and every expected
// offset is derived from getTimezoneOffset(), so each case holds in any host
// time zone. The TZ= runs in the plan's checkpoint are what prove it.
import { describe, it, expect } from 'vitest';
import {
    timeOfDay,
    parseIsoTimeOfDay,
    parseLocalTemporal,
    toLocalIsoString,
    formatWireTemporal,
    stringifyWithLocalDates,
} from '~/data/temporalValue';

/** Never a finite time value. */
const INVALID = new Date(NaN);

/**
 * The `±HH:MM` offset `date` has in the host zone, derived from
 * `getTimezoneOffset()` (positive west of UTC, hence the inverted sign).
 *
 * @param date - The date whose local offset to spell.
 * @returns The offset text, `+00:00` at UTC.
 */
function expectedOffset(date: Date): string {
    const east  = -date.getTimezoneOffset();
    const sign  = east >= 0 ? '+' : '-';
    const abs   = Math.abs(east);
    const hours = String(Math.floor(abs / 60)).padStart(2, '0');
    const mins  = String(abs % 60).padStart(2, '0');

    return `${sign}${hours}:${mins}`;
}

/**
 * 1 January of `year`, local midnight. Built through `setFullYear` because the
 * `Date` constructor maps a year from 0 to 99 onto 1900-1999.
 *
 * @param year - The full year, any sign.
 * @returns The local-midnight `Date`.
 */
function newYearsDay(year: number): Date {
    const date = new Date(2026, 0, 1);
    date.setFullYear(year);

    return date;
}

describe('timeOfDay', () => {
    it('puts the time on 1 January 1970, local', () => {
        expect(timeOfDay(9, 30, 15, 250)).toEqual(new Date(1970, 0, 1, 9, 30, 15, 250));
    });

    it('defaults the milliseconds to 0', () => {
        expect(timeOfDay(9, 30, 15)).toEqual(new Date(1970, 0, 1, 9, 30, 15, 0));
    });
});

describe('parseIsoTimeOfDay', () => {
    it('reads HH:MM', () => {
        expect(parseIsoTimeOfDay('09:30')).toEqual(new Date(1970, 0, 1, 9, 30, 0, 0));
    });

    it('reads HH:MM:SS.fraction to the millisecond, right-padding the fraction', () => {
        expect(parseIsoTimeOfDay('09:30:15.25')).toEqual(new Date(1970, 0, 1, 9, 30, 15, 250));
    });

    it('cuts a microsecond fraction to milliseconds rather than rounding it', () => {
        expect(parseIsoTimeOfDay('09:30:15.123456')).toEqual(new Date(1970, 0, 1, 9, 30, 15, 123));
        expect(parseIsoTimeOfDay('09:30:15.999999')).toEqual(new Date(1970, 0, 1, 9, 30, 15, 999));
    });

    it('reads HH:MM:SS with no fraction', () => {
        expect(parseIsoTimeOfDay('23:59:59')).toEqual(new Date(1970, 0, 1, 23, 59, 59, 0));
    });

    it('rejects an hour of 24', () => {
        expect(parseIsoTimeOfDay('24:00:00')).toBe(null);
    });

    it('rejects a minute or a second of 60', () => {
        expect(parseIsoTimeOfDay('09:60')).toBe(null);
        expect(parseIsoTimeOfDay('09:30:60')).toBe(null);
    });

    it('rejects a one-digit hour', () => {
        expect(parseIsoTimeOfDay('9:30')).toBe(null);
    });

    it('rejects a time with a UTC offset', () => {
        expect(parseIsoTimeOfDay('09:30:00+02')).toBe(null);
    });

    it('rejects a fraction with no seconds, and an empty fraction', () => {
        expect(parseIsoTimeOfDay('09:30.5')).toBe(null);
        expect(parseIsoTimeOfDay('09:30:15.')).toBe(null);
    });
});

describe('parseLocalTemporal', () => {
    it('reads a bare date as local midnight for date and datetime', () => {
        expect(parseLocalTemporal('date', '2026-06-28')).toEqual(new Date(2026, 5, 28));
        expect(parseLocalTemporal('datetime', '2026-06-28')).toEqual(new Date(2026, 5, 28));
    });

    it('returns null for anything but a complete, real calendar day', () => {
        expect(parseLocalTemporal('date', '2026-02-30')).toBe(null);
        expect(parseLocalTemporal('date', '2026-06-28T00:00:00Z')).toBe(null);
        expect(parseLocalTemporal('datetime', '2026-06-28T12:04')).toBe(null);
    });

    it('reads a time of day onto 1 January 1970 for time', () => {
        expect(parseLocalTemporal('time', '09:30')).toEqual(timeOfDay(9, 30, 0));
    });
});

describe('toLocalIsoString', () => {
    it('writes the local wall clock followed by the local offset', () => {
        const date = new Date(2026, 5, 28, 12, 4, 59, 123);
        const text = toLocalIsoString(date);

        expect(text.startsWith('2026-06-28T12:04:59.123')).toBe(true);
        expect(text).toBe(`2026-06-28T12:04:59.123${expectedOffset(date)}`);
    });

    it('never writes Z, even at a zero offset', () => {
        const date = new Date(2026, 5, 28, 12, 4, 59, 123);

        expect(toLocalIsoString(date).endsWith('Z')).toBe(false);
        expect(toLocalIsoString(date)).toMatch(/[+-]\d{2}:\d{2}$/);
    });

    it('names the same instant as toISOString', () => {
        const date = new Date(2026, 5, 28, 12, 4, 59, 123);

        expect(new Date(toLocalIsoString(date)).getTime()).toBe(date.getTime());
    });

    it.each([
        [2026,  '2026-01-01T00:00:00.000'],
        [999,   '0999-01-01T00:00:00.000'],
        [0,     '0000-01-01T00:00:00.000'],
        [10000, '+010000-01-01T00:00:00.000'],
        [-1,    '-000001-01-01T00:00:00.000'],
    ])('writes the year %i as %s', (year, prefix) => {
        const date = newYearsDay(year);

        expect(toLocalIsoString(date)).toBe(prefix + expectedOffset(date));
    });
});

describe('formatWireTemporal', () => {
    it('writes a date as its local calendar day', () => {
        expect(formatWireTemporal('date', new Date(2026, 5, 28))).toBe('2026-06-28');
    });

    it('writes a date outside 0000-9999 in the expanded year form', () => {
        expect(formatWireTemporal('date', newYearsDay(10000))).toBe('+010000-01-01');
        expect(formatWireTemporal('date', newYearsDay(-1))).toBe('-000001-01-01');
        expect(formatWireTemporal('date', newYearsDay(999))).toBe('0999-01-01');
    });

    it('writes a time as its local wall clock to the millisecond', () => {
        expect(formatWireTemporal('time', new Date(1970, 0, 1, 9, 30, 15, 250))).toBe('09:30:15.250');
    });

    it('writes datetime, any other type and no type as toLocalIsoString', () => {
        const date = new Date(2026, 5, 28, 12, 4, 59, 123);

        expect(formatWireTemporal('datetime', date)).toBe(toLocalIsoString(date));
        expect(formatWireTemporal('auto', date)).toBe(toLocalIsoString(date));
        expect(formatWireTemporal('string', date)).toBe(toLocalIsoString(date));
        expect(formatWireTemporal(undefined, date)).toBe(toLocalIsoString(date));
    });

    it('writes an Invalid Date as null for every type', () => {
        expect(formatWireTemporal('date', INVALID)).toBe(null);
        expect(formatWireTemporal('time', INVALID)).toBe(null);
        expect(formatWireTemporal('datetime', INVALID)).toBe(null);
        expect(formatWireTemporal(undefined, INVALID)).toBe(null);
    });
});

describe('stringifyWithLocalDates', () => {
    it('writes a top-level property Date as toLocalIsoString and leaves the rest alone', () => {
        const date = new Date(2026, 5, 28);

        expect(JSON.parse(stringifyWithLocalDates({ d: date, n: 1, s: 'x', nil: null })))
            .toEqual({ d: toLocalIsoString(date), n: 1, s: 'x', nil: null });
    });

    it('converts a Date nested inside an array', () => {
        const date = new Date(2026, 5, 28);
        const text = stringifyWithLocalDates([{ type: 'and', filters: [{ value: [date, 3] }] }]);

        expect(JSON.parse(text)).toEqual([{ type: 'and', filters: [{ value: [toLocalIsoString(date), 3] }] }]);
    });

    it('writes an Invalid Date as null', () => {
        expect(stringifyWithLocalDates({ d: INVALID })).toBe('{"d":null}');
    });

    it('writes a bare Date as a JSON string', () => {
        const date = new Date(2026, 5, 28);

        expect(stringifyWithLocalDates(date)).toBe(JSON.stringify(toLocalIsoString(date)));
    });

    it('stringifies a value with no Date exactly as JSON.stringify does', () => {
        const value = [{ type: 'eq', field: 'name', value: 'Bob' }, { n: 1.5, b: true, u: undefined, a: [null] }];

        expect(stringifyWithLocalDates(value)).toBe(JSON.stringify(value));
    });
});
