---
depends-on:
    - markdown-rich-formatting-extension
touches-shared:
    - packages/lib/src/typescript/lib/component/display/Markdown.ts
    - packages/lib/src/typescript/lib/component/display/markdownAttributes.ts
    - packages/lib/src/typescript/lib/component/display/markdownExtensions.ts
    - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
    - packages/lib/src/typescript/lib/component/editor/editorTheme.ts
    - packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts
    - packages/lib/src/typescript/lib/component/editor/markdownBlockTransformer.ts
    - packages/lib/tests/component/display/Markdown.test.ts
    - packages/lib/tests/component/markdown-editor.test.ts
    - packages/lib/docs/components/Markdown.md
    - packages/lib/docs/components/MarkdownEditor.md
---

# Explicit Column Regions in the Markdown Dialect — Implementation Plan

## Overview

The Markdown dialect's `:::` fence currently renders multiple columns with CSS `column-count`: [`Markdown.ts:1807`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1807) and [`markdownBlockNode.ts:177`](packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts#L177) both write a `columnCount` style onto one container element and let the browser decide where the text breaks. There is no per-column content model anywhere: [`MarkdownBlockNode`](packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts#L42) is one flat `ElementNode`, the editor imports the whole fence body as one sequence ([`markdownBlockTransformer.ts:82`](packages/lib/src/typescript/lib/component/editor/markdownBlockTransformer.ts#L82)), and the viewer lexes it as one sequence ([`markdownExtensions.ts:163`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L163)).

Browser auto-balancing breaks the dialect's hard rule that **the editor and the viewer render the same document identically**: the break point depends on the container's rendered height, so the editor's wide surface and the viewer's prose-width column split the same document in different places.[^reflow-parity] It also makes the feature unusable for its actual purpose — putting chosen content in a chosen column.

This plan replaces the auto-reflow with **explicit, independently-authored column regions**. A new in-fence separator line, `|||`, divides the fence body into sections; each section is parsed on its own and becomes one column. Both halves lay the columns out with flexbox instead of `column-count`, so a column's content is fixed by the source and no longer by the container's width.

---

## Architecture Decisions

### Columns are separated by a `|||` line inside the fence

A line whose trimmed form is exactly `|||` ends one column region and starts the next. It only counts at the fence's own level: inside a nested `:::` fence or inside a fenced code block it is ordinary content.[^separator-choice]

```markdown
::: columns
Left column, first paragraph.

Left column, second paragraph.
|||
Right column.
:::
```

| Line (trimmed) | In a code fence | Nested fence depth | Meaning |
|---|---|---|---|
| `\|\|\|` | no | 0 | ends this column; the next line starts the next column |
| `\|\|\|` | yes | 0 | ordinary content (a line of code) |
| `\|\|\|` | no | 1 | ordinary content (belongs to the nested fence) |
| a backslash, then `\|\|\|` | no | 0 | ordinary content; the backslash is dropped, leaving the literal marker as text |
| ` ``` ` | — | — | toggles the code-fence flag |
| `::: {align=center}` | no | — | opens a nested fence — depth + 1 |
| `:::` | no | — | closes a nested fence — depth − 1, floored at 0 |

### The number of columns is the number of sections; `columns=N` leaves the grammar

The `columns` attribute is deleted from the attribute grammar. A region's column count is structural — the sections in the source, the column child nodes in the editor — so the two can never disagree.[^no-count-attribute]

Because a two-column region often carries no attributes at all, and the fence scan in both halves refuses to open on a bare `:::`, the exporter writes the keyword `columns` in the opening line whenever a region has more than one column. The keyword is only there to make the opening line non-empty and self-describing; both parsers ignore it.

| Region | Opening line the exporter writes |
|---|---|
| 1 column, `align=center` | `::: {align=center}` |
| 2 columns, no attributes | `::: columns` |
| 3 columns, `align=center gap=3em` | `::: columns {align=center gap=3em}` |

### The editor gets a column node inside the block node

`MarkdownBlockNode` keeps its place as the fence's container, and its children become `MarkdownColumnNode`s — one per column, each holding that column's block content. This mirrors `@lexical/table`'s container-and-region shape (`TableNode` › `TableRowNode` › `TableCellNode`), and `MarkdownColumnNode` copies the four overrides `TableCellNode` uses to keep a region self-contained (`node_modules/@lexical/table/src/LexicalTableCellNode.ts`, lines 292–305): `isShadowRoot`, `canBeEmpty`, `canIndent`, `collapseAtStart`. The `@lexical/table` classes themselves are not reused.[^table-precedent]

### Both halves lay columns out with flexbox

The container is `display: flex` with the theme's column gap; each column is `flex: 1 1 0` with `min-width: 0`. Every column is an equal fraction of the container's width at any width, so the two halves agree.[^flex-choice] This is CSS inside the Markdown content subtree, not a framework `Component` layout, so ARCHITECTURE.md's "no `display: flex` on a `Component` to lay out its children" does not apply — the rule governs `Component` children placed by a `LayoutManager`, and every element here is a raw handle built by the viewer's render pass or by Lexical's reconciler.

### The section splitter lives in the one module both halves share

`splitColumnSections` and `joinColumnSections` go in [`markdownAttributes.ts`](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts), the dialect's single shared module. Both halves call the same function, so a split can never differ between them.[^shared-splitter]

### Changing the column count never destroys content

`setColumnCount` grows a region by appending empty columns and shrinks it by moving the surplus columns' content into the last column it keeps. The one exception is a column that is still exactly as `setColumnCount` created it — a single empty paragraph and nothing else — which is dropped instead of merged, so growing and then shrinking returns the original document.[^count-change]

| Before | Call | After |
|---|---|---|
| 2 columns `A` \| `B` | `setColumnCount(3)` | `A` \| `B` \| *(empty)* |
| 3 columns `A` \| `B` \| `C` | `setColumnCount(2)` | `A` \| `B` then `C` |
| 3 columns `A` \| `B` \| *(fresh empty)* | `setColumnCount(2)` | `A` \| `B` |
| 3 columns, `align=center` | `setColumnCount(1)` | one column `A` `B` `C`; the fence stays for its alignment |
| 2 columns, no alignment | `setColumnCount(null)` | the fence is removed; the blocks return to the top level |
| a plain paragraph | `setColumnCount(2)` | a new fence: the paragraph in column 1, an empty column 2 |

### No compatibility path for the old syntax

The multi-column feature exists only on the unmerged `feature/markdown-rich-formatting-extension` branch this plan builds on — `git log master -- packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts` is empty on both `master` and `origin/master` — so no published document can contain the old form. This plan adds no import path for `{columns=N}`; an old document degrades on its own, since an unrecognised attribute key is already dropped by `resolveBlockStyle` and a body with no `|||` is one column.

---

## Public API

The consumer-facing surface does not change shape. `MarkdownEditor.setColumnCount` keeps its signature and changes meaning:

```typescript
class MarkdownEditor extends Component<MarkdownEditorOptions> {
    /**
     * Sets the number of explicit column regions. Grows by appending empty
     * columns, shrinks by merging the surplus into the last column kept.
     * `count` is clamped to 1–6; `null` means one column. `gap` omitted
     * leaves the existing gap untouched; `null` clears it.
     */
    setColumnCount(count: number | null, gap?: string | null): this;
}
```

### `packages/lib/src/typescript/lib/component/display/markdownAttributes.ts` (internal)

```typescript
/** The line-level marker separating one column region from the next. */
export const COLUMN_SEPARATOR = "|||";

