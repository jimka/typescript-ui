---
depends-on:
  - markdown-editor-reload-differences
  - markdown-source-mode-commands-through-model
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/markdownSourceMap.ts
  - packages/lib/src/typescript/lib/component/editor/markdownImporter.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/tests/component/markdown-editor-command-crashes.test.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-importer.test.ts
  - packages/lib/tests/component/markdown-source-mode-through-model.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Nested Source Preservation — Implementation Plan

## Overview

A save of `MarkdownEditor` writes every unedited *top-level block* — a direct child of the document: a paragraph, a whole list, a whole table, a whole `:::` fence — as its source, byte for byte. It knows a block is unedited by its *fingerprint*: the block's *standard form* (how the serializer writes a block anew: `-` bullets, two-space nesting, one space of cell padding, a backtick fence), taken at load and compared with the block's standard form at the save ([markdownSerializer.ts:1749](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1749) `unchangedBlock`). An edit inside a block rewrites the whole block in the standard form: one word typed into one item of a list nested four spaces deep re-indents every item, and one edited table cell re-pads every row.

This plan takes the same mechanism one level down. The importer records the source of each *nested part* of a block, and the fingerprint pass that already runs at load records each part's standard form. A save that rewrites a block writes every part whose standard form still equals its fingerprint as its source, and the rest in the standard form. The nested parts are:

| Part | Recorded in |
|---|---|
| a list item, at any depth | `$buildListItem` |
| a table row — the header row and each body row — and, inside an edited row, each cell | `$buildTable` |
| a table's delimiter row | `$buildTable` |
| the frame of a fenced code block: its opening and closing fence lines | `$buildCode` |
| a block inside a `:::` column, which is written as a document is | `$buildFence` |

A quote has no nested part: a `QuoteNode` holds one paragraph's inline content, and a quote holding more is a raw block ([markdownImporter.ts:926](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L926) `$buildQuote`). The change is in `markdownSourceMap.ts`, `markdownImporter.ts`, `markdownSerializer.ts` and one method and one field of `MarkdownEditor.ts`, plus a committed nested-edit fuzz. No public API changes.

Source-mode commands get the same reduction without code of their own: after `markdown-source-mode-commands-through-model`, a source-mode command runs the WYSIWYG command on an import of the text near the selection and saves through the same serializer. Measured, this plan brings the lines a WYSIWYG edit rewrites outside the edited line on real documents from 109 to 21 (−81 %), and the share of source-mode commands that touch more lines than today's text surgery from 36.5 % to 33.7 % — on hand-written documents from 45.6 % to 35.7 %, the most extra lines from 13 to 5 (*Addendum: Measurements*).

*Base*: commit `7cdd0d1f0`, the tip of the Markdown chain (`feature/markdown-editor-reload-differences`). Every line number is from that commit. `markdown-source-mode-commands-through-model` lands first and moves some of them; find each site by its symbol name. Every number was measured on a private copy of the base holding that plan's prototype and this plan's prototype.

---

## Architecture Decisions

### The fingerprint at each level

A nested part has a fingerprint taken as a top-level block's is: its standard form at load, written by the serializer code the save runs, inside the load's one fingerprint pass ([markdownImporter.ts:402](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L402) `$recordSourceMap`). A part is unedited while its standard form at the save equals its fingerprint, the test `unchangedBlock` makes for a top-level block.[^fingerprint-rule]

| Part | Its source | Its fingerprint |
|---|---|---|
| list item | the item's lines as its list holds them, the spaces before its marker kept, without the whitespace after the item | the item's standard lines written under the list's *fingerprint marker*: its own bullet (`-`, `*`, `+`), or `1.` / `1)` for an ordered list, so the item's number never counts |
| table row | the row's line | the row's standard line, and each column's standard cell text |
| delimiter row | its line | the standard delimiter row |
| code frame | the opening and the closing fence line | the info string the standard form writes |
| block of a `:::` column | as a top-level block's: its source, and the text after it up to the next block | its standard form |

The number is left out because an ordered list's items are written with numbers counted from its start: inserting or deleting one item renumbers every later item, and a fingerprint holding the number would call every one of them edited.[^number-blind]

### The parts live in the source map, keyed by node

`MarkdownSourceMap` gains `parts: ReadonlyMap<NodeKey, MarkdownSourcePart>`, the nested parts of the import. `MarkdownEditor` merges each import's parts into one map that is never pruned, as `adoptSourceMap` ([MarkdownEditor.ts:10493](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L10493)) already does for the top-level blocks. Undo brings an earlier import's nodes back with their keys, so their parts are found again.[^map-not-state]

### The import records parts while it loads, and fingerprints them in the pass it already runs

The block builders register each part's source in a new import context, `IMPORT_PARTS.current`, which `$importMarkdown` sets for exactly as long as `LOADING_DOCUMENT.current` is `true`. `$recordSourceMap` runs `$serializeTopLevelBlocks` once, as today, inside a new save context, `SAVE_PARTS.current`, in *record* mode: the serializer stores each part's standard form while it writes, and its output is unchanged. `$recordSourceMap` then builds the final parts.[^context-precedent]

A part is recorded only when its source is known exactly and writing it elsewhere cannot change how it reads:

| Part | Recorded only when |
|---|---|
| list item | it starts with a list marker after at most three spaces, and it holds no *lazy continuation line*: a line after the first, not blank, indented less than the item's content column |
| table row, delimiter row | the table's source has one line per row: header, delimiter, each body row |
| code frame | the code is fenced, its opening line starts at its container's margin, and its last line is a fence that closes it |
| block of a `:::` column | the fence's source holds no `\|||` line, so each column's text is a slice of the source |
| any | the top-level block holding it has no tab in its source, and its node is still in the document when the load ends (the items of a list that could not be built, and became a raw block, are dropped) |

The *content column* of a list item is the column its text starts at: the spaces before the marker, the marker, and the one to four spaces after it — one when there are more, or when nothing follows the marker.[^recorded-when]

### A save writes parts only inside a block it rewrites

`$serializeTopLevelBlocks` takes the source map as an optional second parameter. A root child that can hold parts — a list, a table, a code block or a `:::` fence — is serialized a second time, in *write* mode, when its standard form differs from its top-level fingerprint and one of its parts has a source that differs from its standard form at load, or when it has no top-level entry. The block's `written` text is returned beside `text`, and `writtenBlocks` writes it for a block it does not write as its source. A block written as its source, a block every part of which is already in the standard form, and every paragraph, heading, quote and raw block are serialized once, as today.[^two-passes]

In write mode each container decides part by part:

- **`serializeList`** writes an item as its source when the item keeps its source (next decision), else in the standard form with its own children written in write mode, so a kept item can stand inside a rewritten one at any depth.
- **`serializeTable`** writes a row as its line while the row's standard line equals its fingerprint. Any other row is written cell by cell: a cell whose standard text equals its fingerprint at the same column is written as the text between its pipes in the source, spaces included; any other cell as its standard text with one space each side.
- **`serializeCode`** writes the kept opening line, the code and the kept closing line while the info string's fingerprint holds and no line of the code would close the kept fence.
- **`serializeFence`** writes each column as a save writes a document: the same `blockListParts`, `writtenBlocks` and `assembleDocument`, over the column's blocks, with the column's own text before, between and after them.

### When a kept part is rewritten after all

A part whose fingerprint holds is still written in the standard form, or moved, when a change around it alters how its source would read. These are the seams between a kept part and a rewritten neighbour:

