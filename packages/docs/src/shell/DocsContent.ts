import { callable, Component, DOM, Event, Panel } from '@jimka/typescript-ui/core';
import type { Handle, PanelOptions } from '@jimka/typescript-ui/core';
import { Fit } from '@jimka/typescript-ui/layout';
import { Markdown } from '@jimka/typescript-ui/component/display';
import type { MarkdownLinkResolution } from '@jimka/typescript-ui/component/display';
import { Router } from '@jimka/typescript-ui/router';
import { getPage } from '../content/pages.js';
import { resolveDocLink, resolveApiLink } from '../content/links.js';
import { apiFileFor, apiDirOf, fetchApiPage } from '../content/api.js';
import { notFoundSource, fetchErrorSource } from '../content/notFound.js';

// The path prefix the site is served under — matches the base the app's
// Router is constructed with (see main.ts), so a clicked href counts as a
// route exactly when it falls under this prefix.
const BASE_URL = import.meta.env.BASE_URL;

/**
 * The centre content pane: a scrolling `Markdown` viewer showing the page for
 * the current route, with in-app link interception — see "The app intercepts
 * link clicks on its own subtree" in plans/implemented/packages-docs.md.
 */
class DocsContent extends Panel {

    private readonly _router:   Router;
    private readonly _markdown: Markdown;

    // The path currently rendered, or null before the first showPath call —
    // showPath skips re-rendering when the incoming path is unchanged, so a
    // fragment-only navigation only scrolls.
    private _path: string | null = null;

    // The fragment the most recent showPath call asked for, written
    // unconditionally at the top of every call. showSource reads this
    // rather than taking a fragment parameter, so a still-in-flight API
    // fetch started by an earlier call applies whatever fragment is current
    // by the time it resolves, not the one closed over when it started —
    // otherwise a second same-path navigation arriving before the first
    // fetch settles would have its fragment overwritten by the stale one.
    private _targetFragment: string = '';

    // The fragment to scroll to once the next layout flush settles the
    // pane's scroll extent, or null when nothing is pending. Overwritten by
    // a second navigation arriving before the callback drains, so the last
    // target wins.
    private _pendingFragment: string | null = null;

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

    // Stable reference, mirroring handleLinkClick above: Component.afterNextLayout
    // needs the same function identity every call; delegates to the named
    // handler below.
    private readonly handleScrollToFragment: () => void = () => this.onScrollToFragment();

    // Stable reference, mirroring handleLinkClick above: Markdown calls this
    // on every render, and which rule applies depends on _linkBaseDir at that
    // moment, so it can't be bound once to either resolver.
    private readonly resolveLink: (href: string) => MarkdownLinkResolution = (href) =>
        (this._linkBaseDir === null ? resolveDocLink(href, this._router) : resolveApiLink(href, this._linkBaseDir, this._router));

    constructor(router: Router, options?: PanelOptions) {
        super(options, { layoutManager: Fit(), autoScroll: 'y' });

        this._router = router;

        this._markdown = new Markdown(undefined, { linkResolver: this.resolveLink });
        this.addComponent(this._markdown);

        Event.addSubtreeListener(this, 'click', this.handleLinkClick);
    }

