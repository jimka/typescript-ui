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

---

## Implementation Notes

Implemented on `feature/markdown-editor-table-cells-paste-empty-column`, on
top of `feature/markdown-editor-list-item-node` at `b154a9b3a`, which these
notes call "the parent". The plan was written against `4f68f3556`; three
branches landed in between. Scratch files named below are under
`~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/impl/table-cells-paste/`
("the scratch folder"). They are not in the repository.

### Decisions that await the user's sign-off

The user was not available while this plan was implemented. Each decision
below was made by the agent that ran the work and stands until the user
confirms or reverses it.

**1. The branch has two code commits, and the second is outside the
plan.** The plan's handler is one. The other fixes this defect: at a list
item's text, the text after the caret went into the last cell of a pasted
table. The plan lists "what a pasted table does in a list item" as a
non-goal. The parent's notes hand this plan only the bare rows pasted at an
item's text; they record the defect itself under *Seen along the way*
without naming an owner. The instruction this work was run under named both
as this plan's to fix, so it was fixed here. The defect is in Lexical's
insert and is the same for a whole copied table, so it is a fix of its own,
with its own code commit, docs commit and changelog entry. If the user
wants it elsewhere, the second code commit and the second docs commit come
off the branch whole; rows L1, L2, L4 to L6, L9 and the X rows go with
them.

**2. The text after the caret stays an item.** `- ab|cd` with a table
pasted at the caret gives `- ab`, the table, `- cd`. The blocks the item
held stay with `cd`. This is what `insertTable()` gives at the same caret
(the parent's rows Z1 and Z2). The other choice was to take `cd` out of the
list as a paragraph after the table, which is where the text after the
caret ends when paragraphs are pasted (it joins the last one). The item
was chosen because a split of an item's text makes two items everywhere
else, and because the parent's own rule for an item's block reads "the
second half stays a block of its own after a pasted list or table" (Y4,
Y9).

