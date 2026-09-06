# MarkdownEditor Context-Menu Reorganization — Implementation Plan

## Overview

`MarkdownEditor`'s right-click context menu is built by a cluster of private methods in [MarkdownEditor.ts](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts): a dispatcher, `buildContextMenuItems` ([:2301](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2301)), routes to `buildTextContextMenuItems` ([:2473](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2473)), `buildEmptyLineContextMenuItems` ([:2537](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2537)), or `buildTableCellContextMenuItems` ([:2563](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2563)) depending on what was clicked. Several smaller builders are shared across those three: `buildFormatToggleItems` ([:2320](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2320)), `buildTextStyleMenuItem` ([:2350](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2350)), `buildColumnsMenuItem` ([:2404](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2404)), `buildHeadingMenuItems` ([:2628](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2628)), and `buildColumnAlignmentItems` ([:2642](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2642)).

This plan makes four changes, all confined to that cluster:

1. **Table-cell menu** — every table-structure action (row/column insert, row/column/table delete, merge, unmerge, column width, column alignment) moves under one new top-level **Table** submenu, replacing today's flat mix of two submenus and three loose items.
2. **Format toggles** — the five shared checkbox rows reorder from Bold/Italic/Strikethrough/Inline code/Underline to **Bold/Italic/Underline/Strikethrough/Code**, and "Inline code" is relabelled "Code".
3. **Empty-line menu** — Quote, Table, Code block, and Image… move under one new **Insert** submenu, which also gains two new items, **Bulleted list** and **Numbered list**, wired to the already-existing `toggleUnorderedList()` ([:1383](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1383)) and `toggleOrderedList()` ([:1395](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1395)) commands. Heading and Columns stay top-level.
4. Test assertions in [markdown-editor.test.ts](packages/lib/tests/component/markdown-editor.test.ts) and the "Right-click context menu" section of [MarkdownEditor.md](packages/lib/docs/components/MarkdownEditor.md) are updated to match.

No editor command is added, removed, or changed — only which menu item calls it, and where that item sits.

---

## Architecture Decisions

### The Table submenu nests Insert/Delete/Align column exactly as "Text style" nests Colour/Font/Size

`buildTextStyleMenuItem` ([:2350](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2350)) is already a two-level submenu (Text style → Colour/Font/Size → preset items), so a Table submenu that is itself two levels (Table → Insert/Delete/Align column → leaf items) matches a nesting depth this dialect already uses.[^nesting-precedent] `MenuItemConfig.submenu` / `MenuConfig.items` ([MenuItem.ts:113](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L113), [:142](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L142)) is recursive, so no new type or `Menu` change is needed.

### The wrap is a pure relocation — internal order and grouping are untouched

Today's Insert submenu, Delete submenu, and the trailing Merge cells / Unmerge cell / Column width… / Align column run sit inside `buildTableCellContextMenuItems` in that exact order, with one separator before Merge cells. The new Table submenu's `items` array is that same sequence, unchanged, with no separators added or removed.[^minimal-diff] Only the wrapping "Table" entry is new.

### `buildTableMenuItem` becomes its own private method

`buildColumnAlignmentItems` ([:2642](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2642)) is already extracted into its own method despite having exactly one call site, and `buildTextStyleMenuItem`/`buildColumnsMenuItem` are extracted despite building a single `MenuItemConfig` rather than a list — this file's convention is "a submenu big enough to need its own JSDoc gets its own method," not "only shared builders get extracted." The new Table submenu is at least as large as any of those three, so it follows the same convention as `buildTableMenuItem(columnAlignment: MarkdownTableAlignment): MenuItemConfig`, taking the same narrow parameter shape `buildColumnAlignmentItems` already uses (not the whole `context` object).

### Format toggles: reorder and rename only, no new mechanism

Bold, Italic, Underline, Strikethrough, Code — the five `toggleRow(...)` calls inside `buildFormatToggleItems` are reordered and the fourth call's label string changes from `"Inline code"` to `"Code"`. The handler (`toggleInlineCode()`) and the underlying command are untouched; only the menu label and position change.

| Position | Old label | New label |
|---|---|---|
| 0 | Bold | Bold |
| 1 | Italic | Italic |
| 2 | Strikethrough | Underline |
| 3 | Inline code | Strikethrough |
| 4 | Underline | Code |

This table is also the map for updating every test that indexes into these five rows by position (see Step 5).

### The empty-line Insert submenu groups "convert this line" actions before "insert a new object" actions

Inside the new Insert submenu, Quote/Code block/Bulleted list/Numbered list (all convert the current empty paragraph to a different block type) come first, then a separator, then Table/Image… (both insert a new structure at the caret). This mirrors the separator that already existed in the flat list, which fell between "Code block" and "Table" — the grouping was already there; the wrap only gives it a heading.[^insert-grouping]

### Heading and Columns stay top-level in the empty-line menu

Per the request's default, and confirmed here: **Heading** is already a 6-item submenu on its own, and folding it inside Insert would add a third click (Insert ▸ Heading ▸ H2) to what is likely the single most common empty-line action, a regression from today's two clicks. **Columns** is the same `buildColumnsMenuItem()` shared verbatim with the text-context menu, where it also stays top-level (no Insert-style wrapper exists there); moving it into Insert only on the empty-line side would make its position inconsistent between the two menus it appears in, for no benefit.

### `toggleUnorderedList()` / `toggleOrderedList()` are reused as-is; no new command needed

