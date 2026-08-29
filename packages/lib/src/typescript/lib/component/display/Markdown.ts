// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { ThemeManager } from "~/core/Theme.js";
import { callable } from "~/core/Callable.js";
import { Size } from "~/primitive/Size.js";
import { lexer } from "marked";
import type { Token, Tokens } from "marked";
// Type-only: erased at compile time. `CodeEditor` itself is loaded through a
// narrow dynamic import (see `loadCodeEditorUpgrade`) so a static top-level
// value import here would force every `Markdown` consumer's bundler to
// resolve CodeMirror the moment it imports `Markdown` at all.
import type { CodeEditor } from "~/component/editor/CodeEditor.js";

/**
 * Shared class names for the prose elements built by {@link Markdown}. Kept as
 * constants so the render helpers and the module-level rule builder reference
 * the same strings.
 */
const CODE_CLASS  = "ts-ui-md-code";
const PRE_CLASS   = "ts-ui-md-pre";
const QUOTE_CLASS = "ts-ui-md-quote";
const LIST_CLASS  = "ts-ui-md-list";
const LINK_CLASS  = "ts-ui-md-link";
const HEADING_CLASS = "ts-ui-md-heading";
const TABLE_WRAP_CLASS   = "ts-ui-md-table-wrap";
const TABLE_CLASS        = "ts-ui-md-table";
const TH_CLASS            = "ts-ui-md-th";
const TD_CLASS            = "ts-ui-md-td";
const ALIGN_LEFT_CLASS   = "ts-ui-md-align-left";
const ALIGN_CENTER_CLASS = "ts-ui-md-align-center";
const ALIGN_RIGHT_CLASS  = "ts-ui-md-align-right";
/**
 * Wraps a fenced block that upgrades to a live `CodeEditor`. `position:
 * relative` gives the absolutely-positioned `CodeEditor` child a local
 * positioning context wherever the block sits in the token tree (top-level,
 * inside a blockquote, inside a list item) — without it, the editor would
 * resolve `top`/`left` against `Markdown`'s own root instead.
 */
const CODE_HOST_CLASS = "ts-ui-md-code-host";

// Markdown heading levels span h1..h6; a deeper `#######` run is not a heading
// in CommonMark, but clamp anyway so a stray `depth` never mints an invalid tag.
const HEADING_MIN_DEPTH = 1;
const HEADING_MAX_DEPTH = 6;

/**
 * Maps a fenced code block's info-string language (lowercased, first word) to
 * the [`CodeEditor`](/components/CodeEditor) registry id it upgrades to. Only
 * the five ids `languages.ts` registers are
 * reachable; every other alias, and any language with no registered editor
 * support, is intentionally absent — {@link mapFenceLangToEditorId} returns
 * `null` for those rather than guessing, since passing an unregistered id to
 * `CodeEditor` would silently render unhighlighted text.
 */
const FENCE_LANG_ALIASES: Record<string, string> = {
    js: "javascript", javascript: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    ts: "javascript", typescript: "javascript", tsx: "javascript",
    json: "json",
    html: "html", htm: "html",
    sql: "sql",
    md: "markdown", markdown: "markdown",
};

/**
 * Cap on how many rows a fenced block's upgraded CodeEditor grows to before
 * its own vertical scrollbar takes over, rather than the wrapper continuing
 * to grow — keeps one long fenced block from pushing the rest of the prose
 * far down the page. Not a theme token: this is the only call site that
 * needs it, and BaseTheme.ts has no existing "row count" token shape to
 * extend (see Architecture Decisions).
 */
const CODE_BLOCK_MAX_AUTO_ROWS = 20;

/**
 * Threshold, in pixels, for warning when a fenced block's `CodeEditor`
 * corrects its mount-time guessed height (measured from the plain-text
 * placeholder `<pre>`) to CodeMirror's real, measured content height. Two
 * live reproductions of a "spasms and never settles" report measured this
 * correction at 20px and 29px on an ordinary page — this sits above that
 * noise floor's sub-pixel/fractional rounding (CodeMirror's own line
 * metrics can report fractional heights like 19.5938px) while still
 * catching either measured case, so a future report of the same shape
 * comes with hard numbers instead of a cold trail.
 */
const GUESS_HEIGHT_CORRECTION_WARN_PX = 8;

/**
 * How many viewport-heights below the fold a fenced block's `CodeEditor`
 * upgrade starts before scrolling actually reaches it (see
 * {@link Markdown.isBlockNearViewport}) — applied below the fold only, never
 * above. One viewport-height is roughly 1.5 seconds of runway at a typical
 * 900px pane and 60fps scroll speed: enough that a reader scrolling down
 * never catches an unhighlighted block, while costing at most a screenful of
 * extra upgrades over the strict minimum. A fixed pixel margin was rejected
 * because it would make a tall monitor prefetch proportionally less.
 */
const CODE_UPGRADE_LOOKAHEAD_VIEWPORTS = 1;

/**
 * Resolves a fenced code block's info-string language to the `CodeEditor`
 * registry id it should upgrade to, per {@link FENCE_LANG_ALIASES}.
 *
 * @param lang - The fence's info string as reported by `marked` (e.g. `"js"`,
 *   `"ts {1,3}"`), or `undefined` when the fence carries none.
 * @returns The mapped `CodeEditor` language id, or `null` when `lang` is
 *   unset or names a language with no registered editor support — the caller
 *   treats both identically (render the plain `<pre>`).
 */
function mapFenceLangToEditorId(lang: string | undefined): string | null {
    if (!lang) {
        return null;
    }

    // Only the first whitespace-delimited word is the language token per
    // CommonMark; a shebang-style modifier after it (`js {1,3}`) must not
    // defeat the match.
    const word = lang.trim().split(/\s+/, 1)[0]?.toLowerCase();

    return word ? (FENCE_LANG_ALIASES[word] ?? null) : null;
}

let _classRulesEnsured = false;

/**
 * Injects the shared prose class rules on first use. Idempotent — guarded by the
 * module-level `_classRulesEnsured` flag, mirroring `Glyph`'s keyframe singleton.
 *
 * @remarks Presentation references the framework theme tokens actually used by
 * the rules — `--ts-ui-font-mono` (code/pre font), `--ts-ui-border-radius`
 * (code/pre corners), `--ts-ui-border-color` (the blockquote bar), and the
 * accent `--ts-ui-indicator-focus` (link colour) — each with a fallback that
 * works in both light and dark themes; the code/pre background is a theme-neutral
 * translucent grey wash rather than a token, since no surface token exists. Every
 * spacing constant is genuine structural spacing (a code padding, a list marker
 * gutter, a blockquote bar), expressed in `em` so it scales with the surrounding
 * font — not a cosmetic inset.
 */
function ensureMarkdownClassRules(): void {
    if (_classRulesEnsured) {
        return;
    }

    _classRulesEnsured = true;

    new StyleRule({
        scope:  "class",
        name:   CODE_CLASS,
        styles: {
            fontFamily:   "var(--ts-ui-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
            // Translucent grey wash reads as "code" on both light and dark
            // backgrounds without needing a dedicated surface token.
            background:   "rgba(127, 127, 127, 0.16)",
            borderRadius: "var(--ts-ui-border-radius, 3px)",
            // Snug em-relative padding so the wash hugs inline code glyphs.
            padding:      "0.1em 0.3em",
            // Reset the prose line-height the root sets for reading — code reads
            // as fixed-width text, not continuous prose.
            lineHeight:   "normal",
        },
    });

    new StyleRule({
        scope:  "class",
        name:   PRE_CLASS,
        styles: {
            fontFamily:   "var(--ts-ui-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
            background:   "rgba(127, 127, 127, 0.16)",
            borderRadius: "var(--ts-ui-border-radius, 3px)",
            // Block padding gives the fenced code room; it is the code frame's
            // structural inset, not a visual nudge.
            padding:      "0.6em 0.8em",
            // Preserve authored whitespace/newlines and scroll long lines rather
            // than reflow them.
            whiteSpace:   "pre",
            overflow:     "auto",
            // Reset the prose line-height the root sets for reading — fenced
            // code reads as fixed-width text, not continuous prose.
            lineHeight:   "normal",
        },
    });

    new StyleRule({
        scope:  "class",
        name:   QUOTE_CLASS,
        styles: {
            // 3px quote bar — the framework's thin-border weight — plus an
            // em-relative gutter that indents the quoted prose off the bar.
            borderLeft:  "3px solid var(--ts-ui-border-color, rgba(127, 127, 127, 0.4))",
            paddingLeft: "1em",
            marginLeft:  "0",
        },
    });

    new StyleRule({
        scope:  "class",
        name:   LIST_CLASS,
        // Room for the list marker; structural indentation, em-relative so it
        // tracks the font size.
        styles: { paddingLeft: "1.5em" },
    });

    new StyleRule({
        scope:  "class",
        name:   LINK_CLASS,
        // The framework's single accent hue (shared with focus/selection).
        styles: { color: "var(--ts-ui-indicator-focus, #2563eb)" },
    });

    new StyleRule({
        scope:  "class",
        name:   HEADING_CLASS,
        // Semibold so headings read as headings independent of any UA-style
        // reset the host page may apply.
        styles: { fontWeight: "600" },
    });

    new StyleRule({
        scope:  "class",
        name:   TABLE_WRAP_CLASS,
        // A table's columns cannot reflow below their content width, so the
        // wrapper scrolls horizontally instead of letting the table spill
        // past the component's assigned width — the same story fenced code
        // already tells with its own frame.
        styles: { maxWidth: "100%", overflowX: "auto" },
    });

    new StyleRule({
        scope:  "class",
        name:   TABLE_CLASS,
        styles: { borderCollapse: "collapse" },
    });

    new StyleRule({
        scope:  "class",
        name:   TH_CLASS,
        styles: {
            border:     "1px solid var(--ts-ui-border-color, rgba(127, 127, 127, 0.4))",
            // Structural cell padding, em-relative so it tracks the font size.
            padding:    "0.3em 0.6em",
            fontWeight: "600",
            // Overrides the browser's centred <th> default so an unaligned
            // header cell reads left, matching its unaligned body cells.
            textAlign:  "left",
        },
    });

    new StyleRule({
        scope:  "class",
        name:   TD_CLASS,
        styles: {
            border:  "1px solid var(--ts-ui-border-color, rgba(127, 127, 127, 0.4))",
            padding: "0.3em 0.6em",
        },
    });

    new StyleRule({
        scope:  "class",
        name:   ALIGN_LEFT_CLASS,
        styles: { textAlign: "left" },
    });

    new StyleRule({
        scope:  "class",
        name:   ALIGN_CENTER_CLASS,
        styles: { textAlign: "center" },
    });

    new StyleRule({
        scope:  "class",
        name:   ALIGN_RIGHT_CLASS,
        styles: { textAlign: "right" },
    });

    new StyleRule({
        scope:  "class",
        name:   CODE_HOST_CLASS,
        styles: { position: "relative" },
    });
}

