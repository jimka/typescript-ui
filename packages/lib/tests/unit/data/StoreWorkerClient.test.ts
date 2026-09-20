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
        await expect(client.sortFilter('s')).rejects.toThrow('Worker unavailable');
    });
});

/**
 * A fake Worker capturing the handlers the client assigns and recording every
 * postMessage payload, letting a test push a synthetic response back, fire
 * either of the two failure events, and count its own terminations.
 */
class FakeWorker {
    public static instances: FakeWorker[] = [];
    public posted: any[] = [];
    public terminated: number = 0;
    /** When set, `postMessage` throws it instead of accepting the message — a record that will not structured-clone. */
    public postMessageError: Error | null = null;
    public onmessage: ((e: MessageEvent<any>) => void) | null = null;
    public onerror: ((e: any) => void) | null = null;
    public onmessageerror: ((e: any) => void) | null = null;

    constructor() {
        FakeWorker.instances.push(this);
    }

    postMessage(message: any): void {
        if (this.postMessageError) {
            throw this.postMessageError;
        }

        this.posted.push(message);
    }

    terminate(): void {
        this.terminated++;
    }

    /** Pushes a synthetic worker response to the assigned handler. */
    reply(data: any): void {
        this.onmessage?.({ data } as MessageEvent<any>);
    }

    /** Fires the `error` event a worker whose script never ran would fire. */
    fail(): void {
        this.onerror?.({});
    }

    /** Fires the `messageerror` event an undecodable reply would fire. */
    failMessage(): void {
        this.onmessageerror?.({});
    }

