// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The look of the `markdown` language in `MarkdownEditor`'s source mode. Source mode shows Markdown as source
// text: colour hints at the syntax, and nothing is drawn as the Markdown viewer draws it. The look of a range is
// read offline: the language's syntax tree is highlighted with a highlighter built from the same rule list the
// editor theme uses, and each range's rules are folded into words such as `grey` or `grey italic`.

import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree, language as languageFacet } from '@codemirror/language';
import type { TagStyle } from '@codemirror/language';
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';
import type { Highlighter } from '@lezer/highlight';
import type { Tag } from '@lezer/highlight';
import type { NodeType } from '@lezer/common';
import '~/component/editor/languages';
import { getLanguage, listLanguages } from '~/component/editor/LanguageRegistry';
import {
    SYNTAX_STYLES, SYNTAX_KEYWORD, SYNTAX_STRING, SYNTAX_COMMENT, SYNTAX_LITERAL, SYNTAX_FUNCTION, SYNTAX_TYPE, SYNTAX_PROPERTY,
} from '~/component/editor/theme';
import { CORPUS } from './markdown-roundtrip/corpus';
import { readDemoEditorSample } from '../helpers/readDemoSample.mjs';

/** A range of source text and the look it is drawn in. */
type Range = [text: string, look: string];

/** The word for each palette colour. */
const COLOUR_NAMES: Readonly<Record<string, string>> = {
    [SYNTAX_KEYWORD]:  'blue',
    [SYNTAX_STRING]:   'green',
    [SYNTAX_COMMENT]:  'grey',
    [SYNTAX_LITERAL]:  'amber',
    [SYNTAX_FUNCTION]: 'violet',
    [SYNTAX_TYPE]:     'teal',
    [SYNTAX_PROPERTY]: 'pink',
};

/** The word each non-colour property adds to a look. */
const PROPERTY_WORDS: Readonly<Record<string, string>> = {
    fontWeight:     'bold',
    fontStyle:      'italic',
    textDecoration: 'underline',
    fontSize:       'sized',
};

/** One class per rule of the shared style, named by the rule's index, so a range's classes name the rules it took. */
const HIGHLIGHTER = tagHighlighter(SYNTAX_STYLES.map((rule, index) => ({ tag: rule.tag, class: String(index) })));

/**
 * Folds the rules a range took into one look: the properties of the rules merged in rule order, a later rule
 * overwriting an earlier one, written as the colour's name followed by a word for each other property.
 *
 * @param classes - The space-separated rule indexes the range took.
 * @returns The look, or `plain` when no rule set anything.
 */
function foldLook(classes: string): string {
    const merged: Record<string, string> = {};
    const indexes = classes.split(' ').map(Number).sort((a, b) => a - b);

    for (const index of indexes) {
        const { tag: _tag, ...properties } = SYNTAX_STYLES[index] as Record<string, unknown>;
        Object.assign(merged, properties);
    }

    // `inherit` hands the range the enclosing element's colour, which is the text colour: no colour word.
    const words = Object.entries(merged).filter(([property, value]) => !(property === 'color' && value === 'inherit')).map(([property, value]) => (
        property === 'color' ? (COLOUR_NAMES[value] ?? value) : PROPERTY_WORDS[property]
    ));

    return words.join(' ') || 'plain';
}

/**
 * Parses a document in a built-in language and lists the ranges a highlighter styles.
 *
 * @param doc - The source text.
 * @param languageId - The built-in language to parse it with.
 * @param highlighter - The highlighter whose classes name the rules a range took.
 * @returns Each styled range as its start, its end and the classes it took, in document order.
 */
async function highlightedRanges(doc: string, languageId: string, highlighter: Highlighter): Promise<Array<[from: number, to: number, classes: string]>> {
    const extension = await getLanguage(languageId)!.loadExtension();
    let state = EditorState.create({ doc, extensions: [extension] });

    ensureSyntaxTree(state, state.doc.length, Infinity);
    state = state.update({}).state;

    const ranges: Array<[number, number, string]> = [];

    highlightTree(syntaxTree(state), highlighter, (from, to, classes) => ranges.push([from, to, classes]));

    return ranges;
}

