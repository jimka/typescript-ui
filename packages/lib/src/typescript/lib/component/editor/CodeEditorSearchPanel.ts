// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Event } from "~/core/Event.js";
import { FloatingPanel, FloatingPanelOptions } from "~/component/container/FloatingPanel.js";
import { HBox } from "~/layout/HBox.js";
import { VBox } from "~/layout/VBox.js";
import { Insets } from "~/primitive/Insets.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";
import { Glyph } from "~/component/display/Glyph.js";
import { Button } from "~/component/button/Button.js";
import { ToggleButton } from "~/component/button/ToggleButton.js";
import { TextField } from "~/component/input/TextField.js";
import { ToolBar } from "~/component/menubar/ToolBar.js";
import { ToolBarSeparator } from "~/component/menubar/ToolBarSeparator.js";
import { font } from "~/glyphs/solid/font.js";
import { text_width } from "~/glyphs/solid/text_width.js";
import { asterisk } from "~/glyphs/solid/asterisk.js";
import { chevron_up } from "~/glyphs/solid/chevron_up.js";
import { chevron_down } from "~/glyphs/solid/chevron_down.js";
import { list_check } from "~/glyphs/solid/list_check.js";
import { xmark } from "~/glyphs/solid/xmark.js";
import { arrow_right_arrow_left } from "~/glyphs/solid/arrow_right_arrow_left.js";
import { layer_group } from "~/glyphs/solid/layer_group.js";

Glyph.register(font, text_width, asterisk, chevron_up, chevron_down, list_check, xmark, arrow_right_arrow_left, layer_group);

/** The five values a search query is built from. */
export interface CodeEditorSearchFields {
    search:        string;
    replace:       string;
    caseSensitive: boolean;
    wholeWord:     boolean;
    regexp:        boolean;
}

/** The actions the panel's buttons and keys ask its owner to perform. */
export type CodeEditorSearchCommand =
    "findnext" | "findprevious" | "selectall" | "replacenext" | "replaceall" | "close";

/**
 * Construction-time options for {@link CodeEditorSearchPanel}.
 *
 * @category Components
 */
export interface CodeEditorSearchPanelOptions extends FloatingPanelOptions {
    listeners?: {
        querychange?: (fields: CodeEditorSearchFields) => void;
        command?:     (command: CodeEditorSearchCommand) => void;
    };
}

/**
 * Chrome shared between this panel's `_defaultOptions` and its
 * `ownClassStyleDefaults` — every `StyleBag` key the class defaults must
 * appear here, or an omitted key falls back to the framework baseline
 * instead of this class's own default once `ownClassStyleDefaults` is
 * declared at all (see the comment above `MARKDOWN_MINIMAP_CHROME` in
 * `MarkdownMinimap.ts`).
 */
const SEARCH_PANEL_CHROME: Pick<CodeEditorSearchPanelOptions, "backgroundColor" | "shadow" | "borderRadius"> = {
    backgroundColor: "var(--ts-ui-toolbar-bg, #f5f5f5)",
    shadow:          "var(--ts-ui-popover-shadow, 2px 4px 12px rgba(0, 0, 0, 0.18))",
    borderRadius:    "var(--ts-ui-border-radius, 4px)",
};

const _defaultCodeEditorSearchPanelOptions: Partial<CodeEditorSearchPanelOptions> = {
    ...SEARCH_PANEL_CHROME,
    corner: "top-right",
    // FloatingPanel defaults to zero insets; a card floating over live text
    // needs real padding or its controls sit flush against the shadow edge.
    insets: new Insets(6, 8, 6, 8),
};

/** Vertical gap between the find and replace rows. */
const ROW_SPACING_PX = 4;

/** Horizontal gap between controls within a row. */
const CONTROL_SPACING_PX = 4;

/**
 * Preferred height of the vertical `ToolBarSeparator`s grouping the find row's
 * buttons — shorter than the row itself, so a few pixels of breathing room
 * show above and below the rule instead of it spanning the row edge-to-edge.
 */
const SEPARATOR_HEIGHT_PX = 16;

/**
 * Preferred width of the find/replace text fields. Only the width is a real
 * hint: `TextField` overwrites the height component from its own
 * single-line box measurement regardless of what's requested here (see
 * `AbstractInput.ts`).
 */
const FIELD_WIDTH_PX = 160;

