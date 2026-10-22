// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The look of the `markdown` language in `MarkdownEditor`'s source mode. Source mode colours each kind of non-text
// Markdown, keeps content in the text colour, and draws nothing as the Markdown viewer draws it. The look of a range
// is read offline: the language's syntax tree is highlighted with a highlighter built from the same rule list the
// editor theme uses for that scheme, and each range's rules are folded into words such as `block mark` or `plain`.

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
import { MARKDOWN_SOURCE_TAGS } from '~/component/editor/markdownSourceTags';
import {
    syntaxStyles, SHARED_SYNTAX_STYLES, MARKDOWN_SOURCE_LIGHT, MARKDOWN_SOURCE_DARK,
    SYNTAX_KEYWORD, SYNTAX_STRING, SYNTAX_COMMENT, SYNTAX_LITERAL, SYNTAX_FUNCTION, SYNTAX_TYPE, SYNTAX_PROPERTY,
} from '~/component/editor/theme';
import { CORPUS } from './markdown-roundtrip/corpus';
import { readDemoEditorSample } from '../helpers/readDemoSample.mjs';

/** A range of source text and the look it is drawn in. */
type Range = [text: string, look: string];

/** The red, green and blue channels of a colour, 0 to 255. */
type Channels = readonly [number, number, number];

/** The word for each kind of non-text Markdown, as a look names it. */
const CATEGORY_WORDS: Readonly<Record<keyof typeof MARKDOWN_SOURCE_TAGS, string>> = {
    inlineMark:  'inline mark',
    blockMark:   'block mark',
    destination: 'destination',
    escape:      'escape',
    html:        'html',
    dialect:     'dialect',
    code:        'code',
};

/** The word for each colour of the shared palette, which other languages use. */
const SHARED_COLOUR_NAMES: Readonly<Record<string, string>> = {
    [SYNTAX_KEYWORD]:  'blue',
    [SYNTAX_STRING]:   'green',
    [SYNTAX_COMMENT]:  'grey',
    [SYNTAX_LITERAL]:  'amber',
    [SYNTAX_FUNCTION]: 'violet',
    [SYNTAX_TYPE]:     'teal',
    [SYNTAX_PROPERTY]: 'pink',
};

/** The tint `theme.ts`'s `.cm-activeLine` lays over the editor background: `rgba(127, 127, 127, 0.08)`. */
const ACTIVE_LINE_TINT: Channels = [127, 127, 127];

/** The opacity of {@link ACTIVE_LINE_TINT}. */
const ACTIVE_LINE_ALPHA = 0.08;

/**
 * Lays a translucent colour over an opaque one.
 *
 * @param tint - The translucent colour's channels.
 * @param alpha - Its opacity, 0 to 1.
 * @param background - The opaque colour beneath.
 * @returns The channels of the colour seen.
 */
function overlay(tint: Channels, alpha: number, background: Channels): Channels {
    const [red, green, blue] = tint.map((channel, index) => background[index]! + (channel - background[index]!) * alpha);

    return [red!, green!, blue!];
}

/** One theme scheme as the editor draws it. */
interface Scheme {
    /** The scheme's name in a test title. */
    readonly name: 'light' | 'dark';
    /** The `dark` flag `codeEditorTheme` and `syntaxStyles` take. */
    readonly dark: boolean;
    /** The editor's text colour, `--ts-ui-text-color`. */
    readonly text: Channels;
    /** The editor's background, `--ts-ui-input-bg`. */
    readonly background: Channels;
    /** The rules of the scheme. */
    readonly styles: readonly TagStyle[];
    /** The Markdown colours of the scheme. */
    readonly markdown: Readonly<Record<keyof typeof MARKDOWN_SOURCE_TAGS, string>>;
}

/**
 * The shipped themes' editor colours: `ModernTheme.ts` and `ClassicTheme.ts` draw text `rgb(0, 0, 0)` on
 * `rgb(255, 255, 255)`, `DarkTheme.ts` text `rgb(220, 220, 220)` on `rgb(40, 40, 40)`.
 */
const SCHEMES: readonly Scheme[] = [
    { name: 'light', dark: false, text: [0, 0, 0],       background: [255, 255, 255], styles: syntaxStyles(false), markdown: MARKDOWN_SOURCE_LIGHT },
    { name: 'dark',  dark: true,  text: [220, 220, 220], background: [40, 40, 40],    styles: syntaxStyles(true),  markdown: MARKDOWN_SOURCE_DARK },
];

/**
 * Names every colour of a scheme's rules.
 *
 * @param scheme - The scheme.
 * @returns The word for each colour value.
 */
function colourNames(scheme: Scheme): Record<string, string> {
    const names: Record<string, string> = { ...SHARED_COLOUR_NAMES };

    for (const [category, colour] of Object.entries(scheme.markdown)) {
        names[colour] = CATEGORY_WORDS[category as keyof typeof MARKDOWN_SOURCE_TAGS];
    }

    return names;
}

/** The word each non-colour property adds to a look. */
const PROPERTY_WORDS: Readonly<Record<string, string>> = {
    fontWeight:     'bold',
    fontStyle:      'italic',
    textDecoration: 'underline',
    fontSize:       'sized',
};

