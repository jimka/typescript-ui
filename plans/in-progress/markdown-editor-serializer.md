---
depends-on:
  - markdown-viewer-link-reference-definitions
  - markdown-roundtrip-harness
  - markdown-viewer-hard-breaks
  - markdown-source-mode-editing
  - markdown-source-mode-styled-spans
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts
---

# Markdown Editor Serializer — Implementation Plan

## Overview

`MarkdownEditor` saves its Lexical document through `@lexical/markdown`'s
`$convertToMarkdownString(TRANSFORMERS)`. That exporter escapes text by its own
rules, closes and reopens emphasis around links, and splits a styled span at
every format change. This plan writes the replacement: our own serializer from
Lexical nodes to Markdown, with escaping designed against the viewer's `marked`
grammar ([`lexMarkdown`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L393)).

It is the first of four plans that replace the editor's Markdown import and
export:

| # | Plan | What it does |
|---|---|---|
| 1 | `markdown-editor-serializer` (this) | serializer module, unit-tested, no production caller |
| 2 | `markdown-editor-marked-import` | importer from `marked` tokens, new nodes, cut-over of every import and export site, transformer removal |
| 3 | `markdown-editor-reference-links` | reference links and definitions |
| 4 | `markdown-editor-source-preservation` | unchanged blocks save byte-for-byte |

The new module is `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts`,
with a small companion, `markdownNodeState.ts`, holding the node state the
serializer reads. It covers every node the editor holds today. Nothing calls it from production
code until plan 2, so this plan changes no behaviour and flips **no** entry of
the round-trip harness baseline (`tests/component/markdown-roundtrip/corpus/divergences.ts`).
The only existing file it changes is
[`markdownTableTransformer.ts`](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L135),
whose `formatDelimiterRow` moves into the new module.

**Base.** The stack is `master` → `markdown-source-mode-editing` →
`markdown-source-mode-styled-spans` → `markdown-viewer-link-reference-definitions`
→ `markdown-roundtrip-harness` → `markdown-viewer-hard-breaks` → this plan.
Line numbers for `MarkdownEditor.ts` are as of the styled-spans tip
`64d79105`; other files are unchanged by those branches.

---

## Architecture Decisions

### A module of `$`-functions over the node tree

`markdownSerializer.ts` exports `$serializeMarkdown()`, which reads `$getRoot()`
inside an `editor.read` or `editor.update`. It mirrors `@lexical/markdown`'s
own `$convertToMarkdownString`, the function it replaces: a `$`-prefixed walk
over the active editor state with no component, no DOM and no options.[^module-shape]
Internal helpers stay unexported, except `formatDelimiterRow`, which the table
transformer imports until plan 2 deletes that transformer.

### The output matches the current exporter wherever the current exporter is right

For every construct the current exporter writes correctly, the serializer writes
the same bytes: `#` headings, `- ` bullets, `1.` numbering from the list's
start, `**` / `*` / `~~` / `++` / `` ` `` markers, `> ` quotes, ` ``` ` fences,
`| a | b |` table rows with the existing delimiter-row and merge-marker
format, `::: …` fences, `![alt](src){…}` images, and blocks joined by one
blank line with no trailing newline.[^byte-compat] A step-1 test compares the
two exporters on `markdown-editor.test.ts`'s 22-document `CORPUS`.

The serializer departs from the current exporter only where the current output
is wrong or lossy. Each departure is a row in `## Expected Behaviour`:

| Construct | Current exporter | Serializer |
|---|---|---|
| emphasis around a link (`*foo [bar](/url)*`) | `*foo* [*bar*](/url)` | `*foo [bar](/url)*` |
| styled span holding a bold run | `[red ]{color=red}[**b**]{color=red}` | `[red **b**]{color=red}` |
| bold styled span | span written inside, bold dropped on reload | `**[s]{color=red}**` |
| a literal `\` | escaped again on every save | escaped only where the table below says |
| `1. ` at the start of a paragraph | written raw (becomes a list) | `1\. ` |
| `LineBreakNode` made by Shift+Enter | `\n`, a soft break the viewer flows | `\` + newline, a hard break the viewer renders (after `markdown-viewer-hard-breaks`) |
| nested list under `- ` | four spaces | two spaces (the marker width plus one) |

### Escaping is decided per character, against `marked`'s inline and block rules

Text is written so that `lexMarkdown` reads it back as the same characters, with
no marks, links or blocks the editor did not hold. The rules escape only where a
character could change meaning, so ordinary prose stays readable.[^escape-why]

| Character | Escaped as `\x` when |
|---|---|
| `` ` `` `*` `~` `[` `]` | always |
| `\` | the next output character is ASCII punctuation, or it ends the text run or the line |
| `_` | it does not sit between two letters or digits (`snake_case` stays) |
| `<` | the next character is a letter, `/`, `!` or `?` (a tag or autolink start) |
| `+` | a neighbouring character is `+` (`++` is underline) |
| `\|` | always inside a table cell |
| `:` | it is the `:` of `http://`, `https://` or `ftp://`, in any letter case (blocks GFM's bare-URL autolink) |
| `.` | it is the first `.` of a word starting `www.`, in any letter case |
| `@` | it joins an email-shaped local part and domain |

At the start of every output line of a paragraph, of a quote (after its `> `)
and of a list item (after its marker or indent), leading spaces and tabs are
dropped and one more rule applies. Heading content and table cells never start
a line, so they skip it:

| Line starts with | Written as |
|---|---|
| one of `#` `>` `-` `+` `*` `=` `\|` `:` `~` `` ` `` | that character escaped (`\#`, `\-`, …) |
| 1–9 digits then `.` or `)` | the `.` or `)` escaped (`1\. `) |
| anything else | unchanged |

Trailing spaces and tabs at the end of a text run that ends an output line are
dropped, so text never turns into a hard break; a `LineBreakNode`'s own space
marker is written after that trimming.

| Text node | Written | Why |
|---|---|---|
| `snake_case_word` | `snake_case_word` | intraword `_` cannot open emphasis |
| `_init_ and *x*` | `\_init\_ and \*x\*` | both could open emphasis |
| `a ++ b ++ c` | `a \+\+ b \+\+ c` | `++…++` is underline |
| `see <b> and a < b` | `see \<b> and a < b` | only a tag-shaped `<` |
| `https://e.com/a_b` | `https\://e.com/a_b` | plain text must not autolink |
| `1. not a list` (paragraph start) | `1\. not a list` | would start an ordered list |
| `C:\path\x` | `C:\path\x` | `\` before a letter is literal |
| `&amp; &#35;` | `&amp; &#35;` | the viewer shows entity source as text; no escape needed |

### A `LineBreakNode` is a hard break that keeps its authored marker

