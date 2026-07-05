import { describe, it, expect, vi } from 'vitest';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';

const MODEL = new Model([{ name: 'id' }, { name: 'cat' }, { name: 'name' }], 'id');

function makeStore(data: any[] = []): MemoryStore {
    const store = new MemoryStore(MODEL, data);
    store.loadData(data);
    return store;
}

const SAMPLE = [
    { id: 1, cat: 'a', name: 'Alice' },
    { id: 2, cat: 'b', name: 'Bob' },
    { id: 3, cat: 'a', name: 'Carol' },
];

describe('AbstractStore grouping — group field', () => {
    it('defaults to null and round-trips through setGroupField', () => {
        const store = makeStore(SAMPLE);
        expect(store.getGroupField()).toBeNull();
        store.setGroupField('cat');
        expect(store.getGroupField()).toBe('cat');
    });

    it('fires groupchange with { groupField } only on a real change', () => {
        const store = makeStore(SAMPLE);
        const spy = vi.fn();
        store.on('groupchange', spy);

        store.setGroupField('cat');
        expect(spy).toHaveBeenCalledOnce();
        expect(spy.mock.calls[0][0]).toEqual({ groupField: 'cat' });

        store.setGroupField('cat'); // same field -> no re-emit
        expect(spy).toHaveBeenCalledOnce();
    });

    it('does not rebuild the view or fire datachanged (grouping is a pure read)', () => {
        const store = makeStore(SAMPLE);
        const datachangedSpy = vi.fn();
        store.on('datachanged', datachangedSpy);

        store.setGroupField('cat');

        expect(datachangedSpy).not.toHaveBeenCalled();
    });

    it('setGroupField(null) disables grouping and emits groupchange with null', () => {
        const store = makeStore(SAMPLE);
        store.setGroupField('cat');
        const spy = vi.fn();
        store.on('groupchange', spy);

        store.setGroupField(null);

        expect(store.getGroupField()).toBeNull();
        expect(spy).toHaveBeenCalledOnce();
        expect(spy.mock.calls[0][0]).toEqual({ groupField: null });
    });
});

describe('AbstractStore grouping — getGroupString', () => {
    it('returns String(record.get(groupField)) when a group field is set', () => {
        const store = makeStore(SAMPLE);
        store.setGroupField('cat');
        expect(store.getGroupString(store.getAt(0)!)).toBe('a');
    });

    it("returns '' when no group field is set", () => {
        const store = makeStore(SAMPLE);
        expect(store.getGroupString(store.getAt(0)!)).toBe('');
    });

    it("returns '' when the record's group value is null/undefined", () => {
        const store = makeStore([{ id: 1, cat: null, name: 'X' }]);
        store.setGroupField('cat');
        expect(store.getGroupString(store.getAt(0)!)).toBe('');
    });
});

describe('AbstractStore grouping — getGroups', () => {
    it("puts every record under the single '' key when no group field is set", () => {
        const store = makeStore(SAMPLE);
        const groups = store.getGroups();
        expect([...groups.keys()]).toEqual(['']);
        expect(groups.get('')).toHaveLength(3);
    });

    it('buckets by group key in first-encounter order, records keep view order', () => {
        const store = makeStore(SAMPLE);
        store.setGroupField('cat');
        const groups = store.getGroups();

        expect([...groups.keys()]).toEqual(['a', 'b']); // 'a' first-encountered
        expect(groups.get('a')!.map(r => r.get('name'))).toEqual(['Alice', 'Carol']);
        expect(groups.get('b')!.map(r => r.get('name'))).toEqual(['Bob']);
    });

    it('operates over the filtered view (filtered-out records absent from all buckets)', async () => {
        const store = makeStore(SAMPLE);
        store.setGroupField('cat');
        await store.filter('cat', 'a');

        const groups = store.getGroups();
        expect([...groups.keys()]).toEqual(['a']);
        expect(groups.get('a')!.map(r => r.get('name'))).toEqual(['Alice', 'Carol']);
    });
});