/**
 * Maps marked's per-column alignment to the class that applies it.
 *
 * @param align - The column's alignment, as reported per-cell by marked's
 *   table token.
 * @returns The alignment class, or `null` when the column carries no
 *   alignment marker.
 */
function alignmentClass(align: "center" | "left" | "right" | null): string | null {
    switch (align) {
        case "left":   return ALIGN_LEFT_CLASS;
        case "center": return ALIGN_CENTER_CLASS;
        case "right":  return ALIGN_RIGHT_CLASS;
        default:       return null;
    }
}

/**
 * GitHub/VitePress-compatible slug: lowercase, non-alphanumerics collapsed to
 * single hyphens, ends trimmed. Does not dedupe — the caller folds in a `-N`
 * suffix via a per-render counter so every id on the page is unique.
 *
 * @param text - The heading's plain text.
 * @returns The slug, with no leading, trailing, or doubled hyphens.
 */
function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/**
 * Shared by {@link Markdown.appendHeading} and {@link extractMarkdownHeadings}
 * — the single place a heading's slug is deduped against ids already used
 * earlier in the same render/extraction pass, so both produce identical ids
 * from identical inputs.
 *
 * @param text - The heading's plain text.
 * @param headingIds - The current pass's dedupe counter, keyed by slug.
 * @returns The slug, suffixed with `-N` when it was already seen this pass.
 */
function nextHeadingId(text: string, headingIds: Map<string, number>): string {
    const slug = slugify(text);
    const seen = headingIds.get(slug) ?? 0;

    headingIds.set(slug, seen + 1);

    return seen === 0 ? slug : `${slug}-${seen}`;
}

/**
 * How a link href should be rendered: the final href, and whether it leaves
 * the site the {@link Markdown} instance is embedded in.
 *
 * @category Components
 */
export interface MarkdownLinkResolution {
    href:     string;
    external: boolean;
}

/**
 * Maps an authored Markdown href to its rendered form. See
 * {@link MarkdownOptions.linkResolver}.
 *
 * @category Components
 */
export type MarkdownLinkResolver = (href: string) => MarkdownLinkResolution;

/**
 * The default {@link MarkdownLinkResolver}: every href is rendered exactly as
 * authored and marked external, reproducing the component's pre-`linkResolver`
 * behaviour (`target="_blank" rel="noopener noreferrer"` on every link).
 *
 * @param href - The authored link href.
 * @returns The href unchanged, marked external.
 */
function defaultLinkResolver(href: string): MarkdownLinkResolution {
    return { href, external: true };
}

/**
 * Construction-time options for {@link Markdown}.
 *
 * @category Components
 */
export interface MarkdownOptions extends ComponentOptions {
    /** The Markdown source string to render. */
    markdown?: string;

    /**
     * Maps an authored link href to its rendered form. Defaults to a resolver
     * that renders every href unchanged and marks it external, preserving
     * today's behaviour (every link opens in a new tab). A consumer embedding
     * `Markdown` in an app with its own routing (e.g. a docs site) can rewrite
     * in-site hrefs and suppress the new tab for them, while leaving external
     * links external.
     */
    linkResolver?: MarkdownLinkResolver;

    /**
     * Per-instance override of the prose column's max width (e.g. `"60ch"`,
     * `60`). `null` or omitted uses the theme's `--ts-ui-md-max-measure`
     * default.
     */
    maxMeasure?: string | number | null;

    /**
     * Multiplies the prose's base font size; headings scale with it via their
     * own relative sizing. Default `1`.
     */
    fontScale?: number;
}

/**
 * The fixed identity of one fenced block's pending upgrade — the placeholder
 * handles it will replace, its literal text and mapped language, and the
 * render generation it belongs to (see {@link Markdown._renderGeneration}).
 * Shared shape between {@link QueuedCodeUpgrade} (waiting on visibility,
 * import not yet started) and {@link PendingCodeUpgrade} (import already
 * resolved, still waiting on visibility to apply).
 */
interface CodeUpgradeIdentity {
    wrapper: Handle;
    pre:     Handle;
    code:    Handle;
    text:    string;
    languageId: string;
    generation: number;
}

/**
 * A supported-language fenced block whose `CodeEditor` dynamic import has not
 * started yet because `Markdown` was not effectively visible when its
 * deferred kickoff (queued by {@link Markdown.appendCode} through
 * `onFirstLayout`) ran. Flushed by {@link Markdown.onEffectiveVisibilityChange}
 * once visibility flips to `true` — edge-triggered, not polled, mirroring
 * `Canvas.onEffectiveVisibilityChange`'s animation-loop reconcile.
 */
type QueuedCodeUpgrade = CodeUpgradeIdentity;

/**
 * A supported-language fenced block still waiting for `CodeEditor` to
 * become visible after its dynamic import already resolved (queued by
 * {@link Markdown.loadCodeEditorUpgrade} when the import settles while
 * `Markdown` is not effectively visible).
 */
interface PendingCodeUpgrade extends CodeUpgradeIdentity {
    // Constructor type built from the type-only `CodeEditor` import — `typeof
    // CodeEditor` is not available here because the value itself is never
    // statically imported.
    CodeEditorClass: new (
        value: string,
        options: { readOnly: true; language: string; autoHeightMaxRows?: number },
    ) => CodeEditor;
}

// Rendered prose is read-only content the reader copies (a code sample, an
// error message, a changelog entry), not interactive UI chrome, so it opts out
// of the framework's unselectable default and shows a text cursor. `Markdown`'s
// children are raw DOM nodes rather than `Component`s, so they carry no
// `user-select` or `cursor` of their own and inherit both from the root. As
// class defaults these land on the shared `.Markdown` rule instead of every
// instance's own `#id` rule.
const _defaultMarkdownOptions: Partial<MarkdownOptions> = { userSelect: "text", cursor: "text" };

