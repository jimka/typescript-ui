---
depends-on:
  - marked-upgrade
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
  - packages/lib/tests/component/markdown-roundtrip/corpus/enterInCode.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-source-edits.test.ts
  - packages/lib/tests/component/code-editor.test.ts
  - packages/lib/docs/components/Markdown.md
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# Markdown Tab Column Parity — Implementation Plan

## Overview

CommonMark says a tab in a line's indentation reaches the next multiple of four columns, counted from the start of the line. The `Markdown` viewer and the `MarkdownEditor`'s WYSIWYG surface both read Markdown through `marked` 18.1.0, and `marked` does not count that way. Inside a list item it writes a tab that starts a later line of the item as four spaces, wherever the tab starts. After a `>` it starts counting from zero. Under a backtick fence indented by one to three spaces it takes characters, not columns, off each line. So the same document is read one way by the viewer and the WYSIWYG surface, and another way by CommonMark.

This plan makes the viewer and the WYSIWYG surface count such a tab as CommonMark does. The library runs `marked` through an instance of its own with its own tokenizers, which the code calls the *dialect*. The whole fix is in the dialect's tokenizer slots in [markdownExtensions.ts:534](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L534), plus one guard in the serializer's `rawBlockAtMargin` ([markdownSerializer.ts:2020](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2020)). Both readers lex through `lexMarkdown`, so they cannot drift apart.

`→` is one tab, `·` one space and `⏎` a line end throughout. *Base* means the code before this plan: commit `736452bbc` (the tip of the Markdown stack) with the plans `marked-version-pin-or-upgrade` and `marked-upgrade` applied, running `marked` 18.1.0. Every reading and count here was measured on that base. Line numbers are from it too. Four of the differences the plan removes:[^measured]

| Document | CommonMark | Viewer and WYSIWYG on the base |
|---|---|---|
| `-·a⏎⏎··→b` | an item with two paragraphs | an item with a paragraph and a code block |
| `-·a⏎··-→b⏎⏎→x` | `x` is a paragraph of the nested item | `x` is a paragraph of the outer item |
| `>·→foo` | a quote holding a paragraph | a quote holding a code block |
| `` ·```⏎→x⏎·``` `` | the code `···x` | the code `x`: the tab is dropped |

One reading stays different from CommonMark, and is pinned by tests and documented: a tab in the indentation of a code line inside a list item or quote.

---

## Decisions (signed off 2026-10-14)

The repository's owner answered these on 2026-10-14. The plan is written for these answers.

| # | Question | Answer |
|---|---|---|
| a | Every tab in a line's container prefix (spaces, tabs, `>` markers, list markers, a task checkbox after a list marker) reads as the spaces to the next multiple of four. Accept the one rule? | **Accepted.** This revision adds one exception, found when the rule was measured on `marked` 18.1.0 and not part of what the owner saw: whitespace that holds a tab and ends a line after a marker is written as one space.[^line-end] |
| b | A tab in the container prefix of a code or HTML line inside a list item or quote is read as spaces to its stop, where CommonMark keeps the tab (rows T30 to T33). Pin and document it? | **Accepted: pinned and documented.** |
| c | Source mode's syntax highlighting reads two tab shapes its own way: `#` followed by a tab is a paragraph, and a list after `>` and a tab nests otherwise. Pin it? | **Not accepted: it is to be fixed.** The plan `markdown-source-mode-tab-highlighting` fixes it and depends on this one. This plan does not touch the highlighting. |
| d | When does this plan run? | **After `marked-version-pin-or-upgrade` and `marked-upgrade`.** It is measured on 18.1.0 and drops what 18.1.0 already reads correctly.[^order] |

A related decision belongs to `markdown-source-mode-list-lift-parity`, which is revised after this plan. There, source mode rewrites a tab in an item's indentation as spaces when a list toggle or block command lifts the item's block (rows `E18`, `E19` `UL`, `E24` to `E27`). This plan leaves those rows as they are; that plan changes them.

---

## Architecture Decisions

### One rule — a tab in a container prefix is the spaces that reach its tab stop

A line's *container prefix* is its leading run of spaces, tabs, `>` markers and list markers, and a task checkbox when one follows a list marker. Inside a list or a blockquote, every tab in that prefix is read as the spaces that reach the next multiple of four columns, counted from the start of the line. Every other tab is left to `marked`, which keeps it.[^one-rule]

One case is written differently: whitespace that ends the line after a marker. When it holds a tab, it is read as one space. A line of whitespace alone is not such a case; its tabs are counted as the rule says.[^line-end]

| Line | Container prefix | Read as |
|---|---|---|
| `··→b` | `··→` | `····b` (the tab runs from column 2 to 4) |
| `·→-·b` | `·→-·` | `····-·b` |
| `-→-→x` | `-→-→` | `-···-···x` |
| `>·→foo` | `>·→` | `>···foo` |
| `-·[·]→task` | `-·[·]→` | `-·[·]···task` (the tab runs from column 5 to 8) |
| `·→` (whitespace only) | `·→` | `····` |
| `→-→-→` (the line ends after the last tab) | `→-→-` | `····-···-·`: the whitespace that ends the line is one space |
| `` -·a·`x→y` `` | `-·` | unchanged: the tab is content |
| `··a→b` | `··` | unchanged: the tab is content |

### The fix lives in the dialect's tokenizer slots

Three functions are added to [markdownExtensions.ts](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts) and installed in `marked`'s `list`, `blockquote` and `fences` slots. Each runs the tokenizer that is in the slot today and corrects one thing, which is how `listWithOwnTaskMarker` ([markdownExtensions.ts:370](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L370)), `blockquoteWithSourceRaw` ([:467](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L467)) and `htmlWithInputEndAsLineEnd` ([:502](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L502)) already work.[^precedent] Nothing is added to `markdownImporter.ts`, `languages.ts` or `CodeEditor.ts`.

| Slot | New function | Wraps | Corrects |
|---|---|---|---|
| `list` | `listWithTabStops` | `listWithOwnTaskMarker` | tabs in container prefixes |
| `blockquote` | `blockquoteWithTabStops` | `blockquoteWithSourceRaw` | tabs in container prefixes |
| `fences` | `fencesWithColumnIndent` | `Tokenizer.prototype.fences` | an indented backtick fence takes columns, not characters, off its lines |

No tokenizer goes into the `code` slot, and no tab inside a list item's content is protected: `marked` 18.1.0 already reads both as CommonMark does.[^redundant]

### A token's `raw` stays the source

