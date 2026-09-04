// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import { Insets } from "~/primitive/Insets.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";
import { Card } from "~/layout/Card.js";
import { CodeEditor } from "~/component/editor/CodeEditor.js";
import type { CodeEditorChange } from "~/component/editor/CodeEditor.js";
import { createEditor, FORMAT_TEXT_COMMAND, $getSelection, $isRangeSelection, $getRoot, $createParagraphNode } from "lexical";
import type { LexicalEditor, ElementNode } from "lexical";
import { $convertFromMarkdownString, $convertToMarkdownString, registerMarkdownShortcuts } from "@lexical/markdown";
import { registerRichText, $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import type { HeadingTagType } from "@lexical/rich-text";
import { registerList, INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND } from "@lexical/list";
import { $toggleLink } from "@lexical/link";
import { $createCodeNode, $isCodeNode } from "@lexical/code";
import { registerHistory, createEmptyHistoryState } from "@lexical/history";
import {
    registerTablePlugin, registerTableCellUnmergeTransform, registerTableSelectionObserver,
    $getTableCellNodeFromLexicalNode, $isTableNode,
    $insertTableRowAtSelection, $deleteTableRowAtSelection,
    $insertTableColumnAtSelection, $deleteTableColumnAtSelection,
    INSERT_TABLE_COMMAND,
} from "@lexical/table";
import { mergeRegister } from "@lexical/utils";
import { $setBlocksType } from "@lexical/selection";
import { TRANSFORMERS } from "~/component/editor/markdownTransformers.js";
import { EDITOR_NODES } from "~/component/editor/editorNodes.js";
import { EDITOR_THEME, ensureMarkdownEditorClassRules } from "~/component/editor/editorTheme.js";

/**
 * The coalescing window (ms) for the undo/redo history: edits within this gap
 * merge into a single undo step, matching Lexical's own recommended default.
 */
const HISTORY_DELAY_MS = 300;

/**
 * Payload of {@link MarkdownEditor}'s `"change"` event: the Markdown string
 * after the edit that triggered it.
 *
 * @category Components
 */
export interface MarkdownEditorChange {
    value: string;
}

/** The event {@link MarkdownEditor} exposes through its custom `on` / `off` surface. */
type MarkdownEditorEvent = "change";

/**
 * The editing surface a {@link MarkdownEditor} currently shows: the WYSIWYG
 * rich-text surface, or the raw-Markdown source [`CodeEditor`](/api/component/editor/classes/CodeEditor).
 *
 * @category Components
 */
export type MarkdownEditorMode = "wysiwyg" | "source";

/**
 * A block type accepted by {@link MarkdownEditor.setBlockType}: a paragraph, one
 * of the six heading levels, a blockquote, or a fenced code block.
 *
 * @category Components
 */
export type MarkdownBlockType = "paragraph" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "quote" | "code";

/**
 * Construction-time options for {@link MarkdownEditor}.
 *
 * @category Components
 */
export interface MarkdownEditorOptions extends ComponentOptions {
    /** Initial Markdown source (also accepted as the positional first argument). */
    value?: string;
    /** Whether the editor is read-only. Default `false`. */
    readOnly?: boolean;
    /** Which surface is shown. Default `"wysiwyg"`. */
    mode?: MarkdownEditorMode;
    /** Construction-time listener bag; the only event is `"change"`. */
    listeners?: { change?: (payload: MarkdownEditorChange) => void };
}

/**
 * The `onError` handler for the Lexical editor: rethrows so a node/transform
 * fault surfaces loudly rather than being swallowed.
 *
 * @param error - The error Lexical reports.
 */
function reportEditorError(error: Error): void {
    throw error;
}

/**
 * Builds the Lexical block node a {@link MarkdownEditor.setBlockType} call
 * converts the selected blocks into.
 *
 * @param type - The requested block type.
 * @returns A freshly-created element node of that type.
 */
function createBlockNode(type: MarkdownBlockType): ElementNode {
    switch (type) {
        case "quote": return $createQuoteNode();
        case "code":  return $createCodeNode();
        case "paragraph": return $createParagraphNode();
        default:      return $createHeadingNode(type satisfies HeadingTagType);
    }
}

/**
 * Whether the caret currently sits inside a table cell — the precondition for
 * the row/column helpers, which throw rather than no-op when it does not.
 *
 * @returns Whether the current selection is a range selection anchored inside
 *   a table cell.
 */
function $selectionIsInTableCell(): boolean {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return false;
    }

    return $getTableCellNodeFromLexicalNode(selection.anchor.getNode()) !== null;
}