/**
 * A display component that renders a Markdown source string as a live DOM
 * subtree.
 *
 * @remarks
 * Parsing uses the `marked` library's lexer only (`marked.lexer(src)`): the
 * component walks the returned token AST and builds every prose element
 * (`<h1>`–`<h6>`, `<p>`, `<ul>`/`<ol>`/`<li>`, `<blockquote>`, `<pre>`/`<code>`,
 * `<strong>`, `<em>`, `<a>`, `<table>`) through the DOM sink. There is no
 * HTML-string assignment path, so untrusted Markdown can never inject markup,
 * and the render runs against the modelled DOM source in tests.
 *
 * The v1 token set covers headings, paragraphs, ordered/unordered lists,
 * blockquotes, fenced/inline code, bold, italic, links, and GFM pipe tables
 * (including per-column alignment). Any other token type (images, raw HTML,
 * the remaining GFM extensions) falls through to a defined fallback that
 * renders the token's plain text — never a crash, never markup.
 *
 * A fenced code block whose info string names a language
 * [`CodeEditor`](/components/CodeEditor) has a registered grammar for
 * (`js`/`ts`/`json`/`html`/`sql`/`markdown`, plus aliases) upgrades from the
 * plain `<pre>` to a live, read-only, syntax-highlighted `CodeEditor` once it
 * loads; an unrecognised language, or no info string, keeps the plain
 * `<pre>`. The upgrade is lazy in two ways —
 * `CodeEditor`'s CodeMirror dependency loads through a dynamic import that
 * fires only when a fenced block actually needs it, deferred until this
 * component's first connected, displayed layout, and further deferred per
 * block until its wrapper comes within one viewport-height of the visible
 * area — so a `Markdown` with no fenced code (or only unsupported languages)
 * pays no extra bundle cost, and a long document upgrades only the blocks
 * the reader actually scrolls to.
 *
 * Links render as plain `<a href target="_blank" rel="noopener noreferrer">`
 * with native navigation; the component exposes no event surface in v1.
 *
 * Wrapping and scrolling. The prose wraps to the width it is assigned —
 * paragraphs reflow at word boundaries and overlong unbreakable tokens (URLs)
 * break, so content never overflows horizontally; fenced code blocks instead
 * preserve their lines and scroll inside their own frame. Because prose reflows,
 * the component measures its rendered content height at the assigned width and
 * reports it through {@link Markdown.getMinSize} / {@link Markdown.getPreferredSize},
 * so it grows a size-negotiating scroll host to the full prose height — drop one
 * in a vertically-scrolling [`Panel`](/api/component/container/classes/Panel)
 * (`setAutoScroll("y")`) and it scrolls. The height is re-measured on content,
 * width, and theme change; only the height axis is derived (the width stays
 * freely assignable). The measured height is reported as a *minimum*, so an
 * explicit `preferredSize`/`setMinSize` taller than the content still wins; to
 * cap the component below its content, give it a bounded scroll host.
 *
 * @example
 * ```typescript
 * import { Markdown } from '@jimka/typescript-ui/component/display';
 *
 * panel.addComponent(new Markdown('# Title\n\nSome **bold** text.'));
 * ```
 *
 * @category Components
 */
class Markdown extends Component<MarkdownOptions> {

    /**
     * Raw child nodes built into the root through the sink. Tracked so they are
     * released with the component and torn down / rebuilt on {@link setMarkdown}.
     */
    private _contentHandles: Handle[] = [];

    /**
     * Measured content height in px (outer/border-box), cached as per-instance
     * derived state — intrinsic runtime bookkeeping, so it lives here rather than
     * in {@link MarkdownOptions}. `null` until the first measure records it; folded
     * into {@link getMinSize} / {@link getPreferredSize} to drive a scroll host.
     */
    private _measuredHeight: number | null = null;

    /** Handle to detach the {@link ThemeManager.onThemeChange} listener on {@link dispose}. */
    private readonly _unsubscribeTheme: () => void;

    /** Live `CodeEditor` upgrades, raw-DOM-appended per fenced block; see {@link applyCodeEditorUpgrade}. */
    private _codeEditors: Array<{ editor: CodeEditor; wrapper: Handle }> = [];

    /** Supported-language fenced blocks still waiting to upgrade; see {@link PendingCodeUpgrade}. */
    private _pendingCodeUpgrades: PendingCodeUpgrade[] = [];

    /**
     * Supported-language fenced blocks whose dynamic import hasn't started
     * because `Markdown` wasn't effectively visible when their deferred
     * kickoff ran; see {@link QueuedCodeUpgrade} and
     * {@link onEffectiveVisibilityChange}.
     */
    private _awaitingVisibilityKickoffs: QueuedCodeUpgrade[] = [];

    /**
     * Supported-language fenced blocks whose dynamic import hasn't started
     * because their wrapper is not yet within {@link CODE_UPGRADE_LOOKAHEAD_VIEWPORTS}
     * of the viewport; see {@link isBlockNearViewport} and {@link onViewportPass}.
     */
    private _awaitingViewportKickoffs: QueuedCodeUpgrade[] = [];

    /** Whether the scroll/resize viewport listeners are currently registered. */
    private _viewportWatchArmed = false;

    /** Whether a viewport pass is already queued on the next layout flush. */
    private _viewportPassScheduled = false;

    /** Whether a coalesced content-height measure is already queued. */
    private _measureScheduled = false;

    /**
     * Arrow field, not a prototype method: {@link Component.afterNextLayout}
     * calls its callback bare with no receiver.
     */
    private readonly handleViewportPass: () => void = () => this.onViewportPass();

    /**
     * Arrow field, not a prototype method: {@link Component.afterNextLayout}
     * calls its callback bare with no receiver.
     */
    private readonly handleScheduledMeasure: () => void = () => this.onScheduledMeasure();

    /**
     * Bumped by {@link clearContent}; a resolved dynamic import compares its
     * captured generation against this to detect a render it no longer
     * belongs to (a later {@link setMarkdown}, or disposal), mirroring
     * `DiagramView.relayout`'s generation token.
     */
    private _renderGeneration = 0;

    /**
     * Normalised form of {@link MarkdownOptions.maxMeasure} — a bare `number`
     * is stored here with its `"ch"` suffix appended, so the canonical string
     * form is computed once and reused by every {@link setMaxMeasure} write.
     * `null` (the default) means "use the theme's `--ts-ui-md-max-measure`".
     */
    private _maxMeasure: string | null = null;

    /**
     * Constructs a Markdown component for the given source string.
     *
     * @param markdown - The Markdown source to render (optional; defaults to "").
     * @param options - Optional component options bag.
     * @param subclassDefaults - Optional subclass defaults bag.
     */
    constructor(markdown?: string, options?: MarkdownOptions, subclassDefaults?: Partial<MarkdownOptions>) {
        super(options, { ..._defaultMarkdownOptions, ...(subclassDefaults ?? {}) });

        // Positional argument: cache it only when the caller didn't also pass
        // `options.markdown` (which the super-time cascade already stored).
        if (markdown !== undefined && this._options.markdown === undefined) {
            this._options.markdown = markdown;
        }

        // Flowed prose must wrap: Component defaults `white-space` to "nowrap",
        // which would lay the document out as unwrapping single lines that
        // overflow horizontally. Reflow at word boundaries and break overlong
        // unbreakable tokens (URLs) so nothing spills sideways; fenced code keeps
        // its own `white-space: pre` + self-scroll from the `pre` class rule.
        this.setWhiteSpace("normal");
        this.setElementCSSRule("overflowWrap", "break-word");

        // Prose reads continuously, unlike the framework's UI controls (tuned
        // for scanned single-line text), so it wants looser leading. Inherits
        // to every prose descendant; code/pre reset it back to "normal" via
        // their own class rules.
        this.setElementCSSRule("lineHeight", "var(--ts-ui-md-line-height, 1.8)");

        // Caps the prose column to a comfortable reading measure regardless of
        // how wide the assigned layout box is; oversized tables/code fall back
        // to their own class-rule horizontal scroll within the capped column.
        // Dispatched through the setter (even for the unset default) so a
        // later `setMaxMeasure(null)` reverts to the same theme-var default
        // this constructor seeds.
        this.setMaxMeasure(this._options.maxMeasure ?? null);

        // Scales the prose's base font size; headings scale with it via their
        // own relative sizing (see setFontScale).
        this.setFontScale(this._options.fontScale ?? 1);

        // Prose metrics (font, spacing) are theme-bound, so a theme swap can
        // change the rendered height, and `--ts-ui-md-max-measure`'s `ch` unit
        // means it can change a code block's width too — react to both when
        // it fires (mirrors Text).
        this._unsubscribeTheme = ThemeManager.onThemeChange(() => this.onThemeChanged());

        // First measurement rides the first connected layout: only then is the
        // element attached and width-assigned, so the `scrollHeight` read is
        // meaningful. Subsequent re-measures come from setWidth / setMarkdown / theme.
        this.onFirstLayout(() => this.measureContentHeight());
    }

    /**
     * Applies a {@link MarkdownOptions} bag. Inherited Component fields cascade
     * through `super.applyOptions`; the `markdown` source is cached pure to
     * `_options` and picked up by `render()` (or a later `setMarkdown`).
     *
     * @param options - The options bag carrying the values to apply.
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: MarkdownOptions): this {
        super.applyOptions(options);

        if (options.markdown !== undefined) {
            this._options.markdown = options.markdown;
        }

        if (options.linkResolver !== undefined) {
            this._options.linkResolver = options.linkResolver;
        }

        if (options.maxMeasure !== undefined) {
            this._options.maxMeasure = options.maxMeasure;
        }

        if (options.fontScale !== undefined) {
            this._options.fontScale = options.fontScale;
        }

        return this;
    }

    /**
     * Returns the current Markdown source, or "" when unset.
     *
     * @returns The cached Markdown source string.
     */
    getMarkdown(): string {
        return this._options.markdown ?? "";
    }

    /**
     * Sets the resolver used to render every link's href. Does not re-render
     * already-built content; call {@link setMarkdown} (with the same source, if
     * needed) to re-render links with the new resolver.
     *
     * @param resolver - The new link resolver.
     * @returns This component, for method chaining.
     */
    setLinkResolver(resolver: MarkdownLinkResolver): this {
        this._options.linkResolver = resolver;

        return this;
    }

