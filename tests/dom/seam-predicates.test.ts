// Runs in the default `node` environment. Pins the seam predicates that replace
// the framework's remaining `instanceof Element/Node/HTMLInputElement` global
// checks, the `CSS.escape` selector route, and the custom-event dispatch path —
// exercised through the modelled source/sink so production code never names a
// DOM constructor.
import { describe, it, expect, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { Event } from '~/core/Event';
import { installTestDOM, makeEvent } from './TestDOM';
import fontMetrics from './font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Extracts the sentinel target a `makeEvent` event carries — the value a real
 *  `e.relatedTarget` / `e.target` is at an event boundary before `intern`. */
function sentinelOf(handle: number): EventTarget {
    return (makeEvent(handle as never, 'x').target) as unknown as EventTarget;
}

describe('Seam predicates — isNode / isElement', () => {
    afterEach(() => DOM.reset());

    // Case 1: isNode is true for an event-target sentinel, false for non-nodes.
    it('reports isNode true for a sentinel target and false otherwise', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        comp.getElement(true);

        expect(DOM.source.isNode(sentinelOf(comp.getElement()! as unknown as number))).toBe(true);
        expect(DOM.source.isNode(null)).toBe(false);
        expect(DOM.source.isNode('x')).toBe(false);
        expect(DOM.source.isNode({})).toBe(false);
        expect(DOM.source.isNode(42)).toBe(false);
    });

    // Case 2: isElement narrows the same way — true for an element sentinel,
    // false for a plain non-node value.
    it('reports isElement true for a sentinel target and false otherwise', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        comp.getElement(true);

        expect(DOM.source.isElement(sentinelOf(comp.getElement()! as unknown as number))).toBe(true);
        expect(DOM.source.isElement(null)).toBe(false);
        expect(DOM.source.isElement('x')).toBe(false);
        expect(DOM.source.isElement({})).toBe(false);
    });
});

describe('Seam predicate — getTagName', () => {
    afterEach(() => DOM.reset());

    // Case 3: getTagName reports the handle's uppercased tag, so the calendar
    // guard can ask "is this the inner INPUT?" without naming HTMLInputElement.
    it('reports the tag name of a created element handle', () => {
        installTestDOM(CONFIG);

        const input = DOM.sink.createElement('input');

        expect(DOM.source.getTagName(input)).toBe('INPUT');
    });
});

describe('Seam predicate — escapeSelector', () => {
    afterEach(() => DOM.reset());

    // Case 4: a framework glyph id (all chars in [a-zA-Z0-9_-]) round-trips
    // unchanged; a char outside the set is backslash-quoted — matching the
    // deleted jsdom-setup CSS.escape shim.
    it('round-trips a plain glyph id and backslash-quotes a special char', () => {
        installTestDOM(CONFIG);

        expect(DOM.source.escapeSelector('ts-glyph-arrow-up')).toBe('ts-glyph-arrow-up');
        expect(DOM.source.escapeSelector('a.b')).toBe('a\\.b');
    });
});

describe('Seam dispatch — dispatchCustomEvent', () => {
    afterEach(() => DOM.reset());

    // Case 8: fireEvent's string overload now dispatches through the sink's
    // dispatchCustomEvent; the listener for the type runs with the payload
    // reachable as the event's detail, and no native CustomEvent is constructed.
    it('delivers a fired custom event with its detail to a listener', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        comp.getElement(true);

        let seenDetail: unknown = null;

        Event.addListener(comp, 'editkey', (e: CustomEvent) => { seenDetail = e.detail; });

        Event.fireEvent(comp, 'editkey', { detail: { keyCode: 13 } });

        expect(seenDetail).toEqual({ keyCode: 13 });
    });
});
