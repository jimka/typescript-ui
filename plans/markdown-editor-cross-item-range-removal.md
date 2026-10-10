---
depends-on: [markdown-editor-list-item-node, markdown-editor-raw-block-range-edits]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/tests/component/markdown-editor-list-item-edits.test.ts
  - packages/lib/tests/component/markdown-editor-list-item-paste.test.ts
  - packages/lib/tests/component/markdown-editor-command-crashes.test.ts
  - packages/lib/tests/component/markdown-editor-table-edge.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Cross-Item Range Removal — Implementation Plan

## Overview

In `MarkdownEditor`'s WYSIWYG mode a list item is a `MarkdownListItemNode`. Its first child is the item's text (a `MarkdownListItemTextNode`), and the blocks the item holds follow that text. When an edit joins an item's text onto the block before it, the editor moves what the item held after its text into the item before. This plan calls that the *join rule*. It is decided in `MarkdownListItemTextNode.remove` ([markdownListItemNode.ts:541](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L541)).

The join rule runs only when the removed range ends *in* the item's text. A range that runs past the text and ends in a later block of the item removes the text whole, and the rule never runs.[^cause] The item is left as a bullet with no text line:

| Document | Range removed with Backspace | Saved today | Saved after this plan |
|---|---|---|---|
| `- ab⏎- cd⏎⏎  pq⏎  - nn⏎⏎  rr⏎- z` | `"ab"`@1 → `"cd"`@1 (ends in the text) | `- ad⏎⏎  pq⏎⏎  - nn⏎⏎  rr⏎⏎- z` | the same |
| the same | `"ab"`@1 → `"pq"`@1 (ends in a later block) | `- aq⏎⏎- - nn⏎⏎  rr⏎⏎- z` | `- aq⏎  - nn⏎⏎  rr⏎⏎- z` |
| `- ab⏎- cd⏎⏎  pq⏎⏎  rr⏎- z` | `"ab"`@1 → `"pq"`@1 | `- aq⏎⏎- rr⏎⏎- z` | `- aq⏎⏎  rr⏎⏎- z` |

(`⏎` is a line end. `"text"`@n is offset n in the text node holding exactly that text.)

The user decided on 2026-10-10 that the two cases must agree: such a range follows the join rule. The fix is in [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts). `$removeGuardedRange`, the function every edit that removes a range goes through, removes such a range in steps, so the join rule runs once for each item whose text the range takes. No node class changes and no public API changes. Rows are added to four existing test files, and the docs page and the changelog get one addition each.

Line numbers are from `b154a9b3a`, the tip of `feature/markdown-editor-list-item-node`. This plan is implemented after [markdown-editor-raw-block-range-edits](markdown-editor-raw-block-range-edits.md), called *the dependency* below. The dependency moves and renames code in the same file, so find every site by its symbol name.

---

## Architecture Decisions

### One rule — an item whose text the range takes whole is joined away

A list item is *joined away* by a range when all four hold:

