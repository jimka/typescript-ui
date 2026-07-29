// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractMarkerList, AbstractMarkerListOptions } from "~/component/list/AbstractMarkerList.js";
import { NumberedListItemStyle } from "~/component/list/NumberedListItemStyle.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link NumberedList}.
 *
 * @category Components
 */
export interface NumberedListOptions extends AbstractMarkerListOptions<NumberedListItemStyle> {
}

/** CSS `decimal-leading-zero` pads to a minimum of two digits and never truncates. */
const DECIMAL_MIN_DIGITS = 2;

/**
 * The largest item number roman numerals cover. CSS Counter Styles gives
 * `lower-roman` / `upper-roman` the range 1–3999 and falls back to `decimal`
 * outside it; above 3999 the additive symbol set has no notation left.
 */
const ROMAN_MAX = 3999;

/** Latin letters, in the order CSS's `lower-alpha` / `lower-latin` counts them. */
const LOWER_LATIN_LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** The 24 Greek letters CSS's `lower-greek` counts, with `σ` and no final sigma. */
const LOWER_GREEK_LETTERS = "αβγδεζηθικλμνξοπρστυφχψω";

/** Roman symbols in descending value order, subtractive pairs included. */
const ROMAN_SYMBOLS: ReadonlyArray<readonly [number, string]> = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"],
    [100,  "c"], [90,  "xc"], [50,  "l"], [40,  "xl"],
    [10,   "x"], [9,   "ix"], [5,   "v"], [4,   "iv"],
    [1,    "i"],
];

/**
 * Counts `n` in bijective base-N over `alphabet` — the "alphabetic" system CSS
 * counter styles use, where the value after the last letter is `aa`, not a wrap.
 *
 * @param n - The one-based item number to convert.
 * @param alphabet - The symbols to count over, in order.
 *
 * @returns The alphabetic representation of `n`.
 */
function alphabetic(n: number, alphabet: string): string {
    const base = alphabet.length;
    let   out  = "";
    let   rest = n;

    while (rest > 0) {
        rest -= 1;
        out   = alphabet[rest % base] + out;
        rest  = Math.floor(rest / base);
    }

    return out;
}

/**
 * Converts `n` to lowercase roman numerals, falling back to decimal past ROMAN_MAX.
 *
 * @param n - The one-based item number to convert.
 *
 * @returns The roman numeral for `n`, or its decimal form when `n` exceeds the
 * range CSS gives the predefined roman counter styles.
 */
function roman(n: number): string {
    if (n > ROMAN_MAX) {
        return String(n);
    }

    let out  = "";
    let rest = n;

    for (const [value, symbol] of ROMAN_SYMBOLS) {
        while (rest >= value) {
            out  += symbol;
            rest -= value;
        }
    }

    return out;
}

/** Every numbering style except NONE, which the caller short-circuits. */
type CountingStyle = Exclude<NumberedListItemStyle, NumberedListItemStyle.NONE>;

/**
 * The number-to-string conversion for each counting style. Typing the record
 * over CountingStyle rather than the whole enum makes it exhaustive: adding an
 * enum member becomes a compile error rather than a silent undefined lookup.
 */
const NUMBER_FORMATTERS: Record<CountingStyle, (n: number) => string> = {
    [NumberedListItemStyle.DECIMAL]:              n => String(n),
    [NumberedListItemStyle.DECIMAL_LEADING_ZERO]: n => String(n).padStart(DECIMAL_MIN_DIGITS, "0"),
    [NumberedListItemStyle.LOWER_ALPHA]:          n => alphabetic(n, LOWER_LATIN_LETTERS),
    [NumberedListItemStyle.LOWER_LATIN]:          n => alphabetic(n, LOWER_LATIN_LETTERS),
    [NumberedListItemStyle.UPPER_ALPHA]:          n => alphabetic(n, LOWER_LATIN_LETTERS).toUpperCase(),
    [NumberedListItemStyle.UPPER_LATIN]:          n => alphabetic(n, LOWER_LATIN_LETTERS).toUpperCase(),
    [NumberedListItemStyle.LOWER_GREEK]:          n => alphabetic(n, LOWER_GREEK_LETTERS),
    [NumberedListItemStyle.UPPER_GREEK]:          n => alphabetic(n, LOWER_GREEK_LETTERS).toUpperCase(),
    [NumberedListItemStyle.LOWER_ROMAN]:          n => roman(n),
    [NumberedListItemStyle.UPPER_ROMAN]:          n => roman(n).toUpperCase(),
};

/**
 * An ordered (numbered) list component.
 *
 * Renders an `<ol>` element and defaults to the DECIMAL numbering style. Every
 * member of
 * [`NumberedListItemStyle`](/api/component/list/enumerations/NumberedListItemStyle)
 * renders; `lower-alpha` / `lower-latin` are aliases of one another, as are the
 * upper pair, and the roman styles fall back to decimal above item 3999, which
 * is the range CSS gives them.
 *
 * @category Components
 */
class NumberedList extends AbstractMarkerList<NumberedListItemStyle> {

    constructor(options?: NumberedListOptions) {
        super("ol", NumberedListItemStyle.DECIMAL, options);
    }

    /**
     * Returns the marker for the item at `index` under the current style.
     *
     * @param index - The item's zero-based position in the list.
     *
     * @returns `""` under the NONE style, otherwise the one-based position
     * converted by the current style and followed by a full stop.
     */
    protected markerText(index: number): string {
        const style = this.getStyle()!;

        if (style === NumberedListItemStyle.NONE) {
            return "";
        }

        return NUMBER_FORMATTERS[style](index + 1) + ".";
    }
}

const NumberedListCallable = callable(NumberedList);
type NumberedListCallable = NumberedList;
export {
    NumberedList         as _NumberedList,
    NumberedListCallable as NumberedList
};
