import { callable, Panel } from '@jimka/typescript-ui/core';
import type { PanelOptions } from '@jimka/typescript-ui/core';
import { Fit } from '@jimka/typescript-ui/layout';
import { Tree } from '@jimka/typescript-ui/component/tree';
import type { TreeNode } from '@jimka/typescript-ui/component/tree';
import { Router } from '@jimka/typescript-ui/router';
import { getNav } from '../content/pages.js';

// Wide enough for the longest nav label in the Phase-1 slice ("Component
// lifecycle") without wrapping, matching the ~260px a VitePress sidebar
// column occupies. Height is 0 because the sidebar sits in a Border WEST
// region, which reads only the width.
const SIDEBAR_WIDTH = 260;

/**
 * The west sidebar: a `Tree` built from {@link getNav}'s Guide/Concepts
 * groups, routing a selection to the `Router` and reflecting a URL-driven
 * page change back into the tree via {@link select}. `Tree` virtual-scrolls
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
        this._tree.expandAll();
        this._tree.on('selection', this.handleSelection);

        this.addComponent(this._tree);
    }

    /**
     * Selects the tree node for `path`, reflecting a URL-driven page change
     * into the sidebar. A miss (path not in the nav table) selects nothing.
     * Freely re-enters `Router.navigate` through the "selection" listener —
     * see "Sidebar ↔ router feedback loop" in
     * plans/implemented/packages-docs.md.
     *
     * @param path - The route path to select.
     */
    select(path: string): void {
        const node = this._nodesByPath.get(path);

        if (node) {
            this._tree.selectNode(node);
        }
    }

    /**
     * Builds the `Tree`'s root nodes from {@link getNav}, recording every leaf
     * page node's path in {@link _nodesByPath} as it goes.
     *
     * @returns The root {@link TreeNode} array for `Tree.setNodes`.
     */
    private buildNodes(): TreeNode[] {
        return getNav().map((group) => ({
            label:    group.title,
            children: group.pages.map((page) => {
                const node: TreeNode = { label: page.label, data: page.path };

                this._nodesByPath.set(page.path, node);

                return node;
            }),
        }));
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
