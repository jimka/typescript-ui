// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { ThemeManager } from "~/core/Theme.js";
import { callable } from "~/core/Callable.js";
import { EditorView, keymap, drawSelection, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { indentOnInput, bracketMatching, indentRange } from "@codemirror/language";
import { getLanguage } from "~/component/editor/LanguageRegistry.js";
import { codeEditorTheme } from "~/component/editor/theme.js";

/**
 * Payload of {@link CodeEditor}'s `"change"` event: the document text after
 * the edit that triggered it.
 *
 * @category Components
 */
export interface CodeEditorChange {
    value: string;
}

/** The event {@link CodeEditor} exposes through its custom `on` / `off` surface. */
type CodeEditorEvent = "change";

/**
 * Construction-time options for {@link CodeEditor}.
 *
 * @category Components
 */
export interface CodeEditorOptions extends ComponentOptions {
    /** Initial document text (also accepted as the positional first argument). */
    value?: string;
    /** Registered language id (e.g. `"javascript"`, `"json"`, `"sql"`). Unset renders plain text. */
    language?: string;
    /** Whether the editor rejects edits. Default `false`. */
    readOnly?: boolean;
    /** Construction-time listener bag; the only event is `"change"`. */
    listeners?: { change?: (payload: CodeEditorChange) => void };
}

/**
 * Builds the readOnly-state extension pair: `EditorState.readOnly` blocks
 * every edit (including programmatic ones), and `EditorView.editable`
 * additionally drops the caret / editing affordances, so the two are always
 * toggled together.
 *
 * @param readOnly - Whether the editor should reject edits.
 * @returns The combined extension for the readOnly compartment.
 */
function buildReadOnlyExtension(readOnly: boolean): Extension {
    return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

/**
 * A syntax-highlighting, formatting code editor wrapping CodeMirror 6.
 *
 * @remarks
 * `CodeEditor` deliberately omits IntelliSense (no autocomplete, no lint, no
 * language service) — its scope is highlighting plus one-command formatting.
 * CodeMirror's `EditorView` is a *foreign live widget*: it takes a real parent
 * element and mutates a whole DOM region it owns directly, exactly like the
 * `CanvasRenderingContext2D` a [`Canvas`](/api/component/display/classes/Canvas)
 * obtains from the seam. So `CodeEditor` is **live-only** — under the modelled
 * test sink it mounts nothing, and every editor operation guards on a `null`
 * view, matching `Canvas` / `WebGLCanvas`.
 *
 * The editor mounts once, in the component's first connected + sized layout
 * (`onFirstLayout`) — CodeMirror needs a real, sized parent to measure its
 * internal scroller correctly. It fills the assigned box and scrolls
 * internally; give it a sized host (a `Fit` panel or an explicit
 * `preferredSize`), the same as `Canvas`.
 *
 * Highlighting grammars and formatters load lazily, per language, through the
 * registry in `LanguageRegistry.ts` (`registerLanguage` / `getLanguage` /
 * `listLanguages`) — see that module and `languages.ts` for the five built-in
 * languages (JavaScript/TypeScript, JSON, HTML, SQL, Markdown).
 *
 * @example
 * ```typescript
 * import { CodeEditor } from '@jimka/typescript-ui/component/editor';
 *
 * const editor = new CodeEditor('const x = 1;', { language: 'javascript' });
 * panel.addComponent(editor);
 * await editor.format();
 * ```
 *
 * @category Components
 */
class CodeEditor extends Component<CodeEditorOptions> {

    /** The live CodeMirror view; `null` until mounted (or forever, offline). */
    private _view: EditorView | null = null;

    /** Reconfigured by {@link CodeEditor.setLanguage} to swap the active grammar. */
    private readonly _langCompartment: Compartment = new Compartment();

    /** Reconfigured by {@link CodeEditor.setReadOnly}. */
    private readonly _readOnlyCompartment: Compartment = new Compartment();

    /** Reconfigured on a theme change to recolour the editor. */
    private readonly _themeCompartment: Compartment = new Compartment();

    /** Custom-event fan-out for `"change"`. */
    private readonly _listeners: ListenerBag<CodeEditorEvent> = new ListenerBag<CodeEditorEvent>();

    /** Handle to detach the {@link ThemeManager.onThemeChange} listener on {@link CodeEditor.dispose}. */
    private readonly _unsubscribeTheme: () => void;

    /**
     * Constructs a code editor.
     *
     * @param value - Initial document text (optional; defaults to "").
     * @param options - Optional construction options.
     */
    constructor(value?: string, options?: CodeEditorOptions) {
        super(options);

        // Positional argument: cache it only when the caller didn't also pass
        // `options.value` (which the super-time cascade already stored).
        if (value !== undefined && this._options.value === undefined) {
            this._options.value = value;
        }

        this._unsubscribeTheme = ThemeManager.onThemeChange(() => this.onThemeChange());

        this.applyListeners(options?.listeners);

        this.onFirstLayout(() => this.mount());
    }

    /**
     * Caches the `value` / `language` / `readOnly` fields onto `_options` after
     * inherited Component fields cascade through `super.applyOptions`. No view
     * exists yet at this point (the editor mounts later, in `onFirstLayout`), so
     * these are pure caches, applied to the freshly-created `EditorState` and
     * compartments in `mount()`.
     *
     * @param options - The options bag carrying the values to apply.
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: CodeEditorOptions): this {
        super.applyOptions(options);

        if (options.value    !== undefined) this._options.value    = options.value;
        if (options.language !== undefined) this._options.language = options.language;
        if (options.readOnly !== undefined) this._options.readOnly = options.readOnly;

        return this;
    }

    /**
     * Returns the current document text: read live from the view when mounted,
     * else the cached pre-mount / offline value.
     *
     * @returns The document text, or `""` when unset.
     */
    getValue(): string {
        if (this._view) {
            return this._view.state.doc.toString();
        }

        return this._options.value ?? "";
    }

    /**
     * Replaces the whole document. Caches the value; when a view is mounted,
     * also dispatches a full-document replace transaction.
     *
     * @param value - The new document text.
     * @returns This component, for method chaining.
     */
    setValue(value: string): this {
        this._options.value = value;

        if (this._view) {
            this._view.dispatch({
                changes: { from: 0, to: this._view.state.doc.length, insert: value },
            });
        }

        return this;
    }

    /**
     * Returns the active language id.
     *
     * @returns The registered language id, or `null` when unset.
     */
    getLanguage(): string | null {
        return this._options.language ?? null;
    }

    /**
     * Sets (or clears) the active language. Caches the id; when a view is
     * mounted and the id names a registered language, kicks off the grammar's
     * lazy `loadExtension()` and reconfigures the grammar compartment once it
     * resolves — guarded against a stale resolution by re-checking the active
     * language id, so a rapid double-swap applies only the latest.
     *
     * @param id - A registered language id, or `null` to clear highlighting.
     * @returns This component, for method chaining.
     */
    setLanguage(id: string | null): this {
        this._options.language = id ?? undefined;

        if (!this._view) {
            return this;
        }

        if (!id) {
            this._view.dispatch({ effects: this._langCompartment.reconfigure([]) });

            return this;
        }

        const def = getLanguage(id);

        if (!def) {
            return this;
        }

        void def.loadExtension().then((extension) => {
            if (this._view && this.getLanguage() === id) {
                this._view.dispatch({ effects: this._langCompartment.reconfigure(extension) });
            }
        });

        return this;
    }

    /**
     * Returns whether the editor currently rejects edits.
     *
     * @returns The readOnly state.
     */
    getReadOnly(): boolean {
        return this._options.readOnly ?? false;
    }

    /**
     * Sets whether the editor rejects edits. Caches the state; when a view is
     * mounted, also reconfigures the readOnly compartment.
     *
     * @param readOnly - Whether the editor should reject edits.
     * @returns This component, for method chaining.
     */
    setReadOnly(readOnly: boolean): this {
        this._options.readOnly = readOnly;

        if (this._view) {
            this._view.dispatch({ effects: this._readOnlyCompartment.reconfigure(buildReadOnlyExtension(readOnly)) });
        }

        return this;
    }

    /**
     * Formats the document via the active language's formatter, or re-indents
     * it (CodeMirror's own indentation service) when the language has none.
     *
     * @remarks If the formatter throws (invalid syntax), the rejection
     * propagates and the document is left **untouched** — the full-document
     * replace only runs after the formatter resolves successfully, so a
     * throwing formatter never reaches it. The cursor is preserved through
     * Prettier's `formatWithCursor` mapping, or clamped to the new document
     * length for a formatter with no cursor map (sql-formatter).
     *
     * @returns A promise that resolves once formatting completes, or rejects
     *   with the formatter's error.
     */
    async format(): Promise<void> {
        const id  = this.getLanguage();
        const def = id ? getLanguage(id) : undefined;

        if (!def?.loadFormatter) {
            this.reindentFallback();

            return;
        }

        const formatter    = await def.loadFormatter();
        const source       = this.getValue();
        const cursorOffset = this._view ? this._view.state.selection.main.head : 0;

        const result = await formatter(source, cursorOffset);

        this._options.value = result.formatted;

        if (this._view) {
            this._view.dispatch({
                changes:   { from: 0, to: this._view.state.doc.length, insert: result.formatted },
                selection: { anchor: Math.min(result.cursorOffset, result.formatted.length) },
            });
        }
    }

    /**
     * The `format()` fallback for a language with no formatter: re-indents the
     * whole document via CodeMirror's own indentation service. Factored out
     * from `format()` so the dispatch decision (formatter vs. this fallback) is
     * unit-testable by spying on this method — the actual re-indent needs a
     * live view (guarded below) and is otherwise manual-verify only.
     */
    private reindentFallback(): void {
        if (this._view) {
            this._view.dispatch({ changes: indentRange(this._view.state, 0, this._view.state.doc.length) });
        }
    }

    /**
     * Registers a listener for the `"change"` event, fired whenever the
     * document changes (including via {@link CodeEditor.format} / {@link CodeEditor.setValue}).
     *
     * @param event - Must be `"change"`.
     * @param listener - Invoked with the new document text.
     * @returns This component, for method chaining.
     */
    on(event: CodeEditorEvent, listener: (payload: CodeEditorChange) => void): this {
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
    off(event: CodeEditorEvent, listener: (payload: CodeEditorChange) => void): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fans the `"change"` event out to its registered listeners.
     *
     * @param event - Must be `"change"`.
     * @param payload - The event payload.
     */
    protected emit(event: CodeEditorEvent, payload: CodeEditorChange): void {
        this._listeners.fire(event, payload);
    }

    /**
     * Detaches the theme-change listener and destroys the live CodeMirror view.
     * Call before discarding a dynamically-built `CodeEditor`, mirroring
     * `Markdown.dispose`.
     */
    dispose(): void {
        this._unsubscribeTheme();
        this._view?.destroy();
    }

    /**
     * Builds the `EditorState` and mounts the CodeMirror view through the DOM
     * seam's `mountView` escape. Idempotent (guards on an existing view).
     * Offline / before the element exists, `DOM.sink.mountView` returns `null`,
     * so `_view` stays `null` and every editor operation continues to no-op.
     */
    private mount(): void {
        if (this._view) {
            return;
        }

        const element = this.getElement();

        if (!element) {
            return;
        }

        const dark = ThemeManager.getTheme().colorScheme === "dark";

        const extensions: Extension[] = [
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            drawSelection(),
            lineNumbers(),
            highlightActiveLine(),
            highlightActiveLineGutter(),
            indentOnInput(),
            bracketMatching(),
            this._readOnlyCompartment.of(buildReadOnlyExtension(this.getReadOnly())),
            this._themeCompartment.of(codeEditorTheme(dark)),
            this._langCompartment.of([]),
            EditorView.updateListener.of((update) => {
                if (update.docChanged) {
                    this._options.value = update.state.doc.toString();
                    this.emit("change", { value: this._options.value });
                }
            }),
        ];

        const state = EditorState.create({ doc: this._options.value ?? "", extensions });

        this._view = DOM.sink.mountView(element, (parent) => new EditorView({ parent, state }));

        const language = this.getLanguage();

        if (language) {
            this.setLanguage(language);
        }
    }

    /**
     * Reconfigures the theme compartment when the project theme changes, so
     * the editor's chrome + syntax colours follow a `ThemeManager.setTheme`
     * toggle with no rebuild. No-ops before the view exists.
     */
    private onThemeChange(): void {
        if (!this._view) {
            return;
        }

        const dark = ThemeManager.getTheme().colorScheme === "dark";

        this._view.dispatch({ effects: this._themeCompartment.reconfigure(codeEditorTheme(dark)) });
    }
}

const CodeEditorCallable = callable(CodeEditor);
type CodeEditorCallable = CodeEditor;
export {
    CodeEditor         as _CodeEditor,
    CodeEditorCallable as CodeEditor,
};
