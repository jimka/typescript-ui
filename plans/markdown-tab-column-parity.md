---
depends-on:
  - markdown-list-toggle-task-item-parity
  - markdown-editor-raw-block-edge-cases
  - markdown-editor-raw-block-range-edits
  - markdown-editor-cross-item-range-removal
  - markdown-editor-link-format-command-fixes
  - markdown-editor-readonly-keyboard-selection
  - markdown-editor-table-command-fixes
  - markdown-language-readonly-and-fences
touches-shared:
  - packages/lib/src/typescript/lib/component/display/markdownExtensions.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/tests/component/display/markdownLexer.test.ts
  - packages/lib/tests/component/markdown-roundtrip/viewModel.ts
  - packages/lib/tests/component/markdown-roundtrip/markdown-roundtrip.test.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/types.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/index.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/commonmark.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/enterInsideHtml.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-source-edits.test.ts
  - packages/lib/tests/component/code-editor.test.ts
  - packages/lib/docs/components/Markdown.md
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# Markdown Tab Column Parity — Implementation Plan

## Overview

CommonMark says a tab in a line's indentation reaches the next multiple of four columns, counted from the start of the line. The `Markdown` viewer and the `MarkdownEditor`'s WYSIWYG surface both read Markdown through `marked` 18.0.9, and `marked` does not count that way. Inside a list item it writes every tab as four spaces, wherever the tab starts. After a `>` it starts counting from zero. So the same document is read one way by the viewer and the WYSIWYG surface, and another way by CommonMark and by source mode's syntax highlighting.

This plan makes the viewer and the WYSIWYG surface count a tab as CommonMark does, and keeps every tab that is content. The library runs `marked` through an instance of its own with its own tokenizers, which the code calls the *dialect*. The whole fix is in the dialect's tokenizer slots in [markdownExtensions.ts:534](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L534), plus one guard in the serializer ([markdownSerializer.ts:1784](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1784)). Both readers lex through `lexMarkdown`, so they cannot drift apart.

`→` is one tab, `·` one space and `⏎` a line end throughout. *Base* means the code before this plan; every reading here was measured on commit `75d022ba1`, the tip of the Markdown stack. Four of the differences the plan removes:[^measured]

| Document | CommonMark | Viewer and WYSIWYG before this plan |
|---|---|---|
| `-·a⏎⏎··→b` | an item with two paragraphs | an item with a paragraph and a code block |
| `-→a⏎→-→b⏎→→-→c` | three nested lists | two lists, then the code block `-····c` |
| `` -·a·`x→y` `` | a code span holding a tab | a code span holding two spaces, saved that way once the list is edited |
| `>·→foo` | a quote holding a paragraph | a quote holding a code block |

Two readings stay different from CommonMark and are pinned by tests and documented: a tab in the indentation of a code line inside a list item or quote, and two shapes that source mode's highlighting reads its own way.

---

## Architecture Decisions

### One rule — a tab in a container prefix is the spaces that reach its tab stop

A line's *container prefix* is its leading run of spaces, tabs, `>` markers and list markers, and a task checkbox when one follows a list marker. Inside a list or a blockquote, every tab in that prefix is read as the spaces that reach the next multiple of four columns, counted from the start of the line. Every other tab is content and is kept as a tab.[^one-rule]

| Line | Container prefix | Read as |
|---|---|---|
| `··→b` | `··→` | `····b` (the tab runs from column 2 to 4) |
| `·→-·b` | `·→-·` | `····-·b` |
| `-→-→x` | `-→-→` | `-···-···x` |
| `>·→foo` | `>·→` | `>···foo` |
| `-·[·]→task` | `-·[·]→` | `-·[·]···task` (the tab runs from column 5 to 8) |
| `` -·a·`x→y` `` | `-·` | unchanged: the tab is content |
| `··a→b` | `··` | unchanged: the tab is content |

### The fix lives in the dialect's tokenizer slots

Four functions are added to [markdownExtensions.ts](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts) and installed in `marked`'s `list`, `blockquote`, `code` and `fences` slots. Each runs the tokenizer that is in the slot today and corrects one thing, which is how `listWithOwnTaskMarker` ([markdownExtensions.ts:370](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L370)), `blockquoteWithSourceRaw` ([:467](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L467)) and `htmlWithInputEndAsLineEnd` ([:502](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L502)) already work.[^precedent] Nothing is added to `markdownImporter.ts`, `languages.ts` or `CodeEditor.ts`.

| Slot | New function | Wraps | Corrects |
|---|---|---|---|
| `list` | `listWithTabStops` | `listWithOwnTaskMarker` | tabs in container prefixes; keeps content tabs |
| `blockquote` | `blockquoteWithTabStops` | `blockquoteWithSourceRaw` | tabs in container prefixes |
| `code` | `codeWithTabIndent` | `Tokenizer.prototype.code` | a tab after one to three spaces is indentation |
| `fences` | `fencesWithColumnIndent` | `Tokenizer.prototype.fences` | an indented backtick fence takes columns, not characters, off its lines |

### A token's `raw` stays the source

`listWithTabStops` and `blockquoteWithTabStops` hand `marked` a changed copy of the source. Afterwards they set the token's `raw`, and each list item's `raw`, back to the source lines the token spans. `marked` builds these `raw` values from whole lines, so counting lines finds the source.[^raw] The lexer advances by `raw.length`, and the editor's import finds each top-level block in the source by its `raw` ([markdownImporter.ts:592](packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L592)). With `raw` unchanged, a block that was not edited is still saved byte for byte.

No pass over the whole document rewrites tabs. The copy with spaces exists only inside one tokenizer call.

### Content tabs pass through `marked`'s list tokenizer as a stand-in character

`marked` 18.0.9 writes every tab of a list item's line as spaces, content tabs included. `listWithTabStops` replaces each tab outside a container prefix with U+FDD0 before it calls `marked`, and turns U+FDD0 back into a tab before the item's content is lexed.[^stand-in] A source that already holds U+FDD0 gets no stand-in: its content tabs are read as `marked` reads them.

### A raw block that holds a prefix tab is not moved

`rawBlockAtMargin` ([markdownSerializer.ts:1784](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1784)) takes up to three spaces of indentation off a raw Markdown block. It now refuses a dedented form that moves a line holding a tab in its container prefix, because that tab would reach its stop from another column and the line would read differently.[^margin]

### A code line's prefix tab inside a container is read as spaces — pinned, not fixed

Inside a list item or a blockquote, a tab in the container prefix of a code or HTML line is read as spaces to its tab stop, where CommonMark keeps it as a tab. `··→bb` in a fenced block of a `- ` item is the code line `··bb`. `··-→old` in such a block is `-·old`. Corpus rows T30 to T33 pin this reading and the docs state it.[^pinned-code]

### Source mode's highlighting keeps two readings of its own — pinned, not fixed

Source mode's highlighting comes from `@lezer/markdown` 1.7.2, not from `marked`. It reads a heading whose `#` is followed by a tab as a paragraph, and it nests a list inside a blockquote differently when a tab follows the `>`. Rows TAB8 to TAB11 in `code-editor.test.ts` pin these readings and the docs state them. `languages.ts` is not changed.[^lezer]

### Corpus rows declare what the viewer reads

