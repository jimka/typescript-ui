---
depends-on: [markdown-list-toggle-task-item-parity, markdown-editor-cross-item-range-removal]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor List Looseness Transform Cost — Implementation Plan

## Overview

In `MarkdownEditor`'s WYSIWYG mode an edit that changes many items of one list takes time that grows with the square of the list. A list is *loose* when blank lines separate its items, and *tight* when not. The editor keeps each list's looseness equal to what its save reads as, with node transforms (functions Lexical runs for each node an update changed) registered in `registerMarkdownListTransforms` ([markdownWritable.ts:362](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L362)). The transform for a changed list item reads every item of the list. An update that changes n items of a list of n items therefore reads n × n items.

Such updates are common: a load (every item is new), a list toggle over a list, a paste of a list, and Enter (every item after the new one is renumbered). Measured headless on an idle machine, medians of three runs:[^machine]

| Edit of a tight bulleted list | 125 items | 250 | 500 | 1,000 | 2,000 |
|---|---|---|---|---|---|
| Load, today | 103 ms | 370 ms | 1,460 ms | 5,511 ms | 22,539 ms |
| Load, after this plan | 17 ms | 19 ms | 31 ms | 56 ms | 114 ms |
| Numbered toggle over the whole list, today | 113 ms | 365 ms | 1,516 ms | 5,979 ms | 25,162 ms |
| Numbered toggle over the whole list, after | 16 ms | 29 ms | 56 ms | 135 ms | 311 ms |
| Enter in the middle item, today | 18 ms | 56 ms | 255 ms | 1,016 ms | 5,011 ms |
| Enter in the middle item, after | 2.5 ms | 3.9 ms | 7.8 ms | 15 ms | 31 ms |

This plan makes the first changed item of a list in an update read the whole list, and every later changed item of that list read its own item alone. The change is in `markdownWritable.ts` only: `registerMarkdownListTransforms`, the two functions after it, and one new function. One new test file pins the cost by counting whole-list reads, and pins the looseness the edits leave. No public API changes, no node class changes, and no document, selection or undo step comes out differently.[^identical]

Line numbers are those of commit `75d022ba1`, the tip of `feature/markdown-list-toggle-task-item-parity`. This plan comes after `markdown-editor-raw-block-edge-cases`, `markdown-editor-raw-block-range-edits` and `markdown-editor-cross-item-range-removal`. The first two edit `markdownWritable.ts` in other functions, so the lines will have moved: find each function by its name.

---

## Architecture Decisions

### A changed item reads its own item — the rule typing already follows

`$keepLoosenessAfterTyping` ([markdownWritable.ts:418](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L418)) reads the whole list only where a change of one item can change the answer ([:429–434](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L429)). Those six lines move into a function of their own, `$keepLoosenessThroughItem(list, item)`. The transform for a changed item and the transform for a changed block of an item call it too.[^through-item]

| The list is | It holds | `$keepLoosenessThroughItem` does | Why that is the whole read's answer |
|---|---|---|---|
| loose | two items or more | nothing | such a list reads loose whatever its items hold |
| loose | one item | reads the whole list | the whole list is that one item |
| tight | any number | reads the changed item (`$itemReadsLoose`); reads the whole list only when that item makes the list loose | a tight list reads loose only through an item whose blocks need a blank line between them |

A nested list is a list of its own. A changed item reads the list that holds it, never the list around that one:

| Document | Changed | Lists read |
|---|---|---|
| `- a⏎  - n⏎  - m⏎- b` | item `n` gets a second block | the nested list (turns loose); the outer list is not read and stays tight |
| the same | item `b` gets a second block | the outer list (turns loose); the nested list is not read |

(`⏎` is a line end.)

### The first changed item of a list in an update reads the whole list

The third row of the table above assumes that the other items are as they were when the list was last read. One whole read per list per update makes that true inside the update.

It also keeps what the editor does today for a list that is *out of step*: tight in the editor, although one of its items has come to hold blocks that a save sets a blank line apart. Today the next change of any item of such a list turns the list loose, because that change reads the whole list. Row L8 of `## Expected Behaviour` is such a list.[^first-whole]

The rule: per update, the first call for a list reads the whole list (`$keepLoosenessWritable`, unchanged). Every later call for the same list in the same update goes through `$keepLoosenessThroughItem`.

| Update | Calls of the item rule for the list | Whole-list reads today | After |
|---|---|---|---|
| numbered toggle over 40 bulleted items | 119: 40 new items, 40 new item texts, 39 renumbered items | 120: one per call, and the list transform's own | 2: the first call's, and the list transform's own |
| a tick on one item of 40 | 1 | 1 | 1 |

### "One update" is tracked as the definition rule tracks it

`registerDefinitionRules` ([markdownWritable.ts:1159](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1159)) keeps what one update has done so far in a variable of the registering function (`shown`, [:1161](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1161)), tied to the committed state the update started from, and an update listener clears it at each commit ([:1216–1223](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1216)). `registerMarkdownListTransforms` keeps the lists read whole the same way: a variable `readWhole` of type `ListsReadWhole`, checked against `editor.getEditorState()`, and cleared by an update listener.[^one-update]

The two functions that use `readWhole` are defined inside `registerMarkdownListTransforms`, as `registerDefinitionRules` and `registerRawBlockRules` define theirs. `$keepLoosenessOfItemHolding` moves in from module level for that reason.

### The list transform and `$keepLoosenessWritable` do not change

`$normalizeList` ([:449](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L449)) keeps its whole-list reads, and those reads are not recorded in `readWhole`. `$keepLoosenessWritable` ([:584](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L584)), `$listReadsLoose` and `$itemReadsLoose` ([markdownSerializer.ts:1078](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1078), [:1097](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1097)) are untouched.[^list-rule]

### The cost is pinned by counting whole-list reads

A test of elapsed time is flaky. The test file wraps `$listReadsLoose` in a spy that still reads, and asserts that an edit's count of whole-list reads is the same for 20 items as for 40 and stays under a fixed bound. This is the idiom of `markdown-source-preservation.test.ts` ([:21](../packages/lib/tests/component/markdown-source-preservation.test.ts#L21), [:438](../packages/lib/tests/component/markdown-source-preservation.test.ts#L438)), which counts lexes per save the same way.[^count]

The spy replaces a module for the whole file, so the rows go in a new file, `markdown-editor-list-looseness.test.ts`, not in a file other plans edit.

---

## Internal Structure

### `markdownWritable.ts`

Add `NodeKey` to the type import from `"lexical"` ([:12–15](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L12)).

Replace everything from the JSDoc of `registerMarkdownListTransforms` through the closing brace of `$keepLoosenessAfterTyping` (lines 345–435 at `75d022ba1`: `registerMarkdownListTransforms`, `$keepLoosenessOfItemHolding`, `$keepLoosenessAfterTyping`) with this block. Nothing between those three functions is kept, and nothing outside them changes.