export function splitColumnSections(inner: string): string[];
export function joinColumnSections(sections: string[]): string;

export interface MarkdownBlockStyle {
    textAlign:  string | null;
    columnGap:  string | null;
}
```

`MarkdownBlockStyle.columnCount` is removed; `resolveBlockStyle` and `blockStyleToAttributes` lose their `columns` arm.

### `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` (internal)

```typescript
/** The `mdblock` token the fence extension emits — one token list per column. */
export interface MdBlockToken {
    type:       "mdblock";
    raw:        string;
    attributes: Record<string, string>;
    columns:    Token[][];
}
```

### `packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts` (internal)

```typescript
export class MarkdownColumnNode extends ElementNode {
    static getType(): string;                       // "markdown-column"
    static clone(node: MarkdownColumnNode): MarkdownColumnNode;
    static importJSON(json: SerializedElementNode): MarkdownColumnNode;

    exportJSON(): SerializedElementNode;
    createDOM(config: EditorConfig);                // return type inferred, never annotated
    updateDOM(): boolean;                           // always true
    isShadowRoot(): boolean;                        // true
    canBeEmpty(): false;
    canIndent(): false;
    collapseAtStart(): true;
}

export function $createMarkdownColumnNode(): MarkdownColumnNode;
export function $isMarkdownColumnNode(node: LexicalNode | null | undefined): node is MarkdownColumnNode;

export class MarkdownBlockNode extends ElementNode {
    /** This block's column children, in document order. */
    getColumns(): MarkdownColumnNode[];
    /** True when this block carries no alignment and holds a single column — nothing left to justify the fence. */
    canUnwrap(): boolean;
    // unchanged: getAlign / setAlign / getColumnGap / setColumnGap / toAttributes / exportJSON / createDOM / updateDOM
}
```

`getColumnCount` / `setColumnCount` / the `__columnCount` field / `SerializedMarkdownBlockNode.columnCount` / `isEmptyOfAttributes` are removed. `canUnwrap` replaces `isEmptyOfAttributes`.

---

## Internal Structure

### The section splitter (`markdownAttributes.ts`)

```typescript
export function splitColumnSections(inner: string): string[] {
    const sections: string[] = [];
    let current: string[] = [];
    let depth = 0;
    let inCode = false;

    for (const line of inner.split("\n")) {
        const trimmed = line.trim();

        if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
            inCode = !inCode;
        } else if (!inCode) {
            if (trimmed === ":::") {
                depth = Math.max(0, depth - 1);
            } else if (trimmed.startsWith(":::") && trimmed.slice(3).trim() !== "") {
                depth += 1;
            } else if (depth === 0 && trimmed === COLUMN_SEPARATOR) {
                sections.push(current.join("\n"));
                current = [];

                continue;
            }
        }

        current.push(line.replace(/^(\s*)\\\|\|\|$/, "$1|||"));
    }

    sections.push(current.join("\n"));

    return sections;
}
```

`joinColumnSections` is the inverse: it escapes any line whose trimmed form is exactly `|||` to `\|||`, then joins the sections with `\n|||\n`. Both directions are exercised by the same worked case:

```
splitColumnSections("A\n|||\nB")        // -> ["A", "B"]
splitColumnSections("A\n\\|||\nB")      // -> ["A\n|||\nB"]      (one column)
splitColumnSections("")                 // -> [""]               (one empty column)
joinColumnSections(["A", "B"])          // -> "A\n|||\nB"
joinColumnSections(["|||"])             // -> "\\|||"
```

`splitColumnSections` always returns at least one section, so a fence always has at least one column.

### `MarkdownColumnNode.createDOM` (`markdownBlockNode.ts`)

The same seam-safe shape `MarkdownBlockNode` already uses — the module's existing `keepElement` factory, and no written DOM type anywhere:

```typescript
createDOM(config: EditorConfig) {
    const element = DOM.sink.createViewElement("div", {
        addClass: config.theme.mdColumn ? [config.theme.mdColumn] : [],
    }, keepElement);

    if (element === null) {
        throw new Error("MarkdownColumnNode.createDOM requires a mounted view");
    }

    return element;
}
```

`MarkdownBlockNode.createDOM`'s style patch loses its `columnCount` entry and becomes `{ textAlign: style.textAlign, columnGap: style.columnGap }`.

### The fence transformer (`markdownBlockTransformer.ts`)

Import, once the closing line has been found (the depth scan at lines 53–77 is unchanged):

```typescript
const inner = lines.slice(startLineIndex + 1, closingLineIndex).join("\n");
const style = resolveBlockStyle(parseAttributes(extractFenceAttributeText(openingRemainder)));
const block = $createMarkdownBlockNode();

