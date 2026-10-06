---
depends-on: [markdown-editor-list-item-block-paste]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Raw Block Range Edits — Implementation Plan

## Overview

In `MarkdownEditor`'s WYSIWYG mode, a *raw block* (`MarkdownRawBlockNode`) holds Markdown the editor has no rich-text form for, shown as its source and saved exactly as written. A code block is the other block that holds only text. This plan calls the two *text-only blocks*, as the code does (`$isTextOnlyBlock`).

A selection that runs from inside a text-only block into another block is replaced differently depending on how it is replaced. This plan calls each way of replacing a selection a *route*: Delete, typing, an input method (IME), Enter, Shift+Enter, Tab, a paste, a cut, a drag, and the public methods. Delete, Backspace and Enter join the later block's rest to the text-only block as its Markdown source. Every other route lets Lexical merge the nodes, and the text then changes meaning:

| Source | Selection | Route | Saved tail today | Saved tail after this plan |
|---|---|---|---|---|
| `<div>⏎raw text⏎</div>⏎⏎efgh **ij** kl [a](u) \*x\*` | `"raw text"`@2 → `"efgh "`@3 | Delete | `h **ij** kl [a](u) \*x\*` | same |
| same | same | type `x`, Tab, Shift+Enter, paste, cut, word delete, drag | `… [a](u) *x*` (the escape is lost; `*x*` now reads as emphasis) | `… [a](u) \*x\*` |
| same | `"<div>"`@0 → `"ij"`@0 | type `x` | `xij kl a *x*` (bold and link lost too) | `**xij** kl [a](u) \*x\*` |
| `<div>⏎raw text⏎</div>⏎⏎after` | `"<div>"`@1 → `"after"`@1 | Enter | `<⏎fter` (one paragraph) | `<⏎⏎fter` (two paragraphs, as Delete then Enter gives) |

(`⏎` is a line end. `"text"`@n is offset n in the text node holding exactly that text.)

The fix is in [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) and [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts). One function, `$removeGuardedRange`, becomes the only way a range that crosses out of a block is removed, on every route, Delete included. It also shows a raw block the removal changed as the blocks its text now reads as, before the route inserts anything. A new test file pins a matrix of routes and selection shapes. The docs page and the changelog are updated. There is no public API change.

This plan is written against the Markdown stack at `63a81117d` (the tip of `feature/markdown-raw-block-html-tail-parity`). Line numbers are from that commit. Sibling plans edit the same files, so find each site by its symbol name.

---

## Architecture Decisions

### One contract — every route removes a range the way Delete does, then inserts at the caret

Replacing a selection is two steps in one update: remove the selection, then do the route's own insert at the caret the removal leaves. The removal is the same function on every route. The route's insert is whatever the route does at a collapsed caret in the block the caret is now in.

So for every route, the result equals what the user gets by pressing Delete and then using the route at the caret. The exceptions are listed under [What stays different from Delete-then-route](#what-stays-different-from-delete-then-route).

### One place — `$removeGuardedRange`, with a third guarded shape

The editor already has this design for two selection shapes Lexical removes wrongly. `registerRangeGuards` ([MarkdownEditor.ts:2745](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2745)) registers one listener per Lexical command at `COMMAND_PRIORITY_CRITICAL`. Each listener calls `$removeGuardedRange` ([:1690](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1690)) and then lets the command's own handler insert at the collapsed caret. The two shapes are:

- the *table-edge range* (`$isTableEdgeRange`, [:1371](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1371)): one end inside a table, the other end outside that table;
- the *stale-focus range* (`$isStaleFocusRange`, [:1171](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1171)): it ends strictly inside a text node of a later block than it starts in, a shape Lexical's own removal can throw on.

This plan calls a selection of any shape `$removeGuardedRange` takes a *guarded range*.

This plan adds a third shape to `$removeGuardedRange`, the **text-only-edge range**: a selection that is not collapsed, with one end inside a text-only block and the other end outside that block. Every existing guard listener then handles the new shape without a listener of its own.[^third-shape]

`$removeGuardedRange` picks the removal in a fixed order, the first that applies:

1. a table-edge range: `$removeTableEdgeRange` ([:1578](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1578));
2. a range that starts in a text-only block and ends outside it: `$deleteRangeFromTextOnlyBlock` ([:2101](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2101)), the *text-only join*, which joins the rest of the end's block as its Markdown;
3. a stale-focus range: `$removeStaleFocusRange` ([:1200](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1200));
4. any other guarded range (it ends in a text-only block at a point that is not stale-focus): Lexical's `selection.removeText()`.

This order is the order Delete's listeners run in today.[^order] Which shapes a selection is, and which removal it gets:

| Selection | Table-edge | Text-only-edge | Stale-focus | Removed by |
|---|---|---|---|---|
| raw block → a paragraph's word | no | yes | yes | the text-only join |
| raw block → a paragraph's start | no | yes | no | the text-only join |
| paragraph → raw block's word | no | yes | yes | the stale-focus removal |
| paragraph → raw block's start | no | yes | no | Lexical's `removeText()` |
| raw block → another raw block or a code block | no | yes | either | the text-only join |
| raw block → a table cell | yes | yes | either | the table-edge removal |
| paragraph → a later paragraph's word | no | no | yes | the stale-focus removal |
| inside one raw block, or inside one paragraph | no | no | no | not guarded: Lexical replaces it in place |

### Delete calls the same function

`DELETE_CHARACTER_COMMAND` has three range listeners today: `$deleteTableEdgeRange` at CRITICAL, then `$joinIntoTextOnlyBlock` and `$deleteStaleFocusRange` at `COMMAND_PRIORITY_HIGH`. They are replaced by the listener the other delete commands already use, `$deleteGuardedRange` ([:1776](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1776)), at CRITICAL. `$joinIntoTextOnlyBlock` ([:2055](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2055)) keeps only its two collapsed-caret joins (Backspace at a paragraph's start after a text-only block, Delete at a text-only block's end). `$deleteTableEdgeRange` and `$deleteStaleFocusRange` are deleted.[^delete-same]

### The re-read is part of the removal

When a raw block's text is edited until it reads as other blocks, a node transform shows it as those blocks (`$showRawBlockAsItsBlocks`, [markdownWritable.ts:574](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L574)). This plan calls that the *re-read*. A node transform runs when the update ends, so today a route's insert runs before the re-read and meets a raw block that is about to become something else.

`$removeGuardedRange` now does the re-read itself, right after the removal, for each raw block that held an end of the range and is still in the document. It calls a new exported function, `$showRawBlockAsRead`, which is the body of the existing raw-block transform. The transform calls the same function, so the two cannot differ.[^reread]

| Source | Selection | Route | Today (in a browser) | After |
|---|---|---|---|---|
| `<div>⏎raw text⏎</div>⏎⏎after` | `"<div>"`@1 → `"after"`@1 | Enter | `<⏎fter` | `<⏎⏎fter` |
| same | same | Shift+Enter | `<⏎fter` (a source line end) | `<\⏎fter` (a hard break in the paragraph) |
| same | same | paste bold `zp` | `\<zpfter` (bold lost) | `<**zp**fter` |
| table, then `<div>⏎raw text⏎</div>` | `"c1"`@1 → `"raw text"`@2 | Tab | what is left becomes a code block | `w text⏎⏎</div>`, as Delete then Tab gives |

### Shift+Enter is still judged before the removal

Shift+Enter is declined where Markdown has no hard break, and a declined Shift+Enter must change nothing. So `$clearGuardedRangeBeforeLineBreak` ([:1904](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1904)) keeps deciding before it removes anything. The decision for a text-only-edge range uses the formula the stale-focus range already has: `$lineBreakUnwritableAt(start, joinsRest ? end : null)`.[^lb-formula]

| Selection | Decision | Result |
|---|---|---|
| raw block → paragraph's word (`"raw text"`@2 → `"efgh "`@3) | kept: the caret stays in the raw block, which keeps every break | removed, then a line break in the raw block |
| bold word → raw block's end (`"ij"`@1 → `"</div>"`@6) | declined: nothing follows the caret in its paragraph | nothing changes |
| level 3 heading → raw block's word | declined: a level 3–6 heading is one line | nothing changes |

**One limit stays, and it is documented.** The decision is read off the document as it stands, so it cannot see a re-read. When the removal leaves the caret in a raw block that then reads as a block in which the break has no place, Shift+Enter removes the selection and adds no break. The document is then exactly what Delete gives. Example: `"<div>"`@1 → `"after"`@5 leaves `<`, a paragraph with nothing after the caret.[^lb-limit]

### Typed and pasted plain text take the format a replace gives them

Two routes insert through Lexical's `insertText`, which reads the selection's format: typing (`CONTROLLED_TEXT_INSERTION_COMMAND`) and a plain-text paste (`PASTE_COMMAND`). Both now share one helper, `$removeGuardedRangeBeforeText`, which removes the range and then sets the selection's format and style:

| Where the range starts | Format of the inserted text | Example |
|---|---|---|
| in text outside a table and outside a text-only block | that text node's format (Lexical's own rule for typing over a range) | `"ij"`@1 (bold) → raw block's end, type `x`: `**ix**` |
| in a table, or in a text-only block | the format of the text the caret lands in, plain when it lands on no text | `"<div>"`@0 → `"ij"`@0 (bold), type `x`: `**xij**` |
| in a raw block that stays raw | plain (raw text has no format) | `"raw text"`@2 → `"efgh "`@3, type `x`: `rax…` |

