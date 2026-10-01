---
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# Markdown Link Reference Definitions — Implementation Plan

## Overview

A *link reference definition* is a line such as `[0.4.0]: https://…/v0.4.0`.
It gives a URL to a *reference link* written elsewhere as `[text][label]`
(full form), `[label][]` (collapsed form) or `[label]` (shortcut form). The
definition itself is invisible in any CommonMark renderer.

The `Markdown` viewer gets this half right. `marked` resolves every reference
link into an ordinary `link` token, but the definition's own `def` token has no
case in
[`Markdown.appendBlockToken`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1637),
so it falls to the `default:` branch and prints as literal text. SQLAdmin hit
this on the trailing definition block of its `CHANGELOG.md`. A second viewer
gap: a reference link inside a table cell does not resolve when its definition
comes after the table, because
[`markdownTableExtension.ts`](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L210)
lexes cell text before the definitions below it have been read.

`MarkdownEditor` has the other half of the gap. Its WYSIWYG surface shows
`[text][ref]` as literal bracket text and each definition as a plain paragraph,
and on save it backslash-escapes `_`, `*`, `` ` ``, `~` and `\` in both — so
`[my_ref]: https://e.com/a_b` is rewritten as `[my\_ref]: https://e.com/a\_b`.
The viewer and editor must support the same Markdown subset, so this plan fixes
both sides. The viewer stops printing definitions and resolves references in
table cells. The editor shows reference links as real links and keeps both the
reference form and the definition lines exactly as authored. Source mode
already keeps raw text unchanged and needs no work. Ships in 0.11.0.

---

## Architecture Decisions

### Viewer: skip `def` tokens like `space` tokens

`appendBlockToken` gets `case "def": break;` next to the existing
`case "space": break;`.[^def-skip] Every nesting level goes through
`appendBlockToken` (blockquote, loose list item, `:::` column), so the one case
covers definitions at any depth.

### Viewer: table cells lex through `marked`'s inline queue

The two `this.lexer.inlineTokens(text)` calls in `TABLE_EXTENSION` become
`this.lexer.inline(text)`. `marked`'s own built-in table tokenizer does
exactly this.[^inline-queue] The inline pass then runs after the whole
document's definitions are known, as it already does for paragraphs and
headings.

### Editor: resolve references with the viewer's own lexer

When the editor loads Markdown, it collects the document's definitions by
lexing it through the viewer's scoped `marked` instance — the new
`lexMarkdownLinkDefinitions(source)` in `markdownExtensions.ts`, which returns
`marked`'s `links` map.[^same-resolver] Labels are then matched by the same
normalisation `marked` uses: collapse each whitespace run to one space, then
lowercase, **no trim**.

### Editor: definitions reach the transformer through a scoped module variable

A Lexical text-match transformer's `replace` gets only the text node and the
match, never the document. So `markdownReferenceTransformers.ts` holds a
module-level `_activeDefinitions` that a new wrapper,
`$convertFromDialectMarkdown(markdown)`, sets around the synchronous
`$convertFromMarkdownString` call and restores in `finally`.[^scoped-state]
Nested conversions — table cells and `:::` columns, which the `TABLE` and
`BLOCK` transformers convert with their own `$convertFromMarkdownString`
calls — run inside that scope and see the same definitions. With no active
definitions, nothing is ever matched and references stay literal text. That
covers typing, paste, and any direct `$convertFromMarkdownString` call.

### Editor: a reference link is a `LinkNode` subclass that remembers its form

`ReferenceLinkNode extends LinkNode` and stores the authored label, the form
(`"full" | "collapsed" | "shortcut"`), and the URL and title it resolved to at
load time. This mirrors `@lexical/link`'s own `AutoLinkNode`, a `LinkNode`
subclass with one extra field.[^link-subclass] It stays a `LinkNode`, so
selection state (`linkUrl`), the context menu's **Edit link…** / **Remove
link**, and `toggleLink` / `removeLink` all work on it unchanged.

Export writes the reference form while the link still points at its
definition, and the inline form once the user has changed its URL:

| Situation | Exported |
|---|---|
| URL and title unchanged, full form | `[text][label]` |
| URL and title unchanged, shortcut/collapsed form, link text unchanged | `[label]` / `[label][]` — the label written exactly as authored |
| URL and title unchanged, shortcut/collapsed form, link text edited or formatted | `[text][label]` |
| URL or title changed (e.g. **Edit link…**) | `[text](url "title")` — `LINK`'s own inline form |

The "link text unchanged" test compares the exported link text with the label
after Lexical's plain-text escaping.[^text-unchanged] If the two ever differ
unexpectedly, the full form is written, and that still resolves.

### Editor: a run of definition lines is its own block node, exported verbatim

`MarkdownLinkDefinitionsNode extends ElementNode` holds one run of consecutive
definition lines as plain `TextNode`s separated by `LineBreakNode`s. Its
exporter writes `getTextContent()` unchanged, with no escaping.[^verbatim-defs]
It extends `ElementNode`, not `ParagraphNode`, because Lexical's import merges
a following text line into a preceding paragraph.[^not-paragraph] Its
`createDOM` mints a `<p>` through `DOM.sink.createViewElement`, the same seam
`MarkdownColumnNode` uses. Enter at the end starts a plain paragraph after it.

