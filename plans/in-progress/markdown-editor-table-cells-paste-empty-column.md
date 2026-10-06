---
depends-on: [markdown-demo-sample-table-width]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Table Rows and Cells Paste — Implementation Plan

## Overview

In `MarkdownEditor`'s WYSIWYG mode, table rows or cells that were copied
without their table paste as nothing, and damage the place they land in. This
plan calls such a node *bare*: a table row with no table around it, or a table
cell with no row around it. A seeded paste fuzz found the most visible result:
in 44 of 31 951 pastes a `:::` column was left holding no block at all.
No load builds that state: a column that is empty in the Markdown loads with
one empty paragraph in it.[^fuzz]

The fix is one new `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` handler and two
small helpers in
[MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts).
The handler wraps pasted bare rows and cells in a table, then pastes that
table. It sits beside the existing handler `$pasteColumnsAsTheirBlocks`
([MarkdownEditor.ts:940](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L940)),
which does the same kind of work for bare `:::` columns. A new test file, one
sentence on the editor docs page and one changelog entry complete the change.

This plan is written against `feature/markdown-demo-sample-table-width` at
`4f68f3556`, the tip of the unmerged Markdown stack. Line numbers are from
that commit; find each site by its symbol name first. The cause lies in
`lexical` and `@lexical/table` 0.49.0, which `master` uses too.

---

## Root Cause

Three steps combine. The first two are Lexical's, the third is
`@lexical/table`'s.

