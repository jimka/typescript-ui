---
depends-on:
  - markdown-editor-serializer
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/markdownNodeState.ts
  - packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts
  - packages/lib/src/typescript/lib/component/editor/editorNodes.ts
  - packages/lib/src/typescript/lib/component/editor/editorTheme.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-serializer.test.ts
  - packages/lib/tests/component/markdown-roundtrip/viewModel.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/divergences.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/commonmark.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/referenceLinks.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# Markdown Editor Import From `marked` — Implementation Plan

## Overview

`MarkdownEditor` loads Markdown through `@lexical/markdown`'s
`$convertFromMarkdownString`, a line-by-line regex importer that disagrees with
the viewer's `marked` grammar in dozens of places (the round-trip harness lists
31 reasons). This plan replaces it. The new importer lexes with the viewer's own
[`lexMarkdown`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L393)
and builds Lexical nodes from the token tree, following the viewer's render
dispatch. At the same time every save switches to plan 1's
`$serializeMarkdown()`.

Two node classes and node state make the import lossless:

- **`MarkdownSourceTextNode`** — an inline, atomic text node that shows what the
  viewer shows and saves the exact Markdown it came from. Soft line breaks,
  inline HTML, task-list markers and images the viewer does not render become
  these.
- **`MarkdownRawBlockNode`** — an editable block of raw Markdown text, saved as
  typed. Thematic breaks, HTML blocks, definitions, and blockquotes or lists
  whose content the editor's nodes cannot hold become these.
- **`listLooseState`** — whether a list is loose (blank lines between items).
- **`hardBreakMarkerState`** (from plan 1) — a hard break imports as a
  `LineBreakNode` carrying its authored marker, so it shows as a line break,
  as the viewer now renders it, and saves as written.