Both methods no-op "without a range selection" ([:1379](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1379), [:1391](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1391)), which — confirmed by reading `$isRangeSelection` usage throughout the file (e.g. [:580](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L580)) — refers to Lexical's `RangeSelection` type, not to a non-collapsed selection. A collapsed caret on an empty line is a `RangeSelection`, so both commands fire correctly from the empty-line menu exactly as `setBlockType("quote")` already does for the existing Quote item at the same call site.

### "Bulleted list" / "Numbered list" do NOT get added to the text-context "Block style" submenu

This was raised as an open question, not part of the core request. Recommendation: **do not add them**, and this plan does not.[^block-style-rejected]

---

## Internal Structure

The four methods after the change (full bodies, so the implementer transcribes rather than infers):

```typescript
/**
 * Builds the five inline-format toggle items shared by the text and
 * table-cell context menus: real {@link CheckboxMenuRow} rows, so the
 * check renders as an actual checkbox rather than a text checkmark and
 * activating one leaves the menu open (matching the `MenuBar` demo's
 * "Options" menu, e.g. its `Auto-Save` row) — letting several formats be
 * toggled in one right-click.
 *
 * @param format - The current selection's inline-format state.
 * @returns The five `MenuItemConfig` entries: Bold, Italic, Underline, Strikethrough, Code.
 */
private buildFormatToggleItems(
    format: { bold: boolean; italic: boolean; strikethrough: boolean; code: boolean; underline: boolean },
): MenuItemConfig[] {
    const toggleRow = (text: string, checked: boolean, toggle: () => void): MenuItemConfig => ({
        row: () => {
            const row = new CheckboxMenuRow({ text, checked });

            row.on("action", toggle);

            return row;
        },
    });

    return [
        toggleRow("Bold", format.bold, () => this.toggleBold()),
        toggleRow("Italic", format.italic, () => this.toggleItalic()),
        toggleRow("Underline", format.underline, () => this.toggleUnderline()),
        toggleRow("Strikethrough", format.strikethrough, () => this.toggleStrikethrough()),
        toggleRow("Code", format.code, () => this.toggleInlineCode()),
    ];
}
```

```typescript
/**
 * Builds the insert menu shown over an empty line (outside any table): a
 * Heading submenu, an Insert submenu (block conversions plus new-object
 * insertion), and the Columns submenu. Omits a "Paragraph" item — the
 * classification already guarantees the caret sits in an empty paragraph,
 * so converting it to a paragraph is a guaranteed no-op.
 *
 * @param context - The `"empty-line"` classification, carrying whether
 *   the current selection has text (a drag-selection ending on an empty
 *   line, which still classifies as `"empty-line"`).
 * @returns The `MenuItemConfig` array for {@link Menu.show}.
 */
private buildEmptyLineContextMenuItems(context: ContextMenuTarget & { kind: "empty-line" }): MenuItemConfig[] {
    return [
        ...this.clipboardMenuItems(context.hasSelectedText),
        { separator: true },
        { text: "Heading", submenu: { label: "Heading", items: this.buildHeadingMenuItems() } },
        {
            text:    "Insert",
            submenu: {
                label: "Insert",
                items: [
                    { text: "Quote", action: () => this.setBlockType("quote") },
                    { text: "Code block", action: () => this.setBlockType("code") },
                    { text: "Bulleted list", action: () => this.toggleUnorderedList() },
                    { text: "Numbered list", action: () => this.toggleOrderedList() },
                    { separator: true },
                    { text: "Table", action: () => this.insertTable(2, 3) },
                    { text: "Image…", action: () => void this.promptAndInsertImage() },
                ],
            },
        },
        this.buildColumnsMenuItem(),
    ];
}
```

```typescript
/**
 * Builds the "Table" submenu shown in the table-cell context menu: an
 * Insert submenu (the four directional row/column inserts), a Delete
 * submenu (row, column, or the whole table), Merge cells, Unmerge cell,
 * Column width…, and the Align column submenu — every table-structure
 * action gathered under one entry, at the same nesting depth "Text style"
 * already uses for its Colour/Font/Size sub-submenus.
 *
 * @param columnAlignment - The clicked column's current alignment, forwarded to {@link buildColumnAlignmentItems}.
 * @returns The `MenuItemConfig` for the "Table" submenu.
 */
private buildTableMenuItem(columnAlignment: MarkdownTableAlignment): MenuItemConfig {
    return {
        text:    "Table",
        submenu: {
            label: "Table",
            items: [
                {
                    text:    "Insert",
                    submenu: {
                        label: "Insert",
                        items: [
                            { text: "Row above", action: () => this.insertTableRow(false) },
                            { text: "Row below", action: () => this.insertTableRow(true) },
                            { text: "Column left", action: () => this.insertTableColumn(false) },
                            { text: "Column right", action: () => this.insertTableColumn(true) },
                        ],
                    },
                },
                {
                    text:    "Delete",
                    submenu: {
                        label: "Delete",
                        items: [
                            { text: "Row", action: () => this.deleteTableRow() },
                            { text: "Column", action: () => this.deleteTableColumn() },
                            { text: "Table", action: () => this.deleteTable() },
                        ],
                    },
                },
                { separator: true },
                { text: "Merge cells", action: () => this.mergeTableCells() },
                { text: "Unmerge cell", action: () => this.unmergeTableCell() },
                { text: "Column width…", action: () => void this.promptAndSetColumnWidth() },
                {
                    text:    "Align column",
                    submenu: {
                        label: "Align column",
                        items: this.buildColumnAlignmentItems(columnAlignment),
                    },
                },
            ],
        },
    };
}
```

