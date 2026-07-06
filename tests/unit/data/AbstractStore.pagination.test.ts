import { describe, it, expect, vi } from 'vitest';
import { Store } from '~/data/Store';
import { Proxy, ReadParams } from '~/data/proxy/Proxy';
import { Model } from '~/data/Model';
import { ModelRecord } from '~/data/ModelRecord';

const MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id');

/**
 * A proxy that records every read, resolves configurable rows, and reports a
 * configurable paginated total (so `_totalCount` can be wired through the
 * documented load path — there is no public setter).
 */
class RecordingProxy extends Proxy {
    public calls: Array<ReadParams | undefined> = [];
    public rows: any[] = [];
    public total: number | undefined = undefined;

    read(params?: ReadParams): Promise<any[]> {
        this.calls.push(params);
        return Promise.resolve(this.rows);
    }
    getLastTotalCount(): number | undefined { return this.total; }

    create(record: ModelRecord): Promise<Record<string, any>> { return Promise.resolve(record.getData()); }
    update(record: ModelRecord): Promise<Record<string, any>> { return Promise.resolve(record.getData()); }
    destroy(): Promise<void> { return Promise.resolve(); }
}

/** A paginated store whose totalCount is wired via an initial load. */
async function paginated(total: number, pageSize = 10, rows: any[] = []): Promise<{ store: Store; proxy: RecordingProxy }> {
    const proxy = new RecordingProxy();
    proxy.total = total;
    proxy.rows  = rows;
    const store = new Store({ model: MODEL, proxy, pageSize });
    await store.load();               // wires _totalCount from proxy.getLastTotalCount()
    return { store, proxy };
}

describe('AbstractStore pagination — page / totalPages', () => {
    it('getPage() defaults to 1 even when pagination is disabled', () => {
        expect(new Store(MODEL).getPage()).toBe(1);
    });

    it('getTotalPages() is undefined when pageSize is missing', () => {
        const store = new Store(MODEL);
        expect(store.getTotalPages()).toBeUndefined();
    });

    it('getTotalPages() is undefined when totalCount is missing (pageSize set, no paginated load)', () => {
        const store = new Store({ model: MODEL, proxy: new RecordingProxy(), pageSize: 10 });
        expect(store.getTotalPages()).toBeUndefined();
    });

    it('getTotalPages() = max(1, ceil(totalCount / pageSize)) when both are known', async () => {
        const { store } = await paginated(25, 10);
        expect(store.getTotalPages()).toBe(3);       // ceil(25/10)
        const { store: exact } = await paginated(20, 10);
        expect(exact.getTotalPages()).toBe(2);       // exact multiple
        const { store: tiny } = await paginated(0, 10);
        expect(tiny.getTotalPages()).toBe(1);        // floored at 1
    });
});

describe('AbstractStore pagination — nextPage', () => {
    it('is a no-op when pageSize is unset (page unchanged, no pagechanged)', () => {
        const store = new Store(MODEL);
        const spy = vi.fn();
        store.on('pagechange', spy);
        store.nextPage();
        expect(store.getPage()).toBe(1);
        expect(spy).not.toHaveBeenCalled();
    });

    it('is a no-op on the last page', async () => {
        const { store } = await paginated(30, 10);   // 3 pages
        store.goToPage(3);
        const spy = vi.fn();
        store.on('pagechange', spy);
        store.nextPage();
        expect(store.getPage()).toBe(3);
        expect(spy).not.toHaveBeenCalled();
    });

    it('increments the page, emits pagechanged { page, pageSize }, and reloads', async () => {
        const { store, proxy } = await paginated(30, 10);
        const before = proxy.calls.length;
        const spy = vi.fn();
        store.on('pagechange', spy);

        store.nextPage();

        expect(store.getPage()).toBe(2);
        expect(spy).toHaveBeenCalledOnce();
        expect(spy.mock.calls[0][0]).toEqual({ page: 2, pageSize: 10 });
        expect(proxy.calls.length).toBe(before + 1);  // reload issued
    });
});