The typing listener already does this for the two existing shapes. The pasted-text listener did not set the format at all.[^text-format]

### Enter in a raw block uses the same removal

`$handleRawBlockEnter` ([:961](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L961)) removes a range itself, through `$removeRangeBeforeEnter` ([:1034](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1034)). That function's body becomes: `$removeGuardedRange(selection)`, and Lexical's `selection.removeText()` when the range is not guarded. `$handleRawBlockEnter` then reads the caret's block from the selection as it is after the removal, re-read included. The `@remarks` paragraph saying a re-read block "still counts as raw here" is removed.

### A selection inside one text-only block is not guarded

A selection with both ends in one raw block or one code block is an edit of that block's text. Lexical replaces it in place and the raw block is re-read when the update ends. This is today's behaviour and it does not change.[^same-block]

| Raw block | Selection | Type | Result |
|---|---|---|---|
| `<div>⏎raw text⏎</div>` | `div` in `<div>` | `p` | `<p>⏎raw text⏎</div>`, still one raw block |

### The removal tags the update as Delete's command does

`$removeGuardedRange` adds `RUN_EDGE_TAG` to the update. Delete's command is already tagged with it by `registerRunEdgeRules` ([markdownWritable.ts:1440](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1440)), which makes the rules that tidy a block after a deletion run on the whole block. Typing, Tab, Enter in a raw block and the public `cut()` and `paste()` are not tagged today.[^tag]

### Listener order and priority per command

After this plan. Lexical runs a command's listeners by priority, CRITICAL first, and within one priority in registration order. `buildEditor` ([:5871](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5871)) registers `registerWritableStateRules` first, then `registerRichText`, then `registerColumnPaste`, `registerTextOnlyBlockRules`, `registerRangeGuards`. That order does not change.

| Command (route) | CRITICAL, in order | HIGH, in order | EDITOR (`registerRichText`) |
|---|---|---|---|
| `KEY_BACKSPACE_COMMAND`, `KEY_DELETE_COMMAND` | `$backspaceOverTableEdgeRange` / `$deleteKeyOverTableEdgeRange` | — | dispatches `DELETE_CHARACTER_COMMAND` |
| `DELETE_CHARACTER_COMMAND` | run-edge tag, **`$deleteGuardedRange`** | `$joinIntoTextOnlyBlock` (collapsed joins only) | deletes |
| `DELETE_WORD_COMMAND`, `DELETE_LINE_COMMAND`, `REMOVE_TEXT_COMMAND` (word and line delete, the source half of a drag, `deleteByCut`, `deleteByComposition`) | run-edge tag, `$deleteGuardedRange` | — | deletes |
| `CONTROLLED_TEXT_INSERTION_COMMAND` (typing, IME start, the insert half of a drop) | `$clearGuardedRangeBeforeTyping` | — | `insertText` |
| `KEY_ENTER_COMMAND` | — | `$handleSeparatorShortcut`, `$handleRawBlockEnter` | dispatches `INSERT_PARAGRAPH_COMMAND` |
| `INSERT_PARAGRAPH_COMMAND` | run-edge tag, `$clearGuardedRangeBeforeInsert` | — | `insertParagraph` |
| `INSERT_LINE_BREAK_COMMAND` (Shift+Enter) | run-edge tag, `$clearGuardedRangeBeforeLineBreak` | `$declinesLineBreak` | `insertLineBreak` |
| `INSERT_TAB_COMMAND` | `$clearGuardedRangeBeforeInsert` | — | inserts a tab |
| `PASTE_COMMAND` (plain text) | run-edge tag, `$clearGuardedRangeBeforePastedText` | `$pastePlainTextIntoRawBlock` | pastes |
| `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` (pasted or dropped nodes) | run-edge tag, `$clearGuardedRangeBeforePaste` | `$pasteColumnsAsTheirBlocks`, `$pasteIntoTextOnlyBlock` | `@lexical/clipboard` inserts |
| `CUT_COMMAND` | run-edge tag, `$cutGuardedRange` | — | cuts |

"Run-edge tag" is the listener `registerRunEdgeRules` registers for that command; it tags the update and returns `false`. Only the `DELETE_CHARACTER_COMMAND` row changes its registrations. The two paste handlers at HIGH need no change: they read the selection's anchor, and after the CRITICAL guard the selection is a caret.[^paste-direction]

`registerRangeGuards` no longer depends on being called after `registerTextOnlyBlockRules`. Keep the call order as it is and correct both functions' JSDoc.

### Undo stays one step per command

Each guard removes the range inside the update of the command that then inserts. Nothing new is dispatched later and no second update is started. A key press, a paste event and `insertTable` run their command inside one update. A command dispatched from outside an update runs each priority in an update of its own, but all of them land in one commit, so the history records one entry.[^undo] The native cut keeps its existing shape: copy, then one update tagged `CUT_TAG`. `cut()`, `paste()` and `insertImage()` are one discrete update each.

### `insertImage` and `insertTable` are unchanged

Both decline a selection that touches a text-only block (`canInsertImage`, `canInsertTable`) before any removal, and leave the document and the selection as they were. A text-only-edge range always touches one.

### What stays different from Delete-then-route

These are the only cases where a route over a guarded range may differ from Delete followed by the route. Each is intended.

- **A declined Shift+Enter** leaves the selection, where Delete would remove it.
- **The Shift+Enter limit** above: the selection is removed and no break added. The document still equals Delete's.
- **Rules that run when an update ends.** After Delete alone, the editor's writable-state rules rewrite what the deletion left before the user's next key: a hard break left at a block's end is dropped, a break in a level 3–6 heading becomes a space. A route that replaces the selection in one update inserts before those rules run. Example: block paste over a level 3 heading → raw block selection keeps the raw block's line break in the pasted paragraph, where Delete-then-paste shows a space. The raw-block re-read is no longer in this class.
- **The format of typed and pasted plain text.** It follows the replace rule above: the format of the range's first text node. After Delete the caret takes the format of the text it then stands in. The two differ when the range starts at the very start of a formatted run and the removal takes that run whole.
- **A selection inside one block**, which is not guarded.

---

## Internal Structure

All in `MarkdownEditor.ts` unless a heading says otherwise. Write full JSDoc per CODE_CONVENTIONS; the bodies are below.

### `markdownWritable.ts` — `$showRawBlockAsRead`

Exported. Place it directly after `registerRawBlockRules` ([markdownWritable.ts:533](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L533)).

```typescript
export function $showRawBlockAsRead(node: MarkdownRawBlockNode): void {
    const parent = node.getParent();

    if (parent !== null) {
        $showRawBlocksAsWritten(parent);
    }

    $showRawBlockAsItsBlocks(node);
}
```

`registerRawBlockRules` registers it in place of the two inline bodies. `checkSiblings` stays for the `ParagraphNode` transform:

```typescript
        editor.registerNodeTransform(MarkdownRawBlockNode, $showRawBlockAsRead),
        editor.registerNodeTransform(ParagraphNode, checkSiblings),
        editor.registerNodeTransform(TextNode, (text) => {
            const parent = text.getParent();

            if ($isMarkdownRawBlockNode(parent)) {
                $showRawBlockAsRead(parent);
            }
        }),
```

### The shape predicates

Place both directly before `$removeGuardedRange`. `$isTextOnlyEdgeRange` copies `$isTableEdgeRange` line for line, with `$isTextOnlyBlock` in place of the table lookup.

```typescript
function $isTextOnlyEdgeRange(selection: BaseSelection | null): selection is RangeSelection {
    const isRange = $isRangeSelection(selection) && !selection.isCollapsed();

    if (!isRange) {
        return false;
    }

    const anchorBlock = $findMatchingParent(selection.anchor.getNode(), $isTextOnlyBlock);
    const focusBlock = $findMatchingParent(selection.focus.getNode(), $isTextOnlyBlock);

    if (anchorBlock === null || focusBlock === null) {
        return anchorBlock !== focusBlock;
    }

    return !anchorBlock.is(focusBlock);
}

function $isGuardedRange(selection: BaseSelection | null): selection is RangeSelection {
    return $isTableEdgeRange(selection) || $isTextOnlyEdgeRange(selection) || $isStaleFocusRange(selection);
}
```

### `$removeGuardedRange`

Same signature and return value as today.

```typescript
function $removeGuardedRange(selection: BaseSelection | null, caretStaysOutOf: ((node: LexicalNode) => boolean) | null = null): boolean {
    const isGuarded = $isGuardedRange(selection);

    if (!isGuarded) {
        return false;
    }

    // Read before the removal: afterwards the two ends are one caret.
    const rawBlocks = [selection.anchor, selection.focus].map((point) => $findMatchingParent(point.getNode(), $isMarkdownRawBlockNode));
    const isTableEdge = $isTableEdgeRange(selection);

    $addUpdateTag(RUN_EDGE_TAG);

    if (isTableEdge) {
        $removeTableEdgeRange(selection, caretStaysOutOf);
    } else {
        $removeJoiningRange(selection);
    }

    for (const block of rawBlocks) {
        if (block !== null && block.isAttached()) {
            $showRawBlockAsRead(block);
        }
    }

    return true;
}

function $removeJoiningRange(selection: RangeSelection): void {
    const joinedAsMarkdown = $deleteRangeFromTextOnlyBlock(selection);

    if (joinedAsMarkdown) {
        return;
    }

    const isStaleFocus = $isStaleFocusRange(selection);

    if (isStaleFocus) {
        $removeStaleFocusRange(selection);
    } else {
        selection.removeText();
    }
}
```