| Seam | Rule | Document, edit | Save |
|---|---|---|---|
| marker | an item keeps its source only while its marker is the bullet or delimiter its list is written with | `- a` / `  - x` / `  -` / `    ---`, `x` deleted: the save writes the nested list with `*`, since a bare `-` under text is a setext underline | `- a` / `  * ---` |
| number | a kept ordered item is written with its standard number in place of its own; when the two have a different count of digits, the item is written in the standard form | `3. a` / `4. b` / `5. c`, `x` inserted after `a` | `3. a` / `4. x` / `5. b` / `6. c` |
| indentation | a kept item keeps the spaces before its marker only when they are fewer than the content column of the item written before it, and never as the first item of a list that does not stand under text; otherwise it is written at its list's margin, every line moved left by those spaces | `-   a` / `   - b`, `x` inserted after `a` | `-   a` / `- x` / `- b` |
| looseness | in a tight list an item keeps its source only when no blank line stands between two of its own blocks; in a loose list of one item, only when one does | `- a` / `  - b` / `    > q` / (blank) / `- c`, `c` deleted | `- a` / (blank) / `  - b` / `    > q` |
| blank lines | between items, the standard separator — a blank line in a loose list, none in a tight one; inside a kept item, its own lines | `* a` / (blank) / `* b` / `* c`, `c` edited | `* a` / (blank) / `* b` / (blank) / `* c!` |
| table column widths | kept rows and kept cells keep their padding; no other row is re-padded; an edited cell has one space each side, none on a side where its row has no outer pipe | `\| a   \| bb \|` / `\|-----\|----\|` / `\| 1   \| 2  \|` / `\| 3   \| 4  \|`, `3` edited | `\| a   \| bb \|` / `\|-----\|----\|` / `\| 1   \| 2  \|` / `\| 3! \| 4  \|` |
| definitions | a part whose source holds a `[` keeps its source only while the document's link reference definitions are those at its load | `- [y] a` / `- b` / (blank) / `[z]: /u`, the definition made `[y]` and `b` edited | `- \[y\] a` / `- b!` / (blank) / `[y]: /u` |
| column | a part keeps its source only in the `:::` column it was loaded in, or, loaded outside any column, only outside any; a fence with no column counts as a column of its own | a list item holding a `:::` line, the list wrapped in a fence | the item in the standard form, its line written `\:::` |
| code fence | a frame is kept only while no line of the code starts with a run of the fence's character at least as long as the fence | `~~~` / `a` / `~~~`, a line `~~~~` typed into it | a backtick fence |

An edited item keeps its own frame when it can. When its first block is its text and its marker is its list's, it keeps the one to four spaces after its marker, and the spaces before it by the indentation rule; its children are indented to that content column. An edited item of a hand-written list then does not move the kept items nested in it.[^seams]

| Document | Edit | Today | After |
|---|---|---|---|
| `* one` / `    * inner` / `* two` | `!` appended to `two` | `* one` / `  * inner` / `* two!` | `* one` / `    * inner` / `* two!` |
| `* one` / `    * inner` / `    * more` / `* two` | `!` appended to `inner` | `* one` / `  * inner!` / `  * more` / `* two` | `* one` / `    * inner!` / `    * more` / `* two` |
| `1.  one` / `    more` / (blank) / `    - x` / `2.  two` | `!` appended to `one` | `1. one!` / `   more` / `   - x` / (blank) / `2. two` | `1.  one!` / `    more` / `    - x` / (blank) / `2.  two` |
| `~~~~ js` / `let a;` / `~~~~` | `!` appended to the code | ```` ```js ```` / `let a;!` / ```` ``` ```` | `~~~~ js` / `let a;!` / `~~~~` |
| `::: columns` / `_a_` / (blank) / `b` / `\|\|\|` / `c` / `:::` | `!` appended to `b` | `::: columns` / `*a*` / (blank) / `b!` / `\|\|\|` / `c` / `:::` | `::: columns` / `_a_` / (blank) / `b!` / `\|\|\|` / `c` / `:::` |

### A column is written as a document is

A block of a `:::` column has a `MarkdownSourceBlock` of its own, with a `MarkdownSourceLoad` for its column: the column's text before its first block, its block count, whether its last block runs to the column's end, and the document's definitions at load. In write mode, `serializeFence` hands each column's blocks to `blockListParts`, `writtenBlocks` and `assembleDocument`, so every top-level seam rule — a label or title something later closes, a `:::` fence something later closes, an indented block after a list, a raw block only a second blank line ends, a block that ran to its end — holds inside a column too. The column's text before its first block and after its last is kept while those blocks are kept, as a document's is.[^column-as-document]

### The costs stay linear

A save serializes a block it writes part by part about twice: once in the standard form to compare with its fingerprint, as today, and once in write mode, which writes each item once more in the standard form to compare with the item's own fingerprint. The load adds one `listItemLines` call per item to its existing pass. A save calls `lexMarkdown` exactly as often as today: write mode reads nothing back.[^costs]

Measured medians, milliseconds, with the machine shared (*Addendum: Measurements*):

| Document, 2,000 items or rows | Load, today → after | A typed letter and its save, today → after |
|---|---|---|
| `* entry` list | 142 → 133 | 37 → 36 |
| list nested four spaces deep (1,000 items under 1,000) | 142 → 147 | 47 → 74 |
| table padded to its columns | 190 → 189 | 68 → 112 |
| 2,000 mixed blocks of hand-written lists, tilde fences and padded tables | 198 → 209 | 77 → 80 |

The paths of `markdown-editor-large-document-costs` keep their bounds:

| Path | With parts |
|---|---|
| reading the document's definitions for a block | the definitions rule reads `SAVE_DEFINITIONS.current.key`, computed once per save; no new walk |
| the raw blocks a changed block checks | untouched: a save runs no editor rule |
| moving items when an edit splits or joins lists | untouched; a list a split or a join makes is a node with no top-level entry, written in write mode, so it keeps its items' sources |
| lexing a kept `:::` block with what is written after it | runs also over the kept blocks of an edited fence's columns, against that column's text only; `closesOwnFence` still answers first |

The parts hold about 2.4 times the source's characters for a flat list and 3.9 times for a list nested three deep, beside the twice the source the top-level map holds already.

### This plan comes after `markdown-source-mode-commands-through-model`

The through-model plan names this plan as the one after it (its *Non-Goals*), and its rows, docs and measured price are written against today's whole-block rewrite. Landing this plan first would make that plan's pinned row 5.15, its documented example and its price stale before it starts. Landing it after, this plan restates one row of that plan's test file and two of its doc sentences, and its own fuzz covers both surfaces, since both save through the same serializer.[^order]

---

## Public API

No public signature changes: nothing below is re-exported from `component/editor/index.ts`. Internal types, in `markdownSourceMap.ts`:

```typescript
/** A list item of a loaded document, as its list held it. */
export interface MarkdownSourceItem {
    readonly kind:            "item";
    /** The import that loaded it. */
    readonly load:            MarkdownSourceLoad;
    /** The `:::` column it stood in at load; `null` for none. */
    readonly column:          NodeKey | null;
    /** Its lines without the whitespace after them, the spaces before its marker kept. */
    readonly source:          string;
    /** The spaces before its marker on its first line, 0 to 3. */
    readonly indent:          number;
    /** Its bullet (`-`, `*`, `+`) or ordered delimiter (`.`, `)`). */
    readonly marker:          string;
    /** Its number as written, for an ordered item; else `null`. */
    readonly number:          number | null;
    /** The spaces between its marker and its text on its first line. */
    readonly spacing:         string;
    /** Whether a blank line stands between two of its own blocks. */
    readonly separatesBlocks: boolean;
    /** Its standard lines at load under its list's fingerprint marker. */
    readonly fingerprint:     string;
}

/** A header or body row of a loaded table. */
export interface MarkdownSourceRow {
    readonly kind:             "row";
    readonly load:             MarkdownSourceLoad;
    readonly column:           NodeKey | null;
    /** The row's line. */
    readonly line:             string;
    /** Each cell's text between its pipes, as written, spaces kept. */
    readonly cells:            readonly string[];
    /** Whether the line has a pipe at each end. */
    readonly outerPipes:       boolean;
    /** The row's standard line at load. */
    readonly fingerprint:      string;
    /** Each column's standard cell text at load. */
    readonly cellFingerprints: readonly string[];
}

/** A loaded table's delimiter row, keyed by the table. */
export interface MarkdownSourceDelimiterRow {
    readonly kind:        "delimiterRow";
    readonly column:      NodeKey | null;
    readonly line:        string;
    readonly fingerprint: string;
}

/** A loaded fenced code block's fence lines. */
export interface MarkdownSourceCodeFrame {
    readonly kind:           "codeFrame";
    readonly column:         NodeKey | null;
    readonly opening:        string;
    readonly closing:        string;
    readonly fenceCharacter: "`" | "~";
    readonly fenceLength:    number;
    /** The info string the standard form wrote at load. */
    readonly fingerprint:    string;
}

/** A block of a loaded `:::` column. */
export interface MarkdownSourceColumnBlock {
    readonly kind:   "columnBlock";
    /** The column it stood in. */
    readonly column: NodeKey;
    /** Its source, as a top-level block's; its `load` is its column's. */
    readonly block:  MarkdownSourceBlock;
}

/** A nested part of a loaded document. */
export type MarkdownSourcePart =
    | MarkdownSourceItem | MarkdownSourceRow | MarkdownSourceDelimiterRow | MarkdownSourceCodeFrame | MarkdownSourceColumnBlock;

export interface MarkdownSourceBlock {
    // …the five fields of today, and:
    /** Whether a nested part of the block has a source other than its standard form at load: only then does an edit of the block write it part by part. */
    readonly partsDiffer: boolean;
}

