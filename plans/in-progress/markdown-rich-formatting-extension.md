---
touches-shared:
    - packages/lib/src/typescript/lib/component/display/Markdown.ts
    - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
    - packages/lib/src/typescript/lib/component/editor/editorTheme.ts
    - packages/lib/src/typescript/lib/core/DOM.ts
    - packages/lib/tests/component/display/Markdown.test.ts
    - packages/lib/tests/component/markdown-editor.test.ts
    - packages/lib/docs/components/Markdown.md
    - packages/lib/docs/components/MarkdownEditor.md
---

# Rich Formatting in the Markdown Dialect — Implementation Plan

## Overview

The library ships two halves of one Markdown dialect: the read-only viewer [`Markdown`](packages/lib/src/typescript/lib/component/display/Markdown.ts) and the WYSIWYG editor [`MarkdownEditor`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts), whose value is a Markdown string. **The two halves must render the same document identically** — that rule already governs the pair and is written into the code in four places.[^parity-sources] This plan extends both halves with the formatting CommonMark and GFM cannot express: underline, coloured text, font family, font size, block alignment, sized and merged table cells, multi-column text regions, and sized images.

Because none of those constructs has a Markdown syntax, the plan also fixes how such a document is stored: **the dialect grows a small extension syntax, and both halves grow a matching parser for it**. The viewer keeps building every element through the DOM sink from parsed tokens, so it still never assigns an HTML string and untrusted source still cannot inject markup.[^why-not-html]

The work lands in **four phases**, each shipping both halves together so no release can carry a construct only one side understands.[^phasing] Two phases add a new Lexical node class, which is what forces the one framework-level change here: a new DOM-seam primitive, since the `no-raw-dom` lint rule forbids a custom node's `createDOM` from touching an element directly.[^seam-need]

---

## Architecture Decisions

### The dialect grows an extension syntax; the persisted value stays a Markdown string

`MarkdownEditor.getValue()` keeps returning a Markdown string, and `Markdown.setMarkdown()` keeps taking one. The new constructs are carried by markers CommonMark leaves unclaimed, parsed by a hand-written transformer on the editor side and a `marked` tokenizer extension on the viewer side.[^syntax-choice]

The full grammar, in one table:

| Feature | Syntax | Phase |
|---|---|---|
| Underline | `++text++` | 1 |
| Colour / font / size | `[text]{color=#cc0000 font=Georgia size=1.2em}` | 1 |
| Column width | `{width=240}` after a delimiter cell's dashes | 2 |
| Merged cell | `<<` (covered from the left), `^^` (covered from above) | 2 |
| Block alignment | `::: {align=center}` … `:::` | 3 |
| Multi-column region | `::: {columns=2 gap=2em}` … `:::` | 3 |
| Sized image | `![alt](src){width=320 height=200}` | 4 |

Worked example — one document, and what each half does with it:

```markdown
A ++underlined++ word and a [red one]{color=#cc0000 size=1.2em}.

::: {align=center}
# Centred title
:::

| Name | Qty |
| :--- {width=240} | ---: |
| Nut | 10 |
| Bolt | << |

![Diagram](/img/d.png){width=320}
```

| Construct | Editor state | Viewer DOM |
|---|---|---|
| `++underlined++` | `TextNode` with the `underline` format flag | `<u class="ts-ui-md-underline">` |
| `[red one]{…}` | `TextNode` with `style` `color: #cc0000; font-size: 1.2em` | `<span style="color:#cc0000;font-size:1.2em">` |
| `::: {align=center}` | `MarkdownBlockNode` with `align` `"center"` | `<div class="ts-ui-md-block" style="text-align:center">` |
| `{width=240}` | `TableNode.setColWidths([240, 0])` | `<colgroup><col style="width:240px"><col>` |
| `<<` | the `Bolt` cell's `colSpan` is `2`; no second cell node | `<td colspan="2">` and no second `<td>` |
| `![Diagram](…){width=320}` | `MarkdownImageNode` with `src` / `alt` / `width` | `<img src="/img/d.png" alt="Diagram" width="320">` |

A document using these constructs is **not portable**: a foreign Markdown renderer shows the markers as literal text rather than applying them. That is a deliberate trade and must be stated in the docs.[^portability]

### One shared module owns the attribute grammar and its safety rules

`{key=value …}` is parsed, validated, and re-serialised in exactly one place — a new module, `packages/lib/src/typescript/lib/component/display/markdownAttributes.ts` — imported by both halves. Every value both halves render passes through its validators, and a value that fails is dropped rather than rendered.[^shared-grammar]

Validation is per key, and rejection is silent by design:

| Key | Accepted | `color=red; x` | `size=12` | `columns=9` |
|---|---|---|---|---|
| `color` | `#rgb`/`#rrggbb`/`#rrggbbaa`, a bare CSS colour word, `rgb()`/`rgba()`/`hsl()`/`hsla()` | dropped | — | — |
| `size` | a number plus `px`/`pt`/`em`/`rem`/`%` | — | dropped (no unit) | — |
| `font` | letters, digits, spaces, commas, hyphens, quotes | — | — | — |
| `align` | `left` / `center` / `right` / `justify` | — | — | — |
| `columns` | an integer 2–6 | — | — | dropped |
| `gap` | a number plus `px`/`em`/`rem`/`%` | — | — | — |
| `width`, `height` | a positive integer | — | — | — |

A dropped value means the construct renders with that property unset — `[x]{color=red; x}` renders as plain `x`, in both halves.

### The viewer parses through a configured `marked` instance, never the global

`Markdown.ts` stops importing `marked`'s module-level `lexer` and instead builds one module-level `new Marked({ extensions: [...] })` in a new `markdownExtensions.ts`, exporting `lexMarkdown(source)`. Every lexing site in the library — `Markdown.render`, `Markdown.setMarkdown`, `extractMarkdownHeadings`, and the editor's parity-guard test — goes through `lexMarkdown`.[^scoped-marked]

### A custom Lexical node reaches the DOM through a new seam primitive

Phases 3 and 4 add Lexical node classes, whose `createDOM` must return a real element. `DOM.sink` gains `createViewElement(tag, patch, factory)` — the detached-element counterpart of the existing `mountView(handle, factory)` escape, which hands a foreign widget an existing parent.[^seam-shape] The node's `createDOM` writes no annotation naming a DOM type and touches no DOM member, so the `no-raw-dom` rule stays green with its baseline still empty.

These node classes are **Lexical nodes, not framework `Component`s**: they are not wrapped in `callable()`, carry no `XOptions` bag, and none of ARCHITECTURE.md's `Component` rules (typed setters, options-bag caching, one-element-per-class) applies to them. They follow Lexical's own node contract instead.

### Merged cells are kept, not transformed away

[`MarkdownEditor.ts:1573`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1573) currently registers `registerTableCellUnmergeTransform`, a Lexical node transform that splits any cell with a span greater than one back into single cells. Phase 2 removes that registration; leaving it in silently destroys every merge the moment it is made.[^unmerge-removal]

### The viewer replaces `marked`'s table tokenizer with its own

Phase 2 adds a `marked` block tokenizer extension, `markdownTableExtension.ts`, that parses the whole pipe table itself and emits an `mdtable` token. `marked`'s built-in table parser rejects a delimiter cell carrying `{width=240}`, which would turn the whole table into paragraphs in the viewer while the editor still showed a grid.[^table-extension] The new extension mirrors the editor's existing hand-written [`markdownTableTransformer.ts`](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts), so each half owns one table parser.

### Alignment and multi-column regions share one container node

`::: {align=…}` and `::: {columns=…}` produce the same editor node — `MarkdownBlockNode`, a single `ElementNode` subclass carrying `align`, `columns`, and `gap` — and the same viewer element. One fence syntax, one transformer, one viewer arm, two commands.[^one-container]

Alignment therefore does **not** use Lexical's native `ElementNode` format / `FORMAT_ELEMENT_COMMAND`.[^why-not-element-format]

### Colour, font, and size are refused inside a link

`setTextColor` / `setFontFamily` / `setFontSize` no-op when the selection sits inside a link, so a styled span can never be nested inside `[text](url)`.[^no-style-in-link]

