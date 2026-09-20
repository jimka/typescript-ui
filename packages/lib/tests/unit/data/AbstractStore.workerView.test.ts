// Offline coverage for the worker-offloaded view path of loadData. Above
// WORKER_THRESHOLD the store sorts/filters on a Web Worker, so `_records` is
// populated only when the worker resolves. loadData must defer its 'load' emit
// until then — otherwise a listener (a Table) renders the still-empty view and
// never re-renders, because nothing re-emits when the worker lands. The worker
// is unavailable in the node harness, so it is stubbed here to force the path.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { StoreWorkerClient } from '~/data/StoreWorkerClient';

const MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id');
const GROUPED_MODEL = new Model([{ name: 'id' }, { name: 'group' }, { name: 'name' }], 'id');

/** A flush that drains microtasks and one macrotask turn. */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

/** Over WORKER_THRESHOLD (1,000), so every store below takes the worker path. */
const COUNT = 1200;

function rows(n: number): Array<{ id: number; name: string }> {
    return Array.from({ length: n }, (_, i) => ({ id: i, name: `n${i}` }));
}

describe('AbstractStore — loadData waits for the worker-built view', () => {
    afterEach(() => vi.restoreAllMocks());

    it('defers "load" until the worker view is ready (>= threshold)', async () => {
        // Force the worker path with a controllable sortFilter.
        let resolveWorker: ((idx: number[]) => void) | null = null;
        vi.spyOn(StoreWorkerClient, 'isAvailable').mockReturnValue(true);
        vi.spyOn(StoreWorkerClient, 'snapshot').mockResolvedValue(undefined);
        vi.spyOn(StoreWorkerClient, 'sortFilter').mockImplementation(
            () => new Promise<number[]>(res => { resolveWorker = res; }),
        );

        const store = new MemoryStore(MODEL, []);
        const N = 1200; // >= WORKER_THRESHOLD (1000)

        let loadedCount = -1;
        store.on('load', () => { loadedCount = store.getRecords().length; });

        store.loadData(rows(N));

        // Let the snapshot round-trip resolve so sortFilter is invoked, then hold.
        await flush();

        // Worker still pending: the view is empty and 'load' has NOT fired.
        expect(resolveWorker).not.toBeNull();
        expect(store.getRecords().length).toBe(0);
        expect(loadedCount).toBe(-1);

        // Worker resolves with the full index list → view populated, 'load' fires.
        resolveWorker!(Array.from({ length: N }, (_, i) => i));
        await flush();

        expect(store.getRecords().length).toBe(N);
        // The listener observed the ready view (N rows), never the empty one.
        expect(loadedCount).toBe(N);
    });

    it('emits "load" synchronously below the worker threshold', () => {
        // Even with a worker "available", a sub-threshold dataset stays in-process.
        vi.spyOn(StoreWorkerClient, 'isAvailable').mockReturnValue(true);

        const store = new MemoryStore(MODEL, []);

        let count = -1;
        store.on('load', () => { count = store.getRecords().length; });

        store.loadData(rows(5));

        expect(count).toBe(5);
    });
});

/** What a rejected offload carries; the store's own message names the store and quotes it. */
const OFFLOAD_FAILED = 'the worker is gone';

/**
 * Records whose insertion order is the reverse of their name order inside each
 * group, so a group-only sort — all the worker protocol can express — leaves a
 * different order than a group-then-name sort.
 */
function groupedRows(n: number): Array<{ id: number; group: string; name: string }> {
    return Array.from({ length: n }, (_, i) => ({
        id: i,
        group: i % 2 === 0 ? 'a' : 'b',
        name: `n${String(n - i).padStart(4, '0')}`,
    }));
}