block.setAlign(style.textAlign);
block.setColumnGap(style.columnGap);

for (const section of splitColumnSections(inner)) {
    const column = $createMarkdownColumnNode();

    // Converts into a detached column, then appends it — the same order the
    // table transformer uses for a cell, since the conversion clears the node
    // it converts into.
    $convertFromMarkdownString(section, getTransformers(), column);
    block.append(column);
}

rootNode.append(block);
```

An empty section converts to a single empty paragraph, which is what makes an empty column a real, clickable region.

Export walks the columns itself, exactly as the table transformer walks rows and cells:

```typescript
export: (node) => {
    if (!$isMarkdownBlockNode(node)) {
        return null;
    }

    const columns = node.getColumns();

    // A block with no column children is malformed; declining lets the default
    // child export preserve its content instead of dropping it.
    if (columns.length === 0) {
        return null;
    }

    const attributes = node.toAttributes();
    const opening = ":::"
        + (columns.length > 1 ? " columns" : "")
        + (Object.keys(attributes).length === 0 ? "" : ` {${formatAttributes(attributes)}}`);
    const body = joinColumnSections(
        columns.map((column) => $convertToMarkdownString(getTransformers(), column)));

    return `${opening}\n${body}\n:::`;
}
```

### The column-count command (`MarkdownEditor.ts`)

```typescript
/** The most columns `setColumnCount` will build — beyond this a region is unreadable at any prose width. */
const MAX_COLUMN_COUNT = 6;

/**
 * Grows or shrinks `block` to `target` columns, per the table in
 * `## Architecture Decisions`. Assumes `target` is already clamped.
 */
function $setBlockColumnCount(block: MarkdownBlockNode, target: number): void {
    const columns = block.getColumns();

    for (let index = columns.length; index < target; index += 1) {
        const column = $createMarkdownColumnNode();

        column.append($createParagraphNode());
        block.append(column);
    }

    const keep = columns[target - 1];

    for (let index = target; index < columns.length; index += 1) {
        const surplus = columns[index]!;
        const only = surplus.getFirstChild();
        const isUntouched = surplus.getChildrenSize() === 1
            && $isParagraphNode(only) && only.getChildrenSize() === 0;

        if (!isUntouched && keep !== undefined) {
            for (const child of surplus.getChildren()) {
                keep.append(child);
            }
        }

        surplus.remove();
    }
}
```

`setColumnCount` itself resolves the target, finds or creates the block, applies the count, applies `gap` only when the argument was passed, and unwraps when `canUnwrap()`:

```typescript
setColumnCount(count: number | null, gap?: string | null): this {
    const target = Math.max(1, Math.min(count ?? 1, MAX_COLUMN_COUNT));

    this.ensureEditor().update(() => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection)) {
            return;
        }

        const existing = $findMatchingParent(selection.anchor.getNode(), $isMarkdownBlockNode);
        const block = existing ?? (target > 1 ? $wrapSelectedTopLevelBlocks() : null);

        if (block === null) {
            return;
        }

        $setBlockColumnCount(block, target);

        if (gap !== undefined) {
            block.setColumnGap(gap);
        }

        if (block.canUnwrap()) {
            $unwrapMarkdownBlock(block);
        }
    }, { discrete: true });

    return this;
}
```

`$unwrapMarkdownBlock(block)` is a new module-level helper holding the move-children-out-then-remove body that `setBlockAlignment` and `setColumnCount` currently duplicate inline. It moves the children of the block's **columns**, not of the block itself — `canUnwrap()` means there is at most one column, and the loop keeps the helper correct for a malformed block with more:

```typescript
function $unwrapMarkdownBlock(block: MarkdownBlockNode): void {
    for (const column of block.getColumns()) {
        for (const child of column.getChildren()) {
            block.insertBefore(child);
        }
    }

    block.remove();
}
```

`$wrapSelectedTopLevelBlocks` (line 276) changes only in where it puts the wrapped blocks: it creates the block, creates one column, appends the run of top-level blocks into the **column**, and appends the column to the block.

### The viewer's fence extension and render arm

`BLOCK_EXTENSION.tokenizer` keeps its depth scan and replaces its single `this.lexer.blockTokens(inner)` call with one per section:

```typescript
return {
    type:       "mdblock",
    raw,
    attributes: parseAttributes(extractFenceAttributeText(openingRemainder)),
    columns:    splitColumnSections(inner).map((section) => this.lexer.blockTokens(section)),
} satisfies MdBlockToken;
```

`Markdown.appendBlock` builds the container, then one `<div class="ts-ui-md-column">` per column:

```typescript
private appendBlock(parent: Handle, token: MdBlockToken, headingIds: Map<string, number>): void {
    const block = this.create("div");
    const style = resolveBlockStyle(token.attributes);

    DOM.sink.apply(block, {
        addClass: [BLOCK_CLASS],
        style:    { textAlign: style.textAlign, columnGap: style.columnGap },
    });

    for (const columnTokens of token.columns) {
        const column = this.create("div");

        DOM.sink.apply(column, { addClass: [COLUMN_CLASS] });
        this.appendBlockTokens(column, columnTokens, headingIds);
        DOM.sink.appendChild(block, column);
    }

    DOM.sink.appendChild(parent, block);
}
```

### The class rules (both halves, same declarations)

| Selector | Declarations |
|---|---|
| `.ts-ui-md-block` / `.ts-ui-mde-block` | `display: flex`, `margin: 1em 0`, `columnGap: var(--ts-ui-md-column-gap, 2em)` |
| `.ts-ui-md-column` / `.ts-ui-mde-column` | `flex: 1 1 0`, `minWidth: 0` |
| `.ts-ui-md-block > .ts-ui-md-column > :first-child` | `marginTop: 0` |

`min-width: 0` is required: a flex item's default `min-width: auto` lets one long unbreakable token (a URL, a wide code line) push its column past its share and squeeze the others. The first-child rule keeps its existing purpose — a column is a flex item and therefore a formatting-context root, so its first block's top margin no longer collapses out and every column's first line would otherwise start one margin below the fence's top edge — with the selector moved one level down.

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/component/display/markdownAttributes.ts`** — add `COLUMN_SEPARATOR`, `splitColumnSections`, `joinColumnSections` per `## Internal Structure`. Extend the module docblock: it now owns the dialect's shared *line-level* grammar as well as the `{key=value}` attribute grammar.
2. Same file — delete the `COLUMN_COUNT` regexp (line 48), drop `columnCount` from `MarkdownBlockStyle` (line 62), drop the `columns` arm from `resolveBlockStyle` (line 240) and from `blockStyleToAttributes` (line 259).
   - Check: `grep -c 'columnCount\|COLUMN_COUNT' packages/lib/src/typescript/lib/component/display/markdownAttributes.ts` — expect zero.
