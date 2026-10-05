---
depends-on:
  - markdown-editor-marked-import
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/markdownImporter.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/editorNodes.ts
  - packages/lib/src/typescript/lib/component/display/markdownExtensions.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-roundtrip/viewModel.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/divergences.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/commonmark.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/referenceLinks.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/src/typescript/MarkdownEditorPanel.ts
---

# Markdown Editor Reference Links — Implementation Plan

## Overview

After plan 2 (`markdown-editor-marked-import`) the editor imports a reference
link — `[text][label]`, `[label][]` or `[label]` — as a plain `LinkNode`,
because `marked` has already resolved it to a URL, and saves it inline
(`[text](url)`). Its definition line (`[label]: url`) is a
`MarkdownRawBlockNode`, saved as written. Nothing is lost, but every save turns
reference links into inline ones.

This plan keeps them as written. A reference link becomes a
`ReferenceLinkNode` — the `LinkNode` subclass from the parked
`feature/markdown-link-reference-definitions` branch — that remembers its label
and form. It saves in its reference form while the saved document's definition
for its label still gives exactly its URL and title, and inline otherwise. **A
save never changes where a link points** (the user's decision on the parked
branch). Definitions stay raw blocks, saved verbatim.

The round-trip harness projection drops a raw block that holds only
definitions, as the viewer does, and the `referenceLinks` reason leaves the
catalogue (see *Harness baseline after this plan*).

---

## Architecture Decisions

### A reference link is a `LinkNode` subclass that remembers its form

`ReferenceLinkNode extends LinkNode` stores a `ReferenceLinkReference`: the
label exactly as authored, the form, the URL and title the definition gave at
load, and `importedContent` — the serializer's output for the link's children
at load. This is the parked branch's node, with `importedContent`
added.[^link-subclass] It stays a `LinkNode`, so selection state, **Edit link…**,
**Remove link**, `toggleLink` and `removeLink` treat it as any link.

### The form is read from the token's `raw` with `marked`'s own rules

A `link` token does not say which syntax produced it, but its `raw` does:

| `raw` | Form | Label |
|---|---|---|
| starts with `<` | autolink → `LinkNode` | — |
| does not start with `[` | bare URL → `LinkNode` | — |
| ends with `)` | inline → `LinkNode` | — |
| matches `Lexer.rules.inline.gfm.reflink` in full | `full` | group 2 |
| matches `Lexer.rules.inline.gfm.nolink` in full, ends with `[]` | `collapsed` | group 1 |
| matches `Lexer.rules.inline.gfm.nolink` in full | `shortcut` | group 1 |
| anything else | inline → `LinkNode` | — |

Using `marked`'s own `reflink` / `nolink` patterns keeps labels with escaped
brackets and code spans identical to the viewer's reading.[^raw-rules]

### The saved document's definitions decide the form, through the viewer's lexer

At save time the serializer collects every `MarkdownRawBlockNode` in document
order (top level and inside `:::` columns), joins their text with `"\n\n"`,
and lexes it with the new `lexMarkdownLinkDefinitions` — `marked`'s own
`links` map, first definition winning. Only raw blocks can hold definitions:
the serializer escapes `[` everywhere else, and a quote or list holding a
definition is itself a raw block.[^defs-from-raw] The collection is skipped
when the document has no `ReferenceLinkNode`.

| Label resolves to the node's URL and title? | Form | `$serializeLinkContent(node)` equals `importedContent`? | Written |
|---|---|---|---|
| yes | `shortcut` | yes | `[label]` — or `[label][]` when the next output character is `(` or `{`, where `[label]` would read as an inline link or a span |
| yes | `collapsed` | yes | `[label][]` |
| yes | `shortcut` or `collapsed` | no (text edited or formatted) | `[content][label]` |
| yes | `full` | either | `[content][label]` |
| no (**Edit link…** changed the URL; the definition was edited, removed, or resolves elsewhere) | any | either | `[content](url "title")` — the plain-link path |

`label` is always written exactly as authored.

Labels match as `marked` matches them: whitespace runs collapsed to one space,
then lowercased, no trim; the lookup uses `Object.hasOwn`.

### Definitions stay raw blocks; the harness hides the ones the viewer hides

No definitions node is added: plan 2 already keeps each `def` token (and any
dropped duplicate) as a `MarkdownRawBlockNode`, shown and editable as text.
The harness's `editorSurfaceModel` drops a raw block whose text lexes, through
`lexMarkdown`, to `def` and `space` tokens only — the viewer renders nothing
for exactly those.[^hide-defs]

