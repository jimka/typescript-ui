import { describe, it, expect, vi } from 'vitest';
import { Store } from '~/data/Store';
import { Proxy } from '~/data/proxy/Proxy';
import { Model } from '~/data/Model';
import { ModelRecord } from '~/data/ModelRecord';
import type { StoreExceptionEvent } from '~/data/AbstractStore';

const MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id');

/**
 * A proxy whose per-op CRUD behaviour is configurable per test: create/update
 * echo the record data by default; any of them can be made to reject. read()
 * resolves empty so a load can be observed without seeding data.
 */
class StubProxy extends Proxy {
    public createImpl: (record: ModelRecord) => Promise<Record<string, any>> =
        record => Promise.resolve(record.getData());
    public updateImpl: (record: ModelRecord) => Promise<Record<string, any>> =
        record => Promise.resolve(record.getData());
    public destroyImpl: (record: ModelRecord) => Promise<void> = () => Promise.resolve();

    read(): Promise<any[]> { return Promise.resolve([]); }
    create(record: ModelRecord): Promise<Record<string, any>> { return this.createImpl(record); }
    update(record: ModelRecord): Promise<Record<string, any>> { return this.updateImpl(record); }
    destroy(record: ModelRecord): Promise<void> { return this.destroyImpl(record); }
}

/**
 * A proxy that batches creates/updates/destroys, recording how many batch calls
 * it received so a test can assert a single batched request was issued.
 */
class BatchProxy extends StubProxy {
    public createBatchCalls: ModelRecord[][] = [];
    public createBatchImpl: (records: ModelRecord[]) => Promise<Record<string, any>[]> =
        records => Promise.resolve(records.map(r => r.getData()));

    createBatch(records: ModelRecord[]): Promise<Record<string, any>[]> {
        this.createBatchCalls.push(records);
        return this.createBatchImpl(records);
    }
}

describe('AbstractStore.sync robustness', () => {
    it('resolves and reports failures via the sync payload under the stop policy', async () => {
        const proxy = new StubProxy();
        proxy.createImpl = (): Promise<Record<string, any>> => Promise.reject(new Error('boom'));

        const store = new Store({ model: MODEL, proxy });
        store.add({ name: 'A' });

        const exceptions: StoreExceptionEvent[] = [];
        let syncFailures: StoreExceptionEvent[] = [];

        store.on('exception', (p: StoreExceptionEvent) => exceptions.push(p));
        store.on('sync', (p: { failures: StoreExceptionEvent[] }) => { syncFailures = p.failures; });

        await expect(store.sync()).resolves.toBeUndefined();

        expect(exceptions).toHaveLength(1);
        expect(exceptions[0].operation).toBe('create');
        expect(syncFailures).toHaveLength(1);
    });

    it('stop policy halts before later phases and leaves the failed record pending', async () => {
        const proxy = new StubProxy();
        proxy.createImpl = (): Promise<Record<string, any>> => Promise.reject(new Error('boom'));

        const updateSpy = vi.spyOn(proxy, 'update');
        const destroySpy = vi.spyOn(proxy, 'destroy');

        const store = new Store({ model: MODEL, proxy });
        // Seed a committed record so a queued removal exists for the destroy phase.
        store.loadData([{ id: 5, name: 'Seed' }]);
        store.remove(store.getAt(0)!);
        store.add({ name: 'New' });

        await store.sync();

        // The create failed under 'stop', so the update and destroy phases never run.
        expect(updateSpy).not.toHaveBeenCalled();
        expect(destroySpy).not.toHaveBeenCalled();
        // The failed new record is uncommitted and the removal is still queued.
        expect(store.hasPendingChanges()).toBe(true);
    });

    it('continue policy runs every phase and commits the successful records', async () => {
        const proxy = new StubProxy();
        let createCount = 0;

        proxy.createImpl = (record: ModelRecord): Promise<Record<string, any>> => {
            createCount += 1;
            // Fail the first create, succeed the second.
            return createCount === 1
                ? Promise.reject(new Error('boom'))
                : Promise.resolve(record.getData());
        };

        const store = new Store({ model: MODEL, proxy, syncErrorPolicy: 'continue' });
        const [first, second] = store.add([{ name: 'A' }, { name: 'B' }]);

        const exceptions: StoreExceptionEvent[] = [];
        store.on('exception', (p: StoreExceptionEvent) => exceptions.push(p));

        await store.sync();

        expect(exceptions).toHaveLength(1);
        // First failed (stays new), second succeeded (committed, no longer new).
        expect(first.isNew()).toBe(true);
        expect(second.isNew()).toBe(false);
    });

    it('preserves the commit-after-success invariant across mixed outcomes', async () => {
        const proxy = new StubProxy();
        let createCount = 0;

        proxy.createImpl = (record: ModelRecord): Promise<Record<string, any>> => {
            createCount += 1;
            return createCount === 2
                ? Promise.reject(new Error('boom'))
                : Promise.resolve(record.getData());
        };

        const store = new Store({ model: MODEL, proxy, syncErrorPolicy: 'continue' });
        const [ok, bad] = store.add([{ name: 'Good' }, { name: 'Bad' }]);

        await store.sync();

        expect(ok.isNew()).toBe(false);
        expect(bad.isNew()).toBe(true);
    });
});

