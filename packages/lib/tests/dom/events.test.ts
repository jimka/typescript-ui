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

    // Case 2: an exact-target listener stops the subtree walk only when it
    // returns a stop disposition; otherwise the ancestor subtree listener
    // still runs.
    it('runs an ancestor subtree listener after an exact-target match unless the listener returns a stop disposition', () => {
        installTestDOM(CONFIG);

        const root   = new Component({});
        const target = new Component({});
        const type   = uniqueType();

        root.getElement(true);
        root.addComponent(target);

        let ancestorRuns = 0;

        Event.addSubtreeListener(root, type, () => { ancestorRuns += 1; });
        Event.addListener(target, type, () => { /* returns nothing — does not consume */ });

        DOM.sink.dispatchEvent(target.getElement()!, makeEvent(target.getElement()!, type));

        expect(ancestorRuns).toBe(1);

        Event.addListener(target, type, () => true);

        DOM.sink.dispatchEvent(target.getElement()!, makeEvent(target.getElement()!, type));

        // Returning true stops propagation and skips the subtree walk.
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

    // Case 8: a repeated viewport registration of the same reference is ignored.
    it('ignores a repeated viewport registration of the same reference', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let runs = 0;
        const f = (): void => { runs += 1; };

        Event.addViewportListener(comp, type, f);
        Event.addViewportListener(comp, type, f);

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type));

        expect(runs).toBe(1);
    });

    // Case 9: dispatching a type with no listeners is a no-op (still records).
    it('is a no-op when no listener is registered for the type', () => {
        const sink = installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        expect(() => DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type))).not.toThrow();
        expect(sink.writes.some((w) => w.op === 'dispatchEvent' && w.args[0] === type)).toBe(true);
    });

    // Case 10: removing the last listener stops delivery.
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

    // Case 11: event coordinate/key fields reach the handler.
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