    /**
     * Returns the current link resolver, or the default resolver (every href
     * unchanged, marked external) when none was set — never `null`.
     *
     * @returns The active link resolver.
     */
    getLinkResolver(): MarkdownLinkResolver {
        return this._options.linkResolver ?? defaultLinkResolver;
    }

    /**
     * Overrides the prose column's max width. Pass `null` to revert to the
     * theme's `--ts-ui-md-max-measure` default.
     *
     * @param value - A CSS width string (e.g. `"60ch"`), a bare number of
     *   `ch` units, or `null` to revert to the theme default.
     * @returns This component, for method chaining.
     */
    setMaxMeasure(value: string | number | null): this {
        this._options.maxMeasure = value;
        this._maxMeasure = typeof value === "number" ? `${value}ch` : value;
        this.setElementCSSRule("maxWidth", this._maxMeasure ?? "var(--ts-ui-md-max-measure, 70ch)");

        return this;
    }

    /**
     * Returns the current max-measure override, or `null` when unset (the
     * theme default applies).
     *
     * @returns The cached {@link MarkdownOptions.maxMeasure} value, or `null`.
     */
    getMaxMeasure(): string | number | null {
        return this._options.maxMeasure ?? null;
    }

    /**
     * Re-applies all styles, then re-asserts the prose column's max-measure
     * override.
     *
     * @param element - The element handle to apply styles to.
     * @returns This component, for method chaining.
     *
     * @remarks `Component.applyStyle`'s size-constraint phase also targets the
     * `maxWidth` CSS property (every component resolves `getMaxSizeConstraint()`
     * to a real, if unbounded, `{width,height}` pair, never `null` — see
     * `Component.getMaxSizeConstraint`), and Markdown defaults no `maxSize` of
     * its own, so that phase's value matches the class/framework baseline in
     * the common case. Since that match now queues a removal (rather than
     * being skipped) onto the very same key {@link setMaxMeasure} already
     * queued a real value for, in the same render pass, this override
     * re-asserts {@link setMaxMeasure}'s value last so it always wins.
     */
    applyStyle(element: Handle): this {
        super.applyStyle(element);

        this.setElementCSSRule("maxWidth", this._maxMeasure ?? "var(--ts-ui-md-max-measure, 70ch)");

        return this;
    }

    /**
     * Scales the prose's base font size; headings and other relatively-sized
     * elements scale with it. Pass `1` to clear the override.
     *
     * @param value - The multiplier applied to the base font size.
     * @returns This component, for method chaining.
     */
    setFontScale(value: number): this {
        this._options.fontScale = value;
        this.setElementCSSRule("fontSize", value === 1 ? null : (value * 100) + "%");

        return this;
    }

    /**
     * Returns the current font-scale multiplier, or `1` (no scaling) when unset.
     *
     * @returns The cached {@link MarkdownOptions.fontScale} value, or `1`.
     */
    getFontScale(): number {
        return this._options.fontScale ?? 1;
    }

    /**
     * Sets the Markdown source, re-lexing and rebuilding the rendered subtree
     * when the element already exists. When it does not (pre-render), the source
     * is cached and picked up by `render()`.
     *
     * @param markdown - The new Markdown source string.
     * @returns This component, for method chaining.
     */
    setMarkdown(markdown: string): this {
        this._options.markdown = markdown;

        const element = this.getElement();

        if (!element) {
            return this;
        }

        this.clearContent();
        ensureMarkdownClassRules();
        this.appendBlockTokens(element, lexer(markdown), new Map<string, number>());

        // Content changed — the flowed height did too; re-measure and let a host grow.
        this.measureContentHeight();

        return this;
    }

    /**
     * Folds the measured content height into the inherited minimum as a height
     * floor, so a scroll host grows to the full prose extent (via
     * `Fit.inflateForOverflow`, which reads the child's `getMinSize`). Only the
     * height axis is folded; the width minimum stays `0` so the prose can reflow
     * at any assigned width. An explicit {@link setMinSize} still wins when larger.
     *
     * @returns The min size with the measured height folded in, or the inherited
     *   minimum when nothing has been measured yet.
     */
    getMinSize(): Size | null {
        const base = super.getMinSize();

        if (this._measuredHeight === null) {
            return base;
        }

        if (!base) {
            return { width: 0, height: this._measuredHeight };
        }

        return { width: base.width, height: Math.max(base.height, this._measuredHeight) };
    }

    /**
     * Reports the measured content height as the preferred height when the caller
     * has set no explicit `preferredSize`, keeping the component's preferred extent
     * honest inside a sizing parent. An explicit `preferredSize` constraint wins.
     *
     * @returns The preferred size with the measured height applied, or the
     *   inherited preferred size when a constraint is set or nothing is measured.
     */
    getPreferredSize(): Size | null {
        const base = super.getPreferredSize();

        if (this._measuredHeight === null || this.getPreferredSizeConstraint() !== null) {
            return base;
        }

        if (!base) {
            return { width: 0, height: this._measuredHeight };
        }

        return { width: base.width, height: this._measuredHeight };
    }

    /**
     * Re-measures the flowed content height when the assigned width changes: prose
     * height is width-dependent, so a narrower box reflows taller. The re-measure
     * reads the just-committed width back from the DOM before reading the height.
     *
     * @param width - The new width in pixels.
     * @returns This component, for method chaining.
     */
    setWidth(width: number): this {
        const changed = width !== this.getWidth();

        super.setWidth(width);

        if (changed) {
            this.resyncCodeEditorWidths();
            this.measureContentHeight();
        }

        return this;
    }

    /**
     * Reacts to a theme swap: re-syncs live editors' widths (a `ch`-unit
     * `--ts-ui-md-max-measure` moves with the font) and re-measures the
     * content height (prose metrics are theme-bound).
     */
    private onThemeChanged(): void {
        this.resyncCodeEditorWidths();
        this.measureContentHeight();
    }

    /**
     * Detaches the theme-change listener, then defers to the base class for
     * the rest of teardown. Call when a dynamically-built Markdown is
     * permanently removed from the page, mirroring `CodeEditor.destructor`.
     */
    protected destructor(): void {
        // Disposes every live CodeEditor: raw-DOM-appended (never through
        // addComponent), so the base class's own child-recursion below never
        // reaches them — Markdown must dispose them explicitly.
        this.clearContent();
        this._unsubscribeTheme();
        super.destructor();
    }

    /**
     * Measures the rendered subtree's content height at the element's assigned
     * width and folds it into the component's reported size, then schedules a
     * re-layout so a scroll host can grow to fit. This is the component's only
     * live seam read (`scrollHeight`) — isolated here as the single forced-layout
     * point — and no-ops before the element exists (the first connected layout
     * retries via {@link onFirstLayout}). Idempotent: an unchanged height suppresses
     * the re-layout so repeated measures cannot loop.
     */
    private measureContentHeight(): void {
        const element = this.getElement();
        if (!element) {
            return;
        }

        // Flush any pending style writes — in particular a `width` queued by
        // LayoutManager.commitBounds, which disables auto-commit
        // (setAutoCommitStyle(false)) for the duration of a layout pass.
        // Markdown.setWidth calls measureContentHeight synchronously from
        // inside that window, so without this flush the scrollHeight read
        // below would measure against the previous frame's width. Same fix
        // as Panel.doLayout's pre-measureScrollbarGutter flush.
        this.commitElementStyle();

        this.flushPendingCodeUpgrades();

        // Read the true content height, not the committed box. `scrollHeight` is
        // floored at the element's own `clientHeight`, so measuring the live
        // (already height-committed) box would only ever report *growth* — a
        // document that reflows wider or is edited shorter could never shrink its
        // extent, leaving stale dead space. Collapse the box to its content
        // first — the width was already flushed above, so this second flush only
        // needs to commit the `height: auto` write below. The raw style write is
        // a transient probe restored below, not persistent state, so it
        // deliberately bypasses the typed `setHeight` (which takes only a number).
        const restoreHeight = this.getHeight();
        this.setElementStyle("height", "auto");
        this.commitElementStyle();

        // `scrollHeight` is content + padding (border-box excludes the border),
        // so reach the outer height by adding only the border.
        const border   = this.getBorderSize();
        const measured = DOM.source.getScrollMetrics(element).scrollHeight + border.top + border.bottom;

        // Restore the laid-out height so the box isn't left content-collapsed
        // between now and the next layout pass (which re-commits it anyway).
        this.setElementStyle("height", restoreHeight + "px");
        this.commitElementStyle();

        if (measured === this._measuredHeight) {
            return;
        }

        this._measuredHeight = measured;
        (this.getParentComponent() ?? this).scheduleLayout();
    }

    /**
     * Renders the root element, then lexes the current source and builds the
     * prose subtree into it. Empty/blank source lexes to an empty token list, so
     * the root renders with no prose children.
     *
     * @returns The rendered root element handle.
     */
    protected render(): Handle {
        const element = super.render();

        ensureMarkdownClassRules();
        this.appendBlockTokens(element, lexer(this.getMarkdown()), new Map<string, number>());

        return element;
    }

