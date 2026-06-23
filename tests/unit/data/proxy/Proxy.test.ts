import { describe, it, expect, vi } from 'vitest';
import { Proxy } from '~/data/proxy/Proxy';
import { Store } from '~/data/Store';
import { Model } from '~/data/Model';
import { ModelRecord } from '~/data/ModelRecord';

const MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id');

/**
 * A minimal concrete proxy: implements only the four abstract CRUD methods as
 * echo stubs and inherits everything else from the base class. It deliberately
 * does NOT define the optional batch methods, so it exercises the base-class
 * defaults.
 */
class MinimalProxy extends Proxy {
    read(): Promise<any[]> { return Promise.resolve([]); }
    create(record: ModelRecord): Promise<Record<string, any>> { return Promise.resolve(record.getData()); }
    update(record: ModelRecord): Promise<Record<string, any>> { return Promise.resolve(record.getData()); }
    destroy(): Promise<void> { return Promise.resolve(); }
}

describe('Proxy base defaults', () => {
    it('getLastTotalCount returns undefined for a non-paginating proxy', () => {
        expect(new MinimalProxy().getLastTotalCount()).toBeUndefined();
    });

    it('leaves the optional batch methods undefined rather than inheriting no-ops', () => {
        const proxy = new MinimalProxy();

        expect(proxy.createBatch).toBeUndefined();
        expect(proxy.updateBatch).toBeUndefined();
        expect(proxy.destroyBatch).toBeUndefined();
    });
});

describe('Proxy optional-batch fallback', () => {
    it('sync issues one create/update/destroy per record when no batch method exists', async () => {
        const proxy = new MinimalProxy();
        const createSpy = vi.spyOn(proxy, 'create');
        const updateSpy = vi.spyOn(proxy, 'update');
        const destroySpy = vi.spyOn(proxy, 'destroy');

        const store = new Store({ model: MODEL, proxy });
        store.loadData([{ id: 1, name: 'Seed' }, { id: 2, name: 'Other' }]);

        store.add({ id: 3, name: 'New' });       // new   -> create
        store.getById(1)!.set('name', 'Edited'); // dirty -> update
        store.remove(store.getById(2)!);         // gone  -> destroy

        await store.sync();

        expect(createSpy).toHaveBeenCalledOnce();
        expect(updateSpy).toHaveBeenCalledOnce();
        expect(destroySpy).toHaveBeenCalledOnce();
    });
});