1. the range ends inside the item (in one of its blocks, at any depth, or between two of its blocks);
2. the range does not start inside the item;
3. the item opens with a text, and the range ends after that text (the text is *taken whole*);
4. removing the range up to the end of that text would join the text onto the block the range starts in (see [the join condition](#the-rule-applies-only-where-the-text-would-join-the-block-the-range-starts-in)).

Such an item goes, and what the range leaves of it moves as the join rule moves it. The join rule itself is unchanged:

| Where the joined-away item stands | Where what is left of it goes | Example (Backspace, `"ab"`@1 → `"pq"`@1) |
|---|---|---|
| after another item of its list | to the end of that item | `- ab⏎- cd⏎⏎  pq⏎⏎  rr⏎- z` → `- aq⏎⏎  rr⏎⏎- z` |
| first in its list, right after a list of another marker | to the end of that list's last item | `+ ab⏎⏎- cd⏎⏎  pq⏎⏎  rr⏎- z` → `+ aq⏎⏎  rr⏎⏎- z` |
| first in its list, after anything else | the blocks up to its first nested list go before the list; the nested list and what follows stay in the item | `ab⏎⏎- cd⏎⏎  pq⏎⏎  rr⏎- z` → `aq⏎⏎rr⏎⏎- z` |

A range that joins at least one item away is called a *cross-item range* below. The third row of the table leaves an item without text when what is left starts at a nested list. That result is the join rule's own and stays; see [What stays as it is](#what-stays-as-it-is).

### The removal is done one item text at a time — the join rule's own code does the move

`$removeGuardedRange` removes a cross-item range in steps, inside one update:

1. For each item text the range takes whole, outermost first: remove the range from its start to the end of that text. That is a range that ends in an item's text, which Lexical ends by calling the text's `remove`, so the join rule runs as it does today.
2. Then remove what is left of the range, from the same start to the same end, as any other range.

No code moves an item's blocks except `MarkdownListItemTextNode.remove`. The result equals what the user gets today by deleting up to the end of the item's first line and then deleting the rest.[^stepwise]

| Step | Selection | The document, as a save would write it after the step |
|---|---|---|
| start | `"ab"`@1 → `"pq"`@1 | `- ab⏎- cd⏎⏎  pq⏎  - nn⏎⏎  rr⏎- z` |
| 1 | `"ab"`@1 → `"cd"`@2 removed | `- a⏎⏎  pq⏎⏎  - nn⏎⏎  rr⏎⏎- z` (the join rule moved `pq`, the nested list and `rr`) |
| 2 | `"a"`@1 → `"pq"`@1 removed | `- aq⏎  - nn⏎⏎  rr⏎⏎- z` |

Two existing pieces of code set the pattern. `$removeRangeKeepingEndBlock` ([MarkdownEditor.ts:1912](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1912)) already removes one range in two removals to control what Lexical does at the range's end. `MarkdownListItemTextNode.remove` already owns the move.

### A fourth guarded shape — every route goes through `$removeGuardedRange`

A *route* is one way of removing or replacing a selection: Backspace, Delete, a word or line delete, a cut, typing, an input method, Enter, Shift+Enter, Tab, a paste, a drag, and the public methods `cut()`, `paste()` and `insertImage()`. A *guarded range* is a selection of a shape that `$removeGuardedRange` removes itself, ahead of the route's own handler. `registerRangeGuards` ([MarkdownEditor.ts:3508](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3508)) registers one listener per Lexical command for it.

After the dependency there are three guarded shapes, tested by `$isGuardedRange`, and every route removes a guarded range through `$removeGuardedRange`:

| Shape | What it is | Its removal |
|---|---|---|
| table-edge range | one end inside a table, the other end outside it | the *table-edge removal*: the whole table goes, and nothing is joined |
| text-only-edge range | one end inside a raw block or a code block, the other end outside it | when the range starts in that block, the *text-only join*: the rest of the end's block joins as its Markdown |
| stale-focus range | ends inside a word of a later block than the range starts in | the *stale-focus removal*: Lexical's removal, made safe against a fault in it |

This plan adds the cross-item range as the fourth shape. No listener is added, moved or re-prioritised.[^fourth-shape]

A range can be several shapes at once. The steps of this plan run first. What is left is removed in the order the dependency fixed:

| Range (start → end) | Shapes | Removed by |
|---|---|---|
| item text → a later item's paragraph, in a word | cross-item, stale-focus | the steps, then the stale-focus removal |
| item text → a later item's paragraph, at its start or end | cross-item | the steps, then Lexical's `removeText()` |
| code block → a later block of an item | cross-item, text-only-edge | the steps, each through the text-only join, then the text-only join |
| item text → a cell of a table a later item holds | cross-item, table-edge | the steps, then the table-edge removal |
| table cell → a later block of an item | table-edge | the table-edge removal alone (not cross-item: nothing joins) |
| item text → that item's own later block | none of these | Lexical, as today |

### The rule applies only where the text would join the block the range starts in

`$removalJoinsEndBlockRest` ([MarkdownEditor.ts:1519](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1519)) already tells whether Lexical's removal joins the end's block onto the start's block. This plan asks it with the item's text as the end's block. Where the answer is no, the item is not joined away and the range is removed as today.[^join-condition]

| The range starts in | Joins? | Result for `… - cd⏎⏎  pq⏎  - nn⏎⏎  rr⏎- z`, start@1 → `"pq"`@1 |
|---|---|---|
| an item's text, or a further paragraph, heading or quote of an item | yes | the item is joined away |
| a paragraph, heading or quote outside the list | yes | joined away, as a list's first item (the third row of the table under *One rule*) |
| a code block or a raw block | yes | joined away; the rest of `pq` joins as its Markdown, as the dependency defines |
| a table cell | no | `- q⏎  - nn⏎⏎  rr⏎⏎- z`: the item stays, as today |
| a `:::` column the list is not in | no | `::: {align=center}⏎a⏎:::⏎⏎- q⏎  - nn⏎⏎  rr⏎⏎- z`: the item stays, as today |
| between two blocks (a point on a list item, a list, the root or a column) | no | as today |

`$removalJoinsEndBlockRest` takes two nodes instead of two points, so it can be asked about a block the selection does not end in. Its one existing caller passes `start.getNode()` and `end.getNode()`.

### Every kind of block the range can end in

The rule does not depend on the block the range ends in. What differs is what the last removal does with that block, which is unchanged.

The first five rows are for `- ab⏎- cd⏎⏎  {block}⏎⏎  rr⏎- z`, where `{block}` holds the text `pq`, and the range `"ab"`@1 → `"pq"`@1. The last two are for `- ab⏎- cd⏎⏎  pq⏎  - nn⏎⏎  rr⏎- z`.

| The range ends in | What the last removal does with that block | Saved after |
|---|---|---|
| a paragraph, heading or quote | its rest joins the start's text | `- aq⏎⏎  rr⏎⏎- z` |
| a code block | its rest joins the start's text | `- aq⏎⏎  rr⏎⏎- z` |
| a raw block (`<div>⏎pq⏎</div>`) | its rest joins the start's text, as text | `- aq\⏎  \</div>⏎⏎  rr⏎⏎- z` |
| a table | the whole table goes (the table-edge removal) | `- a⏎⏎  rr⏎⏎- z` |
| a `:::` block | the block stays, with what the range left of it | `- a⏎⏎  ::: {align=center}⏎  q⏎  :::⏎⏎  rr⏎⏎- z` |
| a nested item's text (`"ab"`@1 → `"nn"`@1) | the join rule, for the nested item | `- an⏎⏎  rr⏎⏎- z` |
| between two blocks of the item (after `pq`) | nothing joins | `- a⏎  - nn⏎⏎  rr⏎⏎- z` |

### Depth — several item texts, outermost first

A range can take the text of an item and of items nested in it. Each is joined away in turn, the outermost first. Blocks therefore keep the depth they had wherever an item of that depth is there to take them.

| Document | Range | Saved after |
|---|---|---|
| `- ab⏎- cd⏎  - nn⏎⏎    pq⏎⏎    ss⏎  - mm⏎⏎  rr⏎- z` | `"ab"`@1 → `"pq"`@1 (takes `cd` and `nn`) | `- aq⏎⏎  ss⏎⏎  - mm⏎⏎  rr⏎⏎- z` |
| the same | `"ab"`@1 → `"nn"`@1 (takes `cd`, ends in `nn`) | `- an⏎⏎  pq⏎⏎  ss⏎⏎  - mm⏎⏎  rr⏎⏎- z` |
| `- t⏎  - ab⏎- cd⏎  - nn⏎⏎    pq⏎⏎    ss⏎  - mm⏎⏎  rr⏎- z` | `"ab"`@1 → `"pq"`@1 (starts in a nested item) | `- t⏎  - aq⏎⏎    ss⏎⏎  - mm⏎⏎  rr⏎⏎- z` |

Items the range covers from start to end are removed whole by Lexical, as today. Task items and ordered lists need no rule of their own: the task marker is part of the text that goes, and an ordered list is renumbered by the existing list rules.

### Each route inserts at the caret the removal leaves

A cross-item range is a guarded range, so the dependency's contract holds for it: the range is removed as Delete removes it, and the route then does what it does at a collapsed caret. Results for `- ab⏎- cd⏎⏎  pq⏎  - nn⏎⏎  rr⏎- z`, `"ab"`@1 → `"pq"`@1:

| Route | Saved after |
|---|---|
| Backspace, Delete, word delete, `REMOVE_TEXT_COMMAND`, `cut()`, native cut | `- aq⏎  - nn⏎⏎  rr⏎⏎- z` |
| type `x` | `- axq⏎  - nn⏎⏎  rr⏎⏎- z` |
| Enter | `- a⏎⏎- q⏎  - nn⏎⏎  rr⏎⏎- z` (the new item takes the blocks, as Enter in any item's text) |
| Shift+Enter | `- a\⏎  q⏎  - nn⏎⏎  rr⏎⏎- z` |
| Tab | `- a⇥q⏎  - nn⏎⏎  rr⏎⏎- z` (`⇥` is a tab) |
| `paste()` or a plain-text paste of `zc` | `- azcq⏎  - nn⏎⏎  rr⏎⏎- z` |
| `insertImage('/i.png', { alt: 'i' })` | `- a![i](/i.png)q⏎  - nn⏎⏎  rr⏎⏎- z` |
| a paste of the paragraphs `P1`, `P2` | `- aP1⏎⏎P2q⏎⏎- - nn⏎⏎  rr⏎⏎- z` (blocks pasted at an item's text split the list; that paste rule is unchanged) |

Enter over a range that leaves the start's text empty changes with this contract.[^enter] See [Results that change](#results-that-change).

### Shift+Enter is judged before anything is removed

A declined Shift+Enter must change nothing. `$guardedRemovalDeclinesLineBreak` ([MarkdownEditor.ts:2282](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2282)) decides before the removal. It now decides for a cross-item range as it decides for a stale-focus range: Shift+Enter is declined when the start's block is a level 3–6 heading, or when nothing would follow the break in the start's block once the range is gone. The steps do not change the answer: they move blocks, and the decision reads only the start's block and the rest of the end's block.

| Range | Decision | Result |
|---|---|---|
| `"ab"`@1 → `"pq"`@1 | kept: `q` follows the caret | removed, then a break: `- a\⏎  q⏎  - nn⏎⏎  rr⏎⏎- z` |
| `"ab"`@1 → `"pq"`@2 | declined: nothing follows the caret in its text | document and selection unchanged |
| `"ab"`@1 → a cell of a table the later item holds | declined by the table-edge decision, as today | document and selection unchanged |

### The editor's contract holds in every row

| Rule of the editor | How this plan keeps it | Checked by |
|---|---|---|
| The editor never holds a state Markdown cannot represent, and a save reloads to the same document | The steps are removals the editor already makes, and the rules that run when an update ends run after the last of them | `runRow`'s reload, save-again and viewer checks after every step; the same three checks in every cell of the probe |
| Blocks that were not edited are saved byte for byte | Only the blocks of a joined-away item move, and they are written as the join rule writes them today | row CI39 |
| One command is one undo step | The steps and the last removal run inside the guard's update; nothing is dispatched later | row CI77, `expectUndoRestores` in rows CI60 to CI65, the probe's undo check |
| A command that is unavailable changes nothing | Shift+Enter is judged before the first step; `insertImage()` declines before any removal; a paste that inserts nothing never reaches the removal | rows CI44, CI79, CI80 |
| The viewer and the editor accept the same syntax | No syntax is read or written differently | — |

### This plan is implemented after `markdown-editor-raw-block-range-edits`

`markdown-editor-raw-block-range-edits` makes `$removeGuardedRange` the one removal on every route, Delete included, and gives the non-table removal a name, `$removeJoiningRange`. This plan adds its steps to the first and calls the second for each step. Implemented in the other order, the same rule would need four more edit sites, and the dependency's replaced function bodies would then remove them.[^order]

This plan needs these symbols from the dependency, by name:

| Symbol | What this plan does with it |
|---|---|
| `$isGuardedRange(selection)` | adds the cross-item shape to it |
| `$removeGuardedRange(selection, caretStaysOutOf)` | adds one call before its removal |
| `$removeJoiningRange(selection)` | calls it for each step |
| `$joiningRemovalDeclinesLineBreak(selection)` | changes the one call it makes to `$removalJoinsEndBlockRest` |
| `$guardedRemovalDeclinesLineBreak(selection)` | adds the cross-item shape to its `isJoining` |
| `DELETE_CHARACTER_COMMAND` registered with `$deleteGuardedRange` | relies on it; changes nothing |

The dependency was written before `markdown-editor-list-item-node` and must be brought up to the stack's tip before it is implemented. Bringing it up to date is the dependency's own work. If the dependency's implementation ends with other names, its *Implementation Notes* give them; the roles in the table are what matter.

Other unstarted plans that edit the same code:

| Plan | Overlap | Order |
|---|---|---|
| `markdown-editor-table-command-fixes` | adds `$settleSelectionOffContainers` as the first call of `$removeGuardedRange` and of each guard | either; that call stays first, before `$joinCoveredItemTexts` |
| `markdown-editor-readonly-keyboard-selection` | adds a read-only guard ahead of `registerRangeGuards` | either; this plan adds no listener |
| `markdown-editor-raw-block-edge-cases`, `markdown-editor-table-cells-paste-empty-column`, `markdown-editor-paste-undo-merge`, `markdown-editor-link-format-command-fixes`, `markdown-list-toggle-task-item-parity` | the same files, other functions; `markdown-editor-raw-block-edge-cases` moves three rows of `markdown-editor-list-item-edits.test.ts` | either |

### What stays as it is

Each of these is the same before and after this plan.

| Case | Example | Why it stays | Rows |
|---|---|---|---|
| A joined-away item that is first in its list keeps its nested list and what follows, in an item with no text | `- ab⏎  - cd⏎⏎    pq⏎    - nn⏎⏎    rr⏎  - e⏎- z`, `"ab"`@1 → `"pq"`@1 gives `- aq⏎  - - nn⏎⏎    rr⏎⏎  - e⏎- z` | It is the join rule's result for the same range ending in `cd` (rows V8 and K14). The decision is to follow the join rule, not to change it.[^first-item] | CI34, CI35, CI58 |
| An item that opens with a block other than text is never joined away | `- ab⏎- # cd⏎⏎  pq⏎⏎  rr⏎- z`, `"ab"`@1 → `"pq"`@1 gives `- aq⏎⏎- rr⏎⏎- z` | A range that ends in that opening block does not move the rest either: the block is Lexical's node, and the join rule is about an item's text.[^opening-block] | CI38 |
| A range that starts where nothing joins | see [the join condition](#the-rule-applies-only-where-the-text-would-join-the-block-the-range-starts-in) | Without a join there is no block for the item's text to join, so the item keeps what is left as its own.[^no-join] | CI36, CI37, D38 |
| A range that starts in the item it ends in | `- ab⏎- cd⏎⏎  pq⏎  - nn⏎⏎  rr⏎- z`, `"cd"`@1 → `"pq"`@1 gives `- ab⏎⏎- cq⏎  - nn⏎⏎  rr⏎⏎- z` | The text is not taken whole. Lexical joins `pq` onto it, as today. | CI66 |
| A range that takes everything an item holds | the same document, `"ab"`@1 → `"rr"`@2 gives `- a⏎⏎- z` | Nothing is left to move. Lexical already removes the emptied item. | CI33 |
| `insertTable()` over a range | — | It removes no range unless the range is a table-edge one, as today. | — |
| Delete or Backspace at a collapsed caret | — | It is a join, not a range. The join rule already decides it. | V8, K1 to K11 |
| What a paste does at the caret | the last row of the route table under *Each route inserts at the caret the removal leaves* | The paste rules are unchanged; only the removal before the paste changes. | CI60 |

### Results that change

Beyond the rows this plan adds, one pinned row changes, and Enter changes for one kind of range.

| What | Before | After | Reason |
|---|---|---|---|
| Row D32 of `markdown-editor-table-edge.test.ts`: from the text of the item before into a table that ends an item | `[d]: /first⏎⏎- w⏎⏎-⏎⏎- * n6⏎⏎    p7⏎⏎# g12` (an emptied item stays) | `[d]: /first⏎⏎- w⏎⏎- * n6⏎⏎    p7⏎⏎# g12` | The range takes the item's text whole, so the item is joined away. The table still goes whole and nothing is joined onto `w`.[^d32] |
| Enter over a range from the very start of an item's text to the end of a later item's block, a paragraph left | `- ab⏎- cd⏎⏎  pq⏎⏎  rr⏎- z`, `"ab"`@0 → `"pq"`@2: `-⏎⏎-⏎⏎- rr⏎⏎- z` | `- rr⏎⏎- z`, the caret before `rr` | As Enter over all of a text above a paragraph (row Z10). |
| the same, nothing left | `- ab⏎- cd⏎⏎  pq⏎- z`: `-⏎⏎-⏎⏎- z` | an empty paragraph, then `- z` | As Enter in an item holding blank text alone (row V4). |
| the same, a nested list left | `- ab⏎- cd⏎⏎  pq⏎  - nn⏎⏎  rr⏎- z`: `-⏎⏎-⏎⏎- - nn⏎⏎  rr⏎⏎- z` | an empty paragraph, then `- - nn⏎⏎  rr⏎⏎- z` | As Enter in an emptied text over a nested list (row Z9). |

Rows Z43 and Z44 (Enter over the text of items of text alone) do not change: those ranges end in an item's text, so they are not cross-item ranges.

---

## Internal Structure

All in `MarkdownEditor.ts`. Write full JSDoc per CODE_CONVENTIONS; the summaries below give the content.

### Imports

Add `$isSiblingCaret` to the value import from `"lexical"` ([:19](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L19)). Add a type import beside the existing import from `markdownListItemNode.js` ([:77](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L77)):

```typescript
import type { MarkdownListItemTextNode } from "~/component/editor/markdownListItemNode.js";
```

### `$removalJoinsEndBlockRest` — two nodes instead of two points

Only the signature and the first two lines of the body change. The `@remarks` stay.

```typescript
function $removalJoinsEndBlockRest(startNode: LexicalNode, endNode: LexicalNode): boolean {
    const startBlock = $findEnclosingBlock(startNode);
    const endBlock = $findEnclosingBlock(endNode);
    // … the rest as it is
```

Its caller, `$joiningRemovalDeclinesLineBreak`, becomes:

```typescript
    const joinsRest = $removalJoinsEndBlockRest(start.getNode(), end.getNode());
```

### The shape and the steps

Place these four functions directly before `$isGuardedRange`.

```typescript
/**
 * The texts of the list items a range joins away, the outermost first: of
 * each item the range ends inside and does not start inside, the text the
 * item opens with, when the range ends after that text and its removal up to
 * the text's end would join the text onto the block the range starts in.
 */
function $itemTextsRangeTakesWhole(selection: RangeSelection): MarkdownListItemTextNode[] {
    const [start, end] = $orderedPoints(selection);
    const startNode = start.getNode();
    const endNode = end.getNode();
    const texts: MarkdownListItemTextNode[] = [];

    // Walked from the end outwards and put in front, so the outermost text comes first.
    for (const item of [endNode, ...endNode.getParents()]) {
        const text = $isMarkdownListItemNode(item) ? item.getFirstChild() : null;
        const holdsStart = item.is(startNode) || item.isParentOf(startNode);
        const endsBeforeText = item.is(endNode) && end.offset === 0;
        const isEnteredItemText = $isMarkdownListItemTextNode(text) && !holdsStart && !endsBeforeText;
        const holdsEnd = isEnteredItemText && (text.is(endNode) || text.isParentOf(endNode));
        const isJoinedAway = isEnteredItemText && !holdsEnd && $removalJoinsEndBlockRest(startNode, text);

        if (isJoinedAway) {
            texts.unshift(text);
        }
    }

    return texts;
}

/**
 * Whether `selection` is a cross-item range: a range that is not collapsed
 * and joins at least one list item away ($itemTextsRangeTakesWhole).
 */
function $isCrossItemRange(selection: BaseSelection | null): selection is RangeSelection {
    const isRange = $isRangeSelection(selection) && !selection.isCollapsed();

    if (!isRange) {
        return false;
    }

    return $itemTextsRangeTakesWhole(selection).length > 0;
}

/**
 * A caret for `point` that names a node the steps of $joinCoveredItemTexts
 * do not remove: the node after the point when there is one, else the node
 * before it. A point on a list item is lost when that item is joined away;
 * the caret finds the same place again wherever the item's blocks went.
 */
function $caretKeepingItsPlace(point: PointType): PointCaret<CaretDirection> {
    const before = $caretFromPoint(point, "previous");
    const namesNodeAfter = point.type === "text" || $isSiblingCaret(before);

    return namesNodeAfter ? before : $caretFromPoint(point, "next");
}

/**
 * Joins away each list item whose text `selection` takes whole, the
 * outermost first: removes the range from its start to the end of that text,
 * which Lexical ends by removing the text, so the text's own `remove` moves
 * what the item held after it. Leaves `selection` a range from the same
 * start to the same end, for the caller to remove. Does nothing to a range
 * that takes no item's text whole.
 */
function $joinCoveredItemTexts(selection: RangeSelection): void {
    const texts = $itemTextsRangeTakesWhole(selection);

    if (texts.length === 0) {
        return;
    }

    const [start, end] = $orderedPoints(selection);
    const endCaret = $caretKeepingItsPlace(end);
    const startAt: [NodeKey, number, "text" | "element"] = [start.key, start.offset, start.type];

    // Forward from here on: the anchor is the range's start, and each removal leaves it there.
    selection.anchor.set(...startAt);

    for (const text of texts) {
        $setPointFromCaret(selection.focus, $normalizeCaret($getChildCaret(text, "previous")));
        $removeJoiningRange(selection);

        const isEndLeft = endCaret.origin.isAttached();

        // The range ended right after the text of an item holding nothing else: it is removed.
        if (!isEndLeft) {
            return;
        }

        $setPointFromCaret(selection.focus, endCaret);
    }
}
```

`$caretFromPoint`, `$getChildCaret`, `$normalizeCaret` and `$setPointFromCaret` are imported already. `endCaret` is computed before the first step, because a step can remove the node a point of the selection is on.[^caret]

### The three edits to the dependency's functions

`$isGuardedRange` gets one more clause:

```typescript
function $isGuardedRange(selection: BaseSelection | null): selection is RangeSelection {
    return $isTableEdgeRange(selection) || $isTextOnlyEdgeRange(selection) || $isStaleFocusRange(selection) || $isCrossItemRange(selection);
}
```

`$removeGuardedRange` gets one call, directly before its `if (isTableEdge)`:

```typescript
    $addUpdateTag(RUN_EDGE_TAG);
    // Before either removal: each then meets a range that takes no item's text whole.
    $joinCoveredItemTexts(selection);

    if (isTableEdge) {
        $removeTableEdgeRange(selection, caretStaysOutOf);
    } else {
        $removeJoiningRange(selection);
    }
```

`isTableEdge` may stay where the dependency computes it: the steps move neither end into or out of a table.

`$guardedRemovalDeclinesLineBreak` gets one more clause:

```typescript
    const isJoining = $isTextOnlyEdgeRange(selection) || $isStaleFocusRange(selection) || $isCrossItemRange(selection);
```

---

## Ordered Implementation Steps

Work test-first. Run test files from `packages/lib` with `npx vitest run <file>`.

1. **Check the dependency.** From the repo root:
   - `grep -n 'function \$isGuardedRange\|function \$removeJoiningRange\|function \$joiningRemovalDeclinesLineBreak' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` gives three lines.
   - `grep -n 'DELETE_CHARACTER_COMMAND, \$deleteGuardedRange' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` gives one line.
   - `grep -n '\$isStaleFocusRange(' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` gives the definition and calls inside `$isGuardedRange`, `$removeJoiningRange` and `$guardedRemovalDeclinesLineBreak` only.

   If a check fails, stop and read the *Implementation Notes* of `plans/implemented/markdown-editor-raw-block-range-edits.md` for the names it ended with. A listener that still tests a shape on its own must be changed to `$isGuardedRange` before going on, or that route will miss the new shape.
2. **Record the parent's results** for the differential check: run the probe on the commit the branch starts from, as [Verification](#verification) describes. Do this before any source change.
3. **Add the rows** of [Expected Behaviour](#expected-behaviour) to the four test files. Run the four files. Every row marked *red* fails and every row marked *green* passes. If a row marked *red* passes, stop and re-read the row.
4. **`MarkdownEditor.ts` imports:** add `$isSiblingCaret` and the `MarkdownListItemTextNode` type import.
5. **`$removalJoinsEndBlockRest`:** change its two parameters to nodes and update its caller, as in *Internal Structure*. Update its `@param` lines. Check: `npx vitest run tests/component/markdown-editor-command-crashes.test.ts` is as it was after step 3 (no behaviour changes in this step).
6. **Add `$itemTextsRangeTakesWhole`, `$isCrossItemRange`, `$caretKeepingItsPlace` and `$joinCoveredItemTexts`** directly before `$isGuardedRange`.
7. **Edit `$isGuardedRange`, `$removeGuardedRange` and `$guardedRemovalDeclinesLineBreak`**, as in *Internal Structure*.
8. **JSDoc.** Update each comment that counts or lists the guarded shapes, so each names four or says "a guarded range": `$isGuardedRange`, `$removeGuardedRange` (it also says the steps run first), `registerRangeGuards`, `$guardedRemovalDeclinesLineBreak`, `$joiningRemovalDeclinesLineBreak` (it now tells for a cross-item range too). Check: `grep -n 'three range shapes\|three shapes' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` gives no match.
9. **Run the four test files.** Every row passes. D32 passes with its new value.
10. **Docs:** edit `packages/lib/docs/components/MarkdownEditor.md` and `packages/lib/docs/reference/changelog/next.md` as in [Documentation Impact](#documentation-impact).
11. **Verification**, in full, the differential check included.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-list-item-edits.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-list-item-paste.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-command-crashes.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-table-edge.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Everything here is unit-testable offline unless it is under [Manual (browser) checks](#manual-browser-checks). Expected strings are `getValue()`, written as TypeScript string literals. They were measured with a prototype of this plan; see the [addendum](#addendum-measurements). *Red* means the row fails before the change; *green* means it passes before and after.

Two documents are used throughout. Define both inside each new `describe` that names them:

```typescript
/** A second item holding a paragraph, a nested list and a paragraph. */
const A = '- ab\n- cd\n\n  pq\n  - nn\n\n  rr\n- z';
/** A second item holding two paragraphs. */
const B = '- ab\n- cd\n\n  pq\n\n  rr\n- z';
```

### Rows in `markdown-editor-list-item-edits.test.ts`

One new `describe`, placed last in the file: `a range that takes a list item's text whole joins that item away (CI rows)`. The rows are `Row`s run by the file's `runRow` ([:299](../packages/lib/tests/component/markdown-editor-list-item-edits.test.ts#L299)), which also checks after every step that the save reloads to the same document, saves the same again and reads the same in the viewer. A step with `at` and `to` selects that range first; the range is given start first unless the row says *backward*. Put the rows of the three tables below in one `it.each<Row>([…])('$name', runRow)`, each named by its number and a few words saying what the row is (`'CI1: the decision\'s own case'`).

One helper is local to the `describe`. It selects from a text point to a point between two blocks of an item, which only an element point can express:

```typescript
/** Selects from `from` to between two blocks of the list item whose text is `text`: an element point on the item. */
const selectToItem = (from: TextPoint, text: string, offset: number) => (editor: MarkdownEditor): void => {
    lexicalOf(editor).update(() => {
        const item = $textNode(text).getParentOrThrow().getParentOrThrow();
        const selection = $createRangeSelection();

        selection.anchor.set($textNode(from[0]).getKey(), from[1], 'text');
        selection.focus.set(item.getKey(), offset, 'element');
        $setSelection(selection);
    }, { discrete: true });
};
```

**The rule.** One `Backspace` step each, unless the row says otherwise.

| # | What | `source` | Range | `saved` | Today |
|---|---|---|---|---|---|
| CI1 | the decision's own case | `A` | `ab`@1 → `pq`@1 | `'- aq\n  - nn\n\n  rr\n\n- z'` | red |
| CI2 | the same with `Delete`, backward | `A` | `pq`@1 → `ab`@1 | as CI1 | red |
| CI3 | ends at the block's start | `A` | `ab`@1 → `pq`@0 | `'- apq\n  - nn\n\n  rr\n\n- z'` | red |
| CI4 | ends at the block's end | `A` | `ab`@1 → `pq`@2 | `'- a\n  - nn\n\n  rr\n\n- z'` | red |
| CI5 | a paragraph is left | `B` | `ab`@1 → `pq`@1 | `'- aq\n\n  rr\n\n- z'` | red |
| CI6 | ends in a nested item's text | `A` | `ab`@1 → `nn`@1 | `'- an\n\n  rr\n\n- z'` | red |
| CI7 | a heading is left | `'- ab\n- cd\n\n  pq\n\n  ## hh\n- z'` | `ab`@1 → `pq`@2 | `'- a\n\n  ## hh\n\n- z'` | red |
| CI8 | items between are removed whole | `'- ab\n- m1\n\n  m2\n- m3\n  - m4\n- cd\n\n  pq\n\n  rr\n- z'` | `ab`@1 → `pq`@1 | `'- aq\n\n  rr\n\n- z'` | red |
| CI9 | two texts taken, the range ends in the inner item's block | `'- ab\n- cd\n  - nn\n\n    pq\n\n    ss\n  - mm\n\n  rr\n- z'` | `ab`@1 → `pq`@1 | `'- aq\n\n  ss\n\n  - mm\n\n  rr\n\n- z'` | red |
| CI10 | one text taken, the range ends in the inner item's text | the same | `ab`@1 → `nn`@1 | `'- an\n\n  pq\n\n  ss\n\n  - mm\n\n  rr\n\n- z'` | red |
| CI11 | starts in a further paragraph of an item | `'- ab\n\n  st\n- cd\n\n  pq\n\n  rr\n- z'` | `st`@1 → `pq`@1 | `'- ab\n\n  sq\n\n  rr\n\n- z'` | red |
| CI12 | starts in an item nested in the item before | `'- t\n  - ab\n- cd\n\n  pq\n\n  rr\n- z'` | `ab`@1 → `pq`@1 | `'- t\n  - aq\n\n  rr\n\n- z'` | red |
| CI13 | the same, two texts taken: blocks keep their depth | `'- t\n  - ab\n- cd\n  - nn\n\n    pq\n\n    ss\n  - mm\n\n  rr\n- z'` | `ab`@1 → `pq`@1 | `'- t\n  - aq\n\n    ss\n\n  - mm\n\n  rr\n\n- z'` | red |
| CI14 | starts in a list of another marker | `'+ ab\n\n- cd\n\n  pq\n\n  rr\n- z'` | `ab`@1 → `pq`@1 | `'+ aq\n\n  rr\n\n- z'` | red |
| CI15 | starts in a paragraph before the list | `'ab\n\n- cd\n\n  pq\n\n  rr\n- z'` | `ab`@1 → `pq`@1 | `'aq\n\nrr\n\n- z'` | red |
| CI16 | starts in a heading before the list | `'# ab\n\n- cd\n\n  pq\n\n  rr\n- z'` | `ab`@1 → `pq`@1 | `'# aq\n\nrr\n\n- z'` | red |
| CI17 | starts in a code block before the list | `` '```\nab\n```\n\n- cd\n\n  pq\n\n  rr\n- z' `` | `ab`@1 → `pq`@1 | `` '```\naq\n```\n\nrr\n\n- z' `` | red |
| CI18 | starts in a raw block before the list | `'<div>\nab\n</div>\n\n- cd\n\n  pq\n\n  rr\n- z'` | `ab`@1 → `pq`@1 | `'<div>\naq\n\nrr\n\n- z'` | red |
| CI19 | ends in a heading | `'- ab\n- cd\n\n  ## pq\n\n  rr\n- z'` | `ab`@1 → `pq`@1 | `'- aq\n\n  rr\n\n- z'` | red |
| CI20 | ends in a quote | `'- ab\n- cd\n\n  > pq\n\n  rr\n- z'` | `ab`@1 → `pq`@1 | `'- aq\n\n  rr\n\n- z'` | red |
| CI21 | ends in a code block | `` '- ab\n- cd\n\n  ```\n  pq\n  ```\n\n  rr\n- z' `` | `ab`@1 → `pq`@1 | `'- aq\n\n  rr\n\n- z'` | red |
| CI22 | ends in a raw block | `'- ab\n- cd\n\n  <div>\n  pq\n  </div>\n\n  rr\n- z'` | `ab`@1 → `pq`@1 | `'- aq\\\n  \\</div>\n\n  rr\n\n- z'` | red |
| CI23 | ends in a `:::` block: it follows into the first item | `'- ab\n- cd\n\n  ::: {align=center}\n  pq\n  :::\n\n  rr\n- z'` | `ab`@1 → `pq`@1 | `'- a\n\n  ::: {align=center}\n  q\n  :::\n\n  rr\n\n- z'` | red |
| CI24 | ends in an item of a list inside such a block: that inner item stays | `'- ab\n- cd\n\n  ::: {align=center}\n  - ef\n\n    pq\n\n    rr\n  :::\n\n  tt\n- z'` | `ab`@1 → `pq`@1 | `'- a\n\n  ::: {align=center}\n  - q\n\n    rr\n  :::\n\n  tt\n\n- z'` | red |
| CI25 | task items | `'- [ ] ab\n- [x] cd\n\n  pq\n  - [ ] nn\n\n  rr\n- [ ] z'` | `ab`@1 → `pq`@1 | `'- [ ] aq\n  - [ ] nn\n\n  rr\n\n- [ ] z'` | red |
| CI26 | an ordered list is renumbered | `'1. ab\n2. cd\n\n   pq\n   1. nn\n\n   rr\n3. z'` | `ab`@1 → `pq`@1 | `'1. aq\n   1. nn\n\n   rr\n\n2. z'` | red |
| CI27 | an ordered list that starts at 5 | `'5. ab\n6. cd\n\n   pq\n\n   rr\n7. z'` | `ab`@1 → `pq`@1 | `'5. aq\n\n   rr\n\n6. z'` | red |
| CI28 | ends between the text and the first block (`selectToItem(['ab', 1], 'cd', 1)`, then `Backspace`) | `A` | → item `cd`, offset 1 | `'- a\n\n  pq\n\n  - nn\n\n  rr\n\n- z'` | red |
| CI29 | ends between the first block and the nested list (`selectToItem(['ab', 1], 'cd', 2)`, then `Backspace`) | `A` | → item `cd`, offset 2 | `'- a\n  - nn\n\n  rr\n\n- z'` | red |
| CI30 | the taken text holds nothing (first step: `Backspace` over `cd`@0 → `cd`@2) | `'- ab\n- cd\n\n  ## pq\n  - nn\n\n  rr\n- z'` | `ab`@1 → `pq`@1 | `'- aq\n  - nn\n\n  rr\n\n- z'` | red |
| CI31 | an item that opens with a nested list: the inner item's blocks become its own, by the join rule's first-item case | `'- ab\n- - cd\n\n    pq\n\n    rr\n- z'` | `ab`@1 → `pq`@1 | `'- aq\n- rr\n- z'` | red |
| CI39 | the blocks around the list are saved as they were written | `'Title\n=====\n\n* k\n* l\n\n- ab\n- cd\n\n  pq\n\n  rr\n- z\n\n~~~js\nlet  x\n~~~\n\n\| a   \|  b \|\n\|:----\|---:\|\n\| 1   \|  2 \|'` | `ab`@1 → `pq`@1 | `'Title\n=====\n\n* k\n* l\n\n- aq\n\n  rr\n\n- z\n\n~~~js\nlet  x\n~~~\n\n\| a   \|  b \|\n\|:----\|---:\|\n\| 1   \|  2 \|'` | red |

CI1 also pins `shape`: `'list(markdown-list-item(markdown-list-item-text("aq"), list(markdown-list-item(markdown-list-item-text("nn"))), paragraph("rr")), markdown-list-item(markdown-list-item-text("z")))'`.

**What stays.** One `Backspace` step each.

| # | What | `source` | Range | `saved` | Today |
|---|---|---|---|---|---|
| CI32 | ends in the item's text: the join rule (control) | `A` | `ab`@1 → `cd`@1 | `'- ad\n\n  pq\n\n  - nn\n\n  rr\n\n- z'` | green |
| CI33 | takes everything the item holds (control) | `A` | `ab`@1 → `rr`@2 | `'- a\n\n- z'` | green |
| CI34 | a nested first item keeps its nested list, in an item with no text | `'- ab\n  - cd\n\n    pq\n    - nn\n\n    rr\n  - e\n- z'` | `ab`@1 → `pq`@1 | `'- aq\n  - - nn\n\n    rr\n\n  - e\n- z'` | green |
| CI35 | the same for a list's first item after a paragraph | `'ab\n\n- cd\n\n  pq\n  - nn\n\n  rr\n- z'` | `ab`@1 → `pq`@1 | `'aq\n\n- - nn\n\n  rr\n\n- z'` | green |
| CI36 | starts in a table cell: nothing joins | `'\| h \|\n\| --- \|\n\| ab \|\n\n- cd\n\n  pq\n  - nn\n\n  rr\n- z'` | `ab`@1 → `pq`@1 | `'- q\n  - nn\n\n  rr\n\n- z'` | green |
| CI37 | starts in a `:::` column: nothing joins | `'::: {align=center}\nab\n:::\n\n- cd\n\n  pq\n  - nn\n\n  rr\n- z'` | `ab`@1 → `pq`@1 | `'::: {align=center}\na\n:::\n\n- q\n  - nn\n\n  rr\n\n- z'` | green |
| CI38 | an item that opens with a heading is not joined away | `'- ab\n- # cd\n\n  pq\n\n  rr\n- z'` | `ab`@1 → `pq`@1 | `'- aq\n\n- rr\n\n- z'` | green |
| CI66 | starts in the item it ends in: Lexical's own join | `A` | `cd`@1 → `pq`@1 | `'- ab\n\n- cq\n  - nn\n\n  rr\n\n- z'` | green |

In the tables of this section, `\|` stands for a `|` character; the source strings hold plain `|`.

**Routes.** Each row's first step selects the range and runs the route.

| # | Steps | `source` | `saved` | Today |
|---|---|---|---|---|
| CI40 | `type` `x`, `ab`@1 → `pq`@1 | `A` | `'- axq\n  - nn\n\n  rr\n\n- z'` | red |
| CI41 | `Enter`, `ab`@1 → `pq`@1 | `A` | `'- a\n\n- q\n  - nn\n\n  rr\n\n- z'` | red |
| CI42 | `Enter`, `ab`@1 → `pq`@2; then `type` `Q` | `A` | `'- a\n\n- Q\n  - nn\n\n  rr\n\n- z'` | red |
| CI43 | `Shift+Enter`, `ab`@1 → `pq`@1 | `A` | `'- a\\\n  q\n  - nn\n\n  rr\n\n- z'` | red |
| CI44 | `Shift+Enter`, `ab`@1 → `pq`@2: declined | `A` | `'- ab\n- cd\n\n  pq\n  - nn\n\n  rr\n- z'` | green |
| CI45 | `command` `editor.cut()`, `ab`@1 → `pq`@1 | `A` | `'- aq\n  - nn\n\n  rr\n\n- z'` | red |
| CI46 | `command` `editor.insertImage('/i.png', { alt: 'i' })`, `ab`@1 → `pq`@1 | `A` | `'- a![i](/i.png)q\n  - nn\n\n  rr\n\n- z'` | red |
| CI47 | `Enter`, `ab`@0 → `pq`@2; then `type` `Q` | `B` | `'- Qrr\n\n- z'` | red |
| CI48 | the same | `'- ab\n- cd\n\n  pq\n- z'` | `'Q\n\n- z'` | red |
| CI49 | the same | `A` | `'Q\n\n- - nn\n\n  rr\n\n- z'` | red |
| CI50 | `Backspace`, `ab`@0 → `pq`@2; then `type` `Q` | `B` | `'- Qrr\n\n- z'` | red |
| CI51 | the same | `A` | `'- Q\n  - nn\n\n  rr\n\n- z'` | red |

CI47 to CI49 are the three Enter rows of [Results that change](#results-that-change). CI50 is the existing rule that a paragraph after an emptied text becomes the item's text.

**The two cases agree.** One more `it.each` in the same `describe` states the decision itself. For each row it runs the range in one editor, and in a second editor it runs the two removals the decision equates, inside one update. The two editors must then give the same `getValue()` and the same `shapeOf`.

```typescript
it.each<[string, string, TextPoint, string, TextPoint]>([
    ['CI52: a paragraph, a nested list and a paragraph after the text', A, ['ab', 1], 'cd', ['pq', 1]],
    ['CI53: a paragraph after the text', B, ['ab', 1], 'cd', ['pq', 2]],
    ['CI54: a heading the range ends in', '- ab\n- cd\n\n  ## pq\n\n  rr\n- z', ['ab', 1], 'cd', ['pq', 1]],
    ['CI55: from a code block before the list', '```\nab\n```\n\n- cd\n\n  pq\n\n  rr\n- z', ['ab', 1], 'cd', ['pq', 1]],
    ['CI56: from a list of another marker', '+ ab\n\n- cd\n\n  pq\n\n  rr\n- z', ['ab', 1], 'cd', ['pq', 1]],
    ['CI57: from an item nested in the item before', '- t\n  - ab\n- cd\n\n  pq\n\n  rr\n- z', ['ab', 1], 'cd', ['pq', 1]],
    ['CI58: a nested first item', '- ab\n  - cd\n\n    pq\n    - nn\n\n    rr\n  - e\n- z', ['ab', 1], 'cd', ['pq', 1]],
    ['CI59: into a fence', '- ab\n- cd\n\n  ::: {align=center}\n  pq\n  :::\n\n  rr\n- z', ['ab', 1], 'cd', ['pq', 1]],
])('%s: one removal gives what removing up to the end of the item\'s text and then the rest gives', (_name, source, from, text, to) => {
    const direct = load(source);

    press(direct, { key: 'Backspace', at: from, to });

    const stepped = load(source);
    const lexical = lexicalOf(stepped);

    selectText(stepped, from, [text, text.length]);
    lexical.update(() => {
        lexical.dispatchCommand(DELETE_CHARACTER_COMMAND, false);

        const selection = $getSelection();
        const isRange = $isRangeSelection(selection);

        // The first removal left a caret at the range's start: the rest runs from there to the range's end.
        if (isRange) {
            selection.focus.set($textNode(to[0]).getKey(), to[1], 'text');
        }

        lexical.dispatchCommand(DELETE_CHARACTER_COMMAND, false);
    }, { discrete: true });

    expect(direct.getValue()).toBe(stepped.getValue());
    expect(shapeOf(direct)).toBe(shapeOf(stepped));
});
```

All of CI52 to CI59 are red today except CI58, which is green: it is the case that stays.

### Rows in `markdown-editor-list-item-paste.test.ts`

One new `describe`, placed last: `a paste over a range that takes a list item's text whole goes in at the caret its removal leaves (CI rows)`. It uses the file's `load`, `selectText`, `copyOf`, `pasteNodes`, `expectSaveKeepsDocument` and `expectUndoRestores`. It needs a `pasteText` like the one local to the `describe` at [:660](../packages/lib/tests/component/markdown-editor-list-item-paste.test.ts#L660): move that helper to module level, unchanged, and use it from both places. `A` and `B` are the two documents above.

Two clipboards are local to the new `describe`:

```typescript
const ITEMS: Clipboard = { name: 'list', source: '- k\n- m\n\nzz', from: ['k', 0], to: ['m', 1], types: ['list'] };
const WORD: Clipboard = { name: 'bold word', source: 'x **zp** y', from: ['zp', 0], to: ['zp', 2], types: ['text'] };
```

Each row selects `ab`@1 → `pq`@1, pastes, and asserts `expectSaveKeepsDocument(editor)` equals `saved` and `expectUndoRestores(editor, load(source).getValue())`.

| # | Pasted | `source` | `saved` | Today |
|---|---|---|---|---|
| CI60 | `PARAGRAPHS` | `A` | `'- aP1\n\nP2q\n\n- - nn\n\n  rr\n\n- z'` | green |
| CI61 | `PARAGRAPHS` | `B` | `'- aP1\n\nP2q\n\nrr\n\n- z'` | red |
| CI62 | `ITEMS` | `A` | `'- a\n\n- k\n\n- mq\n  - nn\n\n  rr\n\n- z'` | red |
| CI63 | `WORD` | `A` | `'- a**zp**q\n  - nn\n\n  rr\n\n- z'` | red |
| CI64 | the text `zc` (`pasteText`) | `A` | `'- azcq\n  - nn\n\n  rr\n\n- z'` | red |
| CI65 | the text `T1\nT2` (`pasteText`) | `A` | `'- aT1\n\n- T2q\n  - nn\n\n  rr\n\n- z'` | red |

CI60 is green and stays: blocks pasted at an item's text split the list there and what the item holds follows in an item of its own, which is the paste rule row E9 pins. CI61 shows the same paste rule after the join: `rr` leaves the list with the pasted blocks.

### Rows in `markdown-editor-command-crashes.test.ts`

One new `describe`, placed before the `upstream canaries` one: `a range that takes a list item's text whole is removed the same way on every route (CI rows)`. The rows follow rows R1 to R15 of that file ([:375](../packages/lib/tests/component/markdown-editor-command-crashes.test.ts#L375)) in form: one `it` each, `load`, `selectText`, the route, `expect(editor.getValue())`. `A` and `B` are the two documents above; the range is `ab`@1 → `pq`@1 unless the row says otherwise. Add the imports the rows need and the file lacks: `DELETE_WORD_COMMAND`, `INSERT_TAB_COMMAND`, `REMOVE_TEXT_COMMAND` and `UNDO_COMMAND` from `lexical`, and `$insertGeneratedNodes` from `@lexical/clipboard`.

| # | Route | Document | Expect | Today |
|---|---|---|---|---|
| CI70 | `await editor.paste()` with `DOM.source.readClipboardText` mocked to `'zc'` (as R8) | `A` | `'- azcq\n  - nn\n\n  rr\n\n- z'` | red |
| CI71 | `CUT_COMMAND` `null`, then `await vi.waitFor(…)` (as R9) | `A` | `'- aq\n  - nn\n\n  rr\n\n- z'`, and `copyToClipboard` called once | red |
| CI72 | `INSERT_TAB_COMMAND` | `A` | `'- a\tq\n  - nn\n\n  rr\n\n- z'` | red |
| CI73 | `DELETE_WORD_COMMAND` `false` | `A` | `'- aq\n  - nn\n\n  rr\n\n- z'` | red |
| CI74 | `REMOVE_TEXT_COMMAND` `null` | `A` | `'- aq\n  - nn\n\n  rr\n\n- z'` | red |
| CI75 | `CONTROLLED_TEXT_INSERTION_COMMAND` `'x'` over a range that starts in bold text | `'- **ab**\n- cd\n\n  pq\n\n  rr\n- z'` | `'- **ax**q\n\n  rr\n\n- z'` | red |
| CI76 | `CONTROLLED_TEXT_INSERTION_COMMAND` `'x'` dispatched inside one `lexical.update(…, { discrete: true })`, `ab`@0 → `pq`@2 | `B` | `'- x\n\n  rr\n\n- z'` | red |
| CI77 | `DELETE_CHARACTER_COMMAND` `false` dispatched inside one update, then one `UNDO_COMMAND` | `A` | after the delete `'- aq\n  - nn\n\n  rr\n\n- z'`; after the undo `load(A).getValue()` | red |
| CI78 | `editor.cut()`; a second editor with the same selection runs `editor.copy()` | `A` | both write the same text through `DOM.sink.writeClipboardText` (spy on it) | green |
| CI79 | `$insertGeneratedNodes(lexical, [], $getSelection()!)` in a discrete update: a paste that brings no node | `A` | `getValue()` is `load(A).getValue()` and `rangeOf(editor)` is `'"ab"@1 -> "pq"@1'` | green |
| CI80 | `INSERT_LINE_BREAK_COMMAND` `false` over `ab`@1 → `pq`@1 of a document whose later item holds a table | `'- ab\n- cd\n\n  \| h \|\n  \| --- \|\n  \| pq \|\n\n  rr\n- z'` | `getValue()` is the loaded document's and `rangeOf(editor)` is `'"ab"@1 -> "pq"@1'` | green |

CI72 is here and not among the `Row`s because `runRow` also compares the save with its standard form, which writes a tab as a space. CI75 is the rule row R5 pins for the stale-focus range: text typed over a range takes the format of the range's first text node.

### Rows in `markdown-editor-table-edge.test.ts`

All three are rows of the `it.each` at [:680](../packages/lib/tests/component/markdown-editor-table-edge.test.ts#L680), which runs each range with Backspace and with Delete and checks the caret and the viewer.

| # | Change | Row |
|---|---|---|
| D32 | restated, red until the change; rename it `D32: into a table that ends a list item, from the text of the item before: the item is joined away with its text` | `saved` becomes `'[d]: /first\n\n- w\n\n- * n6\n\n    p7\n\n# g12'`; the caret stays `'"w"@1'` |
| D37 | new, red today | `['D37: into a table of a list item that holds more, from the text of the item before: what is left follows into that item', '- ab\n- cd\n\n  \| h \|\n  \| --- \|\n  \| pq \|\n\n  rr\n- z', ['ab', 1], ['pq', 1], '- a\n\n  rr\n\n- z', '"a"@1']` |
| D38 | new, green today | `['D38: from a table into a later block of a list item: nothing joins, and the item keeps what is left', '\| h \|\n\| --- \|\n\| ab \|\n\n- cd\n\n  pq\n  - nn\n\n  rr\n- z', ['ab', 1], ['pq', 1], '- q\n  - nn\n\n  rr\n\n- z', '"q"@0']` |

Correct the comment above that `it.each` ([:677](../packages/lib/tests/component/markdown-editor-table-edge.test.ts#L677)): an item whose every block the range covers stays, emptied, unless the range also takes the item's text whole from a block that text would join, as in D32.

### Manual (browser) checks

Run `npm run dev` at the repo root and open **MD Editor**. Replace the content with document `A`: a list of three items, the second holding a paragraph `pq`, a nested item `nn` and a paragraph `rr`.

| # | Steps | Expected |
|---|---|---|
| B1 | Drag from between `a` and `b` to between `p` and `q`. Press Backspace | one item `aq` holding the nested item `nn` and the paragraph `rr`; then the item `z`. No bullet without text |
| B2 | Ctrl/Cmd+Z once | the document and the selection are back |
| B3 | The same drag made backward (from `p│q` up to `a│b`), then Delete | as B1 |
| B4 | The same drag, then type `x`; undo; Enter; undo; Tab; undo; Ctrl/Cmd+X, then Ctrl/Cmd+V at the end of `z`; undo twice | each as the route table gives; one undo restores each |
| B5 | The same drag, then Shift+Enter | `a`, a line break, `q` in one item, the nested item and `rr` under it |
| B6 | Drag from `a│b` to the end of `pq`, then Shift+Enter | nothing changes; the selection stays |
| B7 | The same drag as B1, then Ctrl+Backspace (Alt+Backspace on macOS), and Cmd+Backspace on macOS (`DELETE_LINE_COMMAND`, which cannot run offline) | as B1 |
| B8 | The same drag, then start an IME composition and commit it | the composed text stands between `a` and `q`; the blocks follow in that item; no console error |
| B9 | Drag the highlighted selection of B1 onto the end of `z` | the selection is removed as in B1; the dragged content lands at the drop point |
| B10 | In source mode set the content to a list whose second item holds a table and then a paragraph `rr` (`- ab`, `- cd`, the table and `rr` indented two spaces, `- z`), and switch back. Click at the end of the table's last cell, press ArrowRight, then Shift+ArrowUp until the selection reaches into `ab`. Press Backspace. If the keys give no such selection, record that and skip the row | the second item is gone and `rr` follows in the first item; no console error |

---

## Verification

- `npm run typecheck` and `npm -w packages/lib run typecheck:test` (repo root).
- `npm run lint` (repo root): zero errors.
- From `packages/lib`: `npx vitest run tests/component/markdown-editor-list-item-edits.test.ts tests/component/markdown-editor-list-item-paste.test.ts tests/component/markdown-editor-command-crashes.test.ts tests/component/markdown-editor-table-edge.test.ts`: every row passes.
- `npm test` (repo root): the full suite is green. No existing row other than D32 is expected to change.[^existing-rows]
- `npm run docs:api` (repo root): zero warnings.
- The greps of steps 1 and 8.
- The manual checks B1 to B10.
- **The differential check against the parent.** It runs the same scenarios through every route on the parent and on the branch, and lists every cell that differs. The harness is outside the repo, in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/cross-item-range/` (`$S` below). It copies its test files into a worktree, runs them and removes them again; never commit them.
  1. Make a worktree of the commit the branch starts from, with `node_modules` and `packages/lib/node_modules` symlinked to the main tree's.
  2. `CIR_LIB=<parent worktree>/packages/lib $S/rungrid.sh scenarios-grid.json grid-parent-now` and the same with `scenarios-hand.json hand-parent-now`.
  3. `CIR_LIB=<branch worktree>/packages/lib $S/rungrid.sh scenarios-grid.json grid-branch` and the same with `scenarios-hand.json hand-branch`. Do not pass `proto`.
  4. `python3 $S/diff.py $S/grid-parent-now.json $S/grid-branch.json $S/grid-proto.json` and `python3 $S/diff.py $S/hand-parent-now.json $S/hand-branch.json $S/hand-proto.json`.

  Each run must end with `hard checks failed: none`. The hard checks are: a range that is not a cross-item range gives the same save on parent and branch; nothing throws; no cell fails a reload, save-again or viewer check the parent passes; one undo restores every cell it restores on the parent; `cut()` gives Delete's save; and Backspace, Delete, a word delete and `REMOVE_TEXT_COMMAND` give the save this plan measured. `diff.py` also lists the cells of the other routes that differ from this plan's measurement. Read each one and record it in the *Implementation Notes*.[^diff-read]

---

## Documentation Impact

No public API changes. Two text edits.

**`packages/lib/docs/components/MarkdownEditor.md`**, the **Lists** bullet (line 95). After the sentence that ends "for a list's first item, the blocks up to its first nested list follow the text out of the list.", insert:

> A range that takes an item's text whole and ends in a later block of that item — a further paragraph, a heading, a quote, a code block, a table, a `:::` block or a nested item — follows the same rule, whichever edit removes it: the item goes, and what the range leaves of it follows into the item before, so no bullet is left without its text line; an item nested in it whose text the range takes too is joined away the same way. Where nothing would join the item's text — the range starts in a table cell, in a `:::` column the list is not in, or between two blocks — the item stays and keeps what is left.

**`packages/lib/docs/reference/changelog/next.md`** → `## Fixed` → `### Components`, appended:

```markdown
- **`MarkdownEditor` joins a list item away when a selection takes its
  text whole.** A selection from one item's text into a later block of
  another item — its second paragraph, a heading, a table, a nested item —
  removed that item's text and left the rest in a bullet with no text line
  (`- ab`, `- cd` holding `pq` and a nested item, deleted from `a│b` to
  `p│q`, gave `- aq` and `- - nn`). The same selection ending in the item's
  own text moved the rest into the item before. The two now agree, on every
  edit that removes or replaces the selection: the item goes and what is
  left of it follows into the item before, as when its text is joined. An
  item nested in it whose text the selection takes too is joined away the
  same way. Enter over such a selection now acts at the caret its removal
  leaves, as Enter after Delete does. A selection that starts in a table
  cell, in a `:::` column the list is not in, or between two blocks joins
  nothing and leaves the item as before. No consumer action is needed.
```

---

## Potential Challenges

- **The dependency's names.** Step 1 checks them. Do not implement this plan on a tree where `DELETE_CHARACTER_COMMAND` still has listeners of its own for the table-edge and stale-focus shapes: Delete would then miss the new shape.
- **Pass the editor's own selection.** `$removeJoiningRange` can move the editor's selection (`$deleteRangeFromTextOnlyBlock` calls `selectEnd()`), and `$joinCoveredItemTexts` goes on with the same object. Every caller of `$removeGuardedRange` passes `$getSelection()` or the payload's selection, which is the same object. Do not pass a clone.
- **Compute `endCaret` before the first step, and nothing else from the old points after it.** A step can remove the list item a point is on. Read `start` and `end` once, as the snippet does.
- **No call in an `if` condition.** The snippets assign each call to a named const first. TypeScript still narrows `text` through `isEnteredItemText` and `isJoinedAway`; the snippets were type-checked as printed.
- **Do not run a rule between the steps.** The steps and the last removal are one update. A row that passes only when a command is dispatched outside an update means some step waits for the end of the update. Fix the code, not the row.
- **CI76 against typing dispatched outside an update.** After the removal an emptied text over a paragraph is dropped when the update ends, and that paragraph becomes the item's text. Typing dispatched outside an update runs after that rule and types into `rr` (`- xrr`). A browser types inside the update, which CI76 pins. This is the dependency's class "rules that run when an update ends", not a defect of this plan.
- **CI75 was not measured.** The prototype removes the range through `DELETE_CHARACTER_COMMAND`, which does not carry the typed text's format. The dependency's `$removeGuardedRangeBeforeText` does, for every guarded range. If CI75 fails, check that the typing listener tests `$isGuardedRange`.
- **Worktree `node_modules`.** A fresh worktree needs `node_modules` and `packages/lib/node_modules` symlinked to the main tree's. Never run a plain `npm install`.
- **`DELETE_LINE_COMMAND` cannot run offline** (Lexical needs a `window`). B7 covers it.

---

## Critical Files

- [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts): `registerRangeGuards` (L3508) and `$removeGuardedRange` (L2071), the precedent this plan extends; `$isTableEdgeRange` (L1636) and `$isStaleFocusRange` (L1434), the existing shape predicates; `$removeRangeKeepingEndBlock` (L1912), the existing removal made of two removals; `$removalJoinsEndBlockRest` (L1519); `$guardedRemovalDeclinesLineBreak` (L2282) and `$clearGuardedRangeBeforeLineBreak` (L2304); `$deleteRangeFromTextOnlyBlock` (L2533); `$removeGuardedRangeForInsert` (L1880); `$enterLeavesListAtBlankItemText` (L3262), which decides the Enter rows; `cut()` (L5781), `paste()` (L5823), `insertImage()` (L6171).
- [markdownListItemNode.ts](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts): `MarkdownListItemTextNode.remove` (L541) and `$moveRestBeforeItem` (L629), the join rule. Read, not changed.
- [markdown-editor-raw-block-range-edits.md](markdown-editor-raw-block-range-edits.md) (in `plans/implemented/` by the time this plan starts): its *Internal Structure* defines `$isGuardedRange`, `$removeGuardedRange` and `$removeJoiningRange` as this plan edits them.
- [plans/implemented/markdown-editor-list-item-node.md](implemented/markdown-editor-list-item-node.md): the node model, the join rule (the row "A join that takes an item's text away" of its edit table), and under *Reviews* the note "For the user to decide" that this plan answers.
- [markdown-editor-list-item-edits.test.ts](../packages/lib/tests/component/markdown-editor-list-item-edits.test.ts): `Row`, `press`, `runRow`, `shapeOf` and the row style; rows V8 (L1478), K14 (L765), Z9, Z10, V4.
- [markdown-editor-table-edge.test.ts](../packages/lib/tests/component/markdown-editor-table-edge.test.ts): rows D31 to D36 (L680).
- `node_modules/lexical/dist/Lexical.dev.mjs` L19387–19532 (`$removeTextFromCaretRange`): L19426 removes a covered node without calling its `remove`; L19498 calls `remove` on the block the range ends in.

---

## Non-Goals

- **Changing the join rule.** A list's first item that is joined away keeps its nested list and what follows in an item with no text (rows CI34, CI35, V8, K14). A range now gives what the join gives. Whether the join itself should give something else there is a separate decision; it would be made in `$moveRestBeforeItem` and would change V8 and K14.
- **Items that open with a block other than text.** A join that takes such a block away leaves the item's other blocks in the item, for a key and for a range alike, as the list-item-node notes record.
- **Ranges that start where nothing joins**: in a table cell, in a `:::` column the list is not in, or between two blocks.
- **Collapsed joins.** Delete at a block's end and Backspace at a block's start are not ranges and already follow the join rule.
- **`insertTable()` over a range.** It removes only a table-edge range.
- **The paste rules.** What a paste does at the caret the removal leaves is unchanged, the split of the list around blocks pasted at an item's text included.
- **Source mode and `CodeEditor`.** The rule is about Lexical's node tree. Source mode edits Markdown text and is not touched, and `CodeEditor` gets no Markdown-specific code.
- **Markdown syntax.** Nothing the viewer or the importer reads changes.
- **Committing the probe.** The differential harness stays outside the repo.

---

## Addendum: Measurements

All measured at `b154a9b3a`, with no source file changed. The prototype is a listener put first in each command's `COMMAND_PRIORITY_CRITICAL` set from a vitest setup file. It runs `$joinCoveredItemTexts` as this plan prints it, with one substitution: each step, and the last removal, is a `DELETE_CHARACTER_COMMAND` dispatched inline, which is what removes a range "as Delete does" before the dependency gives that a function. `$removalJoinsEndBlockRest` is a copy taking nodes. For `cut()`, `paste()` and `insertImage()`, which call `$removeGuardedRange` directly, the steps run in an update just before the method. The files are in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/cross-item-range/`: `zz-cir-proto.ts`, `zz-cir-probe.test.ts`, `rungrid.sh`, `diff.py`, the scenario generators `gen-grid.py` and `gen-hand.py`, and the results `grid-parent.json`, `grid-proto.json`, `hand-parent.json` and `hand-proto.json`.

**The grid**: 11 kinds of start × 8 kinds of end block × 3 remainders × 3 end offsets = 792 scenarios, each in both drag directions through 17 routes (Backspace and typing, Enter and Shift+Enter in both dispatch contexts, a word delete, `REMOVE_TEXT_COMMAND`, `INSERT_PARAGRAPH_COMMAND`, Tab, `cut()`, `paste()`, pasted nodes, pasted blocks, `insertImage()`).

| | Parent | Prototype |
|---|---|---|
| cells | 26,928 | 26,928 |
| cells whose range is a cross-item range | 22,032 | 22,032 |
| of those, cells whose save changes | — | 11,786 |
| cells whose range is not one, and whose save changes | — | 0 |
| throws | 0 | 0 |
| cells that fail a reload, save-again or viewer check | 18 | the same 18 |
| cells one undo does not restore (command routes) | 0 | 0 |
| results that depend on the drag direction | 282 | 24 |

The 18 failing cells are a range that starts in a table and ends in a code block of an item, with Tab: a tab in a code block of a list item is saved as a tab and loaded as four spaces, which the list-item-node notes record. They are not cross-item ranges. The 24 direction-dependent results that remain all start in a `:::` column, which this plan leaves alone.

**The hand-written scenarios** (74, the same routes): 2,516 cells, 1,904 with a cross-item range, 1,514 changed, none changed outside them, no throw, no failed check.

**Existing tests with the prototype on every editor**: the 19 Markdown test files under `tests/component/` (the round-trip folder included), 6,766 tests. One fails: D32, with the value [Results that change](#results-that-change) gives.

**The snippets** of *Internal Structure* were type-checked as printed under `tsconfig.test.json`, with `$removalJoinsEndBlockRest` and `$removeJoiningRange` declared.

**The rows.** CI1 to CI51, CI39 and CI66 were run through the edits file's own `press` and `runRow` checks, CI52 to CI59 as printed, and CI60 to CI65 through the paste file's own helpers, on the parent and with the prototype. Every *red* row fails on the parent and passes with the prototype; every *green* row passes on both. CI75 was not measured (see *Potential Challenges*). CI71 was measured for this range, which is also a stale-focus range; a native cut of a cross-item range that is not one cannot run offline before the change.

---

## Notes

[^cause]: Lexical's range removal (`$removeTextFromCaretRange`, 0.49.0) takes
    every node the range covers whole out of its parent directly, without
    calling the node's `remove` (`Lexical.dev.mjs` L19426). It calls `remove`
    on one node only: the block the range ends in, after moving that block's
    rest onto the start's block (L19498). The join rule lives in the `remove`
    of an item's text. So it runs when the range ends in the text, and not
    when the range ends in a later block, where the text is one of the
    covered nodes. The list-item-node notes record this under "For the user
    to decide: a range that ends in a later block of another item".

[^stepwise]: Three ways to make the two cases agree were weighed.
    (1) *Steps*, as chosen. The first removal of each step is exactly the
    range the join rule already handles, so the move is made by the code
    that makes it today and cannot drift from it. The result is the document
    a user gets by deleting to the end of the item's first line and then
    deleting the rest, which is the decision stated as a test (CI52 to
    CI59).
    (2) *One removal, then move what each affected item still holds.* It
    needs a second caller of the move, and it joins nested items away from
    the inside out, because Lexical's own call for an inner item's text runs
    during the removal. For a range that starts in an item nested in the
    item before and takes two texts, that puts the inner item's blocks one
    level too far out (CI13 would give `- t⏎  - aq⏎⏎  ss⏎…`). Rejected.
    (3) *A node transform on the item.* A transform sees an item without a
    text but cannot tell an item a range left that way from an item loaded
    that way (`- - n`), and it runs after the route's insert. Rejected.
    The steps and the last removal run inside one update, so no rule that
    runs when an update ends sits between them.

[^fourth-shape]: The guards exist so that every command that removes or
    replaces a range removes certain shapes itself, the same way on every
    route. A cross-item range is such a shape: Lexical's own removal gives
    the wrong document for it on every route (measured: all 17 routes leave
    the text-less item today). Putting the steps anywhere else — in the
    Backspace handler alone, say — would repeat the history of the
    raw-block join, which was right for Delete, Backspace and Enter and wrong
    on every other route. `$isCrossItemRange` walks the ancestors of the range's end and
    returns at once for a collapsed selection, so typing at a caret pays
    nothing.

[^join-condition]: The join rule's hook runs whenever Lexical removes an
    item's text at the end of a range, also when no text was joined: Lexical
    removes an emptied end block even across a `:::` column's edge. Without
    the condition, a range from a column into a later block of an item would
    first send the item's blocks out of the list and then, joining nothing,
    leave the rest of the end's block as a paragraph of its own. Measured:
    `::: {align=center}⏎ab⏎:::⏎⏎- cd⏎⏎  pq⏎  - nn⏎⏎  rr⏎- z`,
    `"ab"`@1 → `"pq"`@1, gives `- q⏎  - nn…` today and would give
    `q⏎⏎- - nn…` without the condition: a text-less item where there was
    none. So the item is joined away only where its text would be joined.
    The texts that pass the condition are always the outermost ones of the
    range: a shadow root on the start's side fails all of them, and one on
    the end's side fails every text below it.

[^caret]: A point of a selection is a node key and an offset. When the range
    ends between two blocks of a list item, that key is the item's, and the
    item is removed once its text is joined away. A caret names the place by
    a neighbouring node instead: the block after the point, which no step
    removes, or else the block before it, which only the last removal
    removes. The one case with neither is a range that ends right after the
    text of an item holding nothing else; the step for that item removes the
    whole range, which `isEndLeft` detects.

[^enter]: Before this plan a cross-item range that is not also a stale-focus
    range reached `$enterLeavesListAtBlankItemText` as a range. That
    listener removes it and then applies its empty-line rule only "where
    blocks are in play", which it tells from whether the start's text held
    blocks before or after the removal. Lexical's removal left the later
    item's blocks in that item, so the listener saw none and left the split
    to Lexical. Now the guard removes the range first and the blocks are
    under the start's text, so the listener sees the caret on an empty line
    that holds blocks and applies its rule. The results are those of Delete
    followed by Enter, which is the contract every guarded range has. Only a
    range that leaves the start's text blank is affected: one that starts at
    the very start of the text.

[^order]: Three reasons. (1) Today `DELETE_CHARACTER_COMMAND` has three
    range listeners of its own and typing, the plain-text paste and the cut
    each test the shapes in their own line. The rule would have to be added
    at each, and the removal "as Delete does" that a step needs exists only
    as `$removeRangeBeforeEnter`. The dependency reduces all of this to
    `$isGuardedRange` and `$removeJoiningRange`. (2) The dependency replaces
    the bodies of `$removeGuardedRange`, the typing listener, the paste
    listener and the delete registration. Implemented second, followed as
    written, it would write this plan's lines away. (3) A cross-item range
    that starts in a raw block or a code block needs the text-only join on
    every route to give one result; that is the dependency's own subject.

[^first-item]: The join rule sends a first item's blocks up to its first
    nested list out before the list, and keeps the nested list and what
    follows in the item, so those keep their depth. `$liftItemOut` follows
    the same convention. For a range that ends in the item's text this is
    pinned (V8: `p⏎⏎- a⏎⏎  b⏎  - n⏎⏎  c⏎- z` gives
    `pa⏎⏎b⏎⏎- - n⏎⏎  c⏎⏎- z`; K14). The user's decision is that a range
    ending in a later block must give what the range ending in the text
    gives, and after this plan it does, here too (CI34, CI58). The decision
    also says no item is to be left without text "for this reason"; the
    reason was the text being removed unseen, which no longer happens. An
    item left without text by the join rule itself is the other, earlier
    rule. Changing that rule would move a nested list one level out and
    would change what Backspace and Delete do at a collapsed caret, so it
    is not folded into this plan.

[^opening-block]: The list-item-node notes record, under *Seen along the
    way*, that a join which takes away the heading a list's first item opens
    with leaves the item's other blocks in the list
    (`p⏎⏎- # h⏎⏎  q`, Delete at `p`'s end, gives `ph⏎⏎- q`). A range that
    covers such an opening block whole behaves the same today. Making only
    the range join the item away would make a one-character selection
    differ from the Delete key at the same place. Both would have to change
    together, in a rule about the block that opens an item, whatever its
    kind.

[^no-join]: With a start in a table cell the range is a table-edge range.
    That removal's contract, pinned by rows D18, D20 and D34, is that it
    joins nothing and leaves the block on the table's far side as it was.
    With a start in a `:::` column Lexical joins nothing across the column's
    edge. In both, what is left of the end's block stays a block of the
    later item, and when it is a paragraph it becomes that item's text
    (CI36, CI37), so the item keeps a bullet that has something to show.

[^d32]: D32 was added by `markdown-editor-list-item-node` for a throw the
    list-edit fuzz found, and pins that the item "stays, emptied". Its range
    runs from the text of the item before into a table that is the later
    item's last block, so it takes the later item's text whole. For the same
    range ending in that text the join rule moves the table into the item
    before; the range ending in the table must then leave what removing that
    table leaves, which is the item before alone. The table-edge contract
    holds as before: the whole table goes and no text is joined. Rows D31,
    D33 and D35 keep their emptied item: there the later item opens with the
    table and has no text to take. D34 starts in a table and is unchanged.

[^existing-rows]: Measured with the prototype installed on every editor:
    6,765 of the 6,766 tests of the Markdown test files pass, and the one
    that fails is D32. The prototype's cover of `cut()`, `paste()` and
    `insertImage()` runs the steps in an update of their own, so a row over
    those three methods is not fully measured. If one fails, check its
    selection: only a row whose selection is a cross-item range may change,
    and its new value must be Delete's result with the method's insert at
    the caret.

[^diff-read]: Two kinds of cell are expected in that list, and both are the
    prototype's limits, not the branch's. For `cut()`, `paste()` and
    `insertImage()` the prototype ran the steps in an update before the
    method, so a rule that runs when an update ends could change the tree
    between the steps and the last removal; the branch does both in one
    update, and must give Delete's save (which `diff.py` checks for `cut()`)
    with the method's insert at the caret. And the prototype's last removal
    does not carry the typed text's format, which shows only where a range
    starts in formatted text; no scenario does. The parent's results must be
    recorded anew in step 2, because the dependency changes what several
    routes give for a range that starts in a raw block or a code block; the
    stored `grid-parent.json` predates it.
