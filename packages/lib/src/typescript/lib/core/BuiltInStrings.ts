// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Framework-internal table of the strings the library itself shows or
// announces, shared by every component that reads one. Page-wide state held
// here rather than on `Body` so a component can read it without constructing
// the `Body` singleton; `Body.setStrings` is the public way in.

/**
 * The strings the library itself shows or announces, which an application can
 * replace — for another language, say — through the `strings` option of
 * `Body.init`. Holds only the strings that have been moved here.
 */
export interface BuiltInStrings {

    /** Accessible name and tooltip of a `Dialog`'s title-bar close button. Default `"Close"`. */
    dialogClose: string;
}

/** The library's own wording for every built-in string. */
const DEFAULT_STRINGS: BuiltInStrings = {
    dialogClose: "Close",
};

/** The application's overrides, which `Body.setStrings` writes. */
let _appStrings: Partial<BuiltInStrings> = {};

/**
 * Returns one built-in string: the application's override when it set a
 * non-empty one, else the library's default.
 *
 * @param key - Which built-in string to read.
 *
 * @returns The string in effect.
 */
export function getBuiltInString(key: keyof BuiltInStrings): string {
    const override = _appStrings[key];

    // An empty override would leave an icon-only control with no name.
    return override ? override : DEFAULT_STRINGS[key];
}

/**
 * Returns the full table in effect: the library's defaults with the
 * application's overrides applied.
 *
 * @returns A new object holding every built-in string.
 */
export function getAppBuiltInStrings(): BuiltInStrings {
    return {
        dialogClose: getBuiltInString("dialogClose"),
    };
}

/**
 * Replaces the application's whole set of overrides.
 *
 * @param strings - The overrides; keys left out fall back to the library's
 *   default. Copied, so later changes to the argument have no effect.
 */
export function setAppBuiltInStrings(strings: Partial<BuiltInStrings>): void {
    _appStrings = { ...strings };
}
