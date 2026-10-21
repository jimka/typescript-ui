---
depends-on: [markdown-eleven-known-issue-fixes]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/src/typescript/lib/component/editor/markdownImporter.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/display/markdownExtensions.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourceSyntax.ts
  - packages/lib/src/typescript/lib/component/editor/markdownTabStops.ts
  - packages/lib/src/typescript/lib/component/editor/CodeEditor.ts
  - packages/lib/src/typescript/lib/component/container/AbstractBooleanMenuRow.ts
  - packages/lib/tests/component/code-editor.test.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-editor-command-crashes.test.ts
  - packages/lib/tests/component/markdown-editor-list-item-edits.test.ts
  - packages/lib/tests/component/markdown-importer.test.ts
  - packages/lib/tests/component/markdown-source-mode-through-model.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# Markdown Small Known-Issue Fixes — Implementation Plan

## Overview

The known-issues list was re-checked on 2026-10-20, and its entries rated **small fixes** are done here, in one branch on top of the chain's tip `feature/markdown-eleven-known-issue-fixes` (`c8f4a90d2`). All are low impact. Each entry was reproduced on `c8f4a90d2`, its cause traced, and its fix prototyped. Four entries and two parts of line 68 turned out not to be small, and the other two parts of line 68 are by design; they are dropped (*Dropped entries — not small*). In examples `→` is a tab, `·` a space where it matters, `⏎` a line end, `|` the caret and `⍽` a no-break space (U+00A0). "Line N" names the entry's line in the re-checked list `scratch-keep/impl/known-issues-recheck/known-issues-before-recheck.md`.

| Stage | Entry | What this plan does |
|---|---|---|
| 1 | Radio and checkbox menu rows have the wrong ARIA roles (line 147) | The row element becomes the `menuitemradio` / `menuitemcheckbox`; the control inside is hidden from assistive technology. |
| 2 | The document panel repeats the text style preset values (line 144) | The panel reads the editor's preset lists. |
| 3 | A code block made from an emptied checked task item holds `\[x\]` (line 137) | The code holds the marker as the item showed it, `[x]`. |
| 3 | A lone checkbox written with `&#32;` saves badly once unchecked (line 141) | The checkbox keeps the character reference, so its save still reads as a checkbox. |
| 4 | Source mode gives `-→→` a code-block child (line 55), and `>·>·→` an indented code block (line 65) | A line whose markers only whitespace follows is blank in the grammar, as in CommonMark. |
| 4 | Source mode strikes `x ~~~a~~~` (added after the re-check) | A tilde run of any length but two is passed over whole, as `++` already is. |
| 4 | Source-mode Enter after a nested ordered item adds a blank line (added after the re-check) | Inside a list item an ordered marker of any number starts a list, as the viewer reads it. |
| 4 | An editor not yet mounted that holds `\r\n` declines every source-mode command (line 79) | `CodeEditor.getValue()` returns `\n` line ends before mount, as after. |
| 5 | An open `<` at a join closed by `/>` in a raw block's rest (line 23) | The `>` that would close the tag is escaped, judged by the viewer's own lexer. |
| 5 | Blanks shown before bold, code or a link on a continuation line (line 29) | The importer drops those blanks on load, as it already does before text. |
| 5 | Bold across a table cell's paragraph break reloads with an extra space (line 76) | Fixed by the line 29 change; no code of its own. |
| 5 | A pasted image's blank-line title is replaced by a definition's title (line 150) | The blank-line exemption goes from the image and reference-link written-form checks. |
| 6 | The viewer does not read `a` over `-→` as a heading (line 53) | `marked`'s setext rule is asked with the underline's tabs written as spaces. |
| 6 | A `<div` line followed by a blank line swallows the next paragraph (line 81) | `marked`'s HTML rule is asked with a space after the tag name, so the block ends at the blank line. |
| 6 | No source place for a no-break space used as link text (line 78) | The importer and `$holdsContent` count a no-break space as content, as the serializer does. |
| 7 | insertTable and insertHorizontalRule move the selection, then decline (line 15) | The decline is judged right after settling, and the selection is put back. |
| 7 | Typing at an element caret between two blocks of a quote goes into the next block (line 92) | Typing opens a paragraph there first, as a paste does. |
| 7 | An element caret on a task item node types before its checkbox (line 127) | A caret on an item before its text settles onto the start of that text. |
| 8 | Shift+Enter over a range that ends at the end of a block (lines 3 and 27) | **Decided: lift the decline.** Shift+Enter removes the range as Delete does and adds the break only where it has a place. |

Every fix was prototyped on private copies of the tip. The research agents' trees, probes and reports' data are under `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans6/small-known-issue-fixes/` (called `$P` below). The fixes were then put together on one tree, stage by stage, in the order of the table. Each stage's diff (`$P/steps/<n>-<name>.diff`, source, tests and docs) is the reference implementation the steps apply; applied in order to `c8f4a90d2`, they give the measured tree (`## Addendum: Measurements`). The source changes total about 620 lines added and 440 removed over 15 files; the Shift+Enter lift alone removes about 250. Line numbers are those of `c8f4a90d2`.

---

## Architecture Decisions

### Menu rows are the menu items assistive technology reads — following `MenuItem`

