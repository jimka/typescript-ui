import { describe, it, expect, vi, afterEach } from 'vitest';
import { AjaxStore } from '~/data/AjaxStore';
import { AjaxProxy } from '~/data/proxy/AjaxProxy';
import { Model } from '~/data/Model';

const MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id');

function okResponse(body: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
    return { ok: true, status: 200, json: async (): Promise<unknown> => body };
}

describe('AjaxStore', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('positional form builds an AjaxProxy from the proxy options', () => {
        const store = new AjaxStore(MODEL, { url: '/api/users' });

        expect(store.model).toBe(MODEL);
        expect(store.proxy).toBeInstanceOf(AjaxProxy);
    });

    it('throws when constructed with a Model but no proxy options', () => {
        // The Model-first overload requires AjaxProxyOptions; this guard is
        // AjaxStore-specific.
        expect(() => new AjaxStore(MODEL)).toThrow('AjaxStore requires an AjaxProxyOptions argument');
    });

    it('options-bag form builds the proxy and applies bag options', () => {
        const store = new AjaxStore({
            model: MODEL,
            proxy: { url: '/api/users' },
            filters: [{ type: 'eq', field: 'name', value: 'Bob' }],
        });

        expect(store.proxy).toBeInstanceOf(AjaxProxy);
        expect(store.getActiveFilters()).toEqual([{ type: 'eq', field: 'name', value: 'Bob' }]);
    });

    it('load() flows through the embedded proxy to fetch and populate records', async () => {
        const fetchMock = vi.fn().mockResolvedValue(okResponse([{ id: 1, name: 'Ann' }, { id: 2, name: 'Bo' }]));
        vi.stubGlobal('fetch', fetchMock);

        const store = new AjaxStore(MODEL, { url: '/api/users' });
        await store.load();

        expect(store.getCount()).toBe(2);
        expect(store.getAt(0)?.get('name')).toBe('Ann');
        expect(fetchMock).toHaveBeenCalledWith('/api/users', expect.objectContaining({ method: 'GET' }));
    });
});
