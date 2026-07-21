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

    // The viewport dispatcher (baseViewportListener) must follow the same
    // policy as baseListener: it never stops native propagation on a
    // component's behalf. Before the fix it called stopPropagation()
    // unconditionally, so registering a single viewport listener for a type
    // (e.g. "keydown") silenced that type app-wide.

    // Case 1: an unconsumed viewport event keeps propagating.
    it('does not stop native propagation when an unconsumed viewport handler runs', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let nativeStops = 0;
        let handlerRuns = 0;
        const evt = makeEvent(comp.getElement()!, type);
        (evt as unknown as { stopPropagation: () => void }).stopPropagation = () => { nativeStops += 1; };

        Event.addViewportListener(comp, type, () => { handlerRuns += 1; });
        DOM.sink.dispatchEvent(comp.getElement()!, evt);

        expect(handlerRuns).toBe(1);
        expect(nativeStops).toBe(0);
    });

    // Case 2: a consumed viewport event is halted.
    it('stops native propagation when a viewport handler explicitly consumes the event', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let nativeStops = 0;
        const evt = makeEvent(comp.getElement()!, type);
        (evt as unknown as { stopPropagation: () => void }).stopPropagation = () => { nativeStops += 1; };

        Event.addViewportListener(comp, type, (e: globalThis.Event) => e.stopPropagation());
        DOM.sink.dispatchEvent(comp.getElement()!, evt);

        expect(nativeStops).toBe(1);
    });

    // Case 3: a consume from one registered component does not silence the
    // others — the viewport dispatcher is a flat broadcast, not a chain that
    // a stop can cut short. Verified with both registration orders.
    it('runs every registered viewport component even when one of them consumes', () => {
        installTestDOM(CONFIG);

        const first  = new Component({});
        const second = new Component({});
        const type   = uniqueType();

        first.getElement(true);
        second.getElement(true);

        let firstRuns  = 0;
        let secondRuns = 0;

        Event.addViewportListener(first, type, (e: globalThis.Event) => {
            firstRuns += 1;
            e.stopPropagation();
        });
        Event.addViewportListener(second, type, () => { secondRuns += 1; });

        DOM.sink.dispatchEvent(first.getElement()!, makeEvent(first.getElement()!, type));

        expect(firstRuns).toBe(1);
        expect(secondRuns).toBe(1);
    });

    it('runs every registered viewport component even when one of them consumes, reversed order', () => {
        installTestDOM(CONFIG);

        const first  = new Component({});
        const second = new Component({});
        const type   = uniqueType();

        first.getElement(true);
        second.getElement(true);

        let firstRuns  = 0;
        let secondRuns = 0;

        Event.addViewportListener(second, type, () => { secondRuns += 1; });
        Event.addViewportListener(first, type, (e: globalThis.Event) => {
            firstRuns += 1;
            e.stopPropagation();
        });

        DOM.sink.dispatchEvent(first.getElement()!, makeEvent(first.getElement()!, type));

        expect(firstRuns).toBe(1);
        expect(secondRuns).toBe(1);
    });

    // Case 4: dispatching a type with no viewport registrations runs no
    // handler and calls native stopPropagation 0 times.
    it('does not stop native propagation when there are no viewport registrations for the type', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let nativeStops = 0;
        const evt = makeEvent(comp.getElement()!, type);
        (evt as unknown as { stopPropagation: () => void }).stopPropagation = () => { nativeStops += 1; };

        DOM.sink.dispatchEvent(comp.getElement()!, evt);

        expect(nativeStops).toBe(0);
    });
});

describe('Modelled event delivery — setId reindex', () => {
    afterEach(() => DOM.reset());

    // Case 1: an exact-target listener registered before setId still fires
    // after the id changes, because reindexComponent moves its listenerMap
    // entry from the old id to the new id.
    it('keeps an exact-target listener firing after setId changes the id', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let runs = 0;
        let seenThis: unknown = null;

        Event.addListener(comp, type, function (this: unknown): void {
            runs += 1;
            seenThis = this;
        });

        comp.setId('reindex-exact-new-id');

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type));

        expect(runs).toBe(1);
        expect(seenThis).toBe(comp);
    });

    // Case 2: a subtree listener registered before setId still fires for a
    // descendant event after the ancestor's id changes.
    it('keeps a subtree listener firing after setId changes the ancestor id', () => {
        installTestDOM(CONFIG);

        const root  = new Component({});
        const child = new Component({});
        const type  = uniqueType();

        root.getElement(true);
        root.addComponent(child);

        let runs = 0;

        Event.addSubtreeListener(root, type, () => { runs += 1; });

        root.setId('reindex-subtree-new-id');

        DOM.sink.dispatchEvent(child.getElement()!, makeEvent(child.getElement()!, type));

        expect(runs).toBe(1);
    });

    // Case 3: removeListener still finds and removes an exact-target
    // registration after setId re-keys it to the new id.
    it('lets removeListener remove an exact-target listener after setId', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();
        const h    = (): void => { runs += 1; };
        let   runs = 0;

        comp.getElement(true);

        Event.addListener(comp, type, h);
        comp.setId('reindex-exact-remove-new-id');
        Event.removeListener(comp, type, h);

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type));

        expect(runs).toBe(0);
    });

    // Case 4: removeSubtreeListener still finds and removes a subtree
    // registration after setId re-keys it to the new id.
    it('lets removeSubtreeListener remove a subtree listener after setId', () => {
        installTestDOM(CONFIG);

        const root  = new Component({});
        const child = new Component({});
        const type  = uniqueType();
        const h     = (): void => { runs += 1; };
        let   runs  = 0;

        root.getElement(true);
        root.addComponent(child);

        Event.addSubtreeListener(root, type, h);
        root.setId('reindex-subtree-remove-new-id');
        Event.removeSubtreeListener(root, type, h);

        DOM.sink.dispatchEvent(child.getElement()!, makeEvent(child.getElement()!, type));

        expect(runs).toBe(0);
    });

    // Case 5: setId to the SAME id must not self-destruct the registration —
    // a naive set-then-delete on equal keys would wipe out a live listener.
    it('keeps a listener alive when setId is called with the same id', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let runs = 0;

        Event.addListener(comp, type, () => { runs += 1; });

        comp.setId(comp.getId());

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type));

        expect(runs).toBe(1);
    });

    // Case 6: setId on a component with no registrations at all is a
    // harmless no-op.
    it('does not throw when setId is called on a component with no listeners', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});

        comp.getElement(true);

        expect(() => comp.setId('reindex-no-listeners-new-id')).not.toThrow();
    });

    // Case 7: a viewport listener is never keyed by id at dispatch, so setId
    // must neither help nor harm it — regression guard for the exclusion.
    it('leaves a viewport listener unaffected by setId', () => {
        installTestDOM(CONFIG);

        const listening = new Component({});
        const unrelated = new Component({});
        const type      = uniqueType();

        listening.getElement(true);
        unrelated.getElement(true);

        let runs = 0;

        Event.addViewportListener(listening, type, () => { runs += 1; });

        listening.setId('reindex-viewport-new-id');

        DOM.sink.dispatchEvent(unrelated.getElement()!, makeEvent(unrelated.getElement()!, type));

        expect(runs).toBe(1);
    });
});
