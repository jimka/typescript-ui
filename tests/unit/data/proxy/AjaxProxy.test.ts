import { describe, it, expect, vi, afterEach } from 'vitest';
import { AjaxProxy } from '~/data/proxy/AjaxProxy';
import { Model } from '~/data/Model';
import { ModelRecord } from '~/data/ModelRecord';

const MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id');

function okResponse(body: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
    return { ok: true, status: 200, json: async (): Promise<unknown> => body };
}

describe('AjaxProxy', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('read() returns a top-level array when no root is configured', async () => {
        const fetchMock = vi.fn().mockResolvedValue(okResponse([{ id: 1 }, { id: 2 }]));
        vi.stubGlobal('fetch', fetchMock);

        const proxy = new AjaxProxy({ url: '/api/users' });
        const rows  = await proxy.read();

        expect(rows).toHaveLength(2);
        expect(fetchMock).toHaveBeenCalledWith('/api/users', expect.objectContaining({ method: 'GET' }));
    });

    it('read() unwraps the configured root key', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ rows: [{ id: 1 }] })));

        const proxy = new AjaxProxy({ url: '/api/users', root: 'rows' });
        expect(await proxy.read()).toEqual([{ id: 1 }]);
    });

    it('read() throws on a non-OK response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));

        const proxy = new AjaxProxy({ url: '/api/users' });
        await expect(proxy.read()).rejects.toThrow('status 500');
    });

    it('create() POSTs the record data', async () => {
        const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: 7, name: 'Zoe' }));
        vi.stubGlobal('fetch', fetchMock);

        const proxy  = new AjaxProxy({ url: '/api/users' });
        const record = new ModelRecord(MODEL, { name: 'Zoe' });
        await proxy.create(record);

        expect(fetchMock).toHaveBeenCalledWith('/api/users', expect.objectContaining({
            method : 'POST',
            body   : JSON.stringify(record.getData()),
        }));
    });

    it('update() PUTs to {url}/{id}', async () => {
        const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: 3 }));
        vi.stubGlobal('fetch', fetchMock);

        const proxy  = new AjaxProxy({ url: '/api/users' });
        const record = new ModelRecord(MODEL, { id: 3, name: 'Ann' });
        await proxy.update(record);

        expect(fetchMock).toHaveBeenCalledWith('/api/users/3', expect.objectContaining({ method: 'PUT' }));
    });

    it('destroy() sends DELETE to {url}/{id}', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
        vi.stubGlobal('fetch', fetchMock);

        const proxy  = new AjaxProxy({ url: '/api/users' });
        const record = new ModelRecord(MODEL, { id: 9, name: 'Kai' });
        await proxy.destroy(record);

        expect(fetchMock).toHaveBeenCalledWith('/api/users/9', expect.objectContaining({ method: 'DELETE' }));
    });
});