/**
 * Builds a highlighter whose classes name the rules a range took: one class per rule, named by the rule's index.
 *
 * @param styles - The rules.
 * @returns The highlighter.
 */
function indexHighlighter(styles: readonly TagStyle[]): Highlighter {
    return tagHighlighter(styles.map((rule, index) => ({ tag: rule.tag, class: String(index) })));
}

/**
 * Merges the properties of the rules a range took, in rule order, a later rule overwriting an earlier one.
 *
 * @param classes - The space-separated rule indexes the range took.
 * @param styles - The rules.
 * @returns The merged CSS properties.
 */
function mergedProperties(classes: string, styles: readonly TagStyle[]): Record<string, string> {
    const merged: Record<string, string> = {};

    for (const index of classes.split(' ').map(Number).sort((a, b) => a - b)) {
        const { tag: _tag, ...properties } = styles[index] as Record<string, unknown>;

        Object.assign(merged, properties);
    }

    return merged;
}

/**
 * Folds the rules a range took into one look: the colour's name followed by a word for each other property.
 *
 * @param classes - The space-separated rule indexes the range took.
 * @param scheme - The scheme the rules belong to.
 * @returns The look, or `plain` when no rule set anything.
 */
function foldLook(classes: string, scheme: Scheme): string {
    const names = colourNames(scheme);
    const words = Object.entries(mergedProperties(classes, scheme.styles)).map(([property, value]) => (
        property === 'color' ? (names[value] ?? value) : PROPERTY_WORDS[property]
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
 * @param scheme - The scheme to draw it in.
 * @returns The document's text in order, split where the look changes.
 */
async function sourceLooks(doc: string, languageId: string = 'markdown', scheme: Scheme = SCHEMES[0]!): Promise<Range[]> {
    const spans: Array<[from: number, to: number, look: string]> = [];
    let position = 0;

    for (const [from, to, classes] of await highlightedRanges(doc, languageId, indexHighlighter(scheme.styles))) {
        if (from > position) {
            spans.push([position, from, 'plain']);
        }

        spans.push([from, to, foldLook(classes, scheme)]);
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

/** Every corpus document and the demo sample: the documents the whole-document tests read. */
const WHOLE_DOCUMENTS: readonly string[] = [...CORPUS.map((corpusCase) => corpusCase.source), readDemoEditorSample()];

/** One source and the ranges it is drawn in, the same in both schemes. */
const MARKDOWN_ROWS: ReadonlyArray<[title: string, source: string, looks: Range[]]> = [
    // Headings, emphasis, strike-through and underline.
    ['an ATX heading has a block mark and plain text', '# MarkdownEditor',
        [['#', 'block mark'], [' MarkdownEditor', 'plain']]],
    ['a closing hash run is a block mark too', '# H #',
        [['#', 'block mark'], [' H ', 'plain'], ['#', 'block mark']]],
    ['a setext heading has plain text and a block-mark underline', 'Setext\n===',
        [['Setext\n', 'plain'], ['===', 'block mark']]],
    ['a heading holding a link and strong text keeps every part its own colour', '# A [l](u) **b**',
        [['#', 'block mark'], [' A ', 'plain'], ['[', 'inline mark'], ['l', 'plain'], ['](', 'inline mark'], ['u', 'destination'], [')', 'inline mark'], [' ', 'plain'], ['**', 'inline mark'], ['b', 'plain'], ['**', 'inline mark']]],
    ['strong text is plain between inline marks', 'A **WYSIWYG** editor',
        [['A ', 'plain'], ['**', 'inline mark'], ['WYSIWYG', 'plain'], ['**', 'inline mark'], [' editor', 'plain']]],
    ['emphasised text is plain between inline marks', 'a *Markdown* string',
        [['a ', 'plain'], ['*', 'inline mark'], ['Markdown', 'plain'], ['*', 'inline mark'], [' string', 'plain']]],
    ['underscore emphasis looks the same', 'a _b_ __c__',
        [['a ', 'plain'], ['_', 'inline mark'], ['b', 'plain'], ['_', 'inline mark'], [' ', 'plain'], ['__', 'inline mark'], ['c', 'plain'], ['__', 'inline mark']]],
    ['strong emphasised text is plain between inline marks', '***bi***',
        [['***', 'inline mark'], ['bi', 'plain'], ['***', 'inline mark']]],
    ['struck-through text is plain between inline marks', '~~strike~~',
        [['~~', 'inline mark'], ['strike', 'plain'], ['~~', 'inline mark']]],
    ['a single tilde is plain text', '~one~',
        [['~one~', 'plain']]],
    ['tildes with spaces inside are plain text', 'a ~~ b ~~ c',
        [['a ~~ b ~~ c', 'plain']]],
    ['underlined text is plain between inline marks', '++underline++',
        [['++', 'inline mark'], ['underline', 'plain'], ['++', 'inline mark']]],
    ['underline inside strong text joins the marks', '**++b++**',
        [['**++', 'inline mark'], ['b', 'plain'], ['++**', 'inline mark']]],
    ['underlined text cannot hold a plus sign', '++a+b++',
        [['++a+b++', 'plain']]],
    ['a strike-through in a heading keeps its inline marks', '## ~~old~~ new',
        [['##', 'block mark'], [' ', 'plain'], ['~~', 'inline mark'], ['old', 'plain'], ['~~', 'inline mark'], [' new', 'plain']]],

    // Links, images and references.
    ['a reference link has plain text and a destination label', '[Markdown][commonmark]',
        [['[', 'inline mark'], ['Markdown', 'plain'], [']', 'inline mark'], ['[commonmark]', 'destination']]],
    ['an inline link has a destination URL and a plain title', '[a](http://x "t")',
        [['[', 'inline mark'], ['a', 'plain'], ['](', 'inline mark'], ['http://x', 'destination'], [' "t"', 'plain'], [')', 'inline mark']]],
    ['an angle-bracketed destination is a destination with its brackets', "[a](<u v> 't')",
        [['[', 'inline mark'], ['a', 'plain'], ['](', 'inline mark'], ['<u v>', 'destination'], [" 't'", 'plain'], [')', 'inline mark']]],
    ['an image has plain alt text, a destination and a dialect group', '![Diagram](https://placehold.co/240x120){width=240 height=120}',
        [['![', 'inline mark'], ['Diagram', 'plain'], ['](', 'inline mark'], ['https://placehold.co/240x120', 'destination'], [')', 'inline mark'], ['{width=240 height=120}', 'dialect']]],
    ['an image with emphasis in its alt text', '![*a* b](u "t")',
        [['![*', 'inline mark'], ['a', 'plain'], ['*', 'inline mark'], [' b', 'plain'], ['](', 'inline mark'], ['u', 'destination'], [' "t"', 'plain'], [')', 'inline mark']]],
    ['an autolink has a destination URL between inline marks', '<http://auto>',
        [['<', 'inline mark'], ['http://auto', 'destination'], ['>', 'inline mark']]],
    ['a collapsed reference has a destination empty label', '[s][]',
        [['[', 'inline mark'], ['s', 'plain'], [']', 'inline mark'], ['[]', 'destination']]],
    ['a shortcut reference has plain text between inline marks', '[s]',
        [['[', 'inline mark'], ['s', 'plain'], [']', 'inline mark']]],
    ['a link reference definition has a destination label and URL', '[commonmark]: https://commonmark.org',
        [['[commonmark]', 'destination'], [':', 'inline mark'], [' ', 'plain'], ['https://commonmark.org', 'destination']]],
    ['a definition title is plain', '[lab]: /u "T"',
        [['[lab]', 'destination'], [':', 'inline mark'], [' ', 'plain'], ['/u', 'destination'], [' "T"', 'plain']]],
    ['a bare URL is plain text', 'https://example.com',
        [['https://example.com', 'plain']]],

    // Dialect groups and fence lines.
    ['a coloured span has a dialect group', '[coloured]{color=#cc0000}',
        [['[', 'inline mark'], ['coloured', 'plain'], [']', 'inline mark'], ['{color=#cc0000}', 'dialect']]],
    ['a sized span has a dialect group', '[sized]{size=1.3em}',
        [['[', 'inline mark'], ['sized', 'plain'], [']', 'inline mark'], ['{size=1.3em}', 'dialect']]],
    ['a span holding emphasis keeps the emphasis marks', '[sp *em*]{color=red}',
        [['[', 'inline mark'], ['sp ', 'plain'], ['*', 'inline mark'], ['em', 'plain'], ['*]', 'inline mark'], ['{color=red}', 'dialect']]],
    ['a group after a full reference link is a dialect group', '[a][b]{c}',
        [['[', 'inline mark'], ['a', 'plain'], [']', 'inline mark'], ['[b]', 'destination'], ['{c}', 'dialect']]],
    ['a group after an inline link is plain text', '[a](u){x}',
        [['[', 'inline mark'], ['a', 'plain'], ['](', 'inline mark'], ['u', 'destination'], [')', 'inline mark'], ['{x}', 'plain']]],
    ['a group after a reference image is a dialect group', '![a][l]{w=1}',
        [['![', 'inline mark'], ['a', 'plain'], [']', 'inline mark'], ['[l]', 'destination'], ['{w=1}', 'dialect']]],
    ['a group after a shortcut image is a dialect group', '![l]{w=1}',
        [['![', 'inline mark'], ['l', 'plain'], [']', 'inline mark'], ['{w=1}', 'dialect']]],
    ['a group after parentheses in prose is plain text', 'f(x){y}',
        [['f(x){y}', 'plain']]],
    ['a group after an escaped bracket is plain text', '\\]{x}',
        [['\\]', 'escape'], ['{x}', 'plain']]],
    ['a group after code is plain text', '`code`{x}',
        [['`', 'inline mark'], ['code', 'code'], ['`', 'inline mark'], ['{x}', 'plain']]],
    ['an aligned fence has dialect fence lines', '::: {align=center}\nA\n:::',
        [['::: {align=center}', 'dialect'], ['\nA\n', 'plain'], [':::', 'dialect']]],
    ['a column region has dialect fence and separator lines', '::: columns\nLeft column.\n|||\nRight column.\n:::',
        [['::: columns', 'dialect'], ['\nLeft column.\n', 'plain'], ['|||', 'dialect'], ['\nRight column.\n', 'plain'], [':::', 'dialect']]],
    ['a fence label is part of the dialect line', '::: tip Title {align=right}\nx\n:::',
        [['::: tip Title {align=right}', 'dialect'], ['\nx\n', 'plain'], [':::', 'dialect']]],
    ['a fence opened on a list item line', '- ::: {align=right}\n  a\n  :::',
        [['-', 'block mark'], [' ', 'plain'], ['::: {align=right}', 'dialect'], ['\n  a\n  ', 'plain'], [':::', 'dialect']]],
    ['a fence in a quote', '> ::: {align=right}\n> x\n> :::',
        [['>', 'block mark'], [' ', 'plain'], ['::: {align=right}', 'dialect'], ['\n', 'plain'], ['>', 'block mark'], [' x\n', 'plain'], ['>', 'block mark'], [' ', 'plain'], [':::', 'dialect']]],
    ['a separator line may carry spaces around it', '  |||  ',
        [['  ', 'plain'], ['|||', 'dialect'], ['  ', 'plain']]],
    ['a separator line with more after it is plain text', '||| x',
        [['||| x', 'plain']]],
    ['an escaped separator is an escape and plain text', '\\|||',
        [['\\|', 'escape'], ['||', 'plain']]],

    // Tables.
    ['a table has dialect pipes and delimiter row and plain cells', '| a | b |\n| --- | --- |\n| c | d |',
        [['|', 'dialect'], [' a ', 'plain'], ['|', 'dialect'], [' b ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['| --- | --- |', 'dialect'], ['\n', 'plain'], ['|', 'dialect'], [' c ', 'plain'], ['|', 'dialect'], [' d ', 'plain'], ['|', 'dialect']]],
    ['a column width in the delimiter row is part of it, and a merge cell is dialect', '| Column | Aligned |\n| :--- {width=160} | :---: |\n| Tables | yes |\n| Merge | << |',
        [['|', 'dialect'], [' Column ', 'plain'], ['|', 'dialect'], [' Aligned ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['| :--- {width=160} | :---: |', 'dialect'], ['\n', 'plain'], ['|', 'dialect'], [' Tables ', 'plain'], ['|', 'dialect'], [' yes ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['|', 'dialect'], [' Merge ', 'plain'], ['|', 'dialect'], [' ', 'plain'], ['<<', 'dialect'], [' ', 'plain'], ['|', 'dialect']]],
    ['a merge cell in the first column or the first body row is plain text', '| a | b |\n| - | - |\n| << | ^^ |\n| x | ^^ |',
        [['|', 'dialect'], [' a ', 'plain'], ['|', 'dialect'], [' b ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['| - | - |', 'dialect'], ['\n', 'plain'], ['|', 'dialect'], [' << ', 'plain'], ['|', 'dialect'], [' ^^ ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['|', 'dialect'], [' x ', 'plain'], ['|', 'dialect'], [' ', 'plain'], ['^^', 'dialect'], [' ', 'plain'], ['|', 'dialect']]],
    ['an escaped merge cell is an escape and plain text', '| a | b |\n| - | - |\n| \\<< | x |',
        [['|', 'dialect'], [' a ', 'plain'], ['|', 'dialect'], [' b ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['| - | - |', 'dialect'], ['\n', 'plain'], ['|', 'dialect'], [' ', 'plain'], ['\\<', 'escape'], ['< ', 'plain'], ['|', 'dialect'], [' x ', 'plain'], ['|', 'dialect']]],
    ['a table without outer pipes', 'a | b\n--- | ---\nc | d',
        [['a ', 'plain'], ['|', 'dialect'], [' b\n', 'plain'], ['--- | ---', 'dialect'], ['\nc ', 'plain'], ['|', 'dialect'], [' d', 'plain']]],
    ['a one-column table needs a colon or pipe in its delimiter row', 'a\n:--',
        [['a\n', 'plain'], [':--', 'dialect']]],
    ['a line over dashes alone is a setext heading', 'a\n---',
        [['a\n', 'plain'], ['---', 'block mark']]],
    ['an escaped pipe stays in its cell', '| a \\| b | c |\n| - | - |',
        [['|', 'dialect'], [' a ', 'plain'], ['\\|', 'escape'], [' b ', 'plain'], ['|', 'dialect'], [' c ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['| - | - |', 'dialect']]],
    ['a delimiter row with fewer cells is no table', '| a | b |\n| - |',
        [['| a | b |\n| - |', 'plain']]],
    ['a table straight after a paragraph line is plain text', 'para\n| a | b |\n| - | - |',
        [['para\n| a | b |\n| - | - |', 'plain']]],
    ['a table in a quote', '> | a | b |\n> | - | - |\n> | c | d |',
        [['>', 'block mark'], [' ', 'plain'], ['|', 'dialect'], [' a ', 'plain'], ['|', 'dialect'], [' b ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['>', 'block mark'], [' ', 'plain'], ['| - | - |', 'dialect'], ['\n', 'plain'], ['>', 'block mark'], [' ', 'plain'], ['|', 'dialect'], [' c ', 'plain'], ['|', 'dialect'], [' d ', 'plain'], ['|', 'dialect']]],

    // Blocks, markers and HTML.
    ['a bullet marker is a block mark', '- item',
        [['-', 'block mark'], [' item', 'plain']]],
    ['a number marker is a block mark', '1. one',
        [['1.', 'block mark'], [' one', 'plain']]],
    ['a task box is a block mark', '- [x] t',
        [['-', 'block mark'], [' ', 'plain'], ['[x]', 'block mark'], [' t', 'plain']]],
    ['a quote has a block-mark marker and plain text', '> Edit on the left',
        [['>', 'block mark'], [' Edit on the left', 'plain']]],
    ['a quote keeps the colours of what it holds', '> q *e* [l](u)',
        [['>', 'block mark'], [' q ', 'plain'], ['*', 'inline mark'], ['e', 'plain'], ['*', 'inline mark'], [' ', 'plain'], ['[', 'inline mark'], ['l', 'plain'], ['](', 'inline mark'], ['u', 'destination'], [')', 'inline mark']]],
    ['a thematic break is a block mark', 'a\n\n---\n\nb',
        [['a\n\n', 'plain'], ['---', 'block mark'], ['\n\nb', 'plain']]],
    ['a thematic break of asterisks is a block mark', '***',
        [['***', 'block mark']]],
    ['a backslash hard break is an escape', 'a\\\nb',
        [['a', 'plain'], ['\\\n', 'escape'], ['b', 'plain']]],
    ['an HTML comment is HTML', '<!-- c -->',
        [['<!-- c -->', 'html']]],
    ['an HTML comment inside link text is HTML', '[a <!-- c --> b](u)',
        [['[', 'inline mark'], ['a ', 'plain'], ['<!-- c -->', 'html'], [' b', 'plain'], ['](', 'inline mark'], ['u', 'destination'], [')', 'inline mark']]],
    ['inline HTML is HTML around plain text', 'x <span>h</span>',
        [['x ', 'plain'], ['<span>', 'html'], ['h', 'plain'], ['</span>', 'html']]],
    ['an attribute holding CSS is HTML throughout', '<span style="color: red">s</span>',
        [['<span style="color: red">', 'html'], ['s', 'plain'], ['</span>', 'html']]],
    ['an HTML block is HTML throughout', '<div class="x">\n</div>',
        [['<div class="x">\n</div>', 'html']]],
    ['a script block is HTML throughout', '<script>\nlet a = 1;\n</script>',
        [['<script>\nlet a = 1;\n</script>', 'html']]],
    ['a processing instruction is HTML', '<?php x ?>',
        [['<?php x ?>', 'html']]],

    // Code, escapes and character references.
    ['inline code is code between inline marks', '`**bold**`',
        [['`', 'inline mark'], ['**bold**', 'code'], ['`', 'inline mark']]],
    ['a double-backtick code span keeps its inner backticks code', '`` `code` ``',
        [['``', 'inline mark'], [' `code` ', 'code'], ['``', 'inline mark']]],
    ['a fenced code block has block-mark fence lines', '```js\nlet a\n```',
        [['```js\n', 'block mark'], ['let a', 'code'], ['\n```', 'block mark']]],
    ['a tilde fence with an info string', '~~~ info\nx\n~~~',
        [['~~~ info\n', 'block mark'], ['x', 'code'], ['\n~~~', 'block mark']]],
    ['an indented code block is code', '    indented',
        [['    ', 'plain'], ['indented', 'code']]],
    ['code as link text is code', '[`code`](u)',
        [['[`', 'inline mark'], ['code', 'code'], ['`](', 'inline mark'], ['u', 'destination'], [')', 'inline mark']]],
    ['code in a heading is code', '# `c`',
        [['#', 'block mark'], [' ', 'plain'], ['`', 'inline mark'], ['c', 'code'], ['`', 'inline mark']]],
    ['a character reference in link text is an escape', '[&amp;](u)',
        [['[', 'inline mark'], ['&amp;', 'escape'], ['](', 'inline mark'], ['u', 'destination'], [')', 'inline mark']]],
    ['a character reference in a paragraph is an escape', 'a &amp; b',
        [['a ', 'plain'], ['&amp;', 'escape'], [' b', 'plain']]],
    ['an escape and a character reference are escapes', '\\* &amp;',
        [['\\*', 'escape'], [' ', 'plain'], ['&amp;', 'escape']]],

    // Where the grammar and the viewer read a line differently: the grammar's reading is pinned.
    ['a separator line after a quote mark is a dialect line', '> a\n> |||',
        [['>', 'block mark'], [' a\n', 'plain'], ['>', 'block mark'], [' ', 'plain'], ['|||', 'dialect']]],
    ['a fence line under paragraph text is a dialect line', 'text\n::: x',
        [['text\n', 'plain'], ['::: x', 'dialect']]],
    ['a fence line as heading text is a dialect line', '# :::',
        [['#', 'block mark'], [' ', 'plain'], [':::', 'dialect']]],
    ['a separator line in an HTML block is HTML', '<div>\n|||\n</div>',
        [['<div>\n|||\n</div>', 'html']]],
    ['a quoted HTML block keeps block mark quote marks', '> <div>\n> x\n> </div>',
        [['>', 'block mark'], [' ', 'plain'], ['<div>\n', 'html'], ['>', 'block mark'], [' x\n', 'html'], ['>', 'block mark'], [' </div>', 'html']]],
    ['a quoted HTML comment keeps block mark quote marks', '> <!--\n> c\n> -->',
        [['>', 'block mark'], [' ', 'plain'], ['<!--\n', 'html'], ['>', 'block mark'], [' c\n', 'html'], ['>', 'block mark'], [' -->', 'html']]],
    ['a quoted inline tag over two lines keeps block mark quote marks', '> a <span\n> class="x">b</span>',
        [['>', 'block mark'], [' a ', 'plain'], ['<span\n', 'html'], ['>', 'block mark'], [' class="x">', 'html'], ['b', 'plain'], ['</span>', 'html']]],
    ['a quoted HTML block in a list item keeps block mark quote marks', '- > <div>\n  > x\n  > </div>',
        [['-', 'block mark'], [' ', 'plain'], ['>', 'block mark'], [' ', 'plain'], ['<div>\n  ', 'html'], ['>', 'block mark'], [' x\n  ', 'html'], ['>', 'block mark'], [' </div>', 'html']]],
    ['a fence line starting a table cell is plain', '| a | b |\n| - | - |\n| ::: x | y |',
        [['|', 'dialect'], [' a ', 'plain'], ['|', 'dialect'], [' b ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['| - | - |', 'dialect'], ['\n', 'plain'],
            ['|', 'dialect'], [' ::: x ', 'plain'], ['|', 'dialect'], [' y ', 'plain'], ['|', 'dialect']]],
    ['a fence line starting underlined text is plain', '++::: x++',
        [['++', 'inline mark'], ['::: x', 'plain'], ['++', 'inline mark']]],
    ['two pipes on two lines make no table', '|\n|',
        [['|\n|', 'plain']]],
    ['a fence closing right after a table is a dialect line', '::: x\n\n| a | b |\n| - | - |\n:::',
        [['::: x', 'dialect'], ['\n\n', 'plain'], ['|', 'dialect'], [' a ', 'plain'], ['|', 'dialect'], [' b ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['| - | - |', 'dialect'], ['\n', 'plain'], [':::', 'dialect']]],
    ['a quoted fence closing right after a table is a dialect line', '> | a | b |\n> | - | - |\n> :::',
        [['>', 'block mark'], [' ', 'plain'], ['|', 'dialect'], [' a ', 'plain'], ['|', 'dialect'], [' b ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['>', 'block mark'], [' ', 'plain'], ['| - | - |', 'dialect'], ['\n', 'plain'], ['>', 'block mark'], [' ', 'plain'], [':::', 'dialect']]],
    ['a list item fence closing right after a table is a dialect line', '- | a | b |\n  | - | - |\n  :::',
        [['-', 'block mark'], [' ', 'plain'], ['|', 'dialect'], [' a ', 'plain'], ['|', 'dialect'], [' b ', 'plain'], ['|', 'dialect'], ['\n  ', 'plain'], ['| - | - |', 'dialect'], ['\n  ', 'plain'], [':::', 'dialect']]],
    ['a column fence whose sections start with tables', '::: columns\n| a | b |\n| - | - |\n| 1 | 2 |\n|||\n| c | d |\n| - | - |\n:::',
        [['::: columns', 'dialect'], ['\n', 'plain'], ['|', 'dialect'], [' a ', 'plain'], ['|', 'dialect'], [' b ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['| - | - |', 'dialect'], ['\n', 'plain'], ['|', 'dialect'], [' 1 ', 'plain'], ['|', 'dialect'], [' 2 ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['|||', 'dialect'], ['\n', 'plain'], ['|', 'dialect'], [' c ', 'plain'], ['|', 'dialect'], [' d ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['| - | - |', 'dialect'], ['\n', 'plain'], [':::', 'dialect']]],
    ['a quoted column fence whose sections start with tables', '> ::: columns\n> | a | b |\n> | - | - |\n> |||\n> | c | d |\n> | - | - |\n> :::',
        [['>', 'block mark'], [' ', 'plain'], ['::: columns', 'dialect'], ['\n', 'plain'], ['>', 'block mark'], [' ', 'plain'], ['|', 'dialect'], [' a ', 'plain'], ['|', 'dialect'], [' b ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['>', 'block mark'], [' ', 'plain'], ['| - | - |', 'dialect'], ['\n', 'plain'], ['>', 'block mark'], [' ', 'plain'], ['|||', 'dialect'], ['\n', 'plain'], ['>', 'block mark'], [' ', 'plain'], ['|', 'dialect'], [' c ', 'plain'], ['|', 'dialect'], [' d ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['>', 'block mark'], [' ', 'plain'], ['| - | - |', 'dialect'], ['\n', 'plain'], ['>', 'block mark'], [' ', 'plain'], [':::', 'dialect']]],
    ['a list item column fence whose sections start with tables', '- ::: columns\n  | a | b |\n  | - | - |\n  |||\n  | c | d |\n  | - | - |\n  :::',
        [['-', 'block mark'], [' ', 'plain'], ['::: columns', 'dialect'], ['\n  ', 'plain'], ['|', 'dialect'], [' a ', 'plain'], ['|', 'dialect'], [' b ', 'plain'], ['|', 'dialect'], ['\n  ', 'plain'], ['| - | - |', 'dialect'], ['\n  ', 'plain'], ['|||', 'dialect'], ['\n  ', 'plain'], ['|', 'dialect'], [' c ', 'plain'], ['|', 'dialect'], [' d ', 'plain'], ['|', 'dialect'], ['\n  ', 'plain'], ['| - | - |', 'dialect'], ['\n  ', 'plain'], [':::', 'dialect']]],
    ['a merge cell that cannot make a whole rectangle is a dialect cell', '| a | b |\n| - | - |\n| x | << |\n| ^^ | y |',
        [['|', 'dialect'], [' a ', 'plain'], ['|', 'dialect'], [' b ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['| - | - |', 'dialect'], ['\n', 'plain'],
            ['|', 'dialect'], [' x ', 'plain'], ['|', 'dialect'], [' ', 'plain'], ['<<', 'dialect'], [' ', 'plain'], ['|', 'dialect'], ['\n', 'plain'],
            ['|', 'dialect'], [' ', 'plain'], ['^^', 'dialect'], [' ', 'plain'], ['|', 'dialect'], [' y ', 'plain'], ['|', 'dialect']]],
];

describe.each(SCHEMES)('the markdown language in source mode, $name theme', (scheme) => {
    it.each(MARKDOWN_ROWS)('%s', async (_title, source, looks) => {
        expect(await sourceLooks(source, 'markdown', scheme)).toEqual(looks);
    });

    it('draws each part of the demo sample in its kind\'s colour', async () => {
        const sample = readDemoEditorSample();
        const looks = await sourceLooks(sample, 'markdown', scheme);

        // The look of each character of the sample, so a part is found by where it stands in its construct, not by its words.
        const lookAt: string[] = looks.flatMap(([text, look]) => Array.from({ length: text.length }, () => look));

        // Each part is given with the construct it stands in and the look it must have there.
        const parts: ReadonlyArray<[construct: string, part: string, look: string]> = [
            ['# MarkdownEditor', '#', 'block mark'],
            ['# MarkdownEditor', 'MarkdownEditor', 'plain'],
            ['A **WYSIWYG** editor', '**', 'inline mark'],
            ['`**bold**`', '**bold**', 'code'],
            ['[coloured]{color=#cc0000}', 'coloured', 'plain'],
            ['[coloured]{color=#cc0000}', '{color=#cc0000}', 'dialect'],
            ['[sized]{size=1.3em}', '{size=1.3em}', 'dialect'],
            ['[Markdown][commonmark]', 'Markdown', 'plain'],
            ['[Markdown][commonmark]', '[commonmark]', 'destination'],
            ['> Edit on the left', '>', 'block mark'],
            ['| :--- {width=160} | :---: |', '| :--- {width=160} | :---: |', 'dialect'],
            ['| Merge | << |', '<<', 'dialect'],
            ['| Merge | << |', 'Merge', 'plain'],
            ['::: {align=center}', '::: {align=center}', 'dialect'],
            ['\n|||\n', '|||', 'dialect'],
            ['![Diagram](https://placehold.co/240x120){width=240 height=120}', 'Diagram', 'plain'],
            ['![Diagram](https://placehold.co/240x120){width=240 height=120}', 'https://placehold.co/240x120', 'destination'],
            ['![Diagram](https://placehold.co/240x120){width=240 height=120}', '{width=240 height=120}', 'dialect'],
            ['const editor = new MarkdownEditor("# Hello");', 'const editor = new MarkdownEditor("# Hello");', 'code'],
            ['[commonmark]: https://commonmark.org', '[commonmark]', 'destination'],
            ['[commonmark]: https://commonmark.org', 'https://commonmark.org', 'destination'],
        ];

        for (const [construct, part, look] of parts) {
            const start = sample.indexOf(construct);

            expect(start, construct).toBeGreaterThanOrEqual(0);

            const partStart = start + construct.indexOf(part);

            expect(lookAt.slice(partStart, partStart + part.length), `${part} in ${construct}`).toEqual(Array(part.length).fill(look));
        }
    });

    it('draws every kind of non-text Markdown somewhere in the corpus or the demo sample', async () => {
        const seen = new Set<string>();

        for (const source of WHOLE_DOCUMENTS) {
            for (const [, look] of await sourceLooks(source, 'markdown', scheme)) {
                seen.add(look);
            }
        }

        expect([...seen].sort()).toEqual(['plain', ...Object.values(CATEGORY_WORDS)].sort());
    });

    it('draws nothing as the viewer draws it, in any corpus document or the demo sample', async () => {
        for (const source of WHOLE_DOCUMENTS) {
            for (const [text, look] of await sourceLooks(source, 'markdown', scheme)) {
                expect(look, `${JSON.stringify(text)} in ${JSON.stringify(source)}`).not.toMatch(/bold|italic|underline|sized/);
            }
        }
    });
});

/** The WCAG AA contrast ratio for normal text, which every colour of source mode must reach. */
const MINIMUM_CONTRAST = 4.5;

/**
 * The WCAG relative luminance of a colour.
 *
 * @param rgb - The red, green and blue channels, 0 to 255.
 * @returns The luminance, 0 to 1.
 */
function luminance(rgb: Channels): number {
    const [red, green, blue] = rgb.map((channel) => {
        const unit = channel / 255;

        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });

    return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

/**
 * The WCAG contrast ratio of two colours.
 *
 * @param first - The channels of one colour.
 * @param second - The channels of the other.
 * @returns The ratio, 1 to 21.
 */
function contrast(first: Channels, second: Channels): number {
    const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);

    return (lighter! + 0.05) / (darker! + 0.05);
}

/** A `#rrggbb` colour. */
const HEX_COLOUR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/**
 * Reads the channels of a `#rrggbb` colour.
 *
 * @param colour - The colour.
 * @returns Its channels.
 */
function channelsOf(colour: string): Channels {
    const match = HEX_COLOUR.exec(colour);

    expect(match, colour).not.toBeNull();

    return [parseInt(match![1]!, 16), parseInt(match![2]!, 16), parseInt(match![3]!, 16)];
}

/**
 * The lower of a colour's two contrast ratios in a scheme: on the editor background and on the active line.
 *
 * @param colour - The colour's channels.
 * @param scheme - The scheme.
 * @returns The ratio.
 */
function schemeContrast(colour: Channels, scheme: Scheme): number {
    const activeLine = overlay(ACTIVE_LINE_TINT, ACTIVE_LINE_ALPHA, scheme.background);

    return Math.min(contrast(colour, scheme.background), contrast(colour, activeLine));
}

describe.each(SCHEMES)('source mode colours, $name theme', (scheme) => {
    it('gives every kind of non-text Markdown, and the text, a readable colour', () => {
        for (const [category, colour] of Object.entries(scheme.markdown)) {
            expect(schemeContrast(channelsOf(colour), scheme), category).toBeGreaterThanOrEqual(MINIMUM_CONTRAST);
        }

        expect(schemeContrast(scheme.text, scheme), 'text').toBeGreaterThanOrEqual(MINIMUM_CONTRAST);
    });

    it('gives each kind its own colour, none of them a colour of the shared palette', () => {
        const colours = Object.values(scheme.markdown).map((colour) => colour.toLowerCase());

        expect(new Set([...colours, ...Object.keys(SHARED_COLOUR_NAMES).map((colour) => colour.toLowerCase())]).size)
            .toBe(colours.length + Object.keys(SHARED_COLOUR_NAMES).length);
    });

    it('draws every character of the corpus, the demo sample and the rows in a readable colour', async () => {
        const sources = [...WHOLE_DOCUMENTS, ...MARKDOWN_ROWS.map(([, source]) => source)];
        const highlighter = indexHighlighter(scheme.styles);

        for (const source of sources) {
            const colours: Channels[] = new Array(source.length).fill(scheme.text);

            for (const [from, to, classes] of await highlightedRanges(source, 'markdown', highlighter)) {
                const colour = mergedProperties(classes, scheme.styles).color;

                if (colour !== undefined) {
                    colours.fill(channelsOf(colour), from, to);
                }
            }

            for (let index = 0; index < source.length; index++) {
                if (/\s/.test(source[index]!)) {
                    continue;
                }

                expect(schemeContrast(colours[index]!, scheme), `${JSON.stringify(source[index])} at ${index} in ${JSON.stringify(source)}`)
                    .toBeGreaterThanOrEqual(MINIMUM_CONTRAST);
            }
        }
    });
});

describe('the other built-in languages', () => {
    /** One source of another language and the ranges it is drawn in, the same in both schemes. */
    const OTHER_ROWS: ReadonlyArray<[language: string, source: string, looks: Range[]]> = [
        ['javascript', 'const a = "s"; // c',
            [['const', 'blue'], [' ', 'plain'], ['a', 'violet'], [' = ', 'plain'], ['"s"', 'green'], ['; ', 'plain'], ['// c', 'grey italic']]],
        ['html', '<a href="u">t</a><!-- c -->',
            [['<', 'plain'], ['a', 'blue'], [' ', 'plain'], ['href', 'pink'], ['=', 'plain'], ['"u"', 'green'], ['>t</', 'plain'], ['a', 'blue'],
                ['>', 'plain'], ['<!-- c -->', 'grey italic']]],
        ['css', 'a { color: red; }',
            [['a', 'blue'], [' { ', 'plain'], ['color', 'pink'], [': ', 'plain'], ['red', 'blue'], ['; }', 'plain']]],
    ];

    it.each(SCHEMES)('share the same rules in the $name theme', (scheme) => {
        expect(scheme.styles.slice(0, SHARED_SYNTAX_STYLES.length)).toEqual(SHARED_SYNTAX_STYLES);
    });

    describe.each(SCHEMES)('in the $name theme', (scheme) => {
        it.each(OTHER_ROWS)('%s keeps its look', async (language, source, looks) => {
            expect(await sourceLooks(source, language, scheme)).toEqual(looks);
        });
    });

    /**
     * The tags only the markdown rules match: the tags whose shared rule source mode removed, and the tags only the
     * markdown language emits. Only the markdown grammar may emit them.
     */
    const MARKDOWN_ONLY_TAGS: readonly Tag[] = [
        tags.heading, tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6,
        tags.strong, tags.emphasis, tags.link, tags.url, tags.monospace, tags.quote, tags.contentSeparator,
        ...Object.values(MARKDOWN_SOURCE_TAGS),
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
