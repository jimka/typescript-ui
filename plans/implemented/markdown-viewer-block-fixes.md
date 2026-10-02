---
depends-on:
  - markdown-editor-source-preservation
touches-shared:
  - packages/lib/src/typescript/lib/component/display/Markdown.ts
  - packages/lib/src/typescript/lib/component/display/markdownExtensions.ts
  - packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/tests/component/display/Markdown.test.ts
  - packages/lib/tests/component/display/markdownLexer.test.ts
  - packages/lib/tests/component/markdown-importer.test.ts
  - packages/lib/tests/component/markdown-serializer.test.ts
  - packages/lib/tests/component/markdown-roundtrip/viewModel.ts
  - packages/lib/tests/component/markdown-roundtrip/markdown-view-model.test.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/divergences.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts
  - packages/lib/docs/components/Markdown.md
  - packages/lib/docs/reference/changelog/next.md
---

# Markdown Viewer Block Fixes — Implementation Plan

## Overview

The round-trip harness and the editor-conversion plans found three `Markdown`
viewer defects and deferred them to a viewer plan. This plan fixes them:

1. **Tables where another block starts.** The dialect's table tokenizer
   ([`markdownTableExtension.ts:164`](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L164))
   is a `marked` block *extension*, and `marked` tries extensions before every
   built-in rule. It accepts any line followed by a `---`-style line, so a
   setext heading, a thematic break, a fenced code block whose first line is
   `---`, a list with a bare `-` item, and a `---` after a blank line all
   render as tables.
2. **Task-list items lose their marker.** In `- [ ] task` the viewer prints
   the checkbox token's `[ ] ` and then writes `task` as the `<li>`'s whole
   text content, which erases the marker
   ([`Markdown.ts:1724`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1724)).
3. **A character swallowed after a blockquote.** `marked` 18.0.9 rebuilds a
   blockquote's `raw` when its list takes a lazy continuation line, and the
   rebuilt text can be longer than the source the quote used. The lexer
   advances by `raw.length`, so the next block loses its first character
   (`<div>` shows as `div>`).

The editor loads Markdown through the viewer's own lexer, so fixes 1 and 3
change what `MarkdownEditor` loads too. No importer source change is needed;
importer tests pin the new behaviour. The plan also updates the harness
(projection, corpus, the `taskListMarker` reason), `Markdown.md`, and the
changelog.

It lands on top of `markdown-editor-source-preservation`. Line numbers are as
of `feature/markdown-editor-marked-import` at `8e630f4b`; the display files and
`viewModel.ts`'s viewer side do not move in the two plans stacked between.

---

## Architecture Decisions

### A table is recognised where `marked`'s own table rule would be tried

The dialect's table tokenizer moves out of the extension list into `marked`'s
`table` tokenizer slot, which `marked` tries after indented and fenced code,
ATX headings, thematic breaks, blockquotes, lists, HTML blocks and link
reference definitions, and before setext headings and paragraphs. It also
adopts `marked`'s one extra check: the delimiter row must contain a `|` or a
`:`. The dialect's table is then exactly `marked`'s GFM table, plus
`{width=…}` delimiter cells and `<<` / `^^` merges.[^table-slot][^delimiter-marker]

| Source | Before | After | Why |
|---|---|---|---|
| `Foo\n---\nbar` | one-column table | `<h2>Foo</h2>`, `<p>bar</p>` | no `\|` or `:` in `---`, so the setext heading wins |
| `` ```\n---\n``` `` | one-column table | `<pre>` holding `---` | fenced code is tried before the table |
| `- foo\n-\n- bar` | one-column table | a three-item list (middle item empty) | the list is tried first |
| `***\n---\n___` | one-column table | three thematic breaks | `hr` is tried first |
| `> Foo\n---` | one-column table | quote, then thematic break | the blockquote is tried first |
| `> - a\nb\n\n---` | quote, then a table with an empty header | quote, then thematic break | the blank line is read as space before the table is tried |
| `\| a \|\n\| - \|\n\| 1 \|` | table | table | pipes present |
| `a \| b\n--- \| ---\n1 \| 2` | table | table | pipes present |
| `a\n:-:` | table | table | a `:` counts, as in `marked` |
| `\| a \|\n\| :--- {width=240} \|\n\| 1 \|` | table | table | the dialect's width |

The precedent is the existing `table` override in
[`BOUNDED_BLOCK_TOKENIZERS`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L318),
which already replaces a built-in tokenizer in its slot. A thematic break
still renders as its literal text, through the viewer's existing fallback.

### The test twin gets the same dialect tokenizers

`lexMarkdownUnbounded` is the witness that the guards and windows change no
token, so it must differ from `lexMarkdown` in nothing else. A new
`DIALECT_BLOCK_TOKENIZERS` object holds the two dialect-owned tokenizers
(`table` and `blockquote`); the twin installs it as is, and
`BOUNDED_BLOCK_TOKENIZERS` calls the same two functions behind its guards.

### A blockquote's `raw` is cut back to the source it used

A wrapper around `marked`'s blockquote tokenizer replaces the token's `raw`
with the matching slice of the source. The slice ends at the latest
*candidate end* that is not past `marked`'s own `raw` length. The candidate
ends are the end of the blockquote rule's own match (trailing newlines
dropped), and the end of every `>` line whose next line is a lazy line (one
without `>`). When no candidate qualifies, `marked`'s `raw` is kept.[^quote-raw-cause][^quote-snap]