---

## Public API

No barrel export changes.

```typescript
// component/editor/markdownReferenceLinkNode.ts
export type ReferenceLinkForm = "full" | "collapsed" | "shortcut";

export interface ReferenceLinkReference {
    label:           string;          // the bracket content naming the definition, exactly as authored
    form:            ReferenceLinkForm;
    definitionUrl:   string;          // the definition's href at load
    definitionTitle: string | null;   // the definition's title at load
    importedContent: string;          // $serializeLinkContent(node) right after import
}

export type SerializedReferenceLinkNode = Spread<{ reference: ReferenceLinkReference }, SerializedLinkNode>;

export class ReferenceLinkNode extends LinkNode {
    __reference: ReferenceLinkReference;
    constructor(url?: string, attributes?: LinkAttributes, reference?: ReferenceLinkReference, key?: NodeKey);
    static getType(): string;                                   // "reference-link"
    static clone(node: ReferenceLinkNode): ReferenceLinkNode;
    static importJSON(json: SerializedReferenceLinkNode): ReferenceLinkNode;
    afterCloneFrom(prevNode: this): void;
    exportJSON(): SerializedReferenceLinkNode;
    getReference(): ReferenceLinkReference;
    setImportedContent(content: string): this;                 // writable copy of the reference with the field set
    shouldMergeAdjacentLink(): boolean;                         // false, as AutoLinkNode
}
export function $createReferenceLinkNode(url: string, title: string | null, reference: ReferenceLinkReference): ReferenceLinkNode;
export function $isReferenceLinkNode(node: LexicalNode | null | undefined): node is ReferenceLinkNode;

// component/display/markdownExtensions.ts
export function lexMarkdownLinkDefinitions(source: string): Links;   // `Links` from "marked"

// component/editor/markdownSerializer.ts
export function $serializeLinkContent(link: LinkNode): string;
```

---

## Implementation

**`lexMarkdownLinkDefinitions`** — after `lexMarkdown`, exactly as on the
parked branch:

```typescript
export function lexMarkdownLinkDefinitions(source: string): Links {
    return _marked.lexer(source).links;
}
```

**Import** (`markdownImporter.ts`, the `link` row of the inline table): classify
`token.raw` per the form table. For a reference form, open
`$createReferenceLinkNode(href, title ?? null, { label, form, definitionUrl: href, definitionTitle: title ?? null, importedContent: "" })`
instead of `$createLinkNode`. At the end of `$importMarkdown`, after
`root.append(...)`, walk the document with `$dfs()` from `@lexical/utils` and
set every `ReferenceLinkNode`'s
`importedContent` with `node.setImportedContent($serializeLinkContent(node))` —
after, because the serializer needs the finished tree.

`$serializeLinkContent` always uses the plain paragraph context (not the table
cell or heading one), at load and at save alike, so a link inside a table cell
compares like any other.

**Serialize** (`markdownSerializer.ts`):

- `$serializeMarkdown()` first computes `definitions: Links | null` — `null`
  when the tree has no `ReferenceLinkNode`, else
  `lexMarkdownLinkDefinitions(rawBlockTexts.join("\n\n"))` — and passes it in
  `InlineContext` as a new field `definitions`.
- `$serializeLinkContent(link)` serializes the link's children as a group body
  (marks, styles and escaping as in any link) and returns it without the
  brackets.
- When a link group's link is a `ReferenceLinkNode` whose label resolves
  (`resolvesToNode(node, definitions)`), write the reference form per the
  table; otherwise the existing link path.

```typescript
/** Whether `definitions` resolves `node`'s label to exactly its current URL and title. */
function resolvesToNode(node: ReferenceLinkNode, definitions: Links | null): boolean {
    if (definitions === null) {
        return false;
    }

    const key = node.getReference().label.replace(/\s+/g, " ").toLowerCase();

    if (!Object.hasOwn(definitions, key)) {
        return false;
    }

    const definition = definitions[key]!;

    return definition.href === node.getURL() && (definition.title ?? null) === node.getTitle();
}
```

**Harness** (`viewModel.ts`): in `editorBlocks`, before the "anything else →
`raw`" row, skip a `MarkdownRawBlockNode` when
`lexMarkdown(node.getTextContent()).every((token) => token.type === "def" || token.type === "space")`.

---

## Ordered Implementation Steps

