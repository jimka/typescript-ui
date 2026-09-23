// @vitest-environment jsdom
//
// The dispatch rules `Event.ts`'s subtree-listener ancestor walk must keep
// whatever finds each registered ancestor: a registration added, removed or
// reparented by a listener running inside the same dispatch, and the target
// shapes the walk has to survive — a text node, a shadow-retargeted host, the
// window and the document. Runs under the real production seam
// (ProductionDOMSink/ProductionDOMSource) like
// `event-subtree-reentrant-dispose.test.ts`, whose `buildChain` /
// `dispatchAndCatch` helpers this file copies, because the modelled offline
// tree has no shadow roots, window or document nodes to retarget through.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DOM, ProductionDOMSink, ProductionDOMSource, _handleRegistrySize } from '~/core/DOM';
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

// Dispatches a pre-built event on a raw node and reports whether jsdom's
// `reportException` surfaced an uncaught error. An exception thrown inside a
// native event listener does not propagate through dispatchEvent()'s own call
// stack — jsdom instead dispatches a synchronous 'error' event on `window`,
// mirroring the real browser's "report the exception" algorithm.
function dispatchNodeAndCatch(node: EventTarget, event: globalThis.Event): ErrorEvent | null {
    let caught: ErrorEvent | null = null;
    const onError = (e: ErrorEvent) => {
        caught = e;
        e.preventDefault();
    };

    window.addEventListener('error', onError);
    try {
        node.dispatchEvent(event);
    } finally {
        window.removeEventListener('error', onError);
    }

    return caught;
}

/** `dispatchNodeAndCatch` on a component's own element, with a bubbling MouseEvent. */
function dispatchAndCatch(target: Component, type: string): ErrorEvent | null {
    return dispatchNodeAndCatch(document.getElementById(target.getId())!, new MouseEvent(type, { bubbles: true }));
}

/** The live element of a component, by the id the framework gave it. */
function elementOf(component: Component): HTMLElement {
    return document.getElementById(component.getId())!;
}

describe('subtree-listener dispatch finds every registered ancestor', () => {
    afterEach(() => {
        DOM.reset();
        document.body.innerHTML = '';
    });

    it('W1 — a registration added by a listener mid-dispatch still runs in the same dispatch', () => {
        const type = 'w1-click';
        const [outer, middle, target] = buildChain(3);

        const spy = vi.fn();
        Event.addSubtreeListener(middle, type, () => { Event.addSubtreeListener(outer, type, spy); });

        const caught = dispatchAndCatch(target, type);

        expect(caught).toBeNull();
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('W2 — a registration removed by a listener mid-dispatch does not run', () => {
        const type = 'w2-click';
        const [outer, middle, target] = buildChain(3);

        const spy = vi.fn();
        Event.addSubtreeListener(outer, type, spy);
        Event.addSubtreeListener(middle, type, () => { Event.removeSubtreeListener(outer, type, spy); });

        const caught = dispatchAndCatch(target, type);

        expect(caught).toBeNull();
        expect(spy).not.toHaveBeenCalled();
    });

    it('W3 — a listener that reparents its own element is followed to its new ancestor', () => {
        const type = 'w3-click';
        const [outerA, inner, target] = buildChain(3);
        const [outerB] = buildChain(1);
        const order: string[] = [];

        Event.addSubtreeListener(outerA, type, () => { order.push('outerA'); });
        Event.addSubtreeListener(outerB, type, () => { order.push('outerB'); });
        Event.addSubtreeListener(inner, type, () => {
            order.push('inner');
            elementOf(outerB).appendChild(elementOf(inner));
        });

        const caught = dispatchAndCatch(target, type);

        expect(caught).toBeNull();
        expect(order).toEqual(['inner', 'outerB']);
    });

    it('W4 — a text-node target reaches its component ancestor', () => {
        const type = 'w4-click';
        const [host] = buildChain(1);
        const text = document.createTextNode('hello');
        elementOf(host).appendChild(text);

        const spy = vi.fn();
        Event.addSubtreeListener(host, type, spy);

        const caught = dispatchNodeAndCatch(text, new MouseEvent(type, { bubbles: true }));

        expect(caught).toBeNull();
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('W5 — a composed event from a shadow tree reaches the host\'s component ancestor', () => {
        const type = 'w5-click';
        const [host] = buildChain(1);
        const shadowHost = document.createElement('div');
        elementOf(host).appendChild(shadowHost);
        const span = document.createElement('span');
        shadowHost.attachShadow({ mode: 'open' }).appendChild(span);

        const spy = vi.fn();
        Event.addSubtreeListener(host, type, spy);

        const caught = dispatchNodeAndCatch(span, new MouseEvent(type, { bubbles: true, composed: true }));

        expect(caught).toBeNull();
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('W6 — a window or document target runs no subtree listener', () => {
        const type = 'w6-click';
        const [host] = buildChain(1);

        const spy = vi.fn();
        Event.addSubtreeListener(host, type, spy);

        expect(dispatchNodeAndCatch(window, new globalThis.Event(type))).toBeNull();
        expect(dispatchNodeAndCatch(document, new globalThis.Event(type, { bubbles: true }))).toBeNull();
        expect(spy).not.toHaveBeenCalled();
    });

    it('W7 — nothing the climb passes over is interned, only the target itself', () => {
        const type = 'w7-click';
        const [host] = buildChain(1);

        // Five unregistered raw elements between the target and the component
        // that holds the registration: the levels a per-level walk interns on
        // its way up, and the climb inside the seam does not.
        let node: HTMLElement = elementOf(host);

        for (let i = 0; i < 5; i++) {
            const child = document.createElement('div');
            node.appendChild(child);
            node = child;
        }

        const spy = vi.fn();
        Event.addSubtreeListener(host, type, spy);

        const before = _handleRegistrySize();
        const caught = dispatchNodeAndCatch(node, new MouseEvent(type, { bubbles: true }));
        const after = _handleRegistrySize();

        expect(caught).toBeNull();
        expect(spy).toHaveBeenCalledTimes(1);
        expect(after - before).toBe(1);
    });
});