| Source | `marked`'s `raw` | Candidate ends | New `raw` |
|---|---|---|---|
| `> a\nlazy` | `> a\nlazy` (8) | 3, 8 | `> a\nlazy` |
| `> - a\n> - a\nc\n> - a\nc\n<div>` | `> - - a\n- a\nc\n\n> - a\nc` (22) | 11, 19, 21 | `> - a\n> - a\nc\n> - a\nc` |
| `` > - a\nb\n> ```\nc `` | `` > - a\nb\n\n> ``` `` (14) | 5, 12, 15 | `` > - a\nb\n> ``` `` |

Only `raw` changes. The token's `text` and child tokens stay as `marked`
built them.

### A task item shows its marker as literal text

The viewer keeps rendering `[ ]` / `[x]` as text, not as a checkbox, and stops
erasing it. In `appendListItem`, a `text` token that is not the item's first
token no longer takes the *sole-text path* — the branch of
`appendInlineToken` that sets the parent's whole text content, which is only
correct when nothing was rendered into the parent before it. Its inline tokens
are appended one by one instead.[^task-literal][^sole-path]

| Source | Before | After |
|---|---|---|
| `- [ ] task` | `task` | `[ ] task` |
| `- [x] done\n- [ ] todo` | `done`, `todo` | `[x] done`, `[ ] todo` |
| `- [ ] see \[docs\]` | `[ ] see [docs]` | unchanged |
| `- [ ] a\n\n- [x] b` (loose) | `[ ] a`, `[x] b` | unchanged |
| `- a\n  - b` | `a`, nested `b` | unchanged (`a` is the item's first token) |

### The editor needs no importer change

The editor imports through `lexMarkdown`, so it reads the new heading, code,
list and thematic-break tokens and the corrected blockquote `raw` with no code
change. Its task items already keep `[ ] ` as a source text node, which is what
the viewer now shows. Importer tests pin all three.[^importer-unchanged]

### The harness follows the viewer

`viewerListItem` in the harness projection stops modelling the overwrite and
models the marker as the first text of the item's paragraph. All three
`taskListMarker` entries then hold, so the entries and the reason are deleted.
No other entry changes; the table and blockquote fixes change the viewer and
the editor identically. New corpus cases pin the fixed shapes.

---

## Internal Structure

### `markdownTableExtension.ts`

`TABLE_EXTENSION` becomes a plain exported function with the same body, plus
the delimiter-marker check:

```ts
import type { Token, TokenizerThis } from "marked";

/** A delimiter row must hold one of these, as `marked`'s own table rule requires (`tableDelimiter`), so `Title` over `---` stays a setext heading. */
const DELIMITER_ROW_MARKER = /[:|]/;

export function tokenizeTable(this: TokenizerThis, src: string): MdTableToken | undefined {
    const headerEnd = src.indexOf("\n");

    // A single unterminated line cannot carry a delimiter row below it.
    if (headerEnd === -1) {
        return undefined;
    }

    const delimiterEnd = lineEndAt(src, headerEnd + 1);
    const delimiterLine = src.slice(headerEnd + 1, delimiterEnd);
    const hasMarker = DELIMITER_ROW_MARKER.test(delimiterLine);

    if (!hasMarker) {
        return undefined;
    }

    const delimiter = parseDelimiterRow(delimiterLine);

    // … the rest of today's tokenizer body, unchanged …
}
```

### `markdownExtensions.ts`

```ts
import type { Links, Token, TokenizerExtension, TokenizerObject, Tokens } from "marked";
import { tokenizeTable } from "~/component/display/markdownTableExtension.js";

/** The newlines `marked` trims off the end of a blockquote rule's match before reading its lines. */
const TRAILING_NEWLINES = /\n+$/;

function dialectTable(this: Tokenizer, src: string): Tokens.Table | undefined {
    return tokenizeTable.call(this, src) as unknown as Tokens.Table | undefined;
}

function quotedSourceEnd(quoted: string, rebuiltLength: number): number {
    let end = -1;
    let lineStart = 0;

    while (lineStart <= quoted.length) {
        const lineEnd = lineEndAt(quoted, lineStart);
        const last = lineEnd >= quoted.length;
        const quotedLine = BLOCKQUOTE_START.test(quoted.slice(lineStart, lineEnd));
        const nextLazy = !last && !BLOCKQUOTE_START.test(quoted.slice(lineEnd + 1, lineEndAt(quoted, lineEnd + 1)));
        const candidate = last || (quotedLine && nextLazy);

        if (candidate && lineEnd <= rebuiltLength) {
            end = lineEnd;
        }

        if (last) {
            break;
        }

        lineStart = lineEnd + 1;
    }

    return end === -1 ? rebuiltLength : end;
}

function blockquoteWithSourceRaw(this: Tokenizer, src: string): Tokens.Blockquote | undefined {
    const token = Tokenizer.prototype.blockquote.call(this, src);

    if (token === undefined) {
        return undefined;
    }

    const quoted = this.rules.block.blockquote.exec(src)![0].replace(TRAILING_NEWLINES, "");

    token.raw = src.slice(0, quotedSourceEnd(quoted, token.raw.length));

    return token;
}