Paths are relative to `packages/lib/`.

1. **Tests first.** Create `tests/component/markdown-reference-links.test.ts`
   (setup as in `markdown-importer.test.ts`) with rows RL1–RL16. Run it — the
   reference-form rows fail.
2. **`src/typescript/lib/component/display/markdownExtensions.ts`** — add
   `lexMarkdownLinkDefinitions` and the `Links` type import.
3. **Create `src/typescript/lib/component/editor/markdownReferenceLinkNode.ts`**
   from the parked branch's `ReferenceLinkNode` (`git show
   feature/markdown-link-reference-definitions:packages/lib/src/typescript/lib/component/editor/markdownReferenceNodes.ts`),
   taking only `ReferenceLinkForm`, `ReferenceLinkReference`,
   `SerializedReferenceLinkNode`, the class, `$createReferenceLinkNode` and
   `$isReferenceLinkNode`. Drop `pointsAtDefinition` and the definitions-block
   node. Add `importedContent` and `setImportedContent`. Register the class in
   `EDITOR_NODES` (and its `@remarks`).
4. **Importer** — the classification and the post-build `importedContent` pass.
5. **Serializer** — `definitions` in `InlineContext`, `$serializeLinkContent`,
   `resolvesToNode`, the reference-form writer. Check: RL1–RL16 pass.
6. **Harness projection** — the `def`-only raw block rule in `viewModel.ts`,
   with a new projection row S9 in `markdown-view-model.test.ts`:
   `editorSurfaceModel` after `setValue('# H\n\n[x]: https://e.com')` is
   `[heading ['H']]`.
7. **Run the harness** and settle the baseline with plan 2's step-11 rules,
   against *Harness baseline after this plan*. Remove the step-12 case
   `duplicate definition kept`'s `known` entry.
8. **Existing tests** — in `tests/component/markdown-editor.test.ts`, add
   `ReferenceLinkNode` to the `editorNodes` registration block; in
   `tests/component/markdown-importer.test.ts`, change plan 2's round-trip row
   R8 to expect `[r][x]\n\n[x]: https://e.com`.
9. **Demo** — in `src/typescript/MarkdownEditorPanel.ts`'s `SAMPLE`, change
   `the [Markdown](https://commonmark.org) subset` to
   `the [Markdown][commonmark] subset`, and after the closing code fence append
   a blank line and the line `[commonmark]: https://commonmark.org`.
10. **Docs and changelog** per `## Documentation Impact`.
11. Run `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/editor/markdownReferenceLinkNode.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownImporter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorNodes.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` |
| Modify | `packages/lib/src/typescript/MarkdownEditorPanel.ts` |
| Create | `packages/lib/tests/component/markdown-reference-links.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/viewModel.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-view-model.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/divergences.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/commonmark.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/referenceLinks.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Reference links (`markdown-reference-links.test.ts`, unit)

Each row is `setValue(source)`, the stated edit, then `getValue()`.
"Unchanged" means `getValue()` equals the source.

| # | Source | Edit | `getValue()` |
|---|---|---|---|
| RL1 | `See [text][ref].\n\n[ref]: https://e.com "T"` | none | unchanged; the link is a `ReferenceLinkNode`, URL `https://e.com`, title `T`, form `full`, label `ref` |
| RL2 | `[ref] and [Ref][] and [ref][]\n\n[ref]: https://e.com` | none | unchanged; forms `shortcut`, `collapsed`, `collapsed`; labels `ref`, `Ref`, `ref` |
| RL3 | `[my_ref]\n\n[my_ref]: https://e.com/a_b` | none | unchanged (no escape in label or definition) |
| RL4 | RL1 | `toggleLink('https://new')` with the caret in the link | `See [text](https://new).\n\n[ref]: https://e.com "T"` |
| RL5 | RL1 | replace the definition block's text with `[ref]: https://other` | `See [text](https://e.com "T").\n\n[ref]: https://other` |
| RL6 | RL1 | remove the definition block | `See [text](https://e.com "T").` |
| RL7 | `[ref]\n\n[ref]: https://e.com` | append `x` to the link's text | `[refx][ref]\n\n[ref]: https://e.com` |
| RL8 | RL7's source | `toggleBold()` over the whole link text | `[**ref**][ref]\n\n[ref]: https://e.com` |
| RL9 | `[ref] (x)\n\n[ref]: https://e.com` | delete the space after the link | `[ref][](x)\n\n[ref]: https://e.com` |
| RL10 | `[a]\n\n[a]: https://one\n[a]: https://two` | none | unchanged (first definition wins; the reference keeps its form) |
| RL11 | `[constructor]\n\n[constructor]: https://c.com` | none | unchanged |
| RL12 | `see [x][toString]` | none | `see \[x\]\[toString\]` (undefined label: text in the viewer and the editor) |
| RL13 | `\| a \|\n\| --- \|\n\| [ref] \|\n\n[ref]: https://e.com` | none | unchanged; the cell holds a `ReferenceLinkNode` |
| RL14 | `> [q]: https://q.com\n\nSee [q].` | none | unchanged; the quote is a raw block, `[q]` a `ReferenceLinkNode` |
| RL15 | a `ReferenceLinkNode` (label `ref`, URL `https://e.com`) built in an empty document | none | `[ref](https://e.com)` |
| RL16 | `[a\_b] and [a&#35;b][]\n\n[a\_b]: https://e.com\n[a&#35;b]: https://f.com` | none | unchanged |