    /**
     * Creates a tracked child element: minted through the sink, registered for
     * release with the component, and recorded in `_contentHandles` so it is
     * torn down on the next {@link setMarkdown} rebuild.
     *
     * @param tag - The HTML tag to create.
     * @returns The new element handle.
     */
    private create(tag: string): Handle {
        const handle = DOM.sink.createElement(tag);

        this.trackHandle(handle);
        this._contentHandles.push(handle);

        return handle;
    }

    /**
     * Removes every content node from the DOM, releases its handle, and empties
     * the tracked set, so a rebuild neither leaks registry entries nor lets
     * `_ownedHandles` accumulate stale references across edits.
     */
    private clearContent(): void {
        for (const handle of this._contentHandles) {
            DOM.sink.removeElement(handle);
            this.untrackHandle(handle);
            DOM.sink.release(handle);
        }

        this._contentHandles.length = 0;

        // Bumped so any dynamic import already in flight for this render
        // (see loadCodeEditorUpgrade) recognises itself as stale and no-ops
        // instead of applying against handles this rebuild just tore down.
        this._renderGeneration += 1;

        for (const { editor } of this._codeEditors) {
            editor.dispose();
        }

        this._codeEditors.length = 0;
        this._pendingCodeUpgrades.length = 0;
        this._awaitingVisibilityKickoffs.length = 0;
        this._awaitingViewportKickoffs.length = 0;
        this.disarmViewportWatch();
    }

    /**
     * Swaps a fenced block's placeholder `<pre>`/`<code>` for a live,
     * syntax-highlighted `CodeEditor`, sized to exactly fill the `wrapper`
     * (see the "position: relative wrapper" architecture decision — an
     * absolutely positioned child does not contribute to its ancestor's auto
     * height, so the wrapper's own height is pinned explicitly below).
     *
     * @param CodeEditorClass - The dynamically-imported `CodeEditor` constructor.
     * @param wrapper - The `ts-ui-md-code-host` wrapper the placeholder `<pre>` sits in.
     * @param pre - The placeholder `<pre>` handle being replaced.
     * @param code - The placeholder `<code>` handle being replaced.
     * @param text - The fenced block's literal source text.
     * @param languageId - The mapped `CodeEditor` registry id.
     */
    private applyCodeEditorUpgrade(
        CodeEditorClass: PendingCodeUpgrade["CodeEditorClass"],
        wrapper: Handle,
        pre: Handle,
        code: Handle,
        text: string,
        languageId: string,
    ): void {
        const metrics = DOM.source.getScrollMetrics(pre);
        const width   = metrics.clientWidth;
        const height  = metrics.scrollHeight;

        for (const handle of [pre, code]) {
            DOM.sink.removeElement(handle);
            this.untrackHandle(handle);
            DOM.sink.release(handle);

            const index = this._contentHandles.indexOf(handle);
            if (index !== -1) {
                this._contentHandles.splice(index, 1);
            }
        }

        const editor = new CodeEditorClass(text, {
            readOnly: true,
            language: languageId,
            autoHeightMaxRows: CODE_BLOCK_MAX_AUTO_ROWS,
        });

        editor.setX(0).setY(0).setWidth(width).setHeight(height);

        let correctionWarned = false;

        editor.on("heightchange", (payload) => {
            if (!correctionWarned) {
                correctionWarned = true;

                const delta = Math.abs(payload.height - height);

                if (delta > GUESS_HEIGHT_CORRECTION_WARN_PX) {
                    console.warn(
                        `Markdown: fenced "${languageId}" code block's CodeEditor corrected its guessed ` +
                        `height by ${Math.round(delta)}px (${height}px → ${payload.height}px) on mount.`,
                    );
                }
            }

            this.handleCodeEditorHeightChange(wrapper, payload.height);
        });
        DOM.sink.appendChild(wrapper, editor.getElement(true)!);
        DOM.sink.apply(wrapper, { style: { height: height + "px" } });

        this._codeEditors.push({ editor, wrapper });
    }

    /**
     * Re-pins the `ts-ui-md-code-host` wrapper's height to a live CodeEditor's
     * own auto-grown height synchronously, then schedules a coalesced
     * re-measure of Markdown's own content height (see {@link scheduleContentMeasure})
     * so the taller/shorter block folds into the reported size. Wired in
     * {@link applyCodeEditorUpgrade} onto each editor's `"heightchange"` event.
     *
     * @param wrapper - The wrapper the fired editor sits in.
     * @param height - The editor's new height in pixels.
     */
    private handleCodeEditorHeightChange(wrapper: Handle, height: number): void {
        DOM.sink.apply(wrapper, { style: { height: height + "px" } });
        this.scheduleContentMeasure();
    }

    /**
     * Applies any {@link PendingCodeUpgrade} that has become visible since it
     * was queued. Called as the first line of {@link measureContentHeight}, so
     * a freshly-applied wrapper's height is committed before `Markdown`'s own
     * content height is measured.
     */
    private flushPendingCodeUpgrades(): void {
        this._pendingCodeUpgrades = this._pendingCodeUpgrades.filter((pending) => {
            if (!this.isEffectivelyVisible()) {
                return true;
            }

            this.applyCodeEditorUpgrade(
                pending.CodeEditorClass, pending.wrapper, pending.pre, pending.code,
                pending.text, pending.languageId,
            );

            return false;
        });
    }

    /**
     * Re-syncs every already-applied editor's width from its wrapper's
     * current `clientWidth` — what keeps a code block's width tracking
     * `Markdown`'s own width. Called only from the two things that can
     * actually change a wrapper's width: {@link setWidth} and the
     * theme-change handler (a font swap moves the `ch`-unit max-measure).
     *
     * @remarks Skipped entirely while not effectively visible: a hidden
     * subtree's `clientWidth` reads `0`, and writing that through would
     * collapse a previously-applied editor with nothing to correct it on
     * re-show (no width actually changes on re-show, so `setWidth`'s "only
     * re-measure when changed" guard would never re-run this method).
     * Skipping leaves the last-good width intact instead.
     */
    private resyncCodeEditorWidths(): void {
        this.commitElementStyle();

        if (!this.isEffectivelyVisible()) {
            return;
        }

        for (const { editor, wrapper } of this._codeEditors) {
            editor.setWidth(DOM.source.getScrollMetrics(wrapper).clientWidth);
        }
    }

    /**
     * Starts a fenced block's `CodeEditor` upgrade once it clears two gates in
     * series. First, effective visibility: if `Markdown` is not currently
     * effectively visible, the entry queues in {@link _awaitingVisibilityKickoffs},
     * flushed later by {@link onEffectiveVisibilityChange} once visibility
     * flips to `true`, edge-triggered rather than polled. This is the single
     * check-once gate the deferred kickoff registered in {@link appendCode}
     * runs through: `onFirstLayout` alone only guarantees "connected +
     * displayed" for a component's very first render — once the element is
     * already connected (e.g. a second `setMarkdown()` on a previously-shown,
     * now-hidden instance), it takes `Component.afterNextLayout`'s fast path,
     * which fires unconditionally on the next flush with no displayed-gating
     * — so the visibility check has to happen here, not be assumed from
     * having been called at all. Second, proximity to the viewport: once
     * effectively visible, an entry whose wrapper is not yet within
     * {@link CODE_UPGRADE_LOOKAHEAD_VIEWPORTS} of the viewport queues in
     * {@link _awaitingViewportKickoffs} instead, flushed by {@link onViewportPass}
     * as scrolling or resizing brings it into range.
     *
     * @param entry - The fenced block's placeholder handles, text, mapped
     *   language, and the render generation it belongs to.
     */
    private startCodeEditorImport(entry: QueuedCodeUpgrade): void {
        if (!this.isEffectivelyVisible()) {
            this._awaitingVisibilityKickoffs.push(entry);

            return;
        }

        if (!this.isBlockNearViewport(entry.wrapper)) {
            this._awaitingViewportKickoffs.push(entry);
            this.armViewportWatch();

            return;
        }

        void this.loadCodeEditorUpgrade(entry.wrapper, entry.pre, entry.code, entry.text, entry.languageId, entry.generation);
    }

    /**
     * Tests whether a fenced block's wrapper is close enough to the visible
     * window to start its `CodeEditor` upgrade now — not entirely above the
     * top of the window, and not further than {@link CODE_UPGRADE_LOOKAHEAD_VIEWPORTS}
     * viewport-heights below the fold. The lookahead applies below the fold
     * only: swapping the placeholder for a live editor changes the block's
     * height, and giving the margin no upward component means that in
     * ordinary downward reading every upgrade happens at or below the
     * reader's position, so the movement lands on off-screen content.
     *
     * @param wrapper - The fenced block's `ts-ui-md-code-host` wrapper.
     * @returns `true` when the wrapper is within range of the viewport.
     */
    private isBlockNearViewport(wrapper: Handle): boolean {
        const rect          = DOM.source.getElementRect(wrapper);
        const viewportHeight = DOM.source.getViewportSize().height;
        const cutoff         = viewportHeight * (1 + CODE_UPGRADE_LOOKAHEAD_VIEWPORTS);

        return rect.bottom >= 0 && rect.top <= cutoff;
    }