```typescript
/**
 * Builds the menu shown over a table cell (populated or empty): the same
 * shared inline-format toggles and Clear formatting as the text context
 * menu — a cell holds inline text too, just never a heading or quote in
 * this dialect, so no Block style submenu — then a Table submenu holding
 * every table-structure action.
 *
 * @param context - The `"table-cell"` classification, carrying the
 *   current selection's inline-format state.
 * @returns The `MenuItemConfig` array for {@link Menu.show}.
 */
private buildTableCellContextMenuItems(context: ContextMenuTarget & { kind: "table-cell" }): MenuItemConfig[] {
    const items: MenuItemConfig[] = [
        ...this.clipboardMenuItems(context.hasSelectedText),
        { separator: true },
        ...this.buildFormatToggleItems(context),
        { separator: true },
        ...this.buildLinkMenuItems(context),
        { separator: true },
        this.buildTextStyleMenuItem(),
        { separator: true },
        { text: "Clear formatting", action: () => this.clearFormatting() },
        { separator: true },
        this.buildTableMenuItem(context.columnAlignment ?? "none"),
    ];

    if (context.hasEnclosingBlock) {
        items.push(
            { separator: true },
            { text: "Insert line before block", action: () => this.insertParagraphBeforeBlock() },
            { text: "Insert line after block", action: () => this.insertParagraphAfterBlock() },
        );
    }

    return items;
}
```

Place `buildTableMenuItem` directly after `buildColumnAlignmentItems` (after [:2650](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2650)) — it is the last method in the file's menu-building section and `buildTableMenuItem` composes it.

---

## Ordered Implementation Steps

1. **Reorder and relabel the format toggles.** In `buildFormatToggleItems` ([:2320-2340](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2320-L2340)), replace the `@returns` line and the returned array with the versions in Internal Structure.
   Verify: `grep -n "Inline code" packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` returns zero matches.

