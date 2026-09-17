---
depends-on:
    - table-column-alignment-context-menu
    - markdown-rich-formatting-extension
touches-shared:
    - packages/lib/src/typescript/lib/component/display/markdownAttributes.ts
    - packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts
    - packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts
    - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
    - packages/lib/tests/component/markdown-editor.test.ts
    - packages/lib/tests/component/display/Markdown.test.ts
    - packages/lib/docs/components/MarkdownEditor.md
    - packages/lib/docs/components/Markdown.md
---

# Per-Cell Table Alignment Override — Implementation Plan

## Overview

A GFM delimiter row carries one alignment marker per column, so the dialect can align a whole column and nothing smaller. `setTableColumnAlignment` and the table-cell context menu's **Align column** submenu ([MarkdownEditor.ts:1831](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1831), [:2529-2535](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2529-L2535)) write one alignment onto every cell of a column for exactly that reason. This plan adds the missing smaller unit: an alignment on **one body cell**, overriding its column's marker.

The override is authored as a trailing `{align=…}` group on the body cell's own text — the same `{key=value}` extension grammar the dialect already uses for a column width on a delimiter cell ([markdownAttributes.ts:289](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L289)). Both halves of the dialect must read it: the editor's table transformer ([markdownTableTransformer.ts](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts)) and the viewer's own table tokenizer ([markdownTableExtension.ts](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts)). The shared parse/emit pair lives in `markdownAttributes.ts`, which both already import.

On the editing surface, `MarkdownEditor` gains a `setTableCellAlignment` command and an **Align cell** submenu beside the existing **Align column** one. Lexical already stores alignment per cell (`TableCellNode.setFormat`), so no node-model change is needed — the gap is the authoring path and the Markdown representation.[^model-already-per-cell]

This plan is built on the `feature/table-column-alignment-context-menu` branch, not on `master`. It cannot land until that branch and its own base, `feature/markdown-rich-formatting-extension`, have merged to `master`.

---

## Architecture Decisions

### The override is a trailing `{align=…}` group on the body cell's text

A body cell's Markdown ends with ` {align=left|center|right}` when that cell overrides its column. The dialect's existing per-construct attribute groups — `{width=240}` on a delimiter cell, `{width=… height=…}` on an image, `{color=… font=… size=…}` on a span — establish the grammar and the placement rule: the group sits at the end of the construct it modifies.[^syntax-choice]

```
| a | b |
| --- | :---: |
| 1 | 2 {align=right} |
```

### A cell's own alignment wins over its column's marker

The delimiter marker sets the column's alignment; a cell carrying `{align=…}` uses that value instead. A cell with no group inherits the column.

| Delimiter marker | Body cell Markdown | Cell renders | Cell's Lexical format |
|---|---|---|---|
| `:---:` | `2` | center — inherited | `center` |
| `:---:` | `2 {align=right}` | right — override | `right` |
| `---` | `2 {align=left}` | left — override | `left` |

### The column's marker stays on the header-row cells, so a header cell carries no override

The exported delimiter row is built from the header row's cell formats ([markdownTableTransformer.ts:379](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L379)) and stays that way. A header cell's alignment therefore *is* its column's marker, and a `{align=…}` group in a header cell is ordinary literal text in both halves.[^header-is-the-column]

### `columnAlignment` is read from the header cell, not the clicked cell

`$classifyContextMenuTarget` currently reports the clicked cell's own format as `columnAlignment` ([MarkdownEditor.ts:628](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L628)). That reading is only correct while every cell of a column shares one format. It changes to read the header-row cell of the clicked cell's column.[^column-read-fix]

### `"none"` on a cell means "inherit the column"

`setTableCellAlignment("none")` writes the column's own alignment onto the cell, which is exactly the state that emits no group. The menu labels that choice **Column default**, not **None**, to distinguish it from the Align column submenu's **None** (which means "this column has no marker").[^none-means-inherit]

### An alignment that equals the column's is not an override

Export emits a group only for a cell whose format is `left`/`center`/`right` **and** differs from its column's alignment. A cell format of `""` always means "inherit", so it never emits a group.[^unset-means-inherit]

| Column alignment | Cell format | Exported cell |
|---|---|---|
| `center` | `right` | `2 {align=right}` |
| `center` | `center` | `2` |
| `center` | `""` | `2` |
| `""` | `left` | `2 {align=left}` |

### **Align cell** is a second submenu, dimmed on a header cell

The table-cell menu gains one **Align cell** entry after **Align column**, offering Left / Center / Right / Column default. On a header cell the entry is present but `enabled: false`, mirroring the same menu's dimmed **Insert link…** ([MarkdownEditor.ts:2368-2371](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2368-L2371)). A disabled item never opens its submenu ([MenuItem.ts:313-325](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L313-L325)).[^dim-not-hide]

### **Align column** clears the column's per-cell overrides

`setTableColumnAlignment` keeps writing every cell of the column, so applying a column alignment resets each cell in it to that alignment and drops every override. No code changes are needed; the clearing is a consequence of the existing column-wide write, stated here so it gets a test.[^column-clears-overrides]

### A literal trailing `{align=…}` in a cell is escaped as `\{align=…}`

Export escapes a cell whose own text would read back as an override; import undoes the escape and treats the group as content. Same shape as the whole-cell `\<<` / `\^^` escape already in `escapeCellText` ([markdownTableTransformer.ts:164-185](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L164-L185)).[^escape-needed]

| Cell content in the document | Exported | Read back as content | Override |
|---|---|---|---|
| `2` aligned right | `2 {align=right}` | `2` | right |
| literal text `2 {align=right}` | `2 \{align=right}` | `2 {align=right}` | none |

### The parse and emit pair lives in `markdownAttributes.ts`

`resolveCellAlignment` and `formatCellAlignment` join `resolveColumnWidth` in the shared module, so the editor's transformer and the viewer's tokenizer read one implementation. Both directions live there even though only the editor emits, matching `resolveSpanStyle`/`spanStyleToAttributes` and `resolveBlockStyle`/`blockStyleToAttributes` ([markdownAttributes.ts:132-275](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L132-L275)).

