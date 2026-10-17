// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect } from 'vitest';
import { lexMarkdown } from '~/component/display/markdownExtensions';
import { CORPUS } from '../markdown-roundtrip/corpus';
import { HTML_NAMED_CHARACTER_REFERENCES } from '~/component/display/htmlNamedCharacterReferences';
import {
    characterReferencePieces, decodeCharacterReferences, decodeEscapesAndCharacterReferences, escapeCharacterReferences, startsWithCharacterReference,
} from '~/component/display/markdownCharacterReferences';

describe('HTML_NAMED_CHARACTER_REFERENCES', () => {
    it('CR1. holds the 2,125 names of the WHATWG list that end in ";", spelled as the list spells them', () => {
        expect(HTML_NAMED_CHARACTER_REFERENCES.size).toBe(2125);
        expect(HTML_NAMED_CHARACTER_REFERENCES.get('copy')).toBe('\u00A9');
        expect(HTML_NAMED_CHARACTER_REFERENCES.get('COPY')).toBe('\u00A9');
        expect(HTML_NAMED_CHARACTER_REFERENCES.has('Copy')).toBe(false);
        expect(HTML_NAMED_CHARACTER_REFERENCES.get('ngE')).toBe('\u2267\u0338');
        expect(HTML_NAMED_CHARACTER_REFERENCES.get('Afr')).toBe('\u{1D504}');
        expect(HTML_NAMED_CHARACTER_REFERENCES.get('fjlig')).toBe('fj');
        expect(HTML_NAMED_CHARACTER_REFERENCES.has('toString')).toBe(false);
    });
});

describe('decodeCharacterReferences', () => {
    it.each([
        ['CR2', '&copy; &amp; &AElig; &ngE; &CounterClockwiseContourIntegral;', '\u00A9 & \u00C6 \u2267\u0338 \u2233'],
        ['CR3', '&#35; &#x41; &#X22; &#0; &#xD800; &#1114112;', '# A " \uFFFD \uFFFD \uFFFD'],
        ['CR4', '&notaname; &copy &copyx; &Copy; &toString; &hi?;', '&notaname; &copy &copyx; &Copy; &toString; &hi?;'],
        ['CR5', '&#12345678; &#abc; &#; &#x; &#x1234567;', '&#12345678; &#abc; &#; &#x; &#x1234567;'],
        ['CR6', '&amp;copy; &#38;copy; a&copy;b', '&copy; &copy; a\u00A9b'],
    ])('%s: %j reads as %j', (_id, text, read) => {
        expect(decodeCharacterReferences(text)).toBe(read);
    });
});

describe('decodeEscapesAndCharacterReferences', () => {
    it.each([
        ['CR7', '/f&ouml;&ouml;', '/f\u00F6\u00F6'],
        ['CR8', '/a\\&copy;', '/a&copy;'],
        ['CR9', '\\\\&copy;', '\\\u00A9'],
        ['CR10', '&#92;&copy; a\\*b \\a', '\\\u00A9 a*b \\a'],
    ])('%s: %j reads as %j', (_id, text, read) => {
        expect(decodeEscapesAndCharacterReferences(text)).toBe(read);
    });
});

describe('startsWithCharacterReference and escapeCharacterReferences', () => {
    it.each([
        ['&copy; x', true], ['&COPY;', true], ['&#35;', true], ['&#x41;', true], ['&#0;', true],
        ['&notaname;', false], ['&Copy;', false], ['&copy', false], ['&#12345678;', false], ['& copy;', false], ['x&copy;', false],
    ])('CR11: %j starts with a reference: %s', (text, starts) => {
        expect(startsWithCharacterReference(text)).toBe(starts);
    });

    it('CR12: escapes the & of each reference and of nothing else', () => {
        expect(escapeCharacterReferences('/a&copy;&b=1&#35;&notaname;&amp')).toBe('/a\\&copy;&b=1\\&#35;&notaname;&amp');
    });
});

describe('characterReferencePieces', () => {
    it('splits a reference from the characters around it', () => {
        expect(characterReferencePieces('a&#35;b')).toEqual([
            { shown: 'a', start: 0, end: 1 },
            { shown: '#', start: 1, end: 6 },
            { shown: 'b', start: 6, end: 7 },
        ]);
    });

    it('writes a name the list does not hold character by character', () => {
        const pieces = characterReferencePieces('&notaname;');

        expect(pieces).toHaveLength(10);
        expect(pieces.every((piece, at) => piece.shown === '&notaname;'[at] && piece.start === at && piece.end === at + 1)).toBe(true);
    });

    it('keeps a reference that reads as two code units as one piece', () => {
        const pieces = characterReferencePieces('x &ngE; y');

        expect(pieces).toHaveLength(5);
        expect(pieces[2]).toEqual({ shown: '\u2267\u0338', start: 2, end: 7 });
    });

    it.each([
        'plain', '&copy; &amp; &AElig; &ngE;', '&#35; &#x41; &#0; &#xD800; &#1114112;',
        '&notaname; &copy &copyx; &Copy;', '&#12345678; &#abc; &#; &#x;', '&amp;copy; &#38;copy; a&copy;b', '',
    ])('joins to what decodeCharacterReferences reads: %j', (text) => {
        expect(characterReferencePieces(text).map((piece) => piece.shown).join('')).toBe(decodeCharacterReferences(text));
    });
});

describe('characterReferencePieces over the round-trip corpus', () => {
    /**
     * Collects the `raw` of every text token in a token tree, whatever block or inline token holds it.
     *
     * @param value - A token, a list of tokens, or any value that holds them.
     * @param found - Where the `raw` texts are collected.
     */
    function collectTextRaws(value: unknown, found: string[]): void {
        if (Array.isArray(value)) {
            value.forEach((entry) => collectTextRaws(entry, found));
        } else if (typeof value === 'object' && value !== null) {
            const token = value as { type?: unknown; raw?: unknown };

            if (token.type === 'text' && typeof token.raw === 'string') {
                found.push(token.raw);
            }

            Object.values(value).forEach((entry) => collectTextRaws(entry, found));
        }
    }

    it('joins to what decodeCharacterReferences reads, for the raw text of every text token', () => {
        const raws: string[] = [];

        CORPUS.forEach((entry) => collectTextRaws(lexMarkdown(entry.source.replace(/\r\n?/g, '\n')), raws));

        const differing = raws.filter((raw) => characterReferencePieces(raw).map((piece) => piece.shown).join('') !== decodeCharacterReferences(raw));

        expect(raws.length).toBeGreaterThan(1_000);
        expect(differing).toEqual([]);
    });
});