const DIALECT_BLOCK_TOKENIZERS: TokenizerObject = {
    blockquote: blockquoteWithSourceRaw,
    table:      dialectTable,
};
```

`BLOCKQUOTE_START` must be declared above `quotedSourceEnd`; it already sits
at [`:241`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L241),
so place the new functions after `hasSetextUnderline` (ends `:298`). The `!`
on `exec` is safe: `marked`'s tokenizer returned a token, so its own regex
matched the same `src`.

In `BOUNDED_BLOCK_TOKENIZERS`:

```ts
blockquote(src) {
    return BLOCKQUOTE_START.test(src) ? blockquoteWithSourceRaw.call(this, blockWindow(src)) : undefined;
},
table(src) {
    return secondLineHasDash(src) ? dialectTable.call(this, src) : undefined;
},
```

`table` takes no window: the dialect's tokenizer reads only up to its first
blank line, so it never scans the rest of the document.

### `Markdown.ts` — `appendListItem`

```ts
item.tokens.forEach((token, index) => {
    if (token.type !== "text") {
        this.appendBlockToken(listItem, token, headingIds);

        return;
    }

    const text = token as Tokens.Text;
    const inline = text.tokens ?? [];

    if (inline.length > 0 && index === 0) {
        this.appendInlineTokens(listItem, inline);
    } else if (inline.length > 0) {
        // An earlier token (a task item's `[ ]` marker) already rendered into
        // the item, so no child may take the sole-text path that replaces it.
        for (const child of inline) {
            this.appendInlineToken(listItem, child, false);
        }
    } else {
        this.appendInlineToken(listItem, text, item.tokens.length === 1);
    }
});
```

The last branch is today's no-children branch, unchanged.

### `viewModel.ts` — `viewerListItem`

```ts
function viewerListItem(item: Tokens.ListItem): Block[] {
    const blocks: Block[] = [];
    let marker: Token[] = [];

    for (const token of item.tokens) {
        if (token.type === 'checkbox') {
            marker = [{ type: 'text', raw: token.raw, text: token.raw } as Tokens.Text];
            continue;
        }

        if (token.type !== 'text') {
            blocks.push(...viewerBlock(token));
            continue;
        }

        const text = token as Tokens.Text;
        const inline = text.tokens && text.tokens.length > 0 ? text.tokens : [text];

        blocks.push({ kind: 'paragraph', runs: viewerRuns([...marker, ...inline], PLAIN) });
        marker = [];
    }

    return visibleBlocks(blocks);
}
```

`replacesItemContent` is deleted.

---

## Ordered Implementation Steps

Paths are relative to `packages/lib/`. Work test-first; run commands from
`packages/lib`. Steps 1–3 write the tests; steps 4–8 make them pass.

1. **`tests/component/display/markdownLexer.test.ts`** — after the
   `describe('the bounded block tokenizers lex generated documents identically', …)`
   block (ends at line 311), add:
   - `describe('the table tokenizer runs where marked tries its own table rule', …)`
     with rows LX1–LX9;
   - `describe('a blockquote\'s raw is the source it used', …)` with rows
     LX10–LX13.

   For LX13, give `randomDocuments` ([:258](packages/lib/tests/component/display/markdownLexer.test.ts#L258))
   a second parameter `pool: readonly string[] = LINE_POOL` and draw from
   `pool` instead of `LINE_POOL`. Add, after `LINE_POOL`:
   ```ts
   /**
    * `LINE_POOL` without its definition line — a repeated definition emits no
    * token, so its text would be in no `raw` — plus quoted list lines, whose
    * lazy continuations are what make `marked` rebuild a blockquote's `raw`.
    */
   const RAW_SOURCE_POOL: readonly string[] = [
       ...LINE_POOL.filter((line) => !line.startsWith('[ref]:')), '> - a', '> -', '> 1. a',
   ];
   ```
   Also append `'Foo\n---\nbar'` and `'> - a\n> - a\nc\n> - a\nc\n<div>'` to
   `WINDOW_SOURCES` ([:155](packages/lib/tests/component/display/markdownLexer.test.ts#L155)),
   each with a one-line comment like its neighbours.
2. **`tests/component/display/Markdown.test.ts`** — after
   `describe('Markdown blockquote', …)` (ends at line 1128), add
   `describe('Markdown block precedence over tables', …)` (BF1–BF9),
   `describe('Markdown after a blockquote whose list has lazy lines', …)`
   (BF10–BF11) and `describe('Markdown task-list items', …)` (BF12–BF15).
   For "no text write lands on an `LI`" (and its BF15 opposite), filter
   `sink.writes` the way `textWrites` does and map each write's handle through
   `DOM.source.getTagName`, as `childTagsOf` does.
3. **`tests/component/markdown-importer.test.ts`** — append
   `describe('$importMarkdown — viewer block fixes (VB rows)', …)` at the end
   of the file with VB1–VB5, using the file's `load`, `rootTypes`,
   `rootTexts` and `expectSurface`.

   Run
   `npx vitest run tests/component/display/markdownLexer.test.ts tests/component/display/Markdown.test.ts tests/component/markdown-importer.test.ts`
   — every row marked "fails" in *Expected Behaviour* fails; every row marked
   "passes", and every existing test, passes.
4. **`src/typescript/lib/component/display/markdownTableExtension.ts`** —
   per *Internal Structure*: change the `marked` type import (line 3) to
   `Token, TokenizerThis`; add `DELIMITER_ROW_MARKER`; turn `TABLE_EXTENSION`
   (lines 164–272) into `export function tokenizeTable`, moving the
   `tokenizer(src)` body to the function body unchanged except for the
   marker check before `parseDelimiterRow`. Rewrite the JSDoc above it
   (lines 154–163) to say: it is the dialect's GFM pipe-table tokenizer,
   installed in `marked`'s `table` slot by `markdownExtensions.ts` so `marked`
   tries it where it would try its own table rule; like that rule it needs a
   delimiter row holding a `|` or `:`; it differs from it only by accepting
   `{width=…}` delimiter cells and `<<` / `^^` merges; the editor reads tables
   through the same tokenizer and writes them with its serializer
   (`markdownSerializer.ts`).
5. **`src/typescript/lib/component/display/markdownExtensions.ts`**:
   - Imports (lines 4 and 6): add `Tokens` to the type import; import
     `tokenizeTable` instead of `TABLE_EXTENSION`.
   - After `hasSetextUnderline` (ends line 298), add `TRAILING_NEWLINES`,
     `dialectTable`, `quotedSourceEnd`, `blockquoteWithSourceRaw` and
     `DIALECT_BLOCK_TOKENIZERS` per *Internal Structure*, each with JSDoc.
     `dialectTable`'s JSDoc says the cast exists because `marked` types the
     slot's result as its own `Tokens.Table`, while the lexer reads only
     `raw` from it and every consumer switches on `mdtable`.
     `blockquoteWithSourceRaw`'s JSDoc names the defect: `marked` rebuilds a
     blockquote's `raw` when a list inside it takes a lazy line, and the
     rebuilt text can be longer than the source the quote used.
   - `BOUNDED_BLOCK_TOKENIZERS` (lines 322–324, 328–330): `blockquote` and
     `table` per *Internal Structure*. Update its JSDoc (lines 300–317):
     `blockquote` calls the dialect's source-`raw` wrapper on the window, and
     `table` runs the dialect's table tokenizer behind the guard with no
     window. Update `secondLineHasDash`'s JSDoc (lines 255–262): the dialect's
     table tokenizer, not `marked`'s rule, needs the `-`.
   - `MARKDOWN_EXTENSIONS` (line 345): remove `TABLE_EXTENSION`.
   - `lexMarkdownUnbounded` (line 372):
     `new Marked({ extensions: MARKDOWN_EXTENSIONS, tokenizer: DIALECT_BLOCK_TOKENIZERS })`.
     Its JSDoc adds that it shares the dialect's own `table` and `blockquote`
     tokenizers.
   - Check: `grep -rn 'TABLE_EXTENSION' src tests` — zero matches.

   Re-run step 3's command: all LX rows, BF1–BF11 and VB1–VB4 pass;
   BF12–BF13 and VB5 still fail.
6. **`src/typescript/lib/component/display/Markdown.ts`**:
   - `appendListItem` (lines 1724–1752): replace the `for…of` loop with the
     `forEach` in *Internal Structure*. Extend its JSDoc (lines 1715–1723):
     only the item's first `text` token may write the item's whole text
     content; a later one appends, so a task item keeps the `[ ]` / `[x]`
     marker printed before it.
   - Class `@remarks` (lines 586–588): change "(raw HTML, the remaining GFM
     extensions)" to "(raw HTML, a task-list item's `[ ]` / `[x]` marker, the
     remaining GFM extensions)".

   Re-run step 3's command: only VB5 still fails (it compares against the
   harness projection, fixed next).
7. **Harness projection.** In
   `tests/component/markdown-roundtrip/markdown-view-model.test.ts`, rewrite
   V16 (lines 139–143) as
   `it('V16. shows a task item\'s marker as the first text of its paragraph', …)`
   per the V16 row, and add V18 and V19 after V17. Run
   `npx vitest run tests/component/markdown-roundtrip` — V16 and V18 fail.
   Then in `tests/component/markdown-roundtrip/viewModel.ts` replace
   `viewerListItem` and its JSDoc (lines 288–311) per *Internal Structure*,
   with the JSDoc "Projects one list item, following `Markdown.appendListItem`:
   a `text` token becomes a paragraph and any other token a block; a task
   item's checkbox token becomes the first text of the next paragraph, as the
   viewer prints its marker inline". Delete `replacesItemContent` and its
   JSDoc (lines 313–327). V16, V18, V19 and VB5 pass.
8. **Settle the harness baseline.** Run the harness again. Expected (see
   *Harness baseline*): exactly the three `taskListMarker` checks fail with
   "now holds". In `corpus/dialect.ts`, delete the `known` property of
   `task-list marker` (line 30) and of `task item text that saves escaped`
   (line 102). In `corpus/divergences.ts`, delete the `taskListMarker` entry
   (line 22). Then append the five new cases (C1–C5) at the end of
   `DIALECT_CASES`, before the closing `];` (line 105). Re-run: green. Any
   other outcome follows the harness plan's rule: do not edit a `known`
   entry to make the run green; re-read the projection, and if the
   difference is real, stop and report it.
9. **Stale comments.** The bare-`-` reasoning no longer holds:
   - `src/typescript/lib/component/editor/markdownSerializer.ts` — the
     comment above `if (bare && nested.length > 0)` (find it with
     `grep -n "pipeless-table" src/typescript/lib/component/editor/markdownSerializer.ts`)
     becomes: "An item holding only a nested list starts it on its marker's
     line, as `- - b` is written (CommonMark example 298's own form)." No
     code change.
   - `tests/component/markdown-serializer.test.ts` — the two comment lines
     in the `S11 (first item)` test (lines 280–281) become
     `// CommonMark example 298's own form for an item holding only a nested list.`
   - Check: `grep -rn 'pipeless' src tests` — zero matches.