### No new alignment type

`setTableCellAlignment` takes the existing `MarkdownTableAlignment` ([MarkdownEditor.ts:113](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L113)). Inside `markdownAttributes.ts` and `markdownTableExtension.ts` the override is the inline union `"left" | "center" | "right" | null`, matching how those modules already spell alignment.[^no-new-type]

### The viewer's renderer is not changed

`appendTableRow` already applies `alignmentClass(cell.align)` per cell ([Markdown.ts:1719-1726](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1719-L1726)). The tokenizer resolves the override into each body cell's `align`, so `Markdown.ts` needs no edit at all.

---

## Public API

```typescript
class MarkdownEditor extends Component<MarkdownEditorOptions> {
    /**
     * Sets the alignment of the single cell holding the caret, overriding its
     * column's own alignment. `"none"` restores the cell to its column's
     * alignment. No-op without throwing when the caret is not inside a table
     * cell, or is inside a header-row cell.
     */
    setTableCellAlignment(alignment: MarkdownTableAlignment): this;
}
```

`ContextMenuTarget`'s `"table-cell"` member gains two optional fields; every other member is unchanged:

```typescript
export type ContextMenuTarget =
    | {
          kind: "table-cell";
          hasSelectedText: boolean;
          bold: boolean; italic: boolean; strikethrough: boolean; code: boolean; underline: boolean;
          hasEnclosingBlock?: boolean;
          linkUrl?: string | null;
          columnAlignment?: MarkdownTableAlignment;
          cellAlignment?: MarkdownTableAlignment;
          isHeaderCell?: boolean;
      }
    | { kind: "empty-line"; hasSelectedText: boolean }
    | { /* "text" — unchanged */ };
```

The new exports from `markdownAttributes.ts` — one interface and two functions, none barrel-exposed, like `resolveColumnWidth` beside them:

