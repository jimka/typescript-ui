---
depends-on: [markdown-editor-raw-block-edge-cases]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/tests/component/markdown-editor-command-crashes.test.ts
  - packages/lib/tests/component/markdown-editor-table-cells-paste.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Raw Block Range Edits — Implementation Plan

## Overview

In `MarkdownEditor`'s WYSIWYG mode, a *raw block* (`MarkdownRawBlockNode`) holds Markdown the editor has no rich-text form for, shown as its source and saved as written. A code block is the other block that holds only text. This plan calls the two *text-only blocks*, as the code does (`$isTextOnlyBlock`).

A selection that runs from inside a text-only block into another block is replaced differently depending on how it is replaced. This plan calls each way of replacing a selection a *route*: Delete, typing, an input method (IME), Enter, Shift+Enter, Tab, a paste, a cut, a drag, and the public methods. Delete, Backspace and Enter join the later block's rest to the text-only block as its Markdown source. Every other route lets Lexical merge the nodes, and the text then changes meaning:

| Source | Selection | Route | Saved tail today | Saved tail after this plan |
|---|---|---|---|---|
| `<div>⏎raw text⏎</div>⏎⏎efgh **ij** kl [a](u) \*x\*` | `"raw text"`@2 → `"efgh "`@3 | Delete | `h **ij** kl [a](u) \*x\*` | same |
| same | same | type `x`, Tab, Shift+Enter, paste, cut, word delete, drag | `… [a](u) *x*` (the escape is lost; `*x*` now reads as emphasis) | `… [a](u) \*x\*` |
| same | `"<div>"`@0 → `"ij"`@0 | type `x` | `xij kl a *x*` (bold and link lost too) | `**xij** kl [a](u) \*x\*` |
| `<div>⏎raw text⏎</div>⏎⏎after` | `"<div>"`@1 → `"after"`@1 | Enter | `<⏎fter` (one paragraph) | `<⏎⏎fter` (two paragraphs, as Delete then Enter gives) |

(`⏎` is a line end. `"text"`@n is offset n in the text node holding exactly that text.)

The fix is in [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) and [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts). One function, `$removeGuardedRange`, becomes the only way a range that crosses out of a block is removed, on every route, Delete included. It also shows a raw block the removal changed as the blocks its text now reads as, before the route inserts anything. Rows are added to an existing test file, one existing row is restated, and the docs page and the changelog are updated. There is no public API change.

