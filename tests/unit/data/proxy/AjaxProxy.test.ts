import { describe, it, expect, vi, afterEach } from 'vitest';
import { AjaxProxy } from '~/data/proxy/AjaxProxy';
import { AjaxError } from '~/data/proxy/AjaxError';
import type { Reader, ReadResult } from '~/data/proxy/Reader';
import type { Writer } from '~/data/proxy/Writer';
import { Model } from '~/data/Model';
import { ModelRecord } from '~/data/ModelRecord';

const MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id');

function okResponse(body: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
    return { ok: true, status: 200, json: async (): Promise<unknown> => body };
}

function errorResponse(opts: {
    status?: number;
    statusText?: string;
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
}): Response {
    return {
        ok        : false,
        status    : opts.status ?? 500,
        statusText: opts.statusText ?? '',
        json      : opts.json ?? ((): Promise<unknown> => Promise.reject(new Error('no json'))),
        text      : opts.text ?? ((): Promise<string> => Promise.reject(new Error('no text'))),
    } as unknown as Response;
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

    describe('error detail', () => {
        it('throws an AjaxError carrying the parsed JSON error body', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse({
                status    : 409,
                statusText: 'Conflict',
                json      : async (): Promise<unknown> => ({ detail: 'duplicate key on email' }),
            })));

            const proxy  = new AjaxProxy({ url: '/api/users' });
            const record = new ModelRecord(MODEL, { name: 'Zoe' });
            const err    = await proxy.create(record).catch((e: unknown) => e);

            expect(err).toBeInstanceOf(AjaxError);
            expect(err).toBeInstanceOf(Error);
            expect(err).toMatchObject({
                status    : 409,
                statusText: 'Conflict',
                body      : { detail: 'duplicate key on email' },
                operation : 'create',
                url       : '/api/users',
            });
        });

        it('falls back to text when the error body is not JSON', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse({
                status: 500,
                json  : (): Promise<unknown> => Promise.reject(new Error('not json')),
                text  : async (): Promise<string> => '<html>500</html>',
            })));

            const proxy = new AjaxProxy({ url: '/api/users' });
            const err   = await proxy.read().catch((e: unknown) => e) as AjaxError;

            expect(err).toBeInstanceOf(AjaxError);
            expect(err.body).toBe('<html>500</html>');
            expect(err.status).toBe(500);
        });

        it('still throws an AjaxError with undefined body when both json and text fail', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse({
                status    : 503,
                statusText: 'Service Unavailable',
                json      : (): Promise<unknown> => Promise.reject(new Error('no json')),
                text      : (): Promise<string> => Promise.reject(new Error('no text')),
            })));

            const proxy = new AjaxProxy({ url: '/api/users' });
            const err   = await proxy.read().catch((e: unknown) => e) as AjaxError;

            expect(err).toBeInstanceOf(AjaxError);
            expect(err.body).toBeUndefined();
            expect(err.status).toBe(503);
            expect(err.statusText).toBe('Service Unavailable');
        });

        it('sets the operation name and a plain useful message', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse({
                status: 400,
                json  : async (): Promise<unknown> => ({}),
            })));

            const proxy = new AjaxProxy({ url: '/api/users' });
            const err   = await proxy.read().catch((e: unknown) => e) as AjaxError;

            expect(err.name).toBe('AjaxError');
            expect(err.message).toBe('AjaxProxy: read failed with status 400');
        });

        it('every operation throws an AjaxError with the right operation and url', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse({
                status    : 409,
                statusText: 'Conflict',
                json      : async (): Promise<unknown> => ({ detail: 'x' }),
            })));

            const proxy = new AjaxProxy({ url: '/api/users' });
            const rec   = new ModelRecord(MODEL, { id: 5, name: 'A' });

            const cases: Array<[() => Promise<unknown>, string, string]> = [
                [(): Promise<unknown> => proxy.read(),              'read',    '/api/users'],
                [(): Promise<unknown> => proxy.create(rec),         'create',  '/api/users'],
                [(): Promise<unknown> => proxy.update(rec),         'update',  '/api/users/5'],
                [(): Promise<unknown> => proxy.destroy(rec),        'destroy', '/api/users/5'],
                [(): Promise<unknown> => proxy.createBatch([rec]),  'create',  '/api/users'],
                [(): Promise<unknown> => proxy.updateBatch([rec]),  'update',  '/api/users'],
                [(): Promise<unknown> => proxy.destroyBatch([rec]), 'destroy', '/api/users'],
            ];

            for (const [run, operation, url] of cases) {
                const err = await run().catch((e: unknown) => e) as AjaxError;

                expect(err, `operation ${operation}`).toBeInstanceOf(AjaxError);
                expect(err.operation).toBe(operation);
                expect(err.url).toBe(url);
            }
        });
    });
});