3. **`packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts`** — add `MarkdownColumnNode`, `$createMarkdownColumnNode`, `$isMarkdownColumnNode` per `## Public API`, above `MarkdownBlockNode`. It shares the file's existing `keepElement` factory.[^one-file]
4. Same file — on `MarkdownBlockNode`: delete `__columnCount`, `getColumnCount`, `setColumnCount`, and `columnCount` from `SerializedMarkdownBlockNode`, `clone`, `importJSON`, `exportJSON` and `toAttributes`; add `getColumns()`; replace `isEmptyOfAttributes()` with `canUnwrap()` (`getAlign() === null && getColumns().length <= 1`); drop `columnCount` from the `createDOM` style patch.
5. **`packages/lib/src/typescript/lib/component/editor/editorNodes.ts`** — append `MarkdownColumnNode` to `EDITOR_NODES` (line 27) and name it in the docblock beside `MarkdownBlockNode`.
6. **`packages/lib/src/typescript/lib/component/editor/editorTheme.ts`** — add `COLUMN_CLASS = "ts-ui-mde-column"` beside `BLOCK_CLASS` (line 27); add `display: "flex"` to the `BLOCK_CLASS` rule (line 210) and a `COLUMN_CLASS` rule per `## Internal Structure`; retarget the `.${BLOCK_CLASS} > :first-child` selector rule (line 222) to `.${BLOCK_CLASS} > .${COLUMN_CLASS} > :first-child` and rewrite its comment for the flex-item cause; add `mdColumn: COLUMN_CLASS` to `EDITOR_THEME` (line 288).
7. Same file — rewrite the `TABLE_CLASS` rule's `breakInside` comment (line 162): the declaration stays, but its stated reason (a fence's multi-column flow slicing the table) no longer exists, so the comment must instead describe a general page/column fragmentation guard.
8. **`packages/lib/src/typescript/lib/component/editor/markdownBlockTransformer.ts`** — rewrite `handleImportAfterStartMatch`'s tail and `export` per `## Internal Structure`; import `splitColumnSections` / `joinColumnSections` from `markdownAttributes.js` and `$createMarkdownColumnNode` from `markdownBlockNode.js`; add `MarkdownColumnNode` to the transformer's `dependencies` array (line 40). Update the file docblock to describe column regions.
9. **`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`** — add `$unwrapMarkdownBlock` and `$setBlockColumnCount` as module-level helpers beside `$wrapSelectedTopLevelBlocks` (line 276), and change `$wrapSelectedTopLevelBlocks` to append the wrapped blocks into a new column rather than into the block. Add the `MAX_COLUMN_COUNT` constant beside them.
10. Same file — rewrite `setColumnCount` (line 1549) per `## Internal Structure`, and change `setBlockAlignment` (line 1506) to call `$unwrapMarkdownBlock` and `canUnwrap()` in place of its inline unwrap loop and `isEmptyOfAttributes()`. Update both methods' JSDoc.
11. Same file — extract the `"Columns"` submenu (line 2386) into a private `buildColumnsMenuItem(): MenuItemConfig` beside `buildTextStyleMenuItem` (line 2213), keeping the 2/3/4/None presets; call it from `buildEmptyLineContextMenuItems` (line 2377) where the literal was, and add the same call to `buildTextContextMenuItems` (line 2314) directly after the `"Alignment"` submenu, so the count can be changed from inside a populated column.
12. Same file — update the class docblock's dialect sentence (around line 794) where it names `setColumnCount`.
13. **`packages/lib/src/typescript/lib/component/display/markdownExtensions.ts`** — export the `MdBlockToken` interface and rewrite `BLOCK_EXTENSION.tokenizer`'s return per `## Internal Structure`, importing `splitColumnSections`. Update the extension's docblock to describe the `|||` split.
14. **`packages/lib/src/typescript/lib/component/display/Markdown.ts`** — add `COLUMN_CLASS = "ts-ui-md-column"` beside `BLOCK_CLASS` (line 43); add `display: "flex"` to the `BLOCK_CLASS` rule (line 333) and a `COLUMN_CLASS` rule; retarget the `.${BLOCK_CLASS} > :first-child` rule (line 345) to `.${BLOCK_CLASS} > .${COLUMN_CLASS} > :first-child` with the flex-item comment; rewrite the `TABLE_CLASS` `breakInside` comment the same way step 7 does for the editor.
15. Same file — import `MdBlockToken` from `markdownExtensions.js`, retype the `case "mdblock"` arm (line 1580) to `token as MdBlockToken`, rewrite `appendBlock` (line 1807) per `## Internal Structure`, and change `collectHeadings`' `mdblock` branch (line 2130) to walk every entry of `token.columns` in order.
    - Check: `grep -c 'columnCount' packages/lib/src/typescript/lib/component/display/Markdown.ts` — expect zero.
