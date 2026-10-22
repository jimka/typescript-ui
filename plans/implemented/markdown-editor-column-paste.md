---
depends-on: [markdown-columns-fixes]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Column Paste — Implementation Plan

## Overview

In `MarkdownEditor`'s WYSIWYG mode, a selection copied across two `:::`
columns pastes differently from one copied across two ordinary paragraphs.
Copy from `ft` in `Left` to `Rig` in `Right` and paste at the end of
`Below para`: the result is `Below para`, `ft`, `Rig` and an empty paragraph.
The same paste of two plain paragraphs (`ha`, `Be`) at the end of `Target`
gives `Targetha`, `Be`, with no empty paragraph. This defect also exists on
`master`.

The fix is one new `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` handler in
[MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts).
It replaces each pasted column with the blocks it holds, then pastes those
blocks. It sits beside the existing paste handler `$pasteIntoTextOnlyBlock`
([MarkdownEditor.ts:838](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L838)).
One JSDoc in
[markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts),
four existing test expectations, the editor docs page and the changelog are
updated as well.

This plan is written against `feature/markdown-columns-fixes` at
`120c1d65d`, the tip of the unmerged Markdown stack. Line numbers are from
that commit; find each site by its symbol name first.

---

## Root Cause

Two Lexical steps combine to cause the defect. `markdown-columns-fixes`'s
transform runs after both of them, too late to change the result.