### No toolbar; commands plus the existing right-click menu

Every new format is reachable two ways, exactly as the existing ones are: an imperative command a consumer wires to their own `Button`, and an item in the self-wired right-click context menu built by [`buildTextContextMenuItems`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1809) and its siblings. `MarkdownEditor` ships no built-in chrome and this plan does not add any.[^no-toolbar]

---

## Public API

### `packages/lib/src/typescript/lib/core/DOM.ts`

```typescript
interface DOMSink {
    createViewElement<T>(tag: string, patch: ElementPatch, factory: (element: HTMLElement) => T): T | null;
}
```

### `packages/lib/src/typescript/lib/component/display/markdownAttributes.ts` (new, internal)

```typescript
export interface MarkdownSpanStyle {
    color:      string | null;
    fontFamily: string | null;
    fontSize:   string | null;
}

export interface MarkdownBlockStyle {
    textAlign:   string | null;
    columnCount: number | null;
    columnGap:   string | null;
}

export interface MarkdownImageSpec {
    src:    string;
    alt:    string;
    width:  number | null;
    height: number | null;
}

export function parseAttributes(text: string): Record<string, string>;
export function formatAttributes(attributes: Record<string, string>): string;
export function resolveSpanStyle(attributes: Record<string, string>): MarkdownSpanStyle;
export function spanStyleToAttributes(style: MarkdownSpanStyle): Record<string, string>;
/** Serialises a span style to the CSS text a Lexical `TextNode.setStyle` takes (kebab-case). */
export function spanStyleToCss(style: MarkdownSpanStyle): string;
/** Reads a Lexical `TextNode.getStyle()` CSS string back into the attribute record. */
export function cssTextToAttributes(cssText: string): Record<string, string>;
export function resolveBlockStyle(attributes: Record<string, string>): MarkdownBlockStyle;
export function blockStyleToAttributes(style: MarkdownBlockStyle): Record<string, string>;
export function resolveImageSpec(src: string, alt: string, attributes: Record<string, string>): MarkdownImageSpec | null;
export function resolveColumnWidth(text: string): number | null;
```

### `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` (new, internal)

```typescript
export function lexMarkdown(source: string): Token[];
```

### `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`

```typescript
/** Block alignment accepted by MarkdownEditor.setBlockAlignment. */
export type MarkdownBlockAlignment = "left" | "center" | "right" | "justify";

class MarkdownEditor extends Component<MarkdownEditorOptions> {
    // Phase 1
    toggleUnderline(): this;
    setTextColor(color: string | null): this;
    setFontFamily(family: string | null): this;
    setFontSize(size: string | null): this;

    // Phase 2
    mergeTableCells(): this;
    unmergeTableCell(): this;
    setTableColumnWidth(width: number | null): this;

    // Phase 3
    setBlockAlignment(align: MarkdownBlockAlignment | null): this;
    setColumnCount(count: number | null, gap?: string | null): this;

    // Phase 4
    insertImage(src: string, options?: { alt?: string; width?: number; height?: number }): this;
}
```

`ContextMenuTarget`'s `"table-cell"` and `"text"` variants each gain `underline: boolean` beside the existing `bold` / `italic` / `strikethrough` / `code` flags.

### `packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts` (new, internal)

```typescript
export class MarkdownBlockNode extends ElementNode {
    static getType(): string;                       // "markdown-block"
    static clone(node: MarkdownBlockNode): MarkdownBlockNode;
    static importJSON(json: SerializedMarkdownBlockNode): MarkdownBlockNode;

    getAlign(): string | null;
    setAlign(align: string | null): this;
    getColumnCount(): number | null;
    setColumnCount(count: number | null): this;
    getColumnGap(): string | null;
    setColumnGap(gap: string | null): this;
    /** True when neither an alignment nor a column count is set — the node should be unwrapped. */
    isEmptyOfAttributes(): boolean;
    /** This node's attributes in the shared `{key=value}` record form, for rendering and export. */
    toAttributes(): Record<string, string>;

    exportJSON(): SerializedMarkdownBlockNode;
    createDOM(config: EditorConfig);                // return type inferred, never annotated
    updateDOM(): boolean;                           // always true — see Internal Structure
}

export function $createMarkdownBlockNode(): MarkdownBlockNode;
export function $isMarkdownBlockNode(node: LexicalNode | null | undefined): node is MarkdownBlockNode;
```

### `packages/lib/src/typescript/lib/component/editor/markdownImageNode.ts` (new, internal)

```typescript
export class MarkdownImageNode extends DecoratorNode<null> {
    static getType(): string;                       // "markdown-image"
    static clone(node: MarkdownImageNode): MarkdownImageNode;
    static importJSON(json: SerializedMarkdownImageNode): MarkdownImageNode;

    getSrc(): string;
    getAlt(): string;
    getImageWidth(): number | null;
    getImageHeight(): number | null;

    isInline(): boolean;                            // true
    decorate(): null;                               // null — no decorator renderer in this app
    exportJSON(): SerializedMarkdownImageNode;
    createDOM(config: EditorConfig);                // return type inferred, never annotated
    updateDOM(): boolean;                           // always true
}

export function $createMarkdownImageNode(spec: MarkdownImageSpec): MarkdownImageNode;
export function $isMarkdownImageNode(node: LexicalNode | null | undefined): node is MarkdownImageNode;
```

---

## Internal Structure

### The attribute grammar (`markdownAttributes.ts`)

`parseAttributes` reads a space-separated `key=value` list. A value is either a bare run with no spaces or a double-quoted run. Unknown keys are kept by the parser and dropped by the per-feature resolvers.

```
parseAttributes('color=#c00 font="Georgia, serif" size=1.2em')
// -> { color: "#c00", font: "Georgia, serif", size: "1.2em" }

formatAttributes({ color: "#c00", font: "Georgia, serif" })
// -> 'color=#c00 font="Georgia, serif"'      (a value containing a space is quoted)
```

`resolveSpanStyle` maps and validates the three span keys, returning `null` per field when the key is absent or its value fails validation:

```
resolveSpanStyle({ color: "#c00", size: "1.2em" })
// -> { color: "#c00", fontFamily: null, fontSize: "1.2em" }

resolveSpanStyle(parseAttributes('color="red; background: url(x)"'))
// -> { color: null, fontFamily: null, fontSize: null }
```

`resolveImageSpec` returns `null` when the source fails the scheme allow-list — a relative path, `http:`, `https:`, or a `data:image/(png|jpeg|gif|webp|avif);base64,` URI. `data:image/svg+xml` is refused.

```
resolveImageSpec("/img/d.png", "Diagram", { width: "320" })
// -> { src: "/img/d.png", alt: "Diagram", width: 320, height: null }

resolveImageSpec("javascript:alert(1)", "x", {})   // -> null
resolveImageSpec("data:image/svg+xml;base64,PHN2", "x", {})   // -> null
```

`resolveColumnWidth` reads a delimiter cell's trailing attributes: `resolveColumnWidth(":--- {width=240}")` is `240`; `resolveColumnWidth(":---")` is `null`.

### The merged-cell grid (both halves, phase 2)

Both halves resolve merge markers with the same three-step algorithm over the parsed rows. Every row carries exactly `columnCount` entries, so no field-count arithmetic is needed.

1. Walk the grid row by row, left to right, filling an `anchor` grid:
   - cell text `<<` → `anchor[r][c] = anchor[r][c - 1]`
   - cell text `^^` → `anchor[r][c] = anchor[r - 1][c]`
   - anything else → `anchor[r][c] = { row: r, column: c }`
   - a `<<` in column 0 or a `^^` in row 0 has nothing to extend, so it becomes its own anchor holding that literal text.
2. For each anchor at `(r, c)`: `colSpan` is the run of columns from `c` in row `r` pointing at it; `rowSpan` is the run of rows from `r` in column `c` pointing at it.
3. Emit one cell per anchor, at its own position, with those spans. A covered position emits nothing.

Worked example:

```markdown
| a  | b  | c  |
| --- | --- | --- |
| d  | << | f  |
| ^^ | ^^ | g  |
```