/**
 * Reads the look of every range of a document in a built-in language.
 *
 * @param doc - The source text.
 * @param languageId - The built-in language to parse it with.
 * @returns The document's text in order, split where the look changes.
 */
async function sourceLooks(doc: string, languageId: string = 'markdown'): Promise<Range[]> {
    const spans: Array<[from: number, to: number, look: string]> = [];
    let position = 0;

    for (const [from, to, classes] of await highlightedRanges(doc, languageId, HIGHLIGHTER)) {
        if (from > position) {
            spans.push([position, from, 'plain']);
        }

        spans.push([from, to, foldLook(classes)]);
        position = to;
    }

    if (position < doc.length) {
        spans.push([position, doc.length, 'plain']);
    }

    const joined: Array<[number, number, string]> = [];

    for (const span of spans) {
        const last = joined[joined.length - 1];

        if (last && last[2] === span[2] && last[1] === span[0]) {
            last[1] = span[1];
        } else {
            joined.push([...span]);
        }
    }

    return joined.map(([from, to, look]): Range => [doc.slice(from, to), look]);
}

describe('the markdown language in source mode', () => {
    const MARKDOWN_ROWS: ReadonlyArray<[title: string, source: string, looks: Range[]]> = [
        // Headings and emphasis.
        ['an ATX heading has a grey mark and blue text', '# MarkdownEditor',
            [['#', 'grey'], [' MarkdownEditor', 'blue']]],
        ['a second-level heading looks the same', '## Try it',
            [['##', 'grey'], [' Try it', 'blue']]],
        ['a setext heading has blue text and a grey underline', 'Setext\n===',
            [['Setext\n', 'blue'], ['===', 'grey']]],
        ['a heading holding a link and strong text is blue except for marks and the link', '# A [l](u) **b**',
            [['#', 'grey'], [' A ', 'blue'], ['[', 'grey'], ['l', 'plain'], ['](', 'grey'], ['u', 'plain'], [')', 'grey'],
                [' ', 'blue'], ['**', 'grey'], ['b', 'blue'], ['**', 'grey']]],
        ['strong text is plain between grey marks', 'A **WYSIWYG** editor',
            [['A ', 'plain'], ['**', 'grey'], ['WYSIWYG', 'plain'], ['**', 'grey'], [' editor', 'plain']]],
        ['emphasised text is plain between grey marks', 'a *Markdown* string',
            [['a ', 'plain'], ['*', 'grey'], ['Markdown', 'plain'], ['*', 'grey'], [' string', 'plain']]],
        ['strong emphasised text is plain between grey marks', '***bi***',
            [['***', 'grey'], ['bi', 'plain'], ['***', 'grey']]],

        // Links, images and references.
        ['a reference link has plain text and a plain label', '[Markdown][commonmark]',
            [['[', 'grey'], ['Markdown', 'plain'], [']', 'grey'], ['[commonmark]', 'plain']]],
        ['an inline link has plain text, URL and title between grey marks', '[a](http://x "t")',
            [['[', 'grey'], ['a', 'plain'], ['](', 'grey'], ['http://x "t"', 'plain'], [')', 'grey']]],
        ['an image has plain alt text, URL and attribute group', '![Diagram](https://placehold.co/240x120){width=240 height=120}',
            [['![', 'grey'], ['Diagram', 'plain'], ['](', 'grey'], ['https://placehold.co/240x120', 'plain'], [')', 'grey'],
                ['{width=240 height=120}', 'plain']]],
        ['an autolink has a plain URL between grey brackets', '<http://auto>',
            [['<', 'grey'], ['http://auto', 'plain'], ['>', 'grey']]],
        ['a collapsed reference has a plain empty label', '[s][]',
            [['[', 'grey'], ['s', 'plain'], [']', 'grey'], ['[]', 'plain']]],
        ['a shortcut reference has plain text between grey brackets', '[s]',
            [['[', 'grey'], ['s', 'plain'], [']', 'grey']]],
        ['a link reference definition is plain except for its grey colon', '[commonmark]: https://commonmark.org',
            [['[commonmark]', 'plain'], [':', 'grey'], [' https://commonmark.org', 'plain']]],
        ['a link reference definition with a title is plain except for its grey colon', '[lab]: /u "T"',
            [['[lab]', 'plain'], [':', 'grey'], [' /u "T"', 'plain']]],

        // Dialect constructs.
        ['a coloured span looks like text, not a link', '[coloured]{color=#cc0000}',
            [['[', 'grey'], ['coloured', 'plain'], [']', 'grey'], ['{color=#cc0000}', 'plain']]],
        ['a sized span looks like text, not a link', '[sized]{size=1.3em}',
            [['[', 'grey'], ['sized', 'plain'], [']', 'grey'], ['{size=1.3em}', 'plain']]],
        ['a span holding emphasis keeps the emphasis marks grey', '[sp *em*]{color=red}',
            [['[', 'grey'], ['sp ', 'plain'], ['*', 'grey'], ['em', 'plain'], ['*]', 'grey'], ['{color=red}', 'plain']]],
        ['a reference link followed by an attribute group reads as the grammar reads it', '[a][b]{c}',
            [['[', 'grey'], ['a', 'plain'], [']', 'grey'], ['[b]{c}', 'plain']]],
        ['underlined text is plain', '++underline++', [['++underline++', 'plain']]],
        ['struck-through text is plain', '~~strike~~', [['~~strike~~', 'plain']]],
        ['an aligned fence is plain', '::: {align=center}\nA\n:::', [['::: {align=center}\nA\n:::', 'plain']]],

        // Blocks, markers and HTML.
        ['a bullet marker is grey', '- item', [['-', 'grey'], [' item', 'plain']]],
        ['a number marker is grey', '1. one', [['1.', 'grey'], [' one', 'plain']]],
        ['a task marker is grey', '- [x] t', [['-', 'grey'], [' ', 'plain'], ['[x]', 'grey'], [' t', 'plain']]],
        ['a quote is grey throughout', '> Edit on the left', [['> Edit on the left', 'grey']]],
        ['a quote stays grey around emphasis and a link', '> q *e* [l](u)', [['> q *e* [l](u)', 'grey']]],
        ['a thematic break is grey', 'a\n\n---\n\nb', [['a\n\n', 'plain'], ['---', 'grey'], ['\n\nb', 'plain']]],
        ['a thematic break of asterisks is grey', '***', [['***', 'grey']]],
        ['an HTML comment is grey italic', '<!-- c -->', [['<!-- c -->', 'grey italic']]],
        ['an HTML comment inside link text is italic in the text colour', '[a <!-- c --> b](u)',
            [['[', 'grey'], ['a ', 'plain'], ['<!-- c -->', 'italic'], [' b', 'plain'], ['](', 'grey'], ['u', 'plain'], [')', 'grey']]],
        ['inline HTML is coloured as in the html language', 'x <span>h</span>',
            [['x <', 'plain'], ['span', 'blue'], ['>h</', 'plain'], ['span', 'blue'], ['>', 'plain']]],
        ['block HTML is coloured as in the html language', '<div class="x">\n</div>',
            [['<', 'plain'], ['div', 'blue'], [' ', 'plain'], ['class', 'pink'], ['=', 'plain'], ['"x"', 'green'],
                ['>\n</', 'plain'], ['div', 'blue'], ['>', 'plain']]],

        // Code, tables and escapes.
        ['inline code is green between grey backticks', '`**bold**`',
            [['`', 'grey'], ['**bold**', 'green'], ['`', 'grey']]],
        ['a double-backtick code span keeps its inner backticks green', '`` `code` ``',
            [['``', 'grey'], [' `code` ', 'green'], ['``', 'grey']]],
        ['a fenced code block is green between grey fences', '```\ncode\n```',
            [['```', 'grey'], ['\n', 'plain'], ['code', 'green'], ['\n', 'plain'], ['```', 'grey']]],
        ['an indented code block is green', '    indented',
            [['    ', 'plain'], ['indented', 'green']]],
        ['code as link text is plain, the link marks grey', '[`code`](u)',
            [['[`', 'grey'], ['code', 'plain'], ['`](', 'grey'], ['u', 'plain'], [')', 'grey']]],
        ['code in a heading is green', '# `c`',
            [['#', 'grey'], [' ', 'blue'], ['`', 'grey'], ['c', 'green'], ['`', 'grey']]],
        ['a character reference in link text is plain', '[&amp;](u)',
            [['[', 'grey'], ['&amp;', 'plain'], ['](', 'grey'], ['u', 'plain'], [')', 'grey']]],
        ['a character reference in a paragraph is green', 'a &amp; b',
            [['a ', 'plain'], ['&amp;', 'green'], [' b', 'plain']]],
        ['a table is plain text', '| a | b |\n| --- | --- |\n| c | d |',
            [['| a | b |\n| --- | --- |\n| c | d |', 'plain']]],
        ['an escape is plain and a character reference green', '\\* &amp;',
            [['\\* ', 'plain'], ['&amp;', 'green']]],
    ];

    it.each(MARKDOWN_ROWS)('%s', async (_title, source, looks) => {
        expect(await sourceLooks(source)).toEqual(looks);
    });

    it('draws the demo sample with plain link text, labels and URLs', async () => {
        const sample = readDemoEditorSample();
        const looks = await sourceLooks(sample);

        // The look of each character of the sample, so a part is found by where it stands in its link, not by its words.
        const lookAt: string[] = looks.flatMap(([text, look]) => Array.from({ length: text.length }, () => look));

        // Each part is given with the link it stands in: the part must be plain at that place in the sample.
        const parts: ReadonlyArray<[link: string, part: string]> = [
            ['[Markdown][commonmark]', 'Markdown'],
            ['[Markdown][commonmark]', '[commonmark]'],
            ['[commonmark]: https://commonmark.org', '[commonmark]'],
            ['[commonmark]: https://commonmark.org', 'https://commonmark.org'],
            ['![Diagram](https://placehold.co/240x120)', 'Diagram'],
            ['![Diagram](https://placehold.co/240x120)', 'https://placehold.co/240x120'],
            ['[coloured]{color=#cc0000}', 'coloured'],
            ['[sized]{size=1.3em}', 'sized'],
        ];

        for (const [link, part] of parts) {
            const start = sample.indexOf(link);

            expect(start, link).toBeGreaterThanOrEqual(0);

            const partStart = start + link.indexOf(part);

            expect(lookAt.slice(partStart, partStart + part.length), `${part} in ${link}`).toEqual(Array(part.length).fill('plain'));
        }
    });

    it('draws nothing as the viewer draws it, in any corpus document or the demo sample', async () => {
        const sources = [...CORPUS.map((corpusCase) => corpusCase.source), readDemoEditorSample()];

        for (const source of sources) {
            for (const [text, look] of await sourceLooks(source)) {
                expect(look, `${JSON.stringify(text)} in ${JSON.stringify(source)}`).not.toMatch(/bold|underline|sized/);

                // An italic range is a comment: grey italic, except inside link text, where the link rule takes the
                // colour and leaves the comment's slant (plain italic).
                if (look.includes('italic')) {
                    expect(['grey italic', 'italic'], `${JSON.stringify(text)} in ${JSON.stringify(source)}`).toContain(look);
                }
            }
        }
    });
});

