import { describe, it, expect, vi, afterEach } from 'vitest';
import { AjaxProxy } from '~/data/proxy/AjaxProxy';
import type { Reader, ReadResult } from '~/data/proxy/Reader';
import type { Writer } from '~/data/proxy/Writer';
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

    it('read() parses the default { data, total } envelope when paginated', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ data: [{ id: 1 }], total: 42 })));

        const proxy = new AjaxProxy({ url: '/api/users' });
        const rows  = await proxy.read({ page: 1, pageSize: 10 });

        expect(rows).toEqual([{ id: 1 }]);
        expect(proxy.getLastTotalCount()).toBe(42);
    });

    it('read() routes through a custom reader', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ anything: true })));

        const reader: Reader = {
            read: (_raw, _paginated): ReadResult => ({ records: [{ id: 7 }], total: 1 }),
        };
        const proxy = new AjaxProxy({ url: '/api/users', reader });

        expect(await proxy.read({ page: 1 })).toEqual([{ id: 7 }]);
        expect(proxy.getLastTotalCount()).toBe(1);
    });

    it('read() appends sort= and filter= only when descriptors are present', async () => {
        const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: [], total: 0 }));
        vi.stubGlobal('fetch', fetchMock);

        const proxy = new AjaxProxy({ url: '/api/users' });
        await proxy.read({
            page: 1,
            pageSize: 10,
            sorters: [{ field: 'name', dir: 'asc' }],
            filters: [{ type: 'eq', field: 'name', value: 'Bob' }],
        });

        const calledUrl = fetchMock.mock.calls[0][0] as string;
        expect(calledUrl).toContain('sort=' + encodeURIComponent(JSON.stringify([{ field: 'name', dir: 'asc' }])));
        expect(calledUrl).toContain('filter=' + encodeURIComponent(JSON.stringify([{ type: 'eq', field: 'name', value: 'Bob' }])));
    });

    it('read() omits sort= and filter= when no descriptors are given', async () => {
        const fetchMock = vi.fn().mockResolvedValue(okResponse([{ id: 1 }]));
        vi.stubGlobal('fetch', fetchMock);

        const proxy = new AjaxProxy({ url: '/api/users' });
        await proxy.read();

        expect(fetchMock).toHaveBeenCalledWith('/api/users', expect.objectContaining({ method: 'GET' }));
        const calledUrl = fetchMock.mock.calls[0][0] as string;
        expect(calledUrl).not.toContain('sort=');
        expect(calledUrl).not.toContain('filter=');
    });

    it('read() threads the abort signal into fetch', async () => {
        const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: [{ id: 1 }], total: 1 }));
        vi.stubGlobal('fetch', fetchMock);

        const controller = new AbortController();
        const proxy = new AjaxProxy({ url: '/api/users' });
        await proxy.read({ page: 1, signal: controller.signal });

        expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: controller.signal }));
    });

    it('createBatch() POSTs the serialized batch and returns per-record data in order', async () => {
        const fetchMock = vi.fn().mockResolvedValue(okResponse([{ id: 1 }, { id: 2 }]));
        vi.stubGlobal('fetch', fetchMock);

        const proxy   = new AjaxProxy({ url: '/api/users' });
        const records = [new ModelRecord(MODEL, { name: 'A' }), new ModelRecord(MODEL, { name: 'B' })];
        const result  = await proxy.createBatch(records);

        expect(result).toEqual([{ id: 1 }, { id: 2 }]);
        expect(fetchMock).toHaveBeenCalledWith('/api/users', expect.objectContaining({
            method: 'POST',
            body  : JSON.stringify(records.map(r => r.getData())),
        }));
    });

    it('updateBatch() PUTs the serialized batch to the collection URL', async () => {
        const fetchMock = vi.fn().mockResolvedValue(okResponse([{ id: 3 }]));
        vi.stubGlobal('fetch', fetchMock);

        const proxy   = new AjaxProxy({ url: '/api/users' });
        const records = [new ModelRecord(MODEL, { id: 3, name: 'Ann' })];
        await proxy.updateBatch(records);

        expect(fetchMock).toHaveBeenCalledWith('/api/users', expect.objectContaining({ method: 'PUT' }));
    });

    it('destroyBatch() DELETEs the serialized batch from the collection URL', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
        vi.stubGlobal('fetch', fetchMock);

        const proxy   = new AjaxProxy({ url: '/api/users' });
        const records = [new ModelRecord(MODEL, { id: 9, name: 'Kai' })];
        await proxy.destroyBatch(records);

        expect(fetchMock).toHaveBeenCalledWith('/api/users', expect.objectContaining({
            method: 'DELETE',
            body  : JSON.stringify(records.map(r => r.getData())),
        }));
    });

    it('createBatch() unwraps the configured root key', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ rows: [{ id: 1 }] })));

        const proxy = new AjaxProxy({ url: '/api/users', root: 'rows' });
        expect(await proxy.createBatch([new ModelRecord(MODEL, { name: 'A' })])).toEqual([{ id: 1 }]);
    });

    it('createBatch() throws on a non-OK response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => [] }));

        const proxy = new AjaxProxy({ url: '/api/users' });
        await expect(proxy.createBatch([new ModelRecord(MODEL, { name: 'A' })])).rejects.toThrow('status 500');
    });

    it('create() routes the body through a custom writer', async () => {
        const fetchMock = vi.fn().mockResolvedValue(okResponse({ id: 1 }));
        vi.stubGlobal('fetch', fetchMock);

        const writer: Writer = {
            writeRecord: (): string => 'CUSTOM',
            writeRecords: (): string => '[]',
        };
        const proxy  = new AjaxProxy({ url: '/api/users', writer });
        const record = new ModelRecord(MODEL, { name: 'Zoe' });
        await proxy.create(record);

        expect(fetchMock).toHaveBeenCalledWith('/api/users', expect.objectContaining({ body: 'CUSTOM' }));
    });
});
