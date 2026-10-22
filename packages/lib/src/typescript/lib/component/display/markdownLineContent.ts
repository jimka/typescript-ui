// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/** A character that is no ASCII whitespace: a space, tab, line break, form feed or vertical tab. */
const NOT_ASCII_WHITESPACE = /[^ \t\r\n\f\v]/;

/**
 * Tells whether a text holds content at the end of a line of inline content,
 * where `marked` strips ASCII whitespace and a hard break after the last
 * content is no break. A no-break space or any other non-ASCII space is
 * content: `marked` keeps it. The editor's typing rules and the serializer
 * both ask this, so the editor and its save agree on which line breaks stay.
 *
 * @param text - A run of text.
 * @returns `true` when it holds a character other than ASCII whitespace.
 */
export function holdsLineContent(text: string): boolean {
    return NOT_ASCII_WHITESPACE.test(text);
}
