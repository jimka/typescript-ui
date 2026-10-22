// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect } from 'vitest';
import { HTML_NAMED_CHARACTER_REFERENCES } from '~/component/display/htmlNamedCharacterReferences';
import {
    decodeCharacterReferences, decodeEscapesAndCharacterReferences, escapeCharacterReferences, startsWithCharacterReference,
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