The six conversion sites in
[`MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1315)
switch over in one step. `@lexical/markdown` stays only for typing shortcuts,
with a shortcut-only transformer list; the TABLE, BLOCK, IMAGE and STYLED_TEXT
transformer modules are deleted. The round-trip harness is the acceptance
gate: 25 of its 31 reasons are expected to disappear (see *Harness baseline
after this plan*).

Line numbers for `MarkdownEditor.ts` and `markdown-editor.test.ts` are as of
`feature/markdown-source-mode-styled-spans` at `64d79105`, the base of this
stack (see plan 1).

---

## Architecture Decisions

### Import walks the viewer's tokens, following the viewer's own dispatch

`$importMarkdown(markdown)` lexes with `lexMarkdown` and maps each token type
to a node, with the same `switch` shape and the same fallback as
[`Markdown.appendBlockToken`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1637)
and [`appendInlineToken`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1969),
and the same resolvers (`resolveSpanStyle`, `resolveBlockStyle`,
`resolveImageSpec`).[^same-lexer] What the editor shows is therefore what the
viewer shows for the same source, token for token.

### Every block token becomes exactly one top-level node, and no source is dropped

In a block list (the document, or one `:::` column) each token other than
`space` produces exactly one node. Text between two tokens that no token covers
is kept as a `MarkdownRawBlockNode`. `marked` produces such text when it drops a
second definition of the same label without emitting a token.[^dropped-defs]
Each token is located by searching for its text from the end of the previous
one (`locateTokens`, below), not by summing `raw` lengths, because that
dropped text breaks the sum.

| Source | Root children |
|---|---|
| `[a]\n\n[a]: https://one\n[a]: https://two` | paragraph, raw `[a]: https://one`, raw `[a]: https://two` |
| `# H\n\npara` | heading, paragraph |

### What the editor's nodes cannot hold is kept as source

The viewer prints any token it has no builder for as text (its `default:`
branches). The editor keeps the same tokens as source nodes, so a save writes
them back unchanged:[^keep-source]

| Token | Node | Shows | Saves |
|---|---|---|---|
| soft break (a `\n` inside a text token) | `MarkdownSourceTextNode` | one space | `\n` |
| `html` (inline), `checkbox`, `image` (marked's own, e.g. with a title), any unknown inline token | `MarkdownSourceTextNode` | `text ?? raw`, whitespace collapsed | `raw` |
| `mdimage` whose `src` the allow-list rejects | `MarkdownSourceTextNode` | its `raw` | its `raw` |
| `hr`, `html` (block), `def`, any unknown block token | `MarkdownRawBlockNode` | its `raw` | its text |
| `blockquote` or `list` of a shape the nodes cannot hold (next decision) | `MarkdownRawBlockNode` | its `raw` | its text |

`MarkdownSourceTextNode` extends `TextNode`, so it carries bold/italic/… and a
span style like any text and the harness projects it as a text run. It is
modelled on Lexical's own `TabNode`: fixed text, unmergeable, no typing inside
it.[^source-text-node] `MarkdownRawBlockNode` follows
[`MarkdownColumnNode`](packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts#L194)'s
`createViewElement` pattern and the parked branch's definitions block for
Enter and Backspace.

### Soft breaks flow like the viewer and keep the author's line structure

A soft break is a `MarkdownSourceTextNode` showing one space, so a hard-wrapped
paragraph reads as one flowing line in the WYSIWYG surface, as in the viewer,
and saves with its line breaks where they were.[^soft-break]

### A hard break is a `LineBreakNode` that keeps its marker

A `br` token imports as `$createLineBreakNode()` with
`hardBreakMarkerState` set to the token's `raw` without its newline (`\` or the
run of spaces). It shows as a line break, which the viewer renders since
`markdown-viewer-hard-breaks`, and plan 1's serializer writes the same marker
back. Shift+Enter makes the same node with no state, saved as `\` + newline.

| Source | Node | Saved |
|---|---|---|
| `foo  \nbar` | `LineBreakNode`, marker two spaces | `foo  \nbar` |
| `foo\\\nbar` | `LineBreakNode`, marker `\` | `foo\\\nbar` |
| Shift+Enter between `a` and `b` | `LineBreakNode`, no state | `a\` + newline + `b` |

### A quote holds one paragraph; a list item holds one line of text and nested lists

`QuoteNode` and `ListItemNode` hold inline content only. A token whose content
fits is imported as those nodes; otherwise the whole token becomes one
`MarkdownRawBlockNode`.[^container-shapes] `space` tokens are ignored when
checking a shape.

| Token | Content (ignoring `space`) | Result |
|---|---|---|
| `blockquote` | nothing | empty `QuoteNode` |
| `blockquote` | one `paragraph` | `QuoteNode` with its inline content |
| `blockquote` | anything else (two paragraphs, a heading, code, a list, a nested quote, a `def`) | raw block of the quote's `raw` |
| `list` item | nothing; or one `text`/`paragraph`; then zero or more `list`s; an optional leading `checkbox` | `ListItemNode` (+ nested lists) |
| `list` item | anything else (a second paragraph, a heading, code, a quote, a `def`) | the **outermost** list token becomes one raw block |

### List looseness is Lexical node state

`listLooseState = createState("mdLoose", { parse: (value) => value === true })`
is set on each imported `ListNode` from the token's `loose`. A loose list saves
with a blank line between items. This is the same mechanism
`@lexical/markdown` uses for its `codeFenceState` on `CodeNode`.[^loose-state]
A list made by typing or a toolbar command has no state and saves tight.

### Typing shortcuts keep `registerMarkdownShortcuts`, with a shortcut-only list

`markdownTransformers.ts` exports `SHORTCUT_TRANSFORMERS`: `HEADING`, `QUOTE`,
`CODE`, `UNORDERED_LIST`, `ORDERED_LIST`, `BOLD_STAR`, `ITALIC_STAR`,
`INLINE_CODE`, `STRIKETHROUGH`, `LINK` and the dialect's `UNDERLINE`. Typing
behaves exactly as today.[^shortcuts] `@lexical/markdown` remains a dependency
for this one function; no Markdown is imported or exported through it any more.
`markdownTableTransformer.ts`, `markdownBlockTransformer.ts` and
`markdownImageTransformer.ts` are deleted, and `STYLED_TEXT` leaves
`markdownStyleTransformers.ts`.

### Everything above the conversion seam stays as it is

Only the six conversion sites touch Markdown text. The rest of the editor
works on Lexical nodes and is unchanged:

| Feature | Why it is unaffected |
|---|---|
| command API, toolbar, context menu, **Edit link…** | they edit nodes (`$toggleLink`, `$setBlocksType`, table helpers); the serializer writes whatever nodes result |
| `paste()` and native paste | `paste()` inserts raw text; native paste goes through `registerRichText`'s clipboard handling; neither parses Markdown |
| source mode | the `CodeEditor` holds raw text; only `setMode`'s load into WYSIWYG changes importer |
| `"change"`, dirty state, `markClean` | they compare `getValue()` strings, now produced by the serializer |

### One cut-over, no runtime switch

All six conversion sites change in one step, gated by the harness and the
existing test suite.[^no-flag]

### Typing shortcuts reach `registerMarkdownShortcuts` through a guarding proxy

`registerMarkdownShortcuts` exempts only a `CodeNode` parent and offers no
hook, but a shortcut inside a `MarkdownRawBlockNode` turns typed syntax
into formatting the block does not save. `registerMarkdownShortcutsOutsideRawBlocks`
hands it the editor through a `Proxy` whose `registerUpdateListener` and
`registerCommand` wrap each listener to do nothing while the selection's
anchor is in a raw block; every other member is the editor's own, bound to
it. The codebase has no `Proxy` precedent, and `core/Callable.ts` avoids
one because WebKitGTK's JavaScriptCore breaks `super` calls through a
`Proxy` in an `extends` chain; this one wraps an instance no class extends,
so that hazard does not apply. Rejected: a code format on raw text (changes
how the block shows and saves), an update tag (Lexical's tags mean other
things to history and listeners), and copying the shortcut plugin (a fork
of `@lexical/markdown` to maintain).

### The harness projection learns list looseness

The harness's `editorSurfaceModel` hard-codes `loose: false` for editor lists.
It now reads `$getState(node, listLooseState)`, since the editor holds that
property for the first time. No other projection rule changes: a
`MarkdownSourceTextNode` is a text node, and a `MarkdownRawBlockNode` falls to
the existing "anything else → `raw`" row, which is exactly how the viewer's
text fallback projects.

### Source mode reads the importer's tokens

*Added by the whole-stack review fixes, on the user's decision.* The
source-mode commands (`markdownSourceEdits.ts`, from
`markdown-source-mode-editing` and `markdown-source-mode-styled-spans`)
recognise Markdown through `lexMarkdown`, the lexer this plan's importer loads
with, instead of their own regular expressions; this plan is where the editor
switched to that lexer, so the rework belongs here. A new Lexical-free module,
`markdownSourceTokens.ts`, lexes the source text and finds each token's place
in it by searching for its `raw`, in order: concatenating a token list's
`raw`s reproduces the text it was lexed from, except for a repeated link
reference definition (`marked` drops it without a token) and a container's
content (lexed with a quote's `>` and a list item's indentation stripped,
matched across those prefixes). A token that is not found is left
unlocated, and a command touching it declines. The commands then read which
run, link or span a selection sits in from the tokens, refuse only a range
that cuts a token's syntax, and check their own result: the edited text is
re-lexed, and its blocks and visible characters must be the original's with
exactly the intended format change, or the command declines. That check
replaces the hand-written flanking and escape predictions. Source mode now
writes a span inside the emphasis around it (`**[x]{…}**`), the serializer's
S19 form, instead of extruding the brackets outside the markers. Rejected:
keeping the regular expressions and adding the `_`, reference-link and
autolink forms one by one — every gap the review found was a form the scans
did not know.

### Source-mode line commands act on the blocks the viewer reads

*Added by the whole-stack review fixes, on the user's decision.* The line
commands — `blockPrefixSource` (paragraph, quote, heading),
`FENCED_CODE_SOURCE`, `listSource`, `tableSource` and
`paragraphAroundBlockSource` — work from the same tokens as the inline
commands rather than from line rules with token guards on top. They move to
a Lexical-free module of their own, `markdownSourceLines.ts`
(`markdownSourceEdits.ts` keeps the inline commands, `imageSource` and the
shared edit types); `markdownSourceTokens.ts` records every block token's
span at any depth as a tree (`SourceBlockNode`), which replaces its
construct list and top-level block list.

- **Targets are whole blocks.** A command converts the paragraphs (lazy
  lines included), headings (a setext underline included), list item texts
  and, where it applies, a fenced code block selected whole, that the
  selection's lines touch. A selected line in any other block (indented
  code, a table, an HTML block, a definition) or holding source no block
  holds (a `:::` or `|||` line, a repeated definition, a line `marked` drops)
  declines the command.
- **Decision: lift to the top level, keep the rest in its containers.** A
  converted block leaves the quotes and list items around it for the top
  level (or its `:::` column), where the WYSIWYG editor holds headings,
  quotes, lists and code blocks; those containers split around it, and what
  follows it inside them stays there, each re-opened by its own marker on its
  first line after the block (`- x\n  - a\n  - b`, `a` to a heading, gives
  `- x\n## a\n- - b`; `10. a\n\n    b` gives `## a\n\n10. b`). This keeps
  every other block at its depth, as the WYSIWYG editor's own `setBlockType`
  splits a list (it gives `## a\n\n- - b\n- c` for `a` in
  `- a\n  - b\n- c`). Rejected: keeping the result inside the item
  (`- ## a`), which the WYSIWYG editor holds only as a raw block, and
  dedenting the rest of the item, which moves other blocks up a level.
- **Checked by re-lexing.** The result must read as the same leaves in the
  same order, each with its format, its quotes, list items and columns and
  its block boundaries, except that the converted blocks' leaves are now the
  intended block (a list's start and looseness are not compared, since a
  split changes them). When the plain edit does not, the command tries it
  with the converted blocks set apart by blank lines, then with a character
  that would open another block at a converted line's start escaped
  (`> \~~~ x`), and declines when no form reads back as intended. A code
  block turned into paragraphs is only checked for where its new blocks
  land, since its code becomes live Markdown.
- `insertTable` goes above the block holding the caret, climbing to the
  quote or list around it while the block is that container's first, and
  declines past the first block of a quote's or item's content;
  `paragraphAroundBlockSource` checks its new line with a typed character.
  In WYSIWYG mode `setBlockType` and the list toggles decline in a table
  cell, which holds text only.

---

## Public API

No barrel export changes. Internal modules (no `@internal` tag needed: none is
re-exported):

```typescript
// component/editor/markdownImporter.ts
export function $importMarkdown(markdown: string): void;

// component/editor/markdownSourceNodes.ts
export type SerializedMarkdownSourceTextNode = Spread<{ source: string }, SerializedTextNode>;

export class MarkdownSourceTextNode extends TextNode {
    __source: string;
    constructor(display: string, source: string, key?: NodeKey);
    static getType(): string;                       // "markdown-source-text"
    static clone(node: MarkdownSourceTextNode): MarkdownSourceTextNode;
    static importJSON(json: SerializedMarkdownSourceTextNode): MarkdownSourceTextNode;
    exportJSON(): SerializedMarkdownSourceTextNode;
    getSource(): string;
    setTextContent(text: string): this;             // keeps the display text, as TabNode does
    isUnmergeable(): boolean;                       // true
    canInsertTextBefore(): boolean;                 // false
    canInsertTextAfter(): boolean;                  // false
}
export function $createMarkdownSourceTextNode(display: string, source: string): MarkdownSourceTextNode;   // sets mode "token"
export function $isMarkdownSourceTextNode(node: LexicalNode | null | undefined): node is MarkdownSourceTextNode;

export class MarkdownRawBlockNode extends ElementNode {
    static getType(): string;                       // "markdown-raw-block"
    static clone(node: MarkdownRawBlockNode): MarkdownRawBlockNode;
    static importJSON(json: SerializedElementNode): MarkdownRawBlockNode;
    exportJSON(): SerializedElementNode;
    createDOM(config: EditorConfig);                // <p> via DOM.sink.createViewElement, class config.theme.mdRawBlock
    updateDOM(): boolean;                           // false
    insertNewAfter(selection: RangeSelection, restoreSelection?: boolean): ParagraphNode;
    collapseAtStart(): boolean;                     // Backspace at the start of an empty block removes it, as ParagraphNode does
}
export function $createMarkdownRawBlockNode(source: string): MarkdownRawBlockNode;   // one TextNode per line, LineBreakNodes between
export function $isMarkdownRawBlockNode(node: LexicalNode | null | undefined): node is MarkdownRawBlockNode;

// component/editor/markdownNodeState.ts (created by plan 1, which put hardBreakMarkerState there)
export const listLooseState: StateConfig<"mdLoose", boolean>;

// component/editor/markdownTransformers.ts
export const SHORTCUT_TRANSFORMERS: Transformer[];   // replaces TRANSFORMERS
```

`createDOM` carries no return annotation, as in `MarkdownColumnNode`, so no DOM
type is named. `MarkdownSourceTextNode` does not override `createDOM`.

---

## Implementation

### Block import

```typescript
export function $importMarkdown(markdown: string): void {
    const source = markdown.replace(/\r\n?/g, "\n");
    const root = $getRoot();
    const blocks = $buildBlockList(source, lexMarkdown(source));

    root.clear();
    root.append(...(blocks.length > 0 ? blocks : [$createParagraphNode()]));

    if ($getSelection() !== null) {
        root.selectStart();
    }
}
```

The last three statements mirror `$convertFromMarkdownString`, which this
replaces.

`$buildBlockList(text, tokens)` walks `locateTokens(text, tokens)` and returns
one node per entry:

```typescript
/** One located block token, or a stretch of text no token covers. */
type LocatedBlock = { token: Token } | { gap: string };

/**
 * Pairs each non-space token with its place in `text`, inserting a gap entry
 * for any non-blank text between two tokens or after the last.
 */
function locateTokens(text: string, tokens: Token[]): LocatedBlock[];
```

`locateTokens` keeps a `cursor`. For each token it takes
`body = token.raw` with trailing newlines removed, finds
`start = text.indexOf(body, cursor)` (when `-1`, it uses `cursor` and adds no
gap), pushes `{ gap: text.slice(cursor, start).trim() }` when that is
non-empty, pushes `{ token }` unless the token is `space`, and sets
`cursor = start + body.length`. After the last token, any non-blank
`text.slice(cursor)` is one more gap. A gap becomes
`$createMarkdownRawBlockNode(gap)`.[^raw-newlines]

| Token `type` | Node |
|---|---|
| `heading` | `$createHeadingNode("h" + clamp(depth, 1, 6))`, inline `tokens` |
| `paragraph` | `ParagraphNode`, inline `tokens` |
| `code` | `$createCodeNode(firstWord(lang) ?? undefined)` + one `TextNode` of `text` with one trailing `\n` removed |
| `blockquote` | per the shape table |
| `list` | `$buildList(token)`; `null` → raw block |
| `mdtable` | `$buildTable(token)` |
| `mdblock` | `$buildFence(token)` |
| anything else | `$createMarkdownRawBlockNode(token.raw` without trailing newlines`)` |

`firstWord(lang)` is the first whitespace-separated word of the trimmed `lang`,
or `null` when empty, as the viewer reads it.

**Lists.** `$buildList` creates `$createListNode(ordered ? "number" : "bullet", ordered ? Number(start) : 1)`,
sets `listLooseState` from `token.loose`, and for each item: drops `space`
tokens; takes a leading `checkbox` as a `MarkdownSourceTextNode(raw, raw)`;
checks the remaining tokens are `[]`, or one `text`/`paragraph`, then only
`list`s. It appends a `ListItemNode` holding the checkbox node and the inline
content, then, for each nested `list`, a `ListItemNode` holding
`$buildList(nested)`. Any nested `null`, or any other shape, returns `null`.
The checkbox of a *loose* list arrives as an inline `checkbox` token inside the
paragraph, and the inline table covers it.

**Tables.** `$buildTable` creates a header `TableRowNode` of
`$createTableCellNode(TableCellHeaderStates.ROW)` cells and one row per body
row of `NO_STATUS` cells with `setColSpan` / `setRowSpan` from the token. Every
cell gets `setFormat(align ?? "")` and the paragraphs of its inline tokens
(cell mode, below). The table gets `setColWidths(widths.map((width) => width ?? 0))`,
as today's transformer does.

**Fences.** `$buildFence` creates `$createMarkdownBlockNode()` with
`resolveBlockStyle(token.attributes)` applied through `setAlign` /
`setColumnGap`. Never unwrapped. The column texts are
`splitColumnSections(inner)`, where `inner` is `token.raw` without its first
and last line. Column `i` is a `MarkdownColumnNode` holding
`$buildBlockList(sections[i], token.columns[i])`, or one empty paragraph when
that list is empty.

### Inline import

An inline builder appends into a current element, carrying a context of format
bits, a `MarkdownSpanStyle` and the open link:

| Token `type` | Action |
|---|---|
| `text` with `tokens` | recurse |
| `text` (or `escape`) | append `text` as `TextNode`s with the context's format and style; each `\n` between pieces is a soft break `MarkdownSourceTextNode(" ", "\n")` |
| `strong` / `em` / `del` / `underline` | add `bold` / `italic` / `strikethrough` / `underline`, recurse |
| `codespan` | append `text` with `code` added |
| `link` | open a `$createLinkNode(href, { title: title ?? null })`, recurse, close |
| `styledspan` | merge `resolveSpanStyle(attributes)` over the context's style (a set field wins), recurse |
| `mdimage` | `resolveImageSpec(src, alt, attributes)`: a spec appends `$createMarkdownImageNode(spec)`; `null` appends a source node (`raw`, `raw`) |
| `br` | append `$createLineBreakNode()` with `$setState(node, hardBreakMarkerState, raw without its trailing "\n")` |
| `html`, `checkbox`, `image`, anything else | append a source node per the keep-source table |

Every `TextNode` and source node gets the context's format bits and
`spanStyleToCss(style)`; a `LineBreakNode` has no format. A link opened inside a link closes the outer one
first and reopens it afterwards with the same URL and title, so the innermost
link wins — the same rule the harness projection applies.

**Cell mode** (table cells only): a plain `text` token is first split on the two
characters `\n` (`CELL_PARAGRAPH_BREAK`); each split ends the current paragraph
and starts a new one, reopening the open link. Code spans are not split.

### Serializer additions (`markdownSerializer.ts`)

- A new segment kind `{ kind: "source"; source: string; marks; style; link }`
  for `MarkdownSourceTextNode`, written as `getSource()` with no escaping. In a
  `singleLine` context every `\n` in it is written as a space; in a table cell
  every `|` in it is escaped. A source segment containing `[` or `]` never
  joins a style group. Trailing-whitespace trimming applies to text segments
  only.
- Text written immediately before a source segment that starts with `\n`
  drops its trailing spaces and tabs.
- `MarkdownRawBlockNode` writes `getTextContent()` unchanged.
- A `ListNode` with `$getState(node, listLooseState) === true` joins its items
  with `"\n\n"` instead of `"\n"`.

### `MarkdownEditor.ts`

| Site (styled-spans tip) | Before | After |
|---|---|---|
| `setMode`, `:1329` | `$convertFromMarkdownString(markdown, TRANSFORMERS)` | `$importMarkdown(markdown)` |
| `getValue`, `:1353` | `$convertToMarkdownString(TRANSFORMERS)` | `$serializeMarkdown()` |
| `setValue`, `:1423` | `$convertFromMarkdownString(value, TRANSFORMERS)` | `$importMarkdown(value)` |
| `ensureEditor`, `:2591` | `$convertFromMarkdownString(this._options.value ?? "", TRANSFORMERS)` | `$importMarkdown(this._options.value ?? "")` |
| `ensureEditor`, `:2602` | `$convertToMarkdownString(TRANSFORMERS)` | `$serializeMarkdown()` |
| `ensureEditor`, `:2610` | `registerMarkdownShortcuts(editor, TRANSFORMERS)` | `registerMarkdownShortcuts(editor, SHORTCUT_TRANSFORMERS)` |
| `handleChange`, `:3214` | `$convertToMarkdownString(TRANSFORMERS)` | `$serializeMarkdown()` |

The `@lexical/markdown` import keeps `registerMarkdownShortcuts` only. In the
class `@remarks`, replace "reads/writes Markdown through Lexical's
bidirectional converters" with "reads Markdown with the viewer's own `marked`
lexer and writes it with its own serializer", and replace the sentence about
the curated transformer list with: "Markdown the editor has no rich-text form
for is kept as source — an editable raw block, or an atomic inline run — and
saved exactly as written, so an edited document renders in the viewer as it did
before." In `ensureEditor`, the comment "Lexical's converters normalize what
they round-trip" becomes "The importer and serializer normalize what they
round-trip".

---

## Ordered Implementation Steps

Paths are relative to `packages/lib/`.

1. **Tests first.** Create `tests/component/markdown-importer.test.ts` (same
   setup as `markdown-serializer.test.ts`) with rows I1–I28 and R1–R12, using
   `editorSurfaceModel` and `viewerModel` from the harness where a row says so,
   and `lexicalOf` for node checks. Add rows S34–S43 to
   `markdown-serializer.test.ts`, building the new nodes directly. Run both
   files — the new rows fail.
2. **Create `src/typescript/lib/component/editor/markdownSourceNodes.ts`** with
   both classes and their `$create` / `$is` functions per `## Public API`.
   `$createMarkdownSourceTextNode` calls `setMode("token")` on the new node.
   Copy `createDOM`, `updateDOM`, `insertNewAfter` and `collapseAtStart` from the
   parked branch's `MarkdownLinkDefinitionsNode`
   (`git show feature/markdown-link-reference-definitions:packages/lib/src/typescript/lib/component/editor/markdownReferenceNodes.ts`),
   adding the `config.theme.mdRawBlock` class to `createDOM`.
3. **Add `listLooseState` to `src/typescript/lib/component/editor/markdownNodeState.ts`**
   (plan 1's module).
4. **Register the nodes.** Add `MarkdownSourceTextNode` and
   `MarkdownRawBlockNode` to `EDITOR_NODES` in `editorNodes.ts` (and its
   `@remarks` list). In `editorTheme.ts` add `RAW_BLOCK_CLASS = "ts-ui-mde-raw-block"`,
   a class rule `{ fontFamily: "var(--ts-ui-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)" }`
   inside `ensureMarkdownEditorClassRules`, and `mdRawBlock: RAW_BLOCK_CLASS` in
   `EDITOR_THEME`. Check: `npm run typecheck`.
5. **Create `src/typescript/lib/component/editor/markdownImporter.ts`** per
   *Block import* and *Inline import*, split into named functions
   (`$buildBlockList`, `locateTokens`, `$buildBlock`, `$buildQuote`,
   `$buildList`, `$buildListItem`, `$buildTable`, `$buildCellParagraphs`,
   `$buildFence`, `appendInlineTokens`, `appendText`, `appendSourceNode`), none
   over ~30 lines. Check: I1–I28 pass.
6. **Extend `markdownSerializer.ts`** per *Serializer additions*. Check:
   S34–S43 pass.
7. **Cut over `MarkdownEditor.ts`** per the site table, and rewrite the
   `@remarks` and the `ensureEditor` comment. Check:
   `grep -n "convertFromMarkdownString\|convertToMarkdownString" -r src/` —
   zero matches; R1–R12 pass.
8. **Trim the transformers.** In `markdownTransformers.ts`, replace
   `TRANSFORMERS` and its JSDoc with `SHORTCUT_TRANSFORMERS` (the eleven
   entries above; JSDoc: "The typing shortcuts `registerMarkdownShortcuts`
   applies. Import and export go through `markdownImporter.ts` and
   `markdownSerializer.ts`."). In `markdownStyleTransformers.ts` delete
   `STYLED_TEXT` and the imports only it used. Delete
   `markdownTableTransformer.ts`, `markdownBlockTransformer.ts`,
   `markdownImageTransformer.ts`. Check: `grep -rn "markdownTableTransformer\|markdownBlockTransformer\|markdownImageTransformer\|STYLED_TEXT\|\bTRANSFORMERS\b" src/ tests/`
   — only comment matches remain; repoint each comment (`Markdown.ts:48`,
   `markdownTableExtension.ts:34` and `:162`, `markdownSourceEdits.ts:185`,
   `:303`, `:414`, `:613`, `:1099`, `tests/component/display/Markdown.test.ts:1161`,
   `tests/component/markdown-source-edits.test.ts:353`) to the serializer
   (`markdownSerializer.ts`) or to the viewer's extension (`STYLED_SPAN_EXTENSION`
   in `markdownExtensions.ts`), keeping each sentence's meaning.
9. **Update `tests/component/markdown-editor.test.ts`.**
   - The `markdownTransformers curation` block: assert `SHORTCUT_TRANSFORMERS`
     has length 11, contains the eleven entries, and contains neither
     `HIGHLIGHT` nor `CHECK_LIST`; drop the `STYLED_TEXT` import.
   - `editorNodes table registration`: add one `it` per new node.
   - `the old {columns=2} attribute degrades to a plain paragraph…`
     (`:2110`): rename to `the old {columns=2} attribute keeps its fence, with
     no style` and assert `childTypes` is `['markdown-block']` and
     `normalize(getValue())` is `'::: {}\ntext\n:::'`, stable on reload.
   - Delete C1 from `markdown-serializer.test.ts` (its oracle no longer exists).
   - Run the file. Any other failure is an expectation of the old importer:
     when a row of this plan decides the new outcome, update the test and name
     the row in it; otherwise it is an importer bug to fix.
10. **Harness projection.** In `tests/component/markdown-roundtrip/viewModel.ts`,
    change the `ListNode` row of `editorSurfaceModel` to read
    `loose: $getState(node, listLooseState)`.
11. **Run the harness** (`npx vitest run tests/component/markdown-roundtrip`)
    and settle the baseline:
    - A "now holds" failure: delete that `known` entry.
    - A still-failing listed check: compare its diff with
      *Harness baseline after this plan*; when the table names another reason
      for it, change the entry's id.
    - A failing check with no entry: a bug when this plan's rules say it should
      hold — fix it. When a documented limitation in this plan or plan 1
      produces it, add an entry with the reason the table names and record it
      under `## Implementation Notes`. Otherwise stop and report the case.
    - When `corpus integrity` reports an unused reason, delete it from
      `DIVERGENCES`. Reword the four surviving reasons as the table says.
12. **Add corpus cases** to `corpus/dialect.ts` (no `known` on any):
    `soft-wrapped bold` `**a\nb**`; `loose list` `- a\n\n- b`;
    `hard break backslash in emphasis` `*a\\\nb*`;
    `inline html in emphasis` `*a <b> c*`;
    `heading with soft break source` `Foo\nbar\n===`;
    `duplicate definition kept` `[a]\n\n[a]: https://one\n[a]: https://two`
    (with `known: { surface: 'referenceLinks' }` — the definition blocks show
    until plan 3).
13. **Docs and changelog** per `## Documentation Impact`.
14. Run `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/editor/markdownImporter.ts` |
| Create | `packages/lib/src/typescript/lib/component/editor/markdownSourceNodes.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownNodeState.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownStyleTransformers.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorNodes.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts` (comments only) |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` (comment only) |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts` (comments only) |
| Delete | `packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts` |
| Delete | `packages/lib/src/typescript/lib/component/editor/markdownBlockTransformer.ts` |
| Delete | `packages/lib/src/typescript/lib/component/editor/markdownImageTransformer.ts` |
| Create | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-serializer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-edits.test.ts` (comment only) |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` (comment only) |
| Modify | `packages/lib/tests/component/markdown-roundtrip/viewModel.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/divergences.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/commonmark.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/referenceLinks.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Import (`markdown-importer.test.ts`, unit)

"Surface" means `editorSurfaceModel(editor)` equals `viewerModel(source).blocks`.

| # | `setValue(source)` | Expected |
|---|---|---|
| I1 | `a\nb` | paragraph children: text `a`, source node (display `" "`, source `"\n"`), text `b`; surface |
| I2 | `**a\nb**` | the soft-break node is bold; surface (one run `a b`, bold) |
| I3 | `foo  \nbar` | middle node: `LineBreakNode`, `hardBreakMarkerState` two spaces; surface (runs `foo`, break, `bar`) |
| I4 | `foo\\\nbar` | middle node: `LineBreakNode`, marker `\`; surface |
| I5 | `***` | root types `['markdown-raw-block']`, text `***`; surface |
| I6 | `<div>\nx\n</div>` | one raw block, text `<div>\nx\n</div>`; surface |
| I7 | `> a\n>\n> b` | one raw block, text `> a\n>\n> b` |
| I8 | `> a quoted\nline` | one quote; surface |
| I9 | `- a\n\n- b` | one list, `$getState(list, listLooseState)` is `true`; surface |
| I10 | `- a\n  - nested\n- c` | surface |
| I11 | `- one\n\n  two` | one raw block, text `- one\n\n  two` |
| I12 | `    code\n` | code node, language unset, text `code`; surface |
| I13 | `~~~py\nx\n~~~` | code node, language `py`; surface |
| I14 | `Title\n===` | heading `h1`; surface |
| I15 | `_u_ and __s__` | `u` italic, `s` bold; surface |
| I16 | `<https://a.b> and https://c.d` | two link nodes, URLs `https://a.b`, `https://c.d`; surface |
| I17 | `[r][x]\n\n[x]: https://e.com` | paragraph with a link to `https://e.com`, then raw block `[x]: https://e.com` |
| I18 | `[a]\n\n[a]: https://one\n[a]: https://two` | paragraph, raw `[a]: https://one`, raw `[a]: https://two` |
| I19 | `![a](/u "t")` | paragraph holding one source node: display `a`, source `![a](/u "t")`; surface |
| I20 | `![a](data:image/svg+xml;base64,AAAA)` | one source node, display and source both the whole input |
| I21 | `- [ ] task` | item children: source node `[ ] ` (display and source), text `task` |
| I22 | `a <b>x</b> c` | source nodes `<b>` and `</b>` around text `x`; surface |
| I23 | `\| a \|\n\| --- \|\n\| x\ny \|` (literal backslash-n) | the body cell holds two paragraphs, `x` and `y`; surface |
| I24 | `::: {columns=2}\nold\n:::` | one fence, no align, no gap, one column; surface |
| I25 | `[x **b**]{color=red}` | text `x ` and `b` both styled `color: red`, `b` bold; surface |
| I26 | `[a [b](/2) c](/1)` | links `/1` around `a `, `/2` around `b`, `/1` around ` c`; surface |
| I27 | the empty string; `a\r\nb` | one empty paragraph; the same tree as I1 |
| I28 | `&amp; \*` | one text node `&amp; *`; surface |

### Serializer additions (`markdown-serializer.test.ts`, unit)

`SOFT` is `MarkdownSourceTextNode(" ", "\n")`; `SRC(d, s)` a source node;
`RAW(t)` a raw block of text `t`.

| # | Tree | Written |
|---|---|---|
| S34 | `P["a", SOFT, "b"]` | `a\nb` |
| S35 | `P["a"{b}, SOFT{b}, "b"{b}]` | `**a\nb**` |
| S36 | `H1["a", SOFT, "b"]` | `# a b` |
| S37 | `Q["a", SOFT, "- b"]` | `> a\n> \- b` |
| S38 | `UL["a", SOFT, "b"]` | `- a\n  b` |
| S39 | `RAW("> a\n>\n> b")` | `> a\n>\n> b` |
| S40 | loose `UL["a", "b"]` | `- a\n\n- b` |
| S41 | `P["see ", SRC("<b>", "<b>"), "x"]` | `see <b>x` |
| S42 | table cell `P[SRC("<a\|b>", "<a\|b>")]` | the cell's text is `<a\|b>` with the pipe escaped |
| S43 | `P["a  ", SOFT, "b"]` | `a\nb` |

### Round trips (`markdown-importer.test.ts`, unit)

| # | `setValue` | `getValue()` |
|---|---|---|
| R1 | `_x_` | `*x*` |
| R2 | `Title\n===` | `# Title` |
| R3 | `    code` | ```` ```\ncode\n``` ```` |
| R4 | `***` | `***` |
| R5 | `https://c.d` | `<https://c.d>` |
| R6 | `1\. x` | `1\. x` |
| R7 | `&#35; x` | `&#35; x` |
| R8 | `[r][x]\n\n[x]: https://e.com` | `[r](https://e.com)\n\n[x]: https://e.com` (plan 3 restores the reference form) |
| R9 | `- a\n  - b` | `- a\n  - b` |
| R10 | `a\r\nb` | `a\nb` |
| R11 | `foo  \nbar` | `foo  \nbar` |
| R12 | `foo\\\nbar` | `foo\\\nbar` |

### Harness baseline after this plan (unit, the acceptance gate)

Every entry whose reason is not in this table is expected to flip to passing.
The table lists what stays, by reason, and the entries that change reason.

| Reason | Stays for | Reworded reason |
|---|---|---|
| `quoteBlocks` | surface of CommonMark 128, 228, 232, 235, 237, 244, 250, `code fence in blockquote`, `multi-paragraph blockquote` (their `parity` entries flip) | "A blockquote holding more than one paragraph, or any other block, is kept as a raw Markdown block: saved unchanged, but shown as source where the viewer renders a quote." |
| `listItemBlocks` | surface of CommonMark 256, 300, 316, and 319 (relabelled from `listNesting`) | "A list whose item holds more than one paragraph, or any other block, is kept as a raw Markdown block: saved unchanged, but shown as source where the viewer renders a list." |
| `listMarkers` | parity and surface of CommonMark 301 | "Lexical merges adjacent lists of the same type, so a change of bullet character that starts a new list in marked becomes one list." |
| `taskListMarker` | surface of `task-list marker` | unchanged |
| `plainImage` | surface of `image svg data` | "An image whose source the viewer rejects renders nothing; the editor shows its Markdown as text so it is not lost." |
| `referenceLinks` | surface of every case whose document contains a definition; also `dashes as a list before a definition` (from `thematicBreak`) and CommonMark 567 (from `linkDestinations`) | unchanged until plan 3 |

All other reasons — `lineBreaks`, `thematicBreak`, `rawHtml`, `autolinks`,
`setextHeading`, `atxHeadingRules`, `indentedCode`, `tildeFence`,
`fenceInfoString`, `pipelessTable`, `quoteContinuation`, `listNesting`,
`styleLessFence`, `underscoreEmphasis`, `singleTildeStrike`,
`lineSpanningInline`, `linkDestinations`, `linkPrecedence`, `underlineRule`,
`emphasisAroundLink`, `styledSpanInStrong`, `unescapedPunctuation`,
`decodedEntities`, `backslashAccumulates`, `formatNesting` — leave the
catalogue. Every `idempotence` entry flips. The six new step-12 cases pass
(except the one listed `known`).

### Manual (MD Editor demo: `npm run dev` → **MD Editor**)

- **M1.** The sample loads; the WYSIWYG surface and the live viewer show the
  same content.
- **M2.** Switch to source, replace the text with `> a\n>\n> b\n\n---\n\n<div>x</div>`,
  switch back: three raw blocks in a monospace font. Edit one; switch to source:
  the edit is there and the other two are unchanged.
- **M3.** Source `one\ntwo`, switch to WYSIWYG: one line `one two`. The arrow
  keys cross the space as one character; Backspace just after it deletes it
  (`onetwo`). Switch to source: `onetwo`.
- **M4.** Enter at the end of a raw block starts a new empty paragraph after it.
- **M5.** Typing shortcuts still work: `# `, `- `, `1. `, `> `, ` ``` `,
  `**b**`, `*i*`, `++u++`, `~~s~~`, `` `c` ``, `[t](https://e.com)`.
- **M6.** In WYSIWYG, Shift+Enter inside a paragraph: the line breaks in both
  the surface and the live viewer; source mode shows `\` at the end of the
  first line.

---

## Verification

From `packages/lib` unless noted:

- `npx vitest run tests/component/markdown-importer.test.ts tests/component/markdown-serializer.test.ts tests/component/markdown-roundtrip`
  — green, with the baseline above.
- `npm run test` — full suite.
- `grep -rn "convertFromMarkdownString\|convertToMarkdownString" src/` — zero.
- `ls src/typescript/lib/component/editor/markdown{Table,Block,Image}Transformer.ts` — none exist.
- From the repo root: `npm run typecheck`, `npm run lint` (including
  `local/no-raw-dom`: `markdownSourceNodes.ts` names no DOM type),
  `npm run docs:api` (zero warnings), `npm run docs:llms:check`.
- Manual M1–M6.

---

## Documentation Impact

- **`docs/components/MarkdownEditor.md`**:
  - Lead paragraph: replace "A curated transformer list (not Lexical's full
    preset) guarantees the editor can never emit Markdown the viewer would drop
    to plain text" with "The editor reads Markdown with the viewer's own parser
    and writes it with its own serializer, so a document saved by the editor
    renders in the viewer as the editor showed it."
  - Below **Supported constructs**, replace the paragraph beginning "Task
    lists, thematic breaks (`hr`), and raw HTML are **not** part of the
    dialect" with a **Kept as source** subsection: thematic breaks, HTML blocks,
    link reference definitions, and blockquotes or list items holding more than
    one paragraph or another block load as a raw Markdown block — shown in a
    monospace font, editable as text, saved exactly as written; inline HTML,
    task-list markers and images the viewer will not render
    load as atomic runs that show what the viewer shows and save unchanged;
    formatting applied inside a raw block is not saved. Keep the existing
    sentences about images and table columns.
  - Add to the constructs table: `Underscore emphasis` → read, written as `*`/`**`;
    `Setext heading` → read, written `#`; `Indented or ~~~ code` → read, written
    as a ` ``` ` fence; `Autolink` → `<https://…>`; `Hard line break` → `\` +
    newline (Shift+Enter), while an imported two-space break keeps its spaces.
- **`docs/reference/changelog/next.md`** — append to **Changed › Components**:
  ```markdown
  - **`MarkdownEditor` reads Markdown with the viewer's parser.** A document
    now loads exactly as the `Markdown` viewer renders it: underscore
    emphasis, setext headings, indented and `~~~` code, two-space nested
    lists, autolinks and loose lists are read the way the viewer reads them,
    and a hard-wrapped paragraph shows as one flowing line that saves with its
    line breaks. Hard line breaks keep the form they were written in, and
    Shift+Enter saves as `\` at the line end. Thematic breaks, HTML, and blockquotes or list items holding
    several blocks are kept as editable raw Markdown blocks instead of being
    flattened, so saving no longer corrupts them. Saving writes `*`/`**`
    emphasis and escapes only characters that would change meaning. No
    consumer action is needed.
  ```
- No API page changes: no exported symbol is added or removed.

---

## Potential Challenges

- **Lexical's list transform merges adjacent same-type lists** (`ListNode`'s
  `$transform`). The importer cannot keep two such lists apart; this is the
  `listMarkers` entry that stays.
- **`TableNode` normalization** by `registerTablePlugin` may add cells to a
  ragged imported table. The harness compares against the viewer, which pads
  rows the same way (`cells[column] ?? ""`); if a transform adds anything else,
  fix the importer to build the padded shape.
- **Existing tests that pin the old importer's tree** (a `LineBreakNode` for
  every soft break, an unwrapped `{columns=2}` fence) need their expectation
  moved to this plan's rule; name the plan row in the test.
- **Token-mode text nodes and commands.** `toggleBold` and the colour setters
  format a source node as a whole, which the serializer then writes inside the
  marks; this is the intended behaviour.
- **The source-mode `markdownSourceEdits.ts` refusals** still describe the old
  importer's line-at-a-time reading. They stay correct (only over-cautious);
  do not change their logic here.

---

## Critical Files

- [`component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1637) — `appendBlockToken` / `appendInlineToken`, the dispatch the importer follows.
- [`component/display/markdownExtensions.ts`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts) and [`markdownTableExtension.ts`](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts) — `lexMarkdown`, `MdBlockToken`, `MdTableToken`.
- [`component/display/markdownAttributes.ts`](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts) — `splitColumnSections`, the resolvers, `spanStyleToCss`.
- [`component/editor/markdownBlockNode.ts`](packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts#L194) — `createViewElement` pattern for `MarkdownRawBlockNode`.
- `node_modules/lexical/dist/Lexical.dev.mjs` — `TabNode` (line ~8490), the model for `MarkdownSourceTextNode`.
- `node_modules/@lexical/markdown/dist/LexicalMarkdown.dev.mjs` — `$convertFromMarkdownString` (selection handling), `CODE.replace` (`$setState(codeBlockNode, codeFenceState, …)`, the node-state precedent), `registerMarkdownShortcuts`.
- `node_modules/@lexical/list/dist/LexicalList.dev.mjs` — `ListNode`'s merging `$transform`.
- The parked branch's `markdownReferenceNodes.ts` (`git show feature/markdown-link-reference-definitions:…`) — `MarkdownLinkDefinitionsNode`'s Enter/Backspace handling.
- `tests/component/markdown-roundtrip/` — the harness, its `viewModel.ts` projection and the catalogue.

---

## Non-Goals

- **Container blockquotes and multi-block list items.** New container nodes
  for these are a separate piece of work; until then the raw block keeps them
  intact.
- **Reference links** — plan 3. Here a reference link imports as a plain link
  and saves inline; its definition is a raw block.
- **Byte-identical saves of unchanged blocks** — plan 4.
- **Removing `@lexical/markdown` from `package.json`.** It still provides
  `registerMarkdownShortcuts`.
- **Logic changes to `markdownSourceEdits.ts`** — only its comments are
  repointed.

---

## Notes

[^same-lexer]: The parity rule requires the editor and the viewer to support the
    same subset. Two parsers cannot be kept in agreement — the harness
    measured 31 independent ways they differ, and the parked
    `feature/markdown-link-reference-definitions` branch needed six review
    rounds to make one construct agree. Building the tree from the viewer's own
    tokens makes agreement hold by construction: any viewer change (a new
    extension, a `marked` upgrade) reaches the editor in the same commit.
    Using the viewer's renderer dispatch as the template also gives the
    harness's `viewerModel` — which follows the same dispatch — an exact
    counterpart.

[^dropped-defs]: `marked` 18's `blockTokens` records only the first definition
    of a label, and pushes no token for a later duplicate that does not follow
    a paragraph. Its text is in no token's `raw`, so summing `raw` lengths (as
    `plans/research/markdown-source-mode-backlog.md` §5 assumed works) drifts
    after it. The importer would otherwise silently delete that line on the
    next save; keeping it as a raw block is lossless, and plan 3 hides it like
    any definition.

[^raw-newlines]: Trailing newlines are dropped before searching because `marked`
    edits them: a one-newline `space` token is appended to the previous
    token's `raw` instead of being emitted. In
    `[foo]\n\n[foo]: first\n[foo]: second\n` the first definition's `raw` is
    `[foo]: first\n\n` — text that does not occur in the source, because the
    dropped second definition sat between those two newlines. Its
    newline-free body `[foo]: first` does occur. Newlines between blocks carry
    no content, so ignoring them loses nothing.

[^keep-source]: The alternative for each of these is to drop or flatten the
    construct, which is what the current importer does and why it corrupts
    documents: a multi-paragraph quote saved as `> >`, an `***` thematic break
    escaped to text. A raw block shows Markdown source in a
    WYSIWYG surface, but nothing is lost, and the viewer itself prints exactly
    these tokens' source text. Showing the same `text ?? raw` the viewer
    prints for inline tokens makes the surface check hold for them.

[^source-text-node]: A `TextNode` subclass is used, not a `DecoratorNode` like
    `MarkdownImageNode`, because these runs sit inside formatted text: a soft
    break inside `**a\nb**` must carry bold, or the harness (and the user)
    sees `a`, an unformatted gap, and `b`. `TabNode` is Lexical's own
    precedent for a `TextNode` with fixed content that typing goes around.
    "token" mode makes Backspace delete the whole run. The one case a text
    node cannot show — the viewer showing *nothing* for a rejected image — shows
    the source instead and stays a known divergence.

[^soft-break]: Importing a soft break as a plain space would also flow, but
    then every edited paragraph would save as one long line, rewriting every
    hard-wrapped paragraph a user touches (sqladmin's `CHANGELOG.md` is
    hard-wrapped). A `LineBreakNode`, which the current importer uses for a
    soft break too, shows a line break where the viewer flows the lines — the
    harness's `lineBreaks` divergence. Hard breaks keep the `LineBreakNode`.

[^container-shapes]: `QuoteNode` and `ListItemNode` are Lexical's own nodes and
    hold inline content (plus nested lists for items). Flattening a quote's
    second paragraph into the first, as the current importer does, changes the
    document on save; a raw block does not. Raw granularity is the outermost
    list because a raw block cannot sit inside a `ListItemNode`.

[^loose-state]: Subclassing `ListNode` was rejected: the list commands and
    typing shortcuts create plain `ListNode`s, so a subclass would need a
    node-replacement registration and would still lose the flag on every list
    the user makes. Node state rides along on clone and copy without touching
    the class, and `@lexical/markdown`'s `CODE` transformer already uses the
    same mechanism (`$setState(codeBlockNode, codeFenceState, fence)`).

[^shortcuts]: `registerMarkdownShortcuts` uses a transformer only for typing:
    element and text-format transformers on their trigger characters, and
    text-match transformers that declare a `trigger`. The four removed
    transformers contributed nothing there — `TABLE` and `BLOCK` have
    `replace: () => false`, and `STYLED_TEXT` and `IMAGE` declare no
    `trigger` — so typing is unchanged. Rewriting the shortcuts without
    Lexical would reimplement its trigger and undo handling for no gain.

[^no-flag]: A runtime switch between the two pipelines would mean keeping the
    transformer modules alive, testing both paths, and deleting one later. The
    stack is not merged until every plan is done, the harness pins the
    behaviour of every corpus case, and the existing suite pins the command
    API, so a single swap is the lower-risk path.

---

## Implementation Notes

- **Addition: authored list markers (orchestrator decision).** The
  serializer plan wrote every bullet as `-`, so `* a` saved as `- a`. A new
  `listMarkerState` in `markdownNodeState.ts` (key `mdItemMarker`, not
  `@lexical/markdown`'s `mdListMarker`, which its typing shortcuts set) holds
  the list's bullet (`-` / `*` / `+`) or ordered delimiter (`.` / `)`), read by
  `$buildList` off the first item's `raw`. The serializer writes it, falling
  back to `-` / `.` for a list made in the editor or a marker of the other
  list type. Tests: LM1–LM5 (importer), LM6–LM8 (serializer); the serializer
  test that pinned "always `-`" was replaced by LM6.
- **I23 uses the four-character cell paragraph break.** Per the serializer's
  notes, the cell break is `\n\n` (four characters), so cell mode splits on
  that and I23's source is `| x\n\ny |`; a lone `\n` stays literal text, as
  the viewer shows it.
- **Harness: two predictions differed.** `CommonMark 214` and `reference in a
  heading` gained `parity: 'referenceLinks'`: a reference link saved inline
  (`# [Foo](/url)`) changes the heading's slug id (`foo` → `foo-url`). The
  plan listed no parity entry for `referenceLinks`. The `referenceLinks`
  reason was reworded although the plan said "unchanged": its old text
  (references shown as literal text, definitions as paragraphs) no longer
  describes the editor. Every other prediction held exactly: 153 entries
  flipped, CommonMark 319 / `dashes as a list before a definition` /
  CommonMark 567 were relabelled as the table says, the six step-12 cases
  pass (one listed `known`), and the four surviving reasons use the table's
  wording.
- **Serializer details the plan left open.** A source segment's newline is a
  new `newline` piece that ends the line, so the next line is trimmed and
  escaped like any line start (S37); a soft newline after an empty line
  writes nothing (it would leave a blank line and end the paragraph); a
  whitespace-only source segment at a block edge is dropped like an edge
  hard break; source segments count toward the marks a link or style group
  keeps open.
- **`locateTokens` matches only at a line start (audit fix; plan flaw).**
  The plan's "first `indexOf` from the cursor" found the next token's text
  inside a dropped duplicate definition (`[x]: /a\n[x]: /b\n\nb` split the
  second definition and repeated `b`). A block token always starts a line,
  so `indexOfLineStart` skips matches that do not.
- **A soft break is held back like trailing whitespace (audit fix).** A
  whitespace-only source segment no longer opens marks: it keeps the marks
  it carries and is written after a delimiter that closes next, so bolding
  `word` plus the soft break saves `**word**\nnext`, not `**word\n**next`
  (which the viewer reads as literal asterisks). The writer's held-back
  `pending` became a list of pieces to hold a newline.
- **A line break in a table cell writes the cell paragraph break (audit fix;
  changes a serializer-plan decision).** The serializer wrote a
  `LineBreakNode` in a cell, and each newline of a block nested in a cell,
  as a lone `\n`, which the viewer shows as literal text and the importer
  (splitting only on the four-character pair) read back as text, so a
  Shift+Enter in a cell turned into visible `\n` after one save. Both now
  write `\n\n`, which the viewer shows as one break and which loads back
  as a paragraph boundary (same view, stable on the next save). The three
  "nested in a cell" tests now expect `- x\n\n- y`.
- **A raw block holds the document's text, not `raw` (audit fix; plan
  flaw).** The keep-source table and the plan's `locateTokens` ("search
  from the cursor; when not found, use the cursor") assumed `raw` is the
  verbatim source, but `marked` rebuilds a blockquote's `raw` around lazy
  continuation lines (`> - a\n<b>` has raw `> - a\n\n<b>`; `> - a\n> - b\nc`
  has raw `> - - a\n- b\nc`), and searching ahead found the token's text
  inside a later block or a later copy, writing text twice. `locateTokens`
  now anchors each token where the text resumes after the previous one (its
  first non-blank line) and matches it there exactly or with whitespace
  ignored, ending at a line end; it searches later lines only past a
  definition line `marked` may have dropped, skipping blank lines. A token
  that matches nowhere is not located: its text joins the next gap and is
  kept once as a raw block. Gaps keep their first line's indentation. Exact
  matches are tried before whitespace-insensitive ones, and only a
  blockquote or list (whose `raw` `marked` rebuilds) gets the latter, so a
  dropped definition equal to a later paragraph but for whitespace is never
  taken for it (corpus case `dropped definition equal to a later
  paragraph`).
- **A container must cover its text, or it is a raw block (audit fix; plan
  flaw).** "No source is dropped" was only enforced for block lists:
  `marked` emits no token for a repeated definition inside a quote or list
  item, so the shape table built `[x]: /a\n\n> [x]: /b` as an empty quote and
  deleted the line. `$buildQuote` and `$buildListItem` now run
  `locateTokens` over the container's `text`; any uncovered text makes the
  container (the whole list, for an item) a raw block. Corpus cases
  `duplicate definition in a quote` / `… in a list item` (surface
  `quoteBlocks` / `listItemBlocks`) and `lazy line repeated after a quote`
  (surface `quoteBlocks`) pin both fixes.
- **Enter inside a raw block edits it as text (audit fix; plan flaw).** The
  plan copied the parked definitions node's `insertNewAfter`, which moved
  the rest of the block into an escaped paragraph. A `KEY_ENTER_COMMAND`
  handler (`$handleRawBlockEnter`, at `COMMAND_PRIORITY_HIGH` like the
  separator shortcut) inserts a line break mid-block, as Enter in a
  `CodeNode` does, and an empty paragraph before the block at its start; at
  the end, rich text's paragraph goes after it (M4). `insertNewAfter` itself
  splits off a new raw block mid-block, for other paragraph insertions.
- **A paste into a raw block goes in as plain text (audit fix).** Lexical's
  block paste merges the text around the caret into the first and last
  pasted paragraphs (which then save escaped), so splitting the block was
  not enough: a `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` handler inserts
  the pasted nodes' text, a blank line between blocks, at the caret.
- **A source node never splits (audit fix; plan flaw).** The `TabNode`
  precedent holds for one character; with the caret inside a longer run,
  Enter made `splitText` keep the whole run (the `setTextContent` override)
  and add the tail again. `splitText` now returns the run itself once per
  part a real split would make, so a break lands after it and a selection
  starting inside it (`toggleLink`, which reads the second part) takes it
  whole.
- **Typing shortcuts are off inside a raw block (audit fix; a new pattern).**
  `registerMarkdownShortcuts` only skips `CodeNode` parents and offers no
  hook, so `**b**` typed in a raw block became bold text the block does not
  save. `registerMarkdownShortcutsOutsideRawBlocks` hands it the editor
  through a `Proxy` whose `registerUpdateListener` / `registerCommand` wrap
  each listener to do nothing while the selection is in a raw block; the
  codebase has no `Proxy` precedent, and the alternatives (a code format on
  raw text, or misusing an update tag) change other behaviour.
- **Setext headings keep their lines (audit fix; changes a serializer-plan
  row).** The importer reads `Foo  \nbar\n===` as a heading holding a break,
  which the serializer's ATX form flattened to `# Foo bar`. A level 1 or 2
  heading whose content spans lines (a hard break, or the soft breaks of the
  setext heading it came from) is now written setext; levels 3-6 keep the
  space. B4 and S36 test level 3 and gain setext variants.
- **A single-item loose list keeps its blank line (audit fix).** Its
  looseness comes only from the blank line between its text and its nested
  list, which the serializer now writes; blank lines inside nested list
  output are no longer indented into whitespace-only lines.
- **Whitespace around a line-edge source run is kept (fix after the audit
  cap; coordinator-approved).** Line-start trimming after a soft or hard
  break moved an indented `<div>` source run to column 0, where `marked`
  reads an HTML block (`a\n  <div>` saved as `a\n<div>`). Source runs now
  write a `source` piece, and `trimLineEdges` keeps the indent before one
  that starts a continuation line, and one space after one that ends a line
  (more would be a hard break). The first line's indent is still dropped
  (`marked` strips it).
- **An item holding only a nested list starts it on its marker's line**
  (`- - b`; same fix round). A bare `-` line under a `-` item is a delimiter
  row to the viewer's pipeless-table extension, so `- a\n- - b` reloaded as a
  table. S11 (first item) now expects `- - n` (a serializer-plan row).
  Corpus: `item holding only a nested list, second` / `…, first`.
- **A raw block drops its leading indentation** (same fix round). Blocks are
  written at column 0, so a raw block keeping the indent it had after an
  indented list joined the list (`  - n\n\n  ***` → `- n\n\n  ***`).
  `$buildRawBlock` drops the indentation all lines share (at most three
  spaces) and, except for a raw list, what is left of the first line's
  indent; a raw list keeps its lines' relative indentation. The docs say so.
  Not handled: a raw *list* whose first line alone is indented (its later
  lines lazy) after an indented list.
- **Task-list parity is a recorded divergence** (same fix round). An item
  whose text saves with an escape (`- [ ] see [docs]` → `\[docs\]`) is no
  longer a single text run, so the viewer's checkbox quirk shows `[ ]` after
  the save. Not escaping brackets is not safe (a defined label would become
  a link), so the corpus case `task item text that saves escaped` carries
  `parity` and `surface: taskListMarker`, and the reason now says so; the
  viewer defect is for a later viewer plan.
- **Observed, out of scope (viewer bugs a fuzz of load/save found; deferred
  to a later viewer plan):** after a blockquote whose list has a lazy
  line, a thematic break `---` saved a blank line after it (as every block
  is) is read by the dialect's table extension as an empty-header table,
  because `marked` leaves the blank line in the remaining source; and the
  quote's rebuilt `raw` can swallow the first character after it, so the
  viewer shows `div>` for `…\n<div>` and `. g` for `…\n1. g` in the
  original. The saves are correct Markdown; both are viewer fixes for a
  later viewer plan.
- **Stale `markdownSourceEdits.ts` comments repointed** (:322 and :467):
  they described the old line-at-a-time importer and the old export form of
  `**[hello]{…}**`; the refusal logic is unchanged.
- **The `listMarkers` reason also names an ordered-delimiter change**
  (`1. a\n1) a` merges the same way).
- **`$buildFence` strips trailing newlines from `raw`** before taking its
  inner lines: `marked` appends a lone `\n` space token to the previous
  token's `raw`, which otherwise made the closing `:::` a column's content
  (found by `definition after a fence block`).
- **Tests outside the plan's list changed to the new outcome:**
  `round-trips its own output through a mode switch` now expects
  `a **[hello]{color=#cc0000}** b` for `a [**hello**]{…} b` (serializer S19,
  now that the import reads the bold) and checks viewer parity;
  `markdown-view-model` S2 uses a hard break (a soft one is a source node,
  I1); the harness self-test H3/H4 names a surviving reason; the three
  "nested in a cell" serializer tests build their trees directly, since the
  importer never nests a block in a cell and their old-exporter oracle is
  gone.
- **Comments and docs beyond the plan's list.** Stale "transformer"
  comments in `markdownBlockNode.ts` and `markdownSerializer.ts` were
  repointed. The plan's `markdownSourceEdits.ts` anchors had drifted (304,
  413, 613, 692, 1243); `:185` names `UNDERLINE`, which stays, and was left.
  `MarkdownEditor.md` also loses its now-false note that WYSIWYG styling
  inside emphasis writes straddling markers, and the **Kept as source**
  subsection follows the kept images/table paragraph.
