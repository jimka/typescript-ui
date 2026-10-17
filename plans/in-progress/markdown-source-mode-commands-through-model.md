---
depends-on:
  - markdown-editor-list-looseness-transform-cost
  - markdown-editor-large-document-costs
  - markdown-editor-reload-differences
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/CodeEditor.ts
  - packages/lib/src/typescript/lib/component/editor/markdownImporter.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourceTokens.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts
  - packages/lib/src/typescript/lib/component/display/markdownCharacterReferences.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-source-edits.test.ts
  - packages/lib/tests/component/markdown-source-places.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/components/CodeEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Source-Mode Commands Through the WYSIWYG Model — Implementation Plan

## Overview

`MarkdownEditor` has two editing surfaces. The **WYSIWYG surface** is a Lexical editor: `markdownImporter.ts` reads Markdown into a tree of Lexical nodes and `markdownSerializer.ts` writes the tree back. **Source mode** is a `CodeEditor` over the raw Markdown text. Today each source-mode command is a second implementation that edits the text directly — *text surgery*, in [markdownSourceEdits.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts) and [markdownSourceLines.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts), called through `editSource` ([MarkdownEditor.ts:7432](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7432)). Its results differ from the WYSIWYG results in 140 pinned rows of the parity harness, and, measured here, its text differs from the WYSIWYG save in 55 % of the corpus cases where both act.

This plan runs every source-mode command that edits text through the WYSIWYG model instead — the *pass*. A command reads the Markdown near the selection into a short-lived headless Lexical editor (the *model editor*), selects there what the source selection covers, runs the WYSIWYG command unchanged, saves, writes back only the changed range through `CodeEditor.replaceRange`, and puts the caret where the WYSIWYG command left it. The commands are the five format toggles, `toggleLink`, `removeLink`, the three style setters, `clearFormatting`, `insertImage`, `setBlockType` and both list toggles. Measured on this base, the result equals the WYSIWYG save byte for byte in all 20,855 corpus cases where the selection has a place and touches no raw block.

The plan also does four smaller things the pass needs: it finds the source of a character reference (`&#35;`), so a block holding one has exact positions; it makes `CodeEditor.replaceRange` an undo step of its own; it refuses every source-mode command of a read-only editor up front; and it deletes the text surgery the pass replaces, about 3,300 library lines, with its tests. It removes three queued plans the pass makes unnecessary.

**Terms.** A *top-level block* is a direct child of the document: a paragraph, a heading, a whole list, a whole quote. A *raw block* is text the WYSIWYG surface keeps as raw Markdown (`MarkdownRawBlockNode`): an HTML block, a thematic break, a link reference definition, a quote holding a list or more than one paragraph, a list written tight with a block right under another. A *place* is a point in the Lexical tree: an offset in a text node, or a child index of an element. The *standard form* is how the serializer writes a block anew: `-` bullets, two-space nesting, `**` for bold. The *window* is the part of the document a command imports.

*Base*: commit `7cdd0d1f0`, the tip of the Markdown chain (`feature/markdown-editor-reload-differences`). Every line number below is from that commit, and every number was measured there with a prototype in a private copy (see *Addendum: Measurements*).

---

## Architecture Decisions

### Every text-editing source-mode command runs the WYSIWYG command on a model of the text

The thirteen command entry points of the commands listed in the overview (the three style setters share one, `patchSelectionStyle`) call one new method, `editSourceThroughModel(command)`, in place of `editSource(TRANSFORM)`. In source mode it runs the pass and returns `true`; otherwise it returns `false` and the caller goes on to its WYSIWYG path, as `editSource` does today.[^precedent-pass]

The pass re-invokes the public command. While it runs, a private field `_commandEditor` holds the model editor: `isSourceMode()` answers `false`, `ensureEditor()` returns the model editor and `refocusSurface()` does nothing. So the re-invoked command takes its WYSIWYG path unchanged, against the model.[^reentry]

These stay as they are, by the owner's decision: `insertTable`, `insertParagraphBeforeBlock` and `insertParagraphAfterBlock` (text surgery through `editSource`), typing (Enter, Backspace, Tab), syntax highlighting, and the source-mode toolbar state.[^exceptions]

### The model editor has the WYSIWYG editor's rules, registered by the same code

`buildEditor`'s list of registrations after the load moves into one private method, `registerEditorRules(editor, onCommit)`. `buildEditor` calls it with the update listener that reports changes; the model editor calls it with `null`, so the model reports nothing. The model loads exactly as `buildEditor` loads: the writable-state rules alone during the import, the other rules after.[^registrations]

After registering the rules, the model runs one empty discrete update — the *settling update* — before the selection goes in.[^settle]

### Exact positions come from the importer, the serializer and the places module

The *places module* is `markdownSourcePlaces.ts`, which the raw-block range edits added to place a source offset in a loaded block. The study's prototype aligned shown characters with written ones by a heuristic. This plan takes every position from code that already knows it:

| Step | Source of the position | New code |
|---|---|---|
| a top-level block's span in the imported text | the import's source map: `latest.prefix`, then each block's `body` and `after` ([markdownSourceMap.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceMap.ts)) | `$loadedBlockSpans`, in the new `markdownSourceModel.ts` |
| a source offset → a place inside that block | `$placeOfSourceOffset` ([markdownSourcePlaces.ts:157](../packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts#L157)), as the raw-block re-read uses it | none |
| a top-level block's span in the saved text | the serializer's own assembly of the save | `$serializeMarkdownWithPlaces` in `markdownSerializer.ts` |
| a place → a source offset inside that block | the same walk `$placeOfSourceOffset` makes, read the other way | `$sourceOffsetOfPoint` in `markdownSourcePlaces.ts` |

Worked examples of the second direction:

| Written block | Point after the command | Offset |
|---|---|---|
| `a **bc** d` | text `bc`, offset 0 | 4: the `b`, inside the delimiters |
| `a **bc** d` | text `bc`, offset 2 (its end) | 6: after `c`, before the closing `**` |
| `a **bc** d` | text ` d`, offset 0 | 8: after the closing `**` |
| `a \* b` | text `a * b`, offset 2, before `*` | 2: before the backslash that writes it |

The positions themselves are about 150 lines of library code, less than the study's estimate of 250 to 400, because the places module already exists; the window and the mapping over a whole text in `markdownSourceModel.ts` add about 200.[^exact-positions]

### A character reference has its source found

`marked` hands `&#35;` back decoded, so today every character of a text token that holds a reference shares the whole token's span, and an offset in such a block has no place. The analysis now splits the token's `raw` into pieces — each written character, and each reference with the characters it reads as — through a new `characterReferencePieces` beside `decodeCharacterReferences` in [markdownCharacterReferences.ts](../packages/lib/src/typescript/lib/component/display/markdownCharacterReferences.ts). `pushTextLeaves` ([markdownSourceTokens.ts:1109](../packages/lib/src/typescript/lib/component/editor/markdownSourceTokens.ts#L1109)) gives each shown character its piece's span.

| Text as written | Shown | Source of each shown character |
|---|---|---|
| `a&#35;b` | `a#b` | `a` 0–1, `#` 1–6, `b` 6–7 |
| `x&ngE;` | `x≧̸` (two code units) | `x` 0–1, both units 1–6 |
| `&notaname;` | `&notaname;` | each character its own: a name the list does not hold is written text |

The same change removes a documented limit of the WYSIWYG surface: after an edit makes a raw block show as its blocks, the caret no longer goes to the block's end when the block holds a character reference.[^char-refs]

### The pass imports a window: the touched top-level blocks and one on each side

`sourceWindow(text, from, to)` lexes the whole document once, through a new `locateTopLevelBlocks` in the importer, which runs the importer's own `locateBlocks` ([markdownImporter.ts:467](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L467)) and also returns the document's definitions from the same lex. The window runs from the start of the block before the first block the selection touches to the end of the block after the last one. A window that reaches the first block starts at offset 0, and one that reaches the last block ends at the document's end, so the text around the document comes along.[^window]

| Document (blocks) | Selection | Window |
|---|---|---|
| `# h` / `para` / `- a` / `> q` / `end` | caret in `- a` | `para` to `> q` |
| same | caret in `# h` | offset 0 to the end of `para` |
| same | from `para` into `> q` | `# h` to `end`: the whole document |

### Link reference definitions travel with the window as text

When the document defines any label, the window carries the document's top-level definition blocks: those before the window go in front of it and those after it go behind it, each set apart by a blank line, so the first definition of a label still comes first. The pass then lexes the composed text once more; when its definitions are not exactly the document's (a definition inside a list item or a quote, which no top-level block holds), the pass imports the whole document instead. After the save, the composed parts must come back unchanged at the start and end of the saved text; when they do not, the pass runs again on the whole document.[^definitions]

| Document | Selection | Imported text |
|---|---|---|
| `see [a][1] here` / `mid` / `more` / `end` / `[1]: /one` | caret in `here` | `see [a][1] here` + blank line + `mid` + blank line + `[1]: /one` |
| `- a` with `  [x]: /u` inside the item / `mid` / `more` / `b [x] c` | caret in `c` | the whole document: the definition is in no top-level block |

### Where a selection end stands between blocks

An offset belongs to the top-level block whose span holds it, its end included. A collapsed caret on a blank line between blocks has no place, and the command does nothing. A range end on such a line moves inward: the start to the next block's start, the end to the previous block's end; a range that lies wholly between two blocks does nothing.[^gap-rule]

| Document | Selection | Bold acts on |
|---|---|---|
| `one` / (blank) / `two` | caret at 4, on the blank line | nothing |
| same | 0 to 4 | `one` |
| same | 4 to 8 | `two` |

A text holding a carriage return does nothing: only the cached text of a source editor not mounted yet can hold one, and the import rewrites it, so no offset would match.[^crlf]

### A command on a raw block declines

Right after the selection is placed, the pass asks `$selectionTouches($isMarkdownRawBlockNode)` ([MarkdownEditor.ts:4124](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4124)). When the selection touches a raw block, the command does nothing. It does not take the WYSIWYG result, which writes the raw block's text escaped (`- \> - one`). This is the owner's decision. It applies to the block commands only in effect, since the WYSIWYG inline commands and `insertImage` decline in a raw block already.[^raw-decline]

| Document | Selection | Source mode today | After this plan |
|---|---|---|---|
| `> - one` / `> - two` | caret in `one`, bulleted toggle | `one` / `> - two` | nothing |
| `one` / (blank) / `---` / (blank) / `two` | `one` to `two`, bulleted toggle | `- one` / … / `---` / … / `- two` | nothing |
| `<div>x</div>` / (blank) / `two` | caret in `x`, bulleted toggle | nothing | nothing |

### A declined command changes nothing and reports nothing

A command declines when the selection has no place, touches a raw block, or the WYSIWYG command leaves the model's text as it was. The source text, its selection and its undo history stay as they were, no event fires, and keyboard focus goes back to the source editor. This is what `editSource` does today for a transform that returns `null`, and what the WYSIWYG surface does for a declined command.[^decline-silent]

### A read-only editor refuses every source-mode command up front

In a read-only editor, every source-mode command that edits text — the thirteen through the model and the three that stay text surgery — is refused before the text is read or imported: `refuseSourceEditIfReadOnly()` hands `CodeEditor.replaceRange` an empty replacement at the selection, which a read-only `CodeEditor` refuses with its own `"readonlyedit"` and wash. `MarkdownEditor` relays the event once, as it already does for the source editor ([MarkdownEditor.ts:7361](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7361)), and its own wash stays still.[^read-only]

| Read-only document | Command | Today | After |
|---|---|---|---|
| `hello` | `setBlockType("h2")` | one `"readonlyedit"` | one |
| `` ``` `` / `x` / `` ``` `` | `toggleBold()` | none: the transform declined | one |
| `hello` | `setBlockType("paragraph")` | none | one |

### A command is one undo step of the source editor, never joined to typing

The pass ends in one `replaceRange` call, one CodeMirror transaction carrying the change and the caret. `replaceRange` now also carries `isolateHistory.of("full")`, so CodeMirror's history never joins it with the typing before or after it.[^undo-merge]

| Steps in a mounted source editor | One undo today | One undo after |
|---|---|---|
| `hello world`, type `x` after `hello`, press bold at once with the caret where typing left it | `hello world`: the bold and the typed `x` both go | `hellox world` |
| same, but select `hellox` before pressing bold | `hellox world` | `hellox world` |

This is a change to `CodeEditor`, generic: its docs already promise that `replaceRange` is one undo step.

### The caret goes back to the shown character the WYSIWYG caret stands at

Each end of the model's selection after the command maps to an offset of the saved text: find the top-level block holding it, take that block's span from `$serializeMarkdownWithPlaces`, and ask `$sourceOffsetOfPoint`. An end that has no exact offset — it stands in a block the save does not write (an empty paragraph), the walk does not find its source, or the selection is not a range — goes to the end of the replaced text.[^caret-fallback]

| Document, selection | Command | Text after | Selection after |
|---|---|---|---|
| `hello world`, caret at 8 | bold | `hello **world**` | 8 to 13: `world` |
| `one` / (blank) / `two`, caret at 1 | `h2` | `## one` / … | 4: after `o`, as before the command |
| `ab cd`, caret at 1 | `insertImage("/i.png", { alt: "pic" })` | `a![pic](/i.png)b cd` | 15: after the image |
| `- one` / (blank) / `  second` / (blank) / `- two`, caret at 10 | bulleted toggle | `- one` / … / `- second` / … / `- two` | 10 |

### Performance targets

Measured medians on this base, per command, with the caret in the middle of the document (*Addendum: Measurements*):

| Document | Today | Through the model |
|---|---|---|
| 2,000 mixed blocks, 69,000 characters | 47 to 79 ms | 13 to 16 ms |
| 8,000 mixed blocks | 198 to 296 ms | 95 to 101 ms |
| 2,000 mixed blocks with 50 definitions | 46 to 71 ms | 63 to 71 ms |
| one tight list of 2,000 items | 26 to 60 ms | 299 to 310 ms |
| one tight list of 8,000 items | 104 to 236 ms | 1.3 to 1.4 s |
| a list of 6,400 lines nested eight deep, all selected, bulleted toggle | 25.5 s | 2.2 s |

The targets, at about twice the measured medians, are: 40 ms at 2,000 mixed blocks, 200 ms at 8,000, 150 ms at 2,000 blocks with 50 definitions, and 600 ms for a list of 2,000 items. The tests count work instead of time: a command lexes the whole document once, and imports no more than its window.[^speed]

### The source-mode toolbar state stays text-based, and needs no fix

`readSourceSelectionState` stays as it is: it runs on every caret move, where a model import would cost a window import per arrow key. The toolbar part of `markdown-source-mode-block-locator` — placing toolbar state right on tab-indented and look-alike blocks — is not needed on this base: over 4,157 carets inside words, the source-mode toolbar flags equal the WYSIWYG flags at the same place in every one, the block-locator's own two shapes included.[^toolbar]

### The text surgery for the thirteen commands is deleted

Measured by reachability between top-level declarations:[^census]

| File | Lines today | Deleted | Kept, and why |
|---|---|---|---|
| `markdownSourceLines.ts` | 1,948 | 1,470: `blockPrefixSource`, `FENCED_CODE_SOURCE`, `listSource` and the lift-and-check machinery only they reach | 452: `tableSource`, `paragraphAroundBlockSource` and what they reach |
| `markdownSourceEdits.ts` | 2,148 | 1,840: the inline toggles, link and unlink, span styles, clear formatting, image | 294: `readSourceSelectionState`, the `MarkdownSourceEdit` and `MarkdownSourceTransform` types, and what they reach |
| `markdownSourceTokens.ts` | 1,166 | 11: `withMark` | the rest: the toolbar reader, the places module and the two kept line commands read it |
| `MarkdownEditor.ts` | — | `sourceTransformForBlockType`, the imports of the deleted transforms | — |

Tests: 223 of the 259 rows of `markdown-source-edits.test.ts` (about 1,700 lines) go with the transforms; the 29 rows of the toolbar reader, `tableSource` and `paragraphAroundBlockSource` stay; of the 7 rows that call both, five go and two keep only their toolbar assertions (*Ordered Implementation Steps*, step 12). The files keep their names.[^files-keep-names]

### The parity harness becomes "source mode equals WYSIWYG"

The `SAME` table (162 rows) and the `DIFFERS` table (140 rows) of `markdown-editor.test.ts` become two tables. `PARITY` holds every row whose selection touches no raw block — the 162 `SAME` rows, 130 `DIFFERS` rows, and the two tab rows `E25` and `E26` that stand in an `it.each` of their own today — each with one expected document, the WYSIWYG column as it stands. Its test asserts the WYSIWYG result, its reload and surface checks and its undo, then that source mode gives the same bytes and the caret on the same shown character. `RAW_DECLINES` holds the 10 rows whose selection touches a raw block (ids `Q1` and `Q2` twice each, `E8`, `E9`, `E11`, `E22` twice, `E23`): the WYSIWYG result as pinned today, and source mode leaving the document unchanged.[^harness]

A corpus differential is added: every source-mode command, on every corpus document and the hand-written set, against the WYSIWYG command at the same selection. Zero differences are allowed, except the two documented exceptions: a raw block, and no place.[^differential-size]

### The three superseded plans are removed in this plan's first commit

`plans/markdown-source-mode-list-lift-parity.md`, `plans/markdown-source-mode-command-gaps.md` and `plans/markdown-source-mode-block-locator.md` are deleted with `git rm`, in the bookkeeping commit that starts this plan. The owner dropped the first two; the third is not needed, as the decision on the toolbar state says.[^plans-removed]

### The price: a command rewrites the whole top-level block it changes

A command writes the top-level block it changes in the standard form, all of it, as a WYSIWYG edit of that block does today. Blocks it does not change stay as written, byte for byte.[^price]

| Document | Command | Today | After |
|---|---|---|---|
| `* one` / `    * inner` / `* two`, caret in `two` | bold | `* one` / `    * inner` / `* **two**` | `* one` / `  * inner` / `* **two**` |
| `>`+tab+`foo bar` / `>`+tab+`baz`, caret in `foo` | bold | the tabs kept | `> **foo** bar` / `> baz` |
| `a &#35; b and more`, caret in `more` | bold | `a &#35; b and **more**` | `a # b and **more**` |

Where both act, the command touches more lines than today in 36.6 % of the measured cases: 34 % of the corpus cases (one extra line at the median, nine at most) and 47 % of the hand-written ones (two at the median, 13 at most). A later plan, which keeps unedited list items and table rows inside an edited block, reduces it for both surfaces alike (*Non-Goals*).

---

## Public API

No exported signature changes. Two documented behaviours change:

```typescript
class CodeEditor {
    /** Unchanged signature. The replacement is now an undo step of its own: CodeMirror's history never joins it with typing before or after it. */
    replaceRange(from: number, to: number, insert: string, selection?: { from: number; to: number }): this;
}

class MarkdownEditor {
    // Unchanged signatures. In "source" mode these now run the WYSIWYG command on the text near the selection:
    // toggleBold, toggleItalic, toggleInlineCode, toggleStrikethrough, toggleUnderline,
    // setTextColor, setFontFamily, setFontSize, toggleLink, removeLink, clearFormatting,
    // insertImage, setBlockType, toggleUnorderedList, toggleOrderedList.
}
```

Every new function below is internal: none is re-exported from `component/editor/index.ts`.

---

## Internal Structure

### `markdownCharacterReferences.ts` — the pieces of a text

```typescript
/** One piece of text as Markdown reads it: one character as written, or a character reference and what it reads as. */
export interface CharacterReferencePiece {
    /** What the piece reads as. */
    readonly shown: string;
    /** The piece's offsets in the text. */
    readonly start: number;
    readonly end:   number;
}

/**
 * Splits text into the pieces it reads as: each character as written, and each character reference that reads as
 * other characters with those characters. Joined, the pieces' `shown` are {@link decodeCharacterReferences} of the text.
 */
export function characterReferencePieces(text: string): CharacterReferencePiece[] {
    const pieces: CharacterReferencePiece[] = [];
    let at = 0;

    for (const match of text.matchAll(CHARACTER_REFERENCE)) {
        const start = match.index;
        const end = start + match[0].length;
        const shown = referencedCharacters(match[0], match[1], match[2], match[3]);

        pieces.push(...writtenPieces(text, at, start));

        // A reference that reads as itself (a name the HTML list does not hold) is written text, character by character.
        if (shown === match[0]) {
            pieces.push(...writtenPieces(text, start, end));
        } else {
            pieces.push({ shown, start, end });
        }

        at = end;
    }

    pieces.push(...writtenPieces(text, at, text.length));

    return pieces;
}
```

`writtenPieces(text, from, to)` is a private helper: one piece per UTF-16 code unit, `{ shown: text[i], start: i, end: i + 1 }`, the unit the analysis counts in.

### `markdownSourceTokens.ts` — `pushTextLeaves`

The branch for `text !== token.raw` first tries the pieces:

```typescript
    if (text !== token.raw) {
        const pieces = characterReferencePieces(token.raw);
        const readsAsPieces = pieces.map((piece) => piece.shown).join("") === text;

        if (readsAsPieces) {
            pushPieceLeaves(builder, pieces, map, position, ancestors);

            return;
        }

        // …the existing loop, every character spanning the whole token, unchanged…
    }
```

`pushPieceLeaves` pushes, for every code unit of every piece's `shown`, one leaf `{ kind: "leaf", key: \`t${unit}\`, start, end, ancestors }` with `start = map[position + piece.start]` and `end = endOf(map, position + piece.start, position + piece.end)` (`-1` for both when `map` is `null`), as the existing loops compute them.

### `markdownSerializer.ts` — where each written block lands

```typescript
/** Where one top-level block stands in a save. */
export interface WrittenBlockPlace {
    /** The block's node key. */
    readonly key:   NodeKey;
    /** The offsets of its written text in the save. */
    readonly start: number;
    readonly end:   number;
}

/** A save, with where each top-level block it writes stands in it. */
export interface MarkdownWithPlaces {
    readonly text:   string;
    readonly places: readonly WrittenBlockPlace[];
}

export function $serializeMarkdownWithPlaces(sourceMap: MarkdownSourceMap = EMPTY_SOURCE_MAP): MarkdownWithPlaces;

// Unchanged contract; now one line, so a command's save is the save.
export function $serializeMarkdown(sourceMap: MarkdownSourceMap = EMPTY_SOURCE_MAP): string {
    return $serializeMarkdownWithPlaces(sourceMap).text;
}
```

`$serializeMarkdownWithPlaces` is today's `$serializeMarkdown` body ([markdownSerializer.ts:768](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L768)) with `assembleDocument` ([:1514](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1514)) replaced by `assembleDocumentWithPlaces(blocks, load): MarkdownWithPlaces`. That function builds the same string piece by piece — `documentStart`, then for each block `separatorBefore` and the block's `text`, then `documentEnd` — and records `{ key: block.node.getKey(), start, end: start + block.text.length }` before appending each block's text. A document of no written block gives `places: []`.

### `markdownImporter.ts` — the document's top-level blocks

```typescript
/** One top-level block of a document, as a load locates it. */
export interface TopLevelBlock {
    readonly start:                number;
    readonly end:                  number;
    /** Whether the block holds link reference definitions and nothing else. */
    readonly holdsOnlyDefinitions: boolean;
}

/** A document's top-level blocks and its link reference definitions, from one lex. */
export interface TopLevelBlocks {
    readonly blocks:      readonly TopLevelBlock[];
    readonly definitions: Links;
}

export function locateTopLevelBlocks(markdown: string): TopLevelBlocks {
    const tokens = lexMarkdown(markdown);
    const blocks = locateBlocks(markdown, tokens).map((entry) => ({
        start: entry.start, end: entry.end, holdsOnlyDefinitions: holdsOnlyDefinitions(entry),
    }));

    // `lexMarkdown` returns `marked`'s token list, which carries the definitions it read.
    return { blocks, definitions: (tokens as TokensList).links };
}
```

`markdown` holds `\n` line ends only: the pass declines on a `\r` before it gets here. `TokensList` is imported as a type from `marked`.

### `markdownSourcePlaces.ts` — the walk, read both ways

The first half of `$placeOfSourceOffset` (lines 160 to 172: the analysis, the walk, `locateVerbatim` or `locateByEntries`) moves into a private `$locatedWalk(text, block, start, end): { walk: UnitWalk; analysis: SourceAnalysis; isRawBlock: boolean }`. `$placeOfSourceOffset` calls it and goes on as today. The new function:

```typescript
/** A point of a block, as Lexical names one. */
export interface BlockPoint {
    readonly node:   LexicalNode;
    readonly offset: number;
    readonly type:   "text" | "element";
}

/**
 * Where a point of a block stands in the block's Markdown: the start of the source of the first thing the block shows
 * at or after the point, else the end of the source of the last thing it shows before it. The reverse of
 * {@link $placeOfSourceOffset}.
 *
 * @returns The offset in `text`, or `null` when the block shows nothing there or that thing's source is not found.
 */
export function $sourceOffsetOfPoint(text: string, block: LexicalNode, start: number, end: number, point: BlockPoint): number | null;
```

The rule, unit by unit over `walk.units` (each unit is one shown character, line break or node):

| Point | Unit taken | Offset |
|---|---|---|
| text node `n`, offset `k`, and `n` has a unit at `k` | that unit | its `start` |
| text node `n`, offset `k` equal to its size | the last unit of `n` | its `end` |
| element `e`, offset `k`, child `k` holds a unit | the first unit inside child `k` | its `start` |
| element `e`, offset `k`, else | the last unit inside child `k − 1` | its `end` |
| anything else (an empty element, an empty text node) | none | `null` |

A unit whose `start` is `NOT_FOUND` gives `null`. The offset returned is `start + unit offset`, an offset of `text`.

### `markdownSourceModel.ts` (new) — the window and the whole-text mapping

```typescript
/** What a command imports: a stretch of the document, with the definition blocks it carries before and after it. */
export interface SourceWindow {
    /** The stretch's offsets in the document. */
    readonly start:  number;
    readonly end:    number;
    /** Definition blocks of the document before the stretch, each followed by a blank line; `""` when none. */
    readonly before: string;
    /** Definition blocks of the document after the stretch, each after a blank line; `""` when none. */
    readonly after:  string;
}

/** The whole document as a window. */
export function wholeDocumentWindow(text: string): SourceWindow;

/** The window a command over `from`–`to` imports (see *The pass imports a window*). */
export function sourceWindow(text: string, from: number, to: number): SourceWindow;

/**
 * Selects, in the tree an import of `text` just built, the range a source selection `from`–`to` covers.
 *
 * @returns `false`, selecting nothing, when the import's map does not account for every root child, or an end has no place.
 */
export function $selectSourceRange(text: string, sourceMap: MarkdownSourceMap, from: number, to: number): boolean;

/**
 * The current range selection as offsets into a save; an end with no exact offset is `null`.
 *
 * @returns `null` when the selection is not a range.
 */
export function $sourceRangeOfSelection(written: string, places: readonly WrittenBlockPlace[]): { readonly from: number | null; readonly to: number | null } | null;

/** A replacement of one range of a text. */
export interface TextChange {
    readonly from:   number;
    readonly to:     number;
    readonly insert: string;
}

/** The text between the common start and the common end of two texts, as a change of the first; `null` when they are equal. */
export function smallestEdit(before: string, after: string): TextChange | null;
```

`sourceWindow` in steps:

1. `const { blocks, definitions } = locateTopLevelBlocks(text)`. No blocks: the whole document.
2. `first` = index of the first block whose `end >= from` (the last block when none); `last` = index of the last block whose `start <= to` (the first block when none). Then `first = max(0, min(first, last) − 1)` and `last = min(blocks.length − 1, max(first, last) + 1)`.
3. `start = first === 0 ? 0 : blocks[first].start`; `end = last === blocks.length − 1 ? text.length : blocks[last].end`.
4. When `definitions` has no key, return `{ start, end, before: "", after: "" }`.
5. `before` = the text of every block before `first` whose `holdsOnlyDefinitions`, each followed by `"\n\n"`; `after` = the text of every such block after `last`, each preceded by `"\n\n"`.
6. When `JSON.stringify(lexMarkdownLinkDefinitions(before + text.slice(start, end) + after))` differs from `JSON.stringify(definitions)`, return `wholeDocumentWindow(text)`; else the window.

`$selectSourceRange` in steps: `$loadedBlockSpans(sourceMap)` gives, for each root child in order, `{ block, start, end }` with `start` beginning at `sourceMap.latest.prefix.length` and moving on by `body.length + after.length`; it returns `null` when a child has no entry of `sourceMap.latest`. The gap rule of *Where a selection end stands between blocks* picks each end's block. Each end's place is `$placeOfSourceOffset(text, offset, block, start, end)`. The selection is a new range selection whose anchor and focus are those places, typed `"text"` for a `TextNode` and `"element"` otherwise.

`$sourceRangeOfSelection` maps each of anchor and focus: the top-level block holding the point (walk up while the parent is not the root, since a `:::` column is a shadow root that `getTopLevelElement` stops at), its `WrittenBlockPlace` by key, then `$sourceOffsetOfPoint(written, block, place.start, place.end, point)`. A block with no place gives `null` for that end.

### `MarkdownEditor.ts` — the pass

```typescript
/** The model editor a source-mode command runs on, with the source map of its import. */
interface ModelEditor {
    readonly editor:    LexicalEditor;
    readonly sourceMap: MarkdownSourceMap;
    readonly release:   () => void;
}

/** What one run on the model gives: an edit of the document, nothing to do, or a window whose carried parts did not come back. */
type ModelResult = MarkdownSourceEdit | null | typeof WINDOW_LOST;

/** Returned when the definition blocks a window carried are not written back unchanged: the run is repeated on the whole document. */
const WINDOW_LOST: unique symbol = Symbol("window lost");

class MarkdownEditor {
    /** While a source-mode command runs through the model: the model editor. `null` otherwise. */
    private _commandEditor: LexicalEditor | null = null;

    private isSourceMode(): boolean {
        return this._commandEditor === null && this.getMode() === "source";
    }

    private editSourceThroughModel(command: () => unknown): boolean {
        const sourceMode = this.isSourceMode();

        if (!sourceMode) {
            return false;
        }

        const refused = this.refuseSourceEditIfReadOnly();

        if (!refused) {
            this.editThroughModel(command);
        }

        this._codeEditor.focus(true);

        return true;
    }

    private editThroughModel(command: () => unknown): void {
        const text = this._codeEditor.getValue();
        const selection = this._codeEditor.getSelection();
        // Only the cached text of a source editor not mounted yet holds one; the import rewrites it, so no offset would match.
        const holdsCarriageReturn = text.includes("\r");

        if (holdsCarriageReturn) {
            return;
        }

        const windowed = this.runOnModel(text, selection, sourceWindow(text, selection.from, selection.to), command);
        const result = windowed === WINDOW_LOST ? this.runOnModel(text, selection, wholeDocumentWindow(text), command) : windowed;

        if (result !== null && result !== WINDOW_LOST) {
            this._codeEditor.replaceRange(result.from, result.to, result.insert, result.selection);
        }
    }

    private runOnModel(text: string, selection: { from: number; to: number }, window: SourceWindow, command: () => unknown): ModelResult {
        const imported = window.before + text.slice(window.start, window.end) + window.after;
        // An offset of the imported text plus `shift` is the same offset of the document.
        const shift = window.start - window.before.length;
        const model = this.buildModelEditor(imported);

        try {
            const applies = this.selectInModel(model, imported, selection.from - shift, selection.to - shift);

            if (!applies) {
                return null;
            }

            const before = model.editor.getEditorState();

            this.runOnCommandEditor(model.editor, command);

            const changed = model.editor.getEditorState() !== before;

            return changed ? this.editOfModel(model, text, window) : null;
        } finally {
            model.release();
        }
    }
}
```

The private helpers:

- `selectInModel(model, imported, from, to): boolean` — one discrete update that calls `$selectSourceRange` and then `$selectionTouches($isMarkdownRawBlockNode)`; `true` when the selection was placed and touches no raw block.
- `runOnCommandEditor(editor, command): void` — sets `_commandEditor`, calls `command()`, and resets `_commandEditor` to `null` in a `finally`.
- `editOfModel(model, text, window): ModelResult` — reads `$serializeMarkdownWithPlaces(model.sourceMap)` and `$sourceRangeOfSelection` in one `read`; returns `WINDOW_LOST` when the save does not start with `window.before` and end with `window.after`; strips both; takes `smallestEdit(text.slice(window.start, window.end), written)`; returns `null` for no edit. Otherwise it returns the edit moved by `window.start`, with `selection` from the two mapped ends, each `end − before.length` clamped to `[0, written.length]`, an end that is `null` taking `edit.from + edit.insert.length`, the two ordered so `from <= to`, and both moved by `window.start`.
- `buildModelEditor(markdown): ModelEditor` — as `buildEditor` loads, then the settling update:

```typescript
    private buildModelEditor(markdown: string): ModelEditor {
        const editor = createEditor({ nodes: EDITOR_NODES, theme: EDITOR_THEME, onError: reportEditorError });
        const unregisterWritableStateRules = registerWritableStateRules(editor);
        let sourceMap: MarkdownSourceMap = EMPTY_SOURCE_MAP;

        editor.update(() => {
            sourceMap = $importMarkdown(markdown);
        }, { discrete: true });

        const release = mergeRegister(unregisterWritableStateRules, this.registerEditorRules(editor, null));

        // Registering a node transform marks every node of its type dirty in an update of its own, which the WYSIWYG
        // editor commits before a command can act; the model commits it here, before the selection goes in.
        editor.update(() => {}, { discrete: true });

        return { editor, sourceMap, release };
    }
```

- `registerEditorRules(editor, onCommit: (() => void) | null): () => void` — the body of `buildEditor`'s `mergeRegister(...)` from `registerTypedTextMarks(editor)` on, in today's order, with `editor.registerUpdateListener(onCommit)` in the update listener's place when `onCommit` is not `null`. `buildEditor` becomes `this._unregister = mergeRegister(unregisterWritableStateRules, this.registerEditorRules(editor, () => { this.handleChange(); this.updateSelectionState(); }))`.
- `refuseSourceEditIfReadOnly(): boolean`:

```typescript
    private refuseSourceEditIfReadOnly(): boolean {
        const readOnly = this.getReadOnly();

        if (readOnly) {
            const { from } = this._codeEditor.getSelection();

            // A read-only CodeEditor refuses any replacement with its own "readonlyedit" and wash; the editor relays the event.
            this._codeEditor.replaceRange(from, from, "");
        }

        return readOnly;
    }
```

`ensureEditor()` gains, first: `if (this._commandEditor !== null) { return this._commandEditor; }`. `refocusSurface()` gains, first: `if (this._commandEditor !== null) { return this; }`. `editSource` calls `refuseSourceEditIfReadOnly()` after its `isSourceMode()` test and skips the transform when it returns `true`.

### The corpus differential

In the new `markdown-source-mode-through-model.test.ts`. For document index `d` of `[...CORPUS, ...HAND_WRITTEN]` (line ends normalized to `\n`) and each non-blank line `k`, a caret at the line's middle runs `BLOCK[(d + k) % 6]` and `INLINE[(d + k) % 11]`; a range from the middle of line `k` to the middle of the next non-blank line runs the same two. `BLOCK` is the bulleted toggle, the numbered toggle and `setBlockType` paragraph, `h2`, quote and code; `INLINE` is bold, italic, underline, strikethrough, inline code, `toggleLink("https://example.com/x")`, `toggleLink(null)`, `removeLink`, `setTextColor("#cc0000")`, `clearFormatting` and `insertImage("/i.png", { alt: "pic" })`. Measured: 5,532 cases in 27 seconds, zero differences.

Each case:

1. Builds a WYSIWYG editor of the document, places the selection with `$selectSourceRange(doc, sourceMapOf(editor), from, to)` inside an update, and notes whether it was placed and whether it touches a raw block.
2. Runs the command there and in a source-mode editor of the same document whose `getSelection` returns `from`–`to`, with a spy on `replaceRange`.
3. Not placed, or touching a raw block: the source text is the document and `replaceRange` was not called.
4. Otherwise: the two values are equal, `replaceRange` was called at most once, and when it was, the source caret, read back into a WYSIWYG editor of the result with `$selectSourceRange`, stands on the same character of the root's text as the WYSIWYG caret — unless an end of the WYSIWYG caret has no exact offset in its own save (`$sourceRangeOfSelection` gives `null` for it).
5. Disposes both editors.

---

## Ordered Implementation Steps

1. **Bookkeeping.** `git rm plans/markdown-source-mode-list-lift-parity.md plans/markdown-source-mode-command-gaps.md plans/markdown-source-mode-block-locator.md`, in the commit that moves this plan to `plans/in-progress/`. Check: `ls plans/markdown-source-mode-*.md` lists none of the three.
2. **`CodeEditor.replaceRange` is an undo step of its own.** In [CodeEditor.ts:929](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L929) add `annotations: isolateHistory.of("full")` to the dispatched transaction (import `isolateHistory` from `@codemirror/commands`, line 26), and one sentence to its JSDoc: the replacement is an undo step of its own, never joined with typing before or after it. Write the rows of *Expected Behaviour* group 1 in the new `markdown-editor-source-mode-mounted.test.ts` first; rows 1.1 and 1.2 fail before the change. Docs: [CodeEditor.md:392](../packages/lib/docs/components/CodeEditor.md) gets "never joined with the typing before or after it" after "(one undo step)"; the changelog entry of *Documentation Impact*.
3. **Character-reference pieces.** Add `CharacterReferencePiece` and `characterReferencePieces` to `markdownCharacterReferences.ts` (*Internal Structure*), with rows in `tests/component/display/markdownCharacterReferences.test.ts` (group 2). Check: for every corpus document's text tokens, `characterReferencePieces(raw).map((p) => p.shown).join("") === decodeCharacterReferences(raw)` (a row).
4. **The analysis uses them.** Change `pushTextLeaves` and add `pushPieceLeaves` in `markdownSourceTokens.ts`. In `markdown-source-places.test.ts`: remove `holdsCharacterReference` and its comment from `SP10`'s `isKnown` (its count of confirmed places rises from about 17,700 to 19,089; keep `toBeGreaterThan(15_000)`), and add the rows of group 2. Update the fallback list in `$placeOfSourceOffset`'s JSDoc ([markdownSourcePlaces.ts:136](../packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts#L136)): replace "; a list item's text that begins as a link reference definition repeating a label, which the lexer drops; and text holding a character reference such as `&#35;`, which the lexer decodes." with "; and a list item's text that begins as a link reference definition repeating a label, which the lexer drops." Add the WYSIWYG row 2.8 to `markdown-editor-command-crashes.test.ts`, beside the rows on the caret after an edit inside one raw block (the rows titled `TP1` to `TP9`). Check: `npx vitest run --maxWorkers=2 tests/component/markdown-source-places.test.ts tests/component/markdown-source-edits.test.ts tests/component/markdown-editor-command-crashes.test.ts` passes.
5. **Written places.** Add `WrittenBlockPlace`, `MarkdownWithPlaces`, `$serializeMarkdownWithPlaces` and `assembleDocumentWithPlaces`; make `$serializeMarkdown` call it; delete `assembleDocument`. Check: `grep -n "assembleDocument(" markdownSerializer.ts` — no match; the serializer and source-preservation suites pass unchanged.
6. **Top-level blocks.** Add `TopLevelBlock`, `TopLevelBlocks` and `locateTopLevelBlocks` to `markdownImporter.ts`.
7. **The reverse walk.** Extract `$locatedWalk`; add `BlockPoint` and `$sourceOffsetOfPoint` to `markdownSourcePlaces.ts`, with the rows of group 3 in `markdown-source-places.test.ts`. Check: the existing `SP` rows pass unchanged.
8. **The model module.** Create `markdownSourceModel.ts` with `SourceWindow`, `TextChange`, `wholeDocumentWindow`, `sourceWindow`, `$selectSourceRange`, `$sourceRangeOfSelection`, `smallestEdit` and the private helpers. Rows of group 4 in the new `markdown-source-mode-through-model.test.ts`.
9. **The pass.** In `MarkdownEditor.ts`: extract `registerEditorRules` from `buildEditor`; add `_commandEditor`, the `isSourceMode`, `ensureEditor` and `refocusSurface` changes, `ModelEditor`, `ModelResult`, `WINDOW_LOST`, `editSourceThroughModel`, `editThroughModel`, `runOnModel`, `selectInModel`, `runOnCommandEditor`, `editOfModel`, `buildModelEditor` and `refuseSourceEditIfReadOnly`; add the read-only refusal to `editSource`. Check: `npm run typecheck`.
10. **Rewire the thirteen entry points.** Replace `this.editSource(X)` with `this.editSourceThroughModel(() => this.<same call>)` at: `toggleBold` (:8268), `toggleItalic` (:8293), `toggleInlineCode` (:8317), `toggleStrikethrough` (:8342), `toggleUnderline` (:8366), `patchSelectionStyle` (:8398, `() => this.patchSelectionStyle(patch)`), `toggleUnorderedList` (:8517), `toggleOrderedList` (:8551), `toggleLink` (:8587, `() => this.toggleLink(url)`), `removeLink` (:8666), `clearFormatting` (:8715), `setBlockType` (:8926, `() => this.setBlockType(type)`), `insertImage` (:9249, `() => this.insertImage(src, options)`, after its `altHoldsBracket` test as now). Leave `insertParagraphBeforeBlock` (:9100), `insertParagraphAfterBlock` (:9128) and `insertTable` (:9171) on `editSource`. Check: `grep -c "this.editSource(" MarkdownEditor.ts` gives 3; `grep -c "this.editSourceThroughModel(" MarkdownEditor.ts` gives 13.
11. **Delete the replaced transforms.** Delete `sourceTransformForBlockType` (:405), and trim the two import statements at :97–104 to `readSourceSelectionState`, the type `MarkdownSourceTransform`, `paragraphAroundBlockSource` and `tableSource`. In `markdownSourceLines.ts` delete every top-level declaration that neither `tableSource` nor `paragraphAroundBlockSource` reaches, with its JSDoc (`blockPrefixSource`, `FENCED_CODE_SOURCE`, `listSource` and 64 more, 1,470 lines). In `markdownSourceEdits.ts` delete every declaration that neither `readSourceSelectionState` nor the types `MarkdownSourceEdit`, `MarkdownSourceTransform` and `MarkdownSourceSelectionState` reach (88 declarations, 1,840 lines). In `markdownSourceTokens.ts` delete `withMark` (:353–363). Then remove imports left unused. Check: `npm run lint` reports no unused symbol; `grep -rn "BOLD_SOURCE\|blockPrefixSource\|listSource\|FENCED_CODE_SOURCE\|spanStyleSource\|imageSource\|linkSource" packages/lib/src` gives no match.
12. **Tests of the deleted transforms.** In `markdown-source-edits.test.ts` delete every row whose body calls a deleted transform and none of `readSourceSelectionState`, `tableSource`, `paragraphAroundBlockSource` (223 rows), and describes left empty. Of the 7 rows that call both: delete the five toggle rows of *toggling a format off removes it from the whole selection* (lines 211, 222, 239, 260, 282); in *reads a destination holding parentheses and link text holding brackets* (:1933) keep only the two `readSourceSelectionState` assertions; in the `TB22`/`TB23` `it.each` (:2136) keep only the `readSourceSelectionState` assertion, with `bold` the row's literal expected text. Remove the deleted names from the imports. In `markdown-source-places.test.ts`, `SP20` keeps its places half and loses its bold half (the `for (const word …)` loop) and the `BOLD_SOURCE` import.
13. **The parity harness.** In `markdown-editor.test.ts` (describe *list toggles in a list of their kind*, :1067–1511): replace `ParityRow` with `[id, doc, from, to, command, result]`; build `PARITY` from the `SAME` rows and the `DIFFERS` rows not listed in `RAW_DECLINES`, each with its `wysiwyg` column as `result`; build `RAW_DECLINES` from the 10 rows of *The parity harness becomes …* with their `wysiwyg` column. Replace the two `for` loops with the two tests of group 6. Replace the `E25`/`E26` `it.each` (:1489) with the two `PARITY` rows of 6.3, ids `E25` and `E26`, and restate the two raw-list `it`s (:1495, :1504) as 6.4 gives. Delete the *source mode takes the same items out of the same lists* `it` at :1042, which the differential and group 6 cover.
14. **The other source-mode rows of `markdown-editor.test.ts`.** Restate as group 7 gives: the wiring rows (:2577), the styled-span row (:2742), the nine `CASES` rows of the two "read the viewer's" describes (:2918, :3001), and the fence row (:3082).
15. **The new rows.** Write groups 4, 5 and 8 in `markdown-source-mode-through-model.test.ts`, and the mounted rows of group 5 in `markdown-editor-source-mode-mounted.test.ts`. Write the differential (group 9).
16. **JSDoc.** Replace the "In `"source"` mode, …" paragraph of the JSDoc of each of the thirteen entry points (`patchSelectionStyle` included, :8383) and of `setTextColor`, `setFontFamily` and `setFontSize` (:8430, :8454, :8478), with: "In `"source"` mode, runs this command on the Markdown around the selection as on the WYSIWYG surface and writes back the text it changes; no-op where the selection touches a raw Markdown block. See *Source / WYSIWYG mode* in the component docs." Check: `grep -n 'In `"source"` mode' MarkdownEditor.ts` shows only the JSDoc of `getSelectionState`, `copy`, `cut`, `paste`, `insertParagraphBeforeBlock`, `insertParagraphAfterBlock` and `insertTable`.
17. **Docs and changelog**, as *Documentation Impact* gives.
18. **Checks.** *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Delete | `plans/markdown-source-mode-list-lift-parity.md` |
| Delete | `plans/markdown-source-mode-command-gaps.md` |
| Delete | `plans/markdown-source-mode-block-locator.md` |
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownCharacterReferences.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceTokens.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownImporter.ts` |
| Create | `packages/lib/src/typescript/lib/component/editor/markdownSourceModel.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts` |
| Modify | `packages/lib/tests/component/display/markdownCharacterReferences.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-places.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-edits.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-command-crashes.test.ts` |
| Create | `packages/lib/tests/component/markdown-source-mode-through-model.test.ts` |
| Create | `packages/lib/tests/component/markdown-editor-source-mode-mounted.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Each case is derived from the contract: a source-mode command gives the document and the caret the WYSIWYG command gives for the same selection, but for the raw-block and no-place declines and the commands that stay text surgery. The numbers are references inside this plan only: each test's title says what it tests (*bold at a caret in a word wraps the word, and the caret selects it*), never a number. "Offline" means a unit test under the modelled DOM; "mounted" means a jsdom test with a real CodeMirror view; "manual" means a browser check.

### 1. `CodeEditor.replaceRange` and undo (mounted)

| # | Steps | Expected |
|---|---|---|
| 1.1 | A mounted `CodeEditor` holding `hello world`; type `x` at 5 (a transaction with `userEvent: "input.type"`); at once, with the caret at 6, `replaceRange(0, 6, "**hellox**", { from: 2, to: 8 })` | one undo gives `hellox world`; a second gives `hello world`; two redos give `**hellox** world` |
| 1.2 | A source-mode `MarkdownEditor` holding `hello world` / (blank) / `next`, mounted; type `x` at 5; at once `toggleBold()` | `**hellox** world …`; one undo gives `hellox world …` with the caret at 6 |
| 1.3 | Same, with `setBlockType("h2")` and with `toggleUnorderedList()` | `## hellox world …` and `- hellox world …`; one undo gives `hellox world …` |
| 1.4 | A `CodeEditor`: `replaceRange` twice in a row | two undo steps |
| 1.5 | A mounted source-mode `MarkdownEditor` with `"change"` and `"selectionstate"` listeners: `toggleBold()` at a caret in a word | `"change"` once; `"selectionstate"` at most once |

### 2. Character references (offline)

| # | Input | Expected |
|---|---|---|
| 2.1 | `characterReferencePieces("a&#35;b")` | `[{a,0,1}, {#,1,6}, {b,6,7}]` |
| 2.2 | `characterReferencePieces("&notaname;")` | ten pieces, one per character |
| 2.3 | `characterReferencePieces("x &ngE; y")` | the reference is one piece whose `shown` is two code units, 2–7 |
| 2.4 | `characterReferencePieces(text)` joined, for every text token `raw` of the round-trip corpus | `decodeCharacterReferences(raw)` |
| 2.5 | `$placeOfSourceOffset` in `a &#35; b and more` at the offset before `more` | the text node, before `m` (today `null`) |
| 2.6 | `$placeOfSourceOffset` in `more &amp; less` at the offset after `&amp;` | after `&` in the text node |
| 2.7 | `$placeOfSourceOffset` in `a &#35; b` at an offset inside `&#35;` | before `#`: inside the source of one thing shown whole |
| 2.8 | WYSIWYG: `> a &#35; bc w` / `> - x` / (blank) / `after`; select in the raw block from after `b` to before `x` and remove the text | the save is `> a # bx` / (blank) / `after`; the block is a quote; the caret is at offset 5 of `a # bx`, between `b` and `x` (today 6, the block's end) |

### 3. The reverse walk (offline)

| # | Block written as, point | Expected offset |
|---|---|---|
| 3.1 | `a **bc** d`, text `bc` at 0 | 4 |
| 3.2 | same, `bc` at 2 | 6 |
| 3.3 | same, ` d` at 0 | 8 |
| 3.4 | `a \* b`, text `a * b` at 2 | 2 |
| 3.5 | `a &#35; b`, the text at 2 | 2 |
| 3.6 | `- one` / `- two`, the list at element offset 1 | 8: the start of `two` |
| 3.7 | an empty paragraph, at element offset 0 | `null` |
| 3.8 | every corpus block, every offset with a place: `$sourceOffsetOfPoint` of `$placeOfSourceOffset(offset)` | an offset whose own place is the same place |

### 4. The window and the mapping (offline)

| # | Input | Expected |
|---|---|---|
| 4.1 | `sourceWindow` of `# h` / (blank) / `para` / (blank) / `- a` / (blank) / `> q` / (blank) / `end`, caret in `a` | `start` at `para`, `end` at the end of `> q`, `before` and `after` `""` |
| 4.2 | same, caret in `h` | `start` 0, `end` at the end of `para` |
| 4.3 | same, from `para` to `q` | the whole document |
| 4.4 | `see [a][1] here` / `mid` / `more` / `end` / `[1]: /one` (blank lines between), caret in `here` | `start` 0, `end` at the end of `mid`, `after` = `"\n\n[1]: /one"` |
| 4.5 | `[1]: /one` / `mid` / `more` / `end` / `see [a][1] here`, caret in `here` | `before` = `"[1]: /one\n\n"` |
| 4.6 | `- a` / (blank) / `  [x]: /u` / (blank) / `mid` / (blank) / `more` / (blank) / `b [x] c`, caret in `c` | the whole document: the composed text defines no `x` |
| 4.7 | `smallestEdit("a b c", "a **b** c")` | `{ from: 2, to: 3, insert: "**b**" }`: the common start is `a `, the common end ` c` |
| 4.8 | `$selectSourceRange` over `one` / (blank) / `two` at 4, collapsed | `false` |
| 4.9 | same, 0 to 4 | `true`; the range covers `one` |

### 5. The pass (offline unless marked)

| # | Source document, selection | Command | Expected text, selection after |
|---|---|---|---|
| 5.1 | `hello world`, 8 | bold | `hello **world**`, 8–13 |
| 5.2 | `hello world`, 6–11 | bold | `hello **world**`, 8–13 |
| 5.3 | `one` / (blank) / `two`, 1 | `h2` | `## one` / (blank) / `two`, 4 |
| 5.4 | `- one` / (blank) / `  second` / (blank) / `- two`, 10 | bulleted toggle | `- one` / (blank) / `- second` / (blank) / `- two`, 10 |
| 5.5 | `see docs here`, 6 | `toggleLink("https://example.com/x")` | `see [docs](https://example.com/x) here`, 5–9 |
| 5.6 | `a word b`, 3 | `setTextColor("#cc0000")` | `a [word]{color=#cc0000} b`, 3–7 |
| 5.7 | `a **bold** b`, 5 | `clearFormatting` | `a bold b`, 3 |
| 5.8 | `ab cd`, 1 | `insertImage("/i.png", { alt: "pic" })` | `a![pic](/i.png)b cd`, 15 |
| 5.9 | `a [x](/u) b`, 4 | `toggleLink(null)` and `removeLink()` | `a x b` |
| 5.10 | `a bc d`, 3 | inline code | `` a `bc` d ``, 3–5 |
| 5.11 | `one`, 1 | numbered toggle | `1. one`, 4 |
| 5.12 | `one` / `two`, 1 | quote | `> one` / `> two` |
| 5.13 | `one` / (blank) / `two`, 1–6 | code | `` ``` `` / `one` / `` ``` `` / (blank) / `` ``` `` / `two` / `` ``` `` |
| 5.14 | `` ``` `` / `code` / `` ``` ``, 6 | paragraph | `code`, 2 |
| 5.15 | `* one` / `    * inner` / `* two`, 21 | bold | `* one` / `  * inner` / `* **two**` (the price) |
| 5.16 | `>`+tab+`foo bar` / `>`+tab+`baz`, 3 | bold | `> **foo** bar` / `> baz` |
| 5.17 | `a &#35; b and more`, 16 | bold | `a # b and **more**`, 12–16 |
| 5.18 | `see [a][1] here` / `mid` / `more` / `end` / `[1]: /one`, 12 | bold | `see [a][1] **here**`, the rest unchanged, 13–17 |
| 5.19 | `- one` / tab + `two`, 8 | bulleted toggle | `one` / `two` (today `- one` / `- two`) |
| 5.20 | `- a` / tab + `- b c`, 7 | bold | `- a` / `  - **b** c` |
| 5.21 | `\n\n 1.\t</pre>\n \t  >\t#\th\n`, 7 | bulleted toggle | unchanged, in under a second (today the toggle runs for more than 100 s) |
| 5.22 | `hello world`, 8, a spy on `replaceRange` | bold | `replaceRange` called once, as `(6, 11, "**world**", { from: 8, to: 13 })`: the common start is `hello `, and the texts end differently |
| 5.23 | `hello world`, 8 | bold | the WYSIWYG editor (`_editor`) is still not built |

Declines — the text, the selection and the history stay; no `"change"`; `replaceRange` is not called; focus goes back to the source editor:

| # | Source document, selection | Command | Why |
|---|---|---|---|
| 5.24 | `> - one` / `> - two`, 5 | bulleted and numbered toggles | the selection touches a raw block |
| 5.25 | `one` / (blank) / `---` / (blank) / `two`, 1–11 | bulleted toggle | the same |
| 5.26 | `<div>x</div>` / (blank) / `two`, 6 | bulleted toggle | the same |
| 5.27 | `one` / (blank) / `two`, 4 | bold | a caret on a blank line has no place |
| 5.28 | `` ``` `` / `code` / `` ``` ``, 6 | bold | the WYSIWYG command declines in a code block |
| 5.29 | `hello world`, 0–11 | `setBlockType("paragraph")` | the WYSIWYG command changes nothing |
| 5.30 | `one\r\ntwo` before the view mounts, 1 | bold | the text holds a carriage return |
| 5.31 | `> a` / tab + `- -` / `b`, 3 | bold | no place: the walk does not find the source there |

Read-only (offline):

| # | Read-only source document | Command | Expected |
|---|---|---|---|
| 5.32 | `hello` | bold | `hello`; `"readonlyedit"` once; the `MarkdownEditor`'s own wash not played; no model built (spy on `$importMarkdown` not called) |
| 5.33 | `` ``` `` / `x` / `` ``` `` | bold | `"readonlyedit"` once (today none) |
| 5.34 | `hello` | `setBlockType("paragraph")` | `"readonlyedit"` once (today none) |
| 5.35 | `> q` | `insertParagraphBeforeBlock()` | `"readonlyedit"` once |

Cost (offline, counts as in `markdown-editor-large-document-costs.test.ts`):

| # | Document | Command | Expected |
|---|---|---|---|
| 5.36 | 2,000 mixed blocks, caret in the middle | bold | counted from just before the call: `lexMarkdown` is called once with the whole document's text |
| 5.37 | same | bold, `h2`, bulleted toggle | `$importMarkdown` receives a text no longer than the three blocks around the caret |

Manual (browser, the demo's MD Editor page in source mode): bold, a heading, a list toggle and a link at a caret, each then Ctrl+Z once: the command alone is undone and the caret is where it was; typing then Ctrl+B at once, then Ctrl+Z: only the bold goes; in a read-only editor, the toolbar's bold flashes the source surface once.

### 6. The parity harness (offline)

| # | Test | Expected |
|---|---|---|
| 6.1 | each of the 294 `PARITY` rows | the WYSIWYG command gives `result`; `editorOf(result).getValue()` is `result`; the surface model equals `viewerModel(result).blocks`; when `result` is not the document, one undo gives the document back; source mode gives `result`; when source mode dispatched an edit, its caret, read back into a WYSIWYG editor of `result`, stands on the same character of the root's text as the WYSIWYG caret |
| 6.2 | each of the 10 `RAW_DECLINES` rows | the WYSIWYG command gives the pinned result; source mode leaves the document unchanged |
| 6.3 | the rows `E25` (`- one` / (blank) / tab + `second` / `- two`, caret in `second`) and `E26` (`- one` / tab + `- nested` / `- two`, caret in `nested`), bulleted toggle, as `PARITY` rows | `- one` / (blank) / `- second` / (blank) / `- two`, and `- one` / (blank) / `nested` / (blank) / `- two` |
| 6.4 | the two `it`s *a new item beside a list kept as a raw block joins that list in source mode alone* (`- ## Foo` / `  - inner` / (blank) / `para`, caret in `para`, bulleted toggle) and *a list kept as a raw block leaves its item with the item's text on the WYSIWYG surface alone* (`1. one` / (blank) / `   - ## Foo` / `     - inner` / (blank) / `2. two`, caret in `one`, numbered toggle), renamed to drop "in source mode alone" and "on the WYSIWYG surface alone" | both surfaces give `- ## Foo` / `  - inner` / (blank) / `* para`, and `one` / (blank) / `- ## Foo` / `  - inner` / (blank) / `1. two`; no surface check, since the result still holds a raw block the editor shows as text and the viewer as a list |

### 7. Restated rows of `markdown-editor.test.ts` (offline)

The rows that pin today's source-mode spelling now expect the WYSIWYG result:

| Row | Expected now |
|---|---|
| wiring: `toggleUnorderedList` on `a` / `b`, 0–3 | `changes` `{ from: 0, to: 2, insert: "- a\n  " }`: the result `- a` / `  b` |
| wiring: `toggleOrderedList` on `a` / `b`, 0–3 | `changes` `{ from: 0, to: 2, insert: "1. a\n   " }` |
| styled spans: *a second attribute merges into the span rather than nesting inside it* | the value it asserts stays; the dispatched change is the smallest edit between the two texts, computed in the row with `smallestEdit` |
| *C1: colour cutting an underscore run declines* | renamed *colour over the end of an underscore run splits it*; result `*hello* [*world* again]{color=#cc0000}` |
| *F13: bold inside an email autolink declines* | renamed *bold inside an email autolink makes it an inline link*; result `[m@**x**.y](mailto:m@x.y)` |
| *F13: a link inside an autolink re-points it instead of nesting* | result `[https\://a.b](https://n)` |
| *a heading from a list item keeps the item's indented content in the item* | renamed *a heading from a list item takes the item's indented content along*; result `## a` / (blank) / `b` |
| *a quote from a list item keeps its nested list in the item* | result `> a` / (blank) / `- - b` / `- c` |
| *a code block from a list item keeps the item's indented content in the item* | renamed as the heading row; result `` ``` `` / `a` / `` ``` `` / (blank) / `b` |
| *a list toggle declines over a tab-indented block of the item* | renamed *a list toggle over a tab-indented block of the item takes it out*; result `one` / (blank) / `second` / (blank) / `- two` |
| *a task marker stays with the first line of its item's text* | result `1. [ ] one` / `   more` / (blank) / `- two` |
| *a heading acts on the line after a fence closed inside a nested quote* | result `> > ` + three backticks / `> > a` / `> > ` + three backticks / (blank) / `## b` |

### 8. Registration and settling (offline)

| # | Test | Expected |
|---|---|---|
| 8.1 | `- a` / (blank) / tab + `[x]: /u "t` / (blank) / tab + `u"` / (blank) / `b [x] c`, caret at 26 (between `[` and `x`), bold, source mode and WYSIWYG at the same place | both `- a` / … / `b **[x][x]** c` (without the settling update, source mode leaves the text unchanged) |
| 8.2 | an offline source-mode editor with `"change"` and `"selectionstate"` listeners, `toggleBold()`, `setBlockType("h2")` and the bulleted toggle | neither listener is called: offline the source editor reports no change, so a call could only come from the model |

### 9. The differential (offline)

As *Internal Structure: The corpus differential* gives: zero cases outside the two declines.

---

## Verification

From `packages/lib`, one Vitest process at a time with `--maxWorkers=2`:

1. `npm run typecheck`, `npm run typecheck:test`, `npm run lint`: clean.
2. The step checks of *Ordered Implementation Steps* (the greps of steps 5, 10, 11 and 16).
3. `npx vitest run --maxWorkers=2 tests/component/markdown-source-mode-through-model.test.ts tests/component/markdown-editor-source-mode-mounted.test.ts tests/component/markdown-editor.test.ts tests/component/markdown-source-places.test.ts tests/component/markdown-source-edits.test.ts tests/component/display/markdownCharacterReferences.test.ts`: every row of *Expected Behaviour* passes.
4. Before the code of steps 9 and 10, the rows whose expected text differs from today's source-mode result fail: 5.15, 5.16, 5.17, 5.19, 5.24, 5.25, 5.33, 5.34, 6.3 and the restated rows of group 7. Rows that today's text surgery happens to meet (5.1, for one) pass before and after.
5. Every Markdown suite: `npx vitest run --maxWorkers=2 tests/component/markdown-* tests/component/display/markdown* tests/component/code-editor-read-only-mounted.test.ts` passes (12,691 tests on the base, plus the new rows, minus the deleted ones).
6. The full suite: `npm test`.
7. Timing, not a test: run the timing probe of *Addendum: Measurements* (a source-mode editor of each document, the caret in the middle, three runs, medians) and compare with the targets of *Performance targets*.
8. `npm run docs:api` (no warning), `npm run docs:llms:check`, `npm run build:lib`.
9. Manual: the checks at the end of group 5.

---

## Documentation Impact

No public symbol is added, renamed or removed, so no API page or catalog entry changes.

`docs/components/MarkdownEditor.md`:

- Line 143: replace the sentence listing what edits the raw Markdown with: "In `"source"` mode, `cut`/`copy`/`paste` go to the source editor, and these run the WYSIWYG command on the Markdown around the selection: the five format toggles, `toggleLink`/`removeLink`, `clearFormatting`, `setTextColor`/`setFontFamily`/`setFontSize`, `insertImage`, `setBlockType` and `toggleUnorderedList`/`toggleOrderedList`; `insertTable` and `insertParagraphBeforeBlock`/`insertParagraphAfterBlock` edit the raw Markdown directly." Keep the sentence about the other eleven.
- Lines 251–257: keep the first sentence up to "reports `bold`"; replace the rest with "and pressing that format's toggle then does what it does on the WYSIWYG surface."
- Lines 294–304 and 308: replace the six paragraphs with:

  > Source mode runs the WYSIWYG command for the commands listed at the end of the [command API](#command-api): it reads the Markdown around the selection — the top-level blocks the selection touches and one on each side, with the document's link reference definitions — into the editor's own document, runs the command there as on the WYSIWYG surface, and writes back only the text that changed, leaving the selection where the WYSIWYG command leaves it. The result is the document the WYSIWYG command saves for the same selection, and the command is one undo step of the source editor.
  >
  > Two things follow. A command writes the whole top-level block it changes in the form the editor saves — every item of a list with `-` and two-space nesting, `__bold__` as `**bold**`, a tab in the indentation as spaces, a character reference as its character where the save needs no reference — as a WYSIWYG edit of that block does; the blocks around it stay as written. And a command does nothing where the WYSIWYG surface holds the text as a raw Markdown block (see [Kept as source](#kept-as-source)): the WYSIWYG command would write that block's text escaped (`- \> - one`). A command also does nothing with the caret on a blank line between blocks, and where the editor does not find the source of what a block shows beside the selection: a code line or an HTML line whose container prefix holds a tab, a paragraph line made of list markers and tabs, a task item's checkbox followed by more than one space in a list with blank lines between its items, and a list item's text that begins as a link reference definition repeated before it.
  >
  > `insertTable` and the paragraph commands edit the raw text directly: `insertTable` goes above the whole block holding the caret — a paragraph, an HTML block or a table, never inside one — and the paragraph commands step out of the top-level quote, list, table or code block around the caret.

- Line 306 (tabs) stays.
- Line 84: replace ", text of a list item that begins as a link reference definition repeated before it does, or a character reference such as `&#35;`, which shows as the character it stands for." with ", or text of a list item that begins as a link reference definition repeated before it does."
- Line 333: replace "there too the undo and redo keys are quiet, as are the line commands," with "there too the undo and redo keys are quiet, every editing command called on the editor is refused once, as on the WYSIWYG surface,".

`docs/components/CodeEditor.md` line 392: "in one transaction (one undo step, never joined with the typing before or after it)".

`docs/reference/changelog/next.md`:

- *Changed → Components*, a new entry: "**`MarkdownEditor`'s source-mode commands give the WYSIWYG result.** The format toggles, `toggleLink`, `removeLink`, `clearFormatting`, the style setters, `insertImage`, `setBlockType` and the list toggles now run the WYSIWYG command on the Markdown around the selection and write back the text it changes, so both surfaces give the same document for the same selection. A command writes the top-level block it changes in the editor's own form, as a WYSIWYG edit does (`* one` / `    * inner` with `two` bolded saves `  * inner`); a command on text the WYSIWYG surface keeps as a raw Markdown block does nothing, where source mode converted some of those lines before (`> - one`). A read-only editor refuses every one of these commands with `"readonlyedit"`, also where the command would have done nothing. No consumer action is needed."
- *Fixed → Components*: "**`CodeEditor.replaceRange()` is its own undo step.** A replacement made right after typing, with the caret where typing left it, joined the typing's undo step, so one undo took both back. No consumer action is needed."
- *Fixed → Components*: "**`MarkdownEditor` keeps the caret's place beside a character reference.** After an edit made a raw Markdown block show as its blocks, the caret went to the block's end when the block held a character reference such as `&#35;`. It now stays where it was. No consumer action is needed." And in the existing entry at lines 1381–1385, replace "text of a list item that begins as a link reference definition repeated before it does, or a character reference such as `&#35;`, which shows as the character it stands for." with "or text of a list item that begins as a link reference definition repeated before it does."

`llms.txt` needs no change: its `MarkdownEditor` line names no command.

---

## Potential Challenges

- **A command path that reads `this._editor` directly would act on the hidden WYSIWYG editor.** The thirteen paths read it only through `ensureEditor`, `commandApplies`, `declinesInTextOnlyBlock` and `refuseIfReadOnly` today; review any new command path for a direct `_editor` read.
- **Something calling `updateSelectionState` during a pass would report the WYSIWYG state.** Nothing does today: the model registers no update listener (`onCommit` is `null`), and `commandApplies` reports nothing.
- **The registration list drifts between the two editors.** It cannot: both call `registerEditorRules`. Add a new rule there, not to `buildEditor`.
- **`lexMarkdown`'s declared type has no `links`.** Cast to `marked`'s `TokensList`, which is what `Marked.lexer` returns.
- **A long list is one top-level block**, so its window is the whole list: about 0.3 s at 2,000 items and 1.4 s at 8,000, the WYSIWYG surface's own cost for that list.
- **The differential holds editors in memory.** Dispose both editors of every case; a run that keeps them crashes its worker at about 25,000 cases.

---

## Critical Files

- [MarkdownEditor.ts:7432](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7432) `editSource`, the source-mode command seam this plan extends, and [:9762](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L9762) `buildEditor`, whose loading order and registrations the model editor shares.
- [markdownSourcePlaces.ts:157](../packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts#L157) `$placeOfSourceOffset` and its caller [markdownWritable.ts:1222](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1222) `$selectCaretPlace`: the precedent for placing a source offset in a loaded block; [:227](../packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts#L227) `definitionLines`, the precedent for carrying definitions with a part of a document.
- [markdownSourceTokens.ts:1109](../packages/lib/src/typescript/lib/component/editor/markdownSourceTokens.ts#L1109) `pushTextLeaves`.
- [markdownCharacterReferences.ts:46](../packages/lib/src/typescript/lib/component/display/markdownCharacterReferences.ts#L46) `referencedCharacters` and `decodeCharacterReferences` (:66).
- [markdownImporter.ts:233](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L233) `$importMarkdown`, :402 `$recordSourceMap`, :467 `locateBlocks`, :578 `holdsOnlyDefinitions`.
- [markdownSerializer.ts:768](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L768) `$serializeMarkdown`, :1514 `assembleDocument`, :1821–1870 `separatorBefore`, `documentStart`, `documentEnd`.
- [CodeEditor.ts:929](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L929) `replaceRange`.
- `tests/component/markdown-editor-large-document-costs.test.ts`, the precedent for counting work with `vi.mock` spies; `tests/component/code-editor-read-only-mounted.test.ts`, the precedent for mounting a real view (`mountInto`).
- `plans/research/markdown-source-mode-shared-model.md` (main tree, untracked) and its prototype in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/research/source-mode-shared-model/`.

---

## Non-Goals

- **Keeping unedited list items and table rows inside an edited block.** That reduces the price for both surfaces alike and is a plan of its own, after this one (`plans/research/markdown-source-preserving-model.md` measured a 48 % cut in rewritten lines).
- **Running `insertTable` and the paragraph inserts through the model.** Through the model `insertTable` splits a paragraph mid-word and the paragraph inserts never change the text; they stay text surgery by the owner's decision.
- **Typing, highlighting and the toolbar state through the model.** They run per keystroke or per caret move; they stay as they are.
- **Finding the source of the remaining no-place shapes** (a tab in a code line's container prefix, a marker-and-tab paragraph line, a checkbox with two spaces in a loose list, a repeated definition in an item's text). A command there declines; each is a change to the analysis of its own.
- **Predicting declines in the `can…` fields.** In source mode they stay `true`, as today.

---

## Addendum: Measurements

All on a private copy of `7cdd0d1f0` with a prototype of this plan; probes and outputs in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans6/through-model/` (`probes/`, `out/`, `PROGRESS.md`).

**The parity harness.** 302 rows. Through the model: all 162 `SAME` and 129 `DIFFERS` rows give the WYSIWYG bytes, and the caret stands on the same shown character in all 291. Ten `DIFFERS` rows touch a raw block and decline; today's source mode acts on eight of them (`Q1`, `Q2` twice each, `E9`, `E22` twice, `E23`) and declines on two (`E8`, `E11`). One (`E4` paragraph) changes nothing on either surface.

**The corpus differential.** 605 documents (the 579 of the round-trip corpus and 26 hand-written ones in forms the editor does not save in), a caret at the middle of every non-blank line for 17 commands and a range between consecutive lines for six: 35,153 cases.

| | Cases |
|---|---|
| the selection has a place and touches no raw block | 20,855 |
| … source mode through the model equals the WYSIWYG save, byte for byte | **20,855** |
| the selection touches a raw block: declines | 13,576 (today's source mode acts in 1,625; the WYSIWYG command in 5,266) |
| no place: declines | 722 (today acts in 106) |
| a thrown error, on any surface | 0 |
| an edit whose caret stands on the WYSIWYG caret's character | 13,755 of 13,840; the other 85 have the WYSIWYG caret in text the save does not write |

Before the character-reference pieces, 1,104 cases had no place, today acting in 243.

**The price.** Where both today's source mode and the pass act (8,009 cases), the pass touches more lines in 2,935 (36.6 %): corpus 34 %, one extra line at the median and nine at most; hand-written 47 %, two at the median and 13 at most (a 12-line `*` list nested four spaces deep). Inline commands alone: 28 % and 31 %. Where only today acts (1,909): a raw block 1,625, no place 106, the WYSIWYG command does nothing 178 (an image or a link into a code block, a heading on a setext underline). Where only the pass acts: 5,805.

**Speed**, medians of three, milliseconds, today / through the model (window) / through the model (whole document):

| Document | Characters | Bulleted toggle | `h2` | Bold | Link |
|---|---|---|---|---|---|
| mixed, 500 blocks | 16,808 | 17 / 6 / 219 | 17 / 5 / 195 | 11 / 6 / 178 | 13 / 5 / 172 |
| mixed, 2,000 | 68,971 | 64 / 13 / 765 | 79 / 14 / 724 | 48 / 16 / 725 | 48 / 13 / 689 |
| mixed, 8,000 | 280,471 | 296 / 95 | 270 / 101 | 198 / 96 | 206 / 101 |
| mixed with 50 definitions, 500 | 17,081 | 25 / 67 | 20 / 60 | 13 / 56 | 15 / 57 |
| mixed with 50 definitions, 2,000 | 65,342 | 59 / 71 | 58 / 63 | 46 / 64 | 48 / 66 |
| one list, 500 items | 5,890 | 17 / 78 | 7 / 79 | 5 / 84 | 7 / 83 |
| one list, 2,000 | 24,890 | 60 / 308 | 33 / 310 | 28 / 310 | 26 / 299 |
| one list, 8,000 | 102,890 | 236 / 1,359 | 151 / 1,436 | 114 / 1,400 | 104 / 1,442 |

The mixed 8,000 and the one-list rows, and the whole-document column, were taken before the window used one lex; the other rows after. One lex saved about 10 ms at 2,000 blocks. In the definitions rows, about 45 ms is the settling update over the 50-line definition block, which the WYSIWYG editor pays at its first update too.

**The toolbar state.** 4,157 carets inside words, each one whose WYSIWYG place maps back to the same offset (corpus, hand-written set, 1,000 drawn tab documents, and the block-locator's shapes `- one` / (blank) / tab + `**same**` / (blank) / `  same` / `- two` and `- one` / (blank) / tab + `**second** x` / `- two`): the six flags (`bold`, `italic`, `underline`, `strikethrough`, `code`, `linkUrl`) agree in all.

**Places.** Over every offset of every top-level block of the 605 documents, `$placeOfSourceOffset` finds a place for 14,275 of 14,887 offsets before the pieces and 14,705 after: 430 more, in 17 documents with a character reference, none fewer.

**The existing suites with every command through the model.** Of 1,287 tests in five files, 207 fail: 138 `DIFFERS` rows, 53 `SAME` rows (today's spelling, which reads alike), 15 rows pinning today's source-mode results (group 7 restates them), and one row of `markdown-source-preservation.test.ts` that counts lexer calls and failed only under the probe's setup file. The read-only rows pass.

**Known issues** of `scratch-keep/known-issues-2026-10.md` this plan removes, each measured:[^known-issues]

| Entry | After this plan |
|---|---|
| the source-mode list toggle that runs for over 100 s on `\n\n 1.\t</pre>\n \t  >\t#\th\n` at offset 7 | declines in 27 ms (a raw block); the transform is deleted |
| `- one` + tab + `two` and `- a` + tab + `- b c` decline in source mode | they act, as the WYSIWYG commands do (rows 5.19, 5.20); `> a` + tab + `- -` / `b` still declines (no place) |
| source-mode line commands decline on kept lines whose prefix holds a tab | gone with the line commands; the pass acts wherever a place is found |
| bold and link decline on single marker-character words of a marker-and-tab line, and on about 300 word runs of tab documents where the spaces form acts | they act wherever a place is found; the reading of that line's tabs as spaces stays |
| in WYSIWYG mode, the caret goes to the block's end when a re-read raw block holds a character reference | fixed (row 2.8) |

---

## Notes

[^precedent-pass]: The approach mirrors two existing seams. `editSource` ([MarkdownEditor.ts:7432](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7432)) already routes every source-mode command: it reads the `CodeEditor`'s selection, computes an edit and hands it to `replaceRange` with the selection to leave, then restores focus. `editSourceThroughModel` keeps that contract and computes the edit differently. The model itself mirrors `buildEditor` ([:9762](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L9762)). Placing a source offset in a loaded block is what the raw-block re-read already does with `$placeOfSourceOffset` (`$selectCaretPlace`, [markdownWritable.ts:1222](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1222)). The research study measured the approach (`plans/research/markdown-source-mode-shared-model.md`, 302 of 302 harness rows), recommended it for the block commands only, and the owner chose it for every text-editing command.

[^reentry]: Re-invoking the public command is a new pattern. Searched: `createEditor(` has one call in the library (`buildEditor`), and no code runs a command against another editor than `_editor`, so there is no precedent to follow. It is the only way to get the WYSIWYG result by construction: the alternative, moving each command's WYSIWYG body into a `$` function that takes the editor, touches 13 commands and the helpers they share (`commandApplies`, `refocusSurface`, `unlinkSelection`, `toggleList`) and still needs the same three switches. The three switches are the whole difference: `isSourceMode()` sends the call down the WYSIWYG path, `ensureEditor()` gives that path the model, and `refocusSurface()` keeps focus on the source editor. The audit of the thirteen paths found no other read of `this._editor` and no other surface side effect: `commandApplies` refuses read-only first (never true during a pass) and reads availability from `ensureEditor()`; `unlinkSelection` and `declinesInTextOnlyBlock` go through `ensureEditor()` too. `getValue()` tests `getMode()` itself and is unaffected; the selection-state reader tests `isSourceMode()`, and nothing calls it during a pass (*Potential Challenges*).

[^exceptions]: The owner's list. The study measured why: through the model `insertTable` inserts at the caret and splits a paragraph mid-word (`s` / table / `econd line`), and the two paragraph inserts never change the text (an empty paragraph writes nothing, 0 of 3,094 cases). Typing, highlighting and the toolbar state run per keystroke or per caret move, where an import per event is too slow on long lists.

[^registrations]: Measured: with a hand-picked subset of rules (the study prototype's) the corpus differential already found no difference once the model settled, and with the full list it found none either, so the full list costs nothing in behaviour and removes the question of which rules matter. History, the typing shortcuts, the Enter handler, the paste rules and the read-only guard are registered in the model too: none acts during a command (commands are not typing, the model is never read-only during a pass, and the model is thrown away with its history). Only the update listener differs, since it reports the `MarkdownEditor`'s `"change"` and `"selectionstate"`. Keeping one function also keeps the registration order, which decides priority ties between command listeners.

[^settle]: Found by the differential: Lexical's `registerNodeTransform` marks every node of its type dirty in a pending update. The WYSIWYG editor commits that update before a user's command (the first `read` after the build flushes it). The model, without the settling update, folded it into the update that placed the selection, so transforms rebuilt a paragraph under the new selection and moved the caret. One corpus document showed it (`tab-indented definition in a list item with a blank line in its title`: `registerList`'s registration re-showed the paragraph after a definition, and the caret between `[` and `x` moved to the end of `b `). With the settling update all eight of its cases match.

[^exact-positions]: The study prototype's alignment (greedy matching of shown characters against written ones) passed 300 of 302 harness rows and missed a merged table cell and leading spaces. Exact positions need two maps per block: source offset to place, and place to offset. The first exists since the raw-block range edits (`markdownSourcePlaces.ts`, 1,131 lines, 417 rows), which walks the source analysis's entries beside the units a load built and never guesses. The second is the same walk read the other way, so the two agree by construction (row 3.8 checks it). The importer already records each top-level block's source and the text after it, and the serializer already assembles the save block by block; each needs only to expose what it computes. Measured with them: 291 of 291 harness carets on the WYSIWYG caret's character, and every case of the corpus's merged-cell tables equal to the WYSIWYG result (bold on `y` in `| x | << | y z |` included), the shape the study prototype's alignment misplaced.

[^char-refs]: Measured: 382 corpus cases had no place only because of a character reference, and today's source mode acted in 137 of them; with the pieces, none of the 382 lacks a place, and nothing else changed (every Markdown suite, 12,691 tests, passes with the change alone). The WYSIWYG raw-block re-read uses the same mapping, so its documented fallback for a character reference goes away (row 2.8: caret 5 instead of 6). The pieces live beside the decoder in the display module, so viewer and editor share one reading of a reference: the pieces' joined `shown` is exactly `decodeCharacterReferences`, the function the dialect's `inlineText` tokenizer uses. A reference that reads as itself is split into written characters, because a whole-span piece of ten characters would leave the offsets inside it without a place.

[^window]: The study measured the whole-document import at 0.2 s for 500 blocks and 0.8 s for 2,000, and the window at 9 to 25 ms. One block on each side is there because a command can join its result with a neighbour (a new list item joins the list before or after it). Measured on this base: the window result equals the WYSIWYG whole-document result in all 20,855 cases. The importer's own `locateBlocks` is used rather than the source analysis's tree: it gives exactly the boundaries the import builds, and a token it cannot place becomes a gap block rather than an unknown offset. Lexing once for both the blocks and the definitions halved the window's cost (22 ms to 13–16 ms at 2,000 blocks).

[^definitions]: A window without the document's definitions would import `[a][1]` as plain text, and a command on that block would escape it (`\[a\]\[1\]`). Carrying the definition blocks as text follows `definitionLines` ([markdownSourcePlaces.ts:227](../packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts#L227)), which already puts the definitions of the text before a block after it so the block reads its references as in the document. Here the real definition text is carried, not a placeholder, because the serializer writes a reference in its reference form only while its definition's `href` and title match the node (`resolvesToNode`). The check by a second lex of the small composed text catches what top-level blocks miss: a definition in a list item, a quote or a column, and an unclosed fence that would swallow a definition put after it. The whole-document re-run when the parts do not come back never happened in the corpus; it is there so a command never writes a carried definition into the document.

[^gap-rule]: The WYSIWYG surface has no place on a blank line between blocks, so a caret there has nothing to act on, and a place is never guessed — the rule `$placeOfSourceOffset` is built on. A range end on a blank line is moved inward so that a selection made by dragging over a block and the blank line after it acts on the block, as today's source mode does (rows 4.8 and 4.9; today gives the same results for these three cases).

[^crlf]: `CodeEditor.getValue()` returns the view's document when mounted, whose lines CodeMirror joins with `\n`, and the cached value before that. `$importMarkdown` replaces `\r\n` with `\n`, which would shift every offset after the first line end. Only an editor built offline with such a value reaches the case.

[^raw-decline]: The owner's recommendation from the study. Of the corpus cases whose selection touches a raw block (13,576), the WYSIWYG command acts in 5,266, writing escaped text such as `- \<div>x\</div>` or `- \> - one\`, which a source-mode user sees and did not ask for. Today's source mode acts in 1,625 of them, converting the lines it reads inside the raw block; that ability is lost. `$selectionTouches` is the predicate the inline commands' `$selectionTouchesTextOnlyBlock` already uses, asked for raw blocks only, since a code block converts on both surfaces.

[^decline-silent]: Neither surface reports a declined command: the WYSIWYG commands return on `commandApplies` without an event, and `editSource` returns without a transaction when its transform gives `null`. A command that changes nothing must not dispatch, because an identical rewrite is still an undo step (the existing wiring rows *dispatches nothing, but still restores focus* pin that, and stay).

[^read-only]: Measured today: a read-only source-mode command signals only when its transform produced an edit, so `setBlockType("paragraph")` on a paragraph or bold in a code block is silent, while the WYSIWYG surface refuses every command up front (`refuseIfReadOnly`, [MarkdownEditor.ts:7613](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7613)). Refusing up front makes the two surfaces agree and avoids an import whose result would be refused anyway. The refusal goes through `replaceRange` because a read-only `CodeEditor` already refuses it with the right event and wash, and `CodeEditor` gets no API for this; the precedent is `cut()` and `paste()` in source mode, which delegate to the source editor's own methods for the same reason. Doing it for the three text-surgery commands too keeps one rule for every source-mode command.

[^undo-merge]: Measured in a mounted view: with the caret left where typing put it and the command within CodeMirror's 500 ms grouping delay, the command's change touches the typed one, and CodeMirror's history joins two such transactions when neither carries a user event that stops it. One undo then removed both the typed `x` and the bold, on today's text surgery and on the pass alike. `isolateHistory.of("full")` is CodeMirror's annotation for a change that must be a history event of its own. `replaceRange` has one caller in the library (`editSource`), and its JSDoc and docs already promise one undo step, so this fixes the method rather than adding an option.

[^caret-fallback]: The 85 corpus cases where the carets differ all have the WYSIWYG caret in text the save does not write: blanks at a line's end, an empty paragraph, or after an image the comparison cannot count. No offset of the saved text stands there, so the caret goes to the end of the replaced text, the place the change ends, which is also where `replaceRange` would map a caret it is not given. One fallback for every such end keeps the rule simple.

[^speed]: Time-based assertions would fail on a shared machine (the study saw a factor of two between runs). The precedent `markdown-editor-large-document-costs.test.ts` counts work with `vi.mock` spies that still do the work; rows 5.36 and 5.37 do the same for the two costs that grow with the document: lexing it, and importing it. A long list is the exception the targets name: its window is the whole list, and its cost is the WYSIWYG load of that list, which `markdown-editor-list-looseness-transform-cost` brought from 21.6 s to 113 ms at 2,000 items (the study measured 40 s before it).

[^toolbar]: The block-locator plan's faults were a look-alike line, a block a tab indents, and a 24-second line command. The tab-column work since then expands container tabs before the analysis searches, so the search finds tab-indented blocks; the two block-locator shapes and 1,000 drawn tab documents gave no toolbar difference. The 24-second command was a line command, which this plan deletes; through the model the same selection takes 2.2 s. The comparison was limited to carets whose WYSIWYG place maps back to the same offset, so that both readings describe the same position (an offset inside a link's destination has no WYSIWYG place to compare with).

[^census]: Reachability was computed from the roots `tableSource` and `paragraphAroundBlockSource` for `markdownSourceLines.ts`, from `readSourceSelectionState` and the three exported types for `markdownSourceEdits.ts`, and from every name the kept code and `markdownSourcePlaces.ts` import for `markdownSourceTokens.ts`, over top-level declarations with their JSDoc. The study's estimate of about 300 command-only lines in `markdownSourceTokens.ts` no longer holds on this base: the places module and the two kept line commands now read nearly all of it.

[^files-keep-names]: Renaming `markdownSourceEdits.ts` to fit what is left (the toolbar reader) would touch every import of it for no change in behaviour; the surgical rule of `CLAUDE.md` keeps the names.

[^harness]: Each `DIFFERS` row pinned a difference that the pass removes, and its WYSIWYG column is the result both surfaces now give, so no new literal is needed. Two assertions of the old `SAME` test are not carried over: `canonicalSave(loaded) === doc` held for `SAME` rows only (17 `DIFFERS` documents are not in the form the editor saves), and it described the rows rather than the command; `canSetBlockType` is `true` for every row and the WYSIWYG result already shows that the command applied. The undo check holds for every `PARITY` row (measured); it fails only for the raw rows `E22` and `E23`, which is why those rows check the WYSIWYG result alone.

[^differential-size]: The full measurement (35,153 cases) takes about three minutes in six chunks and crashes one worker's heap when run as one, so it does not fit the suite. The rotation runs each of the 17 commands on about 325 cases spread over all 605 documents (5,532 in all) in 27 seconds, near the round-trip fuzz's budget. It found zero differences on this plan's prototype. The two exceptions are the owner's raw-block decline and the no-place decline; the three commands that stay text surgery are not run.

[^plans-removed]: `list-lift-parity` (2,239 lines) made source mode lift a list item's later blocks as WYSIWYG does; the pass gives every one of its rows. `command-gaps` (2,238 lines) closed eight line-command gaps and placed table-cell text for inline commands; the line commands are deleted and the merged-cell case is placed by the exact mapping. `block-locator` (2,717 lines) placed blocks from the token tree; its line-command part is deleted and its toolbar part is not needed. No other plan names any of them in `depends-on`; one footnote of `plans/in-progress/markdown-editor-reload-differences.md` mentions them historically and is left as it is.

[^price]: The study measured 23 % over eight commands on its base. This measurement covers all 17 commands and the hand-written set: 44 % for the six block commands and 29 % for the inline ones, whose text surgery touched only the selected text. The rewrite is the same one a WYSIWYG edit of the block saves today; the parallel study `plans/research/markdown-source-preserving-model.md` measured it on real documents.

[^known-issues]: Each entry was run through the prototype: the hang document with the bulleted toggle at offset 7 (27 ms, raw-block decline); the three tab documents with five commands each; the marker-and-tab line with bold; and the raw quote with `&#35;` (row 2.8). The other source-mode entries of the list are about typing, highlighting or the WYSIWYG surface and are not touched.