/**
 * A floating card offering `CodeEditor`'s search-and-replace controls,
 * pinned to the editor's upper-right corner and overlaying the document
 * instead of docking a strip that reserves space for it.
 *
 * Carries no CodeMirror knowledge of its own: every field edit, toggle, and
 * button press is reported through the `"querychange"` / `"command"` events,
 * and its owner (`CodeEditor`) translates them into `@codemirror/search`
 * commands and `SearchQuery` state. Not exported from the `component/editor`
 * barrel — an implementation detail of `CodeEditor`, like the file-local
 * `MarkdownContentPane` inside `MarkdownViewer.ts`.
 *
 * @category Components
 */
class CodeEditorSearchPanel extends FloatingPanel<CodeEditorSearchPanelOptions> {

    protected static readonly ownClassStyleDefaults: StyleBag = SEARCH_PANEL_CHROME;

    private readonly _listeners: ListenerBag<"querychange" | "command"> =
        this.registerListenerBag(new ListenerBag<"querychange" | "command">());

    /** `true` once {@link buildControls} has run. */
    private _built: boolean = false;

    // Built lazily by buildControls(), well after construction — a plain
    // definite-assignment field, not `declare`, since nothing dispatched
    // during the super() cascade writes these.
    private _findField!:       TextField;
    private _caseButton!:      ToggleButton;
    private _wordButton!:      ToggleButton;
    private _regexpButton!:    ToggleButton;
    private _previousButton!:  Button;
    private _nextButton!:      Button;
    private _selectAllButton!: Button;
    private _closeButton!:     Button;
    private _replaceField!:    TextField;
    private _replaceButton!:   Button;
    private _replaceAllButton!: Button;

    // Named handler fields (ARCHITECTURE.md's "listeners must reference a
    // named function" rule): each wraps the emit call its wired control
    // triggers, mirroring MarkdownViewer's `_onNarrower`-style fields.
    private readonly handleFindFieldChange:    () => void = () => this.notifyQueryChange();
    private readonly handleReplaceFieldChange: () => void = () => this.notifyQueryChange();
    private readonly handleCaseToggle:         () => void = () => this.notifyQueryChange();
    private readonly handleWordToggle:         () => void = () => this.notifyQueryChange();
    private readonly handleRegexpToggle:       () => void = () => this.notifyQueryChange();
    private readonly handlePreviousAction:     () => void = () => this.emit("command", "findprevious");
    private readonly handleNextAction:         () => void = () => this.emit("command", "findnext");
    private readonly handleSelectAllAction:    () => void = () => this.emit("command", "selectall");
    private readonly handleCloseAction:        () => void = () => this.emit("command", "close");
    private readonly handleReplaceAction:      () => void = () => this.emit("command", "replacenext");
    private readonly handleReplaceAllAction:   () => void = () => this.emit("command", "replaceall");

    private readonly handleFindFieldKeyDown: (e: KeyboardEvent) => Event.ListenerResult =
        (e) => this.onFindFieldKeyDown(e);
    private readonly handleReplaceFieldKeyDown: (e: KeyboardEvent) => Event.ListenerResult =
        (e) => this.onReplaceFieldKeyDown(e);

    constructor(options?: CodeEditorSearchPanelOptions, subclassDefaults?: Partial<CodeEditorSearchPanelOptions>) {
        super(options, { ..._defaultCodeEditorSearchPanelOptions, ...(subclassDefaults ?? {}) });

        this.applyListeners(options?.listeners);
    }