- **Lint:** the importer's context field is `spanStyle`, since
  `local/no-element-style` flags any `.style.` member access.
- **Manual M1–M6** were run in the MD Editor demo (`npm run dev`, Chrome):
  the sample matches the live viewer; the three raw blocks show monospace,
  an edit to one and Enter after it (new paragraph) saved with the others
  unchanged; `one\ntwo` shows `one two` and Backspace before `two` gives
  `onetwo`; `##`, `-`, `1.`, `>`, `**`, `++`, `~~`, `` ` ``, `*` and link
  shortcuts all applied; Shift+Enter saved `one\`. No console errors.

### Whole-stack review fixes

- **Authored autolink and span forms (F9, importer half).** The serializer
  plan added `bareAutolinkState` and `spanAttributesState` so a save keeps a
  heading's source text, and with it its id. The importer now sets them: a
  `link` token whose `raw` opens with neither `<` nor `[` (a GFM bare URL,
  `www.` or email autolink) marks its `LinkNode` bare, and a styled span's
  text carries the span's authored attribute text (from the token's `raw`,
  since `attributes` is already parsed). Row **R5** changes accordingly:
  `https://c.d` now saves as `https://c.d`, not `<https://c.d>` (an
  angle-bracket autolink still saves in angle brackets). The docs'
  constructs table says both. The escape of a `.` after `www` in ordinary
  link text (`[www.x.test](…)` saves `[www\.x.test](…)`) is unchanged.