This plan is written against `85b55a8f4`, the tip of `feature/markdown-editor-paste-undo-merge`. Line numbers are from that commit. Sibling plans edit the same files, so find each site by its symbol name. Every snippet below was run as printed, as a patch applied in memory to that commit; see the [addendum](#addendum-measurements).

---

## Architecture Decisions

### One contract — every route removes a range the way Delete does, then inserts at the caret

Replacing a selection is two steps in one update: remove the selection, then do the route's own insert at the caret the removal leaves. The removal is the same function on every route. The route's insert is whatever the route does at a collapsed caret in the block the caret is now in.

So for every route, the result equals what the user gets by pressing Delete and then using the route at the caret. The exceptions are listed under [What stays different from Delete-then-route](#what-stays-different-from-delete-then-route).

### One place — `$removeGuardedRange`, with a third guarded shape

The editor already has this design for two selection shapes Lexical removes wrongly. `registerRangeGuards` ([MarkdownEditor.ts:3835](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3835)) registers one listener per Lexical command at `COMMAND_PRIORITY_CRITICAL`. Each listener calls `$removeGuardedRange` ([:2325](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2325)) and then lets the command's own handler insert at the collapsed caret. The two shapes are:

- the *table-edge range* (`$isTableEdgeRange`, [:1890](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1890)): one end inside a table, the other end outside that table;
- the *stale-focus range* (`$isStaleFocusRange`, [:1688](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1688)): it ends strictly inside a text node of a later block than it starts in, a shape Lexical's own removal can throw on.

This plan calls a selection of any shape `$removeGuardedRange` takes a *guarded range*.

This plan adds a third shape to `$removeGuardedRange`, the **text-only-edge range**: a selection that is not collapsed, with one end inside a text-only block and the other end outside that block. Every existing guard listener then handles the new shape without a listener of its own.[^third-shape]

`$removeGuardedRange` picks the removal in a fixed order, the first that applies:

1. a table-edge range: `$removeTableEdgeRange` ([:2213](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2213));
2. a range that starts in a text-only block and ends outside it: `$deleteRangeFromTextOnlyBlock` ([:2787](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2787)), the *text-only join*, which joins the rest of the end's block as its Markdown;
3. a stale-focus range: `$removeStaleFocusRange` ([:1717](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1717));
4. any other guarded range (it ends in a text-only block at a point that is not stale-focus): Lexical's `selection.removeText()`.

Removals 2 to 4 get a function of their own, `$removeJoiningRange`. This order is the order Delete's listeners run in today.[^order] Which shapes a selection is, and which removal it gets:

| Selection | Table-edge | Text-only-edge | Stale-focus | Removed by |
|---|---|---|---|---|
| raw block → a paragraph's word | no | yes | yes | the text-only join |
| raw block → a paragraph's start | no | yes | no | the text-only join |
| raw block → a list item's text | no | yes | either | the text-only join; the item's other blocks move as the item's own join rule moves them |
| paragraph → raw block's word | no | yes | yes | the stale-focus removal |
| paragraph → raw block's start | no | yes | no | Lexical's `removeText()` |
| raw block → another raw block or a code block | no | yes | either | the text-only join |
| raw block → a table cell | yes | yes | either | the table-edge removal |
| paragraph → a later paragraph's word | no | no | yes | the stale-focus removal |
| inside one raw block, or inside one paragraph | no | no | no | not guarded: Lexical replaces it in place |

`$removeGuardedRangeForInsert` ([:2134](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2134)), which the insert routes call, is not changed: it calls `$removeGuardedRange` first and so takes the new shape with it.

### Delete calls the same function

`DELETE_CHARACTER_COMMAND` has three range listeners today: `$deleteTableEdgeRange` at CRITICAL, then `$joinIntoTextOnlyBlock` and `$deleteStaleFocusRange` at `COMMAND_PRIORITY_HIGH`. They are replaced by the listener the other delete commands already use, `$deleteGuardedRange` ([:2415](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2415)), at CRITICAL. `$joinIntoTextOnlyBlock` ([:2739](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2739)) keeps only its two collapsed-caret joins (Backspace at a paragraph's start after a text-only block, Delete at a text-only block's end). `$deleteTableEdgeRange` and `$deleteStaleFocusRange` are deleted.[^delete-same]

`$deleteGuardedRange` leaves one kind of guarded range to the command's own handler: a *plainly removed range*, one whose removal is Lexical's own and nothing more (removal 4 of the list above). The four delete commands remove such a range rightly today, and Lexical's Backspace does one thing more after it that no other route does. So Delete and Backspace give what they give today for every selection.[^plain-range]

| Range, Backspace | Removal | Handled by | Result (unchanged) |
|---|---|---|---|
| `"raw text"`@2 → `"efgh "`@3 (starts in a raw block) | the text-only join | the guard | `<div>⏎rah **ij** …` |
| `"efgh "`@3 → `"raw text"`@2 (ends inside a raw block's word) | the stale-focus removal | the guard | `efgw text\⏎\</div>` |
| `"ab"`@0 of a heading that opens the document → `"</div>"`@6 (ends at a raw block's end) | Lexical's `removeText()` | Lexical's own Backspace | an empty paragraph: Lexical turns the emptied first block into one |

### The re-read is part of the removal

When a raw block's text is edited until it reads as other blocks, a node transform shows it as those blocks. The transform's body is `$showRawBlockAsSaved`, today a function local to `registerRawBlockRules` ([markdownWritable.ts:923](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L923)). This plan calls what it does the *re-read*. A node transform runs when the update ends, so today a route's insert runs before the re-read and meets a raw block that is about to become something else.

`$removeGuardedRange` now does the re-read itself, right after the removal, for each raw block that held an end of the range and is still in the document. `$showRawBlockAsSaved` moves to module level and is exported for it. The transform keeps calling the same function, so the two cannot differ.[^reread]

| Source | Selection | Route | Today (in a browser) | After |
|---|---|---|---|---|
| `<div>⏎raw text⏎</div>⏎⏎after` | `"<div>"`@1 → `"after"`@1 | Enter | `<⏎fter` | `<⏎⏎fter` |
| same | same | Shift+Enter | `<⏎fter` (a source line end) | `<\⏎fter` (a hard break in the paragraph) |
| same | same | paste bold `zp` | `\<zpfter` (bold lost) | `<**zp**fter` |
| table, then `<div>⏎raw text⏎</div>` | `"c1"`@1 → `"raw text"`@2 | Tab | what is left becomes a code block | `w text⏎⏎</div>`, as Delete then Tab gives |

### Shift+Enter is still judged before the removal

Shift+Enter is declined where Markdown has no hard break, and a declined Shift+Enter must change nothing. So `$clearGuardedRangeBeforeLineBreak` ([:2558](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2558)) keeps deciding before it removes anything. The decision for a text-only-edge range uses the formula the stale-focus range already has: `$lineBreakUnwritableAt(start, joinsRest ? end : null)`.[^lb-formula]

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

`$handleRawBlockEnter` ([:969](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L969)) removes a range itself, through `$removeRangeBeforeEnter` ([:1042](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1042)). That function's body becomes: `$removeGuardedRange(selection)`, and Lexical's `selection.removeText()` when the range is not guarded. `$handleRawBlockEnter` then reads the caret's block from the selection as it is after the removal, re-read included. The `@remarks` paragraph saying a re-read block "still counts as raw here" is removed.

### A selection inside one text-only block is not guarded

A selection with both ends in one raw block or one code block is an edit of that block's text. Lexical replaces it in place and the raw block is re-read when the update ends. This is today's behaviour and it does not change.[^same-block]

| Raw block | Selection | Type | Result |
|---|---|---|---|
| `<div>⏎raw text⏎</div>` | `div` in `<div>` | `p` | `<p>⏎raw text⏎</div>`, still one raw block |

### The removal tags the update as Delete's command does

`$removeGuardedRange` adds `RUN_EDGE_TAG` to the update. Delete's command is already tagged with it by `registerRunEdgeRules` ([markdownWritable.ts:1876](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1876)), which makes the rules that tidy a block after a deletion run on the whole block. Typing, Tab, Enter in a raw block and the public `cut()` and `paste()` are not tagged today.[^tag]

### Listener order and priority per command

After this plan. Lexical runs a command's listeners by priority, CRITICAL first, and within one priority in registration order. `buildEditor` ([:6963](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L6963)) registers `registerWritableStateRules` first, then `registerRichText`, `registerList`, `registerTablePlugin`, `registerMarkdownHistory`, the shortcuts, `registerColumnPaste`, `registerTablePartPaste`, `registerItemBlockPaste`, `registerListItemRules`, `registerTextOnlyBlockRules`, `registerItemTextPaste` and `registerRangeGuards`. That order does not change.

| Command (route) | CRITICAL, in order | HIGH, in order | Below HIGH |
|---|---|---|---|
| `KEY_BACKSPACE_COMMAND`, `KEY_DELETE_COMMAND` | `$backspaceOverTableEdgeRange` / `$deleteKeyOverTableEdgeRange` | — | `registerRichText` dispatches `DELETE_CHARACTER_COMMAND` |
| `DELETE_CHARACTER_COMMAND` | run-edge tag, **`$deleteGuardedRange`** | `$joinIntoTextOnlyBlock` (collapsed joins only) | `$backspaceAfterContainer`, then `registerRichText` deletes (a caret, an unguarded range and a plainly removed range) |
| `DELETE_WORD_COMMAND`, `DELETE_LINE_COMMAND` | run-edge tag, `$deleteGuardedRange` | — | `$backspaceAfterContainer`, then `registerRichText` deletes |
| `REMOVE_TEXT_COMMAND` (the source half of a drag, `deleteByCut`, `deleteByComposition`) | run-edge tag, `$deleteGuardedRange` | — | `registerRichText` deletes |
| `CONTROLLED_TEXT_INSERTION_COMMAND` (typing, IME start, the insert half of a drop) | `$clearGuardedRangeBeforeTyping` | — | `insertText` |
| `KEY_ENTER_COMMAND` | — | `$handleSeparatorShortcut`, `$handleRawBlockEnter` | `registerRichText` dispatches `INSERT_PARAGRAPH_COMMAND` |
| `INSERT_PARAGRAPH_COMMAND` | run-edge tag, `$clearGuardedRangeBeforeParagraph` | `$enterLeavesListAtBlankItemText` | `insertParagraph` |
| `INSERT_LINE_BREAK_COMMAND` (Shift+Enter) | run-edge tag, `$clearGuardedRangeBeforeLineBreak` | `$declinesLineBreak` | `insertLineBreak` |
| `INSERT_TAB_COMMAND` | `$clearGuardedRangeBeforeInsert` | — | inserts a tab |
| `PASTE_COMMAND` (plain text) | run-edge tag, `$clearGuardedRangeBeforePastedText` | `$pastePlainTextIntoRawBlock` | pastes |
| `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` (pasted or dropped nodes) | run-edge tag, `$clearGuardedRangeBeforePaste` | `$pasteColumnsAsTheirBlocks`, `$pasteTableRowsAndCellsAsTables`, `$pasteBlocksIntoItemBlock`, `$pasteIntoTextOnlyBlock`, `$splitItemBeforePasteEndingInTableOrFence` | `@lexical/clipboard` inserts |
| `CUT_COMMAND` | run-edge tag, `$cutGuardedRange` | — | cuts |

"Run-edge tag" is the listener `registerRunEdgeRules` registers for that command; it tags the update and returns `false`. Only the `DELETE_CHARACTER_COMMAND` row changes its registrations. The paste handlers at HIGH need no change: they read the selection, and after the CRITICAL guard the selection is a caret.[^paste-direction]

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

### Results that change besides the routes' own

Besides the routes that now equal Delete-then-route, four results change.

| What | Before | After | Why |
|---|---|---|---|
| A paste over a range selected *backward* from the start of a code block or raw block into an earlier block. Row X14 of `markdown-editor-table-cells-paste.test.ts`: a table pasted over `"kode"`@0 → `"abcd"`@2 in `- abcd⏎⏎` and a code block `kode` | the paste goes in as lines of text at the caret, outside the code block: `- abh1\⏎…c2kode` | `- ab`, the table, `- kode`: what the same range selected forward gives | The guard removes the range first, so the paste handlers see a caret and no longer read the range's anchor |
| Shift+Enter over a range that ends at the start or end of a text-only block, where nothing would follow the caret (TE13, TE36, TE41) | the selection is removed and no break is added | declined: nothing changes | It is judged before the removal, as for a stale-focus range |
| Shift+Enter over a range from inside a text-only block to the end of a later block (TE5), and over one the removal makes re-read with nothing after the caret (TE8) | declined: nothing changes | TE5: removed, then a line break in the raw block. TE8: removed, no break (the limit) | The caret the removal leaves is in the text-only block, which keeps every break |
| `INSERT_PARAGRAPH_COMMAND` sent without the Enter key (Android) over a range from the very start of a list item's text to the start or end of a later text-only block (TE36) | the emptied item stays and a second empty item is added | the emptied item leaves the list, as the Enter key over the same range already gives | Enter acts at the caret the removal leaves[^enter-item] |

### The rows go into the existing test file, and the full matrix is the differential check

The rows are added to `markdown-editor-command-crashes.test.ts`, which holds the rows of the stale-focus guard. The full matrix of every shape, direction, route and dispatch context (3,192 cells) is not committed. It is run on the parent and on the branch as the differential check of [Verification](#verification).[^rows-in-file]

### Order with the plans around it

| Order | Plan | Guarded shapes after it |
|---|---|---|
| 1 | `markdown-editor-raw-block-edge-cases` | two: table-edge, stale-focus (unchanged) |
| 2 | `markdown-editor-raw-block-range-edits` (this plan) | three: table-edge, text-only-edge, stale-focus |
| 3 | `markdown-editor-cross-item-range-removal` | four: the three, and cross-item |

This plan is implemented after `markdown-editor-raw-block-edge-cases`.[^after-edge-cases] `markdown-editor-cross-item-range-removal` is implemented after this plan and uses these symbols by name, so they must end with exactly these names and roles:

| Symbol | Role |
|---|---|
| `$isGuardedRange(selection)` | tells whether a selection is one of the guarded shapes; every listener that tests for a guarded range calls it, and no listener tests a single shape on its own |
| `$removeGuardedRange(selection, caretStaysOutOf)` | the one removal of a guarded range |
| `$removeJoiningRange(selection)` | removals 2 to 4 of the list above |
| `$joiningRemovalDeclinesLineBreak(selection)` | Shift+Enter's decision for a range `$removeJoiningRange` removes |
| `$guardedRemovalDeclinesLineBreak(selection)` | Shift+Enter's decision for any guarded range |
| `guard(DELETE_CHARACTER_COMMAND, $deleteGuardedRange)` | Delete's one range listener |
| `$isPlainlyRemovedRange(selection)` | tells the guarded ranges the delete commands leave to Lexical. A plan that adds a guarded shape with a removal of its own must rule its shape out here, or the delete commands skip that removal |

---

## Internal Structure

All in `MarkdownEditor.ts` unless a heading says otherwise. Write full JSDoc per CODE_CONVENTIONS; the bodies are below. A call's result is assigned to a constant before it is tested.

### `markdownWritable.ts` — `$showRawBlockAsSaved` at module level

Move the two functions that are local to `registerRawBlockRules` ([markdownWritable.ts:903](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L903)) out of it, directly before it. `checkSiblings` becomes `$showSiblingRawBlocksAsWritten`. `$showRawBlockAsSaved` keeps its name, its body and its JSDoc, and is exported.

```typescript
function $showSiblingRawBlocksAsWritten(node: LexicalNode): void {
    const parent = node.getParent();

    if (parent !== null) {
        $showRawBlocksAsWritten(parent);
    }
}

export function $showRawBlockAsSaved(node: MarkdownRawBlockNode): void {
    const steps = [$moveBlocksOutAfter, $showSiblingRawBlocksAsWritten, $showRawBlockAsItsBlocks, $readListAgainAroundRawBlock];

    for (const step of steps) {
        const inPlace = node.isAttached();

        if (inPlace) {
            step(node);
        }
    }
}
```

`registerRawBlockRules` keeps its `mergeRegister(…)` call. Only the two `checkSiblings` registrations change their argument:

```typescript
        editor.registerNodeTransform(ParagraphNode, $showSiblingRawBlocksAsWritten),
        editor.registerNodeTransform(MarkdownListItemTextNode, $showSiblingRawBlocksAsWritten),
```

### The shape predicates and `$removeJoiningRange`

Place the three functions directly before `$removeGuardedRange`. `$isTextOnlyEdgeRange` copies `$isTableEdgeRange` line for line, with `$isTextOnlyBlock` in place of the table lookup.

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

function $removeJoiningRange(selection: RangeSelection): void {
    const joinedAsMarkdown = $deleteRangeFromTextOnlyBlock(selection);

    if (joinedAsMarkdown) {
        return;
    }

    // Typed `boolean`: left as a type guard's result it would narrow `selection` to `never` in the other branch.
    const isStaleFocus: boolean = $isStaleFocusRange(selection);

    if (isStaleFocus) {
        $removeStaleFocusRange(selection);
    } else {
        selection.removeText();
    }
}
```

`$deleteRangeFromTextOnlyBlock` is unchanged. It already returns `false` for a range that does not start in a text-only block or does not leave it.

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
        const isLeft = block !== null && block.isAttached();

        if (isLeft) {
            $showRawBlockAsSaved(block);
        }
    }

    return true;
}
```

### `$removeGuardedRangeBeforeText` and its two listeners

`$removeGuardedRangeBeforeText` takes over the body of today's `$clearGuardedRangeBeforeTyping` ([:2608](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2608)).

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

    // Read anew: a raw block the removal makes read as other blocks shows as them by now.
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
    const isChanged = $isGuardedRange(selection) || $isListContainerRange(selection) || $listContainerAtCaret(selection) !== null;

    // The shape first: the event is read only for a selection this guard would change.
    const insertsText = isChanged && pasteWillInsertText(event);

    if (insertsText) {
        $removeGuardedRangeBeforeText(selection);
        // What is left to make ready: a range with an end on a list item or a list, and a caret left on one.
        $removeGuardedRangeForInsert($getSelection());
    }

    return false;
}
```

### Shift+Enter's decision

Rename `$staleFocusRemovalDeclinesLineBreak` ([:1815](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1815)) to `$joiningRemovalDeclinesLineBreak`. Its body does not change. Its JSDoc now says it tells for any range that `$removeJoiningRange` removes. In `$guardedRemovalDeclinesLineBreak` ([:2536](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2536)) the last two statements become:

```typescript
    const isJoining = $isTextOnlyEdgeRange(selection) || $isStaleFocusRange(selection);

    return isJoining && $joiningRemovalDeclinesLineBreak(selection);
```

### `$handleRawBlockEnter` after the removal

Everything up to and including the `if (!isCollapsed) { $removeRangeBeforeEnter(selection); }` block stays. What follows reads the selection anew:

```typescript
    // Read anew: a raw block the removal makes read as other blocks shows as them by now.
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

    // A range is removed by the guard of this command, ahead of this listener.
    if (!isCollapsed) {
        return false;
    }
```

`$cutGuardedRange` ([:2668](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2668)): `const isGuarded = $isGuardedRange(selection);` replaces `isTableEdge || $isStaleFocusRange(selection)`. Keep `isTableEdge`; the clipboard data line reads it.

`$deleteGuardedRange` gets a new body, and `$isPlainlyRemovedRange` goes directly before it:

```typescript
function $isPlainlyRemovedRange(selection: BaseSelection | null): boolean {
    const isTextOnlyEdgeAlone = $isTextOnlyEdgeRange(selection) && !$isTableEdgeRange(selection) && !$isStaleFocusRange(selection);

    if (!isTextOnlyEdgeAlone) {
        return false;
    }

    const [start] = $orderedPoints(selection);
    const startsInTextOnlyBlock = $findMatchingParent(start.getNode(), $isTextOnlyBlock) !== null;

    return !startsInTextOnlyBlock;
}

function $deleteGuardedRange(): boolean {
    const selection = $getSelection();
    const isPlain = $isPlainlyRemovedRange(selection);

    // Left to the command's own handler, which removes it the same way; its Backspace also settles a first block the removal empties.
    return !isPlain && $removeGuardedRange(selection);
}
```

These need no change to their bodies, because they call `$removeGuardedRange` or `$removeGuardedRangeForInsert`: `$clearGuardedRangeBeforeInsert`, `$clearGuardedRangeBeforeParagraph`, `$clearGuardedRangeBeforeLineBreak`, `$clearGuardedRangeBeforePaste`, `$removeRangeBeforeImage`, `cut()` and `paste()`.

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

Work test-first. Run test files from `packages/lib` with `npx vitest run <file>`. A fresh worktree needs `node_modules` and `packages/lib/node_modules` symlinked to the main tree's; never run a plain `npm install`.

1. **Record the parent's results** for the differential check, on the commit the branch starts from, before any change: the two runs of [Verification](#verification) → *The differential check against the parent*, step 1.
2. **Add the rows** of [Expected Behaviour](#expected-behaviour) to `markdown-editor-command-crashes.test.ts` and restate row X14 of `markdown-editor-table-cells-paste.test.ts`. Run the two files: the 103 tests the tables mark *red* fail and every other test passes. The run also reports unhandled rejections (`window is not defined`); see [`CUT_COMMAND` before the change](#cut_command-before-the-change). If a row marked *red* passes, stop and re-read the row.
3. **`markdownWritable.ts`:** move `$showRawBlockAsSaved` and `checkSiblings` out of `registerRawBlockRules` as in *Internal Structure*. Check: `grep -n 'checkSiblings' packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` gives no match, and `npx vitest run tests/component/markdown-source-preservation.test.ts tests/component/markdown-editor.test.ts tests/component/markdown-editor-list-item-edits.test.ts` is green (no behaviour changes in this step).
4. **`MarkdownEditor.ts` import:** add `$showRawBlockAsSaved` to the `markdownWritable.js` import ([:64](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L64)). `$addUpdateTag` and `RUN_EDGE_TAG` are imported already.
5. **Add `$isTextOnlyEdgeRange`, `$isGuardedRange` and `$removeJoiningRange`, and replace the body of `$removeGuardedRange`**, as in *Internal Structure*.
6. **`DELETE_CHARACTER_COMMAND`:** add `$isPlainlyRemovedRange` and replace the body of `$deleteGuardedRange`; change `$joinIntoTextOnlyBlock`'s range branch to `return false`; replace the two `DELETE_CHARACTER_COMMAND` rows of `registerRangeGuards` ([:3842](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3842)) with `guard(DELETE_CHARACTER_COMMAND, $deleteGuardedRange)`; delete `$deleteTableEdgeRange` ([:2252](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2252)) and `$deleteStaleFocusRange` ([:1733](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1733)). Check: `grep -n 'deleteTableEdgeRange\b\|deleteStaleFocusRange' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` gives no match (`$deleteTableEdgeRangeFromKey` is a different function and stays). Check: `npx vitest run tests/component/markdown-editor-table-edge.test.ts` is green.
7. **Enter:** replace `$removeRangeBeforeEnter`'s body and the tail of `$handleRawBlockEnter`, as in *Internal Structure*. Remove the `@remarks` paragraph of `$handleRawBlockEnter`'s JSDoc.
8. **Typed and pasted text:** add `$removeGuardedRangeBeforeText`; replace the bodies of `$clearGuardedRangeBeforeTyping` and `$clearGuardedRangeBeforePastedText`.
9. **Cut:** change `$cutGuardedRange`'s `isGuarded` line.
10. **Shift+Enter:** rename `$staleFocusRemovalDeclinesLineBreak` to `$joiningRemovalDeclinesLineBreak` and change `$guardedRemovalDeclinesLineBreak`. Check: `grep -rn 'staleFocusRemovalDeclinesLineBreak' packages/lib/src` gives no match. Check, for the plan that follows: `grep -n '\$isStaleFocusRange(' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` gives the definition and one call each in `$isGuardedRange`, `$removeJoiningRange`, `$guardedRemovalDeclinesLineBreak` and `$isPlainlyRemovedRange`, and nothing else.
11. **JSDoc.** Update every comment that describes the old design. These five count or list the shapes, and each now names three: `$isGuardedRange`, `$removeGuardedRange`, `registerRangeGuards` (all listeners at CRITICAL; no order to keep with `registerTextOnlyBlockRules`), `$guardedRemovalDeclinesLineBreak`, `$joiningRemovalDeclinesLineBreak`. These say "a guarded range" in place of "a table-edge or stale-focus range": `$removeGuardedRangeForInsert`, `$deleteGuardedRange` (it now also lists `DELETE_CHARACTER_COMMAND`, and says which range it leaves alone), `$clearGuardedRangeBeforeLineBreak`, `$clearGuardedRangeBeforePastedText`, `$clearGuardedRangeBeforeTyping`, `$clearGuardedRangeBeforePaste`, `$cutGuardedRange`, `$removeRangeBeforeImage`. And: `registerTextOnlyBlockRules` and `$joinIntoTextOnlyBlock` (the delete listener joins at a collapsed caret only), `$removeRangeBeforeEnter`, `$handleRawBlockEnter`, `$isStaleFocusRange` (its remark names the removal that takes it), and `$keepTextOnly` (it says a merge "can bring in" formatted nodes by typing or pasting over a range; say instead that it catches whatever still reaches the block). Check: `grep -n 'two range shapes\|either side of\|table-edge or stale-focus' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` gives no match.
12. **Run the two test files of step 2.** Every row passes. Then run `tests/component/markdown-editor-table-edge.test.ts`, `tests/component/markdown-editor-table-edge-mounted.test.ts`, `tests/component/markdown-editor.test.ts`, `tests/component/markdown-editor-columns.test.ts`, `tests/component/markdown-editor-list-item-edits.test.ts`, `tests/component/markdown-editor-list-item-paste.test.ts`, `tests/component/markdown-editor-history.test.ts`, `tests/component/markdown-list-item-node.test.ts` and `tests/component/markdown-roundtrip/`. No existing row other than X14 changes.[^existing-tests]
13. **Docs:** edit `packages/lib/docs/components/MarkdownEditor.md` and `packages/lib/docs/reference/changelog/next.md` as in [Documentation Impact](#documentation-impact).
14. **Verification**, in full, the differential check included.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-command-crashes.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-table-cells-paste.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Everything in this section is unit-testable offline unless it is under [Manual (browser) checks](#manual-browser-checks). Expected strings are `getValue()`, written as TypeScript string literals. They were measured with a prototype of this plan; see the [addendum](#addendum-measurements). *Red* means the row fails before the change; *green* means it passes before and after.

All rows go into one new `describe` of `markdown-editor-command-crashes.test.ts`, placed directly before the `upstream canaries` one: `a range that leaves a raw Markdown block or a code block is removed the same way on every route (TE rows)`. It uses the file's `load`, `selectText`, `rangeOf`, `rootChildren`, `lexicalOf` and its mock of `copyToClipboard`. Add the imports the rows need and the file lacks: `DELETE_WORD_COMMAND`, `INSERT_TAB_COMMAND`, `REMOVE_TEXT_COMMAND` and `UNDO_COMMAND` from `lexical`, the type `LexicalCommand` from `lexical`, and `$insertGeneratedNodes` from `@lexical/clipboard`.

### Constants

```typescript
const FENCE = '```';
const RAW = '<div>\nraw text\n</div>';
const RICH = 'efgh **ij** kl [a](u) \\*x\\*';
const CODE = `${FENCE}\ncode *a*\nline2\n${FENCE}`;
/** A code block loads as one text node holding its lines. */
const CODE_TEXT = 'code *a*\nline2';
const TABLE = '| a | b |\n| --- | --- |\n| c1 | d1 |';
const TWO_RAW = '<div>\nraw one\n</div>\n\n<section>\nraw two\n</section>\n\nafter';
```

`RAW_THEN_RICH` is the file's existing constant ([:373](../packages/lib/tests/component/markdown-editor-command-crashes.test.ts#L373)); it equals `` `${RAW}\n\n${RICH}\n\nafter` ``. Text nodes: `RAW` holds `"<div>"`, `"raw text"`, `"</div>"`. `RICH` holds `"efgh "`, `"ij"` (bold), `" kl "`, `"a"` (link), `" *x*"`.

### Helpers

Local to the `describe`. The code was run as printed.

```typescript
/** One way of removing or replacing a selection. */
type Route =
    | 'Delete' | 'Backspace' | 'word delete' | 'REMOVE_TEXT_COMMAND' | 'cut()' | 'CUT_COMMAND' | 'type' | 'IME start' | 'drop insert'
    | 'Enter' | 'INSERT_PARAGRAPH_COMMAND' | 'Shift+Enter' | 'Tab' | 'PASTE_COMMAND' | 'paste()' | 'paste nodes' | 'paste blocks'
    | 'insertImage' | 'insertTable';

/** A selection shape: a document, the range's two ends in document order, and what typing `x` over it and Delete give. */
interface Shape {
    readonly id:      string;
    readonly name:    string;
    readonly source:  string;
    readonly start:   TextPoint;
    readonly end:     TextPoint;
    readonly typed:   string;
    readonly deleted: string;
}

const SHAPES: readonly Shape[] = [
    // one entry per row of the TE table, in its order
];

/** The routes that are a method of the editor: they start their own update. */
const METHOD_ROUTES: readonly Route[] = ['cut()', 'paste()', 'paste nodes', 'paste blocks', 'insertImage', 'insertTable'];

/** Every way a row is run: the range dragged forward and backward, the command dispatched outside an update and inside one. */
const VARIANTS: ReadonlyArray<readonly [backward: boolean, inUpdate: boolean]> = [[false, false], [false, true], [true, false], [true, true]];

/**
 * The shape with the given id.
 *
 * @param id - The shape's id.
 * @returns The shape.
 */
function shapeOfId(id: string): Shape {
    return SHAPES.find((shape) => shape.id === id)!;
}

/**
 * Loads a shape's document and selects its range.
 *
 * @param shape - The shape.
 * @param backward - Whether the range is dragged from its end to its start.
 * @returns The editor.
 */
function select(shape: Shape, backward: boolean): MarkdownEditor {
    const editor = load(shape.source);

    selectText(editor, backward ? shape.end : shape.start, backward ? shape.start : shape.end);

    return editor;
}

/**
 * Stubs the event classes `registerRichText` tells a clipboard, drag, input and key event apart by.
 */
function stubEventClasses(): void {
    vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
    vi.stubGlobal('DragEvent', class DragEvent {});
    vi.stubGlobal('InputEvent', class InputEvent {});
    vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});
}

/**
 * A data transfer holding `text` as plain text.
 *
 * @param text - The text.
 * @returns The transfer's `types`, `files` and `getData`.
 */
function transferOf(text: string): { types: string[]; files: never[]; getData: (type: string) => string } {
    return { types: ['text/plain'], files: [], getData: (type: string) => (type === 'text/plain' ? text : '') };
}

/**
 * Runs one route over the editor's selection.
 *
 * @param editor - The editor.
 * @param route - The route.
 * @param inUpdate - Whether a command is dispatched inside one update, as a browser's key and input events do.
 */
async function run(editor: MarkdownEditor, route: Route, inUpdate: boolean): Promise<void> {
    const lexical = lexicalOf(editor);

    const dispatch = <P>(command: LexicalCommand<P>, payload: P): void => {
        if (inUpdate) {
            lexical.update(() => { lexical.dispatchCommand(command, payload); }, { discrete: true });
        } else {
            lexical.dispatchCommand(command, payload);
        }
    };

    const paste = (nodes: () => LexicalNode[]): void => {
        lexical.update(() => { $insertGeneratedNodes(lexical, nodes(), $getSelection()!); }, { discrete: true });
    };

    switch (route) {
        case 'Delete': dispatch(DELETE_CHARACTER_COMMAND, false); break;
        case 'Backspace': dispatch(DELETE_CHARACTER_COMMAND, true); break;
        case 'word delete': dispatch(DELETE_WORD_COMMAND, false); break;
        case 'REMOVE_TEXT_COMMAND': dispatch(REMOVE_TEXT_COMMAND, null); break;
        case 'type': dispatch(CONTROLLED_TEXT_INSERTION_COMMAND, 'x'); break;
        // What Lexical's composition start dispatches over a range: a zero-width space, the composition's seat.
        case 'IME start': dispatch(CONTROLLED_TEXT_INSERTION_COMMAND, '\u200b'); break;
        // What `insertFromDrop` dispatches: the input event, carrying a data transfer.
        case 'drop insert':
            stubEventClasses();
            dispatch(CONTROLLED_TEXT_INSERTION_COMMAND, Object.assign(new InputEvent('beforeinput'), { dataTransfer: transferOf('zd'), data: null }));
            break;
        case 'Enter': dispatch(KEY_ENTER_COMMAND, null); break;
        case 'INSERT_PARAGRAPH_COMMAND': dispatch(INSERT_PARAGRAPH_COMMAND, undefined); break;
        case 'Shift+Enter': dispatch(INSERT_LINE_BREAK_COMMAND, false); break;
        case 'Tab': dispatch(INSERT_TAB_COMMAND, undefined); break;
        case 'PASTE_COMMAND':
            stubEventClasses();
            dispatch(PASTE_COMMAND, Object.assign(new ClipboardEvent('paste'), { clipboardData: transferOf('zc'), preventDefault: () => {} }));
            break;
        case 'paste()':
            vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('zc');
            await editor.paste();
            break;
        case 'paste nodes': paste(() => [$createTextNode('zp').toggleFormat('bold')]); break;
        case 'paste blocks':
            paste(() => [
                $createParagraphNode().append($createTextNode('p1 '), $createTextNode('zb').toggleFormat('bold')),
                $createParagraphNode().append($createTextNode('p2')),
            ]);
            break;
        case 'cut()': editor.cut(); break;
        case 'CUT_COMMAND':
            stubEventClasses();
            dispatch(CUT_COMMAND, null);
            // The cut removes in an update queued behind the copy.
            await vi.waitFor(() => expect(copyToClipboard).toHaveBeenCalled());
            await Promise.resolve();
            break;
        case 'insertImage': editor.insertImage('/i.png', { alt: 'i' }); break;
        case 'insertTable': editor.insertTable(2, 2); break;
    }
}

/**
 * Asserts that the editor shows what its save reads as, and that a reload saves and shows the same.
 *
 * @param editor - The editor.
 */
function expectParity(editor: MarkdownEditor): void {
    const saved = editor.getValue();
    const surface = editorSurfaceModel(editor);
    const reloaded = load(saved);

    expect(surface).toEqual(viewerModel(saved).blocks);
    expect(reloaded.getValue()).toBe(saved);
    expect(editorSurfaceModel(reloaded)).toEqual(surface);
}

/**
 * Gives a collapsed caret the format of the text it is in, as a browser's selection change does.
 *
 * @param editor - The editor.
 */
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
```

### TE — the shapes

One entry of `SHAPES` per row. *Typed* is `getValue()` after `x` is typed over the range; *Deleted* is `getValue()` after Delete. Each row runs with the range dragged forward and backward, both commands dispatched inside one update, and also checks that the typed result reads as the editor shows it and that one undo restores the source.

| # | Shape | Document | Start → end | Typed | Deleted | Today |
|---|---|---|---|---|---|---|
| TE1 | raw → rich word | `RAW_THEN_RICH` | `"raw text"`@2 → `"efgh "`@3 | `'<div>\nraxh **ij** kl [a](u) \\*x\\*\n\nafter'` | `'<div>\nrah **ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| TE2 | raw start → bold start | `RAW_THEN_RICH` | `"<div>"`@0 → `"ij"`@0 | `'**xij** kl [a](u) \\*x\\*\n\nafter'` | `'**ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| TE3 | raw start → rich word | `RAW_THEN_RICH` | `"<div>"`@0 → `"efgh "`@3 | `'xh **ij** kl [a](u) \\*x\\*\n\nafter'` | `'h **ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| TE4 | raw end → rich word | `RAW_THEN_RICH` | `"</div>"`@6 → `"efgh "`@3 | `'<div>\nraw text\n</div>xh **ij** kl [a](u) \\*x\\*\n\nafter'` | `'<div>\nraw text\n</div>h **ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| TE5 | raw → rich block's end | `RAW_THEN_RICH` | `"raw text"`@2 → `" *x*"`@4 | `'<div>\nrax\n\nafter'` | `'<div>\nra\n\nafter'` | green |
| TE6 | raw → rich block's start | `RAW_THEN_RICH` | `"raw text"`@2 → `"efgh "`@0 | `'<div>\nraxefgh **ij** kl [a](u) \\*x\\*\n\nafter'` | `'<div>\nraefgh **ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| TE7 | raw tag → later word (re-read) | `` `${RAW}\n\nafter` `` | `"<div>"`@1 → `"after"`@1 | `'\\<xfter'` | `'\\<fter'` | green |
| TE8 | raw tag → later block's end (re-read) | `` `${RAW}\n\nafter` `` | `"<div>"`@1 → `"after"`@5 | `'\\<x'` | `'<'` | green |
| TE9 | raw → raw | `TWO_RAW` | `"raw one"`@2 → `"raw two"`@2 | `'<div>\nraxw two\n</section>\n\nafter'` | `'<div>\nraw two\n</section>\n\nafter'` | green |
| TE10 | raw tag → raw tag | `TWO_RAW` | `"<div>"`@1 → `"<section>"`@3 | `'<xction>\nraw two\n</section>\n\nafter'` | `'<ction>\nraw two\n</section>\n\nafter'` | green |
| TE11 | rich word → raw | `` `${RICH}\n\n${RAW}\n\nafter` `` | `"efgh "`@3 → `"raw text"`@2 | `'efgxw text\\\n\\</div>\n\nafter'` | `'efgw text\\\n\\</div>\n\nafter'` | green |
| TE12 | rich start → raw | `` `${RICH}\n\n${RAW}\n\nafter` `` | `"efgh "`@0 → `"raw text"`@2 | `'xw text\\\n\\</div>\n\nafter'` | `'w text\\\n\\</div>\n\nafter'` | green |
| TE13 | bold → raw end | `` `${RICH}\n\n${RAW}\n\nafter` `` | `"ij"`@1 → `"</div>"`@6 | `'efgh **ix**\n\nafter'` | `'efgh **i**\n\nafter'` | green |
| TE14 | rich word → raw start | `` `${RICH}\n\n${RAW}\n\nafter` `` | `"efgh "`@3 → `"<div>"`@0 | `'efgx\\<div>\\\nraw text\\\n\\</div>\n\nafter'` | `'efg\\<div>\\\nraw text\\\n\\</div>\n\nafter'` | green |
| TE15 | code → rich word | `` `${CODE}\n\n${RICH}\n\nafter` `` | `CODE_TEXT`@2 → `"efgh "`@3 | `` '```\ncoxh **ij** kl [a](u) \\*x\\*\n```\n\nafter' `` | `` '```\ncoh **ij** kl [a](u) \\*x\\*\n```\n\nafter' `` | red |
| TE16 | code start → bold start | `` `${CODE}\n\n${RICH}\n\nafter` `` | `CODE_TEXT`@0 → `"ij"`@0 | `` '```\nx**ij** kl [a](u) \\*x\\*\n```\n\nafter' `` | `` '```\n**ij** kl [a](u) \\*x\\*\n```\n\nafter' `` | red |
| TE17 | rich word → code | `` `${RICH}\n\n${CODE}\n\nafter` `` | `"efgh "`@3 → `CODE_TEXT`@11 | `'efgxne2\n\nafter'` | `'efgne2\n\nafter'` | green |
| TE18 | raw → code | `` `${RAW}\n\n${CODE}\n\nafter` `` | `"raw text"`@2 → `CODE_TEXT`@11 | `'<div>\nraxne2\n\nafter'` | `'<div>\nrane2\n\nafter'` | green |
| TE19 | code → raw | `` `${CODE}\n\n${RAW}\n\nafter` `` | `CODE_TEXT`@2 → `"raw text"`@2 | `` '```\ncoxw text\n</div>\n```\n\nafter' `` | `` '```\ncow text\n</div>\n```\n\nafter' `` | green |
| TE20 | raw → list item text | `` `${RAW}\n\n- one **b**\n- two \\*x\\* [a](u)\n\nafter` `` | `"raw text"`@2 → `"two *x* "`@2 | `'<div>\nraxo \\*x\\* [a](u)\n\nafter'` | `'<div>\nrao \\*x\\* [a](u)\n\nafter'` | red |
| TE21 | list item text → raw | `` `- one **b**\n- two \\*x\\*\n\n${RAW}\n\nafter` `` | `"two *x*"`@2 → `"raw text"`@2 | `'- one **b**\n- twxw text\\\n  \\</div>\n\nafter'` | `'- one **b**\n- tww text\\\n  \\</div>\n\nafter'` | green |
| TE22 | raw → quote | `` `${RAW}\n\n> quote **b** \\*x\\*\n\nafter` `` | `"raw text"`@2 → `"quote "`@3 | `'<div>\nraxte **b** \\*x\\*\n\nafter'` | `'<div>\nrate **b** \\*x\\*\n\nafter'` | red |
| TE23 | quote → raw | `` `> quote **b**\n\n${RAW}\n\nafter` `` | `"quote "`@3 → `"raw text"`@2 | `'> quoxw text\\\n> \\</div>\n\nafter'` | `'> quow text\\\n> \\</div>\n\nafter'` | green |
| TE24 | raw → level 3 heading | `` `${RAW}\n\n### head **b** \\*x\\*\n\nafter` `` | `"raw text"`@2 → `"head "`@2 | `'<div>\nraxad **b** \\*x\\*\n\nafter'` | `'<div>\nraad **b** \\*x\\*\n\nafter'` | red |
| TE25 | level 3 heading → raw | `` `### head **b**\n\n${RAW}\n\nafter` `` | `"head "`@2 → `"raw text"`@2 | `'### hexw text \\</div>\n\nafter'` | `'### hew text \\</div>\n\nafter'` | green |
| TE26 | raw → a column's word | `` `${RAW}\n\n::: columns\ncol **b** \\*x\\*\n\|\|\|\nB\n:::\n\nafter` `` | `"raw text"`@2 → `"col "`@2 | `'<div>\nraxl **b** \\*x\\*\n\n::: {}\nB\n:::\n\nafter'` | `'<div>\nral **b** \\*x\\*\n\n::: {}\nB\n:::\n\nafter'` | red |
| TE27 | raw in a column → the next column | `` `::: columns\n${RAW}\n\|\|\|\ncol **b** \\*x\\*\n:::\n\nafter` `` | `"raw text"`@2 → `"col "`@2 | `'::: {}\n<div>\nraxl **b** \\*x\\*\n:::\n\nafter'` | `'::: {}\n<div>\nral **b** \\*x\\*\n:::\n\nafter'` | red |
| TE28 | raw → rich, both in one column | `` `::: columns\n${RAW}\n\ncol **b** \\*x\\*\n\|\|\|\nB\n:::\n\nafter` `` | `"raw text"`@2 → `"col "`@2 | `'::: columns\n<div>\nraxl **b** \\*x\\*\n\|\|\|\nB\n:::\n\nafter'` | `'::: columns\n<div>\nral **b** \\*x\\*\n\|\|\|\nB\n:::\n\nafter'` | red |
| TE29 | a column's word → raw after the fence | `` `::: columns\nA\n\|\|\|\ncol **b**\n:::\n\n${RAW}\n\nafter` `` | `"col "`@2 → `"raw text"`@2 | `'::: columns\nA\n\|\|\|\ncox\n:::\n\nw text\n\n</div>\n\nafter'` | `'::: columns\nA\n\|\|\|\nco\n:::\n\nw text\n\n</div>\n\nafter'` | green |
| TE30 | raw → table cell | `` `${RAW}\n\n${TABLE}\n\nafter` `` | `"raw text"`@2 → `"c1"`@1 | `'<div>\nrax\n\nafter'` | `'<div>\nra\n\nafter'` | green |
| TE31 | table cell → raw | `` `${TABLE}\n\n${RAW}\n\nafter` `` | `"c1"`@1 → `"raw text"`@2 | `'xw text\n\n</div>\n\nafter'` | `'w text\n\n</div>\n\nafter'` | green |
| TE32 | raw tag → table cell (re-read) | `` `${RAW}\n\n${TABLE}\n\nafter` `` | `"<div>"`@2 → `"c1"`@1 | `'\\<dx\n\nafter'` | `'\\<d\n\nafter'` | green |
| TE33 | raw → a paragraph of a list item | `` `${RAW}\n\n- one\n\n  para **b** \\*x\\*\n- z\n\nafter` `` | `"raw text"`@2 → `"para "`@2 | `'<div>\nraxra **b** \\*x\\*\n\n- z\n\nafter'` | `'<div>\nrara **b** \\*x\\*\n\n- z\n\nafter'` | red |
| TE34 | raw of a list item → the next item's text | `'- one\n\n  <div>\n  raw text\n  </div>\n- two **b** \\*x\\*\n\nafter'` | `"raw text"`@2 → `"two "`@2 | `'- one\n\n  <div>\n  raxo **b** \\*x\\*\n\nafter'` | `'- one\n\n  <div>\n  rao **b** \\*x\\*\n\nafter'` | red |
| TE35 | list item text → a raw block of that item | `'- one **b**\n\n  <div>\n  raw text\n  </div>\n- z\n\nafter'` | `"one "`@2 → `"raw text"`@2 | `'- onxw text\\\n  \\</div>\n\n- z\n\nafter'` | `'- onw text\\\n  \\</div>\n\n- z\n\nafter'` | green |
| TE36 | list item text's start → raw end | `` `- ab\n- cd\n\n${RAW}\n\nafter` `` | `"cd"`@0 → `"</div>"`@6 | `'- ab\n- x\n\nafter'` | `'- ab\n-\n\nafter'` | green |
| TE37 | raw → a nested item's text | `` `${RAW}\n\n- one\n  - two \\*x\\* **b**\n- z\n\nafter` `` | `"raw text"`@2 → `"two *x* "`@2 | `'<div>\nraxo \\*x\\* **b**\n\n- z\n\nafter'` | `'<div>\nrao \\*x\\* **b**\n\n- z\n\nafter'` | red |
| TE38 | raw → the text of an item that holds blocks | `` `${RAW}\n\n- two \\*x\\*\n\n  pq\n  - nn\n- z\n\nafter` `` | `"raw text"`@2 → `"two *x*"`@2 | `'<div>\nraxo \\*x\\*\n\npq\n\n- - nn\n\n- z\n\nafter'` | `'<div>\nrao \\*x\\*\n\npq\n\n- - nn\n\n- z\n\nafter'` | red |
| TE39 | code of a list item → a paragraph of that item | `` `- one\n\n  ${FENCE}\n  code\n  ${FENCE}\n\n  para \\*x\\*\n- z\n\nafter` `` | `"code"`@2 → `"para *x*"`@2 | `` '- one\n\n  ```\n  coxra \\*x\\*\n  ```\n\n- z\n\nafter' `` | `` '- one\n\n  ```\n  cora \\*x\\*\n  ```\n\n- z\n\nafter' `` | red |
| TE40 | list item text → raw start | `` `- ab\n- cd\n\n${RAW}\n\nafter` `` | `"cd"`@1 → `"<div>"`@0 | `'- ab\n- cx\\<div>\\\n  raw text\\\n  \\</div>\n\nafter'` | `'- ab\n- c\\<div>\\\n  raw text\\\n  \\</div>\n\nafter'` | green |
| TE41 | the start of the document's first block → raw end | `` `# ab\n\n${RAW}\n\nafter` `` | `"ab"`@0 → `"</div>"`@6 | `'# x\n\nafter'` | `'#\n\nafter'` | green |

In the table, `\|` stands for a `|` character; the source strings hold `|||`. TE1 to TE32 are the shapes of the plan's first version. TE33 to TE41 are new. A list item is a node of the editor's own since `markdown-editor-list-item-node`, with its text and its blocks as children (TE33 to TE40). TE41 is a range Lexical's own Backspace does one thing more for.

Two of Delete's results may look odd and are today's: a selection from a raw block into a `:::` column's word joins the rest of that paragraph and leaves the fence with one column, saved as `::: {}` (TE26, TE27); and a selection from a raw block into the text of a list's first item sends that item's blocks out as the item's join rule does (TE38).

### The routes over four shapes

One `it.each` row per route and shape: the route gives the pinned `getValue()` in all four variants (the range dragged forward and backward; the command dispatched outside an update and inside one), the save reads as the editor shows it, and one undo restores the source. A method of the editor starts its own update, so it runs once per direction. For `insertImage` and `insertTable` the row asserts that the document and the range are as loaded.

| Route | How `run` drives it | What goes in at the caret |
|---|---|---|
| Delete, Backspace | `DELETE_CHARACTER_COMMAND` `false` / `true` | nothing |
| word delete | `DELETE_WORD_COMMAND` `false` | nothing |
| the source half of a drag, `deleteByCut`, `deleteByComposition` | `REMOVE_TEXT_COMMAND` `null` | nothing |
| cut | `editor.cut()`; `CUT_COMMAND` `null`, then a wait for the copy | nothing |
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

**TE1**

| Route | `getValue()` | Today |
|---|---|---|
| Delete | `'<div>\nrah **ij** kl [a](u) \\*x\\*\n\nafter'` | green |
| Backspace | `'<div>\nrah **ij** kl [a](u) \\*x\\*\n\nafter'` | green |
| word delete | `'<div>\nrah **ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| `REMOVE_TEXT_COMMAND` | `'<div>\nrah **ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| `cut()` | `'<div>\nrah **ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| `CUT_COMMAND` | `'<div>\nrah **ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| Enter | `'<div>\nra\nh **ij** kl [a](u) \\*x\\*\n\nafter'` | green |
| `INSERT_PARAGRAPH_COMMAND` | `'<div>\nra\n\nh **ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| Shift+Enter | `'<div>\nra\nh **ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| Tab | `'<div>\nra\th **ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| `PASTE_COMMAND` | `'<div>\nrazch **ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| `paste()` | `'<div>\nrazch **ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| paste nodes | `'<div>\nrazph **ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| paste blocks | `'<div>\nrap1 zb\n\np2h **ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| drop insert | `'<div>\nrazdh **ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| IME start | `'<div>\nra\u200bh **ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| `insertImage` | the source | green |
| `insertTable` | the source | green |

**TE2**

| Route | `getValue()` | Today |
|---|---|---|
| Delete | `'**ij** kl [a](u) \\*x\\*\n\nafter'` | green |
| Backspace | `'**ij** kl [a](u) \\*x\\*\n\nafter'` | green |
| word delete | `'**ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| `REMOVE_TEXT_COMMAND` | `'**ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| `cut()` | `'**ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| `CUT_COMMAND` | `'**ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| Enter | `'**ij** kl [a](u) \\*x\\*\n\nafter'` | green |
| `INSERT_PARAGRAPH_COMMAND` | `'**ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| Shift+Enter | `'\\\n**ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| Tab | `'**ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| `PASTE_COMMAND` | `'**zcij** kl [a](u) \\*x\\*\n\nafter'` | red |
| `paste()` | `'zc**ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| paste nodes | `'**zpij** kl [a](u) \\*x\\*\n\nafter'` | red |
| paste blocks | `'p1 **zb**\n\np2**ij** kl [a](u) \\*x\\*\n\nafter'` | red |
| drop insert | `'**zdij** kl [a](u) \\*x\\*\n\nafter'` | red |
| IME start | `'**\u200bij** kl [a](u) \\*x\\*\n\nafter'` | red |
| `insertImage` | the source | green |
| `insertTable` | the source | green |

**TE7**

| Route | `getValue()` | Today |
|---|---|---|
| Delete | `'\\<fter'` | green |
| Backspace | `'\\<fter'` | green |
| word delete | `'\\<fter'` | green |
| `REMOVE_TEXT_COMMAND` | `'\\<fter'` | green |
| `cut()` | `'\\<fter'` | green |
| `CUT_COMMAND` | `'\\<fter'` | green |
| Enter | `'<\n\nfter'` | red |
| `INSERT_PARAGRAPH_COMMAND` | `'<\n\nfter'` | green |
| Shift+Enter | `'<\\\nfter'` | red |
| Tab | `'<\tfter'` | green |
| `PASTE_COMMAND` | `'\\<zcfter'` | green |
| `paste()` | `'\\<zcfter'` | green |
| paste nodes | `'<**zp**fter'` | red |
| paste blocks | `'\\<p1 **zb**\n\np2fter'` | red |
| drop insert | `'\\<zdfter'` | green |
| IME start | `'<\u200bfter'` | green |
| `insertImage` | the source | green |
| `insertTable` | the source | green |

**TE11**

| Route | `getValue()` | Today |
|---|---|---|
| Delete | `'efgw text\\\n\\</div>\n\nafter'` | green |
| Backspace | `'efgw text\\\n\\</div>\n\nafter'` | green |
| word delete | `'efgw text\\\n\\</div>\n\nafter'` | green |
| `REMOVE_TEXT_COMMAND` | `'efgw text\\\n\\</div>\n\nafter'` | green |
| `cut()` | `'efgw text\\\n\\</div>\n\nafter'` | green |
| `CUT_COMMAND` | `'efgw text\\\n\\</div>\n\nafter'` | green |
| Enter | `'efg\n\nw text\\\n\\</div>\n\nafter'` | green |
| `INSERT_PARAGRAPH_COMMAND` | `'efg\n\nw text\\\n\\</div>\n\nafter'` | green |
| Shift+Enter | `'efg\\\nw text\\\n\\</div>\n\nafter'` | green |
| Tab | `'efg\tw text\\\n\\</div>\n\nafter'` | green |
| `PASTE_COMMAND` | `'efgzcw text\\\n\\</div>\n\nafter'` | green |
| `paste()` | `'efgzcw text\\\n\\</div>\n\nafter'` | green |
| paste nodes | `'efg**zp**w text\\\n\\</div>\n\nafter'` | green |
| paste blocks | `'efgp1 **zb**\n\np2w text\\\n\\</div>\n\nafter'` | green |
| drop insert | `'efgzdw text\\\n\\</div>\n\nafter'` | green |
| IME start | `'efg\u200bw text\\\n\\</div>\n\nafter'` | green |
| `insertImage` | the source | green |
| `insertTable` | the source | green |

TE11 is the control column: the direction from rich text into a text-only block loses no meaning today, and stays as it is. In TE2, `paste()` gives plain `zc` where the plain-text `PASTE_COMMAND` gives bold: `paste()` inserts through `insertRawText`, which does not read the selection's format, at any caret.

### TS — rows with their own assertion

Rows TS1 to TS4 and TS13 run Shift+Enter in all four variants and assert that `getValue()` is the source and that `rangeOf(editor)` is the range that was set.

| # | Shape | Why it is declined | Today |
|---|---|---|---|
| TS1 | TE13 | nothing follows the caret in its paragraph | red (the selection is removed) |
| TS2 | TE25 | a level 3 heading is one line | green |
| TS3 | TE29 | nothing joins across the fence | green |
| TS4 | TE36 | nothing follows the caret in the item's text | red (the selection is removed) |
| TS13 | TE41 | nothing follows the caret in the heading | red (the selection is removed) |

Rows TS5 to TS12 run their route in all four variants and assert `getValue()` and that the selection is collapsed.

| # | Shape | Route | `getValue()` | Why the row is apart | Today |
|---|---|---|---|---|---|
| TS5 | TE25 | paste blocks | `'### hep1 **zb**\n\np2w text\\\n\\</div>\n\nafter'` | a rule that runs when an update ends: after Delete alone the heading's break becomes a space | green |
| TS6 | TE8 | Shift+Enter | `'<'` | the documented limit: the selection is gone and no break was added | red (declined today) |
| TS7 | TE32 | Shift+Enter | `'\\<d\n\nafter'` | the same limit, for a table-edge range | green |
| TS8 | TE31 | Tab | `'w text\n\n</div>\n\nafter'` | the tab goes into a paragraph, where a save trims it | red (a code block inside an update) |
| TS9 | TE31 | paste nodes | `'**zp**w text\n\n</div>\n\nafter'` | a table-edge range ending in a raw block | red |
| TS10 | TE31 | Shift+Enter | `'\\\nw text\n\n</div>\n\nafter'` | the same | red (inside an update) |
| TS11 | TE36 | `INSERT_PARAGRAPH_COMMAND` | `'- ab\n\nafter'` | the emptied item leaves the list | red |
| TS12 | TE5 | paste nodes | `'<div>\nrazp\n\nafter'` | pasted as text whichever way the range was dragged | red (backward) |

### TC — the contract itself

One `it.each` over seven shapes and seven routes, 49 rows. Each row runs the route over the range in one editor, and in a second editor runs Delete, commits with `getValue()`, gives the caret the format of the text it is in (`syncCaretFormat`) and runs the route there. Both are dispatched inside one update, with the range dragged forward. The two editors must give the same `getValue()`, the same root text content and the same `rootChildren`.

Shapes: TE15, TE20, TE33, TE34, TE37, TE38, TE39. Routes: word delete, `cut()`, Enter, `INSERT_PARAGRAPH_COMMAND`, `PASTE_COMMAND`, paste nodes, paste blocks. For word delete and `cut()` the second editor runs Delete alone.

All 49 are red today except Enter over TE20, TE33, TE34, TE37 and TE38, which `$handleRawBlockEnter` already gets right.

### TG — unchanged behaviour

These pass before and after, except TG8.

| # | Document | Selection | Route | `getValue()` | Today |
|---|---|---|---|---|---|
| TG1 | `` `${RAW}\n\nafter` `` | `"<div>"`@1 → `"<div>"`@4 | type `x` | `'<x>\nraw text\n</div>\n\nafter'` (still one raw block) | green |
| TG2 | same | same | `PASTE_COMMAND`, `zc` | `'<zc>\nraw text\n</div>\n\nafter'` | green |
| TG3 | same | same | Delete | `'<>\nraw text\n\n</div>\n\nafter'` | green |
| TG4 | same | same | Enter | `'<\n\n>\n\nraw text\n\n</div>\n\nafter'` | green |
| TG5 | `RAW_THEN_RICH` | TE1's, each direction | `$insertGeneratedNodes(lexical, [], selection)` (a paste that brings no node) | the source; the range is left as it is | green |
| TG6 | `` `${RAW}\n\n${RICH}` `` | a caret at `"efgh "`@0 | Backspace | `'<div>\nraw text\n</div>efgh **ij** kl [a](u) \\*x\\*'` | green |
| TG7 | same | a caret at `"</div>"`@6 | Delete | the same string as TG6 | green |
| TG8 | `RAW_THEN_RICH` | TE2's | `CUT_COMMAND` | TE2's *Deleted*, and `copyToClipboard` called once | red |
| TG9 | TE41's | TE41's, dragged forward | Backspace (`DELETE_CHARACTER_COMMAND` `true`) | `'after'`, and `rootChildren` is `['paragraph:', 'paragraph:after']` | green |
| TG10 | TE41's | the same | Delete (`DELETE_CHARACTER_COMMAND` `false`) | `'#\n\nafter'`, and `rootChildren` is `['heading:', 'paragraph:after']` | green |

TG6 and TG7 are the two collapsed-caret joins `$joinIntoTextOnlyBlock` keeps. TG9 and TG10 pin that the delete commands leave a plainly removed range to Lexical: without `$isPlainlyRemovedRange`, TG9 gives `'#\n\nafter'`.

### The test bodies

The data arrays are the tables above. The code was run as printed.

```typescript
it.each(SHAPES)('$id: $name, typed over and deleted', async (shape) => {
    for (const backward of [false, true]) {
        const typed = select(shape, backward);

        await run(typed, 'type', true);

        expect(typed.getValue(), `typed, backward ${backward}`).toBe(shape.typed);
        expectParity(typed);
        lexicalOf(typed).dispatchCommand(UNDO_COMMAND, undefined);
        expect(typed.getValue(), `undo, backward ${backward}`).toBe(shape.source);

        const deleted = select(shape, backward);

        await run(deleted, 'Delete', true);

        expect(deleted.getValue(), `deleted, backward ${backward}`).toBe(shape.deleted);
    }
});

it.each<[string, Route, string]>([
    // one entry per row of the four route tables: ['TE1', 'Delete', '<div>\nrah **ij** kl [a](u) \\*x\\*\n\nafter'], …
])('%s, %s', async (id, route, expected) => {
    const shape = shapeOfId(id);
    const declines = route === 'insertImage' || route === 'insertTable';

    for (const [backward, inUpdate] of VARIANTS) {
        const isRepeat = METHOD_ROUTES.includes(route) && inUpdate;

        if (isRepeat) {
            continue;
        }

        const editor = select(shape, backward);
        const range = rangeOf(editor);
        const context = `backward ${backward}, in an update ${inUpdate}`;

        vi.mocked(copyToClipboard).mockClear();
        await run(editor, route, inUpdate);

        expect(editor.getValue(), context).toBe(expected);

        if (declines) {
            expect(rangeOf(editor), context).toBe(range);

            continue;
        }

        expectParity(editor);
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
        expect(editor.getValue(), `undo, ${context}`).toBe(shape.source);
    }
});

it.each<[string, string]>([
    ['TS1', 'TE13'], ['TS2', 'TE25'], ['TS3', 'TE29'], ['TS4', 'TE36'], ['TS13', 'TE41'],
])('%s: Shift+Enter over %s is declined, and nothing changes', async (_name, id) => {
    const shape = shapeOfId(id);

    for (const [backward, inUpdate] of VARIANTS) {
        const editor = select(shape, backward);
        const range = rangeOf(editor);

        await run(editor, 'Shift+Enter', inUpdate);

        expect(editor.getValue()).toBe(shape.source);
        expect(rangeOf(editor)).toBe(range);
    }
});

it.each<[string, string, Route, string]>([
    ['TS5', 'TE25', 'paste blocks', '### hep1 **zb**\n\np2w text\\\n\\</div>\n\nafter'],
    ['TS6', 'TE8', 'Shift+Enter', '<'],
    ['TS7', 'TE32', 'Shift+Enter', '\\<d\n\nafter'],
    ['TS8', 'TE31', 'Tab', 'w text\n\n</div>\n\nafter'],
    ['TS9', 'TE31', 'paste nodes', '**zp**w text\n\n</div>\n\nafter'],
    ['TS10', 'TE31', 'Shift+Enter', '\\\nw text\n\n</div>\n\nafter'],
    ['TS11', 'TE36', 'INSERT_PARAGRAPH_COMMAND', '- ab\n\nafter'],
    ['TS12', 'TE5', 'paste nodes', '<div>\nrazp\n\nafter'],
])('%s: %s, %s', async (_name, id, route, expected) => {
    const shape = shapeOfId(id);

    for (const [backward, inUpdate] of VARIANTS) {
        const editor = select(shape, backward);

        await run(editor, route, inUpdate);

        expect(editor.getValue(), `backward ${backward}, in an update ${inUpdate}`).toBe(expected);
        expect(lexicalOf(editor).read(() => $getSelection()!.isCollapsed())).toBe(true);
    }
});

const CONTRACT_SHAPES = ['TE15', 'TE20', 'TE33', 'TE34', 'TE37', 'TE38', 'TE39'];
const CONTRACT_ROUTES: readonly Route[] = ['word delete', 'cut()', 'Enter', 'INSERT_PARAGRAPH_COMMAND', 'PASTE_COMMAND', 'paste nodes', 'paste blocks'];

it.each(CONTRACT_SHAPES.flatMap((id) => CONTRACT_ROUTES.map((route) => [id, route] as const)))(
    'TC: %s, %s gives what Delete and then the route gives', async (id, route) => {
        const shape = shapeOfId(id);
        const direct = select(shape, false);

        await run(direct, route, true);

        const stepped = select(shape, false);

        await run(stepped, 'Delete', true);
        stepped.getValue();
        syncCaretFormat(stepped);

        const insertsNothing = route === 'word delete' || route === 'cut()';

        if (!insertsNothing) {
            await run(stepped, route, true);
        }

        expect(direct.getValue()).toBe(stepped.getValue());
        expect(lexicalOf(direct).read(() => $getRoot().getTextContent())).toBe(lexicalOf(stepped).read(() => $getRoot().getTextContent()));
        expect(rootChildren(direct)).toEqual(rootChildren(stepped));
    });

it.each<[string, Route, string]>([
    ['TG1', 'type', '<x>\nraw text\n</div>\n\nafter'],
    ['TG2', 'PASTE_COMMAND', '<zc>\nraw text\n</div>\n\nafter'],
    ['TG3', 'Delete', '<>\nraw text\n\n</div>\n\nafter'],
    ['TG4', 'Enter', '<\n\n>\n\nraw text\n\n</div>\n\nafter'],
])('%s: a selection inside one raw block is edited in place (%s)', async (_name, route, expected) => {
    const editor = load('<div>\nraw text\n</div>\n\nafter');

    selectText(editor, ['<div>', 1], ['<div>', 4]);
    await run(editor, route, true);

    expect(editor.getValue()).toBe(expected);
});

it('TG5: a paste that brings no node leaves the range as it is', () => {
    for (const backward of [false, true]) {
        const editor = select(shapeOfId('TE1'), backward);
        const lexical = lexicalOf(editor);
        const range = rangeOf(editor);

        lexical.update(() => { $insertGeneratedNodes(lexical, [], $getSelection()!); }, { discrete: true });

        expect(editor.getValue()).toBe(RAW_THEN_RICH);
        expect(rangeOf(editor)).toBe(range);
    }
});

it.each<[string, TextPoint, boolean]>([
    ['TG6: Backspace at the start of a paragraph after a raw block', ['efgh ', 0], true],
    ['TG7: Delete at the end of a raw block before a paragraph', ['</div>', 6], false],
])('%s joins the paragraph as its Markdown', (_name, point, backward) => {
    const editor = load('<div>\nraw text\n</div>\n\nefgh **ij** kl [a](u) \\*x\\*');

    selectText(editor, point, point);
    lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, backward);

    expect(editor.getValue()).toBe('<div>\nraw text\n</div>efgh **ij** kl [a](u) \\*x\\*');
});

it.each<[string, boolean, string, string[]]>([
    ['TG9: Backspace', true, 'after', ['paragraph:', 'paragraph:after']],
    ['TG10: Delete', false, '#\n\nafter', ['heading:', 'paragraph:after']],
])('%s over a range from the start of the document\'s first block to a raw block\'s end is left to Lexical', (_name, backward, expected, children) => {
    const editor = select(shapeOfId('TE41'), false);

    lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, backward);

    expect(editor.getValue()).toBe(expected);
    expect(rootChildren(editor)).toEqual(children);
});

