// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Container, ContainerOptions } from "~/core/Container.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";
import { Border } from "~/layout/Border.js";
import { Placement } from "~/primitive/Placement.js";
import { Button } from "~/component/button/Button.js";
import { ToggleButton } from "~/component/button/ToggleButton.js";
import { MenuButton } from "~/component/button/MenuButton.js";
import type { MenuButtonOptions } from "~/component/button/MenuButton.js";
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

/**
 * Construction-time options for {@link MarkdownDocumentPanel}.
 *
 * @category Components
 */
export interface MarkdownDocumentPanelOptions extends ContainerOptions {
    /** Initial Markdown value, forwarded to the owned MarkdownEditor. Defaults to "". */
    value?: string;
}

/**
 * A [`Container`](/api/core/classes/Container) that docks a glyph-only
 * [`ToolBar`](/api/component/menubar/classes/ToolBar) `NORTH` and a
 * [`MarkdownEditor`](/api/component/editor/classes/MarkdownEditor) `CENTER`
 * via a [`Border`](/api/layout/classes/Border) layout — the "toolbar +
 * content, both owned" shape [`TablePanel`](/api/component/table/classes/TablePanel)
 * uses for `Table`. The toolbar groups its buttons the same way the editor's
 * own right-click context menu is grouped: five format toggles
 * (Bold/Italic/Underline/Strikethrough/Code), an Insert dropdown, a Table
 * dropdown, Text style/Alignment/Columns dropdowns, and an "Edit Markdown
 * source" toggle pinned to the toolbar's far right.
 *
 * This class delegates only `getValue()` / `setValue()` / `markClean()` /
 * the `"change"` event — anything else `MarkdownEditor` exposes is reached
 * through {@link getEditor}, and toolbar-level tuning through {@link getToolbar}.
 *
 * @example
 * ```typescript
 * import { MarkdownDocumentPanel } from '@jimka/typescript-ui/component/editor';
 *
 * const panel = new MarkdownDocumentPanel({ value: '# Hello' });
 * panel.on('change', ({ value }) => console.log(value));
 * ```
 *
 * @category Components
 */
class MarkdownDocumentPanel<TOptions extends MarkdownDocumentPanelOptions = MarkdownDocumentPanelOptions>
    extends Container<TOptions> {

    private readonly _editor:  MarkdownEditor;
    private readonly _toolbar: ToolBar;

    private readonly _listeners: ListenerBag<"change"> =
        this.registerListenerBag(new ListenerBag<"change">());

    private readonly handleEditorChange: (payload: MarkdownEditorChange) => void =
        (payload) => this.emit("change", payload);

    /**
     * Constructs a `MarkdownDocumentPanel`, its owned `MarkdownEditor`, and its toolbar.
     *
     * @param options - Optional construction-time options.
     */
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

        // The generic <MenuButtonOptions> argument is required on every call
        // below: MenuButton's options-only overload accepts its generic
        // TOptions directly (unlike Button/ToolBar, which pin that parameter
        // to their concrete Options type for exactly this reason), so an
        // inline literal would otherwise narrow TOptions to that literal's
        // shape and fail the widening check when passed to addComponents.
        const insertBtn = new MenuButton<MenuButtonOptions>({
            glyph: "plus", text: "Insert…", showText: false,
            menuItems: this.buildInsertMenuItems(),
        });

        const tableBtn = new MenuButton<MenuButtonOptions>({
            glyph: "table", text: "Table…", showText: false,
            menuItems: this.buildTableMenuItems(),
        });

        const textStyleBtn = new MenuButton<MenuButtonOptions>({
            glyph: "palette", text: "Text style…", showText: false,
            menuItems: this.buildTextStyleMenuItems(),
        });

        const alignmentBtn = new MenuButton<MenuButtonOptions>({
            glyph: "align-left", text: "Alignment…", showText: false,
            menuItems: this.buildAlignmentMenuItems(),
        });

        const columnsBtn = new MenuButton<MenuButtonOptions>({
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

    /**
     * Current Markdown value — delegates to the owned MarkdownEditor.
     *
     * @returns The Markdown source, or `""` when unset.
     */
    getValue(): string {
        return this._editor.getValue();
    }

    /**
     * Sets the Markdown value — delegates to the owned MarkdownEditor.
     *
     * @param value - The new Markdown source.
     * @returns This component, for method chaining.
     */
    setValue(value: string): this {
        this._editor.setValue(value);

        return this;
    }

    /**
     * Clears the dirty flag — delegates to the owned MarkdownEditor.
     *
     * @returns This component, for method chaining.
     */
    markClean(): this {
        this._editor.markClean();

        return this;
    }

    /**
     * The owned MarkdownEditor, for any API this class doesn't re-expose.
     *
     * @returns The owned `MarkdownEditor` instance.
     */
    getEditor(): MarkdownEditor {
        return this._editor;
    }

    /**
     * The owned ToolBar.
     *
     * @returns The owned `ToolBar` instance.
     */
    getToolbar(): ToolBar {
        return this._toolbar;
    }

    /**
     * Registers a listener fired whenever the owned MarkdownEditor's
     * `"change"` event fires.
     *
     * @param event - Must be `"change"`.
     * @param listener - Invoked with the new Markdown value.
     * @returns This component, for method chaining.
     */
    on(event: "change", listener: (payload: MarkdownEditorChange) => void): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered `"change"` listener.
     *
     * @param event - Must be `"change"`.
     * @param listener - The exact callback reference to remove.
     * @returns This component, for method chaining.
     */
    off(event: "change", listener: (payload: MarkdownEditorChange) => void): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fans the `"change"` event out to its registered listeners.
     *
     * @param event - Must be `"change"`.
     * @param payload - The event payload.
     */
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