/** The syntax rules before source mode became plain text, kept to measure the new colours against. */
const PREVIOUS_STYLES: readonly TagStyle[] = [
    { tag: tags.keyword,                                                    color: SYNTAX_KEYWORD },
    { tag: [tags.string, tags.special(tags.string)],                        color: SYNTAX_STRING },
    { tag: tags.comment,                                                    color: SYNTAX_COMMENT, fontStyle: 'italic' },
    { tag: [tags.number, tags.bool, tags.null],                             color: SYNTAX_LITERAL },
    { tag: [tags.definition(tags.variableName), tags.function(tags.variableName)], color: SYNTAX_FUNCTION },
    { tag: tags.typeName,                                                   color: SYNTAX_TYPE },
    { tag: [tags.propertyName, tags.attributeName],                        color: SYNTAX_PROPERTY },
    { tag: tags.tagName,                                                    color: SYNTAX_KEYWORD },
    { tag: [tags.heading, tags.heading1, tags.heading2, tags.heading3,
            tags.heading4, tags.heading5, tags.heading6],                   color: SYNTAX_KEYWORD, fontWeight: 'bold' },
    { tag: tags.strong,                                                     fontWeight: 'bold' },
    { tag: tags.emphasis,                                                   fontStyle: 'italic' },
    { tag: tags.monospace,                                                  color: SYNTAX_STRING },
    { tag: [tags.link, tags.url],                                           color: SYNTAX_KEYWORD, textDecoration: 'underline' },
    { tag: [tags.quote, tags.contentSeparator],                             color: SYNTAX_COMMENT },
    { tag: tags.processingInstruction,                                      color: SYNTAX_COMMENT },
];

