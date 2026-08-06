import { callable, Panel }                  from '@jimka/typescript-ui/core';
import type { PanelOptions }                from '@jimka/typescript-ui/core';
import { Border }                           from '@jimka/typescript-ui/layout';
import { Tree }                             from '@jimka/typescript-ui/component/tree';
import type { TreeNode }                    from '@jimka/typescript-ui/component/tree';
import { TextField }                        from '@jimka/typescript-ui/component/input';
import { extractMarkdownHeadings }          from '@jimka/typescript-ui/component/display';
import { Router }                           from '@jimka/typescript-ui/router';
import { getNav, getPage }                  from '../content/pages.js';
import type { NavGroup, NavEntry }          from '../content/pages.js';
import { API_PREFIX, getApiNav, isApiPath } from '../content/api.js';
import type { ApiNavNode }                  from '../content/api.js';
import { Insets, Placement }                from '@jimka/typescript-ui/primitive';

/** One tree node's searchable text, keyed by its route path. */
interface SearchEntry {
    /** The node's own displayed label, plus the page's authored `#` title for an authored page. */
    titles:   string[];
    /** Heading text from the page's source; always `[]` for an API-reference node. */
    headings: string[];
}

// Wide enough for the longest nav label ("Linking a local library checkout"),
// which sits one indent level deeper than any Phase-1 label, without
// wrapping. Height is 0 because the sidebar sits in a Border WEST region,
// which reads only the width.
const SIDEBAR_WIDTH = 320;

// TextField's own default padding (Insets(3, 3, 3, 3)) reads as cramped for
// this field: it sits flush against the sidebar's own edges (DocsSidebar's
// insets are 0 on every side) at the top of a Border NORTH region, with
// nothing else to give the typed text breathing room. 8px horizontal and 6px
// vertical are a deliberate, larger-than-default pair chosen to match the
// visual weight of the tree rows sitting directly beneath it.
const SEARCH_FIELD_PADDING = new Insets(6, 8, 6, 8);

/**
 * The west sidebar: a search field docked above a `Tree` built from
 * {@link getNav}'s seven sections, routing a selection to the `Router` and
 * reflecting a URL-driven page change back into the tree via {@link select}.
 * Typing in the search field filters the tree to nodes whose title or
 * heading text matches, via {@link onQueryChange}. `Tree` virtual-scrolls
 * itself, so this hosts it directly with no `autoScroll` wrapper.
 */
class DocsSidebar extends Panel {

    private readonly _router: Router;
    private readonly _tree:   Tree;

    /** Every leaf page node, keyed by its route path, for {@link select}. */
    private readonly _nodesByPath: Map<string, TreeNode> = new Map();

    private readonly _searchField: TextField;
    private readonly _fullNodes:   TreeNode[];
    private readonly _searchIndex: Map<string, SearchEntry>;

    // Stable reference so Tree.off would find the same identity; delegates to
    // the named handler below.
    private readonly handleSelection: (nodes: TreeNode[]) => void = (nodes) => this.onSelection(nodes);

    // Stable reference for the same reason as handleSelection above.
    private readonly handleQueryChange: () => void = () => this.onQueryChange();

    constructor(router: Router, options?: PanelOptions) {
        // Hand the layout manager and width to Component as subclass defaults
        // so a caller-supplied option still wins — Component merges
        // `{...defaults, ...options}` at dispatch time.
        super(options, {
            layoutManager: Border(),
            preferredSize: { width: SIDEBAR_WIDTH, height: 0 },
            insets: new Insets(0, 0, 0, 0)
        });

        this._router = router;

        this._fullNodes   = this.buildNodes();
        this._searchIndex = this.buildSearchIndex(this._fullNodes);

        this._searchField = TextField({
            placeholder: 'Search docs…',
            padding:     SEARCH_FIELD_PADDING,
            listeners: {
                action: this.handleQueryChange
            }
        });

        this._tree = Tree({
            backgroundColor: "transparent",
            insets: new Insets(20, 0, 0, 20),
            listeners: {
                selection: this.handleSelection
            }
        });
        this._tree.setNodes(this._fullNodes);
        // Guide and Reference are the two sections a developer needs most often;
        // expanded by default so their pages are one click away on first load.
        // Both paths are guaranteed to resolve — getNav() always includes them.
        this._tree.expandNode(this._nodesByPath.get('/guide')!);
        this._tree.expandNode(this._nodesByPath.get('/reference')!);

        this.addComponent(this._searchField, { placement: Placement.NORTH });
        this.addComponent(this._tree,        { placement: Placement.CENTER });
    }

