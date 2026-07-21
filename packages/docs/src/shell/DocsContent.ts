import { callable, DOM, Event, Panel } from '@jimka/typescript-ui/core';
import type { Handle, PanelOptions } from '@jimka/typescript-ui/core';
import { Fit } from '@jimka/typescript-ui/layout';
import { Markdown } from '@jimka/typescript-ui/component/display';
import type { MarkdownLinkResolution } from '@jimka/typescript-ui/component/display';
import { Router } from '@jimka/typescript-ui/router';
import { getPage } from '../content/pages.js';
import { resolveDocLink, resolveApiLink } from '../content/links.js';
import { apiFileFor, apiDirOf, fetchApiPage } from '../content/api.js';
import { notFoundSource, fetchErrorSource } from '../content/notFound.js';

/**
 * The centre content pane: a scrolling `Markdown` viewer showing the page for
 * the current route, with in-app link interception — see "The app intercepts
 * link clicks on its own subtree" in plans/implemented/packages-docs.md.
 */
class DocsContent extends Panel {

    private readonly _router:   Router;
    private readonly _markdown: Markdown;

    // null while an authored (bundled) page is shown; the rendered API page's
    // directory while an API page is shown — resolveLink reads this to decide
    // which link-resolution rule the current page's links need.
    private _linkBaseDir: string | null = null;

    // Bumped on every showPath call; a stale async fetch compares its own
    // token against this before touching the pane, so a slow response for an
    // earlier navigation can never overwrite a later one — see "Fetching
    // makes showPath asynchronous, guarded by a request token" in
    // plans/implemented/docs-typedoc-reference.md.
    private _requestToken = 0;

    // Session cache of fetched API page sources, keyed by generated file
    // path, so a revisited page renders instantly with no network request.
    private readonly _apiSources: Map<string, string> = new Map();

    // Stable reference so Event.addSubtreeListener always sees the same
    // function identity; delegates to the named handler below.
    private readonly handleLinkClick: (e: MouseEvent) => void = (e) => this.onLinkClick(e);

    // Stable reference, mirroring handleLinkClick above: Markdown calls this
    // on every render, and which rule applies depends on _linkBaseDir at that
    // moment, so it can't be bound once to either resolver.
    private readonly resolveLink: (href: string) => MarkdownLinkResolution = (href) =>
        (this._linkBaseDir === null ? resolveDocLink(href) : resolveApiLink(href, this._linkBaseDir));

    constructor(router: Router, options?: PanelOptions) {
        super(options, { layoutManager: Fit() });

        this._router = router;

        // autoScroll cannot ride the subclass-defaults bag the way
        // layoutManager does: Panel.applyOptions always dispatches
        // setAutoScroll(options.autoScroll ?? "none"), which never consults
        // _defaultOptions, so a default here would be overwritten with "none"
        // and the pane would silently stop scrolling. Set it at runtime until
        // that is fixed — see plans/panel-scroll-option-defaults.md.
        this.setAutoScroll('y');

        this._markdown = new Markdown(undefined, { linkResolver: this.resolveLink });
        this.addComponent(this._markdown);

        Event.addSubtreeListener(this, 'click', this.handleLinkClick);
    }

    /**
     * Shows the page at `path`: an authored page renders synchronously; an
     * API page renders from cache when already fetched this session, or
     * starts a fetch and renders once it resolves; a path matching neither
     * shows the not-found view. See "DocsContent state and flow" in
     * plans/implemented/docs-typedoc-reference.md for the five-branch flow.
     *
     * @param path - The route path to show.
     */
    showPath(path: string): void {
        const token = ++this._requestToken;

        const page = getPage(path);
        if (page) {
            this._linkBaseDir = null;
            this.showSource(page.source);
            return;
        }

        const file = apiFileFor(path);
        if (file === null) {
            this._linkBaseDir = null;
            this.showSource(notFoundSource(path));
            return;
        }

        const cached = this._apiSources.get(file);
        if (cached !== undefined) {
            this._linkBaseDir = apiDirOf(file);
            this.showSource(cached);
            return;
        }

        fetchApiPage(file).then(
            (source) => {
                this._apiSources.set(file, source);
                if (token === this._requestToken) {
                    this._linkBaseDir = apiDirOf(file);
                    this.showSource(source);
                }
            },
            () => {
                if (token === this._requestToken) {
                    this._linkBaseDir = null;
                    this.showSource(fetchErrorSource(path));
                }
            },
        );
    }

    /**
     * Shows `source` in the viewer and resets the pane's scroll offset to the
     * top — the tail shared by every branch of {@link showPath}.
     *
     * @param source - The Markdown source to render.
     */
    private showSource(source: string): void {
        this._markdown.setMarkdown(source);
        this.setScrollTop(0);
    }

    /**
     * Intercepts a click on an authored `<a>` in the rendered Markdown.
     * Interception is load-bearing, not a convenience: a bare `#fragment` href
     * would otherwise change the hash natively and hand the router an
     * unmatchable path — see "Interception is load-bearing" in
     * plans/implemented/packages-docs.md.
     *
     * @param e - The bubbled click event.
     */
    private onLinkClick(e: MouseEvent): void {
        if (!(e instanceof MouseEvent) || e.target === null) {
            return;
        }

        const anchor = this.closestAnchor(DOM.source.intern(e.target));

        if (!anchor) {
            return;
        }

        const href = DOM.source.getAttribute(anchor, 'href');

        if (href === null) {
            return;
        }

        if (href.startsWith('#/')) {
            e.preventDefault();
            this._router.navigate(href.slice(1));
        } else if (href.startsWith('#')) {
            e.preventDefault();
            this.scrollToHeading(href.slice(1));
        }
        // Anything else (external hrefs) is left to the browser.
    }

    /**
     * Walks up from `node` to the nearest ancestor `<a>`, so a click on an
     * inline element inside a link (e.g. `<strong>`) still resolves to the
     * link.
     *
     * @param node - The event target's element handle.
     * @returns The `<a>` handle, or `null` if `node` has no anchor ancestor.
     */
    private closestAnchor(node: Handle | null): Handle | null {
        let current = node;

        while (current) {
            if (DOM.source.getTagName(current) === 'A') {
                return current;
            }

            current = DOM.source.getParentElement(current);
        }

        return null;
    }

    /**
     * Scrolls the pane so the heading with `id` sits at its top. A miss (no
     * heading with that id) scrolls nowhere.
     *
     * @param id - The heading's slugified id, from an in-page `#fragment` href.
     */
    private scrollToHeading(id: string): void {
        const scrollElement = this.getScrollElement();

        if (!scrollElement) {
            return;
        }

        const heading = DOM.source.querySelector(scrollElement, '#' + id);

        if (!heading) {
            return;
        }

        const headingTop = DOM.source.getElementRect(heading).top;
        const paneTop     = DOM.source.getElementRect(scrollElement).top;

        this.setScrollTop(this.getScrollTop() + (headingTop - paneTop));
    }
}

const DocsContentCallable = callable(DocsContent);
type DocsContentCallable = DocsContent;
export {
    DocsContent         as _DocsContent,
    DocsContentCallable as DocsContent,
};
