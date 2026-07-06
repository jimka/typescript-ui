//
// Coverage for the List / ComboBox item-renderer seam. Each renderer builds a
// Text (and, for the glyph renderer, a Glyph) child that mints a DOM.sink
// element on demand, so the offline harness is installed. We assert the
// renderer contracts (label text, glyph add/remove/idempotent), the per-item
// glyph plumbing through setItems / addItem / a store `glyphField`, the factory
// swap over an existing row pool, and the ComboBox forwarding — including the
// collapsed control rendering the selected entry through the same factory.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _List } from '~/component/list/List';
import { _ComboBox } from '~/component/input/ComboBox';
import { LabelListItemRenderer } from '~/component/list/renderer/Label';
import { GlyphListItemRenderer } from '~/component/list/renderer/Glyph';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

// "unicode-arrow-up" / "-down" are built-in char glyphs registered eagerly by
// Glyphs, so no test-side registration is needed and Glyph construction won't
// throw.
const UP   = 'unicode-arrow-up';
const DOWN = 'unicode-arrow-down';

/** The label text a renderer currently displays, read off its private Text child. */
function rendererText(renderer: unknown): string {
    return (renderer as any)._label.getText();
}

/** The renderer hosted by a list row at pool index `i`. */
function rowRenderer(list: unknown, i: number): unknown {
    return (list as any)._rowPool[i]._renderer;
}

describe('LabelListItemRenderer', () => {
    it('update sets the label to the item label', () => {
        const r = new LabelListItemRenderer();

        r.update({ item: { key: 'a', label: 'Alpha' }, index: 0 });
        expect(rendererText(r)).toBe('Alpha');
    });

    it('a subsequent update with a different item replaces the text', () => {
        const r = new LabelListItemRenderer();

        r.update({ item: { key: 'a', label: 'Alpha' }, index: 0 });
        r.update({ item: { key: 'b', label: 'Beta' }, index: 1 });
        expect(rendererText(r)).toBe('Beta');
    });
});

describe('GlyphListItemRenderer add/remove/idempotent', () => {
    it('a fresh renderer has no icon and caches no glyph name', () => {
        const r = new GlyphListItemRenderer();

        expect((r as any)._icon).toBe(null);
        expect((r as any)._currentGlyph).toBe(null);
    });

    it('an item with a glyph adds exactly one icon and sets the label', () => {
        const r = new GlyphListItemRenderer();

        r.update({ item: { key: 'a', label: 'Alpha', glyph: UP }, index: 0 });
        expect((r as any)._icon).not.toBe(null);
        expect((r as any)._currentGlyph).toBe(UP);
        expect(rendererText(r)).toBe('Alpha');
    });

    it('an item without a glyph leaves no icon (label only)', () => {
        const r = new GlyphListItemRenderer();

        r.update({ item: { key: 'a', label: 'Alpha' }, index: 0 });
        expect((r as any)._icon).toBe(null);
        expect(rendererText(r)).toBe('Alpha');
    });

    it('re-updating with the same glyph name keeps the same Glyph instance', () => {
        const r = new GlyphListItemRenderer();

        r.update({ item: { key: 'a', label: 'Alpha', glyph: UP }, index: 0 });
        const first = (r as any)._icon;

        r.update({ item: { key: 'a', label: 'Alpha', glyph: UP }, index: 0 });
        expect((r as any)._icon).toBe(first);
    });

    it('a different glyph name swaps the instance', () => {
        const r = new GlyphListItemRenderer();

        r.update({ item: { key: 'a', label: 'Alpha', glyph: UP }, index: 0 });
        const first = (r as any)._icon;

        r.update({ item: { key: 'a', label: 'Alpha', glyph: DOWN }, index: 0 });
        expect((r as any)._icon).not.toBe(first);
        expect((r as any)._currentGlyph).toBe(DOWN);
    });

    it('clearing the glyph (undefined) removes the icon', () => {
        const r = new GlyphListItemRenderer();

        r.update({ item: { key: 'a', label: 'Alpha', glyph: UP }, index: 0 });
        r.update({ item: { key: 'a', label: 'Alpha' }, index: 0 });
        expect((r as any)._icon).toBe(null);
        expect((r as any)._currentGlyph).toBe(null);
    });
});

describe('SelectableListItem.glyph plumbing', () => {
    it('setItems round-trips the glyph on a pre-formed item', () => {
        const list = new _List({ items: [{ key: 'a', label: 'Alpha', glyph: UP }] as any });

        expect(list.getItems()[0].glyph).toBe(UP);
    });

    it('setItemsArray carries the glyph verbatim', () => {
        const list = new _List();

        list.setItemsArray([{ key: 'a', label: 'Alpha', glyph: UP }]);
        expect(list.getItems()[0].glyph).toBe(UP);
    });

    it('addItem carries the glyph on a pre-formed item', () => {
        const list = new _List();

        list.addItem({ key: 'a', label: 'Alpha', glyph: UP });
        expect(list.getItems()[0].glyph).toBe(UP);
    });

    it('a store glyphField resolves each item glyph from the record', () => {
        const MODEL = new Model([{ name: 'id' }, { name: 'name' }, { name: 'icon' }], 'id');
        const store = new MemoryStore(MODEL, []);

        store.loadData([{ id: 1, name: 'Alpha', icon: UP }, { id: 2, name: 'Beta', icon: DOWN }]);

        const list = new _List();
        list.setStore(store, 'name', 'id', 'icon');

        expect(list.getItems().map(i => i.glyph)).toEqual([UP, DOWN]);
    });
});

