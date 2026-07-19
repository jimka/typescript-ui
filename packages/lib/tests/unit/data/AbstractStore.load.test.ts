import { describe, it, expect, vi } from 'vitest';
import { Store } from '~/data/Store';
import { Proxy, ReadParams } from '~/data/proxy/Proxy';
import { Model } from '~/data/Model';
import { ModelRecord } from '~/data/ModelRecord';

const MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id');

/**
 * A proxy whose read() resolves only when a captured deferred is settled, so a
 * test can interleave two overlapping load() calls deterministically.
 */
class DeferredProxy extends Proxy {
    public pending: Array<{ resolve: (rows: any[]) => void; params?: ReadParams }> = [];

    read(params?: ReadParams): Promise<any[]> {
        return new Promise(resolve => this.pending.push({ resolve, params }));
    }

    create(record: ModelRecord): Promise<Record<string, any>> { return Promise.resolve(record.getData()); }
    update(record: ModelRecord): Promise<Record<string, any>> { return Promise.resolve(record.getData()); }
    destroy(): Promise<void> { return Promise.resolve(); }
}

/**
 * A proxy that records every ReadParams it received and resolves immediately.
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

describe('AbstractStore.load concurrency', () => {
    it('ignores a stale response when a newer load supersedes it', async () => {
        const proxy = new DeferredProxy();
        const store = new Store({ model: MODEL, proxy });

        const first  = store.load();
        const second = store.load();

        // Resolve the newer load first, then the stale one.
        proxy.pending[1].resolve([{ id: 2, name: 'New' }]);
        proxy.pending[0].resolve([{ id: 1, name: 'Stale' }]);

        await Promise.all([first, second]);

        expect(store.getCount()).toBe(1);
        expect(store.getAt(0)?.get('name')).toBe('New');
    });

    it('aborts the previous read when a newer load starts', () => {
        const proxy = new DeferredProxy();
        // pageSize makes buildReadParams emit a ReadParams that carries the signal,
        // so the abort is observable on the proxy's received params.
        const store = new Store({ model: MODEL, proxy, pageSize: 10 });

        void store.load();
        const firstSignal = proxy.pending[0].params?.signal;

        void store.load();

        expect(firstSignal?.aborted).toBe(true);
    });
});

describe('AbstractStore remote sort/filter', () => {
    it('serializes active sorters into ReadParams when remoteSort is on', async () => {
        const proxy = new RecordingProxy();
        const store = new Store({ model: MODEL, proxy, remoteSort: true });

        await store.sort('name', 'asc');

        const last = proxy.calls.at(-1);
        expect(last?.sorters).toEqual([{ field: 'name', dir: 'asc' }]);
    });

    it('reloads on filter when remoteFilter is on', async () => {
        const proxy = new RecordingProxy();
        const store = new Store({ model: MODEL, proxy, remoteFilter: true });

        await store.filter('name', 'Bob');

        const last = proxy.calls.at(-1);
        expect(last?.filters).toEqual([{ type: 'eq', field: 'name', value: 'Bob' }]);
    });

    it('does not reload on filter when no remote flag and no pagination', async () => {
        const proxy = new RecordingProxy();
        const store = new Store({ model: MODEL, proxy });

        await store.filter('name', 'Bob');

        expect(proxy.calls).toHaveLength(0);
    });

    it('does not serialize sorters when remoteSort is off but paginated', async () => {
        const proxy = new RecordingProxy();
        const store = new Store({ model: MODEL, proxy, pageSize: 10 });
        vi.spyOn(proxy, 'getLastTotalCount').mockReturnValue(0);

        await store.sort('name', 'asc');

        const last = proxy.calls.at(-1);
        expect(last?.page).toBe(1);
        expect(last?.sorters).toBeUndefined();
    });
});