```typescript
/** A body cell's text with its alignment override split off. */
export interface MarkdownCellAlignment {
    /** The cell text with a recognised trailing `{align=…}` group removed and a `\{` escape undone. */
    text: string;
    /** The cell's alignment override, or `null` when it carries none. */
    align: "left" | "center" | "right" | null;
}

export function resolveCellAlignment(text: string): MarkdownCellAlignment;

export function formatCellAlignment(text: string, align: "left" | "center" | "right" | null): string;
```

No barrel change: `setTableCellAlignment` is a method, and `MarkdownTableAlignment` is already exported from `component/editor/index.ts`.

---

## Internal Structure

### `markdownAttributes.ts` — the shared parse/emit pair

Placed immediately after `resolveColumnWidth` ([markdownAttributes.ts:289-299](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L289-L299)), with the two regexps beside `POSITIVE_INTEGER` / `ALIGN` at [:44-48](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L44-L48).

```typescript
/** `left` / `center` / `right`, the three alignments a cell's `{align=…}` override can carry. */
const CELL_ALIGN = /^(left|center|right)$/;

/** A trailing `{…}` group at the very end of a cell's text, with the optional `\` that makes it literal. */
const TRAILING_GROUP = /(\\?)\{([^{}]*)\}$/;
```

Recognition is deliberately narrow — the group must hold exactly one `align` key with one of the three values, or it stays content:

| Trailing group | Read as |
|---|---|
| `{align=right}` | override `right` |
| `\{align=right}` | literal text `{align=right}` |
| `{align=justify}` | literal text — not one of the three |
| `{width=80}` | literal text — wrong key |
| `{align=right width=80}` | literal text — more than one key |

```typescript
/** Undoes a `\{…}` escape at the end of `text`, leaving anything else alone. */
function unescapeTrailingGroup(text: string): string {
    const match = TRAILING_GROUP.exec(text);

    return match !== null && match[1] === "\\"
        ? text.slice(0, match.index) + match[0].slice(1)
        : text;
}

export function resolveCellAlignment(text: string): MarkdownCellAlignment {
    const match = TRAILING_GROUP.exec(text);

    if (match === null) {
        return { text, align: null };
    }

    if (match[1] === "\\") {
        return { text: unescapeTrailingGroup(text), align: null };
    }

    const attributes = parseAttributes(match[2]!);
    const align = attributes.align;

    if (Object.keys(attributes).length !== 1 || align === undefined || !CELL_ALIGN.test(align)) {
        return { text, align: null };
    }

    return {
        text:  unescapeTrailingGroup(text.slice(0, match.index).trimEnd()),
        align: align as "left" | "center" | "right",
    };
}

export function formatCellAlignment(text: string, align: "left" | "center" | "right" | null): string {
    // Text that would itself read back as an override is escaped, so it
    // round-trips as content rather than as an alignment.
    const escaped = resolveCellAlignment(text).align === null
        ? text
        : text.replace(/\{([^{}]*)\}$/, "\\{$1}");

    if (align === null) {
        return escaped;
    }

    return escaped === "" ? `{align=${align}}` : `${escaped} {align=${align}}`;
}
```

### `markdownTableTransformer.ts` — import

Inside the body-cell loop, replacing [:342-347](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L342-L347). The `setFormat` call keeps its existing "AFTER the conversion" comment and position.

```typescript
const { text, align: override } = resolveCellAlignment(unescapeCellText(cells[column]!));

$convertFromMarkdownString(text.replace(/\\n/g, "\n"), getTransformers(), cell);

// AFTER the conversion, per the same ordering rule above.
cell.setFormat(override ?? delimiter.alignments[column] ?? "");
```

The header-cell loop at [:287-298](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L287-L298) is untouched.

### `markdownTableTransformer.ts` — export

`renderBodyRow`'s single push at [:421](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L421) becomes:

```typescript
texts.push(formatCellAlignment(
    escapeCellText($convertToMarkdownString(getTransformers(), cell)),
    cellAlignmentOverride(cell, alignments[column])));
```

with one module-level helper placed beside `escapeCellText`:

```typescript
/**
 * A body cell's alignment override: its own format when that format is one
 * GFM can express *and* differs from its column's. `null` for a cell that
 * inherits — including a cell with no format at all, which always inherits.
 *
 * @param cell - The body cell to read.
 * @param columnAlignment - The cell's column's alignment, from the header row.
 * @returns The override, or `null` when the cell inherits its column.
 */
function cellAlignmentOverride(
    cell: TableCellNode, columnAlignment: ElementFormatType | undefined,
): "left" | "center" | "right" | null {
    const format = cell.getFormatType();

    if (format !== "left" && format !== "center" && format !== "right") {
        return null;
    }

    return format === columnAlignment ? null : format;
}
```

`column` is the cell's start column at the moment of the push — the `colSpan` fan-out that advances `column` runs after it ([:426-429](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L426-L429)) — so `alignments[column]` is the right column's marker for a merged cell too. `renderHeaderRow` at [:382-388](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L382-L388) is untouched.

### `markdownTableExtension.ts` — the viewer's tokenizer

Replacing [:244-252](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L244-L252):

```typescript
const { text, align: override } = resolveCellAlignment(unescapeCellText(cells[column]!));

rowCells.push({
    text,
    align: override ?? delimiter.align[column] ?? null,
    colSpan,
    rowSpan,
    tokens: this.lexer.inlineTokens(text),
});
```

The header-cell map at [:202-206](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L202-L206) is untouched, and `MdTableBodyCell`'s `align` field already has the right type.

### `MarkdownEditor.ts` — new module-level helpers

Placed immediately after `$setEnclosingColumnAlignment` ([MarkdownEditor.ts:236-250](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L236-L250)).

```typescript
/**
 * Whether `cell` sits in the table's header row — the row whose formats are
 * the exported delimiter row, so its cells cannot carry an override.
 *
 * @param cell - The cell to test.
 * @returns Whether the cell's row is its table's first row.
 */
function $isHeaderRowCell(cell: TableCellNode): boolean {
    const row = cell.getParent();

    return $isTableRowNode(row) && row.getPreviousSibling() === null;
}

/**
 * The alignment of `cell`'s column: the alignment of the header-row cell
 * occupying the same grid column.
 *
 * @param cell - Any cell of the column to read.
 * @returns The column's alignment; `"none"` when it carries no marker.
 */
function $columnAlignmentOf(cell: TableCellNode): MarkdownTableAlignment {
    const table = $getTableNodeFromLexicalNodeOrThrow(cell);
    const [tableMap, cellValue] = $computeTableMap(table, cell, cell);
    const headerCell = tableMap[0]?.[cellValue.startColumn]?.cell;

    return headerCell === undefined ? "none" : $tableCellAlignment(headerCell);
}

/**
 * Sets `alignment` on the single cell holding the caret, leaving every other
 * cell of its column alone. `"none"` restores the cell to its column's own
 * alignment, which is the state that exports no `{align=…}` group. No-op when
 * the caret is not inside a table cell, or is inside a header-row cell.
 *
 * @param alignment - The alignment to apply to the cell.
 */
function $setEnclosingCellAlignment(alignment: MarkdownTableAlignment): void {
    const cell = $getEnclosingTableCellNode();

    if (cell === null || $isHeaderRowCell(cell)) {
        return;
    }

    const resolved = alignment === "none" ? $columnAlignmentOf(cell) : alignment;

    cell.setFormat(resolved === "none" ? "" : resolved);
}
```

### `MarkdownEditor.ts` — classification

`$classifyContextMenuTarget`'s table-cell branch ([MarkdownEditor.ts:624-631](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L624-L631)):

```typescript
const tableCell = $getTableCellNodeFromLexicalNode(node);

if (tableCell !== null) {
    const hasEnclosingBlock = $findEnclosingInsertableBlock(node) !== null;
    const columnAlignment   = $columnAlignmentOf(tableCell);
    const ownAlignment      = $tableCellAlignment(tableCell);
    const cellAlignment     = ownAlignment === columnAlignment ? "none" : ownAlignment;
    const isHeaderCell      = $isHeaderRowCell(tableCell);

    return {
        kind: "table-cell", hasSelectedText, hasEnclosingBlock, linkUrl,
        columnAlignment, cellAlignment, isHeaderCell, ...formatState,
    };
}
```

`cellAlignment` is the override the menu checks, computed by the same rule the exporter uses:

| Column marker | Cell format | `columnAlignment` | `cellAlignment` | Checked in **Align cell** |
|---|---|---|---|---|
| `:---:` | `center` | `center` | `none` | Column default |
| `:---:` | `right` | `center` | `right` | Right |
| `---` | `""` | `none` | `none` | Column default |
| `---` | `left` | `none` | `left` | Left |

### `MarkdownEditor.ts` — command and menu

The command goes immediately after `setTableColumnAlignment` ([MarkdownEditor.ts:1839](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1839)), before `deleteTable`, and follows its shape exactly:

```typescript
setTableCellAlignment(alignment: MarkdownTableAlignment): this {
    const editor = this.ensureEditor();

    editor.update(() => {
        $setEnclosingCellAlignment(alignment);
    }, { discrete: true });

    return this;
}
```

The menu entry is appended to `buildTableCellContextMenuItems`'s array literal directly after the **Align column** entry ([MarkdownEditor.ts:2529-2535](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2529-L2535)), inside the same `const items` initializer and before the `hasEnclosingBlock` push:

```typescript
{
    text:    "Align cell",
    enabled: context.isHeaderCell !== true,
    submenu: {
        label: "Align cell",
        items: this.buildCellAlignmentItems(context.cellAlignment ?? "none"),
    },
},
```

with a private builder placed directly after `buildColumnAlignmentItems` ([MarkdownEditor.ts:2569-2577](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2569-L2577)), whose shape it follows:

```typescript
/**
 * Builds the four mutually-exclusive items of the table-cell menu's "Align
 * cell" submenu. Exactly one carries `checked: true`.
 *
 * @param current - The clicked cell's own override, or `"none"` when it
 *   inherits its column's alignment.
 * @returns The four `MenuItemConfig` entries: Left, Center, Right, Column default.
 */
private buildCellAlignmentItems(current: MarkdownTableAlignment): MenuItemConfig[] {
    return ([
        ["Left", "left"], ["Center", "center"], ["Right", "right"], ["Column default", "none"],
    ] as const).map(([text, alignment]) => ({
        text,
        checked: current === alignment,
        action:  () => { this.setTableCellAlignment(alignment); },
    }));
}
```

---

## Ordered Implementation Steps

1. **Add the shared parse/emit pair** to `packages/lib/src/typescript/lib/component/display/markdownAttributes.ts`: the two regexps beside `POSITIVE_INTEGER`/`ALIGN` ([:44-48](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L44-L48)), and `MarkdownCellAlignment`, `unescapeTrailingGroup`, `resolveCellAlignment`, `formatCellAlignment` after `resolveColumnWidth` ([:299](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L299)) — exactly as shown in Internal Structure. Every exported symbol carries JSDoc with an `@example` block, matching `resolveColumnWidth`'s own.
   Check: the project's typecheck passes.

2. **Update the viewer's tokenizer** — `packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts`: import `resolveCellAlignment` alongside `resolveColumnWidth` ([:4](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L4)) and rewrite the body-cell push ([:244-252](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L244-L252)) as shown. Do not touch the header-cell map at [:202-206](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L202-L206), `parseDelimiterRow`, or `resolveMergeGrid`.
   Check: `grep -n 'resolveCellAlignment' packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts` — expect two lines, the import and the one call.

3. **Update the editor's table import** — `packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts`: extend the `markdownAttributes.js` import ([:12](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L12)) with `resolveCellAlignment` and `formatCellAlignment`, then rewrite the body-cell block at [:342-347](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L342-L347) as shown in Internal Structure. Leave the header-cell loop at [:287-298](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L287-L298) alone.

4. **Update the editor's table export** — same file: add `cellAlignmentOverride` after `unescapeCellText` ([:185](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L185)), and rewrite `renderBodyRow`'s push at [:421](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L421) as shown. `TableCellNode` and `ElementFormatType`, the helper's two parameter types, are already imported ([:3](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L3), [:9](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L9)) — add no imports here. `renderHeaderRow` and `formatDelimiterRow` are unchanged.
   Check: `grep -n 'escapeCellText' packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts` — expect four lines: the two function definitions and the two call sites (header row, body row).

5. **Add the three new `$`-helpers** to `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`, immediately after `$setEnclosingColumnAlignment` ([:250](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L250)), exactly as shown in Internal Structure. `$isTableRowNode`, `$computeTableMap`, and `$getTableNodeFromLexicalNodeOrThrow` are all already imported ([:36-44](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L36-L44)) — add no imports.

6. **Widen `ContextMenuTarget`** ([:460-476](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L460-L476)) — add `cellAlignment?: MarkdownTableAlignment;` and `isHeaderCell?: boolean;` to the `"table-cell"` member only. Do not touch the `"text"` or `"empty-line"` members.

7. **Update `$classifyContextMenuTarget`**'s table-cell branch ([:624-631](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L624-L631)) as shown. This changes `columnAlignment` from the clicked cell's format to the header cell's — the existing behaviour is a special case of the new one, so no existing classification test changes value.

8. **Add `setTableCellAlignment`** after `setTableColumnAlignment` ([:1839](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1839)). Its JSDoc describes the behaviour in prose and must not `{@link}` any `$`-prefixed helper (per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)).

