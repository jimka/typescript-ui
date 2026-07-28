// Regression: VirtualScroller appends its two Scrollbar overlays straight onto
// the owner's element with a raw DOM.sink.appendChild (its constructor) and
// holds them only in the private `_scrollbarV` / `_scrollbarH` fields — never
// registered via `addComponent` — so `Component.destructor()`'s child
// recursion, which walks `_components`, never reaches them and their
// per-instance stylesheet rules are never deleted. See
// plans/implemented/scrollbar-leak-and-layout-guards.md (Bug 1, case B1-3).
import { describe, it, expect, afterEach } from 'vitest';
import { Tree } from '~/component/tree/Tree';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheKeys } from '~/core/StyleTarget';
import type { VirtualScroller } from '~/component/container/VirtualScroller';
import type { Scrollbar } from '~/component/container/Scrollbar';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => DOM.reset());

/** Calls the protected destructor, as an owning window does when it closes. */
function destroy(tree: Tree): void {
    (tree as unknown as { destructor(): void }).destructor();
}

/** A rendered, laid-out Tree with a materialised VirtualScroller. */
function renderedTree(): Tree {
    const tree = new Tree();

    tree.setNodes([
        { label: 'Fruits', children: [{ label: 'Apple' }, { label: 'Banana' }] },
        { label: 'Vegetables' },
    ]);

    tree.getElement(true);
    tree.setWidth(400);
    tree.setHeight(200);
    tree.doLayout();

    return tree;
}

/** The two overlay scrollbars a rendered tree's scroller owns. */
function scrollbarsOf(tree: Tree): { v: Scrollbar; h: Scrollbar } {
    const scroller = (tree as unknown as { _scroller: VirtualScroller })._scroller;
    const bars     = scroller as unknown as { _scrollbarV: Scrollbar; _scrollbarH: Scrollbar };

    return { v: bars._scrollbarV, h: bars._scrollbarH };
}

describe('VirtualScroller — overlay scrollbar style-rule disposal', () => {
    it('B1-3: destroying a Tree leaves no rule naming either of its scroller\'s scrollbars', () => {
        installTestDOM(CONFIG);

        const tree = renderedTree();
        const { v, h } = scrollbarsOf(tree);

        const vId = v.getId();
        const hId = h.getId();

        expect(_ruleCacheKeys().some((key) => key.includes(vId))).toBe(true);
        expect(_ruleCacheKeys().some((key) => key.includes(hId))).toBe(true);

        destroy(tree);

        expect(_ruleCacheKeys().some((key) => key.includes(vId))).toBe(false);
        expect(_ruleCacheKeys().some((key) => key.includes(hId))).toBe(false);
    });
});