2. **Add `buildTableMenuItem`.** Insert the new private method from Internal Structure directly after `buildColumnAlignmentItems` ([:2650](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2650)).
   Verify: `npm run typecheck` — `MarkdownTableAlignment` is already imported/used in this file (by `buildColumnAlignmentItems`'s own signature), so no new import is needed.

3. **Rewrite `buildTableCellContextMenuItems`.** Replace the body ([:2563-2620](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2563-L2620)) with the version in Internal Structure: delete the inline `Insert` submenu, `Delete` submenu, and the `Merge cells`/`Unmerge cell`/`Column width…`/`Align column` block, replacing that whole run with the single `this.buildTableMenuItem(context.columnAlignment ?? "none")` call. Update the method's JSDoc to match (see Internal Structure).
   Verify: `grep -n "text:.*\"Insert\"\|text:.*\"Delete\"" packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — both now appear only inside `buildTableMenuItem` (once each), not inside `buildTableCellContextMenuItems` directly.

4. **Rewrite `buildEmptyLineContextMenuItems`.** Replace the body ([:2537-2549](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2537-L2549)) with the version in Internal Structure: wrap Quote/Code block/Table/Image… in a new `Insert` submenu, add `Bulleted list`/`Numbered list` inside it, and leave `Heading`/`Columns` top-level. Update the method's JSDoc to match (see Internal Structure).
   Verify: `npm run typecheck` passes.

5. **Update `markdown-editor.test.ts`.** All edits are inside the `describe('MarkdownEditor context menu', ...)` block starting at [:2309](packages/lib/tests/component/markdown-editor.test.ts#L2309). Apply each of the following in place. Nothing outside this block needs to change (confirmed by searching the whole file for every changed label — see Non-Goals).

   **5a. Checked-row order** ([:2331-2344](packages/lib/tests/component/markdown-editor.test.ts#L2331-L2344)) — update the comment and the five expected values per the reorder table in Architecture Decisions:
   ```typescript
   it('a "text" context builds a real checkbox row per format, reflecting each active state', () => {
       const editor = new MarkdownEditor();
       const items = contextMenuMethodsOf(editor).buildContextMenuItems({
           kind: 'text', hasSelectedText: true, ...SOME_FORMATS,
       });

       // Order: Cut, Copy, Paste, separator, then buildFormatToggleItems's
       // Bold, Italic, Underline, Strikethrough, Code.
       expect(rowOf(items[4]).isChecked()).toBe(true);
       expect(rowOf(items[5]).isChecked()).toBe(false);
       expect(rowOf(items[6]).isChecked()).toBe(false);
       expect(rowOf(items[7]).isChecked()).toBe(true);
       expect(rowOf(items[8]).isChecked()).toBe(false);
   });
   ```
   The three "text" context count tests ([:2346](packages/lib/tests/component/markdown-editor.test.ts#L2346), [:2361](packages/lib/tests/component/markdown-editor.test.ts#L2361), [:2373](packages/lib/tests/component/markdown-editor.test.ts#L2373)) and the Bold-checkbox-wiring test ([:2554](packages/lib/tests/component/markdown-editor.test.ts#L2554)) need no change — none of them index into positions 5-8, and their totals (19/20/22) are unaffected since the reorder doesn't change the item count.

   **5b. Table-cell 17/18/20/21-entry tests** — replace all four of [:2588-2614](packages/lib/tests/component/markdown-editor.test.ts#L2588-L2614), [:2616-2626](packages/lib/tests/component/markdown-editor.test.ts#L2616-L2626), [:2650-2661](packages/lib/tests/component/markdown-editor.test.ts#L2650-L2661), and [:2663-2678](packages/lib/tests/component/markdown-editor.test.ts#L2663-L2678) with:
   ```typescript
   it('a "table-cell" context with linkUrl: null returns 17 entries: Cut/Copy/Paste, 5 format rows, Insert link, Text style, Clear formatting, then a Table submenu', () => {
       const editor = new MarkdownEditor();
       const items = contextMenuMethodsOf(editor).buildContextMenuItems({
           kind: 'table-cell', hasSelectedText: true, linkUrl: null, ...SOME_FORMATS,
       });

       expect(items).toHaveLength(17);
       expect(items.slice(0, 4).map((item) => item.text ?? '(separator)')).toEqual([
           'Cut', 'Copy', 'Paste', '(separator)',
       ]);
       expect(rowOf(items[4]).isChecked()).toBe(true);    // Bold
       expect(rowOf(items[5]).isChecked()).toBe(false);   // Italic
       expect(rowOf(items[6]).isChecked()).toBe(false);   // Underline
       expect(rowOf(items[7]).isChecked()).toBe(true);    // Strikethrough
       expect(rowOf(items[8]).isChecked()).toBe(false);   // Code
       expect(items.slice(9).map((item) => item.text ?? '(separator)')).toEqual([
           '(separator)', 'Insert link…', '(separator)', 'Text style', '(separator)', 'Clear formatting', '(separator)', 'Table',
       ]);

       const tableItems = submenuItemsOf(findItem(items, 'Table'));
       expect(tableItems?.map((item) => item.text ?? '(separator)')).toEqual([
           'Insert', 'Delete', '(separator)', 'Merge cells', 'Unmerge cell', 'Column width…', 'Align column',
       ]);
       expect(submenuItemsOf(findItem(tableItems ?? [], 'Insert'))?.map((item) => item.text)).toEqual([
           'Row above', 'Row below', 'Column left', 'Column right',
       ]);
       expect(submenuItemsOf(findItem(tableItems ?? [], 'Delete'))?.map((item) => item.text)).toEqual([
           'Row', 'Column', 'Table',
       ]);
   });

   it('a "table-cell" context with hasEnclosingBlock builds 20 entries: the 17 existing (with no link) plus a separator and the two new items', () => {
       const editor = new MarkdownEditor();
       const items = contextMenuMethodsOf(editor).buildContextMenuItems({
           kind: 'table-cell', hasSelectedText: true, linkUrl: null, ...SOME_FORMATS, hasEnclosingBlock: true,
       });

       expect(items).toHaveLength(20);
       expect(items.slice(17).map((item) => item.text ?? '(separator)')).toEqual([
           '(separator)', 'Insert line before block', 'Insert line after block',
       ]);
   });
   ```
   (Leave the "Insert line before/after block" wiring test between these two — [:2628-2648](packages/lib/tests/component/markdown-editor.test.ts#L2628-L2648) — unchanged; it uses `.find()`, not indices.)
   ```typescript
   it('a "table-cell" context with a linkUrl returns 18 entries: the same shape but Edit link + Remove link instead of Insert link', () => {
       const editor = new MarkdownEditor();
       const items = contextMenuMethodsOf(editor).buildContextMenuItems({
           kind: 'table-cell', hasSelectedText: true, linkUrl: 'https://example.com', ...SOME_FORMATS,
       });

       expect(items).toHaveLength(18);
       expect(items.slice(9).map((item) => item.text ?? '(separator)')).toEqual([
           '(separator)', 'Edit link…', 'Remove link', '(separator)', 'Text style', '(separator)', 'Clear formatting', '(separator)', 'Table',
       ]);
   });

   it('a "table-cell" context with both a linkUrl and hasEnclosingBlock combines all groups: link items, Text style, Clear formatting, the Table submenu, and the two block items, in that order', () => {
       const editor = new MarkdownEditor();
       const items = contextMenuMethodsOf(editor).buildContextMenuItems({
           kind: 'table-cell', hasSelectedText: true, linkUrl: 'https://example.com', ...SOME_FORMATS, hasEnclosingBlock: true,
       });

       expect(items).toHaveLength(21);
       expect(items.slice(0, 4).map((item) => item.text ?? '(separator)')).toEqual([
           'Cut', 'Copy', 'Paste', '(separator)',
       ]);
       expect(items.slice(9).map((item) => item.text ?? '(separator)')).toEqual([
           '(separator)', 'Edit link…', 'Remove link', '(separator)', 'Text style', '(separator)', 'Clear formatting', '(separator)',
           'Table', '(separator)', 'Insert line before block', 'Insert line after block',
       ]);
   });
   ```

   **5c. Nested Table-submenu lookups** — the following four tests currently call `findItem(items, ...)` directly for `'Delete'` or `'Align column'`, which no longer exist at the top level. Replace each with a lookup through `submenuItemsOf(findItem(items, 'Table'))` first:

   Replace [:2680-2692](packages/lib/tests/component/markdown-editor.test.ts#L2680-L2692):
   ```typescript
   it("the table-cell menu's Table ▸ Delete ▸ Table item reaches MarkdownEditor.deleteTable", () => {
       const editor = new MarkdownEditor();
       editor.insertTable(2, 3);   // caret lands in the first header cell

       const items = contextMenuMethodsOf(editor).buildContextMenuItems({
           kind: 'table-cell', hasSelectedText: true, ...SOME_FORMATS,
       });
       const tableItems = submenuItemsOf(findItem(items, 'Table'));

       submenuItemsOf(findItem(tableItems ?? [], 'Delete'))?.find((item) => item.text === 'Table')?.action?.();

       const tokens = lexMarkdown(editor.getValue());
       expect(tokens.some((token) => token.type === 'mdtable')).toBe(false);
   });
   ```
   Replace [:2694-2703](packages/lib/tests/component/markdown-editor.test.ts#L2694-L2703):
   ```typescript
   it("the table-cell menu's Table ▸ Align column submenu offers exactly Left, Center, Right, None, in that order", () => {
       const editor = new MarkdownEditor();
       const items = contextMenuMethodsOf(editor).buildContextMenuItems({
           kind: 'table-cell', hasSelectedText: true, ...SOME_FORMATS,
       });
       const tableItems = submenuItemsOf(findItem(items, 'Table'));

       expect(submenuItemsOf(findItem(tableItems ?? [], 'Align column'))?.map((item) => item.text)).toEqual([
           'Left', 'Center', 'Right', 'None',
       ]);
   });
   ```
   Replace [:2705-2719](packages/lib/tests/component/markdown-editor.test.ts#L2705-L2719):
   ```typescript
   it('exactly one "Align column" item is checked, matching context.columnAlignment (or "None" when omitted)', () => {
       const editor = new MarkdownEditor();

       const rightChecked = contextMenuMethodsOf(editor).buildContextMenuItems({
           kind: 'table-cell', hasSelectedText: true, ...SOME_FORMATS, columnAlignment: 'right',
       });
       const rightTableItems = submenuItemsOf(findItem(rightChecked, 'Table'));
       const rightItems = submenuItemsOf(findItem(rightTableItems ?? [], 'Align column'));
       expect(rightItems?.map((item) => item.checked)).toEqual([false, false, true, false]);

       const omitted = contextMenuMethodsOf(editor).buildContextMenuItems({
           kind: 'table-cell', hasSelectedText: true, ...SOME_FORMATS,
       });
       const omittedTableItems = submenuItemsOf(findItem(omitted, 'Table'));
       const omittedItems = submenuItemsOf(findItem(omittedTableItems ?? [], 'Align column'));
       expect(omittedItems?.map((item) => item.checked)).toEqual([false, false, false, true]);
   });
   ```
   Replace [:2721-2732](packages/lib/tests/component/markdown-editor.test.ts#L2721-L2732):
   ```typescript
   it('each "Align column" item\'s action() reaches MarkdownEditor.setTableColumnAlignment with its own alignment', () => {
       const editor = new MarkdownEditor();
       editor.insertTable(2, 3);   // caret lands in the first header cell

       const items = contextMenuMethodsOf(editor).buildContextMenuItems({
           kind: 'table-cell', hasSelectedText: true, ...SOME_FORMATS,
       });
       const tableItems = submenuItemsOf(findItem(items, 'Table'));

       submenuItemsOf(findItem(tableItems ?? [], 'Align column'))?.find((item) => item.text === 'Center')?.action?.();

       expect(normalize(editor.getValue()).split('\n')[1]).toBe('| :---: | --- | --- |');
   });
   ```
   Leave [:2734-2746](packages/lib/tests/component/markdown-editor.test.ts#L2734-L2746) ("'text' and 'empty-line' contexts build no 'Align column' item") unchanged — it never touches `table-cell`.

   **5d. Empty-line 7-entry test** — replace [:2577-2586](packages/lib/tests/component/markdown-editor.test.ts#L2577-L2586):
   ```typescript
   it('an "empty-line" context builds 7 entries: Cut/Copy/Paste, then Heading, Insert, and Columns', () => {
       const editor = new MarkdownEditor();
       const items = contextMenuMethodsOf(editor).buildContextMenuItems({ kind: 'empty-line', hasSelectedText: true });

       expect(items).toHaveLength(7);
       expect(items.map((item) => item.text ?? '(separator)')).toEqual([
           'Cut', 'Copy', 'Paste', '(separator)',
           'Heading', 'Insert', 'Columns',
       ]);
   });
   ```
   Leave [:2569-2575](packages/lib/tests/component/markdown-editor.test.ts#L2569-L2575) ("omits Paragraph and offers a 6-item Heading submenu") unchanged — Heading is untouched.

   **5e. New test: Insert submenu contents.** Add directly after the test from 5d:
   ```typescript
   it('an "empty-line" context\'s Insert submenu offers Quote, Code block, Bulleted list, Numbered list, Table, and Image…, in that order', () => {
       const editor = new MarkdownEditor();
       const items = contextMenuMethodsOf(editor).buildContextMenuItems({ kind: 'empty-line', hasSelectedText: true });

       expect(submenuItemsOf(findItem(items, 'Insert'))?.map((item) => item.text ?? '(separator)')).toEqual([
           'Quote', 'Code block', 'Bulleted list', 'Numbered list', '(separator)', 'Table', 'Image…',
       ]);
   });
   ```

   **5f. Empty-line Table-item wiring** — replace [:2748-2756](packages/lib/tests/component/markdown-editor.test.ts#L2748-L2756):
   ```typescript
   it("the empty-line menu's Insert ▸ Table item reaches MarkdownEditor.insertTable(2, 3)", () => {
       const editor = new MarkdownEditor();
       const items = contextMenuMethodsOf(editor).buildContextMenuItems({ kind: 'empty-line', hasSelectedText: true });

       submenuItemsOf(findItem(items, 'Insert'))?.find((item) => item.text === 'Table')?.action?.();

       const lines = normalize(editor.getValue()).split('\n');
       expect(lines).toHaveLength(3);   // header, delimiter, one body row
   });
   ```

   **5g. New test: Bulleted list / Numbered list wiring.** Add directly after the test from 5f:
   ```typescript
   it("the empty-line menu's Insert ▸ Bulleted list / Numbered list items reach toggleUnorderedList / toggleOrderedList", () => {
       const bulleted = new MarkdownEditor();
       bulleted.setValue('word');
       selectStart(bulleted);
       const bulletedItems = contextMenuMethodsOf(bulleted).buildContextMenuItems({ kind: 'empty-line', hasSelectedText: false });

       submenuItemsOf(findItem(bulletedItems, 'Insert'))?.find((item) => item.text === 'Bulleted list')?.action?.();

       expect(bulleted.getValue()).toContain('- word');

       const numbered = new MarkdownEditor();
       numbered.setValue('word');
       selectStart(numbered);
       const numberedItems = contextMenuMethodsOf(numbered).buildContextMenuItems({ kind: 'empty-line', hasSelectedText: false });

       submenuItemsOf(findItem(numberedItems, 'Insert'))?.find((item) => item.text === 'Numbered list')?.action?.();

       expect(numbered.getValue()).toContain('1. word');
   });
   ```

   Verify: `cd packages/lib && npx vitest run tests/component/markdown-editor.test.ts` — every test in the file passes, none skipped.

6. **Update the docs paragraph.** In [MarkdownEditor.md:73](packages/lib/docs/components/MarkdownEditor.md#L73), make three clause-level edits to the "Right-click context menu" bullet (leave the rest of the paragraph — link items, Insert-line-before/after-block, Cut/Copy/Paste, the word-expansion behaviour — untouched):
   - Replace `an empty line gets block-insert commands plus the same **Columns** submenu and an **Image…** item prompting for a source URL and applying it through \`insertImage\`;` with `an empty line gets a **Heading** submenu (h1–h6), an **Insert** submenu bundling **Quote**, **Code block**, **Bulleted list**, **Numbered list**, **Table** (a 2×3 starter table), and an **Image…** item prompting for a source URL and applying it through \`insertImage\`, and the same **Columns** submenu;`
   - Replace `a table cell gets the same inline-format commands (no block style — a cell holds inline text only) plus Insert/Delete submenus for its row, column, and the whole table, **Merge cells** (over a drag-selected range of cells) / **Unmerge cell** / **Column width…** (prompts for a pixel width via a dialog, applying it through \`setTableColumnWidth\`), and an **Align column** submenu offering Left, Center, Right, and None` with `a table cell gets the same inline-format commands (no block style — a cell holds inline text only) plus a **Table** submenu bundling an **Insert** submenu (row above/below, column left/right), a **Delete** submenu (row, column, or the whole table), **Merge cells** (over a drag-selected range of cells), **Unmerge cell**, **Column width…** (prompts for a pixel width via a dialog, applying it through \`setTableColumnWidth\`), and an **Align column** submenu offering Left, Center, Right, and None`
   - Replace `The inline-format toggles include **Underline** beside Bold/Italic/Strikethrough/Inline code,` with `The inline-format toggles are **Bold**, **Italic**, **Underline**, **Strikethrough**, and **Code**,`

   Do not touch [MarkdownEditor.md:49](packages/lib/docs/components/MarkdownEditor.md#L49) (the "Inline code | `` `code` `` |" row in the Supported Constructs table) — that documents the Markdown syntax marker, not the menu label.

7. **Add a changelog entry.** In [next.md](packages/lib/docs/reference/changelog/next.md), under `## Changed` → `### Components` (append after the last existing bullet in that block, [:78](packages/lib/docs/reference/changelog/next.md#L78), before the `### Menu` heading at [:80](packages/lib/docs/reference/changelog/next.md#L80)):
   ```markdown
   - **`MarkdownEditor`'s right-click context menu is reorganized**: the
     table-cell menu's row/column **Insert**/**Delete** submenus and its
     **Merge cells** / **Unmerge cell** / **Column width…** / **Align column**
     items now nest under one **Table** submenu; the empty-line menu's
     **Quote** / **Code block** / **Table** / **Image…** items now nest under
     one **Insert** submenu, which also gains **Bulleted list** and
     **Numbered list** items wired to the existing `toggleUnorderedList()` /
     `toggleOrderedList()` commands. The inline-format toggles reorder to
     Bold / Italic / Underline / Strikethrough / Code, and **Inline code** is
     renamed to **Code**. No consumer action is needed — every item still
     calls the same command method it did before.
   ```

8. **Full verification.** Run everything in `## Verification` below.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

No new files. `packages/lib/src/typescript/MarkdownEditorPanel.ts` (the demo) needs no change — its toolbar buttons call command methods directly and don't reference menu item labels; the context menu is self-wired, so the live demo exercises the new structure immediately.

---

## Expected Behaviour

All of the following are unit-testable offline (no DOM view needed — `buildContextMenuItems` and friends are pure functions of their `ContextMenuTarget` argument, per the existing test harness's `contextMenuMethodsOf` helper).

**Item counts** (the full before/after, so every test's expected `toHaveLength` is derivable without re-deriving the tree):

| Context | Old count | New count | Why it changed |
|---|---|---|---|
| `text`, `linkUrl: null` | 19 | 19 | Format toggles reorder/rename only — no item added or removed |
| `text`, with `linkUrl` | 20 | 20 | Same |
| `text`, `hasEnclosingBlock` | 22 | 22 | Same |
| `table-cell`, `linkUrl: null` | 23 | 17 | 7 items (Insert, Delete, separator, Merge cells, Unmerge cell, Column width…, Align column) collapse into 1 (Table) |
| `table-cell`, with `linkUrl` | 24 | 18 | Same collapse |
| `table-cell`, `hasEnclosingBlock` | 26 | 20 | Same collapse |
| `table-cell`, `linkUrl` + `hasEnclosingBlock` | 27 | 21 | Same collapse |
| `empty-line` | 11 | 7 | 5 items (Quote, Code block, separator, Table, Image…) collapse into 1 (Insert); Heading and Columns unaffected |

**Structural and wiring behaviour:**

1. `buildFormatToggleItems` returns its five rows in the order Bold, Italic, Underline, Strikethrough, Code; the fourth-position label is `"Code"`, never `"Inline code"`. Each row's `checked` still reflects the same `format.*` field as before — only the position and label change, not which boolean drives which row.
2. In a `table-cell` context, `findItem(items, 'Insert')` and `findItem(items, 'Delete')` (searched at the top level of the returned array) are both `undefined` — they exist only inside `submenuItemsOf(findItem(items, 'Table'))`.
3. Activating `Table ▸ Insert ▸ Row above` still calls `insertTableRow(false)`; `Table ▸ Delete ▸ Table` still calls `deleteTable()`; `Table ▸ Align column ▸ Center` still calls `setTableColumnAlignment('center')`; `Table ▸ Merge cells` still calls `mergeTableCells()` — every leaf's wiring is byte-for-byte the same as before, only its path through the tree is longer.
4. In an `empty-line` context, `findItem(items, 'Quote')`, `findItem(items, 'Table')`, `findItem(items, 'Code block')`, and `findItem(items, 'Image…')` (top level) are all `undefined` — they exist only inside `submenuItemsOf(findItem(items, 'Insert'))`. `findItem(items, 'Heading')` and `findItem(items, 'Columns')` are unaffected and still found at the top level.
5. `Insert ▸ Bulleted list` calls `toggleUnorderedList()`; `Insert ▸ Numbered list` calls `toggleOrderedList()`. With the caret on `word` (via `selectStart`), each turns `getValue()` into a document containing `- word` or `1. word` respectively — the existing round-trip `toggleUnorderedList()` test at [markdown-editor.test.ts:475](packages/lib/tests/component/markdown-editor.test.ts#L475) already proves the command itself; this only proves the menu item reaches it.
6. `Cut`/`Copy`/`Paste` enablement, the link items' shape (`Insert link…` vs. `Edit link…`/`Remove link`), `Text style`, `Clear formatting`, and the `hasEnclosingBlock` trailing items are unaffected in every context — none of this plan's changes touch their builders.

No behaviour needs manual-only verification for correctness (everything above is exercised by `buildContextMenuItems` directly), but the visual nesting is worth a manual smoke test — see `## Verification`.

---

## Verification

- `npm run typecheck` — clean.
- `cd packages/lib && npx vitest run tests/component/markdown-editor.test.ts` — every existing case (updated per Step 5) plus the two new cases (5e, 5g) pass.
- `npm test` — the whole suite stays green.
- `npm run lint` — clean; this change adds no new DOM access or attribute writes.
- `npm run docs:api` — zero warnings (all touched methods are `private`, so none of this is in the generated API surface, but the command confirms nothing else broke).
- Manual, on the dev server (`npm run dev`, `localhost:8015`, the **MD Editor** demo section):
  - Right-click a word: format list reads Bold, Italic, Underline, Strikethrough, Code (not "Inline code").
  - Right-click an empty line: menu shows Heading, Insert, Columns; opening Insert shows Quote, Code block, Bulleted list, Numbered list, then Table, Image…; clicking Bulleted list / Numbered list starts a list at the caret.
  - Right-click inside a table cell: menu shows a single Table entry; opening it shows Insert, Delete, then Merge cells/Unmerge cell/Column width…/Align column; each leaf still performs its documented action.

---

## Documentation Impact

- [`packages/lib/docs/components/MarkdownEditor.md`](packages/lib/docs/components/MarkdownEditor.md) — the "Right-click context menu" bullet (line 73) is the only doc content describing this menu's shape; update per Step 6. No other page mentions the context menu's structure (confirmed by repo-wide search — see Non-Goals).
- [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) — add the entry from Step 7, matching the precedent set by the two prior `MarkdownEditor` context-menu entries already in this file ([:146](packages/lib/docs/reference/changelog/next.md#L146), [:152](packages/lib/docs/reference/changelog/next.md#L152), [:192](packages/lib/docs/reference/changelog/next.md#L192)).
- No `## Command API` table row changes — `toggleUnorderedList()` / `toggleOrderedList()` are already documented there ([MarkdownEditor.md:82](packages/lib/docs/components/MarkdownEditor.md#L82)), and no method signature changes.

---

## Potential Challenges

- **Off-by-one errors in the test slice indices.** The item-count table in `## Expected Behaviour` and the full replacement code in Step 5 are both derived directly from the current file's exact structure — use them verbatim rather than re-deriving counts by hand.
- **Confusing the two unrelated "Insert" submenus.** The table-cell menu's `Table ▸ Insert` (row/column insertion) and the empty-line menu's top-level `Insert` (block/object insertion) are separate literals in separate methods that are never shown together — same label, no runtime interaction, nothing to reconcile.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) — every method touched or added.
- [`packages/lib/src/typescript/lib/component/container/MenuItem.ts`](packages/lib/src/typescript/lib/component/container/MenuItem.ts) — `MenuItemConfig`/`MenuConfig`, confirming submenus nest arbitrarily deep.
- [`packages/lib/tests/component/markdown-editor.test.ts`](packages/lib/tests/component/markdown-editor.test.ts) — the `describe('MarkdownEditor context menu', ...)` block, its helpers (`findItem`, `submenuItemsOf`, `rowOf`, `contextMenuMethodsOf`), and `SOME_FORMATS`.
- [`plans/implemented/markdown-editor-context-menu-clipboard.md`](plans/implemented/markdown-editor-context-menu-clipboard.md) — the closest precedent plan for this exact file: same menu-building cluster, same test/docs/changelog update shape.
- [`packages/lib/docs/components/MarkdownEditor.md`](packages/lib/docs/components/MarkdownEditor.md) — the "Right-click context menu" bullet.

---

## Non-Goals

- **Folding Heading or Columns into the new Insert submenu** — considered and rejected; see Architecture Decisions.
- **Adding Bulleted list / Numbered list to the text-context Block style submenu** — considered and rejected; see Architecture Decisions and the footnote below.
- **Any change to `Markdown.ts`** (the read-only viewer) — it has no context menu.
- **Any change to the `hasEnclosingBlock` trailing items** ("Insert line before block"/"Insert line after block") in either the text or table-cell menu — explicitly out of scope per the request.
- **New editor commands** — `toggleUnorderedList()`/`toggleOrderedList()` already exist and are reused unmodified; no new command method is added anywhere in this plan.
- **`MarkdownEditorPanel.ts` (the demo)** — its toolbar buttons call command methods directly, not through the context menu; nothing there references a changed label.

---

## Notes

[^nesting-precedent]: `buildTextStyleMenuItem` is the deepest existing submenu in this file: "Text style" (top) → "Colour"/"Font"/"Size" (mid) → preset actions (leaf), a genuine three-tier structure. The new "Table" submenu has the identical shape: "Table" (top) → "Insert"/"Delete"/"Align column" (mid) → leaf actions, with "Merge cells"/"Unmerge cell"/"Column width…" as flat mid-tier siblings — the same mixing of flat items and sub-submenus at one level that `buildTextContextMenuItems`'s own "Block style" submenu already does (Paragraph and Quote/Code block sit flat, while headings are inlined in one call and wrapped in their own submenu in another, at [:2541](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2541)). Flattening Table's contents with separators instead of sub-submenus was considered and rejected: it would require renaming "Row"/"Column" (currently disambiguated only by living inside "Delete") to avoid duplicate flat labels, a bigger label churn than the request asked for.

[^minimal-diff]: The alternative — re-deriving a "better" internal order for the table actions while wrapping them — was rejected. The request explicitly leaves the internal nesting to this plan's judgment, and the existing order already reads correctly (structural inserts, then structural deletes, then cell-level operations, then column-level operations); reordering it would add unrelated churn to every test that lists these items and would not make the resulting menu easier to use. A pure wrap is also verifiably correct by inspection: every leaf action's line is copied unchanged from its old location.

[^insert-grouping]: The alternative — keeping the original flat order (Quote, Code block, Table, Image…) and appending the two list items at the end — was considered. It was rejected because it separates Bulleted list/Numbered list from Quote/Code block, the three other "convert this line into X" actions they most resemble, forcing a user scanning for "how do I start a list" past the Table/Image object-insertion items first. The separator already sitting between "Code block" and "Table" in the current flat list is reused as the group boundary, so no new separator is introduced.

[^block-style-rejected]: `setBlockType(type: MarkdownBlockType)` ([:1604](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1604)) swaps the current block to one of a fixed, mutually-exclusive set (`MarkdownBlockType` = `"paragraph" | "h1"..."h6" | "quote" | "code"`, [:100](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L100)) — every existing Block-style item is a deterministic "make it exactly this" action. `toggleUnorderedList()`/`toggleOrderedList()` instead dispatch Lexical's `INSERT_UNORDERED_LIST_COMMAND`/`INSERT_ORDERED_LIST_COMMAND`, which flip a block into or out of a list depending on its *current* state — a second click on the same item undoes the first, unlike every other item in Block style. Mixing a "set" action and a "toggle" action as plain, unmarked entries in the same flat list means a user who has just entered a list and clicks "Bulleted list" again — expecting confirmation, since that's what every other item in the menu does — would instead exit the list. Block style also renders no checkmarks today (not even for the block's current type), so there is no existing visual language to signal "this one is a toggle, not a set" without adding one. If this parity is wanted later, it needs its own interaction treatment (e.g. `CheckboxMenuRow`-style checked state, as `buildFormatToggleItems` already uses for exactly this kind of toggle) — a small but real design decision that belongs in its own plan, not folded into this reorg.
