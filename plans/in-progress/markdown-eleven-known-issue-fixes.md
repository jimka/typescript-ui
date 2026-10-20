---
depends-on: [markdown-source-mode-syntax-colours]
touches-shared:
  - packages/lib/src/typescript/lib/component/display/markdownTabs.ts
  - packages/lib/src/typescript/lib/component/display/markdownExtensions.ts
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/src/typescript/lib/component/editor/markdownImporter.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourceSyntax.ts
  - packages/lib/src/typescript/lib/component/editor/markdownTabStopCommands.ts
  - packages/lib/src/typescript/lib/component/editor/languages.ts
  - packages/lib/tests/component/code-editor.test.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-editor-list-item-edits.test.ts
  - packages/lib/tests/component/markdown-importer.test.ts
  - packages/lib/tests/component/markdown-serializer.test.ts
  - packages/lib/tests/component/markdown-source-mode-through-model.test.ts
  - packages/lib/tests/component/markdown-source-places.test.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/tabs.ts
  - packages/lib/docs/components/Markdown.md
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/components/CodeEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# Markdown Eleven Known-Issue Fixes — Implementation Plan

## Overview

Eleven defects from the Markdown known-issues list (one rated high, ten medium), each reproduced on the chain's tip `feature/markdown-source-mode-syntax-colours` (`0dbf7c3eb`) before this plan was written. In examples `→` is a tab, `·` a space where it matters, `⏎` a line end and `|` the caret.

| # | Defect | What this plan does |
|---|---|---|
| 1 | **A tab in fenced code inside a list item becomes spaces.** `` - one⏎⏎··```⏎··aa⏎··→bb⏎··``` `` shows the code as `aa⏎··bb`, and after bold on `one` saves `····bb`. CommonMark keeps the tab. | The tab rule sets each code block's text back to what CommonMark reads from the source. |
| 2 | **Source-mode Enter that renumbers 9 to 10 moves the item's later paragraph out.** Enter after `8. a` in `8. a⏎9. i⏎⏎···j` leaves `j` after the list. | A wrapper around `@codemirror/lang-markdown`'s Enter moves the renumbered item's later lines with its content column, in the same undo step. |
| 3 | **Source-mode bold and link do nothing under a tab prefix.** 170 word runs (47 of 3,161 generated documents) decline where the spaces form acts. | Fix 1 plus a places change make the commands act wherever they can edit only the word: 12 such runs go to 0. 72 runs still decline, all where the spaces form rewrites more than the word. |
| 4 | **Home then Enter in a tab-indented code block turns the code line into a paragraph.** `- a⏎⏎→→\|x` gives `- a⏎⏎⏎··\|x`. | The prefix-copying Enter counts the indentation of an indented code block's first line as inside the block, so the whole line moves down. The spaces form `- a⏎⏎······\|x`, which had the same defect, is fixed too. |
| 5–8 | **Nested-list edits leave an empty bullet (`- - b`).** An insert in a nested item's text; a rule or table at the end of an item holding a nested list; Enter on an emptied item holding one; a heading made from a parent item in source mode. | One shared cause, fixed at its two entry points. Inserts stop splitting at the item and put the block in front of its nested list. Lifts release the nested items one level out into the item's place. |
| 9 | **A rule or table inserted right after a task item's checkbox breaks the item.** `- [x] one`, caret before `one`, saves `- \[x\]⏎---⏎- one`. | That caret counts as the start of the item's text, so the block goes above the item. The second half of any split task item gets an unchecked checkbox. Pastes get the same rule. |
| 10 | **`[x]` typed after an image in link text breaks the link on reload** when `x` is a defined label. | The shared reader keeps bracket escapes in link text as CommonMark does. The four editor workarounds for the old reading go. |
| 11 | **`C++ and C++` shows `C` and an underlined ` and C`.** | `++` opens and closes by the flanking rules GFM uses for `~~`, in all three parts. |

Every fix was prototyped on a private copy of the tip. The source changes total about 1,200 lines over 12 files, one of them new, `markdownItemRenumbering.ts`. The test changes are in 21 test files. Each fix's prototype diff is saved under `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans6/eleven-known-issue-fixes/` and is the reference implementation the steps apply. The five prototypes and their test diffs, applied together in the order of `## Ordered Implementation Steps`, pass the whole Markdown set and the code-editor tests (`## Addendum: Measurements`). Their sum, docs hunks included, is saved as `combined.diff` in the same folder. No public API changes. Line numbers are those of `0dbf7c3eb`.

---

## Architecture Decisions

### Code block text is set back to the source's reading inside the tab rule

The tab rule reads a list item or quote from an expanded copy, in which every tab of a line's leading run of whitespace and markers is the spaces to its stop (`prefixEnd`, [markdownTabs.ts:52](../packages/lib/src/typescript/lib/component/display/markdownTabs.ts#L52); `expandPrefixTabs`, [:220](../packages/lib/src/typescript/lib/component/display/markdownTabs.ts#L220)). `restoreTokenSources` ([:428](../packages/lib/src/typescript/lib/component/display/markdownTabs.ts#L428)) then sets the `raw` of containers, HTML blocks, definitions and rules back to the source (`SOURCE_KEPT_TYPES`, [:312](../packages/lib/src/typescript/lib/component/display/markdownTabs.ts#L312)). Nothing sets back a code token's `text`. The viewer (`Markdown.ts:1716`) and the importer (`$buildCode`, `markdownImporter.ts:1175`) both show that text, and an edited save writes it.[^tab-cause]

The fix adds one pass to `restoreTokenSources`, run before `restoreFrom`: `restoreCodeTexts` walks the tokens and finds each code block by its `raw` lines (`findRawLine`, given an upper bound). `restoreCodeText` then reads each code line again from the source at the same column (`sourceFromColumn`). It follows CommonMark's rule for a tab that straddles a column, which `sourceOfSlice` ([:372](../packages/lib/src/typescript/lib/component/display/markdownTabs.ts#L372)) already applies to a token's `raw`: a tab the container leaves whole stays a tab, and a tab the container cuts across is the spaces of the columns left of it.[^tab-precedent]

| Source | CommonMark | Tip (viewer and editor) | After |
|---|---|---|---|
| `` - one⏎⏎··```⏎··aa⏎··→bb⏎··``` `` | `aa⏎→bb` | `aa⏎··bb` | `aa⏎→bb` |
| `` - a⏎⏎··```⏎··-→old⏎··+→new⏎··``` `` | `-→old⏎+→new` | `-·old⏎+·new` | `-→old⏎+→new` |
| `` > ```⏎> →bb⏎> ``` `` | `→bb` | `··bb` | `→bb` |
| `` 1. a⏎⏎···```⏎···→bb⏎···``` `` | `→bb` | `·bb` | `→bb` |
| `` - one⏎⏎··```⏎·→bb⏎··``` `` (tab across the content column) | `··bb` | `··bb` | `··bb` |

The editor's save needs no change: it writes the code node's text after the standard item prefix, where a leading tab is whole again. An unedited save stays as written.

### A tab the container cuts across reads and saves as spaces — decided: as CommonMark

**Feature:** a tab in a code line that the container's content column cuts across.

| Source | Reading before | Reading after | Save after an edit elsewhere in the item, before / after |
|---|---|---|---|
| `` - one⏎⏎··```⏎·→bb⏎··``` `` | `··bb` | `··bb` | `····bb` / `····bb` |
| `` 1. a⏎⏎···```⏎··→bb⏎···``` `` | `·bb` | `·bb` | `····bb` / `····bb` |

**Consequences.** The reading is CommonMark's. The tab itself cannot survive an edit, because the save writes the item at its standard column, where the tab would span another width.

**Recommendation and decision:** as CommonMark. Decided.

### Indented code in an item or quote is set back too — decided: yes

**Feature:** an indented code block inside a list item or a quote, whose indentation holds a tab past the code's four columns.

| Source | CommonMark | Before | After |
|---|---|---|---|
| `- a⏎⏎······→code` | `→code` | `··code` | `→code` |
| `>→→→foo` (corpus row T32) | `··→foo` | `······foo` | `··→foo` |
| `- a⏎⏎→→code` | `··code` | `··code` | `··code` |

**Consequences.** One rule serves both kinds of code block. Row T32 changes. Leaving indented code out would need a condition and keep T32's difference from CommonMark.

**Recommendation and decision:** include it. Decided.

### A fenced code line of whitespace only keeps its tab — decided: accept

**Feature:** a fenced code line in an item that holds only whitespace with a tab: `` - a⏎⏎··```⏎··→⏎··bb⏎··``` ``.

| Reader | First code line |
|---|---|
| commonmark.js | empty |
| the comparison's reference (micromark) | `→` |
| tip | `··` |
| after | `→` |

**Consequences.** `marked` keeps a blank code line's whitespace in every form (the spaces form `····` reads `··` on both builds), so this is a property of the lexer, not of tabs.

**Recommendation and decision:** accept. Decided.

### A lazy code line in a quote keeps its spaces — decided: accept

**Feature:** a line without `>` that `marked` reads into a quote as code, where CommonMark ends the quote (a *lazy* line): `> # h⏎······-→x`.

`restoreCodeText` leaves a code block's whole text as the lexer read it when one of its lines lacks a `>` of the quotes around it. Restoring such lines made 15 generated documents fail the round-trip differential's standard-form check.[^lazy-guard] The reading is `marked`'s before and after. Source mode keeps declining on such a line (a guard row pins it).

**Recommendation and decision:** accept, and document it as the one reading that still differs from CommonMark. Decided.

### Source-mode places for code lines follow the shown text — the second half of fix 3

Source-mode bold and link declined under a tab prefix because the selection could not be placed in the model, not because of a check on the edit's size. `locateVerbatim` ([markdownSourcePlaces.ts:966](../packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts#L966)) needs each shown code line to end its source line. `··bb` does not end `··→bb`, so no unit of the block gets a source. `$placeAmongUnits` then gives no place to any offset beside the block, and `selectInModel` (`MarkdownEditor.ts:9837`) declines.[^decline-trace]

With fix 1 a whole tab is in the shown text, so the twelve runs that the spaces form edits word for word act. For a cut tab, `locateVerbatim` gains `offsetsOfVerbatimLine` and `offsetsAfterCutTab` (with a `columnOf` helper). A shown line that starts with the one to three spaces left of a cut tab is placed with those spaces at the tab. This follows the rule the places module already uses for an expanded prefix: "a character a tab stands for is at the tab" (`restoreSourceOffsets` in `markdownSourceTokens.ts`).

### Source mode acts beside a cut-tab code line — decided: yes, rewriting it as WYSIWYG does

**Feature:** a source-mode command on an item whose code line holds a tab the item cuts across.

| Source | Command | Before | After |
|---|---|---|---|
| `` - one⏎⏎··```⏎·→bb⏎··``` `` | bold on `one` | nothing | `` - **one**⏎⏎··```⏎····bb⏎··``` `` |
| `- a⏎⏎→→code` | bold on `a` | nothing | `` - **a**⏎⏎··```⏎····code⏎··``` `` |

**Consequences.** The command gives the WYSIWYG command's result and the spaces form's result, and the reading is kept. It rewrites the code line, not only the word. Over the 3,161 generated tab documents, the 98 newly acting runs all keep the viewer's reading, and none newly declines.

**Recommendation and decision:** include. Decided.

### What fix 3 leaves — decided: the remaining declines stay

After both halves, 72 word runs (18 documents) still decline where the spaces form acts, down from 170 (47). In every one of them the spaces form rewrites more of the item than the word, so declining is the safer result. Most are lazy code lines in a quote (`···>·#·h⏎→→>-·w⏎····>[·]→x`). The rest are raw HTML blocks in an item written otherwise than `- x` (`···1.→<pre>⏎⏎→→1.·~~~⏎…`). Lines without caret places drop from 1,536 to 1,111: 425 gained, none lost. The 390 lines that still lack places in the tab form, while the spaces form has them, are the same shapes plus task checkboxes followed by a tab and paragraph lines of markers and tabs. The known-issues entry stays; the orchestrator updates its numbers.

### Two test excusals of fenced code are narrowed — decided: yes

The corpus differential's `standsInShapeWithoutSource` (`markdown-source-mode-through-model.test.ts:943`) and the untold-places test `isKnown` (`markdown-source-places.test.ts:1001`) excused every fenced code line with a prefix tab. With fix 1 neither needs it, so both drop the fenced code clause and become guards of the fix. Corpus rows T30 to T33 pinned the old reading and change in place.

### New reading rows go in a list of their own, outside the corpus — decided: yes

The corpus differential in `markdown-source-mode-through-model.test.ts` (about line 1052) picks each document's commands by its position in `CORPUS`. A row added to the corpus moves every later document onto other commands. Doing so exposes two source-mode and WYSIWYG differences that exist on the tip, in documents with no tabs:

- `CommonMark 587 (Images)` with heading 2 or quote: the caret lands at `[3,3]` against `[4,4]`;
- the hand-written row `loose list ending in a blank line` with the bulleted toggle.

