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