**3. With nothing after the caret, nothing changes.** `- abcd|` with a
table pasted gives `- abcd`, the table, and the rest of the list, with no
empty item, as on the parent. Blank text alone after the caret counts as
nothing, as it does for Enter in an item's text ("blank text counts as
none", `$enterLeavesListAtBlankItemText`): no blank item is left (row
X12). Lexical puts the blanks at the end of the table's last cell, as on
the parent, and the save writes nothing for them. One thing now shows that did not before: with the caret one
character before the end, the blocks the item holds stay in the list with
the split-off item; at the end they leave it. Splitting at the end as
well would keep them in the list, at the price of results that differ
from the parent's for every paste at the end of an item's text. The blocks such an item holds leave the list
and follow the table, as on the parent, and as they do after an emptied
text (the parent's rows E1 to E10). `insertTable()` at that caret leaves an
empty item instead; the paste does not copy that.

**4. The rule covers every paste that ends in a table or a `:::` block.**
A pasted `:::` block took the text after the caret into its last
paragraph the same way, and so did a pasted list whose last item ends in a
table. One rule decides all three: the last node of the paste lies in a
table cell or a column. A paste that ends in a code block still takes the
text after the caret into the code block, at an item's text and at the top
level alike; that is Lexical's rule for a pasted block of text and is not
changed here.

### Deviations from the plan

Each entry says what the plan called for, what was done, and why.

**The registration is a function, in `buildEditor`.** The plan puts one
`registerCommand` line in `ensureEditor`'s list, below the
`$pasteColumnsAsTheirBlocks` line. Since then each paste handler has a
register function of its own, called from `buildEditor`. The handler is
registered by `registerTablePartPaste`, called right after
`registerColumnPaste` and before `registerItemBlockPaste`, as the parent's
notes ask.

**`TableRowNode` is imported on the existing type line.** The plan adds a
type import line of its own. `import type { TableSelection }` from the same
module was already there, so the name went onto it.

**A second paste listener, which the plan does not have.**
`$splitItemBeforePasteEndingInTableOrFence`, registered by
`registerItemTextPaste` after `registerTextOnlyBlockRules`, with the helpers
`$pasteEndsInTableOrFence`, `$holdsSomethingAfterCaret`,
`$holdsBlankTextAlone`, `$nodesAfterPoint` and `$lastLeafOf` (the last is
an expression `$insertPastedBlocksAt` already had, now shared by the two).
`$isSelectionAtBlockEnd`, a function that was there, is rewritten on
`$nodesAfterPoint` (see *The end of a block*, below). It is the fix of the
second defect the parent's notes name for this plan. Decisions 2 to 4 above
say what it does. How: for a paste that ends in a table or a `:::` block,
at a list item's text, with something after the caret that is not blank
text, it removes a selected range, as Lexical's insert would do first
(rows L9, X9), splits the item at the caret, as Enter does, puts the caret back at the
end of the first half and returns `false`. Lexical's own insert then runs
there: the half it splits off is empty and is dropped, as at the end of
any item's text. Why a listener: Lexical decides the join by asking the
split-off text `canMergeWhenEmpty()`, a question that does not name the
pasted block, and an item's text must answer `true` so that a pasted
paragraph joins an empty item. `$pasteBlocksIntoItemBlock` is there for the
same reason. Why a split before the insert and not an insert of the
editor's own: every other step is then Lexical's, the one that has pasted
at an item's text all along. The listener acts exactly where Lexical would
join: `$pasteEndsInTableOrFence` finds the block Lexical joins to (the
block of the paste's last node) and asks whether a table cell or a column
stands between it and the pasted node. A paste that ends in a cell holding
no paragraph has no such block, Lexical joins nothing there, and the
listener leaves it alone (row X8; a split there left an empty item).

**The test file has more helpers and more rows than the plan lists.**
Helpers `copyRows`, `copyBodyCells`, `expectSoundDocument`, `undo` and
`inItem` fold lines the rows repeat; `pasteBuiltAt` pastes nodes built by
hand, for the payloads no copy makes. `CONTAINER_TYPES` has seven names, not
six: `markdown-list-item` did not exist when the plan was written, and an
item must hold a block as well. Three row groups are new. L1 to L10 pin
what the plan's K rows left open ("what a pasted table does in a list item
is another plan's subject"): a table pasted at a list item's text, in a
nested item, in a paragraph, a table cell and an emptied text of an item.
X1 to X22 pin the second listener: a whole copied table, a `:::` block
and a list that ends in a table; a link and an image after the caret; a
caret held as a point on the text itself, or on a link at its end or its
start; a range, forwards and backwards, also one that ends on a link;
blank text after the caret; a range from a code block, which stays the
text-only handler's; a range outside an item's text, which is left
alone; two controls and one hand-built table. `pasteAtPointOn` and
`$linkAfter` set a caret as a point on an element. G3 and G4 are hand-built
rows. A7 and E5 paste rows a range copy cut short behind a cell that spans
down into them. R is a grid of 18
list item shapes by three carets by rows and cells: each paste must leave
a sound document and one undo must restore the source.

**A row is brought to cells alone before it is measured.** The plan
measures the built table as the rows come. `@lexical/table` throws there
on a row with a child that is no cell. No copy makes one; a hand-built or
foreign payload can. `$tableHoldingRows` first calls `$keepRowsOfCells`,
the function the table rules already use for a table in the document: the
cells stay, anything else goes, as in `@lexical/table`'s own row
transform. It is exported from `markdownWritable.ts` for that, the one
change to a file the plan's table does not list. Row G4.

**A row that holds no cell gets one.** The plan's `$tableHoldingRows` fills
each row up to the widest. Rows that all hold nothing gave a table of rows
without cells, which nothing repairs in the document: an empty container,
the thing this plan removes. No copy makes such a row; a hand-built or
foreign payload can. The width is now one at least. Row G3.

**The K rows' raw block target** is the text node `raw` at offset 2, as
the plan says. A raw block holds one text node per line.

**Docs.** The sentence the plan's new sentence follows has grown since
(it now ends "on a line of its own."); the new sentence goes after it. Its
wording differs from the plan's in two places. "Paste as a new table
holding them" is not what happens in a cell of another table, where the
rows are written over that table's cells (rows E1 to E4), so the sentence
names both. And "a selection that stays inside one table copies them that
way" is true only of a range selection set by code: the plan wrote it
before the browser check, which showed that cells selected with the mouse
or the keys are copied as a table. The docs sentence and the changelog
entry say so. The
**Lists** bullet gets a sentence for the second listener, and the
changelog a second entry.

**The paste fuzz** was run from the parent's mapped copy of the harness
(`impl/list-item-node/harness/`), not from the path the plan gives: the
plan's copy still names `listitem`.

### Which clipboards hold bare rows or cells

Read again after the user's decision 7 of the parent's stack (a copy
across a table edge copies whole tables, as a cut does).

| Selection | What reaches the paste | Bare? |
|---|---|---|
| a range inside one table, across rows, in an editor that is not mounted or set by code | `tablerow, …` | yes |
| the same inside one row | `tablecell, …` | yes |
| the same range in a mounted editor (a drag, Shift+arrow, or a DOM range across cells) | `@lexical/table` makes it a table selection; the copy is one `table` | no |
| a range across a table's edge, native copy or cut | whole tables and what lies between (`$copyTableEdgeRange`) | no |
| a range across a table's edge, read with `$generateJSONFromSelectedNodes` (the fuzz's copy) | a `table` holding the rows and cells the range covers | no |
| a range inside one cell | text or paragraphs | no |
| `copy()`, `cut()`, `paste()` and the context menu | plain text; they never reach the command | — |

The third row was checked in Chromium: a drag from one cell to the next and
a DOM range set by script across four cells both gave a table selection,
and Ctrl+C put one `table` on the clipboard. So a browser user does not
make a bare copy today; a host that sets a selection by code, a drop, and
a clipboard written before this fix can.

### Where the handlers sit

`SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` listeners, in the order they
run:

| Priority | Listener | Registered by |
|---|---|---|
| critical | the run-edge tag | `registerWritableStateRules` |
| critical | `$clearGuardedRangeBeforePaste` (removes a table-edge, stale-focus or list-container range; gives a caret on an item a block) | `registerRangeGuards` |
| high | `$pasteColumnsAsTheirBlocks` | `registerColumnPaste` |
| high | **`$pasteTableRowsAndCellsAsTables`** | `registerTablePartPaste` |
| high | `$pasteBlocksIntoItemBlock` | `registerItemBlockPaste` |
| high | `$pasteIntoTextOnlyBlock` | `registerTextOnlyBlockRules` |
| high | **`$splitItemBeforePasteEndingInTableOrFence`** | `registerItemTextPaste` |
| editor | `@lexical/table`'s own (a table into a table's cells) | `registerTablePlugin` |