`AbstractBooleanMenuRow.installControl` ([AbstractBooleanMenuRow.ts:268](../packages/lib/src/typescript/lib/component/container/AbstractBooleanMenuRow.ts#L268)) gives the row element no role. The `Checkbox` or `RadioButton` inside it keeps `role="checkbox"` / `role="radio"`, `aria-checked` and `tabindex="0"`, and the override `getActiveDescendantId` (`:114–124`) points a keyboard-opened menu's `aria-activedescendant` at that control. Inside `role="menu"`, WAI-ARIA expects `menuitemcheckbox` / `menuitemradio`, whose children are presentational.

The row element now carries the role, `aria-label` (the control's label), `aria-checked` and `aria-disabled`, as a plain `MenuItem` row carries `menuitem` ([MenuItem.ts:246](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L246)). The control gets `aria-hidden="true"` and no tab stop, as `Link.ts:214` clears a presentational control's role. The override goes, so the active descendant is the row's own id. `setChecked` writes `aria-checked` on the row. A protected hook `getMenuItemRole()` returns `"menuitemcheckbox"`; `RadioMenuRow` overrides it. `AriaRole` (`core/Aria.ts:30`) gains the two roles.[^menu-roles]

### The menu row's accessible name — decided: `aria-label` on the row, the control hidden

**Feature:** the name a screen reader gives a checkbox or radio row in a menu.

| | Before | After |
|---|---|---|
| `CheckboxMenuRow({ text: 'Bold' })` | the row: no role; inside it `role="checkbox"`, `tabindex="0"` | the row: `role="menuitemcheckbox"`, `aria-label="Bold"`, `aria-checked="false"`; the checkbox `aria-hidden`, no tab stop |
| Keyboard focus on that row | `aria-activedescendant` names the checkbox | it names the row |

**Consequences.** Hiding the control drops the `aria-checked` and `aria-disabled` its own code rewrites on every change, which clearing its role alone would leave on a plain `div`. The label equals the visible text. A consumer subclass of the public `AbstractBooleanMenuRow` becomes a `menuitemcheckbox` unless it overrides the new hook; the hook has a default, so nothing breaks at compile time. The active-descendant change reverses a choice of the unreleased context-menu keyboard plan (`plans/implemented/context-menu-keyboard-operation.md`, line 106 and footnote at line 700).

**Recommendation and decision:** as above. Decided.

### The panel reads the editor's preset lists — following the editor's internal exports

`MarkdownDocumentPanel.buildTextStyleMenuItems` ([MarkdownDocumentPanel.ts:394](../packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L394)) writes the colour, font and size presets as literals that copy `TEXT_COLOUR_PRESETS`, `FONT_FAMILY_PRESETS` and `FONT_SIZE_PRESETS` ([MarkdownEditor.ts:8323–8350](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L8330)). Those three constants and `TextStylePreset` become exports tagged `@internal Shared with \`MarkdownDocumentPanel.ts\`, not part of the public API surface.`, as `markdownTabStopCommands.ts:21` tags its shared helpers; the editor's barrel does not re-export them. The panel builds each submenu from them through a new private `buildStylePresetSubmenu(label, presets, apply)`. The submenu titles Colour, Font and Size stay written in both files; the new test compares them too.[^presets]

### A code block from a lone checkbox holds its marker — following `$copyBlockAsCodeSource`'s rule

`setBlockType('code')` on an emptied checked task item reaches `$writeRestOfBlock` ([markdownSerializer.ts:1404](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1404)), which hands a checkbox alone to `withTaskMarker` (`:1432`) and so to `$emptyTaskItemMarkdown` ([markdownTaskCheckboxNode.ts:280](../packages/lib/src/typescript/lib/component/editor/markdownTaskCheckboxNode.ts#L280)). That function escapes a checked box (`\[x\]`) so that a line of Markdown reads no reference link, which a code block's text never is. `$writeRestOfBlock` now writes a checkbox alone as its marker, `$taskMarkerMarkdown(box).trimEnd()`. This is the documented rule of `$copyBlockAsCodeSource` (`MarkdownEditor.ts:405–418`) and `MarkdownEditor.md:138`: "in a code block as it was written".

### A lone checkbox keeps the character reference that makes it one — following `taskMarkerState`

**What the viewer reads.** `marked` reads a task item when its text starts with `[ ]`, `[x]` or `[X]`, spaces, then any non-whitespace source character (`listIsTask`). So a checkbox with nothing after it is a checkbox to the viewer only when its source has a character reference for a blank after the marker:

| Source | Viewer | Editor on the tip | Save on the tip once toggled |
|---|---|---|---|
| `- [ ]` | text `[ ]` | text | — |
| `- [x] &#32;` | a checked checkbox | a checked checkbox | `- [ ]`, which reloads as text |
| `- [ ] &#x20;`, `- [x]→&#9;` | a checkbox | a checkbox | `- [ ]` / `- \[x\]`, text |

The importer decodes `&#32;` to a space, and `$dropBlanksEndingItemText` (`markdownImporter.ts:1544`) trims it, so nothing remembers it once the item is edited. A new node state `taskBlankTextState` (`markdownNodeState.ts`, beside `taskMarkerState` at `:240`, which keeps an authored `[X]` the same way) holds that source, set by `$keepBlankTextOfCheckbox` in `$buildListItem` (`:1610`). `$emptyTaskItemMarkdown` writes the marker and that text when the state is set. `$keepCheckboxesOfItemText` ([markdownWritable.ts:150](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L150)) keeps such a checkbox as a checkbox (`$savesAsCheckboxAlone`), since its save reads as one. `withTaskMarker`'s `written === ""` becomes `written.trim() === ""`, so a checkbox followed only by a decoded `&#10;`, `&#13;` or `&#12288;` is written as a checkbox alone too.[^empty-item]

### The kept reference lives as long as the checkbox — decided

**Feature:** a lone checkbox loaded from `- [x] &#32;`, edited in other ways.

| Edit | Tip | After |
|---|---|---|
| a click | `- [ ]`, a reload shows text where the editor showed a checkbox | `- [ ] &#32;`, a checkbox |
| `toggleOrderedList` (WYSIWYG or source mode) | `1. \[x\]` | `1. [x] &#32;` |
| `z` typed after the box, deleted, caret moved elsewhere | `- \[x\]`, shown as text | `- [x] &#32;`, still a checkbox |
| `- [x] a`, `a` deleted, caret elsewhere | `- \[x\]`, shown as text | unchanged: the decided empty-item rule |

**Consequences.** Two empty task items can save differently, by how they were loaded. Nothing the user did not write is added: the reference was in the document. Dropping the state on the first edit of the text would bring back the text form in the third row.

**Recommendation and decision:** keep it for the checkbox's life. Decided.

### A line whose markers only whitespace follows is blank in the source grammar — following `MARKDOWN_TAB_STOPS`

In `@lezer/markdown` 1.7.2, after a list or quote marker opens on a line, `advance()` runs the block parsers again on the rest of the line without checking whether that rest is blank, and `IndentedCode` opens on wide enough whitespace. So `-→→`, `-······`, `1.→→`, `>·>·→`, `-·>·→`, `··>·→` and `>→→` hold an empty code block, where CommonMark and the viewer read an empty item or quote. In the spaces form, Enter then copies the line's whitespace (`insertNewlineKeepPrefix` sees a code block).

A new block parser `BlankLineRest`, placed `before: "IndentedCode"` in `MARKDOWN_TAB_STOPS` ([markdownTabStops.ts:217](../packages/lib/src/typescript/lib/component/editor/markdownTabStops.ts#L217)), consumes a line whose rest is empty (`cx.nextLine()`), which is what `advance()` does with a blank line no parser takes. The module's two tab parsers are the precedent: each corrects a stock parser from in front of it. The module header and the table in `MARKDOWN_TAB_STOPS`'s JSDoc gain the case.[^blank-rest]

### A tilde run of another length is passed over whole — following `parseUnderlineMark`

`parseStrikethroughMark` ([markdownSourceSyntax.ts:133](../packages/lib/src/typescript/lib/component/editor/markdownSourceSyntax.ts#L133)) refuses a `~~~` run only at its first tilde; the inline loop then retries one character on and accepts `~~` there. `parseUnderlineMark` (`:205`), the previous branch's copy for `++`, reads the whole run and returns its end for any length but two. `parseStrikethroughMark` takes that shape, with `STRIKETHROUGH_MARK_LENGTH`.

| Source | Tip (source mode) | After | Viewer |
|---|---|---|---|
| `x ~~~a~~~` | struck | plain | plain |
| `~~a~~~` | struck | plain | plain |
| `a ~~b~~~c~~` | `~~c~~` struck | `~~b~~~c~~` struck | `~~b~~~c~~` struck |
| `~~a~~` | struck | struck | struck |
| `~a~` | plain | plain | struck (out of scope: recorded decision, `CodeEditor.md:80`) |

### An ordered item starts a list inside a list item's text — following `taskMarkerExtension`

`- x⏎··8.·a|⏎··9.·i` and Enter gives `- x⏎··8.·a⏎··|⏎··9.·i`. No wrapper is involved: lezer's `DefaultEndLeaf` lets an ordered item interrupt a paragraph only when it starts at 1 or an ordered list is open, as CommonMark rules, so the grammar reads one paragraph `x 8. a 9. i`. Lang-markdown's Enter then continues that paragraph. The viewer and the WYSIWYG model read `x` and a nested ordered list, because `marked` reads a list item's text with `top = false`, where any ordered marker interrupts.

A new `MARKDOWN_ITEM_TEXT_ENDS` config in `markdownSourceSyntax.ts` (before `DELIMITER_CELL`, `:579`) adds an `endLeaf` test `endsItemTextAtOrderedItem`: a line that starts with an ordered marker (`ORDERED_ITEM_MARKER`, `/^\d{1,9}[.)](?:[ \t]|$)/`) ends the paragraph when the innermost open block is a `ListItem`. `languages.ts` adds it to the extensions (`:653`). The `cx.parentType().name === "ListItem"` test copies `taskMarkerExtension` (`languages.ts` about `:588`), which already applies `marked`'s list-item rule there; the `endLeaf` form follows `MARKDOWN_FENCE_LINES` (`markdownSourceSyntax.ts:559`). The module header, which says no configuration changes a block lezer already reads, gains this exception.

### Source mode reads an ordered item in a list item's text as the viewer does — decided

**Feature:** an ordered marker of any number on a line under a list item's text.

| Source | Tip (source mode, as CommonMark) | After (as the viewer and WYSIWYG) |
|---|---|---|
| `- x⏎··8.·a⏎··9.·i` | one paragraph | `x` and an ordered list |
| Enter after `8. a` there | adds `··` and makes the list loose | adds `··9.·` and renumbers `10.` |
| `x⏎8.·a` (top level), `> x⏎> 8. a` | one paragraph | unchanged |

**Consequences.** Source mode departs from CommonMark here, toward the viewer, which is the contract (source mode reads what the viewer reads). The renumbering wrapper of the previous branch then moves later lines with no change of its own. Lazy lines get the agreed reading too (`- x⏎8.·a` is two lists in all three parts).

**Recommendation and decision:** take it. Decided.

### `CodeEditor.getValue()` returns `\n` line ends before mount — decided: at the `CodeEditor` level

`CodeEditor.getValue()` ([CodeEditor.ts:876](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L876)) returns the cached value as given until the view mounts, and `mount()` (`:2455–2463`) builds an `EditorState`, which splits on `\r\n` and `\r`. `MarkdownEditor.editThroughModel` (`:9915–9923`) therefore declines on any `\r`, a limit the through-model plan accepted (footnote `[^crlf]`, row 5.30). `getValue()` now writes the cached value's line ends as `\n` (`NON_LF_LINE_END = /\r\n?/g`, documented as CodeMirror's own split), and the guard in `editThroughModel` goes. `replaceRange`, `format()` and the clean value all read through `getValue()`.

**Feature:** `getValue()` of a `CodeEditor` that has not mounted, given `\r\n`.

| | Before | After |
|---|---|---|
| `new CodeEditor('a\r\nb').getValue()` | `'a\r\nb'` until mount, then `'a\nb'` | `'a\nb'` always |
| `new MarkdownEditor('a b\r\nc d', { mode: 'source' })`, bold on `a` | nothing | `'**a** b\nc d'` |

**Consequences.** Every `CodeEditor` language gets it, at the one place the mismatch starts. The `MarkdownEditor.md` corner case on `markClean()` over `\r\n` (line 326) can no longer happen and goes. The same fix gives a source-mode editor built offline over CRLF its caret places (part 1, line 33).

**Recommendation and decision:** fix it in `CodeEditor`. Decided.

### A joined `>` that would close a tag left open is escaped, as the viewer reads the join — following the serializer's read-back

`$joinedMarkdown` ([MarkdownEditor.ts:3810](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3810)) tests the text before a joint against `UNCLOSED_TAG_OPENING` (`:3784`) and then escapes only a `>` that opens the rest (`:3826`). Any `>` later in the rest still closes the tag: in the raw list `- a <br w⏎··> q⏎⏎ab/>cd`, Delete from after `<br` to after `ab` saves `- a <br/>cd`, an HTML line break. A sweep of 5 open tags and 18 rests at two places gives a tag in 97 of 187 joins on the tip.

A new helper `withTagLeftOpen(openTag, markdown)` lexes `openTag + markdown` with `lexMarkdownInline` and, while the first token is an `html` token reaching past the open tag, escapes its closing `>`; each pass escapes one more `>`, at most as many passes as the Markdown holds `>`. The contract is "the joined text reads as the two texts read", decided by the viewer's own lexer, as the serializer decides escapes by reading its output back (`serializeInlineNodes`, `markdownSerializer.ts:4401–4441`; `readImageForm`, `:6283`).[^join-width]

| Rest after `<br` | Tip | After |
|---|---|---|
| `/>cd`, ` />cd` | a tag | `- a \<br/>cd`, `- a \<br />cd` (text) |
| ` x="1">cd` | a tag | text |
| `r>cd` | `<brr>`, a tag | text |
| `/ >cd` | text | text (unchanged) |

### Blanks before an inline construct on a line are dropped on load — following the importer's own rule

`appendText` ([markdownImporter.ts:2386](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L2386)) drops a line's opening blanks on load only when text follows them in the same piece (`stripped !== ""`, `:2394`). Blanks that are a whole piece, because a bold, code span, link or image token follows, are kept: `a⏎··**b**` shows three spaces where the viewer shows one. `plans/implemented/markdown-tab-column-parity.md` (lines 1206–1207) recorded this exact case as a known issue, and the serializer's `trimLineEdges` keeps blanks before a source run only.

`appendInlineTokens` now passes each token's next sibling to `appendInlineToken`, and a new `keepsBlanksBefore(target, next)` keeps the blanks only before a run kept as its source (inline HTML, a kept construct, a token the editor has no node for: `NODE_TOKEN_TYPES`). `appendText` gains a `blanksKept` parameter. In a table cell the rule applies to the last piece before the next token only. The change runs on load only (`LOADING_DOCUMENT`), as the existing rule does.

The same change fixes line 76: `serializeTableCell` (`markdownSerializer.ts:4187`) writes a space before a cell paragraph that opens with a delimiter (`**x**\n\n **y**`), which `_y_` and `*{*` need, and that space now loads as nothing. The serializer is not changed.[^cell-space]

### The written-form checks drop their blank-line exemption — decided: images and reference links both

`writtenFormHolds` ([markdownSerializer.ts:6316](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L6316), condition `:6325`) and `resolvesToNode` (`:5770`, condition `:5784`) accept any definition title when the node's title holds a blank line. The exemption dates from when no inline link could write such a title; `markdown-commonmark-images.md` (line 1593) since writes it as `&#10;&#10;`. Both conditions become a plain title equality. The edit of a definition's title still reaches its references through `$adoptDefinitionTitles` ([markdownWritable.ts:1683](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1683)), which sets the node's title before the save; its JSDoc loses the old reason.

**Feature:** an image or reference link whose title holds a blank line, in a document whose definition for its label gives another title.

| Case | Before | After |
|---|---|---|
| image copied as JSON into `z⏎⏎[x]: /i.png "other"` | saves `z![a][x]`, reloads with title `other` | saves `z![a](/i.png "t&#10;&#10;u")`, title kept |
| reference link copied the same way | saves `z[a][x]`, reloads with `other` | saves `z[a](/u "t&#10;&#10;u")` |
| corpus case "tab-indented definition in a list item with a blank line in its title", bold on `x` | `b **[x][x]** c` | `b **[x](/u "t&#10;&#10;  u")** c` (the title the viewer reads) |

**Consequences.** The third row is the corpus case's known divergence `definitionTitleIndent`: the editor reads that definition's title otherwise than the viewer, and the reference now gives way to the inline form, as it already did for a title without a blank line. Its unedited `canonical` check now holds, so the corpus case loses `canonical: 'definitionTitleIndent'`, and the divergence's reason loses "unless the title holds a blank line". Its edited saves still show the divergence, so the edit fuzz and the nested edit fuzz skip their standard-form check for a case whose `edits` divergence is known, as they already skip the surface checks.[^fuzz-gate]

**Recommendation and decision:** drop the exemption in both checks. Decided.

### A tabbed setext underline is read as CommonMark reads it — following `fencesWithColumnIndent`

`marked` 18.1.0's `lheading` rule allows only spaces after the underline run, and so does the dialect's guard `SETEXT_UNDERLINE_LINE` ([markdownExtensions.ts:482](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L482)). CommonMark §4.3 allows spaces and tabs. A new `lheadingWithTabbedUnderline` asks `marked`'s tokenizer again on a copy of the source in which each tab after an underline run is one space (`TABBED_SETEXT_UNDERLINE`), and sets the token's `raw` back to the source. The copy has the source's length, so `raw` is a slice. `fencesWithColumnIndent` (`:1133`) and `listWithTabStops` re-ask `marked` the same way. `SETEXT_UNDERLINE_LINE` takes `[ \t]*`, and `DIALECT_BLOCK_TOKENIZERS` (`:1163`) gains the tokenizer, so the unbounded test twin agrees.

| Source | Tip (viewer and WYSIWYG) | After | CommonMark and source mode |
|---|---|---|---|
| `a⏎-→` | paragraph `a -` | heading 2 `a` | heading 2 |
| `a⏎---→` | paragraph `a` and a rule | heading 2 `a` | heading 2 |
| `a⏎-→⏎b` | paragraph `a - b` | heading, paragraph `b` | the same |
| `a⏎→-` | paragraph | paragraph (unchanged) | paragraph |

### An HTML block opened by a tag name alone ends at the blank line — following `htmlWithInputEndAsLineEnd`

`marked`'s condition-6 HTML rule spends the line end after a bare tag name (`<div`) as the name's end, so the blank line right after it does not end the block, which runs to the next blank line or the input's end. CommonMark §4.6 ends it at the first blank line. A new `htmlEndingAtBlankLine`, called first inside `htmlWithInputEndAsLineEnd` ([markdownExtensions.ts:728](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L728)), asks `marked` again with a space after the tag name when the token's start line is a tag name alone (`TAG_NAME_ONLY_LINE`), and cuts the token back by that one character. `script`, `pre`, `style` and `textarea` (`RAW_TEXT_TAG_NAME`, CommonMark condition 1) run to their closing tag and are left alone. `htmlWithInputEndAsLineEnd` already re-asks `marked` with the source changed by one character in the same way.

| Source | Tip | After (as CommonMark) |
|---|---|---|
| `a⏎⏎<div⏎⏎b·c` | paragraph, then one HTML block `<div b c` shown as text | paragraph, HTML block `<div`, paragraph `b c` |
| `</div⏎⏎b`, `<DIV⏎⏎b`, `>·<div⏎>⏎>·b`, `-·<div⏎⏎··b` | the same swallowing | the same ending |
| `<pre⏎⏎b` | one block | one block (unchanged) |
| `<div⏎x⏎⏎b` | block `<div⏎x`, paragraph | unchanged |

### The serializer's second-blank-line path is left in place — decided

The serializer writes an extra blank line after a raw block that `marked` read as running past a blank line (`RawBlockEnd`'s `"wide"` value, `markdownSerializer.ts:88–96`, used through `rawBlockEnd`, `writtenBlocks`, `takesInBlockAfter` and `serializeRawBlock`). It is computed from `lexMarkdown`, so the lexer fix switches it off by itself: over 229 raw-block texts, 32 are "wide" on the tip and none after the fix. The 16 rows that pinned the second blank line now expect one blank line, as `<div>` gives, and are renamed to say so.

**Feature:** the save of a `<div` line before a paragraph whose next block is edited.

| Row | Tip | After |
|---|---|---|
| RW1 | `<div⏎⏎⏎bX` | `<div⏎⏎bX` |
| HE7 | `a⏎⏎<div⏎⏎⏎b` | `a⏎⏎<div⏎⏎b` |

**Consequences.** About 40–50 lines across ten serializer sites stay, reached by no test. Removing them is a pure deletion that needs its own review and does not change any reading.

**Recommendation and decision:** keep the path in this plan; its removal is a follow-up for the orchestrator to list. Decided.

### A no-break space is content to the importer and to `$holdsContent` — following `holdsLineContent`

`appendLink` keeps a link at a block's edge whose text "shows only whitespace" as a source node, because the save would trim such text. `showsOnlyWhitespace` ([markdownImporter.ts:2954](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L2954), `/^\s*$/` at `:2967`) and `showsWhitespaceBesideLinks` (`:2938`) use JavaScript's `\s`, which takes U+00A0. The serializer's `trimLineEdges` trims only spaces and tabs and writes an edge no-break space as `&nbsp;`, so the premise is false. The source node then shows `" "` for `⍽`, and `locateCharacters` (`markdownSourcePlaces.ts:1074`) cannot match it, so no offset of the block has a place. Opening a list item, the link is lost on save (`- [⍽](/u) b` saves `- &nbsp; b`).

Both tests and `$holdsContent` ([markdownWritable.ts:2326](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L2326), `/\S/` at `:2328` and `:2334`) use `holdsLineContent` (`display/markdownLineContent.ts:16`), whose rule is "a no-break space or any other non-ASCII space is content: `marked` keeps it", already shared by the serializer. Both changes are needed: with the importer alone, `$dropUnwritableBreaks` unwraps the link and `[⍽](/u) b` saves `⍽ b`.

**Feature:** a link whose text is only a no-break space.

| Source | Tip (WYSIWYG) | After |
|---|---|---|
| `[⍽](/u) b` | a source node showing a space; no caret places in the block | a link node `⍽`, saves `[⍽](/u)` |
| `- [⍽](/u) b` | the save writes `- &nbsp; b` | the save keeps the link |
| `[·](/u) b` (a plain space) | a source node | unchanged |

**Recommendation and decision:** a link. Decided.

### A declined insert puts the selection back — following `$editOrRestore`

`insertTable` ([MarkdownEditor.ts:11886](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L11886)), `insertHorizontalRule` (`:11970`) and `insertImage` (`:12049`) settle the live selection off containers (`$settleSelectionOffContainers`, `:2527`) and then return on `declinedOnceSettled` without restoring it. `insertHorizontalRule` also removes a table-edge range before that check, so a selection that settles inside a table has its cells emptied, or the update throws ("selection has been lost…"). Each command now clones the selection before settling, judges the decline right after settling and before any removal, and on a decline calls `$setSelection(before)`. This is the documented "an edit that changes nothing leaves the selection as it was" (`MarkdownEditor.md:112`), which `$editOrRestore` (`markdownWritable.ts:3152`) applies to declined edits. Settling moves only points, so the clone is safe to restore.

### Typing between two blocks of a quote or an item opens a paragraph — following the other insert routes

`$clearGuardedRangeBeforeTyping` ([MarkdownEditor.ts:3608](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3608)) only removes a guarded range. Every other insert route — a paste, an image, Tab, Enter — first calls `$openBlockAtItemCaret` (`:2630`), which opens a paragraph at a caret between the blocks of a quote, list item or list. Typing now calls it too, after the removal.

**Feature:** typing with a caret between two blocks of a quote or list item, which only code can set.

| Start | Tip | After |
|---|---|---|
| `> a⏎>⏎> b`, caret on the quote at offset 1, type `Z` | `> a⏎>⏎> Zb` | `> a⏎>⏎> Z⏎>⏎> b` |
| the same at offset 0 | `> Za⏎>⏎> b` | `> Z⏎>⏎> a⏎>⏎> b` |
| `- a⏎⏎··q`, caret on the item at offset 1 | `- a⏎⏎··Zq` | `- a⏎⏎··Z⏎⏎··q` |
| caret after the last block | a new paragraph | the same |

**Consequences.** Typing gives what a paste of the same text gives there, as the *Lists* bullet already claims for a caret beside a table.

**Recommendation and decision:** take it. Decided.

### A caret on a list item before its text settles onto that text — decided: every item that opens with its text

`$settleCaretPastCheckbox` (`MarkdownEditor.ts:6585`) moves a caret before a task item's checkbox to after it, but only for a point on the item's text. List items are never settled, so a caret on the item node at offset 0 types before the checkbox, which then becomes the text `[ ]` (`- Z\[ \] a`). A new `$settleCaretOntoItemText(selection)`, called first in `$settleSelectionOffContainers` and in the composition-start listener of `registerTaskItemRules` (`:6316`), moves a collapsed element caret at offset 0 on a `MarkdownListItemNode` whose first child is its text to `(itemText, 0, "element")`; the checkbox rule then moves it past the checkbox. An item that opens with another block is left alone: a caret before that block stands between blocks.

**Feature:** a caret that code sets on a list item, right before the item's text.

| Example | Tip | After |
|---|---|---|
| `- [ ] a`, type `Z` | `- Z\[ \] a` | `- [ ] Za` |
| `- [ ] a`, paste `Z` | `- Z⏎⏎··\[ \] a` | `- [ ] Za` |
| `- [x] a`, Enter | `- \[x\] a` | `- [ ]⏎- [x] a` |
| `- a⏎⏎··q`, paste or image | `- Z⏎⏎··a⏎⏎··q` | `- Za⏎⏎··q` |
| `- a⏎- z`, Enter | nothing | `-⏎- a⏎- z` |
| an item opening with a table, heading, quote or code block (rows Z24, Z55) | opens a text before that block | unchanged |

**Consequences.** The caret means what a click before the text's first character means. Settling task items only would leave typing and paste disagreeing on a plain item, and typing at a plain item's offset 0 would then differ inside and outside an update.

**Recommendation and decision:** every item that opens with its text. Decided.

### Shift+Enter over a selection — decided: lift the decline

**Feature:** Shift+Enter over a selection where no line break can follow the caret its removal leaves.

| Example | Today | After |
|---|---|---|
| `ab`, `b` selected | nothing happens; `b` stays selected | `a`, caret after it |
| `p⏎⏎- ab⏎- cd`, from `p` to the end of `ab` | nothing happens | `- cd` |
| `- x⏎- a⏎⏎··para⏎- b`, from after `x` to between `a` and `para` | nothing happens | `- x⏎⏎··para⏎⏎- b` |
| `> a⏎>⏎> bc⏎⏎z`, `c` selected | nothing happens | `> a⏎>⏎> b⏎⏎z` |
| `abc`, `b` selected | `a\⏎c` | `a\⏎c` (unchanged) |
| a table cell, `b` of `ab` selected | `\| a<br> \|` | unchanged (a cell keeps every break) |
| a caret at the end of `ab` | nothing | nothing (unchanged) |

**Today's rule.** Shift+Enter over a range is judged before anything is removed. Where the caret the removal would leave has nothing after it in its block, the whole command is declined, and the selection stays. Six predictors carry the rule (`$declinesLineBreak`, [markdownWritable.ts:2187](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L2187); `$clearGuardedRangeBeforeLineBreak`, [MarkdownEditor.ts:3484](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3484), with `$guardedRemovalDeclinesLineBreak`, `$joiningRemovalDeclinesLineBreak`, `$startsOnListContainer` and `$beforeListRemovalDeclinesLineBreak` at `:3518`; `$ruleEdgeRangeVerdict`, `:6832`). `MarkdownEditor.md` documents it as deliberate.

**The lift.** Shift+Enter over a selection removes it, as Delete, Enter, typing, Tab and a paste do, and then adds the break only where the caret that is left has a place for one; where it has none, no break is added. `$declinesLineBreak` removes a non-collapsed selection before it declines the break. `$clearGuardedRangeBeforeLineBreak` removes the range the way Enter's guard does (`$clearGuardedRangeBeforeParagraph`, `:3346`) and leaves the break to the high-priority handler; a caret between blocks still takes no break (the crash guard of `plans/implemented/markdown-editor-table-command-fixes.md`, line 1468, stays). `$ruleEdgeRangeVerdict` loses its Shift+Enter branch and its `"declined"` result, and the rule-edge guard handles an emptied range for `INSERT_LINE_BREAK_COMMAND`. The six predictors and the helpers only they used go: net about −250 source lines.

**Consequences.**

- Shift+Enter agrees with every other edit over a selection, and with what the raw-block case already does ("the selection is removed and no break is added", `MarkdownEditor.md:97`).
- Every row equals what Delete then Shift+Enter gives on the same selection. The break is judged at the real caret by the same `$lineBreakUnwritableAt`, so no unwritable break can result.
- One undo restores the text and the selection.
- Selected text at a block's end goes and no break appears, which an author pressing Shift+Enter over a selection may not expect; undo brings it back.
- 34 existing rows that pin the decline change (to Delete's result), 10 rows are added, six `MarkdownEditor.md` sentences and four unreleased changelog entries are reworded. The decline never shipped, so no changelog entry of its own is needed.
- This reverses a rule six implemented plans repeated, most explicitly `plans/implemented/markdown-editor-tab-over-range-before-list.md` (sign-off, line 61), which rejected the same option to keep "a declined Shift+Enter changes nothing".[^shift-enter-history]

**The other option** was to keep the decline and make the *Line breaks* bullet say that Shift+Enter over a selection is judged at the caret its removal would leave and, where a break has no place there, does nothing and keeps the selection, unlike Enter, Delete and typing. That changes no code and keeps the behaviour that prompted the entry.

**Recommendation and decision:** lift the decline. Decided.[^shift-enter-why]

### Dropped entries — not small

Each list entry below stays on the known-issues list.

| Entry | Why it is dropped |
|---|---|
| The column splitter treats an indented "```" as a code fence (line 85) | The rule is a recorded Non-Goal of `plans/implemented/markdown-columns-fixes.md` ("a code-fence, `:::` or `|||` line counts at any indentation", footnote `[^fence-rule]`: the scan cannot know a line's container). The three-space fix breaks 226 of 1,400 sweep cases that are right on the tip (a fence in a nested list item). A container-aware scan fixes it (1,342 of 1,400 agree with commonmark.js, against 502 on the tip) but needs list-item tracking, about 105 lines, and still misreads lazy lines.[^column-fence] |
| `insertRawText` throws at an element caret on a quote (line 87) | The throw is inside Lexical's `insertNodes`, which calls no node method the editor could override. `_editor` is private, every public route (`paste()` among them) opens a block first, and a fix needs the quote and item to become shadow roots, a selection-wide settle, or a Lexical patch. |
| Pasted HTML loses the space before an inline input (line 135) | Lexical's `$convertTextDOMNode` trims a text node's edge space next to any element it does not list as inline. The same loss hits `<img>`, `<button>`, `<select>`, `<textarea>` and `<svg>`. A fix needs an editor-owned `#text` conversion (a copy of Lexical's whitespace algorithm) and new DOM seam reads. |
| A pasted rule followed by a paragraph right after a checkbox saves `- \[x\]` (added after the re-check) | The text after the caret joins the pasted paragraph (`Pone`), so the previous branch's rule ("the checkbox goes with the text after the caret") has no place to put the checkbox. A fix first needs a decision on where such a paste goes at the start of any item's text: at a plain item it leaves `-⏎··---⏎⏎··Pone`, and after a table or quote the item is gone. |
| Line 68 (c): Shift+Enter after a space keeps a space the save drops | Enter after a space has the same difference. Fixing it reverses the serializer's row B5 or the reload-differences plan's Non-Goal on whitespace at a line's end (line 999); it is a rule for all line ends, not one key. |
| Line 68 (d): `&#32;a` loses its reference after an edit | This is the medium entry "an edit-save drops a leading `&#32;&#32;`" (line 30) with one reference: the importer would have to hold the space and the save write it back. |
| Line 68 (a) and (b) | (a) is by design (`plans/implemented/markdown-editor-reference-links.md`, "Re-pointing references when a definition is edited"). (b) is how Tab indents a first nested item; the editor, the save and the reload agree. |

### Changelog — fixes edit the feature's unreleased entry when it lists the behaviour

The chain records a fix as a new *Fixed* entry, or as an edit of the feature's own unreleased entry when that entry lists the behaviour (previous plan, footnote `[^changelog]`). Here:

- New *Fixed › Components* entries: the menu rows; the lone checkbox and the code block; the marker-line whitespace in source mode; the ordered item in an item's text; `\r\n` before mount; the element carets and the declined inserts; the no-break-space link.
- New *Added › Core* entry: `AriaRole` gains `'menuitemcheckbox'` and `'menuitemradio'`, as "`AriaRole` gained `'textbox'`" (`next.md:1120`).
- Edited entries: "writes a joined block's text with the escapes the place it joins needs" (`:2092`, the `>` rule); "WYSIWYG surface no longer shows the blanks a paragraph line opens with" (`:2241`); "saves a link or image title as it is" (`:2328`); "reads an HTML block start on a last line" (`:1739`); "writes a raw Markdown block so that it reads where it stands" (`:1910`, two clauses the HTML fix makes untrue); "Tabs in Markdown indentation count as CommonMark counts them" (`:2219`, the setext tab); and the four Shift+Enter passages (`:1265`, `:1551`, `:2116`, `:2164`).
- The `~~` run is covered by the source-mode colours entry (`:293`); the preset sharing is internal and needs none.

---

## Public API

```ts
// core/Aria.ts: AriaRole gains two members
type AriaRole = … | 'menuitem' | 'menuitemcheckbox' | 'menuitemradio' | 'menu' | …;

// component/container/AbstractBooleanMenuRow.ts (public, abstract)
abstract class AbstractBooleanMenuRow … {
    /** New protected hook: the row element's menu item role. RadioMenuRow overrides it. */
    protected getMenuItemRole(): "menuitemcheckbox" | "menuitemradio";   // default "menuitemcheckbox"
    // getActiveDescendantId() override removed: MenuRow's default (the row's own id) applies.
}

// component/container/RadioMenuRow.ts
protected getMenuItemRole(): "menuitemradio";

// component/editor/CodeEditor.ts: signature unchanged, behaviour widened
getValue(): string;   // before mount, `\r\n` and `\r` read as `\n`
```

Internal additions, none re-exported from an entry point (`typedoc.json` has `excludeInternal: true`):

```ts
// MarkdownEditor.ts: now exported, @internal (shared with MarkdownDocumentPanel.ts)
export interface TextStylePreset { text: string; value: string | null; }
export const TEXT_COLOUR_PRESETS: readonly TextStylePreset[];
export const FONT_FAMILY_PRESETS: readonly TextStylePreset[];
export const FONT_SIZE_PRESETS: readonly TextStylePreset[];

// markdownNodeState.ts
export const BLANK_REFERENCES: RegExp;
export const taskBlankTextState: StateConfig<"mdTaskBlankText", string>;

// markdownTaskCheckboxNode.ts
export function $savesAsCheckboxAlone(node: MarkdownTaskCheckboxNode): boolean;
export function $keepBlankTextOfCheckbox(node: MarkdownTaskCheckboxNode, source: string): void;

// markdownSourceSyntax.ts
export const MARKDOWN_ITEM_TEXT_ENDS: MarkdownConfig;

// markdownWritable.ts: $breakRuleContainerOf, $contentFollows and $lineBreakUnwritableAt are no longer
// exported (MarkdownEditor.ts stops importing them); $lineBreakUnwritableAt loses its `rest` parameter.
```

---

## Ordered Implementation Steps

Work in `.worktrees/markdown-small-known-issue-fixes`. Its `node_modules` and `packages/lib/node_modules` are symlinks to the main tree; do not run `npm install`. Run tests from `packages/lib`. `$P` stands for `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans6/small-known-issue-fixes`.

Each stage's reference code is its diff `$P/steps/<n>-<name>.diff`. The eight diffs were made one on top of the other, so they apply cleanly in this order and in no other. For each stage: apply its tests first and check the red count, then its source, then its docs (`git apply --include=…`, patterns below), and read the result against `## Architecture Decisions` and the project's conventions (JSDoc on every function, explicit return types, documented constants, no call inside an `if` condition). Commit each stage as a code commit and a documentation commit, as the previous branch did.

The include patterns, from the repo root:

- tests: `--include='packages/lib/tests/*'`
- source: `--include='packages/lib/src/*'`
- docs: `--include='packages/lib/docs/*'`

The red count of a stage is the number of failing tests in the test files its diff touches, run with the stage's tests applied and its source not yet applied. The green check is the same files with both applied.

1. **Read the critical files** in `## Critical Files`. Run `npx vitest run tests/component/markdown tests/component/display tests/component/code-editor.test.ts`; it passes on the base.

2. **Menu row roles** (`1-menu-row-roles.diff`). Tests touch `tests/component/container/MenuRow.test.ts` and `tests/overlay/Menu.keyboardSession.test.ts` (row A2 rewritten). Red: 5 of 140. Then source (`Aria.ts`, `AbstractBooleanMenuRow.ts`, `RadioMenuRow.ts`): 140 pass. Check: `grep -n "getActiveDescendantId" src/typescript/lib/component/container/AbstractBooleanMenuRow.ts` finds nothing.

3. **Text style presets** (`2-text-style-presets.diff`). The one new row in `markdown-document-panel.test.ts` is a guard: 64 of 64 pass before and after. Check it guards: change `#cc0000` to `#dd0000` in `TEXT_COLOUR_PRESETS` after the source is applied; the new row passes and the literal row at line 984 fails; revert.

4. **Lone checkbox and code block** (`3-lone-checkbox-and-code.diff`). Tests: `markdown-editor-task-items.test.ts` (the row "saves as `- [ ]` once a click unchecks it…" at line 1730 is replaced, line 1722 strengthened) and `markdown-source-mode-through-model.test.ts`. Red: 45 of 765. Then source: 765 pass.

5. **Source grammar and `\r\n`** (`4-source-grammar.diff`). Tests: `code-editor.test.ts`, `markdown-source-look.test.ts`, `markdown-editor.test.ts`, `markdown-editor-source-mode-mounted.test.ts`, and row 5.30 of `markdown-source-mode-through-model.test.ts` (line 721) rewritten. Red: 37 of 2,431. Then source (`markdownTabStops.ts`, `markdownSourceSyntax.ts`, `languages.ts`, `CodeEditor.ts`, `MarkdownEditor.ts`): 2,431 pass. Check: `grep -n "MARKDOWN_ITEM_TEXT_ENDS" src/typescript/lib/component/editor/languages.ts` finds the import and the use.

6. **Joins, line-start blanks and titles** (`5-joins-blanks-titles.diff`). Tests: `markdown-editor-command-crashes.test.ts` (6 join rows and the 150-row join sweep), `markdown-editor.test.ts` (9 rows and the 400-row blanks sweep), `markdown-editor-reload-differences.test.ts`, `markdown-images.test.ts`, `markdown-reference-links.test.ts`, row 8.1 of `markdown-source-mode-through-model.test.ts` (about line 938), and the round-trip changes (`corpus/referenceLinks.ts:59`, `corpus/divergences.ts:22`, the standard-form gate in `markdown-edit-fuzz.test.ts` and `markdown-nested-edit-fuzz.test.ts`). Red: 423 of 6,761. Then source: 6,761 pass.

7. **Readers** (`6-readers.diff`). Tests: `display/markdownLexer.test.ts`, `markdown-source-mode-through-model.test.ts`, `markdown-importer.test.ts` (a new describe at the end, and HE7 at line 4318), `markdown-source-places.test.ts`, and the 15 RL/RW/RD rows of `markdown-editor-list-item-edits.test.ts` that now expect one blank line. Red: 59 of 2,242. Then source (`markdownExtensions.ts`, `markdownImporter.ts`, `markdownWritable.ts`): 2,242 pass. Then rename the 16 rows whose names still describe the second blank line (for example "RW1: an HTML block start keeps its second blank line…"), so each says the block is written one blank line from the next, as `<div>` is; keep their ids.

8. **Element carets and declined inserts** (`7-element-carets.diff`). Tests: `markdown-editor-table-commands.test.ts` (9 rows after P13), `markdown-editor-quotes.test.ts`, `markdown-editor-list-item-edits.test.ts` (Z rows). Red: 20 of 895. Then source: 895 pass.

9. **Shift+Enter over a range** (`8-shift-enter-over-a-range.diff`). Tests: the 34 rewritten rows and 10 new rows in `markdown-editor-command-crashes.test.ts`, `markdown-editor-table-edge.test.ts`, `markdown-editor-list-item-edits.test.ts`, `markdown-editor-table-commands.test.ts`, `markdown-editor-horizontal-rules.test.ts` and `markdown-importer.test.ts`. Red: 44 of 3,084. Then source (`MarkdownEditor.ts`, `markdownWritable.ts`): 3,084 pass. Checks, from `packages/lib`:
   - `grep -rn "DeclinesLineBreak\|startsOnListContainer\|rawBlockEmptiedFrom\|pointAheadOfSettledCaret" src/` finds nothing (the case-sensitive pattern does not match `$declinesLineBreak`, which stays);
   - `grep -n '"declined"' src/typescript/lib/component/editor/MarkdownEditor.ts` finds nothing.

10. **Docs check.** Each stage applied its own docs part above; the stage diffs hold every wording, including the *Task items* bullet and the raw-block paragraph of `MarkdownEditor.md`, which were merged by hand when the diffs were made. After the last stage, read `## Documentation Impact` against the result and run `grep -n "^#" docs/reference/changelog/next.md`: the same 22 headings as the base, each on its own line.

11. **Verification**, as given in `## Verification`.

The known-issues list (`scratch-keep/known-issues-2026-10.md`) is outside the repo. Do not edit it: the orchestrator updates it after the merge.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Aria.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/AbstractBooleanMenuRow.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/RadioMenuRow.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/languages.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownTabStops.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceSyntax.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownImporter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownNodeState.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownTaskCheckboxNode.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` |
| Modify | `packages/lib/tests/component/container/MenuRow.test.ts` |
| Modify | `packages/lib/tests/overlay/Menu.keyboardSession.test.ts` |
| Modify | `packages/lib/tests/component/markdown-document-panel.test.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/tests/component/display/markdownLexer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-command-crashes.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-horizontal-rules.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-list-item-edits.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-quotes.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-reload-differences.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-source-mode-mounted.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-table-commands.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-table-edge.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-task-items.test.ts` |
| Modify | `packages/lib/tests/component/markdown-images.test.ts` |
| Modify | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-reference-links.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-look.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-mode-through-model.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-places.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/divergences.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/referenceLinks.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-edit-fuzz.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-nested-edit-fuzz.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/components/Menu.md` |
| Modify | `packages/lib/docs/components/CheckboxMenuRow.md` |
| Modify | `packages/lib/docs/components/RadioMenuRow.md` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All rows are offline unit tests unless the section says otherwise. In the tables a string in backticks is the content of a TypeScript single-quoted literal (`\n` a line end, `\t` a tab, `\\` one backslash, `\u00a0` a no-break space); inside a table cell `\|` stands for `|`. "Fails" means the row fails on the base `c8f4a90d2` and passes after the fix; "guard" means it passes on both. Each stage diff holds the exact rows with the values measured on the prototype; where a table here and a diff disagree, the diff's value is right, and the disagreement is reported in the Implementation Notes.

### Menu rows (stage 1)

`MenuRow.test.ts`, a new describe at the end, "boolean menu rows are the menu items assistive technology reads":

| Row | Setup | Expected | Base |
|---|---|---|---|
| a checkbox row is a menuitemcheckbox named by its text, and its checkbox is hidden with no tab stop | `new CheckboxMenuRow({ text: 'Bold' })` | row `role="menuitemcheckbox"`, `aria-label="Bold"`, `aria-checked="false"`; control `aria-hidden="true"`, no `tabindex` | fails |
| a radio row is a menuitemradio … | `new RadioMenuRow({ text: 'Red', checked: true })` | `menuitemradio`, `aria-checked="true"` | fails |
| the row's aria-checked follows a click, activate() and setChecked() | as named | `'true'` / `'false'` in turn | fails |
| a disabled row carries aria-disabled on the row | `enabled: false` | `aria-disabled="true"` on the row | fails |
| a row with no text has no aria-label | `new CheckboxMenuRow()` | `aria-label` null | guard |
| a plain MenuItem keeps role="menuitem" | `new MenuItem({ text: 'Cut' }, …)` | `menuitem` | guard |

Row A2 of `Menu.keyboardSession.test.ts` (line 1364) becomes "a checkbox or radio row is named by its own id, the element that carries its menu item role": `aria-activedescendant` is the row's id, its role `menuitemcheckbox`, then after ArrowDown the radio row's id with `menuitemradio`.

### Presets (stage 2)

`markdown-document-panel.test.ts`, a new describe between "Text style / Alignment / Columns dropdowns" (line 983) and "Link popup" (line 1030): "offers the context menu's Colour, Font and Size presets: the same labels, order and values". It activates every panel item and every context-menu row with the commands stubbed and compares `{ text, value }` lists. Guard (no wrong behaviour exists today); the mutation check of step 3 shows it guards.

### Lone checkbox and code block (stage 3)

| Row | Source | Steps | Saved | Base |
|---|---|---|---|---|
| a code block made from a checked item emptied holds the marker as the item showed it | `- [x] a` | Backspace at `a@1`, `setBlockType('code')` | ```` ```\n[x]\n``` ```` | fails |
| … an unchecked item | `- [ ] a` | the same | ```` ```\n[ ]\n``` ```` | guard |
| … an item loaded with a capital marker | `- [X] a` | the same | ```` ```\n[X]\n``` ```` | fails |
| a lone checkbox written with `&#32;` stays a checkbox once a click unchecks it | `- [x] &#32;` | `setChecked(false)` | `- [ ] &#32;`, reloads as `checkbox(unchecked)` | fails |
| Ctrl+Enter toggles it and keeps the reference | `- [x] &#32;\n- b` | caret at start, Ctrl+Enter | `- [ ] &#32;\n- b` | fails |
| a numbered list keeps it a checkbox (WYSIWYG, and source mode at offset 6) | `- [x] &#32;` | `toggleOrderedList` / `numbered` | `1. [x] &#32;` | fails |
| it is still a checkbox after a load, and its standard form is the source | `- [x] &#32;` | none | save and `canonicalSave` `- [x] &#32;` | fails |

Plus a 33-row sweep "toggled, %j stays a checkbox through a save and a load" over `- [x] R`, `- [ ] R` and a nested form, for R in `&#32;`, `&#x20;`, `&#X20;`, `&#032;`, `&#9;`, `&#x9;`, `&#32;&#32;`, `&#32; &#32;`, `&#10;`, `&#13;`, `&#12288;` (all fail on the base), and a copy-and-paste row. Every row runs `expectSaveKeepsDocument` (reload, idempotence, viewer parity, standard form).

### Source grammar and `\r\n` (stage 4)

`code-editor.test.ts`, describe "built-in markdown language typing" (line 3390), with `languageOutline` and `typed`:

| Row | Input | Expected | Base |
|---|---|---|---|
| a line whose markers only whitespace follows holds no code block: %s | `-\t\t`, `-      `, `1.\t\t`, `> > \t`, `- > \t`, `  > \t`, `>\t\t`, `> >     `, `- a\n-\t\t\n- b`, `-\t\t\n  b` | `ul[li[]]`, …, `quote[quote[]]`, `ul[li[p] li[] li[p]]`, `ul[li[p]]` | fails |
| the same, sweep: a code block only where the viewer reads one | every marker shape × 11 whitespace rests | outline holds `code` exactly where `viewerModel` holds a code block | fails |
| Enter after a marker that six spaces follow | `typed('markdown', '- a\n-      \|', '\n')` | `'- a\n\n-      \|'` | fails |
| guards | `-    `, `-\t\t\n      x`, `> \t`, Enter after `-\t\t` and after `- ` | as before | guard |
| an ordered item under a list item's text starts a list | `- x\n  8. a\n  9. i` | `ul[li[p ol[li[p] li[p]]]]` | fails |
| Enter after a nested ordered item continues and renumbers it | `typed('markdown', '- x\n  8. a\|\n  9. i', '\n')` | `'- x\n  8. a\n  9. \|\n  10. i'` | fails |
| … and moves the renumbered item's later paragraph | `'- x\n  8. a\|\n  9. i\n\n     j'` | `'- x\n  8. a\n  9. \|\n  10. i\n\n      j'` | fails |
| guards | `x\n8. a` (`p`), `> x\n> 8. a` (`quote[p]`), `- x\n      8. a` (`ul[li[p]]`), Enter in a nested bullet list | as before | guard |
| an ordered item after a list item's text reads as the viewer reads it (sweep) | 6 heads × 9 marker lines, each before `z` | `languageOutline` equals the viewer's block outline | fails |
| getValue reads the line ends of the cached value as the mounted view holds them | `new CodeEditor('a\r\nb\rc\nd').getValue()` | `'a\nb\nc\nd'` | fails |

`markdown-source-look.test.ts`, `MARKDOWN_ROWS` (both themes): `x ~~~a~~~` is plain; `~~a~~~` is plain; `a ~~b~~~c~~` strikes `b~~~c`; and a new describe "the markdown language strikes what the viewer strikes", a sweep over every run of `~`, letters and spaces up to seven characters, after a word and after a space (fails on the base: 160 of 8,580 shapes differ).

`markdown-editor-source-mode-mounted.test.ts`: a source-mode `MarkdownEditor` given `'a b\r\nc d'` reads `'a b\nc d'` and bolds to `'**a** b\nc d'` before and after mount (fails). `markdown-editor.test.ts`, "MarkdownEditor dirty state": `markClean()` in source mode over `\r\n` leaves the editor clean on the switch back (fails). Row 5.30 becomes "a text holding \r\n line ends before the view mounts acts as the same text with \n line ends".

### Joins, line-start blanks and titles (stage 5)

`markdown-editor-command-crashes.test.ts`, `JOIN_ROWS` (line 2664), Delete either way round:

| Row | Source | Range | Saved | Base |
|---|---|---|---|---|
| a self-closing rest closes no tag left open in a raw list | `- a <br w\n  > q\n\nab/>cd` | `['- a <br w', 7]` to `['ab/>cd', 2]` | `- a \\<br/>cd` | fails |
| an attribute in the rest closes no tag | `…\n\nab x="1">cd` | the same to `ab x="1">cd`@2 | `- a \\<br x="1">cd` | fails |
| more of the tag's name in the rest closes no tag | `…\n\nabr>cd` | to `abr>cd`@2 | `- a \\<brr>cd` | fails |
| a self-closing rest closes no tag left open in a raw list's quote line | `- a\n  > q <br w\n\nab/>cd` | `['  > q <br w', 9]` to `['ab/>cd', 2]` | `- a\n  > q <br/\\>cd` | fails |
| a rest the viewer reads no tag in is joined as it is | `…\n\nab/ >cd` | to `ab/ >cd`@2 | `- a \\<br/ >cd` | guard |

Plus the sweep "a join after a tag left open: $name" (5 open tags × 15 rests × 2 places = 150 rows): the save holds no `html` token, reads as the expected text, and reloads as shown (86 fail on the base).

`markdown-editor.test.ts`, "MarkdownEditor WYSIWYG text of paragraph lines" (line 2089), the editor's exact text:

| Row | Source | Text | Base |
|---|---|---|---|
| a paragraph line indented before bold text | `a\n  **b**` | `a b` | fails |
| … before a code span, a link, an image | ``a\n  `b` ``, `a\n  [b](/u)`, `a\n   ![i](/i.png)` | `a b`, `a b`, `a ` | fails |
| an item line, a quote line, a line in link text, indented before bold | `- a\n    **b**`, `> a\n>   **b**`, `[a\n  **b**](/u)` | `a b` | fails |
| a paragraph line indented before inline HTML | `a\n  <span>b</span>` | `a   <span>b</span>` | guard |

Plus the sweep "the editor shows the viewer's text: $name" (16 token kinds × 5 indentations × 5 places = 400 rows; 317 fail on the base).

`markdown-editor-reload-differences.test.ts`, after C7 (line 240): bold, italic and strikethrough across the two paragraphs Enter makes in `| t1 |` save `| **t**\\n\\n **1** |` (and `*`, `~~` forms) and reload as `cells('paragraph("t")', 'paragraph("1")')` (fail); a cell paragraph written `x\\n\\n **y**` loads without the space (fails); one opening with blanks before `<b>` keeps them (guard).

`markdown-images.test.ts` and `markdown-reference-links.test.ts`: the image and the reference link copied as JSON with title `t\n\nu` into a document defining their label with title `other` save inline with `t&#10;&#10;u` and reload with that title (fail); into a document whose definition gives that title, the image keeps `![a][x]` (guard).

### Readers (stage 6)

`display/markdownLexer.test.ts`, a new describe "a setext underline may end in tabs, as CommonMark reads it": `a\n-\t` is one heading token, depth 2, `raw` the source; `a\n=\t` depth 1; `a\n---\t` one heading; `a\n-\t\nb` heading then paragraph; `a\n= \t \n`; in a quote and in an item (all fail); `- a\n  =\t` and `a\n\t-` (guards); and `lexMarkdown` equals `lexMarkdownUnbounded` on 10 sources.

A new describe "an HTML block whose start line is a block tag name alone ends at the blank line after it": `<div\n\nb c` gives `html`, `space`, `paragraph`, the HTML token's `raw` `<div`; the same after a paragraph, for `</div`, `<DIV`, `   <div`, `<details`, `<h1`, `<li`, a blank line of spaces, in a quote, in an item, interrupting a paragraph (all fail); `<div\nx\n\nb`, `<pre\n\nb`, `<div class="x"\n\nb` (guards); and the unbounded twin on 16 sources.

`markdown-source-mode-through-model.test.ts`, `ROWS`, bold:

| Row | Document | Range | Text after | Base |
|---|---|---|---|---|
| a heading underlined by "-" and a tab, as one underlined by "-" alone | `a\n-\t\n` | 0–1 | `## **a**\n` | fails |
| a paragraph after a block tag name line and a blank line | `a\n\n<div\n\nb c\n` | 9–10 | `a\n\n<div\n\n**b** c\n` | fails |
| a word beside a link whose text is a no-break space | `[\u00a0](/u) b c\n` | 8–9 | `[\u00a0](/u) **b** c\n` | fails |
| … in a list item | `- [\u00a0](/u) b c\n` | 10–11 | `- [\u00a0](/u) **b** c\n` | fails |

`markdown-source-places.test.ts`, after SP23 (line 792): "a link whose text is a no-break space is shown, so an offset of its block has a place: %j", six placements in a paragraph and a table (fail) and one in a list item (guard). `markdown-importer.test.ts`: the new describe at the end ("a tabbed setext underline and a block tag name line before a blank line read as CommonMark reads them") checks surface against the viewer, the unedited save, bold, and the reload; and a loop "a link whose text is a no-break space … is a link node" for five positions (all fail).

The 16 changed rows (HE7 and RL9, RL14, RW1–RW5, RW8, RW10–RW15, RD7) expect one blank line after `<div`, as listed in `6-readers.diff`.

### Element carets and declined inserts (stage 7)

`markdown-editor-table-commands.test.ts`, after P13 (line 665): "%s declined once the point settles leaves the selection as it was, in %j", nine rows over insertImage, insertTable and insertHorizontalRule on `::: columns⏎A⏎|||⏎```⏎code⏎```⏎:::` (fence@1), `::: {align=center}` over a table (fence@0 and @1), and `p⏎⏎| a | b |…⏎⏎q` (root@1..2; and root@1 to `b`@1, which throws on the base). Each expects the save and the selection unchanged. All fail on the base.

`markdown-editor-quotes.test.ts`, a new describe before line 668, "text typed with the caret between the blocks of a quote goes into a paragraph of its own, as a paste there": `> a\n>\n> b`, caret on the quote, type `Z`: offset 0 gives `> Z\n>\n> a\n>\n> b`, offset 1 `> a\n>\n> Z\n>\n> b` (both fail), offset 2 `> a\n>\n> b\n>\n> Z` (guard); and the same typed inside an update equals a paste.

`markdown-editor-list-item-edits.test.ts`, Z rows (line 2851), caret on the item:

| Row | Source | Caret | Edit | Saved | Base |
|---|---|---|---|---|---|
| text typed with the caret between two paragraphs of an item goes into a paragraph of its own | `- a\n\n  q\n- z` | item@1 | type `Q` | `- a\n\n  Q\n\n  q\n\n- z` | fails |
| text typed with the caret on a task item, before its text, goes in after the checkbox | `- [ ] a\n- z` | item@0 | type `Q` | `- [ ] Qa\n- z` | fails |
| an image put there goes in after the checkbox | the same | item@0 | insertImage | `- [ ] ![](u.png)a\n- z` | fails |
| Enter there opens an empty item above | `- a\n- z` | item@0 | Enter | `-\n- a\n- z` | fails |
| a table inserted there goes above the item, which keeps its checkbox | `- [ ] a\n- z` | item@0 | insertTable | the table, then `- [ ] a\n- z` | guard |

### Shift+Enter over a range (stage 8)

`markdown-importer.test.ts`, "line breaks Markdown cannot hold are not made" (line 2922), "removes it, as Delete does, and adds no break":

| Source | Selection | Saved | Base |
|---|---|---|---|
| `ab` | `b` | `a` | fails |
| `ab` | all | `` (empty) | fails |
| `p\n\n- ab\n- cd` | `p`@0 to `ab`@2 | `- cd` | fails |
| `- ab\n- cd` | `ab`@1–2 | `- a\n- cd` | fails |
| `> a\n>\n> bc\n\nz` | `bc`@1–2 | `> a\n>\n> b\n\nz` | fails |
| `### abc` | `abc`@1–2 | `### ac` | fails |
| `abc` | `b` | `a\\\nc` | guard |
| a table cell `ab` | `b` | `\| a<br> \| c \|` | guard |

`markdown-editor-list-item-edits.test.ts`, after Z31: "Shift+Enter over a range from an item's text to between the blocks of the next item removes it, as Delete does (backward %s)": `- x\n- a\n\n  para\n- b` gives `- x\n\n  para\n\n- b` (fails).

The 34 rewritten rows each assert the new save and that it equals Delete's result on a second editor: R16's six rows and TS1–TS4, TS13, TS14, TS19–TS22, TX5, CI80 in `markdown-editor-command-crashes.test.ts`; R33's eight rows in `markdown-editor-table-edge.test.ts`; CI44 and Z41 in `markdown-editor-list-item-edits.test.ts`; P11b and S1 in `markdown-editor-table-commands.test.ts`; and in `markdown-editor-horizontal-rules.test.ts` (describe line 2070) the `Shift+Enter` entry of `NOTHING` gives way to "Select All over %j, then Shift+Enter: the range goes, as Delete takes it", five documents, each saving ``. For example TS4 becomes `- ab\n-\n\nafter` in all four variants, and Z41 `- a\n\n- z`.

### Manual (browser) checks

The offline harness cannot show these. Use the demo (`npx vite --port 5404` from `packages/lib`).

1. **Menu rows in the accessibility tree.** On `#/menubar`, open Options. In Chrome DevTools' Accessibility pane the rows read `menuitemcheckbox "Enable Notifications" checked` and `menuitemcheckbox "Auto-Save"`; clicking Auto-Save makes it `checked`. On `#/md-editor`, put the caret in the text and press Shift+F10: the format rows are `menuitemcheckbox`; after ArrowDown to Bold, `document.getElementById(document.activeElement.getAttribute('aria-activedescendant'))` is the row, with `aria-label="Bold"`. In Text style ▸ Colour the rows are `menuitemradio`, Default checked; after Enter on Red, Red reads `aria-checked="true"`. No element under a row with a `checkbox` or `radio` role is outside an `aria-hidden` subtree.
2. **Shift+Enter over a selection.** In WYSIWYG with `ab`, select `b` with the mouse and press Shift+Enter: `b` goes, the caret is after `a`, no new line appears. Press Ctrl+Z once: `b` is back and selected.
3. **A lone checkbox written with `&#32;`.** Load `- [x] &#32;`, click the checkbox: it clears, and the viewer pane of the MD Editor page still shows a checkbox, unchecked.
4. **Readers.** Load `a`, then a line `-` and a tab: the viewer and WYSIWYG show a level-2 heading. Load `a`, a blank line, `<div`, a blank line, `b c`: `b c` is a paragraph that bold can format.
5. **Nested ordered Enter in source mode.** With `- x`, then `  8. a`, `  9. i`, press Enter at the end of `a`: a new item `9.` appears and `i` becomes `10.`, with no blank line.

---

## Verification

From `packages/lib`:

- `npx vitest run tests/component/markdown tests/component/display tests/component/code-editor.test.ts`: every row of `## Expected Behaviour` passes and nothing else changes. The prototype gave 81 files and 18,606 tests, all passing.
- `npx vitest run tests/component/container tests/overlay tests/component/layout tests/component/markdown-document-panel.test.ts`: passes (the menu rows are used by `Split`, `Table`, `AbstractWindow` and the editor's context menu).
- `npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p tsconfig.test.json`, `npm run lint`: clean.
- `npm run docs:api`: zero warnings (measured on the prototype). The new exports are `@internal` and linked from no public JSDoc.
- **The round-trip harness**: `tests/component/markdown-roundtrip` passes (8,430 tests on the prototype). Add no `CORPUS` row: any new row moves the corpus differential onto other commands and exposes the base's known `CommonMark 587 (Images)` caret mismatch.
- **The CommonMark comparison** must not drop. Copy `$P/combined-commonmark/`, point `MINE` in its `tests/compare.test.ts` at the copy's `out/`, and run `ONLY='**/compare.test.ts' TREE=<worktree>/packages/lib npx vitest run --config vitest.review.config.mjs` from the copy. Count the rows of `out/compare.json` whose `set` is `'spec'` and `same` true: 651 of 652 (only spec 606, Autolinks, differs); corpus rows: 556 of 635. Both are the base's counts, and no row changes its `same` value.
- Greps, from `packages/lib`:
  - `grep -rn "getActiveDescendantId" src/typescript/lib/component/container/AbstractBooleanMenuRow.ts` finds nothing;
  - `grep -n "BLANK_LINE_IN_TITLE.test(title" src/typescript/lib/component/editor/markdownSerializer.ts` finds nothing;
  - `grep -n "holdsCarriageReturn" src/typescript/lib/component/editor/MarkdownEditor.ts` finds nothing (the `editThroughModel` guard is gone).
- **Last of all, from the repo root:** run plain `npm test` with the machine at full load. It passes. Two time bounds are known to be tight under load: the 1-second bound of "every source-mode command ends at once at every offset of a document that opens with newlines" (`markdown-source-mode-through-model.test.ts`, about line 627) and the 60-second `SWEEP_TIMEOUT_MS` of the command-crashes Delete sweep; both pass alone in 2 s and 6–10 s. If either fails under load, re-run it alone and report it; do not raise a bound in this branch.

---

## Documentation Impact

No public symbol is added or renamed except the protected hook and the two `AriaRole` members, which TypeDoc picks up from their JSDoc. Every wording below is in the stage diffs.

- **`docs/components/MarkdownEditor.md`:**
  - *Task items* (line 109): a lone checkbox written with `- [x] &#32;` keeps the reference and stays a checkbox; a code block from a task item with no text holds `[x]`; a caret code sets on the task item itself acts after the checkbox.
  - The raw-block paragraph (line 97): the `>` that would close a tag left open is escaped too; Shift+Enter over a selection that leaves such a block removes it, then adds the break only where it has a place; "would leave nothing but the break" removes the selection and adds no break.
  - Line 83 (*Commands over a range that crosses a rule*), line 105 (*Line breaks*), line 111 (*Lists*), line 112 (*Tables*): the Shift+Enter sentences, as in stage 8; *Lists* also gains the caret between an item's blocks that code can set anywhere, and the caret on an item before its text.
  - *Quotes* (line 113): a caret between two blocks of a quote takes typed text in a paragraph of its own.
  - Line 87: a link whose title holds a blank line takes its definition's edited title; one copied in is saved inline with the title it shows.
  - Line 326: the `markClean()` corner case over `\r\n` is deleted.
- **`docs/components/CodeEditor.md`** (line 382, the `getValue()` / `setValue()` row): the line ends are `\n` before mount as after.
- **`docs/components/Menu.md`** (line 90), **`CheckboxMenuRow.md`**, **`RadioMenuRow.md`**, **`docs/concepts/accessibility.md`** (line 44): the rows are `menuitemcheckbox` / `menuitemradio`, named by their text, the control hidden.
- **`docs/reference/changelog/next.md`**: as in *Changelog — fixes edit the feature's unreleased entry when it lists the behaviour*. Its paragraphs wrap at about 76 columns; each edited paragraph is rewrapped, and every `###` heading stays on its own line (check with `grep -n "^#" docs/reference/changelog/next.md`: the same 22 headings as the base).

---

## Potential Challenges

- **The stage diffs apply only in order.** `MarkdownEditor.ts`, `markdownWritable.ts`, `MarkdownEditor.md` and `next.md` are touched by several stages; each diff was taken on top of the one before. Use plain `git apply` (it applies cleanly); a conflict means a stage was skipped or reordered.
- **`git stash` is shared by every worktree.** Two research agents found other trees' stashes on the stack. To see a stage's red count, apply its tests first, as the steps do, instead of stashing source.
- **The sweeps build many editors.** The 400-row blanks sweep and the 150-row join sweep are `it.each` rows in files that already dispose their editors; keep that.
- **A new corpus row exposes a known base mismatch** (`CommonMark 587` with the task toggle); add none.
- **Tight time bounds under full load** (see `## Verification`).

---

## Critical Files

- [AbstractBooleanMenuRow.ts:98-124, 268-282](../packages/lib/src/typescript/lib/component/container/AbstractBooleanMenuRow.ts#L268), [MenuItem.ts:246-260](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L246), `overlay/Menu.ts:1347-1371` (`setFocusedIndex`), `core/Aria.ts:10-46`.
- [MarkdownDocumentPanel.ts:394-431](../packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L394), `MarkdownEditor.ts:8312-8350` and `:12988-13050` (the presets and the context menu that reads them).
- [markdownSerializer.ts:1366-1445](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1404) (`$serializeBlockContent`, `$writeRestOfBlock`, `withTaskMarker`), [markdownTaskCheckboxNode.ts:255-300](../packages/lib/src/typescript/lib/component/editor/markdownTaskCheckboxNode.ts#L280), `markdownNodeState.ts:230-242` (`taskMarkerState`, the precedent), [markdownWritable.ts:130-170](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L150).
- [markdownTabStops.ts:180-222](../packages/lib/src/typescript/lib/component/editor/markdownTabStops.ts#L217), [markdownSourceSyntax.ts:120-225, 550-580](../packages/lib/src/typescript/lib/component/editor/markdownSourceSyntax.ts#L133), `languages.ts:560-660` (`taskMarkerExtension`, the extensions list), `node_modules/@lezer/markdown/dist/index.js:330-411, 692-760` (`isOrderedList`, `IndentedCode`, `DefaultEndLeaf`, `advance`).
- [CodeEditor.ts:870-885, 2450-2465](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L876), `MarkdownEditor.ts:9915-9925`.
- [MarkdownEditor.ts:3784-3830](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3810) (`$joinedMarkdown`), `markdownSerializer.ts:4401-4441, 6283` (the read-back precedent).
- [markdownImporter.ts:2278-2400, 2422-2440, 2938-2970](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L2386), `display/markdownLineContent.ts:1-20` (`holdsLineContent`), `markdownSerializer.ts:4178-4192` (`serializeTableCell`), `:6863-6882` (`trimLineEdges`).
- `markdownSerializer.ts:5770-5785, 6316-6326`, `markdownWritable.ts:1670-1700` (`$adoptDefinitionTitles`).
- [markdownExtensions.ts:470-520, 700-760, 1130-1220](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L728) (`SETEXT_UNDERLINE_LINE`, `hasSetextUnderline`, `htmlWithInputEndAsLineEnd`, `fencesWithColumnIndent`, `DIALECT_BLOCK_TOKENIZERS`, the bounded slots).
- `markdownSerializer.ts:80-130, 1860-1990, 2890-2920, 2410-2420` (the second-blank-line path that stays).
- [MarkdownEditor.ts:2520-2680, 3340-3620, 6580-6600, 6830-6930](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2527) (settling, `$openBlockAtItemCaret`, the range guards, `$settleCaretPastCheckbox`, `$ruleEdgeRangeVerdict`), `:11886-12100` (the three inserts), [markdownWritable.ts:2180-2240, 3150-3160](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L2187) (`$declinesLineBreak`, `$editOrRestore`).
- Plans: `plans/implemented/markdown-eleven-known-issue-fixes.md` (the shape of this plan); `markdown-task-lists.md` (decision "A task item with no text after its checkbox", line 246, footnote `[^empty-item]`); `markdown-tab-column-parity.md:1206`; `markdown-commonmark-images.md:295, 1593`; `markdown-editor-reference-links.md:621-628`; `markdown-columns-fixes.md` (the column-fence Non-Goal); `markdown-editor-tab-over-range-before-list.md:61` and `markdown-editor-marked-import.md` (about line 1578) for the Shift+Enter history.
- The stage diffs under `$P/steps/`, and `$P/steps/build.sh`, which rebuilds them.

---

## Non-Goals

- **The dropped entries** in *Dropped entries — not small*: the column fence, `insertRawText`, the HTML input space, a pasted rule then paragraph after a checkbox, and line 68's four parts.
- **The reload differential's unexplained steps** (line 67) and **the table-reading half of line 177** (lezer's own limit), left out by the request.
- **Removing the serializer's second-blank-line path**, which the HTML fix leaves unreached; a pure deletion for its own review.
- **`canInsertTable` and `canInsertHorizontalRule` in the settle-then-decline cases.** They still report `true` where the command now declines and restores the selection, so a menu item stays enabled and does nothing there. Reading them on a settled clone needs a `selection` parameter on six helpers (about 25 lines).
- **A checkable plain `MenuItem`** (`checked` on a `MenuItemConfig`) still renders `role="menuitem"` with a ✓ glyph and no `aria-checked`; `checked` covers both a toggle and a choice, so the role needs a new config field.
- **The panel's other hand-copied dropdowns** (Alignment, Columns, the table's Align column): typed values, so only labels or order could drift.
- **Findings for the orchestrator to add to the known-issues list** (all the same on the base):
  - in source mode, a caret on a lone checkbox's line acts on the next item (`- [x] &#32;⏎- b`, offsets 2–11);
  - `- [x] a&#13;` toggled saves a raw carriage return;
  - trailing blanks before a soft break show as an extra space (`a·⏎b`);
  - `insertImage` at an element caret on a table node or row changes nothing and moves the caret;
  - `insertHorizontalRule` over a range with a rule at an end whose settled start lands in a code block removes the rule and inserts nothing;
  - a source-mode editor built with `''`, then `setValue`, `markClean()` and a switch to WYSIWYG ends up dirty;
  - source mode reads `a` over a single `-` inside a list item (`- a⏎··-`) as an empty nested list, where the viewer reads a heading;
  - a tab after an HTML tag name (`<div→`) never ends the block at a blank line; `meta` is in `marked`'s condition-6 list but not CommonMark's;
  - `appendSourceNode` still shows a no-break space in a source node as a plain space, and `markdownWritable.ts:3024`, `:3886` test `/\S/`;
  - a MenuBar menu stayed open in the demo after its page's route changed (not investigated).

---

## Addendum: Measurements

Taken on private copies of `c8f4a90d2` under `$P/` (each research topic's probes in its own folder) and on the stage-by-stage tree `$P/steps/build.sh` makes.

| What | Result |
|---|---|
| Lone checkbox sweep (17 trailing forms × 11 document shapes, toggled, four checks) | Base fails 143 of 187; after, 0. |
| Marker-line whitespace sweep (9,792 documents: code block in source mode against the viewer) | 3,166 differ on the base; 0 after. Full outlines: 3,318 to 190, all 190 on the base already. |
| Tilde sweep (runs of `~`, letters, spaces, lengths 2–8, 8,580 shapes; lengths up to 10, 86,258) | 160 differ on the base; 0 after, at both lengths. |
| Ordered item in item text (6 heads × 9 lines), and a three-line sweep with the whitespace fix (6,498) | No document newly differs; the three-line sweep goes from 2,696 to 737 differing outlines. |
| `\r\n` before mount: bold, h2 and bulleted at all 13 offsets of `a\r\nb\r\n\r\n- c\r\n- d` | 39 of 39 unchanged on the base; 39 of 39 equal the `\n` runs after. |
| Join sweep (5 open tags × 18 rests × 2 places) | 97 of 187 read HTML on the base; 0 after. |
| Line-start blanks sweep (18 token kinds × 5 indentations × 6 places, 540) | 363 show other text than the viewer on the base; after, only the 46 inline-HTML documents, by design. |
| Setext sweep against commonmark.js (2,880 documents) | 1,820 agree on the base; 2,700 after; no regression. |
| HTML block sweep against commonmark.js (19,040 documents) | 12,556 agree on the base; 16,012 after; no regression. The rest are a tab after the tag name, `meta`, and an item's content column. |
| No-break-space link sweep (14 constructs × 8 places) | Unplaced offsets in 59 of 112 on the base, 40 after (exactly the `x` control's 40); 5 lost links on save, 0 after. |
| Insert sweeps (651 element-caret runs; 1,356 text-to-element runs) | 12 moved-and-declined on the base, 0 after; 22 emptied cells and 36 throws on the base, 2 rule-case runs after. |
| Shift+Enter shapes | Every lifted row equals "Delete, then Shift+Enter" on the same selection; one undo restores text and selection. |
| Stage red counts (stage tests, source not yet applied) | 5, 0 (guard), 45, 37, 423, 59, 20, 44. The stage's files then all pass: 140, 64, 765, 2,431, 6,761, 2,242, 895, 3,084. |
| All test changes against the base source | 634 failures in 21 files; all pass with the source. |
| Combined tree | Both typechecks and eslint clean; `docs:api` zero warnings; Markdown set plus `code-editor.test.ts`: 81 files, 18,606 tests, all pass; with the container, overlay and layout tests: 195 files, all pass. CommonMark: spec 651 of 652, corpus 556 of 635, the base's counts, no row changed. |

---

## Notes

[^menu-roles]: `getActiveDescendantId` pointed at the control so that a screen reader would announce name and state "without changing the row's roles" (`plans/implemented/context-menu-keyboard-operation.md`, footnote at line 700). The control's `tabindex="0"` also broke that plan's "Rows stay non-focusable" (line 30). The control cannot simply lose its role: `Checkbox.applySelected` and `RadioButton.applySelected` (`Checkbox.ts:614`, `RadioButton.ts:492`) rewrite `aria-checked` on every change, `applyEnabled` rewrites `aria-disabled`, and `Aria` has no `clearChecked`. Hiding the subtree drops all of it. The hook has a default rather than being abstract because `AbstractBooleanMenuRow` is public (`component/container/index.ts:16`) and an abstract member would break consumer subclasses. Every user of the rows (`Split.ts` 1786–1842, `Table.ts` 1894 and 1983, `AbstractWindow.ts` 2223 and 2232, `MarkdownEditor.ts` 12960 and 13049, the demo's `MenuBarPanel.ts`) changes with no edit.

[^presets]: No new module: the presets belong to the context menu in `MarkdownEditor.ts`, and `LARGE_TEXT_SCALE`, which the size preset uses, is also read there by the kept-clear area (lines 8619 and 8681). A shared `{ label, presets }` group list was considered for the submenu titles; it would also have to carry which command each group calls (`this._editor.setX` against `this.setX`), a small design of its own. On the base a changed editor preset left the panel's literal row passing, so nothing caught drift.

[^empty-item]: Writing every empty task item in a form that reloads as a checkbox was decided against by `plans/implemented/markdown-task-lists.md` (section at line 246, footnote `[^empty-item]` at line 1484: `- [ ] &nbsp;` "puts a character in the document the user never typed"). This fix keeps a reference already in the document and leaves every other empty item at the decided `- [ ]` / `- \[x\]`. The regex in the state's `parse` also guards a checkbox pasted as JSON.

[^blank-rest]: `getListIndent` already gives such an item CommonMark's content column (marker width plus one), so the lines after it read as before. The parser is not about tabs, but it is a correction of a stock block parser placed in front of it, which is what `MARKDOWN_TAB_STOPS` holds; a separate `MarkdownConfig` would add a second entry in `languages.ts` for one rule. Enter now gives lang-markdown's handling of an empty item in both forms. What remains, `-→→⏎⏎··x` (lezer keeps `x` in the item), is the known issue "`9.⏎⏎···j` reads `j` inside the item".

[^join-width]: The entry's own suggestion, `^([ \t]*\/?)>`, covers `/>` and ` />` but leaves attributes, more of the tag's name, a tab or two spaces before `/>`: 86 of the sweep's 150 rows fail on the base and most would stay failing. The lexer judges a `>` inside a quoted value or a code span, so text the viewer reads as no tag is left as it was. When the item line is joined the raw block re-reads as a list and the serializer escapes the `<`; on the quote line the block stays raw and the `>` is escaped. The rows that pinned the old check (TE78, K16 to K18 of `plans/implemented/markdown-editor-join-escapes-heading-line.md`) still pass.

[^cell-space]: The space is needed: `_x_\n\n_y_` and `*{*\n\n**}**` do not open without it (probe `$P/saves/probes/tests/cell-space.test.ts`), and `plans/implemented/markdown-editor-reload-differences.md` (line 359) decided that `serializeTableCell` keeps adding it. Writing it only where a delimiter could not open would need a read-back or a flanking rule for `_` and punctuation.

[^fuzz-gate]: The edited save of that case rewrites the tab-indented definition at the item's column (`- a fuzz0⏎⏎··[x]: /u "t⏎⏎··u"`), which the viewer reads with the title `t⏎⏎u`, while the standard form now writes the link inline with the editor's title `t⏎⏎··u`. That rewrite is what `edits: 'definitionTitleIndent'` records. On the base both sides read `t⏎⏎u` only because the exemption kept the reference form in the standard form too. Only two corpus cases have an `edits` divergence, both this one; the other already passed the gated check. Keeping `canonical` on the case instead makes the round-trip test's unedited `canonical` check fail with "now holds — remove its known divergence".

[^shift-enter-history]: The rule began in `plans/implemented/markdown-editor-marked-import.md` (about line 1578: "Shift+Enter … declines … wherever no content follows the selection's end in its block"), written for a caret. `markdown-editor-table-delete-merge.md` (about line 880), `markdown-editor-command-crash-fixes.md` (about line 757), `markdown-editor-raw-block-range-edits.md` (lines 102–112) and `markdown-editor-cross-item-range-removal.md` (line 184) each added a predictor so that their range shape matched it; the raw-block plan recorded the case where the selection is removed and no break added as a limit. `markdown-editor-tab-over-range-before-list.md` rejected the lift because it "breaks 'a declined Shift+Enter changes nothing'". No plan gives a reason a user would see.

[^shift-enter-why]: The only reason the decline had was consistency with a rule written for a caret. The lift keeps every save guarantee (the break is judged at the caret that really remains), keeps one-step undo, matches the raw-block behaviour already documented, and deletes about 250 lines of prediction code whose job was to guess the result of a removal before making it. The cost is test and doc churn, all of it mechanical ("what Delete gives"). The lift is measured as a design reversal rather than a small fix, which is why it is its own stage and its own decision.

[^column-fence]: `plans/implemented/markdown-columns-fixes.md` lists "CommonMark indentation for fence lines" as a Non-Goal and rejects teaching the scan list items (`[^why-convert]`); `docs/components/Markdown.md:81` documents the rule. The prototype of the container-aware scan is saved as `$P/readers/prototype-entry-column-fence.diff` with its sweep (`$P/readers/probes/tests/sweep-fence.test.ts`) for a later plan that reverses the Non-Goal; its remaining 58 sweep failures are lazy lines in an item's paragraph, which a line scan without paragraph tracking cannot read.