The 15 new tab rows therefore go in a new list `TAB_CODE_CASES` in `corpus/tabs.ts`. `markdown-roundtrip.test.ts` runs it beside the corpus (`for (const testCase of [...CORPUS, ...TAB_CODE_CASES])`), so each row still gets the declared-blocks test and every harness check. No other fix in this plan adds corpus rows.[^corpus-growth]

### Renumbering Enter moves the item's later lines — following the tab-stop wrapper

`@codemirror/lang-markdown`'s Enter (`insertNewlineContinueMarkupCommand`, 6.5.2) renumbers the items below the caret through `renumberList`, which replaces only an item's digits. `9.` becoming `10.` moves the item's content column from 3 to 4, and the item's later lines stay where they were. A line indented 3 then falls out of the item, and one indented 4 reads as code. The library binds that command at [languages.ts:635](../packages/lib/src/typescript/lib/component/editor/languages.ts#L635) as `atMarkdownTabStops(insertNewlineContinueMarkup)`.

A new module `markdownItemRenumbering.ts` exports `keepingRenumberedItemContent(command)`, which wraps that binding. It captures the command's transaction with `transactionOf` ([markdownTabStopCommands.ts:210](../packages/lib/src/typescript/lib/component/editor/markdownTabStopCommands.ts#L210), now exported). For each change that replaces an ordered item's number with a number of another width, it shifts the item's later lines by the change in content column. It then dispatches one composed transaction, which keeps the user event and the undo step. This is how `atMarkdownTabStops` ([:316](../packages/lib/src/typescript/lib/component/editor/markdownTabStopCommands.ts#L316)) already adjusts the package's commands. The serializer's rule for a renumbered item (`keepsContentColumn`, `markdownSerializer.ts:3462`) moves the children to the new column in the same way. Copying the package's renumbering code was rejected in `markdown-source-mode-enter-after-quote-tab` (footnote `[^approach]`).[^renumber-module]

The WYSIWYG editor needs no change. Its Enter renumbers too, and its save writes the item's children at the new column. A guard row pins that.

### A renumbered item's later lines move with its content — decided

**Feature:** Enter in source mode that renumbers an ordered item to a number of another width.

| Start | Tip | After |
|---|---|---|
| `8.·a\|⏎9.·i⏎⏎···j` | `…10.·i⏎⏎···j` (`j` leaves the list) | `…10.·i⏎⏎····j` |
| `8.·a\|⏎9.··i⏎⏎····j` | `…10.··i⏎⏎····j` (`j` becomes code) | `…10.··i⏎⏎·····j` |
| `8.·a\|⏎9.→i⏎⏎····j` | unchanged below (the tab narrows) | unchanged below |
| `98.·a\|⏎99.→i⏎⏎····j` | `…100.→i⏎⏎····j` (the tab widens to column 8) | `…100.→i⏎⏎········j` |
| `8.·a\|⏎9.·i⏎lazy` | `…10.·i⏎lazy` | the same: a lazy line stays |
| `7.·x⏎8.·y⏎9.·\|⏎10.·b⏎⏎········c` (Enter lifts the empty item, `10.` becomes `9.`) | `…9.·b⏎⏎········c` (the code gains a space) | `…9.·b⏎⏎·······c` |
| `8.·a\|⏎9.·i⏎⏎···→····x` | code `····x` | `…⏎·········x`, code `·x` kept |

The rule, in four parts:

- **Which lines move.** The item's lines from its second line to the end of its `ListItem` node move. A line moves only if it reaches the old content column through spaces, tabs and outer `>` markers, so lazy lines and blank lines stay. A whitespace line that ends exactly at the column stays.
- **Widening.** Spaces are inserted at the first character boundary at or past the old column.
- **Narrowing.** Spaces are taken from before that boundary.
- **Tabs.** A tab whose width would change at its new column is written as the spaces it spanned, as `keepsRun` (`markdownTabStopCommands.ts:230`) writes a moved tab. When the shift is a multiple of 4, every tab stays a tab.

**Consequences.** Enter keeps the reading and matches the WYSIWYG save. Lines below the caret change. Skipping the renumbering was rejected: it would leave two `9.` items and stop the renumbering of every item after them. One rule serves both directions: narrowing (Enter lifting an empty item) moves lines left too.

**Recommendation and decision:** move the lines, by this rule. Decided.

### Enter in the indentation of an indented code block's first line stays in the block — decided: the wide rule

`caretBlocksAt` ([languages.ts:241](../packages/lib/src/typescript/lib/component/editor/languages.ts#L241)) finds the blocks around the caret from `resolveInner(pos, -1)`. The parser starts an indented `CodeBlock` node at the first character boundary at or past the code column, so a caret at or before that start, on the block's first line, is outside the block. `insertNewlineKeepPrefix` then declines, and Markdown's own continuation moves the code's text to the content column, which makes it a paragraph. On the block's later lines the node already holds the indentation, and Enter moves the whole line down with its prefix copied (`containerPrefixAt` `:275`, `newLineWithPrefix` `:395`).

A new `inIndentedCodeFirstIndentation(state, pos)` makes `blocks.code` true when only spaces and tabs stand between the caret and the first character of an indented code block that starts at or after the caret. The column helpers are not needed: "the caret's column is at or past the code column" and "the caret is at or after the node's start" are the same test, for every tab width.

**Feature:** Enter with the caret anywhere from the line's last marker to the text of an indented code block's first line.

| Start | Tip | After |
|---|---|---|
| `- a⏎⏎→→\|x` (after Home) | `- a⏎⏎⏎··\|x`, a paragraph | `- a⏎⏎→→⏎→→\|x`, code |
| `- a⏎⏎→\|→x` | `⏎··\|····x`, code `x` | `- a⏎⏎→⏎→→\|x`, code `··x` |
| `- a⏎⏎······\|code` (row F23) | `- a⏎⏎⏎··\|code`, a paragraph | `- a⏎⏎······⏎······\|code`, code |
| `-·····\|x` | `-⏎-·\|x`, a second item | `-·····⏎······\|x`, code in the one item |
| `\|>······x` | `⏎\|>······x` | the same: before the marker the key passes on |

**Options.** The wide rule (from the line's last marker to the code's text, recommended); a narrow rule (from the code column on); the tip. Over 83 first-line caret positions in 19 documents, Enter changes the reading at 41 (tab form) and 34 (spaces form) positions on the tip, 29 and 28 with the narrow rule, and 0 and 0 with the wide one.

**Consequences.** The old line keeps the whitespace before the caret (`····⏎····|x` at the top level, where the tip gave `⏎····|x`). Both read the same, and this is what Enter already does on every later line. Right after a list marker on an item that opens with code, Enter now stays in the code instead of opening a second item. Row F23 recorded the spaces-form case as a non-goal of `markdown-language-readonly-and-fences` ("rare: the caret has to sit between a code line's indentation and its first character"), but Home puts the caret exactly there. F23 is reversed.

**Recommendation and decision:** the wide rule; reverse F23. Decided.

### The `- - b` family has one cause with two entry points

In this library a list item is a container. `MarkdownListItemNode` holds the item's text (a `MarkdownListItemTextNode`, its checkbox first) and then its other blocks, a nested list among them ([markdownListItemNode.ts:16](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L16)). Several edits cut an item between its text and its nested list, and they keep the half that holds the nested list as an item with no text whose first child is a list. The serializer writes such an item correctly as `- - b`, which reloads to the same tree, so the serializer is not at fault.

The two entry points:

1. **Block inserts and block pastes.** `$insertBlockToNearestHolderAtCaret` ([MarkdownEditor.ts:7161](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7161)) runs Lexical's split up to the root. Its hook `$makesNoEmptyHalf` (`:7142`) can only veto a split where one side has no siblings, so an item whose second half is a nested list is always split. At text offset 0, Lexical moves the caret to after the checkbox, so a task item splits into `[checkbox]` | `[text]`. Lexical's `$copyNode` gives the second half's text no checkbox. The paste path (`$settleItemTextBeforePasteEndingInBlock` `:1745`, `$pasteBlocksIntoHeldBlock` `:1543`, `$splitCaretBlockForPaste` `:1494`, `$insertPastedBlocksAt` `:1603`) has the same gaps.
2. **Lifts out of the list.** `$liftItemOut` ([markdownListItemNode.ts:893](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L893)) documents the defect as its rule: "the nested list and what follows it stay in the list, in an item". The lift serves `setBlockType` (heading, paragraph, quote, code) through `MarkdownListItemTextNode.replace` (`:531`), the list toggles, Enter on an emptied item (`$enterLeavesListAtBlankItemText`, `MarkdownEditor.ts:6086`) and Backspace at a top-level item's start (`collapseAtStart`, `:184`). Source-mode `setBlockType` and the toggles run through the same model (`MarkdownEditor.ts:11471`), so one fix serves both modes. Source-mode `insertTable` and `insertHorizontalRule` are text transforms that decline inside an item past its first block, so issues 5, 6 and 9 are WYSIWYG only.

The rule both halves enforce: **no edit leaves an item with no text that opens with a nested list, where the source had none.** One predicate, "an item part with no text that opens with a nested list", is applied at three places:

- `$insertBlockToNearestHolderAtCaret` stops the split there;
- the paste path puts the pasted blocks into the item;
- `$liftItemOut` calls a new `$releaseOpeningLists`.

The insert's split loop and the lift are different code (Lexical's loop and the editor's own lift), so no single function can hold the fix.[^family-precedent]

### An insert stops at the item and goes in front of its nested list — decided

**Feature:** `insertHorizontalRule`, `insertTable`, or a pasted rule or table, where a split would leave an item's second half with no text, opening with its nested list.

| Edit | Tip | After |
|---|---|---|
| `- a⏎··- bc`, rule at `b\|c` | `- a⏎··- b⏎⏎---⏎⏎- - c` | `- a⏎⏎··- b⏎⏎··---⏎⏎··- c` |
| `- a⏎··- b⏎- z`, rule at the end of `a` | `- a⏎⏎---⏎⏎- - b⏎- z` | `- a⏎⏎··---⏎⏎··- b⏎⏎- z` |
| `- a⏎··- b⏎- z`, pasted table at the end of `a` | `…⏎⏎- - b⏎- z` | `- a⏎⏎··\| h \|⏎··\| --- \|⏎··\| c \|⏎⏎··- b⏎⏎- z` |
| `- bc`, rule at `b\|c` (top level) | `- b⏎⏎---⏎⏎- c` | unchanged |

**Consequences.** Every item keeps its depth and its parent. This is where a pasted block already goes ("Pasting several blocks into a nested list item … adds such a block to the outer item", `MarkdownEditor.md:111`), and how the quote stop of the same function works. The outer list becomes loose, by the existing rule that a list whose item holds a block after its nested list is loose. Releasing to the top level instead would agree with the heading result below, but `b` would stop being `a`'s child.

**Recommendation and decision:** keep the nested list in its item. Decided.

### A lift releases the item's nested items one level out — decided, reversing rule 2 of the parity plan

**Feature:** a heading, paragraph, quote or code block made from an item's text, a list toggled off, Enter on an emptied item, or Backspace at an item's start, where the item holds a nested list.

| Source and edit | Tip | After |
|---|---|---|
| `- a⏎··- b1⏎··- b2⏎- z`, heading on `a` | `## a⏎⏎- - b1⏎··- b2⏎- z` | `## a⏎⏎- b1⏎- b2⏎- z` |
| `- a⏎··- [x] b`, heading on `a` (either mode) | `## a⏎⏎- - [x] b` | `## a⏎⏎- [x] b` |
| `- a⏎··- b⏎⏎··p⏎- z`, heading on `a` | `## a⏎⏎- - b⏎⏎··p⏎- z` | `## a⏎⏎- b⏎⏎··p⏎⏎- z` (`p` goes to the last released item) |
| `- a⏎··1. b⏎- z`, heading on `a` | `## a⏎⏎- 1. b⏎- z` | `## a⏎⏎1. b⏎⏎- z` (a list of another kind keeps its kind) |
| `- a⏎··- b`, select `a`, Delete, Enter | `- - b` | `- b` (caret in the paragraph above) |
| `- a⏎··- b`, Backspace at `a@0` | `a⏎⏎- - b` | `a⏎⏎- b` |

`$releaseOpeningLists(item)` takes away an item that holds no text and opens with nested lists. It works in five steps:

1. The items after the item wait in a copy of its list.
2. A nested list of the kind of the list before it gives that list its items; a nested list of another kind stands after it as a list of its own.
3. The item's remaining blocks go to the end of the last released item.
4. The waiting items rejoin when the last list is of the host's kind.
5. The item, and any list left empty, are removed.

`$liftItemOut` still returns early for an item that itself opens with a nested list, so a `- - a` from the source, or from Tab on a first item, is never touched.

**Consequences.** All the nested items move up one level, so siblings stay siblings. Markdown cannot keep an item two levels deep with no parent, so some depth must change. Outdenting only the first nested item (the `$outdentItem` precedent) was rejected because it would put `b2` under `b1`. Bullet characters (`listMarkerState`) are not compared when released items join a list. This reverses rule 2 of `plans/implemented/markdown-list-toggle-task-item-parity.md` (lines 160–165: "What came after the tail inside the block's outermost item stays in the list, in one item that has no text"). The 34 existing rows that pin it change, listed in `## Expected Behaviour`.

**Recommendation and decision:** release the nested items. Decided.

### A split task item's second half gets an unchecked checkbox — decided

**Feature:** an insert or a pasted rule or table in the middle of a task item's text.

| Source and edit | Tip | After |
|---|---|---|
| `- [x] bc`, rule at `b\|c` | `- [x] b⏎⏎---⏎⏎- c` | `- [x] b⏎⏎---⏎⏎- [ ] c` |
| `- [ ] bc`, pasted rule at `b\|c` | `- [ ] b⏎⏎··---⏎⏎- c` | `- [ ] b⏎⏎··---⏎⏎- [ ] c` |

**Consequences.** This matches Enter in a task item (`$splitTaskItemAtCaret`, `MarkdownEditor.ts:6466`: "the new (lower) item an unchecked one"). Copying the checked state was rejected: Enter does not copy it, and new text would start out done. The paste listener makes the split itself, so `$enterSplitsTaskItem` never runs on a paste. Enter's own results are unchanged: one checkbox per half. Newlines in pasted plain text still make no checkbox.

**Recommendation and decision:** unchecked. Decided.

### A caret right after a checkbox is the start of the item's text, for block inserts and pastes — decided

**Feature:** `insertHorizontalRule`, `insertTable`, or a pasted rule or table, with the caret at the start of a task item's text, which is the caret a click on the text's start gives.

| Source and edit | Tip | After |
|---|---|---|
| `- [x] one`, rule at `one@0` | `- \[x\]⏎⏎---⏎⏎- one` | `---⏎⏎- [x] one` |
| `- [ ] one⏎··- [x] two`, rule at `one@0` | `- \[ \]⏎⏎---⏎⏎- one⏎··- [x] two` | `---⏎⏎- [ ] one⏎··- [x] two` |
| `- [x] one`, pasted paragraph then rule at `one@0` | `- [x] P⏎⏎··---⏎⏎- one` | `- P⏎⏎··---⏎⏎- [x] one` |
| `- one`, rule at `one@0` (plain) | `---⏎⏎- one` | unchanged |

**Consequences.** A task item behaves as a plain item does, and as a caret before the checkbox already does (`$settleSelectionOffContainers`, `MarkdownEditor.ts:11764`). After a pasted rule, the caret goes after the checkbox, so typing lands in the text. A pasted paragraph joins the upper half as a plain item, as at a plain item's start.

**Recommendation and decision:** yes. Decided.

### The join leaves `- - b` as before — decided: a non-goal

**Feature:** a join that takes an item's text away when the item is first in its list and holds a nested list (`$moveRestBeforeItem`, [markdownListItemNode.ts:735](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L735)): Delete at the end of the block before the list, a range ending in the first item's text, or a paste over such a range.

| Source and edit | Tip and after this plan | What releasing would give |
|---|---|---|
| `- ab⏎··- cd⏎⏎····pq⏎····- nn⏎⏎····rr⏎··- e⏎- z`, Delete from `ab@1` to `pq@1` | `- aq⏎··- - nn⏎⏎····rr⏎⏎··- e⏎- z` | `- aq⏎··- nn⏎⏎····rr⏎⏎··- e⏎- z` |
| `- ab⏎⏎··pq⏎··- cd⏎- z`, pasted table at the end of `ab` | `…⏎⏎pq⏎⏎- - cd⏎⏎- z` | `…⏎⏎pq⏎⏎- cd⏎⏎- z` |

**Consequences.** `plans/implemented/markdown-editor-cross-item-range-removal.md` decided that a joined-away first item "keeps its nested list and what follows, in an item with no text": it follows the join rule (lines 54 and 250, rows CI34, CI35, CI58). Releasing there as well would change ten more pinned rows. The known-issues entries for joins stay.

**Recommendation and decision:** keep the recorded join decision; out of scope. Decided.

### A pasted rule in the middle of an item's text stays in the first half's item — decided: as it is

**Feature:** a rule pasted in the middle of an item's text. Lexical's decorator path (`MarkdownListItemTextNode.insertAfter`, [markdownListItemNode.ts:513](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L513)) puts it in the first half's item: `- bc` with a pasted rule at `b|c` gives `- b⏎⏎··---⏎⏎- c`, where `insertHorizontalRule` gives `- b⏎⏎---⏎⏎- c`. This leaves no `- - c`. Moving it would reverse the documented "A rule pasted at the end of a list item's text is the last block of that item" (`MarkdownEditor.md:83`).

**Recommendation and decision:** leave it. Decided.

### Link text keeps its bracket escapes in the shared reader — decided: fix the reader

`marked` 18.1.0 takes the backslash off every `\[` and `\]` in a link's or image's text before it lexes that text (its output-link function, through the rule `outputLinkReplace`). CommonMark keeps an escaped bracket as a literal bracket that never pairs. So in the editor's save `[![a](/i.png)\[x\]z](/u)` the escaped pair becomes a live `[x]`. With `x` defined, `[x]` reads as a reference, and since a link cannot hold a link, the outer link is lost. Source mode's lezer grammar already reads the save as CommonMark does.

The fix extends `keepingEscapes` ([markdownExtensions.ts:554](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L554)). That function already runs `marked`'s own tokenizer method on a view whose `anyPunctuation` rule matches nothing (`MATCHES_NOTHING`, `:536`). The view now also sets `other.outputLinkReplace` to `MATCHES_NOTHING`, and the `reflink` slot of `DIALECT_IMAGE_TOKENIZERS` (`:731`) runs on the same view. Each escape is then read as CommonMark reads it. `fencesReadingReferences`, `def` and `linkReadingReferences` already use this precedent.

With the reader fixed, four editor workarounds for the old reading become wrong or dead, and they go:

- `protectLabelBrackets` (`markdownSerializer.ts:5957`) and its two calls (`:5778`, `:6369`);
- the backslash doubling `linkSafe` in `writeCodeSpan` (`:6160`);
- the importer's bracket-skipping match (`escapedEnd`, and the skips in `withRawSources` `:2764` and `contentSpan` `:2793`);
- the places module's `leavesOfUnescapedLinks`, `offsetsOfLinkText` and `leafSpans` (`markdownSourcePlaces.ts:737–860`).

A temporary log on each removed branch was not hit by 16 Markdown test files (11,521 tests), nor by the image sweep.[^link-dead]

| | Before | After |
|---|---|---|
| The reported steps, reloaded | text `[`, image, text `[x]z](/u)` | the link holding the image and `[x]z` |
| Viewer, `[see \[1\]](/u)` with `[1]` defined | plain text | the link `see [1]` |
| Viewer, `![a \[x\] b](/i.png)` with `[x]` defined | alt `a x b` | alt `a [x] b` |
| Viewer, `` [`\[`](/u) `` | code `[` | code `\[` |
| Save of `[x]` typed into a link's text | `[a\\[x\\]z](/u)` (other readers show backslashes) | `[a\[x\]z](/u)` |
| `[[x]z](/u)` with `[x]` defined (bare brackets) | text `[`, link `x`, text `z](/u)` | unchanged: CommonMark's inner link wins |

**Consequences.** The viewer, the importer and source mode agree with CommonMark, and saves are portable. Each viewer change is a fix towards CommonMark. The doubled form `\\[` was written only by unreleased builds (v0.10.0 had neither `protectLabelBrackets` nor `linkSafe`). So no migration handling is needed, and such a document now reads as CommonMark reads it (`[a\\[x\\]z](/u)` is the link `a\[x\]z`). Extending `protectLabelBrackets` to text beside an image instead was rejected: the save would still not be CommonMark, and documents written elsewhere would keep misreading.

**Recommendation and decision:** fix the reader; a Changed changelog entry, no migration note. Decided (the user accepted the viewer change).

### `++` pairs as `~~` does — decided: GFM's flanking rules in all three parts

All three parts read `++text++` with a pattern and no flanking check. The viewer uses `UNDERLINE_EXTENSION` ([markdownExtensions.ts:60](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L60), `/^\+\+([^+]+)\+\+/`). Source mode uses `UNDERLINE` and `parseUnderline` ([markdownSourceSyntax.ts:157](../packages/lib/src/typescript/lib/component/editor/markdownSourceSyntax.ts#L157), `:186`). The editor's importer maps the viewer's `underline` token (`markdownImporter.ts:82`). Any two `++` in a paragraph pair up.

The fix in each part:

- **Viewer.** The underline tokenizer gets CommonMark's left-flanking check for an opener and right-flanking check for a closer. Its closer search hides the stretches `marked` hides for `~~` (code spans, inline links and images, tags and autolinks, escapes, references with a defined label), using `marked`'s own `rules.inline.gfm` patterns (`reflinkSearch`, `anyPunctuation`, `blockSkip`). The precedent is `marked`'s `Tokenizer.del` and the file's existing reuse of `rules.inline.gfm` (`:20`). The pairs of one inline text are computed once, in one pass, cached by the token array, so lexing stays linear.
- **Source mode.** The pattern parser is replaced by a lezer delimiter that copies the file's own `~~` parser `parseStrikethroughMark` ([markdownSourceSyntax.ts:133](../packages/lib/src/typescript/lib/component/editor/markdownSourceSyntax.ts#L133)). Its flanking code moves into a shared `delimiterFlanking(cx, from, to)`.
- **Editor write side.** About a dozen places in `markdownSerializer.ts` and `markdownWritable.ts` assumed that underline has no flanking rule and cannot hold `+`; they go, so underline is written and edited as strikethrough is. `FLANKED_FORMATS` (`markdownWritable.ts:3104`) gains `"underline"`, and a `FLANKED_DELIMITERS` map replaces the two `format === "strikethrough" ? "~" : "*"` picks. The lean-escape rule treats a `+` run as pairable only when a `++` that can open comes before one that can close (`plusRunsCanPair`). These edits are needed, not optional: with the reader fix alone the editor would save `b++ a++`, which no longer reads as underline.[^underline-precedent]

| Source | Before (all three parts) | After (all three parts) | `~~` in the same place today |
|---|---|---|---|
| `a++b++c` | `a<u>b</u>c` | the same | `a<s>b</s>c` |
| `++a++` | `<u>a</u>` | the same | struck |
| `C++` | text | text | text |
| `x ++ y ++ z` | `x <u>y </u>z` | text | text |
| `C++ and C++` | `C<u> and C</u>` | text | text |
| `Use C++ or C++20.` | `Use C<u> or C</u>20.` | text | text |
| `++a ++`, `++ a++`, `a++ b++` | underlined | text | text |
| `++a+b++` | text | `<u>a+b</u>` | `<s>a~b</s>` |
| `+++a+++` | `+<u>a</u>+` | text | text in the viewer |
| `++a++++b++` | `<u>ab</u>` | `<u>a++++b</u>` | `<s>a~~~~b</s>` |
| ``++a `b++` c++`` | the code span broken | `<u>a </u><code>b++</code><u> c</u>` | the same |
| `++[t](/a+b)++` | `++` link `++` | an underlined link | the same |

The decided rules:

1. **When `++` opens and closes.** By GFM's `~~` rules: an opener is not followed by whitespace and a closer is not preceded by it, with punctuation counted as for `*`. Pairing inside a word is allowed, as for `*` and `~`. `x++(a)++y` becomes text, as `x~~(a)~~y` already is.
2. **Underline may hold a `+`.** The editor's "underline over `+`" decline goes. A `+` typed into underlined text stays underlined, and a `+` at the edge of underlined text is escaped.
3. **Run length.** Only a run of exactly two `+` is a mark.
4. **Edge spaces.** Underlining ` b ` in `a b c` gives `a ++b++ c` (the tip gave `a++ b ++c`), as bold trims edge spaces. The toolbar's underline state ignores edge spaces, as it does for bold.
5. **Bold underline against a letter has no form.** Bold and underline on `bu` before `zq` was saved `++**bu**++zq`, which now reads as text. No writing reads back, so the toggle that would make it is declined, as for `x**(a)**b`.
6. **Fewer backslashes.** `C++ and C++` saves bare, where the tip saved `C\+\+ and C\+\+`. The lean save is still checked against the full one by lexing (`leanOrFull`).

**Consequences.** A document with spaces just inside the marks (`++ a ++`) now shows the marks as text. The corpus row `underline with plus` (`++a+b++`) is now underlined, which moves the CommonMark comparison's corpus count from 553 to 552 of 635. The reference reader has no underline syntax at all, so that row cannot match. Spec rows stay at 651 of 652.

**Recommendation and decision:** as above; a Changed changelog entry. Decided (the user accepted the viewer changes).

### Changelog — three behaviour changes and four fixes

The changes are recorded in `docs/reference/changelog/next.md` as follows:

- The three behaviour changes the user accepted each get a new *Changed › Components* entry: nested items released by a lift, bracket escapes in link text, and `++` pairing.
- Fix 1 corrects the unreleased Fixed entry "**Tabs in Markdown indentation count as CommonMark counts them.**" (line 2158) in place, since that entry lists the difference this plan removes. Fix 3 is covered by the same entry and gets no entry of its own.
- Fix 4 extends the Fixed entry "**Enter in a Markdown code block keeps the new line in its blockquote or list item.**" (line 1902).
- The renumbering Enter, and the insert, paste and checkbox fixes, each get a new *Fixed › Components* entry.
- The underline change also edits the Changed entry "**`MarkdownEditor` makes nothing a save cannot write as shown.**" (line 569), which lists "underline over a `+`" as declined.[^changelog]

---

## Public API

None. Internal additions, none re-exported from an entry point:

```ts
// markdownItemRenumbering.ts (new)
/** @internal Used by `languages.ts` only. */
export function keepingRenumberedItemContent(command: StateCommand): StateCommand;

// markdownTabStopCommands.ts: exported, body unchanged
/** @internal Shared with `markdownItemRenumbering.ts`. */
export function transactionOf(command: StateCommand, state: EditorState): Transaction | null;

// markdownListItemNode.ts
export function $releaseOpeningLists(item: MarkdownListItemNode): void;
```

---

## Ordered Implementation Steps

Work in `.worktrees/markdown-eleven-known-issue-fixes`. Its `node_modules` and `packages/lib/node_modules` are symlinks to the main tree; do not run `npm install`. Run tests from `packages/lib`. `$P` below stands for `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans6/eleven-known-issue-fixes`.

Each fix's reference code is its saved prototype diff. Apply the source part from the repo root with `git apply --3way --include='packages/lib/src/*' $P/<topic>/prototype.diff`. Then read the result against `## Architecture Decisions`, and against the project's conventions (JSDoc on every function, explicit return types, documented constants, no call inside an `if` condition). The docs hunks of the diffs are applied in step 7 only. Apply the fixes in this order, which is the order the combined prototype was built and checked in.

1. **Read the critical files** in `## Critical Files`. Run `npx vitest run tests/component/markdown tests/component/display tests/component/code-editor.test.ts`; it passes on the base, the tip `0dbf7c3eb` (81 files).

2. **Renumbering Enter and Enter in a code block's first-line indentation** (`source-enter`).
   1. Apply `$P/source-enter/prototype-tests.diff` (`git apply --3way`), which touches `code-editor.test.ts` and `markdown-editor-list-item-edits.test.ts`. Check: 25 rows fail in `code-editor.test.ts`. They are row F23, row TS20 (with its `copiesPrefix` exclusion removed), 8 new rows for Enter in a code line's indentation and 15 new renumbering rows. The new WYSIWYG guard and the 4 renumbering guards pass.
   2. Apply the source part: `languages.ts`, the new `markdownItemRenumbering.ts`, and the `transactionOf` export in `markdownTabStopCommands.ts`. Check: both files pass. `grep -n "keepingRenumberedItemContent(atMarkdownTabStops(insertNewlineContinueMarkup))" src/typescript/lib/component/editor/languages.ts` finds one line.

3. **Bracket escapes in link text** (`link-text-brackets`).
   1. Apply `$P/link-text-brackets/prototype-tests.diff`. It adds rows in `display/markdownLexer.test.ts`, `markdown-images.test.ts`, `markdown-reference-links.test.ts` and `markdown-source-mode-through-model.test.ts`, and changes the nine rows that pinned the doubled form (`## Expected Behaviour`). Check: 38 rows fail.
   2. Apply the source part: `markdownExtensions.ts`, `markdownSerializer.ts`, `markdownImporter.ts` and `markdownSourcePlaces.ts`. Check: the seven test files pass. `grep -n "protectLabelBrackets\|leavesOfUnescapedLinks\|escapedEnd\|linkSafe" src/typescript/lib/component -r` finds nothing.

4. **The `- - b` family and the checkbox inserts** (`nested-list-split`).
   1. Apply `$P/nested-list-split/repo-tests.diff`. It adds the new rows, the guard sweep and the `$releaseOpeningLists` unit test, and changes the 34 lift rows. The diff adds 78 rows (81 tests, since the three new table rows also run through row T17) and changes the 34 lift rows, in eight files. Check: 106 tests fail in those eight files (the 34 changed rows and 72 new tests; 9 new tests are guards).
   2. Apply the source part: `MarkdownEditor.ts` and `markdownListItemNode.ts`. Check: the touched files pass. `grep -n "\$insertNodeToNearestRootAtCaret" src/typescript/lib/component/editor/MarkdownEditor.ts` finds nothing.
   3. Then fix the JSDoc the prototype left stale:
      - the `@returns` of `$settleItemTextBeforePasteEndingInBlock` ("…or a rule with text after the caret, split first");
      - the remark of `$enterSplitsTaskItem` (add: "the paste listener gives the text after a pasted table, `:::` block or rule its own unchecked checkbox");
      - the comment at `markdownListItemNode.ts:835` ("or what a text taken out of its list left": no lift leaves that now);
      - the JSDoc of `insertTable` (`MarkdownEditor.ts:11718`), `insertHorizontalRule` (`:11792`), the two list toggles (`:10982`, `:11017`) and `setBlockType` (near `:11440`), with the sentences of `## Documentation Impact`.

5. **`++` flanking** (`underline-flanking`).
   1. Apply `$P/underline-flanking/prototype-tests.diff`, which touches seven test files. Check: 43 rows fail.
   2. Apply the source part: `markdownExtensions.ts`, `markdownSourceSyntax.ts`, `markdownSerializer.ts` and `markdownWritable.ts`. Check: the seven files pass. `grep -n "pendingUnderline\|const UNDERLINE = " src/typescript/lib/component -r` finds nothing.

6. **The tab in fenced code, and source-mode places for code lines** (`tab-in-fence`).
   1. Apply `$P/tab-in-fence/prototype-tests.diff`. It changes corpus rows T30 to T33, adds `TAB_CODE_CASES` and its loop in `markdown-roundtrip.test.ts`, adds rows in `markdown-editor-list-item-edits.test.ts`, `markdown-source-mode-through-model.test.ts` and `markdown-source-places.test.ts`, and narrows the two excusals. Check: the rows marked "fails" in `## Expected Behaviour` fail.
      In `markdown-source-mode-through-model.test.ts` this diff and the nested-list diff both add rows at the end of `ROWS`, after the row "a code block's empty line in an item is the code block's". `git apply --3way` reports a conflict there: keep both blocks of rows, the nested-list rows first.
   2. Apply the source part: `markdownTabs.ts`, `markdownSourcePlaces.ts`, and the `listWithTabStops` JSDoc in `markdownExtensions.ts`. Check: the five test files pass. `grep -c "TAB_CODE_CASES" tests/component/markdown-roundtrip/corpus/tabs.ts tests/component/markdown-roundtrip/markdown-roundtrip.test.ts` finds the list and its use.
   3. Confirm that `CORPUS` did not grow: `git diff 0dbf7c3eb -- tests/component/markdown-roundtrip/corpus/index.ts` is empty.

7. **Docs and changelog**, as given in `## Documentation Impact`. Apply the docs hunks of `$P/tab-in-fence/prototype.diff` and `$P/link-text-brackets/prototype.diff` (`git apply --3way --include='packages/lib/docs/*'`), then make the remaining edits by hand.

8. **Verification**, as given in `## Verification`.

The known-issues list (`scratch-keep/known-issues-2026-10.md`) is outside the repo. Do not edit it: the orchestrator updates it after the merge.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/editor/markdownItemRenumbering.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/languages.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownTabStopCommands.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownTabs.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceSyntax.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownImporter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/tests/component/display/markdownLexer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-list-item-edits.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-horizontal-rules.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-table-commands.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-task-items.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-list-item-paste.test.ts` |
| Modify | `packages/lib/tests/component/markdown-list-item-node.test.ts` |
| Modify | `packages/lib/tests/component/markdown-images.test.ts` |
| Modify | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-reference-links.test.ts` |
| Modify | `packages/lib/tests/component/markdown-serializer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-look.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-mode-through-model.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-places.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/tabs.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-roundtrip.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-view-model.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-escape-fuzz.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-nested-edit-fuzz.test.ts` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All rows are offline unit tests unless the section says otherwise. They run in the node environment with the test DOM; the source-mode key rows use `code-editor.test.ts`'s `typed` harness, which builds an `EditorState` with the keymap and no view. In the tables of this section a string in backticks is the content of a TypeScript single-quoted literal, as the test writes it: `\n` is a line end, `\t` a tab, `\\` one backslash. Inside a table cell, `\|` stands for `|`. `x@n` is offset `n` in the text node whose text is exactly `x`. The *base* is the tip, `0dbf7c3eb`. "Fails" means the row fails on the base and passes after the fix; "guard" means it passes on both.

Each test diff named in `## Ordered Implementation Steps` holds the exact rows, with the values measured on the prototype. The tables below give the rows that pin each decision. Where a table and a diff disagree, the diff's measured value is right, and the disagreement is reported in the Implementation Notes.

### Fix 1: a tab in a code line inside a list item or quote

In `corpus/tabs.ts`, rows changed in place (they pinned the old reading):

| Row | Source | Declared blocks after |
|---|---|---|
| T30 | `- one\n\n  ```\n  aa\n  \tbb\n  ```\n\n- two\n` | `ul![li[p"one" code"aa⏎→bb"] li[p"two"]]` |
| T31 | `- a\n\n  ```\n  -\told\n  +\tnew\n  ```\n` | `ul![li[p"a" code"-→old⏎+→new"]]` |
| T32 | `>\t\t\tfoo\n` | `quote[code"  →foo"]` |
| T33 | `> ```\n> \tx\n> ```\n` | `quote[code"→x"]` |

In the new `TAB_CODE_CASES` (15 rows, each run through the declared-blocks test and every harness check), among them:

| Row | Source | Blocks | On the base |
|---|---|---|---|
| two tabs that start a fenced code line in an item stay tabs | `- one\n\n  ```\n  \t\tbb\n  ```\n` | `ul![li[p"one" code"→→bb"]]` | fails |
| a tab that starts a fenced code line in a nested item stays a tab | `- a\n  - b\n\n    ```\n    \tbb\n    ```\n` | `ul[li[p"a" ul![li[p"b" code"→bb"]]]]` | fails |
| a tab that starts a fenced code line in an item in a quote stays a tab | `> - a\n>\n>   ```\n>   \tbb\n>   ```\n` | `quote[ul![li[p"a" code"→bb"]]]` | fails |
| a tab that an item's content column cuts across reads in fenced code as the columns left of it | `- one\n\n  ```\n  aa\n \tbb\n  ```\n` | `ul![li[p"one" code"aa⏎  bb"]]` | guard |
| a tab past the four columns of indented code in an item stays a tab | `- a\n\n      \tcode\n` | `ul![li[p"a" code"→code"]]` | fails |
| a whitespace line of fenced code in an item keeps its tab past the item's content column | `- a\n\n  ```\n  \t\n  bb\n  ```\n` | `ul![li[p"a" code"→⏎bb"]]` | fails |

In `markdown-editor-list-item-edits.test.ts`, a new describe "a tab that starts a code line in a list item or a quote is kept by a save after an edit", before the describe "a range that takes everything a list item holds…" (line 1387). Each row goes through `runRow`, which checks the reload, idempotence, parity and the standard form:

| Row | Source | Step | Saved | On the base |
|---|---|---|---|---|
| bold on the item's text keeps the tab of a fenced code line | `- one\n\n  ```\n  aa\n  \tbb\n  ```\n\n- two` | bold on `one` | `- **one**\n\n  ```\n  aa\n  \tbb\n  ```\n\n- two` | fails (`    bb`) |
| bold in a quote keeps the tab of its fenced code line | `` > a\n>\n> ```\n> \tbb\n> ``` `` \| bold on `a` \| `` > **a**\n>\n> ```\n> \tbb\n> ``` `` | fails |
| bold on the item's text writes a fenced code line's cut tab as the spaces it reads as | `` - one\n\n  ```\n \tbb\n  ``` `` \| bold on `one` \| `` - **one**\n\n  ```\n    bb\n  ``` `` | guard |
| a tab typed at the start of a code line in an item is saved as a tab | `` - a\n\n  ```\n  bb\n  ``` `` \| type `\t` at `bb@0` \| `` - a\n\n  ```\n  \tbb\n  ``` `` | fails |
| a lazy code line holding tabs in a nested quote reads as the spaces they stand for | `>>\t#\th\n      -\t>\ta\tb` | none | the source | guard |

### Fix 3: source-mode commands beside a code line with a tab

In `markdown-source-mode-through-model.test.ts`, `ROWS` of the describe "the pass", after the row "a code block's empty line in an item is the code block's" (line 559). All of them fail on the base (the command declines):

| Row | Source | Range | Command | Text after |
|---|---|---|---|---|
| an item's text before a fenced code line that starts with a tab | T30's document without its last line end | 2–5 | bold | `- **one**\n\n  ```\n  aa\n  \tbb\n  ```\n\n- two` |
| an item's text after a fenced code line that starts with a tab | the same | 33–36 | link | `…\n\n- [two](https://example.com/x)` |
| a quote's text before a fenced code line that starts with a tab | `` > a\n>\n> ```\n> \tbb\n> ``` `` \| 2–3 \| bold \| `` > **a**\n>\n> ```\n> \tbb\n> ``` `` |
| an item's text before a fenced code line whose tab the item cuts across | `` - one\n\n  ```\n \tbb\n  ``` `` \| 2–5 \| bold \| `` - **one**\n\n  ```\n    bb\n  ``` `` |
| an item's text before an indented code line of two tabs | `- a\n\n\t\tcode` | 2–3 | bold | `` - **a**\n\n  ```\n    code\n  ``` `` |

A `DECLINES` guard after `5.31` (line 661): "a lazy code line holding a tab in a quote", `> # h\n      -\tx`, 4–5, bold, which passes on both. In `markdown-source-places.test.ts`, a new `it.each` before the SP18 block, "a code line in a list item or quote that starts with a tab has its source found", with 13 placements, every one `null` on the base. An example: `` - one\n\n  ```\n  aa\n  \t¦bb\n  ``` `` gives `[[[one][aa\n\t¦bb]]]`.

**Measurement** (not a test). The tab-measure probe of the re-check, over 3,161 generated documents:

| Measure | Before | After |
|---|---|---|
| Runs that decline in the tab form where the spaces form acts | 170 (47 documents) | 72 (18) |
| Of those, runs the spaces form edits word for word | 12 (3) | 0 |
| Tab-form lines without caret places | 1,536 | 1,111 |

### Fix 2: Enter that renumbers an ordered list

In `code-editor.test.ts`, describe "built-in markdown language typing", after TS28 (line 5073). Each row is `typed('markdown', start, '\n')`:

| Row | Start | Expected | On the base |
|---|---|---|---|
| Enter that renumbers an item from 9 to 10 moves its later paragraph with its content | `8. a\|\n9. i\n\n   j` | `8. a\n9. \|\n10. i\n\n    j` | fails |
| Enter that renumbers an item from 99 to 100 whose marker a tab follows moves its later lines to the tab's new stop | `98. a\|\n99.\ti\n\n    j` | `98. a\n99. \|\n100.\ti\n\n        j` | fails |
| Enter that renumbers an item in a quote moves its later paragraph after the quote marker | `> 8. a\|\n> 9. i\n>\n>    j` | `> 8. a\n> 9. \|\n> 10. i\n>\n>     j` | fails |
| Enter that renumbers an item writes a tab past its content column as spaces when its width would change | `8. a\|\n9. i\n\n   \t    x` | `8. a\n9. \|\n10. i\n\n         x` | fails |
| Enter that lifts an empty item out of its list moves the later lines of the item it renumbers from 10 to 9 | `7. x\n8. y\n9. \|\n10. b\n\n        c` | `7. x\n8. y\n\|\n9. b\n\n       c` | fails |
| Enter that renumbers an item whose marker a tab follows leaves its later lines where they are | `8. a\|\n9.\ti\n\n    j` | `8. a\n9. \|\n10.\ti\n\n    j` | guard |
| Enter that renumbers an item leaves a lazy continuation line where it is | `8. a\|\n9. i\nlazy` | `8. a\n9. \|\n10. i\nlazy` | guard |
| Enter that renumbers an item and moves its later lines is one undo step | `8. a\|\n9. i\n\n   j`, with `history()` as in TS21 | undo depth 1; undo gives the start | guard |
| Enter that renumbers an item and moves its later lines keeps the key press as the user event | the same, with a recording filter as in TS22 | `['input']` | guard |

Fifteen rows fail on the base in all; the other ten cover two spaces after the marker, the `)` delimiter, a list nested in an item, a nested list, fenced code (whose text keeps its relative indentation), indented code, a tab that crosses the content column, a lifted nested item, and the reading of the result (`languageOutline`).

WYSIWYG guard, in `markdown-editor-list-item-edits.test.ts`, describe "an ordered list numbers each of its items" (line 2562). The row is "Enter that renumbers an item from 9 to 10 writes its later paragraph at the item's new content column": Enter at `a@1` in `8. a\n9. i\n\n   j` saves `8. a\n\n9.\n\n10. i\n\n    j`, through `expectSaveKeepsDocument`.

### Fix 4: Enter in the indentation of an indented code block's first line

In `code-editor.test.ts`, describe "built-in markdown language typing", next to rows F19 to F23 (lines 4554–4572):

| Row | Start | Expected | On the base |
|---|---|---|---|
| F23, renamed "Enter in front of the first character of an indented code block in an item keeps the line in the code block" | `- a\n\n      \|code` | `- a\n\n      \n      \|code` | fails (it pinned `- a\n\n\n  \|code`) |
| Enter in front of the text of a tab-indented code line in an item keeps the line in the code block | `- a\n\n\t\t\|x` | `- a\n\n\t\t\n\t\t\|x` | fails |
| Enter in front of the text of a tab-indented code line in a quote keeps the line in the code block | `> \t\t\|x` | `> \t\t\n> \t\t\|x` | fails |
| Enter between the tabs of a top-level code line keeps the tab in the code's text | `\t\|\tx` | `\t\n\t\t\|x` | fails |
| Enter after the list marker of an item that opens with a code block keeps the code in the item | `-     \|x` | `-     \n      \|x` | fails |
| Enter in front of the quote marker of a quoted code line leaves the line as it is | `\|>      x` | `\n\|>      x` | guard |
| Enter in the indentation of a fence line in an item is not the code block's | `` - a\n\n  \|```\n  x\n  ``` `` \| `` - a\n\n\n  \|```\n  x\n  ``` `` | guard |
| Enter in the indentation of a paragraph line in an item is Markdown's own | `- a\n\n  \|b` | `- a\n\n\n  \|b` | guard |

Row TS20 (lines 4931–5003) loses its exclusion "Enter where the library's prefix-copying Enter handles the spaces form but not the tab form": the comment, and `handlerOf`, `prefixCopyingEnter`, `tabState` and `copiesPrefix`, which become unused. Without the exclusion, TS20 fails on 3 presses on the base and passes after the fix.

### Fixes 5 to 9: no empty bullet holding a nested list, and the checkbox

The rows are in `$P/nested-list-split/repo-tests.diff`. Every row also checks four things: the save reloads to itself, the editor surface equals `viewerModel(saved).blocks`, one undo returns to the source (two for Delete then Enter), and typing `Q` lands as shown. All the rows below fail on the base unless marked guard.

An insert inside an item's text, in `markdown-editor-horizontal-rules.test.ts` (describe "insertHorizontalRule places a rule as insertTable places a table", line 1114) and `markdown-editor-table-commands.test.ts` (describe at line 174):

| Row | Source | Caret | Insert | Saved |
|---|---|---|---|---|
| a rule in a nested item's text goes into the outer item, the nested list split around it | `- a\n  - bc` | `bc@1` | rule | `- a\n\n  - b\n\n  ---\n\n  - c` (caret `c@0`) |
| a nested task item split by a rule gives its second half an unchecked checkbox | `- a\n  - [ ] bc` | `bc@1` | rule | `- a\n\n  - [ ] b\n\n  ---\n\n  - [ ] c` |
| a checked task item split by a rule gives its second half an unchecked checkbox | `- [x] bc` | `bc@1` | rule | `- [x] b\n\n---\n\n- [ ] c` |
| a rule at the end of an item's text goes in front of the item's nested list | `- a\n  - b\n- z` | `a@1` | rule | `- a\n\n  ---\n\n  - b\n\n- z` |
| a pasted table there does the same | `- a\n  - b\n- z` | `a@1` | pasted table | `- a\n\n  \| h \|\n  \| --- \|\n  \| c \|\n\n  - b\n\n- z` |
| a top-level item is split as before | `- bc` | `bc@1` | rule | `- b\n\n---\n\n- c` (guard) |
| an image does not split the item | `- a\n  - bc` | `bc@1` | image | `- a\n  - b![i](/i.png)c` (guard) |

The caret right after a checkbox, in `markdown-editor-task-items.test.ts` (describe "a block insert with the caret before a task item's checkbox goes above the item", line 1316):

| Row | Source | Caret | Edit | Saved |
|---|---|---|---|---|
| a rule right after the checkbox goes above the item | `- [x] one` | `one@0` | rule | `---\n\n- [x] one`; `Q` gives `---\n\n- [x] Qone` |
| a table right after the checkbox goes above the item | `- [x] one` | `one@0` | table | `\|  \|  \|\n\| --- \| --- \|\n\|  \|  \|\n\n- [x] one` |
| a pasted rule right after the checkbox goes above the item | `- [x] one` | `one@0` | pasted rule | `---\n\n- [x] one`; `Q` gives `---\n\n- [x] Qone` |
| a rule right after a later item's checkbox goes between the items | `- [ ] one\n- [x] two` | `two@0` | rule | `- [ ] one\n\n---\n\n- [x] two` |
| a pasted table in the middle of a task item's text gives its second half an unchecked checkbox | `- [ ] bc` | `bc@1` | pasted table | `- [ ] b\n\n\| h \|\n\| --- \|\n\| c \|\n\n- [ ] c` |

The lifts, in `markdown-editor-list-item-edits.test.ts` (describe "a block type or a list toggle in a list item acts on the block the caret is in", line 1676, and the Z-rows describe, line 2573), and in source mode in `markdown-source-mode-through-model.test.ts`:

| Row | Source | Edit | Saved |
|---|---|---|---|
| a heading made from an item releases its nested items one level out | `- a\n  - b1\n  - b2\n- z` | heading 2 at `a@0` | `## a\n\n- b1\n- b2\n- z` |
| a heading made from an item in source mode releases its nested task item | `- a\n  - [x] b` | source caret 0, heading 2 | `## a\n\n- [x] b` |
| a heading made from a nested item in source mode releases the items after it | `- x\n  - a\n  - [x] b` | source caret 4, heading 2 | `- x\n\n## a\n\n- [x] b` |
| a nested list of another kind keeps its kind | `- a\n  1. b\n- z` | heading 2 at `a@0` | `## a\n\n1. b\n\n- z` |
| Enter on an emptied item over a nested list ends the list, the nested items moving out into its place | `- a\n  - b` | select `a`, Delete, Enter | `- b`; `Q` gives `Q\n\n- b` |
| Backspace at the start of an item over a nested list | `- a\n  - b` | Backspace at `a@0` | `a\n\n- b` |
| a heading made from a nested item without nested items is unchanged | `- a\n  - b` | source caret 4, heading 2 | `- a\n\n## b` (guard) |
| Enter on an emptied nested item over its own nested list outdents it and keeps the caret in it | `- x\n  - a\n    - b` | select `a`, Delete, Enter | `- x\n- - b`; `Q` gives `- x\n- Q\n  - b` (guard) |

**The 34 rows that pin the old lift change** (to the values in `repo-tests.diff`):

- `markdown-editor-list-item-edits.test.ts`: H2, H12, H16, Z9, CI49.
- `markdown-editor.test.ts`:
  - "a caret in an item holding a nested list takes the item out and leaves its nested list an item…" (line 973), renamed;
  - "a quote from a list item keeps its nested list in the item" (line 3010), renamed;
  - the parity table of "MarkdownEditor list toggles in a list of their kind" (lines 1176–1411): X11 UL and OL, S2 UL and OL, S5 UL and OL, M19 UL and OL, T9 UL and OL, T16 UL and OL, S6 UL and OL, M18 UL, OL and h2, M24 UL, OL and h2, M25 UL and OL, T19 UL, OL and h2, E27 UL.
- `markdown-list-item-node.test.ts`: S6 (line 247).

For example, H2 changes from `one\n\n- - inner\n- three` to `one\n\n- inner\n- three`, and Z9 from `Q\n\n- - n\n- z` to `Q\n\n- n\n- z`.

**The guard sweep.** In `markdown-editor-list-item-edits.test.ts`, a new describe "no block insert, paste or conversion at a caret in an item's text leaves an item opening with a nested list". It loads six documents, none of which holds such an item:

- `- ab\n  - cd\n- z`
- `- [ ] ab\n  - [x] cd\n    - ef\n- [ ] z`
- `1. ab\n   - cd\n   - gh\n2. z`
- `> - ab\n>   - cd`
- `- ab\n\n  pq\n  - cd\n- z`
- `- x\n  - ab\n  - [x] cd\n- z`

At every offset of every text node in an item's text it runs ten edits: insert rule, insert table, pasted rule, pasted table, heading 2, paragraph, quote, code, and both list toggles. Two checks apply:

- **No item opens with a nested list.** It counts the items in the reloaded save whose first child is a list, and requires 0.
- **No checkbox is lost.** For the four block edits, the reloaded save holds no fewer checkboxes than the source, plus one more when the caret was strictly inside a task item's text, and holds no `\[ \]` or `\[x\]` text.

The pasted edits are left out for `- ab\n\n  pq\n  - cd\n- z`: the join rule still leaves `- - cd` there (`## Non-Goals`). The sweep makes 540 runs, as one `it` per document. The base fails 218 of them on the first check and 28 on the second; the fix fails none. It takes about 2 s inside its file and 3 s alone and runs under `SWEEP_TIMEOUT_MS = 60_000`, declared in its own describe with the same comment as the list-item sweep's constant (line 2452).

### Fix 10: bracket escapes in link text

In `display/markdownLexer.test.ts`, a new describe "an escaped bracket in a link's or image's text reads as a bracket, as CommonMark reads it". Each row also checks that `lexMarkdownUnbounded` gives the same tokens:

| Row | Source | Expected | On the base |
|---|---|---|---|
| keeps the link around a pair after an image | `[![a](/i.png)\\[x\\]z](/u)\n\n[x]: /d` | `link(mdimage escape text escape text)` to `/u` | fails |
| keeps the link around a pair naming a defined label | `[a \\[x\\] b](/u)\n\n[x]: /d` | `link(text escape text escape text)` to `/u` | fails |
| reads the alt text of an image whose description holds a pair naming a defined label with its brackets | `![a \\[x\\] b](/i.png)\n\n[x]: /d` | alt `a [x] b` | fails |
| keeps a backslash before a bracket in a code span inside link text, as code keeps every backslash | `` [`\\[`](/u) `` | codespan `\[` | fails |
| lets a defined reference written with bare brackets in link text win over the link around it | `[[x]z](/u)\n\n[x]: /d` | `text link(text) text`, the inner link to `/d` | guard |

In `markdown-images.test.ts`, a new describe "brackets typed right after an image inside a link's text stay text". The first row loads `[![a](/i.png)z](/u)\n\n[x]: /d` and types `[x]` right after the image. It expects the save `[![a](/i.png)\\[x\\]z](/u)\n\n[x]: /d`, shown as saved, and a reload whose links are `[['markdown-image','text']]`; it fails on the base. Eighteen more rows cover six image forms (`![a](/i.png)`, `![a][r]`, `![a]`, `![a\]]`, `![ a ]`, `![a&#91;]`), each with `[x]`, `[]` or `[x](y)` typed after it; 16 fail on the base.

In `markdown-source-mode-through-model.test.ts`, three bold rows before `5.19`. An example: bold at 20 in `[![i](/i.png)\\[x\\] word](/u)\n\n[x]: /d` gives `[![i](/i.png)\\[x\\] **word**](/u)\n\n[x]: /d`.

**The nine rows that pinned the doubled form change:**

- `markdown-images.test.ts`, the insertImage row "brackets, emphasis marks and quotes": `![a \\[b\\] \\*c\\*](/i.png "T \\"q\\"")`.
- `markdown-importer.test.ts`, the row for `x [[\\[a \\]b](/p)](/q)`: the saved value `x \\[[\\[a \\]b](/p)\\]\\(/q) q`.
- `markdown-reference-links.test.ts`:
  - DEF10;
  - "a reference link's own text holding a label stays text";
  - "a link built in the editor holding a label stays text once a definition for it is added". Its describe drops "(marked unescapes link-text brackets)".
- `markdown-serializer.test.ts`:
  - the row about a `(` or `{` after a `]`;
  - "a backslash before a bracket in a code span inside a link is doubled", renamed "…is written as it is", now expecting `` [`\\[`](/u) ``;
  - F11;
  - J14, now `[\\[a\\]](/u)`.

SP11 in `markdown-source-places.test.ts` only drops "which `marked` reads without its backslash" from its name.

### Fix 11: `++` pairs as `~~` does

In `markdown-roundtrip/markdown-view-model.test.ts`, a new describe "underline pairs its ++ marks as strikethrough pairs ~~", before "editor surface projection". Each row checks `viewerModel(source)`, and also that the source with every `+` turned into `~` reads the same with `strike`:

| Row | Source | Runs | On the base |
|---|---|---|---|
| plus signs after a word and before a space are text | `C++ and C++` | text | fails |
| the same in a sentence | `Use C++ or C++20.` | text | fails |
| plus signs with spaces on both sides are text | `x ++ y ++ z` | text | fails |
| a space just inside a mark leaves both marks text | `++a ++` and `++ a++` | text | fails |
| underline may hold a plus sign | `++a+b++` | `[u('a+b')]` | fails |
| a run of three or more plus signs neither opens nor closes | `+++a+++`, `++a++++b++` | text; `[u('a++++b')]` | fails |
| a ++ in a code span is no mark of an underline around it | ``++a `b++` c++`` | `[u('a '), textRun('b++', ['code','underline']), u(' c')]` | fails |
| underline inside a word | `a++b++c` | `a`, `u('b')`, `c` | guard |
| a whole underlined word | `++a++` | `[u('a')]` | guard |
| a plus pair after a word | `C++` | text | guard |

In `markdown-source-look.test.ts`, `MARKDOWN_ROWS`, run in both themes:

- "underlined text cannot hold a plus sign" becomes "underlined text can hold a plus sign": `++a+b++` gives `[['++','inline mark'],['a+b','plain'],['++','inline mark']]`.
- New rows "plus signs after a word and before a space are plain text" (`C++ and C++`), "plus signs with spaces inside are plain text" (`a ++ b ++ c`) and "a run of three plus signs is plain text" (`+++a+++`).

In `markdown-serializer.test.ts`:

- The describe "underline keeps the whitespace it covers inside its delimiters" is replaced by "underline writes the whitespace at its edges outside its delimiters, as strikethrough does": leading whitespace gives `b ++a++`, trailing whitespace gives `++a++ b`, whitespace alone gives `a b`.
- Lean rows: `C++ and C++` saves `C++ and C++` (fails); `a ++b++ c` as text saves `a \\+\\+b\\+\\+ c` (guard).
- S25 becomes "a + inside underlined text stays inside the underline", `++a+b++`. A new row "a + at the edge of underlined text is escaped, so its run stays two long": `++C\\+\\+++ and ++\\+a++`.
- The link row becomes `++[t](/a+b)++`.

In `markdown-editor.test.ts`, rows D1, D5, D6 and D7 take `x(a)b` with `toggleUnderline()` as their declined example, where they used underline over `+`. Eleven rows of `markdown-importer.test.ts` that relied on underline over `+` being declined move to other declined shapes. Among them, `UNDERLINE_DECLINED_BY_ONE_CELL` becomes `UNDERLINE_OVER_PLUS_CELLS`, and `| C++ |` saves `| ++C\\+\\+++ |`. The escape fuzz's `emphasisLine` gains an underlined node, and the nested edit fuzz's `SOURCE_COMMANDS` gains `toggleUnderline`.

### Manual (browser) checks

The offline harness cannot show these. Use the docs app or the demo (`npx vite --port 5404` from `packages/lib`, the MD Editor page), with a `MarkdownEditor`:

1. **Home then Enter in source mode.** Switch to source mode with `- a`, a blank line, then two tabs and `x`. Click the end of the `x` line, press Home, then Enter. The line moves down with its tabs, and the colours still show code.
2. **Renumbering Enter.** In source mode with `8. a`, `9. i`, a blank line, three spaces and `j`, press Enter at the end of `a`. `j` moves to four spaces and stays coloured as the item's text. Then press Ctrl+Z once: the document is back as it was.
3. **A click right after a checkbox.** In WYSIWYG with `- [x] one`, click just left of `o` (the caret lands after the checkbox), then use the toolbar's horizontal rule. The rule appears above the item, and the item keeps its checked box.
4. **Underline.** Load `C++ and C++ and ++u++`. Only `u` is underlined, in the WYSIWYG surface, in source mode's colours and in the `Markdown` viewer.
5. **A tab in fenced code.** Load `- one`, a blank line, then a fence, code lines `aa` and `→bb`, and a closing fence, each indented two spaces. The code line shows a tab's width in WYSIWYG. Bold `one`, switch to source mode: the line still holds the tab.

---

## Verification

From `packages/lib`:

- `npx vitest run tests/component/markdown tests/component/display tests/component/code-editor.test.ts`: every row of `## Expected Behaviour` passes, and nothing else changes. The combined prototype gave 81 files and 17,802 tests, all passing.
- `npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p tsconfig.test.json` (or `npm run typecheck` and `npm run typecheck:test`), and `npm run lint`: clean.
- `npm run docs:api`: zero warnings. The new exports are internal and are linked from no public JSDoc.
- **The CommonMark comparison** must not drop. Copy `$P/combined-commonmark/` and point `MINE` in its `tests/compare.test.ts` at the copy's `out/`. Run it with `ONLY='**/compare.test.ts' TREE=<worktree>/packages/lib npx vitest run --config vitest.review.config.mjs` (the config's `dir` is already `tests/`, so `ONLY=tests/compare.test.ts` matches no file). Count the rows of `out/compare.json` with `set` `'spec'` and `same` true: 651 of 652 (only spec 606, Autolinks, differs). For the corpus rows, expect 556 of 635: the tip's 553, plus T30 to T33, minus `underline with plus`.
- **The reload and round-trip differential of the tab-column work** (corpus, hand-written cases and `tabDocuments(3000)`): its hard checks stay at 0. The prototype measured them through `$P/tab-in-fence/differential/` (`count.mjs` over `final.jsonl`).
- Greps, all from `packages/lib`:
  - `grep -rn "protectLabelBrackets\|leavesOfUnescapedLinks\|pendingUnderline" src/` finds nothing.
  - `grep -n "export function transactionOf" src/typescript/lib/component/editor/markdownTabStopCommands.ts` finds one line.
  - `git diff 0dbf7c3eb -- tests/component/markdown-roundtrip/corpus/index.ts` is empty.
- **Last of all, from the repo root:** run plain `npm test` with the machine at full load. It passes. The one new heavy test, the guard sweep, has its named 60-second timeout.

---

## Documentation Impact

No public symbol changes, so no API page or catalog entry moves.

**`packages/lib/docs/components/Markdown.md`:**

- *Tabs* (line 98): the docs hunk of `$P/tab-in-fence/prototype.diff`. It replaces "One reading differs from CommonMark. Inside a list item or a blockquote, a tab in the leading run … CommonMark keeps both tabs." with two paragraphs:
  - "A code line inside a list item or a blockquote reads from the column the container's content starts at, as CommonMark reads it. A tab the container leaves whole stays a tab in the code, and a tab the container cuts across reads as the columns left of it, as spaces. `··→bb` in a fenced code block of a `- ` item is the code line `→bb`, `··-→old` is `-→old`, and `·→bb` is `··bb`."
  - "One reading differs from CommonMark. A line without `>` indented as code after a heading in a quote is read into the quote as its code, where CommonMark ends the quote before it; the tabs of such a line show as the spaces that reach their tab stops."

  Keep one clause of the old sentence, after the second paragraph: "A tab in the leading run of an HTML line inside a list item or a blockquote is likewise shown as the spaces that reach its tab stop."
- The syntax table row "`++underlined++` | `<u>`" (line 53) becomes "`++underlined++` | `<u>`: its `++` marks pair as `~~` does, so `C++ and C++` stays text and `a++b++c` underlines `b`."
- The extension-syntax paragraph (line 147): after "`++text++` for underline", insert "(its marks pair by the flanking rules GFM uses for `~~`: a run of exactly two `+` opens only when no whitespace follows it and closes only when none precedes it, so `Use C++ or C++20.` shows its plus signs)".
- The `[text](url)` row (line 61): append "; an escaped bracket in its text is text (`[see \[1\]](/u)` is one link even where `[1]` is defined)".

**`packages/lib/docs/components/MarkdownEditor.md`:**

- From the docs hunks of the two prototype diffs:
  - line 91: the brackets sentence becomes "…is saved with both brackets escaped (`\[label\]`), so a definition added for it later leaves it text and cannot hide the emphasis around it.", and the sentence beginning "A link whose text holds an image is the exception" is removed;
  - lines 97, 316 and 320: the tab sentences, as in the tab-in-fence hunk.
- Line 106: "**Bold, italic and strikethrough at a run's edge.**" becomes "**Bold, italic, strikethrough and underline at a run's edge.**", and "emphasis or strikethrough opening with punctuation" becomes "emphasis, strikethrough or underline opening with punctuation".
- Line 107 becomes "**A colour, font or size over `[` or `]`.** A styled span's grammar cannot hold a bracket. The setter that would make one is declined; a bracket typed or pasted into styled text shows without the style, as the save writes it."
- Line 109 (*Task items*): extend the sentence on `insertTable` and `insertHorizontalRule` to "with the caret before the checkbox or right after it, `insertTable`, `insertHorizontalRule` and a pasted table or rule put their block above the item, which keeps its checkbox". Add: "An insert or a pasted block that splits a task item's text gives the text after it an unchecked checkbox, as Enter does."
- Line 111 (*Lists*):
  - "…and the nested list and what follows it stay in the list, in an item with no text" becomes "…and the nested list's items stay in the list, one level out, in the item's place; what followed the nested list goes to the last of them".
  - In the sentence "Pasting several blocks into a nested list item, or Insert line after block … adds such a block to the outer item", add `insertTable` and `insertHorizontalRule` at a nested item's text.
  - Add: "At the end of the text of an item holding a nested list, a pasted or inserted block goes into the item, in front of that list."
- Line 83: after "A rule pasted at the end of a list item's text is the last block of that item", add "(in front of the item's nested list, when it holds one)".
- Line 134 (the toggles) and line 138 (`setBlockType`): after "the blocks its item holds up to its first nested list follow it", add "; the nested list's items stay in the list, one level out, in the item's place".
- Lines 139 and 140 (`insertTable`, `insertHorizontalRule`): after "in a quote the table goes into the quote, the block split around it", add "; a list item is not split between its text and its nested list: the block goes into the item, in front of that list".

**`packages/lib/docs/components/CodeEditor.md`:**

- Line 86: append "In an ordered list it renumbers the items below; when a number gains or loses a digit (`9.` to `10.`), the item's later lines move with its text, so its paragraphs, nested lists and code stay in it."
- Line 87: append "In an indented code block this starts at the indentation of its first line: with the caret anywhere between the line's markers and its text, as after Home, Enter moves the whole line down."

**JSDoc** (in `MarkdownEditor.ts`): `insertTable` (line 11718) and `insertHorizontalRule` (line 11792) gain the list-item sentence of lines 139–140. The two list toggles (lines 10982 and 11017) and `setBlockType` (near line 11440) gain the release sentence.

**`packages/lib/docs/reference/changelog/next.md`.** Its paragraphs wrap at about 75 columns: match the quoted text across line ends, and rewrap each edited paragraph.

- *Changed › Components*, three new entries at the end of that section's Components list:

  > - **`MarkdownEditor` moves a list item's nested items one level out when the item leaves its list.** Making a list item's text a heading, a paragraph, a quote or a code block, toggling its list off, Enter on its emptied text and Backspace at its start left its nested list in an item with no text, saved `- - b` and shown as an empty bullet. The nested items now take the item's place, one level out (`- a`, `  - b` with a heading on `a` saves `## a` and `- b`), and the blocks after the nested list go to the last of them. In source mode too. No consumer action is needed.
  > - **`Markdown` and `MarkdownEditor` read an escaped bracket in a link's or image's text as a bracket.** `[see \[1\]](/u)` showed as plain text wherever `[1]` was defined, an image's alt text lost such brackets (`![a \[1\] b](/i.png)` had the alt `a 1 b`), and a code span in link text lost the backslash before a bracket. They now read as CommonMark specifies, as source mode already showed them. Brackets typed into a link's text, beside an image too, save with one backslash and reload as typed; a link holding an image and typed `[x]` no longer loses its link on reload. No consumer action is needed.
  > - **`++` underlines only where it can open and close, as `~~` strikes.** `C++ and C++` showed `C` and an underlined ` and C`, in the viewer, the editor and source mode. A `++` now opens only when no space follows it and closes only when no space precedes it, by GFM's rule for `~~`. Code spans and links inside an underline are kept whole, underline may hold a `+`, and a run of three or more `+` is text. The editor no longer underlines a selection's edge spaces, as for bold, and saves `C++ and C++` without backslashes. A document with spaces just inside the marks (`++ a ++`) now shows the marks as text.

- *Changed*, the entry "**`MarkdownEditor` makes nothing a save cannot write as shown.**" (line 569): "Bold, italic and strikethrough applied over edge spaces" becomes "Bold, italic, strikethrough and underline applied over edge spaces", and "underline over a `+`, " comes out of its list of declined results.
- *Fixed › Components*:
  - The entry "**Tabs in Markdown indentation count as CommonMark counts them.**" (line 2158), as in the tab-in-fence hunk. "One reading still differs from CommonMark: inside a list item or blockquote, a tab in the indentation of a code or HTML line … is read as the spaces that reach its tab stop." becomes "A code line inside a list item or blockquote keeps a tab its container leaves whole, so an edit elsewhere in the item no longer saves that tab as spaces, and source-mode commands act beside such a line. A tab in the indentation of an HTML line inside a list item or blockquote, or right after a marker character that starts such a line, is read as the spaces that reach its tab stop."
  - The entry "**Enter in a Markdown code block keeps the new line in its blockquote or list item.**" (line 1902): append "Enter in the indentation of an indented code block's first line, where Home puts the caret, turned the line into a paragraph or changed its indentation; it now moves the whole line down, as on the block's other lines."
  - New, directly after that entry:

    > - **Enter that renumbers a Markdown list keeps each item's later lines in the item.** In `MarkdownEditor`'s `"source"` mode and any `CodeEditor` with `language: "markdown"`, Enter that added an item renumbered the items below it, and an item going from 9 to 10 (or 99 to 100) left its later paragraphs, nested lists and code one column short, so they read outside the list or as code. They now move with the item's text, in the same undo step. No consumer action is needed.

  - New, directly after "**`MarkdownEditor.insertTable()` leaves no empty quote, heading or list item…**" (line 1190):

    > - **`MarkdownEditor` leaves no empty bullet when it inserts or pastes a block in a list item.** `insertHorizontalRule()`, `insertTable()` and a pasted rule or table in a nested item's text, or at the end of an item's text over its nested list, left the nested list under a new empty bullet (`- - b`); the block now goes into the item, in front of its nested list. In a task item's text the second half lost its checkbox and now gets an unchecked one, as after Enter; with the caret right after the checkbox, which a click on the text's start gives, the checkbox became the text `[x]` and the block now goes above the item. No consumer action is needed.

The known-issues list is updated by the orchestrator, not by this plan.

---

## Potential Challenges

- **Diffs applied in another order conflict.** `markdownExtensions.ts`, `markdownSerializer.ts` and `markdownSourcePlaces.ts` are each touched by two or three fixes. Keep the step order, use `git apply --3way`, and resolve any conflict by keeping both sides' changes. They touch different functions. In the sources the only shared region is the `$placeOfSourceOffset` JSDoc list at `markdownSourcePlaces.ts:155–164`, where both edits stand. In the tests the one conflict is the end of `ROWS` in `markdown-source-mode-through-model.test.ts` (step 6.1).
- **A corpus row added by any step moves the corpus differential onto other commands** and can expose the two differences on the base listed in *New reading rows go in a list of their own*. Add no `CORPUS` row; the step 6 grep checks it.
- **The 34 lift rows are spread over three files with their own tree spellings.** Take the new values from `repo-tests.diff`, not from this plan's prose.
- **The guard sweep builds many editors.** Dispose each, as the join sweep in `markdown-editor-command-crashes.test.ts` does, so a fully loaded `npm test` stays within memory.
- **The renumbering wrapper reads the syntax tree `renumberList` read.** If the parse has not reached the end of a renumbered item, its last lines would not move. This is unlikely, since the items are right below the caret; it is recorded, not guarded.
- **The underline tokenizer's cache is keyed by `marked`'s token array.** It relies on `marked` calling the extension with the same array at each `++` of one inline text. A `marked` upgrade must re-check this; the view-model rows would show it.

---

## Critical Files

- [markdownTabs.ts:35-60, 220-500](../packages/lib/src/typescript/lib/component/display/markdownTabs.ts#L220): `tabWidthAt`, `prefixEnd`, `expandPrefixTabs`, `SOURCE_KEPT_TYPES`, `findRawLine`, `sourceOfSlice`, `restoreTokenSources`, `restoreFrom`. These are the precedent for fix 1.
- [markdownSourcePlaces.ts:150-200, 700-990, 1350-1380](../packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts#L966): `$placeOfSourceOffset`, `locateByEntries`, `leavesOfUnescapedLinks`, `locateVerbatim`, `$placeAmongUnits`.
- [languages.ts:200-460, 620-640](../packages/lib/src/typescript/lib/component/editor/languages.ts#L241): `CaretBlocks`, `caretBlocksAt`, `containerPrefixAt`, `prefixForNewLine`, `newLineWithPrefix`, `insertNewlineKeepPrefix`, and the Markdown keymap.
- [markdownTabStopCommands.ts:180-336](../packages/lib/src/typescript/lib/component/editor/markdownTabStopCommands.ts#L316): `withoutFilters`, `transactionOf`, `keepsRun`, `atMarkdownTabStops`. These are the precedent for the renumbering wrapper.
- `node_modules/@codemirror/lang-markdown/dist/index.js:163-295`: `renumberList` and `insertNewlineContinueMarkupCommand`.
- [MarkdownEditor.ts:1430-1830, 6080-6140, 6400-6490, 7140-7240](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7161): the paste path, the Enter list exit, the task-item split, `$makesNoEmptyHalf`, `$insertBlockToNearestHolderAtCaret`, `$insertTableAt`, `$insertHorizontalRuleAt`.
- [markdownListItemNode.ts:16-30, 500-540, 700-1065](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L893): the item model, `MarkdownListItemTextNode.insertAfter` and `replace`, `$insertAfterUnwalked`, `$moveRestBeforeItem`, `$splitItemAfterText`, `$outdentItem` (the precedent for releasing), `$liftItemOut`, `$splitListAfter`.
- [markdownExtensions.ts:20-90, 530-760, 800-860](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L554): `UNDERLINE_EXTENSION`, `MATCHES_NOTHING`, `keepingEscapes`, `DIALECT_IMAGE_TOKENIZERS`, `listWithTabStops`.
- [markdownSourceSyntax.ts:100-210](../packages/lib/src/typescript/lib/component/editor/markdownSourceSyntax.ts#L133): `MARKDOWN_STRIKETHROUGH` and `parseStrikethroughMark` (the precedent for the `++` delimiter), `UNDERLINE` and `parseUnderline`.
- `markdownSerializer.ts`:
  - [:5750-5990, 6150-6180, 6330-6370](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L5957): `writeBracketed`, `protectLabelBrackets`, `writeCodeSpan`, `writeImage`;
  - [:7560-7630](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L7568): `delimiterKeepsEscape`, `needsEscape`;
  - [:3440-3480](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L3462): `keepsContentColumn`.
- [markdownWritable.ts:2780-2800, 3050-3110](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L3104): `FLANKED_FORMATS`, `$keepUnwritableCharactersPlain`.
- Plans:
  - `plans/implemented/markdown-list-toggle-task-item-parity.md`, rules at lines 156–170 (rule 2 is reversed here);
  - `plans/implemented/markdown-editor-cross-item-range-removal.md`, lines 50–58 and 248–252 (the join decision kept);
  - `plans/implemented/markdown-source-mode-enter-after-quote-tab.md` (`atMarkdownTabStops` and footnote `[^approach]`);
  - `plans/implemented/markdown-commonmark-images.md`, its Notes and Implementation Notes on the link-text sweep.
- The prototype diffs under `$P/` and their test diffs. `$P/tab-in-fence/notes.txt` is that fix's full research report.

---

## Non-Goals

- **The join of a list's first item.** `$moveRestBeforeItem` still leaves `- - b` where a join takes away an item's text that its nested list follows; the recorded decision of the cross-item range-removal plan stands (see *The join leaves `- - b` as before*).
- **A pasted rule's place in the middle of an item's text.** It stays in the first half's item, as documented.
- **A pasted rule then paragraph right after a checkbox.** It still saves `- \[x\]…`, since the paste ends in a paragraph and the listener does not take it; a plain item gives an odd result for the same paste. It is for the orchestrator to add to the known-issues list.
- **The remaining tab-prefix declines (72 runs) and place losses (390 lines).** Lazy code lines in a quote and raw HTML blocks in odd items, where declining is the safer result.
- **The two corpus-differential differences on the base** (`CommonMark 587` after a heading or quote; `loose list ending in a blank line` with the bulleted toggle). They exist on the base and are kept from surfacing by adding no corpus row.
- **Source mode's colouring of bare brackets in link text without a definition** (`[[x]z](/u)`). Lezer does not know the document's definitions; colour only, and older.
- **The source-mode `~~` parser's run-length check before a run** (`x ~~~a~~~` struck in source mode, text in the viewer). It was found while copying it for `++`, which does not share the gap. It is for the orchestrator to add to the known-issues list.
- **Bullet characters when released items join a list.** Lists of one kind join, as Lexical joins them, whatever their bullet.

---

## Addendum: Measurements

All measurements were taken on private copies of `0dbf7c3eb` under `$P/`, with each topic's probes in its own `probe/` or `probes/` folder.

| What | Result |
|---|---|
| Fix 1, 31 tab shapes against commonmark.js 0.31.2 | The tip differs on every shape with a whole tab in code. After the fix all agree, except the whitespace-only line and lazy lines (decided). |
| Fix 1, round-trip differential (corpus, hand-written cases, 3,000 generated documents, 3,678 records) | Hard checks 0 before and after (15 without the lazy-line guard). 84 documents change their viewer reading, all towards CommonMark. |
| Fix 3, tab measurement (3,161 documents) | 170 to 72 declining runs; 12 to 0 word-only runs; 1,536 to 1,111 lines without places; 98 runs newly act, all keeping the reading; 0 newly decline. |
| Fix 2, 28 renumbering shapes | The tip changes the reading in every width-changing shape. After the fix, every result reads as the start did plus the new item, undo depth is 1, and the WYSIWYG surface equals the viewer's reading. |
| Fix 4, 83 first-line caret positions in 19 documents | Enter changes the reading at 41 (tab form) and 34 (spaces form) positions on the tip, and at 0 and 0 after the fix. |
| Fixes 5–9, guard sweep (540 runs) | Tip: 218 items opening with a nested list and 28 lost checkboxes. After: 0 and 0, with the join document's pasted edits left out. About 3 s. |
| Fix 10, the CommonMark images branch's sweep (5,280 documents) | 15 failures on the tip, 0 after. |
| Fix 10, link-text family against micromark (18 bodies, 7 wrappers, 5 definition sets) | 469 of 630 agree on the tip; 630 of 630 after. |
| Fix 10, workaround branches | Not hit in 16 test files (11,521 tests) or the sweep. |
| Fix 11, lex time at 128,000 characters | `++a ` repeated: 44 ms on the tip, 47 ms after. Nested openers: 33 ms on the tip, 48 ms after. `marked`'s own `~~` takes 47 s on that input. |
| CommonMark spec rows, every prototype and the combined tree | 651 of 652 (spec 606, Autolinks, differs). |
| CommonMark corpus rows | Tip 553 of 635. Fix 11 alone 552 (the `++a+b++` row); fix 1 alone 557 (rows T30 to T33); all five 556. |
| Combined tree, every source and test diff applied in step order (`combined.diff`) | Both typechecks and eslint on the changed sources clean. Markdown set plus `code-editor.test.ts`: 81 files, 17,802 tests, all pass. CommonMark: spec 651 of 652, corpus 556 of 635. |

---

## Notes

[^tab-cause]: The tab-column plan accepted this reading as pinned (its decision on code lines, rows T30 to T33, footnote `[^pinned-code]`). Traced chain: `prefixEnd` ends a line's prefix at the first character that is not whitespace, `>`, a list marker followed by whitespace, or a checkbox after a marker, so in `··→bb` all of `··→` is prefix. `prefixTabEdits` and `expandLine` write those tabs as spaces with an offset map. `listWithTabStops` (`markdownExtensions.ts:818`) and `blockquoteWithTabStops` (`:849`) lex the copy, and `marked` strips the item's indentation, so the fence's line reads `··bb`. The unedited save writes the restored top-level `raw`, byte for byte, which is why only an edit lost the tab.

[^tab-precedent]: `sourceOfSlice` writes a token's `raw` back through the expansion's offset map: a tab whose spaces are all present becomes a tab again, and the spaces of a cut tab stay spaces. `sourceFromColumn` reads the rest of the line from the source rather than through `sourceOfSlice`, because the expansion writes the whitespace after a marker as one space. Changing `prefixEnd` to stop at a block's content was the other option; it needs the block structure that the lexer is about to compute, which is the circularity the tab rule's expanded copy exists to avoid.

[^lazy-guard]: Without the guard, 15 generated documents failed the differential's check that a standard-form save reads as the source. All were quotes where `marked` reads a line without `>` into the quote as code (for example `>>→#→h⏎······-→>→a→b`, where CommonMark ends both quotes). The editor keeps such a quote as a raw block whose text is a nested quote's unrestored expanded `raw`, so restoring only the code text made the two disagree.

[^decline-trace]: Traced with a probe: `editThroughModel` (`MarkdownEditor.ts:9769`) → `runOnModel` (`:9797`) → `selectInModel` (`:9831`), where `applies` is false → `$selectSourceRange` (`markdownSourceModel.ts:403`) returns false when an end has no place (`:444`) ← `$placeInSpans` ← `$placeOfSourceOffset` ← `$locatedWalk` ← `locateByEntries` ← `locateBlockEntry` ← `locateVerbatim`. `editOfModel` (`:9867`) takes the smallest edit of any write and never declines. The re-check's guess, a check comparing a re-saved text with the source, is not the mechanism.

[^corpus-growth]: Reproduced with the source changes stashed: the same differences appear as soon as rows are added to `TAB_CASES`, so they are not caused by fix 1. The differential picks commands by `(d + k) % 7` over 11 commands and parts by index `% 8`. A separate list keeps the corpus differential's selection as it is on the base, while the rows still get every round-trip check.

[^renumber-module]: A module of its own keeps `markdownTabStopCommands.ts` about tab stops. It also keeps the renumbering code loadable without a grammar package, `marked` or Lexical; it imports only CodeMirror packages that `CodeEditor` itself imports, and `markdownTabs.ts`. It keeps its own `MAX_MARKER_SPACING = 4` (the serializer's constant) for the same reason, with a comment saying so. `deleteMarkupBackward` does not renumber, so Backspace needs no wrapper; the package has no Delete command.

[^family-precedent]: Searched for how the editor already keeps a nested list with its item and how it removes an item left without text. Found: the paste rule and row P10 of `plans/implemented/markdown-editor-list-item-node.md` (a block pasted into a nested item goes into the outer item); the quote stop in `$insertBlockToNearestHolderAtCaret` (`:7174`); `$outdentItem` (`markdownListItemNode.ts:808`), whose comment at `:835` reads "An outer item that held nothing but this list … goes with it" and which moves what followed into the moved item; and `$moveRestBeforeItem` (`:735`). The insert's stop mirrors the paste rule and the quote stop. The release mirrors `$outdentItem`. The checkbox rule mirrors `$splitTaskItemAtCaret`. The insert loop is Lexical's `$insertNodeToNearestRootAtCaret` loop written out with these stops, as the function's quote branch already was; Lexical's inline-to-paragraph wrap and its "inserted into itself" guard are left out, since the only callers (`$insertTableAt`, `$insertHorizontalRuleAt`) pass a fresh block.

[^link-dead]: The importer's and the places module's skips existed only to match text that `marked` had read without the backslash before a bracket. With the reader keeping escapes, the `raw` matches the source directly. Row SP11 of `markdown-source-places.test.ts` now goes through the ordinary path. `unescapeCodeSpanBrackets` stays: it handles backtick pairing in `marked`'s link-text pattern, a different quirk. The `(` and `{` escape after a `]` in `needsEscape` stays too; only its comment's reason changes ("which would otherwise extend the link, image or span that `]` or `)` closes").

[^underline-precedent]: `marked`'s `del` cannot be called for `+`: its patterns are fixed to `~`, it masks escapes as `+` (so `\*` would look like `++`), and an extension tokenizer gets neither the masked source nor the previous character. The tokenizer therefore reads the character before a run from its cached reading of the inline text. That character is the real previous character, where `marked`'s own `prevChar` is empty after a non-text token; every such token ends in punctuation, so the flanking result is the same. Fresh scans per opener were quadratic (as `marked`'s `~~` is on the tip); the one-pass pairing with openers on a stack is linear.

[^changelog]: The chain records a change of behaviour a user can see as a Changed entry, and a fix to a feature as a Fixed entry, or as an edit of the feature's own entry when that entry lists the behaviour. The lift release, the link-text reading and `++` pairing change what existing documents show or how existing commands act, and the user asked for each to be recorded as a behaviour change. The tab entry lists the very difference fix 1 removes, so it is corrected in place rather than contradicted by a second entry. The renumbering, the inserts and the checkbox were plain defects.

---

## Implementation Notes

- **Commit shape.** The plan's step 7 applies all the documentation at the end. Each of the five fixes (Enter that renumbers together with Enter in code indentation, bracket escapes in link text, the nested-list and checkbox fixes, `++` flanking, and the tab in code) instead has its own code commit and its own documentation commit, in the order of the steps, so that every functionality keeps the code-then-documentation shape. The documentation text is the plan's.
- **Merge conflict.** Step 6.1 reported the one expected conflict at the end of `ROWS` in `markdown-source-mode-through-model.test.ts`; both blocks of rows were kept, the nested-list rows first.
- **Grep check of step 4.2.** `grep -n "\$insertNodeToNearestRootAtCaret"` in `MarkdownEditor.ts` finds two lines, both in JSDoc that refers to Lexical's own function by name (the hook's description and the insert function's description). No call remains.
- **Typecheck script.** The plan names `npm run typecheck:test` for the repo root; it exists in `packages/lib` only, so it was run there.
- **Red state.** The failing counts matched the plan for steps 2, 3, 4 and 5 (25, 38, 106 and 43). For step 6 the source was stashed to confirm the new rows fail on the base: 42 failed across the four affected files.
- **Results.** Full suite from `packages/lib` with `--maxWorkers=2`: 637 files, 27,019 tests passed, 2 todo; after fix round 1, 27,025 tests passed, 2 todo; after fix round 2, 27,031 tests passed, 2 todo; after the final fix round, 27,037 tests passed, 2 todo. Plain `npm test` from the repo root: the same counts both times, passing. CommonMark comparison: spec 651 of 652, corpus 556 of 635. `build:lib`, `docs:api` and `docs:llms:check` clean. The guard sweep keeps its own `SWEEP_TIMEOUT_MS` of 60 seconds.
- **Verification greps** (run on the branch after the first fix round): `protectLabelBrackets|leavesOfUnescapedLinks|pendingUnderline` in `src/` finds nothing; `export function transactionOf` in `markdownTabStopCommands.ts` finds one line; `git diff 0dbf7c3eb -- tests/component/markdown-roundtrip/corpus/index.ts` is empty.
- **Tab-column reload and round-trip differential** (corpus, hand-written cases and `tabDocuments(3000)`): re-run on the branch tip after the first fix round, with the prototype's probe (`differential/diff.test.ts`) pointed at the branch tree, 3,678 records. Hard checks (error, verbatim, parity, idempotent): 0. The soft counts equal the prototype's last run (`final.jsonl`): 504 surface differences, 472 with the spaces form, 14 and 2 in the canonical checks. The prototype's own last run, on code that matches the branch, had the same figures.
- **Fix round 1.** (a) The renumbering Enter moves exactly the lines the viewer reads as part of the renumbered item (`itemLastLine`). Markdown's parser lets an item whose first line is empty run over a later indented line, where CommonMark ends it only when the line right after the marker line is blank. Once the item has content, later blank lines do not end it, and the item's own `>` lines are not blank; only the marks of the quotes around the list count as blank. Round one's rule (end at the first blank line) was wrong and is replaced. (b) The whitespace-at-a-line-start sentence of `MarkdownEditor.md` no longer lists underlined text, and the underline changelog entry says so. (c) Underline has an editor-level row for edge spaces, one for rule 5 (bold underline against a letter is declined) and an entry in the toolbar-state toggle table; they pass on the code as it was, since the behaviour was already in place and untested. (d) The nested-items wording says where they land: in a list where the lifted item's outermost list stood, as siblings, so a nested item lifted out of every list sends its own nested items to that level, not under its parent. (e) The `+ 1` in the renumbering module is named `DELIMITER_LENGTH`.
- **Fix round 2.** The rule of round one is replaced as stated in (a) above. A sweep of 5,832 documents (two number widths, four forms of the item's first line, three following lines drawn from nine shapes) checks that the viewer reads the result of Enter as it read the start plus one empty item; the sweep is committed in `code-editor.test.ts` under its own named timeout and gives no failures (the first round's code gave 160, the code before it 486). The changelog heading `### Core` that a rewrap had joined to the previous entry is restored.
- **Manual browser checks.** The reviewer ran three of the plan's five: the renumbering Enter, its single undo step, and Home then Enter on tab-indented code. The checks for a click right after a checkbox, `++` underline in the three parts, and a tab in fenced code are left for the user.
- **Deviation from the plan's renumbering rule (plan line 181, "Tabs").** The plan has every tab whose width would change at its new column written as the spaces it spanned. Since fix 1 reads a tab in code text as a tab, that rewrote code. The renumbering Enter now rewrites a tab only in indentation: the whitespace past the content column up to where a code line's text starts, which is the opening fence line's own indentation for a fenced code line and the column where the code block's node starts (four columns past its container) for an indented one. Every tab in code text, and the fence lines themselves, stay as written. The reading stays the same, because code text starts at a fixed column, and the WYSIWYG save agrees. Other lines follow the plan's rule. Rows cover fenced and indented code, in a quote, widening and narrowing, and the committed sweep (10,648 documents) now has code lines that hold a tab.
