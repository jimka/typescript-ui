// @vitest-environment jsdom
//
// Coverage for the framework Tab traversal service's `DOMSource.isRenderedVisible()`
// seam member (plans/in-progress/framework-focus-traversal.md, step 1) — against the
// REAL production source (the `jsdom` pragma keeps `tests/setup/node-setup.ts` from
// installing the modelled DOM, mirroring `tests/dom/countElements.test.ts`), and
// against the modelled source via the injected `setRenderedVisible` seed, the same
// pattern `setConnected` uses for a property the model has no other way to derive.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM, ProductionDOMSource } from '~/core/DOM';
import { installTestDOM, setRenderedVisible } from './TestDOM';
import fontMetrics from './font-metrics.test-font.json';

describe('ProductionDOMSource.isRenderedVisible', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('is true for a plain connected element', () => {
        const source = new ProductionDOMSource();
        const el = document.createElement('div');
        document.body.appendChild(el);

        expect(source.isRenderedVisible(source.intern(el))).toBe(true);
    });

    it('is false for an element with display:none set directly', () => {
        const source = new ProductionDOMSource();
        const el = document.createElement('div');
        el.style.display = 'none';
        document.body.appendChild(el);

        expect(source.isRenderedVisible(source.intern(el))).toBe(false);
    });

    it('is false for an element under a display:none ancestor', () => {
        const source = new ProductionDOMSource();
        const parent = document.createElement('div');
        const child = document.createElement('span');
        parent.style.display = 'none';
        parent.appendChild(child);
        document.body.appendChild(parent);

        expect(source.isRenderedVisible(source.intern(child))).toBe(false);
    });

    it('is false for an element under a visibility:hidden ancestor', () => {
        const source = new ProductionDOMSource();
        const parent = document.createElement('div');
        const child = document.createElement('span');
        parent.style.visibility = 'hidden';
        parent.appendChild(child);
        document.body.appendChild(parent);

        expect(source.isRenderedVisible(source.intern(child))).toBe(false);
    });
});

describe('ModelledDOMSource.isRenderedVisible', () => {
    afterEach(() => DOM.reset());

    const CONFIG = {
        rootMountOffset: { x: 0, y: 0 },
        viewport:        { width: 1280, height: 800 },
        scrollBarWidth:  15,
        fontMetrics,
        themeVars:       {},
    };

    it('defaults to true for a handle never marked hidden', () => {
        installTestDOM(CONFIG);
        const el = DOM.sink.createElement('div');

        expect(DOM.source.isRenderedVisible(el)).toBe(true);
    });

    it('is false once marked hidden via setRenderedVisible', () => {
        installTestDOM(CONFIG);
        const el = DOM.sink.createElement('div');
        setRenderedVisible(el, false);

        expect(DOM.source.isRenderedVisible(el)).toBe(false);
    });

    it('is false for a descendant of a handle marked hidden, even though the descendant itself was never marked', () => {
        installTestDOM(CONFIG);
        const parent = DOM.sink.createElement('div');
        const child  = DOM.sink.createElement('span');
        DOM.sink.appendChild(parent, child);
        setRenderedVisible(parent, false);

        expect(DOM.source.isRenderedVisible(child)).toBe(false);
    });
});