it('TG8: a native cut (CUT_COMMAND) of a range from a raw block\'s start copies once, then removes it as Delete does', async () => {
    const shape = shapeOfId('TE2');
    const editor = select(shape, false);

    vi.mocked(copyToClipboard).mockClear();
    await run(editor, 'CUT_COMMAND', false);

    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    expect(editor.getValue()).toBe(shape.deleted);
});
```

### `CUT_COMMAND` before the change

A range that is text-only-edge and not stale-focus (TE2, TE5, TE6, TE8, TE13, TE14, TE16, TE36, TE40, TE41) is not guarded before the change. `CUT_COMMAND` then reaches `@lexical/rich-text`'s own cut, whose copy needs a `window`, and vitest reports an unhandled rejection while the row fails. After the change `$cutGuardedRange` takes every such range and the run is clean.

### The restated row

In `markdown-editor-table-cells-paste.test.ts`, row X14 ([:1149](../packages/lib/tests/component/markdown-editor-table-cells-paste.test.ts#L1149)):

| | Today | After |
|---|---|---|
| title | `X14: a range selected backwards from the start of a code block stays the code block handler's, which pastes text` | `X14: a range selected backwards from the start of a code block into an item's text is removed first as well` |
| `getValue()` | `'- abh1\\\n  \\\n  h2\\\n  \\\n  c1\\\n  \\\n  c2kode'` | `'- ab\n\n' + T + '\n\n- kode'` |
| `rootChildTypes(editor)` | `['list']` | `['list', 'table', 'list']` |

Replace the comment in the row with: "The range guard removes the range first, whichever way it was dragged, so the caret stands in the item's text and the table is pasted as for a forward range." The row's `expectSoundDocument(editor)` stays.

### Manual (browser) checks

Run `npm run dev` at the repo root and open **MD Editor**. Replace the content with TE1's document (an HTML block, a blank line, `efgh **ij** kl [a](u) \*x\*`, a blank line, `after`). "The TE1 selection" is a drag from between `ra` and `w` in the raw block to between `efg` and `h`.

| # | Steps | Expected |
|---|---|---|
| M1 | Make the TE1 selection, type `x`. Switch to source mode | the raw block ends `raxh **ij** kl [a](u) \*x\*`: the backslashes are there |
| M2 | Undo once after M1 | the document and the selection are back as before M1 |
| M3 | Repeat with Tab, Shift+Enter, Ctrl/Cmd+X (then Ctrl/Cmd+V elsewhere), Ctrl+Backspace (Alt+Backspace on macOS), and Cmd+Backspace on macOS (`DELETE_LINE_COMMAND`, which cannot run offline), undoing between each | the backslashes stay every time; one undo restores each |
| M4 | Make the TE1 selection and start an IME composition (on macOS, hold `e` and pick an accent; otherwise a CJK input method), commit it | the composed text is in the raw block after `ra`; the backslashes stay; no console error |
| M5 | Make the TE1 selection, then drag the highlighted selection onto the end of `after` | the selection is removed as in M1; the dragged content lands at the drop point |
| M6 | Make the TE1 selection dragged backward (from `efg│h` up to `ra│w`), paste a copied bold word | the same result as the forward drag: the word goes in as plain text inside the raw block |
| M7 | Load TE7's document. Drag from after `<` in `<div>` to after `a` in `after`, press Enter | two paragraphs, `<` and `fter` |
| M8 | Same selection as M7, Shift+Enter | one paragraph `<`, a hard break, `fter` |
| M9 | Make TE8's selection (from after `<` to the end of `after`), Shift+Enter | the documented limit: the selection is removed, one paragraph `<`, no break |
| M10 | Load TE31's document. Drag from `c1` into `raw text`, press Tab | a paragraph `w text` and a raw block `</div>`; no code block |
| M11 | In a raw block, select `div` inside `<div>` and type `p` | the block stays one raw block reading `<p>…` |
| M12 | A list item `abcd`, then a code block `kode`. Copy a table elsewhere. Drag backward from the start of `kode` to between `ab` and `cd`, paste | the item `ab`, the table, an item `kode`; the same as for the drag made forward |

---

## Verification

- From `packages/lib`: `npm run typecheck`, `npm run typecheck:test`, `npm run lint`.
- From `packages/lib`: `npx vitest run tests/component/markdown-editor-command-crashes.test.ts tests/component/markdown-editor-table-cells-paste.test.ts`: every row passes, with no unhandled rejection.
- From `packages/lib`: `npm run test` (the full suite), `npm run docs:api`, `npm run docs:llms:check`, `npm run build:lib`.
- The greps of steps 3, 6, 10 and 11.
- The manual checks M1 to M12.
- **The differential check against the parent.** It runs the same scenarios on the commit the branch starts from and on the branch, and every difference must be one this plan names. The harness is outside the repo, in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/raw-block-revision/` (`$S` below). It copies its test files into a worktree, runs them and removes them again; never commit them. Leave `RBP_PROTO` empty: the variable only selects a prototype, and empty runs the code as it is.
  1. On a worktree of the parent commit (with the two `node_modules` symlinks): `RBP_PROTO= $S/proto/runrbr.sh <parent worktree>/packages/lib re-matrix-parent` and `RBP_PROTO= $S/proto/rungrid.sh <parent worktree>/packages/lib scenarios-grid.json re-grid-parent`.
  2. On the branch: the same two commands with `<branch worktree>/packages/lib` and the names `re-matrix-branch` and `re-grid-branch`.
  3. `python3 $S/rbrdiff.py $S/re-matrix-parent.json $S/re-matrix-branch.json` and `python3 $S/griddiff.py $S/re-grid-parent.json $S/re-grid-branch.json`.

  Each must end with `hard checks failed: none`.

  | Harness | Scenarios | Hard checks | Measured with the prototype |
  |---|---|---|---|
  | the route matrix (`rbrdiff.py`) | the 41 shapes and a selection inside one raw block, each in both drag directions, through 19 routes in both dispatch contexts: 3,192 cells | Delete and Backspace give the same save, shape and caret on parent and branch in every cell; a selection inside one raw block gives the same on both; nothing throws; one undo restores every cell; every save reads as the editor shows it wherever its control's does; and every cell of another route equals Delete-then-route, except the declined cells (Shift+Enter over TE13, TE25, TE29, TE36, TE41; `insertImage`; `insertTable`), which leave the document and the range as loaded, and paste blocks over TE25, which is pinned | 1,148 cells change; on the parent 1,148 cells fail the last check and on the branch none |
  | the cross-item grid (`griddiff.py`) | 792 list scenarios (11 kinds of start, 8 kinds of end block in a later list item), each in both directions through 17 routes: 26,928 cells | a cell whose range has no end in a raw block or code block gives the same save, shape and caret on parent and branch; nothing throws; no cell fails a reload, save-again or viewer check the parent passes; one undo restores every cell it restores on the parent; Backspace and Delete give the same save on both | 861 of the 10,404 cells with an end in a text-only block change; the other 16,524 are the same |

  Read the cells each script lists and record them in the *Implementation Notes*.
