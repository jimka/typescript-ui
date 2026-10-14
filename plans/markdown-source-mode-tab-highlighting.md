---
depends-on: [markdown-tab-column-parity]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/languages.ts
  - packages/lib/tests/component/code-editor.test.ts
  - packages/lib/docs/components/CodeEditor.md
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# Markdown Source Mode Tab Highlighting — Implementation Plan

## Overview

`MarkdownEditor`'s source mode is a `CodeEditor` with the built-in `"markdown"` language. That language's syntax tree comes from `@lezer/markdown` 1.7.2, through `@codemirror/lang-markdown` 6.5.2's `markdown()` ([languages.ts:496](packages/lib/src/typescript/lib/component/editor/languages.ts#L496)). `markdown-tab-column-parity` makes the viewer read a tab in a line's container prefix (its leading spaces, tabs, `>` markers and list markers) as the spaces to the next multiple of four columns; this plan calls that the *tab rule*. The tree reads three tab shapes otherwise:

| Shape | Example | Viewer, under the tab rule | Tree today |
|---|---|---|---|
| A tab after a heading's `#` run | `#→Foo` | a heading | a paragraph |
| A tab after the `>` that opens a quote | `>→-·a`, `>`, `>·····b` | `b` is a paragraph of the item | `b` is code after the list |
| A tab after `>` on a quote's later line | `>·-·a`, `>→-·b` | `b` is an item nested under `a` | `b` is a second item |

This plan makes the tree read all three as the viewer does. A new module, `markdownTabStops.ts`, holds two block parsers that `languages.ts` passes to `markdown({ extensions })`, and one function that fixes a quote's later lines. Highlighting, folding and every Enter and Backspace rule of the language read the corrected tree. `CodeEditor.ts` is not touched.

`→` is one tab, `·` one space, `⏎` a line end and `▮` the caret throughout. Every reading was measured on `feature/code-editor-flash-after-dispose` (`736452bbc`) with `@lezer/markdown` 1.7.2; 1.8.0, the newest release, parses blocks the same way.[^measured]

---

## Architecture Decisions

### The grammar is configured through `markdown({ extensions })`

The two parsers go to `markdown()` as its `extensions` option, the documented way to extend `@lezer/markdown`. `languages.ts` already configures its grammars through each package's own options: `markdown({ htmlTagLanguage })` and `htmlLanguage.configure({ dialect, props })` ([languages.ts:488](packages/lib/src/typescript/lib/component/editor/languages.ts#L488)), and `langSql.sql({ dialect })` ([:137](packages/lib/src/typescript/lib/component/editor/languages.ts#L137)).[^precedent]