- **Serializer behaviour this branch changes under the review fixes.** A
  newline inside a text node (F1) is a hard break, so in a level 1 or 2
  heading it writes the setext form and in a table cell the cell paragraph
  break, as a `LineBreakNode` does here; the serializer test expectations
  follow. The list rewrite (F2, F6) keeps this plan's authored markers,
  loose lists and the `- - n` form; a `-` list whose first line is a bare
  marker under text is written with `*`, and the `*` is then kept as its
  authored marker on the next load.
- **No source dropped from links and tables (B1, F4).** A link token opened
  a link node only when a leaf arrived, so a link with empty text, or whose
  whole text is another link (`marked` nests `[<https://a/x>](/p/y)` and
  `[[a](/in)](/out)`; Lexical's links do not nest), saved without its
  destination. `appendLink` now checks first (`holdsOwnLeaf`) whether the
  link has content of its own outside nested links; one that has none is
  one `MarkdownSourceTextNode` of its `raw` showing its text (`""` for
  `[](u)`), so it saves byte for byte. A link with text of its own beside a
  nested one keeps row I26 (closed around the nested link and reopened
  after it): every visible run keeps its target. The surface of a nested
  link shown this way loses its link styling (the viewer shows the inner
  anchor); no harness case pins it. The table token gains `droppedCells`
  (a body row holding a non-empty cell past the header's columns, which
  GFM drops); `$buildTable` returns `null` for one, so the table is a raw
  block like any other shape its node cannot hold.
- **Plain-text paste into a raw block (B4).** Lexical's plain-text importer
  inserts a paragraph per newline, which `insertNewAfter` turns into a new
  raw block. A `PASTE_COMMAND` handler at `COMMAND_PRIORITY_HIGH` inserts the
  clipboard's `text/plain` with `insertRawText` (newlines become line
  breaks, as `paste()` does) whenever the caret is in a raw block and the
  clipboard holds no Lexical nodes; a node paste still goes through
  `$pasteIntoRawBlock`. The real rich-text paste needs the browser's event
  classes, so its test drives the command with a probe behind the handler.