export interface MarkdownSourceMap {
    readonly latest: MarkdownSourceLoad;
    readonly blocks: ReadonlyMap<NodeKey, MarkdownSourceBlock>;
    /** The nested parts of the loaded blocks, keyed by the node each was loaded as: a list item, a table row, a table (its delimiter row), a code block, a block of a column. */
    readonly parts:  ReadonlyMap<NodeKey, MarkdownSourcePart>;
}
```

`EMPTY_SOURCE_MAP` gains `parts: new Map()`. In `markdownSerializer.ts`:

```typescript
// Second parameter added; without it no part is written (every caller today).
export function $serializeTopLevelBlocks(documentDefinitions: DocumentDefinitions, sourceMap?: MarkdownSourceMap): StandardBlock[];

export interface StandardBlock {
    readonly node:     LexicalNode;
    readonly text:     string;
    /** For a list, table, code block or fence a save writes part by part: its text, its unedited parts as their source. */
    readonly written?: string;
}

// New, for the importer: `$serializeTopLevelBlocks(definitions)` under the record context.
export function $recordPartFingerprints(definitions: DocumentDefinitions, record: RecordedFingerprints): StandardBlock[];
```

---

## Internal Structure

### The two contexts

In `markdownSerializer.ts`, beside `SAVE_DEFINITIONS` ([:403](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L403)):

```typescript
/** What the load's fingerprint pass stores, keyed by node. */
export interface RecordedFingerprints {
    /** An item's fingerprint, a row's standard line, a delimiter row's (keyed by its table), a code frame's info string. */
    readonly partFingerprints:  Map<NodeKey, string>;
    /** Every block's standard form, as a block list writes it: a column block's fingerprint. */
    readonly blockFingerprints: Map<NodeKey, string>;
    /** A row's standard cell texts. */
    readonly cellFingerprints:  Map<NodeKey, readonly string[]>;
    /** An item's standard lines under the marker it is written with, to tell whether its source differs. */
    readonly standardItems:     Map<NodeKey, string>;
}

/** How the serializer treats nested parts while it writes. */
type PartsContext =
    | ({ readonly mode: "record" } & RecordedFingerprints)
    | { readonly mode: "write"; readonly parts: ReadonlyMap<NodeKey, MarkdownSourcePart>; readonly column: NodeKey | null };

/** A write context. */
type WriteContext = Extract<PartsContext, { mode: "write" }>;

/** The running pass's parts context; `null` writes the standard form. */
const SAVE_PARTS: { current: PartsContext | null } = { current: null };

/** Runs `write` under another parts context, restoring the one before it (also on a throw). */
function withPartsContext<T>(context: PartsContext | null, write: () => T): T;
```

In `markdownImporter.ts`, beside `IMPORT_DEFINITIONS` ([:127](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L127)) and `LOADING_DOCUMENT` ([:135](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L135)):

```typescript
/** What a column's load knows before the document's definitions are read; one object per column, shared by its blocks. */
interface ColumnLoad { readonly prefix: string; readonly endsWithNewline: boolean; readonly blockCount: number; readonly endsOpen: boolean }

/** A part's source as a builder records it; `$recordSourceMap` adds its load, column and fingerprint. */
type RecordedPart =
    | Omit<MarkdownSourceItem, "load" | "column" | "fingerprint">
    | Omit<MarkdownSourceRow, "load" | "column" | "fingerprint" | "cellFingerprints">
    | Omit<MarkdownSourceDelimiterRow, "column" | "fingerprint">
    | Omit<MarkdownSourceCodeFrame, "column" | "fingerprint">
    | { readonly kind: "columnBlock"; readonly columnLoad: ColumnLoad; readonly index: number; readonly body: string; readonly after: string };

/** The parts the running load records, keyed by node; `null` outside a load. */
const IMPORT_PARTS: { current: Map<NodeKey, RecordedPart> | null } = { current: null };
```

### `blockListParts` — one loop for the root and for a column

`$serializeTopLevelBlocks` ([:795](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L795)) and `serializeBlockList` ([:1879](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1879)) loop over blocks the same way. That loop moves into one function:

```typescript
function blockListParts(nodes: LexicalNode[], definitions: Links | null, sourceMap: MarkdownSourceMap, column: NodeKey | null): StandardBlock[] {
    const context = SAVE_PARTS.current;
    const writesParts = sourceMap.parts.size > 0 && context?.mode !== "record";
    let previousJoinable: string | undefined;

    return nodes.map((node, index) => {
        const write = (): string => ($isListNode(node)
            ? serializeListApart(node, previousJoinable, nodes.slice(index + 1), definitions)
            : serializeBlock(node, definitions));
        // Under a write pass (the column of a fence written part by part) the standard form is written with no context.
        const text = context?.mode === "write" ? withPartsContext(null, write) : write();
        const entry = sourceMap.blocks.get(node.getKey());
        const partByPart = writesParts && $holdsParts(node) && (entry === undefined || (entry.fingerprint !== text && entry.partsDiffer));
        const written = partByPart ? withPartsContext({ mode: "write", parts: sourceMap.parts, column }, write) : text;

        if (context?.mode === "record") {
            context.blockFingerprints.set(node.getKey(), text);
        }

        if (text !== "") {
            previousJoinable = $isMarkdownRawBlockNode(node) || $isListNode(node) ? text : undefined;
        }

        return written === text ? { node, text } : { node, text, written };
    });
}
```

`$holdsParts(node)` is `$isListNode(node) || $isTableNode(node) || $isCodeNode(node) || $isMarkdownBlockNode(node)`. The record branch stores every block's standard form in `blockFingerprints`, which is how a column block gets its fingerprint; the root's blocks are stored there too and never read. It is a map of its own because a table and a code block are keys of `partFingerprints` as well, for their delimiter row and frame. `$serializeTopLevelBlocks(definitions, sourceMap = EMPTY_SOURCE_MAP)` returns `blockListParts($getRoot().getChildren(), definitions.forBlocks, sourceMap, null)` inside its `SAVE_DEFINITIONS` block. `serializeBlockList(nodes, definitions)` keeps its join — blocks that write nothing dropped, `LIST_SEPARATOR` between two raw blocks whose lists join — over `blockListParts(nodes, definitions, EMPTY_SOURCE_MAP, null)`.

In `writtenBlocks` ([:1562](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1562)), a block not written as its source takes `text: written ?? text` (each candidate keeps `written` from the spread part); `standard` stays the part's `text`.

### Lists

```typescript
/** The marker an item's fingerprint is written under: the list's bullet, or `1` and its delimiter. */
function fingerprintMarker(list: ListNode): string {
    return list.getListType() === "number" ? `1${$writtenListMarker(list)}` : $writtenListMarker(list);
}