/**
 * The editor's text colour and background in the light theme, then in the dark theme: the shipped themes' values
 * (`ModernTheme.ts` text `rgb(0, 0, 0)` on white, `DarkTheme.ts` text `rgb(220, 220, 220)` on `rgb(40, 40, 40)`).
 */
const THEMES: ReadonlyArray<[name: string, text: [number, number, number], background: [number, number, number]]> = [
    ['light', [0, 0, 0],       [255, 255, 255]],
    ['dark',  [220, 220, 220],    [40, 40, 40]],
];

/**
 * The WCAG relative luminance of a colour.
 *
 * @param rgb - The red, green and blue channels, 0 to 255.
 * @returns The luminance, 0 to 1.
 */
function luminance(rgb: readonly number[]): number {
    const [red, green, blue] = rgb.map((channel) => {
        const unit = channel / 255;

        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });

    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * The WCAG contrast ratio of two colours.
 *
 * @param first - The channels of one colour.
 * @param second - The channels of the other.
 * @returns The ratio, 1 to 21.
 */
function contrast(first: readonly number[], second: readonly number[]): number {
    const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);

    return (lighter + 0.05) / (darker + 0.05);
}

/** Where the red, green and blue digit pairs start in a `#rrggbb` colour: after the `#`, then two digits each. */
const HEX_CHANNEL_OFFSETS: readonly number[] = [1, 3, 5];

