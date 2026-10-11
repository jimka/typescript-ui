---
depends-on: [markdown-editor-paste-undo-merge]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/markdownImporter.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/tests/component/markdown-editor-list-item-edits.test.ts
  - packages/lib/tests/component/markdown-editor-list-item-paste.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Raw Block Edge Cases — Implementation Plan

## Overview

In `MarkdownEditor`'s WYSIWYG mode, a *raw block* (`MarkdownRawBlockNode`) holds Markdown the editor has no rich-text form for. The editor shows its source, and a save writes it. A raw block inside a list item follows one rule: its text must read in the item exactly as it reads alone (`rawBlockStandsInItem`). Outside list items there is no such rule, so a raw block's reading can depend on the blocks next to it.

This plan gives the rule its counterpart for a *block list*: the document's top-level blocks, or the blocks of one `:::` column. It fixes six defects. Five have one cause: a raw block is read, written or counted without regard to where it stands. The sixth is a caret calculation.

The changes are in [markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts), [markdownImporter.ts](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts) and [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts). The lexer (`markdownExtensions.ts`) and `MarkdownEditor.ts` are not touched. The round-trip harness gains one check, the corpus gains cases, rows are added to existing table-driven test files, and the docs page and the changelog are updated. There is no public API change.

The plan is written against `85b55a8f4`, the tip of `feature/markdown-editor-paste-undo-merge`. Line numbers are from that commit. Sibling plans edit the same files, so find each site by its symbol name. Every snippet below was run as printed, as a patch applied in memory to that commit; see the [addendum](#addendum-measurements).

---

## Root Cause

`⏎` is a line end. `"text"`@n is offset n in the text node holding exactly that text.

| # | Source | Edit | The editor shows | Saved today | What the viewer and a reload read in that save |
|---|---|---|---|---|---|
| 1 | `p⏎⏎  > q⏎  <div⏎⏎z` (the quote and the line after it indented two spaces) | type `X` after `q` | a quote `qX`, then a raw block `<div` | `p⏎⏎> qX⏎⏎<div⏎⏎⏎z` | the same as the editor, but `<div` has left the quote the source held it in. The viewer reads the source as one quote holding `q` and `<div`. With no edit at all, the document's *standard form* (what a save writes for a block once it is edited, in place of its loaded source) already reads so |
| 2 | `- a⏎  > x⏎⏎<div>⏎y⏎</div>` (a raw list, then a raw block) | type two spaces before `<div>` | a raw list and a raw block | `- a⏎  > x⏎⏎  <div>⏎y⏎</div>` | one list whose item holds the quote and the HTML block |
| 3 | `- w⏎⏎<div>⏎⏎- n⏎  > q` (a list, a raw block, a raw list) | select `<div>`, Backspace | a list, an empty raw block, a raw list | `- w⏎⏎- n⏎  > q` | one list of two items |
| 4 | `::: columns⏎<div⏎\|\|\|⏎[x]: /u⏎:::⏎⏎b [x] c` | type `X` after `b` | a reference link `x` | `…⏎⏎bX [x](/u) c` | an inline link; the reference form is gone. With a title holding a blank line the link also loses its title |
| 5 | `<div⏎⏎⏎b` | type `X` after `b` | a raw block `<div`, a paragraph `bX` | `<div⏎⏎bX` | one HTML block holding `bX` |
| 6 | `<pre>⏎x1⏎x2⏎</pre>` | paste the text `⏎</pre>⏎⏎<pre>⏎⏎` after `x1` | — | — | the paste throws `$getTextNodeOffset: invalid offset -1` |
| 7 | `<div>⏎raw text⏎</div>⏎⏎after` | select from after `<` to after `a` of `after`, Enter | one paragraph | `<⏎fter` | differs from Delete then Enter (`<⏎⏎fter`) |

In the table `\|` stands for `|`.

| Cause | Defects | Where |
|---|---|---|
| **A. The load drops indentation a raw block's reading needs.** `rawBlockAtMargin` removes the indentation before a raw block (a *dedent*) when the text without it reads the same *alone*. `> q⏎<div` reads as one quote where its input ends and as a quote and an HTML block before a line end, so the dedented text only means what the source meant while it is the last block. | 1 | [markdownSerializer.ts:1782](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1782) |
| **B. Outside a list item a raw block is written as typed.** `$rawBlockSource` drops the indentation and the blank edge lines that mean nothing only for a raw block of a list item. At the top level typed spaces are written, and a list above takes the block in. | 2 | [markdownSerializer.ts:1624](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1624) |
| **C. A raw block that writes nothing still counts as a neighbour.** `serializeListApart` looks for the block after a list and skips only empty paragraphs, so an emptied raw block hides the raw list behind it. | 3 | [markdownSerializer.ts:1484](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1484) |
| **D. A raw block written as its loaded source loses its second blank line.** `<div` is an HTML block that only a second blank line ends. `serializeRawBlock` writes that line, but `writtenBlocks` writes an unedited top-level block as its source and separates it from an edited block with one blank line. | 5 | [markdownSerializer.ts:1195](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1195) |
| **E. The document's definitions are read from the raw blocks' text joined as if all stood at the top level.** A raw block that does not end at one blank line (`<div`, `<!-- c`) is confined by its column or list item in the document, but in the joined text it takes in the definition after it. The editor then holds fewer definitions than the viewer, or another first definition for a label. | 4 | [markdownSerializer.ts:739](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L739) |
| **F. A caret offset on a line that holds no text walks below zero.** `$selectTextOffset` subtracts each line break from the offset and selects in the next text node with whatever is left, also when that is negative. | 6 | [markdownWritable.ts:1041](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1041) |
| **G. A route's insert runs before the raw block is read again.** | 7 | the sibling plan `markdown-editor-raw-block-range-edits`; not planned here |

Causes A to E are one: nothing asks, for a raw block of a block list, whether its text reads where it is written as it reads alone.

---

## Architecture Decisions

### One rule — a raw block is written in a form that reads where it is written as it reads alone

The rule for every raw block, wherever it stands:

> A raw block is written in its *written form*. `marked` must read that form, where the save writes it, as exactly the blocks it reads the form as alone, and must read the blocks around it as it reads them without it. Where a text has no such form at a place, the editor holds no raw block of it there: the smallest piece around it that does read back is the raw block.

This generalises the list-item rule `rawBlockStandsInItem` ([markdownSerializer.ts:1672](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1672)), which stays as it is.[^one-rule] In a list item the written form is the *item form* (`rawBlockInItem`): the text from its first line that holds something to its last, without the indentation before it that means nothing to Markdown. The same three sites keep the rule at each place: the save, the load and an edit.

| Place | Checked by | When the text does not read back there | When an edit breaks it |
|---|---|---|---|
| a block of a list item | `rawBlockStandsInItem`: the item form written at five places of an item (unchanged) | the list is the raw block: of the item around it when it is nested, else of the block list (unchanged) | the outermost list is shown anew as its save reads, `$readListAgainAroundRawBlock` (unchanged) |
| a block of the document or of a `:::` column | the margin rule (`rawBlockAtMargin`, which decides how much indentation a raw block loses): the form reads the same where its input ends and before a line end (**new**); the writer keeps the blocks around it apart (two gaps closed) | the raw block keeps the indentation its reading needs (**new**). It is always built: its text is the source | the raw block is shown as the blocks its text reads as before a line end, `$showRawBlockAsItsBlocks` (unchanged) |
| inside a quote | — a quote node holds one paragraph and no block | the whole quote is the raw block (`$buildQuote` returns `null`, unchanged), judged at the place the quote stands | as for that place |

### A raw block of a block list gets a written form too — `rawBlockInBlockList`

`$rawBlockSource` returns the item form (`rawBlockInItem`, unchanged) for a raw block of a list item, and a new *block-list form* for every other raw block. The block-list form drops what the item form drops, except the spaces that end the last line.[^block-list-form]

| Raw block's text in the editor | Block-list form | Why |
|---|---|---|
| `  <div>⏎y⏎</div>` | `<div>⏎y⏎</div>` | up to three spaces before a block mean nothing, and a list above would take the block in |
| `⏎<div>`, `<div>⏎`, `<div>⏎` and a line of spaces | `<div>` | a blank edge line is only space between blocks |
| two spaces and nothing else | nothing | whitespace alone is no block |
| `  - x⏎  - y⏎- z⏎  > q` | unchanged | without the spaces `y` would nest under `x` |
| `> q⏎  <div` | unchanged | the first line is at the margin; the second line's spaces keep it in the quote |
| `</div>` followed by two spaces | unchanged | spaces that end a line can be content: in `` >``` `` over `>` and two spaces, the last line is a code line holding one space |

### The margin rule compares the reading at both places of a block list

`rawBlockAtMargin` keeps a dedent only when the dedented text reads as the source does at both places a block of a block list can stand: where its input ends, and before a line end. It also tries one more candidate, last: the first line alone at the margin, every other line as written.[^margin]

| Source | Candidate | Reads where its input ends | Reads before a line end | Kept |
|---|---|---|---|---|
| `  > q⏎  <div` | (the source) | a quote holding a paragraph and an HTML block | the same | |
| | `> q⏎<div` (every line at the margin) | a quote holding a paragraph and an HTML block | a quote, then an HTML block | no |
| | `> q⏎  <div` (the first line only) | a quote holding a paragraph and an HTML block | the same | **yes** |
| `  <div>⏎  x⏎  </div>` | `<div>⏎x⏎</div>` | an HTML block | an HTML block | yes, as today |
| `  > q⏎<div` | `> q⏎<div` | a quote holding both | a quote, then an HTML block; the source reads so too | yes, as today |

The last row is a text that reads by its place whatever its indentation. Such a raw block is built only where its input ends (the last block of the document or of a column), and any edit of it, or a block added after it, shows it as a quote and a raw block. That is today's behaviour and it stays.[^eof-quote]

### A block list keeps its blocks apart by how it writes them — only a list item is read again

At a block list the editor never re-reads a raw block together with its neighbours. The save writes each block so that it reads where it is written as it reads alone, as `serializeListApart` and `LIST_SEPARATOR` already do for lists.[^no-new-reread] After this plan:

| What a neighbour could do | What the save writes | Status |
|---|---|---|
| the raw block before runs on (`<!--` without `-->`) and would take the next block in | the raw block as a paragraph (`$rawBlockWritesAsParagraph`) | existing |
| the raw block before ends only at a second blank line (`<div`) | one more line end after it (`serializeRawBlock`) | existing; **now also when that block is written as its loaded source** |
| a list or raw list before would take an indented block in | the block's written form, which has no indentation that means nothing | **new** |
| the same, where the indentation is part of what a raw list reads as | a `[//]: #` line between them (`serializeListApart`, `listsJoin`) | existing |
| a list, then only blocks that write nothing, then a raw list | the list's other marker, or a `[//]: #` line (`serializeListApart`) | existing for an empty paragraph; **now also for an emptied raw block** |
| a `:::` line in a column | the raw block as a paragraph (`breaksColumn`) | existing |

A top-level block written as its loaded source falls under the same table through `writtenBlocks`, which already writes the standard form in place of the source when what follows would change the source's reading (`labelClosedAfter`, `fenceClosedAfter`). One more condition joins those two.[^wide-check]

### The document's definitions are read raw block by raw block

The editor's set of link reference definitions is each raw block's own definitions, read from its written form alone, in document order, the first definition of a label winning. One function reads it, and every site that reads definitions uses it: the serializer, the importer and the definition rule in `markdownWritable.ts`.[^per-block]

| Document | Viewer | Editor today | Editor after |
|---|---|---|---|
| a column ending in `<div`, the next column holding `[x]: /u` | `x` → `/u` | no definition | `x` → `/u` |
| the same, then `[x]: /v` after the fence | `x` → `/u` | `x` → `/v` | `x` → `/u` |
| `<div`, two blank lines, `[x]: /u` at the top level | `x` → `/u` | no definition | `x` → `/u` |
| `[constructor]: /u` | `constructor` → `/u` | the same | the same |

`$definitionsSource` stays the text two states are compared by, now as the JSON of the raw blocks' written forms, so that two raw blocks never compare equal to one raw block holding both texts.[^json-source] The merged map has no prototype, as `marked`'s own has none.[^null-proto]

Each raw-block text is lexed once and remembered. A save of a document whose raw blocks did not change since they were last read therefore lexes no definition, which changes one existing test; see [Existing tests that change](#existing-tests-that-change).

### A caret offset on a line that holds no text becomes an element point

`$selectTextOffset` selects inside a text node when the offset falls in one, and at an element point before a line break when the offset falls exactly there. The remaining offset never goes below zero.[^caret-walk]

| Block's children | Offset | Today | After |
|---|---|---|---|
| `"<pre>"`, break, break, break, `"x2"` | 5 | `"<pre>"`@5 | the same |
| | 6 | `"x2"`@-2, which throws | element point 2 (the first empty line) |
| | 7 | `"x2"`@-1, which throws | element point 3 (the second empty line) |
| | 8 | `"x2"`@0 | the same |

### The harness checks that the editor and the viewer hold the same definitions

The round-trip harness gains a seventh check, `definitions`: the definitions the editor reads off its document equal the ones the viewer's lexer reads off the save. It runs for every corpus case, in the edit fuzz after every edit sequence, and after every step of every row of `markdown-editor-list-item-edits.test.ts`.[^definitions-check] The label `//` is left out when only a `[//]: #` line the save itself wrote defines it.

### Three list-item rows change — a quote whose last line is indented deeper is a raw block of its item

The margin rule is one function for every place, so its new candidate also applies to a raw block of a list item. Three existing rows pin lists that stay raw because their quote's dedented text reads by what follows it. With the indentation kept on the quote's later line, the quote reads the same wherever it stands in the item, and those lists load as lists.[^item-flip]

| Source | Loads today | Loads after |
|---|---|---|
| `- a⏎⏎→> q⏎→</div` (`→` is a tab) | one raw block | a list; its item holds the raw block `> q⏎  </div` |
| `- a⏎⏎   > q⏎   <div⏎- z` | one raw block | a list; its first item holds the raw block `> q⏎ <div` |
| `* w0⏎→> q1⏎→<div⏎→::: {align=center}⏎→f2⏎→:::⏎* w3⏎⏎→p` | one raw block | a list; its first item holds the quote, with the four lines it takes in, as one raw block |
| `- a⏎⏎  > q⏎  <div⏎- z` (the last line no deeper than the quote) | one raw block | one raw block (unchanged) |

### The rows go into the existing table-driven test files

No test file is created. The rows that load a document and edit it go into `markdown-editor-list-item-edits.test.ts`, whose `Row` and `runRow` they use. The paste rows go into `markdown-editor-list-item-paste.test.ts`. The documents go into the round-trip corpus.[^rows-in-files]

### Order with the two plans that follow

Three unstarted plans change how a raw block is read, written or removed. They are implemented in this order:

| Order | Plan | What it needs from the plan before it |
|---|---|---|
| 1 | `markdown-editor-raw-block-edge-cases` (this plan) | nothing |
| 2 | `markdown-editor-raw-block-range-edits` | the caret fix of this plan: it reads a raw block again from inside a range removal, which reaches `$selectTextOffset` |
| 3 | `markdown-editor-cross-item-range-removal` | the names and the third guarded shape of plan 2 |

Defect 7 is plan 2's and nothing here covers it.[^order] This plan does not rename or restructure the raw-block transform (`$showRawBlockAsSaved` inside `registerRawBlockRules`), which plan 2 moves to module level and exports.

### No public API change

Every changed symbol is module-internal to the editor folder. `MarkdownEditor`'s methods, options and events are unchanged.

---

## Internal Structure

Write full JSDoc per CODE_CONVENTIONS for every new function; the bodies are below. A call's result is assigned to a constant before it is tested, as elsewhere in these files.

### `markdownSerializer.ts` — the block-list form

Add `BLANK_LAST_LINES` directly after `BLANK_FIRST_LINES` ([:97](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L97)):

```typescript
/** The lines holding nothing but whitespace that end a text, each with the line end before it. */
const BLANK_LAST_LINES = /(?:\n[ \t]*)+$/;
```

Replace the body of `$rawBlockSource` and add `rawBlockInBlockList` directly after it. `rawBlockInItem` and its uses do not change.

```typescript
export function $rawBlockSource(node: MarkdownRawBlockNode): string {
    const text = node.getTextContent();
    const parent = node.getParent();

    return $isListItemNode(parent) ? rawBlockInItem(text) : rawBlockInBlockList(text);
}

export function rawBlockInBlockList(text: string): string {
    return text.trim() === "" ? "" : rawBlockAtMargin(text.replace(BLANK_FIRST_LINES, "").replace(BLANK_LAST_LINES, ""), false);
}
```

### `markdownSerializer.ts` — the margin rule

Add `readingInBlockList` directly before `blockShape` ([:1812](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1812)). `READING_KEY_SEPARATOR` is the existing constant ([:298](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L298)).

```typescript
function readingInBlockList(text: string): string {
    return `${blockShape(lexMarkdown(text))}${READING_KEY_SEPARATOR}${blockShape(lexMarkdown(`${text}\n`))}`;
}
```

`rawBlockAtMargin` keeps its signature. Its new body:

```typescript
export function rawBlockAtMargin(source: string, isList: boolean): string {
    const lines = source.split("\n");
    const indentOf = (line: string): number => /^ */.exec(line)![0].length;
    const shared = Math.min(MAX_IGNORED_INDENT, ...lines.filter((line) => line.trim() !== "").map(indentOf));
    const dedented = lines.map((line) => line.slice(Math.min(shared, indentOf(line))));
    const firstDedented = [...dedented];
    const firstOnly = [...lines];

    if (!isList && lines.length > 0) {
        firstDedented[0] = firstDedented[0]!.slice(Math.min(MAX_IGNORED_INDENT, indentOf(firstDedented[0]!)));
        firstOnly[0] = firstOnly[0]!.slice(Math.min(MAX_IGNORED_INDENT, indentOf(firstOnly[0]!)));
    }

    const candidates = [firstDedented.join("\n"), dedented.join("\n"), firstOnly.join("\n")];

    if (candidates[0] === source) {
        return source;
    }

    const reading = readingInBlockList(source);

    return candidates.find((candidate) => candidate === source || readingInBlockList(candidate) === reading) ?? source;
}
```

### `markdownSerializer.ts` — a block that writes nothing is no neighbour

In `serializeListApart`, replace the `nextNode` line ([:1484](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1484)):

```typescript
    // A paragraph or raw block that writes nothing keeps the list from nothing: the block after it is the neighbour.
    const writesNothing = (node: LexicalNode): boolean => ($isParagraphNode(node) || $isMarkdownRawBlockNode(node))
        && serializeBlock(node, definitions) === "";

    const nextNode = following.find((node) => !writesNothing(node));
```

### `markdownSerializer.ts` — a raw block written as its source keeps its second blank line

In `writtenBlocks`, the loop that runs from the end ([:1215](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1215)) becomes:

```typescript
    for (let index = written.length - 1; index >= 0; index--) {
        const block = written[index]!;
        const readsOtherwise = block.source !== undefined
            && (labelClosedAfter(written, index) || fenceClosedAfter(written, index) || takesInBlockAfter(written, index));

        if (readsOtherwise) {
            written.splice(index, 1, ...(block.standard === "" ? [] : [{ ...block, source: undefined, text: block.standard }]));
        }
    }
```

Add after `fenceClosedAfter`:

```typescript
function takesInBlockAfter(blocks: readonly WrittenBlock[], index: number): boolean {
    const block = blocks[index]!;
    const next = blocks[index + 1];
    const followedAsLoaded = next === undefined || followsAtLoad(block.source, next.source);

    return !followedAsLoaded && $isMarkdownRawBlockNode(block.node) && runsOn(block.text);
}
```

The block's standard output already carries the extra line end, because `serializeRawBlock` writes it whenever a block after it writes something.

### `markdownSerializer.ts` — definitions

Replace `$lexDefinitions` and `$definitionsSource`, and change one line of `rawBlockTexts`. Place the two constants directly after `STANDS_IN_ITEM` ([:103](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L103)), which `DEFINITIONS_READ` is bounded like.

```typescript
/** The definitions source ({@link $definitionsSource}) of a document holding no raw block. */
export const NO_DEFINITIONS_SOURCE = "[]";

/** The definitions each raw-block text holds, read alone; cleared when it holds {@link RUNS_ON_CACHE_SIZE} entries. */
const DEFINITIONS_READ = new Map<string, Links>();
```

```typescript
// in rawBlockTexts: the form a save writes, not the text as typed
        if ($isMarkdownRawBlockNode(node)) {
            return [$rawBlockSource(node)];
        }
```

```typescript
export function $definitionsSource(): string {
    return JSON.stringify(rawBlockTexts($getRoot().getChildren()));
}

export function definitionsOfSource(source: string): Links {
    return definitionsOfTexts(JSON.parse(source) as string[]);
}

export function $documentDefinitions(): Links {
    return definitionsOfTexts(rawBlockTexts($getRoot().getChildren()));
}

function definitionsOfTexts(texts: readonly string[]): Links {
    const all = Object.create(null) as Links;

    for (const text of texts) {
        for (const [label, definition] of Object.entries(definitionsOfText(text))) {
            const isFirst = !Object.hasOwn(all, label);

            if (isFirst) {
                all[label] = definition;
            }
        }
    }

    return all;
}

function definitionsOfText(text: string): Links {
    const known = DEFINITIONS_READ.get(text);

    if (known !== undefined) {
        return known;
    }

    // Every definition opens with a `[`: text without one is not lexed.
    const read = text.includes(LABEL_OPEN) ? lexMarkdownLinkDefinitions(text) : (Object.create(null) as Links);

    if (DEFINITIONS_READ.size >= RUNS_ON_CACHE_SIZE) {
        DEFINITIONS_READ.clear();
    }

    DEFINITIONS_READ.set(text, read);

    return read;
}
```

Call sites, all of them:

| Site | Today | After |
|---|---|---|
| `$readDefinitions` ([:680](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L680)), `$collectDefinitions` ([:718](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L718)) | `$lexDefinitions()` | `$documentDefinitions()` |
| `$runsReadingOtherwise` ([:840](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L840)), `formsWholeLinks` ([:3270](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L3270)) | `lexMarkdownLinkDefinitions($definitionsSource())` | `$documentDefinitions()` |
| `$buildInlineContent` ([markdownImporter.ts:366](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L366)) | `lexMarkdownLinkDefinitions($definitionsSource())` | `$documentDefinitions()` |
| `$readListAgainAroundRawBlock` ([markdownWritable.ts:978](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L978)) | `lexMarkdownLinkDefinitions($definitionsSource())` | `$documentDefinitions()` |
| `registerDefinitionRules` ([markdownWritable.ts:1163](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1163), [:1167](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1167)) | `{ source: "", definitions: lexMarkdownLinkDefinitions("") }`, and `lexMarkdownLinkDefinitions(source)` | `{ source: NO_DEFINITIONS_SOURCE, definitions: definitionsOfSource(NO_DEFINITIONS_SOURCE) }`, and `definitionsOfSource(source)` |

`$importMarkdown` keeps `lexMarkdownLinkDefinitions(source)` ([markdownImporter.ts:231](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L231)): while a document loads, the definitions are the viewer's own reading of the source. `$lexDefinitions` is deleted.

### `markdownWritable.ts` — `$selectTextOffset`

```typescript
function $selectTextOffset(block: ElementNode, offset: number): void {
    let remaining = offset;

    for (const { node } of $dfs(block)) {
        if ($isTextNode(node)) {
            const size = node.getTextContentSize();

            if (remaining <= size) {
                node.select(remaining, remaining);

                return;
            }

            remaining -= size;
        } else if ($isLineBreakNode(node)) {
            if (remaining === 0) {
                // The offset stands on a line that holds no text: the point before this line break.
                const index = node.getIndexWithinParent();

                node.getParentOrThrow().select(index, index);

                return;
            }

            remaining -= node.getTextContentSize();
        }
    }

    block.selectEnd();
}
```

### Test helpers — `markdown-roundtrip/harness.ts`

```typescript
/** The label of the line a save writes between two lists it keeps apart (`[//]: #`). */
const SEPARATOR_LABEL = '//';

export function editorDefinitions(editor: MarkdownEditor): Links {
    const lexicalEditor = (editor as unknown as { _editor: LexicalEditor })._editor;

    return lexicalEditor.read(() => $readDefinitions(true).all);
}

export function viewerDefinitions(saved: string, own: Links): Links {
    const read = lexMarkdownLinkDefinitions(saved);
    const entries = Object.entries(read).filter(([label]) => label !== SEPARATOR_LABEL || Object.hasOwn(own, SEPARATOR_LABEL));

    return Object.assign(Object.create(null) as Links, Object.fromEntries(entries));
}
```

Import `Links` from `marked`, `lexMarkdownLinkDefinitions` from `~/component/display/markdownExtensions` and `$readDefinitions` from `~/component/editor/markdownSerializer`.

---

## Ordered Implementation Steps

Work test-first. Run test files from `packages/lib` with `npx vitest run <file>`. A fresh worktree needs `node_modules` and `packages/lib/node_modules` symlinked to the main tree's; never run a plain `npm install`.

1. **Record the parent's results** for the differential check, on the commit the branch starts from, before any change: the two runs of [Verification](#verification) → *The differential check against the parent*, step 1.
2. **Harness check.** In `tests/component/markdown-roundtrip/corpus/types.ts` add `'definitions'` to `HarnessCheck`, before `'edits'`, and one sentence to its comment (the editor reads the same link reference definitions off its document as the viewer reads off the save). In `harness.ts` add `editorDefinitions` and `viewerDefinitions` as in *Internal Structure*. In `markdown-roundtrip.test.ts` add, after the `canonicalIdempotence` test of the corpus loop:
   ```typescript
        it(checkTitle(testCase, 'definitions'), () => {
            const { editor, saved } = loadAndSave(testCase.source);
            const own = editorDefinitions(editor);

            assertCheck(testCase, 'definitions', own, viewerDefinitions(saved, own));
        });
   ```
   In `markdown-edit-fuzz.test.ts`, in `fuzzSequence` after `checkNoWordLost(testCase, run);`, add the same comparison on `run.editor` and `run.saved` with `expect(own, run.context).toEqual(viewerDefinitions(run.saved, own))`, skipped when `knownDivergence(testCase, 'definitions')`. In `markdown-editor-list-item-edits.test.ts`, import `editorDefinitions` and `viewerDefinitions` from `./markdown-roundtrip/harness` and, at the end of `expectSaveKeepsDocument`, before its `return saved;`, add:
   ```typescript
    const own = editorDefinitions(editor);

    expect(own, `definitions after ${context}: ${JSON.stringify(saved)}`).toEqual(viewerDefinitions(saved, own));
   ```
   Check: `npx vitest run tests/component/markdown-roundtrip/ tests/component/markdown-editor-list-item-edits.test.ts` is green (no existing case or row fails the new check).
3. **Corpus cases.** Add the cases of [Round-trip corpus](#round-trip-corpus) to `corpus/dialect.ts` and `corpus/referenceLinks.ts`. In `markdown-edit-fuzz.test.ts` add to `RAW_BLOCK_POSITIONS`, as its last entry: `['a block after a list', '- a\n\n<div>\nw\n</div>']`. Check: `npx vitest run tests/component/markdown-roundtrip/` fails exactly the 21 checks the corpus tables mark red; the 52 new `RB` rows pass.
4. **Rows.** Add the rows of [Expected Behaviour](#expected-behaviour) to `markdown-editor-list-item-edits.test.ts` and `markdown-editor-list-item-paste.test.ts`. Check: the rows marked *red* fail and the rows marked *control* pass. If a control fails or a red row passes, stop and re-read the row.
5. **Existing tests that change.** Make the edits of [Existing tests that change](#existing-tests-that-change). The importer test fails until step 6, the three list-item rows until step 7, the saving-cost test until step 11.
6. **The block-list form.** In `markdownSerializer.ts` add `BLANK_LAST_LINES` and `rawBlockInBlockList`, and replace the body of `$rawBlockSource`. Rows RF1 to RF9 pass, and RT1 to RT3 still pass.
7. **The margin rule.** Add `readingInBlockList` and replace the body of `rawBlockAtMargin`. Rows RL1 to RL10 and the three changed list-item rows pass.
8. **A block that writes nothing.** Change `serializeListApart`. Rows RE1 to RE5 pass (RE4 needs step 6 too).
9. **The second blank line.** Change the loop of `writtenBlocks` and add `takesInBlockAfter`. Rows RW1 to RW5 pass.
10. **Definitions in the serializer.** Add the two constants and the four functions, change `rawBlockTexts`, delete `$lexDefinitions`, and change the four serializer call sites. Check: `grep -n 'lexDefinitions\|lexMarkdownLinkDefinitions(\$definitionsSource' packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` gives no match, and the file calls `lexMarkdownLinkDefinitions` once, in `definitionsOfText`. Do not run the tests between this step and the next: `$definitionsSource` now returns JSON, which `registerDefinitionRules` still lexes as Markdown until step 11.
11. **Definitions in the importer and the definition rule.** Change `$buildInlineContent`, `$readListAgainAroundRawBlock` and `registerDefinitionRules` as the call-site table says. In `markdownImporter.ts`'s import from `markdownSerializer.js` ([:43](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L43)) replace `$definitionsSource`, which nothing there uses any more, with `$documentDefinitions`. In `markdownWritable.ts` add `$documentDefinitions`, `definitionsOfSource` and `NO_DEFINITIONS_SOURCE` to the same import ([:28](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L28)) and remove `lexMarkdownLinkDefinitions` from the `markdownExtensions.js` import ([:26](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L26)). Check: `grep -rn 'lexMarkdownLinkDefinitions(\$definitionsSource' packages/lib/src` gives no match. Rows RD1 to RD8, RD12 and RD13, the new corpus cases and the saving-cost test pass.
12. **The caret.** Replace the body of `$selectTextOffset`. Every RC row passes.
13. **JSDoc.** Update every comment that describes the old design: `$rawBlockSource` (a written form at every place), `rawBlockAtMargin` (both places; the first-line-only candidate), `serializeRawBlock` ("its text as written" becomes "its written form"), `serializeListApart` (a block that writes nothing), `writtenBlocks` (the third condition), `$collectDefinitions`, `$readDefinitions`, `rawBlockTexts`, `$definitionsSource` (the JSON of the written forms) and `registerDefinitionRules` (definitions are read raw block by raw block). Check: `grep -n 'joined as blocks' packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` gives no match.
14. **Run the Markdown suites**: `npx vitest run tests/component/markdown-roundtrip/ tests/component/markdown-importer.test.ts tests/component/markdown-serializer.test.ts tests/component/markdown-editor-list-item-edits.test.ts tests/component/markdown-editor-list-item-paste.test.ts tests/component/markdown-source-preservation.test.ts tests/component/markdown-editor.test.ts tests/component/markdown-editor-columns.test.ts tests/component/markdown-editor-command-crashes.test.ts tests/component/markdown-editor-table-edge.test.ts tests/component/markdown-editor-table-cells-paste.test.ts tests/component/markdown-editor-history.test.ts tests/component/markdown-list-item-node.test.ts tests/component/markdown-reference-links.test.ts`. An expected string of an existing test may change only as [Existing tests that change](#existing-tests-that-change) allows.
15. **Docs**: `docs/components/MarkdownEditor.md`, `docs/reference/changelog/next.md` and the `listItemBlocks` reason in `tests/component/markdown-roundtrip/corpus/divergences.ts`, as in [Documentation Impact](#documentation-impact).
16. **Verification**, in full, the differential check included.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownImporter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/types.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/referenceLinks.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/divergences.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/harness.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-roundtrip.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-edit-fuzz.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-list-item-edits.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-list-item-paste.test.ts` |
| Modify | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-preservation.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Everything in this section is unit-testable offline, unless it is under [Manual (browser) checks](#manual-browser-checks). Expected strings are `getValue()`, written as TypeScript string literals. *Red* means the row fails before the change; *control* means it passes before and after. Every row was run on the parent and on a prototype of this plan; see the [addendum](#addendum-measurements).

### Rows in `markdown-editor-list-item-edits.test.ts`

One new `describe`, placed last in the file: `a raw block outside a list item is written so that it reads where it stands (R rows)`. All rows of the six tables below go into one `it.each<Row>([…])('$name', runRow)`, each named by its number and a few words saying what the row is (`'RL1: an indented quote before an indented lazy HTML start keeps the second line\'s indentation'`). The file's `Row`, `Step` and `runRow` ([:282](../packages/lib/tests/component/markdown-editor-list-item-edits.test.ts#L282)) are used as they are.

`runRow` checks the document after the load and after every step: the save reloads to the document the editor shows, each raw block reads as it did, saving the reload changes nothing, the viewer reads the save as the editor shows it (unless `comparesWithViewer` is `false`: a document holding a raw list or raw quote, which the viewer renders), the standard form reads and reloads the same and saves unchanged, and, after step 2, the definitions agree. A row then pins `saved` and `shape` where the table gives them.

Constants local to the `describe`:

```typescript
/** A tight list whose item holds a quote right under its text: it loads as one raw block. */
const RAW_LIST = '- a\n  > x';
const HTML = '<div>\ny\n</div>';
/** A two-column fence holding `blocks` in its first column. */
const inColumn = (blocks: string): string => `::: columns\n${blocks}\n|||\nv\n:::`;
/** A fence whose first column ends in an HTML block start and whose second holds a definition. */
const COLUMNS = '::: columns\n<div\n|||\n[x]: /u\n:::';
const typeX = (at: TextPoint): Step => ({ key: 'type', text: 'X', at });
```

Rows that hold a raw list or a raw quote at any step set `comparesWithViewer: false`: every RL row except RL13, rows RF1, RF2, RF3, RF5, RF9, RF11 and RF12, rows RE1 to RE5 and RE7, rows RW7 and RD10, and rows RT2 and RT3.

**RL — a quote whose last line stays in it only while indented**

| # | Source | Steps | Saved after the last step | Shape after the last step | Today |
|---|---|---|---|---|---|
| RL1 | `'p\n\n  > q\n  <div\n\nz'` | none | — | `paragraph("p")`, `markdown-raw-block("> q", linebreak, "  <div")`, `paragraph("z")` | red |
| RL2 | `inColumn('  > q\n  <div\n\nw')` | none | — | first column: `markdown-raw-block("> q", linebreak, "  <div")`, `paragraph("w")` | red |
| RL3 | `'   > q\n   <div\n\nz'` | none | — | `markdown-raw-block("> q", linebreak, "   <div")`, `paragraph("z")` | red |
| RL4 | `'***\n\n  > q\n  </div\n\nw'` | none | — | `markdown-raw-block("***")`, `markdown-raw-block("> q", linebreak, "  </div")`, `paragraph("w")` | red |
| RL5 | `'  > a\n  > b\n  <div\n\nz'` | none | — | `markdown-raw-block("> a", linebreak, "  > b", linebreak, "  <div")`, `paragraph("z")` | red |
| RL6 | `'  > q\n  </div'` | none | — | `markdown-raw-block("> q", linebreak, "  </div")` | red |
| RL7 | RL1's | `typeX(['z', 1])` | `'p\n\n  > q\n  <div\n\nzX'` | — | red |
| RL8 | RL1's | `typeX(['> q', 3])` | `'p\n\n> qX\n  <div\n\nz'` | — | red |
| RL9 | RL1's | Backspace at `['  <div', 2]`, Backspace at `[' <div', 1]` | `'p\n\n> q\n\n<div\n\n\nz'` | `paragraph("p")`, `quote("q")`, `markdown-raw-block("<div")`, `paragraph("z")` | red |
| RL10 | `` `${RAW_LIST}\n\n[//]: #\n\n  > q\n  <div\n\nz` `` | `{ key: 'removeBlock', index: 1 }` | `` `${RAW_LIST}\n\n> q\n  <div\n\nz` `` | — | red |
| RL11 | `'> q\n<div'` | none | — | `markdown-raw-block("> q", linebreak, "<div")` | control |
| RL12 | `'  > q\n<div'` | none | — | `markdown-raw-block("> q", linebreak, "<div")` | control |
| RL13 | `'  <div>\n  x\n  </div>\n\nz'` | none | — | `markdown-raw-block("<div>", linebreak, "x", linebreak, "</div>")`, `paragraph("z")` | control |
| RL14 | `'> q\n<div'` | Enter at `['<div', 4]`, type `z` | `'> q\n\n<div\n\n\nz'` | `quote("q")`, `markdown-raw-block("<div")`, `paragraph("z")` | control |
| RL15 | `'- a\n\n  > q\n   <div\n- z'` | none | — | `list(markdown-list-item(markdown-list-item-text("a"), markdown-raw-block("> q", linebreak, " <div")), markdown-list-item(markdown-list-item-text("z")))` | control |
| RL16 | `'- a\n\n  > q\n\t</div'` | none | — | `list(markdown-list-item(markdown-list-item-text("a"), markdown-raw-block("> q", linebreak, "  </div")))` | control |

The shape column lists the root's blocks in order; `shapeOf` joins them with `" | "`. RL2's full shape is `markdown-block(markdown-column(…the two blocks…), markdown-column(paragraph("v")))`.

RL9 is the edit that breaks the rule: once the last line has no space before it, the raw block reads as two blocks before a line end, and the editor shows them. RL11, RL12 and RL14 pin the text that reads by its place: it stays a raw block while it is last, and a block added after it shows it as a quote and a raw block.

**RF — the block-list form**

| # | Source | Steps | Saved after the last step | Today |
|---|---|---|---|---|
| RF1 | `` `${RAW_LIST}\n\n${HTML}` `` | type two spaces at `['<div>', 0]` | the source | red |
| RF2 | `` `${RAW_LIST}\n\n[x]: /u` `` | type three spaces at `['[x]: /u', 0]` | the source | red |
| RF3 | `'1) w\n   > x\n\n<div>\ny\n</div>'` | type three spaces at `['<div>', 0]` | the source | red |
| RF4 | `` `- a\n\n${HTML}` `` | type two spaces at `['<div>', 0]` | the source (today a `[//]: #` line is written and the spaces are kept) | red |
| RF5 | `` inColumn(`${RAW_LIST}\n\n${HTML}`) `` | type two spaces at `['<div>', 0]` | the source | red |
| RF6 | `` `p\n\n${HTML}` `` | type three spaces at `['<div>', 0]` | the source | red |
| RF7 | `` `${HTML}\n\nb` `` | Shift+Enter at `['</div>', 6]` | the source | red |
| RF8 | `` `p\n\n${HTML}\n\nb` `` | Shift+Enter at `['<div>', 0]` | the source | red |
| RF9 | `` `${RAW_LIST}\n\n${HTML}\n\nb` `` | type two spaces at `['<div>', 0]`, then `typeX(['b', 1])` | `` `${RAW_LIST}\n\n${HTML}\n\nbX` `` | red |
| RF10 | `` `p\n\n${HTML}` `` | type four spaces at `['<div>', 0]` | ``'p\n\n```\n<div>\n```\n\ny\n\n</div>'`` (four spaces make indented code; the editor shows the blocks) | control |
| RF11 | `'- a\n\n[//]: #\n\n  - x\n  - y\n- z\n  > q'` | `{ key: 'removeBlock', index: 1 }` | the source: the raw list keeps the spaces it reads by, and the `[//]: #` line is written again | control |
| RF12 | `` `${RAW_LIST}\n\n${HTML}` `` | type a tab at `['<div>', 0]` | not pinned; the checks hold | control |

**RT — the spaces that end a raw block's last line stay**

| # | Source | Steps | Saved after the last step | Today |
|---|---|---|---|---|
| RT1 | `` `${HTML}\n\nb` `` | type two spaces at `['</div>', 6]` | `'<div>\ny\n</div>  \n\nb'` | control |
| RT2 | ``'>```\n>  \n\nb'`` | `typeX(['b', 1])` | ``'>```\n>  \n\nbX'`` | control |
| RT3 | ``'>```\n>  '`` | type `x` at ``['>```', 4]`` | ``'>```x\n>  '`` | control |

RT2 and RT3 are a quote holding a code block whose one line is a space. Their raw block is written once it or its neighbour is edited, and the two spaces that end it must still be there.

**RE — a raw block that writes nothing**

The step *empty* is `{ key: 'Backspace', at: ['<div>', 0], to: ['<div>', 5] }`.

| # | Source | Steps | Saved after the last step | Today |
|---|---|---|---|---|
| RE1 | `'- w\n\n<div>\n\n- n\n  > q'` | empty | `'* w\n\n- n\n  > q'` | red |
| RE2 | `'1. w\n\n<div>\n\n1. n\n   > q'` | empty | `'1) w\n\n1. n\n   > q'` | red |
| RE3 | `inColumn('- w\n\n<div>\n\n- n\n  > q')` | empty | `inColumn('* w\n\n- n\n  > q')` | red |
| RE4 | RE1's | `{ key: 'type', text: ' ', at: ['<div>', 0], to: ['<div>', 5] }` | `'* w\n\n- n\n  > q'` | red |
| RE5 | RE1's | empty, then `typeX(['w', 1])` | `'* wX\n\n- n\n  > q'` | red |
| RE6 | `'- w\n\n<div>\n\n- n'` | empty | `'- w\n\n* n'` | control |
| RE7 | `'- w\n  > x\n\n<div>\n\n- n\n  > q'` | empty | `'- w\n  > x\n\n[//]: #\n\n- n\n  > q'` | control |

**RW — a raw block only a second blank line ends**

| # | Source | Steps | Saved after the last step | Today |
|---|---|---|---|---|
| RW1 | `'<div\n\n\nb'` | `typeX(['b', 1])` | `'<div\n\n\nbX'` | red |
| RW2 | `'<div\n\n\nb\n\nc'` | `{ key: 'removeBlock', index: 1 }` | `'<div\n\n\nc'` | red |
| RW3 | `'<div\n\n\n<div\n\n\nb'` | `typeX(['b', 1])` | `'<div\n\n\n<div\n\n\nbX'` | red |
| RW4 | `'a\n\n</details\n\n\nb'` | `typeX(['b', 1])` | `'a\n\n</details\n\n\nbX'` | red |
| RW5 | `'<div\n\n\n> b'` | `{ key: 'command', run: (editor) => editor.insertParagraphBeforeBlock(), at: ['b', 0] }`, type `n` | `'<div\n\n\nn\n\n> b'` | red |
| RW6 | `'a\n\n<div\n\n\nb'` | `typeX(['a', 1])` | `'aX\n\n<div\n\n\nb'` | control |
| RW7 | `'> <div\n\n\nb'` | `typeX(['b', 1])` | `'> <div\n\nbX'` (the quote ends the HTML block) | control |
| RW8 | `inColumn('<div\n\n\nb')` | `typeX(['b', 1])` | `inColumn('<div\n\n\nbX')` | control |
| RW9 | `'<div>\n\nb'` | `typeX(['b', 1])` | `'<div>\n\nbX'` | control |

RW5 puts a new block between two blocks that are both written as their loaded source. `insertParagraphBeforeBlock()` acts on a quote, a list, a code block or a table, which is why the block after `<div` is a quote here.

**RD — the document's definitions**

The definitions check of `runRow` is red today for RD1 to RD8, RD12 and RD13, after the load already.

| # | Source | Steps | Saved after the last step | Today |
|---|---|---|---|---|
| RD1 | `` `${COLUMNS}\n\nb [x] c` `` | `typeX(['b ', 1])` | `` `${COLUMNS}\n\nbX [x] c` `` | red |
| RD2 | `'- a\n\n  <!-- c\n- b [x] z\n\n  [x]: /u'` | `typeX(['b ', 1])` | `'- a\n\n  <!-- c\n\n- bX [x] z\n\n  [x]: /u'` | red |
| RD3 | `'<div\n\n\n[x]: /u\n\nb [x] c'` | `typeX(['b ', 1])` | `'<div\n\n\n[x]: /u\n\nbX [x] c'` | red |
| RD4 | `` `${COLUMNS}\n\n[x]: /v\n\nb [x] c` `` | `typeX(['b ', 1])` | `` `${COLUMNS}\n\n[x]: /v\n\nbX [x] c` `` | red |
| RD5 | `'::: columns\n<div\n\|\|\|\n[x]: /u "t\n\nu8"\n:::\n\nb [x] c'` | none | not pinned; the standard form keeps `[x]` | red |
| RD6 | `'- a\n\n  <div\n- b [x] z\n\n  [x]: /u "t\n\n  u8"'` | none | not pinned; the standard form keeps `[x]` | red |
| RD7 | `'<div\n\n\n[x]: /u\n\n[a][x]'` | `{ key: 'removeBlock', index: 1 }` | `'<div\n\n\n[a](/u)'` | red |
| RD8 | `'- a\n\n  <!-- c\n- b\n\n[x]: /u\n\nb [x] c'` | `typeX(['b ', 1])` | `'- a\n\n  <!-- c\n- b\n\n[x]: /u\n\nbX [x] c'` | red |
| RD9 | `'[constructor]: /u\n\nb [constructor] c'` | `typeX(['b ', 1])` | `'[constructor]: /u\n\nbX [constructor] c'` | control |
| RD10 | `'> <div\n\n[x]: /u\n\nb [x] c'` | `typeX(['b ', 1])` | `'> <div\n\n[x]: /u\n\nbX [x] c'` | control |
| RD11 | `'[x]: /u\n\n[x]: /v\n\nb [x] c'` | `typeX(['b ', 1])` | `'[x]: /u\n\n[x]: /v\n\nbX [x] c'` | control |
| RD12 | `` `${COLUMNS}\n\nb [x] c` `` | `{ key: 'type', text: ' w', at: ['[x]: /u', 7] }` | `'::: columns\n<div\n\|\|\|\n\\[x\\]: /u w\n:::\n\nb [x](/u) c'` | red |
| RD13 | RD5's | `typeX(['[x]: /u "t', 10])` | `'::: columns\n<div\n\|\|\|\n[x]: /u "tX\n\nu8"\n:::\n\nb [x] c'` | red |
| RD14 | RD12's with `<div>` for `<div` | RD12's | RD12's with `<div>` for `<div` | control |
| RD15 | RD13's with `<div>` for `<div` | RD13's | RD13's with `<div>` for `<div` | control |

In RD5, RD12 and RD13 `\|` stands for `|`. RD4 is "a definition treated as repeated when it is not": today the editor takes `/v` for `x`, because the `<div` before it hides `/u`. RD7 removes the definition, so the link is written inline with its own URL, as documented; the row pins that the raw block before it keeps its second blank line.

RD12 and RD13 edit the hidden definition itself. In RD12 the typed ` w` makes the line a paragraph, so the definition is gone and the link is written inline; today the editor does not see a definition go, and saves `b [x] c`, which reads as plain text. In RD13 the definition's title changes and the link takes it, as the docs page says a link whose title holds a blank line does; today the link keeps the old title. RD14 and RD15 are the same edits where the first column's HTML block is closed, which today's reading handles: they pin that the two fixed rows end where the unaffected documents already do.

### Rows in `markdown-editor-list-item-paste.test.ts`

Move the `pasteText` helper that is local to the `describe` at [:660](../packages/lib/tests/component/markdown-editor-list-item-paste.test.ts#L660) to module level, unchanged, and use it from both places.

One new `describe`, placed last: `a paste into a raw block that leaves the caret on an empty line keeps a usable selection (RC rows)`. It uses the file's `load`, `selectText`, `update`, `copySelection`, `pasteNodes` and `expectSaveKeepsDocument`. Rows RC1 to RC7 are one `it.each`. Each loads the source, puts the caret at the point, pastes the text with `pasteText` and asserts: the paste does not throw; `getValue()`; the selection is collapsed with its anchor as the table says; `lexicalOf(editor).read(() => $getSelection()!.getNodes())` does not throw; and `expectSaveKeepsDocument(editor)`.

| # | Source | Paste at | Pasted text | `getValue()` | Anchor after the paste | Today |
|---|---|---|---|---|---|---|
| RC1 | `'<pre>\nx1\nx2\n</pre>'` | `['x1', 2]` | `'\n</pre>\n\n<pre>\n\n'` | `'<pre>\nx1\n</pre>\n\n<pre>\n\n\nx2\n</pre>'` | element point, offset 3, on root child 1 | red (throws) |
| RC2 | RC1's | `['x1', 2]` | `'\n</pre>\n\n<pre>\n'` | `'<pre>\nx1\n</pre>\n\n<pre>\n\nx2\n</pre>'` | element point, offset 2, on root child 1 | red (throws) |
| RC3 | `'<!-- a\nx1\nx2\n-->'` | `['x1', 2]` | `'\n-->\n\n<!--\n\n'` | `'<!-- a\nx1\n-->\n\n<!--\n\n\nx2\n-->'` | element point, offset 3, on root child 1 | red (throws) |
| RC4 | `'a\n\n<pre>\nx1\nx2\n</pre>\n\nb'` | `['x1', 2]` | RC1's | `'a\n\n<pre>\nx1\n</pre>\n\n<pre>\n\n\nx2\n</pre>\n\nb'` | element point, offset 3, on root child 2 | red (throws) |
| RC5 | `'- a\n\n  <pre>\n  x1\n  x2\n  </pre>\n- b'` | `['x1', 2]` | RC1's | not pinned | element point, offset 3, on a `markdown-raw-block` | red (throws) |
| RC6 | RC1's | `['x1', 2]` | RC1's, then type `Y` (`CONTROLLED_TEXT_INSERTION_COMMAND`) | `'<pre>\nx1\n</pre>\n\n<pre>\n\nY\nx2\n</pre>'` | not asserted | red (throws) |
| RC7 | RC1's | `['x1', 2]` | `'\n</pre>\n\n<pre>'` | `'<pre>\nx1\n</pre>\n\n<pre>\nx2\n</pre>'` | text point `"<pre>"`@5, in root child 1 | control |

Row RC8 is an `it` of its own and replays a paste of copied nodes: load `'w0\n\n<pre>\nx1\n\nx2\n</pre>\n\n<pre>\nx3\n\nx4\n</pre>'`, select `['x2', 2]` to `['x4', 0]`, copy with `copySelection`, put the caret at `['x3', 2]` and paste with `pasteNodes`. It asserts no throw, that `$getSelection()!.getNodes()` does not throw, and that the save reloads to itself (`load(saved).getValue()` equals `saved`). It throws today.

### Round-trip corpus

Every case runs all seven harness checks and the edit fuzz, whose check is named `edits`. "Red today" names the checks that fail before the change; every other check holds before and after.

`corpus/dialect.ts`, appended after the last case:

| Name | Source | `known` | Red today |
|---|---|---|---|
| indented quote before an indented lazy html start | `'p\n\n  > q\n  <div\n\nz'` | `{ surface: 'quoteBlocks' }` | `canonical`, `canonicalIdempotence`, `edits` |
| indented quote before an indented lazy html start in a column | `'::: columns\n  > q\n  <div\n\nw\n\|\|\|\nv\n:::'` | `{ surface: 'quoteBlocks' }` | `canonical`, `canonicalIdempotence`, `edits` |
| indented quote before an indented lazy closing tag ending the document | `'  > q\n  </div'` | `{ surface: 'quoteBlocks' }` | none |
| quote before a deeper lazy html start | `'> q\n  <div\n\nz'` | `{ surface: 'quoteBlocks' }` | none |
| quote before a deeper lazy html start in a list item | `'- a\n\n   > q\n   <div\n- z'` | `{ surface: 'quoteBlocks' }` | none |
| html block start two blank lines before a paragraph | `'<div\n\n\nb'` | none | `edits` |
| raw list before an html block | `'- a\n  > x\n\n<div>\ny\n</div>'` | `{ surface: 'listItemBlocks' }` | none |
| list, definition line and an indented raw list | `'- a\n\n[//]: #\n\n  - x\n  - y\n- z\n  > q'` | `{ surface: 'listItemBlocks' }` | none |

`corpus/referenceLinks.ts`, appended; each has `links: ['/u']`:

| Name | Source | Red today |
|---|---|---|
| definition after an html block start ending a column | `'::: columns\n<div\n\|\|\|\n[x]: /u\n:::\n\nb [x] c'` | `definitions`, `edits` |
| definition after an open comment ending a list item | `'- a\n\n  <!-- c\n- b [x] z\n\n  [x]: /u'` | `definitions`, `edits` |
| definition two blank lines after an html block start | `'<div\n\n\n[x]: /u\n\nb [x] c'` | `definitions`, `edits` |
| first definition after an html block start ending a column | `'::: columns\n<div\n\|\|\|\n[x]: /u\n:::\n\n[x]: /v\n\nb [x] c'` | `definitions`, `edits` |
| definition with a blank line in its title after an html block start ending a column | `'::: columns\n<div\n\|\|\|\n[x]: /u "t\n\nu8"\n:::\n\nb [x] c'` | `canonical`, `definitions`, `edits` |
| definition with a blank line in its title after an html block start ending a list item | `'- a\n\n  <div\n- b [x] z\n\n  [x]: /u "t\n\n  u8"'` | `canonical`, `definitions`, `edits` |

In both tables `\|` stands for `|`. The red checks are 21 tests in all: 12 in `markdown-roundtrip.test.ts` and 9 in `markdown-edit-fuzz.test.ts`.

### Existing tests that change

| Test | Today | After |
|---|---|---|
| [markdown-editor-list-item-edits.test.ts](../packages/lib/tests/component/markdown-editor-list-item-edits.test.ts) rows Q11, Q12 and Q13 (lines 575 to 581) | in the table "keeps its list a raw block": the root's first block is `markdown-raw-block` and the shape holds no `list(` | moved to a new `it.each` in the same `describe`, titled "a quote whose last line is indented deeper than the quote is a raw block of its item". Each row asserts its shape, `getValue()` equal to the source, and `expectSaveKeepsDocument(editor, 'the load', false)` |
| [markdown-importer.test.ts:1928](../packages/lib/tests/component/markdown-importer.test.ts#L1928) "a loaded list before an indented raw list it would take in is kept apart by a separator that shows nothing" | `standard` is `'- *\n\n[//]: #\n\n  * 0\n    > 9\nd'` | `standard` is `'- *\n\n* 0\n    > 9\nd'`; rename the test "a loaded list before a raw list whose first line alone was indented is written with that line at the margin". Its second assertion stays. Row RF11 keeps the separator covered |
| [markdown-source-preservation.test.ts:438](../packages/lib/tests/component/markdown-source-preservation.test.ts#L438) "reads the definitions with one lex per save when the document holds reference links" | after `lex.mockClear()`, one `getValue()` calls the definitions lexer once | rename it "lexes a raw block's definitions once, not once per save". After `lex.mockClear()`, `getValue()` calls the lexer 0 times. Then `append(editor, '[ref]: https://one', '-cost')` (the file's helper, [:103](../packages/lib/tests/component/markdown-source-preservation.test.ts#L103)) and `getValue()` again: the lexer was called once in all |

The three shapes:

```
Q11  list(markdown-list-item(markdown-list-item-text("a"), markdown-raw-block("> q", linebreak, "  </div")))
Q12  list(markdown-list-item(markdown-list-item-text("a"), markdown-raw-block("> q", linebreak, " <div")), markdown-list-item(markdown-list-item-text("z")))
Q13  list(markdown-list-item(markdown-list-item-text("w0"), markdown-raw-block("> q1", linebreak, "  <div", linebreak, "  ::: {align=center}", linebreak, "  f2", linebreak, "  :::")), markdown-list-item(markdown-list-item-text("w3"), paragraph("  p")))
```

Replace the comment above Q11 ("Indented deeper than the item's content, the last line stays in the quote whatever follows. The raw block drops that indentation…") with: "Indented deeper than the quote, the last line stays in the quote whatever follows, and the raw block keeps that indentation." The comment above Q13 goes with the row.

Any other existing test may change an expected save only in one of these ways. Anything else is a defect in the change: stop and fix the code.

- A raw block outside a list item is saved without the spaces before its first line, or without an empty first or last line.
- A `[//]: #` line is gone because the block after it no longer starts with such spaces.
- A reference link keeps its `[label]` form where a definition after an open HTML block was not counted.
- A list whose item holds a quote with a deeper-indented last line loads as a list, its quote a raw block of the item.

### Manual (browser) checks

Run `npm run dev` at the repo root and open **MD Editor**. Put each text in through source mode, then switch to WYSIWYG.

| # | Steps | Expected |
|---|---|---|
| M1 | Source `<pre>`, `x1`, `x2`, `</pre>` on four lines. Copy, from any text editor, the five lines: an empty line, `</pre>`, an empty line, `<pre>`, an empty line. Put the caret after `x1`, press Ctrl/Cmd+V, then type `Y` | no console error; two raw blocks; `Y` stands on the second line under the second `<pre>` |
| M2 | Source `- a`, `  > x`, an empty line, `<div>`, `y`, `</div>`. Put the caret before `<div>`, type two spaces. Switch to source mode and back | the source shows `<div>` at the margin; the raw list and the raw block are still two blocks |
| M3 | Source `<div`, two empty lines, `b`. Type `X` after `b`. Switch to source mode | two empty lines still stand between `<div` and `bX` |
| M4 | Source of row RD1. Type `X` after `b`. Switch to source mode | the last line reads `bX [x] c` |
| M5 | Source `p`, an empty line, `  > q`, `  <div` (both indented two spaces), an empty line, `z`. Type `X` after `q`. Switch to source mode | one raw block; the source reads `> qX` and, under it, `<div` with two spaces before it |

---

## Verification

- From `packages/lib`: `npm run typecheck`, `npm run typecheck:test`, `npm run lint`.
- From `packages/lib`: the file list of step 14. Every row of [Expected Behaviour](#expected-behaviour) passes.
- From `packages/lib`: `npm run test` (the full suite), `npm run docs:api`, `npm run docs:llms:check`, `npm run build:lib`.
- The greps of steps 10, 11 and 13.
- The manual checks M1 to M5.
- **The differential check against the parent.** It runs the same scenarios on the commit the branch starts from and on the branch, and every difference must be one this plan names. The harness is outside the repo, in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/raw-block-revision/` (`$S` below). It copies its test files into a worktree, runs them and removes them again; never commit them. Leave `RBP_PROTO` empty: the variable only selects a prototype, and empty runs the code as it is.
  1. On a worktree of the parent commit (with the two `node_modules` symlinks): `RBP_PROTO= $S/proto/runrbr.sh <parent worktree>/packages/lib ec-matrix-parent` and `RBP_PROTO= $S/proto/rungrid.sh <parent worktree>/packages/lib scenarios-grid.json ec-grid-parent`.
  2. On the branch: the same two commands with `<branch worktree>/packages/lib` and the names `ec-matrix-branch` and `ec-grid-branch`.
  3. `python3 $S/ecdiff.py $S/ec-matrix-parent.json $S/ec-matrix-branch.json` and `python3 $S/ecdiff.py $S/ec-grid-parent.json $S/ec-grid-branch.json`.

  Each must end with `hard checks failed: none`. The hard checks are: every cell whose save differs between parent and branch differs in blank lines only; nothing throws that did not on the parent; no cell fails a reload, save-again or viewer check the parent passes; and one undo restores every cell it restores on the parent. Measured with the prototype: 16 of the matrix's 3,192 cells and 78 of the grid's 26,928 cells change, every one a range from a raw block whose Shift+Enter (or, for a range into another raw block, `INSERT_PARAGRAPH_COMMAND`) leaves that raw block with an empty last line, which the block-list form no longer writes. Any other changed cell must be explained before going on.
- **The list-edit fuzz, outside the repo** (never commit it). Run `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/impl/list-item-node/runlif.sh <worktree>/packages/lib fuzz <out-dir> 1500 601 1709 2207 3313 4409 5521 6607 7703 8819 9907 11003` and read the result with `showlif.py <out-dir>` from the same folder. The parent's result is in `scratch-keep/impl/paste-undo-merge/lif-2/`: 14 failing documents of 16,500.

  | Class (`counts`) | Parent | Must be |
  |---|---|---|
  | `spacesBeforeRaw:reload`, `:rawReading`, `:canonicalReload` | 2 each | 0 |
  | `load:canonical`, `load:canonicalReload`, `load:canonicalIdempotence` | 12, 12 and 10 | only documents that fail the same checks when their source is replayed on the parent (the runner's `probe` mode) and that hold a definition whose title has a blank line in a tab-indented list item (see *Non-Goals*) |
  | any other key | none | none. A new key is a defect this plan made or one newly reached: classify it before going on |

  Measured with the prototype: one failing document (seed 7703, document 196, `load:canonical`), of that tab class; it fails `canonical` on the parent too. The fuzz file's exemption `holdsBlankEdgedRawOutsideItems` can go: delete the `&& !holdsBlankEdgedRawOutsideItems(editor)` condition from a copy and expect the same result.
- **The regression fuzzes, outside the repo.** From the same folder, `runfuzz.sh <worktree>/packages/lib <out-dir> table-edge table-edge-strict paste paste-strict`, compared with `cmpfuzz-masked.py <out-dir> scratch-keep/impl/paste-undo-merge/fuzz-2`. The parent has no failing record in any of the four. `runr7.sh <worktree>/packages/lib <out-dir> 3000 <seeds>` with the seeds of `scratch-keep/impl/paste-undo-merge/r7-2/`, read with `showr7.py`: the parent has 120 failing documents. No count may rise, and a record the parent's run does not hold must be replayed on the parent before it is accepted.

---

## Documentation Impact

No public API changes. Edits to one docs page, one changelog section and one test-side reason text.

**`packages/lib/docs/components/MarkdownEditor.md`**

1. Line 74, the reference-link paragraph. Replace its last sentence "A definition counts wherever the viewer reads one, a list item included." with: "A definition counts wherever the viewer reads one — in a list item or a `:::` column too, also right after an HTML block left open there, which ends with its item or column — and the first definition of a label in the document is the one that counts."
2. Line 82. Replace "saved exactly as written (once edited, without the up to three spaces of indentation before it, which mean nothing to Markdown)" with "saved exactly as written (once edited, without an empty first or last line and without the up to three spaces of indentation before it, which mean nothing to Markdown and would move it into a list above it)".
3. Line 82. Replace "a quote that ends on a line without `>` starting an HTML block (`> q` over `<div`:" with "a quote that ends on a line without `>`, indented no deeper than the quote, that starts an HTML block (`> q` over `<div`:".
4. Line 82. After the sentence "A raw block keeps the indentation `marked` reads its lines by when removing it would change what the block is." add: "That holds for each of its lines: a quote whose last line stays in it only while indented (`> q` over an indented `<div`) keeps that line's indentation, in the document, in a `:::` column and in a list item."
5. Line 95, the **Lists** bullet. After the sentence ending "so are two inside one list item." add: "A raw block an edit emptied counts as nothing between a list and a raw list."

**`packages/lib/docs/reference/changelog/next.md`** → `## Fixed` → `### Components`, appended:

```markdown
- **`MarkdownEditor` writes a raw Markdown block so that it reads where it
  stands.** Outside a list item a raw block was saved as typed and read
  without regard to its neighbours. Spaces typed before one that follows a
  raw list moved it into that list on reload; a raw block an edit emptied
  let the list before it and the raw list after it join; a `<div` line two
  blank lines above a paragraph lost one of them once that paragraph was
  edited, and then took the paragraph in; and an indented quote whose last
  line stays in it only while indented (`> q` over an indented `<div`) lost
  that indentation at load, so the line left the quote as soon as the quote
  was rewritten. A raw block is now saved the same way everywhere: without an
  empty first or last line and without spaces before it that mean nothing; a
  block that writes nothing no longer stands between two lists; a block only
  a second blank line ends keeps that line; and a raw block keeps the
  indentation of any line its reading needs. A list whose item holds such a
  quote now loads as a list, the quote a raw block of its item. No consumer
  action is needed.

- **`MarkdownEditor` counts the link reference definitions the viewer
  counts.** A definition that followed an HTML block left open at the end of
  a `:::` column or a list item (`<div`, `<!--`), or a `<div` line at the top
  level, was not counted by the editor, or a later definition of the same
  label was taken for the first. A reference link was then saved inline
  (`[x](/u)` for `[x]`) once its block was edited, losing a title that holds
  a blank line. The editor now reads each raw block's definitions where that
  block stands, as the viewer does. No consumer action is needed.

- **Pasting into a raw `<pre>` or comment block no longer throws.** A paste
  that split such a block in two and ended on an empty line threw
  `$getTextNodeOffset: invalid offset` and left the editor without a usable
  selection. The caret now stands on that empty line. No consumer action is
  needed.
```

**`packages/lib/tests/component/markdown-roundtrip/corpus/divergences.ts`**, the `listItemBlocks` reason: replace "or a quote that ends on a line without `>` starting an HTML block" with "or a quote that ends on a line without `>`, indented no deeper than the quote, starting an HTML block".

---

## Potential Challenges

- **The stack tip moves and sibling plans edit the same three source files.** Find every site by its symbol name, not by line number.
- **A row that does not behave as its table says.** Every row was run on a prototype of this plan. Treat a row that differs as a signal to stop and re-read the row and the snippet, not to change the expected value.
- **An existing expected string changes.** Allow it only for the four reasons listed under *Existing tests that change*.
- **Do not trim the block-list form's last line.** `rawBlockInBlockList` drops blank last *lines* (`BLANK_LAST_LINES`), not the spaces that end a line holding something. With `trimEnd()` there, rows RT1 to RT3, the corpus case "code in a quote ending in a line of spaces" and the importer's row I7 (`'> - not\nx  '`) fail.
- **The `edits` check of a new corpus case still fails after step 12.** Each sequence that fails today comes from defect 1, 4 or 5. A failure that remains is either one of those not fully fixed, or a defect this plan does not know. Find which before touching the case; do not give a new case a `known` entry for `edits`.
- **The rows of `markdown-editor-list-item-edits.test.ts` other than Q11 to Q13 must stay green**, the grid G and rows R1 to R5 included. They type spaces before the first line of a raw list. The new candidate differs from the two existing ones only when every line of the text is indented. If one of those rows fails, find which candidate `rawBlockAtMargin` returned for the row's text before changing anything.
- **The merged definitions map has no prototype.** Build it with `Object.create(null)` and test membership with `Object.hasOwn`, or the labels `constructor` and `__proto__` resolve to `Object.prototype` members. Row RD9 and the corpus case "Object.prototype label defined" catch it.
- **`registerDefinitionRules` compares sources as strings.** Its first `lexed.source` must be `NO_DEFINITIONS_SOURCE`, not `""`: `definitionsOfSource` parses JSON.
- **The remembered readings are shared by every editor of a test file.** The restated saving-cost test counts lexer calls. Its second count holds only for a definition text no earlier test of the file has read; keep the suffix `-cost`, which gives a definition text no other test of the file loads.
- **The caret rows pin an element point.** `$selectTextOffset` always places it *before* a line break, which Lexical's selection normalisation leaves alone. If an RC row does not throw and saves as its table says but its anchor differs, find what moved the caret before changing the row.
- **Do not add a re-read for a block list.** The table under *A block list keeps its blocks apart by how it writes them* is the whole mechanism there. A second mechanism beside `$showRawBlockAsItsBlocks` would let the two drift.
- **`serializeListApart` must not serialize every following block.** Keep the test to paragraphs and raw blocks, as the snippet does: a table after a list is otherwise written twice per save.

---

## Critical Files

- [markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts): `rawBlockStandsInItem` (L1672) and `itemProbes` (L1701), the precedent this plan generalises; `rawBlockInItem` (L1645), `withoutBlankEdges` (L1755), `$rawBlockSource` (L1624), `rawBlockAtMargin` (L1782), `blockShape` (L1812); `serializeRawBlock` (L1605), `rawBlockEnd` (L1897), `runsOn` (L1885); `serializeListApart` (L1482), `listsJoin` (L1517), `blocksJoin` (L1534); `writtenBlocks` (L1195), `labelClosedAfter` (L1239), `fenceClosedAfter` (L1256), `followsAtLoad` (L1309), `separatorBefore` (L1377); `$readDefinitions` (L678), `$collectDefinitions` (L717), `$lexDefinitions` (L739), `rawBlockTexts` (L751), `$definitionsSource` (L771).
- [markdownImporter.ts](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts): `$importMarkdown` (L226), `$readRawBlockAsBlocks` (L300), `$buildInlineContent` (L365), `$recordSourceMap` (L393), `$buildRawBlock` (L841), `$buildQuote` (L917), `$buildItemBlock` (L1117).
- [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts): `registerRawBlockRules` (L903), `$readListAgainAroundRawBlock` (L964), `$showRawBlockAsItsBlocks` (L994), `$selectTextOffset` (L1041), `registerDefinitionRules` (L1159).
- [markdownExtensions.ts](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts): `lexMarkdown` (L643), `lexMarkdownLinkDefinitions` (L658), read only.
- [markdown-editor-list-item-edits.test.ts](../packages/lib/tests/component/markdown-editor-list-item-edits.test.ts): `Step` (L52), `press` (L148), `expectSaveKeepsDocument` (L258), `Row` (L282) and `runRow` (L299); rows Q1 to Q13 (L564).
- [markdown-editor-list-item-paste.test.ts](../packages/lib/tests/component/markdown-editor-list-item-paste.test.ts): `copySelection` (L119), `pasteNodes` (L150), `expectSaveKeepsDocument` (L265), `pasteText` (L667).
- [markdown-roundtrip/](../packages/lib/tests/component/markdown-roundtrip/): `harness.ts`, `corpus/types.ts`, `markdown-roundtrip.test.ts`, `markdown-edit-fuzz.test.ts` (`fuzzSequence` L325, `RAW_BLOCK_POSITIONS` L417).
- [plans/implemented/markdown-editor-list-item-block-paste.md](implemented/markdown-editor-list-item-block-paste.md): *Implementation Notes* → *Rule 1: a raw block in a list item*, *The list-edit fuzz*, and *Seen along the way, not changed*, which names five of these defects.
- [plans/implemented/markdown-editor-list-item-node.md](implemented/markdown-editor-list-item-node.md): *Implementation Notes* → *For the plans that follow* (the shape of a list item, which the rows' shape strings follow).
- [plans/markdown-editor-raw-block-range-edits.md](markdown-editor-raw-block-range-edits.md): the sibling plan that owns defect 7.

---

## Non-Goals

- **Defect 7 and the range routes.** `markdown-editor-raw-block-range-edits` owns them, its documented Shift+Enter limit included.
- **The lexer.** `> q` over an unindented `<div` still reads as one quote where its input ends and as a quote and an HTML block before a line end. That is `marked`'s blockquote rule, the twin of the tail-parity plan's Non-Goal *A tag name on the last line of a paragraph*. The editor holds such a raw block only while it is last.
- **The item form.** `rawBlockInItem` and `rawBlockStandsInItem` are not changed. A raw block of a list item still loses the spaces that end its last line.
- **The text of a loaded raw list.** A raw list whose first line alone is indented still shows that indentation after a load (`$buildRawBlock(source, true)`); only its save changes.
- **A title's whitespace.** A definition whose title holds a blank line, in a tab-indented list item, is read by the viewer with other whitespace on the title's later lines than the raw block holds. Labels and URLs agree. The list-edit fuzz still draws such documents.
- **`$selectInRun`.** It walks an offset the way `$selectTextOffset` did. No route was found that leaves its offset on an empty line, so it is not changed without a failing row.
- **`MarkdownEditor.ts` and the paste handlers.** The paste into a raw `<pre>` block is correct; only the caret placed after the re-read was wrong.
- **Committing the fuzz harnesses.** They stay outside the repo.

---

## Revised on 2026-10-11

The plan was first written on 2026-10-06 against `f4bfedf2c`. Three branches landed since (`markdown-editor-list-item-node`, `markdown-editor-table-cells-paste-empty-column`, `markdown-editor-paste-undo-merge`). What changed in this revision, and why:

| Change | Why |
|---|---|
| No defect was dropped | All six are still in the code at `85b55a8f4`: every row marked red fails there for the reason its cause gives, and every control passes. The three branches did not touch the functions of causes A to F. The class the fuzz called `pasteFlattenedInItemBlock` (82 documents) is gone, fixed by `markdown-editor-list-item-node` (its rows Y1 to Y13); the old Non-Goal for it is removed |
| The written form outside a list item is `rawBlockInBlockList`, not a renamed `rawBlockInItem` | The first version wrote the item form everywhere and was never run on a changed tree. Run as a prototype, it failed the corpus case "code in a quote ending in a line of spaces" (`canonical`, `edits`) and the importer's row I7: the item form trims the spaces that end the last line, and those can be content. Rows RT1 to RT3 are new |
| One more existing test changes: the saving-cost test | Found by running the prototype against the suites: reading definitions per raw block with a memory lexes nothing on a save |
| Row W5 (now RW5) has another source | `insertParagraphBeforeBlock()` does nothing in a plain paragraph, so the first version's row could not reach its expected save |
| Two reference-link corpus cases are also red for `edits` today | The fuzz carries the new definitions comparison, which the first measurement ran apart |
| The rows go into existing test files; `markdown-editor-raw-block-places.test.ts` is not created | Project rule: tests are rows in the existing table-driven files. The definitions check is added to the existing `expectSaveKeepsDocument`, so every row of that file gets it |
| Shape strings, line numbers and helper locations | List items are `markdown-list-item` nodes holding a `markdown-list-item-text` since `markdown-editor-list-item-node` |
| A differential check against the parent, and new fuzz baselines | Project rule; the earlier fuzz copy read the old list item shape |
| `depends-on` names the stack's tip, and the order of the three plans is stated | `markdown-editor-cross-item-range-removal` was written since and builds on `markdown-editor-raw-block-range-edits` |

---

## Addendum: Measurements

All at `85b55a8f4`. No source file was changed. The prototype is this plan's snippets, as printed, applied in memory by a Vite plugin while the tests load the modules (`proto/plugin.mjs`, `proto/patch-ec.txt`, and `proto/patch-ect.txt` for the harness and corpus edits). The scratch files are in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/raw-block-revision/`.

**The rows** (`zz-rbe-rows.test.ts`: the RL, RF, RT, RE, RW, RD and RC1 to RC7 rows through a copy of the edits file's helpers with the definitions check, plus the three Q rows):

| | Parent | Prototype |
|---|---|---|
| rows marked red (45) that fail | 45 | 0 |
| rows marked control (24) that pass | 24 | 24 |
| Q11, Q12 and Q13 load as | one raw block | the three shapes above |

RC8 throws on the parent and passes with the prototype (`zz-rbe-nodes.test.ts`).

**The round-trip folder** with the harness and corpus edits applied: 21 tests fail on the parent, exactly the checks the corpus tables mark red, and the 52 new `RB` rows pass. With the prototype all 4,618 tests pass. The `definitions` check holds for all 395 existing corpus cases on the parent.

**The existing Markdown test files** (21 files, 6,977 tests) with the prototype: five tests fail, the five of *Existing tests that change*. With the definitions check added to the edits file's `expectSaveKeepsDocument`, its 330 tests pass on the parent, and all but Q11 to Q13 with the prototype.

**The definitions lexer**, counted on `'[ref] and _em_\n\n_em_ alone\n\n[ref]: https://one'` (`zz-lexcount.test.ts`):

| | Parent | Prototype |
|---|---|---|
| a load | 12 calls | 3 |
| a save | 1 | 0 |
| a character typed in a paragraph, then a save | 3 + 2 | 0 + 0 |
| a character typed in the definition, then a save | 6 + 2 | 1 + 0 |

**The list-edit fuzz** (11 seeds of 1,500 documents): 14 failing documents on the parent, 1 with the prototype, described under *Verification*. The same run without the fuzz's `holdsBlankEdgedRawOutsideItems` exemption gives the same one document.

**The differential runs**: the numbers under *Verification*. The route matrix and the grid are the harnesses of the two sibling plans.

**Type check and lint.** The prototype was also applied to a scratch copy of `packages/lib`: `tsc -p tsconfig.lib.json`, `tsc -p tsconfig.test.json` and `eslint` on the editor folder report nothing.

---

## Notes

[^one-rule]: The list-item rule was written after three reviews in a row had each found a new defect in piecemeal checks of a raw block in an item (see `plans/implemented/markdown-editor-list-item-block-paste.md`, *Rule 1*). Its statement is "the item form, written by the serializer, is read by `marked` as the same blocks the text reads as on its own, at every place a block of an item is written". This plan's rule is that sentence with "item" taken out. A parallel predicate for block lists with its own probes was considered and rejected: at a block list every way a neighbour can change a reading is already answered by how the save writes the blocks (see *A block list keeps its blocks apart by how it writes them*), so a second predicate would have had one caller, the margin rule, which needs a comparison between two texts and not a yes or no.

[^block-list-form]: The docs page already says a raw block is saved, once edited, "without the up to three spaces of indentation before it, which mean nothing to Markdown". That was true only in a list item and at load. Writing a form everywhere makes it true, and it removes the differences between a save and its reload that the list-edit fuzz had to exempt (a first or last line holding nothing, and spaces before the block). The other way to stop a list from taking in an indented block is a `[//]: #` line before it, which `serializeListApart` writes today for a list node. It was rejected as the general answer: it leaves a visible line in the source for spaces that mean nothing, and it does not exist for a raw list followed by a block that is no list. The first version of this plan wrote the item form itself at every place. Run as a prototype, that failed two existing checks: the item form ends with `trimEnd()`, and in `` >``` `` over `>` and two spaces those spaces are the one line of a code block inside a quote, so the standard form read as another document. In a list item the load already drops such spaces, which is why the item form may; at a block list the load keeps them, so the block-list form keeps them too. The two forms share `BLANK_FIRST_LINES` and the margin rule.

[^margin]: `marked` decides whether a line without `>` continues a quote by a pattern that needs a character after a block tag name and allows no spaces before it. So `<div` as the last line of the input continues the quote, `<div` before a line end does not, and an indented `<div` always does. The source of defect 1 holds the indented form, which reads the same everywhere; the dedent turned it into the form that reads by its place, and `rawBlockAtMargin` did not notice because it compared the two texts alone. Comparing both readings rejects that dedent. Without a further candidate the block would keep the spaces before its *first* line too, and a raw list above it would take it in, which is defect 2 again; so the first line alone is tried at the margin last. Reading `text + "\n"` is the same probe `$readRawBlockAsBlocks` uses for an edited raw block, so the load and the edit ask one question. Lists are not given the new candidate when `isList` is `true`, which is how a load builds a raw list today.

[^eof-quote]: Making that text read one way everywhere means changing how the viewer reads `> q` over `<div` (and `a` over `<div`) at the end of an input. The tail-parity plan left exactly that as a Non-Goal and the user accepted it. It is not needed here: a raw block of such text exists only as the last block of its input, it is saved there as it was read, and Lexical marks a block dirty when a sibling is added after it, so the raw-block transform reads it again before a line end (row RL14).

[^no-new-reread]: In a list item a raw block that does not read back cannot be fixed by writing it differently: spaces before it shift the whole item, and a line that reads by what follows the item has nothing to stand apart from. So the list is read again. At a block list the blocks are always one blank line apart, and each of the ways a neighbour reaches across a blank line has a way of writing that stops it. `serializeListApart`, `listsJoin` and `LIST_SEPARATOR` are the precedent: two lists that would join are written apart, not merged in the editor. A pair re-read ("show a raw block and the block before it as their save reads") was considered and rejected for that reason, and because it would merge blocks the user sees as two when an invisible space is typed.

[^wide-check]: `writtenBlocks` has four piecemeal checks of this kind already: `endsOpen` for the last block at load, `joinsPreviousBlock`, `labelClosedAfter` and `fenceClosedAfter`. Each asks whether a block's source still reads as loaded next to what is now written around it. The missing case is a raw block that only a second blank line ends and that was not the last block at load. `takesInBlockAfter` is limited to raw blocks, so a save lexes nothing more for any other block, and to a block whose successor did not follow it at load, because the source's own text between the two is kept otherwise. One general check (lex every source block with its neighbours) was rejected for its cost: `readsOtherwiseAfter` builds the text of every later block, which is quadratic over a document.

[^per-block]: Only a raw block can hold a definition: the serializer escapes the `[` of any other text. The serializer therefore lexed the raw blocks' text joined by blank lines, on the ground that "a raw block lexes alone as it does in the document". The join is where that fails: `<div` followed by a blank line and a definition is one HTML block. In the document the `<div` ended with its column or list item, or was followed by two blank lines. Reading each raw block's written form alone is exact as long as every raw block stands where it is written, which is this plan's rule. Measured: with the prototype the editor's definitions equal the viewer's for every corpus case, every edit-fuzz run and every step of every row of the edits file. The other exact reading, lexing the whole saved document, was rejected: it costs a full save for every read, and the definitions are read inside node transforms on every keystroke. The memory keeps the per-block reading cheaper than today's, since text without a `[` is not lexed at all and a text already read is not lexed again (see the addendum's counts).

[^json-source]: `registerDefinitionRules` keeps the definitions source of each committed state and lexes it only when it changed. Joined with a blank line, the two raw blocks `<!-- c` and `[x]: /u` have the same source as one raw block holding both lines, but not the same definitions. JSON of the list of texts cannot collide. A separator character was considered and rejected: nothing guarantees a pasted text does not hold it.

[^null-proto]: `marked` builds its link map with `Object.create(null)`, and the corpus has cases for the labels `constructor` and `__proto__`. A map built as `{}` and filled with `??=` loses `[constructor]: …`, because `{}.constructor` is already defined.

[^caret-walk]: After an edit makes a raw block read as several blocks, `$showRawBlockAsItsBlocks` puts the caret back at the same offset of the text. `$selectTextOffset` found the place by subtracting each text node's and each line break's size and selecting in the first text node with `remaining <= size`. Two line breaks in a row take `remaining` from 1 to -1, and `-1 <= size` holds. `<pre>`, comments and definitions with a blank line in their title are the raw blocks that hold empty lines, and a paste ending in a line end is what leaves the caret on one. The selection was set with a negative offset, and the next read of the selection threw. An element point before the line break is how Lexical itself addresses an empty line of a block.

[^definitions-check]: Without it defect 4 is invisible to the harness unless a title holds a blank line: an inline link and a reference link render the same, so `canonical` holds. The check compares what the editor believes with what the saved file says, which is the contract. It is green on the parent for all 395 corpus cases, all 3,160 edit-fuzz runs and all 330 tests of the edits file, so it adds no known divergence. The `//` label is left out when only the save's own separator line defines it, because that line is no part of the editor's document.

[^item-flip]: Rows Q11 to Q13 were written when the raw block's dedented text was the only form on offer; their comment says "it is its text, not the source, that must read the same". With the first-line-only candidate the text is `> q` over an indented `<div`, which reads as one quote at all five places of an item. The rule then finds a smaller piece that reads back (the quote) than the one those rows pin (the list). Measured with the prototype: each of the three documents loads as the shape given, saves as its source and holds every check of `expectSaveKeepsDocument`. Limiting the candidate to block lists would keep the three rows as they are, at the price of two margin rules, one per place, which the one rule exists to avoid.

[^rows-in-files]: The first version of this plan created `markdown-editor-raw-block-places.test.ts` with a copy of 300 lines of helpers from the edits file. The rows need exactly that file's `Row` and `runRow`, and a copy of them drifts: the list-item-node branch changed `TEXT_ONLY_BLOCKS` in the original after the copy was specified. `markdown-editor-cross-item-range-removal`, written under the same rule, adds its rows to the same files.

[^order]: Three reasons to go first. Plan 2 calls the raw-block re-read from inside its range removal, which reaches `$selectTextOffset`; after this plan that call cannot leave a negative offset. Plan 2's rows do not depend on the order: its matrix was measured on a prototype of plan 2 alone and on a prototype of both plans, and no cell fails its assertion in either (the block-list form changes eight Shift+Enter cells and their controls alike, by one blank line). And both plans edit `markdownWritable.ts` next to each other, so one of them has to name the other. If plan 2 does land first, this plan is unchanged: no step here edits `registerRawBlockRules`, and `$showRawBlockAsSaved` is found by name wherever it stands.
