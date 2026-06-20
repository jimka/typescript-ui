// @vitest-environment jsdom
//
// Production handle-registry behaviour, exercised through the real
// ProductionDOMSink / ProductionDOMSource (which share the module registry).
// Mirrors the prototype proofs, retargeted at the shipped seam: canonicalization
// (handle === mirrors element ===), strong/weak lifecycle, batched apply, and
// resolve-throws-on-stale.
import { describe, it, expect, afterEach } from 'vitest';
import {
    DOM,
    ProductionDOMSink,
    ProductionDOMSource,
    _handleRegistrySize,
} from '~/core/DOM';
import { Component } from '~/core/Component';

const sink   = (): ProductionDOMSink   => DOM.sink   as ProductionDOMSink;
const source = (): ProductionDOMSource => DOM.source as ProductionDOMSource;

describe('production handle registry', () => {
    afterEach(() => {
        DOM.reset();   // rebuilds the shared registry — each test starts clean
    });

    it('interns a node to the same handle every time (canonicalization)', () => {
        const a = document.createElement('div');
        const b = document.createElement('div');

        expect(source().intern(a)).toBe(source().intern(a));
        expect(source().intern(a)).not.toBe(source().intern(b));
    });

    it('applies a batched patch to the interned element', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        const h = source().intern(el);

        sink().apply(h, {
            style:    { width: '120px', height: '40px', '--ts-accent': 'red' },
            addClass: ['Panel', 'active'],
            setAttr:  { role: 'group' },
        });

        expect(el.style.width).toBe('120px');
        expect(el.style.getPropertyValue('--ts-accent')).toBe('red');
        expect(el.classList.contains('Panel')).toBe(true);
        expect(el.getAttribute('role')).toBe('group');

        document.body.removeChild(el);
    });

    it('removals apply before additions in one patch', () => {
        const el = document.createElement('div');
        const h  = source().intern(el);

        sink().apply(h, { addClass: ['x'] });
        sink().apply(h, { removeClass: ['x'], addClass: ['x'] });

        expect(el.classList.contains('x')).toBe(true);
    });

    it('fluent edit() compiles to one apply', () => {
        const el = document.createElement('div');
        const h  = source().intern(el);

        sink().edit(h).style('width', '10px').addClass('a').attr('data-k', 'v').text('hi').commit();

        expect(el.style.width).toBe('10px');
        expect(el.classList.contains('a')).toBe(true);
        expect(el.getAttribute('data-k')).toBe('v');
        expect(el.textContent).toBe('hi');
    });

    it('release drops the entry and makes a later resolve throw', () => {
        const el = document.createElement('div');
        const h  = source().intern(el);

        expect(_handleRegistrySize()).toBe(1);

        sink().release(h);

        expect(_handleRegistrySize()).toBe(0);
        expect(() => sink().apply(h, { style: { width: '1px' } })).toThrow(/not registered/);
    });

    it('resolving a never-minted handle throws rather than silently no-opping', () => {
        expect(() => sink().apply(99999 as never, { text: 'x' })).toThrow(/not registered/);
    });
});

describe('component dispose releases every retained handle', () => {
    afterEach(() => {
        DOM.reset();
    });

    // The systematic guard for the created-element lifecycle: a full
    // render-then-destroy cycle, including an active clip frame, must return the
    // registry to exactly its pre-render size. A missed release on any retained
    // created element (root, clip/content frame, child) fails this.
    it('destructor returns the registry to its pre-render size (root + clip frame)', () => {
        const host  = document.createElement('div');
        document.body.appendChild(host);
        const hostH = source().intern(host);   // weak; persists across the cycle

        const before = _handleRegistrySize();

        const c  = new Component({});
        const el = c.getElement(true)!;          // render → strongly retains the root
        sink().appendChild(hostH, el);           // mount so setClipFrame has a parent
        c.setClipFrame(0, 0, 10, 10);            // creates + retains the frame wrapper

        expect(_handleRegistrySize()).toBeGreaterThan(before);

        (c as unknown as { destructor(): void }).destructor();

        expect(_handleRegistrySize()).toBe(before);

        document.body.removeChild(host);
    });

    // The discard path: a component removed via removeComponent detaches but
    // cannot release (releasing there would break moveComponent), so release is
    // keyed on the Component being garbage-collected. Gated on --expose-gc; the
    // normal suite can't force GC, so it self-skips. Run:
    //   node --expose-gc ./node_modules/vitest/vitest.mjs run \
    //     --no-file-parallelism tests/dom/handle-registry.test.ts
    it('releases a discarded component root once it is garbage-collected', async () => {
        const gc = (globalThis as { gc?: () => void }).gc;

        if (!gc) {
            return;   // --expose-gc absent; covered by the eager-destructor test above
        }

        const before = _handleRegistrySize();

        let c: Component | null = new Component({});
        c.getElement(true);   // render → strongly retains the (detached) root

        expect(_handleRegistrySize()).toBeGreaterThan(before);

        c = null;             // discard: drop the only reference, no destructor

        for (let pass = 0; pass < 10; pass += 1) {
            gc();
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        expect(_handleRegistrySize()).toBe(before);
    });
});