The `LINK_DEFINITIONS` multiline-element transformer creates the node. It uses
`marked`'s own definition regex (`Lexer.rules.block.gfm.def`) to decide how
many lines are definitions, so the editor and the viewer agree on what a
definition is. It follows the `handleImportAfterStartMatch` +
`replace: () => false` shape of
[`createBlockTransformer`](packages/lib/src/typescript/lib/component/editor/markdownBlockTransformer.ts#L45).

The transformer starts a run only on a line that follows a blank line (or starts the document), outside a table cell, and keeps only the lines `marked`'s rule accepts:

| Input (`lines`, start at the `[` line) | Result | Why |
|---|---|---|
| `""`, `[a]: https://a`, `[b]: https://b` | one node, 2 lines | blank line before, both lines match `def` |
| `para`, `[a]: https://a` | declined → stays in the paragraph | a definition cannot interrupt a paragraph |
| `[x]:`, `  https://e.com`, `  "T"`, `after` | one node, 3 lines; `after` becomes a paragraph | `def` spans the title line, stops at `after` |
| table cell text `[a]: https://a` | declined → cell text | table cells hold inline content only |
| `[a]: https://a "t" junk` | declined | `def` rule does not match (trailing text) |

### Editor: transformer order

`LINK_DEFINITIONS` goes after `TABLE`. `REFERENCE_LINK` goes directly
**before** `LINK`.[^order] Lexical exports a node through the first text-match
transformer whose `export` returns non-null, and `LINK` would otherwise claim
every `ReferenceLinkNode` (it is a `LinkNode`). On import, a tie at the same
start position also goes to the earlier transformer. So `REFERENCE_LINK`'s
matcher refuses a shortcut that `LINK` or `STYLED_TEXT` owns (see the next
decision).

### Editor: the import pattern only ever matches resolvable references

`REFERENCE_LINK.importRegExp` is an instance of a `RegExp` subclass,
`ResolvedReferencePattern`, whose `[Symbol.match]` walks the candidates in the
text and returns the first one that resolves.[^symbol-match] It never returns
a match that `replace` would have to refuse:

| Text (definitions: `ref`, `a`) | First match returned | Why the others are skipped |
|---|---|---|
| `see [nope] and [ref]` | `[ref]` | `nope` is undefined |
| `[a][nope] [ref]` | `[ref]` | full form with undefined label; the scan restarts one character in, and `[nope]` is undefined too — same result as `marked` |
| `![alt][ref] [a]` | `[a]` | `![alt][ref]` is an image reference (not in the dialect); the whole of it is skipped, so its own `[ref]` is not picked up |
| `\[ref] [a]` | `[a]` | escaped bracket |
| `[ref](https://x) [ref]{color=red} [a]` | `[a]` | a shortcut followed by `(` or `{` belongs to `LINK` / `STYLED_TEXT` |
| `[Ref]`, `[REF][]`, `[x][ ref ]` | `[Ref]`, `[REF][]`, none | case-insensitive; no trim, as in `marked` |

The transformer has no `trigger`. Typing never converts a reference, the same
as `STYLED_TEXT` and `IMAGE`. A reference typed in WYSIWYG stays text, is
saved verbatim, and becomes a link on the next load.

---

## Public API

No exported symbol changes; every new symbol is module-internal to
`component/display` or `component/editor`. The internal surfaces:

```ts
// component/display/markdownExtensions.ts
export function lexMarkdownLinkDefinitions(source: string): Links;   // Links from "marked"

// component/editor/markdownReferenceNodes.ts
export type ReferenceLinkForm = "full" | "collapsed" | "shortcut";

export interface ReferenceLinkReference {
    label:           string;          // the bracket content exactly as authored
    form:            ReferenceLinkForm;
    definitionUrl:   string;          // the definition's href at load time
    definitionTitle: string | null;   // the definition's title at load time
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
    pointsAtDefinition(): boolean;    // getURL() === definitionUrl && getTitle() === definitionTitle
    shouldMergeAdjacentLink(): boolean;   // false, as AutoLinkNode
}
export function $createReferenceLinkNode(url: string, title: string | null, reference: ReferenceLinkReference): ReferenceLinkNode;
export function $isReferenceLinkNode(node: LexicalNode | null | undefined): node is ReferenceLinkNode;

export class MarkdownLinkDefinitionsNode extends ElementNode {
    static getType(): string;                                   // "markdown-link-definitions"
    static clone(node: MarkdownLinkDefinitionsNode): MarkdownLinkDefinitionsNode;
    static importJSON(): MarkdownLinkDefinitionsNode;
    exportJSON(): SerializedElementNode;
    createDOM(config: EditorConfig);                            // <p> via DOM.sink.createViewElement
    updateDOM(): boolean;                                       // false
    insertNewAfter(selection: RangeSelection, restoreSelection?: boolean): ParagraphNode;
    collapseAtStart(): boolean;
}
export function $createMarkdownLinkDefinitionsNode(): MarkdownLinkDefinitionsNode;
export function $isMarkdownLinkDefinitionsNode(node: LexicalNode | null | undefined): node is MarkdownLinkDefinitionsNode;

// component/editor/markdownReferenceTransformers.ts
export function withLinkDefinitions(definitions: Links, convert: () => void): void;
export const REFERENCE_LINK: TextMatchTransformer;
export const LINK_DEFINITIONS: MultilineElementTransformer;

// component/editor/markdownTransformers.ts
export function $convertFromDialectMarkdown(markdown: string): void;
```

Both nodes use the codebase's static `getType` / `clone` / `importJSON` style
(as `MarkdownColumnNode` and `MarkdownImageNode` do). `createDOM` carries no
return annotation, as in `MarkdownColumnNode`, so no DOM type is named.

---

## Implementation

**`lexMarkdownLinkDefinitions`** (`markdownExtensions.ts`, after `lexMarkdown`):

```ts
export function lexMarkdownLinkDefinitions(source: string): Links {
    return _marked.lexer(source).links;
}
```

**Scoped definitions and the pattern** (`markdownReferenceTransformers.ts`):

```ts
/** The definitions of the conversion in progress; `null` outside `withLinkDefinitions`. */
let _activeDefinitions: Links | null = null;

export function withLinkDefinitions(definitions: Links, convert: () => void): void {
    const previous = _activeDefinitions;

    _activeDefinitions = definitions;

    try {
        convert();
    } finally {
        _activeDefinitions = previous;
    }
}

/** `marked`'s label normalisation: collapse whitespace runs, lowercase, no trim. */
function normalizeReferenceLabel(label: string): string {
    return label.replace(/\s+/g, " ").toLowerCase();
}

/** Group 1/2: full or collapsed `[text][label]` (group 2 empty = collapsed). Group 3: shortcut `[label]`. */
const REFERENCE_CANDIDATE = /\[((?:\\.|[^[\]\\])*)\]\[((?:\\.|[^[\]\\])*)\]|\[((?:\\.|[^[\]\\])+)\]/;

class ResolvedReferencePattern extends RegExp {
    constructor() {
        super(REFERENCE_CANDIDATE.source, "g");
    }

    [Symbol.match](text: string): RegExpMatchArray | null {
        const definitions = _activeDefinitions;

        if (definitions === null) {
            return null;
        }

        this.lastIndex = 0;

        let match: RegExpExecArray | null;

        while ((match = this.exec(text)) !== null) {
            // `![…]…` is an image reference: skip all of it (exec has already
            // moved lastIndex past the match), so its own `[label]` is not
            // picked up as a shortcut link.
            if (text[match.index - 1] === "!") {
                continue;
            }

            const resolvable = isResolvableReference(text, match, definitions);

            if (resolvable) {
                return match;
            }

            // Restart one character in, as `marked` consumes only the `[`
            // of an unresolved reference before scanning on.
            this.lastIndex = match.index + 1;
        }

        return null;
    }
}
```

`isResolvableReference(text, match, definitions)` returns `false` when an odd
number of `\` precede `match.index`;
when the match is the shortcut form (group 3 defined) and the character right
after it is `(` or `{`; or when
`definitions[normalizeReferenceLabel(label)]` is undefined. Otherwise it
returns `true`. `label` is group 3 for a shortcut, group 2 when non-empty, and
otherwise group 1. Put the label/form/text reading in one helper,
`readReference(match): { text: string; label: string; form: ReferenceLinkForm }`,
used by both `isResolvableReference` and `replace`. The text is group 3 for a
shortcut and group 1 otherwise.

**`REFERENCE_LINK`**:

```ts
/** Mirrors @lexical/markdown 0.49's `exportTextFormat` escaping of unformatted text. */
const LEXICAL_TEXT_ESCAPE = /([*_`~\\])/g;

export const REFERENCE_LINK: TextMatchTransformer = {
    dependencies: [ReferenceLinkNode],
    importRegExp: new ResolvedReferencePattern(),
    // Required by the type, never consulted: there is no `trigger`.
    regExp:       /\[((?:\\.|[^[\]\\])+)\]$/,
    replace: (textNode, match) => { /* see below */ },
    export: (node, exportChildren) => { /* see below */ },
    type: "text-match",
};
```

`replace`, mirroring `LINK.replace`:
1. If `$findMatchingParent(textNode, $isLinkNode)` is non-null, return (no
   links inside links).
2. `const reference = readReference(match)`. Look up
   `_activeDefinitions?.[normalizeReferenceLabel(reference.label)]`, and return
   when it is missing.
3. Build `$createReferenceLinkNode(definition.href, definition.title ?? null,
   { label, form, definitionUrl: definition.href, definitionTitle: definition.title ?? null })`.
4. Append a `$createTextNode(reference.text)` carrying `textNode.getFormat()`,
   call `textNode.replace(link)`, and return the inner text node. Lexical then
   applies `**` / `*` / `++` formatting inside the link text.

`export`:
1. If `!$isReferenceLinkNode(node)` or `!node.pointsAtDefinition()`, return
   `null`. `LINK` then writes the inline form.
2. `const { label, form } = node.getReference(); const text = exportChildren(node);`
3. If `form !== "full"` and `text === label.replace(LEXICAL_TEXT_ESCAPE, "\\$1")`,
   return `` `[${label}]` `` for a shortcut or `` `[${label}][]` `` for a
   collapsed form.
4. Otherwise return `` `[${text}][${label}]` ``.

**`LINK_DEFINITIONS`**:

```ts
/** `marked`'s own link-reference-definition rule; anchored, non-global. */
const DEFINITION_RULE: RegExp = Lexer.rules.block.gfm.def;

/** An empty or space/tab-only line — `marked`'s `blankLine`. */
const BLANK_LINE = /^[ \t]*$/;

export const LINK_DEFINITIONS: MultilineElementTransformer = {
    dependencies: [MarkdownLinkDefinitionsNode],
    regExpStart:  /^ {0,3}\[(?:\\.|[^[\]\\])+\]:/,
    handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => { /* see below */ },
    // Never reached from import (handled above); cancels the typing shortcut.
    replace: () => false,
    export: (node) => { /* see below */ },
    type: "multiline-element",
};
```

`handleImportAfterStartMatch`:
1. Return `null` if `$isTableCellNode(rootNode)`.
2. Return `null` if `startLineIndex > 0` and `lines[startLineIndex - 1]` is not
   `BLANK_LINE`.
3. `end` = the first index at or after `startLineIndex` whose line is
   `BLANK_LINE`, or `lines.length`.
   `run = lines.slice(startLineIndex, end).join("\n")`.
4. `consumed = 0`. While `consumed < run.length`, run
   `DEFINITION_RULE.exec(run.slice(consumed))`. Stop on `null`; otherwise add
   the match's length to `consumed`.
5. Return `null` when `consumed === 0`.
6. `definitionLines = run.slice(0, consumed).replace(/\n+$/, "").split("\n")`.
7. Create the node. Append a `$createTextNode(line)` per entry, with a
   `$createLineBreakNode()` between entries. Then `rootNode.append(node)`.
8. Return `[true, startLineIndex + definitionLines.length - 1]`.

`export`: return `null` unless `$isMarkdownLinkDefinitionsNode(node)`. Return
`node.getTextContent()` when every child is a `LineBreakNode`, or a `TextNode`
whose `getFormat() === 0` and `getStyle() === ""`. Otherwise return `null`, so
Lexical's default child export keeps any formatting or link the user added
inside the block.

**Import wrapper** (`markdownTransformers.ts`):

```ts
export function $convertFromDialectMarkdown(markdown: string): void {
    // Every definition line contains "]:"; a document without one skips the lex.
    const definitions: Links = markdown.includes("]:") ? lexMarkdownLinkDefinitions(markdown) : {};

    withLinkDefinitions(definitions, () => $convertFromMarkdownString(markdown, TRANSFORMERS));
}
```

**`MarkdownLinkDefinitionsNode` editing overrides.** `insertNewAfter` is
`ParagraphNode.insertNewAfter` reduced to its core: `$createParagraphNode()`,
`this.insertAfter(newElement, restoreSelection)`, return it. `collapseAtStart`
is a copy of `ParagraphNode.collapseAtStart`
(`node_modules/lexical/Lexical.dev.mjs`, `class ParagraphNode`).

---

## Ordered Implementation Steps

### Phase 1 — viewer

1. **`component/display/Markdown.ts`** — in `appendBlockToken`
   ([:1637](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1637)),
   add below the `space` case:
   ```ts
   // A link reference definition: `marked` has already resolved every
   // reference to it into a `link` token, so the definition renders nothing.
   case "def": break;
   ```
   In the class `@remarks`
   ([:580](packages/lib/src/typescript/lib/component/display/Markdown.ts#L580)),
   change "links" to "links (inline and reference-style; a reference
   definition renders nothing)".
2. **`component/display/markdownTableExtension.ts`** — replace
   `this.lexer.inlineTokens(text)` with `this.lexer.inline(text)` at
   [:210](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L210)
   and
   [:256](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L256).
   Check: `grep -n "inlineTokens" packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts`
   — expect zero matches.
3. **`component/display/markdownExtensions.ts`** — add
   `lexMarkdownLinkDefinitions` after `lexMarkdown`
   ([:393](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L393)),
   with a JSDoc saying it returns `marked`'s normalised-label → `{ href, title }`
   map, and that the editor uses it so both sides resolve references
   identically. Add `Links` to the `import type` from `"marked"`.
4. **Viewer tests** — add the Phase 1 cases from `## Expected Behaviour` (V1–V7)
   as a `describe('Markdown reference links and definitions')` in
   `tests/component/display/Markdown.test.ts`, and L1 to
   `tests/component/display/markdownLexer.test.ts`. Run
   `npm -w packages/lib exec -- vitest run tests/component/display` — green.

### Phase 2 — editor nodes and transformers

5. **Create `component/editor/markdownReferenceNodes.ts`** with
   `ReferenceLinkNode`, `MarkdownLinkDefinitionsNode` and their `$create…` /
   `$is…` helpers, per `## Public API` and `## Implementation`. Copy the
   `keepElement` helper and the null-view `throw` from
   [`markdownBlockNode.ts`](packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts#L58).
   `ReferenceLinkNode.afterCloneFrom` calls `super.afterCloneFrom(prevNode)`
   and then copies `__reference`. `exportJSON` spreads `super.exportJSON()` and
   sets `type: "reference-link"` and `reference`. `importJSON` builds the node
   from `json.url`, `{ title: json.title ?? null }` and `json.reference`, then
   returns `.updateFromJSON(json)`.
6. **`component/editor/editorNodes.ts`** — append `ReferenceLinkNode` and
   `MarkdownLinkDefinitionsNode` to `EDITOR_NODES` and name both in its
   `@remarks`. This must land in the same step as or before step 8:
   `registerMarkdownShortcuts` rejects a transformer whose `dependencies` are
   not registered.
7. **Create `component/editor/markdownReferenceTransformers.ts`** with
   `_activeDefinitions`, `withLinkDefinitions`, `normalizeReferenceLabel`,
   `readReference`, `isResolvableReference`, `ResolvedReferencePattern`,
   `REFERENCE_LINK` and `LINK_DEFINITIONS`, per `## Implementation`. Import
   `Lexer` and `type Links` from `"marked"`, `$isTableCellNode` from
   `"@lexical/table"`, `$findMatchingParent` from `"@lexical/utils"`, and
   `$isLinkNode` from `"@lexical/link"`. Document each regex's constants
   (`{0,3}` is CommonMark's definition indent).
8. **`component/editor/markdownTransformers.ts`** — insert `LINK_DEFINITIONS`
   after `TABLE`, and `REFERENCE_LINK` directly before `LINK`, in `TRANSFORMERS`
   ([:68](packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts#L68)).
   Add `$convertFromDialectMarkdown`. In the JSDoc, change "fifteen" to
   "seventeen", add the two mapping bullets
   (`REFERENCE_LINK` → `[t][label]` / `[label][]` / `[label]` (link);
   `LINK_DEFINITIONS` → `[label]: url` (def)), and add one sentence on the
   order: `REFERENCE_LINK` sits before `LINK` so it exports its own nodes and
   wins same-position import ties.
9. **`component/editor/MarkdownEditor.ts`** — replace the three
   `$convertFromMarkdownString(…, TRANSFORMERS)` calls with
   `$convertFromDialectMarkdown(…)`: `setMode`
   ([:1238](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1238)),
   `setValue`
   ([:1300](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1300)),
   and `ensureEditor`
   ([:2269](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2269)).
   Remove `$convertFromMarkdownString` from the `@lexical/markdown` import
   ([:28](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L28))
   and add `$convertFromDialectMarkdown` to the `markdownTransformers.js`
   import. Check: `grep -n "convertFromMarkdownString" packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`
   — expect zero matches.
10. **`tests/component/markdown-editor.test.ts`** — keep these edits
    minimal:
    - curation test
      ([:179](packages/lib/tests/component/markdown-editor.test.ts#L179)):
      `toHaveLength(17)`, and add `REFERENCE_LINK`, `LINK_DEFINITIONS` to the
      `arrayContaining` list (import them);
    - `EDITOR_NODES` test
      ([:195](packages/lib/tests/component/markdown-editor.test.ts#L195)): one
      `it` per new node;
    - `VIEWER_TOKENS`
      ([:77](packages/lib/tests/component/markdown-editor.test.ts#L77)): add
      `'def'`;
    - `CORPUS`
      ([:50](packages/lib/tests/component/markdown-editor.test.ts#L50)): add
      `'reference links': 'See [text][ref], [ref][] and [ref].\n\n[ref]: https://example.com "Title"'`.
11. **Create `tests/component/markdown-reference-links.test.ts`** with the E1–E9
    cases. Reuse the harness setup and the `normalize` / `lexicalOf` helper
    shapes from `markdown-editor.test.ts`, copied rather than imported, since
    that file exports nothing. Run
    `npm -w packages/lib exec -- vitest run tests/component/markdown-reference-links.test.ts tests/component/markdown-editor.test.ts`
    — green.

### Phase 3 — docs and changelog

12. **`docs/components/Markdown.md`** — in **Supported syntax (v1)**
    ([:44](packages/lib/docs/components/Markdown.md#L44)), after the
    `[text](url)` row add:
    - `` `[text][label]`, `[label][]`, `[label]` `` → "`<a>` whose href is the
      matching reference definition's URL; labels match case-insensitively,
      and an undefined label renders as literal text";
    - `` `[label]: url "title"` `` → "nothing — the definition only supplies a
      URL, wherever it sits (top level, blockquote, list item, `:::` fence)".
13. **`docs/components/MarkdownEditor.md`** — add "reference-style links" to the
    construct list in the lead paragraph
    ([:5](packages/lib/docs/components/MarkdownEditor.md#L5)). Add two rows to
    the **Supported constructs** table
    ([:42](packages/lib/docs/components/MarkdownEditor.md#L42)):
    `Reference link | [text][label], [label][], [label]` and
    `Link reference definition | [label]: url "title"`. Below the table, add
    a paragraph saying:
    - the WYSIWYG surface shows reference links as links;
    - saving keeps each link's authored form and the definition lines exactly
      as written;
    - changing a reference link's URL (e.g. **Edit link…**) saves it as an
      inline `[text](url)` link;
    - a reference typed in the WYSIWYG surface becomes a link the next time the
      document is loaded (`setValue` or a mode switch);
    - new definitions are best added in source mode: one typed in the WYSIWYG
      surface is saved as ordinary text, with Lexical's escaping, until the
      next load.
14. **`docs/reference/changelog/next.md`** — add under
    **Fixed › Components**
    ([:194](packages/lib/docs/reference/changelog/next.md#L194)):
    > **`Markdown` no longer prints link reference definitions.** A
    > `[label]: url` line — such as the version-link block at the foot of a
    > changelog — rendered as a paragraph of literal text. It now renders
    > nothing, as CommonMark specifies, at the top level or inside a
    > blockquote, list item or `:::` fence. A reference link inside a table
    > cell also resolves now when its definition comes after the table; it
    > used to render as literal text. No consumer action is needed.

    and under **Added › Components**
    ([:133](packages/lib/docs/reference/changelog/next.md#L133)):
    > **`MarkdownEditor` supports reference-style links.** The WYSIWYG surface
    > shows `[text][label]`, `[label][]` and `[label]` as links resolved
    > against the document's `[label]: url` definitions, and saving keeps
    > both the reference form and the definition lines exactly as written —
    > the editor used to show them as bracket text and backslash-escape
    > characters such as `_` in them on save. Changing a reference link's URL
    > saves it as an inline link. Source mode is unchanged.
15. Run the `## Verification` commands.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` |
| Create | `packages/lib/src/typescript/lib/component/editor/markdownReferenceNodes.ts` |
| Create | `packages/lib/src/typescript/lib/component/editor/markdownReferenceTransformers.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorNodes.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/component/display/markdownLexer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Create | `packages/lib/tests/component/markdown-reference-links.test.ts` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All unit-testable under the modelled DOM unless marked **manual**.

### Viewer (`Markdown.test.ts`, `markdownLexer.test.ts`)

| # | Source | Expected |
|---|---|---|
| V1 | `# H\n\n[x]: https://example.com\n` | no text write contains `[x]:`; no `p` is created (SQLAdmin's repro) |
| V2 | `See [text][ref] and [ref] and [ref][] and [Ref].\n\n[ref]: https://e.com "T"` | four `a` elements with `href` `https://e.com`; no text write contains `]:` |
| V3 | `> [q]\n>\n> [q]: https://q.com` | one `a` with `href` `https://q.com`; no text write contains `[q]:` |
| V4 | `::: {align=center}\n[x]\n\n[x]: https://blk\n:::` | one `a` with `href` `https://blk`; no text write contains `[x]:` |
| V5 | `\| a \|\n\| --- \|\n\| [ref] \|\n\n[ref]: https://e.com` | an `a` with `href` `https://e.com` is a child of a `td` |
| V6 | `para\n[x]: https://e.com` | the text `[x]: https://e.com` is rendered (a definition cannot interrupt a paragraph) |
| V7 | `[a]\n\n[a]: https://one\n[a]: https://two` | the `a` has `href` `https://one` (first definition wins); neither definition is rendered |
| L1 | `lexMarkdown` of the V5 source | `rows[0][0].tokens[0]` has `type: 'link'`, `href: 'https://e.com'` |

`see [nope] here` still renders literal text with no `a` — covered by the
existing link tests staying green.

### Editor (`markdown-reference-links.test.ts`)

**E1 — round-trip.** `new MarkdownEditor()`, then `setValue(input)`, then
`getValue()`:

| Input | `getValue()` |
|---|---|
| `See [text][ref] and [ref] and [ref][] and [Ref].\n\n[ref]: https://e.com "T"` | identical |
| `See [go][my_ref] and [my_ref].\n\n[my_ref]: https://e.com/a_b_c~d` | identical (no `\_` / `\~`) |
| `[x]\n\n[x]:\n  https://e.com\n  "Title"` | identical |
| `[a]\n\n[a]: https://one\n[a]: https://two` | identical |
| `para line\n[ref]: https://e.com\n\n[ref]` | identical |
| `![alt][ref] here\n\n[ref]: https://e.com` | identical |
| `[ref](https://inline) and [ref]{color=red}\n\n[ref]: https://e.com` | identical |
| `[see [ref] here](https://outer)\n\n[ref]: https://e.com` | identical |
| `` `[ref]` and more\n\n[ref]: https://e.com `` | identical |
| `\| a \|\n\| --- \|\n\| [ref] \|\n\n[ref]: https://e.com` | identical |
| `::: {align=center}\n[x] in block\n\n[x]: https://blk\n:::` | identical |
| `[x]: https://e.com\nafter **b**` | `[x]: https://e.com\n\nafter **b**` (the definition ends; `after` is its own paragraph) |
| `A **[ref]**\n\n[ref]: https://e.com` | `A [**ref**][ref]\n\n[ref]: https://e.com`; a second `setValue`/`getValue` pass returns the same string |

**E2 — node tree.** After `setValue(E1 row 1)`:
- the paragraph holds four `reference-link` nodes, each with `getURL() === 'https://e.com'` and `getTitle() === 'T'`;
- their `getReference()` forms are `full`, `shortcut`, `collapsed`, `shortcut`, with labels `ref`, `ref`, `ref`, `Ref`;
- the last root child is a `markdown-link-definitions` node whose text content is `[ref]: https://e.com "T"`.

In the `![alt][ref]` row, the paragraph holds no `link` and no
`reference-link` node. In the `[ref](https://inline)` row, it holds exactly one
`link` node and no `reference-link` node. The `[see [ref] here](…)` row holds
one `link` and no `reference-link`. The table-cell row's cell holds a
`reference-link` and no `markdown-link-definitions` node.

**E3 — no definitions, no links.** `setValue('see [nope] and [a][b]')` → no
`reference-link` node; `getValue()` identical.

**E4 — selection state.** Caret inside the `[text][ref]` link →
`getSelectionState().linkUrl === 'https://e.com'`.

**E5 — URL edit writes the inline form.** Caret inside `[text][ref]`, then
`toggleLink('https://new')` → `getValue()` contains `[text](https://new "T")`.
The definition line is unchanged.

**E6 — shortcut text edit writes the full form.** From
`[ref]\n\n[ref]: https://e.com`, set the link's text node to `refX` through
`lexicalOf(editor).update` → `getValue()` is
`[refX][ref]\n\n[ref]: https://e.com`.

**E7 — remove link.** Caret inside `[text][ref]`, then `removeLink()` →
`getValue()` starts `See text and`.

**E8 — scope ends with the conversion.** After
`setValue('[ref]\n\n[ref]: https://e.com')`, a direct
`lexicalOf(editor).update(() => $convertFromMarkdownString('[ref]', TRANSFORMERS), { discrete: true })`
leaves a root whose paragraph holds text, not a `reference-link`.

**E9 — JSON round-trip.**
`ReferenceLinkNode.importJSON(node.exportJSON())` inside an update keeps the
URL, title and `getReference()` of the source node.

### Manual (MD Editor demo: `npm run dev`, **MD Editor** section)

- **M1.** Paste a changelog body ending in a `[0.4.0]: https://…` block into
  source mode, then switch to WYSIWYG. `[0.4.0]` headings show as links. The
  definition lines show as one plain paragraph. The live preview shows no
  definition text.
- **M2.** In WYSIWYG, Enter at the end of a definition line starts a new plain
  paragraph. Shift+Enter adds a line inside the definition block. Switch to
  source: both are saved as typed.
- **M3.** Right-click a reference link → **Edit link…**. The dialog shows the
  resolved URL. Change it, switch to source, and the link is now
  `[text](new-url)`.

---

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean (the new node's `createDOM` goes through
  `DOM.sink.createViewElement`, so `local/no-raw-dom` stays at its empty
  baseline).
- `npm run test` — green, including every unit case above,
  `tests/unit/import-without-dom.test.ts` (the new modules touch no DOM at
  import), and the unchanged `lexMarkdown` ↔ `lexMarkdownUnbounded` parity
  suite.
- `grep -rn "convertFromMarkdownString" packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`
  — zero matches.
- `npm run docs:api` — 0 warnings.
- `npm run docs:llms:check` — passes.
- Manual M1–M3.

---

## Potential Challenges

- **Merge order with the two unmerged source-mode branches.**
  `feature/markdown-source-mode-editing` and
  `feature/markdown-source-mode-styled-spans` are finished and share four
  files with this plan (see frontmatter). There is no functional dependency.
  Neither branch changes the three import call sites; on the styled-spans
  branch they sit at `MarkdownEditor.ts` lines 1329 / 1423 / 2591. Implement
  this plan after both merge to master, so conflicts stay limited to
  appending to `next.md`, `MarkdownEditor.md` and the test file. Locate the
  call sites by `grep`, not by the line numbers above.
- **A definition directly under a non-blank line** (e.g. right below a heading
  with no blank line) is not recognised by the editor. It stays a plain
  paragraph and saves with Lexical's escaping, as it does today. It still
  resolves in the viewer. Mitigation: documented behaviour, not a bug. The
  common layout — a definition block after a blank line — is handled.
- **Definitions typed in WYSIWYG** are plain paragraphs until the next load, so
  a label typed with `_` saves as `\_` and no longer matches its references.
  Mitigation: author new definitions in source mode, as step 13 documents in
  `MarkdownEditor.md`.
- **A code span as a reference link's text** (`` [`c`][ref] ``) is split by
  Lexical's code-span-first import. The WYSIWYG view links only `[ref]`, but
  the saved text is unchanged. Mitigation: none needed. It is lossless and
  rare.

---

## Critical Files

- [`component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1637) — `appendBlockToken`, the `space` case to mirror.
- [`component/display/markdownTableExtension.ts`](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L164) — the table tokenizer.
- [`component/display/markdownExtensions.ts`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L393) — `lexMarkdown` and the scoped `_marked`.
- [`component/editor/markdownBlockTransformer.ts`](packages/lib/src/typescript/lib/component/editor/markdownBlockTransformer.ts#L45) — precedent for `handleImportAfterStartMatch`, `replace: () => false` and nested conversion.
- [`component/editor/markdownBlockNode.ts`](packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts#L37) — `MarkdownColumnNode`, precedent for an `ElementNode` with static `getType` / `clone` / `importJSON` and a seam-minted `createDOM`.
- [`component/editor/markdownImageTransformer.ts`](packages/lib/src/typescript/lib/component/editor/markdownImageTransformer.ts#L13) and [`markdownStyleTransformers.ts`](packages/lib/src/typescript/lib/component/editor/markdownStyleTransformers.ts#L23) — text-match transformers with no `trigger`.
- [`component/editor/markdownTransformers.ts`](packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts#L68) — `TRANSFORMERS` and its order rules.
- [`component/editor/markdownTableTransformer.ts`](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L290) — the nested per-cell conversion that inherits the definitions scope.
- `node_modules/@lexical/link/dist/LexicalLink.dev.mjs` — `class AutoLinkNode` (the `LinkNode` subclass precedent) and `LinkNode.shouldMergeAdjacentLink`.
- `node_modules/@lexical/markdown/src/importTextMatchTransformer.ts` and `importTextTransformers.ts` — how `importRegExp` is matched, and how same-position ties resolve.
- `node_modules/@lexical/markdown/src/MarkdownImport.ts:249` — the paragraph-merge rule `MarkdownLinkDefinitionsNode` avoids.

---

## Non-Goals

- **Reference-style images** (`![alt][ref]`). The dialect's images are
  `![alt](src){…}` only. An image reference stays literal text in the editor,
  and in the viewer renders as its alt text, as today.
- **Source-mode command awareness of reference links.** Source mode edits raw
  text, so nothing is lost. But its `toggleLink` / `removeLink` /
  `linkUrl` / styled-span logic
  (`markdownSourceEdits.ts` on the unmerged branches) recognises only
  `[text](url)`. Teaching it `[text][ref]` is a separate change to that
  module.
- **Styling or hiding definitions in WYSIWYG.** They render as an ordinary
  paragraph, so they stay editable.
- **Rendering a link `title`.** Neither inline nor reference links render
  `title` in the viewer today; unchanged.
- **Re-resolving references while editing.** A reference link keeps the URL it
  resolved to at load. Editing its definition line changes the saved Markdown
  (which the viewer resolves), and the WYSIWYG link updates on the next load.
- **Pruning SQLAdmin's `LIBRARY_NOTES.md` entry.** That happens app-side once
  it adopts 0.11.0.

---

## Notes

[^def-skip]: The `default:` branch's literal-text fallback is meant for
    constructs the viewer cannot render (raw HTML, task lists). A `def` token
    is different: `marked` has already folded it into every reference that uses
    it, so there is nothing left to render. Consuming it silently is what every
    CommonMark renderer does, and what `case "space"` already does for the
    other token that exists only for source layout.

[^inline-queue]: `this.lexer.inlineTokens(text)` lexes the cell right away,
    during the block pass. At that point `lexer.tokens.links` holds only the
    definitions *above* the table, so a reference to a definition below it
    lexes as plain text. `this.lexer.inline(text)` pushes the cell onto
    `marked`'s inline queue and returns the (still empty) token array, which
    `Lexer.lex` fills after the block pass. `marked` 18's own `table` tokenizer
    uses `this.lexer.inline(...)` for header and body cells. Checked against the
    library's lexer: a reference in a cell before this change lexes as
    `{ type: 'text', raw: '[ref]' }`.

[^same-resolver]: Re-implementing definition parsing in the editor would
    create a second definition of "what is a definition" that could drift from
    the viewer's. `marked` handles duplicate definitions (first wins),
    definitions nested in blockquotes, list items and `:::` columns,
    definitions that would interrupt a paragraph (not definitions), and
    definition-looking lines inside fenced code (not definitions). Lexing
    through the same scoped instance gets all of those identical by
    construction. The `markdown.includes("]:")` guard skips that extra lex for
    the common document with no definitions: every definition line contains
    `]:`, so the guard never skips a document that has one.

[^scoped-state]: Lexical's `TextMatchTransformer.replace(node, match)` has no
    context parameter. `$convertFromMarkdownString` is synchronous, so a
    variable set before the call and restored in `finally` is visible to every
    `replace` the call makes — including the nested cell and column conversions
    the `TABLE` / `BLOCK` transformers make — and to nothing else. Lexical
    tracks its own active editor the same way. The alternative, a transformer
    factory per editor instance (like `createTableTransformer`'s lazy getter),
    would make `TRANSFORMERS` per-instance and break the single curated array
    the editor, the shortcut registration and the tests all share.

[^link-subclass]: `@lexical/link`'s `AutoLinkNode` extends `LinkNode` to add
    one field (`__isUnlinked`), with `afterCloneFrom`, `exportJSON`, and
    `shouldMergeAdjacentLink() { return false; }`. `ReferenceLinkNode` has the
    same shape. The static `getType` / `clone` / `importJSON` style (rather
    than `AutoLinkNode`'s `$config()`) follows this codebase's own nodes; a
    prototype registering a `LinkNode` subclass in that style built, cloned
    and exported correctly on a headless editor. Lexical's `NodeState`
    (`createState` / `$setState`) could attach the reference to a plain
    `LinkNode` instead, but nothing in the codebase uses it, and a named node
    type keeps `$isReferenceLinkNode` checks and JSON explicit.
    `shouldMergeAdjacentLink` returns `false` so two adjacent reference links
    to the same URL (`[a][r][b][r]`) are never merged into one.

[^text-unchanged]: For a shortcut or collapsed reference, the link text *is*
    the label, so the label must be written back exactly, not through Lexical's
    text export. That export backslash-escapes `*`, `_`, `` ` ``, `~` and `\`
    (`exportTextFormat` in `@lexical/markdown`), and `marked` does not unescape
    labels, so `[my\_ref]` would no longer match the definition `[my_ref]`. A
    link whose text is still the label exports as exactly the label escaped by
    that rule. Comparing against it tells "unchanged" apart from "edited" or
    "formatted" without tracking edits. If a future Lexical escapes
    differently, the comparison simply fails and the full form
    `[text][label]` is written, which resolves to the same definition. One
    visible effect: `**[ref]**` loads as a bold link and saves as
    `[**ref**][ref]` — the same rendering, and stable from then on.

[^verbatim-defs]: Today a definition line is an ordinary paragraph, and
    Lexical's text export escapes it: `[my_ref]: https://e.com/a_b_c~d` saves
    as `[my\_ref]: https://e.com/a\_b\_c\~d` (checked on master). That
    still resolved only because references were escaped the same way. Once
    `REFERENCE_LINK` writes labels raw (see the previous note), an escaped
    definition label would stop matching. Writing the block verbatim keeps both
    sides unescaped. It also stops `REFERENCE_LINK` from turning the
    definition's own `[label]` into a clickable link — an **Edit link…** on
    that would have rewritten the definition as prose. The export declines
    (returns `null`) when the user added formatting or a link inside the block,
    so that content is saved through the normal path rather than silently
    dropped by `getTextContent()`.

[^not-paragraph]: `@lexical/markdown`'s import (`MarkdownImport.ts:249`)
    appends a text line to the previous sibling when that sibling is a
    `ParagraphNode`, `QuoteNode` or `ListNode`. A prototype that subclassed
    `ParagraphNode` absorbed the following `after` line of
    `[x]: …\n"Title"\nafter` into the definition block. That would have
    exported `after **b**` through `getTextContent()` as `after b`. An
    `ElementNode` is not merged into, so the next line becomes its own
    paragraph, and the export gains a blank line before it — the same meaning
    in `marked`, which ends a definition at that line anyway.

[^order]: Two Lexical rules decide the order. Export: `$exportChildren` asks
    each text-match transformer in array order and uses the first non-null
    `export`. `LINK.export` accepts any `$isLinkNode` that is not an autolink,
    so it must come after `REFERENCE_LINK`. Import:
    `findOutermostTextMatchTransformer` keeps the first transformer's match
    unless a later one starts *strictly* earlier, so at an equal start the
    earlier transformer wins. That favours `REFERENCE_LINK` in
    `[ref] text [x](u)`, where `LINK`'s lazy `\[(.+?)\]\(` also starts at `0`
    and would otherwise swallow `ref] text [x` as link text. It is also why the
    pattern refuses a shortcut followed by `(` or `{`. Putting `REFERENCE_LINK`
    after `LINK` and wrapping `LINK.export` instead was rejected: it replaces
    the stock `LINK` in the curated array and loses the tie-break above.

[^symbol-match]: Lexical finds a text-match transformer's match with
    `textNode.getTextContent().match(transformer.importRegExp)` — the only use
    of `importRegExp` in `@lexical/markdown` 0.49 — so overriding
    `[Symbol.match]` fully controls it. A plain regex cannot do this. It would
    match the first `[…]` in the node, resolvable or not. `getEndIndex`
    returning `false` would then skip the transformer for the whole node,
    missing a later `[ref]`. Refusing in `replace` would leave the refused
    `[…]` split off and never rescanned, so `[nope **b**]` would lose its bold
    and save as `[nope \*\*b\*\*]`, because Lexical escapes `*` in plain
    text. Matching only resolvable references avoids both. A prototype of this
    pattern, spliced into a copy of `TRANSFORMERS`, round-tripped the
    reference-form, underscore, duplicate, paragraph-continuation, nested-link,
    code-span and bold rows of E1 as listed. The table and `:::` rows need the
    transformer inside `TRANSFORMERS` itself, because the nested conversions
    read that array.