10. **`docs/components/Markdown.md`** — per *Documentation Impact*.
11. **`docs/reference/changelog/next.md`** — per *Documentation Impact*.
12. Run *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` (comment only) |
| Modify | `packages/lib/tests/component/display/markdownLexer.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-serializer.test.ts` (comment only) |
| Modify | `packages/lib/tests/component/markdown-roundtrip/viewModel.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-view-model.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/divergences.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

"Before" is the result on this plan's base; every row is unit-testable.

### Lexer (`markdownLexer.test.ts`)

Each row asserts `lexMarkdown(source)`'s top-level token types, in order.

| # | Source | Expected | Before |
|---|---|---|---|
| LX1 | `Foo\n---\nbar` | `heading` (depth 2), `paragraph` | fails |
| LX2 | `` ```\n---\n``` `` | `code` with text `---` | fails |
| LX3 | `- foo\n-\n- bar` | `list` with 3 items | fails |
| LX4 | `***\n---\n___` | `hr`, `hr`, `hr` | fails |
| LX5 | `> Foo\n---` | `blockquote`, `hr` | fails |
| LX6 | `> - a\nb\n\n---` | `blockquote`, `space`, `hr` | fails |
| LX7 | `\| a \|\n\| - \|\n\| 1 \|` | `mdtable` | passes |
| LX8 | `a\n:-:` | `mdtable` | passes |
| LX9 | `\| a \|\n\| :--- {width=240} \|\n\| 1 \|` | `mdtable` with `widths` `[240]` | passes |
| LX10 | `> - a\n> - a\nc\n> - a\nc\n<div>` | the tokens' `raw`s joined equal the source; the last token is `html` with `raw` `<div>` | fails |
| LX11 | `> - a\n> - a\nc\n> - a\nc\n1. g` | `raw`s joined equal the source; the last token is a `list` with `raw` `1. g` | fails |
| LX12 | `` > - a\nb\n> ```\nc `` | `raw`s joined equal the source; the last token is a `paragraph` with `raw` `c` | fails |
| LX13 | 5,000 `randomDocuments(5_000, RAW_SOURCE_POOL)` | for every document, the top-level `raw`s joined equal the document (collect failures into an array and expect it empty, like the twin test) | fails[^fuzz-witness] |

The two new `WINDOW_SOURCES` entries must lex identically to the twin (and in
their CRLF form), like every other entry.

### Viewer (`Markdown.test.ts`, modelled DOM)

| # | Source | Expected | Before |
|---|---|---|---|
| BF1 | `Foo\n---\nbar` | `createdTags()` contains `h2` and `p`, not `table` | fails |
| BF2 | `` ```\n---\n``` `` | contains `pre`, not `table`; a text write is `---` | fails |
| BF3 | `- foo\n-\n- bar` | no `table`; `childTagsOf('ul')` is `['LI', 'LI', 'LI']` | fails |
| BF4 | `***\n---\n___` | no `table`; the trimmed text writes include `***`, `---`, `___` | fails |
| BF5 | `> Foo\n---` | contains `blockquote`, not `table`; a trimmed text write is `---` | fails |
| BF6 | `> - a\nb\n\n---` | no `table`; a trimmed text write is `---` | fails |
| BF7 | `\| a \|\n\| - \|\n\| 1 \|` | one `th`, one `td` | passes |
| BF8 | `a \| b\n--- \| ---\n1 \| 2` | two `th`, two `td` | passes |
| BF9 | `a\n:-:` | contains `table` | passes |
| BF10 | `> - a\n> - a\nc\n> - a\nc\n<div>` | a text write is `<div>`; none is `div>` | fails |
| BF11 | `> - a\n> - a\nc\n> - a\nc\n1. g` | contains `ol`; a text write is `g`; none is `. g` | fails |
| BF12 | `- [ ] task` | `childTagsOf('li')` is `['SPAN', 'SPAN']`; text writes include `[ ] ` and `task`; no text write lands on an `LI` | fails |
| BF13 | `- [x] done\n- [ ] todo` | `childTagsOf('li')` is four `SPAN`s; text writes include `[x] `, `done`, `[ ] `, `todo`; no text write lands on an `LI` | fails |
| BF14 | `- [ ] see \[docs\]` | text writes include `[ ] ` and `see ` | passes |
| BF15 | `- a\n  - b` | `childTagsOf('li')` is `['UL']`; a text write of `a` lands on an `LI` (the sole-text path still serves a first token) | passes |

### Importer (`markdown-importer.test.ts`)

| # | Source | Expected | Before |
|---|---|---|---|
| VB1 | `Foo\n---\nbar` | `rootTypes` `['heading', 'paragraph']`; `expectSurface` | fails |
| VB2 | `` ```\n---\n``` `` | `rootTypes` `['code']`; `rootTexts` `['---']` | fails |
| VB3 | `- foo\n-\n- bar` | `rootTypes` `['list']`; `expectSurface` | fails |
| VB4 | `> - a\n> - a\nc\n> - a\nc\n<div>` | `rootTypes` `['markdown-raw-block', 'markdown-raw-block']`; `rootTexts` `['> - a\n> - a\nc\n> - a\nc', '<div>']` | fails |
| VB5 | `- [ ] task` | `expectSurface` | fails |

### Harness projection (`markdown-view-model.test.ts`)

`textRun` is the file's helper (line 28).

| # | Source | `viewerModel(source).blocks` |
|---|---|---|
| V16 | `- [ ] task` | one tight list, one item: `[{ kind: 'paragraph', runs: [textRun('[ ] task')] }]` |
| V18 | `- [ ] see \[docs\]` | one tight list, one item: paragraph `[textRun('[ ] see [docs]')]` |
| V19 | `- [ ] a\n\n- [x] b` | one loose list, items paragraph `[textRun('[ ] a')]` and paragraph `[textRun('[x] b')]` (passes before the change) |

### Harness baseline (`npx vitest run tests/component/markdown-roundtrip`)

On this plan's base, after `markdown-editor-source-preservation`, the
`taskListMarker` entries are `task-list marker` → `surface`, and
`task item text that saves escaped` → `canonical` and `surface` (its old
`parity` entry moved to `canonical` in that plan).

| Item | Expected |
|---|---|
| the three `taskListMarker` checks | fail with "now holds"; their `known` properties are deleted |
| `taskListMarker` in `DIVERGENCES` | deleted (the integrity test requires every reason to be used) |
| every other known entry | unchanged |
| CommonMark 43, 59, 92, 234, 281 | still pass every check (viewer and editor now both read the CommonMark blocks) |
| C1 `code fence holding a dash line`: `` ```\n---\n``` `` | every check holds |
| C2 `thematic break after a quote list with a lazy line`: `> - a\nb\n\n---` | `known: { surface: 'quoteBlocks' }` |
| C3 `html line right after a quote list with lazy lines`: `> - a\n> - a\nc\n> - a\nc\n<div>` | `known: { surface: 'quoteBlocks' }` |
| C4 `ordered item right after a quote list with lazy lines`: `> - a\n> - a\nc\n> - a\nc\n1. g` | `known: { surface: 'quoteBlocks' }` |
| C5 `checked and unchecked task items`: `- [x] done\n- [ ] todo` | every check holds |

---

## Verification

- `npx vitest run tests/component/display tests/component/markdown-roundtrip tests/component/markdown-importer.test.ts tests/component/markdown-serializer.test.ts tests/component/markdown-editor.test.ts`
  (from `packages/lib`).
- `npm run test` (from `packages/lib`).
- From the repo root: `npm run typecheck`, `npm run lint`, `npm run docs:api`
  (zero warnings), `npm run docs:llms:check`.
- `grep -rn 'TABLE_EXTENSION\|pipeless\|replacesItemContent' packages/lib/src packages/lib/tests`
  — zero matches.
- Manual M1: `npm run dev` → **MD Editor**, source mode. Replace the text
  with these lines: `Title`, `---`, an empty line, `- [ ] task`, an empty
  line, `> - a`, `> - a`, `c`, `> - a`, `c`, `<div>`. The live viewer shows
  an `h2` "Title" (no table), a list item reading `[ ] task`, and a last
  line `<div>` with its `<`. Switch to WYSIWYG: "Title" is a heading there
  too.

---

## Documentation Impact

No public API changes; both modules stay internal (neither is re-exported
from `component/display/index.ts`).

- **`docs/components/Markdown.md`**:
  - After the lists row ([:57](packages/lib/docs/components/Markdown.md#L57)),
    add:
    ```markdown
    | `- [ ] task`, `- [x] done` | an `<li>` whose text starts with the literal `[ ]` / `[x]` marker — no checkbox |
    ```
  - Before the paragraph starting "A delimiter row's alignment markers"
    ([:68](packages/lib/docs/components/Markdown.md#L68)), add a paragraph:
    ```markdown
    A table is a header row followed directly by a delimiter row with the same number of cells, and the delimiter row must hold at least one `|` or `:` — so a line over `---` is a setext heading, as GFM specifies, and a one-column table is written with its pipes (`| a |` over `| --- |`). Indented or fenced code, an ATX heading, a thematic break, a blockquote, a list or an HTML block that starts on the header line wins over a table. The body runs to the first blank line.
    ```
- **`docs/reference/changelog/next.md`** — append to **Fixed › Components**,
  after the "**`Markdown` renders hard line breaks.**" entry:
  ```markdown
  - **`Markdown` no longer reads a table where another block starts.** A line
    over `---` rendered as a one-column table: a setext heading, a thematic
    break after a blockquote or a blank line, a fenced code block whose first
    line is `---`, and a list with a bare `-` item all came out as tables. A
    table now needs a delimiter row holding a `|` or `:`, and code, headings,
    thematic breaks, blockquotes, lists and HTML blocks win over it, as GFM
    specifies. `MarkdownEditor` loads these documents the same way. A
    document that relied on a one-column table without pipes must add them.

  - **`Markdown` shows a task-list item's marker.** `- [ ] task` rendered
    only `task`; it now renders `[ ] task`, as it already did when the
    item's text held an escape or formatting. The marker is still literal
    text, not a checkbox. No consumer action is needed.

  - **`Markdown` no longer drops a character after a blockquote.** When a
    list inside a blockquote ran on through a lazy line, the line straight
    after the quote could lose its first character, so `<div>` showed as
    `div>` and `1. g` as `. g`. No consumer action is needed.
  ```

---

## Potential Challenges

- **The `table` slot's return type.** `TokenizerObject` types `table` as
  returning `Tokens.Table`; the single cast lives in `dialectTable` with its
  reason in the JSDoc, so no other site needs one.
- **The complexity test still counts `marked`'s `table` regex.** `measureScan`
  instruments it, but nothing runs it any more; its count drops to zero and
  the linear-growth bound still holds. Leave `SLOW_RULES` as it is.
- **The source-preservation plan's own tests.** A row there that loads a
  `---`-shaped document would now see a heading or thematic break instead of
  a table. If one fails, its expectation describes the old table defect:
  update it to the CommonMark reading and record it in the Implementation
  Notes.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/display/markdownExtensions.ts`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts) — `BOUNDED_BLOCK_TOKENIZERS` (318), the precedent for replacing a built-in tokenizer in its slot; `blockWindow` (217); `lexMarkdownUnbounded` (371).