16. **`packages/lib/src/typescript/lib/core/themes/BaseTheme.ts`** (line 32) and **`packages/lib/src/typescript/lib/core/Theme.ts`** (line 706) — update the two comments that describe the token as the gutter of a `::: {columns=…}` region; the token name and value are unchanged.
17. **`packages/lib/tests/component/markdown-editor.test.ts`** — replace the `'block columns'` corpus entry (line 71) with `'::: columns\nLeft\n|||\nRight\n:::'`, import `MarkdownColumnNode`, and add the editor cases from `## Expected Behaviour` to the `MarkdownEditor block alignment / columns` suite (line 1367).
18. **`packages/lib/tests/component/display/Markdown.test.ts`** — update the `Markdown block fence (alignment / columns)` suite (line 381) for the new DOM: `divHandles` now returns the container plus one div per column, so its existing assertions must index the container and its columns explicitly. Add the viewer cases from `## Expected Behaviour`, plus the splitter cases as their own `describe`, importing `splitColumnSections` / `joinColumnSections` from `markdownAttributes` (the shared module has no test file of its own, and it lives under `component/display/`).
19. **`packages/lib/tests/component/display/Markdown.multicolumn.test.ts`** and **`packages/lib/tests/component/editorTheme.multicolumn.test.ts`** — retarget both: rewrite the header comments (the CSS-fragmentation defects they describe no longer exist) and assert the new declarations — `display: flex` on the block rule, `flex`/`minWidth` on the column rule, and `marginTop: 0` on the `> .ts-ui-md-column > :first-child` / `> .ts-ui-mde-column > :first-child` selector. Keep both files: each is the only place in its module's lifetime where the guarded singleton class-rule writes are recorded.
    - Check: `npm -w packages/lib run test` — green.
20. **`packages/lib/docs/components/Markdown.md`** — update the syntax-table row (line 62) and the `### Extension syntax` prose (line 118) to describe `:::` … `|||` … `:::` explicit column regions; add a worked example and state that a `|||` line inside a nested fence or a code block is ordinary content, and that a literal `|||` line escapes as `\|||`.
21. **`packages/lib/docs/components/MarkdownEditor.md`** — update the dialect sentence (line 5), the construct-table row (line 61), the context-menu paragraph (the Columns submenu is now on the text menu too), and the `setColumnCount` row of the command table with the grow/shrink rules.
22. **`packages/lib/src/typescript/MarkdownPanel.ts`** (line 78) and **`packages/lib/src/typescript/MarkdownEditorPanel.ts`** (`SAMPLE`, line 33 onward) — rewrite the fence samples to the new syntax, with distinct per-column content that makes a mis-split obvious at a glance. `MarkdownEditorPanel` gains a two-column fence beside its existing centred one.
    - Check: `grep -rn '{columns=' packages/lib/` — expect zero.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/markdownAttributes.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownBlockTransformer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorNodes.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Theme.ts` |
| Modify | `packages/lib/src/typescript/lib/core/themes/BaseTheme.ts` |
| Modify | `packages/lib/src/typescript/MarkdownPanel.ts` |
| Modify | `packages/lib/src/typescript/MarkdownEditorPanel.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.multicolumn.test.ts` |
| Modify | `packages/lib/tests/component/editorTheme.multicolumn.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |

---

## Expected Behaviour

### Splitter — unit-testable in `Markdown.test.ts`, calling the exported functions directly

- `splitColumnSections("A\n|||\nB")` is `["A", "B"]`.
- `splitColumnSections("")` is `[""]`.
- `splitColumnSections("A\n\\|||\nB")` is `["A\n|||\nB"]` — one section, the escape removed.
- `joinColumnSections(["A", "B"])` is `"A\n|||\nB"`; `joinColumnSections(["|||"])` is `"\\|||"`.

### Viewer — unit-testable in `Markdown.test.ts`

- `::: columns\nA\n|||\nB\n:::` creates one `.ts-ui-md-block` div holding exactly two `.ts-ui-md-column` divs, the first containing a `p` with `A` and the second a `p` with `B`.
- `::: {align=center}\ntext\n:::` creates one block div with the applied style `{ textAlign: "center" }`, holding exactly one column div, holding one `p`.
- `::: columns {gap=3em}\nA\n|||\nB\n:::` applies `{ columnGap: "3em" }` to the block div, and nothing to the column divs.
- `::: columns {gap=3}\nA\n|||\nB\n:::` (no unit) applies no style to the block div.
- No render of any fence applies a `columnCount` style to any element.
- `::: columns\n\`\`\`\n|||\n\`\`\`\n|||\nB\n:::` creates two columns; the first holds a `pre` whose text is `|||`.
- A fence nested inside a column keeps its own separators: `::: columns\nA\n\n::: columns\nInner one\n|||\nInner two\n:::\n\n|||\nB\n:::` creates an outer block with two columns, and the first outer column contains a nested block with two columns.
- `::: columns\n\\|||\n|||\nB\n:::` creates two columns; the first holds a `p` whose text is `|||`.
- `extractMarkdownHeadings('::: columns\n# A\n|||\n# B\n:::')` returns both headings, in column order.
- An unclosed `::: columns` with no matching `:::` renders as ordinary paragraphs and creates no block div (unchanged).
- The old form `::: {columns=2}\ntext\n:::` creates one block div with **one** column and no applied style — the attribute is simply unrecognised.

### Editor — unit-testable in `markdown-editor.test.ts`

