// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** The highest C0 control character code; a link destination holding one must be written in angle brackets. */
const LAST_C0_CONTROL = 0x1f;

/** The delete control character's code. */
const DELETE_CHARACTER = 0x7f;

/**
 * Tells whether a destination character forces the `<…>` form: any
 * whitespace (`marked` splits a bare destination at it and trims it from the
 * ends, a Unicode space such as the no-break space included), `<`, `>`, a
 * parenthesis, a backslash, or a control character. Both writers of a link
 * destination, the editor's save and source mode's link command, ask this.
 *
 * @param char - One character of the URL.
 * @returns `true` when a bare destination cannot hold it.
 */
export function needsAngleBrackets(char: string): boolean {
    const code = char.charCodeAt(0);

    return /\s/.test(char) || "<>()\\".includes(char) || code <= LAST_C0_CONTROL || code === DELETE_CHARACTER;
}
