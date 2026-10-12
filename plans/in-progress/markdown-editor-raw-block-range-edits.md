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

### The caret after a re-read is placed by source offsets

*Added at implementation, after the fourth review; see D2 of the
Implementation Notes.*

Where the removal makes a raw block show as rich blocks, the caret is put
at the place the joint's offset has in those blocks: after everything
they show whose source ends at or before the offset, before the rest.
Nothing they show changes sides, and a space that shows is content. The
place comes from `$placeOfSourceOffset`
([markdownSourcePlaces.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts)),
which reads the source of what a block shows off the source analysis
([markdownSourceTokens.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceTokens.ts),
`analyzeMarkdownSource`, `SourceEntry.start` and `end`) and matches the
block the load built against it, character for character.

That analysis is the one source mode's commands use. It is used from the
WYSIWYG side as it stands, and nothing was moved: it reads Markdown
through the viewer's lexer and imports nothing of CodeMirror or of
Lexical, so it is shared the way the lexer itself is (`markdownWritable.ts`
calls `lexMarkdownWithDefinitions` directly). The mapping is a module of
its own because it needs both sides: the analysis and the nodes a load
builds. It keeps the analysis's rule that a token whose text is not found
has no place, so the caller declines, here by putting the caret at the
end of its block, and that fallback's shapes are few and named.

The alternative, reading the text a second time with a mark at the
caret, was built first and failed in a new corner in each of three
reviews: a mark is a character, and a character beside a delimiter or a
marker changes what they are.

### A removal the editor makes itself completes no typing shortcut

*Added at implementation, after the fifth review, and narrowed after the
sixth; see D10 of the Implementation Notes.*

Lexical's Markdown shortcuts take any update that leaves a collapsed
caret in changed text for a typed character, so a deletion completed a
shortcut when the text left before the caret read as one. With the
caret at the joint after a removal, that turned escaped text into
formatting. The editor's own removal of a guarded range is therefore
tagged when the route only removes (the delete commands, a cut,
`cut()`), and the wrapper that already keeps the shortcuts out of raw
blocks (`registerMarkdownShortcutsOutsideRawBlocks`,
[MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts))
hands Lexical's listener no tagged update. Nothing else is classified:
typing, a paste, a drop and a deletion in an ordinary paragraph are
handed over as before, and the last keeps the parent's defect. Lexical's
listener offers no hook and is not changed.

The fifth round made it a rule for every block (a shortcut is applied
for typed text only, by marking what is no typing). The sixth review
showed that rule dropped a character committed by an input method or a
dead key on desktop WebKit, and the general rule is a plan of its own,
`markdown-editor-typing-shortcuts-only-for-typing`, that marks what *is*
typing.

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

---

## Implementation Notes

Implemented on `feature/markdown-editor-raw-block-range-edits`, on top of
`feature/markdown-editor-raw-block-edge-cases` at `fef32344b`, which these
notes call "the parent". Scratch files named below are under
`~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/impl/raw-block-range-edits/`
("the scratch folder"). They are not in the repository. The reviser's
files are under `…/scratch-keep/plans3/raw-block-revision/` ("the
reviser's folder"), the edge-cases implementer's under
`…/scratch-keep/impl/raw-block-edge-cases/`.

The branch has four code commits. The first is the plan, with two things
in it that the plan's code cannot stand without: the selection the
caller passed is the editor's again (D1: without it three routes throw),
and an end of a range held as a point on a list, a `:::` block or the
document is moved into the text the range reaches before any route
reads it (D11: without it every route throws on such a range, where at
the parent Delete and Enter did). The second is D8: a raw block left
holding nothing shows as an empty paragraph. The plan does not have it;
the fourth review asked for it, and it is sign-off 9. The third is D10:
a removal the editor makes itself completes no Markdown typing shortcut.
The fifth review asked for it; it changes the editor outside this plan's
ranges, so it is a commit of its own and sign-off 11. The fourth is D2, the
caret's place after a raw block shows as its blocks: it changes where
the caret stands after Delete, which the plan's Non-Goals leave alone,
so it is a commit of its own and the first decision under *Decisions
that await the user's sign-off*. Each code commit has its documentation
commit but the third, which changes nothing a user can see against the
parent and so has none (D5, D10).

**Where the review stands.** The first review found no defect in the
code. It had two blocking findings. The notes described verification that
had not ended: the fuzz table, the browser checks on the final code, M4
and M5 as stand-ins, and a count of passing tests that was not the logged
one. The fuzz has ended, the browser checks were run again on the final
code, the count is the logged one, and M4 and M5 are sign-off 6. And D2's
effect on an ordinary edit had no row: rows `TP1` to `TP6` pin it, and
`TL1` its limit. Its advisory notes were taken up: what the update tag
does was measured (*Found along the way*, sign-off 5, `TE52`); the second
changelog entry names the limit; three JSDoc passages were reworded (a
range "that ends where no text node is cut", and which guards are at
which priority); D1 names the place the file already meets the same
hazard; the rows are counted by commit (D3); and the notes say which
commits they name are not on the branch. One was left for sign-off 7:
whether the changelog should name the Shift+Enter changes.

The second review found one defect, in D2: a mark with no plain text on
either side of it (between a quote's marker and bold text, before a link,
after formatted text) is a run of its own in the second reading, the
reading was then taken as another one, and the caret went to the block's
end, so for a selection that ended before formatted text every inserting
route still put its text there. The mark's own run is now left out of the
comparison and the caret is placed between the two runs it stood between
(D2). The review's own sweep of 957 typed cells had 57 with the text at
the block's end; it has 6 now, each a caret inside the delimiters of the
raw block's own formatting. Rows `TE53` to `TE58`, `TP7` and `TS16`. The
notes, the changelog and the JSDoc now state the limit as it is. Its
advisory notes were taken up: a typed character that completes a typing
shortcut is two undo steps (*Found along the way*); the two JSDoc
passages on the update tag say what sets it now; the changelog names the
Shift+Enter change (D5).

The third review, the last the audit loop allows, found no defect in the
plan's own code. Its three blocking findings were all in D2. Two were a
row that was missing and notes that were wrong: nothing failed without
the place "at the end of the text right before" a mark that stands alone
(`TE59` pins it now), and the notes said `TE58` tells the second code
commit from the first, which it does not (its joint is the end of its
block, where the caret went before too). The third was in the code: the
place past spaces was taken only when the mark then opened its run of
text, so a range that starts right after a block's marker and ends
before two spaces, of which the reading keeps one, still sent typed text
to the block's end, where the parent had it at the selection (15 cells
of that review's sweep). The condition is gone: the place past the
spaces is taken as it is. Rows `TE60`, `TE61` and `TS17`. Its advisory
notes were taken up but for one that is the user's to settle (the update
tag, sign-off 5): `TS18` pins what the tag does outside an update and
the notes give the same effect for a range with no raw block; the typed
shortcut that is two undo steps is sign-off 8 and row `TU1`; D1 says
why the guard is at the removal; three stale comments were reworded;
`TS16` asserts where the tab stands; `TL2` pins text that holds the
mark's character; the docs page names the caret's limit.

The account above names rows as they were then; `TE60`, `TE61`, `TP6`,
`TL1` and `TL2` have been restated since, and the second reading it
describes is gone (D2).

The fourth review was run after the loop's cap, on the code as it stood
then. It found the plan's own code sound under every probe, and one
blocking defect in the fix made after the third review: the place past
spaces was taken wherever the mark at the caret told nothing, also where
those spaces show. A mark right after a closing delimiter keeps it from
closing (`_x_`, `**Note:**`, `*(x)*`, `~~s.~~`), and the mark was then
tried past the space that follows, which is text. So typed and pasted
text went in on the wrong side of a space: `> a **Note:** w⏎>⏎> q2` and
`ab next`, with the range from after `**Note:**` to after `ab`, typed
over, gave `> a **Note:** Xnext` where the parent gave
`> a **Note:**X next`. No row pinned it, and the sweep of joints could
not see it: it counted only text at the block's end.

D2 had then failed in two rounds running, each time in a corner of one
approach: reading the text a second time with a mark in it, whose
presence changes how the text around it reads. So the mark is gone. The
caret's place is now computed from the source offsets of what the blocks
show, with no second reading (D2). The rule is the one the review gave:
the caret is at the joint, and nothing the blocks show changes sides.
`TE60` and `TE61` are restated by it. The review's advisory finding, a
range that empties a raw block leaves a raw block of no text, is D8. The
sweep was written anew so that it sees the class (*The widened sweep*).

**What was changed after the fourth review was read by no reviewer**: all
of D2 as it is now (a new module, `markdownSourcePlaces.ts`, in place of
the second reading), D8, their rows, the docs of both and these notes.
Every check, the differential, the fuzz, the widened sweep and the
browser checks were run on that code. The coordinator runs a review of
it; none was started there.

The fifth review was run on that code. It found three blocking defects,
none of which the harnesses here could see, and each for a reason of the
harness's own making.

- *A removal completed a typing shortcut.* With the caret at the joint
  (D2), a removal that left it right behind text reading as a shortcut's
  syntax applied the shortcut, as a second update: `> a \*x\* w⏎>⏎> q2`
  and `ab cd`, with the range from after `\*x\*` to after `ab`, deleted,
  saved `> a *x* cd`, in italics, where the parent saved
  `> a \*x\* cd`; one undo did not bring the document back. The notes
  said the same happened at the parent and listed it as found and left.
  That was half true: the parent applied a shortcut after a deletion in
  an ordinary paragraph too, but not here, where its caret went to the
  block's end. The wide probe's blocks ended in a plain word *so that*
  the shortcut would not show, its undo check skipped Delete and
  Backspace, and the widened sweep took `*`, `_`, `~` and backslashes
  out of what it compared. The branch's own removals now
  complete none (D10); the parent's case, a deletion in an ordinary
  paragraph, stays as it was.
- *The caret went inside a task item's checkbox.* The mapping moved a
  blank that opens a line's text to the last blank the source holds
  there, and took the checkbox's own space for such a blank: with the
  caret right after the checkbox and one more space before the text, a
  typed character went into the checkbox's source and the item lost its
  checkbox. A blank is now moved only when it is a character of
  ordinary text, among the blanks the source holds between it and the
  next thing shown (D2, *What is no text keeps its own source*).
- *An end held as a point on a container threw on every route.* A range
  from inside a raw block to an element point on a list before its
  first item is a text-only-edge range, and its removal took the point
  for a place in a block's text. Such an end is now settled into text
  before a route reads the range (D11).

The review's advisory findings are taken with them: the reason the
Shift+Enter decline gives for an emptied raw block holds for a settled
end only, which D11 now gives it and its JSDoc says; three multi-line
initialisers of the mapping's module stand between blank lines; a call
no longer stands in an `else if`.

The harnesses were then changed so that they see what they hid (*The
differential check*, *The widened sweep*): every value is read after
the editor's pending updates are flushed, because a shortcut runs in an
update of its own that a first read does not commit; one undo is
checked for Delete and Backspace as for every route, with no condition
on the parent; the wide probe has blocks whose text before the joint is
escaped syntax and shortcut-shaped text of every kind, task items with
the joint after the checkbox, and ends held as points on containers;
the sweep compares saved documents byte for byte and the shown text on
each side of the caret as it is.

**What was changed after the fifth review was read by no reviewer**:
D10 and D11 and their rows, the change to the mapping's blank rule and
its rows (`SP13`, and `TE76`), the fallback's one more shape (a task
item's checkbox followed by a tab), the docs of all three and these
notes. Every check, the differential, the fuzz, the sweeps and the
browser checks were run on that code. The coordinator runs a review of
it; none was started here. The plan is left in `plans/in-progress/`.

### The base

The plan was written against `85b55a8f4`. The parent is four branches
above it. Of the files this plan changes, `git diff --stat 85b55a8f4
fef32344b` names `MarkdownEditor.ts` (808 lines: the list toggles'
rewrite, and the settle step for selection ends), `markdownWritable.ts`
(65 lines, `$selectTextOffset` among them), the docs page and the
changelog. The two test files are unchanged. In `MarkdownEditor.ts` every
site the plan names stands five lines lower than the plan gives; in
`markdownWritable.ts` the lines are the plan's. Every function the plan
changes has the body the plan prints as "today", and every symbol it
names exists under that name.

What the plans around this one expect of each other:

| Expected | Found |
|---|---|
| `$showRawBlockAsSaved` at module level and exported | not done by the edge-cases branch, whose notes leave it to this plan; step 3 of this plan did it |
| rows `Q11` to `Q13` restated in place (`markdown-editor-list-item-edits.test.ts`) | there, `:647` to `:652` |
| `pasteText` at module level in `markdown-editor-list-item-paste.test.ts` | there, `:173` |
| the imports the plan that follows needs in `markdown-editor-command-crashes.test.ts` | added by this plan, as its *Expected Behaviour* says |

**The defect at the base.** The reviser's matrix was run on a private copy
of the parent before any change (`diff/ec-matrix-P.json`). 1,148 of its
3,116 guarded cells fail their check there: the same number, with the same
split by route, as the reviser measured at `85b55a8f4`
(`diff/redcount.py`, which is the rule of the reviser's `rbr-red.py`). The
parent's matrix, cross-item grid and places probe are byte for byte the
edge-cases implementer's last run (`…-b6.json`), so that run's fuzz
results are the baselines here.

### How the plan's steps went

| Step | The plan's check | Measured |
|---|---|---|
| 1 | the parent's results are recorded | matrix 3,192 cells, grid 26,928, places 66,976 records, on a private copy of `fef32344b` |
| 2 | the 103 tests marked red fail, every other passes | so: 464 tests, 103 fail, by name the plan's (18 TE rows, 30 route rows, 9 TS rows, 44 TC rows, `TG8`, `X14`); the run reports the `window is not defined` rejections the plan foretells (`logs/red-base.log`) |
| 3 | `checkSiblings` gives no match; three suites green | so |
| 6 | the two delete listeners are gone; the table-edge suite is green | so |
| 10 | `$isStaleFocusRange(` is called in four functions | so: `$isGuardedRange`, `$removeJoiningRange`, `$guardedRemovalDeclinesLineBreak`, `$isPlainlyRemovedRange` |
| 11 | the grep for the old wording gives no match | so |
| 12 | every row passes; no existing row but `X14` changes | so, on the plan's code as printed: 464 tests pass, and the suites of step 12 pass with no expected string changed |

The rows were taken from the reviser's `proto/patch-ret.txt` and checked
against the plan's tables by a script, row by row (41 shapes, 72 route
rows); the shapes' documents are written with the plan's constants. The
source edits are the plan's snippets as printed.