`CorpusCase` gains an optional `blocks` field: the outline of the blocks the viewer must read for the document. It follows the existing `links` field ([types.ts:17](packages/lib/tests/component/markdown-roundtrip/corpus/types.ts#L17)), which a `viewer reads the declared links` test checks.[^blocks-field] Every tab row carries `blocks`, so a row fails on the base commit when the reading is wrong, not only when viewer and editor disagree.

### What happens to the rows earlier plans named

| Row | Where | After this plan |
|---|---|---|
| The named exception `Enter on a marker line indented by a space and a tab (M36)` | `READ_OUT_OF_ITS_ITEM` in `markdown-roundtrip.test.ts` | removed with its record: the viewer now reads the document in one item |
| M34, M36, M37 | `code-editor.test.ts` | unchanged: they test Enter, which reads the syntax tree |
| The docs bullet on `tabSize` and Markdown's four columns | `CodeEditor.md` | unchanged: `markdown-language-readonly-and-fences` owns it |
| `E19` `h2` (`-·one→tab`) | `DIFFERS` in `markdown-editor.test.ts` | moves to `SAME` with new texts: both surfaces act and keep the tab |
| `E19` `UL`, `E24` (two), `E25`, `E26`, `E27` | `DIFFERS` | unchanged: they belong to `markdown-source-mode-list-lift-parity` |
| `E18` | not in the tree yet: `markdown-source-mode-list-lift-parity` adds it | belongs to that plan; its WYSIWYG text becomes `··bb` (row T30 pins the reading) |

`marked` is not upgraded here.[^marked-version]

---

## Internal Structure

All of this goes into [markdownExtensions.ts](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts), directly above the doc comment that starts `The four block tokenizers the dialect owns`. The code was run as written against the whole Markdown test suite.[^tested]

```ts
/**
 * The width of Markdown's tab stops, in columns: a tab advances to the next
 * multiple of four (CommonMark §2.2), whatever width an editor shows it with.
 * `editor/languages.ts` holds the same number for source mode's Enter rule.
 */
const MARKDOWN_TAB_STOP = 4;

/**
 * Stands in for a tab outside a line's container prefix while `marked`'s list
 * tokenizer runs, which would otherwise write every tab of a list item's line
 * as spaces. U+FDD0 is a Unicode noncharacter: no text is meant to hold it,
 * and no `marked` rule treats it as whitespace or as a marker.
 */
const KEPT_TAB = "﷐";

/**
 * One step of a line's container prefix: a run of spaces and tabs, a quote
 * marker, a list marker that whitespace or the line's end follows, or a task
 * checkbox that whitespace follows. Sticky, so each step is matched where the
 * one before it ended.
 */
const CONTAINER_PREFIX_STEP = /[ \t]+|>|(?:[*+-]|\d{1,9}[.)])(?=[ \t]|$)|\[[ xX]\](?=[ \t])/y;

/**
 * Finds where a line's container prefix ends: its leading run of whitespace,
 * `>` markers and list markers, and a task checkbox when one follows a list
 * marker. `> - [ ] x` ends before `x`; `- a - b` ends before `a`.
 *
 * @param line - One line, without its line end.
 * @returns The index of the first character past the prefix.
 */
function containerPrefixEnd(line: string): number {
    let end = 0;
    let afterListMarker = false;

    for (;;) {
        CONTAINER_PREFIX_STEP.lastIndex = end;

        const step = CONTAINER_PREFIX_STEP.exec(line)?.[0];

        if (step === undefined) {
            return end;
        }

        const first = step.charAt(0);
        const isWhitespace = first === " " || first === "\t";
        const isCheckbox = first === "[";

        if (isCheckbox && !afterListMarker) {
            return end;
        }

        if (!isWhitespace) {
            afterListMarker = first !== ">" && !isCheckbox;
        }

        end += step.length;
    }
}

/**
 * Writes every tab of a line's container prefix as the spaces that reach its
 * tab stop, counted from the line's start. The line then reads the same with
 * one character per column in its prefix, which is what `marked` counts.
 *
 * @internal Shared with the round-trip tests, not part of the public API surface.
 *
 * @param line - One line, without its line end.
 * @returns The line with a tab-free container prefix.
 */
export function withPrefixTabsAsSpaces(line: string): string {
    const end = containerPrefixEnd(line);
    let prefix = "";

    for (const char of line.slice(0, end)) {
        prefix += char === "\t" ? " ".repeat(MARKDOWN_TAB_STOP - (prefix.length % MARKDOWN_TAB_STOP)) : char;
    }

    return prefix + line.slice(end);
}

/**
 * Tells whether a line holds a tab in its container prefix: a tab whose
 * width depends on the column the line starts at.
 *
 * @internal Shared with the editor's serializer, not part of the public API surface.
 *
 * @param line - One line, without its line end.
 * @returns `true` when the prefix holds a tab.
 */
export function hasTabInContainerPrefix(line: string): boolean {
    return line.slice(0, containerPrefixEnd(line)).includes("\t");
}

/**
 * Applies `change` to every line of `text`.
 *
 * @param text - Lines joined by line feeds.
 * @param change - What to do with one line.
 * @returns The changed lines, joined by line feeds.
 */
function mapLines(text: string, change: (line: string) => string): string {
    return text.split("\n").map(change).join("\n");
}

/**
 * The first `count` lines of `text`, without the line end after the last.
 *
 * @param text - Lines joined by line feeds.
 * @param count - How many lines to take.
 * @returns Those lines, joined by line feeds.
 */
function leadingLines(text: string, count: number): string {
    return text.split("\n").slice(0, count).join("\n");
}

/**
 * Counts the lines a token's `raw` spans. A line end that closes the last
 * line starts no new one.
 *
 * @param raw - A token's `raw`.
 * @returns The number of lines.
 */
function lineCount(raw: string): number {
    const pieces = raw.split("\n").length;
    const closed = raw.endsWith("\n");

    return closed ? pieces - 1 : pieces;
}

/**
 * A view of `tokenizer` whose lexer turns every stand-in back into a tab
 * before it lexes a list item's content, so the item's blocks are read from
 * text with its own tabs. Every other property is `tokenizer`'s own.
 *
 * @param tokenizer - The tokenizer the list rule is running in.
 * @returns The view.
 */
function keptTabTokenizer(tokenizer: Tokenizer): Tokenizer {
    const lexer = tokenizer.lexer;
    const blockTokens = (text: string, tokens: Token[], lastParagraphClipped?: boolean): Token[] => {
        return lexer.blockTokens(text.replaceAll(KEPT_TAB, "\t"), tokens, lastParagraphClipped);
    };

    return Object.create(tokenizer, { lexer: { value: Object.create(lexer, { blockTokens: { value: blockTokens } }) } }) as Tokenizer;
}

/**
 * Sets a list token's `raw`, and each item's, back to the source lines they
 * span, and each item's `text` back to its own tabs. `marked` builds all
 * three from whole lines, so counting lines finds the source.
 *
 * @param list - The list token, lexed from the tab-free form of `src`.
 * @param src - The source the list was read from.
 * @param keptTabs - Whether the item texts hold stand-ins for tabs.
 */
function restoreListSource(list: Tokens.List, src: string, keptTabs: boolean): void {
    const lines = src.split("\n");
    let line = 0;

    for (const item of list.items) {
        const count = lineCount(item.raw);
        const closed = item.raw.endsWith("\n");
        const source = lines.slice(line, line + count).join("\n");

        item.raw = closed ? source + "\n" : source.trimEnd();
        item.text = keptTabs ? item.text.replaceAll(KEPT_TAB, "\t") : item.text;
        line += count;
    }

    list.raw = leadingLines(src, lineCount(list.raw)).trimEnd();
}

/**
 * Runs the dialect's list tokenizer on a form of the source in which a tab
 * counts as CommonMark counts it. `marked` writes every tab of a list item's
 * line as four spaces, wherever the tab starts, and so reads `- a` / (blank) /
 * two spaces, a tab, `b` as code where CommonMark reads a paragraph, and
 * writes the tab of a code span as spaces. Here each tab of a line's container
 * prefix is written as the spaces that reach its tab stop, and every other tab
 * is kept through {@link KEPT_TAB}. The token's `raw` and each item's are set
 * back to the source, which the lexer and the editor's import measure with.
 *
 * @param src - The remaining source at the current block position.
 * @returns The list token, or `undefined` when no list starts here.
 */
function listWithTabStops(this: Tokenizer, src: string): Tokens.List | undefined {
    const hasTab = src.includes("\t");

    if (!hasTab) {
        return listWithOwnTaskMarker.call(this, src);
    }

    // A source that already holds the stand-in gets no protection: its other tabs read as `marked` reads them.
    const keepsTabs = !src.includes(KEPT_TAB);
    const spaced = mapLines(src, withPrefixTabsAsSpaces);
    const list = keepsTabs
        ? listWithOwnTaskMarker.call(keptTabTokenizer(this), spaced.replaceAll("\t", KEPT_TAB))
        : listWithOwnTaskMarker.call(this, spaced);

    if (list === undefined) {
        return undefined;
    }

    restoreListSource(list, src, keepsTabs);

    return list;
}

/**
 * Runs the dialect's blockquote tokenizer on a form of the source in which a
 * tab counts as CommonMark counts it. `marked` takes one space or tab after
 * `>` and reads the rest from column 0, so `>`, a space, a tab, `foo` is code
 * where CommonMark reads a paragraph. Each tab of a line's container prefix
 * is written as the spaces that reach its tab stop; the token's `raw` is set
 * back to the source lines it spans.
 *
 * @param src - The remaining source at the current block position.
 * @returns The blockquote token, or `undefined` when no blockquote starts here.
 */
function blockquoteWithTabStops(this: Tokenizer, src: string): Tokens.Blockquote | undefined {
    const hasTab = src.includes("\t");

    if (!hasTab) {
        return blockquoteWithSourceRaw.call(this, src);
    }

    const token = blockquoteWithSourceRaw.call(this, mapLines(src, withPrefixTabsAsSpaces));

    if (token !== undefined) {
        token.raw = leadingLines(src, lineCount(token.raw));
    }

    return token;
}

/**
 * The indentation one line of an indented code block loses: a tab after up
 * to three spaces, or up to four spaces. The tab comes first: `marked` 18.0.9
 * tries the spaces first, and leaves the tab of a space-and-tab line in the
 * code.
 */
const INDENTED_CODE_LINE_START = /^(?: {0,3}\t| {1,4})/gm;

/**
 * Runs `marked`'s indented-code tokenizer and takes the indentation off each
 * line as CommonMark does: a tab that follows one to three spaces goes with
 * them. Only `text` changes.
 *
 * @param src - The remaining source at the current block position.
 * @returns The code token, or `undefined` when no indented code starts here.
 */
function codeWithTabIndent(this: Tokenizer, src: string): Tokens.Code | undefined {
    const token = Tokenizer.prototype.code.call(this, src);

    if (token !== undefined) {
        token.text = token.raw.replace(INDENTED_CODE_LINE_START, "");
    }

    return token;
}

/** The indentation of an indented backtick fence: one to three spaces. `marked` takes it off the content of backtick fences only. */
const INDENTED_BACKTICK_FENCE = /^ {1,3}(?=`{3})/;

/**
 * Writes the tabs in the first `columns` columns of a line's indentation as
 * the spaces that reach their tab stops.
 *
 * @param line - One line, without its line end.
 * @param columns - How many columns of indentation to make tab-free.
 * @returns The line, its indentation tab-free up to that column.
 */
function withIndentTabsAsSpaces(line: string, columns: number): string {
    let indentation = "";
    let index = 0;

    while (index < line.length && indentation.length < columns && (line[index] === " " || line[index] === "\t")) {
        indentation += line[index] === "\t" ? " ".repeat(MARKDOWN_TAB_STOP - (indentation.length % MARKDOWN_TAB_STOP)) : " ";
        index += 1;
    }

    return indentation + line.slice(index);
}

/**
 * Runs `marked`'s fenced-code tokenizer and, for a backtick fence indented by
 * one to three spaces, takes that many columns off each content line.
 * `marked` takes off characters: under a fence indented by one space it drops
 * a line's leading tab whole, where CommonMark leaves three spaces. The
 * token's own text is lexed again with those tabs written as spaces; only
 * `text` changes.
 *
 * @param src - The remaining source at the current block position.
 * @returns The code token, or `undefined` when no fenced code starts here.
 */
function fencesWithColumnIndent(this: Tokenizer, src: string): Tokens.Code | undefined {
    const token = Tokenizer.prototype.fences.call(this, src);

    if (token === undefined) {
        return undefined;
    }

    const indent = INDENTED_BACKTICK_FENCE.exec(token.raw)?.[0].length ?? 0;
    const hasTab = token.raw.includes("\t");

    if (indent === 0 || !hasTab) {
        return token;
    }

    const spaced = Tokenizer.prototype.fences.call(this, mapLines(token.raw, (line) => withIndentTabsAsSpaces(line, indent)));

    if (spaced !== undefined) {
        token.text = spaced.text;
    }

    return token;
}
```

`fencesWithColumnIndent` reads only `token.raw`, never the rest of `src`. Scanning `src` for a tab at every block position would make one lex quadratic in the document's length.

The serializer's guard, in [markdownSerializer.ts](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts). The last two statements of `rawBlockAtMargin` become:

```ts
    const reading = blockShape(lexMarkdown(source));
    const keepsReading = (candidate: string): boolean => {
        if (candidate === source) {
            return true;
        }

        const movesATab = movesLineWithPrefixTab(lines, candidate);

        return !movesATab && blockShape(lexMarkdown(candidate)) === reading;
    };

    return candidates.find(keepsReading) ?? source;
}

/**
 * Tells whether a dedented form of a block moves a line that holds a tab in
 * its container prefix. Such a tab reaches its tab stop from wherever the
 * line starts, so the moved line would be read with another indentation.
 *
 * @param lines - The block's lines as written.
 * @param candidate - A dedented form of the block.
 * @returns `true` when a changed line holds such a tab.
 */
