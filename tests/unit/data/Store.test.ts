import { describe, it, expect, vi } from 'vitest';
import { Store } from '~/data/Store';
import { Proxy, ReadParams } from '~/data/proxy/Proxy';
import { Model } from '~/data/Model';
import { ModelRecord } from '~/data/ModelRecord';

const MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id');

/**
 * A proxy that records every ReadParams it received and resolves immediately,
 * mirroring the helper in AbstractStore.load.test.ts.
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

describe('Store constructor', () => {
    it('positional form assigns the model and leaves proxy undefined', () => {
        const store = new Store(MODEL);

        expect(store.model).toBe(MODEL);
        expect(store.proxy).toBeUndefined();
    });

    it('positional form assigns an explicit proxy', () => {
        const proxy = new RecordingProxy();
        const store = new Store(MODEL, proxy);

        expect(store.proxy).toBe(proxy);
    });

    it('options-bag form wires model and proxy from the bag', () => {
        const proxy = new RecordingProxy();
        const store = new Store({ model: MODEL, proxy });

        expect(store.model).toBe(MODEL);
        expect(store.proxy).toBe(proxy);
    });
});

describe('Store options-bag applyOptions forwarding', () => {
    it('registers bag listeners before an autoLoad fires', async () => {
        const proxy = new RecordingProxy();
        const loadSpy = vi.fn();

        // autoLoad triggers a load() whose 'load' event must reach the
        // listener applyOptions registered first (per AbstractStore JSDoc).
        const store = new Store({ model: MODEL, proxy, listeners: { load: loadSpy }, autoLoad: true });

        // Let the autoLoad's load() promise settle.
        await Promise.resolve();
        await Promise.resolve();

        expect(proxy.calls).toHaveLength(1);
        expect(loadSpy).toHaveBeenCalledOnce();
        // Reference the store so the no-unused-vars lint stays quiet.
        expect(store.getCount()).toBe(0);
    });

    it('forwards pageSize so the first read carries page 1', async () => {
        const proxy = new RecordingProxy();
        const store = new Store({ model: MODEL, proxy, pageSize: 10 });

        await store.load();

        expect(proxy.calls.at(-1)?.page).toBe(1);
    });

    it('forwards filters so they surface through getActiveFilters', () => {
        const store = new Store({
            model: MODEL,
            filters: [{ type: 'eq', field: 'name', value: 'Bob' }],
        });

        expect(store.getActiveFilters()).toEqual([{ type: 'eq', field: 'name', value: 'Bob' }]);
    });
});

describe('Store proxy-less guards', () => {
    it('load() throws when no proxy is configured', async () => {
        const store = new Store(MODEL);

        await expect(store.load()).rejects.toThrow('no proxy is configured');
    });

    it('sync() is a no-op that resolves when no proxy is configured', async () => {
        const store = new Store(MODEL);

        await expect(store.sync()).resolves.toBeUndefined();
    });
});
