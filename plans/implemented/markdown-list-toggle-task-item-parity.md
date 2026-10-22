---
depends-on: [markdown-editor-list-item-node, markdown-editor-paste-undo-merge]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-editor-list-item-edits.test.ts
  - packages/lib/tests/component/markdown-list-item-node.test.ts
  - packages/lib/tests/component/markdown-source-edits.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor List Toggle and Task Item Parity — Implementation Plan

## Overview

`MarkdownEditor` has two editing surfaces: WYSIWYG (Lexical) and source mode
(the raw Markdown text). `toggleUnorderedList()` and `toggleOrderedList()`
turn the selected blocks into a list, or take them out of one, on both.
Today the two surfaces disagree. On a task item (`- [ ] todo`) source mode
does nothing while the WYSIWYG surface converts it. A numbered toggle in a
bulleted list converts the whole list on the WYSIWYG surface and one item in
source mode. And when a list item that holds blocks — a paragraph, a quote, a
table — leaves its list, the WYSIWYG surface takes those blocks out with it
while source mode leaves them in the list.

This plan sets one contract for the two toggles, the same on both surfaces,
and changes each surface where it breaks the contract.

- **WYSIWYG.** The toggles stop using Lexical's list insert. They work on the
  editor's own list items through the item operations of
  [markdownListItemNode.ts](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts).
  The change is in
  [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts),
  with one new item operation in `markdownListItemNode.ts`.
- **Source mode.** A task item's marker travels with its item's text, new
  items join the list next to them, and what a list item holds after a lifted
  block leaves the list with the block. The change is in
  [markdownSourceLines.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts).
- **`setBlockType`** shares the source-mode code and gets the same source-mode
  changes. On the WYSIWYG surface its one change is how a task marker is
  written into a code block (one line of
  [markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts)).

The tests are rows in four existing test files. There is no new test file.

The plan is written against `85b55a8f4`, the tip of
`feature/markdown-editor-paste-undo-merge`. Line numbers are from that
commit, so find each site by its symbol name first. Every result in this plan
was measured there, with the plan's changes run as a prototype.[^prototype]

---

## Revised on 2026-10-11

The plan of 2026-10-06 was written against a commit six branches below the
tip. What changed, and why:

| Change | Why |
|---|---|
| The WYSIWYG half is rewritten. `$itemOfText`, `$isolateItemText`, `$moveToItemAfter`, `$liftOutOfLists`, `$itemizeBlock`, `$makeListItems` and `$isolateTouchedItemTexts` are gone, and so are the changes to `$selectedBlocksHaveType` and to `setBlockType`'s update | They were written for Lexical's `ListItemNode`. A list item is now a `MarkdownListItemNode` that holds blocks only, its text a `MarkdownListItemTextNode`. The new code calls `$liftItemOut`, which already does what the old helpers did by hand |
| Rule 2 is reversed for the blocks an item holds after its text: they leave the list with the text, up to the item's first nested list. Before, they stayed in the list as an item | The code at the tip does this on the WYSIWYG surface, in pinned rows the user accepted[^blocks-follow] |
| Source mode gets a new lift rule for list items, in `liftLines` | It follows from the reversed rule 2: source mode kept an item's later blocks in the list |
| The plan no longer fixes a text-merging bug | The bug is gone at the tip[^merge-gone] |
| Source mode joins new items run by run, and also inside the list around them | Two shapes the old matrix did not hold read differently on the two surfaces (rows `X9`, `X11`)[^source-runs] |
| The tests are rows in existing table-driven files. The parity matrix grew from 94 to 182 rows, the list of intended differences from 14 to 26 | The project rule for tests; and items that hold blocks needed rows |
| Rows `H4`, `H5` and `H6`, pinned by the list item node branch, are restated | They pin the two behaviours this plan's contract ends: a toggle that changes nothing, and a toggle that converts a whole list[^h-rows] |
| Frontmatter: `depends-on` names the list item node branch and the tip; `touches-shared` gains the node module and two test files | The plan now needs the node model, and adds rows where its tests live |

The contract's other rules are unchanged: the task marker (rule 5), a toggle
of the other kind changing the touched items only, a converted block landing
at the top level, and joining.

## Narrowed on 2026-10-11

