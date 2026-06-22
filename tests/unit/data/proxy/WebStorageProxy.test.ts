import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebStorageProxy } from '~/data/proxy/WebStorageProxy';
import { Model } from '~/data/Model';
import { ModelRecord } from '~/data/ModelRecord';

const MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id');

/**
 * Minimal in-memory Storage stand-in so the proxy can be exercised without a DOM.
 */
function makeStorage(): Storage {
    const map = new Map<string, string>();

    return {
        get length(): number { return map.size; },
        clear: (): void => map.clear(),
        getItem: (k: string): string | null => (map.has(k) ? map.get(k)! : null),
        key: (i: number): string | null => Array.from(map.keys())[i] ?? null,
        removeItem: (k: string): void => { map.delete(k); },
        setItem: (k: string, v: string): void => { map.set(k, v); },
    } as Storage;
}

describe('WebStorageProxy', () => {
    let storage: Storage;

    beforeEach(() => {
        storage = makeStorage();
        vi.stubGlobal('localStorage', storage);
        vi.stubGlobal('sessionStorage', makeStorage());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('seeds data only when the key is absent', async () => {
        new WebStorageProxy({ key: 'k', data: [{ id: 1 }] });
        const proxy = new WebStorageProxy({ key: 'k', data: [{ id: 2 }] });

        expect(await proxy.read()).toEqual([{ id: 1 }]);
    });

    it('read() returns an empty array when the key is absent', async () => {
        const proxy = new WebStorageProxy({ key: 'empty' });
        expect(await proxy.read()).toEqual([]);
    });

    it('create() persists the record and round-trips through storage', async () => {
        const proxy  = new WebStorageProxy({ key: 'k' });
        const record = new ModelRecord(MODEL, { id: 5, name: 'Eve' });
        await proxy.create(record);

        const reread = new WebStorageProxy({ key: 'k' });
        expect(await reread.read()).toEqual([{ id: 5, name: 'Eve' }]);
    });

    it('create() generates a numeric id when the record has none', async () => {
        const proxy = new WebStorageProxy({ key: 'k', data: [{ id: 3, name: 'A' }] });
        const stored = await proxy.create(new ModelRecord(MODEL, { name: 'B' }));

        expect(stored.id).toBe(4);
    });

    it('update() replaces the matching entry by primary key', async () => {
        const proxy = new WebStorageProxy({ key: 'k', data: [{ id: 1, name: 'Old' }] });
        await proxy.update(new ModelRecord(MODEL, { id: 1, name: 'New' }));

        expect(await proxy.read()).toEqual([{ id: 1, name: 'New' }]);
    });

    it('destroy() removes the matching entry by primary key', async () => {
        const proxy = new WebStorageProxy({ key: 'k', data: [{ id: 1 }, { id: 2 }] });
        await proxy.destroy(new ModelRecord(MODEL, { id: 1 }));

        expect(await proxy.read()).toEqual([{ id: 2 }]);
    });

    it('storage: session targets sessionStorage', async () => {
        const proxy = new WebStorageProxy({ key: 'k', storage: 'session', data: [{ id: 9 }] });

        expect(localStorage.getItem('k')).toBeNull();
        expect(await proxy.read()).toEqual([{ id: 9 }]);
    });
});