`$deleteRangeFromTextOnlyBlock` is unchanged. It already returns `false` for a range that does not start in a text-only block or does not leave it.

### `$removeGuardedRangeBeforeText` and its two listeners

`$removeGuardedRangeBeforeText` takes over the body of today's `$clearGuardedRangeBeforeTyping` ([:1951](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1951)).

```typescript
function $removeGuardedRangeBeforeText(selection: BaseSelection | null): void {
    const isGuarded = $isGuardedRange(selection);

    if (!isGuarded) {
        return;
    }

    const [start] = $orderedPoints(selection);
    const startNode = start.getNode();
    const isTableEdge = $isTableEdgeRange(selection);
    const startsInTable = isTableEdge && $findTableHolding(startNode) !== null;
    const startsInTextOnlyBlock = $findMatchingParent(startNode, $isTextOnlyBlock) !== null;
    const takesCaretFormat = startsInTable || startsInTextOnlyBlock;
    const startFormat = $isTextNode(startNode) ? startNode.getFormat() : selection.format;
    const startStyle = $isTextNode(startNode) ? startNode.getStyle() : selection.style;

    $removeGuardedRange(selection);

    // Read anew: showing a raw block as it now reads replaces the nodes the caret was in.
    const caret = $getSelection();
    const isRange = $isRangeSelection(caret);

    if (!isRange) {
        return;
    }

    const caretNode = caret.anchor.getNode();
    const caretText = $isTextNode(caretNode) ? caretNode : null;

    // 0 is Lexical's format bitmask with no format set, and "" its style with no declaration.
    caret.format = takesCaretFormat ? caretText?.getFormat() ?? 0 : startFormat;
    caret.style = takesCaretFormat ? caretText?.getStyle() ?? "" : startStyle;
}

function $clearGuardedRangeBeforeTyping(): boolean {
    $removeGuardedRangeBeforeText($getSelection());

    return false;
}

function $clearGuardedRangeBeforePastedText(event: CommandPayloadType<typeof PASTE_COMMAND>): boolean {
    const selection = $getSelection();
    const isGuarded = $isGuardedRange(selection);

    // The shape first: the event is read only for a range this guard would remove.
    const insertsText = isGuarded && pasteWillInsertText(event);

    if (insertsText) {
        $removeGuardedRangeBeforeText(selection);
    }

    return false;
}
```

### Shift+Enter's decision

Rename `$staleFocusRemovalDeclinesLineBreak` ([:1298](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1298)) to `$joiningRemovalDeclinesLineBreak`. Its body does not change. Its JSDoc now says it tells for any range that `$removeJoiningRange` removes.

```typescript
function $guardedRemovalDeclinesLineBreak(selection: BaseSelection | null): boolean {
    const isTableEdge = $isTableEdgeRange(selection);

    if (isTableEdge) {
        return $tableEdgeRemovalDeclinesLineBreak(selection);
    }

    const isJoining = $isTextOnlyEdgeRange(selection) || $isStaleFocusRange(selection);

    return isJoining && $joiningRemovalDeclinesLineBreak(selection);
}
```

### `$handleRawBlockEnter` after the removal

Everything up to and including the `if (!isCollapsed) { $removeRangeBeforeEnter(selection); }` block stays. What follows reads the selection anew:

```typescript
    const caret = $getSelection();
    const isRange = $isRangeSelection(caret);

    if (!isRange) {
        return true;
    }

    const caretBlock = $rawBlockAtAnchor(caret);
    const leftAtEnd = caretBlock !== null && caretBlock.isSelectionAtEnd(caret);

    // Outside a raw block or at one's end, where Enter starts a new paragraph.
    if (caretBlock === null || leftAtEnd) {
        return editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
    }

    const atStart = caretBlock.isSelectionAtStart(caret);

    if (atStart) {
        caretBlock.insertBefore($createParagraphNode());
    } else {
        caret.insertLineBreak();
    }

    return true;
```

```typescript
function $removeRangeBeforeEnter(selection: RangeSelection): void {
    const removed = $removeGuardedRange(selection);

    if (!removed) {
        selection.removeText();
    }
}
```

### `$joinIntoTextOnlyBlock`, `$cutGuardedRange`, `registerRangeGuards`

`$joinIntoTextOnlyBlock`: the range branch returns `false`.

```typescript
    const isCollapsed = selection.isCollapsed();

    // A range is removed by the CRITICAL guard, ahead of this listener.
    if (!isCollapsed) {
        return false;
    }
```

`$cutGuardedRange` ([:2011](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2011)): `const isGuarded = $isGuardedRange(selection);` replaces `isTableEdge || $isStaleFocusRange(selection)`. Keep `isTableEdge`; the clipboard data line reads it.

These need no change to their bodies, because they call `$removeGuardedRange`: `$deleteGuardedRange`, `$clearGuardedRangeBeforeInsert`, `$clearGuardedRangeBeforeLineBreak`, `$clearGuardedRangeBeforePaste`, `$removeRangeBeforeImage`, `cut()` and `paste()`.

`registerRangeGuards`: one row replaces two.

```typescript
        guard(KEY_BACKSPACE_COMMAND, $backspaceOverTableEdgeRange),
        guard(KEY_DELETE_COMMAND, $deleteKeyOverTableEdgeRange),
        guard(DELETE_CHARACTER_COMMAND, $deleteGuardedRange),
        guard(DELETE_WORD_COMMAND, $deleteGuardedRange),
        // … the remaining rows as they are
```

---

## Ordered Implementation Steps

Work test-first. Run test files from `packages/lib` with `npx vitest run <file>`.