One part of this plan is not on its branch: the source-mode lift rule, that
is, rule 2 as reversed above applied in source mode ("Source mode gets a
new lift rule for list items, in `liftLines`"). It was implemented, went
through five reviews, did not converge, and was deferred to a plan of its
own. Everything else below is implemented as written, with the deviations
the *Implementation Notes* list. Where this plan's text says that source
mode takes what an item holds out of the list with its text, read: the
WYSIWYG surface does, and source mode leaves it in the list as before, a
difference that `DIFFERS` rows pin and the docs state. The notes' last
section, *For the follow-up plan (source-mode lift rule)*, says where the
deferred work is kept and what was learned from it.

---

## What the two surfaces do today

Measured at `85b55a8f4`. Lines of a document are separated by ` ⏎ ` here; a
blank line shows as `⏎⏎`.

| # | Document | Selection, command | WYSIWYG | Source mode |
|---|---|---|---|---|
| 1 | `- [ ] one ⏎ - [x] two` | caret in `one`, bulleted | `\[ \] one`, then the list `- [x] two` | does nothing |
| 2 | same | caret in `one`, numbered | the whole list: `1. [ ] one ⏎ 2. [x] two` | does nothing |
| 3 | same | caret in `one`, `setBlockType("h2")` | `## \[ \] one` | does nothing |
| 4 | same | caret in `one`, `setBlockType("code")` | a code block holding `\[ \] one` | does nothing |
| 5 | `- one ⏎ - two ⏎ - three` | caret in `two`, numbered | the whole list numbered | `- one ⏎ 1. two ⏎ - three` |
| 6 | `- one ⏎   - inner ⏎ - three` | caret in `inner`, numbered | the nested list numbered, in place | `- one ⏎ 1. inner ⏎ - three` |
| 7 | `- one ⏎ - two ⏎⏎ three` | caret in `three`, bulleted | `- one ⏎ - two ⏎ - three` | `- one ⏎ - two ⏎⏎ - three`, a loose list |
| 8 | `- one ⏎⏎   second ⏎⏎ - two` | caret in `one`, bulleted | `one ⏎⏎ second ⏎⏎ - two` | `one ⏎⏎ - second ⏎⏎ - two` |
| 9 | same | caret in `one`, numbered | the whole list: `1. one ⏎⏎    second ⏎⏎ 2. two` | `1. one ⏎⏎ - second ⏎⏎ - two` |
| 10 | same | caret in `second`, bulleted | nothing changes | `- one ⏎⏎ - second ⏎⏎ - two` |
| 11 | `- # Foo ⏎ - bar` | caret in `Foo`, bulleted | nothing changes | `Foo ⏎ - bar` |
| 12 | `- o ⏎   - m ⏎     - x ⏎       - n ⏎     - y ⏎   - k` | caret in `x`, bulleted | `- o ⏎   - m ⏎⏎ x ⏎⏎ - - n ⏎   - y ⏎   - k` | `- o ⏎   - m ⏎⏎ x ⏎⏎ - - - - n ⏎     - y ⏎   - k` |
| 13 | `> - one ⏎ > - two` | caret in `one`, bulleted | one item holding the text `> - one ⏎ > - two` | `one ⏎ > - two` |

Rows 10 and 11 report `canSetBlockType` as `true` and change nothing. In
3,681 scenarios of a grid of list shapes, 168 toggles do so, and the two
surfaces leave documents the viewer reads alike in 1,662.[^prototype]

No row runs two texts together. The plan of 2026-10-06 recorded that the
bulleted toggle of row 8 saved `onesecond ⏎⏎ - two`. That defect is gone at
`85b55a8f4`.[^merge-gone]

---

## Architecture Decisions

### The contract — six rules, the same on both surfaces

**Terms.**

- A *text block* is a paragraph (also one a quote holds), a heading, or the
  text a list item opens with.
- A list's *kind* is bulleted or numbered. A *task item* is an item of either
  kind whose text opens with the *task marker* `[ ] `, `[x] ` or `[X] `.
  There is no third kind of list and no third toggle.
- A block *opens* an item when it is the item's first block and is the
  item's text or a heading. The toggles read that block as the item. Every
  other block of an item is a block the item *holds*.
- The *touched blocks* are the text blocks holding the selection's two ends
  and every text block between them. A caret touches one block.
- The *top level* is the document's top level, or the `:::` column the block
  stands in. A block never leaves its column.
- A list is *loose* when a blank line separates two of its blocks, else
  *tight*. The viewer wraps a loose list's item texts in paragraphs.
- The *tail* of a block in a list is every block that stands after it inside
  its outermost list item, in document order, up to the next list item at
  any depth.

| Document | Block | Its tail | What comes after the tail |
|---|---|---|---|
| `- one ⏎⏎   second ⏎⏎   third ⏎⏎ - two` | `one` | `second`, `third` | the item `two` |
| `- one ⏎⏎   second ⏎⏎   - inner ⏎⏎   after ⏎⏎ - two` | `one` | `second` | the nested list `inner`, then `after`, then the item `two` |
| same | `second` | nothing | the same |
| `- a ⏎   - b ⏎⏎   c ⏎⏎ - d` | `b` | `c`, a block of the outer item | the item `d` |
| `- o ⏎   - x ⏎     - n ⏎   - y ⏎ - z` | `x` | nothing | the nested list `n`, the item `y`, the item `z` |

**Rules,** for a toggle of kind K:

1. **Direction.** The toggle is *off* when every touched block opens an item
   of a K list. Otherwise it is *on*.
2. **Off.** Each touched block becomes a paragraph at the top level, and its
   tail follows it there, each block as it is. Every list around the block is
   split at that place. What came after the tail inside the block's outermost
   item stays in the list, in one item that has no text: the nested lists and
   blocks stand directly in that item, whatever depth they had.
3. **On.** Each touched block that does not open a K-list item becomes the
   text of a new item of a K list at the top level, and its tail becomes the
   blocks that item holds. The lists around the block are split as in
   rule 2, and what came after the tail stays in the list the same way. A
   touched block that already opens a K-list item is left as it is.
4. **Joining.** New items made from blocks that stand side by side, with
   nothing but blank lines between them, are one *run*, and a run is one
   list. A run joins the K list that ends right before it and takes its
   marker (`-`, `*` or `+`; `.` or `)`). With no K list before it, the run
   joins the K list that starts right after it. With a K list on both sides,
   the two become one list when they are written with the same marker. A run
   with no K list next to it is a new list, written `-` or `1.`. A block
   lifted out of a K list stands between that list's two parts, which count
   as the list before it and the list after it. The resulting list is tight,
   unless a list joined into it was loose or one of its items holds a block
   after its text.
5. **Task marker.** The marker belongs to its item's text. A text that
   becomes the text of a new item keeps its marker (`1. [ ] one`). A text
   that stops being an item's text (rule 2, and every `setBlockType`) keeps
   the marker as the literal text it shows, written `\[ \] ` or `\[x\] `; in
   a code block it is written as it was, `[ ] `.
6. **Availability.** `canSetBlockType` keeps its rule (see *`canSetBlockType`
   keeps its rule* below). Wherever it is `true` on the WYSIWYG surface, each
   toggle changes the document.

**Worked cases.** "Reads as" is what the viewer shows; both surfaces must
produce it.

| Case | Document | Selection | Toggle | Reads as | Rules |
|---|---|---|---|---|---|
| bulleted item | `- one ⏎ - two ⏎ - three` | caret in `two` | bulleted | list `one`; paragraph `two`; list `three` | 1 off, 2 |
| item of the other kind | same | caret in `two` | numbered | bulleted `one`; numbered `two`; bulleted `three` | 1 on, 3 |
| task item, its list's kind | `- [ ] one ⏎ - [x] two` | caret in `one` | bulleted | paragraph `[ ] one`; list with the task item `two` | 2, 5 |
| task item, the other kind | same | caret in `one` | numbered | numbered list with the task item `one`; bulleted list with the task item `two` | 3, 5 |
| item holding a paragraph | `- one ⏎⏎   second ⏎⏎ - two` | caret in `one` | bulleted | paragraphs `one`, `second`; list `two` | 2 |
| the same item, the other kind | same | caret in `one` | numbered | numbered item `one` holding the paragraph `second`; bulleted `two` | 3 |
| the paragraph that item holds | same | caret in `second` | bulleted | loose list `one`, `second`, `two` | 1 on, 3, 4 |
| item holding a paragraph, a nested list, a paragraph | `- one ⏎⏎   second ⏎⏎   - inner ⏎⏎   after ⏎⏎ - two` | caret in `one` | bulleted | paragraphs `one`, `second`; a list whose first item holds the list `inner` and the paragraph `after`, then `two` | 2 |
| nested item, last of its list | `- a ⏎   - b ⏎⏎   c ⏎⏎ - d` | caret in `b` | bulleted | list `a`; paragraphs `b`, `c`; list `d` | 2 |
| nested item with a nested list | `- o ⏎   - x ⏎     - n ⏎   - y ⏎ - z` | caret in `x` | bulleted | list `o`; paragraph `x`; a list whose first item holds the list `n`, `y`, then `z` | 2 |
| heading that opens an item | `- # Foo ⏎ - bar` | caret in `Foo` | bulleted | paragraph `Foo`; list `bar` | 1 off, 2 |
| two lists of different kinds | `- one ⏎ - two ⏎⏎ 1. three ⏎ 2. four` | `two` to `three` | bulleted | tight bulleted `one`, `two`, `three`; numbered `four` | 1 on, 3, 4 |
| paragraph, list, paragraph | `zero ⏎⏎ * one ⏎ * two ⏎⏎ three` | `zero` to `three` | bulleted | one tight list `zero`, `one`, `two`, `three`, written `*` | 3, 4 |
| paragraph after a tight list | `- one ⏎ - two ⏎⏎ three` | caret in `three` | bulleted | one tight list `one`, `two`, `three` | 3, 4 |
| list in a `:::` column | `::: columns ⏎ - one ⏎ - two ⏎ \|\|\| ⏎ Right ⏎ :::` | caret in `one` | bulleted | in the left column: paragraph `one`; list `two` | 2 |

A caret and a range follow the same rules: a caret is a selection touching
one block.

The rules are stated in blocks. Nine places remain where the two surfaces do
not hold the same blocks, or where a difference is left alone on purpose.
They are listed under *Non-Goals*, each with the test rows that pin it.

### What an item holds after its text leaves the list with it — the WYSIWYG surface is right

Rules 2 and 3 take a touched block's tail out of the list with the block.
The WYSIWYG surface already does this for an item's text: `$liftItemOut`
([markdownListItemNode.ts:762](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L762))
moves the text and the blocks up to the item's first nested list out, and
leaves the rest in the list. Source mode is changed to do the same.[^blocks-follow]

### A task marker is part of its item's text — the WYSIWYG surface is right

Source mode converts a task item as the WYSIWYG surface does (rule 5),
instead of doing nothing.[^marker-is-text]

### A toggle of the other kind changes the touched items only — source mode is right

On the WYSIWYG surface a numbered toggle in a bulleted list (and the
reverse) no longer converts the whole list. It changes the touched items
alone and splits their list around them (rule 3), as source mode does. To
convert a whole list, select it.[^selected-only]

### A converted block lands at the top level, also out of a nested list — source mode is right

A nested item that changes kind becomes an item at the top level, as a
nested item that leaves its list becomes a paragraph there. The WYSIWYG
surface no longer converts a nested list in place.[^top-level]

### A new item joins the list next to it and leaves it tight — the WYSIWYG surface is right

Source mode follows rule 4. It writes the new items of a run line after
line, writes them with the marker of the K list they join, continues a
numbered list's count, and removes the blank lines between the new items and
a tight list they join.[^joining]

### A block an item holds is not the item — source mode is right

The rules apply to each touched block. A block an item holds does not open
the item, so a toggle on it is always *on*: the block becomes an item of its
own, and its tail goes into that item (rule 3). The WYSIWYG surface is
changed to do this. Today a toggle there changes nothing in a list of the
toggle's kind and converts the whole list in one of the other.[^held-block]

### The heading on an item's marker line is the item — source mode is right

An item that opens with a heading (`- # Foo`) has no text of its own on the
WYSIWYG surface; the heading is its first block. For the toggles that
heading opens the item, as an item's text does: in a list of the toggle's
kind the toggle is off, and the heading becomes a paragraph (rule 2). Source
mode reads the item this way already.[^heading-opens]

### A list inside a quote stays a raw block on the WYSIWYG surface

The WYSIWYG surface loads a quote that holds a list as a *raw Markdown
block*: it shows the source text in a monospace font, not a list. There the
toggles act on the raw block as they do on every raw block — its text
becomes one item. Source mode applies the six rules to the list inside the
quote. The two results differ; the parity rows pin both, so neither can
drift.[^quote-raw]

### `canSetBlockType` keeps its rule

| Surface | `canSetBlockType` |
|---|---|
| WYSIWYG | `true` for a range selection (a caret included) that touches no table cell; `false` with no selection, with table cells selected, and while read-only |
| Source mode | always `true` (`false` while read-only): where a source command declines is not predicted |

No code of the field changes. The stack's rule for it — `true` means the
command changes the document or the selection — holds for the toggles on
every row of the parity tables once rows 10 and 11 of the table in *What the
two surfaces do today* are fixed.[^availability]

*Amended during implementation.* The field gained one clause: `false` for a
selection whose two ends stand on a table or one of its rows with no block
of text between them. The next section says why; note D17 has the detail.

### WYSIWYG: the ends of the selection are settled into blocks of text first

*Added during implementation.* The plan's code reads the touched blocks
from the selection's two ends and the selected leaves, and takes each for a
block of text. That holds for every selection a click or a drag makes. It
does not hold for a selection end that stands on a node that holds blocks:
the root, a `:::` block or one of its columns, a list, a list item, a
table or a row. `deleteTable()` leaves the caret there, and code can put a
point there. With the plan's own route (no Lexical list insert) such a
point made the toggles take a whole list for one block, write a list into a
`:::` block, or throw, with `canSetBlockType` `true`.

Three ways out were weighed.

| Way | Why not, or why |
|---|---|
| Make `canSetBlockType` `false` for any end on a holder | The caret after `deleteTable()` is such an end. The parent's toggles acted there, so this takes a working command away where a user stands |
| Act on the holder: convert every block it holds | It is what went wrong. A caret would convert a whole list or a whole column |
| Settle each end into a block of text first, then act as on any selection | Taken. The commands keep one definition of "the touched blocks", blocks of text only, and a holder is never one of them |

The precedent is in the same file: `$settleCaretIntoBlock` moves a caret a
removal leaves at a table's edge into the neighbouring block, or makes "a
new empty paragraph when the parent holds no block any more", for the
inserts; `$refillEmptiedColumn` gives a `:::` column a removal emptied its
paragraph. `plans/markdown-editor-table-command-fixes.md` writes down the
same rule for its own `$settlePoint`.

The rule has two halves, because a caret and a range ask for different
things.

- A caret has no extent, so it goes into the block of text **beside** it:
  the one after it, else the one before it, else a new empty paragraph. A
  table is passed over, since its cells hold text only. A column or a
  document that holds nothing gets a paragraph for it.
- A range says which blocks it means. Its ends go **inward**: the start
  into the first block of text after it, the end into the last one before
  it, in document order. No block outside the range is touched. A range
  with no block of text between its ends says nothing, and is a caret
  where it starts.

`setBlockType` shares the step with the two toggles, though the plan
changes only the toggles: the caret after `deleteTable()` is the same
caret for all three, and all three answer to the one field
`canSetBlockType`. For a selection made by a click or a drag the step does
nothing.

One selection is left with no block of text after this: both ends on a
table or a row, nothing between them (a caret between two rows). A table is
no block of text, the commands change nothing there, and the field is
`false` for it, as it already was for a caret at a table's first or last
edge. That is the one clause added to the field.

The functions are `$settleEndsIntoBlocksOfText`, `$settleRangeEndsInward`
and `$settleCaretIntoBlockOfText` with their helpers, after
`$moveBlockPointsIntoText` in `MarkdownEditor.ts`, and `$holdsBlocks`,
`$standsOnHolder` and `$isBlockOfText` after `$isTextOnlyBlock`. The
functions that find a block write nothing; `$fillEmptyHolder` and
`$newParagraphBeside` are the two that write.

### WYSIWYG: one update lifts the touched blocks, then makes the items

`toggleList` runs one discrete update, which is one undo step. The update
has two parts.

1. It takes each touched block that must change out of its lists with
   `$liftItemOut`, the last block in the document first. Each call returns
   the blocks that left the list: the block and its tail. A block in no list
   is a group of its own.
2. For an *off* toggle nothing more is needed, except that a heading that
   opened an item becomes a paragraph. For an *on* toggle each returned
   group becomes one item, and the groups of a run go into one list
   (rule 4).

Lexical's `INSERT_UNORDERED_LIST_COMMAND` and `INSERT_ORDERED_LIST_COMMAND`
are no longer dispatched, and `$convertListOfEmptyItem`, which worked around
that insert, is deleted. The precedent is `$liftItemOut` itself: the item's
text already takes a block type by lifting the item out and replacing the
paragraph that comes back
([markdownListItemNode.ts:504](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L504)),
and Enter on an empty line of a list lifts the item out the same way
([MarkdownEditor.ts:3565](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3565)).[^own-route]

### WYSIWYG: a block an item holds opens an item of its own before it is lifted

`$liftItemOut` lifts an item from its first block. For a touched block that
an item holds after its first block, a new item operation,
`$splitItemBefore`, first gives the block an item of its own: a new item
after the first one takes the block and every block after it. It mirrors
`$splitItemAfterText`
([markdownListItemNode.ts:658](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L658)),
which Enter uses to split an item after its text.[^split-before]

### Source mode: one lift rule for list items, in `liftLines`

The source-mode commands keep their design: lift each target block to the
top level with `liftLines`
([markdownSourceLines.ts:568](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L568)),
then check the result by lexing it (`readsAsExpected`). What changes is what
`liftLines` writes for the lines that follow a lifted block inside its list
items:

| Line after the lifted block | Before | Now |
|---|---|---|
| in the block's tail | kept in its item, the item re-opened by its marker | loses the indentation of every list item around the lifted block; stands at the top level, or under the new item |
| the first list item line after the tail | every list item around the lifted block re-opened by its marker | only the outermost one re-opened by its marker; the ones inside it are not re-opened |
| later lines inside the outermost item | keep their indentation | keep the outermost item's indentation, lose that of the items inside it |
| inside a quote | the quote re-opened by its `>` | unchanged |

The rule is one rule for every line command — the list toggles, the block
types and the code fence — because they share `liftLines`.[^source-lift]

### Source mode: the marker travels through the existing lift

A task item's marker goes with the item's text. A target carries its marker
into the lifted lines, and the check expects the marker's characters as text
(or, for a text that becomes a new item, the marker in that item). No new
edit mechanism is added.[^source-design]

### Source mode: new items are joined run by run

`listOn` groups the touched blocks into runs (rule 4) and writes each run as
one replacement, joined to the K list next to it: the list around the run at
the top level, else the one right above it, else the one right below. Before,
the join was read once for the whole selection, from its two ends.[^source-runs]

### Parity is pinned by rows in the existing test files

The parity rows are two tables in the `describe` that already holds the
both-surfaces test
([markdown-editor.test.ts:716](../packages/lib/tests/component/markdown-editor.test.ts#L716)).
Each row gives a document, a selection, a command, the exact Markdown the
WYSIWYG surface saves and the exact Markdown source mode leaves. A row of the
first table also asserts that the viewer reads the two alike; a row of the
second, where the surfaces differ on purpose, asserts that it does *not*, so
a later fix turns it red.[^tests-in-tables]

---

## Internal Structure

All new functions but `$splitItemBefore` are module-private. Each has the
JSDoc block shown. Assign a call's result to a variable before testing it,
as the code below does; a type guard that narrows (`$isListNode(above)`) is
tested directly.

### `markdownListItemNode.ts`

Add after `$splitItemAfterText`
([:658](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L658)):

```typescript
/**
 * Splits an item before one of the blocks it holds after its first: a new
 * item, put after it, takes that block and every block after it, so the
 * block opens an item of its own.
 *
 * @param item - The item.
 * @param block - A child of the item that is not its first.
 * @returns The new item.
 */
export function $splitItemBefore(item: MarkdownListItemNode, block: LexicalNode): MarkdownListItemNode {
    const next = new MarkdownListItemNode();

    item.insertAfter(next);
    next.splice(0, 0, [block, ...block.getNextSiblings()]);

    return next;
}
```

### `markdownSerializer.ts`

`$serializeInlineNodes`
([:795](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L795))
gains a second parameter:

```typescript
/**
 * Serializes a run of inline nodes as a save writes them, their lines kept —
 * the Markdown a raw block or code block holds for content it takes in from
 * another block. Must run inside an `editor.read` or `editor.update`.
 *
 * @param nodes - The inline nodes.
 * @param inListItem - Whether the nodes are a list item's text, whose first
 *   line may open with a task marker.
 * @returns Their Markdown, lines separated by `\n`.
 */
export function $serializeInlineNodes(nodes: LexicalNode[], inListItem: boolean = false): string {
    return serializeInlineNodes(nodes, { ...MULTI_LINE, definitions: $collectDefinitions(), inListItem });
}
```

### `MarkdownEditor.ts`

**Imports.** Five import lists change:

| Import from | Add | Remove |
|---|---|---|
| `lexical` ([:30](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L30)) | `$setState` | — |
| `@lexical/list` ([:41](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L41)) | — | `INSERT_UNORDERED_LIST_COMMAND`, `INSERT_ORDERED_LIST_COMMAND` |
| `markdownSerializer.js` ([:63](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L63)) | `$writtenListMarker` | — |
| `markdownNodeState.js` ([:75](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L75)) | `listLooseState` | — |
| `markdownListItemNode.js` ([:78](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L78)) | `$movePointsBetween`, `$splitItemBefore` | — |

`registerList`, `$createListNode`, `$createListItemNode`, `$copyNode` and the
`LexicalCommand` type stay imported: other code uses them.

**`$copyBlockAsCodeSource`**
([:358](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L358))
tells the serializer whether the block is an item's text, so a task marker
goes into the code as it was written. One statement and the JSDoc change:

```typescript
/**
 * `$setBlocksType`'s after-create hook for a conversion to a code block:
 * copies the block's format and indent, as the default hook does, and
 * replaces its inline content with that content's Markdown, so the code
 * block shows — and saves — the source of the formatting, links and images
 * it cannot hold, and nothing is lost. A list item's text is written as an
 * item's text is, so a task marker it opens with goes into the code as it
 * was written (`[ ] `). A raw block or a code block already holds only its
 * text and is left as it is.
 *
 * @param block - The block being converted; its children move into `code`.
 * @param code - The new code block.
 */
function $copyBlockAsCodeSource(block: ElementNode, code: ElementNode): void {
    $copyBlockFormatIndent(block, code);

    if ($isTextOnlyBlock(block)) {
        return;
    }

    const markdown = $serializeInlineNodes(block.getChildren(), $isMarkdownListItemTextNode(block));

    block.clear();

    if (markdown !== "") {
        block.append($createTextNode(markdown));
    }
}
```

**The list functions.** Delete `$selectionLiesInListOfType`
([:3146](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3146))
and `$convertListOfEmptyItem`
([:3171](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3171)),
each with its JSDoc. Put these seven functions in their place, before
`$blocksTouchedBy`:

```typescript
/**
 * Whether a block is what an item of a list of one kind opens with, as its
 * text or as a heading: the block a list toggle reads as the item, which is
 * the block source mode finds on the item's marker line. Any other block of
 * an item — a paragraph, quote or code block after its text, or a quote,
 * code block or raw block it opens with — is a block the item holds.
 *
 * @param block - The block.
 * @param type - The kind of list.
 * @returns `true` for the text or heading an item of such a list opens with.
 */
function $opensItemOfListType(block: ElementNode | null, type: ListType): boolean {
    const item = block === null ? null : block.getParent();
    const list = $isListItemNode(item) ? item.getParent() : null;
    const opensItem = block !== null && block.getPreviousSibling() === null;
    const readsAsItem = $isMarkdownListItemTextNode(block) || $isHeadingNode(block);

    return opensItem && readsAsItem && $isListNode(list) && list.getListType() === type;
}

/**
 * The blocks a range selection touches ({@link $blocksTouchedBy}), each
 * once, the last in the document first: an order in which changing one block
 * never moves a block still to be changed.
 *
 * @param selection - The selection.
 * @returns The blocks.
 */
function $touchedBlocksLastFirst(selection: RangeSelection): ElementNode[] {
    const byKey = new Map<NodeKey, ElementNode>();

    for (const block of $blocksTouchedBy(selection)) {
        if (block !== null) {
            byKey.set(block.getKey(), block);
        }
    }

    return [...byKey.values()].sort((a, b) => (a.isBefore(b) ? 1 : -1));
}

/**
 * Takes a block out of every list it is in, with what follows it in its
 * item up to the item's first nested list ({@link $liftItemOut}). A block
 * that an item holds after its first block opens an item of its own first
 * ({@link $splitItemBefore}), so what leaves the list starts at the block.
 *
 * @param block - The block.
 * @returns The blocks now standing outside every list, the block (or the
 *   paragraph an item's text became) first; the block alone when it was in
 *   no list item.
 */
function $liftBlockOutOfLists(block: ElementNode): LexicalNode[] {
    const holder = block.getParent();

    if (!$isMarkdownListItemNode(holder)) {
        return [block];
    }

    const opensItem = block.getPreviousSibling() === null;
    const item = opensItem ? holder : $splitItemBefore(holder, block);

    return $liftItemOut(item);
}

/**
 * Makes each group of blocks standing outside every list one item of a list
 * of one kind, where it stands. Groups standing side by side are one run,
 * and a run's items go into one list ({@link $makeItemsOfRun}).
 *
 * @param groups - The groups, in document order; none is empty.
 * @param type - The kind of list.
 */
function $makeItemsOf(groups: LexicalNode[][], type: ListType): void {
    let run: LexicalNode[][] = [];

    for (const blocks of groups) {
        const before = run[run.length - 1];
        const standsApart = before !== undefined && blocks[0]!.getPreviousSibling() !== before[before.length - 1];

        if (standsApart) {
            $makeItemsOfRun(run, type);
            run = [];
        }

        run.push(blocks);
    }

    $makeItemsOfRun(run, type);
}

/**
 * Makes the groups of one run the items of one list of a kind, where the
 * run stands: a list of that kind right before the run, which they are
 * appended to; else one right after it, which they are put at the start of;
 * else a new list.
 *
 * @param run - The run's groups, in document order.
 * @param type - The kind of list.
 */
function $makeItemsOfRun(run: LexicalNode[][], type: ListType): void {
    const lastGroup = run[run.length - 1];

    if (lastGroup === undefined) {
        return;
    }

    const first = run[0]![0]!;
    const above = first.getPreviousSibling();
    const below = lastGroup[lastGroup.length - 1]!.getNextSibling();
    const joinsAbove = $isListNode(above) && above.getListType() === type;
    const joinsBelow = $isListNode(below) && below.getListType() === type;
    const list = joinsAbove ? above : joinsBelow ? below : $createListNode(type);

    if (!joinsAbove && !joinsBelow) {
        first.insertBefore(list);
    }

    // The list transform joins `below` into `above` when their markers match; a loose one makes the whole list loose.
    const meetsLoose = joinsAbove && joinsBelow && $getState(below, listLooseState) && $writtenListMarker(below) === $writtenListMarker(above);

    if (meetsLoose) {
        $setState(above, listLooseState, true);
    }

    list.splice(joinsAbove ? list.getChildrenSize() : 0, 0, run.map($itemOfBlocks));
}

/**
 * Makes one list item of blocks standing outside every list: the first
 * block gives the item its text, the others are the blocks the item holds.
 *
 * @param blocks - The blocks, in document order, the first one a block of text.
 * @returns The item, in no list yet.
 */
function $itemOfBlocks(blocks: LexicalNode[]): LexicalNode {
    const [first, ...rest] = blocks;
    const item = $createListItemNode();
    const text = $createMarkdownListItemTextNode();

    item.append(text, ...rest);

    if ($isElementNode(first)) {
        text.splice(0, 0, first.getChildren());
        // A caret in an empty block is held on the block itself, which goes.
        $movePointsBetween(first, text);
        first.remove();
    }

    return item;
}

/**
 * Toggles a list of one kind over the blocks a selection touches. Where
 * every block opens an item of such a list ({@link $opensItemOfListType})
 * the toggle is off: each item leaves its lists ({@link $liftBlockOutOfLists})
 * and what it opened with is a paragraph. Otherwise it is on: each block
 * that does not open such an item yet leaves the lists it is in the same
 * way, and what left with it becomes one item of such a list
 * ({@link $makeItemsOf}).
 *
 * @param selection - The selection.
 * @param type - The kind of list.
 */
function $toggleListOfTouchedBlocks(selection: RangeSelection, type: ListType): void {
    const blocks = $touchedBlocksLastFirst(selection);
    const isOff = blocks.every((block) => $opensItemOfListType(block, type));
    const changed = blocks.filter((block) => isOff || !$opensItemOfListType(block, type));
    // Lifted last first; `reverse` then puts the groups in document order.
    const lifted = changed.map($liftBlockOutOfLists).reverse();

    if (!isOff) {
        $makeItemsOf(lifted, type);

        return;
    }

    for (const [first] of lifted) {
        // An item's text is a paragraph once it is out; a heading the item opened with becomes one.
        if ($isHeadingNode(first)) {
            first.replace($createParagraphNode(), true);
        }
    }
}
```

**`toggleList`**
([:5209](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5209))
loses its `insert` parameter. Replace the method and its JSDoc:

```typescript
/**
 * Shared body of {@link MarkdownEditor.toggleUnorderedList} and
 * {@link MarkdownEditor.toggleOrderedList} on the WYSIWYG surface, in one
 * update, so one undo step ({@link $toggleListOfTouchedBlocks}). Where
 * every block the selection touches opens an item of a list of `type`
 * the toggle is off: those items leave their list, the list split around
 * them, which is what the source-mode toggle does to the same lines.
 * Otherwise each block that does not open such an item yet becomes an
 * item of such a list, taken out of the lists it was in. The blocks are
 * read from the selected leaves, so a selection point on a block itself
 * is first moved into the text beside it
 * ({@link $moveBlockPointsIntoText}): a range from one block's end to
 * the next one's start then takes both blocks however its points are
 * held.
 *
 * @param type - The kind of list toggled.
 */
private toggleList(type: ListType): void {
    this.ensureEditor().update(() => {
        const selection = $getSelection();

        if ($isRangeSelection(selection)) {
            $moveBlockPointsIntoText(selection);
            $toggleListOfTouchedBlocks(selection, type);
        }
    }, { discrete: true });
}
```

`toggleUnorderedList`
([:5833](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5833))
calls `this.toggleList("bullet")` and `toggleOrderedList`
([:5860](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5860))
calls `this.toggleList("number")`. Nothing else in the two methods changes
but their JSDoc (see *Documentation Impact*). `setBlockType`
([:6202](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L6202)),
`$selectedBlocksHaveType` and `$blocksTouchedBy` keep their code.

How the run decides where its items go:

| Document | Touched | Toggle | Before the run | After the run | The items go |
|---|---|---|---|---|---|
| `* one ⏎⏎ 1. two ⏎ 2. three ⏎ 3. four` | `one` to `three` | bulleted | the list `* one` | the numbered list `four` | to the end of `* one`: `* one ⏎ * two ⏎ * three` |
| `one ⏎⏎ two ⏎⏎ * three` | `one` to `two` | bulleted | nothing | the list `* three` | to the start of `* three`, in order |
| `zero ⏎⏎ - one ⏎⏎ - two` | caret in `zero` | bulleted | nothing | a loose list | to the start of that list, which stays loose |
| `- a ⏎ - b ⏎⏎ mid ⏎⏎ - c ⏎⏎ - d` | caret in `mid` | bulleted | a tight list | a loose list, same marker | to the end of the first, which is set loose; the list rule then joins the second into it |
| `one ⏎⏎ two` | both | bulleted | nothing | nothing | into a new list |

### `markdownSourceLines.ts` — the task marker

`marked` gives a task marker in one of two shapes, and both must be handled:

| List | Where the marker is | The item's text token |
|---|---|---|
| tight (`- [ ] one ⏎ - [x] two`) | a `checkbox` block of its own, before the text | `text` with `text: "one"` |
| loose (`- [ ] one ⏎⏎ - [x] two`) | an inline `checkbox:[ ] ` leaf opening the paragraph | `paragraph` with `text: "[ ] one"` |

`readLeaves`
([:156](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L156))
reads both shapes as the first one, so a result that turns one shape into
the other still compares equal. Its leaf branch becomes:

```typescript
if (entry.kind === "leaf") {
    if (entry.key.startsWith("checkbox:")) {
        // A loose item's marker is an inline leaf of its paragraph, a tight item's a block of its own: both read
        // as that block. Blocks are counted in whole numbers, so half a block back is a number no other leaf
        // has: the marker shares its block with nothing, as the tight shape reads.
        leaves.push({ key: entry.key, path: [...stack], block: block - 0.5, entry: index, offset: entry.start });
    } else if (entry.key !== "br" && !/^t\s$/.test(entry.key)) {
        leaves.push({ key: entryKey(entry, entryFormat(entry)), path: [...stack, textBlock], block, entry: index, offset: entry.start });
    }

    return;
}
```

Add after `blockTextLines`
([:517](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L517)):

```typescript
/** A task item's marker, as the item's text block carries it. */
interface TaskMarker {
    /** The marker as written, with the space after it: `[ ] `, `[x] ` or `[X] `. */
    readonly raw:   string;
    /** The index of the marker's entry in the analysis. */
    readonly entry: number;
    /** Whether the marker is a block of its own before the text (a tight item), not the start of the text (a loose one). */
    readonly own:   boolean;
}

/** A task marker opening a loose item's first paragraph. */
const TASK_MARKER_START = /^\[[ xX]\] /;

/** A leaf that is a task marker; the group is the character between its brackets. */
const TASK_MARKER_LEAF = /^checkbox:\[([ xX])\]/;

/**
 * The marker of the task item a block is the text of.
 *
 * @param node - The block.
 * @returns The marker, or `null` for a block that is no task item's text.
 */
function taskMarkerOf(node: SourceBlockNode): TaskMarker | null {
    const item = node.parent;

    if (item?.type !== "list_item" || (item.token as Tokens.ListItem).task !== true) {
        return null;
    }

    const first = item.children[0]!;

    if (first.type === "checkbox") {
        return item.children[1] === node ? { raw: first.token!.raw, entry: first.entryStart, own: true } : null;
    }

    const start = TASK_MARKER_START.exec((node.token as { text: string }).text);

    return first === node && start !== null ? { raw: start[0], entry: node.entryStart + 1, own: false } : null;
}

/**
 * The first entry a target block owns: its task marker's, when the marker is
 * a block of its own before it.
 *
 * @param node - The block.
 * @returns The entry's index in the analysis.
 */
function firstEntryOf(node: SourceBlockNode): number {
    const marker = taskMarkerOf(node);

    return marker === null ? node.entryStart : Math.min(marker.entry, node.entryStart);
}

/**
 * A block's text lines ({@link blockTextLines}) with its task marker on the
 * first: as the text it shows (`\[ \] `), for a block that stops being an
 * item's text, or as it was written (`[ ] `), for an item or a code block.
 *
 * @param node - The block.
 * @param markerAs - How the marker is written.
 * @returns The lines.
 */
function textLinesOf(node: SourceBlockNode, markerAs: "text" | "written"): string[] {
    const lines = blockTextLines(node);
    const marker = node.type === "code" ? null : taskMarkerOf(node);

    if (marker === null) {
        return lines;
    }

    const rest = marker.own ? lines[0]! : lines[0]!.slice(marker.raw.length);
    const shown = markerAs === "written" ? marker.raw : marker.raw.replace("[", "\\[").replace("]", "\\]");

    return [shown + rest, ...lines.slice(1)];
}

/**
 * The text leaves a task marker reads as once it is the text it shows: its
 * brackets and, when checked, its letter. Whitespace is no leaf.
 *
 * @param leaf - The leaf.
 * @param path - The path the text leaves have.
 * @param group - The group the text leaves have.
 * @returns The leaves, or `null` for a leaf that is no task marker.
 */
function markerTextLeaves(leaf: LeafView, path: readonly string[], group: string): ExpectedLeaf[] | null {
    const marker = TASK_MARKER_LEAF.exec(leaf.key);

    if (marker === null) {
        return null;
    }

    return ["[", marker[1]!, "]"].filter((char) => char !== " ").map((char) => ({ key: `t${char}|||`, path, group }));
}
```

`t[|||` is the key `entryKey` gives a plain `[`: the letter `t`, the
character, and three empty format fields. A space is left out because
`readLeaves` leaves whitespace out.

`targetOfEntry`
([:898](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L898))
counts a marker as part of its text's target:

```typescript
/**
 * Maps each leaf of a document to the target block holding it. A task
 * item's marker belongs to the item's text ({@link firstEntryOf}).
 *
 * @param targets - The target blocks.
 * @returns A lookup from a leaf's entry index to its target's index, `-1` for none.
 */
function targetOfEntry(targets: readonly SourceBlockNode[]): (entry: number) => number {
    return (entry) => targets.findIndex((target) => firstEntryOf(target) <= entry && entry < target.entryEnd);
}
```

### `markdownSourceLines.ts` — the lift

**The expected leaves.** The check compares two documents leaf by leaf. A
*leaf* is one visible character, or a block that holds no text, such as a
code block. A leaf's *path* names the blocks around it, outermost first. A
line command says what its result must read as with `expectLeaves`
([:280](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L280)).
Until now, a leaf the command did not convert kept its path. Now such a leaf
changes its path when it follows a lifted block inside the block's list
items, as the table under *Source mode: one lift rule for list items* says.
Replace `expectLeaves` and add the four declarations after it:

```typescript
/**
 * The leaves a document is expected to keep: each with its group its own
 * block, and as it is but for the list items a lift takes from around it
 * ({@link pathAfterLifts}), unless `change` says what it becomes.
 *
 * @param leaves - The document's leaves.
 * @param change - What a leaf becomes (one leaf or several), `null` to keep it, `undefined` to drop it.
 * @param lifts - The blocks the command lifts out of their list items, in document order.
 * @returns The expected leaves.
 */
function expectLeaves(
    leaves: readonly LeafView[], change: (leaf: LeafView) => ExpectedLeaf | readonly ExpectedLeaf[] | null | undefined,
    lifts: readonly Lift[] = [],
): ExpectedLeaf[] {
    const expected: ExpectedLeaf[] = [];

    for (const leaf of leaves) {
        const changed = change(leaf);

        if (changed === null) {
            expected.push({ key: leaf.key, path: pathAfterLifts(leaf, lifts), group: `o${leaf.block}` });
        } else if (changed !== undefined) {
            expected.push(...(Array.isArray(changed) ? changed as readonly ExpectedLeaf[] : [changed as ExpectedLeaf]));
        }
    }

    return expected;
}

/** One block a line command lifts out of its list items, as the leaves after it in those items read it. */
interface Lift {
    /** The lifted block. */
    readonly node: SourceBlockNode;
    /** The list and item of the new item the blocks that leave the list with it go into; empty when they stand at the top level. */
    readonly into: readonly string[];
}

/**
 * A kept leaf's path after the lifts: a leaf that follows a lifted block
 * inside the block's list items loses those items ({@link liftLines}). Up to
 * the first list item after the block it leaves them all, for the top level
 * or for the lift's new item; from there on it keeps the outermost one, as a
 * plain item, and loses the ones inside it.
 *
 * @param leaf - The leaf.
 * @param lifts - The lifts, in document order.
 * @returns The path.
 */
function pathAfterLifts(leaf: LeafView, lifts: readonly Lift[]): readonly string[] {
    const lift = lifts.findLast((candidate) => {
        const outermost = liftedItems(candidate.node)[0];

        return candidate.node.entryEnd <= leaf.entry && outermost !== undefined && holdsEntry(outermost, leaf.entry);
    });

    if (lift === undefined) {
        return leaf.path;
    }

    const items = liftedItems(lift.node).filter((item) => holdsEntry(item, leaf.entry));
    const wrapper = wrapperItemAfter(lift.node);
    const leavesList = wrapper === null || leaf.entry < wrapper.entryStart;
    // Every block around an item writes one path segment, so the item's own is at its depth and its list's right before.
    const outermost = depthOf(items[0]!);
    const dropped = new Set(items.slice(leavesList ? 0 : 1).flatMap((item) => [depthOf(item) - 1, depthOf(item)]));

    return leaf.path.flatMap((segment, index) => {
        if (leavesList && index === outermost) {
            return lift.into;
        }

        if (!leavesList && index === outermost) {
            return ["item:false:false"];
        }

        return dropped.has(index) ? [] : [segment];
    });
}

/**
 * Whether a leaf at an entry lies inside a block.
 *
 * @param node - The block.
 * @param entry - The leaf's index in the analysis's entries.
 * @returns Whether it does.
 */
function holdsEntry(node: SourceBlockNode, entry: number): boolean {
    return node.entryStart < entry && entry < node.entryEnd;
}

/**
 * How many blocks hold a node.
 *
 * @param node - The node.
 * @returns The count.
 */
function depthOf(node: SourceBlockNode): number {
    let depth = 0;

    for (let parent = node.parent; parent !== null; parent = parent.parent) {
        depth += 1;
    }

    return depth;
}
```

A path holds one segment per block around the leaf, outermost first. What
`pathAfterLifts` does to it, for the leaf `c`:

| Document | Lifted | Leaf `c`'s path before | After | Why |
|---|---|---|---|---|
| `- a ⏎⏎   c ⏎⏎ - d`, block type | `a` | `list:false`, `item:false:false`, `p` | `p` | `c` is in the tail: it loses the item |
| the same, numbered toggle | `a` | the same | `list:true`, `item:false:false`, `p` | `c` goes into the new item |
| `- a ⏎   - b ⏎     - c` | `a` | `list:false`, `item:…`, `list:false`, `item:…`, `list:false`, `item:…`, `p` | unchanged | the first list item after `a` is `b`: the outermost item is re-opened, as a plain item |
| `- a ⏎   - b ⏎     - c` | `b` | the same | `list:false`, `item:false:false`, `list:false`, `item:…`, `p` | `b`'s own item is not re-opened: `c` moves one level up |

**The lines.** Give `LineReplacement`
([:526](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L526))
a `follow` field and add `ClosedContainers` after `LiftedEdit`:

```typescript
/** One run of whole lines a line command replaces with the lines of a lifted block. */
interface LineReplacement {
    /** The first replaced line's start. */
    readonly first: number;
    /** The last replaced line's end, before its newline. */
    readonly last:  number;
    /** The lines written in their place. */
    readonly lines: readonly string[];
    /** The blocks the replaced lines hold, whose quotes and list items the replacement leaves. */
    readonly nodes: readonly SourceBlockNode[];
    /**
     * The indentation given to the lines that leave their list items with the
     * replaced ones: none (the default) to stand at the top level, a new
     * item's content indentation to be that item's blocks.
     */
    readonly follow?: string;
}

/** A lifted edit, with where each replacement's lines landed in the result. */
interface LiftedEdit {
    readonly edit:   MarkdownSourceEdit;
    /** Each replacement's lines, as a range of the post-edit text. */
    readonly ranges: ReadonlyArray<{ from: number; to: number }>;
}

/** The containers a lift has closed, by what each does with the lines that follow the lifted block inside it. */
interface ClosedContainers {
    /** Quotes: each is re-opened by its own marker on the next line that carries it. */
    readonly quotes:    Set<SourceBlockNode>;
    /** Outermost list items: the start of the line each is re-opened on (`-1` for none), and the indentation its lines before that one get. */
    readonly outermost: Map<SourceBlockNode, { readonly wrapLine: number; readonly follow: string }>;
    /** The list items inside an outermost one: every later line loses their indentation. */
    readonly inner:     Set<SourceBlockNode>;
}
```

In `liftLines`
([:568](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L568))
two statements change, and its JSDoc (given under *Documentation Impact*):

```typescript
// was: const closed = new Set<SourceBlockNode>();
const closed: ClosedContainers = { quotes: new Set(), outermost: new Map(), inner: new Set() };

// was: replacement.nodes.forEach((node) => liftedContainers(node)!.forEach((container) => closed.add(container)));
replacement.nodes.forEach((node) => closeContainers(text, node, replacement.follow ?? "", closed));
```

Replace `reopenContainers`
([:689](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L689))
and add the four functions after it:

```typescript
/**
 * Writes one line after a lifted block: peels the prefix each container
 * gives the line, outermost first, and writes in its place what the lift
 * leaves of that container ({@link prefixAfterLift}). A blank line needs no
 * container; a line with no closed container is kept as it is.
 *
 * @param analysis - The document's analysis.
 * @param lineStart - The line's start.
 * @param line - The line.
 * @param closed - The containers closed; updated.
 * @param indents - List item indentation already read; updated.
 * @returns The line to write, or `null` when a closed quote cannot be
 *   re-opened on it (a lazy line, with no quote marker) or its indentation
 *   cannot be read (tabs).
 */
function reopenContainers(
    analysis: SourceAnalysis, lineStart: number, line: string, closed: ClosedContainers,
    indents: Map<SourceBlockNode, ItemIndent | null>,
): string | null {
    const chain = containersOfLine(analysis, lineStart);
    const deepest = chain.findLastIndex((container) => closed.quotes.has(container) || closed.outermost.has(container) || closed.inner.has(container));

    if (deepest === -1 || isBlank(line)) {
        return line;
    }

    let written = "";
    let position = 0;

    for (const container of chain.slice(0, deepest + 1)) {
        const rest = line.slice(position);
        const segment = containerPrefix(analysis, container, rest, indents);

        if (segment === null) {
            // A lazy line or a blank rest: it continues what came before it,
            // which is only possible when no quote below still waits to be
            // re-opened. A list item needs nothing written on such a line.
            return chain.slice(chain.indexOf(container), deepest + 1).some((pending) => closed.quotes.has(pending)) ? null : written + rest;
        }

        if (segment === undefined) {
            return null;
        }

        written += prefixAfterLift(container, rest.slice(0, segment.length), segment.opener, lineStart, closed);
        position += segment.length;
    }

    return written + line.slice(position);
}

/**
 * What is written for one container's prefix on a line after a lifted block.
 *
 * @param container - The quote or list item.
 * @param own - The prefix the line carries for it.
 * @param opener - The marker that opens the container again.
 * @param lineStart - The line's start.
 * @param closed - The containers closed; updated when one is re-opened.
 * @returns The prefix to write.
 */
function prefixAfterLift(container: SourceBlockNode, own: string, opener: string, lineStart: number, closed: ClosedContainers): string {
    if (closed.quotes.has(container)) {
        closed.quotes.delete(container);

        return opener;
    }

    if (closed.inner.has(container)) {
        return "";
    }

    const outermost = closed.outermost.get(container);

    if (outermost === undefined) {
        return own;
    }

    if (outermost.wrapLine !== lineStart) {
        return outermost.follow;
    }

    closed.outermost.delete(container);

    return opener;
}

/**
 * Closes the containers around a lifted block: its quotes, to be re-opened;
 * its outermost list item, re-opened on the first line of the first list
 * item that follows the block inside it ({@link wrapperItemAfter}); and the
 * list items inside that one, which are not re-opened.
 *
 * @param text - The full document text.
 * @param node - The lifted block.
 * @param follow - The indentation for the lines that leave the list with the block.
 * @param closed - The containers closed; updated.
 */
function closeContainers(text: string, node: SourceBlockNode, follow: string, closed: ClosedContainers): void {
    const [outermost, ...inner] = liftedItems(node);
    const wrapper = wrapperItemAfter(node);

    liftedContainers(node)!.filter((container) => container.type === "blockquote").forEach((quote) => closed.quotes.add(quote));
    inner.forEach((item) => closed.inner.add(item));

    if (outermost !== undefined) {
        closed.outermost.set(outermost, { wrapLine: wrapper === null || wrapper.start === -1 ? -1 : lineStartAt(text, wrapper.start), follow });
    }
}

/**
 * The list items a block is lifted out of, outermost first.
 *
 * @param node - The block.
 * @returns The items; none for a block in no list item, or one that cannot be lifted.
 */
function liftedItems(node: SourceBlockNode): SourceBlockNode[] {
    return (liftedContainers(node) ?? []).filter((container) => container.type === "list_item");
}

/**
 * The first list item that follows a lifted block inside its outermost list
 * item, in a list that one of the block's own list items holds: a nested
 * list of the block's item, the next item of its list, or a list further out.
 * Up to that item, what follows the block leaves the list with it; from it
 * on, what follows stays in the list.
 *
 * @param node - The lifted block.
 * @returns The item, or `null` when no list item follows the block there.
 */
function wrapperItemAfter(node: SourceBlockNode): SourceBlockNode | null {
    const items = liftedItems(node);
    const outermost = items[0];

    if (outermost === undefined) {
        return null;
    }

    return allNodes(outermost.children).find((candidate) => candidate.type === "list_item" && candidate.entryStart >= node.entryEnd
        && items.includes(candidate.parent!.parent!)) ?? null;
}
```

`closeContainers` and `pathAfterLifts` both ask `wrapperItemAfter` where the
tail ends. They must keep asking the same function: one writes the lines,
the other says what the lines must read as.

How the lift writes the lines after a lifted block:

| Document | Lifted | Command | Source mode writes | Why |
|---|---|---|---|---|
| `- one ⏎⏎   second ⏎⏎ - two` | `one` | bulleted toggle | `one ⏎⏎ second ⏎⏎ - two` | `second` is the tail: it loses the item's two spaces |
| same | `one` | numbered toggle | `1. one ⏎⏎    second ⏎⏎ - two` | the tail takes the new item's indentation, three spaces |
| `10. a ⏎⏎     b` | `a` | `setBlockType("h2")` | `## a ⏎⏎ b` | four spaces left in place would make `b` indented code |
| `- one ⏎   - inner ⏎ - three` | `one` | bulleted toggle | `one ⏎ - - inner ⏎ - three` | no tail; the item is re-opened on `inner`'s line |
| `- one ⏎⏎   second ⏎⏎   - inner ⏎⏎   after ⏎⏎ - two` | `one` | bulleted toggle | `one ⏎⏎ second ⏎⏎ - - inner ⏎⏎   after ⏎⏎ - two` | the tail ends at the nested list; `after` keeps the item's indentation |
| `- a ⏎   - b ⏎⏎   c ⏎⏎ - d` | `b` | bulleted toggle | `- a ⏎⏎ b ⏎⏎ c ⏎⏎ - d` | `c`, a block of the outer item, is in `b`'s tail |
| `- o ⏎   - x ⏎     - n ⏎   - y ⏎⏎   t ⏎ - z` | `x` | bulleted toggle | `- o ⏎⏎ x ⏎⏎ - - n ⏎   - y ⏎⏎   t ⏎ - z` | the outer item `o` is re-opened; `x`'s own item is not, so `n` moves one level up |
| `> - one ⏎ > - two` | `one` | bulleted toggle | `one ⏎ > - two` | a quote is re-opened by its `>`, as before |
| `- one ⏎⏎ ⇥second ⏎ - two` (`⇥` is a tab) | `one` | bulleted toggle | declines | tab indentation cannot be read, as before |

**The call sites.** Four functions pass what they lift:

| Function | Change |
|---|---|
| `convertBlocks` ([:917](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L917)) | `blockTextLines(target)` becomes `textLinesOf(target, "text")`; the expected leaf becomes `markerTextLeaves(leaf, path, group) ?? { key: leaf.key, path, group }`; pass `targets.map((node) => ({ node, into: [] }))` as `expectLeaves`'s third argument |
| `FENCED_CODE_SOURCE` ([:1032](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L1032)) | pass `targets.map((node) => ({ node, into: [] }))` as `expectLeaves`'s third argument |
| `fencedContent` ([:1081](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L1081)) | `blockTextLines(target)` becomes `textLinesOf(target, "written")` |
| `listOff` ([:1181](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L1181)) | as `convertBlocks` |

`convertBlocks` whole, after the change:

```typescript
/**
 * Converts the blocks a selection touches (see {@link readLineTargets}) to the
 * block `prefix` writes — a paragraph for `""`, a quote for `"> "`, a heading
 * for `"#".repeat(level) + " "` — lifting each out of its quotes and list
 * items (see {@link liftLines}). A block already of that kind at the top
 * level is left alone; a heading is written one line per line of text. A
 * task item's marker is carried as the text it shows (`\[x\] `).
 *
 * @param text - The full document text.
 * @param from - 0-based start of the raw selection.
 * @param to - 0-based end (exclusive) of the raw selection.
 * @param prefix - The block prefix.
 * @returns The edit, or `null` when the command declines.
 */
function convertBlocks(text: string, from: number, to: number, prefix: string): MarkdownSourceEdit | null {
    const analysis = analyzeMarkdownSource(text);
    const selection = readLineTargets(analysis, from, to, true);
    const targets = selection?.targets.filter((target) => !alreadyBlock(target, prefix)) ?? [];

    if (targets.length === 0) {
        return null;
    }

    const kind = prefix === "" ? ["p"] : prefix === "> " ? ["quote", "p"] : [`h${prefix.trim().length}`];
    const targetOf = targetOfEntry(targets);
    const code = targets.map((target) => target.type === "code");
    const leaves = readLeaves(analysis);
    const expected = expectLeaves(leaves, (leaf) => {
        const index = targetOf(leaf.entry);

        if (index === -1) {
            return null;
        }

        if (code[index]!) {
            return undefined;
        }

        const line = prefix.startsWith("#") ? `:${lineStartAt(text, leaf.offset)}` : "";
        const path = [...columnPath(leaf.path), ...kind];

        return markerTextLeaves(leaf, path, `t${index}${line}`) ?? { key: leaf.key, path, group: `t${index}${line}` };
    }, targets.map((node) => ({ node, into: [] })));

    const build = (escape: boolean): LineReplacement[] => targets.map((target, index) => ({
        first: lineStartAt(text, target.start),
        last:  lineEndAt(text, target.end - 1),
        lines: textLinesOf(target, "text").map((line) => {
            const written = isBlank(line) || prefix === "" ? line : prefix + line.trimStart();

            return escape && !code[index]! && !isBlank(line) ? escapeBlockStart(written, prefix) : written;
        }),
        nodes: [target],
    }));
    // A code block's code becomes Markdown, read afresh: only the kind of block it lands in is predicted.
    const wildcardPaths = targets.map((target, index) => {
        const own = leaves.find((leaf) => leaf.entry === target.entryStart);

        return code[index]! && own !== undefined ? [...columnPath(own.path), ...kind] : null;
    });

    return firstReadingEdit(analysis, build, expected, wildcardPaths, true);
}
```

`listOff` whole, after the change:

```typescript
/**
 * Lifts list item texts out of their items as paragraphs, a task item's
 * marker as the text it shows. What an item held after its text, up to its
 * first nested list, follows the paragraph out of the list.
 *
 * @param analysis - The document's analysis.
 * @param targets - The item texts.
 * @returns The edit, or `null` when no form reads as intended.
 */
function listOff(analysis: SourceAnalysis, targets: readonly SourceBlockNode[]): MarkdownSourceEdit | null {
    const text = analysis.text;
    const targetOf = targetOfEntry(targets);
    const expected = expectLeaves(readLeaves(analysis), (leaf) => {
        const index = targetOf(leaf.entry);

        if (index === -1) {
            return null;
        }

        const path = [...columnPath(leaf.path), "p"];

        return markerTextLeaves(leaf, path, `t${index}`) ?? { key: leaf.key, path, group: `t${index}` };
    }, targets.map((node) => ({ node, into: [] })));
    const build = (escape: boolean): LineReplacement[] => targets.map((target) => ({
        first: lineStartAt(text, target.start),
        last:  lineEndAt(text, target.end - 1),
        lines: textLinesOf(target, "text").map((line) => (escape && !isBlank(line) ? escapeBlockStart(line, "") : line)),
        nodes: [target],
    }));

    return firstReadingEdit(analysis, build, expected, targets.map(() => null), true);
}
```

### `markdownSourceLines.ts` — `listOn`

Replace `listOn`
([:1212](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L1212))
and its JSDoc with the declarations below. They end right before the JSDoc
of `listSource`.

```typescript
/**
 * Turns selected lines into list items of `kind`: in each block, every
 * selected line that is not already the marker line of a `kind` item becomes
 * a new top-level item; the block's lines below the selection continue the
 * last new item, and its lines above the first new item stay where they are.
 * What the block's list item held after the block, up to the next list item,
 * becomes the blocks of the last new item. The new items of blocks with only
 * blank lines between them are one run ({@link adjoiningRuns}), written line
 * after line and joined to the list of `kind` next to them
 * ({@link readListJoin}).
 *
 * @param analysis - The document's analysis.
 * @param targets - The blocks the selection touches.
 * @param selected - The selected lines' starts.
 * @param kind - The list kind.
 * @returns The edit, or `null` when nothing changes or no form reads as intended.
 */
function listOn(analysis: SourceAnalysis, targets: readonly SourceBlockNode[], selected: ReadonlySet<number>, kind: "unordered" | "ordered"): MarkdownSourceEdit | null {
    const text = analysis.text;
    const plans: ListPlan[] = targets.map((target) => {
        const lines = nodeLines(text, target);
        const converted = lines.map((line) => selected.has(line.start) && !isMarkerLine(text, target, line.start, kind));

        return { target, lines, converted, first: converted.indexOf(true) };
    }).filter((plan) => plan.first !== -1);

    if (plans.length === 0) {
        return null;
    }

    const replacements = adjoiningRuns(text, plans).map((run) => itemReplacement(analysis, run, kind));

    return firstReadingEdit(analysis, () => replacements, expectedItemLeaves(analysis, plans, kind), replacements.map(() => null), false);
}

/** One block a list-on edit touches, with the lines of it that become items. */
interface ListPlan {
    readonly target:    SourceBlockNode;
    readonly lines:     SourceLine[];
    /** Per line of the block, whether it becomes a new item. */
    readonly converted: boolean[];
    /** The index of the first line that does. */
    readonly first:     number;
}

/** The lists of the kind that the new items of one run of a list-on edit join, and how the items are written. */
interface ListJoin {
    /** The list around the run's first block at the level the items land on; `null` for none. */
    readonly around:    SourceBlockNode | null;
    /** The list ending right above the run, blank lines aside; `null` for none. */
    readonly above:     SourceBlockNode | null;
    /** The list starting right below the run, written with the items' marker; `null` for none. */
    readonly below:     SourceBlockNode | null;
    readonly bullet:    string;
    readonly delimiter: string;
    /** The number the first new item of a numbered list takes. */
    readonly start:     number;
}

/**
 * The leaves a list-on edit's result must read as: every leaf of a converted
 * line in a new item of `kind` at its column's top level, one item per
 * converted line, the item made from a task item's marker line still a task
 * item; and what followed a block in its list items in the last item made
 * from that block ({@link pathAfterLifts}).
 *
 * @param analysis - The document's analysis.
 * @param plans - The touched blocks.
 * @param kind - The list kind.
 * @returns The expected leaves.
 */
function expectedItemLeaves(analysis: SourceAnalysis, plans: readonly ListPlan[], kind: "unordered" | "ordered"): ExpectedLeaf[] {
    const list = `list:${String(kind === "ordered")}`;
    /** The signature of the item made from a block's converted line: only the one from its first line carries the marker that line opens with. */
    const itemOf = (plan: ListPlan, line: number): string => (line === 0 && taskMarkerOf(plan.target) !== null ? itemSignature(plan.target.parent!) : "item:false:false");
    // What follows a block in its list items goes into the last item made from the block.
    const lifts = plans.map((plan) => ({ node: plan.target, into: [list, itemOf(plan, plan.converted.lastIndexOf(true))] }));

    return expectLeaves(readLeaves(analysis), (leaf) => {
        const index = plans.findIndex((plan) => firstEntryOf(plan.target) <= leaf.entry && leaf.entry < plan.target.entryEnd);

        if (index === -1) {
            return null;
        }

        const plan = plans[index]!;
        const line = plan.lines.findIndex((candidate) => candidate.start <= leaf.offset && leaf.offset <= candidate.end);
        const group = plan.converted.lastIndexOf(true, line);

        if (line < plan.first) {
            return null;
        }

        const path = [...columnPath(leaf.path), list, itemOf(plan, group)];

        return TASK_MARKER_LEAF.test(leaf.key)
            ? { key: leaf.key, path, group: `t${index}:${group}:marker` }
            : { key: leaf.key, path: [...path, "p"], group: `t${index}:${group}` };
    }, lifts);
}

/**
 * Groups the touched blocks into runs with only blank lines between them.
 * The items of one run stand line after line, as one tight list; two runs
 * have something between them that is no block to convert: items of the list
 * kind already, or a thematic break.
 *
 * @param text - The full document text.
 * @param plans - The touched blocks, in document order.
 * @returns The runs, in document order.
 */
function adjoiningRuns(text: string, plans: readonly ListPlan[]): ListPlan[][] {
    const runs: ListPlan[][] = [];

    for (const plan of plans) {
        const run = runs[runs.length - 1];
        const previous = run?.[run.length - 1];
        const from = previous === undefined ? 0 : previous.lines[previous.lines.length - 1]!.end + 1;
        const adjoins = previous !== undefined && isBlank(text.slice(from, Math.max(from, plan.lines[plan.first]!.start - 1)));

        if (run !== undefined && adjoins) {
            run.push(plan);
        } else {
            runs.push([plan]);
        }
    }

    return runs;
}

/**
 * Reads the lists of `kind` the new items of one run join, and the marker to
 * write them with: the marker of the list around the run's first block at
 * the level it lands on, else of the list right above the run, else of the
 * one right below, else `-` or `1.`. A list below that is written with
 * another marker stays a list of its own and is not joined. A numbered item
 * continues the list above it, or follows the number of the item it leaves
 * in the list around it.
 *
 * @param analysis - The document's analysis.
 * @param run - The run's blocks, in document order.
 * @param kind - The list kind.
 * @returns The join.
 */
function readListJoin(analysis: SourceAnalysis, run: readonly ListPlan[], kind: "unordered" | "ordered"): ListJoin {
    const first = run[0]!;
    const last = run[run.length - 1]!;
    const around = containingList(first.target, kind);
    const above = neighbourList(analysis, first.target, first.lines[first.first]!.start, -1, kind);
    const listBelow = neighbourList(analysis, last.target, last.lines[last.lines.length - 1]!.start, 1, kind);
    const styled = around ?? above ?? listBelow;
    const marker = styled === null ? { bullet: "-", delimiter: "." } : listMarkerOf(styled);
    const sameMarker = listBelow !== null && (kind === "unordered"
        ? listMarkerOf(listBelow).bullet === marker.bullet
        : listMarkerOf(listBelow).delimiter === marker.delimiter);
    const start = above !== null ? nextNumberOf(above) : around !== null ? numberAfterItemOf(first.target) : 1;

    return { around, above, below: sameMarker ? listBelow : null, ...marker, start };
}

/**
 * The number an item written right after a block's outermost list item
 * takes: that item's own number and one.
 *
 * @param target - The block.
 * @returns The number, `1` when the item's marker holds none.
 */
function numberAfterItemOf(target: SourceBlockNode): number {
    const marker = ITEM_MARKER.exec(liftedItems(target)[0]?.token?.raw ?? "")?.[2] ?? "";
    const number = Number.parseInt(marker, 10);

    return Number.isNaN(number) ? 1 : number + 1;
}

/**
 * The lines one run's replacement covers: the run's own, and the blank lines
 * between them and a list they join, so the items stand right against it —
 * left in, those lines would make a tight list loose. The blank lines stay
 * when a joined list is loose, since the result is loose either way, and
 * below the run inside the list around it unless that list's next item comes
 * right after them: what stands there otherwise is a block of the last new
 * item.
 *
 * @param text - The full document text.
 * @param run - The run's blocks, in document order.
 * @param join - The lists joined.
 * @returns The first replaced line's start and the last one's end.
 */
function replacedLines(text: string, run: readonly ListPlan[], join: ListJoin): { first: number; last: number } {
    const first = run[0]!;
    const last = run[run.length - 1]!;
    const firstLine = first.lines[first.first]!.start;
    const lastLine = last.lines[last.lines.length - 1]!;
    const tight = [join.around, join.above, join.below].every((list) => list === null || !(list.token as Tokens.List).loose);
    const textAbove = nearestTextLine(text, firstLine, -1);
    const textBelow = nearestTextLine(text, lastLine.start, 1);
    const joinsAbove = join.above !== null || join.around !== null;
    const itemFollows = join.around !== null && allNodes(join.around.children)
        .some((node) => node.type === "list_item" && node.start !== -1 && lineStartAt(text, node.start) === textBelow);
    const joinsBelow = join.below !== null || itemFollows;

    return {
        first: tight && joinsAbove && textAbove !== -1 ? lineEndAt(text, textAbove) + 1 : firstLine,
        last:  tight && joinsBelow && textBelow !== -1 ? textBelow - 1 : lastLine.end,
    };
}

/**
 * Writes one run's converted lines as items, in one replacement.
 *
 * @param analysis - The document's analysis.
 * @param run - The run's blocks, in document order.
 * @param kind - The list kind.
 * @returns The replacement.
 */
function itemReplacement(analysis: SourceAnalysis, run: readonly ListPlan[], kind: "unordered" | "ordered"): LineReplacement {
    const join = readListJoin(analysis, run, kind);
    let number = join.start;
    let follow = "";
    const lines = run.flatMap(({ target, converted, first }) => textLinesOf(target, "written").slice(first).map((line, offset) => {
        if (!converted[first + offset]!) {
            return line;
        }

        const marker = kind === "unordered" ? join.bullet : `${number}${join.delimiter}`;

        number += 1;
        // What the block's item holds after it goes into the last new item, at the column that item's text starts at.
        follow = " ".repeat(marker.length + 1);

        return `${marker} ${line.trimStart()}`;
    }));

    return { ...replacedLines(analysis.text, run, join), lines, nodes: run.map((plan) => plan.target), follow };
}

/**
 * The signature of a list item, as the analysis writes it.
 *
 * @param item - The list item.
 * @returns The signature.
 */
function itemSignature(item: SourceBlockNode): string {
    const token = item.token as Tokens.ListItem;

    return `item:${String(token.task)}:${String(token.checked ?? false)}`;
}

/**
 * The nearest `:::` column around a block.
 *
 * @param node - The block.
 * @returns The column, `null` at the top level.
 */
function columnOf(node: SourceBlockNode): SourceBlockNode | null {
    for (let parent = node.parent; parent !== null; parent = parent.parent) {
        if (parent.type === "column") {
            return parent;
        }
    }

    return null;
}

/**
 * The list of `kind` a new item joins on one side: the list standing at the
 * level the item lands on (the top level, or the block's column) whose last
 * line (above) or first line (below) is the nearest line that is not blank.
 * A list holding the block is not a neighbour: the lift splits it.
 *
 * @param analysis - The document's analysis.
 * @param target - The block becoming an item.
 * @param lineStart - The start of the block's first (above) or last (below) written line.
 * @param direction - `-1` to look above, `1` below.
 * @param kind - The list kind.
 * @returns The list, or `null`.
 */
function neighbourList(
    analysis: SourceAnalysis, target: SourceBlockNode, lineStart: number, direction: -1 | 1, kind: "unordered" | "ordered",
): SourceBlockNode | null {
    const text = analysis.text;
    const at = nearestTextLine(text, lineStart, direction);
    const column = columnOf(target);
    const found = at === -1 ? undefined : allNodes(analysis.tree).find((node) => node.type === "list" && node.start !== -1
        && (node.parent === null || node.parent.type === "column") && columnOf(node) === column
        && lineStartAt(text, direction === -1 ? node.end - 1 : node.start) === at);

    if (found === undefined || (found.token as Tokens.List).ordered !== (kind === "ordered") || isAncestor(found, target)) {
        return null;
    }

    return found;
}

/**
 * The start of the nearest line above or below a line that is not blank.
 *
 * @param text - The full document text.
 * @param lineStart - The line's start.
 * @param direction - `-1` to look above, `1` below.
 * @returns The line's start, `-1` when every line that way is blank.
 */
function nearestTextLine(text: string, lineStart: number, direction: -1 | 1): number {
    let at = lineStart;

    do {
        const end = lineEndAt(text, at);

        at = direction === -1 ? (at === 0 ? -1 : lineStartAt(text, at - 1)) : (end >= text.length ? -1 : end + 1);
    } while (at !== -1 && isBlank(text.slice(at, lineEndAt(text, at))));

    return at;
}

/**
 * The list of `kind` holding a block at the level the block lands on when
 * lifted: its outermost list, when that list is of `kind`.
 *
 * @param target - The block.
 * @param kind - The list kind.
 * @returns The list, or `null`.
 */
function containingList(target: SourceBlockNode, kind: "unordered" | "ordered"): SourceBlockNode | null {
    for (let parent = target.parent; parent !== null; parent = parent.parent) {
        if (parent.type === "list" && (parent.parent === null || parent.parent.type === "column")) {
            return (parent.token as Tokens.List).ordered === (kind === "ordered") ? parent : null;
        }
    }

    return null;
}

/**
 * A list's bullet character and numbered delimiter, read from its first item.
 *
 * @param list - The list.
 * @returns The bullet (`-` for a numbered list) and the delimiter (`.` for a bulleted one).
 */
function listMarkerOf(list: SourceBlockNode): { bullet: string; delimiter: string } {
    const marker = ITEM_MARKER.exec((list.token as Tokens.List).items[0]!.raw)?.[2] ?? "-";

    return { bullet: /^[-+*]$/.test(marker) ? marker : "-", delimiter: marker.endsWith(")") ? ")" : "." };
}

/**
 * The number the item after a numbered list's last takes.
 *
 * @param list - The numbered list.
 * @returns The number.
 */
function nextNumberOf(list: SourceBlockNode): number {
    const token = list.token as Tokens.List;

    return Number(token.start) + token.items.length;
}
```

How the join decides, with the marker and the blank lines it gives:

| Document | New item from | Toggle | Source mode writes | Why |
|---|---|---|---|---|
| `* one ⏎ * two ⏎⏎ three` | `three` | bulleted | `* one ⏎ * two ⏎ * three` | joins the tight list above: its marker, no blank line |
| `1) a ⏎ 2) b ⏎⏎ mid` | `mid` | numbered | `1) a ⏎ 2) b ⏎ 3) mid` | its delimiter, the next number |
| `zero ⏎⏎ - one ⏎ - two` | `zero` | bulleted | `- zero ⏎ - one ⏎ - two` | joins the tight list below |
| `- a ⏎ - b ⏎⏎ mid ⏎⏎ - c ⏎⏎ - d` | `mid` | bulleted | `- a ⏎ - b ⏎⏎ - mid ⏎⏎ - c ⏎⏎ - d` | a joined list is loose, so the result is loose and the blank lines stay |
| `* a ⏎ * b ⏎⏎ mid ⏎⏎ - c ⏎⏎ - d` | `mid` | bulleted | `* a ⏎ * b ⏎ * mid ⏎⏎ - c ⏎⏎ - d` | the list below is written with another marker, so it is not joined |
| `- one ⏎ - two ⏎⏎ three` | `three` | numbered | `- one ⏎ - two ⏎⏎ 1. three` | no numbered list to join: nothing is removed |
| `zero ⏎⏎ * one ⏎ * two ⏎⏎ three` | `zero`, `three` | bulleted | `* zero ⏎ * one ⏎ * two ⏎ * three` | two runs, the list between them: each joins it |
| `- one ⏎   - inner ⏎⏎     para ⏎⏎   - last ⏎ - two` | `para` | bulleted | `- one ⏎   - inner ⏎ - para ⏎ - - last ⏎ - two` | the list around the block is tight: the blank lines on both sides go |
| `- one ⏎⏎   second ⏎⏎   third ⏎⏎ - two` | `second` | bulleted | `- one ⏎⏎ - second ⏎⏎   third ⏎⏎ - two` | the list around is loose; and `third`, the tail, is no list item, so nothing is removed below |
| `9. one ⏎⏎    second` | `second` | numbered | `9. one ⏎⏎ 10. second` | the number after the item it leaves |

---

## Ordered Implementation Steps

Work test-first: steps 2–5 write failing tests, steps 6–9 make them pass.
Run commands from `packages/lib`.

1. **Check the base.** `ls ../../plans/implemented/ | grep -E 'markdown-editor-(list-item-node|paste-undo-merge)\.md'`
   must print both plans, and
   `grep -n 'export function \$liftItemOut' src/typescript/lib/component/editor/markdownListItemNode.ts`
   must print one line. If either fails, stop: the plan needs that code.
2. **`tests/component/markdown-list-item-node.test.ts`.** Add `$splitItemBefore`
   to the import from `markdownListItemNode` and add row `S26` (see *Expected
   Behaviour › Node row*). Run the file: `S26` fails, 27 tests pass.
3. **`tests/component/markdown-editor-list-item-edits.test.ts`.** Restate
   rows `H4`, `H5`, `H6` and add rows `H9` to `H24` (*Expected Behaviour ›
   WYSIWYG rows*). Run the file: exactly 14 tests fail — `H4`, `H5`, `H6`,
   `H9`, `H11`, `H13`, `H14`, `H15`, `H17`, `H18`, `H19`, `H20`, `H23`,
   `H24`. Rows `H10`, `H12`, `H16`, `H21` and `H22` pass: they pin results
   the WYSIWYG surface already gives.
4. **`tests/component/markdown-editor.test.ts`.** Make the four changes of
   *Expected Behaviour*: restate two `CASES` rows; add the parity tables and
   their two loops; restate two source-mode rows and add nine; add six
   availability rows. Run the file: exactly 181 tests fail — 157 `SAME`
   rows, 8 `DIFFERS` rows, the 2 restated `CASES` rows, 9 source-mode rows,
   and the "every command reported available there applies" test of 5
   availability rows. The rows that pass are named in *Expected Behaviour*.
5. **`tests/component/markdown-source-edits.test.ts`.** Restate the two
   tests of *Existing tests that change*. Run the file: those 2 fail.
6. **`markdownListItemNode.ts`.** Add `$splitItemBefore`. Check: the file of
   step 2 passes.
7. **`markdownSerializer.ts`.** Add the `inListItem` parameter to
   `$serializeInlineNodes`. Check: `npm run typecheck`.
8. **`MarkdownEditor.ts`.** Make the changes of *Internal Structure ›
   `MarkdownEditor.ts`*, and the JSDoc of `toggleUnorderedList`,
   `toggleOrderedList` and `setBlockType` from *Documentation Impact*. Check:
   - `grep -n 'INSERT_UNORDERED_LIST_COMMAND\|INSERT_ORDERED_LIST_COMMAND\|\$convertListOfEmptyItem\|\$selectionLiesInListOfType' src/typescript/lib/component/editor/MarkdownEditor.ts`
     — zero matches.
   - The files of steps 2 and 3 pass.
   - The file of step 4 has exactly 139 failures: 126 `SAME` rows, the
     `DIFFERS` rows `Q2 UL`, `Q2 OL`, `E5 code` and `E15 OL`, and 9
     source-mode rows. The file of step 5 still has 2.
9. **`markdownSourceLines.ts`.** Make the changes of the three *Internal
   Structure* sections for this file, top to bottom, and the JSDoc and
   comment changes of *Documentation Impact*. Check:
   - `grep -n 'blockTextLines(' src/typescript/lib/component/editor/markdownSourceLines.ts`
     — two matches: the function itself and the call in `textLinesOf`.
   - `grep -n 'closed\.add\|closed\.has(' src/typescript/lib/component/editor/markdownSourceLines.ts`
     — zero matches.
   - The four test files of steps 2–5 pass.
10. **Run the Markdown tests:**
    `npx vitest run tests/component/markdown-roundtrip tests/component/markdown-editor.test.ts tests/component/markdown-source-edits.test.ts tests/component/markdown-editor-list-item-edits.test.ts tests/component/markdown-editor-list-item-paste.test.ts tests/component/markdown-list-item-node.test.ts tests/component/markdown-list-item-node-html.test.ts tests/component/markdown-editor-columns.test.ts tests/component/markdown-editor-command-crashes.test.ts tests/component/markdown-editor-history.test.ts tests/component/markdown-document-panel.test.ts tests/component/markdown-serializer.test.ts tests/component/markdown-importer.test.ts tests/component/markdown-source-preservation.test.ts tests/component/markdown-editor-table-edge.test.ts tests/component/markdown-editor-table-cells-paste.test.ts`.
    All pass. No test outside *Existing tests that change* may need a new
    expected value.
11. **Update the docs and the changelog** as *Documentation Impact* gives
    them.
12. **Run the checks** of *Verification*: the commands, the differential
    check against the parent, then the manual cases.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-list-item-edits.test.ts` |
| Modify | `packages/lib/tests/component/markdown-list-item-node.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-edits.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

No file is created or deleted.

---

## Expected Behaviour

Everything in the first six subsections is **testable offline**, in the
headless editor under the modelled DOM. The last subsection lists what
**needs manual verification** in a browser.

### Parity rows (`markdown-editor.test.ts`)

In `describe('MarkdownEditor list toggles in a list of their kind')`
([:716](../packages/lib/tests/component/markdown-editor.test.ts#L716)), add
the code of this subsection after the test "source mode takes the same items
out of the same lists…"
([:836](../packages/lib/tests/component/markdown-editor.test.ts#L836)),
inside the `describe`. That test stays as it is and keeps passing. The code
uses the `describe`'s own `editorOf`, `unordered` and `ordered`, and the
file's `lexicalOf`, `codeEditorOf`, `canonicalSave`, `editorSurfaceModel`
and `viewerModel`, all imported already.

First the helpers:

```typescript
/** A command a parity row runs, on either surface. */
type ParityCommand = 'UL' | 'OL' | 'paragraph' | 'h2' | 'quote' | 'code';

const PARITY_COMMANDS: Record<ParityCommand, (editor: MarkdownEditor) => unknown> = {
    UL:        unordered,
    OL:        ordered,
    paragraph: (editor) => editor.setBlockType('paragraph'),
    h2:        (editor) => editor.setBlockType('h2'),
    quote:     (editor) => editor.setBlockType('quote'),
    code:      (editor) => editor.setBlockType('code'),
};

/** [id, document, word the selection starts in, word it ends in (null: a caret), command, what the WYSIWYG surface saves, what source mode leaves] */
type ParityRow = [id: string, doc: string, from: string, to: string | null, command: ParityCommand, wysiwyg: string, source: string];

/** Selects from one character into the word `from` to one character into the word `to`, each in the first text node holding it. */
function selectWords(editor: MarkdownEditor, from: string, to: string): void {
    lexicalOf(editor).update(() => {
        const holding = (word: string): TextNode => $getRoot().getAllTextNodes().find((node) => node.getTextContent().includes(word))!;
        const offsetIn = (word: string): number => holding(word).getTextContent().indexOf(word) + 1;
        const selection = holding(from).select(offsetIn(from), offsetIn(from));

        selection.focus.set(holding(to).getKey(), offsetIn(to), 'text');
    }, { discrete: true });
}

/** Runs a row's command on the WYSIWYG surface, on the row's selection. */
function wysiwygAfter([, doc, from, to, command]: ParityRow): MarkdownEditor {
    const editor = editorOf(doc);

    selectWords(editor, from, to ?? from);
    PARITY_COMMANDS[command](editor);

    return editor;
}

/** Runs a row's command in source mode, on the same selection, and returns the text it leaves. */
function sourceAfter([, doc, from, to, command]: ParityRow): string {
    const editor = new MarkdownEditor(doc, { mode: 'source' });
    const ends = [doc.indexOf(from) + 1, doc.indexOf(to ?? from) + 1];
    const selection = { characterCount: 0, lineCount: 1, from: Math.min(...ends), to: Math.max(...ends) };

    vi.spyOn(codeEditorOf(editor), 'getSelection').mockReturnValue(selection);
    PARITY_COMMANDS[command](editor);

    return editor.getValue();
}
```

**Selection.** `from` and `to` are words of the document (`to` is `from`
when `null`). On the WYSIWYG surface the selection runs from one character
into `from` to one character into `to`. In source mode it runs between the
same two places in the text, which is what the existing both-surfaces test
does.

Then the rows. `SAME` — 182 rows. Copy exactly:

```typescript
const SAME: ParityRow[] = [
    ['B1', '- one\n- two\n- three', 'two', null, 'UL', '- one\n\ntwo\n\n- three', '- one\n\ntwo\n\n- three'],
    ['B1', '- one\n- two\n- three', 'two', null, 'OL', '- one\n\n1. two\n\n- three', '- one\n1. two\n- three'],
    ['B2', '- one\n- two\n- three', 'one', 'two', 'UL', 'one\n\ntwo\n\n- three', 'one\n\ntwo\n\n- three'],
    ['B2', '- one\n- two\n- three', 'one', 'two', 'OL', '1. one\n2. two\n\n- three', '1. one\n2. two\n- three'],
    ['B3', '- one\n- two\n- three', 'one', 'three', 'UL', 'one\n\ntwo\n\nthree', 'one\n\ntwo\n\nthree'],
    ['B3', '- one\n- two\n- three', 'one', 'three', 'OL', '1. one\n2. two\n3. three', '1. one\n2. two\n3. three'],
    ['N1', '1. one\n2. two\n3. three', 'two', null, 'UL', '1. one\n\n- two\n\n1. three', '1. one\n- two\n3. three'],
    ['N1', '1. one\n2. two\n3. three', 'two', null, 'OL', '1. one\n\ntwo\n\n1. three', '1. one\n\ntwo\n\n3. three'],
    ['T1', '- [ ] one\n- [x] two', 'one', null, 'UL', '\\[ \\] one\n\n- [x] two', '\\[ \\] one\n- [x] two'],
    ['T1', '- [ ] one\n- [x] two', 'one', null, 'OL', '1. [ ] one\n\n- [x] two', '1. [ ] one\n- [x] two'],
    ['T1', '- [ ] one\n- [x] two', 'one', null, 'paragraph', '\\[ \\] one\n\n- [x] two', '\\[ \\] one\n- [x] two'],
    ['T1', '- [ ] one\n- [x] two', 'one', null, 'h2', '## \\[ \\] one\n\n- [x] two', '## \\[ \\] one\n- [x] two'],
    ['T1', '- [ ] one\n- [x] two', 'one', null, 'quote', '> \\[ \\] one\n\n- [x] two', '> \\[ \\] one\n- [x] two'],
    ['T1', '- [ ] one\n- [x] two', 'one', null, 'code', '```\n[ ] one\n```\n\n- [x] two', '```\n[ ] one\n```\n- [x] two'],
    ['T2', '- [ ] one\n- [x] two', 'two', null, 'UL', '- [ ] one\n\n\\[x\\] two', '- [ ] one\n\n\\[x\\] two'],
    ['T2', '- [ ] one\n- [x] two', 'two', null, 'OL', '- [ ] one\n\n1. [x] two', '- [ ] one\n1. [x] two'],
    ['T3', '- [ ] one\n- [x] two', 'one', 'two', 'UL', '\\[ \\] one\n\n\\[x\\] two', '\\[ \\] one\n\n\\[x\\] two'],
    ['T3', '- [ ] one\n- [x] two', 'one', 'two', 'OL', '1. [ ] one\n2. [x] two', '1. [ ] one\n2. [x] two'],
    ['T3', '- [ ] one\n- [x] two', 'one', 'two', 'paragraph', '\\[ \\] one\n\n\\[x\\] two', '\\[ \\] one\n\n\\[x\\] two'],
    ['T3', '- [ ] one\n- [x] two', 'one', 'two', 'h2', '## \\[ \\] one\n\n## \\[x\\] two', '## \\[ \\] one\n## \\[x\\] two'],
    ['T3', '- [ ] one\n- [x] two', 'one', 'two', 'quote', '> \\[ \\] one\n\n> \\[x\\] two', '> \\[ \\] one\n\n> \\[x\\] two'],
    ['T4', '1. [ ] one\n2. [x] two', 'one', null, 'UL', '- [ ] one\n\n1. [x] two', '- [ ] one\n2. [x] two'],
    ['T4', '1. [ ] one\n2. [x] two', 'one', null, 'OL', '\\[ \\] one\n\n1. [x] two', '\\[ \\] one\n\n2. [x] two'],
    ['T5', '- [ ] one\n- two\n- three', 'one', 'two', 'UL', '\\[ \\] one\n\ntwo\n\n- three', '\\[ \\] one\n\ntwo\n\n- three'],
    ['T5', '- [ ] one\n- two\n- three', 'one', 'two', 'OL', '1. [ ] one\n2. two\n\n- three', '1. [ ] one\n2. two\n- three'],
    ['T6', '- [ ] one\n- two\n- three', 'two', null, 'UL', '- [ ] one\n\ntwo\n\n- three', '- [ ] one\n\ntwo\n\n- three'],
    ['T6', '- [ ] one\n- two\n- three', 'two', null, 'OL', '- [ ] one\n\n1. two\n\n- three', '- [ ] one\n1. two\n- three'],
    ['T7', '- [ ] one\n\n- [x] two\n\n- three', 'two', null, 'UL', '- [ ] one\n\n\\[x\\] two\n\n- three', '- [ ] one\n\n\\[x\\] two\n\n- three'],
    ['T7', '- [ ] one\n\n- [x] two\n\n- three', 'two', null, 'OL', '- [ ] one\n\n1. [x] two\n\n- three', '- [ ] one\n\n1. [x] two\n\n- three'],
    ['T7', '- [ ] one\n\n- [x] two\n\n- three', 'two', null, 'paragraph', '- [ ] one\n\n\\[x\\] two\n\n- three', '- [ ] one\n\n\\[x\\] two\n\n- three'],
    ['T8', '- one\n  - [ ] inner\n- three', 'inner', null, 'UL', '- one\n\n\\[ \\] inner\n\n- three', '- one\n\n\\[ \\] inner\n\n- three'],
    ['T8', '- one\n  - [ ] inner\n- three', 'inner', null, 'OL', '- one\n\n1. [ ] inner\n\n- three', '- one\n1. [ ] inner\n- three'],
    ['T9', '- [ ] one\n  - inner\n- three', 'one', null, 'UL', '\\[ \\] one\n\n- - inner\n- three', '\\[ \\] one\n- - inner\n- three'],
    ['T9', '- [ ] one\n  - inner\n- three', 'one', null, 'OL', '1. [ ] one\n\n- - inner\n- three', '1. [ ] one\n- - inner\n- three'],
    ['T10', '- [x] one\n- two\n\n[x]: /url', 'one', null, 'UL', '\\[x\\] one\n\n- two\n\n[x]: /url', '\\[x\\] one\n- two\n\n[x]: /url'],
    ['T10', '- [x] one\n- two\n\n[x]: /url', 'one', null, 'OL', '1. \\[x\\] one\n\n- two\n\n[x]: /url', '1. [x] one\n- two\n\n[x]: /url'],
    ['T10', '- [x] one\n- two\n\n[x]: /url', 'one', null, 'paragraph', '\\[x\\] one\n\n- two\n\n[x]: /url', '\\[x\\] one\n- two\n\n[x]: /url'],
    ['T11', '- [ ] **one** two\n- three', 'one', null, 'UL', '\\[ \\] **one** two\n\n- three', '\\[ \\] **one** two\n- three'],
    ['T11', '- [ ] **one** two\n- three', 'one', null, 'OL', '1. [ ] **one** two\n\n- three', '1. [ ] **one** two\n- three'],
    ['T12', '::: columns\n- [ ] one\n- two\n|||\nRight\n:::', 'one', null, 'UL', '::: columns\n\\[ \\] one\n\n- two\n|||\nRight\n:::', '::: columns\n\\[ \\] one\n- two\n|||\nRight\n:::'],
    ['T12', '::: columns\n- [ ] one\n- two\n|||\nRight\n:::', 'one', null, 'OL', '::: columns\n1. [ ] one\n\n- two\n|||\nRight\n:::', '::: columns\n1. [ ] one\n- two\n|||\nRight\n:::'],
    ['T13', 'zero\n\n- [ ] one\n- two', 'zero', 'one', 'UL', '- zero\n- [ ] one\n- two', '- zero\n- [ ] one\n- two'],
    ['T13', 'zero\n\n- [ ] one\n- two', 'zero', 'one', 'OL', '1. zero\n2. [ ] one\n\n- two', '1. zero\n2. [ ] one\n- two'],
    ['T14', '- [ ] one\n\n  second\n\n- [x] two', 'one', null, 'UL', '\\[ \\] one\n\nsecond\n\n- [x] two', '\\[ \\] one\n\nsecond\n\n- [x] two'],
    ['T14', '- [ ] one\n\n  second\n\n- [x] two', 'one', null, 'OL', '1. [ ] one\n\n   second\n\n- [x] two', '1. [ ] one\n\n   second\n\n- [x] two'],
    ['T14', '- [ ] one\n\n  second\n\n- [x] two', 'one', null, 'h2', '## \\[ \\] one\n\nsecond\n\n- [x] two', '## \\[ \\] one\n\nsecond\n\n- [x] two'],
    ['T14', '- [ ] one\n\n  second\n\n- [x] two', 'one', null, 'code', '```\n[ ] one\n```\n\nsecond\n\n- [x] two', '```\n[ ] one\n```\n\nsecond\n\n- [x] two'],
    ['T15', '- [ ] one\n\n  second\n\n- [x] two', 'second', null, 'UL', '- [ ] one\n\n- second\n\n- [x] two', '- [ ] one\n\n- second\n\n- [x] two'],
    ['T15', '- [ ] one\n\n  second\n\n- [x] two', 'second', null, 'OL', '- [ ] one\n\n1. second\n\n- [x] two', '- [ ] one\n\n1. second\n\n- [x] two'],
    ['T16', '- [x] one\n  - [ ] inner\n- two', 'one', null, 'UL', '\\[x\\] one\n\n- - [ ] inner\n- two', '\\[x\\] one\n- - [ ] inner\n- two'],
    ['T16', '- [x] one\n  - [ ] inner\n- two', 'one', null, 'OL', '1. [x] one\n\n- - [ ] inner\n- two', '1. [x] one\n- - [ ] inner\n- two'],
    ['T17', '1. [ ] one\n2. [x] two\n3. three', 'two', null, 'UL', '1. [ ] one\n\n- [x] two\n\n1. three', '1. [ ] one\n- [x] two\n3. three'],
    ['T17', '1. [ ] one\n2. [x] two\n3. three', 'two', null, 'OL', '1. [ ] one\n\n\\[x\\] two\n\n1. three', '1. [ ] one\n\n\\[x\\] two\n\n3. three'],
    ['T18', '- one\n- [ ] two\n\n1. three\n2. [x] four', 'two', 'four', 'UL', '- one\n- [ ] two\n- three\n- [x] four', '- one\n- [ ] two\n- three\n- [x] four'],
    ['T18', '- one\n- [ ] two\n\n1. three\n2. [x] four', 'two', 'four', 'OL', '- one\n\n1. [ ] two\n2. three\n3. [x] four', '- one\n1. [ ] two\n1. three\n2. [x] four'],
    ['X1', '- one\n- two\n\n1. three\n2. four', 'two', 'three', 'UL', '- one\n- two\n- three\n\n1. four', '- one\n- two\n- three\n2. four'],
    ['X1', '- one\n- two\n\n1. three\n2. four', 'two', 'three', 'OL', '- one\n\n1. two\n2. three\n3. four', '- one\n1. two\n1. three\n2. four'],
    ['X2', '- one\n- two\n\nthree', 'two', 'three', 'UL', '- one\n- two\n- three', '- one\n- two\n- three'],
    ['X2', '- one\n- two\n\nthree', 'two', 'three', 'OL', '- one\n\n1. two\n2. three', '- one\n1. two\n2. three'],
    ['X3', '- one\n- two\n\nthree', 'three', null, 'UL', '- one\n- two\n- three', '- one\n- two\n- three'],
    ['X3', '- one\n- two\n\nthree', 'three', null, 'OL', '- one\n- two\n\n1. three', '- one\n- two\n\n1. three'],
    ['X4', 'zero\n\n- one\n- two', 'zero', null, 'UL', '- zero\n- one\n- two', '- zero\n- one\n- two'],
    ['X4', 'zero\n\n- one\n- two', 'zero', null, 'OL', '1. zero\n\n- one\n- two', '1. zero\n\n- one\n- two'],
    ['X5', '- one\n\nmid\n\n- two', 'mid', null, 'UL', '- one\n- mid\n- two', '- one\n- mid\n- two'],
    ['X5', '- one\n\nmid\n\n- two', 'mid', null, 'OL', '- one\n\n1. mid\n\n- two', '- one\n\n1. mid\n\n- two'],
    ['X6', '* one\n* two\n\nthree', 'three', null, 'UL', '* one\n* two\n* three', '* one\n* two\n* three'],
    ['X6', '* one\n* two\n\nthree', 'three', null, 'OL', '* one\n* two\n\n1. three', '* one\n* two\n\n1. three'],
    ['X7', 'one\n\ntwo', 'one', 'two', 'UL', '- one\n- two', '- one\n- two'],
    ['X7', 'one\n\ntwo', 'one', 'two', 'OL', '1. one\n2. two', '1. one\n2. two'],
    ['X8', '1. one\n2. two\n\nthree', 'three', null, 'UL', '1. one\n2. two\n\n- three', '1. one\n2. two\n\n- three'],
    ['X8', '1. one\n2. two\n\nthree', 'three', null, 'OL', '1. one\n2. two\n3. three', '1. one\n2. two\n3. three'],
    ['X9', 'zero\n\n* one\n* two\n\nthree', 'zero', 'three', 'UL', '* zero\n* one\n* two\n* three', '* zero\n* one\n* two\n* three'],
    ['X9', 'zero\n\n* one\n* two\n\nthree', 'zero', 'three', 'OL', '1. zero\n2. one\n3. two\n4. three', '1. zero\n2. one\n3. two\n4. three'],
    ['X10', '- one\n\npara\n\n1. three', 'one', 'three', 'UL', '- one\n- para\n- three', '- one\n- para\n- three'],
    ['X10', '- one\n\npara\n\n1. three', 'one', 'three', 'OL', '1. one\n2. para\n3. three', '1. one\n2. para\n1. three'],
    ['X11', '- one\n  - inner\n\n    para\n\n  - last\n- two', 'para', null, 'UL', '- one\n  - inner\n- para\n- - last\n- two', '- one\n  - inner\n- para\n- - last\n- two'],
    ['X11', '- one\n  - inner\n\n    para\n\n  - last\n- two', 'para', null, 'OL', '- one\n  - inner\n\n1. para\n\n- - last\n- two', '- one\n  - inner\n\n1. para\n\n- - last\n- two'],
    ['X12', '# head\n\n> quoted\n\npara', 'head', 'para', 'UL', '- head\n- quoted\n- para', '- head\n- quoted\n- para'],
    ['X12', '# head\n\n> quoted\n\npara', 'head', 'para', 'OL', '1. head\n2. quoted\n3. para', '1. head\n2. quoted\n3. para'],
    ['X13', '1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. i\n\nten', 'ten', null, 'OL', '1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. i\n10. ten', '1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. i\n10. ten'],
    ['X14', '1) a\n2) b\n\nmid', 'mid', null, 'OL', '1) a\n2) b\n3) mid', '1) a\n2) b\n3) mid'],
    ['X15', '* a\n* b\n\nmid\n\n- c\n\n- d', 'mid', null, 'UL', '* a\n* b\n* mid\n\n- c\n\n- d', '* a\n* b\n* mid\n\n- c\n\n- d'],
    ['X16', '- a\n- b\n\nmid\n\n- c\n\n- d', 'mid', null, 'UL', '- a\n\n- b\n\n- mid\n\n- c\n\n- d', '- a\n- b\n\n- mid\n\n- c\n\n- d'],
    ['X17', '* one\n\n1. two\n2. three\n3. four', 'one', 'three', 'UL', '* one\n* two\n* three\n\n1. four', '* one\n* two\n* three\n3. four'],
    ['X18', 'one\n\ntwo\n\n* three', 'one', 'two', 'UL', '* one\n* two\n* three', '* one\n* two\n* three'],
    ['X19', 'zero\n\n- one\n\n- two', 'zero', null, 'UL', '- zero\n\n- one\n\n- two', '- zero\n\n- one\n\n- two'],
    ['X20', '1. one\n\ntwo\n\nthree\n\n1) four', 'two', 'three', 'OL', '1. one\n2. two\n3. three\n\n1) four', '1. one\n2. two\n3. three\n\n1) four'],
    ['S1', '- one\n  - inner\n- three', 'inner', null, 'UL', '- one\n\ninner\n\n- three', '- one\n\ninner\n\n- three'],
    ['S1', '- one\n  - inner\n- three', 'inner', null, 'OL', '- one\n\n1. inner\n\n- three', '- one\n1. inner\n- three'],
    ['S2', '- one\n  - inner\n- three', 'one', null, 'UL', 'one\n\n- - inner\n- three', 'one\n- - inner\n- three'],
    ['S2', '- one\n  - inner\n- three', 'one', null, 'OL', '1. one\n\n- - inner\n- three', '1. one\n- - inner\n- three'],
    ['S3', '- one\n  - inner\n- three', 'one', 'inner', 'UL', 'one\n\ninner\n\n- three', 'one\n\ninner\n\n- three'],
    ['S3', '- one\n  - inner\n- three', 'one', 'inner', 'OL', '1. one\n2. inner\n\n- three', '1. one\n2. inner\n- three'],
    ['S4', '- one\n  1. inner\n- three', 'inner', null, 'UL', '- one\n- inner\n- three', '- one\n- inner\n- three'],
    ['S4', '- one\n  1. inner\n- three', 'inner', null, 'OL', '- one\n\ninner\n\n- three', '- one\n\ninner\n\n- three'],
    ['S5', '- one\n  - a\n  - b\n- three', 'a', null, 'UL', '- one\n\na\n\n- - b\n- three', '- one\n\na\n\n- - b\n- three'],
    ['S5', '- one\n  - a\n  - b\n- three', 'a', null, 'OL', '- one\n\n1. a\n\n- - b\n- three', '- one\n1. a\n- - b\n- three'],
    ['S6', '- o\n  - m\n    - x\n      - n\n    - y\n  - k', 'x', null, 'UL', '- o\n  - m\n\nx\n\n- - n\n  - y\n  - k', '- o\n  - m\n\nx\n\n- - n\n  - y\n  - k'],
    ['S6', '- o\n  - m\n    - x\n      - n\n    - y\n  - k', 'x', null, 'OL', '- o\n  - m\n\n1. x\n\n- - n\n  - y\n  - k', '- o\n  - m\n1. x\n- - n\n  - y\n  - k'],
    ['L1', '- one\n\n- two\n\n- three', 'two', null, 'UL', '- one\n\ntwo\n\n- three', '- one\n\ntwo\n\n- three'],
    ['L1', '- one\n\n- two\n\n- three', 'two', null, 'OL', '- one\n\n1. two\n\n- three', '- one\n\n1. two\n\n- three'],
    ['L2', '- one\n\n- two', 'one', 'two', 'UL', 'one\n\ntwo', 'one\n\ntwo'],
    ['L2', '- one\n\n- two', 'one', 'two', 'OL', '1. one\n2. two', '1. one\n2. two'],
    ['M1', '- one\n\n  second\n\n- two', 'one', null, 'UL', 'one\n\nsecond\n\n- two', 'one\n\nsecond\n\n- two'],
    ['M1', '- one\n\n  second\n\n- two', 'one', null, 'OL', '1. one\n\n   second\n\n- two', '1. one\n\n   second\n\n- two'],
    ['M1', '- one\n\n  second\n\n- two', 'one', null, 'paragraph', 'one\n\nsecond\n\n- two', 'one\n\nsecond\n\n- two'],
    ['M1', '- one\n\n  second\n\n- two', 'one', null, 'h2', '## one\n\nsecond\n\n- two', '## one\n\nsecond\n\n- two'],
    ['M1', '- one\n\n  second\n\n- two', 'one', null, 'quote', '> one\n\nsecond\n\n- two', '> one\n\nsecond\n\n- two'],
    ['M1', '- one\n\n  second\n\n- two', 'one', null, 'code', '```\none\n```\n\nsecond\n\n- two', '```\none\n```\n\nsecond\n\n- two'],
    ['M2', '- one\n\n  second\n\n- two', 'second', null, 'UL', '- one\n\n- second\n\n- two', '- one\n\n- second\n\n- two'],
    ['M2', '- one\n\n  second\n\n- two', 'second', null, 'OL', '- one\n\n1. second\n\n- two', '- one\n\n1. second\n\n- two'],
    ['M3', '- one\n\n  second\n\n- two', 'one', 'second', 'UL', '- one\n\n- second\n\n- two', '- one\n\n- second\n\n- two'],
    ['M3', '- one\n\n  second\n\n- two', 'one', 'second', 'OL', '1. one\n2. second\n\n- two', '1. one\n2. second\n\n- two'],
    ['M3', '- one\n\n  second\n\n- two', 'one', 'second', 'h2', '## one\n\n## second\n\n- two', '## one\n\n## second\n\n- two'],
    ['M4', '- one\n\n  second\n\n- two', 'second', 'two', 'UL', '- one\n\n- second\n\n- two', '- one\n\n- second\n\n- two'],
    ['M4', '- one\n\n  second\n\n- two', 'second', 'two', 'OL', '- one\n\n1. second\n2. two', '- one\n\n1. second\n2. two'],
    ['M5', '- one\n\n  second\n\n- two', 'one', 'two', 'UL', '- one\n\n- second\n\n- two', '- one\n\n- second\n\n- two'],
    ['M5', '- one\n\n  second\n\n- two', 'one', 'two', 'OL', '1. one\n2. second\n3. two', '1. one\n2. second\n3. two'],
    ['M6', '- one\n\n  second\n\n  third\n\n- two', 'second', null, 'UL', '- one\n\n- second\n\n  third\n\n- two', '- one\n\n- second\n\n  third\n\n- two'],
    ['M6', '- one\n\n  second\n\n  third\n\n- two', 'second', null, 'OL', '- one\n\n1. second\n\n   third\n\n- two', '- one\n\n1. second\n\n   third\n\n- two'],
    ['M7', '- one\n\n  second\n\n  third\n\n- two', 'one', null, 'UL', 'one\n\nsecond\n\nthird\n\n- two', 'one\n\nsecond\n\nthird\n\n- two'],
    ['M7', '- one\n\n  second\n\n  third\n\n- two', 'one', null, 'OL', '1. one\n\n   second\n\n   third\n\n- two', '1. one\n\n   second\n\n   third\n\n- two'],
    ['M8', '1. one\n\n   second\n\n2. two', 'one', null, 'UL', '- one\n\n  second\n\n1. two', '- one\n\n  second\n\n2. two'],
    ['M8', '1. one\n\n   second\n\n2. two', 'one', null, 'OL', 'one\n\nsecond\n\n1. two', 'one\n\nsecond\n\n2. two'],
    ['M9', '1. one\n\n   second\n\n2. two', 'second', null, 'UL', '1. one\n\n- second\n\n1. two', '1. one\n\n- second\n\n2. two'],
    ['M9', '1. one\n\n   second\n\n2. two', 'second', null, 'OL', '1. one\n\n2. second\n\n3. two', '1. one\n\n2. second\n\n2. two'],
    ['M10', '- one\n\n  > quoted\n\n- two', 'one', null, 'UL', 'one\n\n> quoted\n\n- two', 'one\n\n> quoted\n\n- two'],
    ['M10', '- one\n\n  > quoted\n\n- two', 'one', null, 'OL', '1. one\n\n   > quoted\n\n- two', '1. one\n\n   > quoted\n\n- two'],
    ['M10', '- one\n\n  > quoted\n\n- two', 'one', null, 'h2', '## one\n\n> quoted\n\n- two', '## one\n\n> quoted\n\n- two'],
    ['M11', '- one\n\n  > quoted\n\n- two', 'quoted', null, 'UL', '- one\n\n- quoted\n\n- two', '- one\n\n- quoted\n\n- two'],
    ['M11', '- one\n\n  > quoted\n\n- two', 'quoted', null, 'OL', '- one\n\n1. quoted\n\n- two', '- one\n\n1. quoted\n\n- two'],
    ['M12', '- one\n\n  | h |\n  | --- |\n  | c |\n\n- two', 'one', null, 'UL', 'one\n\n| h |\n| --- |\n| c |\n\n- two', 'one\n\n| h |\n| --- |\n| c |\n\n- two'],
    ['M12', '- one\n\n  | h |\n  | --- |\n  | c |\n\n- two', 'one', null, 'OL', '1. one\n\n   | h |\n   | --- |\n   | c |\n\n- two', '1. one\n\n   | h |\n   | --- |\n   | c |\n\n- two'],
    ['M12', '- one\n\n  | h |\n  | --- |\n  | c |\n\n- two', 'one', null, 'h2', '## one\n\n| h |\n| --- |\n| c |\n\n- two', '## one\n\n| h |\n| --- |\n| c |\n\n- two'],
    ['M13', '- one\n\n  ::: {align=center}\n  fenced\n  :::\n\n- two', 'one', null, 'UL', 'one\n\n::: {align=center}\nfenced\n:::\n\n- two', 'one\n\n::: {align=center}\nfenced\n:::\n\n- two'],
    ['M13', '- one\n\n  ::: {align=center}\n  fenced\n  :::\n\n- two', 'one', null, 'OL', '1. one\n\n   ::: {align=center}\n   fenced\n   :::\n\n- two', '1. one\n\n   ::: {align=center}\n   fenced\n   :::\n\n- two'],
    ['M13', '- one\n\n  ::: {align=center}\n  fenced\n  :::\n\n- two', 'one', null, 'h2', '## one\n\n::: {align=center}\nfenced\n:::\n\n- two', '## one\n\n::: {align=center}\nfenced\n:::\n\n- two'],
    ['M14', '- one\n\n  <div>x</div>\n\n- two', 'one', null, 'UL', 'one\n\n<div>x</div>\n\n- two', 'one\n\n<div>x</div>\n\n- two'],
    ['M14', '- one\n\n  <div>x</div>\n\n- two', 'one', null, 'OL', '1. one\n\n   <div>x</div>\n\n- two', '1. one\n\n   <div>x</div>\n\n- two'],
    ['M14', '- one\n\n  <div>x</div>\n\n- two', 'one', null, 'h2', '## one\n\n<div>x</div>\n\n- two', '## one\n\n<div>x</div>\n\n- two'],
    ['M15', '- one\n\n  ```\n  code\n  ```\n\n- two', 'one', null, 'UL', 'one\n\n```\ncode\n```\n\n- two', 'one\n\n```\ncode\n```\n\n- two'],
    ['M15', '- one\n\n  ```\n  code\n  ```\n\n- two', 'one', null, 'OL', '1. one\n\n   ```\n   code\n   ```\n\n- two', '1. one\n\n   ```\n   code\n   ```\n\n- two'],
    ['M15', '- one\n\n  ```\n  code\n  ```\n\n- two', 'one', null, 'h2', '## one\n\n```\ncode\n```\n\n- two', '## one\n\n```\ncode\n```\n\n- two'],
    ['M16', '- # Foo\n- bar', 'Foo', null, 'UL', 'Foo\n\n- bar', 'Foo\n- bar'],
    ['M16', '- # Foo\n- bar', 'Foo', null, 'OL', '1. Foo\n\n- bar', '1. Foo\n- bar'],
    ['M17', '- # Foo\n\n  para\n\n- bar', 'Foo', null, 'UL', 'Foo\n\npara\n\n- bar', 'Foo\n\npara\n\n- bar'],
    ['M17', '- # Foo\n\n  para\n\n- bar', 'Foo', null, 'OL', '1. Foo\n\n   para\n\n- bar', '1. Foo\n\n   para\n\n- bar'],
    ['M18', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'one', null, 'UL', 'one\n\nsecond\n\n- - inner\n\n  after\n\n- two', 'one\n\nsecond\n\n- - inner\n\n  after\n\n- two'],
    ['M18', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'one', null, 'OL', '1. one\n\n   second\n\n- - inner\n\n  after\n\n- two', '1. one\n\n   second\n\n- - inner\n\n  after\n\n- two'],
    ['M18', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'one', null, 'h2', '## one\n\nsecond\n\n- - inner\n\n  after\n\n- two', '## one\n\nsecond\n\n- - inner\n\n  after\n\n- two'],
    ['M19', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'second', null, 'UL', '- one\n\n- second\n\n- - inner\n\n  after\n\n- two', '- one\n\n- second\n\n- - inner\n\n  after\n\n- two'],
    ['M19', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'second', null, 'OL', '- one\n\n1. second\n\n- - inner\n\n  after\n\n- two', '- one\n\n1. second\n\n- - inner\n\n  after\n\n- two'],
    ['M20', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'inner', null, 'UL', '- one\n\n  second\n\ninner\n\nafter\n\n- two', '- one\n\n  second\n\ninner\n\nafter\n\n- two'],
    ['M20', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'inner', null, 'OL', '- one\n\n  second\n\n1. inner\n\n   after\n\n- two', '- one\n\n  second\n\n1. inner\n\n   after\n\n- two'],
    ['M21', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'after', null, 'UL', '- one\n\n  second\n\n  - inner\n\n- after\n\n- two', '- one\n\n  second\n\n  - inner\n\n- after\n\n- two'],
    ['M21', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'after', null, 'OL', '- one\n\n  second\n\n  - inner\n\n1. after\n\n- two', '- one\n\n  second\n\n  - inner\n\n1. after\n\n- two'],
    ['M22', '- a\n  - b\n\n  c\n\n- d', 'b', null, 'UL', '- a\n\nb\n\nc\n\n- d', '- a\n\nb\n\nc\n\n- d'],
    ['M22', '- a\n  - b\n\n  c\n\n- d', 'b', null, 'OL', '- a\n\n1. b\n\n   c\n\n- d', '- a\n1. b\n\n   c\n\n- d'],
    ['M22', '- a\n  - b\n\n  c\n\n- d', 'b', null, 'h2', '- a\n\n## b\n\nc\n\n- d', '- a\n## b\n\nc\n\n- d'],
    ['M23', '- a\n  - b\n\n  c\n\n- d', 'c', null, 'UL', '- a\n  - b\n\n- c\n\n- d', '- a\n  - b\n\n- c\n\n- d'],
    ['M24', '- o\n  - x\n    - n\n  - y\n\n  t\n\n- z', 'x', null, 'UL', '- o\n\nx\n\n- - n\n  - y\n\n  t\n\n- z', '- o\n\nx\n\n- - n\n  - y\n\n  t\n\n- z'],
    ['M24', '- o\n  - x\n    - n\n  - y\n\n  t\n\n- z', 'x', null, 'OL', '- o\n\n1. x\n\n- - n\n  - y\n\n  t\n\n- z', '- o\n1. x\n- - n\n  - y\n\n  t\n\n- z'],
    ['M24', '- o\n  - x\n    - n\n  - y\n\n  t\n\n- z', 'x', null, 'h2', '- o\n\n## x\n\n- - n\n  - y\n\n  t\n\n- z', '- o\n## x\n- - n\n  - y\n\n  t\n\n- z'],
    ['M25', '- o\n  - x\n\n    p\n\n  - y\n- z', 'x', null, 'UL', '- o\n\nx\n\np\n\n- - y\n- z', '- o\n\nx\n\np\n\n- - y\n- z'],
    ['M25', '- o\n  - x\n\n    p\n\n  - y\n- z', 'x', null, 'OL', '- o\n\n1. x\n\n   p\n\n- - y\n- z', '- o\n1. x\n\n   p\n\n- - y\n- z'],
    ['M26', '- one\n\n  > q\n\n  | h |\n  | --- |\n  | c |\n\n  ::: {align=center}\n  f\n  :::\n\n- two', 'one', null, 'UL', 'one\n\n> q\n\n| h |\n| --- |\n| c |\n\n::: {align=center}\nf\n:::\n\n- two', 'one\n\n> q\n\n| h |\n| --- |\n| c |\n\n::: {align=center}\nf\n:::\n\n- two'],
    ['M26', '- one\n\n  > q\n\n  | h |\n  | --- |\n  | c |\n\n  ::: {align=center}\n  f\n  :::\n\n- two', 'one', null, 'OL', '1. one\n\n   > q\n\n   | h |\n   | --- |\n   | c |\n\n   ::: {align=center}\n   f\n   :::\n\n- two', '1. one\n\n   > q\n\n   | h |\n   | --- |\n   | c |\n\n   ::: {align=center}\n   f\n   :::\n\n- two'],
    ['M27', '- one\n\n  ---\n\n- two', 'one', null, 'UL', 'one\n\n---\n\n- two', 'one\n\n---\n\n- two'],
    ['M27', '- one\n\n  ---\n\n- two', 'one', null, 'OL', '1. one\n\n   ---\n\n- two', '1. one\n\n   ---\n\n- two'],
    ['M28', '10. one\n\n    second\n\n11. two', 'one', null, 'UL', '- one\n\n  second\n\n10. two', '- one\n\n  second\n\n11. two'],
    ['M28', '10. one\n\n    second\n\n11. two', 'one', null, 'OL', 'one\n\nsecond\n\n10. two', 'one\n\nsecond\n\n11. two'],
    ['M29', '9. one\n\n   second', 'second', null, 'OL', '9. one\n\n10. second', '9. one\n\n10. second'],
    ['C1', '::: columns\n- one\n- two\n|||\nRight\n:::', 'one', null, 'UL', '::: columns\none\n\n- two\n|||\nRight\n:::', '::: columns\none\n- two\n|||\nRight\n:::'],
    ['C1', '::: columns\n- one\n- two\n|||\nRight\n:::', 'one', null, 'OL', '::: columns\n1. one\n\n- two\n|||\nRight\n:::', '::: columns\n1. one\n- two\n|||\nRight\n:::'],
    ['C2', '::: columns\n- one\n- two\n|||\nRight\n:::', 'two', null, 'UL', '::: columns\n- one\n\ntwo\n|||\nRight\n:::', '::: columns\n- one\n\ntwo\n\n|||\nRight\n:::'],
    ['C2', '::: columns\n- one\n- two\n|||\nRight\n:::', 'two', null, 'OL', '::: columns\n- one\n\n1. two\n|||\nRight\n:::', '::: columns\n- one\n1. two\n|||\nRight\n:::'],
    ['C3', '::: columns\n- one\n\n  second\n\n- two\n|||\nRight\n:::', 'one', null, 'UL', '::: columns\none\n\nsecond\n\n- two\n|||\nRight\n:::', '::: columns\none\n\nsecond\n\n- two\n|||\nRight\n:::'],
    ['C3', '::: columns\n- one\n\n  second\n\n- two\n|||\nRight\n:::', 'one', null, 'OL', '::: columns\n1. one\n\n   second\n\n- two\n|||\nRight\n:::', '::: columns\n1. one\n\n   second\n\n- two\n|||\nRight\n:::'],
    ['C4', '::: columns\none\n|||\nRight\n:::', 'one', null, 'UL', '::: columns\n- one\n|||\nRight\n:::', '::: columns\n- one\n|||\nRight\n:::'],
    ['C4', '::: columns\none\n|||\nRight\n:::', 'one', null, 'OL', '::: columns\n1. one\n|||\nRight\n:::', '::: columns\n1. one\n|||\nRight\n:::'],
    ['Z1', '- one\n-\n- three', 'one', null, 'UL', 'one\n\n-\n- three', 'one\n\n-\n- three'],
    ['Z1', '- one\n-\n- three', 'one', null, 'OL', '1. one\n\n-\n- three', '1. one\n-\n- three'],
];
```

The two saved texts of a row can differ where the viewer reads no
difference: a blank line between two lists or blocks, and a numbered item's
number (the viewer numbers every list from one; source mode leaves the
numbers of the lines it does not touch, and the WYSIWYG surface keeps a
split list's start).

`DIFFERS` — the 26 rows where the surfaces differ on purpose (see
*Non-Goals* for each reason):

```typescript
const DIFFERS: ParityRow[] = [
    ['Q1', '> - one\n> - two', 'one', null, 'UL', '- \\> - one\\\n  \\> - two', 'one\n> - two'],
    ['Q1', '> - one\n> - two', 'one', null, 'OL', '1. \\> - one\\\n   \\> - two', '1. one\n> - two'],
    ['Q2', '> - [ ] one\n> - [x] two', 'one', null, 'UL', '- \\> - \\[ \\] one\\\n  \\> - \\[x\\] two', '\\[ \\] one\n> - [x] two'],
    ['Q2', '> - [ ] one\n> - [x] two', 'one', null, 'OL', '1. \\> - \\[ \\] one\\\n   \\> - \\[x\\] two', '1. [ ] one\n> - [x] two'],
    ['E1', '- one\n  two\n- three', 'two', null, 'UL', 'one\ntwo\n\n- three', '- one\n- two\n- three'],
    ['E1', '- one\n  two\n- three', 'two', null, 'OL', '1. one\n   two\n\n- three', '- one\n1. two\n- three'],
    ['E2', 'one\ntwo', 'one', 'two', 'UL', '- one\n  two', '- one\n- two'],
    ['E2', 'one\ntwo', 'one', 'two', 'OL', '1. one\n   two', '1. one\n2. two'],
    ['E3', '```\none\n```\n\ntwo', 'one', null, 'UL', '- one\n\ntwo', '```\none\n```\n\ntwo'],
    ['E3', '```\none\n```\n\ntwo', 'one', null, 'OL', '1. one\n\ntwo', '```\none\n```\n\ntwo'],
    ['E4', '- one\n\n  second\n\n- two', 'second', null, 'paragraph', '- one\n\n  second\n\n- two', '- one\n\nsecond\n\n- two'],
    ['E4', '- one\n\n  second\n\n- two', 'second', null, 'h2', '- one\n\n  ## second\n\n- two', '- one\n\n## second\n\n- two'],
    ['E5', '- [ ] one\n- [x] two', 'one', 'two', 'code', '```\n[ ] one\n```\n\n```\n[x] two\n```', '```\n[ ] one\n[x] two\n```'],
    ['E6', '- one\n  - inner\n\n- three', 'three', null, 'UL', '- one\n\n  - inner\n\nthree', '- one\n  - inner\n\nthree'],
    ['E7', '- one\n  - inner\n\n  after\n\n- two', 'after', null, 'OL', '- one\n\n  - inner\n\n1. after\n\n- two', '- one\n  - inner\n\n1. after\n\n- two'],
    ['E8', '<div>x</div>\n\ntwo', 'x', null, 'UL', '- \\<div>x\\</div>\n\ntwo', '<div>x</div>\n\ntwo'],
    ['E9', 'one\n\n---\n\ntwo', 'one', 'two', 'UL', '- one\n- \\---\n- two', '- one\n\n---\n\n- two'],
    ['E10', '- one\n\n  ```\n  code\n  ```\n\n- two', 'code', null, 'UL', '- one\n\n- code\n\n- two', '- one\n\n  ```\n  code\n  ```\n\n- two'],
    ['E11', '- one\n\n  <div>x</div>\n\n- two', 'x', null, 'UL', '- one\n\n- \\<div>x\\</div>\n\n- two', '- one\n\n  <div>x</div>\n\n- two'],
    ['E12', '- # Foo\n- bar', 'Foo', null, 'paragraph', '- Foo\n- bar', 'Foo\n- bar'],
    ['E12', '- # Foo\n- bar', 'Foo', null, 'h2', '- ## Foo\n- bar', '## Foo\n- bar'],
    ['E13', '- one\n\n  ::: {align=center}\n  fenced\n  :::\n\n- two', 'fenced', null, 'UL', '- one\n\n  ::: {align=center}\n  - fenced\n  :::\n\n- two', '- one\n\n  ::: {align=center}\n  fenced\n  :::\n\n- two'],
    ['E13', '- one\n\n  ::: {align=center}\n  fenced\n  :::\n\n- two', 'fenced', null, 'OL', '- one\n\n  ::: {align=center}\n  1. fenced\n  :::\n\n- two', '- one\n\n  ::: {align=center}\n  fenced\n  :::\n\n- two'],
    ['E14', '::: columns\n- one\n- two\n|||\nRight\n:::', 'two', 'Right', 'UL', '::: columns\n- one\n- two\n|||\n- Right\n:::', '::: columns\n- one\n- two\n|||\nRight\n:::'],
    ['E15', '- one\n-\n- three', 'one', 'three', 'UL', 'one\n\nthree', 'one\n\n-\n\nthree'],
    ['E15', '- one\n-\n- three', 'one', 'three', 'OL', '1. one\n2.\n3. three', '1. one\n-\n1. three'],
];
```

Then the two loops, one test per row:

```typescript
for (const row of SAME) {
    const [id, doc, from, to, command, wysiwyg, source] = row;

    it(`${id} ${command}: both surfaces leave a document the viewer reads the same`, () => {
        const loaded = editorOf(doc);

        expect(canonicalSave(loaded), 'the document is in the form the editor saves').toBe(doc);

        selectWords(loaded, from, to ?? from);

        expect(loaded.getSelectionState().canSetBlockType).toBe(true);

        const editor = wysiwygAfter(row);
        const value = editor.getValue();

        expect(value).toBe(wysiwyg);
        expect(value).not.toBe(doc);
        expect(editorOf(value).getValue()).toBe(value);
        expect(editorSurfaceModel(editor)).toEqual(viewerModel(value).blocks);

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(doc);
        expect(sourceAfter(row)).toBe(source);
        expect(viewerModel(source).blocks).toEqual(viewerModel(wysiwyg).blocks);
    });
}

for (const row of DIFFERS) {
    const [id, , , , command, wysiwyg, source] = row;

    it(`${id} ${command}: the surfaces differ here on purpose, each as pinned`, () => {
        const editor = wysiwygAfter(row);
        const value = editor.getValue();

        expect(value).toBe(wysiwyg);
        expect(editorOf(value).getValue()).toBe(value);
        expect(editorSurfaceModel(editor)).toEqual(viewerModel(value).blocks);
        expect(sourceAfter(row)).toBe(source);
        // A row whose two results start reading alike is no difference any more: move it to SAME.
        expect(viewerModel(source).blocks).not.toEqual(viewerModel(wysiwyg).blocks);
    });
}
```

**Controls.** These 25 `SAME` rows pass before any source change; the other
157 fail: `B1 UL`, `B2 UL`, `B3 UL`, `B3 OL`, `N1 OL`, `T6 UL`, `X3 OL`,
`X4 OL`, `X5 OL`, `X6 OL`, `X8 UL`, `X19 UL`, `S1 UL`, `S2 UL`, `S3 UL`,
`S4 OL`, `S5 UL`, `L1 UL`, `L2 UL`, `M3 h2`, `C1 UL`, `C2 UL`, `C4 UL`,
`C4 OL`, `Z1 UL`.

Of the `DIFFERS` rows, 8 fail before any source change, on their `wysiwyg`
or `source` string: `Q2 UL`, `Q2 OL`, `E1 OL`, `E5 code`, `E7 OL`, `E10 UL`,
`E11 UL`, `E15 OL`. The other 18 pass.

**Two `CASES` rows of the same `describe` are restated**
([:779](../packages/lib/tests/component/markdown-editor.test.ts#L779),
[:783](../packages/lib/tests/component/markdown-editor.test.ts#L783)):

```typescript
{
    name: 'in a list of the other kind the toggle changes the caret\'s item alone, its list split around it',
    doc: '- one\n- two\n- three', from: 'two', toggle: ordered, result: '- one\n\n1. two\n\n- three',
},
{
    name: 'a range from a bulleted list into a numbered one makes the numbered item it touches a bulleted item, joining the list before it',
    doc: '- one\n- two\n\n1. three\n2. four', from: 'two', to: 'three', toggle: unordered, result: '- one\n- two\n- three\n\n1. four',
},
```

### Source-mode rows (`markdown-editor.test.ts`)

In `describe('MarkdownEditor source-mode line commands read the viewer's blocks')`
([:2099](../packages/lib/tests/component/markdown-editor.test.ts#L2099)),
the `CASES` rows "a heading from a list item keeps the item's indented
content in the item"
([:2108](../packages/lib/tests/component/markdown-editor.test.ts#L2108))
and "a code block from a list item keeps the item's indented content in the
item"
([:2116](../packages/lib/tests/component/markdown-editor.test.ts#L2116))
are restated, and nine rows are added after the second. These rows hold
documents the parity tables cannot: text that is not in the form the editor
saves (a lazy line, indented code, several blank lines, a tab) and
selections of a single line of a block. The two restated rows and the nine
new ones, in the order they stand in the table (the unchanged row "a quote
from a list item keeps its nested list in the item" stays between the first
two):

```typescript
{
    name: 'a heading from a list item takes the item\'s indented content out of the list with it', doc: '10. a\n\n    b', select: [4, 4],
    run: (editor) => editor.setBlockType('h2'), result: '## a\n\nb',
},
{
    name: 'a quote from a list item keeps its nested list in the item', doc: '- a\n  - b\n- c', select: [2, 2],
    run: (editor) => editor.setBlockType('quote'), result: '> a\n- - b\n- c',
},
{
    name: 'a code block from a list item takes the item\'s indented content out of the list with it', doc: '10. a\n\n    b', select: [4, 4],
    run: (editor) => editor.setBlockType('code'), result: '```\na\n```\n\nb',
},
{
    name: 'a list item taken out of its list takes a lazy line of its paragraph along', doc: '- one\n\n  second\nlazy\n\n- two', select: [3, 3],
    run: (editor) => editor.toggleUnorderedList(), result: 'one\n\nsecond\nlazy\n\n- two',
},
{
    name: 'an item that changes kind re-indents the paragraph it holds, a lazy line left as it is', doc: '- one\n\n  second\nlazy\n\n- two', select: [3, 3],
    run: (editor) => editor.toggleOrderedList(), result: '1. one\n\n   second\nlazy\n\n- two',
},
{
    name: 'indented code a list item holds stays indented code outside the list', doc: '- one\n\n      code\n\n- two', select: [3, 3],
    run: (editor) => editor.toggleUnorderedList(), result: 'one\n\n    code\n\n- two',
},
{
    name: 'a new item written against a tight list takes every blank line between them', doc: '- one\n- two\n\n\n\nthree', select: [16, 16],
    run: (editor) => editor.toggleUnorderedList(), result: '- one\n- two\n- three',
},
{
    name: 'a list toggle declines over a tab-indented block of the item', doc: '- one\n\n\tsecond\n- two', select: [3, 3],
    run: (editor) => editor.toggleUnorderedList(), result: '- one\n\n\tsecond\n- two',
},
{
    name: 'a later line of an item\'s text made an item takes the blocks its item held', doc: '- one\n  two\n\n  para\n- three', select: [9, 9],
    run: (editor) => editor.toggleUnorderedList(), result: '- one\n- two\n\n  para\n- three',
},
{
    name: 'a task marker stays with the first line of its item\'s text', doc: '- [ ] one\n  more\n- two', select: [13, 13],
    run: (editor) => editor.toggleOrderedList(), result: '- [ ] one\n1. more\n- two',
},
{
    name: 'a task item taken out of its list leaves its nested list in a plain item', doc: '- [ ] one\n  - inner\n\n  after\n- two', select: [7, 7],
    run: (editor) => editor.toggleUnorderedList(), result: '\\[ \\] one\n- - inner\n\n  after\n- two',
},
{
    name: 'a nested item taken out of its lists leaves its own nested list one level up', doc: '- o\n  - x\n    - n\n  - y\n\n  t\n- z', select: [9, 9],
    run: (editor) => editor.toggleUnorderedList(), result: '- o\n\nx\n\n- - n\n  - y\n\n  t\n- z',
},
```

Of the nine new rows, "a list toggle declines over a tab-indented block of
the item" and "a task marker stays with the first line of its item's text"
pass before any source change. The other seven, and the two restated rows,
fail.

### Availability rows (`markdown-editor.test.ts`)

In `describe('availability, read from the live selection')`
([:5067](../packages/lib/tests/component/markdown-editor.test.ts#L5067)),
add the constant `const ITEM_PARAGRAPH = '- one\n\n  second\n\n- two';` after
`TWO_LISTS`
([:5079](../packages/lib/tests/component/markdown-editor.test.ts#L5079)),
and add six rows to `CASES` before the row `'no selection'`
([:5341](../packages/lib/tests/component/markdown-editor.test.ts#L5341)):

```typescript
{
    name: 'a caret in a paragraph a list item holds after its text', markdown: ITEM_PARAGRAPH,
    select: (editor) => caretIn(editor, 'second', 1),
    available: IN_LIST,
},
{
    name: 'a range from a list item\'s text into the paragraph it holds', markdown: ITEM_PARAGRAPH,
    select: (editor) => selectAcross(editor, 'one', 'second'),
    available: IN_LIST,
},
{
    name: 'a caret in a heading a list item opens with', markdown: '- ## Foo\n- bar',
    select: (editor) => caretIn(editor, 'Foo', 1),
    available: IN_LIST,
},
{
    name: 'a caret in a quote a list item holds', markdown: '- one\n\n  > quoted\n\n- two',
    select: (editor) => caretIn(editor, 'quoted', 1),
    available: IN_LIST,
},
{
    name: 'a caret in a table cell of a list item', markdown: '- one\n\n  | h |\n  | --- |\n  | c |\n\n- two',
    select: (editor) => caretIn(editor, 'c', 1),
    available: [
        'canFormat', 'canStyle', 'canLink', 'canSetBlockLayout', 'canInsertParagraphAroundBlock', 'canInsertImage', 'canEditTable',
    ],
},
{
    name: 'a caret in a code block a list item holds', markdown: '- one\n\n  ```\n  code\n  ```\n\n- two',
    select: (editor) => caretIn(editor, 'code', 2),
    available: ['canSetBlockType', 'canSetBlockLayout', 'canInsertParagraphAroundBlock'],
},
```

Each row runs the describe's three tests. For the first four rows and the
last, the test "every command reported available there applies" fails before
the change, because a toggle changes nothing there; the other two tests of
each row pass. All three tests of the table-cell row pass before the change:
it pins that `canSetBlockType` stays `false` in a table of a list item.

### WYSIWYG rows (`markdown-editor-list-item-edits.test.ts`)

In `describe('a block type or a list toggle in a list item acts on the block the caret is in')`
([:1589](../packages/lib/tests/component/markdown-editor-list-item-edits.test.ts#L1589)).
`runRow` checks after every step that the save reloads to the same
document, that the viewer reads it as the editor shows it, and that the
document's standard form does too.

Rows `H4`, `H5` and `H6` are restated:

```typescript
{
    name:   'H4: the list toggled on an item\'s paragraph, in a list of that kind, makes the paragraph an item of its own',
    source: '- one\n\n  second\n\n- two',
    steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['second', 1] }],
    saved:  '- one\n\n- second\n\n- two',
},
{
    name:   'H5: the other list kind toggled in an empty item changes that item alone, its list split around it',
    source: '- a\n-\n- z',
    steps:  [{ key: 'Enter', at: ['a', 1] }, { key: 'command', run: (editor) => editor.toggleOrderedList() }],
    saved:  '- a\n\n1.\n\n-\n- z',
},
{
    name:   'H6: the other list kind toggled in an item\'s text changes that item alone, its list split around it',
    source: '- a\n- b',
    steps:  [{ key: 'command', run: (editor) => editor.toggleOrderedList(), at: ['b', 1] }],
    saved:  '- a\n\n1. b',
},
```

Rows `H9` to `H24` are added after `H8`:

```typescript
{
    name:   'H9: the other list kind toggled on the text of an item holding a paragraph changes the item\'s kind, the paragraph kept in it',
    source: '- one\n\n  second\n\n- two',
    steps:  [{ key: 'command', run: (editor) => editor.toggleOrderedList(), at: ['one', 1] }],
    saved:  '1. one\n\n   second\n\n- two',
    shape:  'list(markdown-list-item(markdown-list-item-text("one"), paragraph("second"))) | list(markdown-list-item(markdown-list-item-text("two")))',
},
{
    name:   'H10: the list toggled off takes a quote, a table, a ::: block and a raw block out with the item\'s text, each as it is',
    source: '- one\n\n  > q\n\n  | h |\n  | --- |\n  | c |\n\n  ::: {align=center}\n  f\n  :::\n\n  <div>x</div>\n\n- two',
    steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['one', 1] }],
    saved:  'one\n\n> q\n\n| h |\n| --- |\n| c |\n\n::: {align=center}\nf\n:::\n\n<div>x</div>\n\n- two',
    shape:  'paragraph("one") | quote("q") | table(tablerow(tablecell(paragraph("h"))), tablerow(tablecell(paragraph("c")))) | markdown-block(markdown-column(paragraph("f"))) | markdown-raw-block("<div>x</div>") | list(markdown-list-item(markdown-list-item-text("two")))',
},
{
    name:   'H11: the other list kind toggled there keeps all four in the item',
    source: '- one\n\n  > q\n\n  | h |\n  | --- |\n  | c |\n\n  ::: {align=center}\n  f\n  :::\n\n  <div>x</div>\n\n- two',
    steps:  [{ key: 'command', run: (editor) => editor.toggleOrderedList(), at: ['one', 1] }],
    saved:  '1. one\n\n   > q\n\n   | h |\n   | --- |\n   | c |\n\n   ::: {align=center}\n   f\n   :::\n\n   <div>x</div>\n\n- two',
    shape:  'list(markdown-list-item(markdown-list-item-text("one"), quote("q"), table(tablerow(tablecell(paragraph("h"))), tablerow(tablecell(paragraph("c")))), markdown-block(markdown-column(paragraph("f"))), markdown-raw-block("<div>x</div>"))) | list(markdown-list-item(markdown-list-item-text("two")))',
},
{
    name:   'H12: the blocks after the item\'s first nested list stay in the list, in an item with no text',
    source: '- one\n\n  second\n\n  - inner\n\n  after\n\n- two',
    steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['one', 1] }],
    saved:  'one\n\nsecond\n\n- - inner\n\n  after\n\n- two',
    shape:  'paragraph("one") | paragraph("second") | list(markdown-list-item(list(markdown-list-item(markdown-list-item-text("inner"))), paragraph("after")), markdown-list-item(markdown-list-item-text("two")))',
},
{
    name:   'H13: the list toggled on a later paragraph of an item gives the new item the blocks after it',
    source: '- one\n\n  second\n\n  third\n\n- two',
    steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['second', 1] }],
    saved:  '- one\n\n- second\n\n  third\n\n- two',
    shape:  'list(markdown-list-item(markdown-list-item-text("one")), markdown-list-item(markdown-list-item-text("second"), paragraph("third")), markdown-list-item(markdown-list-item-text("two")))',
},
{
    name:   'H14: the other list kind toggled there does the same in a list of its own',
    source: '- one\n\n  second\n\n  third\n\n- two',
    steps:  [{ key: 'command', run: (editor) => editor.toggleOrderedList(), at: ['second', 1] }],
    saved:  '- one\n\n1. second\n\n   third\n\n- two',
},
{
    name:   'H15: the list toggled off on the heading an item opens with takes the item out, the heading a paragraph',
    source: '- # Foo\n\n  para\n\n- bar',
    steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['Foo', 1] }],
    saved:  'Foo\n\npara\n\n- bar',
},
{
    name:   'H16: a nested item taken out leaves its own nested list one level up, beside the items that followed it',
    source: '- o\n  - x\n    - n\n  - y\n- z',
    steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['x', 1] }],
    saved:  '- o\n\nx\n\n- - n\n  - y\n- z',
    shape:  'list(markdown-list-item(markdown-list-item-text("o"))) | paragraph("x") | list(markdown-list-item(list(markdown-list-item(markdown-list-item-text("n")), markdown-list-item(markdown-list-item-text("y")))), markdown-list-item(markdown-list-item-text("z")))',
},
{
    name:   'H17: the caret stays in the text of an item that changes kind',
    source: '- one\n- two\n- three',
    steps:  [{ key: 'command', run: (editor) => editor.toggleOrderedList(), at: ['two', 1] }, { key: 'type', text: 'X' }],
    saved:  '- one\n\n1. tXwo\n\n- three',
},
{
    name:   'H18: a range over an item\'s text and its paragraph makes two items of the other kind',
    source: '- one\n\n  second\n\n- two',
    steps:  [{ key: 'command', run: (editor) => editor.toggleOrderedList(), at: ['one', 1], to: ['second', 1] }],
    saved:  '1. one\n2. second\n\n- two',
    shape:  'list(markdown-list-item(markdown-list-item-text("one")), markdown-list-item(markdown-list-item-text("second"))) | list(markdown-list-item(markdown-list-item-text("two")))',
},
{
    name:   'H19: the same toggle a second time takes the new item out of its list',
    source: '- one\n- two\n- three',
    steps:  [
        { key: 'command', run: (editor) => editor.toggleOrderedList(), at: ['two', 1] },
        { key: 'command', run: (editor) => editor.toggleOrderedList() },
    ],
    saved:  '- one\n\ntwo\n\n- three',
},
{
    name:   'H20: a new item made between a tight list and a loose one of its kind makes one loose list',
    source: '- a\n- b\n\nmid\n\n- c\n\n- d',
    steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['mid', 1] }],
    saved:  '- a\n\n- b\n\n- mid\n\n- c\n\n- d',
},
{
    name:   'H21: a new item made after a loose list of its kind leaves that list loose',
    source: '- one\n\n- two\n\nthree',
    steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['three', 1] }],
    saved:  '- one\n\n- two\n\n- three',
},
{
    name:   'H22: the list toggled in a ::: block of an item makes the list inside the block',
    source: '- one\n\n  ::: {align=center}\n  fenced\n  :::\n\n- two',
    steps:  [{ key: 'command', run: (editor) => editor.toggleUnorderedList(), at: ['fenced', 1] }],
    saved:  '- one\n\n  ::: {align=center}\n  - fenced\n  :::\n\n- two',
    shape:  'list(markdown-list-item(markdown-list-item-text("one"), markdown-block(markdown-column(list(markdown-list-item(markdown-list-item-text("fenced")))))), markdown-list-item(markdown-list-item-text("two")))',
},
{
    name:   'H23: text typed after the other list kind is toggled in an empty item goes into the new item',
    source: '- a\n- z',
    steps:  [{ key: 'Enter', at: ['a', 1] }, { key: 'command', run: (editor) => editor.toggleOrderedList() }, { key: 'type', text: 'X' }],
    saved:  '- a\n\n1. X\n\n- z',
},
{
    name:   'H24: a code block made of a task item holds the marker as it was written',
    source: '- [ ] one\n- [x] two',
    steps:  [{ key: 'command', run: (editor) => editor.setBlockType('code'), at: ['one', 1] }],
    saved:  '```\n[ ] one\n```\n\n- [x] two',
},
```

### Node row (`markdown-list-item-node.test.ts`)

Add `$splitItemBefore` to the import from
`~/component/editor/markdownListItemNode`, and add after `S8`
([:263](../packages/lib/tests/component/markdown-list-item-node.test.ts#L263)),
in the same `describe`:

```typescript
it('S26: $splitItemBefore gives a later block of an item an item of its own, with every block after it', () => {
    const editor = editorHolding(() => [ul(i(t('a'), p('b'), ul(i(t('n'))), p('c')), i(t('z')))]);
    const made = update(editor, () => shape($splitItemBefore($itemOf('a'), $textOf('b').getParentOrThrow())));

    expect(made).toBe('i(p(b), ul(i(t(n))), p(c))');
    expect(shapeOf(editor)).toBe('ul(i(t(a)), i(p(b), ul(i(t(n))), p(c)), i(t(z)))');
});
```

The editor of this `describe` has no normal-form rules, so the paragraph `b`
stays a paragraph. In the real editor the item rule makes it the new item's
text at the end of the update.

### Existing tests that change

Nine existing tests change. Three are in *WYSIWYG rows* above (`H4`, `H5`,
`H6`), two in *Parity rows* (the two `CASES` rows) and two in *Source-mode
rows*. The last two are in `markdown-source-edits.test.ts`:

"marks only the non-blank lines of a selection spanning several blocks"
([:1319](../packages/lib/tests/component/markdown-source-edits.test.ts#L1319))
becomes:

```typescript
it('makes the blocks of a selection items of one tight list, and keeps the blank line between headings', () => {
    const text = 'foo\n\nbar';

    expect(apply(text, listSource('unordered')(text, 0, text.length)!)).toBe('- foo\n- bar');
    expect(apply(text, listSource('ordered')(text, 0, text.length)!)).toBe('1. foo\n2. bar');
    expect(apply(text, blockPrefixSource('## ')(text, 0, text.length)!)).toBe('## foo\n\n## bar');
});
```

"keeps a list item's other content in the item when its text is lifted out"
([:1399](../packages/lib/tests/component/markdown-source-edits.test.ts#L1399))
becomes:

```typescript
it('takes what a list item holds up to its first nested list out with its text, and leaves the nested list in an item', () => {
    expect(apply('- a\n  - b\n- c', blockPrefixSource('## ')('- a\n  - b\n- c', 2, 2)!)).toBe('## a\n- - b\n- c');
    expect(apply('10. a\n\n    b', blockPrefixSource('## ')('10. a\n\n    b', 4, 4)!)).toBe('## a\n\nb');
    expect(apply('- a\n\n  b', blockPrefixSource('> ')('- a\n\n  b', 2, 2)!)).toBe('> a\n\nb');
    expect(apply('- x\n  - a\n  - b', blockPrefixSource('## ')('- x\n  - a\n  - b', 8, 8)!)).toBe('- x\n## a\n- - b');
    expect(apply('10. a\n\n    b', FENCED_CODE_SOURCE('10. a\n\n    b', 4, 4)!)).toBe('```\na\n```\n\nb');
    expect(blockTypes('## a\n\nb')).toEqual(['heading', 'paragraph']);
});
```

The comment above that test's `describe`
([:1385](../packages/lib/tests/component/markdown-source-edits.test.ts#L1385))
ends "…the containers split around it, so what followed it inside them stays
there." Replace that clause with "…the containers split around it: what
followed it in its list items, up to the next list item, leaves the list
with it, and the rest stays there."

What each of the nine pinned before, and why it changes:

| Test | Pinned | Now | Why |
|---|---|---|---|
| `H4` | the bulleted toggle on an item's paragraph changes nothing | the paragraph becomes an item of its own | rules 3 and 6: a toggle that is available changes the document |
| `H5`, `H6`, `CASES` "in a list of the other kind…" | the other kind's toggle converts the whole list | the touched item alone | *A toggle of the other kind changes the touched items only* |
| `CASES` "a range from a bulleted list into a numbered one…" | the whole numbered list becomes bulleted | the touched numbered item alone | the same |
| the two source-mode rows, and "keeps a list item's other content…" | the item's later block stays in the list, re-opened by its marker (`10. b`) | it leaves the list with the text (`b`) | *What an item holds after its text leaves the list with it* |
| "marks only the non-blank lines…" | two new items keep the blank line between them | they stand line after line | rule 4 |

No other existing test changes.

### Manual (browser) checks — needs manual verification

Run `npm run dev` at the repository root and open the demo's **MD Editor**
page (`#/md-editor`). Switch to source mode with the toolbar's source
toggle, replace the text with the three lines `- [ ] todo`, `- [x] done`,
`- plain`, and switch back.

| # | Action | Expect |
|---|---|---|
| B1 | Click into `todo`; toolbar **Insert ▸ Bulleted list** | `todo` leaves the list as a paragraph reading `[ ] todo`; the list below starts at `[x] done`; the viewer pane shows the same |
| B2 | Without clicking anywhere, type `Q` | `Q` lands in that paragraph: the keyboard is back in the editor |
| B3 | Press Ctrl+Z twice | first the `Q` goes, then the item is back in its list as a task item |
| B4 | Click into `plain`; **Insert ▸ Numbered list** | only `plain` becomes `1. plain`; `todo` and `done` stay bulleted task items |
| B5 | Switch to source mode; put the caret on the `- [x] done` line; **Insert ▸ Bulleted list** | the line reads `\[x\] done`, and nothing flashes as refused |
| B6 | In source mode, on the `- [ ] todo` line, **Insert ▸ Numbered list** | the line reads `1. [ ] todo` |
| B7 | Reload the three lines; in WYSIWYG mode right-click `todo`; **Block style ▸ Heading 2** (context menu) | a heading reading `[ ] todo`, and the list below starts at `[x] done` |
| B8 | In source mode replace the text with `- one`, a blank line, `  second`, a blank line, `- two`; switch to WYSIWYG; click into `one`; **Insert ▸ Numbered list** | `one` is item 1 of a numbered list and `second` is still its paragraph, indented under it; `two` stays a bullet; one Ctrl+Z restores the bulleted list |
| B9 | Click into `second`; **Insert ▸ Bulleted list** | `second` becomes a bullet of its own between `one` and `two`, the caret still in it |
| B10 | Switch to source mode with the text of B8; caret on the `- one` line; **Insert ▸ Bulleted list** | the text reads `one`, a blank line, `second` at the margin, a blank line, `- two` |

---

## Verification

From `packages/lib`:

- `npm run typecheck` and `npm run typecheck:test`.
- `npm run lint`.
- The command of step 10, then `npm test` for the whole suite.
- `npm run docs:api`, `npm run docs:llms:check` and `npm run build:lib`.
- Grep: `grep -rnE 'convert(s|ing) whole' src/typescript/lib/component/editor/MarkdownEditor.ts docs/components/MarkdownEditor.md`
  — zero matches.
- The differential check below.
- The manual cases B1–B10.

### Differential check against the parent

Run the same scenarios on the parent commit and on the branch, and explain
every difference. The probe and its inputs are kept outside the repository,
in the scratch folder
`~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/list-toggle/`
("the scratch folder"; its `README.md` lists the files).[^prototype]

1. Copy `zz-probe-a.keep.ts` from the scratch folder to
   `tests/component/zz-probe-a.test.ts`.
2. For each of `final`, `differs`, `grid` and `rand`, run
   `PROBE_IN=<scratch>/rows-<name>.json PROBE_OUT=<scratch>/branch-<name>.jsonl npx vitest run tests/component/zz-probe-a.test.ts`.
3. Compare each output with the recorded one:
   `cmp <scratch>/branch-<name>.jsonl <scratch>/expected-<name>.jsonl`. The
   files must be identical: the plan's code is the code that wrote
   `expected-*.jsonl`. A difference is a slip in the implementation, or a
   change in the base since `85b55a8f4`; find which, and record it in the
   Implementation Notes.
4. Delete `tests/component/zz-probe-a.test.ts`.

The comparison with the parent is then the recorded one. `parent-*.jsonl`
is the probe's output at `85b55a8f4`; `python3 <scratch>/summary.py <file>…`
prints these counts:

| Scenarios | | Parent | Branch |
|---|---|---|---|
| `grid`: 88 list shapes, every caret and range, 3,681 cases | the viewer reads both surfaces alike | 1,662 | 3,138 |
| | a toggle is available and changes nothing (WYSIWYG) | 168 | 0 |
| | source mode declines | 365 | 192 |
| | a throw, a second undo step, a save that does not reload, a surface the viewer reads otherwise | 0 | 0 |
| `rand`: 160 random documents, 4,090 cases | the viewer reads both surfaces alike | 1,284 | 3,062 |
| | a toggle is available and changes nothing (WYSIWYG) | 147 | 0 |
| | source mode declines | 2,570 | 981 |
| | a throw, a second undo step, a save that does not reload, a surface the viewer reads otherwise | 0 | 0 |

If the branch's base is not `85b55a8f4`, also run step 2 on the parent
commit (a detached worktree with `node_modules` symlinked, per the project's
worktree notes) and compare with `parent-*.jsonl`.

Every difference that remains on the branch belongs to one class of
*Non-Goals*. `python3 <scratch>/classify2.py <scratch>/branch-grid.jsonl`
groups them. On the branch, in both sets:

- No case where a toggle leaves different structures on the two surfaces
  while source mode acts, apart from the four `grid` cases of an empty item
  or a thematic break inside a range.
- Where the toggle was *off* at the parent (447 `grid` cases), the WYSIWYG
  surface's saved text and its caret are the same on the branch.
- `setBlockType` differs from the parent on the WYSIWYG surface in 14
  `grid` cases, all `setBlockType("code")` on a task item (`[ ] one` where
  the parent wrote `\[ \] one`).

---

## Documentation Impact

No public signature changes. `$serializeInlineNodes` and `$splitItemBefore`
are exported from their modules only, not from a package entry point.

**JSDoc, `MarkdownEditor.ts`.** `toggleUnorderedList` becomes:

```typescript
/**
 * Converts the selected blocks into an unordered (bulleted) list, or out
 * of one. When every selected block is the text an item of a bulleted
 * list opens with, those items leave the list: each text becomes a
 * paragraph, the blocks its item holds up to its first nested list follow
 * it, and the list is split around them; a task item's `[ ]` / `[x]`
 * marker stays as the text it shows. Otherwise every other selected
 * block becomes a bulleted item at the top level (or in its `:::`
 * column): an item of a numbered list changes alone, its list split
 * around it and the blocks it holds up to its first nested list kept in
 * it, and a new item joins a bulleted list right before or after it.
 * No-op without a range selection, and when the selection touches a
 * table cell (whole cells selected included), which holds text only.
 *
 * In `"source"` mode, does the same to the blocks the raw Markdown's
 * selected lines touch.
 *
 * @returns This component, for method chaining.
 */
```

`toggleOrderedList` becomes:

```typescript
/**
 * Converts the selected blocks into an ordered (numbered) list, or out
 * of one. When every selected block is the text an item of a numbered
 * list opens with, those items leave the list: each text becomes a
 * paragraph, the blocks its item holds up to its first nested list follow
 * it, and the list is split around them; a task item's `[ ]` / `[x]`
 * marker stays as the text it shows. Otherwise every other selected
 * block becomes a numbered item at the top level (or in its `:::`
 * column): an item of a bulleted list changes alone, its list split
 * around it and the blocks it holds up to its first nested list kept in
 * it, and a new item joins a numbered list right before or after it.
 * No-op without a range selection, and when the selection touches a
 * table cell (whole cells selected included), which holds text only.
 *
 * In `"source"` mode, does the same to the blocks the raw Markdown's
 * selected lines touch.
 *
 * @returns This component, for method chaining.
 */
```

`setBlockType` becomes:

```typescript
/**
 * Converts the selected blocks to `type` (paragraph, `h1`–`h6`, blockquote,
 * or fenced code). A list item's text is taken out of its lists, and the
 * blocks the item holds up to its first nested list follow it; a task
 * item's marker stays as the text it shows, and in a code block as it was
 * written. No-op without a range selection, and when the selection
 * touches a table cell (whole cells selected included), which holds text
 * only. Where every block the selection touches is already of `type` the
 * call changes nothing: no block is replaced, so a heading or a code
 * block keeps the form it was written in and a code block its language,
 * and no undo step is added.
 *
 * In `"source"` mode, converts the raw Markdown's selected blocks instead —
 * see `sourceTransformForBlockType`.
 *
 * @param type - The target block type.
 * @returns This component, for method chaining.
 */
```

The JSDoc of `toggleList` and `$copyBlockAsCodeSource` is given with their
code in *Internal Structure*.

**JSDoc and comments, `markdownSourceLines.ts`.** The texts of
`expectLeaves`, `reopenContainers`, `targetOfEntry`, `convertBlocks`,
`listOff` and `listOn` are given with their code. The others:

The module header comment
([:9](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L9))
becomes:

```typescript
// The source-mode line commands — block type, list toggles, code fence,
// table and paragraph-around-block — read the document's blocks from the
// viewer's own tokens (see `markdownSourceTokens.ts`) and check every edit by
// lexing its result. A command acts on whole blocks: the paragraphs,
// headings, list item texts and code blocks its selection's lines touch. A
// task item's marker goes with its item's text. A command lifts each block
// out of the quotes and list items around it to the top level (or to its
// `:::` column) and splits those containers around it, as the WYSIWYG editor
// does. A quote is re-opened by its own marker on its first line after the
// block. A list item is not: what follows the block in its list items, up to
// the next list item, leaves the list with it, and from that item on what
// follows stays in the list, in the outermost item, re-opened by its marker.
// The result must then read, to the viewer, as the same visible text in the
// same blocks — every leaf with its format, its quotes, list items and
// columns, and its block boundaries — except that the lifted blocks are the
// intended new blocks and what followed them stands where the lift put it;
// otherwise the command tries the same edit with the lifted blocks set apart
// by blank lines and with their first character escaped, and declines when no
// form reads back as intended.
```

`SKIPPED_NODE_TYPES`
([:46](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L46)):

```typescript
/**
 * The leaf block types that are no target of their own when a line command's
 * selection touches them: a thematic break, which holds no text, and a task
 * item's checkbox, which goes with its item's text: a command that converts
 * the text carries the marker.
 */
const SKIPPED_NODE_TYPES: ReadonlySet<string> = new Set(["hr", "checkbox"]);
```

In `readLineTargets`'s JSDoc
([:431](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L431)),
the sentence "A thematic break and a task checkbox are left alone." becomes
"A thematic break is left alone; a task checkbox is no target of its own and
goes with its item's text."

`liftLines`:

```typescript
/**
 * Writes replacements as top-level blocks, splitting the quotes and list items
 * around them. Every line before a replacement is kept. A line after it
 * inside a quote keeps the quote, re-opened by the `>` the line carries. A
 * line after it inside its list items leaves them up to the first list item
 * that follows ({@link wrapperItemAfter}): it loses their indentation and
 * takes the replacement's `follow` in its place (`- a\n\n  b`, lifting `a`,
 * gives `## a\n\nb`). From that list item on, the outermost of the list
 * items is re-opened by its own marker and the ones inside it are not
 * (`- x\n  - a\n  - b`, lifting `a`, gives `- x\n## a\n- - b`). With
 * `separate`, each replacement is set apart from the lines around it by a
 * blank line.
 *
 * @param analysis - The document's analysis.
 * @param replacements - The replacements, in document order, none overlapping.
 * @param separate - Whether to set them apart by blank lines.
 * @returns The edit, or `null` when a line to keep cannot keep its containers
 *   (a lazy line where a quote must be re-opened, or tab indentation).
 */
```

`blockPrefixSource`
([:1016](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L1016)):

```typescript
/**
 * Builds a block-type transform: converts the whole blocks the selection's
 * lines touch — paragraphs, headings and list item texts, lazy lines and a
 * setext underline included, and a fenced code block selected whole, whose
 * fence lines are dropped — into the block `prefix` writes, each lifted out
 * of the quotes and list items around it to the top level (or its `:::`
 * column), those containers split around it. What follows it in its list
 * items up to the next list item leaves the list with it (`- a\n\n  b`, `a`
 * to a heading, gives `## a\n\nb`); from that item on, what follows stays in
 * the list (`- x\n  - a\n  - b`, `a` to a heading, gives
 * `- x\n## a\n- - b`). A task item's marker is carried as the text it shows
 * (`- [x] a` gives `## \[x\] a`). A heading is written one line per line
 * of text. The result is checked by lexing it: it must show the same text in
 * the same blocks, with only the converted blocks changed and what followed
 * them in their list items standing where the lift puts it; when the plain
 * edit does not, the command sets the converted blocks apart by blank lines
 * (so a paragraph does not join the text around it) and escapes a character
 * that would open another block at a converted line's start (`######` left
 * `~~~` there), and declines when no form reads back as intended. Declines
 * too when the blocks already read that way — a blank line alone included —
 * and when a selected line holds part of any other block or source the
 * viewer does not show.
 *
 * @param prefix - The prefix of the block to convert to (`""` for a
 *   paragraph, `"> "` for a quote, `"#".repeat(level) + " "` for a heading).
 * @returns The transform.
 */
```

`FENCED_CODE_SOURCE`
([:1032](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L1032)):

```typescript
/**
 * Converts the blocks the selection's lines touch into one fenced code block:
 * from the first block's first line to the last block's last line, every line
 * a converted block's or blank, each block's text taken as written (a code
 * block's code, its fences dropped, a task item's marker as it was written),
 * the blocks lifted out of their quotes and list items as
 * {@link blockPrefixSource} lifts them. The fence is three
 * backticks, or one more than the longest run opening a code line. The result
 * must read as that code block with nothing else changed, the block set apart
 * by blank lines when it does not otherwise. Declines when the lines already
 * are exactly that block, when a line between the blocks holds anything else,
 * and when a selected line holds part of any other block.
 */
```

The private `toggleList`
([:1159](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L1159)):

```typescript
/**
 * Toggles the selected lines' list: off when every selected line of the
 * blocks it touches is the marker line of an item in a list of `kind`, each
 * such item's text then lifted out as a paragraph (see
 * {@link blockPrefixSource}); otherwise on, each selected line that is not
 * yet such a marker line becoming a new item of `kind` at the top level,
 * with what its block's list item held after it.
 *
 * @param text - The full document text.
 * @param from - 0-based start of the raw selection.
 * @param to - 0-based end (exclusive) of the raw selection.
 * @param kind - The list kind.
 * @returns The edit, or `null` when the command declines.
 */
```

`listSource`
([:1278](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L1278)):

```typescript
/**
 * Builds a list-toggle transform: when every selected line of the blocks the
 * selection touches is the marker line of an item in a list of `kind` — in
 * the viewer's reading, so a `+` item inside a quote counts — the toggle is
 * off and each of those items' text is lifted out as a paragraph, the list
 * split around it as {@link blockPrefixSource} splits it; otherwise each
 * selected line that is not yet such a marker line becomes a new top-level
 * item, a block's lines below the selection continuing the last new item,
 * and what the block's list item held after it, up to the next list item,
 * becoming that item's blocks. Items made from neighbouring blocks stand
 * line after line, as one tight list. A new item is written with the marker
 * of the list of `kind` it joins — the one around its block at the top
 * level, else the one right above it, else the one right below — and `- ` or
 * `1. ` with none; a numbered item continues the list above it. The blank
 * lines between new items and a tight list they join are removed, since they
 * would make it loose. A task item that stays an item keeps its marker; one
 * whose text is lifted out keeps it as the text it shows (`\[x\]`). The
 * result is checked by lexing it, as the block-type transforms' are; a
 * converted line that would read as a definition, an HTML block, code, a
 * nested item, or a line below that would start a block rather than continue
 * the item, makes the command decline. Declines too for a selection touching
 * a setext heading's text, whose underline would close the last item into a
 * heading, a code block, and anything {@link blockPrefixSource} declines.
 *
 * @param kind - Which list to toggle.
 * @returns The transform.
 */
```

**`docs/components/MarkdownEditor.md`.**

- The Command API row for the toggles
  ([:117](../packages/lib/docs/components/MarkdownEditor.md)) becomes:

  ```markdown
  | `toggleUnorderedList()` / `toggleOrderedList()` | Convert the selected blocks into a bulleted / numbered list, or out of one. When every selected block is the text (or the heading) an item of a list of that kind opens with, those items leave the list: each becomes a paragraph, the blocks its item holds up to its first nested list follow it, and the list is split around them. Otherwise each other selected block becomes an item of such a list at the top level (or in its `:::` column): an item of a list of the other kind changes alone, its list split around it, and keeps the blocks it holds up to its first nested list — select a whole list to convert it whole — and a new item joins a list of that kind right before or after it, which stays tight. A block a list item holds after its text becomes an item of its own, with the blocks after it. A task item's `[ ]` / `[x]` marker stays a marker while its item stays an item, and becomes the text it shows when the item's text leaves its list. |
  ```

- The `setBlockType` row
  ([:120](../packages/lib/docs/components/MarkdownEditor.md)) gains, after
  its sentence: "A list item's text is taken out of its lists, and the
  blocks the item holds up to its first nested list follow it. A task item's
  marker stays as the text it shows, and in a code block as it was written."

- In the **Lists** bullet of *What Markdown cannot hold*
  ([:95](../packages/lib/docs/components/MarkdownEditor.md)), after the
  sentence "A block type set on such a further block changes it in place;
  set on the item's own text, it takes the item out of its lists.", add:

  ```markdown
  A list toggle on an item's own text, or on the heading an item opens with, takes the item out of its lists the same way, or makes it an item of the other kind there. Either way the blocks the item holds up to its first nested list go with the text — after the paragraph, or as the blocks of the new item — and the nested list and what follows it stay in the list, in an item with no text. A list toggle on a further block of an item makes that block an item of its own, with the blocks after it.
  ```

- In the source-mode paragraph that starts "The block commands —"
  ([:294](../packages/lib/docs/components/MarkdownEditor.md)), replace the
  two sentences from "Those containers split around it, and what followed it
  inside them stays there…" to "…rather than leaving `b` behind as indented
  code." with:

  ```markdown
  Those containers split around it. What followed it inside a quote stays in the quote, re-opened by its `>`. What followed it inside its list items, up to the next list item, leaves the list with it, as on the WYSIWYG surface: `setBlockType("h2")` on `10. a` / (blank) / `    b` gives `## a` / (blank) / `b`, rather than leaving `b` behind as indented code. From the next list item on, what followed stays in the list, in one item the outermost list item's marker re-opens: on `a` in `- x` / `  - a` / `  - b` it gives `- x` / `## a` / `- - b`.
  ```

  and replace the sentence "Turning a list off makes each item's text a
  paragraph of its own (`- a` / `- b` gives `a`, a blank line, `b`), and
  turning one on makes each selected line an item, the paragraph's lines
  below the selection continuing the last one." with:

  ```markdown
  Turning a list off makes each item's text a paragraph of its own (`- a` / `- b` gives `a`, a blank line, `b`), a task item's marker written as the text it shows (`- [x] a` gives `\[x\] a`). Turning one on makes each selected line an item, the paragraph's lines below the selection continuing the last one, and what its list item held after it becoming the new item's blocks; the new items stand line after line as one tight list, written with the marker of the list of that kind they join — the one around them, else the one right before them, else the one right after — and the blank lines between them and a tight list are removed, since they would make it loose. An item that changes kind keeps its task marker (`- [ ] a` gives `1. [ ] a`), and `setBlockType` carries a marker as the list toggles do, into a code block as it was written.
  ```

- After that paragraph, add a new paragraph:

  ```markdown
  The list toggles and `setBlockType` give the same result on both surfaces for the same blocks. They differ where the surfaces hold different things: source mode can select single lines of a paragraph or of an item's text and makes each selected line an item, where the WYSIWYG surface holds one block; a list inside a blockquote is a raw Markdown block on the WYSIWYG surface, and the commands act on that block as a whole; on a code block, a raw Markdown block or a thematic break the WYSIWYG toggles make the block's text an item, where source mode does nothing; `setBlockType` on a block a list item holds after its text, or on the heading it opens with, converts it in place on the WYSIWYG surface and takes it out of the list in source mode; `setBlockType("code")` over several blocks makes one code block per block on the WYSIWYG surface and one for all of them in source mode; in a `:::` block of a list item, and for a selection that runs from one `:::` column into the next, the WYSIWYG commands act and source mode does nothing; an empty list item inside a selection is converted with the others on the WYSIWYG surface and left alone in source mode; and a list left as one item that holds only a nested list keeps a loose list's spacing on the WYSIWYG surface.
  ```

**`docs/reference/changelog/next.md`.**

- In **Changed › Components**, in the entry "**`MarkdownEditor`'s command
  API edits the raw Markdown directly in `"source"` mode**", the clause "a
  block `setBlockType` or a list toggle converts leaves the quotes and list
  items around it for the top level, and what followed it inside them stays
  there, re-opened by its own marker, instead of being left behind as
  indented code or lazy text;" becomes "a block `setBlockType` or a list
  toggle converts leaves the quotes and list items around it for the top
  level, and what followed it in its list items, up to the next list item,
  leaves the list with it, as on the WYSIWYG surface, instead of being left
  behind as indented code or lazy text;". That entry describes this
  release's own new behaviour, so it is corrected in place.
- Append to **Changed › Components**, as the last entry before
  `### Overlay`:

  ```markdown
  - **`MarkdownEditor`'s list toggles change the selected blocks only, alike
    on both surfaces.** On the WYSIWYG surface `toggleOrderedList()` in a
    bulleted list (and `toggleUnorderedList()` in a numbered one) converted
    the whole list whatever was selected, a nested list in place, and made a
    loose list tight. It now changes the selected items alone: each becomes
    an item of the other kind at the top level, with the blocks it holds up
    to its first nested list, and its list is split around it. Select a
    whole list to convert it whole. A toggle on a block a list item holds
    after its text — a further paragraph, a quote — makes that block an item
    of its own; before, it changed nothing in a list of that kind. In source
    mode the two toggles and `setBlockType` do the same to the same blocks:
    a task item is converted with its `[ ]` / `[x]` marker — kept as a
    marker while the item stays an item (`1. [ ] todo`), written as the text
    it shows when the text leaves its list (`\[ \] todo`) — and items made
    from neighbouring blocks stand line after line as one tight list that
    joins a list of their kind next to them. No consumer action is needed
    unless code relied on a caret converting a whole list.
  ```

- Append to **Fixed › Components**, as the last entry before `### Core`:

  ```markdown
  - **A code block made from a task-list item holds the marker as it was
    written.** `setBlockType("code")` on `- [ ] todo` wrote `\[ \] todo`
    into the code block on the WYSIWYG surface. It now writes `[ ] todo`,
    on both surfaces. No consumer action is needed.
  ```

No migration note, no `llms.txt` change, and `docs/components/Markdown.md`
is untouched: the viewer does not change.

---

## Potential Challenges

- **`$liftItemOut` removes the item's text node.** The paragraph that takes
  the text's children is a new node. Use the blocks `$liftItemOut` returns;
  the block that was passed in may be detached.
- **Lift every block before making any item.** Making an item right after
  lifting its block, block by block from the end, gives a later block a new
  list of its own before an earlier block has joined the list above. Row
  `X17` (`* one` and two numbered items) then ends as two lists, `*` and
  `-`. Lifting first and making the items run by run avoids it.
- **Do not make the new list a copy of the list below.** A copy
  (`$copyNode`) carries the list's marker, but the list rule first settles a
  list's looseness on its own items, and a list of one new item is tight:
  the join then drops the looseness of the list below. Row `X19` fails.
  Insert the items into the existing list instead, as the code does.
- **Insert the new list before removing the first block.** The run's first
  block is the only anchor for where a new list goes. `$makeItemsOfRun`
  inserts the list before it, and only then does `$itemOfBlocks` remove the
  block.
- **`item.append` must keep blocks as blocks.** `$itemOfBlocks` relies on
  `MarkdownListItemNode.append`, which does. `$createListItemNode()` returns
  the editor's class through Lexical's node replacement; do not construct
  `ListItemNode` itself.
- **`readLeaves` and `liftLines` are shared by every source-mode line
  command.** Their changes alter the block types and the code fence too. Run
  the whole `markdown-source-edits.test.ts` and `markdown-editor.test.ts`
  after step 9, not only the new rows.
- **The lines and the expected leaves must agree.** A mismatch does not
  write a wrong document: the command declines, and rows fail on a `source`
  string equal to the document. If many `M` rows fail that way, compare
  `prefixAfterLift` with `pathAfterLifts` against their two tables.
- **A path segment per block.** `pathAfterLifts` finds an item's segment by
  the item's depth (`depthOf`). That holds because every block around a leaf
  writes exactly one segment in `readLeaves`. Row `C3` (an item holding a
  paragraph, in a `:::` column) pins it.
- **The task marker in a loose list is inside the paragraph's text.** Both
  shapes of the table in *the task marker* need a test: rows `T1` (tight)
  and `T7` (loose) cover them on both surfaces.
- **Other unstarted plans touch the same files.**
  `markdown-editor-raw-block-edge-cases` changes other functions of
  `markdownSerializer.ts` and moves rows `Q11` to `Q13` of
  `markdown-editor-list-item-edits.test.ts`.
  `markdown-editor-raw-block-range-edits`,
  `markdown-editor-cross-item-range-removal`,
  `markdown-editor-table-command-fixes`,
  `markdown-editor-link-format-command-fixes` and
  `markdown-editor-readonly-keyboard-selection` change other functions of
  `MarkdownEditor.ts`, and several add rows to `markdown-editor.test.ts` or
  `markdown-editor-list-item-edits.test.ts`. None changes a function this
  plan changes, so they can land in either order; expect line numbers to
  have moved. `markdown-editor-link-format-command-fixes` names `toggleList`
  as the precedent for a shared private body: it still is one.

---

## Critical Files

- [markdownListItemNode.ts](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts)
  — `MarkdownListItemNode` (:28) and `MarkdownListItemTextNode` (:309), the
  item and its text; `replace` (:504), `$movePointsBetween` (:611),
  `$splitItemAfterText` (:658, the model for `$splitItemBefore`),
  `$outdentItem` (:677), `$liftItemOut` (:762, the precedent for the whole
  WYSIWYG route), `$splitListAfter` (:851).
- [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts)
  — `$copyBlockAsCodeSource` (:358), `$selectionLiesInListOfType` (:3146),
  `$convertListOfEmptyItem` (:3171), `$blocksTouchedBy` (:3199),
  `$selectedBlocksHaveType` (:3217), `$enterLeavesListAtBlankItemText`
  (:3565, a caller of `$liftItemOut`), `$moveBlockPointsIntoText` (:4229),
  `$readCommandAvailability` (:4346), `commandApplies` (:5161), `toggleList`
  (:5209), `toggleUnorderedList` (:5833), `toggleOrderedList` (:5860),
  `setBlockType` (:6202).
- [markdownSourceLines.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts)
  — the module header (:9), `readLeaves` (:156), `readsAsExpected` (:227),
  `expectLeaves` (:280), `liftedContainers` (:367), `readLineTargets`
  (:431), `blockTextLines` (:517), `liftLines` (:568), `reopenContainers`
  (:689), `containerPrefix` (:737), `itemIndent` (:769), `firstReadingEdit`
  (:863), `convertBlocks` (:917), `FENCED_CODE_SOURCE` (:1032),
  `isMarkerLine` (:1140), `toggleList` (:1159), `listOff` (:1181), `listOn`
  (:1212).
- [markdownSourceTokens.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceTokens.ts)
  — read only: `SourceBlockNode`, `SourceEntry`, `entryKey`, and
  `walkListItems`, which writes the `item:task:checked` signature.
- [markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts)
  — `$serializeInlineNodes` (:795), `$writtenListMarker` (:1056),
  `$listReadsLoose` (:1076), `strayTaskMarkersAsText` (:5154).
- [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts)
  — read only: `$keepItemShape` (:197), which makes a paragraph that opens
  an item its text; `$normalizeList` (:449), which joins a list with the
  next one of its kind and marker; `$keepLoosenessWritable` (:584).
- [markdown-editor.test.ts](../packages/lib/tests/component/markdown-editor.test.ts)
  — `describe('MarkdownEditor list toggles in a list of their kind')`
  (:716) and its both-surfaces test (:836); the source-mode `CASES` (:2099);
  the availability `CASES` (:5067).
- [markdown-editor-list-item-edits.test.ts](../packages/lib/tests/component/markdown-editor-list-item-edits.test.ts)
  — `expectSaveKeepsDocument` (:258), `runRow` (:299), rows `U9` to `U14`
  (:1134) and `C1` to `C5` (:1167), which pin what `$liftItemOut` does for a
  block type, and the `H` rows (:1589).
- [markdown-list-item-node.test.ts](../packages/lib/tests/component/markdown-list-item-node.test.ts)
  — rows `S1` to `S8` (:211).
- [viewModel.ts](../packages/lib/tests/component/markdown-roundtrip/viewModel.ts)
  and [harness.ts](../packages/lib/tests/component/markdown-roundtrip/harness.ts)
  — `viewerModel` (:286), `editorSurfaceModel` (:576), `canonicalSave` (:27).
- [plans/implemented/markdown-editor-list-item-node.md](implemented/markdown-editor-list-item-node.md)
  — *Implementation Notes*, "For the plans that follow".
- [plans/implemented/markdown-editor-list-item-block-paste.md](implemented/markdown-editor-list-item-block-paste.md)
  — *Implementation Notes*, "Rule 3: an edit of a list item leaves its
  blocks as its blocks".
- [plans/implemented/markdown-editor-context-menu-caret.md](implemented/markdown-editor-context-menu-caret.md)
  — *Implementation Notes*, "The list toggles toggle (A-3)" and "The
  contract, and how the commands keep it (A-5)".

---

## Non-Goals

Each of the first nine is a difference between the surfaces that stays. All
are pinned by `DIFFERS` rows, so none can change unnoticed.

- **A list inside a blockquote on the WYSIWYG surface** (rows `Q1`, `Q2`).
  The WYSIWYG surface holds it as a raw block. Making it an editable list is
  an importer and serializer feature of its own.
- **Source mode's single lines** (rows `E1`, `E2`). Source mode makes each
  selected line of a multi-line block an item, and with the caret on a later
  line of an item's text splits the item there. The WYSIWYG surface shows
  those lines as one flowing block and has no such selection. For the same
  reason `setBlockType("h1")`–`("h6")` writes one heading per line in source
  mode and one heading holding the line break on the WYSIWYG surface.
- **The toggles on a code block, a raw Markdown block or a thematic break**
  (rows `E3`, `E8`, `E9`, `E10`, `E11`). The WYSIWYG surface makes the
  block's text an item, at the top level and in a list item alike; source
  mode declines or leaves the block alone. Raw blocks are the subject of
  `markdown-editor-raw-block-range-edits`.
- **`setBlockType` on a block a list item holds** (rows `E4`, `E12`): a
  further paragraph, or the heading an item opens with. The WYSIWYG surface
  converts it in place, inside the item — which is how a step of a numbered
  list gets a code block — and source mode takes it out of the list. Which
  is right is a question about `setBlockType`, not about the list toggles or
  task items.[^in-item-blocks]
- **`setBlockType("code")` over several blocks** (row `E5`). The WYSIWYG
  surface makes one code block per block, source mode one for all. The task
  marker is written alike in both since this plan.
- **The looseness of a list left as one item holding only a nested list**
  (rows `E6`, `E7`). After a split, the WYSIWYG surface keeps that list
  loose and writes a blank line before its nested list; in source mode the
  list reads tight. The WYSIWYG surface behaves the same when the other
  items are deleted by hand, so this is its looseness model, not the
  toggles'.[^looseness]
- **A block in a `:::` block that a list item holds** (rows `E13`). The
  WYSIWYG surface makes the list inside the `:::` block; source mode
  declines every line command there, because a lifted block could not leave
  the list item without leaving its column.
- **A selection that runs from one `:::` column into the next** (row
  `E14`). The WYSIWYG surface converts the blocks in each column; source
  mode declines on the `|||` line.
- **An empty list item inside a selection** (rows `E15`). The WYSIWYG
  surface converts it with the others; source mode has no line of text to
  convert there and leaves it.
- **A task-list toggle.** There are two list toggles. A task item is an
  item of a bulleted or numbered list, and this plan adds no command that
  sets or clears the marker.
- **Changing an item's kind in place, at its depth.** Rule 3 sends a
  converted block to the top level on both surfaces. Keeping a nested item
  nested while its kind changes would be a new behaviour on both.
- **Renumbering in source mode.** Source mode leaves the numbers of the
  lines it does not touch (`1. mid ⏎ 1. a ⏎ 2. b`). The viewer numbers a
  list from its first item.
- **Turning the kept marker back into plain text on the WYSIWYG surface.**
  After an item leaves its list, the WYSIWYG document still holds the marker
  as an atomic run of text kept as Markdown source (the component docs'
  *Kept as source*) until the next load; it saves and shows as text either
  way. A second toggle therefore gives `- [ ] one` on the WYSIWYG surface
  and `- \[ \] one` in source mode, which the viewer reads alike.
- **`canSetBlockType` in source mode.** It stays always `true`: source mode
  does not predict where a command declines.
- **The existing both-surfaces test.** It is left as it is; new shapes go
  into the parity tables.

---

## Notes

[^prototype]: The changes of *Internal Structure* were run at `85b55a8f4`
    without touching a source file: the four changed modules were copied
    into the tests tree and Vitest was pointed at the copies by an alias.
    The code blocks, the row tables and the counts of this plan are that
    prototype's code and measured output. With it, `tsc` and `eslint` report
    nothing for the four modules, and the whole library suite (557 files,
    16,106 tests) passes except the nine tests listed under *Existing tests
    that change*. The four test files with this plan's rows added pass
    (1,497 tests). The scratch folder
    `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/list-toggle/`
    keeps the prototype (`prototype-on-85b55a8f4.diff`, the modules whole
    under `proto/`), the test changes (`tests-on-85b55a8f4.diff`), the probe,
    its inputs and its outputs. Both diffs apply to `85b55a8f4` with
    `git apply`. They are evidence, not the implementation: implement from
    this plan, tests first. Where a file of the scratch folder and this plan
    disagree, the plan decides.

[^merge-gone]: The defect was that `$setBlocksType` called
    `ListItemNode.replace`, which moved every child of the item, blocks
    included, into the new paragraph. The list item block paste branch
    stopped that (its rule 3), and the list item node branch restated the
    fix in the node: an item's text takes a block type by lifting its item
    out first (`MarkdownListItemTextNode.replace`). Evidence at `85b55a8f4`:
    row `H3` of `markdown-editor-list-item-edits.test.ts` (:1604) pins
    `one ⏎⏎ second ⏎⏎ - two` for the very document and toggle the old plan
    recorded as `onesecond`, and it passes. The probe ran every toggle and
    block type over 3,681 grid scenarios, 4,090 random ones and the 208 rows
    of this plan at that commit: in none does a word of the document end up
    joined to another or missing from the save, on either surface. No shape
    of the bug was found.

[^blocks-follow]: The plan of 2026-10-06 chose the opposite: an item's
    later blocks stayed in the list as an item, as source mode had it. It
    was written when the WYSIWYG surface had no working behaviour to follow:
    there the blocks were merged into the text. That is no longer so. The
    list item block paste branch made "the blocks follow the new block" its
    rule 3 for a block type and for the list toggle, pinned in rows `U9` to
    `U14` and `C1` to `C5`, and the user accepted that rule on 2026-10-10.
    The list item node branch built `$liftItemOut` on it, added row `H3`
    ("the list toggled off on the text of an item holding a paragraph takes
    both out of the list"), and uses the same lift for Backspace at an
    item's start and for Enter on an empty line. Keeping the old rule would
    mean a second lift on the WYSIWYG surface that disagrees with those
    keys, and reversing pinned rows. The WYSIWYG surface also has the better
    result for `10. a ⏎⏎     b`: the old source-mode rule had to re-open the
    item (`10. b`) only so that `b` would not turn into indented code. For
    an *on* toggle the tail goes into the new item rather than to the top
    level: an item that changes kind keeps the blocks it holds. Leaving them
    outside the list was considered and rejected: a numbered toggle on a
    bulleted step would drop the step's paragraph out of the list.

[^marker-is-text]: The dialect shows a task marker as text. The viewer
    renders `- [ ] task` as an `<li>` whose text starts with the literal
    `[ ]` and no checkbox (`docs/components/Markdown.md`, the construct
    table), and the editor docs already say that a marker which is no longer
    on its item's first line "saves as the text it shows, `\[x\]`". So
    taking a task item out of its list and keeping `[ ] one` as text changes
    nothing the reader sees, and drops nothing. Source mode's refusal was
    not a decision: its commands lift the item's text and then check that
    the result reads as expected, and the check failed because the marker,
    a separate token, was left behind in an emptied item. Two alternatives
    were rejected. Dropping the marker loses the checked state without the
    user asking. Declining on both surfaces would leave the WYSIWYG toolbar
    offering a command that does nothing on a task item, or need a new
    `false` case in `canSetBlockType` for something Markdown can express.

[^selected-only]: Three reasons. First, the commands are documented as
    converting "the selected blocks", and the off direction already acts on
    the touched items only: the context-menu-caret work measured Lexical's
    `$removeList` and rejected it because it "dissolves the whole top-level
    list … where source mode and the documented contract take out the
    selected blocks". A toggle that reaches untouched items in one direction
    and not in the other is two rules. Second, Lexical's insert has defects
    here that need fixing anyway: with the caret in a block an item holds it
    converts the whole list, or — in a list of the toggle's kind — changes
    nothing while `canSetBlockType` is `true`. Third, each surface stays
    conventional: changing only the selected paragraphs is what word
    processors do, and changing only the selected lines is what every
    Markdown source toolbar does. The alternative — source mode converting
    the whole list — was rejected for those reasons, and because it needs a
    new in-place re-marking edit in source mode with re-indentation of every
    item's later lines.

[^top-level]: `docs/components/MarkdownEditor.md` states the rule for all
    block commands: "A block they convert leaves the quotes and list items
    around it for the top level (or its `:::` column)". The off direction
    follows it on both surfaces. The on direction now follows the same rule
    on both. The cost is recorded here so it is not rediscovered as a bug:
    on the WYSIWYG surface the numbered toggle no longer turns a nested
    bulleted list into a nested numbered one. A nested list of another kind
    is still loaded, shown, edited and saved; it is made in source mode or
    by pasting. Keeping an item at its depth while its kind changes was
    considered and left out (see *Non-Goals*).

[^joining]: A toggle should not change how untouched items read. With the
    blank lines kept, `- one ⏎ - two ⏎⏎ - three` is one loose list in
    Markdown, so making `three` an item put `one` and `two` into paragraphs
    in the viewer. Markdown cannot keep two lists with the same marker
    apart, so the new item is in that list either way; the only choice is
    whether the list stays tight, and tight is what the list was. When one
    of the joined lists is loose the result must be loose, since a Markdown
    list is one or the other as a whole; `$makeItemsOfRun` sets that on the
    WYSIWYG surface for the one case its list rule would not (a tight list
    before the new items, a loose one after). The marker matters for the
    same reason: `* one ⏎ * two ⏎⏎ - three` is two lists.

[^held-block]: Source mode already reads a block an item holds as a block
    of its own and makes it an item. The WYSIWYG result is new. It mirrors
    Enter in an item's text, which the user decided on 2026-10-10: the new
    item takes the blocks that follow. Taking the tail along is also what
    keeps the rule single: a held block is lifted exactly as an item's text
    is, after `$splitItemBefore` has made it the first block of an item.

[^heading-opens]: On the WYSIWYG surface `$liftItemOut` already lifts an
    item that opens with a block ("gives that block and the ones after it
    the same way, with no paragraph"). The toggle adds one step: the heading
    becomes a paragraph, as rule 2 says and as source mode writes it. A
    quote, a code block or a raw block that an item opens with is not read
    as the item: source mode finds no item text on that marker line either,
    so both surfaces treat it as a block the item holds. `setBlockType` on
    such a heading is a different matter and stays as it is (see
    *Non-Goals*).

[^quote-raw]: The WYSIWYG surface has no node for a quote that holds blocks:
    its quote node holds inline content, and the importer loads "a
    blockquote holding more than one paragraph or another block" as a raw
    block (the *Kept as source* section of the component docs). Two ways to
    make the surfaces agree were rejected. Loading such a quote as an
    editable container is a feature of the size of the list item node work.
    Making source mode decline inside a quote would remove a command that
    works and reads back correctly.

[^availability]: "Field `true` means the command changes the document or
    the selection; `false` means it changes nothing at all" is the stack's
    rule (context-menu-caret notes, A-5), with the recorded exception that a
    field covers a command, not a call: `setBlockType("paragraph")` in a
    paragraph changes nothing with the field `true`. The toggles have no
    such call left on the WYSIWYG surface: every touched block either leaves
    its list (off) or becomes an item (on). The parity rows assert the field
    and the change for every row, and the grid of the differential check has
    no toggle that is available and changes nothing (168 at the parent).
    Source mode's field is constant by design: where a source command
    declines "depends on the raw text around the selection, which is not
    predicted" (`readSurfaceSelectionState`).

[^own-route]: Lexical's `$insertList` goes by the nearest list of each
    selected leaf and replaces that list node whole, so it cannot convert
    one item, and it does not know an item that holds blocks: in a block an
    item holds it converts the whole list or changes nothing. The item
    operations already do every structural step the toggles need.
    `$liftItemOut` outdents a nested item level by level, splits the lists,
    carries the tail and moves the selection's points; it returns the blocks
    that left the list, which is exactly what becomes the new item. One
    discrete update keeps the toggle one undo step, as the off route was.
    An *off* toggle used to call `setBlockType("paragraph")`; it now lifts
    the items directly, so that an item that opens with a heading leaves its
    list too. For the 447 grid cases where the toggle was off at the parent,
    the saved text and the caret are the same.

[^split-before]: The alternative was to lift the held block by hand, as the
    old plan's `$liftOutOfLists` did. `$splitItemBefore` keeps one lift for
    every block: after it, the block opens an item, and `$liftItemOut` does
    the rest, the tail included. It lives in `markdownListItemNode.ts` with
    the other item operations, and constructs the item with
    `new MarkdownListItemNode()` so that its return type is the editor's
    class.

[^source-lift]: The old rule — every list item re-opened by its own marker —
    kept the document's structure exactly, and was the right rule while the
    WYSIWYG surface held no blocks in list items. It now differs from
    `$liftItemOut` in two ways: the tail stays in the list, and a nested
    item's own nested list keeps its depth under an empty item
    (`- - - - n` in row 12 of the "today" table). Both are changed, so that
    one rule describes the lift on both surfaces. A quote keeps the old
    rule: the WYSIWYG surface has no editable quote that holds blocks, so
    there is nothing to match. Applying the new rule only to the list
    toggles, and leaving the block types and the fence as they were, was
    rejected: `M1 h2` and `M1 code` would then differ between the surfaces,
    and `liftLines` would need two modes.

[^source-design]: Every source-mode line command is "lift, then check by
    lexing": the check is what makes the commands safe on arbitrary text,
    and a command whose result does not read as intended declines. Keeping
    that design means a mistake in the new code makes a command decline
    rather than write a wrong document. The marker is escaped as `\[ \]` so
    the saved text matches what the WYSIWYG serializer writes for the same
    text, and so `[x]` cannot turn into a reference link where the document
    defines `[x]` (row `T10`).

[^source-runs]: With one join for the whole selection, a selection of a
    paragraph, a `*` list and a paragraph found no list above its first
    block and none below its last, wrote both new items with `-`, and left
    the blank lines: three lists, or one loose list, where the WYSIWYG
    surface makes one tight list (row `X9`). And a block lifted out of a
    nested loose list into the tight list around it kept blank lines on both
    sides, which made that list loose (row `X11`). Reading the join per run,
    and counting the list around the run as a joined list, fixes both. A
    numbered item written after the item it leaves takes that item's number
    and one (`9. one` gives `10. second`), which is as close as source mode
    gets without renumbering untouched lines.

[^tests-in-tables]: The viewer model is compared rather than the saved text
    because the two surfaces legitimately write some things differently:
    source mode leaves untouched lines as they are (a numbered list's later
    numbers, the absence of a blank line between two lists), and the WYSIWYG
    surface writes changed blocks in its standard form. Pinning each
    surface's exact text as well keeps those differences from growing
    unnoticed. Rows that must not read alike follow the round-trip harness's
    rule for known divergences: a listed difference that disappears turns
    its test red until the row is moved. The first assertion of a `SAME` row
    is there because looseness is only comparable for documents written the
    way the editor saves them. The plan of 2026-10-06 put the matrix in a
    new test file; the project's rule is rows in the existing table-driven
    files, and the `describe` that already compares the two surfaces is
    where these rows belong.

[^h-rows]: Rows `H4` to `H6` were added by the list item node branch to pin
    what Lexical's insert did there, so that the node change would not alter
    it unnoticed. They record observed behaviour, not a decision: the
    context-menu-caret notes say of the other direction that it "was not
    touched", and the user's decision of 2026-10-06 is the contract this
    plan carries out.

[^in-item-blocks]: Measured with this plan's change: `setBlockType("h2")`
    with the caret in `second` of `- one ⏎⏎   second ⏎⏎ - two` gives
    `- one ⏎⏎   ## second ⏎⏎ - two` on the WYSIWYG surface and
    `- one ⏎⏎ ## second ⏎⏎ - two` in source mode; `setBlockType("paragraph")`
    there changes nothing on the WYSIWYG surface (the block is already a
    paragraph) and takes the paragraph out of the list in source mode. The
    component docs record the WYSIWYG behaviour: "A block type set on such a
    further block changes it in place".

[^looseness]: The WYSIWYG surface keeps one loose flag per list, set when
    the list is loaded. A list that was loose only because one of its items
    held a block keeps the flag when that block leaves, and the save can
    still write it loose where the list has one item with a nested list: a
    blank line between the text and the nested list. In source mode the
    blank line was never there. In the grid of the differential check, 186
    cases differ in looseness alone on the branch: 177 of this kind, all in
    documents where a nested list is followed by a block, and 9 in documents
    that are not written the way the editor saves them, where looseness
    cannot be compared.

## Implementation Notes

Implemented on `feature/markdown-list-toggle-task-item-parity`, on top of
`feature/markdown-language-enter-inside-html` at `d685c8a54`, which these
notes call "the parent". Scratch files named below are under
`~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/impl/list-toggle/`
("the scratch folder"). They are not in the repository. The planner's files
are under `…/scratch-keep/plans3/list-toggle/` ("the planner's folder").
In these notes W is the WYSIWYG surface and S is source mode.

**The scope was narrowed on 2026-10-11.** The source-mode lift rule — rule
2 reversed in source mode too, so that what a list item holds after its
text leaves the list with it there as it does on W — was implemented, went
through five reviews, did not converge, and was deferred on 2026-10-11 to
a plan of its own. Each review found new defects in it; the fifth found
four blocking ones, all in source mode, all in the lift rule or in the
reading of tabs added for it. This branch holds the rest of the plan: the
W toggles, the task marker on both surfaces, the joining of new items on
both surfaces, and the rows that pin them. In S an item's later blocks
stay in the list, as at the parent. Every row where the surfaces differ
for that reason is a pinned `DIFFERS` row, and the docs state the
difference. The deferred work is kept whole on the branch
`wip/markdown-source-list-lift`, at `1fab9b22b`. The last section of
these notes says what a later plan needs from it.

**Where the review stands.** Six reviews, each by a fresh reviewer; the
audit loop's cap is three, and the coordinator ran the fourth to the
sixth. The fifth held the W half under 40,068 cases with nothing found.
After it the branch was measured without the lift rule (*State I*, next)
and rebuilt as that state, with the two fixes the measurement and the
fifth review asked for in it (D19, D20) and the fifth review's advisory
points that apply. The sixth review read the rebuilt branch. Over about
2.3 million cases it found no defect in what the code does and no
regression. Its one blocking finding was about pinning and documenting:
shapes where the surfaces differ that no row pinned and the docs did not
state, while the docs said their list was complete. Its advisory points
were about test names, these notes, two docs sentences, one timing and the
code conventions.

The changes made after the sixth review are test rows, docs, these notes
and D21 (in `markdownSourceLines.ts`, six blank lines and one loop
rewritten so that its condition holds no call). **No reviewer has read
them**, and the coordinator closed the plan without a seventh review. What
was checked instead:

- Every expected text of the new rows and tests was taken from the output
  of the planner's probe on the branch (`adhoc/r7rows-tipN.jsonl` and
  `adhoc/r7rows2-tipN.jsonl` in the scratch folder; `r7_rows.py` wrote
  most rows from it), not written from what the result should be.
- After D21 the source-mode result of all 68,522 cases of the differential
  sets is the one recorded before it (`why/srcall-tip7.txt`: 0 differ; the
  same probe on the code before D21, as a control, also 0).
- Every case of those sets where the surfaces differ was put under a clause
  of the docs' list, by the reason source mode itself gives for declining
  (D22).
- The checks of *Checks*, on the final code.

*Narrowed on 2026-10-11*, the amended decision "`canSetBlockType` keeps
its rule" and the decision "WYSIWYG: the ends of the selection are settled
into blocks of text first" stand outside these notes, in the plan's own
text, and were added during implementation, in the sixth round. They are
there because a plan in `plans/implemented/` is read as what the code
does: a reader of *Architecture Decisions* would otherwise find the lift
rule described as landed and no decision at all for the settling step,
which is the largest piece of code the plan did not foresee. The sixth
review asked that this be said here. Nothing else outside these notes was
changed.

### State I, and what the measurement showed

State I is the branch without the two lift-rule commits: the first code
commit of the fifth round (`9ad203923` on `wip/markdown-source-list-lift`).
Before anything was changed it was built in a private copy and run against
the parent on every set there is: my nine differential sets, the sets of
reviewers 1 to 4, and the fifth review's probes and its 267,212 source
rows. The full table is `stateI-measure.md` in the scratch folder. In
short, per finding of the fifth review:

| Finding | With the lift rule | In state I |
|---|---|---|
| B1: `setBlockType("code")` does nothing on text that holds a tab | yes | no |
| B2: `analyzeMarkdownSource` slows down quadratically on tab-indented code of a list item (821 ms at 400 lines, 13 s at 1,600) | yes | no (2 ms, 6 ms; the parent: 1 ms, 4 ms) |
| A1: the tab-aware search can find a block on a later look-alike line | yes | no (`markdownSourceTokens.ts` is the parent's) |
| B3 (a) to (f): six families where a command that acted at the parent declines | 91, 210 and 542 to 721 rows of the reviewer's plain, trailing-whitespace and tab sets | none of the lift's; one family of its own, 48 rows, see D19 |
| B4: docs and changelog overstate what is done about tabs | yes | no: nothing of state I's docs speaks of tabs |
| A2: a range end on a holder's edge settles into a block outside the range | yes | yes, the W code is the same; see D20 |

So state I had two things to fix, both caused by the first code commit,
and both are fixed on this branch. Over the planner's probe (68,522 cases)
and the fourth reviewer's (2,822) state I already had no command that
acted at the parent and declines; the 48 rows showed only in the fifth
reviewer's source rows.

### The rules

For the areas where the reviews kept finding corners, the rule that decides
every case was written down, the shapes it has to cover were listed, and
the rows were built from that list.

**Rule B: where an end of the selection settles, and what the commands act
on** (D16, D17, D20). A block type or a list toggle acts on blocks of text
and on nothing else. Before it reads them, each end of the selection that
stands on a node that holds blocks is settled into a block of text.

- **A caret** goes into the block of text beside it: the one after it,
  else the one before it. The way to a side goes down through lists,
  items, `:::` blocks and columns, and stops at a table. A column it finds
  empty takes the caret and gets a paragraph for it. With no place to go
  on either side the caret goes into a new empty paragraph, beside the
  table that stood in the way, or as the one block of an empty document or
  column.
- **The ends of a range** go inward, in document order: the start into the
  first block of text after it, the end into the last block of text before
  it, wherever in the document that block stands. A table, and a column a
  deleted table left empty, are passed over. So the blocks the command
  changes are the blocks of text between the two ends, and never one
  outside them. An end that stands on an empty document or column stands
  in it, and that holder gets its paragraph.
- **A range with no block of text between its ends** names nothing. It is
  a caret where it starts.

A node that holds blocks is told by what it is (the root, a `:::` block, a
column, a list, a list item, a table, a row, a cell), never by what it
holds at the moment. `canSetBlockType` is `true` exactly when this leaves
a block to act on: the selection touches no table cell and does not stand
on tables alone.

The shapes: each kind of holder; each offset on it (before the first
child, between two, after the last, and in an empty one); what stands
beside (a block of text, a holder to go down, an empty column, a table,
nothing); the selection (a caret, a range's start, a range's end, both
ends on holders, a range that holds no block); and the command (both
toggles, a heading, a code block). Rows `H25` to `H72` and seven
availability rows pin single cases. The test "with an end on any node that
holds blocks, a command changes the document exactly where canSetBlockType
is true, and no block outside a range" runs every point on every holder of
sixteen documents, as a caret and as either end of a range, with four
commands. For each it checks that the document changes exactly when the
field is `true`, that no end is left on a holder, that no block of text
outside the range is another block afterwards (its type, a heading's
level, the kind of list it opens an item of, its text), that the save
reloads and the viewer reads it alike, and that one undo step takes it
back.

**Rule C: a range over a node that holds nothing** (D16). A node that
holds blocks is never one of the blocks a command touches. So a range that
covers a column a deleted table left empty, or the `:::` block around it,
leaves it as it is and changes the blocks of text around it. An item a
deleted table left empty has an empty text, which is a block of text and
is converted like an empty paragraph. A table cell left empty is in a
table: the selection touches a cell and the commands are unavailable. An
emptied document holds no range, only a caret, which rule B gives a
paragraph. An emptied column gets its paragraph only when an end of the
selection stands on it or a caret settles into it.

| What is empty | A range covers it | An end stands on it, or a caret beside it |
|---|---|---|
| a `:::` column | `H51` to `H54` (both toggles, a heading, a code block), `H72`: left as it is | `H57` (the start), `H58` (the end), `H38`, `H42` to `H45`, `H47`, `H71` (a caret): gets a paragraph |
| a centred `:::` block | `H55`, `H56`: left as it is | `H39`, `H46` |
| the document | holds no range | `H40`, `H48` |
| a table cell | `H65`: unavailable, nothing changes | unavailable |
| a list item | `H59`, `H60`: its empty text is converted | the caret is in its text |

**Rule D: a new item joins the list next to it, unless that changes how
the list reads** (D19). In S, `listOn` writes the new items of a run line
after line and joins them to the list of their kind next to them, as the
plan says and as W does. A list that gains an item below it no longer ends
where it did. When no form of the joined edit reads as intended, the
items are written as a list of their own (`-`, or `1.` counting from one),
each block's where it stands and the blank lines around it left alone,
which is what the parent wrote, and that edit is checked the same way. So
a list toggle never declines because of the joining.

### Decisions that await the user's sign-off

**1. The source-mode lift rule is deferred, and the surfaces differ where
it would have applied.** The user had been told of the lift rule and had
not yet confirmed it. It is not on this branch. What an item holds after
its text leaves the list with the text on W, and stays in the list in S,
in an item its marker re-opens, as at the parent.

| Document | Caret | Command | W on the branch | S on the branch (and at the parent) |
|---|---|---|---|---|
| `- one ⏎⏎   second ⏎⏎ - two` | `one` | bulleted toggle | `one ⏎⏎ second ⏎⏎ - two` | `one ⏎⏎ - second ⏎⏎ - two` |
| same | `one` | `setBlockType("h2")` | `## one ⏎⏎ second ⏎⏎ - two` | `## one ⏎⏎ - second ⏎⏎ - two` |
| `- one ⏎⏎   second ⏎⏎   third ⏎⏎ - two` | `second` | bulleted toggle | `- one ⏎⏎ - second ⏎⏎   third ⏎⏎ - two` | `- one ⏎⏎ - second ⏎⏎ - third ⏎⏎ - two` |
| `- o ⏎   - m ⏎     - x ⏎       - n ⏎     - y ⏎   - k` | `x` | bulleted toggle | `x`, then `- - n ⏎   - y ⏎   - k` | `x`, then `- - - - n ⏎     - y ⏎   - k` |
| `- [ ] one ⏎⏎   second ⏎⏎ - [x] two` | `one` | any | converts, `second` goes with it | does nothing (the parent did nothing on any task item) |
| `- one ⏎⏎   --- ⏎⏎ - two` | `one` | either toggle | converts | does nothing |

These are the 70 rows that the two surfaces read alike only with the lift
rule: 60 of the plan's `SAME` rows and ten that were written for the lift.
They are `DIFFERS` rows now, each with the text S gives: `T9`, `T14`,
`T16`, `X23` to `X25`,
`S6`, `M1`, `M6` to `M8`, `M10`, `M12` to `M15`, `M17`, `M18`, `M20`,
`M22`, `M24` to `M28`, `M30` to `M32` and `C3`. In 60 of them S acts and
leaves the blocks in the list; in 10 (`T9`, `T14`, `T16`, `M27`) S does
nothing. The docs state the difference first in their list, as one that
is to go, and the changelog entry says it stays for now.

The deferral leaves S doing nothing in more places than those ten rows
show, which the sixth review found unpinned and missing from the docs. S
re-opens what stays behind in the list by the item's marker and checks
the result by lexing it. Where the lines would not read as they did under
that marker, it declines, at the parent and on this branch alike.

| Shape | Documents, and the caret | S here and at the parent | S with the lift rule | Rows |
|---|---|---|---|---|
| a block or a nested item inside a task item, with more of that task item after it: the marker re-opens a plain item | `- [x] alpha ⏎   - beta ⏎   - gamma ⏎ - delta`, `beta`; `- [x] alpha ⏎⏎   beta ⏎⏎   gamma ⏎ - delta`, `beta`; `- [ ] a ⏎   - b ⏎⏎     held ⏎ - c`, `b` | nothing | acts | `T19` to `T21` (eight) |
| a block right before a thematic break written in the list's marker character: `- ---` is a break outside the list | `- one ⏎⏎   para ⏎⏎   --- ⏎⏎ - two`, `para`; `- one ⏎   - inner ⏎⏎   --- ⏎⏎ - two`, `inner`; `* one ⏎⏎   *** ⏎⏎ * two`, `one` | nothing | acts | `M33` to `M35` (eight); `M27` is the item's own text |
| the same with the break in another character, or a block between the two | `- one ⏎⏎   *** ⏎⏎ - two`; `- one ⏎⏎   mid ⏎⏎   --- ⏎⏎ - two`; `one` | acts, the break stays in the list | acts, and reads as W | `M36`, `M37` |

Both thematic-break shapes of the sixth review are left by the deferral,
not something the lift rule had too: on `wip/markdown-source-list-lift`
S acts on each of them. The last block of a task item converts on both
surfaces (`T15`, a `SAME` row). Of these 18 rows, 16 read alike on the two
surfaces with the lift rule; `T20 h2` and `M33 h2` then still differ, by
the Non-Goal on `setBlockType` inside an item. Five of the rows of
sign-off 8 also change with the lift rule and then read alike: `E24`
(two, a tab-indented block after the item's text), `E30` (two, text that
opens with `[ ] ` after it) and `E34` (an HTML block indented deeper than
its item's content). A command over several blocks does nothing in S when
one of them is such a block. The docs say all of this in the paragraph on
the difference that is to go, and the changelog entry names the two
shapes.

**2. Corrections to the plan's code that remain.** The plan's code was
applied as written first, and at that point the four modules were byte for
byte the planner's prototype. Of the defects found after that, these are
in code this branch keeps: D1 (W, a comparison of two nodes), D10 (S, the
sides a new item joins on), D16, D17 and D20 (W, what the commands do with
a selection end on a node that holds blocks, which the plan does not
decide), and D19 (S, rule D).

**3. `canSetBlockType` is `false` for a selection that stands on tables
alone** (D17). The plan says the field's code does not change. It gained
one clause: `false` when both ends of the selection stand on a table or
one of its rows and no block of text lies between them. Only code makes
such a selection.

| Selection | At the parent | On the branch |
|---|---|---|
| a caret on a table, between two rows | `true`; both toggles and `setBlockType` change nothing | `false`; they change nothing |
| a caret on a table at its first or last edge | `false` | `false` |
| a range from a paragraph to the edge of the table next to it | `true`; the paragraph is converted | the same |

If the answer is no, take the clause out of `$readCommandAvailability`
and say what a caret between two rows should make the commands do: with
the field `true` they have to change something there.

**4. `setBlockType` settles the ends of the selection as the toggles do**
(D16). The plan changes the toggles. A caret where a deleted table leaves
it is the same caret for `setBlockType`, with the same field `true`.

| Document, after `deleteTable()` | Command | At the parent | On the branch |
|---|---|---|---|
| a `:::` block of two columns, the table was all the first one held | `setBlockType("h2")` | nothing | `::: columns ⏎ ## ⏎ \|\|\| ⏎ Right ⏎ :::`, the caret in the heading |
| the table was all the document held | `setBlockType("code")` | nothing | an empty code block, the caret in it |
| `- a ⏎ - b`, the table stood below the list | `setBlockType("quote")` | nothing | `- a ⏎⏎ > b` |

For a selection made by a click or a drag nothing changes: the step only
moves an end that stands on a node that holds blocks.

**5. A range's ends go inward, so no block outside the range is changed**
(D20). The fifth review found that a range end on a holder's edge was
settled into the block beside it even when that block lay outside the
range, and the command then changed it.

| Document | Range | Command | At the parent | Before D20 | On the branch |
|---|---|---|---|---|---|
| `- a ⏎   - n ⏎ - b` | from the end of item `a`, after its nested list, to `b` | `setBlockType("h3")` | `b` alone | `n` and `b` | `b` alone |
| `first ⏎⏎ - a ⏎ - b` | from `first` to the list's start, before `a` | numbered toggle | the whole list, as its toggles did then | `first` and `a` | `first` alone (`H33`, restated) |
| `x ⏎⏎ - a` | from the root before the list to the list's start (no block between) | bulleted toggle | `- x ⏎ - a` | `x ⏎⏎ a` | the same: a range that holds nothing is a caret where it starts, and a caret goes into the block after it |

In the scratch sweep of 25,620 selections with an end on a holder a block
outside the range changes in none on the branch. At the parent one does in
1,007.

**6. A range over an emptied column leaves the column as it is** (D16,
rule C). At the parent a list toggle over such a range took the column for
a block: it wrote the list straight into the `:::` block and the column
was gone (`- x ⏎⏎ ::: {} ⏎ - Right ⏎ ::: ⏎⏎ - y`). Now the column stays,
empty, and the blocks of text around it are converted
(`- x ⏎⏎ ::: columns ⏎⏎ ||| ⏎ - Right ⏎ ::: ⏎⏎ - y`). `setBlockType`
always left it. The other reading, that a covered empty column gets an
empty item or heading of its own, was not taken: a column holds no block
until the caret needs one.

**7. In S a new item that cannot join stands apart** (D19, rule D). Where
joining the list next to it would change how that list reads, S writes
the item as a list of its own, as the parent did, and W still joins. For
`2) a`, a blank line, an indented code line that ends in a space, `- b`,
the numbered toggle on `b` gives `1. b` in S. The shapes are documents
the editor does not save itself: trailing whitespace, indented code, a
fence left open at a list's end.

**8. Differences between the surfaces that were there at the parent are
pinned** (D11, D22). In a block that holds a backslash line break the S
list toggles do nothing when the selection takes the line after the
break, and the S heading types do nothing at all, where W converts the
block as one (rows `E16`, `E17`). And on the text of a list item whose
marker line holds a tab, right after the marker with further lines in the
item or inside the text, W converts and S does nothing (rows `E19`).

The sixth review found three more that no row pinned and the docs did not
list, and the check made after it (D22) found the rest. All are the parent's; none is changed here.

| Difference | Rows |
|---|---|
| a heading type on a block of several lines: a heading per line in S, one heading on W. The plan's Non-Goal on single lines says so; no row and no docs clause had it | `E20`, `E21` |
| a list toggle on a heading written with a setext underline, the form W saves a heading of several lines in: S does nothing | `E31` (two), `E36` |
| a list W keeps as a raw block (written tight, with a block right under another): W acts on the block as a whole and S on its lines; a new item beside it joins it in S alone; nested in an item, it leaves with the item's text on W alone | `E22` (two), `E23`, and two tests after the `DIFFERS` loop, whose documents still hold the raw block afterwards |
| a block or a nested list of an item indented with a tab: S does nothing on it, or on a block before it in the item | `E24` (two), `E25` to `E27`, and the plan's own source-mode row "a list toggle declines over a tab-indented block of the item" |
| text that opens with an unescaped `[ ] ` or `[x] `: the S toggles do nothing (the new item would read as a task item, and `listOn` tries no escaped form), W writes `\[ \]`; and S does nothing on the block right before such text in a list item | `E28` (two), `E29`, `E30` (two) |
| indentation the editor does not write, where the lines after the result would read otherwise: a block indented below an empty list item, a list whose markers are indented, an HTML block indented deeper than its item's content | `E32`, `E33`, `E34` |
| an item whose marker stands on a line of its own: S converts the text and leaves the emptied marker as an empty item, W removes it | `E35` |

The docs state each. What S does with tabs and with a task item belongs
to the follow-up plan; an escaped form for the `[ ] ` text and the setext
heading under a toggle are small changes to `listOn` and `toggleList`
that no plan holds yet.

**9. The documentation is one commit**, and says these things beyond the
plan's text in `docs/components/MarkdownEditor.md`. In the *Lists*
bullet, for rules B and C: "With an end of the selection between two
blocks rather than in a text — `deleteTable()` leaves the caret on a
list, a list item, a `:::` block or one of its columns, or on the
document itself — a list toggle and `setBlockType` act on blocks of text
all the same. …", through "… where these commands are unavailable, as
they are for any caret on a table." In the Command API table the
`canSetBlockType` row gains "or stands on a table and holds no block of
text". In the source-mode paragraph, rule D. In the paragraph that lists
where the surfaces differ: the deferred difference, named first as one
that is to go, and the clause on a backslash line break. The plan's own
sentences on the lift rule in source mode are not in the docs: the
source-mode paragraph keeps the parent's "what followed it inside them
stays there, re-opened by its own marker". The changelog entry for the
toggles says the difference stays for now, and one entry under *Fixed*
that the plan does not ask for covers the commands where a deleted table
leaves the caret.

After the sixth review the paragraph on the differences is three
paragraphs (D22). The first is the difference that is to go, with the
shapes where S does nothing because of it. The second holds the
differences that stay, for Markdown the editor writes. The third holds
the ones that only Markdown written by hand has. The first sentence now
limits the claim that the list is complete to Markdown written as the
editor saves it. The clause on raw Markdown blocks no longer says that S
does nothing on every one: on a blockquote or a list that W keeps raw, S
acts on the lines. The toggles' row in the Command API table says when a
joined list is tight and when it is loose, where it said "which stays
tight".

**10. On W a toggle of the other kind over a whole list takes about twice
the parent's time, and the docs now point to that selection.** The
toggles' row and the changelog say "select a whole list to convert it
whole". Measured on an idle machine with the sixth reviewer's probe
(`a5/` in the scratch folder): a tight bulleted list, the numbered toggle
over all of it, headless.

| Items | Parent | Branch |
|---|---|---|
| 125 | 42 ms | 91 ms |
| 250 | 175 ms | 362 ms |
| 500 | 707 ms | 1,296 ms |
| 1,000 | 2,652 ms | 5,208 ms |

Both grow with the square of the list, and the cause is not in this
branch's code. Of the 5.2 s at 1,000 items the toggle's own work is about
60 ms: 2 ms to read the touched blocks, 42 ms to lift them out, 9 ms to
make the items. A CPU profile at 600 items puts 1,724 of 1,857 ms in
`$keepLoosenessWritable` (`markdownWritable.ts:584`) and the
`$listReadsLoose` it calls, which reads the whole list. That is a node
transform from before this plan. It runs once for every list item an
update leaves dirty (`markdownWritable.ts:367`) and once more for every
dirty item text or paragraph (`$keepLoosenessOfItemHolding`, `:391`). The
parent changed each item's list in place and paid it once per item (656
of 940 ms at 600 items). The branch lifts each item out and makes a new
one, so each item has a new item node and a new text node and pays it
twice. Making 1,000 paragraphs a list pays the same on both (4,422 ms at
the parent, 4,994 ms on the branch), and taking a whole list out of its
kind got faster (640 ms to 140 ms).

It was not fixed here. Nothing the toggle does per item can be done once
instead, short of a second route for the whole-list case that changes the
list in place, which is the code this plan replaced. And the transform is
not this plan's. The fix belongs there: let a dirty item mark its list,
and read the list's looseness once per update, in the `ListNode`
transform. That takes the square out of every list edit, this toggle and
the 1,000 paragraphs alike. If twice the parent's time is not acceptable
until then, take the advice out of the docs; the toggle should not go
back to converting a list it was not asked to convert.

### The base

The plan was written against `85b55a8f4`. The parent is two branches above
it. `git diff --stat 85b55a8f4 d685c8a54` names none of the four source
modules, none of the four test files, and neither `markdownSourceTokens.ts`
nor `markdownWritable.ts`, the round-trip harness or
`docs/components/MarkdownEditor.md`. Every line number of the plan holds.
`docs/reference/changelog/next.md` gained 30 lines from the two branches.

The plan's source-mode claims hold at the parent: the planner's probe, run
at `d685c8a54`, writes output byte-identical to the planner's
`parent-final`, `parent-differs`, `parent-grid` and `parent-rand` files
(7,979 cases).

### How the plan's steps went

| Step | The plan's check | Measured |
|---|---|---|
| 2 | `S26` fails, 27 pass | so |
| 3 | 14 named `H` rows fail | the same 14 |
| 4 | 181 fail: 157 `SAME`, 8 `DIFFERS`, 2 `CASES`, 9 source rows, 5 availability | the same 181, by name; the 25 controls pass |
| 5 | 2 fail | the same 2 |
| 8 | 139 fail in the step 4 file: 126 `SAME`, `Q2 UL`, `Q2 OL`, `E5 code`, `E15 OL`, 9 source rows | the same 139 |
| 9, 10 | all pass | all pass (7,439 tests in the step 10 list) |
| 12 | the probe's output equals `expected-*.jsonl` | identical for all four sets at that point |

The test rows were applied from the planner's `tests-on-85b55a8f4.diff`
after checking it line by line against the plan's code blocks: every line
of the plan's test code is in it, and it holds nothing the plan does not
ask for. The
comment above `describe('line commands act on the blocks the viewer reads')`
was not in that diff. The plan changes it to describe the lift rule; on
this branch it is the parent's comment, since the lift rule is not here.

Steps 6 to 8 are `$splitItemBefore`, the `inListItem` parameter of
`$serializeInlineNodes`, and `MarkdownEditor.ts`. Step 9 is
`markdownSourceLines.ts`, the lift rule in `liftLines` among its changes.
All were carried out and their rows passed; the lift rule was then taken
out again with the deferral. The counts in the table were measured on the
full plan.

### Deviations

D2, D3, D7, D8's `rand` rows, D12 to D15 and D18 of earlier rounds concern
the lift rule. They are in the last section. The numbers of the others are
kept.

**D1. `$makeItemsOf` compares two blocks by key.** The plan's code read
`blocks[0]!.getPreviousSibling() !== before[before.length - 1]`. Lexical
clones a node the first time an update writes to it. A block lifted early
stays in its group as the object it was then, and `getPreviousSibling()`
returns the clone. When a later lift had written to that block — putting an
item's paragraph in front of it sets its previous-sibling pointer — the
comparison read two neighbours as standing apart and split one run in two.
The first half found no list below it and made a new list; the second half
joined that list instead of the list of its kind below the run.

`- zero ⏎⏎ one ⏎⏎ two ⏎⏎ 1) three`, range `zero` to `two`, numbered toggle
gave `1. zero ⏎ 2. one ⏎ 3. two ⏎⏎ 1) three`: two lists, where rule 4 and
source mode make one. It now gives `1) zero ⏎ 2) one ⏎ 3) two ⏎ 4) three`.
The comparison is `before[before.length - 1]!.is(…)`. Rows `X21` and `X22`
pin it. In the extra scenario set `dxa` (below) it changed 72 of 2,112
cases, all on W; none of the planner's sets holds the shape.

**D4. Three calls moved out of `if` conditions in two functions**, by the
user's rule that a call's result is assigned to a named constant first:
`isTaskMarker` in `readLeaves`, and `isOfKind` / `holdsTarget` in
`neighbourList`. Type guards that narrow stay in the condition, as the
plan says. Conditions the plan carried over from existing lines are left
as they were.

**D5. One code commit, which is state I with four changes.** The fifth
round had two code commits, so that the lift rule could be read and
reverted alone; its first one, state I, was derived from the full state by
`split/make_I_source.py` and `split/make_I_tests.py` in the scratch
folder. This branch's code commit is that state plus D19, D20, the
seventy rows of sign-off 1, the fifth review's advisory points, and what
followed the sixth review: D21 and the rows and tests D6 counts. In it
`markdownSourceLines.ts` has the parent's `liftLines`, `reopenContainers`,
`LineReplacement`, `containerPrefix` and `itemIndent`; `expectLeaves`
takes several leaves for one (the task marker) but no lifts; `listOn` and
its helpers are the plan's without `follow` and without the lifts.
`markdownSourceTokens.ts` is the parent's and is not in the diff.

**D6. Rows beyond the plan's, and rows of the plan that moved.** `SAME`
has 132 rows: 122 of the plan's 182, and `X21`, `X22` and `X26` to `X33`.
`DIFFERS` has 142 rows: the plan's 26, `E16` (three), `E17`, `E19` (two),
the 70 of sign-off 1 and the 40 added after the sixth review (18 under
sign-off 1, 22 under sign-off 8); two tests follow its loop. The `H`
table has seventeen more rows than the plan's, `H25` to `H41`, and a
second table after it has `H42` to `H72`, seven availability rows, three
single tests and the sweep of sixteen documents.
`markdown-source-edits.test.ts` has 4 new tests.

Of the plan's nine new source-mode rows three are in the test file: "a
new item written against a tight list takes every blank line between
them", "a task marker stays with the first line of its item's text" and
"a list toggle declines over a tab-indented block of the item". The third
needs no lift rule, passes at the parent, and was left out by mistake
when the branch was narrowed; the sixth review found it missing. The
other six need the lift rule and are not here. The two restated
source-mode rows and the two restated tests of
`markdown-source-edits.test.ts` keep the parent's expected text. Two
tests of that file had been renamed for the lift rule while their
expected text stayed the parent's; they are named for what they pin now:
"lifts a block out of a quote that a list item holds, and re-opens the
item on the quote's next line" and "re-opens the item around a quote on
the next item of the quote's list".

**D8. The plan's differential step 3** asks for output identical to the
planner's `expected-*.jsonl`. Those hold the lift rule's results in S, so
they are not met in S on this branch where the lift applies. In W the
probe's output is the planner's for `final`, `differs`, `grid` and `rand`
(7,979 rows, none differs).

**D9, D16. One step settles the ends of the selection, for both toggles
and `setBlockType`.** The plan's code reads the touched blocks from the
selection's two ends and the selected leaves, and takes each for a block
of text. `deleteTable()` leaves the caret on the node that held the
table's neighbour: a list, a nested list, a `:::` block, an emptied column
or the emptied document. Code can put a point on any node that holds
blocks. For such a point the plan's code took the holder itself for the
touched block: it moved a whole list's items into one item's text, made
an empty item, wrote a list into a `:::` block in a column's place, or
threw (`Expected node … to have a parent`). Lexical's list insert, which
the toggles no longer use, did not fail there. The first four reviews
each found another corner of this (a point on a list; a point beside a
table; a column or a document a deleted table left empty; a caret beside
such a column, and a range over it).

`$holdsBlocks` and `$isBlockOfText` tell the two kinds of node by what
they are. `$blocksTouchedBy` gives blocks of text only, so
`$selectedBlocksHaveType` and `$touchedBlocksLastFirst` see no holder.
`$settleEndsIntoBlocksOfText` moves each end as rule B says. `toggleList`
and `setBlockType` call it. The justification, with the ways not taken
and the precedent, is in *Architecture Decisions*, "WYSIWYG: the ends of
the selection are settled into blocks of text first".

`setBlockType` still asks first, in a read, whether every block is of the
type already, and then runs no update, so no undo step and no event. A
selection with an end on a holder answers no there, and is asked again
inside the update once its ends are settled. With every block of the type
that update moves the selection and changes no block (the test "changes
no block, and adds no undo step, when the caret settles into a block that
is of the type already"). A range over an emptied column with
`setBlockType("paragraph")` used to replace each paragraph by an equal
one and add an undo step, because the column was counted as a block of
another type; it adds none now.

After `deleteTable()` under `- a ⏎ - b`, the numbered toggle gives
`- a ⏎⏎ 1. b` (the parent numbered the whole list) and the bulleted toggle
gives `- a ⏎⏎ b` (the parent changed nothing). In a column a deleted table
left empty the toggle gives what the parent gave: an empty item in the
column (`::: columns ⏎ - ⏎ ||| ⏎ Right ⏎ :::`), or `-` for the document,
with the caret in it. Rows `H25` to `H65`.

**D10. The list around a run counts only on the side where part of it
stands.** `readListJoin` took the list of the toggle's kind around the
run's first block for a list above the run: the new item took the number
after its old item, and the blank line above went. That is wrong when the
block is the first thing in that list, which happens when its item opens
with a nested list of the other kind or with a quote (`1. - aa`, the shape
the toggles themselves leave). `one ⏎⏎ 1. - aa ⏎ 2. bb`, numbered toggle
on `aa`, gave `one ⏎⏎ 2. aa ⏎⏎ 2. bb`: numbered 2 and loose, where the
parent and W give `one ⏎⏎ 1. aa ⏎ 2. bb`. The same reading missed two
joins W makes: a run that starts outside a list of the kind and ends in
one (`para ⏎⏎ * > qq ⏎ * bb`, range `para` to `qq`, gave `- para ⏎ - qq`
above `* bb`), and an item that was its list's only one
(`+ > qq ⏎⏎ - bb` kept `+`). Found in the first review.

`readListJoin` now takes the list around the run's first block for a list
above only when its first line is above the run, and the list around the
run's last block for the list below when it goes on below the run. A new
item that stays its list's first takes the number of the item it opened.
Rows `X26` to `X33`.

**D11. A tenth difference between the surfaces, pinned.** The plan's
*Non-Goals* list nine differences that stay. The second review found one
more, in documents written as the editor saves them. In a block that holds
a backslash line break (`one\` / `two`), the S list toggles do nothing
when the selection takes the line after the break, and the S heading types
do nothing for any selection in the block. W converts the block as one
(`- one\` / `  two`; a heading written with its underline). `E1` and `E2`
pin the soft line break, where S acts line by line. The parent behaves the
same, so nothing regressed. It is not removed here: making S take the two
lines as one item, or W split them, is a change to one surface's reading
of a line break. `DIFFERS` rows `E16` (three) and `E17` pin it, and the docs
paragraph on the differences states it.

**D17. `canSetBlockType` is `false` for a selection that stands on tables
alone.** With D16 every end that is not on a table has a block of text.
What is left with the field `true` and nothing to act on is a selection
whose two ends stand on a table or a row with no block of text between
them: a caret between two rows, or a range from the end of one table to
the start of the next with nothing between. The field already was `false`
for a caret at a table's first or last edge, where Lexical reads the
selection as inside a cell. `$selectionStandsOnTablesAlone` adds the rest.
A range with one end on a table's edge and text at the other keeps the
field `true` and converts the text, as at the parent (rows `H61` to
`H64`): `$holderPointOffTable` names that end on the node that holds the
table, and it settles from there. See sign-off 3.

**D19. A new item that cannot join stands apart** (rule D). Found by the
measurement of state I, in the fifth reviewer's rows: 48 of 267,212, all
a list toggle. `listOn` joined the new items to the list of their kind
next to them and checked the result by lexing. A list that gains an item
below it no longer ends where it did, and what its last line read as can
change with that. The shapes found: that line ends in trailing
whitespace, and it closes an indented code block, an HTML block or a
fence left open. The check failed in both forms
and the command declined, where the parent, which did not join, acted.
`listOn` now tries the joined edit first and then the items written apart
(`itemsApart`): `-`, or `1.` counting from one across the blocks, each
block's lines replaced where they stand. Both go through the same check.
After it the fifth reviewer's rows show no command that acted at the
parent and declines (`review5/cmp_tag.py`). The test "writes a new item as
a list of its own where joining the list above would change how that list
reads" pins the join, the fallback, and the open fence.

**D20. The ends of a range go inward.** The fifth review's second
advisory point. `$settlePointIntoBlockOfText` looked for a block beside
the point among the holder's own children, first on the side the end
preferred and then on the other. For a range's start at the end of item
`a`, after its nested list, the side it preferred was empty, so it went
back into the nested item `n`, which lies before the range: the command
then changed `n` and `b`, where the parent changed `b`. The reviewer
counted 2,189 cases with an end on a holder where parent and branch both
changed the document with different results.

`$settleRangeEndsInward` now finds, for each end on a holder, the first
block of text past it in document order, leaving the holder when it has
none on that side (`$blockOfTextPast`). When the start's block comes
after the end's there is no block of text in the range, and the range is
settled as a caret where it starts. The caret keeps the rule it had:
beside it, `$blockBeside` for each side. Of the reviewer's two other
points on this code: `$blockBeside` now only reads, as do `$blockBelow`,
`$blockOfTextPast`, `$blockOfTextIn` and `$takesCaret`, and the writes
are in `$fillEmptyHolder` and `$newParagraphBeside`, whose JSDoc says
what they are given; and the arrow function that told a point on a table
is the function `$standsOnTableOrRow`, with its JSDoc.

Rows `H33` (restated) and `H66` to `H72`, and the sweep's check that no
block outside the range changes. On the code before D20 that check fails
in eight of the sweep's sixteen documents, and `H33`, `H66`, `H67` and
`H72` fail (`red/round6-a2-red.txt`). In the scratch sweep `setBlockType`
now gives another result than the parent in 201 of the cases where both
change the document: 93 are a range with one end standing on an emptied
column, which gets its paragraph (rule C), and 108 are a code block made
of a task item, which holds the marker as written (rule 5).

**D21. Conventions in the code this branch added to
`markdownSourceLines.ts`** (the sixth review's last advisory point). A
blank line stands around each initialiser that spans lines: `sameMarker`
in `readListJoin`, `itemFollows` in `replacedLines`, `lines` in
`itemReplacement` and `found` in `neighbourList`. `nearestTextLine` had a
`do … while` whose condition called `isBlank`; it is a `while` over a
flag that the loop's body assigns. Nothing else in the file changed, and
the source-mode result of every differential case is the same before and
after (*Where the review stands*).

**D22. Every difference between the surfaces, by clause** (the sixth
review's blocking finding). The docs said their list of differences was
complete, and it was not. To make it so, each case of the differential
sets where the viewer reads the two results differently was put under one
clause. The planner's probe gives 68,522 cases; in 33,332 the surfaces
differ. Where S declines, the reason was not guessed from the document's
shape: a private copy of the branch was instrumented so that every `null`
a line command returns records why (`why/patch.py`; the line no block
holds, the kind of block touched, the line that cannot be re-opened, or
the first leaf of the result that is not the expected one), and each
differing case was run through it (`why/out-b12.jsonl`). Where both
surfaces act, a case goes by the lift branch's result for it and the
shape of the touched lines. `why/categories.py` does the sorting.

For Markdown written as the editor saves it, 11,078 of the differing
cases:

| Clause of the docs | Cases |
|---|---|
| to go: S acts and leaves what follows in the list | 3,901 |
| to go: S does nothing, a task item with more of it after the block | 2,722 |
| to go: S does nothing, a thematic break in the list's marker right after | 55 |
| a code block, an HTML block or a thematic break touched or in the selection | 2,046 |
| `setBlockType` on a block an item holds, or the heading it opens with | 1,007 |
| a backslash line break | 560 |
| a `:::` or `\|\|\|` line in the selection, a `:::` block of a list item | 353 |
| looseness alone: a list left as one item that holds only a nested list | 265 |
| a raw Markdown block that is a list or a quote: one block on W, lines in S | 134 |
| an empty list item in the selection | 20 |
| `setBlockType("code")` over several blocks | 10 |
| single lines of a block made items, and a heading per line | 5 |

None is left over. Four of the 1,007 were sorted by hand (an item that
opens with a nested item that opens with a heading), and twenty of the
134 by reading them: documents that hold a list W keeps as a raw block,
where a new item beside it does not join it and where it leaves an item
with the item's text. Those two things were not in the docs and are now.
The setext heading under a toggle does not occur in these sets in a form
the editor saves; a hand row showed that it can (`E31`).

The other 22,254 differing cases are in documents the editor would not
write as they stand, most of them random documents of the reviewers whose
blank lines W re-spaces whatever the command does. Sorted the same way,
they fall under the clauses above, and under four shapes that only such
text has: a list toggle on a setext heading (54), a block indented below
an empty list item (215), a list whose markers are indented (1), and an
item whose marker stands on a line of its own, which S leaves behind
empty. The sorting left 32 cases over, in nine documents, and those were
read one by one: three are counted in the two shapes before, and the 29
where both surfaces act are the marker on a line of its own, a heading an
item opens with, and a list W keeps as a raw block. Tabs and text that
opens with `[ ] ` are not in the sets; the sixth review found them by
hand, and `why/hand.jsonl` holds the shapes probed for each (which block
has to be indented by the tab, which character the break has to be
written in, and so on), so that the docs' wording says no more than was
run.

The docs' third paragraph lists the hand-written shapes. Their list is
what the sets and the hand probes show, not a proof: source mode declines
wherever no form of its edit reads back, and text can be written in more
ways than the sets hold. For Markdown the editor saves, the list is
complete over the sets.

A limit of the method: for a command over several blocks the copy records
the first leaf that does not read as expected, in each form tried, and
one such reason is enough to sort the case. A second reason behind the
first would show only in the cases with a caret, where it is the only
one; the sets hold many of those for every shape, and none of them has a
reason outside the list.

### Checks

From `packages/lib`, on the final code:

- `npm run typecheck`, `npm run typecheck:test`, `npm run lint`: clean.
- `npm test`: 557 files, 16,866 tests pass, 2 todo. The parent has
  16,468. The 398 new ones: 1 in `markdown-list-item-node.test.ts` (27 to
  28), 90 in `markdown-editor-list-item-edits.test.ts` (330 to 420),
  303 in `markdown-editor.test.ts` (604 to 907: 132 `SAME`, 142
  `DIFFERS`, the 2 tests after their loops, 3 source-mode rows, 6
  availability rows of 4 tests each) and 4 in
  `markdown-source-edits.test.ts` (278 to 282). Before the sixth review
  the count was 16,823; the 43 since are 40 `DIFFERS` rows, the 2 tests
  and 1 source-mode row.
- `npm run docs:api`: no warning. `npm run docs:llms:check`: coverage OK.
  `npm run build:lib`: builds.
- Of the plan's four greps the first gives zero matches, the second two
  and the fourth zero, as it expects. The third looks for what the lift
  rule removes from `liftLines` and finds the parent's four matches.

No demo was added: the demo's MD Editor page already has both toggles in
its **Insert** menu and `setBlockType` in its context menu, and no public
signature changed.

### The differential check

Each scenario ran on a private copy of the parent and of the branch. A
scenario is one document, one selection and one command. `diffall.sh`
runs every set, `measure.py` counts per set, and the outputs are
`diff/b12-*`, `review4/b12/` and `review5/*-n1*` in the scratch folder.
The runs were made before the sixth review. The code has changed since
only by D21, after which the source-mode half of the first two lines of
the table was run again, with the same result for every case. The fuzz,
the sweep and the manual checks were not run again: they exercise W,
whose code is the one the sixth review read.

| Sets | Probe | Cases | Acted at the parent, declines on the branch | A toggle that is available and changes nothing | Throws, failed reloads, second undo steps that the parent does not have |
|---|---|---|---|---|---|
| my nine: `final`, `differs`, `grid`, `rand`, `dxa` to `dxe` | the planner's, both surfaces | 23,013 | 0 | 0 | 0 |
| reviews 1 to 3: `rv`, `min`, `f`, `g`, `s7001`, `s7002`, `hand`, `hand2`, `ws`, `rnd1` | the planner's, both surfaces | 45,509 | 0 | 0 | 0 |
| review 4: `hand`, `rand-41`, `tab`, `tab2` | that reviewer's, both surfaces | 2,822 | 0 | 0 | 0 |
| review 4: points on holders | that reviewer's, W | 5,928 | 0 | 0 | 0 |
| review 5: `plain0`, `plainT`, four tab sets, `culprit`, `regstrip`, `inl`, eight hand sets | that reviewer's, S, twelve commands | 267,212 | 0 | not counted | 0 |
| review 5: sets `a` and `b` | that reviewer's, W | 40,068 | 0 | 0 | 0 |

1,481 cases of the planner's probe fail a check on the branch. All are in
the reviewers' random documents, and in every one the parent fails the
same check. In 115 cases, also all in the reviewers' random documents, S
leaves a text that W shows otherwise than the viewer where the parent's S
result did not; with the lift rule there were 317. None of either kind is
in my nine sets.

What changed from the parent in my nine sets, per surface
(`diff/explain.py`): in W every changed row is one of the plan's four
classes (a toggle that changed nothing now acts; an on toggle changes the
touched blocks only, at the top level, joined by run; an on toggle that
does not read as S does; a code block made of a task item holds the
marker as written). In S every changed row is a task item that S declined
and now converts, a task item elsewhere in a list that no longer makes
the command decline, or the same lines joined otherwise.
In `grid` that is 114, 5 and 576 rows, in `rand` 523, 197 and 240; no
row of S is of another kind, and none declines where the parent acted.

For points on nodes that hold blocks there is the scratch sweep
(`adhoc/zz-r5w.test.ts`, run by `r5w.sh`, compared by `adhoc/r5w_cmp.py`):
33 documents, 15 of them after one or two `deleteTable()` calls, every
point on every holder as a caret and paired with every text, the caret as
`deleteTable()` leaves it, and six commands; 25,620 cases, on the parent
and on the final code.

| | Both toggles | `setBlockType` (four types) |
|---|---|---|
| changed at the parent, changes on the branch | 3,458 | 6,191 |
| changed nothing at the parent, changes on the branch | 820 | 1,849 |
| threw at the parent, changes on the branch | 0 | 5 |
| changed at the parent, changes nothing on the branch | 0 | 0 |
| available, changes nothing | 0 | 511 |
| unavailable, changes nothing | 4,262 | 8,524 |
| unavailable, changes the document | 0 | 0 |
| a block outside the range changed | 0 (1,007 at the parent, over both columns) | 0 |

The available `setBlockType` cases that change nothing are blocks of the
type already, or a block the focus only touches at its edge, which
Lexical's `$setBlocksType` leaves out. No case throws on the branch, none
leaves a list or a block where its parent does not take one, every save
reloads and is read alike by the viewer, one undo step takes each change
back, and after a change no end of the selection stands on a holder.

### The fuzz

The three harnesses of the list item node plan, run on a private archive
of the branch (`runall.sh`), against the baselines in
`…/scratch-keep/impl/paste-undo-merge/{fuzz-2,lif-2,r7-2}`.
`cmpfuzz.py` compares record by record.

| Fuzz | Seeds, size | Baseline | Branch |
|---|---|---|---|
| paste (`column-paste-fuzz`), and strict | the 11 seeds, 3,000 each | 0, 0 | 0, 0 |
| table edge (`table-edge-fuzz-lbdeclined`), and strict | the 11 seeds, 3,000 each | 0, 0 | 0, 0 |
| list edit (`lif`) | the 11 seeds, 1,500 each | 14 | 14, the same 14 records |
| reviewer 7 (`r7`) | seeds 11, 23, 37, 41, 59, 3,000 each | 120 | 119 |

The run is `fuzz-8/`, `lif-8/` and `r7-8/` in the scratch folder, made on
the final source code. No other field of the paste, table edge and list edit
results differs from the baseline either. All 60 result files are byte
for byte those of the run made after the third review (`fuzz-5/`,
`lif-5/`, `r7-5/`), as were those of every run in between.

The reviewer-7 fuzz applies random steps, the two toggles among them. One
baseline record is gone: seed 37, lines of a raw quote joined by typing
after a bulleted toggle and an alignment; the toggle now leaves another
document and the typing step no longer meets that defect. Three records are
written differently and are the baseline's failures: each has a baseline
record of the same seed, document, steps, failing step and check. Two
(seeds 41 and 59, a throw in a paste) differ only in the node key the error
message quotes. The third (seed 59, a paste that loses a table cell's text)
follows a numbered toggle on a paragraph a list item holds, which changed
nothing at the parent and now makes the paragraph an item; the paste after
it fails as before.

### The manual checks

Run in Chrome on the demo's MD Editor page (`npx vite --port 8047` in
`packages/lib`; the server is stopped), on the code of this branch. The
clicks on the toolbar and the menus were real clicks, and Ctrl+Z,
Shift+F10 and the typed letter were real keys. Two things were not: the
source text was put in with `document.execCommand("insertText")` and the
mode switched by a scripted click on the source toggle while loading a
document, and the caret in source mode was set through the DOM selection.
B7's menu was opened with Shift+F10 at the caret, since the browser tool
has no right-click.

| # | Result |
|---|---|
| B1 to B9 of the plan | as the plan expects |
| B10 of the plan (source mode, `- one`, blank, `  second`, blank, `- two`; caret on `- one`; **Insert ▸ Bulleted list**) | `one`, blank, `- second`, blank, `- two`: the plan expects `second` at the margin, which is the deferred lift rule (sign-off 1) |
| B12: a `:::` block of two columns, a table all the first one holds; click into the table; **Table ▸ Delete ▸ Table**; **Insert ▸ Bulleted list**; type `Q` | after the delete the browser's caret is on the empty column; the toggle makes an item in the column and `Q` lands in it; two Ctrl+Z give the empty column back |
| B13: from there, Shift+F10; **Block style ▸ Heading 2**; type `Q` | a heading in the column, `Q` in it |

The console showed one warning, at **Delete ▸ Table**: Lexical's
"updateEditorSync: an editor update … ran while a read-only context was on
the stack", from `deleteTable()`. A copy of the parent served on another
port gave the same warning at the same click in the fifth round, so it is
not from this branch; it is noted for the plan on the table commands
below. The cases B11, B14 and B15 of the fifth round were about tabs in
source mode and went with the lift rule.

### For the plans that follow

- **`toggleList(type)`** takes one argument. It is still one shared private
  body for the two toggles, which is what
  `markdown-editor-link-format-command-fixes` cites it for.
  `$selectionLiesInListOfType` and `$convertListOfEmptyItem` are gone, and
  `INSERT_UNORDERED_LIST_COMMAND` / `INSERT_ORDERED_LIST_COMMAND` are no
  longer imported or dispatched by `MarkdownEditor.ts`.
- **Seven module-private functions** stand before `$blocksTouchedBy` in
  `MarkdownEditor.ts`: `$opensItemOfListType`, `$touchedBlocksLastFirst`,
  `$liftBlockOutOfLists`, `$makeItemsOf`, `$makeItemsOfRun`, `$itemOfBlocks`
  and `$toggleListOfTouchedBlocks`. `$moveBlockPointsIntoText` and
  `$liftItemOut` are unchanged. `$blocksTouchedBy` now returns blocks of
  text only, as `ElementNode[]` with no `null`; `$selectedBlocksHaveType`
  answers `false` for a selection with an end on a holder; and
  `setBlockType`'s update settles the selection's ends first (D16).
- **`markdown-editor-table-command-fixes` and the block commands.** That
  plan leaves the list toggles without its `$settleSelectionOffContainers`,
  because at its base none of them throws on a point held on a container.
  With the toggles' own route that stopped being true. D16 and D20 settle
  such points for both toggles and `setBlockType` with
  `$settleEndsIntoBlocksOfText` (after `$moveBlockPointsIntoText` in
  `MarkdownEditor.ts`): `$settleRangeEndsInward` with `$blockOfRangeEnd`,
  `$blockOfTextPast`, `$blockOfTextIn` and `$firstBlockOfTextIn` for a
  range, `$settleCaretIntoBlockOfText` with `$blockBeside`, `$blockBelow`,
  `$takesCaret`, `$blockOfTextAt` and `$newParagraphBeside` for a caret,
  and `$holderPointOffTable` and `$fillEmptyHolder` for both.
  `$holdsBlocks`, `$standsOnHolder` and `$isBlockOfText` stand after
  `$isTextOnlyBlock`. They follow that plan's rule for where a caret goes,
  with these differences: they also move a caret that stands on the root
  or a column between two blocks, which that plan leaves alone for the
  commands it covers; they pass over a table beside the point; they give a
  column they find empty a paragraph; they make a new empty paragraph
  where the caret has no place to go on either side; they name a point on
  a table's edge on the node that holds the table; and they take a range's
  ends inward, not beside. When that plan lands, its `$settlePoint` can
  take the place of `$settleCaretIntoBlockOfText` only if it does the
  first five.
- **Caret settling is in five places now, and is worth a plan of its
  own.** `MarkdownEditor.ts` has several routines that move a caret or a
  selection end off a node that holds blocks, each with its own rule:
  `$settleCaretIntoBlock` (`:2002`, after a removal; it takes a predicate
  for what the caret stays out of), `$openBlockAtItemCaret` (`:2107`, a
  caret on a list item gets a block to type in), `$refillEmptiedColumn`
  (`:2190`, an emptied column gets its paragraph, called by the table-edge
  removal and not by `deleteTable()`), `$moveBlockPointsIntoText`
  (`:4414`, a point on a block of text goes into its text), and this
  plan's `$settleEndsIntoBlocksOfText` (`:4440`) with the functions the
  item above names. They differ in which side they prefer, in whether they
  pass over a table, in whether they write (a paragraph for an empty
  column or document), and in whether a range's ends go inward. The sixth
  review asked that this be written down: a plan that gives them one rule
  and one implementation would remove the corners the reviews kept finding
  between them. `markdown-editor-table-command-fixes` adds a sixth
  (`$settleSelectionOffContainers`) unless it is written against that
  rule.
- **`deleteTable()` and that plan.** `deleteTable()` leaves a `:::` column
  empty when the table was all it held; `$refillEmptiedColumn`, which the
  table-edge removal calls, is not called there. The block commands now
  cope with the empty column, so nothing here depends on it, but a plan
  that settles the caret after `deleteTable()` can give the column its
  paragraph at that point. In the browser `deleteTable()` logs Lexical's
  "updateEditorSync … read-only context" warning, at the parent too (*The
  manual checks*).
- **`canSetBlockType`** has a third clause, `$selectionStandsOnTablesAlone`
  (D17). A plan that changes where the caret goes after a table command
  should check the field at the caret it leaves.
- **`$splitItemBefore(item, block)`** is exported from
  `markdownListItemNode.ts`. It is not
  `$splitItemBeforePasteEndingInTableOrFence`, which
  `markdown-editor-raw-block-range-edits` names.
- **`$serializeInlineNodes(nodes, inListItem = false)`** has a second
  parameter. `markdown-editor-raw-block-edge-cases` changes other functions
  of `markdownSerializer.ts`.
- **Compare Lexical nodes with `.is()`**, never with `===`, when one of
  them was read before a write in the same update (D1).
- **Test files.** `markdown-editor.test.ts` grew by about 460 lines inside
  three `describe`s, so the line numbers other plans cite for it have
  moved. In `markdown-editor-list-item-edits.test.ts` rows `H4` to `H6` are
  restated and `H9` to `H41` follow `H8`; a `describe` of its own after
  that one holds `H42` to `H72` and the sweep, which takes about fifteen
  seconds and has a timeout of its own; rows `Q11` to `Q13`, which
  `markdown-editor-raw-block-edge-cases` moves, are untouched.
- **Docs.** In `docs/components/MarkdownEditor.md` the two Command API rows
  for the toggles and `setBlockType`, the `canSetBlockType` row, the
  *Lists* bullet and the source-mode paragraph "The block commands —"
  changed, and three paragraphs on where the surfaces differ follow the
  latter. Several of the plans that follow edit the same file.
- **Left open.** The nine differences between the surfaces that the plan
  lists under *Non-Goals* stand, and the ones of sign-off 1 and 8, each
  pinned by `DIFFERS` rows; D22 says how the list was checked. Row
  `T10 OL` pins one more thing the plan's Non-Goal on the kept marker
  covers: in a document that defines `[x]`, the item W makes of a task
  item's text is written `1. \[x\] one`, where S writes `1. [x] one`. The
  viewer shows both as the text `[x] one`. Raw blocks
  and thematic breaks under the toggles are the subject of
  `markdown-editor-raw-block-range-edits`.
- **Seen in the reviews and left as they are.**
  - Lifting both paragraphs of `> one ⏎ > ⏎ > two` in S leaves a line `>`
    between them, an empty quote. The parent does the same.
  - For `4) ⏎      * muro`, which is not a form the editor saves, S leaves
    the empty `4)` item when `muro` is lifted and W removes it. The parent
    does the same. Row `E35` pins the shape and the docs state it.
  - A toggle of the other kind over a whole list of 1,000 items takes
    about twice as long on W as at the parent. This stood here until the
    sixth review; it is sign-off 10 now, with the cause and the numbers.
    The transform that costs the time, `$keepLoosenessWritable` run per
    dirty item and per dirty item text, is worth a small plan of its own.
  - `$splitItemBefore` makes its item with `new MarkdownListItemNode()`
    where `$splitItemAfterText` calls `$createListItemNode()`, and takes
    no `restoreSelection`. The plan gives the reason for the first; nothing
    calls it with a selection to restore.
  - `setBlockType` and the toggles do not take the same blocks for a range
    whose focus only touches the edge of a block: Lexical's
    `$setBlocksType` leaves that block out, and `$blocksTouchedBy` takes
    it. `$selectedBlocksHaveType` reads the second, so a range from a
    heading to the start of a paragraph is not "already a heading", and
    the heading is replaced by an equal one, which is an undo step that
    changes nothing. The parent does the same.
  - Every block command of S does nothing for a nested list that is
    indented by a tab (`- one ⏎ ⇥- nested ⏎ - two`) and for a block of an
    item that starts on a tab-indented line. The parent does the same.
    The fifth review found both unpinned; rows `E24` to `E27` pin them
    now and the docs state them. They belong to the follow-up plan's
    tabs.

### For the follow-up plan (source-mode lift rule)

**Where the work is kept.** The branch `wip/markdown-source-list-lift` at
`1fab9b22b` is this plan with the lift rule, as the fifth review read it:
commits `4338afe6e` (code) and `f297d1508` (docs) hold the rule, on top of
the state this branch was rebuilt from. Its notes (the same file on that
branch) have the full account, D2, D3, D12 to D15 and D18 among them. In
the scratch folder: `review1/` to `review5/` (each reviewer's probes,
rows and outputs), `stateI-measure.md`, `diff/` (the differential
outputs; `b11-*` is the lift branch, `b12-*` this one), `dx/`, `adhoc/`
(`src-rows2.json` to `src-rows5.json` are the lists of shapes), and the
scripts `srcprobe.sh`, `diffall.sh`, `r5all.sh` and `measure.py`.

**The rule that was settled on.** What a list item holds after a lifted
block, up to the next list item, leaves the list with the block; from the
next list item on, what follows stays in the list, in one item the
outermost list item's marker re-opens, so a nested item's own nested list
stands one level up, as `$liftItemOut` leaves it on W. Every line after
the lifted block is read container by container, outermost first: a
quote gives its marker, a list item its indentation, counted in columns,
a tab as the four columns `marked` reads in a line that continues a list
item. What stands past the last prefix is the line's content and is
written back byte for byte. Whitespace alone, on a blank line or past a
quote's marker, gives an item what indentation it has. What leaves the
list ends at the first list item after the block in a list that stands
in one of the block's own containers, a quote included.

**What it does to each command.** These are the rows the user was shown
and had not confirmed.

| Document | Caret | Command | S at the parent, and on this branch | S with the lift rule | W |
|---|---|---|---|---|---|
| `- one ⏎⏎   second ⏎⏎ - two` | `one` | `setBlockType("paragraph")`, bulleted toggle | `one ⏎⏎ - second ⏎⏎ - two` | `one ⏎⏎ second ⏎⏎ - two` | the same |
| same | `one` | `setBlockType("h2")` | `## one ⏎⏎ - second ⏎⏎ - two` | `## one ⏎⏎ second ⏎⏎ - two` | the same |
| same | `one` | `setBlockType("quote")` | `> one ⏎⏎ - second ⏎⏎ - two` | `> one ⏎⏎ second ⏎⏎ - two` | the same |
| same | `one` | `setBlockType("code")` | a fence holding `one`, then `- second ⏎⏎ - two` | the fence, then `second ⏎⏎ - two` | the same |
| same | `one` | numbered toggle | `1. one ⏎⏎ - second ⏎⏎ - two` | `1. one ⏎⏎    second ⏎⏎ - two` | the same (at the parent W numbered the whole list) |
| `10. a ⏎⏎     b` | `a` | `setBlockType("h2")` | `## a ⏎⏎ 10. b` | `## a ⏎⏎ b` | the same |
| same | `a` | `setBlockType("code")` | a fence holding `a`, then `10. b` | the fence, then `b` | the same |
| same | `a` | bulleted toggle | `- a ⏎⏎ 10. b` | `- a ⏎⏎   b` | the same |
| `- one ⏎⏎   second ⏎⏎   third ⏎⏎ - two` | `second` | bulleted toggle | `- one ⏎⏎ - second ⏎⏎ - third ⏎⏎ - two` | `- one ⏎⏎ - second ⏎⏎   third ⏎⏎ - two` | the same (at the parent W changed nothing) |
| `- a ⏎   - b ⏎⏎   c ⏎⏎ - d` | `b` | bulleted toggle | `- a ⏎⏎ b ⏎⏎ - c ⏎⏎ - d` | `- a ⏎⏎ b ⏎⏎ c ⏎⏎ - d` | the same |
| `- o ⏎   - x ⏎     - n ⏎   - y ⏎ - z` | `x` | bulleted toggle | `- o ⏎⏎ x ⏎⏎ - - - n ⏎   - y ⏎ - z` | `- o ⏎⏎ x ⏎⏎ - - n ⏎   - y ⏎ - z` | the same |


**The seventy rows.** The `DIFFERS` rows listed under sign-off 1 are the
plan's `SAME` rows. A plan that lands the lift rule moves them back, with
the S text of `wip/markdown-source-list-lift`, and takes the difference
out of the docs' list and the changelog entry.

**The rows added after the sixth review.** Twenty-three more `DIFFERS`
rows change with the lift rule (`adhoc/r7rows-lift.jsonl` holds what the
wip branch gives for each):

- `T19` to `T21`: a block or a nested item inside a task item with more of
  the task item after it. S does nothing here and acts with the lift
  rule. `T20 h2` stays a `DIFFERS` row, with another S text.
- `M33` to `M35`: a block right before a thematic break written in the
  list's marker character. The same; `M33 h2` stays a `DIFFERS` row.
- `M36`, `M37`: the break in another character, or with a block between.
  S acts here and leaves the break in the list.
- `E24` (two): a tab-indented block after the item's text. `E25` to `E27`,
  the tab-indented block itself and a nested list indented with a tab, do
  nothing on the wip branch too.
- `E30` (two): text that opens with `[ ] ` right after the block.
- `E34`: an HTML block indented deeper than its item's content.

With them go the first paragraph of the docs' three on the differences,
from "and where what stays behind would not read" to its end, the same
clauses of the third paragraph, and the last sentence of the changelog
entry. The plan's six source-mode rows that are not in the test file
(D6) come back as the plan wrote them.

**What the lift rule does not remove.** The other 17 rows added after the
sixth review, under sign-off 8, are S results that are the same on the
wip branch.

**What the five reviews found in it**, with where each stands on the wip
branch.

| Found | Defect | On the wip branch |
|---|---|---|
| differential, before review 1 (D2) | a new item did not join the list below the blocks it takes along | fixed: `lastLineOfNewItems` |
| differential, before review 1 (D3) | a block that leaves the list came to stand above a numbered item not numbered 1, and the command declined | fixed: the "set apart" form puts a blank line below what left |
| review 2 | that blank line, written without the quote's `>`, split a quote in two | fixed: none is written between two lines of one quote; the command declines there |
| review 3 (D12) | a line of spaces alone in a code block that leaves the list kept its indentation, and every command declined | fixed, then replaced by counting in columns |
| review 3 (D13) | the next item of a list inside a quote was taken along | fixed: `wrapperItemAfter` |
| review 4, B1 (D14) | with a code block of an item that holds a tab every command on the item's text did nothing | fixed for the shape found: `peelIndent`, `blockKey`, the tab-aware search in `markdownSourceTokens.ts` |
| review 4, A1 (D15) | another list later in the same quote was taken along | fixed: `wrapperItemAfter`, `wrapLineOf` |
| own list of shapes (D18) | the next item of a nested list holds a tab, is not found, and the list is not re-opened | fixed by the tab-aware search |
| review 5, B1 | `setBlockType("code")` does nothing on any text that holds a tab: `blockKey` writes a tab as four spaces in the leaves it reads, and the fence's expected key keeps the tab | **open** |
| review 5, B2 | the tab-aware search is quadratic: an indented code block of a `- ` item written with two tabs takes 821 ms to analyse at 400 lines and 13 s at 1,600, on every source-mode command and every selection read | **open** |
| review 5, B3 | six families where a command that acted at the parent declines: an item holding an unclosed fence; trailing whitespace on the last line of the list's last item when it ends an indented code block, an HTML block or an open fence; an item of a quote that holds a block right after its text, toggle of the other kind; a nested item holding a nested list then a paragraph, followed by a numbered item not numbered 1; a tab after a closing fence; indented code whose leading whitespace mixes spaces and a tab. 91 of 38,956 plain rows, 210 of 36,276 with trailing whitespace, 539 of 21,204 with tabs | **open** |
| review 5, B4 | the docs, the changelog and the notes overstate the tab fix: a nested list indented by a tab and a block of an item that starts on a tab-indented line decline on parent and branch alike, unpinned | **open** |
| review 5, A1 | the tab-aware search can locate a block on a later line that looks alike | **open** |
| review 5, A4 | the tab matching has no precedent in the code, and its file is not in this plan | **open** |

**Two shapes with a tab that declined at the end**, on the wip branch and
at the parent, both on the line an item's marker stands on, where `marked`
counts a tab as three spaces: a tab right after the marker of an item
that holds further lines, and a tab inside the item's text on that line.
Rows `E19` pin them on this branch too.

**317 cases that were not examined.** In the reviewers' random sets, with
the lift rule, S leaves a text that W shows otherwise than the viewer
where the parent's S result did not. The examples read were a numbered
list that the lift leaves starting at another number than 1, and a list
that comes to stand in a quote, which W holds as a raw block. On this
branch the count is 115.

**What the five rounds say about how to build it.** Three things kept
producing the next defect.

- The lift writes lines and expects leaves from the same reading of the
  document. What it gets wrong in one it gets wrong in both, and the
  check by lexing passes. The quote that was split in two and the list
  that was taken along were of this kind.
- A block that changes its container is read by other rules: `marked`
  writes tabs as spaces in a list item's lines, drops trailing whitespace
  at a list's end, and closes an open fence where the item ends. "Reads
  the same before and after" is then not a matter of indentation alone,
  and each of those turned up as a family of declines.
- When no form of the lifted edit reads as intended the command declines,
  though the parent's form (the blocks left in the list) would have read.
  Rule D of this branch is the answer that worked for the joining: try
  the wanted form, then the form the parent wrote, and decline only when
  neither reads. The lift rule should fall back the same way, so that
  "no command that acted at the parent declines" holds by construction,
  and the tab reading should be measured for speed before it is trusted.