    /**
     * Builds the find/replace rows and their controls, wiring each to a
     * named handler field. Idempotent — a repeat call does nothing.
     *
     * @returns This panel, for method chaining.
     */
    buildControls(): this {
        if (this._built) {
            return this;
        }

        this._built = true;

        this.setLayoutManager(new VBox({ spacing: ROW_SPACING_PX }));

        this._findField    = new TextField({ preferredSize: { width: FIELD_WIDTH_PX, height: 0 } });
        this._caseButton    = new ToggleButton("Match upper and lower case exactly", { glyph: "font", showText: false });
        this._wordButton    = new ToggleButton("Match whole words only", { glyph: "text-width", showText: false });
        this._regexpButton  = new ToggleButton("Read the search text as a regular expression", { glyph: "asterisk", showText: false });
        this._previousButton = new Button({
            glyph: "chevron-up", text: "Find the previous match", showText: false,
            description: "Shift+Enter", showDescription: false,
        });
        this._nextButton = new Button({
            glyph: "chevron-down", text: "Find the next match", showText: false,
            description: "Enter", showDescription: false,
        });
        this._selectAllButton = new Button({ glyph: "list-check", text: "Select every match in the document", showText: false });
        this._closeButton = new Button({
            glyph: "xmark", text: "Close the search panel", showText: false,
            description: "Escape", showDescription: false,
        });

        // ToolBarSeparator's own constructor always ends by setting its
        // preferredSize itself (height: 0 for the default vertical
        // orientation, relying on the parent bar's stretching to give it a
        // visible extent) — setPreferredSize is called again here,
        // after construction, so this override actually sticks.
        const findSeparator1 = new ToolBarSeparator().setPreferredSize({ width: ToolBarSeparator.THICKNESS, height: SEPARATOR_HEIGHT_PX });
        const findSeparator2 = new ToolBarSeparator().setPreferredSize({ width: ToolBarSeparator.THICKNESS, height: SEPARATOR_HEIGHT_PX });

        const findRow = new ToolBar({
            border: "none",
            components: [
                this._previousButton,
                this._findField,
                this._caseButton,
                this._wordButton,
                this._regexpButton,
                findSeparator1,
                this._selectAllButton,
                findSeparator2,
                this._closeButton,
            ],
        });

        // ToolBar's HBox stretches every child to the bar's full height by
        // default, which is what makes the separators span it edge-to-edge —
        // mirrors FlowDemoPanel.buildToolbar's own `setStretching(false)` for
        // the same reason (a mix of natural-height children reads better
        // centred than uniformly stretched).
        const findRowLayout = findRow.getLayoutManager();

        if (findRowLayout instanceof HBox) {
            findRowLayout.setStretching(false);
            findRowLayout.setComponentSpacing(CONTROL_SPACING_PX);
        }

        this.addComponent(findRow);

        this._replaceField  = new TextField({ preferredSize: { width: FIELD_WIDTH_PX, height: 0 } });
        this._replaceButton = new Button({
            glyph: "arrow-right-arrow-left", text: "Replace the current match", showText: false,
            description: "Enter in the Replace field", showDescription: false,
        });
        this._replaceAllButton = new Button({ glyph: "layer-group", text: "Replace every match in the document", showText: false });

        const replaceRow = new ToolBar({
            border: "none",
            components: [
                this._nextButton,
                this._replaceField,
                this._replaceButton,
                this._replaceAllButton,
            ],
        });

        // Matches findRow's own override just above, so both rows centre
        // their natural-height children instead of one stretching and the
        // other not.
        const replaceRowLayout = replaceRow.getLayoutManager();

        if (replaceRowLayout instanceof HBox) {
            replaceRowLayout.setStretching(false);
            replaceRowLayout.setComponentSpacing(CONTROL_SPACING_PX);
        }

        this.addComponent(replaceRow);

        this._findField.on("action", this.handleFindFieldChange);
        this._findField.on("keydown", this.handleFindFieldKeyDown);
        this._caseButton.on("action", this.handleCaseToggle);
        this._wordButton.on("action", this.handleWordToggle);
        this._regexpButton.on("action", this.handleRegexpToggle);
        this._previousButton.on("action", this.handlePreviousAction);
        this._nextButton.on("action", this.handleNextAction);
        this._selectAllButton.on("action", this.handleSelectAllAction);
        this._closeButton.on("action", this.handleCloseAction);
        this._replaceField.on("action", this.handleReplaceFieldChange);
        this._replaceField.on("keydown", this.handleReplaceFieldKeyDown);
        this._replaceButton.on("action", this.handleReplaceAction);
        this._replaceAllButton.on("action", this.handleReplaceAllAction);

        return this;
    }

    /**
     * `true` once {@link buildControls} has run.
     *
     * @returns Whether this panel's controls have been built.
     */
    isBuilt(): boolean {
        return this._built;
    }

    /**
     * Reads the five field/toggle values.
     *
     * @returns The current {@link CodeEditorSearchFields} snapshot.
     */
    getFields(): CodeEditorSearchFields {
        return {
            search:        this._findField.getValue(),
            replace:       this._replaceField.getValue(),
            caseSensitive: this._caseButton.isSelected(),
            wholeWord:     this._wordButton.isSelected(),
            regexp:        this._regexpButton.isSelected(),
        };
    }

    /**
     * Writes the controls without emitting `"querychange"`. No-op before
     * {@link buildControls}.
     *
     * @param fields - The values to write into the fields and toggles.
     * @returns This panel, for method chaining.
     */
    setFields(fields: CodeEditorSearchFields): this {
        if (!this._built) {
            return this;
        }

        this._findField.setValue(fields.search);
        this._replaceField.setValue(fields.replace);
        this._caseButton.setSelected(fields.caseSensitive);
        this._wordButton.setSelected(fields.wholeWord);
        this._regexpButton.setSelected(fields.regexp);

        return this;
    }