- **Formatting, links and inserts decline in a raw block (B5, F3).** A
  `FORMAT_TEXT_COMMAND` handler at `COMMAND_PRIORITY_HIGH` swallows the
  command when any part of the selection lies in a raw block (keyboard
  Ctrl+B and the API alike), and the five toggles, the three style setters,
  `toggleLink`, `insertImage` and `insertTable` return before expanding the
  selection (`declinesInRawBlock`). Block conversions (`setBlockType`, the
  list toggles, alignment and columns) still apply: they turn the block's
  text into a block that saves it. `MarkdownEditorSelectionState` has no
  notion of a command being unavailable, so nothing was added there; the
  context menu still lists the format items, which do nothing in a raw
  block.
- **An HTML block that runs on (B6, F8) — decision: keep the blocks apart
  and write the run-on block unambiguously.** A raw block whose text runs on
  past itself (lexed with a paragraph after it, that paragraph does not stay
  its own: `<!--` without `-->`, `<pre>` or `<script>` without its closing
  tag, an unclosed fence typed into one) and that is followed by a block
  writing something is written as a paragraph holding its text: escaped
  (its first `<` becomes `\<`), its lines kept by hard breaks. The saved
  Markdown then shows the same text and the blocks after it stay their own,
  as the editor showed them; nothing is dropped, and it reloads as a
  paragraph. Rejected: merging the following blocks into the raw block as
  `marked` reads them — deleting ` --` from a comment would fold the rest of
  the document into raw text, and a paragraph could never be added after an
  unclosed comment; and appending a closing `-->` or tag, which adds visible
  text the editor never showed. With nothing after it, or only an empty
  paragraph, the block is written as it is.