### Deviations

**D1. The selection the caller passed is the editor's again when the
removal returns.** The plan says "Pass the editor's own selection" and
that the re-read "places the caret through the node's `select`, which
moves the same selection object". One step of the re-read does not: a raw
block that its text leaves open before a block (`<!--` without `-->`) is
shown as the paragraph it is written as by `LexicalNode.replace`, which
installs a clone of the selection as the editor's and leaves the object it
cloned pointing at the node it removed. `paste()` and Lexical's own
insertion of pasted nodes go on with the object they passed. Measured on
the plan's code as printed, for `<!-- c1⏎c2 -->⏎⏎after⏎⏎more` with
`"<!-- c1"`@6 → `"after"`@1: `paste()`, a paste of nodes and a paste of
blocks throw `ElementNode.splice: start + deleteCount > oldSize`. The
plan's 41 shapes do not reach that step, and the matrix does not either.

`$removeGuardedRange` now ends with `$keepAsEditorSelection(selection)`:
when the editor holds another selection object, the caller's object takes
its points and is set as the editor's selection again. It is in the
function every route goes through, so no caller has to read the selection
anew. The file meets the same hazard once already, another way:
`$replaceEmptiedContainerAtCaret` moves the caret before its container
goes and does not call `replace` at all. `$showRawBlocksAsWritten` could
be written that way too. The guard is at the removal instead for its
reach: that rule runs on every ordinary edit, where no caller holds the
selection and nothing is wrong, and one guard where the callers are covers
every step of the re-read, this one and any that comes to call `replace`
later. The two places the plan's snippets read the selection anew
(`$handleRawBlockEnter`, `$removeGuardedRangeBeforeText`) are left as the
plan prints them; they are no longer needed. Rows: shapes `TE42` to `TE44`
(a raw comment left open before a block: in the document, in a list item,
and joined by the text of an item that holds blocks), each through all 18
routes; their expected strings are what Delete and then the route give at
the parent (`adhoc/controls1-P.json`). Without the call, 18 of those rows
fail (the three paste routes over the three shapes, in the route rows and
in the `TJ` rows).

**D2. The caret keeps its place when a raw block shows as its blocks.**
This is the fourth code commit and sign-off 1.

The plan's contract is "the route inserts at the caret the removal
leaves", and it measures it as "equals Delete, then the route". Both hold
on the plan's code. But where the removal makes a raw block read as rich
blocks, the caret the re-read leaves was not where the range was. The
re-read (`$showRawBlockAsItsBlocks`) kept the caret's place only where
the raw text before the caret showed exactly as written; a quote's `>`, a
list item's marker or a line end before the caret (which shows as a
space) sent the caret to the end of its block. That is the parent's
behaviour for Delete. With the plan, every route then inserts there:

| Source | Selection | Route | Parent | The plan's code | The branch |
|---|---|---|---|---|---|
| `> q1 w⏎>⏎> q2⏎⏎after` | `"> q1 w"`@5 → `"after"`@1 | Delete, then the caret | `> q1 fter`, caret after `fter` | the same | `> q1 fter`, caret before `fter` |
| same | same | type `x` | `> q1 xfter` | `> q1 fterx` | `> q1 xfter` |
| same | same | Enter | `> q1⏎> fter` | `> q1 fter` and an empty paragraph | `> q1⏎⏎fter` |
| `- a⏎  > q⏎- b⏎⏎after` | `"  > q"`@2 → `"after"`@1 | type `x` | `- a⏎  xfter` | `- a⏎  fterx` | `- a⏎  xfter` |

