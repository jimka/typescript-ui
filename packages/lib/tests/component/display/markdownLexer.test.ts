// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for the Markdown lexer's linear-time rewrite
// (plans/implemented/markdown-lexer-linear-time.md). Two things are pinned
// here, and the second is the one that matters:
//
// 1. The two block extensions (`mdtable`, `mdblock`) emit exactly the tokens
//    they emitted when each of them split the whole remaining document into
//    lines at every block position. Direct token cases, because the
//    differential twin below shares the extensions and so cannot witness them.
// 2. Bounding six of `marked`'s own block rules — a guard that skips the rule
//    where its construct cannot start, and a window that hands it only the
//    text its construct can span — changed no token. Every case here asserts
//    `lexMarkdown` against `lexMarkdownUnbounded`, the same dialect with
//    neither guard nor window, so a future `marked` upgrade that breaks a
//    window's assumption fails here rather than in a render.
//
// The complexity cases count the characters the six rules' regexes scan
// rather than timing the lex: `marked` is already linear in V8, the engine
// vitest runs, so a timing bound here would pass with the whole fix missing.
// The count is what JavaScriptCore — the engine WebKitGTK runs, where the
// quadratic cost was measured — actually pays for.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Lexer } from 'marked';
import { lexMarkdown, lexMarkdownUnbounded, type MdBlockToken } from '~/component/display/markdownExtensions';
import type { MdTableToken } from '~/component/display/markdownTableExtension';
import { Markdown } from '~/component/display/Markdown';
import { DOM, type Handle } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

/**
 * The ratio the complexity cases allow between an 8x longer document and the
 * shorter one. Linear growth would be 8x; 10x leaves room for the fixed
 * per-document work without admitting anything superlinear (today's lexer
 * scores about 64.5).
 */
const LINEAR_GROWTH_BOUND = 10;

/** Lexes `source` and returns token `index`, typed as the extension token the case expects. */
function tokenAt<T>(source: string, index: number): T {
    return lexMarkdown(source)[index] as T;
}

describe('the table extension emits the same tokens as the line-splitting original', () => {
    it('takes header, delimiter and body, and leaves the rest of the document alone', () => {
        const tokens = lexMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter');
        const table = tokens[0] as MdTableToken;

        expect(table.type).toBe('mdtable');
        expect(table.raw).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
        expect(table.rows.map((row) => row.map((cell) => cell.text))).toEqual([['1', '2']]);
        expect(tokens[1]).toMatchObject({ type: 'space', raw: '\n\n' });
        expect(tokens[2]).toMatchObject({ type: 'paragraph', text: 'after' });
    });

    it('runs its body to the end of an unterminated document', () => {
        const tokens = lexMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |');

        expect(tokens).toHaveLength(1);
        expect(tokens[0] as MdTableToken).toMatchObject({ type: 'mdtable', raw: '| a | b |\n| --- | --- |\n| 1 | 2 |' });
    });

    it('accepts a header and delimiter with no body rows', () => {
        const tokens = lexMarkdown('| a | b |\n| --- | --- |\n');
        const table = tokens[0] as MdTableToken;

        expect(tokens).toHaveLength(1);
        expect(table.type).toBe('mdtable');
        expect(table.raw).toBe('| a | b |\n| --- | --- |\n');
        expect(table.rows).toEqual([]);
    });

    it('stops the body at a spaces-only line', () => {
        const tokens = lexMarkdown('| a |\n| - |\n| 1 |\n   \nnext');

        expect(tokens[0] as MdTableToken).toMatchObject({ type: 'mdtable', raw: '| a |\n| - |\n| 1 |' });
        expect(tokens[1]).toMatchObject({ type: 'space', raw: '\n   \n' });
        expect(tokens[2]).toMatchObject({ type: 'paragraph', text: 'next' });
    });

    it('declines a header with no delimiter row, and a delimiter of the wrong width', () => {
        for (const source of ['| a | b |', '| a | b |\n| --- |']) {
            const tokens = lexMarkdown(source);

            expect(tokens.map((token) => token.type)).toEqual(['paragraph']);
        }
    });
});