/** An item's fingerprint: its standard lines under the fingerprint marker. */
function itemFingerprint(list: ListNode, blocks: readonly ItemBlock[], nestedSeparated: boolean): string {
    return listItemLines(fingerprintMarker(list), blocks, nestedSeparated).join("\n");
}
```

`listItemLines` ([:2934](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2934)) gains a last parameter, `spacing: string = " "`: `indent` becomes `" ".repeat(marker.length + spacing.length)`, the first line `${marker}${spacing}${lines[0]!.slice(indent.length)}`, and its recursive call passes `spacing` on.

`serializeList` ([:2745](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2745)) starts with `if (SAVE_PARTS.current?.mode === "write") { return writeListWithParts(list, definitions, underText, marker, SAVE_PARTS.current); }`. In record mode, and only when `marker === undefined` (the list's own marker, not a candidate `serializeListApart` tries), it stores for each item node `itemFingerprint(list, items[index], nestedSeparated)` in `partFingerprints` and `listItemLines(markerOf(index), items[index], nestedSeparated).join("\n")` in `standardItems`; the rest is unchanged.

`writeListWithParts` in steps:

1. `nodes` = the list's item nodes; `standard = withPartsContext(null, () => nodes.map((item) => serializeItemBlocks(item, definitions)))`.
2. `loose`, `nestedSeparated`, `opensWithBreak` and `markerOf` as `serializeList` computes them, from `standard`.
3. For each item at `index`, with `marker = markerOf(index)` and `written` the item texts so far:
   - `bullet` = the bullet or delimiter `marker` is written with (`WRITTEN_LIST_MARKER`); `number` = its digits, or `undefined`.
   - `mayIndent = index > 0 || underText`; `room = index === 0 ? Infinity : contentColumn(written[index - 1].split("\n")[0])`.
   - `part` = the item's part, when it is an item part whose `column` is the context's.
   - **Kept** when all of: `part.fingerprint === itemFingerprint(list, standard[index], nestedSeparated)`; `part.marker === bullet`; `part.number === null` or `String(part.number).length === number.length`; `loose ? nodes.length > 1 || part.separatesBlocks : !part.separatesBlocks`; `!part.source.includes("[")` or `part.load.definitionsKey === SAVE_DEFINITIONS.current!.key`. It writes `part.source` when `mayIndent && part.indent < room`, else `atMargin(part)`; for an ordered item whose number differs, the digits on its first line are replaced by `number`.
   - **Otherwise** `blocks = serializeItemBlocks(item, definitions)` (write mode, so kept items nested in it stay kept). `spacing = part.spacing` when `part` exists, `part.marker === bullet`, `blocks[0]?.isText === true` and `part.spacing` is one to four spaces; else `" "`. `lines = listItemLines(marker, blocks, nestedSeparated, spacing)`; when `part` exists, `part.marker === bullet`, `mayIndent` and `0 < part.indent < room`, every non-empty line gets `part.indent` spaces in front.
4. Join with `LOOSE_ITEM_SEPARATOR` when `loose`, else `"\n"`.

The helpers:

| Helper | Returns | Examples |
|---|---|---|
| `contentColumn(line)` | the spaces before the marker, the marker, and the spaces after it when one to four and text follows, else one | `* one` → 2; `   * inner` → 5; `1.  one` → 4; `-` → 2; `-      x` → 2 |
| `atMargin(part)` | `part.source` with up to `part.indent` spaces taken off every line | ` - b` / `   c` → `- b` / `  c` |
| `itemPartOf(item)` (importer) | the recorded item, or `null` per *The import records parts* | `- a` / `b` (a lazy line) → `null` |

`itemPartOf` reads `item.raw` without its trailing whitespace; the marker, number and spacing from `/^( {0,3})(?:([-*+])|(\d{1,9})([.)]))( *)/`; and `separatesBlocks` from `item.tokens` as `marked` reads looseness: a `space` token holding two line ends, followed later by a token that is not `space`.

### Tables

`serializeTable` ([:3049](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L3049)) builds each row's line through `writtenRow(row, texts)` and its delimiter row through `writtenDelimiterRow(table, standard)`, which stores the standard delimiter row in `partFingerprints` under the table's key in record mode, and returns `part.line` in write mode while `part.fingerprint === standard` and the part's column is the context's.

```typescript
function writtenRow(row: TableRowNode, texts: string[]): string {
    const standard = formatPipeRow(texts);
    const context = SAVE_PARTS.current;

    if (context?.mode === "record") {
        context.partFingerprints.set(row.getKey(), standard);
        context.cellFingerprints.set(row.getKey(), texts);

        return standard;
    }

    // The row's part, when it is a row part whose column is the context's and whose definitions fit:
    // `!part.line.includes("[") || part.load.definitionsKey === SAVE_DEFINITIONS.current!.key`.
    const part = context?.mode === "write" ? rowPartOf(row, context) : undefined;

    if (part === undefined) {
        return standard;
    }

    if (part.fingerprint === standard) {
        return part.line;
    }

    // A row without outer pipes keeps that frame only while its first and last cells hold text.
    const bare = !part.outerPipes && texts[0] !== "" && texts[texts.length - 1] !== "";
    const cells = texts.map((text, column) => {
        if (part.cellFingerprints[column] === text && part.cells[column] !== undefined) {
            return part.cells[column]!;
        }

        return `${bare && column === 0 ? "" : " "}${text}${bare && column === texts.length - 1 ? "" : " "}`;
    });

    return bare ? cells.join("|") : `|${cells.join("|")}|`;
}
```

The importer's `rowCells(line)` splits a row's line as the tokenizer's `splitRow` ([markdownTableExtension.ts:61](../packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L61)) does, but keeps each cell's text as written: one leading and one trailing pipe dropped, a split at each unescaped `|`, the `\|` and the spaces kept. `outerPipes` is whether the line, untrimmed, starts and ends with a pipe.

| Line | `cells` | `outerPipes` |
|---|---|---|
| `\| a   \| bb \|` | `[" a   ", " bb "]` | `true` |
| `a \| b` | `["a ", " b"]` | `false` |
| `\| x \| y \| z \|` with the second pipe escaped (`x \| y` one cell) | `[" x \| y ", " z "]` | `true` |

### Code frames and columns

`serializeCode` ([:2696](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2696)) computes `info`, `char` and `fence` as today. In record mode it stores `info` in `partFingerprints`. In write mode it returns `part.opening + "\n" + (code === "" ? "" : code + "\n") + part.closing` when the code-frame part, in the context's column, has `fingerprint === info` and no line of `code` has a `CODE_LINE_FENCE_RUN` ([:265](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L265)) run of `part.fenceCharacter` at least `part.fenceLength` long — the same reading the standard form uses to choose its fence length.

`serializeFence` ([:3231](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L3231)) in write mode writes a fence with no column with its children under `{ ...context, column: fence.getKey() }`, and each column of any other fence through `writtenColumn`:

```typescript
function writtenColumn(column: MarkdownColumnNode, definitions: Links | null, context: WriteContext): string {
    const own: WriteContext = { ...context, column: column.getKey() };

    return withPartsContext(own, () => {
        const children = column.getChildren();
        // child key → part.block, for each column-block part whose column is this one
        const blocks = columnBlocksOf(children, own);

        if (blocks.size === 0) {
            return serializeBlockList(children, definitions);
        }

        const map: MarkdownSourceMap = { latest: blocks.values().next().value!.load, blocks, parts: context.parts };
        const parts = blockListParts(children, definitions, map, column.getKey());
        const written = writtenBlocks(parts, map, SAVE_DEFINITIONS.current!);

        return written.length === 0 ? "" : assembleDocument(written, documentLoad(parts, map));
    });
}
```

`SAVE_DEFINITIONS.current` is set there: write mode runs only inside `$serializeTopLevelBlocks`.

### `$recordSourceMap`

`$importMarkdown` ([:233](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L233)) sets `IMPORT_PARTS.current = new Map()` beside `LOADING_DOCUMENT.current = true`, clears it in the same `finally`, and passes the map on: `$recordSourceMap(source, located, recorded)`. There:

1. `rendered = $recordPartFingerprints(definitions, record)` takes the place of `$serializeTopLevelBlocks(definitions)`, with `record` four empty maps.
2. `load` and `blocks` as today; each block's `partsDiffer` is filled in step 4, so build the entries after the parts.
3. For each recorded `[key, part]`: the node is `$getNodeByKey(key)`; skip the part when the node is not attached, when no fingerprint was stored for it (a column block's is in `blockFingerprints`, every other part's in `partFingerprints`), or when the source of the top-level block holding it holds a tab. `column` = the key of the nearest `MarkdownColumnNode` above the node, else `null`. An item and a row get `load`; a row gets `cellFingerprints`. A column block becomes `{ kind: "columnBlock", column, block: { load: columnLoad, index, body, after, fingerprint, partsDiffer } }`, with one `columnLoad` per recorded `ColumnLoad`: its four fields and `definitions: load.definitions`, `definitionsKey: load.definitionsKey`.
4. A part *differs* when its source is not its standard form at load: an item when its `source` is not its entry of `standardItems`, a row or delimiter row when its `line` is not its fingerprint, a code frame and a column block always. For a part that differs, every top-level block and column block above it gets `partsDiffer: true`.
5. `return { latest: load, blocks, parts }`. The empty-document map and the mismatched-count map get `parts: new Map()`.

---

## Ordered Implementation Steps

Paths are relative to `packages/lib/`. One Vitest process at a time, with `--maxWorkers=2`.

1. **Tests first.** Create `tests/component/markdown-editor-nested-source-preservation.test.ts` (set up as `tests/component/markdown-source-preservation.test.ts`, with its `vi.mock` of `lexMarkdown`) holding *Expected Behaviour* groups 1 to 7. Run it: every row whose save differs from today's fails.
2. **Types.** In `src/typescript/lib/component/editor/markdownSourceMap.ts` add the part types, `partsDiffer` and `parts` of *Public API*, and `parts: new Map()` in `EMPTY_SOURCE_MAP`. Make the importer compile with `partsDiffer: false` and `parts: new Map()`, and `MarkdownEditor.adoptSourceMap` with `parts: imported.parts`. Check: `npm run typecheck`.
3. **The loop.** In `markdownSerializer.ts` add `RecordedFingerprints`, `PartsContext`, `WriteContext`, `SAVE_PARTS`, `withPartsContext`, `$holdsParts` and `blockListParts`; rebuild `$serializeTopLevelBlocks` and `serializeBlockList` on it; add `written` to `StandardBlock` and take it in `writtenBlocks`; pass the source map to `$serializeTopLevelBlocks` in `$serializeMarkdownWithPlaces` (the body of `$serializeMarkdown` before the through-model plan). Check: every Markdown suite passes unchanged — nothing is recorded yet.
4. **Lists.** Add `fingerprintMarker`, `itemFingerprint`, `contentColumn`, `atMargin`, `writeListWithParts`, the record branch of `serializeList`, and `listItemLines`'s `spacing`.
5. **Tables.** Add `writtenRow`, `writtenDelimiterRow` and `rowPartOf`, and route `serializeTable`'s lines through them.
6. **Code frames and columns.** Add the record and write branches of `serializeCode`; `writtenColumn`, `columnBlocksOf` and the column-less branch of `serializeFence`; `$recordPartFingerprints`.
7. **Import.** In `markdownImporter.ts` add `ColumnLoad`, `RecordedPart`, `IMPORT_PARTS`, `itemPartOf` and `rowCells`. Record in `$buildListItem` (`IMPORT_PARTS.current?.set(listItem.getKey(), …)` right after `$createListItemNode()`), in `$buildTable` (after `setColWidths`: the header row, the delimiter row keyed by the table, each body row), in `$buildCode` (fenced only) and in `$buildFence` (each column's blocks: call `locateBlocks` and map `$buildLocatedBlock` there, as `$buildBlockList` does, to keep each block's `start` and `end`). Finish `$recordSourceMap`. Check: groups 1 to 6 pass.
8. **The editor.** In `MarkdownEditor.ts` add `private readonly _sourceParts: Map<NodeKey, MarkdownSourcePart> = new Map();` beside `_sourceBlocks` ([:7241](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7241)); `adoptSourceMap` copies `imported.parts` into it and builds `{ latest: imported.latest, blocks: this._sourceBlocks, parts: this._sourceParts }`. Its JSDoc's "one small entry per top-level block per import" becomes "one small entry per top-level block and per nested part per import". Check: group 7 passes.
9. **Existing rows.** Update the rows of *Expected Behaviour* group 8. Run every Markdown suite (*Verification* step 3); no other row may change.
10. **The fuzz.** Create `tests/component/markdown-roundtrip/markdown-nested-edit-fuzz.test.ts` as group 9 gives.
11. **Docs and changelog**, as *Documentation Impact* gives.
12. **Checks**, as *Verification* gives.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceMap.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownImporter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Create | `packages/lib/tests/component/markdown-editor-nested-source-preservation.test.ts` |
| Create | `packages/lib/tests/component/markdown-roundtrip/markdown-nested-edit-fuzz.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-command-crashes.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-mode-through-model.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Each row loads the source with `setValue`, makes the edit through the private Lexical editor in one discrete update (as `markdown-source-preservation.test.ts` does), and reads `getValue()`. Every row also checks the two promises: the save loaded into a fresh editor saves to itself and gives the same surface model (`editorSurfaceModel`), and the viewer reads the save as it reads the standard form (`viewerModel(saved)` equals `viewerModel(canonicalSave(editor))`). `getValue()` before the edit is the source. The numbers are references inside this plan; each test's title says what it tests. Every group is offline unless marked.

