// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Container, ContainerOptions } from "~/core/Container.js";
import { Component } from "~/core/Component.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";
import type { Rect } from "~/core/DOM.js";
import { Border } from "~/layout/Border.js";
import { VBox } from "~/layout/VBox.js";
import { HBox } from "~/layout/HBox.js";
import { Placement } from "~/primitive/Placement.js";
import { Button } from "~/component/button/Button.js";
import { ToggleButton } from "~/component/button/ToggleButton.js";
import { MenuButton } from "~/component/button/MenuButton.js";
import type { MenuButtonOptions } from "~/component/button/MenuButton.js";
import { PopupButton } from "~/component/button/PopupButton.js";
import type { PopupButtonOptions } from "~/component/button/PopupButton.js";
import { ToolBar } from "~/component/menubar/ToolBar.js";
import { ToolBarSeparator } from "~/component/menubar/ToolBarSeparator.js";
import { Spacer } from "~/component/container/Spacer.js";
import { MenuItemConfig } from "~/component/container/MenuItem.js";
import { MarkdownEditor } from "~/component/editor/MarkdownEditor.js";
import type { MarkdownEditorChange, MarkdownEditorSelectionState } from "~/component/editor/MarkdownEditor.js";
import { Dialog, DialogButtons } from "~/overlay/Dialog.js";
import { PopupPanel } from "~/overlay/PopupPanel.js";
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
import { link }          from "~/glyphs/solid/link.js";

