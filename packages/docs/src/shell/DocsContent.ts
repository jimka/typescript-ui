import { callable, Component, DOM, Event, ListenerBag, Panel } from '@jimka/typescript-ui/core';
import type { Handle, PanelOptions } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { Insets } from '@jimka/typescript-ui/primitive';
import { Markdown, extractMarkdownHeadings, findActiveHeading } from '@jimka/typescript-ui/component/display';
import type { MarkdownHeading, MarkdownLinkResolution } from '@jimka/typescript-ui/component/display';
import { Router } from '@jimka/typescript-ui/router';
import { getPage } from '../content/pages.js';
import { resolveDocLink, resolveApiLink } from '../content/links.js';
import { apiFileFor, apiDirOf, fetchApiPage } from '../content/api.js';
import { filterInheritedMembers } from '../content/apiMarkdown.js';
import { loadShowInheritedMembers, saveShowInheritedMembers } from '../content/apiPreferences.js';
import { notFoundSource, fetchErrorSource } from '../content/notFound.js';
import { splitBlocks } from '../content/blocks.js';
import type { DocBlock } from '../content/blocks.js';
import { getDemo, missingDemoSource } from '../content/demos.js';
import { DocsDemo } from './DocsDemo.js';

// The path prefix the site is served under — matches the base the app's
// Router is constructed with (see main.ts), so a clicked href counts as a
// route exactly when it falls under this prefix.
const BASE_URL = import.meta.env.BASE_URL;

/**
 * Left margin kept on each prose block's own content box, so the reading
 * column starts indented from the pane's edge the way text sits on a
 * printed page or in a word processor, rather than flush against it —
 * mirrors `MarkdownViewer`'s own `PROSE_LEFT_MARGIN_PX`.
 */
const PROSE_LEFT_MARGIN_PX = 32;

/** String-literal union of the events emitted by {@link DocsContent}. */
type DocsContentEvent = "outlinechange" | "activeheadingchange";

/**
 * The centre content pane: a scrolling, stacked column of blocks — prose
 * `Markdown` segments and live `DocsDemo` demos — showing the page for the
 * current route, with in-app link interception — see "The app intercepts
 * link clicks on its own subtree" in plans/implemented/packages-docs.md and
 * "A page is an ordered list of blocks, split at render time" in
 * plans/implemented/docs-inline-demos.md.
 *
 * Deliberately not a `MarkdownViewer` (a `Markdown` plus a floating minimap
 * and width/zoom controls, bundled for a single document): a page here is a
 * stack of independently-rendered blocks, and some of those blocks are live
 * `DocsDemo` components rather than markdown text at all, so there is no
 * single `Markdown` instance for a `MarkdownViewer` wrapper to own. Rather
 * than force that shape on, `DocsShell` composes the same lower-level pieces
 * directly instead — a `MarkdownMinimap` floated over this pane (via {@link
 * getTextColumnReference}) plus the shared `findActiveHeading` scroll
 * tracking — duplicating `MarkdownViewer`'s own `scrollToHeading` technique
 * locally rather than sharing it. See the "Non-Goals" section of
 * plans/implemented/markdown-viewer-floating-minimap-and-controls.md.
 */
class DocsContent extends Panel {

    private readonly _router: Router;
    private readonly _blocks: Component[] = [];

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

    // null while an authored (bundled) page is shown; the API page's
    // unfiltered fetched source while an API page is shown — kept alongside
    // _linkBaseDir so setShowInheritedMembers can re-filter and re-render
    // without a network re-fetch.
    private _rawApiSource: string | null = null;

    // Bumped on every showPath call; a stale async fetch compares its own
    // token against this before touching the pane, so a slow response for an
    // earlier navigation can never overwrite a later one — see "Fetching
    // makes showPath asynchronous, guarded by a request token" in
    // plans/implemented/docs-typedoc-reference.md.
    private _requestToken = 0;

    // Session cache of fetched API page sources, keyed by generated file
    // path, so a revisited page renders instantly with no network request.
    private readonly _apiSources: Map<string, string> = new Map();