`$pasteTableRowsAndCellsAsTables` stands after the column handler, as
that handler's register function asks of every paste handler; no result
depends on the order of those two, since no copy holds a column together
with a bare row or cell. It stands before every handler that decides
where pasted blocks go, and that order is pinned (rows L7 and L10, the K
rows for a code block, the R grid): the
two list item listeners, the text-only handler and `@lexical/table`'s own
then see a table and never a row or cell without one. It pastes through
`$insertGeneratedNodes`, which dispatches the command again inside the
same update. On that second pass the two critical listeners do nothing
(the range is gone, the caret has its block, the tag is set), the column
handler finds no column, and this handler finds no bare row or cell and
returns `false`. A paste stays one update and one undo step (rows U1 to
U3, the R grid, and the undo check of every scenario).

`$splitItemBeforePasteEndingInTableOrFence` stands last of its priority,
after the two handlers that take a paste whole
(`$pasteBlocksIntoItemBlock` at an emptied text, `$pasteIntoTextOnlyBlock`
in a code block or raw block): it runs only for a paste Lexical's own
insert is about to make, and returns `false` always. Its place after
`$pasteIntoTextOnlyBlock` decides a result, which the third review found.
That handler reads the selection's anchor. A range selected backwards from
the start of a code block into an item's text has its anchor in the code
block. Where the item's text has no block after it, the paste goes in as
lines of text, on the parent and here (row X14). The listener removes a
range that starts in an item's text; run first, it took that paste away
from the handler for the clipboards it acts on, and only for those. Where
the item's text has a block after it (a nested list, a paragraph), that
row does not apply: `$pasteBlocksIntoItemBlock` removes such a range
before the text-only handler runs, on the parent too, blocks are pasted on
both, and the listener then splits the item as for any caret in the text.
Its order against `$pasteBlocksIntoItemBlock` changes no result.

