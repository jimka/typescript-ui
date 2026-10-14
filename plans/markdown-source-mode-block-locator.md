---
depends-on:
  - marked-version-pin-or-upgrade
  - marked-upgrade
  - markdown-tab-column-parity
  - markdown-source-mode-list-lift-parity
touches-shared:
  - packages/lib/src/typescript/lib/component/display/markdownExtensions.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourceTokens.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts
  - packages/lib/tests/component/display/markdownLexer.test.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-source-edits.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Source-Mode Block Locator — Implementation Plan

## Overview

`MarkdownEditor`'s source mode edits the raw Markdown text. Each of its commands first reads the document through the viewer's lexer and works out where every block stands in the text. This plan calls that *placing* a block: finding the source offsets its text starts and ends at. Today a block is placed by searching the text for the block's content ([markdownSourceTokens.ts:288](../packages/lib/src/typescript/lib/component/editor/markdownSourceTokens.ts#L288), `findAligned`). The search has three faults.

| Fault | Document (`→` is a tab, `·` a space, `⏎` a line end) | What happens today |
|---|---|---|
| It can find a look-alike | `- one ⏎⏎ →same ⏎⏎ ··same ⏎ - two` | the paragraph on the tab line is placed on the later `··same` line |
| It can find nothing | `- one ⏎⏎ →second ⏎ - two` | the paragraph `second` is not placed, so every command on it does nothing, bold included |
| A command asks about every line by walking every block | select everything in a list of 6,400 lines that nests eight levels deep, bulleted toggle | 24 seconds |

This plan replaces the search with a computation that needs none. A block's place follows from two facts about the lexer, and every line of the result is compared with the source. A block is then placed where it stands or not at all. The plan also gives the line commands one index of what each line holds, so a command costs time in proportion to the document.

The change is in three source files: the analysis in [markdownSourceTokens.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceTokens.ts), the line commands' lookups in [markdownSourceLines.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts), and one small recorder in the lexer module [markdownExtensions.ts](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts). `MarkdownEditor.ts`, `CodeEditor.ts`, `markdownSourceEdits.ts` and the WYSIWYG surface are not touched.

*Base* means the code this plan starts from: commit `736452bbc`, the tip of the Markdown stack, with the four plans of `depends-on` on top. `marked` is 18.1.0 there (`marked-version-pin-or-upgrade`, then `marked-upgrade`). `markdown-tab-column-parity` reads a tab in a line's container prefix as the spaces to its tab stop, and `markdown-source-mode-list-lift-parity` takes what a list item holds after a lifted block out of the list with it, writing a tab in a moved line's container prefix as spaces. Every number here was measured on `736452bbc` with the code of those four plans applied and `marked` 18.1.0.[^measured] The three modules this plan replaces code in are the same at `736452bbc` as at the older tip `75d022ba1`. Line numbers are from `736452bbc`; find each site by its symbol name.

---

## Architecture Decisions

### A block's place is computed from the token tree — nothing is searched

The analysis walks the tokens `lexMarkdown` returned and computes each one's place. It never looks for a block's text. Two facts about the lexer make that possible.

**Fact 1: the `raw`s of a token list add up to the text the list was lexed from.** `marked`'s lexer advances by exactly `token.raw.length` after every token (`blockTokens` in `marked`'s `Lexer.ts`, version 18.1.0). So in any token list — the document's, a list item's, a quote's, a `:::` column's — each token starts where the one before it ends. The same holds for a list's items inside the list's own `raw`.

**Fact 2: a container's content is lexed from a copy of its lines with the container's prefix taken off.** A *container* is a block that holds other blocks: a quote, a list item, a `:::` column. `marked` builds the text of a list item, and of a quote, line by line from the item's or quote's own lines. From each line it takes off the marker, the indentation or the `>`. It adds nothing but leading whitespace. So line *n* of the content is the *end* of line *n* of the container, and what stands before it there is the container's prefix.

| What is placed | Where it starts | What is compared |
|---|---|---|
| a token of the document | where the token before it ends | every line of its `raw` with the source line |
| an item of a list | where the item before it ends, inside the list's `raw` | the item's `raw` with the list's `raw` at that position |
| line *n* of an item's or a quote's content | at the end of line *n* of the item or quote | the content line with the end of that line; what stands before it with the container's prefix pattern |
| line *n* of a `:::` column | on the fence line that many lines past the column's `|||` line | the two lines, which must be equal |
| a block's inline text | at the block's start, after an ATX heading's `#` run, or after the block's indentation | the text with the block's lines |

Worked example, `- one ⏎⏎ →second ⏎ - two` (the `- ` item's content starts at column 2, and the tab runs from column 0 to column 4):

| Step | Computed | Compared |
|---|---|---|
| the list | starts at offset 0: it is the document's first token | its four lines with the source's lines 0 to 3 |
| the first item | starts where the list starts; its `raw` is three lines long | its `raw` with the start of the list's `raw` |
| the item's content, `one ⏎⏎ ··second` | line 0 `one` on source line 0, line 2 `··second` on source line 2 | `one` ends `-·one`, and `-·` is an item's marker; `second` ends `····second` (the tab read as four spaces), the two leading spaces stand on the tab's last two columns, and the two columns before them are indentation |
| the paragraph `second` | starts on content line 2, column 0: offset 7, the tab | — the content lines are the paragraph's own text |

The base places the list and its item and gives up on the paragraph.

Two pieces of existing code already work this way. The editor's import pairs each top-level token with its text in order, each where the one before it ended ([markdownImporter.ts:592](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L592), `locateTokens`). `restoreListSource`, which `markdown-tab-column-parity` adds to `markdownExtensions.ts`, finds each list item's source lines by counting the lines of its `raw`. This plan does the same at every depth.[^mechanism]

### Every placed line is compared with the line it is placed on

The two facts are read off `marked` 18.1.0 and the dialect's wrappers. The analysis does not rely on them unchecked. Each line it places is compared with the line it is placed on, as the tables above say. A line that does not compare is not placed, and no block that touches it is placed. A container whose content has more lines than the container, or leaves lines of the container over that hold more than container syntax, places nothing inside it.

So a change in the lexer that broke a fact would show as blocks that are not placed — commands that do nothing — and as failing rows `P1` to `P16` of this plan. It would not show as a block placed on another block's lines.[^checked]

### The lexer tells what its tokens do not: the definitions it dropped

One thing breaks Fact 1. When a link reference definition repeats a label that is already defined, `marked`'s lexer reads it, advances past it and keeps no token. The text is then longer than the `raw`s.

[markdownExtensions.ts](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts) gains a block extension, `DROPPED_DEFINITION_RECORDER`, that sees every block position before the lexer's own rules do and records each definition the lexer is about to drop: its `raw`, under the token it follows. It never returns a token, so no reader of `lexMarkdown` sees a difference. The analysis puts each recorded definition back into the sum.

| Document | Tokens of the document | Recorded | Sum of `raw`s with the record |
|---|---|---|---|
| `[a]:·x ⏎ [a]:·y ⏎⏎ para` | `def` (`[a]:·x⏎`), `space`, `paragraph` | `[a]:·y` after the `def`, at index 7 of its `raw` | `[a]:·x⏎` + `[a]:·y` + `⏎⏎` + `para`: the whole text |

The precedent is `recordingLexer` ([markdownExtensions.ts:331](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L331)), which already records, under the token array `marked` returns, what the list tokenizer queued for each item.[^recorder]

### Three places where `marked` writes something it did not read

Three more things make a token's `raw` differ from the text it was read from. Each is undone by a rule of its own, in the analysis.

| What `marked` does | Example | Rule |
|---|---|---|
| It takes a task marker off a list item's first text after lexing it, and writes it as a `checkbox` token, alone or at the head of that text's `raw` | `-·[·]→task`: tokens `checkbox` (`[·]·`) and `text` (`task`), where the content read was `[·]···task` | The checkbox counts for no text. Its place is read from the item's first line: the `[ ]` after the item's marker |
| It lexes a quote's content in several goes, one per run of lines, into one token list, and leaves the line end between two runs out | `>·alpha ⏎ \|·h·\| ⏎ \|·---·\| ⏎ \|·beta·\|`: tokens `paragraph` (`alpha`) and `mdtable`, no line end between them | A block always starts a line. A token of a quote that would start in the middle of a line is put on the next |
| It writes a lone space or tab that ends a text as a line end on the token before it | a list that ends a quote's line run on `same→`: the list's `raw` ends in a line end the text does not hold | An empty content line that cannot be the container's line there takes no line |

### What is not placed

A block is left unplaced only when a line it stands on does not compare; a command on it then does nothing. In the documents measured that never happens: every block of 21,660 documents is placed, a quarter of them built to hold look-alike lines, tabs, carriage returns, whitespace at line ends and lazy lines. Row `P13` pins a tab inside an item's text, a shape the first version of this plan could not place when the document also held the character U+FDD0.[^unplaced]

### The text of a table cell is still looked for inside its row's line

A table's lines are placed by the rules above, each row on its own line. Inside a row's line, each cell's text is still found by a search, as at the base. The search cannot leave the row. It can take the text of a merged-away cell for the next cell's: in `| a | << | < |` the last cell's `<` is placed on the `<<`. Both the base and this plan do that, and a command there does nothing. Placing cells exactly needs the table tokenizer to say which column each cell came from; that is a change to another module, and `markdown-source-mode-command-gaps` makes it (owner's answer B3).[^cells]

### One index of what each line holds makes a command linear

A line command asks, for every line of its selection, which quotes and list items hold the line, and whether a block holds it at all. At the base each question walks every block of the document, so a command over everything costs lines times blocks. The commands' check also asks questions per *leaf*: one visible character of the document, as the check lists them. [markdownSourceLines.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts) gains `lineIndexOf`, which reads those answers for every line in one walk of the block tree and keeps them per analysis. The line commands' other lookups that grow with the selection — the target block of a leaf, the lifted block a leaf follows, the replacement that starts on a line — become maps and binary searches. No lookup changes its answer.[^index]

| Lookup, per line or per leaf | At the base | After |
|---|---|---|
| the containers of a line (`containersOfLine`) | every block | one map read |
| whether a block holds a line (`lineIsHeld`) | every leaf block | one map read |
| the target a leaf belongs to (`targetOfEntry`) | every target | one map read |
| the lifted block a leaf follows (`liftBefore`), the lifted blocks inside a container (`instanceId`), in the terms of `markdown-source-mode-list-lift-parity` | every lifted block | a binary search |

The stated bound: an analysis, and a command on it, cost time in proportion to the text's length times the depth its containers nest to. The lexer itself has that bound, since `marked` copies a list item's text once for every level.[^bound]

### The analysis stays whole-document, cached by text

