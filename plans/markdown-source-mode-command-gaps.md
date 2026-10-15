---
depends-on:
  - marked-version-pin-or-upgrade
  - marked-upgrade
  - markdown-tab-column-parity
  - markdown-source-mode-list-lift-parity
  - markdown-source-mode-block-locator
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourceTokens.ts
  - packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-source-edits.test.ts
  - packages/lib/tests/component/display/markdownLexer.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Source-Mode Command Gaps — Implementation Plan

## Overview

`MarkdownEditor` has two editing surfaces: WYSIWYG, and source mode, which edits the raw Markdown text. A block command is meant to give the same result on both for the same document and selection. Where it cannot, the difference is pinned by a `DIFFERS` row in [markdown-editor.test.ts](../packages/lib/tests/component/markdown-editor.test.ts) and listed in the docs. The plans before this one left a set of such differences that no plan owned. This plan calls them *gaps*. It closes the eight in the table below. It also pins one more difference, a code block made from a heading (rows `E41`), which the plan `markdown-editor-heading-to-code-escapes` closes on the WYSIWYG side.

| Gap | Document | Selection, command | WYSIWYG | Source mode before | Source mode after |
|---|---|---|---|---|---|
| 1 | `- aa ⏎ - bb ⏎⏎ [ ] mid` | `mid`, bulleted toggle | `- aa ⏎ - bb ⏎ - \[ \] mid` | nothing | `- aa ⏎ - bb ⏎ - \[ \] mid` |
| 2 | `one ⏎ more ⏎ --- ⏎⏎ para` | `one`, bulleted toggle | `- one ⏎ ··more ⏎⏎ para` | nothing | `- one ⏎ more ⏎⏎ para` |
| 3 | `one ⏎ more` | `one`, `setBlockType("h2")` | `one ⏎ more ⏎ ---` | `## one ⏎ ## more` | `one ⏎ more ⏎ ---` |
| 3 | `one ⏎ more` | `one`, `setBlockType("h3")` | `### one more` | `### one ⏎ ### more` | `### one more` |
| 4 | `one\ ⏎ two` | `two`, bulleted toggle | `- one\ ⏎ ··two` | nothing | `- one\ ⏎ two` |
| 4 | `one\ ⏎ two` | `one` to `two`, `setBlockType("h2")` | `one\ ⏎ two ⏎ ---` | nothing | `one\ ⏎ two ⏎ ---` |
| 5 | `` ``` ⏎ code ⏎ ``` ⏎ para `` | the fence, `setBlockType("paragraph")` | `code ⏎⏎ para` | `code ⏎ para`, one paragraph | `code ⏎⏎ para` |
| 6 | a table row `\| a \| << \| < \|` | the last `<`, `toggleBold()` | `\| a \| << \| **<** \|` | nothing | `\| a \| << \| **<** \|` |
| 7 | `one #` | `one`, `setBlockType("h2")` | `## one \#` | nothing | `## one \#` |
| 8 | `- ⏎ ··one ⏎ - two` | `one`, bulleted toggle | `one ⏎⏎ - two` | `- ⏎ one ⏎ - two` | `one ⏎ - two` |

`⏎` is a line end, `⏎⏎` a blank line and `·` a space throughout. Where the WYSIWYG text and the source-mode text of a row differ in spelling, the viewer reads the two the same. Gap 7 was not among the recorded differences. It was found while the others were measured, in a document the editor saves as it stands.[^gap7]

Gaps 1 to 5, 7 and 8 are changes to the line commands in [markdownSourceLines.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts). Gap 6 is a change to where the source analysis places the text of a table cell, in [markdownSourceTokens.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceTokens.ts) and [markdownTableExtension.ts](../packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts). `MarkdownEditor.ts`, `CodeEditor.ts` and the WYSIWYG surface are not touched. The tests are rows in three existing test files. The docs' list of differences loses five entries and gains two: the pinned difference, and a hand-written shape the list did not name.

*Base* means the code this plan starts from: commit `736452bbc`, the tip of the Markdown stack, with the five plans of `depends-on` on top. `marked` is 18.1.0 there (`marked-version-pin-or-upgrade`, then `marked-upgrade`). Every number here was measured on `736452bbc` with the code of those five plans applied and `marked` 18.1.0.[^measured] Line numbers are from `736452bbc`; the plans of `depends-on` move them, so find each site by its symbol name.

---

## Architecture Decisions

### One mechanism — a command tries one more way to write its edit, under the same check

A line command builds its edit in several ways, in a fixed order, and takes the first one whose result reads as intended when it is lexed again. This plan calls each way a *candidate*. `firstReadingEdit` ([markdownSourceLines.ts:977](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L977)) runs the order and the check. When no candidate reads, the command does nothing.

Seven of the eight gaps, all but gap 6, are closed by adding candidates to that order, by changing what a candidate writes, or by one more condition in the check. Nothing is decided by the shape of the document: the check accepts a candidate or rejects it.

| Gap | What is added | Where it stands in the order |
|---|---|---|
| 1 | every list-on candidate once more, with the new items' text escaped | after every unescaped candidate |
| 2 | nothing new: a heading's underline is among the lines a list-on candidate replaces | — |
| 3, 4 | for a heading type: the block as one heading, in two written forms | before the heading-per-line form the base writes |
| 4 | for a list toggle: the same toggle over the touched blocks taken whole | after the toggle over the selected lines |
| 5 | one more condition in the check | — |
| 7 | nothing new: a heading line is written with its closing `#` run escaped | — |
| 8 | every candidate once more, with an item's lone marker line among the lines it replaces | before the same candidate without that line |

The precedents are in the same module. `listOn` ([:1343](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L1343)) already tries its items joined to the list next to them and then as a list of their own. `markdown-source-mode-list-lift-parity` puts a *tail* candidate, one that also lifts what the list item holds after the block, in front of the candidate that leaves it in the list, in `convertBlocks`, `FENCED_CODE_SOURCE`, `listOff` and `listOn`.[^mechanism]

