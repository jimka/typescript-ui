import { describe, it, expect, vi, afterEach } from 'vitest';
import { Store } from '~/data/Store';
import { MemoryStore } from '~/data/MemoryStore';
import { Proxy, ReadParams } from '~/data/proxy/Proxy';
import { Model } from '~/data/Model';
import { ModelRecord } from '~/data/ModelRecord';
import { StoreWorkerClient } from '~/data/StoreWorkerClient';

const MODEL = new Model([{ name: 'id' }, { name: 'name' }, { name: 'age', type: 'number' }], 'id');

/**
 * A proxy that records every ReadParams it received and resolves immediately,
 * mirroring the helper in AbstractStore.load.test.ts / Store.test.ts.
 */
class RecordingProxy extends Proxy {
    public calls: Array<ReadParams | undefined> = [];

    read(params?: ReadParams): Promise<any[]> {
        this.calls.push(params);
        return Promise.resolve([]);
    }

    create(record: ModelRecord): Promise<Record<string, any>> { return Promise.resolve(record.getData()); }
    update(record: ModelRecord): Promise<Record<string, any>> { return Promise.resolve(record.getData()); }
    destroy(): Promise<void> { return Promise.resolve(); }
}

describe('AbstractStore keyed filters (setFilter / getFilter)', () => {
    it('replacing the same key leaves exactly one descriptor, the latest', async () => {
        const store = new MemoryStore(MODEL, []);

        await store.setFilter('age', { type: 'gt', field: 'age', value: 20 });
        await store.setFilter('age', { type: 'gt', field: 'age', value: 30 });

        expect(store.getActiveFilters()).toEqual([{ type: 'gt', field: 'age', value: 30 }]);
    });

    it('removing one keyed filter leaves the other in place', async () => {
        const store = new MemoryStore(MODEL, []);

        await store.setFilter('age', { type: 'gt', field: 'age', value: 20 });
        await store.setFilter('name', { type: 'contains', field: 'name', value: 'ali' });
        await store.setFilter('age', null);

        expect(store.getFilter('age')).toBeNull();
        expect(store.getFilter('name')).toEqual({ type: 'contains', field: 'name', value: 'ali' });
    });

    it('composes with an anonymous filterBy() descriptor without disturbing it', async () => {
        const store = new MemoryStore(MODEL, []);
        const anon  = { type: 'eq' as const, field: 'id', value: 1 };

        await store.filterBy(anon);
        await store.setFilter('age', { type: 'gt', field: 'age', value: 20 });

        expect(store.getActiveFilters()).toEqual([anon, { type: 'gt', field: 'age', value: 20 }]);

        await store.setFilter('age', { type: 'gt', field: 'age', value: 30 });

        expect(store.getActiveFilters()).toEqual([anon, { type: 'gt', field: 'age', value: 30 }]);
    });

    it('clearFilter() removes both keyed and anonymous descriptors', async () => {
        const store = new MemoryStore(MODEL, []);

        await store.filterBy({ type: 'eq', field: 'id', value: 1 });
        await store.setFilter('age', { type: 'gt', field: 'age', value: 20 });
        await store.clearFilter();

        expect(store.getActiveFilters()).toEqual([]);
        expect(store.getFilter('age')).toBeNull();
    });

    it('a Store constructed with the filters option still surfaces them unchanged', () => {
        const store = new Store({
            model: MODEL,
            filters: [{ type: 'eq', field: 'name', value: 'Bob' }],
        });

        expect(store.getActiveFilters()).toEqual([{ type: 'eq', field: 'name', value: 'Bob' }]);
    });

    it('fires "filterchange" and "datachange" and rebuilds the view, like filterBy', async () => {
        const store = new MemoryStore(MODEL, []);
        store.loadData([{ id: 1, name: 'Bob', age: 40 }, { id: 2, name: 'Amy', age: 20 }]);
        const events: string[] = [];

        store.on('filterchange', () => events.push('filterchange'));
        store.on('datachange',   () => events.push('datachange'));

        await store.setFilter('age', { type: 'gt', field: 'age', value: 30 });

        expect(events).toEqual(['filterchange', 'datachange']);
        expect(store.getRecords().map(r => r.get('id'))).toEqual([1]);
    });

    it('with remoteFilter: true, triggers a read() whose filters carry the descriptor and resets to page 1', async () => {
        const proxy = new RecordingProxy();
        const store = new Store({ model: MODEL, proxy, remoteFilter: true });

        await store.setFilter('age', { type: 'gt', field: 'age', value: 20 });

        const last = proxy.calls.at(-1);
        expect(last?.filters).toEqual([{ type: 'gt', field: 'age', value: 20 }]);
        expect(store.getPage()).toBe(1);
    });

    it('with no remoteFilter and no pagination, triggers no read() and shrinks the local view', async () => {
        const proxy = new RecordingProxy();
        const store = new Store({ model: MODEL, proxy });

        store.loadData([{ id: 1, name: 'Bob', age: 40 }, { id: 2, name: 'Amy', age: 20 }]);

        await store.setFilter('age', { type: 'gt', field: 'age', value: 30 });

        expect(proxy.calls).toHaveLength(0);
        expect(store.getRecords().map(r => r.get('id'))).toEqual([1]);
    });

    describe('above the worker threshold', () => {
        afterEach(() => vi.restoreAllMocks());

        it('composes two keyed filters into one "and" request', async () => {
            vi.spyOn(StoreWorkerClient, 'isAvailable').mockReturnValue(true);
            vi.spyOn(StoreWorkerClient, 'snapshot').mockResolvedValue(undefined);
            const sortFilter = vi.spyOn(StoreWorkerClient, 'sortFilter').mockResolvedValue([]);

            const store = new MemoryStore(MODEL, []);
            const rows  = Array.from({ length: 1200 }, (_, i) => ({ id: i, name: `n${i}`, age: i }));

            store.loadData(rows);
            await Promise.resolve();

            await store.setFilter('age', { type: 'gt', field: 'age', value: 20 });
            await store.setFilter('name', { type: 'contains', field: 'name', value: 'n' });

            const lastCall = sortFilter.mock.calls.at(-1)!;
            expect(lastCall[2]).toEqual({
                type: 'and',
                filters: [
                    { type: 'gt', field: 'age', value: 20 },
                    { type: 'contains', field: 'name', value: 'n' },
                ],
            });
        });
    });
});
