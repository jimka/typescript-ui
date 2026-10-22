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
import type { Token, Tokens } from 'marked';
import { tabDocuments } from '../markdown-roundtrip/tabDocuments';
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

describe('the table tokenizer emits the same tokens as the line-splitting original', () => {
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

describe('the table tokenizer lexes cells after the definitions are known', () => {
    it('resolves a cell reference whose definition follows the table (L1)', () => {
        const table = tokenAt<MdTableToken>('| a |\n| --- |\n| [ref] |\n\n[ref]: https://e.com', 0);

        expect(table.rows[0]![0]!.tokens[0]).toMatchObject({ type: 'link', href: 'https://e.com' });
    });

    it('resolves a header-cell reference whose definition follows the table', () => {
        const table = tokenAt<MdTableToken>('| [ref] |\n| --- |\n| b |\n\n[ref]: https://e.com', 0);

        expect(table.header[0]!.tokens[0]).toMatchObject({ type: 'link', href: 'https://e.com' });
    });
});

/**
 * The source text of a token's inline children, with the task-item checkbox
 * `marked` prepends to a loose item's first paragraph left out — so the result
 * is exactly the text the inline pass lexed.
 */
function inlineSource(token: { tokens?: Token[] }): string {
    return (token.tokens ?? []).filter((child) => child.type !== 'checkbox').map((child) => child.raw).join('');
}

/** The items of the list token at `index` of `source`'s top-level tokens. */
function listItemsAt(source: string, index: number): Tokens.ListItem[] {
    return tokenAt<Tokens.List>(source, index).items;
}

/** The item's tokens that carry inline children — its paragraphs and text runs. */
function textBlocks(item: Tokens.ListItem): (Tokens.Paragraph | Tokens.Text)[] {
    return item.tokens.filter((token): token is Tokens.Paragraph | Tokens.Text => token.type === 'paragraph' || token.type === 'text');
}

/** The first token of `type` among the item's own block tokens. */
function childOfType<T>(item: Tokens.ListItem, type: string): T {
    return item.tokens.find((token) => token.type === type) as T;
}

describe("a task-list item's marker comes off the item's own first text", () => {
    it('leaves a later table cell that starts with a marker untouched', () => {
        const source = '- [ ] foo\n  | a |\n  | - |\n  | [x] baz |';
        const [item] = listItemsAt(source, 0);

        expect(item).toMatchObject({ task: true, checked: false });
        expect(inlineSource(textBlocks(item!)[0]!)).toBe('foo');
        expect(inlineSource(childOfType<MdTableToken>(item!, 'mdtable').rows[0]![0]!)).toBe('[x] baz');
        expect(lexMarkdown(source)).toEqual(lexMarkdownUnbounded(source));
    });

    it('leaves a later paragraph that starts with a marker untouched', () => {
        const source = '- [ ] foo\n\n  [x] bar';
        const [item] = listItemsAt(source, 0);

        expect(item).toMatchObject({ task: true, checked: false });
        expect(textBlocks(item!).map(inlineSource)).toEqual(['foo', '[x] bar']);
        expect(lexMarkdown(source)).toEqual(lexMarkdownUnbounded(source));
    });

    it('strips a loose item, whose checkbox sits inside its first paragraph, from its own text', () => {
        const source = '- [x] one\n\n- [ ] two\n\n  [X]  three';
        const items = listItemsAt(source, 0);

        expect(items.map((item) => [item.loose, item.task, item.checked])).toEqual([[true, true, true], [true, true, false]]);
        expect(textBlocks(items[1]!)[0]).toMatchObject({ tokens: [{ type: 'checkbox', checked: false }, { type: 'text' }] });
        expect(textBlocks(items[0]!).map(inlineSource)).toEqual(['one']);
        expect(textBlocks(items[1]!).map(inlineSource)).toEqual(['two', '[X]  three']);
        expect(lexMarkdown(source)).toEqual(lexMarkdownUnbounded(source));
    });

    it('keeps the marker text of a nested plain item inside an outer task item', () => {
        const source = '- [ ] a\n  - c\n\n    [x] d';
        const [outer] = listItemsAt(source, 0);
        const nested = childOfType<Tokens.List>(outer!, 'list');

        expect(outer).toMatchObject({ task: true, checked: false });
        expect(inlineSource(textBlocks(outer!)[0]!)).toBe('a');
        expect(nested.items[0]!.task).toBe(false);
        expect(textBlocks(nested.items[0]!).map(inlineSource)).toEqual(['c', '[x] d']);
        expect(lexMarkdown(source)).toEqual(lexMarkdownUnbounded(source));
    });

    it('strips each nested task item from its own text, and no later block', () => {
        const source = '- [ ] outer\n  - [x] inner\n\n    [ ] inner para\n\n  [x] outer para';
        const [outer] = listItemsAt(source, 0);
        const nested = childOfType<Tokens.List>(outer!, 'list');

        expect(outer).toMatchObject({ task: true, checked: false });
        expect(nested.items[0]).toMatchObject({ task: true, checked: true });
        expect(textBlocks(outer!).map(inlineSource)).toEqual(['outer', '[x] outer para']);
        expect(textBlocks(nested.items[0]!).map(inlineSource)).toEqual(['inner', '[ ] inner para']);
        expect(lexMarkdown(source)).toEqual(lexMarkdownUnbounded(source));
    });

    it('changes nothing in a list with no task items', () => {
        const source = '- a\n\n  [x] b\n- c [ ] d\n- e\n  | h |\n  | - |\n  | [ ] f |';
        const items = listItemsAt(source, 0);

        expect(items.map((item) => item.task)).toEqual([false, false, false]);
        expect(items.map((item) => textBlocks(item).map(inlineSource))).toEqual([['a', '[x] b'], ['c [ ] d'], ['e']]);
        expect(inlineSource(childOfType<MdTableToken>(items[2]!, 'mdtable').rows[0]![0]!)).toBe('[ ] f');
        expect(lexMarkdown(source)).toEqual(lexMarkdownUnbounded(source));
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

/** One top-level token summarised as its type and text, or, for a fence, its columns summarised alike. */
type TokenSummary = string | { mdblock: TokenSummary[][] };

/**
 * Summarises tokens as `type "text"` strings, a fence as its columns of such
 * summaries, so a case can state a fence's whole shape in one literal.
 *
 * @param tokens - The tokens, `space` tokens dropped.
 * @returns The summaries, in order.
 */
function summarise(tokens: readonly Token[]): TokenSummary[] {
    return tokens.filter((token) => token.type !== 'space').map((token) => (token.type === 'mdblock'
        ? { mdblock: (token as MdBlockToken).columns.map(summarise) }
        : `${token.type} ${JSON.stringify((token as { text?: string }).text)}`));
}

describe('the fence extension reads code fences inside a fence', () => {
    it('CF1: a ::: line inside a code block is code, not the closer', () => {
        const source = '::: columns\n```\n:::\n```\n|||\nB\n:::';

        expect(tokenAt<MdBlockToken>(source, 0).raw).toBe(source);
        expect(summarise(lexMarkdown(source))).toEqual([{ mdblock: [['code ":::"'], ['paragraph "B"']] }]);
    });

    it('CF2: a ::: x line inside a code block is code, not a nested opener', () => {
        expect(summarise(lexMarkdown('::: columns\n```\n::: x\n```\n|||\nB\n:::'))).toEqual([
            { mdblock: [['code "::: x"'], ['paragraph "B"']] },
        ]);
    });

    it('CF3: a shorter backtick run does not close a longer code fence', () => {
        expect(summarise(lexMarkdown('::: columns\n````\n```\n````\n|||\nB\n:::'))).toEqual([
            { mdblock: [['code "```"'], ['paragraph "B"']] },
        ]);
    });

    it('CF4: a backtick run does not close a tilde code fence', () => {
        expect(summarise(lexMarkdown('::: columns\n~~~\n```\n~~~\n|||\nB\n:::'))).toEqual([
            { mdblock: [['code "```"'], ['paragraph "B"']] },
        ]);
    });

    it('CF5: a closing run followed by more fence characters closes the code', () => {
        expect(summarise(lexMarkdown('::: columns\n```\na\n```~\n|||\nB\n:::'))).toEqual([
            { mdblock: [['code "a"'], ['paragraph "B"']] },
        ]);
    });

    it('CF6: a run followed by text does not close the code, which then hides the closer', () => {
        expect(summarise(lexMarkdown('::: columns\n```\na\n``` x\n|||\nB\n:::'))).toEqual([
            'paragraph "::: columns"',
            'code "a\\n``` x\\n|||\\nB\\n:::"',
        ]);
    });

    it('CF7: a code block left open hides the closing line, so the fence declines', () => {
        expect(summarise(lexMarkdown('::: columns\nA\n|||\n```\nB\n:::'))).toEqual([
            'paragraph "::: columns\\nA\\n|||"',
            'code "B\\n:::"',
        ]);
    });

    it('CF8: a backtick run whose info string holds a backtick opens no code', () => {
        expect(summarise(lexMarkdown('::: {align=center}\n``` a`b\n:::'))).toEqual([
            { mdblock: [['paragraph "``` a`b"']] },
        ]);
    });

    it('CF9: a code block inside a nested fence keeps its ||| as code', () => {
        expect(summarise(lexMarkdown('::: columns\n::: {align=right}\n```\n|||\n```\n:::\n|||\nB\n:::'))).toEqual([
            { mdblock: [[{ mdblock: [['code "|||"']] }], ['paragraph "B"']] },
        ]);
    });

    it('CF10: an indented code fence inside a fence is tracked too', () => {
        expect(summarise(lexMarkdown('::: columns\n  ```\n  :::\n  ```\n|||\nB\n:::'))).toEqual([
            { mdblock: [['code ":::"'], ['paragraph "B"']] },
        ]);
    });

    it('CF11: a code fence opened on a list item\'s marker line is tracked, so its closing line opens nothing', () => {
        expect(summarise(lexMarkdown('::: {align=center}\n- ```\n  x\n  ```\n:::\n\nafter'))).toEqual([
            { mdblock: [['list undefined']] },
            'paragraph "after"',
        ]);
    });

    it('CF12: a fence opened on a list item\'s marker line nests, so its indented closer does not close the outer fence', () => {
        const source = '::: {align=center}\n- ::: {align=right}\n  x\n  :::\n:::';

        expect(tokenAt<MdBlockToken>(source + '\n\nafter', 0).raw.trimEnd()).toBe(source);
        expect(summarise(lexMarkdown(source))).toEqual([{ mdblock: [['list undefined']] }]);
    });
});

/**
 * The token types of each column of the first `:::` fence in the first list
 * item of `source`'s first block, `space` tokens dropped.
 */
function fenceColumnTypes(source: string): string[][] {
    const fence = childOfType<MdBlockToken>(listItemsAt(source, 0)[0]!, 'mdblock');

    return fence.columns.map((column) => column.filter((token) => token.type !== 'space').map((token) => token.type));
}

/** Fences standing in a list item: opening it, under its text, and after its nested list. */
const LIST_ITEM_FENCE_SOURCES: readonly string[] = [
    '- ::: columns\n  **left**\n  |||\n  right\n  :::',
    '- a\n\n  ::: {align=center}\n  x\n  :::',
    '- a\n  - b\n\n  ::: x\n  w\n  :::',
];

describe('the fence extension lexes a fence in a list item as blocks', () => {
    it('LI1: every column of a fence opening a list item holds a paragraph', () => {
        expect(fenceColumnTypes(LIST_ITEM_FENCE_SOURCES[0]!)).toEqual([['paragraph'], ['paragraph']]);
    });

    it('LI2: a fence under a list item\'s text holds a paragraph', () => {
        expect(fenceColumnTypes(LIST_ITEM_FENCE_SOURCES[1]!)).toEqual([['paragraph']]);
    });

    it('LI3: a fence after a list item\'s nested list holds a paragraph', () => {
        expect(fenceColumnTypes(LIST_ITEM_FENCE_SOURCES[2]!)).toEqual([['paragraph']]);
    });

    it.each(LIST_ITEM_FENCE_SOURCES)('LI4: the bounded lexer reads %j as the unbounded twin does', (source) => {
        expect(lexMarkdown(source)).toEqual(lexMarkdownUnbounded(source));
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
    // A setext heading the table tokenizer must not take as a one-column table.
    'Foo\n---\nbar',
    // A quote list whose lazy lines make `marked` rebuild the quote's `raw`.
    '> - a\n> - a\nc\n> - a\nc\n<div>',
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
 * `LINE_POOL` without its definition line — a repeated definition emits no
 * token, so its text would be in no `raw` — plus quoted list lines, whose
 * lazy continuations are what make `marked` rebuild a blockquote's `raw`.
 */
const RAW_SOURCE_POOL: readonly string[] = [
    ...LINE_POOL.filter((line) => !line.startsWith('[ref]:')), '> - a', '> -', '> 1. a',
];

/**
 * Builds documents from a pool of lines with a seeded linear-congruential
 * generator, so the suite draws the same documents on every run and a failure
 * names a reproducible one. The indent probability and the trailing-newline
 * coin are what put a drawn line inside a list item or a code block rather
 * than at column 0.
 *
 * @param count - How many documents to build.
 * @param pool - The lines to draw from.
 * @returns The generated documents, in draw order.
 */
function randomDocuments(count: number, pool: readonly string[] = LINE_POOL): string[] {
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
            const pooled = pool[Math.floor(next() * pool.length)]!;

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

/** The top-level token types `lexMarkdown` emits for `source`, in order. */
function typesOf(source: string): string[] {
    return lexMarkdown(source).map((token) => token.type);
}

/** The tokens' `raw`s joined in order — the source they consumed. */
function joinedRaws(tokens: readonly Token[]): string {
    return tokens.map((token) => token.raw).join('');
}

describe('the table tokenizer runs where marked tries its own table rule', () => {
    it('LX1. reads a line over --- as a setext heading, not a one-column table', () => {
        const tokens = lexMarkdown('Foo\n---\nbar');

        expect(tokens.map((token) => token.type)).toEqual(['heading', 'paragraph']);
        expect(tokens[0]).toMatchObject({ depth: 2 });
    });

    it('LX2. reads a fenced code block whose first line is --- as code', () => {
        const tokens = lexMarkdown('```\n---\n```');

        expect(tokens.map((token) => token.type)).toEqual(['code']);
        expect(tokens[0]).toMatchObject({ text: '---' });
    });

    it('LX3. reads a list with a bare - item as one list of three items', () => {
        const tokens = lexMarkdown('- foo\n-\n- bar');

        expect(tokens.map((token) => token.type)).toEqual(['list']);
        expect((tokens[0] as Tokens.List).items).toHaveLength(3);
    });

    it('LX4. reads three thematic breaks as three hr tokens', () => {
        expect(typesOf('***\n---\n___')).toEqual(['hr', 'hr', 'hr']);
    });

    it('LX5. reads --- after a blockquote as a thematic break', () => {
        expect(typesOf('> Foo\n---')).toEqual(['blockquote', 'hr']);
    });

    it('LX6. reads --- after a blank line as a thematic break', () => {
        expect(typesOf('> - a\nb\n\n---')).toEqual(['blockquote', 'space', 'hr']);
    });

    it('LX7. still reads a one-column table written with its pipes', () => {
        expect(typesOf('| a |\n| - |\n| 1 |')).toEqual(['mdtable']);
    });

    it('LX8. still reads a delimiter row holding only a colon as a table', () => {
        expect(typesOf('a\n:-:')).toEqual(['mdtable']);
    });

    it('LX9. still reads a {width=…} delimiter cell', () => {
        const tokens = lexMarkdown('| a |\n| :--- {width=240} |\n| 1 |');

        expect(tokens.map((token) => token.type)).toEqual(['mdtable']);
        expect((tokens[0] as unknown as MdTableToken).widths).toEqual([240]);
    });
});

describe('a blockquote\'s raw is the source it used', () => {
    it('LX10. leaves the html line after a quote list with lazy lines whole', () => {
        const source = '> - a\n> - a\nc\n> - a\nc\n<div>';
        const tokens = lexMarkdown(source);

        expect(joinedRaws(tokens)).toBe(source);
        expect(tokens.at(-1)).toMatchObject({ type: 'html', raw: '<div>' });
    });

    it('LX11. leaves the ordered item after a quote list with lazy lines whole', () => {
        const source = '> - a\n> - a\nc\n> - a\nc\n1. g';
        const tokens = lexMarkdown(source);

        expect(joinedRaws(tokens)).toBe(source);
        expect(tokens.at(-1)).toMatchObject({ type: 'list', raw: '1. g' });
    });

    it('LX12. leaves the paragraph after a quote that ends at a code fence whole', () => {
        const source = '> - a\nb\n> ```\nc';
        const tokens = lexMarkdown(source);

        expect(joinedRaws(tokens)).toBe(source);
        expect(tokens.at(-1)).toMatchObject({ type: 'paragraph', raw: 'c' });
    });

    // 5,000 draws: on the unfixed lexer, 981 of 20,000 documents from this
    // pool did not join back into their source, so 5,000 catch the defect
    // about 245 times, in under half a second.
    it('LX13. joins the top-level raws of 5,000 seeded random documents back into each document', () => {
        const differing: string[] = [];

        randomDocuments(5_000, RAW_SOURCE_POOL).forEach((source, index) => {
            const joined = joinedRaws(lexMarkdown(source));

            if (joined !== source) {
                differing.push(`#${index}: ${JSON.stringify(source)}`);
            }
        });

        expect(differing).toEqual([]);
    });
});

describe('a tab counts to its tab stop, and a content tab is kept', () => {
    it('LX30. keeps the tab of a code span in a list item', () => {
        const list = lexMarkdown('- a `x\ty`')[0] as Tokens.List;
        const text = list.items[0]!.tokens[0] as Tokens.Text;

        expect(list.items[0]!.text).toBe('a `x\ty`');
        expect(text.tokens![1]).toMatchObject({ type: 'codespan', text: 'x\ty' });
    });

    it('LX31. sets a list\'s raw and each item\'s back to the source', () => {
        const source = '-\tone\n\n\tsecond\n- two\n\nafter';
        const tokens = lexMarkdown(source);
        const list = tokens[0] as Tokens.List;

        expect(list.raw).toBe('-\tone\n\n\tsecond\n- two');
        expect(list.items.map((item) => item.raw)).toEqual(['-\tone\n\n\tsecond\n', '- two']);
        expect(list.items.map((item) => item.text)).toEqual(['one\n\nsecond', 'two']);
        expect(joinedRaws(tokens)).toBe(source);
    });

    it('LX32. keeps the tab of an HTML block in a list item', () => {
        const list = lexMarkdown('- <pre>\n  a\tb\n  </pre>')[0] as Tokens.List;

        expect(list.items[0]!.tokens[0]).toMatchObject({ type: 'html', text: '<pre>\na\tb\n</pre>' });
    });

    it('LX33. takes a tab after spaces off an indented code line', () => {
        expect(lexMarkdown('  \tfoo\n\nafter')[0]).toMatchObject({ type: 'code', raw: '  \tfoo', text: 'foo' });
    });

    it('LX34. takes one column off a tab-indented line under a fence indented by one space', () => {
        const source = ' ```\n\tx\n ```\nafter';
        const tokens = lexMarkdown(source);

        expect(tokens[0]).toMatchObject({ type: 'code', raw: ' ```\n\tx\n ```\n', text: '   x' });
        expect(joinedRaws(tokens)).toBe(source);
    });

    it('LX35. sets a quote\'s raw back to the source, lazy line included', () => {
        const source = '> - a\n>\t- b\nlazy\n\nafter';
        const tokens = lexMarkdown(source);
        const quote = tokens[0] as Tokens.Blockquote;

        expect(quote).toMatchObject({ type: 'blockquote', raw: '> - a\n>\t- b\nlazy' });
        expect((quote.tokens[0] as Tokens.List).items).toHaveLength(1);
        expect(joinedRaws(tokens)).toBe(source);
    });

    // 3,000 draws give 2,932 documents. Both checks hold before the tab tokenizers too: this row guards the two
    // `raw` restores and the windows.
    it('LX36. joins the top-level raws of 3,000 drawn tab documents back into each document, as the unbounded twin lexes them', () => {
        const differing: string[] = [];

        tabDocuments(3_000).forEach((source, index) => {
            const tokens = lexMarkdown(source);

            try {
                expect(joinedRaws(tokens)).toBe(source);
                expect(tokens).toEqual(lexMarkdownUnbounded(source));
            } catch {
                differing.push(`#${index}: ${JSON.stringify(source)}`);
            }
        });

        expect(differing).toEqual([]);
    });
});

/** Block tag names with nothing after them: each starts an HTML block before a line end (CommonMark's start conditions 1 and 6). */
const HTML_START_TAILS: readonly string[] = ['</div', '<pre', '<script', '<style', '<textarea', '<DIV', '   <div', '<h1', '<li'];

/** Lines that start no HTML block before a line end either: an inline tag name, a longer name, a lone `<`, a custom element. */
const NO_HTML_START_TAILS: readonly string[] = ['<span', '<a', '<divx', '<', '<x-y'];

/** A `:::` fence whose first column ends in a block tag name: a column's section reaches the block rules without its last line end. */
const COLUMN_TAIL_SOURCE = '::: columns\na\n\n<div\n|||\nb\n:::';

/**
 * Sources whose block tag name ends an input inside a list or a blockquote while the container goes on: `marked` lexes
 * a list item's content, and each run of a quote's `>` lines, as an input of its own. Each is named by where the tag
 * name stands.
 */
const CONTAINER_TAIL_SOURCES: ReadonlyArray<readonly [string, string]> = [
    ['a quote line before a lazy line', '> <div\nfoo'],
    ['a quote line before a lazy line, after a quoted paragraph', '> a\n>\n> <div\nfoo'],
    ['a list item\'s continuation line', '- a\n  <div'],
    ['a task item\'s continuation line', '- [x] a\n  <div'],
    ['an ordered item', '1. <div'],
    ['an item of a loose list', '- a\n\n- <div'],
    ['a list item in a column', '::: columns\n- <div\n|||\nb\n:::'],
];

/** The tag names of CommonMark's start condition 1, which end a paragraph in `marked` whatever follows them. */
const PARAGRAPH_ENDING_TAILS: readonly string[] = ['<pre', '<script', '<style', '<textarea'];

/** Every source rows LX14–LX22, LX25 and LX29 lex, for the comparison against the unbounded twin. */
const INPUT_END_SOURCES: readonly string[] = [
    '<div', ...HTML_START_TAILS, 'a\n\n<div', '<div\n', ...NO_HTML_START_TAILS, '    <div', COLUMN_TAIL_SOURCE, '- <div\n- b', '> <div', 'a\n<div',
    ...CONTAINER_TAIL_SOURCES.map(([, source]) => source), ...PARAGRAPH_ENDING_TAILS.map((tail) => `a\n${tail}`),
];

/** One block as its type, or, for a container, its type over what it holds: a fence's columns, a list's items, a quote's or an item's blocks. */
type BlockTypeNode = string | { [type: string]: BlockTypeNode[] | BlockTypeNode[][] };

/**
 * Reads a token list as nested block types, `space` tokens dropped, so two
 * sources can be compared by the blocks they read as, whatever their text.
 *
 * @param tokens - The block tokens.
 * @returns Each token's type, with its child blocks under it when it is a container.
 */
function blockTypeTree(tokens: readonly Token[]): BlockTypeNode[] {
    return tokens.filter((token) => token.type !== 'space').map((token): BlockTypeNode => {
        if (token.type === 'mdblock') {
            return { mdblock: (token as MdBlockToken).columns.map(blockTypeTree) };
        }

        if (token.type === 'list') {
            return { list: blockTypeTree((token as Tokens.List).items) };
        }

        if (token.type === 'blockquote' || token.type === 'list_item') {
            return { [token.type]: blockTypeTree((token as Tokens.Blockquote | Tokens.ListItem).tokens) };
        }

        return token.type;
    });
}

describe('an HTML block start ending its input reads as one before a line end', () => {
    it('LX14. reads a block tag name alone as one html token holding exactly the source', () => {
        const tokens = lexMarkdown('<div');

        expect(tokens).toHaveLength(1);
        expect(tokens[0]).toMatchObject({ type: 'html', raw: '<div', text: '<div' });
    });

    it.each(HTML_START_TAILS)('LX15. reads %j alone as an html token that used the whole source', (source) => {
        expect(typesOf(source)).toEqual(['html']);
        expect(joinedRaws(lexMarkdown(source))).toBe(source);
    });

    it('LX16. reads a block tag name ending the document, after a paragraph, as an html token', () => {
        const source = 'a\n\n<div';
        const tokens = lexMarkdown(source);

        expect(tokens.map((token) => token.type)).toEqual(['paragraph', 'space', 'html']);
        expect(tokens.at(-1)!.raw).toBe('<div');
        expect(joinedRaws(tokens)).toBe(source);
    });

    it('LX17. still reads a block tag name before a line end as one html token (control)', () => {
        const tokens = lexMarkdown('<div\n');

        expect(tokens).toHaveLength(1);
        expect(tokens[0]).toMatchObject({ type: 'html', raw: '<div\n' });
    });

    it.each(NO_HTML_START_TAILS)('LX18. still reads %j alone as a paragraph (control)', (source) => {
        expect(typesOf(source)).toEqual(['paragraph']);
    });

    it('LX19. still reads a block tag name indented four spaces as code (control)', () => {
        expect(typesOf('    <div')).toEqual(['code']);
    });

    it('LX20. reads a block tag name ending a column as an html token in that column', () => {
        const tokens = lexMarkdown(COLUMN_TAIL_SOURCE);
        const [first, second] = (tokens[0] as unknown as MdBlockToken).columns;

        expect(tokens.map((token) => token.type)).toEqual(['mdblock']);
        expect(first!.map((token) => token.type)).toEqual(['paragraph', 'space', 'html']);
        expect(first!.at(-1)!.raw).toBe('<div');
        expect(second!.map((token) => token.type)).toEqual(['paragraph']);
    });

    it('LX21. reads a block tag name ending a list item or a blockquote as an html token inside it', () => {
        const [first, second] = listItemsAt('- <div\n- b', 0);
        const quote = tokenAt<Tokens.Blockquote>('> <div', 0);

        expect(first!.tokens.map((token) => token.type)).toEqual(['html']);
        expect(first!.tokens[0]!.raw).toBe('<div');
        expect(second!.tokens.map((token) => token.type)).toEqual(['text']);
        expect(quote.tokens.map((token) => token.type)).toEqual(['html']);
    });

    // `marked`'s paragraph rule decides this one, not its HTML rule: it lets a paragraph run on over `<div` unless a
    // line end follows the tag name.
    it('LX22. still reads <div on the last line of a paragraph as that paragraph (control)', () => {
        expect(typesOf('a\n<div')).toEqual(['paragraph']);
    });

    it.each(INPUT_END_SOURCES)('LX23. lexes %j identically to the unbounded twin', (source) => {
        expect(lexMarkdown(source)).toEqual(lexMarkdownUnbounded(source));
    });

    it.each(['<div', ...HTML_START_TAILS, ...NO_HTML_START_TAILS])('LX24. reads %j the same with and without a line end after it', (source) => {
        expect(typesOf(source)).toEqual(typesOf(source + '\n'));
    });

    // Inside a list or a blockquote no line end can be put after the tag name without changing the container, so
    // these rows compare with the same line closed by `>`, which `marked` read as an HTML block start all along.
    it.each(CONTAINER_TAIL_SOURCES)('LX25. reads a block tag name on %s as the same line closed by > reads', (_where, source) => {
        const tokens = lexMarkdown(source);

        expect(blockTypeTree(tokens)).toEqual(blockTypeTree(lexMarkdown(source.replace('<div', '<div>'))));
        expect(joinedRaws(tokens)).toBe(source);
    });

    it('LX26. reads a quote line holding a block tag name, then a lazy line, as an html block and a paragraph in the quote', () => {
        const quote = tokenAt<Tokens.Blockquote>('> <div\nfoo', 0);

        expect(quote.tokens.map((token) => token.type)).toEqual(['html', 'paragraph']);
        expect(quote.tokens[0]!.raw).toBe('<div');
        expect(quote.tokens[1]).toMatchObject({ text: 'foo' });
    });

    it('LX27. reads a block tag name on a list item\'s continuation line as an html block after the item\'s text', () => {
        const [item] = listItemsAt('- a\n  <div', 0);

        expect(item!.tokens.map((token) => token.type)).toEqual(['text', 'html']);
        expect(item!.tokens[1]!.raw).toBe('<div');
    });

    it('LX28. still reads an inline tag name on a quote line before a lazy line as one paragraph (control)', () => {
        const quote = tokenAt<Tokens.Blockquote>('> <span\nfoo', 0);

        expect(quote.tokens.map((token) => token.type)).toEqual(['paragraph']);
    });

    // Unlike `<div` (LX22), these four names end a paragraph in `marked` with nothing after them, so the tag name
    // is an input's only line once the paragraph above it is taken.
    it.each(PARAGRAPH_ENDING_TAILS)('LX29. reads %j on the line after a paragraph as an html block, as before a line end', (tail) => {
        const source = `a\n${tail}`;
        const tokens = lexMarkdown(source);

        expect(tokens.map((token) => token.type)).toEqual(['paragraph', 'html']);
        expect(tokens.at(-1)!.raw).toBe(tail);
        expect(typesOf(source)).toEqual(typesOf(source + '\n'));
        expect(joinedRaws(tokens)).toBe(source);
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

describe('every image form arrives as one mdimage token', () => {
    /** The first inline token of the first block. */
    function firstInline(source: string): Tokens.Generic {
        const lexed = lexMarkdown(source);

        expect(lexMarkdownUnbounded(source)).toEqual(lexed);

        return (lexed[0] as Tokens.Generic).tokens![0] as Tokens.Generic;
    }

    it('reads an image with a title', () => {
        expect(firstInline('![foo](/url "title")')).toMatchObject({
            type: 'mdimage', raw: '![foo](/url "title")', imageRaw: '![foo](/url "title")', alt: 'foo', src: '/url', title: 'title', attributeText: '',
        });
    });

    it('reads a reference image with a size group, the group kept apart from the image', () => {
        expect(firstInline('![a][r]{width=10}\n\n[r]: /i.png')).toMatchObject({
            type: 'mdimage', raw: '![a][r]{width=10}', imageRaw: '![a][r]', src: '/i.png', title: null, attributes: { width: '10' }, attributeText: 'width=10',
        });
    });

    it('drops the brackets of an angle-bracket destination', () => {
        expect(firstInline('![foo](<url>)')).toMatchObject({ src: 'url' });
    });

    it('gives an image with links and images in its description a plain alt text and no tokens', () => {
        const token = firstInline('![[[foo](uri1)](uri2)](uri3)');

        expect(token).toMatchObject({ alt: '[foo](uri2)', src: 'uri3' });
        expect('tokens' in token).toBe(false);
    });

    it('reads a shortcut label that names no definition as the text ! and a styled span', () => {
        const tokens = (lexMarkdown('![a]{width=10}')[0] as Tokens.Generic).tokens!;

        expect(tokens[0]).toMatchObject({ type: 'text', raw: '!' });
        expect(tokens[1]).toMatchObject({ type: 'styledspan' });
    });
});