    /**
     * Registers the scroll/resize viewport listeners that drive {@link onViewportPass},
     * if not already armed. Idempotent — safe to call from every enqueue.
     */
    private armViewportWatch(): void {
        if (this._viewportWatchArmed) {
            return;
        }

        this._viewportWatchArmed = true;
        Event.addViewportListener(this, "scroll", this.handleViewportChange);
        Event.addViewportListener(this, "resize", this.handleViewportChange);
    }

    /**
     * Removes the scroll/resize viewport listeners registered by
     * {@link armViewportWatch}, once nothing remains queued to watch for.
     */
    private disarmViewportWatch(): void {
        if (!this._viewportWatchArmed) {
            return;
        }

        this._viewportWatchArmed = false;
        Event.removeViewportListener(this, "scroll", this.handleViewportChange);
        Event.removeViewportListener(this, "resize", this.handleViewportChange);
    }

    /**
     * Plain prototype-method reference passed to {@link Event.addViewportListener} /
     * {@link Event.removeViewportListener}, which invoke it with this
     * component bound as `this` — unlike {@link handleViewportPass}, this
     * cannot be an arrow field (see the class-level remark on the two
     * callback shapes).
     */
    private handleViewportChange(): void {
        this.scheduleViewportPass();
    }

    /**
     * Coalesces a burst of scroll/resize events into one {@link onViewportPass}
     * per layout flush.
     */
    private scheduleViewportPass(): void {
        if (this._viewportPassScheduled || this._awaitingViewportKickoffs.length === 0) {
            return;
        }

        this._viewportPassScheduled = true;
        Component.afterNextLayout(this.handleViewportPass);
    }

    /**
     * Walks {@link _awaitingViewportKickoffs} in document order, starting the
     * upgrade for every entry within range of the viewport and breaking at
     * the first one past the lookahead cutoff (later entries are further
     * down, since fenced blocks are appended in document order). Reads every
     * entry's rect before starting any upgrade, so the pass costs at most one
     * forced reflow rather than interleaving reads with the layout-affecting
     * writes an upgrade triggers.
     */
    private onViewportPass(): void {
        this._viewportPassScheduled = false;

        if (this._awaitingViewportKickoffs.length === 0) {
            this.disarmViewportWatch();

            return;
        }

        if (!this.isEffectivelyVisible()) {
            return;
        }

        this.commitElementStyle();

        const viewportHeight = DOM.source.getViewportSize().height;
        const cutoff         = viewportHeight * (1 + CODE_UPGRADE_LOOKAHEAD_VIEWPORTS);
        const queue          = this._awaitingViewportKickoffs;
        const due:       QueuedCodeUpgrade[] = [];
        const remaining: QueuedCodeUpgrade[] = [];

        for (let i = 0; i < queue.length; i++) {
            const entry = queue[i]!;
            const rect  = DOM.source.getElementRect(entry.wrapper);

            if (rect.top > cutoff) {
                remaining.push(...queue.slice(i));

                break;
            }

            (rect.bottom >= 0 ? due : remaining).push(entry);
        }

        this._awaitingViewportKickoffs = remaining;

        if (remaining.length === 0) {
            this.disarmViewportWatch();
        }

        for (const entry of due) {
            void this.loadCodeEditorUpgrade(entry.wrapper, entry.pre, entry.code, entry.text, entry.languageId, entry.generation);
        }
    }

    /**
     * Flushes any {@link QueuedCodeUpgrade} once this component becomes
     * effectively visible, starting the dynamic import for each — the
     * edge-triggered replacement for a per-frame visibility poll, mirroring
     * `Canvas.onEffectiveVisibilityChange`'s animation-loop reconcile. Also
     * schedules a viewport pass, so an entry already queued in {@link
     * _awaitingViewportKickoffs} before this subtree was hidden — its own
     * scroll/resize watch now stale — is re-checked at rest instead of
     * waiting for a scroll or resize that may never come.
     *
     * @param effective - The component's new effective-visibility state.
     */
    protected onEffectiveVisibilityChange(effective: boolean): void {
        super.onEffectiveVisibilityChange(effective);

        if (!effective) {
            return;
        }

        if (this._awaitingVisibilityKickoffs.length > 0) {
            const queued = this._awaitingVisibilityKickoffs;

            this._awaitingVisibilityKickoffs = [];

            for (const entry of queued) {
                this.startCodeEditorImport(entry);
            }
        }

        // Ordering is load-bearing: draining the visibility queue above can
        // push newly-checked entries into _awaitingViewportKickoffs, and this
        // has to run after that to cover them. A no-op when both queues are
        // empty (scheduleViewportPass no-ops on an empty queue).
        this.scheduleViewportPass();
    }

    /**
     * Loads `CodeEditor` through a narrow dynamic import — the two specific
     * modules it needs (`CodeEditor.js` itself, and `languages.js` for its
     * side-effect language registration), never the `component/editor`
     * barrel, which would also pull in the unrelated Lexical-based
     * `MarkdownEditor` stack. Once the import resolves, applies the upgrade
     * immediately if `Markdown` is still showing the render that queued this
     * call and is effectively visible, or queues it in {@link _pendingCodeUpgrades}
     * otherwise.
     *
     * @param wrapper - The `ts-ui-md-code-host` wrapper the placeholder `<pre>` sits in.
     * @param pre - The placeholder `<pre>` handle.
     * @param code - The placeholder `<code>` handle.
     * @param text - The fenced block's literal source text.
     * @param languageId - The mapped `CodeEditor` registry id.
     * @param generation - The {@link _renderGeneration} captured when this
     *   fenced block was queued in {@link appendCode}.
     */
    private async loadCodeEditorUpgrade(
        wrapper: Handle,
        pre: Handle,
        code: Handle,
        text: string,
        languageId: string,
        generation: number,
    ): Promise<void> {
        const [{ CodeEditor: CodeEditorClass }] = await Promise.all([
            import("~/component/editor/CodeEditor.js"),
            import("~/component/editor/languages.js"),
        ]);

        if (generation !== this._renderGeneration) {
            // A later setMarkdown() (or disposal, which also bumps the
            // generation) rebuilt since this block was queued — the wrapper/
            // pre/code handles this call closed over no longer belong to a
            // live render.
            return;
        }

        if (this.isEffectivelyVisible()) {
            this.applyCodeEditorUpgrade(CodeEditorClass, wrapper, pre, code, text, languageId);
            this.scheduleContentMeasure();
        } else {
            this._pendingCodeUpgrades.push({ CodeEditorClass, wrapper, pre, code, text, languageId, generation });
        }
    }

    /**
     * Coalesces a burst of upgrade-driven re-measures — {@link loadCodeEditorUpgrade}
     * and {@link handleCodeEditorHeightChange} each fire once per upgraded
     * block — into one {@link measureContentHeight} call per layout flush,
     * rather than one full-document reflow per block.
     */
    private scheduleContentMeasure(): void {
        if (this._measureScheduled) {
            return;
        }

        this._measureScheduled = true;
        Component.afterNextLayout(this.handleScheduledMeasure);
    }

    /**
     * Runs the coalesced {@link measureContentHeight} queued by
     * {@link scheduleContentMeasure}, then re-evaluates the viewport queue:
     * the measure's reflow can move a still-queued block relative to the
     * fold without any scroll or resize event firing to trigger the pass
     * itself.
     */
    private onScheduledMeasure(): void {
        this._measureScheduled = false;
        this.measureContentHeight();
        this.scheduleViewportPass();
    }

    /**
     * Walks a list of block-level tokens, appending each into `parent`.
     *
     * @param parent - The element handle to append the built blocks into.
     * @param tokens - The block-level tokens to render.
     * @param headingIds - The current render pass's heading-id dedupe counter,
     *   keyed by slug — see {@link appendHeading}. Threaded as a parameter
     *   (never a field) so it cannot survive past the render pass that created it.
     */
    private appendBlockTokens(parent: Handle, tokens: Token[], headingIds: Map<string, number>): void {
        for (const token of tokens) {
            this.appendBlockToken(parent, token, headingIds);
        }
    }

    /**
     * Dispatches a single block-level token to its builder. Unknown/unsupported
     * types fall through to a plain-text node — never markup, never a crash.
     *
     * @param parent - The element handle to append into.
     * @param token - The block-level token.
     * @param headingIds - The current render pass's heading-id dedupe counter.
     */
    private appendBlockToken(parent: Handle, token: Token, headingIds: Map<string, number>): void {
        switch (token.type) {
            case "heading":    this.appendHeading(parent, token as Tokens.Heading, headingIds);       break;
            case "paragraph":  this.appendParagraph(parent, token as Tokens.Paragraph);               break;
            case "list":       this.appendList(parent, token as Tokens.List, headingIds);             break;
            case "blockquote": this.appendBlockquote(parent, token as Tokens.Blockquote, headingIds); break;
            case "code":       this.appendCode(parent, token as Tokens.Code);                         break;
            case "table":      this.appendTable(parent, token as Tokens.Table);                       break;

            // Blank line between blocks — nothing to render.
            case "space": break;

            default: this.appendTextNode(parent, token.raw ?? ""); break;
        }
    }

