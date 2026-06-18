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
});
