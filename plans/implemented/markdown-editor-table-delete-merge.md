---
depends-on: [markdown-columns-fixes]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Table-Edge Delete — Implementation Plan

## Overview

In `MarkdownEditor`'s WYSIWYG mode, deleting a selection that runs from a paragraph into a table cell joins the paragraph **after** the table onto what is left of the first one, although nothing in it was selected. With this document:

```
Above para

| a | b |
| --- | --- |
| c1 | d1 |

after
```

a drag from the middle of `Above` into `d1` and Delete gives `Abovafter`. The mirror case — a drag from a cell down into `after` — joins the rest of `after` onto `Above para` (`Above parater`). The bug is on `master` too and changes data.

The root cause is in `@lexical/table` 0.49.0, not in this stack's handlers. In a browser `@lexical/table` first grows the selection so it covers the whole table, which is correct. Its Backspace/Delete handler (`$deleteCellHandler`, [LexicalTableSelectionHelpers.ts:701](../node_modules/@lexical/table/src/LexicalTableSelectionHelpers.ts#L701)) then moves the inside end out of the table to the **start of the block after it** (`tableNode.selectNext()`), or the end of the block before it, and hands the range on. Lexical's ordinary range removal joins the rest of the block a range ends in onto the block it starts in, so `after` is joined.[^root-cause] Its cut handler ([:761](../node_modules/@lexical/table/src/LexicalTableSelectionHelpers.ts#L761)) does the same. Every other route — typing, Enter, paste, Ctrl+Backspace, `cut()`/`paste()`/`insertImage()`, and every route offline — goes wrong the other way: it removes only up to the end's position inside the table and leaves part of the table behind.[^partial]

The fix lives in [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts): one check for a range that crosses a table's edge, one removal that takes the whole table and stops at its far edge, wired into every route that removes a range. That is how the editor's *stale-focus guard* already works ([MarkdownEditor.ts:906–1082](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L906)): its workaround for a Lexical crash when a removed range ends inside a later block's word.

---

## Architecture Decisions

### A range that crosses a table's edge covers the whole table, and stops at its far edge

A *table-edge range* is a non-collapsed range with one end inside a table (in a cell, or on the table node itself) and the other end outside that table. Removing it removes the selected content outside the table and the whole table. It never touches the block on the table's far side: nothing there is removed and nothing is joined.[^contract]

In the table, `│` marks a selection end.

| Selection | Delete gives |
|---|---|
| `Abov│e para` → anywhere in a cell | `Abov` and `after`, still two paragraphs |
| anywhere in a cell → `af│ter` | `Above para` and `ter`, still two paragraphs |
| `Abov│e para` → `af│ter` (both ends outside) | `Abovter` — unchanged: the selection holds text of both blocks, so they join |

A range with both ends in different tables is a table-edge range for each of them: both tables and everything between are removed.

### Mirror the stale-focus guard: one shape check, one removal, every route

The approach copies the editor's stale-focus guard: a shape predicate (`$isStaleFocusRange`, [:924](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L924)), one removal function (`$removeStaleFocusRange`, [:947](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L947)), one listener per route registered at `COMMAND_PRIORITY_CRITICAL` ([:3728–3740](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3728)), and a `$removeRangeIfStaleFocus` call in each public method that replaces a range ([:962](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L962)). The table-edge guard gets its own predicate, removal and listeners, registered **ahead of** the stale-focus listeners at the same priority.[^precedent] Cut is the one route whose existing listener is widened instead.

### Preempt `@lexical/table`'s key handler from `KEY_BACKSPACE_COMMAND` and `KEY_DELETE_COMMAND`

`@lexical/table` rewrites the selection on the key commands, before `DELETE_CHARACTER_COMMAND` is dispatched. So two new `COMMAND_PRIORITY_CRITICAL` listeners on the key commands catch a table-edge range first. They call `event.preventDefault()`, dispatch `DELETE_CHARACTER_COMMAND` themselves, and return `true`. This is the body of `@lexical/rich-text`'s own key handlers ([index.ts:1523–1577](../node_modules/@lexical/rich-text/src/index.ts#L1523)), so the delete listener chain still runs.[^key]

### Move the inside end to the table's outer edge, and remove in the same update

The removal moves each inside end to an *element point* on the table's parent: a point given as "parent node, child index" instead of "text node, character offset". The start goes to the table's own index (just before it). The end goes to that index plus one (just after it). That is the only kind of point that lies past the table and in no block. The move and the removal always happen in one update. A selection moved this way is never committed on its own.[^element-point]

### The caret lands where the removed range started

After the removal the caret is collapsed at the range's start. When that start was moved to a table's edge, the caret sits between two blocks, and it is moved into a block:

| Where the removed range started | Caret goes to |
|---|---|
| inside a block (`Abov│e para`) | stays there: `Abov`, offset 4 |
| at a table's position, and a block follows it in the same parent | the start of that block: `ter`, offset 0 |
| at a table's position, no block follows, one precedes (table was a column's last block) | the end of that block |
| at a table's position, and the parent now holds no block (table was a column's only block) | a new empty paragraph in that parent |

The move uses Lexical's caret helpers, as `$moveSelectionIntoColumnContent` ([:615](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L615)) does.[^caret]

### The `DELETE_CHARACTER_COMMAND` table-edge listener runs at CRITICAL, ahead of `$joinIntoTextOnlyBlock`

The stale-focus guard's `DELETE_CHARACTER_COMMAND` listener sits at `COMMAND_PRIORITY_HIGH`, after `$joinIntoTextOnlyBlock` ([:3728–3730](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3728)). The table-edge listener does not follow it there: it runs at `COMMAND_PRIORITY_CRITICAL`, before `$joinIntoTextOnlyBlock`.[^critical]

### Cut: widen `$cutStaleFocusRange` into `$cutGuardedRange`

`$cutStaleFocusRange` ([:1059](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1059)) already copies first and removes in a later update tagged `CUT_TAG`. It is renamed `$cutGuardedRange`. It now also takes a table-edge range, and its later update removes a table-edge range first.[^cut]

### Test the key and cut routes against the real `@lexical/table` handlers in jsdom

The offline test DOM never registers `@lexical/table`'s handlers, so a test there cannot fail for the key and cut routes. Those routes get a jsdom test file. It gives the editor a real root element and registers `registerTableSelectionObserver` itself, as `mountWysiwyg` does ([:3761–3771](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3761)). The same file holds a *canary*: a test that asserts the upstream bug is still there, so a Lexical upgrade that fixes it is noticed.[^jsdom]

---

## Internal Structure