For gaps 1 and 4 (toggles) every added candidate stands after the base's own. A command that acts at the base therefore gives the same edit after this plan. For gaps 3 and 8 a new candidate stands before the base's, and for gap 5 the check is stricter, so the edit of a command that already acts can change (owner's answers G1, G2 and G3). For gaps 3 and 8 the base's own candidate is still tried last. One more shape changes an edit of the base: a setext heading whose text opens with `#` (G5).

### A new item's text is escaped where it would open something else — gap 1

`listOn` hands `firstReadingEdit` each of its candidates twice: first as the base writes it, then with the text of every new item escaped by a new function, `escapeItemText`. All unescaped candidates are tried before any escaped one.

`escapeItemText` writes the escapes the WYSIWYG serializer writes there (owner's answer G7):

- Text that opens with a task marker's form — `[ ]`, `[x]` or `[X]` and a space or tab, the new constant `TASK_MARKER_FORM` — is written as the text it shows, both brackets escaped: `\[ \] mid`. That is the form `textLinesOf` ([:594](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L594)) already writes for a task item's marker once it is text.
- Any other text goes to `escapeBlockStart` ([:950](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L950)), the function `convertBlocks` and `listOff` already escape with.

| Text made an item | Unescaped candidate | Escaped candidate | Edit | WYSIWYG |
|---|---|---|---|---|
| `mid` | `- mid` reads as expected | not tried | `- mid` | `- mid` |
| `[ ] mid` | `- [ ] mid` reads as a task item: rejected | `- \[ \] mid` reads as expected | `- \[ \] mid` | `- \[ \] mid` |
| `[x] aa` | `- [x] aa` reads as a task item: rejected | `- \[x\] aa` reads as expected | `- \[x\] aa` | `- \[x\] aa` |
| `[ ]→mid` (`→` a tab) | a task item: rejected | `- \[ \]→mid` reads as expected | `- \[ \]→mid` | `- \[ \]→mid` |
| `2. bar` (a later line of a paragraph) | `- 2. bar` reads as a list in the item: rejected | `- 2\. bar` reads as expected | `- 2\. bar` | `2\. bar`, a line of the item |
| `[ ] one`, the marker line of a task item that changes kind | `1. [ ] one` reads as expected: still a task item | not tried | `1. [ ] one` | `1. [ ] one` |

The marker of a task item that stays an item is not text, and the escaped candidate leaves it as it is. Every escape source mode writes in a new item is the one the WYSIWYG surface writes there; how the other block-start escapes compare is under G7 of *Decisions (signed off 2026-10-14)*.[^item-escapes]

### A heading is taken whole by a list toggle — gap 2

A list toggle takes a heading by its first line, whichever of its lines are selected, the underline of a setext heading among them. The heading's text becomes one item. Its later lines continue that item, and its underline is dropped with the rest of its syntax, as `setBlockType("paragraph")` already drops it.

| Document | Caret on | Bulleted toggle |
|---|---|---|
| `Title ⏎ ===` | `Title` | `- Title` |
| `one ⏎ more ⏎ ---` | `one`, `more` or the `---` line | `- one ⏎ more` |
| `- Title ⏎ ··--- ⏎ - two` (the heading an item opens with) | `Title` | `Title ⏎ - two`: the toggle is off, as on any item of a bulleted list |

At the base `toggleList` declines on any setext heading ([:1282](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L1282)), because the underline was left standing and would have made the new item a heading. That early return is removed.[^heading-whole] This changes a rule that `markdown-source-mode-block-locator` cites for its sign-off B2: there, two look-alike cases whose selection takes in a list item's setext heading do nothing after that plan; after this plan they act again, as the WYSIWYG surface does.[^locator-b2]

A setext heading is told from a `#` heading by a new constant, `ATX_HEADING_START`: one to six `#` and then a space, a tab or the line's end. The base's test was `#` alone, which takes a setext heading whose text opens with `#` (`#tag` over `---`) for a `#` heading.[^atx-test]

### A list toggle reads the selection by lines, then by blocks — gap 4

`toggleList` reads the selection in two ways, in this order.

1. **By lines**, as at the base: each selected line of a paragraph or an item's text is a line to toggle. The toggle is off when every such line is the marker line of an item of the list's kind, and on otherwise.
2. **By blocks**: each touched block is taken whole, by its first line. This is how the WYSIWYG surface reads every selection.

The second reading is tried only when the first gives no edit, and only when it differs from the first.

| Document, selection | By lines | By blocks | Edit |
|---|---|---|---|
| `one ⏎ two`, both lines, bulleted | `- one ⏎ - two` reads | not tried | `- one ⏎ - two`, as at the base |
| `one\ ⏎ two`, the caret on `two`, bulleted | `one\ ⏎ - two`: the `\` now ends a paragraph and shows as text: rejected | `- one\ ⏎ two` reads | `- one\ ⏎ two` |
| `- one\ ⏎ ··two ⏎ - three`, all three lines, bulleted | on, for `two`: `- one\ ⏎ - two ⏎ - three`: rejected | every block is an item of the list: off | `one\ ⏎ two ⏎⏎ three` |
| `one **bold ⏎ still** more`, both lines, bulleted | `- one **bold ⏎ - still** more` breaks the bold run: rejected | `- one **bold ⏎ still** more` reads | that edit |
| `one ⏎ two`, the caret on `one` | the readings are the same | not tried | as at the base |

The line reading stays first because it is what source mode can do and the WYSIWYG surface cannot: make each selected line of a paragraph an item. That difference is documented and stays (rows `E1`, `E2`).[^two-readings]

### One block becomes one heading — gaps 3 and 4

`setBlockType("h1")` to `("h6")` writes one heading for each block of text. For a block of several lines there are three written forms. `convertBlocks` tries them in this order, each as a candidate, and takes the first that reads.

| Form | Levels | Written | `one ⏎ more`, level 2 | `one ⏎ more`, level 3 |
|---|---|---|---|---|
| `setext` | 1, 2 | the text's lines, then `===` or `---` | `one ⏎ more ⏎ ---` | not a form of this level |
| `joined` | 1 to 6 | one `#` line, the lines joined by a space | `## one more` | `### one more` |
| `lines` | 1 to 6 | a `#` line for each line: the base's form | `## one ⏎ ## more` | `### one ⏎ ### more` |

A block of one line is written on one `#` line in all three, as at the base.

This is the rule the WYSIWYG serializer follows: a level 1 or 2 heading of several lines is saved with a setext underline, unless one of its lines would end that form; then, and for levels 3 to 6, it is saved on one line with its line breaks as spaces (`serializeHeading`, [markdownSerializer.ts:2289](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2289)).

| Document, `setBlockType("h2")` | `setext` | `joined` | Edit |
|---|---|---|---|
| `one ⏎ more` | reads | not tried | `one ⏎ more ⏎ ---` |
| `one\ ⏎ two` (a hard line break) | reads, the break kept | not tried | `one\ ⏎ two ⏎ ---` |
| `foo ⏎ <b>` (a lone tag ends a setext heading) | rejected | reads | `## foo <b>` |
| `foo ⏎ 2. bar` | rejected as written; reads with `2\.` escaped | not tried | `foo ⏎ 2\. bar ⏎ ---` |

One line cannot hold a hard line break. The `joined` form drops it, as the WYSIWYG surface does: `one\ ⏎ two` and `one·· ⏎ two` both give `### one two`.

A heading of several lines has one form, the setext one. `alreadyBlock` ([:1092](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L1092)) therefore counts a setext heading of several lines at the top level as already a heading of its level, and `setBlockType` with that level leaves it alone, as the WYSIWYG surface does. A setext heading of one line is still rewritten as a `#` line, as at the base.[^heading-forms]

### Text that was a code block stays in blocks of its own — gap 5

`setBlockType("paragraph")`, `("quote")` and a heading type turn a fenced code block that is selected whole into text. That text is read afresh as Markdown, so the check does not predict its leaves one by one. It only checks where they stand. This plan calls such a stretch of the result a *wildcard range*, as the code does (`WildcardRange`, [:141](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L141)).

At the base the check did not ask whether that text had joined a block next to it. `readsAsExpected` now rejects a result in which a leaf of a wildcard range shares a block with a leaf outside that range. The next form, which sets the converted block apart by blank lines, is then taken.

| Document | Selection, command | Base | After | WYSIWYG |
|---|---|---|---|---|
| `` ``` ⏎ code ⏎ ``` ⏎ para `` | the fence, paragraph | `code ⏎ para`: one paragraph | `code ⏎⏎ para` | `code ⏎⏎ para` |
| `` para ⏎ ``` ⏎ code ⏎ ``` `` | the fence, paragraph | `para ⏎ code`: one paragraph | `para ⏎⏎ code` | `para ⏎⏎ code` |
| `` ``` ⏎ code ⏎ ``` ⏎ para `` | the fence and `para`, quote | `> code ⏎ > para`: one paragraph in one quote | `> code ⏎⏎ > para` | `> code ⏎⏎ > para` |
| `` ``` ⏎ aa ⏎ ``` ⏎ ``` ⏎ bb ⏎ ``` `` | both fences, paragraph | `aa ⏎ bb`: one paragraph | `aa ⏎⏎ bb` | `aa ⏎⏎ bb` |

This is a defect of the base, not a reading it intends: two blocks the viewer shows apart came out as one. The shapes are exactly these: a fence with no blank line between it and a paragraph, a quote or another converted block, under the paragraph or the quote command.[^code-join]

### A table cell's text is placed in the stretch of its own column — gap 6

The source analysis places the text of each table cell inside its row's line by searching the line from where the cell before it ended (`findInRow`, which `markdown-source-mode-block-locator` adds). A cell that a `<<` or `^^` merged away has no token, so the search can stop on the marker: in `| a | << | < |` the last cell's `<` is placed on the `<<`. An inline command on that cell then does nothing. A cell whose whole text is an escaped pipe (`\|`) is placed on the row's leading `|`.

The table tokenizer knows the column of every cell. `markdownTableExtension.ts` gains two things: a `column` field on each cell token, and `tableRowSegments`, which cuts a row's line into the stretch each column is written in. The tokenizer's own `splitRow` reads its cell texts from that same cut. `walkTable` then looks for a cell's text only inside the stretch of the cell's column.

| Row | Cell | Base places it at | After |
|---|---|---|---|
| `\| a \| << \| < \|` | `<`, column 2 | the first `<` of `<<` | the `<` of the third stretch |
| `\| a \| << \| \<< \|` | `<<`, column 2 | the merge marker | the `<<` after the backslash |
| `\| ^^ \| ^ \|` (under a row it merges with) | `^`, column 1 | the first `^` of `^^` | the `^` of the second stretch |
| `\| \\| \| a \|` | `\|`, column 0 | the row's leading pipe | the pipe after the backslash |

In the first and third rows the fix makes an inline command act, with the result the WYSIWYG surface gives (`| a | << | **<** |`, `| ^^ | **^** |`). In the second and fourth it corrects the place only: source mode's inline commands do nothing on a cell whose text opens with an escaped character, before and after (see `## Non-Goals`).

This gap belongs here and not in `markdown-editor-table-command-fixes`: that plan changes the WYSIWYG table commands in `MarkdownEditor.ts` only, and this fix is in the source analysis, which only exists in its present form after `markdown-source-mode-block-locator` (whose owner's answer B3 hands it to this plan).[^cells]

### A run of `#` that would close a heading is escaped — gap 7

Markdown drops a run of `#` at the end of a `#` heading's line when a space stands before it. A heading line is therefore written with the first `#` of such a run escaped: `one #` becomes `## one \#`. The WYSIWYG serializer escapes the same character. At the base the unescaped line lost its `#`, the check rejected it, and the command did nothing. The text of a code block that is turned into a heading is not escaped: it is read afresh as Markdown, as at the base.[^closing-run]

### An item's marker line goes with the item's first block — gap 8

A list item's marker can stand on a line of its own, with the item's text on the next line (`-` / `··one`). When a command lifts the item's first block out of the list, the lines it replaces now start at that marker line. The item is gone once its first block has left it, so its marker goes too, as on the WYSIWYG surface (owner's answer G2). At the base the marker line stayed behind and read as an empty item.

| Document | Caret, command | Base | After | WYSIWYG |
|---|---|---|---|---|
| `- ⏎ ··one ⏎ - two` | `one`, bulleted toggle | `- ⏎ one ⏎ - two` | `one ⏎ - two` | `one ⏎⏎ - two` |
| `4) ⏎ ·····* muro` | `muro`, bulleted toggle | `4) ⏎ muro` | `muro` | `muro` |
| `- ⏎ ··one ⏎⏎ ··second ⏎ - two` | `one`, `setBlockType("h2")` | `- ⏎ ## one ⏎⏎ second ⏎ - two` | `## one ⏎⏎ second ⏎ - two` | `## one ⏎⏎ second ⏎⏎ - two` |

The rule is one function, `firstReplacedLine`, that every command asks for the first line of a block's replacement. It goes up from the block while the block is the first thing its list item holds and the lines between the item's start and the block hold container syntax alone.

Without the marker line the lines *above* it can read otherwise. Every command therefore tries its candidates twice where a block has such a line: first with the line among the replaced ones, then without it, which is the base's edit (`markerLineChoices`).[^marker-line]

| Document | Caret, command | With the marker line | Without it | Edit |
|---|---|---|---|---|
| `- ⏎ ··one ⏎ - two` | `one`, paragraph | `one ⏎ - two` reads | not tried | `one ⏎ - two` |
| `beta ⏎ 2. x ⏎ - ⏎ ··gamma` | `gamma`, paragraph | `beta ⏎ 2. x ⏎⏎ gamma`: `2. x` is now a line of the paragraph `beta`: rejected | `beta ⏎ 2. x ⏎ - ⏎ gamma` reads | that edit, as at the base |

The marker line goes in one edit with the other changes of this plan. A setext heading that opens such an item is taken whole (G5), and text that would read as a task marker once it stands after a new marker is escaped as G7 writes it:

| Document | Caret, command | Base | After | WYSIWYG |
|---|---|---|---|---|
| `- ⏎ ··Title ⏎ ··--- ⏎ - two` | `Title`, bulleted toggle (off) | nothing | `Title ⏎ - two` | `Title ⏎⏎ - two` |
| `- ⏎ ··[ ] mid ⏎ - two` | `mid`, numbered toggle | nothing | `1. \[ \] mid ⏎ - two` | `1. \[ \] mid ⏎⏎ - two` |
| `- ⏎ ··[ ] mid ⏎ - two` | `mid`, bulleted toggle (off) | `- ⏎ [ ] mid ⏎ - two` | `[ ] mid ⏎ - two` | `\[ \] mid ⏎⏎ - two` |

Where `setBlockType` takes the block out of the list and the WYSIWYG surface converts it in place (the difference of rows `E4` and `E12`, which stays), source mode now leaves no item at all: `setBlockType("h3")` on `Title` in `- ⏎ ··Title ⏎ ··--- ⏎ - two` gives `### Title ⏎ - two`, where the base gives `- ⏎ ### Title ⏎ - two` and the WYSIWYG surface `- ### Title ⏎ - two`.

### Two indentation shapes stay different

Rows `E32` and `E33` stay in `DIFFERS`. In both, the lines *after* the new item are indented so that they would read as part of it, and the command would have to rewrite lines of blocks it does not touch.

| Row | Document | Bulleted toggle on | Why source mode does nothing |
|---|---|---|---|
| `E32` | `2. ⏎⏎ ···vebe ⏎⏎ ···> lage` | `vebe` | `- vebe` holds everything indented two columns or more: the quote `···> lage` would become part of the item |
| `E33` | `··1. one ⏎⏎ ·····held ⏎⏎ ··2. two` | `one` | the same: `··2. two`, the rest of the list, would become a list inside `- one` |

A line command writes the lines of the blocks it converts and the container prefixes of what follows inside the quotes and list items it splits. It never re-indents a block that only stands below. The WYSIWYG surface acts here because it saves the whole document in its own spacing. Both shapes are hand-written indentation; the editor does not save them.[^indentation]

### One difference is pinned here and closed by another plan — a code block made from a heading

`setBlockType("code")` puts a block's text into the code block as Markdown. For a heading the two surfaces write that text in different forms, in documents the editor saves as they stand.

| Document | WYSIWYG code block holds | Source-mode code block holds |
|---|---|---|
| `### +alpha` | `\+alpha`: the form a paragraph holds the text in, where a `+` that opens a line is escaped | `+alpha`: the heading's line as written |
| `# alpha \#` | `alpha #`: a paragraph needs no escape there | `alpha \#`: the heading's line as written |

Source mode writes the bytes the heading holds, which is its rule for every block, and the owner decided that source mode is right (G8). The WYSIWYG side is a defect that `markdown-editor-heading-to-code-escapes` fixes; this plan touches no file of that surface. Which plan lands first decides the rows:

| Lands first | What this plan does with `E41` |
|---|---|
| this plan | adds the two `DIFFERS` rows `E41` below and the docs clause for the difference; `markdown-editor-heading-to-code-escapes` deletes both when it lands (its steps 1 and 7) and adds the rows to `SAME` |
| `markdown-editor-heading-to-code-escapes` | adds neither: its two `E41` rows are in `SAME` already. `DIFFERS` then ends with 35 rows, not 37 |

The row text and the comment above the rows are the ones that plan's step 1 looks for; keep them as given.[^heading-code]

### The `can…` fields and the undo step are not changed

In source mode `canSetBlockType` and the other availability fields stay `true` whenever the editor is not read-only (`readSurfaceSelectionState`, [MarkdownEditor.ts:6864](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L6864)). Source mode does not predict where a command does nothing; this plan makes it do nothing in fewer places. A command is still one transform that returns one edit, which `MarkdownEditor` hands to `CodeEditor` as one change, so it is one undo step. `CodeEditor` gains nothing. The WYSIWYG surface, its `can…` fields included, is not touched.

### Decisions (signed off 2026-10-14)

The repository's owner answered the plan's eight questions on 2026-10-14. The plan is written for these answers.

**G1. A heading type gives one heading for a block of several lines — accepted.** It is what the WYSIWYG surface gives, and what `setBlockType` already promises for every other type: a block stays one block.

| Document | Command | Source mode at the base | After | WYSIWYG |
|---|---|---|---|---|
| `one ⏎ more` | `setBlockType("h1")` | `# one ⏎ # more` | `one ⏎ more ⏎ ===` | the same |
| `one ⏎ more` | `setBlockType("h2")` | `## one ⏎ ## more` | `one ⏎ more ⏎ ---` | the same |
| `one ⏎ more` | `setBlockType("h3")` | `### one ⏎ ### more` | `### one more` | the same |
| `one·· ⏎ two` (a hard break) | `setBlockType("h3")` | `### one·· ⏎ ### two` | `### one two` | the same |
| `- one ⏎ ··more ⏎ - two` | `setBlockType("h2")` on `one` | `## one ⏎ ## more ⏎ - two` | `one ⏎ more ⏎ --- ⏎ - two` | `one ⏎ more ⏎ --- ⏎⏎ - two` |
| `one ⏎ more ⏎ ---` | `setBlockType("h2")` | `## one ⏎ ## more` | nothing: it is that heading | nothing |
| `one ⏎ more ⏎ ---` | `setBlockType("h1")` | `# one ⏎ # more` | `one ⏎ more ⏎ ===` | the same |
| `foo ⏎ <b>` | `setBlockType("h2")` | `## foo ⏎ ## <b>` | `## foo <b>` | the same |

**G2. An item marker on a line of its own goes with the item's first block — accepted.** The marker left behind showed as an empty item, which the WYSIWYG surface does not leave.[^g2] Row `E35` leaves `DIFFERS`. See *An item's marker line goes with the item's first block*.

**G3. Text that was a code block is set apart by a blank line — accepted, as a defect fix.** See *Text that was a code block stays in blocks of its own*.

**G4. A list toggle falls back to whole blocks — accepted.** Where the selected lines cannot be items of their own, source mode makes one item of each touched block, where it did nothing. It does not split at a hard line break and drop the break's backslash, which would rewrite a character of the text.

**G5. A setext heading is one item under a list toggle — accepted,** whatever lines of it are selected. In one shape this changes an edit the base makes. The base takes a setext heading whose text opens with `#` for a `#` heading, and so does not decline on it:

| Document | Selection, command | Source mode at the base | After | WYSIWYG |
|---|---|---|---|---|
| `#tag ⏎ more ⏎ ---` | both text lines, bulleted toggle | `- #tag ⏎ - more`: two items | `- \#tag ⏎ more`: one item | `- \#tag ⏎ ··more` |
| `#tag ⏎ ---` | `tag`, `setBlockType("h2")` | nothing | `## #tag`, as for any setext heading of one line | nothing: it is a level 2 heading |

**G6. Table cells carry their column — accepted; Part B is in.** `MdTableHeaderCell` and `MdTableBodyCell` gain a `column` field, and `markdownTableExtension.ts` exports `tableRowSegments`. Both token types are internal: no barrel exports them.

**G7. A new item's text that opens with a task marker's form is escaped as the WYSIWYG serializer writes it — decided against the first recommendation.** `[ ] mid` becomes `- \[ \] mid`, both brackets escaped, not `- \[ ] mid`. Source mode now writes exactly what the WYSIWYG surface writes there, for `[x]` and `[X]` and for a tab after the brackets too.

The other block-start escapes were compared on both surfaces: 28 line starts (every character `escapeBlockStart` escapes, the ordered-list numbers, definitions, task forms and HTML tags) in four positions each, and 15 more documents.[^escape-survey] Two kinds of difference are left, and this plan changes neither:

| Kind | Example: text made an item, or lifted | Source mode | WYSIWYG |
|---|---|---|---|
| source mode escapes one character where the WYSIWYG surface escapes more: a link reference definition's label opening a new item's text | `foo ⏎ [a]: /url`, both lines, bulleted toggle | `- foo ⏎ - \[a]: /url` | `- foo ⏎ ··\[a\]: /url` |
| source mode writes no escape where none is needed; the WYSIWYG surface escapes every `[`, `]`, `*`, `` ` `` and `~` of a text, and a block-start character at a line's start whether it would open a block or not | `- foo ⏎ ··--- tail`, `foo`, bulleted toggle (off) | `foo ⏎ --- tail` | `foo ⏎ \--- tail` |

The first kind is the same as G7's, on another construct: the label of a definition, which a new item would read as a definition. It occurs only in hand-written Markdown, since the editor saves every `[` and `]` of text escaped. The second kind is source mode keeping the author's bytes, which is its rule for every block; the viewer reads both results the same. Both are in `## Non-Goals`.

**G8. A code block made from a heading — source mode is right.** The WYSIWYG code block's extra backslash is a defect, fixed by `markdown-editor-heading-to-code-escapes`. This plan pins the difference only when it lands first. See *One difference is pinned here and closed by another plan*.

### Every row that remains in `DIFFERS`, and who owns it

After the five plans of `depends-on`, `DIFFERS` has 48 rows. This plan moves 13 of them out and, when it lands before `markdown-editor-heading-to-code-escapes`, adds the 2 rows `E41`. The other 35 stay. Each of the 37 rows is there for one of these reasons.

| Rows | The difference | Why it stays |
|---|---|---|
| `Q1` (two), `Q2` (two) | a list inside a blockquote | the WYSIWYG surface keeps it as a raw Markdown block; making it an editable list is an importer and serializer feature that no plan holds |
| `E22` (two), `E23` | a list written tight with a block right under another | the same: a raw block on the WYSIWYG surface |
| `E1` (two), `E2` (two) | single lines of a block made items | a product difference: source mode can select lines, the WYSIWYG surface cannot |
| `E3` (two), `E8`, `E10`, `E11` | a list toggle on a code block or an HTML block | the WYSIWYG surface makes the block's source text an item; source mode does not turn code or HTML into text under a toggle. No plan holds it[^raw-toggles] |
| `E9` | a thematic break inside a selection | the WYSIWYG surface converts it with the others; it holds no text for source mode to convert |
| `E4` (two), `E12` (two), `T20`, `M33` | `setBlockType` on a block a list item holds, or the heading it opens with | the WYSIWYG surface converts it in place, source mode takes it out of the list. Which is right is a question about `setBlockType` that the owner has not been asked |
| `E5` | `setBlockType("code")` over several blocks | one code block per block on the WYSIWYG surface, one for all in source mode: a product difference |
| `E6`, `E7` | the looseness of a list left as one item | the WYSIWYG surface's looseness model, kept per list |
| `E13` (two) | a block in a `:::` block that a list item holds | a lifted block could not leave the item without leaving its column |
| `E14` | a selection from one `:::` column into the next | source mode declines on the `\|\|\|` line |
| `E15` (two) | an empty list item inside a selection | no line of text for source mode to convert |
| `E39`, `E40` | a code fence left open; a numbered item not numbered 1 under a paragraph | `markdown-source-mode-list-lift-parity`: what an item holds stays in the list where it would read otherwise outside it |
| `E32`, `E33` | lines below the result indented into it | this plan: see *Two indentation shapes stay different* |
| `E41` (two, new) | a code block made from a heading | closed by `markdown-editor-heading-to-code-escapes`; pinned here until it lands |

### Tests are rows in the existing tables, each seen to fail first

Parity rows go into `SAME` and come out of `DIFFERS` in `describe('MarkdownEditor list toggles in a list of their kind')` of [markdown-editor.test.ts](../packages/lib/tests/component/markdown-editor.test.ts). Rows whose document the editor would not save go into the source-mode `CASES` tables of the same file. Transform rows go into [markdown-source-edits.test.ts](../packages/lib/tests/component/markdown-source-edits.test.ts), and the tokenizer's rows into [markdownLexer.test.ts](../packages/lib/tests/component/display/markdownLexer.test.ts). There is no new test file. Every added or restated test fails before the code: `### What is red before the code` lists them.

---

## Internal Structure

No public API changes. Everything below is internal to the library. `tableRowSegments` and `TableRowSegment` are exported from `markdownTableExtension.ts` for the analysis, are marked `@internal`, and go into no barrel.

The code is the code that was measured: the prototype modules stood in the tests tree and were put in place of the real ones by a Vitest plugin.[^prototype] It is written against the modules as `markdown-source-mode-block-locator` leaves them, so it uses names the plans of `depends-on` add (`liftLinesWithTail`, `lineIndexOf`, `EditCandidate`, `tailLifts`, `PlacedLine`, `findInRow`). Where a whole function is given, replace the function of that name, doc comment included. New declarations say where they go.

### Part A — `markdownSourceLines.ts`

**A1. Constants.** Add directly after `PROBE_CHARACTER`:

```ts
/**
 * The underline of a setext heading, by level: `===` for level 1 and `---`
 * for level 2, the only two levels Markdown has an underline for. Three
 * characters each, the length the editor's serializer writes
 * (`markdownSerializer.ts`), so a heading written here is in the form the
 * WYSIWYG surface saves it in.
 */
const SETEXT_UNDERLINES: readonly string[] = ["===", "---"];

/**
 * An ATX heading's opening: up to three spaces, one to six `#`, and a space,
 * a tab or the line's end. A heading whose `raw` does not open so is a
 * setext one, also when its text opens with a `#` (`#tag` over `---`).
 */
const ATX_HEADING_START = /^ {0,3}#{1,6}(?=[ \t\n]|$)/;

/**
 * A closing sequence at the end of an ATX heading's line: a run of `#`, with
 * any whitespace after it, that stands after a space or tab or is all the
 * line holds. Markdown drops it from the heading's text.
 */
const ATX_CLOSING_SEQUENCE = /(^|[ \t])(#+[ \t]*)$/;
```

**A2. The check.** Replace `readsAsExpected`. The new part is the `unpredicted` map and the two rejections that read it.

```ts
/**
 * Whether an edit's result reads as `expected`: the same leaves in the same
 * order, each with the expected containers, and two neighbouring leaves in
 * one block exactly when they are expected in one. Leaves inside a wildcard
 * range only need its path, and share a block with no leaf outside that
 * range. With `strict`, two neighbouring leaves must also
 * share each quote and list item exactly where they are expected to
 * ({@link sameHolders}).
 *
 * @param text - The pre-edit text.
 * @param edit - The edit.
 * @param expected - The leaves the result must read as, wildcard ranges' leaves left out.
 * @param wildcards - Ranges of the result, in its own offsets, whose leaves are not predicted.
 * @param strict - Whether container instances are compared too: `true` for a tail lift, `false` for every other edit.
 * @returns Whether it does.
 */
function readsAsExpected(
    text: string, edit: MarkdownSourceEdit, expected: readonly ExpectedLeaf[], wildcards: readonly WildcardRange[], strict = false,
): boolean {
    const after = analyzeMarkdownSource(text.slice(0, edit.from) + edit.insert + text.slice(edit.to));
    const actual: LeafView[] = [];
    // The block each leaf of a wildcard range stands in, with its range: such leaves are read afresh, in blocks of their own.
    const unpredicted = new Map<number, WildcardRange>();

    for (const leaf of readLeaves(after)) {
        const wildcard = wildcardAt(wildcards, leaf.offset);

        if (wildcard === undefined) {
            actual.push(leaf);
        } else if (!samePath(leaf.path, wildcard.path)) {
            return false;
        } else {
            const sharing = unpredicted.get(leaf.block);

            // One block holding the text of two ranges: two code blocks turned into text were joined.
            if (sharing !== undefined && sharing !== wildcard) {
                return false;
            }

            unpredicted.set(leaf.block, wildcard);
        }
    }

    // A predicted leaf in one of those blocks was joined to text that was code.
    const isJoined = actual.some((leaf) => unpredicted.has(leaf.block));

    if (isJoined) {
        return false;
    }

    return actual.length === expected.length && actual.every((leaf, index) => {
        const want = expected[index]!;
        const previous = index > 0 ? actual[index - 1]! : null;
        const wantPrevious = index > 0 ? expected[index - 1]! : null;
        const joined = previous !== null && leaf.block === previous.block;
        const sameBlocks = wantPrevious === null || joined === (want.group === wantPrevious.group);
        const sameInstances = !strict || previous === null || wantPrevious === null || sameHolders(leaf, previous, want, wantPrevious);

        return leaf.key === want.key && samePath(leaf.path, want.path) && sameBlocks && sameInstances;
    });
}
```

**A3. Four readers.** Add directly before `leafNodes`:

```ts
/**
 * The lines a block's text stands on: its lines ({@link nodeLines}) without
 * the underline of a setext heading, which holds none of the text.
 *
 * @param text - The full document text.
 * @param node - The block.
 * @returns The lines.
 */
function textLineSpans(text: string, node: SourceBlockNode): SourceLine[] {
    const lines = nodeLines(text, node);
    const isSetext = node.type === "heading" && !ATX_HEADING_START.test(node.token!.raw);

    return isSetext ? lines.slice(0, -1) : lines;
}

/**
 * The start of the first line a lifted block's replacement takes: the
 * block's own first line, or, with `withMarker`, the line of the list item
 * marker above it when the block opens that item and the marker stands on a
 * line of its own (`-` / `  one`). Such a line holds nothing but the item,
 * and the item is gone once its first block has left it, so the line goes
 * with the block; left behind it would read as an empty item. The same holds
 * one item further out for each item the block opens through the first item
 * of a list (`4)` / `   * one`).
 *
 * @param text - The full document text.
 * @param target - The lifted block.
 * @param withMarker - Whether a lone marker line above the block is taken.
 * @returns The line's start.
 */
function firstReplacedLine(text: string, target: SourceBlockNode, withMarker: boolean): number {
    let first = lineStartAt(text, target.start);
    let child = target;
    let opens = withMarker;

    while (opens && child.parent !== null) {
        const holder: SourceBlockNode = child.parent;
        const isLifted = holder.start !== -1 && (holder.type === "list" || LIFTED_NODE_TYPES.has(holder.type));
        // A task item's checkbox is its marker, not a block: the item's first block is the child after it.
        const firstChild = holder.children[0]?.type === "checkbox" ? holder.children[1] : holder.children[0];
        const holderLine = isLifted && firstChild === child ? lineStartAt(text, holder.start) : -1;
        const isMarkerAlone = holderLine !== -1 && holderLine < first && holder.type === "list_item" && holdsContainerSyntaxAlone(text, holderLine, first);

        opens = holderLine === first || isMarkerAlone;
        first = isMarkerAlone ? holderLine : first;
        child = holder;
    }

    return first;
}

/**
 * The ways a command's replacements can start: with the lone marker line
 * above a lifted block (`true`), and, where a block has one, without it
 * (`false`), tried after. Without the marker line the lines above it can
 * read otherwise (`2. x` is a list above `-` and a line of the paragraph
 * above it otherwise), and the edit that leaves the line is then the one
 * that reads.
 *
 * @param text - The full document text.
 * @param targets - The lifted blocks.
 * @returns The choices for {@link firstReplacedLine}'s `withMarker`, the preferred first.
 */
function markerLineChoices(text: string, targets: readonly SourceBlockNode[]): readonly boolean[] {
    const hasLoneMarker = targets.some((target) => firstReplacedLine(text, target, true) !== lineStartAt(text, target.start));

    return hasLoneMarker ? [true, false] : [true];
}

/**
 * Whether every line from one line's start up to another's holds container
 * syntax alone ({@link CONTAINER_SYNTAX_ONLY}): quote markers, list markers
 * and whitespace.
 *
 * @param text - The full document text.
 * @param from - The first line's start.
 * @param to - The start of the line after the last one.
 * @returns Whether they do.
 */
function holdsContainerSyntaxAlone(text: string, from: number, to: number): boolean {
    let lineStart = from;
    let isSyntaxAlone = true;

    while (isSyntaxAlone && lineStart < to) {
        const lineEnd = lineEndAt(text, lineStart);

        isSyntaxAlone = CONTAINER_SYNTAX_ONLY.test(text.slice(lineStart, lineEnd));
        lineStart = lineEnd + 1;
    }

    return isSyntaxAlone;
}
```

`firstReplacedLine` walks parents and reads `children[0]` and `children[1]` by index. Do not replace those two reads by `find`: a list has as many children as it has items, and the cost tests of `markdown-source-edits.test.ts` count every array handed to a scan.

**A4. Block types.** Replace `convertBlocks`, and add the four declarations after it. Then replace `alreadyBlock`.

```ts
/**
 * Converts the blocks a selection touches (see {@link readLineTargets}) to the
 * block `prefix` writes — a paragraph for `""`, a quote for `"> "`, a heading
 * for `"#".repeat(level) + " "` — lifting each out of its quotes and list
 * items (see {@link liftLinesWithTail} and {@link liftLines}). A block already of that kind at the top
 * level is left alone. A block of text becomes one heading, written in the
 * first of its forms that reads as intended ({@link HeadingForm}): a block
 * of several lines with a setext underline for level 1 or 2, else with its
 * lines joined on one `#` line, and last as a heading for each line. A task
 * item's marker is carried as the text it shows (`\[x\] `).
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

    const level = prefix.startsWith("#") ? prefix.trim().length : 0;
    const kind = prefix === "" ? ["p"] : prefix === "> " ? ["quote", "p"] : [`h${level}`];
    const targetOf = targetOfEntry(targets);
    const code = targets.map((target) => target.type === "code");
    const leaves = readLeaves(analysis);
    // One heading holds one block's text. For a block of several lines, the forms that write one heading are tried
    // before the form that writes a heading for each of its lines.
    const hasSeveralLines = level > 0 && targets.some((target, index) => !code[index]! && blockTextLines(target).length > 1);
    const forms: readonly HeadingForm[] = !hasSeveralLines ? ["lines"] : level <= SETEXT_UNDERLINES.length ? ["setext", "joined", "lines"] : ["joined", "lines"];

    /** What a leaf of a target becomes; in the `lines` form of a heading, each line of the text is expected as a block of its own. */
    const changeFor = (form: HeadingForm) => (leaf: LeafView): ExpectedLeaf | readonly ExpectedLeaf[] | null | undefined => {
        const index = targetOf(leaf.entry);

        if (index === -1) {
            return null;
        }

        if (code[index]!) {
            return undefined;
        }

        const line = level > 0 && form === "lines" ? `:${lineStartAt(text, leaf.offset)}` : "";
        const path = [...columnPath(leaf.path), ...kind];

        return markerTextLeaves(leaf, path, `t${index}${line}`) ?? { key: leaf.key, path, group: `t${index}${line}` };
    };

    const lifts = tailLifts(analysis, targets);

    /** Builds the replacements, a heading of several lines written in `form`, with or without an item's lone marker line. */
    const buildFor = (form: HeadingForm, withMarker: boolean) => (escape: boolean): LineReplacement[] => targets.map((target, index) => {
        const lines = textLinesOf(target, "text");
        const isText = level > 0 && !code[index]!;
        const isOneHeading = isText && form !== "lines" && lines.length > 1;
        const isSetext = isOneHeading && form === "setext";

        const written = isOneHeading
            ? headingLines(analysis, target, lines, level, isSetext)
            : lines.map((line) => (isBlank(line) || prefix === "" ? line : isText ? atxHeadingLine(prefix, line) : prefix + line.trimStart()));

        return {
            first: firstReplacedLine(text, target, withMarker),
            last:  lineEndAt(text, target.end - 1),
            lines: written.map((line, at) => {
                // A setext heading's underline is syntax, and its text lines carry no prefix; every other line opens with the prefix.
                const isUnderline = isSetext && at === written.length - 1;

                return escape && !code[index]! && !isBlank(line) && !isUnderline ? escapeBlockStart(line, isSetext ? "" : prefix) : line;
            }),
            nodes: [target],
        };
    });
    // A code block's code becomes Markdown, read afresh: only the kind of block it lands in is predicted.
    const leafAt = new Map(leaves.map((leaf) => [leaf.entry, leaf]));
    const wildcardPaths = targets.map((target, index) => {
        const own = leafAt.get(target.entryStart);

        return code[index]! && own !== undefined ? [...columnPath(own.path), ...kind] : null;
    });

    const candidates: EditCandidate[] = [];

    for (const withMarker of markerLineChoices(text, targets)) {
        for (const form of forms) {
            const build = buildFor(form, withMarker);
            const change = changeFor(form);

            if (lifts !== null) {
                candidates.push({ build, expected: () => expectLeaves(leaves, change, lifts), tail: true });
            }

            candidates.push({ build, expected: () => expectLeaves(leaves, change), tail: false });
        }
    }

    return firstReadingEdit(analysis, candidates, wildcardPaths, true);
}

/**
 * How a heading is written for a block of several lines of text: `setext`,
 * the text's lines over an underline, which only levels 1 and 2 have;
 * `joined`, the lines on one `#` line; `lines`, a heading for each line. A
 * block of one line is written the same in all three, on one `#` line.
 */
type HeadingForm = "setext" | "joined" | "lines";

/**
 * The lines one heading of `level` is written on for a block of several
 * lines of text. The setext form holds line ends: the text's lines, each
 * without the whitespace it opens with, and the level's underline below
 * them. The other form is one line, the lines joined by a space each, as
 * the WYSIWYG surface joins them: a line's leading and trailing whitespace
 * goes, and with it a hard line break written as trailing spaces or as a
 * backslash, which one line cannot hold.
 *
 * @param analysis - The document's analysis.
 * @param target - The block.
 * @param lines - The block's text lines, a task marker as the text it shows.
 * @param level - The heading's level.
 * @param setext - Whether to write the setext form; `level` is then 1 or 2.
 * @returns The lines.
 */
function headingLines(analysis: SourceAnalysis, target: SourceBlockNode, lines: readonly string[], level: number, setext: boolean): string[] {
    if (setext) {
        // A line of a heading's text is read without the whitespace it opens with, and four spaces of it would end the heading.
        return [...lines.map((line) => line.trimStart()), SETEXT_UNDERLINES[level - 1]!];
    }

    const breaks = backslashBreaks(analysis, target);
    const spans = textLineSpans(analysis.text, target);

    const joined = lines.map((line, index) => {
        const span = spans[index];
        const endsInBreak = span !== undefined && breaks.has(span.end - 1);

        return (endsInBreak ? line.slice(0, -1) : line).trim();
    }).join(" ");

    return [atxHeadingLine(`${"#".repeat(level)} `, joined)];
}

/**
 * Writes one line of text as an ATX heading. A run of `#` that ends the
 * text after a space would close the heading and be dropped from its text
 * ({@link ATX_CLOSING_SEQUENCE}), so its first `#` is escaped, as the
 * WYSIWYG surface's serializer escapes it: `one #` is written `## one \#`.
 *
 * @param prefix - The heading's `#` run and the space after it.
 * @param text - The line of text.
 * @returns The heading line.
 */
function atxHeadingLine(prefix: string, text: string): string {
    const escaped = text.trimStart().replace(ATX_CLOSING_SEQUENCE, "$1\\$2");

    return prefix + escaped;
}

/**
 * Where a block's hard line breaks written as a backslash stand: the offset
 * of each such backslash, which ends its line.
 *
 * @param analysis - The document's analysis.
 * @param target - The block.
 * @returns The offsets.
 */
function backslashBreaks(analysis: SourceAnalysis, target: SourceBlockNode): Set<number> {
    const offsets = new Set<number>();

    for (let index = target.entryStart; index < target.entryEnd; index += 1) {
        const entry = analysis.entries[index]!;
        const isBackslashBreak = entry.kind === "leaf" && entry.key === "br" && entry.start !== -1 && analysis.text[entry.start] === "\\";

        if (isBackslashBreak) {
            offsets.add(entry.start);
        }
    }

    return offsets;
}
```

```ts
/**
 * Whether a block already reads as the kind `prefix` writes, at the top level
 * (or in its `:::` column): a paragraph, a paragraph directly in a quote, or
 * a heading of the same level written as the command writes it — an ATX
 * heading, or a setext heading of several lines.
 *
 * @param node - The block.
 * @param prefix - The block prefix.
 * @returns Whether it does.
 */
function alreadyBlock(node: SourceBlockNode, prefix: string): boolean {
    const containers = liftedContainers(node);

    if (containers === null || node.type === "code") {
        return false;
    }

    if (prefix === "" || prefix === "> ") {
        const quoted = containers.length === 1 && containers[0]!.type === "blockquote";

        return node.type !== "heading" && (prefix === "" ? containers.length === 0 : quoted);
    }

    const heading = node.token as Tokens.Heading;
    // A heading of several lines has one form, the setext one: it is the heading the command would write.
    const isWrittenForm = ATX_HEADING_START.test(heading.raw) || blockTextLines(node).length > 1;

    return node.type === "heading" && containers.length === 0 && heading.depth === prefix.trim().length && isWrittenForm;
}
```

How the forms map to candidates, for `setBlockType("h2")` on a block in a list item (so `tailLifts` gives a plan):

| Order | Form | Tail | Written for `- one ⏎ ··more ⏎ - two` |
|---|---|---|---|
| 1 | `setext` | lifted | `one ⏎ more ⏎ --- ⏎ - two` |
| 2 | `setext` | left in the list | the same here: the item holds nothing after the block |
| 3 | `joined` | lifted | `## one more ⏎ - two` |
| 4 | `joined` | left in the list | the same |
| 5 | `lines` | lifted | `## one ⏎ ## more ⏎ - two` |
| 6 | `lines` | left in the list | the same |

Each candidate is tried in four forms of its own by `firstReadingEdit`, as at the base: as written, set apart by blank lines, and each of those escaped. With no target of several lines `forms` is `["lines"]`, and the candidates are the base's two. Where a target stands under a lone marker line, the whole list is tried twice: first with `withMarker` set, then without.

**A5. The code fence and the list-off toggle.** Replace `FENCED_CODE_SOURCE` and `listOff`. In both, only the end changes: the replacements are built for each choice of `markerLineChoices`, and the candidates are pushed in a loop.

```ts
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
export const FENCED_CODE_SOURCE: MarkdownSourceTransform = (text, from, to) => {
    const analysis = analyzeMarkdownSource(text);
    const selection = readLineTargets(analysis, from, to, true);

    if (selection === null) {
        return null;
    }

    const { targets } = selection;
    const code = fencedContent(text, targets);

    if (code === null) {
        return null;
    }

    const fence = "`".repeat(Math.max(MIN_FENCE_LENGTH, longestOpeningBacktickRun(code) + 1));
    const targetOf = targetOfEntry(targets);
    const leaves = readLeaves(analysis);

    /** Reads the expected leaves, with or without the tails lifted. */
    const expect = (lifts: LiftPlan | null): ExpectedLeaf[] => {
        let placed = false;

        return expectLeaves(leaves, (leaf) => {
            if (targetOf(leaf.entry) === -1) {
                return null;
            }

            if (placed) {
                return undefined;
            }

            placed = true;

            return { key: `code::${code.join("\n")}`.replace(/\n+$/, ""), path: columnPath(leaf.path), group: "fence" };
        }, lifts);
    };

    const lifts = tailLifts(analysis, targets);

    const candidates: EditCandidate[] = [];

    for (const withMarker of markerLineChoices(text, targets.slice(0, 1))) {
        const replacement: LineReplacement = {
            first: firstReplacedLine(text, targets[0]!, withMarker),
            last:  lineEndAt(text, targets[targets.length - 1]!.end - 1),
            lines: [fence, ...code, fence],
            nodes: targets,
        };

        if (lifts !== null) {
            candidates.push({ build: () => [replacement], expected: () => expect(lifts), tail: true });
        }

        candidates.push({ build: () => [replacement], expected: () => expect(null), tail: false });
    }

    return firstReadingEdit(analysis, candidates, [null], false);
};
```

```ts
/**
 * Lifts list item texts out of their items as paragraphs, a task item's
 * marker as the text it shows.
 *
 * @param analysis - The document's analysis.
 * @param targets - The item texts.
 * @returns The edit, or `null` when no form reads as intended.
 */
function listOff(analysis: SourceAnalysis, targets: readonly SourceBlockNode[]): MarkdownSourceEdit | null {
    const text = analysis.text;
    const targetOf = targetOfEntry(targets);
    const leaves = readLeaves(analysis);

    const change = (leaf: LeafView): ExpectedLeaf | readonly ExpectedLeaf[] | null => {
        const index = targetOf(leaf.entry);

        if (index === -1) {
            return null;
        }

        const path = [...columnPath(leaf.path), "p"];

        return markerTextLeaves(leaf, path, `t${index}`) ?? { key: leaf.key, path, group: `t${index}` };
    };

    const lifts = tailLifts(analysis, targets);

    /** Builds the replacements, with or without an item's lone marker line. */
    const buildFor = (withMarker: boolean) => (escape: boolean): LineReplacement[] => targets.map((target) => ({
        first: firstReplacedLine(text, target, withMarker),
        last:  lineEndAt(text, target.end - 1),
        lines: textLinesOf(target, "text").map((line) => (escape && !isBlank(line) ? escapeBlockStart(line, "") : line)),
        nodes: [target],
    }));

    const candidates: EditCandidate[] = [];

    for (const withMarker of markerLineChoices(text, targets)) {
        const build = buildFor(withMarker);

        if (lifts !== null) {
            candidates.push({ build, expected: () => expectLeaves(leaves, change, lifts), tail: true });
        }

        candidates.push({ build, expected: () => expectLeaves(leaves, change), tail: false });
    }

    return firstReadingEdit(analysis, candidates, targets.map(() => null), true);
}
```

**A6. The task marker's form.** Add directly after `TASK_MARKER_START`:

```ts
/**
 * A task marker's form opening a list item's text: `[ ]`, `[x]` or `[X]`
 * and the space or tab after it, which make the item a task item.
 */
const TASK_MARKER_FORM = /^\[[ xX]\][ \t]/;
```

Add directly after `escapeBlockStart`:

```ts
/**
 * Escapes a new list item's text where it would open something else in the
 * item. Text that opens with a task marker's form (`[ ] `, `[x] `) is written
 * as the text it shows, both brackets escaped (`\[ \] `), as the WYSIWYG
 * surface writes it and as a task item's marker is carried once it is text
 * ({@link textLinesOf}). Any other opening is escaped by
 * {@link escapeBlockStart}.
 *
 * @param line - The item's line, its marker already written.
 * @param prefix - The marker and the space after it.
 * @returns The line, escaped where needed.
 */
function escapeItemText(line: string, prefix: string): string {
    const content = line.slice(prefix.length);
    const isTaskForm = TASK_MARKER_FORM.test(content);

    return isTaskForm ? prefix + content.replace("[", "\\[").replace("]", "\\]") : escapeBlockStart(line, prefix);
}
```

**A7. The list toggle.** Replace `toggleList`, and add `takenLines` and `toggleTaken` after it.

```ts
/**
 * Toggles the selected lines' list: off when every selected line of the
 * blocks it touches is the marker line of an item in a list of `kind`, each
 * such item's text then lifted out as a paragraph (see
 * {@link blockPrefixSource}); otherwise on, each selected line that is not
 * yet such a marker line becoming a new item of `kind` at the top level.
 * The selection is read twice at most: first by the lines it takes of each
 * block ({@link takenLines}), and, where no form of that edit reads as
 * intended, by the blocks it touches, each taken whole as one item, as the
 * WYSIWYG surface toggles them.
 *
 * @param text - The full document text.
 * @param from - 0-based start of the raw selection.
 * @param to - 0-based end (exclusive) of the raw selection.
 * @param kind - The list kind.
 * @returns The edit, or `null` when the command declines.
 */
function toggleList(text: string, from: number, to: number, kind: "unordered" | "ordered"): MarkdownSourceEdit | null {
    const analysis = analyzeMarkdownSource(text);
    const selection = readLineTargets(analysis, from, to, false);

    if (selection === null) {
        return null;
    }

    const { targets } = selection;
    const selected = new Set(selection.lines.map((line) => line.start));
    const byLine = takenLines(text, targets, selected, false);
    const edit = toggleTaken(analysis, targets, byLine, kind);

    if (edit !== null) {
        return edit;
    }

    // Where the selected lines cannot be toggled one by one, the blocks they touch are toggled whole, each as one
    // item, as the WYSIWYG surface toggles them.
    const byBlock = takenLines(text, targets, selected, true);
    const isSameReading = byBlock.size === byLine.size && [...byBlock].every((line) => byLine.has(line));

    return isSameReading ? null : toggleTaken(analysis, targets, byBlock, kind);
}

/**
 * The lines of the touched blocks a list toggle takes: each selected line
 * of a block's text. A heading is taken whole, by its first line, whichever
 * of its lines are selected, its setext underline among them: its text is
 * one heading, and no line of it can stay one without the others. With
 * `whole`, every block is taken that way.
 *
 * @param text - The full document text.
 * @param targets - The blocks the selection touches.
 * @param selected - The selected lines' starts.
 * @param whole - Whether every block is taken by its first line alone.
 * @returns The taken lines' starts.
 */
function takenLines(text: string, targets: readonly SourceBlockNode[], selected: ReadonlySet<number>, whole: boolean): Set<number> {
    const taken = new Set<number>();

    for (const target of targets) {
        const lines = textLineSpans(text, target);

        if (whole || target.type === "heading") {
            taken.add(lines[0]!.start);
        } else {
            lines.filter((line) => selected.has(line.start)).forEach((line) => taken.add(line.start));
        }
    }

    return taken;
}

/**
 * Toggles the list of the taken lines: off when each is the marker line of
 * an item in a list of `kind`, else on.
 *
 * @param analysis - The document's analysis.
 * @param targets - The blocks the selection touches.
 * @param taken - The taken lines' starts ({@link takenLines}).
 * @param kind - The list kind.
 * @returns The edit, or `null` when no form reads as intended.
 */
function toggleTaken(analysis: SourceAnalysis, targets: readonly SourceBlockNode[], taken: ReadonlySet<number>, kind: "unordered" | "ordered"): MarkdownSourceEdit | null {
    const text = analysis.text;
    const marked = targets.every((target) => textLineSpans(text, target)
        .every((line) => !taken.has(line.start) || isMarkerLine(text, target, line.start, kind)));

    return marked ? listOff(analysis, targets) : listOn(analysis, targets, taken, kind);
}
```

**A8. `listOn` and its plan.** Replace `listOn` and the `ListPlan` interface.

```ts
/**
 * Turns selected lines into list items of `kind`: in each block, every
 * selected line that is not already the marker line of a `kind` item becomes
 * a new top-level item; the block's lines below the selection continue the
 * last new item, and its lines above the first new item stay where they are.
 * The new items of blocks with only blank lines between them are one run
 * ({@link adjoiningRuns}), written line after line and joined to the list of
 * `kind` next to them ({@link readListJoin}). When no form of that edit
 * reads as intended, the items are written as a list of their own, each
 * block's where it stands ({@link itemsApart}), and that edit is checked the
 * same way. Both are tried first with what each block's list item held after
 * it as the blocks of the block's last new item, and then with that left in
 * the list. All of these are tried as written before any is tried with the
 * new items' text escaped.
 *
 * @param analysis - The document's analysis.
 * @param targets - The blocks the selection touches.
 * @param selected - The starts of the lines the toggle takes ({@link takenLines}).
 * @param kind - The list kind.
 * @returns The edit, or `null` when nothing changes or no form reads as intended.
 */
function listOn(analysis: SourceAnalysis, targets: readonly SourceBlockNode[], selected: ReadonlySet<number>, kind: "unordered" | "ordered"): MarkdownSourceEdit | null {
    const text = analysis.text;
    /** The blocks with a line to convert; their new items start with or without an item's lone marker line. */
    const plansFor = (withMarker: boolean): ListPlan[] => targets.map((target) => {
        const lines = textLineSpans(text, target);
        const converted = lines.map((line) => selected.has(line.start) && !isMarkerLine(text, target, line.start, kind));
        const first = converted.indexOf(true);
        const sourceLines = nodeLines(text, target);

        return {
            target, lines, converted, first,
            from: first === 0 ? firstReplacedLine(text, target, withMarker) : lines[Math.max(first, 0)]!.start,
            last: sourceLines[sourceLines.length - 1]!,
        };
    }).filter((plan) => plan.first !== -1);

    const preferred = plansFor(true);

    if (preferred.length === 0) {
        return null;
    }

    const opening = preferred.filter((plan) => plan.first === 0).map((plan) => plan.target);

    const variants = markerLineChoices(text, opening).map((withMarker) => {
        const plans = withMarker ? preferred : plansFor(false);

        return { plans, runs: adjoiningRuns(text, plans) };
    });

    const hasListItem = preferred.some((plan) => liftedItems(plan.target).length > 0);
    const candidates: EditCandidate[] = [];

    // Every unescaped candidate is tried before any escaped one: a new item's text is escaped only where it would
    // otherwise open a block or a task marker inside the item (`[ ] a` as an item's text reads as a task item).
    for (const escape of [false, true]) {
        for (const { plans, runs } of variants) {
            // A list that gains an item below it no longer ends where it did, and what its last line read as can change
            // with that (trailing whitespace there, an indented code block, a fence left open). The items then stand apart.
            for (const tail of hasListItem ? [true, false] : [false]) {
                let leaves: ExpectedLeaf[] | null = null;
                /** Reads the expected leaves once for the two candidates that share them. */
                const expected = (): ExpectedLeaf[] => (leaves ??= expectedItemLeaves(analysis, plans, kind, tail));

                candidates.push({
                    build: () => runs.map((run) => itemReplacement(analysis, run, kind, readListJoin(analysis, run, kind, tail), tail, escape)), expected, tail,
                });
                candidates.push({ build: () => itemsApart(analysis, plans, kind, tail, escape), expected, tail });
            }
        }
    }

    // Every candidate writes one replacement per run or per block; none predicts leaves by a wildcard. The escaped
    // forms are candidates of their own, so `firstReadingEdit` is asked for none.
    return firstReadingEdit(analysis, candidates, [], false);
}
```

```ts
/** One block a list-on edit touches, with the lines of it that become items. */
interface ListPlan {
    readonly target:    SourceBlockNode;
    /** The lines of the block's text ({@link textLineSpans}). */
    readonly lines:     SourceLine[];
    /** Per line of the block's text, whether it becomes a new item. */
    readonly converted: boolean[];
    /** The index of the first line that does. */
    readonly first:     number;
    /** The start of the first line the new items take the place of ({@link firstReplacedLine} for the block's first line). */
    readonly from:      number;
    /** The block's last line: its text's, or a setext heading's underline, which goes with the text. */
    readonly last:      SourceLine;
}
```

A plan's `lines` are now the lines of the block's *text*, which for a setext heading leave out its underline. Four functions read the block's first or last line from the plan; each now reads the field that says what it means. `from` is the first line the new items take the place of, which for a block under a lone marker line is that marker line. `last` is the block's own last line, which for a setext heading is its underline.

| In | Replace | With |
|---|---|---|
| `lastLineOfNewItems` | `const ownLast = plan.lines[plan.lines.length - 1]!.start;` | `const ownLast = plan.last.start;` |
| `adjoiningRuns` | `previous.lines[previous.lines.length - 1]!.end + 1` | `previous.last.end + 1` |
| `adjoiningRuns` | `plan.lines[plan.first]!.start - 1` | `plan.from - 1` |
| `readListJoin` | `const firstLine = first.lines[first.first]!.start;` | `const firstLine = first.from;` |
| `readListJoin` | `last.lines[last.lines.length - 1]!.start;` | `last.last.start;` |
| `replacedLines` | `const firstLine = first.lines[first.first]!.start;` | `const firstLine = first.from;` |
| `replacedLines` | `const lastLine = last.lines[last.lines.length - 1]!;` | `const lastLine = last.last;` |

`expectedItemLeaves` is not changed: it finds a leaf's line among `plan.lines`, and a setext underline holds no leaf.

**A9. The item writers.** Replace `itemReplacement` and `itemsApart`. `itemReplacement` escapes a new item's text with `escapeItemText` (A6).

```ts
/**
 * Writes one run's converted lines as items, in one replacement.
 *
 * @param analysis - The document's analysis.
 * @param run - The run's blocks, in document order.
 * @param kind - The list kind.
 * @param join - The lists the items join, and the marker they are written with.
 * @param tail - Whether what follows the run's last block in its list items becomes the blocks of the last new item.
 * @param escape - Whether a new item's text is escaped where it would open a block or a task marker in the item.
 * @returns The replacement.
 */
function itemReplacement(
    analysis: SourceAnalysis, run: readonly ListPlan[], kind: "unordered" | "ordered", join: ListJoin, tail: boolean, escape: boolean,
): LineReplacement {
    let number = join.start;
    let follow = "";

    const lines = run.flatMap(({ target, converted, first }) => textLinesOf(target, "written").slice(first).map((line, offset) => {
        if (!converted[first + offset]!) {
            return line;
        }

        const marker = kind === "unordered" ? join.bullet : `${number}${join.delimiter}`;
        // The marker of a task item that stays an item opens its first line, and is no text to escape.
        const keepsTaskMarker = first + offset === 0 && taskMarkerOf(target) !== null;
        const written = `${marker} ${line.trimStart()}`;

        number += 1;
        // What the block's item holds after it goes into the last new item, at the column that item's text starts at.
        follow = tail && tailGoesIntoItem(target) ? " ".repeat(marker.length + 1) : "";

        const escaped = escape && !keepsTaskMarker ? escapeItemText(written, `${marker} `) : written;

        return escaped;
    }));

    return { ...replacedLines(analysis, run, join), lines, nodes: run.map((plan) => plan.target), follow };
}

/**
 * Writes each block's converted lines as items that join no list: `-` or
 * `1.`, `2.`, … counting from one across the blocks, each block's lines
 * replaced where they stand and the blank lines around them left as they
 * are. This is the form a list-on edit falls back to when the joined form
 * does not read as intended ({@link listOn}): it changes no line of a list
 * next to the items.
 *
 * @param analysis - The document's analysis.
 * @param plans - The touched blocks, in document order.
 * @param kind - The list kind.
 * @param tail - Whether what follows each block in its list items becomes the blocks of the block's last new item.
 * @param escape - Whether a new item's text is escaped where it would open a block or a task marker in the item.
 * @returns One replacement per block.
 */
function itemsApart(analysis: SourceAnalysis, plans: readonly ListPlan[], kind: "unordered" | "ordered", tail: boolean, escape: boolean): LineReplacement[] {
    let start = 1;

    return plans.map((plan) => {
        const replacement = itemReplacement(analysis, [plan], kind, { around: null, above: null, below: null, bullet: "-", delimiter: ".", start }, tail, escape);

        start += plan.converted.filter((isConverted) => isConverted).length;

        return replacement;
    });
}
```

**A10. Comments.** Two doc comments of functions that are not replaced describe what changed.

| Doc comment of | Replace | With |
|---|---|---|
| `blockPrefixSource` | `A heading is written one line per line of text.` | `A block of text becomes one heading, also where it has several lines ({@link HeadingForm}).` |
| `listSource` | from `The result is checked by lexing it, as the block-type transforms' are; a converted line` to `and anything {@link blockPrefixSource} declines.` | `The result is checked by lexing it, as the block-type transforms' are. A new item's text is escaped where it would read as a task marker or open a block inside the item. A heading is taken whole and becomes one item, a setext heading's underline dropped. Where the selected lines cannot be toggled one by one, the blocks they touch are toggled whole, each as one item. A line below a new item that would start a block rather than continue the item makes the command decline, as do a code block and anything {@link blockPrefixSource} declines.` |

Re-wrap each comment at the width of the lines around it.

### Part B — table cells

**B1. `markdownTableExtension.ts`.** Each cell interface gains a field, `splitRow` reads its cells from a new exported cut, and `tokenizeTable` fills the field.

```ts
// in MdTableHeaderCell, after `align`
    /** The 0-based column of the table the cell stands in. */
    column: number;

// in MdTableBodyCell, after `rowSpan`
    /** The 0-based column of the table the cell starts in: the column of the row's segment that holds its text. */
    column:  number;
```

Replace `splitRow`, keeping its doc comment, and add the two declarations after it:

```ts
function splitRow(line: string): string[] {
    return tableRowSegments(line).map((segment) => line.slice(segment.from, segment.to).replace(/\\\|/g, "|").trim());
}

/** One cell's stretch of a pipe-row line: from its first character to just before the `|` that ends it. */
export interface TableRowSegment {
    readonly from: number;
    readonly to:   number;
}

/**
 * Cuts one raw pipe-row line into the stretch each of its cells is written
 * in, in column order: one optional leading and trailing pipe is dropped,
 * and the line is cut at every unescaped `|`. A stretch still holds the
 * whitespace around its cell's text and writes `\|` for a literal `|`.
 * `splitRow` reads the cell texts from these stretches, so the tokenizer and
 * the source-mode analysis, which places each cell's text in the stretch of
 * its own column, cut a row the same way.
 *
 * @internal
 * @param line - One raw table-row line (with or without surrounding pipes).
 * @returns The stretches, one per cell, as offsets into `line`.
 */
export function tableRowSegments(line: string): TableRowSegment[] {
    const trimmed = line.trim();
    const hasLeadingPipe = trimmed.startsWith("|");
    const hasTrailingPipe = trimmed.length > (hasLeadingPipe ? 1 : 0) && trimmed.endsWith("|") && !trimmed.endsWith("\\|");
    const start = line.length - line.trimStart().length + (hasLeadingPipe ? 1 : 0);
    const end = line.trimEnd().length - (hasTrailingPipe ? 1 : 0);
    const segments: TableRowSegment[] = [];
    let from = start;

    for (let i = start; i < end; i += 1) {
        const char = line[i];

        if (char === "\\" && line[i + 1] === "|") {
            i += 1;
        } else if (char === "|") {
            segments.push({ from, to: i });
            from = i + 1;
        }
    }

    segments.push({ from, to: Math.max(from, end) });

    return segments;
}
```

In `tokenizeTable`, add `column,` as the last property of the object each header cell is mapped to, and as the last property of the object pushed to `rowCells`. Both have a variable of that name in scope: the `map` callback's index, and the loop's counter.

**B2. `markdownSourceTokens.ts`.** Add `tableRowSegments` to the imports from `markdownTableExtension.js` (a value import beside the existing type import). Replace `walkTable`, `findInRow`, `TableCellEntry` and `tableCellRows`. `alignInRow` is not changed.

```ts
/**
 * Walks a table: each header cell inside the header line, each body cell
 * inside its own row's line, and each cell's text inside the stretch of the
 * line that its own column is written in. A cell that a `<<` or `^^` merged
 * away has no token, so the cells of a row are not its stretches in order:
 * each cell names its column.
 *
 * @param builder - The analysis being built.
 * @param token - The table token.
 * @param raw - The text the lexer read for it.
 */
function walkTable(builder: Builder, token: MdTableToken, raw: string): void {
    const node = openNode(builder, token.type, token as unknown as Token);
    const span = spanAt(builder.place, builder.at, raw, builder.checked);

    pushBlock(builder, `table:${JSON.stringify(token.align)}:${JSON.stringify(token.widths)}`);

    tableCellRows(token).forEach((cells, index) => {
        // The delimiter row sits between the header (line 0) and the first body row (line 2).
        const line = span === null ? null : builder.place[builder.at.line + (index === 0 ? 0 : index + 1)] ?? null;
        // The header row starts where the table does; every other row is a line of its own.
        const rowStart = index === 0 ? builder.at.column : 0;
        const segments = line === null ? [] : tableRowSegments(line.text.slice(rowStart));

        pushBlock(builder, "row");

        for (const cell of cells) {
            const needle = cell.tokens.map((inline) => inline.raw).join("");
            const segment = segments[cell.column];
            const indexes = line === null || segment === undefined || needle === "" ? null : findInRow(line.text, rowStart + segment.from, rowStart + segment.to, needle);

            pushBlock(builder, cell.signature);
            walkInlineText(builder, cell.tokens, indexes === null ? null : indexes.map((at) => offsetAt(line!, at)), true);
            pushBlock(builder, "/cell");
        }

        pushBlock(builder, "/row");
    });

    pushBlock(builder, "/table");
    closeNode(builder, node, span);
}

/**
 * Finds a cell's text in the stretch of its row's line that the cell's own
 * column is written in, and maps each of its characters to the index it
 * stands at. The text is the stretch without the whitespace around it, so
 * it is looked for from the stretch's first character on and must end
 * inside the stretch. The line may write an escaped `\|` where the cell
 * text holds `|`, and `\<<` or `\^^` for a cell whose whole text is that
 * marker.
 *
 * @param line - The row's line.
 * @param from - Where the cell's stretch starts.
 * @param to - Where it ends.
 * @param needle - The cell's text.
 * @returns Each character's index, then the index past the match; `null` when it is not found.
 */
function findInRow(line: string, from: number, to: number, needle: string): number[] | null {
    // The head is the needle up to the first character the line may write differently.
    const head = /^[^|]*/.exec(needle)![0];
    const next = (after: number): number => (head === "" ? after : line.indexOf(head, after));
    let at = next(from);

    while (at !== -1 && at + head.length <= to) {
        const map = alignInRow(line, at, needle);
        const isInside = map !== null && map[map.length - 1]! <= to;

        if (map !== null && isInside) {
            return map;
        }

        at = next(at + 1);
    }

    return null;
}

/** One table cell's inline tokens and its block signature. */
interface TableCellEntry {
    tokens:    Token[];
    signature: string;
    /** The 0-based column the cell stands in. */
    column:    number;
}

/**
 * A table's cells, row by row: the header row, then each body row.
 *
 * @param token - The table token.
 * @returns The rows.
 */
function tableCellRows(token: MdTableToken): TableCellEntry[][] {
    return [
        token.header.map((cell) => ({ tokens: cell.tokens, signature: `cell:${String(cell.align)}:1:1`, column: cell.column })),
        ...token.rows.map((row) => row.map((cell) => ({
            tokens: cell.tokens, signature: `cell:${String(cell.align)}:${cell.colSpan}:${cell.rowSpan}`, column: cell.column,
        }))),
    ];
}
```

`findInRow` still searches, but only inside one cell's stretch, and the text it looks for is that stretch without the whitespace around it. It cannot stop on another cell.

---

## Ordered Implementation Steps

Run every command from `packages/lib`. Never run `npm install`, `npm ci` or `npm update`. The scratch folder is `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans4/gaps-revision/`. It is not in the repository. It holds:

| In the scratch folder | What it is |
|---|---|
| `proto/zz-gap-clean-lines.ts`, `proto/zz-gap-tokens.ts`, `proto/markdownTableExtension.gap.ts` | the three modules as this plan gives them. The first imports `./zz-loc-tokens` where the real module imports `markdownSourceTokens.js`; apart from that its code is the code of `## Internal Structure` |
| `proto/zz-gap-lines.ts` | the line module as measured: the same code with a `trace` export that tells the probes which candidate was taken |
| `proto/base-lines.ts`, `proto/base-tokens.ts`, `proto/base-table.ts` | the three modules as the plans of `depends-on` leave them (the table tokenizer is the tip's own): what step 1 compares with |
| `repo/` | the private copy the numbers were measured in, with its own `node_modules/marked` 18.1.0 |
| `tests/zz-plan-*.test.ts`, `snip/*.txt` | the three test files with this plan's changes, and each added piece of test code as a file |
| `decls.py`, `mkbase.sh`, `runimpl.sh`, `probes-impl/` | the comparison of step 1, and the probes of `## Verification` with their runner |
| `PROGRESS.md`, `out/`, `logs/` | the planner's log and measured outputs |

Use the files to check your edits against, not in place of them.

1. **Check the base.**
   - `node -p "require('marked/package.json').version"` prints `18.1.0`.
   - `grep -c "\['E41'" tests/component/markdown-editor.test.ts` prints `0`. If it prints `2`, `markdown-editor-heading-to-code-escapes` has landed: leave out every part of this plan marked *E41* (the two `DIFFERS` rows and their comment in step 3, the docs clause in step 14). The counts of red tests do not change, since the `E41` rows are green before and after; `DIFFERS` ends with 35 rows instead of 37, and `npm test` grows by 78 instead of 80.
   - `npx vitest run tests/component/markdown-editor.test.ts tests/component/markdown-source-edits.test.ts tests/component/display/markdownLexer.test.ts` is green.
   - `python3 <scratch>/decls.py <scratch>/proto/base-lines.ts src/typescript/lib/component/editor/markdownSourceLines.ts` prints nothing. It compares the two files declaration by declaration. Do the same for `base-tokens.ts` against `markdownSourceTokens.ts` and for `base-table.ts` against `src/typescript/lib/component/display/markdownTableExtension.ts`. If it names one of the declarations this plan replaces (`## Internal Structure` lists them), stop and report: the code of this plan was measured against those bodies. A name this plan does not touch is reported and then ignored.

2. **Keep the base for the differential.** `<scratch>/mkbase.sh "$PWD"` copies `markdownSourceLines.ts`, `markdownSourceTokens.ts` and `markdownSourceEdits.ts` into `tests/component/` as `zz-base-lines.ts`, `zz-base-tokens.ts` and `zz-base-edits.ts`. Do this before any source edit.

3. **Change the tests** as `## Expected Behaviour` says: `tests/component/markdown-editor.test.ts`, `tests/component/markdown-source-edits.test.ts` and `tests/component/display/markdownLexer.test.ts`. The lexer file imports `tableRowSegments`, which step 9 adds; until then `npm run typecheck:test` reports that import and nothing else.

4. **See the rows fail.** `npx vitest run tests/component/markdown-editor.test.ts tests/component/markdown-source-edits.test.ts tests/component/display/markdownLexer.test.ts`. Exactly 96 tests fail: 67 in the first file, 18 in the second and 11 in the third. `### What is red before the code` lists them. If another test fails, or one of these does not, stop and report.

5. **Part A, the check and the readers** (`markdownSourceLines.ts`): A1, A2 and A3 of `## Internal Structure`. `npm run typecheck` reports the new declarations as not used yet; that ends with step 6.

6. **Part A, block types**: A4 and A5. Check: `npm run typecheck` is clean. `grep -n "firstReplacedLine(" src/typescript/lib/component/editor/markdownSourceLines.ts` gives five lines: the definition, and one each in `markerLineChoices`, `convertBlocks`, `FENCED_CODE_SOURCE` and `listOff`.

7. **Part A, the list toggle**: A6 to A10. Check: `npm run typecheck` is clean. `grep -n "escapeItemText(\|TASK_MARKER_FORM" src/typescript/lib/component/editor/markdownSourceLines.ts` gives four lines: the two declarations, the call in `itemReplacement` and the test in `escapeItemText`. `grep -c '{0,3}#/' src/typescript/lib/component/editor/markdownSourceLines.ts` gives 0: the early return of `toggleList` is gone, `alreadyBlock` reads `ATX_HEADING_START`, and no other test for a `#` heading is left. `grep -c "firstReplacedLine(" src/typescript/lib/component/editor/markdownSourceLines.ts` gives 6: the five of step 6 and the one in `listOn`.

8. **See Part A's rows pass.** The command of step 4 leaves 19 tests red: the rows `P17` to `P22`, the two `bold acts in a table cell …` rows, and the 11 of the lexer file. Everything else in the three files is green.

9. **Part B, the tokenizer**: B1. Check: `npm run typecheck` is clean. `npx vitest run tests/component/display/markdownLexer.test.ts` is green, the rows `LX45` to `LX47` among them. `npx vitest run tests/component/markdown-roundtrip tests/component/display` is green: the tokenizer reads every table as before.

10. **Part B, the analysis**: B2. Check: `npm run typecheck` is clean. `grep -n "findInRow(" src/typescript/lib/component/editor/markdownSourceTokens.ts` gives two lines, the definition and the call in `walkTable`.

11. **See every row pass.** The three files of step 1 are green.

12. **Run the checks of `## Verification`**: the differential, parity, the table part and the cost. Every hard check is 0. Run at most two Vitest processes at a time.

13. **Clean up.** `find tests -name 'zz-*' -delete`, and commit none of those files. The probes use Node's `fs` and `process`, so `npm run typecheck:test` fails while they are in the tree.

14. **Docs and changelog**, as `## Documentation Impact` says.

15. **Full checks.** `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, `npm test`, `npm run docs:api`, `npm run docs:llms:check`, `npm run build:lib`.

16. **Manual checks**, as `### Manual checks` says.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceTokens.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-edits.test.ts` |
| Modify | `packages/lib/tests/component/display/markdownLexer.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Everything here is unit-testable but `### Manual checks`. Every expected text below was taken from a run of the prototype, and for the parity rows from a run of the WYSIWYG surface, not written from what the result should be.[^tests]

### Parity rows, `markdown-editor.test.ts`

All in `describe('MarkdownEditor list toggles in a list of their kind')`. A row is `[id, document, word the selection starts in, word it ends in or null, command, what the WYSIWYG surface saves, what source mode leaves]`.

**The commands.** The rows need two more heading levels. Change the type and the table:

```ts
    type ParityCommand = 'UL' | 'OL' | 'paragraph' | 'h1' | 'h2' | 'h3' | 'quote' | 'code';
```

and add to `PARITY_COMMANDS`, beside the `h2` entry:

```ts
        h1:        (editor) => editor.setBlockType('h1'),
        h3:        (editor) => editor.setBlockType('h3'),
```

**Rows that leave `DIFFERS`.** Delete these 13 rows from `DIFFERS`: `E16` (three), `E17`, `E20`, `E21`, `E31` (two), `E36`, `E28` (two), `E29`, `E35`. Delete with them the comments that speak of them alone:

- the two lines that start `// The differences that stay. A heading type makes each line of a block a heading`;
- the line that starts `// A list toggle on a heading written with a setext underline`;
- the two lines that start `` // Text opening with an unescaped `[ ] ` ``;
- the line that starts `// An item whose marker stands on a line of its own`.

The comment `// A list the WYSIWYG surface keeps as a raw Markdown block is one block there, and lines to source mode.` then opens the group of differences that stay; put `The differences that stay.` in front of its sentence.

**Eight of them move to `SAME`.** Append to `SAME`. Only the last element of each differs from the row deleted:

```ts
        // A block of several lines is one block under every command: one heading, one item where its lines cannot be
        // items of their own, and a heading written with a setext underline is one item.
        ['E16', 'one\\\ntwo', 'two', null, 'UL', '- one\\\n  two', '- one\\\ntwo'],
        ['E16', 'one\\\ntwo', 'one', 'two', 'OL', '1. one\\\n   two', '1. one\\\ntwo'],
        ['E16', 'one\\\ntwo', 'one', 'two', 'h2', 'one\\\ntwo\n---', 'one\\\ntwo\n---'],
        ['E17', '- one\\\n  two\n- three', 'one', 'three', 'UL', 'one\\\ntwo\n\nthree', 'one\\\ntwo\n\nthree'],
        ['E20', 'one\nmore', 'one', 'more', 'h2', 'one\nmore\n---', 'one\nmore\n---'],
        ['E21', 'one  \nmore\n\n- two', 'one', null, 'h2', 'one  \nmore\n---\n\n- two', 'one  \nmore\n---\n\n- two'],
        ['E31', 'one\nmore\n---\n\npara', 'one', null, 'UL', '- one\n  more\n\npara', '- one\nmore\n\npara'],
        ['E31', 'one\nmore\n---\n\npara', 'one', null, 'OL', '1. one\n   more\n\npara', '1. one\nmore\n\npara'],
```

The other five (`E28` (two), `E29`, `E35`, `E36`) hold documents the editor would not save as they stand, which a `SAME` row requires. They become rows of the source-mode `CASES` table below.

**New `SAME` rows**, appended after them:

```ts
        // One heading for a block of several lines: a setext underline for levels 1 and 2, the lines joined on one
        // `#` line below that, a hard line break kept by the first and dropped by the second.
        ['G1', 'one\nmore', 'one', null, 'h1', 'one\nmore\n===', 'one\nmore\n==='],
        ['G1', 'one\nmore', 'one', null, 'h3', '### one more', '### one more'],
        ['G2', 'one\\\ntwo', 'one', 'two', 'h3', '### one two', '### one two'],
        ['G3', 'one  \ntwo', 'one', null, 'h3', '### one two', '### one two'],
        ['G4', '- one\n  more\n- two', 'one', null, 'h2', 'one\nmore\n---\n\n- two', 'one\nmore\n---\n- two'],
        ['G4', '- one\n  more\n- two', 'one', null, 'h3', '### one more\n\n- two', '### one more\n- two'],
        ['G5', 'one **bold\nstill** more', 'one', null, 'h2', 'one **bold\nstill** more\n---', 'one **bold\nstill** more\n---'],
        ['G5', 'one **bold\nstill** more', 'one', null, 'h3', '### one **bold still** more', '### one **bold still** more'],
        ['G6', 'one **bold\nstill** more', 'one', 'still', 'UL', '- one **bold\n  still** more', '- one **bold\nstill** more'],
        ['G6', 'one **bold\nstill** more', 'one', 'still', 'OL', '1. one **bold\n   still** more', '1. one **bold\nstill** more'],
        ['G7', '> one\\\n> two', 'two', null, 'UL', '- one\\\n  two', '- one\\\ntwo'],
        ['G7', '> one\\\n> two', 'two', null, 'h2', 'one\\\ntwo\n---', 'one\\\ntwo\n---'],
        ['G8', 'one\nmore\n===', 'more', null, 'UL', '- one\n  more', '- one\nmore'],
        ['G8', 'one\nmore\n===', 'more', null, 'OL', '1. one\n   more', '1. one\nmore'],
        ['G8', 'one\nmore\n===', 'more', null, 'h2', 'one\nmore\n---', 'one\nmore\n---'],
        ['G8', 'one\nmore\n===', 'more', null, 'h3', '### one more', '### one more'],
        ['G9', 'one #', 'one', null, 'h1', '# one \\#', '# one \\#'],
        ['G9', 'one #', 'one', null, 'h2', '## one \\#', '## one \\#'],
        ['G9', 'one #', 'one', null, 'h3', '### one \\#', '### one \\#'],
        ['G10', 'one\ntwo #', 'one', null, 'h3', '### one two \\#', '### one two \\#'],
        ['G10', 'one\ntwo #', 'one', null, 'h2', 'one\ntwo #\n---', 'one\ntwo #\n---'],
        ['G11', '- [ ] one\\\n  two\n- three', 'two', null, 'UL', '\\[ \\] one\\\ntwo\n\n- three', '\\[ \\] one\\\ntwo\n- three'],
        ['G11', '- [ ] one\\\n  two\n- three', 'two', null, 'OL', '1. [ ] one\\\n   two\n\n- three', '1. [ ] one\\\ntwo\n- three'],
        ['G11', '- [ ] one\\\n  two\n- three', 'two', null, 'h2', '\\[ \\] one\\\ntwo\n---\n\n- three', '\\[ \\] one\\\ntwo\n---\n- three'],
        ['G12', '- one\\\n  two\n- three', 'one', 'three', 'OL', '1. one\\\n   two\n2. three', '1. one\\\ntwo\n2. three'],
        ['G13', 'one\nmore\n---\n\npara', 'more', 'para', 'h2', 'one\nmore\n---\n\n## para', 'one\nmore\n---\n\n## para'],
        ['G13', 'one\nmore\n---\n\npara', 'more', 'para', 'h3', '### one more\n\n### para', '### one more\n\n### para'],
        ['G13', 'one\nmore\n---\n\npara', 'more', 'para', 'UL', '- one\n  more\n- para', '- one\nmore\n- para'],
        ['G14', '::: columns\none\\\ntwo\n|||\nRight\n:::', 'two', null, 'UL', '::: columns\n- one\\\n  two\n|||\nRight\n:::', '::: columns\n- one\\\ntwo\n|||\nRight\n:::'],
        ['G14', '::: columns\none\\\ntwo\n|||\nRight\n:::', 'two', null, 'h2', '::: columns\none\\\ntwo\n---\n|||\nRight\n:::', '::: columns\none\\\ntwo\n---\n|||\nRight\n:::'],
        ['G15', 'one\\\ntwo\n\nthree\\\nfour', 'two', 'four', 'UL', '- one\\\n  two\n- three\\\n  four', '- one\\\ntwo\n- three\\\nfour'],
        ['G15', 'one\\\ntwo\n\nthree\\\nfour', 'two', 'four', 'h2', 'one\\\ntwo\n---\n\nthree\\\nfour\n---', 'one\\\ntwo\n---\n\nthree\\\nfour\n---'],
        ['G15', 'one\\\ntwo\n\nthree\\\nfour', 'two', 'four', 'h3', '### one two\n\n### three four', '### one two\n\n### three four'],
        ['G16', '- one #\n- two', 'one', null, 'h2', '## one \\#\n\n- two', '## one \\#\n- two'],
```

**Two rows are added to `DIFFERS`** (*E41*), at its end. They pin the difference that `markdown-editor-heading-to-code-escapes` closes, and they are green before and after. Leave them out when step 1 found `E41` rows in `SAME`:

```ts
        // A code block made from a heading holds the heading's text as each surface writes it: the WYSIWYG surface in
        // the form a paragraph holds it, with a paragraph's escapes, source mode as the heading's own line holds it.
        ['E41', '### +alpha', 'alpha', null, 'code', '```\n\\+alpha\n```', '```\n+alpha\n```'],
        ['E41', '# alpha \\#', 'alpha', null, 'code', '```\nalpha #\n```', '```\nalpha \\#\n```'],
```

After this step `DIFFERS` has 37 rows where the base has 48 (35 without the *E41* rows), and `SAME` has 42 more.

**One test after the `DIFFERS` loop**, directly before `it('a list kept as a raw block leaves its item with the item's text on the WYSIWYG surface alone', …)`:

```ts
    // No row can hold this: neither surface changes the document.
    it('a heading of several lines that has the level already is left as it is on both surfaces', () => {
        const row: ParityRow = ['one', 'one\nmore\n---', 'more', null, 'h2', '', ''];

        expect(wysiwygAfter(row).getValue()).toBe('one\nmore\n---');
        expect(sourceAfter(row)).toBe('one\nmore\n---');
    });
```

### Source-mode rows, `markdown-editor.test.ts`

**Line commands.** In the `CASES` table of `describe('MarkdownEditor source-mode line commands read the viewer's blocks')`, add directly after the row `E34 UL: what the item holds leaves the list in a document the editor would not write so`:

```ts
        {
            name: 'E28 UL: text that opens with a task marker is escaped as a new item\'s text', doc: '- aa\n- bb\n\n[ ] mid', select: [16, 16],
            run: (editor) => editor.toggleUnorderedList(), result: '- aa\n- bb\n- \\[ \\] mid',
        },
        {
            name: 'E28 OL: text that opens with a task marker is escaped as a new item\'s text', doc: '- aa\n- bb\n\n[ ] mid', select: [16, 16],
            run: (editor) => editor.toggleOrderedList(), result: '- aa\n- bb\n\n1. \\[ \\] mid',
        },
        {
            name: 'E29 UL: quoted text that opens with a task marker is escaped as a new item\'s text', doc: '> [ ] aa', select: [7, 7],
            run: (editor) => editor.toggleUnorderedList(), result: '- \\[ \\] aa',
        },
        {
            name: 'a later block of a list item that opens with a task marker is escaped as a new item\'s text', doc: '- one\n\n  [ ] para\n- two', select: [14, 14],
            run: (editor) => editor.toggleUnorderedList(), result: '- one\n\n- \\[ \\] para\n- two',
        },
        {
            name: 'a new item\'s text is escaped where it would open a list inside the item', doc: 'foo\n2. bar', select: [0, 10],
            run: (editor) => editor.toggleUnorderedList(), result: '- foo\n- 2\\. bar',
        },
        {
            name: 'E36 UL: a heading written with a setext underline becomes one item, its underline dropped', doc: 'Title\n=====\n\n- one', select: [1, 1],
            run: (editor) => editor.toggleUnorderedList(), result: '- Title\n- one',
        },
        {
            name: 'a list toggle with the caret on a setext underline takes the heading above it', doc: 'one\nmore\n---\n\npara', select: [10, 10],
            run: (editor) => editor.toggleUnorderedList(), result: '- one\nmore\n\npara',
        },
        {
            name: 'a heading with a setext underline that an item opens with leaves the list as a paragraph', doc: '- Title\n  ---\n- two', select: [3, 3],
            run: (editor) => editor.toggleUnorderedList(), result: 'Title\n- two',
        },
        {
            name: 'E35 UL: an item marker on a line of its own goes with the item\'s text', doc: '-\n  one\n- two', select: [5, 5],
            run: (editor) => editor.toggleUnorderedList(), result: 'one\n- two',
        },
        {
            name: 'E35 OL: an item marker on a line of its own goes with the item\'s text', doc: '-\n  one\n- two', select: [5, 5],
            run: (editor) => editor.toggleOrderedList(), result: '1. one\n- two',
        },
        {
            name: 'E35 h2: an item marker on a line of its own goes with the item\'s text', doc: '-\n  one\n- two', select: [5, 5],
            run: (editor) => editor.setBlockType('h2'), result: '## one\n- two',
        },
        {
            name: 'an item marker on a line of its own goes with a nested first item\'s text', doc: '4)\n     * muro', select: [11, 11],
            run: (editor) => editor.toggleUnorderedList(), result: 'muro',
        },
        {
            name: 'an item marker on a line of its own goes with the text, and what the item holds follows it', doc: '-\n  one\n\n  second\n- two', select: [5, 5],
            run: (editor) => editor.toggleUnorderedList(), result: 'one\n\nsecond\n- two',
        },
        {
            name: 'a heading of several lines that has the level already is left as it is', doc: 'one\nmore\n---', select: [1, 1],
            run: (editor) => editor.setBlockType('h2'), result: 'one\nmore\n---',
        },
        {
            name: 'a heading of several lines takes another level as one heading', doc: 'one\nmore\n---', select: [1, 1],
            run: (editor) => editor.setBlockType('h1'), result: 'one\nmore\n===',
        },
        {
            name: 'a continuation line that would end a setext heading is escaped', doc: 'foo\n2. bar', select: [1, 1],
            run: (editor) => editor.setBlockType('h2'), result: 'foo\n2\\. bar\n---',
        },
        {
            name: 'a paragraph made from a code block is set apart from the paragraph below it', doc: '```\ncode\n```\npara', select: [0, 12],
            run: (editor) => editor.setBlockType('paragraph'), result: 'code\n\npara',
        },
        {
            name: 'a quote made from a code block and the paragraph below it is two quotes', doc: '```\ncode\n```\npara', select: [0, 15],
            run: (editor) => editor.setBlockType('quote'), result: '> code\n\n> para',
        },
        {
            name: 'two code blocks made paragraphs stay two paragraphs', doc: '```\naa\n```\n```\nbb\n```', select: [0, 20],
            run: (editor) => editor.setBlockType('paragraph'), result: 'aa\n\nbb',
        },
```

**Wiring.** In the `CASES` table of `describe('MarkdownEditor source-mode command wiring')`, add after the row `toggleUnorderedList, with what the item holds`. Each pins that the command hands `CodeEditor` one change, which is one undo step:

```ts
        {
            name: 'setBlockType("h2"), a block of several lines', doc: 'one\nmore', anchor: 1, head: 1,
            run: (editor) => editor.setBlockType('h2'), changes: { from: 0, to: 8, insert: 'one\nmore\n---' },
        },
        {
            name: 'setBlockType("h3"), a block of several lines', doc: 'one\nmore', anchor: 1, head: 1,
            run: (editor) => editor.setBlockType('h3'), changes: { from: 0, to: 8, insert: '### one more' },
        },
        {
            name: 'toggleUnorderedList, a block taken whole', doc: 'one\\\ntwo', anchor: 6, head: 6,
            run: (editor) => editor.toggleUnorderedList(), changes: { from: 0, to: 8, insert: '- one\\\ntwo' },
        },
```

**Inline commands.** In the `CASES` table of `describe('MarkdownEditor source-mode commands read the viewer's tokens')`, add after the row `bold acts on a heading whose text is its own marker character`:

```ts
        {
            name: 'bold acts in a table cell that follows a cell merged to its left', doc: '| h | i | j |\n| --- | --- | --- |\n| a | << | < |', select: [45, 46],
            run: (editor) => editor.toggleBold(), result: '| h | i | j |\n| --- | --- | --- |\n| a | << | **<** |',
        },
        {
            name: 'bold acts in a table cell that follows a cell merged upwards', doc: '| h | i |\n| --- | --- |\n| ^ | a |\n| ^^ | ^ |', select: [41, 42],
            run: (editor) => editor.toggleBold(), result: '| h | i |\n| --- | --- |\n| ^ | a |\n| ^^ | **^** |',
        },
```

### Transform tests, `markdown-source-edits.test.ts`

**In `describe('line commands keep a paragraph whole')`, five tests are restated.** Each replaces the test named in the left column.

| Test at the base | What changes |
|---|---|
| `turns every line of the caret's paragraph into a heading` | one heading |
| `stops at a blank line and at a line that interrupts the paragraph` | its first expectation: one heading |
| `drops a setext heading's underline with the rest of its syntax` | a heading type writes one heading; the same level declines |
| `keeps a continuation line's leading number or marker as its text` | the number is escaped, in the heading and in a new item |
| `declines a list item over a setext heading's text` | the toggle acts |

```ts
    it('turns the caret\'s paragraph into one heading, whatever line the caret is on', () => {
        expect(apply('foo\n    bar', blockPrefixSource('## ')('foo\n    bar', 1, 1)!)).toBe('foo\nbar\n---');
        expect(apply('- one two\n  three', blockPrefixSource('## ')('- one two\n  three', 3, 3)!)).toBe('one two\nthree\n---');
        expect(apply('foo\nbar', blockPrefixSource('## ')('foo\nbar', 5, 5)!)).toBe('foo\nbar\n---');
        expect(apply('foo\nbar', blockPrefixSource('### ')('foo\nbar', 5, 5)!)).toBe('### foo bar');
    });

    it('stops at a blank line and at a line that interrupts the paragraph', () => {
        expect(apply('foo\nbar\n\nbaz', blockPrefixSource('## ')('foo\nbar\n\nbaz', 1, 1)!)).toBe('foo\nbar\n---\n\nbaz');
        expect(apply('foo\n- item', blockPrefixSource('## ')('foo\n- item', 1, 1)!)).toBe('## foo\n- item');
        expect(apply('## h\nfoo', blockPrefixSource('> ')('## h\nfoo', 5, 5)!)).toBe('## h\n> foo');
        expect(apply('1. a\n2. b', blockPrefixSource('## ')('1. a\n2. b', 3, 3)!)).toBe('## a\n2. b');
        expect(apply('> a\n>\n> b', blockPrefixSource('## ')('> a\n>\n> b', 2, 2)!)).toBe('## a\n>\n> b');
    });

    it('writes a setext heading of several lines as one heading of the new level, and drops its underline for any other block', () => {
        const text = 'foo\nbar\n===';

        expect(apply(text, blockPrefixSource('## ')(text, 1, 1)!)).toBe('foo\nbar\n---');
        expect(apply(text, blockPrefixSource('### ')(text, 1, 1)!)).toBe('### foo bar');
        // It is a level 1 heading already, in the one form a heading of several lines has.
        expect(blockPrefixSource('# ')(text, 1, 1)).toBeNull();
        expect(apply(text, blockPrefixSource('')(text, text.length, text.length)!)).toBe('foo\nbar');
        expect(apply(text, FENCED_CODE_SOURCE(text, 1, 1)!)).toBe('```\nfoo\nbar\n```');
    });

    it('keeps a continuation line\'s leading number or marker as its text, escaped where it would open a list', () => {
        expect(apply('foo\n2. bar', blockPrefixSource('## ')('foo\n2. bar', 1, 1)!)).toBe('foo\n2\\. bar\n---');
        expect(apply('foo\n2. bar', listSource('unordered')('foo\n2. bar', 0, 10)!)).toBe('- foo\n- 2\\. bar');
        // With the caret on the first line the second one continues the new item, and `2. bar` would end it.
        expect(listSource('unordered')('foo\n2. bar', 1, 1)).toBeNull();
    });

    it('makes one list item of a setext heading\'s text, whichever of its lines the caret is on', () => {
        expect(apply('foo\n===', listSource('unordered')('foo\n===', 1, 1)!)).toBe('- foo');
        expect(apply('foo\n===', listSource('ordered')('foo\n===', 1, 1)!)).toBe('1. foo');
        expect(apply('foo\nbar\n===', listSource('ordered')('foo\nbar\n===', 5, 5)!)).toBe('1. foo\nbar');
        // The caret on the underline.
        expect(apply('foo\nbar\n===', listSource('unordered')('foo\nbar\n===', 9, 9)!)).toBe('- foo\nbar');
    });
});
```

The last of these is the last test of its `describe`; the closing `});` in the block above is that `describe`'s.

**In `describe('line commands act on the blocks the viewer reads')`, add seven tests** at the end of the `describe`:

```ts
    it('escapes a new item\'s text where it would read as a task marker or open a block inside the item', () => {
        expect(apply('- aa\n- bb\n\n[ ] mid', listSource('unordered')('- aa\n- bb\n\n[ ] mid', 16, 16)!)).toBe('- aa\n- bb\n- \\[ \\] mid');
        expect(apply('- aa\n- bb\n\n[ ] mid', listSource('ordered')('- aa\n- bb\n\n[ ] mid', 16, 16)!)).toBe('- aa\n- bb\n\n1. \\[ \\] mid');
        expect(apply('> [ ] aa', listSource('unordered')('> [ ] aa', 7, 7)!)).toBe('- \\[ \\] aa');
        expect(apply('[x] aa\nbb', listSource('unordered')('[x] aa\nbb', 1, 1)!)).toBe('- \\[x\\] aa\nbb');
        expect(apply('- one\n\n  [ ]\tmid\n- two', listSource('unordered')('- one\n\n  [ ]\tmid\n- two', 14, 14)!)).toBe('- one\n\n- \\[ \\]\tmid\n- two');
        expect(apply('foo\n2. bar', listSource('ordered')('foo\n2. bar', 0, 10)!)).toBe('1. foo\n2. 2\\. bar');
        // A task item that changes kind keeps its marker: it is no text.
        expect(apply('- [ ] one', listSource('ordered')('- [ ] one', 7, 7)!)).toBe('1. [ ] one');
    });

    // The selected lines of a block are toggled one by one. Where no form of that reads, the blocks are toggled whole.
    it('toggles the touched blocks whole where their lines cannot be items of their own', () => {
        expect(apply('one\\\ntwo', listSource('unordered')('one\\\ntwo', 6, 6)!)).toBe('- one\\\ntwo');
        expect(apply('- one\\\n  two\n- three', listSource('unordered')('- one\\\n  two\n- three', 2, 20)!)).toBe('one\\\ntwo\n\nthree');
        expect(apply('one **bold\nstill** more', listSource('unordered')('one **bold\nstill** more', 0, 23)!)).toBe('- one **bold\nstill** more');
        // A hard line break written with trailing spaces ends its line's item, as before.
        expect(apply('one  \ntwo', listSource('unordered')('one  \ntwo', 0, 8)!)).toBe('- one  \n- two');
    });

    it('writes one heading for a block of several lines', () => {
        expect(apply('one\nmore', blockPrefixSource('## ')('one\nmore', 1, 1)!)).toBe('one\nmore\n---');
        expect(apply('one\nmore', blockPrefixSource('# ')('one\nmore', 1, 1)!)).toBe('one\nmore\n===');
        expect(apply('one\nmore', blockPrefixSource('### ')('one\nmore', 1, 1)!)).toBe('### one more');
        // One line cannot hold a hard line break: a level 3 heading drops it, a setext heading keeps it.
        expect(apply('one\\\ntwo', blockPrefixSource('### ')('one\\\ntwo', 1, 1)!)).toBe('### one two');
        expect(apply('one\\\ntwo', blockPrefixSource('## ')('one\\\ntwo', 1, 1)!)).toBe('one\\\ntwo\n---');
        expect(apply('one  \ntwo', blockPrefixSource('### ')('one  \ntwo', 1, 1)!)).toBe('### one two');
        expect(apply('# one\n\ntwo\nmore', blockPrefixSource('## ')('# one\n\ntwo\nmore', 0, 15)!)).toBe('## one\n\ntwo\nmore\n---');
        expect(blockTypes('one\nmore\n---')).toEqual(['heading']);
    });

    it('escapes a run of # that would close an ATX heading', () => {
        expect(apply('one #', blockPrefixSource('## ')('one #', 1, 1)!)).toBe('## one \\#');
        expect(apply('one\ntwo #', blockPrefixSource('### ')('one\ntwo #', 1, 1)!)).toBe('### one two \\#');
        expect(apply('one #\ntwo', blockPrefixSource('## ')('one #\ntwo', 1, 1)!)).toBe('one #\ntwo\n---');
        // A code block's text is read afresh, as Markdown.
        expect(apply('```\ncode #\n```', blockPrefixSource('## ')('```\ncode #\n```', 0, 14)!)).toBe('## code #');
    });

    it('takes an item marker that stands on a line of its own along with the item\'s first block', () => {
        expect(apply('-\n  one\n- two', listSource('unordered')('-\n  one\n- two', 5, 5)!)).toBe('one\n- two');
        expect(apply('-\n  one\n- two', listSource('ordered')('-\n  one\n- two', 5, 5)!)).toBe('1. one\n- two');
        expect(apply('-\n  one\n- two', blockPrefixSource('## ')('-\n  one\n- two', 5, 5)!)).toBe('## one\n- two');
        expect(apply('4)\n     * muro', listSource('unordered')('4)\n     * muro', 11, 11)!)).toBe('muro');
        expect(apply('-\n  one\n\n  second\n- two', blockPrefixSource('## ')('-\n  one\n\n  second\n- two', 5, 5)!)).toBe('## one\n\nsecond\n- two');
        expect(apply('- a\n-\n  one\n- two', listSource('unordered')('- a\n-\n  one\n- two', 9, 9)!)).toBe('- a\n\none\n\n- two');
        expect(apply('> -\n>   one\n> - two', blockPrefixSource('## ')('> -\n>   one\n> - two', 9, 9)!)).toBe('## one\n> - two');
        // A setext heading that opens the item is taken whole; text that reads as a task marker after a new marker is escaped.
        expect(apply('-\n  Title\n  ---\n- two', listSource('unordered')('-\n  Title\n  ---\n- two', 5, 5)!)).toBe('Title\n- two');
        expect(apply('-\n  Title\n  ---\n- two', blockPrefixSource('### ')('-\n  Title\n  ---\n- two', 5, 5)!)).toBe('### Title\n- two');
        expect(apply('-\n  [ ] mid\n- two', listSource('ordered')('-\n  [ ] mid\n- two', 9, 9)!)).toBe('1. \\[ \\] mid\n- two');
        expect(apply('-\n  [ ] mid\n- two', listSource('unordered')('-\n  [ ] mid\n- two', 9, 9)!)).toBe('[ ] mid\n- two');
        expect(apply('-\n  one', FENCED_CODE_SOURCE('-\n  one', 5, 5)!)).toBe('```\none\n```');
        // The marker line stays where the lines above it would read otherwise without it: `2. x` is a list only above the `-`.
        expect(apply('beta\n2. x\n-\n  gamma', blockPrefixSource('')('beta\n2. x\n-\n  gamma', 15, 15)!)).toBe('beta\n2. x\n-\ngamma');
        expect(apply('beta\n2. x\n-\n  gamma', blockPrefixSource('## ')('beta\n2. x\n-\n  gamma', 15, 15)!)).toBe('beta\n2. x\n-\n## gamma');
    });

    it('tells a setext heading whose text opens with # from a # heading', () => {
        expect(apply('#tag\n---', blockPrefixSource('## ')('#tag\n---', 1, 1)!)).toBe('## #tag');
        expect(apply('#tag\nmore\n---', listSource('unordered')('#tag\nmore\n---', 0, 13)!)).toBe('- \\#tag\nmore');
        expect(apply('#tag\nmore\n---', blockPrefixSource('### ')('#tag\nmore\n---', 1, 1)!)).toBe('### #tag more');
        expect(blockPrefixSource('## ')('#tag\nmore\n---', 1, 1)).toBeNull();
    });

    it('keeps text that was a code block in blocks of its own', () => {
        expect(apply('```\ncode\n```\npara', blockPrefixSource('')('```\ncode\n```\npara', 0, 12)!)).toBe('code\n\npara');
        expect(apply('```\ncode\n```\npara', blockPrefixSource('> ')('```\ncode\n```\npara', 0, 15)!)).toBe('> code\n\n> para');
        expect(apply('```\naa\n```\n```\nbb\n```', blockPrefixSource('')('```\naa\n```\n```\nbb\n```', 0, 20)!)).toBe('aa\n\nbb');
        expect(apply('para\n```\ncode\n```', blockPrefixSource('')('para\n```\ncode\n```', 5, 17)!)).toBe('para\n\ncode');
        expect(blockTypes('code\n\npara')).toEqual(['paragraph', 'paragraph']);
    });
```

**In `describe('source analysis places each block on the lines it stands on')`, add six rows** to `PLACES`, after `P16`:

```ts
        ['P17: a cell after a cell merged to its left, its text part of that marker', '| h | i | j |\n| --- | --- | --- |\n| a | << | < |', 'mdtable 0-48', [[2, 3], [6, 7], [10, 11], [36, 37], [45, 46]]],
        ['P18: a cell after a cell merged upwards', '| h | i |\n| --- | --- |\n| ^ | a |\n| ^^ | ^ |', 'mdtable 0-44', [[2, 3], [6, 7], [26, 27], [30, 31], [41, 42]]],
        ['P19: a cell whose text is the escaped marker', '| h | i | j |\n| --- | --- | --- |\n| a | << | \\<< |', 'mdtable 0-50', [[2, 3], [6, 7], [10, 11], [36, 37], [46, 48]]],
        ['P20: a cell whose text is an escaped pipe', '| h | i |\n| --- | --- |\n| \\| | a |', 'mdtable 0-34', [[2, 3], [6, 7], [27, 28], [31, 32]]],
        ['P21: the same in a quote', '> | h | i | j |\n> | --- | --- | --- |\n> | a | << | < |', 'blockquote 0-54 [mdtable 2-54]', [[4, 5], [8, 9], [12, 13], [42, 43], [51, 52]]],
        ['P22: a row written without its outer pipes', 'h | i | j\n--- | --- | ---\na | << | <', 'mdtable 0-36', [[0, 1], [4, 5], [8, 9], [26, 27], [35, 36]]],
```

### Tokenizer rows, `markdownLexer.test.ts`

Add the import beside the existing type import from the same module:

```ts
import { tableRowSegments } from '~/component/display/markdownTableExtension';
```

and this `describe` at the end of the file:

```ts
describe('a table cell names the column it stands in', () => {
    it('LX45: a header cell and a body cell carry their column, a merged-away cell leaving a gap', () => {
        const table = lexMarkdown('| h | i | j |\n| --- | --- | --- |\n| a | << | < |\n| ^^ | b | ^^ |')[0] as unknown as MdTableToken;

        expect(table.header.map((cell) => cell.column)).toEqual([0, 1, 2]);
        expect(table.rows.map((row) => row.map((cell) => [cell.text, cell.column, cell.colSpan, cell.rowSpan]))).toEqual([
            [['a', 0, 2, 1], ['<', 2, 1, 2]],
            [['^^', 0, 1, 1], ['b', 1, 1, 1]],
        ]);
    });

    for (const [line, segments, texts] of [
        ['| a | << | < |', [[1, 4], [5, 9], [10, 13]], [' a ', ' << ', ' < ']],
        ['a | b', [[0, 2], [3, 5]], ['a ', ' b']],
        ['|  a\\|b | c |', [[1, 8], [9, 12]], ['  a\\|b ', ' c ']],
        [' | a | b | ', [[2, 5], [6, 9]], [' a ', ' b ']],
        ['| a | | b |', [[1, 4], [5, 6], [7, 10]], [' a ', ' ', ' b ']],
        ['a|b|', [[0, 1], [2, 3]], ['a', 'b']],
        ['\\|', [[0, 2]], ['\\|']],
        ['|', [[1, 1]], ['']],
        ['||', [[1, 1]], ['']],
    ] as const) {
        it(`LX46: ${JSON.stringify(line)} is cut into the stretches of its cells`, () => {
            const cut = tableRowSegments(line);

            expect(cut.map((segment) => [segment.from, segment.to])).toEqual(segments);
            expect(cut.map((segment) => line.slice(segment.from, segment.to))).toEqual(texts);
        });
    }

    it('LX47: the tokenizer reads its cells from the same cut', () => {
        const source = '| h | i |\n| --- | --- |\n|  a\\|b | c |\n| \\<< | \\^^ |\n d | e\n| f |';
        const table = lexMarkdown(source)[0] as unknown as MdTableToken;

        expect(table.rows.map((row) => row.map((cell) => [cell.text, cell.column]))).toEqual([
            [['a|b', 0], ['c', 1]], [['<<', 0], ['^^', 1]], [['d', 0], ['e', 1]], [['f', 0], ['', 1]],
        ]);
        expect(lexMarkdown(source)).toEqual(lexMarkdownUnbounded(source));
    });
});
```

### What is red before the code

With the tests in place and no source file changed, 96 tests fail.

| File | Red | Which |
|---|---|---|
| `markdown-editor.test.ts` | 67 | the 42 `SAME` rows added; `a heading of several lines that has the level already is left as it is on both surfaces`; the 19 line-command `CASES` rows; the 3 wiring rows; the 2 inline rows |
| `markdown-source-edits.test.ts` | 18 | the 5 restated tests; the 7 new tests; `P17` to `P22` |
| `markdownLexer.test.ts` | 11 | `LX45`, the nine `LX46` rows, `LX47` |

After Part A, 19 are still red: `P17` to `P22`, the two inline rows and the 11 of the lexer file. They turn green with Part B.

Green before and after, and pinning what must not change: every `DIFFERS` row that stays, the 35 listed under *Every row that remains in `DIFFERS`*, and the two new `E41` rows; the cost tests of `describe('a source-mode command does work proportional to the document')`; and these tests of `describe('line commands keep a paragraph whole')`, which pin that a line below a new item that would end it still makes the toggle decline: `declines a list item over a continuation line that would read as an HTML block` and `declines a list item that a line below would interrupt rather than continue`.

### What does not change

- **Availability.** The `can…` fields in source mode, and everything on the WYSIWYG surface.
- **Undo.** A source-mode command is one transform, one edit and one `CodeEditor` change. The three wiring rows pin it for the new candidates.
- **A command that acts at the base** gives the same edit, except in the cases of G1, G2, G3 and G5. `## Verification` measures it.
- **Bytes outside the touched blocks.** As at the base, a command writes the lines of the blocks it converts and the container prefixes of what follows inside the containers it splits. `H5` of `## Verification` measures it.
- **Bytes inside the touched blocks**, beyond what the base writes there. The new candidates write nothing but these:

  | Written | Where |
  |---|---|
  | a backslash before the first character of a new item's text, or before each bracket of a task marker's form that opens it | an escaped list-on candidate, where the unescaped one does not read |
  | `===` or `---` on a line of its own | the `setext` form |
  | a space in place of each line end, a hard line break's backslash or trailing spaces dropped | the `joined` form |
  | a backslash before a closing `#` run | every `#` heading line |
  | nothing in place of a setext underline, and nothing in place of an item's lone marker line | a list toggle on a setext heading; any command on an item's first block |

- **What the tokenizer reads.** `splitRow` gives the same cell texts for every line; `LX47` and the round-trip suite pin it.

### Manual checks

Needs manual verification, in a browser on the demo's MD Editor page (`npx vite` in `packages/lib`), in source mode:

| # | Text | Action | Expect |
|---|---|---|---|
| B1 | `one`, `more` (two lines) | caret on `one`; context menu ▸ **Block style ▸ Heading 2** | `one`, `more`, `---`; one Ctrl+Z gives the two lines back |
| B2 | the same | **Block style ▸ Heading 3** | `### one more` |
| B3 | `one\`, `two` | caret on `two`; **Insert ▸ Bulleted list** | `- one\`, `two`; one Ctrl+Z gives the text back |
| B4 | `- aa`, `- bb`, blank, `[ ] mid` | caret on `mid`; **Insert ▸ Bulleted list** | `- aa`, `- bb`, `- \[ \] mid` |
| B5 | `Title`, `===` | caret on `===`; **Insert ▸ Numbered list** | `1. Title` |
| B6 | a table whose body row is `\| a \| << \| < \|` | select the last `<`; **Bold** | `\| a \| << \| **<** \|` |
| B7 | B1's result | switch to WYSIWYG | one heading of two lines, as the viewer shows it |
| B8 | `-`, `  one`, `- two` | caret on `one`; **Insert ▸ Bulleted list** | `one`, `- two`: no empty item above `one`; one Ctrl+Z gives the text back |

---

## Verification

1. `npm run typecheck`, `npm run typecheck:test`, `npm run lint`: clean (after step 13; the probes do not typecheck).
2. `npm test`: green. Against the base the count grows by 80 (78 without the *E41* rows): in `markdown-editor.test.ts` 42 `SAME` rows and 2 `DIFFERS` rows less the 13 `DIFFERS` rows deleted, 1 test, 19 and 3 and 2 `CASES` rows; in `markdown-source-edits.test.ts` 7 tests and 6 `P` rows; in `markdownLexer.test.ts` 11 tests.
3. `npm run docs:api`, `npm run docs:llms:check`, `npm run build:lib`.

4. **The differential against the base.** The probes are in the scratch folder under `probes-impl/`. They compare the copies step 2 made with the modules themselves, in one process, and run the measured prototype beside them. `runimpl.sh` copies a probe and its helpers into the tests tree, runs it and removes the probe:

   ```
   export P_LIB="$PWD" K=~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans4/gaps-revision
   S=~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/source-list-lift/sets
   mkdir -p $K/out-impl/diff $K/out-impl/par $K/out-impl/paraim $K/out-impl/tricky $K/out-impl/table
   # documents aimed at this plan's gaps, eight commands
   $K/runimpl.sh zz-gap-gen.test.ts a1 P_AIM=1 P_SEED=1 P_DOCS=1500 P_NAMES=UL,OL,p,quote,h1,h2,h3,code P_OUT=$K/out-impl/diff/aim-s1   # and seeds 2, 3, 4
   # the document generator of the sixth review of the list-lift work ("review 6"; zz-gap-review6-gen.ts): the four seeds and case counts of the earlier plans
   $K/runimpl.sh zz-gap-gen.test.ts g11 P_SEED=11 P_CASES=497232 P_OUT=$K/out-impl/diff/gen-s11   # and 12: 507198, 13: 501486, 14: 511896
   # every row set of the earlier planners, implementers and reviewers (70 files)
   for f in $S/*.json; do $K/runimpl.sh zz-gap-setrows.test.ts r-$(basename $f .json) P_IN=$f P_OUT=$K/out-impl/diff/rows-$(basename $f .json); done
   # the block-locator plan's look-alike documents
   $K/runimpl.sh zz-gap-gen.test.ts l31 P_LOOK=1 P_SEED=31 P_DOCS=700 P_OUT=$K/out-impl/diff/look-s31    # and P_SEED=32
   $K/runimpl.sh zz-gap-gen.test.ts g41 P_SEED=41 P_DOCS=700 P_OUT=$K/out-impl/diff/look-g41
   # documents whose text reads otherwise in another block, eight commands
   $K/runimpl.sh zz-gap-trickydiff.test.ts td1 P_SEED=1 P_DOCS=1500 P_OUT=$K/out-impl/diff/trickydiff-s1   # and P_SEED=2
   python3 $K/sumcounts.py $K/out-impl/diff
   ```

   Run at most two at a time. Hard checks, each 0:

   | Check | Meaning |
   |---|---|
   | `H1` | the new code throws |
   | `H2` | the base acts and the new code does nothing. One kind of case is counted apart and is not an `H2`: a heading type on a selection that holds a setext heading of several lines of that level already, and nothing else to convert (G1) |
   | `H3` | the viewer's text, all blocks joined and whitespace removed, differs from the document's (commands other than the code fence; a code block turned into text is read afresh and counted apart) |
   | `H4` | two blocks of text are one afterwards |
   | `H4c` | a block is joined to text that was a code block. The base does this; the new code must not |
   | `H5` | a line outside the touched blocks is not in the result, compared without its quote markers, list markers and indentation, each run of spaces and tabs read as one space |
   | `H7` | an edit that changes nothing |
   | `H8` | a result differs from the base's, or the new code acts where the base did nothing, and the prototype's trace names none of this plan's changes as the reason |
   | `H9` | the module gives another edit than the measured prototype |

   Measured on `736452bbc` with the code of the five `depends-on` plans applied and `marked` 18.1.0.[^numbers] `H9` is the implementer's check. The planner's counterpart is the run of this plan's module text against the measured prototype: 521,432 cases, none with another edit.

   | Set (line commands) | Cases | `H1` to `H8` | Same edit as the base | Both do nothing | Acts where the base did nothing | Another edit than the base | The base splits a heading that is one already |
   |---|---|---|---|---|---|---|---|
   | documents aimed at this plan's gaps, 6,000 documents, eight commands (`h1` and `h3` among them) | 2,152,584 | 0 | 614,408 | 1,014,838 | 320,834 | 200,018 | 2,486 |
   | review 6's generator, seeds 11 to 14, 1,500 documents each | 2,017,812 | 0 | 978,426 | 938,063 | 52,119 | 48,943 | 261 |
   | the 70 row sets of reviews 4 and 5 and of the earlier planners and implementers | 236,552 | 0 | 148,876 | 79,102 | 3,310 | 5,264 | 0 |
   | the block-locator plan's look-alike documents and one more generated seed, 2,100 documents | 970,320 | 0 | 405,861 | 514,985 | 28,709 | 20,669 | 96 |
   | documents whose text reads otherwise in another block (a closing `#` run, escapes, punctuation at a line's start or end), 3,000 documents, eight commands | 306,192 | 0 | 177,243 | 40,464 | 37,499 | 50,279 | 707 |

   Why the new code acts where the base did nothing, and why an edit differs, over all five sets (a case can have more than one reason):

   | Reason | Acts where the base did nothing | Another edit than the base |
   |---|---|---|
   | a new item's text escaped (gap 1) | 50,338 | 8 |
   | of those, a task marker's form written as the text it shows (G7) | 44,945 | 0 |
   | a setext heading under a list toggle (gap 2) | 145,047 | 9 |
   | one heading for a block of several lines (gaps 3 and 4) | 176,559 | 247,980 |
   | of those, a level 1 or 2 heading in the `joined` form | 263 | 729 |
   | the toggle taken by blocks (gap 4) | 85,662 | 0 |
   | text that was a code block kept apart (gap 5) | 0 | 2,607 |
   | a closing run of `#` escaped (gap 7) | 9,273 | 0 |
   | an item's lone marker line taken along (gap 8) | 28,791 | 89,852 |
   | a heading of several lines in the selection left as it is, the other blocks converted | 1,821 | 2,566 |
   | a setext heading whose text opens with `#`, which the base takes for a `#` heading | 152 | 65 |
   | a touched block under a lone marker line that stays: the choice without it was taken, or the toggle does not take the block's first line | 4,515 | 321 |

   The 8 in the last column of the row on escaped text are 8 of the 9 of the row on a setext heading under a list toggle, and all 9 are among the 65 of the row on a setext heading whose text opens with `#`: the base acts there only because it takes that heading for a `#` heading. The ninth also takes a lone marker line along. Apart from them, no escaped candidate and no toggle by blocks changes an edit the base makes, and no task marker's form written as text does.

   The form `lines`, a heading for each line, was taken in 0 of the 5,683,460 cases, and the `joined` form for a level 1 or 2 heading in 992.

5. **Parity with the WYSIWYG surface.** `zz-gap-parity.test.ts` and `zz-gap-tricky.test.ts` run every case on the WYSIWYG surface, on the base copy and on the module.

   ```
   # review 6's three families, seeds 300 to 307, 60 documents each
   $K/runimpl.sh zz-gap-parity.test.ts p-simple-300 P_RICH=0 P_TASKS=0 P_SEED=300 P_DOCS=60 P_OUT=$K/out-impl/par/simple-s300   # rich: P_RICH=1; richt: P_RICH=1 P_TASKS=0.25
   # the aimed documents, with h1 and h3
   $K/runimpl.sh zz-gap-parity.test.ts pa1 P_AIM=1 P_SEED=1 P_DOCS=40 P_OUT=$K/out-impl/paraim/s1   # seeds 1 to 4
   # documents the editor saves whose text reads otherwise in another block
   $K/runimpl.sh zz-gap-tricky.test.ts pt1 P_SEED=1 P_DOCS=120 P_OUT=$K/out-impl/tricky/s1   # and P_SEED=2
   ```

   Each of these runs holds three editors' worth of documents in memory. Run them one at a time, or a seed in two processes: `P_FROM=0 P_TO=30` and `P_FROM=30 P_TO=60` take the first and the second half of a seed's 60 documents, each with a `P_OUT` of its own. Then, for each of the three folders `par`, `paraim` and `tricky`: `python3 $K/sumcounts.py $K/out-impl/par` gives the counts and `python3 $K/anpar.py $K/out-impl/par` gives `P` and the clause of every remaining case.

   Hard checks, each 0: `P` (the base's result reads as the WYSIWYG result and the new one does not, in a case that is not `setBlockType` on a block a list item holds; `anpar.py` in the scratch folder counts it), `H1`, `H8 SURFACE` (a source-mode result, loaded into the editor, is shown otherwise than the viewer shows it), `H9 RELOAD` (loaded and saved, it does not reload to itself).

   | Family | Cases | Source reads otherwise than WYSIWYG, base | After | `P` | `H1` | `H8` | `H9` |
   |---|---|---|---|---|---|---|---|
   | review 6's three families (documents the editor saves) | 90,454 | 7,087 | 7,087 | 0 | 0 | 0 | 0 |
   | the aimed documents (mostly hand-written forms), with `h1` and `h3` | 17,766 | 13,279 | 9,449 | 0 | 0 | 0 | 0 |
   | documents the editor saves whose text reads otherwise in another block, with `h1` and `h3` | 6,040 | 1,385 | 307 | 0 | 0 | 0 | 0 |

   Every case that still reads otherwise stands under a clause the docs keep.[^clauses]

6. **The table part.** `zz-gap-cells.test.ts` places every cell with the base analysis and with the new one, and checks each place by changing one character there and lexing again: exactly that cell's text must change. `zz-gap-inline.test.ts` runs the seven inline commands and the selection state over both.

   ```
   $K/runimpl.sh zz-gap-cells.test.ts c12 P_SEEDS=1,2 P_DOCS=1500 P_OTHER=1 P_OUT=$K/out-impl/table/cells-s12   # and P_SEEDS=3,4
   $K/runimpl.sh zz-gap-inline.test.ts i12 P_TABLES=1,2 P_DOCS=400 P_OUT=$K/out-impl/table/inline-tables12   # and P_TABLES=3,4
   for f in $S/*.json; do $K/runimpl.sh zz-gap-inline.test.ts i-$(basename $f .json) P_IN=$f P_OUT=$K/out-impl/table/inline-$(basename $f .json); done
   ```

   Hard checks, each 0: any count whose name starts with `H`. They are: the new analysis throws; a cell it places is not on its own text; the two analyses read different entries; they place a document otherwise that holds neither a merge marker nor an escaped pipe; an inline command or a selection state differs although the analyses agree; the base acts and the new analysis does nothing.

   | | Count |
   |---|---|
   | generated table documents and documents of the other generators | 24,018 |
   | cells that hold text | 57,868 |
   | placed on their own text by the base / by the new analysis | 56,191 / 57,868 |
   | placed on other text by the base / by the new analysis | 1,677 / 0 |
   | documents the two analyses place otherwise: with a merge marker / with an escaped pipe / with neither | 1,673 / 126 / 0 |
   | inline commands and selection states, generated tables and the 70 row sets | 471,072 and 80,269 |
   | same edit / both do nothing / acts where the base did nothing / another edit | 210,524 / 260,393 / 155 / 0 |
   | the base acts and the new analysis does nothing | 0 |
   | selection states that differ | 0 |
   | hard checks | 0 |

7. **Cost.** `$K/runimpl.sh zz-gap-perf.test.ts perf P_REPS=7 P_SIZES=400,1600,6400 P_OUT=$K/out-impl/perf.txt` times the base copies against the modules, and `python3 $K/perftable.py $K/out-impl/perf.txt` prints the tables below. Report them. Three requirements:

   - Where both sides act, a command takes the base's time, within the spread between runs. The same holds for every `ANALYSE` line.
   - A command over everything grows from 1,600 to 6,400 lines as the base's does. Compare the two growth figures the script prints; do not compare with fourfold alone, which a machine short of memory does not reach for the base either.
   - Where the base does nothing and the new code acts, the new code may take up to about three times the base's time: it tries the base's candidates first and then its own.

   Measured in ms, base / new, the least of the timings of each line; on a quiet machine, one process.

   | Document | Lines | Bulleted toggle, caret | Heading 2, caret | Bulleted toggle, everything | Heading 2, everything | Heading 3, everything |
   |---|---|---|---|---|---|---|
   | headings and paragraphs of two lines | 400 | 2.5 / 2.5 | 2.0 / 2.7 | 3.9 / 4.1 | 2.9 / 2.8 | 3.0 / 2.8 |
   | headings and paragraphs of two lines | 1,600 | 9.8 / 9.9 | 0.0 / 0.0 (both do nothing) | 23.0 / 24.7 | 13.8 / 13.2 | 14.9 / 13.8 |
   | headings and paragraphs of two lines | 6,400 | 62.4 / 59.5 | 64.3 / 64.2 | 105.4 / 108.3 | 89.6 / 85.1 | 90.4 / 84.3 |
   | one list, eight levels deep | 400 | 11.9 / 11.3 | 11.1 / 11.6 | 11.7 / 11.7 | 7.4 / 7.7 | 7.4 / 7.7 |
   | one list, eight levels deep | 1,600 | 54.4 / 54.4 | 55.4 / 57.6 | 56.3 / 57.6 | 36.3 / 36.1 | 35.0 / 36.2 |
   | one list, eight levels deep | 6,400 | 246.5 / 245.3 | 252.0 / 254.7 | 253.4 / 253.8 | 180.7 / 178.4 | 175.0 / 179.0 |
   | a tight list | 400 | 6.5 / 6.4 | 4.7 / 4.7 | 5.1 / 5.2 | 4.4 / 4.5 | 4.3 / 4.5 |
   | a tight list | 1,600 | 35.2 / 32.1 | 25.0 / 24.5 | 24.7 / 26.7 | 24.4 / 25.9 | 25.9 / 26.2 |
   | a tight list | 6,400 | 171.0 / 171.3 | 132.4 / 130.5 | 136.3 / 134.9 | 117.0 / 121.9 | 118.1 / 120.8 |
   | a loose list, each item holding a paragraph | 399 | 2.4 / 2.4 | 2.4 / 2.4 | 3.6 / 3.4 | 2.3 / 2.4 | 2.3 / 2.4 |
   | a loose list, each item holding a paragraph | 1,599 | 10.4 / 9.8 | 10.5 / 10.5 | 13.2 / 14.1 | 9.8 / 10.2 | 10.0 / 10.1 |
   | a loose list, each item holding a paragraph | 6,399 | 53.9 / 55.6 | 57.6 / 59.4 | 68.2 / 70.9 | 59.0 / 58.6 | 57.6 / 60.4 |
   | paragraphs of three lines with a backslash line break | 399 | 2.4 / 1.9 | 3.1 / 2.0 (the base does nothing) | 6.1 / 14.5 (the base does nothing) | 3.6 / 2.3 (the base does nothing) | 3.9 / 2.1 (the base does nothing) |
   | paragraphs of three lines with a backslash line break | 1,599 | 7.7 / 7.8 | 12.9 / 8.5 (the base does nothing) | 28.3 / 71.7 (the base does nothing) | 20.2 / 10.6 (the base does nothing) | 19.7 / 10.0 (the base does nothing) |
   | paragraphs of three lines with a backslash line break | 6,399 | 120.1 / 243.9 (the base does nothing) | 82.8 / 54.7 (the base does nothing) | 149.7 / 379.9 (the base does nothing) | 106.5 / 66.6 (the base does nothing) | 105.2 / 63.5 (the base does nothing) |
   | setext headings of two lines over a paragraph | 401 | 0.0 / 1.2 (the base does nothing) | 1.3 / 0.0 (the new code does nothing) | 0.0 / 2.2 (the base does nothing) | 1.6 / 1.5 | 1.6 / 1.6 |
   | setext headings of two lines over a paragraph | 1,601 | 0.0 / 3.9 (the base does nothing) | 5.6 / 0.0 (the new code does nothing) | 0.1 / 7.4 (the base does nothing) | 7.0 / 6.4 | 7.0 / 6.8 |
   | setext headings of two lines over a paragraph | 6,401 | 0.1 / 19.1 (the base does nothing) | 28.4 / 0.1 (the new code does nothing) | 0.4 / 46.6 (the base does nothing) | 41.6 / 35.2 | 38.6 / 38.4 |
   | paragraphs that open with `[ ] ` | 399 | 3.0 / 4.0 (the base does nothing) | 1.3 / 1.8 | 6.6 / 9.5 (the base does nothing) | 2.1 / 2.2 | 2.1 / 2.2 |
   | paragraphs that open with `[ ] ` | 1,599 | 11.1 / 19.6 (the base does nothing) | 6.0 / 7.7 | 32.7 / 46.8 (the base does nothing) | 9.4 / 9.6 | 9.1 / 9.8 |
   | paragraphs that open with `[ ] ` | 6,399 | 67.0 / 97.3 (the base does nothing) | 45.1 / 44.7 | 285.1 / 350.9 (the base does nothing) | 58.4 / 60.6 | 59.6 / 61.6 |

   Over the 231 command timings where both sides act and the base takes at least 1 ms, the new code took 1.00 times the base's time at the median, 1.05 times at the ninth decile and 1.39 times at worst.

   Analysis, base / new analysis (only a table is read otherwise):

   | Document | Lines | Analysis |
   |---|---|---|
   | headings and paragraphs of two lines | 400 | 0.5 / 0.5 |
   | headings and paragraphs of two lines | 1,600 | 2.1 / 2.0 |
   | headings and paragraphs of two lines | 6,400 | 7.8 / 8.0 |
   | one list, eight levels deep | 400 | 3.4 / 3.4 |
   | one list, eight levels deep | 1,600 | 12.7 / 13.5 |
   | one list, eight levels deep | 6,400 | 59.7 / 58.8 |
   | a tight list | 400 | 1.2 / 1.3 |
   | a tight list | 1,600 | 5.1 / 5.1 |
   | a tight list | 6,400 | 21.0 / 21.3 |
   | one table of four columns with merged cells | 402 | 2.5 / 2.5 |
   | one table of four columns with merged cells | 1,602 | 10.0 / 10.1 |
   | one table of four columns with merged cells | 6,402 | 49.5 / 50.8 |

   Growth of a command over everything from 1,600 to 6,400 lines (fourfold is linear): the new code 4.4- to 7.7-fold over 47 timings, 5.5-fold at the median; the base 4.4- to 6.5-fold over 39 timings, 5.4-fold at the median.

   Over the 32 timings where the base tries its candidates and does nothing and the new code acts, the new code took 0.5 to 2.5 times the base's time, 1.4 times at the median.

---

## Documentation Impact

No export changes: nothing is added to a barrel and `llms.txt` is not affected. Two pages change. The plans of `depends-on` edit the same paragraphs before this plan, so find each clause by its words, not by its line.

**`docs/components/MarkdownEditor.md`**, the source-mode section.

1. In the paragraph that starts `The block commands —`:
   - replace `A heading is written one line per line of text.` with:

     > A block of text becomes one heading. A block of several lines is written with a setext underline for `h1` and `h2` (`setBlockType("h2")` on `one` / `two` gives `one` / `two` / `---`) and on one line for `h3` to `h6`, its lines joined by a space and a hard line break dropped (`### one two`), as the WYSIWYG surface saves such a heading; an `h1` or `h2` one of whose lines would end the setext form is written on one line too. A run of `#` that would close a one-line heading is escaped (`one #` gives `## one \#`).

   - after `the paragraph's lines below the selection continuing the last one;` add:

     > a heading is taken whole and becomes one item, a setext heading's underline dropped; where the selected lines cannot be items of their own — a hard line break written with a backslash stands between them, or an emphasis run spans them — the blocks they touch are toggled whole, each as one item, as on the WYSIWYG surface; a new item's text is escaped where it would read as a task marker or open a block inside the item, as the WYSIWYG surface escapes it (`[ ] a` gives `- \[ \] a`);

   - after `a task item's marker written as the text it shows (`` `- [x] a` `` gives `` `\[x\] a` ``).` add:

     > A list item's marker that stands on a line of its own goes with the item's first block.

   - replace `a converted block is first set apart by blank lines (so a paragraph does not join the text or definition around it)` with `a converted block is first set apart by blank lines (so a paragraph does not join the text or definition around it, and text that was a code block stays in blocks of its own)`.

2. In the paragraph that lists the differences for Markdown the editor saves (after `markdown-source-mode-list-lift-parity` it starts `For Markdown written as the editor saves it` and goes on `They come from the surfaces holding different things:`), delete two clauses:
   - from `a heading type on a block of several lines makes each line a heading of its own in source mode` to `where the WYSIWYG toggles make it an item;`
   - from `in a block that holds a backslash line break` to `where the WYSIWYG commands convert the block as one;`

   and add one (*E41*), after the clause on `setBlockType("code")` over several blocks. Leave it out when step 1 found `E41` rows in `SAME`; `markdown-editor-heading-to-code-escapes` deletes it when it lands after this plan, by these words:

   > a code block made from a heading holds the heading's text as each surface writes it — the WYSIWYG surface in the form a paragraph holds it (`### +a` gives a code block holding `\+a`, and `# a \#` one holding `a #`), source mode as the heading's own line holds it (`+a`, `a \#`);

3. In the paragraph that starts `Markdown the editor would not write itself`:
   - delete the clause `a list toggle on text that opens with an unescaped `` `[ ] ` `` or `` `[x] ` ``, which the new item would read as a task marker (the editor writes `` `\[ \]` ``);`
   - delete the sentence that starts `Where an item's marker stands on a line of its own`;
   - in the clause on indentation, after `a block standing indented below an empty list item` add `(source mode rewrites the lines of the blocks it converts, never the indentation of a block that only stands below them)`;
   - add before `and indentation that would make the lines after the result read otherwise`: `a line below a new item that would end the item rather than continue it (`` `foo` `` / `` `2. bar` `` with the caret on `` `foo` ``);`

**`docs/reference/changelog/next.md`** — two bullets, wrapped at 76 columns with a two-space hanging indent like their neighbours.

Under `## Changed` → `### Components`:

> - **`MarkdownEditor`'s source-mode `setBlockType("h1")` to `("h6")` writes one heading for a block of several lines.** It wrote a heading for each line. It now writes what the WYSIWYG surface saves: for `h1` and `h2` the lines over a setext underline (`one` / `two` gives `one` / `two` / `---`), for `h3` to `h6` one line (`### one two`). A heading of several lines that already has the level is left as it is.

Under `## Fixed` → `### Components`:

> - **`MarkdownEditor`'s source-mode block commands act in more places where the WYSIWYG commands act.** A list toggle did nothing on text that opens with `[ ] ` or `[x] `, on a heading written with a setext underline, and for a selection that takes the line after a backslash line break; the heading types did nothing in a block that holds such a break, and on text that ends in a space and a run of `#`. The toggles now write the new item's text escaped as the WYSIWYG surface writes it (`- \[ \] a`), make one item of the heading's text, and toggle the touched blocks whole where their lines cannot be items of their own. A heading line is written with a closing `#` run escaped (`## one \#`). A list item's marker on a line of its own no longer stays behind as an empty item, and a code block turned into a paragraph or a quote no longer joins the paragraph next to it. `toggleBold()` and the other inline commands now act in a table cell that follows a merged cell (`| a | << | < |`). No consumer action is needed.

Run `npm run docs:llms:check` afterwards.

---

## Potential Challenges

- **The base moved.** A plan of `depends-on` may have edited a function this plan replaces. Step 1 stops on that. Merge by hand, then rerun steps 4, 8, 11 and 12 in full.
- **A row's expected text differs by a blank line or a backslash.** The order of the candidates decides both. A blank line too many means a form was skipped; a backslash too many means an escaped candidate was tried before an unescaped one. Compare `listOn`'s loop and `convertBlocks`'s `forms` with the code above; do not change the row.
- **`H2` or `H9` above 0 in the differential.** The jsonl row carries the prototype's trace in `notes`. Check first that every command tries the choices of `markerLineChoices`: without the second one a command declines where the marker line cannot go. Then diff the function the case runs through against `proto/zz-gap-clean-lines.ts`.
- **A cost test of `markdown-source-edits.test.ts` fails.** The count is of array elements handed to scans. Look for a `find`, `filter` or `split` over a whole list or a whole text inside `firstReplacedLine`, `takenLines` or `textLineSpans`.
- **The lint rule on a call inside a condition.** The project does not put a function call directly in an `if` or `while` condition; the code above assigns each to a named constant first. Keep that when merging.
- **`markdown-editor-heading-to-code-escapes` lands in between.** Step 1 checks for its `E41` rows when you start. If it lands while this plan is in progress, take out this plan's two `E41` rows, their comment and the docs clause before committing.
- **`marked` changes version.** The setext rule this plan relies on (which lines end a setext heading) was read off 18.1.0, the version `marked-upgrade` pins. The `SAME` rows `G5`, `G8` and `G10` and the row `a continuation line that would end a setext heading is escaped` are the check to rerun after an upgrade.

---

## Critical Files

- [markdownSourceLines.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts) — the module changed. Read `firstReadingEdit` (:977), the precedent for every candidate added here, `listOn` (:1343), `convertBlocks` (:1033), `alreadyBlock` (:1092), `toggleList` (:1278), `readsAsExpected` (:236), `escapeBlockStart` (:950), and `textLinesOf` (:594), whose task marker written as text is the form `escapeItemText` writes. Line numbers are from `736452bbc`.
- [markdownSourceTokens.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceTokens.ts) — `walkTable` (:639) and `tableCellRows` (:688). After `markdown-source-mode-block-locator` they read placed lines and search with `findInRow`; read that plan's `PlacedLine` and `offsetAt`.
- [markdownTableExtension.ts](../packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts) — `splitRow` (:51) and `tokenizeTable` (:242).
- [markdownSerializer.ts:2289](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2289) — `serializeHeading`, with `SETEXT_INTERRUPTING_LINE` (:190): the WYSIWYG rule for a heading's written form and for its closing `#` run, which this plan copies; and `ALWAYS_ESCAPED` (:265), why the WYSIWYG surface writes `\[ \]`. Read only.
- [markdown-editor.test.ts](../packages/lib/tests/component/markdown-editor.test.ts), [markdown-source-edits.test.ts](../packages/lib/tests/component/markdown-source-edits.test.ts), [markdownLexer.test.ts](../packages/lib/tests/component/display/markdownLexer.test.ts) — the tables the rows go into.
- [plans/markdown-source-mode-list-lift-parity.md](markdown-source-mode-list-lift-parity.md) — the candidates, `EditCandidate` and `firstReadingEdit` as this plan finds them.
- [plans/markdown-source-mode-block-locator.md](markdown-source-mode-block-locator.md) — the analysis and the line index this plan builds on, and its owner's answer B3 on table cells.
- [plans/markdown-editor-heading-to-code-escapes.md](markdown-editor-heading-to-code-escapes.md) — the WYSIWYG fix for rows `E41`, and what it deletes of this plan when it lands second.
- [plans/implemented/markdown-list-toggle-task-item-parity.md](implemented/markdown-list-toggle-task-item-parity.md) — its notes D11 and D22 and sign-off 8, where these gaps were recorded.

---

## Non-Goals

- **Rows `E32` and `E33`.** Acting there means re-indenting blocks the command does not touch. See the decision.
- **A line below a new item that would end it** (`foo` / `2. bar` with the caret on `foo`). The WYSIWYG surface writes that line indented and escaped; source mode leaves the lines below a new item as they are, and declines. It is a hand-written shape, the docs now name it, and the tests `declines a list item …` pin it.
- **The differences this plan leaves in `DIFFERS`**: the 35 rows of the table above. Each is another plan's, a product difference, an owner's answer, or a question the owner has not been asked.
- **A code block made from a heading.** Rows `E41` pin it. `markdown-editor-heading-to-code-escapes` closes it on the WYSIWYG surface.
- **The escapes G7 leaves.** A definition's label that opens a new item's text is escaped at its `[` alone (`- \[a]: /url`, where the WYSIWYG surface writes `- \[a\]: /url`), and source mode writes no escape where the text reads the same without it (`--- tail` as a line of a paragraph, where the WYSIWYG surface writes `\--- tail`). Both readings are the same in the viewer; see G7.
- **`setBlockType` on a block a list item holds.** Source mode takes it out of the list and the WYSIWYG surface converts it in place. This plan changes how the heading is written there, not where it stands.
- **The text of a code block turned into a heading.** It is read afresh as Markdown, a closing `#` run included, as at the base.
- **A quote's own blank line left behind** (`> one` / `>` / `> two`, both paragraphs lifted, leaves a line `>`). The base does this and no row pins it; it is not one of this plan's gaps.
- **`marked`'s version.** Everything was measured on 18.1.0, which `marked-upgrade` pins. The plans `marked-version-pin-or-upgrade` and `marked-upgrade` own the version.
- **The lift rule, tab columns and block placing.** The plans of `depends-on` own them; this plan changes none of their functions' logic.
- **Source mode's syntax highlighting.** `markdown-source-mode-tab-highlighting` changes the `markdown` language of `CodeEditor`; it shares only the two docs pages with this plan, in other paragraphs.
- **The WYSIWYG surface.** No file of it is touched. No fix was needed there: in every gap the WYSIWYG result is the one a save reloads to.
- **An inline command on a table cell whose text opens with an escaped character.** With `\|` or `\<<` selected, backslash included, `toggleBold()` gives `**\|**` and `**<<**` on the WYSIWYG surface and does nothing in source mode, at the base and after this plan. Source mode also does nothing for a lone escaped character in a paragraph (`a\*b` with the `*` selected). That is a rule of the inline commands in `markdownSourceEdits.ts`, which this plan does not change; Part B only corrects where the cell's text is placed. No test pins the difference and the docs do not list it.
- **`markdown-editor-table-command-fixes`.** It is about the WYSIWYG table commands and shares no file with this plan.

---

## Notes

[^gap7]: `one #` is a paragraph the editor saves as it stands. `setBlockType("h2")` on it gives `## one \#` on the WYSIWYG surface and did nothing in source mode: `## one #` reads as the heading `one`, the check saw the `#` gone and rejected every form. No `DIFFERS` row pinned it and the docs did not list it. It was found by running the parity probe on documents whose text holds characters that read otherwise in another block (`zz-gap-tricky.test.ts`).

[^measured]: The measurements were made in a private copy of commit `736452bbc` (`repo/` in the scratch folder), with the code and tests of the five plans of `depends-on` applied as their planners left them (the copy of `plans4/locator-revision/repo`), and `marked` 18.1.0 in a `node_modules` of the copy's own. Nothing was installed in the main tree or a worktree. The base of every comparison is that copy's modules, copied into the tests tree; the new side replaces the line module, and for the table part the analysis and the table tokenizer, by this plan's, through a Vitest plugin. `PROGRESS.md` in the scratch folder says which output is which.

[^mechanism]: Three other mechanisms were weighed and not taken. A case per row in each writer (escape `[ ]` when the text matches a task marker, split at a backslash, and so on) decides by the document's shape, which is what five reviews of the first lift implementation showed does not converge. Making the WYSIWYG reading the only reading (every block whole, always) removes source mode's line selection, which is a documented capability. Changing the check to accept more (a literal backslash where a break stood) would let a command change visible text.

[^item-escapes]: `escapeBlockStart` escapes the first character of a line when it can open a block. `[` is one of them, because it opens a link reference definition; the same call covers a number followed by `.` or `)`. For a task marker's form it wrote `\[ ] mid`, which the item needs and the viewer reads as `[ ] mid`. The WYSIWYG serializer escapes every `[` and `]` of text (`ALWAYS_ESCAPED`, `markdownSerializer.ts:265`), so it writes `\[ \] mid`; the owner chose that form (G7). The escaped candidates come after all unescaped ones so that no text is escaped that reads right without it; measured, no command that acts at the base gives another edit because of them.

[^heading-whole]: Making the lines of a setext heading items one by one was weighed. With the caret on the second line, the first line would have to stay a heading without its underline, which it cannot. Taking the heading whole also gives what the WYSIWYG surface gives for every selection in it, so rows `E31` and `G8` read alike without a second reading.

[^locator-b2]: Class B of the block-locator plan's addendum *The 77 cases of B2*: one tab document (`D1` of `plans4/locator-77/cases-77.txt`), the bulleted toggle from the paragraph `same` on line 0 into the item's setext heading on line 2, two selections. Before that plan source mode misplaced the heading and wrote `- ` before line 0; that plan places the heading, and since a list toggle declined on a setext heading, does nothing; it records the case as following that rule. With this plan the toggle takes the heading whole, and both selections give the same edit as before that plan, `- ` before line 0, as does the same document with spaces for the tab (`out/d1.json` of this plan's scratch folder). That edit reads in the viewer as the WYSIWYG result. Neither plan needs a change: the case is listed so that the two plans' verdicts are read together.

[^atx-test]: `#tag` followed by `---` is a setext heading: a `#` heading needs a space after its `#` run. The base reads such a heading as written with `#` in two places. `toggleList` then does not decline on it, and makes an item of each of its lines; `alreadyBlock` takes it for a heading of its level in the written form, and `setBlockType` with that level does nothing. Both now read it as the setext heading it is. In the measured sets this is 217 cases, all in the set whose text holds such characters.

[^two-readings]: The second reading changes the on/off decision too, not only what is written: in `- one\ ⏎ ··two ⏎ - three` the line `two` is no marker line, so by lines the toggle is on; by blocks all touched blocks are items, so it is off, which is what the WYSIWYG surface does. The readings are compared before the second is run, so a command that declines for another reason does not pay for it twice. A hard line break written with trailing spaces does not reach the second reading: `one·· ⏎ two` split into two items reads as intended, because the spaces at the end of an item's text show nothing.

[^heading-forms]: The base wrote a heading per line because a `#` line holds one line. That splits one block into several, whatever is selected: with the caret on one line of a three-line paragraph it wrote three headings. The `lines` form stays as the last candidate so that a command that acts at the base still acts where neither form of one heading can be written; in the measured sets it was taken in 0 of 5,683,460 cases. The setext text lines are written without the whitespace they open with, as the `#` forms write them: `marked` reads a line of four spaces under a setext heading's first line as the end of the heading. The escaped forms escape a line that would end the heading (`2. bar` becomes `2\. bar`); the underline is never escaped.

[^closing-run]: The rule is `ATX_CLOSING_SEQUENCE`: a run of `#` with only whitespace after it, after a space or tab or as the whole text. It is applied wherever a `#` heading line is written from a block of text, in the `joined` and `lines` forms and for a block of one line. It is a rule of the writer and not a candidate, because the unescaped line can never read as intended: the `#` run is always dropped. Measured, no command that acts at the base gives another edit because of it. The serializer's own rule is in `serializeHeading` (`markdownSerializer.ts:2289`).

[^marker-line]: The walk stops at the first container the block does not open, at a `:::` column, and at a quote: a quote's own marker line (`>` above `> one`) is a blank line of the quote, not a marker that the block's leaving empties. The check cannot tell an empty list item from none, because an empty item has no leaf; that is why the base's edit passed it. The second choice, without the marker line, keeps a command acting where the base acts: in `beta ⏎ 2. x ⏎ - ⏎ ··gamma`, `marked` reads `2. x` as a list item only because the `-` line follows it, so the edit that takes the `-` line reads otherwise and is rejected. With both choices the base's own edit is always among the candidates.

[^g2]: The owner first answered G2 no, the marker line left where it is, and reversed that on 2026-10-14: in the parity run on the aimed documents a lone marker stayed behind as an empty item in 496 results where the WYSIWYG surface removes it. With the marker line taken, no result keeps a marker that a command emptied: the 16 results still counted under that clause are one document whose first item, which the command does not touch, the WYSIWYG surface rewrites as it saves the whole document.

[^escape-survey]: `rows-escapes.json` and `rows-escapes2.json` in the scratch folder, run on both surfaces and on both line modules (`out/escapes.jsonl`, `out/escapes2.jsonl`). The 28 line starts of the first set are `# x #`, `> x`, `- x`, `---`, `+ x +`, `++x++`, `* x *`, `***`, `===`, `_x_`, `___`, `~~~`, `~x~`, ```` ``` ````, `` `x` ``, `<div>`, `<b>`, `<x-y>`, `\| a \|`, `::: x`, `: x`, `[a]: b`, `[ ] mid`, `[x] mid`, `[a] b`, `2. bar`, `2) bar` and `1. bar`, each in four positions: a paragraph's second line under both list toggles and `h2`/`h3`, a list item's later paragraph, a quote's second line, and an item's second line, under the toggles and the block types. The second set adds definitions with and without a title, the task forms with `X`, a tab and nothing after the brackets, lone HTML tags, and a fence with a backtick in its info string. In every case where source mode writes an escape, it is the WYSIWYG surface's escape, but for the definition's label.

[^code-join]: The lift-rule plan counts this as 76 cases where its new code acted and 1,476 where the base acted, and leaves it as a Non-Goal. In this plan's run of that generator on the new base the base joins in 1,476 cases, and the new code in none. The check now also rejects two wildcard ranges that share a block: two fences in a row, both turned into paragraphs, joined at the base. The WYSIWYG surface gives two blocks in every shape (`out/explore3.jsonl`, rows `c1` to `c16`).

[^cells]: Measured on generated tables with repeated cell text, merge markers, escaped markers and escaped pipes, in and out of quotes, list items and columns: the base places 1,677 of 57,868 cells on other text, the new analysis none. The oracle changes one character at the place and lexes again; it does not use `tableRowSegments`. The escaped pipe is a second cause the block-locator plan does not name: the base's search for a cell whose text opens with `|` starts at the row's own leading pipe. The WYSIWYG results for the cell shapes were taken from a run of that surface (`out/wcell.jsonl`), and the source-mode ones for cells with escaped characters from `out/scell.jsonl`: in the measured sets every inline command that newly acts stands in a document with a merge marker, and none in a document whose only cause is an escaped pipe.

[^heading-code]: Found by the parity run on documents whose text holds characters that read otherwise in another block: 8 of its cases, all `setBlockType("code")` on a heading. The WYSIWYG surface gives the same text for `setBlockType("paragraph")` on such a heading (`\+alpha`), where the escape is needed and the viewer reads both results alike. Only inside a code block does the escape show. For a paragraph the editor saves (`\+alpha`) both surfaces put the same text into the code block.

[^indentation]: In the list-toggle plan's sorting of 22,254 cases in hand-written documents, `E32`'s shape had 215 and `E33`'s one. Writing the new item with a wider marker so that the lines below fall outside it, and un-indenting the lines below, were both weighed. The first writes a marker the editor never writes; the second rewrites lines the command was not asked to touch, which the lift rule's own design rules out for content.

[^raw-toggles]: The notes of `markdown-list-toggle-task-item-parity` name `markdown-editor-raw-block-range-edits` for these rows. That plan, as written, changes how a range that leaves a raw block is removed (typing, paste, cut); it changes no list toggle and moves none of these rows.

[^prototype]: `proto/zz-gap-clean-lines.ts`, `proto/zz-gap-tokens.ts` and `proto/markdownTableExtension.gap.ts` in the scratch folder are the modules as this section gives them; the code blocks here were cut from those files by script (`buildplan.py`). The measured line module, `proto/zz-gap-lines.ts`, is the same code with trace lines; the two gave the same edit in 521,432 cases. Put in place of the real modules in a copy of the private repository, with the plan's three test files beside them, `tsc` reports nothing for the library and for the tests, and `eslint` reports nothing for the three modules.

[^tests]: `mktests.py` in the scratch folder wrote the test changes onto the three test files as the plans of `depends-on` leave them (`tests-base/`), reading the expected texts from the probes' outputs (`out/expect1.jsonl`, `out/expect6.json`, `out/explore8.jsonl`). Run three ways: 1,555 tests, all green with this plan's modules; 96 red with the base's modules; 19 red with the line module of Part A alone. The whole suite of the private copy (591 files) was run with this plan's modules and test files in place: 20,332 tests, all green, 80 more than the 20,252 of the base.

[^numbers]: `sumcounts.py` adds the counts of a folder of outputs. The numbers are those of the full run with the final prototype (`out/aim-g`, `out/gen-g`, `out/rows-g`, `out/look-g`, `out/trickydiff-g`, `out/par-g`, `out/paraim-g`, `out/tricky-g`, `out/cells-g`, `out/inline-g`), through the planner's probes, which compare copies of the base's modules with this plan's; `probes-impl/` holds the same probes with the imports turned to the base copies and the real modules. `out/cells-g` and `out/inline-g` are copies of the earlier revision's runs: the table part's probes do not load the line module, the only module the answer G2 changed.

[^clauses]: `anpar.py` in the scratch folder puts each remaining case under a clause.

    | Family | Remaining | Under which clause |
    |---|---|---|
    | review 6's three families | 7,087, each with the source result it had at the base | 1,548 in documents that hold a block the WYSIWYG surface keeps as raw Markdown; 2,550 a selection from one `:::` column into the next; 2,989 `setBlockType` on a block a list item holds, or on the heading it opens with |
    | documents whose text reads otherwise in another block | 307 of 1,385 | 147 `setBlockType` on a block a list item holds; 152 single lines of a block made items; 8 a code block made from a heading (rows `E41`) |
    | the aimed documents | 9,449 of 13,279 | 4,483 `setBlockType` on a block a list item holds or on the heading or quote it opens with; 2,143 a raw Markdown block in the document; 1,315 a code block, an HTML block, a table, a definition or a thematic break in the selection; 490 single lines; 589 a selection across `:::` columns; 243 looseness alone; 65 a code block that holds the text in each surface's own form; 21 an empty list item; 16 in one document whose first item, which no command touches, has its marker on a line of its own and is rewritten by the WYSIWYG surface as it saves the whole document; 84, in 8 hand-written documents, that the script does not place and were read one by one: 53 `setBlockType` on a list item's paragraph reached through a line written without the item's indentation; 16 where the WYSIWYG surface reads a `:::` line right under a paragraph as that paragraph's text and the viewer reads a column block; 15 where source mode does nothing (a line below the new item that would end it, a quote or an item continued by an unindented line) |

    The three families hold none of this plan's shapes, so their count does not move; it is the 7,087 that `markdown-source-mode-list-lift-parity` reports. In the aimed documents the base's result reads as the WYSIWYG result and the new one does not in 17 cases. All 17 are `setBlockType` on a setext heading that a list item holds: the base did nothing because of the heading's backslash line break, the WYSIWYG surface has nothing to change, and source mode now takes the heading out of the list, as it does for every block a list item holds. In 30 cases (19 in the aimed documents, 11 in the documents whose text reads otherwise in another block) the base acts and the new code does nothing; in all 30 the WYSIWYG surface changes nothing either: a heading of several lines that has the level already.
