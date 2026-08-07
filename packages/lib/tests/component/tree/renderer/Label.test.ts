import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { LabelTreeNodeRenderer } from '~/component/tree/renderer/Label';
import type { TreeNodeRenderContext } from '~/component/tree/TreeNodeRenderContext';
import { installTestDOM } from '../../../dom/TestDOM';
import fontMetrics from '../../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Builds a bound-node context for a label long enough to exceed a narrow row width. */
function context(label: string): TreeNodeRenderContext {
    return { node: { label }, depth: 0, expanded: false, selected: false, hasChildren: false };
}

describe('LabelTreeNodeRenderer — label width vs. the row\'s available width', () => {
    afterEach(() => DOM.reset());

    it('sizes the label to its full natural width when the row is at least that wide', () => {
        installTestDOM(CONFIG);

        const renderer = new LabelTreeNodeRenderer();
        renderer.getElement(true);
        renderer.update(context('Hello World Hello World'));

        const natural = renderer.getContentWidth();

        renderer.layoutChildren(natural + 100, 24);

        expect(renderer.getLabel().getWidth()).toBe(natural);
    });

    it('clamps the label to the row\'s available width when it is narrower than the label\'s natural width, so text-overflow: ellipsis has a box to clip against', () => {
        installTestDOM(CONFIG);

        const renderer = new LabelTreeNodeRenderer();
        renderer.getElement(true);
        renderer.update(context('Hello World Hello World Hello World Hello World'));

        const natural = renderer.getContentWidth();
        const available = Math.floor(natural / 2);

        renderer.layoutChildren(available, 24);

        expect(renderer.getLabel().getWidth()).toBe(available);
        // getContentWidth (read by TreeRow to size the row itself) still
        // reports the full natural width — only the rendered label box clamps.
        expect(renderer.getContentWidth()).toBe(natural);
    });

    it('enables single-line ellipsis truncation on the label — not just Text\'s inert isTruncate() field default, the actual applied overflow/text-overflow CSS', () => {
        installTestDOM(CONFIG);

        const renderer = new LabelTreeNodeRenderer();

        expect(renderer.getLabel().getOverflow()).toBe('hidden');
        expect(renderer.getLabel().getTextOverflow()).toBe('ellipsis');
    });
});
