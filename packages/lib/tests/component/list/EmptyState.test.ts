import { describe, it, expect, afterEach } from 'vitest';
import { _List } from '~/component/list/List';
import { _Text } from '~/component/input/Text';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { UNBOUNDED } from '~/primitive/Size';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// White-box seam: widen the protected inner scroll panel's children so the
// empty-state placeholder's presence/identity can be asserted without a render.
class TestList extends _List {
    public innerChildren(): Component[] {
        return this._innerPanel.getComponents();
    }
}

describe('List empty state', () => {
    afterEach(() => DOM.reset());

    it('populated list reports an unbounded content max (row cap removed)', () => {
        installTestDOM(CONFIG);

        const list = new _List({ items: ['a', 'b'] });

        expect(list.getMaxSize()!.height).toBe(UNBOUNDED);
        expect(list.getMaxSize()!.width).toBe(UNBOUNDED);
    });

    it('emptyText on an empty list adds one filling Text placeholder with unbounded max', () => {
        installTestDOM(CONFIG);

        const list = new TestList({ emptyText: 'None' });
        const kids = list.innerChildren();

        expect(kids.length).toBe(1);
        expect(kids[0]).toBeInstanceOf(_Text);
        expect(kids[0].getMaxSize()!.height).toBe(UNBOUNDED);
        expect(list.getMaxSize()!.height).toBe(UNBOUNDED);
    });

    it('an empty list with no empty option has no placeholder child and a finite max', () => {
        installTestDOM(CONFIG);

        const list = new TestList({});

        expect(list.innerChildren().length).toBe(0);
        expect(list.getMaxSize()!.height).toBeLessThan(UNBOUNDED);
    });

    it('placeholder toggles as items come and go', () => {
        installTestDOM(CONFIG);

        const list = new TestList({ emptyText: 'None' });
        expect(list.innerChildren().some(c => c instanceof _Text)).toBe(true);

        list.setItems(['a']);
        expect(list.innerChildren().some(c => c instanceof _Text)).toBe(false);
        expect(list.innerChildren().length).toBeGreaterThanOrEqual(1);

        list.setItems([]);
        expect(list.innerChildren().some(c => c instanceof _Text)).toBe(true);
    });

    it('emptyComponent takes precedence over emptyText', () => {
        installTestDOM(CONFIG);

        const custom = new _Text('y');
        const list = new TestList({ emptyText: 'x', emptyComponent: () => custom });
        const kids = list.innerChildren();

        expect(kids.length).toBe(1);
        expect(kids[0]).toBe(custom);
    });

    it('caller minSize overrides the default 100x100; default applies otherwise', () => {
        const custom = new _List({ minSize: { width: 40, height: 30 } });
        expect(custom.getMinSizeConstraint()).toEqual({ width: 40, height: 30 });

        const def = new _List({});
        expect(def.getMinSizeConstraint()).toEqual({ width: 100, height: 100 });
    });
});
