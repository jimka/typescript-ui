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