| Position | Anchor | Result |
|---|---|---|
| `(1,0) d` | itself | `<td colspan="2" rowspan="2">d</td>` |
| `(1,1) <<` | `(1,0)` | covered — no cell |
| `(1,2) f` | itself | `<td>f</td>` |
| `(2,0) ^^` | `(1,0)` | covered — no cell |
| `(2,1) ^^` | `(1,1)` → `(1,0)` | covered — no cell |
| `(2,2) g` | itself | `<td>g</td>` |

Export is the same walk in reverse: for a cell with `colSpan` *n* write `n − 1` following `<<` cells; for `rowSpan` *m* write `^^` in that column of the *m − 1* rows below. A cell whose own text is literally `<<` or `^^` is escaped to `\<<` / `\^^` on export and unescaped on import, in both halves.

### The `:::` fence scan (both halves, phase 3)

A line whose trimmed form starts with `:::` and has a non-empty remainder **opens** a block; a line whose trimmed form is exactly `:::` **closes** one. The scan tracks depth and stops when it returns to zero, so blocks nest.

```markdown
::: {columns=2}
Left column text.

::: {align=center}
Centred inside.
:::

More text.
:::
```

| Line | Form | Depth after |
|---|---|---|
| `::: {columns=2}` | opens | 1 |
| `::: {align=center}` | opens | 2 |
| `:::` (after "Centred inside.") | closes | 1 |
| `:::` (last line) | closes | 0 — scan ends |

The inner content is every line between the opening line and the matching close, re-lexed with the same parser so nesting works with no special case.

### `MarkdownBlockNode.createDOM` (phase 3)

The element is minted through the new seam primitive, so the file never names or touches a DOM type. The factory is a module-level identity function whose parameter carries no annotation, exactly as `WysiwygSurface.mount` does at [`MarkdownEditor.ts:683`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L683).

```typescript
/** Identity factory for the seam's element mint; unannotated so no DOM type is named here. */
function keepElement(element) {
    return element;
}

createDOM(config: EditorConfig) {
    const style = resolveBlockStyle(this.toAttributes());
    const element = DOM.sink.createViewElement("div", {
        addClass: config.theme.mdBlock ? [config.theme.mdBlock] : [],
        style:    {
            textAlign:   style.textAlign,
            columnCount: style.columnCount === null ? null : String(style.columnCount),
            columnGap:   style.columnGap,
        },
    }, keepElement);

    if (element === null) {
        throw new Error("MarkdownBlockNode.createDOM requires a mounted view");
    }

    return element;
}

updateDOM(): boolean {
    return true;
}
```

`updateDOM` returns `true` unconditionally so Lexical rebuilds the element on any change rather than mutating it — the node has no way to touch an existing element under the seam rule. `MarkdownImageNode.createDOM` follows the same shape with tag `"img"`, `setAttr` carrying `src` / `alt` and the optional `width` / `height`, and `config.theme.mdImage`.

### The style commands (`MarkdownEditor.ts`, phase 1)

The three style commands share one private body. `$patchStyleText` takes **kebab-case** CSS property names, because its patch is serialised into the node's style string.

```typescript
private patchSelectionStyle(patch: Record<string, string | null>): this {
    const editor = this.ensureEditor();

    editor.update(() => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection) || $findEnclosingLinkNode(selection.anchor.getNode()) !== null) {
            return;
        }

        $selectEnclosingWordIfCollapsed();

        // Re-read: the expansion above replaces the selection object.
        const expanded = $getSelection();

        if ($isRangeSelection(expanded)) {
            $patchStyleText(expanded, patch);
        }
    }, { discrete: true });

    return this;
}
```

`setTextColor(value)` calls it with `{ color: value }`, `setFontFamily` with `{ "font-family": value }`, `setFontSize` with `{ "font-size": value }`. Passing `null` removes the property.

### The styled-span transformer (`markdownStyleTransformers.ts`, phase 1)

```typescript
export const UNDERLINE: TextFormatTransformer = {
    format: ["underline"],
    tag:    "++",
    type:   "text-format",
};

export const STYLED_TEXT: TextMatchTransformer = {
    dependencies: [],
    export: (node, _exportChildren, exportFormat) => {
        if (!$isTextNode(node) || node.getStyle() === "") {
            return null;
        }

        const style = resolveSpanStyle(cssTextToAttributes(node.getStyle()));
        const attributes = spanStyleToAttributes(style);

        return Object.keys(attributes).length === 0
            ? null
            : `[${exportFormat(node, node.getTextContent())}]{${formatAttributes(attributes)}}`;
    },
    importRegExp: /\[([^[\]]+)\]\{([^{}]*)\}/,
    regExp:       /\[([^[\]]+)\]\{([^{}]*)\}$/,
    replace: (textNode, match) => {
        const style = resolveSpanStyle(parseAttributes(match[2]));
        const inner = $createTextNode(match[1]);

        inner.setStyle(spanStyleToCss(style));
        textNode.replace(inner);

        return inner;
    },
    type: "text-match",
};
```

`cssTextToAttributes` and `spanStyleToCss` are two small local helpers converting between the node's CSS style string and the attribute record; both live in `markdownAttributes.ts` so the validation rules stay in one file. Returning `inner` from `replace` is what lets Lexical apply `**`/`*`/`++` formatting to the span's text afterwards, matching `LINK`'s own shape.

### The block-alignment command (`MarkdownEditor.ts`, phase 3)

```typescript
setBlockAlignment(align: MarkdownBlockAlignment | null): this {
    this.ensureEditor().update(() => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection)) {
            return;
        }

        const existing = $findMatchingParent(selection.anchor.getNode(), $isMarkdownBlockNode);

        if (existing !== null) {
            existing.setAlign(align);

            if (existing.isEmptyOfAttributes()) {
                // Unwrap: move the children out, then drop the empty container.
                for (const child of existing.getChildren()) {
                    existing.insertBefore(child);
                }

                existing.remove();
            }

            return;
        }

        if (align !== null) {
            $wrapSelectedTopLevelBlocks().setAlign(align);
        }
    }, { discrete: true });

    return this;
}
```

`$wrapSelectedTopLevelBlocks()` is a module-level helper that finds the first and last top-level ancestors the selection spans, inserts a fresh `MarkdownBlockNode` before the first, appends that whole run of blocks into it, and returns it. `setColumnCount(count, gap)` has the identical shape, calling `setColumnCount` / `setColumnGap` instead of `setAlign`.

### Viewer render arms (`Markdown.ts`)

Each new token gets an arm alongside the existing ones, building elements through `this.create(tag)` + `DOM.sink.apply` — never an HTML string:

| Token | Arm | Builds |
|---|---|---|
| `underline` (inline) | `appendInlineToken` | `<u class="ts-ui-md-underline">` with the token's inline children |
| `styledspan` (inline) | `appendInlineToken` | `<span>` with `{ style: resolveSpanStyle(token.attributes) }` |
| `mdtable` (block) | `appendBlockToken` | the existing wrapper › `<table>`, plus `<colgroup>` when any width is set, plus the merge grid |
| `mdblock` (block) | `appendBlockToken` | `<div class="ts-ui-md-block">` with `{ style: resolveBlockStyle(...) }`, recursing via `appendBlockTokens` |
| `mdimage` (inline) | `appendInlineToken` | `<img>` with the validated `src` / `alt` / `width` / `height`; nothing at all when `resolveImageSpec` returns `null` |

---

## Ordered Implementation Steps

### Phase 1 — Underline, colour, font family, font size