// A text caret over the whole surface signals editability. The surface is also
// a contenteditable editing host, which the browser exempts from the framework's
// `user-select: none` on its own, and Lexical additionally stamps
// `user-select: text` inline on the root when it mounts — stating the same
// intent here in the framework's own rule means select-and-copy does not depend
// on that inline write surviving a later re-render. As class defaults both land
// on the shared `.WysiwygSurface` rule rather than each instance's `#id` rule.
const _defaultWysiwygSurfaceOptions: Partial<ComponentOptions> = { userSelect: "text", cursor: "text" };

/**
 * The private WYSIWYG editing surface: the element Lexical's `contenteditable`
 * view mounts into.
 *
 * @remarks
 * Split out from {@link MarkdownEditor} so the coordinator's own element can host
 * *both* this surface and the source {@link CodeEditor} as two [`Card`](/api/layout/classes/Card)
 * children — one DOM element per class, since Lexical's `contenteditable` and
 * CodeMirror's view are two foreign live widgets that each need their own host
 * element. `MarkdownEditor` keeps ownership of the Lexical editor object; only
 * the mount element (and its `contenteditable` / caret plumbing) lives here.
 */
class WysiwygSurface extends Component {

    /** Whether this surface's element hosts an editable region (`contenteditable`). */
    private _contentEditable: boolean = false;

    /** Invoked on the surface's first connected + sized layout — the moment to mount the live view. */
    private readonly _onReady: () => void;

    /**
     * Constructs the WYSIWYG surface.
     *
     * @param onReady - Called on the surface's first connected + sized layout.
     * @param subclassDefaults - Optional subclass defaults bag.
     */
    constructor(onReady: () => void, subclassDefaults?: Partial<ComponentOptions>) {
        super(undefined, { ..._defaultWysiwygSurfaceOptions, ...(subclassDefaults ?? {}) });

        this._onReady = onReady;

        this.setContentEditable(true);
        // Fills its host box and scrolls internally when the document overflows.
        this.setOverflow("auto");
        // A few pixels of inset off the padding box: without it the caret sits
        // flush against the surface's left edge (at column 0 of any line) and
        // gets clipped to invisibility. The padding is on the scroll container,
        // so it clears the caret at every edge while overflow scrolling still
        // reveals the full document. The values match source mode's CodeMirror
        // text inset so toggling modes doesn't shift the prose: 4px vertical
        // (CodeMirror's `.cm-content` padding is `4px 0`) and 6px horizontal
        // (its `.cm-line` padding-left is 6px).
        this.setPadding(new Insets(4, 6, 4, 6));
        // Matches the read-only Markdown viewer's own root-level override
        // (Markdown.ts) so the edited prose reads at the same leading as the
        // preview instead of falling back to the tighter UI-control line-height
        // the theme applies to <html>.
        this.setElementCSSRule("lineHeight", "var(--ts-ui-md-line-height, 1.8)");

        this.onFirstLayout(() => this._onReady());
    }

    /**
     * Sets whether this surface's element hosts an editable region. Caches the
     * state in `_contentEditable` and writes the `contenteditable` attribute
     * through `setElementAttribute`, whose buffer replays the value onto the
     * element once one is created — so a call made during detached
     * construction still lands.
     *
     * @param contentEditable - Whether the element is contenteditable.
     * @returns This surface, for method chaining.
     */
    setContentEditable(contentEditable: boolean): this {
        this._contentEditable = contentEditable;
        this.setElementAttribute("contenteditable", contentEditable ? "true" : "false");

        return this;
    }

    /**
     * Returns whether this surface's element hosts an editable region.
     *
     * @returns The contenteditable state.
     */
    getContentEditable(): boolean {
        return this._contentEditable;
    }

