// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Animation } from "~/core/Animation.js";
import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { consumeWheel } from "~/core/SmoothScroller.js";
import { ThemeManager } from "~/core/Theme.js";
import { callable } from "~/core/Callable.js";
import { EditorView, keymap, drawSelection, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
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

/**
 * The events {@link CodeEditor} exposes through its custom `on` / `off` surface:
 *
 * - `"change"` — the document text changed (payload {@link CodeEditorChange}).
 * - `"readonlyedit"` — a user edit was rejected because the editor is read-only
 *   (no payload); see {@link CodeEditor.on}.
 */
type CodeEditorEvent = "change" | "readonlyedit";

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
    /** Construction-time listener bag; the events are `"change"` and `"readonlyedit"`. */
    listeners?: { change?: (payload: CodeEditorChange) => void; readonlyedit?: () => void };
}

/** Duration of the read-only rejection flash, in milliseconds. */
const READONLY_FLASH_MS = 300;

/** Peak opacity of the read-only rejection wash — a subtle tint that keeps the text readable. */
const READONLY_FLASH_PEAK_OPACITY = 0.16;

/**
 * Fill of the read-only rejection wash: the project's validation-error token,
 * with a light/dark-safe fallback, so the tint follows a `ThemeManager.setTheme`
 * toggle with no rebuild (the CSS variable resolves live).
 */
const READONLY_FLASH_COLOR = "var(--ts-ui-validation-error-border, #dc2626)";

/**
 * Builds the readOnly-state extension: `EditorState.readOnly` blocks every
 * edit (including programmatic ones) while leaving the content DOM editable, so
 * the caret, cursor navigation, and text selection / copy all keep working —
 * the standard read-only experience. (`EditorView.editable.of(false)` would
 * additionally strip selection by making CodeMirror stop managing a caret in
 * the content, so it is deliberately *not* used here.)
 *
 * @param readOnly - Whether the editor should reject edits.
 * @returns The extension for the readOnly compartment.
 */
