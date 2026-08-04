// @vitest-environment jsdom
//
// A component disposed synchronously by a handler running during an event's
// own dispatch can leave `Event.ts`'s subtree-listener ancestor walk holding a
// handle that disposal just released. The offline modelled DOM (RecordingDOMSink)
// doesn't evict its stub table on release, so a throw-based case would pass
// vacuously there — this file runs under the real production seam
// (ProductionDOMSink/ProductionDOMSource), mirroring handle-registry.test.ts,
// where `release()` genuinely evicts the registry entry and a later resolve
// genuinely throws.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DOM, ProductionDOMSink, ProductionDOMSource } from '~/core/DOM';
import { Component } from '~/core/Component';
import { Event } from '~/core/Event';

const sink   = (): ProductionDOMSink   => DOM.sink   as ProductionDOMSink;
const source = (): ProductionDOMSource => DOM.source as ProductionDOMSource;

// Builds a chain of `count` real Components, each mounted as the DOM child of
// the previous, with the first entry mounted under document.body. Returns the
// chain root-to-target order, i.e. chain[0] is the outermost ancestor and
// chain[chain.length - 1] is the dispatch target.
function buildChain(count: number): Component[] {
    const chain: Component[] = [];
    let parentHandle = source().getBody();

    for (let i = 0; i < count; i++) {
        const c = new Component({});
        const el = c.getElement(true)!;
        sink().appendChild(parentHandle, el);
        chain.push(c);
        parentHandle = el;
    }

    return chain;
}

// Dispatches `type` on `target`'s live DOM element and reports whether jsdom's
// `reportException` surfaced an uncaught error. An exception thrown inside a
// native event listener does not propagate through dispatchEvent()'s own call
// stack — jsdom instead dispatches a synchronous 'error' event on `window`,
// mirroring the real browser's "report the exception" algorithm.
function dispatchAndCatch(target: Component, type: string): ErrorEvent | null {
    let caught: ErrorEvent | null = null;
    const onError = (e: ErrorEvent) => {
        caught = e;
        e.preventDefault();
    };

    window.addEventListener('error', onError);
    try {
        document.getElementById(target.getId())!.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    } finally {
        window.removeEventListener('error', onError);
    }

    return caught;
}

describe('subtree-listener dispatch survives same-event reentrant dispose', () => {
    afterEach(() => {
        DOM.reset();
    });

    it('EV1 — an exact-target listener disposing its own click target does not crash the subtree walk', () => {
        const type = 'ev1-click';
        const [outer, child] = buildChain(2);

        const spy = vi.fn();
        Event.addSubtreeListener(outer, type, spy);
        Event.addListener(child, type, () => child.dispose());

        const caught = dispatchAndCatch(child, type);

        expect(caught).toBeNull();
        expect(spy).not.toHaveBeenCalled();
    });

    it('EV2 — a subtree listener disposing its own component ends the walk without crashing', () => {
        const type = 'ev2-click';
        const [outer, middle, target] = buildChain(3);

        const spy = vi.fn();
        Event.addSubtreeListener(outer, type, spy);
        Event.addSubtreeListener(middle, type, () => middle.dispose());

        const caught = dispatchAndCatch(target, type);

        expect(caught).toBeNull();
        expect(spy).not.toHaveBeenCalled();
    });

    it('EV3 — normal multi-level subtree dispatch is unaffected', () => {
        const type = 'ev3-click';
        const [outer, middle, target] = buildChain(3);
        const order: string[] = [];

        Event.addSubtreeListener(target, type, () => { order.push('target'); });
        Event.addSubtreeListener(middle, type, () => { order.push('middle'); });
        Event.addSubtreeListener(outer, type, () => { order.push('outer'); });

        const caught = dispatchAndCatch(target, type);

        expect(caught).toBeNull();
        expect(order).toEqual(['target', 'middle', 'outer']);
    });

    it('EV4 — a stopping disposition at a nearer ancestor still prevents a farther one from firing', () => {
        const type = 'ev4-click';
        const [outer, middle, target] = buildChain(3);

        const spy = vi.fn();
        const middleListener = vi.fn(() => true);
        Event.addSubtreeListener(outer, type, spy);
        Event.addSubtreeListener(middle, type, middleListener);

        const caught = dispatchAndCatch(target, type);

        expect(caught).toBeNull();
        expect(middleListener).toHaveBeenCalledTimes(1);
        expect(spy).not.toHaveBeenCalled();
    });
});