    /**
     * Reveals and selects the tree node for `path`, expanding exactly the
     * ancestors on the path to it — see "The sidebar becomes a three-level
     * tree" in plans/implemented/docs-content-migration.md. A miss (path not
     * in the nav table) returns without touching the tree. Freely re-enters
     * `Router.navigate` through the "selection" listener — see "Sidebar ↔
     * router feedback loop" in plans/implemented/packages-docs.md.
     *
     * @param path - The route path to select.
     */
    async select(path: string): Promise<void> {
        const node = this._nodesByPath.get(path);

        if (node) {
            if (this._searchField.getValue() !== '') {
                this._searchField.setValue('');
                this._tree.setNodes(this._fullNodes);
            }

            await this._tree.revealByPredicate((data) => data === path);
            this._tree.selectNode(node);
        }
    }

    /**
     * Builds the `Tree`'s root nodes: {@link getNav}'s seven authored-page
     * sections, followed by an eighth "API Reference" root driven by
     * {@link getApiNav}, which derives the tree from the generated file list
     * — see "The API nav tree is derived from `apiFiles`" in
     * plans/implemented/docs-sidebar-index-and-kind-grouping.md.
     * Every leaf page node's path is recorded in {@link _nodesByPath} as it goes.
     *
     * @returns The root {@link TreeNode} array for `Tree.setNodes`.
     */
    private buildNodes(): TreeNode[] {
        return [
            ...getNav().map((group) => this.buildGroupNode(group)),
            this.buildApiNode({ label: 'API Reference', path: API_PREFIX, children: getApiNav() }),
        ];
    }

    /**
     * Recursively builds a group's `TreeNode`, its nested subgroups first and
     * its own pages after — see "Building the tree nodes" in
     * plans/implemented/docs-content-migration.md. The node itself carries the
     * section's own route, recorded in {@link _nodesByPath} when present.
     *
     * @param group - The nav group to build a node for.
     * @returns The group's {@link TreeNode}.
     */
    private buildGroupNode(group: NavGroup): TreeNode {
        const node: TreeNode = {
            label:    group.title,
            data:     group.path,
            children: [
                ...(group.groups ?? []).map((child) => this.buildGroupNode(child)),
                ...group.pages.map((page) => this.buildPageNode(page)),
            ],
        };

        if (group.path !== undefined) {
            this._nodesByPath.set(group.path, node);
        }

        return node;
    }

    /**
     * Builds a leaf page's `TreeNode`, recording its path in
     * {@link _nodesByPath} as it goes.
     *
     * @param page - The nav entry to build a leaf node for.
     * @returns The page's {@link TreeNode}.
     */
    private buildPageNode(page: NavEntry): TreeNode {
        const node: TreeNode = { label: page.label, data: page.path };

        this._nodesByPath.set(page.path, node);

        return node;
    }

    /**
     * Recursively builds an {@link ApiNavNode}'s `TreeNode`, recording its
     * path in {@link _nodesByPath} when it has one — a grouping-only node
     * (e.g. a module's `Classes` kind directory, which has no page of its
     * own) is built the same way but simply never gets an entry.
     *
     * @param node - The API nav node to build a `TreeNode` for.
     * @returns The node's {@link TreeNode}.
     */
    private buildApiNode(node: ApiNavNode): TreeNode {
        const treeNode: TreeNode = {
            label:    node.label,
            data:     node.path ?? undefined,
            children: node.children.map((child) => this.buildApiNode(child)),
        };

        if (node.path !== null) {
            this._nodesByPath.set(node.path, treeNode);
        }

        return treeNode;
    }