**1. The copy holds bare columns.** Lexical's
`$generateJSONFromSelectedNodes`
([LexicalClipboard.dev.js:908](../node_modules/@lexical/clipboard/dist/LexicalClipboard.dev.js#L908),
`$appendNodesToJSON`) copies each node the selection covers. A selection
from one column to the next lies inside the fence, so the fence
(`MarkdownBlockNode`) is not copied, but the two columns it passes through
are. What reaches the clipboard is two `markdown-column` nodes with no
fence:

| Copied from | Copied nodes (Lexical JSON, trimmed) |
|---|---|
| `Left`@2 → `Right`@3 in `::: columns\nLeft\n\|\|\|\nRight\n:::` | `[column[paragraph "ft"], column[paragraph "Rig"]]` |
| `Alpha`@3 → `Beta`@2 in `Alpha\n\nBeta` | `[paragraph "ha", paragraph "Be"]` |

**2. Lexical joins a pasted paragraph to the caret's paragraph, but never a
column.** `RangeSelection.insertNodes`
([Lexical.dev.js:9473](../node_modules/lexical/dist/Lexical.dev.js#L9473),
"CASE 3") splits the caret's paragraph at the caret. It then does two
things:

- It joins the first pasted node into the first half, but only if that node
  is a *leaf block*: an element whose first child is text or inline (see
  `INTERNAL_$isBlock`,
  [Lexical.dev.js:17202](../node_modules/lexical/dist/Lexical.dev.js#L17202)).
- It joins the second half, the rest of the caret's paragraph, into the last
  pasted block, but only if the last pasted node is a leaf block too
  ([:9500](../node_modules/lexical/dist/Lexical.dev.js#L9500)).

A `MarkdownColumnNode` is never a leaf block. It is a shadow root
(`isShadowRoot()`, [markdownBlockNode.ts:76](../packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts#L76)),
it reports `canBeEmpty() === false` ([:80](../packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts#L80)),
and its first child is a paragraph. So Lexical joins neither end. The
columns go in between the two halves. At the end of `Below para`, the second
half is an empty paragraph, which stays behind.

**3. The transform runs too late.** In the same update,
`$keepColumnInFence`
([markdownWritable.ts:506](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L506))
unwraps the bare columns into their paragraphs. By then the join decisions
are made.

| Paste at | Plain paragraphs (`ha`, `Be`) | Columns today | Columns after this fix |
|---|---|---|---|
| end of `Below para` | `Below paraha`, `Be` | `Below para`, `ft`, `Rig`, *(empty)* | `Below paraft`, `Rig` |
| `para`@2 | `paha`, `Bera` | `pa`, `ft`, `Rig`, `ra` | `paft`, `Rigra` |
| `para`@0 | `ha`, `Bepara` | `ft`, `Rig`, `para` | `ft`, `Rigpara` |

The save drops an empty paragraph, so `getValue()` does not show the
leftover empty paragraph. The editor does show it.[^empty-dropped]

---

## Architecture Decisions

### Unwrap pasted columns before the insert, in a paste command handler

A new handler, `$pasteColumnsAsTheirBlocks`, listens for
`SELECTION_INSERT_CLIPBOARD_NODES_COMMAND`. When any top-level pasted node is
a `MarkdownColumnNode`, it replaces each such column with that column's
children, in order, and pastes the result instead. Every paste of Lexical
nodes passes through this command: Ctrl/Cmd+V and a drag-and-drop inside
the editor both reach it through `$insertGeneratedNodes`.

The precedent is `$pasteIntoTextOnlyBlock`
([MarkdownEditor.ts:838](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L838),
registered at [:3726](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3726)).
It is a handler for the same command that reshapes the pasted nodes for the
place they land in, and returns `true` once it has inserted them
itself.[^why-handler]

### Paste the unwrapped blocks through `$insertGeneratedNodes`

The handler pastes the unwrapped blocks by calling `@lexical/clipboard`'s
`$insertGeneratedNodes(editor, blocks, payload.selection)`, then returns
`true`. That call dispatches the same command again, now with no column in
it. The new handler returns `false` on that second pass. Every other paste
handler, and Lexical's own insert, then handles the blocks as any pasted
blocks.[^redispatch]

### Register it at `COMMAND_PRIORITY_HIGH`, just before `$pasteIntoTextOnlyBlock`

Lexical runs a command's listeners from the highest priority down, and in
registration order within one priority. Registered just before
`$pasteIntoTextOnlyBlock` at the same priority, the new handler runs after
the `COMMAND_PRIORITY_CRITICAL` listeners (`$clearStaleFocusRangeBeforePaste`
and `markdownWritable.ts`'s run-edge `tag` listener) and before every handler that decides where content
goes. A paste into a raw block or a code block therefore still goes in as
plain text, made from the unwrapped blocks.[^priority]

### Unwrap only top-level columns; keep `$keepColumnInFence`

Only the pasted nodes themselves are checked. The join rule looks only at
the first and last pasted node, so a column nested deeper has no effect on
it. `$keepColumnInFence` stays registered and catches a column nested deeper.
Its JSDoc changes, because a column pasted at the top level no longer
reaches it.[^top-level]

### The contract: a column paste is the paste of the blocks it holds

Pasting copied nodes that include bare columns gives the same document,
caret and undo history as pasting the blocks those columns hold, in the same
order. A copy that includes the whole fence (the selection reaches outside
it) still pastes as a fence; this plan does not change that.[^contract]

### Four existing tests change their expected values

P1, P2, P3 and P6 in `markdown-editor-columns.test.ts` pinned the split
result as the expected value. They get the joined values in *Expected
Behaviour*.[^old-tests]

### Amend the unreleased changelog entry instead of adding one

`markdown-columns-fixes`'s entry in `next.md` already describes pasting a
selection that spanned two columns. That entry gains one sentence.[^changelog]

---

## Internal Structure

`$pasteColumnsAsTheirBlocks` goes in `MarkdownEditor.ts` directly after
`$pasteIntoTextOnlyBlock` (which ends at L860), before
`$pastePlainTextIntoRawBlock`'s JSDoc (L862):

```typescript
/**
 * `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` handler for pasted `:::`
 * columns. A selection copied across two columns of a fence copies the
 * columns without their fence, and Lexical's insert joins a pasted paragraph
 * to the one at the caret but never a column: the caret's paragraph would
 * stay split around the pasted columns, with an empty paragraph after them
 * when the caret was at its end. Replaces each pasted column with the blocks
 * it holds and pastes those instead, through `$insertGeneratedNodes`, so the
 * other paste handlers and Lexical's insert treat them as any pasted blocks.
 *
 * @param payload - The pasted nodes and the selection they are inserted at.
 * @param editor - The editor the command was dispatched to.
 * @returns Whether the paste held a column, now pasted as its blocks.
 */
function $pasteColumnsAsTheirBlocks(payload: CommandPayloadType<typeof SELECTION_INSERT_CLIPBOARD_NODES_COMMAND>, editor: LexicalEditor): boolean {
    const holdsColumn = payload.nodes.some($isMarkdownColumnNode);

    if (!holdsColumn) {
        return false;
    }

    const blocks = payload.nodes.flatMap((node) => ($isMarkdownColumnNode(node) ? node.getChildren() : [node]));

    $insertGeneratedNodes(editor, blocks, payload.selection);

    return true;
}
```

The registration goes in `ensureEditor`'s `mergeRegister` list, on the line
directly above the `$pasteIntoTextOnlyBlock` registration (L3726):

```typescript
                // Ahead of $pasteIntoTextOnlyBlock, at its priority: every paste handler after it sees a column's blocks.
                editor.registerCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, $pasteColumnsAsTheirBlocks, COMMAND_PRIORITY_HIGH),
```

---

## Ordered Implementation Steps

Run every command from `packages/lib` unless noted.

1. **Worktree setup.** Symlink the worktree's `node_modules` to the main
   tree's (and `packages/lib/node_modules`, if the main tree has one). Never
   run `npm install`. Check:
   `grep -n 'function \$keepColumnInFence' src/typescript/lib/component/editor/markdownWritable.ts`
   finds one match, so the base includes `markdown-columns-fixes`.
2. **Update the four old paste tests** in
   `tests/component/markdown-editor-columns.test.ts` (the
   `'pasting a selection that spans columns'` describe, L351):
   - P1 (L352): expected value
     `'::: columns\nLeft\n|||\nRighteft\n\nRi\n:::'`.
   - P2 (L362): expected value
     `'::: columns\nLeft\n|||\nRight\n:::\n\npaeft\n\nRira'`, and
     `rootChildTypes` `['markdown-block', 'paragraph', 'paragraph']`.
   - P3 (L372): expected value
     `'- iteft\n\nRiem\n\n::: columns\nLeft\n|||\nRight\n:::'`.
   - P6 (L401): expected value
     `'::: columns\nLeft\n|||\nRight\n:::\n\n| h1 | h2 |\n| --- | --- |\n| ceft\\n\\nRi1 | c2 |'`,
     and the cell-children check becomes `Array.from({ length: 2 }, …)`.
   - Leave P4 and P5 unchanged.
3. **Add the new tests** in the same file, as a new
   `describe('pasting a selection that spans columns joins the paragraph at the caret')`
   placed directly after the describe from step 2.
   - Add `$createParagraphNode` and `UNDO_COMMAND` to the `'lexical'` import
     (L9).
   - Add `const FENCE = '::: columns\nLeft\n|||\nRight\n:::';` at the top
     of the new describe, with a one-line comment: the two-column fence the
     rows copy from.
   - Add a helper `caretAt(editor): [string, number]`. Inside
     `lexicalOf(editor).read`, it returns the selection's anchor node's text
     content and the anchor offset, and throws when the selection is not a
     collapsed range. Give it a JSDoc like the file's other helpers.
   - Write one `it` per C row and U row of *Expected Behaviour*. Each row
     also asserts `expect(strayColumns(editor)).toBe(0)` and
     `expectParity(editor)`. U2 cannot use `copyAndPaste`: call
     `selectText`, then `copySelection`, then in one `update` append a
     `$createParagraphNode()` to the root and `select()` it, then
     `pasteNodes`. C11 likewise calls `selectText`, `copySelection`, then
     `selectText(editor, ['abcdef', 2], ['abcdef', 4])`, then `pasteNodes`.
     C4 finds the third cell as P6 does (the third `$isTableCellNode` in
     `$dfs($getRoot())`) and checks its children's types.
   - Check: `npx vitest run tests/component/markdown-editor-columns.test.ts`.
     P1, P2, P3, P6 and C1–C12 fail. P4, P5 and U1–U4 pass.
4. **`MarkdownEditor.ts`.**
   - Change `import { copyToClipboard } from "@lexical/clipboard";` (L42) to
     `import { $insertGeneratedNodes, copyToClipboard } from "@lexical/clipboard";`.
   - Add `$isMarkdownColumnNode` to the `markdownBlockNode.js` import
     (L68–70).
   - Add `$pasteColumnsAsTheirBlocks` and its registration as in *Internal
     Structure*.
   - Check: `npx vitest run tests/component/markdown-editor-columns.test.ts`.
     Every row passes.
5. **`markdownWritable.ts`.** Replace `$keepColumnInFence`'s JSDoc summary
   (L500–502) with: "Replaces a `:::` column that stands outside a fence
   with the blocks it holds, which is what the save writes for it. A paste
   already unwraps the columns it carries at its top level before inserting
   them (`$pasteColumnsAsTheirBlocks` in `MarkdownEditor.ts`); this
   transform catches a column nested deeper in pasted content." Leave the
   `@param` line and the function body as they are.
6. **Docs.** Make the two edits under *Documentation Impact*.
7. **Full checks.** Run everything under *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` (JSDoc only) |
| Modify | `packages/lib/tests/component/markdown-editor-columns.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All rows go in `markdown-editor-columns.test.ts` and can be tested offline.
Each row uses the file's `load`, `copyAndPaste`, `rootChildTypes`,
`columnChildTypes`, `strayColumns` and `expectParity` helpers. Each row also
asserts `strayColumns` = 0 and parity. "Copy" means `copyAndPaste`'s copy
from the first point to the second, and "paste at" is its third point.
`FENCE` stands for `'::: columns\nLeft\n|||\nRight\n:::'`.

### Column pastes (C rows: fail today, pass after)

| # | Load | Copy | Paste at | Expected `getValue()` | Also |
|---|---|---|---|---|---|
| C1 | `FENCE + '\n\nBelow para'` | `Left`@2→`Right`@3 | `Below para`@10 | `FENCE + '\n\nBelow paraft\n\nRig'` | `rootChildTypes` = `['markdown-block', 'paragraph', 'paragraph']`; `caretAt` = `['Rig', 3]` |
| C2 | `FENCE + '\n\npara'` | `Left`@2→`Right`@3 | `para`@2 | `FENCE + '\n\npaft\n\nRigra'` | `rootChildTypes` as C1; `caretAt` = `['Rigra', 3]` |
| C3 | `FENCE + '\n\npara'` | `Left`@2→`Right`@3 | `para`@0 | `FENCE + '\n\nft\n\nRigpara'` | `rootChildTypes` as C1; `caretAt` = `['Rigpara', 3]` |
| C4 | `FENCE + '\n\n\| h1 \| h2 \|\n\| --- \| --- \|\n\| c1 \| c2 \|'` | `Left`@2→`Right`@3 | `c1`@1 | `FENCE + '\n\n\| h1 \| h2 \|\n\| --- \| --- \|\n\| cft\\n\\nRig1 \| c2 \|'` | the third cell holds 2 `paragraph`s |
| C5 | `FENCE + '\n\n::: columns\nAA\n\|\|\|\nBB\n:::'` | `Left`@2→`Right`@3 | `AA`@1 | `FENCE + '\n\n::: columns\nAft\n\nRigA\n\|\|\|\nBB\n:::'` | `columnChildTypes` = 5 × `'paragraph'` |
| C6 | as C5 | `Left`@2→`Right`@3 | `BB`@2 | `FENCE + '\n\n::: columns\nAA\n\|\|\|\nBBft\n\nRig\n:::'` | `columnChildTypes` = 5 × `'paragraph'` (no empty paragraph in the column) |
| C7 | `FENCE + '\n\npara'` | `Left`@0→`Right`@5 (both columns whole) | `para`@4 | `FENCE + '\n\nparaLeft\n\nRight'` | `rootChildTypes` as C1 |
| C8 | `'::: columns\nLeft\n\|\|\|\nMid\n\|\|\|\nRight\n:::\n\npara'` | `Left`@2→`Right`@3 | `para`@4 | `'::: columns\nLeft\n\|\|\|\nMid\n\|\|\|\nRight\n:::\n\nparaft\n\nMid\n\nRig'` | `rootChildTypes` = `['markdown-block', 'paragraph', 'paragraph', 'paragraph']` |
| C9 | `'::: columns\nL1\n\nL2\n\|\|\|\nR1\n\nR2\n:::\n\npara'` | `L1`@1→`R2`@1 | `para`@4 | `'::: columns\nL1\n\nL2\n\|\|\|\nR1\n\nR2\n:::\n\npara1\n\nL2\n\nR1\n\nR'` | `rootChildTypes` = `['markdown-block', 'paragraph', 'paragraph', 'paragraph', 'paragraph']` |
| C10 | `'::: columns\n**Left**\n\|\|\|\nRight\n:::\n\npara'` | `Left`@2→`Right`@3 | `para`@4 | `'::: columns\n**Left**\n\|\|\|\nRight\n:::\n\npara**ft**\n\nRig'` | — |
| C11 | `FENCE + '\n\nabcdef'` | `Left`@2→`Right`@3 | the range `abcdef`@2→`abcdef`@4 | `FENCE + '\n\nabft\n\nRigef'` | `rootChildTypes` as C1 |
| C12 | `'::: columns\nL1\n\nL2\n\|\|\|\nR1\n:::\n\n```\ncode\n```'` | `L1`@1→`R1`@1 | `code`@4 | `'::: columns\nL1\n\nL2\n\|\|\|\nR1\n:::\n\n```\ncode1\nL2\nR\n```'` (one line per pasted paragraph, as for plain paragraphs) | `rootChildTypes` = `['markdown-block', 'code']` |

The updated P1, P2, P3 and P6 from step 2 are the same rule applied to the
caret's own column, a paragraph, a list item and a table cell.

### Unchanged behaviour (U rows: pass today and after)

| # | Load | Action | Expected | Why it is here |
|---|---|---|---|---|
| U1 | `'Alpha\n\nBeta\n\nTarget'` | copy `Alpha`@3→`Beta`@2, paste at `Target`@6 | `'Alpha\n\nBeta\n\nTargetha\n\nBe'`; `rootChildTypes` = 4 × `'paragraph'` | the plain-paste behaviour the C rows match |
| U2 | `FENCE` | copy `Left`@2→`Right`@3, paste into a new empty paragraph appended to the root | `FENCE + '\n\nft\n\nRig'`; `rootChildTypes` = `['markdown-block', 'paragraph', 'paragraph']` (the empty paragraph is replaced) | an empty paragraph has nothing to join; Lexical already replaces it |
| U3 | `FENCE + '\n\nBelow para'` | C1, then `lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined)` once | `getValue()` = the loaded source; `rootChildTypes` = `['markdown-block', 'paragraph']` | the paste and its re-dispatch are one undo step |
| U4 | `'pre\n\n' + FENCE + '\n\npara'` | copy `pre`@1→`Right`@3 (the whole fence is copied), paste at `para`@4 | `'pre\n\n' + FENCE + '\n\nparare\n\n::: columns\nLeft\n\|\|\|\nRig\n:::'` | a copied fence stays a fence |

U3 passes today too: the defect is not in the undo. It stays as a guard,
because the fix inserts through a second dispatch of the command.

### Manual (browser) checks

Run `npm run dev` at the repo root and open **MD Editor**. Make a two-column
region (right-click → Columns → 2), type `Left` and `Right` in the columns,
and add a paragraph `Below para` after the region.

| # | Steps | Expected |
|---|---|---|
| M1 | Drag from the middle of `Left` into `Right`, Ctrl/Cmd+C, click at the end of `Below para`, Ctrl/Cmd+V | `Below para` ends with the copied end of `Left`; the copied start of `Right` is the next paragraph; no empty paragraph after it; the caret is after the pasted text |
| M2 | Repeat M1 with the caret in the middle of `Below para` | the first half of `Below para` takes the first pasted line, the last pasted line takes the second half |
| M3 | After M1, press Ctrl/Cmd+Z once | the document is back to how it was before the paste |
| M4 | Select across the two columns again and drag the selection onto the end of `Below para` | the dropped text joins `Below para` as in M1, with no empty paragraph after it |

---

## Verification

- `npm run typecheck` (repo root) and `npm -w packages/lib run typecheck:test`.
- `npx vitest run tests/component/markdown-editor-columns.test.ts`: every row passes.
- `npx vitest run tests/component/markdown-roundtrip`: all harness checks and the edit fuzz pass.
- `npm test` (repo root): full suite green.
- `npm run lint` (repo root): zero errors.
- `grep -n '\$pasteColumnsAsTheirBlocks' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` (repo root): two matches (the function and its registration).
- `npm run docs:api` (repo root) finishes with zero warnings.
- Manual rows M1–M4.

---

## Documentation Impact

No public API changes. The new handler is module-private.

- **`docs/components/MarkdownEditor.md`**, the **Columns.** bullet
  ([:97](../packages/lib/docs/components/MarkdownEditor.md#L97)): replace
  "become the blocks they hold, which is what the save writes." with:
  ```markdown
  become the blocks they hold, which is what the save writes, and paste as those blocks would: the first joins the paragraph at the caret and the last takes in the rest of it.
  ```
- **`docs/reference/changelog/next.md`**, the entry
  **`MarkdownEditor` saves `:::` columns as it shows them.** (L540–552):
  after "they now become the blocks they hold." (L549), insert:
  ```markdown
  Such a paste also kept the paragraph at the caret apart from the pasted
  text, and left an empty paragraph after it when the caret was at the
  paragraph's end; it now joins the pasted text as a paste of paragraphs
  does.
  ```
  Re-wrap the entry's lines to the file's width.

---

## Potential Challenges

- **`getValue()` hides the leftover empty paragraph.** Assert
  `rootChildTypes` or `columnChildTypes` as the C1 and C6 rows do. A value
  check alone cannot see an empty paragraph.
- **The stack tip moves before implementation.** Find each site by symbol
  (`$pasteIntoTextOnlyBlock`, `ensureEditor`, `$keepColumnInFence`), not by
  line number.
- **Sibling plans edit the same files.** Four Markdown plans are drafted at
  the same time. Keep the `MarkdownEditor.ts` change to the two imports, the
  one function and the one registration line.

---

## Critical Files

- [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts):
  `$pasteIntoTextOnlyBlock` (L838, the precedent),
  `$clearStaleFocusRangeBeforePaste` (L1039), `ensureEditor`'s registrations
  (L3717–3748), the `@lexical/clipboard` import (L42), the
  `markdownBlockNode.js` import (L68–70).
- [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts):
  `registerWritableStateRules` (L73), `$keepColumnInFence` (L506), the
  run-edge `tag` listener (L1410).
- [markdownBlockNode.ts](../packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts):
  `MarkdownColumnNode` (L37) and `$isMarkdownColumnNode` (L97).
- `packages/lib/tests/component/markdown-editor-columns.test.ts`: the
  helpers (L54–220) and the paste describe (L351).
- `node_modules/lexical/dist/Lexical.dev.js`: `RangeSelection.insertNodes`
  (L9305, CASE 3 at L9473) and `INTERNAL_$isBlock` (L17202).
- `node_modules/@lexical/clipboard/dist/LexicalClipboard.dev.js`:
  `$insertGeneratedNodes` (L849) and `$appendNodesToJSON` (L908).
- `plans/implemented/markdown-columns-fixes.md`: its decision "A column
  outside a fence becomes the blocks it holds", which this plan finishes.

---

## Non-Goals

- **Changing what a copy writes to the clipboard.** The clipboard still
  holds bare columns. The paste side must handle them anyway, for content
  copied before this fix or by another editor instance.[^why-handler]
- **A copy that includes the whole fence** (U4, P4). It pastes as a fence.
  When the fence is the last pasted block, the rest of the caret's paragraph
  stays a paragraph of its own, empty at a paragraph's end. Lexical does the
  same after a pasted list.[^contract]
- **The context menu's Paste and `paste()`.** They insert the clipboard's
  plain text with `insertRawText`, not Lexical nodes, and do not reach this
  command.
- **How a raw Markdown block reshapes pasted text.** A paste into an HTML
  block goes in as text and then follows the existing raw-block rules,
  with or without columns.
- **Removing `$keepColumnInFence`.** It stays as the catch for nested
  columns.

---

## Notes

[^empty-dropped]: Measured on `120c1d65d` with the test file's own
    `copyAndPaste`: for C1's input the value today is
    `FENCE + '\n\nBelow para\n\nft\n\nRig'`, while the root holds
    `markdown-block, paragraph, paragraph, paragraph, paragraph` — the last
    one empty. The serializer writes nothing for an empty paragraph, so the
    stray paragraph only shows in the editor.

[^why-handler]: Three other places were considered. A node transform, the
    shape of `$keepColumnInFence`, runs after `insertNodes` has made its join
    decisions, and by then it cannot tell a pasted paragraph from one the
    user wrote. A copy-side fix (`MarkdownColumnNode.excludeFromCopy`) has
    no way to know whether the column's fence is copied too: it receives no
    selection, and returning `true` always would strip the columns out of a
    whole-fence copy (U4, P4). It would also leave older clipboard contents
    and drag payloads unfixed. Changing how `MarkdownColumnNode` reports
    itself (`isShadowRoot`, `canBeEmpty`) to pass Lexical's leaf-block test
    would break the reasons the node overrides them, documented on the
    class. The paste command is where Lexical lets an editor reshape pasted
    nodes, and `$pasteIntoTextOnlyBlock` already uses it for that.

[^redispatch]: Calling `payload.selection.insertNodes(blocks)` directly
    would skip `@lexical/clipboard`'s `$updateSelectionOnInsert`, which
    gives the caret the format of the text before it, as a normal paste
    does. It would also skip `$pasteIntoTextOnlyBlock` when the new handler
    runs ahead of it. Re-dispatching keeps every existing paste rule in
    play. A command dispatched inside an update runs in that same update, so
    the paste stays one history entry (U3). The second pass cannot loop: it
    holds no column, so the handler returns `false`. The run-edge `tag`
    listener and `$clearStaleFocusRangeBeforePaste` run twice. Both do
    nothing the second time (an update tag added twice is one tag, and the
    selection is already collapsed). Mutating `payload.nodes` in place and
    returning `false` would also work, because `$insertGeneratedNodes`
    passes the same array to `insertNodes`. It was rejected because it
    relies on that unpublished detail.

[^priority]: Measured on `120c1d65d`: with the handler run ahead of
    `$pasteIntoTextOnlyBlock`, a code-block paste of a column holding `1`
    and `L2` and a column holding `R` gives `code1\nL2\nR`, one line per
    paragraph, as a paste of those three paragraphs does. Run after it,
    `$pasteIntoTextOnlyBlock` reads each column's own text, which joins the
    column's paragraphs with a blank line, giving `code1\n\nL2\nR`.
    Running first also means every content handler sees one shape of pasted
    nodes, including any handler added later.

[^top-level]: In every copy tried on `120c1d65d` — two and three columns,
    columns of several paragraphs, a heading in a column, a selection from
    a column of a nested fence into the next column of the outer fence — the
    bare columns were always top-level copied nodes (in the last case the
    nested fence came along whole, inside the first copied column). When the copy reached outside a fence,
    the fence was copied whole with its columns inside. Unwrapping recursively
    would add code for a shape no copy has produced.

[^contract]: The rule is parity, not a new merge rule: after unwrapping,
    Lexical's own insert decides, exactly as for blocks copied from outside
    a fence. So a heading copied from a column as the first block joins the
    caret's paragraph as its text (`paraead`), as a pasted heading does. A
    whole-fence copy is not touched, because its fence is a real block in
    the copy. Lexical keeps the rest of the caret's paragraph apart from it,
    as it does for a pasted list (checked: copying `Alpha`@2→`one`@2 from
    `'Alpha\n\n- one\n- two'` and pasting at the end of `Target` leaves an
    empty paragraph after the pasted list).

[^old-tests]: `markdown-columns-fixes` fixed the stray columns and wrote
    P1–P6 from what the editor then produced. Its manual check M2 only
    asked that the paste land "as plain paragraphs, with no column frame".
    The join was never part of its contract. The new values come from the
    rule above. They match what a paste of the same paragraphs produces in
    the same place, measured against the plain-paragraph control (U1)
    in each position.

[^changelog]: `next.md` is unreleased, and the existing entry tells the same
    user-visible story: on `master`, a paste from across two columns came
    out wrong. One entry describing the whole fix reads better than two
    entries about the same paste.

---

## Implementation Notes

Implemented on top of `feature/markdown-editor-table-delete-merge`
(`77555cc3d`), which landed after this plan was drafted. Every site was
found by symbol; the code follows *Internal Structure* as written.

- **The `@lexical/clipboard` import already carried
  `$getClipboardDataFromSelection`** (the parent's `$cutGuardedRange` and
  `$copyTableEdgeRange` use it). Step 4's replacement line became
  `import { $insertGeneratedNodes, copyToClipboard, $getClipboardDataFromSelection } from "@lexical/clipboard";`.
- **Three `COMMAND_PRIORITY_CRITICAL` listeners run twice, not two.** The
  parent added `$clearTableEdgeRangeBeforePaste` beside
  `$clearStaleFocusRangeBeforePaste` and the run-edge `tag` listener. On the
  second dispatch it does nothing either: the first pass already removed the
  table-edge range, so `payload.selection` is a caret. `[^redispatch]`'s
  reasoning holds for it unchanged. The registration sits where the plan put
  it, on the line above `$pasteIntoTextOnlyBlock`'s.
- **The test file's `lexical` import also gains `$isRangeSelection`**, which
  `caretAt` needs to tell a caret from any other selection. Step 3 listed
  only `$createParagraphNode` and `UNDO_COMMAND`.
- **The handler's JSDoc gains a `@remarks`**, added after the audit: a
  column paste runs every listener registered ahead of the handler twice,
  and each must do nothing on the second pass. `[^redispatch]` says this of
  today's listeners; the code now says it for one added later.
- **The Columns bullet in `MarkdownEditor.md` names which blocks join**,
  where *Documentation Impact* wrote "the first joins the paragraph at the
  caret and the last takes in the rest of it". The audit noted that holds
  only for a block of text, which Lexical's insert joins: a list, table or
  fence at either end stays apart, as in any paste (`[^contract]`). The
  bullet now reads "a block of text (a paragraph, heading, quote, code block
  or raw Markdown block) that comes first joins the block at the caret, and
  one that comes last takes in the rest of that block".
- **Row C13 is added**, at the audit's suggestion: a column paste over a
  table-edge range, where a guard that runs twice has a range to remove on
  its first pass. `FENCE + '\n\nbefore\n\n| h |\n| --- |\n| c |\n\nafter'`,
  copy `Left`@2→`Right`@3, paste over `before`@2→`c`@1 gives
  `FENCE + '\n\nbeft\n\nRig\n\nafter'`, caret `['Rig', 3]`: the range's
  text and the whole table go, as the parent branch's rule says, and the
  pasted blocks join what is left of `before`.
- **A column holding no block pastes as nothing**, found by the audit with a
  hand-built `[column[]]` payload over a selected range: the handler pastes
  zero blocks, and Lexical's insert of zero nodes leaves the range in place.
  That is the contract (the paste of the blocks the column holds), and no
  copy produces such a column: an empty column holds an empty paragraph. It
  is left as it is.
- **Red phase as predicted.** Before step 4, P1, P2, P3, P6 and C1–C12
  failed, and P4, P5 and U1–U4 passed.
- **Fuzz.** A throwaway seeded copy/paste fuzz (not committed) ran 31 951
  pastes over 11 seeds, 19 271 of them carrying bare columns: random
  documents holding `::: columns` blocks, tables, lists, raw blocks and code
  blocks, a random range copied and pasted at a random caret or range,
  through `$insertGeneratedNodes` and through
  `$insertDataTransferForRichText`. On this branch: no throw, no column
  outside a fence, no difference between a column paste and the paste of the
  blocks the columns hold (document, node tree and caret), and no empty leaf
  block left at a caret that the copy did not hold. The same run on the
  parent's `MarkdownEditor.ts` left such an empty block in 346 pastes. The
  parent's table-edge fuzz still reports 0 failures over its 11 seeds.
- **What the fuzz found outside this plan.** Each also happens with a copy
  that holds no column, on the parent branch, so none is changed here:
  - A paste of two or more blocks at a caret in a nested list item saves a
    list a reload shows as a raw block. `'- a\n  - b\n\nP1\n\nP2'`, copy
    `P1`@0→`P2`@2, paste at `b`@1 saves `- a\n\n  - bP1\n\n  P2` before the
    two paragraphs. A column paste there now lands as those blocks do, so it
    shares the result (804 of the pastes, 275 without a column).
  - A fence or other block pasted into a list item can save text the viewer
    reads differently from what the editor shows (74 pastes, 48 without a
    column).
  - Bare table rows or cells, copied inside one table, pasted over a range
    that leaves a table can leave a `:::` column with no block (44 pastes,
    none with a column).
  - One undo does not take back a paste over the very range it was copied
    from when the only text node it touches ends with the same text:
    `@lexical/history` merges such an update into the previous entry (3
    pastes, 1 without a column).
- **Manual checks M1–M4 were run in Chrome** against this worktree's dev
  server, on the demo's own two-column block (`Left column.`,
  `Right column.`) with `Below para` typed into the paragraph after it.
  The selection and caret were set through the DOM selection; Ctrl+C,
  Ctrl+V and Ctrl+Z were real key presses. M1 gave `Below paraft column.`,
  `Rig`, caret after `Rig`, no empty paragraph. M2 (caret after `Below`)
  gave `Belowft column.`, `Rig para`. M3: one Ctrl+Z restored the document.
  M4: the browser tool drops at its target's centre. Dropped on the text
  `Below para`, the selection landed inside it and gave `Belowft column.`,
  `Rig para`. Dropped on the paragraph element, whose centre lies right of
  the text on its line, it landed at the paragraph's end and gave
  `Below paraft column.`, `Rig`, caret after `Rig`, no empty paragraph after
  it. Both drops removed the dragged text from the columns (`Le`,
  `ht column.`). For that second drop `Below para` was typed ahead of the
  demo's image, with Enter after it, so the paragraph held only its text.
- **Review fixes** (combined review of 2026-10-05, item B-13).
  - *The handler's registration moved out of `ensureEditor`* into
    `registerColumnPaste(editor)`, called where the inline line stood, ahead
    of `registerTextOnlyBlockRules`. Its JSDoc carries the ordering rule the
    inline comment gave. No behaviour change.
  - *Two `COMMAND_PRIORITY_CRITICAL` listeners run twice again, as the plan
    said.* The parent branch's review fixes merged
    `$clearTableEdgeRangeBeforePaste` and `$clearStaleFocusRangeBeforePaste`
    into one listener, `$clearGuardedRangeBeforePaste`, so the "three
    listeners" note above describes the code as it was: on a re-dispatched
    column paste the guard and the run-edge `tag` listener each run twice.
    The guard still does nothing the second time, for the same reason (the
    first pass removed the range), and the handler's `@remarks` now says
    "the range guard". Row C13 passes unchanged and still describes what
    happens: its range is a table-edge range, removed on the first pass.
  - *That guard now removes a range only for a paste that carries nodes.*
    A column holding no block, the hand-built payload noted above, counts as
    one node on the first pass, so over a table-edge or stale-focus range it
    removes the range and pastes nothing; over any other range the range
    stays, as before. No copy produces such a column.