9. **Add `buildCellAlignmentItems`** after `buildColumnAlignmentItems` ([:2577](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2577)), and **append the "Align cell" entry** to `buildTableCellContextMenuItems` directly after the "Align column" entry ([:2535](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2535)). Leave `buildTextContextMenuItems` and `buildEmptyLineContextMenuItems` untouched.

10. **Update the class-level doc comment**'s command list ([:852](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L852)) — add `` `setTableCellAlignment` `` immediately after `` `setTableColumnAlignment` ``.

11. **Add a CORPUS entry** to `packages/lib/tests/component/markdown-editor.test.ts` ([:51-73](packages/lib/tests/component/markdown-editor.test.ts#L51-L73)), after `'table escaped pipe'`:

    ```typescript
    'table cell alignment override': '| a | b |\n| --- | :---: |\n| 1 | 2 {align=right} |',
    ```

    The three CORPUS-driven suites (idempotence at [:880](packages/lib/tests/component/markdown-editor.test.ts#L880), source/wysiwyg switch at [:946](packages/lib/tests/component/markdown-editor.test.ts#L946), viewer-token fidelity at [:1147](packages/lib/tests/component/markdown-editor.test.ts#L1147)) then cover the new syntax with no further edits. The entry must be in canonical exported form or the idempotence suite fails.

12. **Update the four table-cell menu-shape tests** ([:2439](packages/lib/tests/component/markdown-editor.test.ts#L2439), [:2467](packages/lib/tests/component/markdown-editor.test.ts#L2467), [:2501](packages/lib/tests/component/markdown-editor.test.ts#L2501), [:2514](packages/lib/tests/component/markdown-editor.test.ts#L2514)) — each gains exactly one entry, `'Align cell'`, immediately after `'Align column'` in its `items.slice(9)` assertion, and each expected length rises by one:

    | Context | Length |
    |---|---|
    | `linkUrl: null` | 23 → **24** |
    | `linkUrl: null`, `hasEnclosingBlock` | 26 → **27** |
    | `linkUrl` set | 24 → **25** |
    | `linkUrl` set + `hasEnclosingBlock` | 27 → **28** |

    Retitle each `it(...)` to its new count. If a length in this table does not match what the suite reports, stop and report the mismatch rather than guessing — the counts are read from the file at plan time and the file may have moved on.

13. **Add new tests** per Expected Behaviour below, to `packages/lib/tests/component/markdown-editor.test.ts` and `packages/lib/tests/component/display/Markdown.test.ts`.

14. **Update `packages/lib/docs/components/MarkdownEditor.md`**:
    - Dialect table ([:43-62](packages/lib/docs/components/MarkdownEditor.md#L43-L62)): add a `| Table cell alignment override | body cell's trailing `{align=left\|center\|right}` |` row after the `Table column width` row ([:59](packages/lib/docs/components/MarkdownEditor.md#L59)).
    - The paragraph after that table ([:64](packages/lib/docs/components/MarkdownEditor.md#L64)): extend the "A column's alignment … are all **preserved** … authorable" sentence to name `setTableCellAlignment` and the per-cell override.
    - Command API table ([:77-100](packages/lib/docs/components/MarkdownEditor.md#L77-L100)): add a `setTableCellAlignment(alignment)` row after the `setTableColumnAlignment(alignment)` row ([:90](packages/lib/docs/components/MarkdownEditor.md#L90)), stating that `"none"` restores the column's alignment and that the command no-ops in a header cell.
    - The "Right-click context menu" bullet ([:73](packages/lib/docs/components/MarkdownEditor.md#L73)): extend the Align column clause with the **Align cell** submenu — Left/Center/Right/Column default, dimmed on a header cell.

15. **Update `packages/lib/docs/components/Markdown.md`**:
    - Supported-syntax table ([:46-63](packages/lib/docs/components/Markdown.md#L46-L63)): add a `| body cell `{align=...}` | overrides that cell's column alignment — see [Extension syntax](#extension-syntax) |` row after the `delimiter cell {width=240}` row.
    - The paragraph at [:65](packages/lib/docs/components/Markdown.md#L65): after the sentence about delimiter-row markers applying to every cell, state the override, its precedence, that it is a body-cell-only construct, and the `\{align=…}` escape.
    - The extension-syntax paragraphs at [:118](packages/lib/docs/components/Markdown.md#L118) and [:122](packages/lib/docs/components/Markdown.md#L122): add the override to the syntax list, and to the non-portability list (a foreign renderer shows the group as literal text after the cell's content).

16. **Add a changelog entry** to `packages/lib/docs/reference/changelog/next.md` — one bullet under "## Added" → "### Components", directly after the existing "Align column" bullet ([:184-189](packages/lib/docs/reference/changelog/next.md#L184-L189)), covering the `{align=…}` body-cell syntax, the **Align cell** submenu, and `setTableCellAlignment`.

17. **Typecheck, test, docs.** Run the project's typecheck; run `packages/lib/tests/component/markdown-editor.test.ts` and `packages/lib/tests/component/display/Markdown.test.ts`; run `npm run docs:api` and confirm no new warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/markdownAttributes.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

Nothing is created or deleted. `Markdown.ts`, `editorTheme.ts`, `component/editor/index.ts`, `markdownTransformers.ts`, and `packages/lib/llms.txt` are unchanged — see Architecture Decisions for why the viewer's renderer needs no edit, and Documentation Impact for the barrel and `llms.txt`.

---

## Expected Behaviour

Every case below is unit-testable headlessly. The offline harness runs the whole Lexical state path (`setValue`, the command API, `getValue`), and the viewer's tests assert against the recording DOM sink, so the Markdown round-trips and the rendered classes are real assertions.

**The shared parser** (new `describe`, in `packages/lib/tests/component/display/Markdown.test.ts` beside the `'Markdown table'` block at [:930](packages/lib/tests/component/display/Markdown.test.ts#L930)) — `resolveCellAlignment` / `formatCellAlignment` imported directly, mirroring how `Markdown.test.ts` already imports the non-barrel-exposed `mapFenceLangToEditorId`:

1. `resolveCellAlignment('2 {align=right}')` → `{ text: '2', align: 'right' }`; the same for `left` and `center`.
2. `resolveCellAlignment('2')` → `{ text: '2', align: null }`.
3. `resolveCellAlignment('2 \\{align=right}')` → `{ text: '2 {align=right}', align: null }` — the escape makes the group content.
4. Unrecognised groups stay content, text unchanged: `'2 {align=justify}'`, `'2 {width=80}'`, `'2 {align=right width=80}'`, and `` '`x{a}`' `` all resolve to `align: null` with `text` byte-identical to the input.
5. `resolveCellAlignment('{align=right}')` → `{ text: '', align: 'right' }` — an override on an otherwise empty cell.
6. `formatCellAlignment('2', 'right')` → `'2 {align=right}'`; `formatCellAlignment('2', null)` → `'2'`; `formatCellAlignment('', 'right')` → `'{align=right}'` with no leading space.
7. `formatCellAlignment('2 {align=right}', null)` → `'2 \\{align=right}'`, and `formatCellAlignment('2 {align=right}', 'left')` → `'2 \\{align=right} {align=left}'`.
8. Round-trip: for each of those `formatCellAlignment` outputs, `resolveCellAlignment` returns the original text and alignment.

**The viewer** (extending the `'Markdown table'` block, reusing its `classWrites()` helper):

9. `'| a | b |\n| --- | :---: |\n| 1 | 2 {align=right} |'` renders the second column's `<th>` with `ts-ui-md-align-center` and its `<td>` with `ts-ui-md-align-right` — the override replaces the column class rather than adding to it.
10. The same document writes the cell's text as `2`, with no `{align=right}` anywhere in `textWrites()`.
11. `'| a |\n| --- |\n| 1 \\{align=right} |'` writes the text `1 {align=right}` and applies no alignment class.
12. A `{align=…}` group in a **header** cell is literal text: `'| a {align=right} |\n| --- |\n| 1 |'` writes the header text `a {align=right}` and applies no alignment class.
13. An override on a merged cell applies to the merged `<td>`: `'| a | b |\n| --- | --- |\n| 1 {align=center} | << |'` renders one `<td>` carrying both `colspan="2"` and `ts-ui-md-align-center`.

**The editor's round-trip** (new `describe` in `packages/lib/tests/component/markdown-editor.test.ts`, beside the `'MarkdownEditor setTableColumnAlignment'` block at [:1462](packages/lib/tests/component/markdown-editor.test.ts#L1462), reusing its `cellFormats` helper):

14. `setValue('| a | b |\n| --- | :---: |\n| 1 | 2 {align=right} |')` then `getValue()` normalizes back to the same string.
15. After that `setValue`, `cellFormats` shows the header row as `['', 'center']` and the body row as `['', 'right']` — the override landed on that one cell only.
16. A cell whose group matches its column emits nothing: `setValue('| a |\n| :---: |\n| 1 {align=center} |')` exports `| a |\n| :---: |\n| 1 |`.
17. A cell with no group in an aligned column inherits: `setValue('| a |\n| ---: |\n| 1 |')` gives that body cell format `right`.
18. An unrecognised group survives as text: `setValue('| a |\n| --- |\n| 1 {width=80} |')` round-trips unchanged.
19. Literal text round-trips through the escape: a document whose body cell reads `1 \{align=right}` exports unchanged and leaves the cell format `''`.

**`setTableCellAlignment`** (same `describe`):

20. `setValue('| a | b |\n| --- | --- |\n| 1 | 2 |')`, place the caret in the second body cell, `setTableCellAlignment('right')` → `getValue()` normalizes to `| a | b |\n| --- | --- |\n| 1 | 2 {align=right} |`, and `cellFormats`'s header row is still `['', '']`.
21. `setTableCellAlignment('none')` on that cell removes the group again, restoring `| 1 | 2 |`.
22. `"none"` restores the *column's* alignment, not "unaligned": in a `:---:` column, a cell overridden to `right` and then set to `'none'` ends with format `center` and exports with no group.
23. No-op in a header cell: with the caret in a header cell, `setTableCellAlignment('right')` leaves `getValue()` byte-identical and does not change the delimiter row.
24. No-op without throwing when the caret is not inside a table cell — a fresh editor with no table, and a document whose caret sits in prose.
25. Fires `'change'` once and sets `isDirty()` true when the call actually changes an alignment, via the same seam every other command uses.
26. Applying the exported Markdown to a fresh `MarkdownEditor` reproduces it exactly (fixpoint), matching the round-trip pattern at [:880](packages/lib/tests/component/markdown-editor.test.ts#L880).
27. `setTableColumnAlignment` clears overrides: after overriding one body cell to `right`, `setTableColumnAlignment('center')` with the caret in that column exports `| :---: |` with no `{align=…}` group anywhere.
28. Chaining: `setTableCellAlignment('center')` is added to the chained no-throw command test ([:1320](packages/lib/tests/component/markdown-editor.test.ts#L1320)), retitled from "all six commands chain…" to "all seven commands chain…".

**Classification** (extending `describe('$classifyContextMenuTarget')` at [:1586](packages/lib/tests/component/markdown-editor.test.ts#L1586)):

29. In `'| a | b |\n| --- | :---: |\n| 1 | 2 {align=right} |'`, a node inside the overridden body cell classifies as `columnAlignment: 'center'`, `cellAlignment: 'right'`, `isHeaderCell: false`.
30. A node in the same column's *header* cell classifies as `columnAlignment: 'center'`, `cellAlignment: 'none'`, `isHeaderCell: true`.
31. A node in a body cell that inherits classifies as `cellAlignment: 'none'`.
32. The three existing table-cell `toEqual` assertions ([:1755](packages/lib/tests/component/markdown-editor.test.ts#L1755), [:1772](packages/lib/tests/component/markdown-editor.test.ts#L1772), [:1794](packages/lib/tests/component/markdown-editor.test.ts#L1794)) each gain `cellAlignment: 'none'` and `isHeaderCell: <true|false>` — `toEqual` fails on an unexpected key regardless of the fields being optional. Read each fixture's caret position to pick the right `isHeaderCell` value rather than assuming.

**Menu** (extending `describe('MarkdownEditor context menu')` at [:2160](packages/lib/tests/component/markdown-editor.test.ts#L2160), reusing its `findItem` / `submenuItemsOf` helpers):

33. A `"table-cell"` context builds an `'Align cell'` item whose submenu holds exactly `['Left', 'Center', 'Right', 'Column default']`, in that order.
34. Exactly one submenu item carries `checked: true`, matching `context.cellAlignment` — checked with `cellAlignment: 'right'` (→ `Right`) and with the field omitted (→ `Column default`).
35. The `'Align cell'` item is `enabled: false` when `isHeaderCell: true`, and enabled when the field is `false` or omitted.
36. Each submenu item's `action()` reaches `setTableCellAlignment` end to end, in the style of the existing "Align column" action test at [:2572](packages/lib/tests/component/markdown-editor.test.ts#L2572): `setValue` a two-row table, place the caret in a body cell, invoke the `'Right'` item's `action`, then assert `getValue()`'s body row carries `{align=right}`.
37. `"text"` and `"empty-line"` contexts build no `'Align cell'` item.
38. The item counts and slice orders in Ordered Implementation Steps §12 hold.

**Manual-verify only** — the recording sink returns `null` from `mountView`, so no Lexical view attaches and no real `contextmenu` event can be dispatched (see the test file's header comment at [:42-47](packages/lib/tests/component/markdown-editor.test.ts#L42-L47)):

- Right-clicking a body cell shows **Align cell** directly below **Align column**, with a checkmark on the cell's current state.
- Choosing Left / Center / Right re-aligns only the clicked cell; the rest of the column does not move.
- Choosing **Column default** snaps the cell back to its column's alignment.
- Right-clicking a **header** cell shows **Align cell** dimmed, and hovering it opens no submenu.
- Choosing an alignment from **Align column** afterwards re-aligns the whole column, clearing the per-cell override.
- The read-only viewer beside the editor in the demo panel renders the same per-cell alignment as the editing surface.

---

## Verification

- The project's TypeScript check passes with no new errors.
- `packages/lib/tests/component/markdown-editor.test.ts` and `packages/lib/tests/component/display/Markdown.test.ts` pass, including every case above.
- `grep -rn 'resolveCellAlignment' packages/lib/src/typescript/lib/component/` — each of the two parsers imports it once and calls it once, and `markdownAttributes.ts` defines it and calls it once from `formatCellAlignment`. No other module reaches for it.
- `grep -rn 'setFormat' packages/lib/src/typescript/lib/component/editor/` — expect six lines: the two import-path calls in `markdownTableTransformer.ts` (:296, :347), `$setEnclosingColumnAlignment` (MarkdownEditor.ts:248), `$selectEnclosingWordIfCollapsed` (:589), `clearFormatting` (:1422), plus the new `$setEnclosingCellAlignment`. Re-count against the file before treating a difference as a defect.
- `npm run docs:api` reports no new warnings against the base branch.
- Manual smoke test: `npm run dev`, open the `MarkdownEditorPanel` demo ([packages/lib/src/typescript/MarkdownEditorPanel.ts](packages/lib/src/typescript/MarkdownEditorPanel.ts)) — it renders the editor beside the live read-only viewer, which is what makes the editor/viewer parity check observable in one screen. Run the six manual-verify bullets there.

---

## Documentation Impact

- `packages/lib/docs/components/MarkdownEditor.md` — dialect table gains a row, the dialect paragraph and the context-menu bullet each gain a clause, and the Command API table gains a `setTableCellAlignment` row. Exact locations in Ordered Implementation Steps §14.
- `packages/lib/docs/components/Markdown.md` — supported-syntax table gains a row; the table paragraph and both extension-syntax paragraphs gain the override. §15.
- `packages/lib/docs/reference/changelog/next.md` — one "Added" bullet. §16.
- No barrel change: `setTableCellAlignment` is a method on the already-documented `MarkdownEditor`, and `MarkdownTableAlignment` is already exported and categorised. TypeDoc picks the method up automatically.
- `resolveCellAlignment`, `formatCellAlignment`, and the `MarkdownCellAlignment` interface are not barrel-exposed, exactly like `resolveColumnWidth` and `MarkdownImageSpec` beside them, so they need no doc page or catalog entry.
- `ContextMenuTarget` is not re-exported from the barrel, so widening it needs no docs update.
- `packages/lib/llms.txt`'s `MarkdownEditor` and `Markdown` entries are one-line capability descriptions and need no change.

---

## Potential Challenges

- **`columnAlignment` changes meaning in the classifier.** It moves from "the clicked cell's format" to "the header cell's format". The two agree for every document that has no override, so no existing assertion changes value — but a reviewer reading the diff should know the change is deliberate, and the JSDoc on the `"table-cell"` member says so.
- **Four menu-shape tests assert exact item counts.** Step 12 gives the new counts and the one-entry insertion point, and tells the implementer to stop and report rather than guess if the file has moved on.
- **A cell format outside GFM's three values.** A paste can leave a cell with `"justify"`, `"start"`, or `"end"`. `cellAlignmentOverride` returns `null` for those, so the cell exports as inheriting its column — the same folding `formatDelimiterRow`'s `default:` arm already does for the delimiter row.
- **The escape must be applied on the escaped text, not the raw Markdown.** `formatCellAlignment` runs on `escapeCellText`'s output, so the `\|` and `\n` escapes are already in place; the align group contains neither character, so the two escapes do not interact.
- **Public JSDoc must not `{@link}` the `$`-prefixed helpers.** `setTableCellAlignment`'s doc comment describes the behaviour in prose; the helpers' own comments may link back to it freely.

---

## Critical Files

- [markdownAttributes.ts:277-337](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L277-L337) — `resolveColumnWidth` and `resolveImageSpec`, the trailing-`{…}` precedent the new pair follows, and the JSDoc/`@example` shape it copies.
- [markdownTableTransformer.ts:154-185](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L154-L185) — `escapeCellText` / `unescapeCellText`, the existing whole-cell escape the `\{align=…}` escape mirrors.
- [markdownTableTransformer.ts:305-354](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L305-L354) — the body-cell import loop, including the "AFTER the conversion" ordering rule the new code must preserve.
- [markdownTableTransformer.ts:366-448](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L366-L448) — the export path: `alignments` from the header row, and `renderBodyRow`'s `column` / `colSpan` bookkeeping.
- [markdownTableExtension.ts:216-256](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L216-L256) — the viewer's body-cell build, the one place the viewer changes.
- [Markdown.ts:1703-1761](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1703-L1761) — `appendTableRow`; read to confirm the renderer already applies alignment per cell and needs no edit.
- [MarkdownEditor.ts:157-250](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L157-L250) — the table-selection helpers the three new ones sit beside, including `$tableCellAlignment` and `$setEnclosingColumnAlignment`.
- [MarkdownEditor.ts:2478-2577](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2478-L2577) — `buildTableCellContextMenuItems` and `buildColumnAlignmentItems`, the menu builder and item-builder shapes the new ones copy.
- [MarkdownEditor.ts:2364-2378](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2364-L2378) — `buildLinkMenuItems`, the `enabled:` dimming idiom.
- [MenuItem.ts:70-71](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L70-L71), [:310-326](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L310-L326) — `enabled`, and the guarantee that a disabled item never opens its submenu.
- [plans/implemented/table-column-alignment-context-menu.md](plans/implemented/table-column-alignment-context-menu.md) — the column-wide increment this plan extends; its Non-Goals name per-cell alignment as out of scope, which this plan reverses.

---

## Non-Goals

- **Header-cell overrides.** A header cell's alignment is its column's delimiter marker, so it has nothing to override. `{align=…}` in a header cell is literal text in both halves.
- **`{align=justify}` on a cell.** A cell's override offers the same three values a column marker can, so **Align cell** and **Align column** share one vocabulary and one type. A `justify` group stays literal text.
- **Preserving overrides across an Align column call.** `setTableColumnAlignment` writes every cell of the column, so it clears them. Keeping them would need a per-cell "is an override" flag the node model does not have.
- **Making `insertTableRow` copy the column's alignment onto the new row's cells.** A row added after a column was aligned gets unformatted cells, which paint unaligned in the editor until the document is reloaded. The exported Markdown is unaffected — an unformatted cell always exports as inheriting — so this pre-existing wart stays out of scope, exactly as in the column-alignment plan.
- **A `getTableCellAlignment()` public getter.** The menu reads the alignment through the classification, and no sibling table command has a getter.
- **A keyboard shortcut or toolbar button for cell alignment.** The context menu is the requested surface.
- **Per-cell column *width*.** Width is a `<colgroup>` property with no per-cell equivalent in either half.

---

## Notes

[^model-already-per-cell]: `TableCellNode.setFormat` is a genuine per-cell property, and Lexical's reconciler writes `element.style.textAlign` from each cell's own format. `$setEnclosingColumnAlignment` ([MarkdownEditor.ts:236-250](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L236-L250)) loops over a whole column only because a column-wide semantic was wanted, not because a cell cannot hold its own value — the import path already sets each cell individually ([markdownTableTransformer.ts:347](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L347)). So the WYSIWYG surface paints a per-cell alignment correctly the moment one is written, with no node-model or theme change. The two real gaps this plan fills are an authoring path and a Markdown representation.

[^syntax-choice]: Three placements were considered. A group on the **delimiter cell** was rejected outright: the delimiter row has one segment per column, so it cannot address a single row's cell. A **second attribute row** after the delimiter row (one `{align=…}` per cell, per row) was rejected because it changes the block's line grammar in both parsers, breaks the "a table is a header row, a delimiter row, and body rows" shape every existing test asserts, and costs a full extra line per row that carries one override. The **trailing group on the cell's own text** needs no grammar change at all: both parsers already split rows into cell texts, and the dialect's other three attribute groups all attach to the end of the construct they modify. It also degrades honestly in a foreign renderer — the group shows as text after the cell's content, rather than destroying the table the way a `{width=…}` delimiter cell does.

[^header-is-the-column]: Letting a header cell hold an override as well as its column's marker would need the column's marker stored somewhere else, since a cell has exactly one format. The only place available is Lexical's `NodeState` on the `TableNode` — a parallel per-column array like `colWidths`. That was rejected: `@lexical/table` maintains `colWidths` itself on column insert and delete (`LexicalTable` lines 847-853 and 1034-1038 in the installed 0.49.0 build), and it would not maintain a `NodeState` array, so the alignments would silently drift out of alignment with the real columns after any column edit. Keeping the marker on the header cells means the data lives on nodes that move, split, and die with their column, which is why the current design has no drift to manage. The cost is one honest constraint — a header cell's alignment *is* its column's — which is also what GFM itself says.

[^column-read-fix]: `$tableCellAlignment(tableCell)` was a correct reading of the column only because every cell of a column carried one format. This plan makes body cells disagree with their column on purpose, so a right-click on an overridden cell would report that cell's override as the *column's* alignment and put the **Align column** checkmark on the wrong item. Reading the header-row cell through `$computeTableMap` is the same grid lookup `$setEnclosingColumnAlignment` already uses, and it stays correct for a merged cell, whose `startColumn` is what the map reports.

[^none-means-inherit]: `MarkdownTableAlignment`'s `"none"` means "no explicit setting at this level" in both commands; only the level differs. On a column it means "no delimiter marker"; on a cell it means "no override, use the column's". The menu labels diverge because the user-visible outcomes diverge — a column set to **None** renders left, while a cell set to **Column default** renders however its column does. The model cannot distinguish "explicitly overridden to the column's own value" from "inheriting", since both are one format equal to the column's; both are treated as inheriting, which is why choosing an override that matches the column exports no group.

[^unset-means-inherit]: The alternative — treating an empty format in an aligned column as an explicit "unaligned" override and exporting it as `{align=left}` — was rejected because `insertTableRow` creates cells with no format at all. Under that rule, adding a row to a centred table would plant a permanent `{align=left}` override on every new cell, turning a pre-existing cosmetic wart into real document damage. Reading an empty format as "inherit" keeps `insertTableRow`'s behaviour exactly where the column-alignment plan left it: the new row paints unaligned in the editor until the document reloads, and the exported Markdown is unaffected. Nothing is lost, because "unaligned" and "left" render identically in both halves — the viewer's `ts-ui-md-th` rule and the editor's `ts-ui-mde-table-cell-header` rule both force `text-align: left`, and a `<td>`'s own default is left.

[^dim-not-hide]: Omitting the entry on a header cell was the alternative. It was rejected on two counts. A menu whose item count changes with the clicked cell is harder to learn — the user cannot tell whether **Align cell** is missing because header cells do not support it or because they mis-clicked — and dimming states the constraint instead of hiding it. It also keeps every table-cell context building one item list of one length, so the four menu-shape tests stay single-count assertions rather than branching on header-ness. `enabled` is already how this menu expresses "this action does not apply here" for **Insert link…**, and `MenuItem` guarantees a disabled item opens no submenu, so a dimmed **Align cell** is inert rather than an empty panel.

[^column-clears-overrides]: Preserving overrides through an **Align column** call would need the document to record which cells are overridden, separately from what they are aligned to. The node model has one format per cell and no such flag, so "which cells were overridden" would have to be a second parallel structure with all the drift problems that carries. Clearing is also the more predictable behaviour: **Align column** already promises to re-align every cell of the column, header included, and a user reaching for it after scattering overrides is most likely trying to undo exactly those.

[^escape-needed]: Without an escape, a cell whose text genuinely ends with `{align=right}` would export unchanged, re-import as an override, and lose that text from the document — silent data loss on a plain round-trip. The dialect already treats this class of collision as worth handling: `escapeCellText` escapes a cell whose entire text is `<<` or `^^` so it round-trips as content rather than as a merge marker. The escape here is the same three lines in each direction and lives in the same shared module as the parser, so the two halves cannot drift. The unescape is deliberately done in the table layer, before the cell text reaches either inline converter, exactly as `unescapeCellText` already is — so neither `marked`'s backslash handling nor `@lexical/markdown`'s has to agree about `\{`.

[^no-new-type]: A dedicated `MarkdownCellAlignment` union sitting beside `MarkdownTableAlignment` would differ from it by one member and be mistaken for it on sight. The editor-facing command reuses `MarkdownTableAlignment`, which already carries the `"none"` member the "Column default" choice needs. Inside the two parsers the override is spelled as the inline union `"left" | "center" | "right" | null`, which is how `MdTableHeaderCell`, `MdTableBodyCell`, `parseDelimiterRow`, and `alignmentClass` already spell alignment in that layer. The exported `MarkdownCellAlignment` *interface* is a different thing — a `{ text, align }` pair, named for what it returns, not an alignment union.
