// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { ThemeManager } from "~/core/Theme.js";
import { callable } from "~/core/Callable.js";
import { Size } from "~/primitive/Size.js";
import { lexer } from "marked";
import type { Token, Tokens } from "marked";

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

// Markdown heading levels span h1..h6; a deeper `#######` run is not a heading
// in CommonMark, but clamp anyway so a stray `depth` never mints an invalid tag.
const HEADING_MIN_DEPTH = 1;
const HEADING_MAX_DEPTH = 6;

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
}

/**
 * Construction-time options for {@link Markdown}.
 *
 * @category Components
 */
export interface MarkdownOptions extends ComponentOptions {
    /** The Markdown source string to render. */
    markdown?: string;
}

/**
 * A display component that renders a Markdown source string as a live DOM
 * subtree.
 *
 * @remarks
 * Parsing uses the `marked` library's lexer only (`marked.lexer(src)`): the
 * component walks the returned token AST and builds every prose element
 * (`<h1>`–`<h6>`, `<p>`, `<ul>`/`<ol>`/`<li>`, `<blockquote>`, `<pre>`/`<code>`,
 * `<strong>`, `<em>`, `<a>`) through the DOM sink. There is no HTML-string
 * assignment path, so untrusted Markdown can never inject markup, and the
 * render runs against the modelled DOM source in tests.
 *
 * The v1 token set covers headings, paragraphs, ordered/unordered lists,
 * blockquotes, fenced/inline code, bold, italic, and links. Any other token
 * type (tables, images, raw HTML, GFM extensions) falls through to a defined
 * fallback that renders the token's plain text — never a crash, never markup.
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
 * freely assignable). An explicit `preferredSize`/`setMinSize` still overrides it.
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

    /**
     * Constructs a Markdown component for the given source string.
     *
     * @param markdown - The Markdown source to render (optional; defaults to "").
     * @param options - Optional component options bag.
     */
    constructor(markdown?: string, options?: MarkdownOptions) {
        super(options);

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

        // Prose metrics (font, spacing) are theme-bound, so a theme swap can
        // change the rendered height — re-measure when it fires (mirrors Text).
        this._unsubscribeTheme = ThemeManager.onThemeChange(() => this.measureContentHeight());

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
        this.appendBlockTokens(element, lexer(markdown));

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
     * height is width-dependent, so a narrower box reflows taller. Measuring reads
     * the just-assigned width back from the DOM (see {@link measureContentHeight}).
     *
     * @param width - The new width in pixels.
     * @returns This component, for method chaining.
     */
    setWidth(width: number): this {
        const changed = width !== this.getWidth();

        super.setWidth(width);

        if (changed) {
            this.measureContentHeight();
        }

        return this;
    }

    /**
     * Detaches the theme-change listener. Call when a dynamically-built Markdown
     * is permanently removed from the page, mirroring `Text.dispose`.
     */
    dispose(): void {
        this._unsubscribeTheme();
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

        // Flush the buffered width write so `scrollHeight` reflects the assigned
        // width, not the pre-resize DOM (the commitBounds/stale-DOM gotcha).
        this.commitElementStyle();

        // `scrollHeight` is content + padding (border-box excludes the border),
        // so reach the outer height by adding only the border.
        const border   = this.getBorderSize();
        const measured = DOM.source.getScrollMetrics(element).scrollHeight + border.top + border.bottom;

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
        this.appendBlockTokens(element, lexer(this.getMarkdown()));

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
    }

    /**
     * Walks a list of block-level tokens, appending each into `parent`.
     *
     * @param parent - The element handle to append the built blocks into.
     * @param tokens - The block-level tokens to render.
     */
    private appendBlockTokens(parent: Handle, tokens: Token[]): void {
        for (const token of tokens) {
            this.appendBlockToken(parent, token);
        }
    }

    /**
     * Dispatches a single block-level token to its builder. Unknown/unsupported
     * types fall through to a plain-text node — never markup, never a crash.
     *
     * @param parent - The element handle to append into.
     * @param token - The block-level token.
     */
    private appendBlockToken(parent: Handle, token: Token): void {
        switch (token.type) {
            case "heading":    this.appendHeading(parent, token as Tokens.Heading);       break;
            case "paragraph":  this.appendParagraph(parent, token as Tokens.Paragraph);   break;
            case "list":       this.appendList(parent, token as Tokens.List);             break;
            case "blockquote": this.appendBlockquote(parent, token as Tokens.Blockquote); break;
            case "code":       this.appendCode(parent, token as Tokens.Code);             break;

            // Blank line between blocks — nothing to render.
            case "space": break;

            default: this.appendTextNode(parent, token.raw ?? ""); break;
        }
    }

    /**
     * Builds an `<h1>`..`<h6>` element (tag from the token depth) carrying the
     * heading's inline content.
     *
     * @param parent - The element handle to append into.
     * @param token - The heading token.
     */
    private appendHeading(parent: Handle, token: Tokens.Heading): void {
        const depth = Math.min(Math.max(token.depth, HEADING_MIN_DEPTH), HEADING_MAX_DEPTH);
        const heading = this.create("h" + depth);

        DOM.sink.apply(heading, { addClass: [HEADING_CLASS] });
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
     */
    private appendList(parent: Handle, token: Tokens.List): void {
        const list = this.create(token.ordered ? "ol" : "ul");

        DOM.sink.apply(list, { addClass: [LIST_CLASS] });

        for (const item of token.items) {
            this.appendListItem(list, item);
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
     */
    private appendListItem(list: Handle, item: Tokens.ListItem): void {
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
                this.appendBlockToken(listItem, token);
            }
        }

        DOM.sink.appendChild(list, listItem);
    }

    /**
     * Builds a `<blockquote>` and recurses into its block-level children.
     *
     * @param parent - The element handle to append into.
     * @param token - The blockquote token.
     */
    private appendBlockquote(parent: Handle, token: Tokens.Blockquote): void {
        const quote = this.create("blockquote");

        DOM.sink.apply(quote, { addClass: [QUOTE_CLASS] });
        this.appendBlockTokens(quote, token.tokens);
        DOM.sink.appendChild(parent, quote);
    }

    /**
     * Builds a `<pre>` › `<code>` carrying the fenced block's literal text
     * verbatim (newlines preserved).
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
        DOM.sink.appendChild(parent, pre);
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
     * Builds an `<a>` with a safe `target`/`rel` and the link's inline text.
     *
     * @param parent - The element handle to append into.
     * @param token - The link token.
     */
    private appendLink(parent: Handle, token: Tokens.Link): void {
        const anchor = this.create("a");

        DOM.sink.apply(anchor, {
            addClass: [LINK_CLASS],
            setAttr:  { href: token.href, target: "_blank", rel: "noopener noreferrer" },
        });
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

const MarkdownCallable = callable(Markdown);
type MarkdownCallable = Markdown;
export {
    Markdown         as _Markdown,
    MarkdownCallable as Markdown,
};