describe('the fence extension emits the same tokens as the line-splitting original', () => {
    it('takes the opening line through the matching close, and lexes the inside', () => {
        const tokens = lexMarkdown('::: {align=center}\ntext\n:::\nafter');
        const block = tokens[0] as MdBlockToken;

        expect(block.type).toBe('mdblock');
        expect(block.raw).toBe('::: {align=center}\ntext\n:::\n');
        expect(block.attributes).toEqual({ align: 'center' });
        expect(block.columns).toHaveLength(1);
        expect(block.columns[0]!.map((token) => token.type)).toEqual(['paragraph']);
        expect(block.columns[0]![0]).toMatchObject({ text: 'text' });
        expect(tokens[1]).toMatchObject({ type: 'paragraph', text: 'after' });
    });

    it('nests, closing on the fence that matches its own depth', () => {
        const source = '::: {a=1}\n::: {b=2}\nx\n:::\n:::';
        const outer = tokenAt<MdBlockToken>(source, 0);

        expect(outer.type).toBe('mdblock');
        expect(outer.raw).toBe(source);
        expect(outer.columns).toHaveLength(1);

        const inner = outer.columns[0]![0] as MdBlockToken;

        expect(inner.type).toBe('mdblock');
        expect(inner.raw).toBe('::: {b=2}\nx\n:::');
    });

    it('declines an unterminated fence and a bare opener', () => {
        for (const source of ['::: {a=1}\ntext', ':::\ntext\n:::']) {
            const tokens = lexMarkdown(source);

            expect(tokens.map((token) => token.type)).toEqual(['paragraph']);
        }
    });

    it('gives an immediately closed fence one empty column', () => {
        const block = tokenAt<MdBlockToken>('::: {a=1}\n:::', 0);

        expect(block.type).toBe('mdblock');
        expect(block.columns).toEqual([[]]);
    });
});

/**
 * Sources whose constructs span blank lines, hold column-0 lines, or continue
 * onto a following block — the shapes a window that cut the source too early
 * would lex differently. Reused with CRLF line endings below.
 */
const WINDOW_SOURCES: readonly string[] = [
    // A loose list continuing across blank lines onto an indented line.
    '- a\n\n- b\n\n  more\n\nNext\n',
    // Ordered lists in all three marker forms.
    '1. a\n\n2) b\n\n10. c\n\nnext',
    // Setext headings: underlined by `=`, by `-`, and over two content lines.
    'Title\n===\n\ntext',
    'Title\n---',
    'a\nb\n---\n\nc',
    // `hr` where its own characters also open list items.
    '- - -\n\n***\n\n---\n\n- item',
    // A blockquote with a lazy continuation line, then a second blockquote.
    '> a\nlazy\n\n> b',
    // Constructs that run through blank lines and column-0 lines: an HTML
    // comment, a code fence, a `:::` column fence, and indented code.
    '<!--\n\n# not a heading\n\n-->\n\nafter',
    '```\ncode\n\n# not a heading\n```',
    '::: {cols=2}\na\n\n# h\n|||\nb\n:::',
    '    a\n\n    b\n\nnext',
    // A reference definition that only resolves a use above it.
    'see [ref]\n\n[ref]: https://example.com',
];

describe('the bounded block tokenizers lex identically to the unbounded twin', () => {
    it('keeps a loose list whole and the paragraph after it separate', () => {
        const source = '- a\n\n- b\n\n  more\n\nNext\n';
        const tokens = lexMarkdown(source);

        expect(tokens[0]).toMatchObject({ type: 'list', raw: '- a\n\n- b\n\n  more' });
        expect(tokens.at(-1)).toMatchObject({ type: 'paragraph', text: 'Next' });
    });

    it.each(WINDOW_SOURCES)('lexes %j identically', (source) => {
        expect(lexMarkdown(source)).toEqual(lexMarkdownUnbounded(source));
    });

    it.each(WINDOW_SOURCES)('lexes %j identically with CRLF line endings', (source) => {
        const crlf = source.replace(/\n/g, '\r\n');

        expect(lexMarkdown(crlf)).toEqual(lexMarkdownUnbounded(crlf));
    });
});

/**
 * Mirrors the shape of the QA app's own `markdownDocument` builder
 * (`packages/qa/src/builders/data.ts`), which the library's tests cannot
 * import. The periods — a bullet list every third section, a code fence every
 * fourth, a pipe table every fifth — are the generator's own, so every
 * construct recurs throughout the document instead of clustering at one end.
 *
 * @param sections - How many `## Section n` blocks the document holds.
 * @returns The generated Markdown source.
 */
