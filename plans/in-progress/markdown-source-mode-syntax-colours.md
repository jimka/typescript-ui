---
depends-on: [markdown-source-mode-plain-text]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/theme.ts
  - packages/lib/src/typescript/lib/component/editor/languages.ts
  - packages/lib/tests/component/markdown-source-look.test.ts
  - packages/lib/docs/components/CodeEditor.md
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# Markdown Source Mode Syntax Colours — Implementation Plan

## Overview

`MarkdownEditor`'s source mode is a `CodeEditor` running the built-in `"markdown"` language ([MarkdownEditor.ts:9606](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L9606)). The previous branch, `markdown-source-mode-plain-text`, made that surface show Markdown as plain text: no bold, italic or underline, marks grey, headings blue, code green, everything else in the text colour. Markup and content are now hard to tell apart, and most of the dialect's syntax (`{…}` groups, `:::` fences, tables) is not coloured at all, because the grammar does not read it.

This plan gives every kind of non-text Markdown its own colour and keeps content in the text colour. Nothing is drawn as the viewer draws it. Every colour, the text colour included, reaches 4.5 : 1 contrast on the editor background in the light and the dark theme, so each theme scheme gets its own set of Markdown colours. Seven new highlighting tags, emitted only by the `markdown` language, carry the kinds; parser extensions teach the grammar the dialect's syntax, tables, `~~strike~~` and `++underline++`. No other language changes look.

Two new modules hold the tags (`markdownSourceTags.ts`) and the parser extensions (`markdownSourceSyntax.ts`). `theme.ts` gets the per-scheme colours, `languages.ts` wires the extensions in, the look test is rewritten, and the CodeEditor and MarkdownEditor docs and the unreleased changelog entry are amended. A `markdown` fenced code block in the `Markdown` viewer uses the same language ([Markdown.ts:1293](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1293)) and changes the same way.

---

## Architecture Decisions

In the tables of this plan a `\|` inside code stands for one `|` and a `\\|` for `\|`, as a table cell needs them written; `⏎` is a line end and `␠` a space.

### Decided before this plan — the five rules

These were decided by the user and are recorded here as given:

1. **No rendered look.** No range is bold, italic, underlined or sized.
2. **Every colour is readable.** Each colour source mode uses, the text colour included, reaches at least 4.5 : 1 (WCAG AA for normal text) against the editor background, in the light and the dark theme. This replaces the previous branch's rule that no range may lose contrast.
3. **A distinct colour per kind of non-text Markdown, content in the text colour.**
4. **The dialect's syntax needs grammar support**, through Markdown-only parser extensions that do not change how source mode's commands, places or Enter read the document.
5. **Other languages keep their look**, in both themes.

### The seven kinds of non-text Markdown

Source mode sorts every non-text range into one of seven kinds, each with its own tag and colour.[^kinds] Everything else is content and keeps the text colour.

- Before: three hints — marks grey, heading text blue, code green — and everything else, URLs, HTML and the dialect included, in the text colour or the `html` language's colours.
- After: seven kinds, each in its own colour:

| Kind (the look test's word) | Colour | What takes it | Example |
|---|---|---|---|
| inline mark | grey | `*` `_` `**` `***` `~~` `++`, a code span's backticks, a link's or image's `[` `]` `](` `)` `![`, an autolink's `<` `>`, a definition's `:` | `**b**`: both `**` |
| block mark | violet | `#` runs and setext underlines, `>`, list markers, task boxes, thematic breaks, a code fence's lines with their info string | `# H`: `#` |
| destination | teal | a URL (inline link, image, autolink, definition), a reference label (`[label]`, `[]`), a definition's `[label]` | `[a](u)`: `u` |
| escape | orange | a backslash escape, a backslash hard break, a character reference | `\*`, `&amp;` |
| html | rose | inline HTML tags, HTML blocks, HTML comments, processing instructions | `<span>` |
| dialect | gold | a `{…}` group after a span or an image, `:::` lines, `\|\|\|` lines, table pipes and delimiter rows, `<<` and `^^` merge cells | `[t]{color=red}`: `{color=red}` |
| code | green | the text of a code span, a fenced code block or an indented code block | `` `x` ``: `x` |

Consequences: a reader can tell structure (violet), inline syntax (grey), where links point (teal), raw HTML (rose) and the dialect (gold) apart at a glance, while prose stays the darkest (light theme) or brightest (dark theme) colour on the page. Recommendation, recorded as decided: these seven kinds.

### Content keeps the text colour — headings and quotes included

Heading text, the text of a quote, link text, image alt text, emphasised and struck-through text, link titles, table cells and the text between a fence's lines take the text colour. The heading's blue and the quote's grey wash from the previous branch go.[^heading-quote]

| Source | Before (previous branch) | After |
|---|---|---|
| `# MarkdownEditor` | `#` grey, `␠MarkdownEditor` blue | `#` block mark, `␠MarkdownEditor` plain |
| `> q *e* [l](u)` | the whole line grey | `>` block mark, `q`, `e`, `l` plain, `*` `[` `](` `)` inline marks, `u` destination |

Consequences: a heading is found by its violet `#` run; links, code and escapes in a quote keep their colours. Recommendation, recorded as decided: no heading or quote hint.

### The palette — measured, one set per scheme

The shared palette has no colour that reaches 4.5 : 1 on both backgrounds, so source mode has its own colours, one set for the light scheme and one for the dark.[^palette]

- Before: one palette for both schemes; on the dark background its blue is 2.85 : 1 and its grey 3.05 : 1.
- After: the sets below. Ratios are on the editor background, then on the active line (next decision).

| Kind | Light | Ratio | Dark | Ratio |
|---|---|---|---|---|
| text (`--ts-ui-text-color`) | `rgb(0, 0, 0)` | 21.00 / 19.22 | `rgb(220, 220, 220)` | 10.75 / 9.77 |
| inline mark | `#6e6e6e` grey | 5.10 / 4.67 | `#989898` grey | 5.11 / 4.64 |
| block mark | `#893ee0` violet | 5.48 / 5.02 | `#ba96f9` violet | 6.19 / 5.63 |
| destination | `#1a7479` teal | 5.50 / 5.03 | `#2eb9c0` teal | 6.19 / 5.62 |
| escape | `#a65217` orange | 5.47 / 5.00 | `#f98b46` orange | 6.18 / 5.62 |
| html | `#c92055` rose | 5.50 / 5.03 | `#f98498` rose | 6.17 / 5.60 |
| dialect | `#7b6817` gold | 5.48 / 5.01 | `#c3a629` gold | 6.18 / 5.62 |
| code | `#407616` green | 5.50 / 5.03 | `#6abc29` green | 6.20 / 5.64 |

The backgrounds are `--ts-ui-input-bg`: `rgb(255, 255, 255)` in ModernTheme and ClassicTheme, `rgb(40, 40, 40)` in DarkTheme. Every two colours of a set, the text colour included, differ by a CIEDE2000 distance of at least 18; the destination teal is 26 (light) and 23 (dark) from the viewer's link blue. Consequences: every range of source mode is readable in every shipped theme; the grey marks are the most muted colour, so the text reads over them. Recommendation, recorded as decided: this palette.

### Contrast is measured on the background and on the active line

Each colour must reach 4.5 : 1 both on the editor background and on the active line, the line holding the caret, which `theme.ts` tints `rgba(127, 127, 127, 0.08)` ([theme.ts:153-155](packages/lib/src/typescript/lib/component/editor/theme.ts#L153)).[^active-line]

- Before: the shared grey `#6b7280` passes on white (4.83 : 1) and fails on the active line (4.43 : 1).
- After: the inline-mark grey `#6e6e6e` is 5.10 : 1 on white and 4.67 : 1 on the active line.

Consequences: the line being typed on is as readable as the rest. Brief tints — a search match, a selection match, a matching bracket, the reveal flash — are not measured. Recommendation, recorded as decided: measure both.

### The colours are constants per scheme in `theme.ts`, not theme tokens

The two colour sets are `MARKDOWN_SOURCE_LIGHT` and `MARKDOWN_SOURCE_DARK` in `theme.ts`, and `syntaxStyles(dark)` builds the rule list for one scheme. `codeEditorTheme(dark)` already builds one theme per `dark` value ([theme.ts:124-131](packages/lib/src/typescript/lib/component/editor/theme.ts#L124)); it now passes `dark` on.[^no-tokens]

- Before: `HighlightStyle.define(SYNTAX_STYLES)` — one rule list for both schemes.
- After: `HighlightStyle.define(syntaxStyles(dark))` — the shared rules, then the Markdown rules in that scheme's colours.

Consequences: a theme switch already rebuilds the editor's theme extension with the new `dark` flag ([CodeEditor.ts:2946-2948](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2946)), so source mode recolours with it. Still two `HighlightStyle` builds, one per scheme. A custom theme cannot retune these colours, and a custom theme with a dark background but `colorScheme: 'light'` gets the light set. Recommendation, recorded as decided: constants per scheme.

### Seven new tags that only the `markdown` language emits

`markdownSourceTags.ts` defines one tag per kind with `Tag.define`, and the Markdown nodes are given these tags. No lezer standard tag carries a source-mode colour.[^tag-define]

- Before: a list marker carries `processingInstruction`, which also colours the `html` language's `<?…?>`.
- After: a list marker carries `MARKDOWN_SOURCE_TAGS.blockMark`, which no other grammar can emit.

Consequences: a rule for one of these tags changes no other language by construction; the structural test still checks it. A grammar a consumer registers cannot use these colours. Recommendation, recorded as decided: new tags.

### lezer's own Markdown nodes are retagged in place

`MARKDOWN_SOURCE_RETAGS` gives lezer's nodes the new tags through the parser's `props`, as `linkTitleTagExtension` retags `LinkTitle` ([languages.ts:555-569](packages/lib/src/typescript/lib/component/editor/languages.ts#L555)). Every rule names its nodes with no parent path, so it replaces lezer's rule for them.[^context-rule] A fenced code block hands the block-mark tag to everything in it (`"FencedCode/..."`), and the theme lists the code rule after the block-mark rule, so the fence's lines are block marks and its code stays code.

| Source | Ranges |
|---|---|
| `` ```js⏎let a⏎``` `` | ```` ```js⏎ ```` block mark · `let a` code · ```` ⏎``` ```` block mark |
| `` `**bold**` `` | `` ` `` inline mark · `**bold**` code · `` ` `` inline mark |

Consequences: inline backticks and fence backticks are the same lezer node, `CodeMark`, yet take different colours. Recommendation, recorded as decided: retag in place, fences by inheritance.

### HTML is drawn whole in the HTML colour

An HTML block, an inline HTML tag and an HTML comment block are drawn whole in the HTML colour: their rule ends in `!`, which stops the highlighter from entering the HTML parsed inside them.[^html-opaque]

| Source | Before (previous branch) | After |
|---|---|---|
| `<span style="color: red">s</span>` | `span` blue, `style` pink, `color` pink, `red` blue | `<span style="color: red">` html · `s` plain · `</span>` html |
| `<script>⏎let a = 1;⏎</script>` | JavaScript colours | the whole block html |

Consequences: tag names, attributes and values share one colour, and the text inside an HTML block is rose too. JavaScript and CSS inside `<script>`, `<style>` or a `style=` attribute — which would otherwise keep their own languages' colours, below 4.5 : 1 in the dark theme — are rose. The HTML trees themselves are unchanged, so tag completion, Enter in HTML and `isBetweenPair` read them as before. Recommendation, recorded as decided: HTML whole.

### HTML comments lose their slant

An HTML comment is an html range like any other: rose and upright.[^comment-italic]

- Before: `<!-- c -->` grey italic.
- After: `<!-- c -->` html.

Consequences: no range of source mode is italic. Recommendation, recorded as decided: no italic.

### The shared rules keep only what other languages use

The shared rule list loses the rules only Markdown used — heading blue, code green (`monospace`), link `inherit`, quote and thematic-break grey — and keeps the eight language rules and the `processingInstruction` grey the `html` language's `<?…?>` needs. It becomes `SHARED_SYNTAX_STYLES`, the first nine rules of both schemes.[^shared-removal]

- Before: 13 rules, five of them for Markdown.
- After: 9 shared rules, then 7 Markdown rules per scheme.

Consequences: the seven built-in languages other than Markdown look as before in both themes (the look test pins JavaScript, HTML and CSS, and a structural test checks no other grammar emits a removed or new tag). A grammar registered through `registerLanguage` that emits `heading`, `strong`, `emphasis`, `link`, `url`, `monospace`, `quote` or `contentSeparator` no longer gets any colour, weight, slant or underline for them. Recommendation, recorded as decided: remove them.

### `:::` and `|||` lines are read inline, where they stand

A `:::` line and a `|||` line become `ColonFence` and `ColumnSeparator` nodes inside the paragraph, list item or quote text that holds them. A line counts when only spaces and tabs stand before it on its line within the inline text. A `:::` line runs to its line end (label and `{…}` group included); a `|||` line must be exactly `|||`, with blanks around it.[^inline-lines]

| Source | Ranges |
|---|---|
| `::: columns⏎Left column.⏎\|\|\|⏎Right column.⏎:::` | `::: columns` dialect · `⏎Left column.⏎` plain · `\|\|\|` dialect · `⏎Right column.⏎` plain · `:::` dialect |
| `\|\|\| x` | the whole line plain |
| `\\|\|\|` | `\\|` escape · `\|\|` plain |

Consequences: no paragraph, list item or quote changes extent, so Enter and Backspace read every container as before. The viewer reads these lines in a pass of its own, so a `|||` directly under a paragraph's text splits the columns there too, and the grammar agrees. A few lines the viewer reads as text are coloured anyway; see the known differences below. Recommendation, recorded as decided: inline nodes.

### A `{…}` group is coloured after a span or an image only

An attribute group is `{`, anything but a brace, `}`, directly after an image or after a link whose last character is `]` (a `[text]{…}` span is a link to this grammar). The parser asks lezer's inline state which element it read last; that state, `parts`, is internal, so the read is typed through a small interface and, when it is missing, no group is coloured.[^parts]

| Source | Group |
|---|---|
| `[coloured]{color=#cc0000}` | dialect |
| `![a](u){w=1}`, `![a][l]{w=1}`, `![l]{w=1}` | dialect |
| `[a][b]{c}` | dialect |
| `[a](u){x}` | plain |
| `f(x){y}`, `\]{x}`, `` `code`{x} `` | plain |

Consequences: the groups the viewer reads are coloured, and prose braces are not. The read mirrors `readQuoteContinuationTabs` ([markdownTabStops.ts:234-285](packages/lib/src/typescript/lib/component/editor/markdownTabStops.ts#L234)), which reads another lezer internal behind an interface and leaves the parser as it is when it is gone. Recommendation, recorded as decided: read `parts`.

### Tables come from the dialect's own leaf parser

`MARKDOWN_TABLES` reads a paragraph-like block as a table when its second line is a delimiter row with as many cells as its first, as the viewer's `tokenizeTable` does ([markdownTableExtension.ts:252](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L252)). It is lezer's GFM table parser re-written, with the viewer's delimiter row: each cell `:?-+:?` with an optional `{…}` group, and a `:` or `|` somewhere on the row.[^tables] Pipes, the whole delimiter row and merge cells take the dialect tag; cells keep the text colour.

| Source | Reading |
|---|---|
| `\| a \| b \|⏎\| --- \| --- \|⏎\| c \| d \|` | table |
| `\| :--- {width=160} \| :---: \|` as the delimiter row | table; the whole row dialect |
| `a⏎:--` | one-column table |
| `a⏎---` | setext heading |
| `\| a \| b \|⏎\| - \|` | text: the cell counts differ |
| `para⏎\| a \| b \|⏎\| - \| - \|` | text: a table does not interrupt a paragraph |

A body cell of only `<<` is a merge cell past the first column; one of only `^^` is past the first body row. Elsewhere it is text, as the viewer renders it.

Consequences: a table takes the place of the paragraph its lines made, with the same extent and the same folding (`foldNodeProp`, as `@codemirror/lang-markdown` folds its own GFM table). Recommendation, recorded as decided: the dialect's own table parser.

### `~~strike~~` follows GFM and `++underline++` follows the viewer

`MARKDOWN_STRIKETHROUGH` re-writes lezer's GFM `Strikethrough` extension: exactly two tildes, with the flanking rule of `*`. `MARKDOWN_UNDERLINE` reads the viewer's pattern, `++`, text holding no `+`, `++` ([markdownExtensions.ts:60-81](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L60)). Both marks take the inline-mark tag.[^strike]

| Source | Ranges |
|---|---|
| `~~strike~~` | `~~` inline mark · `strike` plain · `~~` inline mark |
| `~one~` | plain |
| `**++b++**` | `**++` inline mark · `b` plain · `++**` inline mark |
| `++a+b++` | plain |

Consequences: `~one~`, which the viewer strikes, stays text. Recommendation, recorded as decided: these two readings.

### What reads the source tree, and why each keeps working

The extensions add inline nodes and one block, `Table`, which takes a paragraph's place. Every reader of the `markdown` language's tree was checked:[^prototype]

| Reader | Nodes it reads | Why it is unaffected |
|---|---|---|
| `caretBlocksAt` ([languages.ts:235](packages/lib/src/typescript/lib/component/editor/languages.ts#L235)) | `FencedCode`, `CodeBlock`, `HTMLBlock`, `CommentBlock`, `Blockquote`, `ListItem` | none of them changes; a table sits in the same containers its paragraph did |
| `containerPrefixAt` ([languages.ts:269](packages/lib/src/typescript/lib/component/editor/languages.ts#L269)) | `ListMark`, `QuoteMark` | unchanged nodes |
| `isBetweenPair` ([languages.ts:312](packages/lib/src/typescript/lib/component/editor/languages.ts#L312)) | HTML's `OpenTag`, `CloseTag`; the text `()` `[]` `{}` | the HTML trees are unchanged; `!` affects highlighting only |
| `addContainerFirstLines` ([markdownTabStopCommands.ts:67](packages/lib/src/typescript/lib/component/editor/markdownTabStopCommands.ts#L67)) | `Blockquote`, `ListItem` | unchanged nodes |
| `@codemirror/lang-markdown` Enter and Backspace (`getContext`, `deleteMarkupBackward`) | `ListItem`, `Blockquote`, `BulletList`, `OrderedList`, `FencedCode`, `QuoteMark`, `ListMark` | unchanged nodes and extents |
| `@codemirror/lang-markdown` HTML tag completion | `CodeBlock`, `FencedCode`, `ProcessingInstructionBlock`, `CommentBlock`, `Link`, `Image` | unchanged; offered in a table cell or a fence line as in a paragraph |
| `@codemirror/lang-markdown` paste-a-URL-as-link | any node that starts inside the selection, or whose name holds `code`, `html`, `link`, `mark`, `url` and the like | a selection inside a cell, a fence line or struck text pastes as in a paragraph; one that crosses a new node is refused, as one that crosses any node already is |
| folding (`foldNodeProp` on lezer's blocks, the heading fold service) | `Paragraph` and the other blocks, headings | `Table` gets the paragraph's fold through `MARKDOWN_TABLES`'s `props` |
| `CodeEditor`'s `bracketMatching` | the node type at both brackets | a `{…}` group and a table cell are one node each, as their paragraph was |
| `syntaxDiagnostics.ts` | error nodes | not run for `markdown`, which has no lint source |
| source mode's commands and places (`markdownSourceTokens.ts`, `markdownSourceEdits.ts`, `markdownSourcePlaces.ts`, `markdownSourceLines.ts`) | `marked` tokens | they do not read this tree |

Consequences: Enter, Backspace, folding, tag completion and source mode's commands behave as before. Recommendation, recorded as decided: no further guard; the editor suites listed in `## Verification` cover these paths.

### Known differences from the viewer, accepted

The grammar reads a few constructs differently from the viewer. Each is a colour difference only, and each has a row in the look test that pins the grammar's reading.

| Source | Viewer | Source mode |
|---|---|---|
| `> a⏎> \|\|\|` | `\|\|\|` is quote text | `\|\|\|` dialect |
| `text⏎::: x` | `::: x` is paragraph text | `::: x` dialect |
| `# :::` | heading text | `:::` dialect |
| a `:::` or `\|\|\|` line outside any fence, or inside an HTML block | text, or a fence line | dialect, or html |
| `para⏎\| a \| b \|⏎\| - \| - \|` | a table after the paragraph | text |
| `~one~` | struck through | text |
| `https://example.com` | a link | text |
| a `<<` or `^^` that cannot make a whole rectangle | text | dialect |

Recommendation, recorded as decided: accept these.

### The look test names looks by kind, in both themes

`markdown-source-look.test.ts` reads looks as before, with a highlighter built from one scheme's rules, and names a Markdown colour by its kind (`block mark`, `dialect`). Every row runs in both schemes and must give the same words, and a test ties each word to its colour in each scheme.[^test-design]

- Before: `sourceLooks('# H')` returns `[['#', 'grey'], [' H', 'blue']]`, light rules only.
- After: `sourceLooks('# H', 'markdown', scheme)` returns `[['#', 'block mark'], [' H', 'plain']]` for both schemes.

The "no range has less contrast than before" test and its `PREVIOUS_STYLES` go; a contrast test asserts 4.5 : 1 for every character of the corpus, the demo sample and the rows, in both schemes, on the background and the active line. Recommendation, recorded as decided: this test design.

---

## Internal Structure

The code below was run in a prototype of this plan; every row of `## Expected Behaviour` passes with it.[^prototype] Copy it as given.

### `component/editor/markdownSourceTags.ts` (new)

```ts
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The highlighting tags only the built-in "markdown" language emits. Each
// names one kind of non-text Markdown, which the editor theme (theme.ts)
// colours. Tags defined here are new tags, not lezer's standard ones, so no
// other grammar can emit them and a rule for them changes no other language.
// `@lezer/highlight` is loaded by theme.ts, which CodeEditor imports, so this
// module adds nothing to the editor chunk.

import { Tag } from "@lezer/highlight";

/**
 * The kinds of non-text Markdown that source mode colours, one tag each.
 *
 * @internal Shared by `languages.ts`, `markdownSourceSyntax.ts` and `theme.ts`, not part of the public API surface.
 */
export const MARKDOWN_SOURCE_TAGS = {
    /** Marks inside a line: `*`, `**`, `~~`, `++`, a code span's backticks, a link's brackets and parentheses, an autolink's `<` `>`, a definition's `:`. */
    inlineMark:  Tag.define("markdownInlineMark"),
    /** Marks that make a block: `#` runs and setext underlines, `>`, list markers, task boxes, thematic breaks, code-fence lines. */
    blockMark:   Tag.define("markdownBlockMark"),
    /** Where a link points: a URL, a reference label, and both halves of a link reference definition. */
    destination: Tag.define("markdownDestination"),
    /** A backslash escape, a backslash hard break, and a character reference such as `&amp;`. */
    escape:      Tag.define("markdownEscape"),
    /** Inline HTML tags, and HTML blocks, HTML comments and processing instructions whole. */
    html:        Tag.define("markdownHtml"),
    /** The dialect's own syntax and tables: `{…}` groups, `:::` and `|||` lines, `<<` and `^^` cells, table pipes and delimiter rows. */
    dialect:     Tag.define("markdownDialect"),
    /** The text of a code span or a code block. */
    code:        Tag.define("markdownCode"),
} as const;
```

### `component/editor/markdownSourceSyntax.ts` (new)

```ts
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The parser configurations that let the built-in "markdown" language tag
// every kind of non-text Markdown for source mode's colours (theme.ts).
// `languages.ts` passes them to `markdown({ extensions })`. One retags
// lezer's own nodes; the others read what CommonMark does not: the dialect's
// `{…}` groups, `:::` and `|||` lines, `++underline++`, `~~strike~~` and
// tables. None of them changes a block lezer already reads, so Enter,
// Backspace and folding read the document as before; a table is the one new
// block, and it takes the place, and the folding, of the paragraph it was.
// `@lezer/highlight` and `@codemirror/language` are loaded by theme.ts and
// CodeEditor, so importing this module loads no grammar package.

import { styleTags } from "@lezer/highlight";
import { foldNodeProp } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { BlockParser, MarkdownConfig } from "~/component/editor/markdownTabStops.js";
import { MARKDOWN_SOURCE_TAGS } from "~/component/editor/markdownSourceTags.js";

/** An inline parser of a parser configuration. */
type InlineParser = NonNullable<MarkdownConfig["parseInline"]>[number];

/** The inline parse state an inline parser is given. */
type InlineContext = Parameters<InlineParser["parse"]>[0];

/** A syntax element an inline or block parser builds. */
type Element = ReturnType<InlineContext["elt"]>;

/** The parser of a leaf block (a paragraph's text) that a block parser's `leaf` hands out. */
type LeafParser = NonNullable<ReturnType<NonNullable<BlockParser["leaf"]>>>;

/** The parse state, the line and the leaf block a leaf parser's `nextLine` is given. */
type LeafNextLine = Parameters<LeafParser["nextLine"]>;

/** The block parse state. */
type BlockContext = LeafNextLine[0];

/** The leaf block a leaf parser reads. */
type LeafBlock = LeafNextLine[2];

/** Character codes the parsers compare against, as `InlineContext.char` returns them. */
const NEWLINE       = "\n".charCodeAt(0);
const SPACE         = " ".charCodeAt(0);
const TAB           = "\t".charCodeAt(0);
const TILDE         = "~".charCodeAt(0);
const PLUS          = "+".charCodeAt(0);
const OPEN_BRACE    = "{".charCodeAt(0);
const CLOSE_BRACKET = "]".charCodeAt(0);
const COLON         = ":".charCodeAt(0);
const PIPE          = "|".charCodeAt(0);
const BACKSLASH     = "\\".charCodeAt(0);

/**
 * Gives lezer's own Markdown nodes the source-mode tags, in place of the
 * standard tags `@lezer/markdown` gives them. Each rule names its nodes with
 * no parent path, so it replaces lezer's rule for them instead of sitting
 * behind it. A fenced code block passes the block-mark tag to everything in
 * it (`/...`): its fence lines and info string take it, and its code takes
 * the code tag's colour, which the theme lists later. An HTML block, an
 * inline tag and an HTML comment block are drawn whole in the HTML colour
 * (`!`), so the HTML parsed inside them — and the JavaScript or CSS inside a
 * `<script>`, a `<style>` or a `style=` attribute — is not drawn in its own
 * language's colours.
 */
export const MARKDOWN_SOURCE_RETAGS: MarkdownConfig = {
    props: [
        styleTags({
            "HeaderMark QuoteMark ListMark HorizontalRule":                     MARKDOWN_SOURCE_TAGS.blockMark,
            "FencedCode/...":                                                   MARKDOWN_SOURCE_TAGS.blockMark,
            "EmphasisMark LinkMark CodeMark":                                   MARKDOWN_SOURCE_TAGS.inlineMark,
            "HardBreak Escape Entity":                                          MARKDOWN_SOURCE_TAGS.escape,
            "URL Autolink LinkLabel":                                           MARKDOWN_SOURCE_TAGS.destination,
            "InlineCode CodeText":                                              MARKDOWN_SOURCE_TAGS.code,
            "HTMLBlock! HTMLTag! CommentBlock!":                                MARKDOWN_SOURCE_TAGS.html,
            "Comment ProcessingInstruction ProcessingInstructionBlock":         MARKDOWN_SOURCE_TAGS.html,
        }),
    ],
};

/**
 * A character a delimiter's flanking test counts as punctuation: Unicode
 * punctuation and symbols, the class `@lezer/markdown` uses for `~~`.
 */
const PUNCTUATION = /[\p{S}\p{P}]/u;

/** A blank, or no character at all (the edge of the text). */
const BLANK_OR_EDGE = /\s|^$/;

/** The delimiter `~~` adds: matched pairs wrap their content in a `Strikethrough` node and become `StrikethroughMark`s. */
const STRIKETHROUGH_DELIMITER = { resolve: "Strikethrough", mark: "StrikethroughMark" };

/**
 * `~~strike~~`, read as GitHub Flavored Markdown reads it and as
 * `@lezer/markdown`'s own `Strikethrough` extension does (that package is not
 * a direct dependency, so its extension is not imported): a run of exactly
 * two tildes that can open or close by the same flanking rule as `*`. The
 * marks take the inline-mark tag; the text keeps the text colour.
 */
export const MARKDOWN_STRIKETHROUGH: MarkdownConfig = {
    defineNodes: [
        { name: "Strikethrough" },
        { name: "StrikethroughMark", style: MARKDOWN_SOURCE_TAGS.inlineMark },
    ],
    parseInline: [{
        name: "Strikethrough",
        parse: parseStrikethroughMark,
        after: "Emphasis",
    }],
};

/**
 * Adds a `~~` delimiter at a position, when two tildes and no third stand
 * there.
 *
 * @param cx - The inline parse state.
 * @param next - The character code at `pos`.
 * @param pos - The position.
 * @returns The end of the delimiter, or `-1` when none starts here.
 */
function parseStrikethroughMark(cx: InlineContext, next: number, pos: number): number {
    if (next !== TILDE || cx.char(pos + 1) !== TILDE || cx.char(pos + 2) === TILDE) {
        return -1;
    }

    const before        = cx.slice(pos - 1, pos);
    const after         = cx.slice(pos + 2, pos + 3);
    const blankBefore   = BLANK_OR_EDGE.test(before);
    const blankAfter    = BLANK_OR_EDGE.test(after);
    const punctBefore   = PUNCTUATION.test(before);
    const punctAfter    = PUNCTUATION.test(after);
    const opens         = !blankAfter && (!punctAfter || blankBefore || punctBefore);
    const closes        = !blankBefore && (!punctBefore || blankAfter || punctAfter);

    return cx.addDelimiter(STRIKETHROUGH_DELIMITER, pos, pos + 2, opens, closes);
}

/**
 * `++underline++` as the viewer reads it (`markdownExtensions.ts`'s
 * underline tokenizer): `++`, text holding no `+`, `++`. Sticky, so it is
 * tried at one position of the inline text.
 */
const UNDERLINE = /\+\+([^+]+)\+\+/y;

/** The length of each `++` mark. */
const UNDERLINE_MARK_LENGTH = 2;

/**
 * `++underline++`: an `Underline` node holding two `UnderlineMark`s and the
 * text between them, read inline. The marks take the inline-mark tag.
 */
export const MARKDOWN_UNDERLINE: MarkdownConfig = {
    defineNodes: [
        { name: "Underline" },
        { name: "UnderlineMark", style: MARKDOWN_SOURCE_TAGS.inlineMark },
    ],
    parseInline: [{
        name: "Underline",
        parse: parseUnderline,
        after: "Emphasis",
    }],
};

/**
 * Reads an underline that starts at a position.
 *
 * @param cx - The inline parse state.
 * @param next - The character code at `pos`.
 * @param pos - The position.
 * @returns The end of the underline, or `-1` when none starts here.
 */
function parseUnderline(cx: InlineContext, next: number, pos: number): number {
    if (next !== PLUS) {
        return -1;
    }

    UNDERLINE.lastIndex = pos - cx.offset;

    const match = UNDERLINE.exec(cx.text);

    if (match === null) {
        return -1;
    }

    const end       = pos + match[0].length;
    const textStart = pos + UNDERLINE_MARK_LENGTH;

    return cx.addElement(cx.elt("Underline", pos, end, [
        cx.elt("UnderlineMark", pos, textStart),
        ...cx.parser.parseInline(match[1]!, textStart),
        cx.elt("UnderlineMark", end - UNDERLINE_MARK_LENGTH, end),
    ]));
}

/**
 * An attribute group: `{`, anything but a brace, `}` — the viewer's group
 * after a span (`markdownExtensions.ts`'s styled-span tokenizer) and after an
 * image (its `IMAGE_ATTRIBUTE_GROUP`). Sticky, so it is tried at one position.
 */
const ATTRIBUTE_GROUP = /\{[^{}]*\}/y;

/**
 * The one member of `@lezer/markdown`'s `InlineContext` that
 * {@link followsSpanOrImage} reads. `parts`, the elements and delimiters read
 * so far, is internal: it is in no type declaration, and may be renamed by any
 * release. A link or an image is an element there as soon as its closing
 * `]` or `)` is read: its node type's id and its end.
 */
interface InlineContextInternals {
    readonly parts?: ReadonlyArray<{ readonly type: unknown; readonly to: number } | null>;
}

/**
 * Tells whether a position directly follows an image, or a link whose last
 * character is `]` — the two things the viewer reads a `{…}` group after (a
 * `[text]{…}` span is a link to this grammar). A link that ends with `)`
 * takes no group. When the parse state has no `parts`, as in a release that
 * renamed it, no group is read, and groups stay in the text colour.
 *
 * @param cx - The inline parse state.
 * @param pos - The position.
 * @returns `true` when the element read last is such an image or link and ends at `pos`.
 */
function followsSpanOrImage(cx: InlineContext, pos: number): boolean {
    const parts = (cx as unknown as InlineContextInternals).parts;
    const last  = parts === undefined ? null : parts[parts.length - 1];

    if (last === null || last === undefined || last.to !== pos || typeof last.type !== "number") {
        return false;
    }

    const name = cx.parser.nodeSet.types[last.type]?.name;

    return name === "Image" || (name === "Link" && cx.char(pos - 1) === CLOSE_BRACKET);
}

/**
 * Reads an attribute group that starts at a position, directly after a span
 * or an image.
 *
 * @param cx - The inline parse state.
 * @param next - The character code at `pos`.
 * @param pos - The position.
 * @returns The end of the group, or `-1` when none starts here.
 */
function parseAttributeGroup(cx: InlineContext, next: number, pos: number): number {
    if (next !== OPEN_BRACE) {
        return -1;
    }

    ATTRIBUTE_GROUP.lastIndex = pos - cx.offset;

    const match = ATTRIBUTE_GROUP.exec(cx.text);

    if (match === null || !followsSpanOrImage(cx, pos)) {
        return -1;
    }

    return cx.addElement(cx.elt("AttributeGroup", pos, pos + match[0].length));
}

/**
 * The `{…}` group after a span or an image: an `AttributeGroup` node with
 * the dialect tag. The groups of a table's delimiter row and of a `:::` line
 * are part of those lines' own nodes.
 */
export const MARKDOWN_ATTRIBUTE_GROUPS: MarkdownConfig = {
    defineNodes: [{ name: "AttributeGroup", style: MARKDOWN_SOURCE_TAGS.dialect }],
    parseInline: [{ name: "AttributeGroup", parse: parseAttributeGroup }],
};

/** What opens or closes a `:::` fence: a line whose text, trimmed, starts with these (`markdownExtensions.ts`'s block tokenizer). */
const COLON_FENCE = ":::";

/** The line that splits a `:::` fence into columns: exactly these, trimmed (`COLUMN_SEPARATOR` in `markdownAttributes.ts`). */
const COLUMN_SEPARATOR = "|||";

/**
 * Tells whether a position starts the text of its line within the inline
 * text: only spaces and tabs stand between it and the line break before it,
 * or the start of the inline text. Inside a blockquote, the inline text holds
 * spaces where a later line's `>` stands, so a `>` does not count.
 *
 * @param cx - The inline parse state.
 * @param pos - The position.
 * @returns `true` when nothing but spaces and tabs stands before it on its line.
 */
function startsLineText(cx: InlineContext, pos: number): boolean {
    for (let at = pos - 1; at >= cx.offset; at--) {
        const code = cx.char(at);

        if (code === NEWLINE) {
            return true;
        }

        if (code !== SPACE && code !== TAB) {
            return false;
        }
    }

    return true;
}

/**
 * Finds where the line holding a position ends within the inline text.
 *
 * @param cx - The inline parse state.
 * @param pos - The position.
 * @returns The position of the line break after it, or the end of the inline text.
 */
function lineEndAfter(cx: InlineContext, pos: number): number {
    const index = cx.text.indexOf("\n", pos - cx.offset);

    return index === -1 ? cx.end : cx.offset + index;
}

/**
 * Reads a `:::` line — a fence's opening line with its label and group, or
 * its closing line — as one `ColonFence` node.
 *
 * @param cx - The inline parse state.
 * @param next - The character code at `pos`.
 * @param pos - The position.
 * @returns The end of the line, or `-1` when no `:::` line starts here.
 */
function parseColonFence(cx: InlineContext, next: number, pos: number): number {
    const isFenceLine = next === COLON && cx.slice(pos, pos + COLON_FENCE.length) === COLON_FENCE && startsLineText(cx, pos);

    return isFenceLine ? cx.addElement(cx.elt("ColonFence", pos, lineEndAfter(cx, pos))) : -1;
}

/**
 * Reads a `|||` line, the line that starts a fence's next column, as one
 * `ColumnSeparator` node; spaces and tabs may stand around it.
 *
 * @param cx - The inline parse state.
 * @param next - The character code at `pos`.
 * @param pos - The position.
 * @returns The end of the `|||`, or `-1` when no `|||` line starts here.
 */
function parseColumnSeparator(cx: InlineContext, next: number, pos: number): number {
    const end = pos + COLUMN_SEPARATOR.length;
    const isSeparator = next === PIPE && cx.slice(pos, end) === COLUMN_SEPARATOR && startsLineText(cx, pos)
        && cx.slice(end, lineEndAfter(cx, pos)).trim() === "";

    return isSeparator ? cx.addElement(cx.elt("ColumnSeparator", pos, end)) : -1;
}

/**
 * The `:::` and `|||` lines of the dialect's fences, with the dialect tag.
 * They are read inline, where they stand in a paragraph's text, so that a
 * paragraph, a list item or a quote holding one keeps the extent lezer gives
 * it: the viewer reads these lines in a pass of its own before it reads
 * blocks, so one directly under a paragraph's text still counts.
 */
export const MARKDOWN_FENCE_LINES: MarkdownConfig = {
    defineNodes: [
        { name: "ColonFence",      style: MARKDOWN_SOURCE_TAGS.dialect },
        { name: "ColumnSeparator", style: MARKDOWN_SOURCE_TAGS.dialect },
    ],
    parseInline: [
        { name: "ColonFence",      parse: parseColonFence },
        { name: "ColumnSeparator", parse: parseColumnSeparator },
    ],
};

/** A delimiter row's cell: dashes with an optional colon at each end, then an optional `{…}` group (`markdownTableExtension.ts`). */
const DELIMITER_CELL = /^(:?-+:?)(?:\s*\{[^{}]*\})?$/;

/** A delimiter row must hold a colon or a pipe, so a line over `---` stays a setext heading (`markdownTableExtension.ts`). */
const DELIMITER_ROW_MARKER = /[:|]/;

/** A body cell that merges into the cell to its left (`<<`) or above it (`^^`). */
const MERGE_CELL = /^(?:<<|\^\^)$/;

/** A table row split at its pipes: each cell's trimmed range and each unescaped pipe, as positions in the row's text. */
interface RowSplit {
    readonly cells: ReadonlyArray<{ readonly from: number; readonly to: number }>;
    readonly pipes: readonly number[];
}

/**
 * Splits a table row at its unescaped pipes, as the viewer does: a leading
 * and a trailing pipe bound the row and make no cell, and each cell is
 * trimmed. A cell between two pipes with only blanks in it is empty, with
 * `from === to`. A pipe inside a code span splits the row too, as in the
 * viewer.
 *
 * @param text - The row's line.
 * @param start - Where the row's text starts in the line, after any container marks.
 * @returns The cells and the pipes.
 */
function splitRow(text: string, start: number): RowSplit {
    const cells: Array<{ from: number; to: number }> = [];
    const pipes: number[] = [];
    let cellStart = -1;
    let cellEnd   = -1;
    let escaped   = false;
    let atStart   = true;

    for (let at = start; at < text.length; at++) {
        const code = text.charCodeAt(at);

        if (code === PIPE && !escaped) {
            if (cellStart > -1) {
                cells.push({ from: cellStart, to: cellEnd });
            } else if (!atStart) {
                cells.push({ from: at, to: at });
            }

            atStart   = false;
            cellStart = -1;
            cellEnd   = -1;
            pipes.push(at);
        } else if (escaped || (code !== SPACE && code !== TAB)) {
            cellStart = cellStart < 0 ? at : cellStart;
            cellEnd   = at + 1;
        }

        escaped = !escaped && code === BACKSLASH;
    }

    if (cellStart > -1) {
        cells.push({ from: cellStart, to: cellEnd });
    }

    return { cells, pipes };
}

/**
 * Counts the cells of a delimiter row.
 *
 * @param text - The line's text after any container marks.
 * @returns The number of cells, or `-1` when the line is not a delimiter row.
 */
function delimiterRowCells(text: string): number {
    if (!DELIMITER_ROW_MARKER.test(text)) {
        return -1;
    }

    const { cells } = splitRow(text, 0);
    const isDelimiterRow = cells.every((cell) => DELIMITER_CELL.test(text.slice(cell.from, cell.to)));

    return isDelimiterRow ? cells.length : -1;
}

/**
 * Builds the nodes of a header or body row: a `TableDelimiter` for each pipe,
 * a `TableCell` holding each cell's inline content, and a `TableMerge` for a
 * body cell of only `<<` or `^^` that can merge — `<<` past the first column,
 * `^^` past the first body row. Empty cells make no node.
 *
 * @param cx - The block parse state.
 * @param text - The row's line.
 * @param start - Where the row's text starts in the line.
 * @param offset - The document position of the line's first character.
 * @param bodyRow - The row's index among the body rows, or `-1` for the header row.
 * @returns The row's nodes, in document order.
 */
function rowNodes(cx: BlockContext, text: string, start: number, offset: number, bodyRow: number): Element[] {
    const { cells, pipes } = splitRow(text, start);
    const nodes: Element[] = pipes.map((pipe) => cx.elt("TableDelimiter", offset + pipe, offset + pipe + 1));

    cells.forEach((cell, column) => {
        const content = text.slice(cell.from, cell.to);

        if (content === "") {
            return;
        }

        const isMerge = MERGE_CELL.test(content) && bodyRow >= 0 && (content === "<<" ? column > 0 : bodyRow > 0);
        const from = offset + cell.from;
        const to   = offset + cell.to;

        nodes.push(isMerge ? cx.elt("TableMerge", from, to) : cx.elt("TableCell", from, to, cx.parser.parseInline(content, from)));
    });

    return nodes.sort((a, b) => a.from - b.from);
}

/**
 * Reads a paragraph-like leaf block as a table when its second line is a
 * delimiter row with as many cells as its first: the header row, the
 * delimiter row, then one body row per further line of the block, so the
 * table ends where the paragraph would. `@lezer/markdown`'s own `TableParser`,
 * which the package does not export, with the viewer's delimiter row (a
 * `{…}` group per cell, a colon or pipe required, a header with no pipe
 * allowed) and merge cells.
 */
class DialectTableParser implements LeafParser {
    /** `null` before the second line, `false` when the block is no table, otherwise the nodes read so far. */
    private _rows: Element[] | false | null = null;

    /** How many body rows have been read. */
    private _bodyRows = 0;

    /**
     * Reads the next line of the block; never ends the block itself.
     *
     * @param cx - The block parse state.
     * @param line - The line.
     * @param leaf - The leaf block, holding the first line.
     * @returns `false`, so the block goes on as a paragraph would.
     */
    nextLine(...[cx, line, leaf]: LeafNextLine): boolean {
        if (this._rows === null) {
            this._rows = this.readHeader(cx, line.text.slice(line.pos), cx.lineStart + line.pos, cx.lineStart + line.text.length, leaf);
        } else if (this._rows) {
            this._rows.push(cx.elt("TableRow", cx.lineStart + line.pos, cx.lineStart + line.text.length,
                rowNodes(cx, line.text, line.pos, cx.lineStart, this._bodyRows)));
            this._bodyRows++;
        }

        return false;
    }

    /**
     * Reads the header row and the delimiter row below it.
     *
     * @param cx - The block parse state.
     * @param delimiterText - The second line's text after any container marks.
     * @param delimiterFrom - Where that text starts in the document.
     * @param delimiterTo - Where the second line ends in the document.
     * @param leaf - The leaf block, holding the first line.
     * @returns The header and delimiter nodes, or `false` when the two lines start no table.
     */
    private readHeader(cx: BlockContext, delimiterText: string, delimiterFrom: number, delimiterTo: number, leaf: LeafBlock): Element[] | false {
        const columns = delimiterRowCells(delimiterText);

        if (columns < 0 || columns !== splitRow(leaf.content, 0).cells.length) {
            return false;
        }

        return [
            cx.elt("TableHeader", leaf.start, leaf.start + leaf.content.length, rowNodes(cx, leaf.content, 0, leaf.start, -1)),
            cx.elt("TableDelimiter", delimiterFrom, delimiterTo),
        ];
    }

    /**
     * Ends the block as a table when it is one.
     *
     * @param cx - The block parse state.
     * @param leaf - The leaf block.
     * @returns `true` when it added the table, `false` to leave the block to the next leaf parser.
     */
    finish(cx: BlockContext, leaf: LeafBlock): boolean {
        if (!this._rows) {
            return false;
        }

        cx.addLeafElement(leaf, cx.elt("Table", leaf.start, leaf.start + leaf.content.length, this._rows));

        return true;
    }
}

/**
 * Folds a table below its first line, as `@codemirror/lang-markdown` folds
 * any other multi-line block (and its own GFM table): a table was a
 * paragraph, which folded so.
 *
 * @param tree - The table node.
 * @param state - The editor state.
 * @returns The range to fold.
 */
function foldBelowFirstLine(tree: { from: number; to: number }, state: EditorState): { from: number; to: number } {
    return { from: state.doc.lineAt(tree.from).to, to: tree.to };
}

/**
 * Tables, with the dialect's delimiter row and merge cells. Pipes, the whole
 * delimiter row and merge cells take the dialect tag; header and body cells
 * keep the text colour. A table takes the place of the paragraph its lines
 * would make, so blocks around it read as before.
 */
export const MARKDOWN_TABLES: MarkdownConfig = {
    defineNodes: [
        { name: "Table", block: true },
        { name: "TableHeader" },
        { name: "TableRow" },
        { name: "TableCell" },
        { name: "TableDelimiter", style: MARKDOWN_SOURCE_TAGS.dialect },
        { name: "TableMerge",     style: MARKDOWN_SOURCE_TAGS.dialect },
    ],
    parseBlock: [{
        name: "DialectTable",
        leaf: () => new DialectTableParser(),
        before: "SetextHeading",
    }],
    props: [foldNodeProp.add({ Table: foldBelowFirstLine })],
};
```

### `component/editor/theme.ts`

Add this import after the `StyleRule` import at [theme.ts:8](packages/lib/src/typescript/lib/component/editor/theme.ts#L8):

```ts
import { MARKDOWN_SOURCE_TAGS } from "~/component/editor/markdownSourceTags.js";
```

Replace the whole `SYNTAX_STYLES` block — its doc comment, the list and the Markdown comment inside it, [theme.ts:23-61](packages/lib/src/typescript/lib/component/editor/theme.ts#L23) — with:

```ts
/**
 * The syntax-highlighting rules every `CodeEditor` language shares, in both
 * themes: each maps lezer tags to a look. A range takes every rule its tags
 * match, and a later rule wins where two set the same property. The
 * `processingInstruction` rule colours the `html` language's `<?…?>`.
 */
export const SHARED_SYNTAX_STYLES: readonly TagStyle[] = [
    { tag: tags.keyword,                                                    color: SYNTAX_KEYWORD },
    { tag: [tags.string, tags.special(tags.string)],                        color: SYNTAX_STRING },
    { tag: tags.comment,                                                    color: SYNTAX_COMMENT, fontStyle: "italic" },
    { tag: [tags.number, tags.bool, tags.null],                             color: SYNTAX_LITERAL },
    { tag: [tags.definition(tags.variableName), tags.function(tags.variableName)], color: SYNTAX_FUNCTION },
    { tag: tags.typeName,                                                   color: SYNTAX_TYPE },
    { tag: [tags.propertyName, tags.attributeName],                        color: SYNTAX_PROPERTY },
    { tag: tags.tagName,                                                    color: SYNTAX_KEYWORD },
    { tag: tags.processingInstruction,                                      color: SYNTAX_COMMENT },
];

/** One colour per kind of non-text Markdown, keyed as {@link MARKDOWN_SOURCE_TAGS} is. */
export type MarkdownSourceColours = Readonly<Record<keyof typeof MARKDOWN_SOURCE_TAGS, string>>;

// The colours of the `markdown` language's own tags, one set per scheme. The
// shared palette above has no colour that reaches 4.5 : 1 (WCAG AA for normal
// text) on both editor backgrounds, so source mode has its own. Each value was
// picked for that ratio on the editor background (`--ts-ui-input-bg`: white
// in ModernTheme and ClassicTheme, rgb(40, 40, 40) in DarkTheme) and on the
// active line's tint over it (`.cm-activeLine` below), and for a CIEDE2000
// difference of at least 18 from every other colour of its set and from the
// text colour. The six hues are spread round the colour wheel and keep clear
// of the viewer's link blue (`--ts-ui-indicator-focus`). Ratios are on the
// background, then on the active line.
export const MARKDOWN_SOURCE_LIGHT: MarkdownSourceColours = {
    inlineMark:  "#6e6e6e", // grey   5.10 / 4.67 — the most muted, so the text reads over its marks
    blockMark:   "#893ee0", // violet 5.48 / 5.02
    destination: "#1a7479", // teal   5.50 / 5.03
    escape:      "#a65217", // orange 5.47 / 5.00
    html:        "#c92055", // rose   5.50 / 5.03
    dialect:     "#7b6817", // gold   5.48 / 5.01
    code:        "#407616", // green  5.50 / 5.03
};

/** The dark scheme's set; see {@link MARKDOWN_SOURCE_LIGHT}. */
export const MARKDOWN_SOURCE_DARK: MarkdownSourceColours = {
    inlineMark:  "#989898", // grey   5.11 / 4.64
    blockMark:   "#ba96f9", // violet 6.19 / 5.63
    destination: "#2eb9c0", // teal   6.19 / 5.62
    escape:      "#f98b46", // orange 6.18 / 5.62
    html:        "#f98498", // rose   6.17 / 5.60
    dialect:     "#c3a629", // gold   6.18 / 5.62
    code:        "#6abc29", // green  6.20 / 5.64
};

/**
 * The syntax-highlighting rules of one scheme: the shared rules, then one
 * rule per kind of non-text Markdown. Only the `markdown` language emits the
 * tags of the Markdown rules, so they change no other language. Their order
 * matters where a fenced code block hands its block-mark tag to everything in
 * it: block mark after inline mark, so a fence's backticks are block marks,
 * and code after block mark, so the fence's code is code.
 *
 * @param dark - Whether the dark theme is active.
 * @returns The rules.
 */
export function syntaxStyles(dark: boolean): readonly TagStyle[] {
    const colours = dark ? MARKDOWN_SOURCE_DARK : MARKDOWN_SOURCE_LIGHT;

    return [
        ...SHARED_SYNTAX_STYLES,
        { tag: MARKDOWN_SOURCE_TAGS.inlineMark,  color: colours.inlineMark },
        { tag: MARKDOWN_SOURCE_TAGS.blockMark,   color: colours.blockMark },
        { tag: MARKDOWN_SOURCE_TAGS.destination, color: colours.destination },
        { tag: MARKDOWN_SOURCE_TAGS.escape,      color: colours.escape },
        { tag: MARKDOWN_SOURCE_TAGS.html,        color: colours.html },
        { tag: MARKDOWN_SOURCE_TAGS.dialect,     color: colours.dialect },
        { tag: MARKDOWN_SOURCE_TAGS.code,        color: colours.code },
    ];
}
```

In `codeEditorTheme`, change `HighlightStyle.define(SYNTAX_STYLES)` at [theme.ts:286](packages/lib/src/typescript/lib/component/editor/theme.ts#L286) to `HighlightStyle.define(syntaxStyles(dark))`. The palette constants at lines 10-21 stay as they are.

### `component/editor/languages.ts`

1. Extend the header comment's last sentence at [languages.ts:9-12](packages/lib/src/typescript/lib/component/editor/languages.ts#L9) so it reads:

   ```ts
   // external packages imported statically for their code,
   // `@codemirror/language`, `@codemirror/state` and `@codemirror/view`, are
   // ones `CodeEditor` itself imports, so they are in that chunk already; the
   // other static imports are this library's own modules, or types. Two of those
   // modules, `markdownSourceTags.ts` and `markdownSourceSyntax.ts`, import
   // `@lezer/highlight`, which `theme.ts` (and so `CodeEditor`) imports too.
   ```

2. After the `collectSyntaxErrors` import at line 30, add:

   ```ts
   import { MARKDOWN_SOURCE_TAGS } from "~/component/editor/markdownSourceTags.js";
   import {
       MARKDOWN_ATTRIBUTE_GROUPS, MARKDOWN_FENCE_LINES, MARKDOWN_SOURCE_RETAGS, MARKDOWN_STRIKETHROUGH, MARKDOWN_TABLES, MARKDOWN_UNDERLINE,
   } from "~/component/editor/markdownSourceSyntax.js";
   ```

3. In `taskMarkerExtension`, change `{ name: "TaskMarker", style: tags.processingInstruction }` (line 528) to `{ name: "TaskMarker", style: MARKDOWN_SOURCE_TAGS.blockMark }`, and replace the first sentence of its doc comment (lines 515-519) with:

   ```ts
    * Lezer's own `TaskList` extension with two changes: the leaf test is
    * {@link TASK_MARKER_LEAF}, the viewer's, and the `TaskMarker` node takes
    * the block-mark tag of a list's marker, so the editor theme colours `[ ]`
    * and `[x]` as it colours `-`. Built here, from the `tags` the caller
    * imports, so this module still loads no grammar package.
   ```

4. Replace the `markdown({ … })` call at lines 603-605 with:

   ```ts
           const support = markdown({
               htmlTagLanguage: literalHtml,
               extensions:      [
                   MARKDOWN_TAB_STOPS, taskMarkerExtension(tags), linkTitleTagExtension(tags, styleTags), MARKDOWN_SOURCE_RETAGS,
                   MARKDOWN_STRIKETHROUGH, MARKDOWN_UNDERLINE, MARKDOWN_ATTRIBUTE_GROUPS, MARKDOWN_FENCE_LINES, MARKDOWN_TABLES,
               ],
               addKeymap:       false,
           });
   ```

`literalHtml` (lines 590-596) does not change.

### `tests/component/markdown-source-look.test.ts` (rewritten)

The whole file is in `## Addendum: The Look Test File`; its `MARKDOWN_ROWS` entries are the test data in `## Expected Behaviour`. It keeps the previous file's `styleTagsByNode`, `parserOf` and the two structural tests at its end, with `MARKDOWN_ONLY_TAGS` widened.

---

## Ordered Implementation Steps

1. **Rewrite `packages/lib/tests/component/markdown-source-look.test.ts`** as `## Addendum: The Look Test File` gives, pasting the entries of `## Expected Behaviour`'s test data into `MARKDOWN_ROWS` where the addendum marks it. Check: from `packages/lib`, `npx vitest run tests/component/markdown-source-look.test.ts` fails to load, because `theme.ts` exports none of `syntaxStyles`, `SHARED_SYNTAX_STYLES`, `MARKDOWN_SOURCE_LIGHT` and `MARKDOWN_SOURCE_DARK`, and `markdownSourceTags.ts` does not exist.

2. **Create `packages/lib/src/typescript/lib/component/editor/markdownSourceTags.ts`** as `## Internal Structure` gives. Check: `grep -c 'Tag.define' packages/lib/src/typescript/lib/component/editor/markdownSourceTags.ts` prints `7`.

3. **Create `packages/lib/src/typescript/lib/component/editor/markdownSourceSyntax.ts`** as `## Internal Structure` gives. Check: `npm run typecheck` from `packages/lib` passes.

4. **Edit `packages/lib/src/typescript/lib/component/editor/theme.ts`** as `## Internal Structure` gives. Check: `grep -n 'SYNTAX_STYLES\b' packages/lib/src/typescript/lib/component/editor/theme.ts` lists only `SHARED_SYNTAX_STYLES` lines; `grep -n 'tags.heading\|tags.monospace\|tags.link\|tags.quote' packages/lib/src/typescript/lib/component/editor/theme.ts` lists nothing.

5. **Edit `packages/lib/src/typescript/lib/component/editor/languages.ts`** as `## Internal Structure` gives. Check: `grep -n 'processingInstruction' packages/lib/src/typescript/lib/component/editor/languages.ts` lists nothing.

6. **Run the look test and the editor suites.** From `packages/lib`: `npx vitest run tests/component/markdown-source-look.test.ts tests/component/code-editor-theme.test.ts tests/component/code-editor.test.ts tests/component/code-editor-read-only-mounted.test.ts`. Check: all green; `code-editor-theme.test.ts` still counts two `HighlightStyle.define` calls.

7. **Run the Markdown suites the extensions could disturb.** From `packages/lib`: `npx vitest run tests/component/markdown-roundtrip tests/component/display/Markdown.test.ts tests/component/markdown-editor.test.ts tests/component/markdown-editor-source-mode-mounted.test.ts tests/component/markdown-source-mode-through-model.test.ts tests/component/markdown-source-edits.test.ts tests/component/markdown-source-places.test.ts tests/component/markdown-source-preservation.test.ts tests/component/markdown-editor-nested-source-preservation.test.ts tests/unit/import-without-dom.test.ts tests/component/dispose-deferred-work.test.ts`. Check: all green. The round-trip corpus holds the Enter-in-code and Enter-inside-HTML cases.

8. **Rewrite the colour paragraph in `packages/lib/docs/components/CodeEditor.md`.** Replace the paragraph at line 68 that starts "The `markdown` language is highlighted as source text" with the text in `## Documentation Impact`.

9. **Amend the sentence in `packages/lib/docs/components/MarkdownEditor.md`.** In the paragraph at line 302, replace its last sentence ("The source surface shows the Markdown as text, …; the same section lists the colours.") with the sentence in `## Documentation Impact`.

10. **Amend the changelog entry in `packages/lib/docs/reference/changelog/next.md`.** Replace the first bullet under `## Changed` → `### Components` (lines 293-309, the bullet starting "**`MarkdownEditor`'s source mode, and `CodeEditor`'s `markdown` language, show Markdown as text.**") with the bullet in `## Documentation Impact`. The release is unreleased, so the entry is rewritten, not added to.

11. **Do the manual browser checks** listed in `## Verification`.

12. **Run the full checks** in `## Verification`, ending with plain `npm test`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/editor/markdownSourceTags.ts` |
| Create | `packages/lib/src/typescript/lib/component/editor/markdownSourceSyntax.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/theme.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/languages.ts` |
| Modify | `packages/lib/tests/component/markdown-source-look.test.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every row below is unit-testable through `sourceLooks` and was measured on the prototype. Each row gives one source and its ranges in order, and must give the same ranges in the light and the dark scheme. These are the entries of the test file's `MARKDOWN_ROWS`, exact:

```ts
    // Headings, emphasis, strike-through and underline.
    ['an ATX heading has a block mark and plain text', '# MarkdownEditor',
        [['#', 'block mark'], [' MarkdownEditor', 'plain']]],
    ['a closing hash run is a block mark too', '# H #',
        [['#', 'block mark'], [' H ', 'plain'], ['#', 'block mark']]],
    ['a setext heading has plain text and a block-mark underline', 'Setext\n===',
        [['Setext\n', 'plain'], ['===', 'block mark']]],
    ['a heading holding a link and strong text keeps every part its own colour', '# A [l](u) **b**',
        [['#', 'block mark'], [' A ', 'plain'], ['[', 'inline mark'], ['l', 'plain'], ['](', 'inline mark'], ['u', 'destination'], [')', 'inline mark'], [' ', 'plain'], ['**', 'inline mark'], ['b', 'plain'], ['**', 'inline mark']]],
    ['strong text is plain between inline marks', 'A **WYSIWYG** editor',
        [['A ', 'plain'], ['**', 'inline mark'], ['WYSIWYG', 'plain'], ['**', 'inline mark'], [' editor', 'plain']]],
    ['emphasised text is plain between inline marks', 'a *Markdown* string',
        [['a ', 'plain'], ['*', 'inline mark'], ['Markdown', 'plain'], ['*', 'inline mark'], [' string', 'plain']]],
    ['underscore emphasis looks the same', 'a _b_ __c__',
        [['a ', 'plain'], ['_', 'inline mark'], ['b', 'plain'], ['_', 'inline mark'], [' ', 'plain'], ['__', 'inline mark'], ['c', 'plain'], ['__', 'inline mark']]],
    ['strong emphasised text is plain between inline marks', '***bi***',
        [['***', 'inline mark'], ['bi', 'plain'], ['***', 'inline mark']]],
    ['struck-through text is plain between inline marks', '~~strike~~',
        [['~~', 'inline mark'], ['strike', 'plain'], ['~~', 'inline mark']]],
    ['a single tilde is plain text', '~one~',
        [['~one~', 'plain']]],
    ['tildes with spaces inside are plain text', 'a ~~ b ~~ c',
        [['a ~~ b ~~ c', 'plain']]],
    ['underlined text is plain between inline marks', '++underline++',
        [['++', 'inline mark'], ['underline', 'plain'], ['++', 'inline mark']]],
    ['underline inside strong text joins the marks', '**++b++**',
        [['**++', 'inline mark'], ['b', 'plain'], ['++**', 'inline mark']]],
    ['underlined text cannot hold a plus sign', '++a+b++',
        [['++a+b++', 'plain']]],
    ['a strike-through in a heading keeps its inline marks', '## ~~old~~ new',
        [['##', 'block mark'], [' ', 'plain'], ['~~', 'inline mark'], ['old', 'plain'], ['~~', 'inline mark'], [' new', 'plain']]],

    // Links, images and references.
    ['a reference link has plain text and a destination label', '[Markdown][commonmark]',
        [['[', 'inline mark'], ['Markdown', 'plain'], [']', 'inline mark'], ['[commonmark]', 'destination']]],
    ['an inline link has a destination URL and a plain title', '[a](http://x "t")',
        [['[', 'inline mark'], ['a', 'plain'], ['](', 'inline mark'], ['http://x', 'destination'], [' "t"', 'plain'], [')', 'inline mark']]],
    ['an angle-bracketed destination is a destination with its brackets', "[a](<u v> 't')",
        [['[', 'inline mark'], ['a', 'plain'], ['](', 'inline mark'], ['<u v>', 'destination'], [" 't'", 'plain'], [')', 'inline mark']]],
    ['an image has plain alt text, a destination and a dialect group', '![Diagram](https://placehold.co/240x120){width=240 height=120}',
        [['![', 'inline mark'], ['Diagram', 'plain'], ['](', 'inline mark'], ['https://placehold.co/240x120', 'destination'], [')', 'inline mark'], ['{width=240 height=120}', 'dialect']]],
    ['an image with emphasis in its alt text', '![*a* b](u "t")',
        [['![*', 'inline mark'], ['a', 'plain'], ['*', 'inline mark'], [' b', 'plain'], ['](', 'inline mark'], ['u', 'destination'], [' "t"', 'plain'], [')', 'inline mark']]],
    ['an autolink has a destination URL between inline marks', '<http://auto>',
        [['<', 'inline mark'], ['http://auto', 'destination'], ['>', 'inline mark']]],
    ['a collapsed reference has a destination empty label', '[s][]',
        [['[', 'inline mark'], ['s', 'plain'], [']', 'inline mark'], ['[]', 'destination']]],
    ['a shortcut reference has plain text between inline marks', '[s]',
        [['[', 'inline mark'], ['s', 'plain'], [']', 'inline mark']]],
    ['a link reference definition has a destination label and URL', '[commonmark]: https://commonmark.org',
        [['[commonmark]', 'destination'], [':', 'inline mark'], [' ', 'plain'], ['https://commonmark.org', 'destination']]],
    ['a definition title is plain', '[lab]: /u "T"',
        [['[lab]', 'destination'], [':', 'inline mark'], [' ', 'plain'], ['/u', 'destination'], [' "T"', 'plain']]],
    ['a bare URL is plain text', 'https://example.com',
        [['https://example.com', 'plain']]],

    // Dialect groups and fence lines.
    ['a coloured span has a dialect group', '[coloured]{color=#cc0000}',
        [['[', 'inline mark'], ['coloured', 'plain'], [']', 'inline mark'], ['{color=#cc0000}', 'dialect']]],
    ['a sized span has a dialect group', '[sized]{size=1.3em}',
        [['[', 'inline mark'], ['sized', 'plain'], [']', 'inline mark'], ['{size=1.3em}', 'dialect']]],
    ['a span holding emphasis keeps the emphasis marks', '[sp *em*]{color=red}',
        [['[', 'inline mark'], ['sp ', 'plain'], ['*', 'inline mark'], ['em', 'plain'], ['*]', 'inline mark'], ['{color=red}', 'dialect']]],
    ['a group after a full reference link is a dialect group', '[a][b]{c}',
        [['[', 'inline mark'], ['a', 'plain'], [']', 'inline mark'], ['[b]', 'destination'], ['{c}', 'dialect']]],
    ['a group after an inline link is plain text', '[a](u){x}',
        [['[', 'inline mark'], ['a', 'plain'], ['](', 'inline mark'], ['u', 'destination'], [')', 'inline mark'], ['{x}', 'plain']]],
    ['a group after a reference image is a dialect group', '![a][l]{w=1}',
        [['![', 'inline mark'], ['a', 'plain'], [']', 'inline mark'], ['[l]', 'destination'], ['{w=1}', 'dialect']]],
    ['a group after a shortcut image is a dialect group', '![l]{w=1}',
        [['![', 'inline mark'], ['l', 'plain'], [']', 'inline mark'], ['{w=1}', 'dialect']]],
    ['a group after parentheses in prose is plain text', 'f(x){y}',
        [['f(x){y}', 'plain']]],
    ['a group after an escaped bracket is plain text', '\\]{x}',
        [['\\]', 'escape'], ['{x}', 'plain']]],
    ['a group after code is plain text', '`code`{x}',
        [['`', 'inline mark'], ['code', 'code'], ['`', 'inline mark'], ['{x}', 'plain']]],
    ['an aligned fence has dialect fence lines', '::: {align=center}\nA\n:::',
        [['::: {align=center}', 'dialect'], ['\nA\n', 'plain'], [':::', 'dialect']]],
    ['a column region has dialect fence and separator lines', '::: columns\nLeft column.\n|||\nRight column.\n:::',
        [['::: columns', 'dialect'], ['\nLeft column.\n', 'plain'], ['|||', 'dialect'], ['\nRight column.\n', 'plain'], [':::', 'dialect']]],
    ['a fence label is part of the dialect line', '::: tip Title {align=right}\nx\n:::',
        [['::: tip Title {align=right}', 'dialect'], ['\nx\n', 'plain'], [':::', 'dialect']]],
    ['a fence opened on a list item line', '- ::: {align=right}\n  a\n  :::',
        [['-', 'block mark'], [' ', 'plain'], ['::: {align=right}', 'dialect'], ['\n  a\n  ', 'plain'], [':::', 'dialect']]],
    ['a fence in a quote', '> ::: {align=right}\n> x\n> :::',
        [['>', 'block mark'], [' ', 'plain'], ['::: {align=right}', 'dialect'], ['\n', 'plain'], ['>', 'block mark'], [' x\n', 'plain'], ['>', 'block mark'], [' ', 'plain'], [':::', 'dialect']]],
    ['a separator line may carry spaces around it', '  |||  ',
        [['  ', 'plain'], ['|||', 'dialect'], ['  ', 'plain']]],
    ['a separator line with more after it is plain text', '||| x',
        [['||| x', 'plain']]],
    ['an escaped separator is an escape and plain text', '\\|||',
        [['\\|', 'escape'], ['||', 'plain']]],

    // Tables.
    ['a table has dialect pipes and delimiter row and plain cells', '| a | b |\n| --- | --- |\n| c | d |',
        [['|', 'dialect'], [' a ', 'plain'], ['|', 'dialect'], [' b ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['| --- | --- |', 'dialect'], ['\n', 'plain'], ['|', 'dialect'], [' c ', 'plain'], ['|', 'dialect'], [' d ', 'plain'], ['|', 'dialect']]],
    ['a column width in the delimiter row is part of it, and a merge cell is dialect', '| Column | Aligned |\n| :--- {width=160} | :---: |\n| Tables | yes |\n| Merge | << |',
        [['|', 'dialect'], [' Column ', 'plain'], ['|', 'dialect'], [' Aligned ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['| :--- {width=160} | :---: |', 'dialect'], ['\n', 'plain'], ['|', 'dialect'], [' Tables ', 'plain'], ['|', 'dialect'], [' yes ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['|', 'dialect'], [' Merge ', 'plain'], ['|', 'dialect'], [' ', 'plain'], ['<<', 'dialect'], [' ', 'plain'], ['|', 'dialect']]],
    ['a merge cell in the first column or the first body row is plain text', '| a | b |\n| - | - |\n| << | ^^ |\n| x | ^^ |',
        [['|', 'dialect'], [' a ', 'plain'], ['|', 'dialect'], [' b ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['| - | - |', 'dialect'], ['\n', 'plain'], ['|', 'dialect'], [' << ', 'plain'], ['|', 'dialect'], [' ^^ ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['|', 'dialect'], [' x ', 'plain'], ['|', 'dialect'], [' ', 'plain'], ['^^', 'dialect'], [' ', 'plain'], ['|', 'dialect']]],
    ['an escaped merge cell is an escape and plain text', '| a | b |\n| - | - |\n| \\<< | x |',
        [['|', 'dialect'], [' a ', 'plain'], ['|', 'dialect'], [' b ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['| - | - |', 'dialect'], ['\n', 'plain'], ['|', 'dialect'], [' ', 'plain'], ['\\<', 'escape'], ['< ', 'plain'], ['|', 'dialect'], [' x ', 'plain'], ['|', 'dialect']]],
    ['a table without outer pipes', 'a | b\n--- | ---\nc | d',
        [['a ', 'plain'], ['|', 'dialect'], [' b\n', 'plain'], ['--- | ---', 'dialect'], ['\nc ', 'plain'], ['|', 'dialect'], [' d', 'plain']]],
    ['a one-column table needs a colon or pipe in its delimiter row', 'a\n:--',
        [['a\n', 'plain'], [':--', 'dialect']]],
    ['a line over dashes alone is a setext heading', 'a\n---',
        [['a\n', 'plain'], ['---', 'block mark']]],
    ['an escaped pipe stays in its cell', '| a \\| b | c |\n| - | - |',
        [['|', 'dialect'], [' a ', 'plain'], ['\\|', 'escape'], [' b ', 'plain'], ['|', 'dialect'], [' c ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['| - | - |', 'dialect']]],
    ['a delimiter row with fewer cells is no table', '| a | b |\n| - |',
        [['| a | b |\n| - |', 'plain']]],
    ['a table straight after a paragraph line is plain text', 'para\n| a | b |\n| - | - |',
        [['para\n| a | b |\n| - | - |', 'plain']]],
    ['a table in a quote', '> | a | b |\n> | - | - |\n> | c | d |',
        [['>', 'block mark'], [' ', 'plain'], ['|', 'dialect'], [' a ', 'plain'], ['|', 'dialect'], [' b ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['>', 'block mark'], [' ', 'plain'], ['| - | - |', 'dialect'], ['\n', 'plain'], ['>', 'block mark'], [' ', 'plain'], ['|', 'dialect'], [' c ', 'plain'], ['|', 'dialect'], [' d ', 'plain'], ['|', 'dialect']]],

    // Blocks, markers and HTML.
    ['a bullet marker is a block mark', '- item',
        [['-', 'block mark'], [' item', 'plain']]],
    ['a number marker is a block mark', '1. one',
        [['1.', 'block mark'], [' one', 'plain']]],
    ['a task box is a block mark', '- [x] t',
        [['-', 'block mark'], [' ', 'plain'], ['[x]', 'block mark'], [' t', 'plain']]],
    ['a quote has a block-mark marker and plain text', '> Edit on the left',
        [['>', 'block mark'], [' Edit on the left', 'plain']]],
    ['a quote keeps the colours of what it holds', '> q *e* [l](u)',
        [['>', 'block mark'], [' q ', 'plain'], ['*', 'inline mark'], ['e', 'plain'], ['*', 'inline mark'], [' ', 'plain'], ['[', 'inline mark'], ['l', 'plain'], ['](', 'inline mark'], ['u', 'destination'], [')', 'inline mark']]],
    ['a thematic break is a block mark', 'a\n\n---\n\nb',
        [['a\n\n', 'plain'], ['---', 'block mark'], ['\n\nb', 'plain']]],
    ['a thematic break of asterisks is a block mark', '***',
        [['***', 'block mark']]],
    ['a backslash hard break is an escape', 'a\\\nb',
        [['a', 'plain'], ['\\\n', 'escape'], ['b', 'plain']]],
    ['an HTML comment is HTML', '<!-- c -->',
        [['<!-- c -->', 'html']]],
    ['an HTML comment inside link text is HTML', '[a <!-- c --> b](u)',
        [['[', 'inline mark'], ['a ', 'plain'], ['<!-- c -->', 'html'], [' b', 'plain'], ['](', 'inline mark'], ['u', 'destination'], [')', 'inline mark']]],
    ['inline HTML is HTML around plain text', 'x <span>h</span>',
        [['x ', 'plain'], ['<span>', 'html'], ['h', 'plain'], ['</span>', 'html']]],
    ['an attribute holding CSS is HTML throughout', '<span style="color: red">s</span>',
        [['<span style="color: red">', 'html'], ['s', 'plain'], ['</span>', 'html']]],
    ['an HTML block is HTML throughout', '<div class="x">\n</div>',
        [['<div class="x">\n</div>', 'html']]],
    ['a script block is HTML throughout', '<script>\nlet a = 1;\n</script>',
        [['<script>\nlet a = 1;\n</script>', 'html']]],
    ['a processing instruction is HTML', '<?php x ?>',
        [['<?php x ?>', 'html']]],

    // Code, escapes and character references.
    ['inline code is code between inline marks', '`**bold**`',
        [['`', 'inline mark'], ['**bold**', 'code'], ['`', 'inline mark']]],
    ['a double-backtick code span keeps its inner backticks code', '`` `code` ``',
        [['``', 'inline mark'], [' `code` ', 'code'], ['``', 'inline mark']]],
    ['a fenced code block has block-mark fence lines', '```js\nlet a\n```',
        [['```js\n', 'block mark'], ['let a', 'code'], ['\n```', 'block mark']]],
    ['a tilde fence with an info string', '~~~ info\nx\n~~~',
        [['~~~ info\n', 'block mark'], ['x', 'code'], ['\n~~~', 'block mark']]],
    ['an indented code block is code', '    indented',
        [['    ', 'plain'], ['indented', 'code']]],
    ['code as link text is code', '[`code`](u)',
        [['[`', 'inline mark'], ['code', 'code'], ['`](', 'inline mark'], ['u', 'destination'], [')', 'inline mark']]],
    ['code in a heading is code', '# `c`',
        [['#', 'block mark'], [' ', 'plain'], ['`', 'inline mark'], ['c', 'code'], ['`', 'inline mark']]],
    ['a character reference in link text is an escape', '[&amp;](u)',
        [['[', 'inline mark'], ['&amp;', 'escape'], ['](', 'inline mark'], ['u', 'destination'], [')', 'inline mark']]],
    ['a character reference in a paragraph is an escape', 'a &amp; b',
        [['a ', 'plain'], ['&amp;', 'escape'], [' b', 'plain']]],
    ['an escape and a character reference are escapes', '\\* &amp;',
        [['\\*', 'escape'], [' ', 'plain'], ['&amp;', 'escape']]],

    // Where the grammar and the viewer read a line differently: the grammar's reading is pinned.
    ['a separator line after a quote mark is a dialect line', '> a\n> |||',
        [['>', 'block mark'], [' a\n', 'plain'], ['>', 'block mark'], [' ', 'plain'], ['|||', 'dialect']]],
    ['a fence line under paragraph text is a dialect line', 'text\n::: x',
        [['text\n', 'plain'], ['::: x', 'dialect']]],
    ['a fence line as heading text is a dialect line', '# :::',
        [['#', 'block mark'], [' ', 'plain'], [':::', 'dialect']]],
    ['a separator line in an HTML block is HTML', '<div>\n|||\n</div>',
        [['<div>\n|||\n</div>', 'html']]],
    ['a merge cell that cannot make a whole rectangle is a dialect cell', '| a | b |\n| - | - |\n| x | << |\n| ^^ | y |',
        [['|', 'dialect'], [' a ', 'plain'], ['|', 'dialect'], [' b ', 'plain'], ['|', 'dialect'], ['\n', 'plain'], ['| - | - |', 'dialect'], ['\n', 'plain'],
            ['|', 'dialect'], [' x ', 'plain'], ['|', 'dialect'], [' ', 'plain'], ['<<', 'dialect'], [' ', 'plain'], ['|', 'dialect'], ['\n', 'plain'],
            ['|', 'dialect'], [' ', 'plain'], ['^^', 'dialect'], [' ', 'plain'], ['|', 'dialect'], [' y ', 'plain'], ['|', 'dialect']]],
```

### Whole documents

Each runs in both schemes:

- **The demo sample, part by part** (`readDemoEditorSample()`): `#` of `# MarkdownEditor` block mark and its text plain; `**` inline mark; `` `**bold**` ``'s text code; `coloured` plain and `{color=#cc0000}` dialect; `{size=1.3em}` dialect; `Markdown` plain and `[commonmark]` destination in `[Markdown][commonmark]`; `>` block mark; the delimiter row `| :--- {width=160} | :---: |` dialect; `<<` dialect and `Merge` plain; `::: {align=center}` dialect; `|||` dialect; the image's `Diagram` plain, URL destination and `{width=240 height=120}` dialect; the fenced line `const editor = new MarkdownEditor("# Hello");` code; the definition's `[commonmark]` and URL destination.
- **Every kind appears:** across every `CORPUS` case and the demo sample, the looks seen are exactly `plain` and the seven kind words.
- **No rendered look:** no look across them contains `bold`, `italic`, `underline` or `sized`.

### Colours

Each runs in both schemes:

- **Every kind's colour, and the text colour, reaches 4.5 : 1** on the editor background and on the active line (`rgba(127, 127, 127, 0.08)` over the background).
- **The kinds' colours are distinct** from each other and from the seven shared palette colours, so every look word names one colour.
- **Every character is readable:** every character that is not whitespace, in every corpus case, the demo sample and every row source, is drawn in a `#rrggbb` colour or the text colour reaching 4.5 : 1 on the background and the active line.

### Other languages keep their look

In both schemes the first nine rules equal `SHARED_SYNTAX_STYLES`, and these rows hold:

| Language | Source | Ranges |
|---|---|---|
| `javascript` | `const a = "s"; // c` | `const` blue · `␠` plain · `a` violet · `␠=␠` plain · `"s"` green · `;␠` plain · `// c` grey italic |
| `html` | `<a href="u">t</a><!-- c -->` | `<` plain · `a` blue · `␠` plain · `href` pink · `=` plain · `"u"` green · `>t</` plain · `a` blue · `>` plain · `<!-- c -->` grey italic |
| `css` | `a { color: red; }` | `a` blue · `␠{␠` plain · `color` pink · `:␠` plain · `red` blue · `;␠}` plain |

The structural sweep finds in the `markdown` grammar some of the tags in `MARKDOWN_ONLY_TAGS` — the removed rules' tags (`heading` to `heading6`, `strong`, `emphasis`, `link`, `url`, `monospace`, `quote`, `contentSeparator`) and the seven new tags — and finds none of them in any other registered language, SQL with the PostgreSQL dialect included.

### Manual only

The colours on a real page, in all three shipped themes; see `## Verification`.

---

## Verification

From `packages/lib` unless noted:

- `npm run typecheck` and `npm run typecheck:test` — no errors.
- `npm run lint` — no new findings.
- `npm run docs:api` — zero warnings.
- `npx vitest run tests/component/markdown-source-look.test.ts` — every row and test of `## Expected Behaviour` green.
- The suites of steps 6 and 7 — green.
- **Manual browser checks.** Run `npm run dev` from the repository root and open the demo.
  1. Open **MD Editor**, press the **Edit Markdown source** toggle at the toolbar's right end, and check the sample in the Modern theme (the Misc. panel's theme button reads "Switch to classic theme"): `#` runs, `-`, `1.`, `>` and the code fence lines are violet; `**`, `*`, backticks and link brackets grey; `[commonmark]` and the URLs teal; the table's pipes, its delimiter row, `<<`, every `{…}` group, the `:::` lines and `|||` gold; the fenced line and the code spans green; headings, prose, link text and table cells in the text colour; nothing bold, italic or underlined.
  2. At the end of the document, after a blank line, type `a &amp; b \* <span>x</span> ~~s~~ ++u++`: `&amp;` and `\*` orange, `<span>` and `</span>` rose, `~~` and `++` grey.
  3. Open **Misc.** and press the theme button until it reads "Switch to dark theme" (Classic is on); repeat check 1.
  4. Press it again until it reads "Switch to modern theme" (Dark is on); repeat checks 1 and 2, and confirm every colour reads clearly on the dark background, on the caret's line too.
  5. Open **CodeEditor** in the dark and the Modern theme: JavaScript and the other languages look as before.
- **Full suite, last:** plain `npm test` from `packages/lib`, the whole suite with no filter and nothing else running beside it. It must pass.

---

## Documentation Impact

No exported symbol changes: `theme.ts`, `markdownSourceTags.ts` and `markdownSourceSyntax.ts` are not re-exported from any entry point, so TypeDoc and `llms.txt` do not change. Three docs texts change.

**`docs/components/CodeEditor.md`, replacing the paragraph at line 68** (the text below, without the quote marks):

> The `markdown` language colours each kind of Markdown syntax and keeps content in the text colour: prose, heading text, link text and titles, emphasised text, quotes and table cells. Nothing is drawn as the [`Markdown`](/components/Markdown) viewer draws it — no bold, italic, underline or size. Every colour reaches 4.5 : 1 contrast on the editor background, so the light and the dark theme each have their own set:
>
> | Kind | Colour | What takes it |
> | --- | --- | --- |
> | Inline marks | grey | `*`, `_`, `**`, `~~`, `++`, a code span's backticks, a link's or an image's `[`, `]`, `](`, `)` and `![`, an autolink's `<` `>`, a definition's `:` |
> | Block marks | violet | `#` runs and setext underlines, `>`, list markers, task boxes, thematic breaks, a code fence's lines and info string |
> | Destinations | teal | URLs, a reference link's `[label]`, both halves of a link reference definition |
> | Escapes | orange | backslash escapes, a backslash line break, character references such as `&amp;` |
> | HTML | rose | inline tags, HTML blocks, comments and processing instructions, whole |
> | Dialect | gold | the `{…}` group after a `[text]` span or an image, `:::` and `\|\|\|` lines, table pipes and delimiter rows, `<<` and `^^` merge cells |
> | Code | green | the text of a code span and of a fenced or indented code block |
>
> A `{…}` group after a link that ends with `)`, a single-tilde `~text~`, a bare URL and a table written directly under a paragraph line are text. A `:::` or `|||` line is coloured wherever it starts a line of text — also after a `>`, in a heading, or outside a fence — and a `<<` or `^^` cell is coloured outside the first column or the first body row even where the viewer cannot merge it. Every other language is highlighted as before.

**`docs/components/MarkdownEditor.md`, the sentence ending the paragraph at line 302** (without the quote mark):

> The source surface keeps the Markdown's content in the text colour and gives each kind of syntax a readable colour of its own, with no bold, italic or underline; the same section lists the kinds and their colours.

**`docs/reference/changelog/next.md`, replacing the first bullet under `## Changed` → `### Components`:**

```markdown
- **`MarkdownEditor`'s source mode, and `CodeEditor`'s `markdown`
  language, colour Markdown's syntax and show its content as text.** Each
  kind of syntax has its own colour: inline marks such as `**` and a link's
  brackets grey; block marks such as `#`, `>`, list markers and code-fence
  lines violet; URLs and reference labels teal; escapes and character
  references orange; HTML rose; the dialect's syntax — `{…}` groups, `:::`
  and `|||` lines, table pipes and delimiter rows, `<<` and `^^` cells —
  gold; and code green. Prose, heading text, link text, emphasised text and
  quotes keep the text colour. Nothing looks rendered: a link is not blue
  and underlined, headings and `**bold**` are not bold, `*italic*` and
  comments are not italic. Every colour reaches 4.5 : 1 contrast on the
  editor background, with one set for the light theme and one for the dark.
  Tables, `~~strike~~` and `++underline++` are now read and coloured. A
  `markdown` fenced code block in the `Markdown` viewer changes the same way.
  Every other built-in language is highlighted as before, in both themes. A
  grammar you register through `registerLanguage` that emits the heading,
  strong, emphasis, link, url, monospace, quote or contentSeparator tags (for
  example your own `markdown`) no longer gets a colour, weight, slant or
  underline for them: those ranges take the text colour.
```

---

## Potential Challenges

- **Rule order decides a fence's colours.** The block-mark rule must come after the inline-mark rule and before the code rule in `syntaxStyles`; the fenced-code rows fail otherwise.
- **A retag must name its nodes with no parent path.** `"FencedCode/CodeMark"`-style rules sit behind lezer's own rule and never match; write the `styleTags` keys exactly as given.
- **`!` must stay on `HTMLBlock`, `HTMLTag` and `CommentBlock`.** Without it the `style=`, `<script>` and comment rows fail, and the dark contrast test finds the shared palette inside HTML.
- **The sticky regular expressions keep their state in `lastIndex`.** Set it before every `exec`, as the module does; a missing reset reads from the previous position.
- **`code-editor-theme.test.ts` counts `HighlightStyle.define` calls.** Keep the call inside `codeEditorTheme`, after the cache check.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/editor/theme.ts`](packages/lib/src/typescript/lib/component/editor/theme.ts) — the palette (lines 10-21), the rule list (23-61), `.cm-activeLine` (153-155) and `codeEditorTheme` (124-297).
- [`packages/lib/src/typescript/lib/component/editor/languages.ts`](packages/lib/src/typescript/lib/component/editor/languages.ts) — `taskMarkerExtension` and `linkTitleTagExtension` (514-569), the precedents for Markdown-only tags and retags, and the `"markdown"` registration (571-625).
- [`packages/lib/src/typescript/lib/component/editor/markdownTabStops.ts`](packages/lib/src/typescript/lib/component/editor/markdownTabStops.ts) — the parser-configuration types (17-23) and `readQuoteContinuationTabs` (224-285), the precedent for reading a lezer internal.
- [`packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts`](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts) — the viewer's table: `splitRow` (61), `parseDelimiterRow` (102), the merge grid (154) and `DELIMITER_ROW_MARKER` (234).
- [`packages/lib/src/typescript/lib/component/display/markdownExtensions.ts`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts) — the viewer's underline (60), styled span (87) and `:::` fence (138) tokenizers, and `IMAGE_ATTRIBUTE_GROUP` (668).
- [`packages/lib/src/typescript/lib/component/display/markdownAttributes.ts`](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts) — `COLUMN_SEPARATOR` (51) and the fence line scan (169).
- `node_modules/@lezer/markdown/dist/index.js` — `markdownHighlighting` (1957), `Strikethrough` (2025) and the GFM `Table` (2052-2160) this plan re-writes.
- `node_modules/@lezer/highlight/dist/index.js` — `highlightRange` (380), where `!` stops the walk, and `ruleNodeProp`'s `combine` (217), which orders a node's rules.
- `node_modules/@codemirror/lang-markdown/dist/index.js` — the tree readers of the consumers table (`getContext` 122, Enter 204, Backspace 350, tag completion 430, paste-as-link 454-460).
- [`packages/lib/tests/component/code-editor-theme.test.ts`](packages/lib/tests/component/code-editor-theme.test.ts) — the build-count test that must stay green.
- [`packages/lib/tests/component/markdown-roundtrip/corpus/index.ts`](packages/lib/tests/component/markdown-roundtrip/corpus/index.ts) and [`packages/lib/tests/helpers/readDemoSample.mjs`](packages/lib/tests/helpers/readDemoSample.mjs) — the documents the whole-document tests read.

---

## Non-Goals

- **Theme tokens for syntax colours.** No theme has syntax tokens today; adding a token group is a theme-API change of its own.
- **The shared palette's dark-theme contrast.** Other languages keep their colours (rule 5), weak as some are on the dark background.
- **Bare URLs, single-tilde strike-through and a table interrupting a paragraph.** Each needs grammar the viewer's readings would have to be mirrored for; they stay text.
- **Colouring HTML's parts apart.** Tag names, attributes and values share the HTML colour.
- **Brief tints.** Search matches, selection matches, the matching bracket and the reveal flash are not measured.
- **The WYSIWYG surface and the viewer's rendering.** Both draw rendered Markdown by design.

---

## Addendum: The Look Test File

`packages/lib/tests/component/markdown-source-look.test.ts`, whole. Paste the entries of `## Expected Behaviour`'s test data, exactly as given there, into `MARKDOWN_ROWS` where the comment marks it.

```ts
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The look of the `markdown` language in `MarkdownEditor`'s source mode. Source mode colours each kind of non-text
// Markdown, keeps content in the text colour, and draws nothing as the Markdown viewer draws it. The look of a range
// is read offline: the language's syntax tree is highlighted with a highlighter built from the same rule list the
// editor theme uses for that scheme, and each range's rules are folded into words such as `block mark` or `plain`.

import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree, language as languageFacet } from '@codemirror/language';
import type { TagStyle } from '@codemirror/language';
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';
import type { Highlighter } from '@lezer/highlight';
import type { Tag } from '@lezer/highlight';
import type { NodeType } from '@lezer/common';
import '~/component/editor/languages';
import { getLanguage, listLanguages } from '~/component/editor/LanguageRegistry';
import { MARKDOWN_SOURCE_TAGS } from '~/component/editor/markdownSourceTags';
import {
    syntaxStyles, SHARED_SYNTAX_STYLES, MARKDOWN_SOURCE_LIGHT, MARKDOWN_SOURCE_DARK,
    SYNTAX_KEYWORD, SYNTAX_STRING, SYNTAX_COMMENT, SYNTAX_LITERAL, SYNTAX_FUNCTION, SYNTAX_TYPE, SYNTAX_PROPERTY,
} from '~/component/editor/theme';
import { CORPUS } from './markdown-roundtrip/corpus';
import { readDemoEditorSample } from '../helpers/readDemoSample.mjs';

/** A range of source text and the look it is drawn in. */
type Range = [text: string, look: string];

/** The red, green and blue channels of a colour, 0 to 255. */
type Channels = readonly [number, number, number];

/** The word for each kind of non-text Markdown, as a look names it. */
const CATEGORY_WORDS: Readonly<Record<keyof typeof MARKDOWN_SOURCE_TAGS, string>> = {
    inlineMark:  'inline mark',
    blockMark:   'block mark',
    destination: 'destination',
    escape:      'escape',
    html:        'html',
    dialect:     'dialect',
    code:        'code',
};

/** The word for each colour of the shared palette, which other languages use. */
const SHARED_COLOUR_NAMES: Readonly<Record<string, string>> = {
    [SYNTAX_KEYWORD]:  'blue',
    [SYNTAX_STRING]:   'green',
    [SYNTAX_COMMENT]:  'grey',
    [SYNTAX_LITERAL]:  'amber',
    [SYNTAX_FUNCTION]: 'violet',
    [SYNTAX_TYPE]:     'teal',
    [SYNTAX_PROPERTY]: 'pink',
};

/** The tint `theme.ts`'s `.cm-activeLine` lays over the editor background: `rgba(127, 127, 127, 0.08)`. */
const ACTIVE_LINE_TINT: Channels = [127, 127, 127];

/** The opacity of {@link ACTIVE_LINE_TINT}. */
const ACTIVE_LINE_ALPHA = 0.08;

/**
 * Lays a translucent colour over an opaque one.
 *
 * @param tint - The translucent colour's channels.
 * @param alpha - Its opacity, 0 to 1.
 * @param background - The opaque colour beneath.
 * @returns The channels of the colour seen.
 */
function overlay(tint: Channels, alpha: number, background: Channels): Channels {
    const [red, green, blue] = tint.map((channel, index) => background[index]! + (channel - background[index]!) * alpha);

    return [red!, green!, blue!];
}

/** One theme scheme as the editor draws it. */
interface Scheme {
    /** The scheme's name in a test title. */
    readonly name: 'light' | 'dark';
    /** The `dark` flag `codeEditorTheme` and `syntaxStyles` take. */
    readonly dark: boolean;
    /** The editor's text colour, `--ts-ui-text-color`. */
    readonly text: Channels;
    /** The editor's background, `--ts-ui-input-bg`. */
    readonly background: Channels;
    /** The rules of the scheme. */
    readonly styles: readonly TagStyle[];
    /** The Markdown colours of the scheme. */
    readonly markdown: Readonly<Record<keyof typeof MARKDOWN_SOURCE_TAGS, string>>;
}

/**
 * The shipped themes' editor colours: `ModernTheme.ts` and `ClassicTheme.ts` draw text `rgb(0, 0, 0)` on
 * `rgb(255, 255, 255)`, `DarkTheme.ts` text `rgb(220, 220, 220)` on `rgb(40, 40, 40)`.
 */
const SCHEMES: readonly Scheme[] = [
    { name: 'light', dark: false, text: [0, 0, 0],       background: [255, 255, 255], styles: syntaxStyles(false), markdown: MARKDOWN_SOURCE_LIGHT },
    { name: 'dark',  dark: true,  text: [220, 220, 220], background: [40, 40, 40],    styles: syntaxStyles(true),  markdown: MARKDOWN_SOURCE_DARK },
];

/**
 * Names every colour of a scheme's rules.
 *
 * @param scheme - The scheme.
 * @returns The word for each colour value.
 */
function colourNames(scheme: Scheme): Record<string, string> {
    const names: Record<string, string> = { ...SHARED_COLOUR_NAMES };

    for (const [category, colour] of Object.entries(scheme.markdown)) {
        names[colour] = CATEGORY_WORDS[category as keyof typeof MARKDOWN_SOURCE_TAGS];
    }

    return names;
}

/** The word each non-colour property adds to a look. */
const PROPERTY_WORDS: Readonly<Record<string, string>> = {
    fontWeight:     'bold',
    fontStyle:      'italic',
    textDecoration: 'underline',
    fontSize:       'sized',
};

/**
 * Builds a highlighter whose classes name the rules a range took: one class per rule, named by the rule's index.
 *
 * @param styles - The rules.
 * @returns The highlighter.
 */
function indexHighlighter(styles: readonly TagStyle[]): Highlighter {
    return tagHighlighter(styles.map((rule, index) => ({ tag: rule.tag, class: String(index) })));
}

/**
 * Merges the properties of the rules a range took, in rule order, a later rule overwriting an earlier one.
 *
 * @param classes - The space-separated rule indexes the range took.
 * @param styles - The rules.
 * @returns The merged CSS properties.
 */
function mergedProperties(classes: string, styles: readonly TagStyle[]): Record<string, string> {
    const merged: Record<string, string> = {};

    for (const index of classes.split(' ').map(Number).sort((a, b) => a - b)) {
        const { tag: _tag, ...properties } = styles[index] as Record<string, unknown>;

        Object.assign(merged, properties);
    }

    return merged;
}

/**
 * Folds the rules a range took into one look: the colour's name followed by a word for each other property.
 *
 * @param classes - The space-separated rule indexes the range took.
 * @param scheme - The scheme the rules belong to.
 * @returns The look, or `plain` when no rule set anything.
 */
function foldLook(classes: string, scheme: Scheme): string {
    const names = colourNames(scheme);
    const words = Object.entries(mergedProperties(classes, scheme.styles)).map(([property, value]) => (
        property === 'color' ? (names[value] ?? value) : PROPERTY_WORDS[property]
    ));

    return words.join(' ') || 'plain';
}

/**
 * Parses a document in a built-in language and lists the ranges a highlighter styles.
 *
 * @param doc - The source text.
 * @param languageId - The built-in language to parse it with.
 * @param highlighter - The highlighter whose classes name the rules a range took.
 * @returns Each styled range as its start, its end and the classes it took, in document order.
 */
async function highlightedRanges(doc: string, languageId: string, highlighter: Highlighter): Promise<Array<[from: number, to: number, classes: string]>> {
    const extension = await getLanguage(languageId)!.loadExtension();
    let state = EditorState.create({ doc, extensions: [extension] });

    ensureSyntaxTree(state, state.doc.length, Infinity);
    state = state.update({}).state;

    const ranges: Array<[number, number, string]> = [];

    highlightTree(syntaxTree(state), highlighter, (from, to, classes) => ranges.push([from, to, classes]));

    return ranges;
}

/**
 * Reads the look of every range of a document in a built-in language.
 *
 * @param doc - The source text.
 * @param languageId - The built-in language to parse it with.
 * @param scheme - The scheme to draw it in.
 * @returns The document's text in order, split where the look changes.
 */
async function sourceLooks(doc: string, languageId: string = 'markdown', scheme: Scheme = SCHEMES[0]!): Promise<Range[]> {
    const spans: Array<[from: number, to: number, look: string]> = [];
    let position = 0;

    for (const [from, to, classes] of await highlightedRanges(doc, languageId, indexHighlighter(scheme.styles))) {
        if (from > position) {
            spans.push([position, from, 'plain']);
        }

        spans.push([from, to, foldLook(classes, scheme)]);
        position = to;
    }

    if (position < doc.length) {
        spans.push([position, doc.length, 'plain']);
    }

    const joined: Array<[number, number, string]> = [];

    for (const span of spans) {
        const last = joined[joined.length - 1];

        if (last && last[2] === span[2] && last[1] === span[0]) {
            last[1] = span[1];
        } else {
            joined.push([...span]);
        }
    }

    return joined.map(([from, to, look]): Range => [doc.slice(from, to), look]);
}

/** Every corpus document and the demo sample: the documents the whole-document tests read. */
const WHOLE_DOCUMENTS: readonly string[] = [...CORPUS.map((corpusCase) => corpusCase.source), readDemoEditorSample()];

/** One source and the ranges it is drawn in, the same in both schemes. */
const MARKDOWN_ROWS: ReadonlyArray<[title: string, source: string, looks: Range[]]> = [
    // The entries of `## Expected Behaviour`'s test data go here.
];

describe.each(SCHEMES)('the markdown language in source mode, $name theme', (scheme) => {
    it.each(MARKDOWN_ROWS)('%s', async (_title, source, looks) => {
        expect(await sourceLooks(source, 'markdown', scheme)).toEqual(looks);
    });

    it('draws each part of the demo sample in its kind\'s colour', async () => {
        const sample = readDemoEditorSample();
        const looks = await sourceLooks(sample, 'markdown', scheme);

        // The look of each character of the sample, so a part is found by where it stands in its construct, not by its words.
        const lookAt: string[] = looks.flatMap(([text, look]) => Array.from({ length: text.length }, () => look));

        // Each part is given with the construct it stands in and the look it must have there.
        const parts: ReadonlyArray<[construct: string, part: string, look: string]> = [
            ['# MarkdownEditor', '#', 'block mark'],
            ['# MarkdownEditor', 'MarkdownEditor', 'plain'],
            ['A **WYSIWYG** editor', '**', 'inline mark'],
            ['`**bold**`', '**bold**', 'code'],
            ['[coloured]{color=#cc0000}', 'coloured', 'plain'],
            ['[coloured]{color=#cc0000}', '{color=#cc0000}', 'dialect'],
            ['[sized]{size=1.3em}', '{size=1.3em}', 'dialect'],
            ['[Markdown][commonmark]', 'Markdown', 'plain'],
            ['[Markdown][commonmark]', '[commonmark]', 'destination'],
            ['> Edit on the left', '>', 'block mark'],
            ['| :--- {width=160} | :---: |', '| :--- {width=160} | :---: |', 'dialect'],
            ['| Merge | << |', '<<', 'dialect'],
            ['| Merge | << |', 'Merge', 'plain'],
            ['::: {align=center}', '::: {align=center}', 'dialect'],
            ['\n|||\n', '|||', 'dialect'],
            ['![Diagram](https://placehold.co/240x120){width=240 height=120}', 'Diagram', 'plain'],
            ['![Diagram](https://placehold.co/240x120){width=240 height=120}', 'https://placehold.co/240x120', 'destination'],
            ['![Diagram](https://placehold.co/240x120){width=240 height=120}', '{width=240 height=120}', 'dialect'],
            ['const editor = new MarkdownEditor("# Hello");', 'const editor = new MarkdownEditor("# Hello");', 'code'],
            ['[commonmark]: https://commonmark.org', '[commonmark]', 'destination'],
            ['[commonmark]: https://commonmark.org', 'https://commonmark.org', 'destination'],
        ];

        for (const [construct, part, look] of parts) {
            const start = sample.indexOf(construct);

            expect(start, construct).toBeGreaterThanOrEqual(0);

            const partStart = start + construct.indexOf(part);

            expect(lookAt.slice(partStart, partStart + part.length), `${part} in ${construct}`).toEqual(Array(part.length).fill(look));
        }
    });

    it('draws every kind of non-text Markdown somewhere in the corpus or the demo sample', async () => {
        const seen = new Set<string>();

        for (const source of WHOLE_DOCUMENTS) {
            for (const [, look] of await sourceLooks(source, 'markdown', scheme)) {
                seen.add(look);
            }
        }

        expect([...seen].sort()).toEqual(['plain', ...Object.values(CATEGORY_WORDS)].sort());
    });

    it('draws nothing as the viewer draws it, in any corpus document or the demo sample', async () => {
        for (const source of WHOLE_DOCUMENTS) {
            for (const [text, look] of await sourceLooks(source, 'markdown', scheme)) {
                expect(look, `${JSON.stringify(text)} in ${JSON.stringify(source)}`).not.toMatch(/bold|italic|underline|sized/);
            }
        }
    });
});

/** The WCAG AA contrast ratio for normal text, which every colour of source mode must reach. */
const MINIMUM_CONTRAST = 4.5;

/**
 * The WCAG relative luminance of a colour.
 *
 * @param rgb - The red, green and blue channels, 0 to 255.
 * @returns The luminance, 0 to 1.
 */
function luminance(rgb: Channels): number {
    const [red, green, blue] = rgb.map((channel) => {
        const unit = channel / 255;

        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });

    return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

/**
 * The WCAG contrast ratio of two colours.
 *
 * @param first - The channels of one colour.
 * @param second - The channels of the other.
 * @returns The ratio, 1 to 21.
 */
function contrast(first: Channels, second: Channels): number {
    const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);

    return (lighter! + 0.05) / (darker! + 0.05);
}

/** A `#rrggbb` colour. */
const HEX_COLOUR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/**
 * Reads the channels of a `#rrggbb` colour.
 *
 * @param colour - The colour.
 * @returns Its channels.
 */
function channelsOf(colour: string): Channels {
    const match = HEX_COLOUR.exec(colour);

    expect(match, colour).not.toBeNull();

    return [parseInt(match![1]!, 16), parseInt(match![2]!, 16), parseInt(match![3]!, 16)];
}

/**
 * The lower of a colour's two contrast ratios in a scheme: on the editor background and on the active line.
 *
 * @param colour - The colour's channels.
 * @param scheme - The scheme.
 * @returns The ratio.
 */
function schemeContrast(colour: Channels, scheme: Scheme): number {
    const activeLine = overlay(ACTIVE_LINE_TINT, ACTIVE_LINE_ALPHA, scheme.background);

    return Math.min(contrast(colour, scheme.background), contrast(colour, activeLine));
}

describe.each(SCHEMES)('source mode colours, $name theme', (scheme) => {
    it('gives every kind of non-text Markdown, and the text, a readable colour', () => {
        for (const [category, colour] of Object.entries(scheme.markdown)) {
            expect(schemeContrast(channelsOf(colour), scheme), category).toBeGreaterThanOrEqual(MINIMUM_CONTRAST);
        }

        expect(schemeContrast(scheme.text, scheme), 'text').toBeGreaterThanOrEqual(MINIMUM_CONTRAST);
    });

    it('gives each kind its own colour, none of them a colour of the shared palette', () => {
        const colours = Object.values(scheme.markdown).map((colour) => colour.toLowerCase());

        expect(new Set([...colours, ...Object.keys(SHARED_COLOUR_NAMES).map((colour) => colour.toLowerCase())]).size)
            .toBe(colours.length + Object.keys(SHARED_COLOUR_NAMES).length);
    });

    it('draws every character of the corpus, the demo sample and the rows in a readable colour', async () => {
        const sources = [...WHOLE_DOCUMENTS, ...MARKDOWN_ROWS.map(([, source]) => source)];
        const highlighter = indexHighlighter(scheme.styles);

        for (const source of sources) {
            const colours: Channels[] = new Array(source.length).fill(scheme.text);

            for (const [from, to, classes] of await highlightedRanges(source, 'markdown', highlighter)) {
                const colour = mergedProperties(classes, scheme.styles).color;

                if (colour !== undefined) {
                    colours.fill(channelsOf(colour), from, to);
                }
            }

            for (let index = 0; index < source.length; index++) {
                if (/\s/.test(source[index]!)) {
                    continue;
                }

                expect(schemeContrast(colours[index]!, scheme), `${JSON.stringify(source[index])} at ${index} in ${JSON.stringify(source)}`)
                    .toBeGreaterThanOrEqual(MINIMUM_CONTRAST);
            }
        }
    });
});

describe('the other built-in languages', () => {
    /** One source of another language and the ranges it is drawn in, the same in both schemes. */
    const OTHER_ROWS: ReadonlyArray<[language: string, source: string, looks: Range[]]> = [
        ['javascript', 'const a = "s"; // c',
            [['const', 'blue'], [' ', 'plain'], ['a', 'violet'], [' = ', 'plain'], ['"s"', 'green'], ['; ', 'plain'], ['// c', 'grey italic']]],
        ['html', '<a href="u">t</a><!-- c -->',
            [['<', 'plain'], ['a', 'blue'], [' ', 'plain'], ['href', 'pink'], ['=', 'plain'], ['"u"', 'green'], ['>t</', 'plain'], ['a', 'blue'],
                ['>', 'plain'], ['<!-- c -->', 'grey italic']]],
        ['css', 'a { color: red; }',
            [['a', 'blue'], [' { ', 'plain'], ['color', 'pink'], [': ', 'plain'], ['red', 'blue'], ['; }', 'plain']]],
    ];

    it.each(SCHEMES)('share the same rules in the $name theme', (scheme) => {
        expect(scheme.styles.slice(0, SHARED_SYNTAX_STYLES.length)).toEqual(SHARED_SYNTAX_STYLES);
    });

    describe.each(SCHEMES)('in the $name theme', (scheme) => {
        it.each(OTHER_ROWS)('%s keeps its look', async (language, source, looks) => {
            expect(await sourceLooks(source, language, scheme)).toEqual(looks);
        });
    });

    /**
     * The tags only the markdown rules match: the tags whose shared rule source mode removed, and the tags only the
     * markdown language emits. Only the markdown grammar may emit them.
     */
    const MARKDOWN_ONLY_TAGS: readonly Tag[] = [
        tags.heading, tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6,
        tags.strong, tags.emphasis, tags.link, tags.url, tags.monospace, tags.quote, tags.contentSeparator,
        ...Object.values(MARKDOWN_SOURCE_TAGS),
    ];

    /** Names the markdown-only tags a tag list matches, using a highlighter with one rule per tag. */
    const MARKDOWN_ONLY_MATCHER = tagHighlighter(MARKDOWN_ONLY_TAGS.map((tag) => ({ tag, class: 'markdown-only' })));

    /**
     * Lists the style tags a grammar attaches to its node types. Lezer has no public way to list a node type's
     * tags, so this reads the rules lezer's highlighting stores in each node type's props (a rule has `tags`, a
     * `mode` and a `next` rule). That is internal and may change; the self-check below, which must find the tags in
     * the Markdown grammar, fails if an upgrade makes this read nothing, so the sweep cannot pass by reading nothing.
     *
     * @param parser - A lezer parser.
     * @returns One entry per tagged node type: its name and the tags it carries.
     */
    function styleTagsByNode(parser: { nodeSet: { types: readonly NodeType[] } }): Array<[node: string, tags: Tag[]]> {
        const result: Array<[string, Tag[]]> = [];

        for (const type of parser.nodeSet.types) {
            const found: Tag[] = [];

            for (const value of Object.values((type as unknown as { props?: object }).props ?? {})) {
                let rule = value as { tags?: Tag[]; mode?: number; next?: unknown } | undefined;

                while (rule && Array.isArray(rule.tags) && 'mode' in rule) {
                    found.push(...rule.tags);
                    rule = rule.next as typeof rule;
                }
            }

            if (found.length > 0) {
                result.push([type.name, found]);
            }
        }

        return result;
    }

    /**
     * Loads a built-in language and reads its parser.
     *
     * @param languageId - The registered language id.
     * @param options - The options its loader reads.
     * @returns The language's parser.
     */
    async function parserOf(languageId: string, options?: { dialect: string }): Promise<{ nodeSet: { types: readonly NodeType[] } }> {
        const extension = await getLanguage(languageId)!.loadExtension(options);

        return EditorState.create({ extensions: [extension] }).facet(languageFacet)!.parser as unknown as { nodeSet: { types: readonly NodeType[] } };
    }

    it('read the markdown grammar for the tags its own rules match, so the sweep below sees them', async () => {
        const matched = styleTagsByNode(await parserOf('markdown')).filter(([, list]) => MARKDOWN_ONLY_MATCHER.style(list));

        expect(matched.length).toBeGreaterThan(0);
    });

    it('emit none of the tags only the markdown rules match', async () => {
        const ids = listLanguages().map((language) => language.id).filter((id) => id !== 'markdown');
        const parsers: Array<[name: string, parser: Awaited<ReturnType<typeof parserOf>>]> = [];

        for (const id of ids) {
            parsers.push([id, await parserOf(id)]);
        }

        parsers.push(['sql postgresql', await parserOf('sql', { dialect: 'postgresql' })]);

        const hits: string[] = [];

        for (const [name, parser] of parsers) {
            for (const [node, list] of styleTagsByNode(parser)) {
                if (MARKDOWN_ONLY_MATCHER.style(list)) {
                    hits.push(`${name}: ${node}`);
                }
            }
        }

        expect(ids.length).toBeGreaterThan(1);
        expect(hits).toEqual([]);
    });
});
```

---

## Notes

[^prototype]: The plan was prototyped in a separate worktree off `feature/markdown-source-mode-plain-text` (`c6cdb2107`); its diff is saved at `/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans6/source-mode-syntax-colours/prototype.diff`. With it, `npm run typecheck`, `npm run typecheck:test`, `eslint` on `component/editor` and `npm run docs:api` (no warnings) were clean; the look test, rebuilt from this plan's own code blocks, passed (192 tests); and these suites passed: `code-editor`, `code-editor-read-only-mounted`, `code-editor-theme`, the `markdown-roundtrip` harness, `display/Markdown`, `markdown-editor`, `markdown-editor-source-mode-mounted`, `markdown-source-mode-through-model` and `import-without-dom` (10 902 tests with the look test), and `markdown-source-edits`, `markdown-source-places`, `markdown-source-preservation`, `markdown-editor-nested-source-preservation` and `dispose-deferred-work` (638 tests). The Enter example of the inline-lines footnote was run on the unchanged grammar: Enter at the end of `> a⏎|||` gives `> a⏎|||⏎> `. The readers in the consumers table were found by searching `packages/lib/src` for `syntaxTree`, `ensureSyntaxTree`, `resolveInner` and node names, and by reading `@codemirror/lang-markdown`; `CodeEditor.ts` reads no tree itself.

[^kinds]: The kinds follow the user's examples. Escapes and character references were kept apart from inline marks because a reference such as `&amp;` stands for a character, as a mark does not; the palette search kept seven colours apart by a CIEDE2000 distance of at least 18, and merging two kinds would have bought little (see the palette footnote). Link titles are content: the viewer shows a title as a tooltip's text, so `"t"` keeps the text colour, as the previous branch made it (`linkTitleTagExtension`). A backslash hard break is an escape because it is a backslash that turns a line end into a break; a two-space hard break is spaces, so its colour is invisible.

[^heading-quote]: A heading hint was considered under rule 2. Heading text in the dark theme would need a light blue, close to the viewer's link blue `rgb(120, 170, 240)`, so a heading would look like a link; and the `#` run is now violet rather than grey, which is enough to find a heading while scrolling. The quote wash greyed links, code and escapes inside a quote, against rule 3, and the viewer draws a quote's text in the text colour beside a bar.

[^palette]: Method: each chromatic colour was generated in the OKLCH colour space at the most chroma the sRGB gamut allows, at a lightness that gives 5.0 : 1 (light) or 5.6 : 1 (dark) on the active line; the greys at about 4.6 : 1, so marks recede. Hues were searched in 5° steps for the set whose closest pair is farthest apart, also counting the text colour, the grey and the viewer's link blue; the best set's hues are rose 10°, orange 50°, gold 95°, green 135°, teal 200° and violet 300°. The closest pairs: light — gold and green 19.2, grey and teal 19.8; dark — grey and the text colour 18.1, then gold and green 23.1. A six-kind palette would have reached only 21.8, so merging two kinds bought little. The tooling and the full distance tables are saved beside the prototype diff (`palette.py`, `final.py`). The shared palette on white then `rgb(40, 40, 40)`: blue 5.17 / 2.85, green 3.30 / 4.47, grey 4.83 / 3.05, amber 3.19 / 4.63, violet 5.70 / 2.59, teal 3.68 / 4.00, pink 6.04 / 2.44 — none reaches 4.5 on both. Tailwind's 700 and 400 shades, the source of the shared palette, were tried first; their closest pairs fell to about 16 (light: yellow and orange 16.3; dark: grey and violet 16.2), and the grey `#6b7280` missed 4.5 : 1 on the light active line (4.43).

[^active-line]: `highlightActiveLine()` is on in every `CodeEditor` ([CodeEditor.ts:2358](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2358)), so the caret's line is always tinted: `rgb(244.8, 244.8, 244.8)` in the light theme and `rgb(47.0, 47.0, 47.0)` in the dark. It is the line most read while editing. The brief tints are left out because they last a moment or mark a selection already read.

[^no-tokens]: The search for theme-driven syntax colours found none. `theme.ts`'s palette comment says the framework defines no syntax tokens ([theme.ts:10-14](packages/lib/src/typescript/lib/component/editor/theme.ts#L10)), and `core/Theme.ts` has no syntax group; the nearest precedent is the chart's per-theme categorical palette (`chart.series`, emitted as `--ts-ui-chart-series-N` by `chartSeriesVars`, [Theme.ts:929-945](packages/lib/src/typescript/lib/core/Theme.ts#L929)), which is a data-visualisation palette, not syntax. So the colours follow how `theme.ts` already splits light and dark: by the `dark` flag `CodeEditor` derives from `ThemeManager.getTheme().colorScheme` ([CodeEditor.ts:2340](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2340)).

[^tag-define]: The codebase has no `Tag.define` yet; lezer documents it for "system-internal use (where you control both the language package and the highlighter)", which is this case. The alternative, reusing a standard tag per kind (`tags.processingInstruction` for marks, `tags.url` for destinations), would change the `html` language's `<?…?>` (it emits `processingInstruction`) or need per-tag audits of every grammar. The module imports `@lezer/highlight` at load; `theme.ts` already does, so the editor chunk gains nothing, and `Tag.define` touches no DOM (`import-without-dom.test.ts` passes).

[^context-rule]: `@lezer/highlight`'s `ruleNodeProp.combine` keeps, for a node named by two `styleTags` calls, a rule with no context ahead of one with a context ([@lezer/highlight index.js:217-244](node_modules/@lezer/highlight/dist/index.js)), and the highlighter takes the first rule that matches; so a rule such as `"FencedCode/CodeMark"` never wins over lezer's plain `CodeMark` rule. The previous branch's implementation notes record the same finding for `Link/InlineCode`. A plain rule of the same depth replaces lezer's: the newer one is kept and the older dropped. `FencedCode` has no lezer rule, so `"FencedCode/..."` adds one, and its tag reaches every node in the fence, in addition to that node's own tag.

[^html-opaque]: Retagging the HTML parser's own nodes for Markdown (through `literalHtml`'s `props`) was prototyped first and dropped. It coloured tag names, attributes and values, but `@codemirror/lang-html` nests the JavaScript and CSS parsers in `<script>`, `<style>`, `style=` and `on…=` ([lang-html index.js:502-531](node_modules/@codemirror/lang-html/dist/index.js)), and those parsers are the ones the `javascript` and `css` languages use, so their colours cannot be changed for Markdown alone; their keyword blue (2.85 : 1), property pink (2.44 : 1) and function violet (2.59 : 1) fail rule 2 in the dark theme. Configuring copies of six nested parsers was rejected as far more code for a rare case. With `!`, `highlightRange` returns before it reaches the mounted HTML tree ([@lezer/highlight index.js:396-398](node_modules/@lezer/highlight/dist/index.js)); the tree, and so indentation and Enter inside HTML, is unchanged. The viewer renders raw HTML as its plain text ([Markdown.md, *Fallback for unsupported tokens*](packages/lib/docs/components/Markdown.md)), so in this dialect an HTML block is markup throughout.

[^comment-italic]: The italic came from the shared `comment` rule, which Markdown's comments matched while they carried lezer's `comment` tag. Retagged to the HTML tag, they no longer match it. Keeping a slant would need its own rule and would be the only styled property in source mode besides colour; the viewer does not show comments, so the slant copied nothing, but it added nothing either.

[^shared-removal]: Among the seven built-in languages only Markdown emits `heading`, `monospace`, `link`, `quote` and `contentSeparator` (the structural test, widened with these tags, checks it), and the theme's own comment said these rules existed for Markdown. Keeping them would colour every Markdown range that inherits them — a heading's blue would reach its marks and links — unless each lezer node were retagged away from them too. `processingInstruction` stays shared because the `html` language emits it for `<?…?>`; Markdown no longer emits it.

[^inline-lines]: Block parsers were considered and rejected. A `:::` or `|||` line directly under text needs `endLeaf` to end the paragraph, and that changes Enter: in `> a⏎|||`, the `|||` line is today a lazy continuation of the quote's paragraph, so Enter at its end inserts `⏎> `; ended by `endLeaf`, the quote stops above it and Enter inserts a bare line break. Read inline, the lines stay inside their paragraph, list item or quote. The test for "starts the text of its line" reads only the inline text, where lezer writes spaces in place of a later line's container marks, so a `> |||` line counts (a known difference). A `:::` line may hold anything after its colons, as the viewer's opening line does ([markdownExtensions.ts:138-200](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L138)); a closing line is exactly `:::`, which the same test covers.

[^parts]: `InlineContext.parts` is marked `@internal` in `@lezer/markdown` 1.7.2 and holds, after a link's `]` or `)`, the finished `Link` or `Image` element (`LinkEnd` replaces the opening delimiter with it). A text-only test — `{` directly after `]` or `)` — was considered and rejected: it colours `[a](u){x}` and prose such as `f(x){y}`, which the viewer shows as text. If a lezer release renames `parts`, `followsSpanOrImage` returns `false` and groups stay in the text colour, which is the previous branch's look; the image and span rows would then fail and point at it.

[^tables]: `@lezer/markdown` exports its GFM `Table` extension, but it is not a direct dependency of the library (`markdownTabStops.ts` names its types through `@codemirror/lang-markdown` for the same reason), and its delimiter-row test, `/^[>\s]*\|?(\s*:?-+:?\s*\|)+(\s*:?-+:?\s*)?$/`, rejects `{width=…}`, so the demo's table would be text. Switching the base to `@codemirror/lang-markdown`'s `markdownLanguage` turns on all of GFM (its own task list, autolinks, subscript, superscript, emoji), each a new look and a new reading to audit. The re-written parser keeps lezer's shape: a leaf parser, so a table is a paragraph's lines and ends where the paragraph would; a header row checked on the second line; one `TableRow` per further line. Like lezer's, it does not let a table interrupt a paragraph; adding `endLeaf` for that would change paragraph extents, which `## Architecture Decisions` keeps fixed. The merge-cell rule covers the two cases the viewer's `resolveMergeGrid` always renders as text (a `<<` in the first column, a `^^` in the first body row); the rule that a merged cell must stay a whole rectangle needs the whole grid and is left out. A `|||` or `:::` line directly after a table's last row is read as one more row; its pipes or its cell's `:::` line are gold all the same, so it looks right. `@codemirror/lang-markdown` folds a block below its first line through a `foldNodeProp` source applied to lezer's base node types only, so a new block type needs its own entry, as `lang-markdown` gives its GFM `Table`.

[^strike]: `@lezer/markdown`'s `Strikethrough` cannot be imported for the reason tables cannot; the copy is its 20 lines. The viewer uses `marked`'s GitHub Flavored Markdown `del` rule, which also strikes `~text~` with one tilde; mirroring `marked`'s flanking regular expressions was judged not worth it for colour. The underline pattern is the viewer's own, and the text inside is read inline from the inner text, as the viewer re-lexes it, so `**++b++**` colours all four marks.

[^test-design]: Naming a Markdown colour by its kind keeps every row the same in both schemes, so one row list pins both, and a palette retune changes the colours test, not the rows. The colours test that every kind's colour differs from the shared palette's keeps the colour-to-word map one-to-one. The JavaScript, HTML and CSS rows, which the previous branch replaced with the structural test, come back because the schemes now differ: they check that the shared rules give the same look in both.