    /** The requestId of the most recent postMessage. */
    lastRequestId(): number {
        return this.posted.at(-1).requestId as number;
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

    it('sortFilter posts the documented shape and resolves to the indices the worker returns', async () => {
        const promise = client.sortFilter('store-1', { field: 'name', direction: 'asc' }, FILTER);
        const worker = FakeWorker.instances[0];
        const message = worker.posted.at(-1);

        expect(message).toMatchObject({
            type: 'sortFilter',
            storeId: 'store-1',
            sort: { field: 'name', direction: 'asc' },
            filter: FILTER,
        });

        worker.reply({ requestId: message.requestId, indices: [2, 0, 1] });

        await expect(promise).resolves.toEqual([2, 0, 1]);
    });

    it('sortFilter coerces a missing indices reply to an empty array', async () => {
        const promise = client.sortFilter('store-1', undefined, FILTER);
        const worker = FakeWorker.instances[0];
        const message = worker.posted.at(-1);

        worker.reply({ requestId: message.requestId });

        await expect(promise).resolves.toEqual([]);
    });

    it('routes concurrent requests by requestId without crosstalk', async () => {
        const first = client.sortFilter('store-1', { field: 'name', direction: 'asc' });
        const second = client.sortFilter('store-2', undefined, FILTER);
        const worker = FakeWorker.instances[0];

        const [firstMsg, secondMsg] = worker.posted.slice(-2);

        // Reply out of order: second request first.
        worker.reply({ requestId: secondMsg.requestId, indices: [9] });
        worker.reply({ requestId: firstMsg.requestId, indices: [1, 2] });

        await expect(first).resolves.toEqual([1, 2]);
        await expect(second).resolves.toEqual([9]);
    });

    it('rejects the matching promise when the reply carries an error', async () => {
        const promise = client.sortFilter('store-1', { field: 'name', direction: 'asc' });
        const worker = FakeWorker.instances[0];
        const message = worker.posted.at(-1);

        worker.reply({ requestId: message.requestId, error: 'boom' });

        await expect(promise).rejects.toThrow('boom');
    });

    it('ignores a reply whose requestId is not pending', async () => {
        const promise = client.sortFilter('store-1', { field: 'name', direction: 'asc' });
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

/** Mirrors `WORKER_PROBE_TIMEOUT_MS` in the client — its cap on an unanswered first request. */
const PROBE_TIMEOUT_MS = 5000;

/** The tail of the message every retirement rejects with, whatever retired the worker. */
const RETIRED_MESSAGE = 'sort and filter run on the main thread';

describe('StoreWorkerClient worker retirement (faked Worker)', () => {
    let client: ClientModule['StoreWorkerClient'];
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        FakeWorker.instances = [];
        vi.stubGlobal('Worker', FakeWorker);
        warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        client = await freshClient();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('rejects every request in flight when the worker fires "error"', async () => {
        const first = client.sortFilter('store-1', { field: 'name', direction: 'asc' });
        const second = client.snapshot('store-1', [{ id: 1 }]);

        FakeWorker.instances[0].fail();

        await expect(first).rejects.toThrow(RETIRED_MESSAGE);
        await expect(second).rejects.toThrow(RETIRED_MESSAGE);
    });

    it('is unavailable and has terminated the worker once after an "error"', () => {
        expect(client.isAvailable()).toBe(true);

        const worker = FakeWorker.instances[0];

        worker.fail();

        expect(client.isAvailable()).toBe(false);
        expect(worker.terminated).toBe(1);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('retires the worker when its first request goes unanswered', async () => {
        vi.useFakeTimers();

        // The assertion is attached before the clock moves, so the rejection
        // the timer produces is never momentarily unhandled.
        const rejected = expect(client.sortFilter('store-1', { field: 'name', direction: 'asc' }))
            .rejects.toThrow(RETIRED_MESSAGE);

        await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
        await rejected;

        expect(client.isAvailable()).toBe(false);
    });

    it('stops timing requests once the worker has answered one', async () => {
        vi.useFakeTimers();

        const first = client.sortFilter('store-1', { field: 'name', direction: 'asc' });
        const worker = FakeWorker.instances[0];

        worker.reply({ requestId: worker.lastRequestId(), indices: [0] });

        await expect(first).resolves.toEqual([0]);

        const second = client.sortFilter('store-2', { field: 'name', direction: 'asc' });

        let settled = false;
        void second.then(() => { settled = true; }, () => { settled = true; });

        // Four times the probe's own cap: a genuinely long sort of a very large
        // store must not be mistaken for a dead script.
        await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS * 4);

        expect(settled).toBe(false);
        expect(client.isAvailable()).toBe(true);

        // Settle it properly so the promise does not leak.
        worker.reply({ requestId: worker.lastRequestId(), indices: [1] });

        await expect(second).resolves.toEqual([1]);
    });

    it('keeps the worker when a reply carries an error string', async () => {
        const promise = client.sortFilter('store-1', { field: 'name', direction: 'asc' });
        const worker = FakeWorker.instances[0];

        worker.reply({ requestId: worker.lastRequestId(), error: 'boom' });

        await expect(promise).rejects.toThrow('boom');
        expect(client.isAvailable()).toBe(true);
        expect(worker.terminated).toBe(0);
    });

    it('retires the worker when a reply cannot be decoded', async () => {
        const promise = client.sortFilter('store-1', { field: 'name', direction: 'asc' });
        const worker = FakeWorker.instances[0];

        worker.failMessage();

        await expect(promise).rejects.toThrow(RETIRED_MESSAGE);
        expect(client.isAvailable()).toBe(false);
        expect(worker.terminated).toBe(1);
    });

    it('keeps the worker when a message will not leave the main thread', async () => {
        vi.useFakeTimers();

        // Construct the worker first, so the failing message can be set up on it.
        expect(client.isAvailable()).toBe(true);

        const worker = FakeWorker.instances[0];

        worker.postMessageError = new Error('could not be cloned');

        await expect(client.snapshot('store-1', [{ id: 1 }])).rejects.toThrow('could not be cloned');

        // A message that never left proves nothing about the worker, so nothing
        // may retire it once the probe's own cap has passed.
        await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS * 2);

        expect(client.isAvailable()).toBe(true);
        expect(worker.terminated).toBe(0);
        expect(warn).not.toHaveBeenCalled();

        // And the next call still goes through.
        worker.postMessageError = null;

        const second = client.sortFilter('store-1', { field: 'name', direction: 'asc' });

        worker.reply({ requestId: worker.lastRequestId(), indices: [3] });

        await expect(second).resolves.toEqual([3]);
    });

    it('never constructs a second worker after retiring the first', async () => {
        const first = client.sortFilter('store-1', { field: 'name', direction: 'asc' });

        FakeWorker.instances[0].fail();

        await expect(first).rejects.toThrow(RETIRED_MESSAGE);
        await expect(client.sortFilter('store-1')).rejects.toThrow('Worker unavailable');

        expect(FakeWorker.instances).toHaveLength(1);
    });
});