describe('AbstractStore pagination — prevPage', () => {
    it('is a no-op on page 1', async () => {
        const { store } = await paginated(30, 10);
        const spy = vi.fn();
        store.on('pagechange', spy);
        store.prevPage();
        expect(store.getPage()).toBe(1);
        expect(spy).not.toHaveBeenCalled();
    });

    it('decrements and emits pagechanged from a later page', async () => {
        const { store } = await paginated(30, 10);
        store.goToPage(3);
        const spy = vi.fn();
        store.on('pagechange', spy);
        store.prevPage();
        expect(store.getPage()).toBe(2);
        expect(spy).toHaveBeenCalledOnce();
        expect(spy.mock.calls[0][0]).toEqual({ page: 2, pageSize: 10 });
    });
});

describe('AbstractStore pagination — goToPage', () => {
    it('clamps a too-high target to totalPages when total is known', async () => {
        const { store } = await paginated(30, 10);   // 3 pages
        store.goToPage(99);
        expect(store.getPage()).toBe(3);
    });

    it('clamps a too-low target to 1', async () => {
        const { store } = await paginated(30, 10);
        store.goToPage(3);
        store.goToPage(-5);
        expect(store.getPage()).toBe(1);
    });

    it('is a no-op (no emit, no reload) when the target equals the current page', async () => {
        const { store, proxy } = await paginated(30, 10);
        const before = proxy.calls.length;
        const spy = vi.fn();
        store.on('pagechange', spy);
        store.goToPage(1);   // already on page 1
        expect(spy).not.toHaveBeenCalled();
        expect(proxy.calls.length).toBe(before);
    });

    it('is a no-op when pageSize is unset', () => {
        const store = new Store(MODEL);
        const spy = vi.fn();
        store.on('pagechange', spy);
        store.goToPage(3);
        expect(store.getPage()).toBe(1);
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('AbstractStore pagination — dirty guard', () => {
    async function dirtyStore(): Promise<{ store: Store; proxy: RecordingProxy }> {
        // Load real rows so the store owns records, then make one dirty.
        const { store, proxy } = await paginated(30, 10, [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]);
        store.getAt(0)!.set('name', 'Edited');   // owned record -> isDirty()
        expect(store.hasPendingChanges()).toBe(true);
        return { store, proxy };
    }

    it('blocks nextPage: emits pagechangeblocked { from, to }, no page change, no reload', async () => {
        const { store, proxy } = await dirtyStore();
        const before = proxy.calls.length;
        const blocked = vi.fn();
        const changed = vi.fn();
        store.on('pagechangeblocked', blocked);
        store.on('pagechange', changed);

        store.nextPage();

        expect(blocked).toHaveBeenCalledOnce();
        expect(blocked.mock.calls[0][0]).toEqual({ from: 1, to: 2 });
        expect(changed).not.toHaveBeenCalled();
        expect(store.getPage()).toBe(1);
        expect(proxy.calls.length).toBe(before);
    });

    it('blocks goToPage with the resolved target in the event', async () => {
        const { store } = await dirtyStore();
        const blocked = vi.fn();
        store.on('pagechangeblocked', blocked);

        store.goToPage(3);

        expect(blocked).toHaveBeenCalledOnce();
        expect(blocked.mock.calls[0][0]).toEqual({ from: 1, to: 3 });
        expect(store.getPage()).toBe(1);
    });

    it('releases the guard once pending changes are discarded', async () => {
        const { store } = await dirtyStore();
        store.reject();                          // discard the edit
        expect(store.hasPendingChanges()).toBe(false);

        const changed = vi.fn();
        store.on('pagechange', changed);
        store.nextPage();

        expect(changed).toHaveBeenCalledOnce();
        expect(store.getPage()).toBe(2);
    });
});
