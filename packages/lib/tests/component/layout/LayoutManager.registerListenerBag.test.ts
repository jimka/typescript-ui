// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * `LayoutManager.registerListenerBag` — the `LayoutManager` counterpart of
 * `Component.registerListenerBag` / `onDestroy`. A manager subclass (`Tab`,
 * `Split`, `Accordion`) owns a `ListenerBag` but is not a `Component`, so it
 * has no `onDestroy` to hook into; `detach()` is its own equivalent teardown
 * point. Exercised on `HBox`, the simplest concrete `LayoutManager`, via a
 * cast to reach the protected method — mirrors the `(c as any)._field`
 * pattern used elsewhere for protected/private test access.
 */
import { describe, it, expect } from 'vitest';
import { HBox } from '~/layout/HBox';
import { ListenerBag } from '~/core/ListenerBag';

type Registrar = { registerListenerBag<T extends string>(bag: ListenerBag<T>): ListenerBag<T> };

describe('LayoutManager.registerListenerBag', () => {
    it('clears the bag when the manager is detached', () => {
        const hbox = new HBox();
        const bag = new ListenerBag<'a'>();
        let calls = 0;

        (hbox as unknown as Registrar).registerListenerBag(bag);
        bag.add('a', () => { calls += 1; });

        hbox.detach();

        bag.fire('a');
        expect(calls).toBe(0);
        expect(bag.get('a')).toEqual([]);
    });

    it('runs the cleanup only once across repeated detach() calls', () => {
        const hbox = new HBox();
        const bag = new ListenerBag<'a'>();

        (hbox as unknown as Registrar).registerListenerBag(bag);
        bag.add('a', () => {});

        hbox.detach();

        expect(() => hbox.detach()).not.toThrow();
    });
});
