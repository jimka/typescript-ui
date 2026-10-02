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

### The harness projection learns list looseness

The harness's `editorSurfaceModel` hard-codes `loose: false` for editor lists.
It now reads `$getState(node, listLooseState)`, since the editor holds that
property for the first time. No other projection rule changes: a
`MarkdownSourceTextNode` is a text node, and a `MarkdownRawBlockNode` falls to
the existing "anything else → `raw`" row, which is exactly how the viewer's
text fallback projects.

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
