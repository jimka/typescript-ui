import { callable, Panel } from '@jimka/typescript-ui/core';
import type { PanelOptions } from '@jimka/typescript-ui/core';
import { Fit } from '@jimka/typescript-ui/layout';
import { Tree } from '@jimka/typescript-ui/component/tree';
import type { TreeNode } from '@jimka/typescript-ui/component/tree';
import { Router } from '@jimka/typescript-ui/router';
import { getNav } from '../content/pages.js';
import type { NavGroup, NavEntry } from '../content/pages.js';

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
     * Builds the `Tree`'s root nodes from {@link getNav}'s top-level sections,
     * recording every leaf page node's path in {@link _nodesByPath} as it goes.
     *
     * @returns The root {@link TreeNode} array for `Tree.setNodes`.
     */
    private buildNodes(): TreeNode[] {
        return getNav().map((group) => this.buildGroupNode(group));
    }

    /**
     * Recursively builds a group's `TreeNode`, its own pages first and its
     * nested subgroups after — see "Building the tree nodes" in
     * plans/implemented/docs-content-migration.md.
     *
     * @param group - The nav group to build a node for.
     * @returns The group's {@link TreeNode}.
     */
    private buildGroupNode(group: NavGroup): TreeNode {
        return {
            label:    group.title,
            children: [
                ...group.pages.map((page) => this.buildPageNode(page)),
                ...(group.groups ?? []).map((child) => this.buildGroupNode(child)),
            ],
        };
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

    private onSelection(nodes: TreeNode[]): void {
        const node = nodes[0];

        if (node && node.data !== undefined) {
            this._router.navigate(node.data as string);
        }
    }
}

const DocsSidebarCallable = callable(DocsSidebar);
type DocsSidebarCallable = DocsSidebar;
export {
    DocsSidebar         as _DocsSidebar,
    DocsSidebarCallable as DocsSidebar,
};