describe('Modelled event delivery — ListenerOptions.button filter', () => {
    afterEach(() => DOM.reset());

    // Regression coverage: a prior implementation of the button filter treated
    // an unset `button` option as "any", silently undoing the documented
    // "primary" default for every bare-handler registration (drag sources,
    // Button's pressed state, …) — right-click could drag a Scrollbar/Slider
    // and press a Button. Every existing test drove handlers directly rather
    // than through `Event.addListener` + real dispatch, so nothing caught it.

    // A literal press-initiating type, not `uniqueType()`: this pins the
    // "primary" default itself, which since the allowlist restructuring only
    // applies to the handful of types in PRIMARY_BUTTON_TYPES — a synthetic
    // type would now default to "any" and defeat the point of the test.
    it('the default (unset) filter fires for a primary press and not for a non-primary one', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = 'pointerdown';

        comp.getElement(true);

        let runs = 0;
        Event.addListener(comp, type, () => { runs += 1; });

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type, { button: 2 }));
        expect(runs).toBe(0);

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type, { button: 0 }));
        expect(runs).toBe(1);
    });

    it('button: "aux" fires only for a non-primary press', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let runs = 0;
        Event.addListener(comp, type, { button: 'aux', handler: () => { runs += 1; } });

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type, { button: 0 }));
        expect(runs).toBe(0);

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type, { button: 2 }));
        expect(runs).toBe(1);
    });

    it('button: "any" fires for both a primary and a non-primary press', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let runs = 0;
        Event.addListener(comp, type, { button: 'any', handler: () => { runs += 1; } });

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type, { button: 0 }));
        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type, { button: 2 }));

        expect(runs).toBe(2);
    });

    // Second regression: `pointermove` (and pointercancel/lostpointercapture)
    // are not button-state-change events per the Pointer Events spec — a real
    // browser fires them with `button: -1` even while a button is held, since
    // `button` only reflects a just-changed button, not the live held state
    // (that's `buttons`, plural). A bare "primary" registration therefore
    // never ran during an actual drag — Slider's pointermove tracking and
    // DiagramView's pan both silently stopped updating after the button
    // filter shipped, degrading a drag into a single click. Every existing
    // drag test drove `_draggingPointer`/pointerId state directly rather than
    // dispatching a real -1-button move, so nothing caught it either.
    // A literal press-initiating type ("pointerup", not already used as a
    // literal elsewhere in this file), for the same reason as the test
    // above: the "primary" default this pins only applies to
    // PRIMARY_BUTTON_TYPES members since the allowlist restructuring.
    it('the default (unset) filter rejects a -1 ("no button state change") event on a press-type it does not belong to', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = 'pointerup';

        comp.getElement(true);

        let runs = 0;
        Event.addListener(comp, type, () => { runs += 1; });

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type, { button: -1 }));
        expect(runs).toBe(0);
    });

    it('button: "any" still fires for a -1 ("no button state change") event', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let runs = 0;
        Event.addListener(comp, type, { button: 'any', handler: () => { runs += 1; } });

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type, { button: -1 }));
        expect(runs).toBe(1);
    });

    // A literal press-initiating type, not `uniqueType()`, for the same
    // reason as the default-filter case above: the "primary" default this
    // pins only applies to PRIMARY_BUTTON_TYPES members. `'mouseup'`, not
    // `'mousedown'`, to avoid the "second test to register a literal type
    // installs nothing against its own fresh sink" trap the comment above
    // the PRIMARY_BUTTON_TYPES describe block explains — `'mousedown'`
    // already has its own dedicated case there.
    it('a re-registration of the same reference re-configures its options', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = 'mouseup';

        comp.getElement(true);

        let runs = 0;
        const f = (): void => { runs += 1; };

        Event.addListener(comp, type, f);
        Event.addListener(comp, type, { button: 'any', handler: f });

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type, { button: 2 }));

        expect(runs).toBe(1);
    });

    it('a re-registration of the same reference does not add a second listener', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let runs = 0;
        const f = (): void => { runs += 1; };

        Event.addListener(comp, type, f);
        Event.addListener(comp, type, f);

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type));

        expect(runs).toBe(1);
    });

    it('distinct references still both register', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let runsA = 0;
        let runsB = 0;
        const a = (): void => { runsA += 1; };
        const b = (): void => { runsB += 1; };

        Event.addListener(comp, type, a);
        Event.addListener(comp, type, b);

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type));

        expect(runsA).toBe(1);
        expect(runsB).toBe(1);
    });
});

