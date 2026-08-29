// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Animation } from "~/core/Animation.js";
import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { ListenerBag } from "~/core/ListenerBag.js";
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
 * Payload of {@link CodeEditor}'s `"heightchange"` event: the editor's new
 * height in pixels.
 *
 * @category Components
 */
export interface CodeEditorHeightChange {
    height: number;
}

/**
 * The events {@link CodeEditor} exposes through its custom `on` / `off` surface:
 *
 * - `"change"` — the document text changed (payload {@link CodeEditorChange}).
 * - `"readonlyedit"` — a user edit was rejected because the editor is read-only
 *   (no payload); see {@link CodeEditor.on}.
 * - `"heightchange"` — {@link CodeEditorOptions.autoHeightMaxRows} is set and the
 *   editor's own computed height changed (payload {@link CodeEditorHeightChange}).
 */
type CodeEditorEvent = "change" | "readonlyedit" | "heightchange";

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
    /**
     * Row count the editor grows to fit before its own vertical scrollbar
     * takes over. Unset (the default): today's behaviour — a fixed height
     * the caller controls via `setHeight`/`preferredSize`, filling its host.
     */
    autoHeightMaxRows?: number;
    /** Construction-time listener bag; the events are `"change"`, `"readonlyedit"`, and `"heightchange"`. */
    listeners?: { change?: (payload: CodeEditorChange) => void; readonlyedit?: () => void; heightchange?: (payload: CodeEditorHeightChange) => void };
}

/**
 * User-overridable defaults forwarded to `super` via the options bag. The
 * cascade in `Component`'s constructor dispatches each setter once with the
 * final value, so any field the caller supplied wins.
 */
const _defaultCodeEditorOptions: Partial<CodeEditorOptions> = {
    // Override Component's `overflow: "hidden"` default so the framework's
    // eased wheel scroller attaches: `applyStyle` reads the effective overflow
    // and installs the controller from it (see `Component.applyOverflowStyles`
    // -> `refreshWheelScrolling`), which then drives whatever
    // `getScrollElement` resolves to — CodeMirror's `.cm-scroller` once the
    // view is mounted. Inert as a style: `.cm-editor` is `height: 100%` and the
    // flash overlay is `inset: 0`, so the editor's own box has no overflow to
    // scroll and never paints a native bar of its own. This mirrors how an
    // overlay-mode `Panel` keeps `overflow: auto` on a panel element that can
    // likewise never scroll.
    overflow: "auto",
};

/** CodeMirror's scrolling viewport element, inside the mounted view. */
const CM_SCROLLER_SELECTOR = ".cm-scroller";

/** CodeMirror's content element, inside `.cm-scroller`. */
const CM_CONTENT_SELECTOR = ".cm-content";