    // Backs the "outlinechange" / "activeheadingchange" events — mirrors
    // Video's own on/off/emit + ListenerBag shape for a re-emitted, non-DOM
    // event.
    private readonly _listeners: ListenerBag<DocsContentEvent> = this.registerListenerBag(new ListenerBag<DocsContentEvent>());

    // The current page's headings, in document order — read by
    // handleNativeScroll to resolve the active heading as the pane scrolls.
    private _headings: MarkdownHeading[] = [];

    // The last id handleNativeScroll emitted, so a native "scroll" tick that
    // doesn't change the resolved heading doesn't re-fire the event.
    private _lastActiveHeadingId: string | null = null;

    // The scrollTop scrollToHeading last landed the pane on, or null once a
    // later native scroll has moved past it. Lets onNativeScroll recognise
    // "nothing has organically scrolled since that click" and skip
    // re-deriving the active heading from geometry alone — see both methods'
    // own doc comments for why that re-derivation can't be trusted here.
    private _pendingClickScrollTop: number | null = null;

    // Stable reference so Event.addSubtreeListener always sees the same
    // function identity; delegates to the named handler below.
    private readonly handleLinkClick: (e: MouseEvent) => void = (e) => this.onLinkClick(e);

    // Stable reference, mirroring handleLinkClick above.
    private readonly handleNativeScroll: () => void = () => this.onNativeScroll();

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
        super(options, { layoutManager: VBox({ stretching: true, spacing: 0 }), autoScroll: 'y' });

        this._router = router;