- `EDITOR_NODES` contains `MarkdownColumnNode`.
- `TRANSFORMERS` still has 15 entries — this plan adds no transformer.
- These documents round-trip to a fixpoint: `::: columns\nLeft\n|||\nRight\n:::`, `::: columns {align=center}\nA\n|||\nB\n:::`, `::: {align=center}\ntext\n:::`.
- `setColumnCount(2)` with the caret in a lone `hello world` paragraph yields `::: columns\nhello world\n|||\n\n:::`, and the root holds a single `markdown-block` child.
- `setColumnCount(3)` inside a two-column region appends a third column and leaves both existing columns' text unchanged.
- `setColumnCount(2)` inside a three-column region `A` / `B` / `C` yields two columns, the second holding `B` followed by `C`.
- `setColumnCount(3)` then `setColumnCount(2)` on a two-column region returns the original value exactly — the untouched column is dropped, not merged.
- `setColumnCount(1)` inside a region carrying `align=center` yields one column holding every block in order, with the fence and its `align=center` intact.
- `setColumnCount(null)` inside a two-column region with no alignment removes the fence; the root's children are the columns' blocks in order.
- `setColumnCount(2, '3em')` writes `gap=3em`; a following `setColumnCount(3)` keeps `gap=3em`; `setColumnCount(3, null)` removes it.
- `setColumnCount(99)` produces six columns.
- `setBlockAlignment('center')` on a lone paragraph yields `::: {align=center}\nhello world\n:::` — one column, no `columns` keyword.
- `setBlockAlignment(null)` inside a two-column region keeps the fence and yields the `::: columns` opener.
- `setBlockType('quote')` with the caret in a column's paragraph converts that paragraph only, leaving the fence and the other column untouched.
- `setColumnCount` / `setBlockAlignment` on a fresh editor with no selection do not throw.
- Every corpus document still lexes, through `lexMarkdown`, to top-level token types in `VIEWER_TOKENS`.

### Manual verification (browser required)

Lexical's `contenteditable` never attaches under the test harness, so these run against `npm -w packages/lib run dev`, in the **MD Editor** and **Markdown** panels.

- The editor and the viewer show the same content in the same column, and dragging the split between them to change either surface's width never moves content from one column to another. This is the defect the plan exists to fix.
- Typing into column 2 leaves column 1 unchanged, at any width.
- Backspace at the very start of column 2's first paragraph does not pull that paragraph into column 1.
- Enter at the end of a column's last paragraph adds a paragraph inside that same column.
- Right-clicking a word inside a column offers **Columns**; choosing **3 columns** adds an empty third column that can be clicked into and typed in.
- Choosing **Columns ▸ None** in a region with no alignment removes the fence and leaves the prose in document order.
- Toggling the theme re-resolves the column gutter in both panels with no rebuild.

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

# The CSS reflow model is gone from both halves.
grep -c 'columnCount' packages/lib/src/typescript/lib/component/display/Markdown.ts          # 0
grep -c 'columnCount' packages/lib/src/typescript/lib/component/display/markdownAttributes.ts # 0
grep -c 'columnCount' packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts   # 0

# No stale old-syntax fence anywhere in the package (source, docs, tests, demos).
grep -rn '{columns=' packages/lib/                                                            # 0