### The end of a block

The fourth review found that a caret held as an element point on a link,
at the end of an item's text, was read as having something after it: the
listener split the item with nothing to split off, and an empty item was
left after the pasted table. Lexical holds a caret that way after an image
that ends a link (End, in Chromium, at the end of an item whose text ends
in a linked image gives `element on link@1`).

Two things were wrong, and both are fixed where they were, not in the
listener.

1. `$isSelectionAtBlockEnd` says in its JSDoc that it tells whether the
   anchor "sits at the very end of a block". For an element point it
   accepted a point on the block itself only, so a point on an inline
   element that ends the block was not the end. It now asks one question
   for every kind of point: does any node of the block follow it
   (`$nodesAfterPoint`, a walk from the point's node up to the block)?
2. The listener's own test for what follows the caret read the nodes of a
   range from the caret to the block's end. That range holds the node the
   caret is on or in, and an inline element a removed range has emptied,
   so both counted as something after the caret. `$holdsSomethingAfterCaret`
   now reads the nodes after the point from the same walk, and an element
   that holds nothing but blank text counts as blank text
   (`$holdsBlankTextAlone`).

The callers of `$isSelectionAtBlockEnd`:

| Caller | Block it passes | Affected? |
|---|---|---|
| `$paragraphAfterTextOnlyBlockEnd` (Delete at the end of a raw block or code block, before a paragraph) | a raw Markdown block or a code block | No. Those blocks hold text and line breaks only (`$keepTextOnly`), so no point on an inline element exists there. For a point on the block and for a text point the old and the new test agree: the fifteen earlier scenario files give the same result at every step, and all rows pass. |
| `$holdsSomethingAfterCaret` (this branch, since the first review) | a list item's text | Yes, as above. It no longer calls the function: the walk answers its question directly, and a second answer to "is this the end" beside it would be one more thing to keep in step. |

So the function's changed arm has no caller that reaches it today, and no
row of its own; the walk it shares is pinned through the listener (rows
X16 to X22). It was changed all the same because it answered wrongly by
its own description, and the next caller with a block that holds links
would have met what this branch met.

### Results

**Checks**, all from `packages/lib` at the final code: `npm run typecheck`,
`npm run typecheck:test` and `npm run lint` report nothing; `npx vitest
run` passes 556 files, 16,082 tests (2 todo); `npm run docs:api` gives zero
warnings; `npm run docs:llms:check` reports 0 unaccounted; `npm run
build:lib` builds. The new file holds 189 tests. Without the
handler's registration, 33 of the plan's 40 rows fail, the ones the plan
names (the U and N rows and the two raw-block K rows pass). Without the
second listener's, 16 rows fail (L1, L2, L4 to L6, L9, X1 to X5, X11,
X13, X18, X19, X21). Fourteen single-line mutants of the two listeners
were run on the final code and each fails at least one row
(`mutants-final.out` in the scratch folder): twelve fail one row each
(G3, G4, E5, X8, X12 to X15, X19 to X22), the mutant without the
listener's own range removal fails X9, X13 and X22, and the one that
ignores the rest of the caret's text fails nine rows.

**Fuzz**, the parent's mapped harnesses, node keys masked, against the
parent's baselines (`impl/list-item-node/{fuzz,lif,r7}`). The runs below
were made at the final code, after the fourth review's fix (the tree of
`b211c2b7e`, which the folded branch keeps); the runs before the reviews
and after the second and the third one (`fuzz-1/` to `fuzz-3/` and their
`lif` and `r7` folders) gave the same records. The scenario files were
run at that code too. The results
are in the scratch folder's `fuzz/`, `lif/` and `r7/`, which are the
baselines for the next plan (`README.txt` there).