function movesLineWithPrefixTab(lines: readonly string[], candidate: string): boolean {
    const moved = candidate.split("\n");

    return lines.some((line, index) => line !== moved[index] && hasTabInContainerPrefix(line));
}
```

The outline helper, appended to [viewModel.ts](packages/lib/tests/component/markdown-roundtrip/viewModel.ts):

```ts
/**
 * Writes a block's literal text for an outline: a tab as `→` and a line feed as `⏎`, so both show in a test title.
 *
 * @param text - A code block's or raw block's text.
 * @returns The text on one line.
 */
function outlineText(text: string): string {
    return text.replace(/\n+$/, '').replace(/\t/g, '→').replace(/\n/g, '⏎');
}

/**
 * Writes the text of a heading's or paragraph's runs for an outline.
 *
 * @param runs - The runs.
 * @returns Their text, an image as `!` and a line break as `⏎`.
 */
function outlineRuns(runs: Run[]): string {
    return runs.map((run) => (run.kind === 'text' ? run.text : run.kind === 'image' ? '!' : '⏎')).join('');
}

/**
 * Writes blocks as one line: `p"text"`, `h2"text"`, `code"text"`, `raw"text"`, `quote[…]`, `ul[li[…] li[…]]` or
 * `ol[…]` (with `!` after the name of a loose list), `table` and `fence`.
 *
 * @param blocks - The blocks of a document, a quote or a list item.
 * @returns The outline.
 */
export function blockOutline(blocks: Block[]): string {
    return blocks.map((block) => {
        switch (block.kind) {
            case 'paragraph': return `p"${outlineRuns(block.runs)}"`;
            case 'heading':   return `h${block.depth}"${outlineRuns(block.runs)}"`;
            case 'code':      return `code"${outlineText(block.text)}"`;
            case 'raw':       return `raw"${outlineText(block.text)}"`;
            case 'quote':     return `quote[${blockOutline(block.blocks)}]`;
            case 'list':      return `${block.ordered ? 'ol' : 'ul'}${block.loose ? '!' : ''}[${block.items.map((item) => `li[${blockOutline(item)}]`).join(' ')}]`;
            default:          return block.kind;
        }
    }).join(' ');
}
```

The generated tab documents, a new file `packages/lib/tests/component/markdown-roundtrip/tabDocuments.ts`. Keep the four pools and the order of the `random()` calls exactly as written: the counts in this plan were measured on these draws.

```ts
/** The indentation a generated line starts with. An entry listed more than once is drawn more often. */
const INDENTS: readonly string[] = ['', '', '', ' ', '  ', '   ', '    ', '\t', '\t', ' \t', '  \t', '   \t', '\t\t', '\t ', '\t  ', '      ', ' \t  '];

/** The marker that follows the indentation: none, a list marker or a quote marker, with a space or a tab after it. */
const MARKERS: readonly string[] = ['', '', '', '- ', '-\t', '-  \t', '1. ', '1.\t', '> ', '>\t', '>', '> \t', '* '];

/** A second marker, or a task checkbox. */
const SECOND_MARKERS: readonly string[] = ['', '', '', '', '- ', '-\t', '> ', '>\t', '[ ] ', '[ ]\t'];

/** What the line holds after its markers. None holds a double quote, which an outline uses around text. */
const CONTENTS: readonly string[] = ['x', 'y z', 'a\tb', '`c\td`', '```', '~~~', '<div>', '</div>', '<pre>', '</pre>', '# h', '#\th', '---', '', '', 'w'];

/** The seed every draw starts from, chosen once so the documents are the same on every run. */
const SEED = 20261011;

/** The share of lines left empty, so that blank lines separate blocks. */
const BLANK_LINE_SHARE = 0.15;

/** A document holds this many lines at least, and up to `LINE_SPREAD - 1` more. */
const MIN_LINES = 2;
const LINE_SPREAD = 5;

/**
 * Builds the mulberry32 generator, whose constants are the algorithm's own.
 *
 * @param seed - The starting state.
 * @returns A function giving the next number in `[0, 1)`.
 */
function mulberry32(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6D2B79F5) >>> 0;

        let mixed = state;

        mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Draws documents whose lines are an indentation, up to two markers and a content, and keeps those that hold a tab.
 * The same `draws` gives the same documents on every run: 600 draws give 591 documents, 3,000 give 2,932.
 *
 * @param draws - How many documents to draw.
 * @returns The drawn documents that hold a tab, in draw order.
 */
export function tabDocuments(draws: number): string[] {
    const random = mulberry32(SEED);
    const pick = (pool: readonly string[]): string => pool[Math.floor(random() * pool.length)]!;
    const documents: string[] = [];

    for (let draw = 0; draw < draws; draw++) {
        const lineTotal = MIN_LINES + Math.floor(random() * LINE_SPREAD);
        const lines: string[] = [];

        for (let line = 0; line < lineTotal; line++) {
            const blank = random() < BLANK_LINE_SHARE;

            lines.push(blank ? '' : pick(INDENTS) + pick(MARKERS) + pick(SECOND_MARKERS) + pick(CONTENTS));
        }

        documents.push(lines.join('\n') + '\n');
    }

    return documents.filter((document) => document.includes('\t'));
}
```

---

## Ordered Implementation Steps

The base moves under this plan: eight plans land first. Find every edit by the quoted text or the symbol name, not by line number. Run commands from `packages/lib`.

Steps 1 to 4 add tests only. Step 4 lists what must be red before step 5 starts.

1. **Add the test helpers.**
   - Create `tests/component/markdown-roundtrip/tabDocuments.ts` from `## Internal Structure`.
   - Append `outlineText`, `outlineRuns` and `blockOutline` from `## Internal Structure` to `tests/component/markdown-roundtrip/viewModel.ts`.
   - In `tests/component/markdown-roundtrip/corpus/types.ts`, add this field to `CorpusCase`, between `links` and `known`: `readonly blocks?: string;                                         // the outline the viewer must read (blockOutline)`.
   - In `tests/component/markdown-roundtrip/markdown-roundtrip.test.ts`, import `blockOutline` from `./viewModel`. In the `for (const testCase of CORPUS)` loop, directly after the `if (links !== undefined) { … }` block, add:

     ```ts
     const blocks = testCase.blocks;

     if (blocks !== undefined) {
         it('viewer reads the declared blocks', () => {
             expect(blockOutline(viewerModel(testCase.source).blocks)).toBe(blocks);
         });
     }
     ```
   - Check: `npx vitest run tests/component/markdown-roundtrip` is green. No case declares `blocks` yet.

2. **Add the corpus rows.**
   - In `corpus/commonmark.ts`, insert the nine `CommonMark … (Tabs)` rows of `## Expected Behaviour` in example order: 2 to 9 after `CommonMark 1 (Tabs)`, and 11 after `CommonMark 10 (Tabs)`.
   - Create `corpus/tabs.ts`. It imports `CorpusCase` as `corpus/referenceLinks.ts` does and exports `TAB_CASES: readonly CorpusCase[]`, holding rows T1 to T42 of `## Expected Behaviour` in order, under this doc comment: `/** Documents with a tab in a line's indentation, after a list marker or after a quote marker. Each declares the blocks the viewer reads; T30 to T33 hold the one reading that differs from CommonMark, a tab in the container prefix of a code line inside a list item or quote. */`
   - In `corpus/index.ts`, import `TAB_CASES` and append `...TAB_CASES` to `CORPUS`.

3. **Add the lexer rows, the generated-document tests and the source-mode language rows.**
   - In `tests/component/display/markdownLexer.test.ts`, import `tabDocuments` from `'../markdown-roundtrip/tabDocuments'`, and add `describe('a tab counts to its tab stop, and a content tab is kept', …)` after the `describe` named `a blockquote's raw is the source it used`, holding rows LX30 to LX37 of `## Expected Behaviour`.
   - In `markdown-roundtrip.test.ts`, import `tabDocuments` from `./tabDocuments`, and add `describe('generated tab documents', …)` before `describe('corpus integrity', …)`, holding the two constants and row G3 of `## Expected Behaviour`. Rows G1 and G2 need a function that step 5 adds, and go in then.
   - In `tests/component/code-editor.test.ts`, inside `describe('built-in markdown language typing', …)` and after the M37 loop, add the `treeOutline` helper and rows TAB1 to TAB11 of `## Expected Behaviour`.

4. **Change the rows earlier plans pinned, and confirm what is red.**
   - In `tests/component/markdown-editor.test.ts`, delete the `DIFFERS` row `['E19', '- one\ttab\n- z', 'one', null, 'h2', '## one   tab\n\n- z', '- one\ttab\n- z'],`. Add rows E19 `h2` and E37 of `## Expected Behaviour` to `SAME`, after the last `L2` row. Add row E38 to `DIFFERS`, after the `E19` `UL` row.
   - In `tests/component/markdown-source-edits.test.ts`, replace the test `declines when a tab on an item's marker line stands where the command has to read` and the comment above it with the two tests S1 and S2 of `## Expected Behaviour`.
   - Run `npx vitest run tests/component/markdown-roundtrip tests/component/display/markdownLexer.test.ts tests/component/markdown-editor.test.ts tests/component/markdown-source-edits.test.ts tests/component/code-editor.test.ts`. Red, and nothing else: the `viewer reads the declared blocks` test of every corpus row whose "Base reads" column in `## Expected Behaviour` is not "the same"; the `surface` test of T14, T35 and T36; LX30, LX32, LX34, LX35, LX36; E19 `h2`, E37, E38; S1 and S2. TAB1 to TAB11, LX31, LX33, LX37 and G3 are green: they pin readings that hold already.

5. **Add the helpers and the two code tokenizers.** In `markdownExtensions.ts`:
   - Paste the whole block of `## Internal Structure` above the doc comment that starts `The four block tokenizers the dialect owns`.
   - In `DIALECT_BLOCK_TOKENIZERS`, add `code: codeWithTabIndent,` and `fences: fencesWithColumnIndent,` after the `html` entry. Leave `blockquote` and `list` as they are for now.
   - In `BOUNDED_BLOCK_TOKENIZERS`, add after the `html(src) { … },` entry:

     ```ts
     code:   codeWithTabIndent,
     fences: fencesWithColumnIndent,
     ```
   - Check: CommonMark 2 and T1 to T6 are green, and LX34, LX35.
   - In `markdown-roundtrip.test.ts`, import `withPrefixTabsAsSpaces` from `~/component/display/markdownExtensions`, and add `spacesForm`, `shape`, `agrees` and rows G1 and G2 of `## Expected Behaviour` to `describe('generated tab documents', …)`, above G3. Both are red now: the list and quote tokenizers are not installed yet. They are green after step 7.

