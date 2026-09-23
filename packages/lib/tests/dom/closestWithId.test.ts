// @vitest-environment jsdom
//
// Coverage for the subtree-dispatch walk's `DOMSource.closestWithId()` seam
// member (plans/in-progress/event-dispatch-walk.md, step 6) — against the REAL
// production source (the `jsdom` pragma keeps `tests/setup/node-setup.ts` from
// installing the modelled DOM, mirroring `tests/dom/isRenderedVisible.test.ts`),
// and against the modelled source over a component chain built with
// `addComponent`, the same way `tests/dom/events.test.ts` builds one.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM, ProductionDOMSink, ProductionDOMSource, type Handle } from '~/core/DOM';
import { Component } from '~/core/Component';
import { installTestDOM } from './TestDOM';
import fontMetrics from './font-metrics.test-font.json';

/** Appends a fresh `<div>` with the given id (empty for none) under `parent`. */
function div(parent: Node, id: string): HTMLDivElement {
    const el = document.createElement('div');

    if (id !== '') {
        el.id = id;
    }

    parent.appendChild(el);

    return el;
}

describe('ProductionDOMSource.closestWithId', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('C1 — matches the start node itself', () => {
        const source = new ProductionDOMSource();
        const a = div(document.body, 'x');
        div(a, '');

        expect(source.closestWithId(source.intern(a), new Set(['x']))).toEqual({ handle: source.intern(a), id: 'x' });
    });

    it('C2 — matches the nearest registered ancestor, not the farthest', () => {
        const source = new ProductionDOMSource();
        const a = div(document.body, 'x');
        const b = div(a, 'y');
        const c = div(b, '');

        expect(source.closestWithId(source.intern(c), new Set(['x', 'y']))).toEqual({ handle: source.intern(b), id: 'y' });
    });

    it('C3 — returns null when nothing up to the root matches', () => {
        const source = new ProductionDOMSource();
        const a = div(document.body, 'x');
        const b = div(a, '');
        const c = div(b, '');

        expect(source.closestWithId(source.intern(c), new Set(['z']))).toBeNull();
    });

    it('C4 — an empty id never matches', () => {
        const source = new ProductionDOMSource();
        const a = div(document.body, '');
        const b = div(a, '');

        expect(source.closestWithId(source.intern(b), new Set(['']))).toBeNull();
    });

    it('C5 — a text-node start climbs to its parent element', () => {
        const source = new ProductionDOMSource();
        const a = div(document.body, 'x');
        const t = document.createTextNode('hello');
        a.appendChild(t);

        expect(source.closestWithId(source.intern(t), new Set(['x']))).toEqual({ handle: source.intern(a), id: 'x' });
    });

    it('C6 — the document and the window match nothing and do not throw', () => {
        const source = new ProductionDOMSource();
        div(document.body, 'x');

        expect(source.closestWithId(source.intern(document), new Set(['x']))).toBeNull();
        expect(source.closestWithId(source.intern(window), new Set(['x']))).toBeNull();
    });

    it('C7 — a released handle throws, as every handle-taking read does', () => {
        const sink   = new ProductionDOMSink();
        const source = new ProductionDOMSource();
        const handle = sink.createElement('div');
        sink.release(handle);

        expect(() => source.closestWithId(handle, new Set(['x']))).toThrow(/is not registered/);
    });

    it('C8 — the climb stops at the top of a shadow tree, where parentElement does', () => {
        const source = new ProductionDOMSource();
        const host = div(document.body, 'x');
        const root = host.attachShadow({ mode: 'open' });
        const s = document.createElement('span');
        root.appendChild(s);

        expect(source.closestWithId(source.intern(s), new Set(['x']))).toBeNull();
    });

    it('C9 — any lookup with a `has` method serves: a Map, a Set, a bare object', () => {
        const source = new ProductionDOMSource();
        const a = div(document.body, 'x');
        const b = div(a, '');
        const expected = { handle: source.intern(a), id: 'x' };

        expect(source.closestWithId(source.intern(b), new Map([['x', 1]]))).toEqual(expected);
        expect(source.closestWithId(source.intern(b), new Set(['x']))).toEqual(expected);
        expect(source.closestWithId(source.intern(b), { has: (id: string) => id === 'x' })).toEqual(expected);
    });
});

describe('ModelledDOMSource.closestWithId', () => {
    afterEach(() => DOM.reset());

    const CONFIG = {
        rootMountOffset: { x: 0, y: 0 },
        viewport:        { width: 1280, height: 800 },
        scrollBarWidth:  15,
        fontMetrics,
        themeVars:       {},
    };

    /** A root/mid/leaf component chain in the modelled tree, leaf-deepest. */
    function buildChain(): { mid: Component; leaf: Component } {
        const root = new Component({});
        const mid  = new Component({});
        const leaf = new Component({});

        root.getElement(true);
        root.addComponent(mid);
        mid.addComponent(leaf);

        return { mid, leaf };
    }

    it('M1 — climbs the recorded parents to the nearest matching stub', () => {
        installTestDOM(CONFIG);
        const { mid, leaf } = buildChain();

        expect(DOM.source.closestWithId(leaf.getElement()!, new Set([mid.getId()]))).toEqual({
            handle: mid.getElement()!,
            id:     mid.getId(),
        });
    });

    it('M2 — returns null on no match, and throws on an unminted handle', () => {
        installTestDOM(CONFIG);
        const { leaf } = buildChain();

        expect(DOM.source.closestWithId(leaf.getElement()!, new Set(['nope']))).toBeNull();

        // Far past anything `TestHandleTable` mints in one test, so the stub
        // lookup is guaranteed to miss — the modelled `getId` throws the same way.
        const unminted = 9999999 as unknown as Handle;

        expect(() => DOM.source.closestWithId(unminted, new Set(['nope']))).toThrow(/is not registered/);
    });
});
