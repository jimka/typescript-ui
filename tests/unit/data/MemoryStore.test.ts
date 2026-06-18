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
        store.on('datachanged', spy);
        store.off('datachanged', spy);
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