// The button-filter tests above all dispatch a `uniqueType()` synthetic
// type, which is never a member of Event.ts's PRIMARY_BUTTON_TYPES allowlist
// — so they cover the "any" fallback but never actually exercise the
// allowlist itself. These dispatch real type strings so the allowlist's
// membership test is driven through the real dispatcher, not just asserted
// by reading the code.
//
// Every literal-type case lives in ONE test per type (not `uniqueType()`-
// able, since the point is the literal type string): `installBaseListener`
// only installs the native window listener on a type's FIRST registration,
// and that installation isn't undone by `DOM.reset()` between tests — a
// second test separately registering the same literal type would install
// nothing against its own fresh sink and silently never see its events
// dispatched.
describe('Modelled event delivery — PRIMARY_BUTTON_TYPES per-type default', () => {
    afterEach(() => DOM.reset());

    it('a bare "contextmenu" registration fires for any button, and an explicit override still narrows it', () => {
        installTestDOM(CONFIG);

        const bare = new Component({});
        bare.getElement(true);

        let bareRuns = 0;
        Event.addListener(bare, 'contextmenu', () => { bareRuns += 1; });

        // Right-click.
        DOM.sink.dispatchEvent(bare.getElement()!, makeEvent(bare.getElement()!, 'contextmenu', { button: 2 }));
        expect(bareRuns).toBe(1);

        // Keyboard-triggered context menu.
        DOM.sink.dispatchEvent(bare.getElement()!, makeEvent(bare.getElement()!, 'contextmenu', { button: 0 }));
        expect(bareRuns).toBe(2);

        // An explicit override on a second component still narrows the
        // per-type default back to primary-only.
        const overridden = new Component({});
        overridden.getElement(true);

        let overriddenRuns = 0;
        Event.addListener(overridden, 'contextmenu', { button: 'primary', handler: () => { overriddenRuns += 1; } });

        DOM.sink.dispatchEvent(overridden.getElement()!, makeEvent(overridden.getElement()!, 'contextmenu', { button: 2 }));
        expect(overriddenRuns).toBe(0);

        DOM.sink.dispatchEvent(overridden.getElement()!, makeEvent(overridden.getElement()!, 'contextmenu', { button: 0 }));
        expect(overriddenRuns).toBe(1);
    });

    it('a bare "pointermove" registration fires despite the spec\'s button: -1', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        comp.getElement(true);

        let runs = 0;
        Event.addListener(comp, 'pointermove', () => { runs += 1; });

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, 'pointermove', { button: -1 }));
        expect(runs).toBe(1);
    });

    it('a type in the allowlist (e.g. "mousedown") still defaults to primary-only', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        comp.getElement(true);

        let runs = 0;
        Event.addListener(comp, 'mousedown', () => { runs += 1; });

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, 'mousedown', { button: 2 }));
        expect(runs).toBe(0);

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, 'mousedown', { button: 0 }));
        expect(runs).toBe(1);
    });

    // Regression case: under the old "default primary, except a short
    // exceptions list gets any" model, a type absent from BOTH the
    // exceptions list AND anyone's memory of updating it defaulted to
    // primary-only — and `auxclick` by definition never carries `button: 0`,
    // so a bare registration on it could never fire at all. The allowlist
    // model makes this the other way around: only types that actually
    // initiate a press default to primary, so a type nobody thought to list
    // is safe by construction.
    it('a bare "auxclick" registration fires for any non-primary button', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        comp.getElement(true);

        let runs = 0;
        Event.addListener(comp, 'auxclick', () => { runs += 1; });

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, 'auxclick', { button: 2 }));
        expect(runs).toBe(1);

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, 'auxclick', { button: 1 }));
        expect(runs).toBe(2);
    });

    it('a bare "mouseover" registration is not primary-filtered', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        comp.getElement(true);

        let runs = 0;
        Event.addListener(comp, 'mouseover', () => { runs += 1; });

        DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, 'mouseover', { button: 2 }));
        expect(runs).toBe(1);
    });
});