```typescript
/** The lists whose looseness a changed item has read whole in one update. */
interface ListsReadWhole {
    /** The committed state the update started from. */
    readonly from:  EditorState;
    /** The keys of the lists read whole. */
    readonly lists: Set<NodeKey>;
}

/**
 * Replaces `@lexical/list`'s own `ListNode` transform, which joins a list
 * with the next one of its type whatever their markers, by
 * {@link $normalizeList}, and keeps each list's looseness to what its save
 * can write as an item changes.
 *
 * @remarks
 * A change of bullet character or ordered delimiter starts a new list in
 * Markdown (`- a` then `+ b`), so the editor must keep such lists apart, but
 * the class's own transform cannot be turned off through a public API:
 * `getRegisteredNode` is `@internal`. Right after `createEditor`, the set of
 * `ListNode` transforms holds only that one (no plugin has added any), so it
 * is cleared and {@link $normalizeList} takes its place.
 *
 * An update that changes many items of one list — a load, a toggle over the
 * list, a paste, the renumbering after Enter — runs the item rule once for
 * each of them. The first of them reads the whole list, and each one after
 * it reads its own item alone ({@link $keepLoosenessThroughItem}), so the
 * update's cost grows with the items it changed and not with their number
 * times the list's length. The lists read whole are kept for one update: an
 * update listener forgets them at each commit.
 *
 * @param editor - The editor.
 * @returns The unregister function.
 */
function registerMarkdownListTransforms(editor: LexicalEditor): () => void {
    editor.getRegisteredNode(ListNode).transforms.clear();

    let readWhole: ListsReadWhole | null = null;

    /**
     * Keeps a list's looseness writable as one of its items changes: its
     * shape, its blocks, or a block of it that a deletion empties. The
     * first such change of a list in an update reads the whole list
     * ({@link $keepLoosenessWritable}), which also takes in what other
     * items have come to hold since the list was last read; each later one
     * reads the changed item alone ({@link $keepLoosenessThroughItem}).
     *
     * @param list - The list.
     * @param item - The item that changed, as its rule found it in the list.
     */
    const $keepLoosenessAfterItemChange = (list: ListNode, item: ListItemNode): void => {
        const from = editor.getEditorState();

        if (readWhole?.from !== from) {
            readWhole = { from, lists: new Set() };
        }

        const key = list.getKey();
        const isReadWhole = readWhole.lists.has(key);
        // The shape rule puts an item of the editor's own class in the place of one of Lexical's, which then is no item of the list.
        const isItemOfList = item.getParent()?.is(list) === true;

        if (!isReadWhole || !isItemOfList) {
            readWhole.lists.add(key);
            $keepLoosenessWritable(list);

            return;
        }

        $keepLoosenessThroughItem(list, item);
    };

    /**
     * Keeps a list's looseness writable as a block of one of its items
     * changes: an item's text, a paragraph or a raw block that a deletion
     * empties writes nothing, so its item holds one block less.
     *
     * @param block - The item text, paragraph or raw block that changed.
     */
    const $keepLoosenessOfItemHolding = (block: ElementNode): void => {
        const item = block.getParent();
        const list = item?.getParent() ?? null;
        const isItemOfList = $isListItemNode(item) && $isListNode(list);

        if (isItemOfList) {
            $keepLoosenessAfterItemChange(list, item);
        }
    };

    return mergeRegister(
        editor.registerNodeTransform(ListNode, $normalizeList),
        editor.registerNodeTransform(ListItemNode, (item) => {
            const list = item.getParent();

            $keepItemShape(item);

            if ($isListNode(list)) {
                $keepLoosenessAfterItemChange(list, item);
            }
        }),
        editor.registerNodeTransform(MarkdownListItemTextNode, $keepItemTextInPlace),
        editor.registerNodeTransform(TextNode, $keepLoosenessAfterTyping),
        // A deletion that empties a block removes its text node, so no text transform runs for it.
        ...[ParagraphNode, MarkdownListItemTextNode, MarkdownRawBlockNode]
            .map((klass) => editor.registerNodeTransform(klass, $keepLoosenessOfItemHolding)),
        // An undo can bring back the very state an update started from; the next update starts afresh.
        editor.registerUpdateListener(() => {
            readWhole = null;
        }),
    );
}

/**
 * Keeps a list's looseness writable as text is typed or deleted in it, where
 * that can change whether a block of an item writes anything: in a paragraph
 * an item holds after its text, and in an item's own text when the item
 * holds more after it. Such a block going from blank to written, or back,
 * is one block more or less in its item, and a list whose item holds two
 * blocks reads loose. Other text — the text of an item that holds nothing
 * else — cannot change what the list's save reads as.
 *
 * The list is read through the item alone ({@link $keepLoosenessThroughItem}),
 * so a keystroke in a long list costs the same however long the list is.
 *
 * @param text - The text node that changed.
 */
function $keepLoosenessAfterTyping(text: TextNode): void {
    const item = $findMatchingParent(text, $isListItemNode);
    const list = item?.getParent();
    const block = text.getParent();
    const isFurtherParagraph = $isParagraphNode(block) && !$isMarkdownListItemTextNode(block);
    const isTextOverBlocks = $isMarkdownListItemTextNode(block) && block.getNextSibling() !== null;

    if (item === null || !$isListNode(list) || !(isFurtherParagraph || isTextOverBlocks)) {
        return;
    }

    $keepLoosenessThroughItem(list, item);
}

/**
 * Keeps a list's looseness writable after a change of one of its items,
 * reading the whole list ({@link $keepLoosenessWritable}, which reads every
 * item) only where the answer can differ from what the list has: a loose
 * list of several items reads loose whatever this item holds, and a tight
 * one reads loose only once this item's blocks need a blank line between
 * them, the other items being as they were when the list was last read.
 *
 * @param list - The list.
 * @param item - The item of it that changed.
 */
function $keepLoosenessThroughItem(list: ListNode, item: ListItemNode): void {
    const isLoose = $getState(list, listLooseState);
    const staysAsItIs = isLoose ? list.getChildrenSize() > 1 : !$itemReadsLoose(item);

    if (!staysAsItIs) {
        $keepLoosenessWritable(list);
    }
}
```

What differs from the code at `75d022ba1`, so the edit can be checked line by line:

| Where | Before | After |
|---|---|---|
| `ListItemNode` transform | `$keepLoosenessWritable(list)` | `$keepLoosenessAfterItemChange(list, item)` |
| `$keepLoosenessOfItemHolding` | a module-level function that calls `$keepLoosenessWritable(list)` | a function inside `registerMarkdownListTransforms` that calls `$keepLoosenessAfterItemChange(list, item)` |
| `$keepLoosenessAfterTyping`, last six lines | `isLoose`, `staysAsItIs`, the `if` | one call of `$keepLoosenessThroughItem(list, item)` |
| new | — | `ListsReadWhole`, `readWhole`, `$keepLoosenessAfterItemChange`, the update listener, `$keepLoosenessThroughItem` |

The body of `$keepLoosenessAfterTyping` above its last statement is unchanged. Its JSDoc loses its second paragraph, which now describes `$keepLoosenessThroughItem`.

### `tests/component/markdown-editor-list-looseness.test.ts`

The whole file is in *Addendum: the test file*. It was run on the code at `75d022ba1` and on this plan's code: see `## Expected Behaviour`.

---

## Ordered Implementation Steps

1. **Check the base.** Both plans in `depends-on` are in `plans/implemented/`. Then, from the repository root, `grep -n 'function registerMarkdownListTransforms\|function \$keepLoosenessOfItemHolding\|function \$keepLoosenessAfterTyping\|function \$keepLoosenessWritable\|function \$normalizeList' packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` — expect five matches. `grep -n '\$keepLoosenessWritable(' packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` — expect six matches: the definition, one in the `ListItemNode` transform, one in `$keepLoosenessOfItemHolding`, one in `$keepLoosenessAfterTyping`, and two in `$normalizeList`. If a plan in between added a seventh caller, stop and report it: this plan does not say what that caller should do.
2. **Add the test file.** Create `packages/lib/tests/component/markdown-editor-list-looseness.test.ts` with the content of *Addendum: the test file*, unchanged.
3. **See it fail.** From `packages/lib`: `npx vitest run tests/component/markdown-editor-list-looseness.test.ts`. Expect 6 failed and 10 passed: rows C1 to C6 fail, C7, C8 and L1 to L8 pass. Any other split means the base differs from what this plan measured; stop and report it.
4. **Edit `markdownWritable.ts`** as in `## Internal Structure`: the import, then the block. Check: `grep -n '\$keepLoosenessWritable(' packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` — expect five matches: the definition, one in `$keepLoosenessAfterItemChange`, one in `$keepLoosenessThroughItem`, two in `$normalizeList`.
5. **See it pass.** `npx vitest run tests/component/markdown-editor-list-looseness.test.ts` — expect 16 passed.
6. **Static checks.** From `packages/lib`: `npm run typecheck`, `npm run typecheck:test`, `npm run lint` — all clean.
7. **Full suite.** `npm test` — every test passes, 16 more than at the base.
8. **Commit the code** (the `commit` skill), so the differential in step 9 can copy it with `git archive`.
9. **Run the differential** as in `## Verification`, *The differential*. It must end with `ALL IDENTICAL`. If it does not, the change is wrong: do not adjust a test or the probes, stop and report the first differing file.
10. **Run the timings** as in `## Verification`, *The timings*, and record them in the Implementation Notes.
11. **Changelog.** Add the entry of `## Documentation Impact` to `packages/lib/docs/reference/changelog/next.md`.
12. **Docs and build checks.** From `packages/lib`: `npm run docs:api`, `npm run docs:llms:check`, `npm run build:lib`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` |
| Create | `packages/lib/tests/component/markdown-editor-list-looseness.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All rows are unit tests in `markdown-editor-list-looseness.test.ts`. "Whole-list reads" are calls of `$listReadsLoose` made from outside `markdownSerializer.ts` during the edit.