6. **Install the list tokenizer.**
   - In `DIALECT_BLOCK_TOKENIZERS`, change `list: listWithOwnTaskMarker,` to `list: listWithTabStops,`.
   - In `BOUNDED_BLOCK_TOKENIZERS`, change `listWithOwnTaskMarker.call(this, blockWindow(src))` to `listWithTabStops.call(this, blockWindow(src))`.
   - Check: T14 to T31 are green; LX30, LX32; E19 `h2`, E37, E38; S1. The test `Enter on a marker line indented by a space and a tab (M36)` in `describe('what Enter leaves inside HTML stays in its blockquote or list item', …)` is now red with the message `now read in one item — remove its entry`.
   - In `markdown-roundtrip.test.ts`, delete the constant `READ_OUT_OF_ITS_ITEM` with its doc comment, delete the line `const known = READ_OUT_OF_ITS_ITEM[name];`, and replace the `if (known === undefined) { … } else { … }` statement with `expect([...containers]).toHaveLength(1);`.
   - In `corpus/enterInsideHtml.ts`, end the file's doc comment at `(markdown-roundtrip.test.ts checks that on the viewer's reading).`, dropping `, and names the one document it does not hold for`.

7. **Install the blockquote tokenizer.**
   - In `DIALECT_BLOCK_TOKENIZERS`, change `blockquote: blockquoteWithSourceRaw,` to `blockquote: blockquoteWithTabStops,`.
   - In `BOUNDED_BLOCK_TOKENIZERS`, change `blockquoteWithSourceRaw.call(this, blockWindow(src))` to `blockquoteWithTabStops.call(this, blockWindow(src))`.
   - Check: CommonMark 6 and T32 to T40 are green; LX36; S2; G1 and G2. Row T41 is now red on its `canonical` test. That is expected: step 8 fixes it.

8. **Add the serializer's guard.** In `markdownSerializer.ts`:
   - Add `hasTabInContainerPrefix` to the names imported from `~/component/display/markdownExtensions.js`.
   - Replace the last two statements of `rawBlockAtMargin` and add `movesLineWithPrefixTab` after the function, as `## Internal Structure` shows. In the function's doc comment, add this paragraph before the `@param` lines: `A dedented form that moves a line holding a tab in its container prefix is not kept either: the tab would reach its tab stop from another column.`
   - Check: T41 is green.

9. **Update the two doc comments that count slots.** In `markdownExtensions.ts`:
   - The comment that starts `The four block tokenizers the dialect owns, installed in marked's blockquote, list, table and html slots` becomes `The six block tokenizers the dialect owns, installed in marked's blockquote, list, table, html, code and fences slots`. In the same comment, `calls the same four behind its guards` becomes `calls the same six, four of them behind its guards`.
   - In the comment that starts `The six block slots the bounded instance overrides`, change `six` to `eight`, and add this sentence before the paragraph that starts `The originals are reached through`: `code and fences carry no guard and no window: each calls marked's own tokenizer on the same source it would have been given, and then reads only the token it returned.`
   - Check: `grep -n "listWithOwnTaskMarker\|blockquoteWithSourceRaw" src/typescript/lib/component/display/markdownExtensions.ts` shows each name in its own definition, in doc comments, and in one call inside `listWithTabStops` or `blockquoteWithTabStops`, and in no tokenizer table.

10. **Run the whole Markdown suite.** `npx vitest run tests/component/markdown tests/component/display/Markdown tests/component/display/markdownLexer tests/component/code-editor.test.ts`. Everything is green. If a test outside this plan's files fails, stop and report it: on the base commit the change was run against all 8,128 Markdown tests and changed three.[^tested]

11. **Write the docs and the changelog entry** as `## Documentation Impact` gives them: `docs/components/Markdown.md`, `docs/components/MarkdownEditor.md` and `docs/reference/changelog/next.md`.

12. **Run the differential** of `## Verification`, then the project checks listed there.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Create | `packages/lib/tests/component/markdown-roundtrip/tabDocuments.ts` |
| Create | `packages/lib/tests/component/markdown-roundtrip/corpus/tabs.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/types.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/index.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/commonmark.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/enterInsideHtml.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/viewModel.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-roundtrip.test.ts` |
| Modify | `packages/lib/tests/component/display/markdownLexer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-edits.test.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every row is unit-testable. Nothing here needs a browser.

### Corpus rows for `corpus/commonmark.ts`

Paste as written. "Base reads" is what `blockOutline` gives on the base commit; a row that says "the same" pins a reading that is already right.

```ts
    { name: 'CommonMark 2 (Tabs)', source: '  \tfoo\tbaz\t\tbim\n', blocks: 'code"foo→baz→→bim"' },
    { name: 'CommonMark 3 (Tabs)', source: '    a\ta\n    ὐ\ta\n', blocks: 'code"a→a⏎ὐ→a"' },
    { name: 'CommonMark 4 (Tabs)', source: '  - foo\n\n\tbar\n', blocks: 'ul![li[p"foo" p"bar"]]' },
    { name: 'CommonMark 5 (Tabs)', source: '- foo\n\n\t\tbar\n', blocks: 'ul![li[p"foo" code"  bar"]]' },
    { name: 'CommonMark 6 (Tabs)', source: '>\t\tfoo\n', blocks: 'quote[code"  foo"]', known: { surface: 'quoteBlocks' } },
    { name: 'CommonMark 7 (Tabs)', source: '-\t\tfoo\n', blocks: 'ul[li[code"  foo"]]' },
    { name: 'CommonMark 8 (Tabs)', source: '    foo\n\tbar\n', blocks: 'code"foo⏎bar"' },
    { name: 'CommonMark 9 (Tabs)', source: ' - foo\n   - bar\n\t - baz\n', blocks: 'ul[li[p"foo" ul[li[p"bar" ul[li[p"baz"]]]]]]' },
    { name: 'CommonMark 11 (Tabs)', source: '*\t*\t*\t\n', blocks: 'raw"* * *"' },
```

| Row | Base reads |
|---|---|
| CommonMark 2 | `code"→foo→baz→→bim"` |
| CommonMark 6 | `quote[code"foo"]` |
| CommonMark 3, 4, 5, 7, 8, 9, 11 | the same |

### Corpus rows for `corpus/tabs.ts`

```ts
    { name: 'T1: a tab after one space indents a code line', source: ' \tfoo\n', blocks: 'code"foo"' },
    { name: 'T2: a tab after three spaces indents a code line', source: '   \tfoo\n', blocks: 'code"foo"' },
    { name: 'T3: code lines indented by a tab, by a space and a tab, and by two spaces and two tabs', source: '\tfoo\n \tbar\n  \t\tbaz\n', blocks: 'code"foo⏎bar⏎→baz"' },
    { name: 'T4: a marker line indented by a space and a tab is code', source: ' \t- a\n', blocks: 'code"- a"' },
    { name: 'T5: a fence indented by one space takes one column off a tab-indented line', source: ' ```\n\tx\n ```\n', blocks: 'code"   x"' },
    { name: 'T6: a fence indented by three spaces takes three columns off a line indented by two spaces and a tab', source: '   ```\n  \tx\n   ```\n', blocks: 'code" x"' },
    { name: 'T7: a tab-indented line of a fence at the margin keeps its tab', source: '```\n\tx\n```\n', blocks: 'code"→x"' },
    { name: 'T8: a tab after an item marker', source: '-\tone\n', blocks: 'ul[li[p"one"]]' },
    { name: 'T9: a tab after an item marker, with a block indented by a tab (E19)', source: '-\tone\n\n\tsecond\n- two\n', blocks: 'ul![li[p"one" p"second"] li[p"two"]]' },
    { name: 'T10: a tab after an ordered marker of two digits', source: '10.\tone\n\n\ttwo\n', blocks: 'ol![li[p"one" p"two"]]' },
    { name: 'T11: a tab after an item marker over a line of three spaces', source: '-\tone\n\n   two\n', blocks: 'ul[li[p"one"]] p"two"' },
    { name: 'T12: a block of an item indented by a tab (E24)', source: '- one\n\n\tsecond\n- two\n', blocks: 'ul![li[p"one" p"second"] li[p"two"]]' },
    { name: 'T13: a nested list indented by a tab (E26)', source: '- one\n\t- nested\n- two\n', blocks: 'ul[li[p"one" ul[li[p"nested"]]] li[p"two"]]' },
    { name: 'T14: three levels of items written with tabs', source: '-\ta\n\t-\tb\n\t\t-\tc\n', blocks: 'ul[li[p"a" ul[li[p"b" ul[li[p"c"]]]]]]' },
    { name: 'T15: a tab after two spaces continues an item as a paragraph', source: '- a\n\n  \tb\n', blocks: 'ul![li[p"a" p"b"]]' },
    { name: 'T16: a tab after three spaces continues an item as a paragraph', source: '- a\n\n   \tb\n', blocks: 'ul![li[p"a" p"b"]]' },
    { name: 'T17: two tabs after two spaces are code indented by two spaces', source: '- a\n\n  \t\tcode\n', blocks: 'ul![li[p"a" code"  code"]]' },
    { name: 'T18: a marker after two spaces and a tab starts a nested list', source: '- a\n  \t- b\n', blocks: 'ul[li[p"a" ul[li[p"b"]]]]' },
    { name: 'T19: a nested item after a space and a tab holds a six-space line', source: '- a\n \t- b\n\n      x\n- z\n', blocks: 'ul[li[p"a" ul![li[p"b" p"x"]]] li[p"z"]]' },
    { name: 'T20: a tab after a nested marker counts from the line start', source: '- a\n  -\tb\n\n\tx\n', blocks: 'ul[li[p"a" ul![li[p"b" p"x"]]]]' },
    { name: 'T21: a nested item written with tabs holds a line of two tabs', source: '- a\n\t-\tb\n\n\t\tx\n', blocks: 'ul[li[p"a" ul![li[p"b" p"x"]]]]' },
    { name: 'T22: a tab in an item\'s text on its marker line (E19)', source: '- one\ttab\n- z\n', blocks: 'ul[li[p"one tab"] li[p"z"]]' },
    { name: 'T23: a tab in a code span on an item\'s marker line', source: '- a `x\ty`\n', blocks: 'ul[li[p"a x y"]]' },
    { name: 'T24: a tab in a code span on a later line of an item', source: '- a\n  `x\ty`\n', blocks: 'ul[li[p"a x y"]]' },
    { name: 'T25: a tab inside a line of indented code in an item', source: '- a\n\n      co\tde\n', blocks: 'ul![li[p"a" code"co→de"]]' },
    { name: 'T26: a tab inside a line of fenced code in an item', source: '- one\n\n  ```\n  a\tb\n  ```\n', blocks: 'ul![li[p"one" code"a→b"]]' },
    { name: 'T27: a tab inside a line of tab-indented fenced code in an item', source: '- a\n\n\t```\n\tcode\ttab\n\t```\n', blocks: 'ul![li[p"a" code"code→tab"]]' },
    { name: 'T28: a tab after a task marker', source: '- [ ]\ttask\n- [x]\tdone\n', blocks: 'ul[li[p"[ ] task"] li[p"[x] done"]]' },
    { name: 'T29: a tab before a task marker', source: '-\t[ ]\ttask\n', blocks: 'ul[li[p"[ ] task"]]' },
    { name: 'T30: a tab that starts a code line in an item reads as spaces to its stop (E18)', source: '- one\n\n  ```\n  aa\n  \tbb\n  ```\n\n- two\n', blocks: 'ul![li[p"one" code"aa⏎  bb"] li[p"two"]]' },
    { name: 'T31: a tab after a marker character that starts a code line in an item reads as spaces to its stop', source: '- a\n\n  ```\n  -\told\n  +\tnew\n  ```\n', blocks: 'ul![li[p"a" code"- old⏎+ new"]]' },
    { name: 'T32: three tabs after a quote marker are code indented by six spaces', source: '>\t\t\tfoo\n', blocks: 'quote[code"      foo"]', known: { surface: 'quoteBlocks' } },
    { name: 'T33: a tab that starts a code line in a quote reads as spaces to its stop', source: '> ```\n> \tx\n> ```\n', blocks: 'quote[code"  x"]', known: { surface: 'quoteBlocks' } },
    { name: 'T34: a tab after a quote marker', source: '>\tfoo\n>\tbar\n', blocks: 'quote[p"foo bar"]' },
    { name: 'T35: a tab after a quote marker and a space is not code', source: '> \tfoo\n', blocks: 'quote[p"foo"]' },
    { name: 'T36: a tab after a quote marker and two spaces is not code', source: '>  \tfoo\n', blocks: 'quote[p"foo"]' },
    { name: 'T37: a tab after a quote marker nests an item under the item above', source: '> - a\n>\t- b\n', blocks: 'quote[ul[li[p"a" ul[li[p"b"]]]]]', known: { surface: 'quoteBlocks' } },
    { name: 'T38: a tab after a quote marker continues the item above', source: '> - a\n>\n>\tb\n', blocks: 'quote[ul![li[p"a" p"b"]]]', known: { surface: 'quoteBlocks' } },
    { name: 'T39: a tab and four spaces after a quote marker are code indented by two spaces', source: '>\t    code\n', blocks: 'quote[code"  code"]', known: { surface: 'quoteBlocks' } },
    { name: 'T40: a list in a quote with a tab after each quote marker', source: '>\t- a\n>\t- b\n', blocks: 'quote[ul[li[p"a"] li[p"b"]]]', known: { surface: 'quoteBlocks' } },
    { name: 'T41: an indented quote holding a tab keeps its indentation when written again', source: '  > \t```\n', blocks: 'quote[code"```"]', known: { surface: 'quoteBlocks' } },
    { name: 'T42: a tab in an item\'s text beside U+FDD0', source: '- a\n\n  x﷐y\tz\n', blocks: 'ul![li[p"a" p"x﷐y z"]]' },
