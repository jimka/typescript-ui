---
depends-on: [markdown-named-character-references]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts
  - packages/lib/tests/component/markdown-editor-command-crashes.test.ts
  - packages/lib/tests/component/markdown-source-places.test.ts
  - packages/lib/tests/component/markdown-editor-guarded-removal-shortcuts.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Raw Block Range Edits, Resumed — Implementation Plan

## Overview

`feature/markdown-editor-raw-block-range-edits` is held at `9e0207a92`, on `feature/markdown-editor-typing-at-link-start-swallowed` (`f2f08b104`). Its plan is `plans/in-progress/markdown-editor-raw-block-range-edits.md` on that branch; this document calls it *the held plan*. The Markdown chain has moved on: `f2f08b104` → heading-to-code-escapes → table-command-fixes → minimal-escapes → tab-over-range-before-list (`54bbd0dd3`) → named-character-references, whose tip `5f5ac474b` is the chain's top and this plan's base. This plan finishes the held branch: it is rebased onto the chain's top, its rules for selection points are merged with those of `markdown-editor-table-command-fixes` into one model, the blocking findings of its seventh review are fixed, and its failing tests are fixed or restated.

The held branch's own code is unchanged in what it does for a range with an end in a raw Markdown block or a code block. What changes:

- **Point settling.** After a plain rebase two settle functions run, in an order nobody chose. They become one, `$settleSelectionOffContainers` in [MarkdownEditor.ts:2318](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2318) (line numbers are of `5f5ac474b`; the file is the same at `54bbd0dd3`), with two ordered steps, run from the one wrapper every range guard already has.
- **Rebase.** The branch is replayed onto the chain's top by cherry-pick, its own typing-shortcut commit is dropped, and each fix is folded into the commit that owns the behaviour.
- **Review findings.** Three shapes where the caret still lands in a neighbouring list item or table cell are fixed in `markdownSourcePlaces.ts`. Two stale JSDoc passages are corrected. What a cut does is pinned. A test row that its first commit could not pass moves to the commit that makes it pass. The held plan's notes are corrected.
- **Failing tests.** 92 tests fail on the held tip today, and 11 more fail once the branch sits on the chain's top. None is a regression of the editor. They are expectations made stale by the chain below (the `marked` 18.1 upgrade, minimal escapes, the general typing-shortcut rule), plus one new shape of the caret-place fallback. Each is listed under [Addendum: The failing tests, classified](#addendum-the-failing-tests-classified).