`analyzeMarkdownSource` keeps its one-entry cache, keyed by the text ([markdownSourceTokens.ts:128](../packages/lib/src/typescript/lib/component/editor/markdownSourceTokens.ts#L128)). It is not made incremental and not keyed by a document version.[^cache]

### The WYSIWYG importer keeps its own top-level placing

The editor's import pairs each top-level token with its source text to save unedited blocks byte for byte ([markdownImporter.ts:592](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L592), `locateTokens`). It is not changed and does not use the new places.[^importer]

### A placed block a tab indents is written as its spaces form is

Once a block a tab indents is placed, the line commands of `markdown-source-mode-list-lift-parity` act on it with no change. Two plans write the lines of such a command:

| Lines | Written by | What happens to a tab in the line's container prefix |
|---|---|---|
| the block's own lines | the lift as it stands at the base, now that the block is placed (owner's answer B1) | the line is written anew from the block's text; the tab's columns that the list items around the block took go with them, and any columns left over stay, as spaces |
| every line after the block that a lift moves: the tail, the wrap item's first line, the lines below it | `markdown-source-mode-list-lift-parity` (its L4) | written as the spaces it stood for, as that plan's table says |
| every other line | nobody | kept byte for byte |

Together the two give one rule: a command on a document with tabs in its container prefixes gives the result it gives on the document's *spaces form*, the same text with each such tab written as the spaces to its tab stop, in every line it rewrites. Measured on 1,013 drawn tab documents, the rule holds in every case where both forms act. In 668 cases the spaces form acts and the tab document does nothing; all of them are the list-lift plan's base candidate, which still declines on a tab (see `## Non-Goals`).[^spaces-form]

| Document, caret, command | Spaces form of the document | Result on either |
|---|---|---|
| `- one ⏎⏎ →second ⏎ - two`, `second`, bulleted toggle | `- one ⏎⏎ ····second ⏎ - two` | `- one ⏎⏎ - second ⏎ - two` |
| the same, `setBlockType("h2")` | the same | `- one ⏎⏎ ## second ⏎ - two` |
| the same, `setBlockType("code")` | the same | `` - one ⏎⏎ ``` ⏎ ··second ⏎ ``` ⏎ - two ``: the item took two of the tab's four columns, the code keeps the other two |
| `- one ⏎ →- nested ⏎ - two`, `one`, bulleted toggle | `- one ⏎ ····- nested ⏎ - two` | `one ⏎ -···- nested ⏎ - two`: the nested list is the wrap item, re-opened by the outer item's marker |

### Which pinned rows change

Rows of the tables in [markdown-editor.test.ts](../packages/lib/tests/component/markdown-editor.test.ts), as `markdown-source-mode-list-lift-parity` leaves them. `E25`, `E26` and `E27` are the three rows that plan leaves in `DIFFERS` because their blocks are not placed. All three now read as the WYSIWYG result. Their documents hold a tab in an item's indentation, which is not text the editor saves, so they cannot stand in the `SAME` table; they become rows of the source-mode `CASES` table.

| Row | Document, caret | Source mode at the base | After this plan | WYSIWYG | Who writes which line |
|---|---|---|---|---|---|
| `E25` `UL` | `- one ⏎⏎ →second ⏎ - two`, `second` | nothing | `- one ⏎⏎ - second ⏎ - two` | `- one ⏎⏎ - second ⏎⏎ - two` | `- second`: this plan (B1) |
| `E26` `UL` | `- one ⏎ →- nested ⏎ - two`, `nested` | nothing | `- one ⏎⏎ nested ⏎⏎ - two` | the same | `nested`: this plan (B1) |
| `E27` `UL` | `- one ⏎ →- nested ⏎ - two`, `one` | nothing | `one ⏎ -···- nested ⏎ - two` | `one ⏎⏎ - - nested ⏎ - two` | `one`: the lift, as at the base; `-···- nested`: `markdown-source-mode-list-lift-parity` (L4) |
| `S2` of `markdown-source-edits.test.ts` | `>→- a ⏎ >→- b`, `a`, `setBlockType("h2")` | nothing | `## a ⏎ >→- b` | — (a raw block there) | `## a`: this plan |

`E27` did nothing at the base because the nested list its tail ends at was not placed, so the tail lift could not be built. The rows `E24` (two), `E19` `UL` and `E18` (two) act already with `markdown-source-mode-list-lift-parity` and give the same text after this plan.

An inline command on a tab-indented block acts and keeps the tab: `toggleBold` on `second` in `- one ⏎⏎ →second para ⏎ - two` gives `- one ⏎⏎ →**second** para ⏎ - two`.

### The `can…` fields are not changed

In source mode `canFormat`, `canLink`, `canSetBlockType` and the others stay `true` whenever the editor is not read-only (`readSurfaceSelectionState`, [MarkdownEditor.ts:6864](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L6864)). Source mode does not predict where a command does nothing; this plan only makes it do nothing in fewer places.

### Decisions (signed off 2026-10-14)

The repository's owner answered three of the four questions on 2026-10-14. The plan is written for these answers.

**B1. A block command on a tab-indented block writes that block's line without the tab — accepted.** `setBlockType("h2")` on `second` in `- one ⏎⏎ →second ⏎ - two` gives `## second`; the bulleted toggle gives `- second`. The block's own line is the line the command rewrites, on tab and space indentation alike.

**B3. Table cells stay searched inside their row — accepted.** See the decision above. `markdown-source-mode-command-gaps` adds a `column` field to the table tokens and places each cell on its own segment of the row.

**B4. `setBlockType("paragraph")` on a tab-indented paragraph of a list item does nothing — accepted, as on the WYSIWYG surface.** The block is a paragraph already. Source mode leaves it where it stands, as it does the same block indented with spaces (`- one ⏎⏎ ····second ⏎ - two`), and the WYSIWYG command changes nothing there either. Row `a paragraph command declines on a block of an item that a tab indents` pins it.

### Decision that awaits the owner's sign-off

**B2. Commands that acted at the base through a misplaced block now do nothing.** In 78 of 970,320 generated cases a line command acted at the base and does nothing after this plan; none is in the sets of the earlier reviews. 77 of them were examined for the first version of this plan; on the base this plan now starts from they are the same 77, with the same base results, and one more case joins them. In 75 the selection takes in the line of a repeated link reference definition, where the search had put a later paragraph's text. In 2, one document with a tab, it takes in the first line of a list item's setext heading, where the search had put a nested item. In the new one the caret stands on a code line of a fence that a tab indents, where the search had put the item's later paragraph: the base took that paragraph out of the list and rewrote the code line, an edit of a block the caret was not in. No source-mode rule gives the base's results:

| The same selection in another document | Base | This plan |
|---|---|---|
| the definition kept, under a label of its own | nothing | nothing |
| the tab documents with spaces for the tabs | nothing | nothing |

Both rows follow documented rules: a line command does nothing over a definition, and a source-mode list toggle does nothing on a setext heading. The WYSIWYG surface acts in all 77 examined. In the 75 it converts the definition's text with the other blocks, a documented difference between the surfaces; in the 2 its result reads as the base's.[^seventy-seven] The new case is a fault of the search and not part of the question: with the tabs written as spaces both the base and this plan do nothing, as this plan does on the tab document.

*Recommendation:* accept. The plan's code stays as it is, and the test `declines on a selection that takes in a repeated definition, which no block holds` pins the change. *To answer in one line:* do these 77 commands do nothing, as over any definition and any setext heading (recommended), or should source-mode line commands pass over definition lines, in a plan of their own?

---

## Internal Structure

No public API changes. Everything below is internal to the library; the three new exports of `markdownExtensions.ts` are marked `@internal` and go into no barrel. The code is the code that was measured: the prototype modules stood in the tests tree and were put in place of the real ones by a Vitest plugin.[^prototype]

### `markdownExtensions.ts` — the recorder, and a tab-free prefix with its index map

Insert this block directly above the doc comment that starts `The dialect's extensions, shared by the bounded instance`. `containerPrefixEnd`, `MARKDOWN_TAB_STOP`, `TABBED_LINE_END` and `withPrefixTabsAsSpaces` are in the file already, from `markdown-tab-column-parity`. `prefixTabsAsSpacesWithIndexes` writes exactly what `withPrefixTabsAsSpaces` writes, including that plan's one exception: whitespace that holds a tab and ends the line after a marker is one space.

```ts
/** Read off `marked`'s `def` rule, which begins `^ {0,3}\[`. */
const DEFINITION_START = /^ {0,3}\[/;

/** A link reference definition the lexer read and kept no token for. */
export interface DroppedDefinition {
    /** The text the lexer read for it. */
    readonly raw: string;
    /**
     * How long the `raw` of the token before it was when the definition was
     * read; `0` for one read before its list's first token. The lexer adds
     * the line end that closes the definition to that token's `raw`
     * afterwards, so the definition stands inside that `raw`, at this index.
     */
    readonly at:  number;
}

/**
 * The link reference definitions the lexer read and kept no token for, in
 * reading order, under the token each one followed, or under the token list
 * itself for one read before the list's first token.
 */
const _droppedDefinitions = new WeakMap<object, DroppedDefinition[]>();

/** The top-level token lists of the lexes that dropped a definition, so that every other lex is asked nothing more. */
const _lexesThatDropped = new WeakSet<object>();

/**
 * Records every link reference definition `marked`'s lexer is about to drop.
 * The lexer reads a definition whose label is already defined, advances past
 * it and pushes no token, so the `raw`s of a token list no longer add up to
 * the text they were lexed from. A block extension is called at every block
 * position with the list being built; this one never returns a token.
 */
const DROPPED_DEFINITION_RECORDER: TokenizerExtension = {
    name:  "droppeddefinition",
    level: "block",
    tokenizer(src, tokens) {
        if (!DEFINITION_START.test(src)) {
            return undefined;
        }

        const definition = this.lexer.options.tokenizer?.def(src);
        const last = tokens.at(-1);
        const joinsText = last?.type === "paragraph" || last?.type === "text";
        const repeated = definition !== undefined && this.lexer.tokens.links[definition.tag] !== undefined;

        if (definition === undefined || joinsText || !repeated) {
            return undefined;
        }

        const owner: object = last ?? tokens;
        const dropped = _droppedDefinitions.get(owner) ?? [];

        dropped.push({ raw: definition.raw, at: last?.raw.length ?? 0 });
        _droppedDefinitions.set(owner, dropped);
        _lexesThatDropped.add(this.lexer.tokens);

        return undefined;
    },
};

/**
 * The link reference definitions the lexer read right after `owner` and kept
 * no token for.
 *
 * @internal Shared with the editor's source analysis, not part of the public API surface.
 *
 * @param owner - A block token, or a token list for the definitions read before its first token.
 * @returns The dropped definitions, in reading order.
 */
export function droppedDefinitionsAfter(owner: object): readonly DroppedDefinition[] {
    return _droppedDefinitions.get(owner) ?? [];
}

/**
 * Tells whether the lex that built a document's token list read a link
 * reference definition it kept no token for, anywhere in the document.
 *
 * @internal Shared with the editor's source analysis, not part of the public API surface.
 *
 * @param tokens - The top-level token list `lexMarkdown` returned.
 * @returns `true` when it dropped one.
 */
export function droppedDefinitions(tokens: readonly Token[]): boolean {
    return _lexesThatDropped.has(tokens);
}

/** A line with the tabs of its container prefix written as spaces, and where the characters of that prefix stand in the line. */
export interface SpacedLine {
    /** The line, its container prefix tab-free. */
    readonly text:    string;
    /** For each character of the tab-free prefix, the index of the line's character it stands for. */
    readonly indexes: readonly number[];
    /**
     * Where the container prefix ends in the line: character `indexes.length + n`
     * of `text` is character `end + n` of the line. Whitespace holding a tab that
     * ends the line after a marker is one space in `text`, standing for the
     * first character of that whitespace.
     */
    readonly end:     number;
}

/**
 * Writes every tab of a line's container prefix as spaces, as
 * {@link withPrefixTabsAsSpaces} does, and tells where each character of the
 * result stands in the line.
 *
 * @internal Shared with the editor's source analysis, not part of the public API surface.
 *
 * @param line - One line, without its line end.
 * @returns The tab-free form and its index map.
 */
export function prefixTabsAsSpacesWithIndexes(line: string): SpacedLine {
    const end = containerPrefixEnd(line);
    const rest = line.slice(end);
    const endsInTab = end > 0 && TABBED_LINE_END.test(rest);
    const indexes: number[] = [];
    let prefix = "";

    for (let index = 0; index < end; index += 1) {
        const char = line[index]!;
        const written = char === "\t" ? " ".repeat(MARKDOWN_TAB_STOP - (prefix.length % MARKDOWN_TAB_STOP)) : char;

        for (let count = 0; count < written.length; count += 1) {
            indexes.push(index);
        }

        prefix += written;
    }

    return { text: prefix + (endsInTab ? " " : rest), indexes, end };
}
```

Then make three edits in the same file.

1. Add the recorder to the extension list:

   ```ts
   const MARKDOWN_EXTENSIONS: TokenizerExtension[] = [
       UNDERLINE_EXTENSION, STYLED_SPAN_EXTENSION, BLOCK_EXTENSION, IMAGE_EXTENSION, DROPPED_DEFINITION_RECORDER,
   ];
   ```

2. Replace the body of `withPrefixTabsAsSpaces` (from `markdown-tab-column-parity`) with one line, so the two functions cannot drift apart. Its doc comment and signature stay. `TABBED_LINE_END` is then read by `prefixTabsAsSpacesWithIndexes` alone; leave the constant where it is. Because `prefixTabsAsSpacesWithIndexes` is declared further down the file, this works only for a function declaration, which it is.

   ```ts
   export function withPrefixTabsAsSpaces(line: string): string {
       return prefixTabsAsSpacesWithIndexes(line).text;
   }
   ```

3. Nothing else. `lexMarkdown`, `lexMarkdownUnbounded`, `lexMarkdownLinkDefinitions`, `lexMarkdownWithDefinitions` are not edited: both `Marked` instances are built from `MARKDOWN_EXTENSIONS`.

### `markdownSourceTokens.ts` — places instead of a search

Five edits.

**1. Imports.** Replace the three import statements from `markdownAttributes.js` and `markdownExtensions.js` with:

```ts
import {
    formatAttributes, resolveSpanStyle, spanStyleToAttributes, splitColumnSections,
} from "~/component/display/markdownAttributes.js";
import { droppedDefinitions, droppedDefinitionsAfter, lexMarkdown, prefixTabsAsSpacesWithIndexes } from "~/component/display/markdownExtensions.js";
import type { MdBlockToken, SpacedLine } from "~/component/display/markdownExtensions.js";
```

`lineEndAt` is no longer used in this file. Delete the constant `CONTAINER_PREFIX_CHARACTERS` and its comment.

**2. The builder.** Replace the `Builder` interface with:

```ts
/** The mutable state one analysis is built in. */
interface Builder {
    readonly text:         string;
    /** The lines of the text whose tokens are being walked, each with its place in the source. */
    place:                 Place;
    /** Where the next token of that text starts. */
    at:                    Position;
    /** Whether a token's text is compared with the lines it is placed on: not in a place built from that text. */
    checked:               boolean;
    /** Whether the document's lex read a link reference definition it kept no token for. */
    readonly dropped:      boolean;
    /** The task marker of the list item whose first block is walked next, `null` otherwise. */
    taskMarker:            TaskMarker | null;
    readonly tree:         BuildingNode[];
    /** The block whose content is being walked, `null` at the top level. */
    parent:                BuildingNode | null;
    readonly inlineBlocks: SourceInlineBlock[];
    readonly inlines:      SourceInline[];
    readonly entries:      SourceEntry[];
}
```

**3. The entry point.** In the doc comment of `analyzeMarkdownSource`, replace the second paragraph (from `Tokens are found by searching` to `declines rather than guess.`) with the paragraph below, and replace `buildAnalysis` whole.

```ts
 * Tokens are placed by counting, never by searching for their text. The
 * lexer advances by the `raw` of what it read, so the `raw`s of a token list
 * are the text the list was lexed from and each token starts where the one
 * before it ends. `marked` lexes what a quote, a list item or a `:::` column
 * holds from a copy of its lines with the container's prefix taken off, so
 * each line of that content is the end of the container's line. Every placed
 * line is compared with the line it is placed on. A token on a line that does
 * not compare is left unplaced (offsets `-1`) and a command on it declines:
 * a block is placed where it stands or not at all.
```

```ts
/**
 * Builds the analysis of `text`.
 *
 * @param text - The Markdown source.
 * @returns The analysis.
 */
function buildAnalysis(text: string): SourceAnalysis {
    const tokens = lexMarkdown(text);
    const builder: Builder = {
        text, place: sourcePlace(text), at: { line: 0, column: 0 }, checked: true, dropped: droppedDefinitions(tokens), taskMarker: null,
        tree: [], parent: null, inlineBlocks: [], inlines: [], entries: [],
    };

    walkBlocks(builder, tiledPieces(builder, tokens));

    return builder;
}
```

**4. Everything between the two section comments.** Delete from the line `// ---------------------------------------------------------------- source search` up to, but not including, the line `// ---------------------------------------------------------------- inline`. That removes `findAligned`, `alignAt`, `skipsSourceCharacter`, `endOf`, `locateRaw` and the whole `blocks` section. Put this in its place:

```ts
// ---------------------------------------------------------------- places

/**
 * One line of a text the lexer read, and where its characters stand in the
 * source: character `index` at `head[index]` while `head` holds it, and at
 * `base + index` past that.
 */
interface PlacedLine {
    /** The line as the lexer read it, without its line end. */
    readonly text:    string;
    /**
     * The source offsets of the line's first characters, for those that do
     * not stand at `base` plus their index: whitespace the lexer read a tab
     * as, or that the source does not hold. `null` when every character does.
     */
    readonly head:    readonly number[] | null;
    /** The source offset of character 0, were the line's characters all one after another in the source. */
    readonly base:    number;
    /** The source offset of the line end that closes the line, or the source's length. */
    readonly newline: number;
}

/** The lines of one text the lexer read; `null` for a line whose place in the source is not known. */
type Place = ReadonlyArray<PlacedLine | null>;

/** A position in a text the lexer read. */
interface Position {
    readonly line:   number;
    readonly column: number;
}

/** A stretch of the source. */
interface Span {
    readonly start: number;
    readonly end:   number;
}

/** One stretch of the text a token list was lexed from: a token's, or text the lexer kept no token for. */
interface Piece {
    readonly token:   Token | null;
    /** The text the lexer read for it. */
    readonly raw:     string;
    /** How many characters `marked` wrote at the head of the token's own `raw` after lexing it: a task marker's. */
    readonly written: number;
}

/** Where a task item's `[ ]` stands: the offsets of its three characters and of the whitespace after it, then the offset past that. */
type TaskMarker = readonly number[];

/** The kinds of container a text is lexed out of. */
type ContainerKind = "item" | "quote" | "column";

/** The character code of a line feed. */
const LINE_FEED = 10;

/** The character codes of a space and a tab. */
const SPACE = 32;
const TAB = 9;

/** What may stand before a list item's content on its first line: the marker, and a task marker `marked` takes off the text. */
const ITEM_FIRST_PREFIX = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?: +(?:\[[ xX]\] +)?)?$/;

/** What may stand before a list item's content on a later line: indentation. */
const ITEM_REST_PREFIX = /^ *$/;

/** What may stand before a quote's content: its marker and one space, or nothing on a lazy line. */
const QUOTE_PREFIX = /^(?: {0,3}> ?)?$/;

/** A list item's first line up to its task marker. */
const TASK_MARKER_LINE = /^( {0,3}(?:[-+*]|\d{1,9}[.)]) +)\[[ xX]\][ \t]/;

/** The opener of an ATX heading: what stands before its text. */
const ATX_HEADING_OPENER = /^ {0,3}#{1,6}[ \t]+/;

/** A line holding container syntax and whitespace alone: what a container's lines past its content may be. */
const CONTAINER_SYNTAX_LINE = /^[ \t>]*$/;

/**
 * The lines of the source, each character at its own offset. A line ends at
 * a line feed, or at a carriage return with or without one after it, which
 * `marked` reads as a line feed before it lexes.
 *
 * @param text - The Markdown source.
 * @returns The place of the document's own text.
 */
function sourcePlace(text: string): Place {
    const place: PlacedLine[] = [];
    const lineEnd = text.includes("\r") ? /\r\n|\r|\n/g : null;
    let start = 0;

    for (;;) {
        const match = lineEnd === null ? null : lineEnd.exec(text);
        const found = lineEnd === null ? text.indexOf("\n", start) : match === null ? -1 : match.index;
        const end = found === -1 ? text.length : found;

        place.push({ text: text.slice(start, end), head: null, base: start, newline: end });

        if (found === -1) {
            return place;
        }

        start = end + (match === null ? 1 : match[0].length);
    }
}

/**
 * The source offset a character of a placed line stands at.
 *
 * @param line - The line.
 * @param index - The character's index; the line's length for its end.
 * @returns The offset.
 */
function offsetAt(line: PlacedLine, index: number): number {
    const head = line.head;

    return head !== null && index < head.length ? head[index]! : line.base + index;
}

/**
 * The position just past a stretch of text that starts at `at`.
 *
 * @param at - Where the stretch starts.
 * @param raw - The stretch.
 * @returns Where it ends.
 */
function positionAfter(at: Position, raw: string): Position {
    const lastBreak = raw.lastIndexOf("\n");

    if (lastBreak === -1) {
        return { line: at.line, column: at.column + raw.length };
    }

    let breaks = 0;

    for (let index = raw.indexOf("\n"); index !== -1; index = raw.indexOf("\n", index + 1)) {
        breaks += 1;
    }

    return { line: at.line + breaks, column: raw.length - lastBreak - 1 };
}

/**
 * Counts the lines a token's `raw` spans. A line end that closes the last
 * line starts no new one.
 *
 * @param raw - A token's `raw`.
 * @returns The number of lines.
 */
function lineCount(raw: string): number {
    const end = positionAfter({ line: 0, column: 0 }, raw);

    return end.column === 0 && raw !== "" ? end.line : end.line + 1;
}

/**
 * Maps a stretch of text that starts at `at` to the source: each character's
 * offset, then the offset past the last. Every line is checked against the
 * placed line it stands on — the first from `at`, each later one whole, apart
 * from whitespace the stretch does not hold at a later line's start — so a
 * stretch that is not there is not mapped.
 *
 * @param place - The lines of the text the stretch belongs to.
 * @param at - Where the stretch starts.
 * @param needle - The stretch.
 * @returns The offsets, or `null` when the stretch does not stand there or a line is not placed.
 */
function offsetsAt(place: Place, at: Position, needle: string): number[] | null {
    const map = new Array<number>(needle.length + 1);
    let column = at.column;
    let from = 0;

    for (let index = 0; ; index += 1) {
        const line = place[at.line + index] ?? null;
        const lineEnd = needle.indexOf("\n", from);
        const last = lineEnd === -1;
        const to = last ? needle.length : lineEnd;

        if (line === null) {
            return null;
        }

        column = index === 0 ? column : continuationColumn(line.text, to - from);

        const length = to - from;
        const reads = length === line.text.length - column
            ? needle.startsWith(column === 0 ? line.text : line.text.slice(column), from)
            : last && line.text.startsWith(needle.slice(from, to), column);

        if (!reads) {
            return null;
        }

        const head = line.head === null ? 0 : Math.min(Math.max(line.head.length - column, 0), length);
        const first = line.base + column - from;

        for (let offset = 0; offset < head; offset += 1) {
            map[from + offset] = line.head![column + offset]!;
        }

        for (let index = from + head; index < to; index += 1) {
            map[index] = first + index;
        }

        map[to] = last ? offsetAt(line, column + length) : line.newline;

        if (last) {
            return map;
        }

        from = to + 1;
    }
}

/**
 * The column a later line of a stretch starts at on its placed line: past
 * the leading whitespace the stretch does not hold (`marked` joins an
 * indented line to a list item's text without its indentation), else 0.
 *
 * @param text - The placed line.
 * @param length - How long the stretch's line is.
 * @returns The column.
 */
function continuationColumn(text: string, length: number): number {
    const indent = text.length - length;

    for (let index = 0; index < indent; index += 1) {
        const blank = isBlank(text.charCodeAt(index));

        if (!blank) {
            return 0;
        }
    }

    return Math.max(indent, 0);
}

/**
 * The source span of a token's `raw`, its trailing line ends dropped, when it
 * starts at `at`. With `check`, every line of the `raw` must be the placed
 * line it stands on: the first from `at`, the last up to its own end, each
 * other one whole.
 *
 * @param place - The lines of the text the token was lexed from.
 * @param at - Where the token starts.
 * @param raw - The text the lexer read for it.
 * @param check - Whether the lines are compared: `false` for a place built from this very text.
 * @returns The span, or `null` when the text does not stand there or a line is not placed.
 */
function spanAt(place: Place, at: Position, raw: string, check: boolean): Span | null {
    let end = raw.length;

    while (end > 0 && raw.charCodeAt(end - 1) === LINE_FEED) {
        end -= 1;
    }

    const first = place[at.line] ?? null;

    if (end === 0 || first === null) {
        return null;
    }

    let line = first;
    let lineIndex = at.line;
    let column = at.column;
    let from = 0;

    for (;;) {
        const lineEnd = raw.indexOf("\n", from);
        const to = lineEnd === -1 || lineEnd > end ? end : lineEnd;
        const reads = !check || readsOnLine(line.text, column, raw, from, to, to === end);

        if (!reads) {
            return null;
        }

        if (to === end) {
            return { start: offsetAt(first, at.column), end: offsetAt(line, column + to - from) };
        }

        const next = place[lineIndex + 1] ?? null;

        if (next === null) {
            return null;
        }

        line = next;
        lineIndex += 1;
        column = 0;
        from = to + 1;
    }
}

/**
 * Whether the stretch `[from, to)` of a `raw` is what a placed line holds
 * from `column`: all of it for a line the `raw` runs past, its start for the
 * `raw`'s last line.
 *
 * @param text - The placed line.
 * @param column - Where the stretch starts on it.
 * @param raw - The token's `raw`.
 * @param from - Where the stretch starts in the `raw`.
 * @param to - Where it ends.
 * @param last - Whether it is the `raw`'s last line.
 * @returns Whether it is.
 */
function readsOnLine(text: string, column: number, raw: string, from: number, to: number, last: boolean): boolean {
    const length = to - from;
    const rest = text.length - column;

    if (length === rest) {
        return raw.startsWith(column === 0 ? text : text.slice(column), from);
    }

    return last && length < rest && text.startsWith(raw.slice(from, to), column);
}

/**
 * The stretches a token list was lexed from, in order: each token's `raw`,
 * and each link reference definition the lexer read and kept no token for.
 * Together they are the text the list was lexed from, because the lexer
 * advances by exactly the `raw` of what it read. A dropped definition stands
 * inside the `raw` of the token before it, whose closing line end the lexer
 * adds to that token afterwards.
 *
 * `marked` lexes a quote's content in several goes, one per run of lines,
 * into one list, and leaves the line end between two runs out. A block
 * always starts a line, so with `inRuns` a token that would start in the
 * middle of one is put on the next.
 *
 * @param builder - The analysis being built.
 * @param tokens - A token list as `lexMarkdown` built it.
 * @param inRuns - Whether the list is a quote's content.
 * @returns The pieces.
 */
function tiledPieces(builder: Builder, tokens: readonly Token[], inRuns = false): Piece[] {
    if (!builder.dropped && !inRuns) {
        return tokens.map(wholePiece);
    }

    const pieces: Piece[] = [];
    let midLine = false;
    const add = (token: Token | null, raw: string): void => {
        pieces.push({ token, raw, written: 0 });
        midLine = raw === "" ? midLine : !raw.endsWith("\n");
    };

    for (const dropped of droppedDefinitionsAfter(tokens)) {
        add(null, dropped.raw);
    }

    for (const token of tokens) {
        const dropped = droppedDefinitionsAfter(token);

        if (inRuns && midLine && token.type !== "space") {
            add(null, "\n");
        }

        add(token, token.raw.slice(0, dropped[0]?.at));

        dropped.forEach((definition, index) => {
            add(null, definition.raw);
            add(null, token.raw.slice(definition.at, dropped[index + 1]?.at));
        });
    }

    return pieces;
}

/**
 * The piece of a token whose `raw` is the text the lexer read for it.
 *
 * @param token - The token.
 * @returns The piece.
 */
function wholePiece(token: Token): Piece {
    return { token, raw: token.raw, written: 0 };
}

/**
 * The stretches a list item's content was lexed from. `marked` takes a task
 * marker off the item's first text after lexing it and writes it as a
 * `checkbox` token, alone or at the head of that text's `raw`; neither was
 * read from the content, so the marker counts for no text here.
 *
 * @param builder - The analysis being built.
 * @param item - The list item.
 * @returns The pieces.
 */
function itemPieces(builder: Builder, item: Tokens.ListItem): Piece[] {
    const pieces = tiledPieces(builder, item.tokens);

    if (!item.task) {
        return pieces;
    }

    const firstIndex = pieces.findIndex((piece) => piece.token !== null);
    const first = firstIndex === -1 ? null : pieces[firstIndex]!;
    const holder = first?.token ?? null;
    const marker = holder === null ? null : holder.type === "checkbox" ? holder : (holder as { tokens?: Token[] }).tokens?.[0] ?? null;

    if (first !== null && marker?.type === "checkbox" && first.raw.startsWith(marker.raw)) {
        pieces[firstIndex] = { token: holder, raw: first.raw.slice(marker.raw.length), written: marker.raw.length };
    }

    return pieces;
}

/**
 * Places the lines of a container's content: each content line against the
 * container's next line. `marked` lexes a container's content from a copy of
 * its lines with the container's prefix taken off, so a content line is the
 * end of its container line, and what stands before it there is the
 * container's prefix ({@link placedLine}).
 *
 * An empty content line that faces a container line holding more than the
 * prefix, or that comes after the container's last line, is not a line of
 * the source: `marked` writes a lone space or tab that ends a text as a line
 * end. It takes no container line. When the container has lines left that
 * hold more than container syntax, or the content has more lines than the
 * container, lines were lost on the way and nothing is placed.
 *
 * @param outer - The lines of the text the container was lexed from.
 * @param at - Where the container starts in it.
 * @param lines - How many lines the container spans.
 * @param pieces - The stretches its content was lexed from.
 * @param kind - The kind of container.
 * @returns The content's place.
 */
function contentPlace(outer: Place, at: Position, lines: number, pieces: readonly Piece[], kind: ContainerKind): Place {
    const text = pieces.length === 1 ? pieces[0]!.raw : pieces.map((piece) => piece.raw).join("");
    const inner = text.includes("\n") ? text.split("\n") : [text];
    const place: Array<PlacedLine | null> = [];
    let used = 0;

    for (const content of inner) {
        const line = used < lines ? outer[at.line + used] ?? null : null;
        const from = used === 0 ? at.column : 0;
        const prefix = kind === "quote" ? QUOTE_PREFIX : used === 0 ? ITEM_FIRST_PREFIX : ITEM_REST_PREFIX;
        const placed = line === null ? null : kind === "column" ? copiedLine(content, line) : placedLine(content, line, from, prefix);
        // An empty content line that cannot be the container's line there, or that comes after its last line, takes none.
        const written = content === "" && placed === null && (line !== null || used >= lines);

        place.push(placed);
        used += written ? 0 : 1;
    }

    for (let index = used; index < lines; index += 1) {
        const rest = outer[at.line + index] ?? null;
        const syntaxOnly = rest !== null && CONTAINER_SYNTAX_LINE.test(rest.text);

        if (!syntaxOnly) {
            return [];
        }
    }

    return used > lines ? [] : place;
}

/**
 * Places one line of a `:::` column on the fence's own line. A column's
 * lines are the fence's lines as they are, but for an escaped `\|||` line,
 * which is read without its backslash, and for whitespace at a line's end,
 * which the `raw` of a list that ends the column does not hold.
 *
 * @param text - The column's line.
 * @param outer - The fence's line.
 * @returns The placed line, or `null` when the column's line is not the fence's.
 */
function copiedLine(text: string, outer: PlacedLine): PlacedLine | null {
    if (outer.text === text) {
        return outer;
    }

    const isTrimmed = outer.text.startsWith(text) && lengthWithoutBlanks(outer.text) <= text.length;

    if (isTrimmed) {
        return { text, head: outer.head, base: outer.base, newline: outer.newline };
    }

    const escape = outer.text.indexOf("\\");
    const unescaped = escape !== -1 && outer.text.slice(0, escape) + outer.text.slice(escape + 1) === text;

    if (!unescaped) {
        return null;
    }

    const head: number[] = [];

    for (let index = 0; index <= text.length; index += 1) {
        head.push(offsetAt(outer, index >= escape ? index + 1 : index));
    }

    return { text, head, base: head[text.length]! - text.length, newline: outer.newline };
}

/**
 * Places one line of a container's content on the container's own line. The
 * content line, without the whitespace at its two ends, must end the
 * container line; its leading whitespace stands on the whitespace before
 * that, as far as there is any; and what is left before it must be the
 * container's prefix. A tab in the container line's prefix is read as the
 * spaces that reach its tab stop, as the lexer reads it.
 *
 * @param text - The content line.
 * @param outer - The container's line.
 * @param from - The column the container starts at on that line.
 * @param prefix - What the container's prefix must match.
 * @returns The placed line, or `null` when the content line is not the end of the container's.
 */
function placedLine(text: string, outer: PlacedLine, from: number, prefix: RegExp): PlacedLine | null {
    const outerText = from === 0 ? outer.text : outer.text.slice(from);
    const hasTab = outerText.includes("\t");
    const first = outerText.length - text.length;
    // The usual line: no tab to read as spaces, no whitespace at either end, every character one after another in the source.
    const isPlain = !hasTab && !isBlank(text.charCodeAt(0)) && !isBlank(text.charCodeAt(text.length - 1))
        && outerText.endsWith(text) && (outer.head === null || from + first >= outer.head.length);
    const prefixOk = isPlain && prefix.test(first === outerText.length ? outerText : outerText.slice(0, first));

    if (prefixOk) {
        return { text, head: null, base: outer.base + from + first, newline: outer.newline };
    }

    // An empty line may still stand after whitespace the prefix does not count.
    if (isPlain && text !== "") {
        return null;
    }

    return alignedLine(text, outer, from, outerText, hasTab ? prefixTabsAsSpacesWithIndexes(outerText) : null, prefix);
}

/**
 * Places a content line that {@link placedLine}'s usual case does not
 * cover: one with whitespace at an end, or on a container line whose prefix
 * holds a tab or whose first characters do not stand one after another.
 *
 * @param text - The content line.
 * @param outer - The container's line.
 * @param from - The column the container starts at on that line.
 * @param outerText - The container's line from that column.
 * @param spaced - That text with its prefix tabs read as spaces, `null` when it holds no tab.
 * @param prefix - What the container's prefix must match.
 * @returns The placed line, or `null` when the content line is not the end of the container's.
 */
function alignedLine(text: string, outer: PlacedLine, from: number, outerText: string, spaced: SpacedLine | null, prefix: RegExp): PlacedLine | null {
    const read = spaced === null ? outerText : spaced.text;
    const readEnd = lengthWithoutBlanks(read);
    const bodyEnd = lengthWithoutBlanks(text);
    const lead = leadingBlanks(text, bodyEnd);
    const coreLength = bodyEnd - lead;
    // A line of whitespace stands at the end of the container's line when that ends with it, else right after what that line holds.
    const coreStart = coreLength === 0 && read.endsWith(text) ? read.length - text.length : readEnd - coreLength;
    const coreReads = coreLength === 0 || (coreStart >= 0 && read.startsWith(text.slice(lead, bodyEnd), coreStart));
    const tailReads = coreLength === 0 || read.startsWith(text.slice(bodyEnd), readEnd) || text.startsWith(read.slice(readEnd), bodyEnd);

    if (!coreReads || !tailReads) {
        return null;
    }

    // How much of the content line's leading whitespace the container's line holds before it.
    let held = 0;

    while (held < lead && read.charCodeAt(coreStart - held - 1) === SPACE) {
        held += 1;
    }

    const first = coreStart - held;
    const prefixOk = prefix.test(coreLength === 0 ? read.slice(0, readEnd) : read.slice(0, first));

    if (!prefixOk) {
        return null;
    }

    // Character `index` of the content line stands at index `max(first, shift + index)` of the container's line as read.
    const shift = coreStart - lead;
    const width = spaced === null ? 0 : spaced.indexes.length;
    // Past the tab-free prefix, index `n` of the line as read is index `n + gain` of the container's own line.
    const gain = from + (spaced === null ? 0 : spaced.end - width);
    const outerHead = outer.head === null ? 0 : outer.head.length;
    // The first characters need an offset each: whitespace the source does not hold, the tab-free prefix, and what the container's own head holds.
    const own = Math.min(text.length + 1, Math.max(lead - held, width - shift, outerHead - gain - shift, 0));

    if (own === 0) {
        return { text, head: null, base: outer.base + gain + shift, newline: outer.newline };
    }

    const head = new Array<number>(own);

    for (let index = 0; index < own; index += 1) {
        const readIndex = Math.max(first, shift + index);

        head[index] = offsetAt(outer, readIndex < width ? from + spaced!.indexes[readIndex]! : readIndex + gain);
    }

    // A head that runs to the line's end is counted on from its last entry.
    const base = own === text.length + 1 ? head[own - 1]! - (own - 1) : outer.base + gain + shift;

    return { text, head, base, newline: outer.newline };
}

/**
 * The length of a line without the spaces and tabs at its end.
 *
 * @param text - The line.
 * @returns The length.
 */
function lengthWithoutBlanks(text: string): number {
    let end = text.length;

    while (end > 0 && isBlank(text.charCodeAt(end - 1))) {
        end -= 1;
    }

    return end;
}

/**
 * Counts the spaces and tabs a line starts with.
 *
 * @param text - The line.
 * @param end - Where the line's text ends.
 * @returns The count.
 */
function leadingBlanks(text: string, end: number): number {
    let count = 0;

    while (count < end && isBlank(text.charCodeAt(count))) {
        count += 1;
    }

    return count;
}

/**
 * Whether a character is a space or a tab.
 *
 * @param code - The character's code.
 * @returns Whether it is.
 */
function isBlank(code: number): boolean {
    return code === SPACE || code === TAB;
}

/**
 * Finds a task item's `[ ]` on the item's first line.
 *
 * @param place - The lines of the text the list was lexed from.
 * @param at - Where the item starts.
 * @returns The marker's place, or `null` when the line does not hold one after the item's marker.
 */
function taskMarkerAt(place: Place, at: Position): TaskMarker | null {
    const line = place[at.line] ?? null;

    if (line === null) {
        return null;
    }

    const outerText = line.text.slice(at.column);
    const spaced = outerText.includes("\t") ? prefixTabsAsSpacesWithIndexes(outerText) : null;
    const match = TASK_MARKER_LINE.exec(spaced === null ? outerText : spaced.text);

    if (match === null) {
        return null;
    }

    const start = match[1]!.length;
    const width = spaced === null ? 0 : spaced.indexes.length;
    const offsets = [0, 1, 2, 3].map((index) => {
        const readIndex = start + index;

        return offsetAt(line, at.column + (spaced === null || readIndex >= width ? readIndex + (spaced === null ? 0 : spaced.end - width) : spaced.indexes[readIndex]!));
    });

    return [...offsets, offsets[3]! + 1];
}

// ---------------------------------------------------------------- blocks

/**
 * Walks the stretches of a token list from the builder's position, and leaves
 * the position after the last.
 *
 * @param builder - The analysis being built.
 * @param pieces - The stretches the list was lexed from.
 */
function walkBlocks(builder: Builder, pieces: readonly Piece[]): void {
    for (const piece of pieces) {
        const at = builder.at;

        if (piece.token !== null) {
            walkBlock(builder, piece.token, piece.raw, piece.written);
            builder.taskMarker = piece.token.type === "space" ? builder.taskMarker : null;
        }

        builder.at = positionAfter(at, piece.raw);
    }
}

/**
 * Walks one block token: records its entries and its {@link SourceBlockNode},
 * and places its source and, for one holding inline text, every inline token
 * in it.
 *
 * @param builder - The analysis being built.
 * @param token - The block token.
 * @param raw - The text the lexer read for it.
 * @param written - How many characters of a task marker `marked` wrote at the head of the token's own `raw`.
 */
function walkBlock(builder: Builder, token: Token, raw: string, written: number): void {
    switch (token.type) {
        case "space":
            return;
        case "paragraph":
        case "heading":
        case "text":
            walkTextBlock(builder, token, raw, written);

            return;
        case "blockquote":
            walkContainer(builder, token, raw, "quote", (located) => {
                walkContent(builder, located, lineCount(raw), tiledPieces(builder, (token as Tokens.Blockquote).tokens, true), "quote");
            });

            return;
        case "list":
            walkContainer(builder, token, raw, listSignature(token as Tokens.List), (located) => {
                walkListItems(builder, (token as Tokens.List).items, raw, located);
            });

            return;
        case "mdtable":
            walkTable(builder, token as unknown as MdTableToken, raw);

            return;
        case "mdblock":
            walkFence(builder, token as unknown as MdBlockToken, raw);

            return;
        default:
            walkLeafBlock(builder, token, raw);
    }
}

/**
 * Opens a block's node: it becomes the last child of the block being walked,
 * and the block whose content is walked next.
 *
 * @param builder - The analysis being built.
 * @param type - The node's type.
 * @param token - The block's token, `null` for a column.
 * @returns The node.
 */
function openNode(builder: Builder, type: string, token: Token | null): BuildingNode {
    const node: BuildingNode = {
        type, token, start: -1, end: -1, parent: builder.parent, children: [], entryStart: builder.entries.length, entryEnd: -1,
    };

    (builder.parent?.children ?? builder.tree).push(node);
    builder.parent = node;

    return node;
}

/**
 * Closes a block's node once its content is walked: records its span and its
 * last entry, and returns to the block around it.
 *
 * @param builder - The analysis being built.
 * @param node - The node.
 * @param span - The block's source span, `null` when it is not placed.
 */
function closeNode(builder: Builder, node: BuildingNode, span: Span | null): void {
    node.start = span?.start ?? -1;
    node.end = span?.end ?? -1;
    node.entryEnd = builder.entries.length;
    builder.parent = node.parent;
}

/**
 * Walks a paragraph, heading or list item text: its inline tokens when it
 * holds them, else as a block with no inline text.
 *
 * @param builder - The analysis being built.
 * @param token - The block token.
 * @param raw - The text the lexer read for it.
 * @param written - How many characters of a task marker `marked` wrote at the head of the token's own `raw`.
 */
function walkTextBlock(builder: Builder, token: Token, raw: string, written: number): void {
    const tokens = (token as { tokens?: Token[] }).tokens;

    if (tokens === undefined) {
        walkLeafBlock(builder, token, raw);

        return;
    }

    const node = openNode(builder, token.type, token);
    const marker = written > 0 ? builder.taskMarker : null;
    const own = spanAt(builder.place, builder.at, raw, builder.checked);
    const span = written === 0 ? own : textSpanFromMarker(marker, own, raw);

    pushBlock(builder, token.type === "heading" ? `h${(token as Tokens.Heading).depth}` : token.type);
    walkInlineText(builder, tokens, inlineOffsets(builder, token, raw, tokens, written === 0 ? [] : marker), false);
    closeNode(builder, node, span);
}

/**
 * The source span of a text block at whose head `marked` wrote its item's
 * task marker: from the marker on the item's line to the end of the text.
 *
 * @param marker - Where the marker stands, `null` when it was not found.
 * @param own - The span of the text the lexer read for the block, `null` when it is not placed or empty.
 * @param raw - That text.
 * @returns The span, or `null` when the block is not placed.
 */
function textSpanFromMarker(marker: TaskMarker | null, own: Span | null, raw: string): Span | null {
    const holdsText = raw.replace(/\n+$/, "") !== "";
    const placed = marker !== null && (own !== null || !holdsText);

    return placed ? { start: marker[0]!, end: own?.end ?? marker[4]! } : null;
}

/**
 * Places a text block's inline text: the concatenated `raw` of its inline
 * tokens, which stands in the block's own text after an ATX heading's
 * opener, else at the block's start or after its indentation. A task marker
 * `marked` wrote at the head of the block stands where the item's line
 * holds it.
 *
 * @param builder - The analysis being built.
 * @param token - The block token.
 * @param raw - The text the lexer read for it.
 * @param tokens - Its inline tokens.
 * @param marker - Where the task marker written at the block's head stands: empty when none was written, `null` when it was not found.
 * @returns Each character's source offset, then the offset past the run; `null` when the run is not placed.
 */
function inlineOffsets(builder: Builder, token: Token, raw: string, tokens: readonly Token[], marker: readonly number[] | null): number[] | null {
    if (marker === null) {
        return null;
    }

    const written = marker.length === 0 ? 0 : tokens[0]!.raw.length;
    const head = marker.slice(0, written);
    const needle = tokens.map((inline) => inline.raw).join("").slice(written);

    if (needle === "") {
        return written === 0 ? null : [...head, marker[written]!];
    }

    const opener = token.type === "heading" ? ATX_HEADING_OPENER.exec(raw) : null;
    const firstLineEnd = needle.indexOf("\n");
    const startsBlock = raw.startsWith(firstLineEnd === -1 ? needle : needle.slice(0, firstLineEnd));
    const offset = opener !== null ? opener[0].length : startsBlock ? 0 : leadingBlanks(raw, raw.length);
    const map = offsetsAt(builder.place, offset === 0 ? builder.at : positionAfter(builder.at, raw.slice(0, offset)), needle);

    return map === null || head.length === 0 ? map : [...head, ...map];
}

/**
 * The signature of a list: whether it is ordered, its start and whether it
 * is loose.
 *
 * @param token - The list token.
 * @returns The signature.
 */
function listSignature(token: Tokens.List): string {
    return `list:${String(token.ordered)}:${String(token.start)}:${String(token.loose)}`;
}

/**
 * Walks a container block: places its source, then walks its content.
 *
 * @param builder - The analysis being built.
 * @param token - The container token.
 * @param raw - The text the lexer read for it.
 * @param signature - Its block signature.
 * @param walkInside - Walks its content, told whether the container is placed.
 */
function walkContainer(builder: Builder, token: Token, raw: string, signature: string, walkInside: (located: boolean) => void): void {
    const node = openNode(builder, token.type, token);
    const span = spanAt(builder.place, builder.at, raw, builder.checked);
    const outer = { place: builder.place, at: builder.at, checked: builder.checked };

    pushBlock(builder, signature);
    walkInside(span !== null);
    pushBlock(builder, `/${signature.split(":")[0]!}`);
    builder.place = outer.place;
    builder.at = outer.at;
    builder.checked = outer.checked;
    closeNode(builder, node, span);
}

/**
 * Walks a container's content in the content's own place.
 *
 * @param builder - The analysis being built, at the container's start.
 * @param located - Whether the container is placed.
 * @param lines - How many lines the container spans.
 * @param pieces - The stretches its content was lexed from.
 * @param kind - The kind of container.
 */
function walkContent(builder: Builder, located: boolean, lines: number, pieces: readonly Piece[], kind: ContainerKind): void {
    builder.place = located ? contentPlace(builder.place, builder.at, lines, pieces, kind) : [];
    builder.at = { line: 0, column: 0 };
    // The place was built from these pieces: their lines are its lines.
    builder.checked = false;
    walkBlocks(builder, pieces);
}

/**
 * Walks a list's items. The items' `raw`s are the list's own text in order,
 * so each starts where the one before it ends; an item whose `raw` is not
 * what the list's holds there is not placed, and no item after it.
 *
 * @param builder - The analysis being built, at the list's start.
 * @param items - The list's items.
 * @param raw - The text the lexer read for the list.
 * @param located - Whether the list is placed.
 */
function walkListItems(builder: Builder, items: readonly Tokens.ListItem[], raw: string, located: boolean): void {
    const place = builder.place;
    let at = builder.at;
    let read = 0;
    let tiles = located;

    for (const item of items) {
        const node = openNode(builder, item.type, item);

        tiles = tiles && raw.startsWith(item.raw, read);

        const span = tiles ? spanAt(place, at, item.raw, false) : null;
        const after = positionAfter(at, item.raw);

        pushBlock(builder, `item:${String(item.task)}:${String(item.checked ?? false)}`);
        builder.place = place;
        builder.at = at;
        builder.taskMarker = span !== null && item.task ? taskMarkerAt(place, at) : null;
        // An item starts a line, so it spans the lines it ends on and before, less the one a closing line end opens.
        walkContent(builder, span !== null, after.line - at.line + (after.column === 0 ? 0 : 1), itemPieces(builder, item), "item");
        builder.taskMarker = null;
        pushBlock(builder, "/item");
        closeNode(builder, node, span);
        at = after;
        read += item.raw.length;
    }
}

/**
 * Walks a `:::` fence: each column in the lines its section of the fence
 * holds. The sections are split as the fence's tokenizer splits them, so
 * column `n` starts one line past the `n`th `|||` line.
 *
 * @param builder - The analysis being built.
 * @param token - The fence token.
 * @param raw - The text the lexer read for it.
 */
function walkFence(builder: Builder, token: MdBlockToken, raw: string): void {
    const signature = `fence:${JSON.stringify(token.attributes)}`;

    walkContainer(builder, token as unknown as Token, raw, signature, (located) => {
        const lines = raw.replace(/\n+$/, "").split("\n");
        const sections = lines.length > 2 ? splitColumnSections(lines.slice(1, -1).join("\n")) : [""];
        const fits = located && sections.length === token.columns.length;
        const place = builder.place;
        const start = builder.at;
        // The fence's opening line comes first.
        let line = 1;

        token.columns.forEach((column, index) => {
            const node = openNode(builder, "column", null);
            const sectionLines = sections[index]?.split("\n").length ?? 0;

            pushBlock(builder, "column");
            builder.place = place;
            builder.at = { line: start.line + line, column: 0 };
            walkContent(builder, fits && lines.length > 2, sectionLines, tiledPieces(builder, column), "column");
            pushBlock(builder, "/column");
            closeNode(builder, node, null);
            // A `|||` line stands between two sections.
            line += sectionLines + 1;
        });
    });
}

/**
 * Walks a table: each header cell inside the header line, each body cell
 * inside its own row's line.
 *
 * @param builder - The analysis being built.
 * @param token - The table token.
 * @param raw - The text the lexer read for it.
 */
function walkTable(builder: Builder, token: MdTableToken, raw: string): void {
    const node = openNode(builder, token.type, token as unknown as Token);
    const span = spanAt(builder.place, builder.at, raw, builder.checked);

    pushBlock(builder, `table:${JSON.stringify(token.align)}:${JSON.stringify(token.widths)}`);

    tableCellRows(token).forEach((cells, index) => {
        // The delimiter row sits between the header (line 0) and the first body row (line 2).
        const line = span === null ? null : builder.place[builder.at.line + (index === 0 ? 0 : index + 1)] ?? null;
        let column = index === 0 ? builder.at.column : 0;

        pushBlock(builder, "row");

        for (const cell of cells) {
            const needle = cell.tokens.map((inline) => inline.raw).join("");
            const indexes = line === null || needle === "" ? null : findInRow(line.text, column, needle);

            pushBlock(builder, cell.signature);
            walkInlineText(builder, cell.tokens, indexes === null ? null : indexes.map((at) => offsetAt(line!, at)), true);
            pushBlock(builder, "/cell");
            column = indexes === null ? column : indexes[indexes.length - 1]!;
        }

        pushBlock(builder, "/row");
    });

    pushBlock(builder, "/table");
    closeNode(builder, node, span);
}

/**
 * Finds a cell's text in its row's line at or after `from`, and maps each of
 * its characters to the index it stands at. The line may write an escaped
 * `\|` where the cell text holds `|`.
 *
 * @param line - The row's line.
 * @param from - Where the search starts.
 * @param needle - The cell's text.
 * @returns Each character's index, then the index past the match; `null` when it is not found.
 */
function findInRow(line: string, from: number, needle: string): number[] | null {
    // The head is the needle up to the first character the line may write differently.
    const head = /^[^|]*/.exec(needle)![0];
    const next = (after: number): number => (head === "" ? after : line.indexOf(head, after));
    let at = next(from);

    while (at !== -1 && at + head.length <= line.length) {
        const map = alignInRow(line, at, needle);

        if (map !== null) {
            return map;
        }

        at = next(at + 1);
    }

    return null;
}

/**
 * Matches a cell's text against its row's line from `at`, passing over the
 * backslash of an escaped `\|`.
 *
 * @param line - The row's line.
 * @param at - Where the match starts.
 * @param needle - The cell's text.
 * @returns The index map, as {@link findInRow} returns it, or `null`.
 */
function alignInRow(line: string, at: number, needle: string): number[] | null {
    const map: number[] = [];
    let index = at;

    for (const char of needle) {
        if (char === "|" && line[index] === "\\" && line[index + 1] === "|") {
            index += 1;
        }

        if (index >= line.length || line[index] !== char) {
            return null;
        }

        map.push(index);
        index += 1;
    }

    map.push(index);

    return map;
}

/** One table cell's inline tokens and its block signature. */
interface TableCellEntry {
    tokens:    Token[];
    signature: string;
}

/**
 * A table's cells, row by row: the header row, then each body row.
 *
 * @param token - The table token.
 * @returns The rows.
 */
function tableCellRows(token: MdTableToken): TableCellEntry[][] {
    return [
        token.header.map((cell) => ({ tokens: cell.tokens, signature: `cell:${String(cell.align)}:1:1` })),
        ...token.rows.map((row) => row.map((cell) => ({
            tokens: cell.tokens, signature: `cell:${String(cell.align)}:${cell.colSpan}:${cell.rowSpan}`,
        }))),
    ];
}

/**
 * Walks a block holding no inline text: records its signature and its span.
 * A task item's checkbox stands where the item's line holds its marker.
 *
 * @param builder - The analysis being built.
 * @param token - The block token.
 * @param raw - The text the lexer read for it.
 */
function walkLeafBlock(builder: Builder, token: Token, raw: string): void {
    const node = openNode(builder, token.type, token);
    const marker = token.type === "checkbox" ? builder.taskMarker : null;

    pushBlock(builder, leafBlockSignature(token));
    closeNode(builder, node, marker === null ? spanAt(builder.place, builder.at, raw, builder.checked) : { start: marker[0]!, end: marker[4]! });
}

/**
 * The signature of a block holding no inline text.
 *
 * @param token - The block token.
 * @returns The signature.
 */
function leafBlockSignature(token: Token): string {
    switch (token.type) {
        case "code": return `code:${(token as Tokens.Code).lang ?? ""}:${(token as Tokens.Code).text}`;
        case "def":  return `def:${(token as Tokens.Def).tag}:${(token as Tokens.Def).href}:${(token as Tokens.Def).title ?? ""}`;
        case "hr":   return "hr";
        default:     return `${token.type}:${token.raw}`;
    }
}

/**
 * Appends a block boundary entry.
 *
 * @param builder - The analysis being built.
 * @param key - The block's signature.
 */
function pushBlock(builder: Builder, key: string): void {
    builder.entries.push({ kind: "block", key, start: -1, end: -1, ancestors: [] });
}

/**
 * The source offset just past the needle characters `[from, to)`, from an
 * offset map.
 *
 * @param map - The offset map.
 * @param from - The first needle index.
 * @param to - The needle index just past the last.
 * @returns The end offset; the start offset when the stretch is empty.
 */
function endOf(map: readonly number[], from: number, to: number): number {
    return to > from ? map[to - 1]! + 1 : map[from]!;
}
```

**5. `walkInlineText`.** In the `inline` section, replace the function and its doc comment with the one below. Nothing else in that section changes: `walkInline`, `walkInlineToken`, `recordInline`, `pushTextLeaves` and `pushAtomLeaves` read the offset map exactly as before.

```ts
/**
 * Walks one run of inline text — the concatenated `raw` of its inline tokens
 * — whose characters stand at `map`.
 *
 * @param builder - The analysis being built.
 * @param tokens - The inline tokens.
 * @param map - Each character's source offset, then the offset past the run; `null` when the run is not placed.
 * @param cell - Whether it is a table cell's text.
 */
function walkInlineText(builder: Builder, tokens: readonly Token[], map: readonly number[] | null, cell: boolean): void {
    if (map !== null) {
        builder.inlineBlocks.push({ start: map[0]!, end: endOf(map, 0, map.length - 1), cell });
    }

    walkInline(builder, tokens, map, 0, []);
}
```

How the pieces fit:

| Name | What it is |
|---|---|
| `PlacedLine` | one line of a text the lexer read, with the source offset of each of its characters: the first few listed in `head`, the rest at `base + index` |
| `Place` | the lines of one such text; `null` for a line that is not placed |
| `Piece` | one stretch of the text a token list was lexed from: a token's `raw`, a dropped definition, or a line end `marked` left out |
| `tiledPieces` | Fact 1: the pieces of a token list, in order |
| `contentPlace`, `placedLine`, `copiedLine` | Fact 2: the place of a container's content, line by line, each line compared |
| `spanAt`, `offsetsAt` | the source span of a `raw`, and the offset of every character of a run of inline text |
| `Builder.place`, `Builder.at` | the place being walked and the position the next token starts at in it |

### `markdownSourceLines.ts` — one index per analysis, maps and searches for the rest

The module is the one `markdown-source-mode-list-lift-parity` leaves. Each edit below replaces a lookup and keeps its answer. The edits were applied by script to that plan's measured module (`proto/markdownSourceLines.ts` of its scratch folder), and every text they replace was found there once.

**1. `allNodes`.** Replace the body, so that listing a tree's nodes does not copy the list once per level:

```ts
/**
 * Every node of a block tree, depth first, in document order.
 *
 * @param nodes - The tree's top-level nodes.
 * @returns The nodes.
 */
function allNodes(nodes: readonly SourceBlockNode[]): SourceBlockNode[] {
    const all: SourceBlockNode[] = [];
    const collect = (list: readonly SourceBlockNode[]): void => {
        for (const node of list) {
            all.push(node);
            collect(node.children);
        }
    };

    collect(nodes);

    return all;
}
```

**2. The line index.** Insert directly above the doc comment of `liftedContainers` (`The quotes and list items a block is lifted out of`):

```ts
/** What the lines of a document hold, by the offset each line starts at. */
interface LineIndex {
    /** The located quotes and list items whose lines include the line, outermost first. */
    readonly containers:    ReadonlyMap<number, SourceBlockNode[]>;
    /** The first located leaf block, in document order, whose lines include the line. */
    readonly leaves:        ReadonlyMap<number, SourceBlockNode>;
    /** The located lists and list items whose first line it is, in document order. */
    readonly listsStarting: ReadonlyMap<number, SourceBlockNode[]>;
    /** The located lists whose last line it is, in document order. */
    readonly listsEnding:   ReadonlyMap<number, SourceBlockNode[]>;
}

/** The line index of each analysis a command asked one of. An analysis never changes, so neither does its index. */
const _lineIndexes = new WeakMap<SourceAnalysis, LineIndex>();

/** No blocks: what a line that holds none of a kind has. */
const NO_NODES: readonly SourceBlockNode[] = [];

/**
 * Reads what each line of a document holds, once for the analysis: one walk
 * of the block tree, each block entered under the lines it spans. A line
 * command asks this of every line of its selection, and looking each line
 * up in the whole tree made a command's cost grow with lines times blocks.
 *
 * @param analysis - The document's analysis.
 * @returns The index.
 */
function lineIndexOf(analysis: SourceAnalysis): LineIndex {
    const known = _lineIndexes.get(analysis);

    if (known !== undefined) {
        return known;
    }

    const text = analysis.text;
    const containers = new Map<number, SourceBlockNode[]>();
    const leaves = new Map<number, SourceBlockNode>();
    const listsStarting = new Map<number, SourceBlockNode[]>();
    const listsEnding = new Map<number, SourceBlockNode[]>();
    const add = (map: Map<number, SourceBlockNode[]>, lineStart: number, node: SourceBlockNode): void => {
        const held = map.get(lineStart);

        if (held === undefined) {
            map.set(lineStart, [node]);
        } else {
            held.push(node);
        }
    };

    for (const node of allNodes(analysis.tree)) {
        if (node.start === -1) {
            continue;
        }

        const first = lineStartAt(text, node.start);
        const last = lineStartAt(text, Math.max(node.start, node.end - 1));
        const isContainer = LIFTED_NODE_TYPES.has(node.type);
        const isLeaf = !CONTAINER_NODE_TYPES.has(node.type);

        if (node.type === "list" || node.type === "list_item") {
            add(listsStarting, first, node);
        }

        if (node.type === "list") {
            add(listsEnding, last, node);
        }

        for (let lineStart = first; (isContainer || isLeaf) && lineStart <= last; lineStart = lineEndAt(text, lineStart) + 1) {
            if (isContainer) {
                add(containers, lineStart, node);
            } else if (!leaves.has(lineStart)) {
                leaves.set(lineStart, node);
            }
        }
    }

    const index: LineIndex = { containers, leaves, listsStarting, listsEnding };

    _lineIndexes.set(analysis, index);

    return index;
}
```

**3. The lookups that use it.** Replace each function whole.

```ts
/**
 * The containers holding a line, outermost first: every located quote and
 * list item whose lines include it.
 *
 * @param analysis - The document's analysis.
 * @param lineStart - The line's start.
 * @returns The containers.
 */
function containersOfLine(analysis: SourceAnalysis, lineStart: number): readonly SourceBlockNode[] {
    return lineIndexOf(analysis).containers.get(lineStart) ?? NO_NODES;
}
```

```ts
/**
 * Whether a line is held by a located block, is blank, or holds container
 * syntax alone — anything else is source no token stands for.
 *
 * @param text - The full document text.
 * @param line - The line.
 * @param leaves - The document's leaf blocks.
 * @returns Whether it is.
 */
function lineIsHeld(text: string, line: SourceLine, held: ReadonlyMap<number, SourceBlockNode>): boolean {
    const content = text.slice(line.start, line.end);

    return CONTAINER_SYNTAX_ONLY.test(content) || held.has(line.start);
}
```

| In | Replace | With |
|---|---|---|
| `readLineTargets` | `if (lines.some((line) => !lineIsHeld(text, line, leaves))) {` | `if (lines.some((line) => !lineIsHeld(text, line, held))) {`, and add `const held = lineIndexOf(analysis).leaves;` on the line after `const leaves = leafNodes(analysis);` |
| `tableInsertionLine` | the statements `const leaves = leafNodes(analysis);` and `let node = leaves.find(…);` (three lines) | `let node = lineIndexOf(analysis).leaves.get(line.start);` |
| `neighbourList` | the statement `const found = at === -1 ? undefined : allNodes(analysis.tree).find(…);` | the three statements below |
| `replacedLines` | its first parameter `text: string` | `analysis: SourceAnalysis`, with `const text = analysis.text;` as the first statement |
| `replacedLines` | the statement `const itemFollows = …;` | the two statements below |
| `itemReplacement`, `itemsApart` | their first parameter `text: string` | `analysis: SourceAnalysis`; inside, pass `analysis` on where `text` was passed to `replacedLines` and `itemReplacement` |
| `listOn` | `itemReplacement(text, run, …)` and `itemsApart(text, plans, …)` in the two `candidates.push` calls | `itemReplacement(analysis, run, …)` and `itemsApart(analysis, plans, …)` |

```ts
// in neighbourList
    const index = lineIndexOf(analysis);
    const lists = (direction === -1 ? index.listsEnding : index.listsStarting).get(at) ?? NO_NODES;

    const found = lists.find((node) => node.type === "list" && (node.parent === null || node.parent.type === "column")
        && columnOf(node) === column);

// in replacedLines
    const itemsBelow = (lineIndexOf(analysis).listsStarting.get(textBelow) ?? NO_NODES).filter((node) => node.type === "list_item");
    const itemFollows = [join.around, join.below].some((list) => list !== null && itemsBelow.some((item) => isAncestor(list, item)));
```

`containersOfLine` now returns `readonly SourceBlockNode[]`. Its three callers only read the array (`findLastIndex`, `slice`, `filter`), so no caller changes.

**4. Leaves and targets.** Replace `targetOfEntry` whole, and use it in `expectedItemLeaves`.

```ts
/**
 * Maps each leaf of a document to the target block holding it. A task
 * item's marker belongs to the item's text ({@link firstEntryOf}).
 *
 * @param targets - The target blocks.
 * @returns A lookup from a leaf's entry index to its target's index, `-1` for none.
 */
function targetOfEntry(targets: readonly SourceBlockNode[]): (entry: number) => number {
    const owner = new Map<number, number>();

    // The first target that holds an entry is its target: the later ones are entered first, so an earlier one overwrites them.
    for (let index = targets.length - 1; index >= 0; index -= 1) {
        const target = targets[index]!;

        for (let entry = firstEntryOf(target); entry < target.entryEnd; entry += 1) {
            owner.set(entry, index);
        }
    }

    return (entry) => owner.get(entry) ?? -1;
}
```

| In | Replace | With |
|---|---|---|
| `expectedItemLeaves` | `const index = plans.findIndex((plan) => firstEntryOf(plan.target) <= leaf.entry && leaf.entry < plan.target.entryEnd);` | `const index = planOf(leaf.entry);`, and add `const planOf = targetOfEntry(plans.map((plan) => plan.target));` on its own line before the `return expectLeaves(…)` statement that holds it |
| `convertBlocks` | `const own = leaves.find((leaf) => leaf.entry === target.entryStart);` | `const own = leafAt.get(target.entryStart);`, and add `const leafAt = new Map(leaves.map((leaf) => [leaf.entry, leaf]));` on the line before `const wildcardPaths = …` |

**5. Lifts.** Replace the `LiftPlan` interface, `planLifts` and `liftBefore` whole, add `countWhile` after `planLifts`, and replace one statement of `instanceId`. Then delete `holdsEntry` and its doc comment (`Whether a leaf at an entry lies inside a block.`): `liftBefore` was its one caller, and `npm run typecheck` reports it unused once `liftBefore` is replaced.

```ts
/** The lifts of one command, with the document's blocks by entry. */
interface LiftPlan {
    /** The lifts in document order: each one's entries start and end after those of the one before it. */
    readonly lifts:       readonly PlannedLift[];
    readonly nodeAt:      ReadonlyMap<number, SourceBlockNode>;
    /** For each outermost list item of a lift, by the entry it opens on, the positions in `lifts` of the lifts it holds, in order. */
    readonly byOutermost: ReadonlyMap<number, number[]>;
}
```

```ts
/**
 * Plans the lifts of one command.
 *
 * @param analysis - The document's analysis.
 * @param lifts - The lifts, in document order.
 * @returns The plan.
 */
function planLifts(analysis: SourceAnalysis, lifts: readonly Lift[]): LiftPlan {
    const planned = lifts.map((lift) => {
        const items = liftedItems(lift.node);

        return { ...lift, items, closedAt: new Set(items.map((item) => item.entryStart)), wrapper: wrapperItemAfter(lift.node) };
    });
    const byOutermost = new Map<number, number[]>();

    planned.forEach((lift, position) => {
        const outermost = lift.items[0];

        if (outermost !== undefined) {
            const held = byOutermost.get(outermost.entryStart) ?? [];

            held.push(position);
            byOutermost.set(outermost.entryStart, held);
        }
    });

    return { lifts: planned, nodeAt: nodesByEntry(analysis), byOutermost };
}
```

```ts
/**
 * Counts the leading members of a sorted list that a test holds for: the
 * test must hold for a run at the list's start and for nothing after it.
 *
 * @param length - The list's length.
 * @param holds - Whether the test holds for the member at an index.
 * @returns The count.
 */
function countWhile(length: number, holds: (index: number) => boolean): number {
    let low = 0;
    let high = length;

    while (low < high) {
        const middle = (low + high) >> 1;
        const held = holds(middle);

        if (held) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }

    return low;
}
```

```ts
/**
 * The lift whose tail or re-opened item a leaf stands in: the last lifted
 * block before the leaf whose outermost list item holds the leaf.
 *
 * @param leaf - The leaf.
 * @param plan - The lifts.
 * @returns The lift, or `undefined` for a leaf no lift moves.
 */
function liftBefore(leaf: LeafView, plan: LiftPlan): PlannedLift | undefined {
    let last = -1;

    // A list item holds the leaf exactly when the entry it opens on is one of the leaf's holders.
    for (const holder of leaf.holders) {
        const positions = plan.byOutermost.get(holder);

        if (positions !== undefined) {
            const before = countWhile(positions.length, (index) => plan.lifts[positions[index]!]!.node.entryEnd <= leaf.entry);

            last = before === 0 ? last : Math.max(last, positions[before - 1]!);
        }
    }

    return last === -1 ? undefined : plan.lifts[last];
}
```

```ts
// in instanceId, in place of `const splits = plan.lifts.filter(…).length;`
    const end = Math.min(container.entryEnd, leaf.entry);
    // The lifts are in document order, so those inside the container that end by the leaf are one run of them.
    const before = countWhile(plan.lifts.length, (index) => plan.lifts[index]!.node.entryStart <= container.entryStart);
    const through = countWhile(plan.lifts.length, (index) => plan.lifts[index]!.node.entryEnd <= end);
    const splits = Math.max(through - before, 0);
```

Both searches rest on one property: `plan.lifts` is in document order and no lifted block holds another, so `entryStart` and `entryEnd` both grow along the list. `planLifts` is given the targets in the order `readLineTargets` found them, which is document order.

**6. Replacements and wildcards.** Add the two functions below, `replacementsByFirstLine` directly above the doc comment of `liftedRegionEnd` and `wildcardAt` directly above the doc comment of `sameHolders`.

```ts
/**
 * The replacements by the line each one starts at; the first of two that
 * start at one line.
 *
 * @param replacements - The replacements.
 * @returns The map.
 */
function replacementsByFirstLine(replacements: readonly LineReplacement[]): Map<number, LineReplacement> {
    const startingAt = new Map<number, LineReplacement>();

    for (const replacement of replacements) {
        const taken = startingAt.has(replacement.first);

        if (!taken) {
            startingAt.set(replacement.first, replacement);
        }
    }

    return startingAt;
}
```

```ts
/**
 * The wildcard range an offset stands in. The ranges are in document order
 * and none overlaps another, so the last one that starts at or before the
 * offset is the only one that can hold it.
 *
 * @param wildcards - The ranges.
 * @param offset - The offset.
 * @returns The range, or `undefined`.
 */
function wildcardAt(wildcards: readonly WildcardRange[], offset: number): WildcardRange | undefined {
    const before = countWhile(wildcards.length, (index) => wildcards[index]!.from <= offset);
    const range = before === 0 ? undefined : wildcards[before - 1];

    return range !== undefined && offset < range.to ? range : undefined;
}
```

| In | Replace | With |
|---|---|---|
| `liftLines` and `liftLinesWithTail` (once in each) | `const replacement = replacements.find((candidate) => candidate.first === lineStart);` | `const replacement = startingAt.get(lineStart);`, and add `const startingAt = replacementsByFirstLine(replacements);` on the line after `const regionEnd = liftedRegionEnd(text, replacements);` |
| `readsAsExpected` | `const wildcard = wildcards.find((range) => range.from <= leaf.offset && leaf.offset < range.to);` | `const wildcard = wildcardAt(wildcards, leaf.offset);` |

`leafNodes` stays: `readLineTargets` still walks the leaf blocks once to classify them.

---

## Ordered Implementation Steps

Run every command from `packages/lib`. Never run `npm install`, `npm ci` or `npm update`. The scratch folder is `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans4/locator-revision/`. It is not in the repository. It holds:

| In the scratch folder | What it is |
|---|---|
| `proto/markdownExtensions.loc.ts`, `proto/markdownSourceTokens.loc.ts`, `proto/markdownSourceLines.loc.ts` | the three modules as measured, under their own import paths; the code of `## Internal Structure` was taken from them |
| `proto/zz-loc-tokens.ts`, `proto/zz-loc-lines.ts` | the same two editor modules for the equivalence run; `zz-loc-lines.ts` imports `./zz-loc-tokens` |
| `base/` | the four modules as the plans of `depends-on` leave them: what step 1 compares with |
| `snip/*.txt` | the test code of `## Expected Behaviour`, as files; `applytests.py` wrote them into the copy's test files |
| `mkbase.sh`, `runimpl.sh`, `probes-impl/`, `docs-sets.json`, `sumcounts.py` | the probes of `## Verification` and their runner |
| `repo/` | the private copy the numbers were measured in, with its own `node_modules/marked` 18.1.0 |
| `PROGRESS.md`, `out/`, `logs/` | the planner's log and measured outputs |

Use the files to check your edits against, not in place of them.

1. **Check the base.**
   - `node -p "require('marked/package.json').version"` prints `18.1.0`.
   - `npx vitest run tests/component/markdown-editor.test.ts tests/component/markdown-source-edits.test.ts tests/component/display/markdownLexer.test.ts` is green.
   - `git diff 736452bbc -- src/typescript/lib/component/editor/markdownSourceTokens.ts` shows what the plans of `depends-on` changed in the analysis. This plan expects nothing between the section comments `source search` and `inline`, and nothing in `walkInlineText`. If something changed there, stop and report.
   - `diff src/typescript/lib/component/editor/markdownSourceLines.ts <scratch>/base/markdownSourceLines.ts`. If one of these differs, stop and report: `allNodes`, `holdsEntry`, `containersOfLine`, `lineIsHeld`, `readLineTargets`, `tableInsertionLine`, `neighbourList`, `replacedLines`, `itemReplacement`, `itemsApart`, `listOn`, `targetOfEntry`, `expectedItemLeaves`, `convertBlocks`, `LiftPlan`, `planLifts`, `liftBefore`, `instanceId`, `liftLines`, `liftLinesWithTail`, `readsAsExpected`. The edits of this plan were measured against those bodies.
   - `grep -n "withPrefixTabsAsSpaces\|containerPrefixEnd\|MARKDOWN_TAB_STOP\|TABBED_LINE_END" src/typescript/lib/component/display/markdownExtensions.ts` finds all four, and `diff` of the file with `<scratch>/base/markdownExtensions.ts` shows nothing in `withPrefixTabsAsSpaces` or `containerPrefixEnd`: `markdown-tab-column-parity` is in as measured.

2. **Keep the base for the differential.** `<scratch>/mkbase.sh "$PWD"` copies the three modules into `tests/component/` as `zz-base-tokens.ts`, `zz-base-lines.ts` and `zz-base-edits.ts`. Do this before any source edit.

3. **Change the rows** of `tests/component/markdown-editor.test.ts` and `tests/component/markdown-source-edits.test.ts`, as `## Expected Behaviour` says.

4. **See the rows fail.** `npx vitest run tests/component/markdown-editor.test.ts tests/component/markdown-source-edits.test.ts`. Exactly 45 tests fail; `### What is red before the code` lists them. If another test fails, or one of these does not, stop and report.

5. **`markdownExtensions.ts`**, as `## Internal Structure` gives it, and the rows `LX40` to `LX44` in `tests/component/display/markdownLexer.test.ts`. Check: `npm run typecheck`; `npx vitest run tests/component/display/markdownLexer.test.ts` is green; `npx vitest run tests/component/markdown-roundtrip` is green (the recorder changes no token).

6. **`markdownSourceTokens.ts`**, the five edits in order. The result is `<scratch>/proto/markdownSourceTokens.loc.ts`; `diff` the two. Check: `npm run typecheck` is clean. `grep -n "findAligned\|alignAt\|locateRaw\|builder.cursor\|CONTAINER_PREFIX_CHARACTERS" src/typescript/lib/component/editor/markdownSourceTokens.ts` finds nothing. `grep -n "indexOf(" src/typescript/lib/component/editor/markdownSourceTokens.ts` finds eight lines: five that search for a line end (`"\n"`), the backslash of an escaped `|||` line in `copiedLine`, a cell's text in `findInRow`, and `raw.indexOf(content)` in `contentOffset`, which was there before. None searches the document for a block.

7. **`markdownSourceLines.ts`**, the six edits in order. The result is `<scratch>/proto/markdownSourceLines.loc.ts`; `diff` the two. Check: `npm run typecheck` is clean. `grep -n "allNodes(analysis.tree)" src/typescript/lib/component/editor/markdownSourceLines.ts` finds three lines: in `nodesByEntry`, `leafNodes` and `lineIndexOf`. `grep -n "replacements.find\|plan.lifts.filter\|plan.lifts.findLast\|targets.findIndex\|plans.findIndex\|wildcards.find\|holdsEntry" src/typescript/lib/component/editor/markdownSourceLines.ts` finds nothing.

8. **See the rows pass.** The command of step 4 is green, and so is the whole of `tests/component/display/markdownLexer.test.ts`.

9. **Run the differential, the exactness check, the spaces-form check and the cost check** of `## Verification`. Every hard check is 0. Run at most two Vitest processes at a time.

10. **Clean up.** Delete every `zz-*` file from `tests/` (`find tests -name 'zz-*' -delete`) and commit none of them. The probes use Node's `fs` and `process`, so `npm run typecheck:test` fails while they are in the tree.

11. **Docs and changelog**, as `## Documentation Impact` says.

12. **Full checks.** `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, `npm test`, `npm run docs:api`, `npm run docs:llms:check`, `npm run build:lib`.

13. **Manual checks**, as `### Manual checks` says.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceTokens.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts` |
| Modify | `packages/lib/tests/component/display/markdownLexer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-edits.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Everything here is unit-testable but `### Manual checks`. Each test below was run against the prototype (green) and against the base (red where the table says so).[^tests] The rows go into the test files as `markdown-source-mode-list-lift-parity` leaves them.

### Rows of `markdown-editor.test.ts`

**The `DIFFERS` table.** Delete the three rows `E25`, `E26` and `E27`, and the two comment lines above them, which `markdown-source-mode-list-lift-parity` wrote: `// A block or a nested list indented with a tab, which source mode does not find: the block itself, and the` and `// block before such a list in the item.` No row is left under that comment.

**The `CASES` table of `describe('MarkdownEditor source-mode line commands read the viewer's blocks')`.** Add these rows directly after the row `E19 UL: an item whose marker a tab follows lets its tab-indented block leave the list with its text`, which `markdown-source-mode-list-lift-parity` adds:

```ts
        {
            name: 'E25 UL: a list toggle acts on a block of an item that a tab indents', doc: '- one\n\n\tsecond\n- two', select: [9, 9],
            run: (editor) => editor.toggleUnorderedList(), result: '- one\n\n- second\n- two',
        },
        {
            name: 'E25 h2: a heading from a block of an item that a tab indents', doc: '- one\n\n\tsecond\n- two', select: [9, 9],
            run: (editor) => editor.setBlockType('h2'), result: '- one\n\n## second\n- two',
        },
        {
            name: 'E26 UL: a list toggle acts on an item of a nested list that a tab indents', doc: '- one\n\t- nested\n- two', select: [10, 10],
            run: (editor) => editor.toggleUnorderedList(), result: '- one\n\nnested\n\n- two',
        },
        {
            name: 'E26 h2: a heading from an item of a nested list that a tab indents', doc: '- one\n\t- nested\n- two', select: [10, 10],
            run: (editor) => editor.setBlockType('h2'), result: '- one\n## nested\n- two',
        },
        {
            name: 'E27 UL: the nested list a tab indents stays in the list, re-opened by the item\'s marker, the tab written as spaces', doc: '- one\n\t- nested\n- two', select: [3, 3],
            run: (editor) => editor.toggleUnorderedList(), result: 'one\n-   - nested\n- two',
        },
        {
            name: 'a paragraph command declines on a block of an item that a tab indents', doc: '- one\n\n\tsecond\n- two', select: [9, 9],
            run: (editor) => editor.setBlockType('paragraph'), result: '- one\n\n\tsecond\n- two',
        },
        {
            name: 'a numbered toggle acts on a task item whose marker a tab follows', doc: '- [ ]\ttask\n- two', select: [7, 7],
            run: (editor) => editor.toggleOrderedList(), result: '1. [ ] task\n- two',
        },
```

**The `CASES` table of `describe('MarkdownEditor source-mode commands read the viewer's tokens')`.** Add these rows at the end of the table:

```ts
        {
            name: 'bold acts in a block of a list item that a tab indents', doc: '- one\n\n\tsecond para\n- two', select: 'second',
            run: (editor) => editor.toggleBold(), result: '- one\n\n\t**second** para\n- two',
        },
        {
            name: 'a link over a whole tab-indented line keeps the tab', doc: '- one\n\n\tsecond para\n- two', select: [7, 19],
            run: (editor) => editor.toggleLink('https://x.test/'), result: '- one\n\n\t[second para](https://x.test/)\n- two',
        },
        {
            name: 'bold acts on text that a repeated definition above it also holds', doc: '[w]: u\n[w]: v\n\nw', select: [15, 16],
            run: (editor) => editor.toggleBold(), result: '[w]: u\n[w]: v\n\n**w**',
        },
        {
            name: 'bold acts on a heading whose text is its own marker character', doc: '# # #', select: [2, 3],
            run: (editor) => editor.toggleBold(), result: '# **#** #',
        },
```

### Tests of `markdown-source-edits.test.ts`

Add to the imports:

```ts
import { analyzeMarkdownSource } from '~/component/editor/markdownSourceTokens';
import type { SourceAnalysis, SourceBlockNode } from '~/component/editor/markdownSourceTokens';
```

**In `describe('line commands act on the blocks the viewer reads')`.** Replace the test `S2. declines on an item of a list in a quote whose markers a tab after the quote marker indents`, with the comment above it, by the first block below. Add the three tests of the second block directly after it.

```ts
    // The tab after `>` is three columns wide here, so the list's markers stand indented by two inside the quote. Each item is
    // placed on its own line, and a command on it acts as on a list whose markers a space follows.
    it('S2. acts on an item of a list in a quote whose markers a tab after the quote marker indents', () => {
        const quoted = '>\t- a\n>\t- b';

        expect(apply(quoted, blockPrefixSource('## ')(quoted, 4, 4)!)).toBe('## a\n>\t- b');
        expect(apply(quoted, listSource('unordered')(quoted, 4, 4)!)).toBe('a\n>\t- b');
        expect(apply(quoted, listSource('unordered')(quoted, 10, 10)!)).toBe('>\t- a\n\nb');
    });
```

```ts
    it('acts on a block of a list item that a tab indents, and keeps the tab where the block stays', () => {
        const doc = '- one\n\n\tsecond para\n- two';

        expect(apply(doc, BOLD_SOURCE(doc, 8, 14)!)).toBe('- one\n\n\t**second** para\n- two');
        expect(apply(doc, linkSource('/u')(doc, 7, 19)!)).toBe('- one\n\n\t[second para](/u)\n- two');
        expect(apply(doc, blockPrefixSource('## ')(doc, 9, 9)!)).toBe('- one\n\n## second para\n- two');
        expect(apply(doc, listSource('unordered')(doc, 9, 9)!)).toBe('- one\n\n- second para\n- two');
        // The tab ran to column 4 and the item took two of its columns: the code keeps the other two, as spaces.
        expect(apply(doc, FENCED_CODE_SOURCE(doc, 9, 9)!)).toBe('- one\n\n```\n  second para\n```\n- two');
        // The block stays a paragraph of its item: the tab could only be kept by leaving the line as it is.
        expect(blockPrefixSource('')(doc, 9, 9)).toBeNull();
    });

    it('acts on the line the caret is on when a later line says the same', () => {
        const doc = '- one\n\n\tsame\n\n  same\n- two';

        expect(apply(doc, BOLD_SOURCE(doc, 8, 12)!)).toBe('- one\n\n\t**same**\n\n  same\n- two');
        expect(apply(doc, BOLD_SOURCE(doc, 16, 20)!)).toBe('- one\n\n\tsame\n\n  **same**\n- two');
    });

    it('declines on a selection that takes in a repeated definition, which no block holds', () => {
        const doc = 'word\n\n[w]: u\n[w]: v\n\nw';

        expect(blockPrefixSource('## ')(doc, 0, 15)).toBeNull();
        expect(apply(doc, blockPrefixSource('## ')(doc, 21, 21)!)).toBe('word\n\n[w]: u\n[w]: v\n\n## w');

        // The base put `w` on the repeated definition's line, counted that line as held and turned the heading into text.
        const below = '[w]: u\n\n# h\n\n[w]: v\n\nw';

        expect(blockPrefixSource('')(below, 8, 14)).toBeNull();
        expect(apply(below, blockPrefixSource('')(below, 8, 12)!)).toBe('[w]: u\n\nh\n\n[w]: v\n\nw');
    });
```

**At the end of the file**, add the helper and the two `describe` blocks below. The first table pins where blocks are placed. The second pins the cost without a clock, the way `describe('one lex scans a number of characters proportional to the document')` does in [markdownLexer.test.ts:891](../packages/lib/tests/component/display/markdownLexer.test.ts#L891) (line 960 once `markdown-tab-column-parity` is in): it counts the array elements a command hands to scans, for a document and for one eight times as long.[^worktest]

```ts
/**
 * Writes where an analysis places each block: `type from-to`, the blocks it holds in brackets, `type ?` for a block that
 * is not placed. A `:::` column has no place of its own.
 *
 * @param analysis - The analysis.
 * @returns The outline.
 */
function placedOutline(analysis: SourceAnalysis): string {
    const one = (node: SourceBlockNode): string => {
        const span = node.start === -1 ? '?' : `${node.start}-${node.end}`;
        const inner = node.children.length === 0 ? '' : ` [${node.children.map(one).join(', ')}]`;

        return node.type === 'column' ? `column${inner}` : `${node.type} ${span}${inner}`;
    };

    return analysis.tree.map(one).join(', ');
}

describe('source analysis places each block on the lines it stands on', () => {
    /** [name, document, the placed outline, the spans of its runs of inline text] */
    const PLACES: Array<[name: string, doc: string, outline: string, runs: Array<[number, number]>]> = [
        [
            'P1: a block of a list item that a tab indents', '- one\n\n\tsecond para\n- two',
            'list 0-25 [list_item 0-19 [paragraph 2-5, paragraph 7-19], list_item 20-25 [paragraph 22-25]]', [[2, 5], [7, 19], [22, 25]],
        ],
        [
            'P2: a nested list that a tab indents', '- one\n\t- nested\n- two',
            'list 0-21 [list_item 0-15 [text 2-5, list 6-15 [list_item 6-15 [text 9-15]]], list_item 16-21 [text 18-21]]', [[2, 5], [9, 15], [18, 21]],
        ],
        [
            'P3: code indented by two tabs in a list item', '- Step one:\n\n\t\tmake install\n\t\tmake more\n- next\n\nlast',
            'list 0-46 [list_item 0-39 [paragraph 2-11, code 13-39], list_item 40-46 [paragraph 42-46]], paragraph 48-52', [[2, 11], [42, 46], [48, 52]],
        ],
        ['P4: a thematic break under a setext heading', 'alpha\n---\n\n---', 'heading 0-9, hr 11-14', [[0, 5]]],
        ['P5: text that a repeated definition above it also holds', '[w]: u\n[w]: v\n\nw', 'def 0-6, paragraph 15-16', [[15, 16]]],
        [
            'P6: a code line that an earlier code line holds', '- a\n\n  \t  ```\n\n\t```',
            'list 0-19 [list_item 0-19 [paragraph 2-3, code 7-13, code 15-19]]', [[2, 3]],
        ],
        [
            'P7: a task marker a tab follows', '- [ ]\ttask\n- [ ]  two',
            'list 0-21 [list_item 0-10 [checkbox 2-6, text 6-10], list_item 11-21 [checkbox 13-17, text 18-21]]', [[6, 10], [18, 21]],
        ],
        [
            'P8: an empty item above a marker look-alike', 'beta\n---\n\n-\n\n  3. delta',
            'heading 0-8, list 10-11 [list_item 10-11], list 13-23 [list_item 13-23 [text 18-23]]', [[0, 4], [18, 23]],
        ],
        [
            'P9: a quote holding a table on lazy lines', '> alpha\n| h |\n| --- |\n| beta |',
            'blockquote 0-30 [paragraph 2-7, mdtable 8-30]', [[2, 7], [10, 11], [24, 28]],
        ],
        [
            'P10: a list ending a quote on whitespace, a lazy line after it', '- x\n\n  > - same\t\n  same',
            'list 0-23 [list_item 0-23 [paragraph 2-3, blockquote 7-23 [list 9-15 [list_item 9-15 [text 11-15]], paragraph 19-23]]]', [[2, 3], [11, 15], [19, 23]],
        ],
        [
            'P11: a repeated definition inside a list item', '- a\n\n  [w]: u\n\n  [w]: u\n\n  w',
            'list 0-28 [list_item 0-28 [paragraph 2-3, def 7-13, paragraph 27-28]]', [[2, 3], [27, 28]],
        ],
        [
            'P12: a column whose list ends on whitespace', '::: columns\n- a\n  b\t\n|||\nc\n:::',
            'mdblock 0-30 [column [list 12-19 [list_item 12-19 [text 14-19]]], column [paragraph 25-26]]', [[14, 19], [25, 26]],
        ],
        [
            'P13: a tab in a list item\'s text, past its indentation', '- a\n\n  b\tc\n- d',
            'list 0-14 [list_item 0-10 [paragraph 2-3, paragraph 7-10], list_item 11-14 [paragraph 13-14]]', [[2, 3], [7, 10], [13, 14]],
        ],
        [
            'P14: the same line twice, behind a tab and behind spaces', '- one\n\n\tsame\n\n  same\n- two',
            'list 0-26 [list_item 0-20 [paragraph 2-5, paragraph 7-12, paragraph 16-20], list_item 21-26 [paragraph 23-26]]', [[2, 5], [7, 12], [16, 20], [23, 26]],
        ],
        [
            'P15: a quote in a list item, a tab after its marker', '- a\n\n  >\tb\n  > c',
            'list 0-16 [list_item 0-16 [paragraph 2-3, blockquote 7-16 [paragraph 9-16]]]', [[2, 3], [9, 16]],
        ],
        ['P16: a heading whose text is its own marker character', '# # #', 'heading 0-5', [[2, 3]]],
    ];

    for (const [name, doc, outline, runs] of PLACES) {
        it(name, () => {
            const analysis = analyzeMarkdownSource(doc);

            expect(placedOutline(analysis)).toBe(outline);
            expect(analysis.inlineBlocks.map((run) => [run.start, run.end])).toEqual(runs);
        });
    }

    it('reads the format at a caret in a block that a tab indents', () => {
        const doc = '- one\n\n\t**second** para\n- two';

        expect(readSourceSelectionState(doc, 12, 12).bold).toBe(true);
        expect(readSourceSelectionState(doc, 20, 20).bold).toBe(false);
    });
});

/** The array methods that hand each element of an array to a callback or a comparison. */
const ARRAY_SCANS = ['filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every', 'flatMap', 'map', 'forEach', 'indexOf', 'includes'] as const;

/**
 * The ratio the cost cases allow between a document eight times as long and the shorter one. Linear growth is 8; 10 leaves
 * room for fixed work and admits nothing that grows with lines times blocks, which scores 48 or more here.
 */
const LINEAR_GROWTH_BOUND = 10;

/**
 * Runs `run` and counts the array elements it hands to scans: what a command that looks every block up for every line
 * spends its time on.
 *
 * @param run - The work to measure.
 * @returns The number of elements scanned.
 */
function scannedElements(run: () => unknown): number {
    const arrays = Array.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
    const saved = ARRAY_SCANS.map((name) => arrays[name]!);
    let scanned = 0;

    ARRAY_SCANS.forEach((name, index) => {
        arrays[name] = function (this: unknown[], ...args: unknown[]): unknown {
            scanned += this.length;

            return saved[index]!.apply(this, args);
        };
    });

    try {
        run();
    } finally {
        ARRAY_SCANS.forEach((name, index) => {
            arrays[name] = saved[index]!;
        });
    }

    return scanned;
}

describe('a source-mode command does work proportional to the document', () => {
    const pad = (depth: number): string => '  '.repeat(depth);
    /** Documents of about `lines` lines. */
    const DOCUMENTS: Array<[name: string, make: (lines: number) => string]> = [
        ['headings and paragraphs', (lines) => Array.from({ length: Math.ceil(lines / 5) }, (_, i) => `## Heading ${i}\n\nParagraph ${i} line one\nline two of ${i}\n`).join('\n')],
        ['a list eight levels deep', (lines) => Array.from({ length: Math.ceil(lines / 10) }, (_, unit) => Array.from({ length: 8 }, (_x, depth) => `${pad(depth)}- item ${unit}.${depth}`).join('\n') + `\n\n${pad(8)}held ${unit}`).join('\n')],
        ['a loose list whose items hold a paragraph', (lines) => Array.from({ length: Math.ceil(lines / 4) }, (_, i) => `- item${i}\n\n  held${i}`).join('\n\n')],
    ];
    const COMMANDS: Array<[name: string, run: (text: string, from: number, to: number) => MarkdownSourceEdit | null]> = [
        ['the bulleted toggle', listSource('unordered')], ['the numbered toggle', listSource('ordered')], ['a heading', blockPrefixSource('## ')],
        ['a paragraph', blockPrefixSource('')], ['a quote', blockPrefixSource('> ')], ['a code fence', FENCED_CODE_SOURCE],
    ];

    for (const [documentName, make] of DOCUMENTS) {
        // 100 and 800 lines: eight times as long.
        const small = make(100);
        const large = make(800);

        it(`${documentName}: analysing grows at most ${LINEAR_GROWTH_BOUND}x for an 8x longer document`, () => {
            // A space appended, so that the cached analysis of the same text does not answer.
            expect(scannedElements(() => analyzeMarkdownSource(`${large} `))).toBeLessThanOrEqual(LINEAR_GROWTH_BOUND * scannedElements(() => analyzeMarkdownSource(`${small} `)));
        });

        for (const [commandName, command] of COMMANDS) {
            it(`${documentName}: ${commandName} over everything grows at most ${LINEAR_GROWTH_BOUND}x for an 8x longer document`, () => {
                expect(command(small, 0, small.length)).not.toBeNull();
                expect(scannedElements(() => command(large, 0, large.length))).toBeLessThanOrEqual(LINEAR_GROWTH_BOUND * scannedElements(() => command(small, 0, small.length)));
            });
        }
    }
});
```

### Rows of `markdownLexer.test.ts`

Replace the import of `markdownExtensions` with the first block and add the second at the end of the file.

```ts
import {
    droppedDefinitions, droppedDefinitionsAfter, lexMarkdown, lexMarkdownUnbounded, prefixTabsAsSpacesWithIndexes, type MdBlockToken,
} from '~/component/display/markdownExtensions';
```

```ts
describe('the lexer records the definitions it reads and keeps no token for', () => {
    it('LX40: a repeated definition is recorded under the token before it, where that token\'s raw then stood', () => {
        const tokens = lexMarkdown('[a]: x\n[a]: y\n\npara');

        expect(tokens.map((token) => token.type)).toEqual(['def', 'space', 'paragraph']);
        expect(droppedDefinitions(tokens)).toBe(true);
        expect(droppedDefinitionsAfter(tokens[0]!)).toEqual([{ raw: '[a]: y', at: 7 }]);
        expect(droppedDefinitionsAfter(tokens)).toEqual([]);
    });

    it('LX41: one inside a list item is recorded under a token of that item', () => {
        const tokens = lexMarkdown('- a\n\n  [w]: u\n\n  [w]: u\n\n  w');
        const item = (tokens[0] as Tokens.List).items[0]!;

        expect(droppedDefinitions(tokens)).toBe(true);
        expect(item.tokens.map((token) => [token.type, droppedDefinitionsAfter(token)])).toEqual([
            ['paragraph', []], ['space', []], ['def', []], ['space', [{ raw: '[w]: u', at: 2 }]], ['space', []], ['paragraph', []],
        ]);
    });

    it('LX42: a document that repeats no definition records nothing, and a definition joined to a paragraph is no drop', () => {
        expect(droppedDefinitions(lexMarkdown('[a]: x\n\npara [a]'))).toBe(false);
        expect(droppedDefinitions(lexMarkdown('- text\n  [a]: x\n  [a]: x'))).toBe(false);
    });

    it('LX43: recording changes no token', () => {
        const source = '[a]: x\n[a]: y\n\n- one\n  [a]: z\n\n> [a]: q\n\npara [a]';

        expect(lexMarkdown(source)).toEqual(lexMarkdownUnbounded(source));
        expect(lexMarkdown(source).map((token) => token.raw).join('')).toBe('[a]: x\n\n\n- one\n  [a]: z\n\n> [a]: q\n\npara [a]');
    });
});

