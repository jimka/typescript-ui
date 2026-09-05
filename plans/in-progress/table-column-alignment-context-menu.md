---
touches-shared:
    - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
    - packages/lib/src/typescript/lib/component/editor/editorTheme.ts
    - packages/lib/src/typescript/lib/component/editor/index.ts
    - packages/lib/tests/component/markdown-editor.test.ts
    - packages/lib/docs/components/MarkdownEditor.md
---

# Table Column Alignment from the MarkdownEditor Context Menu — Implementation Plan

## Overview

A GFM table's delimiter row carries one alignment marker per column (`:---`, `:---:`, `---:`, or plain `---`). [`MarkdownEditor`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) reads those markers on import and writes them back on export, but nothing between the two can change them: [markdownTableTransformer.ts:219](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L219) calls `cell.setFormat(...)` once per cell at import time and no other code ever calls it again. This plan adds the missing editing path: an **Align column** submenu on the WYSIWYG right-click menu for a table cell.

The work is confined to the editor. A new module-level helper writes one alignment onto **every cell in the caret's column**, a new public `setTableColumnAlignment` method wraps it, `$classifyContextMenuTarget` reports the clicked column's current alignment so the menu can check the active choice, and `buildTableCellContextMenuItems` ([MarkdownEditor.ts:1900](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1900)) grows a third submenu beside its existing Insert and Delete ones.

One rendering-parity fix rides along: the editor's `<th>` rule at [editorTheme.ts:158-165](packages/lib/src/typescript/lib/component/editor/editorTheme.ts#L158-L165) sets no `text-align`, so an unaligned header cell inherits the browser's centred `<th>` default, while the read-only viewer's own `<th>` rule at [Markdown.ts:274](packages/lib/src/typescript/lib/component/display/Markdown.ts#L274) forces `left`. Picking **None** would otherwise leave the two halves visibly disagreeing.

---

## Architecture Decisions

### Alignment is written to every cell in the column

`setTableColumnAlignment` sets the chosen alignment on every cell in the caret's column, header row included — never on the clicked cell alone. Lexical stores it as the cell's `ElementFormatType`, the same field the import path already writes.[^column-wide]

### The column's cells are enumerated through `$computeTableMap`

The helper resolves the caret's cell, then calls `@lexical/table`'s `$computeTableMap(table, cell, cell)` and walks the returned grid at the cell's `startColumn`. This mirrors `$setTableColumnIsHeader` in `@lexical/table`'s own `LexicalTableUtils`, which is that package's one existing "apply something to a whole column" operation.[^table-map]

### Left, Center, Right, None

The submenu offers exactly the four states a GFM delimiter row can express, in that order. There is no Justify item.[^no-justify]

### `markdownTableTransformer.ts` is not changed

The export path at [markdownTableTransformer.ts:254-258](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L254-L258) reads the header row's cells and is already correct once the whole column is kept in sync — the header cell is a cell of that column.[^export-unchanged]

### The read-only `Markdown` viewer is not changed

