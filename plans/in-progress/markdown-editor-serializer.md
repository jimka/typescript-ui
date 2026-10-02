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