describe('a line\'s container prefix read with its tabs as spaces tells where each character stands', () => {
    for (const [line, text, indexes, end] of [
        ['\t- x', '    - x', [0, 0, 0, 0, 1, 2], 3],
        ['  \tb\tc', '    b\tc', [0, 1, 2, 2], 3],
        ['>\t- [ ]\ta', '>   - [ ]   a', [0, 1, 1, 1, 2, 3, 4, 5, 6, 7, 7, 7], 8],
        ['no tab', 'no tab', [], 0],
        // Whitespace that holds a tab and ends the line after a marker is one space, standing for its first character.
        ['  -\t', '  - ', [0, 1, 2], 3],
    ] as const) {
        it(`LX44: ${JSON.stringify(line)}`, () => {
            expect(prefixTabsAsSpacesWithIndexes(line)).toEqual({ text, indexes, end });
        });
    }
});
```

### What is red before the code

After step 3 and before step 5, 45 tests fail:

| File | Red | Which |
|---|---|---|
| `markdown-editor.test.ts` | 10 | the six line-command rows `E25 UL`, `E25 h2`, `E26 UL`, `E26 h2`, `E27 UL`, `a numbered toggle acts on a task item whose marker a tab follows`; the four inline rows |
| `markdown-source-edits.test.ts` | 35 | `S2`; the three tests after it; rows `P1` to `P8`, `P11`, `P14`, `P15`, `P16`; `reads the format at a caret in a block that a tab indents`; the 18 command cost tests |

These are green before and after, and pin what must not change: `a paragraph command declines on a block of an item that a tab indents`; rows `P9`, `P10`, `P12` and `P13`; the three `analysing grows at most` cost tests. The rows `LX40` to `LX44` cannot be written before step 5, since they import what that step adds.

### What does not change

- **Results where the base placed every block right.** The same code runs on the same places, so the edit is the same. Measured: see `## Verification`.
- **Bytes.** A command writes what it wrote before. An inline command changes no line's indentation or quote markers; the differential checks it (`H6`).
- **Undo.** A source-mode command is one transform, one edit and one `CodeEditor` change, as before. No wiring is touched.
- **The `can…` fields**, the WYSIWYG surface, the viewer, and what `lexMarkdown` returns.