### Harness baseline after this plan (unit, the acceptance gate)

| Reason | After this plan |
|---|---|
| `referenceLinks` | leaves the catalogue: every top-level and `:::`-column definition is hidden, and every reference is a link in both views |
| `quoteBlocks` | also holds `definition in a blockquote`, `underscore definition in a blockquote`, `retargeted definition order` and CommonMark 218 (relabelled from `referenceLinks`: a quote holding a definition is a raw block; the viewer shows an empty quote) |
| `listItemBlocks` | also holds `definition in a list item` and `star definition in a list item` (relabelled from `referenceLinks`) |
| all others | unchanged from plan 2's table |

### Manual (MD Editor demo)

- **M1.** The sample's `the Markdown subset` text is a link in both the
  WYSIWYG surface and the live viewer; the `[commonmark]: …` line shows as a
  raw block in the editor and nothing in the viewer.
- **M2.** Right-click the link → **Edit link…** shows `https://commonmark.org`.
  Change it to `https://new.example`: the viewer's link follows, source mode
  shows `[Markdown](https://new.example)`, and the definition line is
  unchanged.
- **M3.** Reload the demo, then type `x` at the end of the link text: source
  mode shows the full form `[Markdownx][commonmark]`.

---

## Verification

- `npx vitest run tests/component/markdown-reference-links.test.ts tests/component/markdown-roundtrip`
  (from `packages/lib`).
- `npm run test`.
- From the repo root: `npm run typecheck`, `npm run lint`, `npm run docs:api`
  (zero warnings), `npm run docs:llms:check`.
- Manual M1–M3.

---

## Documentation Impact

- **`docs/components/MarkdownEditor.md`**: add **Reference link** to the lead
  paragraph's construct list and to **Supported constructs**:
  `[text][label]`, `[label][]`, `[label]` — kept as written while the label's
  definition gives the link's URL and title; written `[text](url)` once the link
  or its definition changes, so a save never changes where a link points.
  Definition lines show as raw blocks and are saved as written.
- **`docs/reference/changelog/next.md`** — append to **Added › Components**:
  ```markdown
  - **`MarkdownEditor` edits reference-style links.** `[text][label]`,
    `[label][]` and `[label]` show as links and save in the form they were
    written, and their definition lines save unchanged. A link whose URL is
    edited, or whose definition is edited or removed, saves inline with its
    own URL, so a save never changes where a link points.
  ```

---

## Potential Challenges

- **Definition lookup per save.** Lexing the raw blocks costs one small lex per
  `getValue()`, which runs on every editor update; it is skipped when the
  document has no reference link. The parked branch measured a comparable
  per-save scan at about 2 ms for 300 references.
- **A link split by a nested link** (`[see [x](u) y][ref]`) becomes two
  `ReferenceLinkNode`s around a plain link; each writes the full form. Only the
  full form can contain a link, so a shortcut is never split.
- **The parked branch's other modules** (`markdownReferenceTransformers.ts`,
  `MarkdownLinkDefinitionsNode`, `withLinkDefinitions`, the held-label
  escaping) are not ported: each worked around Lexical's line importer or its
  escaping, both gone after plan 2.

---

## Critical Files