    /**
     * Mounts the given Lexical editor's editable view into this surface's element
     * through the DOM seam's `mountView` escape. No-ops when the view is already
     * mounted, the element is not yet available, or offline (the seam returns
     * `null`, leaving the editor headless).
     *
     * @param editor - The Lexical editor whose view to mount here.
     */
    mount(editor: LexicalEditor): void {
        if (editor.getRootElement()) {
            return;
        }

        const element = this.getElement();

        if (!element) {
            return;
        }

        ensureMarkdownEditorClassRules();

        // The factory parameter is left unannotated: its `HTMLElement` type is
        // inferred from the seam signature, so no DOM type is named here and the
        // `no-raw-dom` *hold* clause stays green. `setRootElement` accepts the
        // element structurally.
        DOM.sink.mountView(element, (root) => { editor.setRootElement(root); return root; });
    }
}

/**
 * A WYSIWYG rich-text editor whose public value is a Markdown string, with an
 * optional raw-Markdown source mode.
 *
 * @remarks
 * `MarkdownEditor` edits a document as rendered rich text — no visible markup —
 * and reads/writes Markdown through Lexical's bidirectional converters, so it is
 * the editing counterpart to the read-only
 * [`Markdown`](/api/component/display/classes/Markdown) viewer. Its dialect is
 * deliberately the **exact subset** the viewer renders (headings, paragraphs,
 * bold, italic, inline code, ordered/unordered lists, blockquotes, fenced code,
 * links, and GFM pipe tables with per-column alignment); a curated transformer
 * list — not Lexical's full preset — guarantees the editor can never emit
 * Markdown the viewer would drop to plain text, so an edited document renders
 * identically in the viewer.
 *
 * Formatting is driven three ways, all without a built-in toolbar: Markdown
 * shortcut typing (`# ` → heading, `**b**` → bold, `- ` → list, `> ` → quote,
 * ` ``` ` → code), the default keyboard shortcuts (Ctrl/Cmd+B / +I, undo/redo),
 * and a thin imperative command API (`toggleBold`, `setBlockType`,
 * `toggleUnorderedList`, `toggleLink`, `insertTable`,
 * `insertTableRow`/`deleteTableRow`, `insertTableColumn`/`deleteTableColumn`,
 * …) a consumer can wire to their own `Button`s.
 *
 * A {@link MarkdownEditor.setMode | mode} (`"wysiwyg"` | `"source"`) swaps the
 * editing surface between that rich-text view and a raw-Markdown
 * [`CodeEditor`](/api/component/editor/classes/CodeEditor); both are bound to the
 * same Markdown value, so `getValue`/`setValue` and the `"change"` event behave
 * identically in either mode and switching modes preserves the document. Like the
 * command API, the mode toggle is **consumer-wired** — there is no built-in
 * chrome — so a consumer drives `setMode` from their own control.
 *
 * Internally the component's own element hosts two swappable child surfaces
 * through a [`Card`](/api/layout/classes/Card) layout: a private WYSIWYG surface owning Lexical's
 * `contenteditable` element (a *foreign live widget*, like the `EditorView`
 * behind `CodeEditor`) and the source `CodeEditor`. Lexical separates its editor
 * **state** (a pure, DOM-free immutable tree) from that view, so the Markdown
 * value get/set/round-trip runs headless: offline neither view attaches, yet
 * `getValue` / `setValue`, the command API, and mode switching still operate on
 * the state. The editor fills its host box and scrolls internally; give it a
 * sized host (a `Fit` panel or an explicit `preferredSize`), the same as
 * `CodeEditor`.
 *
 * @example
 * ```typescript
 * import { MarkdownEditor } from '@jimka/typescript-ui/component/editor';
 *
 * const editor = new MarkdownEditor('# Title\n\nSome **bold** text.');
 * panel.addComponent(editor);
 * editor.on('change', ({ value }) => console.log(value));
 * editor.setMode('source'); // switch to raw-Markdown editing
 * ```
 *
 * @category Components
 */
class MarkdownEditor extends Component<MarkdownEditorOptions> {

    /**
     * The Lexical editor, built lazily (headless) on first use or first layout;
     * `null` until then. The editor is DOM-free until its root element mounts,
     * so this is non-null and fully usable offline once built.
     */
    private _editor: LexicalEditor | null = null;

    /** The `mergeRegister` teardown for the rich-text / list / history / shortcut / update registrations. */
    private _unregister: (() => void) | null = null;

