// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { FieldType } from '~/data/Field.js';
import type { TemporalFieldType } from '~/data/temporalText.js';

// A complete, zero-padded ISO calendar date — the only absolute form the date
// fields format, and therefore the only one they read back.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// `HH:MM`, `HH:MM:SS`, or `HH:MM:SS.fraction` — the forms Postgres and
// Python's isoformat() write a time of day in. Two-digit parts only: this reads
// stored values, not typed text (typed text goes through dateMath's
// parseClockTime, which also accepts `9:5`).
const ISO_TIME_OF_DAY = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/;

// Exclusive upper bound of each time-of-day part. They mirror dateMath's
// HOURS_PER_DAY / MINUTES_PER_HOUR / SECONDS_PER_MINUTE, which a data/ module
// cannot import from component/; `\d{2}` admits 99, so the range is the check
// the shape cannot carry.
const HOURS_PER_DAY      = 24;
const MINUTES_PER_HOUR   = 60;
const SECONDS_PER_MINUTE = 60;

// A `Date` holds milliseconds, so a longer fraction (Postgres and Python write
// microseconds) is cut to its first three digits and a shorter one padded.
const MILLISECOND_DIGITS = 3;

// ISO 8601 writes the month, the day, and each time part as two digits.
const TWO_DIGITS = 2;

// ISO 8601's basic year is four digits, covering 0000-9999.
const ISO_YEAR_DIGITS = 4;
const MAX_ISO_YEAR    = 9999;

// Outside 0000-9999 a year is a sign plus six digits, the expansion
// `Date.prototype.toISOString()` uses, so no year the engine holds is cut short.
const EXPANDED_YEAR_DIGITS = 6;

/**
 * Parses a complete, zero-padded `YYYY-MM-DD` calendar date at local midnight.
 * Anything the date fields' own `formatValue` could not have produced — a
 * partial prefix, an unpadded part, or a day that does not exist in the named
 * month — is rejected rather than normalised.
 *
 * @param raw - The raw text typed into the field.
 * @returns The date at local midnight, or `null` when `raw` is not a complete
 *   ISO date naming a real calendar day.
 *
 * @internal — not re-exported from the package barrel.
 */
export function parseIsoDate(raw: string): Date | null {
    const match = ISO_DATE.exec(raw);

    if (match === null) {
        return null;
    }

    // Local midnight, appended so the day is not shifted by the UTC parse
    // `new Date("YYYY-MM-DD")` would otherwise perform.
    const date = new Date(`${raw}T00:00:00`);

    if (isNaN(date.getTime())) {
        return null;
    }

    // The engine range-checks the month and the bare day but rolls an
    // impossible calendar day forward — 30 February becomes 2 March — which
    // would commit a date the text never named. A rolled date is the one case
    // the shape check above cannot see.
    return date.getDate() === Number(match[3]) ? date : null;
}

/**
 * The `Date` a time of day is held as: that wall-clock time on 1 January 1970,
 * local. Every time-of-day value in the library sits on this one date, so two
 * equal times compare equal by `getTime()`.
 *
 * @param hours - The hour, 0-23.
 * @param minutes - The minute, 0-59.
 * @param seconds - The second, 0-59.
 * @param ms - Optional. The millisecond, 0-999; defaults to `0`.
 * @returns The anchored `Date`.
 *
 * @internal — not re-exported from the package barrel.
 */
export function timeOfDay(hours: number, minutes: number, seconds: number, ms: number = 0): Date {
    // 1 January 1970 (month 0 is January): the date the time cell editor, the
    // filter row and the table's paste path already anchor a time of day to.
    return new Date(1970, 0, 1, hours, minutes, seconds, ms);
}

/**
 * Parses a stored time of day — two-digit `HH:MM[:SS[.fraction]]` — onto
 * 1 January 1970, local, to the millisecond. A fraction longer than three
 * digits is cut, not rounded. An hour of 24 or more, a minute or second of 60
 * or more, a one-digit part, or a trailing offset is rejected.
 *
 * @param raw - The stored text.
 * @returns The anchored `Date`, or `null` when `raw` is not such a time.
 *
 * @internal — not re-exported from the package barrel.
 */
export function parseIsoTimeOfDay(raw: string): Date | null {
    const match = ISO_TIME_OF_DAY.exec(raw);

    if (match === null) {
        return null;
    }

    const hours   = Number(match[1]);
    const minutes = Number(match[2]);
    // An absent seconds group is zero, so `09:30` and `09:30:00` agree.
    const seconds = match[3] === undefined ? 0 : Number(match[3]);
    const ms      = match[4] === undefined ? 0 : Number(match[4].padEnd(MILLISECOND_DIGITS, '0').slice(0, MILLISECOND_DIGITS));

    if (hours >= HOURS_PER_DAY || minutes >= MINUTES_PER_HOUR || seconds >= SECONDS_PER_MINUTE) {
        return null;
    }

    return timeOfDay(hours, minutes, seconds, ms);
}