- [`packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts`](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts) — the tokenizer body that moves (164).
- [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts) — `appendListItem` (1724), `appendInlineTokens` / `appendInlineToken`'s `sole` branch (1955, 1975).
- [`packages/lib/tests/component/display/markdownLexer.test.ts`](packages/lib/tests/component/display/markdownLexer.test.ts) — the twin tests, `LINE_POOL` and `randomDocuments`.
- [`packages/lib/tests/component/markdown-roundtrip/viewModel.ts`](packages/lib/tests/component/markdown-roundtrip/viewModel.ts) — `viewerListItem` (297).
- [`packages/lib/src/typescript/lib/component/editor/markdownImporter.ts`](packages/lib/src/typescript/lib/component/editor/markdownImporter.ts) — `locateTokens` and `$buildListItem`, read-only here, to see why the importer needs no change.
- `node_modules/marked/lib/marked.esm.js` — the `Lexer.blockTokens` rule order and the `blockquote` tokenizer's list branch.

---

## Non-Goals

- **Table body rows ending at another block.** GFM, and `marked`, also end a
  table's body at a line that opens another block; the dialect's body still
  runs to the first blank line.[^body-rows]
- **Real checkboxes for task items.** The parity rule needs the editor to
  model them first.[^task-literal]