/**
 * Slack for floating-point error when two contrast ratios of the same colour are compared; far below any
 * difference between two palette colours.
 */
const CONTRAST_TOLERANCE = 1e-9;

/**
 * Reads the colour each character of a Markdown document is drawn in under a rule list.
 *
 * @param doc - The Markdown source.
 * @param styles - The rule list to draw it with.
 * @param textColour - The colour of a range no rule colours.
 * @returns One colour per character, as channels.
 */
async function markdownColours(doc: string, styles: readonly TagStyle[], textColour: [number, number, number]): Promise<Array<readonly number[]>> {
    const highlighter = tagHighlighter(styles.map((rule, index) => ({ tag: rule.tag, class: String(index) })));
    const colours: Array<readonly number[]> = new Array(doc.length).fill(textColour);

    for (const [from, to, classes] of await highlightedRanges(doc, 'markdown', highlighter)) {
        let colour: string | undefined;

        for (const index of classes.split(' ').map(Number).sort((a, b) => a - b)) {
            const rule = styles[index] as { color?: string };

            colour = rule.color ?? colour;
        }

        if (colour && colour !== 'inherit') {
            const channels = HEX_CHANNEL_OFFSETS.map((offset) => parseInt(colour!.slice(offset, offset + 2), 16));

            colours.fill(channels, from, to);
        }
    }

    return colours;
}

/** Link and image constructs whose colours changed, beside the corpus and the demo sample. */
const CONTRAST_SAMPLES: readonly string[] = [
    '[lab]: /u "T"', '[Markdown][commonmark]', '[s][]', '[a](http://x "t")', '[&amp;](u)', '![i &amp;](u "t")',
    '# H [l](u "t") &amp; `c`', '> [l](u) &amp;', '[`code`](u)', '<http://auto>', '[a](<u v> \'t\')', '[**s** *e*](u)',
];