- `git show feature/markdown-link-reference-definitions:packages/lib/src/typescript/lib/component/editor/markdownReferenceNodes.ts` — the node ported.
- `git show feature/markdown-link-reference-definitions:plans/in-progress/markdown-link-reference-definitions.md` — its *Implementation Notes*: the user decisions (never retarget; definitions verbatim) and the audit findings the RL rows cover.
- `node_modules/@lexical/link/dist/LexicalLink.dev.mjs` — `AutoLinkNode`, the `LinkNode`-subclass precedent.
- `node_modules/marked/lib/marked.esm.js` — `Lexer.rules.inline.gfm.reflink` / `nolink`, the `def` tokenizer's label normalization.
- `component/editor/markdownImporter.ts`, `markdownSerializer.ts`, `markdownSourceNodes.ts` (plans 1–2).

---

## Non-Goals

- **Re-pointing references when a definition is edited.** By the user's
  decision, a reference whose definition changes saves inline with its old
  URL.
- **A dedicated definitions node or hiding definitions in the WYSIWYG
  surface.** They stay visible raw blocks the user can edit.
- **Reference-style images** (`![alt][ref]`). The viewer shows only their alt
  text; plan 2 keeps them as source runs.

---

## Notes

[^link-subclass]: `@lexical/link`'s `AutoLinkNode` extends `LinkNode` with one
    field, `afterCloneFrom`, `exportJSON` and
    `shouldMergeAdjacentLink() { return false; }`; the parked node has that
    shape and was prototyped and reviewed there. `importedContent` replaces the
    parked branch's "link text unchanged" test, which compared against
    Lexical's escaping of the label and failed for labels holding `\_` or
    `&#35;` until three audit rounds patched it. Comparing the serializer's
    own output now with its output at load needs no knowledge of escaping.

[^raw-rules]: Splitting `raw` by hand (`lastIndexOf("[")`) breaks on a label
    holding an escaped bracket (`[foo\]bar]`), one of the parked branch's
    audit findings. `reflink` and `nolink` are the exact patterns `marked`
    matched to produce the token.

[^defs-from-raw]: Lexing the whole saved document twice (write, lex, rewrite
    the references that do not resolve) was considered; it gives the same
    answer because definitions can only come from raw blocks, at the cost of a
    full lex. A raw block lexes the same alone as in the document: blocks are
    separated by blank lines, and a definition inside a quote, list or `:::`
    column still enters `marked`'s global `links` map. Ignoring paragraph text
    is safe because a definition cannot interrupt a paragraph and the
    serializer escapes the `[` of any `[x]: …` text a user types.

[^hide-defs]: A `kind` field on the raw block was considered. Deciding by
    lexing the block's current text is simpler and follows edits: a definition
    the user rewrites into prose stops being hidden, exactly as the viewer
    starts rendering it.

---

## Implementation Notes

- **A run of definitions is one raw block (plan flaw; changes plan 2's
  I18).** RL10 and RL16 expect `[a]: …\n[a]: …` and `[a\_b]: …\n[a&#35;b]: …`
  to save unchanged, but plan 2 builds one raw block per `def` token (and per
  dropped duplicate), and blocks are written a blank line apart. The importer
  now joins each run of definition-only entries on consecutive lines
  (`joinDefinitionRuns`: a `def` token, or a gap that lexes to definitions
  alone) into one raw block of their source, so definitions round-trip
  verbatim. Definitions a blank line separates stay separate blocks. The I18
  rows in `markdown-importer.test.ts` now expect one block per run, plus a
  new row for definitions kept apart.
- **RL4 keeps the title.** `toggleLink` updates a link's URL in place and
  keeps its title, as it does for every link, so RL4 saves
  `See [text](https://new "T").`, not the plan's `See [text](https://new).`.
  The inline form writes the link's current URL and title, as the user's
  decision says.
- **RL8 writes `**[ref][ref]**`, not `[**ref**][ref]` (design choice).** The
  full form goes through the writer's link-group path, which writes the marks
  every character of a link carries outside its brackets, as it does for
  every link (`**[x](u)**`). Writing them inside would make a full reference
  save differently from an inline link with the same content, and would
  rewrite `**[text][ref]**` as `[**text**][ref]` on every save. The test also
  checks that both read the same in the viewer. `$serializeLinkContent` keeps
  the marks inside the brackets, so formatting the text is still noticed.