A `LineBreakNode` writes its *marker* — `\` or a run of two or more spaces —
then a newline. The marker is node state, `hardBreakMarkerState`, defaulting to
`\`, so a break made by Shift+Enter writes `\` + newline and an imported
`foo   ` break (plan 2 sets the state) writes its three spaces back. This is the
mechanism `@lexical/markdown` itself uses (`hardLineBreakState` on the
`LineBreakNode`), under our own key.[^break-marker]

| Context | `LineBreakNode` writes |
|---|---|
| paragraph, quote, list item | marker + `\n` |
| no non-whitespace content before it, or none after it, in the same block | nothing (CommonMark ignores a break at a block edge) |
| heading | one space |
| table cell | the cell break (`\n` as two characters) |

### Emphasis is written with a mark stack that runs across links and spans

Inline content is first flattened into *segments* — one per text node, image,
line break, or other leaf — each carrying its marks (`bold`, `italic`, `strike`,
`underline`; `code` is handled separately), its span style, and its enclosing
link. A link or a styled span is a *group*: a run of consecutive segments with
the same link (or the same style inside one link), written `[…](…)` or `[…]{…}`.
Marks are opened and closed with a stack, outermost first, in the fixed order
`bold, italic, strike, underline`.[^mark-stack]

The stack rules:

1. Before a segment, close stack entries from the top down to (and including) the
   lowest one the segment does not carry; then open the segment's missing marks
   in the fixed order.
2. A mark open outside a group stays open across it only when every segment of
   the group carries it; otherwise it closes before the group's `[`.
3. Inside a group the stack starts empty and is closed before the group's `]`.
4. Whitespace at the edges of a marked run is written outside its delimiters.
5. A `code` segment is written as a code span inside the current marks;
   adjacent code segments with identical other marks share one span.

| Segments (text, marks, link) | Written |
|---|---|
| `foo ` *i*, `bar` *i* @`/url` | `*foo [bar](/url)*` |
| `both` *b,i* | `***both***` |
| `bold ` *b*, `next` | `**bold** next` |
| `a` *b*, `b` *b,i*, `c` *b* | `**a*b*c**` |
| `x` *b,code* | ``**`x`**`` |
| `red ` style red, `b` *b* style red | `[red **b**]{color=red}` |
| `s` *b* style red | `**[s]{color=red}**` |

### Constructs CommonMark cannot express are written lossily, never invalidly

A few editor states have no Markdown form in this dialect. The serializer
degrades them to valid Markdown that loses only the formatting named:

| Editor state | Written | Lost |
|---|---|---|
| styled text containing `[` or `]` | the bracket characters outside the span | their colour/font/size |
| underlined text containing `+` | the `+` outside the `++…++` | its underline |
| image alt containing `[` or `]` | alt with the brackets removed | the brackets |
| emphasis that cannot flank (`a**"q"**b`) | delimiters written as the stack rules say | the emphasis, on reload |

---

## Public API

No public (barrel) export changes. Module surface of the new file:

```typescript
// component/editor/markdownSerializer.ts
export function $serializeMarkdown(): string;
export function formatDelimiterRow(alignments: ElementFormatType[], widths: readonly (number | null)[]): string;

// component/editor/markdownNodeState.ts
export const hardBreakMarkerState: StateConfig<"mdBreakMarker", string>;
// createState("mdBreakMarker", { parse: (value) => typeof value === "string" && /^(\\| {2,})$/.test(value) ? value : "\\" })
```

`formatDelimiterRow` keeps its current signature and JSDoc, moved verbatim from
`markdownTableTransformer.ts`.

---

## Implementation

### Block serialization

`$serializeMarkdown()` returns `serializeBlockList($getRoot().getChildren())`.
`serializeBlockList(nodes)` serializes each node, drops results that are `""`,
and joins the rest with `"\n\n"`.

| Node | Written |
|---|---|
| `ParagraphNode` | inline content |
| `HeadingNode` (`hN`) | `#`×N, then `" " + content` when content is non-empty; inline context `singleLine` |
| `QuoteNode` | each line of the inline content prefixed `"> "` (an empty line `">"`); empty quote `">"` |
| `CodeNode` | fence, language, `\n`, text, `\n`, fence — see below |
| `ListNode` | see *Lists* |
| `TableNode` | see *Tables* |
| `MarkdownBlockNode` | see *Fences* |
| any other element | `serializeBlockList(children)` |
| any other node | its `getTextContent()` |

Heading content that ends in a space followed by `#`s, or consists only of
`#`s, escapes the first of those `#`s (`# foo \#`, `# \##`), since a closing
`#` run is stripped by the heading rule.

**Code.** The fence is three backticks, lengthened by one while any line of the
code text starts (after up to three spaces) with that many backticks. The
language is `getLanguage()` or nothing. Empty code text writes the fence, a
newline, and the closing fence.

**Lists.** The marker is `-` for a bullet list and `${start + index}.` for a
number list (`getStart()`). Each item writes its inline content after
`marker + " "`; continuation lines (soft breaks) are indented by the marker
width plus one. Lexical stores a nested list as a following `ListItemNode`
whose only child is a `ListNode`; that list's lines are indented by the
previous item's marker width plus one and appended to that item. A first item
that holds only a nested list writes `-` (or `1.`) alone, then the nested lines.
An empty item writes the marker alone. Items are joined by `"\n"`.

| Tree | Written |
|---|---|
| bullet `[a, [nested], c]` | `- a\n  - nested\n- c` |
| number start 9 `[a, [b]]` | `9. a\n   1. b` |
| number start 10 `[a, [b]]` | `10. a\n    - b` (bullet child) |

**Tables.** Move the body of today's TABLE export
([`markdownTableTransformer.ts:366`](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L366))
— header row, `formatDelimiterRow(alignments, getColWidths() ?? [])`, and the
`pendingRowSpans` walk writing `<<` / `^^` — into a `serializeTable(table)`
function, replacing each `$convertToMarkdownString(getTransformers(), cell)` with
`serializeTableCell(cell)`. `serializeTableCell` serializes each child paragraph
with the inline context `{ singleLine: true, inTableCell: true }`, joins them
with the two characters `\n` (`CELL_PARAGRAPH_BREAK`), trims, and turns a cell
whose whole text is `<<` or `^^` into `\<<` / `\^^`.

**Fences.** The opener is `:::`, then ` columns` when there are two or more
columns, then ` {attrs}` when `formatAttributes(node.toAttributes())` is
non-empty. A one-column fence with no attributes writes `::: {}` (a bare `:::`
cannot open a fence). The body is
`joinColumnSections(columns.map((column) => serializeBlockList(column.getChildren())))`,
then `\n:::`.

### Inline serialization

```typescript
/** Where inline content is being written. */
interface InlineContext {
    /** The content cannot span lines (headings, table cells). */
    readonly singleLine: boolean;
    /** Escape every `|`; a `\` before `n` is escaped; a `LineBreakNode` writes the cell break. */
    readonly inTableCell: boolean;
}

type Mark = "bold" | "italic" | "strike" | "underline";

/** One flattened piece of inline content. */
type Segment =
    | { kind: "text"; text: string; marks: Mark[]; code: boolean; style: string; link: LinkNode | null }
    | { kind: "image"; node: MarkdownImageNode; link: LinkNode | null }
    | { kind: "break"; link: LinkNode | null };
```

`style` is the normalized attribute text
`formatAttributes(spanStyleToAttributes(resolveSpanStyle(cssTextToAttributes(node.getStyle()))))`
— the same pipeline `STYLED_TEXT.export` and the source-mode `spanStyleSource`
use — or `""` when unstyled.