### Cost rows — fail before the change, pass after

Each row runs its edit on 20 items and on 40 items. It asserts that both make the same number of whole-list reads, and that the number is at most 10.

| Row | Edit | Reads at 20 / 40 items, at `75d022ba1` | Reads at 20 / 40, after |
|---|---|---|---|
| C1 | a load of a tight list | 60 / 120 | 2 / 2 |
| C2 | the numbered toggle over a whole tight bulleted list | 60 / 120 | 2 / 2 |
| C3 | the bulleted toggle over paragraphs | 60 / 120 | 2 / 2 |
| C4 | Enter in the middle item of a tight list | 16 / 26 | 2 / 2 |
| C5 | a paste of a tight list into an empty document | 101 / 201 | 4 / 4 |
| C6 | a paste of a loose list at the caret in the middle item | 146 / 286 | 9 / 9 |

C5 and C6 count the load of the copied list too, which the paste helper makes in an editor of its own.

### Rows that pin the first whole read — pass before and after

These rows fail if a changed item never reads its whole list.

| Row | Steps | Expected |
|---|---|---|
| C7 | tight list of 6; tick item 2 in one update; tick item 4 in another | each update makes exactly 1 whole-list read |
| C8 | tight list of 6; add a paragraph to item 2; undo; tick item 2 | the last update makes exactly 1 whole-list read |
| L8 | `- a⏎- b⏎- c`; a raw block holding one space is appended to item `a`; `<div>` is typed at its start; item `c` is ticked | the list is loose; the save is `- a⏎⏎  <div>⏎⏎- b⏎⏎- c` |

### Looseness rows — pass before and after

Each row checks the tree (each list shown as `loose(…)` or `tight(…)`), the save, and that the save reloads to the same save.

| Row | Document | Edit | List after | Save after |
|---|---|---|---|---|
| L1 | `- a⏎- b⏎- c` | a paragraph `more` appended to item `b` | loose | `- a⏎⏎- b⏎⏎  more⏎⏎- c` |
| L2 | `- a⏎- b⏎⏎  two⏎- c` | the last block of item `b` removed | loose (stays) | `- a⏎⏎- b⏎⏎- c` |
| L3 | `- a⏎⏎  two` | the last block of item `a` removed | tight | `- a` |
| L4 | `- a⏎  - n⏎  - m⏎- b` | a paragraph appended to item `n` | outer tight, nested loose | `- a⏎  - n⏎⏎    more⏎⏎  - m⏎- b` |
| L5 | `- a⏎-⏎⏎⏎- b⏎- c` (two lists a load keeps apart) | item `a` ticked | two tight lists, as loaded | the source, byte for byte |
| L6 | `- a⏎- b⏎- c` | a paragraph appended to items `a` and `c` in one update; then both removed in one update | loose after both steps | `- a⏎⏎  more⏎⏎- b⏎⏎- c⏎⏎  more`, then `- a⏎⏎- b⏎⏎- c` |
| L7 | a tight list of 5 | the numbered toggle over all of it; undo; redo | — | `1. item0` … `5. item4`; the source after one undo; the toggled save after one redo |

### Manual check — needs manual verification

The headless numbers leave out what the browser does to draw the list. In the demo's MD Editor page (`npx vite` in `packages/lib`), in WYSIWYG mode: paste a tight bulleted list of 1,000 items into source mode and switch to WYSIWYG; select all; **Insert ▸ Numbered list**. The list is numbered without a wait of seconds, and one Ctrl+Z gives the bullets back.

---

## Verification

From `packages/lib`: `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, `npm test`, `npm run docs:api`, `npm run docs:llms:check`, `npm run build:lib`.

### The differential

Looseness decides how a list is saved, so a wrong reading corrupts saves without any error. The change must leave every save and every editor state as the base leaves it. The check runs the same probes on a private copy of the base and of the branch, and compares what they record.

The scripts and probes are in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/looseness-cost/` (called `$K` below); `README.md` there describes each. Every probe runs with a setup file (`probes/zz-lc-digest.ts`) that writes one line for every committed update of every editor: a hash of the state's JSON, its node keys, the selection, the dirty elements and leaves, and the update's tags. It writes one more line for every Markdown value handed to the change seam and for every `getValue()`. Equal lines mean equal saves, equal states, equal selections and equal dirty marks, update by update.

```bash
K=~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/looseness-cost
$K/setup.sh parent <the commit the branch started from>
$K/setup.sh branch <the branch's code commit>
for side in parent branch; do
    SYS="0 1 2 3 4 5 6 7" RND="101 202 303 404" RNDN=1800 EXTRA=1 $K/runloose.sh $side $side 3
    $K/runfuzzall.sh $side $side 3
    $K/rundiffall.sh $side $side 3
done
$K/cmpall.sh parent branch
```

Use the tags `parent` and `branch`: `base`, `proto2` and `proto3` hold the planner's runs. Run the two sides one after the other. `rundiffall.sh` skips a set whose log shows it passed, so a run that was cut short is continued by running the same line again.

| Family | What it runs | Size | Must be |
|---|---|---|---|
| looseness set (`runloose.sh`) | 44 documents; at every text of each, 29 edits at a caret, 13 over a range, 5 joins and 12 pairs of edits; then 4 × 1,800 random runs of 2 to 5 edits; every edit is then undone and redone; with `EXTRA=1`, the same on 5 documents holding lists a load keeps apart | 35,541 cases; 12 + 1 record files and as many digest files | byte-identical |
| seeded fuzz (`runfuzzall.sh`) | the paste, table edge, list-edit and reviewer-7 harnesses of `impl/list-item-node/harness`, same seeds and sizes as `impl/list-toggle/runall.sh` | 60 result files, 60 digest files | byte-identical |
| list toggle sets (`rundiffall.sh`) | the 49 row sets of `impl/list-toggle/diffall.sh` (68,522 cases), review 4's nine probes, review 5's two WYSIWYG sets | 63 record files, 63 digest files | byte-identical |

`cmpall.sh` prints one line per family and ends with `ALL IDENTICAL` or `NOT IDENTICAL`. The planner's result on the prototype is in *Addendum: what the prototype measured*.

### The timings

```bash
$K/runtimes3.sh parent Tparent
$K/runtimes3.sh branch Tbranch
python3 $K/summ.py Tparent Tbranch
```

`summ.py` prints, per edit and list length, the median and the spread of three runs for the edit, its undo, its redo, the load and the save. Run the two sides at the same time, so the machine's load is the same for both. Expected:

| Edit | Today | After |
|---|---|---|
| load of a tight list, 125 to 2,000 items | about ×4 per doubling | about ×2 per doubling |
| numbered toggle over the whole list | about ×4 per doubling | about ×2 per doubling, at most ×2.4[^lift-rest] |
| Enter in the middle item | about ×4 per doubling | about ×2 per doubling |
| one typed character in the middle item | grows with the document: 2 to 4 ms at 1,000 items | the same |
| undo and redo of each | about ×2 per doubling | the same |
| save | about ×2 per doubling | the same |
| paste of an n-item list into an empty document | ×3 to ×5 per doubling | under half of today's time, still ×3 to ×4.5 per doubling[^paste-rest] |

---

## Documentation Impact

No exported symbol changes and no documented behaviour changes, so no page under `docs/components/` changes. Add one entry at the end of `## Fixed` → `### Components` in `packages/lib/docs/reference/changelog/next.md`:

> **`MarkdownEditor` no longer slows down by the square of a list's length.** In WYSIWYG mode, loading a long list, toggling it to the other kind, pasting one, or pressing Enter in one took time that grew with the square of its length: a list of 1,000 items took seconds to load or to toggle. These now grow with the length. What is saved is unchanged.

---

## Potential Challenges

- **Line numbers have moved.** Two plans edit `markdownWritable.ts` before this one. Locate every function by name; step 1's greps confirm the shape.
- **The `.map` over three node classes needs a typed function.** `$keepLoosenessOfItemHolding` is declared as `(block: ElementNode): void`. An inline arrow with an untyped parameter does not compile there, because the three classes give three parameter types.
- **`isItemOfList` narrows two variables.** `const isItemOfList = $isListItemNode(item) && $isListNode(list)` followed by `if (isItemOfList)` narrows `item` and `list` only while both are `const`. Keep them `const`.
- **Two updates without a commit between them count as one.** A command dispatched in a test commits later, on a microtask. Row C4 calls `editor.getValue()`, which commits, before it counts. Keep that call.
- **The differential is long and needs memory.** On a machine other suites kept busy, one side took the planner about 10 minutes for the looseness set, 65 minutes for the fuzz (25 on an idle machine, by the list toggle plan's record) and 25 minutes for the toggle sets, at three jobs. Start it once the code is committed and do steps 11 and 12 meanwhile. The five sets of review 5 (`r5w-*`) run with a 6 GB heap each: on a machine short of memory run the others first with `ONLY='zz-lt-\|zz-lt4' $K/rundiffall.sh $side $side 3`, then those five with `ONLY='r5w-' $K/rundiffall.sh $side $side 1`.

---

## Critical Files

- [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts): `registerMarkdownListTransforms` (L362), `$keepLoosenessOfItemHolding` (L391), `$keepLoosenessAfterTyping` (L418, the precedent for the shortcut), `$normalizeList` (L449), `$keepLoosenessWritable` (L584), `registerDefinitionRules` (L1159, the precedent for per-update state).
- [markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts): `$listReadsLoose` (L1078), `$itemReadsLoose` (L1097), `itemBlockKinds` (L2109).
- [markdown-source-preservation.test.ts](../packages/lib/tests/component/markdown-source-preservation.test.ts): the counting idiom (L21–25, L438–446).
- `plans/implemented/markdown-editor-list-item-block-paste.md`, Implementation Notes, *Looseness, and the item before a nested list*: why the typing rule has its shortcut.
- `plans/implemented/markdown-list-toggle-task-item-parity.md`, sign-off 10: the finding this plan answers.

---

## Non-Goals

- **Other paths that grow faster than the document.** Four were measured while this plan was written. None is caused by a changed item's looseness read, and each needs a design of its own. They are listed with their numbers in *Addendum: other costs measured*.
- **A list left out of step by typing in a raw block.** Row L8 starts from a state where the editor shows a tight list whose save reloads loose. This plan keeps what the editor does about it today. Making the typing rule read a raw block is a change of behaviour and is not part of a plan that must change none.
- **The list transform's own reads.** `$normalizeList` reads the whole list once per run, and twice when it joins the next list. It runs once per changed list per pass, and is left alone.
- **Reading the document once per update for saving.** Every update, a caret move included, serializes the document (`handleChange`). That is linear and by design.

---

## Addendum: what the prototype measured

The prototype is this plan's code on a private copy of `75d022ba1` (`$K/copies/proto3`, the diff in `$K/proto-v3.diff`). It typechecks, lints clean, and passes the 16 rows.

**Differential, base against prototype.** Run on `copies/base` (`75d022ba1`) and `copies/proto3`. `cmpall.sh base proto3` ends with `ALL IDENTICAL`:

| Family | Compared | Result |
|---|---|---|
| looseness set, records | 12 files: 33,480 cases, 197,571 recorded steps | byte-identical |
| looseness set, digests | 12 files, 1,963,589 lines | byte-identical |
| extra set (lists a load keeps apart) | 2,061 cases; 89,930 digest lines | byte-identical |
| seeded fuzz, results | 60 files | byte-identical |
| seeded fuzz, digests | 60 files, 5,402,048 lines | byte-identical |
| list toggle sets, records | 63 files, 117,464 lines | byte-identical |
| list toggle sets, digests | 63 files, 2,811,743 lines | byte-identical |

That is 10,267,310 digest lines, each one committed update, value or `getValue()` with the same state, selection, dirty marks and Markdown on both sides.

The base copy with the digest on also reproduces what the list toggle plan stored for the same commit: its 60 fuzz result files are byte-identical to `impl/list-toggle/{fuzz-5,lif-5,r7-5}`, and its 63 toggle-set record files to `impl/list-toggle/diff/b12-*`, `review4/b12/` and `review5/w-*-n1-*`. So the instrumentation changes nothing that those probes record.

In the looseness set no recorded step, of 197,571, shows a list whose looseness differs from that of its reload while the rest of its tree is equal.

**A design that was tried and fails the differential.** Marking the list dirty from the item's transform, and reading the looseness in the list transform only, joins lists that a load keeps apart. Document `- a0⏎-⏎⏎⏎- b0⏎- b1`, item `a0` ticked: the base keeps two lists and saves the source byte for byte; that design saves `- a0⏎-⏎- b0⏎- b1`. On the 2,061 cases of the extra set it changes 57 saves. On the two parts of the main set it was run on (3,285 systematic cases and 1,800 random ones) its saves are equal, and its digests differ: the list is one more dirty element in every update that changes an item.

**Timings.** Medians of three runs, with the lowest and highest in brackets, in ms, headless, on the prototype (`copies/proto3`) and the base (`copies/base`) side by side. The load average was between 1 and 9 on 24 cores. All lists are tight bulleted lists of n items unless a row says otherwise. Every undo gave the document back and every redo the edit, on both sides.

| Measure | Side | 125 | 250 | 500 | 1,000 | 2,000 |
|---|---|---|---|---|---|---|
| numbered toggle over the whole list | today | 113 [100–116] | 365 [359–405] | 1,516 [1,398–1,597] | 5,979 [5,795–6,321] | 25,162 [22,188–30,353] |
| | after | 16 [13–33] | 29 [27–31] | 56 [54–61] | 135 [132–146] | 311 [301–316] |
| undo of that toggle | today | 4.2 [3.9–6.9] | 9.0 [6.9–11] | 15 [13–16] | 28 [27–31] | 58 [55–63] |
| | after | 6.0 [3.7–7.2] | 7.7 [7.2–11] | 17 [17–19] | 32 [30–33] | 59 [56–67] |
| redo of that toggle | today | 4.4 [3.8–4.5] | 6.3 [6.1–7.5] | 14 [12–15] | 31 [27–33] | 56 [51–58] |
| | after | 5.1 [3.6–7.0] | 8.3 [7.5–9.5] | 14 [13–15] | 26 [26–28] | 54 [53–60] |
| load of the list | today | 103 [102–158] | 370 [343–373] | 1,460 [1,309–1,478] | 5,511 [5,432–5,829] | 22,539 [21,792–29,838] |
| | after | 17 [11–42] | 19 [18–24] | 31 [31–37] | 56 [51–63] | 114 [103–119] |
| save of the list | today | 1.1 [1.1–1.4] | 1.6 [1.6–2.4] | 3.4 [3.3–3.6] | 6.8 [5.5–7.0] | 14 [13–15] |
| | after | 1.1 [0.9–2.5] | 3.3 [1.6–3.3] | 3.5 [3.1–3.5] | 7.1 [6.5–10.0] | 12 [12–14] |
| bulleted toggle over n paragraphs | today | 106 [104–107] | 396 [387–408] | 1,623 [1,552–1,635] | 6,186 [5,372–7,287] | 21,289 [21,054–22,910] |
| | after | 10 [9.6–11] | 27 [21–27] | 42 [41–43] | 89 [85–91] | 187 [178–198] |
| undo of that toggle | today | 3.9 [3.8–4.3] | 7.8 [7.4–8.8] | 15 [14–15] | 32 [31–38] | 59 [55–70] |
| | after | 3.9 [3.7–4.0] | 11 [7.2–12] | 18 [16–19] | 34 [33–38] | 74 [73–75] |
| Enter in the middle item | today | 18 [17–20] | 56 [55–56] | 255 [246–259] | 1,016 [935–1,053] | 5,011 [4,221–5,257] |
| | after | 2.5 [2.4–4.6] | 3.9 [3.8–4.2] | 7.8 [7.6–7.8] | 15 [15–16] | 31 [31–44] |
| undo of that Enter | today | 0.9 [0.9–1.0] | 1.6 [1.6–1.9] | 3.5 [3.5–3.8] | 7.1 [6.9–7.7] | 17 [15–18] |
| | after | 1.2 [1.1–1.3] | 1.9 [1.9–4.8] | 3.8 [3.7–4.0] | 8.6 [8.5–9.7] | 18 [17–20] |
| one character typed in the middle item | today | 0.6 [0.6–1.7] | 0.7 [0.7–0.8] | 1.7 [1.3–1.8] | 3.5 [3.1–7.3] | 5.7 [3.9–8.4] |
| | after | 0.5 [0.4–1.0] | 0.7 [0.7–0.8] | 1.1 [1.1–1.2] | 2.2 [2.1–2.4] | 4.5 [4.5–4.6] |
| undo of that character | today | 0.9 [0.9–1.0] | 1.8 [1.7–1.9] | 4.8 [4.3–6.4] | 12 [9.8–21] | 19 [18–25] |
| | after | 0.9 [0.9–1.0] | 2.1 [1.8–2.2] | 3.5 [3.4–3.7] | 11 [9.5–12] | 21 [20–24] |
| paste of an n-item list into an empty document | today | 147 [142–161] | 444 [405–453] | 1,503 [1,488–1,543] | 5,956 [5,932–6,167] | 29,796 [27,340–31,047] |
| | after | 62 [61–65] | 195 [184–211] | 667 [653–675] | 2,528 [2,446–2,588] | 11,394 [11,351–13,558] |
| undo of that paste | today | 1.9 [1.0–2.5] | 2.0 [1.8–2.5] | 3.9 [3.5–4.3] | 6.3 [6.2–6.8] | 16 [15–23] |
| | after | 1.1 [1.1–1.6] | 2.4 [1.8–3.0] | 3.6 [3.4–4.0] | 6.3 [6.2–6.8] | 16 [14–20] |

Paste of a 500-item list at the caret in the middle item of a 2,000-item list: 20,791 [19,516–23,053] today, 4,148 [3,970–4,216] after; its undo 23 [20–23] and 23 [23–25].

Growth per doubling of the list, from the medians:

| Edit | Today | After |
|---|---|---|
| load | ×3.6, ×4.0, ×3.8, ×4.1 | ×1.1, ×1.6, ×1.8, ×2.1 |
| numbered toggle over the whole list | ×3.2, ×4.2, ×3.9, ×4.2 | ×1.8, ×1.9, ×2.4, ×2.3 |
| bulleted toggle over n paragraphs | ×3.7, ×4.1, ×3.8, ×3.4 | ×2.7, ×1.6, ×2.1, ×2.1 |
| Enter in the middle item | ×3.2, ×4.6, ×4.0, ×4.9 | ×1.6, ×2.0, ×1.9, ×2.1 |
| paste of a list into an empty document | ×3.0, ×3.4, ×4.0, ×5.0 | ×3.1, ×3.4, ×3.8, ×4.5 |
| one typed character | ×1.1, ×2.4, ×2.1, ×1.6 | ×1.6, ×1.5, ×2.0, ×2.1 |
| undo of the numbered toggle | ×2.1, ×1.6, ×1.9, ×2.1 | ×1.3, ×2.3, ×1.8, ×1.8 |
| save | ×1.5, ×2.1, ×2.0, ×2.1 | ×3.0, ×1.1, ×2.0, ×1.8 |

Today the load, the two toggles, Enter and the paste each grow with the square of the list. After the change the load, the toggles and Enter grow with the list.[^lift-rest] The paste is more than halved and still grows with the square.[^paste-rest] Typing, every undo and redo, and the save are as they were: they grow with the document.

The paste rows for 250, 500 and 1,000 items are from a second run: in the first, another suite started during the base's 500-item pastes and they took 4,145 ms.

Other lists, the numbered toggle over all of each. These were timed earlier, on an earlier form of the prototype that makes the same reads, while other suites kept the load at 25 to 60: every number is two to four times what an idle machine gives, and only the growth is to be read from them.

| List | Side | 125 | 250 | 500 | 1,000 |
|---|---|---|---|---|---|
| loose | today | 285 | 1,105 | 5,221 | 20,706 |
| | after | 52 | 64 | 155 | 317 |
| every item holds its text and a paragraph | today | 881 | 4,379 | 24,461 | 70,797 |
| | after | 60 | 130 | 341 | 679 |
| one item holding a nested list of n items | after | 29 | 53 | 97 | 255 |
| n items each holding one nested item | after | 54 | 111 | 233 | 653 |

---

## Addendum: other costs measured

Measured on the prototype, so with this plan's change in place. None is in this plan. The times are from the run on the loaded machine (see the note on the other lists above), so read their growth, not their size; a profile's shares are not affected.

| # | Path | Where | Measured (ms; list lengths 125 / 250 / 500 / 1,000) | Growth per doubling |
|---|---|---|---|---|
| 1 | The run-edge rule reads the document's link reference definitions once for every block it tidies | `tidy` (markdownWritable.ts L1883) → `$tidyBlock` (L1964) → `$readsBackAsShown` (markdownSerializer.ts L819) → `$needsDefinitions` (L729), a walk of the whole document; and `$showRunsAsSaved` → `$runsReadingOtherwise` (L839), which lexes the definitions again | paste of n paragraphs into an empty document: 80 / 207 / 786 / 3,083. Paste of an n-item list: 169 / 529 / 2,024 / 8,457, and 37,985 at 2,000 | about ×4 |
| 2 | Items are lifted out of a list one at a time | `$liftItemOut` (markdownListItemNode.ts L780) → `$splitListAfter` (L869) moves the rest of the list for every item lifted first to last. For items removed last to first, Lexical's `$removeNode` walks the siblings (`getIndexWithinParent`) | `setBlockType("h2")` over a whole tight list: 23 / 76 / 317 / 1,002. In the numbered toggle at 2,000 items: 331 of 1,211 ms | ×3 to ×4 |
| 3 | The list transform joins a run of adjacent lists back to front | `$normalizeList` (markdownWritable.ts L449) → `$joinLists` (L557) | bulleted toggle over a bulleted list whose items each hold a paragraph: 202 / 671 / 2,456 / 9,361 (today: 1,060 / 4,886 / 25,079 at 125 / 250 / 500) | about ×3.7 |
| 4 | The raw-block rule reads every sibling once for every changed top-level paragraph | `checkSiblings` (markdownWritable.ts L904) → `$showRawBlocksAsWritten` (L1111) | 62 of 1,404 ms at 1,000 pasted paragraphs | about ×4, with a small factor |

Row 1 is why a paste stays quadratic after this plan. A profile of 1,000 pasted paragraphs puts 1,223 of 1,404 ms in `tidy` and 947 ms in `$needsDefinitions`. Every update tagged `RUN_EDGE_TAG` that changes many blocks pays it: a paste, a cut, a drop. Its plan belongs after `markdown-editor-raw-block-edge-cases`, which replaces the readers named here by one function, `$documentDefinitions()`.

Row 3: a profile at 500 items puts 1,907 of 2,330 ms in `$normalizeList`, which there runs once for each list of a long run of small adjacent lists: each run joins the next list into its own (`$joinLists`, 588 ms), renumbers, and reads the whole of the list it has grown to (`$keepLoosenessWritable`, 1,188 ms). The move and the renumbering grow as the read does, so making the read cheaper would not change the growth. Why the toggle leaves that many lists for the list transform to join was not traced further.

One defect that is not a cost was found on the way. Typing into a raw block of a list item that held only whitespace leaves the list tight in the editor while its save reloads loose: `$keepLoosenessAfterTyping` reads for a paragraph and for an item's text, not for a raw block. Row L8 starts from that state.

These grow with the document and no faster. The first three rows are from the idle run, at 125 / 250 / 500 / 1,000 items:

| What | Measured |
|---|---|
| save (`getValue`) | 1.1 / 3.3 / 3.5 / 7.1 ms, and 12 ms at 2,000 items |
| one typed character | 0.5 / 0.7 / 1.1 / 2.2 ms, and 4.5 ms at 2,000 items; every update serializes the document (`handleChange`, MarkdownEditor.ts L8273) and walks it once for the definitions |
| undo of the whole-list toggle | 6.0 / 7.7 / 17 / 32 ms, and 59 ms at 2,000 items |
| the selection-state read (`updateSelectionState`, L8295), on the loaded machine | 0.1 to 0.2 ms for a caret, whatever the document; for a range over the whole document about 0.1 ms per selected block (120 to 210 ms at 2,000 list items) |

---

## Addendum: the test file

`packages/lib/tests/component/markdown-editor-list-looseness.test.ts`, complete:

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createParagraphNode, $createRangeSelection, $createTextNode, $getRoot, $getSelection, $getState, $isElementNode, $isTextNode, $setSelection,
    CONTROLLED_TEXT_INSERTION_COMMAND, KEY_ENTER_COMMAND, REDO_COMMAND, UNDO_COMMAND,
} from 'lexical';
import type { LexicalEditor, LexicalNode } from 'lexical';
import { $isListItemNode, $isListNode } from '@lexical/list';
import type { ListItemNode } from '@lexical/list';
import { $generateJSONFromSelectedNodes, $generateNodesFromSerializedNodes, $insertGeneratedNodes } from '@lexical/clipboard';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { listLooseState } from '~/component/editor/markdownNodeState';
import { $listReadsLoose } from '~/component/editor/markdownSerializer';
import { $createMarkdownRawBlockNode } from '~/component/editor/markdownSourceNodes';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