- **A label's own emphasis is not repeated around it.** A shortcut or
  collapsed reference writes the marks all of its text carries outside its
  brackets, as any link does (`A **[ref]**` stays as written), except a mark
  the label itself wraps all of its text in, read by lexing the label with
  the viewer's inline lexer (the new `lexMarkdownInline` beside
  `lexMarkdown`): that mark stays open only when it already is. So
  `[*foo*][]`, `[_foo_]`, `[__foo__]`, `[~foo~]` and `**[*foo*][]**` save as
  written. A label emphasised only in part (`[*foo* bar][]`) needs nothing.
- **More characters make a shortcut collapsed (plan gap).** Beside `(` and
  `{`, a shortcut is written `[label][]` before a `[` (a following link, style
  group or reference would make `[label][x]` a full reference) and, on the
  first line a block writes, before a `:` (`[label]: x` would load as a
  definition). The decision is taken where a line is rendered
  (`joinsShortcut`), when the next character is known, through a new
  `reference` piece kind. The `(` / `{` escape after a `]` is not applied
  after a reference piece, whose `]` opens nothing, so RL9 saves
  `[ref][](x)` as the plan says rather than `[ref][]\(x)`.
- **An empty definition title is no title.** `marked` gives a reference link
  `title: e.title || null`, so `resolvesToNode` compares titles with `""`
  read as none; with `?? null`, `[x]: /u ""` made `[x]` save inline.
- **Labels in single-line contexts and cells.** A label is written as
  authored, except that in a heading or table cell its line breaks become
  spaces (it still matches the same definition) and in a cell its `|` is
  escaped, as the table extension unescapes it before the inline lexer reads
  it.
- **`$collectDefinitions` walks fences through their columns** generically
  (a `:::` fence or column node recurses into its children), which also
  covers a fence written without columns.
- **Harness baseline.** Before: 91 known entries (`referenceLinks` 66 surface
  + 2 parity, `quoteBlocks` 12, `listItemBlocks` 5, `taskListMarker` 3,
  `listMarkers` 2, `plainImage` 1). After: 29 (`quoteBlocks` 16,
  `listItemBlocks` 7, `taskListMarker` 3, `listMarkers` 2, `plainImage` 1).
  Exactly the predicted 62 entries flipped (60 surface, the 2 parity entries
  of CommonMark 214 and `reference in a heading`); the six cases the plan
  names were relabelled, each failing only on the quote or list raw block
  (the viewer shows an empty quote or item). `referenceLinks` left
  `DIVERGENCES`; the `quoteBlocks` and `listItemBlocks` reasons now say that
  a definition inside one counts and that the viewer shows it empty.
- **Manual M1–M3** were run in the MD Editor demo (`vite`, Chrome): M1 — the
  link is a link in both views, the definition is one monospace raw block in
  the editor and absent from the viewer. M2 — **Edit link…** showed
  `https://commonmark.org`; changing it to `https://new.example` moved both
  views' link, source mode showed `[Markdown](https://new.example)`, and the
  definition line was unchanged. M3 — the sample's reference is in the full
  form already; typing inside its text saved `[Markydown][commonmark]`, while
  typing at its very end lands after the link (Lexical's link boundary), so
  the plan's `[Markdownx][commonmark]` is not what the end of the text gives:
  it saved `[Markdown][commonmark]x`. No console errors.
- **Performance.** `getValue()` on 300 paragraphs holding 600 references
  plus 300 definitions took about 4.7 ms against 3.2 ms for the same
  document with inline links.
- **Observed, out of scope (fixed since, below):** a link with empty text — inline `[](u)` or
  reference `[][ref]` — produces no link node, so its source is dropped on
  save (the viewer renders nothing for it). This is plan 2's importer, for
  both forms; keeping it needs an invisible source node, a decision for a
  later plan.
- **Restacked onto the marked-import review fixes (round 2).** That plan
  keeps a link with no text of its own outside nested links as one source
  run of its `raw`, before this plan reads a reference from it, so an empty
  reference (`a [][ref] b`) saves whole rather than losing its label; a
  test here pins it. Its new `$serializeBlock` (a paragraph joined to a raw
  block) and run-on raw-block check now take the document's definitions,
  as every other block serializer here does.

## Whole-stack review fixes

- **Loading a run of consecutive definitions was quadratic (B7).**
  `joinDefinitionRuns` re-lexed the growing joined run for every definition
  it added (`holdsOnlyDefinitions(last)`), so 2000 definitions on
  consecutive lines took about 1.9 s to load against 145 ms with blank lines
  between. Each entry is now tested once, as it is met, and a joined run
  counts as definitions without a second lex: the next entry opens with `[`,
  and only a title (opening with a quote or parenthesis) continues a
  definition onto the next line. 2000 definitions now load in about 27 ms. A
  test counts the characters a load lexes (a spy on `lexMarkdown`) and fails
  on the quadratic version (2.8 M characters lexed for a 14 k source).
- **`shouldMergeAdjacentLink` removed (deviation from the Public API).** The
  plan gave `ReferenceLinkNode` `AutoLinkNode`'s `false` override, but the
  only caller is `@lexical/link`'s `$linkNodeTransform`, which the editor
  never registers (no `registerLink` / `LinkExtension`), so the override was
  inert and its JSDoc promised behaviour nothing provided. Two neighbouring
  references already load as two links, built one per token.

## Stack fuzz round

The marked-import plan's stack fuzz round (an inline construct the
standard form would write differently is kept as written, decided there)
needs this plan's definitions wherever it reads a standard form:

- **`$readStandardForm` takes the document's definitions.** The importer
  sets them for the load (`IMPORT_DEFINITIONS`, set and cleared by
  `$importMarkdown`) and reads each block through `$readKeepingForm`,
  which also records each reference link's loaded text first, as the load
  does at its end — so a reference link is not kept as source just because
  a read without definitions shows it as text.
- **A raw block that reads as several blocks** (`$readRawBlockAsBlocks`)
  joins definition runs as a load does, so a run of definitions stays one
  raw block.

## Definition-change fuzz round

The stack fuzz (seeds 601, 1709 and 2207, 3 000 documents each, two edits
per document) found the editor and the viewer apart after an edit that
changed the document's definitions — about 930 parity and 33 dropped-word
failures over three seeds — and bracket text in a link's text read as a
reference. The user's rule: what the editor shows is what is saved and what
the viewer renders, a save never changes where a link points, and no source
is dropped.

- **What a definition can change.** Text escapes its brackets, so it never
  becomes a link; a `ReferenceLinkNode` keeps its own URL and saves inline
  once its label no longer resolves to it (RL5, RL6). Only source kept as
  written depends on the definitions: a run whose source holds a `[` — an
  empty reference (`[][ref]`), a reference image (`![alt][ref]`, the viewer
  shows its alt text), a reference inside a construct kept as written —
  shows what its source read as at load, while the save writes the source
  unchanged.
- **The definition rule (`registerDefinitionRules`, a root transform in
  `markdownWritable.ts`).** Each update compares the raw blocks' text
  (`$definitionsSource`, the text `$collectDefinitions` lexes) with the text
  of the state it started from, which an update listener carries from one
  committed state to the next (read off the state itself after an update
  that only moved the selection, or an undo or redo). Only when the text
  changed are the definitions lexed (one lex per change, the previous one
  memoised), and only when a label resolves differently is any block looked
  at: a top-level block whose source runs, joined, name a changed label in
  brackets is serialized, and when its save shows differently under the new
  definitions than under the old (`shownReading`: its tokens, `raw` kept,
  except that a link with no content and a reference image drop where they
  point, which the viewer does not show), it is replaced by the blocks a
  load builds from that save under the new definitions
  (`$readBlocksWithDefinitions`, through the new
  `lexMarkdownWithDefinitions`, moved down from the source-preservation
  plan). The block then shows what a save and a reload would show. A caret
  in it keeps its offset in the block's text. A load and an undo or redo
  bring back a state that shows its own definitions, so they are not
  checked.
- **Behaviour decided.** A kept reference whose label stops resolving shows
  as its text and from then on is text: re-typing the label does not make it
  a reference again, as text never becomes one (the user's preference for
  escaping over turning text into a link). A reference link in a block shown
  anew is rebuilt from its save, so one that no longer resolves becomes an
  inline link with its own URL. A block whose save shows the same under both
  definition sets keeps its nodes.
- **Bracket text in a link's text (serializer).** `marked` unescapes the
  brackets of link text before reading it, so `[\[x\]\[r\]](u)` read
  `[x][r]` as a reference wherever `r` was defined. Each bracket pair in a
  link's text that holds no other bracket is now written `\\[` … `\\]`
  (`protectLabelBrackets`), which the unescape turns into `\[` … `\]`; to
  `marked`'s link pattern those brackets are a bracket pair, which link text
  may hold one level deep, so a pair holding a pair keeps single escapes
  (it reads as a reference only to a label holding escaped brackets), a
  bracket without a partner keeps its own, and a link whose syntax or source
  holds a bracket is left as it was. Two serializer tests now expect the
  doubled escapes. The fix lives here rather than in the serializer plan:
  before this plan a save kept no definitions for a label to resolve to.
