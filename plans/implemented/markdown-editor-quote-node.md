---
depends-on: [markdown-editor-nested-source-preservation]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/markdownImporter.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourceMap.ts
  - packages/lib/src/typescript/lib/component/editor/editorNodes.ts
  - packages/lib/tests/component/markdown-roundtrip/viewModel.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/divergences.ts
  - packages/lib/tests/component/markdown-editor-command-crashes.test.ts
  - packages/lib/tests/component/markdown-source-mode-through-model.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
---

# MarkdownEditor Quote Node — Implementation Plan

## Overview

`MarkdownEditor`'s WYSIWYG blockquotes are Lexical's `QuoteNode` from
`@lexical/rich-text`, which holds one line of inline text. The importer builds
one only for an empty quote or a quote of one paragraph
([markdownImporter.ts:1215](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L1215)
`$buildQuote`); every other quote — two paragraphs, a list, a heading, code, a
table, a nested quote — loads as a raw Markdown block that shows its source.
Enter in a quote always leaves it, so no one can write a second paragraph in
a quote, nor put a list in one, and no typing shortcut (`- `, `1. `, `# `, `> `,
```` ``` ````) applies inside a quote. The `Markdown` viewer renders all of these, and
the editor must hold what the viewer renders.

This plan gives the editor a quote node of its own, `MarkdownQuoteNode`
(type `markdown-quote`), in a new file
`packages/lib/src/typescript/lib/component/editor/markdownQuoteNode.ts`. It
holds blocks only: paragraphs, headings, code blocks, lists, tables, `:::`
fences, raw blocks and other quotes. It replaces `QuoteNode` through
Lexical's node replacement, as `MarkdownListItemNode` replaces `ListItemNode`
([markdownListItemNode.ts:29](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L29)).
The importer, the serializer (and its nested-part preservation), the
writable-state rules, the editor's commands and key rules, and the round-trip
view model change to the new shape. The block typing shortcuts work in a
paragraph of a quote, and in a list item's further paragraphs, as at the top
level. No exported symbol changes;
`setBlockType("quote")` changes what it does.

The plan is written against `444ccaf07`, the tip of
`feature/markdown-editor-nested-source-preservation`; line numbers are from
that commit. The whole design was run as a prototype before this plan was
written: on it, 69 of the 81 corpus cases that the round-trip harness lists
under the `quoteBlocks` divergence pass, the source-mode differential compares
502 more cases with no difference once three carets at a documented tab limit
are left out (*Source mode*), the nested-edit fuzz with quote edits
passes, and loading a quote of 2,000 paragraphs takes 0.39 s where it took
10.9 s.[^prototype]

---

## Architecture Decisions

### A quote holds blocks — a node class of the editor's own

A quote's children are blocks only. A paragraph in a quote is an ordinary
`ParagraphNode`; every other block is the node it is anywhere else.

| Source | Today | After (`quote` = `MarkdownQuoteNode`) |
|---|---|---|
| `> a` | `quote("a")` | `quote(paragraph("a"))` |
| `>` | `quote()` | `quote(paragraph())` |
| `> a`, `>`, `> b` | raw block | `quote(paragraph("a"), paragraph("b"))` |
| `> # h`, `> text` | raw block | `quote(heading("h"), paragraph("text"))` |
| `> - one`, `> - two` | raw block | `quote(list(item(text("one")), item(text("two"))))` |
| `> > a` | raw block | `quote(quote(paragraph("a")))` |
| `> a`, `b` (a lazy line) | `quote("a", " ", "b")` | `quote(paragraph("a", " ", "b"))` |
| `> <div>`, `> x`, `> </div>` | raw block | `quote(raw block("<div>⏎x⏎</div>"))` |

`editorNodes.ts` registers `MarkdownQuoteNode` and the entry
`{ replace: QuoteNode, with: …, withKlass: MarkdownQuoteNode }`, so the
quotes Lexical makes itself — `$createQuoteNode()` in the `> ` typing
shortcut and in the `<blockquote>` HTML conversion — are of the editor's
class. `MarkdownQuoteNode extends QuoteNode`, so every `$isQuoteNode` check
keeps holding. This mirrors `MarkdownListItemNode`
([markdownListItemNode.ts:29](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L29),
registered at [editorNodes.ts:42](../packages/lib/src/typescript/lib/component/editor/editorNodes.ts#L42)):
static `getType`, `clone` and `importJSON`, a type name starting with
`markdown-`, and the editor's own `$create…`/`$is…` functions beside it.[^why-own-class]

Unlike a list item, a quote has no text node of its own. A list item's first
line is the item, so Enter, Backspace and block types at that line must
reach the item; a quote's first paragraph is a paragraph like its others.[^no-text-node]

### The quote is not a shadow root

`MarkdownQuoteNode.isShadowRoot()` returns `false`, and so the quote opts out
of Lexical 0.49's own block-holding quote (`quoteShadowRootState`) too. A
shadow root would keep pasted blocks as blocks without a handler, but it stops
every join and every range removal at the quote's edge, as it does at a table
cell.[^no-shadow-root]

### The normal form

After every update a quote is in this form:

1. Every child is a block.
2. A quote holds at least one child.

`$keepQuoteShape` in `markdownWritable.ts`, a transform on
`MarkdownQuoteNode`, brings any tree into that form. It reuses
`$wrapInlineRuns`
([markdownWritable.ts:263](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L263)),
which already does the same for a list item, carets included.

| Left by an edit or by Lexical | Brought to |
|---|---|
| `quote("a", "b")` — the `> ` typing shortcut moves the paragraph's text into the quote | `quote(paragraph("a", "b"))`, the caret into that paragraph |
| `quote()` | `quote(paragraph())` |
| `quote(paragraph("a"), "b")` | `quote(paragraph("a"), paragraph("b"))` |

A quote is no longer a block that holds text only. The rule that moves blocks
out of such a block (`$keepBlocksOutOfText`), the line-break rules and the
run-edge rules stop treating it as one (see *A quote is no block of text any
more*).

### What a quote holds when it loads

A quote's blocks are located and built as a `:::` column's are: `locateBlocks`
over the quote's text, then `$buildLocatedBlock` for each entry, so every
block the viewer renders in a quote is built as it is built anywhere, and text
no token covers (a repeated link reference definition, which `marked` drops)
is a raw block of the quote. This mirrors `$buildFence`
([markdownImporter.ts:1664](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L1664)).

The quote's text is its source lines, each with its first marker taken off as
`marked` takes it off: up to three spaces, `>`, and one space or tab after
it. When the source holds a tab, it is `marked`'s own `text`.[^quote-text]

A quote still loads as one raw block in two cases:

| Case | Example | Why |
|---|---|---|
| A block token of the quote is not found in the quote's text | none in the corpus; a guard | what is not found would be lost |
| A line without `>` (a *lazy line*) stands in a block that is not a paragraph or a nested quote | `> q` over `  <div`; `> - a` over `b` | such a quote reads by what follows it; the editor keeps those as raw blocks today |

A lazy line is a line of the quote's source whose first character after its
blanks is not `>`. A lazy line inside a paragraph (`> a` over `b`) or inside a
nested quote, which checks its own lines, keeps the quote a quote.[^lazy-rule]

### How a quote is saved

A quote is written as a document is (`serializeBlockList` over its children),
and each line of that text is written under the marker: `> ` before a line
that holds something, `>` alone for an empty line. A quote whose blocks write
nothing is `>`.

| Quote | Save |
|---|---|
| `quote(paragraph("a"), paragraph("b"))` | `> a` / `>` / `> b` |
| `quote(heading("h"), code("x"))`, the heading of level 1 | `> # h` / `>` / ```` > ``` ```` / `> x` / ```` > ``` ```` |
| `quote(quote(paragraph("a")))` | `> > a` |
| `quote(paragraph())` | `>` |
| `item(text("a"), quote(paragraph("q"), paragraph("r")))` | `- a` / (blank) / `  > q` / `  >` / `  > r` |

A raw block in a quote is written in its block-list form, as a raw block of
the document or of a column is (`$rawBlockSource`, unchanged).

### Unedited lines of an edited quote are written as they were

An unedited top-level quote is written as its source, as every unedited
top-level block is (unchanged). An edited quote is written block by block, as
a `:::` column is: each block of the quote is a nested part, and a block whose
standard form still equals its fingerprint is written as its source, with the
lines between two such neighbours, markers and all. Only the edited block is
written anew, each of its lines under `> `. This mirrors `writtenColumn`
([markdownSerializer.ts:4089](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L4089))
and its parts (`columnBlock`,
[markdownSourceMap.ts:118](../packages/lib/src/typescript/lib/component/editor/markdownSourceMap.ts#L118)).

| Document | Edit | Save today (the quote is a raw block) | Save after |
|---|---|---|---|
| `>first  _x_` / `>` / `>   second` / `> ` / `>third` | `!` after `second` | `>first  _x_` / `>` / `>   second!` / `> ` / `>third` | `>first  _x_` / `>` / `> second!` / `>` / `>third` |
| `> x _y_` / `>` / `> > p` / `> >` / `> > q` | `!` after `q` | `> x _y_` / `>` / `> > p` / `> >` / `> > q!` | the same |
| `- a` / (blank) / `  >b _c_` / `  >` / `  >d` / `- e` | `!` after `e` | `- a` / (blank) / `  >b _c_` / `  >` / `  >d` / (blank) / `- e!` | the same |
| `> _a_` / `>` / `> b` / `>` / `> *c*` | `b` typed over with `X` | `> _a_` / `>` / `> X` / `>` / `> *c*` | the same |

Today such a quote is a raw block, and an edit of it keeps every byte but the
edit. After, the edited block's own lines take `> `, and the lines between it
and a neighbour take `>` (the first row); everything else is kept. This is the
price of the change, measured under *Addendum: Measurements*.

The quote's blocks are recorded only when every line of the quote's source
opens with `>` and the source holds no tab; otherwise an edited quote is
written in the standard form whole, as an edited block holding a tab or a
lazy line is today. A block of a quote keeps its source only in the quote it
was loaded in.[^quote-parts]

### What each edit does, where it is decided, and what it mirrors

"Lexical's own" means no code of the editor decides it; the prototype ran
each one (*Addendum: Lexical probe*).

| Edit | Rule | Decided in | Mirrors |
|---|---|---|---|
| Enter in a paragraph of a quote | The paragraph is split; both halves stay in the quote. | Lexical's own | — |
| Enter on an empty or blank paragraph of a quote | The paragraph leaves the quote, one level out: the quote is split around it, and a quote left empty goes. In a nested quote it goes to the outer quote. | `$enterLeavesQuoteAtBlankParagraph`, an `INSERT_PARAGRAPH_COMMAND` listener | `$enterLeavesListAtBlankItemText` ([MarkdownEditor.ts:4894](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4894)) |
| Backspace key at the start of a quote's first block | That block leaves the quote, one level out. Inside a list item first, the nearest of the two decides: `- > a` gives `- a`, `> - a` gives `> a`. | `$backspaceLiftsOutOfQuote`, a `KEY_BACKSPACE_COMMAND` listener ahead of `registerList`'s, which calls `MarkdownQuoteNode.collapseAtStart` | `registerList`'s Backspace listener and `MarkdownListItemNode.collapseAtStart` |
| `DELETE_CHARACTER_COMMAND` backward there (no key, as an input method sends it) | The block's text joins the block before the quote, as any join does. | Lexical's own | the list item's text join (row `K1` of `markdown-editor-list-item-edits.test.ts`) |
| Backspace at the start of a later block of a quote | It joins the block before it in the quote. | Lexical's own | — |
| Backspace at the start of a block after a quote; Delete at a quote's end | The two texts join, inside the quote. | Lexical's own | row `K3` of the same file (an item's text joining a quote that ends the item before) |
| Backspace after a quote ending in a table or a `:::` block | As after a list ending in one: an empty block is removed and the caret goes to the end of the table's last cell; a block that holds something stays. | `$backspaceAfterContainer` | — |
| A range across a quote's edge removed, typed or pasted over | The block the range starts in keeps what is left of both ends. | Lexical's own | ranges across list items |
| A range that starts just before a quote, at a point code sets on the document | Removed first, then the insert, as for a range that starts just before a list. | `$standsBeforeList` | — |
| Blocks pasted into a paragraph or heading of a quote | The block is split at the caret and the pasted blocks become blocks of the quote between the halves. | the existing handler for a block of a list item, renamed `$pasteBlocksIntoHeldBlock` | `$pasteBlocksIntoItemBlock` ([MarkdownEditor.ts:1516](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1516)) |
| A block type on a block of a quote | The block changes in place, in the quote. | Lexical's own `$setBlocksType` | a block type on a further block of a list item |
| A list toggle on a block of a quote | The block becomes an item of a list in the quote; toggled off, the item leaves its lists and stays in the quote. | `$toggleListOfTouchedBlocks` (unchanged) | a list toggle in a `:::` column |
| `insertTable` with the caret in a quote | The table goes into the quote, the caret's block split around it. | `$insertTableAt` | — |
| The quote command | Toggles: see *The quote command toggles*. | `$toggleQuoteOfTouchedBlocks` | `$toggleListOfTouchedBlocks` |
| A caret between two blocks of a quote | Treated as a caret between two blocks of a list item: an insert gives it a paragraph of the quote first. | `$listContainerAtCaret`, `$settleCaretIntoBlock` and the guards that use them | the list item's element point |
| Indent, outdent, Tab | Unchanged: the indent commands move list items only, and Tab moves focus. | `$moveSelectedItemsOnce` | — |
| Typing shortcuts (`# `, `- `, `1. `, `> `, ```` ``` ````) at the start of a paragraph or heading of a quote | Applied as at the top level: see *Block typing shortcuts work in a quote and in a list item's further blocks*. | `registerHeldBlockShortcuts` | Lexical's `registerMarkdownShortcuts` |
| Read-only | Refused, by the existing guard: no new command is added. | `registerReadOnlyGuard` | — |

Enter on an empty paragraph leaves the quote wherever that paragraph stands,
not only at the quote's end.[^enter-exit]

| Document | Edits | Save after each |
|---|---|---|
| `> a` | Enter at the end of `a`; Enter; type `Z` | `> a`; `> a`; `> a` / (blank) / `Z` |
| `> a` / `>` / `> b` | Enter at the end of `a`; Enter; type `Z` | `> a` / `>` / `> b`; `> a` / (blank) / `> b`; `> a` / (blank) / `Z` / (blank) / `> b` |
| `> > a` | Enter at the end of `a`; Enter; Enter | `> > a`; `> > a` (the empty paragraph now in the outer quote); `> > a` (now after both) |
| `>` | caret in it; Enter | `` (an empty paragraph, the quote gone) |
| `> - a` | Enter at the end of `a`; Enter; Enter | `> - a` / `> -`; `> - a` (the item left its list, a paragraph of the quote); `> - a` (the paragraph left the quote) |
| `> a` / `>` / `> b` | Backspace key at the start of `a` | `a` / (blank) / `> b` |
| `x` / (blank) / `> a` | Backspace (`DELETE_CHARACTER_COMMAND`) at the start of `a` | `xa` |
| `> a` / (blank) / `y` | Backspace at the start of `y` | `> ay` |

### Block typing shortcuts work in a quote and in a list item's further blocks

A block typing shortcut — `# ` to `###### `, `- `, `* `, `+ `, `1. ` (up to
nine digits), `> `, ```` ``` ```` with a space, ```` ``` ```` and a language
with Enter — applies at the start of a paragraph or heading that a quote
holds, at any depth, and at the start of a paragraph or heading that a list
item holds after its text. It builds what the same shortcut builds at the top
level, in place, with the caret at the start of the new block, and it is one
undo step: one undo leaves the characters as typed, as at the top level.

| Document | Typed at the start of `b` | Saved |
|---|---|---|
| `> a` / `>` / `> b` | `- ` | `> a` / `>` / `> - b` |
| same | `3. ` | `> a` / `>` / `> 3. b` |
| same | `## ` | `> a` / `>` / `> ## b` |
| same | `> ` | `> a` / `>` / `> > b` |
| same | ```` ``` ```` and a space | `> a` / `>` / ```` > ``` ```` / `> b` / ```` > ``` ```` |
| `> b` / `>` / `> - c` | `- ` | `> - b` / `> - c`: the item joins the list after it, as at the top level |
| `> > a` / `> >` / `> > b` | `- ` | `> > a` / `> >` / `> > - b` |
| `- a` / (blank) / `  b` | `- `; `# `; `> ` | `- a` / (blank) / `  - b`; `  # b`; `  > b` |
| `- a` (the item's own text) | `# ` | `- \# a`: unchanged, no shortcut |
| `> # b` (a heading) | `- ` | `> # - b`: a list shortcut does nothing in a heading, as at the top level |

Lexical's `registerMarkdownShortcuts` applies a block shortcut only to a block
whose parent is the document or a shadow root
([LexicalMarkdown.dev.mjs:1771](../node_modules/@lexical/markdown/dist/LexicalMarkdown.dev.mjs#L1771)
`runElementTransformers`, [:1807](../node_modules/@lexical/markdown/dist/LexicalMarkdown.dev.mjs#L1807)
`runMultilineElementTransformers`), and offers no hook. The editor adds
`registerHeldBlockShortcuts`, which runs the same transformers of
`SHORTCUT_TRANSFORMERS` — their own `regExp`, `regExpStart` and `replace` — on
a block `$isHeldBlockTakingText` accepts. It copies Lexical's matching rules,
both trigger paths (the update after a typed character, and Enter at the end
of the text) and the update tags, and differs in the parent check alone. It
is registered through the proxy of `registerMarkdownShortcutsOutsideRawBlocks`
([MarkdownEditor.ts:4684](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4684)),
so it is applied by typing alone, never in a raw block, and through
`$editWritably`, exactly as Lexical's own shortcuts are.[^held-shortcuts]

A list item's own text, its first line, keeps no block shortcut, as today
(*Non-Goals*).

### The quote command toggles

`setBlockType("quote")` puts the blocks it touches into a quote, or takes them
out of their quote. Every other block type acts on blocks of text in place,
inside a quote too, so `setBlockType("paragraph")` on a quoted paragraph no
longer removes the quote.[^toggle]

The blocks a command touches are the blocks of text the selection touches
(`$touchedBlocksLastFirst`, unchanged). A block *stands in a quote* when a
quote is among its ancestors; its *nearest quote* is the closest one.

- **Off**, when every touched block stands in a quote: for each nearest
  quote, the run of its children from the first to the last that holds a
  touched block leaves that quote, one level out, the quote split around it
  (`$liftOutOfQuote`).
- **On**, otherwise: each touched block that stands in no quote goes into
  one. A list item's text first leaves its lists, as for any other block type
  (`$liftItemOut`); every other block stays where it is. Each run of such
  blocks standing side by side goes into one quote, which joins a quote right
  before the run, else one right after it, and both when quotes stand on both
  sides — as a list toggle joins the list of its kind beside the run
  (`$makeItemsOfRun`, [MarkdownEditor.ts:4258](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4258)).

| Document | Selection | Today | After |
|---|---|---|---|
| `a` | caret in `a` | `> a` | `> a` |
| `> a` | caret in `a` | unchanged | `a` |
| `a` / (blank) / `b` | `a` to `b` | `> a` / (blank) / `> b` (two quotes) | `> a` / `>` / `> b` |
| `> a` / `>` / `> b` / `>` / `> c` | caret in `b` | the raw block's text escaped into one quote: `> \> a\` / `> \>\` / `> \> b\` / `> \>\` / `> \> c` | `> a` / (blank) / `b` / (blank) / `> c` |
| `> a` / (blank) / `b` | `a` to `b` | `> a` / (blank) / `> b` | `> a` / `>` / `> b` |
| `> a` / (blank) / `b` / (blank) / `> c` | caret in `b` | three quotes | `> a` / `>` / `> b` / `>` / `> c` |
| `> > a` | caret in `a` | `> \> > a` | `> a` |
| `> - a` / `> - b` | caret in `a` | `> \> - a\` / `> \> - b` | `- a` / `- b` |
| `- a` / `- b` | caret in `a` | `> a` / (blank) / `- b` | `> a` / (blank) / `- b` |
| `- a` / (blank) / `  p` | caret in `p` | `- a` / (blank) / `  > p` | `- a` / (blank) / `  > p` |
| `## h` | caret in `h` | `> h` | `> ## h` |
| ```` ```js ```` / `x` / ```` ``` ```` | caret in `x` | `> x` | ```` > ```js ```` / `> x` / ```` > ``` ```` |
| `::: columns` / `a` / `\|\|\|` / `b` / `:::` | caret in `a` | `::: columns` / `> a` / … | `::: columns` / `> a` / … |

One toggle is one update, so one undo step.

### Block types, list toggles and tables inside a quote act in place

A block type, a list toggle and `insertTable` act where the caret's block
stands, as they do in a `:::` column; none takes a block out of its quote.

| Document | Command | Today | After |
|---|---|---|---|
| `> a` / `>` / `> b`, caret in `a` | `setBlockType("h2")` | the raw block's text escaped into a heading: `\> a\` / `\>\` / `\> b` / `---` | `> ## a` / `>` / `> b` |
| `> a`, caret in `a` | `toggleUnorderedList()` | `- a` | `> - a` |
| `> a` / `>` / `> b`, all | `toggleOrderedList()`, twice | the text escaped into one item: `1. \> a\` / `   \>\` / `   \> b` | `> 1. a` / `> 2. b`; `> a` / `>` / `> b` |
| `> \- alpha`, caret in `alpha` | `setBlockType("code")` | ```` ``` ```` / `\- alpha` / ```` ``` ```` | ```` > ``` ```` / `> \- alpha` / ```` > ``` ```` |
| `> ab`, caret after `a` | `insertTable(2, 2)` | `> a` / (blank) / table / (blank) / `> b` | `> a` / `>` / `> \|  \|  \|` / `> \| --- \| --- \|` / `> \|  \|  \|` / `>` / `> b` |
| `- > ab`, caret after `a` | `insertTable(2, 2)` | `- > a` / (blank) / table / (blank) / `- > b` | `- > a` / `  >` / `  > \|  \|  \|` / `  > \| --- \| --- \|` / `  > \|  \|  \|` / `  >` / `  > b` |

`insertTable` splits the blocks around the caret up to the nearest quote, or
to the document or a shadow root where no quote stands nearer, then inserts
there.[^table-in-quote]

### Every walk over containers treats a quote like a list item

The editor has a set of functions that tell a node that holds blocks from a
block of text, or that walk from a block to the containers around it. Each one
that names a list item names the quote beside it:

| Function | File:line | Change |
|---|---|---|
| `$holdsBlocks` | [MarkdownEditor.ts:4062](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4062) | a quote holds blocks, so it is no block of text (`$isBlockOfText`) |
| `$settleCaretIntoBlock` | [:2145](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2145) | an element point on a quote is between blocks |
| `$listContainerAtCaret`, `$isListContainerRange`, `$startsOnListContainer` | [:2414](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2414), [:2429](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2429), [:2452](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2452) | a point on a quote counts as a point on a list item, so `$openBlockAtItemCaret` gives it an empty paragraph of the quote |
| `$standsBeforeList` | [:2204](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2204) | also true just before a quote |
| `$outermostOpenedBy`, `$firstTextBlockOf` | [:3900](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3900), [:3924](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3924) | climb into and out of a quote as into a list part, so a join into a raw block or code block reaches the paragraph a quote opens with (rows `J9` and `J14` of `markdown-editor-command-crashes.test.ts`) |
| `$containerEndingBefore` | [:4841](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4841) | walks into a quote as into a list |
| `rawBlockTexts` | [markdownSerializer.ts:1270](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1270) | reads the raw blocks inside a quote, so a definition there counts |
| `$holdsParts` | [markdownSerializer.ts:973](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L973) | a quote can hold parts |

`$findEnclosingInsertableBlock`
([MarkdownEditor.ts:799](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L799))
already names quotes and stays as it is: **Insert line before block** in a
quote's paragraph puts the paragraph outside the quote, and in a list inside a
quote outside the list.

### A quote is no block of text any more

Each of these treats a quote as a block that holds inline content. The quote
is taken out of each; a paragraph or heading inside the quote is covered
because each one already handles paragraphs and headings.

| Site | File:line | Change |
|---|---|---|
| `$keepBlocksOutOfText` registration | [markdownWritable.ts:86](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L86) | `QuoteNode` leaves the list; `$keepQuoteShape` is registered on `MarkdownQuoteNode` |
| `dropInContainer` registration | [markdownWritable.ts:1741](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1741) | the `QuoteNode` line goes |
| `$isBreakRuleContainer` | [markdownWritable.ts:2109](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L2109) | a paragraph outside a cell, or a heading |
| run-edge `tidy`: `holdsTextOnly` and the registration list | [markdownWritable.ts:2477](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L2477), [:2513](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L2513) | `QuoteNode` goes from both |
| `$scratchBlock` | [markdownWritable.ts:2722](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L2722) | the quote branch goes |
| `inlineRuns` | [markdownSerializer.ts:1522](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1522) | a quote falls under the general recursion |
| `serializeQuote`'s `serializeInline` | [markdownSerializer.ts:2977](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2977) | replaced (see *How a quote is saved*) |
| `$isJoinableBlock` | [MarkdownEditor.ts:3885](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3885) | a paragraph or a heading |
| `$isItemBlockTakingText`, renamed `$isHeldBlockTakingText` | [MarkdownEditor.ts:1393](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1393) | a paragraph or heading whose parent is a list item (not as its text) or a quote |
| `createBlockNode`'s `"quote"` case | [MarkdownEditor.ts:370](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L370) | goes: the quote command no longer replaces blocks |
| `$buildQuote`, `coversText` | [markdownImporter.ts:1204](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L1204) | `coversText` goes; `$buildQuote` is rewritten |

`REBUILT_RAW_TYPES`
([markdownImporter.ts:106](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L106))
keeps both its entries and `HELD_BLOCK_TYPES`
([:378](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L378))
keeps `"blockquote"`; only the comment of the second changes, since a quote is
now always built unless one of the two raw cases holds.[^held-types]

### Source mode

Since `markdown-source-mode-commands-through-model`, a source-mode command
runs the WYSIWYG command on a model of the Markdown around the selection, and
declines where the selection touches a raw block. A quote is now a quote node
in that model, so the commands act in quotes that were raw blocks, with the
WYSIWYG result. Nothing in the source-mode code changes.

| Document | Selection | Command | Source mode today | After |
|---|---|---|---|---|
| `> - one` / `> - two` | caret in `one` | bulleted toggle | nothing (raw block) | `> one` / `>` / `> - two` |
| same | same | numbered toggle | nothing | `> 1. one` / `>` / `> - two` |
| `> a` / `>` / `> b` | caret in `b` | `setBlockType("quote")` | nothing | `> a` / (blank) / `b` |

The corpus differential of `markdown-source-mode-through-model.test.ts` (row
9) compares 5,428 cases where it compared 4,926, and counts 1,960 declines
where it counted 2,484. In three of the new cases — the quote command around
a code block whose lines a tab indents — the text is equal and the caret has
no exact place in the saved text, the documented limit of a code line whose
container prefix holds a tab. The differential leaves the caret out of its
comparison where a line the command wrote holds a tab in its container
prefix, as it already leaves out the text of such lines in
`standsInShapeWithoutSource`.[^differential]

`insertTable` and the two paragraph commands stay text edits in source mode,
by the owner's earlier decision; this plan does not touch them.

### Results that change

Every other pinned result stays. Each row below was run on the prototype.

| Test, row | Edit | Today | After | Reason |
|---|---|---|---|---|
| `markdown-editor.test.ts`, `T3 quote` | the quote command over two task items | `> \[ \] one` / (blank) / `> \[x\] two` | `> \[ \] one` / `>` / `> \[x\] two` | one quote for one run |
| same file, `X12 UL` / `X12 OL` | a list toggle over `# head`, `> quoted`, `para` | `- head` / `- quoted` / `- para` | `- head` / (blank) / `> - quoted` / (blank) / `- para` (`1.` the same) | a list toggle acts in the quote |
| same file, `X27 OL` | numbered toggle in `1. > qq` | `1. qq` | `1. > 1. qq` | the same |
| same file, `X30 UL` | bulleted toggle over `para`, `* > qq` | `* para` / `* qq` | `* para` / `* > - qq` | the same |
| same file, `X32 UL` | bulleted toggle in `+ > qq` | `- qq` / `- bb` | `+ > - qq` / (blank) / `- bb` | the same |
| same file, `M11 UL` / `M11 OL` | a list toggle in an item's quote | `- quoted` / `1. quoted` out of the list | `  > - quoted` / `  > 1. quoted` in the item | the same |
| same file, `H21 code` | `setBlockType("code")` in `> \- alpha` | the code replaces the quote | the code stands in the quote | a block type acts in place |
| same file, `E29 UL` | bulleted toggle in `> [ ] aa` | `- \[ \] aa` | `> - \[ \] aa` | a list toggle acts in the quote |
| same file, `Q1 UL` / `Q1 OL` | a list toggle in `> - one` / `> - two` | the WYSIWYG surface writes the raw text escaped; source mode does nothing | both surfaces: `> one` / `>` / `> - two`; `> 1. one` / `>` / `> - two` | the quote is modelled; the rows move to the parity table and are renamed *in a quote's list the toggle acts in the quote* |
| same file, `Q2 UL` / `Q2 OL` | the same in `> - [ ] one` / `> - [x] two` | the same | both surfaces: `> \[ \] one` / `>` / `> - [x] two`; `> 1. [ ] one` / `>` / `> - [x] two` | the same |
| same file, `R1` | bold on `a` in `- a` / (blank) / tab `>` tab `# h` | `- **a**` / (blank) / `    >`+tab+`# h` | `- **a**` / (blank) / `  > # h` | the quote is a node; a block holding a tab is written in the standard form once edited |
| same file, `R2` | bold on `a` in `- a` / (blank) / `  > > q` / `  > >`+tab+`r **b**` | the last line keeps its tab | `- **a**` / (blank) / `  > > q` / `  > > r **b**` | the same |
| same file, *a paragraph from a quote does not join the list item above* | `setBlockType("paragraph")` in `> b` under `- a` | `- a` / (blank) / `b` | the row runs `setBlockType("quote")`, with the same result | "paragraph" no longer removes a quote |
| same file, *a quote from a heading escapes the fence its text would open* | the quote command on `###### ~~~ x` | `> \~~~ x` | `> ###### ~~~ x`, the row renamed *a quote around a heading keeps the heading* | the quote command wraps |
| same file, *availability … `setBlockType("quote")` in a blockquote changes nothing* | the quote command in `> quoted` | nothing changes | the row leaves the "changes nothing" table; a new row pins `quoted` and one undo step | the toggle |
| same file, *Alt+Enter … inside a blockquote* | Enter in a quote | a paragraph after the quote | a second paragraph in the quote | Enter splits the paragraph |
| `markdown-editor-table-commands.test.ts`, `T1`, `T2`, `T3`, `T14` | `insertTable` at the end, start, middle of a quote, and in a column's quote | the table after, before, between two quotes | the table in the quote | a table goes into the quote |
| `markdown-editor-list-item-edits.test.ts`, `K17` | blocks a host puts into a quote | they leave the quote | they stay in the quote | a quote holds blocks |
| same file, `U13` | a quote over a range from a nested item's quote to the outer item's headings | `> g` / (blank) / `> h` | `> ## g` / `>` / `> ## h` | the quote command wraps |
| same file, `CI83` | Backspace over `ab`@0 to `pq`@2 from `> ab` into a later item | `rr` / (blank) / `- z` | `>` / (blank) / `rr` / (blank) / `- z` | the block the range starts in stays, emptied, as an item's does |
| `markdown-editor-list-item-paste.test.ts`, `P9` | a quote and a paragraph pasted at a nested item's text | `- bq` | `- b` / (blank) / `  > q` | a pasted quote stays a quote |
| same file, *a copied list … into a quote* | a list pasted into a quote's paragraph | the list after the quote | the list in the quote | the paste handler |
| same file, `Y3` | paragraphs pasted into an item's quote | `> cP1` / (blank) / `  P2d` | `  > cP1` / `  >` / `  > P2d` | the same |
| `markdown-reference-links.test.ts`, `DEF6` | a definition held in a quote removed | the quote goes | `>` remains | an emptied quote stays, as an emptied item does |
| `markdown-editor-command-crashes.test.ts`, `TK5` | a range from bold text ending in punctuation to bold text, deleted | `> a \*\*Note:\*\***d** ef` | `> a **Note:d** ef` | the join of two rich paragraphs, not of a raw block's text |
| `markdown-editor-command-crashes.test.ts`, `TK7`, the stepped part | Delete over `- w`@2 to `ab cd`@5 in `> \- w` / `>` / `> q2` / (blank) / `ab cd`, then Enter | `-` (a list item at the top level) | `> -` (an empty item of a list in the quote) | the Enter shortcut applies inside the quote |
| `markdown-source-mode-through-model.test.ts`, `5.24` | a list toggle in `> - one` | nothing | `> one` / `>` / `> - two` (`1.` the same) | the quote is modelled; the row leaves the declines table |


### Known issues

The owner's list of known Markdown issues
(`scratch-keep/known-issues-2026-10.md`) has five entries about quotes. Each
was run on the base and on the prototype (`c11.json`, `c15b.json`,
`c15p.json`, `zz-ki-places.test.ts` and their outputs in the prototype's
folder). This plan fixes one, fixes another for quotes only, changes one, and
leaves two as they are; it adds no work for the others.

| Entry | Base | After | Verdict |
|---|---|---|---|
| Select from just after a raw quote's `>` to before a single space and type: the words are glued. `> q1` / `>` / `> q2` / (blank) / `end. Next`, `x` typed from after the first `>` to before ` Next` | `> xNext` | `> x Next` | fixed: the quote is a node, and typing over a range into a paragraph keeps the space |
| A `<` left open at a join and closed by `/>` later in the rest makes an HTML tag. `> a <br w` / `>` / `> q2` / (blank) / `ab/>cd`, Delete from after `w` to after `ab` | `> a <br w/>cd`, an HTML tag | `> a \<br w/>cd`, text | fixed for a quote, which joins as two paragraphs join; the entry stays for every other raw block |
| A raw block in a list item that holds a prefix tab is saved at the item's column after an unrelated edit. `- a` / (blank) / tab `>` tab `# h`, bold on `a` | `- **a**` / (blank) / `    >`+tab+`# h` | `- **a**` / (blank) / `  > # h` | changed: the quote is a node holding a heading, and a block holding a tab is written in the standard form once its item is edited (row `R1` of *Results that change*); it reads the same |
| Hard break, or soft line end, in a quote inside a list item, or in a top-level quote whose later line indents its `>`: most offsets in the next line's prefix place the caret after the break (`- > a\` / `  > ¦ cd` gives `[a⏎¦cd]`) | as the entry says | the same places, one bracket level deeper (`[[[[a⏎¦cd]]]]`) | unchanged: the places come from the source-place code, which this plan does not touch |
| Delete over a raw nested list item to a later paragraph turns the item above into a heading (`- a` / `  - b` / `    > q` / `  - c` / (blank) / `after`, Delete from `  - b`@4 to the end of `after`) | `- ## a` | `- ## a` | unchanged: the quote stands tight under an item's text, so the list stays a raw block (*What a quote holds when it loads*) |

The other entries are about source mode's grammar, tabs, character
references or lists, and do not involve how a quote is held.

---

## Public API

No exported symbol, option or event changes. `MarkdownQuoteNode` and its
functions are internal, as `MarkdownListItemNode` is, and are not re-exported
from `component/editor/index.ts`.

`MarkdownEditor.setBlockType(type: MarkdownBlockType): this` keeps its
signature. With `"quote"` it toggles (*The quote command toggles*); with any
other type it acts on blocks of text in place, a block in a quote included.
Its JSDoc is rewritten (step 12), and so is the `toggleUnorderedList` /
`toggleOrderedList` JSDoc: "at the top level (or in its `:::` column)" becomes
"where the block stands: at the top level, in its `:::` column or in its
quote".

---

## Internal Structure

Write full JSDoc on every new symbol, as the code conventions ask; the
comments below are shortened. The prototype's code is a reference, not a
patch (*Critical Files*).

### `markdownQuoteNode.ts`

```ts
import { QuoteNode } from "@lexical/rich-text";
import { $copyNode } from "lexical";
import type { ElementNode, LexicalNode, SerializedElementNode } from "lexical";

export class MarkdownQuoteNode extends QuoteNode {
    static getType(): string;                        // "markdown-quote"
    static clone(node: MarkdownQuoteNode): MarkdownQuoteNode;   // new MarkdownQuoteNode(node.__key)
    static importJSON(json: SerializedElementNode): MarkdownQuoteNode;   // new MarkdownQuoteNode().updateFromJSON(json)

    isShadowRoot(): boolean;                         // false
    collapseAtStart(): true;                         // see below
}

export function $createMarkdownQuoteNode(): MarkdownQuoteNode;   // new MarkdownQuoteNode()
export function $isMarkdownQuoteNode(node: LexicalNode | null | undefined): node is MarkdownQuoteNode;
export function $nearestQuoteOf(node: LexicalNode): MarkdownQuoteNode | null;
export function $liftOutOfQuote(first: LexicalNode, last: LexicalNode): LexicalNode[];
```

`QuoteNode.collapseAtStart` is typed `(): true`, so the override keeps that
type.

```ts
    /** Lexical calls this for a deletion at the start of the document; the Backspace key reaches it through $backspaceLiftsOutOfQuote. */
    collapseAtStart(): true {
        const first = this.getFirstChild();

        if (first !== null) {
            $liftOutOfQuote(first, first);
        }

        return true;
    }
```

```ts
/** The closest quote among a node's ancestors, or null. */
export function $nearestQuoteOf(node: LexicalNode): MarkdownQuoteNode | null {
    for (let current = node.getParent(); current !== null; current = current.getParent()) {
        if ($isMarkdownQuoteNode(current)) {
            return current;
        }
    }

    return null;
}

/**
 * Takes the run of a quote's children from `first` to `last` out of the quote, one level out: the run goes where
 * the quote stands, the children before it stay in the quote, the children after it go to a copy of the quote after
 * the run, and a quote left empty goes. Callers settle the selection into blocks of text first; the run's text points
 * move with their nodes.
 *
 * @returns The run, in order.
 */
export function $liftOutOfQuote(first: LexicalNode, last: LexicalNode): LexicalNode[] {
    const quote = first.getParentOrThrow<ElementNode>();
    const run: LexicalNode[] = [];

    for (let node: LexicalNode | null = first; node !== null; node = node.getNextSibling()) {
        run.push(node);

        if (node.is(last)) {
            break;
        }
    }

    const after = last.getNextSiblings();

    if (after.length > 0) {
        const rest = $copyNode(quote);

        quote.insertAfter(rest);
        rest.splice(0, 0, after);
    }

    quote.getParentOrThrow().splice(quote.getIndexWithinParent() + 1, 0, run);

    if (quote.isEmpty()) {
        quote.remove();
    }

    return run;
}
```

### `markdownImporter.ts`

`$buildBlock`'s `"blockquote"` case becomes
`return $buildQuote(token as Tokens.Blockquote, source);`.

```ts
/** A quote line's first marker as `marked` takes it off: up to three spaces, `>`, one space or tab. Mirrors `marked`'s `blockquoteSetextReplace2`. */
const QUOTE_LINE_MARKER = /^ {0,3}>[ \t]?/gm;

/** A line whose first character after its blanks is `>`; any other line of a quote is a lazy line. */
const OPENS_WITH_QUOTE_MARKER = /^[ \t]*>/;

function $buildQuote(token: Tokens.Blockquote, source: string): LexicalNode {
    const lines = withoutTrailingNewlines(token.raw).split("\n");
    const text = quoteText(token, lines);
    const located = locateBlocks(text, token.tokens);
    const keepsRaw = !locatesEveryBlock(located, token.tokens) || holdsLazyLineOutsideParagraph(lines, text, located);

    if (keepsRaw) {
        return $buildRawBlock(source);
    }

    const quote = $createMarkdownQuoteNode();
    const blocks = located.map($buildLocatedBlock);

    recordQuoteBlocks(quote.getKey(), lines, text, located, blocks);
    quote.append(...(blocks.length > 0 ? blocks : [$createParagraphNode()]));

    return quote;
}
```

- `quoteText(token, lines)`: `token.text` when `token.raw` holds a tab, else
  `lines.join("\n").replace(QUOTE_LINE_MARKER, "")`.
- `locatesEveryBlock(located, tokens)`: `true` when the located entries that
  are tokens other than `def` are as many as the tokens of `tokens` other
  than `space` and `def`, and every gap entry holds definitions alone
  (`holdsOnlyDefinitions`, [:842](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L842)).
  A run of definitions is joined into one gap (`joinDefinitionRuns`), so
  `def` tokens are not counted.
- `holdsLazyLineOutsideParagraph(lines, text, located)`: for each line of
  `lines` that `OPENS_WITH_QUOTE_MARKER` does not match, finds the located
  entry whose `[start, end]` holds that line's start in `text` (lines map one
  to one); `true` when that entry is a gap, or a token neither `paragraph`
  nor `blockquote`.
- `recordQuoteBlocks(quote, lines, text, located, blocks)`: returns at once
  when `IMPORT_PARTS.current` is `null`, `located` is empty, a line of
  `lines` does not match `OPENS_WITH_QUOTE_MARKER`, or `lines` holds a tab.
  Otherwise it records one `quoteBlock` part per block, as
  `recordColumnBlocks`
  ([:1703](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L1703))
  records a column's, with a `ColumnLoad` of `{ prefix: text.slice(0,
  located[0].start), endsWithNewline: false, blockCount: located.length,
  endsOpen: endsOpen(text, located) }` and, beside `body` and `after` (slices
  of `text`), the same stretches as written: `quotedBody` is the source lines
  from the block's first line to its last, `quotedAfter` the source lines
  after its last line up to the next block's first line (or the quote's end),
  and `quotedPrefix` the source lines before the first block. Each is
  `lines.slice(…).join("\n")`, the line of an offset being
  `text.slice(0, offset).split("\n").length - 1`.

`RecordedPart` ([:159](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L159))
gains the variant
`{ kind: "quoteBlock"; node; quote: NodeKey; columnLoad: ColumnLoad; index; body; after; quotedBody; quotedAfter; quotedPrefix }`.
`$recordedParts` ([:554](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L554))
collects these as it collects column blocks and stores
`parts.set(quoteBlockKey(key), { kind: "quoteBlock", quote, block, quotedBody, quotedAfter, quotedPrefix })`,
`block` built exactly as a column block's `MarkdownSourceBlock` is.
`$placeOfRecordedPart` reads a quote block's fingerprint from
`record.blockFingerprints`, as a column block's; `completedPart` takes neither.
`differsFromStandard` needs no case: its default already says a column block
differs, and a quote block falls under it.

### `markdownSourceMap.ts`

```ts
/** A block of a loaded quote. */
export interface MarkdownSourceQuoteBlock {
    readonly kind:         "quoteBlock";
    /** The quote it stood in. */
    readonly quote:        NodeKey;
    /** Its source without the quote's markers, as a top-level block's; its `load` is its quote's. */
    readonly block:        MarkdownSourceBlock;
    /** Its lines as written, markers kept. */
    readonly quotedBody:   string;
    /** The lines between it and the next block, or the quote's end, as written. */
    readonly quotedAfter:  string;
    /** The quote's lines before its first block, as written; read for the first block only. */
    readonly quotedPrefix: string;
}

/** The key a block of a quote is stored under in MarkdownSourceMap.parts. */
export function quoteBlockKey(node: NodeKey): NodeKey;   // `quote-block:${node}`
```

`MarkdownSourcePart` gains `| MarkdownSourceQuoteBlock`; the `parts` JSDoc
names quote blocks beside column blocks.

### `markdownSerializer.ts`

```ts
function serializeQuote(node: QuoteNode, definitions: Links | null): string {
    const context = SAVE_PARTS.current;
    const written = context?.mode === "write" ? writtenQuote(node, definitions, context) : null;

    return written ?? quotedLines(serializeBlockList(node.getChildren(), definitions));
}

/** Writes inner Markdown under the quote's marker: `> ` before a line that holds something, `>` alone otherwise; `>` for nothing. */
function quotedLines(content: string): string {
    return content === "" ? ">" : content.split("\n").map((line) => (line === "" ? ">" : `> ${line}`)).join("\n");
}
```

`writtenQuote(node, definitions, context): string | null` follows
`writtenColumn`: it gathers, for each child, the part
`context.parts.get(quoteBlockKey(child.getKey()))` whose `quote` is the
node's key, and returns `null` when there is none. Otherwise it runs
`blockListParts(children, definitions, map, context.column)` and
`writtenBlocks(parts, map, SAVE_DEFINITIONS.current!)` on the map those parts
make, under `withPartsContext(context, …)`, and assembles the lines:

| Piece | Written as |
|---|---|
| before the first block, when it is written as its source and was the quote's first | its part's `quotedPrefix` lines |
| a block written as its source | its part's `quotedBody` lines; a line end `writtenBlocks` adds after it (`takesInBlockAfter`) as `>` |
| a block written anew | `quotedLines(block.text)` |
| between two blocks written as source that followed each other at load | the earlier one's `quotedAfter` lines |
| between any other two | the lines of `separatorBefore(written, index)` between the two blocks, under the marker (`>` for the blank line) |
| after the last block, when it is written as its source and was the quote's last | its part's `quotedAfter` lines |
| no block written | `>` |

`$holdsParts` adds `$isQuoteNode(node)`, `rawBlockTexts` adds
`$isQuoteNode(node)` to `holdsBlocks`, and `inlineRuns` drops `$isQuoteNode`.

### `markdownWritable.ts`

```ts
/** Keeps a quote holding blocks only, at least one (the normal form). */
function $keepQuoteShape(quote: MarkdownQuoteNode): void {
    if (!quote.isAttached()) {
        return;
    }

    $wrapInlineRuns(quote);

    if (quote.getChildrenSize() === 0) {
        quote.append($createParagraphNode());
    }
}
```

`$wrapInlineRuns`'s parameter becomes `container: ElementNode` (a list item
or a quote); its body is unchanged. `registerRawBlockRules` also registers
`editor.registerNodeTransform(MarkdownQuoteNode, $showRawBlocksAsWritten)`,
beside the `ListItemNode` line
([:1098](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1098)).

### `MarkdownEditor.ts`

```ts
/** INSERT_PARAGRAPH_COMMAND listener: Enter on an empty or blank paragraph of a quote takes it out, one level. */
function $enterLeavesQuoteAtBlankParagraph(): boolean {
    const selection = $getSelection();

    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        return false;
    }

    const block = $findEnclosingBlock(selection.anchor.getNode());
    const quote = block?.getParent() ?? null;
    // Write the negative guard first: TypeScript narrows `$isParagraphNode(x) && !$isMarkdownListItemTextNode(x)` to never.
    const isPlainParagraph = !$isMarkdownListItemTextNode(block) && $isParagraphNode(block);

    if (!isPlainParagraph || !$isMarkdownQuoteNode(quote)) {
        return false;
    }

    // Blank text counts as none, as in the list rule.
    const isBlank = block.getChildren().every((child) => $isTextNode(child) && child.getTextContent().trim() === "");

    if (!isBlank) {
        return false;
    }

    $liftOutOfQuote(block, block);
    block.selectStart();

    return true;
}

/** KEY_BACKSPACE_COMMAND listener: at the start of a quote's first block, nearer than any list item, that block leaves the quote. */
function $backspaceLiftsOutOfQuote(event: KeyboardEvent | null): boolean {
    const selection = $getSelection();

    if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.offset !== 0) {
        return false;
    }

    // The walk registerList's own listener makes, stopped at the first quote or list item.
    let current: LexicalNode = selection.anchor.getNode();

    while (!$isMarkdownQuoteNode(current) && !$isListItemNode(current)) {
        const parent = current.getParent();

        if (current.getPreviousSibling() !== null || parent === null || $isRootOrShadowRoot(parent)) {
            return false;
        }

        current = parent;
    }

    if (!$isMarkdownQuoteNode(current)) {
        return false;
    }

    current.collapseAtStart();
    event?.preventDefault();

    return true;
}

/** Registers the two rules for what Lexical's own handlers decide: Enter on a blank paragraph and the Backspace key at a quote's start. */
function registerQuoteRules(editor: LexicalEditor): () => void {
    return mergeRegister(
        editor.registerCommand(INSERT_PARAGRAPH_COMMAND, $enterLeavesQuoteAtBlankParagraph, COMMAND_PRIORITY_HIGH),
        // Ahead of registerList's listener (COMMAND_PRIORITY_BEFORE_EDITOR), which would walk past the quote to an item around it.
        editor.registerCommand(KEY_BACKSPACE_COMMAND, $backspaceLiftsOutOfQuote, COMMAND_PRIORITY_LOW),
    );
}
```

`registerEditorRules` calls `registerQuoteRules(editor)` on the line after
`registerListItemRules(editor)`
([:10036](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L10036)).

The block shortcuts in held blocks
(*Block typing shortcuts work in a quote and in a list item's further
blocks*):

```ts
/** The block shortcuts of SHORTCUT_TRANSFORMERS, run on held blocks by $runHeldBlockShortcut. */
const ELEMENT_SHORTCUTS = SHORTCUT_TRANSFORMERS.filter((shortcut): shortcut is ElementTransformer => shortcut.type === "element");
const MULTILINE_SHORTCUTS = SHORTCUT_TRANSFORMERS.filter((shortcut): shortcut is MultilineElementTransformer => shortcut.type === "multiline-element");

/**
 * Applies the block shortcut whose marker the text before the caret is, in a paragraph or heading a quote or a list
 * item holds ($isHeldBlockTakingText): Lexical's runMultilineElementTransformers and runElementTransformers with the
 * parent check replaced.
 *
 * @returns Whether a shortcut was applied.
 */
function $runHeldBlockShortcut(block: ElementNode, anchor: TextNode, offset: number, onEnter: boolean): boolean;

/** Registers $runHeldBlockShortcut on the two paths Lexical's registerMarkdownShortcuts uses. */
function registerHeldBlockShortcuts(editor: LexicalEditor): () => void;
```

- `$runHeldBlockShortcut` returns `false` unless `$isHeldBlockTakingText(block)`
  and `anchor` is the block's first child. Off Enter, the character before
  `offset` must be a space. It then tries, in Lexical's order, the shortcuts
  of `ELEMENT_SHORTCUTS` (on Enter only those with `triggerOnEnter`), then
  those of `MULTILINE_SHORTCUTS` whose `regExpEnd` is absent or optional. A
  match counts when its length is `offset`, or `offset - 1` when the match
  does not end with a space and the call is not on Enter. On a match it
  splits `anchor` at `offset`, calls the shortcut's `replace(block, rest,
  match, false)` (multiline: `replace(block, rest, match, null, null,
  false)`), and removes the split-off marker unless `replace` returned
  `false`.
- `registerHeldBlockShortcuts` registers, on the proxied editor:
  - an update listener with the conditions of Lexical's
    ([LexicalMarkdown.dev.mjs:2036](../node_modules/@lexical/markdown/dist/LexicalMarkdown.dev.mjs#L2036)):
    no `COLLABORATION_TAG` or `HISTORIC_TAG`, not composing, a collapsed
    caret that moved (or a composition end), in a text node the update
    changed, at most one character further on. It then runs, in
    `editor.update`, `$runHeldBlockShortcut(anchor.getParent(), anchor,
    offset, false)` on a text node without the code format, and adds
    `HISTORY_PUSH_TAG` when that applied;
  - a `KEY_ENTER_COMMAND` listener at `COMMAND_PRIORITY_LOW`: no Shift, a
    collapsed caret at the end of a text node without the code format,
    `$runHeldBlockShortcut(…, true)`; when it applied it prevents the event's
    default and returns `true`.
- `registerMarkdownShortcutsOutsideRawBlocks` returns
  `mergeRegister(registerMarkdownShortcuts(guarded, SHORTCUT_TRANSFORMERS), registerHeldBlockShortcuts(guarded))`;
  its JSDoc says so. `ElementTransformer` and `MultilineElementTransformer`
  are imported as types from `@lexical/markdown`, `COLLABORATION_TAG` and
  `HISTORIC_TAG` from `lexical`.

`$toggleQuoteOfTouchedBlocks(selection: RangeSelection): void` follows the
rule of *The quote command toggles*:

1. `const blocks = $touchedBlocksLastFirst(selection)`;
   `isOff = blocks.length > 0 && blocks.every((block) => $nearestQuoteOf(block) !== null)`.
2. Off: for each block, the child of its nearest quote that holds it (walk up
   until the parent is the quote); keep per quote the first and the last
   such child in document order; call `$liftOutOfQuote(first, last)` per
   quote, the last quote in the document first.
3. On: for each block with no nearest quote, the target is the paragraph
   `$liftItemOut(item)[0]` when the block is a `MarkdownListItemTextNode`
   whose parent is a `MarkdownListItemNode`, else the block. Sort the
   targets in document order; group them into runs of siblings that stand
   side by side (each the next sibling of the one before); for each run,
   `above = run[0].getPreviousSibling()`,
   `below = run[run.length - 1].getNextSibling()`: append the run to `above`
   when it is a quote, else put it at the start of `below` when that is a
   quote, else put a new quote before the run and splice the run into it;
   when both are quotes, splice `below`'s children after the run in `above`
   and remove `below`.

`setBlockType` ([:9135](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L9135))
takes the quote path after `commandApplies("canSetBlockType")`: in one
discrete update, `$settleEndsIntoBlocksOfText(selection)` and then
`$toggleQuoteOfTouchedBlocks(selection)`, without the `$selectedBlocksHaveType`
check. `createBlockNode` takes `Exclude<MarkdownBlockType, "quote">`.

`$insertTableAt` ([:5449](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5449))
calls `$insertBlockToNearestHolderAtCaret(table, $caretFromPoint(point, "next"))`
in place of `$insertNodeToNearestRootAtCaret`. The new function calls
`$insertNodeToNearestRootAtCaret(node, caret, { $shouldSplit: $makesNoEmptyHalf })`
when the caret's node has no nearest quote, or a shadow root (a column or a
cell) stands between the node and that quote. Otherwise it does what
`$insertNodeToNearestRootAtCaret` does
([Lexical.dev.mjs:19827](../node_modules/lexical/dist/Lexical.dev.mjs#L19827)),
with its loop of `$splitAtPointCaretNext(caret, { $shouldSplit: $makesNoEmptyHalf })`
stopped once the caret's parent is the quote: the same boundary
normalisation of a text point caret first, then `insertCaret.insert(node)`.
`$splitAtPointCaretNext`, `$getCaretInDirection`, `$isTextPointCaret`,
`$getSiblingCaret` and `$isChildCaret` are imported from `lexical`.

---

## Ordered Implementation Steps

Run commands from `packages/lib` unless a step says "repo root". Do not run
`npm install`. Run one Vitest process at a time, with `--maxWorkers=2` for a
large run (the full suite times out in unrelated files on a loaded machine).
Work test-first inside each step.

**Step 1 — the node module, unused**

1. Create `markdownQuoteNode.ts` with the SPDX line the sibling files start
   with and everything under *Internal Structure*, `markdownQuoteNode.ts`.
   Nothing imports it yet. Check: `npm run typecheck` (repo root).

**Step 2 — the switch: registration, load, save, normal form**

This step cannot be cut into green halves: once the class is registered, its
type name is in every shape string, and the importer, the serializer and the
rules must all read the new shape.[^one-step]

2. Tests first. Create `tests/component/markdown-quote-node.test.ts` with the
   node rows of *Expected Behaviour* (*Node-level rows*), in a bare editor
   (`createEditor({ nodes: [...EDITOR_NODES], onError })`), as
   `markdown-list-item-node.test.ts` does, and
   `tests/component/markdown-quote-node-html.test.ts` with the HTML rows,
   under the `@vitest-environment jsdom` pragma, as
   `markdown-list-item-node-html.test.ts` is. Create
   `tests/component/markdown-editor-quotes.test.ts` with its harness and the
   load-and-save rows. Apply *Tests that are restated* in full except the
   source-mode rows and *The command-crashes file*. Run
   `npx vitest run --maxWorkers=2 tests/component/markdown-*.test.ts tests/component/markdown-roundtrip`
   and keep the list of failing tests.
3. `editorNodes.ts`: in place of `QuoteNode` in `EDITOR_NODES`, put
   `MarkdownQuoteNode`, then
   `{ replace: QuoteNode, with: (): MarkdownQuoteNode => new MarkdownQuoteNode(), withKlass: MarkdownQuoteNode }`.
   Update its JSDoc.
4. `markdownImporter.ts`: `$buildQuote` and its helpers, `$buildBlock`'s case
   (part recording waits for step 14, which adds `recordQuoteBlocks`),
   delete `coversText`, update the `HELD_BLOCK_TYPES` comment.
5. `markdownSerializer.ts`: `serializeQuote` without the write-mode branch,
   `quotedLines`, `inlineRuns`, `rawBlockTexts`.
6. `markdownWritable.ts`: `$keepQuoteShape` and its registration, the
   `$wrapInlineRuns` parameter, the raw-block registration, and every removal
   of *A quote is no block of text any more* in this file; drop the imports of
   `$createQuoteNode`, `$isQuoteNode` and `QuoteNode` that this leaves unused.
7. `tests/component/markdown-roundtrip/viewModel.ts`: `editorBlock`'s quote
   branch returns `{ kind: 'quote', blocks: editorBlocks(node.getChildren()) }`.
8. `tests/component/markdown-roundtrip/corpus/`: remove
   `known: { surface: 'quoteBlocks' }` from the 69 cases listed in
   *Addendum: Corpus cases*, keep it on the 12 others, and reword
   `quoteBlocks`'s reason in `divergences.ts` (the addendum's text).
9. Run step 2's command. The failures left are the editing, quote command,
   paste and table rows, and the restated rows of *Results that change* that
   come from them.

**Step 3 — editing**

10. `MarkdownEditor.ts`: the container walks of *Every walk over containers
    treats a quote like a list item*; `$isJoinableBlock`; rename
    `$isItemBlockTakingText` to `$isHeldBlockTakingText`,
    `$pasteBlocksIntoItemBlock` to `$pasteBlocksIntoHeldBlock` and
    `registerItemBlockPaste` to `registerHeldBlockPaste` (with every
    `{@link}` to them), and widen the first as the table says;
    `$enterLeavesQuoteAtBlankParagraph`, `$backspaceLiftsOutOfQuote`,
    `registerQuoteRules` and its call; `$insertBlockToNearestHolderAtCaret`
    and `$insertTableAt`; `$runHeldBlockShortcut`,
    `registerHeldBlockShortcuts` and the new return of
    `registerMarkdownShortcutsOutsideRawBlocks`.
11. Add the editing, paste and table rows of *Expected Behaviour*, and the
    typing shortcut rows to `tests/component/markdown-editor-typing-shortcuts.test.ts`;
    run step 2's command and that file.

**Step 4 — the quote command**

12. `$toggleQuoteOfTouchedBlocks`, the quote path of `setBlockType`,
    `createBlockNode`; the JSDoc of `setBlockType`, `toggleUnorderedList`,
    `toggleOrderedList` and `insertTable` (see *Public API*).
13. Add the quote command rows; run step 2's command.

**Step 5 — parts**

14. `markdownSourceMap.ts`; then `recordQuoteBlocks` and the `quoteBlock`
    handling of `RecordedPart`, `$recordedParts` and `$placeOfRecordedPart` in
    the importer; then `writtenQuote`, the write-mode branch of
    `serializeQuote` and `$holdsParts` in the serializer, as *Internal
    Structure* says. Add the preservation rows to
    `tests/component/markdown-editor-nested-source-preservation.test.ts` and
    the quote edits to the nested-edit fuzz (*Expected Behaviour*, *The
    nested-edit fuzz*). Run step 2's command.

**Step 6 — source mode and the command-crashes file**

15. `markdown-source-mode-through-model.test.ts`: row 5.24 leaves the declines
    table for the pass table with its new results; add the source-mode rows;
    add `writesPrefixTabLine` to the differential's caret check
    (*Expected Behaviour*, *Source mode*).
16. `markdown-editor-command-crashes.test.ts`: apply *The command-crashes
    file*. Run the file: 838 tests, all green on the prototype.
17. Checkpoints:
    - `grep -rn 'coversText\|ItemBlockTakingText\|pasteBlocksIntoItemBlock\|registerItemBlockPaste' src/` — no match.
    - `grep -n 'QuoteNode' src/typescript/lib/component/editor/markdownWritable.ts` — only `MarkdownQuoteNode`.
    - `grep -n '\$isQuoteNode' src/typescript/lib/component/editor/markdownSerializer.ts` — `serializeBlock`, `$holdsParts` and `rawBlockTexts` only.

**Step 7 — docs and full checks**

18. *Documentation Impact*. Then, in the owner's known-issues list, remove the
    entry about glued words after a raw quote's `>`, and add "(fixed for
    quotes by markdown-editor-quote-node)" to the entry about a `<` left open
    at a join and "(a quote is now written `  > # h`, the standard form, by
    markdown-editor-quote-node)" to the entry about a raw block in a list item
    that holds a prefix tab (*Known issues*).
19. *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/editor/markdownQuoteNode.ts` |
| Create | `packages/lib/tests/component/markdown-quote-node.test.ts` |
| Create | `packages/lib/tests/component/markdown-editor-quotes.test.ts` |
| Create | `packages/lib/tests/component/markdown-quote-node-html.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorNodes.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownImporter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceMap.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/viewModel.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/divergences.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/commonmark.ts`, `dialect.ts`, `enterInCode.ts`, `enterInsideHtml.ts`, `referenceLinks.ts`, `tabs.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-nested-edit-fuzz.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-command-crashes.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-typing-shortcuts.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-places.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-mode-through-model.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-list-item-edits.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-list-item-paste.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-table-commands.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-nested-source-preservation.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-reload-differences.test.ts` |
| Modify | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-reference-links.test.ts` |
| Modify | `packages/lib/tests/component/markdown-serializer.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |
| Modify (outside the repository) | `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/known-issues-2026-10.md` (step 18) |

---

## Expected Behaviour

Every row is testable offline unless it stands under *Manual (browser)
checks*. `/` separates lines of a source or a save; `x@n` is offset `n` in
the text node whose text is exactly `x`. `Backspace` and `Delete` are
`DELETE_CHARACTER_COMMAND`, `Backspace key` is `KEY_BACKSPACE_COMMAND`, as in
`markdown-editor-list-item-edits.test.ts`. Every row with steps in
`markdown-editor-quotes.test.ts` runs that file's `expectSaveKeepsDocument`
after the load and after each step — reload, idempotence, viewer parity, the
standard form — whose harness (`lexicalOf`, `load`, `$textNode`,
`selectText`, `selectCharacterAtCaret`, `press`, `shapeOf`,
`expectSaveKeepsDocument`, `runRow`) is copied from
`markdown-editor-list-item-edits.test.ts`, with `TEXT_ONLY_BLOCKS` holding no
quote, and whose paste helpers (`copySelection`, `pasteNodes`) are copied from
`markdown-editor-list-item-paste.test.ts`. The rows' names are their first
column.

### Load and save (`markdown-editor-quotes.test.ts`)

| Row | Source | `shape` | `saved`, standard form (`canonicalSave`) |
|---|---|---|---|
| a quote of two paragraphs | `> a` / `>` / `> b` | `markdown-quote(paragraph("a"), paragraph("b"))` | the source; the same |
| a heading and a paragraph with a lazy line | `> # Foo` / `> bar` / `baz` | `markdown-quote(heading("Foo"), paragraph("bar", " ", "baz"))` | the source; `> # Foo` / `>` / `> bar` / `> baz` |
| a list | `> - one` / `> - two` | `markdown-quote(list(markdown-list-item(markdown-list-item-text("one")), markdown-list-item(markdown-list-item-text("two"))))` | the source; the same |
| three levels and a lazy line | `> > > foo` / `bar` | `markdown-quote(markdown-quote(markdown-quote(paragraph("foo", " ", "bar"))))` | the source; `> > > foo` / `> > > bar` |
| a fence closed in a nested quote | `> > ```` ``` ```` / `> > a` / `> > ```` ``` ```` / `b` | `markdown-quote(markdown-quote(code("a"))) \| paragraph("b")` | the source; `> > ```` ``` ```` / `> > a` / `> > ```` ``` ```` / (blank) / `b` |
| an empty quote | `>` | `markdown-quote(paragraph())` | `>`; `>` |
| an HTML block | `> <div>` / `> x` / `> </div>` | `markdown-quote(markdown-raw-block("<div>", linebreak, "x", linebreak, "</div>"))` | the source; the same |
| a repeated definition | `[x]: /a` / (blank) / `> [x]: /b` | `markdown-raw-block(…) \| markdown-quote(markdown-raw-block("[x]: /b"))` | the source |
| a quote in a list item | `- a` / (blank) / `  > q` / `  >` / `  > r` / `- z` | `list(markdown-list-item(markdown-list-item-text("a"), markdown-quote(paragraph("q"), paragraph("r"))), markdown-list-item(markdown-list-item-text("z")))` | the source; `- a` / (blank) / `  > q` / `  >` / `  > r` / (blank) / `- z` |
| a tab after the marker | `>` + tab + `a` / `>` / `>` + tab + `b` | `markdown-quote(paragraph("a"), paragraph("b"))` | the source |
| a lazy line starting an HTML block stays raw | `p` / (blank) / `  > q` / `  <div` / (blank) / `z` | `paragraph("p") \| markdown-raw-block("> q", linebreak, "  <div") \| paragraph("z")` | the source; `p` / (blank) / `> q` / `  <div` / (blank) / `z` |
| a lazy line in a quote's list stays raw | `> - a` / `b` / (blank) / `after` | `markdown-raw-block("> - a", linebreak, "b") \| paragraph("after")` | the source |
| a tight quote under an item's text stays a raw list | `- a` / `  > q` / `- b` | `markdown-raw-block("- a", linebreak, "  > q", linebreak, "- b")` | the source |
| HTML in a quote reads as the viewer reads it | `<blockquote><p>a</p><p>b</p></blockquote>` as HTML (in `markdown-quote-node-html.test.ts`, under jsdom) | `markdown-quote(paragraph("a"), paragraph("b"))` | — |
| HTML with inline text | `<blockquote>plain <b>bold</b></blockquote>` | `markdown-quote(paragraph("plain ", "bold"))` | — |
| HTML with a list and a nested quote | `<blockquote><ul><li>x</li></ul><blockquote><p>n</p></blockquote></blockquote>` | `markdown-quote(list(markdown-list-item(markdown-list-item-text("x"))), markdown-quote(paragraph("n")))` | — |
| HTML exported | `> a` / `>` / `> - x` / `>` / `> > n`, `$generateHtmlFromNodes` | `<blockquote>` holding a `<p>`, a `<ul>` and a `<blockquote>` | — |

### Node-level rows (`markdown-quote-node.test.ts`)

`q(…)` is a quote, `p(x)` a paragraph holding `x`, built with `splice`.

| Row | Tree | Call | Result |
|---|---|---|---|
| lift the middle child | `q(p(a), p(b), p(c))` | `$liftOutOfQuote(b, b)` | `q(p(a))`, `p(b)`, `q(p(c))`; returns `[p(b)]` |
| lift the first child | `q(p(a), p(b))` | `$liftOutOfQuote(a, a)` | `p(a)`, `q(p(b))` |
| lift every child | `q(p(a), p(b))` | `$liftOutOfQuote(a, b)` | `p(a)`, `p(b)`; the quote is gone |
| lift a run out of a nested quote | `q(p(x), q(p(a), p(b)))` | `$liftOutOfQuote(a, b)` | `q(p(x), p(a), p(b))` |
| collapse at start | `q(p(a), p(b))` | `quote.collapseAtStart()` | `p(a)`, `q(p(b))`; returns `true` |
| nearest quote | `q(q(p(a)))` | `$nearestQuoteOf(a's text)` | the inner quote |
| the class | — | `$createQuoteNode()` in an editor holding `EDITOR_NODES` | an instance of `MarkdownQuoteNode`, `isShadowRoot()` `false` |
| JSON | `q(p(a))` | `$parseSerializedNode` of its `exportJSON` | type `markdown-quote` |

### Editing rows (`markdown-editor-quotes.test.ts`)

| Row | Source | Steps | `saved` |
|---|---|---|---|
| Enter in the middle of a paragraph | `> ab` | `Enter` at `ab`@1 | `> a` / `>` / `> b` |
| Enter twice at the end leaves the quote | `> a` | `Enter` at `a`@1; `Enter`; type `Z` | `> a` / (blank) / `Z` |
| Enter twice in the middle splits the quote | `> a` / `>` / `> b` | `Enter` at `a`@1; `Enter`; type `Z` | `> a` / (blank) / `Z` / (blank) / `> b` |
| Enter on a blank paragraph | `> a` | `Enter` at `a`@1; type two spaces; `Enter` | `> a` (the spaces' paragraph out of the quote, saving nothing) |
| Enter in an empty quote | `>` | caret at the document's start; `Enter`; type `Z` | `Z` |
| Enter twice in a nested quote goes one level | `> > a` | `Enter` at `a`@1; `Enter`; `Enter`; type `Z` | `> > a` / (blank) / `Z`; after the second step the shape is `markdown-quote(markdown-quote(paragraph("a")), paragraph())` |
| Enter in a quote's list | `> - a` | `Enter` at `a`@1; `Enter`; `Enter` | `> - a`; after the second step `markdown-quote(list(…), paragraph())` |
| Shift+Enter | `> ab` | `Shift+Enter` at `ab`@1 | `> a\` / `> b` |
| Enter in a quote's code | `> ```` ``` ```` / `> x` / `> ```` ``` ```` | `Enter` at `x`@1 | `> ```` ``` ```` / `> x` / `>` / `> ```` ``` ```` |
| Backspace key at the quote's start | `> a` / `>` / `> b` | `Backspace key` at `a`@0 | `a` / (blank) / `> b` |
| Backspace key at the start of a quote first in the document | `> a` | `Backspace key` at `a`@0 | `a` |
| Backspace key in an empty quote | `>` / (blank) / `x` | caret at the document's start; `Backspace key` | `x` |
| Backspace key at a later block's start | `> a` / `>` / `> b` | `Backspace key` at `b`@0 | `> ab` |
| Backspace key: the nearer container decides, a list item | `> - a` | `Backspace key` at `a`@0 | `> a` |
| Backspace key: the nearer container decides, a quote | `- > a` | `Backspace key` at `a`@0 | `- a` |
| Backspace joins into the block before | `x` / (blank) / `> a` | `Backspace` at `a`@0 | `xa` |
| Backspace after a quote joins into it | `> a` / (blank) / `y` | `Backspace` at `y`@0 | `> ay` |
| Delete at the end of a quote | `> a` / (blank) / `b` | `Delete` at `a`@1 | `> ab` |
| Delete before a list | `> a` / (blank) / `- b` | `Delete` at `a`@1 | `> ab` |
| Backspace in an empty block after the quote's last paragraph | `> a` | `Enter` at `a`@1; `Backspace key` | `> a`, the caret at `a`@1 |
| Backspace after a quote ending in a table | `> a` / `>` / `> \| h \|` / `> \| --- \|` / `> \| c \|` / (blank) / `y` | `Backspace` at `y`@0 | unchanged; the caret at `y`@0 |
| typing over a range out of the quote | `> ab` / (blank) / `cd` | type `Q` over `ab`@1 to `cd`@1 | `> aQd` |
| typing over a range from one quote into another | `> ab` / (blank) / `> cd` | type `Q` over `ab`@1 to `cd`@1 | `> aQd` |
| typing over a range into a quote | `ab` / (blank) / `> cd` / `>` / `> ef` | type `Q` over `ab`@1 to `cd`@1 | `aQd` / (blank) / `> ef` |
| a heading in a quote | `> a` / `>` / `> b` | `setBlockType('h2')` at `a`@1; `setBlockType('paragraph')` | `> ## a` / `>` / `> b`; `> a` / `>` / `> b` |
| code in a quote | `> a` / `>` / `> b` | `setBlockType('code')` at `a`@1 | `> ```` ``` ```` / `> a` / `> ```` ``` ```` / `>` / `> b` |
| a list toggled on and off in a quote | `> a` / `>` / `> b` | `toggleOrderedList()` over `a`@0 to `b`@1; `toggleOrderedList()` | `> 1. a` / `> 2. b`; `> a` / `>` / `> b` |
| a table in a quote | `> ab` | `insertTable(2, 2)` at `ab`@1 | `> a` / `>` / `> \|  \|  \|` / `> \| --- \| --- \|` / `> \|  \|  \|` / `>` / `> b` |
| a table in an item's quote | `- > ab` | `insertTable(2, 2)` at `ab`@1 | `- > a` / `  >` / `  > \|  \|  \|` / `  > \| --- \| --- \|` / `  > \|  \|  \|` / `  >` / `  > b` |
| a table in a column's quote | `::: columns` / `> ab` / `\|\|\|` / `c` / `:::` | `insertTable(2, 2)` at `ab`@1 | `::: columns` / `> a` / `>` / `> \|  \|  \|` / `> \| --- \| --- \|` / `> \|  \|  \|` / `>` / `> b` / `\|\|\|` / `c` / `:::` |
| read-only | `> a` | `setReadOnly(true)`; `Enter` at `a`@1 | `> a` |
| undo of Enter leaving the quote | `> a` | `Enter` at `a`@1; `Enter`; undo | `markdown-quote(paragraph("a"), paragraph())` after the undo |

### Quote command rows

All of the table under *The quote command toggles*, each as a row with the
`After` column as its `saved`, and these:

| Row | Source | Steps | `saved` |
|---|---|---|---|
| toggled twice | `a` | `setBlockType('quote')` at `a`@1, twice | `> a`; `a` |
| one undo step | `a` / (blank) / `b` | `setBlockType('quote')` over `a`@0 to `b`@1; undo | `a` / (blank) / `b` |
| joins the quote before | `> a` / (blank) / `b` | `setBlockType('quote')` at `b`@1, twice | `> a` / `>` / `> b`; `> a` / (blank) / `b` |
| joins the quote after | `a` / (blank) / `> b` | `setBlockType('quote')` at `a`@1 | `> a` / `>` / `> b` |
| two item texts | `- a` / `- b` | `setBlockType('quote')` over `a`@0 to `b`@1 | `> a` / `>` / `> b` |
| a range over two quotes | `> a` / (blank) / `> b` | `setBlockType('quote')` over `a`@0 to `b`@1 | `a` / (blank) / `b` |

### Typing shortcut rows (`markdown-editor-typing-shortcuts.test.ts`)

Two new row groups, run as `TY2` and `TY1` run their kinds: each source holds
the marker, the space after it and the file's `REMOVED` character before
`cd`; the row selects the space and that character, deletes them, and types
the space back.

`TY21: typing the character that completes a block shortcut in a block a
quote or a list item holds applies it as at the top level`, on every route of
`TYPING_ROUTES`; one undo gives the second column, a second the text before
the space, and two redos the first column again:

| Kind | Source | Applied | Undone once |
|---|---|---|---|
| a bullet in a quote | `> a` / `>` / `> \- ;cd` | `> a` / `>` / `> - cd` | `> a` / `>` / `> \- cd` |
| a bullet written with a star in a quote | `> a` / `>` / `> \* ;cd` | `> a` / `>` / `> - cd` | `> a` / `>` / `> \* cd` |
| a list number in a quote | `> a` / `>` / `> 3\. ;cd` | `> a` / `>` / `> 3. cd` | `> a` / `>` / `> 3\. cd` |
| a heading in a quote | `> a` / `>` / `> \## ;cd` | `> a` / `>` / `> ## cd` | `> a` / `>` / `> \## cd` |
| a quote in a quote | `> a` / `>` / `> \> ;cd` | `> a` / `>` / `> > cd` | `> a` / `>` / `> \> cd` |
| a code fence in a quote | `> a` / `>` / ``> \`\`\` ;cd`` | `> a` / `>` / ```` > ``` ```` / `> cd` / ```` > ``` ```` | `> a` / `>` / ``> \``` cd`` |
| a bullet in a nested quote | `> > a` / `> >` / `> > \- ;cd` | `> > a` / `> >` / `> > - cd` | `> > a` / `> >` / `> > \- cd` |
| a bullet in a quote in a column | `::: columns` / `> \- ;cd` / `\|\|\|` / `x` / `:::` | `::: columns` / `> - cd` / … | `::: columns` / `> \- cd` / … |
| a bullet in a list item's further paragraph | `- a` / (blank) / `  \- ;cd` | `- a` / (blank) / `  - cd` | `- a` / (blank) / `  \- cd` |
| a heading in a list item's further paragraph | `- a` / (blank) / `  \# ;cd` | `- a` / (blank) / `  # cd` | `- a` / (blank) / `  \# cd` |
| a quote in a list item's further paragraph | `- a` / (blank) / `  \> ;cd` | `- a` / (blank) / `  > cd` | `- a` / (blank) / `  \> cd` |
| a code fence in a list item's further paragraph | `- a` / (blank) / ``  \`\`\` ;cd`` | `- a` / (blank), then the opening fence, `cd` and the closing fence, each indented two spaces | `- a` / (blank) / ``  \``` cd`` |
| a list number in a quote in a list item | `- a` / (blank) / `  > 1\. ;cd` | `- a` / (blank) / `  > 1. cd` | `- a` / (blank) / `  > 1\. cd` |

`TY22: a removal that leaves the caret right behind a block shortcut in a
block a quote or a list item holds completes no shortcut`: the same sources,
only the `REMOVED` character selected, each removal of `REMOVALS`; the save
is the *Undone once* column.

And these, in `markdown-editor-quotes.test.ts`, each with the harness's
checks. A typed shortcut is applied in an update of its own, after the
update that typed the space, so read the editor twice before each save, as
the typing-shortcuts file's `settledValue` does:

| Row | Source | Steps | `saved`, and the caret |
|---|---|---|---|
| the caret after a shortcut in a quote | `> a` / `>` / `> b` | type `-`, ` ` at `b`@0 | `> a` / `>` / `> - b`; the caret at the start of the item's text |
| a shortcut joins the list after it | `> b` / `>` / `> - c` | type `-`, ` ` at `b`@0 | `> - b` / `> - c` |
| a code fence with a language, on Enter | `> a` | `Enter` at `a`@1; type ```` ```js ````; `Enter`; type `x` | `> a` / `>` / ```` > ```js ```` / `> x` / ```` > ``` ```` |
| a bullet marker in an empty paragraph | `> a` | `Enter` at `a`@1; type `-`, ` ` | `> a` / `>` / `> -`; the shape `markdown-quote(paragraph("a"), list(markdown-list-item(markdown-list-item-text())))` |
| no shortcut in an item's own text | `- a` | type `#`, ` ` at `a`@0 | `- \# a` |
| no list shortcut in a heading | `> # h` | type `-`, ` ` at `h`@0 | `> # - h` |
| no shortcut in the middle of text | `> ab` | type `-`, ` ` at `ab`@1 | `> a- b` |
| a bold paragraph keeps its format | `> a` / `>` / `> **b** c` | type `-`, ` ` at `b`@0 | `> a` / `>` / `> - **b** c` |

### Paste rows (`markdown-editor-quotes.test.ts`)

Clipboards are copied from a second editor, as in
`markdown-editor-list-item-paste.test.ts`. Each row also checks that one undo
restores the source.

| Row | Target | Clipboard | At | `saved` |
|---|---|---|---|---|
| paragraphs into a quote's paragraph | `> cd` | `P1` / (blank) / `P2`, all | `cd`@1 | `> cP1` / `>` / `> P2d` |
| a heading and a paragraph | `> cd` | `## H` / (blank) / `P2`, all | `cd`@1 | `> cH` / `>` / `> P2d` |
| a quote into a paragraph | `cd` | `> Q1` / `>` / `> Q2` / (blank) / `P2`, all | `cd`@1 | `c` / (blank) / `> Q1` / `>` / `> Q2` / (blank) / `P2d` |
| a quote into a quote's paragraph | `> cd` | the same | `cd`@1 | `> c` / `>` / `> > Q1` / `> >` / `> > Q2` / `>` / `> P2d` |
| paragraphs into an item's quote | `- x` / (blank) / `  > cd` / `- z` | `P1` / (blank) / `P2`, all | `cd`@1 | `- x` / (blank) / `  > cP1` / `  >` / `  > P2d` / (blank) / `- z` |
| plain text (control: the handler declines) | `> cd` | `P1 zz` from `P1 zz`@0 to `P1 zz`@2 | `cd`@1 | `> cP1d` |

### Preservation rows (`markdown-editor-nested-source-preservation.test.ts`, a new group *quote blocks*)

| Row | Source | Edit | `saved` |
|---|---|---|---|
| the markers of unedited blocks stay | `>first  _x_` / `>` / `>   second` / `> ` / `>third` | `!` appended to `second` | `>first  _x_` / `>` / `> second!` / `>` / `>third` |
| an edited first block | `> a` / `>` / `> * one` / `>     * inner` / `>` / `>  > nested *q*` + line end | `!` appended to `a` | `> a!` / `>` / `> * one` / `>     * inner` / `>` / `>  > nested *q*` + line end |
| a quote in an item, the item's neighbour edited | `- a` / (blank) / `  >b _c_` / `  >` / `  >d` / `- e` | `!` appended to `e` | `- a` / (blank) / `  >b _c_` / `  >` / `  >d` / (blank) / `- e!` |
| a nested quote edited | `> x _y_` / `>` / `> > p` / `> >` / `> > q` | `!` appended to `q` | `> x _y_` / `>` / `> > p` / `> >` / `> > q!` |
| Enter in a paragraph after a kept list | `>  * a` / `>  * b` / `>` / `> para` | `Enter` at `para`@2 | `>  * a` / `>  * b` / `>` / `> pa` / `>` / `> ra` |
| a block typed over | `> _a_` / `>` / `> b` / `>` / `> *c*` | `b` typed over with `X` | `> _a_` / `>` / `> X` / `>` / `> *c*` |
| an unclosed fence after an edited paragraph stays as written | `> a` / `>` / `>```` ``` ```` / `>  ` (a one-space code line) | `x` typed after `a` | `> ax` / `>` / `>```` ``` ```` / `>  ` |
| a tab in the quote: no part | `>` + tab + `a` / `>` / `>` + tab + `b` | `!` appended to `b` | `> a` / `>` / `> b!` |
| unedited | `>a` / `>` / `>b` | none | the source |

### The nested-edit fuzz

`tests/component/markdown-roundtrip/markdown-nested-edit-fuzz.test.ts` gains
two edit kinds and six documents:

- `insertQuoteBlock`: a paragraph holding the edit's word, put after a random
  child of a random quote; applies when the document holds a quote.
- `deleteQuoteBlock`: a random child removed from a random quote that holds
  more than one; applies when there is such a quote.
- `NESTED_SOURCES` gains `>a` / `>` / `>b _c_` / `>` / `>  * x` / `>  * y`;
  `> > p` / `> >` / `> > q` / `>` / `> r`; `- a` / (blank) / `  >q` / `  >` /
  `  >r` / `- b`; `::: columns` / `> l` / `>` / `> m` / `\|\|\|` / `n` / `:::`;
  `> ~~~` / `> code` / `> ~~~` / `>` / `> | a  | b |` / `> |----|---|` /
  `> | 1  | 2 |`; `>  1. one` / `>  2. two` / `>` / `>  text`.

`$isMarkdownQuoteNode` is imported from `markdownQuoteNode`. On the
prototype the file passes 1,226 cases at 8 sequences and the seed `0x5eed`,
and at 40 sequences and the seed `0x7a11`.

### Source mode (`markdown-source-mode-through-model.test.ts`)

| Row | Document | Selection | Command | Text |
|---|---|---|---|---|
| 5.24 (moved to the pass table) | `> - one` / `> - two` | 5 | bulleted; numbered | `> one` / `>` / `> - two`; `> 1. one` / `>` / `> - two` |
| a quote toggled off in source mode | `> a` / `>` / `> b` | 9 | `quote` | `> a` / (blank) / `b` |
| a heading in a quote in source mode | `> a` / `>` / `> b` | 2 | `h2` | `> ## a` / `>` / `> b` |

The differential's caret check (the `compared` branch) adds
`&& !writesPrefixTabLine(run.text, run.replaced)`, a function of the test
file: it takes the last replacement's start offset and inserted text, finds
the lines of `run.text` that text covers, and returns whether
`prefixTabLines` (already imported there) marks any of them. On the
prototype the differential then reports no difference.

### Tests that are restated

**Rules applied across files.** `quote` is the old type name; each rule is
mechanical.

| Where | Old | New |
|---|---|---|
| shape strings (`markdown-editor-list-item-edits.test.ts`, `markdown-editor-reload-differences.test.ts`, …) | `quote("x")` | `markdown-quote(paragraph("x"))` |
| node-type lists (`markdown-editor.test.ts`, `markdown-editor-table-commands.test.ts`, `markdown-importer.test.ts`, `markdown-reference-links.test.ts`, `markdown-editor-list-item-paste.test.ts`) | `'quote'` | `'markdown-quote'` |
| `markdown-editor-list-item-edits.test.ts`, `TEXT_ONLY_BLOCKS` | holds `'quote'` | no quote: a quote holds blocks |
| `markdown-source-places.test.ts`, every row whose source is a top-level quote | `'[a ¦b]'` | `'[[a ¦b]]'`: the quote's paragraph is one bracket level deeper |
| `markdown-source-places.test.ts`, `SP19` rows of a raw quote in a list item (`1. a` / (blank) / `   >`+tab+`# h`, `- a` / (blank) / `  > > q` / `  > >`+tab+`r **b**`) | the raw block's text | the quote node's places, as the prototype gives them (e.g. `[[[¦a][[h]]]]`, `[[[a][[[q{0§: }  r {1:b}]]]]]`) |
| the corpus | `known: { surface: 'quoteBlocks' }` on 81 cases | on the 12 cases of *Addendum: Corpus cases* only |

**Rows restated one by one**, beyond the rules and *Results that change*:

| File, row | Change |
|---|---|
| `markdown-importer.test.ts`, `I7: a blockquote holding two paragraphs is one raw block` | renamed *… is one quote of two paragraphs*; root types `['markdown-quote']` |
| same, `I7 (a dropped definition in a quote)` | renamed *… a quote holding one keeps it as a raw block of the quote*; root types `['markdown-raw-block', 'markdown-quote']`; the save is the source |
| same, `I18 (a dropped definition before the next block)` | the second block's text is `b` (the quote's list) |
| same, *a raw block holds one text node per line* | its source becomes `<div>` / `a` / `</div>`; the types stay `['text', 'linebreak', 'text', 'linebreak', 'text']` |
| same, `HE12` (a raw quote whose HTML block is cut to its tag name) | the quote stays a quote: root types `['markdown-quote']`, root texts `['<div']`, the save `> <div` before and after a reload |
| same, `HT4` (`> <div`) and `HT7`'s quote case (`> <div` / `foo`) | a quote: `['markdown-quote']`, its texts the HTML line and, for `HT7`, `foo` in a paragraph; the save is the source |
| same, `B6`, `B21` | `'quote'` → `'markdown-quote'` in the item's child types |
| `markdown-serializer.test.ts`, *a quote ending with a break* | the tree is a quote holding a paragraph holding `a` and the break: `[$createQuoteNode().append(fill($createParagraphNode(), ['a', br()]))]`; the save is `> a` |
| `markdown-editor-list-item-edits.test.ts`, `RT3` (a code line of one space in a quote) | its source becomes `> a` / `>` / `>```` ``` ```` / `>  `, its step types `x` at `a`@1, and its `saved` is `> ax` / `>` / `>```` ``` ```` / `>  ` |
| `markdown-editor-list-item-edits.test.ts`, `Q10` | `quote("q")` → `markdown-quote(paragraph("q"))` |
| `markdown-editor-command-crashes.test.ts`, `W1` (deleting the last line of a quote converted from a code block) | it runs `setBlockType('paragraph')` before `setBlockType('quote')`: the code's lines become a paragraph with line breaks, which the quote then holds; the save stays `> a` |

### The command-crashes file

`markdown-editor-command-crashes.test.ts` builds many of its raw-block rows on
a quote of two paragraphs (`> q1` / `>` / `> q2`), which is a quote node now.
The prototype's restated copy of the file passes (838 tests, from 1,137);
the diff is kept with the prototype (*Critical Files*). Apply it by these
rules.

1. **The 22 `TE` shapes on a raw quote keep their sources and become quote-node
   shapes.** Their `start` points name the quote's shown text, and their
   `typed` and `deleted` saves are the ones every route gives on the
   prototype (the `TE71` cut rows stay as they are):

   | Shape | `start` | `typed` | `deleted` |
   |---|---|---|---|
   | `TE45` | `['q1 w', 3]` | `> q1 xfter` | `> q1 fter` |
   | `TE46` | `['q2', 0]` | `> q1` / `>` / `> xafter b` / (blank) / `more` | `> q1` / `>` / `> after b` / (blank) / `more` |
   | `TE51` | `['q2', 0]` | `> q1` / `>` / `> x cd` / (blank) / `more` | `> q1` / `>` / `> cd` / (blank) / `more` |
   | `TE53` | `['q1', 0]` | `> x**Note** rest` / (blank) / `last` | `> **Note** rest` / (blank) / `last` |
   | `TE54` | `['q1', 0]` | `> x**old** y` / (blank) / `last` | `> **old** y` / (blank) / `last` |
   | `TE55` | `['q1', 0]` | `> x[link](/u) rest` / (blank) / `last` | `> [link](/u) rest` / (blank) / `last` |
   | `TE56` | `['q2', 0]` | `> q1` / `>` / ``> x`code` rest`` / (blank) / `last` | `> q1` / `>` / ``> `code` rest`` / (blank) / `last` |
   | `TE58` | `['b', 1]` | `> **bx**` | `> **b**` |
   | `TE59` | `['b', 1]` | `> **bx**\` / `> cd` | `> **b**\` / `> cd` |
   | `TE60` | `['q1', 0]` | `> x  Next` / (blank) / `more` | `> Next` / (blank) / `more` |
   | `TE61` | `['q2', 0]` | `> q1` / `>` / `> x  cd` / (blank) / `more` | `> q1` / `>` / `> cd` / (blank) / `more` |
   | `TE89` | `['q1', 0]` | `> x  Next` / (blank) / `more` | `> Next` / (blank) / `more` |
   | `TE66` | `['Note:', 5]` | `> a **Note:x** next` / (blank) / `last` | `> a **Note:** next` / (blank) / `last` |
   | `TE67` | `['word', 4]` | `> some *wordx* next` / (blank) / `last` | `> some *word* next` / (blank) / `last` |
   | `TE68` | `['s.', 2]` | `> a ~~s.x~~  next` / (blank) / `last` | `> a ~~s.~~  next` / (blank) / `last` |
   | `TE70` | `['q1 w', 3]` | `> q1 x **(b)** z` / (blank) / `last` | `> q1  **(b)** z` / (blank) / `last` |
   | `TE71` | `['Note:', 5]` | `> a **Note:x (b)** z` / (blank) / `last` | `> a **Note:** **(b)** z` / (blank) / `last` |
   | `TE72` | `['[k](/ab zz', 7]` | `> \[k\]\(/abxcd) tail` | `> \[k\]\(/abcd) tail` |
   | `TE73` | `['esc \\ w', 5]` (a backslash in the text) | `> esc \x*e` / (blank) / `last` | `> esc \\*e` / (blank) / `last` |
   | `TE74` | ``['a `co w', 5]`` | ``> a \`coxde\` x`` / (blank) / `last` | ``> a \`code\` x`` / (blank) / `last` |
   | `TE75` | `['q1 w', 3]` | `> q1 x [a \[b](/u) c` / (blank) / `last` | `> q1  [a \[b](/u) c` / (blank) / `last` |
   | `TE78` | `['a <b w', 4]` | `> a \<bx>cd` | `> a \<b>cd` |

2. **Rows about a raw quote's own text go**, since no raw block holds those
   lines now: the 18 raw-quote entries of `JOINTS` (the `TJ` rows; the joints
   of `TE7`, `TE42` to `TE44`, `TE47` to `TE49`, `TE57`, `TE69`, `TE76` and
   `TE77` stay), the caret rows `TP2` to `TP8` and `TP10`, `TL1`, and the
   join rows `K7` and `K10` to `K13`. The raw-list rows (`TE47`, `TE49`,
   `TE57`, `TP9`, `TL3` to `TL5`, `K14`, `K15`) keep the same rules covered
   on a raw block whose lines still open with a quote marker.
3. **`K16` and `K17` move to a raw list**: sources `- a <b` / `  c w` / `  > q`
   / (blank) / `ab>cd` and `- a <b` / `  c="d" w` / `  > q` / (blank) /
   `ab>cd`, starts `['  c w', 3]` and `['  c="d" w', 7]`, saves `- a \<b` /
   `  c>cd` and `- a \<b` / `  c="d">cd`.
4. **`TS16`, `TS17`, `TK1` to `TK8`** keep their subject on the quote node:
   `TS16` expects `> q1` / `>` / ``> `code` rest`` / (blank) / `last` (the
   tab at the start of the line is not saved); `TS17` expects `> q1` / `>` /
   `> cd` / (blank) / `more`; `TK1` to `TK4` start at `['a *x* w', 5]`,
   `['- w', 2]`, `['# w', 2]` and `['1. w', 3]`, `TK6` selects
   `['a *x*.', 5]` to `['q2', 0]`, `TK7` starts at `['- w', 2]` and `TK8` at
   `['a *x* w', 5]`, and all keep their saves; `TK5` starts at
   `['Note:', 5]` and saves `> a **Note:d** ef`; `TK7` expects the root
   children `['markdown-quote:- \n\n']`, and its stepped part ends `> -`
   where it ended `-`: Enter after Delete applies the bullet shortcut inside
   the quote (`registerHeldBlockShortcuts`), which makes an empty item of a
   list in the quote, as Lexical's own Enter shortcut makes one at the top
   level. Update its comment to say so.

### Manual (browser) checks

Run `npm run dev` at the repo root and open **MD Editor**.

| Check | Steps | Expected |
|---|---|---|
| spacing | Source mode: `> a` / `>` / `> b`, a paragraph before and after; back to WYSIWYG | the quote and its two paragraphs stand as in the viewer's preview of the same text |
| Enter | Click at the end of `a`, Enter, type, Enter twice | a second paragraph in the quote, then the quote ends and the caret is below it |
| Backspace | Backspace at the start of the quote's first paragraph | it leaves the quote; one Ctrl/Cmd+Z brings it back |
| toolbar | Select two paragraphs, Block › Quote; again | one quote holding both; both out again |
| paste | Copy two paragraphs, paste in the middle of a quote's paragraph | three paragraphs in the quote, the split one around the pasted ones |
| HTML paste | Copy a quote of two paragraphs from a web page, paste it | a quote of two paragraphs |
| table | Insert › Table with the caret in a quote | the table inside the quote |
| typing shortcuts | At the start of a quote's second paragraph type `- `, then `## ` in a third, `> ` in a fourth; in a list item's further paragraph type `1. `; Ctrl/Cmd+Z after each | a list, a heading, a nested quote, a numbered list, each in place; each undo gives back the typed marker as text |
| arrows | Arrow keys and Shift+arrow across a quote's paragraphs and out of the quote | the caret and the selection move as across plain paragraphs |
| source mode | Source mode, caret in a quote's second paragraph, Block › Quote; Ctrl/Cmd+Z | the paragraph leaves the quote; one undo |

---

## Verification

- `npm run typecheck` (repo root) and `npm -w packages/lib run typecheck:test`.
- `npm run lint` (repo root): no error; `markdownQuoteNode.ts` names no DOM
  type.
- `npx vitest run --maxWorkers=2 tests/component/markdown-quote-node.test.ts tests/component/markdown-quote-node-html.test.ts tests/component/markdown-editor-quotes.test.ts`.
- `npx vitest run tests/component/markdown-editor-typing-shortcuts.test.ts tests/component/markdown-editor-guarded-removal-shortcuts.test.ts`:
  `TY21` and `TY22` with every older row unchanged (on the prototype both
  files pass, with the two groups run as probes).
- `npx vitest run --maxWorkers=2 tests/component/markdown-*.test.ts tests/component/markdown-roundtrip`:
  every row, the corpus, the round-trip harness and the fuzzes. On the base
  this is 13,687 tests in 38 files; with the code of steps 1 to 6 and the
  tests unchanged, the prototype failed 691 of them, in the 12 files the
  restatements name, and no other (`p1-stage5-shortcuts.log`; the typing
  shortcuts in held blocks added no failure).
- `npm test` (repo root): the full suite. On the loaded machine of the
  prototype unrelated tests timed out (`code-editor.test.ts` TS19 and
  TS20, an `import-without-dom` entry, an escape-fuzz batch); run them again
  alone before calling them failures.
- `npm run docs:api` (no warning), `npm run docs:llms:check`, `npm run build:lib`.
- The three `grep` checkpoints of step 17.
- The costs and the price, measured as *Addendum: Measurements* was, with the
  probes `zz-quote-cost.test.ts` and `zz-quote-price.test.ts` of the
  prototype's folder (copied into `tests/component/`, run, deleted): the
  load of a quote of 2,000 paragraphs under 1 s; a letter and its save in a
  hand-written quote of 2,000 paragraphs within 20 % of a `:::` column of
  2,000 hand-written paragraphs on the same machine.
- The manual checks.

---

## Documentation Impact

No exported symbol changes; no API page, catalog entry or `llms.txt` line
changes.

**[MarkdownEditor.md](../packages/lib/docs/components/MarkdownEditor.md)**

- *Kept as source* (line 84): delete "and so does a blockquote holding more
  than one paragraph or another block,"; after the sentence on raw lists, add
  "A blockquote loads as a raw Markdown block only when one of its lines
  without `>` — a lazy line — falls in a block other than a paragraph (`> q`
  over an indented `<div`, `> - a` over `b`): such a quote reads by what
  follows it." In "No block stays inside a block that holds text only — a
  paragraph, a heading, a quote, a code block or a raw block", delete "a
  quote, ".
- *Line breaks* (line 92): "A code block's lines, when it becomes a
  paragraph, a quote or a list item" → "when it becomes a paragraph or a list
  item".
- After the *Lists* bullet (line 98), add a **Quotes.** bullet: "A quote holds
  blocks as the viewer shows them — paragraphs, headings, code blocks, lists,
  tables, `:::` fences, raw Markdown blocks and other quotes. Enter splits a
  paragraph of a quote; Enter on an empty line of a quote takes that line out
  of the quote, one level, splitting the quote there; Backspace at the start
  of a quote's first block takes that block out the same way. A join across a
  quote's edge — Backspace at the start of the block after it, Delete at its
  end, a range across it — joins the two texts, as between two paragraphs.
  Blocks pasted into a paragraph or heading of a quote become blocks of the
  quote, the block split at the caret. A block type, a list toggle and
  `insertTable` act inside the quote; `setBlockType("quote")` puts the blocks
  into a quote or takes them out of it (see *Command API*). The typing
  shortcuts for blocks (`# `, `- `, `1. `, `> `, ```` ``` ````) apply at the
  start of a quote's paragraphs as at the top level. An edited quote keeps
  the lines of its unedited blocks as written, `>` markers included."
- *Markdown-shortcut typing* (line 108): after "applied as you type." add
  "The block shortcuts (`# `, `- `, `1. `, `> `, ` ``` `) apply at the start of
  a paragraph at the top level, in a `:::` column, in a quote at any depth, and
  in a list item's further paragraphs; in a list item's first line only the
  inline ones apply."
- *Lists* bullet: "Blocks pasted into a block that a list item holds — one of
  its further paragraphs, a heading or a quote —" → "— one of its further
  paragraphs or headings, or a paragraph or heading of a quote it holds —".
- *Columns* bullet (line 100): "(a paragraph, heading, quote, code block or
  raw Markdown block)" → "(a paragraph, heading, code block or raw Markdown
  block)".
- *Command API*: the `setBlockType` row (line 123) becomes: "Convert the
  selected blocks to `"paragraph"`, `"h1"`–`"h6"` or `"code"`, in place — in a
  quote too —, or, with `"quote"`, put them into a quote or take them out of
  it: when every selected block stands in a quote, the blocks leave their
  nearest quote, one level out, the quote split around them; otherwise every
  selected block that stands in no quote goes into one, joining a quote right
  before or after it. A list item's text is taken out of its lists first, and
  the blocks the item holds up to its first nested list follow it. A task
  item's marker stays as the text it shows, and in a code block as it was
  written." In the `toggleUnorderedList()` row (line 120), "at the top level
  (or in its `:::` column)" → "where the block stands: at the top level, in
  its `:::` column or in its quote". In the `insertTable` row (line 124),
  after "The block holding the caret is split only where the caret is inside
  its content", add "; in a quote the table goes into the quote".
- *Source / WYSIWYG mode* (line 293): the example of a raw block,
  "(`- \> - one`)", stays; after it add "A quote is a raw block there only
  when it is one on the WYSIWYG surface (see *Kept as source*)."
- *Common methods* (line 270), "In an edited list, table, fenced code block
  or `:::` fence, the items, rows, cells, fence lines and column blocks" →
  "In an edited list, table, fenced code block, `:::` fence or quote, the
  items, rows, cells, fence lines, column blocks and quoted blocks"; at the
  end of the list of seams add "and a block of a quote moved out of it, or the
  lines of an edited block of a quote, which take `> ` before each line".
- *Tabs* paragraph (line 297): "A raw Markdown block, an HTML block or a
  quote or list the editor keeps as one" stays.

**[next.md](../packages/lib/docs/reference/changelog/next.md)**

- *Breaking changes → Components*, a new entry: "**`MarkdownEditor`'s quote
  command toggles, and the other block types act inside a quote.**
  `setBlockType("quote")` puts the selected blocks into one quote, or takes
  them out of their quote when every one already stands in a quote, where it
  made each block a quote of its own and did nothing in a quote.
  `setBlockType("paragraph")` and the other types change a block inside a
  quote in place and no longer remove the quote, and the list toggles make a
  list inside the quote. `insertTable` puts the table into the quote. See
  [Migration](/reference/migration/next)."
- *Fixed → Components*, a new entry at the end, before `### Core`:
  "**`MarkdownEditor` edits a quote that holds blocks.** A quote of several
  paragraphs, or holding a list, a heading, code, a table, a `:::` fence or
  another quote, loaded as a raw Markdown block that showed its source; it now
  loads as a quote holding those blocks, as the viewer shows it. Enter makes a
  second paragraph in a quote and leaves the quote on an empty line;
  Backspace at a quote's start takes its first block out; blocks pasted into a
  quote stay in it; an edited quote keeps its unedited blocks' lines as
  written. Typing `- `, `1. `, `# `, `> ` or ```` ``` ```` at the start of a
  paragraph in a quote, or in a list item's further paragraph, makes that
  block, as at the top level, where it stayed text. Source-mode commands act
  in such quotes, where they did nothing. A
  long quote loads in a fraction of the time (a quote of 2,000 paragraphs:
  0.4 s, where it took 11 s). No consumer action is needed."
- In the unreleased entry "**`MarkdownEditor` reads Markdown with the viewer's
  parser.**" (line 422), "Thematic breaks, HTML, and blockquotes holding
  several blocks are kept as editable raw Markdown blocks" → "Thematic breaks
  and HTML are kept as editable raw Markdown blocks".

**[migration/next.md](../packages/lib/docs/reference/migration/next.md)** — a
new section at the end, in the page's form:

> ## `MarkdownEditor.setBlockType("quote")` toggles
>
> **What changed and why.** A quote now holds blocks, as Markdown's does, so
> the quote is no longer a block type among the others: it is a container
> the blocks stand in.
>
> | Call | Before | Now |
> | --- | --- | --- |
> | `setBlockType("quote")` on two paragraphs | two quotes | one quote holding both |
> | `setBlockType("quote")` in a quote | nothing | the blocks leave the quote |
> | `setBlockType("paragraph")` in a quote | the quote becomes a paragraph | the paragraph stays in the quote |
> | `setBlockType("h2")` in a quote | the quote becomes a heading | a heading in the quote |
> | `toggleUnorderedList()` in a quote | the quote becomes a list item | a list in the quote |
> | `insertTable()` in a quote | the table after the quote, the quote split | the table in the quote |
>
> **Who needs to act.** Code that removes a quote with
> `setBlockType("paragraph")` calls `setBlockType("quote")` instead. A toolbar
> that wires its Quote button to `setBlockType("quote")` needs no change: the
> button now toggles.

---

## Potential Challenges

- **A transform registered for `QuoteNode` runs for the replacement class
  too.** Lexical files a transform under the replaced class as well
  ([Lexical.dev.mjs:14807](../node_modules/lexical/dist/Lexical.dev.mjs#L14807)),
  so every `QuoteNode` registration this plan removes must really go; the
  second checkpoint of step 17 finds one left.
- **`$keepQuoteShape` must not move a caret off the text it stands in.** It
  calls `$wrapInlineRuns`, which carries element points on the quote into the
  new paragraph; the `> ` typing shortcut leaves exactly such a point
  (`node.select(0, 0)`), and the typing-shortcuts file pins it (`a quote`).
- **A quote's text is not `marked`'s `text`.** `marked` builds a wrong `text`
  for a nested quote that a lazy line continues (`> > ```` ``` ````…);
  locating blocks in it lost the inner quote on the prototype. Use the source
  lines without their markers, `marked`'s `text` only with a tab.
- **Part keys of a quote and a column must not collide.** A block can be a
  column block and hold a part of its own; keep `quote-block:` and
  `column-block:` prefixes apart, and keep the check `part.quote === node.getKey()`.
- **`$liftOutOfQuote` with an element point on the quote.** Every caller
  settles the selection into blocks of text first (`setBlockType` through
  `$settleEndsIntoBlocksOfText`; Enter and Backspace act on a text caret); a
  new caller must too.
- **`$runHeldBlockShortcut` copies Lexical's matching rules.** When Lexical
  is upgraded, compare it with `runElementTransformers` and
  `runMultilineElementTransformers` again. Lexical's listener and the
  editor's never both apply: Lexical's needs the block's parent to be the
  document or a shadow root, the editor's needs it to be a quote or a list
  item.
- **Rows that fail and should not be restated.** A pinned result that this
  plan does not list under *Results that change* or *Tests that are restated*
  is a defect to report, not a string to adjust.
- **Sibling plans edit the same files.** Apply each change by symbol name.

---

## Critical Files

- [markdownListItemNode.ts](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts)
  and `plans/implemented/markdown-editor-list-item-node.md` (its
  *Implementation Notes*, *For the plans that follow*) — the precedent for a
  block-holding node class, node replacement and listeners where Lexical
  decides.
- [markdownBlockNode.ts](../packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts)
  and `$buildFence`, `recordColumnBlocks`, `writtenColumn` — the precedent for
  a container whose blocks are a document.
- [markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts)
  — `blockListParts` (1023), `writtenBlocks` (1814), `separatorBefore`
  (2075), `serializeBlockList` (2133), `serializeQuote` (2977),
  `writtenColumn` (4089).
- [markdownImporter.ts](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts)
  — `$importMarkdown` (281), `$recordedParts` (554), `locateBlocks` (725),
  `$buildBlock` (1087), `$buildQuote` (1215), `$buildFence` (1664).
- [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts)
  — `registerWritableStateRules` (81), `$wrapInlineRuns` (263),
  `registerRawBlockRules` (1051), `registerLineBreakRules` (1729),
  `registerRunEdgeRules` (2458).
- [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts)
  — the functions of the two inventory tables, `$toggleListOfTouchedBlocks`
  (4330), `registerListItemRules` (5039), `setBlockType` (9135),
  `registerEditorRules` (10020).
- [LexicalRichText.dev.mjs:262](../node_modules/@lexical/rich-text/dist/LexicalRichText.dev.mjs#L262)
  (`QuoteNode`), [LexicalList.dev.mjs:1912](../node_modules/@lexical/list/dist/LexicalList.dev.mjs#L1912)
  (`registerList`'s Backspace listener),
  [Lexical.dev.mjs:9760](../node_modules/lexical/dist/Lexical.dev.mjs#L9760)
  (`deleteCharacter`), [:19827](../node_modules/lexical/dist/Lexical.dev.mjs#L19827)
  (`$insertNodeToNearestRootAtCaret`) — read only.
- The prototype, never to be committed, in
  `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans6/quote-node/`:
  `prototype-on-444ccaf07.diff`, `prototype-markdownQuoteNode.ts`,
  `restated-command-crashes.diff`, the probes and their outputs. It is a
  reference, not a patch: it skips JSDoc and names things `PROTOTYPE`.
- [ARCHITECTURE.md](../ARCHITECTURE.md) and [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md).

---

## Non-Goals

- **Block typing shortcuts in a list item's own text**, its first line. That
  text is the item's `MarkdownListItemTextNode`, and a block type on it takes
  the item out of its list (the list-item plan), so a shortcut there needs a
  design of its own: whether `# ` typed in `- a` gives `- # a` or a heading
  after the list. A further paragraph of the item has no such question.
- **The `>` markers of an edited block.** An edited block of a quote is
  written with `> ` before each line, as an edited item is written with its
  standard indentation.
- **Quotes with a lazy line outside a paragraph**, which stay raw blocks, and
  the quote kept as a raw block in a tight list item (`- a` over `  > q`):
  each is a separate divergence (`listItemBlocks`, the 12 corpus cases).
- **`insertTable` in a list item.** It still splits the list and puts the
  table at the nearest root; only a quote now holds it.
- **The source-mode text commands** (`insertTable`, the paragraph commands)
  and the known source-mode caret limits with tabs in a container prefix.
- **Enter in an empty further paragraph of a list item**, which adds a
  paragraph to the item, as recorded by the list-item plan.

---

## Addendum: Lexical probe

`zz-proto-quote-lexical.test.ts` and `proto-quote-out.txt` in the prototype's
folder run Lexical's own routines on hand-built trees of a `QuoteNode`
subclass holding blocks, without and with `isShadowRoot()`, in a bare editor
holding the editor's node classes.

| Routine, tree `x`, `quote(a, b)`, `y` | Not a shadow root | A shadow root |
|---|---|---|
| `insertParagraph` in the middle of `ab` | splits inside the quote | the same |
| `insertParagraph` twice at the end of `b` | two empty paragraphs in the quote (no exit) | the same |
| `deleteCharacter(true)` at `a`@0 | `xa`: joins the block before | throws in the headless DOM (it extends the native selection) |
| `deleteCharacter(true)` at `a`@0, the quote first in the document | throws headless; in a browser it reaches `$collapseAtStart`, and `QuoteNode.collapseAtStart` wraps blocks in a paragraph | — |
| `deleteCharacter(true)` at `y`@0 | `quote(a, "by")` | nothing joins |
| `deleteCharacter(false)` at `b`@1 | `quote(a, "by")` | throws headless |
| `removeText` from `x`@1 to `b`@1 | `"xb"`, the quote gone | the quote keeps `b` |
| `removeText` from `a`@1 to `y`@1 | `quote("ay")` | `y` stays apart |
| `insertNodes([p(P1), p(P2)])` at `aa`@1 | `aP1P2a` on one line | `aP1`, `P2a`: kept as blocks |
| `$setBlocksType` heading at `a` | the heading in the quote | the same |
| `$setBlocksType` with `$createQuoteNode` at `a` | a quote of inline text inside the quote | a nested quote |
| `$insertNodeToNearestRoot(table)` at `aa`@1 | the quote split, the table at the root | the table in the quote |
| `deleteCharacter(true)` at `y`@0 after a quote ending in a table | the caret left on the quote | nothing changes |

Not a shadow root, Lexical joins as it joins plain paragraphs; the rows this
plan's code decides are the exit on Enter, the Backspace key, the paste, the
quote command, the table insert and the caret on the quote.

---

## Addendum: Corpus cases

The 69 cases whose `quoteBlocks` entry goes: CommonMark 6, 128, 218, 228, 232,
235, 237, 244, 250; `T32`, `T33`, `T37` to `T41` of `tabs.ts`; the Enter cases
of `enterInsideHtml.ts` and `enterInCode.ts` that name a quote (C1 to C12,
C18, C21, C23, C31, C32, C37, C42, M26, M33, F1 to F7, F13, F14, F15, F19, F24,
S1 to S3, S5, and *Enter in quoted HTML with a tab after the marker, then
text*, *Enter in quoted fenced code with a tab after the marker*, *Enter in
quoted indented code, then text*); and in `dialect.ts` and
`referenceLinks.ts`: *code fence in blockquote*, *code in a quote ending in a
line of spaces*, *definition in a blockquote*, *duplicate definition in a
quote*, *html block start ending a quote*, *html block start on a quote line
before a lazy line*, *multi-paragraph blockquote*, *multi-paragraph quote in a
list item*, *retargeted definition order*, *text after a fence closed in a
nested quote*, *underscore definition in a blockquote*. The prototype's run
lists them exactly (`p1-stage4.log`, "now holds").

The 12 that keep it, each holding a lazy line outside a paragraph: *html block
start on a lazy line after a quote*, *html line right after a quote list with
lazy lines*, *indented quote before an indented lazy closing tag ending the
document*, *indented quote before an indented lazy html start*, *indented quote
before an indented lazy html start in a column*, *lazy line repeated after a
quote*, *ordered item right after a quote list with lazy lines*, *quote before
a deeper lazy html start*, *quote before a deeper lazy html start in a list
item*, *quote list with a lazy last line*, *quote whose lines are indented one
space, then a comment*, *thematic break after a quote list with a lazy line*.

`divergences.ts`, `quoteBlocks`'s reason becomes: "A blockquote one of whose
lines without `>` (a lazy line) falls in a block other than a paragraph — an
HTML block, a list — is kept as a raw Markdown block: such a quote reads by
what follows it. Saved unchanged, but shown as source where the viewer renders
a quote."

---

## Addendum: Measurements

All on a private copy of `444ccaf07` (the base) and the same copy with the
prototype, one Vitest process at a time; probes and outputs in the prototype's
folder.

**Cost.** Load, and a letter typed at a caret (`CONTROLLED_TEXT_INSERTION_COMMAND`)
followed by `getValue()`; medians of three, milliseconds
(`zz-quote-cost.test.ts`, `cost-base.jsonl`, `cost-proto.jsonl`,
`costc-*.jsonl`).

| Document | Size | Load, base / after | Letter and save, base / after |
|---|---|---|---|
| one quote of n paragraphs (`> entry i words`, a `>` line between) | 500 | 598 / 58 | 15.2 / 26.8 |
| | 2,000 | 10,885 / 385 | 60.9 / 71.5 |
| the same, hand-written (`>entry i _words_`) | 500 | 563 / 82 | 16.1 / 49.6 |
| | 2,000 | 10,684 / 544 | 59.2 / 194.1 |
| n quotes of one paragraph | 500 | 26 / 28 | 10.5 / 12.8 |
| | 2,000 | 72 / 118 | 37.9 / 46.1 |
| one quote holding a list of n items | 500 | 185 / 43 | 9.4 / 13.4 |
| | 2,000 | 2,759 / 142 | 33.9 / 54.9 |
| n paragraphs (control) | 2,000 | 69 / 69 | 35.5 / 35.0 |
| a `:::` column of n hand-written paragraphs (control) | 2,000 | 241 / 247 | 181.6 / 183.8 |

Today a quote of many paragraphs is one raw block, whose load reads it again
for every block it holds; after, a quote loads as a column does. A letter in a
hand-written quote costs what a letter in a hand-written column of the same
size costs today: the save writes the edited quote part by part, as it writes
the column.[^cost]

**Price.** A word appended to a random text node of a random top-level quote,
eight runs per document; the non-blank source lines gone from the save once
the word is stripped (`zz-quote-price.test.ts`, `price-*.jsonl`).

| Set | Documents | Runs | Lines gone, base | After | Viewer disagrees with the save, base → after |
|---|---|---|---|---|---|
| hand-written quote documents (12 written for the probe; 10 have a top-level quote) | 10 | 80 | 29, in 16 runs | 37, in 29 runs | 62 → 0 |
| corpus cases with a quote | 89 / 87 | 712 / 696 | 144, in 104 runs | 610, in 424 runs | 551 → 72 |
| real documents with a quote (library docs, implemented plans, READMEs, up to 25 kB) | 72 | 576 | 23, in 14 runs | 23, in 14 runs | 48 → 32 |

On real documents the price is unchanged. On the corpus it rises because the
corpus's quotes are mostly of the shapes the editor kept as raw blocks — HTML
and code in quotes, tabs after markers, blank lines `> ` with a trailing space
— where an edit of a raw block wrote back every other byte, and an edit of a
quote node writes the edited block under `> `. The 72 remaining disagreements
are eight runs each of 9 of the 12 corpus cases that keep `quoteBlocks`
(*Addendum: Corpus cases*), whose quotes stay raw blocks; on real documents the 32 are
4 documents whose quote ends before an HTML comment line (`> …` / `<!-- /demo
-->`), a raw block before and after.[^price]

**Source mode.** The differential of `markdown-source-mode-through-model.test.ts`
row 9: compared 4,926 → 5,428, declined 2,484 → 1,960, unplaced 1,014 →
1,028, shown 654 → 662; differences 0 → 3, then 0 with `writesPrefixTabLine`
(`tm-base.jsonl`, `tm-proto.jsonl`, `tm-excused.jsonl`).

---

## Addendum: What a review should attack

- **`$liftOutOfQuote` and the selection**, in every caller, and with an
  element point on the quote that code sets.
- **The two raw cases of the importer**: a lazy line in a list item inside a
  quote, a nested quote continued by a lazy line, tabs before `>`.
- **`writtenQuote`'s assembly**: a kept block that ran to the quote's end
  (`endsOpen`), a raw block given its second blank line, two kept blocks
  around an edited one, a `[//]: #` separator between two raw lists in a
  quote.
- **Every `$isQuoteNode` left in `src/`** and every `$isListItemNode` that
  walks containers: each now meets a quote that holds blocks.
- **The quote command over mixed selections**: a range from a quote's
  paragraph into a list item's text; a selection in a column's quote; a
  range over a nested quote and its outer quote's paragraph.
- **The typing shortcuts in held blocks**: a shortcut typed in a further
  paragraph of a nested list item, in a quote in a column, during a
  composition, and right after a paste.
- **Keys in a browser**: arrow keys into and out of a quote, Backspace with an
  input method (which sends `DELETE_CHARACTER_COMMAND`), Enter on Safari and
  iOS (which goes through `beforeinput`).

---

## Notes

[^prototype]: The prototype is a throwaway patch on `444ccaf07`, kept at
    `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans6/quote-node/`
    (`prototype-on-444ccaf07.diff`, 939 lines, and
    `prototype-markdownQuoteNode.ts`), with its probes and logs. It has the
    node class, the importer's build and raw cases and part recording, the
    serializer's quote writing and parts, the normal form, the removals, the
    container walks, the two key rules, the paste predicate, the quote
    toggle and the table insert. On the base the Markdown files run 13,687
    tests in 38 files, all green (`base-md.log`); with the prototype and the
    tests unchanged 691 fail, all in the 12 files *Tests that are restated*
    names (`p1-stage5-shortcuts.log`); the restated command-crashes file
    passes (`te8-shortcuts.log`); the nested-edit fuzz with the quote edits passes at two seeds
    (`nfuzz.log`, `nfuzz-big.log`).

[^why-own-class]: `$createQuoteNode()` is called by Lexical's own code: the
    `QUOTE` typing shortcut of `@lexical/markdown` and the `<blockquote>`
    conversion of `@lexical/rich-text`. Only a node replacement makes those
    calls build the editor's class, as it does for `ListItemNode`. A class that
    does not extend `QuoteNode` would miss every `$isQuoteNode` in Lexical
    (`QUOTE.export`, `$findMatchingParent` callers) and in the editor
    (`$findEnclosingInsertableBlock`). The jsdom probe
    (`zz-proto-quote-html.test.ts`, `html.out`) shows HTML import building the
    editor's class with no `importDOM` override, and the export writing
    `<blockquote>` around `<p>`, `<ul>` and `<blockquote>`.

[^no-text-node]: The list-item plan needed `MarkdownListItemTextNode` because
    Lexical asks the caret's block what to do, and an item's text had to
    answer for its item (Enter splits the item, a block type lifts it out).
    In a quote every paragraph answers for itself: Enter splits it in the
    quote, a block type changes it in place, a join joins it (*Addendum:
    Lexical probe*). The two decisions Lexical makes otherwise — Enter on an
    empty line, the Backspace key at the start — are made where `@lexical/list`
    makes its own, in command listeners, as the list-item plan's
    implementation ended up making the Enter exit
    (`$enterLeavesListAtBlankItemText`). The paste flattening (Lexical's
    "case 3c") is decided by the pasted-into block, which is Lexical's
    `ParagraphNode` or `HeadingNode`, so a node of the editor's could not
    answer for it either; the existing handler for a block of a list item
    takes it.

[^no-shadow-root]: The probe ran the same routines with `isShadowRoot()`
    returning `true` (*Addendum: Lexical probe*): pasted blocks stay blocks,
    the one gain, but Backspace after a quote joins nothing, Delete at a
    quote's end and Backspace at its start leave the caret (or throw in the
    headless DOM), and a range across the edge leaves both halves, as at a
    table cell. Every join across a quote's edge would then need a listener.
    Lexical 0.49's `quoteShadowRootState` is that same shadow-root quote, opt-in
    per node; `isShadowRoot()` returning `false` keeps a pasted JSON node that
    carries the state from turning one on.

[^quote-text]: `marked`'s `text` for a quote is built chunk by chunk, and for
    a nested quote continued after a lazy line it splices in the inner
    quote's own text: for `> > ```` ``` ```` / `> > a` / `> > ```` ``` ```` /
    `b` it is `> ```` ``` ```` / ```` ``` ```` / `a` / ```` ``` ````, in which
    the inner quote's token is not found, and the prototype's first version
    showed a raw block there. The source lines with the first marker taken
    off (`marked`'s own `blockquoteSetextReplace2`) give `> ```` ``` ```` /
    `> a` / `> ```` ``` ````, where it is found. With a tab in the source,
    `marked` lexes a tab-expanded form (`blockquoteWithTabStops`), so its
    `text` and its tokens agree and the source lines do not; there `text` is
    used. The two forms have the same lines, so a line of the quote's text is
    the same line of its source.

[^lazy-rule]: These are the quotes the editor keeps as raw blocks today and
    whose reading depends on what follows them: the list-item plan's
    `listItemBlocks` class ("a quote that ends on a line without `>` … that
    starts an HTML block"), the R rows `RL1` to `RL16` and the Q rows `Q1` to
    `Q13` of `markdown-editor-list-item-edits.test.ts`, and the importer's
    `VB4`. Built as quote nodes on the prototype's first version, they made
    the edit fuzz and the nested-edit fuzz fail on nine corpus cases: the
    unedited quote kept its source (`> q` / `<div`), and a block added after
    it changed how that source read. With the rule they are raw blocks as
    today and every one of those rows passes unchanged. A lazy line in a
    paragraph only continues the paragraph, in CommonMark and in `marked`
    alike, so it keeps the quote a quote (CommonMark 232 and 250 then pass the
    harness). A line is lazy when its first character after its blanks is not
    `>`: with tabs in front of `>` the three-column rule cannot be read off a
    list item's de-indented text, and the generated tab documents of the
    round-trip test (G2) failed until the test read the first character only.

[^quote-parts]: The column precedent writes a column's text as a document;
    a quote's text is the same, under markers. The decisions about which
    blocks are kept — `writtenBlocks`' rules about labels and fences closed
    later, a raw block's second blank line, an indented block after a list —
    run on the quote's text without markers, where the blocks are read; the
    markers only come back when the lines are written. Keeping each block's
    lines as written needs the source lines beside the text slices, which is
    what `quotedBody`, `quotedAfter` and `quotedPrefix` hold. A lazy line
    would put a line without a marker into a kept block, which reads by where
    it stands, and a tab reads by its column; both are left out, as the
    nested-preservation plan leaves out items with a lazy line and blocks
    with a tab. A block moved out of its quote by the quote command is written
    by its new container, so the `quote` key check keeps it from being written
    with the old quote's markers.

[^enter-exit]: CommonMark has no empty paragraph: `> a` / `>` / `>` / `> b`
    is one quote of two paragraphs, so an empty paragraph left in a quote
    saves as nothing and vanishes on reload. ProseMirror's base keymap
    (`liftEmptyBlock`) lifts an empty block out of its wrapper wherever it
    stands, splitting the wrapper, and so does this editor's list rule for an
    empty item (`$enterLeavesListAtBlankItemText`, which outdents a nested item
    one level). The quote rule is that rule: one level out, anywhere in the
    quote. An exit only at the quote's end would leave an empty paragraph in
    the middle of a quote with no way out but Backspace, saved as nothing.

[^toggle]: In the old model a quote was a block of text, one of the block
    types, so "Paragraph" removed it. A quote holding blocks is a container,
    as a list is: the list toggles in this editor already toggle, and so does
    the blockquote command of ProseMirror-based editors and Typora. Keeping
    "paragraph" as the way out was considered: it would make a paragraph in a
    quote of type "quote" for the commands, and a heading in a quote could
    then not become a paragraph without leaving the quote. Joining the quote
    beside the run mirrors `$makeItemsOfRun`; without it, the quote command on
    a paragraph under a quote made two quotes, which Markdown also reads as
    two (`> a` / (blank) / `> b`), and a selection over a quote and a
    paragraph did the same.

[^table-in-quote]: `$insertNodeToNearestRootAtCaret` splits every ancestor up
    to the root or a shadow root, so a table inserted in a quote split the
    quote in two (*Addendum: Lexical probe*), which the viewer shows as two
    quotes around a table. A quote holds tables now, and a table inserted in a
    paragraph at the top level goes between the paragraph's halves, not out of
    the document; the same in a quote. A list item keeps today's behaviour
    (*Non-Goals*): an item's table under its text would be a tight block under
    the text, which the save cannot write without making the list loose.

[^held-types]: `REBUILT_RAW_TYPES` is about locating a token whose `raw`
    `marked` rebuilt; a top-level blockquote's `raw` is the source slice
    (`blockquoteWithSourceRaw`), but the entry costs nothing and a nested
    blockquote inside a list's rebuilt `raw` may still need it, so it stays.
    `HELD_BLOCK_TYPES` tells `$readRawBlockAsBlocks` which block types a raw
    block's text may be shown as; a quote is one, as before.

[^differential]: The three cases are `Enter on a tab-indented line of
    top-level fenced code (F17)`, `T3: code lines indented by a tab, by a
    space and a tab, and by two spaces and two tabs` and `T7: a tab-indented
    line of a fence at the margin keeps its tab`, each with the quote command.
    The quote puts `> ` before code lines that open with a tab, and a code
    line whose container prefix holds a tab has no exact source place
    (*Source / WYSIWYG mode*, the documented limit), so the caret falls back
    to the end of the replaced text, as documented. Today the quote command
    replaced the code block by a quote of its text, which has no such line.
    Leaving the caret out only where a written line holds a prefix tab keeps
    every other caret comparison.

[^cost]: The hand-written quote is written part by part on every save after
    an edit, because its blocks' sources differ from their standard form:
    one standard pass to compare with the fingerprint and one write pass,
    the cost the nested-preservation plan measured for a list nested four
    spaces deep (47 → 74 ms at 2,000 items) and accepted. The control rows
    show a column of the same paragraphs already costs that (182 ms). A quote
    written in the standard form (the first rows) pays the second pass not at
    all: its parts equal their standard form, so `partsDiffer` is false.

[^one-step]: Registered alone, the class changes the type name in every shape
    string while the importer still builds a quote of inline text, so the
    restated strings (`markdown-quote(paragraph("x"))`) cannot pass; restated
    to an in-between form (`markdown-quote("x")`), they would be restated twice.
    The list-item plan's step 3 is the precedent for a switch done as one
    step.

[^price]: Both sides of the corpus row hold the same 89 documents; on the
    prototype two of them have no editable text in a top-level quote (a
    quote holding only a definition, now a raw block inside the quote that
    the probe does not pick), so 87 are measured. The hand-written set's two
    other documents hold their quote in a list item and in a column.

[^held-shortcuts]: Running the transformers, not the commands, gives each
    shortcut the shape it has at the top level: `3. ` starts a list at 3,
    `> ` nests a quote where the quote command would take the paragraph out
    of its quote, and `- ` joins a bulleted list right before or after the
    block, which `listReplace` does and the list toggle also does. For
    headings, lists and code the shapes are the ones the commands build in a
    quote. A shadow-root quote would have let Lexical's own listener apply
    the shortcuts, at the costs *The quote is not a shadow root* names; a further paragraph
    of a list item would still have none. On the prototype
    (`prototype-held-shortcuts.diff`, `prototype-held-shortcuts-tests.diff`,
    `c16.json`, `c16p.out`, `ty21.out`, `ty22.out`) every `TY21` kind gives
    one result on all routes with the undo and redo steps of `TY2`, no
    removal completes one, and the Markdown files show no other change than
    `TK7`.

---

## Implementation Notes

What differs from the plan, or was left to the implementation:

- **The block typing shortcuts in held blocks** are split into `$applyElementShortcut`, `$applyMultilineShortcut` and
  `$runHeldBlockShortcut` (the plan describes one function), and they try the shortcuts in the order Lexical's two paths
  use: the one-line shortcuts first on a typed character, the code fence first on Enter. The behaviour is the one the
  plan's rows pin.
- **`$toggleQuoteOfTouchedBlocks`** is split into `$liftBlocksOutOfQuotes`, `$putBlocksIntoQuotes` and `$makeQuoteOfRun`,
  and the walk from a block to the child of its quote is `$childHolding`. `$insertBlockToNearestHolderAtCaret` hands over
  to Lexical's insert when a shadow root stands between the caret and the nearest quote, tested as
  `quote.isParentOf(region)`.
- **`writtenQuote`** lays its lines out in `quotedWrittenBlocks`, with `linesOf` for the lines kept as written.
- **Restated rows** that the plan lists by rule only: `Q1` and `Q2` of `markdown-editor.test.ts` moved into the parity
  table (their `Now` column, both surfaces); `X27 OL` saves `one` / (blank) / `1. > 1. qq` / `2. bb`; the eleven
  `SP19` rows of `markdown-source-places.test.ts` took the places the implementation gives, after the two examples the plan
  names (`[[[¦a][[h]]]]`, `[[[a][[[q{0§: }  r {1:b}]]]]]`) matched; `I18` of `markdown-importer.test.ts` carries the save as a
  third element of its row, because the quote's text (`b`) and its save (`> - b`) now differ; `HE11` and `HE12` of the same
  file are two tests; `K17` of `markdown-editor-list-item-edits.test.ts` is a test of its own, as it no longer shares the
  rule of the other containers; `RL14` of `markdown-reference-links.test.ts` expects `markdown-quote` by the node-type rule.
- **The command-crashes file** is the planner's restated copy, with the comment of `TK7` rewritten as the plan asks.
- **Measured** with the planner's probes, on this machine: a quote of 2,000 paragraphs loads in 178 ms (359 ms before the line lookup of `recordQuoteBlocks` was made linear); a letter and its
  save in the hand-written quote of 2,000 paragraphs takes 181 ms, where a `:::` column of the same paragraphs takes
  178 ms; the price probe gives the plan's numbers (37 lines gone in 29 runs of the hand-written set, 610 in 424 runs of
  the corpus, 72 disagreements with the viewer).
- **Not done:** the manual browser checks of the plan's *Manual (browser) checks* table were not run in this session.
- **Shortcuts in a quote of one paragraph.** The Overview says no typing shortcut applies in a quote. That held for a
  quote that loaded as a raw block, but a quote of one paragraph was Lexical's own quote, in which Lexical's shortcuts
  applied and replaced the quote: `> b` with `- ` typed gave `- b`, `# ` gave `# b`, a code fence gave a code block
  outside the quote, and `> ` left `> b`. The editor's shortcut for the blocks a quote holds now builds inside the
  quote, so these give `> - b`, `> # b`, a code block inside the quote and `> > b`. The changelog, the migration page and
  four rows of `markdown-editor-quotes.test.ts` record it. The plan's "Results that change" table does not list it.
- **The quote command over a raw block.** The base escaped the raw block's text into a quote (`> \<div>x\</div>`); the
  command now wraps the block and keeps it raw (`> <div>x</div>`), as it wraps any block. A row of
  `markdown-editor-quotes.test.ts` and the changelog record it; "Results that change" does not list it.
- **Parts of a quote in the standard form.** The cost footnote says a quote written in the standard form is not written
  part by part, because its parts equal their standard form. `differsFromStandard` returns true for every quote block,
  as it does for a column block, so an edited quote is always written part by part; the measured costs are those of
  that path.
- **Rows added after review:** `TY23` (the end of a composition completes a shortcut in a block a quote or a list item
  holds), and four rows of `markdown-editor-quotes.test.ts` that delete a quote's only table and then insert a table
  or press Backspace: top level, nested quote, quote in a list item, and the Backspace key. They pin the caret that
  `$keepQuoteShape` leaves in the new paragraph.
- **Source-mode rows `5.32` and `5.33`** leave the caret unchecked: the plan gives their text only, and a command over
  a quote in source mode places the caret by the same code as the rows `5.24`, which the plan pins by text as well.
- **`MarkdownQuoteNode.insertNewAfter`** is overridden (not in the plan), so that Lexical's own split at a point
  strictly inside a quote (`RangeSelection.insertParagraph` on an element point of the quote) moves the blocks after the
  point into a quote of their own, not into a paragraph outside the quote. At the start or the end of a quote Lexical
  never asks the quote and splits at the level of the document, which adds empty paragraphs and takes no block out.
  `insertNodes` at a point on a quote still leaves an empty half of the quote at its start or end: Lexical asks
  `canBeEmpty()`, and answering `false` would make a quote emptied of its last block vanish, where the plan has it keep
  an empty paragraph (`DEF6`). `canMergeWhenEmpty` is not overridden: no pinned behaviour needs it.
- **`registerHeldBlockShortcuts`** looks at the committed state first and starts an update only when the typed
  character stands in a paragraph or heading that a quote or a list item holds, so other typing starts none.
- **The quote command off, over a nested quote.** The plan's step 2 of the off rule lifts, for each nearest quote, the
  whole run of its children from the first to the last that holds a touched block. For a selection over a nested quote
  and the blocks around it, that run holds the nested quote, so a block that left the nested quote left the outer quote
  with it, two levels out. The plan's prose, and the command's documentation, say that every touched block leaves its
  nearest quote only, one level out. The code follows the prose: for each nearest quote it lifts the children that hold a
  touched block, each run of them side by side at once, and a child that holds only blocks of a nested quote stays. `> a`
  / `>` / `> > b` / `>` / `> c` over `a` to `c` gives `a` / (blank) / `> b` / (blank) / `c`. Rows of
  `markdown-editor-quotes.test.ts` pin it for that selection, for the nested quote's blocks alone, for a selection from
  the nested quote into the outer quote's later block, and for three levels.
- **A manual browser check the plan lacks.** Add to the plan's *Manual (browser) checks* table: Backspace as an input
  method sends it (`DELETE_CHARACTER_COMMAND`, with no key event) at the start of a quote that is first in the document,
  and the same with an element caret on the quote (between its blocks); expected: the quote's first block leaves the quote,
  as it does for the Backspace key. Headless, Lexical's deletion throws "window object not found" there, so the row can
  only be checked in a browser. The documentation carries no manual-check list.