A prototype of all of this, in private copies, passes the full suite on `5f5ac474b`. Its commits are kept on `wip/markdown-editor-raw-block-range-edits-resumption-prototype` (`87c3b7dc4`) for comparison only: they carry a placeholder author and are not to be merged. The numbers are under [Verification](#verification).

---

## Architecture Decisions

### One settling model — one function, two steps, called at the guards' one seam

A *point where no caret can be* is an element point on a node that holds blocks: the document, a `:::` block or one of its columns, a list, a list item. Only code makes one; the browser never does. Both branches move such points before a range is removed, each with its own function:

- `markdown-editor-table-command-fixes` added `$settleSelectionOffContainers`. The `guard` helper of `registerRangeGuards` ([:4500](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4500)) calls it before every guard listener, and `$removeGuardedRange`, `insertTable` and `insertImage` call it too.
- The held branch added `$settleTextOnlyEdgeEnds` (held tip `:2620`), registered as a separate listener for twelve commands (`$settleSelectionBeforeGuard`, `:2645`), plus a second call at the top of `$removeGuardedRange`.

After the rebase the held branch's listener is itself wrapped by the guard helper, so both run, the table-command one first. That order was never decided. The two disagree about points at a container's start and about lists.

The decision: `$settleSelectionOffContainers` is the only settle function, and it runs in two ordered steps.[^one-function]

1. **The table-command rules**, as they are, with two corrections (the next two decisions).
2. **The held branch's inward rule**, on the range as step 1 left it, and only for a range with an end in a raw block or a code block. `$settleTextOnlyEdgeEnds` stays as the second step's body. It is called only from `$settleSelectionOffContainers`, and returns whether it moved a point.

Every place that settles today calls this one function: the `guard` wrapper, `$removeGuardedRange`, `insertTable()`, `insertImage()`, and one new listener of `KEY_ENTER_COMMAND` (see [Enter settles before its raw-block handler](#enter-settles-before-its-raw-block-handler)). The held branch's twelve `$settleSelectionBeforeGuard` registrations, the function itself, and the second call in `$removeGuardedRange` are removed. The precedent is the table-command `guard` wrapper, which is the editor's existing seam for "before a range is removed or replaced".

### A range's end at the start of its container is read in document order

In step 1, a range's end that needs moving and stands at offset 0 of its container is first moved outward: to the place before that container, in the container's parent, and on outward while that is offset 0 too. Then it settles to the end of the block before it, as today. A new helper does the outward move, `$readEndPastContainerStart`.

| Range | Today on the chain (table-command rule) | After |
|---|---|---|
| `"raw"`@1 in `<div>⏎raw⏎</div>` → the `:::` block after it, before its first column | the end goes forward into the first column's text; that column's paragraph joins the raw block, and the `:::` block is left with one column (`::: {}`) | the end is the end of the raw block: nothing of the `:::` block is in the range |
| `"raw"`@1 → the second column, before its paragraph | the end goes forward into `cb`, which joins the raw block, and the `:::` block is gone | the end is the end of `ca`, the first column's text |

A range's *start* at the end of its container keeps the table-command rule (it goes back to the end of the block before).[^end-only]

(`⏎` is a line end. `"text"`@n is offset n in the text node holding exactly that text. A range is written start → end.)

### A table, its rows and its cells are never settled

`$liesBetweenBlocks` ([:2200](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2200)) leaves out a table cell but not a table or a table row. In `@lexical/table` 0.49 all three are shadow roots (`isShadowRoot()` returns `true`). So a range point on a table or a row is settled today, against the function's own JSDoc and the table-command plan's rule ("a table, a table row or a table cell — never"). `$liesBetweenBlocks` now leaves out all three. A range with a point on a table part is a table-edge range, and the table-edge removal reads such a point already.[^table-shadow]

### Ends on lists: remove-first, except for a range the raw-block removal takes

What happens to a point on a list, a list item, or the document just before a list:

| The range | Its point on a list, an item, or just before a list | Then removed by |
|---|---|---|
| has no end in a raw block or a code block | left as it is (step 1) | the remove-first rules of `markdown-editor-table-command-fixes` and `markdown-editor-tab-over-range-before-list` for Enter, Shift+Enter, Tab, pasted or dropped nodes, `paste()` and `insertImage()`; the list item rules for Delete, Backspace, typing and a plain-text paste |
| has an end in a raw block or a code block | moved inward (step 2): a start to the start of the first block of text at or after it, an end to the end of the last block of text at or before it | `$removeGuardedRange`, as every other range that leaves a raw block |

So the remove-first precedent holds for every range Lexical removes. The held branch's inward rule is kept, as step 2, only for the ranges its own removal takes.[^lists-inward] This is the one place the plan departs from the preference for remove-first, and it is the plan's sign-off question for the owner. The held branch's rule changes in three ways: it no longer runs as a listener of its own; its handling of the document, `:::` blocks and columns is replaced by step 1, which gives the same result in every row the branch has; and it runs on the range step 1 left, so a document point that step 1 moves into a raw block is seen by step 2 as an end in a raw block. **No row of the held branch and no row of either table-command branch changes** (measured; see [Verification](#verification)).

### Enter settles before its raw-block handler

`$handleRawBlockEnter` ([:1090](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1090)) is a `KEY_ENTER_COMMAND` listener at `COMMAND_PRIORITY_HIGH`. It reads the range before any guard of the paragraph command does. A new `$settleSelectionBeforeEnter`, registered first in `registerRangeGuards` at `COMMAND_PRIORITY_CRITICAL`, calls `$settleSelectionOffContainers($getSelection())` and returns `false`.[^enter-listener]

### The rebase is a cherry-pick that drops one commit and keeps the commit shape

The held branch already has the commit shape its owner asked for: one code commit per functionality, each with its own documentation commit, and its fix history was folded in round 7. So it is not squashed. It is replayed onto the chain's top commit by commit, with `c9b90d12c` ("Complete no typing shortcut after a removal the editor makes itself") left out. Each fix goes into the commit that owns the behaviour, so every commit passes its own tests.[^no-squash]

| Commit on the held branch | After the rebase |
|---|---|
| `f18c47273` Move the plan to in-progress | as it is |
| — | **new**: add this plan to `plans/in-progress/` |
| `72ac7c484` Remove a range that leaves a raw block the same way on every route | conflicts resolved per [the table](#conflicts-in-72ac7c484); the one settling model; JSDoc corrections; row `TE83` moved out; row `TS19` (link) renamed `TS23`; route rows for a cut over `TE82` |
| `32f5ea7c9` Show a raw block that holds nothing as an empty paragraph | one JSDoc paragraph corrected |
| `c9b90d12c` Complete no typing shortcut after a removal the editor makes itself | **dropped**: `markdown-editor-typing-shortcuts-only-for-typing` holds the general rule |
| `4408c2d93` Keep the caret's place when a raw block shows as its blocks | the empty item and cell fixes; rows restated and added; `TE83` and its `TS23` case added here |
| — | **new**: "Pin that a removal into a raw block completes no typing shortcut" (test file only) |
| `423453419`, `8ed154e54` (docs) | conflicts resolved per [the docs rule](#conflicts-in-the-documentation-commits) |
| `c67184128` Document the caret's place in a re-read raw block | conflict resolved; the fallback list updated |
| `9e0207a92` Record implementation notes | as it is |
| — | **new**: record the resumption in the held plan's notes |

### Neither cut tidies the run edges, and that is now pinned and written down

The owner's decision of round 7 stands: the removal sets no `RUN_EDGE_TAG`, and a route carries the tag exactly when it carried it at the parent. Neither cut's removal update carries it. So for `TE71`, `cut()` and the native cut save `> a **Note: (b)** z` where Delete saves `> a **Note:** **(b)** z`.[^cut-tag] The review's finding is the inaccurate record and the missing pin. The fix is: correct the four false statements, and add route rows for both cuts over `TE71` (no tidy) and over `TE82` (the link's bold is kept, as the parent's cut kept it).

### The caret stays in an empty item or cell in three more shapes

Review 7 found three shapes where the caret, and what is typed next, still went to a neighbour's text. Each regresses against the parent. Three changes to `markdownSourcePlaces.ts` fix them:

| Shape (range to `after`@5, `x` typed) | Held tip | After (the parent's result) |
|---|---|---|
| table in a raw list item, from `  \| a \| b \|`@4 | `\| h1 \| h2x \|` (header cell) | `\| x \|  \|` |
| the same, second body cell, from `  \| c \| d \|`@8 | `\| cx \|  \|` | `\| c \| x \|` |
| `- - x⏎- b⏎  > q⏎- c`, from `- b`@2 (and `- 1. x`) | `- - xx⏎-` | `- - x⏎- x` |
| `\| c \|  \| x \|`, from @8, right after the pipe that closes an empty cell; Delete, then type | `\| cx \|  \|` | `\| c \| x \|` |

1. `$emptyBlockAt` asks the tables when the item the offset stands in shows something, instead of returning `null` at once.
2. `$emptyBlockAt` no longer drops a list item that holds only a nested list. Such an item is an item of the source too (`- - x`), and dropping it made the item counts differ, which switched the rule off for the whole list.
3. `$emptyCellAt` reads an offset right after a row's closing pipe as the row's last cell.

Rows at the mapping level pin each condition of the two functions.[^mutants]

### Stale rows are restated, not fixed in code

Every failing test on the rebased branch was traced to its cause. None is an editor regression; the [addendum](#addendum-the-failing-tests-classified) has each one. The rows are restated to what the editor now does, where that keeps the branch's rules. One finding is new behaviour: `marked` 18.1 decodes a character reference (`&#35;`, `&#42;`) in text, so text holding one has no source the mapping can find. It becomes a fifth shape of the caret's documented fallback (the end of the block), named in the docs.[^charref] Two fallback shapes disappear: under `marked` 18.1 a tab between the words of a list item's text is handed back as written, and `[x]` followed by a tab is text, not a task item's checkbox.

### The shortcut rows of the dropped commit: three families are kept

The dropped commit created `markdown-editor-guarded-removal-shortcuts.test.ts` (rows `TY1` to `TY6`, 14 kinds each). The new test-only commit brings the file back with `TY1`, `TY1b` and `TY1c` only. These rows say what the general typing-shortcut rows do not: a removal of a range from escaped text into a raw block, by any removal route, completes no shortcut, and typing the completing character over such a range acts as typing it after the removal. `TY2` to `TY6` are left out: `TY3`, `TY4` and `TY5` pin the behaviour the general rule removed, and `TY2` and `TY6` repeat that file's `TY2` (a typed character completes a shortcut) and `TY3` (so does the end of a composition). The kept rows keep their names, which that file uses too: each file's `describe` title tells them apart.[^ty-file]

---

## Internal Structure

All in `MarkdownEditor.ts` unless a heading says otherwise. Each block below is the final code of the prototype. A call's result is assigned to a constant before it is tested.

### Step 1 and step 2 — `$settleSelectionOffContainers` and its helpers

`$pointNeedsSettling`, `$settlePoint`, `$standsBeforeList`, `$endsListOfColumn` and `$holdsNoCaret` stay as they are on the chain. `$liesBetweenBlocks` changes in two lines and its `@returns`:

```typescript
 * @returns `true` for the root and a column, `false` for a table, a table
 *   row and a table cell (each a shadow root in `@lexical/table`) and for a
 *   start just before a list.
 */
function $liesBetweenBlocks(point: PointType, isStart: boolean): boolean {
    const node = point.getNode();
    const isElement = $isElementNode(node);
    // A table, its rows and its cells are shadow roots too, and are left to the table rules.
    const isTablePart = $isTableNode(node) || $isTableRowNode(node) || $isTableCellNode(node);
    const holdsBlocks = isElement && $isRootOrShadowRoot(node) && !isTablePart;

    return holdsBlocks && !(isStart && $standsBeforeList(point));
}
```

Directly before `$settleSelectionOffContainers`, the new helper:

```typescript
/**
 * Moves a range's end that stands at the very start of its container to the
 * place right before that container, in the container's parent, and on
 * outward while that is a start too: an end with nothing before it in its
 * container is read in document order, at what stands before the
 * container. Stops at the document's start.
 *
 * @param point - A range's end, an element point; moved in place.
 */
function $readEndPastContainerStart(point: PointType): void {
    let node = point.getNode();
    let parent = node.getParent();

    while (point.offset === 0 && parent !== null) {
        point.set(parent.getKey(), node.getIndexWithinParent(), "element");
        node = parent;
        parent = node.getParent();
    }
}
```

`$settleSelectionOffContainers`, JSDoc and body:

```typescript
/**
 * Moves the points of a selection that lie where no caret can be to the
 * caret positions they name, so a command acts as it does for the same
 * selection made with the mouse. It is the one place a selection's points
 * are settled before a range is removed or something is inserted: every
 * range guard calls it ({@link registerRangeGuards}), and so do
 * {@link $removeGuardedRange}, Enter's own listener
 * ({@link $settleSelectionBeforeEnter}), `insertTable` and `insertImage`.
 *
 * Such a point can only be set in code: on a `:::` block, or, for a range,
 * on the root or a column between two blocks. A caret goes to the start of
 * the block after it (the end of the block before it at the container's
 * end); a range's start likewise; a range's end to the end of the block
 * before it, read past the start of its container when nothing stands
 * before it there ({@link $readEndPastContainerStart}). Lists and list items
 * are not settled, and neither is a range's start just before a list
 * ({@link $liesBetweenBlocks}): but for a range the raw-block removal takes,
 * whose ends on lists, list items and before a list are then read inward
 * ({@link $settleTextOnlyEdgeEnds}).
 *
 * @remarks
 * Lexical's insert needs a block holding inline content around the caret,
 * and its removal of a range that starts between blocks removes every block
 * but the root's last child, which it leaves empty. A point on a table, a
 * table row or a cell is left to `@lexical/table`, and a caret between two
 * blocks to Lexical, which make and handle them themselves. The function
 * moves nothing a second time: once settled, every point it moves is in text
 * or on a block of text.
 *
 * @param selection - The selection, moved in place.
 * @returns Whether a point moved.
 */
function $settleSelectionOffContainers(selection: BaseSelection | null): boolean {
    const isRange = $isRangeSelection(selection);

    if (!isRange) {
        return false;
    }

    const isCollapsed = selection.isCollapsed();
    const [start, end] = $orderedPoints(selection);
    const startMoves = $pointNeedsSettling(start, isCollapsed, true);
    const endMoves = !isCollapsed && $pointNeedsSettling(end, isCollapsed, false);

    if (startMoves) {
        $settlePoint(start, "next");
    }

    if (isCollapsed && startMoves) {
        end.set(start.key, start.offset, start.type);
    } else if (endMoves) {
        $readEndPastContainerStart(end);
        $settlePoint(end, "previous");
    }

    const movedInward = $settleTextOnlyEdgeEnds(selection);

    return startMoves || endMoves || movedInward;
}
```

`$settleTextOnlyEdgeEnds` keeps its body but for its return value, and gets new JSDoc. Its two statements `$settleRangeEndsInward(selection); $moveBlockPointsIntoText(selection);` stay inside one `if`, now on a named constant:

```typescript
/**
 * The second step of {@link $settleSelectionOffContainers}: moves the ends
 * of a range the raw-block removal takes — one with an end in a raw
 * Markdown block or a code block — that still stand on a node that holds
 * blocks, between its children, into the range: its start to the start of
 * the first block of text at or after it, its end to the end of the last
 * block of text at or before it ({@link $settleRangeEndsInward}), each named
 * as a point in text where its block has text. After the first step such an
 * end is on a list, a list item, or the root or a column just before a
 * list. The range then takes in no block its points did not: an end before
 * a list's first item is the end of the block before the list, as the block
 * commands read it.
 *
 * @remarks
 * The first step leaves those points to the list item rules and to the
 * removal that runs first for a range starting before a list, which read
 * them for a range Lexical removes ({@link $isRangeStartingBeforeList},
 * {@link $isListContainerRange}). A range with an end in a raw block or a
 * code block is removed by {@link $removeGuardedRange} before any of those
 * rules sees it, and its removal reads both ends as places in a block's
 * text: left on a list, the start would leave the caret on that list and
 * the end would move the list's children out. A range that is a table-edge
 * range too is left to that shape's own removal, which reads such a point
 * beside a table.
 *
 * @param selection - The selection; its points are moved.
 * @returns Whether a point moved.
 */
function $settleTextOnlyEdgeEnds(selection: BaseSelection | null): boolean {
    const isRange = $isRangeSelection(selection) && !selection.isCollapsed();

    if (!isRange) {
        return false;
    }

    const points = [selection.anchor, selection.focus];
    const leavesTextOnlyBlock = points.some((point) => $findMatchingParent(point.getNode(), $isTextOnlyBlock) !== null);
    const standsOnHolder = points.some($standsOnHolder);
    const isTableEdge = $isTableEdgeRange(selection);
    const moves = leavesTextOnlyBlock && standsOnHolder && !isTableEdge;

    if (moves) {
        $settleRangeEndsInward(selection);
        $moveBlockPointsIntoText(selection);
    }

    return moves;
}
```

### `$removeGuardedRange`

Its body opens with the one settle call and then goes on as the held branch has it:

```typescript
function $removeGuardedRange(selection: BaseSelection | null, caretStaysOutOf: ((node: LexicalNode) => boolean) | null = null): boolean {
    $settleSelectionOffContainers(selection);

    const isGuarded = $isGuardedRange(selection);

    if (!isGuarded) {
        return false;
    }

    // Read before the removal: afterwards the two ends are one caret.
    const rawBlocks = [selection.anchor, selection.focus].map((point) => $findMatchingParent(point.getNode(), $isMarkdownRawBlockNode));
    const isTableEdge = $isTableEdgeRange(selection);
    // … the rest as on the held branch: the removal, the re-read, $keepAsEditorSelection, return true
```

Its JSDoc is the held branch's, with two changes. The `@remarks` paragraph on the update tag becomes:

```text
 * The update is not tagged {@link RUN_EDGE_TAG} here: a route carries that
 * tag exactly when it carried it at the parent. The delete commands, the
 * paste commands, the drop, Enter and Shift+Enter tag their command's update
 * (`registerRunEdgeRules`), and `insertImage` tags its own. Neither cut tags
 * the update that removes the range: `cut()` carries no tag, and the native
 * cut's tag marks the command's own update, while the removal follows in an
 * update of its own. Typing, the start of a composition and Tab carry none.
 * Each route without the tag is tidied where the caret is, as over any
 * range. A tag set here would send every route over the range, typing and
 * Tab among them, through the rule that tidies each changed block whole.
```

And a last `@remarks` paragraph, before `@param`:

```text
 * A point where no caret can be is settled first
 * ({@link $settleSelectionOffContainers}), for a route that is no command;
 * a command's guard settles it before its listener runs.
```

### `registerRangeGuards` and `$settleSelectionBeforeEnter`

Directly before `registerRangeGuards`:

```typescript
/**
 * `KEY_ENTER_COMMAND` listener that settles the selection's points
 * ({@link $settleSelectionOffContainers}) before Enter's own handlers read
 * them: Enter in a raw block ({@link $handleRawBlockEnter}) reads the range
 * before any guard of the paragraph command does.
 *
 * @returns Always `false`, so Enter's own handlers run.
 */
function $settleSelectionBeforeEnter(): boolean {
    $settleSelectionOffContainers($getSelection());

    return false;
}
```

The `guard` helper keeps the chain's form (it settles, then calls the listener). The registrations open with the Enter listener. None of the held branch's twelve `$settleSelectionBeforeGuard` rows, nor its `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` settle row, is kept:

```typescript
    return mergeRegister(
        editor.registerCommand(KEY_ENTER_COMMAND, $settleSelectionBeforeEnter, COMMAND_PRIORITY_CRITICAL),
        guard(KEY_BACKSPACE_COMMAND, $backspaceOverTableEdgeRange),
        guard(KEY_DELETE_COMMAND, $deleteKeyOverTableEdgeRange),
        guard(DELETE_CHARACTER_COMMAND, $deleteGuardedRange),
        // … the remaining rows as on the held branch
```

The `@remarks` of `registerRangeGuards`: replace the held branch's paragraph that starts "Each command has one listener that removes" up to "The listeners that remove are at" with:

```text
 * Each command has one listener that removes, and each removes the range
 * through {@link $removeGuardedRange}, which takes the shapes in one order.
 * The `guard` wrapper settles the selection's points
 * ({@link $settleSelectionOffContainers}) before each listener runs, and
 * `KEY_ENTER_COMMAND`, whose handler for a raw block reads the range too,
 * has a listener of its own that does the same
 * ({@link $settleSelectionBeforeEnter}): every listener after it reads a
 * range whose ends are in text where they can be. The paragraph-break, Tab,
 * clipboard-insert and line-break guards also remove a range that starts
 * just before a list ahead of Lexical's insert, so the insert comes where
 * the range was ({@link $clearGuardedRangeBeforeParagraph},
 * {@link $removeGuardedRangeForInsert}, {@link $clearGuardedRangeBeforeLineBreak}).
 * The listeners that remove are at {@link COMMAND_PRIORITY_CRITICAL}, ahead of
```

The rest of that JSDoc is the held branch's.

### `$joiningRemovalDeclinesLineBreak` (in `32f5ea7c9`)

Its `@remarks` paragraph that starts `"Nothing follows its end"` becomes:

```text
 * "Nothing follows its end" is read in the block of text the range ends
 * in, so the range's end has to stand in one: each command's guard settles
 * the range's points ({@link $settleSelectionOffContainers}) before this is
 * asked, and moves an end held as a point on a list, a `:::` block or the
 * document — after which a whole block may follow — into the text the
 * range reaches.
```

### `markdownWritable.ts` — the two passages on `RUN_EDGE_TAG`

Both go back to their wording at `f2f08b104`. The JSDoc of `RUN_EDGE_TAG` ends "…the commands {@link registerRunEdgeRules} tags, and an update that inserts a node next to text, such as an image, which can change how a construct kept as written before it reads." In the JSDoc of `registerRunEdgeRules`, the clause ", unless it replaces a range the editor removes itself, whose removal sets the tag" is deleted.

### `markdownSourcePlaces.ts` (in `4408c2d93`)

```typescript
    const items = nodes.filter($isListItemNode);
    // … sourceItems, inItems, itemAt, item: unchanged

    // An item that shows something can hold a table whose cell shows nothing: the tables are asked next.
    if (item !== undefined && $showsNothing(item)) {
        return $innermostFirst(item);
    }
```

The import becomes `import { $isListItemNode } from "@lexical/list";`. In `$emptyCellAt` the `cell` line becomes:

```typescript
    const cells = table.getChildren().filter($isTableRowNode)[row]?.getChildren() ?? [];
    // Right after the pipe that closes a row, the offset is still in the row's last cell.
    const cell = cells[Math.min(pipes - (line.trimStart().startsWith("|") ? 1 : 0), cells.length - 1)];
```

---

## Ordered Implementation Steps

Run every command from the held branch's worktree, `.worktrees/markdown-editor-raw-block-range-edits`. Its `node_modules` and `packages/lib/node_modules` are already symlinked to the main tree's; never run `npm install`. Run tests from `packages/lib` with `npx vitest run <files> --maxWorkers=2`, check `free -g` before the full suite, and run no more than two vitest processes at a time. Make no backup refs: the reflog keeps `9e0207a92`. Pass `-c rerere.enabled=false` to every `git` command that can conflict, so the private conflict cache gets no recorded resolution.

Set `TOP=5f5ac474b`, the tip of `feature/markdown-named-character-references`. If the chain's top has moved past it, use the new top and expect the comparisons below to show that branch's own changes too.

After steps 4, 5, 7, 8 and 9, compare the tree with the prototype's commit for that step: `git diff <commit> -- packages` must print nothing. The commits are on `wip/markdown-editor-raw-block-range-edits-resumption-prototype`:

| After step | Prototype commit |
|---|---|
| 4, the first code commit | `594cdd595` |
| 5, the second code commit | `55b838e78` |
| 7, the caret commit | `feb7e5608` |
| 8, the shortcut rows | `715b55c8f` |
| 9, the last documentation commit | `cfdb860b3` |

1. **Start.** `git status` is clean. `git switch --detach $TOP`.
2. **Plan move.** `git cherry-pick f18c47273` (clean).
3. **This plan.** Copy `plans/markdown-editor-raw-block-range-edits-resumption.md` from the main tree's `plans/` into `plans/in-progress/` and commit it (bookkeeping), "Move the raw block range edits resumption plan to in-progress".
4. **The first code commit.** `git cherry-pick 72ac7c484`. Six conflicts in `MarkdownEditor.ts`: resolve each as [Conflicts in 72ac7c484](#conflicts-in-72ac7c484) says. Then, before `git cherry-pick --continue`:
   - Apply the code of [Step 1 and step 2](#step-1-and-step-2--settleselectionoffcontainers-and-its-helpers), [`$removeGuardedRange`](#removeguardedrange), [`registerRangeGuards` and `$settleSelectionBeforeEnter`](#registerrangeguards-and-settleselectionbeforeenter) and [`markdownWritable.ts`](#markdownwritablets--the-two-passages-on-run_edge_tag).
   - Check: `grep -n 'settleSelectionBeforeGuard\|replaceEmptiedContainerAtCaret' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` gives no match. `grep -c 'settleTextOnlyEdgeEnds(' …/MarkdownEditor.ts` gives 2 (the definition and the call in `$settleSelectionOffContainers`). `grep -n 'removes itself on every route\|whose removal sets the tag' …/markdownWritable.ts` gives no match.
   - In `markdown-editor-command-crashes.test.ts`: delete the shape row `{ id: 'TE83', … }`; change `it.each(['TE82', 'TE83'])('TS19: typing over %s keeps the bold …` to `it.each(['TE82'])('TS23: typing over %s keeps the bold …`; add the `TE82` cut rows of [the route rows](#rows-in-markdown-editor-command-crashestestts) as the first rows of the first `it.each<[string, Route, string]>([` table (the one that opens with `['TE1', 'Delete', …]`), with their comment.
   - `npm run typecheck`, `npm run typecheck:test`, `npm run lint`. Then `npx vitest run tests/component/markdown-editor-command-crashes.test.ts tests/component/markdown-editor-table-cells-paste.test.ts tests/component/markdown-editor-table-edge.test.ts tests/component/markdown-editor-table-commands.test.ts --maxWorkers=2`: all pass (the prototype: 907).
   - `git add -A packages && git cherry-pick --continue`.
5. **The second code commit.** `git cherry-pick 32f5ea7c9` (clean). Apply [`$joiningRemovalDeclinesLineBreak`](#joiningremovaldeclineslinebreak-in-32f5ea7c9). Typecheck; run the crash, table-edge and table-cells-paste files (the prototype: 920). `git commit --amend --no-edit`.
6. **Leave out `c9b90d12c`.** Do not pick it.
7. **The caret commit.** `git cherry-pick 4408c2d93` (clean). Then:
   - Apply [`markdownSourcePlaces.ts`](#markdownsourceplacests-in-4408c2d93).
   - In `markdown-source-places.test.ts`, the changes of [Rows in `markdown-source-places.test.ts`](#rows-in-markdown-source-placestestts).
   - In `markdown-editor-command-crashes.test.ts`, the changes of [Rows in `markdown-editor-command-crashes.test.ts`](#rows-in-markdown-editor-command-crashestestts) that are marked for this commit.
   - Typecheck both; run the crash, places and table-edge files (the prototype: 1,570). `git commit --amend --no-edit`.
8. **The shortcut rows.** Create `packages/lib/tests/component/markdown-editor-guarded-removal-shortcuts.test.ts` as [The shortcut rows file](#the-shortcut-rows-file) says. Run it (42 tests). Commit: "Pin that a removal into a raw block completes no typing shortcut".
9. **The documentation commits.** `git cherry-pick 423453419`, `8ed154e54`, `c67184128` in turn. Each meets a conflict in `MarkdownEditor.md`, and the first one also in the changelog: resolve per [the docs rule](#conflicts-in-the-documentation-commits). On `c67184128` also apply [Documentation Impact](#documentation-impact) before `--continue`.
10. **The notes commit.** `git cherry-pick 9e0207a92` (clean).
11. **The branch.** `git switch -C feature/markdown-editor-raw-block-range-edits`. Check: `git log --oneline $TOP..HEAD` lists ten commits, in the order of the table under [The rebase is a cherry-pick…](#the-rebase-is-a-cherry-pick-that-drops-one-commit-and-keeps-the-commit-shape): every row but the dropped commit and the last row.
12. **The notes.** Write the section and the corrections of [The held plan's notes](#the-held-plans-notes), and commit them: "Record the resumption in the raw block range edits notes".
13. **Verification**, in full.

### Conflicts in `72ac7c484`

"Ours" is the chain's side, "theirs" the held branch's.

| Hunk (function it sits in or before) | Resolution |
|---|---|
| JSDoc before `$removeGuardedRange` (the chain's says a point is settled first; the held branch's holds the new `$isTextOnlyEdgeRange`, `$isGuardedRange`, `$removeJoiningRange` and the JSDoc of `$removeGuardedRange`) | theirs; then the `$removeGuardedRange` JSDoc as [Internal Structure](#removeguardedrange) gives it |
| first lines of `$removeGuardedRange`'s body (`$settleSelectionOffContainers(selection);` against the held branch's comment and `$settleTextOnlyEdgeEnds(selection);`) | the body as [Internal Structure](#removeguardedrange) gives it: the chain's one call, then theirs from `const isGuarded` on |
| `$replaceEmptiedContainerAtCaret` (the chain deleted it; the held branch kept it and added `$isPlainlyRemovedRange` after it) | delete `$replaceEmptiedContainerAtCaret`; keep `$isPlainlyRemovedRange` with its JSDoc |
| JSDoc of `$clearGuardedRangeBeforeLineBreak` | the held branch's first sentence ("removes a guarded range ({@link $removeGuardedRange}), then …"), then the chain's last sentence ("A range that starts just before a list is removed first, … ({@link $beforeListRemovalDeclinesLineBreak}); then nothing is removed.") |
| JSDoc of `$clearGuardedRangeBeforePaste` | "removes the guarded range the pasted or dropped nodes are about to replace, a range that ends on a list or item, and a range that starts just before a list ({@link $removeGuardedRangeForInsert}), then lets the insertion run at the now-collapsed caret. With no" |
| `@remarks` of `registerRangeGuards` | theirs, then the paragraph of [Internal Structure](#registerrangeguards-and-settleselectionbeforeenter) |

The bodies of `$clearGuardedRangeBeforeParagraph` and `$clearGuardedRangeBeforeLineBreak` merge without a conflict and keep the chain's code. Their test for a range with a removal of its own stays `$isTableEdgeRange(selection) || $isStaleFocusRange(selection)`.[^own-removal] `$removeRangeBeforeImage` keeps the chain's body (no `$replaceEmptiedContainerAtCaret` call) and the chain's `@remarks`.

### Conflicts in the documentation commits

- `packages/lib/docs/components/MarkdownEditor.md`, the long paragraph under *Kept as source*: take the held branch's paragraph. Then put the chain's sentence back, right after "Converting a block to a code block keeps its formatting, links and images as their Markdown in the code.": "The code holds the block's text as the block's own Markdown writes it: a heading's text as its line holds it, so `### +alpha` gives a code block holding `+alpha` and `# alpha \#` one holding `alpha \#`, where a paragraph saved as `\+alpha` gives `\+alpha`." The same rule for each of the three commits.
- `packages/lib/docs/reference/changelog/next.md`: keep both sides, the chain's entries first.

### The held plan's notes

Append a section `### Resumed (date)` to the held plan's *Implementation Notes*. It says, in short: the base and the procedure (this plan); that `c9b90d12c` is dropped and the general rule of `markdown-editor-typing-shortcuts-only-for-typing` applies; the one settling model; the review-7 fixes; the failure classification, by pointing at this plan's addendum. Then correct these passages of the held plan:

| Where (held tip line) | What is wrong | Write instead |
|---|---|---|
| *Architecture Decisions*, subsection "A removal the editor makes itself completes no typing shortcut" (`:251`–`:275`) | describes the dropped commit | one paragraph: the general rule (`markdown-editor-typing-shortcuts-only-for-typing`) applies; a removal is no typing, so none completes a shortcut; the branch adds no tag |
| `:2301`–`:2307`, the paragraph *Collision with the next plan* | names the next plan's steps wrongly, and says `TY4` holds under both | delete the paragraph; the commit is dropped |
| `:2489`–`:2491`, `:2667`–`:2669` (the cut) | "one route changes by it: `cut()`" | both cuts: neither tags the update that removes the range; pinned by the `TE71` and `TE82` cut rows |
| `:2491` | a bullet glued to the line before it | a line break before "- **The plan's two classes" |
| `:2626` (round-7 table) | `TE83` and the `TS19` link row in the first code commit | `TE83` is in the caret commit; the link row is `TS23` |
| `:2711`–`:2714` | each commit's own tests pass | measured again: the numbers of step 4, 5 and 7 of this plan |
| `:1983`–`:1985`, *The fallback* `:1990`–`:2022` | the empty item or cell, without condition; the tab shapes | the empty item or cell holds also for a table in a list item, an earlier item holding only a list, and the pipe that closes an empty cell; the two tab shapes are gone under `marked` 18.1; a character reference is a new shape |
| *For the plan that follows* (`:3312`–`:3451`) | names `$settleSelectionBeforeGuard`, `GUARDED_DELETION_TAG`, `$removeGuardedRangeAsDeletion`, the changelog lines `:1004`, `:1029`, `:1041` | point at [What the four plans waiting on this branch need](#what-the-four-plans-waiting-on-this-branch-need) of this plan |
| *Held, and rebased onto the typing-shortcuts branch* (`:3453`–`:3460`) | 43 failing tests | add one sentence: resolved by the resumption |

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-command-crashes.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-places.test.ts` |
| Create | `packages/lib/tests/component/markdown-editor-guarded-removal-shortcuts.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `plans/in-progress/markdown-editor-raw-block-range-edits.md` (the notes) |
| Create | `plans/in-progress/markdown-editor-raw-block-range-edits-resumption.md` (this plan) |

The held branch's other files come over unchanged by the cherry-picks.

---

## Expected Behaviour

All unit-testable offline. Strings are `getValue()` as TypeScript literals.

### What each command does for each kind of point

| The point | A caret | A range's start | A range's end |
|---|---|---|---|
| in text, anywhere (a raw block, a code block, any other block) | stays | stays | stays |
| on a `:::` block | the start of the block after it | the start of the block after it | read past its container's start, then the end of the block before it |
| on the root or a `:::` column, between two blocks | stays (Lexical's) | the start of the block after it; **not moved** when a list follows, unless the range has an end in a raw or code block (step 2 then moves it to the list's first text) | read past the container's start, then the end of the block before it |
| on a list in a `:::` column | stays | not moved, unless step 2 | as the row above |
| on a list or a list item elsewhere | stays (the list item rules open an item or a paragraph there) | not moved, unless step 2 | not moved, unless step 2 |
| on a table, a table row or a table cell | stays | stays | stays |

After the points are settled, the guards remove the range:

| The range | Delete, Backspace, word and line delete, `REMOVE_TEXT_COMMAND`, the cuts | Enter, `INSERT_PARAGRAPH_COMMAND` | Shift+Enter | Tab, pasted or dropped nodes, `paste()`, `insertImage()` | typing, a plain-text paste, an input method |
|---|---|---|---|---|---|
| a guarded range (table-edge, an end in a raw or code block, stale-focus) | `$removeGuardedRange`; the delete commands leave a plainly removed range to Lexical | `$removeGuardedRange`, then Enter at the caret (`$handleRawBlockEnter` for a raw block) | judged first; then `$removeGuardedRange` | `$removeGuardedRangeForInsert` | `$removeGuardedRangeBeforeText` |
| starts just before a list, or has an end on a list or an item (no raw or code end) | the list item rules | removed first, then Enter (refilled when emptied) | a list or item end: declined; a start before a list: removed first unless the break would be declined | removed first (`$removeGuardedRangeForInsert`) | the list item rules |

Worked rows, each already in a test file and each green after the change:

| Row | Selection | Result |
|---|---|---|
| `TN1` (crash file) | `"raw"`@1 in `<div>⏎raw⏎</div>⏎⏎- la⏎- lb⏎⏎after` → the list before its first item | the same as the range to `"</div>"`@6: nothing of the list is in it |
| `TN8` | `"raw"`@1 → the `:::` block after it, before its first column | the same as the range to `"</div>"`@6 (it failed with both settle functions kept as written) |
| `TN10` | `"raw"`@1 → the second column, before its paragraph | the same as the range to `"ca"`@2 (failed the same way) |
| `TN12` | the list before the raw block, before its first item → `"raw"`@1 | the same as the range from `"la"`@0: `before⏎⏎- aw\⏎  \</div>⏎⏎after` after Delete |
| `TN21` | `"raw"`@1 → a table before its first row | the table goes whole, as for the range to `"a"`@0 |
| `Q1` (table-commands file) | `- one⏎- two`, the document before the list → the end of `two`, Tab | `'-'` |
| `P10h` | the same document, Enter over that range | `''`, as Delete then Enter |

### Rows in `markdown-editor-command-crashes.test.ts`

In the first code commit (step 4):

- `TS19` (link) is renamed `TS23` and runs for `TE82` alone: typing over a range in a document with no raw block keeps the bold of a link's text elsewhere in the block.
- Route rows, first in the first route-row table, with this comment: "Neither cut tags the update that removes the range for the run-edge rule: `cut()` carries no tag, as at the parent, and the native cut's tag marks the command's own update, while the removal follows in an update of its own. So a cut keeps the bold of a link's text elsewhere in the block, as the parent's cut did (TE82)."
  - `['TE82', 'cut()', 'x [**b**](/u)yz and m 7Y']`
  - `['TE82', 'CUT_COMMAND', 'x [**b**](/u)yz and m 7Y']`

In the caret commit (step 7):

- `TE83` is added back after `TE82`, as it is on the held tip, and `TS23` runs for `['TE82', 'TE83']`.
- Route rows before the `TE82` ones, and the comment above them becomes: "Neither cut tags the update that removes the range for the run-edge rule: `cut()` carries no tag, as at the parent, and the native cut's tag marks the command's own update, while the removal follows in an update of its own. So a cut leaves a run's edges as they are, where Delete tidies them (TE71), and keeps the bold of a link's text elsewhere in the block, as the parent's cut did (TE82)."
  - `['TE71', 'cut()', '> a **Note: (b)** z\n\nlast']`
  - `['TE71', 'CUT_COMMAND', '> a **Note: (b)** z\n\nlast']`
- The comment above `JOINT_ROWS` that starts "Nor has TE71 a cut() row" becomes: "Nor has TE71 a cut() row: neither cut tags the update that removes the range for the run-edge rule, so a cut leaves the bold that ends in punctuation beside the bold that opens with it as one run, where Delete tidies the two apart; the route rows of TE71 pin both cuts."
- New shape rows after `TE83`, in the shapes' format (`typed` is `x` typed over the range, `deleted` the range deleted, both directions), each red on the held tip:

| Row | What it tests | `source` | `start` → `end` | `typed` | `deleted` |
|---|---|---|---|---|---|
| `TE84` | the first body cell of a table in a raw list item | `'- \| h1 \| h2 \|\n  \| --- \| --- \|\n  \| a \| b \|\n- t\n  > q\n\nafter'` | `['  \| a \| b \|', 4]` → `['after', 5]` | `'- \| h1 \| h2 \|\n  \| --- \| --- \|\n  \| x \|  \|'` | `'- \| h1 \| h2 \|\n  \| --- \| --- \|\n  \|  \|  \|'` |
| `TE85` | the second body cell | `'- \| h1 \| h2 \|\n  \| --- \| --- \|\n  \| c \| d \|\n- y\n  > q\n\nafter'` | `['  \| c \| d \|', 8]` → `['after', 5]` | `'… \| c \| x \|'` (header and delimiter lines as `TE84`) | `'… \| c \|  \|'` |
| `TE86` | a raw list whose first item holds only a nested list, from the start of the next item's text | `'- - x\n- b\n  > q\n- c\n\nafter'` | `['- b', 2]` → `['after', 5]` | `'- - x\n- x'` | `'- - x\n-'` |
| `TE87` | the same with an ordered list nested in the first item | `'- 1. x\n- b\n  > q\n\nafter'` | `['- b', 2]` → `['after', 5]` | `'- 1. x\n- x'` | `'- 1. x\n-'` |
| `TE88` | right after the pipe that closes an empty last cell of a raw table | `'\| h1 \| h2 \|\n\| --- \| --- \|\n\| c \|  \| x \|\n\nafter'` | `['\| c \|  \| x \|', 8]` → `['after', 5]` | `'\| h1 \| h2 \|\n\| --- \| --- \|\n\| c \| x \|'` | `'\| h1 \| h2 \|\n\| --- \| --- \|\n\| c \|  \|'` |

(In the table `\|` stands for a plain `|`.)

- Restated (stale after minimal escapes): `TE48` `typed: '| a |\n| xfter', deleted: '| a |\n| fter'`; `TE49` `typed: '- a\n  x* yz'` (`deleted` stays `'- a\n  \\* yz'`); `TE73` `typed: '> esc x\\\\*e\n\nlast', deleted: '> esc \\\\*e\n\nlast'`. The five `TJ` rows of `TE48` then pass unchanged.
- `TK6` is renamed "a removal inside one raw block that leaves the caret right behind text reading as a shortcut completes no shortcut" and expects `'> a \\*x\\*q2'` in both contexts.
- `TL5` leaves the limit table (it is no limit under `marked` 18.1) and becomes its own row before `TL4`: "TL5: a tab between the words of the caret's own list item keeps the caret at the joint: `marked` 18.1 hands the tab back as written". Source `'- a\tb w\n  > q\n- b\n\nQZ 7Y'`, range `['- a\tb w', 7]` → `['QZ 7Y', 2]`, Delete inside an update; value `'- a\tb w 7Y'`; `rangeOf` `'"a\\tb w 7Y"@5 -> "a\\tb w 7Y"@5'`. The comment line above it in the limit table goes.

### Rows in `markdown-source-places.test.ts`

All in the caret commit (step 7).

- **New `SP16`**, an `it.each` placed directly before `SP15`, titled "SP16: a tab in a list item\'s text has its source found: %j", with the comment "`marked` 18.1 hands a tab between the words of a list item's text back as written, and reads `[x]` followed by a tab as text, not as a task item's checkbox: such text has its source found, and an offset in it has a place." It takes the 14 tab rows out of `SP7` and the two `- [x]\t` rows out of `SP8`, with these expected places:

| Marked Markdown | Expected place |
|---|---|
| `¦- [x]\tAlpha beta` and `- ¦[x]\tAlpha beta` | `[[[¦[x]\tAlpha beta]]]` |
| `- [x¦]\tAlpha beta` | `[[[[x¦]\tAlpha beta]]]` |
| `- [x]¦\tAlpha beta` | `[[[[x]¦\tAlpha beta]]]` |
| `- [x]\t¦Alpha beta` | `[[[[x]\t¦Alpha beta]]]` |
| `- a\n- [x]\t¦Alpha beta` | `[[[a]][[[x]\t¦Alpha beta]]]` |
| `1. [ ]\t¦Alpha` | `[[[[ ]\t¦Alpha]]]` |
| `- a\tb w¦ x` / `- a\tb w x¦` / `- a¦\tb w` | `[[[a\tb w¦ x]]]` / `[[[a\tb w x¦]]]` / `[[[a¦\tb w]]]` |
| `- a\tb\n  c¦ d` | `[[[a\tb{0§: }c¦ d]]]` |
| `1. a\tb¦ c` | `[[[a\tb¦ c]]]` |
| `- [ ] a\tb¦ c` | `[[[{0§:[ ] }a\tb¦ c]]]` |
| `- a\n  - b\tc¦ d` | `[[[a][[[b\tc¦ d]]]]]` |
| `- [x]\tA¦lpha beta` / `- [x]\tAlpha¦ beta` | `[[[[x]\tA¦lpha beta]]]` / `[[[[x]\tAlpha¦ beta]]]` |

  The comment in `SP7` that starts "A tab between the words of an item's text" goes with its rows.
- **`SP13`, hard line breaks (22 rows), restated.** `marked` 18.1's line break token takes the next line's leading blanks (the raw of `> a\\⏎>  cd`'s break is `\\⏎` and one blank), which no longer show. The documented rule applies: the caret is after everything whose source ends at or before the offset, and before the rest, so an offset inside the break's source, blanks included, is before the break. For that, the source analysis matches the blanks that open a line of the needle with the last blanks of the source's run (the first is the quote marker's own space), so the break's source ends after its own blank (`blanksOfContainerPrefix` in `markdownSourceTokens.ts`; the first version of this plan took the marker's space as the break's, which the review of the resumption found contradicts the rule). Measured, for the backslash break (the two-space break `"> a  \n…"` gives the same, row for row):

| Marked | Expected | | Marked | Expected |
|---|---|---|---|---|
| `> a¦\\\n>  cd` | `[a¦⏎cd]` | | `> a¦\\\n>   cd` | `[a¦⏎cd]` |
| `> a\\¦\n>  cd` | `[a¦⏎cd]` | | `> a\\¦\n>   cd` | `[a¦⏎cd]` |
| `> a\\\n>¦  cd` | `[a¦⏎cd]` | | `> a\\\n>¦   cd` | `[a¦⏎cd]` |
| `> a\\\n> ¦ cd` | `[a¦⏎cd]` | | `> a\\\n> ¦  cd` | `[a¦⏎cd]` |
| `> a\\\n>  ¦cd` | `[a⏎¦cd]` | | `> a\\\n>  ¦ cd` | `[a¦⏎cd]` |
| | | | `> a\\\n>   ¦cd` | `[a⏎¦cd]` |

- **`SP13`, a link inside a link's text (9 rows), restated.** `marked` 18.1 reads `[p [q](/u) r](/v)` as CommonMark does: the inner link wins, and the outer brackets are text. Each expected place keeps its offset and shows the outer brackets as text: `[a ¦[p ‹q› r](/v)cd]`, `[a [¦p ‹q› r](/v)cd]`, `[a [p ‹q› r](/v¦)cd]`, `[a [p ‹q› r](/v)¦cd]`, and the same five with a space before `cd` (`[a ¦[p ‹q› r](/v) cd]` … `[a [p ‹q› r](/v) ¦cd]`).
- **`SP10`:** `isKnown` gains a third cause, and its comment above names it:

```typescript
            // `marked` 18.1 hands a character reference back as the character it stands for.
            const holdsCharacterReference = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/.test(text);

            return indentsWithTab || repeatsLabel || holdsCharacterReference;
```

- **`SP15`** gains these rows, each green after the change and each failing for one single change of the new code:

| Marked | Expected place | Fails without |
|---|---|---|
| `- \| h1 \| h2 \|\n  \| --- \| --- \|\n  \| ¦ \|  \|` | `[[[[[[h1]][[h2]]][[[¦]][[]]]]]]` | asking the tables after an item that shows something |
| `- \| h1 \| h2 \|\n  \| --- \| --- \|\n  \| c \| ¦ \|` | `[[[[[[h1]][[h2]]][[[c]][[¦]]]]]]` | the same |
| `- a\n- \| h \|\n  \| --- \|\n  \| ¦ \|\n- b` | `[[[a]][[[[[h]]][[[¦]]]]][[b]]]` | the same |
| `- - x\n- ¦` | `[[[[[x]]]][[¦]]]` | keeping every item (the dropped filter) |
| `- 1. x\n- ¦` | `[[[[[x]]]][[¦]]]` | the same |
| `- a\n  - b\n  - ¦\n- c` | `[[[a][[[b]][[¦]]]][[c]]]` | taking the innermost item (`Math.max`) |
| `\| h1 \| h2 \|\n\| --- \| --- \|\n\| c \|  \|¦` | `[[[[h1]][[h2]]][[[c]][[¦]]]]` | the last cell after the closing pipe |
| `h1 \| h2\n--- \| ---\nc \| ¦` | `[[[[h1]][[h2]]][[[c]][[¦]]]]` | the leading-pipe test |
| `\| h1 \| h2 \| h3 \|\n\| --- \| --- \| --- \|\n\| c \\\| e \| ¦ \| f \|` | `[[[[h1]][[h2]][[h3]]][[[c \| e]][[¦]][[f]]]]` | the escaped-pipe lookbehind |
| `\|  \| h2 \|\n\| ¦--- \| --- \|\n\| c \| d \|` | `[[[[]][[h2]]][[[¦c]][[d]]]]` | the delimiter-line test |
| `- \n¦\n- c` | `[[[]][[¦c]]]` | the blank check of `isWithin` |

(In the table `\|` stands for a plain `|`, and `\\\|` for an escaped pipe, `\|` in the Markdown.)

### The shortcut rows file

`packages/lib/tests/component/markdown-editor-guarded-removal-shortcuts.test.ts` is the file of that name at `9e0207a92`, with these changes:

- Delete every `it.each` from `TY2` to the end of the `describe`, and close the `describe`.
- Delete what only the deleted rows used: the type `Insertion`, the constant `INSERTIONS`, and the functions `insert`, `transferOf` and `select`, each with its JSDoc. Check: every name declared at module level is used below it.
- In `KINDS`, the code fence's saved text becomes the minimal escape: `['a code fence', '\\`\\`\\` ;cd', '\\``` cd', '```\ncd\n```']`.
- The header comment becomes: "MarkdownEditor's typing shortcuts and the removals of its guarded ranges (plans/markdown-editor-raw-block-range-edits.md): a range removed from escaped text into a raw block completes no shortcut, whatever the text before the joint reads as afterwards; the character that completes one, typed over such a range, completes it as typing it after the removal does."

It holds 42 tests: `TY1`, `TY1b` and `TY1c` over the 14 kinds.

### Manual (browser) checks

None new. Every change is offline-testable, and no click makes a point on a container. The held plan's manual checks of an input method and of a drag over the selection stay as they were signed off.

---

## Verification

- `npm run typecheck`, `npm run typecheck:test`, `npm run lint` from `packages/lib`: clean.
- Each code commit's own files, as steps 4, 5 and 7 give them.
- The full suite once, `npx vitest run --maxWorkers=2`: no failure.
- `npm run docs:api` with zero warnings; `npm run docs:llms:check`.
- Greps: `grep -n 'settleSelectionBeforeGuard\|GUARDED_DELETION_TAG\|removeGuardedRangeAsDeletion\|replaceEmptiedContainerAtCaret' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` gives no match. `grep -n 'settleSelectionOffContainers(' …/MarkdownEditor.ts` gives six lines: the definition, `$removeGuardedRange`, `$settleSelectionBeforeEnter`, the `guard` wrapper, `insertTable` and `insertImage`. `grep -c 'settleTextOnlyEdgeEnds(' …/MarkdownEditor.ts` gives 2.

What the prototype measured, in private copies (worktrees detached at the commits named, `node_modules` symlinked):

| Run | Result |
|---|---|
| The held tip `9e0207a92` on its base, full suite | 566 files, 20,380 tests, **92 fail** (see the addendum) |
| The two settle functions kept as written, on `54bbd0dd3` (the same `MarkdownEditor.ts` as `5f5ac474b`), eight focused files | 60 fail: 58 stale rows, and `TN8` and `TN10`, the two real conflicts |
| The remove-first reading for a range with a list start and an end in a raw block | `TN12` and `TN13` differ on all 19 routes; typed text lands in the next block (`before⏎⏎aw⏎⏎</div>⏎⏎xafter`) or a new list item |
| This plan on `5f5ac474b`, commit by commit (`594cdd595`, `55b838e78`, `feb7e5608`, `715b55c8f`): the first code commit's four files / the second's three / the caret commit's three / the shortcut rows | 907 / 920 / 1,570 / 42, all pass |
| This plan on `5f5ac474b`, full suite | 572 files, 20,992 tests, 0 fail, 2 todo; both typechecks and eslint clean; typedoc 0 warnings; llms coverage OK |
| The same on `54bbd0dd3`, the tip before named references closed | 570 files, 20,619 tests, 0 fail, 2 todo |
| Review 7's own probe (`zz-r7-ed.test.ts`) over its 26 scenarios | the three shapes give the parent's result. The scenarios of escaped text before a removal now complete no shortcut on any removal route (the general rule below), which closes the review's advisory that Delete and a cut differed there. Every other scenario is as on the review's tip |

---

## Documentation Impact

On `c67184128` (step 9):

- `packages/lib/docs/components/MarkdownEditor.md`, the last sentence of the *Kept as source* paragraph: replace the list of shapes after "because Markdown's lexer hands that text back otherwise than it is written:" with "a list item's line that a tab indents and that shows as spaces, a task item whose checkbox is followed by more than one space in a list with blank lines between its items, text of a list item that begins as a link reference definition repeated before it does, or a character reference such as `&#35;`, which shows as the character it stands for."
- `packages/lib/docs/reference/changelog/next.md`, the entry "The caret keeps its place when an edit makes a raw Markdown block show as rich text": the same list, wrapped as the entry is.

No public API changes; no page or catalog entry is added. `MarkdownEditor.md`'s sentence "Where the item of a list or the cell of a table that holds the caret shows nothing, the caret stays in that item or cell, never in the text of the one beside it" is true again and stays.

---

## What the four plans waiting on this branch need

| Plan | Does its premise hold? | What it needs before it starts |
|---|---|---|
| `markdown-editor-cross-item-range-removal` | Yes: every symbol its steps name exists with the role it expects, `$removeGuardedRange` opens with the one settle call, and `guard(DELETE_CHARACTER_COMMAND, $deleteGuardedRange)` is one row | Its `$removeGuardedRange` snippet must drop `$addUpdateTag(RUN_EDGE_TAG);`: put `$joinCoveredItemTexts(selection)` directly before `if (isTableEdge)`. Its step 1 grep for `$isStaleFocusRange(` now also finds `$clearGuardedRangeBeforeParagraph` and `$clearGuardedRangeBeforeLineBreak`: name them, and add `$isCrossItemRange` to their test for a range with a removal of its own. The rows that type or press Enter over a range ending in a raw block of a list item must be measured again with the caret at the joint. Every mention of `$removeGuardedRangeAsDeletion` and of a removal route's tag goes. |
| `markdown-editor-list-looseness-transform-cost` | Partly. Row `L8` starts by appending a raw block holding one space to an item in code; the raw-block rule now shows such a block as `paragraph(" ")` at once, so `L8`'s start state and its expected tree (`markdown-raw-block("<div> ")`) no longer arise | Measure `L8` again from the state the editor now makes, or drop it; its addendum's defect ("typing into a raw block of a list item that held only whitespace") cannot be reached any more |
| `markdown-editor-large-document-costs` | Yes, but for one printed function | The printed `$showRawBlockAsSaved` of its `markdownWritable.ts` part (a changed block checks the raw blocks its change reaches) lacks the step `$showBlankRawBlockAsParagraph` (between `$showSiblings` and `$showRawBlockAsItsBlocks`) and its JSDoc clause "as a paragraph when it holds nothing"; print them |
| `markdown-editor-reload-differences` | No, for its first rule, that the looseness typing rule reads a raw block. A raw block of blanks no longer exists outside a load: deleting a raw block's text leaves `paragraph()`, a space typed there gives `paragraph(" ")`, and `<p>` typed after it gives `paragraph(" <p>")`, saved `- a\n\n  \\<p>` (its rows `L1` to `L3`, typing and deleting in a raw block of a list item, expect `markdown-raw-block(" ")`). Its addendum's group "emptied raw block" (245 cases) is resolved by this branch. Its other rules (a line break in a table cell, a line end in a text, the indent command, blanks at a line's start) do not touch this branch's code | Re-scope that rule against the paragraph the editor now makes, or drop it; re-run its reload differential on this branch's tip |

---

## Potential Challenges

- **A cherry-pick meets a conflict this plan does not list.** Stop and compare with the prototype: the held branch's commits applied onto `5f5ac474b` with exactly the conflicts listed, and the procedure reproduced the prototype's documentation commits byte for byte.
- **`git apply -3` and conflicted cherry-picks record into the conflict cache.** Pass `-c rerere.enabled=false`, so a later rebase of another branch is not resolved by this one's choices.
- **The `TE82` cut rows placed at the end of the route-row table** conflict with `32f5ea7c9`, which appends the `TE62` rows there. Put them first in the table.
- **`TS19` is used twice on the held tip**, for the link row and for a `TE62` Shift+Enter row. The rename to `TS23` removes the duplicate; do not renumber the other.

---

## Critical Files

- `MarkdownEditor.ts` on `5f5ac474b`: `$settleSelectionOffContainers` (:2318), `$settlePoint` (:2268), `$pointNeedsSettling` (:2247), `$liesBetweenBlocks` (:2200), `$standsBeforeList` (:2177), `$isRangeStartingBeforeList` (:2215), `$endsListOfColumn` (:2231), `$isListContainerRange` (:2365), `$openBlockAtItemCaret` (:2413), `$removeGuardedRangeForInsert` (:2448), `$removeGuardedRange` (:2640), `$removeRangeBeforeImage` (:2674), `$clearGuardedRangeBeforeParagraph` (:2733), `$clearGuardedRangeBeforeLineBreak` (:2868), `registerRangeGuards` (:4500, the `guard` wrapper — the precedent), `$settleRangeEndsInward` (:4986), `$moveBlockPointsIntoText` (:4935), `$standsOnHolder` (:3439).
- `MarkdownEditor.ts` on `9e0207a92`: `$settleTextOnlyEdgeEnds` (:2620), `$settleSelectionBeforeGuard` (:2645), `$removeGuardedRange` (:2535), `$keepAsEditorSelection` (:2665), `$joiningRemovalDeclinesLineBreak` (:1904).
- `markdownSourcePlaces.ts` on `9e0207a92`: `$emptyBlockAt` (:288), `$emptyCellAt` (:321).
- `plans/implemented/markdown-editor-table-command-fixes.md`, its decisions on points where no caret can be and the first item of its Implementation Notes; `plans/implemented/markdown-editor-tab-over-range-before-list.md`.
- The held plan, `plans/in-progress/markdown-editor-raw-block-range-edits.md` on the held branch, its *Implementation Notes*.
- Review 7: `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/impl/raw-block-range-edits/review7/REPORT.md`.

---

## Non-Goals

- **The other shapes of the caret's fallback.** They stay as documented; only the character reference is added and the two tab shapes go.
- **Making a cut tidy as Delete does.** The owner's rule of round 7 stands.[^cut-tag]
- **A range between two container points** (`list@0` → `item@1`), which `markdown-editor-tab-over-range-before-list` lists as left.
- **Proving the two count guards of `$emptyBlockAt` reachable.** They stay as they are.[^mutants]
- **Defects the review probe met beside the three shapes**, as at the parent. They are on the known-issues list (`scratch-keep/known-issues-2026-10.md`), not covered here.

---

## Addendum: The failing tests, classified

On the held tip `9e0207a92` (its base has `marked` 18.1 and the general typing-shortcut rule below it), 92 tests fail. The branch's round-7 notes counted 43 after the rebase onto the typing-shortcut branch; the 49 more came with the later rebase onto the `marked` upgrade, for which the suite was not run.

| Rows | Count | Class | Cause | Fix in this plan |
|---|---|---|---|---|
| `TY3`, `TY4`, `TY5` of `markdown-editor-guarded-removal-shortcuts.test.ts` | 42 | stale | the general typing-shortcut rule: a paste, a drop and a deletion complete no shortcut | rows dropped |
| `TK6` | 1 | stale | the same | restated: no shortcut |
| `TL5` | 1 | stale | `marked` 18.1 hands a tab between words back as written | restated: the caret at the joint |
| `SP7` tab rows, `SP8` tab rows | 14 + 2 | stale | the same, and `[x]` followed by a tab is text | moved to `SP16`, with places |
| `SP13` hard line breaks | 22 | 18 stale, 4 real | the line break token takes the next line's leading blanks; the source analysis took the quote marker's own space as the break's, which put four offsets on the wrong side of the break | 18 restated by the existing convention; 4 fixed in the analysis (`blanksOfContainerPrefix`), the rows restated to the documented rule |
| `SP13` link inside a link's text | 9 | stale | `marked` 18.1 reads nested links as CommonMark does | restated |
| `SP10` | 1 | real, a gap in the fallback list | `marked` 18.1 decodes a character reference in text | named as a fallback shape (code of the test, docs) |

On the chain's top, once rebased, 11 more fail, all stale after minimal escapes: `TE48`, `TE49`, `TE73` and the five `TJ` rows of `TE48` in the crash file, and the code-fence kind of `TY1`, `TY1c` and `TY2` in the shortcut rows file (the saved form is now `` \``` ``). No failure is a harness fault, and none is a regression of the editor.

---

## Notes

[^one-function]: A second function in a fixed order would have worked too, and was measured first: both settle functions kept as written, the table-command one first, as the guard wrapper orders them. Eight focused files then failed 60 tests. 58 were stale rows, and two were real: `TN8` and `TN10`, a range from a raw block to the start of a `:::` block or a column, whose end the table-command rule moved forward into the next column's text, which the raw-block removal then joined. The review of `markdown-editor-table-command-fixes` named the order as the risk. One function with two numbered steps makes the order part of the code, and leaves one function to call. It also removes thirteen listener registrations that only settled.

[^end-only]: The table-command rule moves a point to its preferred side and, when its container has nothing there, to the other side of the same container. For a range's end at a container's start that is forward, into the first block of the container: the range then covers that block's start, and Delete joins the block onto the range's start block, although nothing of it was selected. Reading the end in document order fixes `TN8` and `TN10` and changes no row of either table-command branch. The same reading was tried for a range's start at a container's end. It broke one case of the paragraph-break matrix of `markdown-editor-table-commands.test.ts` (`::: columns⏎A⏎|||⏎- one⏎- two⏎:::`, a range from the end of the first column): the start went into the list's first item, and Enter then left an empty item where Delete-then-Enter did not. So starts keep the table-command rule.

[^table-shadow]: Seen while the end-reading change was tested: `TN21` and `TN24` (a range from a raw block to a table before its first row, or from after its last row) failed once the end climbed out of the table. That showed the table and the row being settled at all. Before this change the table-command fallback happened to move such an end into the table's first cell, so the range stayed a table-edge range by accident. `TableNode`, `TableRowNode` and `TableCellNode` each declare `isShadowRoot()` in `@lexical/table`'s `LexicalTable.dev.mjs`.

[^lists-inward]: The remove-first reading was built and measured for every range with a list point: step 2 limited to a range's end on a list or an item when the range starts in a raw or code block, and starts on lists left to remove-first. `TN12` and `TN13` (a list before the raw block, the range from before its first item or after its last item into the raw block) then differed from the text-point range on all 19 routes, in every direction and context. Lexical's removal from a point on a list or on the document leaves the caret on that container. The raw block's re-read then moves the blocks around it, and the caret ends up before the next block: typing over `TN12`'s range saved `before⏎⏎aw⏎⏎</div>⏎⏎xafter`, the `x` in a paragraph that was never selected. Over `TN13`'s range, typing opened a new list item. Remove-first works for the table-command branches because there the range ends in text that stays, and `$openBlockAtItemCaret` gives a caret left on a list its block. Here the caret is left on a container beside a block that the re-read replaces. The inward reading gives the range a reader sees, and every route then acts as after Delete of that text range, which is the held branch's contract. It is limited to the ranges that the raw-block removal takes, where the list item rules never run.

[^enter-listener]: The first version of this note gave as its reason a range from the document before a raw block into a paragraph; review 1 could not reproduce a difference there, and a search of about 33,000 selections (element points of the root, lists, items, `:::` blocks, columns and tables against element and text points, in nine documents with raw blocks, code blocks, tables, columns and lists; Enter plain, inside an update and with Shift) found the real cases, all in two shapes where an element point settles into a raw block only once settled: a range from the document point just after a raw block to a `:::` block that follows it (or to its first column), and a range from the end of a column that holds a raw block to a paragraph outside the column. Without the listener `$handleRawBlockEnter` sees no raw block at either end, and the paragraph command splits where the raw-block Enter would add a line; with it, Enter equals Delete then Enter. Rows `E4` and `E5` of `markdown-editor-table-commands.test.ts` pin both and fail without the registration. A listener of its own keeps `$handleRawBlockEnter` unchanged and reads like the guards.

[^no-squash]: Squashing into fewer commits was weighed. The held branch's commits are already one functionality each, with their own documentation commits, as the commit skill requires. Its fix history was folded in round 7. A squash would merge the caret-place module into the route removal, which the owner signed off as separate decisions. The rebase conflicts all fall in one code commit and three documentation commits, so a commit-by-commit replay costs no more. Folding each fix into its owner also answers review 7's fourth finding (the first commits failing their own rows). It was checked: each code commit passes its own files after the replay.

[^cut-tag]: Measured in the prototype: tagging both cuts' removal updates with `RUN_EDGE_TAG` makes them equal Delete on `TE71`. But the cuts then also drop the bold of a link's text in `TE82` and its table-edge variant, documents with no raw block, where the parent's cut kept it (`x [b](/u)yz and m 7Y` against the parent's `x [**b**](/u)yz and m 7Y`). That breaks the owner's round-7 rule (a route carries the tag exactly when it carried it at the parent), and was taken out again.

[^mutants]: Each condition of `$emptyBlockAt` and `$emptyCellAt` was changed alone, and the place of 64 hand-picked Markdown texts was compared (`tools/mut_places.py` in the planner's scratch folder). Seven of the nine changes now change the place of at least one text, and the `SP15` rows above are those texts. The two that change none are the guards that the editor's items and the source's items, and the editor's tables and the source's tables, are equal in number. No text was found where they differ, and the guards keep an index from pointing at the wrong item if a lexer change ever makes them differ. They stay as they are.

[^charref]: In the round-trip corpus, 72 (text, offset) pairs have no place where the old rule expected one: `&#35; next`, `&#42;foo&#42;`, `[a&#35;b]` and their prefixes. Under `marked` 18.1 the text token holds `#` where the source holds `&#35;`, so the analysis does not find it. Finding its source is possible, as was done for a link text holding an escaped bracket, but the scope is frozen, so the shape is named and finding its source is on the known-issues list. Verified on `5f5ac474b`, which holds `markdown-named-character-references`: the `SP10` row passes with the regular expression above, named references included.

[^own-removal]: The two guards ask whether a range has a removal of its own that remove-first must not replace. A range with an end in a raw or code block never reaches their remove-first branch with a list point left, since step 2 moved it. Adding the text-only-edge shape to that test would send such a range, in the rare case step 2 finds no block of text to move to, through the raw-block removal with a point on a list, the crash the held branch's rule was built for.

[^break-blanks]: Under `marked` 18.0 those blanks showed, and an offset among them was after the break. Now they belong to the break's source, and the rule puts a caret among them (after the quote's own marker space, before the break's last blank) before the break. A range that starts there, typed over, puts the typed text at the end of the line before. The case needs a raw quote whose later line opens with extra spaces, and the result is what the documented rule gives. Review 1 of the resumption found the first version of this plan wrong at four offsets: it let the analysis match the break's blank with the quote marker's own space, so the offset right after the marker was read as after the break. The matching is fixed instead (`blanksOfContainerPrefix`).

[^ty-file]: Moving the three rows into `markdown-editor-typing-shortcuts.test.ts`, as that plan's closing section suggests, would carry about 300 lines of helpers (`selectIntoRaw`, `joinedWithRaw`, `remove`, the `KINDS` table) into a file about typing. The rows are about the range guards' removal. A file of their own keeps both readable, and the file name is the one the held branch already gave them.

---

## Implementation Notes

Implemented on `feature/markdown-editor-raw-block-range-edits`, recreated on
`5f5ac474b` by cherry-pick as the steps say. The branch has eleven commits:
the nine replayed or new commits of steps 2 to 10, this plan's own commit,
and the notes commit of step 12. The plan counts ten commits after step 11;
that count assumed this plan was added at step 3, which would have made it
the second commit. It was added right after step 11, as the orchestrator
asked, so that the replayed commits are the held branch's alone: at step 11
the branch has nine commits, and ten with this plan.

- **The owner's question is answered.** The recommendation was taken: a
  selection that starts on or just before a list and ends inside a raw
  block keeps the held branch's inward rule (step 2); remove-first stays for
  every other range.
- **Where the code differs from the prototype branch.** The commit
  comparisons with the prototype print only cosmetic differences, none in
  behaviour: the Enter listener and its JSDoc stand directly before
  `registerRangeGuards`' own JSDoc (the prototype put the listener between
  that JSDoc and its function, which attached the JSDoc to the wrong
  function); `$pointNeedsSettling` is as it is on the chain; the names of
  rows `TE84`, `TE86` and `TE87` are the plan's wording; a few comment
  lines are wrapped differently; the shortcut rows file is written from the
  plan's description, with the imports that only the deleted rows used
  removed.
- **A row's expected text.** In `TL5`, `rangeOf` writes a tab as the two
  characters backslash and `t`, so the expected string holds a doubled
  backslash, as the plan's literal says.
- **Measured.** Step 4: 907 tests pass (four files). Step 5: 920 (three
  files). Step 7: 1,570 (three files). Step 8: 42. The full suite on the
  tip: 572 files, 21,041 passed and 2 todo (21,043), none failing (the
  counts of steps 4 to 8 are those measured at the steps, before the review
  rounds added rows). Both
  typechecks and eslint are clean; `npm run docs:api` gives no warning and
  `npm run docs:llms:check` reports coverage OK.
- **Nothing was run in a browser**; the plan names no manual check.
- **Out of scope, not changed.** No defect outside the plan was found.
- **Review 1 of the resumption.** Four blocking findings and several smaller ones
  were fixed as fixups of the commits that own them. (1) The Enter listener
  was kept: a search of about 33,000 selections found two shapes in which it
  matters, now rows `E4` and `E5` (see the note on the listener); the
  plan's example was wrong and is corrected. (2) Four hard-break rows
  contradicted the documented rule; the analysis now matches a line's
  opening blanks with the last blanks of the source's run, and the rows and
  the table above follow the rule. (3) The `$placeOfSourceOffset` JSDoc
  lists the fallback shapes of `marked` 18.1 as the docs do. (4) The held
  plan's notes were corrected where they still named `TS19` for the link
  row, the tab shape as the fourth fallback, the settle listeners, and the
  dropped tag. Smaller: the `$removeGuardedRange` JSDoc says which command
  dispatches the tagged update for Enter, `$emptyCellAt`'s `@returns` is
  narrowed, and the corpus count in `SP10`'s comment is re-measured (17,699).
- **Review 2 of the resumption.** The older pass `keepLastOfLeadingBlanks` is
  removed: with the analysis matching a line's opening blanks itself, it
  changed no result in any Markdown test file (nor the 17,699-place corpus).
  The `>` exception of `blanksOfContainerPrefix` is removed: no row needed
  it, it contradicted the function's own description, and in a quote inside
  a list item it gave places against the rule (a code block in a list item
  is placed by its own text, and gives the same place with or without the
  exception). Rows `SP17` (the indentation after a hard line break in a list
  item, 44 rows, 20 of which fail without the fix) and `SP18` (a quote in a
  list item, 3 rows, which fail with the exception back; a code block in a
  list item, 2 rows, which pass either way and only pin the answer) pin the
  rule. Smaller: the JSDoc of `$emptyCellAt` and `$placeOfSourceOffset`, the
  reflow of the `$removeGuardedRange` paragraph, the describe title of `E4`
  and `E5`, and this plan's failing-test table (four of the 22 hard-break
  rows were real) are corrected, and the held plan's notes no longer say the
  analysis takes the first blank. The other offsets in a quote inside a list
  item after a hard break (among them the offset right before the `>`), and
  the soft-line-end case in that shape, are left as they are (known issues);
  they are the same as before this fix round, and differ from the base
  `5f5ac474b`, where `$selectCaretAfterReRead` put the caret at the block's
  end.
- **Review 3 of the resumption.** Texts only: the `@returns` of
  `$emptyCellAt` (an offset before a row's opening pipe is in the row's
  first cell), the counts above, the paragraph of the held plan on the
  analysis and the removed pass, the comment of `SP18`, and the
  `blanksOfContainerPrefix` description (a run ending at a further `>` is
  counted whole). The `limit` bound of `blanksOfContainerPrefix` is dropped:
  no input changed with it.
