// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";
import { createEditor, FORMAT_TEXT_COMMAND, $getSelection, $isRangeSelection, $createParagraphNode } from "lexical";
import type { LexicalEditor, ElementNode } from "lexical";
import { $convertFromMarkdownString, $convertToMarkdownString, registerMarkdownShortcuts } from "@lexical/markdown";
import { registerRichText, $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import type { HeadingTagType } from "@lexical/rich-text";
import { registerList, INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND } from "@lexical/list";
import { $toggleLink } from "@lexical/link";
import { $createCodeNode } from "@lexical/code";
import { registerHistory, createEmptyHistoryState } from "@lexical/history";
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
 * A WYSIWYG rich-text editor whose public value is a Markdown string.
 *
 * @remarks
 * `MarkdownEditor` edits a document as rendered rich text — no visible markup —
 * and reads/writes Markdown through Lexical's bidirectional converters, so it is
 * the editing counterpart to the read-only
 * [`Markdown`](/api/component/display/classes/Markdown) viewer. Its dialect is
 * deliberately the **exact subset** the viewer renders (headings, paragraphs,
 * bold, italic, inline code, ordered/unordered lists, blockquotes, fenced code,
 * links); a curated transformer list — not Lexical's full preset — guarantees
 * the editor can never emit Markdown the viewer would drop to plain text, so an
 * edited document renders identically in the viewer.
 *
 * Formatting is driven three ways, all without a built-in toolbar: Markdown
 * shortcut typing (`# ` → heading, `**b**` → bold, `- ` → list, `> ` → quote,
 * ` ``` ` → code), the default keyboard shortcuts (Ctrl/Cmd+B / +I, undo/redo),
 * and a thin imperative command API (`toggleBold`, `setBlockType`,
 * `toggleUnorderedList`, `toggleLink`, …) a consumer can wire to their own
 * `Button`s.
 *
 * Lexical's editing view is a `contenteditable` element it owns and mutates
 * directly — a *foreign live widget*, like the `EditorView` behind
 * [`CodeEditor`](/api/component/editor/classes/CodeEditor) — so the view mounts
 * through the DOM seam's `mountView` escape in the first connected layout. Unlike
 * a code editor, Lexical separates its editor **state** (a pure, DOM-free
 * immutable tree) from that view, so the Markdown value get/set/round-trip runs
 * headless: offline the view never attaches, yet `getValue` / `setValue` and the
 * command API still operate on the state. The editor fills its host box and
 * scrolls internally; give it a sized host (a `Fit` panel or an explicit
 * `preferredSize`), the same as `CodeEditor`.
 *
 * @example
 * ```typescript
 * import { MarkdownEditor } from '@jimka/typescript-ui/component/editor';
 *
 * const editor = new MarkdownEditor('# Title\n\nSome **bold** text.');
 * panel.addComponent(editor);
 * editor.on('change', ({ value }) => console.log(value));
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

    /** Whether this component's element hosts an editable region (`contenteditable`). */
    private _contentEditable: boolean = false;

    /** Custom-event fan-out for `"change"`. */
    private readonly _listeners: ListenerBag<MarkdownEditorEvent> = new ListenerBag<MarkdownEditorEvent>();

    /**
     * Constructs a Markdown editor.
     *
     * @param value - Initial Markdown source (optional; defaults to `""`).
     * @param options - Optional construction options.
     */
    constructor(value?: string, options?: MarkdownEditorOptions) {
        super(options);

        // Positional argument: cache it only when the caller didn't also pass
        // `options.value` (which the super-time cascade already stored).
        if (value !== undefined && this._options.value === undefined) {
            this._options.value = value;
        }

        this.setContentEditable(true);
        // Fills its host box and scrolls internally when the document overflows.
        this.setOverflow("auto");

        this.applyListeners(options?.listeners);

        this.onFirstLayout(() => this.ensureEditor());
    }

    /**
     * Caches the `value` / `readOnly` fields onto `_options` after inherited
     * Component fields cascade through `super.applyOptions`. The editor is built
     * later (lazily), so these are pure caches applied to the freshly-created
     * editor state in `ensureEditor`.
     *
     * @param options - The options bag carrying the values to apply.
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: MarkdownEditorOptions): this {
        super.applyOptions(options);

        if (options.value    !== undefined) this._options.value    = options.value;
        if (options.readOnly !== undefined) this._options.readOnly = options.readOnly;

        return this;
    }

    /**
     * Returns the current document as a Markdown string: converted live from the
     * editor state when the editor exists, else the cached pre-mount / offline
     * value.
     *
     * @returns The Markdown source, or `""` when unset.
     */
    getValue(): string {
        const editor = this._editor;

        if (editor) {
            return editor.read(() => $convertToMarkdownString(TRANSFORMERS));
        }

        return this._options.value ?? "";
    }

    /**
     * Replaces the whole document from a Markdown string. Builds the editor if
     * needed, then converts the Markdown into editor state; a resulting content
     * change fires `"change"`.
     *
     * @param value - The new Markdown source.
     * @returns This component, for method chaining.
     */
    setValue(value: string): this {
        const editor = this.ensureEditor();

        // Discrete forces a synchronous commit, so the resulting `"change"`
        // fires before this returns rather than on a later flush.
        editor.update(() => $convertFromMarkdownString(value, TRANSFORMERS), { discrete: true });

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
     * Sets whether the editor rejects edits. Caches the state; when the editor
     * exists, toggles its editable flag (which also drops the caret / editing
     * affordances on the mounted view).
     *
     * @param readOnly - Whether the editor should reject edits.
     * @returns This component, for method chaining.
     */
    setReadOnly(readOnly: boolean): this {
        this._options.readOnly = readOnly;
        this._editor?.setEditable(!readOnly);

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
     * Registers a listener for the `"change"` event, fired whenever the document
     * content changes (typing, a command, or {@link MarkdownEditor.setValue}).
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
     * Sets whether this component's element hosts an editable region. Routes
     * through the buffered attribute seam so the `contenteditable` attribute is
     * queued before the element exists and flushed at render.
     *
     * @param contentEditable - Whether the element is contenteditable.
     * @returns This component, for method chaining.
     */
    setContentEditable(contentEditable: boolean): this {
        this._contentEditable = contentEditable;
        this.setElementAttribute("contenteditable", contentEditable ? "true" : "false");

        return this;
    }

    /**
     * Returns whether this component's element hosts an editable region.
     *
     * @returns The contenteditable state.
     */
    getContentEditable(): boolean {
        return this._contentEditable;
    }

    /**
     * Detaches the Lexical registrations and the editor's root element. Call
     * before discarding a dynamically-built `MarkdownEditor`, mirroring
     * `CodeEditor.dispose`.
     */
    dispose(): void {
        this._unregister?.();
        this._editor?.setRootElement(null);
    }

    /**
     * Builds the headless Lexical editor on first use and, when a connected
     * element exists, mounts its editable view. Idempotent: the editor is built
     * once, and mounting is guarded on there being no root element yet. Offline
     * the seam's `mountView` returns `null`, so the view never attaches and the
     * editor stays headless — the state, and every value / command operation,
     * still work.
     *
     * @returns The live (headless-capable) Lexical editor.
     */
    private ensureEditor(): LexicalEditor {
        if (!this._editor) {
            const editor = createEditor({ nodes: EDITOR_NODES, theme: EDITOR_THEME, onError: reportEditorError });

            // Populate the initial state before registering the update listener,
            // so loading the cached value does not fire a spurious `"change"`.
            editor.update(() => $convertFromMarkdownString(this._options.value ?? "", TRANSFORMERS), { discrete: true });
            editor.setEditable(!(this._options.readOnly ?? false));

            this._unregister = mergeRegister(
                registerRichText(editor),
                registerList(editor),
                registerHistory(editor, createEmptyHistoryState(), HISTORY_DELAY_MS),
                registerMarkdownShortcuts(editor, TRANSFORMERS),
                editor.registerUpdateListener(() => this.handleChange()),
            );

            this._editor = editor;
        }

        this.mountRoot();

        return this._editor;
    }

    /**
     * Mounts the editor's editable view into this component's element through
     * the DOM seam's `mountView` escape. No-ops when the element is not yet
     * available, the view is already mounted, or offline (the seam returns
     * `null`, leaving the editor headless).
     */
    private mountRoot(): void {
        const editor = this._editor;

        if (!editor || editor.getRootElement()) {
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

    /**
     * Recomputes the Markdown value from the committed editor state after an
     * update and, when it differs from the cached value (i.e. the content — not
     * merely the selection — changed), caches it and emits `"change"`.
     */
    private handleChange(): void {
        const editor = this._editor;

        if (!editor) {
            return;
        }

        const value = editor.read(() => $convertToMarkdownString(TRANSFORMERS));

        if (value === this._options.value) {
            return;
        }

        this._options.value = value;
        this.emit("change", { value });
    }
}

const MarkdownEditorCallable = callable(MarkdownEditor);
type MarkdownEditorCallable = MarkdownEditor;
export {
    MarkdownEditor         as _MarkdownEditor,
    MarkdownEditorCallable as MarkdownEditor,
};
