---
depends-on: [markdown-horizontal-rules]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts
  - packages/lib/src/typescript/lib/component/editor/markdownImporter.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts
  - packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts
  - packages/lib/src/typescript/lib/component/editor/markdownNodeState.ts
  - packages/lib/src/typescript/lib/component/editor/editorNodes.ts
  - packages/lib/src/typescript/lib/component/editor/editorTheme.ts
  - packages/lib/src/typescript/lib/component/editor/languages.ts
  - packages/lib/src/typescript/lib/component/display/Markdown.ts
  - packages/lib/tests/component/markdown-roundtrip/viewModel.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-importer.test.ts
  - packages/lib/tests/component/markdown-source-places.test.ts
  - packages/lib/tests/component/display/Markdown.test.ts
  - packages/lib/docs/components/Markdown.md
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/components/MarkdownDocumentPanel.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
---

# Markdown Task Lists — Implementation Plan

## Overview

A GFM task-list item (`- [ ] todo`, `- [x] done`, also under `*`, `+` and
ordered markers, nested, in loose and tight lists) is not supported today.
The `Markdown` viewer prints the marker through its plain-text fallback, so
`[ ] ` shows as text
([Markdown.ts:1660](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L1660),
[Markdown.ts:2097](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L2097),
documented at [Markdown.md:58](../packages/lib/docs/components/Markdown.md#L58)
and [:166](../packages/lib/docs/components/Markdown.md#L166)). `MarkdownEditor`
loads the marker as an atomic run, a `MarkdownSourceTextNode` showing `[ ] `
at the start of the item's text
([markdownImporter.ts:1557](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L1557)).

This plan supports task items on both surfaces, under one name: a **task
item**, whose **checkbox** is checked or unchecked. The viewer draws a
read-only checkbox. The editor gets a node of its own,
`MarkdownTaskCheckboxNode` (type `markdown-task-checkbox`), in a new file
`packages/lib/src/typescript/lib/component/editor/markdownTaskCheckboxNode.ts`.
It stands first in a list item's text, where the atomic run stood. A click
toggles it; Ctrl+Enter (Cmd+Enter on macOS) toggles the checkboxes of the
task items the selection touches; Enter makes a new unchecked task item;
Backspace right after it removes it; typing `[ ] ` or `[x] ` at the start of
an item's text makes one. A new command, `toggleTaskList()`, turns the
selected blocks into task items or takes their checkboxes off, with menu
entries beside **Bulleted list** and **Numbered list**. HTML check lists paste
as task items, and source mode highlights a task marker.

The plan sits on `markdown-horizontal-rules` (the horizontal-rules plan) and
is written against its plan commit `9686026d5`, which holds the code of
`68e69463b`; line numbers are from that commit. The horizontal-rules
implementation shifts many of them, so find each site by its symbol. Where
this plan uses code the horizontal-rules plan adds, the text says so. The
design was run as a prototype in
`~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans6/task-lists/`
(*Addendum: Prototype*): with it every Markdown suite passes once the 103
rows of *Tests that are restated* are restated.

---

## Architecture Decisions

### A checkbox is an inline node of the editor's own, first in the item's text

`MarkdownTaskCheckboxNode extends DecoratorNode<null>`, as `MarkdownImageNode`
does
([markdownImageNode.ts:40](../packages/lib/src/typescript/lib/component/editor/markdownImageNode.ts#L40))
and as the horizontal-rules plan's `MarkdownHorizontalRuleNode` does: static
`getType`, `clone` and `importJSON`, `decorate()` returning `null`, a
`createDOM` that mints its element through the DOM seam's
`createViewElement`, and `updateDOM()` returning `true`. It is inline
(`isInline()` is `true`), it is not keyboard-selectable
(`isKeyboardSelectable()` is `false`), and its checked state is a field,
`__checked`, as the image's source is. It stands as the first child of a
`MarkdownListItemTextNode`, the place of today's atomic run, and is
registered in `EDITOR_NODES`
([editorNodes.ts:40](../packages/lib/src/typescript/lib/component/editor/editorNodes.ts#L40)).[^model]

| Source | Today | After |
|---|---|---|
| `- [ ] a` | `item(text(src("[ ] "), "a"))` | `item(text(checkbox(unchecked), "a"))` |
| `1. [x] a` | `item(text(src("[x] "), "a"))` | `item(text(checkbox(checked), "a"))` |
| `- [ ] a` / `  - [x] b` | the same runs, nested | `item(text(checkbox, "a"), list(item(text(checkbox(checked), "b"))))` |
| `- [ ] a` / (blank) / `- [x] b` | the same runs, loose | a loose list of two task items |
| `* [x] a` / `* b` | a run in the first item | a task item and a plain item in one list |

`getTextContent()` is `[ ] ` or `[x] `, the text the atomic run held, so a
plain-text copy of a task item reads `[x] done`, and code that measured an
item's text sees what it saw.[^text-content]

### A checkbox stands only first in an item's text; anywhere else it is the text it saves as

The parity plan's rule for the marker stays (rule 5 of
`markdown-list-toggle-task-item-parity`): the marker belongs to its item's
text, stays a marker while the item stays an item, and becomes the text it
shows when the text leaves its list. A new writable-state rule,
`$keepCheckboxOpeningItemText` (the checkbox rule), enforces it: a checkbox that is not the first
child of a list item's text, in a list item, is replaced by a text node of its
marker (`[ ] `, `[x] ` or `[X] `, without its space when nothing follows it).
A checkbox that stands first straight in a list item, where Lexical's list
code and its HTML import put inline nodes before the item rules wrap them in
the item's text, is left alone.[^rule-five]

| Edit | After |
|---|---|
| `toggleUnorderedList()` in `- [ ] one` / `- [x] two`, caret in `one` | the paragraph `[ ] one` (saved `\[ \] one`), then `- [x] two` |
| `toggleOrderedList()`, same | `1. [ ] one`, then `- [x] two` |
| `setBlockType("h2")` in `- [x] one` | `## \[x\] one` |
| `setBlockType("code")` in `- [x] one` | a code block holding `[x] one` |
| Delete at the end of a paragraph before `- [x] a` | the paragraph's text, then the text `[x] a` |
| a copied checkbox pasted into the middle of a paragraph | the text `[x] ` there |

The prototype gave each row, and the parity plan's toggle rows (`T1` to `T17`,
`Q2`) pass unchanged with the rule.

### The viewer draws a read-only checkbox where the marker stood

`appendBlockToken`
([Markdown.ts:1643](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L1643))
and `appendInlineToken`
([:2007](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L2007))
each gain `case "checkbox"`, which calls a new
`appendTaskCheckbox(parent, token)`. It builds a `<span>` through
`this.create("span")`, gives it the class `ts-ui-md-task-checkbox` (and
`ts-ui-md-task-checkbox-checked` when `token.checked`), the attributes
`role="checkbox"`, `aria-checked` (`"true"` or `"false"`) and
`aria-readonly="true"`, and appends it. `appendListItem`
([:1733](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L1733))
already puts the checkbox token where the box must go: first in a tight item,
first in the first paragraph of a loose one, a nested list after a blank line
included. Nothing in it changes but its JSDoc.[^viewer-element]

The list marker stays: the box stands at the start of the item's first line,
after the bullet or number, followed by the gap a space leaves.

| Source | Today | After |
|---|---|---|
| `- [ ] buy milk` | `• [ ] buy milk` | `• ☐ buy milk` |
| `1. [x] call` | `1. [x] call` | `1. ☑ call` |
| `- [x] a` / (blank) / `  - b` | `• [x] a` (a paragraph), then `◦ b` | `• ☑ a`, then `◦ b` |

The box is drawn by CSS with the tokens the `Checkbox` component draws its box
with
([Checkbox.ts:63](../packages/lib/src/typescript/lib/component/input/Checkbox.ts#L63)),
on both surfaces: `ensureMarkdownClassRules`
([Markdown.ts:180](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L180))
gets the rules for the viewer's two classes, and `ensureMarkdownEditorClassRules`
([editorTheme.ts:50](../packages/lib/src/typescript/lib/component/editor/editorTheme.ts#L50))
the same rules for `ts-ui-mde-task-checkbox` and
`ts-ui-mde-task-checkbox-checked`, with `cursor: pointer`. `EDITOR_THEME`
names the two editor classes under the custom keys `mdTaskCheckbox` and
`mdTaskCheckboxChecked`, beside `mdImage`.[^look]

| Rule | Property | Value | Why |
|---|---|---|---|
| the box | `display` | `"inline-block"` | stands in the line of text |
| | `boxSizing` | `"border-box"` | the border is inside the size |
| | `width`, `height` | `"0.9em"` | a little under the font size, so the box fits the line at any font size or font scale |
| | `verticalAlign` | `"middle"` | its middle on the text's middle, as a checkbox beside text sits |
| | `marginRight` | `"0.35em"` | the width of the space the marker is followed by |
| | `position` | `"relative"` | the frame the check mark is drawn in |
| | `border` | `"1px solid var(--ts-ui-form-border, rgb(160, 160, 160))"` | `Checkbox`'s box |
| | `borderRadius` | `"var(--ts-ui-checkbox-radius, 3px)"` | the same |
| | `backgroundColor` | `"var(--ts-ui-checkbox-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))"` | the same |
| checked | `backgroundColor`, `borderColor` | `"var(--ts-ui-checkbox-bg-selected, rgb(30, 100, 200))"` | `Checkbox`'s checked box |
| checked, `::after` (a `"selector"` rule) | `content` | `'""'` | the check mark |
| | `position` | `"absolute"` | placed in the box |
| | `left`, `top`, `width`, `height` | `"32%"`, `"10%"`, `"30%"`, `"55%"` | the mark's two arms are the right and bottom borders of a box this size, turned 45°, in proportion to the box so it scales with the text |
| | `border` | `"solid var(--ts-ui-checkbox-check-color, rgb(255, 255, 255))"` | `Checkbox`'s check colour |
| | `borderWidth` | `"0 0.12em 0.12em 0"` | the two arms only |
| | `transform` | `"rotate(45deg)"` | turns the two borders into a check |

### A load builds the checkbox and keeps how its letter was written

`$buildListItem`
([markdownImporter.ts:1528](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L1528))
appends `$createMarkdownTaskCheckboxNode(checkbox.checked, authoredTaskMarker(item))`
where it appends the source run today, and passes `tokens` without the
checkbox to `$buildKeepingConstructs`. `withOwnCheckbox` and the `null`
return for a checkbox with no text after it are unchanged.

The marker's form is node state, as a list's marker is (`listMarkerState`,
[markdownNodeState.ts:191](../packages/lib/src/typescript/lib/component/editor/markdownNodeState.ts#L191)):
`taskMarkerState`, under the key `mdTaskMarker`, holds the marker as its
item's first line writes it, `[ ]`, `[x]` or `[X]`; `""` (the default) is a
checkbox made in the editor. `authoredTaskMarker(item)` reads it off the
item's `raw` with `AUTHORED_TASK_MARKER`, `""` where the marker is not on the
marker line. The blanks after the marker are not kept: an edited item is
written with one space, as an edited item's list marker is.[^marker-state]

| Written | State | Written when its item is edited |
|---|---|---|
| `- [ ] a` | `[ ]` | `- [ ] a` |
| `- [X] a` | `[X]` | `- [X] a` |
| `- [X] a`, then unchecked and checked again | `[X]` | `- [x] a` (the state no longer says the box's state once unchecked, and is not written again) |
| `- [x]   a` | `[x]` | `- [x] a` |
| `- [ ]`, a tab, `a` | `[ ]` | `- [ ] a` |
| made by `toggleTaskList`, Enter or a paste | `""` | `- [ ] a` |
| typed `[X] ` | `[X]` | `- [X] a` |

An unedited item is written as its source by the source map, so every form,
the blanks after the marker included, survives a save that does not touch it.

### A save writes the marker, then the item's text as a line start

The serializer writes no checkbox inline: `appendSegments`
([markdownSerializer.ts:4758](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L4758))
skips a `MarkdownTaskCheckboxNode`. The item's writer puts the marker in
front of what the item's text writes: `buildItemBlocks`
([:3536](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L3536))
pushes `withTaskMarker(child, serializeInline(child, …))` for an item's text,
and `$writeRestOfBlock`
([:1387](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1387))
does the same when the nodes it writes for an item's text open with that
text's checkbox. `withTaskMarker` writes `$taskMarkerMarkdown(box)` (the
state while it says the box's state, else `[ ] ` or `[x] `) before the text,
and the text is written as the start of a line.[^serializer]

Writing the text as a line start fixes two of the owner's known issues, which
the prototype ran:

| Source | Edit | Save today | Save after |
|---|---|---|---|
| `[x]: /u` / (blank) / `- [x] done` | `!` after `done` | `- \[x\] done!` (no longer a task item) | `- [x] done!` |
| `- [x] &nbsp;a` | `!` after `a` | `- [x]` + a no-break space + `a!`, which `marked` reads as no task item, so the next save writes `- \[x\]  a!` | `- [x] &nbsp;a!` |
| `- [x]  two` | `!` after `two` | `- [x] two!` | `- [x] two!` |

`$readStandardForm`
([:1487](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1487))
needs no change: the importer no longer passes it the checkbox token, and
`serializeInline` no longer writes the checkbox, so the reading compares the
text alone. `joinsShortcut`'s task case (`TASK_CHECKBOX_SHORTCUT`,
[:500](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L500))
stays: a `[x]` reference link opening a plain item's text is still written
`[x][]`.

### A task item with no text after its checkbox

Markdown has no empty task item: `- [ ]` reads as an item holding the text
`[ ]`. An item's text that holds its checkbox and nothing else (whitespace
aside) keeps the checkbox while the selection stands in that text, so Enter
can open a task item and the user can type its text. The save writes it as
the text it reads as: `- [ ]` for an unchecked box, `- \[x\]` for a checked
one (a `[x]` alone could be a reference link). An edit of that text that
leaves the selection outside it turns the checkbox into that text, `[ ]` or
`[x]`, so the editor then shows what the save reads.[^empty-item]

| Document | Edit | Shown | Saved |
|---|---|---|---|
| `- [ ] a` / `- b` | delete `a` | the checkbox, the caret after it | `- [ ]` / `- b` |
| same | then type `z` | the checkbox and `z` | `- [ ] z` / `- b` |
| `- [x] done` | Enter at the end | `- [x] done`, then a new checkbox with the caret after it | `- [x] done` / `- [ ]` |
| `- [x] a` / (blank) / `[x]: /u` | delete `a` | the checkbox | `- \[x\]` / (blank) / `[x]: /u` |

This is the rule of the whitespace at a line's start
([markdownWritable.ts:1868](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1868)),
which shows a typed space while the caret stays beside it, and uses its
`$selectionStandsIn`
([:2007](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L2007)).

### The blanks that end an item's text load as nothing

`marked` keeps the blanks after the text of every item but a list's last,
and the viewer shows none of them. The importer kept them, so the editor
showed a space its save drops. A new `$dropBlanksEndingItemText(itemText)`,
called at the end of the build in `$buildListItem`, trims the spaces and tabs
off the end of the last text node of an item's text when it is plain text
(no source node, no code span).[^trailing]

| Source | Today | After |
|---|---|---|
| `- [ ] ` / `- [x] ` | the texts `"[ ] "` and `"[x]"` | `"[ ]"` and `"[x]"` |
| `- a ` / `- b` | `"a "` | `"a"` |

This is the known issue "The importer keeps the trailing space of a list item
whose text is `[ ] `", which also held for any text.

### Clicking the checkbox toggles it as one undo step

A new `registerTaskItemRules(editor, isReadOnly, onRefused)` in
`MarkdownEditor.ts`, called from `registerEditorRules`
([MarkdownEditor.ts:10732](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L10732))
before `registerListItemRules` with `() => this.getReadOnly()` and
`() => this.signalReadOnlyEdit()`, registers `CLICK_COMMAND` at
`COMMAND_PRIORITY_LOW` with `$toggleClickedTaskCheckbox`. When the click's
target resolves (`isDOMNode`, `$getNearestNodeFromDOMNode`) to a checkbox,
the listener flips `__checked`, tags the update `HISTORY_PUSH_TAG` and
returns `true`. A read-only editor lets `CLICK_COMMAND` through
([markdownReadOnly.ts](../packages/lib/src/typescript/lib/component/editor/markdownReadOnly.ts)),
so there the listener changes nothing, calls `onRefused()` (which fires
`"readonlyedit"` and flashes the surface, as any refused edit does) and
returns `true`.[^click]

This is the horizontal-rules plan's `$selectClickedHorizontalRule` (a
`CLICK_COMMAND` listener at `LOW` resolving the target to its node), which
toggles where that one selects.

### Ctrl+Enter toggles the task items the selection touches

The same registration adds `KEY_ENTER_COMMAND` at `COMMAND_PRIORITY_HIGH` with
`$toggleTouchedTaskItems(event)`: with Ctrl held (Cmd on macOS, `IS_APPLE`),
no Shift and no Alt, it collects the checkbox of each list item's text the
selection touches. With none it returns `false`, and the key does what it does
today. Otherwise it checks every one when any is unchecked, else unchecks
every one, tags the update `HISTORY_PUSH_TAG`, prevents the key's default and
returns `true`. A read-only editor refuses the key already, as every Enter.

| Document | Selection | Ctrl+Enter |
|---|---|---|
| `- [ ] one` / `- [x] two` | caret in `two` | `- [ ] one` / `- [ ] two` |
| same | caret in `one` | `- [x] one` / `- [x] two` |
| same | `one` to `two` | both checked |
| `- [x] a` / `- [x] b` | `a` to `b` | both unchecked |
| `- a`, or a paragraph | caret in it | what Enter does today |

The checkbox is not keyboard-selectable, so the arrow keys pass over it as
over one character, and no node selection of it is ever made.[^keyboard]

### A caret before the checkbox acts as the caret right after it

A click left of the box, or ArrowLeft from the start of the item's text, can
put a caret before the checkbox: an element point on the item's text at
offset 0. `$settleSelectionOffContainers`
([MarkdownEditor.ts:2385](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2385)),
the one place a selection is settled before an edit, first calls a new
`$settleCaretPastCheckbox(selection)`: a collapsed range selection at such a
point moves to offset 1, right after the checkbox, and the function returns
`true` (a point moved). Every command the range guards wrap
(`registerRangeGuards`, [:5806](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5806)),
Enter, `insertTable`, `insertImage` and the horizontal-rules plan's
`insertHorizontalRule` call that function, so each acts there as after the
checkbox. `registerTaskItemRules` also registers `COMPOSITION_START_COMMAND`
at `COMMAND_PRIORITY_CRITICAL`, calling `$settleCaretPastCheckbox($getSelection())`
and returning `false`, as `$moveCaretOutOfLinkEdge` settles a caret at a
composition's start
([:10738](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L10738)).
A range is not settled.[^settle]

| Caret before the checkbox of `- [x] two` | Key | After |
|---|---|---|
| | typing `Z` | `- [x] Ztwo` |
| | Backspace | `- two` (the checkbox goes) |
| | Delete | `- [x] wo` |
| | Enter | an empty unchecked task item above `- [x] two` |

### Enter and Backspace in a task item

`registerTaskItemRules` registers `INSERT_PARAGRAPH_COMMAND` at
`COMMAND_PRIORITY_HIGH` with `$enterSplitsTaskItem`, ahead of
`$enterLeavesListAtBlankItemText`
([:5424](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5424)),
which `registerListItemRules` registers at the same priority later. For a
collapsed caret in a task item's text:

- **The text holds more than its checkbox.** It splits the item with
  `selection.insertParagraph()`, then gives the new item's text an unchecked
  checkbox, first. When nothing but the checkbox stood before the caret, the
  original checkbox moves to the new (lower) item instead, and the upper item,
  left empty, gets the unchecked one. It returns `true`.
- **The text holds its checkbox alone.** At the top level it removes the
  checkbox and returns `false`; nested, it leaves the checkbox and returns
  `false`. `$enterLeavesListAtBlankItemText` then does what it does on an
  empty line, its blank test widened to count a checkbox that opens the text
  as blank: the top-level item leaves the list as an empty paragraph, the
  nested one moves out one level, a task item still.[^enter]

| Document | Caret | Enter |
|---|---|---|
| `- [ ] one` | end of `one` | `- [ ] one` / `- [ ]`, the caret in the new task item |
| `- [x] two` | `t`@1 of `two` | `- [x] t` / `- [ ] wo` |
| `- [x] two` | right after the checkbox | `- [ ]` / `- [x] two`, the caret before `two` |
| `- [ ] one` / `- [ ]` (the second empty) | in the second | `- [ ] one`, then an empty paragraph |
| `- a` / `  - [ ] one` / `  - [ ]` | in the empty nested one | `- a` / `  - [ ] one` / `- [ ]` |

Backspace right after the checkbox removes it: that is Lexical's own
deletion of an inline decorator before the caret, and the prototype ran it at
the top level and nested (Lexical's outdent at the front of an indented block
looks for the block's first descendant, which is the checkbox, so the key does
not outdent). A caret before the checkbox is settled after it first, so
Backspace there removes it too. A second Backspace does what Backspace at the
start of a plain item does.

### The typing shortcut: `[ ] `, `[x] ` or `[X] ` at the start of an item's text

A new `TASK_ITEM_SHORTCUT: ElementTransformer` in `markdownTransformers.ts`,
with `regExp: /^\[([ xX])\]\s/`, `triggerOnEnter: false` and an `export` of
`() => null`, is not in `SHORTCUT_TRANSFORMERS`: Lexical's own shortcut path
never runs in an item's text, whose parent is no root. Its `replace(block,
children, match)` returns `false` unless the block is a list item's text in a
list item with no checkbox yet; then it inserts
`$createMarkdownTaskCheckboxNode(match[1] !== " ", "[" + match[1] + "]")`
first, and puts the caret at the start of `children` (after the checkbox when
there are none).

`registerHeldBlockShortcuts`
([MarkdownEditor.ts:5204](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5204))
runs it: its update listener's `isInHeldBlock` test also admits the text of a
list item (`$isTaskShortcutBlock`), and `$runHeldBlockShortcut`
([:5180](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5180))
tries `[TASK_ITEM_SHORTCUT]` alone in such a text, through
`$applyElementShortcut`
([:5111](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5111)),
which takes the list of shortcuts to try as a new last parameter. Typing only,
never on Enter; one undo leaves the characters as typed.[^shortcut]

| Document | Typed at the start of the item's text | After |
|---|---|---|
| `- a` | `[ ] ` | `- [ ] a`, a checkbox |
| `- a` | `[x] ` or `[X] ` | a checked checkbox; saved `- [x] a` or `- [X] a` |
| `- ` (an empty item) | `[ ] ` | a checkbox, the caret after it |
| a paragraph `a` | `[ ] ` | the text `[ ] a` (no shortcut) |
| `- [ ] a` | `[ ] ` after the checkbox | the text `[ ] ` after the checkbox |
| a paragraph | `- ` then `[ ] ` | a bulleted item, then a task item: two shortcuts in turn |

### `toggleTaskList()` makes task items, or takes their checkboxes off

`toggleTaskList(): this` is the third list toggle, shaped as
`toggleUnorderedList`
([MarkdownEditor.ts:9413](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L9413)):
`editSourceThroughModel` first, then `commandApplies("canSetBlockType")`, then
one discrete update that settles the ends (`$settleEndsIntoBlocksOfText`) and
runs a new `$toggleTaskItemsOfTouchedBlocks(selection)`. A task item is no
third kind of list: the toggle adds or removes checkboxes and never changes a
list's kind.[^toggle]

- **Off** when every touched block is the text of a task item: each checkbox
  is removed; the items stay where they are.
- **On** otherwise: each touched block that opens no item of a list
  (`$opensItemOfListType` for `"bullet"` and `"number"`) leaves its lists and
  becomes a bulleted item through `$liftBlockOutOfLists` and `$makeItemsOf`,
  as the bulleted toggle makes one, joining the list next to it; then every
  touched block that opens an item gets an unchecked checkbox where it has
  none. A heading that opens an item becomes the item's text first.

| Document | Selection | After |
|---|---|---|
| `- a` / `- b` | caret in `a` | `- [ ] a` / `- b` (one list, mixed) |
| `- a` / `- b` | `a` to `b` | `- [ ] a` / `- [ ] b` |
| `- [ ] a` / `- b` | `a` to `b` | `- [ ] a` / `- [ ] b` |
| `- [ ] a` / `- [x] b` | `a` to `b` | `- a` / `- b` |
| `a` / (blank) / `b` | `a` to `b` | `- [ ] a` / `- [ ] b` |
| `1. a` | caret in `a` | `1. [ ] a` |
| `> q` | caret in `q` | `> - [ ] q` |
| `- a` / (blank) / `  p` | caret in `p` | `- a` / (blank) / `- [ ] p` |
| `- # h` | caret in `h` | `- [ ] h` |

Source mode runs it through the model, as the other toggles; the prototype
gave the same document for every row on both surfaces.

### The menus offer Task list after Numbered list

A **Task list** entry follows **Numbered list** in the two places the list
toggles live: the empty-line context menu's Insert submenu
(`buildEmptyLineContextMenuItems`,
[MarkdownEditor.ts:11237](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L11237))
and `MarkdownDocumentPanel`'s Insert dropdown (`buildInsertMenuItems`,
[MarkdownDocumentPanel.ts:319](../packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L319)).
Each is enabled on `canSetBlockType` and calls `toggleTaskList()`. No
selection-state field is added: `canSetBlockType` already names the block
conversions.

### Paste and copy

A task item copied in the editor travels as Lexical nodes, its checkbox with
it. A checkbox pasted at the start of an item's text makes that item a task
item; anywhere else it becomes its text (the rule above).

An HTML check list pastes as a bulleted list of task items. Lexical's own
list conversions already read GitHub's task lists (`li.task-list-item` with an
`<input type="checkbox">`), Joplin's, an `<li>` carrying `aria-checked`, and
Lexical's own check list into a `ListNode` of type `"check"` whose items carry
`__checked`. Three changes take that in:

- The `ListItemNode` replacement in `EDITOR_NODES`
  ([editorNodes.ts:46](../packages/lib/src/typescript/lib/component/editor/editorNodes.ts#L46))
  keeps the replaced node's `__checked`:
  `with: (node: ListItemNode) => new MarkdownListItemNode(undefined, node.__checked)`.
- `keepingNestedLists`
  ([markdownListItemNode.ts:214](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L214))
  sets a `"check"` list to `"bullet"`, and in its `after` puts
  `$createMarkdownTaskCheckboxNode(child.__checked)` first in each item whose
  `__checked` is set, then clears it (`setChecked(undefined)`).
- `MarkdownTaskCheckboxNode.exportDOM()` writes `<input type="checkbox" disabled>`
  (with `checked` for a checked box), minted through `createViewElement`, so a
  copy pasted into another application shows a checkbox.[^paste]

| Pasted HTML | After |
|---|---|
| `<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" disabled> todo</li><li class="task-list-item"><input type="checkbox" checked disabled> done</li></ul>` | `- [ ] todo` / `- [x] done` |
| `<ul><li aria-checked="true">a</li><li aria-checked="false">b</li></ul>` | `- [x] a` / `- [ ] b` |
| `<ol><li class="task-list-item"><input type="checkbox" checked> one</li><li>plain</li></ol>` | `1. [x] one` / `2. plain` |
| `<p>a <input type="checkbox" checked> b</p>` | a paragraph; the input shows nothing |

### Source mode

**Commands.** `toggleTaskList` runs through the model, as the other toggles
do, and is added to the list of source-mode commands that run the WYSIWYG
command. No source-mode key changes: Ctrl+Enter there is CodeMirror's, and a
checkbox is toggled by typing `x` between its brackets.

**The places of a checkbox's source.** The source places treat the checkbox
as one unit shown whole, whose source is its marker and the blanks after it:
`locateBlockEntry`'s checkbox case
([markdownSourcePlaces.ts:874](../packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts#L874))
sets the unit's `start` and `end` to the `checkbox` entry's span, in place of
`locateSourceNode`, as the horizontal-rules plan's `hr` case does beside it.
`$placeAmongUnits`
([:1312](../packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts#L1312))
counts a checkbox unit as ending at its start, so an offset anywhere in its
source is after the checkbox: the checkbox is no place for a caret to stand
before.[^places]

| Source, `¦` the offset | Place today | Place after |
|---|---|---|
| `- ¦[x] cd` | before the run `[x] ` | after the checkbox, before `cd` |
| `- [x¦] cd` | before the run | after the checkbox |
| `- [x]¦  cd` | after the run | after the checkbox |
| `- a` / `- [¦X]   cd` | before the run | after the checkbox (not at the end of `a`) |

The limit the docs name for a checkbox followed by more than one space in a
loose list (row `SP7`) is unchanged.

**Highlighting.** The source surface's Markdown parser gains a task-marker
extension, so `[ ]` and `[x]` that open a task item are tagged as list markup
and muted as `-` is. In `languages.ts`
([:489](../packages/lib/src/typescript/lib/component/editor/languages.ts#L489))
the `markdown()` call's `extensions` become `[MARKDOWN_TAB_STOPS, taskMarkers]`,
where `taskMarkers` is a `MarkdownConfig` built in `loadExtension` from a
dynamically imported `tags` (`@lezer/highlight`): lezer's own `TaskList`
extension with two changes, the leaf test `/^\[[ xX]\][ \t]+\S/`, which is
`marked`'s, and the `TaskMarker` node styled `tags.processingInstruction`, the
tag of a list's marker.[^highlight]

| Source | Nodes |
|---|---|
| `- [ ] a` | `ListItem`, `ListMark`, `Task`, `TaskMarker[2,5]` |
| `- [ ]` (nothing after) | `ListItem`, `ListMark`, `Paragraph` |
| `- \[ ] d` | `ListItem`, `ListMark`, `Paragraph`, `Escape` |
| `a [ ] b` | `Paragraph` |

### What becomes dead or changes

- **The atomic run for a task marker.** No load builds one. Removed with it:
  the serializer's `TASK_MARKER_SOURCE`
  ([markdownSerializer.ts:503](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L503)),
  `strayTaskMarkersAsText` ([:7029](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L7029))
  and its call in `assembleLines`
  ([:6664](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L6664)),
  and the writable rules' `TASK_MARKER_SOURCE`
  ([markdownWritable.ts:1840](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1840)).
  `$opensTaskItem` ([:1979](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1979))
  tests for the checkbox node. The source places' `$placeOutsideSourceNode`
  ([markdownSourcePlaces.ts:405](../packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts#L405))
  stays, without its task example.
- **The format toggles over a task item.** The checkbox is no run kept as
  source, so bold, colour and the other formats apply to a task item's text
  wherever the checkbox is in the selection, and are written after the
  marker: bold over `- [ ] a` from before the checkbox saves `- [ ] **a**`,
  where the toggle declined.
- **Comments and JSDoc that name the run:** `MarkdownSourceTextNode`'s
  ([markdownSourceNodes.ts:23](../packages/lib/src/typescript/lib/component/editor/markdownSourceNodes.ts#L23)),
  `MarkdownListItemTextNode`'s
  ([markdownListItemNode.ts:298](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L298)),
  `$selectionHoldsSourceRun`'s
  ([MarkdownEditor.ts:4764](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4764)),
  the source places' module comments
  ([markdownSourcePlaces.ts:137](../packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts#L137),
  [:399](../packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts#L399)),
  `$readStandardForm`'s `tokens` parameter
  ([markdownSerializer.ts:1482](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1482)),
  `$buildListItem`'s and `withOwnCheckbox`'s, and the `Markdown` class JSDoc
  ([Markdown.ts:576](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L576)),
  whose fallback then covers raw HTML alone (the horizontal-rules plan took
  the thematic break out of it).
- **Docs that call task lists unsupported:** see *Documentation Impact*.
- **The owner's known issues** this fixes, which step 22 removes from
  `known-issues-2026-10.md`: the task marker that is also a defined label
  (large-doc review 1), the task item's brackets escaped on a second save after
  a no-break space (the second half of the second entry; its first half, a
  no-break space collapsed in a heading, stays), and the trailing space of an
  item whose text is `[ ] ` (through-model review 3).

### Tests that are restated

103 rows fail on the prototype, each because it pins the marker as a run or
as text. Each is restated to keep testing what it tested; the table under
*Expected Behaviour*, *Tests that are restated*, lists them.

---

## Public API

`MarkdownEditor` (`component/editor/MarkdownEditor.ts`):

```ts
/**
 * Makes the selected blocks task items, or takes their checkboxes off. When every selected block is the text of a
 * task item, their checkboxes are removed and the items stay. Otherwise each selected block that opens no list item
 * becomes an item of a bulleted list where it stands, as `toggleUnorderedList` makes one, and every selected item
 * without a checkbox gets an unchecked one; a list keeps its kind. No-op without a range selection, and when the
 * selection touches a table cell.
 *
 * In `"source"` mode, runs this command on the Markdown around the selection as on the WYSIWYG surface and writes
 * back the text it changes; no-op where the selection touches a raw Markdown block.
 *
 * @returns This component, for method chaining.
 */
toggleTaskList(): this;
```

`MarkdownEditorSelectionState.canSetBlockType`'s JSDoc
([MarkdownEditor.ts:221](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L221))
says "the three list toggles". `MarkdownTaskCheckboxNode`, its functions and
`taskMarkerState` are internal, as `MarkdownImageNode` is, and are not
re-exported from `component/editor/index.ts`.

---

## Internal Structure

Write full JSDoc on every new symbol, as the code conventions ask; the
comments below are shortened. The prototype's diff
(`scratch-keep/plans6/task-lists/prototype-src.diff`, with its two new
modules beside it) is a reference, not a patch: it puts the editor rules in a
module of their own and carries test shortcuts.

### `markdownTaskCheckboxNode.ts`

```ts
import { $getState, $setState, DecoratorNode } from "lexical";
import type { DOMExportOutput, EditorConfig, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from "lexical";
import { DOM } from "~/core/DOM.js";
import { taskMarkerState } from "~/component/editor/markdownNodeState.js";

export type SerializedMarkdownTaskCheckboxNode = Spread<{ checked: boolean }, SerializedLexicalNode>;

export class MarkdownTaskCheckboxNode extends DecoratorNode<null> {
    __checked: boolean;

    constructor(checked?: boolean, key?: NodeKey);             // checked defaults to false
    static getType(): string;                                   // "markdown-task-checkbox"
    static clone(node: MarkdownTaskCheckboxNode): MarkdownTaskCheckboxNode;
    static importJSON(json: SerializedMarkdownTaskCheckboxNode): MarkdownTaskCheckboxNode;   // new …(json.checked === true).updateFromJSON(json)

    exportJSON(): SerializedMarkdownTaskCheckboxNode;           // { ...super.exportJSON(), type, version: 1, checked }
    isChecked(): boolean;                                       // this.getLatest().__checked
    setChecked(checked: boolean): this;                         // getWritable().__checked = checked
    isInline(): true;
    isKeyboardSelectable(): false;
    decorate(): null;
    getTextContent(): string;                                   // "[x] " or "[ ] "
    createDOM(config: EditorConfig);                            // return type inferred; see below
    updateDOM(): true;
    exportDOM(): DOMExportOutput;                               // <input type="checkbox" disabled [checked]>
}

export function $createMarkdownTaskCheckboxNode(checked: boolean, marker?: string): MarkdownTaskCheckboxNode;   // sets taskMarkerState when marker is given and not ""
export function $isMarkdownTaskCheckboxNode(node: LexicalNode | null | undefined): node is MarkdownTaskCheckboxNode;
/** The checkbox a list item's text opens with, or null. */
export function $openingCheckbox(text: LexicalNode | null): MarkdownTaskCheckboxNode | null;
/** The marker a save writes, with its space: the state while it says the box's state (its letter is a space exactly when unchecked), else `[ ] ` or `[x] `. */
export function $taskMarkerMarkdown(node: MarkdownTaskCheckboxNode): string;
/** An item's text that holds its checkbox alone, as the text Markdown reads it as: `[ ]`, or the marker with its brackets escaped (`\[x\]`). */
export function $emptyTaskItemMarkdown(node: MarkdownTaskCheckboxNode): string;
```

`createDOM` is `MarkdownImageNode.createDOM`'s shape:
`DOM.sink.createViewElement("span", { addClass, setAttr: { role: "checkbox", "aria-checked": … } }, keepElement)`,
the classes `config.theme.mdTaskCheckbox` and, when checked,
`config.theme.mdTaskCheckboxChecked`, throwing when no view is mounted.
`$openingCheckbox` takes a `LexicalNode` and reads its first child only when
`$isElementNode(text)`.

### `markdownNodeState.ts`

```ts
/**
 * The marker a task item's checkbox was loaded or typed with, as its item's first line writes it: `[ ]`, `[x]` or
 * `[X]`. `""` (the default) is a checkbox made in the editor, written `[ ]` or `[x]`.
 */
export const taskMarkerState: StateConfig<"mdTaskMarker", string> = createState("mdTaskMarker", {
    parse: (value) => (typeof value === "string" && /^\[[ xX]\]$/.test(value) ? value : ""),
});
```

### `markdownImporter.ts`

```ts
/** A task item's marker on its marker line: the list marker, its blanks, then `[ ]`, `[x]` or `[X]` (GFM, task list items). */
const AUTHORED_TASK_MARKER = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(\[[ xX]\])/;

function authoredTaskMarker(item: Tokens.ListItem): string;            // AUTHORED_TASK_MARKER.exec(item.raw)?.[1] ?? ""

/** Trims the blanks that end the last text node of an item's text: plain text only, not a source node or a code span; a node left empty goes. */
function $dropBlanksEndingItemText(text: ElementNode): void;
```

In `$buildListItem`'s keep callback: `itemText.clear()`; when `checkbox !== null`,
`itemText.append($createMarkdownTaskCheckboxNode((checkbox as Tokens.Checkbox).checked, authoredTaskMarker(item)))`;
`appendInlineTokens(…)` as today; then `$dropBlanksEndingItemText(itemText)`.
The call is `$buildKeepingConstructs(itemText, tokens, false, …)`.

### `markdownSerializer.ts`

- `appendSegments`: `else if ($isMarkdownTaskCheckboxNode(node)) { /* written by the item's writer */ }` before the source-node cases.
- ```ts
  /** An item's text with the marker of the checkbox it opens with, or its Markdown alone when it opens with none. */
  function withTaskMarker(text: ElementNode, written: string): string {
      const box = $openingCheckbox(text);

      if (box === null) {
          return written;
      }

      return written === "" ? $emptyTaskItemMarkdown(box) : $taskMarkerMarkdown(box) + written;
  }
  ```
- `buildItemBlocks`: `push(withTaskMarker(child, serializeInline(child, { ...MULTI_LINE, definitions, inListItem: true })), false, true);`
- `$writeRestOfBlock`, last lines: `const written = serializeInlineNodes(nodes, context);` then, when
  `$isMarkdownListItemTextNode(block)` and `$isMarkdownTaskCheckboxNode(nodes[0])`, return `withTaskMarker(block, written)`,
  else `written`.
- Remove `TASK_MARKER_SOURCE`, `strayTaskMarkersAsText` and its call; `assembleLines` keeps its `continues` comment
  without "or task checkbox".

### `markdownWritable.ts`

```ts
/**
 * Keeps a checkbox where Markdown reads one: first in a list item's text, or first straight in a list item, where
 * Lexical's list code and HTML import put inline nodes before the item's rule wraps them in its text. Anywhere else
 * it is replaced by a text node of its marker, followed by a space unless nothing follows it.
 */
function $keepCheckboxOpeningItemText(box: MarkdownTaskCheckboxNode): void;

/**
 * The checkbox rules a list item's text answers for: a checkbox that is no longer its first child takes the rule
 * above; a text holding its checkbox alone (blank text aside) shows the text its save reads as (`$emptyTaskItemMarkdown`
 * unescaped: `[ ]`, `[x]`) unless the selection stands in it ($selectionStandsIn) or a load runs (MARKDOWN_IMPORT_TAG).
 */
function $keepCheckboxesOfItemText(text: MarkdownListItemTextNode): void;
```

`registerWritableStateRules` adds
`editor.registerNodeTransform(MarkdownTaskCheckboxNode, $keepCheckboxOpeningItemText)` and
`editor.registerNodeTransform(MarkdownListItemTextNode, $keepCheckboxesOfItemText)`.
The replacement text is `marker.slice(0, 3)` of `$taskMarkerMarkdown(box)`, plus
`" "` when `box.getNextSibling() !== null`. `$opensTaskItem` becomes
`$isMarkdownListItemTextNode(block) && node.getPreviousSibling() === null && $isMarkdownTaskCheckboxNode(node)`.

### `MarkdownEditor.ts`

```ts
/** Registers the click, Ctrl/Cmd+Enter, Enter and composition rules of task items. */
function registerTaskItemRules(editor: LexicalEditor, isReadOnly: () => boolean, onRefused: () => void): () => void;
/** CLICK_COMMAND: a click on a checkbox toggles it as one undo step; a read-only editor refuses it. */
function $toggleClickedTaskCheckbox(event: MouseEvent, isReadOnly: () => boolean, onRefused: () => void): boolean;
/** KEY_ENTER_COMMAND: Ctrl+Enter (Cmd+Enter on macOS) toggles the checkboxes of the task items the selection touches. */
function $toggleTouchedTaskItems(event: KeyboardEvent | null): boolean;
/** INSERT_PARAGRAPH_COMMAND: Enter in a task item's text. */
function $enterSplitsTaskItem(): boolean;
/** Moves a collapsed caret before a task item's checkbox to right after it; returns whether it moved. */
function $settleCaretPastCheckbox(selection: BaseSelection | null): boolean;
/** The task toggle over the blocks a selection touches. */
function $toggleTaskItemsOfTouchedBlocks(selection: RangeSelection): void;
/** Whether a node is a list item's text in a list item, where the task shortcut applies. */
function $isTaskShortcutBlock(node: LexicalNode | null): node is MarkdownListItemTextNode;
```

- `registerTaskItemRules`: `mergeRegister` of `CLICK_COMMAND` (`LOW`), `KEY_ENTER_COMMAND` (`HIGH`),
  `INSERT_PARAGRAPH_COMMAND` (`HIGH`) and `COMPOSITION_START_COMMAND` (`CRITICAL`,
  `() => { $settleCaretPastCheckbox($getSelection()); return false; }`).
- `$toggleTouchedTaskItems`: the texts are the enclosing blocks (`$findEnclosingBlock`) of the anchor, the focus and
  `selection.getNodes()` that are list items' texts, each once; the checkboxes are their `$openingCheckbox`.
- `$enterSplitsTaskItem`: returns `false` unless the selection is a collapsed range in a list item's text that opens
  with a checkbox. `holdsOnlyBox` is every child the checkbox or blank text. When it holds only the box: remove the box
  when the item's list is not in a list item (top level), return `false`. Else: `caretAtStart` is whether every node
  before the caret in the text is the checkbox (the anchor an element point on the text at offset ≤ 1, or a text
  point whose previous siblings are the checkbox alone at offset 0); `selection.insertParagraph()`; `lower` is the
  enclosing block of the new caret; when `caretAtStart`, `lower.splice(0, 0, [box])` and
  `text.splice(0, 0, [$createMarkdownTaskCheckboxNode(false)])`, else `lower.splice(0, 0, [$createMarkdownTaskCheckboxNode(false)])`;
  return `true`.
- `$enterLeavesListAtBlankItemText`'s `isBlank` admits a first child that is a checkbox:
  `text.getChildren().every((child) => (blank text) || (child.is(text.getFirstChild()) && $isMarkdownTaskCheckboxNode(child)))`.
- `$settleCaretPastCheckbox`: for a collapsed range selection whose anchor is an element point at offset 0 on a list
  item's text whose first child is a checkbox, set both points to offset 1 of that text, `"element"`. Called first in
  `$settleSelectionOffContainers`, which returns `true` when it moved.
- `$toggleTaskItemsOfTouchedBlocks`: as the decision says; the touched blocks are `$touchedBlocksLastFirst(selection)`,
  read once before and once after `$makeItemsOf` (the selection moves with the blocks).
- `registerHeldBlockShortcuts`: `isInHeldBlock` is `$isHeldBlockTakingText(parent) || $isTaskShortcutBlock(parent)`;
  `$runHeldBlockShortcut`'s `isFirstText` admits a task shortcut block, and for one it returns
  `!onEnter && endsInSpace && $applyElementShortcut(block, anchor, offset, false, [TASK_ITEM_SHORTCUT])`;
  `$applyElementShortcut` takes `shortcuts: readonly ElementTransformer[] = ELEMENT_SHORTCUTS`.
- `toggleTaskList()` and the two menu entries.

### `markdownSourcePlaces.ts`

```ts
if (block.type === "checkbox") {
    if ($isMarkdownTaskCheckboxNode(unit.node) && block.start !== NOT_FOUND) {
        unit.start = block.start;
        unit.end = block.end;
        walk.at += 1;
    }

    return 0;
}
```

In `$placeAmongUnits`: `const endOf = (unit: ShownUnit): number => ($isMarkdownTaskCheckboxNode(unit.node) ? unit.start : unit.end);`
and `firstAfter = units.findIndex((unit) => unit.start !== NOT_FOUND && endOf(unit) > offset)`.

### `Markdown.ts`

```ts
/** Builds a task item's checkbox: a read-only `role="checkbox"` span, checked for `[x]` and `[X]`. */
private appendTaskCheckbox(parent: Handle, token: Tokens.Checkbox): void;
```

`TASK_CHECKBOX_CLASS = "ts-ui-md-task-checkbox"`, `TASK_CHECKBOX_CHECKED_CLASS = "ts-ui-md-task-checkbox-checked"`
beside `LIST_CLASS` ([:34](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L34)).

---

## Ordered Implementation Steps

Run commands from `packages/lib` unless a step says "repo root". Do not run
`npm install`. Run one Vitest process at a time, with `--maxWorkers=2` for a
large run. Work test-first inside each step. The suites of a step are
`npx vitest run --maxWorkers=2 tests/component/markdown-*.test.ts tests/component/markdown-roundtrip tests/component/display/`.
Start on the finished horizontal-rules branch.

**Step 1 — the node and the viewer**

1. Tests first: create `tests/component/markdown-task-checkbox-node.test.ts`
   (node rows) and `tests/component/markdown-task-checkbox-node-html.test.ts`
   (HTML rows, `@vitest-environment jsdom`, no `installTestDOM`, as
   `markdown-quote-node-html.test.ts`), and the viewer rows of
   `tests/component/display/Markdown.test.ts`; restate `BF12`–`BF17`.
2. `markdownNodeState.ts`: `taskMarkerState`.
3. Create `markdownTaskCheckboxNode.ts`; add it to `EDITOR_NODES` and its
   JSDoc in `editorNodes.ts`.
4. `editorTheme.ts`: the two classes, their rules and the two theme keys.
5. `Markdown.ts`: the two class constants and rules, `appendTaskCheckbox`, the
   two `"checkbox"` cases, the JSDoc of `appendListItem` and of the class.
   Check: `npm run typecheck` (repo root).

**Step 2 — load and save**

This step cannot be cut into green halves: once the importer builds the node,
the serializer, the writable rules and the view model must all read it.

6. Tests first: create `tests/component/markdown-editor-task-items.test.ts`
   with the harness of `markdown-editor-quotes.test.ts` (copied: `lexicalOf`,
   `load`, `$textNode`, `selectText`, `press`, `shapeOf`,
   `expectSaveKeepsDocument`, `runRow`), `shapeOf` writing a checkbox as
   `checkbox(checked)` or `checkbox(unchecked)`, and a `selectBeforeCheckbox(editor, text)`
   helper that sets an element caret at offset 0 of the item text holding
   `text`. Add the load, save, preservation and empty-item rows.
7. `markdownImporter.ts`: `AUTHORED_TASK_MARKER`, `authoredTaskMarker`,
   `$dropBlanksEndingItemText`, the change in `$buildListItem`.
8. `markdownSerializer.ts`: the `appendSegments` case, `withTaskMarker`, its two
   callers, the removals.
9. `markdownWritable.ts`: the two rules and their registration, `$opensTaskItem`,
   the removal.
10. `tests/component/markdown-roundtrip/viewModel.ts`: `Run` gains
    `{ kind: 'checkbox'; checked: boolean }`; `viewerListItem` passes the
    checkbox token itself as the marker (no text token), `viewerInlineToken`
    gains `case 'checkbox'`, `editorInlineNode` a checkbox branch before the
    image's; `collectRunLinks` reads no link off a checkbox run; `outlineRuns`
    writes it `[ ] ` or `[x] `. Restate `V16`–`V22`.
11. `markdownSourcePlaces.ts`: the checkbox case and `$placeAmongUnits`; restate
    `SP5`, `SP13`, `SP14`, `SP16`.
12. Restate the importer, reload-differences, list-item-paste and `T10 OL`
    rows. Run the suites: what fails now is the editing, command and paste rows.

**Step 3 — clicking, the keyboard, Enter, the caret**

13. Tests first: create `tests/component/markdown-editor-task-items-mounted.test.ts`
    (`@vitest-environment jsdom`, the `mounted` helper of
    `markdown-editor-readonly-mounted.test.ts`) with the click rows; add the
    keyboard, Enter, Backspace and caret rows to `markdown-editor-task-items.test.ts`.
14. `MarkdownEditor.ts`: `registerTaskItemRules` and its four listeners,
    `$settleCaretPastCheckbox` and its call in `$settleSelectionOffContainers`,
    `$enterSplitsTaskItem`, the `isBlank` change, the registration in
    `registerEditorRules`. Run the suites.

**Step 4 — the shortcut, the toggle, the menus, paste**

15. `markdownTransformers.ts`: `TASK_ITEM_SHORTCUT`. `MarkdownEditor.ts`:
    `$isTaskShortcutBlock`, the `registerHeldBlockShortcuts`,
    `$runHeldBlockShortcut` and `$applyElementShortcut` changes.
16. `MarkdownEditor.ts`: `toggleTaskList`, `$toggleTaskItemsOfTouchedBlocks`,
    the empty-line menu entry, `canSetBlockType`'s JSDoc, and the JSDoc of the
    two list toggles and `setBlockType` (*Documentation Impact*).
    `MarkdownDocumentPanel.ts`: the Insert dropdown entry.
17. `editorNodes.ts`: the replacement keeps `__checked`. `markdownListItemNode.ts`:
    the `keepingNestedLists` change.
18. Add the shortcut, toggle, menu and paste rows; restate the `N1` rows; run
    the suites and `tests/component/markdown-document-panel.test.ts`.

**Step 5 — source mode**

19. `languages.ts`: the task-marker extension. Add the source-mode rows and
    the highlighting row; run the suites and `tests/component/code-editor.test.ts`.
20. Checkpoints:
    - `grep -rn 'TASK_MARKER_SOURCE\|strayTaskMarkersAsText' src/` — no match.
    - `grep -rn 'checkbox.raw, checkbox.raw' src/` — no match.
    - `grep -rn "\['\[[ x]\] ', [0-9]\]\|source: '\[ \] '" tests/component/` — no match (no row selects or pins the run).

**Step 6 — docs, known issues, full checks**

21. *Documentation Impact*.
22. Remove the fixed known-issue entries (*What becomes dead or changes*).
23. *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/editor/markdownTaskCheckboxNode.ts` |
| Create | `packages/lib/tests/component/markdown-task-checkbox-node.test.ts` |
| Create | `packages/lib/tests/component/markdown-task-checkbox-node-html.test.ts` |
| Create | `packages/lib/tests/component/markdown-editor-task-items.test.ts` |
| Create | `packages/lib/tests/component/markdown-editor-task-items-mounted.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorNodes.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownNodeState.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownImporter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceNodes.ts` (JSDoc) |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/languages.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/viewModel.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-view-model.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-places.test.ts` |
| Modify | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-reload-differences.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-nested-source-preservation.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-list-item-paste.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-typing-shortcuts.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-mode-through-model.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-readonly-mounted.test.ts` |
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
text node whose text is exactly `x`; "before the checkbox" is an element
caret at offset 0 of the item's text. In a shape, `checkbox` is
`markdown-task-checkbox`, `item` and `text` the list item and its text.
`Backspace` and `Delete` are `DELETE_CHARACTER_COMMAND`, `Backspace key` is
`KEY_BACKSPACE_COMMAND`, `Enter` is `KEY_ENTER_COMMAND` with a stand-in event,
as in `markdown-editor-list-item-edits.test.ts`; `Ctrl+Enter` is that event
with `ctrlKey: true` (the macOS form is manual check 3). Every row with
steps in `markdown-editor-task-items.test.ts` runs that file's
`expectSaveKeepsDocument` after the load and after each step, except the rows
that hold an empty task item, which check the save they name. The rows' names
are their first column.

### The node (`markdown-task-checkbox-node.test.ts`)

| Row | Check |
|---|---|
| a checkbox survives a JSON round trip with its state | load `- [X] a`, `parseEditorState(JSON.stringify(state.toJSON()))` into a second editor: one checkbox, checked, state `[X]` |
| a checkbox made in the editor has no state | `$createMarkdownTaskCheckboxNode(false)`: state `""`, `$taskMarkerMarkdown` gives `[ ] ` |
| the state holds a task marker only | `$setState(box, taskMarkerState, x)` for `[ ] `, `[y]`, `x` gives `""`; for `[X]` gives `[X]` |
| the written marker follows the box's state | a box with state `[X]`, unchecked: `[ ] `; checked again: `[x] ` |
| a checkbox is inline text of its marker | `isInline()` is `true`, `isKeyboardSelectable()` is `false`, `getTextContent()` is `[x] ` and `[ ] ` |
| an empty task item reads as text | `$emptyTaskItemMarkdown`: unchecked `[ ]`, checked `\[x\]`, state `[X]` checked `\[X\]` |

### The node's HTML (`markdown-task-checkbox-node-html.test.ts`)

| Row | HTML or check | Result |
|---|---|---|
| a GitHub task list | the first row of *Paste and copy*'s table, through `$generateNodesFromDOM` | `list(item(text(checkbox(unchecked), "todo")), item(text(checkbox(checked), "done"))))`, saved `- [ ] todo` / `- [x] done` |
| items marked aria-checked | the second row | saved `- [x] a` / `- [ ] b` |
| an ordered task list with a plain item | the third row | saved `1. [x] one` / `2. plain` |
| a Lexical check list | `<ul __lexicallisttype="check"><li aria-checked="true" role="checkbox">x</li></ul>` | saved `- [x] x`; the list's type is `"bullet"` |
| a checkbox outside a list | `<p>a <input type="checkbox" checked> b</p>` | a paragraph, no checkbox |
| a copied task item leaves as a checkbox input | `$generateHtmlFromNodes` of `- [ ] a` / `- [x] b` | holds `<input type="checkbox" disabled="">` and `<input type="checkbox" disabled="" checked="">` |
| a mounted checkbox | a mounted root, `- [ ] one` / `- [x] two` | two `span`s with `role="checkbox"`, `aria-checked` `false` and `true`, the class `ts-ui-mde-task-checkbox`, the second also `ts-ui-mde-task-checkbox-checked` |

### The viewer (`display/Markdown.test.ts`)

| Row | Source | Renders |
|---|---|---|
| renders a task item's checkbox before its text | `- [ ] task` | the `li` holds a `span` with `role="checkbox"`, `aria-checked="false"`, `aria-readonly="true"` and the class `ts-ui-md-task-checkbox`, then `task`; no text write `[ ] ` (restates `BF12`) |
| renders checked and unchecked checkboxes | `- [x] done` / `- [ ] todo` | the first `span` carries `ts-ui-md-task-checkbox-checked` and `aria-checked="true"` (restates `BF13`) |
| renders the checkbox before text holding an escape | `- [ ] see \[docs\]` | a checkbox, then `see `, then `[docs]` (restates `BF14`) |
| renders a loose task item's checkbox in its first paragraph | `- [ ] foo` / (blank) / `  [x] bar` | `li` holds `P`, `P`; the first `p` holds the checkbox then `foo`; the second the text `[x] bar` (restates `BF16`) |
| renders the checkbox of a task item a nested list makes loose | `- [x] **a** b` / (blank) / `  - c` | the `p` holds the checkbox, `STRONG`, `SPAN` (restates `BF17`) |
| renders an ordered and a mixed task list | `1. [X] a` / `2. b` | an `ol`; the first `li` a checked checkbox, the second none |
| renders no checkbox without text after the marker | `- [ ]` | the text `[ ]` |

### Load and save (`markdown-editor-task-items.test.ts`)

| Row | Source | `shape` | `saved`; standard form |
|---|---|---|---|
| a task item of each marker | `- [ ] a`, `* [x] a`, `+ [X] a`, `1. [ ] a`, `1) [x] a` | `list(item(text(checkbox, "a")))`, checked for `x`/`X` | the source; the same |
| a mixed list | `- [ ] a` / `- b` | a task item, then a plain item | the source |
| a nested task item | `- [ ] a` / `  - [x] b` | the nested item a task item | the source |
| a loose task list | `- [ ] a` / (blank) / `- [x] b` | two task items, loose | the source |
| a task item holding a paragraph | `- [x] a` / (blank) / `  b` | `item(text(checkbox, "a"), paragraph("b"))` | the source |
| a task item in a quote | `> - [ ] q` | `markdown-quote(list(item(text(checkbox, "q"))))` | the source |
| a task item in a column | `::: columns` / `- [ ] a` / `\|\|\|` / `b` / `:::` | the column holds the list | the source |
| a marker followed by spaces | `- [x]   a` | a task item | the source; `- [x] a` |
| a marker followed by a tab | `- [ ]`, a tab, `a` | a task item | the source; `- [ ] a` |
| an escaped marker is text | `- \[ \] a` | `item(text("[ ] a"))` | the source |
| a marker with nothing after it is text | `- [ ]` | `item(text("[ ]"))` | the source |
| text holding a marker after the checkbox | `- [ ] \[x\] a` | `item(text(checkbox, "[x] a"))` | the source |
| a task item whose marker is a defined label | `[x]: /u` / (blank) / `- [x] done` | a task item | edited (`!` after `done`): `[x]: /u` / (blank) / `- [x] done!` |
| a task item opening with a no-break space | `- [x] &nbsp;a` | `item(text(checkbox, " a"))` | edited: `- [x] &nbsp;a!`, reloaded and saved again unchanged |
| the blanks ending an item's text | `- [ ] ` / `- [x] `; `- a ` / `- b` | `text("[ ]")`, `text("[x]")`; `text("a")` | the source |
| an edited item keeps an upper-case X | `- [X] a` | | edited: `- [X] a!` |

**Every placement saves so that it reloads as shown.** For each of `[ ]`,
`[x]`, `[X]` and a checkbox made in the editor, each list marker (`-`, `*`,
`+`, `1.`, `1)`), and each placement — the only item; the first and the last
of three; nested under a plain item and under a task item; the item holding a
paragraph, a nested list or a quote after its text; in a quote; in a column;
in a loose list — the save, read by the viewer, equals the editor's shape, the
save reloads as the same shape, and saves again unchanged. The prototype's
corpus runs and fuzz passed with these shapes.

### Preservation (`markdown-editor-nested-source-preservation.test.ts`, a new group *task items*)

| Row | Source | Edit | Saved |
|---|---|---|---|
| an unedited task item keeps its form | `- [X]   a` / `- b` | `!` after `b` | `- [X]   a` / `- b!` |
| an edited task item keeps its letter | `- [X]   a` / `- b` | `!` after `a` | `- [X] a!` / `- b` |
| a toggled task item is written in the standard form | `- [X] a` / `- b` | click (`setChecked(false)` in an update) | `- [ ] a` / `- b` |

### The empty task item

| Row | Steps | Shown; saved |
|---|---|---|
| an emptied task item keeps its checkbox while the caret is in it | `- [ ] a` / `- b`, delete `a` | `item(text(checkbox))`; `- [ ]` / `- b` |
| then typing gives it text | type `z` | `item(text(checkbox, "z"))`; `- [ ] z` / `- b` |
| a checked empty task item saves escaped | `- [x] a` / (blank) / `[x]: /u`, delete `a` | the checkbox; `- \[x\]` / (blank) / `[x]: /u` (restates *a task marker left alone in its item, with a definition naming its label*) |
| an edit that leaves the caret outside it shows its text | `- [ ] a` / `- b`; in one update, remove the text node `a` and put the caret at `b`@1 | `item(text("[ ]"))`, the text and no checkbox; `- [ ]` / `- b`, which reloads as shown |

### Editing

| Row | Document | Steps | After |
|---|---|---|---|
| Enter at the end of a task item opens an unchecked one | `- [ ] one` | Enter at `one`@3 | `- [ ] one` / `- [ ]`, the caret after the new checkbox |
| Enter in a task item's text splits it | `- [x] two` | Enter at `two`@1 | `- [x] t` / `- [ ] wo` |
| Enter right after the checkbox opens a task item above | `- [x] two` | Enter at `two`@0 | `- [ ]` / `- [x] two`, the caret at `two`@0 |
| Enter on an empty task item ends the list | `- [ ] one` | Enter at `one`@3, Enter | `- [ ] one`, then an empty paragraph with the caret |
| Enter on an empty nested task item moves it out | `- a` / `  - [ ] one` | Enter at `one`@3, Enter, Enter | `- a` / `  - [ ] one` / `- [ ]`, then `- a` / `  - [ ] one` and an empty paragraph |
| each Enter is one undo step | the first three rows | one undo | the document before |
| Backspace right after the checkbox removes it | `- [ ] one` / `- [x] two` | Backspace key at `two`@0 | `- [ ] one` / `- two`; one undo brings it back |
| Backspace after a nested item's checkbox removes it | `- a` / `  - [x] two` | Backspace key at `two`@0 | `- a` / `  - two` |
| a second Backspace does what it does in a plain item | `- [ ] one` / `- [x] two` | Backspace key at `two`@0, twice | `- [ ] one`, then the paragraph `two` |
| a caret before the checkbox types after it | `- [ ] one` / `- [x] two` | before the checkbox of `two`, `CONTROLLED_TEXT_INSERTION_COMMAND` `Z` | `- [x] Ztwo` |
| Backspace before the checkbox removes it | same | before it, Backspace | `- two` |
| Delete before the checkbox deletes after it | same | before it, Delete | `- [x] wo` |
| Enter before the checkbox opens a task item above | same | before it, Enter | `- [ ]` / `- [x] two` |
| a paste before the checkbox goes after it | same | before it, `PASTE_COMMAND` of the text `Q` | `- [x] Qtwo` |
| text inserted before a checkbox by code turns it into text | `- [x] done` / (blank) / `[x]: https://e.com` | before the checkbox, `selection.insertText('}}')` (no command) | `- }}\[x\] done` (restates the row *a checkbox that text typed before it leaves inside its item's line*) |
| a line break inserted before a checkbox by code turns it into text | `- [x] done` / (blank) / `[x]: /u` | before the checkbox, `insertText('a')`, `insertLineBreak()` | `- a\` / `  \[x\] done` (restates *a checkbox a line break moves off its item's first line*) |
| a checkbox joined into a paragraph becomes its text | `p` / (blank) / `- [x] a` | Delete at `p`@1 | `p\[x\] a` |
| bold over a task item formats its text | `- [ ] a` | from before the checkbox to `a`@1, `toggleBold()` | `- [ ] **a**` (restates *#6 … bold over a task marker and its text is declined*) |
| colour over a task item's checkbox styles nothing | `- [ ] a` | from before the checkbox to `a`@0, `setTextColor('#cc0000')` | `- [ ] a`, no style written (restates *#6 … colour on a task marker is declined*) |
| list toggles over task items | the four list-toggle rows of *A checkbox stands only first* | | as the table gives |

### Clicking (`markdown-editor-task-items-mounted.test.ts`, jsdom, real DOM events)

| Row | Document | Steps | After |
|---|---|---|---|
| a click on a checkbox toggles it | `- [ ] one` / `- [x] two` / (blank) / `para` | a `click` `MouseEvent` (`button: 0`, `detail: 1`, bubbling) on the first `[role="checkbox"]` | `- [x] one` / `- [x] two` / (blank) / `para`; one `"change"`; the span carries the checked class |
| each click is one undo step | same | click the first, click the second, undo, undo | after the first undo `- [x] one` / `- [x] two`; after the second the source |
| a click elsewhere toggles nothing | same | a click on the text of `one` | the source |
| a read-only editor refuses a click on a checkbox | `- [ ] one`, read-only | click the checkbox | `- [ ] one`; `"readonlyedit"` once; the wash played once |

### Ctrl+Enter

The five rows of the Ctrl+Enter decision's table, each one undo step, and a
read-only row: Ctrl+Enter in a read-only editor changes nothing and fires
`"readonlyedit"` once.

### Typing shortcuts (`markdown-editor-typing-shortcuts.test.ts`)

The six rows of the shortcut decision's table, each typed one character per
update as that file types, each followed by one undo that gives back the
typed text (`- \[ \] a` for the first). `markdown-editor.test.ts`'s row
*contains exactly the twelve typing shortcuts* (after the horizontal-rules
plan) is unchanged: `TASK_ITEM_SHORTCUT` is no member of `SHORTCUT_TRANSFORMERS`.

### The task toggle and the menus

| Row | Check |
|---|---|
| toggleTaskList makes task items or takes their checkboxes off | the nine rows of the toggle decision's table, each one undo step, the save reading as shown |
| toggleTaskList gives the same document in source mode | each of those nine rows through `runInSource` (`markdown-source-mode-through-model.test.ts`), the source selection from the first to the last named text: the WYSIWYG row's save |
| a read-only editor refuses toggleTaskList | nothing changes; `"readonlyedit"` once, on both surfaces |
| toggleTaskList declines in a table cell | `\| a \|` / `\| - \|` / `\| b \|`, caret in `b`: nothing |
| the empty-line Insert submenu offers Task list after Numbered list | `markdown-editor.test.ts`: the submenu's labels are `'Quote', 'Code block', 'Bulleted list', 'Numbered list', 'Task list'`, a separator, then the inserts; the entry enabled on `canSetBlockType` and calling the command |
| the Insert dropdown offers Task list | `markdown-document-panel.test.ts`: `'Task list'` after `'Numbered list'`, with its value in each of the three dropdown rows |
| the freeze sweep runs toggleTaskList | `markdown-source-mode-through-model.test.ts`'s command list gains `['toggleTaskList', …]` beside the list toggles |
| the read-only route rows run toggleTaskList | `markdown-editor-readonly-mounted.test.ts`'s command list gains it beside `toggleOrderedList` |

### Paste (`markdown-editor-task-items.test.ts`)

| Row | Pasted | At | After |
|---|---|---|---|
| a copied task item pasted into a paragraph | `- [x] done`, copied from before its checkbox to `done`@4 (`$generateJSONFromSelectedNodes`) | `para`@2 | `pa` / (blank) / `- [x] done` / (blank) / `ra` |
| pasted at an item's start it makes the item a task item | same | `b`@0 in `- b` | `- [x] doneb` |
| a checkbox pasted mid-text becomes its text | the checkbox and `x` copied from `- [ ] x` | `ab`@1 | `a\[ \] xb` |

### Source mode (`markdown-source-places.test.ts`, `markdown-source-mode-through-model.test.ts`, `code-editor.test.ts`)

| Row | Check |
|---|---|
| an offset in a checkbox's source is after it | the four rows of the places table |
| the corpus differential | `9: part 6` passes with *loose task list* and the corpus's other task cases (the prototype found the caret one character off until `$placeAmongUnits` counted the checkbox's start) |
| a source caret after the checkbox acts on its item | `- [ ] one` / `- [x] two`, source caret in `[x]`, `setBlockType("h2")`: `- [ ] one` / (blank) / `## \[x\] two` |
| task markers are highlighted as list markup | `code-editor.test.ts`: `syntaxNodes('- [ ] a\n- [x] b\n- [ ]\n- [ ]\tc\n- \\[ ] d')` holds `TaskMarker[2,5]`, `TaskMarker[10,13]`, `TaskMarker[24,27]`, no `Task` for the third and fifth items; `syntaxNodes('a [ ] b')` holds no `Task` |

### Corpus and fuzz

- `corpus/dialect.ts` gains: *a task item with an upper-case X* (`- [X] a`),
  *an ordered task list* (`1. [ ] a` / `2. [x] b`), *a mixed task list*
  (`- [ ] a` / `- b`), *a task item in a quote* (`> - [x] q`), *a task item
  holding a paragraph* (`- [ ] a` / (blank) / `  p`), *a marker followed by
  spaces* (`- [x]   a`). It already holds *loose task list* and *loose task
  list with a nested item and a paragraph*.
- The edit fuzz and the nested edit fuzz run over the corpus as they are.

### Tests that are restated

| File | Row | Today | Restated | Why |
|---|---|---|---|---|
| `display/Markdown.test.ts` | `BF12`, `BF13`, `BF14`, `BF16`, `BF17` | the marker a text write `[ ] ` in a `SPAN` | the checkbox `span` (*The viewer* rows) | the viewer draws a checkbox |
| `markdown-view-model.test.ts` | `V16`, `V18`, `V19`, `V20`, `V22` | `textRun('[ ] foo')`-style runs | `{ kind: 'checkbox', checked }` then the text run (`foo`) | the view model's checkbox run |
| same | `V21` | `textRun('[ ] foo')` and the cell `[x] baz` | a checkbox run and `foo`; the cell stays the text `[x] baz` | the same; a cell's marker is text |
| `markdown-source-places.test.ts` | `SP5`'s three task rows, `SP13`'s sixty, `SP16`'s ten | `{0§:…[x] }` runs in the expected place strings | `<markdown-task-checkbox>` in their place, the caret after it for every offset in the marker and the blanks after it (`[[[<markdown-task-checkbox>¦cd]]]`); the one `SP16` row `- ¦[x]`, a tab, `Alpha beta` takes what the prototype gives, `[[[¦<markdown-task-checkbox>Alpha beta]]]` | the checkbox is one unit |
| same | `SP14`'s three rows on `- [x] next` | a place inside the source node `[x] ` | removed: the checkbox is no source node; the row set keeps its other source nodes | |
| `markdown-editor.test.ts` | `T10 OL` | `1. \[x\] one` / … | `1. [x] one` / (blank) / `- two` / (blank) / `[x]: /url` | the defined-label known issue, fixed |
| same | the six `N1` rows | a caret inside the word of the run `[x] ` | *N1: a caret right after a task item's checkbox*: `two`@0 of `- [ ] one` / `- [x] two`; its `available` list is the one A1 reports plus `canInsertParagraphAroundBlock` (confirm on the first run and keep what the editor reports; it must hold `canFormat`, since the checkbox is no run kept as source) | no marker word |
| `markdown-importer.test.ts` | `I21: a task-list checkbox is a source node before the item text` | `{ source: '[ ] ' }` | *I21: a task-list checkbox is a checkbox node before the item text*: `summarize` gains a checkbox entry `{ checkbox: false }`; `[{ checkbox: false }, { text: 'task' }]` | the subject |
| same | the two *#6 formatting declines over a run kept as source* task rows | declined | restated under *Editing* (bold formats the text; colour styles nothing) | the checkbox is no run |
| same | *a task marker left alone in its item*: *with a definition naming its label*, *unchecked* | saves `- \[x\]`, `- \[ \]` and shows the text | *an emptied task item keeps its checkbox while the caret is in it*: saved `- \[x\]` / … and `- [ ]`; the editor shows the checkbox (the view-model check of the row is dropped: the rule of the empty item) | the empty task item |
| same | *a checkbox that text typed before it leaves…*, *a checkbox a line break moves off…* | `select(editor, ['[x] ', 0])` | the caret before the checkbox (`selectBeforeCheckbox`); expected saves unchanged | no run to select |
| `markdown-editor-reload-differences.test.ts` | `W3` (*the same at the start of a task item, after its marker*) | `markdown-list-item-text("[ ] ", "xt0")` | `markdown-list-item-text(markdown-task-checkbox, "xt0")`; save unchanged | the node |
| `markdown-editor-list-item-paste.test.ts` | *a task item's paragraph* | the clipboard starts at `['[ ] ', 0]`; the shape holds `"[ ] "` and `"[x] "` | the clipboard starts before the first item's checkbox; the shape holds `markdown-task-checkbox` in their place; save unchanged | the node |

### Manual (browser) checks

Run the demo app's Markdown editor (`npm run dev`, repo root, the Markdown
document panel), in Chromium and in WebKitGTK, in both themes:

1. `- [ ] a`, `- [x] b`, `1. [X] c` show a box after the marker, vertically
   centred on the line, the checked one filled with the accent and a white
   check; the viewer and the editor match, also at the viewer's larger font
   scales and in a loose and a nested list.
2. A click on a box toggles it at once; Ctrl+Z takes it back; the caret goes
   into the item beside the box and the page does not scroll. In a read-only
   editor a click flashes and changes nothing.
3. Ctrl+Enter (Cmd+Enter on macOS) toggles the item the caret is in, and a
   range's items together.
4. ArrowLeft from the start of an item's text passes the box in one step, and
   the next goes to the line above; typing there types after the box; a click
   left of the box puts a caret there that types after it.
5. Enter at the end of a task item opens an unchecked one; Enter on it again
   ends the list; Backspace right after a box removes it.
6. An input method (a dead key, a Japanese input method) started before the
   box writes after it.
7. Typing `- [ ] ` in an empty paragraph gives a task item with the caret
   after the box.
8. Insert ▸ Task list in the panel and the empty-line menu, in WYSIWYG and
   source mode.
9. Paste a task list copied from a GitHub issue: a list of task items with
   their states. Copy a task item and paste it into another application: a
   checkbox, where that application reads one.
10. Source mode shows `[ ]` and `[x]` muted at the start of a task item, and
    not after an escape or in a paragraph.
11. A screen reader (or the browser's accessibility tree) reports each box as
    a checkbox with its state; in the viewer as read-only.

---

## Verification

- `npm run typecheck` and `npm run lint` (repo root): clean. The node and the
  viewer name no DOM type (`no-raw-dom`).
- The suites of the steps, then `npx vitest run --maxWorkers=2` (the whole
  library suite) and `npm run typecheck:test` (`packages/lib`). The read-only
  command classification test passes unchanged: the new listeners are on
  commands it already classifies.
- `npm run docs:api` (repo root): zero warnings. The new public symbol is
  `toggleTaskList`; its JSDoc links only public symbols.
- The grep checkpoints of step 20.
- *Manual (browser) checks*.

---

## Documentation Impact

- `docs/components/Markdown.md`:
  - *Supported syntax*: the row for `- [ ] task`, `- [x] done` reads "an `<li>`
    whose text — in a loose list, whose first paragraph — starts with a
    read-only checkbox (`role="checkbox"`), checked for `[x]` and `[X]`; the
    marker needs text after it on its line".
  - *Fallback for unsupported tokens*: raw HTML alone; the task lists leave
    the sentence.
  - The `Markdown` class JSDoc in `Markdown.ts` likewise.
- `docs/components/MarkdownEditor.md`:
  - *Supported constructs*: a row *Task item* | `- [ ] `, `- [x] `; a loaded
    `[X]` is kept; one space after the marker once its item is edited.
  - *Kept as source*: "task-list markers" leaves the list of atomic runs, and
    so does the parenthesis about a marker saved as the text it shows; the
    sentence on the format toggles' decline drops "a task-list marker inside
    `**` is no longer one"; the last sentence's limit on "a task item whose
    checkbox is followed by more than one space in a list with blank lines
    between its items" stays.
  - *What Markdown cannot hold*: a bullet **Task items** — a checkbox stands
    only first in a list item's text, and anywhere else becomes the text it
    saves as (`[x] `), as when its text leaves its list; a task item with no
    text after its checkbox keeps the checkbox while the caret is in it,
    saves as `- [ ]` (`- \[x\]` when checked), and once an edit of it leaves
    the caret elsewhere shows that text. The *Whitespace at a line's start*
    bullet keeps "after a task marker", which now reads "after a task item's
    checkbox".
  - *Formatting*: the shortcut list gains `[ ] `, `[x] ` or `[X] ` at the start
    of a list item's text → a task item; the keyboard list gains Ctrl/Cmd+Enter
    (toggle the task items the selection touches) and a click on a checkbox;
    the context menu's Insert submenu lists **Task list**.
  - *Command API*: a row for `toggleTaskList()`; the list toggles' row and
    `setBlockType`'s keep their sentence on the marker ("stays a marker while
    its item stays an item, and becomes the text it shows when the item's
    text leaves its list"), with "checkbox" for "marker"; a sentence after the
    table: Enter in a task item opens an unchecked one, Enter on an empty one
    ends the list (a nested one moves out a level), Backspace right after a
    checkbox removes it, and a caret before a checkbox acts as one right after
    it. The source-mode list of commands run through the model gains
    `toggleTaskList`.
  - *Live selection state*: `canSetBlockType` names the three list toggles.
  - *Read-only*: the refused edits name a click on a checkbox and
    `toggleTaskList`.
  - *Theming*: the checkbox uses the `Checkbox` tokens (`--ts-ui-form-border`,
    `--ts-ui-checkbox-radius`, `--ts-ui-checkbox-bg`, `--ts-ui-checkbox-bg-selected`,
    `--ts-ui-checkbox-check-color`).
  - The JSDoc of `toggleUnorderedList`, `toggleOrderedList` and `setBlockType`
    ([MarkdownEditor.ts:9397](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L9397),
    [:9432](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L9432),
    [:9802](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L9802))
    and of the code conversion ([:390](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L390))
    say "checkbox" for "marker".
- `docs/components/MarkdownDocumentPanel.md`: the Insert row of the table
  ([:26](../packages/lib/docs/components/MarkdownDocumentPanel.md#L26)) and the
  paragraph at [:37](../packages/lib/docs/components/MarkdownDocumentPanel.md#L37)
  name Task list after Numbered list.
- `docs/reference/changelog/next.md`:
  - **Breaking changes › Components**: *`Markdown` and `MarkdownEditor` show
    task-list items with a checkbox* — the viewer draws a read-only checkbox
    where `[ ] ` showed; the editor holds a checkbox node in place of the
    marker run, toggled by a click or Ctrl/Cmd+Enter; Enter, Backspace and the
    shortcut; a format over a task item now applies to its text; links the
    migration note.
  - **Added › Components**: *`MarkdownEditor.toggleTaskList()`*, with the
    Task list entries of the context menu and of `MarkdownDocumentPanel`, and
    HTML check lists pasted as task items.
  - **Fixed › Components**: *`MarkdownEditor` keeps a task item a task item
    through a save* — an edited item whose marker is also a defined label
    (`[x]: /u`) was saved as text `\[x\]`, and one whose text opens with a
    no-break space was saved so that the next load read no task item; and *the
    blanks that end a list item's text no longer show* (`- [ ] ` showed
    `[ ] `, `- a ` showed `a `, which the save dropped).
  - The unreleased entries this makes untrue are corrected in place: the
    Fixed entry *`Markdown` shows a task-list item's marker*
    ([:1326](../packages/lib/docs/reference/changelog/next.md#L1326)) drops
    "The marker is still literal text, not a checkbox" and says "the item now
    shows its checkbox (see Breaking changes)"; the Changed entry on the list
    toggles ([:511](../packages/lib/docs/reference/changelog/next.md#L511)) is
    still true and is left.
- `docs/reference/migration/next.md`: a new section *Task-list items show a
  checkbox in `Markdown` and `MarkdownEditor`*, with *What changed and why* (a
  table: `- [ ] a` in the viewer, before the text `[ ] a`, now a checkbox; in
  the editor, before an atomic run `[ ] `, now a checkbox node of type
  `markdown-task-checkbox`; bold over a task item, before declined, now bold
  text) and *Who needs to act* (CSS or tests that read the viewer's `[ ] `
  text read the `role="checkbox"` span; code that read the editor's tree for a
  `MarkdownSourceTextNode` holding `[ ] ` reads the checkbox node; content
  that showed `[ ]` as text at an item's start on purpose writes `\[ \]`).
- `packages/lib/llms.txt` names no Markdown command; no change.

---

## Potential Challenges

- **A node in the text that is no text.** Code that reads an item's text as
  text nodes meets a decorator first. The prototype ran every Markdown suite;
  a new site shows as a checkbox lost or doubled in a save, which the
  placement rows and the fuzz catch.
- **The click's caret.** jsdom has no browser selection, so where the caret
  goes after a click is a manual check (2). If the browser puts it before the
  box, `$settleCaretPastCheckbox` covers every edit; nothing else needs it.
- **A composition before the box** (manual check 6). If the browser starts it
  before Lexical's settled caret takes effect, the text lands before the box
  and the checkbox rule turns the box into text. Should that show, settle at
  `KEY_DOWN_COMMAND` for a key that starts a composition instead, and record
  it.
- **The empty-item rule fires in a transform.** It reads the selection the
  update leaves; a command that moves the caret elsewhere in a later update
  leaves the checkbox shown until the item's next edit, as the whitespace rule
  leaves a space. The rows pin the update in which it fires.
- **`N1`'s availability list.** Its values are taken from the first run, as
  the restated table says; they must hold `canFormat`.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/editor/markdownImageNode.ts` | the inline decorator precedent: createDOM through the seam, fields for the model |
| `plans/markdown-horizontal-rules.md` and its implementation | the node shape, the click listener, the viewer token case, the source-places `hr` case beside the checkbox case |
| `plans/implemented/markdown-list-toggle-task-item-parity.md` | rule 5 for the marker, and the list toggles this plan's toggle mirrors |
| `packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts` | the item and its text, `$splitItemAfterText`, `keepingNestedLists` |
| `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` | `$dropWhitespaceAtLineStarts`, `$selectionStandsIn`, the transforms' registration |
| `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` | `buildItemBlocks`, `$writeRestOfBlock`, `appendSegments`, `joinsShortcut` |
| `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` | `registerEditorRules`, `registerListItemRules`, `$enterLeavesListAtBlankItemText`, `$settleSelectionOffContainers`, `registerHeldBlockShortcuts`, `$toggleListOfTouchedBlocks`, `toggleUnorderedList` |
| `packages/lib/src/typescript/lib/component/editor/markdownSourcePlaces.ts` | `locateBlockEntry`, `$placeAmongUnits` |
| `packages/lib/src/typescript/lib/component/display/Markdown.ts` | `appendListItem`, `appendBlockToken`, `appendInlineToken` |
| `packages/lib/src/typescript/lib/component/input/Checkbox.ts` | the tokens the box is drawn with |
| `node_modules/@lexical/list/dist/LexicalList.dev.mjs` (`$convertListItemElement`, `registerCheckList`), `node_modules/lexical/dist/Lexical.dev.mjs` (the decorator deletion in `deleteCharacter`), `node_modules/@lezer/markdown/dist/index.js` (`TaskList`) | the behaviour the plan relies on or mirrors |
| `scratch-keep/plans6/task-lists/` | the prototype |

---

## Non-Goals

- **Lexical's check list** (`listType: "check"`, `registerCheckList`) is not
  used (*A checkbox is an inline node of the editor's own*).
- **A task item with no text** has no Markdown form; the editor does not make
  one up (*A task item with no text after its checkbox*).
- **A checkbox elsewhere than first in a list item's text** — a paragraph, a
  heading, a table cell: Markdown reads none there.
- **Source-mode keys.** Enter in source mode continues a list as CodeMirror's
  Markdown commands do, and Ctrl+Enter stays CodeMirror's; neither adds or
  toggles a marker.
- **The limit of a checkbox followed by more than one space in a loose list**,
  whose text source mode does not place (`SP7`), stays as documented.
- **A task item's caret before the checkbox as a place of its own.** Every
  edit there acts after the checkbox; the caret itself is the browser's.
- **The look of a list marker beside the box.** Hiding the bullet or number of
  a task item, as some renderers do, is not done.

---

## Addendum: Prototype

The prototype is a detached worktree of `9686026d5` in
`scratch-keep/plans6/task-lists/tree/`, its changes uncommitted
(`git -C tree diff`, saved as `prototype-src.diff`; its two new modules copied
beside it). What it did and found:

| Run | What | Result |
|---|---|---|
| probes on the base | `tests/scratch/task-base-probe.test.ts`, `task-edit-probe.test.ts` | the known issues confirmed: the defined label (`- \[x\] done!`), the no-break space (`- [x]` + a raw no-break space, no task item on reload), the trailing space (`"[ ] "`) |
| the node, the importer, the serializer writing the marker before the text | the same probes | every load saves as its source; the three known issues fixed |
| the whole suites, first run | | 184 failures: the source places' checkbox case, the toggle rows (no rule for a checkbox leaving its item), the rows that pin the run |
| the checkbox rule, the source-places case | | 104 failures; the toggle and join rows pass |
| spacing kept in the state | | `TE76` and its sixteen joint rows and `TL3` wrote two spaces after an edit: the blanks were dropped from the state |
| a zero-width checkbox unit | `markdown-source-mode-through-model.test.ts` | the corpus differential found a caret one character off in *loose task list*; the unit spans its source and `$placeAmongUnits` counts its start |
| click, keys, Enter | `task-click-probe.test.ts` (jsdom, real `click` events) | one change and one undo step per click; read-only refuses with one `"readonlyedit"`; every row of the Enter, Backspace, caret and Ctrl+Enter tables |
| shortcut, toggle, paste, empty item | `task-feature-probe.test.ts` | the rows of those tables; the toggle's source-mode results equal the WYSIWYG ones |
| HTML | `task-html-probe.test.ts` | a pasted check list lost its checkboxes to the checkbox rule until a checkbox first straight in an item was let stand; then every row of the paste table |
| highlighting | `code-editor.test.ts` with the extension | 548 pass; the tree of the highlighting table |
| all of it | the Markdown suites, `code-editor.test.ts` and the probes | 15,044 pass; the 103 failures are the rows of *Tests that are restated* |

---

## Notes

[^model]: Four shapes were weighed. Lexical's check list puts the box on the
    list: `ListNode`'s `listType: "check"` makes every item a task item, so a
    mixed list (`- [ ] a` / `- b`) and an ordered task list cannot be held;
    `ListItemNode`'s `__checked` is cleared by Lexical's own transform in any
    list that is not a check list; and `registerCheckList` adds raw DOM
    listeners on the root, focuses the `<li>` and measures its `::before`
    pseudo-element with `getComputedStyle`, all of which the DOM seam rule
    forbids. A node state on `MarkdownListItemNode` or on its text was the
    second shape: the model is clean, but the box must then be drawn inside the
    element Lexical owns, either as a `::before` pseudo-element, which has no
    role for assistive technology and needs the click's position measured
    against it, or as a second element through Lexical's `getDOMSlot`, which
    the seam cannot build (`createViewElement` mints one element, and nesting a
    second needs a raw `appendChild`) and which Lexical marks experimental. An
    inline decorator node is the third shape and the chosen one: it owns one
    element, which the seam mints as it mints the image's, a click resolves to
    it by its target, and it stands where today's atomic run stands, so every
    place that recognised "the run that opens an item's text" recognises the
    node instead. Its cost is the caret that can stand before it, which the
    settling decision handles.

[^text-content]: `""` was weighed, as the image has. With `[ ] ` a plain-text
    copy and a source-mode paste of it keep the task items, and the
    whitespace and empty-text checks that read text content read what they
    read for the run. The prototype found no difference in the suites between
    the two other than those.

[^rule-five]: The other reading is that a checkbox is item syntax, like the
    bullet, and goes when its text leaves the list. It was weighed and not
    taken: source mode keeps the marker as text (`\[ \] `) when the bulleted
    toggle takes an item out, the parity plan made the two surfaces agree on
    that, and its rows pin it. Keeping rule 5 needs one rule, the checkbox
    rule, and no toggle code changes. A checkbox first straight in an item is
    let stand because Lexical's HTML conversion and its list code build items
    of inline nodes, which `$wrapInlineRuns` then wraps in the item's text; the
    prototype turned every pasted checkbox into text until it was.

[^viewer-element]: A native `<input type="checkbox" disabled>` was weighed. It
    is accessible without attributes, but its look is the browser's, a disabled
    one is drawn dimmed, and the check mark cannot be coloured from a theme
    token (a styled `appearance: none` input cannot draw `::after` in Firefox).
    A span with `role="checkbox"`, `aria-checked` and `aria-readonly` is the
    element the editor uses too, so one rule set draws both surfaces. ARIA 1.2
    allows `aria-readonly` on `checkbox`. The role and state go through the
    element's patch, as the image's `src` and `alt` do: the span is no
    `Component`, so there is no `Aria` object for it.

[^look]: GitHub hides a task item's bullet and puts the box in the marker's
    place. Keeping the marker keeps an ordered task list's numbers and the
    alignment of a mixed list's texts, needs no negative margin, and is what
    `marked`'s own HTML shows. The sizes are em-relative so the box follows the
    viewer's font scale; the editor's box is `cursor: pointer` because it is
    clicked, the viewer's is not. A focus ring is not needed: the box is never
    selected or focused on its own.

[^marker-state]: The precedent is node state for an authored form:
    `listMarkerState` keeps a list's bullet character, not the blanks after
    it, and `hardBreakMarkerState` keeps a break's marker. Keeping the blanks
    was prototyped and dropped: an edited item then kept `[x]  ` with two
    spaces, which seventeen pinned rows of `markdown-editor-command-crashes.test.ts`
    (`TE76`, its joint rows, `TL3`) read as wrong, and the list markers'
    precedent writes one space. The state is written only while it says the
    box's state, as an image's attribute text is written only while it says the
    image's size (`imageAttributesState`).

[^serializer]: Writing the checkbox as a source piece inline, as the run was,
    was the first shape and was rejected: the inline writer then reads `[x]`
    back as a reference link where a definition names it, and writes the text
    after it mid-line, so a no-break space there is written raw, which
    `marked` reads as whitespace before the marker's required non-blank
    character — the two known issues. Written by the item's writer, the text
    after the marker is a line start: it is escaped and edged as one, which
    reads the same after a task marker (`marked` strips the marker and reads
    the rest as inline text), and a no-break space at it is written `&nbsp;`.
    `$writeRestOfBlock` writes the marker too so that a code block made from a
    task item holds `[x] text`, as the parity plan's rule asks.

[^empty-item]: Three other answers were weighed. Writing `- [ ]` and showing
    the checkbox for ever leaves the editor showing what no reload shows, which
    every parity row of the repository forbids. Writing a no-break space after
    the marker (`- [ ] &nbsp;`) keeps a task item, but puts a character in the
    document the user never typed. Reading `- [ ]` as an empty task item in
    both the viewer and the editor would round-trip, but changes what standard
    GFM shows as text into a checkbox. The rule taken is the whitespace rule's:
    shown while the user is at it, saved as Markdown reads it, shown so at the
    next edit. `[ ]` cannot be a link label (a label needs a non-blank
    character), so only the checked form is escaped.

[^trailing]: `marked` trims only a list's last item; the viewer collapses the
    blanks, and the save trims them at the item's end. The fix is in the
    importer, where the blanks enter, and touches only the end of an item's
    text, where no hard break can stand (a break needs a line after it). The
    prototype ran every suite with it.

[^click]: The read-only guard lets `CLICK_COMMAND` through because selecting
    and following links need it, so the refusal is the listener's own, and it
    reports through the same `signalReadOnlyEdit` the guard calls. `editor.isEditable()`
    is not used: the read-only predicate is the component's, and the guard
    reads the same one. `HISTORY_PUSH_TAG` keeps two quick clicks two undo
    steps whatever the history's merge window; the prototype ran two clicks
    and two undos.

[^keyboard]: Lexical's check list makes ArrowLeft at an item's start focus the
    `<li>` and Space toggle it, which needs DOM focus on an element Lexical
    owns. Notion and Obsidian toggle with Ctrl/Cmd+Enter with the caret in the
    item; it needs no selection of the box, works over a range, and the key is
    free in the editor (Lexical's Enter ignores Ctrl). A keyboard-selectable box
    would add a node selection the user must step through with every arrow key
    and a selected look the editor would have to draw.

[^settle]: Typing before the box would make the box text (the checkbox rule),
    which a click left of it makes easy to do by accident. Normalising the
    selection whenever it changes was rejected: ArrowLeft from after the box
    goes before it, and moving it back would trap the caret at the line's
    start. Settling at edit time is what `$settleSelectionOffContainers` exists
    for. A range is left alone so that a range from the item's start removes
    the box with the text, as a range over the run did. Delete before the box
    deleting after it is the price of one uniform rule.

[^enter]: The split goes through `selection.insertParagraph()` in a listener of
    Enter's own command, as `@lexical/list` keeps its empty-item rule, because
    `insertNewAfter` also splits for every newline of pasted plain text and
    before pasted blocks, which must not each mint a checkbox. The checkbox
    goes with the text when Enter is pressed at the text's start, so `- [x] two`
    keeps its state on `two`. Keeping the checkbox when a nested empty task
    item moves out keeps it a task item, as Obsidian and GitHub's own editor
    do; at the top level the text becomes a paragraph, where the rule would
    turn the box into text, so it goes first.

[^shortcut]: Lexical's path runs element shortcuts only on a block whose parent
    is a root, and the held-block path skips an item's text so that `# ` and
    `- ` do nothing there. The task shortcut is the one shortcut of an item's
    text, so it is passed alone. A paragraph shortcut (`[ ] ` making a task
    item, as Notion does) was not taken: `[ ] a` in a paragraph is text in
    Markdown, and `- ` then `[ ] ` already makes one in two steps.

[^toggle]: The parity plan says there is no third kind of list; the toggle
    keeps that: it changes no list's kind, so a numbered item stays numbered,
    and a mixed list is a list with some task items. "Off" keeps the items
    because taking a list away is the bulleted and numbered toggles' job, and
    Google Docs' and Notion's checklist buttons both toggle the box, not the
    list. The prototype ran every row on both surfaces.

[^paste]: Reading the `<input>` itself in an `importDOM` was weighed: it needs a
    read of the element's attributes, which outside the seam goes through
    `DOM.source.intern` and `matches`, and it would build a second box beside
    the one Lexical's own `li` conversion already reads. Lexical's conversions
    read every common check-list markup already; the editor only has to stop
    dropping `__checked` in its replacement. The export writes a standard
    input so other applications read a checkbox; a paste between two
    `MarkdownEditor`s uses Lexical's own clipboard format, which carries the
    node.

[^places]: An offset inside the marker standing "before" the checkbox, the rule
    for a unit shown whole, placed it at the end of the previous item's text
    for every item but the first, since nothing of the item stands before the
    box; and a zero-width unit at the marker's start placed the WYSIWYG caret
    back one character short in the corpus differential. Counting the box as
    ending at its start keeps its source span for the reverse mapping and puts
    every offset in it after the box, where a caret can type.

[^highlight]: lezer's own `TaskList` reads `[ ]` followed by a blank and
    nothing else, and a tab after the marker, as a task, where `marked` needs a
    non-blank character after the blanks; and it tags the marker `tags.atom`,
    which the shared highlight style does not colour and which other grammars
    use for values. The parser's own leaf class is copied because
    `@lezer/markdown` does not export it, and the extension is built in
    `loadExtension` so the module still loads no grammar package. The
    code-editor suite passes with it, Enter's prefix rules included.