| Fuzz | Baseline | This branch |
|---|---|---|
| paste, 11 × 3,000 | 47 (44 `emptyContainer`, 3 `undo`) | 3 `undo` |
| paste, strict | 47 | 3 `undo` |
| table edge, and strict | 0 | 0 |
| list-edit, 11 × 1,500 | 14 failing documents | 14, the same records |
| the seventh reviewer's, 5 × 3,000 | 117 | 120 |

- Paste: all 44 `emptyContainer` records are gone. The three `undo`
  records are the baseline's own (seed 2207 index 2377, seed 5521 index
  2137, seed 7703 index 2014) and belong to
  `markdown-editor-paste-undo-merge`. No record was added, and `ran`,
  `skipped`, `withColumn` and `nothingCopied` are the same in every seed.
  The 17 `reload` failures the plan's prototype saw (a table pasted into a
  nested list item) do not appear: the two list item plans made that shape
  load as a list.
- The seventh reviewer's fuzz: 115 records are the baseline's. Five are
  new, all `pasteSelf:lettersLost`: rows copied from a table by a range
  and pasted into a cell of that same table. They are now written over the
  table's cells from the caret's cell on, as a copied table is (rows E1 to
  E4), so the text those cells held is replaced; the harness counts that
  as lost letters. On the parent the five pasted nothing and passed. Two
  baseline records were not drawn (the documents a seed draws shift once
  an edit goes differently); replayed here, both fail as before
  (`r7/replay-on-branch.json`; the five on the parent are in
  `r7/replay-on-parent.json`).

**Scenarios.** `scenarios/` of the scratch folder holds a runner that
plays a scenario file on an archive of this branch and of the parent and
compares them (`README.txt` there). Each scenario pastes one clipboard at
one place and checks: no throw; the save loads as the document shown and
saves as itself; the viewer reads it as shown; the standard form agrees; no
container without a child; no row or cell outside its table; the list
item normal form; the letters of the document are those a plain removal
of the range leaves plus the clipboard's, the clipboard's words in order;
one undo restores the document and one redo the paste.

- `t1`: 13 clipboards (bare rows and cells, table selections, whole
  tables, table-edge copies as the editor's own copy writes them and as
  the fuzz reads them) at 176 places: the start, middle and end of a
  paragraph, heading, quote, code block, raw block, table cell, column and
  21 list item shapes; empty and emptied blocks; carets between blocks;
  and 64 ranges, among them table-edge, stale-focus and item-crossing
  ones. 2,288 scenarios.
- `t2`: 19 clipboards that mix bare rows and cells with paragraphs and
  text, or end in a table, a `:::` block, a list or a code block, at the
  same places. 3,344 scenarios.
- `t3`: 14 hand-built payloads no copy makes (rows and cells holding
  nothing, rows of unequal length, cells spanning rows or columns, 40
  rows) at 18 places; the same paste twice with two undos and two redos;
  typing and Enter after a paste; rows pasted back into their own table.
  1,324 scenarios.

All three files were run again at the final code. Of the 5,632 scenarios
of `t1` and `t2`, 3,054 give the parent's result.
2,238 differ because bare rows or cells are pasted where the parent dropped
them, and 340 because the text after the caret stays an item (34 places in
an item's text, by the ten clipboards that end in a table or a `:::`
block). None is left over (`RESULTS-classify.txt`). At all 176 places a
bare copy gives the same save, caret and tree as the table selection's
copy of the same cells. The parent leaves a container empty in 136 of
these scenarios and this branch in none.

The checks this branch still fails there are of two kinds, both the same
for a whole copied table on the parent. A paste into a table's cells
replaces what those cells held, which the letter check counts as a loss.
And a paste that holds a table together with other blocks is declined by
`@lexical/table` inside a table (see *Seen along the way*). In `t3` the
only failures left are a pasted table with no row, which is the parent's
too, and the harness's own (`selection.modify` needs a browser).

**Browser**, Chromium against the worktree's dev server, real mouse and
keys and the real clipboard:

- M1: a drag from `c1` to `c2` gives a table selection; Ctrl+C puts one
  `table` of one row on the clipboard; Ctrl+V at the end of `after` adds
  the one-row table below it. M2: Ctrl+V in the empty second column puts
  the table in the column, both columns keep their frame. M3: Ctrl+Z
  empties the column again. M4: Ctrl+V in `h1` writes `c1` and `c2` over
  the header cells; no cell holds two lines.
