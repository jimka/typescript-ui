// Registry test enforcing that disposing a component that subscribed to a
// caller-owned `AbstractStore` unsubscribes every listener it registered.
// Mirrors tests/component/dispose-listener-teardown.test.ts's registry shape,
// but for `store.on()` / `ListenerBag` subscriptions rather than the `Event`
// API: the store is owned by the caller, not the component, so it can
// outlive the component — an un-unsubscribed listener pins the disposed
// component in the store's own `ListenerBag` for as long as the store lives.
//
// Asserts directly on the store's own `ListenerBag` buckets (via a private-
// field cast, matching the `(Tooltip as any).attachments` pattern used
// elsewhere) rather than the global semantic-listener diagnostic counter:
// that counter also carries every OTHER `ListenerBag` a subtree owns for its
// own emitted events (`Table`'s `TableEvent`, `TableHeader`'s own events,
// …), which is a separate, broader cleanup this file does not cover.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Model } from '~/data/Model';
import { MemoryStore } from '~/data/MemoryStore';
import { Table } from '~/component/table/Table';
import { TablePanel } from '~/component/table/TablePanel';
import { List } from '~/component/list/List';
import { ComboBox } from '~/component/input/ComboBox';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

const MODEL = new Model([
    { name: 'id',   type: 'number' },
    { name: 'name', type: 'string' },
], 'id');

function buildStore(): MemoryStore {
    return new MemoryStore(MODEL, [{ id: 1, name: 'A' }, { id: 2, name: 'B' }]);
}

/** Total listeners left registered across every event bucket on `store`. */
function totalListeners(store: MemoryStore): number {
    const buckets = (store as unknown as { _listeners: { get(e: string): Function[] } });
    const events = ['load', 'add', 'remove', 'datachange', 'update', 'beforesync', 'sync', 'loadingchange'];

    return events.reduce((sum, e) => sum + buckets._listeners.get(e).length, 0);
}

describe('dispose-store-subscription-teardown registry: every dispose() unsubscribes its store listeners', () => {
    it('Table (covers TableBody)', () => {
        const store = buildStore();
        const table = new Table(store);

        expect(totalListeners(store)).toBeGreaterThan(0);

        table.dispose();

        expect(totalListeners(store)).toBe(0);
    });

    it('TablePanel', () => {
        const store = buildStore();
        const panel = new TablePanel(store);

        expect(totalListeners(store)).toBeGreaterThan(0);

        panel.dispose();

        expect(totalListeners(store)).toBe(0);
    });

    it('AbstractSelectableList (via List)', () => {
        const store = buildStore();
        const list = new List();

        list.setStore(store, 'name');

        expect(totalListeners(store)).toBeGreaterThan(0);

        list.dispose();

        expect(totalListeners(store)).toBe(0);
    });

    it('ComboBox (covers its internal List)', () => {
        const store = buildStore();
        const combo = new ComboBox();

        combo.setStore(store, 'name');

        expect(totalListeners(store)).toBeGreaterThan(0);

        combo.dispose();

        expect(totalListeners(store)).toBe(0);
    });
});
