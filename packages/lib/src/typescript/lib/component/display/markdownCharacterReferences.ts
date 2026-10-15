// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { HTML_NAMED_CHARACTER_REFERENCES } from "~/component/display/htmlNamedCharacterReferences.js";

/**
 * A character reference as CommonMark reads one, anywhere in a text: `&`, then
 * `#` and one to seven decimal digits (capture 1), `#x` or `#X` and one to six
 * hexadecimal digits (capture 2), or a name — a letter, then one to 31 letters
 * or digits (capture 3) — then `;`. A name stands for characters only when
 * {@link HTML_NAMED_CHARACTER_REFERENCES} lists it; the digit counts and the
 * name length are CommonMark's (and `marked`'s for the numeric forms).
 */
const CHARACTER_REFERENCE = /&(?:#(\d{1,7})|#[Xx]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g;

/** {@link CHARACTER_REFERENCE} anchored at the start of the text, for the serializer's per-character check. */
const LEADING_CHARACTER_REFERENCE = /^&(?:#(\d{1,7})|#[Xx]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/;

/**
 * A backslash escape (capture 1: the escaped character) or a character
 * reference (captures 2 to 4, as {@link CHARACTER_REFERENCE}'s 1 to 3), read
 * left to right in one pass, so `\&copy;` is an escaped `&` and `copy;`, and
 * `&#92;&copy;` is a backslash and `©`. The escapable characters are
 * `marked`'s own (its `anyPunctuation` rule): Unicode punctuation and symbols.
 */
const ESCAPE_OR_CHARACTER_REFERENCE = /\\([\p{P}\p{S}])|&(?:#(\d{1,7})|#[Xx]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/gu;

/** What a numeric reference to no character (zero, a surrogate, or past U+10FFFF) stands for, per CommonMark. */
const REPLACEMENT_CHARACTER = "\uFFFD";

/** The highest Unicode code point. */
const LAST_CODE_POINT = 0x10ffff;

/** The first and last UTF-16 surrogate code points, which no numeric reference may name. */
const FIRST_SURROGATE = 0xd800;
const LAST_SURROGATE = 0xdfff;

/**
 * The characters one matched reference stands for.
 *
 * @param reference - The reference as written.
 * @param decimal - Its decimal digits, when it is a decimal reference.
 * @param hex - Its hexadecimal digits, when it is a hexadecimal reference.
 * @param name - Its name, when it is a named reference.
 * @returns The characters, or `reference` itself for a name the list does not hold.
 */
function referencedCharacters(reference: string, decimal: string | undefined, hex: string | undefined, name: string | undefined): string {
    if (name !== undefined) {
        return HTML_NAMED_CHARACTER_REFERENCES.get(name) ?? reference;
    }

    const code = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex!, 16);
    const named = code !== 0 && code <= LAST_CODE_POINT && (code < FIRST_SURROGATE || code > LAST_SURROGATE);

    return named ? String.fromCodePoint(code) : REPLACEMENT_CHARACTER;
}

/**
 * Reads every character reference in a run of Markdown text as the
 * characters it stands for: `&copy;` and `&#169;` as `©`. A name the HTML
 * list does not hold (`&notaname;`), a name without its `;` (`&copy`) and a
 * number with too many digits stay as written.
 *
 * @param text - The text as written.
 * @returns The text as read.
 */
export function decodeCharacterReferences(text: string): string {
    return text.replace(CHARACTER_REFERENCE, referencedCharacters);
}

/**
 * Reads a link destination, a link title or a code fence's info string as
 * CommonMark does: backslash escapes and character references together, in
 * one pass from the left.
 *
 * @param text - The destination, title or info string as written, its
 *   escapes still in it.
 * @returns It as read.
 */
export function decodeEscapesAndCharacterReferences(text: string): string {
    return text.replace(ESCAPE_OR_CHARACTER_REFERENCE, (match, escaped: string | undefined, decimal: string | undefined, hex: string | undefined, name: string | undefined) => (
        escaped !== undefined ? escaped : referencedCharacters(match, decimal, hex, name)
    ));
}

/**
 * Tells whether the text starts with a character reference that would be
 * read as other characters: a numeric one, or a name the HTML list holds.
 *
 * @param text - The text, from the `&` on.
 * @returns `true` when a save must escape that `&` to keep the text as typed.
 */
export function startsWithCharacterReference(text: string): boolean {
    const match = LEADING_CHARACTER_REFERENCE.exec(text);

    return match !== null && (match[3] === undefined || HTML_NAMED_CHARACTER_REFERENCES.has(match[3]));
}

/**
 * Puts a backslash before every `&` that starts a character reference, so a
 * link destination or title written with it reads back as the text it was.
 *
 * @param text - The destination or title as the editor holds it.
 * @returns It with each such `&` escaped.
 */
export function escapeCharacterReferences(text: string): string {
    return text.replace(CHARACTER_REFERENCE, (match, _decimal: string | undefined, _hex: string | undefined, name: string | undefined) => (
        name === undefined || HTML_NAMED_CHARACTER_REFERENCES.has(name) ? "\\" + match : match
    ));
}
