// Runs in the default `node` environment. The modelled harness delivers events
// by driving the framework's real `baseListener` over a sink-recorded modelled
// tree with plain-sentinel synthetic events, so the Event namespace's routing
// (exact-target, subtree, viewport, consume-once) is exercised offline.
import { describe, it, expect, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { Event } from '~/core/Event';
import { consumeWheel } from '~/core/SmoothScroller';
import { installTestDOM, makeEvent } from './TestDOM';
import fontMetrics from './font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** A fresh event type per use so module-level Event state never leaks between tests. */
let typeCounter = 0;

function uniqueType(): string {
    typeCounter += 1;

    return `dlv-${typeCounter}`;
}

describe('Modelled event delivery — exact-target routing', () => {
    afterEach(() => DOM.reset());

    // Case 1: exact-target match fires; a sibling target does not.
    it('fires the exact-target listener once and not on a sibling', () => {
        installTestDOM(CONFIG);

        const compA = new Component({});
        const compB = new Component({});
        const type  = uniqueType();

        compA.getElement(true);
        compB.getElement(true);

        let runs       = 0;
        let seenThis: unknown = null;

        Event.addListener(compA, type, function (this: unknown): void {
            runs += 1;
            seenThis = this;
        });

        DOM.sink.dispatchEvent(compA.getElement()!, makeEvent(compA.getElement()!, type));

        expect(runs).toBe(1);
        expect(seenThis).toBe(compA);

        DOM.sink.dispatchEvent(compB.getElement()!, makeEvent(compB.getElement()!, type));

        expect(runs).toBe(1);
    });

    // Case 2: an exact-target listener stops the subtree walk only when the user
    // calls stopPropagation; otherwise the ancestor subtree listener still runs.
    it('runs an ancestor subtree listener after an exact-target match unless stopPropagation is called', () => {
        installTestDOM(CONFIG);

        const root   = new Component({});
        const target = new Component({});
        const type   = uniqueType();

        root.getElement(true);
        root.addComponent(target);

        let ancestorRuns = 0;

        Event.addSubtreeListener(root, type, () => { ancestorRuns += 1; });
        Event.addListener(target, type, () => { /* no stopPropagation */ });

        DOM.sink.dispatchEvent(target.getElement()!, makeEvent(target.getElement()!, type));

        expect(ancestorRuns).toBe(1);

        Event.addListener(target, type, (evnt: globalThis.Event) => { evnt.stopPropagation(); });

        DOM.sink.dispatchEvent(target.getElement()!, makeEvent(target.getElement()!, type));

        // stopPropagation in the exact-target handler skips the subtree walk.
        expect(ancestorRuns).toBe(1);
    });

    // Case 3: subtree listeners fire on every matching ancestor, descendant-first.
    it('fires subtree listeners descendant-first up the ancestor chain', () => {
        installTestDOM(CONFIG);

        const root = new Component({});
        const mid  = new Component({});
        const leaf = new Component({});
        const type = uniqueType();

        root.getElement(true);
        root.addComponent(mid);
        mid.addComponent(leaf);

        const order: string[] = [];

        Event.addSubtreeListener(root, type, () => { order.push('root'); });
        Event.addSubtreeListener(mid, type, () => { order.push('mid'); });

        DOM.sink.dispatchEvent(leaf.getElement()!, makeEvent(leaf.getElement()!, type));

        expect(order).toEqual(['mid', 'root']);
    });

    // Case 4: a subtree listener fires when the target is the ancestor itself.
    it('fires a subtree listener when the target is the listening component', () => {
        installTestDOM(CONFIG);

        const root = new Component({});
        const mid  = new Component({});
        const type = uniqueType();

        root.getElement(true);
        root.addComponent(mid);

        let runs = 0;

        Event.addSubtreeListener(mid, type, () => { runs += 1; });

        DOM.sink.dispatchEvent(mid.getElement()!, makeEvent(mid.getElement()!, type));

        expect(runs).toBe(1);
    });

    // Case 5: consume-once stops ancestor handling — the same event object
    // reaches both listeners and the marker survives between them.
    it('lets an inner wheel listener consume the event so the ancestor skips it', () => {
        installTestDOM(CONFIG);

        const outer = new Component({});
        const inner = new Component({});
        // A unique type (not literal "wheel") keeps Event's module-level state
        // isolated across tests; consumeWheel keys off a marker, not the type.
        const type  = uniqueType();

        outer.getElement(true);
        outer.addComponent(inner);

        let outerClaimed: boolean | null = null;
        let innerClaimed: boolean | null = null;

        Event.addSubtreeListener(outer, type, (e: WheelEvent) => { outerClaimed = consumeWheel(e); });
        Event.addSubtreeListener(inner, type, (e: WheelEvent) => { innerClaimed = consumeWheel(e); });

        DOM.sink.dispatchEvent(inner.getElement()!, makeEvent(inner.getElement()!, type) as unknown as WheelEvent);

        expect(innerClaimed).toBe(true);
        expect(outerClaimed).toBe(false);
    });

    // Case 6: unbound method handlers keep a stable `this` via listener.apply.
    it('invokes an unbound component method with the component as this', () => {
        installTestDOM(CONFIG);

        const type = uniqueType();

        class Probe extends Component {
            seen: unknown = null;

            handle(): void {
                this.seen = this;
            }
        }

        const comp = new Probe({});

        comp.getElement(true);

        // Pass the method unbound — Event.apply must restore `this`.
        Event.addListener(comp, type, comp.handle);

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type));

        expect(comp.seen).toBe(comp);
    });

    // Case 7: a viewport listener fires regardless of the event target.
    it('fires a viewport listener for an unrelated target', () => {
        installTestDOM(CONFIG);

        const listening = new Component({});
        const unrelated = new Component({});
        const type      = uniqueType();

        listening.getElement(true);
        unrelated.getElement(true);

        let runs = 0;

        Event.addViewportListener(listening, type, () => { runs += 1; });

        DOM.sink.dispatchEvent(unrelated.getElement()!, makeEvent(unrelated.getElement()!, type));

        expect(runs).toBe(1);
    });

    // Case 8: dispatching a type with no listeners is a no-op (still records).
    it('is a no-op when no listener is registered for the type', () => {
        const sink = installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        expect(() => DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type))).not.toThrow();
        expect(sink.writes.some((w) => w.op === 'dispatchEvent' && w.args[0] === type)).toBe(true);
    });

    // Case 9: removing the last listener stops delivery.
    it('stops delivering after the last listener is removed', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();
        const h    = (): void => { runs += 1; };
        let   runs = 0;

        comp.getElement(true);

        Event.addListener(comp, type, h);
        Event.removeListener(comp, type, h);

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type));

        expect(runs).toBe(0);
    });

    // Case 10: event coordinate/key fields reach the handler.
    it('passes clientX / key fields through to the handler', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let seenX:   number | undefined;
        let seenKey: string | undefined;

        Event.addListener(comp, type, (evnt: MouseEvent & { key?: string }) => {
            seenX   = evnt.clientX;
            seenKey = evnt.key;
        });

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type, { clientX: 42, key: 'Enter' }));

        expect(seenX).toBe(42);
        expect(seenKey).toBe('Enter');
    });
});