    /**
     * The teardown for {@link registerTableSelectionObserver}, registered only
     * once the WYSIWYG view actually mounts (its mutation listener needs a real
     * table element in the document) and cleared on {@link dispose}.
     */
    private _unregisterTableView: (() => void) | null = null;

    /** Custom-event fan-out for `"change"`. */
    private readonly _listeners: ListenerBag<MarkdownEditorEvent> = this.registerListenerBag(new ListenerBag<MarkdownEditorEvent>());

    /** The Card layout swapping the visible editing surface between WYSIWYG and source. */
    private readonly _card: Card;

    /** The WYSIWYG surface hosting Lexical's `contenteditable` view. */
    private readonly _wysiwyg: WysiwygSurface;

    /** The raw-Markdown source surface, shown in `"source"` mode. */
    private readonly _codeEditor: CodeEditor;

    /**
     * The Markdown as of the last clean point — the value this editor was
     * constructed with, the converted form re-taken when the Lexical editor
     * is first built, or the value `markClean()` last accepted. `onDocChange`
     * compares against it to decide the dirty flag.
     */
    private _cleanValue: string;

    /**
     * Constructs a Markdown editor.
     *
     * @param value - Initial Markdown source (optional; defaults to `""`).
     * @param options - Optional construction options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(value?: string, options?: MarkdownEditorOptions, subclassDefaults?: Partial<MarkdownEditorOptions>) {
        super(options, subclassDefaults);

        // Positional argument: cache it only when the caller didn't also pass
        // `options.value` (which the super-time cascade already stored).
        if (value !== undefined && this._options.value === undefined) {
            this._options.value = value;
        }

        // The component's own element hosts two swappable surfaces via a Card
        // (one DOM element per class): the WYSIWYG contenteditable and the source
        // CodeEditor. The Card shows exactly one at a time.
        this._card = new Card();
        this.setLayoutManager(this._card);

        this._wysiwyg = new WysiwygSurface(() => this.mountWysiwyg());
        this._codeEditor = new CodeEditor(this._options.value ?? "", {
            language:  "markdown",
            readOnly:  this._options.readOnly ?? false,
            listeners: { change: (payload) => this.handleCodeChange(payload) },
        });

        this.addComponent(this._wysiwyg);
        this.addComponent(this._codeEditor);

        // Pick the initial visible child from the mode.
        this._card.setVisibleComponentId(
            this.getMode() === "source" ? this._codeEditor.getId() : this._wysiwyg.getId());

        this._cleanValue = this.getValue();

        this.applyListeners(options?.listeners);
    }

    /**
     * Caches the `value` / `readOnly` / `mode` fields onto `_options` after
     * inherited Component fields cascade through `super.applyOptions`. The editor
     * is built later (lazily), so these are pure caches applied to the freshly-
     * created editor state / surfaces in the constructor and `ensureEditor`.
     *
     * @param options - The options bag carrying the values to apply.
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: MarkdownEditorOptions): this {
        super.applyOptions(options);

        if (options.value    !== undefined) this._options.value    = options.value;
        if (options.readOnly !== undefined) this._options.readOnly = options.readOnly;
        if (options.mode     !== undefined) this._options.mode     = options.mode;

        return this;
    }

    /**
     * Returns the active editing surface mode.
     *
     * @returns `"source"` when the raw-Markdown surface is shown, else `"wysiwyg"`.
     */
    getMode(): MarkdownEditorMode {
        return this._options.mode ?? "wysiwyg";
    }

    /**
     * Switches the active editing surface. Converts the current document across
     * the surfaces so no edits are lost — the outgoing surface's Markdown is read
     * (via {@link MarkdownEditor.getValue}) before the mode flips, then loaded
     * into the incoming surface — and swaps the visible [`Card`](/api/layout/classes/Card) child.
     * No-op (no conversion, no `"change"`) when already in `mode`.
     *
     * @param mode - The surface to show.
     * @returns This component, for method chaining.
     */
    setMode(mode: MarkdownEditorMode): this {
        if (this.getMode() === mode) {
            return this;
        }

        // Read the canonical Markdown from the OUTGOING surface before the flip.
        const markdown = this.getValue();
        this._options.mode = mode;

        if (mode === "source") {
            this._codeEditor.setValue(markdown);
            this._card.setVisibleComponentId(this._codeEditor.getId());
        } else {
            this.ensureEditor().update(() => {
                $convertFromMarkdownString(markdown, TRANSFORMERS);
                this.ensureTrailingParagraph();
            }, { discrete: true });
            this._card.setVisibleComponentId(this._wysiwyg.getId());
        }

        return this;
    }

