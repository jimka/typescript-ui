// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Container } from '@jimka/typescript-ui/core';
import type { ContainerOptions } from '@jimka/typescript-ui/core';
import { Fit } from '@jimka/typescript-ui/layout';
import { Tree } from '@jimka/typescript-ui/component/tree';
import type { TreeNode } from '@jimka/typescript-ui/component/tree';
import { Router } from '@jimka/typescript-ui/router';
import { DEMO_CATEGORIES } from "./demoSections.js";

/** One section's tree nodes: the leaf to select, and the category to expand first. */
interface SlugNodes {
    readonly category: TreeNode;
    readonly leaf:     TreeNode;
}

/**
 * The demo app's nav pane: a `Tree` whose seven roots are the categories and
 * whose 32 leaves are the sections, routing a leaf selection to the `Router`
 * and reflecting a URL-driven section change back into the tree via `select`.
 *
 * `Container` rather than `Panel`: `Tree` virtual-scrolls itself, so the pane
 * needs no `autoScroll` wrapper, and `Container`'s zero default insets let the
 * gutter shrink the pane without a perimeter to fight.
 */
class DemoNavigator extends Container {

    private readonly _router: Router;
    private readonly _tree:   Tree;

    /** Every section's nodes, keyed by its slug, for `select`. */
    private readonly _nodesBySlug: Map<string, SlugNodes> = new Map();

    // Stable reference so Tree.off would find the same identity; delegates to
    // the named handler below — mirrors DocsSidebar's own handleSelection idiom.
    private readonly handleSelection: (nodes: TreeNode[]) => void = (nodes) => this.onSelection(nodes);

    /**
     * @param router - The router a leaf selection navigates through.
     * @param options - Caller-supplied container options.
     */
    constructor(router: Router, options?: ContainerOptions) {
        super(options, { layoutManager: Fit() });

        this._router = router;

        this._tree = Tree({
            // Tree defaults to the input fill, which would make the nav pane
            // read as a text field rather than as part of the page.
            backgroundColor: "transparent",
            // A single click on a category row toggles it. At the "dblclick"
            // default a category needs a double-click, and a single click on
            // one would do nothing at all.
            expandTrigger:   "click",
            // A narrow pane ellipsises a long label instead of growing a
            // horizontal scrollbar — the TOC-style outline case Tree's own
            // guidance names for this.
            rowOverflow:     "clip",
            listeners: {
                selection: this.handleSelection
            }
        });

        this._tree.setNodes(this.buildNodes());

        this.addComponent(this._tree);
    }

    /**
     * Expands `slug`'s category and selects its leaf. No-op for an unknown
     * slug.
     *
     * @param slug - The section's URL segment.
     * @returns This navigator, for method chaining.
     */
    select(slug: string): this {
        const entry = this._nodesBySlug.get(slug);

        if (entry) {
            // Expanded first: selectNode no-ops for a node whose ancestor is
            // collapsed, so the leaf has to be in the flattened row set already.
            this._tree.expandNode(entry.category);
            this._tree.selectNode(entry.leaf);
        }

        return this;
    }

    /**
     * Builds the tree's root nodes: one per category, each holding its
     * sections' leaves, recording every slug's nodes in `_nodesBySlug` as it
     * goes.
     *
     * @returns The seven root nodes for `Tree.setNodes`.
     */
    private buildNodes(): TreeNode[] {
        const roots: TreeNode[] = [];

        for (const category of DEMO_CATEGORIES) {
            const leaves: TreeNode[] = category.sections.map(s => ({ label: s.label, data: s.slug }));
            const node:   TreeNode   = { label: category.title, children: leaves };

            for (let idx = 0; idx < leaves.length; idx += 1) {
                this._nodesBySlug.set(category.sections[idx].slug, { category: node, leaf: leaves[idx] });
            }

            roots.push(node);
        }

        return roots;
    }

    /**
     * Navigates to the selected leaf's section. Driven through the router
     * rather than the content pane directly, so the URL names the section the
     * moment its row is clicked and the location field never trails the
     * visible panel.
     *
     * `Tree.selectNode` deliberately does not emit `"selection"`, so `select`
     * cannot re-enter the router through here and no loop guard is needed.
     *
     * @param nodes - The tree's new selection.
     */
    private onSelection(nodes: TreeNode[]): void {
        const node = nodes[0];

        // A category row carries no slug payload: its click has already toggled
        // its own expansion, and there is nothing to navigate to.
        if (!node || typeof node.data !== "string") {
            return;
        }

        this._router.navigate("/" + node.data);
    }
}

const DemoNavigatorCallable = callable(DemoNavigator);
type DemoNavigatorCallable = DemoNavigator;
export {
    DemoNavigator         as _DemoNavigator,
    DemoNavigatorCallable as DemoNavigator,
};
