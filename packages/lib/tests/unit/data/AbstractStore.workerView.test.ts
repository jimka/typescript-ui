// Offline coverage for the worker-offloaded view path of loadData. Above
// WORKER_THRESHOLD the store sorts/filters on a Web Worker, so `_records` is
// populated only when the worker resolves. loadData must defer its 'load' emit
// until then — otherwise a listener (a Table) renders the still-empty view and
// never re-renders, because nothing re-emits when the worker lands. The worker
// is unavailable in the node harness, so it is stubbed here to force the path.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { StoreWorkerClient } from '~/data/StoreWorkerClient';

const MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id');

/** A flush that drains microtasks and one macrotask turn. */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

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
