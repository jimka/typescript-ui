// @vitest-environment jsdom
//
// TreeCellRenderer arithmetic + delegation coverage. The renderer wraps a real
// delegate renderer and (for branches) builds a caret Glyph through DOM.sink, so
// the offline harness is installed. TreeCell.ts registers the "caret-down" /
// "caret-right" glyphs at import time, so branch toggles construct without
// throwing. getContentX is the load-bearing arithmetic contract; the rest is
// delegation + idempotence.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../../dom/TestDOM';
import fontMetrics from '../../../dom/font-metrics.test-font.json';
import { TreeCellRenderer } from '~/component/table/cell/renderer/TreeCell';
import { StringRenderer } from '~/component/table/cell/renderer/String';
import { Insets } from '~/primitive/Insets';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('TreeCellRenderer.getContentX (= depth * indentPx + TOGGLE_WIDTH)', () => {
    it('depth 0 with default indent (16) reserves just the 20px toggle width', () => {
        // CONTRACT: TOGGLE_WIDTH = 20, DEFAULT_INDENT_PX = 16.
        const r = new TreeCellRenderer(new StringRenderer());

        r.setTreeState(0, false, false);
        expect(r.getContentX()).toBe(20);
    });

    it('depth 2 with default indent: 2*16 + 20 = 52', () => {
        const r = new TreeCellRenderer(new StringRenderer());

        r.setTreeState(2, true, false);
        expect(r.getContentX()).toBe(52);
    });

    it('a custom indentPx flows through the arithmetic', () => {
        const r = new TreeCellRenderer(new StringRenderer(), 10);

        r.setTreeState(3, false, false);
        // 3 * 10 + 20 = 50.
        expect(r.getContentX()).toBe(50);
    });
});

describe('TreeCellRenderer delegation', () => {
    it('getValue/setValue delegate to the wrapped renderer', () => {
        const delegate = new StringRenderer();
        const r        = new TreeCellRenderer(delegate);

        r.setValue('hi');
        expect(delegate.getValue()).toBe('hi');
        expect(r.getValue()).toBe('hi');

        delegate.setValue('bye');
        expect(r.getValue()).toBe('bye');
    });

    it('getDelegate returns the wrapped renderer', () => {
        const delegate = new StringRenderer();

        expect(new TreeCellRenderer(delegate).getDelegate()).toBe(delegate);
    });

    it('setInsets forwards to the delegate and leaves the wrapper at zero insets', () => {
        const delegate = new StringRenderer();
        const r        = new TreeCellRenderer(delegate);

        const insets = new Insets(0, 9, 0, 9);
        r.setInsets(insets);

        expect(delegate.getInsets().getLeft()).toBe(9);
        // The wrapper's own insets were zeroed in the constructor and not
        // changed by the forwarded setInsets.
        expect(r.getInsets().getLeft()).toBe(0);
    });
});

describe('TreeCellRenderer tree state', () => {
    it('getDepth round-trips the depth from setTreeState', () => {
        const r = new TreeCellRenderer(new StringRenderer());

        r.setTreeState(4, true, true);
        expect(r.getDepth()).toBe(4);
    });

    it('a leaf (hasChildren:false) has a null toggle; a branch has a non-null toggle', () => {
        const leaf   = new TreeCellRenderer(new StringRenderer());
        const branch = new TreeCellRenderer(new StringRenderer());

        leaf.setTreeState(0, false, false);
        expect(leaf.getToggle()).toBe(null);

        branch.setTreeState(0, true, false);
        expect(branch.getToggle()).not.toBe(null);
    });

    it('setTreeState with the same triple is a no-op (toggle instance unchanged)', () => {
        // CONTRACT (JSDoc): "Idempotent — a call with the same triple is a no-op".
        const r = new TreeCellRenderer(new StringRenderer());

        r.setTreeState(1, true, true);
        const toggle = r.getToggle();

        r.setTreeState(1, true, true);
        expect(r.getToggle()).toBe(toggle);
    });
});