    /**
     * Builds an `<h1>`..`<h6>` element (tag from the token depth) carrying the
     * heading's inline content and a slugified `id`, so an in-page `#fragment`
     * link can target it.
     *
     * @param parent - The element handle to append into.
     * @param token - The heading token.
     * @param headingIds - The current render pass's dedupe counter: a slug seen
     *   before gets a `-N` suffix so every id on the page is unique. Local to
     *   one render pass — {@link render} and {@link setMarkdown} each start a
     *   fresh `Map`, so a re-render does not accumulate suffixes.
     */
    private appendHeading(parent: Handle, token: Tokens.Heading, headingIds: Map<string, number>): void {
        const depth = Math.min(Math.max(token.depth, HEADING_MIN_DEPTH), HEADING_MAX_DEPTH);
        const heading = this.create("h" + depth);
        const id = nextHeadingId(token.text, headingIds);

        DOM.sink.apply(heading, { addClass: [HEADING_CLASS], setAttr: { id } });
        this.appendInlineTokens(heading, token.tokens);
        DOM.sink.appendChild(parent, heading);
    }

    /**
     * Builds a `<p>` carrying the paragraph's inline content.
     *
     * @param parent - The element handle to append into.
     * @param token - The paragraph token.
     */
    private appendParagraph(parent: Handle, token: Tokens.Paragraph): void {
        const paragraph = this.create("p");

        this.appendInlineTokens(paragraph, token.tokens);
        DOM.sink.appendChild(parent, paragraph);
    }

    /**
     * Builds a `<ul>` (or `<ol>` when the token is ordered) with an `<li>` per
     * item.
     *
     * @param parent - The element handle to append into.
     * @param token - The list token.
     * @param headingIds - The current render pass's heading-id dedupe counter.
     */
    private appendList(parent: Handle, token: Tokens.List, headingIds: Map<string, number>): void {
        const list = this.create(token.ordered ? "ol" : "ul");

        DOM.sink.apply(list, { addClass: [LIST_CLASS] });

        for (const item of token.items) {
            this.appendListItem(list, item, headingIds);
        }

        DOM.sink.appendChild(parent, list);
    }

    /**
     * Builds an `<li>` and walks its children, which are block tokens for a
     * loose list and inline-bearing `text` tokens for a tight one — so both
     * render.
     *
     * @param list - The `<ul>`/`<ol>` element handle to append into.
     * @param item - The list-item token.
     * @param headingIds - The current render pass's heading-id dedupe counter.
     */
    private appendListItem(list: Handle, item: Tokens.ListItem, headingIds: Map<string, number>): void {
        const listItem = this.create("li");

        for (const token of item.tokens) {
            if (token.type === "text") {
                const text = token as Tokens.Text;

                if (text.tokens && text.tokens.length > 0) {
                    this.appendInlineTokens(listItem, text.tokens);
                } else {
                    this.appendInlineToken(listItem, text, item.tokens.length === 1);
                }
            } else {
                this.appendBlockToken(listItem, token, headingIds);
            }
        }

        DOM.sink.appendChild(list, listItem);
    }

    /**
     * Builds a wrapper `<div>` › `<table>` with a `<thead>` holding the header
     * row and a `<tbody>` holding one row per body entry. The wrapper scrolls
     * horizontally so an overlong table cannot spill sideways.
     *
     * @param parent - The element handle to append into.
     * @param token - The table token.
     */
    private appendTable(parent: Handle, token: Tokens.Table): void {
        const wrapper = this.create("div");

        DOM.sink.apply(wrapper, { addClass: [TABLE_WRAP_CLASS] });

        const table = this.create("table");

        DOM.sink.apply(table, { addClass: [TABLE_CLASS] });

        const thead = this.create("thead");

        this.appendTableRow(thead, token.header, true);
        DOM.sink.appendChild(table, thead);

        const tbody = this.create("tbody");

        for (const row of token.rows) {
            this.appendTableRow(tbody, row, false);
        }

        DOM.sink.appendChild(table, tbody);
        DOM.sink.appendChild(wrapper, table);
        DOM.sink.appendChild(parent, wrapper);
    }

    /**
     * Builds a `<tr>` with one `<th>` (header) or `<td>` (body) per cell,
     * carrying the cell's alignment class (when the column is aligned) and
     * inline content.
     *
     * @param section - The `<thead>`/`<tbody>` element handle to append into.
     * @param cells - The row's cells.
     * @param header - Whether this is the header row (`<th>` cells) or a body
     *   row (`<td>` cells).
     */
    private appendTableRow(section: Handle, cells: Tokens.TableCell[], header: boolean): void {
        const row = this.create("tr");

        for (const cell of cells) {
            const cellElement = this.create(header ? "th" : "td");
            const classes = [header ? TH_CLASS : TD_CLASS];
            const align = alignmentClass(cell.align);

            if (align) {
                classes.push(align);
            }

            DOM.sink.apply(cellElement, { addClass: classes });
            this.appendInlineTokens(cellElement, cell.tokens);
            DOM.sink.appendChild(row, cellElement);
        }

        DOM.sink.appendChild(section, row);
    }

    /**
     * Builds a `<blockquote>` and recurses into its block-level children.
     *
     * @param parent - The element handle to append into.
     * @param token - The blockquote token.
     * @param headingIds - The current render pass's heading-id dedupe counter.
     */
    private appendBlockquote(parent: Handle, token: Tokens.Blockquote, headingIds: Map<string, number>): void {
        const quote = this.create("blockquote");

        DOM.sink.apply(quote, { addClass: [QUOTE_CLASS] });
        this.appendBlockTokens(quote, token.tokens, headingIds);
        DOM.sink.appendChild(parent, quote);
    }

    /**
     * Builds a `<pre>` › `<code>` carrying the fenced block's literal text
     * verbatim (newlines preserved). When the fence's info string maps to a
     * registered `CodeEditor` language (see {@link mapFenceLangToEditorId}),
     * the `<pre>` is additionally wrapped in a `ts-ui-md-code-host` div and a
     * deferred upgrade to a live, syntax-highlighted `CodeEditor` is queued —
     * see {@link loadCodeEditorUpgrade}. An unmapped language, or no info
     * string, renders exactly as before: a bare `<pre>` with no wrapper and
     * no dynamic import triggered.
     *
     * @param parent - The element handle to append into.
     * @param token - The code token.
     */
    private appendCode(parent: Handle, token: Tokens.Code): void {
        const pre = this.create("pre");

        DOM.sink.apply(pre, { addClass: [PRE_CLASS] });

        const code = this.create("code");

        DOM.sink.apply(code, { text: token.text });
        DOM.sink.appendChild(pre, code);

        const languageId = mapFenceLangToEditorId(token.lang);

        if (languageId === null) {
            DOM.sink.appendChild(parent, pre);

            return;
        }

        const wrapper = this.create("div");

        DOM.sink.apply(wrapper, { addClass: [CODE_HOST_CLASS] });
        DOM.sink.appendChild(wrapper, pre);
        DOM.sink.appendChild(parent, wrapper);

        // Not a direct call: the kickoff itself, not just the DOM swap, waits
        // for Markdown's first connected layout. `startCodeEditorImport`
        // re-checks visibility itself rather than trusting `onFirstLayout`
        // alone to guarantee "connected + displayed" — see its own docblock
        // for why that guarantee doesn't hold for every registration.
        const entry: QueuedCodeUpgrade = { wrapper, pre, code, text: token.text, languageId, generation: this._renderGeneration };

        this.onFirstLayout(() => this.startCodeEditorImport(entry));
    }

    /**
     * Walks a list of inline-level tokens, appending each into `parent`.
     *
     * @param parent - The element handle to append into.
     * @param tokens - The inline-level tokens to render.
     */
    private appendInlineTokens(parent: Handle, tokens: Token[]): void {
        const sole = tokens.length === 1;

        for (const token of tokens) {
            this.appendInlineToken(parent, token, sole);
        }
    }