### 1. List items

| # | Source | Edit | Save |
|---|---|---|---|
| 1.1 | `* one` / `* two` / `* three` | `!` appended to `two` | `* one` / `* two!` / `* three` |
| 1.2 | `* one` / `    * inner` / `* two` | `!` appended to `two` | `* one` / `    * inner` / `* two!` |
| 1.3 | `* one` / `    * inner` / `    * more` / `* two` | `!` appended to `inner` | `* one` / `    * inner!` / `    * more` / `* two` |
| 1.4 | `1.  one` / `    more` / (blank) / `    - x` / `2.  two` | `!` appended to `one` | `1.  one!` / `    more` / `    - x` / (blank) / `2.  two` |
| 1.5 | `3. a` / `4. b` / `5. c` | an item `x` inserted after `a` | `3. a` / `4. x` / `5. b` / `6. c` |
| 1.6 | `3. a` / `4. b` / `5. c` | `a` deleted | `3. b` / `4. c` (the list still starts at 3) |
| 1.7 | `8. a` / `9. b` / `10. c` | an item `x` inserted after `a` | `8. a` / `9. x` / `10. b` / `11. c` |
| 1.8 | `+ one` / (blank) / `+ two` / (blank) / `+ three` | `two` deleted | `+ one` / (blank) / `+ three` |
| 1.9 | `* a` / (blank) / `* b` / `* c` | `!` appended to `c` | `* a` / (blank) / `* b` / (blank) / `* c!` |
| 1.10 | `- a` / `  - x` / `  -` / `    ---` | `x` deleted | `- a` / `  * ---` (marker) |
| 1.11 | `-   a` / `   - b` | an item `x` inserted after `a` | `-   a` / `- x` / `- b` (indentation) |
| 1.12 | `- a` / `  - b` / `    > q` / (blank) / `- c` | `c` deleted | `- a` / (blank) / `  - b` / `    > q` (looseness) |
| 1.13 | `- a` / `b` / `- c` | `!` appended to `c` | `- a` / `  b` / `- c!` (a lazy line: item `a` is not recorded) |
| 1.14 | `- one` / tab + `- inner` / `- two` | `!` appended to `two` | `- one` / `  - inner` / `- two!` (a tab: nothing in the list is recorded) |
| 1.15 | `- [y] a` / `- b` / (blank) / `[z]: /u` | the definition's text made `[y]: /u`, and `!` appended to `b` | `- \[y\] a` / `- b!` / (blank) / `[y]: /u` (definitions) |
| 1.16 | `* one` / `    * inner` / `* two` / (blank) / `para` | `!` appended to `para` | `* one` / `    * inner` / `* two` / (blank) / `para!` (the list is not edited: one pass) |

### 2. Tables

`T` is `\| a   \| bb \|` / `\|-----\|----\|` / `\| 1   \| 2  \|` / `\| 3   \| 4  \|`.

| # | Source | Edit | Save |
|---|---|---|---|
| 2.1 | `T` | `!` appended to `3` | `\| a   \| bb \|` / `\|-----\|----\|` / `\| 1   \| 2  \|` / `\| 3! \| 4  \|` |
| 2.2 | `T` | a row `x`, `y` inserted after the header | `\| a   \| bb \|` / `\|-----\|----\|` / `\| x \| y \|` / `\| 1   \| 2  \|` / `\| 3   \| 4  \|` |
| 2.3 | `T` | the row `1`, `2` deleted | `\| a   \| bb \|` / `\|-----\|----\|` / `\| 3   \| 4  \|` |
| 2.4 | `T` | a cell `z` inserted after `2` | `\| a   \| bb \|  \|` / `\| --- \| --- \| --- \|` / `\| 1   \| 2  \| z \|` / `\| 3   \| 4  \|  \|` |
| 2.5 | `a \| b` / `--\|--` / `1 \| 2` | `!` appended to `2` | `a \| b` / `--\|--` / `1 \| 2!` |

### 3. Code frames

| # | Source | Edit | Save |
|---|---|---|---|
| 3.1 | `~~~~ js` / `let a;` / `~~~~` | `!` appended to the code | `~~~~ js` / `let a;!` / `~~~~` |
| 3.2 | ```` ```js ```` / `let a;` / ```` ``` ```` | language set to `ts` | ```` ```ts ```` / `let a;` / ```` ``` ```` |
| 3.3 | `~~~` / `a` / `~~~` | the code made `a` / `~~~~` / `b` | ```` ``` ```` / `a` / `~~~~` / `b` / ```` ``` ```` |

### 4. Columns

| # | Source | Edit | Save |
|---|---|---|---|
| 4.1 | `::: columns` / `left *x*` / (blank) / `* p` / `* q` / (blank) / `\|\|\|` / (blank) / `right` / `:::` | `!` appended to `right` | `::: columns` / `left *x*` / (blank) / `* p` / `* q` / (blank) / `\|\|\|` / `right!` / `:::` |
| 4.2 | `::: columns` / `_a_` / (blank) / `b` / `\|\|\|` / `c` / `:::` | `!` appended to `b` | `::: columns` / `_a_` / (blank) / `b!` / `\|\|\|` / `c` / `:::` |
| 4.3 | `- a` / (blank) / `  b` / `  :::` (row W7b of `markdown-editor-columns.test.ts`) | caret at the start, `setColumnCount(2)` | `::: columns` / `- a` / (blank) / `  b` / `  \:::` / `\|\|\|` / (blank) / `:::`, as W7b pins today (column) |

