import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { ThemeManager } from '~/core/Theme';
import { _Tree } from '~/component/tree/Tree';
import type { TreeNode } from '~/component/tree/TreeNode';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

// ---------------------------------------------------------------------------
// Font-swap re-measure, at the Tree surface.
//
// A web font loaded with `font-display: swap` arrives after the first layout,
// so every label measured against the fallback face carries a width that is
// wrong once the real glyphs land. `ThemeManager` handles this by bumping the
// text-metrics generation and notifying its theme listeners — the same reflow
// the `loadingdone` subscription drives (`DOMSource.onFontsReady`, inert
// offline by design, so these tests enter through the shared `setTheme` path).
//
// The Tree does not ride that reflow for free: its labels are rendered by
// `LabelTreeNodeRenderer`, whose `Text` runs with `setAutoMeasure(false)` and
// is only re-measured by the explicit `measure()` inside `update()` — which
// runs solely when a pool slot is *rebound*. Unless the reflow forces every
// bound slot to re-bind and re-render, the visible rows keep their
// fallback-font widths for as long as they stay on screen, clipping the wider
// real glyphs. This is exactly what the docs-app sidebar showed on first load
// (correct after a reload, when the font came from cache).
// ---------------------------------------------------------------------------

/** Chars present in the baked test font, so the labels measure real advances. */
const LABEL = 'World';

/**
 * Builds a config whose baked font table is a private deep copy, so a test can
 * widen the advances mid-run (modelling the real face swapping in) without
 * mutating the shared JSON module every other suite reads.
 */
function makeConfig() {
    return {
        rootMountOffset: { x: 0, y: 0 },
        viewport:        { width: 1280, height: 800 },
        scrollBarWidth:  15,
        fontMetrics:     structuredClone(fontMetrics),
        themeVars:       {},
    };
}

/** Doubles every per-character advance in the (cloned) baked font table. */
function widenFont(config: ReturnType<typeof makeConfig>): void {
    for (const font of Object.values(config.fontMetrics.fonts) as Array<{ advance: Record<string, number> }>) {
        for (const ch of Object.keys(font.advance)) {
            font.advance[ch] *= 2;
        }
    }
}

function nodes(): TreeNode[] {
    return [{ label: LABEL }, { label: 'Hello' }, { label: 'rod' }];
}

function mount(): _Tree {
    const tree = new _Tree();
    tree.getElement(true);   // wires the VirtualScroller
    tree.setWidth(300);
    tree.setHeight(120);
    tree.setNodes(nodes());

    return tree;
}

/** The width committed on the first pool row's label `Text`. */
function labelWidth(tree: _Tree): number {
    const pool = (tree as unknown as { _rowPool: Array<{ getRenderer(): { getLabel(): { getWidth(): number } } }> })._rowPool;

    return pool[0].getRenderer().getLabel().getWidth();
}

describe('Tree — labels re-measure when the web font swaps in', () => {
    let config = makeConfig();

    beforeEach(() => {
        config = makeConfig();
        installTestDOM(config);
    });

    afterEach(() => DOM.reset());

    it('re-sizes visible row labels to the new metrics after a metrics reflow', () => {
        const tree      = mount();
        const fallbackW = labelWidth(tree);

        expect(fallbackW).toBeGreaterThan(0);

        // The real face arrives: same family, wider glyphs.
        widenFont(config);

        const swappedIn = DOM.source.measureText(LABEL).width;
        expect(swappedIn).toBeGreaterThan(fallbackW);

        // Drive the reflow the font-load callback drives.
        ThemeManager.setTheme(ThemeManager.getTheme());

        expect(labelWidth(tree)).toBe(swappedIn);
    });

    it('forces every bound pool slot to re-bind, so no visible row keeps a stale measurement', () => {
        const tree = mount();
        const priv = tree as unknown as { _boundIndices: number[]; renderWindow(): void };

        // Every visible slot is bound to its data index before the reflow.
        expect(priv._boundIndices.some(index => index >= 0)).toBe(true);

        let rebound = false;
        const originalRender = priv.renderWindow.bind(priv);

        // The re-bind is observable as `_boundIndices` being cleared by the
        // time the reflow's render pass runs; after that pass they are bound
        // again, so it has to be sampled from inside the call.
        priv.renderWindow = function patched(this: unknown): void {
            rebound = priv._boundIndices.every(index => index < 0);
            originalRender();
        };

        ThemeManager.setTheme(ThemeManager.getTheme());

        expect(rebound).toBe(true);
    });
});