`serializeInline(element, context)`:

1. **Flatten** the element's children into segments: descend into a
   `LinkNode`, setting `link`; descend into any other inline element; turn any
   other leaf into a text segment of its `getTextContent()`. Split styled text
   at `[` / `]` and underlined text at `+` per the lossy-construct table. Text
   formats outside the five (highlight, subscript, …) are ignored.
2. **Group** consecutive segments by `link`, and within a link by `style`
   (images and breaks end a style group).
3. **Write** each group with the mark-stack rules, the code-span rule and the
   escaping rules; a link group is followed by its destination (below); a style
   group by `{style}`.

A `LineBreakNode` follows the table in *A `LineBreakNode` is a hard break that
keeps its authored marker*: the cell break when `inTableCell`, else `" "` when
`singleLine`, else nothing at a block edge, else
`$getState(node, hardBreakMarkerState) + "\n"`. A break segment carries no
marks, so the stack rules close open marks before it and reopen them after
(`*foo*\` + newline + `*bar*`). An image writes
`![alt-without-brackets](src)` plus `{width=… height=…}` when either is set,
exactly as `IMAGE.export` does today.

**Code spans.** The backtick fence is one longer than the longest backtick run
in the text. A space is added inside both fences when the text starts or ends
with a backtick, or both starts and ends with a space. Inside a table cell
every `|` becomes `\|`.

**Link destinations.**

| URL | Written |
|---|---|
| has no space, `<`, `>`, `(`, `)`, `\` or control character | `(url)` |
| anything else | `(<url>)` with `\`, `<` and `>` backslash-escaped |
| empty | `()` |

A title appends ` "title"` with `\` and `"` backslash-escaped. A link whose only
child is one unformatted, unstyled text node equal to its URL, with no title,
and whose URL matches `^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*$`, is written
`<url>` (an autolink). A link to `mailto:` + its text, where the text is an
email address, is written `<text>`.

---

## Ordered Implementation Steps

Paths are relative to `packages/lib/`. Symlink the main tree's `node_modules`
into the worktree root before running anything.

1. **Create `tests/component/markdown-serializer.test.ts`** with the same
   `CONFIG`, `beforeEach(installTestDOM(CONFIG))` and `afterEach(DOM.reset())`
   as [`markdown-editor.test.ts:32`](packages/lib/tests/component/markdown-editor.test.ts#L32),
   and these helpers:
   ```typescript
   /** Replaces a fresh editor's document with the nodes `build` returns, and returns the editor. */
   function editorWith(build: () => LexicalNode[]): MarkdownEditor;
   /** Runs `$serializeMarkdown()` on the editor's state. */
   function serialized(editor: MarkdownEditor): string;
   /** A text node with the given Lexical formats and optional CSS style. */
   function text(content: string, formats?: TextFormatType[], style?: string): TextNode;
   ```
   `editorWith` reaches the private Lexical editor as
   [`lexicalOf`](packages/lib/tests/component/markdown-editor.test.ts#L88)
   does, and runs `$getRoot().clear()` then appends in one
   `update(…, { discrete: true })`. Add one `it` per row of
   `## Expected Behaviour` (S1–S33, B1–B5, E1–E11), labelled with its id. Rows marked
   *lex-back* also assert `viewerModel(output)` from
   `tests/component/markdown-roundtrip/viewModel.ts` against the stated blocks.
   Add the **C1** corpus comparison: for each `CORPUS` document (copy the table
   from `markdown-editor.test.ts:51`), `setValue(doc)` and assert that
   `$serializeMarkdown()` equals `$convertToMarkdownString(TRANSFORMERS)` on the
   same state. Run `npx vitest run tests/component/markdown-serializer.test.ts` —
   every test fails (no module yet).
2. **Create `src/typescript/lib/component/editor/markdownNodeState.ts`** with
   `hardBreakMarkerState` per `## Public API` (JSDoc naming
   `@lexical/markdown`'s `hardLineBreakState` as the precedent), then
   **create `src/typescript/lib/component/editor/markdownSerializer.ts`.** Move
   `formatDelimiterRow` (and its JSDoc) out of `markdownTableTransformer.ts`
   into it as an export. In `markdownTableTransformer.ts`, delete the local copy
   and add `import { formatDelimiterRow } from "~/component/editor/markdownSerializer.js";`.
   Check: `npm run typecheck` passes.
3. **Write the text escaper** — `escapeText(text, before, after, context)` and
   `escapeLineStart(line)`, with `before` / `after` the neighbouring output
   characters (`""` when unknown, which counts as non-alphanumeric). Check:
   E1–E11 pass.
4. **Write inline serialization** (`flattenInline`, `groupSegments`,
   `writeGroup`, `writeCodeSpan`, `writeLinkDestination`, `writeImage`), each a
   named function under ~30 lines. Check: S12–S25 pass.
5. **Write block serialization** (`serializeBlockList`, `serializeHeading`,
   `serializeQuote`, `serializeCode`, `serializeList`, `serializeTable`,
   `serializeTableCell`, `serializeFence`) and `$serializeMarkdown`. Check: all
   rows and C1 pass.
6. **If C1 shows a difference**, decide it against this plan: a difference that
   a row of the departures table or of `## Expected Behaviour` mandates is
   recorded in C1 as an allowed difference naming that row; any other difference
   is a serializer bug to fix.
7. Run `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Create | `packages/lib/src/typescript/lib/component/editor/markdownNodeState.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts` |
| Create | `packages/lib/tests/component/markdown-serializer.test.ts` |

---

## Expected Behaviour

All unit-testable. Trees are written compactly: `P[…]` paragraph, `H2[…]`
heading, `Q[…]` quote, `UL[…]` / `OL(n)[…]` lists of items, `"x"{b,i}` a text
node with formats (`b` bold, `i` italic, `s` strikethrough, `u` underline,
`c` code), `{color=red}` a style, `L(url)[…]` a link, `BR` a `LineBreakNode`
with no state (`BR("   ")` with that marker),
`IMG(src,alt,w)` an image.

### Blocks

| # | Tree | `$serializeMarkdown()` |
|---|---|---|
| S1 | `P["A plain paragraph."]` | `A plain paragraph.` |
| S2 | `H2["Title"]`, `P["x"]` | `## Title\n\nx` |
| S3 | `H1[]` | `#` |
| S4 | `H1["foo #"]` | `# foo \#` |
| S5 | `Q["a", BR, "b"]` | `> a\` + newline + `> b` |
| S6 | `CODE(js)["x = 1"]` | ```` ```js\nx = 1\n``` ```` |
| S7 | `CODE()["```\nin"]` | ````` ````\n```\nin\n```` ````` |
| S8 | `UL["one", "two"]` | `- one\n- two` |
| S9 | `OL(3)["a", "b"]` | `3. a\n4. b` |
| S10 | `UL["a", UL["nested"], "c"]` | `- a\n  - nested\n- c` (*lex-back*: nested list in item `a`) |
| S11 | `OL(9)["a", OL(1)["b"]]` | `9. a\n   1. b` (*lex-back*: nested) |
| S26 | table `a b / 1 2`, aligns `left, right`, widths `[240, 0]` | `\| a \| b \|\n\| :--- {width=240} \| ---: \|\n\| 1 \| 2 \|` |
| S27 | table, body row cell 1 colSpan 2 | `\| a \| b \|\n\| --- \| --- \|\n\| d \| << \|` |
| S28 | table cell holding `P["x \| y"]`, `P["z"]` | the cell's text is `x \| y` (pipe escaped), then the two characters backslash and `n`, then `z` |
| S29 | table cell `P["<<"]` | cell written `\<<` |
| S30 | fence align center, one column `[P["text"]]` | `::: {align=center}\ntext\n:::` |
| S31 | fence, two columns `[P["A"]]`, `[P["B"]]` | `::: columns\nA\n\|\|\|\nB\n:::` |
| S32 | fence, no attributes, one column `[P["A"]]` | `::: {}\nA\n:::` (*lex-back*: one `fence`, no style) |
| S33 | `P[]`, `P["x"]`, `P[]` | `x` (empty paragraphs dropped; empty document is `""`) |

### Inline

| # | Tree | Written |
|---|---|---|
| S12 | `P["Text with ", "bold"{b}, ", ", "it"{i}, " and ", "code"{c}, "."]` | ``Text with **bold**, *it* and `code`.`` |
| S13 | `P["both"{b,i}]` | `***both***` |
| S14 | `P["foo "{i}, L(/url)["bar"{i}]]` | `*foo [bar](/url)*` (*lex-back*: runs `foo ` and `bar`, both italic, `bar` linked) |
| S15 | `P["bold "{b}, "next"]` | `**bold** next` |
| S16 | `P["a"{b}, "b"{b,i}, "c"{b}]` | `**a*b*c**` |
| S17 | `P["x"{b,c}]` | ``**`x`**`` |
| S18 | `P["red "{color=red}, "b"{b}{color=red}]` | `[red **b**]{color=red}` |
| S19 | `P["s"{b}{color=red}]` | `**[s]{color=red}**` (*lex-back*: one run, bold, colour red) |
| S20 | `P["a [x] b"{color=red}]` | `[a ]{color=red}\[x\][ b]{color=red}` |
| S21 | `P[L(https://e.com)["https://e.com"]]` | `<https://e.com>` |
| S22 | `P[L(/my uri)["t"]]` | `[t](</my uri>)` |
| S23 | `P[L(/u, title "a \"q\"")["t"]]` | `[t](/u "a \"q\"")` |
| S24 | `P[` code text `a`, two backticks, `b` `]` | the text inside three-backtick fences, no padding spaces |
| S25 | `P["a"{u}, "+"{u}, "b"{u}]` | `++a++\+++b++` (*lex-back*: `a` and `b` underlined, `+` plain) |

### Hard breaks

| # | Tree | Written |
|---|---|---|
| B1 | `P["a", BR, "b"]` | `a\` + newline + `b` (*lex-back*: runs `a`, break, `b`) |
| B2 | `P["a", BR("   "), "b"]` | `a   ` + newline + `b` (*lex-back*: same runs) |
| B3 | `P["a", BR]` and `P[BR, "a"]` | `a` |
| B4 | `H1["a", BR, "b"]` | `# a b` |
| B5 | `P["a  "{i}, BR, "b"{i}]` | `*a*\` + newline + `*b*` (trailing spaces of `a  ` dropped) |

### Escaping (each also *lex-back*: one paragraph whose single plain run is the input)

| # | Text node | Written |
|---|---|---|
| E1 | `snake_case_word` | `snake_case_word` |
| E2 | `_init_ and *x*` | `\_init\_ and \*x\*` |
| E3 | `a ++ b ++ c` | `a \+\+ b \+\+ c` |
| E4 | `see <b> and a < b` | `see \<b> and a < b` |
| E5 | `https://e.com/a_b` | `https\://e.com/a_b` |
| E6 | `1. not a list` | `1\. not a list` |
| E7 | `# not a heading` | `\# not a heading` |
| E8 | `C:\path\x` | `C:\path\x` |
| E9 | `ends with \` | `ends with \\` |
| E10 | `&amp; &#35;` | `&amp; &#35;` |
| E11 | `[x]: https://e.com` | `\[x\]: https\://e.com` |

### Corpus comparison

| # | Check | Expected |
|---|---|---|
| C1 | each of the 22 `CORPUS` documents, loaded by the current importer | `$serializeMarkdown()` equals `$convertToMarkdownString(TRANSFORMERS)` |

---

## Verification

From `packages/lib` unless noted:

- `npx vitest run tests/component/markdown-serializer.test.ts` — all rows green.
- `npm run test` — the full suite, including the round-trip harness unchanged
  (no `known` entry flips: nothing calls the serializer yet).
- From the repo root: `npm run typecheck`, `npm run lint`, `npm run docs:api`
  (zero warnings).
- `grep -n "function formatDelimiterRow" -r src/` — exactly one match, in
  `markdownSerializer.ts`.

---

## Potential Challenges

- **Neighbour-dependent escapes at segment edges.** `_` and `+` need the
  neighbouring output character; across a delimiter or a group boundary pass
  `""`, which escapes conservatively.
- **Whitespace moved out of delimiters changes nothing visible** — the viewer
  collapses whitespace and the harness compares collapsed runs — but an
  underline or strikethrough no longer covers that space.
- **The source-mode branches' `markdownSourceEdits.ts`** writes the same span
  and table syntax. It keeps working unchanged; its comments still name the
  transformers until plan 2 repoints them.

---

## Critical Files

- [`component/editor/markdownTableTransformer.ts`](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L366) — the TABLE export moved into `serializeTable`.
- [`component/editor/markdownBlockTransformer.ts`](packages/lib/src/typescript/lib/component/editor/markdownBlockTransformer.ts#L133) — the fence export `serializeFence` replaces.
- [`component/editor/markdownStyleTransformers.ts`](packages/lib/src/typescript/lib/component/editor/markdownStyleTransformers.ts#L149) and [`markdownImageTransformer.ts`](packages/lib/src/typescript/lib/component/editor/markdownImageTransformer.ts#L188) — the span and image export formats kept.
- [`component/display/markdownAttributes.ts`](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts) — `formatAttributes`, `resolveSpanStyle`, `spanStyleToAttributes`, `cssTextToAttributes`, `joinColumnSections`.
- [`component/display/markdownExtensions.ts`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts) — the inline extensions (`UNDERLINE_EXTENSION`'s `[^+]+`, `STYLED_SPAN_EXTENSION`'s `[^[\]]+`, `IMAGE_EXTENSION`) the lossy-construct rules follow.
- `node_modules/@lexical/markdown/dist/LexicalMarkdown.dev.mjs` — `$convertToMarkdownString` and `LINK.export`, the precedent and the C1 oracle; `hardLineBreakState` / `$exportLineBreak`, the precedent for `hardBreakMarkerState`.
- `tests/component/markdown-roundtrip/viewModel.ts` (from the harness plan) — `viewerModel` for the lex-back assertions.

---

## Non-Goals

- **Any production caller.** Plan 2 wires the serializer into `MarkdownEditor`.
- **Nodes that do not exist yet** (`MarkdownSourceTextNode`,
  `MarkdownRawBlockNode`, list looseness, `ReferenceLinkNode`) — added by
  plans 2 and 3 together with their serializer cases.
- **Changes to `markdownSourceEdits.ts`**, the viewer, or the harness corpus.

---

## Notes

[^module-shape]: `@lexical/markdown`'s exporter is `$convertToMarkdownString`, a
    `$`-function walking the active state; the replacement keeps that shape so
    plan 2's call-site swap is one call for another. The transformer-array
    design was not kept: its import half is what plan 2 replaces, and on the
    export side its first-match-wins dispatch is what forced the
    `STYLED_TEXT` / `LINK` ordering workarounds and the split styled spans.

[^byte-compat]: Matching the current output keeps every existing exact-output
    assertion in `markdown-editor.test.ts` (about 50, all on single-construct
    documents) and the source-mode tests passing without edits, and keeps a
    re-saved document's diff limited to the constructs the old exporter got
    wrong. The nested-list indent is the one deliberate format change: the
    old four-space step only matched the old importer, which plan 2 removes,
    and four spaces is too few under a `100.` marker.

[^escape-why]: Escaping every ASCII punctuation character would also be
    correct, but turns `snake_case` and every URL into backslash soup in the
    edited blocks. The table lists exactly the characters that start a
    construct in `marked` 18 with this dialect's extensions: emphasis and
    strikethrough delimiters, code spans, link and span brackets, the `++`
    underline extension, tags and angle autolinks, GFM's bare-URL and email
    autolinks (broken by escaping the one character their rule requires), and
    the block starters at a line start. `&` is left alone because the viewer
    writes entity references as literal text, so `&amp;` already reads back as
    `&amp;`.

[^break-marker]: Writing every `LineBreakNode` as a soft `\n` (what the old
    exporter does for a break with no `@lexical/markdown` marker) loses the
    line break in the viewer, which renders hard breaks after
    `markdown-viewer-hard-breaks`. The backslash is the default because
    trailing spaces are invisible and are stripped by many editors and
    formatters, which would silently turn the break back into a flowing line.
    A break at a block edge writes nothing because `marked` reads a trailing
    `\` as a literal backslash and trailing spaces as nothing.

[^mark-stack]: `@lexical/markdown` closes every format at a link boundary and
    reopens it inside, which is why `*foo [bar](/url)*` came back as
    `*foo* [*bar*](/url)` (harness reason `emphasisAroundLink`), and writes
    formats per text node, which split styled spans and dropped bold around a
    span (`styledSpanInStrong`). Keeping marks open across a group whose every
    segment carries them is valid CommonMark (`*a [b](u) c*`) and gives the
    shortest output.

---

## Implementation Notes

- **Cell paragraph break is four characters, not two (S28).** The plan names
  `CELL_PARAGRAPH_BREAK` as the two characters `\n`. In the code it is the
  viewer's `CELL_PARAGRAPH_BREAK` in `Markdown.ts` — `\n\n`, four characters —
  which is also what the current exporter writes between a cell's paragraphs
  and what the harness's `viewModel.ts` mirrors. The viewer splits a cell only
  on that pair, so a lone `\n` between paragraphs would render as literal
  text. The serializer joins a cell's paragraphs with the four-character pair
  (byte-compatible with the current exporter, read back as one `<br>`). A
  `LineBreakNode` in a cell first wrote the two-character `\n` per the plan;
  the edit-fuzz fixes below make it write the pair too (the viewer shows a
  lone `\n` literally).
  S28's test asserts `x \| y\n\nz` and a lex-back of runs `x | y`, break, `z`.
  **Plan 2 is affected:** its cell-mode import ("split on the two characters
  `\n` (`CELL_PARAGRAPH_BREAK`)") must split paragraphs on the four-character
  pair, or every cell paragraph boundary reads back with an empty paragraph
  between. A lone `\n` (a `LineBreakNode`) still renders literally in the
  viewer, as it does today.
- **S20's expected string contradicts the flatten rule; the rule was kept.**
  Splitting styled text at `[` / `]` (Implementation, step 1) and grouping by
  style leaves `x` styled, so `a [x] b` in red is written
  `[a ]{color=red}\[[x]{color=red}\][ b]{color=red}`, not the row's
  `…\[x\][ b]…`. Only the brackets lose the colour, as the lossy-construct
  table says; the test asserts the lex-back.
- **Escaping additions.** Comparing `viewerModel(output)` with
  `editorSurfaceModel` over every text × format × context combination showed
  constructs the table misses. Each now has a test:
  `www.` autolinks anywhere in a word, so its `.` is escaped wherever it
  follows `www`; a `!` ending the text before a link is escaped (else an
  image); `marked` unescapes `\[` / `\]` in link text before lexing it
  (`outputLinkReplace`), so a `(` or `{` after a `]` is escaped and a
  backslash before a bracket in a code span inside a link is doubled; a `{`
  right after an image's `)` is escaped (else its attributes); underline does
  not stay open across a link whose destination holds `+`; a space-marker
  break ending an otherwise empty line writes `\` (spaces would blank the
  line); a code span of spaces only is not padded.
- **Lossy beyond the plan's table: mark changes inside a word.** The stack
  rules and the fixed order are implemented as written, and between two
  letters they can put delimiters against each other: `a`{b}, `b`{b,i},
  `c`{i} is written `**a*b****c*` (a merged `****` run), `a`, `b`{b,u}, `c`
  is written `a**++b++**c` (the `**` against `++` no longer flanks), and
  `~~a*b*~~c` loses its strike the same way. The viewer drops or misreads
  that emphasis. The current exporter writes the same bytes, so nothing
  regresses; the lossy table's flanking row only names punctuation in the
  text. *Resolved by the edit-fuzz fixes below* (the read-back): these are
  now written `__a*b*__*c*`, `a++**b**++c` and `~~a~~*~~b~~*c`.
- **Unspecified cases.** A fence with no columns writes its children, as the
  current exporter does. Empty paragraphs in a table cell were dropped,
  and a list, heading or quote nested in a cell was written in its own
  syntax (the old `escapeCellText` treatment); the edit-fuzz fixes below
  change both. A first list item holding only a nested list writes its marker alone,
  as the plan says, and counts toward the numbering (`1.`, nested lines,
  `2. b`) so the markers read in sequence; the current exporter instead
  writes no marker for it and does not count it (`    1. n\n1. b`). An empty
  destination before a title is written `<>` (`[t](<> "x")`), since
  `( "x")` would read `"x"` as the destination.
- **Bullet markers are always `-`.** The plan writes every bullet list with
  `- `. The current importer keeps an authored `*` or `+` in
  `@lexical/markdown`'s own (unexported) `listMarkerState` and the current
  exporter writes it back, so a document loaded as `* a` saves as `- a` with
  the serializer — a departure the plan's table does not list, invisible to
  C1 because `CORPUS` only uses `- `. A test pins it. Keeping the authored
  marker would need a list-marker state of our own, set by plan 2's importer
  the way `hardBreakMarkerState` is.
- **Escape neighbours are the real output characters.** Step 3 and
  *Potential Challenges* say to pass `""` across a delimiter or group
  boundary. Text is instead escaped after the whole line is written, against
  the actual neighbouring character (a delimiter's or bracket's own
  character, or `\n` at a line edge): with `""`, S25's `+` between `++`
  delimiters would not be escaped.
- **No documentation commit:** the module has no public surface and no caller,
  so nothing user-visible changes (the round-trip harness plan set the same
  precedent).
- **Observed, out of scope:** the viewer reads a fenced code block whose first
  code line is `---` (`` ```\n---\n``` ``) as a one-column table — the
  dialect's table extension runs ahead of `marked`'s fence rule. It is
  independent of the serializer; the current exporter writes the same text.
- The plan's anchors `markdownStyleTransformers.ts#L149` and
  `markdownImageTransformer.ts#L188` point past the end of those 49-line
  files; the formats they name were found and kept.

### Whole-stack review fixes

A review of the whole stack (through `markdown-viewer-block-fixes`) found
these through the editor at the top; each is fixed here in the serializer,
pinned by a unit test that builds the node shapes directly, and was
confirmed end to end at the top of the stack after restacking.

- **A newline inside a text node is a hard break (F1).** A code block turned
  into a paragraph, quote, heading or list keeps its text in one `TextNode`
  holding `\n`; written raw, its lines became blocks (`x\n# y\n- z` saved as
  a paragraph, a heading and a list; `x\n-` as a setext heading). The editor's
  surface is `white-space: pre-wrap` (Lexical sets it on the root), so it
  shows each such newline as a line break; the serializer now writes each as
  a hard break with the default marker, exactly as a `LineBreakNode` —
  escaped line starts in a paragraph, quote or list item, a space in an ATX
  heading, the cell break in a table cell, and a code span split around it.
  The importer never puts a newline in plain text (a soft break is a source
  node showing a space), so loaded paragraphs are unaffected.
- **An empty nested list item no longer turns its parent into a setext
  heading (F2).** `- a\n  -` reads as a level 2 heading `a`, and `- a\n  - `
  too (a setext underline may end in spaces), so no `-` form of an empty
  first nested item works under text. A bullet list whose first line is a
  bare marker right under a line of text is written with `*` instead (the
  whole list, since a bullet change starts a new list): `marked` reads
  `- a\n  *` as a nested list with one empty item. Later empty items and
  ordered markers are unaffected.
- **A list item holding blocks keeps them (F6).** An item is now written as
  its blocks: each run of inline children, and each block child — a
  paragraph `insertParagraphAfterBlock` put after a nested list, a nested
  list, or any other block — on its own, a nested list directly under the
  block before it, any other block after a blank line (else it would join
  the text before it as a continuation). An item whose first child is a list
  continues the item before it, as Lexical numbers and shows it, so
  `- a\n  1. b` plus a paragraph `X` saves as `- a\n  1. b\n\n  X` (the
  blank line makes the outer list loose, which is how CommonMark reads an
  item holding two blocks).
- **Heading ids survive a save (F9).** The viewer slugs a heading's source
  text, so every rewrite of it changes the id. Two node states are added
  beside `hardBreakMarkerState`, for plan 2's importer to set (it does, in
  `markdown-editor-marked-import`): `bareAutolinkState` marks a link loaded
  from a GFM bare URL, `www.` or email autolink, which is written back bare
  when `marked` reads its text alone as the same link and whitespace or a
  line edge surrounds it (else its `<…>` or `[…](…)` form, decided once the
  line is assembled); `spanAttributesState` keeps a styled span's authored
  attribute text, written back while it still resolves to the node's style,
  so the attributes' order and unknown ones (`[x]{bogus=1}`) survive. Empty
  links are fixed in `markdown-editor-marked-import`.
- **Whitespace between differently formatted runs keeps its mark (F10).**
  Marks open in the fixed order, except that a mark carried on across
  whitespace at a unit boundary opens outermost, the furthest-reaching
  first, so it stays open when the shorter mark closes before the space:
  `++*4* 6++` and `~~**7** 1~~`, not `*++4++* ++6++`. Between letters the
  fixed order is kept — a differential run against the old writer showed
  that reordering there only moves where delimiters meet mid-word, breaking
  as many intraword cases as it fixes. An image after whitespace held inside
  open marks is written inside them (`~~, ![](g)~~`) when what follows lets
  the delimiter close after its `)`. A mark on a lone space whose
  neighbours lack it stays lost: CommonMark emphasis cannot hold whitespace
  alone (underline can — see the edit-fuzz fixes below).
- **A bracket pair around an odd-backtick code span in link text is written
  unescaped (F11).** `marked` finds the end of link text by pairing
  backticks, which a code span holding an odd number of them (`` ` ``)
  throws off, so `[\[`` ` ``\]](/u)` read as literal text; inside a bracket
  pair it scans plain text, so such a pair (holding no other bracket) is now
  written as brackets: `[[`` ` ``]](/u)`.
- **An outer emphasis pair `marked` would mis-pair is written with `_`.**
  The edit fuzz of `markdown-editor-source-preservation` found that typing a
  word right before an inner bold run (`*foo **bar** baz*` edited to
  `*foo fuzz**bar** baz*`) lost the bold: a `*` run with a letter (or
  punctuation) on both sides can open and close, and when only one end of
  an inner pair is such a run, `marked` pairs it with the outer `*` run,
  where CommonMark pairs them correctly. Once a line is
  assembled, the delimiters are paired, and an outer bold or italic pair
  around such an inner pair is written with `_` (`_foo fuzz**bar** baz_`),
  which never pairs with `*` — kept only when every delimiter that could
  open or close before still can, so an outer pair next to a letter stays
  `*`. The pairs are read across the whole block. Flanking is read as
  `marked` reads it (Unicode punctuation and
  symbols, `~` a letter next to `*`). This also fixed the known intraword
  loss `***a*b*c***` (now `__*a*b*c*__`). A randomized differential run over
  bold, italic, strikethrough and underline runs (30,000 paragraphs per mark
  set) fixed about 800–1,600 cases per set and broke none; switching the inner
  pair instead, where the outer cannot, fixed a few dozen more but broke
  one, so it was left out. A delimiter between a letter and punctuation —
  a word typed right before emphasis that opens with punctuation
  (`foo fuzz*\**`, `A fuzz**[ref]**`), or after emphasis that ends with it —
  cannot open or close as either `*` or `_`; CommonMark's remedy, writing
  the letter as a character reference, shows the reference as typed in this
  viewer, which does not decode them. Those stay pinned as known losses.
- **The harness's editor surface reads a newline in a text node as a break.**
  `editorSurfaceModel` collapsed it to a space, but the editor's
  `white-space: pre-wrap` surface shows it as a line break and F1 saves it
  as a hard break, so a code block turned into a paragraph projected
  differently from the viewer's reading of its save. It is fixed here
  rather than in `markdown-roundtrip-harness`: loading never puts a newline
  in a text node outside code, and before F1 no save wrote one as a break,
  so no check on the earlier branches could reach it.

An edit fuzz over the stack (load, edit, save, re-lex with the viewer) then
found these, fixed the same way:

- **A code block's fence suits its info string.** Every code block was
  written with a backtick fence and its info string after it, but a
  backtick fence's info string cannot hold a backtick: a `~~~` block with
  the info string `` `2 `` saved as ```` ````2 ```` with a shorter closing
  fence, and the rest of the document became code. A block whose info
  string holds a backtick is now fenced with `~~~`, and either fence is one
  longer than the longest run of its own character that starts a line of
  the code.
- **A code span takes the shortest fence its content does not hold**
  (deviation from S24 and *Code spans*, which fence one backtick longer than
  the longest run: `a``b` is now written `` `a``b` ``, as CommonMark
  allows). A fence of three or more at a line start is read as a code fence
  by `marked`'s setext-heading rule, so `` ` ``)` `` on a heading's second
  line was saved ```` ``` ``)``` ```` and the heading became a paragraph;
  the shorter fence is also the one the source most likely used. Inside
  link text the fence stays one longer than the longest run: `marked`'s
  link-text scan reads from one backtick run to the next as a code span, so
  a shorter fence there ends the link text early. Content holding runs of
  both one and two backticks still needs three; `markdown-editor-marked-import`'s
  setext writer falls back to an ATX heading for that line.
- **A bare autolink inside emphasis stays bare (F9).** A link loaded bare
  whose text carries marks (`*http://e*4`) was written `[…](…)` inside the
  marks, and the closing delimiter, between the `)` and a letter, no longer
  closed. Such a link is now written bare inside its marks when each side is
  whitespace, a line edge or one of those marks' delimiters next to a letter
  or digit of it — the emphasis then bounds the URL — else in its
  `[…](…)` form as before. A delimiter opening right after it bounds
  nothing (`marked` reads the URL on across it), nor does underline when the
  text holds a `+`. The bare-or-fallback choice is now made before the
  emphasis pairs are read, so the pairing sees the characters written.
- **An image keeps its authored attributes.** An edited block rewrote an
  image's attribute group from its size alone, dropping `{width=x}` (an
  invalid width) and `{bogus=1}` and reordering `{height=2 width=3}`, so a
  heading holding one changed its id. `imageAttributesState` is added beside
  `spanAttributesState`, for plan 2's importer to set (it does, in
  `markdown-editor-marked-import`), and written back while it still resolves
  to the image's size, as F9 does for a span.
- **A mark the text after an image carries from its leading space opens
  before the image (F10).** `~![](g) 2~` saved `![](g) ~~2~~`, the space no
  longer struck: an image carries no marks, so they closed before it and
  reopened after the space. When the text after an image starts with
  whitespace, its marks now stay open, or open before the `!`, where an
  opening delimiter can stand (after whitespace, punctuation or a line edge;
  anywhere for underline, which has no flanking rule): `~~![](g) 2~~`.
  Between a word and the image the space stays unmarked, as before.
- **Underlined `+` stays lossy, as the lossy-construct table says.** The
  fuzz flagged `+b`, `b+` and `++b` underlined in full, saved `\+++b++`,
  `++b++\+` and `\+\+++b++`. The escapes are on the literal `+` and the
  viewer reads the underline delimiters as written (the same `+` unmarked
  beside an underlined `b` round-trips); what is lost is the underline on
  the `+` itself, which the viewer's `++([^+]+)++` grammar cannot hold — S25's
  case. Nothing changed here.

A whole-stack edit fuzz at `markdown-viewer-block-fixes` (seeds 601 and
777, 3,000 documents per mode, two edits each), with a node-level fuzz of
this serializer alone (random inline and block trees, the viewer's reading
of the output compared with the editor's surface), then found these, fixed
here under the decision to fix everything a representation can keep:

- **A block's Markdown is read back and rewritten when its emphasis reads
  differently.** Where delimiters meet each other or punctuation — a
  merged `***` run between two marks, a `*` against a `~~` (a letter to
  `marked`) or a `++`, a code span holding a backtick and a `*` (which
  `marked` cannot mask), an escaped `\~` (punctuation to `marked`) — the
  stack rules' output reads back wrong. `serializeInlineNodes` now lexes
  each block's inline Markdown with `lexMarkdown`, in the block it is
  written for (a paragraph, a heading after `# `, a one-cell table), and
  compares the reading — every visible character, image and break with its
  marks, link and style — with the editor's segments. On a mismatch it
  tries `WRITING_POLICIES` in turn (underline outermost; marks inside a
  link or span; marks reopened in a fixed rank), each with its bold and
  italic pairs switched between `*` and `_` greedily, then, for a block
  holding a `~`, the same with lone tildes unescaped; the first writing
  that reads back as written is kept, else the first. At most
  `MAX_READ_BACKS` (64) lexes per block; a block with no mark, bare
  autolink or `~` is not read back. This is the lexer-probe pattern the
  later branches use for block joins and HTML block starts. It fixed the
  three intraword known losses above and the bold link after a word
  (`A fuzz[**x**](/u)`).
- **A bare autolink stays bare next to punctuation where the viewer still
  reads it (F9).** `<https://a.test/1>www.b.test` was re-saved as
  `[www\.b.test](http://www.b.test)`, changing the heading's id. A bare
  autolink whose neighbours are not letters or digits is now written bare
  when the read-back still reads the same link.
- **A hard break at the start of a block is written** (deviation from B3):
  `\` on an empty first line, which a paragraph, quote or list item can
  open with (`- \` + newline + `  a`).
- **A table cell keeps its breaks.** A `LineBreakNode` (or newline) in a
  cell writes the four-character pair the viewer splits on (a lone `\n`
  shows literally), breaks at either edge of a cell are kept, and an empty
  paragraph keeps its boundaries (`a\n\n` shows `a` and a blank line, as
  the editor does). A delimiter opening right after a cell break is written
  after a space — the break ends in the letter `n`, against which a
  delimiter before punctuation cannot open; the space collapses at the
  line start.
- **A block nested in a table cell is written as its inline content** (a
  heading, quote or code block a command toggled inside a cell; a list as
  each item's content on its own line of the cell): its own syntax showed
  as literal text (`## t`) and read back into the cell's text.
- **Underline keeps the whitespace it covers.** The underline grammar has
  no flanking rule, so edge whitespace of underlined text stays inside its
  `++` (`b++ a++`), underlined whitespace alone is written `++ ++`, and
  underline opens outside the marks that end with such text
  (`++*a* ++b`).
- **A break ending a link's text is written after the link**, where it
  still breaks the line (`marked` reads no break at the end of link text).
- **An angle-bracket autolink keeps its form inside emphasis.**
  `*<a@b.test>*` was written `*[a\@b.test](mailto:a@b.test)*`, changing a
  heading's id; an autolink whose text carries marks is now written
  `<…>` with the delimiters around it (also the fallback of a bare one).
- **A body row wider than the header no longer loses its extra cells.**
  The table was written as wide as its header row, so a cell an edit left
  beyond it was dropped from the save; the header is now padded with empty
  cells to the widest row (a pipe table cannot be ragged).
- **A code span ending in a backslash is padded** (`` ` a \ ` ``):
  `marked` masks a backslash together with the character after it before
  pairing backticks, so the closing fence after a `\` was hidden and a
  later code span's fence paired with this one's, misreading the block.

These cannot be written so the viewer shows what the editor shows, and
stay lossy (the end-of-block breaks and the flanking cases are pinned by
tests that assert the viewer reads them differently):

- **A hard break at the end of a block, or a block holding only breaks.**
  CommonMark (§6.7) reads no hard break at the end of a block — a trailing
  `\` is a literal backslash, trailing spaces are stripped — and a
  paragraph needs content. Only an invisible character after the break (an
  NBSP or a zero-width space the editor does not hold) would keep it, and
  the viewer does not decode entity references, so `&nbsp;` shows as
  typed. (A table cell can: the viewer renders its cell break anywhere.)
- **A line break in an ATX heading.** An ATX heading is one line; levels 1
  and 2 have the setext form (`markdown-editor-marked-import`'s setext
  writer), levels 3–6 none, so the break is written as a space. The editor
  should not offer Shift+Enter (or keep a newline) in a level 3–6 heading —
  a change for `markdown-editor-marked-import`.
- **Emphasis or strikethrough whose content starts with punctuation right
  after a letter, or ends with punctuation (a code span, an escaped
  character) right before one** (`**(a)**b`, ``a~~`c`~~``). An opening
  delimiter before punctuation must follow whitespace or punctuation, a
  closing one after punctuation must precede them (CommonMark's flanking
  rules, which GFM strikethrough shares); `*` and `_` obey both. The only
  CommonMark remedy, a character reference for the neighbouring letter,
  shows as typed in this viewer.
- **Bold, italic or strikethrough on whitespace at a run's edge or alone**:
  an opening delimiter cannot be followed by whitespace nor a closing one
  preceded by it (and GFM strikethrough needs a non-space after its
  opener). Underline can, and does.
- **The dialect's grammar limits**, as the lossy-construct table says:
  underlined `+` (`++([^+]+)++`), styled text holding `[` or `]`
  (`[^[\]]+`), brackets in image alt text.
- **A `<` before emphasis is escaped where a later `>` would hide it (stack
  fuzz round).** `marked` masks every `<…>` stretch before it pairs emphasis
  delimiters, whether or not the stretch is a tag, so `<+a**b**c d\<e>` read
  its bold as literal asterisks: a `<` before anything but a letter, `/`,
  `!` or `?` was written unescaped, and the escaped `\<` later does not stop
  the stretch (`marked` masks escapes first). A block holding a `<` that does
  not read back is now tried again with every `<` escaped, as one with a `~`
  is with its lone tildes unescaped. The fuzz found it through a paste into a
  setext heading; any paragraph shows it.
- **The harness's whitespace model changed under one test.** The read-back
  test of an outer pair opening mid-word expected the plain space between two
  italic runs as a run of its own; the round-trip harness now projects a
  space with the bold and italic of the text on both sides of it, which a
  space cannot show (see `markdown-roundtrip-harness`'s notes), so the
  expectation is one italic run `a `.
- **A text split into nodes of one format is written as one node (stack fuzz
  round).** Adjacent text segments with the same marks, style, link and code
  are merged before writing, as code segments already were: the writing
  around an image depended on whether the space after it stood in a node of
  its own (`![](g)` then an italic ` ` and `!` wrote `![](g) *!*`, one italic
  ` !` wrote `*![](g) !*`), and Lexical joins such nodes only when it commits
  an update, after a load has fingerprinted each block — so an unedited
  block saved in the standard form.

### Stack fuzz round 2

A fifth whole-stack fuzz, run at the stack's top on the rule that the
editor shows what is saved and what the viewer renders, found these
writings here that the viewer reads into the block around them, or that
drop source; each is fixed in the serializer and pinned by a unit test:

- **A nested list follows only the item's own text directly.** After any
  other block of the item it now follows a blank line, as other blocks do:
  a table read the list's lines as rows, and a paragraph after the item's
  text took in an ordered list not starting at 1 (CommonMark lets only a
  list starting at 1 interrupt a paragraph). The blank line is already
  there before such a block, so the list's looseness does not change.
- **A bare autolink before a `\` hard break is written `<…>`.** GFM's
  extended autolink takes a trailing backslash into the URL, so the break
  was lost and the URL changed; the line's end no longer bounds a bare URL
  when a `\` break ends the line.
- **A fence keeps its authored attributes.** A `:::` fence's attribute
  text the editor does not model (`{x=1 align=right}`) was dropped once its
  content was edited; a new `fenceAttributesState`, set by the importer,
  keeps the authored text, written while it still resolves to the fence's
  alignment and gap, as `spanAttributesState` does for a styled span.
- **A link title's line breaks are written where its block holds them.**
  A blank line in a title ended the paragraph mid-link, and any line break
  ended a heading or table cell line; a stretch of breaks is now written as
  one, and in a heading or table cell as a space.
- **Canonical mark placement around links and spans (round 2's
  `canonicalIdempotence`, 4 signatures).** A save loaded and saved again
  moved a mark into or out of a link's or styled span's brackets though it
  read the same (`[**c d**](…)` then `**[c d](…)**`). Two causes, both
  settled here so the second save equals the first. (1) Bold and italic do
  not show on whitespace, and the writer leaves whitespace at a run's edge
  outside its delimiters, so the read-back carried them otherwise on the
  whitespace beside a link or span (`[**a b,** ](…)` loads its space
  unmarked) — and whether a group carries a mark whole decides where the
  mark is written (`commonMarks`), and which writing policy reads back.
  `flattenInline` now settles those two marks on the whitespace at a link's
  or styled span's edge to the ones the characters on both sides share
  (`canonicalWhitespaceMarks`), so both forms are the same segments.
  Whitespace away from a group's edge is written as marked (`**a** **b**`
  stays, so bolding the space between still joins the runs), underline and
  strikethrough, drawn across whitespace, are left alone, and so is
  whitespace beside an image, a break or the content's edge. (2) A
  marked bare autolink kept its marks outside it, bare or in its `[…](…)`
  fallback, where a link loaded from that fallback (no longer bare) had
  them written inside under a marks-inside-groups policy; under such a
  policy a marked bare autolink is now written as that link, marks inside.
  Pinned by building both node shapes of each finding and requiring the
  same save.

### Stack fuzz round 4

- **An image's and a fence's authored attributes survive a JSON round
  trip.** `MarkdownImageNode.importJSON` and `MarkdownBlockNode.importJSON`
  built a fresh node from the JSON's own fields and dropped its node state
  (`imageAttributesState`, `fenceAttributesState`, and on the stack above,
  `keptSourceState`), where Lexical's own nodes restore it through
  `updateFromJSON`. A paste of copied nodes, or content the editor restores
  from JSON — `markdown-editor-marked-import`'s declined edit puts the
  touched blocks back from their JSON, and a selection reaching from a list
  into the paragraph after it touches the whole list — then lost an
  image's `{width=x}` and, in a construct kept as written, the image's
  place in it, so the construct dissolved and a link nested around it lost
  its destination from the save. Both now call `updateFromJSON`.