// Wraps the whole-list looseness read in a spy that still reads, so a test can
// count how often an edit reads a whole list; every other test sees it unchanged.
vi.mock('~/component/editor/markdownSerializer.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~/component/editor/markdownSerializer.js')>();

    return { ...actual, $listReadsLoose: vi.fn(actual.$listReadsLoose) };
});

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

function load(source: string): MarkdownEditor {
    const editor = new MarkdownEditor();

    editor.setValue(source);

    return editor;
}

/** The document as a tree: each list with its looseness, each text as written. */
function tree(node: LexicalNode): string {
    const isText = $isTextNode(node);
    const isList = $isListNode(node);
    const isElement = $isElementNode(node);

    if (isText) {
        return JSON.stringify(node.getTextContent());
    }

    if (isList) {
        const looseness = $getState(node, listLooseState) ? 'loose' : 'tight';

        return `${looseness}(${node.getChildren().map(tree).join(', ')})`;
    }

    if (isElement) {
        return `${node.getType()}(${node.getChildren().map(tree).join(', ')})`;
    }

    return node.getType();
}

function shown(editor: MarkdownEditor): string {
    return lexicalOf(editor).read(() => $getRoot().getChildren().map(tree).join(' | '));
}

/** Selects from `offset` in the text node reading `from` to `offset` in the one reading `to`. */
function select(editor: MarkdownEditor, from: string, to: string = from, offset: number = 1): void {
    lexicalOf(editor).update(() => {
        const texts = $getRoot().getAllTextNodes();
        const selection = $createRangeSelection();

        selection.anchor.set(texts.find((node) => node.getTextContent() === from)!.getKey(), offset, 'text');
        selection.focus.set(texts.find((node) => node.getTextContent() === to)!.getKey(), offset, 'text');
        $setSelection(selection);
    }, { discrete: true });
}

