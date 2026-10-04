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
