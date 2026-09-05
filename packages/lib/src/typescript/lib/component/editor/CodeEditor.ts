// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Animation } from "~/core/Animation.js";
import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { ThemeManager } from "~/core/Theme.js";
import { callable } from "~/core/Callable.js";
import {
    EditorView, keymap, drawSelection, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
    placeholder, highlightWhitespace, highlightTrailingWhitespace, highlightSpecialChars,
    dropCursor, rectangularSelection, crosshairCursor,
} from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { indentOnInput, bracketMatching, indentRange, codeFolding, foldGutter, foldKeymap, foldedRanges, indentUnit } from "@codemirror/language";
import { search, highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { linter, lintGutter } from "@codemirror/lint";
import { autocompletion, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { getLanguage } from "~/component/editor/LanguageRegistry.js";
import type { FormatOptions } from "~/component/editor/LanguageRegistry.js";
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
    /**
     * Row count the editor never shrinks below, even when the real content is
     * shorter — the floor complementing {@link autoHeightMaxRows}'s ceiling.
     * Inert without `autoHeightMaxRows` also set, since auto-height itself is.
     * Should not exceed `autoHeightMaxRows`: a larger floor than ceiling makes
     * the floor win outright, silently defeating the cap.
     */
    autoHeightMinRows?: number;
    /** Whether long lines wrap instead of scrolling horizontally. Default `false`. */
    lineWrap?: boolean;
    /** Text shown in an empty document. Unset: nothing is shown. */
    placeholder?: string;
    /** Whether spaces, tabs and trailing whitespace are rendered visibly. Default `false`. */
    highlightWhitespace?: boolean;
    /** Whether parser-error diagnostics are shown. Default `false`; inert for a language with no lint source. */
    lint?: boolean;
    /**
     * Tab-stop width, in columns: how wide a literal tab character renders,
     * and how many columns one Tab keypress or auto-indent inserts. Sets
     * CodeMirror's `EditorState.tabSize` and `indentUnit` facets together, so
     * rendered tab stops and Tab-key / auto-indent width agree — the same
     * combined "Tab Size" setting most editors (e.g. VS Code's
     * `editor.tabSize`) use. Unset: CodeMirror's own defaults apply
     * untouched (4-column tab stops, a 2-space indent unit). Should be a
     * positive integer; not validated at runtime.
     *
     * Distinct from `FormatOptions.indentWidth` (see `LanguageRegistry.ts`),
     * which only shapes `format()`'s one-shot reformat output and has no
     * effect on live, interactive editing.
     */
    tabSize?: number;
    /** Whether the line-number gutter is shown. Default `true`. */
    lineNumbers?: boolean;
    /**
     * Whether the browser's native spellcheck runs inside the editor.
     * Default `false` — code identifiers are not English words, so the
     * browser's spellchecker produces constant false-positive squiggles
     * unless a consumer opts back in (e.g. `MarkdownEditor`'s prose source
     * view). Sets the DOM `spellcheck` attribute only; distinct from
     * `lint`, CodeMirror's own parser-error diagnostics, which also render
     * as a squiggly underline but come from the grammar, not the browser.
     */
    spellcheck?: boolean;
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

/** One rendered document line, inside `.cm-content`. */
const CM_LINE_SELECTOR = ".cm-line";

/** `.cm-content`'s last element child — the last rendered line, gap, or widget. */
const CM_LAST_BLOCK_SELECTOR = ":scope > :last-child";

/** Every CodeMirror tooltip root — the completion list, hover and lint tooltips. */
const CM_TOOLTIP_SELECTOR = ".cm-tooltip";

/**
 * Whether `handle` can actually be scrolled by the browser's own default
 * handling of `e` — its computed overflow permits scrolling on the axis `e`
 * carries delta on, *and* it has extent left to move through in that
 * direction. Mirrors {@link Component.onWheelScroll}'s own `canX`/`canY`
 * test (overflow style conjoined with remaining extent), applied to foreign
 * DOM instead of `this`.
 *
 * Gates {@link CodeEditor.isForeignWheelTarget}'s tooltip carve-out on the
 * tooltip actually having somewhere to move, rather than on DOM shape or
 * extent alone — content that merely overflows a non-scrolling box (e.g. an
 * ellipsised completion row's `overflow-x: hidden`) reports extent without
 * being scrollable, and claiming a wheel over it would be just as inert as
 * claiming one with no overflow at all. A wheel claimed with nothing to
 * absorb it defeats an enclosing overlay's wheel trap (`core/WheelTrap.ts`):
 * the trap's `swallowUnconsumedWheel` stands down on any already-claimed
 * wheel, on the assumption that a claim means the gesture was actually
 * handled. Claiming a wheel over a non-scrollable tooltip (hover, lint), an
 * overflowing-but-not-scrolling element, or a completion list already at its
 * scroll bound would leave nothing to handle it while still disarming the
 * trap, letting the browser's own scroll chaining carry the gesture past the
 * trap to whatever real scroll container it finds next — potentially the
 * page behind a modal `Dialog` or `AbstractWindow`.
 *
 * @param handle - The element to read computed overflow and scroll metrics from.
 * @param e - The wheel event supplying the delta to check against.
 * @returns `true` if `handle` can move further in the direction `e` requests.
 */
function hasWheelExtent(handle: Handle, e: WheelEvent): boolean {
    const overflow = DOM.source.getComputedOverflow(handle);
    const metrics  = DOM.source.getScrollMetrics(handle);

    const scrollableY = overflow.overflowY === "auto" || overflow.overflowY === "scroll";
    const scrollableX = overflow.overflowX === "auto" || overflow.overflowX === "scroll";

    return (scrollableY && e.deltaY > 0 && metrics.scrollTop  + metrics.clientHeight < metrics.scrollHeight)
        || (scrollableY && e.deltaY < 0 && metrics.scrollTop  > 0)
        || (scrollableX && e.deltaX > 0 && metrics.scrollLeft + metrics.clientWidth  < metrics.scrollWidth)
        || (scrollableX && e.deltaX < 0 && metrics.scrollLeft > 0);
}

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
 * `CodeEditor`'s scope is highlighting, formatting, folding, search,
 * parser-level diagnostics (lint) and keyword/snippet completion — every one
 * of them bounded to what a grammar's own parse tree already knows. Anything
 * needing semantic understanding — cross-file symbols, type information,
 * hovers, go-to-definition, a real language server — or collaborative
 * editing is out of scope. CodeMirror's `EditorView` is a *foreign live widget*: it takes a real parent
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
 * Highlighting grammars, formatters and lint sources load lazily, per
 * language, through the registry in `LanguageRegistry.ts` (`registerLanguage`
 * / `getLanguage` / `listLanguages`) — see that module and `languages.ts` for
 * the seven built-in languages (JavaScript/TypeScript, JSON, HTML, SQL,
 * Markdown, CSS, Python).
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

    /** Reconfigured by {@link CodeEditor.setLineWrap} to toggle line wrapping. */
    private readonly _lineWrapCompartment: Compartment = new Compartment();

    /** Reconfigured by {@link CodeEditor.setPlaceholder}. */
    private readonly _placeholderCompartment: Compartment = new Compartment();

    /** Reconfigured by {@link CodeEditor.setHighlightWhitespace}. */
    private readonly _whitespaceCompartment: Compartment = new Compartment();

    /** Reconfigured by {@link CodeEditor.refreshLint}. */
    private readonly _lintCompartment: Compartment = new Compartment();

    /** Reconfigured by {@link CodeEditor.setTabSize}. */
    private readonly _tabSizeCompartment: Compartment = new Compartment();

    /** Reconfigured by {@link CodeEditor.setLineNumbers}. */
    private readonly _lineNumbersCompartment: Compartment = new Compartment();

    /** Reconfigured by {@link CodeEditor.setSpellcheck}. */
    private readonly _spellcheckCompartment: Compartment = new Compartment();

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
     * `[lines, docLength, clientWidth, foldedLines, wrapFlag]` as of the last
     * call to `syncAutoHeight`, or `null` before the first call. Used to tell
     * a genuine content/width change from a self-triggered geometry echo — a
     * growth is trusted only when this differs from the previous call, and
     * so is a content shrink of a pixel or more (a smaller, sub-pixel
     * content shrink is rounding noise regardless of this tuple). Folding and
     * toggling wrap both change the rendered height without moving the first
     * three components, so `foldedLines` / `wrapFlag` are what earn trust for
     * the resulting shrink or growth.
     */
    private _lastSyncedShape: readonly [number, number, number, number, number] | null = null;

    /**
     * Document lines currently hidden inside folded ranges, refreshed by the
     * update listener in {@link CodeEditor.mount} before it calls
     * {@link CodeEditor.syncAutoHeight}. Read there as a plain number rather
     * than recomputed from `foldedRanges(this._view.state)` inline, since
     * roughly twenty existing offline tests stub `_view.state` as a bare
     * `{ doc: { lines: n } }` object with no `field` method.
     */
    private _foldedLines = 0;

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
     * The document text as of the last clean point — the text this editor was
     * constructed with (re-taken from the mounted state in `mount`), or the
     * text `markClean()` last accepted. `onDocChange` compares against it to
     * decide the dirty flag, so an edit undone back to this text reports clean
     * again. Mirrors `ModelRecord._original`.
     */
    private _cleanValue: string;

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

        this._cleanValue = this.getValue();

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
        if (options.autoHeightMinRows !== undefined) this._options.autoHeightMinRows = options.autoHeightMinRows;
        if (options.lineWrap !== undefined) this._options.lineWrap = options.lineWrap;
        if (options.placeholder !== undefined) this._options.placeholder = options.placeholder;
        if (options.highlightWhitespace !== undefined) this._options.highlightWhitespace = options.highlightWhitespace;
        if (options.lint !== undefined) this._options.lint = options.lint;
        if (options.tabSize !== undefined) this._options.tabSize = options.tabSize;
        if (options.lineNumbers !== undefined) this._options.lineNumbers = options.lineNumbers;
        if (options.spellcheck !== undefined) this._options.spellcheck = options.spellcheck;

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
     * Accepts the current document as the clean text, clearing this editor's
     * dirty flag (and, through the framework's relay, every ancestor's,
     * unless another descendant is still dirty). Call it after the host has
     * persisted the document, or after loading one with `setValue`.
     * Persisting is the host's job — this method only reports state; it
     * writes nothing and does not change the document.
     *
     * The editor reports itself dirty whenever its document differs from the
     * clean text, so an edit that is undone back to that text clears the flag
     * on its own — and an undo that moves the document *away* from the text a
     * later `markClean()` accepted marks it dirty again.
     *
     * @returns This component, for method chaining.
     */
    markClean(): this {
        this._cleanValue = this.getValue();
        this.setDirty(false);

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
     * language id, so a rapid double-swap applies only the latest. Also
     * refreshes lint, resolving the new language's lint source (if any) and
     * reconfiguring the lint compartment, so switching language swaps the
     * diagnostics along with the grammar instead of leaving stale markers
     * from the previous language.
     *
     * @param id - A registered language id, or `null` to clear highlighting.
     * @returns This component, for method chaining.
     */
    setLanguage(id: string | null): this {
        this._options.language = id ?? undefined;

        if (!this._view) {
            return this;
        }

        this.refreshLint();

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
     * Resolves the active language's lint source (if any) and reconfigures
     * the lint compartment. Called from {@link CodeEditor.setLint} and
     * {@link CodeEditor.setLanguage} whenever a view is mounted; a no-op
     * otherwise (both callers already guard on `this._view`).
     *
     * Mirrors `setLanguage`'s async stale-guard: the resolved source is only
     * applied if `this._view` still exists, {@link CodeEditor.getLint} is
     * still `true`, and {@link CodeEditor.getLanguage} still equals the id
     * this call started for — so a rapid language or lint toggle applies only
     * the latest.
     */
    private refreshLint(): void {
        if (!this._view) {
            return;
        }

        if (!this.getLint()) {
            this._view.dispatch({ effects: this._lintCompartment.reconfigure([]) });

            return;
        }

        const id  = this.getLanguage();
        const def = id ? getLanguage(id) : undefined;

        if (!def?.loadLintSource) {
            this._view.dispatch({ effects: this._lintCompartment.reconfigure([]) });

            return;
        }

        void def.loadLintSource().then((source) => {
            if (this._view && this.getLint() && this.getLanguage() === id) {
                this._view.dispatch({
                    effects: this._lintCompartment.reconfigure([linter((view) => source(view.state)), lintGutter()]),
                });
            }
        });
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
     * Returns whether long lines currently wrap instead of scrolling
     * horizontally.
     *
     * @returns The lineWrap state.
     */
    getLineWrap(): boolean {
        return this._options.lineWrap ?? false;
    }

    /**
     * Sets whether long lines wrap instead of scrolling horizontally. Caches
     * the state; when a view is mounted, also reconfigures the line-wrap
     * compartment.
     *
     * @param wrap - Whether long lines should wrap.
     * @returns This component, for method chaining.
     */
    setLineWrap(wrap: boolean): this {
        this._options.lineWrap = wrap;

        if (this._view) {
            this._view.dispatch({ effects: this._lineWrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []) });
        }

        return this;
    }

    /**
     * Returns the text shown in an empty document.
     *
     * @returns The placeholder text, or `null` when unset.
     */
    getPlaceholder(): string | null {
        return this._options.placeholder ?? null;
    }

    /**
     * Sets (or clears) the text shown in an empty document. Caches the value;
     * when a view is mounted, also reconfigures the placeholder compartment.
     *
     * @param text - The placeholder text, or `null` to clear it.
     * @returns This component, for method chaining.
     */
    setPlaceholder(text: string | null): this {
        this._options.placeholder = text ?? undefined;

        if (this._view) {
            this._view.dispatch({ effects: this._placeholderCompartment.reconfigure(text ? placeholder(text) : []) });
        }

        return this;
    }

    /**
     * Returns whether spaces, tabs and trailing whitespace are currently
     * rendered visibly.
     *
     * @returns The highlightWhitespace state.
     */
    getHighlightWhitespace(): boolean {
        return this._options.highlightWhitespace ?? false;
    }

    /**
     * Sets whether spaces, tabs and trailing whitespace are rendered visibly.
     * Caches the state; when a view is mounted, also reconfigures the
     * whitespace compartment.
     *
     * @param highlight - Whether whitespace should render visibly.
     * @returns This component, for method chaining.
     */
    setHighlightWhitespace(highlight: boolean): this {
        this._options.highlightWhitespace = highlight;

        if (this._view) {
            this._view.dispatch({
                effects: this._whitespaceCompartment.reconfigure(
                    highlight ? [highlightWhitespace(), highlightTrailingWhitespace()] : []),
            });
        }

        return this;
    }

    /**
     * Returns whether parser-error diagnostics are currently shown.
     *
     * @returns The lint state.
     */
    getLint(): boolean {
        return this._options.lint ?? false;
    }

    /**
     * Sets whether parser-error diagnostics are shown. Caches the state;
     * when a view is mounted, also resolves the active language's lint
     * source (if any) and reconfigures the lint compartment. Inert for a
     * language with no lint source.
     *
     * @param lint - Whether diagnostics should be shown.
     * @returns This component, for method chaining.
     */
    setLint(lint: boolean): this {
        this._options.lint = lint;

        if (this._view) {
            this.refreshLint();
        }

        return this;
    }

    /**
     * Returns the current tab-stop width, in columns.
     *
     * @returns The configured tabSize, or `null` when unset (CodeMirror's own
     *   defaults apply: 4-column tab stops, a 2-space indent unit).
     */
    getTabSize(): number | null {
        return this._options.tabSize ?? null;
    }

    /**
     * Sets (or clears) the tab-stop width, in columns. Caches the value; when
     * a view is mounted, also reconfigures the tab-size compartment, setting
     * CodeMirror's `EditorState.tabSize` and `indentUnit` facets together so
     * rendered tab stops and Tab-key / auto-indent width agree.
     *
     * @param size - The tab-stop width in columns (should be a positive
     *   integer), or `null` to clear it and fall back to CodeMirror's own
     *   defaults.
     * @returns This component, for method chaining.
     */
    setTabSize(size: number | null): this {
        this._options.tabSize = size ?? undefined;

        if (this._view) {
            this._view.dispatch({
                effects: this._tabSizeCompartment.reconfigure(
                    size !== null ? [EditorState.tabSize.of(size), indentUnit.of(" ".repeat(size))] : []),
            });
        }

        return this;
    }

    /**
     * Returns whether the line-number gutter is currently shown.
     *
     * @returns The lineNumbers state.
     */
    getLineNumbers(): boolean {
        return this._options.lineNumbers ?? true;
    }

    /**
     * Sets whether the line-number gutter is shown. Caches the state; when a
     * view is mounted, also reconfigures the line-numbers compartment.
     *
     * @param show - Whether the gutter should be shown.
     * @returns This component, for method chaining.
     */
    setLineNumbers(show: boolean): this {
        this._options.lineNumbers = show;

        if (this._view) {
            this._view.dispatch({ effects: this._lineNumbersCompartment.reconfigure(show ? lineNumbers() : []) });
        }

        return this;
    }

    /**
     * Returns whether the browser's native spellcheck currently runs inside
     * the editor.
     *
     * @returns The spellcheck state.
     */
    getSpellcheck(): boolean {
        return this._options.spellcheck ?? false;
    }

    /**
     * Sets whether the browser's native spellcheck runs inside the editor.
     * Caches the state; when a view is mounted, also reconfigures the
     * spellcheck compartment, setting the DOM `spellcheck` attribute.
     *
     * @param spellcheck - Whether the browser's spellcheck should run.
     * @returns This component, for method chaining.
     */
    setSpellcheck(spellcheck: boolean): this {
        this._options.spellcheck = spellcheck;

        if (this._view) {
            this._view.dispatch({
                effects: this._spellcheckCompartment.reconfigure(
                    EditorView.contentAttributes.of({ spellcheck: spellcheck ? "true" : "false" })),
            });
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
     * Returns the row-count floor this editor never auto-shrinks below.
     *
     * @returns The configured {@link CodeEditorOptions.autoHeightMinRows}, or
     *   `null` when unset (no floor beyond the real content's own height).
     */
    getAutoHeightMinRows(): number | null {
        return this._options.autoHeightMinRows ?? null;
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
     * length for a formatter with no cursor map (sql-formatter). A formatter
     * result matching the document already held leaves it completely
     * untouched — no transaction, so no re-render, no undo entry, and no
     * `"change"` event. When the result does differ, the visible area no
     * longer unconditionally jumps to the top: it stays exactly in place
     * when nothing above it changed length, which is the common case for an
     * incremental edit-then-save, and can otherwise shift — by roughly
     * however much text the formatter added or removed above it, never all
     * the way back to the top — when a reformat changes text throughout the
     * document, e.g. a first-time format of a wholly unformatted file.
     * When `options` omits `indentWidth` and this editor's own tab-stop
     * width ({@link CodeEditor.getTabSize}) is set, the formatter runs with
     * `indentWidth` defaulted to it; an explicit `options.indentWidth`
     * always overrides this default, and it has no effect when `tabSize` is
     * unset.
     *
     * @param options - Style knobs forwarded to the active language's
     *   formatter. Ignored when the language has no formatter (the
     *   re-indent fallback runs instead). An omitted `indentWidth` is
     *   defaulted from this editor's own `tabSize`, when set — see
     *   `@remarks`.
     * @returns A promise that resolves once formatting completes, or rejects
     *   with the formatter's error.
     */
    async format(options?: FormatOptions): Promise<void> {
        const id  = this.getLanguage();
        const def = id ? getLanguage(id) : undefined;

        if (!def?.loadFormatter) {
            this.reindentFallback();

            return;
        }

        const formatter    = await def.loadFormatter();
        const source       = this.getValue();
        const cursorOffset = this._view ? this._view.state.selection.main.head : 0;

        const result = await formatter(source, cursorOffset, this.resolveFormatOptions(options));

        this.applyFormatted(result.formatted, result.cursorOffset);
    }

    /**
     * Resolves the effective `FormatOptions` passed to the formatter: an
     * explicit `options.indentWidth` always wins; when it is absent, this
     * editor's own tab-stop width ({@link CodeEditor.getTabSize}) fills it in,
     * if set, so a reformat's indent width matches what the live editor already
     * renders. Returns `options` unchanged — by reference — whenever no default
     * applies, so a caller that never touches `tabSize` sees exactly today's
     * behaviour.
     *
     * Factored out of `format()` so the merge is unit-testable in isolation,
     * mirroring how {@link CodeEditor.applyFormatted} and
     * {@link CodeEditor.reindentFallback} are factored out for the same reason.
     *
     * @param options - The caller-supplied format options, or `undefined`.
     * @returns `options` unchanged when no default applies, or a new object
     *   carrying every field of `options` plus the defaulted `indentWidth`.
     */
    private resolveFormatOptions(options?: FormatOptions): FormatOptions | undefined {
        const tabSize = this.getTabSize();

        if (options?.indentWidth !== undefined || tabSize === null) {
            return options;
        }

        return { ...options, indentWidth: tabSize };
    }

    /**
     * Applies a successful formatter result to the document: a whole-document
     * replace carrying the formatter's mapped cursor, plus a scroll snapshot so
     * the viewport stays where the user left it. A no-op when the formatter
     * returned text the document already holds — no transaction, so no
     * re-render, no undo entry, and no `"change"` event for a save that had
     * nothing to reformat.
     *
     * Factored out of `format()` so the apply-or-skip decision, and the
     * dispatched transaction's shape, are unit-testable against an injected
     * duck-typed view (mirroring `reindentFallback`'s extraction); only the
     * rendered result of a real CodeMirror view applying the transaction —
     * whether the visible area actually holds still — is manual-verify only.
     *
     * @param formatted - The formatter's output text.
     * @param cursorOffset - The formatter's cursor offset into `formatted`.
     */
    private applyFormatted(formatted: string, cursorOffset: number): void {
        if (formatted === this.getValue()) {
            return;
        }

        this._options.value = formatted;

        if (!this._view) {
            return;
        }

        // Taken before the dispatch, while the view still holds the old
        // document: `scrollSnapshot()` reads the live scroller offset and the
        // document position sitting at the top of the visible area. Without it,
        // CodeMirror maps its own scroll anchor through the change set below,
        // which sends every position in a whole-document replace to 0, and the
        // next measurement pass scrolls the viewport to the top.
        const scrollSnapshot = this._view.scrollSnapshot();

        this._view.dispatch({
            changes:   { from: 0, to: this._view.state.doc.length, insert: formatted },
            selection: { anchor: Math.min(cursorOffset, formatted.length) },
            effects:   scrollSnapshot,
        });
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
     * Applies a document change from the live CodeMirror view: caches the new
     * text, flags the editor dirty, then emits `"change"`. Factored out of the
     * update listener in `mount()` so the offline harness — where no
     * `EditorView` ever mounts — can drive the same path directly, mirroring
     * how `reindentFallback` is factored out of `format()`.
     *
     * @param value - The new document text.
     */
    private onDocChange(value: string): void {
        this._options.value = value;
        // Dirty before the emit, so a `"change"` listener that queries
        // isDirty() sees the settled value. `setDirty` is idempotent, so
        // calling it on every change costs nothing when nothing flipped.
        this.setDirty(value !== this._cleanValue);
        this.emit("change", { value });
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
     * Carves CodeMirror's own tooltips (the completion list, hover and lint
     * tooltips) out of the framework's eased wheel scroller — but only when a
     * scrollable descendant genuinely has somewhere to move, per
     * {@link hasWheelExtent}. CodeMirror parents every tooltip inside
     * `.cm-editor` with no `parent` configured, so they sit in this
     * component's subtree and would otherwise have their wheel claimed by
     * {@link Component.onWheelScroll} — stranding the completion list's own
     * native, browser-driven scroll. A non-scrollable tooltip, or a
     * completion list already at its scroll bound, reports `false` instead,
     * so the wheel falls through to the normal claim-and-prevent path rather
     * than being claimed with nothing to actually absorb it — see
     * {@link hasWheelExtent}'s doc for why an inert claim matters.
     *
     * @param e - The wheel event being routed.
     * @returns `true` when `e`'s target climbs to a `.cm-tooltip` ancestor
     *   with scroll room left, before reaching this component's own element.
     *
     * @remarks The climb itself only calls `DOM.source.matches` — the same
     * cheap, bounded walk as the base carve-out pattern — and defers every
     * `hasWheelExtent` check (a `getComputedStyle` read plus a layout-forcing
     * `getScrollMetrics` read) until a `.cm-tooltip` is actually found. An
     * ordinary wheel over editor content, the overwhelming majority of ticks,
     * pays only the `matches` cost; the extent checks run at most once per
     * handle already walked, and only when a tooltip is present at all.
     */
    protected isForeignWheelTarget(e: WheelEvent): boolean {
        if (!DOM.source.isNode(e.target)) {
            return false;
        }

        const root = this.getElement();
        const climbed: Handle[] = [];

        for (let handle: Handle | null = DOM.source.intern(e.target); handle; handle = DOM.source.getParentElement(handle)) {
            climbed.push(handle);

            if (DOM.source.matches(handle, CM_TOOLTIP_SELECTOR)) {
                return climbed.some((climbedHandle) => hasWheelExtent(climbedHandle, e));
            }

            if (handle === root) {
                return false;
            }
        }

        return false;
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
            keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap, ...closeBracketsKeymap, indentWithTab]),
            drawSelection(),
            highlightActiveLine(),
            highlightActiveLineGutter(),
            indentOnInput(),
            bracketMatching(),
            codeFolding(),
            foldGutter(),
            highlightSpecialChars(),
            dropCursor(),
            rectangularSelection(),
            crosshairCursor(),
            EditorState.allowMultipleSelections.of(true),
            search(),
            highlightSelectionMatches(),
            // completionKeymap is deliberately not added to the keymap array
            // above: autocompletion() installs it itself, at Prec.highest, so
            // adding it again here would bind the same keys at a lower
            // precedence. closeBrackets() is not self-installing, so its
            // Backspace binding (closeBracketsKeymap) is added explicitly.
            autocompletion(),
            closeBrackets(),
            this._readOnlyCompartment.of(buildReadOnlyExtension(this.getReadOnly())),
            this._themeCompartment.of(codeEditorTheme(dark)),
            this._langCompartment.of([]),
            this._lineWrapCompartment.of(this.getLineWrap() ? EditorView.lineWrapping : []),
            this._placeholderCompartment.of(this.getPlaceholder() ? placeholder(this.getPlaceholder()!) : []),
            this._whitespaceCompartment.of(
                this.getHighlightWhitespace() ? [highlightWhitespace(), highlightTrailingWhitespace()] : []),
            // Left empty here rather than seeded from getLint(): an editor
            // mounted with a language runs setLanguage(language) a few lines
            // below, which calls refreshLint() itself; one mounted without a
            // language has nothing to lint, so [] is already right.
            this._lintCompartment.of([]),
            this._tabSizeCompartment.of(
                this.getTabSize() !== null
                    ? [EditorState.tabSize.of(this.getTabSize()!), indentUnit.of(" ".repeat(this.getTabSize()!))]
                    : []),
            this._lineNumbersCompartment.of(this.getLineNumbers() ? lineNumbers() : []),
            this._spellcheckCompartment.of(
                EditorView.contentAttributes.of({ spellcheck: this.getSpellcheck() ? "true" : "false" })),
            EditorView.updateListener.of((update) => {
                if (update.docChanged) {
                    this.onDocChange(update.state.doc.toString());
                }

                this._foldedLines = this.countFoldedLines(update.state);

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

        // EditorState.create splits the document on line endings and
        // doc.toString() rejoins with "\n", normalizing CRLF text to LF. The
        // editor is always clean at mount (only the live view's update
        // listener can mark it dirty), so re-taking the clean text from the
        // state it just built keeps both sides of the onDocChange comparison
        // in the same normalized form.
        this._cleanValue = state.doc.toString();

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
        // measurement explicitly rather than assuming it does. Deferred one
        // further layout flush past `mount()` itself — live-confirmed via a
        // Dialog-hosted editor constructed already holding real (pre-set)
        // content: read synchronously here, `.cm-scroller`'s metrics can
        // still reflect CodeMirror's own not-yet-rendered initial paint (a
        // near-zero height), which then locks in permanently, since only a
        // genuine later document-shape change re-earns trust for a shrink or
        // regrowth (see `syncAutoHeight`'s own doc). One more flush gives
        // CodeMirror's construction a full frame to settle before the first
        // number gets committed — the same "construction-time size needs one
        // more settled pass" concern `Dialog.open()`'s own post-open
        // `resizeToContent` re-fit already exists for.
        Component.afterNextLayout(() => this.syncAutoHeight());
    }

    /**
     * The document's true rendered height: `.cm-content`'s top to its last
     * child's bottom, plus the document's bottom padding. Immune to
     * `.cm-content`'s `min-height: 100%` because that stretch trails *after*
     * the last child, and correct under folding, wrapping, and CodeMirror's
     * viewport virtualisation (out-of-viewport regions are `.cm-gap` widget
     * elements with explicit heights, themselves element children of
     * `.cm-content`).
     *
     * @returns The measured extent in pixels, or `null` when nothing is
     *   resolvable (offline, pre-mount, or no rendered content), so the
     *   caller can fall back to the per-row estimate.
     */
    private measureContentExtent(): number | null {
        if (!this._contentElement || !this._view) {
            return null;
        }

        const lastBlock = DOM.source.querySelector(this._contentElement, CM_LAST_BLOCK_SELECTOR);

        if (!lastBlock) {
            return null;
        }

        const contentTop  = DOM.source.getElementRect(this._contentElement).top;
        const blockBottom = DOM.source.getElementRect(lastBlock).bottom;

        return blockBottom - contentTop + this._view.documentPadding.bottom;
    }

    /**
     * Counts the document lines hidden by folds. Pure over the state — no
     * DOM, no view — so it is directly unit-testable against a real
     * `EditorState`.
     *
     * @param state - The editor state to count folded lines in.
     * @returns The number of document lines currently hidden inside folded ranges.
     */
    private countFoldedLines(state: EditorState): number {
        let hidden = 0;

        foldedRanges(state).between(0, state.doc.length, (from, to) => {
            hidden += state.doc.lineAt(to).number - state.doc.lineAt(from).number;
        });

        return hidden;
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
     * the same way — from the live line count, not `defaultLineHeight` —
     * except while {@link CodeEditor.getLineWrap} is on, where a `.cm-line`'s
     * own rect no longer measures one row (see `perRowHeight` below).
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

        const padding = this._view.documentPadding.top + this._view.documentPadding.bottom;

        // A single rendered `.cm-line`'s own height — immune to `.cm-content`'s
        // `min-height: 100%` self-referential floor (see SUBPIXEL_HEIGHT_SLOP_PX's
        // comment on that same mechanism). Deriving this from `metrics.scrollHeight
        // / doc.lines` instead falls into exactly that trap once any earlier call
        // has already floored or capped the box taller than its real content:
        // `scrollHeight` then reports the PARENT's stretched height, not the
        // genuine per-line extent, so dividing by the (changing) line count feeds
        // a corrupted value into `floorPx`/`capPx` below, which commits a new
        // wrong height, which corrupts the next call's reading in turn —
        // live-confirmed to explode a short document's editor to 200,000+px
        // within a handful of keystrokes. An individual `.cm-line` element's own
        // rect is untouched by that stretch (the extra space `min-height: 100%`
        // adds trails AFTER the last line, never distributed into the lines
        // themselves), so it stays accurate regardless of how the box around it
        // has been floored or capped by a previous call. Falls back to the old
        // formula only when no line is rendered yet — always true for a mounted,
        // laid-out editor (even an empty document renders one empty `.cm-line`),
        // so this is a defensive floor, not an expected path.
        const lineElement  = this._contentElement && DOM.source.querySelector(this._contentElement, CM_LINE_SELECTOR);
        // A `.cm-line` is exactly one row tall only while wrapping is off. With
        // wrapping on it is as tall as the rows it wraps to, so the per-row unit
        // comes from CodeMirror's own default line height instead.
        const perRowHeight = this.getLineWrap() && this._view.defaultLineHeight > 0
            ? this._view.defaultLineHeight
            : (lineElement ? DOM.source.getElementRect(lineElement).height
                           : (metrics.scrollHeight - padding) / this._view.state.doc.lines);
        const capPx        = perRowHeight * maxRows + padding;
        const minRows      = this.getAutoHeightMinRows();
        const floorPx      = minRows !== null ? perRowHeight * minRows + padding : 0;

        // The document's genuine content height, built purely from the
        // per-line measurement above times the current line count —
        // deliberately NOT `metrics.scrollHeight` itself, which suffers the
        // exact same `.cm-content` self-referential floor `perRowHeight`
        // above was rescued from: once an earlier call has committed a
        // taller box, `scrollHeight` can never report less than that
        // committed height, no matter how many lines are later deleted.
        // Live-confirmed: removing rows back down well under a previously
        // reached height left the box permanently stuck at its tallest-ever
        // size, because `Math.min(metrics.scrollHeight, capPx)` below never
        // saw a smaller number to shrink toward — shrinking was reported as
        // a "shape change" (`doc.lines` genuinely differs) and so was never
        // blocked by the shrink-noise guard in the `else` branch below; the
        // content-height reading it trusted was simply never smaller.
        // `perRowHeight * lines + padding` carries no memory of the box's
        // own height, so it reports the correct, smaller figure the moment a
        // line is removed. Identical to `metrics.scrollHeight` on the
        // fallback path above (same two terms, rearranged), so that path's
        // behaviour is unchanged. Used only as a fallback now:
        // `measureContentExtent()` is tried first, since (unlike this
        // formula) it stays correct under folding and wrapping, neither of
        // which `doc.lines` reflects; it resolves to `null` offline and
        // before `.cm-content` has rendered any children, which is when this
        // formula still applies.
        const naturalContentHeight = this.measureContentExtent()
            ?? (perRowHeight * this._view.state.doc.lines + padding);

        let contentDesired = Math.max(Math.min(naturalContentHeight, capPx), floorPx);

        if (pureSelectionChange && contentDesired > this.getHeight()) {
            return;
        }

        const shape = [this._view.state.doc.lines, this._view.state.doc.length, metrics.clientWidth, this._foldedLines, this.getLineWrap() ? 1 : 0] as const;
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
            if (naturalContentHeight <= capPx && this._contentElement) {
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
            // `previousHeight` is already correct. `setAutoHeight` no-ops when the
            // box is already at `desired`, which is the case on the `!shapeChanged`
            // path where no probe was committed.
            this.setAutoHeight(desired);

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

        this.setAutoHeight(desired);
        this.emit("heightchange", { height: desired });
    }

    /**
     * Commits an auto-height result: the actual box height, and — since
     * {@link Component.getPreferredSize} always defers to this component's
     * layout manager rather than its current size (`getLayoutManager()` never
     * returns null; it defaults to an empty `Absolute`, whose own
     * `getPreferredSize()` answers `null` for a foreign-DOM leaf like this one
     * with no framework-tracked children) — the matching explicit preferred-size
     * override, so an ancestor computing ITS OWN preferred size (a `VBox`
     * summing children's `getPreferredSize()`, feeding {@link Dialog.resizeToContent})
     * actually sees this editor's current auto-height instead of always reading
     * `null` and silently contributing nothing. Width mirrors the editor's own
     * current width (parent-driven, not something this method computes) rather
     * than a stale or arbitrary value.
     *
     * @param px - The height in pixels to commit.
     */
    private setAutoHeight(px: number): void {
        this.setHeight(px);
        this.setPreferredSize({ width: this.getWidth(), height: px });
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
                // Above CodeMirror's sticky line-number gutter (z-index 200) and its
                // own panels (search, lint — z-index 300) so the wash covers both;
                // `.cm-editor` forms no stacking context, so either would otherwise
                // paint over a lower overlay.
                zIndex:        "400",
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
