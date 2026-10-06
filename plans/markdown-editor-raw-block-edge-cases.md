---
depends-on: [markdown-editor-list-item-block-paste]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/markdownImporter.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Raw Block Edge Cases — Implementation Plan

## Overview

In `MarkdownEditor`'s WYSIWYG mode, a *raw block* (`MarkdownRawBlockNode`) holds Markdown the editor has no rich-text form for. The editor shows its source, and a save writes it. The branch below this plan (`markdown-editor-list-item-block-paste`) settled one rule for a raw block inside a list item: the text must read in the item exactly as it reads alone. Outside list items there is no such rule, so a raw block's reading can depend on the blocks next to it.

This plan gives the rule its counterpart for a *block list*: the document's top-level blocks, or the blocks of one `:::` column. It fixes six defects found by a seeded list-edit fuzz and by review probes. That branch introduced none of them: each fails the same way one branch further down. Five have one cause (a raw block is read, written or counted without regard to where it stands). The sixth is a caret calculation.

The changes are in [markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts), [markdownImporter.ts](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts) and [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts). The lexer (`markdownExtensions.ts`) and `MarkdownEditor.ts` are not touched. The round-trip harness gains one check, the corpus gains cases, a new test file pins the rows, and the docs page and the changelog are updated. There is no public API change.

