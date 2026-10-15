// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Longest pause, in milliseconds, between two type-ahead key presses that
 * still belong to one search. It is the type-ahead window of the native
 * `<select>` the library's list replaces: letters typed inside it build one
 * prefix, and a longer pause starts a new search.
 *
 * @internal Not barrel-exported.
 */
export const TYPE_AHEAD_TIMEOUT_MS = 700;

/**
 * The rows one type-ahead search runs over, in display order.
 *
 * @internal Not barrel-exported.
 */
export interface TypeAheadRows {
    /** How many rows there are. */
    count:      number;
    /** Index of the current row, or `-1` when there is none. */
    current:    number;
    /** Returns the label of the row at `index`. */
    labelAt:    (index: number) => string;
    /** Returns whether the search may land on the row at `index`. */
    isEligible: (index: number) => boolean;
}

/**
 * Whether a key press is a type-ahead character: one printable character
 * other than Space, pressed without `Control`, `Meta` or `Alt`. `Shift` is
 * allowed, since it types capitals and symbols. A named key (`"Enter"`,
 * `"ArrowDown"`, `"Dead"`) has a `key` longer than one character.
 *
 * @param e - The keydown to test.
 * @returns `true` when the key belongs to type-ahead.
 *
 * @internal Not barrel-exported.
 */
export function isTypeAheadKey(e: KeyboardEvent): boolean {
    return e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/**
 * One widget's type-ahead: the characters typed so far and the search they
 * run. The buffer starts again after a pause longer than
 * {@link TYPE_AHEAD_TIMEOUT_MS}, read from `Date.now()` on each key, so
 * there is no timer to cancel.
 *
 * @internal Shared by `AbstractSelectableList` and `Tree`; not barrel-exported.
 */
export class TypeAheadSearch {

    /** The characters typed in the current search, lower-cased. */
    private _buffer:    string = "";
    /** `Date.now()` at the last key, for the pause test. */
    private _lastKeyAt: number = 0;

    /**
     * Adds one typed character and finds the row to move to.
     *
     * One letter typed once or several times looks for that letter from the
     * row after the current one, so the same key steps through the rows
     * that start with it. Any other buffer is a prefix, looked for from the
     * current row itself, so a row that still matches is kept. Both searches
     * wrap past the last row and skip a row that is not eligible.
     *
     * @param ch - The character typed.
     * @param rows - The rows to search.
     * @returns The index of the row to move to, or `-1` when no row matches.
     */
    type(ch: string, rows: TypeAheadRows): number {
        const now = Date.now();

        if (now - this._lastKeyAt > TYPE_AHEAD_TIMEOUT_MS) {
            this._buffer = "";
        }

        this._buffer += ch.toLowerCase();
        this._lastKeyAt = now;

        const buffer   = this._buffer;
        const repeated = buffer.split("").every(typed => typed === buffer[0]);
        const needle   = repeated ? buffer[0] : buffer;
        const start    = repeated ? rows.current + 1 : Math.max(rows.current, 0);

        for (let step = 0; step < rows.count; step++) {
            const index   = (start + step) % rows.count;
            const matches = rows.isEligible(index) && rows.labelAt(index).toLowerCase().startsWith(needle);

            if (matches) {
                return index;
            }
        }

        return -1;
    }

    /** Empties the buffer, so the next key starts a new search. */
    clear(): void {
        this._buffer = "";
    }
}