1. **Create `packages/lib/tests/component/markdown-editor-text-only-edge.test.ts`.** Copy the file header, the `vi.mock('@lexical/clipboard', …)` block, `CONFIG`, `beforeEach`/`afterEach`, `lexicalOf`, `load`, `$textNode`, `selectText`, `rangeOf` and `rootChildren` from [markdown-editor-command-crashes.test.ts](../packages/lib/tests/component/markdown-editor-command-crashes.test.ts), and `pasteClipboard` from [markdown-editor-table-edge.test.ts](../packages/lib/tests/component/markdown-editor-table-edge.test.ts). Add the helpers and rows of [Expected Behaviour](#expected-behaviour). Run the file: the rows marked *red today* fail and the rest pass. If a row marked *red today* passes, stop and re-read the row.
2. **`markdownWritable.ts`:** add `$showRawBlockAsRead` and register it as shown in *Internal Structure*. Check: `npx vitest run tests/component/markdown-source-preservation.test.ts tests/component/markdown-editor.test.ts` is green (no behaviour changes in this step).
3. **`MarkdownEditor.ts` imports:** add `$addUpdateTag` to the `lexical` import ([:21–29](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L21)) and `$showRawBlockAsRead` to the `markdownWritable.js` import ([:63](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L63)).
4. **Add `$isTextOnlyEdgeRange`, `$isGuardedRange` and `$removeJoiningRange`, and replace the body of `$removeGuardedRange`**, as in *Internal Structure*.
5. **`DELETE_CHARACTER_COMMAND`:** change `$joinIntoTextOnlyBlock`'s range branch to `return false`; replace the two `DELETE_CHARACTER_COMMAND` rows of `registerRangeGuards` with `guard(DELETE_CHARACTER_COMMAND, $deleteGuardedRange)`; delete `$deleteTableEdgeRange` ([:1617](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1617)) and `$deleteStaleFocusRange` ([:1216](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1216)). Check: `grep -n 'deleteTableEdgeRange\b\|deleteStaleFocusRange' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` gives no match (`$deleteTableEdgeRangeFromKey` is a different function and stays). Check: `npx vitest run tests/component/markdown-editor-command-crashes.test.ts tests/component/markdown-editor-table-edge.test.ts` is green.
6. **Enter:** replace `$removeRangeBeforeEnter`'s body and the tail of `$handleRawBlockEnter`, as in *Internal Structure*. Remove the `@remarks` paragraph of `$handleRawBlockEnter`'s JSDoc.
7. **Typed and pasted text:** add `$removeGuardedRangeBeforeText`; replace the bodies of `$clearGuardedRangeBeforeTyping` and `$clearGuardedRangeBeforePastedText`.
8. **Cut:** change `$cutGuardedRange`'s `isGuarded` line.
9. **Shift+Enter:** rename `$staleFocusRemovalDeclinesLineBreak` to `$joiningRemovalDeclinesLineBreak` and replace the body of `$guardedRemovalDeclinesLineBreak`. Check: `grep -n 'staleFocusRemovalDeclinesLineBreak' packages/lib/src` gives no match.
10. **JSDoc.** Update every comment that describes the old design, so each names three shapes or says "a guarded range": `$removeGuardedRange`, `registerRangeGuards` (all listeners at CRITICAL; no order to keep with `registerTextOnlyBlockRules`), `registerTextOnlyBlockRules` (the delete listener joins at a collapsed caret only), `$joinIntoTextOnlyBlock`, `$removeRangeBeforeEnter`, `$handleRawBlockEnter`, `$deleteGuardedRange`, `$clearGuardedRangeBeforeInsert`, `$clearGuardedRangeBeforeLineBreak`, `$clearGuardedRangeBeforePastedText`, `$clearGuardedRangeBeforeTyping`, `$clearGuardedRangeBeforePaste`, `$cutGuardedRange`, `$removeRangeBeforeImage`, `$guardedRemovalDeclinesLineBreak`, and `$keepTextOnly` (it says a merge "can bring in" formatted nodes by typing or pasting over a range; say instead that it catches whatever still reaches the block). Check: `grep -n 'two range shapes\|either side of\|deleteStaleFocusRange\|deleteTableEdgeRange\b' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` gives no match.
11. **Run the new test file.** Every row passes. Then run `tests/component/markdown-editor-command-crashes.test.ts`, `tests/component/markdown-editor-table-edge.test.ts`, `tests/component/markdown-editor-table-edge-mounted.test.ts`, `tests/component/markdown-editor.test.ts`, `tests/component/markdown-editor-columns.test.ts` and `tests/component/markdown-roundtrip/`. No existing row is expected to change.[^existing-tests]
12. **Docs:** edit `packages/lib/docs/components/MarkdownEditor.md` and `packages/lib/docs/reference/changelog/next.md` as in [Documentation Impact](#documentation-impact).
13. **Verification**, in full.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/component/markdown-editor-text-only-edge.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Everything in this section is unit-testable offline in the new test file unless it is under [Manual (browser) checks](#manual-browser-checks). Expected strings are `getValue()`. They were measured with a prototype of this plan; see the [addendum](#addendum-measurements).

### Constants

```typescript
const FENCE = '```';
const RAW = '<div>\nraw text\n</div>';
const RICH = 'efgh **ij** kl [a](u) \\*x\\*';
const CODE = `${FENCE}\ncode *a*\nline2\n${FENCE}`;
/** A code block loads as ONE text node holding its lines. */
const CODE_TEXT = 'code *a*\nline2';
const TABLE = '| a | b |\n| --- | --- |\n| c1 | d1 |';
const TWO_RAW = '<div>\nraw one\n</div>\n\n<section>\nraw two\n</section>\n\nafter';
```

Text nodes: `RAW` holds `"<div>"`, `"raw text"`, `"</div>"`. `RICH` holds `"efgh "`, `"ij"` (bold), `" kl "`, `"a"` (link), `" *x*"`.

### Routes

Run every route in **both** dispatch contexts: *outside an update* (`lexical.dispatchCommand(command, payload)`) and *inside one* (`lexical.update(() => { lexical.dispatchCommand(command, payload); }, { discrete: true })`). Inside one update is what a browser's key and input events do.[^contexts] The public methods (`cut()`, `paste()`, `insertImage()`, `insertTable()`) start their own update, so they run once.

| Route | How the test drives it | What goes in at the caret |
|---|---|---|
| Delete, Backspace | `DELETE_CHARACTER_COMMAND` `false` / `true` | nothing |
| word delete | `DELETE_WORD_COMMAND` `false` | nothing |
| the source half of a drag, `deleteByCut`, `deleteByComposition` | `REMOVE_TEXT_COMMAND` `null` | nothing |
| cut | `editor.cut()`; `CUT_COMMAND` `null`, then `await vi.waitFor(…)` | nothing |
| type | `CONTROLLED_TEXT_INSERTION_COMMAND` `'x'` | `x` |
| IME start | `CONTROLLED_TEXT_INSERTION_COMMAND` `'\u200b'` (what Lexical's composition start dispatches over a range) | a zero-width space |
| the insert half of a drop | `CONTROLLED_TEXT_INSERTION_COMMAND` with an `InputEvent` carrying `dataTransfer` (`text/plain` = `zd`) | `zd` |
| Enter | `KEY_ENTER_COMMAND` `null` | in a raw block: a line break (a paragraph before the block at its start, after it at its end); elsewhere a new paragraph |
| Enter on Android | `INSERT_PARAGRAPH_COMMAND` | Lexical's `insertParagraph` |
| Shift+Enter | `INSERT_LINE_BREAK_COMMAND` `false` | a line break, or nothing at all when declined |
| Tab | `INSERT_TAB_COMMAND` | a tab |
| paste text | `PASTE_COMMAND` with a `ClipboardEvent` (`text/plain` = `zc`); `await editor.paste()` with `DOM.source.readClipboardText` mocked to `zc` | `zc` |
| paste nodes | `$insertGeneratedNodes(lexical, [bold text "zp"], selection)` in a discrete update | in a text-only block `zp` as text; elsewhere bold `zp` |
| paste blocks | `$insertGeneratedNodes` with two paragraphs, `p1 ` + bold `zb`, and `p2` | in a text-only block their text; elsewhere the two paragraphs |
| `insertImage`, `insertTable` | `editor.insertImage('/i.png', { alt: 'i' })`, `editor.insertTable(2, 2)` | declined: document and selection unchanged |

The event stubs are those of rows R13 and R15 in `markdown-editor-command-crashes.test.ts` (`vi.stubGlobal('ClipboardEvent', class ClipboardEvent {})` and the three others). The `CUT_COMMAND` route needs the `ClipboardEvent` stub too.

### The control

For a route with an insert, the control is a second editor loaded with the same source and selection:

1. dispatch `DELETE_CHARACTER_COMMAND` `false` outside an update, then call `getValue()` so the update commits;
2. give the caret the format of the text it is in, as a browser's selection change does: in a discrete update, when the selection is collapsed and its anchor is a text point, set `selection.format` and `selection.style` from the anchor's text node;
3. run the route in the same dispatch context as the row.

For a route with no insert, the control is step 1 alone. For `insertImage` and `insertTable` the control is the document as loaded.

Step 2 and the parity check, as helpers of the test file:

```typescript
/** Gives a collapsed caret the format of the text it is in, as a browser's selection change does. */
function syncCaretFormat(editor: MarkdownEditor): void {
    lexicalOf(editor).update(() => {
        const selection = $getSelection();
        const isCaretInText = $isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.type === 'text';

        if (isCaretInText) {
            const text = selection.anchor.getNode() as TextNode;

            selection.format = text.getFormat();
            selection.style = text.getStyle();
        }
    }, { discrete: true });
}

/** Asserts that the editor shows what its save reads as, and that a reload saves and shows the same. */
function expectParity(editor: MarkdownEditor): void {
    const saved = editor.getValue();
    const surface = editorSurfaceModel(editor);
    const reloaded = load(saved);

    expect(surface).toEqual(viewerModel(saved).blocks);
    expect(reloaded.getValue()).toBe(saved);
    expect(editorSurfaceModel(reloaded)).toEqual(surface);
}
```

Each cell asserts all of:

- **same as the control**: `getValue()`, the root's text content (`$getRoot().getTextContent()`, which sees a tab or line break the save trims) and `rootChildren(editor)` are equal to the control's;
- **parity**: `expectParity(editor)` below (`editorSurfaceModel` and `viewerModel` come from `./markdown-roundtrip/viewModel`);
- **undo**: after reading `getValue()`, one `UNDO_COMMAND` gives back the source.

### M — the matrix

One `describe` per shape. Each shape runs with the selection dragged forward (anchor = start) and backward (anchor = end), every route, both contexts. *Type gives* is the exact `getValue()` after typing `x`; it pins both Delete's result and the caret. Delete's own result is that string without the `x`.

| # | Shape | Document | Start → end | Type gives |
|---|---|---|---|---|
| E1 | raw → rich word | `` `${RAW}\n\n${RICH}\n\nafter` `` | `"raw text"`@2 → `"efgh "`@3 | `'<div>\nraxh **ij** kl [a](u) \\*x\\*\n\nafter'` |
| E2 | raw start → bold start | same | `"<div>"`@0 → `"ij"`@0 | `'**xij** kl [a](u) \\*x\\*\n\nafter'` |
| E3 | raw start → rich word | same | `"<div>"`@0 → `"efgh "`@3 | `'xh **ij** kl [a](u) \\*x\\*\n\nafter'` |
| E4 | raw end → rich word | same | `"</div>"`@6 → `"efgh "`@3 | `'<div>\nraw text\n</div>xh **ij** kl [a](u) \\*x\\*\n\nafter'` |
| E5 | raw → rich block's end | same | `"raw text"`@2 → `" *x*"`@4 | `'<div>\nrax\n\nafter'` |
| E6 | raw → rich block's start | same | `"raw text"`@2 → `"efgh "`@0 | `'<div>\nraxefgh **ij** kl [a](u) \\*x\\*\n\nafter'` |
| E7 | raw tag → later word (re-read) | `` `${RAW}\n\nafter` `` | `"<div>"`@1 → `"after"`@1 | `'\\<xfter'` |
| E8 | raw tag → later block's end (re-read) | same | `"<div>"`@1 → `"after"`@5 | `'\\<x'` |
| E9 | raw → raw | `TWO_RAW` | `"raw one"`@2 → `"raw two"`@2 | `'<div>\nraxw two\n</section>\n\nafter'` |
| E10 | raw tag → raw tag | `TWO_RAW` | `"<div>"`@1 → `"<section>"`@3 | `'<xction>\nraw two\n</section>\n\nafter'` |
| E11 | rich word → raw | `` `${RICH}\n\n${RAW}\n\nafter` `` | `"efgh "`@3 → `"raw text"`@2 | `'efgxw text\\\n\\</div>\n\nafter'` |
| E12 | rich start → raw | same | `"efgh "`@0 → `"raw text"`@2 | `'xw text\\\n\\</div>\n\nafter'` |
| E13 | bold → raw end | same | `"ij"`@1 → `"</div>"`@6 | `'efgh **ix**\n\nafter'` |
| E14 | rich word → raw start | same | `"efgh "`@3 → `"<div>"`@0 | `'efgx\\<div>\\\nraw text\\\n\\</div>\n\nafter'` |
| E15 | code → rich word | `` `${CODE}\n\n${RICH}\n\nafter` `` | `CODE_TEXT`@2 → `"efgh "`@3 | `` '```\ncoxh **ij** kl [a](u) \\*x\\*\n```\n\nafter' `` |
| E16 | code start → bold start | same | `CODE_TEXT`@0 → `"ij"`@0 | `` '```\nx**ij** kl [a](u) \\*x\\*\n```\n\nafter' `` |
| E17 | rich word → code | `` `${RICH}\n\n${CODE}\n\nafter` `` | `"efgh "`@3 → `CODE_TEXT`@11 | `'efgxne2\n\nafter'` |
| E18 | raw → code | `` `${RAW}\n\n${CODE}\n\nafter` `` | `"raw text"`@2 → `CODE_TEXT`@11 | `'<div>\nraxne2\n\nafter'` |
| E19 | code → raw | `` `${CODE}\n\n${RAW}\n\nafter` `` | `CODE_TEXT`@2 → `"raw text"`@2 | `` '```\ncoxw text\n</div>\n```\n\nafter' `` |
| E20 | raw → list item | `` `${RAW}\n\n- one **b**\n- two \\*x\\* [a](u)\n\nafter` `` | `"raw text"`@2 → `"two *x* "`@2 | `'<div>\nraxo \\*x\\* [a](u)\n\nafter'` |
| E21 | list item → raw | `` `- one **b**\n- two \\*x\\*\n\n${RAW}\n\nafter` `` | `"two *x*"`@2 → `"raw text"`@2 | `'- one **b**\n- twxw text\\\n  \\</div>\n\nafter'` |
| E22 | raw → quote | `` `${RAW}\n\n> quote **b** \\*x\\*\n\nafter` `` | `"raw text"`@2 → `"quote "`@3 | `'<div>\nraxte **b** \\*x\\*\n\nafter'` |
| E23 | quote → raw | `` `> quote **b**\n\n${RAW}\n\nafter` `` | `"quote "`@3 → `"raw text"`@2 | `'> quoxw text\\\n> \\</div>\n\nafter'` |
| E24 | raw → level 3 heading | `` `${RAW}\n\n### head **b** \\*x\\*\n\nafter` `` | `"raw text"`@2 → `"head "`@2 | `'<div>\nraxad **b** \\*x\\*\n\nafter'` |
| E25 | level 3 heading → raw | `` `### head **b**\n\n${RAW}\n\nafter` `` | `"head "`@2 → `"raw text"`@2 | `'### hexw text \\</div>\n\nafter'` |
| E26 | raw → a column's word | `` `${RAW}\n\n::: columns\ncol **b** \\*x\\*\n\|\|\|\nB\n:::\n\nafter` `` | `"raw text"`@2 → `"col "`@2 | `'<div>\nraxl **b** \\*x\\*\n\n::: {}\nB\n:::\n\nafter'` |
| E27 | raw in a column → the next column | `` `::: columns\n${RAW}\n\|\|\|\ncol **b** \\*x\\*\n:::\n\nafter` `` | `"raw text"`@2 → `"col "`@2 | `'::: {}\n<div>\nraxl **b** \\*x\\*\n:::\n\nafter'` |
| E28 | raw → rich, both in one column | `` `::: columns\n${RAW}\n\ncol **b** \\*x\\*\n\|\|\|\nB\n:::\n\nafter` `` | `"raw text"`@2 → `"col "`@2 | `'::: columns\n<div>\nraxl **b** \\*x\\*\n\|\|\|\nB\n:::\n\nafter'` |
| E29 | a column's word → raw after the fence | `` `::: columns\nA\n\|\|\|\ncol **b**\n:::\n\n${RAW}\n\nafter` `` | `"col "`@2 → `"raw text"`@2 | `'::: columns\nA\n\|\|\|\ncox\n:::\n\nw text\n\n</div>\n\nafter'` |
| E30 | raw → table cell | `` `${RAW}\n\n${TABLE}\n\nafter` `` | `"raw text"`@2 → `"c1"`@1 | `'<div>\nrax\n\nafter'` |
| E31 | table cell → raw | `` `${TABLE}\n\n${RAW}\n\nafter` `` | `"c1"`@1 → `"raw text"`@2 | `'xw text\n\n</div>\n\nafter'` |
| E32 | raw tag → table cell (re-read) | `` `${RAW}\n\n${TABLE}\n\nafter` `` | `"<div>"`@2 → `"c1"`@1 | `'\\<dx\n\nafter'` |

In the table, `\|` stands for a `|` character (the Markdown table needs the escape); the source strings hold `|||`.

**Cells with their own assertion.** Assert what is given here, in place of or beside the control comparison.

| Cells | Assert | Why |
|---|---|---|
| Shift+Enter over E13, E25 and E29, both directions | `getValue()` is the source, and the selection is the range that was set | declined: nothing follows the caret (E13), a level 3 heading is one line (E25), nothing joins across the fence (E29) |
| paste blocks over E25 | `'### hep1 **zb**\n\np2w text\\\n\\</div>\n\nafter'` | a rule that runs when an update ends: after Delete alone the heading's break becomes a space |
| Shift+Enter over E8 and E32 | equal to the control, and the control equals Delete's result (`'<'`, `'\\<d\n\nafter'`): the selection is gone and no break was added | the documented limit |

**Red today.** These cells fail before the change. Check them in step 1; every other cell passes before and after.

| Shapes | Routes that are red today |
|---|---|
| E1, E3, E4, E20, E22, E24, E26, E27, E28 | word delete, `REMOVE_TEXT_COMMAND`, `cut()`, `CUT_COMMAND`, type, IME start, drop insert, Shift+Enter, `INSERT_PARAGRAPH_COMMAND`, Tab, paste text (both ways), paste nodes, paste blocks. Green: Delete, Backspace, Enter, `insertImage`, `insertTable` |
| E2, E6 | as E1 without `CUT_COMMAND` (see the note below); for E2, paste blocks dragged backward is green |
| E15, E16 | as E1 plus Enter; for E16 without `CUT_COMMAND` |
| E5 | Shift+Enter; paste nodes and paste blocks dragged backward |
| E7 | Enter; paste nodes; paste blocks; Shift+Enter inside an update |
| E8 | Shift+Enter (today it is declined and nothing changes; see the limit); paste nodes; paste blocks |
| E13 | dragged backward only: `PASTE_COMMAND`, paste nodes, paste blocks |
| E14 | dragged backward only: paste nodes, paste blocks |
| E31 | paste nodes; paste blocks; Tab and Shift+Enter inside an update |
| E32 | paste nodes; paste blocks |
| E9–E12, E17–E19, E21, E23, E25, E29, E30 | none: these pin that raw → raw, the direction from rich text into a text-only block, and a table-edge range stay as they are |

**`CUT_COMMAND` before the change.** Over E2, E5, E6, E8, E13, E14 and E16 the command cannot run offline before the change. Those ranges are not stale-focus, so the command reaches `@lexical/rich-text`'s own cut, whose `copyToClipboard` needs a `window`, and vitest reports an unhandled rejection. After the change `$cutGuardedRange` takes every shape of the matrix and the cells run.

### P — pinned results

Exact `getValue()` strings for the routes of the four shapes that carry the defects, the same in both directions and both contexts.

| Route | E1 | E2 | E7 | E11 |
|---|---|---|---|---|
| Delete, Backspace, word delete, `REMOVE_TEXT`, `cut()`, `CUT_COMMAND` | `'<div>\nrah **ij** kl [a](u) \\*x\\*\n\nafter'` | `'**ij** kl [a](u) \\*x\\*\n\nafter'` | `'\\<fter'` | `'efgw text\\\n\\</div>\n\nafter'` |
| Enter | `'<div>\nra\nh **ij** kl [a](u) \\*x\\*\n\nafter'` | as Delete, with an empty paragraph first (`rootChildren` equals the control's) | `'<\n\nfter'` | `'efg\n\nw text\\\n\\</div>\n\nafter'` |
| Shift+Enter | as Enter | `'\\\n**ij** kl [a](u) \\*x\\*\n\nafter'` | `'<\\\nfter'` | `'efg\\\nw text\\\n\\</div>\n\nafter'` |
| `INSERT_PARAGRAPH_COMMAND` | `'<div>\nra\n\nh **ij** kl [a](u) \\*x\\*\n\nafter'` | as Enter | `'<\n\nfter'` | as Enter |
| Tab | `'<div>\nra\th **ij** kl [a](u) \\*x\\*\n\nafter'` | as Delete (the tab shows in the root's text, which equals the control's) | `'<\tfter'` | `'efg\tw text\\\n\\</div>\n\nafter'` |
| paste text, `paste()` | `'<div>\nrazch **ij** kl [a](u) \\*x\\*\n\nafter'` | `'**zcij** kl [a](u) \\*x\\*\n\nafter'` (`paste()`: `'zc**ij** kl [a](u) \\*x\\*\n\nafter'`)[^paste-method] | `'\\<zcfter'` | `'efgzcw text\\\n\\</div>\n\nafter'` |
| paste nodes | `'<div>\nrazph **ij** kl [a](u) \\*x\\*\n\nafter'` | `'**zpij** kl [a](u) \\*x\\*\n\nafter'` | `'<**zp**fter'` | `'efg**zp**w text\\\n\\</div>\n\nafter'` |
| paste blocks | `'<div>\nrap1 zb\n\np2h **ij** kl [a](u) \\*x\\*\n\nafter'` | `'p1 **zb**\n\np2**ij** kl [a](u) \\*x\\*\n\nafter'` | `'\\<p1 **zb**\n\np2fter'` | `'efgp1 **zb**\n\np2w text\\\n\\</div>\n\nafter'` |
| drop insert | `'<div>\nrazdh **ij** kl [a](u) \\*x\\*\n\nafter'` | `'**zdij** kl [a](u) \\*x\\*\n\nafter'` | `'\\<zdfter'` | `'efgzdw text\\\n\\</div>\n\nafter'` |
| `insertImage`, `insertTable` | the source | the source | the source | the source |

And for E31 (a table-edge range ending in a raw block): Tab gives `'w text\n\n</div>\n\nafter'`, paste nodes gives `'**zp**w text\n\n</div>\n\nafter'`, Shift+Enter gives `'\\\nw text\n\n</div>\n\nafter'`.

### G — unchanged behaviour

These pass before and after. They are not compared with the control.

| # | Document | Selection | Route | `getValue()` |
|---|---|---|---|---|
| G1 | `` `${RAW}\n\nafter` `` | `"<div>"`@1 → `"<div>"`@4 | type `x` | `'<x>\nraw text\n</div>\n\nafter'` (still one raw block) |
| G2 | same | same | `PASTE_COMMAND`, `zc` | `'<zc>\nraw text\n</div>\n\nafter'` |
| G3 | same | same | Delete | `'<>\nraw text\n\n</div>\n\nafter'` |
| G4 | same | same | Enter | `'<\n\n>\n\nraw text\n\n</div>\n\nafter'` |
| G5 | E1's document | E1's selection, each direction | `$insertGeneratedNodes(lexical, [], selection)` (a paste that brings no node) | the source; the range is left as it is |
| G6 | `` `${RAW}\n\n${RICH}` `` | a caret at `"efgh "`@0 | Backspace | `'<div>\nraw text\n</div>efgh **ij** kl [a](u) \\*x\\*'` |
| G7 | same | a caret at `"</div>"`@6 | Delete | the same string as G6 |

G6 and G7 are the two collapsed-caret joins `$joinIntoTextOnlyBlock` keeps.

### Manual (browser) checks

Run `npm run dev` at the repo root and open **MD Editor**. Replace the content with E1's document (an HTML block, a blank line, `efgh **ij** kl [a](u) \*x\*`, a blank line, `after`). "The E1 selection" is a drag from between `ra` and `w` in the raw block to between `efg` and `h`.

| # | Steps | Expected |
|---|---|---|
| M1 | Make the E1 selection, type `x`. Switch to source mode | the raw block ends `raxh **ij** kl [a](u) \*x\*`: the backslashes are there |
| M2 | Undo once after M1 | the document and the selection are back as before M1 |
| M3 | Repeat with Tab, Shift+Enter, Ctrl/Cmd+X (then Ctrl/Cmd+V elsewhere), Ctrl+Backspace (Alt+Backspace on macOS), and Cmd+Backspace on macOS (`DELETE_LINE_COMMAND`, which cannot run offline), undoing between each | the backslashes stay every time; one undo restores each |
| M4 | Make the E1 selection and start an IME composition (on macOS, hold `e` and pick an accent; otherwise a CJK input method), commit it | the composed text is in the raw block after `ra`; the backslashes stay; no console error |
| M5 | Make the E1 selection, then drag the highlighted selection onto the end of `after` | the selection is removed as in M1; the dragged content lands at the drop point |
| M6 | Make the E1 selection dragged backward (from `efg│h` up to `ra│w`), paste a copied bold word | the same result as the forward drag: the word goes in as plain text inside the raw block |
| M7 | Load E7's document. Drag from after `<` in `<div>` to after `a` in `after`, press Enter | two paragraphs, `<` and `fter` |
| M8 | Same selection as M7, Shift+Enter | one paragraph `<`, a hard break, `fter` |
| M9 | Load E8's selection (from after `<` to the end of `after`), Shift+Enter | the documented limit: the selection is removed, one paragraph `<`, no break |
| M10 | Load E31's document. Drag from `c1` into `raw text`, press Tab | a paragraph `w text` and a raw block `</div>`; no code block |
| M11 | In a raw block, select `div` inside `<div>` and type `p` | the block stays one raw block reading `<p>…` |

---

## Verification

- `npm run typecheck` and `npm -w packages/lib run typecheck:test` (repo root).
- `npm run lint` (repo root): zero errors.
- From `packages/lib`: `npx vitest run tests/component/markdown-editor-text-only-edge.test.ts`: every row passes.
- `npm test` (repo root): the full suite is green.
- `npm run docs:api` (repo root): zero warnings.
- The greps of steps 5, 9 and 10.
- The manual checks M1–M11.
- **Scratch fuzz, outside the repo** (copy into `packages/lib/tests/component/` to run, never commit):
  - `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/review-fixes/b/zz-table-edge-fuzz-lbdeclined.test.ts`. Its allowance for a range end in a raw block can go: the two `inRaw … && !STRICT` conditions that skip the parity check (the first edit, and the edit after it). Run it with `FUZZ_STRICT=1`; expect 0 failures.[^tef-allowance] Its counting of an unchanged `insertImage` or Shift+Enter as "declined" stays: both are declined by design.
  - `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/review-fixes/d/zz-sf-lb-diff.test.ts`. After this plan, a range it tags `RAW` may give only `removed-but-break-declined`, and then the direct and the stepped document are equal. `kept-differs` and `declined-but-would-keep` must be 0 for `RAW` ranges too. A widened copy that takes every guarded shape, dispatches inside an update, and compares Enter, Tab, typing and `INSERT_PARAGRAPH_COMMAND` as well is at `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans2/raw-block-range/zz-rbr-diff.test.ts` (`FUZZ_ANY=1 IN_UPDATE=1 FUZZ_ROUTE=enter|tab|type|paragraph`). Remove its `installPrototype` call before running it against the implementation.

---

## Documentation Impact

No public API changes. Two text edits.

**`packages/lib/docs/components/MarkdownEditor.md`**, the paragraph that starts "Markdown the editor has no rich-text form for" (line 82). Replace this text:

> inside one, Enter adds a line (at a raw block's end it starts a new paragraph after it, at its start one before it; pressed over a selection with an end in a raw block, it removes the selection as Delete does and then does what it does at the caret that leaves, whichever way the selection was made), pasted content goes in as plain text, Backspace at the start of a paragraph after the block (or Delete at the block's end) joins that paragraph to it as its Markdown, and so does the rest of a block a deleted range reaches into from inside it; the typing shortcuts do not apply there, and the format toggles, text styles, links, images and tables decline, since the block saves its text as written.

with:

> inside one, Enter adds a line (at a raw block's end it starts a new paragraph after it, at its start one before it), pasted content goes in as plain text, and Backspace at the start of a paragraph after the block (or Delete at the block's end) joins that paragraph to it as its Markdown; the typing shortcuts do not apply there, and the format toggles, text styles, links, images and tables decline, since the block saves its text as written. A selection that runs from inside such a block into another block is removed the same way by every edit that replaces it — Delete, Backspace, a word or line delete, a cut, typing, an input method, Enter, Shift+Enter, Tab, a paste and a drag that moves it — whichever way it was made: the rest of the block it ends in joins the raw block or code block as its Markdown (as its text, when that block is a raw block or a code block too), so its formatting, links and escaped characters keep meaning what they showed; a raw block whose text then reads as other blocks shows as those blocks; and what the edit inserts goes in at the caret that leaves, as it would after Delete. A selection that runs into such a block from a block before it is removed first too, and what is left of the raw block or code block joins that earlier block as text. A selection inside one raw block or code block is edited as text: what is typed or pasted replaces it in place, and a raw block is read again afterwards. Shift+Enter over a selection that leaves such a block is judged before anything is removed (see *Line breaks* below); where the removal makes a raw block read as a block in which the break has no place, the selection is removed and no break is added.

**`packages/lib/docs/reference/changelog/next.md`** → `## Fixed` → `### Components`, appended:

```markdown
- **`MarkdownEditor` replaces a selection that leaves a raw Markdown block or
  a code block the way Delete removes it.** Typing, an input method, Tab,
  Shift+Enter, a paste, a cut, a word delete or a drag over a selection that
  ran from inside such a block into rich text merged the two blocks' nodes:
  escaped characters lost their escape (`\*x\*` was saved as `*x*`, which
  reads as emphasis), and from the block's start the bold and the link of
  the joined text were dropped too. Only Delete, Backspace and Enter kept
  them. Every such edit now removes the selection as Delete does — the rest
  of the later block joins as its Markdown — and then inserts at the caret
  that leaves, whichever way the selection was made. A raw block the removal
  makes read as other blocks shows as those blocks before the insert, so
  Enter, Shift+Enter, Tab and a paste over it give what Delete followed by
  the same key gives: Enter over a selection that cuts `<div>` down to `<`
  starts a new paragraph, and Tab no longer turns what is left into a code
  block. A paste over a selection that runs into such a block no longer
  depends on the direction the selection was dragged in. One limit remains:
  Shift+Enter is judged before the selection is removed, so where the
  removal makes a raw block read as a block in which the break has no place,
  the selection is removed and no break is added. No consumer action is
  needed.
```

---

## Potential Challenges

- **The stack tip moves and four sibling plans edit `MarkdownEditor.ts`.** Find every site by its symbol name, not by line number.
- **Worktree `node_modules`.** A fresh worktree needs `node_modules` and `packages/lib/node_modules` symlinked to the main tree's.
- **A row that passes only outside an update.** Outside an update Lexical runs each priority in its own update and applies the node transforms between them, so the old code already re-read a raw block between the CRITICAL guard and the handlers after it. A cell that is green outside an update and red inside one means some step still waits for the end of the update. Fix the code, not the row.
- **Do not copy the re-read.** `$removeGuardedRange` must call `$showRawBlockAsRead`, the function the transform calls. A second copy of that body would let the two drift.
- **Do not add the re-read or the guard to a selection inside one block.** Rows G1–G4 fail if `$isTextOnlyEdgeRange` matches a selection inside one raw block.
- **`$deleteRangeFromTextOnlyBlock` moves the editor's own selection** (`tailBlock.selectEnd()`). Every caller passes the editor's selection, including `$clearGuardedRangeBeforePaste`: each path that dispatches `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` passes `$getSelection()` as `payload.selection`. Do not pass a clone.
- **The control's caret format.** Offline nothing gives a caret the format of the text it lands in, so step 2 of the control does. Without it, typing and plain-text paste cells differ at a format edge (E2, E13).
- **Class-name stubs.** `registerRichText`'s paste and cut handlers tell event kinds apart by class name, so the `PASTE_COMMAND` and `CUT_COMMAND` routes need the `vi.stubGlobal` lines. `CUT_COMMAND` over E30–E32 (a table-edge range) also needs `$getClipboardDataFromSelection` mocked, as row R25 of `markdown-editor-table-edge.test.ts` does.
- **`DELETE_LINE_COMMAND` cannot run offline** (Lexical needs a `window`). M3 covers it.

---

## Critical Files

- [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts): `registerRangeGuards` (L2745) and `$removeGuardedRange` (L1690), the precedent this plan extends; `$isTableEdgeRange` (L1371), the predicate `$isTextOnlyEdgeRange` copies; `$deleteRangeFromTextOnlyBlock` (L2101) and `$joinIntoTextOnlyBlock` (L2055); `$handleRawBlockEnter` (L961); the Shift+Enter decision (`$removalJoinsEndBlockRest` L1256, `$guardedRemovalDeclinesLineBreak` L1882); `$clearGuardedRangeBeforeTyping` (L1951); `$pasteIntoTextOnlyBlock` (L1062) and `$pastePlainTextIntoRawBlock` (L1132); `cut()` (L5016), `paste()` (L5058); `buildEditor` (L5871).
- [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts): `registerRawBlockRules` (L533), `$showRawBlockAsItsBlocks` (L574), `$showRawBlocksAsWritten` (L672), `$lineBreakUnwritableAt` (L1086), `registerRunEdgeRules` (L1440), `$editOrRestore` (L1988).
- [markdown-editor-command-crashes.test.ts](../packages/lib/tests/component/markdown-editor-command-crashes.test.ts) and [markdown-editor-table-edge.test.ts](../packages/lib/tests/component/markdown-editor-table-edge.test.ts): the helpers, the event stubs (R13, R15, R25) and the row style to copy.
- [plans/implemented/markdown-editor-command-crash-fixes.md](implemented/markdown-editor-command-crash-fixes.md) and [plans/implemented/markdown-editor-table-delete-merge.md](implemented/markdown-editor-table-delete-merge.md): the two guard plans, and in their *Implementation Notes* the known limits this plan closes.
- `node_modules/lexical/src/LexicalUpdates.ts` L915–944 (one update per priority for a command dispatched outside an update); `node_modules/lexical/src/LexicalEvents.ts` L1056–1130 and L1370–1410 (which command each input event and a composition start dispatch); `node_modules/@lexical/rich-text/src/index.ts` L1195 (`CONTROLLED_TEXT_INSERTION_COMMAND`) and L540 (the native cut).

---

## Non-Goals

- **What Delete itself gives.** This plan makes the other routes equal Delete. It does not change Delete's result for any selection. Two results that may look odd are Delete's today and stay: a selection from a raw block into a `:::` column's word joins the rest of that paragraph and leaves the fence with one column, saved as `::: {}` (E26, E27); and the rest of a code block joins a raw block as its text, and the rest of a raw block joins a code block as its text.
- **Making Shift+Enter's decision foresee the re-read.** See the limit and its footnote.
- **A selection inside one text-only block.** It stays an in-place edit of the block's text.
- **A collapsed caret.** Enter on Android (`INSERT_PARAGRAPH_COMMAND` with no `KEY_ENTER_COMMAND`) inside a raw block, and Shift+Enter at a raw block's end, behave as they do today.
- **What a cut puts on the clipboard.** It is what Lexical copies from the selection as it stands.
- **A forged selection between two cells of one table.** No browser makes one; the scratch fuzz reports a few differences for that shape, before and after this plan.
- **Committing a fuzz harness.** The seeded editor fuzz is its own, later plan.

---

## Addendum: Measurements

All measured at `63a81117d`. The prototype was built without touching the source: listeners put first in each command's CRITICAL set from a test, each removing a guarded range by dispatching `DELETE_CHARACTER_COMMAND` inline and then calling a copy of the raw-block transform's body. It covers every route except the public `cut()` and `paste()`, which call `$removeGuardedRange` directly and so cannot be intercepted from a test. The scratch files are in `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans2/raw-block-range/` (`zz-raw-range-probe.test.ts`, `zz-proto.ts`, `probe-baseline.json`, `probe-proto.json`).

**The matrix** (the 32 shapes above × 2 directions × 19 routes × 2 dispatch contexts = 2,432 cells):

| | Stack tip | Prototype |
|---|---|---|
| cells that differ from the control, of the 2,160 comparable cells the prototype covers | 682, and 28 more `CUT_COMMAND` cells that cannot run offline | 0 |
| cells where the editor does not show what it saves, or a reload differs | 0 | 0 |
| cells one undo does not restore | 0 | 0 |
| throws inside the editor | 0 | 0 |

The second row is why the parity checks never saw the defect: the editor always showed what it saved. What was lost is the meaning the text had before the edit.

**The Shift+Enter differential** (`zz-rbr-diff.test.ts`, every guarded shape, seeds 601 and 1709, 2,770 ranges, dispatched inside an update):

| Outcome | Stack tip | Prototype |
|---|---|---|
| break kept, but the document differs from Delete-then-Shift+Enter | 367 | 16 |
| declined, though Delete-then-Shift+Enter keeps the break | 57 | 0 |
| range removed, break then declined | 215 | 94 |

The prototype's 16 are all forged selections between two cells of one table (see *Non-Goals*). Its 94 all have an end in a raw block, and in every one the document equals Delete's.

**The other routes** (same harness, seed 601, 843 ranges, inside an update): documents that differ from Delete-then-route went from 63 to 6 for Enter, 101 to 5 for Tab, 106 to 6 for `INSERT_PARAGRAPH_COMMAND`, and 109 to 25 for typing. What is left is the forged cross-cell shape, the format of typed text at a format edge (the control there cannot follow Lexical's replace rule), a hard break the deletion leaves at a block's end, and one list-looseness case. None involves the re-read.

**Existing tests with the prototype installed on every editor:** `markdown-editor-command-crashes.test.ts` and `markdown-editor-table-edge.test.ts` pass 213 of 216 rows; the three that fail are the native-cut rows, because the prototype leaves out the clipboard. `markdown-editor.test.ts`, `markdown-editor-columns.test.ts`, `markdown-source-preservation.test.ts` and the in-repo `markdown-edit-fuzz.test.ts` pass all 1,283 tests.

**The table-edge fuzz** with `FUZZ_STRICT=1` (seed 601, 1,200 cases): 0 failures at the stack tip and with the prototype.

---

## Notes

[^third-shape]: The alternative was to make the text-only join the default
    removal for every range: each guard would remove any selection first and
    let the route insert at a caret. It was rejected for two reasons. It
    changes how every ordinary selection is replaced, which is the most
    common edit there is and has no defect. And it would turn a
    selection inside one raw block into "Delete, re-read, then type", which
    breaks retyping a tag name (see `[^same-block]`). A third guarded shape
    touches only the selections that have the defect, and it reuses every
    listener `registerRangeGuards` already has. The definition copies the
    table-edge one ("one end inside, the other end outside") so it covers
    both directions. The direction from rich text into a text-only block
    loses no meaning today, but it must be removed first all the same: the
    two paste handlers read the selection's anchor, so a paste over such a
    range pasted as plain text or as rich text depending on which way it was
    dragged (measured: rows E5, E13, E14 dragged backward).

[^order]: Today `$deleteTableEdgeRange` runs at CRITICAL, then
    `$joinIntoTextOnlyBlock` and `$deleteStaleFocusRange` at HIGH in that
    order, then Lexical's handler. Table-edge is first because a range from
    a raw block into a cell must lose the whole table, not have the cell's
    rest joined (rows D17, R10, R19, R31 of the table-edge tests). The join
    is ahead of the stale-focus removal because a range from a raw block
    into a later block's word is both shapes, and the stale-focus removal
    is Lexical's merge, which is the defect (row R14 of the crash tests).
    `$removeRangeBeforeEnter` already copied this order by hand; this plan
    removes the copy.

[^delete-same]: While Delete was three listeners and every other route one
    function, "as Delete does" was kept true by hand, in comments. That is
    how the routes drifted: Enter was fixed in review round 3 of the
    command-crash-fixes plan and the others were left as a known limit.
    With Delete on `$deleteGuardedRange`, there is one body. Nothing sits
    between the old and the new position of the join: the only other
    `DELETE_CHARACTER_COMMAND` listener of the editor at CRITICAL is the
    run-edge tag, which returns `false`, and `@lexical/table`'s own delete
    handlers are registered at HIGH when the view mounts, after ours.

[^reread]: Evidence that the re-read has to be inside the removal, and that
    it can be. A command dispatched inside an update (what a browser does)
    runs all its listeners before any transform, so today Enter puts a line
    break into a raw block that is about to become a paragraph (`<⏎fter`),
    Tab puts a tab at the start of raw text that then reads as an indented
    code block, and a paste goes in as plain text and loses its bold. Shift+Enter
    and Tab dispatched outside an update gave other results, because
    Lexical then runs each priority in its own update with the transforms
    between (`LexicalUpdates.ts` L915–944): the result depended on how the
    command was sent. With the re-read called from the removal, both
    contexts give the same document, and it is Delete-then-route's (0 of
    2,160 cells differ, see the addendum). Calling the transform's own
    function early is safe because the function is a pure function of the
    block's text, its siblings and the caret, and the transform that runs
    later finds a block that already reads as itself and does nothing.
    Lexical exports no way to run all transforms in the middle of an
    update, so the one rule that changes the caret's block type is called
    by name; the other rules only tidy the block the caret is already in.

[^lb-formula]: `$lineBreakUnwritableAt(start, …)` is `false` whenever the
    start's block is not one of the blocks the line-break rules keep, and a
    raw block and a code block are not. So for a range that starts in a
    text-only block the formula says "kept", which is right: the caret stays
    in that block. For a range that ends in one, the removal is Lexical's,
    and `$removalJoinsEndBlockRest` already describes which blocks Lexical
    joins. Measured: with this formula the prototype never declines where
    Delete-then-Shift+Enter keeps a break, and never keeps one in a
    different place (0 of 2,770 ranges, forged cross-cell ranges aside).
    One behaviour changes for a selection that is not stale-focus: from
    inside a raw block to the end of a later paragraph, today's unguarded
    decision reads the range's end, finds nothing after it and declines;
    the removal would in fact leave the caret in the raw block, which keeps
    the break. That selection now gets its break (row E5). Where the raw block
    then re-reads (row E8), the same selection is no longer declined: it
    falls under the limit below.

[^lb-limit]: Making the decision exact needs the document the removal
    produces, before anything is removed. Three ways were looked at, and
    none is sound.
    (1) *Remove, check, restore.* Lexical has no rollback inside an update.
    The editor's own "try, check, restore" (`$editOrRestore`,
    markdownWritable.ts L1988) restores the inline content of blocks that
    survive, keeping the block nodes. A cross-block removal deletes blocks.
    Building them again from a snapshot makes new, dirty nodes, and the
    rules that are skipped for a load would then run on them:
    `$normalizeList` joins two lists a load keeps apart, and the re-read
    itself is skipped during a load. A "declined" Shift+Enter would change
    the document.
    (2) *Compute the raw block's text ahead of the removal* and read it with
    `$readRawBlockAsBlocks`. The text is the block's head plus the Markdown
    of the end block's rest, which `$detachRestOfBlock` produces by moving
    nodes and copying links; a non-moving copy of that, one formula per
    shape (the join, a table-edge start in a raw block, a table-edge end in
    one), plus the rule that shows an unclosed HTML block as a paragraph,
    which needs the node in place. That is a second removal written beside
    the first: the drift this plan exists to end.
    (3) *Skip the decision for these ranges* and always remove. That turns
    today's correct declines (rows E13, E25) into removals.
    What is left is small and one-directional. With the re-read inside the
    removal, the result is always Delete-then-Shift+Enter's document; the
    only miss is that the selection is removed where "nothing changes" was
    the ideal. Measured: 94 of 2,770 fuzzed guarded ranges (3.4%), every
    one with an end in a raw block and every one equal to Delete's
    document. Before this plan the same harness found 639 misses of three
    kinds. The count depends on how many blocks load raw; after
    `markdown-editor-list-item-block-paste`, lists with multi-block items
    load as lists and the count falls.

[^text-format]: Lexical's `insertText` over a range types in the format of
    the range's first text node. A guard that collapses the range first
    loses that, which is why `$clearGuardedRangeBeforeTyping` already
    copies it (row R5 of the crash tests), and why it types in the caret's
    text format when the range starts in a table (rows R26, R36 of the
    table-edge tests). A text-only block is the same case as a table: its
    text has no format, and after a re-read the nodes are new, so the only
    meaningful format is that of the text the caret lands in. That is also
    what a browser gives a caret after Delete (its selection change copies
    the anchor text's format), so it equals Delete-then-type. The plain-text
    paste goes through the same `insertText`; without the helper, pasting
    plain text over a selection that starts in bold text and ends in a raw
    block would start pasting plain where it pastes bold today (row E13).

[^same-block]: Measured on `<div>⏎raw text⏎</div>` with `div` selected:
    typing `p` gives `<p>⏎raw text⏎</div>`, one raw block. Delete alone
    gives `<>⏎raw text⏎⏎</div>`, which no longer opens an HTML block, so it
    re-reads as a paragraph and a raw block; typing `p` then gives the
    literal text `\<p>`. Treating the selection as "Delete, then type"
    would make it impossible to retype a tag name by selecting it. The
    middle state does not exist when the replace is one step, and inside
    one block nothing is merged, so no meaning is lost.

[^tag]: `RUN_EDGE_TAG` is how `registerRunEdgeRules` knows an update
    deleted something and tidies each changed block whole (bold left on a
    space at a run's edge, a construct kept as source that the edit took
    apart). The removal is a deletion on every route, so it carries the
    tag on every route. A tag added twice is one tag. The prototype removed
    through `DELETE_CHARACTER_COMMAND`, which is tagged, so the measured
    results include the tag; all existing tests passed with it.

[^paste-direction]: `$pasteIntoTextOnlyBlock` and
    `$pastePlainTextIntoRawBlock` decide by the block holding the
    selection's anchor. Over a range that was the block the drag started
    in. After the guard it is the block the caret is in, which is the
    contract. No change to either handler is needed, and row G5 pins that a
    paste bringing no node still leaves the range alone.

[^undo]: Measured: one `UNDO_COMMAND` restored the source in all 2,432
    cells, in both dispatch contexts, at the stack tip and with the
    prototype. The table-delete plan's round 2 fixed the one route that had
    broken this (`insertTable` dispatched its command after the update that
    removed the range); nothing in this plan dispatches after an update.

[^existing-tests]: Run with the prototype installed on every editor: 213
    of 216 rows of the two guard test files pass (the three native-cut rows
    fail only because the prototype has no clipboard half), and all 1,283
    tests of the other four files pass. The prototype does not cover the
    public `cut()` and `paste()`. If an existing row over those two methods
    fails, check its selection: only a row whose selection is a
    text-only-edge range may change, and its new value must equal Delete's
    result with the method's insert at the caret.

[^contexts]: Lexical's `dispatchCommand` from outside an update wraps each
    priority's listeners in `updateEditorSync`, which starts an update and
    applies the node transforms when it ends. From inside an update the
    listeners run inline. A browser's key, input, paste and composition
    events all reach the editor inside one update. The existing guard tests
    dispatch outside an update, which is the context that hid the re-read
    defect.

[^paste-method]: `paste()` inserts through `insertRawText`, which builds
    plain text nodes and does not read the selection's format, so its text
    is plain where the plain-text `PASTE_COMMAND` takes the caret's format.
    That is `paste()`'s existing behaviour at any caret; its control (Delete,
    then `paste()`) gives the same.

[^tef-allowance]: The harness skipped the parity check for a range end in
    a raw block because of one divergence that needed no table: a raw block
    cut down to `<div` as the last line showed as a raw block and read in
    the viewer as a paragraph. `markdown-raw-block-html-tail-parity`, the
    stack tip this plan is written against, fixed that. Measured with
    `FUZZ_STRICT=1`: 0 failures at the stack tip and with the prototype.