The plan is written against `f4bfedf2c`, the tip of `feature/markdown-editor-list-item-block-paste`. Line numbers are from that commit. Sibling plans edit the same files, so find each site by its symbol name. No source file was changed while this plan was written; see the [addendum](#addendum-measurements) for how each expected value was checked.

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
| **A. The load drops indentation a raw block's reading needs.** `rawBlockAtMargin` removes the indentation before a raw block (a *dedent*) when the text without it reads the same *alone*. `> q⏎<div` reads as one quote where its input ends and as a quote and an HTML block before a line end, so the dedented text only means what the source meant while it is the last block. | 1 | [markdownSerializer.ts:1786](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1786) |
| **B. Outside a list item a raw block is written as typed.** `$rawBlockSource` drops the indentation and the blank edge lines that mean nothing only for a raw block of a list item. At the top level typed spaces are written, and a list above takes the block in. | 2 | [markdownSerializer.ts:1628](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1628) |
| **C. A raw block that writes nothing still counts as a neighbour.** `serializeListApart` looks for the block after a list and skips only empty paragraphs, so an emptied raw block hides the raw list behind it. | 3 | [markdownSerializer.ts:1488](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1488) |
| **D. A raw block written as its loaded source loses its second blank line.** `<div` is an HTML block that only a second blank line ends. `serializeRawBlock` writes that line, but `writtenBlocks` writes an unedited top-level block as its source and separates it from an edited block with one blank line. | 5 | [markdownSerializer.ts:1199](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1199) |
| **E. The document's definitions are read from the raw blocks' text joined as if all stood at the top level.** A raw block that does not end at one blank line (`<div`, `<!-- c`) is confined by its column or list item in the document, but in the joined text it takes in the definition after it. The editor then holds fewer definitions than the viewer, or another first definition for a label. | 4 | [markdownSerializer.ts:738](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L738) |
| **F. A caret offset on a line that holds no text walks below zero.** `$selectTextOffset` subtracts each line break from the offset and selects in the next text node with whatever is left, also when that is negative. | 6 | [markdownWritable.ts:929](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L929) |
| **G. A route's insert runs before the raw block is read again.** | 7 | the sibling plan `markdown-editor-raw-block-range-edits`; not planned here |

Causes A to E are one: nothing asks, for a raw block of a block list, whether its text reads where it is written as it reads alone.

---

## Architecture Decisions

### One rule — a raw block is written in one form, and that form reads where it is written as it reads alone

The rule for every raw block, wherever it stands:

> A raw block is written in its *written form*. `marked` must read that form, where the save writes it, as exactly the blocks it reads the form as alone, and must read the blocks around it as it reads them without it. Where a text has no such form at a place, the editor holds no raw block of it there: the smallest piece around it that does read back is the raw block.

This generalises the list-item rule `rawBlockStandsInItem` ([markdownSerializer.ts:1676](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1676)), which stays as it is.[^one-rule] The same three sites keep the rule at each place: the save, the load and an edit.

| Place | Checked by | When the text does not read back there | When an edit breaks it |
|---|---|---|---|
| a block of a list item | `rawBlockStandsInItem`: the form written at five places of an item (unchanged) | the list is the raw block: of the item around it when it is nested, else of the block list (unchanged) | the outermost list is shown anew as its save reads, `$readListAgainAroundRawBlock` (unchanged) |
| a block of the document or of a `:::` column | the margin rule (`rawBlockAtMargin`, which decides how much indentation a raw block loses): the form reads the same where its input ends and before a line end (**new**); the writer keeps the blocks around it apart (two gaps closed) | the raw block keeps the indentation its reading needs (**new**). It is always built: its text is the source | the raw block is shown as the blocks its text reads as before a line end, `$showRawBlockAsItsBlocks` (unchanged) |
| inside a quote | — a quote node holds one paragraph and no block | the whole quote is the raw block (`$buildQuote` returns `null`, unchanged), judged at the place the quote stands | as for that place |

### One written form for every place — `rawBlockForm`

`rawBlockInItem` ([markdownSerializer.ts:1649](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1649)) is renamed `rawBlockForm`, and `$rawBlockSource` returns it for every raw block, not only for one in a list item.[^form-everywhere]

| Raw block's text in the editor | Written form | Why |
|---|---|---|
| `  <div>⏎y⏎</div>` | `<div>⏎y⏎</div>` | up to three spaces before a block mean nothing, and a list above would take the block in |
| `⏎<div>` , `<div>⏎` | `<div>` | a blank edge line is only space between blocks |
| two spaces and nothing else | nothing | whitespace alone is no block |
| `  - x⏎  - y⏎- z⏎  > q` | unchanged | without the spaces `y` would nest under `x` |
| `> q⏎  <div` | unchanged | the first line is at the margin; the second line's spaces keep it in the quote |

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

### A caret offset on a line that holds no text becomes an element point

`$selectTextOffset` selects inside a text node when the offset falls in one, and at an element point before a line break when the offset falls exactly there. The remaining offset never goes below zero.[^caret-walk]

| Block's children | Offset | Today | After |
|---|---|---|---|
| `"<pre>"`, break, break, break, `"x2"` | 5 | `"<pre>"`@5 | the same |
| | 6 | `"x2"`@-2, which throws | element point 2 (the first empty line) |
| | 7 | `"x2"`@-1, which throws | element point 3 (the second empty line) |
| | 8 | `"x2"`@0 | the same |

### The harness checks that the editor and the viewer hold the same definitions

The round-trip harness gains a seventh check, `definitions`: the definitions the editor reads off its document equal the ones the viewer's lexer reads off the save. It runs for every corpus case, in the edit fuzz after every edit sequence, and in this plan's rows.[^definitions-check] The label `//` is left out when only a `[//]: #` line the save itself wrote defines it.

### Three list-item rows change — a quote whose last line is indented deeper is a raw block of its item

The margin rule is one function for every place, so its new candidate also applies to a raw block of a list item. Three rows of the branch below pin lists that stay raw because their quote's dedented text reads by what follows it. With the indentation kept on the quote's later line, the quote reads the same wherever it stands in the item, and those lists load as lists.[^item-flip]

| Source | Loads today | Loads after |
|---|---|---|
| `- a⏎⏎→> q⏎→</div` (`→` is a tab) | one raw block | a list; its item holds the raw block `> q⏎  </div` |
| `- a⏎⏎   > q⏎   <div⏎- z` | one raw block | a list; its first item holds the raw block `> q⏎ <div` |
| `* w0⏎→> q1⏎→<div⏎→::: {align=center}⏎→f2⏎→:::⏎* w3⏎⏎→p` | one raw block | a list; its first item holds the quote, with the four lines it takes in, as one raw block |
| `- a⏎⏎  > q⏎  <div⏎- z` (the last line no deeper than the quote) | one raw block | one raw block (unchanged) |

### Order with `markdown-editor-raw-block-range-edits`

Defect 7 is that plan's and nothing here covers it. This plan needs nothing from it and it needs nothing from this plan. Implement this plan first.[^order] This plan does not rename or restructure the raw-block transform (`$showRawBlockAsSaved` inside `registerRawBlockRules`), which the sibling plan exports.

### No public API change

Every changed symbol is module-internal to the editor folder. `MarkdownEditor`'s methods, options and events are unchanged.

---

## Internal Structure

Write full JSDoc per CODE_CONVENTIONS for every new function; the bodies are below. A call's result is assigned to a constant before it is tested, as elsewhere in these files.

### `markdownSerializer.ts` — the written form

Rename `rawBlockInItem` to `rawBlockForm` everywhere (its definition, its uses in `rawBlockStandsInItem`, and its import and use in `markdownImporter.ts`). Its body does not change. Its JSDoc now states the rule of this plan's first decision and says the form is written at every place.

```typescript
export function $rawBlockSource(node: MarkdownRawBlockNode): string {
    return rawBlockForm(node.getTextContent());
}
```

### `markdownSerializer.ts` — the margin rule

Add `readingInBlockList` directly before `blockShape` ([:1816](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1816)). `READING_KEY_SEPARATOR` is the existing constant ([:297](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L297)).

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

In `serializeListApart`, replace the `nextNode` line:

```typescript
    // A paragraph or raw block that writes nothing keeps the list from nothing: the block after it is the neighbour.
    const writesNothing = (node: LexicalNode): boolean => ($isParagraphNode(node) || $isMarkdownRawBlockNode(node))
        && serializeBlock(node, definitions) === "";

    const nextNode = following.find((node) => !writesNothing(node));
```

### `markdownSerializer.ts` — a raw block written as its source keeps its second blank line

In `writtenBlocks`, the loop that runs from the end becomes:

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

Replace `$lexDefinitions` and `$definitionsSource`, and change one line of `rawBlockTexts`. Place the two constants with the file's other constants. `DEFINITIONS_READ` is bounded the way `STANDS_IN_ITEM` ([:102](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L102)) is.

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
| `$readDefinitions` ([:679](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L679)), `$collectDefinitions` ([:717](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L717)) | `$lexDefinitions()` | `$documentDefinitions()` |
| `$runsReadingOtherwise` ([:839](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L839)), `formsWholeLinks` ([:3339](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L3339)) | `lexMarkdownLinkDefinitions($definitionsSource())` | `$documentDefinitions()` |
| `$buildInlineContent` ([markdownImporter.ts:365](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L365)) | `lexMarkdownLinkDefinitions($definitionsSource())` | `$documentDefinitions()` |
| `$readListAgainAroundRawBlock` ([markdownWritable.ts:866](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L866)) | `lexMarkdownLinkDefinitions($definitionsSource())` | `$documentDefinitions()` |
| `registerDefinitionRules` ([markdownWritable.ts:1074](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1074), [:1078](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1078)) | `lexMarkdownLinkDefinitions("")`, `lexMarkdownLinkDefinitions(source)` | `definitionsOfSource(NO_DEFINITIONS_SOURCE)` with `source: NO_DEFINITIONS_SOURCE`, and `definitionsOfSource(source)` |

`$importMarkdown` keeps `lexMarkdownLinkDefinitions(source)` ([markdownImporter.ts:230](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L230)): while a document loads, the definitions are the viewer's own reading of the source. `$lexDefinitions` is deleted.

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

Work test-first. Run test files from `packages/lib` with `npx vitest run <file>`. A fresh worktree needs `node_modules` and `packages/lib/node_modules` symlinked to the main tree's; do not run `npm install`.

1. **Harness check.** In `tests/component/markdown-roundtrip/corpus/types.ts` add `'definitions'` to `HarnessCheck` and one sentence to its comment (the editor reads the same link reference definitions off its document as the viewer reads off the save). In `harness.ts` add `editorDefinitions` and `viewerDefinitions` as in *Internal Structure*. In `markdown-roundtrip.test.ts` add, after the `canonicalIdempotence` test of the corpus loop:
   ```typescript
        it(checkTitle(testCase, 'definitions'), () => {
            const { editor, saved } = loadAndSave(testCase.source);
            const own = editorDefinitions(editor);

            assertCheck(testCase, 'definitions', own, viewerDefinitions(saved, own));
        });
   ```
   In `markdown-edit-fuzz.test.ts`, in `fuzzSequence` after `checkNoWordLost(testCase, run);`, add the same comparison on `run.editor` and `run.saved` with `expect(own, run.context).toEqual(viewerDefinitions(run.saved, own))`, skipped when `knownDivergence(testCase, 'definitions')`. Check: `npx vitest run tests/component/markdown-roundtrip/` is green (no existing case fails the new check).
2. **Corpus cases.** Add the cases of [Round-trip corpus](#round-trip-corpus) to `corpus/dialect.ts` and `corpus/referenceLinks.ts`. In `markdown-edit-fuzz.test.ts` add to `RAW_BLOCK_POSITIONS`: `['a block after a list', '- a\n\n<div>\nw\n</div>']`. Check: `npx vitest run tests/component/markdown-roundtrip/` fails exactly the checks the corpus table marks red; the 52 new `RB` rows pass.
3. **New test file.** Create `tests/component/markdown-editor-raw-block-places.test.ts` as [Expected Behaviour](#expected-behaviour) describes. Check: the rows marked *red* fail and the rows marked *control* pass. If a control fails or a red row passes, stop and re-read the row.
4. **Existing tests that change.** Make the edits of [Existing tests that change](#existing-tests-that-change). The importer test fails until step 5, the three list-item rows until step 6.
5. **The written form.** In `markdownSerializer.ts` rename `rawBlockInItem` to `rawBlockForm` and replace the body of `$rawBlockSource`. In `markdownImporter.ts` update the import ([:42](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L42)) and the one use in `$buildItemBlock`. Check: `grep -rn 'rawBlockInItem' packages/lib/src packages/lib/tests` gives no match. Rows F1 to F9 pass.
6. **The margin rule.** Add `readingInBlockList` and replace the body of `rawBlockAtMargin`. Rows L1 to L10 and the three changed list-item rows pass.
7. **A block that writes nothing.** Change `serializeListApart`. Rows E1 to E5 pass (E4 needs step 5 too).
8. **The second blank line.** Change the loop of `writtenBlocks` and add `takesInBlockAfter`. Rows W1 to W5 pass.
9. **Definitions in the serializer.** Add the two constants and the four functions, change `rawBlockTexts`, delete `$lexDefinitions`, and change the four serializer call sites. Check: `grep -n 'lexDefinitions\|lexMarkdownLinkDefinitions(\$definitionsSource' packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` gives no match, and the file calls `lexMarkdownLinkDefinitions` once, in `definitionsOfText`.
10. **Definitions in the importer and the definition rule.** Change `$buildInlineContent`, `$readListAgainAroundRawBlock` and `registerDefinitionRules` as the call-site table says. Import `$documentDefinitions` in `markdownImporter.ts`, and `$documentDefinitions`, `definitionsOfSource` and `NO_DEFINITIONS_SOURCE` in `markdownWritable.ts`; remove `lexMarkdownLinkDefinitions` from `markdownWritable.ts`'s import ([:26](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L26)), where nothing uses it any more. Check: `grep -rn 'lexMarkdownLinkDefinitions(\$definitionsSource' packages/lib/src` gives no match. Rows D1 to D8, D12 and D13 and the new corpus cases pass.
11. **The caret.** Replace the body of `$selectTextOffset`. Every P row passes.
12. **JSDoc.** Update every comment that describes the old design: `rawBlockForm` (the rule, every place), `$rawBlockSource`, `rawBlockStandsInItem` (the renamed form), `rawBlockAtMargin` (both places; the first-line-only candidate), `serializeRawBlock` ("its text as written" becomes "its written form"), `serializeListApart` (a block that writes nothing), `writtenBlocks` (the third condition), `$collectDefinitions`, `$readDefinitions`, `rawBlockTexts`, `$definitionsSource` (the JSON of the written forms), `registerDefinitionRules` (definitions are read raw block by raw block), `$buildItemBlock`, and `$readRawBlockAsBlocks` ([markdownImporter.ts:284](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L284)): its sentence "The last block of a document or `:::` column may have none after it and reads the same" becomes "A raw block is read as it reads before a line end also when it is the last block, so that it never depends on staying last". Check: `grep -n 'joined as blocks' packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` gives no match.
13. **Run the Markdown suites**: `npx vitest run tests/component/markdown-roundtrip/ tests/component/markdown-importer.test.ts tests/component/markdown-serializer.test.ts tests/component/markdown-editor-list-item-edits.test.ts tests/component/markdown-editor-list-item-paste.test.ts tests/component/markdown-source-preservation.test.ts tests/component/markdown-editor.test.ts tests/component/markdown-editor-columns.test.ts tests/component/markdown-editor-command-crashes.test.ts tests/component/markdown-editor-table-edge.test.ts tests/component/markdown-editor-raw-block-places.test.ts`. An expected string of an existing test may change only as [Existing tests that change](#existing-tests-that-change) allows.
14. **Docs**: `docs/components/MarkdownEditor.md`, `docs/reference/changelog/next.md` and the `listItemBlocks` reason in `tests/component/markdown-roundtrip/corpus/divergences.ts`, as in [Documentation Impact](#documentation-impact).
15. **Verification**, in full.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/component/markdown-editor-raw-block-places.test.ts` |
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
| Modify | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Everything in this section is unit-testable offline in `markdown-editor-raw-block-places.test.ts`, unless it is under [Manual (browser) checks](#manual-browser-checks). Expected strings are `getValue()`, written as TypeScript string literals.

### The test file's helpers

Copy from [markdown-editor-list-item-edits.test.ts](../packages/lib/tests/component/markdown-editor-list-item-edits.test.ts) (lines 9 to 315): the imports, `CONFIG`, `beforeEach`/`afterEach`, `TextPoint`, `Step`, `lexicalOf`, `load`, `$textNode`, `selectText`, `selectCharacterAtCaret`, `press`, `shapeOf`, `rawBlockReadings`, `TEXT_ONLY_BLOCKS`, `blocksInText`, `expectSaveKeepsDocument`, `Row` and `runRow`. Two additions:

- At the end of `expectSaveKeepsDocument`, the definitions check: `const own = editorDefinitions(editor); expect(own, …).toEqual(viewerDefinitions(saved, own));`.
- A step `{ key: 'paste'; text: string; at?: TextPoint }`, which pastes plain text as `pasteText` does in [markdown-editor-list-item-paste.test.ts:665](../packages/lib/tests/component/markdown-editor-list-item-paste.test.ts#L665) (a `PASTE_COMMAND` inside one discrete update, with the four `vi.stubGlobal` lines; call `vi.unstubAllGlobals()` in `afterEach`).

`runRow` checks the document after the load and after every step: the save reloads to the document the editor shows, each raw block reads as it did, saving the reload changes nothing, the viewer reads the save as the editor shows it (unless `comparesWithViewer` is `false`: a document holding a raw list or raw quote, which the viewer renders), the standard form reads and reloads the same and saves unchanged, and the definitions agree. A row then pins `saved` and `shape` where the table gives them.

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

Rows that hold a raw list or a raw quote at any step set `comparesWithViewer: false`: every L row except L13, rows F1, F2, F3, F5, F9, F11 and F12, rows E1 to E5 and E7, and rows W7 and D10.

### L — a quote whose last line stays in it only while indented

| # | Source | Steps | Saved after the last step | Shape after the last step | Today |
|---|---|---|---|---|---|
| L1 | `'p\n\n  > q\n  <div\n\nz'` | none | — | `paragraph("p")`, `markdown-raw-block("> q", linebreak, "  <div")`, `paragraph("z")` | red |
| L2 | `inColumn('  > q\n  <div\n\nw')` | none | — | first column: `markdown-raw-block("> q", linebreak, "  <div")`, `paragraph("w")` | red |
| L3 | `'   > q\n   <div\n\nz'` | none | — | `markdown-raw-block("> q", linebreak, "   <div")`, `paragraph("z")` | red |
| L4 | `'***\n\n  > q\n  </div\n\nw'` | none | — | `markdown-raw-block("***")`, `markdown-raw-block("> q", linebreak, "  </div")`, `paragraph("w")` | red |
| L5 | `'  > a\n  > b\n  <div\n\nz'` | none | — | `markdown-raw-block("> a", linebreak, "  > b", linebreak, "  <div")`, `paragraph("z")` | red |
| L6 | `'  > q\n  </div'` | none | — | `markdown-raw-block("> q", linebreak, "  </div")` | red |
| L7 | L1's | `typeX(['z', 1])` | `'p\n\n  > q\n  <div\n\nzX'` | — | red |
| L8 | L1's | `typeX(['> q', 3])` | `'p\n\n> qX\n  <div\n\nz'` | — | red |
| L9 | L1's | Backspace at `['  <div', 2]`, Backspace at `[' <div', 1]` | `'p\n\n> q\n\n<div\n\n\nz'` | `paragraph("p")`, `quote("q")`, `markdown-raw-block("<div")`, `paragraph("z")` | red |
| L10 | `` `${RAW_LIST}\n\n[//]: #\n\n  > q\n  <div\n\nz` `` | `{ key: 'removeBlock', index: 1 }` | `` `${RAW_LIST}\n\n> q\n  <div\n\nz` `` | — | red |
| L11 | `'> q\n<div'` | none | — | `markdown-raw-block("> q", linebreak, "<div")` | control |
| L12 | `'  > q\n<div'` | none | — | `markdown-raw-block("> q", linebreak, "<div")` | control |
| L13 | `'  <div>\n  x\n  </div>\n\nz'` | none | — | `markdown-raw-block("<div>", linebreak, "x", linebreak, "</div>")`, `paragraph("z")` | control |
| L14 | `'> q\n<div'` | Enter at `['<div', 4]`, type `z` | `'> q\n\n<div\n\n\nz'` | `quote("q")`, `markdown-raw-block("<div")`, `paragraph("z")` | control |
| L15 | `'- a\n\n  > q\n   <div\n- z'` | none | — | `list(listitem("a", markdown-raw-block("> q", linebreak, " <div")), listitem("z"))` | control |
| L16 | `'- a\n\n  > q\n\t</div'` | none | — | `list(listitem("a", markdown-raw-block("> q", linebreak, "  </div")))` | control |

The shape column lists the root's blocks in order; `shapeOf` joins them with `" | "`. L2's full shape is `markdown-block(markdown-column(…the two blocks…), markdown-column(paragraph("v")))`.

L9 is the edit that breaks the rule: once the last line has no space before it, the raw block reads as two blocks before a line end, and the editor shows them. L11, L12 and L14 pin the text that reads by its place: it stays a raw block while it is last, and a block added after it shows it as a quote and a raw block.

### F — the written form

| # | Source | Steps | Saved after the last step | Today |
|---|---|---|---|---|
| F1 | `` `${RAW_LIST}\n\n${HTML}` `` | type two spaces at `['<div>', 0]` | the source | red |
| F2 | `` `${RAW_LIST}\n\n[x]: /u` `` | type three spaces at `['[x]: /u', 0]` | the source | red |
| F3 | `'1) w\n   > x\n\n<div>\ny\n</div>'` | type three spaces at `['<div>', 0]` | the source | red |
| F4 | `` `- a\n\n${HTML}` `` | type two spaces at `['<div>', 0]` | the source (today a `[//]: #` line is written and the spaces are kept) | red |
| F5 | `` inColumn(`${RAW_LIST}\n\n${HTML}`) `` | type two spaces at `['<div>', 0]` | the source | red |
| F6 | `` `p\n\n${HTML}` `` | type three spaces at `['<div>', 0]` | the source | red |
| F7 | `` `${HTML}\n\nb` `` | Shift+Enter at `['</div>', 6]` | the source | red |
| F8 | `` `p\n\n${HTML}\n\nb` `` | Shift+Enter at `['<div>', 0]` | the source | red |
| F9 | `` `${RAW_LIST}\n\n${HTML}\n\nb` `` | type two spaces at `['<div>', 0]`, then `typeX(['b', 1])` | `` `${RAW_LIST}\n\n${HTML}\n\nbX` `` | red |
| F10 | `` `p\n\n${HTML}` `` | type four spaces at `['<div>', 0]` | ``'p\n\n```\n<div>\n```\n\ny\n\n</div>'`` (four spaces make indented code; the editor shows the blocks) | control |
| F11 | `'- a\n\n[//]: #\n\n  - x\n  - y\n- z\n  > q'` | `{ key: 'removeBlock', index: 1 }` | the source: the raw list keeps the spaces it reads by, and the `[//]: #` line is written again | control |
| F12 | `` `${RAW_LIST}\n\n${HTML}` `` | type a tab at `['<div>', 0]` | not pinned; the checks hold | control |

### E — a raw block that writes nothing

The step *empty* is `{ key: 'Backspace', at: ['<div>', 0], to: ['<div>', 5] }`.

| # | Source | Steps | Saved after the last step | Today |
|---|---|---|---|---|
| E1 | `'- w\n\n<div>\n\n- n\n  > q'` | empty | `'* w\n\n- n\n  > q'` | red |
| E2 | `'1. w\n\n<div>\n\n1. n\n   > q'` | empty | `'1) w\n\n1. n\n   > q'` | red |
| E3 | `inColumn('- w\n\n<div>\n\n- n\n  > q')` | empty | `inColumn('* w\n\n- n\n  > q')` | red |
| E4 | E1's | `{ key: 'type', text: ' ', at: ['<div>', 0], to: ['<div>', 5] }` | `'* w\n\n- n\n  > q'` | red |
| E5 | E1's | empty, then `typeX(['w', 1])` | `'* wX\n\n- n\n  > q'` | red |
| E6 | `'- w\n\n<div>\n\n- n'` | empty | `'- w\n\n* n'` | control |
| E7 | `'- w\n  > x\n\n<div>\n\n- n\n  > q'` | empty | `'- w\n  > x\n\n[//]: #\n\n- n\n  > q'` | control |

### W — a raw block only a second blank line ends

| # | Source | Steps | Saved after the last step | Today |
|---|---|---|---|---|
| W1 | `'<div\n\n\nb'` | `typeX(['b', 1])` | `'<div\n\n\nbX'` | red |
| W2 | `'<div\n\n\nb\n\nc'` | `{ key: 'removeBlock', index: 1 }` | `'<div\n\n\nc'` | red |
| W3 | `'<div\n\n\n<div\n\n\nb'` | `typeX(['b', 1])` | `'<div\n\n\n<div\n\n\nbX'` | red |
| W4 | `'a\n\n</details\n\n\nb'` | `typeX(['b', 1])` | `'a\n\n</details\n\n\nbX'` | red |
| W5 | `'<div\n\n\nb'` | `{ key: 'command', run: (editor) => editor.insertParagraphBeforeBlock(), at: ['b', 0] }`, type `n` | `'<div\n\n\nn\n\nb'` | red |
| W6 | `'a\n\n<div\n\n\nb'` | `typeX(['a', 1])` | `'aX\n\n<div\n\n\nb'` | control |
| W7 | `'> <div\n\n\nb'` | `typeX(['b', 1])` | `'> <div\n\nbX'` (the quote ends the HTML block) | control |
| W8 | `inColumn('<div\n\n\nb')` | `typeX(['b', 1])` | `inColumn('<div\n\n\nbX')` | control |
| W9 | `'<div>\n\nb'` | `typeX(['b', 1])` | `'<div>\n\nbX'` | control |

### D — the document's definitions

Each row also holds the `definitions` check after the load and after every step; that check alone is red today for D1 to D8, D12 and D13.

| # | Source | Steps | Saved after the last step | Today |
|---|---|---|---|---|
| D1 | `` `${COLUMNS}\n\nb [x] c` `` | `typeX(['b ', 1])` | `` `${COLUMNS}\n\nbX [x] c` `` | red |
| D2 | `'- a\n\n  <!-- c\n- b [x] z\n\n  [x]: /u'` | `typeX(['b ', 1])` | `'- a\n\n  <!-- c\n\n- bX [x] z\n\n  [x]: /u'` | red |
| D3 | `'<div\n\n\n[x]: /u\n\nb [x] c'` | `typeX(['b ', 1])` | `'<div\n\n\n[x]: /u\n\nbX [x] c'` | red |
| D4 | `` `${COLUMNS}\n\n[x]: /v\n\nb [x] c` `` | `typeX(['b ', 1])` | `` `${COLUMNS}\n\n[x]: /v\n\nbX [x] c` `` | red |
| D5 | `'::: columns\n<div\n\|\|\|\n[x]: /u "t\n\nu8"\n:::\n\nb [x] c'` | none | not pinned; the standard form keeps `[x]` | red |
| D6 | `'- a\n\n  <div\n- b [x] z\n\n  [x]: /u "t\n\n  u8"'` | none | not pinned; the standard form keeps `[x]` | red |
| D7 | `'<div\n\n\n[x]: /u\n\n[a][x]'` | `{ key: 'removeBlock', index: 1 }` | `'<div\n\n\n[a](/u)'` | red |
| D8 | `'- a\n\n  <!-- c\n- b\n\n[x]: /u\n\nb [x] c'` | `typeX(['b ', 1])` | `'- a\n\n  <!-- c\n- b\n\n[x]: /u\n\nbX [x] c'` | red |
| D9 | `'[constructor]: /u\n\nb [constructor] c'` | `typeX(['b ', 1])` | `'[constructor]: /u\n\nbX [constructor] c'` | control |
| D10 | `'> <div\n\n[x]: /u\n\nb [x] c'` | `typeX(['b ', 1])` | `'> <div\n\n[x]: /u\n\nbX [x] c'` | control |
| D11 | `'[x]: /u\n\n[x]: /v\n\nb [x] c'` | `typeX(['b ', 1])` | `'[x]: /u\n\n[x]: /v\n\nbX [x] c'` | control |
| D12 | `` `${COLUMNS}\n\nb [x] c` `` | `{ key: 'type', text: ' w', at: ['[x]: /u', 7] }` | `'::: columns\n<div\n\|\|\|\n\\[x\\]: /u w\n:::\n\nb [x](/u) c'` | red |
| D13 | D5's | `typeX(['[x]: /u "t', 10])` | `'::: columns\n<div\n\|\|\|\n[x]: /u "tX\n\nu8"\n:::\n\nb [x] c'` | red |
| D14 | D12's with `<div>` for `<div` | D12's | D12's with `<div>` for `<div` | control |
| D15 | D13's with `<div>` for `<div` | D13's | D13's with `<div>` for `<div` | control |

In D5, D12 and D13 `\|` stands for `|`. D4 is "a definition treated as repeated when it is not": today the editor takes `/v` for `x`, because the `<div` before it hides `/u`. D7 removes the definition, so the link is written inline with its own URL, as documented; the row pins that the raw block before it keeps its second blank line.

D12 and D13 edit the hidden definition itself. In D12 the typed ` w` makes the line a paragraph, so the definition is gone and the link is written inline; today the editor does not see a definition go, and saves `b [x] c`, which reads as plain text. In D13 the definition's title changes and the link takes it, as the docs page says a link whose title holds a blank line does; today the link keeps the old title. D14 and D15 are the same edits where the first column's HTML block is closed, which today's reading handles: they pin that the two fixed rows end where the unaffected documents already do.

### P — a paste that leaves the caret on an empty line

Each row loads the source, pastes plain text (the `paste` step) and asserts: the paste does not throw; `getValue()`; the selection is collapsed with its anchor as the table says; `lexicalOf(editor).read(() => $getSelection()!.getNodes())` does not throw; and `expectSaveKeepsDocument`.

| # | Source | Paste at | Pasted text | `getValue()` | Anchor after the paste | Today |
|---|---|---|---|---|---|---|
| P1 | `'<pre>\nx1\nx2\n</pre>'` | `['x1', 2]` | `'\n</pre>\n\n<pre>\n\n'` | `'<pre>\nx1\n</pre>\n\n<pre>\n\n\nx2\n</pre>'` | element point, offset 3, in root child 1 | red (throws) |
| P2 | P1's | `['x1', 2]` | `'\n</pre>\n\n<pre>\n'` | `'<pre>\nx1\n</pre>\n\n<pre>\n\nx2\n</pre>'` | element point, offset 2, in root child 1 | red (throws) |
| P3 | `'<!-- a\nx1\nx2\n-->'` | `['x1', 2]` | `'\n-->\n\n<!--\n\n'` | `'<!-- a\nx1\n-->\n\n<!--\n\n\nx2\n-->'` | element point, offset 3, in root child 1 | red (throws) |
| P4 | `'a\n\n<pre>\nx1\nx2\n</pre>\n\nb'` | `['x1', 2]` | P1's | `'a\n\n<pre>\nx1\n</pre>\n\n<pre>\n\n\nx2\n</pre>\n\nb'` | element point, offset 3, in root child 2 | red (throws) |
| P5 | `'- a\n\n  <pre>\n  x1\n  x2\n  </pre>\n- b'` | `['x1', 2]` | P1's | not pinned | an element point in a raw block | red (throws) |
| P6 | P1's | `['x1', 2]` | P1's, then the step `{ key: 'type', text: 'Y' }` | `'<pre>\nx1\n</pre>\n\n<pre>\n\nY\nx2\n</pre>'` | not asserted | red (throws) |
| P7 | P1's | `['x1', 2]` | `'\n</pre>\n\n<pre>'` | `'<pre>\nx1\n</pre>\n\n<pre>\nx2\n</pre>'` | text point `"<pre>"`@5 of root child 1 | control |

One more row replays the review's own paste of copied nodes: load `'w0\n\n<pre>\nx1\n\nx2\n</pre>\n\n<pre>\nx3\n\nx4\n</pre>'`, copy from the fourth text node (`x2`) at offset 2 to the eighth (`x4`) at offset 0, paste at the seventh (`x3`) at offset 2 with `copySelection` and `pasteNodes` as [markdown-editor-list-item-paste.test.ts:118](../packages/lib/tests/component/markdown-editor-list-item-paste.test.ts#L118) defines them. It asserts no throw and `expectSaveKeepsDocument`. It throws today.

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
| definition after an open comment ending a list item | `'- a\n\n  <!-- c\n- b [x] z\n\n  [x]: /u'` | `definitions` |
| definition two blank lines after an html block start | `'<div\n\n\n[x]: /u\n\nb [x] c'` | `definitions`, `edits` |
| first definition after an html block start ending a column | `'::: columns\n<div\n\|\|\|\n[x]: /u\n:::\n\n[x]: /v\n\nb [x] c'` | `definitions` |
| definition with a blank line in its title after an html block start ending a column | `'::: columns\n<div\n\|\|\|\n[x]: /u "t\n\nu8"\n:::\n\nb [x] c'` | `canonical`, `definitions`, `edits` |
| definition with a blank line in its title after an html block start ending a list item | `'- a\n\n  <div\n- b [x] z\n\n  [x]: /u "t\n\n  u8"'` | `canonical`, `definitions`, `edits` |

In both tables `\|` stands for `|`.

### Existing tests that change

| Test | Today | After |
|---|---|---|
| [markdown-editor-list-item-edits.test.ts](../packages/lib/tests/component/markdown-editor-list-item-edits.test.ts) rows Q11, Q12 and Q13 (lines 576 to 580) | in the table "keeps its list a raw block": the root's first block is `markdown-raw-block` and the shape holds no `list(` | moved to a new `it.each` in the same `describe`, titled "a quote whose last line is indented deeper than the quote is a raw block of its item". Each row asserts its shape, `getValue()` equal to the source, and `expectSaveKeepsDocument(editor, 'the load', false)` |
| [markdown-importer.test.ts:1926](../packages/lib/tests/component/markdown-importer.test.ts#L1926) "a loaded list before an indented raw list it would take in is kept apart by a separator that shows nothing" | `standard` is `'- *\n\n[//]: #\n\n  * 0\n    > 9\nd'` | `standard` is `'- *\n\n* 0\n    > 9\nd'`; rename the test "a loaded list before a raw list whose first line alone was indented is written with that line at the margin". Its second assertion stays. Row F11 keeps the separator covered |

The three shapes:

```
Q11  list(listitem("a", markdown-raw-block("> q", linebreak, "  </div")))
Q12  list(listitem("a", markdown-raw-block("> q", linebreak, " <div")), listitem("z"))
Q13  list(listitem("w0", markdown-raw-block("> q1", linebreak, "  <div", linebreak, "  ::: {align=center}", linebreak, "  f2", linebreak, "  :::")), listitem("w3", paragraph("  p")))
```

Replace the comment above Q11 ("Indented deeper than the item's content, the last line stays in the quote whatever follows. The raw block drops that indentation…") with: "Indented deeper than the quote, the last line stays in the quote whatever follows, and the raw block keeps that indentation."

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
| M4 | Source of row D1. Type `X` after `b`. Switch to source mode | the last line reads `bX [x] c` |
| M5 | Source `p`, an empty line, `  > q`, `  <div` (both indented two spaces), an empty line, `z`. Type `X` after `q`. Switch to source mode | one raw block; the source reads `> qX` and, under it, `<div` with two spaces before it |

---

## Verification

- From `packages/lib`: `npm run typecheck`, `npm run typecheck:test`, `npm run lint`.
- From `packages/lib`: the file list of step 13. Every row of [Expected Behaviour](#expected-behaviour) passes.
- From `packages/lib`: `npm run test` (the full suite), `npm run docs:api`, `npm run docs:llms:check`, `npm run build:lib`.
- The greps of steps 5, 9, 10 and 12.
- The manual checks M1 to M5.
- **The list-edit fuzz, outside the repo** (never commit it). A copy that also takes this plan's measurements is at `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans2/raw-block-edge-cases/zz-list-item-edit-fuzz.test.ts`, with `run.sh` beside it. Run `LIB=<worktree>/packages/lib ./run.sh fuzz <out-dir> 1500 601 1709 2207 3313 4409 5521 6607 7703 8819 9907 11003` and read the results with `showlif.py` from `scratch-keep/impl/list-item-block-paste/`. Before the change the 16,500 documents give 95 failing, in three classes. After it:

  | Class (`counts`) | Before | Must be |
  |---|---|---|
  | `load:canonical`, `load:canonicalReload` | 11 each | 0 |
  | `load:canonicalIdempotence` | 6 | 0 |
  | `spacesBeforeRaw:reload`, `:rawReading`, `:canonicalReload` | 2 each | 0 |
  | `pasteList:pasteFlattenedInItemBlock` | 82 | not this plan's (see *Non-Goals*); the count moves, because the documents drawn after the first changed load differ |
  | any other key | none | none. A new key is a defect this plan made or one newly reached: classify it before going on |

  | Measurement (`measures`) | Before | Must be |
  |---|---|---|
  | `defs:current:differs` | 844 | 0 |
  | `form:readsByPlace:notLast` | 6 | 0 |
  | `pair:new:joins:other` | 1 | 0 |

  The fuzz file's `holdsBlankEdgedRawOutsideItems` exemption can go: delete the `&& !holdsBlankEdgedRawOutsideItems(editor)` condition and expect the same zeros.
- **The regression fuzzes, outside the repo.** Run `scratch-keep/impl/list-item-block-paste/runfuzz.sh <worktree>/packages/lib <out-dir> table-edge table-edge-strict paste paste-strict` and compare with `cmpfuzz.py` against the baseline in `scratch-keep/impl/list-item-block-paste/fuzz/`. The baseline is 47 failing pastes in default mode, 47 in strict mode, and 0 table-edge failures in both modes. No count may rise and no record may be added.

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
- **Nothing here was run on a changed tree.** Treat a row that does not behave as its table says as a signal to stop and re-read the row and the snippet, not to change the expected value.
- **An existing expected string changes.** Allow it only for the four reasons listed under *Existing tests that change*.
- **The `edits` check of a new corpus case still fails after step 11.** Each sequence that fails today was traced to defect 1, 4 or 5 (see the addendum). A failure that remains is either one of those not fully fixed, or a defect this plan does not know. Find which before touching the case; do not give a new case a `known` entry for `edits`.
- **The rows of `markdown-editor-list-item-edits.test.ts` other than Q11 to Q13 must stay green**, the grid G and rows R1 to R5 included. They type spaces before the first line of a raw list. The new candidate differs from the two existing ones only when every line of the text is indented. If one of those rows fails, find which candidate `rawBlockAtMargin` returned for the row's text before changing anything.
- **The merged definitions map has no prototype.** Build it with `Object.create(null)` and test membership with `Object.hasOwn`, or the labels `constructor` and `__proto__` resolve to `Object.prototype` members. Row D9 and the corpus case "Object.prototype label defined" catch it.
- **`registerDefinitionRules` compares sources as strings.** Its first `lexed.source` must be `NO_DEFINITIONS_SOURCE`, not `""`: `definitionsOfSource` parses JSON.
- **The caret rows pin an element point.** `$selectTextOffset` always places it *before* a line break, which Lexical's selection normalisation leaves alone. If a P row does not throw and saves as its table says but its anchor differs, find what moved the caret before changing the row.
- **Do not add a re-read for a block list.** The table under *A block list keeps its blocks apart by how it writes them* is the whole mechanism there. A second mechanism beside `$showRawBlockAsItsBlocks` would let the two drift.
- **`serializeListApart` must not serialize every following block.** Keep the test to paragraphs and raw blocks, as the snippet does: a table after a list is otherwise written twice per save.

---

## Critical Files

- [markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts): `rawBlockStandsInItem` (L1676) and `itemProbes` (L1705), the precedent this plan generalises; `rawBlockInItem` (L1649), `$rawBlockSource` (L1628), `rawBlockAtMargin` (L1786), `blockShape` (L1816); `serializeRawBlock` (L1609), `rawBlockEnd` (L1938), `runsOn` (L1926); `serializeListApart` (L1486), `listsJoin` (L1521), `blocksJoin` (L1538); `writtenBlocks` (L1199), `labelClosedAfter` (L1243), `fenceClosedAfter` (L1260), `followsAtLoad` (L1313), `separatorBefore` (L1381); `$readDefinitions` (L677), `$collectDefinitions` (L716), `$lexDefinitions` (L738), `rawBlockTexts` (L750), `$definitionsSource` (L770).
- [markdownImporter.ts](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts): `$importMarkdown` (L225), `$readRawBlockAsBlocks` (L299), `$buildInlineContent` (L364), `$recordSourceMap` (L392), `$buildRawBlock` (L840), `$buildQuote` (L916), `$buildItemBlock` (L1120).
- [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts): `registerRawBlockRules` (L790), `$readListAgainAroundRawBlock` (L852), `$showRawBlockAsItsBlocks` (L882), `$selectTextOffset` (L929), `registerDefinitionRules` (L1070).
- [markdownExtensions.ts](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts): `lexMarkdown` (L643), `lexMarkdownLinkDefinitions` (L658), read only.
- [markdown-editor-list-item-edits.test.ts](../packages/lib/tests/component/markdown-editor-list-item-edits.test.ts): the helpers and the row style to copy; rows Q1 to Q13 (L563).
- [markdown-roundtrip/](../packages/lib/tests/component/markdown-roundtrip/): `harness.ts`, `corpus/types.ts`, `markdown-roundtrip.test.ts`, `markdown-edit-fuzz.test.ts` (`fuzzSequence` L325, `RAW_BLOCK_POSITIONS` L417).
- [plans/implemented/markdown-editor-list-item-block-paste.md](implemented/markdown-editor-list-item-block-paste.md): *Implementation Notes* → *Rule 1: a raw block in a list item*, *The list-edit fuzz*, and *Seen along the way, not changed*, which names five of these defects.
- [plans/implemented/markdown-raw-block-html-tail-parity.md](implemented/markdown-raw-block-html-tail-parity.md): *Seen along the way, not changed* (a tag name on a last line without `>` after a quote reads by position).
- [plans/markdown-editor-raw-block-range-edits.md](markdown-editor-raw-block-range-edits.md): the sibling plan that owns defect 7.

---

## Non-Goals

- **Defect 7 and the range routes.** `markdown-editor-raw-block-range-edits` owns them, its documented Shift+Enter limit included.
- **The lexer.** `> q` over an unindented `<div` still reads as one quote where its input ends and as a quote and an HTML block before a line end. That is `marked`'s blockquote rule, the twin of the tail-parity plan's Non-Goal *A tag name on the last line of a paragraph*. The editor holds such a raw block only while it is last.
- **Blocks pasted into a block that a list item holds** (the fuzz's 82 `pasteFlattenedInItemBlock` records). That is Lexical's own insert, listed for the user's decision in the plan this one depends on, and belongs with `markdown-editor-list-item-node`.
- **The text of a loaded raw list.** A raw list whose first line alone is indented still shows that indentation after a load (`$buildRawBlock(source, true)`); only its save changes.
- **A title's whitespace.** A definition whose title holds a blank line, in a tab-indented list item, is read by the viewer with other whitespace on the title's later lines than the raw block holds. The fuzz counts it apart (`titleWhitespaceOnly`); labels and URLs agree.
- **`$selectInRun`.** It walks an offset the way `$selectTextOffset` did. No route was found that leaves its offset on an empty line, so it is not changed without a failing row.
- **`MarkdownEditor.ts` and the paste handlers.** The paste into a raw `<pre>` block is correct; only the caret placed after the re-read was wrong.
- **Committing the fuzz harnesses.** They stay outside the repo.

---

## Addendum: Measurements

All at `f4bfedf2c`, with throwaway test files copied into `tests/component/` and deleted again. No source file was changed, so nothing below is the output of the fix. The scratch files are in `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans2/raw-block-edge-cases/`.

**The rows** (`zz-rows.test.ts`: this plan's L, F, E, W and D rows with the definitions check): 59 rows, 39 fail and 20 pass today. The failing rows are exactly the ones marked *red*. Every expected save of a red row was also loaded as a source of its own (`in4.json`, `in8.json`): each loads to the shape its row expects, holds every check, and saves unchanged.

**The margin rule** (`zz-form.test.ts`, the new body re-implemented in the test over `lexMarkdown`):

| Text | Today | New |
|---|---|---|
| `  > q⏎  <div` | `> q⏎<div` | `> q⏎  <div` |
| `   > q⏎   </div` | `> q⏎</div` | `> q⏎   </div` |
| `  > a⏎  > b⏎  <div` | `> a⏎> b⏎<div` | `> a⏎  > b⏎  <div` |
| `  > q⏎<div`, `  <div>⏎  x⏎  </div>`, `   <div`, `  ***`, `   [x]: /u "t⏎⏎   u"`, an indented table, five raw lists | — | unchanged from today |

**The fuzz** (`zz-list-item-edit-fuzz.test.ts` with measurements added, 11 seeds of 1,500 documents, 37,926 states after a load or an edit, 19,575 raw blocks outside list items):

| Measurement | Count |
|---|---|
| states where the editor's definitions differ from the viewer's reading of the save | 844 |
| the same with definitions read raw block by raw block (in the test) | 0 |
| … differing only in the `//` label of a `[//]: #` line the save wrote | 84 |
| … differing only in the whitespace of a title holding a blank line | 65 (58 with today's reading) |
| raw blocks outside list items whose new written form changes what they read as | 0 |
| raw blocks, not lists, whose new written form still starts with spaces | 0 |
| raw lists whose new written form keeps spaces before its first line | 10 |
| a raw block after a raw block that would join it, other than list to list: with today's text / with the new form | 3 / 1 |
| raw blocks, not last, whose text reads otherwise before a line end | 6 |

The one remaining join and the six blocks of the last row are defect 1's dedented quotes, which the margin rule no longer builds.

**The corpus** (395 cases, `zz-corpus-defs.test.ts`; and the edit fuzz, 3,160 runs, `zz-edit-fuzz-defs.test.ts`): the editor's definitions equal the viewer's for every case and every run today, so the new `definitions` check starts green. The new corpus cases were run through the seven checks today (`zz-new-corpus.test.ts`); the corpus table's "red today" column is that run, with the edit fuzz run over the same cases (`zz-new-corpus-fuzz.test.ts`). Seven cases fail the edit fuzz today. Each failing sequence was read: two are defect 1's standard form, two are defect 5's lost blank line, and three follow from defect 4 (a link written inline with a title it cannot hold, a definition edited away without the editor noticing, and a title edit the link does not take). The documents the two quote cases load as after the change were run through the edit fuzz too and pass.

**The caret** (`zz-pre-paste2.test.ts`, `zz-caret-type.test.ts`): rows P1 to P5 throw today. The new walk, re-implemented in the test, puts the caret at element offset 2 or 3 as the table says, and `Y` typed at that point gives row P6's save.

**The three list-item rows** (`in5.json`, `in6.json`): a source that already holds the quote with only its last line indented deeper (`- a⏎⏎  > q⏎    </div`, and the tab forms of Q11 and Q13) loads today as a list whose item holds the raw quote, and holds every check through edits. Those are the documents rows Q11 to Q13 load as after the change.

---

## Notes

[^one-rule]: The list-item rule was written after three reviews in a row had each found a new defect in piecemeal checks of a raw block in an item (see `plans/implemented/markdown-editor-list-item-block-paste.md`, *Rule 1*). Its statement is "the item form, written by the serializer, is read by `marked` as the same blocks the text reads as on its own, at every place a block of an item is written". This plan's rule is that sentence with "item" taken out. A parallel predicate for block lists with its own probes was considered and rejected: at a block list every way a neighbour can change a reading is already answered by how the save writes the blocks (see *A block list keeps its blocks apart by how it writes them*), so a second predicate would have had one caller, the margin rule, which needs a comparison between two texts and not a yes or no.

[^form-everywhere]: The docs page already says a raw block is saved, once edited, "without the up to three spaces of indentation before it, which mean nothing to Markdown". That was true only in a list item and at load. Writing the form everywhere makes it true, and it removes three known differences between a save and its reload that the list-edit fuzz had to exempt (a first or last line holding nothing, and spaces before the block). The other way to stop a list from taking in an indented block is a `[//]: #` line before it, which `serializeListApart` writes today for a list node. It was rejected as the general answer: it leaves a visible line in the source for spaces that mean nothing, and it does not exist for a raw list followed by a block that is no list. Measured: with the form, no raw block outside a list item, other than a raw list, starts with spaces (0 of 19,575), and no form changes what its text reads as.

[^margin]: `marked` decides whether a line without `>` continues a quote by a pattern that needs a character after a block tag name and allows no spaces before it. So `<div` as the last line of the input continues the quote, `<div` before a line end does not, and an indented `<div` always does. The source of defect 1 holds the indented form, which reads the same everywhere; the dedent turned it into the form that reads by its place, and `rawBlockAtMargin` did not notice because it compared the two texts alone. Comparing both readings rejects that dedent. Without a further candidate the block would keep the spaces before its *first* line too, and a raw list above it would take it in, which is defect 2 again; so the first line alone is tried at the margin last. Reading `text + "\n"` is the same probe `$readRawBlockAsBlocks` uses for an edited raw block, so the load and the edit ask one question. Lists are not given the new candidate when `isList` is `true`, which is how a load builds a raw list today.

[^eof-quote]: Making that text read one way everywhere means changing how the viewer reads `> q` over `<div` (and `a` over `<div`) at the end of an input. The tail-parity plan left exactly that as a Non-Goal and the user accepted it. It is not needed here: a raw block of such text exists only as the last block of its input, it is saved there as it was read, and Lexical marks a block dirty when a sibling is added after it, so the raw-block transform reads it again before a line end (row L14).

[^no-new-reread]: In a list item a raw block that does not read back cannot be fixed by writing it differently: spaces before it shift the whole item, and a line that reads by what follows the item has nothing to stand apart from. So the list is read again. At a block list the blocks are always one blank line apart, and each of the ways a neighbour reaches across a blank line has a way of writing that stops it. `serializeListApart`, `listsJoin` and `LIST_SEPARATOR` are the precedent: two lists that would join are written apart, not merged in the editor. A pair re-read ("show a raw block and the block before it as their save reads") was considered and rejected for that reason, and because it would merge blocks the user sees as two when an invisible space is typed.

[^wide-check]: `writtenBlocks` has four piecemeal checks of this kind already: `endsOpen` for the last block at load, `joinsPreviousBlock`, `labelClosedAfter` and `fenceClosedAfter`. Each asks whether a block's source still reads as loaded next to what is now written around it. The missing case is a raw block that only a second blank line ends and that was not the last block at load. `takesInBlockAfter` is limited to raw blocks, so a save lexes nothing more for any other block, and to a block whose successor did not follow it at load, because the source's own text between the two is kept otherwise. One general check (lex every source block with its neighbours) was rejected for its cost: `readsOtherwiseAfter` builds the text of every later block, which is quadratic over a document.

[^per-block]: Only a raw block can hold a definition: the serializer escapes the `[` of any other text. The serializer therefore lexed the raw blocks' text joined by blank lines, on the ground that "a raw block lexes alone as it does in the document". The join is where that fails: `<div` followed by a blank line and a definition is one HTML block. In the document the `<div` ended with its column or list item, or was followed by two blank lines. Reading each raw block's written form alone is exact as long as every raw block stands where it is written, which is this plan's rule. Measured on 37,926 fuzzed states: the joined reading differs from the viewer's in 844, the per-block reading in none, beyond two classes the addendum names (the save's own `[//]: #` line, and the whitespace of a title holding a blank line). The other exact reading, lexing the whole saved document, was rejected: it costs a full save for every read, and the definitions are read inside node transforms on every keystroke. The cache keeps the per-block reading cheaper than today's in the common case, since text without a `[` is not lexed at all.

[^json-source]: `registerDefinitionRules` keeps the definitions source of each committed state and lexes it only when it changed. Joined with a blank line, the two raw blocks `<!-- c` and `[x]: /u` have the same source as one raw block holding both lines, but not the same definitions. JSON of the list of texts cannot collide. A separator character was considered and rejected: nothing guarantees a pasted text does not hold it.

[^null-proto]: `marked` builds its link map with `Object.create(null)`, and the corpus has cases for the labels `constructor` and `__proto__`. A first version of the measurement in this plan merged into `{}` with `??=` and lost `[constructor]: …`, because `{}.constructor` is already defined.

[^caret-walk]: After an edit makes a raw block read as several blocks, `$showRawBlockAsItsBlocks` puts the caret back at the same offset of the text. `$selectTextOffset` found the place by subtracting each text node's and each line break's size and selecting in the first text node with `remaining <= size`. Two line breaks in a row take `remaining` from 1 to -1, and `-1 <= size` holds. `<pre>`, comments and definitions with a blank line in their title are the raw blocks that hold empty lines, and a paste ending in a line end is what leaves the caret on one. The selection was set with a negative offset, and the next read of the selection threw. An element point before the line break is how Lexical itself addresses an empty line of a block.

[^definitions-check]: Without it defect 4 is invisible to the harness unless a title holds a blank line: an inline link and a reference link render the same, so `canonical` holds. The check compares what the editor believes with what the saved file says, which is the contract. It is green for all 395 corpus cases and 3,160 edit-fuzz runs today, so it adds no known divergence. The `//` label is left out when only the save's own separator line defines it, because that line is no part of the editor's document.

[^item-flip]: Rows Q11 to Q13 were written when the raw block's dedented text was the only form on offer; their comment says "it is its text, not the source, that must read the same". With the first-line-only candidate the text is `> q` over an indented `<div`, which reads as one quote at all five places of an item. The rule then finds a smaller piece that reads back (the quote) than the one those rows pin (the list). Each of the three documents was checked by loading a source that already holds that text: it loads as a list, holds every check through edits, and saves unchanged. Limiting the candidate to block lists would keep the three rows as they are, at the price of two margin rules, one per place, which the one rule exists to avoid.

[^order]: Three reasons to go first. The sibling plan calls the raw-block re-read from inside its range removal, which reaches `$selectTextOffset`; after this plan that call cannot leave a negative offset. Its matrix compares each route with a control computed at run time, and its pinned strings hold no raw block with spaces before it or an empty edge line, so the written form does not move its expected values. And its snippet for `registerRawBlockRules` predates the four-step `$showRawBlockAsSaved` either way, so nothing is gained by letting it land first. If it does land first, this plan is unchanged: no step here edits `registerRawBlockRules`.
