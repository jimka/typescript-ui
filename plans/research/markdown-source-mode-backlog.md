# Markdown source-mode editing — deferred feature backlog

A record of the `MarkdownEditor` commands that were **deliberately left out**
of the source-mode editing work, with enough detail to plan each of them
later. This is a research/backlog document, not an implementation plan — it
lives outside `plans/` proper so `/implement` does not pick it up.

Written against `master` at commit `37606021` ("Print qa-ab.py's changes the
same on every Python version").

All file references are relative to `packages/lib/src/typescript/lib/` unless
noted.

## Context

`MarkdownEditor` has two editing surfaces — the Lexical WYSIWYG surface and a
raw-Markdown [`CodeEditor`](../../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts)
— swapped by `setMode()`. Its ~32 public mutator commands originally all acted
on the Lexical document regardless of mode, so in source mode they mutated a
*stale phantom* document that was never reloaded from the source text: the
edit was invisible, discarded on the next mode switch, and leaked a bogus
`"change"` event carrying content the user never typed.

That is being fixed in three pieces:

| Where | Scope |
| --- | --- |
| [`markdown-source-mode-editing.md`](../markdown-source-mode-editing.md) | The phantom-mutation fix, the pure transform module, the `CodeEditor` range-replacement seam, source-mode selection state, and the inline + block-prefix commands. |
| [`markdown-source-mode-styled-spans.md`](../markdown-source-mode-styled-spans.md) | `setTextColor` / `setFontFamily` / `setFontSize` — the `[t]{…}` styled-span dialect extension. |
| **This document** | Everything below. |

Everything here assumes the transform module and the `CodeEditor` seam from
the first plan already exist; none of these items is worth planning before
that lands.

## 1. Block fence commands — `setBlockAlignment`, `setColumnCount`

**What:** the `:::` fence dialect extension, built by
[`markdownBlockTransformer.ts`](../../packages/lib/src/typescript/lib/component/editor/markdownBlockTransformer.ts).
An opening `::: {align=center columns=3}`, `|||`-separated column sections,
and a bare `:::` closer, nestable (the importer tracks fence depth).

**Why deferred:** these are block-structure commands, not inline ones. Unlike
a heading or quote prefix, they need to find the *enclosing* fence around the
caret — or, when there is none, decide which top-level blocks the selection
spans and wrap exactly those. That is a document scan with nesting, which puts
it much closer to the table work below than to anything in the first plan.

**What a plan must solve:**

- Locating the enclosing fence from a character offset, honouring nesting.
  The importer's own depth-tracking loop in `handleImportAfterStartMatch` is
  the reference implementation of that scan.
- Mirroring the WYSIWYG unwrap rule: `MarkdownBlockNode.canUnwrap()` removes a
  fence once it carries no alignment and no more than one column, so clearing
  an alignment must textually unwrap the fence rather than leave `::: {}`.
- The column-count grow/shrink semantics, which are specified in
  `setColumnCount`'s doc comment and are not trivial: growing appends empty
  columns, shrinking merges surplus content into the last column kept *except*
  a surplus column still in its pristine created state, which is dropped —
  so grow-then-shrink returns the original document.
- Reusing `parseAttributes` / `formatAttributes` from
  [`component/display/markdownAttributes.ts`](../../packages/lib/src/typescript/lib/component/display/markdownAttributes.ts)
  rather than hand-rolling attribute serialisation.

## 2. The nine table-structure commands

`insertTableRow`, `deleteTableRow`, `insertTableColumn`, `deleteTableColumn`,
`setTableColumnAlignment`, `deleteTable`, `mergeTableCells`,
`unmergeTableCell`, `setTableColumnWidth`.

**Why deferred:** this is the expensive one. Every other deferred item is a
scan; this needs a real GFM table parser over source text, because the
dialect's tables carry structure that a naive `split("|")` destroys:

- **Alignment** rides the delimiter row — `:---`, `:---:`, `---:`.
- **Column width** rides the same row as an attribute group:
  `| :--- {width=240} | --- |`.
- **Merged cells** are continuation markers in body cells: `<<` extends the
  cell to its left, `^^` the cell above, both transitively. A cell whose
  entire trimmed text is literally `<<` or `^^` is escaped to `\<<` / `\^^`
  so it round-trips as content — so the parser must handle the escape, and
  any writer must re-apply it.
- Cell text is itself Markdown (converted per-cell through the transformer
  array), and embedded newlines are encoded as `\n`.

`markdownTableTransformer.ts` already contains all of this logic —
`parseDelimiterRow`, `formatDelimiterRow`, `splitTableRow`,
`escapeCellText` / `unescapeCellText`, and `resolveMergeGrid` — but written
against Lexical nodes. A plan should establish whether those helpers can be
lifted into a shared, node-free layer that both the transformer and the
source-mode commands parse through, rather than growing a second
implementation that can drift from the first.

**Degrades honestly without this:** `MarkdownDocumentPanel.applySelectionState`
disables the Table button whenever `inTable` is false, so a source-mode
selection state that reports `inTable: false` greys the whole dropdown out
rather than offering commands that silently do nothing.

## 3. `readOnly` does not gate the WYSIWYG commands

**Not a feature — a pre-existing inconsistency** found while investigating the
above, recorded here so it isn't rediscovered.

`toggleBold()` on a `MarkdownEditor` constructed with `readOnly: true` still
produces `**hello world**`. Read-only on the WYSIWYG side is a typing and view
guard (`editor.setEditable(false)`), not a command guard, so every programmatic
command bypasses it.

The source surface behaves the opposite way: `CodeEditor` uses CodeMirror's
`EditorState.readOnly` facet (`buildReadOnlyExtension`), which rejects *every*
document transaction, programmatic ones included. So the two surfaces disagree
about what `readOnly` means for a command.

The first plan settles the contract for the source side. Whether the WYSIWYG
side should be brought in line — and whether that is a behaviour break for
consumers relying on programmatic writes into a read-only editor — is an open
question for its own change.

## 4. Source-mode context menu

Right-clicking in source mode shows `CodeEditor`'s own context menu (the
clipboard rows from `buildClipboardMenuItems`), not `MarkdownEditor`'s
richer target-aware menu, which is wired to the WYSIWYG surface alone via
`WysiwygSurface`'s `"contextmenu"` event and `$classifyContextMenuTarget`.

Once the source-mode commands exist, the menus could converge — but the
classifier is built entirely on Lexical node inspection, so a source-mode
equivalent needs the same textual context detection the selection state
already computes. Worth revisiting only after items 1 and 2, since the menu's
table and block submenus are exactly the commands deferred above.

## 5. Enabling technique — block offsets from the existing lexer

Both item 1 and item 2 need the same primitive: *which block does character
offset N fall inside?* Before hand-rolling that, evaluate reusing
`lexMarkdown` from
[`component/display/markdownExtensions.ts`](../../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts).
It is marked's lexer with this dialect's extensions already registered, and
marked's token `raw` fields concatenate back to the source — so absolute
offsets for every top-level block are recoverable by walking the token list
and accumulating `raw.length`, with no new parser.

Two caveats to check before committing to it: the lexer is in the *display*
package (an editor→display dependency direction that already exists via
`markdownAttributes.ts`, but confirm it is acceptable for this use), and
[`markdown-lexer-linear-time.md`](../markdown-lexer-linear-time.md) is an
unimplemented plan against that same lexer — check whether it changes the
token shape before building on it.