### 5. Unchanged behaviour

| # | Source | Edit | Save |
|---|---|---|---|
| 5.1 | each source of groups 1 to 4 | none | the source, byte for byte |
| 5.2 | `- a` / `- b` | `!` appended to `b` | `- a` / `- b!` |
| 5.3 | `* a` / `* b` / (blank) / `> q` | `!` appended to `a` | `* a!` / `* b` / (blank) / `> q` |

### 6. The save reads nothing back

| # | Source | Edit | Expected |
|---|---|---|---|
| 6.1 | 100 items `* entry i` each over `    * sub i` | a letter typed into `entry 1`, then `getValue()` | `lexMarkdown` is not called by the save, and one line of the source changes |
| 6.2 | a 200-row table padded to its columns | a letter typed into a cell | the same |

### 7. Undo

| # | Steps | Expected |
|---|---|---|
| 7.1 | `* one` / `    * inner` / `* two`; `!` appended to `inner`; undo | the source |
| 7.2 | `setValue` of row 1.3's source, then `setValue("x")`, then undo, then `!` appended to `inner` | row 1.3's save: the earlier import's parts are still in the map |

### 8. Rows of other files that change

Each row pinned the standard form of a block that now keeps its unedited parts. The new expected value is the save of the same edit with this plan:

| File, row | Expected now |
|---|---|
| `markdown-editor-command-crashes.test.ts`, `T1: a row short of a cell spanning down into it from a later column` | `\|a\|b\|` / `\|-\|-\|` / `\|1\|2\|` / `\|  \|^^\|` |
| same file, `T2: an empty row under a header cell spanning down into it` | `\|a\|b\|` / `\|-\|-\|` / `\|  \|  \|` |
| `markdown-editor.test.ts`, `P1: pasted into selected table cells, the text goes into the cell the selection began in` | `\| a \| b \|` / `\| - \| - \|` / `\| PASTED \| d \|` / (blank) / `after` |
| `markdown-importer.test.ts`, `#3b … escapes and spacing inside it are saved after the code is edited` | ```` ``` ts  a\_b {x} ```` / `codex` / ```` ``` ```` |
| `markdown-importer.test.ts`, `underline over C++ above Rust is read over the cells that take it …` | `\| h \|` / `\| --- \|` / `\| C\+\+ \|` / `\| ++Rust++ \|`; the comment above the rows ("the save writes it bare (`C++`)") becomes "the save keeps that unedited cell as written (`C\+\+`)" |
| `markdown-source-mode-through-model.test.ts`, row 5.15 (`* one` / `    * inner` / `* two`, bold in `two`) | `* one` / `    * inner` / `* **two**` |

### 9. The nested-edit fuzz

`tests/component/markdown-roundtrip/markdown-nested-edit-fuzz.test.ts`, built as `markdown-edit-fuzz.test.ts` is (the mulberry32 stream, a seed per case from its name, `FUZZ_SEED = 0x5eed`):

- **Documents**: every `CORPUS` case, and `NESTED_DOCUMENTS`, a list in the file of these sixteen sources (`⏎` a line end): `* one⏎* two⏎* three`; `+ one⏎⏎+ two⏎⏎+ three`; `1) one⏎2) two⏎3) three`; `7. one⏎8. two⏎9. three`; `- one⏎    - inner one⏎    - inner two⏎- two`; six items `* item i` each over `    * sub i`; `- a⏎b⏎- c`; `- a⏎  1. x⏎  2. y⏎- b`; `1.  one⏎    more⏎⏎    - x⏎2.  two`; `| a   | bb |⏎|-----|----|⏎| 1   | 2  |⏎| 3   | 4  |`; `a | b⏎--|--⏎1 | 2⏎3 | 4`; `| a | b | c |⏎| --- | --- | --- |⏎| x | << | y |⏎| p | q | r |`; `~~~js⏎code⏎~~~⏎⏎text`; `- item⏎⏎  ~~~⏎  code⏎  ~~~⏎- next`; `::: columns⏎left _x_⏎⏎* p⏎* q⏎⏎|||⏎⏎right⏎:::`; `::: columns⏎- a⏎    - b⏎|||⏎c⏎:::`.
- **Edits**, one or two per sequence, eight sequences per case, each picked from the kinds that apply: `!` and a word appended to an editable text node; an item inserted after a random item (a `ListItemNode` holding a `MarkdownListItemTextNode` with a word); an item deleted (one whose list keeps another); a row inserted after a random row (as many cells as that row, each a paragraph with a word); a body row deleted; a cell inserted after a random cell; a cell deleted (one whose row keeps another).
- **Hard checks**, each skipped where the case lists the matching `known` divergence, as the edit fuzz skips them: before any edit, the save is the source with its line ends normalized; the save reloads to the same surface model (`editorSurfaceModel`); the reloaded save is the save; the viewer reads the save as the standard form (`viewerModel`); the editor reads the definitions the viewer reads off the save.

Measured on the prototype: 9,344 runs per seed over the corpus at 16 sequences per case, two seeds, and 3,200 runs over `NESTED_DOCUMENTS` at 200: no failure. With the lazy-line, looseness or marker rule switched off, the fuzz fails on the cases that rule exists for (*Addendum: Measurements*); rows 1.5 to 1.7, 1.11, 1.15 and 4.3 pin the number, indentation, definitions and column rules, which the fuzz does not reach. The file runs in about 12 seconds.

### 10. Manual (the demo's MD Editor page)

Load a list nested four spaces deep and a padded table, edit one item and one cell, switch to source mode: only the edited lines differ from the loaded text. Then in source mode put the caret in an item of the nested list and press bold: only that line changes.

---

## Verification

From `packages/lib`, one Vitest process at a time with `--maxWorkers=2`; run `free -g` before a large run.

