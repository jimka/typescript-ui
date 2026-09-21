// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * A unit accepted by the relative date/time shorthand grammar. `mo` (month)
 * and `mi` (minute) are two letters on purpose — a bare `m` would be
 * ambiguous between the two, so `m` alone is not a unit.
 *
 * @internal — not re-exported from the package barrel.
 */
export type DateMathUnit = "y" | "mo" | "w" | "d" | "h" | "mi" | "s";

/**
 * One `[sign]digits+unit` term of a shorthand expression, already resolved
 * to a signed amount.
 *
 * @internal — not re-exported from the package barrel.
 */
export interface DateMathToken {
    amount: number;
    unit:   DateMathUnit;
}

// The seven unit suffixes as a regex alternation, shared by the two patterns
// below so the accepted set is declared exactly once. Two-letter units come
// first: `mo` and `mi` must be tried before the single-letter class.
const UNIT_ALTERNATION = "mo|mi|[ywdhs]";

// Full-match guard: one or more `[sign]digits+unit` tokens separated by
// optional whitespace, with nothing left over.
const DATE_MATH_SYNTAX = new RegExp(`^(?:[+-]?\\d+(?:${UNIT_ALTERNATION})\\s*)+$`, "i");

// Token extractor, run only after DATE_MATH_SYNTAX has accepted the string.
const DATE_MATH_TOKEN = new RegExp(`([+-]?)(\\d+)(${UNIT_ALTERNATION})`, "gi");

// Days in a week. Named because `w` is applied through setDate rather than a
// dedicated native setter — there is no `setWeek`.
const DAYS_PER_WEEK = 7;

/**
 * Tokenizes a relative date/time shorthand expression such as `+9y` or
 * `-2w3d`. The whole trimmed string must be consumed by one or more
 * `[sign]digits+unit` terms, or the expression is rejected outright.
 *
 * @param raw - The raw text typed into the field.
 * @param allowed - The units this field accepts; any other unit rejects the
 *   whole expression.
 * @returns The ordered tokens, or `null` when `raw` is not a fully-matching
 *   expression over `allowed`.
 *
 * @internal — not re-exported from the package barrel.
 */
export function tokenizeDateMath(raw: string, allowed: readonly DateMathUnit[]): DateMathToken[] | null {
    const text = raw.trim();

    if (!DATE_MATH_SYNTAX.test(text)) {
        return null;
    }

    const tokens: DateMathToken[] = [];

    for (const match of text.matchAll(DATE_MATH_TOKEN)) {
        const unit   = match[3].toLowerCase() as DateMathUnit;
        const amount = Number(match[2]);

        if (!allowed.includes(unit)) {
            return null;
        }

        tokens.push({ amount: match[1] === "-" ? -amount : amount, unit });
    }

    return tokens;
}

/**
 * Folds `tokens` left-to-right onto a clone of `base`, applying each one
 * through the matching native `Date` setter. Native month/year rollover
 * (e.g. 31 January + 1 month landing on 3 March) is kept, not clamped.
 *
 * @param base - The starting instant; not mutated.
 * @param tokens - The ordered tokens to apply.
 * @returns A new `Date` with every token applied. May be an Invalid Date on
 *   overflow.
 *
 * @internal — not re-exported from the package barrel.
 */
export function applyDateMath(base: Date, tokens: readonly DateMathToken[]): Date {
    const result = new Date(base.getTime());

    for (const token of tokens) {
        switch (token.unit) {
            case "y":
                result.setFullYear(result.getFullYear() + token.amount);
                break;

            case "mo":
                result.setMonth(result.getMonth() + token.amount);
                break;

            case "w":
                result.setDate(result.getDate() + token.amount * DAYS_PER_WEEK);
                break;

            case "d":
                result.setDate(result.getDate() + token.amount);
                break;

            case "h":
                result.setHours(result.getHours() + token.amount);
                break;

            case "mi":
                result.setMinutes(result.getMinutes() + token.amount);
                break;

            case "s":
                result.setSeconds(result.getSeconds() + token.amount);
                break;
        }
    }

    return result;
}

/**
 * Tokenizes `raw` and applies the result onto `base`, rejecting both a
 * non-matching expression and an out-of-range result. The one function the
 * picker fields call.
 *
 * @param raw - The raw text typed into the field.
 * @param allowed - The units this field accepts.
 * @param base - The starting instant to resolve against.
 * @returns The resolved `Date`, or `null` when `raw` is not shorthand or the
 *   result overflows `Date`'s representable range.
 *
 * @internal — not re-exported from the package barrel.
 */