describe('Modelled event delivery — polite propagation', () => {
    afterEach(() => DOM.reset());

    // The dispatcher must not stop native propagation on a component's behalf:
    // an event a component handled but did not consume keeps bubbling, so a
    // document-level accelerator still fires while a library component is
    // focused. Counted by swapping the event's native stopPropagation for a spy
    // before dispatch — applyDisposition calls it only when a listener's
    // returned disposition asks for a stop.
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

        Event.addListener(comp, type, () => true);
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

        Event.addViewportListener(comp, type, () => true);
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
        let nativeStops = 0;

        const evt = makeEvent(first.getElement()!, type);
        (evt as unknown as { stopPropagation: () => void }).stopPropagation = () => { nativeStops += 1; };

        Event.addViewportListener(first, type, () => {
            firstRuns += 1;

            return true;
        });
        Event.addViewportListener(second, type, () => { secondRuns += 1; });

        DOM.sink.dispatchEvent(first.getElement()!, evt);

        expect(firstRuns).toBe(1);
        expect(secondRuns).toBe(1);
        expect(nativeStops).toBe(1);
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
        let nativeStops = 0;

        const evt = makeEvent(first.getElement()!, type);
        (evt as unknown as { stopPropagation: () => void }).stopPropagation = () => { nativeStops += 1; };

        Event.addViewportListener(second, type, () => { secondRuns += 1; });
        Event.addViewportListener(first, type, () => {
            firstRuns += 1;

            return true;
        });

        DOM.sink.dispatchEvent(first.getElement()!, evt);

        expect(firstRuns).toBe(1);
        expect(secondRuns).toBe(1);
        expect(nativeStops).toBe(1);
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

// A listener signals what the dispatcher should do with the event by return
// value instead of calling stopPropagation()/preventDefault() through a
// wrapped method. Cases numbered per plans/implemented/listener-return-disposition.md
// `## Expected Behaviour`.
describe('Modelled event delivery — listener return disposition', () => {
    afterEach(() => DOM.reset());

    // Case 1: returning nothing leaves the event alone.
    it('leaves the event alone when the listener returns nothing', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let stops = 0;
        let prevents = 0;
        const evt = makeEvent(comp.getElement()!, type);
        (evt as unknown as { stopPropagation: () => void }).stopPropagation = () => { stops += 1; };
        (evt as unknown as { preventDefault: () => void }).preventDefault = () => { prevents += 1; };

        Event.addListener(comp, type, () => { /* returns nothing */ });
        DOM.sink.dispatchEvent(comp.getElement()!, evt);

        expect(stops).toBe(0);
        expect(prevents).toBe(0);
    });

    // Case 2: `return false` is the same as returning nothing.
    it('leaves the event alone when the listener returns false', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let stops = 0;
        let prevents = 0;
        const evt = makeEvent(comp.getElement()!, type);
        (evt as unknown as { stopPropagation: () => void }).stopPropagation = () => { stops += 1; };
        (evt as unknown as { preventDefault: () => void }).preventDefault = () => { prevents += 1; };

        Event.addListener(comp, type, () => false);
        DOM.sink.dispatchEvent(comp.getElement()!, evt);

        expect(stops).toBe(0);
        expect(prevents).toBe(0);
    });

    // Case 3: `return true` stops propagation only.
    it('stops propagation only when the listener returns true', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let stops = 0;
        let prevents = 0;
        const evt = makeEvent(comp.getElement()!, type);
        (evt as unknown as { stopPropagation: () => void }).stopPropagation = () => { stops += 1; };
        (evt as unknown as { preventDefault: () => void }).preventDefault = () => { prevents += 1; };

        Event.addListener(comp, type, () => true);
        DOM.sink.dispatchEvent(comp.getElement()!, evt);

        expect(stops).toBe(1);
        expect(prevents).toBe(0);
    });

    // Case 4: `return { prevent: true }` prevents the default only, and an
    // ancestor subtree listener still runs (propagation was not stopped).
    it('prevents the default only when the listener returns { prevent: true }, leaving the walk to run', () => {
        installTestDOM(CONFIG);

        const root   = new Component({});
        const target = new Component({});
        const type   = uniqueType();

        root.getElement(true);
        root.addComponent(target);

        let ancestorRuns = 0;
        let stops = 0;
        let prevents = 0;
        const evt = makeEvent(target.getElement()!, type);
        (evt as unknown as { stopPropagation: () => void }).stopPropagation = () => { stops += 1; };
        (evt as unknown as { preventDefault: () => void }).preventDefault = () => { prevents += 1; };

        Event.addSubtreeListener(root, type, () => { ancestorRuns += 1; });
        Event.addListener(target, type, () => ({ prevent: true }));

        DOM.sink.dispatchEvent(target.getElement()!, evt);

        expect(prevents).toBe(1);
        expect(stops).toBe(0);
        expect(ancestorRuns).toBe(1);
    });

    // Case 5: `return { stop: true, prevent: true }` does both.
    it('stops and prevents when the listener returns { stop: true, prevent: true }', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let stops = 0;
        let prevents = 0;
        const evt = makeEvent(comp.getElement()!, type);
        (evt as unknown as { stopPropagation: () => void }).stopPropagation = () => { stops += 1; };
        (evt as unknown as { preventDefault: () => void }).preventDefault = () => { prevents += 1; };

        Event.addListener(comp, type, () => ({ stop: true, prevent: true }));
        DOM.sink.dispatchEvent(comp.getElement()!, evt);

        expect(stops).toBe(1);
        expect(prevents).toBe(1);
    });

    // Case 6: an exact-target consume skips the ancestor walk; a non-consuming
    // exact-target listener lets it run.
    it('skips the ancestor walk only when the exact-target listener returns a stop disposition', () => {
        installTestDOM(CONFIG);

        const root              = new Component({});
        const consumingTarget   = new Component({});
        const passthroughTarget = new Component({});
        const type              = uniqueType();

        root.getElement(true);
        root.addComponent(consumingTarget);
        root.addComponent(passthroughTarget);

        let ancestorRuns = 0;

        Event.addSubtreeListener(root, type, () => { ancestorRuns += 1; });
        Event.addListener(consumingTarget, type, () => true);
        Event.addListener(passthroughTarget, type, () => { /* returns nothing */ });

        DOM.sink.dispatchEvent(consumingTarget.getElement()!, makeEvent(consumingTarget.getElement()!, type));

        expect(ancestorRuns).toBe(0);

        DOM.sink.dispatchEvent(passthroughTarget.getElement()!, makeEvent(passthroughTarget.getElement()!, type));

        expect(ancestorRuns).toBe(1);
    });

    // Case 7 (new behaviour — fails before this change): a consuming subtree
    // listener ends the walk at its own component. Three nested components
    // each have a subtree listener; the middle one returns true.
    it('lets a consuming subtree listener end the walk at its own component', () => {
        installTestDOM(CONFIG);

        const outer  = new Component({});
        const middle = new Component({});
        const inner  = new Component({});
        const type   = uniqueType();

        outer.getElement(true);
        outer.addComponent(middle);
        middle.addComponent(inner);

        let outerRuns  = 0;
        let middleRuns = 0;
        let innerRuns  = 0;

        Event.addSubtreeListener(outer,  type, () => { outerRuns += 1; });
        Event.addSubtreeListener(middle, type, () => { middleRuns += 1; return true; });
        Event.addSubtreeListener(inner,  type, () => { innerRuns += 1; });

        DOM.sink.dispatchEvent(inner.getElement()!, makeEvent(inner.getElement()!, type));

        expect(innerRuns).toBe(1);
        expect(middleRuns).toBe(1);
        expect(outerRuns).toBe(0);
    });

    // Case 8: every listener registered on the consuming component still
    // runs — only ancestors above it are skipped.
    it('runs every listener on the consuming component before skipping ancestors', () => {
        installTestDOM(CONFIG);

        const root   = new Component({});
        const target = new Component({});
        const type   = uniqueType();

        root.getElement(true);
        root.addComponent(target);

        let firstRuns  = 0;
        let secondRuns = 0;
        let ancestorRuns = 0;

        Event.addSubtreeListener(root, type, () => { ancestorRuns += 1; });
        Event.addSubtreeListener(target, type, () => { firstRuns += 1; return true; });
        Event.addSubtreeListener(target, type, () => { secondRuns += 1; });

        DOM.sink.dispatchEvent(target.getElement()!, makeEvent(target.getElement()!, type));

        expect(firstRuns).toBe(1);
        expect(secondRuns).toBe(1);
        expect(ancestorRuns).toBe(0);
    });

    // Case 10: a direct e.stopPropagation() call no longer reaches the
    // dispatcher — only a returned disposition does. This is the deliberate
    // behaviour change; pin it so it cannot regress silently.
    it('does not skip the ancestor walk when the listener calls e.stopPropagation() directly and returns nothing', () => {
        installTestDOM(CONFIG);

        const root   = new Component({});
        const target = new Component({});
        const type   = uniqueType();

        root.getElement(true);
        root.addComponent(target);

        let ancestorRuns = 0;

        Event.addSubtreeListener(root, type, () => { ancestorRuns += 1; });
        Event.addListener(target, type, (e: globalThis.Event) => { e.stopPropagation(); });

        DOM.sink.dispatchEvent(target.getElement()!, makeEvent(target.getElement()!, type));

        expect(ancestorRuns).toBe(1);
    });
});