function qaShapedDocument(sections: number): string {
    const blocks = ['# Document'];

    for (let i = 0; i < sections; i++) {
        const n = i + 1;

        blocks.push(`## Section ${n}`, `Section ${n} prose. It wraps when the pane narrows.`);

        if (i % 3 === 2) {
            blocks.push([1, 2, 3, 4].map((k) => `- Point ${k} of section ${n}`).join('\n'));
        }

        if (i % 4 === 3) {
            blocks.push(['```ts', `const section = ${n};`, 'console.log(section);', '```'].join('\n'));
        }

        if (i % 5 === 4) {
            blocks.push(['| Name | Count |', '| --- | --- |', ...[1, 2, 3].map((r) => `| Row ${r} | ${n * r} |`)].join('\n'));
        }
    }

    return blocks.join('\n\n') + '\n';
}

/**
 * The lines the random documents are drawn from: one per construct the
 * dialect recognises, plus the blank, spaces-only and tab-only lines that
 * decide where a window ends. The last entry is a backslash followed by `n`,
 * the table cell's line-break escape.
 */
const LINE_POOL: readonly string[] = [
    '# Heading', '## Sub', 'Paragraph text with **bold** and `code`.', 'Setext title', '===', '---', '- item', '- item two',
    '* star item', '1. first', '2) second', '10. ten', '1.5 million', '  indented continuation', '    indented code',
    '> quote', '> > nested quote', 'lazy continuation', '```ts', '```', '~~~', '~~~~', '  ```', '<!-- comment', '-->',
    '<div>', '</div>', '<script>', '</script>', '<?php', '?>', '| a | b |', '| --- | --- |', '|---|:-:{width=80}|',
    '| x | << |', '| ^^ | y |', 'a | b', '-|-', '::: {align=center}', ':::', '|||', '::: {cols=2}', '', '', '', ' ',
    '\t', '  ', '***', '___', '- - -', '[ref]: https://example.com "t"', 'see [ref] here', '![img](a.png){width=10}',
    '[span]{color=red}', '++under++', '\\n',
];

/**
 * Builds documents from `LINE_POOL` with a seeded linear-congruential
 * generator, so the suite draws the same documents on every run and a failure
 * names a reproducible one. The indent probability and the trailing-newline
 * coin are what put a drawn line inside a list item or a code block rather
 * than at column 0.
 *
 * @param count - How many documents to build.
 * @returns The generated documents, in draw order.
 */
function randomDocuments(count: number): string[] {
    // The numeric-recipes LCG constants, and a seed chosen once so the draw is
    // reproducible; any full-period pair would do.
    let state = 12345;

    const next = (): number => {
        state = (state * 1664525 + 1013904223) >>> 0;

        return state / 4294967296;
    };

    const documents: string[] = [];

    for (let index = 0; index < count; index += 1) {
        // 1-25 lines: long enough to hold a construct and the blank lines
        // around it, short enough that a failure is readable.
        const lineCount = 1 + Math.floor(next() * 25);
        const lines: string[] = [];

        for (let line = 0; line < lineCount; line += 1) {
            const pooled = LINE_POOL[Math.floor(next() * LINE_POOL.length)]!;

            // 0.15: indented lines are the continuation case, so they have to
            // be common enough to land inside a construct but not so common
            // that most documents are one indented code block.
            lines.push(next() < 0.15 ? `  ${pooled}` : pooled);
        }

        documents.push(lines.join('\n') + (next() < 0.5 ? '\n' : ''));
    }

    return documents;
}

describe('the bounded block tokenizers lex generated documents identically', () => {
    it.each([1, 3, 7, 60])('lexes a %i-section QA-shaped document identically', (sections) => {
        const source = qaShapedDocument(sections);

        expect(lexMarkdown(source)).toEqual(lexMarkdownUnbounded(source));
    });

    // 5,000 draws: a window that ignored list-marker lines differed from the
    // twin on 59 of 20,000 documents from this pool, so 5,000 catch that class
    // of mistake about 15 times over, in about 0.3 s.
    it('lexes 5,000 seeded random documents identically', () => {
        const differing: string[] = [];

        randomDocuments(5_000).forEach((source, index) => {
            try {
                expect(lexMarkdown(source)).toEqual(lexMarkdownUnbounded(source));
            } catch {
                differing.push(`#${index}: ${JSON.stringify(source)}`);
            }
        });

        expect(differing).toEqual([]);
    });
});

/** The six block rules whose anchored regexes JavaScriptCore scans from every start position. */
const SLOW_RULES = ['hr', 'blockquote', 'list', 'html', 'table', 'lheading'] as const;

/** One lex's scanned-character totals: what the six rules were handed, and what was split into lines whole. */
interface ScanCounts {
    ruleChars:  number;
    splitChars: number;
}