1. `npm run typecheck`, `npm run typecheck:test`, `npm run lint`: clean.
2. `npx vitest run --maxWorkers=2 tests/component/markdown-editor-nested-source-preservation.test.ts tests/component/markdown-roundtrip/markdown-nested-edit-fuzz.test.ts`: every row of *Expected Behaviour* groups 1 to 7 and 9 passes. Before step 7 of *Ordered Implementation Steps*, the rows whose save differs from today's (1.2 to 1.4, 1.11, 2.1 to 2.5, 3.1, 4.1, 4.2) fail.
3. Every Markdown suite: `npx vitest run --maxWorkers=2 tests/component/markdown-* tests/component/display/markdown* tests/component/display/Markdown*`. In these suites (12,991 tests on the prototype's base) the prototype changed exactly the five rows of group 8 that are in them; the sixth row of group 8 is in the through-model plan's test file.
4. `grep -n "SAVE_PARTS.current = " src/typescript/lib/component/editor/markdownSerializer.ts`: matches only inside `withPartsContext`.
5. The full suite: `npm test`.
6. Timing, not a test: load and type a letter into the documents of *The costs stay linear*, three runs, medians; compare with the table there.
7. `npm run docs:api` (no warning), `npm run docs:llms:check`, `npm run build:lib`.
8. Manual: group 10.

---

## Documentation Impact

No public symbol changes, so no API page or catalog entry changes. `llms.txt` needs no change.

`docs/components/MarkdownEditor.md`, *Common methods*, the paragraph that starts "Saving changes only what was edited." (line 273): replace its first sentence with:

> Saving changes only what was edited. A top-level block you did not touch — a paragraph, list, table, quote or fence — is written back exactly as it was loaded, with the blank lines around it. In an edited list, table, fenced code block or `:::` fence, the items, rows, cells, fence lines and column blocks you did not touch are written as they were too, and only what you edited is written in the editor's standard form (see [Supported constructs](#supported-constructs): `*` emphasis, `#` headings, fenced code, …). An unedited part is written again in the standard form where its text would read otherwise in its new place: an item whose list now writes another marker, or turns tight while the item holds a blank line, an ordered item whose new number has more or fewer digits, a part moved into or out of a `:::` column, a fence whose code now holds a line that would close it, and — once a link reference definition is edited — a part holding a `[`. An unedited ordered item whose number changes keeps its text and gets its new number in place of the old one.

Keep the rest of the paragraph.

The tabs paragraph (line 306): after "loses the tabs of its indentation and keeps every tab inside its text, its code spans, its code blocks and its HTML", add: "; an edited block whose source holds a tab is written in the standard form whole, without keeping its unedited items or rows".

The paragraph the through-model plan writes in *Source / WYSIWYG mode* ("Two things follow. A command writes the whole top-level block it changes in the form the editor saves — every item of a list with `-` and two-space nesting, …"): replace "A command writes the whole top-level block it changes in the form the editor saves — every item of a list with `-` and two-space nesting, `__bold__` as `**bold**`," with "A command writes the list item, table row or cell, or block it changes in the form the editor saves — `__bold__` as `**bold**`,", and "as a WYSIWYG edit of that block does; the blocks around it stay as written" with "as a WYSIWYG edit does; the items, rows and blocks around it stay as written".

`docs/reference/changelog/next.md`:

- *Changed → Components*, a new entry: "**`MarkdownEditor` keeps the unedited parts of an edited block as written.** An edit in a list, table, fenced code block or `:::` fence used to rewrite the whole block in the editor's standard form; now only the item, row, cell or column block you edited is, and its neighbours keep their source — the indentation of a list nested four spaces deep, a table's padding, a `~~~` fence. This holds for the source-mode commands too. No consumer action is needed."
- In the through-model plan's entry ("**`MarkdownEditor`'s source-mode commands give the WYSIWYG result.**"): replace "A command writes the top-level block it changes in the editor's own form, as a WYSIWYG edit does (`* one` / `    * inner` with `two` bolded saves `  * inner`);" with "A command writes the part of a block it changes in the editor's own form, as a WYSIWYG edit does;".

---

## Potential Challenges

- **A part written under the wrong context reads otherwise.** Every write-mode decision reads `SAVE_PARTS.current.column`; set it only through `withPartsContext`, which restores it on a throw (*Verification* step 4).
- **`serializeListApart` serializes a list once per candidate marker.** In write mode each candidate re-decides its items, and the marker rule keeps none whose marker the candidate changed; do not cache item decisions across candidates.
- **The record pass must not change the standard output.** A difference would make every unedited block look edited; the existing source-preservation and round-trip suites catch it at step 3 and step 7.
- **`$getNodeByKey` at the end of a load sees nodes the build dropped** (a list that became a raw block): skip a part whose node is not attached.
- **A typed letter in a long hand-written list costs more.** The second pass is linear but about doubles the save of that one list (47 → 74 ms at 2,000 items); a list already in the standard form, and every other block, pays nothing.

---

## Critical Files

- [markdownSerializer.ts:1749](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1749) `unchangedBlock`, [:1562](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1562) `writtenBlocks`, [:1514](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1514) `assembleDocument`, [:1529](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1529) `documentLoad`: the top-level fingerprint mechanism this plan mirrors one level down, and reuses inside a column.
- [markdownSerializer.ts:795](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L795) `$serializeTopLevelBlocks` and [:403](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L403) `SAVE_DEFINITIONS`: the module-level save context `SAVE_PARTS` follows.
- [markdownSerializer.ts:2745](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2745) `serializeList`, [:2934](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2934) `listItemLines`, [:2902](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2902) `listMarkerWriter`, [:1929](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1929) `serializeListApart`, [:3049](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L3049) `serializeTable`, [:2696](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2696) `serializeCode`, [:3231](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L3231) `serializeFence`.
- [markdownImporter.ts:233](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L233) `$importMarkdown`, [:402](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L402) `$recordSourceMap`, [:127](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L127) `IMPORT_DEFINITIONS`, [:1050](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L1050) `$buildListItem`, [:1149](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L1149) `$buildTable`, [:878](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L878) `$buildCode`, [:1225](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L1225) `$buildFence`.
- [MarkdownEditor.ts:10493](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L10493) `adoptSourceMap`.
- [markdownTableExtension.ts:61](../packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L61) `splitRow`, which `rowCells` follows.
- `tests/component/markdown-source-preservation.test.ts` (rows and the `lexMarkdown` spy) and `tests/component/markdown-roundtrip/markdown-edit-fuzz.test.ts` (the fuzz this plan's mirrors).
- `plans/research/markdown-source-preserving-model.md` (main tree, untracked), its third design (fingerprints one level down), and this plan's prototype and probes in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans6/item-preservation/`.

---

## Non-Goals

- **Inline runs.** Text inside an edited paragraph, item or cell is still written in the standard form (`_a_` as `*a*`, an escape added before `~`). The research study leaves that to a later decision, measured with the harness this plan's fuzz extends.
- **The blank lines between top-level blocks an edit creates.** A command that splits a list, or puts a heading or quote between blocks, writes one blank line around the new block, as today; that is where most of the source-mode price left after this plan lies (*Addendum: Measurements*).
- **Blank lines between items as written.** Items are joined by the standard separator; a loose list whose items were set apart irregularly gets one blank line between every two.
- **An edited cell padded to its column.** The edited cell gets one space each side.
- **An indented code block's frame.** An edited indented code block is written fenced, as today.
- **Items holding a lazy line, and blocks holding a tab.** Their edited block is written in the standard form whole, as today.
- **A quote's children and its `>` style.** A quote node holds one paragraph; a quote holding more is a raw block, which keeps its text.
- **An ordered list numbered `1.` throughout.** Its items are renumbered once it is edited, as today.

---

## Addendum: Measurements

All on a private copy of `7cdd0d1f0` with the through-model plan's prototype and this plan's prototype, switchable at run time; probes, scripts and outputs in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans6/item-preservation/` (`probes/`, `out/`, `PROGRESS.md`). One Vitest process at a time; another worker's tests shared the machine for part of the time.

**Correctness.** The nested-edit fuzz of *Expected Behaviour* group 9 (the edit kinds there; `appendText` alone where marked):

| Set | Runs | Failures |
|---|---|---|
| corpus, 16 sequences per case, seed 1 | 9,344 | 0 |
| corpus, 16 sequences per case, seed 2 | 9,344 | 0 |
| hand-written set (the through-model plan's 26 documents), 40 sequences | 1,040 | 0 |
| real documents (the library's docs, every third implemented plan, the READMEs; 228 files up to 25 kB), 3 sequences | 684 | 0 |
| the sixteen `NESTED_DOCUMENTS` of group 9, 200 sequences | 3,200 | 0 |

With one rule switched off, over the corpus at seed 1:

| Rule off | Failing runs | Case |
|---|---|---|
| lazy continuation line | 5 | `raw list whose indented second marker continues the first item` (`   + __4_` / (blank) / `     p` / `    + 2`): written at the margin, the lazy `+ 2` became an item |
| looseness | 2 | `block right under a list item text in a loose list`, `raw nested list right under the text of a loose list item` |
| marker | 5 | `thematic break under a bare marker in a nested list` |
| indentation, definitions, column | 0 | rows 1.11, 1.15 and 4.3 fail without their rule, as do `markdown-editor-columns.test.ts` W7b and W8 and `markdown-editor-command-crashes.test.ts` B1 to B3 without the column rule |
| renumbering in place | 0 | without it a renumbered item is written anew, which reads the same |

The research study's prototype failed 6 times in 3,960 such runs, in the lazy-line class and the looseness class; both have their rule here. Every Markdown suite (12,991 tests) passes with the prototype but for the five rows of group 8, which pinned the standard form of an edited block.

**WYSIWYG edits: source lines rewritten outside the edit.** A word appended to a random text node, the word stripped from the save, the save diffed by lines against the source: non-blank source lines that are gone.

| Set | Runs | Today | With parts |
|---|---|---|---|
| real documents | 684 | 109 lines, in 68 runs | 21 lines, in 17 runs (−81 %) |
| hand-written set | 1,040 | 994 lines | 547 lines (−45 %) |
| corpus | 9,344 | 5,767 lines | 5,469 lines (−5 %; one construct per case) |
| `NESTED_DOCUMENTS`, every edit kind of group 9 (deleted items and rows count as removed in both columns) | 3,200 | 6,753 lines | 3,066 lines (−55 %) |

The 21 lines left on real documents are all the edited line itself: its cell's padding, an escape the standard form adds to text in it (`\[^note\]`), or a soft line break inside a code span that its paragraph's rewrite joins. They are inline-run rewrites (*Non-Goals*). The research study's prototype cut the same measure by 48 %; cells, code frames, columns and the item frame account for the rest.

**Source-mode commands: the price.** The through-model plan's corpus differential — 605 documents, 17 commands at a caret in every non-blank line and 6 over a range: 35,153 cases. Through the model, source mode gives the WYSIWYG save byte for byte in all 20,855 cases whose selection has a place and touches no raw block, with this plan as without it; no case throws; the caret lands on the same character in the same 13,755 of 13,840 edits. Where both today's text surgery and the pass act (8,074 cases):

| | Touches more lines than today, without this plan | With it |
|---|---|---|
| all | 2,948 = 36.5 %, median 2 extra, at most 13 | 2,719 = 33.7 %, median 1, at most 8 |
| corpus | 34.6 % | 33.2 % |
| hand-written set | 45.6 %, at most 13 | 35.7 %, at most 5 |
| inline commands | 28.3 % | 23.9 % |
| block commands | 43.4 % | 41.9 % |
| lines touched in all 8,074 (today's text surgery: 12,719) | 19,453 | 17,537: the excess over today down 28 % |

No case touches more lines with this plan than without it. The 2,719 cases left touch more lines for these reasons, by the first normalization that makes the two results equal: blank lines a command writes around a block it makes or splits (1,190), a heading or setext form and other structure (862), tabs and indentation inside the changed block (364), spaces (192), escapes (77), list markers (34). The through-model plan measured 36.6 % over its own count of 8,009 cases; this harness reproduces it as 36.5 % over 8,074.

**Cost.** Load, and a letter typed into the middle item or cell followed by `getValue()`; medians of three, milliseconds:

| Document | Size | Load, today / after | Letter and save, today / after | Lines the save changes, today / after |
|---|---|---|---|---|
| `* entry i` | 500 / 2,000 | 50 / 36, 142 / 133 | 16 / 12, 37 / 36 | 1 / 1 |
| `- entry i` | 500 / 2,000 | 36 / 37, 127 / 135 | 9 / 9, 36 / 37 | 1 / 1 |
| `* entry i` over `    * sub i` | 500 / 2,000 items | 47 / 43, 142 / 147 | 12 / 20, 47 / 74 | 251 / 1, 1,001 / 1 |
| a table padded to its columns | 500 / 2,000 rows | 52 / 53, 190 / 189 | 19 / 31, 68 / 112 | 502 / 1, 2,002 / 1 |
| mixed blocks (hand-written lists, tilde fences, padded tables) | 500 / 2,000 | 57 / 57, 198 / 209 | 19 / 21, 77 / 80 | 3 / 1, 1 / 1 |

Before the second pass was limited to blocks with a part whose source differs from its standard form, the `-` list paid it too (36 → 66 ms at 2,000). A save calls `lexMarkdown` no more than today: zero times for a typed letter in the nested list, the padded table and a `:::` fence of two columns. The parts hold, in characters, 2.4 times the source of a flat list, 3.1 times a list nested once or a padded table, and 3.9 times a list nested twice.

---

## Notes

[^fingerprint-rule]: This is the top-level rule of `markdown-editor-source-preservation` applied to a smaller unit: equal standard forms mean equal content, so the source, which read as that content at load, still reads as it in the same context. Content, not node identity, decides, which survives Lexical's clones and a format toggled on and off; the node key only says where to look. The seams of *When a kept part is rewritten after all* are the cases where the context, not the content, changed.

[^number-blind]: The research study measured it on real documents: with the number in the fingerprint, inserting or deleting an item rewrote every later item of an ordered list, 18 lines in its nested run. The bullet stays in the fingerprint through the list's own marker, because the marker rule checks it separately.

[^map-not-state]: Storing a part's source as Lexical node state (the study's first design) was rejected: Lexical's clipboard copies node state into pasted nodes, so a paste would carry sources from another place, and a split text or item would carry the same source twice. A side map keyed by node key has neither problem, since a paste, a split and a copy make new keys. It is the choice `markdown-editor-source-preservation` made for the top-level blocks, and its whole-stack review made the map never-pruned for undo (`adoptSourceMap`); the same reasoning holds one level down. Offsets into the whole document (the study's second design) were rejected for their cost: every node would need an exact position, 2.5 to 4 thousand lines of work.

[^context-precedent]: Both contexts follow what the two files already do. The importer passes load-wide state to its builders through module-level holders set around the build (`IMPORT_DEFINITIONS.current`, `LOADING_DOCUMENT.current`), and the serializer passes the document's definitions to every block serializer through `SAVE_DEFINITIONS.current`, set inside `$serializeTopLevelBlocks`. Threading a parameter through every serializer would touch `serializeBlock`, `serializeItemBlocks`, `serializeCellChild` and their callers for one flag. Recording inside the existing pass keeps the fingerprint and the save computed by the same code, which is the top-level mechanism's own rule, and costs the load no second serialization (the study's prototype ran one and paid 0 to 11 % on load).

[^recorded-when]: Each condition answers a failure the prototype hit or a reading the parts cannot keep. A lazy continuation line reads by its column in the document, not in its item: the corpus case `   + __4_` / (blank) / `     p` / `    + 2` holds `+ 2` as text of `p` only while it stands four columns in, and writing the item at the margin made it an item; that is the study's "frame shift" failure. A tab in a container's indentation reads by its column too (`markdown-tab-column-parity`), and `marked` hands a nested item's source back with such tabs already written as spaces, so the recorded source of a nested item would not be the document's; dropping parts in any top-level block holding a tab is the one rule that covers both; on the real documents the save rewrote the same 21 lines with the rule as without it. A table whose rows do not map one line to one row, an indented fence and a column holding `\|||` would need the source re-derived from the token, which the top-level mechanism never does either.

[^two-passes]: A single pass writing both forms at once was rejected: every block serializer, `serializeItemBlocks` and `serializeCellChild` would return two strings. The second pass runs only for the block being edited, and only when it can gain: measured, a list whose items are already in the standard form (a `-` list typed in the editor) paid 36 → 66 ms per letter at 2,000 items before the `partsDiffer` gate, and pays nothing after it. A block with no top-level entry — a list the editor split or joined — always takes the second pass, since its items may still be kept.

[^seams]: Each rule closes a case where a kept source, correct alone, reads otherwise next to a rewritten neighbour; the fuzz found the lazy-line, looseness and marker cases (*Addendum: Measurements*), and the deterministic rows pin the rest. A list's marker belongs to the list, and an item of another bullet or delimiter starts a new list in `marked`. Only an ordered list's first number counts in Markdown, so a kept item could keep its old number and read the same; the plan renumbers it in place because a list numbered `3`, `4`, `4`, `5` after an insert looks broken in source mode, and a number of another width moves the item's content column, so the item is then written anew. The indentation rule is the nesting rule of CommonMark: an item indented to the content column of the item before it nests inside it (`-   a` / `   - b` keeps `b` a sibling only while `a`'s text starts at column 4). Looseness is read the way `marked` reads it: a list is loose when a blank line stands between two items or between two blocks of one item, so a kept item carrying such a blank line makes a tight list loose, and a loose list of one item needs one. Keeping an edited item's own spacing and indentation is what keeps four-space nesting byte for byte: without it the kept nested items are written under a two-space parent and move. The column rule exists because `:::` and `\|||` lines mean something inside a fence: row W7b's item holds a `:::` line that, kept, closes the fence the list is moved into. Keeping blank lines between items as written was rejected: in a loose list whose blank lines are all between rewritten items, the kept separators could leave none, and the list would read tight. Padding an edited cell to its column was tried and dropped: in a table that was not padded it pads the edited cell alone, and it changes rows of `markdown-editor-reload-differences.test.ts` that pin a cell's text.

[^column-as-document]: `marked` lexes each column's section of a fence as a document of its own (`splitColumnSections`, then a lex per section), so a column's blocks follow exactly the document's rules, and the top-level code applies unchanged. A column's blocks get their own `MarkdownSourceLoad` because `followsAtLoad`, `documentStart` and `documentEnd` compare loads and indexes: two blocks are neighbours only inside one column, and a block moved to another column is not written with its old column's text around it.

[^costs]: Write mode reads nothing back: every decision compares strings the serializer already writes, and the definitions rule compares the definitions key `$readDefinitions` computes once per save. `lexMarkdown` is called inside a column's `writtenBlocks` only where the top-level checks call it — a kept block that leaves a `:::` fence or a label open — as `markdown-editor-large-document-costs` bounds it. The memory is the parts' source and fingerprint strings, one set per nesting level; a fingerprint hash would halve it (the study's estimate), at the cost of a hash per item per save, and is left out.

[^order]: The through-model plan's rows that this plan changes were measured: with this plan's prototype no WYSIWYG result of the `SAME` and `DIFFERS` tables its 294 parity rows come from changes, and of its own rows only 5.15 holds a hand-written nested list without a tab. Rows 5.16, 5.19, 5.20 and 6.3 hold tabs, whose blocks keep no part. Its corpus differential needs no change: it compares source mode with the WYSIWYG save, which this plan changes alike, and it measured 20,855 of 20,855 equal with this plan's prototype in place.