### Manual checks

Needs manual verification, in a browser on the demo's MD Editor page (`npx vite` in `packages/lib`), in source mode. Type a real tab where `→` stands.

| # | Text | Action | Expect |
|---|---|---|---|
| B1 | `- one`, blank, `→second para`, `- two` | select `second`; **Bold** | `→**second** para`, the tab still there; one Ctrl+Z gives the text back |
| B2 | the same | caret on `second`; **Insert ▸ Bulleted list** | `- one`, blank, `- second para`, `- two` |
| B3 | `- one`, `→- nested`, `- two` | caret on `nested`; **Insert ▸ Bulleted list** | `- one`, blank, `nested`, blank, `- two` |
| B4 | a list of several thousand items (paste one) | Ctrl+A; context menu ▸ **Block style ▸ Heading 2** | the result appears without a pause of seconds; Ctrl+Z gives the list back |
| B5 | B2's result | switch to WYSIWYG | three list items, as the viewer shows them |
| B6 | B3's text | caret on `one`; **Insert ▸ Bulleted list** | `one`, then `-`, three spaces and `- nested`, then `- two`; the tab is gone |

---

## Verification

1. `npm run typecheck`, `npm run typecheck:test`, `npm run lint`: clean (after step 10; the probes do not typecheck).
2. `npm test`: green. Against the base the count grows by 58: 7 line-command `CASES` rows less the 3 `DIFFERS` rows deleted, 4 inline `CASES` rows, 3 tests after `S2`, 16 `P` rows, 1 state test, 21 cost tests, and the 9 `LX` tests (`LX40` to `LX43`, and `LX44` for each of its five lines). On the measured copy the whole suite is 591 files and 20,254 tests, 2 of them `todo`.
3. `npm run docs:api`, `npm run docs:llms:check`, `npm run build:lib`.