New module-level functions, placed directly after `$cutGuardedRange` (today's `$cutStaleFocusRange`, ending at [:1082](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1082)). Write full JSDoc per CODE_CONVENTIONS; the bodies are:

```typescript
function $findTableHolding(node: LexicalNode): TableNode | null {
    return $findMatchingParent(node, $isTableNode);
}

function $isTableEdgeRange(selection: BaseSelection | null): selection is RangeSelection {
    if (!$isRangeSelection(selection) || selection.isCollapsed()) {
        return false;
    }

    const anchorTable = $findTableHolding(selection.anchor.getNode());
    const focusTable = $findTableHolding(selection.focus.getNode());

    if (anchorTable === null || focusTable === null) {
        return anchorTable !== focusTable;
    }

    return !anchorTable.is(focusTable);
}

function $coverWholeTables(selection: RangeSelection): void {
    const [start, end] = selection.isBackward() ? [selection.focus, selection.anchor] : [selection.anchor, selection.focus];
    const startTable = $findTableHolding(start.getNode());
    const endTable = $findTableHolding(end.getNode());

    if (startTable !== null && !startTable.is(endTable)) {
        start.set(startTable.getParentOrThrow().getKey(), startTable.getIndexWithinParent(), "element");
    }

    if (endTable !== null && !endTable.is(startTable)) {
        end.set(endTable.getParentOrThrow().getKey(), endTable.getIndexWithinParent() + 1, "element");
    }
}

function $settleCaretIntoBlock(selection: RangeSelection): void {
    const parent = selection.anchor.getNode();

    if (!selection.isCollapsed() || selection.anchor.type !== "element" || !$isElementNode(parent) || !$isRootOrShadowRoot(parent)) {
        return;
    }

    const next = parent.getChildAtIndex(selection.anchor.offset);
    const previous = parent.getChildAtIndex(selection.anchor.offset - 1);
    let caret: PointCaret<CaretDirection>;

    if ($isElementNode(next)) {
        caret = $normalizeCaret($getChildCaret(next, "next"));
    } else if ($isElementNode(previous)) {
        caret = $normalizeCaret($getChildCaret(previous, "previous"));
    } else {
        const paragraph = $createParagraphNode();

        parent.append(paragraph);
        caret = $getChildCaret(paragraph, "next");
    }

    $setPointFromCaret(selection.anchor, caret);
    $setPointFromCaret(selection.focus, caret);
}

function $removeTableEdgeRange(selection: RangeSelection): void {
    $coverWholeTables(selection);

    // A covered range can still end inside a later block's word: that is a stale-focus range.
    $removeRangeIfStaleFocus(selection);
    selection.removeText();   // a no-op once $removeRangeIfStaleFocus removed it
    $settleCaretIntoBlock(selection);
}

function $removeRangeIfTableEdge(selection: RangeSelection): void {
    if ($isTableEdgeRange(selection)) {
        $removeTableEdgeRange(selection);
    }
}
```

The route listeners. Each is named and module-level, like the stale-focus listeners:

```typescript
/** DELETE_CHARACTER / DELETE_WORD / DELETE_LINE / REMOVE_TEXT: removes a table-edge range itself. */
function $deleteTableEdgeRange(): boolean {
    const selection = $getSelection();

    if (!$isTableEdgeRange(selection)) {
        return false;
    }

    $removeTableEdgeRange(selection);

    return true;
}

/** INSERT_PARAGRAPH / INSERT_LINE_BREAK / INSERT_TAB / PASTE / CONTROLLED_TEXT_INSERTION. */
function $clearTableEdgeRangeBeforeInsert(): boolean {
    const selection = $getSelection();

    if ($isTableEdgeRange(selection)) {
        $removeTableEdgeRange(selection);
    }

    return false;
}

/** SELECTION_INSERT_CLIPBOARD_NODES. */
function $clearTableEdgeRangeBeforePaste(payload: CommandPayloadType<typeof SELECTION_INSERT_CLIPBOARD_NODES_COMMAND>): boolean {
    if ($isTableEdgeRange(payload.selection)) {
        $removeTableEdgeRange(payload.selection);
    }

    return false;
}

function $deleteTableEdgeRangeFromKey(event: CommandPayloadType<typeof KEY_DELETE_COMMAND>, editor: LexicalEditor, isBackward: boolean): boolean {
    if (!$isTableEdgeRange($getSelection())) {
        return false;
    }

    event.preventDefault();

    return editor.dispatchCommand(DELETE_CHARACTER_COMMAND, isBackward);
}

function $backspaceOverTableEdgeRange(event: CommandPayloadType<typeof KEY_BACKSPACE_COMMAND>, editor: LexicalEditor): boolean {
    return $deleteTableEdgeRangeFromKey(event, editor, true);
}

function $deleteKeyOverTableEdgeRange(event: CommandPayloadType<typeof KEY_DELETE_COMMAND>, editor: LexicalEditor): boolean {
    return $deleteTableEdgeRangeFromKey(event, editor, false);
}
```

`$isTableEdgeRange`'s JSDoc carries an `@remarks` saying: in a browser `@lexical/table` grows such a range over the whole table; its own Backspace/Delete/cut then joins the block on the table's far side; every route removing a range in this editor checks for this shape first and removes it through `$removeTableEdgeRange`. Do not `{@link}` `@lexical/table` internals; name them in prose.

---

## Ordered Implementation Steps

1. **Create `packages/lib/tests/component/markdown-editor-table-edge.test.ts`** (node, modelled DOM). Copy the `vi.mock('@lexical/clipboard', …)` block, `CONFIG`, `beforeEach`/`afterEach`, `TextPoint`, `lexicalOf`, `load` and `$textNode` from [markdown-editor-command-crashes.test.ts:1–75](../packages/lib/tests/component/markdown-editor-command-crashes.test.ts#L1), importing only what the new file uses. Add:
   - the document and result constants listed under *Expected Behaviour → Offline rows*;
   - a selection-end type `End = TextPoint | 'last-cell-end' | 'first-cell-start' | 'table-start'`, resolved against the document's **first** table (`$dfs()` + `$isTableNode`). `'last-cell-end'` is `focus.set(lastCell.getKey(), lastCell.getChildrenSize(), 'element')` on the last row's last cell. `'first-cell-start'` is offset 0, element, on the first row's first cell. `'table-start'` is offset 0, element, on the `TableNode` itself;
   - `select(editor, anchor: End, focus: End)`, a discrete update like `selectText`.
   Write every row of *Expected Behaviour → Offline rows*. Run `npx vitest run tests/component/markdown-editor-table-edge.test.ts` from `packages/lib`. The D, R and U rows fail; the G rows pass.
2. **Create `packages/lib/tests/component/markdown-editor-table-edge-mounted.test.ts`** with the `// @vitest-environment jsdom` pragma and a header comment saying why (follow [activation-after-dispose.test.ts:1–19](../packages/lib/tests/component/activation-after-dispose.test.ts#L1); do not call `installTestDOM`). Same `vi.mock('@lexical/clipboard', …)`, and the same `TextPoint`, `lexicalOf`, `load`, `$textNode`, `End` and `select` helpers as step 1. Add a `mount(editor)` helper: `document.createElement('div')`, set `contentEditable = 'true'`, append it to `document.body`, call `lexicalOf(editor).setRootElement(root)`, then `registerTableSelectionObserver(lexicalOf(editor), true)`. In `beforeEach`, `vi.stubGlobal('ClipboardEvent', class ClipboardEvent {})` and give `document` an `execCommand` returning `true`; jsdom has neither, and `@lexical/table`'s cut handler uses both while the fix is missing. Write rows K1–K5. Run it: K1–K4 fail (`Abovafter` / `Above parater`); K5 passes.
3. **Imports in `MarkdownEditor.ts`** ([:19–33](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L19)). Add `KEY_BACKSPACE_COMMAND`, `KEY_DELETE_COMMAND`, `$isRootOrShadowRoot` and `$getChildCaret` to the `"lexical"` value import. Add `PointCaret` and `CaretDirection` to the `"lexical"` type import. Add `$isTableNode` to the `"@lexical/table"` import ([:45–53](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L45)).
4. **Rename `$cutStaleFocusRange` to `$cutGuardedRange`** ([:1047–1082](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1047)):
   - its guard becomes `const selection = $getSelection(); if (!$isStaleFocusRange(selection) && !$isTableEdgeRange(selection)) { return false; }`;
   - inside the deferred `editor.update`, add `$removeRangeIfTableEdge(selection);` on the line above `$removeRangeIfStaleFocus(selection);`;
   - its JSDoc summary becomes "`CUT_COMMAND` listener for a table-edge or stale-focus range", and says the range is removed through `$removeTableEdgeRange` or `$removeStaleFocusRange`.
5. **Add the table-edge functions** from *Internal Structure* directly after `$cutGuardedRange`, each with full JSDoc.
6. **Route the three public methods.** Add `$removeRangeIfTableEdge(selection);` on the line directly above `$removeRangeIfStaleFocus(selection);` in `cut()` ([:3045](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3045)), `paste()` ([:3082](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3082)) and `insertImage()` ([:3345](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3345)). Check: `grep -n 'removeRangeIfStaleFocus(selection)' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` lists five call sites: the one inside `$removeTableEdgeRange`, and four (`$cutGuardedRange`, `cut()`, `paste()`, `insertImage()`) each directly preceded by a `$removeRangeIfTableEdge(selection);` line.
7. **Register the listeners** in `ensureEditor`'s `mergeRegister`. Insert this block on the line directly above `editor.registerCommand(DELETE_WORD_COMMAND, $deleteStaleFocusRange, COMMAND_PRIORITY_CRITICAL),` ([:3731](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3731)):
   ```typescript
                   // Ahead of the stale-focus guards at their priority: a table-edge range ending inside
                   // a later block's word is a stale-focus range too, and must lose the whole table.
                   editor.registerCommand(KEY_BACKSPACE_COMMAND, $backspaceOverTableEdgeRange, COMMAND_PRIORITY_CRITICAL),
                   editor.registerCommand(KEY_DELETE_COMMAND, $deleteKeyOverTableEdgeRange, COMMAND_PRIORITY_CRITICAL),
                   editor.registerCommand(DELETE_CHARACTER_COMMAND, $deleteTableEdgeRange, COMMAND_PRIORITY_CRITICAL),
                   editor.registerCommand(DELETE_WORD_COMMAND, $deleteTableEdgeRange, COMMAND_PRIORITY_CRITICAL),
                   editor.registerCommand(DELETE_LINE_COMMAND, $deleteTableEdgeRange, COMMAND_PRIORITY_CRITICAL),
                   editor.registerCommand(REMOVE_TEXT_COMMAND, $deleteTableEdgeRange, COMMAND_PRIORITY_CRITICAL),
                   editor.registerCommand(INSERT_PARAGRAPH_COMMAND, $clearTableEdgeRangeBeforeInsert, COMMAND_PRIORITY_CRITICAL),
                   editor.registerCommand(INSERT_LINE_BREAK_COMMAND, $clearTableEdgeRangeBeforeInsert, COMMAND_PRIORITY_CRITICAL),
                   editor.registerCommand(INSERT_TAB_COMMAND, $clearTableEdgeRangeBeforeInsert, COMMAND_PRIORITY_CRITICAL),
                   editor.registerCommand(PASTE_COMMAND, $clearTableEdgeRangeBeforeInsert, COMMAND_PRIORITY_CRITICAL),
                   editor.registerCommand(CONTROLLED_TEXT_INSERTION_COMMAND, $clearTableEdgeRangeBeforeInsert, COMMAND_PRIORITY_CRITICAL),
                   editor.registerCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, $clearTableEdgeRangeBeforePaste, COMMAND_PRIORITY_CRITICAL),
   ```
   Change the cut registration ([:3740](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3740)) to `$cutGuardedRange`. Check: `grep -rn 'cutStaleFocusRange' packages/lib/src packages/lib/tests` finds nothing.
8. **Run both new test files.** Every row passes. Then run `npx vitest run tests/component/markdown-editor-command-crashes.test.ts tests/component/markdown-editor.test.ts tests/component/markdown-editor-columns.test.ts`; all pass unchanged.
9. **Docs.** At the end of the **Tables.** bullet of [MarkdownEditor.md:96](../packages/lib/docs/components/MarkdownEditor.md#L96), append: "A selection that runs from outside a table into one of its cells covers the whole table, as the editor highlights it: deleting, cutting, typing or pasting over it removes the selected text outside the table and the whole table, and leaves the block on the table's far side as it was." In [changelog/next.md](../packages/lib/docs/reference/changelog/next.md#L507), under *Fixed → Components*, insert the entry from *Documentation Impact* directly after the entry that starts `- **\`MarkdownEditor\` no longer throws when deleting from the start of a`.
10. **Full verification** — see *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Create | `packages/lib/tests/component/markdown-editor-table-edge.test.ts` |
| Create | `packages/lib/tests/component/markdown-editor-table-edge-mounted.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Notation: `"Above para"@4` is the text node whose text is `Above para`, offset 4. `last-cell-end`, `first-cell-start` and `table-start` are the `End` values from step 1. "Delete" is `DELETE_CHARACTER_COMMAND` with `false`, "Backspace" is the same command with `true`. Results are `getValue()`.

### Offline rows — `markdown-editor-table-edge.test.ts` (unit-testable)

Dispatch commands outside an update, as row R3 of the crash tests does, then read `getValue()`. The documents and the longer expected values, as the test file's constants:

```typescript
const T = '| a | b |\n| --- | --- |\n| c1 | d1 |';
const T2 = '| x |\n| - |\n| y |';
const DOC = `Above para\n\n${T}\n\nafter`;
const TABLE_LAST = `Above para\n\n${T}`;
const TABLE_FIRST = `${T}\n\nafter`;
const TWO_PARAS = `p1 text\n\np2 text\n\n${T}\n\nafter`;
const TWO_TABLES = `Above para\n\n${T}\n\nmid\n\n${T2}\n\nafter`;
const CODE_ABOVE = `\`\`\`\ncode\n\`\`\`\n\n${T}\n\nafter`;
const CODE_ABOVE_RESULT = '```\nco\n```\n\nafter';
const CODE_BELOW = `Above para\n\n${T}\n\n\`\`\`\ncode\n\`\`\``;
const CODE_BELOW_RESULT = 'Above para\n\n```\nde\n```';
const COLUMN_BEFORE_TABLE = `::: columns\nA\n|||\nbefore\n\n${T}\n:::\n\nafter`;
const COLUMN_BEFORE_TABLE_RESULT = '::: columns\nA\n|||\nbefore\n:::\n\nter';
const COLUMN_ONLY_TABLE = `::: columns\nA\n|||\n${T}\n:::\n\nafter`;
const COLUMN_ONLY_TABLE_RESULT = '::: columns\nA\n|||\n\n:::\n\nter';
const ONE_CELL_EDITED = 'Above para\n\n| a | b |\n| --- | --- |\n| 1 | d1 |\n\nafter';
```

**D — what a delete leaves.**

| # | Document | Selection | Action | Result | Caret after |
|---|---|---|---|---|---|
| D1 | `DOC` | `"Above para"@4` → `last-cell-end` | Delete | `Abov\n\nafter` | `"Abov"@4` |
| D2 | `DOC` | `"Above para"@4` → `"c1"@1` | Delete | `Abov\n\nafter` | `"Abov"@4` |
| D3 | `DOC` | `last-cell-end` → `"Above para"@4` (backward) | Backspace | `Abov\n\nafter` | `"Abov"@4` |
| D4 | `DOC` | `first-cell-start` → `"after"@2` | Delete | `Above para\n\nter` | `"ter"@0` |
| D5 | `DOC` | `"after"@2` → `"d1"@1` (backward) | Backspace | `Above para\n\nter` | `"ter"@0` |
| D6 | `DOC` | `table-start` → `"after"@2` | Delete | `Above para\n\nter`; the root holds exactly two paragraphs (no empty table left) | `"ter"@0` |
| D7 | `DOC` | `first-cell-start` → `"after"@5` | Delete | `Above para`; the root holds `Above para` and one empty paragraph | element point, offset 0, on that empty paragraph |
| D8 | `DOC` | `first-cell-start` → `"after"@0` | Delete | `Above para\n\nafter` | `"after"@0` |
| D9 | `TABLE_LAST` | `"Above para"@4` → `last-cell-end` | Delete | `Abov` | `"Abov"@4` |
| D10 | `TABLE_FIRST` | `first-cell-start` → `"after"@2` | Delete | `ter` | `"ter"@0` |
| D11 | `TWO_PARAS` | `"p1 text"@2` → `last-cell-end` | Delete | `p1\n\nafter` | `"p1"@2` |
| D12 | `TWO_TABLES` | `"c1"@1` → `"y"@1` | Delete | `Above para\n\nafter` | `"after"@0` |
| D13 | `CODE_ABOVE` | `"code"@2` → `last-cell-end` | Delete | `CODE_ABOVE_RESULT` — nothing joins the code block | `"co"@2` |
| D14 | `CODE_BELOW` | `first-cell-start` → `"code"@2` | Delete | `CODE_BELOW_RESULT` | `"de"@0` |
| D15 | `COLUMN_BEFORE_TABLE` | `first-cell-start` → `"after"@2` | Delete | `COLUMN_BEFORE_TABLE_RESULT` | `"before"@6` |
| D16 | `COLUMN_ONLY_TABLE` | `first-cell-start` → `"after"@2` | Delete | `COLUMN_ONLY_TABLE_RESULT`; the second column holds one empty paragraph | element point, offset 0, on that paragraph |

**R — every route.** Document `DOC`, selection `"Above para"@4` → `last-cell-end`, unless given.

| # | Action | Result |
|---|---|---|
| R1 | `DELETE_WORD_COMMAND`, `false` | `Abov\n\nafter` |
| R2 | `CONTROLLED_TEXT_INSERTION_COMMAND`, `'x'` | `Abovx\n\nafter` |
| R3 | `CONTROLLED_TEXT_INSERTION_COMMAND`, `'x'`, selection `first-cell-start` → `"after"@2` | `Above para\n\nxter` |
| R4 | `INSERT_PARAGRAPH_COMMAND` | `Abov\n\nafter`; the root holds `Abov`, an empty paragraph, `after`; the caret is in the empty paragraph |
| R5 | `INSERT_PARAGRAPH_COMMAND`, selection `first-cell-start` → `"after"@2` | `Above para\n\nter`; the root holds `Above para`, an empty paragraph, `ter`; caret `"ter"@0` |
| R6 | `editor.cut()` | `Abov\n\nafter` |
| R7 | `CUT_COMMAND`, `null` | `Abov\n\nafter` once `vi.waitFor` settles; `copyToClipboard` called once |
| R8 | `await editor.paste()`, `DOM.source.readClipboardText` mocked to `'zz'` | `Abovzz\n\nafter` |
| R9 | `editor.insertImage('/i.png', { alt: 'i' })` | `Abov![i](/i.png)\n\nafter` |

**U — undo restores exactly.** Read `getValue()` before dispatching `UNDO_COMMAND`.[^undo-flush]

| # | Steps | Result |
|---|---|---|
| U1 | D1, then `UNDO_COMMAND` | `getValue() === DOC`; the selection's anchor is `"Above para"@4` and its focus is the element point at the end of the last cell |
| U2 | R2, then `UNDO_COMMAND` | `getValue() === DOC` |
| U3 | R6, then `UNDO_COMMAND` | `getValue() === DOC` |

**G — unchanged behaviour** (these pass before and after the fix).

| # | Selection | Action | Result |
|---|---|---|---|
| G1 | `"Above para"@4` → `"after"@2` (both ends outside the table) | Delete | `Abovter` |
| G2 | `"c1"@0` → `"c1"@1` (inside one cell) | Delete | `ONE_CELL_EDITED` |

### Mounted rows — `markdown-editor-table-edge-mounted.test.ts` (unit-testable, jsdom)

Each row loads `DOC`, calls `mount(editor)`, sets the selection, and dispatches the command inside `lexicalOf(editor).update(…, { discrete: true })`. Key events are `new KeyboardEvent('keydown', { cancelable: true })`.

| # | Selection | Action | Result | Without the fix |
|---|---|---|---|---|
| K1 | `"Above para"@4` → `last-cell-end` | `KEY_DELETE_COMMAND` | `Abov\n\nafter`; `event.defaultPrevented` is `true` | `Abovafter` |
| K2 | `"Above para"@4` → `last-cell-end` | `KEY_BACKSPACE_COMMAND` | `Abov\n\nafter` | `Abovafter` |
| K3 | `first-cell-start` → `"after"@2` | `KEY_DELETE_COMMAND` | `Above para\n\nter` | `Above parater` |
| K4 | `"Above para"@4` → `last-cell-end` | `CUT_COMMAND`, `null` | `Abov\n\nafter` once `vi.waitFor` settles | `Abovafter` |
| K5 | canary, plain Lexical: `createEditor({ nodes: [HeadingNode, QuoteNode, TableNode, TableRowNode, TableCellNode], onError })`, a jsdom root element, `registerRichText`, `registerTablePlugin`, `registerTableSelectionObserver(editor, true)`; root = paragraph `Above para`, `$createTableNodeWithDimensions(2, 2, true)`, paragraph `after`; select `Above para`@4 → end of the last cell | `KEY_DELETE_COMMAND` | the root's children's text is `['Abovafter']` | — |

Give K5 the comment: *when this fails after a Lexical upgrade, `@lexical/table` no longer joins the block after a table; the two key listeners `$backspaceOverTableEdgeRange` / `$deleteKeyOverTableEdgeRange` may then be removable — keep the rest of the table-edge guard, which also covers routes `@lexical/table` never handled.*

### Manual (browser) checks

Run `npm run dev` at the repo root and open **MD Editor**. Replace the content with `DOC`.

| # | Steps | Expected |
|---|---|---|
| M1 | Drag from the middle of `Above` into `d1`. Press Delete | the whole table highlights while dragging; afterwards `Abov` and `after` are two paragraphs; the caret is after `Abov` |
| M2 | Ctrl/Cmd+Z after M1 | the document is back as loaded, with the same selection highlighted |
| M3 | Repeat M1's drag; in turn press Backspace, Ctrl/Cmd+X, type `x`, press Enter, press Ctrl+Backspace (undo between each) | `after` stays its own untouched paragraph every time; no part of the table is left; Ctrl/Cmd+V after the cut pastes the cut content |
| M4 | Drag from `c1` down into the middle of `after`. Press Delete | `Above para` is untouched; the rest of `after` is its own paragraph with the caret at its start |
| M5 | Drag from `a`, across `b` (cells highlight as a block), then down out of the table into `after`. Press Delete | as M4; no empty table is left (switch to source mode: no stray table lines) |
| M6 | Drag from `c1` into `d1` (table selection). Press Delete | the two cells are cleared; the table keeps its shape (unchanged) |
| M7 | Drag from the middle of `Above` into the middle of `after`. Press Delete | `Abov` and the rest of `after` join into one paragraph (unchanged) |

---

## Verification

- `npm run typecheck` and `npm -w packages/lib run typecheck:test` (repo root).
- `npm run lint` (repo root): no new findings; `local/no-raw-dom` is not affected (no DOM access is added to `src`).
- From `packages/lib`: `npx vitest run tests/component/markdown-editor-table-edge.test.ts tests/component/markdown-editor-table-edge-mounted.test.ts` — every row passes.
- `npm test` (repo root): full suite green, including `markdown-editor-command-crashes.test.ts` and `tests/unit/import-without-dom.test.ts`.
- `npm run docs:api` (repo root): zero warnings.
- The manual checks M1–M7.

---

## Documentation Impact

No public API changes. The behaviour change gets the MarkdownEditor.md sentence from step 9 and this changelog entry:

```markdown
- **`MarkdownEditor` no longer joins the block after a table into a deleted
  selection.** Deleting a selection that ran from a paragraph into a table
  cell removed the table, then joined the paragraph after the table onto the
  rest of the first one (from the middle of `Above` into a cell, Delete gave
  `Abovafter`). A selection from a cell down into a paragraph joined that
  paragraph's rest onto the block above the table. Typing, pasting, Enter or
  Ctrl+Backspace over such a selection left part of the table behind instead.
  A selection that reaches into a table now covers the whole table: the edit
  removes the selected text and the table, and the block on the table's far
  side stays as it was. No consumer action is needed.
```

---

## Potential Challenges

- **Registration order inside one priority.** Lexical runs a priority's listeners in registration order, and a table-edge range ending inside a later block's word is also a stale-focus range. Keep the new block above the first CRITICAL stale-focus registration, as step 7 places it.
- **Undo in tests.** A command dispatched outside an update commits on a microtask. An `UNDO_COMMAND` sent before that commit undoes nothing. Read `getValue()` first.[^undo-flush]
- **jsdom gaps in the red phase.** Before the fix, `@lexical/table`'s cut handler runs and needs `ClipboardEvent` and `document.execCommand`. Without step 2's stubs, K4 fails with a `ReferenceError` instead of the wrong value.
- **A raw HTML block as the far block.** Deleting into the first line of an HTML block re-reads that block as Markdown, as any edit there does, so it can turn into a paragraph. This is existing behaviour; keep raw blocks out of the expected-value rows.[^raw-relex]

---

## Critical Files

- [MarkdownEditor.ts:895–1082](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L895) — `$findEnclosingBlock` and the stale-focus guard this plan mirrors and extends.
- [MarkdownEditor.ts:1084–1170](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1084) — `$joinIntoTextOnlyBlock` / `$deleteRangeFromTextOnlyBlock`, which the CRITICAL delete listener runs ahead of.
- [MarkdownEditor.ts:535–575](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L535) — `$getRootChild` / `$wrapSelectedTopLevelBlocks`: a selection reaching into a table counts as the whole table.
- [MarkdownEditor.ts:600–630](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L600) — `$moveSelectionIntoColumnContent`, the caret-helper precedent.
- [MarkdownEditor.ts:3032–3090, 3319–3350, 3694–3771](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3032) — `cut()`, `paste()`, `insertImage()`, `ensureEditor`'s registrations, `mountWysiwyg`.
- [LexicalTableSelectionHelpers.ts:701–783, 1168–1240](../node_modules/@lexical/table/src/LexicalTableSelectionHelpers.ts#L701) — `$deleteCellHandler`, the cut handler, `$fixRangeSelectionForSelectedTable`.
- [LexicalNode.ts:1948–1998](../node_modules/lexical/src/LexicalNode.ts#L1948) — `selectPrevious` / `selectNext`.
- [markdown-editor-command-crashes.test.ts](../packages/lib/tests/component/markdown-editor-command-crashes.test.ts) and [activation-after-dispose.test.ts](../packages/lib/tests/component/activation-after-dispose.test.ts) — the test helpers and the jsdom recipe.
- [plans/implemented/markdown-editor-command-crash-fixes.md](implemented/markdown-editor-command-crash-fixes.md) — the stale-focus guard's plan, its canary precedent, and manual check M5.

---

## Non-Goals

- **A `:::` fence whose only block is the table, selected into from outside the fence.** The removal can leave an emptied fence (`::: {}`). `@lexical/table`'s own handler leaves the same; it is column-structure behaviour.[^col-empty]
- **What a cut puts on the clipboard.** It is what Lexical copies from the selection. In a browser that is the grown selection, so it holds the whole table.
- **Ranges between cells of one table.** In a browser these are table selections; Delete clears the cells, unchanged.
- **The format of text typed over a range that starts in a table.** The typed text takes the format of the caret's new position.
- **Fixing `@lexical/table` upstream.** The canary K5 reports when an upgrade fixes it.

---

## Notes

[^root-cause]: `$deleteCellHandler` (registered on `KEY_BACKSPACE_COMMAND` and
    `KEY_DELETE_COMMAND` at `COMMAND_PRIORITY_HIGH`, once per table, by
    `registerTableSelectionObserver`) checks whether exactly one end is inside
    the table (`tableNode.isParentOf`). If so, it replaces the selection with
    `tableNode.selectNext()` (inside end after the outer end) or
    `tableNode.selectPrevious()`, restores the outer end, and returns `false`.
    `LexicalNode.selectNext` puts the point at `nextSibling.select(0, 0)` — the
    start of the paragraph after the table — and `selectPrevious` at
    `prevSibling.select()`, the end of the paragraph before it.
    `@lexical/rich-text`'s key handler then dispatches `DELETE_CHARACTER_COMMAND`.
    The range now runs from `Abov│` to the start of `after`, both outside the
    table. This editor's delete listeners see an ordinary range:
    `$joinIntoTextOnlyBlock` only acts on a start in a raw or code block, and
    `$isStaleFocusRange` needs an end strictly inside a text node. Lexical's
    `removeText` then joins `after` onto `Abov`, as it does for any range
    ending in a later block. Reproduced three ways: with plain Lexical in jsdom
    (`['Abovafter']`, row K5), through `MarkdownEditor` with the observer
    registered (`Abovafter`, `Above parater`), and by replaying the handler's
    selection change offline. The selection growth itself is
    `$fixRangeSelectionForSelectedTable`, which moves the inside end to the end
    of the table's last cell (or the start of its first).

[^partial]: Measured on this branch, offline, with the browser-shaped selection
    (`"Above para"@4` → end of the last cell): `DELETE_CHARACTER_COMMAND`,
    `DELETE_WORD_COMMAND`, Enter and `cut()` each give
    `Abov\n\n|  |\n| --- |\n\nafter`; typing `x`, `paste()` and `insertImage()`
    give the same with their content after `Abov`. A mirror cut gives
    `Above para\n\n|  |\n| --- |\n\nter`. A selection
    anchored on the table node itself, the shape `@lexical/table` leaves after
    a drag from cells out of the table, is not handled by `$deleteCellHandler`
    (it tests `isParentOf`, which is false for the table itself). Its delete
    leaves an empty table node with no rows in the document, which the save
    drops silently. A mirror range ending in a word, such as `"c1"@1` →
    `"after"@2`, is also a stale-focus range, and the stale-focus guard removes
    only part of the table.

[^contract]: The whole table, because that is what the editor shows selected:
    `@lexical/table` grows the highlight over the whole table, and its own
    handler means to delete the whole table too. The editor already reads a
    selection reaching into a table this way: `$wrapSelectedTopLevelBlocks`
    wraps the whole table (commit `18a3fa0f7`, rows B1–B3 of the crash tests).
    The crash-fixes plan's manual check M5 also expected "Delete removes the
    selected text and the whole table"; nobody checked the block after the
    table. Stopping at the far edge: a range that ends at a block boundary
    joins nothing, so the block beyond keeps its text and its type. Rejected:
    clearing only the selected cells and keeping the table, which contradicts
    the highlight and Lexical's own intent.

[^precedent]: The stale-focus guard is the editor's existing answer to "Lexical
    removes this shape of range wrongly". It already lists every route that
    removes a range, including the plain-text paste route found during its
    implementation. Separate listeners, rather than widening the stale-focus
    ones, because the two guards need different priorities on
    `DELETE_CHARACTER_COMMAND` (see the CRITICAL decision). Also, the
    stale-focus typing listener carries format handling that is specific to
    its own shape, and both sets of names stay accurate. Cut is the exception:
    its copy-then-remove-later body would otherwise be duplicated.

[^key]: Returning `true` keeps `$deleteCellHandler`, at `COMMAND_PRIORITY_HIGH`,
    from running. Dispatching `DELETE_CHARACTER_COMMAND` keeps the delete
    chain intact, including `markdownWritable.ts`'s run-edge tag listener.
    One difference from `@lexical/rich-text`: on iOS its Backspace handler
    skips `preventDefault()` so the keyboard's suggestion bar updates. These
    listeners prevent it, for a table-edge range only. Rejected: moving the
    ends in the key listener and returning `false`. The moved range would then
    reach `$joinIntoTextOnlyBlock`. For a start in a raw or code block, that
    handler's "later block" lookup climbs from the root-level end point to the
    root itself and detaches the rest of the document. The caret would also be
    left between blocks.

[^element-point]: Every other candidate point belongs to a block. The start of
    the next block is the bug itself. The end of the block before the table
    lands inside another table when two tables are adjacent, and does not
    exist when the table is a column's first block. The same-update rule:
    Lexical's commit does not move such a point, but the browser cannot show a
    caret "between blocks". The next native selection change would re-read
    the selection from the DOM and could put an end back inside the table.
    Prototyped outside the source (listeners registered on the editor from a
    scratch test) for the D rows, the typing, Enter, paste and image rows, and
    K1–K3: all matched, each with a clean undo.

[^caret]: Lexical's `removeText` collapses to the range's start, which is what
    editors do. When the start was moved, that start is an element point on
    the root or a column. Lexical's `insertParagraph` on such a point inserts
    a paragraph without removing the range (observed while prototyping), so
    the caret must be moved before any insert route continues.
    `$normalizeCaret($caretFromPoint(point, "next"))` does not descend from a
    point between blocks (it yields a sibling caret), hence `$getChildCaret` on
    the neighbouring block. The empty-parent fallback exists because
    `MarkdownColumnNode.canBeEmpty()` is `false`. Row D16 is the case.

[^critical]: The stale-focus listener sits after `$joinIntoTextOnlyBlock`
    because a range starting in a raw or code block must join the later
    block's rest as Markdown (crash-test row R14). A table-edge range has no
    rest to join once its end is moved to the table's edge. Left to
    `$joinIntoTextOnlyBlock` unmoved, that handler would join the cell's
    remaining text into the code block and leave a partial table. Row D13 pins
    the result.

[^cut]: A native cut removes in a later update than the command's own, since
    copying is async. That is why `$cutStaleFocusRange` exists, and it applies
    to table-edge ranges just the same. Without the widening,
    `@lexical/table`'s cut handler (`COMMAND_PRIORITY_HIGH`) runs
    `$deleteCellHandler` and then `removeText`. In jsdom that gave `Abovafter`.

[^jsdom]: `mountWysiwyg` registers `registerTableSelectionObserver` only when
    Lexical has a root element, which the modelled DOM never provides. So
    offline, `@lexical/table`'s key, cut and selection handlers do not exist.
    A key-route row there would pass with or without the fix. Giving the
    editor a jsdom element and registering the observer from the test runs the
    real handlers. That reproduced `Abovafter` and `Above parater` before the
    fix, and K1 gave the right result with a prototype of it. The canary follows
    the crash-fixes plan's two canaries, which tie each upstream workaround to
    the bug it exists for.

[^undo-flush]: `getValue()` reads through `editor.read`, which commits pending
    updates first. Measured: with `getValue()` before `UNDO_COMMAND` the
    document returns as loaded; without it, `UNDO_COMMAND` runs before the
    delete's update is recorded and the deleted document remains.

[^raw-relex]: Selecting just the `<d` of `<div>` inside the HTML block and
    deleting it, with no table involved, splits the block the same way: the
    remaining text no longer opens an HTML block, so the editor shows the
    blocks it would save as.

[^col-empty]: With `Above para`, then a fence whose second column holds only
    the table, a selection from `Abov│` into the table covers the whole first
    column. Lexical removes that column and empties the second. Replaying
    `$deleteCellHandler` gives the same end point (`selectNext` with no next
    sibling selects the column's end), so this plan neither causes nor changes
    the result.

---

## Implementation Notes

- **Red phase: D13 already passed before the fix.** Step 1 predicted every D
  row would fail. D13 (`"code"@2` → `last-cell-end` in `CODE_ABOVE`) gave
  `CODE_ABOVE_RESULT` unfixed too: `$joinIntoTextOnlyBlock` joins the end
  cell's rest, which is empty at the end of the last cell, and Lexical then
  removed the whole table. The row still pins the result, but not the
  CRITICAL decision `[^critical]` says it does. Row D17, added during the
  audit, is the case that decision is about: `"code"@2` → `"c1"@1` in
  `CODE_ABOVE` gives `CODE_ABOVE_RESULT`, caret `"co"@2`. It fails with the
  table-edge delete listener at `COMMAND_PRIORITY_HIGH` after
  `$joinIntoTextOnlyBlock`, and passes at CRITICAL.
- **`$removeTableEdgeRange` removes a range from a table into a later block
  in two steps** (`$removeRangeKeepingEndBlock`), not the plan's single
  `removeText()`. The scratch fuzz harness found the single removal broke
  the tree when the end block was emptied: Lexical 0.49.0 removes an emptied
  end block and every container it empties when the range starts between
  blocks, but leaves the root's last child in place, so a range from a table
  to the end of a list's last item left an empty list, and one to the end of
  a fence's only line left a `:::` block with no column (editor and viewer
  then disagreed, and later edits pasted text straight into the block). The
  removal now trims the end block up to the end first, then removes from the
  table's edge to the end block's own position. Neither step is a
  stale-focus range, so `$removeTableEdgeRange` no longer calls
  `$removeRangeIfStaleFocus`, and step 6's grep finds four call sites, each
  preceded by the table-edge removal (`$removeRangeIfTableEdge`, or in
  `insertImage()` the block described below). Rows D18–D20 pin the list,
  fence and heading cases; D18 and D19 failed before the change.
- **A column the end's table was the only block of keeps an empty
  paragraph** (`$refillEmptiedColumn`). Found by the same fuzz run: a range
  from a paragraph into a table that is its fence's only block emptied the
  column node itself (the caret settling only refills the start's parent),
  and a later list toggle saved what the editor did not show. This is the
  plan's non-goal shape; the fence still saves as `::: {}`, now with a valid
  column. Row D21 pins it.
- **Enter in a raw block over a table-edge range** is routed too, found by
  the audit: `$handleRawBlockEnter` calls `insertLineBreak()` directly and
  never dispatches the insert commands, so it now calls
  `$removeRangeIfTableEdge` first, as `cut()`/`paste()`/`insertImage()` do.
  Row R10 pins it (its expected value was first what the same Enter gives
  over the same text with no table, a line break ending the raw block; the
  review fixes below changed that). The removal runs before the handler
  checks for the block's start, so a backward range from a raw block into a cell above it
  leaves the caret at the block's start and Enter puts an empty paragraph
  before the block (row R17); checked after the removal, a line break there
  would have been dropped by the save. The handler takes the raw block at
  either end of a table-edge range, not only at the anchor, so the same
  range dragged the other way gives the same document (rows R18 and R19;
  before, the forward drag of R17's range left an empty raw block, and the
  backward drag of R10's range saved one line break fewer). When the removal
  leaves the caret outside the raw block — the table closed a `:::` column
  before it — the handler dispatches `INSERT_PARAGRAPH_COMMAND`, as
  `@lexical/rich-text`'s Enter does, instead of breaking the line the caret
  landed in (row R20). The stale-focus guard had the same gap on that
  route; the command-crash-fixes branch has since closed it (its row R17),
  and the handler here takes either shape through `$removeGuardedRange`
  (since round 2 of the review fixes, below, inside `$removeRangeBeforeEnter`,
  which removes any other range with an end in a raw block as well).
  After these changes the two-step path was re-checked in Chrome: a drag
  from `c1` into the middle of `two` in `Above para`, the table, `- one`,
  `- two` highlighted the table, and Delete left `Above para` and the list
  item `o`, caret at its start; Ctrl+Z restored the document.
- **Typing keeps the format of the range's first text node**
  (`$clearTableEdgeRangeBeforeTyping`), found by the last audit. The plan
  routed `CONTROLLED_TEXT_INSERTION_COMMAND` through
  `$clearTableEdgeRangeBeforeInsert`, and `[^precedent]` called the
  stale-focus typing listener's format handling specific to its own shape.
  It is not: any guard that collapses the range before Lexical's
  `insertText` loses the format Lexical would type in, so typing over a
  range from bold text into a table typed plain (`**Abov**x`). The typing
  route has its own listener, as the stale-focus guard has: a range that
  starts in text outside the table types in that text node's format and
  style (row R21). A range that starts in the table types in the format of
  the text the caret lands in, which is what the plan's non-goal says
  happens; before, it typed in whatever format the selection carried (row
  R26).
- **`insertImage()` keeps the image out of a raw block or code block the
  removal leaves the caret in** (`$moveCaretOutOfTextOnlyBlock`), found by
  the last audit. `insertImage()` declines a selection touching such a
  block, but checks the selection before the removal; a range from one
  table into another, or from a table closing a column, can leave the caret
  at the start of a code block after the table or at the end of one before
  it, and the image then became text of that block. The image now goes into
  a new paragraph where the table was (rows R22 and R23).
- **A cut and a copy put the whole table on the clipboard**
  (`$grownTableEdgeRange`), a deviation from the non-goal "What a cut puts
  on the clipboard", found by the last audit for the cut and decided by the
  user for the copy. The non-goal rests on the browser having grown the
  selection over the table. `@lexical/table` grows a range dragged into one
  table, but not one from a table into another
  (`$fixRangeSelectionForSelectedTable` moves an end only when the other end
  is in no table), and a selection set through the API is never grown. In
  both cases the cut removed whole tables and copied part of one. `cut()`
  and the native cut now read from a copy of the selection grown the way
  `@lexical/table` grows it — to the start of the first cell or the end of
  the last — which is never set as the editor's selection. The
  points `$coverWholeTables` sets cannot be used for this: Lexical's
  `getTextContent()` reads no text from the last text node of a range that
  ends between blocks. Rows R24 and R25 pin the two routes offline (R25
  with `$getClipboardDataFromSelection` replaced by the selection's text,
  since writing HTML needs a document); row K6 pins the native cut's text
  and HTML in jsdom with the real function. The docs sentence and the
  changelog entry say so.
  **Decided by the user on 2026-10-06: copy and cut both copy whole
  tables.** The reviews had left copying as it was — `copy()` and the
  native copy took the selection as it stands, on the ground that only a
  cut removes more than an ungrown selection holds — and asked the user.
  The user chose one rule: a copy or a cut of a table-edge range puts on
  the clipboard what the cut removes, on both routes, so Ctrl/Cmd+C,
  `copy()`, Ctrl/Cmd+X and `cut()` agree. `copy()` reads from the grown
  copy as `cut()` did, and `cut()` calls `copy()` again as it did before
  this branch (the private `copyWysiwygSelection(wholeTables)`, which
  existed only to tell the two apart, is gone). The native copy has a
  listener of its own, `$copyTableEdgeRange`, registered with the range
  guards: for a table-edge range it hands `copyToClipboard` the grown
  copy's data, as `$cutGuardedRange` does, and removes nothing; any other
  selection — inside one cell, over cells of one table, outside every
  table, or cells selected as a table selection — is left to Lexical's own
  copy and copied as it stands. It is at HIGH, not CRITICAL as the other
  guards: given no copy event, `copyToClipboard` has the browser fire one
  and takes it in a listener it registers at CRITICAL for that long, and
  that event belongs to the copy or cut already under way. A copy changes
  neither the document, the selection nor the undo stack. Rows R28 (written
  first, seen to fail): for a paragraph-to-cell range in both directions,
  a cell-to-following-paragraph range in both directions and a two-table
  range, `copy()` writes the text `cut()` writes and the native copy hands
  on the data the native cut hands on; the copy event is handed on; the
  listener stays behind a CRITICAL one; neither copy is an undo step; the
  three ranges that cross no table's edge and a cell selection are left as
  they stand. Row K7 pins the native copy's text, HTML and Lexical nodes
  against the native cut's in jsdom. Each of these fails a row when taken
  out: `copy()` reading the selection as it stands, the listener's
  registration, its table-edge test (widened to any range, and to any
  selection), the event it hands on, the grown copy in it, and its
  priority raised to CRITICAL. Checked in Chrome against this worktree's
  dev server, in the demo's MD Editor: a drag from the quote above the
  table into a cell (which `@lexical/table` grows over the table), then
  Ctrl+C, put the quote's selected text and the whole table on the
  clipboard, as text and as HTML, and left the document and the selection
  as they were; Ctrl+V in the empty paragraph below brought the table in
  whole. A native selection from a cell of that table into a cell of the
  pasted one stayed ungrown; Ctrl+C put both tables and the blocks between
  them on the clipboard and left the selection ungrown, Ctrl+X put the same
  text and HTML there and removed them, and Ctrl+Z restored the document.
  Three letters selected inside one cell copied as those letters alone. Checked in Chrome against this worktree's dev
  server, with `**Above para**`, the table, `mid`, a second table and
  `after`: a native selection from `c1` into the second table's `x` stayed
  ungrown (text points in both cells); Ctrl+X put both tables and `mid` on
  the clipboard, whole, as text and as HTML, left `Above para` and `after`,
  and Ctrl+Z restored the document and the selection. In the same document
  a selection from the middle of `Above para` into `d1` grew over the first
  table, and typing `x` over it gave bold `Abovx`.
- **Test helpers beyond the plan's list.** The offline file adds
  `$firstTable`, `$setEnd`, `$describePoint`/`caretOf` (caret as
  `"text"@offset` or `type@offset`), `caretBlockIndex`, `rootChildren` and
  `deleteRange`; the mounted file adds `mountedWithSelection` and
  `pressKey`. K4 dispatches `CUT_COMMAND` inside a discrete update, like the
  key rows.
- **Manual checks M1–M7, run in Chrome against this worktree's dev server.**
  M1–M4, M6 and M7 were driven by real mouse drags and key presses, and all
  matched. M2's undo restored the grown selection (anchor `Above para`@4,
  focus at the end of the last cell). M3's Ctrl+V after the cut pasted the
  cut content back (`Above para` and the table), with an empty paragraph
  after the table: that is Lexical's paste of block nodes at a paragraph's
  end, not this guard. M5 could not be driven as a path (the browser tool
  drags straight from one element to another, and a straight drag from a
  header cell out of the table ended collapsed), so its selection was set as
  a native DOM selection from the table element into `after`: Lexical read it
  as first-cell-start → `"after"`@2, all four cells highlighted, and Delete
  left exactly two paragraphs, `Above para` and `ter`. The table-node anchor
  shape itself is covered offline by D6.
- **A drag-and-drop move of a table-edge selection** (a drag that starts
  inside the highlighted selection) was hit by accident during M4: the
  source removal left `Abov` and kept `after` its own paragraph, and the
  dropped content landed at the drop point. No guard change was needed.
- **Scratch fuzz harness** (`b7fz.sh`, run/paste, seeds 601 1709 2207 3313
  4409 5521 6607 7703 8819 9907 11003, n=3000 each; baseline 0 signatures).
  The plan's single-removal implementation produced six `editParity`
  signatures across seeds 3313, 4409, 6607 and 7703 (the empty-list,
  column-less-fence and emptied-column cases above). With the two-step
  removal and the column refill, all eleven seeds give 0 signatures.
  The harness lived in a temporary directory and was lost before the last
  audit round, so the changes that round made (the `endsInLaterBlock` case
  for D22, the raw-block Enter changes, the typing, image and cut changes
  above, and the two-step removal's wider use below) were not run through
  it. They were run through a smaller
  seeded fuzz written for the purpose, also scratch: generated documents
  holding a table (at the root, in a fence or in a column), a random range
  with one end in a table and the other outside it, one of fourteen routes,
  then optionally a typed character or Enter; it checks for a throw, a
  table left attached, an empty list, table, row, fence or column, a
  changed block on the table's far side, and that the editor shows what the
  save reads as in the viewer and after a reload. The same eleven seeds at
  n=3000 give 0 failures; with the two-step removal disabled it reports
  the empty-container, parity and throw failures described above. It skips
  the parity check when a range end is in a raw block, where one divergence
  that needs no table shows: a raw block cut down to `<div` as the last
  line of the document or of a column shows as a raw block and reads in the
  viewer as a paragraph.
- **Rows R11–R16, added during the audit,** pin the six routes the plan's R
  table left untested: `DELETE_LINE_COMMAND`, `REMOVE_TEXT_COMMAND`,
  `INSERT_LINE_BREAK_COMMAND`, `INSERT_TAB_COMMAND`, a plain-text
  `PASTE_COMMAND`, and `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` through
  `$insertGeneratedNodes`. Each fails with its registration removed.
- **A table that opens a list item** (`listitem[table, "tail"]`, a shape the
  importer never builds but the serializer writes; no editing route was
  found that makes it, so the rows build it on the node tree). The table's
  outer edge is then a point inside the list item, a block, not between
  blocks. For a range from the table into the item's own text, the start,
  after covering, is an element point on that list item, which is also the
  end's block, so `$removeTableEdgeRange` takes the single-removal path
  (`endBlock.is(startNode)`), not the two-step one. Row D22 covers the
  shape, but as first written it asserted only the saved value and that no
  table was left, which the two-step path gives too; what differs is the
  caret, left on the list node. The review fixes below add the caret to D22
  and rows D27–D30, which do tell the two paths apart. D22's saved list is
  loose because the table made it loose, as a plain `remove()` of the table
  leaves it. For a range into the table from before the item,
  the covered end lies in the list item, a later block, and a single
  removal joined the item's text onto the start's block (`Abovtail`), or,
  from another table, left part of the item's table. The two-step removal
  is therefore taken whenever the covered end lies in a later block, not
  only when the range starts in a table, it keeps the start as the point it
  is (a text point, or a table's edge), and its first step starts at the
  end block's own start instead of a caret brought down into its first
  text, which a table opening the block would take in. Rows D23–D25 pin a
  start in a paragraph, in another table and in an earlier item of the
  list. Both changes reach the importer's shapes only through the first
  step's start point; the fuzz and every earlier row are unchanged by it,
  and the Chrome check of the two-step path was repeated afterwards: with
  `**Above para**`, the table, `- one`, `- two` and `after`, a selection
  from `c1` into the middle of `two` grew over the table, Delete left
  `Above para`, the list item `o` with the caret at its start, and `after`,
  and Ctrl+Z restored the document.
- **Two lists the table stood between join.** "Leaves the block on the
  table's far side as it was" has this one exception, which is the
  editor's existing rule for lists of one marker made next to each other
  (the *Lists* bullet of `MarkdownEditor.md`), not this guard: the list
  past the table keeps its items as they were, in the one list. Row D26
  pins it, and the *Tables* bullet says so.
- **Row R14 asserts the tab.** `@lexical/rich-text` inserts a tab at the
  caret on `INSERT_TAB_COMMAND` and the save trims it from the paragraph's
  end, so the saved value alone would not notice a listener that swallowed
  the command; the row also checks the paragraph's text.
- **Review fixes** (combined review of 2026-10-05, items B-1 to B-14).
  - *One guard listener per command* (`registerRangeGuards`, renamed from
    `registerStaleFocusRangeGuards`). The table-edge listeners had mirrored
    the stale-focus ones pair by pair, differing in predicate and remover,
    and their order rested on where `ensureEditor` listed them. Each command
    now has one listener, built on `$removeGuardedRange`, which takes a
    table-edge range ahead of a stale-focus one: `$deleteGuardedRange`,
    `$clearGuardedRangeBeforeInsert`, `$clearGuardedRangeBeforeLineBreak`,
    `$clearGuardedRangeBeforePastedText`, `$clearGuardedRangeBeforeTyping`,
    `$clearGuardedRangeBeforePaste` and `$cutGuardedRange`. `cut()`,
    `paste()` and `insertImage()` call `$removeGuardedRange` too, so
    `$removeRangeIfTableEdge` and `$removeRangeIfStaleFocus` are gone.
    `DELETE_CHARACTER_COMMAND` keeps two listeners, since its two guards sit
    either side of `$joinIntoTextOnlyBlock` (`$deleteTableEdgeRange` at
    CRITICAL, `$deleteStaleFocusRange` at HIGH). `ensureEditor` holds no
    registration of this branch any more. Each registration row, the order
    inside `$removeGuardedRange`, and the two "inserts nothing" checks were
    removed or swapped in turn; every one fails rows of this file or of
    `markdown-editor-command-crashes.test.ts`.
  - *A paste that inserts nothing leaves the range* (B-1). The table-edge
    listener sat on `PASTE_COMMAND` unconditionally, so a pasted screenshot
    or an empty clipboard deleted the range and the table. The merged
    listener reads the range's shape first, then `pasteWillInsertText`; the
    clipboard-nodes listener removes only when there are nodes. Rows R27.
    Known and accepted: plain text beside HTML that yields no node.
  - *The single-removal against two-step choice is pinned* (B-2): D22's
    caret, D27 and D28 fail without `!endBlock.is(startNode)`, D29 and D30
    throw without `!endBlock.isParentOf(startNode)` (`startParent` was
    renamed: it is the start's node, B-9). The third clause,
    `!$isRootOrShadowRoot(endBlock)`, changed no outcome: 18,000 fuzzed
    cases (six seeds) gave the same document with and without it, value and
    node tree. It is removed, so a range ending at the far edge of a table
    in a `:::` column the start is outside of now takes the two-step path
    with that column as the kept block (`endsApartFromStart`).
  - *`copy()` copied the selection as it stands*, pinned at the time by row
    R28 (B-3), which failed when `copy()` grew the range as `cut()` does.
    Replaced on 2026-10-06 by the user's decision that a copy copies whole
    tables as a cut does (see the cut-and-copy note above); R28 now pins
    that.
  - *An inserted image keeps to the table's side of an empty code block*
    (B-4). `$moveCaretOutOfTextOnlyBlock` read the side off the caret, and an
    empty block's start and end are one point. `$settleCaretIntoBlock` now
    takes `staysOutOf`, a test for the blocks the caret must not enter, and
    decides while the caret is still between the blocks. Lexical takes a caret left first or last in its parent into
    the neighbouring block itself, so `$removeTableEdgeRange` first puts it
    back on the table's edge. Rows R29, R30, R38–R40; R38 and R39 are shapes
    the fuzz caught in the first cut of this fix.
  - *Raw-block Enter re-checks the block's end after the removal* (B-5).
    Enter over a range is the removal, then Enter at the caret it leaves; at
    the raw block's end that is a new paragraph after the block, not a line
    break inside it. Rows R31 and R32. R10 and R19 changed with it: their
    range takes the rest of the raw block, so the caret is at the block's
    end, and the line break they expected was the one a reload drops.
  - *Shift+Enter is declined before the range is removed* (B-6). The break
    is declined at HIGH by `$declinesLineBreak`, after the CRITICAL guard had
    already removed the range, so Shift+Enter acted as Delete.
    `$tableEdgeRemovalDeclinesLineBreak` tells ahead whether the caret the
    removal leaves is where no break can be written
    (`$lineBreakUnwritableAt`, which `markdownWritable.ts` exports, and
    `$breakRuleContainerOf`, exported with it here), and the listener then
    swallows the command. Rows R33. A scratch differential
    (the fuzz's eleven seeds, 3,000 ranges each) compared it with removing
    the range and then pressing Shift+Enter: the two agree on whether a break
    goes in, and on the document when one does, except where an end of the
    range is in a raw Markdown block the removal makes read as another block
    (720 of the 33,000 cases); there the range is still removed and the break
    dropped. The
    stale-focus guard had the same gap for a range starting in a level 3–6
    heading; the command-crash-fixes branch has since closed it
    (`$staleFocusRemovalDeclinesLineBreak`, its row R16), and the listener
    here asks `$guardedRemovalDeclinesLineBreak`, which tells for a
    table-edge range first and a stale-focus range otherwise, in the order
    `$removeGuardedRange` takes them.
  - *Typing in an emptied block types plain* (B-10): a range that starts in
    the table and lands on no text clears the selection's format and style.
    Row R36. Rows R34 and R35 pin the style half of the capture (B-7).
  - *`insertTable()` removes a table-edge range first* (B-11), as
    `insertImage()` does; Lexical inserts at the focus and removes nothing,
    so the table had split the cell the range ended in. Its caret stays out
    of a raw block or a code block, as the image's does, and out of another
    table too (`$holdsNoTable`): Lexical declines a table inside a cell, so
    a caret settled into the table after the removed ones would have left
    the range removed and nothing inserted. Over a table-edge range that
    touches no raw block or code block, `insertTable()` therefore always
    inserts. Rows R37.
  - *Undo* (B-8): rows U4–U7 undo the two-step removal (shapes D18, D19,
    D23–D26) and the native cut.
  - *Smaller:* calls other than plain type guards no longer sit in `if`
    conditions in this branch's helpers, and `$cutGuardedRange` reads the
    shape once (B-12);
    `$orderedPoints` replaces the three ordered-pair expressions; `paste()`'s
    comments pointed at `copyWysiwygSelection()` while that private method
    was `copy()`'s and `cut()`'s shared body (B-14), and point at `copy()`
    again now that it is gone. Not run in a browser:
    every changed route is a command dispatch the offline rows drive, and
    the mounted K rows still pass.
- **Review fixes, round 2.** A second review read the fixes above; these
  are its findings against this branch. Each behavioural one was pinned by a
  row written first and seen to fail; each "surviving mutant" by a row that
  fails under the mutation the review named, applied and taken out again.
  - *`insertTable()` over a table-edge range is one undo step.* The range
    was removed in the update that seeds the selection, and the table
    inserted by a command dispatched after it, so the first Undo took back
    the new table only and left the document without the old one too.
    `INSERT_TABLE_COMMAND` is now dispatched inside that update. Rows U8
    (and U9, `insertImage()` over the same range, as the control). The
    update is discrete, so the table is in the document when `insertTable()`
    returns, as the image is after `insertImage()`.
  - *The table-edge half of the raw-block Enter guard is pinned.* The
    command-crash-fixes branch's round 2 made `$handleRawBlockEnter` remove
    any range with an end in a raw block and decide from the caret the
    removal leaves; here its `$removeRangeBeforeEnter` removes a table-edge
    or stale-focus range through `$removeGuardedRange` and any other through
    Lexical's own removal. Every Enter row with an end in a raw block was
    also a stale-focus range, so removing the table-edge half changed no
    row. Rows R41 end the range on the last cell itself, a point that is no
    stale-focus end, with the anchor in the raw block and with it on the
    cell: they fail when the guarded removal is taken for a stale-focus
    range only.
  - *Typing keeps the format of the range's first text inside one table.*
    `startsInTable` is `isTableEdge && …`: a stale-focus range with both
    ends in one table — two paragraphs of a cell — is no table-edge range
    and types as Lexical types over any range. Row R42 fails without
    `isTableEdge &&`.
  - *`insertImage()` over a range from a point on the root to the end of a
    document ending in a list no longer throws.* No browser makes such a
    range, a programmatic selection can. Lexical's removal leaves the root's
    last child in place when it empties it — the list, with no item, and the
    caret on it — and `insertNodes` throws for a caret with no block around
    it. The same range over a document ending in a `:::` block did not
    throw but put the image on the emptied block, where no save writes it.
    `insertImage()` now removes the range itself (`$removeRangeBeforeImage`:
    the guarded removal as before, any other range through Lexical's own)
    and replaces an emptied list or `:::` block at the caret by an empty
    paragraph (`$replaceEmptiedContainerAtCaret`) before it inserts. Rows
    R43, both directions, with a paragraph-ended document as the control.
    Left as they are, none of them a throw: a document ending in a quote
    keeps the quote around the image, and the same range over the other
    routes, which the finding did not name — Delete leaves the emptied list
    or `:::` block as the whole document, typing types into it, and Enter and
    `insertTable()` insert without removing a range that starts on the root.
- **Review fixes, round 3.** A third review read round 2's fixes; these are
  its findings against this branch, and one change the restack brought.
  - *An emptied list or `:::` block right after the caret is replaced too.*
    Round 2 replaced the emptied container only when the caret was on it. A
    range from a point on the root further down — just before the list — to
    a point on the list node itself, at its end, empties the list as well,
    but leaves the caret on the root before it: `insertImage()` then put the
    image in a paragraph of its own and left the item-less list in the
    document (`Above para\n\n- one\n- two`; the save was right, the tree
    was not). `$replaceEmptiedContainerAtCaret` now takes the block right
    after a caret that is on a root or shadow root as well as the element a
    caret is on. Rows in R43, written first and seen to fail, both
    directions: a list, a list with a paragraph after it, and a `:::` block.
  - *Pinned: a list that keeps an item is not replaced.* `container.isEmpty()`
    could be dropped with every test green. A row in R43 ends the same range
    between the list's two items, so the second item is left: the list stays
    after the image's paragraph, and the row fails without the check.
    Left as it is: when the removal leaves the caret *on* a list or `:::`
    block that still holds an item or a column (a range from a point on the
    list between its items to the end of its last item, and the three like
    shapes measured), `insertImage()` throws in Lexical's `insertNodes`, as
    it does for a collapsed caret put there; the check keeps the item, and
    no browser makes such a point.
  - *Enter removes a range in the order Delete's listeners run, here with
    the table-edge guard first.* The command-crash-fixes branch's round 3
    made `$removeRangeBeforeEnter` try `$deleteRangeFromTextOnlyBlock` first,
    so the rest of a rich-text block joins a raw block as its Markdown. On
    this branch a table-edge range is taken ahead of that, through
    `$removeGuardedRange`, as `$deleteTableEdgeRange` runs ahead of
    `$joinIntoTextOnlyBlock` on Delete: a range from a raw block into a cell
    loses the whole table instead of having the cell's rest joined. Rows
    R10, R19 and R31 fail when the join is tried first (applied and taken
    out again).
