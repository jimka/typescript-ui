//
// Coverage for the demo app's nav pane: the three claims the plan's
// `## Architecture Decisions` makes about it that a browser is not needed to
// check — the expand-before-select ordering, a leaf click naming its section in
// the URL, and a category row navigating nowhere.
//
// Everything about how `Tree` itself flattens, renders, virtual-scrolls or
// emits belongs to tests/component/tree/Tree.test.ts, whose `asPrivate` seam
// and `_selectAtIndex` gesture entry point this file borrows rather than
// restating.
//
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { _Tree } from '~/component/tree/Tree';
import type { TreeNode } from '~/component/tree/TreeNode';
import { Router } from '~/router/Router';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { DemoNavigator } from '../../../src/typescript/DemoNavigator.js';

// Stub categories in place of the real 32-section table. `DemoNavigator` reads
// module-level `DEMO_CATEGORIES`, and the real module imports every panel —
// CodeMirror, Lexical and elkjs behind them — to hold their factories, so
// mocking it is what keeps this suite about the nav rather than about the demos.
// The factories throw because the navigator must never build a panel: that is
// the deck's job, and a build reaching here would be the defect.
vi.mock('../../../src/typescript/demoSections.js', () => ({
    DEMO_CATEGORIES: [
        {
            title: "First Category",
            sections: [
                { label: "Alpha", slug: "alpha", factory: () => { throw new Error("the nav must not build a panel"); } },
                { label: "Beta",  slug: "beta",  factory: () => { throw new Error("the nav must not build a panel"); } },
            ],
        },
        {
            title: "Second Category",
            sections: [
                { label: "Gamma", slug: "gamma", factory: () => { throw new Error("the nav must not build a panel"); } },
            ],
        },
    ],
}));

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// The same white-box seam tests/component/tree/Tree.test.ts uses: selection is
// driven through `_selectAtIndex`, the entry point a real row gesture reaches,
// because `selectNode` deliberately does not emit and so cannot stand in for a
// click here.
interface TreePrivate {
    _selectAtIndex(index: number): void;
    _flatRows:      { node: TreeNode }[];
    _expandedNodes: Set<TreeNode>;
}

function asPrivate(tree: _Tree): TreePrivate {
    return tree as unknown as TreePrivate;
}

/** The navigator's one child, which `Fit` stretches to fill the pane. */
function treeOf(nav: DemoNavigator): _Tree {
    return nav.getComponents()[0] as _Tree;
}

function labelsOf(tree: _Tree): string[] {
    return asPrivate(tree)._flatRows.map(row => row.node.label);
}

function selectedLabels(tree: _Tree): string[] {
    return tree.getSelectedNodes().map(node => node.label);
}

function expandedLabels(tree: _Tree): string[] {
    return [...asPrivate(tree)._expandedNodes].map(node => node.label);
}

describe('DemoNavigator', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        DOM.reset();
    });

    it('builds a root per category over a leaf per section, all collapsed', () => {
        installTestDOM(CONFIG);

        const tree = treeOf(new DemoNavigator(new Router()));

        // Only the two category rows are flattened, so no leaf is reachable
        // until its category is expanded — which is what makes the ordering in
        // `select` load-bearing rather than incidental.
        expect(labelsOf(tree)).toEqual(["First Category", "Second Category"]);
        expect(expandedLabels(tree)).toEqual([]);
        expect(selectedLabels(tree)).toEqual([]);
    });

    it('select expands the slug\'s category before selecting its leaf', () => {
        installTestDOM(CONFIG);

        const nav  = new DemoNavigator(new Router());
        const tree = treeOf(nav);

        nav.select("beta");

        // Both halves asserted: selecting without expanding first leaves
        // `selectNode` a no-op, because a leaf under a collapsed ancestor is not
        // in the flattened row set at all.
        expect(expandedLabels(tree)).toEqual(["First Category"]);
        expect(selectedLabels(tree)).toEqual(["Beta"]);
    });

    it('select expands only the routed category, leaving the others collapsed', () => {
        installTestDOM(CONFIG);

        const nav  = new DemoNavigator(new Router());
        const tree = treeOf(nav);

        nav.select("gamma");

        expect(expandedLabels(tree)).toEqual(["Second Category"]);
        expect(selectedLabels(tree)).toEqual(["Gamma"]);
    });

    it('select is a no-op for a slug no section carries', () => {
        installTestDOM(CONFIG);

        const nav  = new DemoNavigator(new Router());
        const tree = treeOf(nav);

        nav.select("nope");

        expect(expandedLabels(tree)).toEqual([]);
        expect(selectedLabels(tree)).toEqual([]);
    });

    it('selecting a leaf row names its section in the URL', () => {
        installTestDOM(CONFIG);
        DOM.sink.setLocationHash('#/alpha');

        const router = new Router();
        const nav    = new DemoNavigator(router);
        const tree   = treeOf(nav);

        nav.select("alpha");

        // Rows are now [First Category, Alpha, Beta, Second Category]; index 2
        // is the Beta leaf. Driven through the gesture entry point, so the
        // navigator's own "selection" listener is what runs.
        expect(labelsOf(tree)[2]).toBe("Beta");
        asPrivate(tree)._selectAtIndex(2);

        // The resulting location, not a call count: "the URL names the section"
        // is the claim, and the router turning that into a path is the
        // consequence that a caller can actually observe.
        expect(router.getPath()).toBe("/beta");
    });

    it('selecting a category row navigates nowhere', () => {
        installTestDOM(CONFIG);
        DOM.sink.setLocationHash('#/alpha');

        const router = new Router();
        const nav    = new DemoNavigator(router);
        const tree   = treeOf(nav);

        nav.select("alpha");

        const navigate = vi.spyOn(router, 'navigate');

        // Index 0 is the First Category row, which carries no slug payload.
        expect(labelsOf(tree)[0]).toBe("First Category");
        asPrivate(tree)._selectAtIndex(0);

        // Both the attempt and its consequence: without the payload guard the
        // handler would navigate to "/undefined", which moves the URL off the
        // section that is still showing.
        expect(navigate).not.toHaveBeenCalled();
        expect(router.getPath()).toBe("/alpha");
    });
});