function buildReadOnlyExtension(readOnly: boolean): Extension {
    return EditorState.readOnly.of(readOnly);
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

    /** Overlay flashed on a rejected read-only edit; `null` until mounted (or forever, offline). */
    private _flashOverlay: Handle | null = null;

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
     * Stable reference for the subtree wheel-claim listener's add (in
     * {@link CodeEditor.mount}) and remove (in {@link CodeEditor.dispose}); see
     * {@link CodeEditor.claimScrollableWheel}.
     */
    private readonly _onWheelClaim: (e: WheelEvent) => void = (e) => this.claimScrollableWheel(e);

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
     * Moves keyboard focus into the editor.
     *
     * @remarks Overrides {@link core!Component.focus} because a `CodeEditor`'s own
     * element is a plain, non-focusable host `<div>` — CodeMirror owns the real
     * focusable target (its `contentDOM`), so the base `element.focus()` would be
     * a no-op. When mounted this hands focus to the live view; offline / before
     * mount it falls back to the base behaviour (also a no-op, matching every
     * other editor operation's null-view guard). The current selection / caret is
     * left untouched — pair with {@link CodeEditor.moveCursorToEnd} to also move it.
     *
     * @param preventScroll - Forwarded to the base fallback; CodeMirror's own
     *   `focus()` takes no scroll option, so it is honoured only offline.
     * @returns This component, for method chaining.
     */
    focus(preventScroll: boolean = false): this {
        if (this._view) {
            this._view.focus();

            return this;
        }

        return super.focus(preventScroll);
    }

    /**
     * Places the caret at the end of the document (after the last character),
     * collapsing any selection, and scrolls it into view.
     *
     * @remarks A selection-only transaction — it changes no text, so it emits no
     * `"change"`. No-op before the view is mounted (offline / pre-mount), like
     * every other view operation. Pair with {@link CodeEditor.focus} to land the
     * caret ready for typing (e.g. on a freshly opened, pre-seeded editor).
     *
     * @returns This component, for method chaining.
     */
    moveCursorToEnd(): this {
        if (this._view) {
            const end = this._view.state.doc.length;

            this._view.dispatch({ selection: { anchor: end }, scrollIntoView: true });
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
    on(event: "change", listener: (payload: CodeEditorChange) => void): this;
    /**
     * Registers a listener for the `"readonlyedit"` event, fired when a user
     * edit (typing, paste, drop) is rejected because the editor is read-only.
     *
     * @param event - Must be `"readonlyedit"`.
     * @param listener - Invoked with no arguments on each rejected edit.
     * @returns This component, for method chaining.
     */
    on(event: "readonlyedit", listener: () => void): this;
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
    off(event: "change", listener: (payload: CodeEditorChange) => void): this;
    /**
     * Removes a previously registered `"readonlyedit"` listener.
     *
     * @param event - Must be `"readonlyedit"`.
     * @param listener - The exact callback reference to remove.
     * @returns This component, for method chaining.
     */
    off(event: "readonlyedit", listener: () => void): this;
    off(event: CodeEditorEvent, listener: (payload: CodeEditorChange) => void): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fans an event out to its registered listeners.
     *
     * @param event - The event name.
     * @param payload - The event payload (`"change"` only; `"readonlyedit"` has none).
     */
    protected emit(event: "change", payload: CodeEditorChange): void;
    protected emit(event: "readonlyedit"): void;
    protected emit(event: CodeEditorEvent, payload?: CodeEditorChange): void {
        this._listeners.fire(event, ...(payload ? [payload] : []));
    }

    /**
     * Detaches the theme-change listener and destroys the live CodeMirror
     * view, then defers to the base class for the rest of teardown. Call
     * before discarding a dynamically-built `CodeEditor`, mirroring
     * `Markdown.dispose`.
     */
    dispose(): void {
        this._unsubscribeTheme();

        if (this._view) {
            Event.removeSubtreeListener(this, "wheel", this._onWheelClaim);
        }

        this._view?.destroy();

        super.dispose();
    }

    /**
     * Marks a wheel event consumed (via {@link consumeWheel}) when CodeMirror's
     * own scroller can move along the gesture's axis — WITHOUT
     * `preventDefault()`, so CodeMirror still scrolls `.cm-scroller` natively.
     *
     * @param e - The wheel event reaching this editor's subtree.
     *
     * @remarks A floating overlay installs a wheel trap (see `WheelTrap`) that
     * `preventDefault()`s any wheel no inner scroller claimed, so an unconsumed
     * wheel cannot fall through to content behind the overlay. CodeMirror
     * scrolls natively without going through the framework's eased scroller, so
     * it never claims the wheel — and the trap, firing last as the outermost
     * ancestor, would cancel the editor's native scroll. Claiming here (the
     * subtree walk reaches this inner editor before the outer overlay) lets the
     * native scroll proceed. Only an axis with somewhere to go is claimed; at a
     * fits-in-box axis the wheel stays unclaimed so the trap still swallows it.
     */
    private claimScrollableWheel(e: WheelEvent): void {
        const scroller = this._view?.scrollDOM;

        if (!scroller) {
            return;
        }

        const extentX = scroller.scrollWidth  > scroller.clientWidth;
        const extentY = scroller.scrollHeight > scroller.clientHeight;

        // shift+wheel with a bare vertical delta scrolls horizontally (native
        // behaviour CodeMirror preserves), so it targets the horizontal axis.
        const targetsHorizontal = e.deltaX !== 0 || (e.shiftKey && e.deltaY !== 0);
        const targetsVertical   = e.deltaY !== 0 && !e.shiftKey;

        if ((targetsVertical && extentY) || (targetsHorizontal && extentX)) {
            consumeWheel(e);
        }
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
            // `indentWithTab` is deliberately absent from `defaultKeymap`,
            // because binding Tab traps it inside the editor and a keyboard
            // user can no longer Tab out. A code editor that does not indent
            // on Tab is the worse trade, and `defaultKeymap` already carries
            // the escape hatch: Ctrl-m (Alt-Shift-m on macOS) toggles
            // CodeMirror's tab-focus mode, after which Tab moves focus again.
            // Listed last so its Tab / Shift-Tab bindings take precedence.
            keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
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
            EditorView.domEventHandlers({
                // A user edit while read-only is blocked by `EditorState.readOnly`
                // at the input layer — it never becomes a transaction, so it emits
                // no "change". These hooks surface the rejection as feedback:
                // typing / IME / delete fire `beforeinput`, while paste and drop are
                // prevented before `beforeinput` runs, so each needs its own hook.
                beforeinput: () => this.onEditIntent(),
                paste:       () => this.onEditIntent(),
                drop:        () => this.onEditIntent(),
            }),
        ];

        const state = EditorState.create({ doc: this._options.value ?? "", extensions });

        this._view = DOM.sink.mountView(element, (parent) => new EditorView({ parent, state }));

        if (this._view) {
            this.mountFlashOverlay(element);
            // Claim wheels CodeMirror's own scroller will act on, so an
            // enclosing overlay's wheel trap leaves this editor's native scroll
            // alone (see claimScrollableWheel). Descendant-first subtree
            // dispatch reaches this editor before the overlay, so the claim wins.
            Event.addSubtreeListener(this, "wheel", this._onWheelClaim, { passive: false });
        }

        const language = this.getLanguage();

        if (language) {
            this.setLanguage(language);
        }
    }

    /**
     * Creates the read-only rejection wash: a pointer-transparent overlay that
     * fills the editor box and sits above CodeMirror's content, appended after
     * the view so it paints on top. It rests at `opacity: 0`; {@link CodeEditor.flashReadOnly}
     * pulses it. Tracked as an owned handle, so the component's teardown releases it.
     *
     * @param host - The mounted editor element the overlay fills.
     */
    private mountFlashOverlay(host: Handle): void {
        const overlay = this.trackHandle(DOM.sink.createElement("div"));

        DOM.sink.apply(overlay, {
            style: {
                position:      "absolute",
                inset:         "0",
                pointerEvents: "none",
                // Above CodeMirror's sticky line-number gutter (z-index 200) so the
                // wash covers the gutter too; `.cm-editor` forms no stacking context,
                // so the gutter would otherwise paint over a lower overlay.
                zIndex:        "300",
                backgroundColor: READONLY_FLASH_COLOR,
                opacity:       "0",
            },
        });
        DOM.sink.appendChild(host, overlay);

        this._flashOverlay = overlay;
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

    /**
     * DOM-event hook for the read-only rejection feedback, wired to
     * `beforeinput` / `paste` / `drop` in {@link CodeEditor.mount}. When the
     * editor is read-only it surfaces the attempt via
     * {@link CodeEditor.signalReadOnlyEdit}; it never consumes the event, so
     * CodeMirror's own `EditorState.readOnly` handling still blocks the edit.
     *
     * @returns Always `false` (event left unhandled).
     */
    private onEditIntent(): boolean {
        if (this.getReadOnly()) {
            this.signalReadOnlyEdit();
        }

        return false;
    }

    /**
     * Emits the `"readonlyedit"` event and plays the rejection flash — a
     * programmatic hook plus a built-in visual cue that an edit was refused
     * because the editor is read-only.
     */
    private signalReadOnlyEdit(): void {
        this.emit("readonlyedit");
        this.flashReadOnly();
    }

    /**
     * Flashes a brief error-coloured wash over the editor as feedback for a
     * rejected edit: fades the overlay from a subtle tint back to transparent.
     * No-op before the overlay is mounted (offline / pre-mount), and — via
     * {@link Animation.play} — honours `prefers-reduced-motion`: under reduced
     * motion the `"readonlyedit"` event still fires but nothing animates.
     *
     * A full-box wash is used rather than a border/ring cue because the editor
     * is often large and mostly empty, so an edge flash sits far from where the
     * eye is (the caret) and reads as nothing; the wash covers the content the
     * user is looking at while staying faint enough to keep the text legible.
     */
    private flashReadOnly(): void {
        if (!this._flashOverlay) {
            return;
        }

        Animation.play(this._flashOverlay, {
            from:       { opacity: String(READONLY_FLASH_PEAK_OPACITY) },
            to:         { opacity: "0" },
            durationMs: READONLY_FLASH_MS,
            properties: ["opacity"],
        });
    }
}

const CodeEditorCallable = callable(CodeEditor);
type CodeEditorCallable = CodeEditor;
export {
    CodeEditor         as _CodeEditor,
    CodeEditorCallable as CodeEditor,
};
