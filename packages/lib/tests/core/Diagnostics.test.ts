// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for the pushed diagnostics counters (`core/Diagnostics.ts`) and the
// framework seams that push into them — `Component` construction/destruction/
// doLayout, `ListenerBag.add`/`remove`. Cases are numbered to match
// `plans/implemented/debug-diagnostics-overlay.md`'s `## Expected Behaviour`
// "Counters — unit-testable" list (1-9).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Diagnostics } from '~/core/Diagnostics';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { ListenerBag } from '~/core/ListenerBag';
import { DOM } from '~/core/DOM';
import { Table } from '~/component/table/Table';
import { Model } from '~/data/Model';
import { MemoryStore } from '~/data/MemoryStore';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => {
    installTestDOM(CONFIG);
    Diagnostics._reset();
});
afterEach(() => DOM.reset());

describe('Diagnostics — Component construction/destruction', () => {
    it('1. construction counts once per Component', () => {
        new Component({});
        new Component({});
        new Component({});

        const counters = Diagnostics.counters();

        expect(counters.componentsConstructed).toBe(3);
        expect(counters.componentsDestroyed).toBe(0);
    });

    it('2. disposal counts once, even when repeated', () => {
        const c = new Component({});

        c.dispose();
        c.dispose();

        expect(Diagnostics.counters().componentsDestroyed).toBe(1);
    });

    it('3. recursive disposal counts the whole subtree', () => {
        const parent = new Container();
        const childA = new Component({});
        const childB = new Component({});

        parent.addComponent(childA);
        parent.addComponent(childB);

        parent.dispose();

        expect(Diagnostics.counters().componentsDestroyed).toBe(3);
    });

    it('4. a never-disposed component is not deducted', () => {
        new Component({});

        const counters = Diagnostics.counters();

        expect(counters.componentsConstructed - counters.componentsDestroyed).toBe(1);
    });

    it('10. a Table construct/dispose cycle leaves construct/destroy balanced', () => {
        // Returns this call's own contribution to the outstanding
        // (constructed - destroyed) balance, i.e. the delta since the
        // previous reading -- not the absolute cumulative balance, which
        // would stay permanently offset by the Tooltip warm-up cost below
        // once it's paid (that cost never reverses, since the singleton is
        // never disposed).
        let previousBalance = 0;
        const buildAndDisposeDelta = (): number => {
            const store = new MemoryStore(new Model([{ name: 'a', type: 'string', order: 0 }], 'a'), []);
            const table = new Table(store);

            table.getElement(true);
            table.setWidth(600);
            table.setHeight(400);
            table.doLayout();
            table.dispose();

            const counters = Diagnostics.counters();
            const balance  = counters.componentsConstructed - counters.componentsDestroyed;
            const delta    = balance - previousBalance;

            previousBalance = balance;

            return delta;
        };

        // Warm-up: the first Button ever disposed in this suite lazily
        // constructs the shared Tooltip singleton (the header's menu button's
        // destructor calls Tooltip.detach() -> Tooltip.hide() ->
        // Tooltip.getInstance(), even though the tooltip was never shown).
        // That singleton is process-global and correctly never torn down by
        // any one dispose() -- mirrors dispose-full-teardown.test.ts's own
        // warm-up comment for this exact shared-state pattern -- so run one
        // untested cycle first and track the balance from there, keeping
        // that one-time cost out of the asserted per-cycle deltas below.
        buildAndDisposeDelta();

        expect(buildAndDisposeDelta()).toBe(0);
        expect(buildAndDisposeDelta()).toBe(0);
    });
});

describe('Diagnostics — ListenerBag add/remove', () => {
    it('5. bag counters track add/remove', () => {
        const bag = new ListenerBag<'a'>();
        const fn  = (): void => {};

        bag.add('a', fn);
        bag.add('a', fn);
        bag.remove('a', fn);

        const counters = Diagnostics.counters();

        expect(counters.bagListenersAdded).toBe(2);
        expect(counters.bagListenersRemoved).toBe(1);
    });

    it('6. a remove for a listener that was never registered counts nothing', () => {
        const bag = new ListenerBag<'a'>();

        bag.remove('a', () => {});

        expect(Diagnostics.counters().bagListenersRemoved).toBe(0);
    });
});

describe('Diagnostics — setTimingEnabled', () => {
    it('7. enabling zeroes the flush aggregates, disabling does not', () => {
        Diagnostics.noteLayoutFlush(4);

        Diagnostics.setTimingEnabled(false);
        expect(Diagnostics.counters().layoutFlushes).toBe(1);
        expect(Diagnostics.counters().layoutFlushTotalMs).toBe(4);

        Diagnostics.setTimingEnabled(true);
        expect(Diagnostics.counters().layoutFlushes).toBe(0);
        expect(Diagnostics.counters().layoutFlushTotalMs).toBe(0);
    });

    it('7b. neither call touches any other counter', () => {
        new Component({});

        const bag = new ListenerBag<'a'>();
        const fn  = (): void => {};
        bag.add('a', fn);

        const before = Diagnostics.counters();

        Diagnostics.setTimingEnabled(true);
        Diagnostics.setTimingEnabled(false);

        const after = Diagnostics.counters();

        expect(after.componentsConstructed).toBe(before.componentsConstructed);
        expect(after.componentsDestroyed).toBe(before.componentsDestroyed);
        expect(after.bagListenersAdded).toBe(before.bagListenersAdded);
        expect(after.bagListenersRemoved).toBe(before.bagListenersRemoved);
        expect(after.layoutPasses).toBe(before.layoutPasses);
    });
});

describe('Diagnostics.noteLayoutFlush', () => {
    it('8. accumulates the total and tracks the maximum', () => {
        Diagnostics.noteLayoutFlush(2);
        Diagnostics.noteLayoutFlush(5);
        Diagnostics.noteLayoutFlush(3);

        const counters = Diagnostics.counters();

        expect(counters.layoutFlushes).toBe(3);
        expect(counters.layoutFlushTotalMs).toBe(10);
        expect(counters.layoutFlushMaxMs).toBe(5);
    });
});

describe('Diagnostics — Component.doLayout', () => {
    it('9. layoutPasses rises with a real layout pass and not while paused', () => {
        const c = new Component({});

        c.doLayout();
        expect(Diagnostics.counters().layoutPasses).toBe(1);

        c.pauseLayout();
        c.doLayout();
        expect(Diagnostics.counters().layoutPasses).toBe(1);
    });
});