/** Runs `edit` on the list item whose text reads `text`, in an update of its own. */
function editItem(editor: MarkdownEditor, text: string, edit: (item: ListItemNode) => void): void {
    lexicalOf(editor).update(() => {
        const node = $getRoot().getAllTextNodes().find((candidate) => candidate.getTextContent() === text)!;
        const item = node.getParents().find($isListItemNode)!;

        edit(item);
    }, { discrete: true });
}

function addParagraph(item: ListItemNode): void {
    item.append($createParagraphNode().append($createTextNode('more')));
}

function dropLastBlock(item: ListItemNode): void {
    item.getLastChild()!.remove();
}

function toggleChecked(item: ListItemNode): void {
    item.setChecked(item.getChecked() !== true);
}

/** Pastes the whole of `source`, loaded in an editor of its own, at the selection. */
function paste(editor: MarkdownEditor, source: string): void {
    const origin = load(source);
    const originLexical = lexicalOf(origin);

    originLexical.update(() => {
        const texts = $getRoot().getAllTextNodes();
        const selection = $createRangeSelection();

        selection.anchor.set(texts[0]!.getKey(), 0, 'text');
        selection.focus.set(texts[texts.length - 1]!.getKey(), texts[texts.length - 1]!.getTextContentSize(), 'text');
        $setSelection(selection);
    }, { discrete: true });

    const nodes = originLexical.read(() => $generateJSONFromSelectedNodes(originLexical, $getSelection()).nodes);
    const lexical = lexicalOf(editor);

    origin.dispose();
    lexical.update(() => {
        $insertGeneratedNodes(lexical, $generateNodesFromSerializedNodes(nodes), $getSelection()!);
    }, { discrete: true });
}

const tight = (count: number): string => Array.from({ length: count }, (_, index) => `- item${index}`).join('\n');
const paragraphs = (count: number): string => Array.from({ length: count }, (_, index) => `para${index}`).join('\n\n');

describe('list looseness: what an edit of one item reads', () => {
    /**
     * The most whole-list reads one edit may make, whatever the list's length.
     * The edits below make 2 to 9 (measured: C1 to C4 make 2, C5 4, C6 9, the
     * pastes counting the load of the copied list); before this rule an edit
     * made one for every changed item and one more for every changed item
     * text, so 26 at the least for the 40 items used here.
     */
    const WHOLE_READS_AT_MOST = 10;

    /** How many whole-list reads `edit` makes on a document of `count` items or paragraphs. */
    function wholeReads(count: number, prepare: (count: number) => MarkdownEditor | null, edit: (editor: MarkdownEditor | null, count: number) => void): number {
        const editor = prepare(count);
        const read = vi.mocked($listReadsLoose);

        read.mockClear();
        edit(editor, count);

        return read.mock.calls.length;
    }

    const ROWS: Array<[name: string, prepare: (count: number) => MarkdownEditor | null, edit: (editor: MarkdownEditor | null, count: number) => void]> = [
        ['C1: a load of a list', () => null, (_editor, count) => { load(tight(count)); }],
        ['C2: the numbered toggle over a whole bulleted list', (count) => {
            const editor = load(tight(count));

            select(editor, 'item0', `item${count - 1}`);

            return editor;
        }, (editor) => { editor!.toggleOrderedList(); }],
        ['C3: the bulleted toggle over paragraphs', (count) => {
            const editor = load(paragraphs(count));

            select(editor, 'para0', `para${count - 1}`);

            return editor;
        }, (editor) => { editor!.toggleUnorderedList(); }],
        ['C4: Enter in the middle item', (count) => {
            const editor = load(tight(count));

            select(editor, `item${count / 2}`);

            return editor;
        }, (editor) => {
            lexicalOf(editor!).dispatchCommand(KEY_ENTER_COMMAND, null);
            editor!.getValue();
        }],
        ['C5: a paste of a list into an empty document', () => {
            const editor = load('');

            lexicalOf(editor).update(() => { $getRoot().selectStart(); }, { discrete: true });

            return editor;
        }, (editor, count) => { paste(editor!, tight(count)); }],
        ['C6: a paste of a loose list into the middle item', (count) => {
            const editor = load(tight(count));

            select(editor, `item${count / 2}`);

            return editor;
        }, (editor, count) => { paste(editor!, Array.from({ length: count }, (_, index) => `- new${index}`).join('\n\n')); }],
    ];

    for (const [name, prepare, edit] of ROWS) {
        it(`${name} reads a whole list a fixed number of times`, () => {
            const short = wholeReads(20, prepare, edit);
            const long = wholeReads(40, prepare, edit);

            expect(long).toBe(short);
            expect(long).toBeLessThanOrEqual(WHOLE_READS_AT_MOST);
        });
    }

    it('C7: the first changed item of each update reads its list whole, once', () => {
        const editor = load(tight(6));
        const read = vi.mocked($listReadsLoose);

        read.mockClear();
        editItem(editor, 'item2', toggleChecked);

        expect(read).toHaveBeenCalledTimes(1);

        read.mockClear();
        editItem(editor, 'item4', toggleChecked);

        expect(read).toHaveBeenCalledTimes(1);
    });

    it('C8: the update that follows an undo reads the list whole again', () => {
        const editor = load(tight(6));
        const read = vi.mocked($listReadsLoose);

        editItem(editor, 'item2', addParagraph);
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
        editor.getValue();
        read.mockClear();
        editItem(editor, 'item2', toggleChecked);

        expect(read).toHaveBeenCalledTimes(1);
    });
});

