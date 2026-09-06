---
depends-on: [markdown-editor-context-menu-reorg]
touches-shared: [packages/lib/docs/reference/changelog/next.md]
---

# MarkdownEditor Toolbar Component — Implementation Plan

## Overview

This plan promotes the hand-built toolbar-plus-editor layout in the demo file [MarkdownEditorPanel.ts](packages/lib/src/typescript/MarkdownEditorPanel.ts) into a real, exported library component, `MarkdownDocumentPanel`, and rebuilds its toolbar as a set of glyph-only buttons grouped the same way the reorganized right-click menu is grouped.

`MarkdownDocumentPanel` is a new file, [MarkdownDocumentPanel.ts](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts), living beside [MarkdownEditor.ts](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts). It is a `Container` that docks a `ToolBar` `NORTH` and a `MarkdownEditor` `CENTER` via a `Border` layout, mirroring the "toolbar + content, both owned" shape of [TablePanel.ts](packages/lib/src/typescript/lib/component/table/TablePanel.ts). The demo file is then rewritten to consume it instead of building its own `Border` + `ToolBar` + `Fit` structure.

The toolbar's button grouping is modelled on the **target** shape of `MarkdownEditor`'s context menu described in the sibling plan, [markdown-editor-context-menu-reorg.md](plans/markdown-editor-context-menu-reorg.md) — not on the menu-building code live on `master` today, which that sibling plan has not yet rewritten. This plan does not implement the sibling plan; it only borrows its finished grouping (Insert, Table, the five-item format-toggle order) as the toolbar's own design. No file the sibling plan touches is modified here except the shared changelog staging page, [next.md](packages/lib/docs/reference/changelog/next.md), where both plans add an entry.

---

## Architecture Decisions

### New component: `MarkdownDocumentPanel`, in `component/editor/`

The class is named `MarkdownDocumentPanel`, not `MarkdownEditorPanel` — that name is already the demo file's class — and not a name built from `MarkdownEditor`/`Markdown`, which are existing library exports. `*Panel` is this codebase's suffix for a `Container` subclass that owns a layout manager and pre-wires content into it (`TablePanel`, `TabPanel`, `AccordionPanel`, `TreeTablePanel`, `FloatingPanel` — none of them literally extend `Panel`).[^naming] It lives in `component/editor/` and is exported from that directory's existing barrel, alongside `MarkdownEditor` and `CodeEditor`, following exactly where `TablePanel` sits next to `Table` in `component/table/`.

### Base class and layout: `Container` + `Border`, no `Fit` wrapper

