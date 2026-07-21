import { callable, DOM, Event, Panel } from '@jimka/typescript-ui/core';
import type { Handle, PanelOptions } from '@jimka/typescript-ui/core';
import { Fit } from '@jimka/typescript-ui/layout';
import { Markdown } from '@jimka/typescript-ui/component/display';
import { Router } from '@jimka/typescript-ui/router';
import { getPage } from '../content/pages.js';
import { resolveDocLink } from '../content/links.js';

/**
 * Renders the not-found view's source for a route with no migrated page —
 * names the path so it reads as an intentional "not yet migrated" state,
 * never as a blank pane or a broken link. A `/api/…` path gets its own
 * message pointing at the published TypeDoc reference, since that one prefix
 * accounts for the large majority of the corpus's dead links — see "The
 * not-found view names the API reference specially" in
 * plans/implemented/docs-content-migration.md.
 *
 * @param path - The route path that has no matching page.
 * @returns Markdown source for the not-found view.
 */
function notFoundSource(path: string): string {
    if (path.startsWith('/api/')) {
        return '# API reference\n\n'
            + 'The generated API reference is not part of this preview. '
            + 'See the [published API reference](https://jimka.github.io/typescript-ui/api/).';
    }

    return `# Not found\n\n\`${path}\` has not been migrated to this preview yet.`;
}

/**
 * The centre content pane: a scrolling `Markdown` viewer showing the page for
 * the current route, with in-app link interception — see "The app intercepts
 * link clicks on its own subtree" in plans/implemented/packages-docs.md.
 */
class DocsContent extends Panel {

    private readonly _router:   Router;
    private readonly _markdown: Markdown;

    // Stable reference so Event.addSubtreeListener always sees the same
    // function identity; delegates to the named handler below.
    private readonly handleLinkClick: (e: MouseEvent) => void = (e) => this.onLinkClick(e);

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

        this._markdown = new Markdown(undefined, { linkResolver: resolveDocLink });
        this.addComponent(this._markdown);

        Event.addSubtreeListener(this, 'click', this.handleLinkClick);
    }

    /**
     * Shows the page at `path` (or the not-found view when unmigrated) and
     * resets the pane's scroll offset to the top.
     *
     * @param path - The route path to show.
     */
    showPath(path: string): void {
        const page = getPage(path);

        this._markdown.setMarkdown(page ? page.source : notFoundSource(path));
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