- Ctrl+V of the same copy in the middle of a list item's text: the item
  before the caret, the table, the rest of the text as the next item.
  Ctrl+V in a body cell of a second table writes the cells over it. One
  Ctrl+Z takes each back.
- A range set across cells through the DOM selection also becomes a table
  selection, so no key or mouse route to a bare copy was found. Bare rows
  and cells were pasted through a paste event carrying a Lexical clipboard
  cut from the real copy: into the empty column, the middle of a list
  item's text, a cell of the second table and the middle of a paragraph.
  Each gave the table the unit rows give, and one Ctrl+Z took each back.
- No console message.
- After the third review's fixes: M1 to M4, the paste in the middle of a
  list item's text and in a cell of the second table with the real
  clipboard, and bare cells and rows through a paste event into the empty
  column, the list item's text and the cell. The same results, one Ctrl+Z
  each, no console message.
- For the fourth review: with the caret set in the text of an item that
  ends in a linked image, End leaves the selection as an element point on
  the link (`element on link@1`). Before the fix, Ctrl+V of a copied table
  there left an empty item after the table. After it, none is left, and
  under an item that also holds a paragraph, the paragraph follows the
  table out of the list, as on the parent. One Ctrl+Z each, no console
  message.

**Demo.** No demo change: the plan adds no command or option.

### Seen along the way

Not changed here; each is the same on the parent.