        Event.addSubtreeListener(this, 'click', this.handleLinkClick);
        Event.addSubtreeListener(this, 'scroll', this.handleNativeScroll);
    }

    /**
     * The current page's first block — a reasonable proxy for "the page's
     * rendered prose column" (see `DocsShell`, which hugs its floating
     * minimap against this). Deliberately re-read live rather than cached:
     * {@link showBlocks} replaces `_blocks` wholesale on every navigation, so
     * a caller holding onto a stale reference across a page change would end
     * up hugging a disposed block.
     *
     * @returns The first block, or `null` before any page has rendered.
     */
    getTextColumnReference(): Component | null {
        return this._blocks[0] ?? null;
    }

    /**
     * Registers a listener for `"outlinechange"`, fired with the current
     * page's heading outline every time {@link renderContent} renders one —
     * a real navigation via {@link showSource}, or an in-place re-render via
     * {@link setShowInheritedMembers}.
     *
     * @param event - `"outlinechange"`.
     * @param listener - Invoked with the page's headings, in document order.
     *
     * @returns This component, for method chaining.
     */
    on(event: "outlinechange", listener: (headings: MarkdownHeading[]) => void): this;

    /**
     * Registers a listener for `"activeheadingchange"`, fired with the id of
     * whichever heading is currently topmost in the pane's viewport as it
     * scrolls, or `null` before any heading has scrolled into view.
     *
     * @param event - `"activeheadingchange"`.
     * @param listener - Invoked with the active heading's id, or `null`.
     *
     * @returns This component, for method chaining.
     */
    on(event: "activeheadingchange", listener: (headingId: string | null) => void): this;
    on(event: DocsContentEvent, listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered `"outlinechange"` listener.
     *
     * @param event - `"outlinechange"`.
     * @param listener - The exact callback reference to remove.
     *
     * @returns This component, for method chaining.
     */
    off(event: "outlinechange", listener: (headings: MarkdownHeading[]) => void): this;

    /**
     * Removes a previously registered `"activeheadingchange"` listener.
     *
     * @param event - `"activeheadingchange"`.
     * @param listener - The exact callback reference to remove.
     *
     * @returns This component, for method chaining.
     */
    off(event: "activeheadingchange", listener: (headingId: string | null) => void): this;
    off(event: DocsContentEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fans `"outlinechange"` out to its registered listeners.
     *
     * @param event - `"outlinechange"`.
     * @param headings - The current page's headings, in document order.
     */
    protected emit(event: "outlinechange", headings: MarkdownHeading[]): void;

    /**
     * Fans `"activeheadingchange"` out to its registered listeners.
     *
     * @param event - `"activeheadingchange"`.
     * @param headingId - The active heading's id, or `null`.
     */
    protected emit(event: "activeheadingchange", headingId: string | null): void;
    protected emit(event: DocsContentEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
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
            this._rawApiSource = null;
            this.showSource(page.source);
            return;
        }

        const file = apiFileFor(path);
        if (file === null) {
            this._linkBaseDir = null;
            this._rawApiSource = null;
            this.showSource(notFoundSource(path));
            return;
        }

        const cached = this._apiSources.get(file);
        if (cached !== undefined) {
            this._linkBaseDir = apiDirOf(file);
            this.renderApiSource(cached);
            return;
        }

        fetchApiPage(file).then(
            (source) => {
                this._apiSources.set(file, source);
                if (token === this._requestToken) {
                    this._linkBaseDir = apiDirOf(file);
                    this.renderApiSource(source);
                }
            },
            () => {
                if (token === this._requestToken) {
                    this._linkBaseDir = null;
                    this._rawApiSource = null;
                    this.showSource(fetchErrorSource(path));
                }
            },
        );
    }

    /**
     * Renders an API page's fetched source, filtered per the reader's
     * current inherited-members preference, and remembers the unfiltered
     * source so {@link setShowInheritedMembers} can re-filter and re-render
     * without a network re-fetch.
     *
     * @param source - The API page's fetched (and already normalized) source.
     */
    private renderApiSource(source: string): void {
        this._rawApiSource = source;
        this.showSource(loadShowInheritedMembers() ? source : filterInheritedMembers(source));
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
        this.renderContent(source);
        this.applyFragment(this._targetFragment);
    }

    /**
     * Splits `source` into blocks, emits its heading outline, and rebuilds
     * the pane's rendered blocks — the part of {@link showSource} that both
     * a real navigation and {@link setShowInheritedMembers} (an in-place
     * re-render with no fragment change) need. Kept separate from {@link
     * showSource} so a toggle click doesn't also re-run {@link applyFragment},
     * which would snap a scrolled-down reader back to the top on every click.
     *
     * @param source - The Markdown source to render.
     */
    private renderContent(source: string): void {
        const blocks = splitBlocks(source);

        this.emitOutline(blocks);
        this.showBlocks(blocks);
    }

    /**
     * Whether the page currently shown is a generated API reference page,
     * rather than an authored page or the not-found/fetch-error view.
     *
     * @returns `true` while an API page is shown.
     */
    isApiPage(): boolean {
        return this._linkBaseDir !== null;
    }

    /**
     * Shows or hides inherited members on the currently shown API page, and
     * persists the choice for future pages. A no-op on the rendered content
     * when no API page is shown (the preference still saves, for the next
     * API page to read) — see {@link renderApiSource} for the read side.
     *
     * @param value - `true` to show inherited members, `false` to hide them.
     */
    setShowInheritedMembers(value: boolean): void {
        saveShowInheritedMembers(value);

        if (this._rawApiSource === null) {
            return;
        }

        this.renderContent(value ? this._rawApiSource : filterInheritedMembers(this._rawApiSource));
    }

    /**
     * Fires `"outlinechange"` with the full page's heading outline: every
     * `markdown` block's headings, concatenated in document order. A `demo`
     * block contributes nothing — a live demo's rendered content is not
     * statically knowable.
     *
     * @param blocks - The page's blocks, in document order.
     */
    private emitOutline(blocks: DocBlock[]): void {
        const headings = blocks.flatMap((block) =>
            block.kind === 'markdown' ? extractMarkdownHeadings(block.source) : []);

        this._headings = headings;
        this.emit('outlinechange', headings);
    }

    /**
     * Replaces the pane's blocks with `blocks`: disposes every outgoing
     * block, empties the component tree, then builds and adds the incoming
     * ones — the dispose-then-empty-then-rebuild order `MenuBar.setMenus`
     * uses, load-bearing because `removeAllComponents` does not dispose and
     * `dispose()` does not unparent.
     *
     * @param blocks - The page's blocks, in document order.
     */
    private showBlocks(blocks: DocBlock[]): void {
        for (const block of this._blocks) {
            block.dispose();
        }

        this._blocks.length = 0;
        this.removeAllComponents();

        for (const block of blocks) {
            this._blocks.push(this.buildBlock(block));
        }

        for (const component of this._blocks) {
            this.addComponent(component);
        }

        this.scheduleLayout();
    }

    /**
     * Builds the component for one block: a prose segment renders through
     * the shared link resolver; a demo resolves its id through the demo
     * registry, falling back to {@link missingDemoSource} when the id has
     * no registered module — a mismatch between two independently edited
     * artefacts, not a code bug.
     *
     * @param block - The block to build.
     * @returns The component to add to the pane.
     */
    private buildBlock(block: DocBlock): Component {
        const proseMargin = new Insets(0, 0, 0, PROSE_LEFT_MARGIN_PX);

        if (block.kind === 'markdown') {
            return new Markdown(block.source, { linkResolver: this.resolveLink, padding: proseMargin });
        }

        const entry = getDemo(block.id);

        return entry !== null ? new DocsDemo(entry) : new Markdown(missingDemoSource(block.id), { padding: proseMargin });
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
            // Clears a callback an earlier call may have queued (see
            // onScrollToFragment) so it finds null and no-ops instead of
            // scrolling back down to a stale fragment after this scroll-to-top
            // has already run.
            this._pendingFragment = null;
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
     * link. The walk stops the moment it crosses a `DocsDemo`'s own element
     * (marked `data-docs-demo`), so a link inside a live demo's own content
     * — a `Link` component, a nested `Markdown` — is left to the demo rather
     * than driving the docs router.
     *
     * @param node - The event target's element handle.
     * @returns The `<a>` handle, or `null` if `node` has no anchor ancestor
     *   before reaching a demo boundary.
     */
    private closestAnchor(node: Handle | null): Handle | null {
        let current = node;

        while (current) {
            if (DOM.source.getAttribute(current, 'data-docs-demo') !== null) {
                return null;
            }

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
        this._pendingClickScrollTop = this.getScrollTop();

        // Marks `id` active immediately rather than waiting for the
        // resulting native scroll event to drive that through
        // findActiveHeading: a heading close to the document's end can share
        // its clamped landing scrollTop with a neighbouring heading, and
        // geometry alone then can't tell which of them this click actually
        // targeted (see findActiveHeading's own doc comment).
        if (id !== this._lastActiveHeadingId) {
            this._lastActiveHeadingId = id;
            this.emit('activeheadingchange', id);
        }
    }

    /**
     * Computes the active heading from the current native scroll position and
     * emits `"activeheadingchange"` only when it differs from the previous
     * tick. A no-op while the pane is still sitting exactly where {@link
     * scrollToHeading} last left it (see `_pendingClickScrollTop`'s own doc
     * comment) — geometry alone can't be trusted to reproduce that click's
     * own target there, so this defers to whatever it already set.
     */
    private onNativeScroll(): void {
        const scrollElement = this.getScrollElement();

        if (!scrollElement) {
            return;
        }

        if (this._pendingClickScrollTop !== null) {
            // Reads the live DOM value, not the cached getScrollTop(): an
            // organic scroll (wheel, scrollbar drag) updates the pane's real
            // scrollTop without ever going through setScrollTop, so the cache
            // would otherwise still read the click's own landing spot forever.
            if (DOM.source.getScrollTop(scrollElement) === this._pendingClickScrollTop) {
                return;
            }

            this._pendingClickScrollTop = null;
        }

        const id = findActiveHeading(scrollElement, this._headings);

        if (id === this._lastActiveHeadingId) {
            return;
        }

        this._lastActiveHeadingId = id;
        this.emit('activeheadingchange', id);
    }
}

const DocsContentCallable = callable(DocsContent);
type DocsContentCallable = DocsContent;
export {
    DocsContent         as _DocsContent,
    DocsContentCallable as DocsContent,
};