- **Entity references shown as written** (`&amp;` shows `&amp;`). No note
  defers it to a viewer plan: the serializer plan records it as the viewer's
  behaviour, and the editor now reads the same tokens, so a change needs both
  halves.
- **`[link [foo [bar]]](/uri)` shown as literal text** (CommonMark 512). This
  is `marked`'s own link rule, the viewer and editor agree on it, and no note
  defers it to a viewer plan.
- **Titled images (`![foo](/url "title")`) shown as their alt text.** The
  dialect's image rule takes no title, the viewer and editor agree, and no
  note defers it to a viewer plan.
- **Thematic breaks as `<hr>`.** They keep rendering as literal text through
  the existing fallback; the docs' syntax table does not list them.
- **A loose task list loads in the editor as a raw block.** An importer
  limitation that exists before this plan.[^loose-task]
- **The importer's whitespace-insensitive match (`REBUILT_RAW_TYPES`).** With
  exact blockquote `raw`s it is no longer needed for a top-level quote; it
  stays as a harmless fallback, and removing it is an editor cleanup.[^importer-unchanged]

---

## Notes

[^table-slot]: `marked`'s `Lexer.blockTokens` runs block extensions first,
    then `space`, `code`, `fences`, `heading`, `hr`, `blockquote`, `list`,
    `html`, `def`, `table`, `lheading`, `paragraph`. A tokenizer in the
    `table` slot therefore gets the same precedence `marked`'s GFM table has,
    by construction. The alternative — keeping the extension and adding
    guards that decline when another block starts on the header line — would
    re-implement the rules for six block kinds (including `marked`'s long
    HTML-block tag list) and could not call those tokenizers to ask, since
    the blockquote and list tokenizers recurse into the lexer and queue
    inline work. The rich-formatting plan chose an extension *because* it
    runs ahead of the built-ins ("which is what lets `mdtable` replace the GFM
    table"); that ordering is the defect. `marked`'s own table tokenizer is
    no longer reached at all, which is intended: the dialect's tokenizer
    accepts everything it accepts. A sweep that lexed all 948 tracked
    Markdown files in the repository with the old and new lexer changed 327
    of them, every one under `plans/`: each first difference was an
    over-matched `mdtable` becoming an `hr` (217), a `heading` (78), a `list`
    (31) or a `code` block (1), mostly YAML frontmatter and `---` rules. No
    file under `packages/lib/docs/` changed.

[^delimiter-marker]: `marked` 18.0.9's `table` tokenizer returns nothing
    unless `tableDelimiter` (`/[:|]/`) matches the delimiter row, with the
    source comment that a row without either "is a setext heading". The
    precedence order alone does not settle `Foo\n---`, because `lheading`
    comes *after* `table`; this check is what does. GFM's spec examples
    likewise never form a table from a pipe-less delimiter row. The dialect's
    serializer always writes fully piped tables, so nothing the editor saves
    is affected.

[^quote-raw-cause]: In `marked` 18.0.9's `blockquote` tokenizer (the same
    code is on `marked`'s `master` today), when the quote's last child is a
    list and lines remain, it re-lexes the list together with the following
    lines (`this.list(oldToken.raw + "\n" + lines.join("\n"))`) and patches
    `raw` with `raw.substring(0, raw.length - lastToken.raw.length) + newToken.raw`.
    The removed length is measured in the stripped text (no `>` markers)
    while `raw` holds the marked lines, so the content becomes garbage
    (`> - - a\n- a\nc`). The remaining lines are then
    `newText.substring(newToken.raw.length).split("\n")`, whose first element
    is the empty string before the newline the list did not take; the next
    pass joins it with another `\n`, so each such re-read makes `raw` one
    character longer than the source used. The lexer advances by
    `raw.length`, so the next block loses one character. The original fuzz
    reports (`div>`, `. g`) came from documents where two such re-reads
    happened inside one quote.

[^quote-snap]: The loop in `marked`'s tokenizer only ever reads lines of the
    blockquote rule's own match, and it stops early only when the last child
    is a code block and lines remain; it then stops at the end of a `>` line
    that a lazy line follows. So the source used always ends at one of the
    candidate ends, and `marked`'s `raw` is never shorter than it. When the
    loop runs out of lines, the source used is the whole match, which is the
    largest candidate: exact. After a code block, consecutive candidates are
    at least four characters apart (a newline, a lazy line, a newline and a
    `>`), so the snap is exact unless four or more lazy list re-reads happen
    in one quote before the code block. A planning probe checked the rule
    on 200,000 random documents of quote, list, lazy, code-fence, HTML and
    pipe lines: the top-level `raw`s joined back into the source every time,
    and the bounded lexer matched the twin. The alternative of copying
    `marked`'s tokenizer with the arithmetic fixed was rejected: it means
    maintaining a copy of third-party code that drifts on every `marked`
    upgrade.

[^task-literal]: `MarkdownEditor` has no task-list node. Its importer keeps a
    checkbox token's `[ ] ` as a source text node, so the editor shows the
    marker as text. The viewer/editor parity rule requires both halves to
    support the same syntax, so a real `<input type="checkbox">` in the
    viewer would first need a task-list node in the editor. Literal text is
    also what the viewer already printed for a loose item and for a tight
    item whose text held an escape — the overwrite was the only path that
    hid it. The harness plan's rule table and the marked-import plan's notes
    both describe the marker as raw text the viewer should show.

[^sole-path]: `appendInlineTokens` computes `sole` as "this is the only
    inline token" and passes it to `appendInlineToken`, whose `text` branch
    then calls `DOM.sink.apply(parent, { text })`. That sets the parent's
    whole text content, which is only right when nothing else is in the
    parent. A tight task item's tokens are `[checkbox, text]`; the checkbox
    falls through `appendBlockToken`'s default to a `<span>[ ] </span>`, and
    the text token's single plain child then takes the sole path and
    replaces it. Only a token that is not the item's first can follow
    something already rendered, so restricting the sole path to the first
    token is the whole fix; a first token, and every other caller of
    `appendInlineTokens`, keep today's DOM.

[^importer-unchanged]: Checked with a planning prototype of this plan on
    `feature/markdown-editor-reference-links`: the full `packages/lib` test
    suite passed except the four checks this plan flips (the three
    `taskListMarker` entries and V16). Loading the defect documents into the
    editor gave a heading and paragraph for `Foo\n---\nbar`, a code node for
    the fence, one list for `- foo\n-\n- bar`, two raw blocks (`> - a…c` and
    `<div>`) for the quote case, and an editor surface equal to the viewer's
    for every task item. `locateTokens` already tolerated rebuilt `raw`s by
    matching with whitespace ignored; with exact `raw`s the exact match
    succeeds first. The importer tests also passed with `REBUILT_RAW_TYPES`
    emptied, but the fallback still covers a quote's `text`, which this plan
    leaves as `marked` built it.

[^fuzz-witness]: In the planning probe, the same generator drawing 20,000
    documents from `RAW_SOURCE_POOL` found 981 whose `raw`s did not join back
    into the source on the unfixed lexer, and none after the fix, in about
    0.4 s. 5,000 draws therefore catch the defect about 245 times.

[^body-rows]: `marked`'s table rule stops body rows at a line that starts a
    thematic break, heading, blockquote, code block, fence, list item or HTML
    block (`| a |\n| --- |\n- item` is a table then a list there). The
    dialect's body runs to the first blank line, so it reads `- item` as a
    row. No harness, fuzz or note reported this; the deferred defects are all
    about where a table *starts*. Changing it changes which lines of existing
    documents become rows, so it belongs in its own plan.

[^loose-task]: For `- [ ] a\n\n- [x] b`, `marked` strips the marker from
    the item's `text` (`a`) but keeps it in the paragraph's `raw`
    (`[ ] a`), so `$buildListItem`'s coverage check cannot locate the
    paragraph and keeps the whole list as a raw block. The viewer is right
    here before and after this plan; the fix is in the importer, which is
    editor work outside this viewer plan.

---

## Implementation Notes

- **No per-step audit (user decision).** The worker's audit/fix loop was not
  run for this plan; the user replaced per-step audits with one fresh
  whole-stack review plus a fuzz pass after the last step of the stack.
- **Reconciled with reference-links and source-preservation.** The display
  files, `viewModel.ts`'s viewer side and every anchor in *Internal
  Structure* held. Drifted lines: `task-list marker` is at `dialect.ts:34`
  (plan: 30), `taskListMarker` at `divergences.ts:21` (plan: 22), and the
  lexer's generated-documents `describe` ends at 315 (plan: 311).
  `plans/in-progress/` did not exist on this base and was created. None of
  the source-preservation plan's tests loaded a `---`-shaped document, so no
  expectation there needed updating (*Potential Challenges*, third bullet).
- **Harness baseline.** Before: 31 known entries (`quoteBlocks` 16 surface,
  `listItemBlocks` 7 surface, `listMarkers` 4 — parity, verbatim, canonical,
  surface — `taskListMarker` 3 — surface 2, canonical 1 — and `plainImage`
  1). After the projection fix exactly the three `taskListMarker` checks
  failed with "now holds"; their `known` properties and the reason were
  deleted. C1–C5 were appended: C1 and C5 hold every check, including the
  `verbatim`, `canonical` and `canonicalIdempotence` checks the
  source-preservation plan added; C2–C4 fail only `surface`, as `quoteBlocks`.
  After: 31 entries (`quoteBlocks` 19, `listItemBlocks` 7, `listMarkers` 4,
  `plainImage` 1). Every other entry is unchanged, and CommonMark 43, 59, 92,
  234 and 281 pass every check.
- **Test-first record.** With the tests of steps 1–3 written, exactly the
  rows marked "fails" failed (LX1–LX6, LX10–LX13, BF1–BF6, BF10–BF13,
  VB1–VB5) and everything else passed. After step 5 only BF12, BF13 and VB5
  failed; after step 6 only VB5; V16 and V18 failed before the projection
  change and passed after it.
- **Two code commits and two documentation commits.** The task-marker fix
  is independent of the two lexer fixes (it touches no lexer code), so it
  has its own code and docs commits; the table and blockquote fixes share
  `DIALECT_BLOCK_TOKENIZERS` and are one commit.
- **Comments the change made stale, beyond the plan's list.** In
  `markdownExtensions.ts`: `SPACES_ONLY_LINE`'s JSDoc no longer lists a
  `table` body row among the windowed constructs (and its tab-only sentence
  now gives the reason that still holds); `blockWindow`'s "five windowed"
  became "four"; `lexMarkdown`'s "Six of `marked`'s own block rules run
  behind a guard and a window" became "Six block rules run behind a guard
  and, where they need one, a window". In `markdownTableExtension.ts`,
  `MdTableToken`'s JSDoc names `tokenizeTable` instead of "this extension",
  and `tokenizeTable`'s JSDoc says that `marked`'s delimiter regex rejects
  `{width=…}` cells while `<<` / `^^` merges are resolved (the plan's
  wording put both under "rejects"). The lexer test file's existing
  `describe` titles ("the table extension emits …") were left as written.
- **Test helpers.** `typesOf` and `joinedRaws` are module-level helpers in
  `markdownLexer.test.ts`; `Markdown.test.ts` gained `trimmedTextWrites` and
  `textWriteTags` (the "no text write lands on an `LI`" filter) next to the
  new `describe`s.
- **Changelog placement.** The table entry sits under *Fixed* as the plan
  says, although a document that relied on a pipe-less one-column table now
  needs its pipes; the user may prefer it under *Breaking changes*.
- **Verification.** `npm run test` (543 files, 11,518 tests), `npm run
  typecheck`, `npm run lint`, `npm run docs:api` (zero warnings),
  `npm run docs:llms:check` and `npm run build:lib` all pass; the plan's
  grep for `TABLE_EXTENSION`, `pipeless` and `replacesItemContent` finds
  nothing.
- **Manual M1** in the MD Editor demo (`vite`, Chrome), source mode: the
  viewer showed an `h2` "Title" (no table), a list item reading `[ ] task`
  and a last line `<div>` with its `<`. In WYSIWYG mode "Title" is a
  heading, the task item shows `[ ] task`, and the quote and `<div>` are two
  raw blocks. No console errors.

### Whole-stack review fixes

- **Restacked onto the A2 task-marker fix** (plan
  `markdown-viewer-link-reference-definitions`, branch
  `feature/markdown-viewer-link-reference-definitions`): `marked`'s list
  tokenizer now takes a task item's marker off the item's own first text only.
  The rebase conflicted in `markdownExtensions.ts`, resolved as the union:
  `DIALECT_BLOCK_TOKENIZERS` holds `blockquote`, `list` and `table`, and the
  `BOUNDED_BLOCK_TOKENIZERS` and `lexMarkdownUnbounded` docs name all three.
- **Harness projection of a checkbox before a paragraph.** `viewerListItem`
  only gave the checkbox to a following `text` token. When `marked` makes an
  item loose after lexing it (`- [ ] foo\n\n  [x] bar`), the checkbox stays a
  separate item token followed by a `paragraph`; the viewer prints the marker
  as a span of its own before the `<p>`s, and the projection dropped it. It now
  projects that checkbox as the raw fallback block it renders as. Pinned by
  `markdown-view-model.test.ts` V20 (failed before the fix) and V21 (a later
  table cell keeps `[x] `), and by `Markdown.test.ts` BF16 for the viewer
  output the projection follows. No corpus entry changes: no entry holds a
  multi-block task item.
- **Review A: docs and comments made exact.**
  - The changelog entry for the table rule moved from *Fixed* to *Breaking
    changes* (user decision) and states the rule as it is: a delimiter row
    must hold a `|` or a `:`, so `a` over `:-:` is still a one-column table
    and only an all-dash delimiter row (`a` over `---`) needs one added. The
    component page said a one-column table "is written with its pipes"; it
    now says the same rule.
  - Thematic breaks: a `---` that starts no other block lexes as `hr`, which
    the viewer has always rendered through its plain-text fallback — so the
    `---` lines that used to come out as empty-header tables now show as
    literal `---`. The changelog no longer suggests a rendered rule, and the
    fallback lists in `Markdown.md` and `Markdown`'s class doc name the
    thematic break. Rendering it as `<hr>` is a one-case change in the
    viewer, but not a safe one alone: the editor keeps a thematic break as a
    raw `---` block, so the viewer/editor parity rule needs a
    horizontal-rule node in the editor first. Left for its own plan.
  - The blocks that win over a table now include link reference definitions
    and `:::` fences, which `marked` and the dialect try before the table
    slot.
  - `BOUNDED_BLOCK_TOKENIZERS`' doc no longer says all six slots run
    anchored `marked` regexes: five do (`blockquote` and `list` through the
    dialect's wrappers); `table` is the dialect's own tokenizer.
  - Two `markdownLexer.test.ts` describe titles said "the table extension";
    they say "the table tokenizer". `trimmedTextWrites` and `textWriteTags`
    moved up beside the other sink helpers in `Markdown.test.ts`.
  - `quotedSourceEnd`'s doc now gives [^quote-snap]'s bound: the snap can
    be a candidate late only after four or more lazy list re-reads before a
    code block. No document showing it has been found — the planning probe,
    the review's fuzz and a further 185,000-document probe of quote, list,
    lazy and fence lines all rejoined the source — so it is stated as a
    bound, not a known case.
- **A loose task item's marker starts its first paragraph (user decision:
  "Inline, viewer changes").** In an item `marked` makes loose after lexing
  it (a blank line before its nested list or second paragraph), the
  checkbox stays an item token of its own before the first `paragraph`,
  and the viewer printed its `[ ]` / `[x]` as a span on its own line above
  the item's text. `appendListItem` now prints it at the start of that
  paragraph — the paragraph rendered with the checkbox as its first inline
  token, which is exactly how `marked` lexes an item loose from the start,
  and how GFM shows it. The harness projection (`viewerListItem`) follows
  (V20 now expects `[ ] foo` in one paragraph; new V22 pins the nested-list
  case against a list loose from the start), and BF16/BF17 pin the viewer
  output. With the marker inline, the importer's reason to keep such a list
  as source is gone: `$buildListItem` now takes a checkbox before a
  paragraph as it takes one before text, so `- [x] a` over a blank line and
  `  - b` loads as a list (surface parity holds, the save is unchanged), and
  the corpus entry "task item whose nested list follows a blank line" drops
  its `listItemBlocks` known divergence. An item with a second paragraph
  still loads as source, as any item holding more than one paragraph does.
  The `Markdown.md` syntax row and the task-marker changelog entry say so.
- **Migration note for the table rule.** The *Breaking changes* entry for
  the table rule had no migration note, unlike the other breaking entries;
  `docs/reference/migration/next.md` gains "`Markdown` reads a table only
  where no other block starts" (what changed and why, a before/after table,
  who needs to act, with a before/after example), and the changelog entry
  links it with "See [Migration](/reference/migration/next) for the full
  note.", as the others do.