`alignmentClass` at [Markdown.ts:320-327](packages/lib/src/typescript/lib/component/display/Markdown.ts#L320-L327) already maps `marked`'s per-column `align` onto the three alignment classes and applies it per cell at [Markdown.ts:1658-1659](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1658-L1659). It renders whatever delimiter row the editor exports, so no viewer code is touched.

### The editor's header cells get `text-align: left`, matching the viewer

`TABLE_CELL_HEADER_CLASS`'s rule gains `textAlign: "left"`, restating the viewer's own `TH_CLASS` declaration and its reason.[^header-parity]

### The alignment choices are `checked` menu items

Each of the four choices is a plain `MenuItemConfig` carrying `checked` and an `action`, so picking one applies it and dismisses the menu. This mirrors the operator group in [Filter.ts:143-151](packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L143-L151), the codebase's existing mutually-exclusive menu group.[^checked-items]

### `columnAlignment` is an optional field on the `"table-cell"` classification

`ContextMenuTarget`'s `"table-cell"` member gains `columnAlignment?: MarkdownTableAlignment`, read by `$classifyContextMenuTarget` from the clicked cell. Optional, exactly like the `hasEnclosingBlock` field beside it, so the hand-built `{ kind: 'table-cell', … }` fixtures already in the test file keep compiling.[^optional-field]

### No options-bag field, no backing field

`setTableColumnAlignment` writes into the Lexical document, not into component state, so it takes no `MarkdownEditorOptions` field and no private cache — the same shape as `insertTableRow` / `deleteTableColumn` and every other command-API method. ARCHITECTURE.md's "expose on the `XOptions` bag" rule governs consumer-configurable component properties; a document mutation is not one.

---

## Public API

```typescript
/**
 * A GFM table column's alignment: the three markers a delimiter row can carry,
 * plus `"none"` for a column with no marker.
 *
 * @category Components
 */
export type MarkdownTableAlignment = "left" | "center" | "right" | "none";
```

```typescript
class MarkdownEditor extends Component<MarkdownEditorOptions> {
    /**
     * Sets the alignment of the column holding the caret, on every cell in
     * that column. No-op without throwing when the caret is not inside a
     * table cell.
     */
    setTableColumnAlignment(alignment: MarkdownTableAlignment): this;
}
```

`ContextMenuTarget`'s `"table-cell"` member gains one optional field; every other member is unchanged:

```typescript
export type ContextMenuTarget =
    | {
          kind: "table-cell";
          hasSelectedText: boolean;
          bold: boolean; italic: boolean; strikethrough: boolean; code: boolean;
          hasEnclosingBlock?: boolean;
          linkUrl?: string | null;
          columnAlignment?: MarkdownTableAlignment;
      }
    | { kind: "empty-line"; hasSelectedText: boolean }
    | { /* "text" — unchanged */ };
```

`MarkdownTableAlignment` is re-exported from the `component/editor` barrel alongside `MarkdownBlockType` ([index.ts:13](packages/lib/src/typescript/lib/component/editor/index.ts#L13)).

---

## Internal Structure

### The one alignment value, in three representations

| Menu choice | `MarkdownTableAlignment` | Cell format (`ElementFormatType`) | Exported delimiter segment | Viewer class |
|---|---|---|---|---|
| Left | `"left"` | `"left"` | `:---` | `ts-ui-md-align-left` |
| Center | `"center"` | `"center"` | `:---:` | `ts-ui-md-align-center` |
| Right | `"right"` | `"right"` | `---:` | `ts-ui-md-align-right` |
| None | `"none"` | `""` | `---` | none (`ts-ui-md-th` / `ts-ui-md-td` only) |

Worked round-trip — caret in column `b`, choose **Center**:

```
| a | b |          | a | b |
| --- | --- |  ->  | --- | :---: |
| 1 | 2 |          | 1 | 2 |
```

### New module-level helpers

Placed immediately after `$selectionIsInTableCell` ([MarkdownEditor.ts:162-164](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L162-L164)).

`$getEnclosingTableNode` ([MarkdownEditor.ts:143-153](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L143-L153)) is refactored so the cell it already resolves can be reused rather than re-derived:

```typescript
/**
 * Finds the table cell containing the caret, if any.
 *
 * @returns The enclosing `TableCellNode`, or `null` when the selection is not
 *   a range selection anchored inside a table cell.
 */
function $getEnclosingTableCellNode(): TableCellNode | null {
    const selection = $getSelection();

    return $isRangeSelection(selection)
        ? $getTableCellNodeFromLexicalNode(selection.anchor.getNode())
        : null;
}

function $getEnclosingTableNode(): TableNode | null {
    const cell = $getEnclosingTableCellNode();

    return cell === null ? null : $getTableNodeFromLexicalNodeOrThrow(cell);
}
```

Reading a cell's alignment back out. The `default:` catch-all deliberately folds every non-GFM `ElementFormatType` (`"justify"`, `"start"`, `"end"`, `""`) onto `"none"`, mirroring `formatDelimiterRow`'s own `default: return "---"` at [markdownTableTransformer.ts:129](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L129):

```typescript
/**
 * Reads a table cell's alignment as the GFM-expressible subset.
 *
 * @param cell - The cell to read.
 * @returns The cell's alignment; `"none"` for any format GFM cannot express.
 */
function $tableCellAlignment(cell: TableCellNode): MarkdownTableAlignment {
    switch (cell.getFormatType()) {
        case "left":   return "left";
        case "center": return "center";
        case "right":  return "right";
        default:       return "none";
    }
}
```

The column-wide write:

```typescript
/**
 * Sets `alignment` on every cell of the column holding the caret — the whole
 * column, because a GFM delimiter row carries one marker per column, not per
 * cell. No-op when the caret is not inside a table cell.
 *
 * @param alignment - The alignment to apply to the column.
 */
function $setEnclosingColumnAlignment(alignment: MarkdownTableAlignment): void {
    const cell = $getEnclosingTableCellNode();

    if (cell === null) {
        return;
    }

    const table = $getTableNodeFromLexicalNodeOrThrow(cell);
    const [tableMap, cellValue] = $computeTableMap(table, cell, cell);
    const format: ElementFormatType = alignment === "none" ? "" : alignment;

    for (const row of tableMap) {
        row[cellValue.startColumn]?.cell.setFormat(format);
    }
}
```

The optional index is not defensive padding: `$computeTableMap` builds a ragged grid for a non-rectangular table, so a short row genuinely has no entry at that column.

### Classification

`$classifyContextMenuTarget`'s table-cell branch ([MarkdownEditor.ts:493-497](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L493-L497)) keeps the cell it already resolves instead of discarding it:

```typescript
const tableCell = $getTableCellNodeFromLexicalNode(node);

if (tableCell !== null) {
    const hasEnclosingBlock = $findEnclosingInsertableBlock(node) !== null;
    const columnAlignment   = $tableCellAlignment(tableCell);

    return { kind: "table-cell", hasSelectedText, hasEnclosingBlock, linkUrl, columnAlignment, ...formatState };
}
```

### Command-API method

Placed after `deleteTableColumn` ([MarkdownEditor.ts:1450-1460](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1450-L1460)), before `deleteTable`. No `$selectionIsInTableCell()` guard: `$setEnclosingColumnAlignment` returns early on its own, the same way `insertParagraphBeforeBlock` relies on `$insertParagraphAroundEnclosingBlock`'s own guard.

```typescript
setTableColumnAlignment(alignment: MarkdownTableAlignment): this {
    const editor = this.ensureEditor();

    editor.update(() => {
        $setEnclosingColumnAlignment(alignment);
    }, { discrete: true });

    return this;
}
```

### Menu items

Appended to `buildTableCellContextMenuItems`'s array literal directly after the Delete submenu ([MarkdownEditor.ts:1922-1932](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1922-L1932)), inside the same `const items` initializer and before the `hasEnclosingBlock` push:

```typescript
{
    text:    "Align column",
    submenu: {
        label: "Align column",
        items: this.buildColumnAlignmentItems(context.columnAlignment ?? "none"),
    },
},
```

with a private builder placed beside `buildHeadingMenuItems` ([MarkdownEditor.ts:1952-1957](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1952-L1957)), whose `map`-over-a-tuple-list shape it follows:

```typescript
/**
 * Builds the four mutually-exclusive alignment items of the table-cell menu's
 * "Align column" submenu. Exactly one carries `checked: true`.
 *
 * @param current - The clicked column's current alignment.
 * @returns The four `MenuItemConfig` entries: Left, Center, Right, None.
 */
private buildColumnAlignmentItems(current: MarkdownTableAlignment): MenuItemConfig[] {
    return ([
        ["Left", "left"], ["Center", "center"], ["Right", "right"], ["None", "none"],
    ] as const).map(([text, alignment]) => ({
        text,
        checked: current === alignment,
        action:  () => { this.setTableColumnAlignment(alignment); },
    }));
}
```

---

## Ordered Implementation Steps

1. **Imports** ([MarkdownEditor.ts:25](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L25), [:36-42](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L36-L42)) — add `ElementFormatType` to the `import type … from "lexical"` list, and `TableCellNode` plus `$computeTableMap` to the `@lexical/table` import block. `TableCellNode` goes in the existing value import (it is a class), matching how `TableNode` is already imported there and used only as a type.
   Check: the project's typecheck reports no unresolved imports.

2. **Add the `MarkdownTableAlignment` type** beside `MarkdownBlockType` ([MarkdownEditor.ts:93](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L93)), with the JSDoc and `@category Components` tag shown in Public API.

3. **Extract `$getEnclosingTableCellNode`** and rewrite `$getEnclosingTableNode` in terms of it ([MarkdownEditor.ts:137-153](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L137-L153)), exactly as shown in Internal Structure. Leave `$selectionIsInTableCell` untouched — it keeps calling `$getEnclosingTableNode`.
   Check: `grep -n '\$selectionIsInTableCell' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` still reports five lines — its own definition plus the four call sites in `insertTableRow`, `deleteTableRow`, `insertTableColumn`, and `deleteTableColumn`.

4. **Add `$tableCellAlignment` and `$setEnclosingColumnAlignment`** immediately after `$selectionIsInTableCell`, exactly as shown in Internal Structure.

5. **Widen `ContextMenuTarget`** ([MarkdownEditor.ts:332-338](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L332-L338)) — add `columnAlignment?: MarkdownTableAlignment;` to the `"table-cell"` member only. Do not touch the `"text"` or `"empty-line"` members.

6. **Update `$classifyContextMenuTarget`**'s table-cell branch ([MarkdownEditor.ts:493-497](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L493-L497)) as shown in Internal Structure.

7. **Add `setTableColumnAlignment`** after `deleteTableColumn` ([MarkdownEditor.ts:1460](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1460)), as shown in Internal Structure. Its JSDoc must describe the column-wide behaviour in prose and must not `{@link}` either new `$`-prefixed helper (per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)).

8. **Add `buildColumnAlignmentItems`** beside `buildHeadingMenuItems` ([MarkdownEditor.ts:1952](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1952)), and **append the "Align column" submenu entry** to `buildTableCellContextMenuItems`'s array literal after the Delete submenu ([MarkdownEditor.ts:1932](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1932)). Leave `buildTextContextMenuItems` and `buildEmptyLineContextMenuItems` untouched.

9. **Update the class-level doc comment**'s command list ([MarkdownEditor.ts:713](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L713)) — add `` `setTableColumnAlignment` `` after `` `insertTableColumn`/`deleteTableColumn` ``. Also update the same doc comment's context-menu sentence ([:715-717](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L715-L717)) only if it enumerates menu contents; it does not today, so no edit is expected there.

10. **Export the type from the barrel** ([index.ts:13](packages/lib/src/typescript/lib/component/editor/index.ts#L13)) — add `MarkdownTableAlignment` to the existing `export type { … } from '~/component/editor/MarkdownEditor.js'` list.

11. **Add `textAlign: "left"` to `TABLE_CELL_HEADER_CLASS`'s rule** ([editorTheme.ts:158-165](packages/lib/src/typescript/lib/component/editor/editorTheme.ts#L158-L165)), with a comment restating the viewer's reason ("overrides the browser's centred `<th>` default so an unaligned header cell reads left, matching its unaligned body cells and the read-only viewer's own `ts-ui-md-th` rule"). Do not touch `TABLE_CELL_CLASS`.

12. **Add the `editorClassRuleWrites()` test memo** to `packages/lib/tests/component/markdown-editor.test.ts`, at module scope beside `attrsOf` ([:112-126](packages/lib/tests/component/markdown-editor.test.ts#L112-L126)), and point the existing lineHeight rule test ([:212-224](packages/lib/tests/component/markdown-editor.test.ts#L212-L224)) at it instead of calling `ensureMarkdownEditorClassRules()` directly:

    ```typescript
    /**
     * The class-rule style writes `ensureMarkdownEditorClassRules` makes. The
     * registrar is a module singleton guarded by `_classRulesEnsured`, so only
     * the first caller in this file records anything — this memo captures that
     * one run so several tests can assert against it.
     */
    let _editorClassRuleWrites: ReturnType<typeof ruleStyleWrites> | null = null;

    function editorClassRuleWrites(): ReturnType<typeof ruleStyleWrites> {
        if (_editorClassRuleWrites === null) {
            ensureMarkdownEditorClassRules();
            _editorClassRuleWrites = ruleStyleWrites(DOM.sink as RecordingDOMSink);
        }

        return _editorClassRuleWrites;
    }
    ```

13. **Update the three `$classifyContextMenuTarget` `toEqual` assertions** for table cells ([markdown-editor.test.ts:1352-1355](packages/lib/tests/component/markdown-editor.test.ts#L1352-L1355), [:1369-1372](packages/lib/tests/component/markdown-editor.test.ts#L1369-L1372), [:1391-1394](packages/lib/tests/component/markdown-editor.test.ts#L1391-L1394)) — each gains `columnAlignment: 'none'`, since all three seed a table whose delimiter row is `| --- | --- |` (or an `insertTable`-built one, whose cells start unformatted).
    Check: `grep -n "kind: 'table-cell'" packages/lib/tests/component/markdown-editor.test.ts` — every *other* match is a hand-built fixture fed to `buildContextMenuItems`, which compiles unchanged because the field is optional.

14. **Update the four table-cell menu-shape tests** ([markdown-editor.test.ts:1994](packages/lib/tests/component/markdown-editor.test.ts#L1994), [:2020](packages/lib/tests/component/markdown-editor.test.ts#L2020), [:2054](packages/lib/tests/component/markdown-editor.test.ts#L2054), [:2066](packages/lib/tests/component/markdown-editor.test.ts#L2066)) — retitle each to its new count and update the assertions:

    | Context | Count | Slice assertion |
    |---|---|---|
    | `linkUrl: null` | 15 → **16** | `items.slice(8)` gains `'Align column'` after `'Delete'` |
    | `linkUrl: null`, `hasEnclosingBlock` | 18 → **19** | `items.slice(15)` becomes `items.slice(16)`, same three entries |
    | `linkUrl` set | 16 → **17** | `items.slice(8)` gains `'Align column'` after `'Delete'` |
    | `linkUrl` set + `hasEnclosingBlock` | 19 → **20** | `items.slice(8)` gains `'Align column'` after `'Delete'` |

15. **Add `.setTableColumnAlignment('center')` to the chained no-throw test** ([markdown-editor.test.ts:1187-1198](packages/lib/tests/component/markdown-editor.test.ts#L1187-L1198)), and retitle it from "all five commands chain…" to "all six commands chain…".

16. **Add new tests** per Expected Behaviour below.

17. **Update `packages/lib/docs/components/MarkdownEditor.md`**:
    - Command API table ([:71-85](packages/lib/docs/components/MarkdownEditor.md#L71-L85)): add a `setTableColumnAlignment(alignment)` row after the `insertTableColumn`/`deleteTableColumn` row.
    - The no-op sentence ([:87](packages/lib/docs/components/MarkdownEditor.md#L87)): the existing "The row/column/table commands additionally no-op when the caret is not inside a table cell" clause already covers the new method; extend it only if the wording enumerates method names (it does not).
    - The "Right-click context menu" bullet ([:67](packages/lib/docs/components/MarkdownEditor.md#L67)): extend the table-cell clause to mention the Align column submenu, that alignment is a whole-column property, and that the four choices are the ones GFM can round-trip.

18. **Add a changelog entry** to `packages/lib/docs/reference/changelog/next.md` — one bullet under "## Added" → "### Components" ([:104](packages/lib/docs/reference/changelog/next.md#L104)) for the submenu, the `setTableColumnAlignment` method, and the `MarkdownTableAlignment` export; one bullet under "## Fixed" → "### Components" ([:295](packages/lib/docs/reference/changelog/next.md#L295)) for the header-cell `text-align` parity.

19. **Typecheck, test, docs.** Run the project's typecheck; run `packages/lib/tests/component/markdown-editor.test.ts`; run `npm run docs:api` and confirm zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/editorTheme.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/index.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

Nothing is created or deleted. `markdownTableTransformer.ts`, `Markdown.ts`, `markdownTransformers.ts`, `editorNodes.ts`, and `packages/lib/llms.txt` are all unchanged — see Architecture Decisions for why the transformer and the viewer need no edit.

---

## Expected Behaviour

Unit-testable headlessly. The offline harness runs the whole Lexical state path — `setValue`, the command API, and `getValue` — so every Markdown round-trip below is a real assertion, not a stand-in.

**Mechanism — the column-wide write** (new `describe`, beside the existing `'MarkdownEditor table commands'` block at [markdown-editor.test.ts:1116](packages/lib/tests/component/markdown-editor.test.ts#L1116)):

1. `setValue('| a | b |\n| --- | --- |\n| 1 | 2 |')`, `selectStart` (caret lands in the first header cell), `setTableColumnAlignment('center')` → `getValue()` normalizes to `| a | b |\n| :---: | --- |\n| 1 | 2 |`. Only the caret's column changes.
2. After the same call, reading each cell of column 0 through `lexicalOf(editor).read(...)` shows `getFormatType() === 'center'` on **every** row's cell — header and body alike — and `''` on every cell of column 1. This is the assertion that pins the column-wide rule rather than just its exported shadow.
3. Each of the four choices produces its delimiter segment, per the Internal Structure table: `'left'` → `:---`, `'center'` → `:---:`, `'right'` → `---:`, `'none'` → `---`.
4. `setTableColumnAlignment('none')` on a column imported as `:---:` clears it back to `---`, and clears the format on every cell of that column.
5. Applying an alignment then re-importing the exported Markdown into a fresh `MarkdownEditor` reproduces the same value (fixpoint), mirroring the round-trip pattern in the `'MarkdownEditor value round-trip (idempotence)'` block at [markdown-editor.test.ts:788](packages/lib/tests/component/markdown-editor.test.ts#L788).
6. `setTableColumnAlignment('center')` no-throws and changes nothing when the caret is not inside a table cell (a fresh editor with no table, and a document whose caret sits in prose).
7. A `'change'` listener fires once with the new Markdown, and `isDirty()` becomes `true`, when the call actually changes an alignment — the same seam every other command goes through ([MarkdownEditor.ts:1968-1979](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1968-L1979)).
8. Alignment survives a later structural edit: after aligning column 0 to `center`, `insertTableRow()` leaves the exported delimiter row reading `:---:` for that column. (The added row's own cells start unformatted — pre-existing `insertTableRow` behaviour that the delimiter row does not depend on, since it is derived from the header row. See Non-Goals.)
9. A column added by `insertTableColumn()` starts unaligned (`---`), leaving existing columns' markers untouched.

**Classification** (extending the existing `describe('$classifyContextMenuTarget')` block at [markdown-editor.test.ts:1201](packages/lib/tests/component/markdown-editor.test.ts#L1201)):

10. A node inside a cell of a column whose delimiter segment is `:---:` classifies as `columnAlignment: 'center'`; `:---` → `'left'`; `---:` → `'right'`; `---` → `'none'`.
11. The three existing table-cell `toEqual` assertions now include `columnAlignment: 'none'` (Ordered Implementation Steps §13).

**Menu** (extending the existing `describe('MarkdownEditor context menu')` block at [markdown-editor.test.ts:1734](packages/lib/tests/component/markdown-editor.test.ts#L1734), reusing its `findItem` / `submenuItemsOf` helpers):

12. A `"table-cell"` context builds an `'Align column'` item whose submenu holds exactly `['Left', 'Center', 'Right', 'None']`, in that order.
13. Exactly one submenu item carries `checked: true`, and it is the one matching `context.columnAlignment` — checked with `columnAlignment: 'right'` (→ `'Right'`) and with the field omitted entirely (→ `'None'`).
14. Each submenu item's `action()` reaches `MarkdownEditor.setTableColumnAlignment` with its own alignment — asserted end to end, in the same style as the existing "Delete submenu's Table item reaches `deleteTable`" test at [markdown-editor.test.ts:2082](packages/lib/tests/component/markdown-editor.test.ts#L2082): `insertTable(2, 3)`, invoke the `'Center'` item's `action`, then assert `getValue()`'s delimiter row reads `| :---: | --- | --- |`.
15. The item counts and slice orders in Ordered Implementation Steps §14's table hold.
16. `"text"` and `"empty-line"` contexts build no `'Align column'` item.

**Class rule** (new `describe`, using the `editorClassRuleWrites()` memo from Ordered Implementation Steps §12):

17. `ensureMarkdownEditorClassRules` writes `textAlign: 'left'` on a selector containing `ts-ui-mde-table-cell-header`, matching the read-only viewer's `ts-ui-md-th` rule.

**Manual-verify only** — the recording sink returns `null` from `mountView`, so no Lexical view attaches and no real `contextmenu` event can be dispatched (see the test file's header comment at [markdown-editor.test.ts:40-45](packages/lib/tests/component/markdown-editor.test.ts#L40-L45)):

- Right-clicking a table cell in the running app shows **Align column** below **Delete**, with a checkmark on the column's current alignment.
- Choosing Left / Center / Right visibly re-aligns **every** cell of that column, header included, and the menu closes.
- The read-only viewer beside the editor in the demo panel re-renders with the same alignment on the same column.
- With an unaligned table, the editor's header cells read left-aligned, matching the viewer (the parity fix from Ordered Implementation Steps §11).

---

## Verification

- The project's TypeScript check passes with no new errors.
- `packages/lib/tests/component/markdown-editor.test.ts` passes, including the new and updated cases above.
- `grep -rn 'setFormat' packages/lib/src/typescript/lib/component/editor/` — expect exactly four lines: the import path (`markdownTableTransformer.ts:219`), the two pre-existing `MarkdownEditor.ts` calls in `$selectEnclosingWordIfCollapsed` and `clearFormatting`, and the new `$setEnclosingColumnAlignment`. No other module gains one.
- `npm run docs:api` finishes with zero warnings.
- Manual smoke test: `npm run dev`, open the `MarkdownEditorPanel` demo ([packages/lib/src/typescript/MarkdownEditorPanel.ts](packages/lib/src/typescript/MarkdownEditorPanel.ts)) — it already renders the editor beside the live read-only viewer, which is what makes the editor/viewer parity checks above observable in one screen. Run the four manual-verify bullets there.

---

## Documentation Impact

- `packages/lib/docs/components/MarkdownEditor.md` — Command API table gains a row; the context-menu bullet gains a sentence. Exact locations in Ordered Implementation Steps §17.
- `packages/lib/docs/reference/changelog/next.md` — one "Added" bullet and one "Fixed" bullet. §18.
- `MarkdownTableAlignment` is exported from the `component/editor` barrel, so TypeDoc picks it up automatically once it carries `@category Components`, exactly as `MarkdownBlockType` does. No catalog or sidebar entry changes — the type documents onto the existing `component/editor` page, and no new component page is created.
- `ContextMenuTarget` is not re-exported from the barrel, so widening it needs no docs update.
- `packages/lib/llms.txt`'s one-line `MarkdownEditor` entry is a generic capability description and needs no change.

---

## Potential Challenges

- **Four existing menu-shape tests assert exact item counts and slice orders.** Step 14 gives the new counts and slice changes in full, so the implementer edits rather than re-derives them.
- **The editor class-rule registrar is a module singleton.** `ensureMarkdownEditorClassRules` short-circuits on `_classRulesEnsured`, which `installTestDOM` does not reset, so a second test calling it directly records nothing and would fail. Step 12's memo captures the single run for every test that needs it.
- **The menu's checkmark reads the clicked cell; the action writes the caret's column.** In a real right-click these are the same cell, because the browser places the caret at the click point inside a `contenteditable`; the existing Insert Column / Delete Column items already depend on exactly this. Mitigation is to keep the same dependency rather than introduce a second targeting rule — but a synthetic test that builds a context by hand must place the caret itself (via `selectStart` or `insertTable`) before invoking an action.
- **Public JSDoc must not `{@link}` the new `$`-prefixed helpers.** `setTableColumnAlignment`'s doc comment describes the column-wide behaviour in prose; the helpers' own comments may link back to it freely.

---

## Critical Files

- [MarkdownEditor.ts:137-164](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L137-L164) — `$getEnclosingTableNode` / `$selectionIsInTableCell`, the selection-to-table resolution this plan extracts a cell accessor from.
- [MarkdownEditor.ts:1424-1476](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1424-L1476) — `insertTableColumn` / `deleteTableColumn` / `deleteTable`, the command-API shape the new method follows.
- [MarkdownEditor.ts:1888-1957](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1888-L1957) — `buildTableCellContextMenuItems` and `buildHeadingMenuItems`, the menu builder gaining the submenu and the item-builder shape it copies.
- [markdownTableTransformer.ts:86-134](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L86-L134) — `parseDelimiterRow` / `formatDelimiterRow`, the GFM marker set this feature is bounded by, and the switch shape `$tableCellAlignment` mirrors.
- [markdownTableTransformer.ts:206-228](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L206-L228) — the import loop that already sets every cell in a column, establishing the rule this feature must preserve.
- [Markdown.ts:264-327](packages/lib/src/typescript/lib/component/display/Markdown.ts#L264-L327) — the viewer's `TH_CLASS` / alignment-class rules and `alignmentClass`; read to confirm no viewer change is needed, and for the `text-align: left` wording step 11 restates.
- [Filter.ts:137-151](packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L137-L151) — the `checked`-item mutually-exclusive menu group this plan mirrors.
- [MenuItem.ts:53-125](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L53-L125) — `MenuItemConfig`, for `checked` and `closeOnActivate` semantics.
- [markdown-editor.test.ts:1734-1790](packages/lib/tests/component/markdown-editor.test.ts#L1734-L1790) — the context-menu test block's `findItem` / `submenuItemsOf` / `rowOf` helpers the new menu tests reuse.
- [markdown-editor.test.ts:212-224](packages/lib/tests/component/markdown-editor.test.ts#L212-L224) — the existing class-rule test the memo in step 12 refactors.

---

## Non-Goals

- **Per-cell alignment.** Alignment is a column property in GFM; a per-cell override would export as nothing and silently vanish on reload.
- **Making `insertTableRow` copy the column alignments onto the new row's cells.** A row added after a column was aligned gets unformatted cells, so that one row paints unaligned in the editor until the document is reloaded. The exported Markdown is unaffected — the delimiter row is derived from the header row — and this is pre-existing `insertTableRow` behaviour, reachable today by importing an aligned table and adding a row. Fixing it means editing a command this plan otherwise does not touch.
- **A `getTableColumnAlignment()` public getter.** Nothing needs it — the menu reads the alignment through the classification, and no sibling table command has a getter either.
- **A keyboard shortcut or toolbar button for alignment.** The context menu is the requested surface; the demo panel's existing four table buttons are left as they are.
- **Aligning a whole multi-column selection at once.** The action targets the single column holding the caret, matching `insertTableColumn` / `deleteTableColumn`.

---

## Notes

[^column-wide]: Three consumers read the alignment, and they disagree about which cells they look at, so only a column-wide write keeps all three consistent. The exported Markdown is built from the **header row's** cells alone (`headerCells.map((cell) => cell.getFormatType())`, [markdownTableTransformer.ts:256](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L256)). The read-only viewer applies the delimiter row's marker to **every** cell of the column, header and body alike ([Markdown.ts:1658-1659](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1658-L1659)). The WYSIWYG surface renders **each cell's own** format: Lexical's reconciler writes `element.style.textAlign` per element whenever an `ElementNode`'s format is non-zero, on both the create path and the update path. Writing only the clicked cell would therefore produce three different results at once — a correct delimiter row but a half-aligned editor if the clicked cell happened to be in the header, or a correctly-painted single cell and an unchanged delimiter row if it was not. The import path already resolves this the same way: its loop calls `cell.setFormat(alignments[column] ?? "")` for every row's cell, not just the header's ([markdownTableTransformer.ts:206-221](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L206-L221)). Keeping the whole column in sync is therefore the rule the document is already built to satisfy, not a new one this feature invents.

[^table-map]: `@lexical/table` 0.49.0 offers two ways to reach a column. `$getTableColumnIndexFromTableCellNode` returns the cell's index **within its row** (`tableRowNode.getChildren().findIndex(...)`), which is not the grid column once any cell spans columns. `$computeTableMap(tableNode, cellA, cellB)` builds the real grid — a `TableMapValueType[][]` whose every slot names the cell occupying it plus its `startRow` / `startColumn` — and returns the located cell's own map entry alongside it. `$setTableColumnIsHeader`, the package's only other whole-column operation, uses the second form; this plan follows it. `MarkdownEditor` registers `registerTableCellUnmergeTransform` ([MarkdownEditor.ts:1594](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1594)), which splits any merged cell back apart, so in practice the two forms agree in this editor — but a merged cell can exist transiently inside one update (a paste, before the transform runs), and the grid form costs one extra call to be right in that window too. The `visited`-set dedup `$setTableColumnIsHeader` carries is deliberately omitted: `setFormat` is idempotent, so a spanning cell reached twice is simply written the same value twice.

[^no-justify]: GFM's delimiter row can express exactly four states — `:---`, `:---:`, `---:`, and plain `---` — and `parseDelimiterRow` ([markdownTableTransformer.ts:86-110](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L86-L110)) parses precisely those, while `formatDelimiterRow` ([:123-134](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L123-L134)) emits precisely those. The read-only viewer matches: `marked` reports `"center" | "left" | "right" | null` per column and `alignmentClass` has three classes plus a `null`. Lexical's `ElementFormatType` is wider (`'left' | 'start' | 'center' | 'right' | 'end' | 'justify' | ''`), so a Justify item would be technically expressible in the editor's document — and would then export as a bare `---` and reload as unaligned, silently discarding the user's choice. The four-item menu is what the format can actually hold. `$tableCellAlignment`'s `default:` arm folds `"justify"`, `"start"`, and `"end"` onto `"none"` so a format arriving from elsewhere (a paste carrying a `text-align` style) reports as the thing it will actually export as.

[^export-unchanged]: The export path was checked for two failure modes and has neither. It reads only the header row's cells, which is correct once the whole column carries one value — the header cell is a cell of that column, so it holds the same format as the rest. And `formatDelimiterRow`'s `switch` has a `default:` arm returning `---`, so a format outside the GFM set (which this feature cannot produce, but a paste could) exports as unaligned rather than throwing or emitting a malformed segment. Widening the export to, say, take the majority format across a column would only paper over a column that had gone out of sync — the fix for which is to never let it, which is what the column-wide write does.

[^header-parity]: The viewer's `ts-ui-md-th` rule sets `textAlign: "left"` with the comment "Overrides the browser's centred `<th>` default so an unaligned header cell reads left, matching its unaligned body cells" ([Markdown.ts:274](packages/lib/src/typescript/lib/component/display/Markdown.ts#L274)). The editor's `ts-ui-mde-table-cell-header` rule sets border, padding, and font weight but no `text-align`, so its `<th>` keeps the user agent's centred default. The gap predates this feature — every unaligned table already renders with centred headers in the editor and left headers in the viewer — but the feature makes it reachable as an apparent bug in itself: a user who picks **None** to clear a column's alignment would watch the editor's header stay centred while the exported Markdown renders left. The fix is one declaration on a rule this plan is already reasoning about, it changes nothing for an explicitly aligned column (Lexical writes `text-align` inline on the cell element, which outranks any class rule), and it makes the two halves agree. `ts-ui-mde-table-cell` is deliberately not touched: `<td>`'s own default is already left.

[^checked-items]: Two shapes for a mutually-exclusive menu group exist in this codebase. `Split`'s gutter menu builds `RadioMenuRow` instances through `row:` factories and keeps the panel open, which forces manual sibling bookkeeping — a `syncCollapseRows` helper that rewrites both rows after each click, because a `RadioMenuRow` click only ever selects and never clears its siblings ([Split.ts:1111-1199](packages/lib/src/typescript/lib/layout/Split.ts#L1111-L1199)). `Filter`'s operator group uses plain `MenuItemConfig` entries carrying `checked`, with the default `closeOnActivate`, so picking one applies it and dismisses the menu and no sibling ever needs clearing ([Filter.ts:143-151](packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L143-L151)). Alignment is a single terminal choice — pick one, done — which is the second shape exactly, and it needs no bookkeeping at all: this context menu is built fresh on every right-click (`Menu.show(x, y, items)` rebuild mode), so the `checked` flags are computed from the live document each time the menu appears. The `CheckboxMenuRow` rows already in this same menu are not a counter-precedent: `buildFormatToggleItems` uses them precisely because bold/italic/strikethrough/code are *independent* toggles a user may want to flip several of in one open ([MarkdownEditor.ts:1742-1772](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1742-L1772)), which is the opposite of a one-of-four choice.

[^optional-field]: `packages/lib/tests/component/markdown-editor.test.ts` builds a `"table-cell"` context by hand in nine places and feeds it straight to `buildContextMenuItems`, bypassing `$classifyContextMenuTarget` entirely (lines 1997, 2023, 2038, 2048, 2057, 2069, 2087, 2111, 2112), plus two loops that pass the kind as a variable over `['text', 'table-cell']` (lines 1812, 1831). A required `columnAlignment` field would fail compilation at every one of them until each was edited, for tests that have nothing to do with alignment. Declaring it optional and reading it as `context.columnAlignment ?? "none"` keeps them all compiling and gives the right default — a fixture that says nothing about alignment behaves as an unaligned column. This is the same call the neighbouring `hasEnclosingBlock` field already made, for the same reason. The three tests that assert the classifier's *real* return value via `toEqual` still need the key added (step 13), because `toEqual` fails on an unexpected extra key regardless of whether the type declares it optional.