- **The regression fuzzes, outside the repo.** `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/impl/list-item-node/runfuzz.sh <worktree>/packages/lib <out-dir> table-edge table-edge-strict paste paste-strict`, compared with `cmpfuzz-masked.py <out-dir> <baseline>` from the same folder. The baseline is the same run on the parent commit; before `markdown-editor-raw-block-edge-cases` it is `scratch-keep/impl/paste-undo-merge/fuzz-2/`, which has no failing record in any of the four. No record may be added. The strict variants check parity also where a range ends in a raw block, which is this plan's subject.

---

## Documentation Impact

No public API changes. Two text edits.

**`packages/lib/docs/components/MarkdownEditor.md`**, the paragraph that starts "Markdown the editor has no rich-text form for" (line 82). Replace this text:

> inside one, Enter adds a line (at a raw block's end it starts a new paragraph after it, at its start one before it; pressed over a selection with an end in a raw block, it removes the selection as Delete does and then does what it does at the caret that leaves, whichever way the selection was made), pasted content goes in as plain text (each block an item of a pasted list holds apart from the item's text, as two items are), Backspace at the start of a paragraph after the block (or Delete at the block's end) joins that paragraph to it as its Markdown, and so does the rest of a block a deleted range reaches into from inside it; the typing shortcuts do not apply there, and the format toggles, text styles, links, images and tables decline, since the block saves its text as written.

with:

> inside one, Enter adds a line (at a raw block's end it starts a new paragraph after it, at its start one before it), pasted content goes in as plain text (each block an item of a pasted list holds apart from the item's text, as two items are), and Backspace at the start of a paragraph after the block (or Delete at the block's end) joins that paragraph to it as its Markdown; the typing shortcuts do not apply there, and the format toggles, text styles, links, images and tables decline, since the block saves its text as written. A selection that runs from inside such a block into another block is removed the same way by every edit that replaces it — Delete, Backspace, a word or line delete, a cut, typing, an input method, Enter, Shift+Enter, Tab, a paste and a drag that moves it — whichever way it was made: the rest of the block it ends in joins the raw block or code block as its Markdown (as its text, when that block is a raw block or a code block too), so its formatting, links and escaped characters keep meaning what they showed; a raw block whose text then reads as other blocks shows as those blocks; and what the edit inserts goes in at the caret that leaves, as it would after Delete. A selection that runs into such a block from a block before it is removed first too, and what is left of the raw block or code block joins that earlier block as text. A selection inside one raw block or code block is edited as text: what is typed or pasted replaces it in place, and a raw block is read again afterwards. Shift+Enter over a selection that leaves such a block is judged before anything is removed (see *Line breaks* below); where the removal makes a raw block read as a block in which the break has no place, the selection is removed and no break is added.

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

- **The stack tip moves and sibling plans edit `MarkdownEditor.ts`.** Find every site by its symbol name, not by line number.
- **`$removeJoiningRange` must not narrow its selection away.** `$isStaleFocusRange` is a type guard. Assigned to an untyped `const` and tested, it narrows `selection` to `never` in the `else` branch, and `selection.removeText()` does not compile. Keep the `: boolean` on `isStaleFocus`, as the snippet has it.
- **A row that passes only outside an update.** Outside an update Lexical runs each priority in its own update and applies the node transforms between them, so the old code already re-read a raw block between the CRITICAL guard and the handlers after it. A row that is green outside an update and red inside one means some step still waits for the end of the update. Fix the code, not the row.
- **Do not copy the re-read.** `$removeGuardedRange` must call `$showRawBlockAsSaved`, the function the transform calls. A second copy of that body would let the two drift.
- **Do not add the re-read or the guard to a selection inside one block.** Rows TG1 to TG4 fail if `$isTextOnlyEdgeRange` matches a selection inside one raw block.
- **Pass the editor's own selection.** `$deleteRangeFromTextOnlyBlock` moves the editor's selection (`tailBlock.selectEnd()`), and the re-read places the caret through the node's `select`, which moves the same selection object. Every caller passes `$getSelection()` or the payload's selection, which is that object, and `paste()` goes on to insert through it. Do not pass a clone.
- **Every listener tests `$isGuardedRange`.** The typing, pasted-text and cut listeners test the shapes in a line of their own today. A listener left testing `$isStaleFocusRange` misses the new shape on its route, and the plan that follows would miss its shape there too. The grep of step 10 checks it.
- **The control's caret format.** Offline nothing gives a caret the format of the text it lands in, so the TC rows call `syncCaretFormat` in the second editor. Without it, the typing and plain-text paste cells of the matrix differ at a format edge.
- **Class-name stubs.** `registerRichText`'s paste and cut handlers tell event kinds apart by class name, so the `PASTE_COMMAND`, drop and `CUT_COMMAND` routes call `stubEventClasses()`. The file's `afterEach` already calls `vi.unstubAllGlobals()`.
- **`DELETE_LINE_COMMAND` cannot run offline** (Lexical needs a `window`). M3 covers it.

---

## Critical Files

- [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts): `registerRangeGuards` (L3835) and `$removeGuardedRange` (L2325), the precedent this plan extends; `$isTableEdgeRange` (L1890), the predicate `$isTextOnlyEdgeRange` copies; `$removeGuardedRangeForInsert` (L2134); `$deleteRangeFromTextOnlyBlock` (L2787) and `$joinIntoTextOnlyBlock` (L2739); `$handleRawBlockEnter` (L969) and `$removeRangeBeforeEnter` (L1042); the Shift+Enter decision (`$removalJoinsEndBlockRest` L1773, `$staleFocusRemovalDeclinesLineBreak` L1815, `$guardedRemovalDeclinesLineBreak` L2536, `$clearGuardedRangeBeforeLineBreak` L2558); `$clearGuardedRangeBeforePastedText` (L2581), `$clearGuardedRangeBeforeTyping` (L2608), `$cutGuardedRange` (L2668); `$pasteIntoTextOnlyBlock` (L1070) and `$pastePlainTextIntoRawBlock` (L1648); `$enterLeavesListAtBlankItemText` (L3565); `registerTextOnlyBlockRules` (L3778); `cut()` (L6108), `paste()` (L6150), `insertImage()` (L6498); `buildEditor` (L6963).
- [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts): `registerRawBlockRules` (L903) with `$showRawBlockAsSaved` (L923), `$readListAgainAroundRawBlock` (L964), `$showRawBlockAsItsBlocks` (L994), `$showRawBlocksAsWritten` (L1111), `$lineBreakUnwritableAt` (L1525), `registerRunEdgeRules` (L1876), `$editOrRestore` (L2432).
- [markdownListItemNode.ts](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts): `MarkdownListItemTextNode.remove`, the item's join rule, which the text-only join reaches when the range ends in an item's text. Read, not changed.
- [markdown-editor-command-crashes.test.ts](../packages/lib/tests/component/markdown-editor-command-crashes.test.ts): the helpers (L53 to L192), the rows R1 to R17 (L375) the new rows follow in form, and the `upstream canaries` (L1040) the new `describe` goes before. [markdown-editor-table-cells-paste.test.ts](../packages/lib/tests/component/markdown-editor-table-cells-paste.test.ts): row X14 (L1149).
- [plans/implemented/markdown-editor-command-crash-fixes.md](implemented/markdown-editor-command-crash-fixes.md) and [plans/implemented/markdown-editor-table-delete-merge.md](implemented/markdown-editor-table-delete-merge.md): the two guard plans, and in their *Implementation Notes* the known limits this plan closes.
- [plans/implemented/markdown-editor-list-item-node.md](implemented/markdown-editor-list-item-node.md): *Implementation Notes* → *For the plans that follow* (the shape of a list item; `$removeGuardedRangeForInsert`). [plans/implemented/markdown-editor-table-cells-paste-empty-column.md](implemented/markdown-editor-table-cells-paste-empty-column.md): *Where the handlers sit*, and the note on row X14.
- [plans/markdown-editor-cross-item-range-removal.md](markdown-editor-cross-item-range-removal.md): the plan that follows, and what it needs from this one.
- `node_modules/lexical/src/LexicalUpdates.ts` L915–944 (one update per priority for a command dispatched outside an update); `node_modules/lexical/src/LexicalEvents.ts` L1056–1130 and L1370–1410 (which command each input event and a composition start dispatch); `node_modules/@lexical/rich-text/src/index.ts` L1195 (`CONTROLLED_TEXT_INSERTION_COMMAND`) and L540 (the native cut).

---

## Non-Goals

- **What Delete itself gives.** This plan makes the other routes equal Delete. It does not change Delete's or Backspace's result for any selection (measured: no Delete or Backspace cell of either harness changes; rows TG9 and TG10).
- **Making Shift+Enter's decision foresee the re-read.** See the limit and its footnote.
- **A selection inside one text-only block.** It stays an in-place edit of the block's text.
- **A collapsed caret.** Enter on Android (`INSERT_PARAGRAPH_COMMAND` with no `KEY_ENTER_COMMAND`) inside a raw block, and Shift+Enter at a raw block's end, behave as they do today.
- **A range that takes a list item's text whole and ends in a later block of that item.** `markdown-editor-cross-item-range-removal` owns it, as the fourth guarded shape.
- **What a cut puts on the clipboard.** It is what Lexical copies from the selection as it stands.
- **A tab in a code block of a list item.** It is saved as a tab and loaded as four spaces, before and after this plan (Tab over TE39 fails the viewer check with and without the route's range).
- **Committing the differential harness.** It stays outside the repo.

---

## Revised on 2026-10-11

The plan was first written on 2026-10-06 against `63a81117d`. Four branches landed since (`markdown-editor-list-item-block-paste`, `markdown-editor-list-item-node`, `markdown-editor-table-cells-paste-empty-column`, `markdown-editor-paste-undo-merge`). What changed in this revision, and why:

| Change | Why |
|---|---|
| No defect was dropped | All of them are still in the code at `85b55a8f4`: 1,148 of the matrix's 3,116 guarded cells fail there, and the 32 "typed" strings of the first version are what the prototype gives now, its E20 and E21 (a list item) included. None of the four branches changed how a route removes a range that leaves a text-only block |
| `$showRawBlockAsSaved` is moved out and exported under its own name; there is no `$showRawBlockAsRead` | The transform's body became a four-step function of that name in `markdown-editor-list-item-block-paste`, after the first version was written |
| `$removeJoiningRange` types `isStaleFocus` as `boolean` | The first version's snippet does not compile: the type guard narrows the selection to `never`. It was never type-checked, because the first prototype did not hold that function |
| `$clearGuardedRangeBeforePastedText` keeps its list-container cases and calls `$removeGuardedRangeForInsert` after the new helper; `$clearGuardedRangeBeforeParagraph` is in the listener table | `markdown-editor-list-item-node` added `$removeGuardedRangeForInsert` and the guard for a caret between the blocks of a list item |
| The listener table lists the paste and list-item listeners added since | `registerTablePartPaste`, `registerItemBlockPaste`, `registerItemTextPaste`, `registerListItemRules` |
| Shapes TE33 to TE40 are new | List items hold blocks as children now; a raw block or code block can be a block of an item, and the join into an item's text goes through the text node's `remove` |
| Row X14 of the table-cells paste file is restated, and four results are listed under *Results that change* | X14 was added by `markdown-editor-table-cells-paste-empty-column` and pins the direction-dependent paste this plan ends. The Shift+Enter changes were measured now; the first version named only one of them |
| The rows go into `markdown-editor-command-crashes.test.ts`; `markdown-editor-text-only-edge.test.ts` is not created, and the 2,432-cell matrix is not committed | Project rule: tests are rows in the existing table-driven files. The matrix is the differential check, run on parent and branch |
| `$deleteGuardedRange` leaves a plainly removed range to Lexical (`$isPlainlyRemovedRange`); shape TE41 and rows TG9, TG10 and TS13 are new | The first version put every text-only-edge range through the guard on Delete too. Measured now: Backspace over a selection from the start of a document that opens with a heading, quote or paragraph to the end of a raw block or code block then left the emptied block as it was, where Lexical's Backspace makes it a paragraph. Select-all and Backspace in a document ending in a code block is such a selection |
| The comparison with the control uses the document's shape as well as its save | By the root's text alone, Tab over a raw block that re-reads passed today although it put the tab into a text node |
| `depends-on` is `markdown-editor-raw-block-edge-cases`, and a table gives the symbols `markdown-editor-cross-item-range-removal` needs | The order of the three plans, and that plan's stated dependency on this one |
| The measurements include `cut()` and `paste()` | The first prototype could not reach the two methods; the prototype is now the plan's own code |

---

## Addendum: Measurements

All at `85b55a8f4`. No source file was changed. The prototype is this plan's snippets, as printed, applied in memory by a Vite plugin while the tests load the modules (`proto/plugin.mjs`, `proto/patch-re.txt`). It covers every route, the public `cut()` and `paste()` included. Every number below was measured twice with the same result unless a difference is named: on that commit alone, and on a prototype of `markdown-editor-raw-block-edge-cases` (`proto/patch-ec.txt`). The scratch files are in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/raw-block-revision/`.

**The matrix** (`zz-rbr-probe.test.ts`: the 41 shapes × 2 directions × 19 routes × 2 dispatch contexts = 3,116 cells, and 76 cells for a selection inside one raw block):

| | Parent | Prototype |
|---|---|---|
| cells that fail their assertion (equal to Delete-then-route by save, root text and shape; the declined and pinned cells' own; Delete and Backspace as on the parent) | 1,148 | 0 |
| Delete and Backspace cells whose save, shape or caret differs from the parent's | — | 0 |
| cells one undo does not restore | 0 | 0 |
| throws inside the editor | 0 | 0 |
| cells whose save does not read as the editor shows it | 4 | the same 4 |

The four are Tab over TE39, whose control fails the same way (see *Non-Goals*). With `markdown-editor-raw-block-edge-cases` in, eight Shift+Enter cells (TE5, TE30) and their controls save one blank line fewer, alike.

**The rows** as they are added to the two test files (`proto/patch-ret.txt`): 185 new tests and the restated X14. On the parent 103 fail, exactly the rows marked red (18 TE rows, 30 route rows, 9 TS rows, 44 TC rows, TG8 and X14). With the prototype all 464 tests of the two files pass. With the prototype minus `$isPlainlyRemovedRange`, TG9 alone fails.

**The cross-item grid** (the probe of `markdown-editor-cross-item-range-removal`, 26,928 cells): the numbers under *Verification*. 18 cells fail a check on the parent and with the prototype alike (the tab in a code block of a list item).

**The existing Markdown test files** (21 files, 6,977 tests) with the prototype: one test fails, X14, with the value this plan gives it.

**The plan that follows.** `markdown-editor-cross-item-range-removal`'s snippets were applied on top of both prototypes (`proto/patch-ci.txt`), with one clause more than that plan prints: `&& !$isCrossItemRange(selection)` in the first statement of `$isPlainlyRemovedRange`. Its 58 edit rows pass (49 fail without its snippets), its paste rows give its measured saves, its row CI75, which it could not measure, gives the save it expects, and its own differential script reports no failed hard check on its grid and its hand-written scenarios. Without the clause (`proto/patch-ci0.txt`) the same script fails two hard checks, in 352 Backspace, Delete, word-delete and `REMOVE_TEXT_COMMAND` cells and 88 cut cells of its grid: the delete commands leave a cross-item range that ends at the start of a raw block or code block to Lexical.

**Type check and lint.** The three prototypes and all test edits were also applied to a scratch copy of `packages/lib`: `tsc -p tsconfig.lib.json`, `tsc -p tsconfig.test.json` and `eslint` on the editor folder report nothing.

**The regression fuzzes** (the two strict variants, 11 seeds of 3,000 each, with this plan's prototype on top of `markdown-editor-raw-block-edge-cases`'s): no failing record in the table-edge fuzz (33,000 runs) or in the paste fuzz (31,951 runs), and every seed's other counts (documents run, commands declined, pastes that copied nothing) equal the baseline's in `scratch-keep/impl/paste-undo-merge/fuzz-2/`. The results are in `fuzz-ecre-final/`. The two variants that are not strict were not run with the prototype.

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
    paste handlers read the selection's anchor, so a paste over such a
    range pasted as plain text or as rich text depending on which way it was
    dragged (measured: TE5, TE13, TE14, TE36 and TE40 dragged backward, and
    row X14).

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

[^plain-range]: Lexical's `deleteCharacter` over a range removes it and,
    for Backspace, then looks at the caret: when it stands at the start of
    the document's first block and that block is empty, the block is
    collapsed (a heading or quote becomes a paragraph, an empty paragraph
    before another block goes). A guard that takes the range skips that
    step. For the three removals of a kind of their own that is today's
    behaviour, and nothing changes. For removal 4 it would be new: the guard
    would remove the range exactly as Lexical does and then leave out the
    last step. Measured on `# ab⏎⏎<div>⏎x⏎</div>⏎⏎after`, `"ab"`@0 →
    `"</div>"`@6, Backspace: `after` under an empty paragraph today,
    `#⏎⏎after` with every text-only-edge range guarded on Delete. A document
    that opens with a heading and ends in a code block reaches it by
    select-all and Backspace. The other delete commands (a word, a line,
    `REMOVE_TEXT_COMMAND`) have no such step and give the same either way;
    they share the listener so that there is one rule. The other routes
    must still guard such a range, for what follows the removal: the paste
    handlers read the selection's anchor, and an insert must meet a raw
    block that is already re-read. Copying Lexical's last step into the
    guard was rejected: it is Lexical's rule, and the three older removals
    would then change.

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
    contexts give the same document, and it is Delete-then-route's (no cell
    of the matrix differs, see the addendum). Calling the transform's own
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
    joins. Measured: with this formula no Shift+Enter cell of the matrix
    differs from Delete-then-Shift+Enter except the declined ones, which
    change nothing. The cells whose result changes against today are listed
    under *Results that change besides the routes' own*.

[^lb-limit]: Making the decision exact needs the document the removal
    produces, before anything is removed. Three ways were looked at, and
    none is sound.
    (1) *Remove, check, restore.* Lexical has no rollback inside an update.
    The editor's own "try, check, restore" (`$editOrRestore`,
    markdownWritable.ts L2432) restores the inline content of blocks that
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
    today's correct declines (rows TS2, TS3) into removals.
    What is left is small and one-directional. With the re-read inside the
    removal, the result is always Delete-then-Shift+Enter's document; the
    only miss is that the selection is removed where "nothing changes" was
    the ideal. In the matrix that is TE8 and TE32; every such cell equals
    Delete's document.

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
    block would start pasting plain where it pastes bold today (TE13). The
    same helper serves the plan that follows: its row CI75 (typing over a
    range that starts in bold text of a list item) passes on it.

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
    tag on every route. A tag added twice is one tag.

[^paste-direction]: `$pasteIntoTextOnlyBlock` and
    `$pastePlainTextIntoRawBlock` decide by the block holding the
    selection's anchor. Over a range that was the block the drag started
    in. After the guard it is the block the caret is in, which is the
    contract. `$pasteBlocksIntoItemBlock` and
    `$splitItemBeforePasteEndingInTableOrFence` remove a range themselves
    when they act; after the guard they meet a caret. No change to any
    handler is needed, and row TG5 pins that a paste bringing no node still
    leaves the range alone.

[^undo]: Measured: one `UNDO_COMMAND` restored the source in every cell of
    the matrix, in both dispatch contexts, on the parent and with the
    prototype. The history sits behind the guard of `markdownHistory.ts`
    since `markdown-editor-paste-undo-merge`; nothing in this plan
    dispatches after an update or starts a second one.

[^enter-item]: `$enterLeavesListAtBlankItemText`, a listener of
    `INSERT_PARAGRAPH_COMMAND` at HIGH, removes a range itself and then
    leaves the split to Lexical when the range ran over items of text alone.
    The guard at CRITICAL now removes a text-only-edge range before it, so
    the listener meets a caret on an empty line of the list and applies its
    rule for one: the item leaves the list. That is what the Enter key over
    the same range gives today, because `$handleRawBlockEnter` already
    removes the range before it dispatches the command.
    `markdown-editor-cross-item-range-removal` records the same effect for
    its own shape.

[^rows-in-file]: The first version created a test file of its own holding
    the whole matrix, 2,432 cells that each build three editors. Two things
    are against that now. Tests go into the existing table-driven files as
    rows, and the stale-focus guard's rows, which these extend, are in the
    crash-fixes file. And the full matrix takes minutes, where the 185 rows
    chosen here run in a few seconds: every shape under typing and Delete,
    every route over the four shapes that carry the defects, the cells with
    an assertion of their own, and the contract stated as a test for the
    list and code shapes. The full matrix keeps its use as the differential
    check, where it is run once on each side.

[^after-edge-cases]: Three reasons. The re-read now runs inside the
    removal and reaches `$selectTextOffset`, which that plan stops from
    setting a negative offset. Both plans edit `markdownWritable.ts` next to
    each other. And the order of the three plans has to be one line: the
    plan that follows this one names it as its dependency. The rows do not
    depend on the order: they were measured on this plan's prototype alone
    and on top of that plan's, with the same result.

[^existing-tests]: Measured with the prototype on the 21 Markdown test
    files (6,977 tests): X14 alone fails. If another existing row fails,
    check its selection: only a row whose selection is a text-only-edge
    range may change, and its new value must equal Delete's result with the
    route's insert at the caret.