# Both halves gained the column region together — neither may be empty.
grep -c 'ts-ui-md-column'  packages/lib/src/typescript/lib/component/display/Markdown.ts
grep -c 'ts-ui-mde-column' packages/lib/src/typescript/lib/component/editor/editorTheme.ts
grep -c 'MarkdownColumnNode' packages/lib/src/typescript/lib/component/editor/editorNodes.ts
```

Then `npm -w packages/lib run dev` and walk the manual list.

---

## Documentation Impact

No export surface changes: `MarkdownColumnNode` is internal like `MarkdownBlockNode`, no barrel entry moves, and `MarkdownEditor.setColumnCount` keeps its signature. The two doc pages [`docs/components/Markdown.md`](packages/lib/docs/components/Markdown.md) and [`docs/components/MarkdownEditor.md`](packages/lib/docs/components/MarkdownEditor.md) are already in the components sidebar and need the content changes in steps 20–21.

Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) (*Don't `{@link}` internal symbols from public JSDoc*), `setColumnCount`'s rewritten JSDoc must describe the grow/shrink behaviour in prose and must not link `MarkdownColumnNode`, `splitColumnSections`, or any `@lexical/*` symbol. `npm run docs:api` must finish with zero warnings.

[`packages/lib/llms.txt`](packages/lib/llms.txt) needs no regeneration — its entries derive from each class's summary sentence, and neither class's first sentence changes.

---

## Potential Challenges

- **Editing one half only.** The split rule, the class declarations, and the DOM shape all exist twice by design. The `grep -c` pairs in `## Verification` are what catch a half-applied change.
- **A `|||` line in a fenced code block.** The splitter tracks code fences for exactly this; a `:::` line inside a code block still breaks the enclosing fence, which is pre-existing behaviour this plan does not change (see `## Non-Goals`).
- **Forgetting `min-width: 0`.** Without it, one long unbreakable token silently widens its column and squeezes the rest — and only at some widths, which reads as a layout bug rather than a missing declaration.
- **The `mdColumn` theme key.** `EditorThemeClasses` carries an index signature for custom keys; `config.theme.mdColumn` is `undefined` if step 6 is missed, and `createDOM` then silently produces an unstyled column that still lays out as a plain block.
- **Stale `divHandles` assertions.** `Markdown.test.ts`'s block-fence suite counts `<div>` handles; every fence now produces one more div than it has columns, so an un-updated assertion fails with a confusing count.
- **A block node with no column children.** The export declines rather than emitting a fence, so the content falls through to the default child export instead of being dropped — mirroring the table transformer's own zero-rows guard.
- **Canonical export form.** Round-trip tests compare against the exporter's exact output: the `columns` keyword appears only for more than one column, `{…}` only when an attribute is set, and a trailing empty column leaves a blank line before the closing `:::`.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts`](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts) — the model this plan follows for a container-of-regions transformer: `handleImportAfterStartMatch` (241), the per-region `$convertFromMarkdownString`-then-append order (290), the export that walks the regions itself (366), and the zero-regions guard (373).
- `node_modules/@lexical/table/src/LexicalTableCellNode.ts` — the four region-node overrides `MarkdownColumnNode` copies (292–305).
- [`packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts`](packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts) — the seam-safe `createDOM` shape and the `keepElement` factory (23) the new node reuses.
- [`packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts`](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts) — the exported token interface (23) `MdBlockToken` mirrors, and the viewer-side escape/unescape shape.
- [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts) — the class-rule builder (175), the token switch (1572), `appendBlockquote` (1791) as the model for a container that recurses into block children, and `collectHeadings` (2117).
- [`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) — `$wrapSelectedTopLevelBlocks` (276), `setBlockAlignment` (1506), the context-menu builders (2213, 2314, 2377).
- [`packages/lib/tests/component/display/Markdown.test.ts`](packages/lib/tests/component/display/Markdown.test.ts) — the `styleWrites` (68) and `divHandles` (383) helpers every new viewer assertion reuses.
- [`plans/implemented/markdown-rich-formatting-extension.md`](plans/implemented/markdown-rich-formatting-extension.md) — the dialect's design rationale, its parity rule, and the syntax conventions this plan extends.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md) — the DOM seam, `StyleRule` writes, and the JSDoc link restriction.

---

## Non-Goals

- **A backward-compatible import path for `{columns=N}` auto-reflow.** The construct has never been on `master`, so no stored document can use it; an old fence degrades to a single column with an unrecognised attribute and needs no code.
- **Per-column widths.** Every column is an equal fraction. A `widths=` attribute is a second layout model on top of the one being introduced and was not asked for.
- **Column-break or balancing control.** With explicit regions there is no break to control — the author places content directly.
- **Code-fence tracking in the `:::` fence scan itself.** The two depth scans in `markdownBlockTransformer.ts` and `markdownExtensions.ts` are unchanged; a `:::` line inside a code block still ends the enclosing fence, exactly as today.
- **Row regions, or a fence-level grid.** Only one axis is in scope.
- **Nesting a fence inside a table cell.** Unchanged: a cell's content is imported through a single-line escape that cannot carry a multi-line fence.

---

## Implementation Notes

- **`markdownBlockTransformer.ts`'s import handler unwraps a degenerate block on import, deviating from the literal snippet in `## Internal Structure`.** The plan's snippet unconditionally does `rootNode.append(block)` after building the block and its columns. In practice a block with one column and *no attributes at all* can be produced by import alone — the old-syntax degrade case `## Architecture Decisions` documents (`::: {columns=2}\ntext\n:::`, whose `columns` key is unrecognised, leaving zero attributes and one column) — and appending it unchanged means `export` later emits a bare `:::` opening line for it, which neither fence scan can re-open (both require a non-empty remainder), corrupting the document on the next save. The import handler now checks `block.getColumns().length <= 1 && Object.keys(block.toAttributes()).length === 0` — mirroring `export`'s own bare-opener condition exactly — and, when true, appends the sole column's children directly to `rootNode` instead of the block. This check is deliberately narrower than `canUnwrap()` (which also fires for a one-column block carrying only a `gap`): `export` can serialise a gap-only block fine as `::: {gap=...}`, so unwrapping it on import would silently drop a real, exportable attribute. An earlier version of this fix used `canUnwrap()` and was caught doing exactly that by this branch's own audit loop; `markdown-editor.test.ts`'s `'a one-column fence carrying only a gap is not unwrapped on import'` case pins the corrected behaviour.
- **`markdownAttributes.ts`'s `splitColumnSections` *and* `joinColumnSections` scope their backslash escaping to the fence's own nesting level, fixing a data-loss bug in the plan's literal `splitColumnSections` snippet.** That snippet in `## Internal Structure` runs the `\|||` → `|||` unescape unconditionally on every line, including a line actually inside a nested `:::` fence, whose content is re-parsed recursively (that inner content goes through this same function again, at its own depth 0): unescaping it at the *outer* level too meant the backslash was consumed twice, silently destroying a literal `|||` paragraph authored inside a nested fence on the first re-import — contradicting the `## Architecture Decisions` table's own claim that a nested-fence separator is ordinary content. `splitColumnSections`'s unescape is now guarded by the same `!inCode && depth === 0` condition its split decision already uses. This alone left `splitColumnSections`/`joinColumnSections` asymmetric — `joinColumnSections` (described in prose only, with no literal snippet in the plan) still escaped a `|||` line at *every* depth — which the branch's own audit loop caught as a second, self-inflicted regression: a `|||` written inside a nested fence's exported form, or inside a fenced code block's exported form, was now getting escaped on export with nothing left to unescape it back on the next import. `joinColumnSections` now applies the identical `!inCode && depth === 0` scoping, tracked fresh per section. `Markdown.test.ts` pins both the split-side fix directly and the full `splitColumnSections(joinColumnSections(x)) === x` round-trip for a section containing a nested column-region fence and for one containing a fenced code block.
- **Manual verification (browser required) was performed against `npm -w packages/lib run dev`, in the MD Editor and Markdown panels**, per `## Expected Behaviour`'s manual-verify section: the editor and the viewer showed the "Left column."/"Right column." fence in the same two columns side by side, at both the default split and a narrowed browser width (700px), with no content moving between columns; right-clicking a word inside a populated column showed the new **Columns** submenu (verified this is present on the text context menu, not only the empty-line one); choosing **3 columns** grew the region from 2 to 3 columns live, and clicking into the new third (empty) column and typing landed the text there and only there, confirmed both in the editor's DOM (`.ts-ui-mde-column` divs) and in the read-only viewer, which re-rendered the same three-column split via its own `"change"` → `setMarkdown` wiring; choosing **Columns ▸ None** on that same region removed the fence and returned its columns' content to plain top-level paragraphs, in document order. Not separately exercised: Backspace-at-column-start and Enter-at-column-end, which exercise `MarkdownColumnNode`'s `collapseAtStart()`/`canBeEmpty()` overrides copied verbatim from `@lexical/table`'s `TableCellNode` (`## Architecture Decisions`, `[^table-precedent]`) — these overrides are exercised by that precedent in the codebase's own table editing today, and are not separately re-verified here. Theme re-resolution of the column gutter was not re-verified live; it rides the pre-existing `--ts-ui-md-column-gap` CSS-variable mechanism unchanged from `markdown-rich-formatting-extension`, where it was already verified.

---

## Notes

[^reflow-parity]: CSS `column-count` is newspaper-style auto-balancing: the browser picks the break point from the content's total rendered height in that specific container. The editor's WYSIWYG surface and the viewer are two containers of different widths — in a live reproduction of the demo panel, roughly 1239px and 683px — so the same exported Markdown broke at different paragraphs in each. No CSS tuning fixes that, because the input to the decision is the container width itself. The original plan's own `## Non-Goals` (`plans/implemented/markdown-rich-formatting-extension.md`, "Column-break control and column balancing") records that the construct was deliberately built as reflowing text with no way to address a column, which is why this is a redesign rather than a patch.

[^separator-choice]: `|||` is unclaimed by CommonMark and GFM: a lone pipe line is a paragraph unless the next line is a table delimiter row, and the split runs before any table parsing, so a table inside a column is unaffected. It also reads as what it is — the dialect already uses `|` for cells across a row. The rejected candidates: `---` and `***` are thematic breaks (and `---` is also a setext underline and a delimiter row's shape); `~~~` is CommonMark's alternate code fence; `+++` collides visually with the dialect's own `++underline++` and is TOML front matter elsewhere; `:::` is the fence's own closer. Pandoc's real convention — nested `::: {.column}` divs inside a `::: {.columns}` wrapper — was also rejected: this dialect's fence attributes are strictly `key=value` with no class syntax, its opener test cannot tell `::::` from `:::`, and the inner fences' closers are indistinguishable from the outer one, so an author would have to count `:::` lines. An escape is needed because the editor exports whatever a paragraph contains: a paragraph whose text is literally `|||` would otherwise re-import as a separator. `\|||` is the escape, and it is unescaped by the shared splitter rather than left to CommonMark, because `@lexical/markdown` does not process backslash escapes and the two halves would then disagree — the same reason the dialect escapes a whole-cell `\<<` / `\^^` explicitly on both sides.

[^no-count-attribute]: Keeping `columns=N` alongside the separators means two sources of truth for one number, and every hand-edited document can put them in conflict. Every rule for resolving that conflict is worse than not having it: making the attribute authoritative means padding or merging sections behind the author's back, and making the sections authoritative means the attribute can silently lie. Deleting it removes the case entirely, and the count is still visible in the source — the separators are the count. The `columns` keyword in the opening line is not a value: it is ignored by both parsers, and exists only because both fence scans require a non-empty remainder after `:::` to treat a line as an opener (`markdownBlockTransformer.ts:49`, `markdownExtensions.ts:127`), while an attribute-free two-column region is the commonest case. Relaxing that rule instead — letting a bare `:::` open a fence at depth 0 — was rejected: inside a fence body a bare `:::` must still close, so a nested attribute-free region would export a `:::` line that re-imports as the outer fence's closer, corrupting the document.

[^table-precedent]: The structural precedent transfers: a container node whose children are region nodes, each holding block content, imported and exported by one `MultilineElementTransformer` that owns the whole subtree, is exactly `TableNode` › `TableRowNode` › `TableCellNode` plus `markdownTableTransformer.ts`. The classes do not transfer. A `TableCellNode` carries header state, col/row spans, a width, and a background colour, and `@lexical/table` registers observers, a drag-selection model, and the merge/unmerge commands against it — none of which a column needs, and all of which the table context menu and the `mdtable` transformer would then apply to a fence. Reusing the classes would also make the `TABLE` transformer match a column region on export, since it tests `$isTableNode`. Two of `TableCellNode`'s overrides are load-bearing here rather than cosmetic: `isShadowRoot()` stops `getTopLevelElement()` walking out of a column, and `canBeEmpty() === false` keeps `INTERNAL_$isBlock` from treating a column as a block, which is what makes `$setBlocksType` convert the paragraph the caret is in rather than the whole region. `collapseAtStart()` keeps backspace at a column's start from merging it into the previous column.

[^flex-choice]: `display: flex` with `flex: 1 1 0` gives every column an equal share of the container at any width, which is what makes the two halves agree. CSS Grid with `grid-template-columns: repeat(N, minmax(0, 1fr))` renders identically but has to write `N` into the container's style, so the container would need re-styling whenever a column is added or removed; the flex form needs no count at all, and `updateDOM` returning `true` unconditionally (the seam rule's consequence for a custom node) makes a count-dependent container style fragile in the editor. `column-gap` applies to a flex container just as it did to a multi-column one, so the `--ts-ui-md-column-gap` theme token and the `gap` attribute keep working unchanged.

[^shared-splitter]: `markdownAttributes.ts` is the dialect's only module both halves import today, and its docblock already states the reason: a grammar duplicated across the two halves is a parity bug waiting to happen, since each copy decides independently. The `:::` depth scan is currently duplicated (once in each half) and stays that way — this plan does not refactor it — but the new split is written once. Adding it here rather than in a second shared module keeps the "exactly one shared module" property, at the cost of widening that module's stated remit from the `{key=value}` grammar to the dialect's shared grammar generally, which its docblock is updated to say.

[^count-change]: The guiding rule is that a menu click must never silently delete authored content, which rules out truncating on shrink. Merging the surplus into the last kept column preserves both the text and its order, and it is the only merge that needs no arbitrary choice about which column receives what. Growth appends rather than redistributing, because splitting existing prose across new columns is precisely the automatic-reflow behaviour this plan removes — where a paragraph goes is the author's decision. The untouched-column exception exists because without it, `setColumnCount(3)` followed by `setColumnCount(2)` leaves a stray blank paragraph in column 2, so a menu misclick is not cleanly undoable; the test is deliberately narrow — one child, a paragraph, itself childless — so a column holding anything at all, including an image or an empty-looking node with children, is merged rather than dropped. The 1–6 clamp keeps the old grammar's `columns` range as a guard on the only place a count is now produced programmatically; the parsers themselves have no bound, because in a hand-written document the sections are the author's explicit statement of intent.

[^one-file]: `MarkdownColumnNode` goes in `markdownBlockNode.ts` rather than its own file because it is not independently usable — it exists only as `MarkdownBlockNode`'s child, the pair is created, serialised, imported, and exported together, and it shares that file's `keepElement` element-mint factory, which would otherwise be duplicated or exported across a file boundary for a three-line identity function. `@lexical/table` splits its three node classes across files, but each of those carries substantial API of its own; `MarkdownColumnNode` has no fields and no accessors.