```

| Row | Document | Base reads |
|---|---|---|
| T1 | `·→foo⏎` | `code"→foo"` |
| T2 | `···→foo⏎` | `code"→foo"` |
| T3 | `→foo⏎·→bar⏎··→→baz⏎` | `code"foo⏎→bar⏎→→baz"` |
| T4 | `·→-·a⏎` | `code"→- a"` |
| T5 | `` ·```⏎→x⏎·```⏎ `` | `code"x"`: the tab is dropped |
| T6 | `` ···```⏎··→x⏎···```⏎ `` | `code"x"` |
| T14 | `-→a⏎→-→b⏎→→-→c⏎` | `ul[li[p"a" ul[li[p"b"]] code"-    c"]]`, and `surface` fails |
| T15 | `-·a⏎⏎··→b⏎` | `ul![li[p"a" code"b"]]` |
| T16 | `-·a⏎⏎···→b⏎` | `ul![li[p"a" code" b"]]` |
| T17 | `-·a⏎⏎··→→code⏎` | `ul![li[p"a" code"    code"]]` |
| T18 | `-·a⏎··→-·b⏎` | `ul[li[p"a - b"]]` |
| T19 | `-·a⏎·→-·b⏎⏎······x⏎-·z⏎` | `ul![li[p"a" ul[li[p"b"]] code"x"] li[p"z"]]` |
| T20 | `-·a⏎··-→b⏎⏎→x⏎` | `ul![li[p"a" ul[li[p"b"]] p"x"]]` |
| T21 | `-·a⏎→-→b⏎⏎→→x⏎` | `ul![li[p"a" ul[li[p"b"]] code"  x"]]` |
| T25 | `-·a⏎⏎······co→de⏎` | `ul![li[p"a" code"co    de"]]` |
| T26 | `` -·one⏎⏎··```⏎··a→b⏎··```⏎ `` | `ul![li[p"one" code"a    b"]]` |
| T27 | `` -·a⏎⏎→```⏎→code→tab⏎→```⏎ `` | `ul![li[p"a" code"code    tab"]]` |
| T30 | `` -·one⏎⏎··```⏎··aa⏎··→bb⏎··```⏎⏎-·two⏎ `` | `ul![li[p"one" code"aa⏎    bb"] li[p"two"]]` |
| T31 | `` -·a⏎⏎··```⏎··-→old⏎··+→new⏎··```⏎ `` | `ul![li[p"a" code"-    old⏎+    new"]]` |
| T32 | `>→→→foo⏎` | `quote[code"→foo"]` |
| T33 | `` >·```⏎>·→x⏎>·```⏎ `` | `quote[code"→x"]` |
| T35 | `>·→foo⏎` | `quote[code"foo"]`, and `surface` fails |
| T36 | `>··→foo⏎` | `quote[code"→foo"]`, and `surface` fails |
| T37 | `>·-·a⏎>→-·b⏎` | `quote[ul[li[p"a"] li[p"b"]]]` |
| T38 | `>·-·a⏎>⏎>→b⏎` | `quote[ul[li[p"a"]] p"b"]` |
| T39 | `>→····code⏎` | `quote[code"code"]` |
| T7 to T13, T22 to T24, T28, T29, T34, T40, T41, T42 | | the same |

Three notes on rows that are green on the base commit:

- T22 to T24 hold a content tab in running text. An outline cannot show it, because the viewer collapses whitespace there. LX30, E19 `h2` and E37 pin those tabs.
- T41 is green on the base commit and after step 8. It is red on `canonical` between steps 7 and 8, which is what shows the serializer's guard at work.
- T42 guards the branch of `listWithTabStops` that gives no stand-in. A version that always turned U+FDD0 back into a tab would read `x→y z`.

### Lexer rows, `markdownLexer.test.ts`

Paste as written. `joinedRaws`, `lexMarkdownUnbounded` and the `Tokens` type are already in the file's scope; add what is not.

```ts
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

    it('LX33. reads a source that holds U+FDD0 without turning it into a tab', () => {
        const list = lexMarkdown('- a\n\n  x\uFDD0y\tz')[0] as Tokens.List;

        expect(list.items[0]!.text).toContain('\uFDD0');
        expect(list.items[0]!.text).not.toContain('\t');
    });

    it('LX34. takes a tab after spaces off an indented code line', () => {
        expect(lexMarkdown('  \tfoo\n\nafter')[0]).toMatchObject({ type: 'code', raw: '  \tfoo', text: 'foo' });
    });

    it('LX35. takes one column off a tab-indented line under a fence indented by one space', () => {
        const source = ' ```\n\tx\n ```\nafter';
        const tokens = lexMarkdown(source);

        expect(tokens[0]).toMatchObject({ type: 'code', raw: ' ```\n\tx\n ```\n', text: '   x' });
        expect(joinedRaws(tokens)).toBe(source);
    });

    it('LX36. sets a quote\'s raw back to the source, lazy line included', () => {
        const source = '> - a\n>\t- b\nlazy\n\nafter';
        const tokens = lexMarkdown(source);
        const quote = tokens[0] as Tokens.Blockquote;

        expect(quote).toMatchObject({ type: 'blockquote', raw: '> - a\n>\t- b\nlazy' });
        expect((quote.tokens[0] as Tokens.List).items).toHaveLength(1);
        expect(joinedRaws(tokens)).toBe(source);
    });

    // 3,000 draws give 2,932 documents. Both checks hold before the tab tokenizers too: this row guards the two
    // `raw` restores and the windows.
    it('LX37. joins the top-level raws of 3,000 drawn tab documents back into each document, as the unbounded twin lexes them', () => {
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
```

| Row | On the base commit |
|---|---|
| LX30 | red: the item's text is `` a `x··y` `` and the code span holds `x··y` |
| LX32 | red: the HTML holds `a····b` |
| LX34 | red: `text` is `→foo` |
| LX35 | red: `text` is `x`, the tab dropped |
| LX36 | red: the quote's list holds two items |
| LX31, LX33, LX37 | green: they guard what the new tokenizers must not break |

### Generated tab documents, `markdown-roundtrip.test.ts`

The *spaces form* of a document is the document with every tab of a container prefix written as the spaces that reach its tab stop. Paste as written.

```ts
describe('generated tab documents', () => {
    /** How many documents are drawn; 591 of them hold a tab. */
    const DRAWS = 600;

    /** These tests load each document several times, which takes longer than the default timeout allows. */
    const TIMEOUT_MS = 120_000;

    /**
     * Writes a document with every tab of a container prefix as the spaces that reach its tab stop.
     *
     * @param document - A document.
     * @returns Its spaces form.
     */
    function spacesForm(document: string): string {
        return document.split('\n').map(withPrefixTabsAsSpaces).join('\n');
    }

    /**
     * Writes the outline of what the viewer reads, without the text of code and raw blocks, where a tab may stand,
     * and with a line break as a space: a line that is all markers and whitespace ends in spaces in the spaces form.
     *
     * @param document - A document.
     * @returns The outline.
     */
    function shape(document: string): string {
        return blockOutline(viewerModel(document).blocks).replace(/(code|raw)"[^"]*"/g, '$1').replace(/⏎/g, ' ');
    }

    /**
     * Tells whether the editor's surface holds the blocks the viewer shows for a document.
     *
     * @param document - A document.
     * @returns `true` when they are the same.
     */
    function agrees(document: string): boolean {
        return JSON.stringify(editorSurfaceModel(loadAndSave(document).editor)) === JSON.stringify(viewerModel(document).blocks);
    }

    it('G1. a tab document reads as its spaces form', () => {
        const differing = tabDocuments(DRAWS).filter((document) => shape(document) !== shape(spacesForm(document)));

        expect(differing.map((document) => JSON.stringify(document))).toEqual([]);
    }, TIMEOUT_MS);

    it('G2. viewer and editor agree on a tab document exactly when they agree on its spaces form', () => {
        const differing = tabDocuments(DRAWS).filter((document) => agrees(document) !== agrees(spacesForm(document)));

        expect(differing.map((document) => JSON.stringify(document))).toEqual([]);
    }, TIMEOUT_MS);

    it('G3. an unedited tab document is saved byte for byte, and the save reloads to itself', () => {
        const differing = tabDocuments(DRAWS).filter((document) => {
            const { saved } = loadAndSave(document);

            return saved !== document || loadAndSave(saved).saved !== saved;
        });

        expect(differing.map((document) => JSON.stringify(document))).toEqual([]);
    }, TIMEOUT_MS);
});
```

| Row | On the base commit, measured on 3,000 draws | With this plan's code, on 3,000 draws |
|---|---|---|
| G1 | at least 346 of 2,932 documents: that many differ in block structure alone | 0 |
| G2 | 81 differ | 0 |
| G3 | 0 | 0 |

### Parity rows, `markdown-editor.test.ts`

```ts
        // SAME — a tab in an item's text or in a code span is content on both surfaces.
        ['E19', '- one\ttab\n- z', 'one', null, 'h2', '## one\ttab\n\n- z', '## one\ttab\n- z'],
        ['E37', '- a `x\ty`\n- z', 'a', null, 'h2', '## a `x\ty`\n\n- z', '## a `x\ty`\n- z'],
        // DIFFERS — the code block leaves the list on the WYSIWYG surface alone, as in the E24 rows; its tab is kept on both.
        ['E38', '- one\n\n  ```\n  a\tb\n  ```\n\n- two', 'one', null, 'UL', 'one\n\n```\na\tb\n```\n\n- two', 'one\n\n- ```\n  a\tb\n  ```\n\n- two'],
```

On the base commit E19 `h2` and E37 fail at `the document is in the form the editor saves` (the editor saves `-·one···tab` and `` `x··y` ``), and E38's WYSIWYG text is `a····b`.

### Source-mode line commands, `markdown-source-edits.test.ts`

```ts
    // A tab right after an item's marker, in an item that holds further lines: the item's text is not found past it.
    // The source-mode list lift plan owns these.
    it('S1. declines when a tab follows the marker of an item that holds further lines, and acts on a tab inside the text', () => {
        expect(blockPrefixSource('## ')('-\tone\n\n\tsecond\n- two', 2, 2)).toBeNull();
        expect(listSource('unordered')('-\tone\n\n\tsecond\n- two', 2, 2)).toBeNull();

        // A tab inside the text is content, kept in the token as written, so the text is found.
        expect(apply('- one\ttab\n- z', blockPrefixSource('## ')('- one\ttab\n- z', 2, 2)!)).toBe('## one\ttab\n- z');
        expect(apply('- one\ttab\n- z', listSource('ordered')('- one\ttab\n- z', 2, 2)!)).toBe('1. one\ttab\n- z');

        // An item of one line: the tab after its marker goes with the marker.
        expect(apply('-\tone\n- two', blockPrefixSource('## ')('-\tone\n- two', 2, 2)!)).toBe('## one\n- two');
    });

    // The tab after `>` is three columns wide here, so the list's markers stand indented by two inside the quote,
    // and a command on an indented list declines (row E33).
    it('S2. declines on an item of a list in a quote whose markers a tab after the quote marker indents', () => {
        expect(blockPrefixSource('## ')('>\t- a\n>\t- b', 4, 4)).toBeNull();
        expect(listSource('unordered')('>\t- a\n>\t- b', 4, 4)).toBeNull();
    });
```

On the base commit S1's two middle expectations fail (both commands return `null`) and S2 fails (the heading command gives `## a⏎>→- b`).[^s2]

### The source-mode language's block tree, `code-editor.test.ts`

The helper and the rows. `buildTypingState` and `settle` are the `describe`'s own; `syntaxTree` is already imported.

```ts
    /** A syntax tree node, as far as an outline reads it. */
    interface OutlineNode { readonly name: string; readonly firstChild: OutlineNode | null; readonly nextSibling: OutlineNode | null }

    /** The Markdown block nodes an outline names, and the name it gives each. Headings are matched apart. */
    const BLOCK_NAMES: Readonly<Record<string, string>> = {
        Paragraph: 'p', Blockquote: 'quote', BulletList: 'ul', OrderedList: 'ol', ListItem: 'li',
        CodeBlock: 'code', FencedCode: 'code', HTMLBlock: 'raw', HorizontalRule: 'raw',
    };

    /** The outline names that hold no blocks. */
    const LEAF_NAMES: ReadonlySet<string> = new Set(['p', 'code', 'raw']);

    /**
     * Writes the Markdown blocks under a syntax node as one line, in the round-trip harness's outline form without
     * text: `ul[li[p ul[li[p]]]]`.
     *
     * @param node - The document node, or a block that holds blocks.
     * @returns The outline of its blocks.
     */
    function treeOutline(node: OutlineNode): string {
        const parts: string[] = [];

        for (let child = node.firstChild; child !== null; child = child.nextSibling) {
            const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(child.name);
            const name = heading === null ? BLOCK_NAMES[child.name] : `h${heading[1]}`;

            if (name === undefined) {
                continue;
            }

            const isLeaf = heading !== null || LEAF_NAMES.has(name);

            parts.push(isLeaf ? name : `${name}[${treeOutline(child)}]`);
        }

        return parts.join(' ');
    }

    /**
     * Reads the block outline the built-in `"markdown"` language gives a document.
     *
     * @param doc - The document.
     * @returns The outline of its syntax tree.
     */
    async function languageOutline(doc: string): Promise<string> {
        const state = settle(await buildTypingState('markdown', doc));

        return treeOutline(syntaxTree(state).topNode as unknown as OutlineNode);
    }
```

Each row is `it('<id>: <title>', async () => { expect(await languageOutline(<doc>)).toBe(<outline>); });`. A document must not hold `|`, which `buildTypingState` reads as the caret; none below does.

| Row | Title | Document | Outline | The viewer reads |
|---|---|---|---|---|
| TAB1 | a tab after two spaces continues an item as a paragraph | `'- a\n\n  \tb'` | `ul[li[p p]]` | the same |
| TAB2 | a nested item after a space and a tab holds a six-space line | `'- a\n \t- b\n\n      x'` | `ul[li[p ul[li[p p]]]]` | the same |
| TAB3 | a tab after a nested marker counts from the line start | `'- a\n  -\tb\n\n\tx'` | `ul[li[p ul[li[p p]]]]` | the same |
| TAB4 | three levels of items written with tabs | `'-\ta\n\t-\tb\n\t\t-\tc'` | `ul[li[p ul[li[p ul[li[p]]]]]]` | the same |
| TAB5 | a tab after a quote marker and a space is not code | `'> \tfoo'` | `quote[p]` | the same |
| TAB6 | two tabs after a quote marker are code | `'>\t\tfoo'` | `quote[code]` | the same |
| TAB7 | a tab after one space indents a code line | `' \tfoo'` | `code` | the same |
| TAB8 | pinned: a heading whose marker a tab follows is a paragraph | `'#\tFoo'` | `p` | `h1` |
| TAB9 | pinned: a tab after a quote marker does not nest an item | `'> - a\n>\t- b'` | `quote[ul[li[p] li[p]]]` | `quote[ul[li[p ul[li[p]]]]]` |
| TAB10 | pinned: a tab after a quote marker does not continue the item above | `'> - a\n>\n>\tb'` | `quote[ul[li[p]] p]` | `quote[ul[li[p p]]]` |
| TAB11 | pinned: a line after a blank quoted line leaves an ordered item | `'>\t1. a\n>\n>\t   b'` | `quote[ol[li[p]] p]` | `quote[ol[li[p p]]]` |

Above TAB8, add the comment: `// The four rows below differ from the viewer. They are @lezer/markdown's own readings (1.7.2 and 1.8.0 alike); a release that changes one turns its row red, and the row then moves up.`

---

## Verification

1. **The suites this plan touches**, from `packages/lib`: `npx vitest run tests/component/markdown tests/component/display/Markdown tests/component/display/markdownLexer tests/component/code-editor.test.ts`. All green.
2. **Lexing stays linear.** The test `one lex scans a number of characters proportional to the document` in `markdownLexer.test.ts` is green. It is the check that `code` and `fences` in the bounded table cost nothing on a document without tabs.
3. **The differential against the base commit.** Run it once, in a scratch folder; commit none of it.
   - Write a temporary test beside `markdown-roundtrip.test.ts` that, for every `CORPUS` case and every document of `tabDocuments(3_000)`, records these booleans: `surfaceSame` (`editorSurfaceModel` equals the viewer's blocks), `verbatim` (`loadAndSave(d).saved === d`), `parity` (the viewer reads `saved` as it reads `d`), `idempotent` (`loadAndSave(saved).saved === saved`), `canonicalParity` and `canonicalIdempotent` (the same two on `canonicalSave`). For each tab document it records `surfaceSame` of its spaces form as well. The base commit does not export `withPrefixTabsAsSpaces`, so the temporary test carries its own copy of `containerPrefixEnd` and `withPrefixTabsAsSpaces`.
   - Run it on the feature branch and on a detached worktree of the base commit, made as [worktree.md](~/.claude/skills/_shared/worktree.md) describes, with `tabDocuments.ts` and the new corpus files copied in. Delete the temporary test and the worktree afterwards.
   - **Hard checks, each must count zero:**

     | Check | A document counts when |
     |---|---|
     | H1: read the same in viewer and editor, and no longer does | `surfaceSame` on the base, not on the branch, and `surfaceSame` of its spaces form on the base |
     | H2: a save that does not reload to the same document | `parity`, `idempotent`, `canonicalParity` or `canonicalIdempotent` holds on the base and not on the branch |
     | H3: an unedited document saved differently | `verbatim` on the base, not on the branch |

   - Measured while planning, on 431 corpus cases, 111 hand-written tab documents and the 2,932 drawn ones: H1 0, H2 0, H3 0. Without H1's last condition 20 drawn documents count; each now reads as its spaces form does on the base, where the editor already keeps that shape as a raw Markdown block.[^h1] Also expect, without it being a check: about 1,690 of those documents with a changed viewer reading, and 63 that viewer and editor now agree on. The planning run's probe and its comparison script are kept for reference as `probes/zz-tab-diff.test.ts` and `diffcmp.mjs` in the scratch folder the first note names.
4. **Project checks**, from the repo root: `npm run typecheck`, `npm -w packages/lib run typecheck:test`, `npm run lint`, `npm run test`, `npm run docs:api`, `npm run docs:llms:check`.

---

## Documentation Impact

No public API changes. `withPrefixTabsAsSpaces` and `hasTabInContainerPrefix` are exported from the module for the tests and the serializer only; neither is added to a barrel.

**`packages/lib/docs/components/Markdown.md`** — add this subsection directly above `### Link resolution`:

> ### Tabs
>
> A tab in a line's indentation counts as CommonMark counts it: it reaches the next multiple of four columns, counted from the start of the line. `→` is one tab and `·` one space in this table.
>
> | Markdown | Reads as |
> | --- | --- |
> | `→code`, `··→code` | a code block holding `code` |
> | `- a`, a blank line, `··→b` | one list item with two paragraphs: the tab runs from column 2 to column 4, two columns past the item's text |
> | `- a`, `·→- b` | a list nested in the item |
> | `-→a`, `→-→b`, `→→-→c` | three nested lists |
> | `>·→foo` | a quote holding the paragraph `foo` |
> | `>→→foo` | a quote holding the code `··foo` |
>
> A tab after the first character of a line's text is kept as a tab: in a paragraph, a code span, a code block and an HTML block, inside a list item as well.
>
> One reading differs from CommonMark. Inside a list item or a blockquote, a tab in the leading run of spaces, tabs, `>` markers and list markers of a code or HTML line is shown as the spaces that reach its tab stop. `··→bb` in a fenced code block of a `- ` item shows as `··bb`, and `··-→old` shows as `-·old`. CommonMark keeps both tabs.

**`packages/lib/docs/components/MarkdownEditor.md`**

- In the paragraph that starts `Markdown the editor would not write itself`, replace `These are a tab on an item's marker line (right after the marker when the item holds further lines, or inside the text), for commands on that item's text;` with `These are a tab right after an item's marker when the item holds further lines, for commands on that item's text; a list in a blockquote whose markers a tab after the `>` indents, for commands on its items;`.
- Directly after that paragraph, add:

  > The editor reads a tab as the viewer does (see [Tabs](/components/Markdown#tabs)). It writes indentation as spaces, so a block that is written again after an edit loses the tabs of its indentation and keeps every tab inside its text, its code spans, its code blocks and its HTML. A block that was not edited is saved byte for byte, tabs included. A tab that starts a code line inside a list item is read as spaces, the viewer's one exception, so the editor shows spaces there and saves them once the list is edited. A raw Markdown block that holds a tab in its indentation keeps that indentation when it is written again.
  >
  > Source mode's syntax highlighting reads two shapes otherwise than the viewer. A heading whose `#` is followed by a tab is coloured as a paragraph. Inside a blockquote, a list line whose `>` is followed by a tab is nested differently: `> - a` over `>→- b` is coloured as two items side by side, where the viewer nests `b` under `a`. The saved text and the viewer are not affected.

  Check the link form against the other cross-page links in the file and match it.

**`packages/lib/docs/reference/changelog/next.md`** — as the last bullet of `## Fixed` → `### Components`, wrapped at 76 columns with a two-space hanging indent like its neighbours:

> - **Tabs in Markdown indentation count as CommonMark counts them.** `Markdown` and `MarkdownEditor` read a tab in a list item's line as four columns wherever it started, and a tab after a `>` from column zero. A line indented by two spaces and a tab under `- a` was a code block, an item nested by a space and a tab put its text one column too far right, and a list written three levels deep with tabs lost its third level. A tab now reaches the next multiple of four columns from the start of its line. A tab inside a list item's text, code span, code block or HTML block is kept; it was shown as spaces, and saved as spaces once the list was edited. A fenced code block indented by one to three spaces no longer drops a line's leading tab. One reading still differs from CommonMark: a tab in the indentation of a code or HTML line inside a list item or blockquote is read as the spaces that reach its tab stop. No consumer action is needed.

`CodeEditor.md` is not changed.

---

## Potential Challenges

- **A changed base.** `markdown-editor-raw-block-edge-cases` edits `markdownSerializer.ts`. If `rawBlockAtMargin` no longer ends with the two statements step 8 quotes, keep the rule and adapt the edit: a candidate other than `source` is accepted only when it moves no line that holds a prefix tab.
- **New corpus cases from the plans that land first.** A case another plan added may hold a tab and change its reading. Step 10 shows it. Decide by `## Architecture Decisions`' rule table and report the case; do not weaken the rule.
- **`E19` `h2` in `SAME`.** The `SAME` loop asserts more than the two texts. All of it was seen to hold with this plan's code on the measured commit. If another assertion fails once the eight plans have landed, stop and report it.
- **The stand-in in a `:::` block, a table or a quote.** Nothing to do: `keptTabTokenizer` turns the stand-in back before any nested rule runs, and rows T26, T27 and LX32 cover the nested code and HTML paths.
- **Line endings.** `marked` turns `\r\n` and `\r` into `\n` before any tokenizer runs, so the helpers split on `\n` alone.
- **Row ids.** The plans that land first may take `E37`, `E38` or `LX30` to `LX37`. If one is taken, use the next free ids and keep this plan's references in step with them.
- **A slow machine.** G1 to G3 load 591 documents several times each, which is why they carry `TIMEOUT_MS`. If one still times out, raise the constant; do not lower `DRAWS`, whose documents are the measured ones.

---

## Critical Files

- [markdownExtensions.ts:331](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L331) — `recordingLexer`, the precedent for a lexer view; `listWithOwnTaskMarker` (370) and `blockquoteWithSourceRaw` (467), the precedents for a tokenizer that runs the one below it and corrects its token; `DIALECT_BLOCK_TOKENIZERS` (534) and `BOUNDED_BLOCK_TOKENIZERS` (566), the two tables the new functions go into; `blockWindow` (223), which bounds what the list and quote tokenizers are handed.
- [markdownSerializer.ts:1784](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1784) — `rawBlockAtMargin`, and `blockShape` below it.
- [markdownImporter.ts:592](packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L592) — `locateTokens`, which finds each top-level block in the source by its `raw`; and `$buildRawBlock` (841), the other caller of `rawBlockAtMargin`.
- [markdown-roundtrip.test.ts:49](packages/lib/tests/component/markdown-roundtrip/markdown-roundtrip.test.ts#L49) — the corpus loop and its `viewer reads the declared links` test; `READ_OUT_OF_ITS_ITEM` (127).
- [corpus/referenceLinks.ts](packages/lib/tests/component/markdown-roundtrip/corpus/referenceLinks.ts) — the precedent for a corpus file per feature, and for rows that declare `links`.
- [markdownLexer.test.ts:612](packages/lib/tests/component/display/markdownLexer.test.ts#L612) — rows LX10 to LX13, the shape LX30 to LX37 follow; `joinedRaws` (558).
- [markdown-editor.test.ts:908](packages/lib/tests/component/markdown-editor.test.ts#L908) — `SAME`, `DIFFERS` (1043) and the two loops that run them.
- [code-editor.test.ts:3248](packages/lib/tests/component/code-editor.test.ts#L3248) — `buildTypingState` and `settle`; rows M34, M36 and M37 (3565–3586).
- `node_modules/marked/lib/marked.esm.js.map` at the repo root — holds the source of `marked` 18.0.9's `Tokenizer.ts`; its `list` method is where each tab becomes four spaces (`nextLine.replace(this.rules.other.tabCharGlobal, '    ')`).

---

## Non-Goals

- **Upgrading `marked`.** The version this plan was measured on is 18.0.9, the one `package-lock.json` installs. `marked` 18.1.0 fails 48 of the 8,128 Markdown tests, most of them on links nested in links. It needs a plan of its own.[^marked-version]
- **What source-mode block commands do with tabs when an item leaves its list.** `markdown-source-mode-list-lift-parity` owns it, with rows `E18`, `E19` `UL` and `E24` to `E27`. That plan should list this one in its `depends-on`.
- **Enter, Backspace and Tab in source mode.** `markdown-language-readonly-and-fences` owns Enter on tab-indented lines (its rows F16 to F18, F32, F34). This plan changes no key.
- **Keeping a code line's prefix tab inside a list item or quote as a tab**, as CommonMark does. It needs the source line of every nested token, which `marked` does not keep.[^pinned-code]
- **Source mode's highlighting.** No block parser is added to the `"markdown"` language.[^lezer]
- **Tabs that are not indentation.** A setext underline followed by a tab (`a⏎-→`) is not an underline in the viewer and is one in CommonMark; a tab before a heading's closing `#` leaves the `#` in the text. Both are `marked`'s reading of trailing whitespace, are the same on both editor surfaces, and are left as they are.
- **Fences written with `~~~`.** `marked` takes no indentation off their content at all, with or without tabs.

---

## Addendum: Measured readings

Everything here was measured on the base commit `75d022ba1` with `marked` 18.0.9, `@lezer/markdown` 1.7.2 and `@codemirror/lang-markdown` 6.5.2. "CommonMark" is `commonmark.js` 0.31.2 run on the same document. The viewer column is `lexMarkdown` read through the round-trip harness; the WYSIWYG import agrees with the viewer on every row, apart from the shapes the editor is already known to keep as raw Markdown blocks.

### Where each reader puts a tab

| # | Document | CommonMark | Viewer and WYSIWYG import | Source-mode language | Cause |
|---|---|---|---|---|---|
| 1 | `-·a⏎⏎··→b` | item: paragraph, paragraph | item: paragraph, code `b` | as CommonMark | `marked`'s list tokenizer writes each tab of a continuation line as four spaces |
| 2 | `-·a⏎··→-·b` | nested list | one paragraph `a - b` | as CommonMark | the same |
| 3 | `-·a⏎·→-·b⏎⏎······x` | `x` is a paragraph of the nested item | `x` is a code block of the outer item | as CommonMark | the same; this is the M36 document |
| 4 | `-→a⏎→-→b⏎→→-→c` | three nested lists | two lists and the code `-····c`; WYSIWYG keeps a raw block | as CommonMark | the same |
| 5 | `-·a⏎··-→b⏎⏎→x` | `x` is a paragraph of the nested item | `x` is a paragraph of the outer item | as CommonMark | the same: the tab after the nested marker becomes four spaces, which puts the nested item's text at column 7 where CommonMark puts it at 4 |
| 6 | `` -·a·`x→y` `` | code span `x→y` | code span `x··y` | not a matter of structure | `marked` 18.0.9 expands every tab of an item's first line |
| 7 | `` -·one⏎⏎··```⏎··a→b⏎··``` `` | code `a→b` | code `a····b` | — | as row 1, for a tab inside the line |
| 8 | `-·<pre>⏎··a→b⏎··</pre>` | HTML holding a tab | HTML holding four spaces | — | the same |
| 9 | `` -·one⏎⏎··```⏎··aa⏎··→bb⏎··``` `` | code `aa⏎→bb` | code `aa⏎····bb` | — | the same, for the line's first tab |
| 10 | `>·→foo` | quote: paragraph | quote: code `foo` | quote: paragraph | `marked`'s blockquote tokenizer takes one space or tab after `>` and lexes the rest from column 0 |
| 11 | `>→→foo` | quote: code `··foo` | quote: code `foo` | quote: code | the same |
| 12 | `>·-·a⏎>→-·b` | nested list | two sibling items | two sibling items | the same in `marked`; `@lezer/markdown` takes a whole tab after `>` |
| 13 | `>·-·a⏎>⏎>→b` | `b` is a paragraph of the item | `b` is a paragraph after the list | as the viewer | the same |
| 14 | `>→1.·a⏎>⏎>→···b` | `b` is a paragraph of the item | as CommonMark | `b` is a paragraph after the list | `@lezer/markdown` alone |
| 15 | `··→foo` | code `foo` | code `→foo` | code | `marked` 18.0.9 takes the spaces off first |
| 16 | `` ·```⏎→x⏎·``` `` | code `···x` | code `x` | code | `marked` takes characters, not columns, off a line under an indented fence |
| 17 | `#→Foo` | heading | heading | paragraph | `@lezer/markdown` wants a space after `#` |

All readers agree with CommonMark on `→foo`, `-→one`, `>→foo`, `-·a⏎→-·b`, and on examples 1, 3, 4, 5, 7, 8, 9 and 11 of the spec's section 2.2. Example 2 is row 15's shape, example 6 is row 11 and example 10 is row 17.

After this plan the viewer and the WYSIWYG import read rows 1 to 8 and 10 to 16 as CommonMark does. Row 9 becomes `aa⏎··bb` and stays pinned. Rows 12, 13, 14 and 17 stay different in source mode's highlighting and are pinned.

### How often

- 111 hand-written tab documents: `marked` 18.0.9 differs from `commonmark.js` in block structure on 12 and in literal text on 19 more; `marked` 18.1.0 on 11 and 7. Three of those documents hold a table or a task item, which CommonMark does not have.
- 2,932 drawn tab documents: the base reads 346 otherwise than their spaces form, and viewer and editor agree differently on 81. With this plan's code both counts are 0.
- 19,537 drawn tab documents: every top-level `raw` joins back into its source, and the bounded lexer equals its unbounded twin, on the base and with this plan's code.

### What the WYSIWYG serializer writes

The standard form holds no tab in indentation: list items and their blocks are written with spaces. On the base it also wrote the content tabs of rows 6 to 8 as spaces, because the tokens held spaces. With this plan it writes those tabs.

### What Enter does in source mode today, for reference

Measured at `tabSize` 2, 4 and 8. This plan changes none of it.

| Caret line | Enter gives | Same at every `tabSize` |
|---|---|---|
| `-·a⏎→-·b▮` | `····-·▮` | yes |
| `-·a⏎·→-·b▮` | `····-·▮` | yes |
| `-→one▮` | an empty line at the margin: no new item | yes |
| `1.→one▮` | `2.▮`, with nothing after the marker | yes |
| `>→foo▮` | `>▮` | yes |
| `-→one⏎⏎→second▮` | `tabSize` spaces | no |
| `→code▮` | `tabSize` spaces | no |

---

## Notes

[^measured]: Measured with temporary tests on commit `75d022ba1`, the tip of the Markdown stack, with `marked` 18.0.9. `## Addendum: Measured readings` holds the full table. The probes, their outputs and the reference readings are kept under `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/tab-column/`.

[^one-rule]: CommonMark's own rule is that tabs "behave as if they were replaced by spaces with a tab stop of 4 characters" where whitespace helps to define block structure. A container prefix is exactly that whitespace, plus the markers between its runs. Writing its tabs as spaces by absolute column therefore changes no reading, and gives `marked` what it can count: one character per column. Two narrower prefixes were measured and rejected. Whitespace alone leaves the tab after a nested marker to `marked`, which counts it from the nested list's start: rows T20 and T21 then read wrongly. Whitespace and `>` alone does the same inside quotes. The cost of including markers is row T31: a code line that starts with a marker character and a tab loses that tab to spaces. On the base commit every tab of such a line already became four spaces. One corner follows from the rule: a line that holds nothing but markers and whitespace ends in spaces once its tabs are written out, so where such a line continues a paragraph inside a list item or quote, two or more columns of trailing whitespace read as a hard line break. Inside list items the base did the same.

[^precedent]: The alternative places were all worse. A pass over the whole document before lexing would shift every offset the editor's source map rests on, and could not tell a list from the content of a top-level fence. Rewriting in the importer would leave the viewer on the old reading, which breaks the rule that both read alike. Replacing `marked`'s list tokenizer with a copy that counts columns is a fork of some 250 lines that every `marked` release would have to be merged into.

[^raw]: `marked` builds an item's `raw` by appending each line it consumes with its line end, and trims the last item and the list at the end. The tab-free copy has the same number of lines as the source and the same line ends, so the n-th line of one is the n-th line of the other. `blockquoteWithSourceRaw` already returns a `raw` that ends at a line end of what it was given. LX31, LX36 and LX37 pin this: on 19,537 drawn tab documents every top-level `raw` joined back into its source.

[^stand-in]: `marked` 18.0.14 stopped expanding content tabs in list items (its release notes: "preserve internal tabs in list item content", #4086), so the stand-in does by hand what a later `marked` does itself. A prototype of these tokenizers on plain `marked` read 106 of 111 hand-written tab documents as `commonmark.js` does, on 18.0.9 and on 18.1.0 alike; the other five are a table and two task items (neither is CommonMark) and rows T30 and T32. U+FDD0 is one of the 66 code points Unicode reserves as noncharacters. The stand-in is put in only outside container prefixes, so no `marked` rule that looks for a marker or counts indentation meets it; a task checkbox's whitespace is in the prefix for that reason, since `marked` wants a space after `[ ]`. A real tab left in place instead would be written as four spaces by 18.0.9.

[^margin]: Found by the differential. With the tokenizers alone, 9 of 2,932 drawn documents had a standard-form save that read otherwise than the source, all of one kind: a quote kept as a raw block, indented by one to three spaces, with a tab on a line that `rawBlockAtMargin` moved (`··>·→` followed by three backticks is an indented code line holding the backticks; with the two spaces gone it opens a fence). Before this plan a tab's width did not depend on its column, so moving such a line was harmless. Two other fixes were tried and measured worse: writing the block's prefix tabs as spaces before dedenting (16 documents, because lines that were not indented in spaces became so), and doing that only for the lines that move (6, and one unedited document saved differently). Refusing the move gave 0, and 31 documents whose standard-form save reads as the source where it did not on the base.

[^pinned-code]: CommonMark keeps a tab whole when the container's indentation ends before it, so `··→bb` in a `- ` item is the code line `→bb`. `marked` cuts an item's indentation off each line as characters and then lexes the rest with no record of which source line it came from, so by the time a fenced block is recognised the tab is already spaces. Keeping it would need each nested token traced back to its source lines, through `marked`'s re-reads of lazy lines; the `markdown-list-toggle-task-item-parity` notes record what a search of that kind cost (reviews 4 and 5: a quadratic search, and blocks found on a later look-alike line). The reading this plan pins is the closest one reachable: the same columns as the source, where the base gave four spaces per tab. The consequence to know: the editor cannot keep a tab at the start of a code line inside a list item. One typed there is saved, and reads back as spaces. That was so before this plan for every tab in such a line.

[^lezer]: `@lezer/markdown`'s `isAtxHeading` accepts only a space after the `#` run, and its blockquote parser takes a whole tab after `>` where CommonMark takes one column of it. Version 1.8.0, the newest, reads all four documents the same way. The heading could be fixed by a block parser of about 25 lines added through `markdown({ extensions })`; one was run and read `#→Foo` as a heading. It is left out because the quote shapes cannot be fixed without replacing `@lezer/markdown`'s blockquote parser, so highlighting would still differ from the viewer, and because `languages.ts` is being changed by `markdown-language-readonly-and-fences`. The trial is `ref/lezer-atx.mjs` in the scratch folder.

[^blocks-field]: Most tab rows pass all six harness checks on the base commit, because those checks compare the editor with the viewer and both were wrong together. Without a declared reading only T14, T35 and T36 would have been seen to fail first.

[^marked-version]: `packages/lib/package.json` declares `marked` as `^18.0.5` and the library build keeps `marked` external, so a consumer's install may resolve 18.1.0, which reads tabs and several other things differently from the 18.0.9 the suite runs on. Upstream changed its tab handling in 18.0.12 (fence indentation, #4074), 18.0.13 (a tab after spaces in indented code, #4080) and 18.0.14 (content tabs in list items, #4086); none of them counts a list item's or a quote's indentation tab from the line start, so rows 1 to 3, 5 and 9 to 13 of the addendum read the same on 18.1.0 (row 4 comes out right there, because its tabs happen to start on tab stops). With `marked` 18.1.0 aliased into the tests, 48 of the 8,128 Markdown tests fail, most of them on links nested in links and two on tabs. What range to declare, and when to upgrade, is a decision outside this plan.

[^tested]: The code of `## Internal Structure` was put in place of the two modules through a temporary Vitest plugin, with no source file edited, and the Markdown suites were run: 8,128 tests, three changed. They are `E19` `h2`, the source-edits test on a tab on an item's marker line, and the named M36 exception, all handled in the steps. The edit fuzz was also run over rows T1 to T42 and passed.

[^s2]: On the base commit the list in `>→-·a` was read with its markers at the quote's content column, and the command wrote `## a` and left `>→- b`. The tab is three columns wide, so CommonMark puts the markers two columns in, and the source-mode commands already decline on a list whose markers are indented (row `E33`). The command that acted on the base now declines on this one shape. `markdown-source-mode-list-lift-parity` is the plan that can make it act again.

[^h1]: Example: `-·⏎··→>·</div>`. The base read the second line as a code block of the item, which the editor shows as one. It is a quote holding an HTML block, as its spaces form `-·⏎····>·</div>` already was on the base, and the editor keeps a quote that holds a block as raw Markdown (the known divergence `quoteBlocks`). All 20 documents were checked: on the base, viewer and editor disagree on the spaces form of each in the same way. Row G2 states the same for every drawn document, and counts 0.
