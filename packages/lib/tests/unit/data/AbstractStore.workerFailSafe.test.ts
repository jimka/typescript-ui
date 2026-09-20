// The reported bug, end to end: a store of 1,000 records or more whose worker
// never answers left its view empty and its 'load' event unfired for the life
// of the page. Nothing is spied here — a real MemoryStore runs over the real
// StoreWorkerClient, and the only fake is the global `Worker`, which records
// what it is posted and answers nothing. That is the shape of the measured
// failure: the request for the worker script was answered with the page's own
// HTML, so the worker booted into nothing and no reply ever came.
//
// AbstractStore imports StoreWorkerClient as a module singleton, so the global
// must be stubbed BEFORE vi.resetModules() and the store imported dynamically
// afterwards, or the two halves see different module graphs. That is also why
// this case cannot share a file with the spy-based store tests.
import { describe, it, expect, vi, afterEach } from 'vitest';

/** Over WORKER_THRESHOLD (1,000), so `applyView` takes the worker path. */
const RECORD_COUNT = 1200;

/** Mirrors `WORKER_PROBE_TIMEOUT_MS` in StoreWorkerClient — the client's own cap on an unanswered first request. */
const PROBE_TIMEOUT_MS = 5000;

/** A Worker that accepts every request and answers none of them. */
class SilentWorker {
    public static posted: any[] = [];
    public static terminated: number = 0;
    public onmessage: ((e: MessageEvent<any>) => void) | null = null;
    public onerror: ((e: any) => void) | null = null;
    public onmessageerror: ((e: any) => void) | null = null;

    postMessage(message: any): void {
        SilentWorker.posted.push(message);
    }

    terminate(): void {
        SilentWorker.terminated++;
    }
}

function rows(n: number): Array<{ id: number; name: string }> {
    return Array.from({ length: n }, (_, i) => ({ id: i, name: `n${i}` }));
}

describe('AbstractStore — the store builds its view when the worker never answers', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('fills the view and fires "load" once after the probe expires', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.useFakeTimers();

        SilentWorker.posted = [];
        SilentWorker.terminated = 0;
        vi.stubGlobal('Worker', SilentWorker);

        // Reset AFTER stubbing so the store and the client share one fresh
        // module graph that sees the silent worker.
        vi.resetModules();

        const { MemoryStore } = await import('~/data/MemoryStore');
        const { Model } = await import('~/data/Model');

        const store = new MemoryStore(new Model([{ name: 'id' }, { name: 'name' }], 'id'), []);
        const loaded: number[] = [];

        store.on('load', () => loaded.push(store.getRecords().length));

        store.loadData(rows(RECORD_COUNT));

        // The offload happened — the snapshot went out — and nothing came back.
        expect(SilentWorker.posted).toHaveLength(1);
        expect(store.getRecords()).toHaveLength(0);
        expect(loaded).toEqual([]);

        await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);

        expect(store.getRecords()).toHaveLength(RECORD_COUNT);
        expect(loaded).toEqual([RECORD_COUNT]);
        expect(SilentWorker.terminated).toBe(1);
    });
});
