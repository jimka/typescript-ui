import { describe, it, expect, vi } from 'vitest';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';

const MODEL = new Model([{ name: 'id' }, { name: 'name' }, { name: 'score' }], 'id');
const SAMPLE = [
    { id: 1, name: 'Alice', score: 80 },
    { id: 2, name: 'Bob',   score: 60 },
    { id: 3, name: 'Carol', score: 90 },
];

function makeStore(data: any[] = []): MemoryStore {
    const store = new MemoryStore(MODEL, data);
    store.loadData(data);
    return store;
}

describe('MemoryStore', () => {
    it('loadData populates getRecords()', () => {
        expect(makeStore(SAMPLE).getCount()).toBe(3);
    });
    it('getAt returns the record at the given index', () => {
        expect(makeStore(SAMPLE).getAt(0)?.get('name')).toBe('Alice');
    });
    it('getById finds a record by primary key', () => {
        expect(makeStore(SAMPLE).getById(2)?.get('name')).toBe('Bob');
    });
    it('filter reduces visible records', async () => {
        const store = makeStore(SAMPLE);
        await store.filter('name', 'Bob');
        expect(store.getCount()).toBe(1);
    });
    it('clearFilter restores all records', async () => {
        const store = makeStore(SAMPLE);
        await store.filter('name', 'Bob');
        await store.clearFilter();
        expect(store.getCount()).toBe(3);
    });
    it('sort ascending orders correctly', async () => {
        const store = makeStore(SAMPLE);
        await store.sort('score', 'asc');
        expect(store.getAt(0)?.get('score')).toBe(60);
    });
    it('add fires add and datachanged events', () => {
        const store = makeStore([]);
        const addSpy = vi.fn();
        store.on('add', addSpy);
        store.add({ id: 99, name: 'Dave', score: 70 });
        expect(addSpy).toHaveBeenCalledOnce();
        expect(store.getCount()).toBe(1);
    });
    it('off unregisters a listener', () => {
        const store = makeStore([]);
        const spy = vi.fn();
        store.on('datachange', spy);
        store.off('datachange', spy);
        store.add({ id: 1, name: 'X', score: 0 });
        expect(spy).not.toHaveBeenCalled();
    });
    it('find returns the first record matching a property', () => {
        expect(makeStore(SAMPLE).find('name', 'Carol')?.get('score')).toBe(90);
    });
    it('findAll returns every record matching a property', () => {
        const store = makeStore([
            { id: 1, name: 'A', score: 10 },
            { id: 2, name: 'B', score: 10 },
            { id: 3, name: 'C', score: 20 },
        ]);
        expect(store.findAll('score', 10)).toHaveLength(2);
    });
    it('remove takes a record out of the view', () => {
        const store = makeStore(SAMPLE);
        store.remove(store.getAt(0)!);
        expect(store.getCount()).toBe(2);
    });
    it('sort descending orders correctly', async () => {
        const store = makeStore(SAMPLE);
        await store.sort('score', 'desc');
        expect(store.getAt(0)?.get('score')).toBe(90);
    });
    it('sort sends null values to the end', async () => {
        const store = makeStore([
            { id: 1, name: 'A', score: 50 },
            { id: 2, name: 'B', score: null },
            { id: 3, name: 'C', score: 90 },
        ]);
        await store.sort('score', 'asc');
        expect(store.getAt(0)?.get('score')).toBe(50);
        expect(store.getAt(store.getCount() - 1)?.get('score')).toBe(null);
    });
    it('clearSort restores insertion order', async () => {
        const store = makeStore(SAMPLE);
        await store.sort('score', 'asc');
        await store.clearSort();
        expect(store.getAt(0)?.get('name')).toBe('Alice');
    });
    it('sync sends create, update, and destroy to the proxy', async () => {
        const store      = makeStore(SAMPLE);
        const createSpy  = vi.spyOn(store.proxy, 'create');
        const updateSpy  = vi.spyOn(store.proxy, 'update');
        const destroySpy = vi.spyOn(store.proxy, 'destroy');

        store.add({ id: 4, name: 'New', score: 0 });   // new    -> create
        store.getById(2)!.set('name', 'Bobby');        // dirty  -> update
        store.remove(store.getById(3)!);               // gone   -> destroy

        await store.sync();

        expect(createSpy).toHaveBeenCalledOnce();
        expect(updateSpy).toHaveBeenCalledOnce();
        expect(destroySpy).toHaveBeenCalledOnce();
    });
});