1. **`packages/lib/src/typescript/lib/component/display/markdownAttributes.ts`** (new) — `parseAttributes`, `formatAttributes`, `resolveSpanStyle`, `spanStyleToAttributes`, `spanStyleToCss`, `cssTextToAttributes`, plus the validation regexps from `## Architecture Decisions`. Start with the `// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0` header every sibling carries. Leave `resolveBlockStyle` / `blockStyleToAttributes` / `resolveImageSpec` / `resolveColumnWidth` out until their phases.
2. **`packages/lib/src/typescript/lib/component/display/markdownExtensions.ts`** (new) — a module-level `new Marked({ extensions: [UNDERLINE_EXTENSION, STYLED_SPAN_EXTENSION] })` and the exported `lexMarkdown(source)`. Each extension is a `TokenizerExtension` with `name` (`"underline"` and `"styledspan"` — the token types the viewer's arms switch on), `level: "inline"`, a `start(src)` returning `src.indexOf("++")` / `src.indexOf("[")`, and a `tokenizer(src)` that matches at position 0 only and calls `this.lexer.inlineTokens(inner)` for the children.
3. **`packages/lib/src/typescript/lib/component/display/Markdown.ts`** — replace the `import { lexer } from "marked"` at line 11 with `import { lexMarkdown } from "~/component/display/markdownExtensions.js"`, and swap all three call sites: `render` (line 989), `setMarkdown` (line 822), `extractMarkdownHeadings` (line 1932).
   - Check: `grep -c 'lexer(' packages/lib/src/typescript/lib/component/display/Markdown.ts` — expect zero.
4. Same file — add `UNDERLINE_CLASS = "ts-ui-md-underline"` beside the class-name constants at line 24 and its `StyleRule` (`textDecoration: "underline"`) in `ensureMarkdownClassRules` (line 167), then add the `underline` and `styledspan` arms to `appendInlineToken` (line 1738), following the shape of the existing `case "codespan"` arm.
5. **`packages/lib/src/typescript/lib/component/editor/editorTheme.ts`** — add `UNDERLINE_CLASS = "ts-ui-mde-underline"` and `UNDERLINE_STRIKETHROUGH_CLASS = "ts-ui-mde-underline-strikethrough"` beside the constants at line 11, their `StyleRule`s in `ensureMarkdownEditorClassRules` (line 43) with `textDecoration: "underline"` and `"underline line-through"`, and both keys under `EDITOR_THEME.text` (line 215). Lexical uses the combined class *instead of* both single ones when a run is underlined and struck, so the second rule is not optional.
6. **`packages/lib/src/typescript/lib/component/editor/markdownStyleTransformers.ts`** (new) — `UNDERLINE` and `STYLED_TEXT` exactly as in `## Internal Structure`.
7. **`packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts`** — import both and append them to `TRANSFORMERS` (line 55), with `STYLED_TEXT` **after** `LINK` so a link wins where both could match. Update the docblock's construct list and its "these eleven" count.
8. **`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`** — add `toggleUnderline()` beside `toggleStrikethrough` (line 1076), and `patchSelectionStyle` plus the three style commands after it, per `## Internal Structure`. Import `$patchStyleText` from `@lexical/selection` (which the file already imports `$setBlocksType` from, line 43).
9. Same file — add `underline: boolean` to both format-bearing `ContextMenuTarget` variants (line 330), read it in `$classifyContextMenuTarget` (line 478) through the existing `hasFormat` helper, add an `"Underline"` row to `buildFormatToggleItems` (line 1732), and add a `"Text style"` submenu to `buildTextContextMenuItems` (line 1809) and `buildTableCellContextMenuItems` (line 1881) with three sub-submenus (Colour, Font, Size), each a fixed preset list plus a `"Default"` item calling the setter with `null`.
10. Same file — extend the class docblock's dialect sentence (line 697) and its formatting paragraph to name the four new commands.
11. **`packages/lib/tests/component/display/Markdown.test.ts`** and **`packages/lib/tests/component/markdown-editor.test.ts`** — add the phase-1 cases from `## Expected Behaviour`. The viewer's style assertions need a `styleWrites()` helper beside the existing `classWrites()` (line 60), folding every `apply` patch's `style` payload for a handle into the style state it produces — the same shape `attrsOf` uses in the editor test. In the editor test, swap the `import { lexer } from 'marked'` at line 21 for `lexMarkdown`, add the phase-1 corpus documents at line 48, and update `toHaveLength(11)` at line 154 to `13`.
    - Check: `npm -w packages/lib run test` — green.

### Phase 2 — Table column widths and merged cells

12. **`packages/lib/src/typescript/lib/component/display/markdownAttributes.ts`** — add `resolveColumnWidth`.
13. **`packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts`** (new) — a `TokenizerExtension` with `name: "mdtable"`, `level: "block"`, and a `tokenizer` that requires a header row plus a delimiter row of matching width, reads each delimiter cell's alignment and optional `{width=…}`, scans body rows to the first blank line, and emits `{ type: "mdtable", raw, align, widths, header, rows }` with each cell's `tokens` produced by `this.lexer.inlineTokens(cellText)`. Reuse the same split/unescape rules the editor's `splitTableRow` ([`markdownTableTransformer.ts:39`](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L39)) uses, including `\|`, `\<<`, and `\^^`.
14. **`packages/lib/src/typescript/lib/component/display/markdownExtensions.ts`** — register the table extension in the `Marked` instance.
15. **`packages/lib/src/typescript/lib/component/display/Markdown.ts`** — rename the `case "table"` arm at line 1479 to `case "mdtable"`, rewrite `appendTable` (line 1580) and `appendTableRow` (line 1615) against the new token shape: emit a `<colgroup>` of `<col>` elements when any width is set, and place cells through the merge grid from `## Internal Structure`.
16. **`packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts`** — extend `parseDelimiterRow` (line 86) to also return per-column widths, `formatDelimiterRow` (line 123) to re-emit `{width=…}`, and both the import handler (line 167) and `export` (line 235) to apply the merge grid and `TableNode.setColWidths` / `getColWidths`. `setColWidths` takes a plain `number[]`, and `@lexical/table` treats a falsy entry as "no width", so an unwidthed column is stored as `0` and re-emitted with no `{width=…}`. Extend `escapeCellText` (line 143) to escape a literal `<<` / `^^`.
17. **`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`** — delete `registerTableCellUnmergeTransform` from the `mergeRegister` call (line 1573) and from the import at line 36.
    - Check: `grep -c 'registerTableCellUnmergeTransform' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — expect zero.
18. Same file — add `mergeTableCells()`, `unmergeTableCell()`, and `setTableColumnWidth(width)` after `deleteTable` (line 1447), following that method's `editor.update(..., { discrete: true })` shape. `mergeTableCells` calls `$mergeCells` on the cells of the current `TableSelection` and no-ops for any other selection; `unmergeTableCell` calls `$unmergeCell()` guarded by `$selectionIsInTableCell()`; `setTableColumnWidth` reads the caret's column index and writes that slot of the enclosing table's `colWidths`.
19. Same file — add `"Merge cells"`, `"Unmerge cell"`, and `"Column width…"` to `buildTableCellContextMenuItems` (line 1881). `"Column width…"` prompts through the existing `Dialog` + `TextField` pattern in `promptForLinkUrl` (line 1670); factor that prompt's body into a shared private `promptForText(title, defaultValue, placeholder)` and have both callers use it.
20. **Tests** — add the phase-2 cases from `## Expected Behaviour`; change `'table'` to `'mdtable'` in `VIEWER_TOKENS` (line 68).
    - Check: `npm -w packages/lib run test` — green.

### Phase 3 — Block alignment and multi-column regions

21. **`packages/lib/src/typescript/lib/core/DOM.ts`** — add `createViewElement` to the `DOMSink` interface beside `mountView` (line 860) and implement it on `ProductionDOMSink` beside `mountView` (line 1922) as `document.createElement(tag)` › `applyPatchTo(element, patch)` (line 340) › `factory(element)`.
22. **`packages/lib/tests/dom/TestDOM.ts`** — implement `createViewElement` on `RecordingDOMSink` beside `mountView` (line 752): record the call and return `null`, with the same docblock rationale.
23. **`packages/lib/src/typescript/lib/core/themes/BaseTheme.ts`** — add `columnGap: '2em'` to the `markdown` group (line 22). **`packages/lib/src/typescript/lib/core/Theme.ts`** — add the field to the `markdown` interface (line 688) and `'--ts-ui-md-column-gap': theme.markdown.columnGap` to the variable map (line 1226).
24. **`packages/lib/src/typescript/lib/component/display/markdownAttributes.ts`** — add `resolveBlockStyle` and `blockStyleToAttributes`.
25. **`packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts`** (new) — `MarkdownBlockNode` per `## Public API` and `## Internal Structure`.
26. **`packages/lib/src/typescript/lib/component/editor/markdownBlockTransformer.ts`** (new) — `createBlockTransformer(getTransformers)`, a `MultilineElementTransformer` whose `handleImportAfterStartMatch` runs the depth-tracking `:::` scan, converts the inner lines into a detached scratch `MarkdownBlockNode` with `$convertFromMarkdownString(inner, getTransformers(), block)`, applies the parsed attributes, and appends it to `rootNode`; and whose `export` emits `::: {attrs}\n` + `$convertToMarkdownString(getTransformers(), node)` + `\n:::`. Model the whole file on [`markdownTableTransformer.ts`](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts), which already uses this exact hook and the same lazy-transformer-list trick.
27. **`packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts`** — build `const BLOCK = createBlockTransformer(() => TRANSFORMERS);` beside the existing `TABLE` (line 21) and put `BLOCK` **first** in `TRANSFORMERS`, ahead of `TABLE`, so a fence wrapping a table is consumed as a fence. Add the fence to the docblock's construct list and update its count.
28. **`packages/lib/src/typescript/lib/component/editor/editorNodes.ts`** — append `MarkdownBlockNode` to `EDITOR_NODES` (line 23) and name it in the docblock.
29. **`packages/lib/src/typescript/lib/component/editor/editorTheme.ts`** — add `BLOCK_CLASS = "ts-ui-mde-block"`, its `StyleRule` (`margin: "1em 0"`, `columnGap: "var(--ts-ui-md-column-gap, 2em)"`), and `mdBlock: BLOCK_CLASS` on `EDITOR_THEME`. The class rule is where the gap **default** lives, so a fence with no `gap` attribute still gets one; an explicit `gap` overrides it as an inline style. The `EditorThemeClasses` index signature accepts the custom key.
30. **`packages/lib/src/typescript/lib/component/display/markdownExtensions.ts`** — add the `mdblock` block tokenizer extension running the same depth-tracking scan and lexing its inner content with `this.lexer.blockTokens(inner)`.
31. **`packages/lib/src/typescript/lib/component/display/Markdown.ts`** — add `BLOCK_CLASS = "ts-ui-md-block"` and its `StyleRule` (`margin: "1em 0"`, `columnGap: "var(--ts-ui-md-column-gap, 2em)"` — the same rule the editor gets in step 29, for the same reason), the `case "mdblock"` arm in `appendBlockToken` (line 1472), the `appendBlock` builder beside `appendBlockquote` (line 1654), an `ALIGN_JUSTIFY_CLASS` arm in `alignmentClass` (line 318), and an `mdblock` branch in `collectHeadings` (line 1902) so a heading inside a fence still reaches the minimap.
32. **`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`** — add the `MarkdownBlockAlignment` type beside `MarkdownBlockType` (line 92), then `setBlockAlignment` and `setColumnCount` after `setBlockType` (line 1292), plus the `$wrapSelectedTopLevelBlocks` module helper beside `$insertParagraphAroundEnclosingBlock` (line 247). Add an `"Alignment"` submenu to `buildTextContextMenuItems` and a `"Columns"` submenu to `buildEmptyLineContextMenuItems` (line 1857).
33. **`packages/lib/src/typescript/lib/component/editor/index.ts`** — add `MarkdownBlockAlignment` to the `export type { … } from '~/component/editor/MarkdownEditor.js'` list (line 13), so the type a consumer must name to call `setBlockAlignment` is reachable from the package entry point.
34. **Tests** — add the phase-3 cases; add `'mdblock'` to `VIEWER_TOKENS`; update `toHaveLength` for the transformer count to `14`.
    - Check: `npm -w packages/lib run lint` — the `no-raw-dom` baseline must stay `[]`.

### Phase 4 — Images

35. **`packages/lib/src/typescript/lib/component/display/markdownAttributes.ts`** — add `resolveImageSpec` with the scheme allow-list.
36. **`packages/lib/src/typescript/lib/component/editor/markdownImageNode.ts`** (new) — `MarkdownImageNode` per `## Public API`, using `DOM.sink.createViewElement("img", …)`.
37. **`packages/lib/src/typescript/lib/component/editor/markdownImageTransformer.ts`** (new) — an `IMAGE` `TextMatchTransformer`: `importRegExp` `/!\[([^[\]]*)\]\(([^()\s]+)\)(?:\{([^{}]*)\})?/`, `export` emitting the same form from the node's own fields, `replace` building the node through `resolveImageSpec` and doing nothing when it returns `null`.
38. **`packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts`** — append `IMAGE` to `TRANSFORMERS` and add it to the docblock's construct list and count; **`editorNodes.ts`** — append `MarkdownImageNode`; **`editorTheme.ts`** — add `IMAGE_CLASS = "ts-ui-mde-image"`, its `StyleRule` (`maxWidth: "100%"`), and `mdImage` on `EDITOR_THEME`.
39. **`packages/lib/src/typescript/lib/component/display/markdownExtensions.ts`** — add the `mdimage` inline extension matching `![alt](src)` with optional trailing `{…}`, so every image (sized or not) arrives as one token.
40. **`packages/lib/src/typescript/lib/component/display/Markdown.ts`** — add `IMAGE_CLASS = "ts-ui-md-image"` with the same `maxWidth: "100%"` rule and the `case "mdimage"` arm in `appendInlineToken`.
41. **`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`** — add `insertImage(src, options)` after `insertTable` (line 1345) and an `"Image…"` item to `buildEmptyLineContextMenuItems`, prompting through the shared `promptForText` added in step 19.
42. **Tests** — add the phase-4 cases; update `toHaveLength` for the transformer count to `15`.

### Documentation and demos (each phase)

43. **`packages/lib/docs/components/Markdown.md`** — extend the supported-syntax table (line 42) with one row per construct, and extend the security sentence at line 5 so it states that attribute values are validated against an allow-list and a failing value is dropped, rather than leaving the reader with only the no-`innerHTML` claim. Add a short "Extension syntax" section stating that a document using these constructs renders correctly in this library's viewer only.
44. **`packages/lib/docs/components/MarkdownEditor.md`** — add the constructs to the table under `## Supported constructs` (line 39), rewrite the exclusion sentence at line 58 (images are no longer excluded), add every new command to the command-API table, and extend the context-menu paragraph.
45. **`packages/lib/src/typescript/MarkdownPanel.ts`** — add each phase's construct to `SAMPLE` (line 7) so the viewer demo shows it.
46. **`packages/lib/src/typescript/MarkdownEditorPanel.ts`** — add each phase's construct to `SAMPLE` (line 12), and add `Underline`, `Colour`, `Align centre`, `Columns`, `Merge cells`, and `Insert image` buttons to the existing `ToolBar` (line 96), each wired through a named arrow field beside `handleInsertTable` (line 135), per the ARCHITECTURE listener rule.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/display/markdownAttributes.ts` |
| Create | `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` |
| Create | `packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts` |
| Create | `packages/lib/src/typescript/lib/component/editor/markdownStyleTransformers.ts` |
| Create | `packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts` |
| Create | `packages/lib/src/typescript/lib/component/editor/markdownBlockTransformer.ts` |
| Create | `packages/lib/src/typescript/lib/component/editor/markdownImageNode.ts` |
| Create | `packages/lib/src/typescript/lib/component/editor/markdownImageTransformer.ts` |
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Theme.ts` |
| Modify | `packages/lib/src/typescript/lib/core/themes/BaseTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorNodes.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/index.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/src/typescript/MarkdownPanel.ts` |
| Modify | `packages/lib/src/typescript/MarkdownEditorPanel.ts` |

---

## Expected Behaviour

### Phase 1 — unit-testable

Viewer, in `Markdown.test.ts`:

- `A ++word++ here` creates a `u` element inside the `p`, with the text `word`.
- `[x]{color=#cc0000}` creates a `span` whose applied style is `{ color: "#cc0000" }`.
- `[x]{color=#cc0000 size=1.2em font=Georgia}` applies all three properties on one `span`.
- `[x]{color=red; background: url(y)}` creates a `span` with **no** style properties applied; the text `x` still renders.
- `[x]{size=12}` (no unit) creates a `span` with no style properties applied.
- `[x]{bogus=1}` creates a `span` with no style properties applied.
- `**++b++**` nests a `u` inside a `strong`.

Editor, in `markdown-editor.test.ts`:

- `TRANSFORMERS` has 13 entries and still excludes `HIGHLIGHT` and `CHECK_LIST`.
- These documents round-trip to a fixpoint and are canonically equal to their source: `A ++word++ here.`, `A [red]{color=#cc0000} word.`, `A [big]{font=Georgia size=1.2em} word.`
- `toggleUnderline()` on a document with the caret in a word yields `++word++` in the value.
- `setTextColor('#cc0000')` with the caret in a word yields `[word]{color=#cc0000}`; calling it again with `null` yields `word`.
- With the caret inside a link, `setTextColor('#cc0000')` leaves the value unchanged.
- `$classifyContextMenuTarget` reports `underline: true` for a caret inside an underlined run.
- Every phase-1 corpus document lexes (through `lexMarkdown`) to top-level token types in `VIEWER_TOKENS`.

### Phase 2 — unit-testable

Viewer:

- `| a | b |\n| :--- {width=240} | --- |\n| 1 | 2 |` creates a `colgroup` with two `col` children, the first carrying `{ width: "240px" }`.
- The same source without any `{width=…}` creates **no** `colgroup`.
- `| a | b |\n| --- | --- |\n| d | << |` creates one `td` for the row, carrying `colspan="2"`.
- `| a | b |\n| --- | --- |\n| d | e |\n| ^^ | f |` creates a `td` for `d` carrying `rowspan="2"`, and the second row creates exactly one `td`.
- The 3×3 grid in `## Internal Structure` produces the cells and spans that table lists.
- `| a | b |\n| --- | --- |\n| ^^ | x |` (a `^^` in the first body row, with only a header above) creates an ordinary `td` whose text is `^^`.
- `| a | b |\n| --- | --- |\n| \<< | x |` creates an ordinary `td` whose text is the literal `<<`.

Editor:

- `| a | b |\n| :--- {width=240} | ---: |\n| 1 | 2 |` round-trips to a fixpoint, and the reloaded table's `colWidths` is `[240, 0]`.
- `| a | b |\n| --- | --- |\n| d | << |` round-trips to a fixpoint, and the imported table's first body row has one cell with `colSpan` 2.
- After importing a merged table, reading the value back emits the `<<` / `^^` markers again in the same positions.
- With a `TableSelection` spanning two cells (built through `$createTableSelectionFrom`, already imported by the test file), `mergeTableCells()` yields a value containing `<<`; `unmergeTableCell()` with the caret in the merged cell removes it again.
- `setTableColumnWidth(240)` with the caret in the first column yields `{width=240}` in the first delimiter cell; `setTableColumnWidth(null)` removes it.
- All three new commands on a fresh editor with no table do not throw.

### Phase 3 — unit-testable

Viewer:

- `::: {align=center}\ntext\n:::` creates a `div` whose applied style is `{ textAlign: "center" }`, containing a `p`.
- `::: {columns=2 gap=2em}\ntext\n:::` creates a `div` with `{ columnCount: "2", columnGap: "2em" }`.
- `::: {columns=9}\ntext\n:::` creates a `div` with no `columnCount` applied.
- The nested example in `## Internal Structure` creates two nested `div` elements, the inner one carrying `textAlign`.
- `extractMarkdownHeadings('::: {align=center}\n# T\n:::')` returns one heading with id `t`.
- An unclosed `::: {align=center}` with no matching `:::` renders as ordinary paragraphs and creates no `div`.

Editor:

- `TRANSFORMERS` has 14 entries.
- `::: {align=center}\ntext\n:::` and `::: {columns=2 gap=2em}\ntext\n:::` each round-trip to a fixpoint.
- `setBlockAlignment('center')` with the caret in a paragraph yields that paragraph wrapped in a fence carrying `align=center`.
- `setBlockAlignment(null)` with the caret inside a fence carrying only `align` removes the fence entirely, leaving the paragraph at the top level.
- `setColumnCount(2)` inside a fence that already carries `align=center` yields one fence carrying both attributes.
- `EDITOR_NODES` contains `MarkdownBlockNode`.

### Phase 4 — unit-testable

Viewer:

- `![Diagram](/img/d.png)` creates an `img` with `src="/img/d.png"` and `alt="Diagram"`.
- `![d](/img/d.png){width=320 height=200}` additionally sets `width="320"` and `height="200"`.
- `![d](javascript:alert(1))` creates **no** `img`.
- `![d](data:image/svg+xml;base64,PHN2)` creates **no** `img`.
- `![d](data:image/png;base64,iVBOR)` creates an `img`.

Editor:

- `TRANSFORMERS` has 15 entries and `EDITOR_NODES` contains `MarkdownImageNode`.
- `![d](/img/d.png){width=320}` round-trips to a fixpoint.
- `insertImage('/img/d.png', { alt: 'd', width: 320 })` on an empty editor yields exactly that Markdown.
- `insertImage('javascript:alert(1)')` leaves the value unchanged.

### Manual verification (browser required)

Lexical's `contenteditable` never attaches under the test harness, so everything below is verified by running `npm -w packages/lib run dev` and opening the **MD Editor** and **Markdown** panels. Run the list once per phase, for that phase's constructs.

- The editor's WYSIWYG surface and the viewer beside it render the same document: same underline weight, same colour, same font, same alignment, same column split, same table borders and merged-cell shapes, same image size.
- Selecting a word and choosing **Underline** from the right-click menu underlines it live, and the viewer follows.
- The **Text style ▸ Colour** submenu recolours the selection; **Default** clears it.
- Right-clicking inside a fence and choosing **Alignment ▸ Left** re-aligns the block; choosing it again with the same value leaves it unchanged.
- Dragging across two table cells and choosing **Merge cells** produces one wide cell in both surfaces; **Unmerge cell** restores them.
- **Column width…** with the caret in a column resizes that column in both surfaces.
- Switching to source mode shows the extension syntax verbatim; switching back reproduces the same rendering.
- Toggling the theme recolours the table borders and re-resolves the multi-column gap in both panels with no rebuild.
- A `data:` image and an `https:` image both render; a `javascript:` one renders nothing and logs no error.

---

## Verification

```bash
npm -w packages/lib run typecheck
npm -w packages/lib run lint
npm -w packages/lib run test
npm run build:lib
npm run docs:api              # must finish with zero warnings
npm run build:docs

# The seam rule stays absolute — the file must still be an empty array.
cat packages/lib/scripts/eslint/no-raw-dom.baseline.json

# Both halves of every construct changed together — none may be empty.
grep -c 'case "mdblock"'  packages/lib/src/typescript/lib/component/display/Markdown.ts
grep -c 'MarkdownBlockNode' packages/lib/src/typescript/lib/component/editor/editorNodes.ts

# The unmerge transform is gone, and no lexing site bypasses the extensions.
# (Markdown.ts keeps its type-only `import type { Token, Tokens } from "marked"`; only the
#  value import of `lexer` goes away, so grep for the call, not for the module name.)
grep -c 'lexer('  packages/lib/src/typescript/lib/component/display/Markdown.ts                                  # 0
grep -c "from 'marked'" packages/lib/tests/component/markdown-editor.test.ts                                     # 0
grep -c 'registerTableCellUnmergeTransform' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts   # 0
```

Then `npm -w packages/lib run dev` and walk the manual list.

---

## Documentation Impact

`Markdown` is exported from `@jimka/typescript-ui/component/display` and `MarkdownEditor` from `@jimka/typescript-ui/component/editor`. Every new method rides the existing `MarkdownEditor` export, so the only barrel change is the one new type name: step 33 adds `MarkdownBlockAlignment` to the `export type` list in [`component/editor/index.ts`](packages/lib/src/typescript/lib/component/editor/index.ts). No sidebar entry changes. The eight new modules are internal — none is re-exported from a package entry point.

The two doc pages are [`docs/components/Markdown.md`](packages/lib/docs/components/Markdown.md) and [`docs/components/MarkdownEditor.md`](packages/lib/docs/components/MarkdownEditor.md), both already in the components sidebar. `Markdown.md`'s security sentence is load-bearing and must be extended rather than left as-is: the no-`innerHTML` claim stays true, and the allow-list validation is the new half of the story.

Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) (*Don't `{@link}` internal symbols from public JSDoc*), the new public methods' JSDoc must not link `MarkdownBlockNode`, `MarkdownImageNode`, `resolveSpanStyle`, `lexMarkdown`, or any `@lexical/*` symbol — describe the behaviour in prose. `npm run docs:api` must finish with zero warnings.

[`packages/lib/llms.txt`](packages/lib/llms.txt) needs no regeneration: its entries derive from each class's summary sentence, and neither class's first sentence changes.

---

## Potential Challenges

- **Leaving `registerTableCellUnmergeTransform` registered.** It is a node transform, so it runs after every update and silently re-splits any merged cell. Step 17 removes it; if a merge test passes on import but fails after an unrelated edit, this is why.
- **A lexing site still on `marked`'s global `lexer`.** `extractMarkdownHeadings` is easy to miss, and so is the editor test's own import — either one silently parses with the unextended parser, so the parity guard would pass against a document the viewer cannot actually render. The two greps in `## Verification` cover both sides.
- **`no-raw-dom` firing on the new node files.** The rule's holding clause fires on any written type annotation naming a DOM type. Leave the `createDOM` return type and the `keepElement` parameter **unannotated**, and never write `as HTMLElement`.
- **`createViewElement` returning `null` offline.** Reconciliation only runs against a mounted root, and the seam's `mountView` returns `null` offline so no root is ever set — so `createDOM` is never reached under the test harness. If a test does hit the throw, the cause is a test that mounted a view, not a bug in the node.
- **`$convertFromMarkdownString` clears the node it converts into.** The block transformer must apply the fence's attributes to the scratch `MarkdownBlockNode` **after** converting its content, exactly as the table transformer sets the cell format after conversion ([`markdownTableTransformer.ts:219`](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L219)).
- **Corpus documents authored in non-canonical form.** The round-trip suite asserts the editor's first-pass output equals the authored source after normalising, so every corpus entry must be written exactly as the exporter emits it — one space either side of a table cell, `{key=value}` with no inner spaces around `=`.
- **`underlineStrikethrough` replacing both single classes.** Lexical applies the combined theme class instead of `underline` and `strikethrough` when both formats are on; without its rule an underlined-and-struck run renders with neither decoration in the editor while the viewer shows both.
- **Transformer order.** `STYLED_TEXT` must sit after `LINK` (both start with `[`), and `BLOCK` must sit before `TABLE` (a fence may wrap a table). Getting either backwards produces a construct that imports as literal text.
- **Ragged merge markers.** A `<<` in column 0 or a `^^` in row 0 has nothing to extend. Both halves must fall back to rendering it as literal cell text; a half that instead throws or drops the cell breaks parity on malformed input.
- **`marked` extension precedence.** Extension tokenizers run ahead of the built-ins, which is what lets `mdtable` replace the GFM table and `mdimage` replace the built-in image. An extension whose `start` is wrong lets the built-in win for some inputs only, producing an intermittent parity break.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts) — the token switch (1472), `appendInlineToken` (1738), `appendTable` (1580), `ensureMarkdownClassRules` (167), `alignmentClass` (318), `collectHeadings` (1902), and the two existing `DOM.sink.apply(..., { style })` sites (1105, 1121) that show inline styling on a raw handle is already the house pattern.
- [`packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts`](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts) — the model for every new editor-side parser: `handleImportAfterStartMatch` (167), the lazy `getTransformers` trick (161), and the set-format-after-convert ordering (219).
- [`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) — `ensureEditor` (1549), the command shape at `toggleStrikethrough` (1076) and `deleteTable` (1447), the seam-safe `mountView` call and its comment (679–683), the context-menu builders (1732, 1809, 1857, 1881), and `promptForLinkUrl` (1670).
- [`packages/lib/src/typescript/lib/component/editor/editorTheme.ts`](packages/lib/src/typescript/lib/component/editor/editorTheme.ts) — the class-rule and theme-map shape, and the comment at line 6 stating that the two components replicate rather than share their selectors while sharing theme tokens.
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) — `ElementPatch` (133), `applyPatchTo` (340), and `mountView` (860 / 1922), the escape the new primitive mirrors.
- [`packages/lib/scripts/eslint/no-raw-dom.js`](packages/lib/scripts/eslint/no-raw-dom.js) — the holding clause (its `TSTypeReference` visitor) that decides what the new node files may and may not annotate.
- [`packages/lib/tests/component/markdown-editor.test.ts`](packages/lib/tests/component/markdown-editor.test.ts) — `CORPUS` (48), `VIEWER_TOKENS` (68), the transformer count (154), and `$createTableSelectionFrom` (already imported at line 15) for the merge tests.
- [`packages/lib/tests/component/display/Markdown.test.ts`](packages/lib/tests/component/display/Markdown.test.ts) — the `createdTags` / `textWrites` / `attrWrites` / `classWrites` helpers (27–67) every new viewer assertion reuses; a `styleWrites()` helper in the same shape is needed for the style assertions.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the DOM seam, `StyleRule` writes, named listener functions.
- [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md) — the `{@link}` restriction the docs build enforces.

---

## Non-Goals

- **Raw HTML passthrough in either half, and an HTML persisted format.** Both would require the viewer to parse and sanitise HTML, replacing a design whose safety comes from never having a markup path at all.
- **Background colour and text highlight.** Not requested, and each needs its own attribute key and contrast decision.
- **Per-cell widths and per-row heights.** A CSS table column takes one width for the whole column, so a per-cell width would be a promise the renderer cannot keep; `setTableColumnWidth` is per column for that reason. Row height has no Markdown home and no `@lexical/table` model beyond a raw pixel value.
- **Colour, font, or size on link text.** See *Colour, font, and size are refused inside a link*.
- **Image upload, drag-and-drop, or file embedding.** `insertImage` takes a URL (a `data:` URI included); acquiring one is the consumer's job.
- **A built-in toolbar.** `MarkdownEditor` ships no chrome by design; the demo panel's toolbar stays the consumer-wired example.
- **Column-break control and column balancing.** CSS `break-inside` / `column-fill` have no Markdown representation in this grammar.
- **Portability to foreign Markdown renderers.** See *The dialect grows an extension syntax*.
- **Nesting a `:::` fence inside a table cell.** A cell's content is imported through a single-line escape, which cannot carry a multi-line fence.

---

## Notes

[^parity-sources]: The four places are the dialect's source of truth. [`markdownTransformers.ts:25`](packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts#L25) describes the curated array as "the exact subset of Markdown the read-only `Markdown` viewer renders" and carries a transformer-to-viewer-token mapping symbol by symbol. [`editorTheme.ts:6`](packages/lib/src/typescript/lib/component/editor/editorTheme.ts#L6) states that the two components replicate rather than share their class rules, with the theme-token names as the shared contract. [`MarkdownEditor.ts:697`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L697) repeats the contract in the class docblock, and [`docs/components/MarkdownEditor.md:5`](packages/lib/docs/components/MarkdownEditor.md#L5) states it for consumers. The test file guards it mechanically: `VIEWER_TOKENS` at [`markdown-editor.test.ts:68`](packages/lib/tests/component/markdown-editor.test.ts#L68) asserts the editor's output lexes only to token types the viewer handles.

[^why-not-html]: Three serialisation strategies were considered. **(a) Markdown with embedded raw HTML.** The viewer has no HTML path at all: `marked`'s `html` tokens fall through `appendBlockToken`'s `default` arm ([`Markdown.ts:1484`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1484)) to a plain text node, and the class docblock at line 486 states the guarantee that follows — "There is no HTML-string assignment path, so untrusted Markdown can never inject markup." Supporting embedded HTML means writing an HTML parser and a sanitiser inside the viewer and reversing that guarantee, and on the editor side it means adding `@lexical/html` plus a `DOMParser` call, which the `no-raw-dom` rule forbids outright. **(b) Switching the persisted format to HTML.** Strictly worse: the same viewer-side parser is needed, plus `getValue()` stops being a Markdown string, plus the source-mode `CodeEditor` is configured for `language: "markdown"`. **(c) An extension syntax with a matching parser on each side.** Both halves already own a hand-written parser for a construct Lexical's presets do not cover — the editor's `markdownTableTransformer.ts` and the viewer's token walk — so this is the shape the codebase already uses, it keeps the no-markup guarantee, it keeps every value a validated scalar rather than arbitrary markup, and it keeps the whole pipeline testable offline against the recording sink. (c) is chosen.

[^phasing]: Splitting a *feature* across releases would ship a construct one half cannot render, which is the data-loss bug the parity rule exists to prevent — so each phase carries both halves. Splitting *features* across phases is safe, because a phase that has not landed simply has no syntax to misread. The order is chosen so each phase's prerequisites already exist: phases 1 and 2 need no new node class and no framework change; phase 3 introduces the DOM-seam primitive and the first custom node; phase 4 reuses both. Phases 1 and 2 are independent of each other and could swap.

[^seam-need]: The `local/no-raw-dom` ESLint rule is type-aware with an **empty** baseline ([`no-raw-dom.baseline.json`](packages/lib/scripts/eslint/no-raw-dom.baseline.json) is `[]`), so any raw DOM access — or any written annotation naming `Element` / `Node` / `HTMLElement` — outside `core/DOM.ts` is a build error. A Lexical node's `createDOM` must return a real element, which every existing custom-node example builds with `document.createElement`. No node class in the library hits this today because every Lexical node in use comes from `@lexical/*` in `node_modules`, which is not linted. The rule's holding clause fires only on `TSTypeReference` nodes, so an unannotated return type and an unannotated factory parameter are both clean — which is exactly the technique `WysiwygSurface.mount` already documents at [`MarkdownEditor.ts:679`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L679).

[^syntax-choice]: The markers are chosen to be unclaimed by CommonMark and GFM, so no existing document changes meaning. `++text++` is free (`markdown-it-ins` uses it for `<ins>`, so it already reads as "extra emphasis"); `__text__` was rejected because `marked` parses it as `<strong>`, which would make the editor and viewer disagree on ordinary GFM input. `[text]{…}` and `::: {…}` are Pandoc's bracketed-span and fenced-div shapes. `<<` / `^^` for merge continuations follow `markdown-it-multimd-table`'s `^^` convention; its companion convention for a column span is an empty cell, which this dialect cannot use because [`splitTableRow`](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L39) trims every cell and so cannot distinguish an intentionally empty cell from a continuation — hence the explicit `<<`.

[^portability]: The alternative is to keep every construct expressible in portable Markdown, which is impossible for colour, font, size, alignment, columns, sized images, and merged cells — none has a CommonMark or GFM syntax, which is why this plan exists. Degradation is graceful in every case: a foreign renderer shows the markers as text and injects nothing. The one construct that degrades badly is a delimiter row carrying `{width=…}`, which a foreign GFM parser rejects, turning that table into paragraphs.

[^shared-grammar]: The alternative is duplicating the grammar in each half, which is what the existing `CELL_LINE_BREAK` constant does ([`Markdown.ts:47`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L47) mirrors `escapeCellText`, with a comment on each side pointing at the other). Duplicating a constant is cheap; duplicating a validating parser is a parity bug waiting to happen, since the two copies decide independently whether a value is safe. The module sits under `component/display/` because the viewer is where the dialect's rendering is defined and the editor conforms to it; the editor importing one file by path pulls in only that file, not the display barrel — the same reason `Markdown.ts` reaches `CodeEditor` through a narrow dynamic import rather than a barrel. Validating on the editor's *import* path matters as much as on the viewer's: a pasted document's values reach `TextNode.setStyle`, which Lexical writes straight onto the live DOM.

[^scoped-marked]: `marked`'s module-level `use()` mutates the shared default instance, which would change parsing for any consumer that also imports `marked` in the same bundle. A `new Marked({ extensions })` instance is scoped to this module. The lexing sites are few and enumerable — three in `Markdown.ts` and one in the editor test — and the test's import matters as much as the source's: if the parity guard lexes with the unextended parser, it certifies documents the viewer cannot actually render.

[^seam-shape]: `mountView(handle, factory)` already exists for a foreign live widget that is handed an existing parent element — CodeMirror's `EditorView` and Lexical's root both use it. A Lexical node is the other half of the same problem: the widget *creates* its element rather than being given one. `createViewElement` therefore takes a tag and an `ElementPatch` instead of a handle, applies the patch through the same `applyPatchTo` the batched `apply` path uses, and hands the element to a factory — so the call site still never touches the element. It returns `null` offline for exactly the reason `mountView` does, and the recording sink's implementation carries the same docblock.

[^one-container]: The alternative is two mechanisms — native `ElementNode` alignment plus a custom node for columns — which needs two transformers, two viewer arms, and two sets of round-trip tests for constructs that are visually and structurally the same thing (a region of blocks carrying presentation attributes). One container also composes for free: `::: {columns=2 align=justify}` is one node with two attributes rather than a wrapper inside a wrapper.

[^why-not-element-format]: Lexical's native `ElementNode.setFormat("center")` is the obvious model, and it is what table-cell alignment already uses. It does not survive Markdown export here: `@lexical/markdown` gives an `ElementTransformer` exactly one hook per node, whose `traverseChildren` argument exports the node's *inline* children — so an aligned-heading transformer would have to reconstruct the `# ` prefix (and the `- `, the `> `, and the fence) that the heading, list, quote, and code transformers already own. The container node sidesteps that entirely, because `$convertToMarkdownString(transformers, node)` exports a whole subtree at block level — the call the table transformer already makes for a cell's contents at [`markdownTableTransformer.ts:249`](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L249). The cost is that alignment is a wrap/unwrap operation rather than a flag, which `setBlockAlignment` absorbs.

[^no-style-in-link]: If the state were allowed, it would export as `[[red]{color=#cc0000}](https://x)`, whose import depends on how `LINK`'s lazy `\[(.+?)\]\(` regex backtracks over the inner brackets — behaviour this plan cannot pin down without building it. Refusing the state at the command is a one-line guard that removes the risk entirely, and the state is otherwise unreachable: the import side never produces it either, because `LINK` consumes `[…](…)` before `STYLED_TEXT` sees it. The user-visible cost is that a link's text cannot be recoloured, which is minor next to a silently corrupted round trip.

[^no-toolbar]: [`docs/components/MarkdownEditor.md:62`](packages/lib/docs/components/MarkdownEditor.md#L62) states the component's position: "There is no built-in toolbar in v1. Formatting is invoked four ways" — Markdown-shortcut typing, keyboard shortcuts, the command API, and the right-click menu. This plan adds to the third and fourth and leaves the position unchanged, so the level of UI detail here matches the sibling plans that added the context menu and the table commands.

[^unmerge-removal]: The transform was added deliberately, and the plan that added it recorded why: GFM cannot express `colspan` or `rowspan`, so a merge arriving by paste would be unrepresentable on export. This plan gives merges a representation, which removes the reason. The `Non-Goals` entry in `plans/implemented/markdown-tables.md` that reads "Merged cells. GFM cannot express `colspan` or `rowspan`…" is superseded by this plan and needs no edit — an implemented plan is a record of what was done, not a live constraint.

[^table-extension]: `marked`'s GFM table tokenizer requires every delimiter cell to match `:?-+:?`, so `:--- {width=240}` makes the whole block stop being a table — the viewer would render paragraphs while the editor still showed a grid, which is the exact failure the parity rule exists to catch. Three alternatives were rejected: a width attribute on the header cell (its `{…}` would render as visible text, since `marked` has already tokenised the cell's inline content by the time the viewer sees it); an attribute line above the table (whether `marked` lets a table interrupt a paragraph is version-dependent); and dropping column widths from scope (they were explicitly requested). Merged cells alone would not need the extension — `<<` and `^^` survive `marked`'s parser as ordinary cell text — but widths and merges land in one phase and one parser rather than being written twice.
