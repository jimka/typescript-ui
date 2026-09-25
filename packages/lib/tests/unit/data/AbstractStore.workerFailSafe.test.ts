// The reported bug, end to end: a store of 1,000 records or more whose worker
// never answers left its view empty and its 'load' event unfired for the life
// of the page. Nothing is spied here — a real MemoryStore runs over the real
// StoreWorkerClient, and the only fake is the global `Worker`, which records
// what it is posted and answers only what a test answers for it. That is the
// shape of the measured failure: the request for the worker script was answered
// with the page's own HTML, so the worker booted into nothing and no reply ever
// came. A worker that answers the snapshot and then goes quiet hangs the store
// in exactly the same way, and is this file's second case.
//
// AbstractStore imports StoreWorkerClient as a module singleton, so the global
// must be stubbed BEFORE vi.resetModules() and the store imported dynamically
// afterwards, or the two halves see different module graphs. That is also why
// this case cannot share a file with the spy-based store tests.
import { describe, it, expect, vi, afterEach } from 'vitest';

/** Over WORKER_THRESHOLD (1,000), so `applyView` takes the worker path. */
const RECORD_COUNT = 1200;

/** Mirrors `SILENCE_BASE_MS` in StoreWorkerClient — the fixed part of its silence deadline. */
const SILENCE_BASE_MS = 5000;

/** Mirrors `SILENCE_MS_PER_1000_RECORDS` in StoreWorkerClient — the part that grows with the snapshot. */
const SILENCE_MS_PER_1000_RECORDS = 20;

/** A Worker that accepts every request and answers only what a test answers for it. */
class SilentWorker {
    public static instances: SilentWorker[] = [];
    public static posted: any[] = [];
    public static terminated: number = 0;
    public onmessage: ((e: MessageEvent<any>) => void) | null = null;
    public onerror: ((e: any) => void) | null = null;
    public onmessageerror: ((e: any) => void) | null = null;

    constructor() {
        SilentWorker.instances.push(this);
    }

    postMessage(message: any): void {
        SilentWorker.posted.push(message);
    }

    terminate(): void {
        SilentWorker.terminated++;
    }

    /** Pushes a synthetic worker response to the assigned handler. */
    reply(data: any): void {
        this.onmessage?.({ data } as MessageEvent<any>);
    }
}

function rows(n: number): Array<{ id: number; name: string }> {
    return Array.from({ length: n }, (_, i) => ({ id: i, name: `n${i}` }));
}

describe('AbstractStore — the store builds its view when the worker stops answering', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('fills the view and fires "load" once after the silence deadline expires', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.useFakeTimers();

        SilentWorker.instances = [];
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

        await vi.advanceTimersByTimeAsync(SILENCE_BASE_MS + 2 * SILENCE_MS_PER_1000_RECORDS);

        expect(store.getRecords()).toHaveLength(RECORD_COUNT);
        expect(loaded).toEqual([RECORD_COUNT]);
        expect(SilentWorker.terminated).toBe(1);
    });

    it('fills the view and fires "load" once when the worker answers the snapshot and then goes quiet', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.useFakeTimers();

        SilentWorker.instances = [];
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

        // Answering the snapshot lets the store dispatch the sortFilter chained
        // behind it, which is the request this worker leaves outstanding for
        // good. The drained turn is what carries that chain to its dispatch.
        SilentWorker.instances[0].reply({ requestId: SilentWorker.posted[0].requestId });

        await vi.advanceTimersByTimeAsync(0);

        expect(SilentWorker.posted).toHaveLength(2);
        expect(store.getRecords()).toHaveLength(0);
        expect(loaded).toEqual([]);

        await vi.advanceTimersByTimeAsync(SILENCE_BASE_MS + 2 * SILENCE_MS_PER_1000_RECORDS);

        expect(store.getRecords()).toHaveLength(RECORD_COUNT);
        expect(loaded).toEqual([RECORD_COUNT]);
        expect(SilentWorker.terminated).toBe(1);
    });
});

// The reported bug: a Content-Security-Policy blocking both `blob:` and
// `data:` made every applyView() over the threshold retry the construction,
// each attempt leaking an object URL Vite's worker shim never revokes and
// reporting two policy violations. The fake here is a Worker whose
// constructor always throws, redeclared locally — this file shares no module
// with StoreWorkerClient.test.ts, which defines the same shape.
describe('AbstractStore — a construction the runtime refuses is never retried', () => {
    /** A fake Worker whose constructor counts its own calls and always throws. */
    class RefusedWorker {
        public static attempts: number = 0;

        constructor() {
            RefusedWorker.attempts++;

            throw new Error(
                "Refused to create a worker from 'blob:https://example.com/…' because it " +
                'violates the following Content Security Policy directive: "worker-src \'none\'".',
            );
        }
    }

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('builds the view and fires "load" once, synchronously, constructing the worker once (case 7)', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        RefusedWorker.attempts = 0;
        vi.stubGlobal('Worker', RefusedWorker);

        // Reset AFTER stubbing so the store and the client share one fresh
        // module graph that sees the refused-construction worker.
        vi.resetModules();

        const { MemoryStore } = await import('~/data/MemoryStore');
        const { Model } = await import('~/data/Model');

        const store = new MemoryStore(new Model([{ name: 'id' }, { name: 'name' }], 'id'), []);
        const loaded: number[] = [];

        store.on('load', () => loaded.push(store.getRecords().length));

        // No fake timers needed: with isAvailable() false the store never
        // leaves the main thread, so `load` fires synchronously here.
        store.loadData(rows(RECORD_COUNT));

        expect(store.getRecords()).toHaveLength(RECORD_COUNT);
        expect(loaded).toEqual([RECORD_COUNT]);
        expect(RefusedWorker.attempts).toBe(1);
    });

    it('never retries the construction across four applyView() calls, and warns once (case 8)', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        RefusedWorker.attempts = 0;
        vi.stubGlobal('Worker', RefusedWorker);
        vi.resetModules();

        const { MemoryStore } = await import('~/data/MemoryStore');
        const { Model } = await import('~/data/Model');

        const store = new MemoryStore(new Model([{ name: 'id' }, { name: 'name' }], 'id'), []);

        store.loadData(rows(RECORD_COUNT));
        expect(store.getRecords()).toHaveLength(RECORD_COUNT);

        store.add({ id: RECORD_COUNT, name: `n${RECORD_COUNT}` });
        expect(store.getRecords()).toHaveLength(RECORD_COUNT + 1);

        store.add({ id: RECORD_COUNT + 1, name: `n${RECORD_COUNT + 1}` });
        expect(store.getRecords()).toHaveLength(RECORD_COUNT + 2);

        store.add({ id: RECORD_COUNT + 2, name: `n${RECORD_COUNT + 2}` });
        expect(store.getRecords()).toHaveLength(RECORD_COUNT + 3);

        expect(RefusedWorker.attempts).toBe(1);
        expect(warn).toHaveBeenCalledTimes(1);
    });
});