- **Cost.** On 300 paragraphs each holding `[][r]` and `![i][r]`, typing in
  a paragraph or in the definition without changing it costs what it did
  (about 7 ms per update, within noise); changing the definition's URL, which
  every block names, costs about 140 ms per keystroke (300 blocks serialized
  and lexed twice; none is rebuilt, since neither form shows where it
  points). Without kept references the rule costs nothing measurable.
- **Tests.** DEF1–DEF14 in `markdown-reference-links.test.ts` (removed,
  edited, added, typed and pasted definitions; definitions in a quote, a list
  item and a `:::` fence; undo; blocks left as they are), and twelve cases of
  bracket text in a link's text.

## Stack fuzz round 2

A fifth whole-stack fuzz, at the stack's top with the harness cleaned of its
own artifacts, on the same rule, found these, each fixed here and pinned by
a test in `markdown-reference-links.test.ts`:

- **A blank line in a reference's title (decision: keep the reference
  form, take the definition's title).** An inline link cannot write a title
  holding a blank line (it ends the block), so a reference whose title holds
  one fell back to an inline form that the viewer read as text once its
  definition's title was edited. `resolvesToNode` now keeps the reference
  form while the definition resolves the label to the link's URL, whatever
  title it gives; the definition rule gives the node that title
  (`$adoptDefinitionTitles`), so the editor shows what the save reads. A
  link whose URL no longer resolves still falls back inline, its title's
  blank lines written as one line break (the serializer plan's fix).
- **A shortcut reference opening a list item's text.** `- [x] y` reads as a
  task item; such a reference (`[ ]`, `[x]`, `[X]` before whitespace) is
  written `[x][]` (`joinsShortcut`, which also guards a shortcut reference
  kept as source, the marked-import plan's fix).
- **A definition in a list item.** A paste can put a definition's raw block
  in a list item, where `marked` reads it; `rawBlockTexts` now looks in
  lists and items, so a link it would re-point is written inline.
- **A link nested in a link closed by a reference.** A nested-link group
  written `[[a](/in)][label]` reads as whole links only with the label's
  definition; `formsWholeLinks` now tries the document's definitions, so the
  group is not rewritten and its empty inner links kept.
- **Runs read back with the definitions.** The marked-import plan's
  last-resort rebuild of a run that does not read back (`$showRunsAsSaved`)
  reads with the document's definitions (`readBackTokens` lexing with them,
  as the source-preservation plan later does for every read-back), so a
  reference kept as source is not rebuilt as text; after a definition
  change, a block holding a reference link is checked too.
- **Restacked onto the serializer's canonical mark placement
  (`markdown-editor-serializer`).** `writeGroup` conflicted between this
  branch's reference-link branch and the serializer's rule that a marked
  bare autolink is not written bare under a marks-inside-groups policy;
  resolved as the union: a style group and a resolving reference link are
  written first, as here, then the bare-autolink rule applies to the link.
- **Restacked onto round 3's importer fixes (`markdown-editor-marked-import`).**
  The serializer conflicted where this branch moves `AFTER_SHORTCUT_GUARDED`
  beside the reference-link constants: resolved with it there and the new
  `TASK_MARKER_SOURCE` beside `TASK_CHECKBOX_SHORTCUT`. `markdownWritable.ts`
  conflicted on its serializer import list: the union
  (`$headingWritesOneLine` with this branch's `$definitionsSource` and
  `$serializeBlock`).

## Stack fuzz round 4

No case of this round belongs here. **Restacked onto the importer
branch's round 4 fixes (`markdown-editor-marked-import`).** The serializer
conflicted where this branch threads the document's definitions through
the block serializers: `serializeRawBlock` and `$rawBlockWritesAsParagraph`
(now reading the importer branch's `rawBlockEnd` and the new
`$writesBlockAfter`, which takes the definitions too) and
`appendItemBlocks`' nested-list branch (the list's Markdown written once
with the definitions, its marker read from that Markdown); resolved as the
union.

**Review fixes.** The combined plan `plans/markdown-link-reference-definitions.md`
is retired — this branch removes it. Its viewer half was replaced by
`markdown-viewer-link-reference-definitions` and its editor half by this plan.
Round 2 moved the removal into the commit holding these notes, so the plan's
move to `plans/implemented/` is a pure rename again.