**1. The copy holds bare rows or cells.** Lexical's
`$generateJSONFromSelectedNodes`
([LexicalClipboard.dev.js:989](../node_modules/@lexical/clipboard/dist/LexicalClipboard.dev.js#L989),
through `$appendNodesToJSON` at
[:908](../node_modules/@lexical/clipboard/dist/LexicalClipboard.dev.js#L908))
copies each node a range selection covers. A container is copied only when
the range reaches outside it. `T` below is the table
`| h1 | h2 |`, `| --- | --- |`, `| c1 | c2 |`.

| Selection in `T` | Copied top-level nodes | Affected |
|---|---|---|
| range `h1`@0 → `c2`@2 (two rows) | `tablerow, tablerow` | yes |
| range `c1`@0 → `c2`@2 (inside one row) | `tablecell, tablecell` | yes |
| range `c1`@0 → `c1`@2 (inside one cell) | `text` | no |
| range from a paragraph before `T` to one after it | `paragraph, table, paragraph` | no |
| a *table selection* of the same cells | `table` | no |

A table selection is what a mounted editor (one whose view is in the page)
makes of a drag or Shift+click across cells: `@lexical/table` turns such a
range into one, and its copy holds the whole table. An editor that is not
mounted, and any selection set by code, keeps the range and so copies bare
rows or cells.[^mounted]

**2. Lexical inserts them as ordinary blocks.** A row or cell is an element
that is not inline, so `RangeSelection.insertNodes` takes its block path
([Lexical.dev.js:9473](../node_modules/lexical/dist/Lexical.dev.js#L9473),
"CASE 3"). That path does three things with the block at the caret:

- It splits the block at the caret and puts the pasted nodes between the two
  halves ([:9497](../node_modules/lexical/dist/Lexical.dev.js#L9497)).
- When the block at the caret is a list item, it moves the half after the
  caret into the last pasted block
  ([:9500](../node_modules/lexical/dist/Lexical.dev.js#L9500)).
- When the block at the caret is empty, it removes that block
  ([:9504](../node_modules/lexical/dist/Lexical.dev.js#L9504)).

**3. `@lexical/table` then removes them.** Its node transforms run in the
same update. `$tableRowTransform`
([LexicalTable.dev.js:4753](../node_modules/@lexical/table/dist/LexicalTable.dev.js#L4753))
removes a row whose parent is not a table. `$tableCellTransform`
([:4744](../node_modules/@lexical/table/dist/LexicalTable.dev.js#L4744))
removes a cell whose parent is not a row. Each goes with everything inside
it.

Measured on `4f68f3556`, pasting the two rows of `T`:

| Paste at | Result today | Cause |
|---|---|---|
| `after`@2, in a paragraph | `af` and `ter`, two paragraphs; nothing pasted | steps 2 and 3 |
| the end of `after` | `after` and an empty paragraph; nothing pasted | steps 2 and 3 |
| `one`@2, in a list item | `on`: the `e` is lost | step 2 moves `e` into the last pasted cell, step 3 removes it |
| `y1`@1, in a cell of another table | the cell holds `y` and `1` as two paragraphs | step 2 |
| the empty paragraph that is a `:::` column's only block | the column holds no block | step 2 removes the paragraph, step 3 the rows |
| a range covering the whole document | the root holds no block | the same |

A column survives with no block because it is a *shadow root*: a node
Lexical treats as the top of its own region, as it does a table cell
([markdownBlockNode.ts:76](../packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts#L76)).
Lexical removes a parent it has emptied, but never the root or a shadow root
([Lexical.dev.js:5756](../node_modules/lexical/dist/Lexical.dev.js#L5756)).

The fuzz's 44 pastes are the `:::` column row of that table, reached three
ways.[^fuzz-shapes] The most common one goes through the editor's own code:
`$removeTableEdgeRange`
([MarkdownEditor.ts:1389](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1389))
removes a range that crosses a table's edge together with the whole table,
gives a column whose only block was that table an empty paragraph
(`$refillEmptiedColumn`, [:1370](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1370)),
and leaves the caret in it. That paragraph is then exactly the column row's
target. `$removeTableEdgeRange` is correct; the paste that follows it is not.

---

## Architecture Decisions

### Wrap bare rows and cells in a table before the insert, in a paste command handler

A new handler, `$pasteTableRowsAndCellsAsTables`, listens for
`SELECTION_INSERT_CLIPBOARD_NODES_COMMAND`. When any top-level pasted node is
a `TableRowNode` or a `TableCellNode`, it wraps those nodes in tables and
pastes the result instead. Every paste of Lexical nodes passes through this
command: Ctrl/Cmd+V and a drag-and-drop inside the editor both reach it
through `$insertGeneratedNodes`.

The precedent is `$pasteColumnsAsTheirBlocks`
([MarkdownEditor.ts:940](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L940),
registered at [:4600](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4600)).
It is a handler for the same command that reshapes pasted nodes Lexical
cannot place as they are, before the insert, and returns `true` once it has
pasted the reshaped nodes itself.[^why-handler]

### The contract — bare rows and cells paste as the table that holds them

Pasting copied nodes that include bare rows or cells gives the same document
and caret as pasting a table holding those rows. Nothing else is special: the
table then lands as any pasted table does.

| Where the paste lands | What a pasted table does there, and so bare rows and cells too |
|---|---|
| a caret in a paragraph, heading or quote | the block is split and the table goes between the halves (row A2) |
| an empty paragraph | the table replaces it (rows A4, C1) |
| a selected range | the range is removed first, then the table lands at the caret (rows C3, D1–D7) |
| a cell of a table, or selected cells | the pasted cells are written over that table's cells from the caret's cell on, and the table grows when it is too small (rows E1–E4) |
| a code block or raw Markdown block | the table's text goes in as lines of text (K rows) |
| a list item | whatever a pasted table does there (K rows) |

The new table carries no column widths.[^contract]

### Group by runs — each run of cells becomes a row, each run of rows a table

The handler walks the top-level pasted nodes twice. First, each run of
consecutive `TableCellNode`s becomes one `TableRowNode` holding them. Then
each run of consecutive `TableRowNode`s, built or pasted, becomes one
`TableNode` holding them. Every other node keeps its place.[^runs]

| Pasted top-level nodes | Pasted instead |
|---|---|
| `row, row` | `table[row, row]` |
| `cell, cell` | `table[row[cell, cell]]` |
| `cell, cell, row, row` | `table[row[cell, cell], row, row]` |
| `row, row, paragraph, paragraph, cell, cell` | `table[row, row], paragraph, paragraph, table[row[cell, cell]]` |
| `paragraph, table, paragraph` | unchanged: the handler returns `false` |

### Fill short rows before the insert

Each row of a built table gets empty cells appended until it is as wide as
the widest row. An empty cell is a `TableCellNode` holding one empty
paragraph.[^fill]

| Copied rows | Built table's rows |
|---|---|
| `[h2, h3]`, `[c1, c2, c3]`, `[d1, d2]` | `[h2, h3, (empty)]`, `[c1, c2, c3]`, `[d1, d2, (empty)]` |
| `[c2, c3]`, `[d1]` | `[c2, c3]`, `[d1, (empty)]` |

### Paste the tables through `$insertGeneratedNodes`

The handler pastes the reshaped nodes by calling `@lexical/clipboard`'s
`$insertGeneratedNodes(editor, blocks, payload.selection)`, then returns
`true`. That call dispatches the same command again, now with no bare row or
cell in it. The new handler returns `false` on that second pass, and every
other paste handler, and Lexical's own insert, then handles the table.
`$pasteColumnsAsTheirBlocks` pastes its unwrapped blocks the same
way.[^redispatch]

### Register at `COMMAND_PRIORITY_HIGH`, between `$pasteColumnsAsTheirBlocks` and `$pasteIntoTextOnlyBlock`

Lexical runs a command's listeners from the highest priority down, and in
registration order within one priority. In this position the new handler runs
after the `COMMAND_PRIORITY_CRITICAL` listeners, which remove a selected
range that crosses a table's edge before anything is pasted, and before every
handler that decides where content goes. A paste into a code block or raw
Markdown block therefore gets the table's text, as it does for a copied
table.[^priority]

### No paste leaves a container empty — fixed at the cause, with no refill transform

The rule: after any paste, no `:::` column, `:::` block, list, table or table
row is without a child, and the root holds at least one block. This plan
removes the one known cause of a breach, which is a pasted block that
something removes after Lexical's insert has already consumed the empty
paragraph at the caret. It adds no transform that refills an empty column.
Every new test asserts the rule through one helper,
`emptyContainers`.[^no-refill]

### Tests go in a new file

The tests go in a new file,
`packages/lib/tests/component/markdown-editor-table-cells-paste.test.ts`,
with its own copies of the helpers it needs. Each Markdown editor test file
in this directory defines its own helpers; there is no shared helper
module.[^new-test-file]

### A new changelog entry

No unreleased entry in `next.md` describes this defect, so the fix gets its
own entry under **Fixed › Components**.

---

## Internal Structure

The three functions go in `MarkdownEditor.ts` directly after
`$pasteColumnsAsTheirBlocks` (which ends at L952), before
`$pastePlainTextIntoRawBlock`'s JSDoc (L954). This text was typechecked and
linted on `4f68f3556`, as a module of its own with the same imports.

```typescript
/**
 * Replaces each run of consecutive nodes that `isPart` accepts with the one
 * node `$wrap` builds from the run, and keeps every other node in its place.
 *
 * @param nodes - The nodes, in order.
 * @param isPart - Whether a node belongs in a run.
 * @param $wrap - Builds the node that holds one run.
 * @returns The nodes, each run replaced by its wrapper.
 */
function $wrapRuns<T extends LexicalNode>(
    nodes: LexicalNode[], isPart: (node: LexicalNode) => node is T, $wrap: (run: T[]) => LexicalNode,
): LexicalNode[] {
    const wrapped: LexicalNode[] = [];
    let run: T[] = [];

    for (const node of nodes) {
        const inRun = isPart(node);

        if (inRun) {
            run.push(node);

            continue;
        }

        if (run.length > 0) {
            wrapped.push($wrap(run));
            run = [];
        }

        wrapped.push(node);
    }

    if (run.length > 0) {
        wrapped.push($wrap(run));
    }

    return wrapped;
}

/**
 * Builds the table that holds `rows`, each row filled at its end with empty
 * cells up to the widest row, as `@lexical/table`'s own table transform fills
 * a short row of a table in the document. The table is still outside the
 * document here, where no transform reaches it, and `@lexical/table`'s paste
 * of a table into another table's cells reads it as a rectangle: a short row
 * throws there, or loses the cells past the first row's width.
 *
 * @param rows - The rows, in order.
 * @returns The table.
 */
function $tableHoldingRows(rows: TableRowNode[]): TableNode {
    const table = $createTableNode().append(...rows);
    const [map] = $computeTableMapSkipCellCheck(table, null, null);
    const width = Math.max(...map.map((row) => row.length));

    rows.forEach((row, index) => {
        const filled = (map[index] ?? []).filter((value) => value !== undefined).length;
        const missing = Array.from({ length: width - filled }, () => $createTableCellNode().append($createParagraphNode()));

        row.append(...missing);
    });

    return table;
}

/**
 * `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` handler for table rows and
 * cells pasted without their table. A range selection that stays inside one
 * table copies the rows it covers without the table, and one that stays
 * inside one row copies the cells without the row. Lexical's insert puts
 * them in as blocks, and `@lexical/table` then removes a row outside a table
 * and a cell outside a row with everything in them: the pasted content is
 * lost, the block at the caret stays split in two, and a `:::` column or the
 * document whose only block was the empty paragraph at the caret is left
 * with no block. Wraps each run of pasted cells in a row and each run of
 * rows in a table, and pastes the result instead, through
 * `$insertGeneratedNodes`, so the other paste handlers and Lexical's insert
 * treat it as any pasted table.
 *
 * @remarks
 * `$insertGeneratedNodes` dispatches the command again, so a paste holding a
 * bare row or cell runs every listener registered ahead of this one twice,
 * as a paste holding a column does (see {@link $pasteColumnsAsTheirBlocks}).
 *
 * @param payload - The pasted nodes and the selection they are inserted at.
 * @param editor - The editor the command was dispatched to.
 * @returns Whether the paste held a bare row or cell, now pasted in a table.
 */
function $pasteTableRowsAndCellsAsTables(
    payload: CommandPayloadType<typeof SELECTION_INSERT_CLIPBOARD_NODES_COMMAND>, editor: LexicalEditor,
): boolean {
    const holdsBarePart = payload.nodes.some((node) => $isTableRowNode(node) || $isTableCellNode(node));

    if (!holdsBarePart) {
        return false;
    }

    const rows = $wrapRuns(payload.nodes, $isTableCellNode, (cells) => $createTableRowNode().append(...cells));
    const blocks = $wrapRuns(rows, $isTableRowNode, $tableHoldingRows);

    $insertGeneratedNodes(editor, blocks, payload.selection);

    return true;
}
```

The registration goes in `ensureEditor`'s `mergeRegister` list, on a new line
directly below the `$pasteColumnsAsTheirBlocks` registration (L4600) and
above the `$pasteIntoTextOnlyBlock` registration (L4601):

```typescript
                // After $pasteColumnsAsTheirBlocks and ahead of $pasteIntoTextOnlyBlock, at their priority: every paste
                // handler after it sees a table, never a row or cell without one.
                editor.registerCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, $pasteTableRowsAndCellsAsTables, COMMAND_PRIORITY_HIGH),
```

---

## Ordered Implementation Steps

Run every command from `packages/lib` unless noted.

1. **Worktree setup.** Symlink the worktree's `node_modules` and
   `packages/lib/node_modules` to the main tree's. Never run `npm install`.
   Check:
   `grep -n 'function \$pasteColumnsAsTheirBlocks' src/typescript/lib/component/editor/MarkdownEditor.ts`
   finds one match, so the base includes `markdown-editor-column-paste`.
2. **Create the test file**
   `tests/component/markdown-editor-table-cells-paste.test.ts`.
   - Start with the SPDX line and a short header comment naming this plan,
     as `markdown-editor-columns.test.ts` does (L1–8).
   - Copy these from `markdown-editor-columns.test.ts`, text unchanged:
     `CONFIG` with its `beforeEach` / `afterEach` (L25–34), the types
     `CopiedNodes` and `TextPoint` (L36–40), and the helpers `lexicalOf`
     (L48), `load` (L58), `update` (L72), `$textNode` (L82), `pasteNodes`
     (L128), `nodesOf` (L159), `columnChildTypes` (L173), `rootChildTypes`
     (L193), `expectParity` (L202) and `caretAt` (L238). Keep each helper's
     JSDoc.
   - Add the imports, constants and helpers listed under *Expected
     Behaviour › Test helpers*. Give each helper a JSDoc like the copied
     ones.
3. **Write the tests**: one `it` per row of *Expected Behaviour*, grouped in
   one `describe` per row group (A, C, D, E, G, K, U, N). Name each `it`
   with its row id, as the columns test file does (`'A1: …'`). Write the K
   rows with `it.each` over the six targets and the two kinds.
   - Check: `npx vitest run tests/component/markdown-editor-table-cells-paste.test.ts`.
     Every A, C, D, E and G row fails, and every K row except the two on the
     raw block. The U and N rows and the two raw-block K rows pass.
4. **`MarkdownEditor.ts`.**
   - In the `@lexical/table` import (L46–54), add
     `$computeTableMapSkipCellCheck`, `$createTableCellNode`,
     `$createTableNode` and `$createTableRowNode`. `$isTableCellNode`,
     `$isTableRowNode` and `TableNode` are already there.
   - On a new line directly after that import, add
     `import type { TableRowNode } from "@lexical/table";`, as L42 does for
     `LinkNode`.
   - No other import changes: `$createParagraphNode`,
     `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND`, `COMMAND_PRIORITY_HIGH`,
     `CommandPayloadType`, `LexicalEditor`, `LexicalNode` and
     `$insertGeneratedNodes` are already imported.
   - Add the three functions and the registration as in *Internal
     Structure*.
   - Check: `npx vitest run tests/component/markdown-editor-table-cells-paste.test.ts`.
     Every row passes.
   - Check:
     `grep -n '\$pasteTableRowsAndCellsAsTables' src/typescript/lib/component/editor/MarkdownEditor.ts`
     finds two matches: the function and its registration.
5. **Docs.** Make the two edits under *Documentation Impact*.
6. **Full checks.** Run everything under *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Create | `packages/lib/tests/component/markdown-editor-table-cells-paste.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every row except the M rows goes in the new test file and can be tested
offline. The M rows need a browser.

### Test helpers

The file's imports:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    $createParagraphNode, $createRangeSelection, $findMatchingParent, $getRoot, $getSelection, $isElementNode, $isParagraphNode,
    $isRangeSelection, $isTextNode, $setSelection, UNDO_COMMAND,
} from 'lexical';
import type { LexicalEditor, LexicalNode, TextNode } from 'lexical';
import { $generateJSONFromSelectedNodes, $generateNodesFromSerializedNodes, $insertGeneratedNodes } from '@lexical/clipboard';
import { $createTableSelectionFrom, $isTableCellNode, $isTableNode } from '@lexical/table';
import { $dfs } from '@lexical/utils';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { editorSurfaceModel, viewerModel } from './markdown-roundtrip/viewModel';
```

Constants, below the copied `CONFIG`:

```typescript
/** The table the rows copy from. */
const T = '| h1 | h2 |\n| --- | --- |\n| c1 | c2 |';
/** What `T`'s two body cells paste as: a table of one row, which the save writes as its header. */
const CELLS_T = '| c1 | c2 |\n| --- | --- |';
/** What the cells copied from `c1`@1 to `c2`@1 paste as. */
const PART_T = '| 1 | c |\n| --- | --- |';
/** A wider table, for copies whose rows differ in length. */
const T3 = '| h1 | h2 | h3 |\n| --- | --- | --- |\n| c1 | c2 | c3 |\n| d1 | d2 | d3 |';
/** What `T3`'s rows copied from `h2`@0 to `d2`@2 paste as: the short rows filled with empty cells. */
const T3_PART = '| h2 | h3 |  |\n| --- | --- | --- |\n| c1 | c2 | c3 |\n| d1 | d2 |  |';
/** A second table, to paste into. */
const X = '| x1 | x2 |\n| --- | --- |\n| y1 | y2 |';
/** `X`'s header and delimiter rows. */
const X_HEAD = '| x1 | x2 |\n| --- | --- |';
/** `X` after `T`'s two rows are pasted at `y1`: they replace its body row and add one. */
const X_ROWS = X_HEAD + '\n| h1 | h2 |\n| c1 | c2 |';
/** `X` after `T`'s two body cells are pasted at `y1`. */
const X_CELLS = X_HEAD + '\n| c1 | c2 |';
/** `X` after `T3`'s rows copied from `c2`@0 to `d1`@2 are pasted at `y1`. */
const X_SHORT = X_HEAD + '\n| c2 | c3 |\n| d1 |  |';
/** `X` after `T`'s two rows are pasted over its selected cells `y1` and `y2`: only the first row fits. */
const X_FIRST_ROW = X_HEAD + '\n| h1 | h2 |';
/** What `T`'s body cells followed by its two rows paste as: one table. */
const MIXED_T = CELLS_T + '\n| h1 | h2 |\n| c1 | c2 |';

/** A two-column fence holding `left` and `right`; `''` is a column holding nothing. */
const cols = (left: string, right: string): string => `::: columns\n${left}\n|||\n${right}\n:::`;
```

Helpers to add beside the copied ones:

- **`type Point = TextPoint | 'empty-paragraph'`**: a selection end. A text
  point, or the start of the document's first empty paragraph.
- **`$pointOf(point: Point): [string, number, 'text' | 'element']`**: for a
  text point, `[$textNode(text).getKey(), offset, 'text']`. For
  `'empty-paragraph'`, the first node in `$dfs($getRoot())` that passes
  `$isParagraphNode` and has `isEmpty()`, as `[key, 0, 'element']`. Throws
  when the document has no empty paragraph.
- **`select(editor, anchor: Point, focus: Point): void`**: in one `update`,
  a new `$createRangeSelection()` with `anchor.set(...$pointOf(anchor))` and
  `focus.set(...$pointOf(focus))`, then `$setSelection`.
- **`copyRange(editor, from: Point, to: Point): CopiedNodes`**:
  `select(editor, from, to)`, then inside `lexical.read` returns
  `$generateJSONFromSelectedNodes(lexical, $getSelection()).nodes`.
- **`$cellOf(text: string)`** and **`$tableOf(text: string)`**:
  `$findMatchingParent($textNode(text), $isTableCellNode)` and the same with
  `$isTableNode`. Each throws when it finds `null`.
- **`copyCells(editor, from: string, to: string): CopiedNodes`**: the copy a
  table selection makes. Inside `lexical.read`, returns
  `$generateJSONFromSelectedNodes(lexical, $createTableSelectionFrom($tableOf(from), $cellOf(from), $cellOf(to))).nodes`.
- **`pasteAt(editor, nodes: CopiedNodes, at: Point, to: Point = at): void`**:
  `select(editor, at, to)`, then `pasteNodes(editor, nodes)`.
- **`typesOf(nodes: CopiedNodes): string[]`**: `nodes.map((node) => node.type)`.
- **`emptyContainers(editor): string[]`**: inside `lexical.read`, the type of
  every node in `$dfs($getRoot())` that passes `$isElementNode`, has
  `isEmpty()`, and whose type is one of `'root'`, `'list'`, `'table'`,
  `'tablerow'`, `'markdown-block'`, `'markdown-column'`. Keep the six type
  names in a `CONTAINER_TYPES` constant with a one-line comment: the nodes
  that must always hold a child.
- **`expectReloadsAsShown(editor): void`**: takes `saved = editor.getValue()`
  and `reloaded = load(saved)`, then expects `reloaded.getValue()` to be
  `saved` and `editorSurfaceModel(reloaded)` to equal
  `editorSurfaceModel(editor)`.
- **`appendEmptyParagraph(editor): void`**: in one `update`,
  `$getRoot().append($createParagraphNode())`.

Two copies are used throughout. **Rows** is `copyRange(editor, ['h1', 0],
['c2', 2])`, which copies `['tablerow', 'tablerow']`. **Cells** is
`copyRange(editor, ['c1', 0], ['c2', 2])`, which copies
`['tablecell', 'tablecell']`. Each row copies from the document it loads,
before it pastes.

Every A, C, D, E and G row also asserts all four of:

- `typesOf(nodes)` equals the row's *Copied* types;
- `emptyContainers(editor)` equals `[]`;
- `expectParity(editor)`;
- `expectReloadsAsShown(editor)`.

### At a caret, top level (A rows: fail today, pass after)

| # | Load | Copy | Paste at | Expected `getValue()` | Also |
|---|---|---|---|---|---|
| A1 | `T + '\n\nafter'` | Rows | `after`@5 | `T + '\n\nafter\n\n' + T` | `rootChildTypes` = `['table', 'paragraph', 'table', 'paragraph']`; `caretAt` = `['c2', 2]` |
| A2 | `T + '\n\nafter'` | Rows | `after`@2 | `T + '\n\naf\n\n' + T + '\n\nter'` | `rootChildTypes` as A1; `caretAt` = `['c2', 2]` |
| A3 | `T + '\n\nafter'` | Cells | `after`@2 | `T + '\n\naf\n\n' + CELLS_T + '\n\nter'` | `rootChildTypes` as A1 |
| A4 | `T`, then `appendEmptyParagraph` | Rows | `'empty-paragraph'` | `T + '\n\n' + T` | `rootChildTypes` = `['table', 'table']` |
| A5 | `T + '\n\nafter'` | `c1`@1 → `c2`@1 (copies `['tablecell', 'tablecell']`) | `after`@5 | `T + '\n\nafter\n\n' + PART_T` | `caretAt` = `['c', 1]` |
| A6 | `T3 + '\n\nafter'` | `h2`@0 → `d2`@2 (copies three `'tablerow'`s, of 2, 3 and 2 cells) | `after`@5 | `T3 + '\n\nafter\n\n' + T3_PART` | — |

In A1, A5 and A6 the last root child is the empty rest of `after`. Lexical
keeps the rest of the caret's block apart after any pasted table.

### In a `:::` column (C rows: fail today, pass after)

| # | Load | Copy | Paste at | Expected `getValue()` | `columnChildTypes` |
|---|---|---|---|---|---|
| C1 | `T + '\n\n' + cols('Left', '')` | Rows | `'empty-paragraph'` (the second column's) | `T + '\n\n' + cols('Left', T)` | `['paragraph', 'table']` |
| C2 | as C1 | Cells | `'empty-paragraph'` | `T + '\n\n' + cols('Left', CELLS_T)` | `['paragraph', 'table']` |
| C3 | `T + '\n\n' + cols('abcdef', 'Right')` | Rows | the range `abcdef`@0 → `abcdef`@6 | `T + '\n\n' + cols(T, 'Right')` | `['table', 'paragraph']` |
| C4 | as C3 | Rows | the range `abcdef`@2 → `abcdef`@4 | `T + '\n\n' + cols('ab\n\n' + T + '\n\nef', 'Right')` | `['paragraph', 'table', 'paragraph', 'paragraph']` |

Today C1, C2 and C3 leave `emptyContainers` = `['markdown-column']`.

### Over a range that leaves a table (D rows: fail today, pass after)

The copy is taken from the table the paste then removes.

| # | Load | Copy | Paste over | Expected `getValue()` | Also |
|---|---|---|---|---|---|
| D1 | `cols(T, 'Right')` | Rows | `c1`@1 → `Right`@2 | `cols(T, 'ght')` | `columnChildTypes` = `['table', 'paragraph']` |
| D2 | `cols('Left', T) + '\n\nafter'` | Rows | `c1`@1 → `after`@2 | `cols('Left', T) + '\n\nter'` | `columnChildTypes` = `['paragraph', 'table']` |
| D3 | `cols('', T)` | Cells | `'empty-paragraph'` → `c1`@1 | `cols(CELLS_T, '')` | `columnChildTypes` = `['table', 'paragraph']` |
| D4 | `cols(T, '')` | Cells | `c1`@1 → `'empty-paragraph'` | `cols(CELLS_T, '')` | `columnChildTypes` = `['table', 'paragraph']` |
| D5 | `'before\n\n' + T + '\n\nafter'` | Rows | `before`@2 → `c1`@1 | `'be\n\n' + T + '\n\nafter'` | `rootChildTypes` = `['paragraph', 'table', 'paragraph', 'paragraph']` |
| D6 | `T + '\n\nafter'` | Rows | `h1`@1 → `after`@5 | `T` | `rootChildTypes` = `['table']` |
| D7 | `cols('Left', T)` | Rows | `Left`@2 → `c1`@1 | `cols('Le\n\n' + T, '')` | `columnChildTypes` = `['paragraph', 'table', 'paragraph', 'paragraph']` |

Today D1–D4 leave `emptyContainers` = `['markdown-column']`, and D6 leaves
`['root']`.

### Into another table (E rows: fail today, pass after)

| # | Load | Copy | Paste at | Expected `getValue()` |
|---|---|---|---|---|
| E1 | `T + '\n\nmid\n\n' + X` | Rows | `y1`@1 | `T + '\n\nmid\n\n' + X_ROWS` |
| E2 | as E1 | Cells | `y1`@1 | `T + '\n\nmid\n\n' + X_CELLS` |
| E3 | `T3 + '\n\n' + X` | `c2`@0 → `d1`@2 (copies two `'tablerow'`s, of 2 cells and 1) | `y1`@1 | `T3 + '\n\n' + X_SHORT` |
| E4 | as E1 | Rows | a table selection of `y1` and `y2` | `T + '\n\nmid\n\n' + X_FIRST_ROW` |

E3 is the row the fill rule exists for: without the fill, `@lexical/table`
throws on the short second row. E4 cannot use `pasteAt`. After the copy, do
this in one `update`: build
`$createTableSelectionFrom($tableOf('y1'), $cellOf('y1'), $cellOf('y2'))`,
pass it to `$setSelection`, and call
`$insertGeneratedNodes(lexicalOf(editor), $generateNodesFromSerializedNodes(nodes), selection)`
with that same selection.

### A paste mixing rows, cells and other blocks (G rows: fail today, pass after)

Load a source editor with `T + '\n\nAlpha\n\nBeta'` and take three copies
from it: Rows, Cells, and `paragraphs` =
`copyRange(source, ['Alpha', 0], ['Beta', 4])` (copies
`['paragraph', 'paragraph']`). Paste into a second editor:
`load('Target')`, then `appendEmptyParagraph`, then paste at
`'empty-paragraph'`.

| # | Pasted nodes | Expected `getValue()` | `rootChildTypes` |
|---|---|---|---|
| G1 | `[...cells, ...rows]` | `'Target\n\n' + MIXED_T` | `['paragraph', 'table']` |
| G2 | `[...rows, ...paragraphs, ...cells]` | `'Target\n\n' + T + '\n\nAlpha\n\nBeta\n\n' + CELLS_T` | `['paragraph', 'table', 'paragraph', 'paragraph', 'table']` |

The G rows skip the `typesOf` check.

### The contract (K rows)

Each K row loads the same document into two editors. In the first it pastes
the range copy. In the second it pastes the table selection's copy of the
same cells, which is a whole `table`. It then expects the two editors to
agree.

| Target | Load | Paste at |
|---|---|---|
| heading | `T + '\n\n## head'` | `head`@2 |
| quote | `T + '\n\n> quote'` | `quote`@2 |
| list item | `T + '\n\n- one\n- two'` | `one`@2 |
| nested list item | `T + '\n\n- one\n  - sub\n- two'` | `sub`@2 |
| code block | ``T + '\n\n```\ncode\n```'`` | `code`@2 |
| raw block | `T + '\n\n<div>\nraw\n</div>'` | `raw`@2 |

| Kind | First editor's copy | Second editor's copy |
|---|---|---|
| rows | `copyRange(a, ['h1', 0], ['c2', 2])` | `copyCells(b, 'h1', 'c2')` |
| cells | `copyRange(a, ['c1', 0], ['c2', 2])` | `copyCells(b, 'c1', 'c2')` |

For each of the twelve combinations, expect:

- `a.getValue()` equals `b.getValue()`;
- `caretAt(a)` equals `caretAt(b)`;
- `emptyContainers(a)` equals `[]`.

The K rows assert no literal value and no parity, because what a pasted
table does in a list item is another plan's subject.[^list-items] Ten of the
twelve fail today. The two raw-block combinations pass today and
after.[^raw-passes]

### Undo (U rows: pass today and after)

Each runs a row above, then
`lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined)` once.

| # | Row | Expected after one undo |
|---|---|---|
| U1 | C1 | `getValue()` = the loaded source; `columnChildTypes` = `['paragraph', 'paragraph']`; `emptyContainers` = `[]` |
| U2 | D1 | `getValue()` = the loaded source; `columnChildTypes` = `['table', 'paragraph']`; `emptyContainers` = `[]` |
| U3 | E1 | `getValue()` = the loaded source |

They pass today because the defect is not in the undo. They stay as guards,
because the fix inserts through a second dispatch of the command.

### Unchanged behaviour (N rows: pass today and after)

| # | Load | Copy | Paste at | Expected `getValue()` | Why it is here |
|---|---|---|---|---|---|
| N1 | `T + '\n\nafter'` | `c1`@0 → `c1`@2 (copies `['text']`) | `after`@5 | `T + '\n\nafterc1'` | a copy inside one cell holds no bare node |
| N2 | `'before\n\n' + T + '\n\nafter\n\nTarget'` | `before`@3 → `after`@2 (copies `['paragraph', 'table', 'paragraph']`) | `Target`@6 | `'before\n\n' + T + '\n\nafter\n\nTargetore\n\n' + T + '\n\naf'` | a copied table is left to Lexical |

### Manual (browser) checks

A browser cannot make the bare copy by hand: a drag across cells becomes a
table selection, which copies a whole table. These rows check that the
browser's own path still works with the new handler registered. They behave
the same before and after this plan.

Run `npm run dev` at the repo root and open **MD Editor**. Insert a 2 × 2
table and type `h1`, `h2`, `c1`, `c2` into it. Add a paragraph `after` below
it. Make a two-column region (right-click → Columns → 2), type `Left` in its
first column and leave the second empty.

| # | Steps | Expected |
|---|---|---|
| M1 | Drag from `c1` to `c2` so both cells highlight, Ctrl/Cmd+C, click at the end of `after`, Ctrl/Cmd+V | a one-row table holding `c1` and `c2` appears below `after` |
| M2 | Click in the empty second column, Ctrl/Cmd+V | the table appears inside the column; the column keeps its frame |
| M3 | Press Ctrl/Cmd+Z once | the second column is empty again, and still has its frame |
| M4 | Click in `h1`, Ctrl/Cmd+V | `h1` and `h2` become `c1` and `c2`; no cell holds two lines |

---

## Verification

- `npm run typecheck` (repo root) and `npm -w packages/lib run typecheck:test`.
- `npx vitest run tests/component/markdown-editor-table-cells-paste.test.ts`: every row passes.
- `npx vitest run tests/component/markdown-editor-columns.test.ts tests/component/markdown-editor-table-edge.test.ts`: both still pass.
- `npx vitest run tests/component/markdown-roundtrip`: all harness checks and the edit fuzz pass.
- `npm test` (repo root): full suite green.
- `npm run lint` (repo root): zero errors.
- `npm run docs:api` (repo root) finishes with zero warnings.
- **The paste fuzz**, which is a scratch file and must never be committed.
  Copy
  `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/column-paste/zz-column-paste-fuzz.test.ts`
  into `tests/component/`. For each seed in `601 1709 2207 3313 4409 5521
  6607 7703 8819 9907 11003` run, with `OUT` set to
  `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plan-table-cells-paste`:
  `FUZZ_SEED=<seed> FUZZ_N=3000 FUZZ_OUT=$OUT/verify-<seed>.json npx vitest run tests/component/zz-column-paste-fuzz.test.ts`
  (about two minutes each; do not write the results under `/tmp`). The test
  itself fails, because the fuzz also reports other plans' defects. The
  check is `grep -c '"check": "emptyContainer"' $OUT/verify-<seed>.json`,
  which must print `0` for every seed; on `4f68f3556` it prints `2` for seed
  601. Delete the copied test file afterwards and check that `git status`
  shows no `zz-` file.
- Manual rows M1–M4.

---

## Documentation Impact

No public API changes. The handler and its helpers are module-private.

- **`docs/components/MarkdownEditor.md`**, the **Tables.** bullet
  ([:96](../packages/lib/docs/components/MarkdownEditor.md#L96)): directly
  after the sentence ending "becomes the lines of text the cell saves.",
  insert:
  ```markdown
  Table rows or cells pasted without their table (a selection that stays inside one table copies them that way) paste as a new table holding them, a short row filled with empty cells.
  ```
- **`docs/reference/changelog/next.md`**, under `## Fixed` › `### Components`:
  add this entry as the last one of that list, directly before the
  `### Core` heading that follows it (L640):
  ```markdown
  - **`MarkdownEditor` pastes table rows and cells copied without their table
    as a table.** A selection that stays inside one table copies the rows or
    cells it covers without the table. Pasting them pasted nothing and split
    the paragraph at the caret in two; in a list item the text after the
    caret was lost, and in a cell of another table that cell's text was
    split. A `:::` column, or a document, whose only block was the empty
    paragraph at the caret was left with no block at all. They now paste as
    a table holding them, as a copied table does. No consumer action is
    needed.
  ```

---

## Potential Challenges

- **`getValue()` cannot see an empty column.** A column holding nothing and a
  column holding one empty paragraph save the same text. Assert
  `emptyContainers` and `columnChildTypes`, as the C and D rows do.
- **The built table is not in the document yet.** Use
  `$computeTableMapSkipCellCheck`, which only reads the table's children.
  Do not swap in `$computeTableMap`, which takes two cells of the table and
  throws on `null`.
- **`'empty-paragraph'` means the first one in the document.** Each row
  using it loads a document with exactly one empty paragraph. A cell's
  paragraph counts when the cell is empty, so keep every cell of `T`
  filled.
- **The fuzz's `reload` count rises by 17 over the 11 seeds** while
  `markdown-editor-list-item-block-paste` has not landed. Those are pastes
  into a nested list item that pasted nothing before and paste a table now,
  which that plan's defect then affects as it does any pasted
  table.[^list-items] Only an `emptyContainer` signature is a failure of
  this plan.
- **The stack tip moves before implementation.** Find each site by symbol
  (`$pasteColumnsAsTheirBlocks`, `$pasteIntoTextOnlyBlock`, `ensureEditor`),
  not by line number.
- **Sibling plans edit the same file.** Four Markdown plans are drafted at
  the same time, and some add paste handlers. Keep the `MarkdownEditor.ts`
  change to the import lines, the three functions and the one registration
  line, and keep the registration between the two handlers named above. A
  handler another plan adds to place pasted blocks must be registered after
  this one, so that it sees a table and never a bare row or cell.

---

## Critical Files

- [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts):
  `$pasteColumnsAsTheirBlocks` (L940, the precedent),
  `$pasteIntoTextOnlyBlock` (L896), `$clearTableEdgeRangeBeforePaste`
  (L1537), `$removeTableEdgeRange` (L1389), `$refillEmptiedColumn` (L1370),
  `ensureEditor`'s registrations (L4592–4636), the `@lexical/table` import
  (L46–54), where the table selection observer is registered (L4663).
- [markdownBlockNode.ts](../packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts):
  `MarkdownColumnNode` (L37) and its `isShadowRoot` (L76).
- [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts):
  `registerTableRules` (L266) and `$alignCellsByColumn` (L340), which keep a
  table in the document rectangular and aligned once the pasted table is
  in.
- `packages/lib/tests/component/markdown-editor-columns.test.ts`: the
  helpers to copy (L25–248) and the paste tests whose style the new file
  follows (L445–671).
- `node_modules/lexical/dist/Lexical.dev.js`: `RangeSelection.insertNodes`
  (L9305, CASE 3 at L9473).
- `node_modules/@lexical/table/dist/LexicalTable.dev.js`:
  `$tableCellTransform` (L4744), `$tableRowTransform` (L4753),
  `$tableTransform` (L4762, the fill this plan mirrors),
  `$insertTableIntoGrid` (L1579) and
  `$tableSelectionInsertClipboardNodesCommand` (L4993).
- `node_modules/@lexical/clipboard/dist/LexicalClipboard.dev.js`:
  `$insertGeneratedNodes` (L849) and `$appendNodesToJSON` (L908).
- `plans/implemented/markdown-editor-column-paste.md`: the plan whose
  handler this one mirrors.
- `plans/implemented/markdown-editor-table-delete-merge.md`: the table-edge
  range rule the D rows build on.

---

## Non-Goals

- **Changing what a copy writes to the clipboard.** The clipboard still
  holds bare rows or cells. The paste side must handle them anyway, for
  content copied before this fix or by another editor instance.[^why-handler]
- **A transform that refills an empty column.** See the decision
  above.[^no-refill]
- **The header look of a pasted table's first row.** A table built from body
  cells shows its first row as body cells until the document is reloaded,
  though the save writes that row as the header.[^header]
- **The column a partly copied first row started in.** A first row copied
  from its second cell on is filled at its end, so its cells move one column
  left.[^ragged]
- **Column widths.** The pasted table has none.[^contract]
- **What a pasted table does in a list item.** That is the subject of
  `markdown-editor-list-item-block-paste`.[^list-items]
- **A bare row or cell nested deeper in a pasted block.** No copy produces
  one, and `@lexical/table` still removes it.[^runs]
- **The context menu's Paste and `paste()`.** They insert the clipboard's
  plain text with `insertRawText`, not Lexical nodes, and do not reach this
  command.
- **Undo steps that merge.** One undo taking back more or less than a paste
  is the subject of `markdown-editor-paste-undo-merge`.

---

## Notes

[^fuzz]: The fuzz is a scratch test, never committed:
    `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/column-paste/zz-column-paste-fuzz.test.ts`.
    It loads a random document holding `::: columns` blocks, tables, lists,
    raw blocks and code blocks, copies a random range as Lexical's clipboard
    does, and pastes it at a random caret or over a random range. Run on
    `4f68f3556` with seeds 601, 1709, 2207, 3313, 4409, 5521, 6607, 7703,
    8819, 9907 and 11003 at `FUZZ_N=3000`, it made 31 951 pastes and
    reported 925 failures. 44 of them carry the check name `emptyContainer`,
    always for a `markdown-column`, and always for a copy that held only
    `tablerow`s (27) or only `tablecell`s (17). With this plan's handler
    registered from a scratch test, ahead of the editor's own
    `COMMAND_PRIORITY_HIGH` paste handlers, the same run reported 898
    failures: no `emptyContainer`, the 881 other failures unchanged, and 17
    new `reload` failures, all of them pastes into a nested list item, which
    is another plan's subject (`markdown-editor-list-item-block-paste`).

[^fuzz-shapes]: Of the 44 pastes, 37 went over a range with one end in a
    table (a table-edge range), 4 went at a caret in the empty paragraph of
    a column that held nothing else, and 3 went over a range inside columns
    with no end in a table, whose removal left an empty paragraph as a
    column's only block. In all three the caret ends up in an empty
    paragraph that is its column's only block before Lexical inserts.

[^mounted]: `$fixRangeSelectionForSelectedTable`
    ([LexicalTable.dev.js:3205](../node_modules/@lexical/table/dist/LexicalTable.dev.js#L3205),
    the `isSameTable` branch at L3244) converts a range whose ends lie in
    two cells of one table into a table selection. `TableSelection.getNodes`
    (L1923) lists the table node first, so the copy holds the table. That
    code runs from the table selection observer, which
    `MarkdownEditor` registers only when its view mounts
    ([MarkdownEditor.ts:4663](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4663)).
    This was read from the code and checked offline with
    `$createTableSelectionFrom`; it was not checked in a browser, which is
    what manual row M1 is for.

[^why-handler]: Three other places were considered. A node transform that
    wraps a row found outside a table would run after Lexical's insert. By
    then the handlers that place a pasted table have already run on bare
    rows: `@lexical/table`'s own handler, which writes a pasted table over
    the cells of the table at the caret, saw no table and did nothing. The
    transform would also have to run before `@lexical/table`'s removing
    transform on the same node type, and only registration order decides
    that. A copy-side fix would have to change `@lexical/table`'s own node
    classes, and would leave older clipboard contents and drag payloads
    broken. Turning off the two removing transforms would only leave the
    rows in the document, where the save has nothing to write for them. The
    paste command is where Lexical lets an editor reshape pasted nodes, and
    `$pasteColumnsAsTheirBlocks` already uses it for the same kind of node:
    a part of a container, copied without the container.

[^contract]: The rule is parity with a pasted table, not a new placement
    rule. It was measured: for each target in the K rows, and for a
    paragraph, an empty column, a table cell and a table-edge range, the
    paste of the range copy and the paste of the table selection's copy of
    the same cells gave the same `getValue()` and the same caret. The node
    trees differ in one property. A table selection's copy carries the
    source table's `colWidths`; bare rows and cells carry none, because the
    widths live on the table node, which is not on the clipboard. The
    alternative contract, pasting the cells' paragraphs as plain paragraphs
    (what `$pasteColumnsAsTheirBlocks` does for a column), was rejected: a
    column is only a layout frame around blocks, so its blocks are its
    content, while cells in rows are the content's shape, and the browser's
    own copy of the same cells keeps that shape.

[^runs]: No copy produces a mix of bare rows, bare cells and other blocks:
    a range that stays inside one table copies only rows, one that stays
    inside one row copies only cells, and a range that leaves the table
    copies the table whole. The rule is stated on runs anyway, because the
    handler must do something with any payload it accepts, and "wrap only
    when every node is a row" would leave Lexical to drop the rows of a
    hand-built or foreign payload. The same reasoning stops at the top
    level: a bare row nested inside a pasted quote or column child has no
    run to belong to, and unwrapping recursively would add code for a shape
    no copy has produced.

[^fill]: In the document, `@lexical/table`'s `$tableTransform`
    ([LexicalTable.dev.js:4762](../node_modules/@lexical/table/dist/LexicalTable.dev.js#L4762))
    fills a short row the same way, and `registerTableRules` keeps the
    table rectangular afterwards. Neither reaches a table that is not
    attached yet. That matters for one route: pasted into a table cell, the
    table is never attached. `$insertTableIntoGrid`
    ([:1579](../node_modules/@lexical/table/dist/LexicalTable.dev.js#L1579))
    reads it as a grid as wide as its first row (L1601) and indexes every
    row to that width (L1651). Measured without the fill: rows of 2 cells
    then 1 throw `Cannot read properties of undefined (reading
    'startRow')`, and rows of 2, 3 and 2 cells silently lose the third
    cell of the middle row. A range copy makes a short row whenever it
    starts after a row's first cell or ends before a row's last, so short
    rows are the common case.

[^redispatch]: Calling `payload.selection.insertNodes(blocks)` directly
    would skip `@lexical/table`'s own handler for the command, which is
    what writes a pasted table into another table's cells, and
    `$pasteIntoTextOnlyBlock`, and `@lexical/clipboard`'s
    `$updateSelectionOnInsert`. Re-dispatching keeps every existing paste
    rule in play. A command dispatched inside an update runs in that same
    update, so the paste stays one history entry (rows U1–U3). The second
    pass cannot loop: it holds no bare row or cell, so the handler returns
    `false`. The listeners ahead of the handler run twice and do nothing
    the second time: the two range guards find the range already removed,
    the run-edge `tag` listener adds a tag that is already set, and
    `$pasteColumnsAsTheirBlocks` finds no column.

[^priority]: The order against `$pasteColumnsAsTheirBlocks` does not change
    any result. A payload holding both a column and a bare row takes one
    more pass either way, and no copy produces one. The measurements in
    this plan were taken with the new handler ahead of both other handlers;
    it goes after `$pasteColumnsAsTheirBlocks` so that handler's
    registration comment ("every paste handler after it sees a column's
    blocks") stays true for the new one. The order against
    `$pasteIntoTextOnlyBlock` does matter: run after it, a code block would
    get the rows' own texts joined by one line break, where a pasted table's
    text has a blank line between its rows (measured: `coh1`, blank, `h2`,
    `c1`, blank, `c2de` today against `coh1`, blank, `h2`, blank, `c1`,
    blank, `c2de` for a table).

[^no-refill]: A refill transform on `MarkdownColumnNode`, the shape of
    `@lexical/table`'s own "a cell is never empty" transform, was considered
    twice. As the fix, it fails: the column would get its paragraph back,
    but the pasted content would still be lost, a non-empty block at the
    caret would still be split, a list item would still lose its text and
    the root could still be emptied. As an extra guard beside the handler,
    it would protect a state no known route reaches: with the handler, the
    fuzz's 31 951 pastes left no empty container of any kind. `CLAUDE.md`
    asks for no handling of scenarios that cannot happen, and a silent
    refill would also hide the next real cause instead of letting a test
    find it. `$refillEmptiedColumn` and `$settleCaretIntoBlock` stay as they
    are: they repair what the editor's own table-edge removal empties.

[^new-test-file]: `markdown-editor-columns.test.ts`,
    `markdown-editor-table-edge.test.ts` and
    `markdown-editor-command-crashes.test.ts` each define `lexicalOf`,
    `load` and `$textNode` for themselves. The rows here are about tables
    pasted anywhere, not about columns or table-edge removal, and the
    sibling plans drafted at the same time add tests to those files, so a
    file of its own also avoids a shared-file conflict.

[^list-items]: Measured on `4f68f3556` for a pasted whole `table`, with no
    change from this plan. In a list item, Lexical ends the list at the
    caret, puts the table after it, and moves the rest of the item into the
    table's last cell (`one`@2 gives `- on`, the table with `c2e` in its
    last cell, `- two`). In a nested list item the table is saved indented
    inside the item, and a reload shows something else. The fuzz counts the
    second as a `reload` failure, and the 17 new ones are all bare copies
    pasted at, or over a range ending in, a nested list item, which pasted
    nothing before.
    `markdown-editor-list-item-block-paste` owns both behaviours. The K
    rows compare two editors instead of pinning a value, so they stay green
    whichever plan lands first.

[^raw-passes]: `$pasteIntoTextOnlyBlock` joins the text of the pasted
    top-level nodes with a blank line in a raw block, and a table's own
    text joins its cells with a blank line too. So two bare rows and the
    table holding them give the same text there, and the raw-block
    combinations pass before the fix. In a code block the separator between
    top-level nodes is a single line break, so the code-block combinations
    fail before it.

[^header]: This gap is older than this plan and wider than this route.
    Measured on `4f68f3556`: a table selection's copy of two body cells
    pastes as a table whose first row holds body cells, and
    `deleteTableRow()` on the header row leaves the next row as body cells.
    In both, `getValue()` writes that row as the header and a reload shows
    it as one. A rule that keeps a table's first row as header cells belongs
    with the table rules in `markdownWritable.ts` and would cover all three
    routes; fixing only the table this handler builds would make it differ
    from the copied table the contract compares it with.

[^ragged]: A range copy drops the cells before the range's start in the
    first row and the cells after its end in the last row, and the
    clipboard does not record where either row started. With three or more
    rows the table's true width is known from a middle row, and filling the
    first row at its start would restore the columns; with two rows it is
    not known. One fill rule for every row, the one `@lexical/table` itself
    uses, was chosen over a rule that is right only some of the time. A
    table selection, which is what a browser makes, always copies a full
    rectangle and never meets this.
