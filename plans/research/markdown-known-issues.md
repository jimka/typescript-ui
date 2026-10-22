# Markdown known issues

The open defects of the `Markdown` viewer and `MarkdownEditor`, each with its
evidence. This is a research record, not an implementation plan. It replaces
the working list kept beside the Markdown chain (`known-issues-2026-10.md` in
the scratch folder) as the record in the repo; the entries that list marked
fixed or resolved are left out. The 45 entries it held as open are all here:
44 open defects, and one that this check found resolved, recorded under
*Resolved on this check* at the end.

**The user-facing subset is in the docs:** the *Known limitations* sections of
[`docs/components/Markdown.md`](../../packages/lib/docs/components/Markdown.md#known-limitations)
(the viewer) and
[`docs/components/MarkdownEditor.md`](../../packages/lib/docs/components/MarkdownEditor.md#known-limitations)
(the editor and its source mode). This file holds every open entry, the
internal ones included, and says for each whether the docs carry it.

Every entry was checked again on 2026-10-21 on the tip of the Markdown chain,
`feature/markdown-small-known-issue-fixes` (`37313e4a4`), by a probe or by
reading the code. The status line says what that check found:

- **Confirmed**: it happens on the tip as described.
- **Confirmed, otherwise than logged**: a defect is there, but not quite as
  the entry first described it; the entry gives what happens now.
- **Did not reproduce**: the described behaviour is gone; the entry says what
  was tried. Such entries are not kept among the open defects: they are listed
  under *Resolved on this check* at the end.
- **Not checked**: the entry could not be checked here; it stays open until it
  is.

Fix sizes are the estimates of the 2026-10-20 re-check, or of the plan that
found the entry; "not estimated" where neither gave one.

Probe paths are relative to the scratch folder
`~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/`. The 2026-10-20
re-check's probes are in `impl/known-issues-recheck/part1` to `part4` (each
with a `results.md`); the probes written for this file are in
`impl/dialect-docs/tests/`. Each folder holds a `vitest.review.config.mjs`;
run a probe with
`TREE=<worktree>/packages/lib ONLY=<file> npx vitest run --config vitest.review.config.mjs --reporter=verbose --silent=false`
from that folder.

In the examples, `⏎` is a line end, `→` a tab, `·` a space and `¦` a caret.
A point in the WYSIWYG document is written `text@n` for offset `n` in the text
node holding `text` (`<div></div>@0` is the start of that text), and
`root@a..b` for a range set by code on the document root from child offset
`a` to child offset `b` (`root@0..1` covers the root's first block). A source
offset is a character offset into the Markdown text, counted from 0.
"Raw block" means a raw Markdown block: an HTML block, a link reference
definition or a list the editor keeps as source.

## Saved text that can come out different

### A line holding only an em space after a line break

- **What happens:** in `a`, a line break and `b`, select `b` and type an em
  space (U+2003) or a thin space (U+2009). The editor shows `a\`, a soft line
  end and the space, and saves `a\\⏎` and the space; the viewer shows `a\`
  with no break. In a list item the save is `- a\\⏎··` and the space, and the
  reload drops the space. In a table cell the save is `| a<br> |`. A
  no-break space in the same place keeps the break and the space
  (`a\⏎&nbsp;`), and so does a loaded `a\⏎&emsp;`.
- **Status:** confirmed. Older than the Markdown chain.
- **Probe:** `impl/known-issues-recheck/part1/tests/emspace-line.test.ts`.
- **Fix size:** medium. Likely fix: write any non-ASCII space at a line edge
  as a character reference, as the no-break space already is.
- **Docs:** `MarkdownEditor.md`.

### A character reference for a space at a block's start

- **What happens:** `&#32;&#32;a` and `&#32;a` load as the paragraph `a`. An
  unedited save keeps the reference; after `z` is typed at the end, the save
  is `az`. A list item and a heading behave the same, and
  `&#32;&#32;**a**` shows the two spaces until the edit. The viewer shows `a`
  either way. Keeping the reference needs the importer to hold the spaces and
  the save to write them back as references.
- **Status:** confirmed.
- **Found:** the review of [`plans/implemented/markdown-tab-column-parity.md`](../implemented/markdown-tab-column-parity.md), round 2 (the `&#32;&#32;` form), and the
  review of [`plans/implemented/markdown-editor-reload-differences.md`](../implemented/markdown-editor-reload-differences.md),
  round 1 (the `&#32;a` form).
- **Probe:** `impl/known-issues-recheck/part1/tests/leading-blanks-inline.test.ts`
  (its group of `&#32;&#32;` documents edited and saved);
  `impl/known-issues-recheck/part2/tests/wysiwyg-saves.test.ts` (its test of
  `&#32;a` loading as `a`).
- **Fix size:** medium.
- **Docs:** `MarkdownEditor.md`.

### Four differences the reload-differences review found

- **What happens:**
  - A footnote-style reference in a table cell (`a<br>[^1]`) reloads as a
    link node after its definition's text is edited. Not a defect: an edited
    definition saves the reference inline with its old address, as the
    reference-links plan decided.
  - Tab over `- a⏎··- b⏎- c⏎⏎p0` from `b` into `p0` saves `- a⏎··- - b⏎··- c`.
    Tab with the caret alone in `b` gives the same `- - b`: Tab on a first
    nested item always makes an empty parent item, and the editor shows it,
    so the editor, the save and the reload agree. Whether Tab should refuse
    there is a design question.
  - Shift+Enter after a space keeps the space in the editor and the save
    drops it: `a·¦b` shows `a·`, a break and `b`, saves `a\⏎b`, and reloads
    without the space.
  - `&#32;a` loads as `a`: the entry above.
- **Status:** confirmed, the first part being by design and the second a
  design question.
- **Found:** the review of [`plans/implemented/markdown-editor-reload-differences.md`](../implemented/markdown-editor-reload-differences.md), round 1. Same on its base.
- **Probe:** `impl/known-issues-recheck/part2/tests/wysiwyg-saves.test.ts`
  (its four tests of the footnote cell, the Tab range, Shift+Enter after a
  space and `&#32;a`).
- **Fix size:** small.
- **Docs:** the Shift+Enter part, in `MarkdownEditor.md` under *Spaces the
  editor shows that a save drops*.

### A backslash escape joined into an HTML block

- **What happens:** an HTML block reads no backslash escapes, so an escape a
  join brings into one shows its backslash. In `<div>⏎raw⏎</div>⏎⏎ab \*y\*`,
  Delete from the end of `</div>` to after `ab` leaves the HTML block's last
  line `</div> \*y\*`. `\[x\]` and `\<i>` behave the same, and so does
  Backspace at the start of `\>cd` after an HTML block whose last line is
  `raw <b` (giving `raw <b\>cd`). A rest of `\> q` is written without its
  backslash, which the join-escapes branch fixed.
- **Status:** confirmed.
- **Found:** the review of [`plans/implemented/markdown-editor-join-escapes-heading-line.md`](../implemented/markdown-editor-join-escapes-heading-line.md), round 3. Same on its base.
- **Probe:** `impl/known-issues-recheck/part1/tests/join-open-tag.test.ts`
  (rows "html block, …").
- **Fix size:** medium. The fix would write the rest as the characters it
  shows when the joint lands in an HTML block, with care for `<` and `&`.
- **Docs:** `MarkdownEditor.md`.

### Tabs after marker characters on a paragraph's continuation line

- **What happens:** in `- a⏎→→-→-→b c`, the `-` characters count as container
  markers for tab expansion, so the editor shows `-···-···b c` and bold on `a`
  saves `- **a**⏎··\-···-···b·c`: the tabs become spaces. With `x` for the
  first `-` (`→→x→-→b c`) the tabs are kept. The viewer collapses the
  whitespace, so nothing shows. Bold and link on the single `-` word now act
  in source mode.
- **Status:** confirmed (the tab reading; the bold and link decline is fixed).
- **Found:** [`plans/implemented/markdown-tab-column-parity.md`](../implemented/markdown-tab-column-parity.md). CommonMark's rule (a marker counts only
  under four columns past the content column) fixes it, but needs a
  fence-aware prefix scan; the attempt broke the round trip of 36 code-block
  documents and was reverted.
- **Probe:** `impl/dialect-docs/tests/editor-entries.test.ts` ("marker
  characters on a continuation line"); `impl/known-issues-recheck/part1/tests/marker-word.test.ts`.
- **Fix size:** medium.
- **Docs:** `MarkdownEditor.md`. The reading itself is documented in
  `Markdown.md` under *Tabs*.

### A leading space the editor shows after a join, which the save drops

- **What happens:** `<div></div>⏎⏎x→# y` (or four spaces for the tab), Delete
  from `<div></div>`@0 to after `x`: the editor shows `·# y`, saves `\# y`,
  and reloads without the space. A range from before a `***` rule to after
  `x` shows the paragraph opening with the tab. The join keeps the space so
  that typing over the selection gives `Z # y`.
- **Status:** confirmed for the join. The importer half the entry also named
  (a document opening `·\# y` showed `·# y`) is fixed: the editor shows `# y`.
- **Found:** [`plans/implemented/markdown-editor-four-known-issue-fixes.md`](../implemented/markdown-editor-four-known-issue-fixes.md), round 2.
- **Probe:** `impl/known-issues-recheck/part3/tests/line098-leading-space-shown.test.ts`,
  which covers the joins and a document opening with a space; the test of
  that document now fails, which is the fixed importer half.
- **Fix size:** medium.
- **Docs:** `MarkdownEditor.md`, under *Spaces the editor shows that a save
  drops*.

### The rest of a later raw block makes a code block or a heading

- **What happens:** `<div></div>⏎⏎- x····y⏎··> q`, Delete from `<div></div>`@0
  to after `- x`: the rest becomes a code block `y`. With `- x # y`, ending
  after `- x·`, it becomes the heading `y`. The same rest in a paragraph
  stays text (`x····y`, `\# y`). Only a rest of a code block or an HTML block
  is handled at the line start.
- **Status:** confirmed.
- **Found:** [`plans/implemented/markdown-editor-four-known-issue-fixes.md`](../implemented/markdown-editor-four-known-issue-fixes.md), round 3. Same on its base.
- **Probe:** `impl/known-issues-recheck/part3/tests/line106-raw-rest-makes-block.test.ts`.
- **Fix size:** medium.
- **Docs:** `MarkdownEditor.md`, under *A deletion from a raw Markdown block
  into a later block*.

### The later lines of a code block's rest read as Markdown

- **What happens:** `<div></div>⏎⏎` and a code block of `x⏎# y`, Delete from
  `<div></div>`@0 to after `x`: the editor shows and saves the heading `# y`.
  A second line `1. y`, `> y` or `- y` becomes a list or a quote. Started in
  a paragraph, the line stays text (`\# y`).
- **Status:** confirmed.
- **Found:** [`plans/implemented/markdown-editor-four-known-issue-fixes.md`](../implemented/markdown-editor-four-known-issue-fixes.md), round 3. Same on its base.
- **Probe:** `impl/known-issues-recheck/part3/tests/line109-literal-rest-reads-as-markdown.test.ts`.
- **Fix size:** medium.
- **Docs:** `MarkdownEditor.md`, as above.

### A joint at a raw list line after a quote line joins the quote

- **What happens:** `- a⏎··- b⏎····> q⏎··- c⏎⏎x→# y`, Delete from the start
  of `··- c` to after `x`, saves `- a⏎··- b⏎····> q⏎·\# y`. The viewer reads
  the last line as a lazy continuation of the quote, whose paragraph becomes
  `q # y`.
- **Status:** confirmed for the lazy join. The entry's second half (the editor
  and its reload differ) did not reproduce on the 2026-10-20 re-check, for
  any start offset 0 to 4, nor at the end of the four-fixes branch.
- **Found:** [`plans/implemented/markdown-editor-four-known-issue-fixes.md`](../implemented/markdown-editor-four-known-issue-fixes.md), round 3. Same on its base.
- **Probe:** `impl/known-issues-recheck/part3/tests/line115-raw-list-line-lazy-quote.test.ts`.
- **Fix size:** medium.
- **Docs:** `MarkdownEditor.md`, as above.

### Four spaces shown after an image, which the save drops

- **What happens:** `<div></div>⏎⏎x····![i](/u.png)`, Delete from
  `<div></div>`@0 to after `x`: the editor shows a space before the image and
  four after it; the save is `![i](/u.png)`. Probably the same cause as the
  leading space above.
- **Status:** confirmed.
- **Found:** [`plans/implemented/markdown-editor-four-known-issue-fixes.md`](../implemented/markdown-editor-four-known-issue-fixes.md), round 3. Same on its base.
- **Probe:** `impl/known-issues-recheck/part3/tests/line118-spaces-before-image.test.ts`.
- **Fix size:** medium.
- **Docs:** `MarkdownEditor.md`, under *Spaces the editor shows that a save
  drops* (as "spaces after an image").

### Pasted HTML loses the space beside an inline form control

- **What happens:** `<li>Agree <input type="checkbox"> to terms</li>` pastes
  as `- Agreeto terms`; a `<p>` with a text input, and a `<button>`, lose the
  space the same way. `<span></span>` in that place keeps it. Lexical's HTML
  import treats `input` and `button` as a block boundary and trims the
  whitespace beside them; the editor would need its own conversion for an
  inline `input`.
- **Status:** confirmed.
- **Found:** the review of [`plans/implemented/markdown-task-lists.md`](../implemented/markdown-task-lists.md). Same on its base.
- **Probe:** `impl/known-issues-recheck/part4/tests/html-paste-input-space.test.ts`
  (runs in jsdom).
- **Fix size:** small to medium.
- **Docs:** `MarkdownEditor.md`.

### A multi-line image with a tab, pasted into a list item

- **What happens:** an image node whose alt text is `a⏎→# d`, pasted as
  Lexical JSON (copied from another editor) into `- q`, saves
  `- q![a⏎··→# d](/i.png)`, which reloads as a raw block, so the image is
  lost. Pasted into `> q` or an item's later paragraph, the reload holds the
  heading `d](/i.png)`. The four-space form now saves correctly.
- **Status:** confirmed (the tab form).
- **Found:** the review of [`plans/implemented/markdown-commonmark-images.md`](../implemented/markdown-commonmark-images.md), round 3. Same on its base.
- **Probe:** `impl/known-issues-recheck/part4/tests/images.test.ts` (its two
  tests that paste a multi-line image into list items, as nodes and through
  the paste command).
- **Fix size:** medium. The written-form check would have to read the form
  inside its container.
- **Docs:** `MarkdownEditor.md`.

### A pasted rule and paragraph right after a task item's checkbox

- **What happens:** `- [x] one`, caret before `one`, paste `<hr><p>two</p>`:
  the item becomes `[x]` as text, the rule and `twoone` go into it, and the
  save is `- \[x\]⏎⏎··---⏎⏎··twoone`. A plain item (`- one`) gives
  `-⏎··---⏎⏎··twoone`. A rule pasted alone goes above the item, which keeps
  its checkbox (`---⏎⏎- [x] one`). The paste listener that handles the rule
  alone does not take a paste that ends in a paragraph.
- **Status:** confirmed.
- **Found:** [`plans/implemented/markdown-eleven-known-issue-fixes.md`](../implemented/markdown-eleven-known-issue-fixes.md).
- **Probe:** `impl/dialect-docs/tests/paste-jsdom.test.ts`.
- **Fix size:** not estimated.
- **Docs:** `MarkdownEditor.md`.

### A carriage-return reference in a task item is saved raw once toggled

- **What happens:** `- [x] a&#13;` saves unchanged; after a click unchecks
  the box, the save is `- [ ] a` followed by a raw U+000D. The viewer reads
  the item as before.
- **Status:** confirmed.
- **Found:** [`plans/implemented/markdown-small-known-issue-fixes.md`](../implemented/markdown-small-known-issue-fixes.md). Same on its base.
- **Probe:** `impl/dialect-docs/tests/editor-entries.test.ts` ("carriage
  return reference after a task item").
- **Fix size:** not estimated.
- **Docs:** `MarkdownEditor.md`.

### A blank before a soft line break shows as an extra space

- **What happens:** `a·⏎b` loads as the text nodes `a·`, a soft-break source
  run shown as a space, and `b`, so the editor shows two spaces; the viewer
  shows `a b`. `a→⏎b` shows the tab the same way, and a list item does the
  same. The unedited save keeps the source.
- **Status:** confirmed.
- **Found:** [`plans/implemented/markdown-small-known-issue-fixes.md`](../implemented/markdown-small-known-issue-fixes.md). Same on its base.
- **Probe:** `impl/dialect-docs/tests/editor-entries.test.ts` ("trailing
  blank before a soft break").
- **Fix size:** not estimated.
- **Docs:** `MarkdownEditor.md`, under *Spaces the editor shows that a save
  drops*.

### An open tag joined into a code span gets backslashes

- **What happens:** `withTagLeftOpen` (`MarkdownEditor.ts`) reads the open
  tag and the joined text without the text before the `<`, so a `<` that
  sits inside a code span still gets its closing `>` escaped. In
  ``- a `<b w⏎··> q⏎⏎ab>c` d`` (a raw list), Delete from after `<b` to after
  `ab` leaves the item ``a `<b\>c\` d``: the editor shows and saves the code
  span's text as `<b\>c\`, where the joined text reads `<b>c`. `<br` with a
  rest of `/>c` gives `<br/\>c\`.
- **Status:** confirmed. The review that logged it had not reproduced it.
- **Found:** the review of [`plans/implemented/markdown-small-known-issue-fixes.md`](../implemented/markdown-small-known-issue-fixes.md), round 1.
- **Probe:** `impl/dialect-docs/tests/editor-entries.test.ts` ("open tag
  joined across an unclosed code span").
- **Fix size:** not estimated; the escape needs to see whether the `<` stands
  in a code span of the whole line.
- **Docs:** `MarkdownEditor.md`, under *A deletion from a raw Markdown block
  into a later block*.

### A lone checkbox with `&#32;` and a raw no-break space

- **What happens (as logged):** `- [x] &#32;` followed by a raw no-break space
  toggles to `- [ ] &nbsp;`, and the reload holds one space less than the
  editor showed.
- **Status:** confirmed, otherwise than logged. On the tip the item loads as a
  lone checkbox (the viewer shows the same), the toggle saves `- [ ] &#32;`,
  and the reload matches what the editor showed. What is left is that the
  raw no-break space is dropped from the file.
- **Found:** the review of [`plans/implemented/markdown-small-known-issue-fixes.md`](../implemented/markdown-small-known-issue-fixes.md), round 2.
- **Probe:** `impl/dialect-docs/tests/editor-entries.test.ts` ("lone checkbox
  with &#32; and a raw no-break space").
- **Fix size:** not estimated.
- **Docs:** not carried: nothing a user sees changes.

## Commands, caret and API

### The caret after a mode switch, on a nested quote's line after a hard break

- **What happens:** in `- > a\⏎··>··cd`, the source carets `··¦>··cd`,
  `··>¦··cd` and `··>·¦·cd` land after the break on the WYSIWYG surface
  (`a⏎¦cd`); in the top-level quote `> a\⏎>··cd` the matching carets land
  before it (`a¦⏎cd`). A top-level quote with an indented `>` and the
  two-space break behave like the nested shape. The break token's span is
  mapped onto the source without skipping the container prefix: in the
  nested shape it ends inside the list indentation. The soft line end in the
  same shape (`- > a⏎··¦>··cd` giving `a·¦cd`) follows the documented rule and
  is not a defect.
- **Status:** confirmed.
- **Found:** the review of [`plans/implemented/markdown-editor-raw-block-range-edits-resumption.md`](../implemented/markdown-editor-raw-block-range-edits-resumption.md), rounds 2 and 3.
- **Probe:** `impl/known-issues-recheck/part1/tests/break-prefix-caret.test.ts`,
  `break-source-spans.test.ts`.
- **Fix size:** medium.
- **Docs:** `MarkdownEditor.md`.

### A quote whose lazy line holds only list markers has no caret places

- **What happens:** in `> a⏎→- -⏎b` no offset of the quote has a place, so
  every source-mode command declines there; the WYSIWYG surface shows the
  quote as one paragraph, `a - - b`. The spaces form (`> a⏎····- -⏎b`) is the
  same, so this is no longer tied to the tab. The blocks around the quote
  act. Of the entry's three tab documents, `- one⏎→two` and `- a⏎→- b c` are
  fixed.
- **Status:** confirmed.
- **Found:** the review of [`plans/implemented/markdown-tab-column-parity.md`](../implemented/markdown-tab-column-parity.md), round 2.
- **Probe:** `impl/dialect-docs/tests/editor-entries.test.ts` ("quote with lazy
  tab list line"); `impl/known-issues-recheck/part1/tests/no-place-scope.test.ts`.
- **Fix size:** medium.
- **Docs:** `MarkdownEditor.md`.

### Source-mode commands decline on text whose container prefix holds a tab

- **What happens:** in source mode, bold and link do nothing on some words of
  a list item or a quote whose prefix holds a tab, where the same document
  written with spaces acts, and some lines lose their caret places. On the
  tip every remaining case is one where the spaces form rewrites more than
  the word (for example it turns an indented code block into a fenced one),
  so declining is the safer result. Typical documents are generated ones such
  as `` →>→[·]→`c→d`⏎·→··>·y·z⏎>>·#→h⏎→>·>→w `` (bold on `h` declines).
  The simple cases the re-check named now act: `- a⏎⏎→→code` and
  `> a⏎>⏎>→→code` bold `a` (rewriting the code block as fenced code).
- **Status:** confirmed. Re-measured on the tip over the tab-column review's
  3,161 generated documents in their tab and spaces forms: 72 bold runs and
  72 link runs in 18 documents decline where the spaces form acts, all of
  them runs where the spaces form rewrites more than the word; 390 lines lose
  caret places the spaces form keeps (289, plus 101 where the two forms read
  differently). The measurement taken for
  `feature/markdown-eleven-known-issue-fixes` gave the same 72 runs.
- **Found:** caused by [`plans/implemented/markdown-tab-column-parity.md`](../implemented/markdown-tab-column-parity.md), accepted at its review cap.
- **Probe:** `impl/dialect-docs/tests/entry43-tab-measure.test.ts`, which
  measures caret places and the bold and link commands in both forms of every
  generated document, run in 8 parts; the results are in `impl/dialect-docs/measure43/compare.txt`. The
  documents are `impl/tab-column/review3/out/docs.json`.
- **Fix size:** large.
- **Docs:** not carried: no short example, and the decline protects the text.

### Undo grouping after a space typed at a line's start

- **What happens:** the editor drops a space typed at a line's start. A
  two-character input-method commit (`あい`) or an emoji 10 ms after such a
  space undoes in one step; the same script with `w` first takes two. A
  composition, three spaces then Backspace then typing, and Backspace 400 ms
  later gave equal counts. Undo always restores the document. A structural
  fix (the drop as a separate merged update) fails, since Lexical's history
  records the drop as a deletion.
- **Status:** confirmed.
- **Found:** caused by [`plans/implemented/markdown-editor-reload-differences.md`](../implemented/markdown-editor-reload-differences.md), accepted at its review
  cap.
- **Probe:** `impl/known-issues-recheck/part2/tests/entry71-undo-grouping.test.ts`,
  which counts undo steps for each typing script with a space first and with
  a letter first.
- **Fix size:** large.
- **Docs:** `MarkdownEditor.md`.

### Source-mode commands decline in a block holding several empty children

- **What happens:** with the caret on the second line of `-⏎-⏎-`, Heading 2,
  the list toggles and Insert image change nothing; with a single `-`,
  Heading 2 gives `##`. A body cell of a fresh empty table and two empty
  `:::` columns are the same. The code does not yet work out which child the
  caret's line names; the tip's own tests keep this as an intended decline.
- **Status:** confirmed.
- **Found:** [`plans/implemented/markdown-source-mode-commands-through-model.md`](../implemented/markdown-source-mode-commands-through-model.md), accepted.
- **Probe:** `impl/known-issues-recheck/part3/tests/line083-source-commands-several-empty-children.test.ts`;
  `impl/dialect-docs/tests/editor-entries.test.ts` ("several empty children").
- **Fix size:** medium.
- **Docs:** `MarkdownEditor.md`.

### `insertRawText` throws at an element caret on a quote

- **What happens:** Lexical's `RangeSelection.insertRawText` with an element
  caret on the quote node of `> a⏎>⏎> b` (offset 1) throws "Expected node
  MarkdownQuoteNode of type markdown-quote to have a block ElementNode
  ancestor", as it already did on a list item. The editor's own `paste()` at
  that caret works (`> a⏎>⏎> Z⏎>⏎> b`).
- **Status:** confirmed.
- **Found:** the review of [`plans/implemented/markdown-editor-quote-node.md`](../implemented/markdown-editor-quote-node.md), round 3. Older; now also reachable in
  quotes.
- **Probe:** `impl/known-issues-recheck/part3/tests/line087-insert-raw-text-quote.test.ts`.
- **Fix size:** small.
- **Docs:** not carried: Lexical's API, not the component's.

### A list item that opens with a rule and holds a nested list loads as a raw block

- **What happens:** `a⏎⏎- ***⏎··- n` loads as a raw block, while the viewer
  shows a list whose item holds the rule and a nested list. `- ***` alone,
  `- ***⏎- n` and `- x⏎⏎··***⏎··- n` load as rich lists. Nothing is lost.
- **Status:** confirmed.
- **Found:** [`plans/implemented/markdown-horizontal-rules.md`](../implemented/markdown-horizontal-rules.md). Same on its base.
- **Probe:** `impl/known-issues-recheck/part3/tests/line123-rule-item-nested-list-raw.test.ts`.
- **Fix size:** medium.
- **Docs:** `MarkdownEditor.md`.

### A source-mode caret on a lone checkbox's line acts on the next item

- **What happens:** in `- [x] &#32;⏎- b`, Heading 2 at source offsets 2 to 11
  (from the `[` to the line's end) gives `- [x] &#32;⏎⏎## b`; at offsets 0 and
  1 it acts on the first item (`## \[x\]⏎⏎- b`).
- **Status:** confirmed.
- **Found:** [`plans/implemented/markdown-small-known-issue-fixes.md`](../implemented/markdown-small-known-issue-fixes.md). Same on its base.
- **Probe:** `impl/dialect-docs/tests/editor-entries.test.ts` ("caret on a lone
  checkbox line").
- **Fix size:** not estimated.
- **Docs:** `MarkdownEditor.md`.

### `insertImage` at an element caret on a table or a row

- **What happens:** with an element caret set by code on a table node or a
  table row (offset 0), `insertImage('/i.png')` changes nothing and moves the
  caret one level down (table to row, row to cell); `canInsertImage` is
  `true` there.
- **Status:** confirmed.
- **Found:** [`plans/implemented/markdown-small-known-issue-fixes.md`](../implemented/markdown-small-known-issue-fixes.md). Same on its base.
- **Probe:** `impl/dialect-docs/tests/editor-entries.test.ts` ("insertImage at
  an element caret on a table or a row").
- **Fix size:** not estimated.
- **Docs:** `MarkdownEditor.md`.

### `insertHorizontalRule` over a range with a rule at an end, settling into a code block

- **What happens (as logged):** the insert removes the rule and inserts
  nothing.
- **Status:** confirmed, otherwise than logged. In `---⏎⏎```⏎c⏎```⏎⏎---`, a
  root range over the first rule (root@0..1, either direction) leaves the
  document unchanged and moves the caret to the start of the code; a range
  over the last rule (root@2..3) leaves the saved text unchanged and adds an
  empty paragraph after the rule, which takes the caret.
  `canInsertHorizontalRule` is `true` in both. No rule is removed: a sweep of
  2,068 ranges over three-block documents of paragraphs, rules, code blocks
  and quotes found no lost rule beside a code block. What is left is the
  pattern of the `canInsertTable` entry below.
- **Found:** [`plans/implemented/markdown-small-known-issue-fixes.md`](../implemented/markdown-small-known-issue-fixes.md)'s insert sweep ("2 rule-case
  runs after").
- **Probe:** `impl/dialect-docs/tests/rule-case.test.ts`,
  `impl/dialect-docs/tests/rule-insert-sweep.test.ts`.
- **Fix size:** not estimated.
- **Docs:** `MarkdownEditor.md`, folded into the `canInsertTable` entry.

### The dirty flag of an editor loaded in source mode before it is shown

- **What happens:** a `MarkdownEditor` built in `"source"` mode whose document
  is replaced with `setValue()` before its source `CodeEditor` mounts reports
  `isDirty()` `false` after that `setValue()`, and `true` after
  `setMode('wysiwyg')`, even with `markClean()` in between. Built with the
  document as its `value`, it stays clean; `markClean()` after the switch
  clears it.
- **Status:** confirmed, and wider than logged: the entry named an editor
  built with `''`, but any constructed value does it, and the first half
  (no dirty flag after `setValue`) was not in the entry.
- **Cause (by reading):** `CodeEditor.setValue` before mount updates only its
  cached value and fires no `"change"`, so `MarkdownEditor.onDocChange` never
  runs: `_options.value` keeps the constructed document and the dirty flag is
  not set. The Lexical editor built at the switch then likely starts from the
  stale `_options.value` and loads the real text as a change.
- **Found:** [`plans/implemented/markdown-small-known-issue-fixes.md`](../implemented/markdown-small-known-issue-fixes.md). Same on its base.
- **Probe:** `impl/dialect-docs/tests/dirty.test.ts`, `dirty2.test.ts`
  (offline, which is the before-mount case).
- **Fix size:** not estimated.
- **Docs:** `MarkdownEditor.md`.

### `canInsertTable` and `canInsertHorizontalRule` report `true` where the insert declines

- **What happens:** with an element caret set by code on a `:::` block at
  offset 0, right before a table (`::: {align=center}⏎| a | b |⏎| - | - |⏎| c | d |⏎:::`),
  both fields are `true`, and `insertTable(2, 2)` and `insertHorizontalRule()`
  change nothing. Since `feature/markdown-small-known-issue-fixes` the command
  settles, declines and restores
  the selection; the fields still read the unsettled selection, so a menu item
  or toolbar button stays enabled and does nothing. Reading them on a settled
  clone needs a `selection` parameter on six helpers.
- **Status:** confirmed.
- **Found:** [`plans/implemented/markdown-small-known-issue-fixes.md`](../implemented/markdown-small-known-issue-fixes.md).
- **Probe:** `impl/dialect-docs/tests/editor-entries.test.ts` ("canInsertTable
  where the insert declines").
- **Fix size:** small (about 25 lines, by the plan's estimate).
- **Docs:** `MarkdownEditor.md`.

## Source-mode colouring

Each of these is colour only: source-mode commands read with the viewer's
parser, so the text and the save are not affected.

### A `>` indented four or more columns on a quote's later line

- **What happens:** in `> a⏎····>→#→h`, source mode colours the second line as
  a heading in the quote; the viewer and CommonMark read more text of the
  quote's paragraph, `a > # h`. The spaces form reads a heading too. Lezer's
  quote continuation has no indent check.
- **Status:** confirmed.
- **Found:** the review of [`plans/implemented/markdown-source-mode-tab-highlighting.md`](../implemented/markdown-source-mode-tab-highlighting.md), round 1. The spaces form disagrees
  on its base too.
- **Probe:** `impl/known-issues-recheck/part2/tests/grammar-readings.test.ts`
  (its test of a `>` indented four columns, tab and spaces forms);
  `impl/dialect-docs/tests/viewer-and-grammar.test.ts` ("quote > indented
  four").
- **Fix size:** medium.
- **Docs:** `MarkdownEditor.md`.

### A `:::` line inside a link's text swallows the link

- **What happens:** source mode reads `[a⏎::: b](u)` as the paragraph `[a` and
  a gold `:::` line `::: b](u)`; the viewer reads one paragraph with a link.
  `endsLeafAtFenceLine` in `markdownSourceSyntax.ts` lets any `:::` line end
  the paragraph above it, where in the viewer a `:::` line never interrupts a
  paragraph.
- **Status:** confirmed.
- **Found:** the review of [`plans/implemented/markdown-source-mode-syntax-colours.md`](../implemented/markdown-source-mode-syntax-colours.md), round 1.
- **Probe:** `impl/known-issues-recheck/part4/tests/source-mode-readings.test.ts`
  (its row of a `:::` line inside link text), `colon-fence-interrupt.test.ts`.
- **Fix size:** medium (shared with the next entry).
- **Docs:** `MarkdownEditor.md`.

### A `:::` line right under paragraph text splits the paragraph

- **What happens:** a code span across a `:::` line (`` `a⏎::: b` ``), an
  HTML tag (`a <span⏎::: b>`) and a setext underline (`:::⏎===`, a heading in
  the viewer) are not closed in source mode, which ends the paragraph at the
  `:::` line. Same cause as the entry above.
- **Status:** confirmed.
- **Found:** the review of [`plans/implemented/markdown-source-mode-syntax-colours.md`](../implemented/markdown-source-mode-syntax-colours.md), round 3.
- **Probe:** as above (its rows of a code span, an HTML tag and a setext
  underline across a `:::` line).
- **Fix size:** medium.
- **Docs:** `MarkdownEditor.md`.

### A table whose delimiter row starts with `- `

- **What happens:** `a | b⏎- | -⏎c | d` is a table in the viewer; source mode
  reads a paragraph and a bullet list, since lezer's list start wins over the
  dialect's table parser (lezer's own GFM table has the same limit). The
  entry's other half (`| a \| b |` over `| - | - |`) no longer differs: both
  read a paragraph.
- **Status:** confirmed (the delimiter-row half).
- **Found:** the review of [`plans/implemented/markdown-source-mode-syntax-colours.md`](../implemented/markdown-source-mode-syntax-colours.md), round 3.
- **Probe:** `impl/known-issues-recheck/part4/tests/source-mode-readings.test.ts`
  (its rows of the `- | -` delimiter row and of escaped pipes).
- **Fix size:** small to medium.
- **Docs:** `MarkdownEditor.md`.

### A list item that starts with a blank line runs over a later indented line

- **What happens:** in `9.⏎⏎···j` source mode's parser reads `j` inside the
  item; the viewer and CommonMark end the empty item at the blank line and
  read `j` as a paragraph. `-⏎⏎··j` is the same.
- **Status:** confirmed.
- **Found:** the review of [`plans/implemented/markdown-eleven-known-issue-fixes.md`](../implemented/markdown-eleven-known-issue-fixes.md), round 1. Older.
- **Probe:** `impl/dialect-docs/tests/viewer-and-grammar.test.ts` ("item
  starting blank").
- **Fix size:** not estimated.
- **Docs:** `MarkdownEditor.md`.

### `a` over a single `-` inside a list item

- **What happens:** source mode reads `- a⏎··-` as an item holding `a` and an
  empty nested list; the viewer and CommonMark read `a` as a level 2 setext
  heading in the item.
- **Status:** confirmed.
- **Found:** [`plans/implemented/markdown-small-known-issue-fixes.md`](../implemented/markdown-small-known-issue-fixes.md). Same on its base.
- **Probe:** `impl/dialect-docs/tests/viewer-and-grammar.test.ts` ("a over
  single dash in item").
- **Fix size:** not estimated.
- **Docs:** `MarkdownEditor.md`.

## Viewer

### The column splitter reads a code fence at any indentation

- **What happens:** `readFenceLine` in `markdownAttributes.ts` trims the line
  before it looks for a code fence, so it takes a ```` ``` ```` at any
  indentation for a fence opener, where CommonMark and `marked` take one only
  at up to three spaces. `::: columns⏎left⏎⏎····```⏎⏎|||⏎⏎right⏎:::` shows no
  columns: the paragraph `::: columns left`, a code block, and `|||` and
  `right :::` as paragraphs. With `····xx` the fence shows two columns, and
  so does the same code fenced with `~~~`.
- **Status:** confirmed.
- **Found:** the review of [`plans/implemented/markdown-editor-nested-source-preservation.md`](../implemented/markdown-editor-nested-source-preservation.md), round 2. Older than the branch;
  its keep checks treat it conservatively.
- **Probe:** `impl/known-issues-recheck/part3/tests/line085-column-fence-indent.test.ts`;
  `impl/dialect-docs/tests/column-fence.test.ts` (the `~~~` form).
- **Fix size:** small.
- **Docs:** `Markdown.md`.

### Emphasis, strikethrough and underline pair across a code span that ends in a backslash

- **What happens (as logged):** the viewer pairs `~~` (and `++`, whose
  tokenizer copies `marked`'s order) across a backtick a code span should
  claim: `` \**~~`~~*_++` `` strikes over the backtick.
- **Status:** confirmed, otherwise than logged. The logged example now reads
  as CommonMark reads it (`**~~` and the code `~~*_++`), and an exhaustive
  sweep of 61,961 short documents over `~~`, `++`, a backtick, `*`, `\*`,
  `a` and a space found no other code-span difference from commonmark.js.
  The defect remains for a code span whose text ends in a backslash: `marked`
  masks the escape `` \` `` before it masks code spans, so a run before the
  code span pairs with the same run inside it. ``a ~~b `c~~\` d`` strikes
  ``b `c`` and shows `` ` d ``, where CommonMark shows `~~b` and the code
  `c~~\`. `*`, `**`, `_` and `++` do the same
  (``a *b `c*\` d`` is italic ``b `c``). Escaping the outer run
  (``a \~~b `c~~\` d``) or closing it before the code span reads correctly.
  The editor shows the same, as it reads with the viewer's parser.
- **Found:** the review of [`plans/implemented/markdown-eleven-known-issue-fixes.md`](../implemented/markdown-eleven-known-issue-fixes.md), round 3. Older.
- **Probe:** `impl/dialect-docs/tests/strike-code-sweep.test.ts` (the sweep and
  a random sweep), `strike-examples.test.ts`.
- **Fix size:** not estimated; the fix is in the pairing step's masking order,
  which `marked` owns for `~~`, `*` and `_`.
- **Docs:** `Markdown.md`.

### A whitespace-only line holding a tab, in fenced code inside a quote

- **What happens:** in a quote, a fenced code line holding only spaces and
  tabs, with a tab among them, loses its whitespace: `` > ``` ``⏎`>·→`⏎`` > ``` ``
  gives an empty code block where CommonMark keeps the tab, and
  `` > ``` ``⏎`> x`⏎`>·→`⏎`` > ``` `` gives `x` and an empty line. With spaces
  alone (`>····`) the whitespace is kept, and outside a quote a tab-holding
  blank line keeps its tab (a decision of the eleven-known-issue-fixes plan).
- **Status:** confirmed. The review's tab-code fuzz (seed 5, 3,000 documents)
  still flags documents of this shape against markdown-it; its count is not
  comparable with the logged "41 of 2,128", since the fuzz compares the
  harness model, which drops a code block's trailing blank line.
- **Found:** the review of [`plans/implemented/markdown-eleven-known-issue-fixes.md`](../implemented/markdown-eleven-known-issue-fixes.md), round 3. Older.
- **Probe:** `impl/dialect-docs/tests/strike-code-sweep.test.ts` ("fence in a
  quote ending in a blank quoted line"), `tab-code-fuzz.test.ts`.
- **Fix size:** not estimated.
- **Docs:** `Markdown.md`.

### Where an HTML block starts: `meta`, and a tab after the tag name

- **What happens:** `meta` is in `marked`'s condition-6 tag list but not in
  CommonMark 0.31.2's, so `a⏎<meta x="y">⏎b` gives the paragraph `a` and an
  HTML block `<meta x="y">⏎b`, where commonmark.js reads one paragraph. A tag
  name followed by a tab (`<div→class="x">⏎b`, `<div→⏎b`, `<p→class="x">`)
  starts no HTML block at all: the lines are paragraph text, where CommonMark
  starts an HTML block (condition 6 allows any whitespace after the name). A
  space after the name reads correctly.
- **Status:** confirmed for `meta`; confirmed, otherwise than logged, for the
  tab: the entry said such a block never ends at a blank line, while on the
  tip it is no HTML block in the first place.
- **Found:** [`plans/implemented/markdown-small-known-issue-fixes.md`](../implemented/markdown-small-known-issue-fixes.md)'s HTML block sweep against
  commonmark.js (19,040 documents; the remaining differences were a tab after
  the tag name, `meta`, and an item's content column). Same on its base.
- **Probe:** `impl/dialect-docs/tests/viewer-and-grammar.test.ts` ("meta …",
  "div tab blank"), `div-tab.test.ts`.
- **Fix size:** not estimated.
- **Docs:** `Markdown.md`.

## Menus

### A checkable plain `MenuItem` has no checked state for assistive technology

- **What happens:** a `MenuItem` whose config sets `checked` shows a ✓ glyph,
  but its row's role stays `menuitem` (`MenuItem.ts` sets it unconditionally)
  and no `aria-checked` is written. `checked` covers both a toggle and a
  choice, so the right role (`menuitemcheckbox` or `menuitemradio`) needs a
  new config field. Users in the Markdown components: the table-cell context
  menu's Align column submenu (`MarkdownEditor.ts`, the `checked` rows of the
  alignment submenu builder) and `MarkdownDocumentPanel`'s Align column,
  Alignment and Columns dropdowns. The format toggles and Text style presets
  use `CheckboxMenuRow` and `RadioMenuRow`, which
  `feature/markdown-small-known-issue-fixes` fixed.
- **Status:** confirmed by reading the code.
- **Found:** [`plans/implemented/markdown-small-known-issue-fixes.md`](../implemented/markdown-small-known-issue-fixes.md).
- **Fix size:** small, plus the config-field decision.
- **Docs:** `MarkdownEditor.md`.

### A MenuBar menu stayed open after its page's route changed

- **What happens (as logged):** in the demo, a MenuBar menu stayed open after
  the page's route changed.
- **Status:** not checked: not investigated, here or when it was logged.
  Checking it needs the demo in a browser.
- **Fix size:** unknown.
- **Found:** [`plans/implemented/markdown-small-known-issue-fixes.md`](../implemented/markdown-small-known-issue-fixes.md). Same on its base.
- **Docs:** not carried (not a Markdown component, and unconfirmed).

## Internal: the test harness and the code

### The reload differential's unexplained steps

- **What happens:** the reload differential (random edit steps, each compared
  with a reload of its save) had 34 steps its classifier `rich.py` could not
  explain. On the 2026-10-20 re-check 32 remained, of two kinds, and both
  still reproduce on the tip by direct repro:
  - 28 steps: typing or pasting over a range across both columns of
    `::: columns⏎- a0⏎- a1⏎|||⏎- s0⏎⏎- s1⏎:::` leaves one column. The save
    writes `::: {}`, but the editor's node state still remembers the opening
    text `·columns`. Only that hidden state differs.
  - 4 steps: in an HTML block in a list item that a paste turned into a
    paragraph (`x0<div>⏎x13`), Shift+Enter after `<div>` makes the editor show
    a space at the start of the next line, which the save drops; with a
    letter typed first (`z<div>`) the editor also shows `<div>` as an HTML
    token while the save escapes it as text.
  The classifier has no rules for the later branches, so its total on the
  re-check's tip (882 unexplained) is not comparable: 461 of those are empty
  task items reloading as text (by design), 234 differ only in a checkbox's
  hidden marker state, 55 are the leading space above, 56 the HTML-token kind,
  and 44 pastes into an HTML block in a list item were not classified. The
  full differential was not run again on this tip.
- **Status:** confirmed (the two kinds).
- **Probe:** `impl/known-issues-recheck/part2/tests/entry67-cases.test.ts`
  (direct repros of the two kinds); `entry67-reload-differential.test.ts` with `reload/run.sh`
  for the full run, and `reload/unexplained.py` to list the steps.
- **Fix size:** small.
- **Docs:** not carried (the 4-step kind is covered by *Spaces the editor
  shows that a save drops*).

### Two source-mode comparison mismatches hidden by the corpus order

- **What happens:** the corpus differential in
  `markdown-source-mode-through-model.test.ts` ("the corpus differential")
  picks each document's commands by its position in `CORPUS`, so adding a row
  moves every later document onto other commands and exposes source-mode
  results that differ from the WYSIWYG ones. With one extra row at the front,
  the tip reports two: `CommonMark 587 (Images)` with Heading 2 at 3..3 (the
  caret lands at 3..3 against 4..4) and `loose task list with a nested item
  and a paragraph` with the numbered toggle at 23..27 (caret 3..3 against
  3..4). The logged second mismatch, `loose list ending in a blank line` with
  the bulleted toggle, depends on which command a shift assigns; that shift
  did not reach it. New reading rows therefore go in lists of their own
  outside the corpus (`TAB_CODE_CASES`).
- **Status:** confirmed for `CommonMark 587`; the other exposed mismatch is a
  different document than logged.
- **Found:** [`plans/implemented/markdown-eleven-known-issue-fixes.md`](../implemented/markdown-eleven-known-issue-fixes.md).
- **Probe:** `impl/dialect-docs/tests/differential-extra-row.test.ts` (a copy of
  the tip's test with one corpus row added; run with
  `-t 'corpus differential'`), output in `impl/dialect-docs/rerun/differential-extra-row.log`.
- **Fix size:** not estimated.
- **Docs:** not carried.

### No-break spaces read as whitespace in source runs and writable checks

- **What happens:** `appendSourceNode` (`markdownImporter.ts`) shows a source
  run's text with `display.replace(/\s+/g, " ")`, and JavaScript's `\s`
  matches U+00A0, so a no-break space in a source run shows as a plain space.
  `markdownWritable.ts` tests `/\S/` in two places (in the whitespace-edge
  pass over the leaves near a selection, and in the format check that reads a
  source text node's source), where a no-break space should count as
  content; the library's rule elsewhere (`holdsLineContent` in
  `display/markdownLineContent.ts`) counts it as content.
- **Status:** confirmed by reading the code. No user-visible case was looked
  for.
- **Found:** [`plans/implemented/markdown-small-known-issue-fixes.md`](../implemented/markdown-small-known-issue-fixes.md). Same on its base.
- **Fix size:** not estimated.
- **Docs:** not carried.

## Resolved on this check

One entry of the working list did not reproduce on the tip and is kept here
only as a record; it is not counted among the open defects above.

### An HTML block in an item with a tab line, and CRLF documents, lose caret places

- **What happens (as logged):** in `- a⏎⏎··<div>⏎→x⏎··</div>` no offset of the
  list has a place; a CRLF document built offline loses every place.
- **Status:** did not reproduce. On the tip the tab form has the places the
  spaces form has (only the blank lines lack one, in both), and bold on `a`
  acts in source mode. A source-mode editor built offline with
  `a b\r\nc d\r\n\r\ne f` bolds `a`, `c` and `e`. The CRLF half was fixed by
  `feature/markdown-small-known-issue-fixes` (the `\r\n` line ends are
  normalised before mount); the HTML half by one of the branches after the
  2026-10-20 re-check.
- **Found:** the review of [`plans/implemented/markdown-tab-column-parity.md`](../implemented/markdown-tab-column-parity.md), round 3.
- **Probe:** `impl/dialect-docs/tests/editor-entries.test.ts` ("HTML block in an
  item with a tab line", "CRLF before mount"). The re-check's
  `no-place-scope.test.ts` still prints missing places for the CRLF
  document, but it measures offsets against the CRLF text while the editor
  holds the `\n` text.
- **Docs:** not carried.