    /**
     * Walks the already-built tree once, recording each navigable node's
     * searchable text — see "The search index is built once, at
     * `DocsSidebar` construction" in plans/implemented/docs-sidebar-search.md.
     *
     * @param nodes - The root {@link TreeNode} array to index.
     * @returns The search index, keyed by route path.
     */
    private buildSearchIndex(nodes: TreeNode[]): Map<string, SearchEntry> {
        const index = new Map<string, SearchEntry>();

        const visit = (node: TreeNode): void => {
            if (typeof node.data === 'string') {
                index.set(node.data, this.searchEntryFor(node.data, node.label));
            }
            (node.children ?? []).forEach(visit);
        };

        nodes.forEach(visit);

        return index;
    }

    /**
     * Builds one node's {@link SearchEntry} — label only for an API-reference
     * node, label plus authored title and heading text for an authored page.
     *
     * @param path - The node's route path.
     * @param label - The node's displayed tree label.
     * @returns The node's searchable text.
     */
    private searchEntryFor(path: string, label: string): SearchEntry {
        if (isApiPath(path)) {
            return { titles: [label], headings: [] };
        }

        const page = getPage(path)!; // pages.ts's requireAll() already guarantees this resolves.

        return {
            titles:   [label, page.title],
            headings: extractMarkdownHeadings(page.source).map((h) => h.text),
        };
    }

    /**
     * Tests whether `path`'s indexed titles or headings contain `query` as a
     * case-insensitive substring.
     *
     * @param path - The node's route path.
     * @param query - The already-lower-cased search query.
     * @returns Whether `path` matches `query`.
     */
    private matchesQuery(path: string, query: string): boolean {
        const entry = this._searchIndex.get(path);
        if (!entry) return false;

        return entry.titles.some((t) => t.toLowerCase().includes(query))
            || entry.headings.some((h) => h.toLowerCase().includes(query));
    }

    /**
     * Recursively filters `nodes` to those matching `query`, either directly
     * or through a descendant — see "Filtering rebuilds `TreeNode[]` by
     * walking the already-built tree" in
     * plans/implemented/docs-sidebar-search.md.
     *
     * @param nodes - The nodes to filter.
     * @param query - The already-lower-cased search query.
     * @returns The filtered nodes, in their original order.
     */
    private filterNodes(nodes: TreeNode[], query: string): TreeNode[] {
        const kept: TreeNode[] = [];

        for (const node of nodes) {
            const hadChildren       = (node.children?.length ?? 0) > 0;
            const filteredChildren  = hadChildren ? this.filterNodes(node.children!, query) : [];
            const selfMatches       = typeof node.data === 'string' && this.matchesQuery(node.data, query);

            if (!selfMatches && filteredChildren.length === 0) {
                continue;
            }

            // A group node is always rebuilt with its filtered children — even
            // when that is `[]` — so a self-match on a group whose own page
            // matched but none of whose children did does not pull the
            // non-matching originals back in. A leaf (no children to begin
            // with) is pushed unchanged.
            kept.push(hadChildren ? { ...node, children: filteredChildren } : node);
        }

        return kept;
    }

    /**
     * Re-filters the tree from {@link _searchField}'s current value, called
     * on every keystroke. Restores the unfiltered tree when the field is
     * empty.
     */
    private onQueryChange(): void {
        const query = this._searchField.getValue().trim().toLowerCase();

        if (query === '') {
            this._tree.setNodes(this._fullNodes);
            return;
        }

        this._tree.setNodes(this.filterNodes(this._fullNodes, query));
        this._tree.expandAll();
    }

    private onSelection(nodes: TreeNode[]): void {
        const node = nodes[0];

        if (!node || node.data === undefined) {
            return;
        }

        if (node.data === this._router.getPath()) {
            // Reflecting the current route (DocsShell.showPath just called
            // select(), which fired this listener), not a user action. A
            // bare-path navigate() here would widen-guard past a fragment
            // already in the URL and strip it — see "The sidebar can strip
            // the fragment it was just given" in
            // plans/implemented/docs-fragment-navigation.md.
            return;
        }

        this._router.navigate(node.data as string);
    }
}

const DocsSidebarCallable = callable(DocsSidebar);
type DocsSidebarCallable = DocsSidebar;
export {
    DocsSidebar         as _DocsSidebar,
    DocsSidebarCallable as DocsSidebar,
};