describe('AbstractStore — the view is built in process when the offload fails', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => vi.restoreAllMocks());

    /** Forces the worker path with a landing snapshot and a sortFilter that rejects. */
    function offloadFailingAtSortFilter(): void {
        vi.spyOn(StoreWorkerClient, 'isAvailable').mockReturnValue(true);
        vi.spyOn(StoreWorkerClient, 'snapshot').mockResolvedValue(undefined);
        vi.spyOn(StoreWorkerClient, 'sortFilter').mockRejectedValue(new Error(OFFLOAD_FAILED));
    }

    it('builds the full view and fires "load" once when sortFilter rejects', async () => {
        offloadFailingAtSortFilter();

        const store = new MemoryStore(MODEL, []);
        const loaded: number[] = [];

        store.on('load', () => loaded.push(store.getRecords().length));

        store.loadData(rows(COUNT));
        await flush();

        expect(store.getRecords()).toHaveLength(COUNT);
        // The listener saw the finished view, not an empty one, and saw it once.
        expect(loaded).toEqual([COUNT]);
    });

    it('builds the full view and fires "load" once when the snapshot rejects', async () => {
        vi.spyOn(StoreWorkerClient, 'isAvailable').mockReturnValue(true);
        vi.spyOn(StoreWorkerClient, 'snapshot').mockRejectedValue(new Error(OFFLOAD_FAILED));

        const sortFilter = vi.spyOn(StoreWorkerClient, 'sortFilter');
        const store = new MemoryStore(MODEL, []);
        const loaded: number[] = [];

        store.on('load', () => loaded.push(store.getRecords().length));

        store.loadData(rows(COUNT));
        await flush();

        expect(store.getRecords()).toHaveLength(COUNT);
        expect(loaded).toEqual([COUNT]);
        // A snapshot that never landed leaves nothing to sort against.
        expect(sortFilter).not.toHaveBeenCalled();
    });

    it('applies every sorter in the fallback, not just the primary one', async () => {
        offloadFailingAtSortFilter();

        const store = new MemoryStore(GROUPED_MODEL, []);

        store.loadData(groupedRows(COUNT));
        await flush();

        await store.sort([{ field: 'group', dir: 'asc' }, { field: 'name', dir: 'asc' }]);

        const view = store.getRecords();

        expect(view).toHaveLength(COUNT);
        // Group 'a' first, and inside it ascending by name. A primary-only sort
        // would have kept each group's insertion order, which is descending by
        // name, and so would have put 'n1200' first.
        expect(view[0].get('group')).toBe('a');
        expect(view[0].get('name')).toBe('n0002');
        expect(view[COUNT / 2 - 1].get('name')).toBe('n1200');
        expect(view[COUNT / 2].get('group')).toBe('b');
    });

    it('resolves sort() and fires both its events when sortFilter rejects', async () => {
        offloadFailingAtSortFilter();

        const store = new MemoryStore(MODEL, []);

        store.loadData(rows(COUNT));
        await flush();

        const events: string[] = [];

        store.on('sortchange', () => events.push('sortchange'));
        store.on('datachange', () => events.push('datachange'));

        await store.sort('id', 'desc');

        expect(events).toEqual(['sortchange', 'datachange']);
        expect(store.getRecords()[0].get('id')).toBe(COUNT - 1);
        expect(store.getRecords()[COUNT - 1].get('id')).toBe(0);
    });

    it('resolves load() and leaves the store idle when sortFilter rejects', async () => {
        offloadFailingAtSortFilter();

        const store = new MemoryStore(MODEL, rows(COUNT));
        const loaded: number[] = [];

        store.on('load', () => loaded.push(store.getRecords().length));

        await store.load();

        expect(loaded).toEqual([COUNT]);
        expect(store.getRecords()).toHaveLength(COUNT);
        expect(store.isLoading()).toBe(false);
    });

    it('warns once per store however often its offload fails', async () => {
        offloadFailingAtSortFilter();

        const store = new MemoryStore(MODEL, []);

        store.loadData(rows(COUNT));
        await flush();

        await store.sort('id', 'desc');

        expect(warn).toHaveBeenCalledTimes(1);
    });
});

// The worker holds one snapshot per store, re-shipped only when the store's
// records have changed since the last one landed. Getting that wrong is
// invisible in the view until the worker sorts records it was never given, so
// the dispatch count is asserted directly.
describe('AbstractStore — when the worker snapshot is re-shipped', () => {
    afterEach(() => vi.restoreAllMocks());

    /** A comparator the worker cannot run, which forces `applyView` in process. */
    function compareById(a: { get(field: string): any }, b: { get(field: string): any }): number {
        return (a.get('id') as number) - (b.get('id') as number);
    }

    it('re-ships after a snapshot that failed to reach the worker', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(StoreWorkerClient, 'isAvailable').mockReturnValue(true);
        vi.spyOn(StoreWorkerClient, 'sortFilter').mockResolvedValue(Array.from({ length: COUNT }, (_, i) => i));

        const snapshot = vi.spyOn(StoreWorkerClient, 'snapshot')
            .mockRejectedValueOnce(new Error(OFFLOAD_FAILED))
            .mockResolvedValue(undefined);

        const store = new MemoryStore(MODEL, []);

        store.loadData(rows(COUNT));
        await flush();

        // The worker never received that snapshot, so the next offload must
        // ship it again rather than sorting against data it does not hold.
        await store.sort('id', 'desc');

        expect(snapshot).toHaveBeenCalledTimes(2);
    });

    it('ships one snapshot for two offloads of the same records', async () => {
        vi.spyOn(StoreWorkerClient, 'isAvailable').mockReturnValue(true);
        vi.spyOn(StoreWorkerClient, 'sortFilter').mockImplementation(() => new Promise<number[]>(() => undefined));

        const snapshot = vi.spyOn(StoreWorkerClient, 'snapshot').mockResolvedValue(undefined);
        const store = new MemoryStore(MODEL, []);

        store.loadData(rows(COUNT));

        // A second offload while the first snapshot is still in flight has
        // nothing new to ship: a full dataset crosses the boundary once.
        void store.sort('id', 'desc');

        await flush();

        expect(snapshot).toHaveBeenCalledTimes(1);
    });

    it('re-ships when the records changed while a snapshot was in flight', async () => {
        vi.spyOn(StoreWorkerClient, 'isAvailable').mockReturnValue(true);
        vi.spyOn(StoreWorkerClient, 'sortFilter').mockImplementation(() => new Promise<number[]>(() => undefined));

        let landSnapshot: (() => void) | undefined;

        const snapshot = vi.spyOn(StoreWorkerClient, 'snapshot')
            .mockImplementation(() => new Promise<void>(resolve => { landSnapshot = resolve; }));

        const store = new MemoryStore(MODEL, []);

        store.loadData(rows(COUNT));

        expect(snapshot).toHaveBeenCalledTimes(1);

        // A custom sorter keeps the next two applyView calls in process, so the
        // added record ships no snapshot of its own.
        await store.sort([{ field: 'id', dir: 'asc', sorterFn: compareById }]);
        store.add({ id: COUNT, name: `n${COUNT}` });

        // Only now does the first snapshot — taken before the add — land.
        landSnapshot?.();
        await flush();

        void store.clearSort();
        await flush();

        // The worker's copy predates the add, so the record it has never seen
        // has to be shipped before it sorts again.
        expect(snapshot).toHaveBeenCalledTimes(2);
    });
});