- **Code blocks keep their trailing blank line (F7).** `marked` already
  drops the newline before a fence's closing line, so `$buildCode` no longer
  strips one more: `x\n` is a blank last line. Indented code cannot end in a
  blank line, so its text still loses a trailing newline (`    code\n` at
  the document's end lexes as `code\n`). An empty fence holding one blank
  line lexes like an empty one (`""`) and saves without it; the viewer shows
  the two the same.
- **Combined table merges (F5; the shared resolver, so the viewer changes
  too).** `resolveMergeGrid` let a `^^` extend a cell that a `<<` had
  widened in one column only, and a `<<` widen a cell begun in a row above,
  so the anchors were not rectangles: the viewer pushed a cell into an extra
  column or left a hole, and the editor saved an extra column. It now
  tracks each cell's rectangle: a `<<` extends only a cell begun in its own
  row; a `^^` extends the cell above only from its first column and only
  when each further column it spans holds `^^` or `<<` in that row. Any
  other marker is literal text, saved escaped (`\^^`, `\<<`) after an edit.
  The serializer's own output (`^^` in every covered column) still merges,
  and so does `^^ | <<` under a two-column cell. `Markdown.md` and the
  changelog say so.
- **Backspace into a raw block (advisory).** Lexical merged a paragraph's
  text nodes into a raw block before it, losing formatting and escapes
  (`**b** and \*star\*` → `b and *star*`). A `DELETE_CHARACTER_COMMAND`
  handler joins the paragraph as its serialized Markdown instead (Backspace
  at its start, or Delete at the raw block's end), the caret at the joint;
  the serializer exports `$serializeBlock` for it. A heading, quote or code
  block first turns into a paragraph, as before.
- **Smaller fixes.** `locateToken` iterates the later line starts lazily
  (`candidateStarts`, a generator) instead of listing every line to the
  document's end for each token after a `[` line; the raw-block lookups of
  the Enter, paste and shortcut guards share `$rawBlockAtAnchor`; the
  changelog no longer says WYSIWYG writes a span straddling emphasis
  markers or that a span mixing emphasis is re-normalised on a mode switch
  (both now save as written); `markdownSourceEdits.ts` no longer says a span
  cannot cross a newline.

- **Source mode reads the viewer's tokens (C1, C2, F13 and the advisory; see
  *Source mode reads the importer's tokens*).** `markdownSourceEdits.ts`'s
  regular expressions (`MARKER_CHARACTERS`, the flanking and delimiter-pairing
  scans, `LINK_PATTERN`, `BRACKET_CONSTRUCT_PATTERN`, `STYLED_SPAN_PATTERN`,
  `STRUCTURAL_LINE`, `BLOCK_LINE`, `lineCarriesMarkersOutside`,
  `unitsCouldSplitMarkerRun`, `overlapsUnparseableStyledSpan`) are gone; the
  new `markdownSourceTokens.ts` gives every command the located tokens and
  the document's meaning (blocks and visible characters with their formats)
  for the result check. Verified first that concatenating `raw` reproduces
  the source: it does for every probe except a dropped repeated definition
  (`[a]: /one\n[a]: /two`), and inside containers only after the quote and
  indentation prefixes are skipped; a list item's tab indentation is
  expanded to spaces in its text, so such an item's content stays unlocated
  and source commands decline there. Fixed, each pinned by a unit test and
  an end-to-end one (the command, then `setMode('wysiwyg')`, comparing the
  editor surface with the viewer of the resulting text), all seen to fail
  first:
  - **C1:** `_hello world_ again` with `world_ again` selected now declines
    (the range cuts the `em` token); `__hello__` reports bold; Italic on
    `_hello_` gives `hello`, Bold on `__hello__` gives `hello`; clear
    formatting clears `__hello__`; a caret in `_hello world_` expands to
    `world`, not `world_` (word expansion stays inside the innermost run's
    content).
  - **C2:** every link the viewer reads counts — `[docs]`, `[docs][]`,
    `[docs][d]`, `<…>`, bare-URL, `www.` and email autolinks, a destination
    holding parentheses, link text holding brackets: styling inside one is
    refused, `linkUrl` is its `href`, `removeLink` unwraps it, `toggleLink`
    re-points it (a reference link or autolink becomes `[text](url)`, a
    reference link keeping its title, as the reference-links plan's
    serializer writes a re-pointed reference link), and a new link is never
    wrapped around an existing one. Unwrapping an autolink escapes its `:`,
    `.` or `@` with the serializer's own rules, so the text is not linked
    again (`https\://e.com`).
  - **F13:** inline toggles, `linkSource` and `spanStyleSource` treat an
    autolink as atomic: markers inside one decline, a selection of its whole
    text formats the whole autolink (`**<m@x.y>**`), and `toggleLink` inside
    `<https://a.b>` re-points it instead of nesting.
  - **Advisory, the line refusal:** a range is refused only when it cuts a
    token's syntax, lies outside one block's inline text (a code block, a
    `:::` fence line, a table delimiter row — which also replaces
    `STRUCTURAL_LINE`) or touches a link or image; `**hello [world]{…}
    again**` styles `again`, and `*`/`+` list items style. A selection
    reaching into a list marker, a quote's `>` or a heading's `#` is clamped
    to that block's text, so Bold on a whole `- item` line gives
    `- **item**`. Inline commands inside a code block now decline (they used
    to write literal markers into the code).
  - **Advisory, the span form:** source mode writes `**[x]{…}**`, the
    serializer's form for colour on a whole bold run, instead of
    `[**x**]{…}`; the extrusion is gone.
  - Kept: the flanking, escape, image, fence and delimiter-row refusals, the
    no-op declines and the one-transaction edits all hold; the flanking and
    escape refusals now come from the result check rather than predictions.
    A format toggle on a selection strictly inside a run of the same format
    declines (un-formatting part of a run stays a WYSIWYG-mode operation),
    though the selection state reports the format; and a toggle pressed after
    a multi-span style command now declines instead of writing markers across
    the span syntax. `paragraphAroundBlockSource` finds its block from the
    top-level token spans; `blockPrefixSource`, `listSource` and
    `FENCED_CODE_SOURCE` keep their line regexes, since they rewrite whole
    lines' prefixes rather than read inline structure.
  - Test expectations changed, each because it encoded the regex
    limitation: the underline flanking decline (`++hello.++b` — the viewer's
    `++` extension has no flanking test), the two extrusion tests and the
    "only emphasis on its line" test (now `**[…]{…}**`), "inside a wider
    emphasis run" (styled for `**`, `*`, `~~`, `++`; still declined inside a
    code span), "literal marker characters in prose", "between two runs",
    "nested run", "over-declines", "marker run wrapping a span" (accepted
    with the run outside the brackets; the code-span case still declines),
    "marker character that is not emphasis" (all four now style), the two
    newline-span declines (the viewer reads such a span, so it now merges or
    splits), and in `markdown-editor.test.ts` "setTextColor inside a wider
    bold run" (now writes inside the run) and the round-trip row
    `a [**hello**]{…} b` (replaced by source mode's new output).
  - One lex per distinct text, cached, so the selection state read on each
    caret move and the command after it share it; measured at 1.6 ms for a
    10 KB document and 14 ms for 200 KB (Node). A fuzz of 8 000 random
    documents × source commands (two seeds) found no accepted edit whose
    WYSIWYG surface differs from the viewer's reading of the result, and none
    changing the visible text.
- **The docs name the `_` emphasis the serializer can now write.** A
  whole-stack review fix in `markdown-editor-serializer` writes an outer
  bold or italic pair with `_` when `marked` would pair its `*` with an
  inner run (`_foo fuzz**bar** baz_`), so the supported-constructs row for
  underscore emphasis and the changelog's "Saving writes `*`/`**` emphasis"
  now say so. That fix pairs delimiters across a block's lines, since the
  soft line breaks this plan keeps hold emphasis open across them.
- **The line commands read the tokens too (fuzz #4, #15), and every inline
  wrap keeps a cell's paragraph break whole (fuzz #16a).** A fuzz pass found
  `blockPrefixSource`, `listSource` and `FENCED_CODE_SOURCE` rewriting one
  line of a multi-line construct: a lone fence line dropped (the rest of the
  document became code), a definition's continuation line or a table row
  turned into a heading. `markdown-source-mode-editing` fixed it there with a
  line-based construct scan, as that module still was; here, where the
  module already lexes the document, that scan is replaced by the tokens.
  The analysis now locates `SourceConstruct`s at any depth — code blocks,
  tables, definitions, HTML blocks and each `:::` fence line — and a line
  command declines a selection touching one, except a top-level fenced code
  block selected whole, which still converts with its fences dropped (not for
  `listSource`). So the protection now also reaches a code block or table
  inside a list item or quote, which the line scan could not see. A
  definition `marked` drops — one whose label an earlier definition already
  defines, so no token stands for it — is found as the source between two
  top-level tokens' `raw`s and protected too (in a fuzz of 3 600 documents
  every such gap was a dropped definition; the search stops at the first
  `raw` not found verbatim, so it never mistakes a token's own text for one).
  For #16a, the analysis marks a table cell's inline text (`SourceInlineBlock.cell`)
  and `wrapRange`, `wrapInLink` and `resolveSpanRange` decline a placement
  holding or cutting into the cell's literal `\n\n`, as the earlier
  branches' regex versions do.
- **The importer half of the serializer's edit-fuzz fixes, and the setext
  fallback (fuzz #13a, #13b).** The serializer plan added
  `imageAttributesState` so an edited block keeps an image's authored
  attribute group (`{width=x}`, `{bogus=1}`, `{height=2 width=3}`) and with
  it a heading's id; `appendImage` now sets it from the token's `raw` (its
  `attributes` are already parsed), as a span's are. The serializer's
  setext writer — this plan's — now also checks each line it would write:
  `marked`'s setext rule reads no heading when a line starts with three or
  more backticks or tildes (a code span holding runs of both one and two
  backticks needs such a fence) or is a lone tag (an angle-bracket
  autolink alone on its line), so such a heading is written ATX, its line
  breaks as spaces, rather than saved as a paragraph. A bare autolink inside
  emphasis right before a word (`*http://e*4`), a code fence for an info
  string holding a backtick and a code span after a heading's line break
  needed no importer change: the serializer fixes them on what this plan
  already loads, and round-trip rows here pin the first. The docs'
  constructs table (fenced code, sized image, setext heading) and the
  changelog say so.
- **The line commands keep a paragraph whole here too, and a dropped
  definition inside a `:::` column is found (fuzz (a)–(d)).** A later fuzz
  pass found the line commands splitting a paragraph, writing markers on
  blank lines, and fencing or tabling a list item's content;
  `markdown-source-mode-editing` fixed (a)–(c) with its line scan, and its
  "Whole-stack review fixes" gives the per-case decisions (include the whole
  paragraph for `setBlockType`, `setBlockType("code")` and `insertTable`;
  decline for the list toggle's hazards, a blank line alone, and a fence or
  table inside a list item). Here the same protections read the tokens:
  every line of a located paragraph, heading or list item text after its
  first continues it, and a setext heading's text (`SourceInlineBlock.setext`)
  has its underline on the next line; "inside a list item" is a line in a
  top-level list indented deeper than the list's first line. For the list
  toggle the line scan's two regex checks (a continuation line opening a
  definition, HTML block or item; a line below interrupting the new item)
  become one token check, `keepsVisibleText`: the result, re-lexed, must
  show the same text, whitespace and hard breaks aside, and the same code
  and HTML block text — so a line that would turn into a definition, HTML,
  code or a nested item declines, whatever the construct, including a
  quote's continued line left under a marker the selected line lost
  (`> + a\n>     [](/u)` → `- + a\n>     [](/u)` made the second line
  code), which the line scan cannot see. (d): `marked` drops a repeated definition inside a
  `:::` column as it does at the top level, but only top-level gaps between
  `raw`s were searched, so a heading or quote on one showed it as text. The
  search now descends into each `:::` fence's columns, whose tokens are
  lexed from the fence's source as written, and records each run of lines in
  a gap holding anything but whitespace, a `|||` separator or the closing
  `:::` — one construct per run rather than one per gap.
- **Edit-fuzz round: code blocks hold only text (#1).** A code block saves
  only its text, but formatting, links and images could be put into one, and
  were dropped by the save. The raw-block guard now covers code blocks too
  (`$isTextOnlyBlock`; `declinesInRawBlock` became `declinesInTextOnlyBlock`
  and the `FORMAT_TEXT_COMMAND` handler `$declinesFormat`): the five
  toggles, the three style setters, `toggleLink`, `insertImage` and
  `insertTable` decline there, from the keyboard too. `setBlockType("code")`
  passes `$setBlocksType` an after-create hook (`$copyBlockAsCodeSource`)
  that replaces a block's inline content with its Markdown (the serializer
  exports `$serializeInlineNodes`), so `a ![i](…) [l](…) **b**` becomes a
  code block holding exactly that text instead of `a  l b`. Nodes pasted into
  a code block go in as plain text (the raw block's paste handler, now
  `$pasteIntoTextOnlyBlock`, joining pasted blocks with a line break there
  rather than a blank line); this also ends the `Expected node TextNode …
  block ElementNode ancestor` throw a paste of HTML into a code block hit,
  where Lexical had put a heading and a quote inside the code node.
- **Deleting from a raw block or code block into the next block (#2).** A
  range deleted from inside such a block into a later one merged the later
  block's nodes into it, so its links, images and formatting were shown but
  not saved (`<div>\nx|x … l|l` gave `<div>\nxl bb`). `$joinIntoTextOnlyBlock`
  (the old Backspace/Delete join, extended) now detaches the rest of the
  later block after the range (`$detachRestOfBlock`, keeping copies of the
  links it sits in), deletes the range to that block's end, and inserts the
  rest's Markdown at the joint (its text, when the later block is text-only
  too); the edge whitespace the serializer trims at a line's edges is kept
  (`$inlineMarkdown`). The collapsed Backspace/Delete join covers code
  blocks as well. Typing or pasting over such a range, or cutting it, goes
  through Lexical's own merge; a node transform on both block types
  (`$keepTextOnly`) replaces any run of non-plain children (a link, an image,
  formatted or styled text, a source run) by its Markdown, so nothing is
  dropped there either — plain text joined that way keeps its characters but
  not its escapes, the one difference from the delete path.
- **A code fence keeps its whole info string (#3b).** The importer kept only
  the info string's first word as the language, so ```` ```ts extra ````
  saved as ```` ```ts ```` after any edit. A new `codeInfoState` holds the
  info string as written (taken from the fence line of the token's `raw`,
  since `marked` unescapes `lang`) when it holds more than the language; the
  serializer writes it while its first word, unescaped, is still the
  block's language, as `spanAttributesState` and `imageAttributesState` do.
- **Inline HTML opening a paragraph line (#5).** A paragraph line starting
  with a source run that `marked` reads there as an HTML block start (`<v>`
  alone on a first line, `<div>` on any line, `<!--`) made the save an HTML
  block (`a<v>\nb *c*`, Enter after `a`, saved `a\n\n<v>\nb *c*`).
  `escapeHtmlBlockStart` lexes such a line where it stands — alone for a
  block's first line, after a paragraph line for a continuation line — and
  escapes its `<` when it is not read as paragraph text; the viewer shows
  inline HTML as its text, so `\<v>` shows the same. Only source runs need
  this: text `<` before a letter is always escaped.
- **Formatting declines over a run kept as source (#6) — decision:
  decline.** A format, style or link put on a source run was shown but not
  saved as shown (a colour on `[ ] `, inline code on `<b>`, a colour on a
  nested link), and bold around a task-list marker turned it into text. The
  serializer writes marks around a source run, but not code or every style,
  and markers around a run can change what it is, so the safe uniform rule
  is the raw block's: the toggles (`FORMAT_TEXT_COMMAND`, keyboard
  included), the style setters and `toggleLink` decline when the selection
  holds part of a source run other than a soft break, whose whitespace takes
  the marks around it (`$selectionCoversSourceRun`); a run the selection
  only borders does not count. `clearFormatting` still applies (removing
  marks from a run saves as shown). The test `toggleLink over a selection
  starting inside a source node links the node whole` now expects the
  decline.
- **A list next to a raw list stays its own list (#12).** `- a\n\n  b` (a
  raw block) followed by a list toggled to bullets saved `- a\n\n  b\n\n- x`,
  one loose list to the viewer. `serializeBlockList` writes a top-level list
  next to a raw block through `serializeListApart`: its own marker when the
  two do not join (`blocksJoin` lexes them together and counts blocks),
  else the first other bullet or delimiter that keeps it apart from both
  neighbours, else (an ordered list between raw lists of both delimiters)
  its own marker and an empty `<!-- -->` block on the side it would join —
  CommonMark's separator, which then loads as a raw block of its own.
  Adjacent list nodes never occur (Lexical merges lists of one type), so
  only raw neighbours are checked.
- **`removeLink` on a link nested in a link (#16b).** In source mode,
  unwrapping the inner link of `x [[a](/in) b](/out) y` gave
  `x [a b](/out) y`: `a` re-pointed to `/out`, accepted because the
  verification expected the outer link for the inner link's text. Its text
  is now expected unlinked, and a nested link is taken out of the outer one
  (`takeOutOfLink`: the outer text before and after it each keep the outer
  destination, `x a[ b](/out) y`), as WYSIWYG's `removeLink` already did;
  anything that does not verify declines.
- **Import: a link whose text all sits in nested links shows as the viewer
  shows it.** The source node B1 introduced showed the text plain, where the
  viewer shows the inner link (`[[2]()]()`, `[<ps:>]()`, `[~~[6]()~~]()`).
  `appendNestedLinkRuns` splits the link into runs by target and format
  (`nestedLinkPieces`, slicing `raw` around each container's content) and
  appends each as a source node inside a link node with its nested link's
  target, carrying the formats and style written inside the outer link; the
  sources joined are the `raw`. A new `nestedLinkState` holds those format
  bits (and `NESTED_LINK_WRITES_STYLE` for a style set inside), and the
  serializer writes such a run outside the link node it sits in with only
  the other marks and style around it, so the save is byte for byte. The
  link commands decline inside such a link (`$selectionInNestedLinkRun`),
  and `clearFormatting` keeps the bits its source writes. The three B1
  tests now expect the link node around the source node.
- **A nested link's runs save as source only while they form whole
  links.** An edit can delete some of a split nested link's runs, type
  between them or split their paragraph, leaving source that no longer reads
  as a link (`# [](/p) [[**a**` after deleting the second run). The
  serializer checks each run of consecutive nested-link segments
  (`keepIntactNestedLinks`: the joined source must lex to link tokens alone)
  and otherwise writes what the runs show — their text, marks, style and the
  link node they sit in — each stretch of one outer link's runs wrapped in
  that outer link's syntax again (a new `nestedLinkGroupState` holds a group
  id and the outer link's closing syntax, `](/out)`), so the save reads as
  the editor shows it and keeps the outer destination.
- **Import: an image the viewer rejects shows nothing.** Its source node
  showed its Markdown, where the viewer renders nothing; it now shows
  nothing and saves its Markdown, like an empty link. The `plainImage`
  divergence is gone (test I20 changed).
- **Import: a raw block keeps the indentation `marked` reads it by.**
  `marked` measures a quote's lazy line and a list's next marker against the
  margin, so dedenting a raw block could change what it is (` >)\n <!--`:
  the comment left the quote; `   + __4_\n\n     p\n    + 2`: one item
  became two). `$buildRawBlock` now keeps a dedent only when the text still
  lexes to the same block structure (`blockShape`), else dedents less or not
  at all. This is not the documented raw-list non-goal (a raw list whose
  first line alone is indented). A located block also runs to its line's
  end, so whitespace ending its last line is kept (`>```\n>  `: the code
  line of spaces); I7's `> - not\nx  ` now saves its trailing spaces.
- **Harness: an empty run splits nothing.** The surface projection pushed an
  empty text run (an empty link's source node), which split the runs around
  it (`__[]()_,` projected `_` `,` where the viewer gives `_,`); `pushText`
  now ignores empty text (S10). Corpus cases for each fix above were added
  to `dialect.ts`.
- **Emphasis around a run that shows nothing.** An empty link carrying a
  mark (`__[]()_,`, then a word typed before it) saved `\_1*[]()*,`, where
  the `*` after a letter cannot open and reads as literal text. Like the
  marks around an image (`imageMarks`), a mark on a source run showing
  nothing is now written only where its delimiters pair around the run
  (`invisibleRunMarks`); elsewhere it is left off, which changes nothing
  shown (`a **[](u)** b` keeps its bold).
- **The raw-block reading check lexes only when a dedent changes the
  text,** so a long run of definitions at column 0 is not lexed again (the
  reference-links plan's linear-load test).
- **Import: a task item `marked` made loose is kept as source.** The viewer
  prints a task marker inline only before a `text` token; before a paragraph
  (`- [x] a\n\n  - b`, an item made loose by the blank line before its
  nested list) it prints it on a line of its own, which an item's one line
  of text cannot show, so `$buildListItem` declines and the list is a raw
  block (surface `listItemBlocks`, like any list it cannot hold).
- **Import: a dropped definition's title line is not taken for the next
  paragraph.** Locating the token after a dropped repeated definition whose
  title sits on its next line (`[x]:a\n[x]:>\n"t"\n"t"`) matched the title
  line, so the editor showed `"t"` twice. Later candidate lines now skip the
  lines a definition opening on a candidate runs on to, read with `marked`'s
  own definition pattern (`nextLineAfterDefinition`).
- **Kept, with the reason.** The fuzz's remaining load divergences at this
  branch are the existing `listMarkers` (Lexical's `ListNode` transform
  merges adjacent lists of one type; the editor cannot hold two),
  `taskListMarker` (a viewer quirk the viewer block-fixes plan changes:
  matching it here would mean copying a viewer defect) and the
  reference-link cases the next plan covers.
- **The line commands act on the blocks the viewer reads (source-mode fuzz;
  see *Source-mode line commands act on the blocks the viewer reads*).** The
  earlier fixes above put token guards on the line rules; a source-mode fuzz
  still found the rules writing the wrong thing, so on the user's decision
  `blockPrefixSource`, `FENCED_CODE_SOURCE`, `listSource`, `tableSource` and
  `paragraphAroundBlockSource` were rewritten over the tokens, in the new
  `markdownSourceLines.ts`. `markdownSourceTokens.ts` builds a
  `SourceBlockNode` tree with each block's span (a paragraph's or heading's
  own `raw` is now located too, without moving the inline search) in place
  of `constructs`, `blocks`, `recordDroppedSource` and the inline blocks'
  `setext` flag; `markdownSourceEdits.ts` loses its line code
  (`selectWholeLines`, `readParagraphLines`, `insideListItem`,
  `keepsVisibleText`, …). Fixed, each pinned by a unit test and an
  end-to-end one, all seen to fail first:
  - a list item's line made a heading, quote, paragraph or fence at column 0
    left the item's other content behind as indented code or lazy text — the
    content now stays in the item, re-opened by its marker;
  - a line made a paragraph joined its neighbour (swallowing a definition or
    an indented line below, or running into a list item or paragraph above) —
    the converted block is set apart by a blank line;
  - `insertTable` with the caret in an HTML block or a table split it — the
    table goes above the whole block;
  - stripping `######` left `~~~` opening the line, which opened a fence —
    the re-lex check catches it, and the escaped form (`\~~~`) is written;
  - a line after a fence closed inside a nested quote, which the viewer does
    not show, was rewritten as text — such a line declines every line
    command, as a repeated definition already did;
  - WYSIWYG `setBlockType` and the list toggles in a table cell wrote `## `
    or `- ` into the cell (the run fuzz's `editParity` on table cells) — they
    decline there; source mode already declined on a table's lines.
  Test expectations changed, each because it encoded the line rules: the
  list toggle off (`- a\n- b` and `1. a\n2. b` now give `a\n\nb`, two
  paragraphs, where `a\nb` joined them into one); `> + a\n>     [](/u)`
  toggled unordered (the viewer reads `+ a` as an unordered item, so it is
  now toggled off to `a\n  [](/u)`, still with no code, where the line rule
  saw no marker behind the `>`); and the fence on a list item's content
  (`- a\n\n  b` and `- x\n  - a` now lift the text out as a top-level code
  block, where the line rule declined because fences at column 0 ended the
  list). A source-mode fuzz of 4 500 documents × 4 commands (seed 501, the
  same seed as the run that found these) leaves no line-command result that
  adds or drops visible text; its remaining WYSIWYG surface differences are
  the kept `listMarkers` merge (a converted list next to another of one
  type) and one reference link inside a quote kept as a raw block.

### Unrepresentable-state round

A third whole-stack fuzz (run and paste edits, seeds 601 and 1709, 3 000
documents per mode; a source-mode fuzz, seed 1713, 4 000 per mode) found
states the editor could make but a save could not write as shown. On the
decision that the editor must not be able to make them, so what it shows is
what it saves, each is prevented or shown as saved. The rules live in a new
module, `markdownWritable.ts` (`registerWritableStateRules`, registered
right after `createEditor`, before the first load), as node transforms and
command handlers in the style of the raw-block rules above; it is a new
module rather than more of `MarkdownEditor.ts`, which already ran past
4 000 lines.

- **Line breaks (decision: decline, and show what is saved).** Shift+Enter
  (`INSERT_LINE_BREAK_COMMAND`, at `COMMAND_PRIORITY_HIGH`) declines in a
  level 3–6 heading and wherever no content follows the selection's end in
  its block (the end of a block, a block holding nothing else); a table cell
  is exempt, its cell break shows anywhere. Transforms on paragraphs,
  headings, quotes, list items and text remove the breaks after a block's
  last content (and each run's before a nested block in a list item) that a
  paste, a deletion or a converted code block leaves, and turn every break
  and newline in a level 3–6 heading into the space it saves as. UX
  consequence, accepted with the decision: Shift+Enter at the end of a line
  being typed does nothing; Enter or Shift+Enter mid-line still work.
- **Bold, italic and strikethrough edges (decision: trim, then decline).**
  `FORMAT_TEXT_COMMAND` is now handled at `COMMAND_PRIORITY_HIGH` by
  `$formatWritably`, which formats through `$editWritably`; the style
  setters, `toggleLink`, `clearFormatting` and the typing shortcuts (through
  the shortcut proxy's `update`) run through it too. It first takes the
  three formats off whitespace at each run's edge — a run crosses a link or
  a styled span only where the format covers it whole, as the serializer
  writes marks — and then, when a touched block read back as shown before
  and no longer does (the serializer's new `$readsBackAsShown`, which
  compares the reading of the nodes as shown — before the writer moves a
  `+` out of underline or a bracket out of a span — with the reading of the
  Markdown written for them), restores the blocks' content from a JSON
  snapshot (their own nodes kept, so a block loaded unchanged still saves as
  loaded) and the selection, tagging the update historic so it adds no undo
  step and does not re-trigger the shortcuts. This declines emphasis opening
  with punctuation after a letter or closing before one, underline over `+`
  and a style over a bracket. A selection's format is decided by Lexical as
  before (`$formatText`); a test selection made in code has no format of its
  own, so the "take bold off a word" test sets it as the view would.
- **Edits other than commands (decision: adjust).** After a deletion, a
  paste, a cut, a drop or a split (each such command tagged at
  `COMMAND_PRIORITY_CRITICAL`), the touched blocks get the same whitespace
  trim plus a punctuation trim (`$keepMarksFlanking`: the format comes off
  an edge character where its delimiter could not stand, a code span or
  source run at the edge losing it whole, and a link the format covers whole
  — written outside it, against its bracket — losing it whole too; the
  formats a run of a link nested in a link writes in its own source are
  never touched by either trim). A `+` in underlined text and a
  bracket in styled text always show without them
  (`$keepUnwritableCharactersPlain`), typed or pasted. Typing is left alone:
  a space typed after bold text is at the run's edge only until the next
  word, and a word typed before emphasis that opens with punctuation remains
  the `emphasisNextToWord` divergence the source-preservation plan records.
- **`insertImage` declines alt text holding a bracket**, in both modes; the
  save dropped the brackets.
- **A soft break keeps its formats.** A whitespace-only source segment with
  underline now opens the underline, as whitespace text does (`a+b++\n++a`
  keeps its underlined soft break); one with inline code is written as the
  code span's space, so a code span over a soft break saves as one span
  (`> bar\n!baz` with code over `bar` and the break: `` `bar !` ``).
- **A link holding only whitespace at a block's edge is unwrapped** (the
  save dropped it and its destination), by the same transforms.
- **Lists (decision: keep Lexical's join only where the markers agree).**
  `@lexical/list`'s `ListNode` transform joins a list with the next of its
  type whatever their markers and cannot be turned off through a public
  API, so `editor.getRegisteredNode(ListNode).transforms` (`@internal`) is
  cleared right after `createEditor`, when it holds only that one, and
  `$normalizeList` takes its place: it joins only lists whose saves write
  the same marker (`$writtenListMarker`), never during a load
  (`MARKDOWN_IMPORT_TAG`, which `$importMarkdown` now sets: `marked` reads
  two lists of one marker apart after an empty item), numbers the items as
  before, and keeps the looseness writable. `$insertList` still joins a new
  list into its neighbours, as before. The serializer keeps two adjacent
  lists that would write one marker apart, as it already did next to a raw
  list (`serializeListApart` now also looks at a list before). The harness's
  `listMarkers` divergence is gone (CommonMark 301 passes).
- **Looseness (decision: recompute).** The list transforms set
  `listLooseState` to what the save reads as (`$listReadsLoose`): a list of
  one item of one block cannot be loose, and an item holding a block after
  its nested list makes the list loose; text typed in such a block or in a
  one-item list recomputes it too. The two F6 serializer tests now expect
  the loose output (`- a\n\n  1. b\n\n  X`), which the viewer reads the same.
- **Tables (decision: normalize).** A change to a row or cell marks its
  table changed, so `registerTablePlugin`'s own transform pads short rows;
  `$alignCellsByColumn` gives every body cell its column's (the header
  cell's) alignment and keeps a row span from reaching past the last row
  (the save writes no row for it to continue into); a heading, quote, code
  block or list pasted into a cell becomes the paragraphs the save writes
  for it.
- **Per-cell alignment:** with the table normalized, an alignment applies
  per column whatever made it; `setTableColumnAlignment` already set the
  whole column. `setBlockAlignment` in a cell still aligns the whole table
  through a `:::` fence, which Markdown holds.
- **A raw block that saves as a paragraph shows as one (decision: convert,
  not keep raw).** When a raw block's text runs on and a block after it
  writes something — the case the B6 decision saves as an escaped paragraph
  — the editor turns it into that paragraph (`$rawBlockWritesAsParagraph`),
  checked as its text or the blocks around it change; `runsOn` caches its
  answers. Keeping it raw by not escaping was rejected: the text would take
  in the blocks after it.
- **Smaller fixes the round found.** An item opening with a nested list of
  empty items no longer writes a thematic break (`- - -`: the nested list
  takes the other bullet); inline HTML opening a list item's continuation
  line is escaped where it would end the item (`InlineContext.inListItem`),
  and an escaped continuation line drops its indent so the save is stable;
  text pasted into a code block with CSS the save writes no span for
  (`white-space`) or inline code stays plain text, its newlines lines, not
  hard breaks written as Markdown.
- **Not owned here.** The `is` throw in `MarkdownColumnNode.splice` is
  `$wrapSelectedTopLevelBlocks` (setBlockAlignment / setColumnCount over a
  cell or column), with the `insertAfter` and `$getTextNodeOffset` throws
  the separate command-crash-fixes plan's defects 1–3; they reproduce on
  `master`.

### Stack fuzz round

A fourth whole-stack fuzz, run at the stack's top (run and paste edits,
seeds 601, 1709 and 2207, 3 000 documents per mode; source mode, seed 2311,
4 000 per mode), on the rule that what the editor shows must equal what it
saves and that it must not make a state Markdown cannot write:

- **A construct the standard form would write differently is kept as
  written (decision: keep the source, not rewrite it).** The importer now
  reads each block's standard form back (the serializer's new
  `$readStandardForm`, which also records the reading units each token
  covers) and, where it reads differently from the load, keeps the smallest
  set of inline tokens it can (`$buildKeepingConstructs`: greedy candidates
  under the first difference, at most `MAX_KEEP_TRIES` builds, falling back
  to keeping every top-level token and minimizing) as atomic source runs
  (`keptSourceState`: a group, each run's index and size, the formats its
  source writes, and what the construct shows). Only the construct is kept;
  the text around it stays ordinary text. The serializer writes a whole
  kept construct as its source and reads it as what it shows; a construct
  an edit takes apart, or that no longer reads as kept, dissolves into
  ordinary text. `clearFormatting` keeps the formats a kept run's source
  writes (`KEPT_SOURCE_WRITES_STYLE` / `KEPT_SOURCE_WRITES_LINK` carry its
  style and link).
- **A raw block whose text reads as several blocks shows as them (decision:
  split, not keep raw).** `$readRawBlockAsBlocks` lexes the text; when it
  is more than one block, and not only definitions, the raw-block rules
  replace it with the blocks it saves as and put the caret where it was in
  the text (`$showRawBlockAsItsBlocks`).
- **Two raw lists an edit brings together are kept apart by `[//]: #`
  (decision: an empty definition, not `<!-- -->`).** CommonMark's comment
  separator loads as a raw block of its own; a `[//]: #` definition shows
  nothing and reads as nothing, so the separator is invisible both ways.
  `serializeBlockList` writes it between raw blocks whose lists would join
  (`listsJoin`).
- **Typing tidies run edges too (decision: supersedes "typing is left
  alone" above).** The tidy transform runs on the leaves an update edited
  (caret-adjacent, or an existing node whose text changed): it joins runs
  across whitespace of the same style, trims whitespace off the edges near
  the edit and, when the block no longer reads back as shown, takes the
  format off an edge its delimiter cannot flank. A space typed after bold
  text shows plain until the next word joins the run, and a word typed
  right before emphasis that opens with punctuation takes the emphasis off
  that edge — so the `emphasisNextToWord` divergence is gone. A run whose
  own source writes the format (a kept or nested-link run) does not join a
  run of that format next to it.
- **Read-back sees whitespace (decision: one unit per collapsed stretch).**
  With `InlineContext.readsWhitespace`, every read-back keys a stretch of
  whitespace by its marks, so a struck or underlined space that the save
  would drop or move no longer reads as equal. A source run that would open
  a block on its own (`<br>`) reads inline in a paragraph's line, so a block
  holding one still gets the writing policies' read-back.
- **Setext heading `<+a**b**c\`:** fixed by the escaped-angles writing
  variant in the serializer plan (a `<` written escaped wherever it would
  open an autolink or HTML across a delimiter).
- **Underline over a soft break in a setext heading:** did not reproduce
  (0 hits; `++a\nb++` over `===` and underline toggled over setext lines
  read back as shown).

### Stack fuzz round 2

A fifth whole-stack fuzz, run at the stack's top with a harness cleaned of
its own artifacts (run and paste edits, seeds 601, 1709, 2207, 3313 and
4409, 3 000 documents per mode; source mode, seed 4517, 4 000 per mode), on
the rule that the editor shows what is saved and what the viewer renders:

- **A raw block whose text reads as one block the editor holds shows as
  that block (decision: convert, extending the several-blocks rule).**
  `$readRawBlockAsBlocks` now also returns a reading of one block when a
  load builds a node of its own for it (a paragraph, heading, code block,
  quote, list or table) rather than a raw block. A tag a deletion broke
  shows the paragraph the viewer reads, not Markdown text.
- **Halves of a definition a paste split (decision: save as the editor
  shows, by showing them as the paragraphs they are).** A paste splitting
  a definition's raw block left two raw blocks the save joined across the
  blank line — `marked` accepts a label or a `"…"` / `(…)` title spanning
  blank lines — so the editor showed two blocks and the viewer one
  definition. Each half now reads alone as a paragraph, so the rule above
  shows it as one, and a paragraph's save escapes its `[`; the save reads
  as the two paragraphs. Merging the halves into one definition instead
  was rejected: the pasted content would vanish into its label.
- **Nested lists in an item keep their own reading.** A nested list after
  a block of its item other than the item's text follows a blank line (the
  serializer plan's fix), so `$listReadsLoose` counts a list after an
  item's first block that is not text (`itemBlockKinds` now tells text from
  other blocks). Two nested lists of one item with one marker, and a nested
  list next to a raw list of its marker, are written with another bullet or
  delimiter (`keepNestedListsApart`, generalizing the thematic-break
  `withBullet` to `withMarker`).
- **A merged header cell is split (decision: states Markdown cannot hold
  are not created).** Markdown merges body cells only; a range deleted
  from the header row into a merged body row left the header cell spanning,
  which the save cannot write, and the rows short. `$unmergeHeaderCells`
  (in the table transform) splits it into the cells it covered, with empty
  cells where the span reached into lower rows.
- **A table cell reads back as a whole.** Its paragraphs are written on one
  line joined by the cell break, and `marked` reads them together (a `<`
  in one paragraph and a `>` in the next mask the emphasis between), so
  `inlineRuns` makes a cell one run, read against the cell's whole save.
- **A link nested in a link reads back.** Its runs read as what they show,
  as a kept construct's do; before, a run holding one was never checked, so
  nothing caught a paste breaking emphasis around it.
- **What no writing reads back shows as saved (decision: the editor shows
  the save, as a last resort).** `marked` has corners no writing reaches —
  a code span holding a backtick hides the delimiters after it from
  emphasis pairing — so after the existing trims, a run that still would
  not read back (a paste, a deletion, typing) is rebuilt from its save's
  tokens the way a load builds it (`$showRunsAsSaved`, through the
  importer's new `$buildInlineContent`), when that rebuild reads back; the
  caret keeps its offset in the run's text. It can drop formatting the
  save cannot hold there, which then shows as the literal delimiters the
  viewer shows.
- **Smaller fixes the round found.** A reference kept as source in its
  shortcut form (`![foo]`, which shows its alt text) is written `![foo][]`
  where a bracket or parenthesis written after it would join it to a
  following link; `blocksJoin` also counts a block that takes in part of
  the next (a list taking an indented raw list's first item as its own
  nested list), so a list before such a raw block is kept apart; a fence
  keeps its authored attribute text (the importer sets the serializer
  plan's `fenceAttributesState`), so `{columns=2}` and attributes the
  editor does not model survive an edit of the fence (the I24 test now
  expects it kept); a level 2 heading whose continuation line keeps an
  indent of four spaces before a source run is written ATX, since `marked`
  reads such a line as ending a setext heading's content; and a link a
  paste leaves with no content at all is removed (`$removeEmptyLinks`): it
  shows nothing and the save wrote nothing for it. A link holding a link
  whose text escapes a bracket (`[`9`[\[4]()](9)`) is now kept as written:
  `keptPieces` found its children's text in its `raw` only exactly, but
  `marked` drops the escape of a bracket in link text, so it matches the
  escapes back (`contentSpan`, `escapedEnd`); the standard form had moved
  its parts, changing a heading's id and what a struck text read as.
- **An image inserted next to source kept as written.** An image `marked`
  reads but the dialect's image rule declines (`![a](data(:…)`, whose
  destination holds a parenthesis) shows its alt text, kept as source; an
  image inserted right after it makes `marked` read the source as text.
  The read-back read such a token as its raw source, not its text as the
  viewer shows any token it has no rule for, so nothing caught it;
  `pushTokenReading` now reads it so, and `insertImage` tags its update
  with `RUN_EDGE_TAG` (now exported) so the block is tidied whole and
  shows the source as the text it saves as.
- **Restacked onto two source-mode fixes from round 2's leftovers
  (`markdown-source-mode-editing`, `markdown-source-mode-styled-spans`).**
  `imageSource` declines when either end of the selection sits inside an
  image or inside a link's syntax beyond its text; the token version here
  reads both from the analysis (`insideLinkSyntax`): strictly inside an
  `image`/`mdimage` token, or inside a `link` token outside its content —
  which also covers a reference link's label and an autolink, whose text is
  its destination (pinned with the regex version's cases plus those three).
  `resolvePieceAttributes` keeps a span attribute the dialect does not
  model, after the dialect's own keys; the rebase conflicted on its doc
  comment (resolved as the union: the serializer named as the pipeline, the
  kept attribute added), and this branch's "merges into a span whose group
  carries a newline" test now expects `foo=bar` kept. The docs conflict
  took this branch's rewritten source-mode paragraph and changelog entry,
  each with the kept-attribute sentence added.
- **Restacked onto the serializer's canonical mark placement
  (`markdown-editor-serializer`).** `flattenInline` conflicted: it now
  settles bold and italic on edge whitespace (`canonicalWhitespaceMarks`)
  after keeping kept-source and nested-link runs intact, and only for
  writing — the as-shown reading keeps each node's marks. The serializer
  test file conflicted where this branch drops the corpus comparison with
  the old exporter: dropped, with the serializer's new placement tests
  kept.
- **Stack fuzz round 3 (run at the stack's top after the fixes above).**
  - *An image inserted across a table's structure* (source mode; the
    regex version's fix is in `markdown-source-mode-editing`): the token
    version of `cutsTableStructure` reads the tables from the analysis's
    block tree, a table nested in a list item or quote included, its rows'
    outer pipes found past the container's indentation and `>`. The rebase
    conflicted on `imageSource`'s guard and `insertImage`'s doc comment;
    resolved as the union. So does `touchesFenceLine`: an image on a `:::`
    fence's own lines (its opening or closing `:::`, a `|||` separator) is
    declined, the lines read from the located `mdblock` blocks, a fence in a
    list item or quote included, and a fence-looking line inside a code
    block not counted.
  - *A task marker left alone in its item saved as a reference link.*
    Deleting a task item's text left its checkbox — a source run `[x] ` —
    alone on the item's first line, saved `- [x] `, which the viewer reads
    as no checkbox: `[x]` as text, or as a reference link where a
    definition names `x`, while the editor showed `[x]`. The serializer now
    writes a checkbox that is all its item's first line holds as the text
    it shows (`- \[x\]`; `loneTaskMarkerAsText`).
  - *A heading break the save writes as a space.* A level 1 or 2 heading
    keeps its line breaks only in its setext form, which a line the setext
    rule would not read as content rules out (Enter leaving a lone `<span>`
    after a break); the save is then ATX, its breaks spaces, while the
    editor still showed the break. The line-break rules now turn the breaks
    of any heading the save writes on one line into spaces
    (`$headingWritesOneLine`, exported by the serializer), not only those of
    a level 3–6 heading; Shift+Enter in a level 1 or 2 heading is still
    allowed, and a break the save cannot keep shows as its space at once.

### Stack fuzz round 4

A whole-stack fuzz at the stack's top (run and paste edits, seeds 601,
1709, 2207, 3313, 4409, 5521, 6607 and 7703, 3 000 documents per mode;
source mode, seeds 6719 and 7841, 4 000 per mode) left five signatures
owned here, each fixed with a test written red first:

- **A link nested in a link whose inner text escapes a bracket**
  (`x [[\[a \]b](/p)](/q)`) loaded as one kept source run with no link,
  where the viewer links `[a ]b`. `nestedLinkPieces` found the children's
  text in the outer `raw` only exactly, but `marked` drops a bracket's
  escape from link text; it now finds it as `keptPieces` does
  (`contentSpan`), the two sharing the re-slicing of each run's source
  (`withRawSources`), and the group's closing syntax is read from the same
  span.
- **An HTML block whose start tag ends its line** (`<details` then three
  newlines and `</details>`) showed as a paragraph and saved as
  `\<details`. `marked` spends the tag line's own newline on the start
  condition, so one blank line after it does not end the block — a second
  does, as it was loaded. The run-on probe now tells three endings apart
  (`rawBlockEnd`: `apart`, `wide`, `runsOn`); a `wide` block stays a raw
  block and writes the second blank line itself when a block follows it,
  so both read as the editor shows them. Only `runsOn` still writes the
  paragraph.
- **A kept construct split by a cell paragraph break.** Enter between the
  two code spans of `| __`` a ` x `` `` a ` y ``__ |` left a cell that does
  not read back: each code span holds a backtick, so `marked` hides the
  bold delimiters next to the break and pairs the outer ones, showing
  literal `**` around it. The rule that shows a run as its save reads did
  check the cell whole, but its rebuild kept the bold as one source run
  whose text held the break as literal `\n\n`, which never read back, so
  the repair was skipped. A construct kept as written in a table cell is
  now kept as one construct per cell paragraph, cut at each break the
  viewer splits the cell's text at (`splitAtCellBreaks`; a code run keeps
  its text whole); the cell then shows and saves what the viewer reads.
- **Two nested lists of one item, the first an empty item under text.**
  `keepNestedListsApart` compared the authored markers, not the ones
  written: a bare `-` under text is written `*`, so a second `-` list was
  "kept apart" with `*` and joined it. Markers now compare as written
  (`writtenListMarker`). A list of bare markers right under text reads as
  more lines of that text (a bare `-` after it is a setext underline), so
  the list after it counts as under text too (`ItemBlock.continuesText`)
  and is written with `+`.
- **A checkbox no longer at its item's start** (`- [x] done`, `}}` typed
  before it, a definition naming `x`) saved as `- }}[x] done`, which the
  viewer reads as a reference link. Any task-marker source run that is not
  its item's checkbox — anywhere but the start of the item's first line
  with text after it, including in other blocks — is written as the text
  it shows (`strayTaskMarkersAsText`, generalizing `loneTaskMarkerAsText`).

The round's new seeds then found three more, fixed the same way:

- **A link showing only whitespace at a block's edge lost its source on
  load** (`a [ ](u)`, `4\n*[  \n]()*`). The line-break rules unwrap a link
  holding no content at a block's edge, since the save trims its
  whitespace; at load that dropped the link's source. The importer now
  keeps such a link as one source node (`edgeLinks` finds the links with
  only whitespace before or after them, at any depth of emphasis or span;
  `showsOnlyWhitespace`), as it keeps `[](u)`. Mid-block, a whitespace
  link stays a link node, which the save writes.
- **A deletion inside a link left it holding only a soft break at the
  block's end** (`fo[o` + link over `\nbaz`, `baz` deleted): the deletion
  marks the link, not its block, so the line-break rules never ran and the
  editor kept a link the save does not write. They now also run on a
  changed `LinkNode`.
- **A declined format restored a list without a kept construct's image.**
  A selection from a list item into the paragraph after it covers the list
  node itself, so `$editWritably`'s decline restored the whole list from
  JSON; `MarkdownImageNode.importJSON` dropped the image's node state
  (fixed in `markdown-editor-serializer`), the kept construct it belonged
  to dissolved, and the link nested around it lost its destination. Pinned
  here with that scenario (red before the serializer plan's fix).

### Stack fuzz round 5

A whole-stack fuzz at the stack's top found two source-mode defects owned by
`markdown-source-mode-editing` and carried here into the token-based
commands, each fixed with tests written red first:

- **An image inserted on a code fence's line** — replacing the
  three-space indentation of a ```` ``` ```` line, or written anywhere on an
  opening or closing fence line — ended the code block or opened one
  elsewhere, so a definition or heading it held read as something else.
  `touchesFenceLine` now also counts each fenced code block's opening line
  and its closing line when it has one, at any depth (`codeFenceLineStarts`;
  the whole source line, a list item's indentation or a quote's `>`
  included), so `imageSource` declines there as on a `:::` line.
- **A toggle must actually toggle (user-approved design change).** A press
  on a range strictly inside a run of the same format declined, and one on
  text carrying the format twice removed only the innermost run
  (`__foo, __bar__ az__` bold over `bar`, `~[~zq0001~](…)~`), so the text
  stayed formatted and the press looked like it did nothing. The selection
  state already reported a format whenever a token of it holds the range;
  pressing it now removes the format from the whole range, as the WYSIWYG
  toggle does (`removeFormat`): the outermost covering token is rewritten
  with every token of the format inside it dropped, and the text that keeps
  the format is wrapped again, one run per maximal stretch at the shallowest
  level it can stand — inside a link or styled span the range reaches into,
  outside one it holds whole, with whitespace at a run's edges left outside
  (`__foo,__ bar __az__`, `[zq0001](…)`,
  `***[**a** r](/u) z***` → `*[a **r**](/u) **z***`). Each run is written
  with the outer token's own marker, else the canonical one, else the
  alternate (`__`, `_`, `~`); the first that reads back — the range's text
  without the format, whitespace at its edges either way, everything else
  as before (`verified`, which now accepts alternative formats per leaf) —
  is the edit. Inline code splits its code span the same way
  (`splitCodeSpan`), the taken-out code backslash-escaped when it would
  read as Markdown. Where no Markdown reads that way the press declines:
  `***[**zq0029**[r]](/u) zq0035***` cannot be written with `zq0029` plain,
  since a bold run cannot open between `9` and `[`.

The round's new run/paste seed (11003) then found two more, owned here and
fixed the same way:

- **A link whose own text beside the links nested in it is only
  whitespace, at a block's edge** (`[[a](/1)[b](/2)    ](/o)`), lost its
  syntax on an unedited load and save (`[a](/1)[b](/2)`): the link kept its
  link node, closed around the nested links and reopened for the
  whitespace, which the line-break rules then trimmed away with the outer
  link. Like a whitespace-only link there, it is now kept as its source —
  as the nested-link runs, so the nested links still show as links
  (`showsWhitespaceBesideLinks`) — when some of that whitespace is at the
  link's own start or end. Whitespace only between the nested links is not
  trimmed, and such a link keeps its link node: the rerun showed that
  routing it to the runs too merged an empty link beside the space into the
  space's run, so deleting the space dropped the empty link's destination
  (`[<https://a.test/x> [](https://e.test/y)](/o)`).
- **A row span left over a lower row's cell.** Pasting over a range from
  one table cell into a later row's cell removed that row's first cell, so
  a cell spanning down (`^^`) moved one column left onto the merged cell
  below it; the table held that position twice and the save wrote the span
  as an empty cell. `$alignCellsByColumn` now lays the cells out as the
  table map does and ends a span just above the first cell it would reach
  (`$keepRowSpansClear`), alongside its rule for a span past the last row.

### Toggle state over edge spaces

A user report, fixed with tests written red first:

- **A second toggle over edge spaces did nothing.** Bold over ` string, `
  (spaces selected) wrote `**string,**`, but the next press with the same
  selection bolded it again — a no-op once the edge spaces were trimmed —
  and only a third press took it off. Lexical toggles by the formats it
  caches on the selection, the intersection over every selected text node,
  so the plain edge spaces read the selection as not bold. The toggle, the
  toolbar and the context menu now read `$selectionHasFormat` instead: for
  bold, italic and strikethrough it splits the selected text into the
  stretches the run a press would make cannot end inside — one block, no
  line break, image or source-written run between, and no link or span
  edge where `runBreaksBetween` would end that run (the groups left
  uncovered computed as if the selection already carried the format, via
  `uncoveredGroups`, now shared with `$markRuns`) — leaves out whitespace
  at either end of each, and calls the format on when every other
  character carries it. That ignores whitespace at every place the run
  could end, and some where it would not (at a selection edge next to text
  carrying the format outside: `**a** **b**` with ` b` selected reads as
  bold, though putting bold on it would bold the space too). So on a
  selection holding text other than such whitespace, a press the writing
  rules do not decline always changes something: putting the format on
  lands on a character the trimming keeps it on, and taking it off has a
  character to take it from. A selection of such whitespace alone, a collapsed one, and
  code and underline (never trimmed) keep Lexical's reading.
  `$formatWritably` passes the reading to `$formatText` as the format to
  align to. A first review round found the stretches cut at every link or
  span edge, which read `**a** **[b](u)**` with `a b` selected as bold and
  unbolded it instead of joining the runs; they now follow the run rule.
- **Review fixes.** *A table selection is formatted cell by cell under the
  writing rules.* `$formatWritably` handed a table selection to Lexical's
  table plugin, whose own `FORMAT_TEXT_COMMAND` handler formats the cells
  with no check, so bold over selected cells could give
  `| **c <span>x</span> y** |`, which a range over the same text declines.
  It now takes the table selection itself (`$formatCellsWritably`): a cell
  that takes no format (round 2 below says which) is skipped, each other
  cell's content is selected in turn, and those are formatted through the same
  edit-check-restore as a range (`$editOrRestore`, `$editWritably` without the
  historic tag — the update is historic only when every cell taking the
  format was declined, so a press that formats some cells still undoes). The
  format comes off when the cells taking it have it on, else goes on; the
  cells stay selected. The plugin's handler never sees the command: its
  observer is registered when the view mounts, after the handler here, at the
  same priority (`registerWritableFormatCommand` documents that order). The
  observer needs a mounted table, so the headless tests pin the handler's own
  result (`markdown-importer.test.ts`, "#6 … under a table selection, cell by
  cell") and that the command is reported handled. *Refactors, no behaviour
  change:* this branch's registrations moved out of `ensureEditor` into
  `registerTextOnlyBlockRules` and `registerWritableFormatCommand`, in the
  order they were registered inline; `$orderedPoints(selection)` in
  `markdownWritable.ts` replaces the three inline
  `isBackward() ? [focus, anchor] : [anchor, focus]` pairs; and the command
  guards name a call's result before testing it (`touchesTextOnlyBlock`,
  `touchesTableCell`, `altHoldsBracket`) instead of calling inside the `if`.
  `$selectionTouchesTextOnlyBlock` and `$selectionTouchesTableCell` were one
  body written twice with a different predicate; both now call
  `$selectionTouches(isHolder)`.
  Run live as well (worktree dev server, **MD Editor** page, driven through
  chrome-devtools with the table observer mounted): Bold over the selected
  cells `c <span>x</span> y`, `d`, `e`, `f` was reported handled, left the
  first cell as it was, made the other three bold, and left the same four
  cells selected and highlighted.

- **Review fixes, round 2.** A second review read the fixes above; these are
  its findings against this branch, each pinned by a row written first and
  seen to fail (`markdown-importer.test.ts`, "#6 … under a table selection,
  cell by cell").
  - *Underline and inline code never came off selected cells.* Whether a
    press takes the format off was read per cell by `$selectionHasFormat`,
    which for the two formats that are never trimmed reads the formats
    Lexical caches on a selection — and the range made over a cell's content
    has none cached, so both always read as off and every press put them on
    again. `$cellsHaveFormat` now reads the cells' own text: the format is on
    when every character it counts on carries it (`$countedCarries`, the
    count `$selectionHasFormat` already made for bold, italic and
    strikethrough, with their edge whitespace left out) and there is one.
    Rows pin on-then-off, off from a freshly loaded table, and a cell with
    the format on part of its text only, for all five formats.
  - *A cell with no text kept a format on the others.* A cell was formatted
    when its content range was not collapsed and `declines` did not rule it
    out, so a cell holding an image alone counted, read as not bold, and bold
    could not be taken off `**d**` beside it. One rule now says which cells a
    format toggle formats: `$cellTakesFormat(cell: TableCellNode): boolean`
    in `MarkdownEditor.ts` — the cell holds a text node with text and none
    that `$isFormatBlockingSourceRun` matches (the per-node half of
    `$selectionCoversSourceRun`, pulled out of it). `$formatWritably` takes
    it as a third argument, `takesFormat`, and `$formatCellsWritably` filters
    the selected cells with it instead of asking `declines` cell by cell. It
    only reads, so the branch that reports which commands apply can ask the
    same question. A cell holding spaces alone takes a format but decides
    nothing about bold, italic or strikethrough, which never stay on spaces.
  - *The block conversions were not refused with whole cells selected.*
    `$selectionTouches` answered `false` for anything but a range selection,
    so `toggleUnorderedList` and `toggleOrderedList` dispatched Lexical's
    list command over the selected cells; the cell rule then turned the lists
    back into new paragraphs — the value unchanged, every cell's paragraph
    replaced, and an undo step that undid nothing. `$selectionTouchesTableCell`
    now answers `true` for a table selection, which is of whole cells, so
    the two toggles and `setBlockType` return before anything is dispatched:
    rows pin the value, the node keys, that no update ran, that the cells
    stay selected, and that one Undo still takes back the edit made before.
    It answers from the selection's kind and reads none of its nodes:
    `mergeTableCells()` leaves the table selection naming a cell that is gone
    until the selection next changes, and reading that point throws (a row
    runs the three commands after a merge).
  - *Named call results.* The note above said the command guards name a
    call's result before testing it, which the round's own
    `markdownWritable.ts` code did not: `$formatWritably` tested `declines()`
    and `$editOrRestore` tested `applies()` inside the `if`. Both are named
    first now (`declined`, `applied`), as is `selection.isCollapsed()` in
    `$selectionCoversSourceRun`.
  - *One search for a node's block.* "The nearest element that is not
    inline" was written out five times: as a loop in `$breakRuleContainerOf`
    and in `$selectedContainers`, and as a `$findMatchingParent` call in the
    run-edge rules' `tidy`, in `$deleteRangeFromTextOnlyBlock` and in
    `$classifyContextMenuTarget` (the last one `master`'s). All five now call
    `$findEnclosingBlock(node)`, exported from `markdownWritable.ts`. It
    never answers with the root, which every one of the five ruled out for
    itself. No behaviour change.
  - *Not changed here:* in WYSIWYG, `toggleUnorderedList` in a bulleted list
    (and `toggleOrderedList` in a numbered one) changes nothing, though the
    JSDoc and the docs table say "or out of one when already a list". That is
    `master`'s code and wording (the toggle dispatches Lexical's insert-list
    command, which does not remove a list of the same kind); this branch only
    added the table-cell guard in front of it, so it is left for its own
    change.

- **Review fixes, round 3.** A third review read round 2's fixes; these are
  its findings against this branch (rows in `markdown-importer.test.ts`,
  "#6 … under a table selection, cell by cell").
  - *A cell that declines underline kept it on the others.* The reading
    counted every cell `takesFormat` passes, including one whose format the
    writing rules then decline and restore (underline over `C++`, `a+b` or a
    lone `+`; a probe of 33 cell contents under all five formats found no
    other format declined over a whole cell). Such a cell reads as off for
    good, so with `Rust` in the cell below every press after the first was
    "put on" again: nothing changed, and the press added an undo step that
    undid nothing. Which cells take a format shows only once it is put on,
    so `$formatCellsWritably` reads each cell's counted characters first
    (`$countedCarries`), formats through `$formatCellsOrRestore`, which
    answers with the cells that were not declined, and — when the format was
    not on over all the cells but was on over the ones that took it — takes
    it off those. A declining cell is left as it is either way, like a cell
    `takesFormat` rules out. `cellsHaveFormat` (no `$` now: it reads no
    editor state) takes the per-cell flags. The update is historic as
    before: when cells were formatted and every one declined. Rows, written
    first and seen to fail:
    `C++` above `Rust`, `a+b` beside `d` and a lone `+` beside `d`, each
    pressed on, off, Undo, off again, Undo, Undo with the saved Markdown
    compared at every step; and all five formats over a cell a source run
    keeps out, a cell holding a `+` and a plain cell — on, off, Undo, Undo.
  - *Pinned: a cell with no text takes no format.* `holdsText` in
    `$cellTakesFormat` was held by no row here (the image-only row passes
    without it, since a cell with no text decides nothing about the
    reading). Two rows — an empty cell, and one holding an image alone,
    beside `a+b` under underline — fail without it: the press would count
    the textless cell as formatted, so it would not be historic, and Undo
    would not take back the edit made before.
  - *Pinned: underline and code count every selected character.* Two rows
    (underline, inline code) put a plain space after formatted text in a
    cell; the press puts the format on the space rather than taking it off
    the rest. Both fail when `$countedCarries` trims edge whitespace for
    them as it does for bold, italic and strikethrough.
  - *Named results.* The run-edge rules' `tidy` tested two type guards in
    one `if`; their result is named first (`isTextOnlyBlock`). So are three
    calls this branch's code left in `if` conditions in `MarkdownEditor.ts`:
    `$selectionCoversSourceRun()` in `patchSelectionStyle`
    (`coversSourceRun`), the two declining tests in `toggleLink`
    (`declined`) and `$selectionInNestedLinkRun()` in `removeLink`
    (`inNestedLinkRun`). No behaviour change.