    /**
     * Moves focus to the find field and selects its text. No-op before
     * {@link buildControls}.
     *
     * @returns This panel, for method chaining.
     */
    focusFind(): this {
        if (!this._built) {
            return this;
        }

        this._findField.focus();
        this._findField.select();

        return this;
    }

    /**
     * Clamps this panel's committed width and x to `availableWidth`, so a
     * narrow host cannot be forced to overflow. Re-derives x itself, because
     * changing the width invalidates the right-anchored position `Anchor`
     * just committed. No-op when this panel has no parent, or is not
     * currently displayed.
     *
     * @param availableWidth - The host's current inner width.
     * @returns This panel, for method chaining.
     */
    fitWithin(availableWidth: number): this {
        const host = this.getParentComponent();

        if (!host || !this.isDisplayed()) {
            return this;
        }

        const margin = this.getMargin();
        const width  = Math.min(this.getWidth(), Math.max(0, availableWidth - margin * 2));

        this.setWidth(width);
        this.setX(host.getContentInsets().getLeft() + availableWidth - margin - width);

        return this;
    }

    /**
     * Emits `"querychange"` with the current field/toggle snapshot. Wired to
     * every value control's `"action"` event.
     *
     * Marks the two text fields clean first: `TextField` is an
     * `AbstractInput`, whose own uncommitted-edit tracking folds up through
     * every ancestor's `isDirty()` (`Component.wireChild`) — with no opt-out.
     * Left alone, typing a search query would flip `CodeEditor.isDirty()`
     * true, even though nothing in the document changed. The typed query is
     * ephemeral UI state, not a document edit, so it carries no dirty
     * semantics of its own.
     */
    private notifyQueryChange(): void {
        this._findField.markClean();
        this._replaceField.markClean();

        this.emit("querychange", this.getFields());
    }

    /**
     * Routes a keydown in the find field to the matching search command.
     *
     * @param e - The keydown event.
     * @returns A stop+prevent disposition when the key was handled, else `false`.
     */
    private onFindFieldKeyDown(e: KeyboardEvent): Event.ListenerResult {
        if (e.key === "Enter" && e.shiftKey) {
            this.emit("command", "findprevious");

            return { stop: true, prevent: true };
        }

        if (e.key === "Enter") {
            this.emit("command", "findnext");

            return { stop: true, prevent: true };
        }

        if (e.key === "Escape") {
            this.emit("command", "close");

            return { stop: true, prevent: true };
        }

        return false;
    }

    /**
     * Routes a keydown in the replace field to the matching search command.
     *
     * @param e - The keydown event.
     * @returns A stop+prevent disposition when the key was handled, else `false`.
     */
    private onReplaceFieldKeyDown(e: KeyboardEvent): Event.ListenerResult {
        if (e.key === "Enter") {
            this.emit("command", "replacenext");

            return { stop: true, prevent: true };
        }

        if (e.key === "Escape") {
            this.emit("command", "close");

            return { stop: true, prevent: true };
        }

        return false;
    }

    on(event: "querychange", listener: (fields: CodeEditorSearchFields) => void): this;
    on(event: "command",     listener: (command: CodeEditorSearchCommand) => void): this;
    on(event: "querychange" | "command", listener: Function): this {
        this._listeners.add(event, listener as (payload: unknown) => void);

        return this;
    }

    off(event: "querychange", listener: (fields: CodeEditorSearchFields) => void): this;
    off(event: "command",     listener: (command: CodeEditorSearchCommand) => void): this;
    off(event: "querychange" | "command", listener: Function): this {
        this._listeners.remove(event, listener as (payload: unknown) => void);

        return this;
    }

    protected emit(event: "querychange", fields: CodeEditorSearchFields): void;
    protected emit(event: "command",     command: CodeEditorSearchCommand): void;
    protected emit(event: "querychange" | "command", payload: CodeEditorSearchFields | CodeEditorSearchCommand): void {
        this._listeners.fire(event, payload);
    }
}

const CodeEditorSearchPanelCallable = callable(CodeEditorSearchPanel);
type CodeEditorSearchPanelCallable = CodeEditorSearchPanel;
export {
    CodeEditorSearchPanel         as _CodeEditorSearchPanel,
    CodeEditorSearchPanelCallable as CodeEditorSearchPanel,
};