export function resolveDateMath(raw: string, allowed: readonly DateMathUnit[], base: Date): Date | null {
    const tokens = tokenizeDateMath(raw, allowed);

    if (tokens === null) {
        return null;
    }

    const result = applyDateMath(base, tokens);

    return isNaN(result.getTime()) ? null : result;
}

// A complete, zero-padded ISO calendar date — the only absolute form the date
// fields format, and therefore the only one they read back.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A wall-clock time parsed from "H:MM" or "H:MM:SS" text. Each part is only
 * range-checked, not rounded, so a fractional second typed as "05.5" arrives
 * here intact; the native `setHours` the callers hand it to truncates it, so
 * the sub-second part is dropped rather than kept.
 *
 * @internal — not re-exported from the package barrel.
 */
export interface ClockTime {
    hours:   number;
    minutes: number;
    seconds: number;
}

// ISO 8601 writes a calendar year as four digits, and ISO_DATE above reads
// back exactly four, so a shorter year is zero-padded to that width.
const ISO_YEAR_DIGITS = 4;

// ISO 8601 writes the month and the day as two digits each.
const ISO_MONTH_DAY_DIGITS = 2;

/**
 * Formats the local calendar date of `date` as `YYYY-MM-DD` — the inverse of
 * {@link parseIsoDate}. The year is zero-padded to four digits, so the year
 * 999 reads `0999`; a negative year keeps its sign ahead of the padded digits
 * (`-0001`).
 *
 * @param date - The date to format; only its local calendar date is read.
 * @returns The `YYYY-MM-DD` text.
 *
 * @internal — not re-exported from the package barrel.
 */
export function formatIsoDate(date: Date): string {
    const year = date.getFullYear();
    const sign = year < 0 ? "-" : "";
    const yyyy = sign + String(Math.abs(year)).padStart(ISO_YEAR_DIGITS, "0");
    // getMonth() is zero-based; an ISO month starts at 1.
    const mm   = String(date.getMonth() + 1).padStart(ISO_MONTH_DAY_DIGITS, "0");
    const dd   = String(date.getDate()).padStart(ISO_MONTH_DAY_DIGITS, "0");

    return `${yyyy}-${mm}-${dd}`;
}

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
 * Parses an `H:MM` or `H:MM:SS` wall-clock time. Hours, minutes and seconds
 * need not be zero-padded, but each must be a number inside its own range and
 * the minutes are mandatory.
 *
 * @param raw - The raw text typed into the field.
 * @returns The parsed wall-clock time, or `null` when `raw` is not one.
 *
 * @internal — not re-exported from the package barrel.
 */
export function parseClockTime(raw: string): ClockTime | null {
    const [hStr, mStr, sStr] = raw.split(":");
    const hours   = Number(hStr);
    const minutes = Number(mStr);
    const seconds = sStr === undefined ? 0 : Number(sStr);

    const hasMinutes = mStr !== undefined && mStr !== "";
    const validHour  = !isNaN(hours)   && hours   >= 0 && hours   < 24;
    const validMin   = !isNaN(minutes) && minutes >= 0 && minutes < 60;
    const validSec   = !isNaN(seconds) && seconds >= 0 && seconds < 60;

    if (!hasMinutes || !validHour || !validMin || !validSec) {
        return null;
    }

    return { hours, minutes, seconds };
}

/**
 * Parses a `YYYY-MM-DD H:MM[:SS]` date-time: exactly two whitespace-separated
 * parts, the first read by {@link parseIsoDate} and the second by
 * {@link parseClockTime}. Surrounding whitespace is ignored. A date alone, a
 * `T` separator, or anything after the time is rejected.
 *
 * @param raw - The raw typed text.
 * @returns The local date-time, or `null` when `raw` is not one.
 *
 * @internal — not re-exported from the package barrel.
 */
export function parseIsoDateTime(raw: string): Date | null {
    const parts = raw.trim().split(/\s+/);

    // A date part and a time part, nothing more.
    if (parts.length !== 2) {
        return null;
    }

    const date = parseIsoDate(parts[0]);
    const time = parseClockTime(parts[1]);

    if (date === null || time === null) {
        return null;
    }

    date.setHours(time.hours, time.minutes, time.seconds, 0);

    return date;
}
