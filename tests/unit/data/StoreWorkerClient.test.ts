import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FilterDescriptor } from '~/data/FilterDescriptor';

// StoreWorkerClient keeps `worker`, `nextRequestId`, and `pending` as
// module-level singletons. Once a (real or fake) worker is constructed it is
// cached for the module's lifetime and nextRequestId keeps incrementing. To
// keep the fallback layer (no Worker) and the happy-path layer (faked Worker)
// from contaminating each other through that cache, every test imports a FRESH
// copy of the module via vi.resetModules() + dynamic import. Absolute requestId
// values are therefore never asserted — only relative/monotonic behaviour.

type ClientModule = typeof import('~/data/StoreWorkerClient');

async function freshClient(): Promise<ClientModule['StoreWorkerClient']> {
    vi.resetModules();

    const mod = await import('~/data/StoreWorkerClient');

    return mod.StoreWorkerClient;
}

const FILTER: FilterDescriptor = { type: 'eq', field: 'name', value: 'Bob' };

describe('StoreWorkerClient fallback (no Worker global)', () => {
    it('isAvailable() is false when Worker is undefined', async () => {
        // Under the node env, `typeof Worker === 'undefined'` already; no stub.
        const client = await freshClient();

        expect(client.isAvailable()).toBe(false);
    });

    it('every request rejects with "Worker unavailable"', async () => {
        const client = await freshClient();

        await expect(client.snapshot('s', [])).rejects.toThrow('Worker unavailable');
        await expect(client.sort('s', 'name', 'asc')).rejects.toThrow('Worker unavailable');
        await expect(client.filter('s', FILTER)).rejects.toThrow('Worker unavailable');
        await expect(client.sortFilter('s')).rejects.toThrow('Worker unavailable');
    });
});

/**
 * A fake Worker capturing the onmessage handler the client assigns and recording
 * every postMessage payload, letting a test push a synthetic response back.
 */
class FakeWorker {
    public static instances: FakeWorker[] = [];
    public posted: any[] = [];
    public onmessage: ((e: MessageEvent<any>) => void) | null = null;

    constructor() {
        FakeWorker.instances.push(this);
    }

    postMessage(message: any): void {
        this.posted.push(message);
    }

    /** Pushes a synthetic worker response to the assigned handler. */
    reply(data: any): void {
        this.onmessage?.({ data } as MessageEvent<any>);
    }
}

describe('StoreWorkerClient happy path (faked Worker)', () => {
    let client: ClientModule['StoreWorkerClient'];

    beforeEach(async () => {
        FakeWorker.instances = [];
        vi.stubGlobal('Worker', FakeWorker);

        // Reset modules AFTER stubbing so the worker-import side and the
        // `typeof Worker` check both see the fake.
        client = await freshClient();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('isAvailable() is true once a Worker can be constructed', () => {
        expect(client.isAvailable()).toBe(true);
    });

    it('snapshot posts the documented shape and resolves to undefined', async () => {
        const promise = client.snapshot('store-1', [{ id: 1 }]);
        const worker = FakeWorker.instances[0];
        const message = worker.posted.at(-1);

        expect(message).toMatchObject({ type: 'snapshot', storeId: 'store-1', records: [{ id: 1 }] });
        expect(typeof message.requestId).toBe('number');

        worker.reply({ requestId: message.requestId });

        await expect(promise).resolves.toBeUndefined();
    });

    it('sort resolves to the indices the worker returns', async () => {
        const promise = client.sort('store-1', 'name', 'asc');
        const worker = FakeWorker.instances[0];
        const message = worker.posted.at(-1);

        expect(message).toMatchObject({ type: 'sort', storeId: 'store-1', field: 'name', direction: 'asc' });

        worker.reply({ requestId: message.requestId, indices: [2, 0, 1] });

        await expect(promise).resolves.toEqual([2, 0, 1]);
    });

    it('filter coerces a missing indices reply to an empty array', async () => {
        const promise = client.filter('store-1', FILTER);
        const worker = FakeWorker.instances[0];
        const message = worker.posted.at(-1);

        expect(message).toMatchObject({ type: 'filter', storeId: 'store-1', descriptor: FILTER });

        worker.reply({ requestId: message.requestId });

        await expect(promise).resolves.toEqual([]);
    });

    it('routes concurrent requests by requestId without crosstalk', async () => {
        const first = client.sort('store-1', 'name', 'asc');
        const second = client.filter('store-2', FILTER);
        const worker = FakeWorker.instances[0];

        const [firstMsg, secondMsg] = worker.posted.slice(-2);

        // Reply out of order: second request first.
        worker.reply({ requestId: secondMsg.requestId, indices: [9] });
        worker.reply({ requestId: firstMsg.requestId, indices: [1, 2] });

        await expect(first).resolves.toEqual([1, 2]);
        await expect(second).resolves.toEqual([9]);
    });

    it('rejects the matching promise when the reply carries an error', async () => {
        const promise = client.sort('store-1', 'name', 'asc');
        const worker = FakeWorker.instances[0];
        const message = worker.posted.at(-1);

        worker.reply({ requestId: message.requestId, error: 'boom' });

        await expect(promise).rejects.toThrow('boom');
    });

    it('ignores a reply whose requestId is not pending', async () => {
        const promise = client.sort('store-1', 'name', 'asc');
        const worker = FakeWorker.instances[0];
        const message = worker.posted.at(-1);

        // An unknown requestId is a silent no-op and must not settle the pending
        // promise.
        worker.reply({ requestId: message.requestId + 1000, indices: [42] });

        let settled = false;
        void promise.then(() => { settled = true; }, () => { settled = true; });
        await Promise.resolve();

        expect(settled).toBe(false);

        // Settle it properly so the promise does not leak.
        worker.reply({ requestId: message.requestId, indices: [0] });
        await expect(promise).resolves.toEqual([0]);
    });
});