    /**
     * Dispatches a single inline-level token. A lone plain-text run writes
     * straight onto `parent`; interleaved runs are wrapped in a `<span>` (the
     * sink has no raw text-node primitive, so a text sibling of an element needs
     * its own element). Unknown types fall through to a text node.
     *
     * @param parent - The element handle to append into.
     * @param token - The inline-level token.
     * @param sole - Whether this is the only token being appended into `parent`,
     *   allowing a direct text write instead of a wrapping span.
     */
    private appendInlineToken(parent: Handle, token: Token, sole: boolean): void {
        switch (token.type) {
            case "text": {
                const text = token as Tokens.Text;

                if (text.tokens && text.tokens.length > 0) {
                    this.appendInlineTokens(parent, text.tokens);
                } else if (sole) {
                    DOM.sink.apply(parent, { text: text.text });
                } else {
                    this.appendTextNode(parent, text.text);
                }

                break;
            }

            case "strong": this.appendInlineWrapper(parent, "strong", (token as Tokens.Strong).tokens); break;
            case "em":     this.appendInlineWrapper(parent, "em", (token as Tokens.Em).tokens);         break;

            case "codespan": {
                const code = this.create("code");

                DOM.sink.apply(code, { addClass: [CODE_CLASS], text: (token as Tokens.Codespan).text });
                DOM.sink.appendChild(parent, code);

                break;
            }

            case "link": this.appendLink(parent, token as Tokens.Link); break;

            default: this.appendTextNode(parent, (token as Tokens.Text).text ?? token.raw ?? ""); break;
        }
    }

    /**
     * Builds an inline emphasis wrapper (`<strong>` / `<em>`) around its inline
     * children.
     *
     * @param parent - The element handle to append into.
     * @param tag - The wrapper tag.
     * @param tokens - The inline children.
     */
    private appendInlineWrapper(parent: Handle, tag: string, tokens: Token[]): void {
        const wrapper = this.create(tag);

        this.appendInlineTokens(wrapper, tokens);
        DOM.sink.appendChild(parent, wrapper);
    }

    /**
     * Builds an `<a>` from the link token's href, passed through
     * {@link getLinkResolver}, and the link's inline text. `target`/`rel` are
     * set only when the resolution is external — the default resolver marks
     * everything external, reproducing the pre-`linkResolver` behaviour.
     *
     * @param parent - The element handle to append into.
     * @param token - The link token.
     */
    private appendLink(parent: Handle, token: Tokens.Link): void {
        const anchor = this.create("a");
        const resolution = this.getLinkResolver()(token.href);
        const setAttr: Record<string, string> = { href: resolution.href };

        if (resolution.external) {
            setAttr.target = "_blank";
            setAttr.rel = "noopener noreferrer";
        }

        DOM.sink.apply(anchor, { addClass: [LINK_CLASS], setAttr });
        this.appendInlineTokens(anchor, token.tokens);
        DOM.sink.appendChild(parent, anchor);
    }

    /**
     * Appends a plain-text run wrapped in a `<span>`. Used for interleaved text
     * runs and the unsupported-token fallback, where a bare text node cannot be
     * a sibling of element children through the sink.
     *
     * @param parent - The element handle to append into.
     * @param text - The text content.
     */
    private appendTextNode(parent: Handle, text: string): void {
        const span = this.create("span");

        DOM.sink.apply(span, { text });
        DOM.sink.appendChild(parent, span);
    }
}

/**
 * One heading extracted from Markdown source by {@link extractMarkdownHeadings}.
 *
 * @category Components
 */
export interface MarkdownHeading {
    /** The slugified id — byte-identical to the `id` {@link Markdown} renders onto the corresponding heading element. */
    id:    string;
    /** The heading's plain text. */
    text:  string;
    /** The heading's level, clamped to `[1, 6]`. */
    depth: number;
}

/**
 * Flattens a heading's inline token tree to plain text — the same content
 * {@link Markdown.appendInlineTokens} would render, minus the markup: a
 * `strong`/`em` wrapper contributes its inner text with no `**`/`_` marks, a
 * `codespan` contributes its code text with no backticks, and a `link`
 * contributes its label text with no `[]()` syntax. `heading.text` (the raw
 * source substring) is deliberately not used here — it still carries that
 * markup, which is correct for {@link nextHeadingId} (matching `appendHeading`'s
 * own slug input) but wrong for display.
 *
 * @param tokens - A heading's inline-level tokens (`Tokens.Heading.tokens`).
 * @returns The heading's rendered plain text.
 */
function inlineText(tokens: Token[]): string {
    return tokens.map((token) => {
        switch (token.type) {
            case "text":     return (token as Tokens.Text).tokens ? inlineText((token as Tokens.Text).tokens!) : (token as Tokens.Text).text;
            case "strong":   return inlineText((token as Tokens.Strong).tokens);
            case "em":       return inlineText((token as Tokens.Em).tokens);
            case "codespan": return (token as Tokens.Codespan).text;
            case "link":     return inlineText((token as Tokens.Link).tokens);
            default:         return (token as Tokens.Text).text ?? token.raw ?? "";
        }
    }).join("");
}

/**
 * Recursively walks `tokens` for heading tokens, the same block-token shapes
 * {@link Markdown.appendBlockToken} recurses into for headings: top-level, and
 * nested inside a blockquote or a (loose) list item.
 *
 * @param tokens - The block tokens to walk.
 * @param headingIds - The current pass's dedupe counter — see `nextHeadingId`.
 * @param out - The array headings are appended to, in document order.
 */
function collectHeadings(tokens: Token[], headingIds: Map<string, number>, out: MarkdownHeading[]): void {
    for (const token of tokens) {
        if (token.type === "heading") {
            const heading = token as Tokens.Heading;
            const depth = Math.min(Math.max(heading.depth, HEADING_MIN_DEPTH), HEADING_MAX_DEPTH);

            out.push({ id: nextHeadingId(heading.text, headingIds), text: inlineText(heading.tokens), depth });
        } else if (token.type === "blockquote") {
            collectHeadings((token as Tokens.Blockquote).tokens, headingIds, out);
        } else if (token.type === "list") {
            for (const item of (token as Tokens.List).items) {
                collectHeadings(item.tokens, headingIds, out);
            }
        }
    }
}

/**
 * Computes the heading outline of a Markdown source string, without building
 * any DOM — the ids produced are byte-identical to the `id` {@link Markdown}
 * renders onto the corresponding `<h1>`-`<h6>` element for the same source,
 * since both go through `nextHeadingId`.
 *
 * @param source - The Markdown source to extract headings from.
 * @returns The source's headings, in document order.
 *
 * @category Components
 */
export function extractMarkdownHeadings(source: string): MarkdownHeading[] {
    const headings: MarkdownHeading[] = [];

    collectHeadings(lexer(source), new Map<string, number>(), headings);

    return headings;
}

/**
 * Sub-pixel tolerance for "at or above the pane's top". A scroll-to-heading
 * lands its target via a delta computed from sub-pixel-precise
 * `getBoundingClientRect()` reads, but the native `scrollTop` it's applied
 * through can round the requested value — landing the heading a fraction of
 * a pixel past the pane's top, enough to fail a strict `<=` and fall back to
 * the previous heading.
 */
const ACTIVE_HEADING_TOP_TOLERANCE_PX = 1;

/**
 * Resolves which heading in `headings` is at or nearest above
 * `scrollElement`'s viewport top — the last heading, in document order,
 * whose top edge is at or above the scroll container's own top (within
 * `ACTIVE_HEADING_TOP_TOLERANCE_PX`). Mirrors
 * `DocsContent.scrollToHeading`'s lookup technique in the read direction.
 *
 * Once `scrollElement` has scrolled to its maximum, the first heading that
 * hasn't yet reached the pane's own top is active outright, instead of
 * whichever heading last crossed it: a heading near the document's end (or
 * several, clustered together) may have less than a full viewport of
 * content left below it, so no amount of scrolling can bring it exactly to
 * the pane's top, and the top-crossing rule alone would otherwise resolve to
 * a much earlier heading than whichever one the scroll actually landed on.
 *
 * @param scrollElement - The scroll-owning element to read the pane's own top from.
 * @param headings - The document's headings, in document order.
 * @returns The active heading's id, or `null` when the pane's top is above every heading.
 *
 * @category Components
 */
export function findActiveHeading(scrollElement: Handle, headings: MarkdownHeading[]): string | null {
    const paneTop = DOM.source.getElementRect(scrollElement).top;
    const metrics = DOM.source.getScrollMetrics(scrollElement);
    const atMaxScroll = metrics.scrollHeight > metrics.clientHeight
        && metrics.scrollTop >= metrics.scrollHeight - metrics.clientHeight - ACTIVE_HEADING_TOP_TOLERANCE_PX;

    let active: string | null = null;

    for (const heading of headings) {
        const el = DOM.source.getElementById(heading.id);

        if (!el || !DOM.source.contains(scrollElement, el)) {
            continue;
        }

        if (DOM.source.getElementRect(el).top <= paneTop + ACTIVE_HEADING_TOP_TOLERANCE_PX) {
            active = heading.id;
        } else {
            // Headings are in document order; every later one is further
            // below. At max scroll, though, this first not-yet-reached
            // heading is already on screen — nothing can scroll it up any
            // further — so it wins outright rather than leaving whichever
            // earlier heading last crossed the top still active.
            if (atMaxScroll) {
                active = heading.id;
            }

            break;
        }
    }

    return active;
}

const MarkdownCallable = callable(Markdown);
type MarkdownCallable = Markdown;
export {
    Markdown         as _Markdown,
    MarkdownCallable as Markdown,
    // Not re-exported from the package barrel (`component/display/index.ts`):
    // a test-only hook, not part of the public API surface.
    mapFenceLangToEditorId,
};