So the plan as written moved typed and pasted text, and Enter's split, to
the end of the paragraph for these selections, where the parent had them
at the selection. The reviewer-7 fuzz showed it first (four new
`linesMerged` records on the plan's code, Enter over such a range). The
cause is the re-read's caret, so it is fixed there, for Delete as well.

*The rule.* The caret is at the place, in the blocks the raw text now
shows as, that its offset has in the raw text: after everything those
blocks show whose source ends at or before the offset, and before
everything else they show. Nothing the blocks show is on another side of
the caret than its source was. A space that shows is content like any
other character.

*How the place is found.* Where the text before the caret shows as
written, the caret is counted from the block's start, as at the parent;
no existing row changes. Elsewhere `$placeOfSourceOffset` finds it
(`markdownSourcePlaces.ts`, a new module). The source of what a block
shows comes from the source analysis (`analyzeMarkdownSource`,
`markdownSourceTokens.ts`): it reads Markdown through the viewer's lexer,
as the load does, and gives every visible character its source offsets
(`SourceEntry.start` and `end`). The block's own Markdown is analysed,
with the link reference definitions of the text around it, and the block
the load built is walked beside the analysis's entries: each entry must
be what the block shows next, character for character. A line end shows
as a space; an atom shows as a node of its own or as a source node; a
code block or a raw block inside the block shows its lines as they are
written (a raw block that no entry stands for, a definition `marked`
drops for repeating a label, is found by those lines); a table cell's
paragraph break shows as no character. Where the
block shows something else, the walk stops there, and what follows has
no known source. A place is never guessed: it is given only where the
thing before it and everything after it have their source found, and the
sources stand in the order of what the block shows. The analysis finds a
token by searching for its text from the end of the one before, so text
it cannot find where it stands may be found further on, in the place of
other text that reads the same, which is then not found in its turn;
hence "everything after it".

*Why not the second reading.* Three versions before this one read the
text once more with a mark at the caret (U+E000) and took the place the
mark showed at: the mark compared node for node (failed for an escaped
character), run for run with a rule for a mark between two runs (the
second review), then tried past spaces (the third review, and the fourth
review's defect). Each fix opened a corner, because a mark is a
character, and a character beside a delimiter or a marker changes what
they are. The mapping puts nothing into the text. Before the second
reading was taken out, both were run over the same (text, offset) pairs
(`r4/zz-r4-proto.test.ts`: 21 raw texts cut at every offset and joined
to 20 tails; 37 texts holding one construct each, with 9 tails; and
every document of the round-trip corpus cut at every offset, with 4
tails):

| | Pairs with a caret to place | Same place | The mapping alone tells | The mark alone tells | Neither tells | Other places |
|---|---|---|---|---|---|---|
| 21 raw texts × 20 tails | 6,700 | 5,947 | 733 | 4 | 13 | 3 |
| 37 constructs × 9 tails | 7,652 | 7,071 | 564 | 6 | 3 | 8 |
| the round-trip corpus × 4 tails | 27,826 | 24,933 | 2,433 | 225 | 235 | 0 |

"The mark tells" where the text reads with the mark as without it, which
makes the mark's place a place found without any source offset. The 11
other places are one convention (below): a caret between the backslash
of an escape and its character. The 235 pairs the mark alone tells, and
the 251 neither tells, are the fallback's shapes (below): a block that
shows nothing, and in the corpus a tab that indents a list item's line
(158 pairs), a task item's text that opens with a space (2), and text
that begins as a link reference definition repeated before it (5).
`SP10` of the new test file pins the corpus comparison for two of the
tails: more than 15,000 places the mark confirms, none other, and no
pair without a place outside those shapes.

*Why a module of the source-mode side is used here.* The analysis is the
one source mode's commands read a selection's blocks and formats from.
It imports the viewer's lexer and nothing of CodeMirror or of Lexical,
so the WYSIWYG side calls it as it calls the lexer itself
(`markdownWritable.ts` imports `lexMarkdownWithDefinitions` the same
way); nothing was moved. The mapping is in a module of its own beside
it, because it needs both the analysis and the nodes a load builds. It
keeps the rule the analysis is built on: a token whose text is not found
is left without a place, and the caller declines rather than guess. The
plan's *Architecture Decisions* has the same in short, added with this
commit (D9).

*Where the place is between two things.* All of these keep the rule;
they say which of two nodes that meet there holds the caret.

- Between two text nodes of one line, the caret is in the one whose
  format its offset has in the source: inside the delimiters of bold
  text it is in the bold text, outside them in the text beside it. Where
  both have that format it is at the end of the first, where neither has
  at the start of the second. So after `**Note:**` the caret is in the
  plain text that follows, and what is typed there is plain.
- A source node (a soft line break, inline HTML, a task item's checkbox)
  takes no typing, so it gives way to ordinary text on its other side.
  An offset inside the source of one that shows its source as written
  (`<b`│`>`, or `[x]`│ before the checkbox's own space) is at the nearer
  end of that node, its start where both are as near, and never inside
  it (`$placeOutsideSourceNode`). A character typed inside a source node
  replaces the node whole, at the parent as here, so a caret left there
  would take the checkbox with the next key (the fifth round's sweep
  found it). The same step is taken where the caret is counted from the
  block's start.
- Between two blocks the caret is at the end of the text before it until
  the source has ended that block: with a line end, with the `|` between
  two cells of a table's row, or with the paragraph break of a cell. Where
  the offset's own list item or table cell shows nothing, the caret is in
  it, and neither neighbour's text holds it (`$emptyBlockAt`, round 7).
- An offset inside the source of one thing the block shows as a whole is
  before that thing: between the backslash of an escape and its
  character, in the syntax of a hard line break or of an image.

*The fallback.* The caret goes to the end of its block, and only there,
where there is no place:

1. The block shows nothing at all (an emptied quote or list item). Its
   end is its only place. A list item or a table cell that shows nothing
   in a block that shows something elsewhere is no fallback: its place is
   in it (`$emptyBlockAt`, round 7, `SP15`).
2. The block holds, beside the caret or after it, text whose source is
   not found, because `marked` hands that text back otherwise than the
   source holds it:
   - a list item's line that a tab indents past the item's text, which
     shows as spaces the source does not hold;
   - a tab between the words of a list item's text, which `marked` also
     hands back as a space (round 7; `- a⇥b w¦ x`, `1. a⇥b¦ c`,
     `- [ ] a⇥b¦ c`, the nested form: the whole text token is not found,
     so a caret anywhere in that item has no place; `SP7`, `TL5`);
   - a task item whose checkbox is followed by more than one space, in
     a list with blank lines between its items, or by a tab
     (`- [x]⇥Alpha`): the checkbox shows with the one space of its own.
3. The sources found are not in the order of what the block shows: text
   of a list item that begins as a link reference definition does which
   `marked` dropped before it for repeating a label (the text is found
   in that definition's place).

Text of those kinds in an *earlier line or item* than the caret's takes
nothing from it (`TL4`, `SP8`); a tab between the words of the caret's
own item does (`SP7`, `TL5`). In the three sets of pairs above every pair without a place is
one of these, and the sweep has no cell at the block's end; but the
sets do not hold every shape. The tab after a checkbox was found by the
fifth review, in none of them. `SP7` pins it now, and `SP10`, the
corpus comparison, names the two causes the corpus has (a tab that
indents a line, a definition that repeats a label) where it let any
text holding a tab pass. The docs page and the changelog name 1 to 3.

One more text is handed back otherwise than written, and its source is
found all the same: a link text holding an escaped bracket
(`[a \[b](/u)`). `marked` takes the backslash out before it reads the
text, so the analysis leaves the text's tokens without offsets; but the
text stands in the source after the link's `[` with just those
backslashes in it, and each character's place in it follows from the
tokens (`leavesOfUnescapedLinks`, with `contentOffset` exported from the
analysis for it). Shape `TE75` and rows `SP11`. Before that step it was
a fourth shape of the fallback, at the block's end in 1,480 cells of the
widened sweep.

*What is no text keeps its own source (the fifth review).* The source
analysis finds a shown blank at the first blank of a run in the source,
and a load drops a run's surplus from the left, so the mapping moves a
shown blank to the last blank the source holds there
(`keepLastOfLeadingBlanks`). It moved the checkbox's own space as well:
for `- [x]`, two spaces and `cd`, the offset after the first space was
put *inside* the checkbox's node, and a character typed there replaced
the checkbox. Only a blank that is a character of ordinary text is
moved now, and only among the blanks the source holds between it and
the next thing shown. A checkbox with its space, inline HTML, a line
end, a hard line break, an image and a link that shows nothing stand
where their own source does. `SP13` has every such thing with none, one
and two blanks after it, at the offsets just before it, inside its
source, just after it and at each blank (195 rows); `TE76` is the
review's shape in the editor, and `TE77` the joint between the checkbox
and the space the tail gives it.

*`TE60` and `TE61` restated.* A range from right after a quote's marker
to before two spaces leaves `>` and two spaces, of which the marker
takes one and the block shows the other. The third review's fix put the
caret past the one that shows, and the rows pinned `> xNext`: a typed
character glued to the next word, the fourth review's defect at a
block's start. By the rule the space that shows stays after the caret:
`> x Next`, and `> q1⏎> x cd` for `TE61`. The parent, which typed into
the raw text, gave `X  Next` with two spaces: there the typed character
made both show. What Delete saves holds one, on the parent and on the
branch alike, and the route is Delete, then the route.

*Rows.* In the crash test file: shapes `TE45` to `TE49`, `TE51`, `TE53`
to `TE61` and `TE66` to `TE78`. `TE76` to `TE78` came with the fifth
review (above; `TE78`: a tag's opening before the range and its `>`
after it stay text, the join makes no tag). The ten before them are new
with the mapping:
after bold, italic and struck text that ends in punctuation or is
written with underscores, before one space and before two (`TE66` to
`TE69`, the fourth review's class, in a raw quote and in a raw list's
item); before a space and bold text that opens with punctuation (`TE70`,
`TE71`); inside the address of a link the two halves make (`TE72`, the
caret after the link, where the second reading sent it to the block's
end); between the backslash of an escape and its character (`TE73`);
inside inline code the two halves make (`TE74`); before a space and a
link whose text holds an escaped bracket (`TE75`). The `TJ` rows: for 29
shapes whose removal re-reads a raw block, each of 16 routes over the
range must give the document, the tree and the caret that the route
gives in a freshly loaded copy of what Delete saves, with the caret set
at the joint by hand. That comparison carries no caret over from Delete,
so it does not pass by two wrong carets agreeing. The `TJ` rows of `TE7`
and `TE42` to `TE44` pass on the first code commit, and so do `TE58`'s:
its joint is the end of its block. Two cells are no `TJ` row: Tab at a
joint before inline code (`TE56`) and inside it (`TE74`), which `TS16`
pins for the first (*Found along the way*, the tab's format). `TE60`,
`TE61` and `TE73` have no `TJ` rows: the first two keep a space after
their joint that a save trims, so what Delete saves, loaded anew, holds
another node there, and the third's joint is inside the two characters
of an escape, where a loaded document has no place; their shape rows and
`TS17` pin them. `TP1` to `TP8` pin the same rule for an edit inside one
raw block (below), `TL1` to `TL3` the fallback's shapes 1 and 2, and
`TL4` that such text before the caret takes nothing from it.

In `markdown-source-places.test.ts`, new: 330 rows on the mapping
itself, which read Markdown as a raw block's text is read and ask for an
offset's place. `SP1` to `SP6` are 96 places by kind (nothing changes
sides; the formats; markers, indentation and line ends; between blocks;
things shown as one, and the nearer end of a source node; code and raw
blocks inside a block), `SP7` to `SP9` the fallback (`SP9` its shape 3;
`SP7` holds the tab after a checkbox), with `SP8` for text of those
kinds before the offset, `SP11` the link text that holds an escaped
bracket, `SP12` a reference link whose definition stands in a block
before its own, `SP13` the 195 places around what is no text (above),
`SP14` the step that keeps a place out of a source node, and `SP10` the
corpus comparison above, in which a place inside a source node's source
is expected at that node's nearer end, where the mark shows inside it.

What it changes outside this plan's ranges: the same rule runs when an
ordinary edit makes a raw block show as its blocks, so the caret stays in
place there too (the changelog's entry). Rows `TP1` to `TP8` pin that
path, a selection inside one raw block deleted or typed over: the text
shows as written; a quote's marker before the caret, deleted and typed
over; a line end before it; the caret inside a quote's marker; between a
quote's marker and bold text; inside a link's address, where the caret
is now after the link (`TP6`, restated: it went to the block's end); and
after italic text written with underscores, before a space (`TP8`, the
fourth review's case of an ordinary edit). In the reviser's matrix eight
cells change by the caret alone: Enter and Shift+Enter over `TE10` leave
it after the break they made, where it was at the end of the block.

**D3. Rows the plan does not have.** In the first code commit: `TE42` to
`TE44` with their 54 route rows (D1), the 64 `TJ` rows of `TE7` and
`TE42` to `TE44`, `TE50`, `TS14` and `TS15` (D4), `TE52` (*Found along
the way*, the tag), `TS18` and `TU1` (the same section), and `TN1` to
`TN18` and `TN21` to `TN24` with their five route rows and `TN14`
(D11). In the second: `TE62` to `TE65`, the 15 route rows of `TE62`,
`TS19` to `TS22`, `TX1` to `TX7` and `TN19` and `TN20` (D8); row `R32` of
the table-edge file is restated there. In the third: the rows of the
new `markdown-editor-typing-shortcuts.test.ts` (D10; the seventh round
rewrote them, and they are 112 now). In the fourth:
`TE45` to `TE49`, `TE51`, `TE53` to `TE61`, `TE66` to `TE78`, their 398
`TJ` rows, `TP1` to `TP8`, `TL1` to `TL4`, `TK1` to `TK7`, `TS16` and
`TS17`, and the 330 rows of the new `markdown-source-places.test.ts`
(D2). The describe holds 821 tests, the plan's 185 among them.

**D4. A fourth Shift+Enter result changes, which the plan's list of
changed results does not name.** The plan judges Shift+Enter over a
text-only-edge range before the removal, by the formula of the
stale-focus range, and lists three results that change. The formula also
declines a range from a level 3 to 6 heading to the *start* of a raw
block or code block (a heading of those levels is one line). At the
parent that range was removed and the break showed as a space
(`### he \<div> raw text \</div>`); now nothing changes, as for the same
range ending inside the raw block's word (`TS2`). Shape `TE50`, row
`TS14`; `TS15` pins a paste of blocks over it, which is the plan's class
"rules that run when an update ends" (`TS5`).

**D5. The docs say more than the plan's text.** The plan's docs edit is
word for word. Its changelog entry is word for word but for one sentence
added before its last: that Shift+Enter now does nothing over a
selection that ends at the start or the end of such a block with nothing
to follow the caret, or that runs from a level 3 to 6 heading to such a
block's start, where it used to remove the selection. The plan's entry
names none of its Shift+Enter changes; the reviews said a key that stops
acting should be named. Two entries follow it, one each for D8 and D2,
and the component page has a sentence for D8 and for D2 in the paragraph
the plan edits: what a raw block left holding nothing becomes; and where
the caret stands after a raw block shows as its blocks, which text it is
in between two formats, and each shape of the fallback. Each is in the
documentation commit of its code commit. D10 has no docs and D11 has
none: against the parent D10 changes nothing a user sees (round 7: the
fifth round's entry and sentence, which described a rule for every
block, went with the rule), and no click makes the selection D11 is
about. Sign-off 7.

**D6. Where the harnesses ran, and one more.** The differential and the
fuzz files ran on private archive copies of the two commits
(`mkcopy.sh`), as on the edge-cases branch, so nothing was written into
the worktree. The plan's two harnesses were run with the edge-cases
copies of the reviser's scripts (`diff/proto/`), compared with the
reviser's `rbrdiff.py` and `griddiff.py`. A third harness was written for
this run, because the plan's 41 shapes hold one kind of raw block, cut in
few places: the wide probe (*The differential check*).

**D7. One comment in a test file the plan does not list.**
`markdown-editor-table-edge.test.ts`, above row `D17`, said the row fails
"when the table-edge delete listener runs after
`$joinIntoTextOnlyBlock`". Neither is a listener of a range any more; the
comment now names the order inside the removal.

**D8. A raw block left holding nothing shows as an empty paragraph.**
This is the second code commit and sign-off 9. The fourth review found
that a range which takes all of a raw block (`"<div>"`@0 → the end of a
later block) left a raw block of no text. A save writes nothing for one
and a reload shows another tree; the parent does the same for Delete,
Enter and Tab. The branch had added two things to it: Shift+Enter left a
raw block holding only a line break (the parent declined it), and a
paste of formatted nodes went in as plain text where, for a backward
range, the parent kept the bold.

What the editor does already, measured before the change
(`r4/empty-parent.txt`, `r4/empty-branch.txt`): a selection of all a raw
block holds, deleted inside the block, leaves the same raw block of no
text, on the parent too; a character typed into it makes it a paragraph
at once, by the rule that shows a raw block as its text reads; Backspace
in an emptied code block makes it a paragraph; an emptied code block
stays a code block, which Markdown writes (a fence with nothing in it).
So the paragraph is what the editor already makes of such a block as
soon as it holds a character, and an empty paragraph is what it holds a
document of no blocks as.

The rule is one more step of `$showRawBlockAsSaved`, the function that
shows a raw block as its save reads
(`$showBlankRawBlockAsParagraph`, `markdownWritable.ts`): a raw block
whose text is blank is replaced by a paragraph holding what it held, the
caret with it. It runs where the other steps run: as a transform when a
raw block's text changes, and inside the removal. So it holds for every
way a raw block is emptied, a selection inside the block as well as a
range that runs on (`TX2` to `TX7`), and what is typed or pasted next is
rich text (`TE62`'s rows: a paste of bold nodes stays bold in both
directions). An emptied code block is unchanged.

Shift+Enter: a break would be all such a paragraph holds, which no save
writes, so it is declined before anything is removed, as over any other
selection: over a range that starts at the very start of a raw block and
has nothing follow its end (`$rawBlockEmptiedFrom`, in
`$joiningRemovalDeclinesLineBreak`; rows `TS19` to `TS22`), and over a
selection that covers all one raw block holds (`$coversAllOfRawBlock`,
in the line-break rules' `$declinesLineBreak`; row `TX5`). At the parent
the first was declined too and the second left the raw block holding the
break.

Rows: shapes `TE62` to `TE65` (a raw block's start → a later block's
end; the same with nothing left of the document; the raw block of a list
item; two raw blocks, both emptied), each typed over and deleted in both
directions; the 15 routes of `TE62`, each in both directions and both
dispatch contexts with one undo; `TX1` (after Delete no raw block is
left and the caret is in the empty paragraph, for the four shapes).
`R32` of `markdown-editor-table-edge.test.ts` pinned the empty raw block
after a range from a table cell to a raw block's end; it now expects the
paragraph. No other existing row changed.

The plan that follows does not rely on an emptied raw block (see the
last section).

**D9. Two subsections added to the plan's *Architecture Decisions*.**
"The caret after a re-read is placed by source offsets", marked as added
at implementation: the coordinator asked for the reason a module of the
source-mode side is used from the WYSIWYG side to stand there, and D2
has it at length. And "A removal the editor makes itself completes no typing
shortcut", marked the same way, for D10.

**D10. A removal the editor makes itself completes no Markdown typing
shortcut.** This is the third code commit and sign-off 11. The plan does
not have it; the fifth review asked for it, after the caret's new place
(D2) let a removal complete a shortcut. The fifth round made it the rule
"a shortcut is applied for typed text only", with tags for what is no
typing; the sixth review found that rule wrong for a character committed
by an input method or a dead key on desktop WebKit, and the user chose
the narrower one below (round 7). The general rule is the plan
`markdown-editor-typing-shortcuts-only-for-typing`, the next branch on
top of this one.

*What happened.* `registerMarkdownShortcuts` (Lexical) has no notion of
typing. Its update listener takes any update that leaves a collapsed
caret in changed text, at most one character further on than it was,
for a typed character, and reads the text before the caret for a
shortcut. A deletion is such an update, and so is the removal of a
range. After a range from a raw block was removed the parent's caret was
at the end of the block, and nothing applied. With D2 the caret is at the
joint, and escaped text right before it became formatting, as an update
of its own: for Delete, Backspace, a word delete, `REMOVE_TEXT_COMMAND`
and `cut()` alike, so one undo did not bring the removed text back.

*The rule.* An update in which the editor removes a guarded range for a
route that inserts no text completes no shortcut. `$removeGuardedRangeAsDeletion`
(`MarkdownEditor.ts`) calls `$removeGuardedRange` and tags the update
`GUARDED_DELETION_TAG` when it removed one; the delete commands'
listener, the native cut's removal, `cut()`, Enter, the paragraph
command and the line-break command use it (the paragraph command tags
after its own call, which the insert routes share), and
`registerMarkdownShortcutsOutsideRawBlocks` does not hand Lexical's
listener an update that carries the tag. A route that inserts text over
the range (typing, an input method, a paste, a drop, Tab) does not tag,
so what it types or pastes is the update's, as over any other range:
nothing is classified as "not typing", no command's payload is read, and
`cut()` has no tag of its own again. The wide probe found the first
version of this, which tagged the removal-only routes, short of Shift+Enter
at a block's end: the line break is dropped there, and the shortcut then
applied to what the removal left (`TK8`).

*What is not covered, and is as at the parent.*

- A deletion or a cut in an ordinary paragraph, or any range Lexical
  removes by itself, completes a shortcut when the text left before the
  caret reads as its syntax: `\- .cd` with the `.` deleted becomes a list
  item, as a second undo step. The branch does not fix it. Rows `TY5`
  pin it, over the 14 kinds, six removals and both contexts. It is the
  plan `markdown-editor-typing-shortcuts-only-for-typing`.
- Pasting or dropping the one character that completes a shortcut's
  syntax applies it, as at the parent (`TY4`).
- One shape differs from the parent. A range inside a single raw block is
  no guarded range, so Lexical removes it; when the block then reads as a
  quote and the caret stands at the joint (D2), right behind text that
  reads as a shortcut, the shortcut applies (`> a \*x\*.` with the rest
  of the range removed gives `> a *x*q2`, `TK6`). The parent's caret went
  to the end of the block there and nothing applied. It is the same
  defect as the paragraph's, reached through D2's caret; the next plan
  removes it. It is listed in the round 7 section.

*Collision with the next plan.* That plan registers the update tag of
typing and marks nothing as "not typing". Its step 2 removes what this
leaves for it: `GUARDED_DELETION_TAG`, the helper and its three callers
(the check in the shortcut wrapper goes with the tag), `TY1`, `TY1b` and
`TY5`, which that plan replaces whole. `TY2`, `TY3`, `TY4` and `TY6`
(typing, a browser's own typing, a paste or drop, the end of a
composition) hold under both.

*Rows.* `markdown-editor-typing-shortcuts.test.ts`, new: 112 rows over 14
kinds of shortcut (italic, bold, inline code, strikethrough, underline,
a link, three bullets, a list number, two headings, a quote, a code
fence), each as escaped text that reads as the syntax once one character
is gone. `TY1`: a range from that character into a raw block's text,
removed by Delete, Backspace, a word or line delete,
`REMOVE_TEXT_COMMAND`, `cut()` and the native cut, forward and backward,
inside an update and outside, saves the text with its escapes joined to
the raw block's rest, and one undo restores the document. `TY1c`: Enter,
the paragraph command and the line break over it keep the escapes too. `TY1b`: the
character that completes the syntax, typed over such a range, gives what
typing it after the removal gives. `TY2`: typed after a removal, it
applies the shortcut; one undo takes the shortcut back, a second the
character. `TY3`: the same character put in by an update with no tag, as
a browser's own input is, applies it too. `TY4`: pasted or dropped, it
applies it. `TY5`: a removal in an ordinary paragraph applies it.
`TY6`: the end of a composition applies it. On the parent `TY1` fails for
every kind (14 of the 112). With the tag not set, `TY1` fails; `TK1` to
`TK5` too. `TK8`: Enter, a line break and a paragraph over a range that
ends at a block's end; the line break fails without the tag. `TK1` to `TK5` in the crash test file are the review's own
shapes (escaped emphasis, an escaped bullet, heading marker and list
number, asterisks the joined text writes as text), each through the five
removal routes in both directions and both dispatch contexts, with the
saved document, the reload and one undo. The rows read the document
after flushing the editor's pending updates: a shortcut's update is
queued when the edit is committed, and a first read alone does not show
it.

**D11. An end held as a point on a container is settled into text
before a route reads the range.** Part of the first code commit;
sign-off 12. The fifth review found that a range from inside a raw
block to an element point on a list before its first item (`"raw"`@1 →
the list node at offset 0, in `<div>⏎raw⏎</div>⏎⏎- la⏎- lb⏎⏎after`)
threw on every route of the branch
(`insertAfter: list node is not parent of list item node`); at the
parent Delete and Enter threw, and the other routes went on. No click
makes such a point; a selection made in code can hold one.

*Why it threw.* The range is a text-only-edge range (one end in a raw
block), and its removal takes the other end for a place in a block's
text: it moves "the rest of the end's block" out, and the end's block
is here the list itself. The plan made that removal the one every route
takes, so every route threw.

*The rule.* Before a route reads a range that has one end in a raw
block or a code block and the other on a node that holds blocks,
between its children (a list, a list item, a `:::` block, one of its
columns, the document), that end is moved into the range: the range's
start to the start of the first block of text at or after it, its end
to the end of the last block of text at or before it, and each is then
named as a point in text (`$settleTextOnlyEdgeEnds`, `MarkdownEditor.ts`,
by `$settleRangeEndsInward` and `$moveBlockPointsIntoText`, which the
block commands settle their selection with already). The range is then
the text range a reader sees, and every route gives what it gives for
that range. It runs in two places: at the start of
`$removeGuardedRange`, for a route that is no command (`cut()`,
`paste()`), and as the first listener at `COMMAND_PRIORITY_CRITICAL` of
every command that has a guard (`$settleSelectionBeforeGuard`), and of
`KEY_ENTER_COMMAND`, whose handler for a raw block reads the range
before any guard does. So each listener after it, a guard or a decline,
reads a settled range.

What follows from the rule, and is pinned:

- A range whose end stands right after its raw block (a list before its
  first item, the document between the two blocks) is settled to the
  raw block's end: nothing of the list is in it, and no route touches
  the list. At the parent the routes that did not throw gave the same.
- A range that is empty once settled is a caret, and every route acts
  as at a caret there.
- A command that is declined leaves the same range, held as points in
  text (Shift+Enter over a range that would leave nothing but the
  break). `insertImage` and `insertTable`, which decline any range that
  touches a raw block before they read it further, leave the selection
  as it was handed over.
- A point on a table, a row or a cell is left as it is. It is inside
  the table, so the range is a table-edge range, which has its own
  removal and reads such a point already (`$isTableEdgeRange` counts a
  point on the table node as inside it): the range is removed with the
  whole table, as the range to the text at that place inside the table
  is, and as at the parent. `TN21` to `TN24`.

*The Shift+Enter decline (the review's advisory finding).* The decline
for a range that empties its raw block asks whether anything follows
the range's end in the end's block (`$joiningRemovalDeclinesLineBreak`).
For an end on a list that question had no block to be asked in. The
listener that settles the range runs before the one that asks, so the
end stands in a block of text; the function's JSDoc now says so.

*The sweep.* `r5/zz-r5-points.test.ts`: 19 documents (a raw block, a
raw quote or a code block before and after a list, a `:::` block, a
list item of three blocks, a nested list and a table; a raw block
inside a list item; the range from the raw block's very start, to its
very end, and with nothing after the list), every element point on
every node that holds blocks in them (the document, lists, list items,
`:::` blocks, columns, tables, rows, cells), 19 routes, both directions,
both dispatch contexts: 19,608 cells. Each is run twice: with the
element point, and with the text point in its place — for a list, a
list item, a `:::` block, a column and the document the end of the text
before the point (the start of the text after it, where the point is
the range's start); for a table, a row and a cell the text at that
place inside the table.

| | Cells |
|---|---|
| the outcome is the text-point range's — the save, the nodes, the selection — for a point on a list, a list item, a `:::` block, a column or the document | 15,660 |
| the same for a point on a table, a row or a cell | 3,672 |
| the native cut, which needs a browser's clipboard, on both sides alike | 204 |
| the range is empty: a caret, whose Delete needs a browser's selection, on both sides alike | 72 |
| a throw, one undo that does not restore, a save that does not read as shown where the text-point range's does, or any other difference | **0** |

For `insertImage` and `insertTable`, which decline, the selection is
left out of the comparison: it stays as it was handed over. Delete and
Backspace give, in all 2,016 cells that have one, what the *parent's*
Delete gives for the text-point range (the save, and the tree but for
D8). 104 cells hold a document that does not read as shown on either
side: a raw quote the range did not touch shows its source.

On the parent the same sweep throws in 136 cells
(`r5/points-P5.json`).

*Rows.* `TN1` to `TN24` in the crash test file: 23 element points (a
list before, between and after its items; a list item; the document; a
`:::` block and a column; a list before the raw block; a code block; a
list item of several blocks; the raw block's very start; a table, a row
and a cell), each through 18 routes in both directions and both
dispatch contexts, against the same range with text points: the saved
document, the nodes and the selection are the same, and the save reads
as shown. Five routes over the review's own range with their documents
and one undo; and `TN14`, the native cut. On the fourth review's code
20 of them fail, on the parent 23.

*For `plans/markdown-editor-table-command-fixes.md`, part D* ("one rule
moves such a selection point to a caret position before a command
acts"): what is here is narrower than that rule and built so that it
can be taken over by it. `$settleTextOnlyEdgeEnds` acts only on a range
with one end in a raw block or a code block, and leaves a table-edge
range alone; it uses the two functions the block commands already
settle with, and adds none. A rule for every command and every
selection can replace it by settling in the same listener
(`$settleSelectionBeforeGuard`, first at `COMMAND_PRIORITY_CRITICAL` of
each command in `registerRangeGuards`) and dropping the two conditions;
`$removeGuardedRange`'s own call is then only for the routes that are
no command. What part D has to decide and this plan did not: a point on
a table, a row or a cell from outside the table (today: inside the
table, so the whole table goes), a caret (today: the block commands'
`$settleCaretIntoBlockOfText`), and a range with no end in a text-only
block.

### Found along the way, not changed

- **Enter over a range from a raw block is Delete, then Enter, also
  where the parent's line break read better.** This is the plan's
  decision (*Enter in a raw block uses the same removal*), and the
  reviewer-7 fuzz has one record of it; see *The fuzz* and sign-off 2.
- **The update tag on the removal: the plan's decision does not hold, and
  the branch no longer sets it.** The plan tags the removal's update as
  Delete's command is tagged (`RUN_EDGE_TAG`). The fifth round kept
  the tag and measured one effect, outside an update (typing over a range
  that starts after a space in a formatted run). The sixth review found
  more: the tag sends every route over the range through the rule that
  tidies each changed block whole, typing and Tab among them, and that
  rule strips the mark from a link's text elsewhere in the block when a
  letter follows the link. `x [**b**](/u)yz and more` and `QZ 7Y`, with the
  range from `and m│ore` to `QZ│` and `x` typed inside an update, saved
  `[b](/u)` where the parent saved `[**b**](/u)`, in a document with no raw
  block. Delete, paste and Enter lose the mark at the parent already; the
  branch had newly sent typing and Tab through it, for the parent's two
  shapes too. The earlier sign-off said no result inside an update
  changes with the tag; the probe held twelve shapes, none with a link
  and a letter after it. Round 7: `$removeGuardedRange` sets no tag. A
  route that was tagged at the parent is tagged now by what tagged it
  then: the delete commands, the paste commands, the cut command, the
  drop, Enter and Shift+Enter (`registerRunEdgeRules`, at the critical
  priority), and `insertImage`. Typing, the composition's start and Tab
  are tagged by nothing, and are tidied where the caret is, as typing
  over any range is. Outside an update the removal's update no longer
  ends before the text is typed with the tag on it, so the two contexts
  give the same document again: `TS18` now says so, and `TS19` pins the
  link (`TE82`, a document with no raw block, and `TE83`, a raw list).
  One route changes by it: `cut()`, the method, carried no tag at the
  parent either (the cut key's command does), and does not tidy; `TE71`
  has no `cut()` row among the joint rows for that reason.- **The plan's two classes of difference from Delete, then the route
  have more triggers than it names.** For that same shape the typed text
  is bold and Delete, then typing gives it plain (`**cd** xw text`): the
  plan's class "the format of typed and pasted plain text", which it
  describes for a range that starts at the very start of a formatted
  run; here the range starts after a space of the run, which the
  deletion's tidying then takes the format off. A paste of bold `zp`
  gives `**cd zp**` where Delete, then the paste gives `**cd** **zp**`:
  the plan's class "rules that run when an update ends". The wide
  probe's ranges start in no such place, so its count of cells outside
  the classes is zero for the places it holds.
- **A tab takes the caret's format, and the removal sets that for typed
  and pasted text only.** Lexical's `INSERT_TAB_COMMAND` handler gives
  the tab the selection's format. After Delete a browser's selection
  change gives the caret the format of the text it stands in; the guard
  does that for typed and pasted text (the plan's
  `$removeGuardedRangeBeforeText`) and not for Tab, at the parent's two
  shapes either. It shows where the caret lands at the start of inline
  code: Tab over `TE56`'s range puts the tab before the code, where
  Delete, then Tab puts it inside (`` `⇥code` ``). `TS16` pins it. It is
  one more member of the plan's class "the format of typed and pasted
  plain text".
- **A typed character that completes a typing shortcut is two undo
  steps.** `---` and `after word`, with the range from inside the break
  to inside the word and a space typed in a browser's way: the removal
  shows the raw block as the paragraph `-ter word`, the space makes it
  `- ter word`, and the list shortcut then applies as an update of its
  own, as it does for any typed shortcut. One undo gives `\- ter word`,
  a second the source. The parent, which typed into the raw block, took
  one. The document is what Delete, then the space gives. The plan's
  rows type `x`, which completes no shortcut. Row `TU1`; sign-off 8.
- **A typing shortcut ran after a deletion.** At the parent a deletion
  that left the caret right behind text reading as a typing shortcut
  applied the shortcut, as a second update: `a \*x\*.b` with the `.`
  selected, Delete, gave `a *x*b` in italics, and one undo brought back
  `a \*x\*b`, not the document. With the caret at the joint (D2) the
  same happened after a range from a raw block was removed, where the
  parent's caret was at the block's end and nothing applied. The
  branch stops it for the removals it makes itself (D10, round 7) and not
  for the parent's case, which stays (`TY5`).
- **Lexical's Enter shortcut takes a caret behind a marker, typed or
  not.** `registerMarkdownShortcuts` has a second way in, a handler of
  the Enter key: with a caret at the end of a block's first text node,
  and that text reading as a list, heading, quote or fence marker, Enter
  makes the block that kind of block instead of starting a paragraph.
  It asks for a caret, so Enter over a selection never meets it, with a
  raw block or without. After a range is removed up to such text
  (`> \- w⏎>⏎> q2`, from after `\- ` on), Enter over the range starts a
  paragraph (`> \-` and an empty paragraph, as at the parent), and
  Delete, then Enter makes the quote a list item. It is one more case
  where the route differs from Delete, then the route, in none of the
  plan's classes: 192 cells of the wide probe's new blocks, row
  `TK7`, sign-off 13. Nothing was changed: the handler is Lexical's, the
  key is typed, and it is the same in a paragraph that never was a raw
  block.
- **Delete's update tidies a run's edge that a route would have moved
  away from.** `> a ~~s.~~ w…` and `ab **cd** ef`, with the range from
  after `~~s.~~` into the bold: Delete leaves struck `s.` right before
  bold `d`, and the run-edge rule, which judges a run's last character
  against the next character shown, takes the strikethrough off the
  `.` (`~~s~~.**d**`), although `~~s.~~**d**` would read the same.
  Tab, Shift+Enter and a new paragraph over the range put something
  between the two first and keep `~~s.~~`. It is the plan's class
  "rules that run when an update ends" (16 cells). The same
  rule is why Delete dispatched outside an update differs from the
  parent's there in 8 cells and equals the parent's Delete
  inside an update: the removal tags its own update (sign-off 5).
- **A character typed inside a source node replaces the node.** A source
  node (a task item's checkbox, inline HTML) is kept as written and
  takes no typing: with the caret set inside one, `- [x] next` and `Z`
  typed save `- Znext`, at the parent as here. Nothing was changed in
  that; the caret a re-read leaves is kept out of such a node (D2).
- **An update's listeners run when it is committed, and a command
  dispatched outside an update is committed by the next read.** A typing
  shortcut is an update its listener starts, so a harness that reads the
  document once after such a dispatch does not see it. The rows `TY`
  and `TK` and every harness of the fifth round read after flushing.
- **Where there is no place for the caret** (D2, *The fallback*), a
  route still inserts at the end of the block. No cell of the widened
  sweep and no shape of the wide probe reaches it; rows `TL1` to `TL3`
  and `SP7` do, by an edit inside one raw block.
- **A caret between the backslash of an escape and its character.** A
  range that starts right after a backslash and ends before text that
  opens with a character Markdown escapes joins the two as an escape:
  `> esc \` and `*e`, saved by the join as `\*e`, give `\\*e`, which
  shows `\*e`. The backslash that shows is written by the two together,
  and the caret is put before it (`TE73`); a mark put between the two
  would show after it. It is the one place where the mapping and a mark
  that reads the same differ (11 pairs of D2's table).
- **In a browser, a caret between two text nodes is Lexical's to
  resolve.** After Delete the removal leaves the caret at the start of
  the plain text that follows bold text (`TE66`: before ` next`). A
  browser's selection change then makes Lexical resolve that boundary to
  the end of the text before it, as for any caret between two text nodes
  in any block, so a character typed *after Delete* there is bold. Typed
  over the range, it is plain, by the format the removal gives the caret
  for typed text. This is the plan's class "the format of typed and
  pasted plain text", seen in the browser checks; the unit rows compare
  with the format of the text the caret is set in.
- **One of two spaces after a quote's marker shows, and a save trims
  it.** `> q1⏎>⏎> q2` and `end.  Next`, with the range from after the
  first `>` to before the two spaces: Delete leaves a quote whose text
  node reads ` Next`, saved as `> Next`. The parent's Delete gives the
  same tree and the same save (`adhoc/controls7-P.json`), and the checks
  that the save reads as shown and reloads to itself pass on both sides.
  It is why `TE60` and `TE61` have no `TJ` rows (D2).
- **A space that the joined line's marker takes.** A range from right
  after a quote's `>` to before *one* space leaves `> cd`: the space is
  the marker's now and shows nothing, so what is typed stands right
  before `cd` (`TE51`: `> xcd`). The parent typed into the raw text and
  gave `X cd`, the typed character making the space show. What Delete
  saves is the same on both sides, and the route is Delete, then the
  route; with two spaces one still shows, and it stays after the caret
  (`TE60`).
- **Tab over a code block of a list item** fails the viewer check with
  and without the range (the plan's Non-Goal): the matrix's four `E39`
  cells, as at the parent.
- **In the demo, the Tab key leaves the editor.** Nothing in the demo
  binds it, so M3 and M10 dispatch `INSERT_TAB_COMMAND` on the editor.
- **Lexical's `updateEditorSync … read-only context` warning** is logged
  when the source-mode toggle runs while a table selection is held. The
  stack is the commit's selection sync, not a range guard. The notes of
  the two plans before this one report the same warning.

### Round 7: the sixth review's four findings, and what was checked again

The sixth review (tip `5ca27085a`) found four blocking defects. The user
chose how each is closed; the code is in the commits of the code they
belong to, and nothing was redesigned. The commits are folded; the tip
before this round was `29f5cdb2c`.

| # | Finding | The rule as implemented | Where | Rows |
|---|---|---|---|---|
| B1 | A character committed by an input method or a dead key completed no shortcut on desktop WebKit | A removal the editor makes itself by a route that inserts no text completes no shortcut, and nothing else is classified as no typing: the three typing tags, `isTypedUpdate`, `caretTextGrew` and the tag on `cut()` are gone; `GUARDED_DELETION_TAG` is set by `$removeGuardedRangeAsDeletion` (the delete commands, the native cut, `cut()`, Enter, the paragraph and the line-break commands, the routes that insert no text) and the wrapper skips an update that carries it | the third code commit | `TY1` to `TY6` rewritten (112 rows; `TY4` has the composition commit and the replacement text), `TK6`, `TK8` |
| B2 | A caret in a list item or table cell that shows nothing went to the text of a neighbour | `$emptyBlockAt` gives the place in the item or cell itself, when the block shows something elsewhere and the source and the block agree on how many items (or tables) there are | the fourth code commit | `SP15`, `TE79` to `TE81`, `TC` rows of those |
| B3 | Typing over a guarded range dropped a link's mark elsewhere in the block, in a document with no raw block | `$removeGuardedRange` sets no `RUN_EDGE_TAG`; a route carries it if and only if it carried it at the parent | the first code commit | `TE82`, `TE83`, `TS18` rewritten, `TS19` |
| B4 | A tab between the words of a raw list item is a fallback shape that no doc or row named | named in the component page, the changelog, the fallback list above, and pinned | the docs and tests of the fourth code commit | `SP7` (7 rows), `TL5`; `SP8` and `TL4` say "earlier line or item" |

The repros of B1 to B3 now give the parent's result (B2: what Delete, then the
route gives); B4's is the fallback it is, pinned (`- a⇥b w⏎  > q⏎- b` with `QZ 7Y`: the
caret goes to the end of the block, where the parent kept it after `w`). The rows
that are red on the tip before the round: 45 of the 1,495 tests of the three files that changed fail on the code of `29f5cdb2c`: `SP15` 8, `TE79` to `TE81`, `TE82`, `TE83`, `TS18`, `TS19` 2, `TY4` 14, `TY5` 14 and `TK6`; `TY1` and `TK8` pass there, which the earlier rule covered, and `SP7`, `SP8` and `TL5` pin what the code did already (B4 is a statement of a fallback). On the parent `TY1` fails for every kind, and the rest of the typing-shortcut file passes.

*The read-only overlap.* The notes of
`markdown-editor-readonly-keyboard-selection` ("For the plans that
follow") list the regions both branches touch. This branch changes none of
`copy()`, `copyWysiwygSelection`, `refuseIfReadOnly` or the view restore:
its only edit to a method of the class is `cut()`'s body, and the class's
other hunks are in the module-level functions. It registers no command of
its own; every command its guards listen to is in
`READ_ONLY_REFUSED_COMMANDS` (the delete commands, `REMOVE_TEXT_COMMAND`,
`CONTROLLED_TEXT_INSERTION_COMMAND`, the paragraph, line-break and tab
commands, `PASTE_COMMAND`, `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND`,
`CUT_COMMAND`, `DROP_COMMAND`, `KEY_ENTER_COMMAND`, `KEY_BACKSPACE_COMMAND`
and `KEY_DELETE_COMMAND`), except `COPY_COMMAND`, which the read-only list
allows and whose table-edge listener only reads. The refusal runs at
`COMMAND_PRIORITY_BEFORE_CRITICAL`, ahead of every guard here. The methods
`cut()`, `paste()`, `insertImage` and `insertTable` refuse first. Rows
`TRO`: 5 shapes (`TE1` and `TE5`, a raw block into a rich word and into a
rich block's end; `TE30`, into a table cell; `TE31`, a table cell into a raw
block; `TE62`, a raw block emptied) by 19 routes, both
directions, in a read-only editor: the document, the root's children and
the selection stay as they were and `"readonlyedit"` fires. The update
listener of the shortcut wrapper reads no root, and the rule that
re-reads a raw block is a node transform, which does not run when a
read-only editor's view is put back.

*Advisories.* Fixed: the `Shift+Enter` limit at a table (the docs said
"does nothing"; the selection is removed with the table, no break: docs,
changelog, row `TX6`); the space that ends the text before a range goes
with it where nothing follows (the docs say so, and `TE58`'s name); the
literal `Math.max(length, 1)` of the places module is a named constant in
a helper (`ownBlocks`); `caretTextGrew` is gone with the rule it served.
Left, with the reason: D8's decline for a range from a raw block's start
into a table is not made (it needs a judgment of what follows the table
that is removed with the range, which no other decline makes, and so is a
change of its own); `cut()`, the
method, carries no run-edge tag as at the parent, so it does not tidy as
the cut key's command does (`TE71` has no `cut()` joint row).

*Found while checking, left.* A range inside one raw block that makes the
block read as a quote, with the caret right behind text that reads as a
shortcut, completes the shortcut (`TK6`): the parent's caret was at the
block's end there. It follows from D10's rule as chosen; the next plan
removes it.

*Checked again.* `npm run typecheck`, `typecheck:test` and `lint` are clean; `docs:api` gives no warning; `docs:llms:check` passes; `build:lib` builds. The full suite: 590 files, 20,761 tests pass, 2 todo, none fails (`r7/full-test2.json`, four workers); it was 20,591 before the round. Each code commit's source type-checks alone (the four commits, in archive copies).

- The route matrix and the cross-item grid (`ec-matrix-*`, `ec-grid-*`; 3,192 cells and 26,928 records): re-baselined on the new parent (`feature/nested-scroll-reveal`, which sits on a longer stack since 2026-10-12). Its results equal the old parent's cell for cell, so the fifth round's baselines were good. On the tip: 0 of 3,116 guarded cells fail, where the parent fails 1,148; no throw, no undo failure; both files equal the fifth round's tip cell for cell, since no shape of the matrix reaches the round's changes.
- The places probe (66,976 cells, one process): `placesdiff.py` hard checks none; equal to the fifth round's tip cell for cell (3,500 `emptyRaw` shape changes, as before), because the probe's raw blocks have no list item or table cell that shows nothing beside text.
- The wide probe, cut to the chunks 0 to 5 of 24 (75,584 of 303,360 cells, 74,304 guarded), on the new parent and on the tip: no throw (H1), no save the plan does not name (H2), no declined key that acted (H4), no save that fails to read as shown or to reload where the parent's passes (H5), no neighbouring block changed (H7). The lines that fail are all of two kinds. *The parent's own defect, as it was*: a deletion or cut in an ordinary paragraph completes a shortcut, so one undo is not enough (`H3 … [nor at the parent]`: 216 cells), and the control "Delete, then the route" completes one in its second step where the route does not (`H6`, 304 cells; 240 of them are cells unchanged from the parent). *The one shape that differs from the parent, D10*: a range inside one raw quote that leaves the caret right behind text reading as a shortcut (`H8` with `H3`: 45 cells of 3 scenarios, `TK6`). The fifth round had none of either, with its general rule. In the first chunk, before the Enter, line-break and paragraph routes were tagged (D10), 20 Shift+Enter cells were more, which is how the tag came to cover them (`TK8`).
- The fuzz, cut to two seeds of each family (601 and 1709 for the column paste and the table edge, both strict and not, 3,000 steps; the list edit, 1,500 steps; seeds 11 and 23 for the reviewer-7 fuzz, 3,000 steps): every file equals the fifth round's, record for record. Not run: the other nine seeds of the first four, the other three seeds of the reviewer-7 fuzz, the list edit without the blank-edge exemption, the widened sweep, the element-point sweep and the browser checks. The reason is the limit of three test processes at once and the time the full sizes take (the wide probe alone is 40 minutes a side one chunk after another). None of those reaches code the round changed but through the wide probe and the matrix, which ran.
- The rows beside that: `TRO`, the read-only rows (5 shapes by 19 routes, both directions).

### Checks

The numbers in this section and in the next four were measured on the
code of the fifth round, before round 7 changed three of the code commits;
*Round 7* above has what was run again.

From `packages/lib`, on the final code:

- `npm run typecheck`, `npm run typecheck:test`, `npm run lint`: clean.
- `npm test`: 559 files, 18,984 tests pass, 2 todo, none fails
  (`logs/r5-full-test.json`, three workers). The parent has 17,749 and
  the same 2. The 1,235 new ones are the new `describe` of
  `markdown-editor-command-crashes.test.ts` (90 to 911 tests: 78
  shapes, 141 route rows, 22 `TS`, 49 `TC`, 462 `TJ`, 10 `TG`, 8 `TP`, 4
  `TL`, 10 `TX`, 7 `TK`, 29 `TN` and `TU1`), the 330 rows of the new
  `markdown-source-places.test.ts` and the 84 of the new
  `markdown-editor-typing-shortcuts.test.ts`; `X14` and `R32` are
  restated in place.
- The two test files of step 2 run with no unhandled rejection.
- The branch's test files on the parent's source: 622 of
  1,327 tests fail: 578 of the crash test file (395 `TJ` rows, 83 shape
  and route rows, 44 `TC`, 23 `TN`, 14 `TS`, 8 `TX`, 7 `TP`, `TK5`,
  `TK7`, `TG8` and `TU1`), `X14`, `R32`, and 42 of the typing-shortcut
  file, `TY1`, `TY4` and `TY5` for every kind
  (`logs/r5-tests-on-parent.json`). The places file needs the new module
  and cannot run there.
- Each code commit alone type-checks, and the test files it changes
  pass on it: 761 tests on the first (three files), 607 on the
  second, 548 on the third (`logs/r5-own-cA.json`, `-cA2.json`,
  `-cS.json`), and the whole suite on the fourth. The final crash test
  file run on the first commit has 434 rows failing, on the second 420
  and on the third 419: 382 `TJ` rows, the shape rows of D2's shapes,
  `TP2` to `TP8`, `TL4`, `TS16` and `TS17`
  (`logs/r5-final-on-cA.json`, `-cA2.json`, `-cS.json`). The 14 more on
  the first are D8's; the one more on the second is `TK7`, whose second
  half needs D10.
- The rows of the fifth round on the code of the fourth review
  (`cff0ddee0`): 159 of 1,325 fail
  (`logs/r5-final-on-r4tip.json`): `TK1` to `TK7`; 20 of the 29 `TN`
  rows (the nine that pass there are the four of a point on a table part
  and five where the old removal happened to give the range of text's
  result); `TE76` and `TE77` with 18 of their `TJ` rows; `TY1`, `TY4` and
  `TY5` for every kind; and 70 rows of the places file (56 of `SP13`,
  `SP14`, four of `SP5`, `SP10`).
- Single changes of the new code, each run against the crash, the
  table-edge, the places and the typing-shortcut test files
  (`r5/mutate.py`, `r5/mutants.json`). The seventeen of the round
  before are caught as they were, some by more rows now (*D8*: a blank
  raw block left a raw block; Shift+Enter not declined ahead, nor over
  all a raw block holds. *D2*: the blank rule taken out; the end of
  the first of two text nodes taken whatever the format; a source node
  not giving way; only a line end ending a block; a place given though
  a unit after it has no source, or though the sources are out of
  order; a code span's characters all at the span; a cell's paragraph
  break not passed over; a raw block that no entry stands for not
  found by its lines; a link text with an escaped bracket left without
  source; a block read without the definitions before it; a source
  node's characters all at its span. *The first commit*: the call of
  `$keepAsEditorSelection` taken out). The one that had no row has
  none now: a place given for an offset inside the source of several
  characters that share it, kept as a guard. `$isPlainlyRemovedRange`
  and the update tag taken out (`TG9`, `TS18`) were not run again;
  neither is changed. Of the fifth round:
  every update counted as typed (`TK1` to `TK7`, `TY1`, `TY4`, `TY5`); an
  update with no tag counted as typed whether its text grew or not
  (`TY5`); the typing tag not winning over a removal's (`TU1`); a
  composition's end not counted (`TY6`); the delete commands not tagged
  at the editor's priority (`TK6`); `cut()` without its tag (`TK6`); a
  drop's or a paste's input event not tagged (`TY4`); a place inside a
  source node left there (55 rows, `TE77` among them), or always moved
  to the node's start (43 rows); a source node that shows nothing being
  no unit (`SP5`, `SP10`, `SP13`); `$removeGuardedRange` not settling an
  end on a container (14 of the `TN` rows); the commands not settling it
  (`TN12`, `TN13`, `TN19`, `TN20`); a table-edge range settled too
  (`TN21` to `TN24` and seven rows of the table-edge file). Three have no
  row, and are kept for these reasons. The blank rule moving what is no
  text: since the caret is kept out of source nodes, the place comes
  out the same, so the condition the review asked for cannot be told
  from outside the mapping; it stays, as the rule. The listener that
  settles the selection a paste of nodes carries: the removal settles
  the same range itself, and the listener is there so that every
  command of the list has one. The step that keeps a caret counted
  from the block's start out of a source node: no shape was found that
  reaches it, since the text before such a caret has to show as
  written. A fourth, a tag of the editor's own for the command that
  inserts pasted nodes, had no row either, and was taken out: that
  command is only ever dispatched inside an update, where the run-edge
  rule's tag marks it.
- `npm run docs:api`: no warning. `npm run docs:llms:check`: coverage OK.
  `npm run build:lib`: builds.
- The greps of steps 3, 6, 10 and 11 give what the plan says.

No demo was added: the demo's MD Editor page already shows every block
this plan touches, and no public signature changed.

### The differential check

Four harnesses, each run on a private copy of the parent and of the
branch's final source (`runall-final.sh`, which runs them and the fuzz in
turns of three test processes, the most the machine allowed; the results
are `diff/*-P*.json` and `diff/*-c5.json`). The copy was made of
`213577173`, a commit of the work in progress that is not on the branch
any more. The tip's source differs from it in comments, and in one
listener taken out afterwards, which set a second tag on an update that
always carries the first (D10, and *Checks*). The wide probe, the two
sweeps and the test suite were run again on the tip's source: the wide
probe's 303,360 cells are the same, cell for cell (`diff/wide-c6.json`).

| Harness | Cells | Parent: guarded cells failing | Branch | Hard checks |
|---|---|---|---|---|
| the route matrix of the plan (`zz-rbr-probe.test.ts`, `rbrdiff.py`) | 3,192; 3,116 guarded | 1,148 | 0 | none failed |
| the cross-item grid (`zz-cir-probe.test.ts`, `griddiff.py`) | 26,928; 10,404 with an end in a raw block or code block | — | — | none failed |
| a raw block at every place (`zz-ec-places.test.ts`, `placesdiff.py`) | 66,976 records | — | — | none failed |
| the wide probe (`zz-re-wide.test.ts`, `widediff.py`) | 303,360; 297,344 guarded | 79,458 | 0 | none failed |

**The matrix.** 1,156 cells differ from the parent: the 1,148 that failed
there, and the eight of D2 (the caret alone). No Delete or Backspace cell
differs in any field. One undo restores every cell, nothing throws, and
the four cells whose save does not read as shown are Tab over `E39`, as
at the parent.

**The grid.** 867 cells differ from the parent: the 861 the plan gives,
of the 10,404 with an end in a raw block or code block, and six of D8
(`INSERT_PARAGRAPH_COMMAND` over a range that empties a raw block: the
save is the same, and the emptied block is a paragraph). 18 cells fail a
check on both sides alike (the tab in a code block of a list item).

**The places probe.** 3,500 records differ from the parent, all of one
edit, the one that deletes all a raw block holds: the save is the same
and the shape is D8's, an empty paragraph where the parent kept a raw
block of no text. The parent fails the probe's reload check in each of
them, and the branch passes it. Every other field of every record is the
parent's.

The three are byte for byte the results of the run before the fifth
review (`diff/*-c3.json`): none of them holds a shape the fifth round
changed.

**The wide probe**, as it was: nine kinds of raw text (a closed HTML
block, a comment, a `<pre>` holding an empty line, a thematic break, a
definition, a quote of two paragraphs, a tight list holding a quote, a
table whose body row is longer than its header, an HTML block a blank
line ends), each beside eight kinds of other block (a paragraph, a level
3 and a level 1 heading, a quote, a list item, a code block, a table
cell, another raw block), in both orders, with and without a block after
them, the range from four places in the raw block to three in the other
block; and five of the raw texts as a block of a list item or of a `:::`
column, in seven arrangements: 3,980 scenarios.

What the fifth review asked to be added, 760 scenarios more:

- *Text before the joint that is escaped syntax, or that reads as a
  typing shortcut* (564 scenarios): 25 texts — escaped emphasis and
  strong text with `*` and with `_`, strikethrough, inline code,
  underline, a link, the three bullets, a list number, two headings, a
  quote marker, two task markers, a fence, two thematic breaks; and bold,
  italic (both spellings), inline code and strikethrough as real
  formatting that ends at the joint — each as a raw quote's first line
  and as a raw list's, with the range to three places in a paragraph,
  in a paragraph that holds bold text and in a list item; inside one raw
  block; in an HTML block; and as a paragraph's own text, with the range
  into an HTML block and into a raw quote after it.
- *Task items* (48): the joint right after the checkbox and its space,
  in the first item and in a later one, in an ordered list, with an
  upper-case `X`, and between the checkbox and its space.
- *An end held as a point on a container* (148): a raw block, a raw
  quote and a code block before and after a list, a `:::` block, a
  table and a list item of three blocks, the point on the list, an
  item, the block, a column, the table, a row, a cell and the document.

159 scenarios are left out and listed by the probe: their raw text joins
a neighbour at load (a raw list before a list item, for the most part).
Each scenario runs in both drag directions through the 19 routes in both
dispatch contexts. For every cell it records what the route gives, what
Delete gives, and what Delete and then the route give: the save, the
tree, the caret, the parity and reload checks, one undo, what one undo
left where it did not restore, and the text that follows the caret.
Every value is read after the editor's pending updates are flushed.

| Hard check of `widediff.py` | Cells |
|---|---|
| a throw | 0 |
| Delete or Backspace saves another document than at the parent, or another tree, outside the four named changes below | 0 |
| one undo does not restore, **Delete and Backspace included**, whatever it does at the parent | 0 |
| a route other than Shift+Enter that acted at the parent does nothing | 0 |
| the save does not read as shown, or does not reload to itself, where the parent's own document or the control's does, Delete and Backspace included | 0 |
| a route differs from Delete, then the route, outside the classes below | 0 |
| the block after the range is saved differently than in the control | 0 |
| a range inside one raw block saves another document than at the parent, but where the parent completed a typing shortcut | 0 of 3,200 |
| a cell that is not guarded differs from the parent | 0 of 768 |

The check of the save reading as shown cannot be absolute: a document
that still holds a raw quote, list or table shows its source where the
viewer shows the blocks, at the parent as here (9,127 cells whose
document is the parent's own, 5,163 the control's).

Counted, and read by class. Delete and Backspace against the parent:

| Class | Cells | What it is |
|---|---|---|
| an empty paragraph where the parent left a raw block of no text, the save the same | 2,464 | D8 |
| the parent completed a typing shortcut after the removal: two undo steps there, and its document one undo back is the branch's | 912 | D10: a paragraph that ends in escaped syntax, the range from there into a raw block |
| the same inside one raw block | 264 | D10 |
| an end held as a point on a container: the parent gave another document, or threw | 284 | D11; the element-point sweep compares these with the range of text |
| outside an update the document is the one the parent's Delete gives *inside* an update | 8 | sign-off 5: the removal tags its update, so the block is tidied in both contexts (*Found along the way*) |
| the caret elsewhere, the document the same | 2,712 | D2: at the joint, where the parent had it at the block's end |

The other routes, against Delete, then the route:

| Class | Cells | What it is |
|---|---|---|
| Shift+Enter declined now, where the parent removed the selection and added no break | 1,770 | the plan's second changed result, and D8 for a range from a raw block's start |
| … where the parent also completed a typing shortcut | 110 | D10 |
| … where the parent's break showed as a space | 144 | D4 |
| … where the parent read an end held as a point on a container otherwise | 28 | D11 |
| Shift+Enter declined on both sides | 1,052 | unchanged |
| a paste of blocks from a level 3 heading into a raw block keeps the raw block's line ends as breaks | 216 | the plan's pinned class (`TS5`, `TS15`) |
| Enter over the range starts a paragraph; Enter after Delete is taken by Lexical's Enter shortcut | 192 | *Found along the way*, `TK7`, sign-off 13; 160 of them as at the parent |
| Tab's format beside inline code | 24 | the plan's class "the format of typed and pasted plain text" (`TS16`) |
| the same text, another format at a run's edge | 16 | the plan's class "rules that run when an update ends" (*Found along the way*) |

An end held as a point on a container, where the range read as text is
a caret (512 cells) or lies inside one block (1,536), is not guarded:
the probe's control does not apply to it, and the element-point sweep
(D11) compares those cells with the range of text. Nothing throws in
them but a caret's Delete, which needs a browser's selection (36).

No route but Shift+Enter does nothing anywhere. After Delete, Enter and
typing, the text that followed the range's end follows the caret in
every cell that can be measured (8,376 or more each).

The probe before this one was blind in three ways the fifth review
named, and one it did not. Its blocks ended in a plain word, *because* a
caret left right after `*x*` fired the typing shortcut between the
control's two steps; its undo check skipped Delete and Backspace, and
for the other routes asked for one undo only where the parent had it;
and it read each value once, which after a command dispatched outside an
update is before the shortcut's own update is committed. With the four
mended, the code of the fourth review (`cff0ddee0`) fails it where the
review said. Over the 760 added scenarios, 43,392 guarded cells, it
throws in 712, Delete or Backspace saves another document than the
parent in 516, one undo does not restore in 4,581, and a route differs
from Delete, then the route, outside every class in 6,323
(`r5/widediff-old5.txt`).

### The widened sweep

The fifth review found that the sweep took `*`, `_`, `~` and
backslashes out of what it compared, so that escaped text turning into
formatting looked the same to it. It was written anew
(`r5/zz-r5-sweep.test.ts`, `r5/runsweep.sh`, `r5/sweepan.py`), and
compares nothing with anything taken out:

- 18 raw blocks: the 13 of the sweep before (six raw quotes, four raw
  lists, a raw table, two HTML blocks), and five for the review's
  classes: quotes whose first line holds escaped emphasis, escaped
  strong text, an escaped bullet and an escaped list number, and a list
  of task items.
- The range starts at *every* offset of the raw block's text and ends
  after `ab` in a paragraph after it, whose rest is one of 16 tails (the
  14 of before, and two that hold formatted text after a space).
- Six routes: Delete and Backspace (where the caret stands, the saved
  document, one undo), typing in an update, typing dispatched outside
  one, typing after a Delete in the same editor, and a paste of a bold
  node; each with the range made forward and backward. 85,056
  cells in 14,176 groups of one range. Every value is read after
  the editor's pending updates are flushed. The parent was run through
  the same sweep.

| Check | Groups |
|---|---|
| Delete's saved document is the parent's, byte for byte | 14,154 |
| … or the parent's one undo back, where the parent had completed a typing shortcut after the removal (D10) | 22 |
| Backspace's: the same two counts, and Backspace equals Delete in every group | 14,154, 22 |
| one undo does not restore Delete or Backspace | 0 |
| typed, typed outside an update, typed after Delete, pasted: the line shows the same text on each side of the inserted letter as on each side of Delete's caret | 14,158 of 14,176 for typing in an update |
| the three typed routes save the same document | 14,174 of 14,176 |
| a group outside every class below | **0** |

The groups where an inserted letter shows other text around it than
Delete's caret has, each told by an exact condition:

- 16: the range starts inside `<div` of an HTML block, and the letter
  makes the text no HTML block any more (`<divΞ`), so the block shows
  as a paragraph and the joined text as formatted; Delete leaves a raw
  block there.
- 2: the range starts at the start of the raw block's last line and
  nothing follows it. Delete's update drops the line break that then
  ends the block; a route that inserts in the same update inserts after
  it. The plan's class "rules that run when an update ends".
- 2, a paste only: the joint is beside inline code, where the pasted
  bold letter is written with its asterisks as text; the text around
  them is Delete's.

Where the caret is, for each group, by what Delete leaves and the typed
document holds, told one of these exact ways:

| The caret is at the joint, told by | Groups |
|---|---|
| the text the line shows after the caret is what the later block showed after the range's end, and the text before it is the raw line before the range without its block marker, both character for character | 6,962 |
| the text after the caret, so told | 2,860 |
| the text before the caret, so told | 4,240 |
| the typed document holds the raw text before the range, then the letter | 34 |
| as the first, but for blanks at the joint that the joined line does not show (a marker or a line's start takes them, a block's end trims them) | 20 |
| the range starts right after a backslash, which escapes the first character the later block brings: the typed document holds the raw text before the backslash, then the letter, then the escape (`TE73`) | 54 |
| the range starts inside the address of a link the two halves make: the letter stands right after that link (`TE72`) | 4 |
| the head ends with a backtick and the later block's rest opens with one: both show as text of the code the two halves make, and the caret is between them (`TE74`) | 2 |
| none of these | **0** |

The same sweep over the code of the fourth review (`cff0ddee0`) fails in
five checks: one undo does not restore Delete in 117 groups and Backspace
in 117, Delete saves another document than the parent in 95, the typed
letter shows other text around it in 157, and 11 groups have the caret
in none of the classes. So it sees both of the review's classes
(`r5/sweepan-sOld.txt`).

The first run of this sweep found two things the fix made for the
review had left. In 22 groups the parent's Delete saved another
document than the branch's: an HTML comment holding `**b.**`, broken by
the removal, becomes a paragraph of text, and the parent then made the
`**b.**` bold, by the typing shortcut, as a second step; the "bold" was
the parent's defect, and the condition above counts it. And typing at a
joint between a task item's checkbox and the space the tail gives it
(`- [x]`│ and ` next`) lost the checkbox: the caret was inside the
checkbox's source node, where a typed character replaces the node
whole. The mapping now never leaves the caret inside a source node (D2).

The sweep's raw blocks cannot hold the fallback's shapes after the
caret, since the range takes all that follows its start in the raw
block, and a tail is joined as the Markdown the editor writes, which
holds none of them: `TL1` to `TL3` and `SP7` pin those, by an edit
inside one raw block.

### The fuzz

The edge-cases implementer's harnesses, run on private archive copies
(`runall-final.sh`), against that run's results (`fuzz-b6/`, `lif-b6/`,
`r7-b6/` in its folder). `cmpfuzz2.py` and `r7cmp.py` compare record by
record; `fuzzreplay.py` replays each side's records on the other side.

| Fuzz | Seeds, size | Baseline | Branch |
|---|---|---|---|
| paste (`column-paste-fuzz`), and strict | the 11 seeds, 3,000 each | 0, 0 | 0, 0 |
| table edge (`table-edge-fuzz-lbdeclined`), and strict | the 11 seeds, 3,000 each | 0, 0 | 0, 0 |
| list edit (`lif`) | the 11 seeds, 1,500 each | 1 | 1 |
| reviewer 7 (`r7`) | seeds 11, 23, 37, 41, 59, 3,000 each | 88 | 89 |

The run is `fuzz-c5/`, `lif-c5/`, `lifx-c5/` and `r7-c5/` in the scratch
folder, all 44 paste and table edge files, 11 list-edit files and 5
reviewer-7 files of it, made at the same commit as the differential
(above).

**List edit.** The one record is the baseline's, field for field: seed
7703, document 196, `load:canonical`, the tab-indented definition of the
edge-cases plan's Non-Goal. Replayed, it fails the same check on both
sides. The run without the fuzz file's exemption (`lifx-c5/`) is the
same. One count of that seed differs from the run before the fourth
review: of the steps that type into a raw block, one more found no raw
block to type into, an emptied one being a paragraph now (D8).

**Reviewer 7.** 86 of the 89 records are the baseline's, byte for byte.
Each side's records were replayed on the other (`replay-ecb6-b3.json`,
made of the third run, whose reviewer-7 files are byte for byte the
last run's):
all 88 of the baseline fail the same way on the branch (68 `linesMerged`,
19 `lettersLost`, 1 `parity`), and 88 of the branch's 89 fail the same
way at the parent.

- Two records are baseline records written differently (seeds 23 and
  59, `linesMerged`): the same source, steps and failing check. In the
  first an earlier step of the record, a paste over a range, left a list
  where the parent left paragraphs. In the second the tree holds one
  empty paragraph more, which Enter over a range from a raw list now adds
  after the removal; the save is the same.
- One record is new and passes at the parent: seed 59, `rangeEnter`,
  `linesMerged` of `m9` and `u2`. The document is a definition
  `[dup]: /first` and a raw list; Enter is pressed over the range from
  before the `t` to the start of the list's line `  3. w8`. The parent
  broke the line in the raw text and read it once: a definition, and the
  list item `3. w8` with its two blocks. The branch removes the range
  first, as Delete does, and the joined text `[dup]: /firs  3. w8` with
  the indented lines under it reads as a paragraph and an indented code
  block, which holds the two lines the fuzz names; Enter then splits the
  paragraph. Delete alone gives that code block at the parent too, and
  Delete, then Enter gives the branch's document there
  (`adhoc/controls5-P.json`). So the record is the plan's contract for
  Enter, not a miss of it; it is sign-off 2.

The fuzz was run eight times. On the plan's code as printed the reviewer-7
count was 93: five new records, all Enter over a range, four of them the
caret of D2. After D2's first form it was 90, with the record of a caret
inside a quote's marker (`TE51`) still there; after the rule for spaces
89. The five runs after it, one for each of the three later reviews'
fixes and two as D2 was rewritten, the last of them on the final code,
give the same records: the reviewer-7 files are byte for byte that
run's in each, and the list-edit files but for the one count above (the
eighth run's list-edit and reviewer-7 files are byte for byte the
seventh's). The table edge and paste results were the same in every
run.

### The manual checks

Run in Chrome on the demo's MD Editor page (`npx vite --port 8053` in
`packages/lib`; the server is stopped). Each document was put in through
source mode. The selection was set through the page's selection, and
keys were real key events. What a script stood in for is said in each
row: the browser automation here has no IME, no drag of a text selection
and no system clipboard holding a table.

| # | Result |
|---|---|
| M1 | the raw block ends `raxh **ij** kl [a](u) \*x\*`; the source reads `<div>⏎raxh **ij** kl [a](u) \*x\*⏎⏎after` |
| M2 | one undo: the document and the selection are back |
| M3 | Shift+Enter, Ctrl+X and Ctrl+Backspace keep the backslashes, and one undo restores each (Ctrl+V after the cut is a second step). The Tab key leaves the editor in the demo, so `INSERT_TAB_COMMAND` was dispatched on the editor: the tab stands after `ra`, backslashes kept, one undo. `DELETE_LINE_COMMAND`, which cannot run offline, was dispatched the same way: it removes the range as Delete does |
| M4 | **by hand still.** A `compositionstart` event fired over the selection removes it as in M1 and puts the composition's seat after `ra` in the raw block, backslashes kept, no console message. The commit of composed text needs a real input method |
| M5 | stood in for by the two `beforeinput` events a drag fires (`deleteByDrag`, then `insertFromDrop` with the dragged text at the end of `after`): the selection is removed as in M1, the text lands after `after` |
| M6 | a `paste` event carrying `<b>bold</b>`: `bold` goes in as plain text after `ra`, the same for the selection made backward and forward |
| M7 | two paragraphs, `<` and `fter` |
| M8 | one paragraph: `<`, a break, `fter` |
| M9 | one paragraph `<`, no break |
| M10 | (`INSERT_TAB_COMMAND` dispatched) a paragraph holding the tab and `w text`, a raw block `</div>`; no code block |
| M11 | one raw block reading `<p>⏎raw text⏎</div>` |
| M12 | the table copied from another document through a `copy` event, pasted through a `paste` event: `- ab`, the table, `- kode`, for the selection made backward and forward |
| added, D1 | `<!-- c1⏎c2 -->`, `after`, `more`; the selection from `<!-- c`│ to `a`│`fter`; a paste of `<b>bold</b>`: a paragraph `<!-- c`, bold `bold`, `fter`; nothing thrown |
| added, D2 | `> a **Note:** w⏎>⏎> q2` and `ab next`; the selection from after `**Note:**` to `ab`│. Typing `X`: the source reads `> a **Note**:X next` (the `X` before the space; the colon leaves the bold text because Markdown cannot close bold between a colon and a letter). The same selection made backward, a paste of `<b>ZP</b>`: `> a **Note:ZP** next`. `> q1⏎>⏎> q2` and `end.  Next`, from after the first `>` to before the two spaces, typing `x`: `> x Next`. `> q1 w⏎>⏎> q2` and `ab [a \[b](/u) c`, from `> q1 `│ to `ab`│, typing `x`: `> q1 x [a \[b](/u) c`. ``> a `co w⏎>⏎> q2`` and ``abde` x``, from after `co` to `ab`│, typing `x`: inline code `coxde\` |
| added, D8 | `<div>⏎raw text⏎</div>`, `after`, `last`; the selection from the raw block's start to the end of `after`. Shift+Enter: nothing changes. Delete: an empty paragraph holding the caret, then `last`. A paste of `<b>ZP</b>` there: `**ZP**⏎⏎last`. The selection of all the raw block holds: Shift+Enter changes nothing; typing `y` gives a paragraph `y` |

| added, D10 | Typed `para`, then ` *x* y`: `x` is italic (`para *x* y`); `x` selected and `- item` typed: a list item. So a browser's own typing completes a shortcut. `> a \*x\* w⏎>⏎> q2` and `ab cd`, the selection from after `\*x\*` to `ab`│: Delete leaves the quote `a *x* cd` as text (`> a \*x\* cd`), `x` typed after it gives `> a \*x\*x cd`, and Ctrl+Z twice brings back the document and the selection, one step for the Delete. Backspace, Ctrl+X and Ctrl+Delete over the same selection save the same document. The review's other shapes, Delete: `> \-  cd`, `> \#  cd`, `> 1\.  cd`, `> a \*\*Note:\*\***d** ef`, and inside one raw block `> a \*x\*q2`. In a paragraph, a caret and a real Backspace: `a \*x\*.b` gives `a \*x\*b`, `\- .cd` gives `\- cd`. Delete, then a paste of `<b>ZP</b>`: `> a \*x\***ZP** cd`. `a \*x` and a pasted `*`: `a \*x\*`, text |
| added, D2 (the checkbox) | `- [x] ta⏎  > q⏎- [ ] tb w` and `ab cd *ef*`, the selection from after `- [x] ` to `ab`│: `x` typed gives `- [x] xcd *ef*`; Delete, then `y`, gives `- [x] ycd *ef*`. With `ab next` and the selection from after `- [x]`: Delete, then `z`, gives `- [x] znext` |
| added, D11 | A selection set through the page from `r`│`aw` in a raw block to the list element at offset 0 arrives in the editor as a range to the start of the first item's text: Lexical resolves a DOM point on a list forward. Delete gives `<div>⏎rla⏎⏎- lb⏎⏎after`. A point set in code on the list node is resolved the same way as soon as the browser's selection is read again, so D11's settle is met only by a command that runs in the update that set the point (sign-off 12) |

The checks were run eight times. M1 to M12 and D1 were all run four
times, the last time on the code as it stood before the fourth review;
the range removal they exercise is that code's but for D8. The last
three runs, after D2 was rewritten and after each of its two later
steps, were of the rows that type or paste after a removal: M1, M2 (the
fifth run), M6, and the rows "added, D2" and "added, D8" above, the last
run on the code before the fifth review. The eighth run, on the final
code, was of the rows "added, D10", "added, D2 (the checkbox)" and
"added, D11" above. No console message in any of the four.

One thing the fifth run showed is under *Found along the way*: after
Delete, a browser resolves a caret between two text nodes to the end of
the first.

M4 and M5 are not the checks the plan asks for. M5's stand-in fires the
events a drag fires, in the order a browser fires them, and the editor's
handlers are the ones a drag reaches; M4's covers the removal and not the
commit. Both are sign-off 6.

### Decisions that await the user's sign-off

**1. The caret keeps its place when a raw block shows as its blocks
(D2).** Commit "Keep the caret's place when a raw block shows as its
blocks", with its docs in a commit of their own. It changes where the
caret stands after Delete over such a range, and after an ordinary edit
that makes a raw block show as its blocks: the document is the same, the
caret is where the edit was. Without it the plan's code is in force: for
a selection that starts in a raw quote, list or table that then shows as
rich text, typed and pasted text and Enter's split go to the end of the
paragraph. Four things in it are choices:

- *The mechanism.* The place is computed from source offsets, by a new
  module that uses the source analysis of source mode from the WYSIWYG
  side, and `contentOffset` is exported from that analysis for it. The
  reason is in D2 and in the plan's *Architecture Decisions* (D9).
- *The rule and what it restates.* The caret is at the joint and nothing
  the blocks show changes sides. `TE60` and `TE61` now expect `> x Next`
  and `> x cd`: the space that shows stays after the caret.
- *The conventions* where the place is between two things (D2): the
  format the offset has in the source; a source node gives way, and the
  caret is never inside one; a block ends at a line end, a cell's `|`
  or a cell's paragraph break; an offset inside the source of one thing
  shown is before it.
- *The fallback.* The end of the block, in four shapes the docs name
  (D2; the fourth, a tab between the words of a list item's text, was
  found by the sixth review). The other choice for a line a tab indents and for a task item's
  checkbox followed by a tab or by two spaces is to find their source
  too, as was done
  for a link text holding an escaped bracket; both are the lexer
  rewriting the text, a tab into spaces of which some show.

To decide against D2, drop the two commits; the shapes `TE45` to `TE49`,
`TE51`, `TE53` to `TE61` and `TE66` to `TE78`, their `TJ` rows, the `TP`,
`TL` and `TK` rows, `TS16`, `TS17` and the new test file go with them.

**2. Enter over a range from a raw block is Delete, then Enter.** This is
the plan's own decision; it is listed because the fuzz found a document
where a reader may prefer what the parent did. The parent put a line
break into the raw text at the joint and read the text once; the branch
reads the joined text first, as Delete does, and then splits at the
caret. For `[dup]: /first`, then a raw list, with the range from before
the `t` to the start of the list's line `  3. w8`: the parent gave a
definition `[dup]: /firs` and the list item `3. w8` with its two blocks;
the branch gives two paragraphs, `[dup]: /firs` and `3. w8`, and the two
blocks as one indented code block, which is what Delete and then Enter
give at the parent too. The other choice is to keep a line break at the
joint for Enter alone, as the plan's first version did; the plan's row
for `TE7` (`<⏎⏎fter`) would then go back to `<⏎fter`.

**3. The selection is the caller's again (D1).** Part of the first code
commit; without it three routes throw.

**4. Rows beyond the plan's (D3), and the fourth Shift+Enter change
(D4).** D4 follows from the plan's formula; the other choice is to remove
such a range and let the break show as a space, as the parent did.

**5. The update tag on the removal** (*Found along the way*). The plan
tags the removal's update; the branch does not (round 7), because the
sixth review found the tag strips a link's mark when typing over a range
in a document with no raw block. What this gives: a route carries the
run-edge tag if and only if it carried it at the parent; typing, the
composition's start and Tab over a range are tidied where the caret is;
and typing gives the same document inside an update and outside one.
The notes' earlier sentence, that no probed result inside an update
changes with the tag, was true of its twelve shapes and not of a link
followed by a letter. The other choice is the plan's, to tag the removal:
then `TS18` and `TS19` change, and a document with no raw block differs
from the parent for typing and Tab over a range. Row `TS19` pins the
choice; `TS18` and `TE71`'s missing `cut()` row follow from it.

**6. M4 and M5 by hand.** M4 (an input method over the selection) could
not be run here past the composition's start, and M5 (a drag of the
selection) was stood in for by its two input events. Both want a hand on
a real browser, or the user's word that the stand-ins do.

**7. The docs text that is not the plan's (D5):** the sentence on
Shift+Enter in the changelog's first entry (and, from round 7, the sentence
there and on the component page on a selection from a raw block's start
into a table), the two entries after it, and the sentences on the
component page.

**8. A typed character that completes a typing shortcut is two undo
steps** (*Found along the way*, row `TU1`). The plan says one command is
one undo step; this keystroke is the typing and, as an update of its
own, the shortcut it completes, in the paragraph the removal leaves. It
is what the same key gives after Delete. The other choice needs the
shortcut to run inside the typing's update, or not to run for text
typed over a range, which is a change to the typing shortcuts.

**9. A raw block left holding nothing shows as an empty paragraph
(D8).** Commit "Show a raw block that holds nothing as an empty
paragraph", with its docs in a commit of their own. Three things in it
go past what the fourth review reported:

- It holds for every way a raw block is emptied, also a selection inside
  the one block, where the parent left the same raw block of no text.
  The rule is at the place the other raw-block rules are, so no route
  can leave one. The other choice is to apply it inside the range
  removal alone.
- A raw block holding blanks alone (a tab, a line break) becomes a
  paragraph holding them, since a save writes nothing for it either.
- Shift+Enter is declined over a range that would empty its raw block
  with nothing to follow, and over a selection of all one raw block
  holds. The first is what the parent did; the second left a raw block
  holding the break at the parent.

An emptied code block is unchanged: it stays a code block, which
Markdown writes.

**10. In a browser, a caret between two text nodes after Delete is at
the end of the first** (*Found along the way*). It is Lexical's
resolution of any such caret, so a character typed after Delete at the
joint behind bold text is bold, where the same character typed over the
range is plain. Nothing was changed for it; it is the plan's class of
format differences, and it is listed because the browser checks are
where it shows.

**11. A removal the editor makes itself completes no Markdown typing
shortcut (D10).** Commit "Complete no typing shortcut after a removal the
editor makes itself" (the commit's title says what it does), with no docs
commit: against the parent it changes nothing a user sees. It keeps the
caret that D2 puts at the joint from turning escaped text into formatting.
The editor outside the plan's ranges is changed in no way but:

- A range the editor removes itself (from a raw block or a table out into
  other blocks) by Delete, Backspace, a word or line delete,
  `REMOVE_TEXT_COMMAND`, a cut, `cut()`, Enter, the paragraph command or
  a line break completes no shortcut.
  Everything else is as at the parent, and so is its defect: a deletion
  in an ordinary paragraph, or one Lexical makes inside a raw block, can
  complete a shortcut (`\- .text` with the `.` deleted becomes a list
  item, as a second undo step). The general rule, with a tag for typing,
  is the next branch's plan; this commit leaves nothing it would have to
  work around but one tag and its helper.
- One shape differs from the parent: the range inside one raw block that
  makes the block read as a quote with the caret right behind text that
  reads as a shortcut (`TK6`, D10).
- The fifth round's rule (typed text only, `isTypedUpdate`, three tags)
  is gone. The sixth review found it blocked a character committed by an
  input method or a dead key on desktop WebKit, where Lexical sends the
  event rather than a string.

**12. An end held as a point on a container is read as a point in text,
inward (D11).** Part of the first code commit. Three things in it are
choices:

- A range end before a list's first item is read as the end of the
  block before the list, so nothing of the list is in the range and its
  first item's text is not joined onto the raw block. That is how the
  block commands settle such an end, and what the parent's routes that
  did not throw gave. The other reading is the one a browser gives a
  DOM point there: the start of the first item's text, which joins that
  text onto the raw block. In a focused editor the browser's reading
  wins by itself: Lexical resolves the selection anew from the DOM, and
  the point is in text before a key arrives (seen in the browser check).
  The settle acts where a command runs in the update that set the point.
- A declined command leaves the range held as points in text, where it
  was handed over with a point on a container. The document and what is
  selected are the same.
- A point on a table, a row or a cell is left to the table-edge rule,
  which takes the whole table with the range, as at the parent, also for
  a point before the table's first row. Part D of
  `plans/markdown-editor-table-command-fixes.md` plans the rule for
  those.

**13. Enter over a range applies no shortcut where Enter after Delete
does** (*Found along the way*, row `TK7`). Lexical's Enter shortcut
takes a caret at the end of a block's first text that reads as a
marker; Enter over a selection, which this plan makes "Delete, then
Enter" (sign-off 2), does not go through it, as at the parent. So the
two differ for a range that leaves the caret right behind `- `, `1. `,
`# `, `> ` or a fence. The other choice is to let Enter over such a
range go on to Lexical's handler after the removal: the quote of the
row would become a list item, by a key that was pressed over a
selection.

### For the plan that follows (`markdown-editor-cross-item-range-removal`)

Line numbers are of this branch's tip.

- **The names are the plan's.** `$isGuardedRange` (`:2372`),
  `$removeJoiningRange` (`:2394`), `$removeGuardedRange` (`:2443`),
  `$keepAsEditorSelection` (`:2546`), `$isPlainlyRemovedRange`
  (`:2638`), `$deleteGuardedRange` (`:2667`),
  `$guardedRemovalDeclinesLineBreak` (`:2793`),
  `$joiningRemovalDeclinesLineBreak` (`:1815`), `$isTextOnlyEdgeRange`
  (`:2344`), `$removeGuardedRangeBeforeText` (`:2841`), all in
  `MarkdownEditor.ts`. `$removalJoinsEndBlockRest` is at `:1758`, its one
  call at `:1817`. `registerRangeGuards` is at `:4439`, and
  `guard(DELETE_CHARACTER_COMMAND, $deleteGuardedRange)` at `:4462`.
- **That plan's printed edits apply.** Every edit of its stack prototype
  (`…/plans3/cross-item-range/stack-proto/patch-ci.txt` and
  `patch-cix.txt`) finds its text exactly once in this branch's
  `MarkdownEditor.ts`, checked again on the final code: `$isGuardedRange`'s
  body, the seven lines of `$removeGuardedRange` from
  `$addUpdateTag(RUN_EDGE_TAG);` to the end of the `if`/`else`, the
  `isJoining` line, the first statement of `$isPlainlyRemovedRange` (one
  line, as that plan prints it), the delete registration and the comment
  and `return` of `$deleteGuardedRange`. One does not: the `lexical`
  import line now ends `$addUpdateTag, $setState,` (an earlier branch
  added `$setState`), so `$isSiblingCaret` goes in after it by hand.
- **`$removeGuardedRange` has three things that plan does not print.** It
  opens with `$settleTextOnlyEdgeEnds(selection);` and a comment (D11),
  before `$isGuardedRange` is asked; the raw blocks at the range's ends
  are read before `$addUpdateTag`; and the function ends with
  `$keepAsEditorSelection(selection)` (D1) before `return true`.
  `$joinCoveredItemTexts(selection)` goes where that plan puts it,
  directly before `if (isTableEdge)`. If its steps move an end out of a
  raw block the range started in, the list of raw blocks read at the top
  is still the right one to re-read: a block that is gone is skipped.
- **`$joiningRemovalDeclinesLineBreak` has four lines that plan does not
  print** (D8), after its `joinsRest` line: a range that starts at the
  very start of a raw block and has nothing follow its end is declined
  (`$rawBlockEmptiedFrom`, `:1837`). That plan changes the arguments of
  `$removalJoinsEndBlockRest` to nodes; the four lines read `start` and
  `end` as points and stay as they are.
- **No raw block of no text survives a removal** (D8). After any route
  over a range that takes all a raw block holds, an empty paragraph
  stands where the raw block was and holds the caret
  (`$showBlankRawBlockAsParagraph`, `markdownWritable.ts:943`, a step of
  `$showRawBlockAsSaved`). That plan's rows do not rely on one that
  does: its rows that empty the document's first block (`CI81` to
  `CI90`, `D39`) hold a heading or a paragraph there. Should a row of it
  empty a raw first block, expect the paragraph after Delete as well as
  after Backspace. Row `R32` of the table-edge file is restated here.
- **The delete registration.** `registerRangeGuards` now registers, for
  each command, a listener that settles the range's ends
  (`$settleSelectionBeforeGuard`, D11) ahead of the one that removes, and
  its JSDoc says "each command has one listener that removes"; that
  plan's `$deleteCharacterOverGuardedRange` takes the removing row's
  place and the sentence still holds. A cross-item range with an end
  held as a point on a list is not settled by D11 (it has no end in a
  raw block or a code block); should that plan want it settled, the
  listener is the place, with `$settleTextOnlyEdgeEnds`'s first
  condition widened. Nothing in the code or its comments says the
  row is the only listener of a range there will ever be.
- **A caller may go on with the selection it passed** (D1). That plan's
  `$deleteCharacterOverGuardedRange` calls `$deleteGuardedRange()` and
  then reads `selection.isCollapsed()` on the object it read before: that
  is sound now also where the re-read replaced a raw block.
- **The caret after a re-read is at the joint** (D2). That plan's rows
  that type or press Enter over a cross-item range ending in a raw block
  of a list item were measured on a prototype without D2. Where its
  removal makes a raw quote, list or table show as rich text, expect the
  inserted text at the joint, not at the block's end, and measure its
  rows again before pinning them. The place comes from
  `$placeOfSourceOffset` (`markdownSourcePlaces.ts:143`), called by
  `$selectCaretPlace` (`markdownWritable.ts:1090`); nothing of that plan
  needs to call it.
- **Shift+Enter** over a range from a level 3 to 6 heading to a raw
  block's start is declined (D4), by the formula that plan extends.
- **The update tag.** `$removeGuardedRange` sets no update tag any more
  (round 7). The plan's snippet adds `$addUpdateTag(RUN_EDGE_TAG);` to the
  end of the `if`/`else` that chooses the removal; with the sign-off 5
  decision as it is, the line is not in the code, and that plan's steps
  run in the update of the route: tagged for the routes `registerRunEdgeRules`
  tags, untagged for typing, the composition's start and Tab.
- **Rows that compare with Delete, then the route** should start their
  ranges away from a space that ends a formatted run, and from
  punctuation that ends one right before formatted text, or the control
  differs for the reasons under *Found along the way*. A removal
  completes no typing shortcut any more (D10), so text that reads as one
  before the range is no trouble for Delete; but Enter after Delete,
  with the caret at the end of text that reads as a marker, is taken by
  Lexical's Enter shortcut, where Enter over the range is not (`TK7`).
  A row that asserts "one undo restores the source" should not type a
  character that completes a typing shortcut in the block the removal
  leaves (a space after `-` or `#`), and Tab at the start of inline code
  takes the caret's format (`TS16`). A row that dispatches outside an
  update and then reads the document should read it twice, or flush:
  what an update's listeners start is committed by the read after.
- **The test file.** The new `describe` is at `:1041` of
  `markdown-editor-command-crashes.test.ts`, directly before the
  `upstream canaries` one (`:2057`); that plan's own goes between the
  two. The imports it needs are there (`DELETE_WORD_COMMAND`,
  `INSERT_TAB_COMMAND`, `REMOVE_TEXT_COMMAND`, `UNDO_COMMAND`,
  `LexicalCommand`, `$insertGeneratedNodes`). The helpers `select`,
  `run`, `expectParity` and `syncCaretFormat` and the constants are local
  to this plan's `describe`; a row outside it cannot call them.
- **`markdownWritable.ts`.** `$showRawBlockAsSaved` is exported (`:916`),
  `$showSiblingRawBlocksAsWritten` is at `:895`, `registerRawBlockRules`
  at `:969`, `$showRawBlockAsItsBlocks` at `:1032`, `$selectTextOffset`
  at `:1111`. `$contentFollows` is exported now (`:1750`), for D8.
- **Differential baselines.** The parent's results for that plan's checks
  must be recorded anew on this branch's tip. The harnesses here:
  `diff/zz-re-wide.test.ts` with `diff/runwide.sh` and `diff/widediff.py`
  (the wide probe), `r5/zz-r5-sweep.test.ts` with `r5/runsweep.sh` and
  `r5/sweepan.py` (the widened sweep), `r5/zz-r5-points.test.ts` with
  `r5/runpoints.sh` and `r5/pointsan.py` (ends held as points on
  containers), `r4/zz-r4-proto.test.ts` (the mapping against a mark),
  `diff/redcount.py` (the matrix's failing
  cells), `adhoc/zz-controls.test.ts` (what Delete, then each route gives
  for shapes named in a JSON file). The wide probe has 768 cells that are
  not guarded here, a list item's text into a raw list that joined it at
  load; they are that plan's shape.
- **Fuzz baselines at this tip**: `fuzz-c5/`, `lif-c5/` and `r7-c5/` in
  the scratch folder (paste 0, 0, table edge 0, 0, list
  edit 1, reviewer 7 89).
- **Docs.** The paragraph at line 82 of `docs/components/MarkdownEditor.md`
  changed; three entries were appended to `## Fixed` → `### Components`
  of the changelog (`:1004`, `:1029`, `:1041`).
- **The typing shortcuts** (D10). A removal `$removeGuardedRangeAsDeletion`
  makes completes none; every other update is handed to Lexical's listener
  as at the parent. That plan's `$joinCoveredItemTexts` runs inside the
  removal and needs nothing more. A new route of it that only removes, outside
  `$removeGuardedRange`, would use the same helper. The plan
  `markdown-editor-typing-shortcuts-only-for-typing` replaces the helper's
  tag (D10, *Collision with the next plan*).
- **Left open.** The fallback's shapes (D2); Lexical's Enter shortcut
  after Delete, the run-edge rule between the control's two steps, the
  tab's format, `cut()` carrying no run-edge tag, and a browser's caret
  between two text nodes (*Found along the way*); the typing shortcut
  after a deletion Lexical makes itself, in a paragraph or in one raw
  block (D10); a point on a table from outside it
  (sign-off 12, for part D of the table-command-fixes plan); M4 and M5
  by hand.

### Held, and rebased onto the typing-shortcuts branch (2026-10-14)

The seventh review was blocking again, so the branch is held by the owner's decision of 2026-10-13 (its report: `scratch-keep/impl/raw-block-range-edits/review7/REPORT.md`). The general rule that a typing shortcut applies only for typed text was implemented underneath it, as `feature/markdown-editor-typing-shortcuts-only-for-typing`, and this branch was rebased onto that one on 2026-10-14 with nothing else changed:

- In `MarkdownEditor.ts` the shortcut wrapper now asks both questions: the update typed text, and it carries no `GUARDED_DELETION_TAG`. The two doc-comment conflicts were merged keeping that branch's wording, with one sentence each for the tag.
- Both branches created `markdown-editor-typing-shortcuts.test.ts`. That branch's file keeps the name; this branch's rows moved unchanged to `markdown-editor-guarded-removal-shortcuts.test.ts`.
- The changelog keeps both entries.
- Typecheck, test typecheck and lint are clean. The full suite has 43 failing tests, all rows of this branch that pin the parent's behaviour the general rule changes: `TY3`, `TY4` and `TY5` (14 each) in `markdown-editor-guarded-removal-shortcuts.test.ts` and `TK6` in `markdown-editor-command-crashes.test.ts`. They are left for the resumption, which drops this branch's own shortcut commit (see that plan's section "For `markdown-editor-raw-block-range-edits`, when it resumes").
