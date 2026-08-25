// Pure node-env suite. ListenerBag.add is documented append-only (no dedupe);
// the project has a prior bug where re-running wiring stacked duplicate
// listeners, so pinning the exact add/remove/fire/get semantics guards a future
// dedupe or re-wire regression.
import { describe, it, expect } from 'vitest';
import { ListenerBag } from '~/core/ListenerBag';
import { Diagnostics } from '~/core/Diagnostics';

type E = 'a' | 'b';

describe('ListenerBag.add', () => {
    it('appends — registering the SAME function twice yields length 2', () => {
        // Documented append-only behaviour. The duplicate-stacking hazard this
        // implies for callers is the prior-bug class; pinned as the contract.
        const bag = new ListenerBag<E>();
        const fn = (): void => {};

        bag.add('a', fn);
        bag.add('a', fn);

        expect(bag.get('a').length).toBe(2);
    });
});

describe('ListenerBag.fire', () => {
    it('invokes every listener in registration order with the forwarded payload', () => {
        const bag = new ListenerBag<E>();
        const order: string[] = [];
        const seen: unknown[][] = [];

        bag.add('a', (...args: unknown[]) => { order.push('first'); seen.push(args); });
        bag.add('a', (...args: unknown[]) => { order.push('second'); seen.push(args); });

        bag.fire('a', 1, 'x');

        expect(order).toEqual(['first', 'second']);
        expect(seen).toEqual([[1, 'x'], [1, 'x']]);
    });

    it('is a silent no-op for an event with no bucket', () => {
        const bag = new ListenerBag<E>();

        expect(() => bag.fire('b')).not.toThrow();
    });
});

describe('ListenerBag.remove', () => {
    it('removes only the first occurrence of a reference; the survivor still fires', () => {
        const bag = new ListenerBag<E>();
        let calls = 0;
        const fn = (): void => { calls += 1; };

        bag.add('a', fn);
        bag.add('a', fn);
        bag.remove('a', fn);

        expect(bag.get('a').length).toBe(1);

        bag.fire('a');

        expect(calls).toBe(1);
    });

    it('is a no-op for an unregistered fn or unknown event', () => {
        const bag = new ListenerBag<E>();

        expect(() => bag.remove('a', () => {})).not.toThrow();
        expect(() => bag.remove('b', () => {})).not.toThrow();
    });
});

describe('ListenerBag.get', () => {
    it('returns a defensive copy — mutating it does not affect the bag', () => {
        const bag = new ListenerBag<E>();

        bag.add('a', () => {});

        const snapshot = bag.get('a');
        snapshot.push(() => {});

        expect(bag.get('a').length).toBe(1);
    });

    it('snapshot is unaffected by add/remove during a caller iteration', () => {
        const bag = new ListenerBag<E>();
        const fn = (): void => {};

        bag.add('a', fn);

        const snapshot = bag.get('a');

        bag.add('a', () => {});
        bag.remove('a', fn);

        expect(snapshot.length).toBe(1);
        expect(snapshot[0]).toBe(fn);
    });

    it('returns a fresh empty array for an unregistered event', () => {
        const bag = new ListenerBag<E>();

        const first = bag.get('b');
        const second = bag.get('b');

        expect(first).toEqual([]);
        expect(first).not.toBe(second); // not a shared singleton
    });

    // There is no `once` method on ListenerBag; "once" semantics belong to
    // host-level wrappers, not this class. Its absence is by design, not a gap.
});

describe('ListenerBag.clear', () => {
    it('empties every bucket, so a subsequent fire is a no-op', () => {
        const bag = new ListenerBag<E>();
        let calls = 0;

        bag.add('a', () => { calls += 1; });
        bag.add('b', () => { calls += 1; });

        bag.clear();

        expect(bag.get('a')).toEqual([]);
        expect(bag.get('b')).toEqual([]);

        bag.fire('a');
        bag.fire('b');

        expect(calls).toBe(0);
    });

    it('balances the diagnostics counter for every listener it removes', () => {
        Diagnostics._reset();

        const bag = new ListenerBag<E>();

        bag.add('a', () => {});
        bag.add('a', () => {});
        bag.add('b', () => {});

        expect(Diagnostics.counters().bagListenersAdded - Diagnostics.counters().bagListenersRemoved).toBe(3);

        bag.clear();

        expect(Diagnostics.counters().bagListenersAdded - Diagnostics.counters().bagListenersRemoved).toBe(0);
    });

    it('is a harmless no-op on an already-empty bag', () => {
        const bag = new ListenerBag<E>();

        expect(() => bag.clear()).not.toThrow();
        expect(() => bag.clear()).not.toThrow();
    });
});