/**
 * The local reading of a stored temporal value: a bare `YYYY-MM-DD` for a
 * `date` or `datetime` field, a time of day for a `time` field. A caller that
 * gets `null` falls back to its own reading of `raw`.
 *
 * @param type - The field type the value is stored under.
 * @param raw - The stored text.
 * @returns The local `Date`, or `null` when `raw` is not in the local form for
 *   `type`.
 *
 * @internal — not re-exported from the package barrel.
 */
export function parseLocalTemporal(type: TemporalFieldType, raw: string): Date | null {
    switch (type) {
        case 'date':
        case 'datetime':
            return parseIsoDate(raw);

        case 'time':
            return parseIsoTimeOfDay(raw);
    }
}

/**
 * Pads a non-negative whole number to two digits.
 *
 * @param value - The number to pad.
 * @returns The padded text.
 */
function pad2(value: number): string {
    return String(value).padStart(TWO_DIGITS, '0');
}

/**
 * Writes a year as ISO 8601 does: four digits from 0 to 9999, otherwise a sign
 * plus six digits, as `toISOString()` does.
 *
 * @param year - The full year.
 * @returns The year text.
 */
function formatWireYear(year: number): string {
    if (year >= 0 && year <= MAX_ISO_YEAR) {
        return String(year).padStart(ISO_YEAR_DIGITS, '0');
    }

    const sign = year < 0 ? '-' : '+';

    return sign + String(Math.abs(year)).padStart(EXPANDED_YEAR_DIGITS, '0');
}

/**
 * Writes the local calendar day of `date` as `YYYY-MM-DD`.
 *
 * @param date - A valid date.
 * @returns The date text.
 */
function formatWireDate(date: Date): string {
    // getMonth() is zero-based; an ISO month starts at 1.
    return `${formatWireYear(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Writes the local wall-clock time of `date` as `HH:MM:SS.sss`.
 *
 * @param date - A valid date.
 * @returns The time text.
 */
function formatWireTime(date: Date): string {
    const ms = String(date.getMilliseconds()).padStart(MILLISECOND_DIGITS, '0');

    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${ms}`;
}

/**
 * Writes the host's UTC offset at `date` as `±HH:MM`. Zero is `+00:00`, never
 * `Z`, so every value has the same shape.
 *
 * @param date - A valid date.
 * @returns The offset text.
 */
function formatWireOffset(date: Date): string {
    // getTimezoneOffset() is minutes *behind* UTC — positive west of it — so
    // the sign is inverted to get ISO 8601's minutes ahead.
    const east = -date.getTimezoneOffset();
    const sign = east >= 0 ? '+' : '-';
    const abs  = Math.abs(east);

    return `${sign}${pad2(Math.floor(abs / MINUTES_PER_HOUR))}:${pad2(abs % MINUTES_PER_HOUR)}`;
}

/**
 * Writes `date` as ISO 8601 in the host's local zone:
 * `YYYY-MM-DDTHH:MM:SS.sss±HH:MM`. It names the same instant as
 * `toISOString()` and also carries the calendar day and wall-clock time the
 * user saw.
 *
 * @param date - A valid date.
 * @returns The local ISO text.
 *
 * @internal — not re-exported from the package barrel.
 */
export function toLocalIsoString(date: Date): string {
    return `${formatWireDate(date)}T${formatWireTime(date)}${formatWireOffset(date)}`;
}

/**
 * Writes a `Date` in the form its field type is read back in: `YYYY-MM-DD`
 * for `date`, `HH:MM:SS.sss` for `time`, and local ISO 8601 with its offset
 * for `datetime`, any other type, or no type.
 *
 * @param type - The field type the value is stored under, if known.
 * @param date - The value to write.
 * @returns The wire text, or `null` for an Invalid Date (what `JSON.stringify`
 *   writes for one).
 *
 * @internal — not re-exported from the package barrel.
 */
export function formatWireTemporal(type: FieldType | undefined, date: Date): string | null {
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    switch (type) {
        case 'date':
            return formatWireDate(date);

        case 'time':
            return formatWireTime(date);

        default:
            return toLocalIsoString(date);
    }
}

/**
 * `JSON.stringify(value)`, except that every `Date`, at any depth, is written
 * as {@link formatWireTemporal} writes a value of no known type — local ISO
 * 8601 with its offset.
 *
 * @param value - The value to serialize.
 * @returns The JSON text.
 *
 * @internal — not re-exported from the package barrel.
 */
export function stringifyWithLocalDates(value: unknown): string {
    // A `function`, not an arrow: `JSON.stringify` calls `Date.prototype.toJSON`
    // before the replacer sees the value, so the replacer reads the original
    // `Date` back from its holder, which is `this`.
    return JSON.stringify(value, function (this: Record<string, unknown>, key: string, serialized: unknown): unknown {
        const raw = this[key];

        return raw instanceof Date ? formatWireTemporal(undefined, raw) : serialized;
    });
}
