---
depends-on: [markdown-editor-table-command-fixes]
touches-shared: [packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts, packages/lib/tests/component/markdown-editor-table-commands.test.ts]
---

# MarkdownEditor Range Before a List — Implementation Plan

## Overview

In the WYSIWYG `MarkdownEditor`, Tab over a range that starts just before a list throws. Load `- one\n- two`, select from `root@0` (an element point on the root, before the list) to the end of `two`, and dispatch `INSERT_TAB_COMMAND`: Lexical throws "Expected node ListNode of type list to have a block ElementNode ancestor". Pasting or dropping a copied word over the same range throws the same way, and pasting a copied paragraph turns the list into a paragraph (`zz`) where Delete then the paste gives `- zz`.

`markdown-editor-table-command-fixes` made Enter remove such a range first (`$clearGuardedRangeBeforeParagraph`, [MarkdownEditor.ts:2726](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2726)). This plan gives the same remove-first step to every insert that goes through `$removeGuardedRangeForInsert` ([:2444](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2444)), makes Enter over a range that empties a list act as Delete then Enter, and settles Shift+Enter over a range that starts before a list. The change is three functions in `MarkdownEditor.ts` and one new helper. The P12 matrix in `markdown-editor-table-commands.test.ts` gains Tab and the two inserts.

A *range that starts before a list* is a non-collapsed selection whose start, in document order, is an element point on the root or a `:::` column whose child at that offset is a list (`$isRangeStartingBeforeList`, [:2214](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2214)). A *list-container range* has an end that is an element point on a list or a list item (`$isListContainerRange`, [:2364](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2364)). No click makes either; code and Lexical's own removals do.

---

## Architecture Decisions

### Remove first, in the one place inserts go through

`$removeGuardedRangeForInsert` removes a range that starts before a list with `removeText()`, as it already removes a list-container range, and then gives the caret a block when the removal left it on a list or item (`$openBlockAtItemCaret`). Tab (`$clearGuardedRangeBeforeInsert`) and inserted clipboard nodes (`$clearGuardedRangeBeforePaste`: a paste or drop of copied words or blocks) reach it; each then inserts at the caret Delete would leave. `insertImage()` already removes every range first.[^remove-first]

The precedent is `$clearGuardedRangeBeforeParagraph`'s remove-first branch and `$removeGuardedRangeForInsert`'s own list-container branch, both from `markdown-editor-table-command-fixes`.

