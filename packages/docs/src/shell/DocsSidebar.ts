import { callable, Panel } from '@jimka/typescript-ui/core';
import type { PanelOptions } from '@jimka/typescript-ui/core';
import { Fit } from '@jimka/typescript-ui/layout';
import { Tree } from '@jimka/typescript-ui/component/tree';
import type { TreeNode } from '@jimka/typescript-ui/component/tree';
import { Router } from '@jimka/typescript-ui/router';
import { getNav } from '../content/pages.js';
import type { NavGroup, NavEntry } from '../content/pages.js';
import { API_PREFIX, getApiNav } from '../content/api.js';
import type { ApiNavNode } from '../content/api.js';
import { Insets } from '@jimka/typescript-ui/primitive';

// Wide enough for the longest nav label ("Linking a local library checkout"),
// which sits one indent level deeper than any Phase-1 label, without
// wrapping. Height is 0 because the sidebar sits in a Border WEST region,
// which reads only the width.
const SIDEBAR_WIDTH = 320;

/**
 * The west sidebar: a `Tree` built from {@link getNav}'s seven sections,
 * routing a selection to the `Router` and reflecting a URL-driven page
 * change back into the tree via {@link select}. `Tree` virtual-scrolls
 * itself, so this hosts it directly with no `autoScroll` wrapper.
 */
class DocsSidebar extends Panel {

    private readonly _router: Router;
    private readonly _tree:   Tree;

    /** Every leaf page node, keyed by its route path, for {@link select}. */
    private readonly _nodesByPath: Map<string, TreeNode> = new Map();

    // Stable reference so Tree.off would find the same identity; delegates to
    // the named handler below.
    private readonly handleSelection: (nodes: TreeNode[]) => void = (nodes) => this.onSelection(nodes);

    constructor(router: Router, options?: PanelOptions) {
        // Hand the layout manager and width to Component as subclass defaults
        // so a caller-supplied option still wins — Component merges
        // `{...defaults, ...options}` at dispatch time.
        super(options, {
            layoutManager: Fit(),
            preferredSize: { width: SIDEBAR_WIDTH, height: 0 },
            insets: new Insets(0, 0, 0, 0)
        });

        this._router = router;

        this._tree = new Tree();
        this._tree.setNodes(this.buildNodes());
        this._tree.on('selection', this.handleSelection);

        this.addComponent(this._tree);
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
