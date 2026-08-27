import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Border } from '~/layout/Border';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { Placement } from '~/primitive/Placement';
import { DOM } from '~/core/DOM';
import { UNBOUNDED } from '~/primitive/Size';
import { _List } from '~/component/list/List';
import { _MultiSelectList } from '~/component/list/MultiSelectList';
import { _Table } from '~/component/table/Table';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Region geometry the fill behaviour is measured against. 400 is the region
// height the list must fill. Since the row height cap was removed, each row
// reports an unbounded max, so a populated list's VBox saturates to an
// unbounded content max — region-fill now falls out of the default clamping
// rather than the former clampsToContentSize-decoupled reporting.
const REGION_HEIGHT = 400;
const REGION_WIDTH = 600;

function placement(p: Placement): LayoutConstraints {
    return Object.assign(new LayoutConstraints(), { placement: p });
}

/** Border host sized to REGION_WIDTH × `height`, insets cleared. */
function host(height: number = REGION_HEIGHT): Container {
    const c = new Container({ layoutManager: new Border() });

    c.getElement(true);
    c.setWidth(REGION_WIDTH);
    c.setHeight(height);
    c.clearInsets();

    return c;
}

function items(n: number): string[] {
    return Array.from({ length: n }, (_, i) => `Item ${i}`);
}

describe('List fills a stretching layout region (region-fill-max-size)', () => {
    afterEach(() => DOM.reset());

    it('fills a stretching WEST region instead of capping at content height', () => {
        installTestDOM(CONFIG);

        const h = host();
        const list = new _List({ items: items(13) });

        h.addComponent(list, placement(Placement.WEST));
        h.doLayout();

        expect(list.getHeight()).toBe(REGION_HEIGHT);
    });

    it('fills a CENTER region instead of capping at content height', () => {
        installTestDOM(CONFIG);

        const h = host();
        const list = new _List({ items: items(13) });

        h.addComponent(list, placement(Placement.CENTER));
        h.doLayout();

        expect(list.getHeight()).toBe(REGION_HEIGHT);
    });

    it('honours an explicit maxSize ceiling even in a stretching region', () => {
        installTestDOM(CONFIG);

        const h = host();
        const list = new _List({ items: items(13), maxSize: { width: 9999, height: 150 } });

        h.addComponent(list, placement(Placement.CENTER));
        h.doLayout();

        expect(list.getHeight()).toBe(150);
    });

    it('does not collapse below its own minimum in a short region', () => {
        installTestDOM(CONFIG);

        // Region shorter than the list's default 100px min floor.
        const h = host(50);
        const list = new _List({ items: items(1) });

        h.addComponent(list, placement(Placement.CENTER));
        h.doLayout();

        // The list carries a 100x100 class-default minSize; it must not
        // collapse to the 50px region or to its single-item content height.
        expect(list.getHeight()).toBeGreaterThanOrEqual(50);
        expect(list.getHeight()).toBeGreaterThanOrEqual(100);
    });

    it('MultiSelectList inherits the same region-fill behaviour', () => {
        installTestDOM(CONFIG);

        const h = host();
        const list = new _MultiSelectList({ items: items(13) });

        h.addComponent(list, placement(Placement.WEST));
        h.doLayout();

        expect(list.getHeight()).toBe(REGION_HEIGHT);
    });

    it('fills the region with a short list (fill, not merely uncap)', () => {
        installTestDOM(CONFIG);

        const h = host();
        const list = new _List({ items: items(3) });

        h.addComponent(list, placement(Placement.CENTER));
        h.doLayout();

        // A 3-item list (content ~66px) still grows to the full region — proving
        // the region drives the height, not the content.
        expect(list.getHeight()).toBe(REGION_HEIGHT);
    });

    it('reports an unbounded getMaxSize (rows no longer cap their height)', () => {
        installTestDOM(CONFIG);

        const h = host();
        const list = new _List({ items: items(13) });

        h.addComponent(list, placement(Placement.CENTER));
        h.doLayout();

        // Rows report an unbounded max, so the list's VBox saturates to an
        // unbounded content max — the finite content-derived report that used to
        // crush a resizable Accordion section is gone.
        expect(list.getMaxSize()!.height).toBe(UNBOUNDED);
    });

    it('Table already fills a stretching CENTER region (guard, no Table change)', () => {
        installTestDOM(CONFIG);

        const model = new Model([
            { name: 'a', type: 'string', order: 0 },
            { name: 'b', type: 'string', order: 1 },
        ], 'a');
        const store = new MemoryStore(model, []);

        const h = host();
        const table = new _Table(store);

        h.addComponent(table, placement(Placement.CENTER));
        h.doLayout();

        expect(table.getHeight()).toBe(REGION_HEIGHT);
    });
});
