---
depends-on: [markdown-editor-four-known-issue-fixes]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/markdownImporter.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourceModel.ts
  - packages/lib/src/typescript/lib/component/editor/editorNodes.ts
  - packages/lib/src/typescript/lib/component/display/Markdown.ts
  - packages/lib/tests/component/markdown-roundtrip/viewModel.ts
  - packages/lib/tests/component/markdown-editor-command-crashes.test.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
---

# Markdown Horizontal Rules — Implementation Plan

## Overview

A thematic break (`---`, `***`, `___`, with the spaces, tabs and up to three
spaces of indentation CommonMark allows) is not supported today. The `Markdown`
viewer renders it through its plain-text fallback, so a literal `---` shows
([Markdown.ts:1660](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L1660),
documented at [Markdown.md:166](../packages/lib/docs/components/Markdown.md#L166)).
`MarkdownEditor` keeps it as a raw Markdown block, the `MarkdownRawBlockNode`
of [markdownSourceNodes.ts:213](../packages/lib/src/typescript/lib/component/editor/markdownSourceNodes.ts#L213),
which the importer builds for every token type it has no node for
([markdownImporter.ts:1126](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L1126)).

This plan supports the construct on both surfaces, under one name: a
**horizontal rule** (in prose, "a rule"). The viewer renders `<hr>`. The editor
gets a node of its own, `MarkdownHorizontalRuleNode` (type
`markdown-horizontal-rule`), in a new file
`packages/lib/src/typescript/lib/component/editor/markdownHorizontalRuleNode.ts`.
The node shows a rule, is selected and deleted as one unit, holds no text, and
stands wherever the viewer nests a rule: at the top level, in a list item, in a
quote and in a `:::` column. A loaded rule keeps the line it was written with;
a rule made in the editor is written `---`. The plan adds the
`insertHorizontalRule()` command, a typing shortcut (`---`, `***` or `___`, then
a space or Enter), toolbar and menu entries beside Table and Image…, the
`canInsertHorizontalRule` field of the selection state, `<hr>` paste, and the
source-mode rules for a rule's line.

The plan is written against `68e69463b`, the tip of
`feature/markdown-editor-four-known-issue-fixes`; line numbers are from that
commit. The design was run as a prototype first, in
`~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans6/horizontal-rules/`:
with it every Markdown suite passes (15,142 tests) once the rows of *Tests
that are restated* are restated, and 198 placements of a rule save so that
they reload as shown (*Addendum: Prototype*).

---

## Architecture Decisions

### A rule is a decorator node of the editor's own

`MarkdownHorizontalRuleNode extends DecoratorNode<null>`, as
`MarkdownImageNode` does
([markdownImageNode.ts:40](../packages/lib/src/typescript/lib/component/editor/markdownImageNode.ts#L40)):
static `getType`, `clone` and `importJSON`, `decorate()` returning `null`,
and a `createDOM` that mints its element through the DOM seam's
`createViewElement`. It differs from the image in three places: `isInline()`
is `false`, `getTextContent()` is `"\n"`, and a static `importDOM()` reads
`<hr>`. It is registered in `EDITOR_NODES`
([editorNodes.ts:40](../packages/lib/src/typescript/lib/component/editor/editorNodes.ts#L40)).[^decorator]

Lexical's own handlers then give it everything a block decorator gets, with
no code of the editor's: node selection, Backspace and Delete beside it, the
arrow keys across it, and Enter on a selected rule. The prototype ran each one
(*Selecting and deleting a rule*).

### The viewer renders `<hr>` with the Markdown theme tokens

`appendBlockToken`'s switch
([Markdown.ts:1643](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L1643))
gains `case "hr"`, which builds an `<hr>` through `this.create("hr")`, gives it
the class `ts-ui-md-horizontal-rule` and appends it, as `appendBlockquote`
builds a `<blockquote>`
([:1894](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L1894)).
The viewer nests blocks by walking a container's tokens with
`appendBlockTokens`, so a rule in a list item, a quote or a column is
rendered by the same case.

`ensureMarkdownClassRules`
([Markdown.ts:180](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L180))
gets the class rule, and `ensureMarkdownEditorClassRules`
([editorTheme.ts:50](../packages/lib/src/typescript/lib/component/editor/editorTheme.ts#L50))
the same rule under `ts-ui-mde-horizontal-rule`, so the two surfaces look
alike:

| Property | Value | Why |
|---|---|---|
| `border` | `"0"` | drops the browser's inset border |
| `borderTop` | `"1px solid var(--ts-ui-border-color, rgba(127, 127, 127, 0.4))"` | the token and weight of the table cells' borders |
| `margin` | `"1em 0"` | the block margin a paragraph and a `:::` block stand apart by |

The editor also gets `ts-ui-mde-horizontal-rule-selected` for a selected
rule: `outline: "2px solid var(--ts-ui-indicator-focus, rgb(30, 100, 200))"`,
the focus ring's width and accent
([focusRing.ts:19](../packages/lib/src/typescript/lib/component/input/focusRing.ts#L19)),
and `outlineOffset: "2px"`, which keeps the ring clear of the one-pixel line
it rings. `EDITOR_THEME` names the two classes under the custom keys
`mdHorizontalRule` and `mdHorizontalRuleSelected`, beside `mdImage`.[^theme]

### A selected rule shows the selected class

A node selection is no DOM selection, so CSS cannot tell a selected rule. The
rule's `createDOM` adds the selected class when `this.isSelected()` holds, and
`updateDOM()` returns `true`, so Lexical builds the element again whenever the
node is marked dirty. A new `registerHorizontalRuleSelection(editor)`
registers an update listener that compares the rules a node selection holds
before and after each update, and marks each rule whose state changed dirty,
in an update tagged `HISTORY_MERGE_TAG`, so the mark is no undo step. The same
function registers the click that selects a rule (*Selecting and deleting a
rule*). It is called from `registerEditorRules`
([MarkdownEditor.ts:10732](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L10732)),
so the WYSIWYG editor and the source-mode model register it alike.[^selected-look]

### What a load builds, and where a rule stands

`$buildBlock`
([markdownImporter.ts:1117](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L1117))
gains `case "hr": return $buildHorizontalRule(token);`. `HELD_BLOCK_TYPES`
([:392](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L392))
gains `"hr"`, so `$readRawBlockAsBlocks` shows a raw block whose text an edit
turns into a thematic break as a rule, as it shows one turned into a heading
as a heading. A list item, a quote and a column build their blocks through
`$buildLocatedBlock`, so each holds a rule with no change of its own.

| Source | Today | After (`rule` = `markdown-horizontal-rule`) |
|---|---|---|
| `a` / (blank) / `---` / (blank) / `b` | `paragraph("a") \| markdown-raw-block("---") \| paragraph("b")` | `paragraph("a") \| rule \| paragraph("b")` |
| `- a` / (blank) / `  ___` / `- b` | the item holds a raw block | `list(item(text("a"), rule), item(text("b")))` |
| `> a` / `>` / `> ---` | the quote holds a raw block | `markdown-quote(paragraph("a"), rule)` |
| `::: columns` / `a` / `\|\|\|` / `---` / `:::` | the column holds a raw block | `markdown-block(column(paragraph("a")), column(rule))` |
| `- ***` / `- b` | the item opens with a raw block | `list(item(rule), item(text("b")))` |
| `- foo` / `***` / `- bar` | list, raw block, list | `list \| rule \| list` |
| `a` / `---` | a heading | a heading (unchanged: a setext underline) |
| `*`, tab, `*`, tab, `*` | a raw block | a rule |

A tight list whose item holds a rule right under its text (`- a` over
`  ***`) stays a raw block, as it does today for any block right under an
item's text in a tight list (the `listItemBlocks` divergence).

### A loaded rule keeps its line; a new rule is written `---`

The line a rule was written with is node state, as a hard break keeps its
marker (`hardBreakMarkerState`,
[markdownNodeState.ts:15](../packages/lib/src/typescript/lib/component/editor/markdownNodeState.ts#L15)):
`horizontalRuleMarkerState`, under the key `mdHorizontalRule`, holds the
token's `raw` without its indentation and the blanks that end it. Its
`parse` accepts only a thematic break with no indentation and gives `""`
otherwise; `""` is a rule made in the editor, written `---`. The state goes
with the node through copy, paste and undo, as every node state does.[^marker]

| Written | State | Written anew (its container edited) |
|---|---|---|
| `---` | `---` | `---` |
| `  * * *  ` (top level) | `* * *` | `* * *` |
| `*`, tab, `*`, tab, `*` in a list item | `*`, tab, `*`, tab, `*` | the same |
| `-----` | `-----` | `-----` |
| made by `insertHorizontalRule()` or pasted from HTML | `""` | `---` |
| typed `***` and a space | `***` | `***` |

Indentation is never kept on the node. It is kept where it is written: an
unedited top-level rule, and an unedited part (a list item, a quote's block, a
column's block) holding one, are written as their source by the source map,
as every unedited block and part is
([markdownSerializer.ts:2004](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2004)
`unchangedBlock`). A rule therefore needs no part of its own in the source map.

`SOURCE_KEPT_TYPES`
([markdownTabs.ts:311](../packages/lib/src/typescript/lib/component/display/markdownTabs.ts#L311))
keeps `"hr"`: it sets a nested rule's `raw` back to the source, so the state of
a rule in a list item keeps the tabs it was written with. Only the set's
comment changes.[^source-kept]

### How a rule is saved, and why every save reads back

`serializeBlock`
([markdownSerializer.ts:2310](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2310))
writes a rule as its state, or `---`, through `$horizontalRuleMarkdown(node)`.
Blocks are always written a blank line apart, so the one shape in which a
rule's line could read otherwise is an item that opens with the rule, under a
marker of the rule's own character. The serializer already handles that shape
for the raw block: `listItemLines`
([:3731](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L3731))
puts the marker on a line of its own, `listLayout`
([:3246](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L3246))
writes a `-` list under a line of text with `*` then, and the nested-list
switch of `listItemLines` keeps `- - -` from reading as a break. All three test
the written line, not the node, so they apply to a rule unchanged; only
their comments, which say "raw thematic break", change.[^safety]

| Tree | Saved |
|---|---|
| a new rule opening an item of a `-` list, then `- b` | `-` / `  ---` / `- b` |
| the same in a list nested right under an item's text `a` | `- a` / `  * ---` / `  * c` |
| `***` opening an item of a `*` list | `*` / `  ***` / `* b` |
| `***` opening an item of a `-` list | `- ***` / `- b` |
| `- - -` opening an item of a `-` list | `-` / `  - - -` / `- b` |
| `- - -` opening an item of a `*` list | `* - - -` / `* b` |
| a new rule opening an ordered item | `1. ---` |
| a new rule in a quote | `> ---` |
| a new rule in a column | `::: columns` / `---` / `\|\|\|` / `x` / `:::` |
| an item holding a new rule, then a nested list | `-` / `  ---` / (blank) / `  - n` |

`itemBlockKinds`
([markdownSerializer.ts:3577](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L3577))
counts a node that is no element as inline text; it counts a rule as a
block, which keeps an item holding a rule loose, as the save writes it.

### A rule stands as a block wherever the editor sorts blocks from text

The writable-state rules tell a block from inline content by `$isBlock`
([markdownWritable.ts:204](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L204)),
an element that is not inline. A rule is no element, so these rules put it in
a paragraph, keep it inside a paragraph, or drop it from a table cell's text.
The prototype found each one (*Addendum: Prototype*). A new exported
`$standsAsBlock(node)`, `$isBlock(node) || $isMarkdownHorizontalRuleNode(node)`,
takes `$isBlock`'s place where blocks are sorted from text; `$isBlock`
itself, whose callers read the node as an element, stays as it is.

| Site | File:line | Change |
|---|---|---|
| `$wrapInlineRuns` | [markdownWritable.ts:290](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L290) | a rule straight in a list item or a quote ends a run and is no part of one; without this a loaded `- a` / `  ___` became `item(text("a"), paragraph(rule))` and saved without its rule |
| `$takeBlocksOutOf` | [:172](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L172) | a rule inside a paragraph, heading, item text, code block or raw block moves out to follow it, as any block does |
| `$keepCellParagraphs` | [:744](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L744) | a rule in a table cell, or a cell paragraph holding rules alone, goes, and so does an empty paragraph right after a rule standing straight in the cell (the half Lexical's insert split off); the cell's text stays as it was |
| `$cellLines` | [:770](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L770) | a rule in a block written into a cell writes no line |
| `$dropUnwritableBreaks` | [:2308](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L2308) | `!$isBlock(child)` becomes `!$standsAsBlock(child)` |
| `$showRawBlocksBeforeAsWritten` | [:1373](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1373) | a rule writes something, so it ends the reach |
| `itemBlockKinds` | [markdownSerializer.ts:3582](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L3582) | as above |
| `$isPastedBlock` | [MarkdownEditor.ts:1423](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1423) | already counts a block decorator; unchanged |

### Selecting and deleting a rule

These are Lexical's own (`registerRichText` and `RangeSelection.deleteCharacter`
in 0.49), run through the editor's listeners on the prototype:

| Document | Selection | Key | Result |
|---|---|---|---|
| `a` / (blank) / `---` / (blank) / `b` | caret at `b`@0 | Backspace (key or `DELETE_CHARACTER_COMMAND`) | `a` / (blank) / `b`, the caret at `b`@0 |
| same | caret at `a`@1 | Delete | `a` / (blank) / `b`, the caret at `a`@1 |
| `a` / (blank) / `---` / (blank) / an empty paragraph | caret in the empty paragraph | Backspace | the paragraph goes, the rule is selected |
| same, the rule selected | node selection | Backspace or Delete | `a`; one undo brings the rule back, selected |
| `a` / (blank) / `---` / (blank) / `b` | caret at `b`@0 | ArrowLeft | the rule is selected |
| same | caret at `a`@1 | ArrowRight | the rule is selected |
| same, the rule selected | node selection | ArrowLeft or ArrowUp | the caret at the end of `a` |
| same, the rule selected | node selection | ArrowRight or ArrowDown | the caret at the start of `b` |
| same, the rule selected | node selection | Enter | an empty paragraph after the rule; the caret at `b`@0 |
| same, the rule selected | node selection | a typed character | nothing changes |
| `a1` / (blank) / `---` / (blank) / `b1` | `a1`@1 to `b1`@1 | Delete; typing `Z`; Enter | `a1`; `aZ1`; `a` / (blank) / `1` |
| `- a` / (blank) / `  ---` / (blank) / `  b` | caret at `b`@0 | Backspace | `- a` / (blank) / `  b` |
| `> a` / `>` / `> ---` / `>` / `> b` | caret at `b`@0 | Backspace | `> a` / `>` / `> b` |
| `-` / `  ---` / (blank) / `  b` | caret at `b`@0 | Backspace | `- b` |
| `::: columns` / `---` / (blank) / `b` / `\|\|\|` / `x` / `:::` | caret at `b`@0 | Backspace | `::: columns` / `b` / `\|\|\|` / `x` / `:::` |

A click on a rule selects it. Lexical leaves that to its
`HorizontalRuleExtension`, which the editor does not use, so
`registerHorizontalRuleSelection` registers a `CLICK_COMMAND` listener at
`COMMAND_PRIORITY_LOW`: when the click's target resolves
(`$getNearestNodeFromDOMNode`) to a rule, the rule becomes the only node of a
new node selection and the listener returns `true`. The listener mirrors the
extension's, without its Shift-click toggle.[^click]

### A deletion beside a list or quote that ends or opens with a rule

Lexical walks into a list or a quote to find what a deletion at a block's
edge acts on, and stops at a rule there without deleting it: Backspace at the
start of `b` after `- a` / (blank) / `  ---` left the document as it was and
moved the caret into the item. A new listener,
`$deleteHorizontalRuleBesideContainer(isBackward)`, on
`DELETE_CHARACTER_COMMAND` at `COMMAND_PRIORITY_LOW`, registered in
`registerListItemRules` beside `$backspaceAfterContainer`
([MarkdownEditor.ts:5572](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5572)),
does what Lexical does beside a top-level rule. It walks as
`$containerEndingBefore`
([:5371](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5371))
walks, into lists, list items and quotes, backward through last children and
forward through first children; when the walk entered a container and ends on
a rule, the rule goes, or, when the caret's block is empty, that block goes and
the rule is selected.

| Document | Caret | Key | Result |
|---|---|---|---|
| `- a` / (blank) / `  ---` / (blank) / `b` | `b`@0 | Backspace | `- a` / (blank) / `b` |
| `> a` / `>` / `> ---` / (blank) / `b` | `b`@0 | Backspace | `> a` / (blank) / `b` |
| `a` / (blank) / `- ***` / `- b` | `a`@1 | Delete | `a` / (blank) / `-` / `- b` (the emptied item keeps an empty text, as any item does) |
| `a` / (blank) / `> ---` / `>` / `> b` | `a`@1 | Delete | `a` / (blank) / `> b` |
| `- a` / (blank) / `  ---` / (blank) / an empty paragraph | in it | Backspace | the paragraph goes, the rule is selected |

### A range end beside a rule takes the rule

A range can start right before a rule or end right after one only as an
element point on the rule's parent: what Select All makes in a document that
opens or ends with a rule. The editor's settling moves such a point into the
next block of text and Lexical's removal then left the rule: Select All and
Delete in `---` / (blank) / `- x` / `  > q` saved `---`. The range guards'
`guard` wrapper
([MarkdownEditor.ts:5807](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5807))
and `$settleSelectionBeforeEnter`
([:5763](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5763))
first call a new `$removeHorizontalRulesAtRangeEnds(selection)`, then settle as
today. It removes, from a range that is not collapsed, each rule that stands
right after an element point that starts the range and right before one that
ends it. Lexical moves the points as each rule goes. When that leaves the range
collapsed, the deletion is done: the guards of the six deleting commands
(`$deleteCharacterOverGuardedRange`, `$deleteGuardedRange` and the two key
guards) return `true`; the others insert at the caret as usual.[^edge-rules]

A cut copies before it removes, so it takes the rules later. The `guard`
wrapper leaves a cut of a range beside a rule alone: no removal, no settling.
`$isGuardedRange`
([MarkdownEditor.ts:2845](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2845))
gains the shape — a range whose start is an element point right before a
rule, or whose end one right after a rule (`$standsBesideHorizontalRule`) —
so `$cutGuardedRange`
([:3500](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3500))
takes such a cut: it copies the range whole, the rules with it, and its
removal update first removes the edge rules and settles, then removes the
rest as today. `cut()`'s update does the same after its copy. The two inserts
that replace a range, `insertImage` and `insertHorizontalRule`, remove the edge
rules first too; `insertTable`, which keeps the range's content, does not.

| Document | Select All, then | Result |
|---|---|---|
| `---` / (blank) / `- x` / `  > q` | Delete; typing `Z`; Enter | empty; `Z`; empty |
| `---` / (blank) / `ab` | Delete; typing `Z` | empty; `Z` |
| `ab` / (blank) / `---` | Delete; typing `Z` | empty; `Z` |
| `---` | Delete; typing `Z` | empty; `Z` |
| `---` / (blank) / a table `h` / `c` | Delete | the table emptied, as Select All and Delete leave a document of that table alone |
| `---` / (blank) / `ab` | Ctrl+X (`CUT_COMMAND`); `cut()` | empty; the clipboard holds the rule and `ab` |
| `---` / (blank) / `ab` | `insertImage('/i.png')` | the image alone, in a paragraph |

`$settleSelectionOffContainers`
([:2385](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2385))
is not changed: `insertTable` calls it on a range whose content it keeps, so
removing a rule there would be wrong.

### `insertHorizontalRule()` places a rule as `insertTable` places a table

`insertHorizontalRule(): this` copies `insertTable`'s WYSIWYG update
([MarkdownEditor.ts:10092](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L10092))
line for line: the read-only refusal and the availability check through
`commandApplies("canInsertHorizontalRule")`, the table-edge range removed
first, a document's end without a range selection, the decline when the
settled point lands where no block goes, and `$insertHorizontalRuleAt(focus)`
in place of `$insertTableAt`. `$insertHorizontalRuleAt` mirrors `$insertTableAt`
([:6136](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L6136)):
`$insertBlockToNearestHolderAtCaret` places the rule (the caret's block split
only where both halves hold something, a quote holding the rule), an empty
paragraph follows a rule that ends its container, and the caret goes to the
start of the block after the rule. It is one update, so one undo step. The
command also removes a range that is not collapsed first, as a typed
character would (`selection.removeText()` after the table-edge case).[^insert]

With a rule selected, the three inserts — `insertHorizontalRule`,
`insertTable` and `insertImage` — first turn the node selection into a caret
right after the rule (`rule.selectNext()`), as Lexical's Enter does, so the
new block goes after the selected rule.

| Document | Caret | After |
|---|---|---|
| `ab` | `ab`@2 | `ab` / (blank) / `---`; the caret in an empty paragraph after the rule |
| `ab` | `ab`@1 | `a` / (blank) / `---` / (blank) / `b`; the caret at `b`@0 |
| `ab` | `ab`@0 | `---` / (blank) / `ab`; the caret at `ab`@0 |
| `ab` / (blank) / `cd` | `ab`@2 | `ab` / (blank) / `---` / (blank) / `cd`; the caret at `cd`@0 |
| `> ab` | `ab`@1 | `> a` / `>` / `> ---` / `>` / `> b` |
| `> ab` | `ab`@2 | `> ab` / `>` / `> ---`; the caret in an empty paragraph of the quote |
| `- ab` / `- z` | `ab`@1 | `- a` / (blank) / `---` / (blank) / `- b` / `- z`, as `insertTable` splits the list |
| `::: columns` / `ab` / `\|\|\|` / `x` / `:::` | `ab`@2 | `::: columns` / `ab` / (blank) / `---` / `\|\|\|` / `x` / `:::` |
| `# ab` | `ab`@1 | `# a` / (blank) / `---` / (blank) / `# b` |
| a table, a code block, a raw block | in it | nothing; `canInsertHorizontalRule` is `false` |
| empty | none | `---`; the caret in an empty paragraph |
| `a` / (blank) / `---` / (blank) / `b`, the rule selected | node selection | `a` / (blank) / `---` / (blank) / `---` / (blank) / `b`; the caret at `b`@0 |
| `abc` / (blank) / `def` | `abc`@1 to `def`@2 | `a` / (blank) / `---` / (blank) / `f` |

`canInsertHorizontalRule` is computed by `$tableInsertApplies`
([:6229](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L6229)),
the table's test, because a rule goes exactly where a table goes: nowhere in
a raw block, a code block or a table cell. With a rule selected,
`canInsertTable`, `canInsertImage` and `canInsertHorizontalRule` are `true`,
since the inserts then go after the rule.

### Toolbar and menu entries

A **Horizontal rule** entry follows **Image…** in the two places Table and
Image… live: the empty-line context menu's Insert submenu
(`buildEmptyLineContextMenuItems`,
[MarkdownEditor.ts:11237](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L11237))
and `MarkdownDocumentPanel`'s Insert dropdown (`buildInsertMenuItems`,
[MarkdownDocumentPanel.ts:319](../packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L319)).
Each is enabled on `canInsertHorizontalRule` and calls
`insertHorizontalRule()`.

A right-click on a rule shows the text menu for the selection, as a
right-click elsewhere does. Its Cut and Copy act on a selected rule: `copy()`
writes the rule's Markdown line as text, `cut()` also removes the rule, and
`hasSelectedText` (in the context menu target and in the selection state) is
`true` while a rule is selected. Every format, link and block-type entry is
dimmed then, since a node selection is no range.[^context-menu]

### The typing shortcut: `---`, `***` or `___`, then a space or Enter

A new `HORIZONTAL_RULE_SHORTCUT: ElementTransformer` in
`markdownTransformers.ts` joins `SHORTCUT_TRANSFORMERS`
([markdownTransformers.ts:49](../packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts#L49))
after `CODE`. Its `regExp` is `/^(?:-{3,}|\*{3,}|_{3,})\s?$/` and
`triggerOnEnter` is `true`, so it fires on the space after the marker and on
Enter at its end, through both of Lexical's paths and through
`registerHeldBlockShortcuts`
([MarkdownEditor.ts:5204](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5204)),
which runs every element shortcut of `SHORTCUT_TRANSFORMERS` in the paragraphs
of quotes and in list items' further paragraphs. Nothing in the shortcut
machinery changes.[^shortcut]

`replace(block, children, match)` returns `false`, applying nothing, unless the
block is a paragraph that is no list item's text and stands in no table cell.
Otherwise it inserts a rule holding `match[0].trim()` before the block, leaves
the block holding `children` (nothing, when the marker was all its text), and
puts the caret at the block's start. One undo leaves the characters as typed.

| Document | Typed | After |
|---|---|---|
| `x` / (blank) / `---` (a paragraph) | a space at its end | `x` / (blank) / `---`, a rule; the caret in the empty paragraph after it |
| same | Enter at its end | the same; one undo gives back the paragraph `---` |
| a paragraph `***` / `___` / `----` | a space | a rule holding `***` / `___` / `----` |
| `> a` / `>` / `> ---` | a space | `> a` / `>` / `> ---`, a rule in the quote |
| `- a` / (blank) / `  ***` | a space | a rule in the item |
| `::: columns` / `---` / `\|\|\|` / `x` / `:::` | a space | a rule in the column |
| a heading `---`; an item's text `---`; a table cell `---` | a space | text, no rule |
| a raw block, a code block | a space | text (no shortcut applies there) |

The spaced forms (`- - -`, `* * *`) are not shortcuts: `- ` and `* ` start a
list first.

### Block types, list toggles, the quote command and joins next to a rule

A rule is no block of text (`$isBlockOfText` asks for an element,
[MarkdownEditor.ts:4264](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4264)),
so a block type, a list toggle and the quote command act on the blocks of
text the selection touches and leave a rule where it stands, as they leave a
table. Nothing changes in their code.

| Document | Selection | Command | After |
|---|---|---|---|
| `a` / (blank) / `---` / (blank) / `b` | `a` to `b` | `toggleUnorderedList()` | `- a` / (blank) / `---` / (blank) / `- b` |
| same | same | `setBlockType("h2")` | `## a` / (blank) / `---` / (blank) / `## b` |
| same | same | `setBlockType("quote")` | `> a` / (blank) / `---` / (blank) / `> b` |
| same | same | `setBlockType("code")` | two code blocks, the rule between them |
| `- a` / (blank) / `  ---` / (blank) / `  b` | caret in `a` | `toggleUnorderedList()` | `a` / (blank) / `---` / (blank) / `b`: the rule follows the text out of the list, with the item's other blocks |

A join never reaches into a rule: Backspace and Delete beside one remove it
(*Selecting and deleting a rule*), and a range over one removes it whole.

### Paste and copy

A rule copied in the editor travels as Lexical nodes, its state with it. A
`<hr>` pasted as HTML is built by the node's `importDOM`, as Lexical's
legacy conversions build every registered node; `@lexical/html`'s own `<hr>`
rule asks for Lexical's `HorizontalRuleNode`, which is not registered, and
passes the element on.

| Pasted | At | After |
|---|---|---|
| a rule | `bc`@1 | `b` / (blank) / `---` / (blank) / `c` |
| a rule | `- a` / `- b`, `a`@1 | `- a` / (blank) / `  ---` / (blank) / `- b`: the rule ends the item, and no empty item is left |
| a rule | `- ab` / `- z`, `ab`@1 | `- a` / (blank) / `  ---` / (blank) / `- b` / (blank) / `- z` |
| a rule | `> a`, `a`@1 | `> a` / `>` / `> ---` |
| a rule | a table cell `c`@1 | the cell unchanged |
| `<p>a</p><hr><p>b</p>` | an empty document | `a` / (blank) / `---` / (blank) / `b` |
| `<ul><li>a<hr>b</li></ul>` | same | `list(item(text("a"), rule, paragraph("b")))` |
| `<table><tr><td>a<hr>b</td></tr></table>` | same | a cell of the paragraphs `a` and `b` |

The second row needs code: Lexical's insert at the end of an item's text,
with a decorator as the paste's last node, split the item and left an empty
item after it, saved `-`. `$splitItemBeforePasteEndingInTableOrFence`
([MarkdownEditor.ts:1714](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1714))
takes the case: for a paste whose last node is a rule, at an item's text with
nothing after the caret, it inserts the nodes itself, removes the empty item
the insert left right after the caret's item, and returns `true`. A paste
ending in a rule with text after the caret is left to Lexical (third row),
which keeps that text an item of its own, as after a pasted table. The caret
Lexical leaves after a pasted rule that ends its container stands between
blocks, where typing, Enter and a paste open a paragraph, as beside a
table.[^paste]

The plain text a copy writes holds a line end where a rule stood
(`getTextContent()` is `"\n"`, Lexical's choice for its own rule).

### Source mode

Since `markdown-source-mode-commands-through-model`, most source-mode commands
run the WYSIWYG command on a short-lived model of the Markdown around the
selection — the *pass* — and place the source selection in that model through
the source places (`markdownSourcePlaces.ts`), which match what a block shows,
unit by unit, to the source each unit came from.

**A rule's line.** The source places treat a rule as one shown unit whose
source is its line: `$shownUnits`
([markdownSourcePlaces.ts:639](../packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts#L639))
already gives the rule a unit, as it gives an image one, and
`locateBlockEntry`
([:867](../packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts#L867))
gives that unit the `hr` entry's span, as it gives a task checkbox its own.
Without that, the match stopped at a rule and every source-mode command
declined in a block holding one (rows `M27` to `M37` of
`markdown-editor.test.ts` failed on the prototype until it was added). An
offset inside the rule's line is before the rule, and its line end after it,
as for any unit shown whole.

**A caret on a rule's line selects the rule.** `$selectSourceRange`
([markdownSourceModel.ts:375](../packages/lib/src/typescript/lib/component/editor/markdownSourceModel.ts#L375))
gives a collapsed source caret on a rule's line (from its first character to
its line end) a node selection of that rule, as a click gives one on the
WYSIWYG surface, through a new `$horizontalRuleAtSourceOffset` in the places
module. A command then does what it does with the rule selected: every format,
link and block command declines, since none applies to a node selection, and
`insertImage` puts its image after the rule. A range whose ends lie on rule
lines is placed as today.[^caret-on-rule]

| Document | Source selection | Command | Source mode after |
|---|---|---|---|
| `one` / (blank) / `---` / (blank) / `two` | caret on the `---` line | `toggleUnorderedList()`, `setBlockType("h2")`, `toggleBold()` | nothing |
| `- a` / (blank) / `  ---` / (blank) / `  b` | caret on the `---` line | `setBlockType("h2")` | nothing (the prototype without this rule took `a` out of its list as a heading) |
| `one` / (blank) / `---` / (blank) / `two` | `one`@1 to `two`@1 | `toggleUnorderedList()` | `- one` / (blank) / `---` / (blank) / `- two` |

**`insertHorizontalRule()` is text surgery, as `insertTable` is.** In source
mode the command goes through `editSource(horizontalRuleSource())`, as
`insertTable` goes through `editSource(tableSource(…))`
([MarkdownEditor.ts:10093](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L10093)).
`horizontalRuleSource()` in `markdownSourceLines.ts` uses `tableSource`'s
insertion line (`tableInsertionLine`,
[markdownSourceLines.ts:312](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L312)):
above the block holding the caret's line, the quote or list around it when the
block is its first, a blank line before the rule unless the line above is
blank or the rule lands at the document's start, and a blank line after it.
It declines where `tableSource` declines, and when the result does not read as
the same blocks with one more rule (`addsOneHorizontalRule`, after
`addsOneTable`, [:398](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L398)).
The caret keeps its character: the selection moves down by what was
inserted.[^surgery]

| Source | Caret | After |
|---|---|---|
| `one` / (blank) / `two` | in `two` | `one` / (blank) / `---` / (blank) / `two`, the caret on the same character of `two` |
| `abc` | in `abc` | `---` / (blank) / `abc` |
| `- a` / (blank) / `- b` | on the blank line | nothing (the rule would split the list) |
| `> a` / `>` / `> b` | on `> b` | nothing (past the quote's first block) |
| `::: columns` / `a` / (blank) / `b` / `\|\|\|` / `c` / `:::` | in `b` | `::: columns` / `a` / (blank) / `---` / (blank) / `b` / `\|\|\|` / `c` / `:::` |

`canInsertHorizontalRule` is `true` in source mode, as `canInsertTable` is.

**Highlighting.** The source surface's Markdown language already parses a
thematic break as `HorizontalRule` and tags it `contentSeparator`, which the
editor theme mutes ([theme.ts:266](../packages/lib/src/typescript/lib/component/editor/theme.ts#L266)).
Nothing changes; a row pins it.

### What becomes dead or changes

- **The raw block for a thematic break.** No load builds one, and a raw block
  edited into a thematic break shows as a rule. `MarkdownRawBlockNode`'s
  JSDoc ([markdownSourceNodes.ts:197](../packages/lib/src/typescript/lib/component/editor/markdownSourceNodes.ts#L197))
  drops "a thematic break" from its list. The serializer's thematic-break code
  stays, because it now serves the rule: `THEMATIC_BREAK`
  ([markdownSerializer.ts:61](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L61)),
  `UNDER_TEXT_BULLET`, `SETEXT_H2_UNDERLINE` and the escapes that keep text
  from reading as a break (`leanLineStartEscaped`, [:7495](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L7495)).
  Only the comments at [:3202](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L3202),
  [:3251](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L3251)
  and [:3728](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L3728)
  change "raw thematic break" to "thematic break".
- **`SOURCE_KEPT_TYPES`** keeps `"hr"`; its comment names the rule's state as
  the reason (see *A loaded rule keeps its line*).
- **The source-mode decline on a raw block** no longer covers a thematic
  break: a selection over one is acted on (the last row of the source-mode
  table above).
- **The viewer's fallback** no longer covers a thematic break; it covers raw
  HTML and the task-list markers.
- **The owner's known-issues list** has three entries whose examples start a
  range in a raw `***`. Each example now starts in a rule, which no join
  enters. Each was run on the prototype with the raw block `<div></div>` in
  place of `***`, and each still shows; the entry is restated with it.

| Entry | Example today | Restated example | Verdict |
|---|---|---|---|
| (four-fixes round 2) the editor shows a leading space a save drops | `***` / (blank) / `x`, a tab, `# y`; Delete from `***` to after `x` | `<div></div>` / (blank) / `x`, a tab, `# y`; Delete from `<div></div>`@0 to after `x`: shows ` # y`, saves `\# y` | stays; add that a range from before a rule to after `x` shows the paragraph opening with the tab (`\t# y`), the same cause |
| (four-fixes round 3) a later raw block's rest makes a heading or code block | `***` / (blank) / `- x    y` / `  > q`, Delete from `***`@0 to after `- x` | `<div></div>` / (blank) / `- x    y` / `  > q`: a code block `y`; `- x # y` ending after `- x `: a heading | stays |
| (four-fixes round 3) trailing spaces after an image | `***` / (blank) / `x    ![i](/u.png)`, Delete from `***` to after `x` | `<div></div>` / (blank) / `x    ![i](/u.png)`, Delete from `<div></div>`@0 to after `x`: shows four spaces after the image | stays |

No other entry involves a thematic break.

### Tests that are restated

Two groups of rows used `***`, `---` or `___` as a raw block. Each row is
restated so it keeps testing what it tested.

- **Rows about a raw block** use another one-line raw block, `<div></div>`, or a
  raw list where the row needs a raw block's first characters. On the
  prototype every restated row passes with its expected value unchanged
  (*Addendum: Prototype*).
- **Rows about a block of a list item or of a quote** keep `---`, which now
  loads as a rule, and their shapes name `markdown-horizontal-rule`: the row
  tested that an item's blocks follow in order, and a rule is such a block.

The table under *Expected Behaviour*, *Tests that are restated*, lists every
row.

---

## Public API

`MarkdownEditor` (`component/editor/MarkdownEditor.ts`):

```ts
/** Inserts a horizontal rule at the caret, as insertTable places a table; see the JSDoc for the full contract. */
insertHorizontalRule(): this;
```

`MarkdownEditorSelectionState` and `CommandAvailability` gain:

```ts
/**
 * Whether `insertHorizontalRule` would insert. `false` where `canInsertTable` is: when the selection touches a raw
 * Markdown block or a code block, or lies inside a table; without a text selection, when the document ends in one of
 * those. `true` while a rule is selected. Always `true` in `"source"` mode, and before the editor is built.
 */
canInsertHorizontalRule: boolean;
```

`ReportedAvailability` picks the field by its name. `reportedAvailability`,
`NEUTRAL_SELECTION_STATE` (`true`), `NO_COMMAND_APPLIES` (`false`) and the
source-mode state (`true`) each name it beside `canInsertTable`
([MarkdownEditor.ts:7132](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7132),
[:7192](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7192),
[:7208](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7208),
[:8987](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L8987)).

`MarkdownHorizontalRuleNode`, its functions and `horizontalRuleMarkerState`
are internal, as `MarkdownImageNode` is, and are not re-exported from
`component/editor/index.ts`.

---

## Internal Structure

Write full JSDoc on every new symbol, as the code conventions ask; the
comments below are shortened. The prototype's diff
(`scratch-keep/plans6/horizontal-rules/prototype-src.diff`) is a reference,
not a patch: its names are shorter (`MarkdownRuleNode`, `RULE_SHORTCUT`) and
it carries test hooks.

### `markdownHorizontalRuleNode.ts`

```ts
import { $getState, $setState, DecoratorNode } from "lexical";
import type { DOMConversionMap, EditorConfig, LexicalNode, NodeKey, SerializedLexicalNode } from "lexical";
import { DOM } from "~/core/DOM.js";
import { horizontalRuleMarkerState } from "~/component/editor/markdownNodeState.js";

/** The line a rule made in the editor is written as. */
export const STANDARD_HORIZONTAL_RULE = "---";

export class MarkdownHorizontalRuleNode extends DecoratorNode<null> {
    static getType(): string;                                   // "markdown-horizontal-rule"
    static clone(node: MarkdownHorizontalRuleNode): MarkdownHorizontalRuleNode;   // new MarkdownHorizontalRuleNode(node.__key)
    static importJSON(json: SerializedLexicalNode): MarkdownHorizontalRuleNode;   // new …().updateFromJSON(json)
    static importDOM(): DOMConversionMap | null;                // { hr: () => ({ conversion: () => ({ node: $createMarkdownHorizontalRuleNode() }), priority: 0 }) }

    exportJSON(): SerializedLexicalNode;                        // { ...super.exportJSON(), type: "markdown-horizontal-rule", version: 1 }
    isInline(): false;
    decorate(): null;
    getTextContent(): string;                                   // "\n"
    createDOM(config: EditorConfig);                            // return type inferred, as MarkdownImageNode's; see below
    updateDOM(): true;
}

export function $createMarkdownHorizontalRuleNode(marker?: string): MarkdownHorizontalRuleNode;  // sets the state when marker is given and not ""
export function $isMarkdownHorizontalRuleNode(node: LexicalNode | null | undefined): node is MarkdownHorizontalRuleNode;
/** The line a save writes: the state, or STANDARD_HORIZONTAL_RULE. */
export function $horizontalRuleMarkdown(node: MarkdownHorizontalRuleNode): string;
```

`createDOM` is `MarkdownImageNode.createDOM`'s shape: the classes
`config.theme.mdHorizontalRule`, and `config.theme.mdHorizontalRuleSelected`
when `this.isSelected()`, minted with `DOM.sink.createViewElement("hr", { addClass }, keepElement)`,
throwing when no view is mounted. `createDOM`'s return type is left to
inference, as the image's is, so no DOM type is named (`no-raw-dom`).

### `markdownNodeState.ts`

```ts
/**
 * The line a horizontal rule was loaded or typed with, without indentation and without the blanks that end it
 * (`* * *`, `___`, `-` tab `-` tab `-`); `""` (the default) is a rule made in the editor, written `---`.
 */
export const horizontalRuleMarkerState: StateConfig<"mdHorizontalRule", string> = createState("mdHorizontalRule", {
    parse: (value) => (typeof value === "string" && THEMATIC_BREAK_LINE.test(value) ? value : ""),
});
```

`THEMATIC_BREAK_LINE = /^([-*_])(?:[ \t]*\1){2,}$/`, a module constant with a
comment naming CommonMark §4.1: `THEMATIC_BREAK` without the indentation and
the trailing blanks the state never holds.

### `markdownImporter.ts`

```ts
/** Builds a rule holding the line it was written with ({@link horizontalRuleMarkerState}). */
function $buildHorizontalRule(token: Tokens.Hr): MarkdownHorizontalRuleNode {
    return $createMarkdownHorizontalRuleNode(token.raw.trim());
}
```

### `markdownSerializer.ts`

- `serializeBlock`: `if ($isMarkdownHorizontalRuleNode(node)) { return $horizontalRuleMarkdown(node); }` before the raw-block case.
- `itemBlockKinds`: `const isInline = $isElementNode(child) ? child.isInline() : !$isMarkdownHorizontalRuleNode(child);`
  and `const writes = $isListNode(child) ? child.getChildrenSize() > 0 : $isMarkdownHorizontalRuleNode(child) || $writesSomething(child as ElementNode);`.

### `markdownWritable.ts`

```ts
/** Whether a node stands as a block among its siblings: an element that is not inline, or a horizontal rule. */
export function $standsAsBlock(node: LexicalNode): boolean {
    return $isBlock(node) || $isMarkdownHorizontalRuleNode(node);
}
```

In `$keepCellParagraphs`, ahead of the existing test, for each child:

```ts
const holdsRulesAlone = $isParagraphNode(child) && !child.isEmpty() && child.getChildren().every($isMarkdownHorizontalRuleNode);

if ($isMarkdownHorizontalRuleNode(child) || holdsRulesAlone) {
    const after = child.getNextSibling();

    // The half Lexical's insert split off after a pasted rule.
    if ($isMarkdownHorizontalRuleNode(child) && $isParagraphNode(after) && after.isEmpty()) {
        after.remove();
    }

    child.remove();

    continue;
}
```

and the existing `isTextParagraph` test uses `$standsAsBlock`. `$cellLines`
skips a rule (`flush()`, then nothing).

### `MarkdownEditor.ts`

```ts
/** CLICK_COMMAND listener: a click on a rule selects it. */
function $selectClickedHorizontalRule(event: MouseEvent): boolean;

/** Registers the click that selects a rule and the marks that redraw a rule whose selected state changed. */
function registerHorizontalRuleSelection(editor: LexicalEditor): () => void;

/** The rule a node selection holds, or null. */
function $selectedHorizontalRule(): MarkdownHorizontalRuleNode | null;

/** Turns a node selection of a rule into a caret right after it; called first by the three inserts. */
function $caretAfterSelectedHorizontalRule(): void;

/** DELETE_CHARACTER_COMMAND listener: a deletion beside a list or quote whose edge block is a rule acts on that rule. */
function $deleteHorizontalRuleBesideContainer(isBackward: boolean): boolean;

/** Removes the rules a range's element-point ends stand beside; returns whether the range is left collapsed. */
function $removeHorizontalRulesAtRangeEnds(selection: BaseSelection | null): boolean;

/** Whether a range starts right before a rule or ends right after one, at an element point. */
function $standsBesideHorizontalRule(selection: BaseSelection | null): selection is RangeSelection;

/** Inserts a rule at a point, as $insertTableAt inserts a table, and puts the caret at the start of the block after it. */
function $insertHorizontalRuleAt(point: PointType): void;
```

- `registerHorizontalRuleSelection` is
  `mergeRegister(editor.registerCommand(CLICK_COMMAND, $selectClickedHorizontalRule, COMMAND_PRIORITY_LOW), editor.registerUpdateListener(…))`.
  The update listener reads, in `prevEditorState` and `editorState`, the keys
  of the rules a node selection holds; when the two sets differ it runs
  `editor.update(() => { for each key still attached: node.markDirty(); }, { tag: HISTORY_MERGE_TAG })`.
  `$selectClickedHorizontalRule` returns `false` unless `isDOMNode(event.target)`
  and `$getNearestNodeFromDOMNode(event.target)` is a rule; then it sets a new
  node selection of that rule alone and returns `true`.
- `$removeHorizontalRulesAtRangeEnds`: for a range that is not collapsed, with
  `[start, end] = $orderedPoints(selection)`: while `start` is an element
  point whose child at `start.offset` is a rule, remove that rule; while `end`
  is an element point whose child at `end.offset - 1` is a rule, remove that
  rule. `remove()` moves the points itself; set nothing by hand. Return
  `selection.isCollapsed()` after the removals, and `false` when nothing was
  removed.
- `$standsBesideHorizontalRule(selection)`: a range that is not collapsed,
  whose start is an element point whose child at its offset is a rule, or
  whose end is an element point whose child before its offset is a rule.
  `$isGuardedRange` ORs it in last.
- The `guard` wrapper of `registerRangeGuards` becomes: when `command` is
  `CUT_COMMAND` and `$standsBesideHorizontalRule($getSelection())`, return
  `listener(payload, target)` at once. Otherwise
  `const emptied = $removeHorizontalRulesAtRangeEnds($getSelection());`,
  `$settleSelectionOffContainers($getSelection());`, then
  `return emptied && DELETING_COMMANDS.has(command) ? true : listener(payload, target);`,
  where `DELETING_COMMANDS` holds `KEY_BACKSPACE_COMMAND`, `KEY_DELETE_COMMAND`,
  `DELETE_CHARACTER_COMMAND`, `DELETE_WORD_COMMAND`, `DELETE_LINE_COMMAND` and
  `REMOVE_TEXT_COMMAND`. `$settleSelectionBeforeEnter` calls
  `$removeHorizontalRulesAtRangeEnds` before it settles.
- `$cutGuardedRange`'s removal update and `cut()`'s update call
  `$removeHorizontalRulesAtRangeEnds(selection)` and then
  `$settleSelectionOffContainers(selection)` before `$removeGuardedRange`.
  `insertImage` and `insertHorizontalRule` call `$removeHorizontalRulesAtRangeEnds`
  at the start of their update, after `$caretAfterSelectedHorizontalRule()`.
- `$deleteHorizontalRuleBesideContainer(isBackward)`: a collapsed range
  selection at the very start (backward) or the very end (forward) of its
  enclosing block (`$findEnclosingBlock`); from that block, climb while it has
  no sibling on that side and its parent is no root or shadow root; take the
  sibling on that side; while it is a list, a list item or a quote, take its
  last child (backward) or first child (forward), and remember that a
  container was entered. When one was entered and the node reached is a
  rule: an empty block is removed and the rule selected, else the rule is
  removed; return `true`. Otherwise `false`.
- `insertHorizontalRule`: `editSource(horizontalRuleSource())` first, then
  `commandApplies("canInsertHorizontalRule")`, then one discrete update:
  `$caretAfterSelectedHorizontalRule()` and `$removeHorizontalRulesAtRangeEnds($getSelection())`;
  then `insertTable`'s body with, after
  the table-edge case, `else if (hadRange && !initial.isCollapsed()) { initial.removeText(); }`,
  and `$insertHorizontalRuleAt(selection.focus)` in place of `$insertTableAt`.
  `insertTable` and `insertImage` call `$caretAfterSelectedHorizontalRule()` as
  the first line of their updates.
- `$readCommandAvailability`: `canInsertHorizontalRule: ruleSelected || $tableInsertApplies(touchesTextOnlyBlock)`,
  and `ruleSelected ||` before the table and image fields, where
  `ruleSelected = $selectedHorizontalRule() !== null`.
- `$splitItemBeforePasteEndingInTableOrFence`: `const endsInRule = $isMarkdownHorizontalRuleNode(payload.nodes.at(-1));`
  joins the entry test (`endsInTableOrFence || endsInRule`). After the range
  removal and the item-text check: when `endsInRule` and nothing follows the
  caret, `selection.insertNodes([...payload.nodes])`, then remove the next
  sibling of the caret's item when it is a list item holding one empty item
  text and nothing else, and return `true`. The split for text after the
  caret stays the table's and fence's alone (`holdsRestAfterCaret && endsInTableOrFence`).
- `$copiedSelectionText`: a selected rule gives `$horizontalRuleMarkdown(rule)`.
  `cut()`'s update removes a selected rule (`selection.deleteNodes()` for a
  node selection) after the copy.
- `hasSelectedText` in `$readSelectionState` and `$classifyContextMenuTarget`
  is also `true` when `$selectedHorizontalRule() !== null`.

### `markdownSourcePlaces.ts`

In `locateBlockEntry`, ahead of the checkbox case:

```ts
if (block.type === "hr") {
    const unit = walk.units[walk.at];

    if (unit !== undefined && $isMarkdownHorizontalRuleNode(unit.node) && block.start !== NOT_FOUND) {
        unit.start = block.start;
        unit.end = block.end;
        walk.at += 1;
    }

    return 0;
}
```

```ts
/** The rule whose line holds an offset of a block's Markdown, from its first character to its line end; null for none. */
export function $horizontalRuleAtSourceOffset(text: string, offset: number, block: LexicalNode, start: number, end: number): MarkdownHorizontalRuleNode | null;
```

It runs `$locatedWalk(text, block, start, end)` and returns the node of the
unit that is a rule with `unit.start <= offset - start` and `offset - start <= lineEndAt(source, unit.start)`.

### `markdownSourceModel.ts`

At the top of `$selectSourceRange`, after `spans` and before the range: when
`from === to` and `spans !== null`, take `span = spanHolding(spans, from)`;
when `$horizontalRuleAtSourceOffset(text, from, span.block, span.start, span.end)`
gives a rule, select it alone in a new node selection and return `true`.

### `markdownSourceLines.ts`

```ts
/** The source-mode insert of a horizontal rule: `---` above the block holding the caret, as tableSource places a table. */
export function horizontalRuleSource(): MarkdownSourceTransform;
```

The body is `tableSource`'s with `tableText` replaced by
`STANDARD_HORIZONTAL_RULE`, the selection set to
`{ from: from + insert.length, to: to + insert.length }`, and
`addsOneHorizontalRule` in place of `addsOneTable`: the leaves read as
before, and the analysis holds one more entry whose key is `hr`.

### `markdownTransformers.ts`

```ts
/** `---`, `***` or `___` (three or more), then a space or Enter, alone in a paragraph: a horizontal rule. */
export const HORIZONTAL_RULE_SHORTCUT: ElementTransformer = {
    dependencies: [],
    export:       () => null,
    regExp:       /^(?:-{3,}|\*{3,}|_{3,})\s?$/,
    replace:      (block, children, match): false | undefined => { … },   // see the decision
    triggerOnEnter: true,
    type:         "element",
};
```

`export` returns `null`: the editor saves through its own serializer, as every
other entry of `SHORTCUT_TRANSFORMERS` is only typed.

---

## Ordered Implementation Steps

Run commands from `packages/lib` unless a step says "repo root". Do not run
`npm install`. Run one Vitest process at a time, with `--maxWorkers=2` for a
large run. Work test-first inside each step. The suites of a step are
`npx vitest run --maxWorkers=2 tests/component/markdown-*.test.ts tests/component/markdown-roundtrip tests/component/display/`.

**Step 1 — the node and the viewer**

1. Tests first: create `tests/component/markdown-horizontal-rule-node.test.ts`
   (node rows) and `tests/component/markdown-horizontal-rule-node-html.test.ts`
   (HTML rows, `@vitest-environment jsdom`, no `installTestDOM`, as
   `markdown-quote-node-html.test.ts`), and add the viewer rows to
   `tests/component/display/Markdown.test.ts` (*Expected Behaviour*, *The
   node* and *The viewer*).
2. `markdownNodeState.ts`: `horizontalRuleMarkerState`.
3. Create `markdownHorizontalRuleNode.ts`; add it to `EDITOR_NODES` and its
   JSDoc in `editorNodes.ts`.
4. `editorTheme.ts`: the two classes, their rules and the two theme keys.
5. `Markdown.ts`: `HORIZONTAL_RULE_CLASS`, its class rule, the `"hr"` case, and
   the class JSDoc that lists the fallback's token types
   ([:576](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L576)).
   Check: `npm run typecheck` (repo root).

**Step 2 — the switch: load, save, the writable rules**

This step cannot be cut into green halves: once the importer builds the node,
the serializer, the writable rules and the round-trip harness must all read
it.

6. Tests first: create `tests/component/markdown-editor-horizontal-rules.test.ts`
   with the harness of `markdown-editor-quotes.test.ts` (copied: `lexicalOf`,
   `load`, `$textNode`, `selectText`, `press`, `shapeOf`,
   `expectSaveKeepsDocument`, `runRow`) and the load, save, placement and
   preservation rows. Apply *Tests that are restated* except the source-mode
   rows. Run the suites and keep the list of failures.
7. `markdownImporter.ts`: `$buildHorizontalRule`, the `"hr"` case,
   `HELD_BLOCK_TYPES`.
8. `markdownSerializer.ts`: `serializeBlock`, `itemBlockKinds`, the three
   comments.
9. `markdownWritable.ts`: `$standsAsBlock` and the six sites of *A rule stands
   as a block*.
10. `tests/component/markdown-roundtrip/viewModel.ts`: `Block` gains
    `{ kind: 'rule' }`; `viewerBlock`'s `'hr'` case and `editorBlock`'s rule
    branch return it; `blockOutline` writes `rule`.
11. `markdownTabs.ts`: the `SOURCE_KEPT_TYPES` comment. `markdownSourceNodes.ts`:
    the `MarkdownRawBlockNode` JSDoc.
12. Run the suites. What fails now is the editing, command, paste and source
    rows.

**Step 3 — selecting, deleting, ranges**

13. `MarkdownEditor.ts`: `registerHorizontalRuleSelection` and its call in
    `registerEditorRules`; `$deleteHorizontalRuleBesideContainer` and its
    registration; `$removeHorizontalRulesAtRangeEnds`,
    `$standsBesideHorizontalRule` and their callers in the `guard` wrapper,
    `$settleSelectionBeforeEnter`, `$isGuardedRange`, `$cutGuardedRange` and
    `cut()` (the callers in `insertImage` and `insertHorizontalRule` come with
    step 15).
14. Add the editing, deletion and Select All rows; run the suites.

**Step 4 — the command, the menus, the shortcut, paste**

15. `MarkdownEditor.ts`: `insertHorizontalRule`, `$insertHorizontalRuleAt`,
    `$selectedHorizontalRule`, `$caretAfterSelectedHorizontalRule` in the three
    inserts, the availability field everywhere *Public API* names it, the
    context menu entry, `hasSelectedText`, `copy()` / `cut()`, and the paste
    case of `$splitItemBeforePasteEndingInTableOrFence`.
16. `MarkdownDocumentPanel.ts`: the Insert dropdown entry.
17. `markdownTransformers.ts`: `HORIZONTAL_RULE_SHORTCUT`.
18. Add the command, menu, shortcut and paste rows; run the suites and
    `tests/component/markdown-document-panel.test.ts`.

**Step 5 — source mode**

19. `markdownSourcePlaces.ts`: the `"hr"` case and
    `$horizontalRuleAtSourceOffset`. `markdownSourceModel.ts`: the node selection
    in `$selectSourceRange`. `markdownSourceLines.ts`: `horizontalRuleSource`
    and `addsOneHorizontalRule`.
20. Add the source-mode rows and apply the source-mode rows of *Tests that are
    restated*; run the suites and `tests/component/code-editor.test.ts`.
21. Checkpoints:
    - `grep -rn 'raw thematic break' src/` — no match.
    - `grep -rn 'markdown-raw-block("---")\|markdown-raw-block("\*\*\*")' tests/` — no match.
    - `grep -rn "\['\*\*\*', [0-9]\]" tests/component/markdown-editor-command-crashes.test.ts` — no match.

**Step 6 — docs, known issues, full checks**

22. *Documentation Impact*. Then restate the three known-issue entries of
    *What becomes dead or changes*.
23. *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/editor/markdownHorizontalRuleNode.ts` |
| Create | `packages/lib/tests/component/markdown-horizontal-rule-node.test.ts` |
| Create | `packages/lib/tests/component/markdown-horizontal-rule-node-html.test.ts` |
| Create | `packages/lib/tests/component/markdown-editor-horizontal-rules.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorNodes.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownNodeState.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownImporter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceNodes.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceModel.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownTabs.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/viewModel.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/commonmark.ts`, `corpus/dialect.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-view-model.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-edit-fuzz.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-nested-edit-fuzz.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-command-crashes.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-list-item-edits.test.ts` |
| Modify | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-typing-shortcuts.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-table-commands.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-nested-source-preservation.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-mode-through-model.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-places.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-edits.test.ts` |
| Modify | `packages/lib/tests/component/markdown-document-panel.test.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/components/MarkdownDocumentPanel.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |
| Modify (outside the repository) | `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/known-issues-2026-10.md` (step 22) |

---

## Expected Behaviour

Every row is testable offline unless it stands under *Manual (browser)
checks*. `/` separates lines of a source or a save; `x@n` is offset `n` in the
text node whose text is exactly `x`; `rule` in a shape is
`markdown-horizontal-rule`. `Backspace` and `Delete` are
`DELETE_CHARACTER_COMMAND`, `Backspace key` is `KEY_BACKSPACE_COMMAND`, as in
`markdown-editor-list-item-edits.test.ts`. The arrow keys, Enter and the
Backspace key on a node selection are their `KEY_…_COMMAND`s with a stand-in
event, which reach Lexical's handlers headless (the prototype ran each). Every
row with steps in `markdown-editor-horizontal-rules.test.ts` runs that file's
`expectSaveKeepsDocument` after the load and after each step. The rows' names
are their first column.

### The node (`markdown-horizontal-rule-node.test.ts`)

| Row | Check |
|---|---|
| a rule survives a JSON round trip with its line | load `***`, `parseEditorState(JSON.stringify(state.toJSON()))` into a second editor: one `markdown-horizontal-rule` whose state is `***` |
| a rule made in the editor has no state | `$createMarkdownHorizontalRuleNode()`: state `""`, `$horizontalRuleMarkdown` gives `---` |
| the state holds a thematic break line only | `$setState(rule, horizontalRuleMarkerState, x)` for `  ---`, `-- -x`, `--` gives `""`; for `* * *`, `-\t-\t-` gives the value |
| a rule is a block that shows a line end | `isInline()` is `false`; `getTextContent()` is `"\n"` |

### The node's HTML (`markdown-horizontal-rule-node-html.test.ts`)

| Row | HTML or check | Result |
|---|---|---|
| an `<hr>` between paragraphs | `<p>a</p><hr><p>b</p>` through `$generateNodesFromDOM` | `paragraph("a") \| rule \| paragraph("b")` |
| an `<hr>` alone | `<hr>` | `rule`, state `""` |
| an `<hr>` in a list item | `<ul><li>a<hr>b</li></ul>` | `list(item(text("a"), rule, paragraph("b")))` |
| an `<hr>` in a quote | `<blockquote><p>a</p><hr></blockquote>` | `markdown-quote(paragraph("a"), rule)` |
| an `<hr>` in a table cell | `<table><tr><td>a<hr>b</td></tr></table>` | a cell of `paragraph("a"), paragraph("b")` |
| a copied rule leaves as `<hr>` | `$generateHtmlFromNodes` of `a` / `***` / `b` | holds `<hr class="ts-ui-mde-horizontal-rule">` |
| a selected rule is drawn selected | a mounted root, the rule selected and marked dirty | the `<hr>` carries both classes; after a caret elsewhere, only the first |

### The viewer (`display/Markdown.test.ts`)

| Row | Source | Renders |
|---|---|---|
| renders a thematic break as a horizontal rule | `***` | one `hr` with the class `ts-ui-md-horizontal-rule`, no text node `***` |
| renders a rule in a list item, a quote and a column | `- a` / (blank) / `  ---`; `> ---`; `::: columns` / `---` / `\|\|\|` / `x` / `:::` | the `hr` inside the `li`, the `blockquote`, the column `div` |
| renders three thematic breaks as three rules, not a table | `***` / `---` / `___` | three `hr`, no `table` (restates BF4) |
| renders --- after a blockquote as a thematic break | `> Foo` / `---` | a `blockquote` and an `hr` (restates BF5) |
| renders --- after a blank line as a thematic break | `> - a` / `b` / (blank) / `---` | an `hr` (restates BF6) |

### Load and save (`markdown-editor-horizontal-rules.test.ts`)

| Row | Source | `shape` | `saved`; standard form |
|---|---|---|---|
| a rule between paragraphs | `a` / (blank) / `---` / (blank) / `b` | `paragraph("a") \| rule \| paragraph("b")` | the source; the same |
| a rule of stars | `***` | `rule` | `***`; `***` |
| an indented spaced rule | `  * * *  ` | `rule` | the source; `* * *` |
| a rule in a list item | `- a` / (blank) / `  ___` / `- b` | `list(item(text("a"), rule), item(text("b")))` | the source; `- a` / (blank) / `  ___` / (blank) / `- b` |
| a rule in a quote | `> a` / `>` / `> ---` | `markdown-quote(paragraph("a"), rule)` | the source; the same |
| a rule in a column | `::: columns` / `a` / `\|\|\|` / `---` / `:::` | `markdown-block(markdown-column(paragraph("a")), markdown-column(rule))` | the source; the same |
| a rule opening an item | `- ***` / `- b` | `list(item(rule), item(text("b")))` | the source; the same |
| a rule of dashes opening an item of a star list | `* ---` / `* b` | `list(item(rule), item(text("b")))` | the source; the same |
| a rule interrupting a paragraph | `a` / `***` / `b` | `paragraph("a") \| rule \| paragraph("b")` | the source; `a` / (blank) / `***` / (blank) / `b` |
| a rule between two lists | `- foo` / `***` / `- bar` | `list \| rule \| list` | the source |
| dashes under text stay a heading | `a` / `---` | `heading("a")` | the source |
| a rule of tabs | `*`, tab, `*`, tab, `*` | `rule` | the source |

**Every placement saves so that it reloads as shown.** A row builds, for each
line of `""` (a new rule), `***`, `___`, `- - -`, `* * *` and `-----`, and each
list kind (`-`, `*`, `+`, ordered), a document with the rule in each of these
places: opening an item; after an item's text; opening the first item of a
list nested right under an item's text; after an emptied item text; opening
the only item; before a nested list in its item. And, per line, alone, between
two paragraphs, between two lists of one marker, in a quote, between two
paragraphs of a quote, in a column, twice in a row, between paragraphs whose
text is `---` and `***`, and after an item's text and before its nested list.
For each (198 documents) the save, read by the viewer, equals the editor's
shape, the save reloads as the same shape, and saves again unchanged. The
saves of *How a rule is saved* are pinned by name.

### Preservation (`markdown-editor-nested-source-preservation.test.ts`, a new group *horizontal rules*)

| Row | Source | Edit | Saved |
|---|---|---|---|
| a rule's line in an edited item | `- a` / (blank) / `  * * *` / `- b` | `!` after `a` | `- a!` / (blank) / `  * * *` / (blank) / `- b` |
| a rule's meaningless indentation in an edited item | `- a` / (blank) / `     ***` / `- b` | `!` after `a` | `- a!` / (blank) / `  ***` / (blank) / `- b` |
| a rule's line in an edited quote | `> a` / `>` / `>   _ _ _` / `>` / `> b` | `!` after `b` | `> a` / `>` / `>   _ _ _` / `>` / `> b!` |
| a rule's line in an edited column | `::: columns` / `a` / (blank) / ` -  -  -` / `\|\|\|` / `x` / `:::` | `!` after `a` | `::: columns` / `a!` / (blank) / ` -  -  -` / `\|\|\|` / `x` / `:::` |
| a rule's tabs in an edited item | `- a` / (blank) / `  *`, tab, `*`, tab, `*` | bold on `a` | `- **a**` / (blank) / `  *`, tab, `*`, tab, `*` |
| an unedited item opening with a rule | `- ***` / `- b` | `!` after `b` | `- ***` / `- b!` |

### Editing

Each row of *Selecting and deleting a rule* and *A deletion beside a list or
quote that ends or opens with a rule* is a row, named as follows:

| Row | Table row |
|---|---|
| Backspace after a rule removes it | `a` / (blank) / `---` / (blank) / `b`, Backspace and Backspace key |
| Delete before a rule removes it | `a` / (blank) / `---` / (blank) / `b`, Delete |
| Backspace in an empty paragraph after a rule selects it | then Backspace key removes it; one undo brings it back, selected |
| the keys on a selected rule | Delete key, Backspace key, Enter, the four arrows, a typed character |
| the arrows beside a rule select it | ArrowLeft at `b`@0, ArrowRight at `a`@1 |
| a range over a rule | Delete, typing `Z`, Enter |
| a lone rule selected and deleted | `---`, the rule selected, Delete key: an empty document |
| Backspace after a rule in an item, in a quote, at an item's start, in a column | the four container rows |
| a deletion beside a list or quote whose edge block is a rule | the five rows of that table |
| Select All over a rule at the document's edge | the seven rows of *A range end beside a rule takes the rule*; for the cut rows, a mocked `copyToClipboard`'s data holds a `markdown-horizontal-rule` node |
| a copy of Select All holds the rule | `---` / (blank) / `ab`, Select All, `$generateJSONFromSelectedNodes`: the nodes hold a `markdown-horizontal-rule` |

### Commands, menus and availability

| Row | Check |
|---|---|
| insertHorizontalRule places a rule as insertTable places a table | the thirteen rows of that decision's table, each also checking the caret |
| insertHorizontalRule is one undo step | after `ab`@1, one undo gives `ab` |
| a read-only editor refuses insertHorizontalRule | nothing changes; `"readonlyedit"` fires once |
| canInsertHorizontalRule follows canInsertTable | in prose, in a raw block, in a code block, in a table cell, with no selection at a document ending in a code block: equal to `canInsertTable` |
| a selected rule leaves the inserts available | `a` / (blank) / `---` / (blank) / `b`, the rule selected: the three insert fields are `true`; `insertTable(2, 2)` and `insertImage('/i.png')` go in after the rule |
| a selected rule counts as selected text | `hasSelectedText` is `true`; `copy()` writes `---` (a mocked `writeClipboardText`); `cut()` writes it and leaves `a` / (blank) / `b` |
| the empty-line Insert submenu offers Horizontal rule after Image… | `markdown-editor.test.ts`: the submenu's labels end `…, 'Table', 'Image…', 'Horizontal rule'`, the entry enabled on the field and calling the command |
| the Insert dropdown offers Horizontal rule | `markdown-document-panel.test.ts`: dimmed in a raw block and in a table cell, enabled in text, as Table is |
| the block commands next to a rule | the five rows of *Block types, list toggles, the quote command and joins next to a rule* |

### Typing shortcuts (`markdown-editor-typing-shortcuts.test.ts`)

- `KINDS` gains `['a horizontal rule of dashes', '\\-\\-\\- ;', '\\-\\-\\-', '---']`,
  `['a horizontal rule of stars', '\\*\\*\\* ;', '\\*\\*\\*', '***']` and
  `['a horizontal rule of underscores', '\\_\\_\\_ ;', '\\_\\_\\_', '___']`.
  The third column is the save of the paragraph left as text; confirm it on
  the first run and keep what the editor writes, since the escape of a
  three-character run is the serializer's existing rule.
- `HELD_KINDS` gains `['a horizontal rule in a quote', '> a\n>\n> \\-\\-\\- ;', '> a\n>\n> ---', '> a\n>\n> \\-\\-\\-']`
  and `['a horizontal rule in a list item\'s further paragraph', '- a\n\n  \\*\\*\\* ;', '- a\n\n  ***', '- a\n\n  \\*\\*\\*']`,
  with the same note on the fourth column.
- New rows (plain names):

| Row | Document | Typed | After |
|---|---|---|---|
| Enter after dashes makes a rule | a paragraph `---` | Enter at its end | `rule \| paragraph()`, the caret in the paragraph; one undo gives the paragraph `---` back with the caret at its end |
| a longer run makes a rule of that run | a paragraph `----` | a space | a rule holding `----` |
| a rule shortcut in a column | `::: columns` / `\-\-\-` / `\|\|\|` / `x` / `:::` | a space after the dashes | the column holds a rule |
| no rule in a heading, an item's text or a table cell | `# \-\-\-`; `- \-\-\-`; a cell `\-\-\-` | a space | the text stays, with the space |
| a marker before other text makes no rule | a paragraph `\-\-\-z`, the caret after the dashes | a space | the paragraph `--- z`: the marker is not the whole text |

`markdown-editor.test.ts`'s row *contains exactly the eleven typing
shortcuts* becomes *contains exactly the twelve typing shortcuts* and lists
`HORIZONTAL_RULE_SHORTCUT`.

### Paste (`markdown-editor-horizontal-rules.test.ts`)

The five rule rows of *Paste and copy* (a rule copied from a node selection
with `$generateJSONFromSelectedNodes`, pasted with `$insertGeneratedNodes`, as
`markdown-editor-list-item-paste.test.ts` pastes), and a row *a copied range
holding a rule pastes it*: `x` / (blank) / `---` / (blank) / `y` copied whole and pasted at
`- a`@1 gives `- ax` / (blank) / `  ---` / (blank) / `  y` / (blank) / `- b`
(for `- a` / `- b`).

### Source mode (`markdown-source-mode-through-model.test.ts`, `markdown-source-edits.test.ts`, `markdown-source-places.test.ts`)

| Row | Check |
|---|---|
| a caret on a rule's line selects the rule in the model | the two decline rows of *A caret on a rule's line selects the rule*, for `toggleUnorderedList`, `setBlockType("h2")` and `toggleBold`: the text and the source selection unchanged, no event |
| insertImage with the caret on a rule's line goes after the rule | `one` / (blank) / `---` / (blank) / `two`, caret on the `---` line, `insertImage('/i.png', { alt: 'pic' })`: `one` / (blank) / `---` / (blank) / `![pic](/i.png)two` |
| a range over a rule is acted on | the third row of that table |
| horizontalRuleSource places a rule as tableSource places a table | the five rows of the surgery table, through `apply(…)` as the table rows are |
| a read-only editor refuses insertHorizontalRule in source mode | as `insertTable`'s row: `"readonlyedit"` once, the text unchanged |
| the place of an offset on a rule's line | `markdown-source-places.test.ts`: in `a` / (blank) / `---` / (blank) / `b`, an offset at the `---` line's start is before the rule, one at its end after it, and SP10's corpus sweep counts the rule as one shown thing |

### Corpus and fuzz

- `corpus/dialect.ts` gains: *a rule in a quote* (`> a` / `>` / `> ---`), *a
  rule in a column* (`::: columns` / `---` / `\|\|\|` / `x` / `:::`), *a rule
  after an item's text* (`- a` / (blank) / `  ***` / (blank) / `- b`), *a
  spaced rule* (`- - -`), *a rule of underscores with spaces* (`_ _ _`), *a
  rule interrupting a paragraph* (`a` / `***` / `b`).
- `markdown-edit-fuzz.test.ts`'s `RAW_BLOCK_TEXTS` gains `***`, `* * *` and
  `___`, beside `---`: each, set as a raw block's text in every position,
  shows as a rule and saves so.
- `markdown-nested-edit-fuzz.test.ts`'s `NESTED_SOURCES` gains `- a\n\n  ***\n- b`,
  `> a\n>\n> ---\n>\n> b` and `::: columns\n---\n|||\nb\n:::`.

### Tests that are restated

| File | Row | Today | Restated | Why |
|---|---|---|---|---|
| `markdown-editor-command-crashes.test.ts` | the 12 rows of `JOIN_ROWS` (`K5` among them) and the 6 of `ROUTE_ROWS` whose range starts at `['***', 0]` | source `***` / (blank) / … | source `<div></div>` / (blank) / …, start `['<div></div>', 0]`; expected values unchanged | a range from a raw block's start |
| same | *a space completing a bare star* | `***` / (blank) / `x`, tab, `# y` from `['***', 1]` | `* a` / `  > q` / (blank) / `x`, tab, `# y` from `['* a', 1]`; `* \# y` | the text before the joint must be `*` |
| same | *typing from a thematic break into a list item* | — | renamed *typing from a raw block into a list item*, source as above | the name |
| same | `TU1` | `---` / (blank) / `after word`, from `['---', 1]` | `- a` / `  > q` / (blank) / `after word`, from `['- a', 1]`; `- ter word`, undone `\- ter word`, then the source | the text before the joint must be `-` |
| same | `RAW_BLOCKS` of the sweep | `'***'` | `'* a\n  > q'` | a one-line raw block whose first characters are a marker |
| `markdown-editor-list-item-edits.test.ts` | `K1`, `K2b`, `K7`, `K8`, `K11`, `K12`, `K13`, `K22` | `markdown-raw-block("---")` in the shape | `markdown-horizontal-rule`; saves unchanged | the item's block is a rule |
| same | `K15`, `K16`, `K18`, `K19`, `K17`, `K21` | `$createMarkdownRawBlockNode('---')` put in | `$createMarkdownHorizontalRuleNode()` put in; the shapes name the rule | the rule moves out of text as any block (the prototype dropped it in a code block until `$takeBlocksOutOf` counted it) |
| same | `K20` | the cell holds `paragraph("---")` | the cell holds `a`, `b`, `q`, `c`; saved `\| h \|` / `\| --- \|` / `\| a\n\nb\n\nq\n\nc \|`, each `\n\n` the four characters of the cell break | a cell drops a rule |
| same | `RL4` | `***` / (blank) / `  > q` / `  </div` / (blank) / `w` | `<div></div>` / (blank) / … ; shape `markdown-raw-block("<div></div>") \| …` | "after a raw block" |
| `markdown-importer.test.ts` | `I5: a thematic break is a raw block` | `markdown-raw-block` | *I5: a thematic break is a horizontal rule*: `markdown-horizontal-rule`, save `***` | the subject |
| same | *both nodes survive a JSON round trip…* | `a` / `b <i>c</i>` / (blank) / `***` | add `<div></div>` before `***`: types `paragraph`, `markdown-raw-block`, `markdown-horizontal-rule` | keeps the raw block and adds the rule |
| same | *Backspace at the start of a raw block with text keeps it* | `***` / (blank) / `para` | `<div></div>` / (blank) / `para` | a raw block |
| same | *Enter at the end of a raw block starts a paragraph after it* | `***`, caret 3 | `<div></div>`, caret 11 | a raw block |
| same | *a link applied to a selection inside a raw block is declined* | `___`, `[0,0]`–`[0,3]` | `<div></div>`, `[0,0]`–`[0,11]` | a raw block |
| same | *a format toggle over a selection reaching from a paragraph into a raw block is declined* | `para` / (blank) / `***` | `para` / (blank) / `<div></div>` | a raw block |
| same | *a raw block after an indented list still loses its indent (control)* | `  - n` / (blank) / `  ***` | `  - n` / (blank) / `  <div></div>`, text `<div></div>` | a raw block |
| same | *a fence pasted into a thematic break's text…* | `***` | renamed *…into an HTML block's text…*, `<div></div>` | a raw block |
| same | `B11` | `markdown-raw-block` | `markdown-horizontal-rule` | the item's block is a rule |
| `display/Markdown.test.ts` | `BF4`, `BF5`, `BF6` | the literal text | `hr` elements | the viewer renders a rule |
| `markdown-view-model.test.ts` | `V5` | `{ kind: 'raw', text: '---' }` | *V5. projects a thematic break to a rule*: `{ kind: 'rule' }` | the subject |
| `corpus/commonmark.ts` | *CommonMark 11 (Tabs)* | `blocks: 'raw"* * *"'` | `blocks: 'rule'` | the viewer reads a rule |
| `markdown-editor.test.ts` | `E9 UL` | in the decline table, `- one` / `- \---` / `- two` | moves to the parity table: both surfaces `- one` / (blank) / `---` / (blank) / `- two` | no raw block |
| same | *contains exactly the eleven typing shortcuts* | 11 | 12 | the shortcut |
| same | `AVAILABILITY_FIELDS`, `NO_SELECTION`, `IN_PROSE` and every list naming `canInsertTable` | — | `canInsertHorizontalRule` beside it | the field |
| same | the empty-line Insert submenu row | ends `'Image…'` | ends `'Image…', 'Horizontal rule'` | the entry |
| `markdown-source-mode-through-model.test.ts` | `5.25` | the declines table: *the selection touches a raw block* | the pass table: `- one` / (blank) / `---` / (blank) / `- two` | no raw block |
| same | the freeze sweep's command list | — | `['insertHorizontalRule', …]` beside `insertTable` | a source-mode command |
| `markdown-document-panel.test.ts` | the three Insert dropdown rows | `…, 'Image…': x` | `'Horizontal rule'` beside `'Table'`, with `'Table'`'s value | the entry |
| `markdown-editor-table-commands.test.ts` | `P13` and the command list at line 893 | `insertImage`, `insertTable` | add `insertHorizontalRule`, expected as `insertTable` | an insert |
| `markdown-editor-command-crashes.test.ts` | the `TE` route table, `METHOD_ROUTES` | `insertTable` rows | add the route `insertHorizontalRule`; for each shape with an `insertTable` row, a row whose save is that row's with the table's lines written `---` | the rule goes where the table goes |
| `code-editor.test.ts` | — | — | a row: `syntaxNodes('a\n\n---\n\nb')` holds `HorizontalRule[3,6]` | highlighting |

The edit-fuzz rows `RB. "---" as …` keep their text: they now check that a raw
block edited into `---` shows as a rule in every position.

### Manual (browser) checks

Run the demo app's Markdown editor (`npm run dev`, repo root, the Markdown
document panel), in Chromium and in WebKitGTK:

1. A rule shows as a one-pixel line with a paragraph's gap above and below, on
   both surfaces and in both themes; the viewer and the editor match.
2. Clicking a rule shows the accent ring; clicking text clears it.
3. ArrowDown from the line above a rule passes it into the line below;
   ArrowRight at the end of the line above selects it; ArrowLeft then puts
   the caret back.
4. Backspace and Delete beside a rule, and on a selected rule, as the
   editing rows say; in a table's first cell after a rule (`---` / a table),
   Backspace at its start does what it does after a paragraph; Delete at the
   end of a column's last block before a column opening with a rule does what
   it does before a column opening with a paragraph. (Both throw headless in
   Lexical's DOM fallback, with or without a rule, so they have no offline
   row.)
5. Enter on a selected rule, then typing, puts the text in the paragraph that
   followed the rule; typing on a selected rule changes nothing.
6. Right-click on a rule: Cut and Copy are enabled, the format entries dimmed;
   Copy, then paste into a paragraph, gives a rule there.
7. Copy a rule and paste into another application: a line end; paste HTML
   with an `<hr>` from a web page: a rule.
8. Type `---` and Enter, `***` and a space, in a paragraph, a quote and a list
   item's second paragraph.
9. The toolbar's Insert ▸ Horizontal rule, and the empty-line menu's, in
   WYSIWYG and in source mode; in source mode the caret keeps its character.
10. Source mode shows a rule's line muted; a caret on it and the Bold button
    change nothing.

---

## Verification

- `npm run typecheck` and `npm run lint` (repo root): clean. The new node
  names no DOM type (`no-raw-dom`).
- The suites of the steps, then `npx vitest run --maxWorkers=2` (the whole
  library suite) and `npm run typecheck:test` (`packages/lib`).
- `npm run docs:api` (repo root): zero warnings. The new public symbols are
  `insertHorizontalRule` and `canInsertHorizontalRule`; their JSDoc links
  only public symbols.
- The grep checkpoints of step 21.
- *Manual (browser) checks*.

---

## Documentation Impact

- `docs/components/Markdown.md`: the *Supported syntax* table gains a row
  (`---`, `***` or `___` | `<hr>`); *Fallback for unsupported tokens* drops the
  thematic break and its sentence about the literal `---`. The `Markdown`
  class JSDoc in `Markdown.ts` likewise.
- `docs/components/MarkdownEditor.md`:
  - *Supported constructs*: a row *Horizontal rule* | `---`; a loaded rule
    keeps its line (`***`, `* * *`), without indentation once its container is
    edited.
  - *Kept as source*: "Thematic breaks, HTML blocks and link reference
    definitions load as a raw Markdown block" loses the thematic breaks; the
    example "a fence pasted into a thematic break's text" becomes "into an HTML
    block's text"; the sentence ending the *Lists* bullet, "A raw thematic
    break of the bullet's own character that opens an item … is saved under
    the marker on a line of its own", says "A horizontal rule".
  - *Formatting*: the shortcut list gains `---`, `***` or `___` then a space or
    Enter → a horizontal rule, in a paragraph at the top level, in a column,
    in a quote and in a list item's further paragraphs; the context menu's
    Insert submenu lists **Horizontal rule**.
  - *Command API*: a row for `insertHorizontalRule()`, and the sentences after
    the table that name the inserts (`insertTable`, `insertImage` and `paste`
    insert at the document's end without a selection; the inserts' declines;
    the source-mode list: `insertHorizontalRule` edits the raw Markdown
    directly, as `insertTable` does).
  - A new subsection *Horizontal rules* under *Supported constructs*, holding
    the selection and deletion rules of *Selecting and deleting a rule*, the
    deletion beside a container, the paste rules, and that a selected rule
    counts as selected text.
  - *Live selection state*: "eleven" becomes "twelve" (twice) and the table
    gains `canInsertHorizontalRule`; "the build-time correction of the two
    insert fields" becomes "the three".
  - *Source / WYSIWYG mode*: `insertHorizontalRule` beside `insertTable` in the
    surgery paragraph; a caret on a rule's line selects the rule, so a command
    there does nothing but an insert, which goes after it.
  - *Read-only*: the list of refused commands names `insertHorizontalRule`.
  - *Theming*: the rule uses `--ts-ui-border-color`, a selected rule
    `--ts-ui-indicator-focus`.
- `docs/components/MarkdownDocumentPanel.md`: the Insert row of the table and
  the two paragraphs after it name Horizontal rule beside Table.
- `docs/reference/changelog/next.md`:
  - **Breaking changes › Components**, as the entries with a migration note
    are: *`Markdown` renders thematic breaks, and `MarkdownEditor` edits them
    as horizontal rules* — `<hr>` where the literal `---` showed, the node in
    place of the raw block, the selection and deletion, the shortcut, `<hr>`
    paste; links the migration note.
  - **Added › Components**: *`MarkdownEditor.insertHorizontalRule()` and
    `canInsertHorizontalRule`*, with the Insert entries of the context menu
    and of `MarkdownDocumentPanel`.
  - The unreleased entries this change makes untrue are corrected in place:
    *`Markdown` reads a table only where no other block starts* ("which
    `Markdown` renders as its literal text … now shows as `---`" becomes "which
    `Markdown` renders as a horizontal rule"); the `marked` 18.1.0 entry
    ("Thematic breaks and HTML are kept as editable raw Markdown blocks"
    becomes "HTML is kept as an editable raw Markdown block"); *`MarkdownEditor`
    saves a thematic break that opens a list item as an item* ("A raw `---`
    block" becomes "A `---` rule"); the Fixed entry about a selection removed
    from a raw block ("joined at a thematic break's start" becomes "joined at an
    HTML block's start").
- `docs/reference/migration/next.md`: a new section *`---` is a horizontal rule
  in `Markdown` and `MarkdownEditor`*, with *What changed and why* (a table:
  `---` in the viewer, before the literal text, now `<hr>`; in the editor,
  before a raw block of monospace text, now a rule node, saved as written; a
  raw block edited into `---` now shows as a rule; `MarkdownEditorSelectionState`
  gains `canInsertHorizontalRule`) and *Who needs to act* (content that used
  `---` as visible text writes `\---`; code that builds a whole
  `MarkdownEditorSelectionState` object adds the field; code that read the
  editor's tree for a `markdown-raw-block` holding `---` reads
  `markdown-horizontal-rule`). The *`Markdown` reads a table only where no
  other block starts* table's row "a thematic break, shown as its literal
  `---`" becomes "a horizontal rule".
- `packages/lib/llms.txt` names no Markdown command; no change.

---

## Potential Challenges

- **A node that is no element.** Code that takes a block for an
  `ElementNode` meets a rule wherever blocks stand; the prototype found every
  such site the Markdown suites reach (*A rule stands as a block*). A new one
  shows as a rule wrapped in a paragraph, or lost from a save: the placement
  sweep and the fuzz catch both.
- **Lexical's deletion falls back to the DOM.** Where it finds nothing to act
  on, `deleteCharacter` asks the browser to extend the selection, which throws
  headless ("window object not found"). The rows avoid those places, which
  throw with or without a rule; the manual checks cover them.
- **The selected look needs a redraw.** Lexical never reconciles a node whose
  selection changed; forgetting the dirty mark leaves the ring on after the
  caret moves. The HTML row checks both ways.
- **`TE` route rows.** Their expected values for the new route are derived
  from the table route's; where a reload check disagrees, the implementer
  takes the reload's reading and records it in the row.
- **The cut beside a rule was not prototyped.** The wrapper, Enter and the
  inserts were; the cut follows the same removal in its own update. Its two
  Select All rows are the check: if Lexical's copy of the unsettled range
  misses the rule, settle a copy of the selection for the copy instead, never
  the selection itself.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/editor/markdownImageNode.ts` | the decorator-node precedent: createDOM through the seam, `decorate()` `null` |
| `packages/lib/src/typescript/lib/component/editor/markdownQuoteNode.ts`, `plans/implemented/markdown-editor-quote-node.md` | the latest editor-owned node and the shape of its plan |
| `packages/lib/src/typescript/lib/component/editor/markdownNodeState.ts` | `hardBreakMarkerState`, the kept-form precedent |
| `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` | `$isBlock`, `$wrapInlineRuns`, `$takeBlocksOutOf`, `$keepCellParagraphs` |
| `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` | `serializeBlock`, `listItemLines`, `listLayout`, `itemBlockKinds` |
| `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` | `insertTable`, `$insertTableAt`, `$insertBlockToNearestHolderAtCaret`, `registerRangeGuards`, `$backspaceAfterContainer`, `$containerEndingBefore`, `$splitItemBeforePasteEndingInTableOrFence`, `registerHeldBlockShortcuts`, `$readCommandAvailability` |
| `packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts`, `markdownSourceModel.ts`, `markdownSourceLines.ts` | `locateBlockEntry`, `$selectSourceRange`, `tableSource` |
| `node_modules/lexical/dist/Lexical.dev.mjs` (`deleteCharacter`, `NodeSelection`), `node_modules/@lexical/rich-text/dist/LexicalRichText.dev.mjs` (the arrow, Backspace, Delete and Enter handlers), `node_modules/@lexical/extension/dist/LexicalExtension.dev.mjs` (`HorizontalRuleNode`, `HorizontalRuleExtension`) | the behaviour the node relies on and the extension it mirrors |
| `scratch-keep/plans6/horizontal-rules/prototype-src.diff` and the probes in `tree/packages/lib/tests/scratch/` | the prototype |

---

## Non-Goals

- **Lexical's `HorizontalRuleNode` and `HorizontalRuleExtension`** are not
  used (*A rule is a decorator node of the editor's own*).
- **Shift-click to add a rule to a node selection**, and node selections of
  several nodes, are not handled: nothing else in the editor makes one.
- **The spaced forms as shortcuts** (`- - -`, `* * *`): the list shortcuts take
  `- ` and `* ` first, as on any Markdown surface with these shortcuts.
- **A rule in a table cell**: Markdown has none; a cell drops one.
- **The headless DOM fallbacks** of Lexical's deletion at a table's or a
  column's edge, which throw with or without a rule.
- **Task-list checkboxes** are the next plan. The groundwork this plan leaves
  for it: the viewer's fallback then covers raw HTML and the task markers
  alone, so that plan takes the last Markdown construct out of it; the source
  places give a checkbox one unit with its source, as this plan gives a rule
  (`locateBlockEntry`'s checkbox case sits beside the new `hr` case); and if
  that plan makes the checkbox an atomic node, `registerHorizontalRuleSelection`
  is the pattern for selecting one by a click and drawing it selected through
  the seam.

---

## Addendum: Prototype

The prototype is a copy of the base commit in
`scratch-keep/plans6/horizontal-rules/tree/` (its own git repository; the
commit `base` is the copy), with `base/` a worktree of that commit for
comparisons. What it did and found:

| Run | What | Result |
|---|---|---|
| baseline | the Markdown suites on the copy | 14,600 tests pass |
| the switch alone | node, importer case, serializer case, viewer case, view model | 139 failures: rules wrapped in paragraphs in items and quotes (`$wrapInlineRuns`), the raw-block re-read not showing `---` as a rule (`HELD_BLOCK_TYPES`), source places lost at a rule, and the rows that use a raw `***` |
| `$wrapInlineRuns`, `HELD_BLOCK_TYPES`, source places | | 65 failures, each a row of *Tests that are restated* |
| `$takeBlocksOutOf` and the cell rules | | a rule put into a paragraph, heading, item text or code block moves out; the code block had dropped it |
| the restatements | every row of *Tests that are restated* | each passes with the value the table gives |
| `SOURCE_KEPT_TYPES` without `"hr"` | | every suite passes, but a list item's rule loses its tabs to spaces (`*`, tab, `*`, tab, `*` became `* *   *`): kept |
| `getTextContent()` `""` against `"\n"` | | no difference in any suite: Lexical's `"\n"` is taken |
| the key, selection and arrow probes | `tests/scratch/rule-probe.test.ts` | the tables of *Selecting and deleting a rule* |
| the container edges | | Lexical stops at a rule inside a list or quote; `$deleteHorizontalRuleBesideContainer` |
| Select All | | the rule at a range's start survived a Delete; `$removeHorizontalRulesAtRangeEnds` |
| a rule in every placement | `tests/scratch/rule-save-probe.test.ts` | 198 of 198 save, reload and save again unchanged, with no serializer rule added |
| the command, the shortcut, paste, HTML | `rule-probe.test.ts`, `rule-html-probe.test.ts` | the tables of those decisions; the empty item after a paste at an item's end, then its fix |
| a source caret on a rule's line | `rule-source-probe.test.ts` | without the node selection a command acted on the block beside the rule, and took an item's text out of its list |
| all of it | the Markdown suites and `code-editor.test.ts` | 15,142 pass; the two left fail only where a row moves (`E9 UL`, `5.25`) |

---

## Notes

[^decorator]: Three node shapes were weighed. Lexical's own `HorizontalRuleNode`
    lives in `@lexical/extension`, which the library does not depend on
    directly (it is in `node_modules` only through `@lexical/code` and the
    others); its `createDOM` and `exportDOM` build the element with
    `$getDocument().createElement`, which the DOM seam rule forbids, so both
    would be overridden and nothing of it would be left but the class; and it
    is declared through Lexical's `$config()`, where every editor node uses
    static `getType`/`clone`/`importJSON`. A subclass would also keep
    `@lexical/html`'s registration-gated `<hr>` rule live, which the static
    `importDOM` makes unneeded. An `ElementNode` with no children was
    rejected: a caret can stand in an empty element, typed text goes into it,
    and none of Lexical's decorator handling (node selection, the arrows,
    Backspace and Delete beside it) applies; each would be code of the
    editor's. A `DecoratorNode` gets that handling from `registerRichText`,
    the prototype ran every key, and the editor already holds one decorator,
    the image. `getTextContent()` is `"\n"` as Lexical's rule's is, so a
    copied range's plain text keeps a line where the rule stood; the
    prototype found no difference against `""` in any suite.

[^theme]: The quote bar and the table cell borders already use
    `--ts-ui-border-color`; the rule takes the cell borders' one-pixel weight
    because a rule is a line across the text, not a bar beside it. The margin
    is the one `BLOCK_CLASS` gives a `:::` block (`editorTheme.ts`), which is
    the browser's paragraph margin: without it the browser's own `<hr>`
    margins (0.5em) apply on one surface and not the other. The selected ring
    reuses the focus ring's 2px and accent so a selected rule reads as the
    focused thing; it is an `outline`, not the focus ring's inset `::after`,
    because an `<hr>` has no content box to inset into, and the rule stands in
    the editor's scrolling content, not against a clipping edge.

[^selected-look]: `MarkdownImageNode.updateDOM` returns `true` for the same
    reason: under the seam rule a node cannot touch its element after
    creating it, so a change of look is a rebuild. Lexical's own
    `HorizontalRuleExtension` toggles a class on the element from a mutation
    listener, which is a raw DOM write. The prototype checked under jsdom that
    `this.isSelected()` reads the pending selection while Lexical reconciles,
    and that a dirty mark rebuilds the element with and without the class.

[^marker]: The precedent for a construct's authored form is node state:
    `hardBreakMarkerState` on a `LineBreakNode`, `listMarkerState` on a list,
    `fenceOpeningState` on the editor's own `MarkdownBlockNode`. The source
    map alone would keep a rule's form only while its container is unedited;
    once an item is edited it is written anew, and the rule with it. The
    state keeps the form through that, through a move and through copy and
    paste. Indentation stays off the node because a rule written anew stands
    where its container's indentation puts it; any indentation of its own
    means nothing to Markdown, as the raw block's `rawBlockAtMargin` already
    takes it off. `---` is the standard line because it is the form most
    documents use; a rule typed `***` keeps `***`, so the standard matters
    only for the command and for pasted HTML. `***` was weighed for never
    reading as a setext underline, but no save puts a rule right under a line
    of text (*How a rule is saved*).

[^source-kept]: The set exists so a raw block shows its source and the
    source analysis finds a token by its `raw`; for `hr` the second still
    holds, and the first becomes the rule's state. Measured on the prototype
    without `"hr"`: every suite passes, and the state of
    `- a` / (blank) / `  *`, tab, `*`, tab, `*` became `* *   *`, which still
    reads as a rule but is not the author's form. In a quote the lexer's own
    text is kept today (`modeInside` returns `"none"`), so a quote's rule
    holds the expanded spaces either way.

[^safety]: The 198-document sweep of *Expected Behaviour* was run on the
    prototype with no serializer change beyond `serializeBlock` and
    `itemBlockKinds`. The shapes that read otherwise are all "a marker line
    that is itself a thematic break" (`- ---`, `* ***`, `- - - -`), and the
    existing tests apply to whatever an item's first block writes. The other
    rule the task names, `---` under a line of text reading as a setext
    underline, cannot arise: every block is written a blank line from the
    one before, and the only blocks written directly after a line of text
    are nested lists. The CommonMark-11 tab form and a rule between two
    lists of one marker (CommonMark 57) are corpus cases that pass.

[^click]: Lexical's `registerRichText` handles `CLICK_COMMAND` only to clear a
    node selection, at `COMMAND_PRIORITY_EDITOR`; the editor's listener at
    `LOW` runs first. The read-only guard lets `CLICK_COMMAND` through
    (`markdownReadOnly.ts`), so a rule can be selected, not deleted, in a
    read-only editor, as text can be selected there.

[^edge-rules]: Lexical's `RangeSelection.removeText` from an element point on
    the root before a rule removes the rule in some documents (`---` / (blank)
    / `ab`) and not in others (`---` / (blank) / `- x` / `  > q`), because the
    editor's settling and its list guards read the start first and move it
    into the first block of text. Removing the edge rules first — in the
    guards, in the cut's removal and in the two inserts that replace a range —
    gives every removal the same range of text to remove, and a document with
    a rule at an edge then behaves as the same document without it (the
    prototype ran both for each row of the guards). Settling itself is not
    changed because `insertTable` calls it on a range it keeps.

[^insert]: `insertTable` is the precedent the task names, and the nearest
    command: a block inserted at the caret. Mirroring it line by line keeps
    one rule for where a block goes (`$insertBlockToNearestHolderAtCaret`,
    split only where both halves hold something, into the quote around the
    caret), for the decline in raw and code blocks and tables, and for the
    empty paragraph after a block that ends its container, which is what lets
    the caret go after the rule. The range removal is the one addition:
    `insertTable` keeps a range's content and inserts at its focus, which for
    a rule (no content to put the range into) would leave the selected text
    beside the rule, against what every editor does with an insert over a
    selection. The prototype's command did this and the range row passed. A
    node-selected rule is a selection the editor did not have before this
    plan, so turning it into a caret after the rule changes no existing
    behaviour of `insertTable` or `insertImage`; Lexical's Enter does the
    same (`selectNext()`).

[^context-menu]: A right-click on the `<hr>` resolves to the rule through
    `$getNearestNodeFromDOMNode`, as every right-click resolves its target
    (`handleWysiwygContextMenu`); the click listener has selected it by then
    on a mouse press. No new menu kind is added: a selected rule has nothing
    to format, so the text menu with its dimmed entries says what applies, and
    Cut and Copy are what a user wants of a selected rule. `copy()` and
    `cut()` write text, so a selected rule writes its Markdown line, which is
    what a paste into source mode or another application should get.

[^shortcut]: `triggerOnEnter` makes both `---` then Enter and `---` then a space
    rules, which covers what a Markdown user types and what Lexical's own
    playground shortcut does (its rule shortcut is `/^(---|\*\*\*|___)\s?$/`).
    `registerHeldBlockShortcuts` filters `SHORTCUT_TRANSFORMERS` for element
    transformers, and `registerMarkdownShortcutsOutsideRawBlocks` hands Lexical
    the same list, so one entry reaches every place a block shortcut applies,
    by typing alone and never in a raw block. The `replace` callback checks the
    block itself because Lexical's path runs an element shortcut on any block
    whose parent is a root or a shadow root, which includes a heading, and a
    table cell's paragraph (a cell is a shadow root): a rule there would be
    dropped by the cell, swallowing the typed marker. The rule goes before the
    block, and the block stays to hold the caret, so the caret stands on the
    new line Enter promises; Lexical's playground replaces the block when one
    follows, which would move the caret into the next block's text.

[^paste]: Measured on the prototype: a pasted rule at the end of `- a`'s text
    gave `item(text("a"), rule) | item(text())`, saved `- a` / `  ---` / `-`.
    Appending an empty paragraph to every paste that ends in a rule was tried
    and rejected: at an item's text start it made the item's text a further
    paragraph, and Lexical put the caret at the end of the text that followed.
    The handler takes only the case that went wrong; the caret Lexical leaves
    between blocks after the paste behaves as the caret beside a table, which
    the editor already handles (typing after each pasted rule was run).

[^caret-on-rule]: Without this rule the pass placed a caret on a rule's line
    beside the rule, an element point between blocks, and the WYSIWYG
    commands settle such a point into the block of text after it, so a
    heading command on the rule's line made the next paragraph a heading,
    and in a list item took the item's text out of the list. A node
    selection is what the WYSIWYG surface holds for "the rule", and the pass
    is built to give source mode exactly the WYSIWYG result for the same
    selection.

[^surgery]: The two routes were weighed. Through the model, the rule would
    split the caret's line as the WYSIWYG command splits the block — the very
    result the owner rejected for `insertTable` in source mode
    (`markdown-source-mode-commands-through-model`, footnote *exceptions*: `s`
    / table / `econd line`) — and at the end of a container the caret would
    have no place in the save (the empty paragraph after the rule writes
    nothing), so it would fall back to the end of the change, on the rule's
    own line, where the next keystroke turns `---` into the paragraph `---x`.
    As surgery the command reuses `tableSource`'s insertion line and its
    reading check, about forty lines, keeps the caret on the user's own text,
    and behaves as the other block insert of source mode does. The source and
    WYSIWYG results differ as they differ for `insertTable`, and the command
    joins `insertTable` outside the "source mode equals WYSIWYG" parity rows.