The code lives in a new module, `component/editor/markdownTabStops.ts`, which `languages.ts` imports statically, as it imports `syntaxDiagnostics.ts`. The module holds no runtime import. It names `@lezer/markdown`'s types from `markdown()`'s own signature, as `languages.ts` names `SyntaxNode` from `TreeIndentContext` ([languages.ts:148](packages/lib/src/typescript/lib/component/editor/languages.ts#L148)), because `@lezer/markdown` is not a direct dependency.[^module]

### Each new parser takes only the lines with a tab

`ATXHeadingAfterTab` runs before the stock `ATXHeading` parser and takes a `#` run followed by a tab. `BlockquoteAfterTab` runs before the stock `Blockquote` parser and takes a `>` followed by a tab. Every other line reaches the stock parser unchanged.[^narrow]

| Line | Taken by | Result |
|---|---|---|
| `#→Foo` | `ATXHeadingAfterTab` | `ATXHeading1`, the same nodes as `#·Foo` |
| `#·Foo` | stock `ATXHeading` | unchanged |
| `#######→x` | neither: seven `#` | a paragraph, as before |
| `>→foo` | `BlockquoteAfterTab` | a quote whose content starts at column 2 |
| `>·foo`, `>foo` | stock `Blockquote` | unchanged |

`ATXHeadingAfterTab` also ends a paragraph, as a heading with a space does: `a⏎#→b⏎c` is a paragraph, a heading and a paragraph.

### A quote marker followed by a tab takes two columns

On every line of a quote, a `>` followed by a tab takes the `>` and one column of the tab. The rest of the tab is the quote's content.[^two-columns]

| Line | `>` at column | Quote content starts at | Stock parser, first line | Stock parser, later line |
|---|---|---|---|---|
| `>→-·b` | 0 | column 2; `-` at column 4 is 2 in | column 1 | column 4 |
| `··>→-·b` | 2 | column 4; the tab is one column wide | column 3 | column 4 |

### A quote's later lines are fixed through the parser's internal table

No parser configuration reaches a quote's later lines. `readQuoteContinuationTabs` therefore replaces the `Blockquote` entry of the parser's internal `skipContextMarkup` table, on the one parser `markdown()` built for this language. This is the plan's one departure from the documented extension points.[^internal]

The replacement keeps three limits:

- It copies the table onto that parser alone, so `@codemirror/lang-markdown`'s shared `commonmarkLanguage` is never changed. Row TAB33 checks this.
- It calls the stock entry for every line whose `>` no tab follows.
- When the table or its `Blockquote` entry is missing, as in a release that renamed them, it changes nothing: such lines then read the stock way, and rows TAB9 to TAB11 turn red.

Row TAB33 also pins the stock reading of `commonmarkLanguage`. When it turns red, `@lezer/markdown` has changed its own reading, and the parts of this module it covers can go.[^upstream]

### Every reader of the tree follows; Enter keeps two known outcomes

Highlighting, folding, `@codemirror/lang-markdown`'s Enter and Backspace commands, and `languages.ts`'s own Enter rules read the corrected tree with no change of their own. The library's other Markdown modules read `marked`, not this tree.[^readers]

`@codemirror/lang-markdown`'s Enter command finds a quote's and an item's markers with patterns that take a space but not a tab after `>`. With the corrected tree it now continues a list or an item where it stopped before (rows TAB24 to TAB26). Two outcomes stay wrong, and are pinned (rows TAB31 and TAB32):

| Before Enter | After Enter |
|---|---|
| `>·-·a⏎>⏎>→b▮` | `>·-·a⏎>⏎>→b⏎▮`: the new line is at the margin, outside the quote |
| `>·-·a⏎>→-·▮` | unchanged: Enter does nothing on this empty item |

These belong to `@codemirror/lang-markdown`'s commands, not to the tree, and are a non-goal.[^enter]

### This plan takes over rows TAB8 to TAB11

`markdown-tab-column-parity` pinned the tree's readings of `#→Foo` and three quote documents as rows TAB8 to TAB11 of `code-editor.test.ts`; its revision removes them. This plan adds rows with those ids and the viewer's readings, and continues the numbering at TAB12.[^takeover]

---

## Internal Structure

### The new module

`packages/lib/src/typescript/lib/component/editor/markdownTabStops.ts`, in full. This text was run, under this file name, through `code-editor.test.ts` and the `markdown*` and `display/Markdown*` suites (all green), and through the rows of `## Expected Behaviour`.

```ts
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Makes the built-in "markdown" language's parser count a tab after `#` and
// after `>` as Markdown does: a tab reaches the next multiple of four
// columns (CommonMark §2.2). `languages.ts` passes MARKDOWN_TAB_STOPS to
// `markdown()` and hands the parser it gets back to
// readQuoteContinuationTabs. Everything here is types or plain functions, so
// importing this module loads no grammar package.

import type { markdown } from "@codemirror/lang-markdown";

/**
 * The extensions `markdown()` accepts. Named from that function's own
 * signature because `@lezer/markdown`, which declares the type, is not a
 * direct dependency.
 */
type MarkdownExtension = NonNullable<NonNullable<Parameters<typeof markdown>[0]>["extensions"]>;

/** One parser configuration, as opposed to a list of them. */
type MarkdownConfig = Exclude<MarkdownExtension, readonly unknown[]>;

/** A block parser of a parser configuration. */
type BlockParser = NonNullable<MarkdownConfig["parseBlock"]>[number];

/** The parse state a block parser is given. */
type BlockContext = Parameters<NonNullable<BlockParser["parse"]>>[0];

/**
 * The line a block parser reads. `pos` is the first character past the
 * markers the enclosing blocks took, `next` that character's code, and
 * `indent` its column, with tabs counted to Markdown's stops.
 */
type MarkdownLine = Parameters<NonNullable<BlockParser["parse"]>>[1];

/** Character codes the parsers compare against, as `Line.next` holds them. */
const TAB        = "\t".charCodeAt(0);
const SPACE      = " ".charCodeAt(0);
const HASH       = "#".charCodeAt(0);
const QUOTE_MARK = ">".charCodeAt(0);

/** The most `#` characters an ATX heading opens with (CommonMark §4.2): seven are text. */
const MAX_HEADING_LEVEL = 6;

/**
 * The columns a blockquote marker takes when a tab follows it: the `>` and
 * one column of the tab. CommonMark §5.1 gives the marker one optional space,
 * and §2.2 reads a tab there as the spaces to its stop, so the marker takes
 * one of them and the rest belong to the quote's content.
 */
const QUOTE_MARKER_WIDTH = 2;

/**
 * Tells whether a character code is a space or a tab.
 *
 * @param code - A character code.
 * @returns `true` for a space or a tab.
 */
function isSpaceOrTab(code: number): boolean {
    return code === SPACE || code === TAB;
}

/**
 * Reads the level of an ATX heading whose `#` run a tab follows. A space
 * after the run is the stock parser's case and is left to it.
 *
 * @param line - The line the parser is on.
 * @returns The heading's level, 1 to 6, or `-1` when the line is not such a heading.
 */
function headingAfterTabLevel(line: MarkdownLine): number {
    if (line.next !== HASH) {
        return -1;
    }

    let end = line.pos + 1;

    while (end < line.text.length && line.text.charCodeAt(end) === HASH) {
        end++;
    }

    const level = end - line.pos;
    const tabFollows = line.text.charCodeAt(end) === TAB;

    return tabFollows && level <= MAX_HEADING_LEVEL ? level : -1;
}

/**
 * Finds where a heading's closing `#` run starts: a run that ends the text
 * and has a space or a tab before it. `#→Foo·##` closes at the `##`;
 * `#→Foo#` does not close.
 *
 * @param text - The line's text.
 * @param from - Where the opening `#` run starts.
 * @param end - Where the text ends once trailing spaces and tabs are left off.
 * @returns The closing run's start, or `text.length` when there is none.
 */
function closingSequenceStart(text: string, from: number, end: number): number {
    let start = end;

    while (start > from && text.charCodeAt(start - 1) === HASH) {
        start--;
    }

    const isClosing = start < end && start > from && isSpaceOrTab(text.charCodeAt(start - 1));

    return isClosing ? start : text.length;
}

/**
 * Parses an ATX heading whose `#` run a tab follows, into the same nodes the
 * stock parser gives a heading with a space there: `ATXHeading1` to
 * `ATXHeading6`, a `HeaderMark` for each `#` run, and the inline content.
 *
 * @param cx - The parse state.
 * @param line - The line the parser is on.
 * @returns `true` when the line was such a heading and is consumed, otherwise `false`.
 */
function parseHeadingAfterTab(cx: BlockContext, line: MarkdownLine): boolean {
    const level = headingAfterTabLevel(line);

    if (level < 0) {
        return false;
    }

    const text = line.text;
    const from = cx.lineStart + line.pos;
    let contentEnd = text.length;

    while (contentEnd > line.pos && isSpaceOrTab(text.charCodeAt(contentEnd - 1))) {
        contentEnd--;
    }

    const closing = closingSequenceStart(text, line.pos, contentEnd);
    // The text starts one character past the run: the tab.
    const textStart = line.pos + level + 1;
    const children = [
        cx.elt("HeaderMark", from, from + level),
        ...cx.parser.parseInline(text.slice(textStart, closing), cx.lineStart + textStart),
    ];

    if (closing < text.length) {
        children.push(cx.elt("HeaderMark", cx.lineStart + closing, cx.lineStart + contentEnd));
    }

    const heading = cx.elt(`ATXHeading${level}`, from, cx.lineStart + text.length, children);

    cx.nextLine();
    cx.addElement(heading);

    return true;
}

/**
 * Tells whether a line ends the paragraph above it by starting an ATX
 * heading whose `#` run a tab follows, as a heading with a space there does.
 *
 * @param _cx - The parse state.
 * @param line - The line after the paragraph's last line.
 * @returns `true` when the line starts such a heading.
 */
function endsParagraphAtHeadingAfterTab(_cx: BlockContext, line: MarkdownLine): boolean {
    return headingAfterTabLevel(line) >= 0;
}

/**
 * Tells whether a line's next character is a blockquote marker that a tab
 * follows.
 *
 * @param line - The line the parser is on.
 * @returns `true` for `>` and then a tab.
 */
function isQuoteMarkBeforeTab(line: MarkdownLine): boolean {
    return line.next === QUOTE_MARK && line.text.charCodeAt(line.pos + 1) === TAB;
}

/**
 * Starts a blockquote whose `>` a tab follows, with the quote's content at
 * the marker's column plus QUOTE_MARKER_WIDTH. The stock parser starts it
 * one column further left, at the tab. `>` with a space or nothing after it
 * is left to the stock parser.
 *
 * @param cx - The parse state.
 * @param line - The line the parser is on.
 * @returns `null` when it started the quote, otherwise `false`.
 */
function parseBlockquoteAfterTab(cx: BlockContext, line: MarkdownLine): null | false {
    if (!isQuoteMarkBeforeTab(line)) {
        return false;
    }

    const markFrom = cx.lineStart + line.pos;

    cx.startComposite("Blockquote", line.pos);
    cx.addElement(cx.elt("QuoteMark", markFrom, markFrom + 1));
    line.moveBaseColumn(line.indent + QUOTE_MARKER_WIDTH);

    return null;
}

/**
 * The parser configuration the built-in `"markdown"` language adds through
 * `markdown({ extensions })`. Two block parsers, each placed in front of the
 * stock parser it completes, and each taking only the lines with a tab:
 *
 * | Line | Stock reading | With these parsers |
 * | --- | --- | --- |
 * | `#→Foo` | a paragraph | a level-1 heading |
 * | `a`, then `#→b` | one paragraph | a paragraph, then a heading |
 * | `>→-·a`, `>`, `>·····b` | `b` is code after the list | `b` is a paragraph of the item |
 *
 * A quote's later lines are read by readQuoteContinuationTabs.
 *
 * @internal Used by `languages.ts` only, not part of the public API surface.
 */
export const MARKDOWN_TAB_STOPS: MarkdownConfig = {
    parseBlock: [
        { name: "ATXHeadingAfterTab", before: "ATXHeading", parse: parseHeadingAfterTab, endLeaf: endsParagraphAtHeadingAfterTab },
        { name: "BlockquoteAfterTab", before: "Blockquote", parse: parseBlockquoteAfterTab },
    ],
};

/** The function a parser runs on each later line of an open blockquote, to take its `>`. */
type QuoteContinuation = (block: { end: number }, cx: BlockContext, line: MarkdownLine) => boolean;

/**
 * The two members of `@lezer/markdown`'s `MarkdownParser` that
 * readQuoteContinuationTabs reads. `nodeSet` is public. `skipContextMarkup`,
 * the function per open block type that takes that block's markers off each
 * later line, is internal: it is in no type declaration, and may be renamed
 * by any release.
 */
interface MarkdownParserInternals {
    readonly nodeSet: { readonly types: readonly { readonly name: string; readonly id: number }[] };
    skipContextMarkup?: Readonly<Record<number, QuoteContinuation | undefined>>;
}

/**
 * Makes a Markdown parser take one column of a tab that follows `>` on a
 * blockquote's later lines, as on its first (see MARKDOWN_TAB_STOPS). The
 * stock parser takes the whole tab there, so `> - a` over `>→- b` reads `b`
 * as a second item rather than one nested under `a`.
 *
 * No parser configuration reaches a block's later lines: a configuration
 * that names an existing block type is skipped. So this replaces the entry
 * for `Blockquote` in the parser's internal table of them, on `parser` alone:
 * the table is copied, and the stock entry still reads every line whose `>`
 * no tab follows. When the table or the entry is not there, as in a release
 * that renamed them, the parser is left as it is and reads such lines the
 * stock way.
 *
 * @internal Used by `languages.ts` only, not part of the public API surface.
 *
 * @param parser - The parser of the language `markdown()` returned. It must be that language's own, never `commonmarkLanguage`'s.
 */
export function readQuoteContinuationTabs(parser: object): void {
    const internals = parser as MarkdownParserInternals;
    const blockquote = internals.nodeSet.types.find((type) => type.name === "Blockquote");
    const table = internals.skipContextMarkup;
    const stock = blockquote === undefined || table === undefined ? undefined : table[blockquote.id];

    if (blockquote === undefined || table === undefined || typeof stock !== "function") {
        return;
    }

    const continueQuote: QuoteContinuation = (block, cx, line) => {
        if (!isQuoteMarkBeforeTab(line)) {
            return stock(block, cx, line);
        }

        const markFrom = cx.lineStart + line.pos;

        line.addMarker(cx.elt("QuoteMark", markFrom, markFrom + 1));
        line.moveBaseColumn(line.indent + QUOTE_MARKER_WIDTH);
        // What the stock entry does too: the open quote reaches the end of this line.
        block.end = cx.lineStart + line.text.length;

        return true;
    };

    internals.skipContextMarkup = { ...table, [blockquote.id]: continueQuote };
}
```

### The change in `languages.ts`

Add the import after the `formatWithSql` import:

```ts
import { MARKDOWN_TAB_STOPS, readQuoteContinuationTabs } from "~/component/editor/markdownTabStops.js";
```

In the `"markdown"` loader, `const support = markdown({ htmlTagLanguage: literalHtml });` becomes:

```ts
        // Markdown counts a tab after `#` or `>` to the next of its four-column
        // stops; the stock parser does not (see markdownTabStops.ts). The
        // parser markdown() configured here is this language's own, so the
        // second call changes no other language.
        const support = markdown({ htmlTagLanguage: literalHtml, extensions: MARKDOWN_TAB_STOPS });

        readQuoteContinuationTabs(support.language.parser);
```

### The test helpers

Inside `describe('built-in markdown language typing', …)` of `code-editor.test.ts`, directly after the `languageOutline` helper that `markdown-tab-column-parity` adds:

```ts
    /**
     * Lists the syntax nodes the built-in `"markdown"` language gives a document, as `Name[from,to]`.
     *
     * @param doc - The document.
     * @returns Every node, in tree order, joined by spaces.
     */
    async function syntaxNodes(doc: string): Promise<string> {
        const state = settle(await buildTypingState('markdown', doc));
        const nodes: string[] = [];

        syntaxTree(state).iterate({ enter: (node) => { nodes.push(`${node.name}[${node.from},${node.to}]`); } });

        return nodes.join(' ');
    }

    /**
     * Lists the lines of a document that the built-in `"markdown"` language can fold, and what each folds.
     *
     * @param doc - The document.
     * @returns One `line:from-to` entry per foldable line.
     */
    async function foldableLines(doc: string): Promise<string[]> {
        const state = settle(await buildTypingState('markdown', doc));
        const folds: string[] = [];

        for (let number = 1; number <= state.doc.lines; number++) {
            const line = state.doc.line(number);
            const range = foldable(state, line.from, line.to);

            if (range !== null) {
                folds.push(`${number}:${range.from}-${range.to}`);
            }
        }

        return folds;
    }

    /** Markdown's tab stop, in columns (CommonMark §2.2), as `MARKDOWN_TAB_STOP` in `languages.ts`. */
    const MARKDOWN_TAB_STOP = 4;

    /**
     * Writes every tab of a document as the spaces that reach its tab stop, counted from its line's start.
     *
     * @param doc - The document.
     * @returns The document without tabs.
     */
    function withTabsAsSpaces(doc: string): string {
        return doc.split('\n').map((line) => {
            let spaced = '';

            for (const char of line) {
                spaced += char === '\t' ? ' '.repeat(MARKDOWN_TAB_STOP - (spaced.length % MARKDOWN_TAB_STOP)) : char;
            }

            return spaced;
        }).join('\n');
    }
```

---

## Ordered Implementation Steps

The base moves under this plan: `markdown-tab-column-parity` lands first. Find every edit by its quoted text or symbol name, not by line number. Run commands from `packages/lib`.

1. **Add the test rows, and see them red.** In `tests/component/code-editor.test.ts`:
   - Add `foldable` to the names imported from `'@codemirror/language'`. Add `import { commonmarkLanguage } from '@codemirror/lang-markdown';` after the `'@codemirror/lang-json'` import, and `import { tabDocuments } from './markdown-roundtrip/tabDocuments';` after the `'~/component/editor/syntaxDiagnostics'` import.
   - Add the constant and the three helpers of `## Internal Structure` after `languageOutline`.
   - After the last `TAB` row the tab plan added (TAB7), add the comment `// TAB8–TAB34: a tab after a heading's # run, or after a quote's >, reads as the viewer reads it (markdown-source-mode-tab-highlighting).` and then every row of `## Expected Behaviour`, in id order.
   - Run `npx vitest run tests/component/code-editor.test.ts -t "TAB"`. Red, and nothing else: TAB8 to TAB16, TAB19, TAB20, TAB22 to TAB27, TAB29 to TAB32 and TAB34. Green: TAB1 to TAB7, TAB17, TAB18, TAB21, TAB28 and TAB33.
2. **Create `src/typescript/lib/component/editor/markdownTabStops.ts`** with the text of `## Internal Structure`. Check: `npm run typecheck` (from the repo root) is clean.
3. **Wire it into `languages.ts`** as `## Internal Structure` shows. Check: every `TAB` row is green.
4. **Run the Markdown suites.** `npx vitest run tests/component/code-editor tests/component/markdown tests/component/display/Markdown`. Everything is green. If a test outside `code-editor.test.ts`'s `TAB` rows fails, stop and report it: with this plan's code on the measured base, all 10,321 tests of these suites passed unchanged.
5. **Write the docs and the changelog entry** of `## Documentation Impact`.
6. **Run the project checks** of `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/editor/markdownTabStops.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/languages.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` (only if it holds the paragraph step 5 removes) |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every row is unit-testable and goes in `describe('built-in markdown language typing', …)` of `code-editor.test.ts`. Each title is `'<id>: <title>'`. A document must not hold `|`, which `buildTypingState` reads as the caret; in the typing rows `|` is the caret. "Base" is the commit with `markdown-tab-column-parity` and without this plan.

### The block tree

Each row is `it('<id>: <title>', async () => { expect(await languageOutline(<doc>)).toBe(<outline>); });`. The outline is the viewer's reading under the tab rule.

| Row | Title | Document | Outline | Base |
|---|---|---|---|---|
| TAB8 | a tab after the # run makes a heading | `'#\tFoo'` | `h1` | `p` |
| TAB9 | a tab after a later quote marker nests an item under the item above | `'> - a\n>\t- b'` | `quote[ul[li[p ul[li[p]]]]]` | `quote[ul[li[p] li[p]]]` |
| TAB10 | a tab after a later quote marker continues the item above | `'> - a\n>\n>\tb'` | `quote[ul[li[p p]]]` | `quote[ul[li[p]] p]` |
| TAB11 | a line after a blank quoted line stays in an ordered item | `'>\t1. a\n>\n>\t   b'` | `quote[ol[li[p p]]]` | `quote[ol[li[p]] p]` |
| TAB12 | a heading after a tab ends a paragraph | `'a\n#\tb\nc'` | `p h1 p` | `p` |
| TAB13 | a heading after a tab in a list item | `'- #\th'` | `ul[li[h1]]` | `ul[li[p]]` |
| TAB14 | a heading after a tab in a quote | `'> #\th'` | `quote[h1]` | `quote[p]` |
| TAB15 | a heading after two tabs, with a closing run | `'##\t\tFoo ##'` | `h2` | `p` |
| TAB16 | an empty heading after a tab | `'#\t'` | `h1` | `p` |
| TAB17 | seven # and a tab are text | `'#######\tx'` | `p` | the same |
| TAB18 | a heading after a tab indented by four spaces is code | `'    #\tx'` | `code` | the same |
| TAB19 | a tab after the first quote marker leaves the item's content at column 6 | `'>\t- a\n>\n>     b'` | `quote[ul[li[p p]]]` | `quote[ul[li[p]] code]` |
| TAB20 | a tab after a later quote marker and two spaces start code | `'> x\n>\n>\t  code'` | `quote[p code]` | `quote[p p]` |
| TAB21 | a one-column tab after a quote marker is its space | `'  >\t- a\n  >\t  b'` | `quote[ul[li[p]]]` | the same |

### Nodes, folding and the drawn documents

```ts
    it('TAB22: a heading after a tab has the nodes of a heading after a space', async () => {
        expect(await syntaxNodes('#\tFoo *b* #')).toBe(await syntaxNodes('# Foo *b* #'));
    });

    it('TAB23: a heading after a tab folds its section', async () => {
        expect(await foldableLines('#\tA\ntext\n#\tB\nmore')).toEqual(['1:3-8', '3:12-17']);
    });

    // Green on the base and after this plan. It checks that this language's parser changes no other: the stock
    // commonmarkLanguage still reads both documents its own way. Red means @lezer/markdown changed that reading:
    // markdownTabStops.ts may then be partly or wholly unneeded.
    it('TAB33: the stock commonmarkLanguage keeps its own readings', async () => {
        await getLanguage('markdown')!.loadExtension();

        const outline = (doc: string): string => treeOutline(commonmarkLanguage.parser.parse(doc).topNode as unknown as OutlineNode);

        expect(outline('> - a\n>\t- b')).toBe('quote[ul[li[p] li[p]]]');
        expect(outline('#\tFoo')).toBe('p');
    });

    // 3,000 draws give 2,932 documents; 271 of them read otherwise than their tab-free form on the base.
    it('TAB34: every drawn tab document reads as the same document with its tabs written as spaces', async () => {
        const differing: string[] = [];

        for (const doc of tabDocuments(3_000)) {
            const reading = await languageOutline(doc);
            const spacedReading = await languageOutline(withTabsAsSpaces(doc));

            if (reading !== spacedReading) {
                differing.push(JSON.stringify(doc));
            }
        }

        expect(differing).toEqual([]);
    });
```

On the base TAB22 gives `Document[0,11] Paragraph[0,11] …`, and TAB23 gives `['1:3-17']`: the whole text is one paragraph.

### Enter and Backspace

Each row is `it('<id>: <title>', async () => { expect(await typed('markdown', <start>, <keys>)).toBe(<after>); });`. `'\n'` presses Enter and `'\b'` Backspace.

| Row | Title | Start | Keys | After | Base |
|---|---|---|---|---|---|
| TAB24 | Enter after an item in a quote opened by a tab starts the next item | `'>\t- a\|'` | `'\n'` | `'>\t- a\n>   - \|'` | `'>\t- a\n>\|'` |
| TAB25 | Enter after an ordered item in a quote opened by a tab numbers the next | `'>\t1. a\|'` | `'\n'` | `'>\t1. a\n>   2. \|'` | `'>\t1. a\n>\|'` |
| TAB26 | Enter on an item's later paragraph in a quote keeps the item's column | `'>\t1. a\n>\n>\t   b\|'` | `'\n'` | `'>\t1. a\n>\n>\t   b\n>      \|'` | `'>\t1. a\n>\n>\t   b\n>\|'` |
| TAB27 | Enter on a quoted code line opened by a tab copies its prefix | `'> x\n>\n>\t  code\|'` | `'\n'` | `'> x\n>\n>\t  code\n>\t  \|'` | `'> x\n>\n>\t  code\n> \|'` |
| TAB28 | Enter after a nested item in a quote starts a nested item | `'> - a\n>\t- b\|'` | `'\n'` | `'> - a\n>\t- b\n>   - \|'` | the same |
| TAB29 | Backspace after an empty item's marker in a quote removes the marker | `'>\t- \|'` | `'\b'` | `'>\t\|'` | `'>\t-\|'` |
| TAB30 | Backspace after an empty nested item's marker in a quote removes the marker | `'> - a\n>\t- \|'` | `'\b'` | `'> - a\n>\t\|'` | `'> - a\n>\t  \|'` |
| TAB31 | pinned: Enter on an item's later paragraph after a tab leaves the quote | `'> - a\n>\n>\tb\|'` | `'\n'` | `'> - a\n>\n>\tb\n\|'` | `'> - a\n>\n>\tb\n> \|'` |
| TAB32 | pinned: Enter on an empty nested item after a tab does nothing | `'> - a\n>\t- \|'` | `'\n'` | `'> - a\n>\t- \|'` | `'> - a\n>\n>\t- \|'` |

`\|` in the table is a `|` in the test's string. Above TAB31 add the comment `// TAB31 and TAB32: @codemirror/lang-markdown's own Enter takes a space after > but not a tab. Its result is pinned, not fixed.`

### Manually

In the demo, open a `MarkdownEditor` and switch to source mode. Type `#`, a tab and `Foo`: the line is coloured as a heading. Type `> - a`, Enter, then replace the line's `>   - ` by `>`, a tab and `- b`: `b` stays coloured as a list item, and the fold arrow of the first item covers it.

---

## Verification

1. From `packages/lib`: `npx vitest run tests/component/code-editor tests/component/markdown tests/component/display/Markdown`. All green.
2. `grep -rn "skipContextMarkup" src/` shows `markdownTabStops.ts` only.
3. `git diff --name-only <the branch's base> -- src/typescript/lib/component/editor/CodeEditor.ts` prints nothing: `CodeEditor.ts` is not changed.
4. The manual check of `## Expected Behaviour`.
5. Project checks, from the repo root: `npm run typecheck`, `npm -w packages/lib run typecheck:test`, `npm run lint`, `npm run test`, `npm run docs:api`, `npm run docs:llms:check`.

---

## Documentation Impact

No public API changes. `markdownTabStops.ts` is not added to any barrel; its two exports carry `@internal`.

**`packages/lib/docs/components/CodeEditor.md`**

- After the paragraph that starts `The \`markdown\` language types HTML literally`, add:

  > The `markdown` language reads a tab as Markdown does: it reaches the next multiple of four columns. A tab after a heading's `#` run works as a space, so `#→Foo` (`→` is a tab) is a heading. After a `>`, a tab gives the marker one column, as a space would, and the rest of the tab belongs to the quote's content: `> - a` over `>→- b` nests `b` under `a`, as the [`Markdown`](/components/Markdown) viewer shows it. Highlighting, folding and Enter all read it that way.

- After the bullet that starts `**A tab-indented line of ordinary text in a list item**`, add:

  > - **After a `>` followed by a tab**, Markdown's own continuation counts the tab as one character. On a line of ordinary text in a list item of such a quote (`> - a`, `>`, `>→b`), Enter starts the new line at the margin, outside the quote. On an empty nested item (`> - a` over `>→- `), Enter does nothing; Backspace removes the marker. With a space after the `>` instead, both behave as described above.

  Match the link form to the other cross-page links in the file.

**`packages/lib/docs/components/MarkdownEditor.md`** — `markdown-tab-column-parity` may have added a paragraph that starts `Source mode's syntax highlighting reads two shapes otherwise than the viewer`. If it is there, delete it. Delete any other sentence that says source mode reads `#` followed by a tab, or a tab after `>`, differently from the viewer.

**`packages/lib/docs/reference/changelog/next.md`** — as the last bullet of `## Fixed` → `### Components`, wrapped at 76 columns with a two-space hanging indent like its neighbours:

> - **`CodeEditor`'s `markdown` language reads a tab after `#` or `>` as Markdown does.** A heading whose `#` a tab followed was highlighted as a paragraph. Inside a blockquote, a tab after the `>` moved the rest of the line: `> - a` over `>`, a tab and `- b` showed `b` as a second item instead of one nested under `a`. `MarkdownEditor`'s source mode and a `md` code block in `Markdown` show the corrected highlighting, and folding and Enter follow it: Enter after an item in a quote opened by `>` and a tab now continues the list. No consumer action is needed.

---

## Potential Challenges

- **The tab plan's helpers and rows.** This plan reuses `treeOutline`, `OutlineNode`, `languageOutline` and rows TAB1 to TAB7 from `markdown-tab-column-parity`, and `tabDocuments` from its `tests/component/markdown-roundtrip/tabDocuments.ts`. If its revision renamed or dropped one, take the definition from that plan's text on master, put it where this plan's helpers go, and keep this plan's row ids.
- **Row ids taken.** If the revised tab plan kept ids above TAB7, number this plan's rows from the next free id and keep every reference in step.
- **A later `@lezer/markdown`.** TAB33 turns red when the stock reading changes. Read the new release's `isAtxHeading`, `isBlockquote` and the `Blockquote` entry of `DefaultSkipMarkup`: drop each part of `markdownTabStops.ts` the release covers, and keep the rows.
- **A changed loader.** If `languages.ts`'s `"markdown"` loader no longer builds `support` as quoted, keep the rule: the extension goes to the `markdown()` call, and `readQuoteContinuationTabs` gets that call's `support.language.parser` before the loader returns.

---

## Critical Files

- [languages.ts:469](packages/lib/src/typescript/lib/component/editor/languages.ts#L469) — the `"markdown"` loader; `htmlLanguage.configure` (488) and `markdown()` (496), the precedent for configuring a grammar through its options; `SyntaxNode` (148), the precedent for naming a type of a package that is not a direct dependency; `insertNewlineKeepPrefix` (439), `containerPrefixAt` (278) and `caretBlocksAt` (244), which read the tree.
- `node_modules/@codemirror/lang-markdown/dist/index.js` at the repo root — `markdown()` (406), which passes `extensions` to `parser.configure` (425); `getContext` (122), the patterns behind TAB31 and TAB32; `insertNewlineContinueMarkupCommand` (203) and `deleteMarkupBackward` (342).
- `node_modules/@lezer/markdown/dist/index.js` at the repo root — `DefaultSkipMarkup` (255), whose `Blockquote` entry takes a whole tab; `isBlockquote` (299) and `isAtxHeading` (349), which take only a space; `MarkdownParser.configure` (1133), whose `defineNodes` skips an existing name (1144) and whose `parseBlock` inserts before a named parser (1181); `Line.moveBaseColumn` (202).
- [code-editor.test.ts:3386](packages/lib/tests/component/code-editor.test.ts#L3386) — `describe('built-in markdown language typing', …)`, with `buildTypingState` (3411), `settle` (3431) and `typed` (3565).
- `plans/markdown-tab-column-parity.md` — the tab rule, `treeOutline` and `languageOutline`, and `tabDocuments`.

---

## Non-Goals

- **`@codemirror/lang-markdown`'s Enter and Backspace on lines with a tab after `>`.** Its commands count characters where Markdown counts columns. Rows TAB31 and TAB32 pin the two outcomes this plan's shapes reach. Fixing them means replacing those commands.[^enter]
- **Readings that differ for reasons other than tabs.** The tree and the viewer read some documents differently with no tab involved, such as HTML in a quote followed by a blank `>` line, or a `>` indented by five columns under a quoted paragraph.[^non-tab]
- **Reporting the readings upstream.** That is the owner's call; `## Addendum: Measured readings` has what a report needs.
- **`CodeEditor` itself.** It gains no option and no Markdown-named code.
- **The GFM base language.** The built-in language uses `markdown()`'s default CommonMark base; nothing here touches `markdownLanguage`.
- **The columns inside a partly taken tab.** In `>→→foo` the code's text starts after the second tab, where CommonMark keeps two columns of it as content. Only node positions are affected, not which block a line is in.

---

## Addendum: Measured readings

Measured with `@lezer/markdown` 1.7.2 (the installed version) and 1.8.0 (the newest), `@codemirror/lang-markdown` 6.5.2 and `commonmark.js` 0.31.2. The 1.8.0 diff touches inline emphasis and fragment reuse only; every block reading below is the same. The parser source on `main` of `lezer-parser/markdown` on 2026-10-14 has the same `isAtxHeading`, `isBlockquote` and `Blockquote` skip entry.

### What the stock parser does

| Line | Stock code | Effect |
|---|---|---|
| `#→Foo` | `isAtxHeading` returns `-1` unless a space (code 32) follows the run | a paragraph, and not a paragraph break either |
| A quote's first line, `>→…` | `isBlockquote` returns 2 for `>·` and 1 otherwise; the quote's content starts at the tab | one column too far left |
| A quote's later line, `>→…` | the `Blockquote` skip entry moves past `>` and any space or tab | the whole tab is taken: up to two columns too far right |

### How often, and which piece fixes what

"Full expansion" is the document with every tab written as the spaces to its stop, which CommonMark reads the same way.

| Parser | Drawn tab documents (2,932) read otherwise than their full expansion | Tab documents (3,057) where the tree and the viewer disagree because of a tab |
|---|---|---|
| stock | 271 | 180 |
| `ATXHeadingAfterTab` | 71 | 48 |
| and `BlockquoteAfterTab` | 3 | 4 |
| and `readQuoteContinuationTabs` | 0 | 0 |

The 3,057 documents are the 2,932 drawn ones, the tab plan's 111 hand-written ones and 14 tab rows of the round-trip corpus. "Because of a tab" means the full expansion reads as the viewer does and the document does not. The viewer's reading is the one the tab plan's code gave in its planning run.

Three drawn documents that the tree and the viewer read alike on the base now read differently. In each, a `>` indented by five columns under a quoted paragraph is read by the tree as a quote marker, followed by `#` and a tab. On the base the line was paragraph text either way; now it is a heading. The same documents written with spaces read that way on the base too.[^non-tab]

### Enter and Backspace over the changed documents

Enter at the end of every non-blank line of the 271 changed documents (1,073 presses), and Backspace after every line ending in a marker and a space (74). "Right" means the result has the columns the same press gives on the full expansion.

| Outcome | Enter | Backspace |
|---|---|---|
| Unchanged, right | 679 | 46 |
| Unchanged, wrong | 262 | 27 |
| Changed, now right | 75 | 1 |
| Changed, still wrong | 53 | 0 |
| Changed, was right | 4 | 0 |

Every wrong result comes from `@codemirror/lang-markdown`'s patterns: `getContext` matches a quote as `/^ *>( ?)/`, so it writes `>` with no space after a tab-written quote, and it measures items in characters. No press whose result this plan changes leaves the document unchanged; TAB32's shape, an empty nested item after a tab, is not among the drawn documents.

### Incremental parsing

Each of the 2,932 drawn documents was edited six times at random (a tab, a space, `>`, `#`, a line end, a dash, a letter, or one character deleted), each time reparsed from the previous tree and compared with a fresh parse. The stock parser differs from its fresh parse on 38 of the 17,592 edits; with this plan's code on 37, none of them new.

### The upstream change

Fixing `@lezer/markdown` itself takes three edits: `isAtxHeading` accepts a tab after the run; the `Blockquote` block parser and the `Blockquote` skip entry, when a tab follows `>`, call `line.moveBaseColumn(column of > + 2)` in place of moving past characters. With those, `markdownTabStops.ts` is not needed.

---

## Notes

[^measured]: The probes ran on the worktree `plan-tab-highlighting` from `736452bbc` and, outside the repository, against a private install of `@lezer/markdown` 1.7.2 and 1.8.0 and `commonmark.js` 0.31.2. Scripts and outputs are kept in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans4/tab-highlighting/` (`probe/`, `PROGRESS.md`, `enter-sweep.json`, `probe-typing.json`). The viewer readings come from the tab plan's planning run (`plans3/tab-column/diff-final.jsonl`). With an earlier draft of the module patched in, the whole suite passed (19,606 tests). With the final text, the code-editor and Markdown suites passed (10,321 tests), and the rows of `## Expected Behaviour` were red and green as step 1 lists.

[^precedent]: `markdown()` passes `extensions` straight to `parser.configure`, the API `@lezer/markdown` documents for adding block parsers (`MarkdownConfig.parseBlock`, with `before` to place one, and `endLeaf` for a construct that ends a paragraph). The heading fix and a quote's first line need nothing more. A fork or a patch of the package was the alternative for those two, and has no reason to exist when the documented route works.

[^module]: `languages.ts` is a list of language definitions, with the Markdown Enter rules inline. The tab-stop code is a different concern of some 280 lines, and a module of its own keeps it reviewable on its own, as `syntaxDiagnostics.ts` and the `formatters/` modules are. The import is static and costs no chunk: the module holds types and plain functions only, and its one import is `import type`.

[^narrow]: Replacing the stock `ATXHeading` or `Blockquote` parser by name would also work, since `parseBlock` replaces a parser with the same name. It would copy every line of the stock parser into the library, including the space case it already reads right. A parser placed in front that declines every other line keeps the stock code in charge of everything but the tab.

[^two-columns]: CommonMark §5.1: a block quote marker is `>` with an optional following space. §2.2: where a tab helps to define block structure, it acts as the spaces to the next multiple of four, and a marker that wants one space takes one of them. So in `>→-·b` the marker takes columns 0 and 1, and the item's `-` at column 4 is two columns into the quote, under an item whose content starts two columns in. `marked`'s readings under the tab plan's rule agree, which is why the viewer nests `b`. `Line.moveBaseColumn` moves the line's base to a column inside a tab; `@lezer/markdown`'s own list items use it the same way.

[^internal]: Three things were checked before using an internal. First, no public route exists: `@lezer/markdown` runs a block's later lines through `skipContextMarkup`, a table keyed by node type, and `configure` only adds to it for a `defineNodes` entry with a new name; it skips a name that exists (`if (nodeTypes.some(t => t.name == name)) continue`), in 1.7.2, 1.8.0 and on `main`. A new node type, say a wrapper inside each quote whose own entry moves the base back, was considered and rejected: it adds a node to every quote's tree, which highlighting, folding, `@codemirror/lang-markdown`'s commands and this library's tree readers would all meet. Second, a patch to the package cannot help consumers: the library build keeps `@lezer/*` external ([vite.lib.config.ts:99](packages/lib/vite.lib.config.ts#L99)), and a consumer's install resolves `@lezer/markdown` itself through `@codemirror/lang-markdown`'s `^1.0.0`. Third, a fork would ship a copy of an MIT package inside the library, where the library keeps third-party packages external instead. The override is therefore the least invasive route that reaches consumers. It is guarded so that a release without the table reads tabs as before, and it never mutates the shared table: `markdown()` always calls `configure` with at least `parseCode`, so its parser is a new instance, and the function assigns a copied table to that instance only. (`configure([])` would return the same instance; that never happens here.)

[^upstream]: TAB33 asserts two stock readings of `commonmarkLanguage.parser`, after this language has been loaded. If this plan's code ever reached the shared parser, the first expectation would fail. If `@lezer/markdown` fixes either reading, the matching expectation fails, and that is the signal to drop code from `markdownTabStops.ts`.

[^readers]: Readers of the `"markdown"` language's tree, all unchanged in code: the highlight style of `theme.ts`, which colours the tags `@lezer/markdown` attaches to node names; `@codemirror/lang-markdown`'s fold props and its `headerIndent` fold service (TAB23); its Enter (`insertNewlineContinueMarkup`) and Backspace (`deleteMarkupBackward`) commands; `insertNewlineKeepPrefix`, `containerPrefixAt`, `caretBlocksAt`, `isBetweenPair` and `indentInsideMarkdownHtml` in `languages.ts`, which read `QuoteMark` and `ListMark` nodes and ancestor names, all of which the new parsers produce as the stock ones do (TAB22, TAB27); and the viewer's fenced `md` blocks, which `Markdown.ts` highlights with this language (`FENCE_LANG_ALIASES`, [Markdown.ts:100](packages/lib/src/typescript/lib/component/display/Markdown.ts#L100)). Not readers: `markdownSourceTokens.ts`, `markdownSourceLines.ts` and `markdownSourceEdits.ts` lex with `marked` through `lexMarkdown`, so `markdown-tab-column-parity` covers them; `syntaxDiagnostics.ts` serves languages with a lint source, and Markdown has none.

[^enter]: `getContext` in `@codemirror/lang-markdown` builds each quote's and item's prefix from `/^ *>( ?)/` and `/^( *)([-+*])( {1,4}\[[ xX]\])?( +)/`, measured in characters on the block's first line, and applies those offsets to the caret's line. On TAB31's line `>→b` the "dedented" check compares 2 characters with the item's 4 and writes no prefix. On TAB32's line the lift replaces characters 2 to 4 (`- `) with the outer item's marker `- `, which changes nothing. On the base both shapes were read as other blocks, so Enter gave other, also wrong, results. Mending them means a column-aware Enter command for quote and item lines in `languages.ts` ahead of `@codemirror/lang-markdown`'s, a change of its own beyond the tree. The CodeEditor docs already list a tab-indented item line as a known Enter case; this plan adds the quote case beside it.

[^takeover]: The owner decided on 2026-10-14 to fix these readings rather than pin them. The tab plan's revision drops rows TAB8 to TAB11 and its docs sentence about the two shapes; this plan's rows reuse the ids so the history of the four documents stays in one place.

[^non-tab]: Among the 2,932 drawn documents, the tree and the viewer disagree on 627 after this plan, and on every one of them the full expansion disagrees in the same way: they are `@lezer/markdown`'s and `marked`'s different readings of HTML blocks, lazy lines and indented markers. Examples: `>→<div>⏎>→⏎>→x` (the tree keeps the HTML block open over the blank quoted line, `marked` ends it), and `>→y·z⏎→·>#→h`, where `@lezer/markdown` takes a `>` indented by five columns as the quote's marker, which CommonMark does not.