| Range in `- one\n- two` | Command | Before | After (= Delete, then the command) |
|---|---|---|---|
| `root@0` → end of `two` | Tab | throws | `-` (the tab in the blank item's text; a save trims it) |
| same | insert a copied word `zz` | throws | `- zz` |
| same | insert a copied paragraph `zz` | `zz` (a paragraph) | `- zz` |
| same | typing `x` | `- x` | `- x` (control: the list item rules already remove it) |

### Enter over a list-container range runs where Delete leaves the caret

`$clearGuardedRangeBeforeParagraph` takes a list-container range through its remove-first branch too. After `removeText()`, when the caret stands on a list or item the removal left empty, the branch refills it and returns `false`, so Lexical's Enter runs at the blank item and leaves the list, as after Delete. When the caret stands between blocks that stay, the block `$openBlockAtItemCaret` opens is Enter's effect, and the branch returns `true`.[^enter-emptied]

| Range | Before | After (= Delete, then Enter) |
|---|---|---|
| `- one\n- two`, `list@0` → end of `two` | `-` | empty (one empty paragraph) |
| `- one\n- two`, `root@0` → end of `two` (P10h) | empty | empty (unchanged) |
| `Above\n\n- one\n- two`, `list@0` → end of `one` | `Above\n\n-\n- two` | unchanged (the item stays between blocks) |

### Shift+Enter over a range from before a list — removed first unless the break would be declined

`$clearGuardedRangeBeforeLineBreak` removes such a range first, as Enter does, and lets Lexical put the break where that leaves the caret. It declines before removing anything when the break could not be written there: the caret lands in the block the range ends in, so the test is `$lineBreakUnwritableAt(end)`. That keeps the decline rule of `markdown-editor-table-command-fixes`: a declined Shift+Enter changes nothing, range and all.[^shift-enter]

| Range | Shift+Enter | Why |
|---|---|---|
| `Above\n\n- one\n- two`, `root@1` → end of `two` | declined, nothing changes | after the removal nothing would follow the break in its item |
| `- one\n- two`, `root@0` → start of `two` | a hard break before `two` (`'- \\\n  two'`) | the break goes before `two`, as after Delete |
| `Above\n\n- one\n- two`, `root@1` → `two`@1 | `Above\n\n- wo`, as after Delete | a stale-focus range: its own guard, unchanged |

This is the plan's sign-off question; see `## Sign-off`.

---

## Sign-off

| Question | Options | Recommendation |
|---|---|---|
| Shift+Enter over a range from just before a list (`root@1` → end of `two`) changes nothing, while Enter removes the range. Align it? | **A.** Remove the range first, as Enter does, and put the break where that leaves the caret; decline before removing when the break could not be written there. **B.** Remove the range and drop the break, as Delete then a declined Shift+Enter leaves it. **C.** Decline every such range. | **A.** The `root@1` → end-of-`two` case still changes nothing, now by the decline rule (nothing would follow the break), and a range ending at a text's start keeps working (a hard break before `two`). B breaks "a declined Shift+Enter changes nothing"; C stops 45 measured cases that work today. |

---

## Implementation

All in [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts).

`$removeGuardedRangeForInsert` ([:2444](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2444)):

```ts
function $removeGuardedRangeForInsert(selection: BaseSelection | null, caretStaysOutOf: ((node: LexicalNode) => boolean) | null = null): boolean {
    const removed = $removeGuardedRange(selection, caretStaysOutOf);
    const removesFirst = !removed && ($isListContainerRange(selection) || $isRangeStartingBeforeList(selection));

    if (removesFirst) {
        selection.removeText();
    }

    return $openBlockAtItemCaret(selection);
}
```

`$clearGuardedRangeBeforeParagraph` ([:2726](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2726)):

```ts
function $clearGuardedRangeBeforeParagraph(): boolean {
    const selection = $getSelection();
    const isGuarded = $isTableEdgeRange(selection) || $isStaleFocusRange(selection);
    const removesFirst = !isGuarded && ($isRangeStartingBeforeList(selection) || $isListContainerRange(selection));

    if (removesFirst) {
        selection.removeText();

        // A list or item the removal emptied is refilled, and Lexical's Enter
        // runs at that blank item and leaves the list, as after Delete. A
        // caret left between blocks that stay gets its block, which is what
        // Enter does there.
        const container = $listContainerAtCaret(selection);
        const wasEmptied = container !== null && container.isEmpty();
        const opened = $openBlockAtItemCaret(selection);

        return opened && !wasEmptied;
    }

    return $removeGuardedRangeForInsert(selection);
}
```

`$clearGuardedRangeBeforeLineBreak` ([:2855](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2855)) and its new helper:

```ts
function $clearGuardedRangeBeforeLineBreak(): boolean {
    const selection = $getSelection();
    const isGuarded = $isTableEdgeRange(selection) || $isStaleFocusRange(selection);
    const removesFirst = !isGuarded && $isRangeStartingBeforeList(selection);
    // Between the blocks of a list item, or the items of a list, there is no line to break, and Lexical's insert
    // throws there: for a caret, and for a range that starts or ends there, before anything of it is removed.
    const declined = $guardedRemovalDeclinesLineBreak(selection) || $startsOnListContainer(selection) || $isListContainerRange(selection)
        || (removesFirst && $beforeListRemovalDeclinesLineBreak(selection));

    if (declined) {
        return true;
    }

    // A range from just before a list is removed first, as Enter removes it ({@link $clearGuardedRangeBeforeParagraph}).
    if (removesFirst) {
        selection.removeText();
        $openBlockAtItemCaret(selection);

        return false;
    }

    $removeGuardedRange(selection);

    return false;
}

/**
 * Whether Shift+Enter over a range that starts just before a list
 * ({@link $isRangeStartingBeforeList}) would have its line break declined
 * once the range is removed: the removal leaves the caret in the block the
 * range ends in, ahead of what that block holds after the range.
 *
 * @param selection - A range that starts just before a list, left as it is.
 * @returns Whether the break would be declined.
 */
function $beforeListRemovalDeclinesLineBreak(selection: RangeSelection): boolean {
    const [, end] = $orderedPoints(selection);

    return $lineBreakUnwritableAt(end);
}
```

---

## Ordered Implementation Steps

1. **Write the tests first** in `packages/lib/tests/component/markdown-editor-table-commands.test.ts`, inside `describe('P12: the matrix', …)` ([:660](../packages/lib/tests/component/markdown-editor-table-commands.test.ts#L660)):
   - Import `INSERT_TAB_COMMAND`, `$createParagraphNode`, `$createTextNode` from `lexical`, and `$insertGeneratedNodes` from `@lexical/clipboard` (the file's `vi.mock` keeps the real module).
   - Add `'- one\n- two'` to `DOCUMENTS` ([:669](../packages/lib/tests/component/markdown-editor-table-commands.test.ts#L669)), after `'- one\n  - two\n- three'`.
   - Add a helper `insertCopied(editor, asBlock)` above `COMMANDS`: in one discrete update, `$insertGeneratedNodes(lexicalOf(editor), [asBlock ? $createParagraphNode().append(word) : word], $getSelection()!)` with `word = $createTextNode('zz')`. Doc: "Inserts what a paste or drop of copied content inserts: a word, or a paragraph holding it."
   - Add to `COMMANDS` ([:776](../packages/lib/tests/component/markdown-editor-table-commands.test.ts#L776)), after `'typing x'`: `['Tab', … INSERT_TAB_COMMAND …, false]`, `['inserting a copied word', (editor) => { insertCopied(editor, false); }, false]`, `['inserting a copied paragraph', (editor) => { insertCopied(editor, true); }, false]`. Add the three names to `removes` in the removal test ([:1009](../packages/lib/tests/component/markdown-editor-table-commands.test.ts#L1009)).
   - Add `INSERTS` (the same three) and a test `it.each(DOCUMENTS)('an insert over a range from just before a list to the end of a text lands where Delete then the insert does: %j', …)` before the removal test. Model it on `placementOf` and its Enter test ([:930](../packages/lib/tests/component/markdown-editor-table-commands.test.ts#L930), [:975](../packages/lib/tests/component/markdown-editor-table-commands.test.ts#L975)): set the range from a container point to the end of a text in both directions; compare only when the container point is the range's start (`isBackward ? selection.isBackward() : !selection.isBackward()`), the container is the root or a column, and `container.getChildAtIndex(point.offset)` is a list; run the insert, or Delete then `editor.getValue()` then the insert; compare `save | caretOf | rootTypes`; skip `NO_BROWSER_SELECTION`.
   - Add the rows of `## Expected Behaviour` (Q, E, S) as a `describe('commands over a range that starts before a list (Q rows)', …)` after P11b, using the describe's `select`, `pressDelete`, `caretOf`, `rootTypes`, `expectRoundTrips`, `expectOneUndoStep`.
   - Run `npx vitest run tests/component/markdown-editor-table-commands.test.ts --maxWorkers=2` from `packages/lib`: the rows marked red fail; the matrix fails for `'- one\n  - two\n- three'` and `'- one\n- two'` (Tab and the copied word throw).
2. **`$removeGuardedRangeForInsert`**: the change in `## Implementation`. Its doc gains, after the list-container clause: "and a range that starts just before a list ({@link $isRangeStartingBeforeList}), which Lexical's insert would otherwise put text or nodes into the list itself at, and throw".
3. **`$clearGuardedRangeBeforeParagraph`**: the change in `## Implementation`. In its doc, replace "A range that starts just before a list is removed here first ({@link $isRangeStartingBeforeList}), the way a range ending on a list is:" with "A range that starts just before a list ({@link $isRangeStartingBeforeList}) or ends on a list or item ({@link $isListContainerRange}) is removed here first:", and replace "A list the removal emptied is refilled with one blank item ({@link $openBlockAtItemCaret}) and Lexical's insert runs there, where Enter leaves the list for a paragraph, as after Delete." with "A list or item the removal emptied is refilled ({@link $openBlockAtItemCaret}) and Lexical's insert runs there, where Enter leaves the list for a paragraph, as after Delete; a caret it leaves between blocks that stay gets its block, which is the paragraph."
4. **`$clearGuardedRangeBeforeLineBreak`** and **`$beforeListRemovalDeclinesLineBreak`**: the change in `## Implementation`. Its doc gains: "A range that starts just before a list is removed first, as Enter removes it, unless the break would be declined where that leaves the caret ({@link $beforeListRemovalDeclinesLineBreak}); then nothing is removed."
5. **Run** the file again — green. Then `npx vitest run tests/component/markdown-editor-list-item-edits.test.ts tests/component/markdown-editor-list-item-paste.test.ts tests/component/markdown-editor-command-crashes.test.ts tests/component/markdown-editor-table-edge.test.ts --maxWorkers=2` — green.
6. **Docs and checks** (`## Documentation Impact`, `## Verification`).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-table-commands.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All unit-testable. A container spot is the describe's `Spot` (`{ on: 'root' | 'list', at }`, `list` = the document's first list); a text spot is `[text, offset]`. Each row runs in both directions (anchor and focus swapped) and, unless it says otherwise, checks: no throw; the save; the save, caret and root block types equal those of Delete (`pressDelete`) then the same command on a fresh editor; `expectRoundTrips`; one undo step (`expectOneUndoStep`). "red" marks a row that fails before the change.

| Row | Source | Range | Command | Saved | |
|---|---|---|---|---|---|
| Q1 | `'- one\n- two'` | `{root,0}` → `['two',3]` | `INSERT_TAB_COMMAND` | `'-'` | red (the repro: throws) |
| Q2 | `'- one\n- two'` | `{root,0}` → `{root,1}` | Tab | `'-'` | red |
| Q3 | `'- one\n  - two\n- three'` | `{root,0}` → `['three',5]` | Tab | `'-'` | red |
| Q4 | `'Above\n\n- one\n- two'` | `{root,1}` → `['two',3]` | Tab | `'Above'` | control |
| Q5 | `'- one\n- two'` | `{root,0}` → `['two',3]` | `insertCopied(editor, false)` | `'- zz'` | red (throws) |
| Q6 | `'- one\n- two'` | `{root,0}` → `['two',3]` | `insertCopied(editor, true)` | `'- zz'` | red (`'zz'`, a paragraph) |
| Q7 | `'Above\n\n- one\n- two'` | `{root,1}` → `['two',3]` | `insertCopied(editor, true)` | `'Above\n\nzz'` | control |
| Q8 | `'- one\n- two'` | `{root,0}` → `['two',3]` | typing `x` | `'- x'` | control |
| E1 | `'- one\n- two'` | `{list,0}` → `['two',3]` | `KEY_ENTER_COMMAND` | `''` (root holds one paragraph) | red (`'-'`) |
| E2 | `'Above\n\n- one\n- two'` | `{list,0}` → `['two',3]` | Enter | `'Above'` | control |
| E3 | `'Above\n\n- one\n- two'` | `{list,0}` → `['one',3]` | Enter | `'Above\n\n-\n- two'` | control |
| S1 | `'Above\n\n- one\n- two'` | `{root,1}` → `['two',3]` | `INSERT_LINE_BREAK_COMMAND` | unchanged; declined, range kept (no undo step; not compared with Delete) | control |
| S2 | `'- one\n- two'` | `{root,0}` → `['two',0]` | Shift+Enter | `'- \\\n  two'` | control |
| S3 | `'Above\n\n- one\n- two'` | `{root,1}` → `['two',1]` | Shift+Enter | `'Above\n\n- wo'` | control (stale-focus guard) |

Existing rows that must stay green: P10–P10i (Enter before a list), P11/P11b (Shift+Enter on a list), the matrix's Enter placement and removal tests, and `markdown-editor-list-item-edits.test.ts` Z21/Z23/Z31/Z36/Z37/X11.

The matrix additions (step 1) are the broad check: on the prototype the whole file passed (103 tests) with the change and failed without it.

---

## Verification

- `npm run typecheck`, `npm run typecheck:test`, `npm run lint` from `packages/lib`.
- The Q/E/S rows red where marked before steps 2–4, green after.
- The full suite once: `npx vitest run --maxWorkers=2` (check `free -g` first). On the prototype: 566 files, 19,133 tests, all green.
- `npm run docs:api` with zero warnings.
- Manual: none. These ranges come from code, not a click; the demo cannot make one.

---

## Documentation Impact

`packages/lib/docs/reference/changelog/next.md`, under `## Fixed` → `### Components`: "**`MarkdownEditor` no longer throws on Tab, or on a paste or drop, over a selection that starts just before a list.** A selection from the very start of a document that opens with a list (as code can set one) made Tab and a pasted or dropped word throw, and a pasted paragraph replaced the list with a paragraph. They now remove the selection first, as Delete does, and insert where it leaves the caret. Enter over a selection that empties a list leaves the list, as Delete then Enter does. No consumer action is needed."

No component page changes: `MarkdownEditor.md` does not describe these selections.

---

## Potential Challenges

- **`markdown-editor-join-escapes-heading-line` edits `$removeGuardedRange` and the typing, plain-text paste and cut guards** in the same region; the two plans change different functions, so whichever lands second rebases by symbol name.
- **The matrix gets slower.** One more document and three more commands; the whole file took about 45 s on one worker on the prototype, well inside `MATRIX_TIMEOUT_MS` per test.

---

## Critical Files

- [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts): `$isRangeStartingBeforeList` (:2214), `$listContainerAtCaret` (:2349), `$isListContainerRange` (:2364), `$startsOnListContainer` (:2387), `$openBlockAtItemCaret` (:2412), `$removeGuardedRangeForInsert` (:2444), `$removeRangeBeforeImage` (:2670), `$clearGuardedRangeBeforeInsert` (:2702), `$clearGuardedRangeBeforeParagraph` (:2726, the precedent), `$guardedRemovalDeclinesLineBreak` (:2833), `$clearGuardedRangeBeforeLineBreak` (:2855), `$clearGuardedRangeBeforePaste` (:2943), `registerRangeGuards` (:4457).
- [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts): `$lineBreakUnwritableAt` (:1549).
- [markdown-editor-table-commands.test.ts](../packages/lib/tests/component/markdown-editor-table-commands.test.ts): the P rows and the P12 matrix (:660–:1030).
- `plans/implemented/markdown-editor-table-command-fixes.md`, Implementation Notes items 1 and 7: the remove-first precedent and the Shift+Enter decline.

---

## Non-Goals

- **Typing and plain-text paste.** The list item rules already remove a range from before a list for them; the survey found them equal to Delete then the input except where noted in the addendum.
- **`insertTable()`.** It never removes a selected range: it inserts the table at the selection's focus, by design.
- **Ranges between two container points**, such as `list@0` → `item@1`, where Enter still opens a blank item while Delete then Enter leaves the list (158 survey runs), and ranges whose end settles back onto their start in a `:::` column. See the addendum.[^not-fixed]

---

## Addendum: The Survey

Every command that replaces a range was run over every range between a container point (on the root, a list, a list item, a `:::` block or a column, at every offset) and either another container point or a text node's start or end, in both directions, in eight documents: `- one\n- two`, `Above\n\n- one\n- two`, the same with `after`, a list in a column, a nested list, a fence after a paragraph, an item with two blocks, and a quote before a list before a heading. Each run was compared with Delete over the same range followed by the same command. The table counts the 1,290 runs per command whose range starts before a list or ends on a list, item, `:::` block or column.

| Command | Throws before | Differs before | Throws after | Differs after |
|---|---|---|---|---|
| Tab | 12 | 2 | 0 | 2 |
| insert a copied word (paste/drop) | 12 | 4 | 0 | 4 |
| insert a copied paragraph | 0 | 16 | 0 | 4 |
| Enter | 0 | 186 | 0 | 176 |
| typing / IME start | 0 | 6 / 26 | 0 | 6 / 26 |
| plain-text paste | 0 | 6 | 0 | 6 |
| `insertImage()` | 0 | 4 | 0 | 4 |
| Shift+Enter | 0 | 1,215 (declined) | 0 | 1,215 (declined) |
| `insertTable()` | 0 | 1,038 (never removes) | 0 | 1,038 |

All 24 throws were ranges from `root@0` in a document that opens with a list (both directions; the end anywhere). Across all 18,225 runs (`insertTable()` aside) the change made 58 match Delete then the command and made none stop matching.

The differences left, by cause:

- **Enter, 176.** Ranges between two container points (`list@0` → `item@1`, `item@0` → `list@1`, a fence's or column's point → a list), plus 18 from `root@0` in `- one\n\n  para\n- two` ending at the item's paragraph. Delete's own update ends with the list rules giving an emptied item its text and the caret; Enter after it acts there. Enter removing the range in its own update sees the caret on the container instead.
- **Typing, paste, inserts, `insertImage()`, Tab, 2–6 each.** A range from the end of `one` to `list@1` in a `:::` column, which `$endsListOfColumn` settles back onto its own start, so Delete then deletes forward at a caret (joining `two`) where an insert inserts at it; and a range from the start of `one` to `item@1` in `- one\n\n  para\n- two`, where Delete joins the item's paragraph to its text.
- **IME start, 26.** The zero-width character Lexical's composition start types over a range, and a list's looseness Delete rewrites.
- **Shift+Enter, 1,215.** The decline rule: a range that starts or ends on a list or item, or whose break could not be written after the removal, is declined with nothing changed; Delete over it removes.

---

## Notes

[^remove-first]: Lexical's `insertText`/`insertNodes` remove a range from an element point on the root before a list by putting the inserted content into the list node itself, which holds only items, and Lexical throws ("Expected node ListNode … to have a block ElementNode ancestor"). `$removeGuardedRangeForInsert` already makes room the same way for a list-container range, whose removal can leave the caret on a list or item; after removing a range from before a list, Lexical's removal leaves the caret on the list it emptied (`- one\n- two`, `root@0` → end of `two`), so the same `$openBlockAtItemCaret` refill applies. `insertImage()` already removed every range first (`$removeRangeBeforeImage`), so it gains nothing here; Tab and inserted clipboard nodes did not. Typing and plain-text paste were left as they are: adding them made typing over a range covering a whole list (`root@1` → `list@2` in `Above\n\n- one\n- two\n\nafter`) join the next paragraph (`xafter`) while a paste still made its own paragraph, so the two would disagree where today they agree.

[^enter-emptied]: Before, a list-container range went through `$removeGuardedRangeForInsert`, which returns `true` once it has opened a block, and the guard returned that, so Enter only refilled the emptied list (`-`). Delete then Enter leaves the list (an empty paragraph), because Delete's update ends with the emptied item given its text and Enter then runs at that blank item, where `$enterLeavesListAtBlankItemText` makes it a paragraph. Returning `false` after a refill reproduces that, as the branch for a range from before a list already did (P10h). When the caret is left between blocks that stay (`Above\n\n- one\n- two`, `list@0` → end of `one`), Enter at that caret opens a block and that is all it does, before and after.

[^shift-enter]: The note in `markdown-editor-table-command-fixes` records that Shift+Enter over `root@1` to a text's end changes nothing while Enter removes the range. Lexical's `insertLineBreak` over a range whose start is a root point before a list removes nothing. Prediction is the precedent of `$guardedRemovalDeclinesLineBreak` for table-edge and stale-focus ranges: decline before removing when the break would be declined where the removal leaves the caret. After removing a range from before a list, that caret is at the start of what remains of the end's block, so `$lineBreakUnwritableAt(end)` (whose `rest` defaults to `end`) answers it. On the survey this gave the same outcome as today in every run: the runs that changed nothing still change nothing, now by rule, and the runs that inserted a break still do.

[^not-fixed]: Matching Delete then Enter for a range between two container points needs to know where the list rules move the caret after Delete's update, which a command handler running inside one update does not see. These ranges come only from code (no click puts a point on a list or item), and Enter over them neither throws nor leaves an empty list or column: the matrix's round-trip and no-emptied-container checks pass for all of them. They are listed, not fixed.