describe('Modelled event delivery — polite propagation', () => {
    afterEach(() => DOM.reset());

    // The dispatcher must not stop native propagation on a component's behalf:
    // an event a component handled but did not consume keeps bubbling, so a
    // document-level accelerator still fires while a library component is
    // focused. Counted by swapping the event's native stopPropagation for a spy
    // before dispatch — baseListener binds that as its `originalStop`.
    it('does not stop native propagation when the exact-target handler does not consume', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let nativeStops = 0;
        const evt = makeEvent(comp.getElement()!, type);
        (evt as unknown as { stopPropagation: () => void }).stopPropagation = () => { nativeStops += 1; };

        Event.addListener(comp, type, () => { /* handles, does not consume */ });
        DOM.sink.dispatchEvent(comp.getElement()!, evt);

        expect(nativeStops).toBe(0);
    });

    it('stops native propagation when a handler explicitly consumes the event', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let nativeStops = 0;
        const evt = makeEvent(comp.getElement()!, type);
        (evt as unknown as { stopPropagation: () => void }).stopPropagation = () => { nativeStops += 1; };

        Event.addListener(comp, type, (e: globalThis.Event) => e.stopPropagation());
        DOM.sink.dispatchEvent(comp.getElement()!, evt);

        expect(nativeStops).toBe(1);
    });
});