describe('renderer factory', () => {
    it('a List with no factory renders each row via a LabelListItemRenderer', () => {
        const list = new _List({ items: ['Apple', 'Banana'] });

        expect(rowRenderer(list, 0)).toBeInstanceOf(LabelListItemRenderer);
        expect(rendererText(rowRenderer(list, 0))).toBe('Apple');
        expect(rendererText(rowRenderer(list, 1))).toBe('Banana');
    });

    it('a construction-time factory paints rows through it from the first build', () => {
        const list = new _List({
            items:           [{ key: 'a', label: 'Alpha', glyph: UP }] as any,
            rendererFactory: () => new GlyphListItemRenderer(),
        });

        expect(rowRenderer(list, 0)).toBeInstanceOf(GlyphListItemRenderer);
        expect((rowRenderer(list, 0) as any)._currentGlyph).toBe(UP);
    });

    it('setRendererFactory swaps every pool row and preserves items/selection', () => {
        const list = new _List({ items: [{ key: 'a', label: 'Alpha', glyph: UP }] as any });
        list.setSelectedIndex(0, false);

        list.setRendererFactory(() => new GlyphListItemRenderer());

        expect(rowRenderer(list, 0)).toBeInstanceOf(GlyphListItemRenderer);
        expect((rowRenderer(list, 0) as any)._currentGlyph).toBe(UP);
        expect(list.getItems().map(i => i.label)).toEqual(['Alpha']);
        expect(list.getSelectedIndex()).toBe(0);
    });
});

describe('ComboBox renderer forwarding', () => {
    it('a construction-time factory reaches both the inner list and the collapsed label', () => {
        const factory = () => new GlyphListItemRenderer();
        const combo = new _ComboBox({ items: ['Apple', 'Banana'], rendererFactory: factory });

        expect(combo.getRendererFactory()).toBe(factory);
        expect((combo as any)._label._renderer).toBeInstanceOf(GlyphListItemRenderer);
    });

    it('setRendererFactory updates the inner list and the collapsed label', () => {
        const combo = new _ComboBox({ items: ['Apple', 'Banana'] });

        expect((combo as any)._label._renderer).toBeInstanceOf(LabelListItemRenderer);

        combo.setRendererFactory(() => new GlyphListItemRenderer());
        expect(combo.getRendererFactory()()).toBeInstanceOf(GlyphListItemRenderer);
        expect((combo as any)._label._renderer).toBeInstanceOf(GlyphListItemRenderer);
    });

    it('the collapsed label renders the selected entry label', () => {
        const combo = new _ComboBox({ items: ['Apple', 'Banana'] });

        combo.setSelectedIndex(1, false);
        expect(rendererText((combo as any)._label._renderer)).toBe('Banana');
    });

    it('the collapsed glyph label shows the selected entry glyph', () => {
        const combo = new _ComboBox({
            items:           [{ key: 'a', label: 'Alpha', glyph: UP }, { key: 'b', label: 'Beta', glyph: DOWN }] as any,
            rendererFactory: () => new GlyphListItemRenderer(),
        });

        combo.setSelectedIndex(1, false);
        expect((combo as any)._label._renderer._currentGlyph).toBe(DOWN);
        expect(rendererText((combo as any)._label._renderer)).toBe('Beta');
    });

    it('nothing selected feeds the collapsed label a blank item', () => {
        const combo = new _ComboBox({
            rendererFactory: () => new GlyphListItemRenderer(),
        });

        expect(combo.getSelectedIndex()).toBe(-1);
        expect(rendererText((combo as any)._label._renderer)).toBe('');
        expect((combo as any)._label._renderer._icon).toBe(null);
    });

    it('selecting a different entry re-renders the collapsed label', () => {
        const combo = new _ComboBox({ items: ['Apple', 'Banana', 'Cherry'] });

        combo.setSelectedIndex(0, false);
        expect(rendererText((combo as any)._label._renderer)).toBe('Apple');

        combo.setSelectedIndex(2, false);
        expect(rendererText((combo as any)._label._renderer)).toBe('Cherry');
    });

    it('a construction-time store glyphField forwards to the embedded list', () => {
        const MODEL = new Model([{ name: 'id' }, { name: 'name' }, { name: 'icon' }], 'id');
        const store = new MemoryStore(MODEL, []);

        store.loadData([{ id: 1, name: 'Alpha', icon: UP }, { id: 2, name: 'Beta', icon: DOWN }]);

        // The glyph source is supplied purely through the options bag — the same
        // path the docs promise — so this catches a constructor that drops the
        // glyphField before reaching the embedded list.
        const combo = new _ComboBox({
            store,
            displayField:    'name',
            valueField:      'id',
            glyphField:      'icon',
            rendererFactory: () => new GlyphListItemRenderer(),
        });

        expect(combo.getItems().map(i => i.glyph)).toEqual([UP, DOWN]);
        // The auto-selected first row renders its glyph on the collapsed control.
        expect((combo as any)._label._renderer._currentGlyph).toBe(UP);
    });
});