`listWithTabStops` and `blockquoteWithTabStops` hand `marked` a changed copy of the source. Afterwards they set the token's `raw`, and each list item's `raw`, back to the source lines the token spans. `marked` builds these `raw` values from whole lines, so counting lines finds the source.[^raw] The lexer advances by `raw.length`, and the editor's import finds each top-level block in the source by its `raw` ([markdownImporter.ts:592](packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L592)). With `raw` unchanged, a block that was not edited is still saved byte for byte.

No pass over the whole document rewrites tabs. The copy with spaces exists only inside one tokenizer call.

### A raw block that holds a prefix tab is not moved

`rawBlockAtMargin` ([markdownSerializer.ts:2020](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2020)) takes up to three spaces of indentation off a raw Markdown block. It now refuses a dedented form that moves a line holding a tab in its container prefix, because that tab would reach its stop from another column and the line would read differently.[^margin]

### A code line's prefix tab inside a container is read as spaces — pinned, not fixed

Inside a list item or a blockquote, a tab in the container prefix of a code or HTML line is read as spaces to its tab stop, where CommonMark keeps it as a tab. `··→bb` in a fenced block of a `- ` item is the code line `··bb`. `··-→old` in such a block is `-·old`. Corpus rows T30 to T33 pin this reading and the docs state it. The owner accepted it (decision b).[^pinned-code]

### Corpus rows declare what the viewer reads

