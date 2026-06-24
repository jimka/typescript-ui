// The handle-keyed geometry oracle derives every rect from the inline-style
// writes the component committed THROUGH THE SINK (left/top/width/height/
// transform), composed through the sink-recorded modelled tree — never from the
// component's cached fields. That makes a cached-but-not-written divergence
// observable (case 11a), and lets hit-testing sit on the same written rects.
import { describe, it, expect, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM, setNaturalSize, setBorderInset } from './TestDOM';
import fontMetrics from './font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 1000, y: 2000 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('Handle-keyed geometry oracle (from recorded writes)', () => {
    afterEach(() => DOM.reset());

    // Case 11: the written-rect composes to the framework's intended layout,
    // residual 0 against the cached-field oracle.
    it('composes the handle rect from writes to equal getViewportRect (residual 0)', () => {
        installTestDOM(CONFIG);

        const root = new Component({});
        const mid  = new Component({});
        const leaf = new Component({});

        root.getElement(true);
        root.addComponent(mid);
        mid.addComponent(leaf);

        mid.setX(100);
        mid.setY(50);

        leaf.setX(10);
        leaf.setY(20);
        leaf.setWidth(40);
        leaf.setHeight(30);
        leaf.setTranslate(3, 7);

        const reference = DOM.source.getViewportRect(leaf);
        const written   = DOM.source.getElementRect(leaf.getElement()!);

        expect(written.x).toBe(1113);
        expect(written.y).toBe(2077);
        expect(written.width).toBe(40);
        expect(written.height).toBe(30);
        expect(written).toEqual(reference);
    });

    // Case 11a: cached-vs-written divergence is caught. A write that the cache
    // never saw makes component.getX() !== getElementRect(handle).x.
    it('catches a cached-vs-written divergence', () => {
        installTestDOM(CONFIG);

        const root  = new Component({});
        const child = new Component({});

        root.getElement(true);
        root.addComponent(child);

        child.setX(50);
        child.setWidth(10);
        child.setHeight(10);

        const handle = child.getElement()!;

        // Honest case: the cached X composes to the written rect's X.
        expect(DOM.source.getElementRect(handle).x).toBe(child.getX() + CONFIG.rootMountOffset.x);

        // Simulate a broken setter: a left write the cache never saw.
        DOM.sink.apply(handle, { style: { left: '999px' } });

        // The handle rect now reflects 999, diverging from the cached getX().
        expect(DOM.source.getElementRect(handle).x).toBe(999 + CONFIG.rootMountOffset.x);
        expect(DOM.source.getElementRect(handle).x).not.toBe(child.getX() + CONFIG.rootMountOffset.x);
    });

    // Case 12: rect composes through nested offsets + translate + injected
    // parent border + parent scroll, all sourced from writes (border injected).
    it('composes nested offsets, translate, parent border and parent scroll', () => {
        installTestDOM(CONFIG);

        const root = new Component({});
        const mid  = new Component({});
        const leaf = new Component({});

        root.getElement(true);
        root.addComponent(mid);
        mid.addComponent(leaf);

        mid.setX(100);
        mid.setY(50);

        leaf.setX(10);
        leaf.setY(20);
        leaf.setWidth(40);
        leaf.setHeight(30);
        leaf.setTranslate(3, 7);

        // Inject a parent border inset and a parent scroll offset.
        setBorderInset(mid.getElement()!, { top: 2, right: 0, bottom: 0, left: 4 });
        DOM.sink.apply(mid.getElement()!, { scrollLeft: 6, scrollTop: 9 });

        const rect = DOM.source.getElementRect(leaf.getElement()!);

        // x: root(1000) + mid.x(100) + [parentBorder.left 4] - [parentScroll 6]
        //    + leaf.x(10) + leaf.tx(3) = 1000+100+4-6+10+3 = 1111
        expect(rect.x).toBe(1111);
        // y: 2000 + 50 + 2 - 9 + 20 + 7 = 2070
        expect(rect.y).toBe(2070);
    });

    // Case 13: a handle with no recorded geometry write returns the zero rect.
    it('returns a zero rect for a handle with no geometry writes', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});

        comp.getElement(true);

        const rect = DOM.source.getElementRect(comp.getElement()!);

        expect(rect).toEqual({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 });
    });

    // Case 14: getScrollMetrics reports the written client box + recorded scroll.
    it('reports written client box and recorded scroll from getScrollMetrics', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});

        comp.getElement(true);

        comp.setWidth(120);
        comp.setHeight(80);

        DOM.sink.apply(comp.getElement()!, { scrollLeft: 5, scrollTop: 7 });

        const metrics = DOM.source.getScrollMetrics(comp.getElement()!);

        expect(metrics.clientWidth).toBe(120);
        expect(metrics.clientHeight).toBe(80);
        expect(metrics.scrollLeft).toBe(5);
        expect(metrics.scrollTop).toBe(7);
        // No overflow injected → scroll extent equals client box.
        expect(metrics.scrollWidth).toBe(120);
        expect(metrics.scrollHeight).toBe(80);
    });

    // Case 15: getOffsetSize reports the recorded top + height writes.
    it('reports offset top and height from writes', () => {
        installTestDOM(CONFIG);

        const root = new Component({});
        const mid  = new Component({});

        root.getElement(true);
        root.addComponent(mid);

        mid.setY(50);
        mid.setHeight(30);

        const offset = DOM.source.getOffsetSize(mid.getElement()!);

        expect(offset.offsetTop).toBe(50);
        expect(offset.offsetHeight).toBe(30);
    });

    // Case 16: hit-test returns containing rects, topmost first; outside → [].
    it('returns containing rects topmost-first and empty outside', () => {
        installTestDOM(CONFIG);

        const root = new Component({});
        const a    = new Component({});
        const b    = new Component({});

        root.getElement(true);
        root.addComponent(a);
        root.addComponent(b);

        // Two overlapping siblings under root. b is the later sibling.
        a.setX(0);
        a.setY(0);
        a.setWidth(100);
        a.setHeight(100);

        b.setX(0);
        b.setY(0);
        b.setWidth(100);
        b.setHeight(100);

        // Point inside both (composed: root offset 1000,2000 + local 0..100).
        const hits = DOM.source.elementsFromPoint(1050, 2050);

        expect(hits).toContain(a.getElement()!);
        expect(hits).toContain(b.getElement()!);
        // Later sibling paints on top.
        expect(hits.indexOf(b.getElement()!)).toBeLessThan(hits.indexOf(a.getElement()!));

        expect(DOM.source.elementsFromPoint(1, 1)).toEqual([]);
    });

    // Case 17: hit-test z-orders a descendant before its ancestor.
    it('orders a descendant before its ancestor in the hit stack', () => {
        installTestDOM(CONFIG);

        const root   = new Component({});
        const parent = new Component({});
        const child  = new Component({});

        root.getElement(true);
        root.addComponent(parent);
        parent.addComponent(child);

        parent.setX(0);
        parent.setY(0);
        parent.setWidth(100);
        parent.setHeight(100);

        child.setX(10);
        child.setY(10);
        child.setWidth(20);
        child.setHeight(20);

        // Point inside the child (and thus inside the parent).
        const hits = DOM.source.elementsFromPoint(1015, 2015);

        expect(hits.indexOf(child.getElement()!)).toBeLessThan(hits.indexOf(parent.getElement()!));
    });

    // Case 18: getNaturalSize round-trips an injected size; default zero.
    it('round-trips an injected natural size', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});

        comp.getElement(true);

        const handle = comp.getElement()! as Handle;

        expect(DOM.source.getNaturalSize(handle)).toEqual({ width: 0, height: 0 });

        setNaturalSize(handle, 320, 240);

        expect(DOM.source.getNaturalSize(handle)).toEqual({ width: 320, height: 240 });
    });

    // Case 19: focus model round-trips through the sink/source.
    it('round-trips focus through the sink and source', () => {
        installTestDOM(CONFIG);

        const a = new Component({});
        const b = new Component({});

        a.getElement(true);
        b.getElement(true);

        expect(DOM.source.getActiveElement()).toBeNull();

        DOM.sink.focus(a.getElement()!);

        expect(DOM.source.getActiveElement()).toBe(a.getElement()!);

        DOM.sink.focus(b.getElement()!);

        expect(DOM.source.getActiveElement()).toBe(b.getElement()!);

        DOM.sink.blur(b.getElement()!);

        expect(DOM.source.getActiveElement()).toBeNull();
    });
});