- A paste that holds a table together with other blocks (a paragraph and
  a table, as a copy across a table's edge gives) pastes nothing into a
  table cell: `@lexical/table` declines it, since a table cannot stand in
  a cell. When the pasted-over selection was a table-edge or stale-focus
  range, the range guard has removed it by then, so the paste removes and
  inserts nothing. Bare rows mixed with other blocks now take this route
  as well; no copy makes that mix.
- A pasted table that holds no row (hand-built, or HTML `<table></table>`)
  stays in the document as an empty table, which the save writes nothing
  for.
- A paste at an item's text that ends in a code block puts the text after
  the caret into the code block, as it does at the top level.
- A paste at the very start of a task item's text leaves the marker alone
  in the first item (`- \[ \]`), as `insertTable()` there does, and the
  second half of a split task item has no marker.
- `insertTable()` at the end of an item's text leaves an empty item after
  the table. A paste there does not.
- A table built from body cells shows its first row as body cells until
  the document is loaded again (the plan's non-goal).
- A paste into a code block or a raw block is taken by the selection's
  anchor (`$pasteIntoTextOnlyBlock`), so a range selected backwards from
  the start of such a block into an earlier block pastes lines of text
  where the caret then stands, outside the block. The same range selected
  forwards pastes blocks. One exception, on the parent too: when the range
  reaches back into an item's text that has a block after it,
  `$pasteBlocksIntoItemBlock` removes the range first, the anchor leaves
  the code block, and blocks are pasted in both directions.
- Short rows are filled before the paste is routed, so in a code block or
  a raw block the empty cells a short bare row was given arrive as blank
  lines. A table selection's copy is always a rectangle and has no such
  rows.
- A caret held as an element point on a `:::` block after its columns,
  which only a selection set by code makes, leaves an empty `:::` block
  after any insert there (a pasted table, paragraphs, `insertTable()`).
- The plan's non-goal "the column a partly copied first row started in"
  is wider than it says: any row of a range copy that sits behind a cell
  spanning down from a row above loses that column too, so its cells move
  one column left in the built table. The clipboard does not record where
  a row started. Only a range set by code reaches this.

### For the plans that follow

- **`markdown-editor-paste-undo-merge`** (next). The paste fuzz has
  exactly its three `undo` records left; `fuzz/` in the scratch folder is
  the baseline. A paste of bare rows or cells dispatches
  `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` twice inside one update (as a
  paste of bare columns does), and a paste at an item's text that ends in
  a table splits the item inside the same update; neither adds an update
  or a history entry.
- **A new paste handler** that decides where pasted blocks go must be
  registered after `registerTablePartPaste`, so it sees a table and never
  a bare row or cell. `registerItemTextPaste` changes the selection (it
  removes a range and may split the item) and returns `false`, so it must
  stay the last listener of its priority: a handler that reads the
  selection as it was pasted over must run before it (row X14 is the one
  that showed it).
- **`markdown-editor-readonly-keyboard-selection`.** Two more listeners of
  `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` at `COMMAND_PRIORITY_HIGH`
  must stay behind its read-only guard: `registerTablePartPaste` and
  `registerItemTextPaste`.
- **`markdown-editor-table-command-fixes`.** `$tableHoldingRows` builds a
  table from rows outside the document; it is the place to give a built
  table header cells if that plan makes the first row's header state a
  rule.
- **The scenario runner** in `scenarios/` can be pointed at a later branch
  (`setup.sh <ref>`); `places.ts` is the list of 176 paste positions.
- **The end of a block.** `$isSelectionAtBlockEnd` and `$nodesAfterPoint`
  answer for a point of any kind: on the block, on an inline element in
  it, or in a text. A caret after an image that ends a link is a point on
  the link. A test that reads "the end" from a point on the block or from
  the block's last text alone misses it.

### Reviews

**First review.** One blocking finding: two branches of the second
listener had no row. Removing the listener's own removal of a selected
range, or the element-point arm of its end-of-block test, failed nothing.
Rows X9 and X10 pin them (X11 the other side of X10). No defect of
behaviour was found: the reviewer ran 2,564 scenarios of its own against
the parent (`scenarios/rv1-*.ts`: inline nodes, element points and ranges
at an item's text; cells holding links, images, code, breaks, escaped
pipes, alignment and merges; hand-built payloads and undo chains), and
every difference was one of the two intended ones.

Its advisory findings, all acted on:

- The second listener is outside the plan: decision 1 now says so and
  names the non-goal it sets aside.
- A blank rest after the caret left a blank item. Blank text now counts
  as none (decision 3, row X12).
- A hand-built row holding something other than cells threw. It was
  left out of the paste then; since the second review it is brought to
  its cells (row G4).
- `$pointEndsBlock` asked what `$isSelectionAtBlockEnd` already answers.
  It is gone; `$holdsSomethingAfterCaret` uses the existing function. The
  expression for a pasted node's last leaf, written twice, is
  `$lastLeafOf`.
- Rows behind a row-span shift left: recorded under *Seen along the way*.
- `registerItemBlockPaste`'s remark names `registerTablePartPaste` too.
- The **Tables** sentence says what happens in a cell of another table.

The fixes changed 109 steps of the reviewer's scenarios and none of the
5,632 of `t1` and `t2` (`scenarios/delta.py`): 64 where a blank rest no
longer leaves a blank item, 45 where the malformed row no longer throws.

**Second review.** No defect of behaviour: 1,543 more scenarios
(`scenarios/rv2-*`: ranges with ends on an item or a list, ranges that
take in the item's own blocks, payloads the handler regroups, range
copies from tables with a spanning cell, and 360 HTML clipboards holding
tables under jsdom) with no violation on the branch and no difference
from the parent beyond the two intended ones. Three blocking findings:

- The count of the cells a row holds, in `$tableHoldingRows`, had no row:
  counting the map row's length instead failed nothing, and broke rows
  copied from behind a spanning cell (a throw over a table selection).
  Row E5 fails under that mutant; A7 pins the same copy outside a table.
- The docs and the changelog said a selection inside one table copies
  bare rows or cells, which the browser check had shown to be true of a
  range set by code only. Both are corrected (*Deviations*, Docs).
- These notes named fuzz folders that were still empty and gave a test
  count from before the first review's rows. The fuzz families and the
  whole check set were run again at the final code; the *Results* section
  gives those runs.

Its advisory findings: the two ordering remarks that read as musts while
no result depends on them now say so, in the code and in these notes; a
row with a child that is no cell is no longer dropped whole but brought
to its cells, as `@lexical/table` does (*Deviations*; row G4); the
visible difference between a paste at the end of an item's text and one
character before it is stated under decision 3; the scope of decision 1
and the dev server left running were housekeeping.

**Third review, the last the audit allows.** No paste that empties a
container, drops or reorders rows or cells, or breaks the one undo step,
in 1,708 more scenarios (`scenarios/rv3-*`) and 18 mutants. Two blocking
findings, both in the second listener's handling of a range:

- Its place ahead of `$pasteIntoTextOnlyBlock` decided a result, while
  the code and these notes said no result depended on it: for a range
  selected backwards from the start of a code block or raw block into an
  item's text, the listener's removal took the paste away from that
  handler, for the clipboards that end in a table or a `:::` block only.
  The listener is now registered after `registerTextOnlyBlockRules`, the
  twelve scenarios that showed it give the parent's result again, the
  remark and the notes say what the order decides, and row X14 pins it.
- No row selected a range backwards: reading the range's start from its
  anchor failed nothing. Row X13.

Its advisory findings: the fold of the docs fixups needed resolving by
hand, which was done with the tree unchanged (`fold/` in the scratch
folder); the listener's JSDoc said a blank rest is dropped, where
Lexical puts it at the end of the last cell (corrected, and under
decision 3); the guard after the removal describes a case no scenario
produced (its comment says so now), and the guard before it had no row
(X15; without it a paste that a table declines removed the selected
range); three counts in these notes were off (corrected);
`$tableHoldingRows` repeated `$keepRowsOfCells`, which it now calls; two
rows lacked a blank line before them; three observations are recorded
under *Seen along the way*.

**The audit's limit of three rounds was reached with blocking findings in
the third.** They were fixed once, as above, and verified against the
reviewer's own scenarios (`scenarios/delta.py`: of all fifteen scenario
files, only those twelve steps changed) and against a mutant for each
finding. The plan was left open then, and a fourth review was run from
outside the audit.

**Fourth review.** It confirmed the third review's fixes by mutants (the
listener's order, rows X13 and X14) and ran a grid of 6,512 pastes of its
own against the parent (`review4/` in the scratch folder). One blocking
finding: the caret held as a point on a link at the end of an item's text
(*The end of a block*, above). Rows X16 to X22 were written first and seen
to fail (X16, X17, X20 and X22; X18, X19 and X21 are the other side: a
point on a link with something really after it, a point before what the
link holds, and a text point in a link with text after the link). The
defect was reproduced in Chromium with real keys before the fix (End at
the end of an item whose text ends in a linked image, then Ctrl+V of a
copied table: an empty item after the table) and is gone after it; with a
paragraph under the item, the paragraph follows the table out of the list,
as on the parent.

Its advisory findings:

- The notes overstated row X14's scope. The sentence under *Where the
  handlers sit* now says where it holds, and the other case is recorded
  there and under *Seen along the way*.
- X14 skipped the soundness checks though its result is sound. It makes
  them now, and its comment says that a fix of the anchor rule will
  rewrite its literal.
- "Each fail exactly one row" was no longer true: the mutant without the
  listener's own range removal fails X9 and X13. The count under *Results*
  is restated.
- The guard after the listener's range removal is still reached by no
  scenario. It was searched for again with the guard made to throw:
  16,600 pastes (the fourth reviewer's grid, `t1`, `t2`, `t4` and the
  three earlier reviewers' files of ranges at an item's text) and no hit.
  It stays for the type (the caret's block may be `null`), and its comment
  says that no removal was found that reaches it.
- Decisions 1 to 4 stay marked as awaiting the user's sign-off.

The fix changed no step of the fifteen earlier scenario files. The fourth
reviewer's grid, rebuilt from its output (`scenarios/rv4-grid.ts`), shows
no violation on the branch in 6,512 pastes; 3,654 give the parent's
result, 1,574 differ because bare rows or cells are pasted, and 1,284
because what followed the caret in an item's text stays an item (36 of
them a line break and the rest of a raw block that the pasted-over range
had joined to the text); none is left over
(`RESULTS-classify-grid.txt`). `scenarios/t4.ts` adds 1,197 pastes at
carets and ranges held as points on a link (19 documents, 7 points, 9
clipboards): 771 give the parent's result, 266 are bare rows or cells, and
160 are a closed clipboard with something after the caret in an item's
text; none is left over (`RESULTS-classify4.txt`).