Glyph.register(bold, italic, underline, strikethrough, code, plus, table, palette, align_left, columns, file_code, link);

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
 * The Link toolbar button's popup content: a URL field and an Insert/Update
 * action, plus a Remove action while editing an existing link. Exported
 * (not part of `component/editor/index.ts`'s barrel) so tests can construct
 * and drive it directly, mirroring how `MarkdownEditor.ts`'s own
 * `$classifyContextMenuTarget` is exported for the same reason.
 */
export class LinkPopupPanel extends PopupPanel {
    private readonly _urlField:   TextField;
    private readonly _submitBtn:  Button;
    private readonly _removeBtn:  Button;
    private readonly _getLinkUrl: () => string | null;
    private readonly _onSubmit:   (url: string) => void;
    private readonly _onRemove:   () => void;

    // The URL the popup was last opened with — null outside a link, its URL
    // inside one. Set by showAt(), read by handleSubmit() to skip a no-op
    // resubmit of the same URL (mirrors promptAndApplyLink's defaultUrl check).
    private _openedWithUrl: string | null = null;

    /**
     * @param getLinkUrl - Reads the enclosing link's URL (or `null`) at the
     *   moment the popup opens.
     * @param onSubmit - Called with the field's trimmed value when the user
     *   confirms a new or changed URL.
     * @param onRemove - Called when the user clicks Remove link.
     */
    constructor(getLinkUrl: () => string | null, onSubmit: (url: string) => void, onRemove: () => void) {
        super({ layoutManager: new VBox({ spacing: 6, stretching: true }) });

        this._getLinkUrl = getLinkUrl;
        this._onSubmit   = onSubmit;
        this._onRemove   = onRemove;

        this._urlField  = new TextField({ placeholder: "https://example.com" });
        this._submitBtn = new Button("Insert link");
        this._removeBtn = new Button("Remove link");

        this._submitBtn.on("action", () => this.handleSubmit());
        this._removeBtn.on("action", () => this.handleRemove());

        this.addComponents(
            this._urlField,
            new Component({
                layoutManager: new HBox({ spacing: 4 }),
                components:    [this._submitBtn, this._removeBtn],
            }),
        );
    }

    /**
     * Refreshes the field/buttons from {@link _getLinkUrl} before delegating
     * to the inherited placement/measurement logic, so the popup's content
     * is current on every open.
     *
     * @param anchorRect - The trigger's bounding rect to place against.
     * @returns This panel, for method chaining.
     */
    showAt(anchorRect: Rect): this {
        this._openedWithUrl = this._getLinkUrl();

        this._urlField.setValue(this._openedWithUrl ?? "");
        this._submitBtn.setText(this._openedWithUrl === null ? "Insert link" : "Update link");
        this._removeBtn.setVisible(this._openedWithUrl !== null);

        return super.showAt(anchorRect);
    }

    /** Submits the field's trimmed value via `onSubmit`, unless it's empty or unchanged from the URL the popup was opened with, then closes the popup. */
    private handleSubmit(): void {
        const url = this._urlField.getValue().trim();

        if (url !== "" && url !== this._openedWithUrl) {
            this._onSubmit(url);
        }

        this.requestClose();
    }

    /** Calls `onRemove`, regardless of the field's contents, then closes the popup. */
    private handleRemove(): void {
        this._onRemove();
        this.requestClose();
    }
}

/**
 * A [`Container`](/api/core/classes/Container) that docks a glyph-only
 * [`ToolBar`](/api/component/menubar/classes/ToolBar) `NORTH` and a
 * [`MarkdownEditor`](/api/component/editor/classes/MarkdownEditor) `CENTER`
 * via a [`Border`](/api/layout/classes/Border) layout — the "toolbar +
 * content, both owned" shape [`TablePanel`](/api/component/table/classes/TablePanel)
 * uses for `Table`. The toolbar groups its buttons the same way the editor's
 * own right-click context menu is grouped: five format toggles
 * (Bold/Italic/Underline/Strikethrough/Code), a Link button, an Insert
 * dropdown, a Table dropdown, Text style/Alignment/Columns dropdowns, and an
 * "Edit Markdown source" toggle pinned to the toolbar's far right.
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

    // Definite-assignment: assigned inside buildToolbar(), not the
    // constructor body directly, mirroring Button.ts's `private _text!: Text;`.
    private _boldBtn!:          ToggleButton;
    private _italicBtn!:        ToggleButton;
    private _underlineBtn!:     ToggleButton;
    private _strikethroughBtn!: ToggleButton;
    private _codeBtn!:          ToggleButton;
    private _linkBtn!:          PopupButton<PopupButtonOptions>;
    private _tableBtn!:         MenuButton<MenuButtonOptions>;

    private readonly _listeners: ListenerBag<"change"> =
        this.registerListenerBag(new ListenerBag<"change">());

    private readonly handleEditorChange: (payload: MarkdownEditorChange) => void =
        (payload) => this.emit("change", payload);

    private readonly handleSelectionState: (state: MarkdownEditorSelectionState) => void =
        (state) => this.applySelectionState(state);

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
        this._editor.on("selectionstate", this.handleSelectionState);

        this._toolbar = this.buildToolbar();

        super.addComponent(this._toolbar, { placement: Placement.NORTH });
        super.addComponent(this._editor,  { placement: Placement.CENTER });

        this.applySelectionState(this._editor.getSelectionState());
    }

    /**
     * Builds the toolbar: the five format toggles and the Link button,
     * Insert and Table dropdowns on the far left, Text style/Alignment/Columns
     * dropdowns beside them, a flex spacer, then the "Edit Markdown source"
     * toggle pinned to the far right.
     *
     * @returns The constructed ToolBar, not yet parented.
     */
    private buildToolbar(): ToolBar {
        const bar = new ToolBar();

        this._boldBtn          = new ToggleButton("Bold", { glyph: "bold", showText: false });
        this._italicBtn        = new ToggleButton("Italic", { glyph: "italic", showText: false });
        this._underlineBtn     = new ToggleButton("Underline", { glyph: "underline", showText: false });
        this._strikethroughBtn = new ToggleButton("Strikethrough", { glyph: "strikethrough", showText: false });
        this._codeBtn          = new ToggleButton("Code", { glyph: "code", showText: false });

        this._boldBtn.on("action",          () => { this._editor.toggleBold(); });
        this._italicBtn.on("action",        () => { this._editor.toggleItalic(); });
        this._underlineBtn.on("action",     () => { this._editor.toggleUnderline(); });
        this._strikethroughBtn.on("action", () => { this._editor.toggleStrikethrough(); });
        this._codeBtn.on("action",          () => { this._editor.toggleInlineCode(); });

        // The generic <PopupButtonOptions> argument is required for the same
        // reason as <MenuButtonOptions> below: PopupButton's options-only
        // overload accepts its generic TOptions directly, so an inline
        // literal would otherwise narrow TOptions to that literal's shape
        // and fail the widening check when passed to addComponents.
        this._linkBtn = new PopupButton<PopupButtonOptions>({
            glyph: "link", text: "Link…", showText: false,
            panel: () => new LinkPopupPanel(
                () => this._editor.getSelectionState().linkUrl,
                (url) => this._editor.toggleLink(url),
                () => this._editor.removeLink(),
            ),
        });

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

        this._tableBtn = new MenuButton<MenuButtonOptions>({
            glyph: "table", text: "Table…", showText: false,
            menuItems: () => this.buildTableMenuItems(),
        });

        const textStyleBtn = new MenuButton<MenuButtonOptions>({
            glyph: "palette", text: "Text style…", showText: false,
            menuItems: this.buildTextStyleMenuItems(),
        });

        const alignmentBtn = new MenuButton<MenuButtonOptions>({
            glyph: "align-left", text: "Alignment…", showText: false,
            menuItems: () => this.buildAlignmentMenuItems(),
        });

        const columnsBtn = new MenuButton<MenuButtonOptions>({
            glyph: "columns", text: "Columns…", showText: false,
            menuItems: () => this.buildColumnsMenuItems(),
        });

        const sourceToggle = new ToggleButton("Edit Markdown source", { glyph: "file-code", showText: false });
        sourceToggle.on("action", () => { this._editor.setMode(sourceToggle.isSelected() ? "source" : "wysiwyg"); });

        bar.addComponents(
            this._boldBtn, this._italicBtn, this._underlineBtn, this._strikethroughBtn, this._codeBtn, this._linkBtn,
            ToolBarSeparator(),
            insertBtn, this._tableBtn,
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

    /** Table dropdown contents — mirrors the sibling plan's table-cell "Table" submenu, with a live Align column checkmark. */
    private buildTableMenuItems(): MenuItemConfig[] {
        const currentAlignment = this._editor.getSelectionState().tableColumnAlignment;

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
                        { text: "Left", checked: currentAlignment === "left", action: () => this._editor.setTableColumnAlignment("left") },
                        { text: "Center", checked: currentAlignment === "center", action: () => this._editor.setTableColumnAlignment("center") },
                        { text: "Right", checked: currentAlignment === "right", action: () => this._editor.setTableColumnAlignment("right") },
                        { text: "None", checked: currentAlignment === "none", action: () => this._editor.setTableColumnAlignment("none") },
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

    /** Alignment dropdown contents — verbatim from MarkdownEditor's own inline "Alignment" submenu, with a live checkmark. */
    private buildAlignmentMenuItems(): MenuItemConfig[] {
        const current = this._editor.getSelectionState().blockAlignment;

        return [
            { text: "Left", checked: current === "left", action: () => this._editor.setBlockAlignment("left") },
            { text: "Center", checked: current === "center", action: () => this._editor.setBlockAlignment("center") },
            { text: "Right", checked: current === "right", action: () => this._editor.setBlockAlignment("right") },
            { text: "Justify", checked: current === "justify", action: () => this._editor.setBlockAlignment("justify") },
            { text: "Default", checked: current === null, action: () => this._editor.setBlockAlignment(null) },
        ];
    }

    /** Columns dropdown contents — verbatim from MarkdownEditor's own buildColumnsMenuItem, with a live checkmark. */
    private buildColumnsMenuItems(): MenuItemConfig[] {
        const current = this._editor.getSelectionState().columnCount;

        return [
            { text: "2 columns", checked: current === 2, action: () => this._editor.setColumnCount(2) },
            { text: "3 columns", checked: current === 3, action: () => this._editor.setColumnCount(3) },
            { text: "4 columns", checked: current === 4, action: () => this._editor.setColumnCount(4) },
            { text: "None", checked: current === 1, action: () => this._editor.setColumnCount(null) },
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
     * Applies a {@link MarkdownEditorSelectionState} snapshot to the toolbar:
     * presses/releases the five format toggles; enables the Link button with
     * a text selection or while the caret is inside a link; and enables the
     * Table button only while the caret is inside a table — reusing
     * `Button`'s existing enabled/disabled state rather than a bespoke
     * highlight, since every command the Link popup or Table dropdown calls
     * is a no-op outside its respective context anyway. The Alignment,
     * Columns, and Table dropdowns need no push here — their `menuItems` are
     * providers that call {@link MarkdownEditor.getSelectionState} directly
     * at open time, so they are always current without a second copy of this
     * state.
     *
     * @param state - The selection state to reflect onto the toolbar.
     */
    private applySelectionState(state: MarkdownEditorSelectionState): void {
        this._boldBtn.setSelected(state.bold);
        this._italicBtn.setSelected(state.italic);
        this._underlineBtn.setSelected(state.underline);
        this._strikethroughBtn.setSelected(state.strikethrough);
        this._codeBtn.setSelected(state.code);
        this._linkBtn.setEnabled(state.hasSelectedText || state.linkUrl !== null);
        this._tableBtn.setEnabled(state.inTable);
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
