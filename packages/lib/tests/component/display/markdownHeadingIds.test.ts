// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect } from 'vitest';
import type { Tokens } from 'marked';
import { lexMarkdown } from '~/component/display/markdownExtensions';
import { headingSlug, headingSlugSource, slugify } from '~/component/display/markdownHeadingIds';

/**
 * The inline tokens of the heading a one-line source holds.
 *
 * @param source - A heading's Markdown.
 * @returns Its inline tokens.
 */
function inlineTokensOf(source: string): Tokens.Generic[] {
    const heading = lexMarkdown(source).find((token) => token.type === 'heading') as Tokens.Heading;

    return heading.tokens as Tokens.Generic[];
}

describe('slugify', () => {
    it('H1: lowercases, turns each run of other characters into one hyphen and trims the ends', () => {
        expect(slugify('  Some -- Heading! ')).toBe('some-heading');
    });
});

describe('headingSlugSource', () => {
    it.each([
        ['H2', '# a &amp; b', 'a & b'],
        ['H3', '# a \\&amp; b', 'a &amp; b'],
        ['H4', '# <kbd>&copy;</kbd> x', '<kbd>&copy;</kbd> x'],
        ['H5', '# `&copy;` x', '`&copy;` x'],
        ['H6', '# **a &amp; b**', '**a & b**'],
        ['H7', '# [a &amp; b](/f&ouml; "t&amp;")', '[a & b](/fö "t&")'],
        ['H8', '# [](/f&ouml;)', '[](/fö)'],
        ['H9', '# <https://a.test/?q&amp;x>', '<https://a.test/?q&amp;x>'],
    ])('%s: %s reads as %j', (_id, source, expected) => {
        expect(headingSlugSource(inlineTokensOf(source))).toBe(expected);
    });
});

describe('headingSlug', () => {
    it('H10: gives a heading and its spelling with a character instead of a reference one slug', () => {
        expect(headingSlug(inlineTokensOf('# Terms &amp; Conditions'))).toBe('terms-conditions');
        expect(headingSlug(inlineTokensOf('# Terms & Conditions'))).toBe('terms-conditions');
        expect(headingSlug(inlineTokensOf('# Terms \\& Conditions'))).toBe('terms-conditions');
    });
});