describe('source mode colours', () => {
    it.each(THEMES)('no range has less contrast than before in the %s theme', async (_name, text, background) => {
        const sources = [...CORPUS.map((corpusCase) => corpusCase.source), readDemoEditorSample(), ...CONTRAST_SAMPLES];

        for (const source of sources) {
            const before = await markdownColours(source, PREVIOUS_STYLES, text);
            const after = await markdownColours(source, SYNTAX_STYLES, text);

            for (let index = 0; index < source.length; index++) {
                if (/\s/.test(source[index])) {
                    continue;
                }

                expect(
                    contrast(after[index], background),
                    `${JSON.stringify(source[index])} at ${index} in ${JSON.stringify(source)}`,
                ).toBeGreaterThanOrEqual(Math.min(contrast(before[index], background), contrast(text, background)) - CONTRAST_TOLERANCE);
            }
        }
    });
});

describe('the other built-in languages', () => {
    /** The tags whose rule the plain-text look removed or replaced. Only the markdown grammar may emit them. */
    const MARKDOWN_ONLY_TAGS = [
        tags.heading, tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6,
        tags.strong, tags.emphasis, tags.link, tags.url,
    ];

    /** Names the markdown-only tags a tag list matches, using a highlighter with one rule per tag. */
    const MARKDOWN_ONLY_MATCHER = tagHighlighter(MARKDOWN_ONLY_TAGS.map((tag) => ({ tag, class: 'markdown-only' })));

    /**
     * Lists the style tags a grammar attaches to its node types. Lezer has no public way to list a node type's
     * tags, so this reads the rules lezer's highlighting stores in each node type's props (a rule has `tags`, a
     * `mode` and a `next` rule). That is internal and may change; the self-check below, which must find the tags in
     * the Markdown grammar, fails if an upgrade makes this read nothing, so the sweep cannot pass by reading nothing.
     *
     * @param parser - A lezer parser.
     * @returns One entry per tagged node type: its name and the tags it carries.
     */
    function styleTagsByNode(parser: { nodeSet: { types: readonly NodeType[] } }): Array<[node: string, tags: Tag[]]> {
        const result: Array<[string, Tag[]]> = [];

        for (const type of parser.nodeSet.types) {
            const found: Tag[] = [];

            for (const value of Object.values((type as unknown as { props?: object }).props ?? {})) {
                let rule = value as { tags?: Tag[]; mode?: number; next?: unknown } | undefined;

                while (rule && Array.isArray(rule.tags) && 'mode' in rule) {
                    found.push(...rule.tags);
                    rule = rule.next as typeof rule;
                }
            }

            if (found.length > 0) {
                result.push([type.name, found]);
            }
        }

        return result;
    }

    /**
     * Loads a built-in language and reads its parser.
     *
     * @param languageId - The registered language id.
     * @param options - The options its loader reads.
     * @returns The language's parser.
     */
    async function parserOf(languageId: string, options?: { dialect: string }): Promise<{ nodeSet: { types: readonly NodeType[] } }> {
        const extension = await getLanguage(languageId)!.loadExtension(options);

        return EditorState.create({ extensions: [extension] }).facet(languageFacet)!.parser as unknown as { nodeSet: { types: readonly NodeType[] } };
    }

    it('read the markdown grammar for the tags its own rules match, so the sweep below sees them', async () => {
        const matched = styleTagsByNode(await parserOf('markdown')).filter(([, list]) => MARKDOWN_ONLY_MATCHER.style(list));

        expect(matched.length).toBeGreaterThan(0);
    });

    it('emit none of the tags only the markdown rules match', async () => {
        const ids = listLanguages().map((language) => language.id).filter((id) => id !== 'markdown');
        const parsers: Array<[name: string, parser: Awaited<ReturnType<typeof parserOf>>]> = [];

        for (const id of ids) {
            parsers.push([id, await parserOf(id)]);
        }

        parsers.push(['sql postgresql', await parserOf('sql', { dialect: 'postgresql' })]);

        const hits: string[] = [];

        for (const [name, parser] of parsers) {
            for (const [node, list] of styleTagsByNode(parser)) {
                if (MARKDOWN_ONLY_MATCHER.style(list)) {
                    hits.push(`${name}: ${node}`);
                }
            }
        }

        expect(ids.length).toBeGreaterThan(1);
        expect(hits).toEqual([]);
    });
});