    /**
     * Returns the current document as a Markdown string, from whichever surface
     * is active: the raw source text in `"source"` mode, else converted live from
     * the Lexical editor state (or the cached pre-mount / offline value).
     *
     * @returns The Markdown source, or `""` when unset.
     */
    getValue(): string {
        if (this.getMode() === "source") {
            return this._codeEditor.getValue();
        }

        const editor = this._editor;

        if (editor) {
            return editor.read(() => $convertToMarkdownString(TRANSFORMERS));
        }

        return this._options.value ?? "";
    }

    /**
     * Replaces the whole document from a Markdown string, targeting the active
     * surface: the source `CodeEditor` in `"source"` mode, else the Lexical
     * editor (building it if needed). A resulting content change fires `"change"`.
     *
     * @param value - The new Markdown source.
     * @returns This component, for method chaining.
     */
    setValue(value: string): this {
        if (this.getMode() === "source") {
            this._codeEditor.setValue(value);

            return this;
        }

        // Discrete forces a synchronous commit, so the resulting `"change"`
        // fires before this returns rather than on a later flush.
        this.ensureEditor().update(() => {
            $convertFromMarkdownString(value, TRANSFORMERS);
            this.ensureTrailingParagraph();
        }, { discrete: true });

        return this;
    }

    /**
     * Accepts the current document as the clean Markdown, clearing this editor's
     * dirty flag (and, through the framework's relay, every ancestor's, unless
     * another descendant is still dirty). Call it after the host has persisted
     * the document, or after loading one with `setValue`. Persisting is the
     * host's job — this method only reports state; it writes nothing and does
     * not change the document.
     *
     * The editor reports itself dirty whenever `getValue()` differs from the
     * clean Markdown, in either editing mode, so an edit undone back to that
     * text clears the flag on its own.
     *
     * @returns This component, for method chaining.
     */
    markClean(): this {
        this._cleanValue = this.getValue();
        this.setDirty(false);
        this._codeEditor.markClean();

        return this;
    }

    /**
     * Returns whether the editor currently rejects edits.
     *
     * @returns The read-only state.
     */
    getReadOnly(): boolean {
        return this._options.readOnly ?? false;
    }

    /**
     * Sets whether the editor rejects edits, on **both** surfaces. Caches the
     * state; when the Lexical editor exists, toggles its editable flag (which
     * also drops the caret / editing affordances on the mounted view); and
     * forwards to the source `CodeEditor`.
     *
     * @param readOnly - Whether the editor should reject edits.
     * @returns This component, for method chaining.
     */
    setReadOnly(readOnly: boolean): this {
        this._options.readOnly = readOnly;
        this._editor?.setEditable(!readOnly);
        this._codeEditor.setReadOnly(readOnly);

        return this;
    }

    /**
     * Moves keyboard focus into the active editing surface, placing a caret
     * ready for typing: the Lexical contenteditable in WYSIWYG mode (building
     * and mounting the editor if needed), or the source `CodeEditor` in
     * `"source"` mode.
     *
     * Overrides {@link core!Component.focus}, whose default focuses this component's
     * own host element — the `Card` wrapper — which would leave the caret out of
     * the nested contenteditable the typing must land in. In WYSIWYG mode it
     * defers to Lexical's own `focus`, which both focuses the root element and
     * sets a selection so a caret appears without a click.
     *
     * @param preventScroll - Forwarded to the source `CodeEditor` in `"source"`
     *   mode; ignored in WYSIWYG mode, where Lexical manages its own focus scroll.
     * @returns This component, for method chaining.
     */
    focus(preventScroll: boolean = false): this {
        if (this.getMode() === "source") {
            this._codeEditor.focus(preventScroll);
        } else {
            this.ensureEditor().focus();
        }

        return this;
    }