4. **The differential against the base.** The probes are in the scratch folder under `probes-impl/`. They compare the copies step 2 made (`zz-base-*.ts`) with the modules themselves, in one process. `runimpl.sh` copies a probe and its helpers into the tests tree, runs it and removes the probe:

   ```
   export P_LIB="$PWD" K=~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans4/locator-revision
   S=~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/source-list-lift/sets
   mkdir -p $K/out-impl
   # review 6's generator: the four seeds and case counts of the list-lift plan
   $K/runimpl.sh zz-loc-gen.test.ts g11 P_SEED=11 P_CASES=497232 P_OUT=$K/out-impl/gen-s11   # and 12: 507198, 13: 501486, 14: 511896
   # every row set (70 files): line commands, inline commands and the selection state
   for f in $S/*.json; do $K/runimpl.sh zz-loc-rows.test.ts r-$(basename $f .json) P_IN=$f P_OUT=$K/out-impl/rows-$(basename $f .json); done
   # look-alike documents with tabs, with the inline commands and the selection state
   $K/runimpl.sh zz-loc-gen.test.ts l31 P_LOOK=1 P_INLINE=1 P_SEED=31 P_DOCS=700 P_OUT=$K/out-impl/look-s31    # and P_SEED=32
   $K/runimpl.sh zz-loc-gen.test.ts g41 P_INLINE=1 P_SEED=41 P_DOCS=700 P_OUT=$K/out-impl/look-g41
   # the spaces-form check: drawn tab documents against their spaces form
   $K/runimpl.sh zz-lr-tabeq.test.ts t21 P_SEED=21 P_DOCS=1500 P_OUT=$K/out-impl/tabeq-21    # and P_SEED=22
   python3 $K/sumcounts.py $K/out-impl
   ```

   Run at most two at a time. Hard checks, each 0:

   | Check | Meaning |
   |---|---|
   | `H1` | the new code throws |
   | `H2` | the base acts and the new code does nothing, in a document where the base places no block elsewhere than the new code does |
   | `H3` | the viewer's text, all blocks joined and whitespace removed, differs from the document's (commands other than the code fence; a code block turned into text is the base's own rule and is counted apart) |
   | `H4` | two blocks of text are one afterwards where the base keeps them apart; for an inline command, any block of the viewer's model other than a run's format differs |
   | `H6` | an inline command changes a line's leading spaces, tabs or quote markers |
   | `H7` | an edit that changes nothing |
   | `H8` | a result or a selection state differs from the base's although the two analyses agree on every block, leaf and inline token |

   Measured on `736452bbc` with the code of the four `depends-on` plans applied, `marked` 18.1.0:[^numbers]

   | Set | Cases | `H1` to `H8` | Same edit as the base | Both do nothing | Acts where the base did nothing | Another edit than the base |
   |---|---|---|---|---|---|---|
   | review 6's generator, seeds 11 to 14, 1,500 documents each — line commands | 2,017,812 | 0 | 1,026,146 | 990,182 | 1,470 | 14 |
   | the 70 row sets of reviews 4 and 5 and of the planners and implementers (review 4's `tab` and `tab2` among them) — line commands | 236,552 | 0 | 146,459 | 82,412 | 7,567 | 114 |
   | the same sets — inline commands | 102,004 | 0 | 53,618 | 46,562 | 1,824 | 0 |
   | the same sets — selection states | 81,833 | 0 | 81,833 | — | — | 0 |
   | 2,100 look-alike and generated documents — line commands | 970,320 | 0 | 334,459 | 543,616 | 91,784 | 383 |
   | the same documents — inline commands | 267,370 | 0 | 141,352 | 118,614 | 7,404 | 0 |
   | the same documents — selection states | 53,474 | 0 | 53,466 | — | — | 8 |

   Every case in the last two columns is in a document where the base places a block, a leaf or a run of inline text elsewhere than it stands, or not at all; `sumcounts.py` prints that split (`other result, …`). Two cases, in one document, differ because the base misplaces a run of text in the *result* it checks.[^result] No command that acts at the base does nothing afterwards in the sets of the earlier reviews. In the look-alike documents 78 line cases do, which the table's columns leave out; in all of them the base acted on a block it had placed elsewhere (decision B2).[^luck] There 39 more cases change the viewer's text by turning a code block that holds Markdown into text, which is the base's rule for a code block.

   The spaces-form check (`zz-lr-tabeq.test.ts`, seeds 21 and 22) has no hard check of its own beyond the differential's, which it runs on every tab document. Its counts are fixed by its seeds: on the measured copy, `TAB-NE` is 16 and `TAB-DECL0` 668, which `### A placed block a tab indents is written as its spaces form is` explains; any other `TAB-` count, or these with other values, means the module differs from the measured one.

5. **Exactness.** `zz-loc-exact.test.ts` places every block of every document with the base and with the new code and checks both against two oracles that use neither a search nor the `raw` arithmetic.[^oracles]

   - *The perturbation oracle.* Swap the case of the letters of one line, lex again, and see which leaf block's text changed. That block holds the line. A placed block must hold every line the oracle gives it, and its first and last lines must be its own.
   - *The twin.* Replace every letter of the document by `q`. Lengths and structure stay, so every block, leaf and inline token must be placed at the same offsets as in the document itself.

   ```
   $K/runimpl.sh zz-loc-exact.test.ts sets P_IN=$K/docs-sets.json P_OUT=$K/out-impl/exact-sets
   $K/runimpl.sh zz-loc-exact.test.ts gen P_GEN=11,12,13,14 P_DOCS=1500 P_OUT=$K/out-impl/exact-gen
   $K/runimpl.sh zz-loc-exact.test.ts look P_LOOK=21,22,23,24 P_DOCS=1500 P_OUT=$K/out-impl/exact-look
   $K/runimpl.sh zz-loc-exact.test.ts hostile P_HOSTILE=61,62 P_DOCS=2000 P_OUT=$K/out-impl/exact-hostile
   ```

   Hard checks, each 0: any count whose name starts with `H:` (a block off its line, a block on another block's line, a twin placed otherwise, a leaf not on its character, a block not placed), `blocks: ONLY THE BASE LOCATES`, `H1 NEW THROWS` and `TREE DIFFERS`. The column "off its lines" counts what the perturbation oracle can see, which is lines that hold a letter; a thematic break the base puts on a setext underline shows only in the column before it.

   | Documents | Blocks | Placed alike by both | Only the new code places | Placed elsewhere by the base | New code: off its lines | New code: not placed | Base: off its lines |
   |---|---|---|---|---|---|---|---|
   | the 5,660 documents of the row sets | 112,028 | 106,431 | 5,501 | 96 | 0 | 0 | 122 |
   | review 6's generator, 6,000 documents | 61,294 | 61,251 | 0 | 43 | 0 | 0 | 0 |
   | 6,000 look-alike documents: repeated lines, repeated blocks, a block's text again inside a later code block, tab and space forms of one line | 78,516 | 70,065 | 7,168 | 1,283 | 0 | 0 | 1,676 |
   | 4,000 hostile documents: the same with whitespace at line ends, carriage returns, U+FDD0, lazy lines | 49,374 | 42,012 | 6,385 | 977 | 0 | 0 | 1,406 |

   The oracle names the block of 178,493 lines in all; the twin compares 18,870 documents. The base places no block that the new code leaves unplaced.

6. **Equivalence with the measured prototype.** Copy `proto/zz-loc-tokens.ts` and `proto/zz-loc-lines.ts` into `tests/component/`, then `$K/runimpl.sh zz-loc-equiv.test.ts eq P_GEN=11,12 P_LOOK=21,22 P_DOCS=1000 P_OUT=$K/out-impl/equiv`. `differ` is 0: the modules place every block and build every edit as the prototype does.

7. **Cost.** `$K/runimpl.sh zz-loc-perf.test.ts perf P_REPS=7 P_MAXMS=8000 P_OUT=$K/out-impl/perf.txt` times the base copies against the modules. Report its table. The requirement: no `ANALYSE` or `STATE` line of the new code is slower than the base's beyond the spread between runs, and every `COMMAND … all` line grows about fourfold from 1,600 to 6,400 lines.

   Measured in ms, with no other Vitest process running: the least of seven timings of each line, in one run (`out/perf/perf1.txt`). Of the seven timings of a line taking a millisecond or more, the slowest was up to 3.4 times the fastest, and up to 2.3 times at 6,400 lines:[^cost]

   | Document | Lines | Lexing alone | Analysis, base / new | Selection state after a keystroke, base / new | Bulleted toggle over everything, base / new | Heading over everything, base / new |
   |---|---|---|---|---|---|---|
   | headings and paragraphs | 400 | 0.4 | 0.5 / 0.6 | 0.6 / 0.5 | 7.3 / 9.4 | 9.6 / 3.8 |
   | headings and paragraphs | 1,600 | 1.2 | 2.2 / 2.4 | 2.2 / 2.0 | 54.9 / 24.5 | 99.1 / 16.4 |
   | headings and paragraphs | 6,400 | 4.2 | 8.2 / 8.5 | 8.4 / 8.0 | 436 / 124 | 1,295 / 97.8 |
   | one list, eight levels deep | 400 | 2.6 | 3.5 / 3.4 | 3.5 / 3.4 | 107 / 12.6 | 40.9 / 9.0 |
   | one list, eight levels deep | 1,600 | 10.5 | 15.0 / 14.2 | 15.6 / 15.3 | 1,434 / 63.3 | 487 / 41.9 |
   | one list, eight levels deep | 6,400 | 43.0 | 63.0 / 66.5 | 67.0 / 65.9 | 24,170 / 295 | 7,839 / 204 |
   | review 5's two-tab code block in a list item | 405 | 0.5 | 0.7 / 0.8 | 0.7 / 0.8 | 0.0 / 0.0 (both do nothing) | 0.0 / 0.0 (both do nothing) |
   | review 5's two-tab code block in a list item | 1,605 | 1.8 | 3.1 / 2.9 | 3.1 / 2.9 | 0.0 / 0.1 (both do nothing) | 0.0 / 0.1 (both do nothing) |
   | review 5's two-tab code block in a list item | 6,405 | 8.6 | 13.6 / 13.0 | 13.2 / 12.8 | 0.2 / 0.4 (both do nothing) | 0.2 / 0.4 (both do nothing) |
   | a tight list | 400 | 1.0 | 1.4 / 1.3 | 1.3 / 1.3 | 14.0 / 5.5 | 16.8 / 5.0 |
   | a tight list | 1,600 | 4.3 | 5.8 / 5.7 | 5.8 / 5.4 | 136 / 27.1 | 224 / 31.4 |
   | a tight list | 6,400 | 17.0 | 23.8 / 23.8 | 25.4 / 23.3 | 1,377 / 155 | 3,279 / 133 |
   | a loose list, each item holding a paragraph | 399 | 0.5 | 0.7 / 0.7 | 0.7 / 0.7 | 21.2 / 3.3 | 15.0 / 2.5 |
   | a loose list, each item holding a paragraph | 1,599 | 2.2 | 2.8 / 3.0 | 2.8 / 2.9 | 299 / 17.3 | 228 / 13.4 |
   | a loose list, each item holding a paragraph | 6,399 | 9.5 | 12.8 / 12.7 | 12.6 / 13.5 | 4,561 / 75.2 | 3,262 / 65.1 |

   The other four commands over everything are in the same file: at 6,400 lines the base takes 338 to 24,170 ms over the six commands and four documents that act, the new code 35 to 295 ms. A command with the caret in the middle of the document costs what it cost. At 6,400 lines, over the commands that act, base / new: headings and paragraphs 62 to 89 / 69 to 75 ms; the nested list 322 to 334 / 271 to 295; the tight list 147 to 208 / 129 to 200; the loose list 67 to 71 / 62 to 69. In the two-tab document the caret stands in the code block, where both do nothing.

   Growth for a document four times as long, 1,600 to 6,400 lines (fourfold is linear). Analysis, new code: 3.5- to 4.7-fold. A command over everything, new code: 4.0- to 6.1-fold over the six commands on four documents; the base's 7.9- to 16.9-fold.

   The new analysis is within 0.3 ms of the base's in every row but the nested list at 6,400 lines, where it is 3.5 ms slower (6%), and the selection state within 0.9 ms. Those differences are inside the spread. The one command over everything that is slower is the bulleted toggle on headings and paragraphs at 400 lines, by 2 ms, also inside the spread. The deterministic count of `### Tests of markdown-source-edits.test.ts` says the same without a clock: its 18 command cases fail at the base, where the count grows with the square of the document, and pass after.

---

## Documentation Impact

No export changes: nothing is added to a barrel and `llms.txt` is not affected. Two pages change. `markdown-tab-column-parity` and `markdown-source-mode-list-lift-parity` edit the same paragraphs before this plan, so find each clause by its words, not by its line.

**`docs/components/MarkdownEditor.md`**, the source-mode section.

1. In the paragraph that starts `Markdown the editor would not write itself`, as the two plans leave it, replace the two clauses from `These are a list in a blockquote whose markers a tab after the `>` indents` up to and including `for commands on it and on the block before such a nested list in the item; ` with `These are `. The sentence then goes on with the clause on text that opens with an unescaped `[ ] `. Every command those two clauses named acts now.
2. In the paragraph that starts `The block commands —`, add after the sentence that ends `Every other character, a tab inside text or code included, is written back as it was.` (added by `markdown-source-mode-list-lift-parity`):

   > A command on a block that a tab indents acts on it. A format, link or style command keeps the tab: with `second` behind a tab in an item, `toggleBold()` writes `**second**` behind the same tab. A block command writes the block's own line anew, as it writes a line indented with spaces: the tab counts to its tab stop, the list items' columns are taken off, and what is left of it stays as spaces. `setBlockType("h2")` on that `second` gives `## second`, the code fence a code block holding two spaces and `second`. `setBlockType("paragraph")` does nothing there, as on the WYSIWYG surface.

**`docs/reference/changelog/next.md`** — as the last bullet of `## Fixed` → `### Components`, wrapped at 76 columns with a two-space hanging indent like its neighbours:

> - **`MarkdownEditor`'s source-mode commands find each block where it stands.** Source mode found a block by searching the text for its content. A block whose text a later line repeated could be taken for that line, and a block of a list item indented with a tab was not found at all, so `toggleBold()`, `toggleLink()`, the list toggles and `setBlockType` did nothing there. Each block's place is now computed from the lexer's tokens and checked against the text. Commands act on a tab-indented block, on a nested list indented with a tab and the block before it, on a task item whose marker a tab follows, and on a list in a blockquote whose `>` a tab follows. An inline command keeps the tab; a block command writes the tab's columns as spaces, as for a line indented with spaces. A command over a selection of thousands of lines took seconds and now takes time in proportion to the document. A command on a selection that takes in a repeated link reference definition does nothing, as documented; it could act before when the search had mistaken that line for a block. No consumer action is needed.

Run `npm run docs:llms:check` afterwards.

---

## Potential Challenges

- **The base moved.** A plan of `depends-on` may have edited a function this plan replaces. Step 1 stops on that. Merge by hand, then rerun steps 4, 8 and 9 in full.
- **A `P` row fails after step 6 with `?` where a span is expected.** A line did not compare. Log the three arguments of `placedLine` where it returns `null` (the content line, the container's line, the prefix pattern) to see which comparison failed, and compare the function with `proto/zz-loc-tokens.ts`. Do not loosen a prefix pattern to make a row pass: the patterns are what keeps a block off another block's line.
- **`H2` above 0 in the differential.** The jsonl row carries `why`. `only the prototype locates a block` means a command now sees a block the base ignored and declines on it; report the case, do not add an exception.
- **`differ` above 0 in the equivalence run.** The module differs from the measured prototype. Diff it against `proto/zz-loc-tokens.ts` or `proto/zz-loc-lines.ts`.
- **A cost test fails by a small margin.** The count is deterministic, so a failure is a real extra scan. Look for a `find`, `filter` or `some` over all blocks, leaves or lifts inside a per-line or per-leaf loop.
- **The lint rule on a call inside a condition.** The project does not put a function call directly in an `if` or `while` condition; the code above assigns each to a named constant first. Keep that when merging.
- **`marked` is upgraded later.** The two facts were read off 18.1.0. Rows `P1` to `P16`, `LX40` to `LX43` and the exactness run are the check to rerun; a broken fact shows as `?` in a `P` row.
- **`holdsEntry` reported unused.** Edit 5 of `markdownSourceLines.ts` deletes it; `npm run typecheck` fails while it stays.

---

## Critical Files

- [markdownSourceTokens.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceTokens.ts) — the analysis. Read `analyzeMarkdownSource` (:173), `walkBlocks` (:401) and the `inline` section (:766), which this plan keeps.
- [markdownExtensions.ts](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts) — `recordingLexer` (:331) and `listWithOwnTaskMarker` (:370), the precedent for recording beside the lexer; `BLOCK_EXTENSION` (:130), the existing block extension; `MARKDOWN_EXTENSIONS` (:592).
- [markdownSourceLines.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts) — `containersOfLine` (:769), `readLineTargets` (:440), `lineIsHeld` (:481), `targetOfEntry` (:1013), `firstReadingEdit` (:977), which proves every edit by lexing its result and is not changed.
- [markdownImporter.ts:592](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L592) — `locateTokens`, the precedent for placing tokens in order by their `raw`. Read only.
- [markdownLexer.test.ts:891](../packages/lib/tests/component/display/markdownLexer.test.ts#L891) — the cost test this plan's cost tests are modelled on.
- [markdown-editor.test.ts](../packages/lib/tests/component/markdown-editor.test.ts) and [markdown-source-edits.test.ts](../packages/lib/tests/component/markdown-source-edits.test.ts) — the tables the rows go into.
- [plans/markdown-tab-column-parity.md](markdown-tab-column-parity.md) — how a tab is read: `containerPrefixEnd`, `withPrefixTabsAsSpaces` and its exception for whitespace that ends a line after a marker.
- [plans/markdown-source-mode-list-lift-parity.md](markdown-source-mode-list-lift-parity.md) — the line module this plan edits, and its rule for a tab in a moved line's container prefix (L4), which writes the lines after a block this plan places.
- `marked`'s own `Lexer.ts` (`blockTokens`) and `Tokenizer.ts` (`list`, `blockquote`), version 18.1.0 — where the two facts are read from. A copy is in `marked-src/` of the scratch folder.

---

## Non-Goals

- **What a command writes once a block is placed.** The lines after the block are `markdown-source-mode-list-lift-parity`'s. Its base candidate, which leaves what follows the block in the list and re-opens the item, still declines where a tab stands in a line it rewrites. With every block placed, that is the one place a tab document still does nothing where its spaces form acts: 668 of 385,476 cases.[^spaces-form]
- **Table cells.** A cell's text is still searched for inside its row's line (see the decision). Placing it exactly needs a change in `markdownTableExtension.ts`, which this plan does not touch.
- **Incremental analysis**, and a cache keyed by a document version. See the decision.
- **The WYSIWYG importer's source preservation.** See the decision.
- **`marked`'s version.** Everything was measured on 18.1.0, which `marked-version-pin-or-upgrade` and `marked-upgrade` install.
- **Documents that hold a carriage return.** Once its view is built, `CodeEditor` hands its text over with `\n` line ends only (`state.doc.toString()`). A line end written `\r\n` is read as `marked` reads it and its blocks are placed; nothing here is tuned for it.
- **Source mode's syntax highlighting.** `@lezer/markdown` is not asked for places, and `CodeEditor` gains no Markdown-specific API.
- **The `can…` fields.** Source mode still does not predict where a command does nothing.
- **Line commands that pass over a definition line.** A selection that takes in a definition's line makes a line command do nothing, whether the lexer kept the definition or dropped it as a repeat (B2).

---

## Addendum: The 77 cases of B2

**How the cases were rerun.** The cases were first found on `75d022ba1` with `marked` 18.0.9, and examined on `736452bbc` with 18.0.9 and the two plans' prototypes, where they were the same 77 with the same base results.[^rerun] For this revision they were run again on the base this plan now starts from: `736452bbc` with the four plans of `depends-on` applied and `marked` 18.1.0. The look-alike run of `## Verification` finds the same 77, no more, and the 77 rerun as rows give the same base result in every case and do nothing after this plan (`out/c77/` of the scratch folder). The five ways below were measured on the earlier base and not repeated: the two runs that decide them, the base's result and this plan's, are the same on both bases.

Each case was run five ways:

- the base and this plan, on the case's own selection;
- this plan on the selection cut short before the first line no block holds;
- the base and this plan on a *twin*, the same document with each repeated label renamed to a label of the same length, so that the lexer keeps the definition;
- the WYSIWYG surface, with the selection running from the first to the last top-level block the source selection's lines touch.

The full list, with every document, its lines and offsets and the five results of each case, is `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans4/locator-77/cases-77.txt`.

**Two rules decide these cases.** A source-mode selection takes in every line from the line its start stands on to the line its end stands on. A selection that ends at column 0 of a line therefore takes in that line. A line command does nothing when a line it takes in is held by no block, and when one is held by a block it does not convert: a definition, an HTML block, a table. Both rules are documented, and this plan changes neither.

| Class | Cases | Documents | Commands | Line the base misread |
|---|---|---|---|---|
| A — a repeated definition | 75 | 7 (`D0`, `D2` to `D7` of the list) | `setBlockType("paragraph")` 48, `setBlockType("quote")` 27 | the repeated definition's line, held by a later paragraph whose text is the label |
| B — a setext heading in a list item | 2 | 1 (`D1`) | `toggleUnorderedList` 2 | the first line of the heading, held by a nested item further down |

### Class A — a repeated definition's line

All 75 come from look-alike documents built as one half written twice. The second half's definitions repeat the first half's labels, so the lexer drops them. The selection always ends on such a line: 33 cases end at its column 0, 30 inside it, and 12 take in two of them. The rest of the selection holds paragraphs, headings, quotes, a thematic break, a list in a quote or a code block.

The smallest document that shows the class, `[w]:·u ⏎⏎ #·h ⏎⏎ [w]:·v ⏎⏎ w`, with `setBlockType("paragraph")`:

| Selection | Base | This plan |
|---|---|---|
| `#·h` to the start of `[w]:·v` (8 to 14) | `#·h` becomes `h` | nothing |
| `#·h` and the blank line after it (8 to 12) | `#·h` becomes `h` | `#·h` becomes `h` |
| 8 to 14 with `[x]:·v`, a definition the lexer keeps | nothing | nothing |
| 8 to 14 with `setBlockType("h2")` | nothing | nothing |

What was measured over the 75:

- **Where the base put the block.** In every case the base searched for a later paragraph's text (`same`, `word`, `w`) and found it inside the repeated definition's label. That paragraph stands after the selection.
- **What the base wrote.** The base's edit is in every case the edit this plan makes for the selection cut short before the definition's line. The misplaced paragraph became one more block to convert. Its conversion writes nothing: a paragraph stays a paragraph, and a paragraph already in a quote stays quoted.
- **Other commands.** `setBlockType("h2")`, `setBlockType("code")` and both list toggles on the same 75 selections do nothing at the base and after this plan. Each of them would also rewrite the misplaced paragraph. Only the two commands that leave that paragraph as it is acted at the base.
- **A kept definition.** On the twin, the base and this plan both do nothing in all 75: the selection takes in a definition's line.
- **WYSIWYG.** The surface acts in all 75. It holds each definition as a raw Markdown block and converts that block's text with the other blocks: `[same]:·u` becomes the escaped text `\[same\]:·u` of the new paragraph or quote. Its result never reads in the viewer as the base's. Source mode doing nothing on a definition where the WYSIWYG surface converts its text is a documented difference.

**Verdict.** The base wrote a correct edit of the blocks it should convert, but over a selection on which every rule says the command does nothing, and only because it misplaced a block. It was no edit of a wrong block, and no rule of either surface gives its result. This plan treats the repeated definition as it treats a kept one. That is the right behaviour under the library's rules: a source line the viewer does not show changes nothing, and source mode keeps its one documented difference from the WYSIWYG surface on definitions. The plan needs no change.

The base's results could be kept only by changing the rule for every definition: a line command would pass over a definition's line as it passes over a thematic break, and treat a dropped definition's line as such a line.[^skip-definitions] That is a change of documented behaviour for documents with no repeated label, and it would still not match the WYSIWYG surface. It belongs in a plan of its own, if wanted.

### Class B — a setext heading in a list item

One document, `D1`, two selections: `toggleUnorderedList` from the paragraph `same` on line 0 to the start of line 2 (0 to 6), and to its first character (0 to 7). Lines 2 to 4 are `-·same`, `·→same`, `·→-`. The tab takes line 3 to column 4, inside the item's content, and line 4's `-` is a setext underline there. So the item's first block is the heading `same same`.

- **Base.** It does not place the heading. It places the item `··-·same` of line 5, from the nested list further down, on line 2. Line 2 then reads as an item already bulleted, and the toggle makes line 0 an item: `-·same ⏎⏎ -·same …`.
- **This plan.** It places the heading on lines 2 to 4. A source-mode list toggle does nothing on a setext heading, so the command does nothing.
- **The same document with spaces for the tab.** The base and this plan both do nothing.
- **WYSIWYG.** The surface acts in both cases and writes the list in its standard form. Its result reads in the viewer as the base's.

**Verdict.** The base's result matches the WYSIWYG surface's, but it came from reading the nested item as the outer item's text. Under the documented rule for a setext heading, source mode does nothing, as it does on the same document written with spaces. This plan is right and needs no change. Letting the list toggles act where a setext heading is already an item of the right kind would change the rule of `markdown-source-mode-list-lift-parity`, for space-indented documents first. It is not this plan's to change.

### Recommendation

Keep this plan's behaviour for both classes. The only change is the test pin: two assertions with the document `[w]:·u ⏎⏎ #·h ⏎⏎ [w]:·v ⏎⏎ w` in `declines on a selection that takes in a repeated definition, which no block holds`.[^pin]

---

## Notes

[^measured]: The measurements were made in a private copy of commit `736452bbc` under `scratch-keep/plans4/locator-revision/repo`, with its own `node_modules/marked` 18.1.0; nothing was installed in the main tree or a worktree. The copy was taken from the list-lift plan's measured copy (`plans4/lift-revision/repo`), which holds the code and tests of `marked-version-pin-or-upgrade`, `marked-upgrade`, `markdown-tab-column-parity` and `markdown-source-mode-list-lift-parity`. The three modules of this plan were put in place of the real ones, and the test changes written into the real test files (`applytests.py`). The base side of every comparison is a copy of the three modules before the change (`zz-base-*.ts`, as `mkbase.sh` makes them) over the same lexer module, recorder included, which changes no token. The first version of this plan was measured on `75d022ba1` with `marked` 18.0.9 and the two plans' prototypes; every number here was measured again. `PROGRESS.md` in the scratch folder says which output is which.

[^mechanism]: Three mechanisms were asked about.

    | Mechanism | Verdict |
    |---|---|
    | Carry each token's place through the tokenizer wrappers, while lexing | Taken in substance, done after the lexer returns. What a wrapper could carry is what it sees when `marked` returns: the container's `raw` and its children's. That is exactly what the analysis reads afterwards, so computing inside the wrappers gives the same numbers and makes the viewer and the importer pay for them on every lex. The lexer module therefore carries only what is lost by the time it returns: the dropped definitions |
    | Keep the search, make it positional and monotonic | Rejected. A search bounded to "after the previous token, inside the parent" still chooses among candidates by text, and in a list item with a tab the text to look for is not in the source at all (`marked` read the tab as spaces). Making the match tab-aware is the attempt that went quadratic. With Fact 1 the position is known before any text is compared, so the comparison is a check with one candidate, not a search |
    | Read containers from `@lezer/markdown`'s tree, which `CodeEditor` holds | Rejected. It is another parser. `markdown-tab-column-parity` pins two shapes it reads otherwise than `marked` (a heading whose `#` a tab follows; a list after `>` and a tab), and the dialect's tables, `:::` fences and `++` are not in its grammar. The commands' proof is a re-lex through `lexMarkdown`, so the places must be of `lexMarkdown`'s tokens. It would also need a Markdown-specific door on `CodeEditor` |

    The prototype was first written with a per-character offset array for every line of every container. It measured up to 1.6 times the base's analysis time. The form in this plan keeps one number per line (`base`) and a short `head` for the few characters that are not at `base + index`, and compares list items with the list's `raw` in one call each.

[^checked]: Why a line check and not the facts alone. A violated fact shifts every later line of a token list by some number of lines. Without a check, a shifted block would be placed on a neighbour's line. With it, a shifted line has to equal the end of the wrong container line and leave only a container prefix before it, which look-alike documents can still satisfy for a single line. The count checks close that: the content of a container must use up the container's lines, so a shift leaves a line over or runs past the end, and then nothing inside that container is placed. The exactness run found no block off its lines in 21,660 documents, a quarter of them built to hold look-alikes.

[^recorder]: `marked` gives a block extension the token list being built (`extTokenizer.call({ lexer }, src, tokens)`), which no tokenizer slot gets. That is what lets the record be keyed by the token the definition follows. The recorder reads `marked`'s own `def` tokenizer through `this.lexer.options.tokenizer`, so it matches exactly where the lexer's `def` branch will: a line that matches the `def` rule matches no earlier rule (`code` needs four columns of indentation, the others another first character). It records only where the lexer drops: the label is defined already, and the token before is not a paragraph or list-item text, which the lexer joins a definition to instead. The record holds the length of the previous token's `raw` at that moment, because the lexer adds the line end that closes the definition to that token afterwards; the definition stands inside that `raw`, at that index. The cost for every other lex is one anchored test per block position. A `WeakSet` of the lexes that dropped something lets the analysis skip every lookup for a document that repeats no definition, which is nearly every document.

[^unplaced]: The first version of this plan, on `marked` 18.0.9, left one shape unplaced: a list that holds both a tab past a line's indentation and the character U+FDD0, which the first version of `markdown-tab-column-parity` used as a stand-in to carry such tabs through `marked`. On 18.1.0 that plan needs no stand-in, since `marked` keeps such a tab itself, and the shape is placed like any other: `- a` / (blank) / `··b→c` / `- d` places the paragraph `b→c` at offsets 7 to 10, with or without U+FDD0 in the document. The hostile documents of the exactness run hold U+FDD0 in a tenth of them; none leaves a block unplaced.

[^cells]: Measured: in `| h | i | j |` / `|---|---|---|` / `| a | << | < |` the last cell's text is placed at offset 34, on the `<<`, by the base and by the prototype; it stands at 39. `toggleBold` with the caret on either `<` does nothing on both. A cell that was merged away emits no token, so the cells a row's tokens stand for are not the row's segments in order; the tokenizer knows the column of each and does not pass it on.

[^index]: Each replaced lookup returns what the old one returned. `containersOfLine` filtered every block for those whose first and last line bracket the line; the index enters each located quote and list item under every line it spans, in the same document order. `targetOfEntry` returned the first target whose entries hold the entry; the map is filled from the last target to the first, so the first one wins. `liftBefore` took the last lift before the leaf whose outermost list item holds the leaf; a list item holds a leaf exactly when the entry it opens on is among the leaf's holders, so the lifts are looked up under those entries and the last one before the leaf is found by binary search in each. `instanceId` counted the lifts inside a container that end by the leaf; with the lifts in document order those are one run, and two binary searches give its two ends. Measured: the module with the indexes and the list-lift plan's module without them, both over the new analysis, give the same edit in 5,212,320 cases (2,334,156 of them acting), with every document also run over everything: review 6's generator, seeds 11 to 14, and the look-alike documents, seeds 21 to 24, 1,500 documents each (`out/equiv/`).

[^bound]: Per level of nesting the analysis does a fixed number of passes over a container's text: joining its pieces, splitting them into lines, comparing each line, and the walk of its tokens. A line that is nested *d* levels deep is handled *d* times. The line index enters each quote and list item under each of its lines, which is the same sum. Depth is at most a few levels in real documents and eight in the nested test document. The profile of the base's command over everything, taken for the first version of this plan: `allNodes`, called once per line by `containersOfLine`, took half of the time of the bulleted toggle on the nested document at 1,600 lines (59% with its callback), and the per-leaf search over the targets a fifth of `setBlockType("paragraph")` on a tight list of 1,600 items.

[^cache]: `analyzeMarkdownSource` is called by every transform, once on the text and once on each candidate result, and by `readSourceSelectionState`, which `MarkdownEditor` calls from `readSurfaceSelectionState` on every selection change and every text change. A caret move hits the cache. A keystroke misses it, and costs one analysis: 24 ms for a list of 6,400 items. Lexing is between half and two thirds of an analysis (the table of `## Verification`) and `marked` has no incremental mode, so an incremental analysis could save half at most of a cost that is one or two frames for a document of 6,400 lines and under a millisecond for one of 400. A second cache entry would save one analysis after a command that declines; it is not worth a second copy of the entries.

[^importer]: The importer needs something else: every byte of the source assigned to a top-level block or to a gap between two, so that it can write unedited text back. It places only top-level tokens, where the text is the source itself, and it treats a dropped definition as a gap to keep. The new places would let it drop its own small search for dropped definitions, but they are computed for all depths with entries per character, which import does not need. Sharing them is a change to import's cost and to a file with its own byte-for-byte tests.

[^spaces-form]: Measured with `zz-lr-tabeq.test.ts` of `markdown-source-mode-list-lift-parity` (copied to `probes-impl/`), seeds 21 and 22, 1,500 drawn documents each: review 6's generator, with spaces of a container prefix that reach a tab stop written as a tab. 1,013 documents hold a tab and read as their spaces form; 385,476 cases, six line commands. In 229,195 both act and the tab document's result, in its spaces form, is the spaces document's result; in 155,597 both do nothing. With the list-lift plan alone the first count was 106,010, and 123,797 cases fell to blocks the token search did not place; now none does. Two kinds remain. 668 cases do nothing on the tab document where the spaces document acts. The probe keeps 400 of them, from five documents, and each of the 400 was traced: the tail candidate is built and rejected by the check on both, the spaces document then takes the base candidate, and the tab document's base candidate keeps a tab in a line it re-opens and does not read (`out/why-decl.jsonl`). That is the list-lift plan's documented base rule: a tab in a line the base candidate writes makes it decline. 16 cases in one document both act and differ, because the probe wrote a tab into a paragraph's lazy line (`10.→# beta` continuing `alpha·`): there the tab is text, and every command keeps it, as it must.

[^prototype]: `proto/markdownExtensions.loc.ts`, `proto/markdownSourceTokens.loc.ts` and `proto/markdownSourceLines.loc.ts` in the scratch folder are the modules as this section gives them; the code blocks here were taken from those files. They stood in the copy's own source tree, so `npm run typecheck` and `eslint` ran on them under their own paths: both clean. The line module was made by applying the six edits to the list-lift plan's measured module by script (`build-lines.py`). The whole suite with them in place: 591 files, 20,252 tests passed and 2 `todo`.

[^tests]: The test changes were written into the copy's test files as `markdown-source-mode-list-lift-parity` leaves them (`applytests.py` in the scratch folder) and run both ways: the three files hold 1,475 tests, all green with the prototype; in the two editor files 45 of 1,291 are red with the base's modules.

[^worktest]: A clock would make the test flaky on a shared machine. The count is the number of elements of every array handed to `filter`, `find`, `findIndex`, `findLast`, `findLastIndex`, `some`, `every`, `flatMap`, `map`, `forEach`, `indexOf` and `includes` while the command runs. A lookup that walks all blocks for every line shows there as growth with the square of the document. The methods are restored in a `finally`, as the lexer test restores `String.prototype.split`.

[^numbers]: `sumcounts.py` adds the counts of a folder of outputs. The numbers are those of the runs in `out/gen/`, `out/rows/`, `out/look/`, `out/exact/` and `out/tabeq/` of the scratch folder, made with the probes of `probes-impl/` against copies of the base's modules, as an implementer runs them. The row sets are the 70 files of `scratch-keep/plans3/source-list-lift/sets/`. Against the first version's numbers, the generator's are the same to the case; the row sets' and the look-alike documents' changed with the tab rule of `markdown-tab-column-parity` on 18.1.0 and with the list-lift plan's revision, which make more of their documents read and act otherwise at the base and after.

[^luck]: Of the 78, 75 are selections that take in the line of a repeated definition; the base had placed a later paragraph's look-alike text inside that definition, so the line counted as held. Two are one document in which the base took an item of a nested list for the outer item's first line. One is `- same` / (blank) / `·→```` / `··same` / `··→```` / `same` at the end of a longer list, `setBlockType("paragraph")` with the caret on the code line `··same`: the base placed the item's last paragraph, `same`, on that line, so it lifted that paragraph out of the list and wrote the code line without its indentation. The tab documents written with spaces make both sides do nothing. `## Addendum: The 77 cases of B2` examines the first 77.

[^seventy-seven]: `## Addendum: The 77 cases of B2` runs each case on the base, on this plan, on the selection cut short, on a twin with the definitions kept and on the WYSIWYG surface, and sorts the cases into two classes. The full case list is `cases-77.txt` in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans4/locator-77/`.

[^rerun]: The probes, the redirect config `zz-vitest.l77.config.ts` and the outputs are in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans4/locator-77/`: `out/look/` holds the rerun of the look-alike differential (`out/look-sum.txt` its counts), `out/cases-a.jsonl` the five runs of each case (probe `probes/zz-l77-cases.test.ts`), `out/cases-othercmd.jsonl` the other four commands on the 75 class A selections, `out/pin.jsonl` the minimal document. The two `H8` cases of the planner's run are counted here as `in a result: leaves or inline tokens differ`, the label the probes were given after that run; they are the same two cases. On the WYSIWYG surface the selection starts at the first top-level block's first character. Its focus is one character into the last block when the source selection ends at that block's first line start or first character, and at that block's end otherwise; a focus at offset 0 was not tried.

[^skip-definitions]: Concretely: in `markdownSourceLines.ts`, `def` would join `SKIPPED_NODE_TYPES`, and `lineIsHeld` would count a line inside a dropped definition's text as held, which the recorder of this plan makes possible. On the 75 cases that gives the base's results. It also makes every line command act over a kept definition, where it does nothing today.

[^pin]: Measured with the probe `zz-l77-pin.test.ts`: on 8 to 14 the base writes `h` and this plan does nothing; on 8 to 12 both write `h`; with `[x]:·v` or with `setBlockType("h2")` both do nothing. The test is already red at the base through its second assertion, so the counts of `### What is red before the code` and of `## Verification` do not change. The copy of the test in the planner's `snip/` folder lacks the two assertions.

[^result]: The document is `same ⏎⏎ word\ ⏎ word ⏎⏎ word ⏎ --- ⏎⏎ ``` ⏎ --- ⏎ ``` ` with `setBlockType("h2")` over the code block. The result is `… word ⏎ --- ⏎⏎ ## ---`. To check it the command analyses it, and the base's search puts the new heading's text `---` on the setext underline above, outside the range the check expects it in. The base therefore rejects its own correct edit and does nothing. The probe `zz-loc-h8.test.ts` found these two among all documents whose own analyses agree; the checks of `probes-impl/` count them under `in a result`.

[^oracles]: `commonmark.js` source positions, which the tab plan used as a reference for readings, were not used here: the dialect's tables, `:::` fences and `marked`'s own readings differ from CommonMark in too many of these documents for its positions to be the truth about `lexMarkdown`'s blocks. The perturbation oracle asks `lexMarkdown` itself and is independent of how a place is computed. It cannot name the block of a line without letters, of a line whose change alters the document's structure, or of a line two blocks read (a definition and the paragraph that uses it); those lines are skipped and counted.

[^cost]: The base's analysis is linear too; the first attempt's tab-aware search was the quadratic one and is not in the base. The new analysis does about the same work in another way: where the base aligned every character of every container against the source, it now compares lines. On the two-tab document the base is fast only because it gives up on the code block; the new code places it and still costs no more. A difference inside the spread of the seven timings is not a difference. The first version of this plan was timed on a busy machine on 18.0.9; its numbers are replaced by this run.