describe('AbstractStore.sync batching', () => {
    it('issues a single batch create when the proxy advertises createBatch', async () => {
        const proxy = new BatchProxy();
        const store = new Store({ model: MODEL, proxy });
        store.add([{ name: 'A' }, { name: 'B' }]);

        await store.sync();

        expect(proxy.createBatchCalls).toHaveLength(1);
        expect(proxy.createBatchCalls[0]).toHaveLength(2);
    });

    it('commits batch records positionally from the server response', async () => {
        const proxy = new BatchProxy();
        proxy.createBatchImpl = (records: ModelRecord[]): Promise<Record<string, any>[]> =>
            Promise.resolve(records.map((_r, i) => ({ id: 100 + i })));

        const store = new Store({ model: MODEL, proxy });
        const [a, b] = store.add([{ name: 'A' }, { name: 'B' }]);

        await store.sync();

        expect(a.get('id')).toBe(100);
        expect(b.get('id')).toBe(101);
        expect(a.isNew()).toBe(false);
        expect(b.isNew()).toBe(false);
    });

    it('leaves all batch records pending and reports the whole batch on a batch failure', async () => {
        const proxy = new BatchProxy();
        proxy.createBatchImpl = (): Promise<Record<string, any>[]> => Promise.reject(new Error('boom'));

        const store = new Store({ model: MODEL, proxy });
        const [a, b] = store.add([{ name: 'A' }, { name: 'B' }]);

        const exceptions: StoreExceptionEvent[] = [];
        store.on('exception', (p: StoreExceptionEvent) => exceptions.push(p));

        await store.sync();

        expect(exceptions).toHaveLength(1);
        expect(exceptions[0].records).toHaveLength(2);
        expect(a.isNew()).toBe(true);
        expect(b.isNew()).toBe(true);
    });
});

describe('AbstractStore symmetric + lifecycle events', () => {
    it('load() emits beforeload before the read and load on success', async () => {
        const proxy = new StubProxy();
        const order: string[] = [];

        const store = new Store({ model: MODEL, proxy });
        store.on('beforeload', () => order.push('beforeload'));
        store.on('load', () => order.push('load'));

        await store.load();

        expect(order).toEqual(['beforeload', 'load']);
    });

    it('load() emits one exception (operation read, empty records) then rejects', async () => {
        const proxy = new StubProxy();
        proxy.read = (): Promise<any[]> => Promise.reject(new Error('down'));

        const store = new Store({ model: MODEL, proxy });
        const exceptions: StoreExceptionEvent[] = [];
        store.on('exception', (p: StoreExceptionEvent) => exceptions.push(p));

        await expect(store.load()).rejects.toThrow('down');

        expect(exceptions).toHaveLength(1);
        expect(exceptions[0].operation).toBe('read');
        expect(exceptions[0].records).toEqual([]);
    });

    it('removeAll() emits clear with the removed set plus datachanged', () => {
        const store = new Store({ model: MODEL });
        store.loadData([{ id: 1, name: 'A' }, { id: 2, name: 'B' }]);

        let removed: ModelRecord[] = [];
        let dataChanged = false;
        store.on('clear', (p: { removed: ModelRecord[] }) => { removed = p.removed; });
        store.on('datachanged', () => { dataChanged = true; });

        store.removeAll();

        expect(removed).toHaveLength(2);
        expect(dataChanged).toBe(true);
    });

    it('filter / clearFilter emit filterchange with the active filters', async () => {
        const store = new Store({ model: MODEL });
        store.loadData([{ id: 1, name: 'A' }]);

        const seen: unknown[][] = [];
        store.on('filterchange', (p: { filters: unknown[] }) => seen.push(p.filters));

        await store.filter('name', 'A');
        await store.clearFilter();

        expect(seen).toHaveLength(2);
        expect(seen[0]).toHaveLength(1);
        expect(seen[1]).toHaveLength(0);
    });

    it('notifyRecordChanged(r) emits update with r then datachanged', () => {
        const store = new Store({ model: MODEL });
        store.loadData([{ id: 1, name: 'A' }]);
        const record = store.getAt(0)!;

        let updated: ModelRecord | undefined;
        const order: string[] = [];
        store.on('update', (p: { record: ModelRecord }) => { updated = p.record; order.push('update'); });
        store.on('datachanged', () => order.push('datachanged'));

        store.notifyRecordChanged(record);

        expect(updated).toBe(record);
        expect(order).toEqual(['update', 'datachanged']);
    });
});