// ListenerOptions.stop/prevent is a registration-time floor, OR'd with the
// listener's own returned disposition — a separate mechanism from the return
// value tested above. Driven through the real dispatcher the same way.
describe('Modelled event delivery — ListenerOptions.stop/prevent floor', () => {
    afterEach(() => DOM.reset());

    it('prevents the default when the registration sets prevent: true, even though the listener returns nothing', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let prevents = 0;
        const evt = makeEvent(comp.getElement()!, type);
        (evt as unknown as { preventDefault: () => void }).preventDefault = () => { prevents += 1; };

        Event.addListener(comp, type, { prevent: true, handler: () => { /* returns nothing */ } });
        DOM.sink.dispatchEvent(comp.getElement()!, evt);

        expect(prevents).toBe(1);
    });

    it('stops propagation and skips the ancestor walk when the registration sets stop: true, even though the listener returns nothing', () => {
        installTestDOM(CONFIG);

        const root   = new Component({});
        const target = new Component({});
        const type   = uniqueType();

        root.getElement(true);
        root.addComponent(target);

        let stops = 0;
        let ancestorRuns = 0;
        const evt = makeEvent(target.getElement()!, type);
        (evt as unknown as { stopPropagation: () => void }).stopPropagation = () => { stops += 1; };

        Event.addSubtreeListener(root, type, () => { ancestorRuns += 1; });
        Event.addListener(target, type, { stop: true, handler: () => { /* returns nothing */ } });

        DOM.sink.dispatchEvent(target.getElement()!, evt);

        expect(stops).toBe(1);
        expect(ancestorRuns).toBe(0);
    });

    it('is a floor, not an override — the listener returning false does not suppress it', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let prevents = 0;
        const evt = makeEvent(comp.getElement()!, type);
        (evt as unknown as { preventDefault: () => void }).preventDefault = () => { prevents += 1; };

        Event.addListener(comp, type, { prevent: true, handler: () => false });
        DOM.sink.dispatchEvent(comp.getElement()!, evt);

        expect(prevents).toBe(1);
    });

    it('OR-composes with the listener\'s own returned disposition rather than replacing it', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let stops = 0;
        let prevents = 0;
        const evt = makeEvent(comp.getElement()!, type);
        (evt as unknown as { stopPropagation: () => void }).stopPropagation = () => { stops += 1; };
        (evt as unknown as { preventDefault: () => void }).preventDefault = () => { prevents += 1; };

        // The registration floor only asks for `prevent`; the listener's own
        // return value is what asks for `stop` — both must take effect.
        Event.addListener(comp, type, { prevent: true, handler: () => true });
        DOM.sink.dispatchEvent(comp.getElement()!, evt);

        expect(stops).toBe(1);
        expect(prevents).toBe(1);
    });

    it('does not apply when the button filter rejects the press before the listener runs', () => {
        installTestDOM(CONFIG);

        const comp = new Component({});
        const type = uniqueType();

        comp.getElement(true);

        let prevents = 0;
        let runs = 0;
        const evt = makeEvent(comp.getElement()!, type, { button: 2 });
        (evt as unknown as { preventDefault: () => void }).preventDefault = () => { prevents += 1; };

        // A synthetic type is not in PRIMARY_BUTTON_TYPES, so it defaults to
        // "any" — an explicit "primary" override is what makes this button:2
        // event rejected, exercising the interaction under test.
        Event.addListener(comp, type, { button: 'primary', prevent: true, handler: () => { runs += 1; } });
        DOM.sink.dispatchEvent(comp.getElement()!, evt);

        expect(runs).toBe(0);
        expect(prevents).toBe(0);
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