    /**
     * Shows the page at `path`, then scrolls to `fragment`'s heading — or to
     * the top when `fragment` is `""`. Re-rendering only happens when `path`
     * differs from the page already shown, so a fragment-only navigation
     * (the same page, a new fragment) just scrolls. When it does re-render:
     * an authored page renders synchronously; an API page renders from cache
     * when already fetched this session, or starts a fetch and renders once
     * it resolves; a path matching neither shows the not-found view. See
     * "DocsContent state and flow" in plans/implemented/docs-typedoc-reference.md
     * for the five-branch flow.
     *
     * @param path - The route path to show.
     * @param fragment - The URL fragment to scroll to, without its `"#"`, or
     * `""` to scroll to the top.
     */
    showPath(path: string, fragment: string): void {
        this._targetFragment = fragment;

        if (path === this._path) {
            this.applyFragment(fragment);
            return;
        }

        this._path = path;

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
     * Shows `source` in the viewer, then applies {@link _targetFragment} —
     * the tail shared by every re-rendering branch of {@link showPath}.
     * Reading the field rather than taking a fragment parameter matters for
     * the async fetch branch: by the time a fetch resolves, a later
     * same-path `showPath` call may have asked for a different fragment,
     * and {@link _targetFragment} always holds that latest one.
     *
     * @param source - The Markdown source to render.
     */
    private showSource(source: string): void {
        this._markdown.setMarkdown(source);
        this.applyFragment(this._targetFragment);
    }

    /**
     * Scrolls to the top when `fragment` is `""`; otherwise queues a scroll
     * to its heading for after the next layout flush. The heading ids exist
     * as soon as `setMarkdown` returns, but the pane's scrollable extent does
     * not: `Markdown.measureContentHeight` schedules the parent's layout, and
     * a scroll offset past a stale extent is clamped away.
     *
     * @param fragment - The URL fragment to scroll to, without its `"#"`, or
     * `""` to scroll to the top.
     */
    private applyFragment(fragment: string): void {
        if (fragment === '') {
            this.setScrollTop(0);
            return;
        }

        this._pendingFragment = fragment;
        Component.afterNextLayout(this.handleScrollToFragment);
    }

    /**
     * Flushes the pane's own layout (folding Markdown's measured height into
     * its scroll extent), resyncs the scroll cache, and scrolls to the
     * pending fragment's heading. A second navigation arriving before this
     * callback drains overwrites {@link _pendingFragment}, so the last
     * target wins and this finds `null`.
     *
     * The resync matters only on a cold direct load: the browser's own
     * fragment-identifier handling scrolls the pane's real scrollable
     * element natively as soon as the matching id appears in the DOM,
     * bypassing {@link Component.setScrollTop} and leaving the cached
     * `scrollTop` at its construction-time `0` — see {@link syncScrollOffsets}.
     * Computing this component's delta-based scroll against that stale cache
     * would then discard the browser's own scroll instead of refining it. A
     * client-side navigation (`pushState`, no real page load) never triggers
     * that native behaviour, so the resync is a no-op there.
     */
    private onScrollToFragment(): void {
        const fragment = this._pendingFragment;

        this._pendingFragment = null;

        if (fragment === null) {
            return;
        }

        this.flushLayout();
        this.syncScrollOffsets();
        this.scrollToHeading(fragment);
    }

    /**
     * Intercepts a click on an authored `<a>` in the rendered Markdown.
     * Interception is load-bearing for an in-page `#fragment` href, which
     * would otherwise change the hash natively and hand the router an
     * unmatchable path — see "Interception is load-bearing" in
     * plans/implemented/packages-docs.md. Both a bare `#fragment` href and a
     * route href now route through `Router.navigate`, so the URL gains the
     * fragment and the back button returns to the previous anchor either
     * way. A modified click (Ctrl, Cmd, Shift, Alt, or a non-primary button)
     * is left to the browser before anything else is checked, the same as it
     * would be for any other link.
     *
     * @param e - The bubbled click event.
     */
    private onLinkClick(e: MouseEvent): void {
        if (!(e instanceof MouseEvent) || e.target === null) {
            return;
        }

        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) {
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

        if (href.startsWith('#')) {
            e.preventDefault();
            this._router.navigate(this._router.getPath() + '#' + href.slice(1));
        } else if (href === BASE_URL || href.startsWith(BASE_URL)) {
            const path     = this._router.getPath(href);
            const fragment = this._router.getFragment(href);

            e.preventDefault();
            this._router.navigate(fragment === '' ? path : `${path}#${fragment}`);
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
     * Scrolls the pane so the heading with `id` sits at its top. The id is
     * looked up document-wide (an id is unique per document, and a fragment
     * is attacker-controlled text — `getElementById` takes it as data rather
     * than building a CSS selector from it, which a leading digit or stray
     * character could break or exploit) and rejected when it is not inside
     * the pane. A miss scrolls nowhere.
     *
     * @param id - The heading's slugified id, from an in-page `#fragment` href.
     */
    private scrollToHeading(id: string): void {
        const scrollElement = this.getScrollElement();

        if (!scrollElement) {
            return;
        }

        const heading = DOM.source.getElementById(id);

        if (!heading || !DOM.source.contains(scrollElement, heading)) {
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