describe('list looseness: what an edit of one item leaves', () => {
    it.each([
        ['L1: a block added to an item of a tight list', '- a\n- b\n- c', 'b', addParagraph,
            'loose(markdown-list-item(markdown-list-item-text("a")), markdown-list-item(markdown-list-item-text("b"), paragraph("more")), markdown-list-item(markdown-list-item-text("c")))',
            '- a\n\n- b\n\n  more\n\n- c'],
        ['L2: the block that made a list of several items loose is removed', '- a\n- b\n\n  two\n- c', 'b', dropLastBlock,
            'loose(markdown-list-item(markdown-list-item-text("a")), markdown-list-item(markdown-list-item-text("b")), markdown-list-item(markdown-list-item-text("c")))',
            '- a\n\n- b\n\n- c'],
        ['L3: a list of one item loses its second block', '- a\n\n  two', 'a', dropLastBlock,
            'tight(markdown-list-item(markdown-list-item-text("a")))',
            '- a'],
        ['L4: a block added to an item of a nested list', '- a\n  - n\n  - m\n- b', 'n', addParagraph,
            'tight(markdown-list-item(markdown-list-item-text("a"), loose(markdown-list-item(markdown-list-item-text("n"), paragraph("more")), markdown-list-item(markdown-list-item-text("m")))), markdown-list-item(markdown-list-item-text("b")))',
            '- a\n  - n\n\n    more\n\n  - m\n- b'],
        ['L5: an item of one of two lists a load keeps apart is ticked', '- a\n-\n\n\n- b\n- c', 'a', toggleChecked,
            'tight(markdown-list-item(markdown-list-item-text("a")), markdown-list-item(markdown-list-item-text())) | tight(markdown-list-item(markdown-list-item-text("b")), markdown-list-item(markdown-list-item-text("c")))',
            '- a\n-\n\n\n- b\n- c'],
    ] as const)('%s', (_name, source, text, edit, expectedTree, expectedSave) => {
        const editor = load(source);

        editItem(editor, text, edit);

        expect(shown(editor)).toBe(expectedTree);
        expect(editor.getValue()).toBe(expectedSave);
        expect(load(editor.getValue()).getValue()).toBe(expectedSave);
    });

    it('L6: two blocks added to two items in one update, then removed in one update', () => {
        const editor = load('- a\n- b\n- c');

        lexicalOf(editor).update(() => {
            $getRoot().getAllTextNodes().filter((node) => node.getTextContent() !== 'b').forEach((node) => addParagraph(node.getParents().find($isListItemNode)!));
        }, { discrete: true });

        expect(editor.getValue()).toBe('- a\n\n  more\n\n- b\n\n- c\n\n  more');

        lexicalOf(editor).update(() => {
            $getRoot().getAllTextNodes().filter((node) => node.getTextContent() === 'more').forEach((node) => node.getParentOrThrow().remove());
        }, { discrete: true });

        expect(editor.getValue()).toBe('- a\n\n- b\n\n- c');
    });

    it('L7: one undo takes back a toggle over a whole list, and one redo brings it back', () => {
        const editor = load(tight(5));
        const before = editor.getValue();

        select(editor, 'item0', 'item4');
        editor.toggleOrderedList();

        const after = editor.getValue();

        expect(after).toBe('1. item0\n2. item1\n3. item2\n4. item3\n5. item4');

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(before);

        lexicalOf(editor).dispatchCommand(REDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(after);
    });

    it('L8: a list another item made loose unnoticed turns loose when one of its items changes', () => {
        const editor = load('- a\n- b\n- c');

        // A raw block holding a space writes nothing, so the list stays tight; text typed into it makes it a second
        // block of its item, which no looseness rule reads for a raw block.
        editItem(editor, 'a', (item) => { item.append($createMarkdownRawBlockNode(' ')); });
        select(editor, ' ', ' ', 0);
        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, '<div>');
        editor.getValue();
        editItem(editor, 'c', toggleChecked);

        expect(shown(editor)).toBe('loose(markdown-list-item(markdown-list-item-text("a"), markdown-raw-block("<div> ")), markdown-list-item(markdown-list-item-text("b")), markdown-list-item(markdown-list-item-text("c")))');
        expect(editor.getValue()).toBe('- a\n\n  <div>\n\n- b\n\n- c');
    });
});
```

---

## Notes

[^machine]: Both sides ran at the same time, three repeats each, on a private copy of `75d022ba1` and of the prototype, while the machine's load average was between 1 and 9 on 24 cores. The lowest and highest of each three are in *Addendum: what the prototype measured*. The list toggle plan measured the 1,000-item toggle at 5,208 ms on an idle machine (its sign-off 10); here it is 5,979 ms.

[^identical]: Measured, not argued: see `## Verification`, *The differential*, and its result in *Addendum: what the prototype measured*. The comparison includes each update's dirty elements and leaves, which is what Lexical's history reads to decide whether an update is a new undo step.

[^through-item]: The whole read computes `M || (loose && S)`, where `M` is "some item holds blocks that need a blank line between them" and `S` is "the list has two items or more, or its one item holds two blocks" (`$listReadsLoose`, markdownSerializer.ts L1078). For a loose list of several items `S` is true, so the answer is "loose" whatever `M` is: no read is needed. For a loose list of one item the whole read is one item long. For a tight list the answer is `M`, and `M` can have turned true only through an item that changed. A change of an item's blocks marks that item, or its paragraph, item text or raw block, as changed, and each of those runs this rule for that item. Typed text marks only its text node: the typing rule covers it for a paragraph and for an item's text, and not for a raw block, which is what the first whole read of an update is kept for. The typing rule has relied on the same reasoning since `markdown-editor-list-item-block-paste` (its notes, *The cost of a keystroke*), where the read on every keystroke was the measured problem.

    **Rejected: mark the list from the changed item, and read once in the `ListNode` transform.** This was the suggestion in the list toggle plan's sign-off 10, and it mirrors `markTableChanged` in `registerTableRules` (L618). It is wrong here for two reasons. First, marking a list runs the whole of `$normalizeList`, not only the looseness read: it joins the list with a next list of the same marker, renumbers, and lowers the start. A load builds some lists apart that write the same marker and leaves them apart (`$normalizeList` joins none during a load). Today an edit of an item of such a list changes neither list; with the mark, the lists join and the save changes (the case is in *Addendum: what the prototype measured*, and row L5 pins it). Second, the mark makes the list an intentionally dirty element in every update that changes an item, and the history reads the dirty elements to choose between a new undo step and a merge. The digests show the extra element; whether an undo step comes out differently was not followed up, since the first reason already rules the design out. Lexical's transform order is not what rules it out. An element marked during a pass gets its transform in the next pass, and the loop runs until nothing is dirty (`$applyAllTransforms`, `LexicalUpdates.ts`), so the list's read would follow its items' changes. Within one pass the order is the order in which nodes were first marked, with the root last: a list can come before or after its items, so "the list transform runs after its items" holds only through the next pass.

    **Rejected: collect the changed lists and read each once in a `RootNode` transform**, which Lexical runs last in each pass. That reads a list at fewer moments than today. The looseness is sticky: a read that finds one item of one block turns a loose list tight for good, and a read that finds an item with two blocks turns a tight one loose for good while it has several items. `$normalizeList` relies on that between its two reads around a join (L464–468). Reading at other moments can therefore give another result, and nothing short of the full differential would show where. The chosen design reads at the same moments as today.