`MarkdownDocumentPanel extends Container<TOptions>`, generic the way [TabPanel.ts:86](packages/lib/src/typescript/lib/component/container/TabPanel.ts#L86) is (`class TabPanel<TOptions extends TabPanelOptions = TabPanelOptions> extends Container<TOptions>`) — this component takes a plain options bag, no other constructor argument, so it matches `TabPanel`'s shape rather than `TablePanel`'s store-first constructor. `setLayoutManager(new Border())` docks the toolbar `NORTH` and the `MarkdownEditor` `CENTER`, directly — no `Fit`-wrapping `Panel` in between, matching how [TablePanel.ts:94-95](packages/lib/src/typescript/lib/component/table/TablePanel.ts#L94-L95) docks its `Table` straight into `Border`'s `CENTER`.[^no-fit-wrapper]

### Scope: the toolbar and the editor, not the dirty-status line

`MarkdownDocumentPanel` owns exactly the `NORTH` toolbar and the `CENTER` editor — nothing else. The demo's current `SOUTH` status line reads `` `Dirty — editor: …, panel (3 levels up): …` `` — the second half of that string is a demo-only illustration of the framework's dirty-flag relay crossing container boundaries, not generic reusable UI, and the request asks for the editor "complete with the toolbar," not a status readout. The demo keeps building its own `SOUTH` row; see "Demo migration" below.

### One `ToolBar`, split left/right with `Spacer.flex()`

The far-left/far-right split uses one `ToolBar` and a single `Spacer.flex()` child between the two clusters — the exact mechanism already shipping in [ToolBarPanel.ts:85-95](packages/lib/src/typescript/ToolBarPanel.ts#L85-L95), which pins a trailing zoom `ComboBox` to a bar's right edge the same way. No second `ToolBar`/`HBox` or new layout behaviour is needed: `ToolBar`'s layout manager is an `HBox` with `stretching: true` ([ToolBar.ts:275-277](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L275-L277)), and `Spacer.flex()` writes a `weight` constraint that `HBox` already honours ([Spacer.ts:106-108](packages/lib/src/typescript/lib/component/container/Spacer.ts#L106-L108)).

### Glyph-only buttons: `{ glyph, text, showText: false }`, not `Tooltip.attach`

Every toolbar button/dropdown trigger is built with `{ glyph, text, showText: false }` — the pattern `Cut`/`Copy`/`Paste` use in [ToolBarPanel.ts:66-68](packages/lib/src/typescript/ToolBarPanel.ts#L66-L68) — rather than `TablePanel`'s `Tooltip.attach(button, "text")` pattern ([TablePanel.ts:68-71](packages/lib/src/typescript/lib/component/table/TablePanel.ts#L68-L71)).[^tooltip-pattern] `text` doubles as the hover tooltip and the accessible name (`aria-label`) with no visible label, so no separate `Tooltip` import or call is needed.

### Button/dropdown grouping

The toolbar has three mandatory groups the request names directly, plus a small set of discretionary groups decided by one rule: **give a group a toolbar entry only if the current demo already exposes it as a toolbar button.** Two groups fail that rule (no demo precedent) and stay context-menu-only.

| Group | Toolbar entry | Source (sibling plan's target shape) |
|---|---|---|
| Format toggles | 5 buttons: Bold, Italic, Underline, Strikethrough, Code | `buildFormatToggleItems`, reordered |
| Insert | 1 dropdown (`MenuButton`): Quote, Code block, Bulleted list, Numbered list, —, Table, Image… | `buildEmptyLineContextMenuItems`'s new "Insert" submenu |
| Table | 1 dropdown: Insert▸(Row above/below, Column left/right), Delete▸(Row/Column/Table), —, Merge cells, Unmerge cell, Column width…, Align column▸(Left/Center/Right/None) | `buildTableMenuItem` |
| Text style *(discretionary — demo had "Colour")* | 1 dropdown: Colour▸(Red/Green/Blue/Default), Font▸(Serif/Monospace/Default), Size▸(Small/Large/Default) | `buildTextStyleMenuItem` (unchanged by the sibling plan) |
| Alignment *(discretionary — demo had "Align centre")* | 1 dropdown: Left, Center, Right, Justify, Default | Inline in `buildTextContextMenuItems` (unchanged) |
| Columns *(discretionary — demo had "Columns")* | 1 dropdown: 2/3/4 columns, None | `buildColumnsMenuItem` (unchanged) |
| Link *(discretionary — no demo precedent)* | **None** | Stays context-menu-only |
| Clear formatting *(discretionary — no demo precedent)* | **None** | Stays context-menu-only |
| Heading *(not in the request's Insert/Table list, no demo precedent)* | **None** | Stays context-menu-only |

Insert and Table are included in full even though the demo only ever exposed a subset of their leaves (row/column ops, "Insert table"), because the request asks for these two specifically, modelled on the sibling plan's finished groups, not scoped to what the demo already had.

### The Table dropdown is always enabled — no live "which cell" state

Every command the Table dropdown calls — `insertTableRow`/`deleteTableRow`/`insertTableColumn`/`deleteTableColumn`/`setTableColumnAlignment`/`deleteTable`/`mergeTableCells`/`unmergeTableCell`/`setTableColumnWidth` — is documented as a no-op-without-throwing when the caret isn't positioned the way the command needs (verified by reading each method body, [MarkdownEditor.ts:1810-1998](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1810-L1998)). The demo's existing row/column buttons already rely on exactly this guarantee to skip building any enabled/disabled state. The Table dropdown extends the same reasoning to every entry in it: it never live-classifies the caret the way a right-click does, and "Align column" never shows a checkmark for the current alignment (unlike its context-menu counterpart).[^table-tradeoff]

### `promptAndInsertImage` / `promptAndSetColumnWidth` are re-implemented, not reused

`MarkdownEditor`'s own `promptAndInsertImage()` / `promptAndSetColumnWidth()` (used by "Image…" and "Column width…" in the context menu) are `private`. Rather than promoting them to `public` on `MarkdownEditor.ts` — a file the sibling plan is concurrently editing — `MarkdownDocumentPanel` implements its own small private `promptForText` / `promptAndInsertImage` / `promptAndSetColumnWidth`, using the same `Dialog.show` + `TextField` + `DialogButtons` idiom `MarkdownEditor.ts` itself uses ([MarkdownEditor.ts:2212-2279](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2212-L2279)), then calls the public `insertImage(src)` / `setTableColumnWidth(width)`.[^dialog-duplication]

### The "change" event is re-emitted through this component's own `ListenerBag`, not forwarded

`MarkdownDocumentPanel.on("change", …)` does not call `this._editor.on("change", …)` directly. It owns its own `ListenerBag<"change">` and re-emits, matching `MarkdownViewer`'s exact treatment of its own composed `HeadingScrollTracker` event ([MarkdownViewer.ts:135, 145-146, 324-338](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts#L135)) — per [ARCHITECTURE.md](ARCHITECTURE.md)'s event-handling rule, a class that emits a custom event owns the full `on`/`off`/`emit` + `ListenerBag` shape.

### `isDirty()` needs no override; `markClean()` is a one-line delegate

`Component`'s parent/child dirty relay (`_dirtyDescendantCount`, wired at `addComponent` time — [Component.ts:511-520, 6456-6504](packages/lib/src/typescript/lib/core/Component.ts#L511)) already makes any container's `isDirty()` true whenever a descendant is dirty. Docking the `MarkdownEditor` as a child is enough for `MarkdownDocumentPanel.isDirty()` to reflect it — no override needed. `markClean()` has no such relay (each dirty-tracking leaf defines its own), so `MarkdownDocumentPanel.markClean()` is `{ this._editor.markClean(); return this; }`.

### `getEditor()` / `getToolbar()` escape hatches, not a re-exposed API

`MarkdownDocumentPanel` delegates only `getValue()` / `setValue()` / `markClean()` / the `"change"` event, plus `getEditor(): MarkdownEditor` and `getToolbar(): ToolBar` — mirroring `TablePanel.getTable()` / `TablePanel.getToolbar()` ([TablePanel.ts:160-171](packages/lib/src/typescript/lib/component/table/TablePanel.ts#L160-L171)), which likewise re-exposes only what `TablePanel`'s own feature set needs (export/pagination) and leaves the rest of `Table`'s API reachable through `getTable()`. A consumer needing `setMode`/`setReadOnly`/any other `MarkdownEditor` method calls `panel.getEditor().theMethod()` directly, rather than this class re-declaring `MarkdownEditor`'s ~40-method surface a second time.

### Live pressed/active toolbar state: not included

Investigated as the plan's optional stretch item. `MarkdownEditor` has no public way to read live selection/format state — the classification the context menu uses (`$classifyContextMenuTarget` and friends) runs only in response to a right-click event, not continuously, and there is no `"selectionchange"`-style public event. Building this would mean adding new public surface to `MarkdownEditor.ts` (a Lexical `SELECTION_CHANGE_COMMAND` listener computing live format state, exposed as a new event), which conflicts with this plan's decision to leave that file untouched while the sibling plan is mid-edit on it.[^live-state-rejected] **Recommendation: no-go for this plan.** It is not attempted here; see Non-Goals.

---

## Public API

```typescript
export interface MarkdownDocumentPanelOptions extends ContainerOptions {
    /** Initial Markdown value, forwarded to the owned MarkdownEditor. Defaults to "". */
    value?: string;
}

class MarkdownDocumentPanel<TOptions extends MarkdownDocumentPanelOptions = MarkdownDocumentPanelOptions>
    extends Container<TOptions> {

    constructor(options?: TOptions);

    /** Current Markdown value — delegates to the owned MarkdownEditor. */
    getValue(): string;
    /** Sets the Markdown value — delegates to the owned MarkdownEditor. */
    setValue(value: string): this;
    /** Clears the dirty flag — delegates to the owned MarkdownEditor. */
    markClean(): this;

    /** The owned MarkdownEditor, for any API this class doesn't re-expose. */
    getEditor(): MarkdownEditor;
    /** The owned ToolBar. */
    getToolbar(): ToolBar;

    /** Fires whenever the owned MarkdownEditor's `"change"` event fires. */
    on(event: "change", listener: (payload: MarkdownEditorChange) => void): this;
    off(event: "change", listener: (payload: MarkdownEditorChange) => void): this;
}
```

`isDirty()` is inherited from `Component` unchanged — no override.

---

## Internal Structure

Imports and module-level glyph registration:

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Container, ContainerOptions } from "~/core/Container.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";
import { Border } from "~/layout/Border.js";
import { Placement } from "~/primitive/Placement.js";
import { Button } from "~/component/button/Button.js";
import { ToggleButton } from "~/component/button/ToggleButton.js";
import { MenuButton } from "~/component/button/MenuButton.js";
import { ToolBar } from "~/component/menubar/ToolBar.js";
import { ToolBarSeparator } from "~/component/menubar/ToolBarSeparator.js";
import { Spacer } from "~/component/container/Spacer.js";
import { MenuItemConfig } from "~/component/container/MenuItem.js";
import { MarkdownEditor } from "~/component/editor/MarkdownEditor.js";
import type { MarkdownEditorChange } from "~/component/editor/MarkdownEditor.js";
import { Dialog, DialogButtons } from "~/overlay/Dialog.js";
import { TextField } from "~/component/input/TextField.js";
import { Glyph } from "~/component/display/Glyph.js";
import { bold }          from "~/glyphs/solid/bold.js";
import { italic }        from "~/glyphs/solid/italic.js";
import { underline }     from "~/glyphs/solid/underline.js";
import { strikethrough } from "~/glyphs/solid/strikethrough.js";
import { code }          from "~/glyphs/solid/code.js";
import { plus }          from "~/glyphs/solid/plus.js";
import { table }         from "~/glyphs/solid/table.js";
import { palette }       from "~/glyphs/solid/palette.js";
import { align_left }    from "~/glyphs/solid/align_left.js";
import { columns }       from "~/glyphs/solid/columns.js";
import { file_code }     from "~/glyphs/solid/file_code.js";

Glyph.register(bold, italic, underline, strikethrough, code, plus, table, palette, align_left, columns, file_code);
```

Every toolbar button/trigger's tooltip text follows one rule: a direct-action button's tooltip is its bare label ("Bold"); a dropdown trigger's tooltip is its group label plus an ellipsis, matching the "opens more UI" convention the context menu itself already uses for entries like "Insert link…" and "Column width…":

| Button | Kind | Glyph | Tooltip text |
|---|---|---|---|
| Bold / Italic / Underline / Strikethrough / Code | direct action | `bold` / `italic` / `underline` / `strikethrough` / `code` | "Bold" / "Italic" / "Underline" / "Strikethrough" / "Code" |
| Insert | dropdown | `plus` | "Insert…" |
| Table | dropdown | `table` | "Table…" |
| Text style | dropdown | `palette` | "Text style…" |
| Alignment | dropdown | `align-left` | "Alignment…" |
| Columns | dropdown | `columns` | "Columns…" |
| Edit Markdown source | toggle | `file-code` | "Edit Markdown source" |

Class body:

```typescript
class MarkdownDocumentPanel<TOptions extends MarkdownDocumentPanelOptions = MarkdownDocumentPanelOptions>
    extends Container<TOptions> {

    private readonly _editor:  MarkdownEditor;
    private readonly _toolbar: ToolBar;

    private readonly _listeners: ListenerBag<"change"> =
        this.registerListenerBag(new ListenerBag<"change">());

    private readonly handleEditorChange: (payload: MarkdownEditorChange) => void =
        (payload) => this.emit("change", payload);

    constructor(options?: TOptions) {
        super(options);

        this.setLayoutManager(new Border());

        this._editor = new MarkdownEditor(options?.value ?? "");
        this._editor.on("change", this.handleEditorChange);

        this._toolbar = this.buildToolbar();

        super.addComponent(this._toolbar, { placement: Placement.NORTH });
        super.addComponent(this._editor,  { placement: Placement.CENTER });
    }

    /**
     * Builds the toolbar: the five format toggles, Insert and Table dropdowns
     * on the far left, Text style/Alignment/Columns dropdowns beside them, a
     * flex spacer, then the "Edit Markdown source" toggle pinned to the far
     * right.
     *
     * @returns The constructed ToolBar, not yet parented.
     */
    private buildToolbar(): ToolBar {
        const bar = new ToolBar();

        const boldBtn          = new Button({ glyph: "bold", text: "Bold", showText: false });
        const italicBtn        = new Button({ glyph: "italic", text: "Italic", showText: false });
        const underlineBtn     = new Button({ glyph: "underline", text: "Underline", showText: false });
        const strikethroughBtn = new Button({ glyph: "strikethrough", text: "Strikethrough", showText: false });
        const codeBtn          = new Button({ glyph: "code", text: "Code", showText: false });

        boldBtn.on("action",          () => { this._editor.toggleBold(); });
        italicBtn.on("action",        () => { this._editor.toggleItalic(); });
        underlineBtn.on("action",     () => { this._editor.toggleUnderline(); });
        strikethroughBtn.on("action", () => { this._editor.toggleStrikethrough(); });
        codeBtn.on("action",          () => { this._editor.toggleInlineCode(); });

        const insertBtn = new MenuButton({
            glyph: "plus", text: "Insert…", showText: false,
            menuItems: this.buildInsertMenuItems(),
        });

        const tableBtn = new MenuButton({
            glyph: "table", text: "Table…", showText: false,
            menuItems: this.buildTableMenuItems(),
        });

        const textStyleBtn = new MenuButton({
            glyph: "palette", text: "Text style…", showText: false,
            menuItems: this.buildTextStyleMenuItems(),
        });

        const alignmentBtn = new MenuButton({
            glyph: "align-left", text: "Alignment…", showText: false,
            menuItems: this.buildAlignmentMenuItems(),
        });

        const columnsBtn = new MenuButton({
            glyph: "columns", text: "Columns…", showText: false,
            menuItems: this.buildColumnsMenuItems(),
        });

        const sourceToggle = new ToggleButton("Edit Markdown source", { glyph: "file-code", showText: false });
        sourceToggle.on("action", () => { this._editor.setMode(sourceToggle.isSelected() ? "source" : "wysiwyg"); });

        bar.addComponents(
            boldBtn, italicBtn, underlineBtn, strikethroughBtn, codeBtn,
            ToolBarSeparator(),
            insertBtn, tableBtn,
            ToolBarSeparator(),
            textStyleBtn, alignmentBtn, columnsBtn,
            Spacer.flex(),
            sourceToggle,
        );

        return bar;
    }

    /** Insert dropdown contents — mirrors the sibling plan's empty-line "Insert" submenu. */
    private buildInsertMenuItems(): MenuItemConfig[] {
        return [
            { text: "Quote", action: () => this._editor.setBlockType("quote") },
            { text: "Code block", action: () => this._editor.setBlockType("code") },
            { text: "Bulleted list", action: () => this._editor.toggleUnorderedList() },
            { text: "Numbered list", action: () => this._editor.toggleOrderedList() },
            { separator: true },
            { text: "Table", action: () => this._editor.insertTable(2, 3) },
            { text: "Image…", action: () => void this.promptAndInsertImage() },
        ];
    }

    /** Table dropdown contents — mirrors the sibling plan's table-cell "Table" submenu. */
    private buildTableMenuItems(): MenuItemConfig[] {
        return [
            {
                text: "Insert",
                submenu: {
                    label: "Insert",
                    items: [
                        { text: "Row above", action: () => this._editor.insertTableRow(false) },
                        { text: "Row below", action: () => this._editor.insertTableRow(true) },
                        { text: "Column left", action: () => this._editor.insertTableColumn(false) },
                        { text: "Column right", action: () => this._editor.insertTableColumn(true) },
                    ],
                },
            },
            {
                text: "Delete",
                submenu: {
                    label: "Delete",
                    items: [
                        { text: "Row", action: () => this._editor.deleteTableRow() },
                        { text: "Column", action: () => this._editor.deleteTableColumn() },
                        { text: "Table", action: () => this._editor.deleteTable() },
                    ],
                },
            },
            { separator: true },
            { text: "Merge cells", action: () => this._editor.mergeTableCells() },
            { text: "Unmerge cell", action: () => this._editor.unmergeTableCell() },
            { text: "Column width…", action: () => void this.promptAndSetColumnWidth() },
            {
                text: "Align column",
                submenu: {
                    label: "Align column",
                    items: [
                        { text: "Left", action: () => this._editor.setTableColumnAlignment("left") },
                        { text: "Center", action: () => this._editor.setTableColumnAlignment("center") },
                        { text: "Right", action: () => this._editor.setTableColumnAlignment("right") },
                        { text: "None", action: () => this._editor.setTableColumnAlignment("none") },
                    ],
                },
            },
        ];
    }

    /** Text style dropdown contents — verbatim from MarkdownEditor's own buildTextStyleMenuItem. */
    private buildTextStyleMenuItems(): MenuItemConfig[] {
        return [
            {
                text: "Colour",
                submenu: {
                    label: "Colour",
                    items: [
                        { text: "Red", action: () => this._editor.setTextColor("#cc0000") },
                        { text: "Green", action: () => this._editor.setTextColor("#008000") },
                        { text: "Blue", action: () => this._editor.setTextColor("#2563eb") },
                        { text: "Default", action: () => this._editor.setTextColor(null) },
                    ],
                },
            },
            {
                text: "Font",
                submenu: {
                    label: "Font",
                    items: [
                        { text: "Serif", action: () => this._editor.setFontFamily("Georgia, serif") },
                        { text: "Monospace", action: () => this._editor.setFontFamily("monospace") },
                        { text: "Default", action: () => this._editor.setFontFamily(null) },
                    ],
                },
            },
            {
                text: "Size",
                submenu: {
                    label: "Size",
                    items: [
                        { text: "Small", action: () => this._editor.setFontSize("0.8em") },
                        { text: "Large", action: () => this._editor.setFontSize("1.2em") },
                        { text: "Default", action: () => this._editor.setFontSize(null) },
                    ],
                },
            },
        ];
    }

    /** Alignment dropdown contents — verbatim from MarkdownEditor's own inline "Alignment" submenu. */
    private buildAlignmentMenuItems(): MenuItemConfig[] {
        return [
            { text: "Left", action: () => this._editor.setBlockAlignment("left") },
            { text: "Center", action: () => this._editor.setBlockAlignment("center") },
            { text: "Right", action: () => this._editor.setBlockAlignment("right") },
            { text: "Justify", action: () => this._editor.setBlockAlignment("justify") },
            { text: "Default", action: () => this._editor.setBlockAlignment(null) },
        ];
    }

    /** Columns dropdown contents — verbatim from MarkdownEditor's own buildColumnsMenuItem. */
    private buildColumnsMenuItems(): MenuItemConfig[] {
        return [
            { text: "2 columns", action: () => this._editor.setColumnCount(2) },
            { text: "3 columns", action: () => this._editor.setColumnCount(3) },
            { text: "4 columns", action: () => this._editor.setColumnCount(4) },
            { text: "None", action: () => this._editor.setColumnCount(null) },
        ];
    }

    /**
     * Prompts for a line of text via a Dialog — the same bare-TextField,
     * Cancel/Confirm pattern MarkdownEditor.promptForText uses internally
     * (MarkdownEditor.ts:2212), re-implemented here because that method is
     * private. See the "promptAndInsertImage / promptAndSetColumnWidth are
     * re-implemented, not reused" architecture decision.
     *
     * @param title - The dialog's title-bar text.
     * @param defaultValue - The field's initial text.
     * @param placeholder - The field's placeholder text.
     * @returns The trimmed text the user confirmed, or null on cancel/close
     *   or an empty confirmation.
     */
    private async promptForText(title: string, defaultValue: string, placeholder: string): Promise<string | null> {
        const field = new TextField({ text: defaultValue, placeholder });

        const result = await Dialog.show({
            title,
            contentComponent: field,
            buttons: [DialogButtons.Cancel, { ...DialogButtons.Confirm, primary: true }],
        });

        if (result !== "confirm") {
            return null;
        }

        const value = field.getValue().trim();

        return value === "" ? null : value;
    }

    /** The Insert dropdown's Image… handler: prompts for a URL, then calls insertImage. */
    private async promptAndInsertImage(): Promise<void> {
        const src = await this.promptForText("Insert image", "", "https://example.com/image.png");

        if (src !== null) {
            this._editor.insertImage(src);
        }
    }

    /** The Table dropdown's Column width… handler: prompts for a pixel width, then calls setTableColumnWidth. */
    private async promptAndSetColumnWidth(): Promise<void> {
        const value = await this.promptForText("Column width", "", "e.g. 240");

        if (value === null) {
            return;
        }

        const width = Number(value);

        if (Number.isInteger(width) && width > 0) {
            this._editor.setTableColumnWidth(width);
        }
    }

    getValue(): string {
        return this._editor.getValue();
    }

    setValue(value: string): this {
        this._editor.setValue(value);

        return this;
    }

    markClean(): this {
        this._editor.markClean();

        return this;
    }

    getEditor(): MarkdownEditor {
        return this._editor;
    }

    getToolbar(): ToolBar {
        return this._toolbar;
    }

    on(event: "change", listener: (payload: MarkdownEditorChange) => void): this {
        this._listeners.add(event, listener);

        return this;
    }

    off(event: "change", listener: (payload: MarkdownEditorChange) => void): this {
        this._listeners.remove(event, listener);

        return this;
    }

    protected emit(event: "change", payload: MarkdownEditorChange): void {
        this._listeners.fire(event, payload);
    }
}

const MarkdownDocumentPanelCallable = callable(MarkdownDocumentPanel);
type MarkdownDocumentPanelCallable<TOptions extends MarkdownDocumentPanelOptions = MarkdownDocumentPanelOptions> =
    MarkdownDocumentPanel<TOptions>;
export {
    MarkdownDocumentPanel         as _MarkdownDocumentPanel,
    MarkdownDocumentPanelCallable as MarkdownDocumentPanel,
};
```

### Demo migration

`MarkdownEditorPanel.ts`'s `editorHost` becomes: `CENTER` = a `MarkdownDocumentPanel({ value: SAMPLE })`, `SOUTH` = a small `Component` with an `HBox` layout holding `[saveBtn, statusText]` side by side (replacing the single `statusText` that used to sit alone in `SOUTH`, now that "Save" has no toolbar to live in). Every row/column/underline/colour/merge/align/columns/insert-table/insert-image button and its handler method is deleted — that functionality now lives inside `MarkdownDocumentPanel`. The class's JSDoc is rewritten to describe the new, much smaller composition:

```typescript
/**
 * Demo panel showcasing the [`MarkdownDocumentPanel`](/api/component/editor/classes/MarkdownDocumentPanel)
 * component beside the read-only [`Markdown`](/api/component/display/classes/Markdown)
 * viewer. Editing on the left drives the viewer on the right through
 * `MarkdownDocumentPanel`'s own `"change"` event and `getValue()`, visually
 * proving the dialect round-trips: what you edit renders identically in the
 * viewer. A status row below the editor reports the editor's own dirty flag
 * and the panel's own, the panel's arriving through the framework's
 * parent-to-child relay three containers up; Save clears it, and so does
 * undoing an edit back to the last-saved text.
 */
```

("three containers up" still holds: `MarkdownEditor` → `MarkdownDocumentPanel` → `editorHost` → `this`, the same depth as before — `MarkdownDocumentPanel` takes over the level the old `editorFit` `Panel` used to occupy.)

---

## Ordered Implementation Steps

1. **Create `MarkdownDocumentPanel.ts`.** Add `packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts` with the full contents from Internal Structure above.
   Verify: `npm run typecheck` passes with no other files changed yet (the new file compiles standalone against existing exports).

2. **Export it from the `component/editor` barrel.** In [component/editor/index.ts](packages/lib/src/typescript/lib/component/editor/index.ts), add, after the existing `MarkdownEditor` export lines:
   ```typescript
   export { MarkdownDocumentPanel } from '~/component/editor/MarkdownDocumentPanel.js';
   export type { MarkdownDocumentPanelOptions } from '~/component/editor/MarkdownDocumentPanel.js';
   ```
   Verify: `grep -n "MarkdownDocumentPanel" packages/lib/src/typescript/lib/component/editor/index.ts` shows both lines.

3. **Rewrite the demo, `MarkdownEditorPanel.ts`.** Replace the imports, constructor, JSDoc, and delete every `handleX` method the toolbar buttons used, per "Demo migration" above:
   - Imports: remove `ToolBar` (from `component/menubar`) and `ToggleButton` (from `component/button`); remove `MarkdownEditor` (from `component/editor`); add `MarkdownDocumentPanel` (from `component/editor`); add `Component` (to the existing `core` import alongside `callable, Panel`) and `HBox` (to the existing `layout` import alongside `Border, Fit, Split`).
   - Fields: replace `_editor: MarkdownEditor` with `_editorPanel: MarkdownDocumentPanel`; keep `_viewer` and `_statusText`.
   - Constructor: build `this._editorPanel = new MarkdownDocumentPanel({ value: SAMPLE })`; build `saveBtn` (unchanged `Button('Save')`, action retargeted to `this._editorPanel.markClean()`); build a `statusRow` (`new Component({ layoutManager: new HBox() })`) holding `[saveBtn, this._statusText]`; dock `this._editorPanel` `CENTER` and `statusRow` `SOUTH` on `editorHost`; wire `this._editorPanel.on('change', () => this.syncViewer())`.
   - Delete `handleInsertTable`, `handleInsertRow`, `handleDeleteRow`, `handleInsertColumn`, `handleDeleteColumn`, `handleUnderline`, `handleColour`, `handleMergeCells`, `handleAlignCentre`, `handleColumns`, `handleInsertImage`.
   - Update `syncViewer()` and `handleDirtyChange()` to read from `this._editorPanel` instead of `this._editor` (both already call only `getValue()`/`isDirty()`, so this is a rename, not a logic change).
   - Replace the class JSDoc with the text in "Demo migration" above.
   Verify: `npm run typecheck` passes; `grep -n "handleInsertTable\|handleInsertRow\|handleUnderline\|handleColour\|handleMergeCells\|handleAlignCentre\|handleColumns\|handleInsertImage" packages/lib/src/typescript/MarkdownEditorPanel.ts` returns zero matches.

4. **Add the test file.** Create `packages/lib/tests/component/markdown-document-panel.test.ts` per "Expected Behaviour" below, following the `installTestDOM`/`DOM.reset()` fixture shape in [TabPanel.test.ts:1-27](packages/lib/tests/component/container/TabPanel.test.ts#L1-L27) and reusing the caret/selection helpers already proven against `MarkdownEditor` in [markdown-editor.test.ts](packages/lib/tests/component/markdown-editor.test.ts) (e.g. `selectStart`) for the format-toggle round-trip cases.
   Verify: `cd packages/lib && npx vitest run tests/component/markdown-document-panel.test.ts` — all cases pass.

5. **Add the docs page.** Create `packages/lib/docs/components/MarkdownDocumentPanel.md`, following [TablePanel.md](packages/lib/docs/components/TablePanel.md)'s section shape (intro + link to the composed component, Usage, a section per notable delegation, See also). Cover: what it composes, the toolbar's button groups (a short version of the table in "Button/dropdown grouping" above), `getEditor()`/`getToolbar()` as the escape hatch for anything not delegated, and a link to `MarkdownEditor.md` for the format-command semantics.
   Verify: the page renders in the docs dev server (`npm run docs:dev`) with no broken links.

6. **Add the manifest catalog entry.** In [scripts/llms/manifest.data.mjs](packages/lib/scripts/llms/manifest.data.mjs), in the `"Display"` group, directly after the `MarkdownEditor` entry (line 102):
   ```javascript
   { task: "WYSIWYG Markdown editor with a built-in glyph toolbar", symbol: "MarkdownDocumentPanel" },
   ```
   Verify: `npm run llms:generate` (or whatever `generate.mjs`'s package-script name is — confirm in `package.json`) regenerates `packages/lib/llms.txt` with the new row and fails loudly if `MarkdownDocumentPanel` isn't resolvable against the TypeDoc model (the manifest's own drift guard) — run it only after Step 1-2 land so the symbol exists.

7. **Add the changelog entry.** In [next.md](packages/lib/docs/reference/changelog/next.md), under `## Added` → `### Components` (after the last existing bullet in that block, currently ending at [:197](packages/lib/docs/reference/changelog/next.md#L197), before `### Data` at [:199](packages/lib/docs/reference/changelog/next.md#L199)):
   ```markdown
   - **New component `MarkdownDocumentPanel`** (`component/editor`), a
     `Container` combining a `MarkdownEditor` with a glyph-only toolbar:
     format toggles (Bold/Italic/Underline/Strikethrough/Code), Insert and
     Table dropdowns, Text style/Alignment/Columns dropdowns, and an "Edit
     Markdown source" toggle pinned to the toolbar's far right. Delegates
     `getValue()`/`setValue()`/`markClean()`/the `"change"` event to the
     owned editor, and exposes `getEditor()`/`getToolbar()` for anything
     else. The `MarkdownEditorPanel` demo now builds one of these instead of
     its own hand-rolled toolbar.
   ```
   This plan lands its changelog entry in the same section the sibling context-menu-reorg plan also writes to ([next.md:152](packages/lib/docs/reference/changelog/next.md#L152) area, under `## Changed` rather than `## Added`) — the two bullets don't overlap in wording, but re-read the surrounding lines before inserting in case the other plan has already landed and shifted line numbers.

8. **Full verification.** Run everything in `## Verification` below.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts` |
| Create | `packages/lib/tests/component/markdown-document-panel.test.ts` |
| Create | `packages/lib/docs/components/MarkdownDocumentPanel.md` |
| Modify | `packages/lib/src/typescript/lib/component/editor/index.ts` |
| Modify | `packages/lib/src/typescript/MarkdownEditorPanel.ts` |
| Modify | `packages/lib/scripts/llms/manifest.data.mjs` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

No changes to `MarkdownEditor.ts` or any file the sibling plan touches.

---

## Expected Behaviour

**Toolbar structure**, unit-testable by walking `panel.getToolbar().getComponents()`:

| Position(s) | Children | Kind |
|---|---|---|
| 0-4 | Bold, Italic, Underline, Strikethrough, Code | `Button`, glyph-only |
| 5 | separator | `ToolBarSeparator` |
| 6-7 | Insert, Table | `MenuButton`, glyph-only |
| 8 | separator | `ToolBarSeparator` |
| 9-11 | Text style, Alignment, Columns | `MenuButton`, glyph-only |
| 12 | flex spacer | `Spacer` (`isFlex()` true) |
| 13 | Edit Markdown source | `ToggleButton`, glyph-only |

Total: 14 children.

**Behavioural cases:**

1. Every one of the 5 format buttons, when its `"action"` fires, calls the matching `MarkdownEditor` command (`toggleBold`/`toggleItalic`/`toggleUnderline`/`toggleStrikethrough`/`toggleInlineCode`) — verified end to end: select text via `selectStart`, click the button, assert `getValue()` gained the matching Markdown marker (e.g. Bold on `word` produces `**word**`).
2. Insert dropdown's "Table" item calls `insertTable(2, 3)` — verified via `getValue()` gaining a 3-line table (header, delimiter, one body row), the same assertion shape the sibling plan uses for its own "Insert ▸ Table" test.
3. Insert dropdown's "Bulleted list"/"Numbered list" items call `toggleUnorderedList()`/`toggleOrderedList()` — verified the same way the sibling plan verifies its own context-menu items (`selectStart`, then assert `getValue()` contains `- word` / `1. word`).
4. Every Table dropdown leaf reaches its documented command (`insertTableRow(false/true)`, `deleteTableRow`, `insertTableColumn(false/true)`, `deleteTableColumn`, `deleteTable`, `mergeTableCells`, `unmergeTableCell`, `setTableColumnAlignment(alignment)`) and is a no-op without throwing when called with the caret outside a table — construct a panel, call each without ever inserting a table first, and assert `getValue()` is unchanged and nothing throws.
5. Text style/Alignment/Columns dropdown leaves reach `setTextColor`/`setFontFamily`/`setFontSize`/`setBlockAlignment`/`setColumnCount` with the exact literal arguments in "Internal Structure" above (e.g. "Red" → `"#cc0000"`, "2 columns" → `2`).
6. `new MarkdownDocumentPanel({ value: "hello" }).getValue()` returns `"hello"`.
7. `panel.setValue("x")` changes `panel.getValue()` to `"x"`.
8. `panel.on("change", listener)`: calling `panel.getEditor().setValue("y")` fires `listener` once with a payload equal to what `MarkdownEditor`'s own `"change"` event would have delivered.
9. `panel.isDirty()` is `false` on construction, becomes `true` after an edit (e.g. `panel.getEditor().toggleBold()` with a selection), and returns to `false` after `panel.markClean()`.
10. `panel.getEditor()` returns the same `MarkdownEditor` instance docked `CENTER`; `panel.getToolbar()` returns the same `ToolBar` instance docked `NORTH`.
11. The "Edit Markdown source" toggle's `"action"` calls `getEditor().setMode("source")` when selected and `setMode("wysiwyg")` when deselected.

**Manual verification** (visual/layout, not unit-testable offline):
- The editor renders and scrolls its own content correctly docked directly in `Border`'s `CENTER` region, with no intermediate `Fit` wrapper — open the demo, paste enough content to overflow the editor's height, confirm it scrolls internally rather than growing the panel.
- Every `MenuButton` dropdown opens/closes correctly anchored under its toolbar button, including the two-level submenus (Insert▸Row above, Align column▸Left) rendering and dismissing properly nested inside a `ToolBar`.
- Hovering each glyph-only button shows its tooltip text from the table in Internal Structure.
- The "Edit Markdown source" toggle still visibly depresses when selected and switches the editor to the raw-source surface.

---

## Verification

- `npm run typecheck` — clean.
- `cd packages/lib && npx vitest run tests/component/markdown-document-panel.test.ts` — all new cases pass.
- `npm test` — full suite stays green (confirms the demo rewrite didn't break anything importing `MarkdownEditorPanel.ts`, and that no other test imports the deleted demo handler methods).
- `npm run lint` — clean.
- `npm run docs:api` — zero warnings (this class's public JSDoc must not `{@link}` any private/internal symbol, per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s `{@link}` rule).
- `npm run llms:generate` (confirm exact script name in `package.json` first) — regenerates `llms.txt` cleanly with `MarkdownDocumentPanel` present.
- Manual, on the dev server (`npm run dev`, `localhost:8015`, the **MD Editor** demo section): every item under "Manual verification" above, plus clicking through every toolbar dropdown leaf once to confirm it still edits the sample document as the old demo buttons did.

---

## Documentation Impact

- New page [`packages/lib/docs/components/MarkdownDocumentPanel.md`](packages/lib/docs/components/MarkdownDocumentPanel.md) — see Step 5.
- [`packages/lib/llms.txt`](packages/lib/llms.txt) gains the new catalog row via the manifest (Step 6) — never hand-edit this generated file.
- [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) — new entry, Step 7.
- [`packages/lib/src/typescript/lib/component/editor/index.ts`](packages/lib/src/typescript/lib/component/editor/index.ts) — new export, Step 2.
- No existing doc page references `MarkdownEditorPanel` by name (it is a demo-gallery class, not a documented component) or the old toolbar's button labels, so nothing else needs updating (confirmed by the request's scope — the demo file has never had its own doc page).

---

## Potential Challenges

- **Two unrelated things are both labelled "Table."** The Insert dropdown's "Table" leaf item (creates a new 2×3 table) and the separate Table toolbar dropdown (edits an existing table) share a label with different meaning and no runtime interaction — the same ambiguity the sibling plan notes between its two "Insert" submenus. Nothing to reconcile; both are copied verbatim from the sibling plan's target structure, which already accepts this.
- **`ToolBar`'s flat/compact auto-styling applies to `MenuButton` children too**, since `MenuButton extends Button` — this is intended (dropdown triggers should look like the rest of the bar), but double-check visually that a `MenuButton`'s own chevron-free, glyph-only face doesn't look like a dead-end button with no indication it opens a menu; `ToolBar`'s own overflow trigger is the same glyph-only, no-chevron shape, so this is expected house style, not a new problem.
- **Duplicated menu-item catalogs.** The Insert/Table/Text style/Alignment/Columns arrays in `MarkdownDocumentPanel.ts` are hand-copied from `MarkdownEditor.ts`'s private context-menu builders, not shared code — a future change to one won't propagate to the other. Accepted for this plan; see Notes.
- **`npm run llms:generate`'s exact package-script name is unconfirmed** — check `package.json` before Step 6; the manifest's own drift guard will fail loudly if the symbol name is wrong, so this is self-catching, not silent.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/TablePanel.ts`](packages/lib/src/typescript/lib/component/table/TablePanel.ts) — the `Container` + `Border` + toolbar-`NORTH`/content-`CENTER` structural precedent, plus `getTable()`/`getToolbar()` as the escape-hatch-accessor precedent.
- [`packages/lib/src/typescript/lib/component/container/TabPanel.ts`](packages/lib/src/typescript/lib/component/container/TabPanel.ts) — the generic `<TOptions>` options-bag composite-`Container` precedent.
- [`packages/lib/src/typescript/lib/component/menubar/ToolBar.ts`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts) and [`ToolBarSeparator.ts`](packages/lib/src/typescript/lib/component/menubar/ToolBarSeparator.ts) — the toolbar itself.
- [`packages/lib/src/typescript/ToolBarPanel.ts`](packages/lib/src/typescript/ToolBarPanel.ts) — the glyph-only `{glyph,text,showText:false}` pattern and the `Spacer.flex()` left/right split, both reused verbatim.
- [`packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts`](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts) — the composite-re-emits-a-child's-custom-event pattern (`ListenerBag` + named-field handler), reused for the `"change"` event.
- [`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) — every command this plan's menu items call; not modified, but every literal argument in Internal Structure is taken from reading this file directly.
- [`plans/markdown-editor-context-menu-reorg.md`](plans/markdown-editor-context-menu-reorg.md) — the sibling plan whose target Insert/Table submenu shapes this plan's Insert/Table dropdowns mirror.
- [`packages/lib/src/typescript/MarkdownEditorPanel.ts`](packages/lib/src/typescript/MarkdownEditorPanel.ts) — the demo being migrated; read in full before editing.
- [`packages/lib/tests/component/container/TabPanel.test.ts`](packages/lib/tests/component/container/TabPanel.test.ts) — the composite-component test-depth precedent.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the custom-event (`on`/`off`/`emit`/`ListenerBag`) rule and the options-bag/typed-setter conventions this plan follows throughout.

---

## Non-Goals

- **Live pressed/active toolbar state reflecting the caret's current formatting** — investigated, no-go for this plan; see the matching Architecture Decision and [^live-state-rejected]. Would need new public surface on `MarkdownEditor.ts`.
- **Link and Clear formatting toolbar entries** — no demo precedent, stay context-menu-only; see "Button/dropdown grouping."
- **A Heading dropdown** — not part of the request's named Insert/Table groups and no demo precedent; stays context-menu-only.
- **Any change to `MarkdownEditor.ts`** — this plan is fully additive; every menu-item array it needs is re-declared locally rather than promoting any `MarkdownEditor` private method to `public`.
- **Sharing menu-item catalogs between the context menu and this toolbar** — accepted duplication; see Potential Challenges.
- **The dirty-status `SOUTH` line moving into the library component** — stays in the demo; see the matching Architecture Decision.
- **`ToolBar`'s `overflow: "menu"` mode** — the button set is small and bounded; not needed for this component.

---

## Notes

[^naming]: `MarkdownEditorPanel` (the demo class) and `MarkdownEditor`/`Markdown` (existing library exports) rule out any name built from those two words in that order. `MarkdownDocumentPanel` reads as "a panel for editing a Markdown document" — the same "name the *Panel* after its primary content noun" convention `TablePanel` uses (named after the `Table` it contains, not the toolbar sitting above it), applied here to "document" since "Editor" is already spoken for by `MarkdownEditor` itself.

[^no-fit-wrapper]: The demo currently wraps the editor in `new Panel({ layoutManager: new Fit() })` before docking it `CENTER`. `TablePanel` docks its `Table` — which, like `MarkdownEditor`, needs a bounded height for its own internal scrolling — directly into `Border`'s `CENTER` with no such wrapper, and ships this way today. `Border`'s `CENTER` region already assigns a single child the full remaining rect, the same sizing `Fit` would provide, so the wrapper is redundant; `TablePanel`'s shipped, working behavior is the evidence, not a re-read of `Border`'s layout code. The manual verification step for this plan (see Expected Behaviour) explicitly re-checks that the editor still scrolls internally rather than growing its parent, to catch it early if this equivalence is ever wrong for some `MarkdownEditor`-specific reason `Table` doesn't share.

[^tooltip-pattern]: `TablePanel`'s buttons are constructed with `{ glyph }` alone (no `text`), so they have nothing to reuse as a tooltip/accessible-name source and need the separate `Tooltip.attach` call. Every button in this plan already carries a natural `text` value (its context-menu-equivalent label), so folding the tooltip into `text` + `showText: false` is one fewer import and one fewer call per button, and — unlike `Tooltip.attach` alone — also sets the accessible name (`aria-label`) automatically.

[^table-tradeoff]: The alternative — a live-enabled/disabled Table dropdown, or a dropdown whose "Align column" checkmark reflects the current column — was considered and rejected. It would require `MarkdownDocumentPanel` to read `MarkdownEditor`'s live selection state, which (see "Live pressed/active toolbar state," this plan's rejected stretch goal) has no public API today. Omitting the Table dropdown from the toolbar entirely was also considered and rejected: the demo already ships working, always-enabled row/column toolbar buttons today, and "do not silently drop existing demo functionality" rules out removing that capability from the toolbar without a stronger reason than "a context menu could do it too."

[^dialog-duplication]: The alternative — promoting `promptAndInsertImage`/`promptAndSetColumnWidth` (and the `promptForText` helper both call) from `private` to `public` on `MarkdownEditor` — was considered and rejected. It would add public API surface to `MarkdownEditor.ts` whose only consumer is this one composite component, and it touches a file the sibling context-menu-reorg plan is concurrently editing (though not the same methods), adding avoidable merge friction between two otherwise-independent plans. Re-implementing ~25 lines of an idiom the codebase already documents as "established" ([MarkdownEditor.ts:2199-2201](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2199-L2201)) is cheaper than either alternative.

[^live-state-rejected]: Reading `MarkdownEditor.ts`'s context-menu classification code confirms `$classifyContextMenuTarget` and the format-state it computes are Lexical-internal, invoked only from the `contextmenu` DOM handler — there is no `"selectionchange"`-shaped public event, and no public getter for "the current selection's format." Building one would mean registering a Lexical `SELECTION_CHANGE_COMMAND` listener inside `MarkdownEditor.ts`, computing the same `{bold, italic, underline, strikethrough, code}` shape `buildFormatToggleItems` already computes for the context menu, and exposing it as a new public event or getter — real, non-trivial work inside a file this plan otherwise leaves untouched, and inside a file the sibling plan is concurrently mid-edit on. Left for a future, separately-scoped plan.