`CorpusCase` gains an optional `blocks` field: the outline of the blocks the viewer must read for the document. It follows the existing `links` field ([types.ts:18](packages/lib/tests/component/markdown-roundtrip/corpus/types.ts#L18)), which a `viewer reads the declared links` test checks.[^blocks-field] Every tab row carries `blocks`, so a row fails on the base when the reading is wrong, not only when viewer and editor disagree.

### What happens to the rows earlier plans named

| Row | Where | After this plan |
|---|---|---|
| The named exception `Enter on a marker line indented by a space and a tab (M36)` | `READ_OUT_OF_ITS_ITEM` in `markdown-roundtrip.test.ts` | removed with its constant: the viewer now reads the document in one item |
| The named exception `Enter after a fence opened on an item marker line with a tab after the marker` | `READ_WITH_OTHER_CODE_TEXT` in `markdown-roundtrip.test.ts` | removed with its constant: the viewer now reads the code as the row's `reads` gives it |
| M34, M36, M37 | `code-editor.test.ts` | unchanged: they test Enter, which reads the syntax tree |
| The docs bullet on `tabSize` and Markdown's four columns | `CodeEditor.md` | unchanged |
| `E19` `h2` (`-·one→tab`) | `SAME` in `markdown-editor.test.ts` | unchanged: `marked-upgrade` moved it there |
| `E19` `UL`, `E24` (two), `E25`, `E26`, `E27` | `DIFFERS` | unchanged by this plan; `markdown-source-mode-list-lift-parity` changes them (source mode rewrites the tab as spaces) |
| `E18` | not in the tree yet: `markdown-source-mode-list-lift-parity` adds it | that plan's; with this plan the WYSIWYG surface reads its line `··→bb` as `··bb` (row T30) |
| `declines when a tab on an item's marker line stands where the command has to read` | `markdown-source-edits.test.ts` | unchanged; its two declines are `markdown-source-mode-list-lift-parity`'s to change |

---

## Internal Structure

The first block below goes into [markdownExtensions.ts](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts), directly above the doc comment that starts `The four block tokenizers the dialect owns`. The code was run as written against the whole library suite.[^tested]

```ts
/**
 * The width of Markdown's tab stops, in columns: a tab advances to the next
 * multiple of four (CommonMark §2.2), whatever width an editor shows it with.
 * `editor/languages.ts` holds the same number for source mode's Enter rule.
 */
const MARKDOWN_TAB_STOP = 4;

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
 * marker. Whitespace that ends the line is not part of it. `> - [ ] x` ends
 * before `x`; `- a - b` ends before `a`; `>`, a tab, `-`, a tab ends before
 * the last tab.
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
        const endsLine = end + step.length === line.length;

        if (isCheckbox && !afterListMarker) {
            return end;
        }

        if (isWhitespace && endsLine && end > 0) {
            return end;
        }

        if (!isWhitespace) {
            afterListMarker = first !== ">" && !isCheckbox;
        }

        end += step.length;
    }
}

/** Whitespace that holds a tab and runs to the end of a line. */
const TABBED_LINE_END = /^[ \t]*\t[ \t]*$/;

/**
 * Writes every tab of a line's container prefix as the spaces that reach its
 * tab stop, counted from the line's start. The line then reads the same with
 * one character per column in its prefix, which is what `marked` counts.
 * Whitespace that ends the line after a marker and holds a tab is written as
 * one space: its width means nothing there, and two or more spaces would end
 * a paragraph line in a hard line break.
 *
 * @internal Shared with the round-trip tests, not part of the public API surface.
 *
 * @param line - One line, without its line end.
 * @returns The line with a tab-free container prefix.
 */
export function withPrefixTabsAsSpaces(line: string): string {
    const end = containerPrefixEnd(line);
    const rest = line.slice(end);
    const endsInTab = end > 0 && TABBED_LINE_END.test(rest);
    let prefix = "";

    for (const char of line.slice(0, end)) {
        prefix += char === "\t" ? " ".repeat(MARKDOWN_TAB_STOP - (prefix.length % MARKDOWN_TAB_STOP)) : char;
    }

    return prefix + (endsInTab ? " " : rest);
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
 * Sets a list token's `raw`, and each item's, back to the source lines they
 * span. `marked` builds both from whole lines, and the tab-free form of the
 * source has the same lines, so counting lines finds the source.
 *
 * @param list - The list token, lexed from the tab-free form of `src`.
 * @param src - The source the list was read from.
 */
function restoreListSource(list: Tokens.List, src: string): void {
    const lines = src.split("\n");
    let line = 0;

    for (const item of list.items) {
        const count = lineCount(item.raw);
        const closed = item.raw.endsWith("\n");
        const source = lines.slice(line, line + count).join("\n");

        item.raw = closed ? source + "\n" : source.trimEnd();
        line += count;
    }

    list.raw = leadingLines(src, lineCount(list.raw)).trimEnd();
}

/**
 * Runs the dialect's list tokenizer on a form of the source in which a tab
 * counts as CommonMark counts it. `marked` writes each tab that starts a
 * continuation line of an item as four spaces, wherever the tab starts, and
 * so reads `- a` / (blank) / two spaces, a tab, `b` as code where CommonMark
 * reads a paragraph. Here each tab of a line's container prefix is written as
 * the spaces that reach its tab stop; every other tab is left to `marked`,
 * which keeps it. The token's `raw` and each item's are set back to the
 * source, which the lexer and the editor's import measure with.
 *
 * @param src - The remaining source at the current block position.
 * @returns The list token, or `undefined` when no list starts here.
 */
function listWithTabStops(this: Tokenizer, src: string): Tokens.List | undefined {
    const hasTab = src.includes("\t");

    if (!hasTab) {
        return listWithOwnTaskMarker.call(this, src);
    }

    const list = listWithOwnTaskMarker.call(this, mapLines(src, withPrefixTabsAsSpaces));

    if (list === undefined) {
        return undefined;
    }

    restoreListSource(list, src);

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

The serializer's guard, in [markdownSerializer.ts](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts). In `rawBlockAtMargin`, the statement

```ts
    const atMargin = candidates.find((candidate) => candidate === source || readingInBlockList(candidate, keepsContent) === reading) ?? source;
```

becomes

```ts
    const lines = source.split("\n");
    const keepsReading = (candidate: string): boolean => {
        if (candidate === source) {
            return true;
        }

        const movesATab = movesLineWithPrefixTab(lines, candidate);

        return !movesATab && readingInBlockList(candidate, keepsContent) === reading;
    };
    const atMargin = candidates.find(keepsReading) ?? source;
```

and this function goes directly after `rawBlockAtMargin`, above the doc comment that starts `The forms {@link rawBlockAtMargin} tries`:

```ts
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

The base moves under this plan: the plans of `depends-on` land first. Find every edit by the quoted text or the symbol name, not by line number. Run commands from `packages/lib`. Never run `npm install`, `npm ci` or `npm update`.

0. **Check the `marked` version.** `npx vitest run tests/unit/marked-version.test.ts` passes, and `node -p "require('marked/package.json').version"` prints `18.1.0`. If either does not hold, stop and report: every expectation below was measured on 18.1.0.

Steps 1 to 4 add tests only. Step 4 lists what must be red before step 5 starts.

1. **Add the test helpers.**
   - Create `tests/component/markdown-roundtrip/tabDocuments.ts` from `## Internal Structure`.
   - Append `outlineText`, `outlineRuns` and `blockOutline` from `## Internal Structure` to `tests/component/markdown-roundtrip/viewModel.ts`.
   - In `tests/component/markdown-roundtrip/corpus/types.ts`, add this field to `CorpusCase`, between `links` and `known`: `readonly blocks?: string;                                         // the outline the viewer must read (blockOutline)`.
   - In `tests/component/markdown-roundtrip/markdown-roundtrip.test.ts`, add `blockOutline` to the names imported from `./viewModel`. In the `for (const testCase of CORPUS)` loop, directly after the `if (links !== undefined) { … }` block, add:

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
   - In `corpus/index.ts`, import `TAB_CASES` from `./tabs` and append `...TAB_CASES` to `CORPUS`.

3. **Add the lexer rows, the generated-document test and the source-mode language rows.**
   - In `tests/component/display/markdownLexer.test.ts`, import `tabDocuments` from `'../markdown-roundtrip/tabDocuments'`, and add `describe('a tab counts to its tab stop, and a content tab is kept', …)` directly after the `describe` named `a blockquote's raw is the source it used`, holding rows LX30 to LX36 of `## Expected Behaviour`.
   - In `markdown-roundtrip.test.ts`, import `tabDocuments` from `./tabDocuments`, and add `describe('generated tab documents', …)` directly before `describe('corpus integrity', …)`, holding the two constants and row G3 of `## Expected Behaviour`. Rows G1 and G2 need a function that step 5 adds, and go in then.
   - In `tests/component/code-editor.test.ts`, inside `describe('built-in markdown language typing', …)`, directly after the `for` loop that holds the M36 and M37 tests, add the helper and rows TAB1 to TAB7 of `## Expected Behaviour`.

4. **Add the parity and source-command rows, and confirm what is red.**
   - In `tests/component/markdown-editor.test.ts`, add row E37 of `## Expected Behaviour`, with its comment, as the last row of `SAME`, directly after the `E19` `h2` row. Add row E38, with its comment, to `DIFFERS`, directly after the row `['E19', '-\tone\n\n\tsecond\n- two', 'one', null, 'UL', …]`.
   - In `tests/component/markdown-source-edits.test.ts`, add test S2 of `## Expected Behaviour`, with its comment, directly after the test `declines when a tab on an item's marker line stands where the command has to read`.
   - Run `npx vitest run tests/component/markdown-roundtrip tests/component/display/markdownLexer.test.ts tests/component/markdown-editor.test.ts tests/component/markdown-source-edits.test.ts tests/component/code-editor.test.ts`. Exactly 23 tests are red: the `viewer reads the declared blocks` test of CommonMark 6, T5, T6, T15 to T20, T30 to T33 and T35 to T39; the `surface` test of T35 and T36; LX34, LX35; S2. Every other new row is green: it pins a reading that holds already. If the count differs, stop and report.

5. **Add the helpers and the fence tokenizer.** In `markdownExtensions.ts`:
   - Paste the whole extension block of `## Internal Structure` above the doc comment that starts `The four block tokenizers the dialect owns`.
   - In `DIALECT_BLOCK_TOKENIZERS`, add `fences:     fencesWithColumnIndent,` after the `html` entry. Leave `blockquote` and `list` as they are for now.
   - In `BOUNDED_BLOCK_TOKENIZERS`, add `fences: fencesWithColumnIndent,` after the `html(src) { … },` entry.
   - Check: T5, T6 and LX34 are green. `npm run typecheck` reports `listWithTabStops` and `blockquoteWithTabStops` as declared but never read; steps 6 and 7 install them. Do not run the typecheck as a gate before step 7.
   - In `markdown-roundtrip.test.ts`, import `withPrefixTabsAsSpaces` from `~/component/display/markdownExtensions`, and add `spacesForm`, `shape`, `agrees` and rows G1 and G2 of `## Expected Behaviour` to `describe('generated tab documents', …)`, above G3. Both are red now. They are green after step 7.

6. **Install the list tokenizer.**
   - In `DIALECT_BLOCK_TOKENIZERS`, change `list:       listWithOwnTaskMarker,` to `list:       listWithTabStops,`.
   - In `BOUNDED_BLOCK_TOKENIZERS`, change `listWithOwnTaskMarker.call(this, blockWindow(src))` to `listWithTabStops.call(this, blockWindow(src))`.
   - Check: T15 to T20, T30 and T31 are green. Two tests turn red, each with a message that asks for its entry to be removed: `Enter on a marker line indented by a space and a tab (M36)` in `describe('what Enter leaves inside HTML stays in its blockquote or list item', …)`, and `Enter after a fence opened on an item marker line with a tab after the marker` in `describe('what Enter leaves in a code block stays in the block and in its blockquote or list item', …)`.
   - In `markdown-roundtrip.test.ts`, delete the constant `READ_OUT_OF_ITS_ITEM` with its doc comment, delete the line `const known      = READ_OUT_OF_ITS_ITEM[name];`, and replace the `if (known === undefined) { … } else { … }` statement after it with `expect([...containers]).toHaveLength(1);`.
   - In the same file, delete the constant `READ_WITH_OTHER_CODE_TEXT` with its doc comment, delete the line `const known  = READ_WITH_OTHER_CODE_TEXT[name];`, and replace the `if (known === undefined) { … } else { … }` statement after it with `expect(read).toEqual(testCase.reads);`.
   - In `corpus/enterInsideHtml.ts` (the doc comment of `ENTER_INSIDE_HTML_CASES`) and in `corpus/enterInCode.ts` (the doc comment of `ENTER_IN_CODE_CASES`), the last line of the comment holds the words `, and names the one document it does not hold for`. Delete those words in both files, and nothing else.
   - Check: both tests are green again.

7. **Install the blockquote tokenizer.**
   - In `DIALECT_BLOCK_TOKENIZERS`, change `blockquote: blockquoteWithSourceRaw,` to `blockquote: blockquoteWithTabStops,`.
   - In `BOUNDED_BLOCK_TOKENIZERS`, change `blockquoteWithSourceRaw.call(this, blockWindow(src))` to `blockquoteWithTabStops.call(this, blockWindow(src))`.
   - Check: CommonMark 6, T32, T33 and T35 to T39 are green; LX35; S2; G1 and G2. Two T41 tests are now red: its `canonical` test, and its test in `markdown-edit-fuzz.test.ts` (`T41: … : edits`). That is expected: step 8 fixes both.

8. **Add the serializer's guard.** In `markdownSerializer.ts`:
   - Add `hasTabInContainerPrefix` to the names imported from `~/component/display/markdownExtensions.js`, in alphabetical order (it goes first).
   - Make the `rawBlockAtMargin` edit and add `movesLineWithPrefixTab` as `## Internal Structure` shows. In the doc comment of `rawBlockAtMargin`, add this paragraph directly before the `@param source` line: `A dedented form that moves a line holding a tab in its container prefix is not kept either: the tab would reach its tab stop from another column.`
   - Check: both T41 tests are green.

9. **Update the two doc comments that count slots.** In `markdownExtensions.ts`, rewrap each changed comment to the width of its neighbours:
   - The comment above `DIALECT_BLOCK_TOKENIZERS`: `The four block tokenizers the dialect owns` becomes `The five block tokenizers the dialect owns`; `` `blockquote`, `list`, `table` and `html` slots `` becomes `` `blockquote`, `list`, `table`, `html` and `fences` slots ``; `calls the same four behind its guards` becomes `calls the same five, four of them behind its guards`.
   - The comment above `BOUNDED_BLOCK_TOKENIZERS`: `The six block slots` becomes `The seven block slots`. The sentence `` `blockquote` and `list` call the dialect's source-`raw` and task-marker wrappers on the window instead of the originals. `` becomes `` `blockquote` and `list` call the dialect's tab-stop wrappers on the window instead of the originals. ``. After the sentence that ends `closing marker no restart line bounds.`, add: `` `fences` carries no guard and no window: it calls `marked`'s own tokenizer on the same source it would have been given, and then reads only the token it returned. ``
   - Check: `grep -n "listWithOwnTaskMarker\|blockquoteWithSourceRaw" src/typescript/lib/component/display/markdownExtensions.ts` shows six lines: each name's own definition, and two calls of each inside `listWithTabStops` or `blockquoteWithTabStops`. Neither name stands in a tokenizer table. `npm run typecheck` passes.

10. **Run the touched suites.** `npx vitest run tests/component/markdown tests/component/display/Markdown tests/component/display/markdownLexer tests/component/code-editor.test.ts`. Everything is green. If a test outside this plan's files fails, stop and report it: on the measured base the change was run against the whole library suite and changed no test outside them.[^tested]

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
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/enterInCode.ts` |
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

Paste as written. "Base reads" is what `blockOutline` gives on the base; a row that says "the same" pins a reading that is already right.

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
| CommonMark 6 | `quote[code"foo"]` |
| CommonMark 2, 3, 4, 5, 7, 8, 9, 11 | the same |

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
    { name: 'T42: whitespace that holds a tab and ends a line after a marker is one space', source: '> a\n\t-\t-\t\nb\n', blocks: 'quote[p"a - - b"]' },
```

| Row | Document | Base reads |
|---|---|---|
| T5 | `` ·```⏎→x⏎·```⏎ `` | `code"x"`: the tab is dropped |
| T6 | `` ···```⏎··→x⏎···```⏎ `` | `code"x"` |
| T15 | `-·a⏎⏎··→b⏎` | `ul![li[p"a" code"b"]]` |
| T16 | `-·a⏎⏎···→b⏎` | `ul![li[p"a" code" b"]]` |
| T17 | `-·a⏎⏎··→→code⏎` | `ul![li[p"a" code"    code"]]` |
| T18 | `-·a⏎··→-·b⏎` | `ul[li[p"a - b"]]` |
| T19 | `-·a⏎·→-·b⏎⏎······x⏎-·z⏎` | `ul![li[p"a" ul[li[p"b"]] code"x"] li[p"z"]]` |
| T20 | `-·a⏎··-→b⏎⏎→x⏎` | `ul![li[p"a" ul[li[p"b"]] p"x"]]` |
| T30 | `` -·one⏎⏎··```⏎··aa⏎··→bb⏎··```⏎⏎-·two⏎ `` | `ul![li[p"one" code"aa⏎    bb"] li[p"two"]]` |
| T31 | `` -·a⏎⏎··```⏎··-→old⏎··+→new⏎··```⏎ `` | `ul![li[p"a" code"-→old⏎+→new"]]`, which is CommonMark's reading |
| T32 | `>→→→foo⏎` | `quote[code"→foo"]` |
| T33 | `` >·```⏎>·→x⏎>·```⏎ `` | `quote[code"→x"]`, which is CommonMark's reading |
| T35 | `>·→foo⏎` | `quote[code"foo"]`, and `surface` fails |
| T36 | `>··→foo⏎` | `quote[code"foo"]`, and `surface` fails |
| T37 | `>·-·a⏎>→-·b⏎` | `quote[ul[li[p"a"] li[p"b"]]]` |
| T38 | `>·-·a⏎>⏎>→b⏎` | `quote[ul[li[p"a"]] p"b"]` |
| T39 | `>→····code⏎` | `quote[code"code"]` |
| T1 to T4, T7 to T14, T21 to T29, T34, T40, T41, T42 | | the same |

Notes on rows that are green on the base:

- T1 to T4, T14, T21 and T25 to T27 hold shapes `marked` 18.1.0 reads correctly by itself. They pin that the new list and quote tokenizers keep those readings.
- T22 to T24 hold a content tab in running text. An outline cannot show it, because the viewer collapses whitespace there. LX30, `E19` `h2` and E37 pin those tabs.
- T41 is green on the base and after step 8. Between steps 7 and 8 its `canonical` test and its edit-fuzz test are red, which is what shows the serializer's guard at work.
- T42 pins the one case the rule writes differently. With the tab that ends the line written as the spaces to its stop, the line `→-→-→` would end in three spaces, and the viewer would read a hard line break: `quote[p"a - -⏎b"]`.

### Lexer rows, `markdownLexer.test.ts`

Paste as written. `joinedRaws`, `lexMarkdownUnbounded` and the `Tokens` type are already in the file's scope.

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
```

| Row | On the base |
|---|---|
| LX34 | red: `text` is `x`, the tab dropped |
| LX35 | red: the quote's list holds two items |
| LX30, LX31, LX32, LX33, LX36 | green: they guard what the new tokenizers must not break |

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
     * Writes the outline of what the viewer reads, without the text of code and raw blocks, where a tab may stand.
     *
     * @param document - A document.
     * @returns The outline.
     */
    function shape(document: string): string {
        return blockOutline(viewerModel(document).blocks).replace(/(code|raw)"[^"]*"/g, '$1');
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

| Row | On the base: of 591 documents (of 2,932) | With this plan's code |
|---|---|---|
| G1 | 70 (364) differ in block structure alone | 0 (0) |
| G2 | 22 (94) | 0 (0) |
| G3 | 0 (0) | 0 (0) |

### Parity rows, `markdown-editor.test.ts`

```ts
        // A tab in a code span is content too.
        ['E37', '- a `x\ty`\n- z', 'a', null, 'h2', '## a `x\ty`\n\n- z', '## a `x\ty`\n- z'],
```

```ts
        // The code block leaves the list on the WYSIWYG surface alone, as in the E24 rows; its tab is kept on both.
        ['E38', '- one\n\n  ```\n  a\tb\n  ```\n\n- two', 'one', null, 'UL', 'one\n\n```\na\tb\n```\n\n- two', 'one\n\n- ```\n  a\tb\n  ```\n\n- two'],
```

Both are green on the base. They guard that `listWithTabStops` leaves a tab inside an item's content to `marked`, which keeps it.

### Source-mode line commands, `markdown-source-edits.test.ts`

```ts
    // The tab after `>` is three columns wide here, so the list's markers stand indented by two inside the quote,
    // and a command on an indented list declines (row E33).
    it('S2. declines on an item of a list in a quote whose markers a tab after the quote marker indents', () => {
        expect(blockPrefixSource('## ')('>\t- a\n>\t- b', 4, 4)).toBeNull();
        expect(listSource('unordered')('>\t- a\n>\t- b', 4, 4)).toBeNull();
    });
```

On the base S2 fails: the heading command returns an edit.[^s2]

### The source-mode language's block tree, `code-editor.test.ts`

These rows show that source mode's syntax tree already reads seven tab shapes as the viewer reads them after this plan. All seven are green on the base and after. The helper and the rows; `buildTypingState` and `settle` are the `describe`'s own, and `syntaxTree` is already imported.

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

Each row is `it('<id>: <title>', async () => { expect(await languageOutline(<doc>)).toBe(<outline>); });`, written over three lines as the neighbouring tests are. A document must not hold `|`, which `buildTypingState` reads as the caret; none below does.

| Row | Title | Document | Outline |
|---|---|---|---|
| TAB1 | a tab after two spaces continues an item as a paragraph | `'- a\n\n  \tb'` | `ul[li[p p]]` |
| TAB2 | a nested item after a space and a tab holds a six-space line | `'- a\n \t- b\n\n      x'` | `ul[li[p ul[li[p p]]]]` |
| TAB3 | a tab after a nested marker counts from the line start | `'- a\n  -\tb\n\n\tx'` | `ul[li[p ul[li[p p]]]]` |
| TAB4 | three levels of items written with tabs | `'-\ta\n\t-\tb\n\t\t-\tc'` | `ul[li[p ul[li[p ul[li[p]]]]]]` |
| TAB5 | a tab after a quote marker and a space is not code | `'> \tfoo'` | `quote[p]` |
| TAB6 | two tabs after a quote marker are code | `'>\t\tfoo'` | `quote[code]` |
| TAB7 | a tab after one space indents a code line | `' \tfoo'` | `code` |

---

## Verification

1. **The suites this plan touches**, from `packages/lib`: `npx vitest run tests/component/markdown tests/component/display/Markdown tests/component/display/markdownLexer tests/component/code-editor.test.ts`. All green.
2. **Lexing stays linear.** The test `one lex scans a number of characters proportional to the document` in `markdownLexer.test.ts` is green. It is the check that `fences` in the bounded table costs nothing on a document without tabs.
3. **The differential against the base.** Run it once, in a scratch folder; commit none of it.
   - Write a temporary test beside `markdown-roundtrip.test.ts` that, for every `CORPUS` case and every document of `tabDocuments(3_000)`, records these booleans: `surfaceSame` (`editorSurfaceModel` equals the viewer's blocks), `verbatim` (`loadAndSave(d).saved === d`), `parity` (the viewer reads `saved` as it reads `d`), `idempotent` (`loadAndSave(saved).saved === saved`), `canonicalParity` and `canonicalIdempotent` (the same two on `canonicalSave`). For each tab document it records `surfaceSame` of its spaces form as well. The base does not export `withPrefixTabsAsSpaces`, so the temporary test carries its own copy of `containerPrefixEnd` and `withPrefixTabsAsSpaces`.
   - Run it on the feature branch and on a detached worktree of the branch's parent, made as [worktree.md](~/.claude/skills/_shared/worktree.md) describes, with `tabDocuments.ts`, `viewModel.ts` and the new corpus files copied in. Match the records by case name. Delete the temporary test and the worktree afterwards.
   - **Hard checks, each must count zero:**

     | Check | A document counts when |
     |---|---|
     | H1: read the same in viewer and editor, and no longer does | `surfaceSame` on the base, not on the branch, and `surfaceSame` of its spaces form on the base |
     | H2: a save that does not reload to the same document | `parity`, `idempotent`, `canonicalParity` or `canonicalIdempotent` holds on the base and not on the branch |
     | H3: an unedited document saved differently | `verbatim` on the base, not on the branch |

   - Measured while planning, on 549 corpus cases (the base's 498 and this plan's 51), 111 hand-written tab documents and the 2,932 drawn ones: H1 0, H2 0, H3 0. Without H1's last condition 16 drawn documents count; each now reads as its spaces form does on the base, where the editor already keeps that shape as a raw Markdown block.[^h1] Also expect, without it being a check: about 597 documents with a changed viewer reading, and 82 that viewer and editor now agree on. The planning run's probe and its comparison script are kept for reference as `probes/zz-tab-diff.test.ts` and `probes/diffcmp.mjs` in the scratch folder the first note names.
4. **Project checks**, from the repo root: `npm run typecheck`, `npm -w packages/lib run typecheck:test`, `npm run lint`, `npm run test`, `npm run docs:api`, `npm run docs:llms:check`. `npm run test` runs 479 more tests than the branch's parent.[^counts]

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

**`packages/lib/docs/reference/changelog/next.md`** — as the last bullet of `## Fixed` → `### Components`, wrapped at 76 columns with a two-space hanging indent like its neighbours:

> - **Tabs in Markdown indentation count as CommonMark counts them.** `Markdown` and `MarkdownEditor` read a tab that starts a later line of a list item as four columns wherever it started, read the rest of a line after `>` and a tab from column zero, and took characters, not columns, off the lines under a fenced code block indented by one to three spaces. A line indented by two spaces and a tab under `- a` was a code block, an item nested by a space and a tab put its text one column too far right, `>`, a space and a tab made the rest of the line code, and a fence indented by one space dropped a line's leading tab. A tab now reaches the next multiple of four columns from the start of its line. One reading still differs from CommonMark: inside a list item or blockquote, a tab in the indentation of a code or HTML line, or right after a marker character that starts such a line, is read as the spaces that reach its tab stop. No consumer action is needed.

`CodeEditor.md` is not changed.

---

## Potential Challenges

- **A changed base.** `rawBlockAtMargin` was rewritten by `markdown-editor-raw-block-edge-cases` and may change again in a plan of `depends-on`. If it no longer holds the statement `const atMargin = candidates.find(…)` that step 8 quotes, keep the rule and adapt the edit: a candidate other than `source` is accepted only when it moves no line that holds a prefix tab, and its reading is checked as the function checks it.
- **New corpus cases from the plans that land first.** A case another plan added may hold a tab and change its reading. Step 10 shows it. Decide by `## Architecture Decisions`' rule table and report the case; do not weaken the rule.
- **A `marked` other than 18.1.0.** Step 0 stops the work. 18.1.0 reads tabs inside a list item's content and the tab of an indented code line correctly by itself; on an older `marked` rows T1 to T4, T25 to T27, LX30, LX32, LX33, E37 and E38 fail.
- **Line endings.** `marked` turns `\r\n` and `\r` into `\n` before any tokenizer runs, so the helpers split on `\n` alone.
- **Row ids.** The plans that land first may take `E37`, `E38`, `S2`, `LX30` to `LX36` or `TAB1` to `TAB7`. If one is taken, use the next free ids and keep this plan's references in step with them. `markdown-source-mode-list-lift-parity` names `E38` by its document; keep the document as written.
- **A slow machine.** G1 to G3 load 591 documents several times each, which is why they carry `TIMEOUT_MS`. If one still times out, raise the constant; do not lower `DRAWS`, whose documents are the measured ones.

---

## Critical Files

- [markdownExtensions.ts:370](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L370) — `listWithOwnTaskMarker` and `blockquoteWithSourceRaw` (467), the tokenizers the new ones wrap, and with `htmlWithInputEndAsLineEnd` (502) the precedent for a tokenizer that runs the one below it and corrects its token; `DIALECT_BLOCK_TOKENIZERS` (534) and `BOUNDED_BLOCK_TOKENIZERS` (566), the two tables the new functions go into; `blockWindow` (223), which bounds what the list and quote tokenizers are handed.
- [markdownSerializer.ts:2020](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2020) — `rawBlockAtMargin`, and `readingInBlockList` (2090), which its candidates are checked with.
- [markdownImporter.ts:592](packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L592) — `locateTokens`, which finds each top-level block in the source by its `raw`; and `$buildRawBlock` (841), a caller of `rawBlockAtMargin`.
- [markdown-roundtrip.test.ts:51](packages/lib/tests/component/markdown-roundtrip/markdown-roundtrip.test.ts#L51) — the corpus loop and its `viewer reads the declared links` test; `READ_OUT_OF_ITS_ITEM` (135) and `READ_WITH_OTHER_CODE_TEXT` (172).
- [corpus/referenceLinks.ts](packages/lib/tests/component/markdown-roundtrip/corpus/referenceLinks.ts) — the precedent for a corpus file per feature, and for rows that declare `links`.
- [markdownLexer.test.ts:613](packages/lib/tests/component/display/markdownLexer.test.ts#L613) — rows LX10 to LX13, the shape LX30 to LX36 follow; `joinedRaws` (558).
- [markdown-editor.test.ts:1113](packages/lib/tests/component/markdown-editor.test.ts#L1113) — `SAME`, `DIFFERS` (1250) and the two loops that run them.
- [code-editor.test.ts:3411](packages/lib/tests/component/code-editor.test.ts#L3411) — `buildTypingState` and `settle` (3431); rows M34 to M37 (3728–3751).
- `node_modules/marked/lib/marked.esm.js.map` at the repo root — holds the source of `marked` 18.1.0's `Tokenizer.ts`. Its `list` method writes each tab of a later line's leading whitespace as four spaces (`nextLine.replace(this.rules.other.leadingSpaceTab, …)`), and `indentCodeCompensation` takes characters off the lines under an indented fence.

---

## Non-Goals

- **Source mode's syntax highlighting.** The plan `markdown-source-mode-tab-highlighting` fixes the two shapes source mode highlights otherwise than the viewer, and depends on this plan (decision c). `languages.ts` is not changed here.
- **What source-mode block commands do with tabs when an item leaves its list.** `markdown-source-mode-list-lift-parity` owns it, with rows `E18`, `E19` `UL` and `E24` to `E27`: source mode rewrites the tab in the item's indentation as spaces. That plan lists this one in its `depends-on`.
- **Enter, Backspace and Tab in source mode.** This plan changes no key.
- **Keeping a code line's prefix tab inside a list item or quote as a tab**, as CommonMark does. It needs the source line of every nested token, which `marked` does not keep (decision b).[^pinned-code]
- **A setext underline followed by a tab.** `a⏎-→` is a paragraph in the viewer and a heading in CommonMark. That is `marked`'s reading of trailing whitespace, the same on both editor surfaces, and is left as it is.
- **Fences written with `~~~`.** `marked` takes no indentation off their content at all, with or without tabs.

---

## Addendum: Measured readings

Everything here was measured on the base: commit `736452bbc` with the edits of `marked-version-pin-or-upgrade` and `marked-upgrade`, and `marked` 18.1.0. "CommonMark" is `commonmark.js` 0.31.2 run on the same document. The viewer column is `lexMarkdown` read through the round-trip harness; the WYSIWYG import agrees with the viewer on every row, apart from the shapes the editor is already known to keep as raw Markdown blocks.

### Where the viewer puts a tab

| # | Document | CommonMark | Viewer on the base | Cause | With this plan |
|---|---|---|---|---|---|
| 1 | `-·a⏎⏎··→b` | item: paragraph, paragraph | item: paragraph, code `b` | `marked`'s list tokenizer writes each tab of a later line's leading whitespace as four spaces | as CommonMark |
| 2 | `-·a⏎··→-·b` | nested list | one paragraph `a - b` | the same | as CommonMark |
| 3 | `-·a⏎·→-·b⏎⏎······x` | `x` is a paragraph of the nested item | `x` is a code block of the outer item | the same; this is the M36 document | as CommonMark |
| 4 | `-·a⏎··-→b⏎⏎→x` | `x` is a paragraph of the nested item | `x` is a paragraph of the outer item | the same, for the line `→x` | as CommonMark |
| 5 | `-→```⏎·→⏎→code⏎→```` | code `⏎code` | code `·⏎code` | the same, for the line `·→` | as CommonMark |
| 6 | `>·→foo` | quote: paragraph | quote: code `foo` | `marked`'s blockquote tokenizer takes one space or tab after `>` and lexes the rest from column 0 | as CommonMark |
| 7 | `>→→foo` | quote: code `··foo` | quote: code `foo` | the same | as CommonMark |
| 8 | `>·-·a⏎>→-·b` | nested list | two sibling items | the same | as CommonMark |
| 9 | `>·-·a⏎>⏎>→b` | `b` is a paragraph of the item | `b` is a paragraph after the list | the same | as CommonMark |
| 10 | `` ·```⏎→x⏎·``` `` | code `···x` | code `x` | `marked` takes characters, not columns, off a line under an indented fence | as CommonMark |
| 11 | `` -·one⏎⏎··```⏎··aa⏎··→bb⏎··``` `` | code `aa⏎→bb` | code `aa⏎····bb` | as row 1 | code `aa⏎··bb`, pinned (T30) |
| 12 | `` -·a⏎⏎··```⏎··-→old⏎··``` `` | code `-→old` | as CommonMark | — | code `-·old`, pinned (T31) |
| 13 | `>→→→foo` | quote: code `··→foo` | quote: code `→foo` | as row 6 | quote: code `······foo`, pinned (T32) |
| 14 | `` >·```⏎>·→x⏎>·``` `` | quote: code `→x` | as CommonMark | — | quote: code `··x`, pinned (T33) |

`marked` 18.1.0 alone already reads these as CommonMark does: `-→a⏎→-→b⏎→→-→c` (three nested lists), a tab inside a list item's text, code span, code block or HTML block, `··→foo` (code `foo`), and examples 1 to 5 and 7 to 11 of the spec's section 2.2. Example 6 is row 7.

### How often

- 111 hand-written tab documents, read through `lexMarkdown` and compared with `commonmark.js`: on the base 93 read alike, 11 differ in block structure and 7 in literal text only. With this plan 106 read alike. The other five are a table and two task items, which CommonMark does not have, and rows T30 and T32.
- 2,932 drawn tab documents: the base reads 364 otherwise than their spaces form in block structure alone, and viewer and editor agree differently on 94. With this plan both counts are 0. Read through `lexMarkdown`, 1,995 of them read as `commonmark.js` reads them on the base, and 2,114 with this plan; most of the rest hold a task checkbox or a line `marked` reads otherwise for reasons that are not tabs.
- 19,537 drawn tab documents (20,000 draws): every top-level `raw` joins back into its source, and the bounded lexer equals its unbounded twin, on the base and with this plan's code.

### What the WYSIWYG serializer writes

The standard form holds no tab in indentation: list items and their blocks are written with spaces. It writes every tab inside a line's text, code span, code block and HTML as a tab, on the base and with this plan.

---

## Notes

[^measured]: Measured on a private copy of commit `736452bbc`, the tip of the Markdown stack, with the plans `marked-version-pin-or-upgrade` and `marked-upgrade` applied as their texts give them, and `marked` 18.1.0 in a `node_modules` of the copy's own. Nothing was installed into the main tree or a worktree. `## Addendum: Measured readings` holds the full table. The probes, their outputs and the prototype (`plan-on-upgrade.patch`, this plan's whole change as a diff against the upgraded base) are kept under `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans4/tab-revision/`; `PROGRESS.md` there says which output is which. The first draft's material, measured on 18.0.9, is under `scratch-keep/plans3/tab-column/`.

[^line-end]: The rule as first accepted wrote every tab of the prefix as the spaces to its stop, line ends included. On 18.0.9 that cost nothing, because `marked` wrote every tab of a list item's line as spaces anyway. On 18.1.0 it gave three of the 2,932 drawn documents a standard-form save that reads otherwise than the source, and one of them also a save that does not reload to itself. In each, a line of markers and tabs, such as `→-→-→`, continues a paragraph. Its last tab, written as spaces, left the line ending in two or more spaces, which the viewer reads as a hard line break. CommonMark reads no break there: a hard break needs spaces, and trailing tabs do not count. Leaving that tab to `marked` instead was measured too, and read worse: `marked` matches some line ends only when they are spaces (`-··` under a paragraph is a setext underline, `-··→` is not), so 2,092 of the drawn documents read as `commonmark.js` reads them, against 2,097 with the tab written as spaces. One space keeps what `marked` needs and makes no break: 2,114 read as `commonmark.js`, and all three hard checks of `## Verification` count 0. A line of whitespace only is left out of the exception: inside a fenced block of a list item it is the indentation of an empty code line (the document `-→```⏎·→⏎→code⏎→```` of the addendum's row 5), whose width decides what the code holds. Row T42 pins the exception.

[^order]: The owner decided on 2026-10-14 that `marked-version-pin-or-upgrade` and then `marked-upgrade` run before this plan. On 18.1.0 two corrections of the first draft are redundant: `marked` 18.0.13 takes a tab after one to three spaces off an indented code line by itself (its rule `codeRemoveIndent` is the draft's `INDENTED_CODE_LINE_START`), and 18.0.14 stopped writing the tabs inside a list item's content as spaces. Every reading and count this plan relies on was re-derived on 18.1.0; where a footnote quotes an older measurement, it says so.

[^one-rule]: CommonMark's own rule is that tabs "behave as if they were replaced by spaces with a tab stop of 4 characters" where whitespace helps to define block structure. A container prefix is exactly that whitespace, plus the markers between its runs. Writing its tabs as spaces by absolute column therefore changes no reading, and gives `marked` what it can count: one character per column. Two narrower prefixes were measured on 18.0.9 and rejected. Whitespace alone leaves the tab after a nested marker to `marked`, which counts it from the nested list's start: rows T20 and T21 then read wrongly. Whitespace and `>` alone does the same inside quotes. The cost of including markers is row T31: a code line that starts with a marker character and a tab loses that tab to spaces, where `marked` 18.1.0 alone keeps it as CommonMark does. The owner accepted that cost (decision b).

[^precedent]: The alternative places were all worse. A pass over the whole document before lexing would shift every offset the editor's source map rests on, and could not tell a list from the content of a top-level fence. Rewriting in the importer would leave the viewer on the old reading, which breaks the rule that both read alike. Replacing `marked`'s list tokenizer with a copy that counts columns is a fork of some 250 lines that every `marked` release would have to be merged into.

[^redundant]: The first draft of this plan, written for 18.0.9, had a fourth tokenizer in the `code` slot and kept the tabs inside a list item's content through a stand-in character. Neither is needed on 18.1.0. `marked`'s `code` tokenizer now takes a tab after one to three spaces with them (upstream #4080, 18.0.13), and its list tokenizer expands only the leading whitespace of a line, keeping every later tab (#4086, 18.0.14). Since every tab of that leading whitespace lies in the container prefix, `listWithTabStops` has already written it as spaces, and whatever tab `marked` then meets is content. Rows T1 to T4, T25 to T27, LX30, LX32, LX33, E37 and E38 pin both readings, and fail if a later `marked` loses either.

[^raw]: `marked` builds an item's `raw` by appending each line it consumes with its line end, and trims the last item and the list at the end. The tab-free copy has the same number of lines as the source and the same line ends, so the n-th line of one is the n-th line of the other. `blockquoteWithSourceRaw` already returns a `raw` that ends at a line end of what it was given. LX31, LX35 and LX36 pin this: on 19,537 drawn tab documents every top-level `raw` joined back into its source.

[^margin]: Found by the differential. With the tokenizers alone, 4 of the 2,932 drawn documents and row T41 had a standard-form save that read otherwise than the source, all of one kind: a quote kept as a raw block, indented by one to three spaces, with a tab on a line that `rawBlockAtMargin` moved (`··>·→` followed by three backticks is an indented code line holding the backticks; with the two spaces gone it opens a fence). `readingInBlockList` does not catch every such move, because the moved line can read the same where it stands alone and differently beside the lines around it. Before this plan a tab's width did not depend on its column, so moving such a line was harmless. Refusing the move gives 0, and 6 documents whose standard-form save reads as the source where it did not on the base. Two other fixes were tried on 18.0.9 and measured worse: writing the block's prefix tabs as spaces before dedenting, and doing that only for the lines that move.

[^pinned-code]: CommonMark keeps a tab whole when the container's indentation ends before it, so `··→bb` in a `- ` item is the code line `→bb`. `marked` cuts an item's indentation off each line and then lexes the rest with no record of which source line it came from, and `listWithTabStops` writes the prefix tabs as spaces before that, so by the time a fenced block is recognised the tab is already spaces. Keeping it would need each nested token traced back to its source lines, through `marked`'s re-reads of lazy lines; the `markdown-list-toggle-task-item-parity` notes record what a search of that kind cost (reviews 4 and 5: a quadratic search, and blocks found on a later look-alike line). The reading this plan pins is the closest one reachable: the same columns as the source. On the base, `marked` 18.1.0 wrote a leading tab of such a line as four spaces (row T30) and kept a tab after a marker character (row T31) or after a quote's `> ` (row T33). The consequence to know: the editor cannot keep a tab in the indentation of a code line inside a list item or quote. One typed there is saved, and reads back as spaces.

[^blocks-field]: Most tab rows pass all seven harness checks on the base, because those checks compare the editor with the viewer and both were wrong together. Without a declared reading only T35 and T36 would have been seen to fail first.

[^tested]: The code of `## Internal Structure` was applied to the copy described in the first note, with the test changes of steps 1 to 9, and the whole library suite was run: 20,170 tests, 0 failed. One test, `import without a DOM ./glyphs` in `tests/unit/import-without-dom.test.ts`, timed out in both full runs of the suite on the copy, each while another agent's tests ran beside it, and passes when run alone; it imports a module cold and touches nothing this plan changes. The steps were also replayed one at a time on the copy: the red and green lists of steps 4 to 8 are what those runs gave.

[^s2]: On the base the list in `>→-·a` was read with its markers at the quote's content column, and the heading command wrote `## a` and left `>→- b`. The tab is three columns wide, so CommonMark puts the markers two columns in, and the source-mode commands already decline on a list whose markers are indented (row `E33`). The command that acted on the base now declines on this one shape. The WYSIWYG surface keeps a quote holding a list as raw Markdown (row T40), so it offers no list command there either.

[^h1]: Example: `-·⏎··→>·</div>`. The base read the second line as a code block of the item, which the editor shows as one. It is a quote holding an HTML block, as its spaces form `-·⏎····>·</div>` already was on the base, and the editor keeps a quote that holds a block as raw Markdown (the known divergence `quoteBlocks`). All 16 documents were checked: on the base, viewer and editor disagree on the spaces form of each. Row G2 states the same for every drawn document, and counts 0.

[^counts]: Measured on the copy: the four touched test files outside the round-trip folder, with that folder, go from 7,440 to 7,919 tests. `markdown-roundtrip.test.ts` gains 411: eight tests for each of the 51 new corpus rows (seven checks and `viewer reads the declared blocks`) and G1 to G3. `markdown-edit-fuzz.test.ts` gains 51, one per new row; `markdownLexer.test.ts` 7, `code-editor.test.ts` 7, `markdown-editor.test.ts` 2 and `markdown-source-edits.test.ts` 1. The plans that land between the measured base and this plan add tests of their own, so compare with the branch's parent, not with these totals.