/**
 * Lexes `source` with the six slow rules' regexes and `String.prototype.split`
 * instrumented, counting the characters each was handed. Counting at the
 * regexes rather than at the tokenizer methods means the count cannot be
 * fooled by how an override calls the original.
 *
 * @param source - The Markdown source to lex.
 * @returns The characters handed to the six rules, and to whole-string line splits.
 */
function measureScan(source: string): ScanCounts {
    const counts: ScanCounts = { ruleChars: 0, splitChars: 0 };
    const rules = Lexer.rules.block.gfm as unknown as Record<string, RegExp>;
    const originalSplit = String.prototype.split;
    // Narrowed to the `string | RegExp` overload: `call` on the overloaded
    // builtin otherwise resolves to its `[Symbol.split]` splitter form.
    const callOriginalSplit = originalSplit as (this: string, separator: string | RegExp, limit?: number) => string[];

    for (const name of SLOW_RULES) {
        Object.defineProperty(rules[name]!, 'exec', {
            configurable: true,
            writable:     true,
            value(this: RegExp, input: string): RegExpExecArray | null {
                counts.ruleChars += input.length;

                // `RegExp.prototype.test` reaches its subject through `exec`
                // too, so both call paths are counted by this one property.
                return RegExp.prototype.exec.call(this, input);
            },
        });
    }

    String.prototype.split = function (this: string, separator?: unknown, limit?: number): string[] {
        if (separator === '\n' && limit === undefined) {
            counts.splitChars += this.length;
        }

        return callOriginalSplit.call(this, separator as string, limit);
    } as typeof String.prototype.split;

    try {
        lexMarkdown(source);
    } finally {
        String.prototype.split = originalSplit;

        for (const name of SLOW_RULES) {
            delete (rules[name] as unknown as Record<string, unknown>).exec;
        }
    }

    return counts;
}

describe('one lex scans a number of characters proportional to the document', () => {
    // 60 and 480 sections are W3.0's two lexer cells (`mdu` and `mdu480`), so
    // the bound here is read at the same two document sizes the in-engine
    // measurement uses.
    const small = qaShapedDocument(60);
    const large = qaShapedDocument(480);

    it('grows the total scanned characters at most 10x for an 8x longer document', () => {
        const smallCounts = measureScan(small);
        const largeCounts = measureScan(large);

        expect(largeCounts.ruleChars + largeCounts.splitChars)
            .toBeLessThanOrEqual(LINEAR_GROWTH_BOUND * (smallCounts.ruleChars + smallCounts.splitChars));
    });

    it('grows the characters split into lines whole at most 10x for an 8x longer document', () => {
        expect(measureScan(large).splitChars).toBeLessThanOrEqual(LINEAR_GROWTH_BOUND * measureScan(small).splitChars);
    });
});

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** A document with a heading, a table and a list, sized by how many of each it repeats. */
function documentWithTableAndList(repeats: number): string {
    const blocks = ['# Doc'];

    for (let i = 1; i <= repeats; i += 1) {
        blocks.push(
            `## Part ${i}`,
            ['| Name | Count |', '| --- | --- |', `| Row ${i} | ${i} |`].join('\n'),
            [`- point ${i}a`, `- point ${i}b`].join('\n'),
        );
    }

    return blocks.join('\n\n') + '\n';
}

/** The private rebuild bookkeeping `clearContent` and `create` maintain. */
interface MarkdownHandleBookkeeping {
    _contentHandles: Handle[];
    _ownedHandles:   Handle[];
}

describe('rebuilding a Markdown untracks the old content and tracks the new', () => {
    beforeEach(() => installTestDOM(DOM_CONFIG));
    afterEach(() => DOM.reset());

    it('keeps the owned-handle list exactly the old list minus the old content plus the new', () => {
        const markdown = new Markdown(documentWithTableAndList(3));

        markdown.getElement(true);

        const bookkeeping = markdown as unknown as MarkdownHandleBookkeeping;
        const contentBefore = [...bookkeeping._contentHandles];
        const ownedCountBefore = bookkeeping._ownedHandles.length;

        markdown.setMarkdown(documentWithTableAndList(7));

        const contentAfter = [...bookkeeping._contentHandles];
        const owned = new Set(bookkeeping._ownedHandles);

        expect(contentBefore.length).toBeGreaterThan(0);
        expect(contentAfter.length).toBeGreaterThan(contentBefore.length);
        expect(contentAfter.filter((handle) => !owned.has(handle))).toEqual([]);
        expect(contentBefore.filter((handle) => owned.has(handle))).toEqual([]);
        expect(bookkeeping._ownedHandles).toHaveLength(ownedCountBefore - contentBefore.length + contentAfter.length);
    });
});