describe('MemoryStore auto-notify', () => {
    it('fires update + datachanged when an owned record field is set', () => {
        const store          = makeStore(SAMPLE);
        const record         = store.getAt(0)!;
        const updateSpy      = vi.fn();
        const datachangedSpy = vi.fn();

        store.on('update', updateSpy);
        store.on('datachange', datachangedSpy);
        record.set('name', 'Zed');

        expect(updateSpy).toHaveBeenCalledOnce();
        expect(datachangedSpy).toHaveBeenCalledOnce();
        expect(updateSpy.mock.calls[0][0]).toEqual({
            record,
            changes: { name: { old: 'Alice', new: 'Zed' } },
        });
    });

    it('stays silent during a bulk load', () => {
        const store          = new MemoryStore(MODEL);
        const updateSpy      = vi.fn();
        const datachangedSpy = vi.fn();
        const loadSpy        = vi.fn();

        store.on('update', updateSpy);
        store.on('datachange', datachangedSpy);
        store.on('load', loadSpy);
        store.loadData(SAMPLE);

        expect(updateSpy).not.toHaveBeenCalled();
        expect(datachangedSpy).not.toHaveBeenCalled();
        expect(loadSpy).toHaveBeenCalledOnce();
    });

    it('stays silent on a no-op set of an owned record', () => {
        const store     = makeStore(SAMPLE);
        const updateSpy = vi.fn();

        store.on('update', updateSpy);
        store.getAt(0)!.set('name', 'Alice');   // unchanged value

        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('coalesces a store-level batch into one datachanged with no update', () => {
        const store          = makeStore(SAMPLE);
        const updateSpy      = vi.fn();
        const datachangedSpy = vi.fn();

        store.on('update', updateSpy);
        store.on('datachange', datachangedSpy);

        store.beginEdit();
        store.getAt(0)!.set('name', 'X');
        store.getAt(0)!.set('score', 1);
        store.getAt(1)!.set('name', 'Y');
        store.commitEdit();

        expect(updateSpy).not.toHaveBeenCalled();
        expect(datachangedSpy).toHaveBeenCalledOnce();
    });

    it('setSilent mutates without firing any event', () => {
        const store          = makeStore(SAMPLE);
        const record         = store.getAt(0)!;
        const updateSpy      = vi.fn();
        const datachangedSpy = vi.fn();

        store.on('update', updateSpy);
        store.on('datachange', datachangedSpy);
        record.setSilent('name', 'Q');

        expect(updateSpy).not.toHaveBeenCalled();
        expect(datachangedSpy).not.toHaveBeenCalled();
        expect(record.get('name')).toBe('Q');
        expect(record.isDirty()).toBe(true);
    });

    it('clears the back-ref on remove so a detached record stays silent', () => {
        const store  = makeStore(SAMPLE);
        const record = store.getAt(0)!;

        store.remove(record);

        const updateSpy = vi.fn();
        store.on('update', updateSpy);
        record.set('name', 'Gone');

        expect(updateSpy).not.toHaveBeenCalled();
        expect(record.get('name')).toBe('Gone');
    });

    it('clears every back-ref on removeAll', () => {
        const store  = makeStore(SAMPLE);
        const record = store.getAt(0)!;

        store.removeAll();

        const updateSpy = vi.fn();
        store.on('update', updateSpy);
        record.set('name', 'Gone');

        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('re-adopts a restored record and releases a dropped new record on reject', () => {
        const store     = makeStore(SAMPLE);
        const persisted = store.getById(1)!;

        store.remove(persisted);                                  // released, queued for removal
        const created = store.add({ id: 99, name: 'New', score: 0 })[0];   // adopted, new
        store.reject();                                           // restores persisted, drops created

        const updateSpy = vi.fn();
        store.on('update', updateSpy);

        persisted.set('name', 'Re');                              // restored -> owned -> notifies
        expect(updateSpy).toHaveBeenCalledOnce();

        updateSpy.mockClear();
        created.set('name', 'Dropped');                           // dropped -> released -> silent
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('getById returns undefined after removeAll', () => {
        const store = makeStore(SAMPLE);

        store.removeAll();

        expect(store.getById(1)).toBeUndefined();
        expect(store.getById(2)).toBeUndefined();
        expect(store.getById(3)).toBeUndefined();
        expect(store.getCount()).toBe(0);
        expect(store.getAll()).toHaveLength(0);
    });

    it('removeAll still fires clear and datachanged with every prior record', () => {
        const store = makeStore(SAMPLE);
        const clearSpy = vi.fn();
        const changedSpy = vi.fn();

        store.on('clear', clearSpy);
        store.on('datachange', changedSpy);
        store.removeAll();

        expect(clearSpy).toHaveBeenCalledOnce();
        expect(clearSpy.mock.calls[0][0].removed).toHaveLength(3);
        expect(changedSpy).toHaveBeenCalledOnce();
    });

    it('loadData discards removals queued before the reload', () => {
        const store = makeStore(SAMPLE);

        store.remove(store.getById(1)!);          // persisted -> queued for delete
        expect(store.hasPendingChanges()).toBe(true);

        store.loadData([{ id: 5, name: 'Zoe', score: 50 }]);

        expect(store.hasPendingChanges()).toBe(false);
        expect(store.getById(1)).toBeUndefined();
        expect(store.getById(5)?.get('name')).toBe('Zoe');
    });

    it('insert splices at the given index and marks the record new', () => {
        const store = makeStore(SAMPLE);

        const added = store.insert(1, { id: 9, name: 'Eve', score: 55 });

        expect(added).toHaveLength(1);
        expect(added[0].isNew()).toBe(true);
        expect(store.getAt(1)?.get('name')).toBe('Eve');
        expect(store.getCount()).toBe(4);
    });

    it('insert clamps an out-of-range index like add appends', () => {
        const store = makeStore(SAMPLE);

        store.insert(-5, { id: 8, name: 'Front', score: 1 });     // clamps to 0
        store.insert(999, { id: 7, name: 'Back', score: 2 });     // clamps to length

        expect(store.getAt(0)?.get('name')).toBe('Front');
        expect(store.getAt(store.getCount() - 1)?.get('name')).toBe('Back');
    });

    it('insert accepts an array, preserving order at the insertion point', () => {
        const store = makeStore(SAMPLE);

        const added = store.insert(0, [
            { id: 10, name: 'X', score: 0 },
            { id: 11, name: 'Y', score: 0 },
        ]);

        expect(added).toHaveLength(2);
        expect(store.getAt(0)?.get('name')).toBe('X');
        expect(store.getAt(1)?.get('name')).toBe('Y');
    });

    it('insert fires exactly one add followed by one datachanged', () => {
        const store = makeStore([]);
        const events: string[] = [];

        store.on('add', () => events.push('add'));
        store.on('datachange', () => events.push('datachange'));
        store.insert(0, { id: 1, name: 'A', score: 0 });

        expect(events).toEqual(['add', 'datachange']);
    });
});