[^first-whole]: A list can be out of step when an update starts: tight, with an item whose blocks need a blank line. No looseness rule runs when text is typed into a raw block of an item, so a raw block that held only whitespace, and wrote nothing, can come to write something unnoticed. Today the next change of any item of that list reads the whole list and turns it loose. Reading only the changed item would leave it tight until that very item changes. Row L8 is that case; rows C7 and C8 count the read. A prototype without the first whole read passes every other row and fails these three. The looseness set of the differential holds no such state, so that set would not tell the two designs apart (checked on its 2,061 extra cases, where both are byte-identical to the base). The first whole read is what makes the design equal to today's by construction and not only on the sets. It costs one read of the list per update that changes an item, which is what a one-item edit costs today.

    Inside one update the first whole read also covers every write the command made before the first transform ran. After it, only transforms write. A transform that gives an item a new block marks that item, whose own read follows in the next pass.

[^one-update]: The closure variable, the comparison with `editor.getEditorState()`, and the reset in an update listener are `registerDefinitionRules`' own three parts. The listener is there for an undo, which `registerDefinitionRules`' own comment says can make the very state an update started from the current one again; a map keyed by the committed state alone would then find the lists of the update that once started from that state. In the headless harness the state after an undo was a new object each time, so this case was not reproduced; the listener is kept as the precedent has it. Lexical also commits, and so runs the listener, when an update throws (`LexicalUpdates.ts`, the `catch` of `$beginUpdate`). Two updates made without a commit between them share the committed state and therefore the set: the second one's first changed item reads its own item. That is correct by the reasoning of [^through-item]; it differs from today only in how soon a list that is out of step is noticed. The editor's commands each run one update, and key events are committed one by one.

    No state is added to a node and nothing is marked dirty, so an update's dirty elements and leaves are exactly today's.

[^list-rule]: `$normalizeList` runs once for each list an update changed in each pass, so its reads are linear in the lists changed. Recording its reads in `readWhole` would save the first item's whole read, and would make the first changed item of an update skip a whole read that it makes today. Keeping the two apart keeps the item rule's reads a subset of today's at the same moments.

[^count]: `vi.mock` with `importOriginal` replaces `markdownSerializer.js` for every module that imports it, and passes every export through except the wrapped one. The spy counts the calls other modules make: `markdownWritable.ts`, and the importer's `$buildList` for a list whose items hold blocks. `markdownSerializer.ts` itself calls `$listReadsLoose` nowhere. The bound of 10 is far from both sides: the rows make 2 to 9 reads after the change and 26 at the least before it (C4 at 40 items). The equality between 20 and 40 items is the real pin: any read per changed item breaks it.

[^lift-rest]: The toggle lifts each item out of its list before it makes the new items. Lexical's `$removeNode` finds the removed node's index by walking its siblings (`getIndexWithinParent`), so removing n items one by one walks n × n / 2 siblings. A profile of the 2,000-item toggle on the prototype puts 331 of 1,211 ms there and 208 ms in all transforms together (the profiler slows the run about fourfold). It is why the toggle's growth per doubling is a little over 2 at the top. See *Addendum: other costs measured*, row 2.

[^paste-rest]: A paste tags its update so that every block it changed is tidied whole, and the tidy reads the document's link reference definitions once per block. See *Addendum: other costs measured*, row 1.


---

## Implementation Notes

Base: `f6419093b`, which carries the raw block range edits, the join escapes and the cross item range removal under the plan's `75d022ba1`. Step 1's greps matched the plan's counts (five function matches, six `$keepLoosenessWritable(` matches), and the plan's block replaced the three functions with no other change.

**Row L8 differed.** The plan's step 3 expected 6 failed and 10 passed on the base; on this base 7 failed, because L8 failed too. L8 appended a raw block holding one space to item `a` and then typed `<div>` into it. Since the raw block range edits, a blank raw block is normalised to a paragraph, and text typed into a paragraph runs `$keepLoosenessAfterTyping`, which reads the item. The list therefore turned loose at the typing step and the row no longer left a list out of step, so it would have passed without the first whole read. The row keeps its intent and now builds the out-of-step list differently: a paragraph holding a space is appended to item `a`, its text is set to `<div>` in an update with `skipTransforms`, so no rule runs, and item `c` is then ticked. The expected tree shows a `paragraph("<div>")` in place of the raw block, and the save escapes it as `\<div>`. With the first whole read removed, C7, C8 and L8 fail; with it, all 16 rows pass.

**Differential.** The scripts ran with one job at a time (the machine limit) instead of three. `cmpall.sh parent branch` printed `ALL IDENTICAL`: looseness set 12 record files and 12 digest files (33,480 and 1,963,635 identical lines), the extra documents (2,061 and 89,930 lines), fuzz results 60 files and fuzz digests 60 files (5,403,360 lines), toggle sets 63 record files and 63 digest files (117,464 and 2,811,743 lines). The parent is `f6419093b`, the branch code commit is the one titled "Keep list looseness in time proportional to the items an edit changes".

**Timings.** Three runs, medians, the parent and the branch run one after the other (not at the same time, because only one vitest process may run); the machine was not fully idle (load average about 2 from another worker's tests). Tight bulleted list of 125 / 250 / 500 / 1,000 / 2,000 items:

| Edit | Parent | Branch |
|---|---|---|
| Load | 91 / 327 / 1,298 / 5,196 / 21,642 ms | 14 / 22 / 32 / 54 / 113 ms |
| Numbered toggle over the whole list | 105 / 338 / 1,379 / 5,492 / 23,690 ms | 17 / 29 / 70 / 142 / 343 ms |
| Enter in the middle item | 16.5 / 60.5 / 256 / 1,069 / 4,196 ms | 2.2 / 3.8 / 8.7 / 14.9 / 31.2 ms |
| One typed character | 0.5 / 0.8 / 1.1 / 2.0 / 4.2 ms | 0.5 / 0.8 / 1.2 / 2.1 / 4.0 ms |
| Paste of a list into an empty document | 113 / 417 / 1,620 / 6,404 / 25,676 ms | 64 / 223 / 809 / 3,217 / 12,328 ms |

Undo, redo and save are unchanged. The paste at 500 items into a list took 19,745 ms on the parent and 4,060 ms on the branch. The paste stays quadratic, as the plan's *Addendum: other costs measured* says. The toggle's last doubling is x2.4 (142 to 343 ms), at the plan's bound.

**Other checks.** Full suite 21,215 passed and 2 todo in 573 files (16 more tests than the base). `npm run typecheck`, `typecheck:test`, `lint`, `docs:api`, `docs:llms:check` and `build:lib` are clean. The manual browser check of the plan was not run.

**Stale claims of the plan.** The plan's non-goal and defect about a list left out of step after typing in a raw block (lines 430 and 538) are stale on this base. The original row L8 already turns the list loose at the typing step even with the first whole read removed, so that read now guards a state no known edit reaches. It is kept for safety.

**Paste ratios.** The paste of a list into an empty document takes 0.56, 0.53, 0.50, 0.50 and 0.48 of the parent's time at 125 to 2,000 items. The two smallest sizes miss the plan's "under half".

**Toggle bound.** The toggle's last doubling (1,000 to 2,000 items) is x2.415, just over the plan's x2.4 bound. That is within the noise of the runs, and is stated here and not rounded.

**Untested listener.** No test reaches the update listener that clears the set of lists read whole at each commit. As with `registerDefinitionRules`' listener, it is documented and cannot be reproduced in the test harness.