// Padding-bottom applied once to an auto-height editor's `.cm-scroller`
// (see the `_scrollElement` resolution in `mount`) so a sub-pixel content
// overhang can never leave the scroller a fraction of a pixel short and
// paint a permanent, non-functional vertical scrollbar. `.cm-scroller`'s
// `scrollHeight` is a whole number but the content it measures is not, so
// committing the reported extent verbatim discards up to a pixel of real
// content. This must be a fixed, one-time style, not part of the height
// `syncAutoHeight` (re)computes on every call: `.cm-content`'s own
// `min-height: 100%` means its rendered height — and so `.cm-scroller`'s
// `scrollHeight`, which can never report less than the scroller's own
// `clientHeight` — floors at whatever height was last committed, so adding
// this slop to the committed height itself fed straight back into the next
// measurement and ratcheted the editor's height upward forever. Mirrors
// ScrollStrip.arrowReserve's `+1` slop against the same rounding noise.
const SUBPIXEL_HEIGHT_SLOP_PX = 1;

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

    // In-flight read-only flash, cancelled on teardown so its fallback timer
    // cannot fire against the overlay's released element handle.
    private _flashAnimation: Animation.CancelHandle | null = null;

    /** Reconfigured by {@link CodeEditor.setLanguage} to swap the active grammar. */
    private readonly _langCompartment: Compartment = new Compartment();

    /** Reconfigured by {@link CodeEditor.setReadOnly}. */
    private readonly _readOnlyCompartment: Compartment = new Compartment();

    /** Reconfigured on a theme change to recolour the editor. */
    private readonly _themeCompartment: Compartment = new Compartment();

    /** Custom-event fan-out for `"change"`. */
    private readonly _listeners: ListenerBag<CodeEditorEvent> = this.registerListenerBag(new ListenerBag<CodeEditorEvent>());

    /** Handle to detach the {@link ThemeManager.onThemeChange} listener on {@link CodeEditor.dispose}. */
    private readonly _unsubscribeTheme: () => void;

    /**
     * Handle for CodeMirror's own scrolling viewport, resolved once the view
     * mounts; `null` until then (or forever, offline). Backs
     * {@link CodeEditor.getScrollElement}.
     */
    private _scrollElement: Handle | null = null;

    /**
     * Handle for CodeMirror's own content element (`.cm-content`, inside
     * `.cm-scroller`), resolved once the view mounts; `null` until then (or
     * forever, offline). Used by {@link CodeEditor.syncAutoHeight} to read
     * its true, fractional rendered content height — `scrollHeight` /
     * `clientHeight` are integer DOM properties that can round away a
     * sub-pixel shortfall this element's own `getBoundingClientRect` still
     * shows.
     */
    private _contentElement: Handle | null = null;

    // `syncAutoHeight` trusts a height GROWTH only on the call where the
    // document/width shape genuinely changed (a real edit or resize) — never
    // again against the same shape, no matter how plausible the reading looks.
    // Committing a height changes `.cm-scroller`'s real `clientHeight`;
    // CodeMirror's own `ViewState.measure()` (@codemirror/view) runs on its own
    // schedule and compares that live value against its cached copy on every
    // pass, reporting a fresh `geometryChanged` update whenever they differ —
    // which they always do, immediately after any commit. That re-invokes
    // `syncAutoHeight` with no genuine content or width change. On a real
    // (non-integer) device-pixel ratio the re-measurement does not reliably read
    // back the exact value just committed (unlike the mount-time case
    // `SUBPIXEL_HEIGHT_SLOP_PX` handles, which converges): it can read
    // fractionally MORE, live-observed climbing by tens of pixels roughly every
    // 100ms, forever, with the editor merely visible and no further interaction.
    // A one-growth-of-slack budget was tried first, on the theory that an
    // initial pre-layout guess might need exactly one accurate follow-up once
    // CodeMirror's real layout became available. Live testing across several
    // unrelated blocks (Dialog, Drawer, LineChart, Button) refuted that: the
    // "follow-up" fired on essentially every multi-line editor regardless of
    // whether real settling was needed, each time adding a line or two of dead
    // space with nothing behind it — the same self-referential echo the
    // unbounded case shows, just bounded to a single step instead of climbing
    // forever. There is no reliable signal that distinguishes a genuine
    // follow-up correction from this echo, so none is trusted; a block whose
    // first, always-free commit undershoots true content is a distinct bug (the
    // initial measurement itself, not this guard) to fix at the source.
    /**
     * `[lines, docLength, clientWidth]` as of the last call to
     * `syncAutoHeight`, or `null` before the first call. Used to tell a
     * genuine content/width change from a self-triggered geometry echo — a
     * growth is trusted only when this differs from the previous call, and
     * so is a content shrink of a pixel or more (a smaller, sub-pixel
     * content shrink is rounding noise regardless of this tuple).
     */
    private _lastSyncedShape: readonly [number, number, number] | null = null;

    /**
     * Horizontal-scrollbar height reserve, re-measured on every call to
     * `syncAutoHeight` (rendered content width — and so a real scrollbar's
     * presence — can change without the document/width shape itself
     * changing, e.g. once an async language grammar finishes loading and
     * re-flows the text). Cached here only so a later call can fold it into
     * `desired` without re-deriving it. See
     * {@link CodeEditor.syncAutoHeight}'s `@remarks` for why it's measured
     * this way at all.
     */
    private _lastHbarReserve = 0;

    /**
     * Constructs a code editor.
     *
     * @param value - Initial document text (optional; defaults to "").
     * @param options - Optional construction options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(value?: string, options?: CodeEditorOptions, subclassDefaults?: Partial<CodeEditorOptions>) {
        super(options, { ..._defaultCodeEditorOptions, ...(subclassDefaults ?? {}) });

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
        if (options.autoHeightMaxRows !== undefined) this._options.autoHeightMaxRows = options.autoHeightMaxRows;

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
     * Returns the row-count cap this editor grows to before its own vertical
     * scrollbar takes over.
     *
     * @returns The configured {@link CodeEditorOptions.autoHeightMaxRows}, or
     *   `null` when unset (today's fixed-height, fill-parent contract).
     */
    getAutoHeightMaxRows(): number | null {
        return this._options.autoHeightMaxRows ?? null;
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
    /**
     * Registers a listener for the `"heightchange"` event, fired when
     * {@link CodeEditorOptions.autoHeightMaxRows} is set and the editor's own
     * computed height changes.
     *
     * @param event - Must be `"heightchange"`.
     * @param listener - Invoked with the editor's new height.
     * @returns This component, for method chaining.
     */
    on(event: "heightchange", listener: (payload: CodeEditorHeightChange) => void): this;
    on(event: CodeEditorEvent, listener: Function): this {
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
    /**
     * Removes a previously registered `"heightchange"` listener.
     *
     * @param event - Must be `"heightchange"`.
     * @param listener - The exact callback reference to remove.
     * @returns This component, for method chaining.
     */
    off(event: "heightchange", listener: (payload: CodeEditorHeightChange) => void): this;
    off(event: CodeEditorEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fans an event out to its registered listeners.
     *
     * @param event - The event name.
     * @param payload - The event payload (`"change"`/`"heightchange"`; `"readonlyedit"` has none).
     */
    protected emit(event: "change", payload: CodeEditorChange): void;
    protected emit(event: "readonlyedit"): void;
    protected emit(event: "heightchange", payload: CodeEditorHeightChange): void;
    protected emit(event: CodeEditorEvent, payload?: CodeEditorChange | CodeEditorHeightChange): void {
        this._listeners.fire(event, ...(payload ? [payload] : []));
    }

    /**
     * Detaches the theme-change listener and destroys the live CodeMirror
     * view, then defers to the base class for the rest of teardown. Call
     * before discarding a dynamically-built `CodeEditor`, mirroring
     * `Markdown.destructor`.
     */
    protected destructor(): void {
        // Before `super.destructor()` releases the overlay's element handle,
        // which the flash's fallback timer would otherwise write to.
        this._flashAnimation?.cancel();
        this._flashAnimation = null;

        this._unsubscribeTheme();

        // Before the view is destroyed below, so any later scroll read (the
        // base destructor's own teardown, a queued layout) resolves through the
        // base element rather than a handle whose node CodeMirror has removed.
        this._scrollElement  = null;
        this._contentElement = null;

        // Nulled after destroy so a second destructor() pass on this same
        // instance (dispose() is documented idempotent — a harmless no-op —
        // but CodeMirror's own EditorView.destroy() is not guarded against a
        // repeat call) finds `_view` already null and no-ops via the `?.`
        // above. Cheap insurance on a path the offline test harness cannot
        // reach: it never constructs a live `EditorView`.
        this._view?.destroy();
        this._view = null;

        super.destructor();
    }

    /**
     * Routes every framework scroll read/write onto CodeMirror's own scrolling
     * viewport (`.cm-scroller`) rather than the editor's outer box, so the
     * eased wheel scroller, the scroll-offset cache, and
     * {@link CodeEditor.getMaxScrollTop} all act on the element that actually
     * moves.
     *
     * @returns CodeMirror's scroller handle once mounted, else the editor's own
     *   element.
     *
     * @remarks Falls back to the base element before the view mounts (and
     * forever offline, where the view never mounts): the outer box has no
     * overflow, so every scroll read reports zero extent and the wheel handler
     * leaves the gesture unclaimed — the correct answer while there is nothing
     * to scroll.
     */
    protected getScrollElement(): Handle | undefined {
        return this._scrollElement ?? super.getScrollElement();
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

                if (update.heightChanged || update.geometryChanged) {
                    this.syncAutoHeight(update.selectionSet && !update.docChanged);
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

            // Hand the framework's scroll plumbing CodeMirror's own viewport
            // (see getScrollElement). Resolved through the seam rather than
            // from `_view.scrollDOM`, so no raw element crosses the boundary;
            // the handle is interned weakly, so the live DOM keeps owning it
            // and it must not be tracked as one of this component's own.
            this._scrollElement = DOM.source.querySelector(element, CM_SCROLLER_SELECTOR);

            // Resolved from `_scrollElement` (not `element`) so the query is
            // scoped to this editor's own scroller, matching how `_scrollElement`
            // itself is resolved.
            if (this._scrollElement) {
                this._contentElement = DOM.source.querySelector(this._scrollElement, CM_CONTENT_SELECTOR);
            }

            // Auto-height mode only: two fixed, one-time styles, never
            // recomputed, so neither can feed back into a later measurement.
            if (this._scrollElement && this.getAutoHeightMaxRows() !== null) {
                DOM.sink.apply(this._scrollElement, {
                    style: {
                        // A one-time padding-bottom absorbs the sub-pixel
                        // content overhang `syncAutoHeight` cannot safely
                        // absorb itself — see SUBPIXEL_HEIGHT_SLOP_PX.
                        // Recomputing it every call fed back into the next
                        // `scrollHeight` read instead (`.cm-content`'s
                        // `min-height: 100%` floors its own rendered height
                        // at whatever `.cm-scroller`'s clientHeight last was),
                        // ratcheting the height upward forever.
                        paddingBottom: SUBPIXEL_HEIGHT_SLOP_PX + "px",
                        // `syncAutoHeight` reserves room for a horizontal
                        // scrollbar by comparing `scrollWidth` against
                        // `.cm-scroller`'s own `clientWidth` — but that
                        // `clientWidth` shrinks whenever `.cm-scroller` is
                        // itself showing a *vertical* scrollbar (the native
                        // scrollbar eats horizontal space). For a document
                        // whose longest line sits within one scrollbar-width
                        // of that boundary, this is circular: committing the
                        // taller (reserved) height removes the vertical
                        // scrollbar, which widens `clientWidth`, which drops
                        // the horizontal reserve, which commits the shorter
                        // height, which brings the vertical scrollbar back —
                        // forever. `scrollbar-gutter: stable` reserves the
                        // vertical scrollbar's track unconditionally, so
                        // `clientWidth` no longer depends on whether a
                        // vertical scrollbar is currently showing, breaking
                        // the cycle at its source.
                        scrollbarGutter: "stable",
                    },
                });
            }
        }

        const language = this.getLanguage();

        if (language) {
            this.setLanguage(language);
        }

        // CM6's constructor-time initial update is not documented to
        // reliably invoke `updateListener`, so this call seeds the first
        // measurement explicitly rather than assuming it does.
        this.syncAutoHeight();
    }

    /**
     * Computes this editor's desired height when {@link CodeEditorOptions.autoHeightMaxRows}
     * is set — the real rendered content height, plus the horizontal scrollbar's
     * measured thickness when `.cm-scroller` is showing one, capped at the row
     * limit — and applies it via `setHeight()`, emitting `"heightchange"` when
     * the value actually moves. No-op offline (no `_view`, or `_scrollElement`
     * hasn't resolved) and when `autoHeightMaxRows` is unset (today's
     * fixed-height contract).
     *
     * @remarks Reads `.cm-scroller`'s live `scrollHeight`/`scrollWidth`/
     * `clientWidth` via `DOM.source.getScrollMetrics` rather than CodeMirror's
     * own `contentHeight`/`defaultLineHeight` getters. CodeMirror defers its own
     * internal line-height refresh while its view is scrolled outside the
     * browser's visible viewport (`ViewState.measure`'s `inView` gate, a
     * performance optimisation for large documents), so those getters can keep
     * reporting CodeMirror's pre-measurement default indefinitely for a fenced
     * block that upgrades below the page fold. `.cm-scroller`'s native scroll
     * metrics force a real reflow on every read and are accurate regardless of
     * that gate, since CodeMirror always renders a short document's line DOM
     * eagerly at construction. The row cap's per-row pixel height is derived
     * the same way — from the live line count, not `defaultLineHeight`.
     *
     * `.cm-scroller` carries a one-time `SUBPIXEL_HEIGHT_SLOP_PX` padding-
     * bottom (applied once, in `mount`) rather than this method adding it to
     * the height it computes — see that constant's comment for why the slop
     * cannot live here without ratcheting the editor's height upward on every
     * call.
     *
     * A height change this method applies is itself a geometry change
     * CodeMirror's own internal measurement reacts to independently of this
     * component, so a growth — and, symmetrically, a content shrink of a
     * pixel or more — is trusted only on the call where the document/width
     * shape genuinely changed — see the comment above `_lastSyncedShape`'s
     * declaration for why no growth, and no such shrink, against an
     * unchanged shape is trusted, however plausible either looks.
     *
     * @param pureSelectionChange - True when the caller's `updateListener`
     *   update carries a selection change but no document change. A cursor
     *   move alone can never legitimately need more vertical space (a
     *   monospace grid layout has no reflow to trigger), so a growth request
     *   arriving this way is rejected outright, even on a call that would
     *   otherwise read as a shape change — live-confirmed via a direct
     *   mutation-log comparison: a click moving the cursor to a *different*
     *   line reassigns `cm-activeLine` / `cm-activeLineGutter` and rewrites
     *   `.cm-content`'s own style, CodeMirror's heavier internal refresh,
     *   while a same-line reposition (or a single-line document, structurally
     *   incapable of having a different line to click) never does.
     */
    private syncAutoHeight(pureSelectionChange = false): void {
        const maxRows = this.getAutoHeightMaxRows();

        if (!this._view || maxRows === null || !this._scrollElement) {
            return;
        }

        const metrics = DOM.source.getScrollMetrics(this._scrollElement);

        const padding       = this._view.documentPadding.top + this._view.documentPadding.bottom;
        const perLineHeight = (metrics.scrollHeight - padding) / this._view.state.doc.lines;
        const capPx         = perLineHeight * maxRows + padding;

        let contentDesired = Math.min(metrics.scrollHeight, capPx);

        if (pureSelectionChange && contentDesired > this.getHeight()) {
            return;
        }

        const shape = [this._view.state.doc.lines, this._view.state.doc.length, metrics.clientWidth] as const;
        const shapeChanged = this._lastSyncedShape === null || shape.some((v, i) => v !== this._lastSyncedShape![i]);

        this._lastSyncedShape = shape;

        // Captured before this call's own commits (the intermediate one
        // below, when shapeChanged), so the convergence/growth checks after
        // it compare against the height this call STARTED with rather than
        // one it already changed mid-call.
        const previousHeight = this.getHeight();

        // `.cm-scroller`'s one-time `scrollbar-gutter: stable` (see `mount`)
        // reserves a vertical scrollbar's worth of width unconditionally,
        // narrowing `clientWidth` regardless of whether a vertical scrollbar
        // ever actually renders — so whether a REAL horizontal scrollbar
        // renders cannot be predicted from `scrollWidth` vs. `clientWidth`
        // (with or without a scrollbar-width fudge factor): live measurement
        // found two blocks both with `scrollWidth > clientWidth` (7px and
        // 15px over) where only the second actually rendered one. The fix is
        // to measure the box's own rendered state directly instead of
        // predicting it — `offsetHeight` includes a real horizontal
        // scrollbar's thickness, `clientHeight` excludes it, so their
        // difference (floored at zero) is exactly the space it's costing.
        //
        // Measured on EVERY call, not just a shape change: a real
        // scrollbar's presence depends on rendered content width, which can
        // change WITHOUT the shape tuple above changing — live-confirmed via
        // a block whose language grammar loads asynchronously
        // (`setLanguage`'s `loadExtension().then(...)`, well after `mount`'s
        // synchronous initial measurement): a real, visible horizontal
        // scrollbar present at that initial measurement resolved on its own
        // once highlighting settled and re-flowed the text, but the shape
        // tuple (line count, doc length, container width) never changed, so
        // a reserve cached only on shape changes never got revisited and the
        // dead space it added stayed forever. Re-measuring costs one more
        // forced-layout read per call, same class as the several already
        // happening here, and is safe to trust unconditionally in a way a
        // content-height GROWTH is not: the box's own height is fed back
        // into `.cm-content`'s `min-height: 100%`, which is what makes a
        // height growth self-reinforcing, but a scrollbar's thickness is
        // independent of this element's height, so re-reading it here can't
        // manufacture its own feedback loop. Any resulting increase in the
        // committed height still passes through the same shape-gated growth
        // check below as always; a decrease passes through the same
        // sub-pixel-noise-guarded shrink check.
        //
        // On the call that first establishes a new shape, `.cm-scroller` is
        // still whatever height it had BEFORE (this component's own pre-sync
        // default on the very first call ever, or the previous shape's
        // height on a later one) — live-confirmed wrong: a block correctly
        // showing no scrollbar once content-sized measured a false 15px
        // reserve read against that stale height, and since no growth
        // against an unchanged shape is ever trusted (see above), the wrong
        // reading then locked in permanently. So on a shape change the
        // content-only height is committed FIRST, forcing a real layout pass
        // (a plain synchronous property read already forces one; the box
        // itself needs an actual write, not just a read, since the
        // scrollbar's presence is being measured against ITS height), and
        // the reserve is measured against that — all still within this one
        // call, so nothing paints in between. On a later call against an
        // unchanged shape the box is already content-sized from that
        // earlier commit, so `metrics.clientHeight` (read once, at the top
        // of this method, before any commit this call might make) is
        // already an accurate reference — no second commit needed.
        let settledClientHeight = metrics.clientHeight;

        if (shapeChanged) {
            this.setHeight(contentDesired);

            const settled = DOM.source.getScrollMetrics(this._scrollElement);

            settledClientHeight = settled.clientHeight;

            // The pre-commit `metrics.scrollHeight` above, and `settled`
            // here, are both integer DOM properties — browsers round or
            // floor them, which can hide a genuine sub-pixel shortfall
            // entirely: live-confirmed via a raw DOM snapshot where
            // CodeMirror's own gutter carried an inline `min-height:
            // 223.504px` (its internal, full-precision content measurement)
            // against a rounded 224px commit that STILL left a hair of real,
            // non-zero scroll range — yet `scrollHeight`/`clientHeight` both
            // read back as the same rounded 224, showing no gap at all. The
            // fractional `getBoundingClientRect`-based rect on `.cm-content`
            // itself doesn't round this away, so it's compared directly
            // against `.cm-scroller`'s own fractional content-box height
            // (its rect height minus the fixed padding-bottom applied in
            // `mount` — `.cm-content`'s `min-height: 100%` resolves against
            // that content box, not the padding-inclusive border box).
            // Skipped when this call's height came from the row cap, not
            // real content: a capped block is EXPECTED to keep overflowing
            // past its committed height — that's what drives its own
            // intentional internal scroll — so "correcting" it here would
            // defeat the cap.
            if (metrics.scrollHeight <= capPx && this._contentElement) {
                const contentRectHeight        = DOM.source.getElementRect(this._contentElement).height;
                const scrollerContentBoxHeight = DOM.source.getElementRect(this._scrollElement).height - SUBPIXEL_HEIGHT_SLOP_PX;

                contentDesired += Math.max(0, contentRectHeight - scrollerContentBoxHeight);
            }
        } else {
            // A content shrink this call did NOT earn through a genuine shape
            // change is the same self-triggered geometry echo the growth guard
            // below already distrusts (see the comment above `_lastSyncedShape`,
            // and the growth check a few lines down): CodeMirror's own internal
            // remeasure pass can report a `scrollHeight` reading that drifts away
            // from what this method already committed -- on a real device-pixel
            // ratio it can read fractionally MORE, forever, on the growth side
            // (see the comment above); live-confirmed to drift the other way too:
            // a chain of such echoes, each shrinking `contentDesired` by more than
            // the sub-pixel noise floor below, walks the committed height down
            // with nothing to stop it short of zero -- even though the document
            // never changed. Only a genuine shape change re-establishes trust in
            // a smaller reading; a re-entrant call holds the content component at
            // its last-trusted value instead. The hbar-reserve component measured
            // below is unaffected -- it is re-measured, and trusted, on every
            // call regardless of shape, since (per the comment above its own
            // computation) it cannot manufacture this kind of feedback loop on
            // its own.
            const previousContentHeight = previousHeight - this._lastHbarReserve;

            if (contentDesired < previousContentHeight && previousContentHeight - contentDesired >= 1) {
                contentDesired = previousContentHeight;
            }
        }

        const offsetSize = DOM.source.getOffsetSize(this._scrollElement);

        this._lastHbarReserve = Math.max(0, offsetSize.offsetHeight - settledClientHeight);

        const desired = contentDesired + this._lastHbarReserve;

        if (desired === previousHeight) {
            // The `shapeChanged` branch above committed `contentDesired` as an
            // intermediate probe height, so the horizontal-scrollbar reserve could
            // be measured against a content-sized box. Folding that reserve back in
            // landed on the height this call started at, so there is nothing to
            // report — but the box is still sitting at the probe height, short by
            // the reserve, until this puts it back. No `"heightchange"`: the height
            // did not move, so a consumer that pinned its own chrome to
            // `previousHeight` is already correct. `setHeight` no-ops when the box
            // is already at `desired`, which is the case on the `!shapeChanged`
            // path where no probe was committed.
            this.setHeight(desired);

            return;
        }

        if (desired > previousHeight && !shapeChanged) {
            return;
        }

        // A residual shrink against an UNCHANGED shape, smaller than one
        // pixel, can only be integer-rounding noise, never genuine content:
        // a content shrink of a pixel or more against an unchanged shape is
        // already held at its last-trusted value by the guard above, so
        // whatever reaches this point is either a sub-pixel content reading
        // or a change in the independently-trusted hbar reserve.
        // `metrics.scrollHeight` above is an integer DOM property — on a
        // later call against a shape whose height this method already
        // corrected upward by a fraction of a pixel (see the fractional
        // undershoot correction above), it reads back that already-correct
        // height rounded DOWN, which is strictly LESS than what this method
        // itself committed. Live-confirmed: unguarded, that read straight
        // back through as a "genuine" shrink every time, silently reverting
        // the correction on the very next geometryChanged event —
        // CodeMirror's own settling fires one almost immediately — so the
        // fix never held past its own first call.
        if (desired < previousHeight && !shapeChanged && previousHeight - desired < 1) {
            return;
        }

        this.setHeight(desired);
        this.emit("heightchange", { height: desired });
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

        this._flashAnimation?.cancel();
        this._flashAnimation = Animation.play(this._flashOverlay, {
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