    /**
     * Toggles bold on the current selection. No-op (without throwing) when there
     * is no range selection.
     *
     * @returns This component, for method chaining.
     */
    toggleBold(): this {
        this.ensureEditor().dispatchCommand(FORMAT_TEXT_COMMAND, "bold");

        return this;
    }

    /**
     * Toggles italic on the current selection. No-op without a range selection.
     *
     * @returns This component, for method chaining.
     */
    toggleItalic(): this {
        this.ensureEditor().dispatchCommand(FORMAT_TEXT_COMMAND, "italic");

        return this;
    }

    /**
     * Toggles inline code on the current selection. No-op without a range selection.
     *
     * @returns This component, for method chaining.
     */
    toggleInlineCode(): this {
        this.ensureEditor().dispatchCommand(FORMAT_TEXT_COMMAND, "code");

        return this;
    }

    /**
     * Converts the selected blocks into an unordered (bulleted) list, or out of
     * one when already a list. No-op without a range selection.
     *
     * @returns This component, for method chaining.
     */
    toggleUnorderedList(): this {
        this.ensureEditor().dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);

        return this;
    }

    /**
     * Converts the selected blocks into an ordered (numbered) list, or out of
     * one when already a list. No-op without a range selection.
     *
     * @returns This component, for method chaining.
     */
    toggleOrderedList(): this {
        this.ensureEditor().dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);

        return this;
    }

    /**
     * Wraps the current selection in a link to `url`, or unwraps it when `url`
     * is `null`. No-op without a range selection.
     *
     * @param url - The link target, or `null` to remove the link.
     * @returns This component, for method chaining.
     */
    toggleLink(url: string | null): this {
        const editor = this.ensureEditor();

        editor.update(() => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                $toggleLink(url);
            }
        }, { discrete: true });

        return this;
    }

    /**
     * Converts the selected blocks to `type` (paragraph, `h1`–`h6`, blockquote,
     * or fenced code). No-op without a range selection.
     *
     * @param type - The target block type.
     * @returns This component, for method chaining.
     */
    setBlockType(type: MarkdownBlockType): this {
        const editor = this.ensureEditor();

        editor.update(() => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                $setBlocksType(selection, () => createBlockNode(type));
            }
        }, { discrete: true });

        return this;
    }

    /**
     * Inserts a table of `rows` rows by `columns` columns at the caret. The
     * first row is the header row, so `insertTable(2, 3)` gives a header row
     * plus one body row. The caret lands in the first header cell.
     *
     * @param rows - The number of rows, including the header row.
     * @param columns - The number of columns.
     * @returns This component, for method chaining.
     */
    insertTable(rows: number, columns: number): this {
        const editor = this.ensureEditor();

        // INSERT_TABLE_COMMAND inserts at the selection; a freshly built editor
        // may have none, so seed one first.
        editor.update(() => {
            if (!$isRangeSelection($getSelection())) {
                $getRoot().selectEnd();
            }
        }, { discrete: true });

        editor.dispatchCommand(INSERT_TABLE_COMMAND, {
            columns:        String(columns),
            rows:           String(rows),
            includeHeaders: { rows: true, columns: false },
        });

        // A table landing at the very end of the document leaves nothing
        // past it to click into and keep typing — a table has no trailing
        // line of its own the way a paragraph does.
        editor.update(() => this.ensureTrailingParagraph(), { discrete: true });

        return this;
    }

    /**
     * Inserts a row after (default) or before the row holding the caret.
     * No-op without throwing when the caret is not inside a table cell.
     *
     * @param after - Whether to insert after (`true`, default) or before
     *   (`false`) the current row.
     * @returns This component, for method chaining.
     */
    insertTableRow(after: boolean = true): this {
        const editor = this.ensureEditor();

        editor.update(() => {
            if ($selectionIsInTableCell()) {
                $insertTableRowAtSelection(after);
            }
        }, { discrete: true });

        return this;
    }

    /**
     * Deletes the row holding the caret. No-op without throwing when the
     * caret is not inside a table cell.
     *
     * @returns This component, for method chaining.
     */
    deleteTableRow(): this {
        const editor = this.ensureEditor();

        editor.update(() => {
            if ($selectionIsInTableCell()) {
                $deleteTableRowAtSelection();
            }
        }, { discrete: true });

        return this;
    }

    /**
     * Inserts a column after (default) or before the column holding the
     * caret. No-op without throwing when the caret is not inside a table cell.
     *
     * @param after - Whether to insert after (`true`, default) or before
     *   (`false`) the current column.
     * @returns This component, for method chaining.
     */
    insertTableColumn(after: boolean = true): this {
        const editor = this.ensureEditor();

        editor.update(() => {
            if ($selectionIsInTableCell()) {
                $insertTableColumnAtSelection(after);
            }
        }, { discrete: true });

        return this;
    }

    /**
     * Deletes the column holding the caret. No-op without throwing when the
     * caret is not inside a table cell.
     *
     * @returns This component, for method chaining.
     */
    deleteTableColumn(): this {
        const editor = this.ensureEditor();

        editor.update(() => {
            if ($selectionIsInTableCell()) {
                $deleteTableColumnAtSelection();
            }
        }, { discrete: true });

        return this;
    }

    /**
     * Registers a listener for the `"change"` event, fired whenever the document
     * content changes (typing, a command, or {@link MarkdownEditor.setValue}) in
     * whichever surface is active.
     *
     * @param event - Must be `"change"`.
     * @param listener - Invoked with the new Markdown value.
     * @returns This component, for method chaining.
     */
    on(event: MarkdownEditorEvent, listener: (payload: MarkdownEditorChange) => void): this {
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
    off(event: MarkdownEditorEvent, listener: (payload: MarkdownEditorChange) => void): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fans the `"change"` event out to its registered listeners.
     *
     * @param event - Must be `"change"`.
     * @param payload - The event payload.
     */
    protected emit(event: MarkdownEditorEvent, payload: MarkdownEditorChange): void {
        this._listeners.fire(event, payload);
    }

    /**
     * Sets whether the WYSIWYG surface's element hosts an editable region.
     * Forwards to the private surface, preserving the public setter.
     *
     * @param contentEditable - Whether the element is contenteditable.
     * @returns This component, for method chaining.
     */
    setContentEditable(contentEditable: boolean): this {
        this._wysiwyg.setContentEditable(contentEditable);

        return this;
    }

    /**
     * Returns whether the WYSIWYG surface's element hosts an editable region.
     *
     * @returns The contenteditable state.
     */
    getContentEditable(): boolean {
        return this._wysiwyg.getContentEditable();
    }

    /**
     * Detaches the Lexical registrations and the WYSIWYG surface's live view,
     * then defers to the base class for the rest of teardown — including
     * disposing the registered `_codeEditor` child, which mirrors
     * `CodeEditor.destructor`. Call before discarding a dynamically-built
     * `MarkdownEditor`.
     */
    protected destructor(): void {
        this._unregisterTableView?.();
        this._unregister?.();
        this._editor?.setRootElement(null);

        // `_codeEditor` is registered via `addComponent`, so
        // `super.destructor()`'s child recursion below already disposes it —
        // an explicit call here would run `CodeEditor.destructor()` a second
        // time.
        super.destructor();
    }

    /**
     * Appends an empty paragraph after the document's last child when that
     * child is a table or fenced code block. Must run inside an `editor.update()`.
     *
     * @remarks
     * Unlike a heading, list, or blockquote — ordinary flow text a click below
     * the last line already lands in, the same as a paragraph — a table's grid
     * layout and a code block's preformatted whitespace give a trailing click
     * nothing to resolve into, so one landing last leaves nothing past it to
     * click into and keep typing. Called after every operation that can leave
     * one of these two node types last: loading Markdown (initial build,
     * {@link MarkdownEditor.setValue}, a `"source"` → `"wysiwyg"`
     * {@link MarkdownEditor.setMode} switch) and {@link MarkdownEditor.insertTable}.
     */
    private ensureTrailingParagraph(): void {
        const lastChild = $getRoot().getLastChild();

        if (lastChild !== null && ($isTableNode(lastChild) || $isCodeNode(lastChild))) {
            $getRoot().append($createParagraphNode());
        }
    }

    /**
     * Builds the headless Lexical editor on first use. Idempotent: the editor is
     * built once. Offline the editor stays headless — the state, and every value
     * / command operation, still work.
     *
     * @returns The live (headless-capable) Lexical editor.
     */
    private ensureEditor(): LexicalEditor {
        if (!this._editor) {
            const editor = createEditor({ nodes: EDITOR_NODES, theme: EDITOR_THEME, onError: reportEditorError });

            // Populate the initial state before registering the update listener,
            // so loading the cached value does not fire a spurious `"change"`.
            editor.update(() => {
                $convertFromMarkdownString(this._options.value ?? "", TRANSFORMERS);
                this.ensureTrailingParagraph();
            }, { discrete: true });
            editor.setEditable(!(this._options.readOnly ?? false));

            // Lexical's converters normalize what they round-trip (a trailing newline is
            // dropped, a table's delimiter row is re-spaced), so from here on `getValue()`
            // reports the converted form rather than the string this editor was built
            // with. Re-take the clean Markdown from the converted form so both sides of
            // `onDocChange`'s comparison come from the same converter — but only while the
            // document is still clean, since a first build can also happen after a
            // source-mode edit, and re-taking then would clear a real dirty flag.
            if (!this.isDirty()) {
                this._cleanValue = editor.read(() => $convertToMarkdownString(TRANSFORMERS));
            }

            this._unregister = mergeRegister(
                registerRichText(editor),
                registerList(editor),
                registerTablePlugin(editor),
                registerTableCellUnmergeTransform(editor),
                registerHistory(editor, createEmptyHistoryState(), HISTORY_DELAY_MS),
                registerMarkdownShortcuts(editor, TRANSFORMERS),
                editor.registerUpdateListener(() => this.handleChange()),
            );

            this._editor = editor;
        }

        return this._editor;
    }

    /**
     * Builds the headless editor (if needed) and mounts its live view into the
     * WYSIWYG surface. Driven by the surface's first connected layout, i.e. the
     * first time it is the visible `Card` child and gets sized.
     */
    private mountWysiwyg(): void {
        const editor = this.ensureEditor();

        this._wysiwyg.mount(editor);

        // Offline the seam's mountView returns null and the root stays unset;
        // the observer's mutation listener needs a real table element in the
        // document and throws without one, so it is view-time only.
        if (editor.getRootElement() && !this._unregisterTableView) {
            this._unregisterTableView = registerTableSelectionObserver(editor, true);
        }
    }

    /**
     * The single document-change seam for both editing surfaces: caches the new
     * Markdown, sets the dirty flag from a comparison against the clean Markdown,
     * then emits `"change"`. No-op when the value is unchanged, which is what
     * keeps the programmatic `setValue` on a mode switch from double-emitting (it
     * loads the value already equal to `_options.value`).
     *
     * @param value - The new Markdown value.
     */
    private onDocChange(value: string): void {
        if (value === this._options.value) {
            return;
        }

        this._options.value = value;
        // Dirty before the emit, so a `"change"` listener that queries isDirty()
        // sees the settled value. `setDirty` is idempotent, so calling it on
        // every change costs nothing when nothing flipped.
        this.setDirty(value !== this._cleanValue);
        this.emit("change", { value });
    }

    /**
     * Recomputes the Markdown value from the committed editor state after a
     * Lexical update and hands it to the shared change seam.
     */
    private handleChange(): void {
        const editor = this._editor;

        if (!editor) {
            return;
        }

        this.onDocChange(editor.read(() => $convertToMarkdownString(TRANSFORMERS)));
    }

    /**
     * Routes a source-surface (`CodeEditor`) edit into the shared change seam,
     * then re-baselines the source editor. The source `CodeEditor` is a surface,
     * not a second owner of this document's dirty state: re-baselining it on
     * every change keeps its own flag clear, so `isDirty()` is decided by this
     * component's comparison alone. Outside `onDocChange` so it also runs on a
     * mode-switch load, which that method's unchanged-value guard returns early
     * from.
     *
     * @param payload - The `CodeEditor` change payload (the new source text).
     */
    private handleCodeChange(payload: CodeEditorChange): void {
        this.onDocChange(payload.value);
        this._codeEditor.markClean();
    }
}

const MarkdownEditorCallable = callable(MarkdownEditor);
type MarkdownEditorCallable = MarkdownEditor;
export {
    MarkdownEditor         as _MarkdownEditor,
    MarkdownEditorCallable as MarkdownEditor,
};
